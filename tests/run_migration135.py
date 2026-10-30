"""python3 run_migration135.py - migration-135-check-changes (30-Oct-2026; the owner: "there should be a button 'check any
change'.. if there is any change then it should do it"). One button, "Check for changes in Tally", for a period the person
picks (this financial year so far, this month, the last 7 days, or a range of their own): the days are queued for 133's day
check (Tally's day lists through the existing older-entries path; FinCom's copy corrected to Tally: added, updated, or
soft-deleted with history after two whole-day lists a minute apart). On a throwaway PostgreSQL (pg_stand, port 31135; never a
real database), built as run_migration133.py builds it, then 98, 133 and 135. Made-up books only. Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate; the only table change is the
     new table's row security; no function of 133 or 98 replaced), names no real database; runs twice; the new table's own
     grants (service_role only); the app's functions for authenticated (not anon), tally-ingest's for service_role only.
  1. the press (tally_check_request(client, from, to)): owner or staff of the firm; a viewer, another firm or a client with
     no books from Tally cannot; the period cut to the days the books hold (not before the books start, not after today);
     from after to, or more than 400 days: refused in plain words; the days queued for the check (newest first to the
     bridge, fetch true, a choice time).
  2. progress: checked n of m days, the days waiting, the time left once two minutes are measured.
  3. matched days ticked; a changed day corrected and listed (added, changed, deleted with history kept): each row with
     its date, voucher type and number, party and amount; the counts are the list's own; the state "done".
  4. nothing changed: a fresh press over matching days: done with no rows (the earlier press's changes are not counted).
  5. a running "Bring books from Tally": the press says it waits for it (after), and its days are handed out under the
     period's choice time; the period paused: none handed out; the period stopped (by the person, or by the bridge because
     Tally was busy): a press hands the days out again under a new choice time; the bridge's stop of the check: nothing
     handed out until the next press.
  6. who sees it: the firm's members (a viewer too); another firm never.
  7. (the owner, 30-Oct-2026, 16:30: "I have already uploaded the books.. why don't we automatically bring only those
     days instead of all") the missing days the From Tally tab lists are queued by themselves (tally_fill_request: owner or
     staff; never a day done in the last 6 hours, so asking again walks nothing twice) and brought through the check; a
     full-year "Bring books from Tally" (tally_period_choose_lean) sets aside the days FinCom already holds (held) or whose
     last Tally list matches (matched) and walks only the rest ("365 days: 9 already in FinCom, 356 to bring"); a day whose
     list differs is walked; the computer's office hours for the honest pace.
RED_WITHOUT_135=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql", "migration-63-recorder-repeat.sql",
                                           "migration-98-period-pull.sql", "migration-133-fetch-check.sql")]
M = os.environ.get("M135_FILE") or os.path.join(SQLDIR, "migration-135-check-changes.sql")
RED = os.environ.get("RED_WITHOUT_135") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, STAFF, VIEWER, OTHER = "99999999-9999-9999-9999-999999999135", "88888888-8888-8888-8888-888888888135", "55555555-5555-5555-5555-555555555135", "55555555-5555-5555-5555-555555555136", "55555555-5555-5555-5555-555555555137", "44444444-4444-4444-4444-444444444135"
B, B2 = "819d4a59-4cee-4bf7-8f8c-000000000135", "819d4a59-4cee-4bf7-8f8c-000000000136"
DV = "dddddddd-0000-4000-8000-000000000135"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599135"
G = lambda mid: CG + "-%08x" % mid
TODAY = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
FY = datetime.date(TODAY.year - (1 if TODAY.month >= 4 else 2), 4, 1)     # last year's FY: every day has begun
FYS = FY.isoformat()
D = lambda n: (FY + datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (FY + datetime.timedelta(days=n)).strftime("%Y%m%d")

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
TABLES = sorted(re.findall(r"create table if not exists public\.(\w+)", text))
APP = ["tally_check_ask_status", "tally_check_request", "tally_fill_request", "tally_period_choose_lean"]
SVC = ["tally_check_next_open"]
HELP = ["tally_book_fetch_of", "tally_check_ask_of", "tally_period_skip_held"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == sorted("alter table public.%s enable row level security;" % t for t in TABLES),
       "0. add-only: no delete from, drop or truncate; the only table changes are the new tables' row security (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(TABLES == ["tally_check_asks", "tally_period_skips"], "0. two new tables (%s)" % TABLES)
    for t in TABLES:
        ok(re.search(r"grant select, insert, update, delete on public\.%s to service_role;" % t, text) is not None, "0. %s carries its own explicit grants (service_role)" % t)
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(APP + SVC + HELP), "0. the new functions (%s)" % FNS)
    ok(not re.search(r"create or replace function public\.(tally_period_(choose|pause|status|status_of|next|next_paced|heads|entries|entries_logged|upload|stop|held|range|half|member|gate|cancel)|tally_ingest_\w+|tally_check_(queue|next|heads|entries|stop|status|status_of|resume|want)|tally_fetch_summary|tally_today_\w+)\s*\(", text), "0. no existing function replaced")

db = pg_stand.start(int(os.environ.get("PG135_PORT") or 31135))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
APPU = lambda s, uid=OWNER: j(s, uid, "authenticated")
def V(mid, alter, d, no=None, typ="Sales", party="Made-up Traders"):
    return {"guid": G(mid), "alter": alter, "type": typ, "no": no or str(mid), "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def LN(mid, amt=118.0, party="Made-up Traders"): return [[G(mid), party, -amt, "", None, []], [G(mid), "Sales", amt, "", None, []]]
def H(mid, alter, typ="Sales"): return [G(mid), mid, alter, typ]
def day(d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
live = lambda mid: db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s and deleted_at is null" % (q(B), q(G(mid))))
REQ = lambda a, b, uid=OWNER, client="c1": APPU("select tally_check_request(%s, %s, %s)::text" % (q(client), q(a) + "::date" if a else "null::date", q(b) + "::date" if b else "null::date"), uid)
def STAT(uid=OWNER, client="c1"):
    r = APPU("select tally_check_ask_status(%s)::text" % (q(client) if client else "null"), uid)
    return next((x for x in r.get("asks") or [] if x.get("book") == B), {}) if isinstance(r, dict) else {}
NEXT = lambda n=3: j("select tally_check_next_open(%s, %s)::text" % (q(B), n))
heads = lambda n, hs, via="day": j("select tally_check_heads(%s, %s, %s, %s)::text" % (q(B), q(D(n)), js(hs), q(via)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'MADE UP CO', %(FY)s, %(FY)s::date - 1), (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2020-04-01', '2020-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'MADE UP CO', '{"choices": {}}'), ('c2', %(F)s, 'NO BOOKS CO', '{"choices": {}}');"""
           % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "X": q(OTHER), "B": q(B), "B2": q(B2), "FY": q(FYS)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch) values (%s, %s, 'MADEUP-PC1', 'kh135', '{}'::jsonb, true) on conflict do nothing;
      insert into tally_companies (firm_id, company, client_id, device_id, book_id) values (%s, 'MADE UP CO', 'c1', %s, %s) on conflict do nothing;""" % (q(DV), q(F), q(F), q(DV), q(B)))
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "135 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    for t in TABLES:
        for rl in ("anon", "authenticated"):
            ok(db.one("select has_table_privilege(%s, 'public.%s', 'select') or has_table_privilege(%s, 'public.%s', 'insert')" % (q(rl), t, q(rl), t)) in ("f", "false"), "0. %s: nothing for %s" % (t, rl))
        ok(all(db.one("select has_table_privilege('service_role', 'public.%s', %s)" % (t, q(p))) in ("t", "true") for p in ("select", "insert", "update", "delete")), "0. %s: service_role reads and writes" % t)
        ok(db.one("select relrowsecurity from pg_class where oid = 'public.%s'::regclass" % t) in ("t", "true"), "0. %s: row security on" % t)
    sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array[%s])" % ", ".join(q(x) for x in APP + SVC + HELP))}
    ex = lambda rl, fn: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig[fn]))) in ("t", "true") if fn in sig else None
    for fn in APP: ok(ex("authenticated", fn) is True and ex("anon", fn) is False, "0. %s: authenticated, not anon" % fn)
    for fn in SVC: ok(ex("service_role", fn) is True and ex("authenticated", fn) is False and ex("anon", fn) is False, "0. %s: service_role only" % fn)
    for fn in HELP: ok(ex("service_role", fn) is False and ex("authenticated", fn) is False and ex("anon", fn) is False, "0. %s: nobody" % fn)

    # the made-up books: days 0..9, one entry each (entry 100+n at AlterID 10+n)
    for n in range(10):
        day(D(n), [V(100 + n, 10 + n, D(n))], LN(100 + n))

    print("== 1. the press")
    ok("not allowed" in str(REQ(D(0), D(9), VIEWER)), "1. a viewer cannot press it")
    o1 = REQ(D(0), D(9), OTHER)
    ok("not allowed" in str(o1) or o1.get("ok") is False, "1. another firm cannot (%s)" % str(o1)[:200])
    ok(db.one("select count(*) from tally_check_days where book_id = %s" % q(B)) == "0", "1. nothing queued by them")
    nb = REQ(D(0), D(9), OWNER, "c2")
    ok(nb.get("ok") is False and "not linked" in str(nb.get("error")), "1. a client with no books from Tally: said (%s)" % nb.get("error"))
    bad = REQ(D(9), D(0))
    ok(bad.get("ok") is False and "before" in str(bad.get("error")), "1. from after to: refused in words (%s)" % bad.get("error"))
    big = REQ(D(0), D(450))
    ok(big.get("ok") is False and "400 days" in str(big.get("error")), "1. more than 400 days: refused in words (%s)" % big.get("error"))
    late = REQ(D(-60), D(-10))
    ok(late.get("ok") is False and "start" in str(late.get("error")), "1. a period before the books start: refused in words (%s)" % late.get("error"))
    r1 = REQ(D(-20), D(9))
    ok(r1.get("ok") is True and r1.get("from") == D8(0) and r1.get("to") == D8(9) and r1.get("days") == 10, "1. cut to the days the books hold: 10 days from the books' start (%s)" % {k: r1.get(k) for k in ("ok", "from", "to", "days", "error")})
    ok(db.one("select count(*) from tally_check_days where book_id = %s and done_at is null" % q(B)) == "10", "1. the 10 days queued for the check")
    r1 = REQ(D(-20), D(9), STAFF)
    ok(r1.get("ok") is True and r1.get("days") == 10, "1. staff may press it")
    n1 = NEXT()
    ok(isinstance(n1, list) and [x.get("day") for x in n1] == [D8(9), D8(8), D8(7)] and all(x.get("fetch") is True and x.get("chosenAt") and x.get("check") for x in n1), "1. handed to the bridge newest first, fetch true, a choice time (%s)" % str(n1)[:300])
    ok("not allowed" in str(APPU("select tally_check_next_open(%s, 3)::text" % q(B))), "1. a signed-in person cannot take the days")

    print("== 2. progress")
    for n in (9, 8, 6, 4, 2):
        heads(n, [H(100 + n, 10 + n)])
    db.sql("update tally_check_days set first_asked_at = now() - interval '4 minutes', asked_at = now() - interval '4 minutes' where book_id = %s" % q(B))
    s2 = STAT()
    ok(s2.get("total") == 10 and s2.get("checked") == 5 and s2.get("waiting") == 5 and s2.get("same") == 5 and s2.get("state") == "checking", "2. checked 5 of 10 days (%s)" % {k: s2.get(k) for k in ("total", "checked", "waiting", "same", "state")})
    ok(s2.get("etaMin") == 4, "2. about 4 min left at 5 days in 4 minutes (%s)" % s2.get("etaMin"))
    ok(s2.get("from") == D8(0) and s2.get("to") == D8(9) and s2.get("client") == "c1" and s2.get("company") == "MADE UP CO", "2. the period and the company (%s)" % {k: s2.get(k) for k in ("from", "to", "client", "company")})

    print("== 3. matched days ticked; changes corrected and listed")
    heads(0, [H(100, 10)]); heads(1, [H(101, 11)])
    h3 = heads(3, [H(103, 20)])
    ok(h3.get("want") == ["103"], "3. day 3: Tally holds the entry at another AlterID: asked for (%s)" % h3)
    e3 = j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(B), q(D(3)), js([V(103, 20, D(3), no="S-103")]), js(LN(103, 150.0))))
    ok(e3.get("updated") == 1 and e3.get("done") is True, "3. day 3 brought up to date (%s)" % e3)
    h5 = heads(5, [H(105, 15), H(150, 30)])
    ok(h5.get("want") == ["150"], "3. day 5: an entry Tally has and FinCom lacks: asked for (%s)" % h5)
    e5 = j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(B), q(D(5)), js([V(150, 30, D(5), no="S-150", party="New Party")]), js(LN(150, 60.0, "New Party"))))
    ok(e5.get("added") == 1 and e5.get("done") is True, "3. day 5 added (%s)" % e5)
    h7 = heads(7, [])
    ok(h7.get("done") is False and live(107) == "1", "3. day 7: an entry Tally no longer lists is not removed on the first list")
    db.sql("update tally_check_days set gone1_at = now() - interval '2 minutes' where book_id = %s and day = %s" % (q(B), q(D(7))))
    h7 = heads(7, [])
    ok(h7.get("removed") == 1 and live(107) == "0" and db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(107)))) == "1", "3. the second whole-day list a minute on: soft-deleted, the row kept (%s)" % h7)
    s3 = STAT()
    ok(s3.get("state") == "done" and s3.get("checked") == 10 and s3.get("waiting") == 0 and s3.get("same") == 7 and s3.get("fixed") == 3, "3. done: 7 days already matched, 3 corrected (%s)" % {k: s3.get(k) for k in ("state", "checked", "waiting", "same", "fixed")})
    ok(s3.get("added") == 1 and s3.get("changed") == 1 and s3.get("deleted") == 1, "3. 1 added, 1 changed, 1 deleted (%s)" % {k: s3.get(k) for k in ("added", "changed", "deleted")})
    rows = s3.get("rows") or []
    ok(len(rows) == 3 and sorted(r.get("what") for r in rows) == ["added", "changed", "deleted"], "3. the list: 3 rows, the counts its own (%s)" % [r.get("what") for r in rows])
    ra = next((r for r in rows if r.get("what") == "added"), {})
    ok(ra.get("day") == D(5) and ra.get("vtype") == "Sales" and ra.get("vno") == "S-150" and ra.get("party") == "New Party" and float(ra.get("amount") or 0) == 60.0, "3. a row: date, voucher type and number, party, amount (%s)" % ra)
    rd = next((r for r in rows if r.get("what") == "deleted"), {})
    ok(rd.get("day") == D(7) and rd.get("vno") == "107", "3. the deleted entry listed from its kept history (%s)" % rd)
    ok(not STAT(STAFF, None) == {} and STAT(STAFF, None).get("rows") is None, "3. the firm's list of presses (no client) carries no rows")

    print("== 4. nothing changed")
    r4 = REQ(D(0), D(2))
    ok(r4.get("ok") is True and r4.get("days") == 3, "4. a fresh press over 3 days (%s)" % {k: r4.get(k) for k in ("ok", "days", "error")})
    s4 = STAT()
    ok(s4.get("state") != "done" and s4.get("waiting") == 3 and s4.get("total") == 3, "4. 3 days waiting (%s)" % {k: s4.get(k) for k in ("state", "waiting", "total")})
    for n in (0, 1, 2): heads(n, [H(100 + n, 10 + n)])
    s4 = STAT()
    ok(s4.get("state") == "done" and s4.get("same") == 3 and s4.get("rows") == [] and s4.get("added") == 0 and s4.get("changed") == 0 and s4.get("deleted") == 0,
       "4. no changes: FinCom matches Tally; the earlier press's changes not counted (%s)" % {k: s4.get(k) for k in ("state", "same", "rows", "added")})

    print("== 5. Bring books from Tally running, paused, stopped")
    pc = APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(FYS)))
    pca = db.one("select to_jsonb(chosen_at) #>> '{}' from tally_period_pulls where book_id = %s" % q(B))
    r5 = REQ(D(0), D(2))
    ok(r5.get("ok") is True and r5.get("after") is True, "5. a running Bring books from Tally: the press waits for it (after: %s)" % r5.get("after"))
    n5 = NEXT()
    ok(isinstance(n5, list) and n5 and all(x.get("chosenAt") == pca for x in n5), "5. its days under the period's choice time (one stop rule) (%s)" % str(n5)[:200])
    APPU("select tally_period_pause(%s, true)::text" % q(B))
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    ok(NEXT() == [] and STAT().get("paused") is True, "5. the period paused: none handed out, said")
    APPU("select tally_period_pause(%s, false)::text" % q(B))
    APPU("select tally_period_cancel(%s)::text" % q(B))
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    ok(j("select tally_check_next(%s, 3)::text" % q(B)) == [], "5. (133's own next: none while the period is stopped)")
    REQ(D(0), D(2))
    n5b = NEXT()
    ok(isinstance(n5b, list) and len(n5b) == 3 and all(x.get("chosenAt") and x.get("chosenAt") != pca for x in n5b), "5. the period stopped by the person: a press hands the days out under a new choice time (%s)" % str(n5b)[:200])
    ca = n5b[0].get("chosenAt") if isinstance(n5b, list) and n5b else None
    st = j("select tally_check_stop(%s, %s, 'window', %s, %s::timestamptz)::text" % (q(B), q(D(2)), q("Tally stopped answering."), q(ca)))
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    s5 = STAT()
    ok(st.get("stopped") is True and NEXT() == [] and (s5.get("run") or {}).get("state") == "stopped", "5. the bridge stopped it (Tally busy): nothing handed out, said (%s)" % s5.get("run"))
    REQ(D(0), D(2))
    n5c = NEXT()
    ok(isinstance(n5c, list) and len(n5c) == 3 and all(x.get("chosenAt") != ca for x in n5c), "5. the next press goes on under a new choice time")
    APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(FYS)))
    j("select tally_check_stop(%s, %s, 'window', 'x', (select chosen_at from tally_period_pulls where book_id = %s))::text" % (q(B), q(D(2)), q(B)))
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    ok(NEXT() == [], "5. the bridge stopped the period: the check waits too")
    REQ(D(0), D(2))
    n5d = NEXT()
    ok(isinstance(n5d, list) and len(n5d) >= 1, "5. a press after the bridge's stop hands the days out again (%s)" % str(n5d)[:200])

    print("== 6. never after today; who sees it")
    fut = REQ(D(300), (TODAY.date() + datetime.timedelta(days=40)).isoformat(), STAFF)
    ok(fut.get("ok") is True and fut.get("to") == TODAY.strftime("%Y%m%d") and fut.get("days") == (TODAY.date() - FY).days - 300 + 1, "6. a period past today ends today (%s)" % {k: fut.get(k) for k in ("to", "days", "error")})
    ok(STAT(VIEWER).get("book") == B, "6. a viewer of the firm sees it")
    ok(STAT(OTHER) == {} and STAT(OTHER, None) == {}, "6. another firm never")
    ok("not allowed" in str(APPU("select tally_check_ask_status('c1')::text", "00000000-0000-0000-0000-000000000135")), "6. someone of no firm: not allowed")

    print("== 7. the missing days by themselves; a full-year bring that walks only what FinCom lacks")
    FILL = lambda days, uid=OWNER: APPU("select tally_fill_request('c1', array[%s]::date[])::text" % ", ".join(q(d) for d in days), uid)
    BK = lambda uid=OWNER: next((x for x in (APPU("select tally_check_ask_status(null)::text", uid).get("books") or []) if x.get("book") == B), {})
    ok("not allowed" in str(FILL([D(20)], VIEWER)), "7. a viewer cannot queue the missing days")
    f7 = FILL([D(20), D(21), D(9)])
    ok(f7.get("ok") is True and f7.get("queued") == 2, "7. the missing days queued, a day checked a moment ago left alone (%s)" % {k: f7.get(k) for k in ("ok", "queued", "error")})
    ok((BK().get("fill") or {}).get("waiting") == 2, "7. the progress line's numbers (%s)" % BK().get("fill"))
    heads(20, [H(2000, 70)])
    j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(B), q(D(20)), js([V(2000, 70, D(20))]), js(LN(2000))))
    heads(21, [])
    fl = BK().get("fill") or {}
    ok(fl.get("waiting") == 0 and fl.get("done") == 2 and fl.get("added") == 1, "7. brought: 2 days, 1 entry added (%s)" % fl)
    ok(FILL([D(20), D(21)]).get("queued") == 0, "7. asked again: nothing walked twice")
    # day 8: Tally's last list (a check) names an entry FinCom lacks: not set aside
    db.sql("update tally_check_days set heads = heads || %s, listed_at = now() where book_id = %s and day = %s" % (js([H(180, 5)]), q(B), q(D(8))))
    l7 = APPU("select tally_period_choose_lean(%s, %s, 'year')::text" % (q(B), q(FYS)))
    lean = l7.get("lean") or {}
    ok(l7.get("ok") is True and (l7.get("pull") or {}).get("state") == "going" and l7.get("setAside") == 9, "7. the year chosen; 9 days FinCom holds set aside (%s)" % {k: l7.get(k) for k in ("ok", "setAside", "error")})
    try: why = {r["d"]: r["why"] for r in db.rows("select to_char(day, 'YYYYMMDD') d, why from tally_period_skips where book_id = %s" % q(B))}
    except RuntimeError: why = {}
    ok(why.get(D8(0)) == "held" and why.get(D8(3)) == "matched" and why.get(D8(20)) == "matched" and D8(8) not in why and D8(7) not in why, "7. held (no Tally list known) and matched (Tally's last list the same); day 8 (differs) and day 7 (none left) walked (%s)" % why)
    ydays = (min(datetime.date(FY.year + 1, 3, 31), TODAY.date()) - FY).days + 1
    ok(lean.get("days") == ydays and lean.get("already") == 9 and lean.get("toBring") == ydays - 9, "7. %d days: 9 already in FinCom, %d to bring (%s)" % (ydays, ydays - 9, lean))
    nx = j("select tally_period_next_paced(%s, 30, true)::text" % q(B))
    got = [x.get("day") for x in nx] if isinstance(nx, list) else []
    ok(db.one("select count(*) from tally_period_days where book_id = %s and day = %s and tally_n is not null" % (q(B), q(D(8)))) == "0" and len(got) == 30, "7. day 8 left for Bring books to walk (%s)" % got[:3])
    ok(not set(got) & set(why), "7. never a day set aside (%s)" % sorted(set(got) & set(why)))
    hrs = BK(VIEWER).get("hours") or {}
    ok(hrs.get("from") == 20 and hrs.get("to") == 8 and hrs.get("sunday") is True, "7. the computer's office hours, for the honest pace (%s)" % hrs)
    ok("not allowed" in str(APPU("select tally_period_choose_lean(%s, %s, 'year')::text" % (q(B), q(FYS)), VIEWER)), "7. a viewer cannot start it")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
