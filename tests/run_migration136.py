"""python3 run_migration136.py - migration-136-held-settle (02-Nov-2026, branch next-held-settle). The owner, 31-Oct-2026: one
"Needs you" row per day for lines held after his Day Book upload ("I have updated the books now, why am I getting this ...
after the update it should close the error"). 136 queues a day with held lines for 133's day check by itself and settles the
lines when the check of the day is done (or when a Day Book of the day is stored after them). On a throwaway PostgreSQL
(pg_stand, port 31136; never a real database), built as run_migration135.py builds it, plus 67 and 92, then 135 and 136.
Made-up books only. Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate; the only table change is the
     new table's row security; no existing function replaced), names no real database; runs twice; the new table's own
     grants (service_role only); tally_held_status for authenticated (not anon); the helpers for nobody.
  1. (once) a line held before 136 whose day Tally already listed after it, at the AlterID FinCom holds (the owner's book):
     settled when 136 runs, "checked against Tally"; a GUID-less delete of that day: its first read recorded, the day queued
     again for the second.
  2. a held line queues its day by itself (source 'held'), handed to the bridge by 135's tally_check_next_open.
  3. the day check done: an 'altered' line Tally lists at the AlterID FinCom holds -> 'duplicate' ("already in the books:
     checked against Tally"); one at or below the copy's AlterID -> settled; one Tally lists at another AlterID -> held
     (the check brings it first).
  4. a GUID-less delete: not settled on the first whole-day list (the day asked again), nor on a second list less than a
     minute after; settled on a second whole-day list a minute or more after ("read twice").
  5. an upload: a Day Book stored after lines that arrived after an earlier upload settles them (the GUID-less delete by 92,
     the 'altered' line by 136).
  6. a renumbering alert on a computer's beat queues its days; tally_held_status says it is checked once every day from
     its first day to its own is listed whole after it.
  7. tally_held_status: the firm's members see the held lines, their days and the check's progress; another firm nothing.
  8. (137, after 136 ran on staging) the check is 'off' unless a computer with "read older entries" on was seen in the last
     10 minutes; why: 'offline' (on, not connected) or 'switch' (on nowhere).
RED_WITHOUT_136=1: the same checks without the file (they fail)."""
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
M135 = os.path.join(SQLDIR, "migration-135-check-changes.sql")
M = os.environ.get("M136_FILE") or os.path.join(SQLDIR, "migration-136-held-settle.sql")
M137 = os.path.join(SQLDIR, "migration-137-held-status-online.sql")
RED = os.environ.get("RED_WITHOUT_136") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, VIEWER, OTHER = "99999999-9999-9999-9999-999999999136", "88888888-8888-8888-8888-888888888136", "55555555-5555-5555-5555-555555555136", "55555555-5555-5555-5555-555555555137", "44444444-4444-4444-4444-444444444136"
B, B2 = "819d4a59-4cee-4bf7-8f8c-000000000136", "819d4a59-4cee-4bf7-8f8c-000000000137"
DV = "dddddddd-0000-4000-8000-000000000136"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599136"
G = lambda mid: CG + "-%08x" % mid
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
START = TODAY - datetime.timedelta(days=40)
D = lambda n: (START + datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (START + datetime.timedelta(days=n)).strftime("%Y%m%d")

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
TABLES = sorted(re.findall(r"create table if not exists public\.(\w+)", text))
APP = ["tally_held_status"]
HELP = ["tally_held_line_ours", "tally_held_settle_day", "tally_held_queue_of", "tally_held_renumber_of", "tally_held_queue_renumber",
        "tally_recorder_lines_held_queue", "tally_devices_renumber_queue", "tally_check_days_held_settle", "tally_days_held_settle"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_held_reads enable row level security;"], "0. add-only (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(TABLES == ["tally_held_reads"], "0. one new table (%s)" % TABLES)
    ok("grant select, insert, update, delete on public.tally_held_reads to service_role;" in text, "0. its own explicit grants (service_role)")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(APP + HELP), "0. the new functions (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG136_PORT") or 31136))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
APPU = lambda s, uid=OWNER: j(s, uid, "authenticated")
def V(mid, alter, d, no=None):
    return {"guid": G(mid), "alter": alter, "type": "Sales", "no": no or str(mid), "party": "Made-up Traders", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def LN(mid, amt=118.0): return [[G(mid), "Made-up Traders", -amt, "", None, []], [G(mid), "Sales", amt, "", None, []]]
def H(mid, alter): return [G(mid), mid, alter, "Sales"]
def day(d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
heads = lambda n, hs: j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(n)), js(hs)))
NEXT = lambda n=10: j("select tally_check_next_open(%s, %s)::text" % (q(B), n))
WAIT = "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book"
NOG = lambda d: "no entry GUID on the line: FinCom cannot tell which entry was deleted, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date" % d
def held(lid, ev, n, mid=None, alter=None, ago_min=30):
    guid = G(mid) if mid else None
    why = WAIT if ev != "deleted" else NOG(D(n))
    db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, line_id, event, object_guid, master_id, alter_id, vch_type, vch_no, vch_date, received_at, state, held_why) "
           "values (%s, 'c1', %s, %s, 'go-2.5.0', 'MADEUP-PC1', %s, %s, %s, %s, %s, 'Sales', '', %s, now() - interval '%d minutes', 'held', %s)"
           % (q(F), q(B), q(DV), q(lid), q(ev), q(guid) if guid else "null", q(mid) if mid else "null", alter if alter is not None else "null", q(D(n)), ago_min, q(why)))
def line(lid): return (db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where line_id = %s order by id desc limit 1" % q(lid)) or [{}])[0]
def cday(n): return (db.rows("select source, (done_at is not null) as done, (upload_at is not null) as up, lists from tally_check_days where book_id = %s and day = %s" % (q(B), q(D(n)))) or [{}])[0]
is_open = lambda n: cday(n).get("done") in ("f", False) and cday(n).get("up") in ("f", False)
def age_reads(n, sec=120):
    db.sql("update tally_held_reads set first_at = first_at - interval '%d seconds' where book_id = %s and day = %s" % (sec, q(B), q(D(n))))
def STAT(uid=OWNER, client="c1"):
    r = APPU("select tally_held_status(%s)::text" % (q(client) if client else "null"), uid)
    return next((x for x in (r.get("books") or []) if x.get("book") == B), {}) if isinstance(r, dict) else {}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'MADE UP CO', %(S)s, %(S)s::date - 1), (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2020-04-01', '2020-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'MADE UP CO', '{"choices": {}}');"""
           % {"F": q(F), "F2": q(F2), "O": q(OWNER), "V": q(VIEWER), "X": q(OTHER), "B": q(B), "B2": q(B2), "S": q(D(0))})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh136', '{}'::jsonb, true, now()) on conflict do nothing;
      insert into tally_companies (firm_id, company, client_id, device_id, book_id) values (%s, 'MADE UP CO', 'c1', %s, %s) on conflict do nothing;""" % (q(DV), q(F), q(F), q(DV), q(B)))
    r = psql_text(open(M135).read())
    if r.returncode: ok(False, "135 runs: %s" % r.stderr[-300:]); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, 50000, now() - interval '60 days', %s)" % (q(B), q(F), q(CG)))
    # the made-up books: days 0..39, one entry each (entry 100+n at AlterID 10+n), uploaded an hour ago
    for n in range(40):
        day(D(n), [V(100 + n, 10 + n, D(n))], LN(100 + n))
    db.sql("update tally_days set at = now() - interval '1 hour' where book_id = %s" % q(B))

    print("== 1. (setup) the owner's book: lines held after the upload, their day already listed by a check after them")
    held("o-alt", "altered", 8, mid=108, alter=900)            # the line's AlterID above the copy's (18); Tally lists 18
    held("o-del", "deleted", 8)
    db.sql("""insert into tally_check_runs (book_id, firm_id) values (%(B)s, %(F)s) on conflict do nothing;
      insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
      values (%(B)s, %(F)s, %(d)s, 'fill', now() - interval '20 minutes', 1, 1, %(h)s, 'day', now() - interval '20 minutes', true, now() - interval '20 minutes')
      on conflict (book_id, day) do update set heads = excluded.heads, via = 'day', listed_at = excluded.listed_at, done_at = excluded.done_at, lists = 1"""
           % {"B": q(B), "F": q(F), "d": q(D(8)), "h": js([H(108, 18)])})
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "136 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
        t137 = open(M137).read()
        print("  md5 of %s: %s" % (os.path.basename(M137), hashlib.md5(t137.encode()).hexdigest()))
        c137 = "\n".join(l.split("--")[0] for l in t137.lower().splitlines())
        ok("delete from" not in c137 and not re.search(r"\b(drop|truncate|alter\s+table|create\s+table)\b", c137) and sorted(set(re.findall(r"create or replace function public\.(\w+)", t137))) == ["tally_held_status"],
           "8. 137: only 136's tally_held_status replaced; no table, no drop")
        for i in (1, 2):
            r = psql_text(t137)
            ok(r.returncode == 0, "137 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    l = line("o-alt")
    ok(l.get("state") == "duplicate" and "checked against Tally" in l.get("why", "") and "AlterID 18" in l.get("why", ""), "1. the altered line Tally listed at FinCom's AlterID after it arrived: settled when 136 runs (%s)" % l)
    ok(line("o-del").get("state") == "held", "1. the GUID-less delete: not yet (one list only)")
    ok(db.one("select count(*) from tally_held_reads where book_id = %s and day = %s and first_at is not null and second_at is null" % (q(B), q(D(8)))) == "1" and is_open(8) and cday(8).get("source") == "held",
       "1. its first read recorded, the day queued again for the second (%s)" % cday(8))

    print("== 0. grants")
    ok(db.one("select has_table_privilege('authenticated', 'public.tally_held_reads', 'select') or has_table_privilege('anon', 'public.tally_held_reads', 'select')") in ("f", "false"), "0. tally_held_reads: nothing for anon or authenticated")
    ok(all(db.one("select has_table_privilege('service_role', 'public.tally_held_reads', %s)" % q(p)) in ("t", "true") for p in ("select", "insert", "update", "delete")), "0. tally_held_reads: service_role reads and writes")
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_held_reads'::regclass") in ("t", "true"), "0. tally_held_reads: row security on")
    sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array[%s])" % ", ".join(q(x) for x in APP + HELP))}
    ex = lambda rl, fn: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig[fn]))) in ("t", "true") if fn in sig else None
    for fn in APP: ok(ex("authenticated", fn) is True and ex("anon", fn) is False, "0. %s: authenticated, not anon" % fn)
    for fn in HELP: ok(ex("service_role", fn) is False and ex("authenticated", fn) is False and ex("anon", fn) is False, "0. %s: nobody" % fn)

    print("== 2. a held line queues its day")
    held("a-1", "altered", 1, mid=101, alter=500)               # Tally will list 11 (FinCom's)
    held("a-3", "altered", 3, mid=103, alter=12)                # at or below the copy's (13)
    held("a-4", "altered", 4, mid=104, alter=700)               # Tally lists another AlterID: brought first
    held("d-2", "deleted", 2)
    for n in (1, 2, 3, 4):
        ok(is_open(n) and cday(n).get("source") == "held", "2. day %d queued by itself for the check (%s)" % (n, cday(n)))
    nx = NEXT(10)
    got = sorted(x.get("day") for x in nx) if isinstance(nx, list) else []
    ok(all(D8(n) in got for n in (1, 2, 3, 4, 8)) and all(x.get("fetch") and x.get("check") for x in nx), "2. handed to the bridge by tally_check_next_open (%s)" % got)

    print("== 3. the day check done: the entry lines")
    heads(1, [H(101, 11)])
    l = line("a-1")
    ok(l.get("state") == "duplicate" and "checked against Tally on" in l.get("why", "") and "AlterID 11" in l.get("why", ""), "3. Tally lists the entry at FinCom's AlterID: already in the books (%s)" % l)
    heads(3, [H(103, 13)])
    ok(line("a-3").get("state") in ("duplicate", "stale"), "3. a line at or below the copy's AlterID: settled (%s)" % line("a-3"))
    h4 = heads(4, [H(104, 99)])
    ok(h4.get("done") is False and line("a-4").get("state") == "held", "3. Tally lists another AlterID: the check brings it first, the line stays held (%s)" % line("a-4"))

    print("== 4. a GUID-less delete: two whole-day lists a minute apart")
    h2 = heads(2, [H(102, 12)])
    ok(h2.get("done") is True and line("d-2").get("state") == "held" and is_open(2), "4. the first whole-day list: still held, the day asked again (%s, %s)" % (line("d-2"), cday(2)))
    heads(2, [H(102, 12)])
    ok(line("d-2").get("state") == "held" and is_open(2), "4. a second list less than a minute on: still held, asked again (%s)" % cday(2))
    age_reads(2)
    heads(2, [H(102, 12)])
    l = line("d-2")
    ok(l.get("state") == "applied" and "read twice" in l.get("why", "") and "checked against Tally on" in l.get("why", ""), "4. a second whole-day list a minute or more on: settled (%s)" % l)
    ok(not is_open(2), "4. the day done, not asked again")
    age_reads(8)
    heads(8, [H(108, 18)])
    ok(line("o-del").get("state") == "applied", "4. the owner's book: the delete settled on the second read (%s)" % line("o-del"))
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and day in (%s, %s) and deleted_at is null" % (q(B), q(D(2)), q(D(8)))) == "2", "4. the books unchanged by settling")

    print("== 5. an upload after lines that came after an earlier upload")
    held("u-alt", "altered", 5, mid=105, alter=950)
    held("u-del", "deleted", 5)
    ok(line("u-alt").get("state") == "held" and line("u-del").get("state") == "held", "5. held first")
    day(D(5), [V(105, 15, D(5))], LN(105))
    l5a, l5d = line("u-alt"), line("u-del")
    ok(l5d.get("state") == "applied" and "Day Book for" in l5d.get("why", ""), "5. the GUID-less delete settled by the new upload (%s)" % l5d)
    ok(l5a.get("state") == "duplicate" and "Day Book for" in l5a.get("why", ""), "5. the altered line settled by the new upload (%s)" % l5a)

    print("== 6. a renumbering alert")
    at = (IST - datetime.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
    db.sql("update tally_devices set info = %s where id = %s" % (js({"beat": {"renumberAlerts": [{"company": "MADE UP CO", "words": "2 entries may have been renumbered", "n": 2, "more": False, "from": D8(37), "type": "Sales", "at": at}]}}), q(DV)))
    s6 = STAT()
    rn = (s6.get("renumber") or [{}])[0]
    ok(rn.get("from") == D8(37) and rn.get("checked") is False, "6. the alert in the status, not checked yet (%s)" % rn)
    alert_day = (IST - datetime.timedelta(minutes=30)).date()
    days6 = [(START + datetime.timedelta(days=37 + k)) for k in range((alert_day - START).days - 37 + 1)]
    ok(all(db.one("select count(*) from tally_check_days where book_id = %s and day = %s and done_at is null" % (q(B), q(d.isoformat()))) == "1" for d in days6), "6. its days queued (%s)" % [d.isoformat() for d in days6])
    for d in days6:
        n = (d - START).days
        heads(n, [H(100 + n, 10 + n)] if n < 40 else [])
    ok((STAT().get("renumber") or [{}])[0].get("checked") is True, "6. every day from its first day listed after it: checked")

    print("== 7. tally_held_status")
    s7 = STAT()
    ok(s7.get("held") == 1 and s7.get("entries") == 1 and s7.get("from") == D8(4) and s7.get("company") == "MADE UP CO" and s7.get("client") == "c1", "7. the held lines left: one, day 4 (%s)" % {k: s7.get(k) for k in ("held", "entries", "deletes", "from", "to")})
    ck = s7.get("check") or {}
    ok(ck.get("total", 0) >= 5 and ck.get("waiting") == 2 and ck.get("state") == "checking" and s7.get("fetchOn") is True, "7. the check's progress: days 4 and 5 (queued by its lines before the upload) waiting (%s)" % ck)
    db.sql("update tally_devices set last_seen = now() - interval '2 days' where id = %s" % q(DV))
    c8 = STAT().get("check") or {}
    ok(c8.get("state") == "off" and c8.get("why") == "offline" and STAT().get("fetchOn") is False, "8. the computer with the switch on not connected: off, offline (%s)" % c8)
    db.sql("update tally_devices set period_fetch = false where id = %s" % q(DV))
    c8 = STAT().get("check") or {}
    ok(c8.get("state") == "off" and c8.get("why") == "switch", "8. the switch on nowhere: off, switch (%s)" % c8)
    db.sql("update tally_devices set period_fetch = true, last_seen = now() where id = %s" % q(DV))
    ok((STAT().get("check") or {}).get("state") == "checking", "8. connected again: checking")
    ok(STAT(VIEWER).get("held") == 1, "7. a viewer of the firm sees it")
    ok(STAT(OTHER) == {}, "7. another firm sees nothing")
    ok("not allowed" in str(j("select tally_held_status(null)::text", None, "anon")) or "permission" in str(j("select tally_held_status(null)::text", None, "anon")), "7. anon cannot")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
