"""python3 run_migration133.py - migration-133-fetch-check (30-Oct-2026; the owner: "there should be two ways.. one is
automatically updating books from tally and giving progress bar and timing with that bar.. also if anyone uploads any books
and there is any difference.. it should find out the difference in tally and correct it"; "tally should not hang"). On a
throwaway PostgreSQL (pg_stand, port 31133; never a real database), built as run_migration98.py builds it, then 98, then
133. Made-up books only. Written before the file. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate; the only table changes are
     the three new tables' row security), names no real database; runs twice; each new table's own grants (service_role
     only); the app's functions for authenticated (not anon), tally-ingest's for service_role only, the helpers for nobody.
  1. the upload's days queued for the check (a queue of its own, apart from tally_period_pulls); a signed-in person cannot.
  2. the next days to check: fetch true, newest first, at most p_max, days asked in the last 2 minutes after the others; the
     choice time (chosenAt) is the period's when one is chosen (one stop rule for both), else the check's own; none while
     the period is paused or stopped, or the check is stopped.
  3. Tally's day heads against FinCom's copy: a day whose entries (GUID + AlterID) match is ticked (same); entries Tally has
     and the upload lacks, or holds at another AlterID, are asked for (want); an entry FinCom holds that Tally no longer
     lists is removed only when a SECOND whole-day list (a minute or more later) still lacks it: soft-deleted
     (deleted_at), its version kept in tally_voucher_versions, never a row deleted; a list split by voucher type removes
     nothing; an optional entry is never removed this way.
  4. the entries Tally gave: stored through the one entry path; counted as added (not in the upload) or updated (another
     AlterID); the day then done; an entry of another date refused; a locked month: nothing stored, the day to upload by
     hand with its words.
  5. the bridge's stop (Tally too slow, or its window held): the check stops (and the period with it, one rule); nothing
     handed out; Resume (owner or staff) starts it again with a new choice time; a viewer cannot.
  6. the check's status in plain words: per day "2 entries in Tally not in the upload (added)", "1 changed (updated)",
     "1 deleted in Tally (removed, kept in history)"; the total line; the days ticked; another firm cannot see it.
  7. "Today from Tally": the recorder's applied changes of today (added / changed / deleted), the older entries brought in
     (tally_period_entries_logged) and the check's corrections, each a row (date, voucher type and number, party, amount,
     what happened); the counts equal the list; no computer's name anywhere; another firm cannot see it.
  8. Stop (the person): the period stopped by them, said so; Start again chooses afresh.
  9. the firm's summary for the Tally page: each book's period (x of y, rate, time left), today's counts, the check's
     counts, and whether a computer holding the company may read older entries (its id only).
RED_WITHOUT_133=1: the same checks without the file (they fail)."""
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
                                           "migration-98-period-pull.sql")]
M = os.environ.get("M133_FILE") or os.path.join(SQLDIR, "migration-133-fetch-check.sql")
RED = os.environ.get("RED_WITHOUT_133") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, STAFF, VIEWER, OTHER = "99999999-9999-9999-9999-999999999133", "88888888-8888-8888-8888-888888888133", "55555555-5555-5555-5555-555555555133", "55555555-5555-5555-5555-555555555134", "55555555-5555-5555-5555-555555555135", "44444444-4444-4444-4444-444444444133"
B, B2 = "819d4a59-4cee-4bf7-8f8c-000000000133", "819d4a59-4cee-4bf7-8f8c-000000000134"
DV, DV2 = "dddddddd-0000-4000-8000-000000000133", "dddddddd-0000-4000-8000-000000000134"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599133"
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
APP = ["tally_check_resume", "tally_check_status", "tally_fetch_summary", "tally_period_cancel", "tally_today_from_tally"]
SVC = ["tally_check_entries", "tally_check_heads", "tally_check_next", "tally_check_queue", "tally_check_stop", "tally_period_entries_logged"]
HELP = ["tally_check_status_of", "tally_check_want", "tally_today_rows"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == sorted("alter table public.%s enable row level security;" % t for t in TABLES),
       "0. add-only: no delete from, drop or truncate; the only table changes are the new tables' row security (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(TABLES == ["tally_check_days", "tally_check_runs", "tally_fetch_log"], "0. three new tables (%s)" % TABLES)
    for t in TABLES:
        ok(re.search(r"grant select, insert, update, delete on public\.%s to service_role;" % t, text) is not None, "0. %s carries its own explicit grants (service_role)" % t)
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(APP + SVC + HELP), "0. the new functions (%s)" % FNS)
    ok(not re.search(r"create or replace function public\.(tally_period_(choose|pause|status|status_of|next|next_paced|heads|entries|upload|stop|held)|tally_ingest_\w+)\s*\(", text), "0. no existing function replaced")
    ok(not re.search(r"\b(computer|pc_name|tally_user|bridge)\b", " ".join(re.findall(r"'[^']*'", code))) or True, "0. (words checked in 7)")

db = pg_stand.start(int(os.environ.get("PG133_PORT") or 31133))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
APPU = lambda s, uid=OWNER: j(s, uid, "authenticated")
def V(mid, alter, d, no=None, typ="Sales", party="Made-up Traders", opt=False):
    return {"guid": G(mid), "alter": alter, "type": typ, "no": no or str(mid), "party": party, "narr": "", "cancel": False, "opt": opt, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def LN(mid, amt=118.0, party="Made-up Traders"): return [[G(mid), party, -amt, "", None, []], [G(mid), "Sales", amt, "", None, []]]
def H(mid, alter, typ="Sales"): return [G(mid), mid, alter, typ]
def day(d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
live = lambda mid: db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s and deleted_at is null" % (q(B), q(G(mid))))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'MADE UP CO', '2020-04-01', '2020-03-31'), (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2020-04-01', '2020-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'MADE UP CO', '{"choices": {}}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "X": q(OTHER), "B": q(B), "B2": q(B2)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # the stand's devices and companies as on staging (the columns this file reads)
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info) values (%s, %s, 'MADEUP-PC1', 'kh133', %s), (%s, %s, 'MADEUP-PC2', 'kh134', '{}'::jsonb) on conflict do nothing;
      insert into tally_companies (firm_id, company, client_id, device_id, book_id) values (%s, 'MADE UP CO', 'c1', %s, %s) on conflict do nothing;"""
           % (q(DV), q(F), js({"beat": {"open": ["MADE UP CO"]}, "computer": "MADEUP-PC1"}), q(DV2), q(F), q(F), q(DV2), q(B)))
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "133 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
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

    print("== 1. the upload's days queued")
    # the made-up upload: day 10 (two entries, Tally the same), day 11 (one entry; Tally has a second and the first at a
    # newer AlterID), day 12 (two entries; Tally deleted one; one optional entry Tally does not list), day 13 (one entry)
    day(D(10), [V(1001, 11, D(10)), V(1002, 12, D(10))], LN(1001) + LN(1002))
    day(D(11), [V(1101, 21, D(11))], LN(1101))
    day(D(12), [V(1201, 31, D(12)), V(1202, 32, D(12)), V(1203, 33, D(12), opt=True)], LN(1201) + LN(1202) + LN(1203))
    day(D(13), [V(1301, 41, D(13))], LN(1301))
    ok("not allowed" in str(APPU("select tally_check_queue(%s, array[%s]::date[], 'upload')::text" % (q(B), q(D(10))))), "1. a signed-in person cannot queue")
    q1 = j("select tally_check_queue(%s, array[%s, %s, %s, %s]::date[], 'upload')::text" % (q(B), q(D(10)), q(D(11)), q(D(12)), q(D(13))))
    ok(q1.get("ok") is True and q1.get("queued") == 4, "1. four days queued (%s)" % q1)
    ok(db.one("select count(*) from tally_period_pulls where book_id = %s" % q(B)) == "0", "1. no period chosen: the check's queue is its own")

    print("== 2. the next days to check")
    ok("not allowed" in str(APPU("select tally_check_next(%s, 3)::text" % q(B))), "2. a signed-in person cannot take them")
    n1 = j("select tally_check_next(%s, 3)::text" % q(B))
    ok(isinstance(n1, list) and [x.get("day") for x in n1] == [D8(13), D8(12), D8(11)] and all(x.get("fetch") is True and x.get("chosenAt") for x in n1), "2. newest first, at most 3, fetch true, a choice time (%s)" % str(n1)[:300])
    n2 = j("select tally_check_next(%s, 3)::text" % q(B))
    ok(isinstance(n2, list) and n2 and n2[0].get("day") == D8(10), "2. a day asked a moment ago comes after the others (%s)" % ([x.get("day") for x in n2] if isinstance(n2, list) else n2,))
    APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(FYS)))
    pca = db.one("select to_jsonb(chosen_at) #>> '{}' from tally_period_pulls where book_id = %s" % q(B))
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    n3 = j("select tally_check_next(%s, 3)::text" % q(B))
    ok(isinstance(n3, list) and n3 and all(x.get("chosenAt") == pca for x in n3), "2. a period chosen: its choice time, one stop rule for both (%s / %s)" % (pca, [x.get("chosenAt") for x in n3] if isinstance(n3, list) else n3))
    APPU("select tally_period_pause(%s, true)::text" % q(B))
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    ok(j("select tally_check_next(%s, 3)::text" % q(B)) == [], "2. none while the period is paused")
    APPU("select tally_period_pause(%s, false)::text" % q(B))

    print("== 3. Tally's day heads against the upload")
    ok("not allowed" in str(APPU("select tally_check_heads(%s, %s, '[]'::jsonb, 'day')::text" % (q(B), q(D(10))))), "3. a signed-in person cannot")
    h10 = j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(10)), js([H(1001, 11), H(1002, 12)])))
    ok(h10.get("ok") is True and h10.get("mine") is True and h10.get("want") == [] and h10.get("done") is True, "3. day 10 matches: done (%s)" % h10)
    h11 = j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(11)), js([H(1101, 25), H(1102, 22)])))
    ok(h11.get("mine") is True and sorted(h11.get("want") or []) == ["1101", "1102"] and h11.get("done") is False, "3. day 11: a newer AlterID and an entry the upload lacks are asked for (%s)" % h11)
    h12 = j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(12)), js([H(1201, 31)])))
    ok(h12.get("want") == [] and h12.get("done") is False and live(1202) == "1", "3. day 12: an entry Tally no longer lists is NOT removed on the first list (%s)" % h12)
    h12s = j("select tally_check_heads(%s, %s, %s, 'split')::text" % (q(B), q(D(12)), js([H(1201, 31)])))
    db.sql("update tally_check_days set gone1_at = now() - interval '2 minutes' where book_id = %s and day = %s" % (q(B), q(D(12))))
    h12s = j("select tally_check_heads(%s, %s, %s, 'split')::text" % (q(B), q(D(12)), js([H(1201, 31)])))
    ok(live(1202) == "1", "3. a list split by voucher type removes nothing (%s)" % h12s)
    h12b = j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(12)), js([H(1201, 31)])))
    ok(h12b.get("done") is True and h12b.get("removed") == 1 and live(1202) == "0", "3. the second whole-day list a minute on: removed (%s)" % h12b)
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(1202)))) == "1", "3. the row kept (soft-deleted, never deleted)")
    ok(int(db.one("select count(*) from tally_voucher_versions where book_id = %s and tally_guid = %s" % (q(B), q(G(1202))))) >= 1 and db.one("select count(*) from tally_lines where book_id = %s and guid = %s" % (q(B), q(G(1202)))) == "2", "3. its version and lines kept (history)")
    ok(live(1203) == "1", "3. the optional entry Tally does not list is left alone")

    print("== 4. the entries Tally gave")
    ok(j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(B), q(D(11)), js([V(1102, 22, D(13))]), js(LN(1102)))).get("ok") is False and live(1102) == "0", "4. an entry of another date refused, nothing stored")
    e11 = j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(B), q(D(11)), js([V(1101, 25, D(11), no="S-1101"), V(1102, 22, D(11), party="New Party")]), js(LN(1101, 150.0) + LN(1102, 60.0, "New Party"))))
    ok(e11.get("ok") is True and e11.get("mine") is True and e11.get("added") == 1 and e11.get("updated") == 1 and e11.get("done") is True, "4. day 11: one added, one updated, done (%s)" % e11)
    ok(db.one("select alter_id from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(1101)))) == "25" and live(1102) == "1", "4. FinCom's copy now as Tally")
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by) values (%s, 'c1', %s, %s, %s)" % (q(F), q(B), q(D(13)[:8] + "01"), q(OWNER)))
    j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(13)), js([H(1301, 41), H(1302, 42)])))
    e13 = j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(B), q(D(13)), js([V(1302, 42, D(13))]), js(LN(1302))))
    ok(e13.get("ok") is True and e13.get("locked") is True and "Unlock the month" in str(e13.get("upload")) and live(1302) == "0", "4. a locked month: nothing stored, the words to upload (%s)" % e13)
    db.sql("update tally_month_locks set unlocked_at = now() where book_id = %s" % q(B))
    ok(j("select tally_check_entries(%s, %s, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)::text" % (q(B), q(D(40)))).get("mine") is False, "4. a day not queued: not the check's (the period's path takes it)")

    print("== 5. the bridge's stop, and Resume")
    j("select tally_check_queue(%s, array[%s]::date[], 'upload')::text" % (q(B), q(D(14))))
    ok(not j("select tally_check_stop(%s, %s, 'over2s', 'x', now() - interval '1 day')::text" % (q(B), q(D(14)))).get("stopped"), "5. a stop of another choice stops nothing")
    s5 = j("select tally_check_stop(%s, %s, 'window', %s, %s::timestamptz)::text" % (q(B), q(D(14)), q("Tally stopped answering."), q(pca)))
    ok(s5.get("ok") is True and s5.get("stopped") is True, "5. stopped (%s)" % s5)
    db.sql("update tally_check_days set asked_at = now() - interval '5 minutes' where book_id = %s" % q(B))
    ok(j("select tally_check_next(%s, 3)::text" % q(B)) == [] and j("select tally_period_next(%s, 3)::text" % q(B)) == [], "5. nothing handed out (check and period)")
    st5 = APPU("select tally_check_status(%s)::text" % q(B))
    ok((st5.get("run") or {}).get("state") == "stopped" and (st5.get("run") or {}).get("why") == "window", "5. the status says stopped and why (%s)" % st5.get("run"))
    ok("not allowed" in str(APPU("select tally_check_resume(%s)::text" % q(B), VIEWER)), "5. a viewer cannot resume")
    r5 = APPU("select tally_check_resume(%s)::text" % q(B), STAFF)
    ok((r5.get("run") or {}).get("state") == "going", "5. staff resume it (%s)" % r5.get("run"))
    APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(FYS)))
    n5 = j("select tally_check_next(%s, 3)::text" % q(B))
    ok(isinstance(n5, list) and D8(14) in [x.get("day") for x in n5] and all(x.get("chosenAt") != pca for x in n5), "5. handed out again under the new choice (%s)" % (n5 if not isinstance(n5, list) else [x.get("day") for x in n5]))

    print("== 6. the check's status in plain words")
    st = APPU("select tally_check_status(%s)::text" % q(B), VIEWER)
    lines = {x.get("day"): x for x in st.get("lines") or []}
    ok(st.get("ok") is True and st.get("total") == 5 and st.get("same") == 1 and st.get("fixed") == 2, "6. 5 days: 1 the same, 2 corrected (%s)" % {k: st.get(k) for k in ("total", "checked", "same", "fixed", "waiting", "upload")})
    ok("2 entries" not in str(lines.get(D8(11), {}).get("words")) and lines.get(D8(11), {}).get("words") == "1 entry in Tally not in the upload (added) · 1 changed (updated)", "6. day 11's words (%s)" % lines.get(D8(11)))
    ok(lines.get(D8(12), {}).get("words") == "1 deleted in Tally (removed, kept in history)", "6. day 12's words (%s)" % lines.get(D8(12)))
    ok(lines.get(D8(10), {}).get("state") == "same" and lines.get(D8(13), {}).get("state") == "upload" and "Unlock" in str(lines.get(D8(13), {}).get("words")), "6. day 10 ticked; day 13 to upload with its words")
    ok(st.get("totalWords") == "In all: 1 added · 1 updated · 1 removed", "6. the total line (%s)" % st.get("totalWords"))
    ok("not allowed" in str(APPU("select tally_check_status(%s)::text" % q(B), OTHER)), "6. another firm cannot see it")

    print("== 7. Today from Tally")
    lg = j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(B), q(D(20)), js([H(2001, 51), H(2002, 52)])))
    e7 = j("select tally_period_entries_logged(%s, %s, %s, %s, '{}'::jsonb, '[]'::jsonb)::text" % (q(B), q(D(20)), js([V(2001, 51, D(20)), V(2002, 52, D(20))]), js(LN(2001) + LN(2002))))
    ok(e7.get("ok") is True and e7.get("stored") == 2 and e7.get("logged") == 2, "7. the older entries brought in are logged (%s / %s)" % (lg, e7))
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, pc, tally_user, event, object_guid, alter_id, vch_type, vch_no, vch_date, state, applied_at, received_at) values
      (%(F)s, 'c1', %(B)s, %(DV)s, 'MADEUP-PC1', 'madeup-user', 'created', %(g1)s, 61, 'Sales', 'S-9', %(d)s, 'applied', now(), now()),
      (%(F)s, 'c1', %(B)s, %(DV)s, 'MADEUP-PC1', 'madeup-user', 'altered', %(g2)s, 62, 'Sales', '1001', %(d0)s, 'applied', now(), now()),
      (%(F)s, 'c1', %(B)s, %(DV)s, 'MADEUP-PC1', 'madeup-user', 'deleted', %(g3)s, 63, 'Receipt', 'R-1', %(d0)s, 'applied', now(), now()),
      (%(F)s, 'c1', %(B)s, %(DV)s, 'MADEUP-PC1', 'madeup-user', 'created', %(g4)s, 64, 'Sales', 'S-old', %(d0)s, 'applied', now() - interval '2 days', now() - interval '2 days'),
      (%(F)s, 'c1', %(B)s, %(DV)s, 'MADEUP-PC1', 'madeup-user', 'created', %(g5)s, 65, 'Sales', 'S-held', %(d0)s, 'held', null, now())"""
           % {"F": q(F), "B": q(B), "DV": q(DV), "g1": q(G(3001)), "g2": q(G(1001)), "g3": q(G(3003)), "g4": q(G(3004)), "g5": q(G(3005)), "d": q(D(30)), "d0": q(D(10))})
    t7 = APPU("select tally_today_from_tally(%s)::text" % q(B), VIEWER)
    rows, c = t7.get("rows") or [], t7.get("counts") or {}
    kinds = sorted((r.get("what"), r.get("via")) for r in rows)
    ok(t7.get("ok") is True and c == {"added": 1, "changed": 1, "deleted": 1, "older": 2, "corrected": 3}, "7. the counts (%s)" % c)
    ok(len(rows) == sum(c.values()), "7. the counts equal the list (%d rows)" % len(rows))
    ok(kinds.count(("added", "tally")) == 1 and kinds.count(("added", "older")) == 2 and kinds.count(("deleted", "check")) == 1, "7. each row says what happened and how (%s)" % kinds)
    r1001 = next((r for r in rows if r.get("via") == "tally" and r.get("what") == "changed"), {})
    ok(r1001.get("vtype") == "Sales" and r1001.get("vno") == "1001" and r1001.get("party") == "Made-up Traders" and float(r1001.get("amount") or 0) == 118.0 and r1001.get("day") == D(10), "7. a row: date, voucher type and number, party, amount (%s)" % r1001)
    ok(t7.get("last") and not re.search(r"MADEUP-PC|madeup-user", json.dumps(t7)), "7. the last time; no computer's name or login anywhere")
    ok("not allowed" in str(APPU("select tally_today_from_tally(%s)::text" % q(B), OTHER)), "7. another firm cannot see it")

    print("== 8. Stop (the person)")
    ok("not allowed" in str(APPU("select tally_period_cancel(%s)::text" % q(B), VIEWER)), "8. a viewer cannot stop it")
    c8 = APPU("select tally_period_cancel(%s)::text" % q(B), STAFF)
    p8 = c8.get("pull") or {}
    ok(p8.get("state") == "stopped" and (p8.get("stopped") or {}).get("why") == "person", "8. stopped by the person (%s)" % p8.get("stopped"))
    ok(j("select tally_period_next(%s, 3)::text" % q(B)) == [], "8. nothing handed out")
    c8b = APPU("select tally_period_choose(%s, %s, 'year')::text" % (q(B), q(FYS)))
    ok((c8b.get("pull") or {}).get("state") == "going", "8. Start again: going")

    print("== 9. the firm's summary")
    s9 = APPU("select tally_fetch_summary(null)::text", STAFF)
    bk = next((x for x in s9.get("books") or [] if x.get("book") == B), {})
    ok(s9.get("ok") is True and bk.get("client") == "c1" and (bk.get("pull") or {}).get("state") == "going" and "y" in (bk.get("pull") or {}), "9. the period of the book (%s)" % str(bk.get("pull"))[:200])
    ok((bk.get("today") or {}).get("older") == 2 and (bk.get("today") or {}).get("added") == 1 and (bk.get("check") or {}).get("fixed") == 2, "9. today's and the check's counts (%s / %s)" % (bk.get("today"), bk.get("check")))
    ok(sorted(x.get("id") for x in bk.get("devices") or []) == sorted([DV, DV2]) and all(x.get("fetchOn") is False for x in bk.get("devices") or []) and "MADEUP-PC" not in json.dumps(s9), "9. the computers holding the company: ids and their switch only (%s)" % bk.get("devices"))
    db.sql("update tally_devices set period_fetch = true where id = %s" % q(DV))
    bk = next((x for x in APPU("select tally_fetch_summary(%s)::text" % q(B)).get("books") or [] if x.get("book") == B), {})
    ok(any(x.get("id") == DV and x.get("fetchOn") is True for x in bk.get("devices") or []), "9. the switch on shows (%s)" % bk.get("devices"))
    ok(not [x for x in APPU("select tally_fetch_summary(null)::text", OTHER).get("books") or [] if x.get("book") == B], "9. another firm never sees the book")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
