"""python3 run_migration182.py - migration-182-gap-after-post (13-Nov-2026, branch next-fix-gap-after-post). Staging,
13-Nov-2026, Client CL: FinCom posted 42 bank entries dated in October (Tally's AlterIDs 42873 to 42915); the posting
window's credit closed the gap as a match though none was matched or read back; Tally's number then went to 43025 (110
changes on older dates); the page asked for the Day Book of 12-Nov to 13-Nov (empty in Tally); October was counted 0 on
07-Nov and never counted again; the gap read was held by an old over2s stop and given up after 6 hours; the "checking"
flag went stale.
On a throwaway PostgreSQL (pg_stand, port 31182 unless PG182_PORT; never a real database), built as run_migration160.py
builds it, then 160 and 182 (twice). Made-up books only (a few entries each). Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (the one table change is the new table's row security), names
     no real database; the new table's grants (service_role only); the functions for service_role only (the triggers' for
     nobody); runs twice.
  1. (A) a posting done queues its entries' days (by the voucher's date) for a read back, source 'post' (a day read
     already: read again; a day given up: left); the window credits only entries matched or read back: the gap stays open
     ("3 of FinCom's posted entries not read back"), checking; the read back brings them in and the gap closes as a match.
  2. (B) the gap read: posted days first, then the gap's own days; a check stopped over2s more than an hour ago is tried
     again at night only, under its own choice time; the bridge's stop of that retry stops the retry only (not the check,
     not the period), tried again 6 hours on with a new choice time; not for a stop of another kind or a recent one; a gap
     open more than 6 hours is read at night (not by day), not given up.
  3. (C) a day of the gap read whole after Tally's number was seen is not asked again; the gap then says "Changes were
     made in Tally on older dates. Upload the Day Book from <first day of the book's year, or its from_date> to today".
  4. (B) 98's period count: a book whose gap's own days match has the days counted before the gap counted again (fetch
     false), once; a day whose new count FinCom lacks is then brought in (fetch true); none before the gap's days match.
  5. (D) the gap's checking is worked out at each write with checkUntil (an hour on): true for a gap open 7 hours that is
     still read at night; false for a check stopped for another reason, or a retry stopped.
RED_WITHOUT_182=1: the same checks without the file (they fail; those marked (guard) hold what stays as it was and (step) the steps between, and pass)."""
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
                                           "migration-67-recorder-renumbered.sql", "migration-92-settle-unnamed-deletes.sql", "migration-98-period-pull.sql", "migration-133-fetch-check.sql")]
AFTER = [os.path.join(SQLDIR, f) for f in ("migration-135-check-changes.sql", "migration-136-held-settle.sql", "migration-137-held-status-online.sql", "migration-150-gap-closed-by-days.sql",
                                           "migration-158-held-delete-fast.sql", "migration-160-gap-read-close.sql")]
M = os.environ.get("M182_FILE") or os.path.join(SQLDIR, "migration-182-gap-after-post.sql")
RED = os.environ.get("RED_WITHOUT_182") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999182"
BK = {k: "819d4a59-4cee-4bf7-8f8c-00000000%d182" % k for k in range(1, 9)}
CG = {k: "b20abc61-0000-4000-8000-79149af7%d182" % k for k in range(1, 9)}
DV = "dddddddd-0000-4000-8000-000000000182"
BR = "go-aaaaaa182182"
G = lambda mid, cg: cg + "-%08x" % mid
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
D = lambda n: (TODAY - datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (TODAY - datetime.timedelta(days=n)).strftime("%Y%m%d")
DMY = lambda d: d.strftime("%d-%b-%Y")

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
NEW_FNS = ["tally_gap_own_read", "tally_gap_state", "tally_post_job_read_back"]
REPLACED = ["tally_recorder_gap_check", "tally_period_next_paced", "tally_check_stop", "tally_gap_front", "tally_sync_cursor_gap_checking"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_gap_retries enable row level security;"], "0. add-only (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_gap_retries"], "0. one new table")
    ok("grant select, insert, update, delete on public.tally_gap_retries to service_role;" in text, "0. its own explicit grants (service_role)")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(NEW_FNS + REPLACED), "0. the functions (%s)" % FNS)
    for fn, sig in (("tally_recorder_gap_check", "(uuid, uuid, bigint, timestamptz)"), ("tally_period_next_paced", "(uuid, integer, boolean)"), ("tally_check_stop", "(uuid, date, text, text, timestamptz)"),
                    ("tally_gap_front", "(uuid, integer, boolean), public.tally_gap_front(uuid, integer)")):
        ok(("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "0. %s: its grant restated" % fn)

db = pg_stand.start(int(os.environ.get("PG182_PORT") or 31182))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def V(guid, alter, d, typ="Payment", no="1", fid=None):
    return {"guid": guid, "alter": alter, "type": typ, "no": no, "party": "Made-up Traders", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": fid, "day": d}
def LN(guid, amt=118.0): return [[guid, "Made-up Traders", -amt, "", None, []], [guid, "Bank", amt, "", None, []]]
def LNS(vs): return [x for v in vs for x in LN(v["guid"])]
def day(book, d, vouchers):
    return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(LNS(vouchers)), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def H(guid, mid, alter, typ="Payment"): return [guid, mid, alter, typ]
def cday(book, n): return (db.rows("select source, (done_at is not null) as done, (upload_at is not null) as up, lists from tally_check_days where book_id = %s and day = %s" % (q(book), q(D(n)))) or [{}])[0]
HEADS = lambda book, n, hs: j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(book), q(D(n)), js(hs)))
ENTRIES = lambda book, n, vs: j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(book), q(D(n)), js(vs), js(LNS(vs))))
def gap(book, alt):
    r = j("select tally_recorder_gap_check(%s, %s, %d, now())::text" % (q(book), q(DV), alt))
    c = db.rows("select gap is null as closed, match_alter, gap::text as gap from tally_sync_cursor where book_id = %s" % q(book))[0]
    c["g"] = json.loads(c["gap"]) if c.get("gap") else {}
    return r, c
def FRONT(book, mx=3, night=None):
    r = j("select tally_gap_front(%s, %d)::text" % (q(book), mx)) if night is None else j("select tally_gap_front(%s, %d, %s)::text" % (q(book), mx, "true" if night else "false"))
    return r if isinstance(r, list) else [{"_error": r}]
days_of = lambda fr: [x.get("day") for x in fr]
def age_gap(book, minutes): db.sql("update tally_sync_cursor set gap_at = now() - interval '%d minutes' where book_id = %s" % (minutes, q(book)))
def unask(book): db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))

# a made-up book: the starting point 42868, matched at 42872 13 minutes ago (a Receipt of yesterday in the copy at 42872),
# the check going; Tally's number then moves (gap(book, n))
def gapbook(k, from_date=None):
    book, cg = BK[k], CG[k]
    if from_date: db.sql("update tally_books set from_date = %s where book_id = %s" % (q(from_date), q(book)))
    db.sql("""insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid, company_guid, recorder_max_alter, recorder_last_at, last_match_at, match_at, match_alter, match_start)
              values (%(B)s, %(F)s, 42868, now() - interval '4 days', %(CG)s, %(CG)s, 42872, now() - interval '14 minutes', now() - interval '13 minutes', now() - interval '13 minutes', 42872, null);
              update tally_sync_cursor set match_start = start_at where book_id = %(B)s;
              insert into tally_check_runs (book_id, firm_id) values (%(B)s, %(F)s) on conflict do nothing""" % {"B": q(book), "F": q(F), "CG": q(cg)})
    day(book, D(1), [V(G(26523, cg), 42872, D(1), "Receipt", "480")])
    return book, cg
JOBN = [0]
def posting(k, vouchers, a0, a1, accepted=True):
    """a posting of FinCom's (made-up ids FC-k-i), its window a0..a1, the ids accepted; done afterwards (the trigger)"""
    book, cg = BK[k], CG[k]; JOBN[0] += 1
    jid = "00000000-0000-4000-8000-%012d" % (182000 + JOBN[0])
    pl = {"vouchers": [{"id": fid, "xml": "<VOUCHER><DATE>%s</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER></VOUCHER>" % (d8, fid)} for fid, d8 in vouchers]}
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c%d', 'MADE UP %d', %s, %d, 'running')" % (q(jid), q(F), k, k, js(pl), len(vouchers)))
    for fid, d8 in vouchers:
        db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, accepted_at) values (%s, 'c%d', %s, %s, %s, %s)" % (q(F), k, q(fid), q(jid), q(fid), "now()" if accepted else "null"))
    db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, company_guid) values (%s, %s, %s, %s, %d, %d, %d, %s)" % (q(F), q(book), q(jid), q(DV), a0, a1, len(vouchers), q(cg)))
    return jid
def done(jid): db.sql("update tally_post_jobs set status = 'done' where id = %s" % q(jid))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing;" % q(F))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for k, b in BK.items():
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c%d', 'MADE UP %d', %s, %s);"
               "insert into clients (id, firm_id, name, data) values ('c%d', %s, 'MADE UP %d', '{\"choices\": {}}')" % (q(b), q(F), k, k, q(FY.isoformat()), q((FY - datetime.timedelta(days=1)).isoformat()), k, q(F), k))
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh182', '{}'::jsonb, true, now()) on conflict do nothing;""" % (q(DV), q(F)))
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "182 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    if text:
        ok(db.one("select has_table_privilege('authenticated', 'public.tally_gap_retries', 'select') or has_table_privilege('anon', 'public.tally_gap_retries', 'select')") in ("f", "false"), "0. tally_gap_retries: nothing for anon or authenticated")
        ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_gap_retries'::regclass") in ("t", "true"), "0. tally_gap_retries: row security on")
        sig = {}
        for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array[%s])" % ", ".join(q(x) for x in NEW_FNS + REPLACED)):
            sig.setdefault(r["proname"], []).append(r["sig"])
        ex = lambda rl, s: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(s))) in ("t", "true")
        for fn in ("tally_gap_own_read", "tally_gap_state", "tally_gap_front", "tally_recorder_gap_check", "tally_period_next_paced", "tally_check_stop"):
            ok(fn in sig and all(ex("service_role", s) and not ex("authenticated", s) and not ex("anon", s) for s in sig[fn]), "0. %s: service_role only (%s)" % (fn, sig.get(fn)))
        ok(len(sig.get("tally_gap_front", [])) == 2, "0. tally_gap_front: 160's arguments and the night's")
        for fn in ("tally_sync_cursor_gap_checking", "tally_post_job_read_back"):
            ok(fn in sig and not any(ex(rl, s) for rl in ("service_role", "authenticated", "anon") for s in sig[fn]), "0. the trigger's function %s: nobody" % fn)

    print("== 1. (A) a posting done: its days read back; counted only once matched or read back")
    book, cg = gapbook(1)
    db.sql("""insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
              values (%(B)s, %(F)s, %(d41)s, 'upload', now() - interval '3 days', 1, 0, '[]'::jsonb, 'day', now() - interval '3 days', true, now() - interval '3 days'),
                     (%(B)s, %(F)s, %(d42)s, 'upload', now() - interval '3 days', 6, 0, '[]'::jsonb, 'day', now() - interval '3 days', null, null)""" % {"B": q(book), "F": q(F), "d41": q(D(41)), "d42": q(D(42))})
    db.sql("update tally_check_days set upload_at = now() - interval '3 days', upload_words = 'upload it' where book_id = %s and day = %s" % (q(book), q(D(42))))
    jid = posting(1, [("FC-1-1", D8(40)), ("FC-1-2", D8(41)), ("FC-1-3", D8(41)), ("FC-1-4", D8(42))], 42872, 42876)
    ok(cday(book, 40) == {}, "1. (guard) nothing queued while the posting runs")
    done(jid)
    ok(cday(book, 40).get("source") == "post" and cday(book, 40).get("done") == "f", "1. the posting done: its entries' day queued for a read back, source 'post' (%s)" % cday(book, 40))
    ok(cday(book, 41).get("source") == "post" and cday(book, 41).get("done") == "f" and cday(book, 41).get("lists") == "0", "1. a day read already: read again (%s)" % cday(book, 41))
    ok(cday(book, 42).get("source") == "upload" and cday(book, 42).get("up") == "t", "1. (guard) a day given up (to upload): left (%s)" % cday(book, 42))
    r, c = gap(book, 42876)
    ok(c["closed"] == "f" and r.get("missing") == 4, "1. Tally's number 42876: none of the 4 matched or read back: the gap stays open, 4 missing (%s)" % (r.get("missing"), ))
    ok("4 of FinCom's posted entries not read back from Tally yet" in (c["g"].get("words") or ""), "1. said plainly (%s)" % c["g"].get("words"))
    ok(c["g"].get("checking") is True and bool(c["g"].get("checkUntil")), "1. checking (the posted days are read back by FinCom itself), with checkUntil (%s)" % ({k: c["g"].get(k) for k in ("checking", "checkUntil")}, ))
    v1 = [V(G(27001, cg), 42873, D(40), "Payment", "P1", "FC-1-1")]
    v2 = [V(G(27002, cg), 42874, D(41), "Payment", "P2", "FC-1-2"), V(G(27003, cg), 42875, D(41), "Payment", "P3", "FC-1-3")]
    h = HEADS(book, 41, [H(v["guid"], int(v["guid"][-8:], 16), v["alter"]) for v in v2])
    ok(sorted(h.get("want") or []) == ["27002", "27003"], "1. the read back of the 41st day: both wanted (%s)" % h)
    e = ENTRIES(book, 41, v2)
    ok(e.get("done") is True, "1. brought in (%s)" % e)
    r, c = gap(book, 42876)
    ok(c["closed"] == "f" and r.get("missing") == 2 and "2 of FinCom's posted entries not read back" in (c["g"].get("words") or ""), "1. two read back: 2 missing still (%s)" % r.get("missing"))
    HEADS(book, 40, [H(v["guid"], int(v["guid"][-8:], 16), v["alter"]) for v in v1]); ENTRIES(book, 40, v1)
    db.sql("update tally_post_ids set matched_at = now(), matched_alter = 42876 where fincom_id = 'FC-1-4'")
    r, c = gap(book, 42876)
    ok(c["closed"] == "t" and r.get("matched") is True and c["match_alter"] == "42876" and r.get("accounted") == 4, "1. three read back and one matched: closed as a match, the 4 accounted (%s)" % r)

    print("== 2. (B) the gap read: posted days first; an old over2s stop retried at night only")
    book, cg = gapbook(2)
    jid = posting(2, [("FC-2-1", D8(40)), ("FC-2-2", D8(41))], 42872, 42874); done(jid)
    r, c = gap(book, 42874)
    age_gap(book, 3); unask(book)
    fr = FRONT(book)
    ok(days_of(fr)[:3] == [D8(40), D8(41), D8(0)] and all(x.get("check") is True and x.get("fetch") is True for x in fr), "2. the posted days first (newest first), then the gap's own day (%s)" % days_of(fr))
    book, cg = gapbook(3)
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at) values (%s, %s, %s, 'year', 'going', now() - interval '6 days')" % (q(book), q(F), q(FY.isoformat())))
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now() - interval '2 hours', stop_why = 'over2s', chosen_at = now() - interval '3 days' where book_id = %s" % q(book))
    r, c = gap(book, 42873); age_gap(book, 3); unask(book)
    rc, pc = db.one("select chosen_at::text from tally_check_runs where book_id = %s" % q(book)), db.one("select chosen_at::text from tally_period_pulls where book_id = %s" % q(book))
    ok(FRONT(book, 3, False) == [], "2. the check stopped over2s 2 hours ago: by day, none")
    fr = FRONT(book, 3, True)
    ca = (fr[0].get("chosenAt") if fr and isinstance(fr[0], dict) else None)
    ok(days_of(fr) == [D8(0)] and fr[0].get("retry") is True and ca and ca != rc and ca != pc, "2. at night: the gap's day, a retry under its own choice time (%s)" % fr)
    st = j("select tally_check_stop(%s, %s, 'over2s', 'Tally took too long', %s)::text" % (q(book), q(D(0)), q(ca or "2000-01-01")))
    ok(st.get("retry") is True and db.one("select state || ' ' || (stopped_at < now() - interval '1 hour')::text from tally_check_runs where book_id = %s" % q(book)) == "stopped true"
       and db.one("select state from tally_period_pulls where book_id = %s" % q(book)) == "going", "2. the bridge's over2s stop of the retry: the retry stops, not the check, not the period (%s)" % st)
    unask(book)
    ok(FRONT(book, 3, True) == [], "2. the retry stopped: not again that night")
    if text: db.sql("update tally_gap_retries set stopped_at = now() - interval '7 hours' where book_id = %s" % q(book))
    fr = FRONT(book, 3, True)
    ok(days_of(fr) == [D8(0)] and fr[0].get("chosenAt") not in (ca, rc, pc), "2. 6 hours on, at night: tried again, a new choice time (%s)" % fr)
    unask(book)
    db.sql("update tally_check_runs set stop_why = 'window' where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "2. (guard) a check stopped for another reason: none")
    db.sql("update tally_check_runs set stop_why = 'over2s', stopped_at = now() - interval '10 minutes' where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "2. (guard) an over2s stop 10 minutes old: none")
    book, cg = gapbook(4)
    r, c = gap(book, 42873); age_gap(book, 7 * 60); unask(book)
    ok(FRONT(book, 3, False) == [] and days_of(FRONT(book, 3, True)) == [D8(0)], "2. a gap open 7 hours: read at night, not by day")

    print("== 3. (C) the gap's own days match: not asked again; the page's words")
    book, cg = gapbook(5)
    r, c = gap(book, 42873); age_gap(book, 3); unask(book)
    ok(days_of(FRONT(book)) == [D8(0)], "3. (step) the gap's own day read")
    h = HEADS(book, 0, [])
    ok(h.get("done") is True, "3. (step) Tally's Day Book of it matches FinCom")
    unask(book)
    ok(FRONT(book) == [], "3. 15 minutes on, Tally's number not moved: not asked again (%s)" % FRONT(book))
    r, c = gap(book, 42873)
    o = c["g"].get("older") or {}
    ok(c["closed"] == "f" and c["g"].get("checking") is False and o.get("from") == FY.isoformat() and o.get("say") == "Changes were made in Tally on older dates."
       and o.get("fix") == "Upload the Day Book from %s to today." % DMY(FY), "3. the gap says: changes on older dates, the Day Book from the first day of the book's year (%s)" % o)
    later = FY + datetime.timedelta(days=60)
    book, cg = gapbook(6, from_date=later.isoformat())
    r, c = gap(book, 42873); age_gap(book, 3); unask(book); FRONT(book); HEADS(book, 0, []); r, c = gap(book, 42873)
    ok((c["g"].get("older") or {}).get("from") == later.isoformat(), "3. a book that begins later: from its first day (%s)" % c["g"].get("older"))

    print("== 4. (B) 98's period count: the days counted before the gap counted again, once")
    book, cg = gapbook(7)
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at) values (%s, %s, %s, 'year', 'going', now() - interval '6 days')" % (q(book), q(F), q(FY.isoformat())))
    db.sql("""insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at, done_at)
              select %s, %s, g::date, 0, 0, '[]'::jsonb, 'day', now() - interval '6 days', now() - interval '6 days' from generate_series(%s::date, %s::date, interval '1 day') g""" % (q(book), q(F), q(FY.isoformat()), q(D(0))))
    PN = lambda: (lambda r: r if isinstance(r, list) else [{"_error": r}])(j("select tally_period_next_paced(%s, 3, false)::text" % q(book)))
    ok(PN() == [], "4. (guard) the year counted, no gap: nothing")
    r, c = gap(book, 42873); age_gap(book, 3)
    ok(PN() == [], "4. (guard) a gap whose own days are not read yet: nothing counted again")
    unask(book); FRONT(book); HEADS(book, 0, [])
    pn = PN()
    ok(days_of(pn) == [D8(0), D8(1), D8(2)] and all(x.get("fetch") is False for x in pn), "4. the gap's own days match: the days counted before the gap counted again, newest first (%s)" % days_of(pn))
    db.sql("update tally_period_days set counted_at = now() where book_id = %s and day <> %s" % (q(book), q(D(40))))
    ok(days_of(PN()) == [D8(40)], "4. each once: the one left")
    nv = V(G(27100, cg), 42873, D(40), "Journal", "J1")
    ph = j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(book), q(D(40)), js([H(nv["guid"], 27100, 42873, "Journal")])))
    ok(ph.get("done") is False, "4. (step) its new count: an entry FinCom lacks (%s)" % ph)
    pn = PN()
    ok(days_of(pn) == [D8(40)] and pn[0].get("fetch") is True, "4. (guard: 98's own) then brought in (fetch) (%s)" % pn)

    print("== 5. (D) checking worked out at each write, with checkUntil")
    book, cg = gapbook(8)
    r, c = gap(book, 42873); age_gap(book, 7 * 60)
    r, c = gap(book, 42873)
    cu = c["g"].get("checkUntil")
    fut = cu and db.one("select (%s::timestamptz > now() + interval '50 minutes')::text" % q(cu)) == "true"
    ok(c["g"].get("checking") is True and fut, "5. a gap open 7 hours, still read at night: checking, until an hour on (%s, %s)" % (c["g"].get("checking"), cu))
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now() - interval '2 hours', stop_why = 'over2s' where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True, "5. a check stopped over2s: still checking (retried at night)")
    db.sql("insert into tally_gap_retries (book_id, firm_id, chosen_at, stopped_at, stop_why) values (%s, %s, now() - interval '1 hour', now() - interval '30 minutes', 'over2s')" % (q(book), q(F))) if text else None
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False and "checkUntil" not in c["g"], "5. (guard) its retry stopped too: not checking, the upload asked (%s)" % c["g"].get("checking"))
    db.sql("update tally_check_runs set stop_why = 'window' where book_id = %s" % q(book))
    db.sql("delete from tally_gap_retries where book_id = %s" % q(book)) if text else None
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False, "5. (guard) a check stopped for another reason: not checking")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
