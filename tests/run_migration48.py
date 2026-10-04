"""python3 run_migration48.py - migration-48-day-cache-once (04-Oct-2026, round 20 part c; docs/cloud-recorder-plan.md 1: "the
database fix"). THE OWNER'S CONDITION (04-Oct): the day cache (tally_ledger_day) behind every report must come out IDENTICAL
whether it is rebuilt once per line (the old way: 44/45/47's tally_recorder_apply) or once per call (48), for the test book,
for three sends: a single entry, 500 lines on one day, and a send spanning 30 days. The test fails otherwise.
How: two throwaway PostgreSQL databases (pg_stand, ports 30482 and 30483; never a real database), both built in staging's order
32 -> ... -> 46 -> 47 with the same made-up rows; the second also gets 48 (twice). The test book is the made-up books
(tests/fixtures/books: Master.xml through tally_ingest_ledgers_g, DayBook.xml read by server/tally-cloud/parse.js under Deno and
loaded day by day through tally_ingest_day). Then the same three sends go through tally_recorder_apply on both (the third
through the queue: tally_recorder_enqueue + tally_recorder_drain, as a burst goes), and after each:
  - the trial balance: sum(tally_ledger_day.amount) per ledger and in total - identical;
  - md5 of the full tally_ledger_day content (every row: book, ledger, day, amount, dr, cr, n; ordered) - identical;
  - each line's state and words - identical;
  - and the cache equals the one computed afresh from the live entries (both databases).
The sends: (1) one new entry; (2) 500 lines dated one day: new entries, the same entries altered again in the same send,
deleted, cancelled, the same line twice (duplicate), made-up books' entries altered INTO that day (their old days touched);
(3) 300 lines over 30 days: new entries, entries moved between days, deletes and cancels of the made-up books' entries, a
ledger renamed in the middle (ledger_renamed, and 47's ledger_altered) and a ledger_created line, an older AlterID (stale).
Then: a line held in a locked month and released by the owner after the unlock (tally_recorder_release_held calls the line
without the once-per-call setting: it rebuilds per line as before) - identical; a short line re-run - not needed (same path).
Also on 48's text: begin; set local lock_timeout '10s'; commit; it holds "delete from" (the entry path's re-send and nothing
else: it is posted for the owner to run); tally_ingest_entries' 3-argument form calls the 4-argument one with true; the
grants (the service role's; the line nobody's); security definer, search_path = public, pg_temp; md5(prosrc) of each function
= the file's text between its $function$ marks; 48 runs twice; tally_ingest_day's text unchanged.
The numbers (rows, totals, md5, times old / new) are printed.
RED (before 48): the file is missing; the comparison cannot run.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, re, sys, json, hashlib, subprocess, shutil, tempfile, html, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand, csv
csv.field_size_limit(1 << 30)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
BOOKS = os.path.join(HERE, "fixtures", "books")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql")]
M48 = os.environ.get("M48_FILE") or os.path.join(SQLDIR, "migration-48-day-cache-once.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, D1 = "11111111-1111-1111-1111-111111111111", "d1000000-0000-0000-0000-000000000001"
LIST = {"source": "bridge ledgers", "device": D1, "bridge": "go-abc123", "computer": "NWS144", "user": "accounts"}

def read_master():
    t = open(os.path.join(BOOKS, "Master.xml"), "rb").read().decode("utf-16")
    prim = lambda p: "" if re.match(r"^\W*Primary$", p) else p
    tag = lambda s, n: html.unescape((re.search("<%s>([^<]*)</%s>" % (n, n), s) or [None, ""])[1])
    leds, grps, guids = [], [], {}
    for m in re.finditer(r'<LEDGER NAME="([^"]*)"[^>]*>(.*?)</LEDGER>', t, re.S):
        nm = html.unescape(m.group(1)); leds.append([nm, prim(tag(m.group(2), "PARENT")), tag(m.group(2), "OPENINGBALANCE") or "0"]); guids[nm] = tag(m.group(2), "GUID")
    for m in re.finditer(r'<GROUP NAME="([^"]*)"[^>]*>(.*?)</GROUP>', t, re.S):
        grps.append([html.unescape(m.group(1)), prim(tag(m.group(2), "PARENT"))])
    return leds, grps, guids
def read_days():
    """the day book cut into days and read by the cloud's parser (parse.js under Deno): {yyyymmdd: {vouchers, lines, n, alterMax}}"""
    d = tempfile.mkdtemp(prefix="m48-")
    script = os.path.join(d, "days.mjs")
    open(script, "w").write("""
import { parseDay } from %s;
const raw = Deno.readFileSync(Deno.args[0]);
const text = raw[0] === 0xFF && raw[1] === 0xFE ? new TextDecoder("utf-16le").decode(raw) : new TextDecoder().decode(raw);
const byDay = {}; let cut, buf = text;
while ((cut = buf.indexOf("</VOUCHER>")) >= 0) {
  const piece = buf.slice(0, cut + 10); buf = buf.slice(cut + 10);
  const st = piece.lastIndexOf("<VOUCHER "); if (st < 0) continue;
  const v = piece.slice(st), dt = (v.match(/<DATE>(\\d{8})<\\/DATE>/) || [])[1]; if (!dt) continue;
  (byDay[dt] = byDay[dt] || []).push("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>");
}
const out = {};
for (const dt of Object.keys(byDay)) { const r = parseDay(byDay[dt].join("")); out[dt] = { vouchers: r.vouchers, lines: r.lines, n: r.n, alterMax: r.alterMax }; }
console.log(JSON.stringify(out));
""" % json.dumps("file://" + os.path.abspath(os.path.join(SQLDIR, "parse.js"))))
    r = subprocess.run([DENO, "run", "--allow-read", script, os.path.join(BOOKS, "DayBook.xml")], capture_output=True, text=True)
    shutil.rmtree(d, ignore_errors=True)
    if r.returncode: raise SystemExit("parse.js under Deno failed: " + r.stderr[-800:])
    return json.loads(r.stdout)

class Side:
    """one database: old (47 only) or new (47 + 48)"""
    def __init__(self, label, port):
        self.label, self.db = label, pg_stand.start(port)
    def psql_file(self, path):
        if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
        return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(self.db.port), "-U", "postgres", "-d", "postgres",
                               "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
    def jn(self, s, uid=None):
        try: return self.db.one(s, uid)
        except RuntimeError as e: return "ERROR " + str(e)[-300:]
    def j(self, s, uid=None):
        x = self.jn(s, uid)
        try: return json.loads(x) if x and not x.startswith("ERROR") else {"_error": x}
        except ValueError: return {"_error": x}
    def as_user(self, uid, stmt):
        try: return True, self.db.one("set fincom.role = 'authenticated'; set role authenticated; " + stmt, uid)
        except RuntimeError as e: return False, str(e)
    def tb(self):
        rows = self.db.rows("select ledger, sum(amount)::text as s from tally_ledger_day where book_id = %s group by ledger order by ledger" % q(B))
        return {r["ledger"]: r["s"] for r in rows}, self.db.one("select coalesce(sum(amount), 0)::text from tally_ledger_day where book_id = %s" % q(B))
    def cache_md5(self):
        return self.db.one("select md5(coalesce(string_agg(concat_ws(',', book_id, ledger, day, amount, dr, cr, n), '|' order by book_id, ledger, day), '')) from tally_ledger_day")
    def live_md5(self):
        """the cache without the rename's nil twin rows (merged_into set, amount 0: every reader filters them, migration 36)"""
        return self.db.one("select md5(coalesce(string_agg(concat_ws(',', book_id, ledger, day, amount, dr, cr, n), '|' order by book_id, ledger, day), '')) from tally_ledger_day where merged_into is null")
    def fresh_md5(self):
        """the cache computed afresh from the live entries, the rebuild's own rule (44's tally_ledger_day_rebuild)"""
        return self.db.one("""select md5(coalesce(string_agg(concat_ws(',', book_id, ledger, day, amount, dr, cr, n), '|' order by book_id, ledger, day), '')) from (
            select l.book_id, l.ledger, l.day, sum(l.amount) as amount, sum(case when l.amount < 0 then -l.amount else 0 end) as dr, sum(case when l.amount > 0 then l.amount else 0 end) as cr, count(*) as n
              from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
             where v.deleted_at is null and not v.cancelled and not v.optional group by l.book_id, l.ledger, l.day) x""")
    def rows(self): return int(self.db.one("select count(*) from tally_ledger_day where book_id = %s" % q(B)))
    def apply(self, lines):
        t = time.time(); r = self.j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines))); return r, time.time() - t
    def queued(self, lines):
        for i in range(0, len(lines), 1000):
            self.jn("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines[i:i + 1000])))
        t = time.time(); d = self.j("select tally_recorder_drain(25000)::text"); el = time.time() - t
        ids = [x["line_id"] for x in self.db.rows("select line_id from tally_recorder_lines order by id desc limit %d" % len(lines))][::-1]
        st = {x["line_id"]: (x["state"], x["held_why"]) for x in self.db.rows("select line_id, state, held_why from tally_recorder_lines where line_id like 's3-%' or line_id like 'x3-%'")}
        return {"drain": d, "results": [{"line_id": i, "state": st.get(i, ("?", ""))[0], "why": st.get(i, ("?", ""))[1]} for i in ids]}, el
    def stop(self): self.db.stop()

def V(guid, alter, day, narr="", cancel=False):
    return {"guid": guid, "alter": alter, "type": "Journal", "no": "R-" + guid, "party": "", "narr": narr, "cancel": cancel, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": day}
def entry(lid, event, guid, alter, day, legs, cancel=False):
    return {"line_id": lid, "event": event, "saved_at": "2026-10-04T10:00:00+05:30", "pc": "NWS144", "user": "accounts", "company_guid": "cg-fx", "object_guid": guid, "master_id": "9", "alter_id": alter,
            "vch_type": "Journal", "vch_no": "R-" + guid, "vch_date": day, "vouchers": [V(guid, alter, day, cancel=cancel)], "lines": [[guid, l, a, "", None, []] for l, a in legs]}
def drop(lid, event, guid, alter, day):
    return {"line_id": lid, "event": event, "saved_at": "2026-10-04T10:00:00+05:30", "pc": "NWS144", "object_guid": guid, "alter_id": alter, "vch_date": day}
def legs_for(i, leds, n=None):
    """2 to 4 balanced lines over the book's ledgers, amounts made from i"""
    n = n or 2 + i % 3
    names = [leds[(i * 7 + k * 13) % len(leds)] for k in range(n)]
    if len(set(names)) < n: names = [leds[(i + k) % len(leds)] for k in range(n)]
    amts = [round(((i * 37 + k * 11) % 9000 + 1) / 3.0, 2) for k in range(n - 1)]
    return list(zip(names, [-a for a in amts] + [round(sum(amts), 2)]))

sides = []
try:
    leds, grps, guids = read_master()
    days = read_days()
    nv = sum(x["n"] for x in days.values())
    fixture = sorted((v["guid"], d) for d, x in days.items() for v in x["vouchers"])
    names = sorted(n for n in (l[0] for l in leds) if n)
    usable = [n for n in names if not re.search(r"(?i)profit|stock|suspense", n)][:40]
    for label, port in (("old (47)", 30482), ("new (48)", 30483)):      # below the ephemeral range (32768-60999)
        s = Side(label, port); sides.append(s); db = s.db
        print("== %s: building the database (staging's order to 47) and loading the made-up books" % label)
        db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
        db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
        db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
          insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ FIXTURE', '2025-04-01', '2025-03-31');
          insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.2.0');
          create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
          insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
        for path in FILES:
            r = s.psql_file(path)
            if r.returncode: ok(False, "%s: %s runs: %s" % (label, os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
        s.j("select tally_ingest_ledgers_g(%s, '2025-04-01', '2025-03-31', %s, %s, %s, true, %d)::text" % (q(B), js(leds), js(grps), js(LIST), len(leds)))
        for nm, g in guids.items():
            db.sql("update tally_ledgers set tally_guid = %s where book_id = %s and name = tally_nm(%s)" % (q(g), q(B), q(nm)))
        for d in sorted(days):
            x = days[d]
            s.j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q("%s-%s-%s" % (d[:4], d[4:6], d[6:])), js(x["vouchers"]), js(x["lines"]), x["n"], x["alterMax"]))
        ok(int(db.one("select count(*) from tally_vouchers where book_id = %s" % q(B))) == nv and nv > 50, "%s: the made-up books loaded through tally_ingest_day: %d entries over %d days, %d ledger-day rows"
           % (label, nv, len(days), s.rows()))
    old, new = sides
    ok(old.cache_md5() == new.cache_md5() and old.tb() == new.tb(), "before any send: the two databases hold the same cache (md5 %s)" % old.cache_md5())
    # ---------------------------------------------------------------- 48 on the second database
    print("== migration 48 on the second database")
    d8 = "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)"
    day_md5 = new.jn("select md5(prosrc) from pg_proc where oid = 'public.%s'::regprocedure" % d8)
    for i in (1, 2):
        r = new.psql_file(M48); ok(r.returncode == 0, "migration-48 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    ok(new.jn("select md5(prosrc) from pg_proc where oid = 'public.%s'::regprocedure" % d8) == day_md5, "tally_ingest_day's text unchanged by 48")
    ok(old.cache_md5() == new.cache_md5(), "48 itself changes no row of the cache")
    body = open(M48).read()
    low = body.lower()
    code = "\n".join(l for l in low.split("\n") if not l.strip().startswith("--"))
    rest = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);", "", code)
    # round 21 (review 47/48 M6): the queue archive's retention, 90 days, is 48's (47 removes no row)
    rest = re.sub(r"delete from pgmq\.a_tally_recorder where archived_at < now\(\) - interval '90 days';", "", rest)
    rest = re.sub(r"delete from tally_recorder_pending where state <> 'pending' and done_at < now\(\) - interval '90 days';", "", rest)
    ok("delete from" in code and "delete from" not in rest and not re.search(r"\b(drop|truncate)\s+(table|view|function|trigger|policy|column|constraint|index)\b", low),
       "the text holds 'delete from' (the entry path's re-send of an entry's lines and bills, 44's text; the queue archive's 90-day retention, review M6; the owner runs it) and nothing else that removes or drops")
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", body, re.M) is not None and body.rstrip().endswith("commit;"), "begin; set local lock_timeout = '10s'; ... commit;")
    bodies = re.findall(r"create or replace function public\.(\w+)\((.*?)\)\s*returns.*?\$function\$(.*?)\$function\$", body, re.S)
    sig = lambda args: ", ".join(re.sub(r"^\s*p_\w+\s+", "", a).strip() for a in args.split(",")) if args.strip() else ""
    ok(sorted((n, sig(a)) for n, a, _ in bodies) == sorted([("tally_ingest_entries", "uuid, jsonb, jsonb, boolean"), ("tally_ingest_entries", "uuid, jsonb, jsonb"), ("tally_recorder_line", "uuid, uuid, jsonb, bigint"), ("tally_recorder_apply", "uuid, uuid, uuid, jsonb"), ("tally_recorder_archive_trim", "")]),
       "the functions in the file: tally_ingest_entries (4 and 3 arguments), tally_recorder_line, tally_recorder_apply (%s)" % [(n, sig(a)) for n, a, _ in bodies])
    for name, args, src in bodies:
        rp = "public.%s(%s)" % (name, sig(args))
        row = (new.db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where oid = %s::regprocedure" % q(rp)) or [{}])[0]
        fm = hashlib.md5(src.encode()).hexdigest()
        ok(row.get("m") == fm and row.get("prosecdef") == "t" and row.get("conf", "").replace(" ", "") == "search_path=public,pg_temp", "md5(prosrc) of %s = %s; security definer, search_path = public, pg_temp" % (rp, fm))
    three = new.jn("select prosrc from pg_proc where oid = 'public.tally_ingest_entries(uuid, jsonb, jsonb)'::regprocedure") or ""
    ok("tally_ingest_entries(p_book, p_vouchers, p_lines, true)" in three, "the 3-argument tally_ingest_entries calls the 4-argument one with true (rebuild)")
    pv = lambda who, sg: new.jn("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, sg))
    gr = {sg: (pv("anon", sg), pv("authenticated", sg), pv("service_role", sg)) for sg in ("tally_ingest_entries(uuid, jsonb, jsonb, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb)", "tally_recorder_apply(uuid, uuid, uuid, jsonb)", "tally_recorder_line(uuid, uuid, jsonb, bigint)")}
    ok(gr == {"tally_ingest_entries(uuid, jsonb, jsonb, boolean)": ("f", "f", "f"), "tally_ingest_entries(uuid, jsonb, jsonb)": ("f", "f", "t"), "tally_recorder_apply(uuid, uuid, uuid, jsonb)": ("f", "f", "t"), "tally_recorder_line(uuid, uuid, jsonb, bigint)": ("f", "f", "f")},
       "grants: the 3-argument entry path and the apply the service role's; the 4-argument form (review L10: only the 3-argument form and the line reach it) and the line nobody's (%s)" % gr)
    # ---------------------------------------------------------------- round 21 (docs/reviews/migration-47-48-review.md)
    apsrc = new.jn("select prosrc from pg_proc where oid = 'public.tally_recorder_apply(uuid, uuid, uuid, jsonb)'::regprocedure") or ""
    ensrc = new.jn("select prosrc from pg_proc where oid = 'public.tally_ingest_entries(uuid, jsonb, jsonb, boolean)'::regprocedure") or ""
    ok("left(btrim(coalesce(x->>'event', '')), 7) = 'ledger_'" in apsrc, "L9. tally_recorder_apply trims the event before its ledger test, as tally_recorder_line does")
    ok("tally_service_or_owner()" in apsrc and "tally_service_or_owner()" in ensrc and "auth.role() <> 'service_role'" not in apsrc + ensrc, "L6. the apply and the entry path: no JWT passes only for the owner's own logins (47's tally_service_or_owner)")
    trim_cron = new.jn("select command from cron.job where jobname = 'tally-recorder-archive-trim'")
    new.db.sql("""insert into pgmq.a_tally_recorder (msg_id, read_ct, enqueued_at, archived_at, vt, message) values (900001, 1, now() - interval '100 days', now() - interval '100 days', now(), '{}'), (900002, 1, now(), now(), now(), '{}');
                  insert into tally_recorder_pending (msg_id, book_id, state, done_at) values (900001, %s, 'done', now() - interval '100 days'), (900002, %s, 'done', now()), (900003, %s, 'pending', null);""" % (q(B), q(B), q(B)))
    tr = new.j("select tally_recorder_archive_trim()::text")
    left_ = (new.jn("select string_agg(msg_id::text, ',' order by msg_id) from pgmq.a_tally_recorder where msg_id >= 900001"), new.jn("select string_agg(msg_id::text, ',' order by msg_id) from tally_recorder_pending where msg_id >= 900001"))
    ok(trim_cron == "select public.tally_recorder_archive_trim()" and tr.get("archive") == 1 and tr.get("pending") == 1 and left_ == ("900002", "900002,900003"),
       "M6. the queue archive and the settled pending rows kept 90 days (pg_cron daily); a pending row never removed (%s; %s; %s)" % (trim_cron, tr, left_))
    new.db.sql("delete from pgmq.a_tally_recorder where msg_id >= 900001; delete from tally_recorder_pending where msg_id >= 900001;")
    good, out = new.as_user(OWNER, "select tally_ingest_entries(%s, '[]'::jsonb, '[]'::jsonb, false)::text" % q(B))
    ok(not good, "the 4-argument form refused to a signed-in owner")
    # ---------------------------------------------------------------- the three sends
    def compare(tag, ra, rb, ta, tb_):
        sa = [(x.get("line_id"), x.get("state"), x.get("why")) for x in (ra.get("results") or [])]
        sb = [(x.get("line_id"), x.get("state"), x.get("why")) for x in (rb.get("results") or [])]
        ok(len(sa) > 0 and sa == sb, "%s: every line's state and words identical (%d lines: %s)" % (tag, len(sa), {k: sum(1 for x in sa if x[1] == k) for k in sorted(set(x[1] for x in sa))}))
        (pa, totA), (pb, totB) = old.tb(), new.tb()
        ma, mb = old.cache_md5(), new.cache_md5()
        ok(pa == pb and totA == totB, "%s: the trial balance identical: %d ledgers, total %s (old) / %s (new)" % (tag, len(pa), totA, totB))
        ok(ma == mb, "%s: md5 of the full tally_ledger_day identical: %s (old, %d rows) / %s (new, %d rows)" % (tag, ma, old.rows(), mb, new.rows()))
        fa, fb = old.fresh_md5(), new.fresh_md5()
        ok(fa == old.live_md5() and fb == new.live_md5() and old.db.one("select count(*) from tally_ledger_day where merged_into is not null and (amount <> 0 or n <> 0)") == "0",
           "%s: and each equals the cache computed afresh from the live entries (%s / %s; the rename's nil twin rows aside: %s)" % (tag, fa, fb, old.db.one("select count(*) from tally_ledger_day where merged_into is not null")))
        if fa != old.live_md5():
            for r in old.db.rows("""with f as (select l.ledger, l.day, sum(l.amount) as amount, count(*) as n from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
                                     where v.deleted_at is null and not v.cancelled and not v.optional and l.book_id = %s group by l.ledger, l.day),
                                     c as (select ledger, day, amount, n, merged_into from tally_ledger_day where book_id = %s)
                                   select coalesce(f.ledger, c.ledger) as ledger, coalesce(f.day, c.day) as day, f.amount as fresh, c.amount as cache, f.n as fresh_n, c.n as cache_n, c.merged_into
                                     from f full join c on c.ledger = f.ledger and c.day = f.day where f.amount is distinct from c.amount or f.n is distinct from c.n limit 8""" % (q(B), q(B))):
                print("         differs: %s" % r)
        print("       %s: time old %.2f s, new %.2f s" % (tag, ta, tb_))
        return {"tag": tag, "ledgers": len(pa), "total": totA, "rows": old.rows(), "md5": ma, "old_s": round(ta, 2), "new_s": round(tb_, 2)}
    report = []
    print("== send 1: a single entry")
    s1 = [entry("s1-0", "created", "s1-g0", 5001, "2025-06-15", legs_for(1, usable, 2))]
    (ra, ta), (rb, tb_) = old.apply(s1), new.apply(s1)
    report.append(compare("send 1 (a single entry)", ra, rb, ta, tb_))
    ok((ra.get("applied"), ra.get("held")) == (1, 0), "send 1: applied 1 (%s)" % {k: ra.get(k) for k in ("applied", "held", "duplicate", "stale", "failed")})
    print("== send 2: 500 lines on one day")
    DAY = "2026-03-15"
    in_mar = [g for g, d in fixture if d.startswith("202603")][:20]
    other = [g for g, d in fixture if not d.startswith("202603")][:30]
    s2 = []
    for i in range(500):
        k = i % 10
        if k <= 5: s2.append(entry("s2-%03d" % i, "created", "s2-g%03d" % i, 6000 + i, DAY, legs_for(i, usable)))
        elif k == 6: s2.append(entry("s2-%03d" % i, "altered", "s2-g%03d" % (i - 6), 6600 + i, DAY, legs_for(i + 3, usable)))       # an entry of this send altered again in it
        elif k == 7: s2.append(drop("s2-%03d" % i, "deleted", "s2-g%03d" % (i - 6), 6700 + i, DAY))                                # then deleted
        elif k == 8: s2.append(drop("s2-%03d" % i, "cancelled", "s2-g%03d" % (i - 7), 6800 + i, DAY) if (i // 10) % 2 else dict(s2[-3], line_id="s2-%03d" % i))   # cancelled, or the same line twice
        else:
            g = (other + in_mar)[(i // 10) % 50]
            s2.append(entry("s2-%03d" % i, "altered", g, 900000 + i, DAY, legs_for(i + 5, usable)))                                 # a made-up books' entry altered into this day
    (ra, ta), (rb, tb_) = old.apply(s2), new.apply(s2)
    report.append(compare("send 2 (500 lines on %s)" % DAY, ra, rb, ta, tb_))
    ok(ra.get("applied", 0) >= 400 and ra.get("duplicate", 0) >= 20, "send 2: %s" % {k: ra.get(k) for k in ("applied", "held", "duplicate", "stale", "failed")})
    print("== send 3: 300 lines spanning 30 days (through the queue: enqueue + drain)")
    sep = ["2025-09-%02d" % d for d in range(1, 31)]
    s3 = []
    victims = [g for g, d in fixture if not d.startswith("202509")]
    ren_from = next(n for n in usable if new.db.one("select count(*) from tally_lines where book_id = %s and ledger = %s" % (q(B), q(n))) not in ("0", None))
    ren_guid = guids.get(ren_from) or old.db.one("select tally_guid from tally_ledgers where book_id = %s and name = %s" % (q(B), q(ren_from)))
    alt_from = next(n for n in usable if n != ren_from and guids.get(n))
    for i in range(300):
        dd = sep[i % 30]
        k = i % 12
        if i == 150:
            s3.append({"line_id": "s3-%03d" % i, "event": "ledger_renamed", "object_guid": ren_guid, "from": ren_from, "to": ren_from + " (renamed)", "saved_at": "2026-10-04T11:00:00+05:30"}); continue
        if i == 151:
            s3.append({"line_id": "s3-%03d" % i, "event": "ledger_altered", "object_guid": guids[alt_from], "name": alt_from + " NEW", "alter_id": 5, "saved_at": "2026-10-04T11:00:00+05:30"}); continue
        if i == 152:
            s3.append({"line_id": "s3-%03d" % i, "event": "ledger_created", "object_guid": "g-brand-new", "name": "Brand New Ledger", "saved_at": "2026-10-04T11:00:00+05:30"}); continue
        lg = [(ren_from + " (renamed)" if (i > 150 and n == ren_from) else (alt_from + " NEW" if (i > 151 and n == alt_from) else n), a) for n, a in legs_for(i + 11, usable)]
        if k <= 6: s3.append(entry("s3-%03d" % i, "created", "s3-g%03d" % i, 7000 + i, dd, lg))
        elif k == 7: s3.append(entry("s3-%03d" % i, "altered", "s3-g%03d" % (i - 7), 7400 + i, sep[(i + 9) % 30], lg))                  # moved to another day
        elif k == 8: s3.append(drop("s3-%03d" % i, "deleted", victims[(i // 12) % len(victims)], 990000 + i, dd))                       # a made-up books' entry deleted
        elif k == 9: s3.append(drop("s3-%03d" % i, "cancelled", victims[(i // 12 + 7) % len(victims)], 991000 + i, dd))
        elif k == 10: s3.append(entry("s3-%03d" % i, "altered", "s3-g%03d" % (i - 10), 100 + i, dd, lg))                               # an older AlterID: stale
        else: s3.append(entry("s3-%03d" % i, "imported", "s3-g%03d" % i, 7800 + i, dd, lg))
    (ra, ta), (rb, tb_) = old.queued(s3), new.queued(s3)
    report.append(compare("send 3 (300 lines over 2025-09-01..30, queued)", ra, rb, ta, tb_))
    ok(ra["drain"].get("done") == 1 and rb["drain"].get("done") == 1, "send 3: one message drained on each (%s / %s)" % (ra["drain"], rb["drain"]))
    stt = lambda r: {k: sum(1 for x in r["results"] if x["state"] == k) for k in ("applied", "held", "duplicate", "stale", "failed")}
    ok(stt(ra)["applied"] >= 200 and stt(ra)["stale"] >= 20 and next(x for x in ra["results"] if x["line_id"] == "s3-150")["state"] == "applied" and next(x for x in ra["results"] if x["line_id"] == "s3-151")["state"] == "applied",
       "send 3: %s; the rename lines applied" % stt(ra))
    st8 = [((sd.apply([{"line_id": "m8-1", "event": "ledger_altered", "object_guid": guids[alt_from], "name": alt_from, "alter_id": 3, "saved_at": "2026-10-04T11:05:00+05:30"}])[0].get("results") or [{}])[0].get("state")) for sd in sides]
    ok(st8 == ["stale", "stale"] and all(sd.db.one("select count(*) from tally_ledgers where book_id = %s and name = %s" % (q(B), q(alt_from + " NEW"))) == "1" for sd in sides),
       "M8. an older ledger_altered (AlterID 3, after the rename at 5) arriving late: stale on both, the rename kept (%s)" % st8)
    print("== a held line released by the owner (the line called without the once-per-call setting)")
    for s in sides:
        s.as_user(OWNER, "select tally_month_lock('c1', '2025-12-01', 'closing')::text")
    lk = [entry("x3-000", "created", "x3-g0", 8000, "2025-12-10", legs_for(77, usable)), entry("x3-001", "created", "x3-g1", 8001, "2025-11-10", legs_for(78, usable))]
    (ra, ta), (rb, tb_) = old.apply(lk), new.apply(lk)
    rel = []
    for s in sides:
        s.as_user(OWNER, "select tally_month_unlock('c1', '2025-12-01', 'reopened')::text")
        rid = s.db.one("select id from tally_recorder_lines where line_id = 'x3-000' order by id desc limit 1")
        rel.append(s.as_user(OWNER, "select tally_recorder_release_held(%s)::text" % rid))
    ok([x.get("state") for x in ra.get("results", [])] == ["held", "applied"] and all(g for g, _ in rel) and all('"applied"' in (o or "") for _, o in rel), "held in a locked month, released by the owner after the unlock: applied on both (%s)" % [o[:120] for _, o in rel])
    report.append(compare("a held line released", ra, rb, ta, tb_))
    print("\n  THE OWNER'S CONDITION, the numbers:")
    for x in report:
        print("    %-52s ledgers %3d  total %-10s rows %4d  md5 %s  old %.2f s  new %.2f s" % (x["tag"], x["ledgers"], x["total"], x["rows"], x["md5"], x["old_s"], x["new_s"]))
finally:
    for s in sides: s.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
