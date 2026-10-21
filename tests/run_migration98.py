"""python3 run_migration98.py - migration-98-period-pull (21-Oct-2026, FinCom Bridge 2.4.5, ROUND 102, branch next-245): older
entries from Tally only for a period the person chooses, counted one day at a time, and the ledger read's progress. On a
throwaway PostgreSQL (pg_stand, port 30980; never a real database), built in staging's order 32 -> ... -> 63 as
run_migration92.py builds it. Written before the file. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate; the only table changes are
     the three new tables' row security), names no real database; runs twice; each new table's own grants (ROUND 101):
     service_role select/insert/update/delete, nothing for anon or authenticated; the app's functions for authenticated,
     tally-ingest's for service_role only, the helpers for nobody.
  1. the person's choice: a year that has begun, the whole year; half-years refused until the year is counted at more than
     20,000 vouchers; another firm's book refused; a viewer cannot change it; pause and resume.
  2. the next days: while counting, the year's days not counted, newest first, at most 3, fetch false, days handed out in
     the last 2 minutes after the others (review 245 R2: a day that does not end never holds the rest back), never after
     today; then the part's days counted and not done, fetch true; none while paused.
  3. a day's heads: Tally's count kept; FinCom's count of them (a GUID held at a lower AlterID is not held); the MasterIDs it
     lacks; a day with every entry held is done at once; a day outside the year chosen refused.
  4. the entries: stored through the entry path (the day's books as a Day Book would make them); an entry of another date
     refused; one FinCom holds at a higher AlterID left as it is; the day then done; a locked month: nothing stored, the day
     marked to upload with its words (never fetched again); an entry with no ledger line (seen) held, so its day ends; a
     MasterID Tally gave no entry for (gone) stays counted until the day is counted again.
  5. a day to upload by hand: never handed out again; its words in the status.
  6. the status: "x of y vouchers, left", the year's count, half offered above 20,000; the ledger progress never back.
RED_WITHOUT_98=1: the same checks without the file (they fail)."""
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
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql", "migration-63-recorder-repeat.sql")]
M98 = os.environ.get("M98_FILE") or os.path.join(SQLDIR, "migration-98-period-pull.sql")
RED = os.environ.get("RED_WITHOUT_98") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, VIEWER, OTHER = "99999999-9999-9999-9999-999999999998", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555598", "55555555-5555-5555-5555-555555555599", "44444444-4444-4444-4444-444444444444"
B, B2 = "819d4a59-4cee-4bf7-8f8c-000000000098", "819d4a59-4cee-4bf7-8f8c-000000000099"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599198"
G = lambda mid: CG + "-%08x" % mid
TODAY = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
FY = datetime.date(TODAY.year - (1 if TODAY.month >= 4 else 2), 4, 1)     # last year's FY: every day has begun
FYS = FY.isoformat()

text = open(M98).read() if os.path.exists(M98) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M98))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M98), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == sorted(["alter table public.%s enable row level security;" % t for t in ("tally_period_pulls", "tally_period_days", "tally_ledger_progress")]
     + ["alter table public.tally_devices add column if not exists period_fetch boolean not null default false;", "alter table public.tally_devices add column if not exists period_fetch_at timestamptz;",
        "alter table public.tally_devices add column if not exists period_fetch_by uuid;"]
     + ["alter table public.tally_devices add column if not exists period_night_from smallint not null default 20 check (period_night_from between 0 and 23);",
        "alter table public.tally_devices add column if not exists period_night_to smallint not null default 8 check (period_night_to between 0 and 23);",
        "alter table public.tally_devices add column if not exists period_night_sunday boolean not null default true;",
        "alter table public.tally_devices add column if not exists period_night_at timestamptz;", "alter table public.tally_devices add column if not exists period_night_by uuid;",
        "alter table public.tally_period_pulls add column if not exists pace text check (pace is null or pace in ('day', 'night'));",
        "alter table public.tally_period_pulls add column if not exists pace_at timestamptz;"]),
   "0. add-only: no delete from, drop or truncate; the only table changes are the new tables' row security and tally_devices' three new columns (ROUND 103) (%s)" % alters)
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
TABLES = sorted(re.findall(r"create table if not exists public\.(\w+)", text))
ok(TABLES == ["tally_ledger_progress", "tally_period_days", "tally_period_pulls"], "0. three new tables (%s)" % TABLES)
for t in TABLES:
    ok(re.search(r"grant select, insert, update, delete on public\.%s to service_role;" % t, text) is not None, "0. %s carries its own grants in the file (ROUND 101)" % t)
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
APP = ["tally_period_choose", "tally_period_pause", "tally_period_status", "tally_device_period_fetch", "tally_device_period_night"]
SVC = ["tally_ledger_progress_save", "tally_period_entries", "tally_period_heads", "tally_period_next", "tally_period_upload", "tally_period_stop"]
HELP = ["tally_period_half", "tally_period_held", "tally_period_member", "tally_period_range", "tally_period_status_of"]
ok(FNS == sorted(APP + SVC + HELP), "0. sixteen new functions (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG98_PORT") or 30980))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
APPU = lambda s, uid=OWNER: j(s, uid, "authenticated")
def day(d, vouchers, lines, n=None): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers) if n is None else n, max([v["alter"] for v in vouchers] + [0])))
def V(mid, alter, d, no=None):
    return {"guid": G(mid), "alter": alter, "type": "Sales", "no": no or str(mid), "party": "Spike Customer", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def LN(mid): return [[G(mid), "Spike Customer", -118.0, "", None, []], [G(mid), "Sales GST 18%", 100.0, "", None, []], [G(mid), "CGST Output 9%", 9.0, "", None, []], [G(mid), "SGST Output 9%", 9.0, "", None, []]]
def H(mid, alter, typ="Sales"): return [G(mid), mid, alter, typ]
D = lambda n: (FY + datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (FY + datetime.timedelta(days=n)).strftime("%Y%m%d")
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'BIG CO', '2020-04-01', '2020-03-31'), (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2020-04-01', '2020-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'BIG CO', '{"choices": {}}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "V": q(VIEWER), "X": q(OTHER), "B": q(B), "B2": q(B2)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if not RED:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "98 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    for t in TABLES:
        for rl in ("anon", "authenticated"):
            ok(db.one("select has_table_privilege(%s, 'public.%s', 'select') or has_table_privilege(%s, 'public.%s', 'insert')" % (q(rl), t, q(rl), t)) in ("f", "false"), "0. %s: nothing for %s" % (t, rl))
        ok(all(db.one("select has_table_privilege('service_role', 'public.%s', %s)" % (t, q(p))) in ("t", "true") for p in ("select", "insert", "update", "delete")), "0. %s: service_role reads and writes" % t)
        ok(db.one("select relrowsecurity from pg_class where oid = 'public.%s'::regclass" % t) in ("t", "true"), "0. %s: row security on" % t)
    sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like any (array['tally_period%', 'tally_ledger_progress%', 'tally_device_period_fetch', 'tally_device_period_night'])")}
    ex = lambda rl, fn: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig.get(fn, "public.nothing()")))) in ("t", "true") if fn in sig else None
    for fn in APP: ok(ex("authenticated", fn) and not ex("anon", fn), "0. %s: authenticated, not anon" % fn)
    for fn in SVC: ok(ex("service_role", fn) and not ex("authenticated", fn) and not ex("anon", fn), "0. %s: service_role only" % fn)
    for fn in HELP: ok(ex("service_role", fn) is False and ex("authenticated", fn) is False and ex("anon", fn) is False, "0. %s: nobody" % fn)

    print("== 1. the person's choice")
    s1 = APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(FYS)))
    ok(s1.get("ok") is True and (s1.get("pull") or {}).get("part") == "year" and (s1.get("pull") or {}).get("counting") is True, "1. the whole year chosen (%s)" % str(s1)[:200])
    s1h = APPU("select tally_period_choose(%s, %s, 'h1')::text" % (q(B), q(FYS)))
    ok(s1h.get("ok") is False and "20,000" in str(s1h.get("error")), "1. a half-year refused before the year is counted over 20,000 (%s)" % str(s1h)[:160])
    nf = (FY.replace(year=FY.year + 2)).isoformat()
    ok(APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(nf))).get("ok") is False, "1. a year not begun refused")
    ok(APPU("select tally_period_choose(%s, '2025-05-01', 'year')::text" % q(B)).get("ok") is False, "1. not an April 1st refused")
    ok("not allowed" in str(APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B2), q(FYS)))), "1. another firm's book refused")
    ok("not allowed" in str(APPU("select tally_period_pause(%s, true)::text" % q(B), VIEWER)), "1. a viewer cannot pause")
    ok(APPU("select tally_period_status(%s)::text" % q(B), VIEWER).get("ok") is True, "1. a viewer sees the status")
    ok("not allowed" in str(APPU("select tally_period_status(%s)::text" % q(B), OTHER)), "1. another firm cannot see it")
    ok("not allowed" in str(APPU("select tally_period_next(%s, 3)::text" % q(B))), "1. a signed-in person cannot take the bridge's days")

    print("== 2. the next days: counting first")
    n1 = j("select tally_period_next(%s, 3)::text" % q(B))
    last = min(TODAY.date(), FY.replace(year=FY.year + 1) - datetime.timedelta(days=1))
    ok(isinstance(n1, list) and len(n1) == 3 and [x["day"] for x in n1] == [(last - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(3)] and all(x["fetch"] is False for x in n1)
       and "Sales" in n1[0]["types"] and "Contra" in n1[0]["types"], "2. the year's last 3 days, counting (%s)" % str(n1)[:200])
    n2 = j("select tally_period_next(%s, 3)::text" % q(B))
    ok([x["day"] for x in n2] == [(last - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(3, 6)], "2. days handed out in the last 2 minutes come after the others (%s)" % [x["day"] for x in n2])
    print("== 2b. ROUND 103: the night pace (tally-ingest asks up to 30 outside office hours; never more)")
    ok((APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}).get("pace") == "day", "2b. the pace by day in the status")
    nn = j("select tally_period_next(%s, 40)::text" % q(B))
    ok(isinstance(nn, list) and len(nn) == 30 and [x["day"] for x in nn][0] == (last - datetime.timedelta(days=6)).strftime("%Y%m%d"), "2b. at night at most 30 days an answer (%d)" % len(nn) if isinstance(nn, list) else nn)
    ok((APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}).get("pace") == "night", "2b. the pace at night in the status")
    db.sql("update tally_period_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    j("select tally_period_next(%s, 3)::text" % q(B))
    ok((APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}).get("pace") == "day", "2b. back to the day pace")
    db.sql("update tally_period_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    APPU("select tally_period_pause(%s, true)::text" % q(B))
    ok(j("select tally_period_next(%s, 3)::text" % q(B)) == [], "2. none while paused")
    APPU("select tally_period_pause(%s, false)::text" % q(B))

    print("== 3. a day's heads")
    day(D(10), [V(1001, 5001, D(10)), V(1002, 5002, D(10))], LN(1001) + LN(1002))
    h3 = j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(10)), js([H(1001, 5001), H(1002, 5009), H(1003, 5003, "Receipt")])))
    ok(h3.get("ok") is True and h3.get("n") == 3 and h3.get("held") == 1 and sorted(h3.get("want") or []) == ["1002", "1003"] and h3.get("done") is False, "3. counted 3, holds 1 (1002 held older), lacks 1002 and 1003 (%s)" % h3)
    h3b = j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(11)), js([])))
    ok(h3b.get("ok") is True and h3b.get("n") == 0 and h3b.get("done") is True, "3. an empty day is done at once")
    out = (FY - datetime.timedelta(days=1)).isoformat()
    ok(j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(out), js([]))).get("ok") is False, "3. a day outside the year refused")

    print("== 4. the entries")
    e4 = j("select tally_period_entries(%s, %s, %s, %s, '{}'::jsonb, '[]'::jsonb)::text" % (q(B), q(D(10)), js([V(1002, 5009, D(10)), V(1003, 5003, D(10))]), js(LN(1002) + LN(1003))))
    ok(e4.get("ok") is True and e4.get("stored") == 2 and e4.get("held") == 3 and e4.get("done") is True, "4. stored, the day done (%s)" % e4)
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(B), q(D(10)))) == "3", "4. the day's three entries in the books")
    ok(db.one("select alter_id from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(1002)))) == "5009", "4. the newer AlterID kept")
    ok(db.one("select count(*) from tally_lines where book_id = %s and guid = %s" % (q(B), q(G(1003)))) == "4", "4. its lines stored")
    e4b = j("select tally_period_entries(%s, %s, %s, %s, '{}'::jsonb, '[]'::jsonb)::text" % (q(B), q(D(10)), js([V(1004, 5004, D(12))]), js(LN(1004))))
    ok(e4b.get("ok") is False and db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(1004)))) == "0", "4. an entry of another date refused, nothing stored")
    e4c = j("select tally_period_entries(%s, %s, %s, %s, '{}'::jsonb, '[]'::jsonb)::text" % (q(B), q(D(10)), js([V(1002, 5001, D(10))]), js(LN(1002))))
    ok(e4c.get("ok") is True and e4c.get("stale") == 1 and db.one("select alter_id from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(1002)))) == "5009", "4. an older AlterID left as it is (%s)" % e4c)
    if not RED:
        db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by) values (%s, 'c1', %s, %s, %s)" % (q(F), q(B), q(D(20)[:8] + "01"), q(OWNER)))
    j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(20)), js([H(1010, 5010)])))
    locked = db.one("select to_regclass('public.tally_month_locks')")
    if locked:
        e4d = j("select tally_period_entries(%s, %s, %s, %s, '{}'::jsonb, '[]'::jsonb)::text" % (q(B), q(D(20)), js([V(1010, 5010, D(20))]), js(LN(1010))))
        ok(e4d.get("ok") is True and e4d.get("locked") is True and "Unlock the month" in str(e4d.get("upload")) and db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(1010)))) == "0", "4. a locked month: nothing stored, the words to upload (%s)" % e4d)
        ok(db.one("select upload_why from tally_period_days where book_id = %s and day = %s" % (q(B), q(D(20)))) == "locked", "4. the locked day marked to upload, never fetched again")

        db.sql("update tally_month_locks set unlocked_at = now() where book_id = %s" % q(B))
    # an entry with no ledger line (a stock journal): seen at its AlterID, its day ends; a MasterID gone from Tally: out of the count
    j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(40)), js([H(1040, 5040, "Stock Journal"), H(1041, 5041)])))
    e4e = j("select tally_period_entries(%s, %s, '[]'::jsonb, '[]'::jsonb, %s, %s)::text" % (q(B), q(D(40)), js({G(1040): 5040}), js(["1041"])))
    ok(e4e.get("ok") is True and e4e.get("n") == 2 and e4e.get("held") == 1 and e4e.get("done") is False, "4. seen held; gone NOT taken out on one empty answer (%s)" % e4e)
    h4f = j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(40)), js([H(1040, 5040, "Stock Journal")])))
    ok(h4f.get("held") == 1 and h4f.get("done") is True, "4. counted again without the gone entry: the seen one still held, the day done (%s)" % h4f)
    # review 245 R3: paused, a day's list and entries are refused in words (the bridge leaves the day at once)
    APPU("select tally_period_pause(%s, true)::text" % q(B))
    ok(j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(41)), js([H(1050, 5050)]))).get("ok") is False, "4. paused: a day's list refused")
    ok(j("select tally_period_entries(%s, %s, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb)::text" % (q(B), q(D(40)))).get("ok") is False, "4. paused: entries refused")
    APPU("select tally_period_pause(%s, false)::text" % q(B))
    print("== 4b. ROUND 103: a FinComDayHeads answer over 2 s stops the period (never retried by itself)")
    w = "Tally took too long to give 15-Jun-2025, so FinCom stopped reading older entries. Please upload the Day Book for the days still missing."
    st0 = APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}
    ca = st0.get("chosenAt")
    # review 103: an older choice's stop never stops the newer choice; a day outside the year never stops it
    s4o = j("select tally_period_stop(%s, %s, 'over2s', %s, (%s::timestamptz - interval '1 second'))::text" % (q(B), q(D(75)), q(w), q(ca)))
    ok(s4o.get("stopped") is False and (APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}).get("state") == "going", "4b. a stop of an older choice: not stopped (%s)" % s4o)
    s4y = j("select tally_period_stop(%s, %s, 'over2s', %s, %s::timestamptz)::text" % (q(B), q("2001-01-01"), q(w), q(ca)))
    ok(s4y.get("stopped") is False, "4b. a day outside the year: not stopped (%s)" % s4y)
    s4 = j("select tally_period_stop(%s, %s, 'over2s', %s, %s::timestamptz)::text" % (q(B), q(D(75)), q(w), q(ca)))
    ok(s4.get("ok") is True and s4.get("stopped") is True, "4b. stopped (%s)" % s4)
    ok(j("select tally_period_next(%s, 3)::text" % q(B)) == [], "4b. nothing listed once stopped")
    st = APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}
    ok(st.get("state") == "stopped" and (st.get("stopped") or {}).get("words") == w and (st.get("stopped") or {}).get("day") == D8(75) and (st.get("stopped") or {}).get("from") == st.get("from") and st.get("done") is False, "4b. the status: one line, its words, the day (%s)" % st.get("stopped"))
    ok(j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(76)), js([H(1060, 5060)]))).get("ok") is False, "4b. a day's list refused once stopped")
    APPU("select tally_period_pause(%s, false)::text" % q(B))
    ok((APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}).get("state") == "stopped", "4b. Resume does not restart a stopped period (only a fresh choice does)")
    c4 = APPU("select tally_period_choose(%s, %s, %s)::text" % (q(B), q(FYS), q(st0.get("part") or "year")))
    ok((c4.get("pull") or {}).get("state") == "going" and not (c4.get("pull") or {}).get("stopped"), "4b. the person chooses again: going (%s)" % str(c4.get("pull"))[:120])

    print("== 4c. ROUND 103: the per-computer switch, default off, owner only")
    DV = "dddddddd-0000-4000-8000-000000000098"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash) values (%s, %s, 'PC-98', 'kh98') on conflict do nothing" % (q(DV), q(F)))
    ok(db.one("select period_fetch from tally_devices where id = %s" % q(DV)) in ("f", "false"), "4c. off by default")
    ok(db.one("select has_column_privilege('authenticated', 'public.tally_devices', 'period_fetch', 'select')") in ("t", "true"), "4c. the firm reads the switch")
    ok(db.one("select has_column_privilege('authenticated', 'public.tally_devices', 'period_fetch', 'update')") in ("f", "false"), "4c. nobody updates it but through the owner's function")
    ok("owner" in str(APPU("select tally_device_period_fetch(%s, true)::text" % q(DV), VIEWER)), "4c. a viewer refused")
    ok("not a computer of your firm" in str(APPU("select tally_device_period_fetch(%s, true)::text" % q(DV), OTHER)) or "owner" in str(APPU("select tally_device_period_fetch(%s, true)::text" % q(DV), OTHER)), "4c. another firm refused")
    on = APPU("select tally_device_period_fetch(%s, true)::text" % q(DV))
    ok(on.get("ok") is True and on.get("periodFetch") is True and db.one("select period_fetch_by from tally_devices where id = %s" % q(DV)) == OWNER, "4c. the owner switches it on, who and when kept (%s)" % on)
    print("== 4d. ROUND 103: office hours per computer (20:00-08:00 IST and Sunday by default), owner only")
    ok(db.one("select period_night_from || '-' || period_night_to || '-' || period_night_sunday from tally_devices where id = %s" % q(DV)) in ("20-8-true", "20-8-t"), "4d. 20:00 to 08:00 and Sunday by default")
    for c in ("period_night_from", "period_night_to", "period_night_sunday", "period_night_at", "period_night_by"):
        ok(db.one("select has_column_privilege('authenticated', 'public.tally_devices', %s, 'select')" % q(c)) in ("t", "true") and db.one("select has_column_privilege('authenticated', 'public.tally_devices', %s, 'update')" % q(c)) in ("f", "false"), "4d. %s: the firm reads it, nobody updates it directly" % c)
    ok("owner" in str(APPU("select tally_device_period_night(%s, 21, 7, false)::text" % q(DV), VIEWER)), "4d. a viewer refused")
    ok("owner" in str(APPU("select tally_device_period_night(%s, 21, 7, false)::text" % q(DV), OTHER)) or "not a computer" in str(APPU("select tally_device_period_night(%s, 21, 7, false)::text" % q(DV), OTHER)), "4d. another firm refused")
    ok("0 to 23" in str(APPU("select tally_device_period_night(%s, 24, 7, false)::text" % q(DV))), "4d. an hour out of range refused")
    nt = APPU("select tally_device_period_night(%s, 21, 7, false)::text" % q(DV))
    ok(nt.get("ok") is True and nt.get("from") == 21 and nt.get("to") == 7 and nt.get("sunday") is False and db.one("select period_night_by from tally_devices where id = %s" % q(DV)) == OWNER, "4d. the owner sets 21:00-07:00, no Sunday (%s)" % nt)
    print("== 5. a day to upload by hand")
    u5 = j("select tally_period_upload(%s, %s, 'over2s', 'Sales', %s)::text" % (q(B), q(D(30)), q("Tally took too long to give X. Please upload that day's Day Book.")))
    ok(u5.get("ok") is True, "5. marked")

    print("== 6. the status, the fetch phase, the half-years")
    # count the rest of the year: every day 70 entries (25,000 and more in the year), FinCom holding none of them
    days = (min(TODAY.date(), FY.replace(year=FY.year + 1) - datetime.timedelta(days=1)) - FY).days + 1
    db.sql("insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at) select %s, %s, g::date, 70, 0, '[]'::jsonb, 'day', now() from generate_series(%s::date, %s::date, interval '1 day') g on conflict (book_id, day) do update set tally_n = 70, heads = '[]'::jsonb, counted_at = now() where tally_period_days.tally_n is null and tally_period_days.upload_at is null"
           % (q(B), q(F), q(FYS), q((FY + datetime.timedelta(days=days - 1)).isoformat())))
    st = APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}
    # y: the part's counted days not marked to upload (the locked day's 1 entry left out); x: 3 of 10 + 1 of 40
    ok(st.get("counting") is False and st.get("half") is True and st.get("yearVouchers", 0) > 20000 and st.get("y") == st.get("yearVouchers") - 1 and st.get("x") == 4 and st.get("left") == st["y"] - 4,
       "6. counted: y, x and left; half-years offered above 20,000 (%s)" % {k: st.get(k) for k in ("counting", "half", "yearVouchers", "y", "x", "left")})
    ok(len(st.get("upload") or []) == 2 and all("upload" in u["words"] for u in st["upload"]), "6. the days to upload in the status (%s)" % st.get("upload"))
    n6 = j("select tally_period_next(%s, 3)::text" % q(B))
    ok(isinstance(n6, list) and len(n6) == 3 and all(x["fetch"] is True for x in n6) and D8(30) not in [x["day"] for x in n6] and D8(10) not in [x["day"] for x in n6], "6. the fetch phase: undone days, newest first (%s)" % [x["day"] for x in n6])
    h6 = APPU("select tally_period_choose(%s, %s, 'h1')::text" % (q(B), q(FYS)))
    ok(h6.get("ok") is True and (h6.get("pull") or {}).get("part") == "h1" and (h6["pull"]["to"] == (FY.replace(month=9, day=30)).strftime("%Y%m%d")), "6. Apr-Sep chosen once the year is over 20,000 (%s)" % str(h6.get("pull"))[:160])
    n7 = j("select tally_period_next(%s, 3)::text" % q(B))
    ok(n7 and all(x["day"] <= FY.replace(month=9, day=30).strftime("%Y%m%d") for x in n7), "6. only Apr-Sep handed out (%s)" % [x["day"] for x in n7])
    print("== 6b. ROUND 103: the speed and the time left (the last 30 minutes' days done)")
    st6 = APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}
    ok(st6.get("etaMin") is None, "6b. no time left shown before anything was done at this pace (%s)" % st6.get("etaMin"))
    db.sql("update tally_period_days set done_at = now(), held_n = tally_n, asked_at = now() - interval '10 minutes' where book_id = %s and day in (select day from tally_period_days where book_id = %s and day <= %s and done_at is null and upload_at is null order by day desc limit 20)"
           % (q(B), q(B), q(FY.replace(month=9, day=30).isoformat())))
    st7 = APPU("select tally_period_status(%s)::text" % q(B)).get("pull") or {}
    ok(st7.get("rate") == 140 and isinstance(st7.get("etaMin"), int) and st7["etaMin"] == -(-st7["left"] // 140), "6b. 1,400 entries in 10 minutes: 140 a minute, the time left from what is left (%s)" % {k: st7.get(k) for k in ("rate", "etaMin", "left")})
    print("== 6. the ledger progress")
    j("select tally_ledger_progress_save(%s, 'r1', 312, 1240, false, null)::text" % q(B))
    j("select tally_ledger_progress_save(%s, 'r1', 200, 1240, false, null)::text" % q(B))
    lp = APPU("select tally_period_status(%s)::text" % q(B)).get("ledger") or {}
    ok(lp.get("read") == 312 and lp.get("of") == 1240, "6. never back within a round (%s)" % lp)
    j("select tally_ledger_progress_save(%s, 'r1', 1300, 1240, false, null)::text" % q(B))
    lp = APPU("select tally_period_status(%s)::text" % q(B)).get("ledger") or {}
    ok(lp.get("read") == 1300 and lp.get("of") == 1300, "6. of never below read (%s)" % lp)
    j("select tally_ledger_progress_save(%s, 'r2', 1301, 1301, true, null)::text" % q(B))
    lp = APPU("select tally_period_status(%s)::text" % q(B)).get("ledger") or {}
    ok(lp.get("done") is True and lp.get("read") == 1301, "6. the round's end (%s)" % lp)
    j("select tally_ledger_progress_save(%s, 'r2', 1301, 1301, false, null)::text" % q(B))
    lp = APPU("select tally_period_status(%s)::text" % q(B)).get("ledger") or {}
    ok(lp.get("done") is True, "6. a late beat of the same round never makes it not done (%s)" % lp)
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
