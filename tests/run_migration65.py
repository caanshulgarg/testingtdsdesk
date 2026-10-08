"""python3 run_migration65.py - migration-65-selfchecks (07-Oct-2026, next release, item e: the nightly self-check;
docs/selfcheck-requests-for-approval.md). On throwaway PostgreSQL (pg_stand, port 30650 unless PG65_PORT; never a real
database), built 32 -> ... -> 58 -> 59 -> 60 in staging's order (as run_migration60.py), then 65 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere (comments
     included), no drop / truncate / update of another table, one new table (tally_selfchecks), four NEW functions (none
     existed before: nothing replaced), no real database named; md5 printed.
  1. before 65 (red): no tally_selfchecks, no tally_selfcheck_* function.
  2. it runs twice; the second run changes nothing (the functions' md5s, the policy, the grants).
  3. privileges: row security on; anon nothing; authenticated SELECT only (no insert, update, delete, truncate) and only its
     own firm's rows; the four functions executable by the service role only (anon and authenticated refused when they try).
  4. tally_selfcheck_compare: absent / older / deleted found, the same AlterID or a newer one in FinCom is not missing; the
     highest AlterID held; more than 5,000 entries refused; reads only.
  5. tally_selfcheck_copy: a balanced copy is ok; an entry whose lines do not add up, a ready total out of step with its
     entries, ledgers named by entries but not in the list, openings that do not add up: each found, with examples.
  6. tally_selfcheck_record: ok / fetched / missing (the Day Book's days) / not_checked (from the last good night) in plain
     words; the result, the copy check and the highest AlterID kept; counts clamped (fetched never above missing); another
     firm's book refused; every call a new row (never updated); nothing but tally_selfchecks written (every other table's
     rows hashed before and after).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql")]
M65 = os.environ.get("M65_FILE") or os.path.join(SQLDIR, "migration-65-selfchecks.sql")
FNS = ["tally_selfcheck_compare", "tally_selfcheck_copy", "tally_selfcheck_record", "tally_selfcheck_words"]
SIGS = {"tally_selfcheck_compare": "uuid, jsonb", "tally_selfcheck_copy": "uuid", "tally_selfcheck_record": "uuid, uuid, uuid, text, jsonb",
        "tally_selfcheck_words": "text, timestamptz, date, date, integer, integer, integer, integer, integer, bigint, text, text, date[], jsonb, jsonb"}
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, OTHER = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444"
B, B2, D1 = "f79e4bc3-871d-4482-874d-000000000062", "f79e4bc3-871d-4482-874d-000000000063", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda n: CG + "-%08x" % n

text = open(M65).read() if os.path.exists(M65) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M65))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
import hashlib
print("  migration-65 md5: %s" % hashlib.md5(open(M65, "rb").read()).hexdigest())
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\bupdate\s+(public\.)?tally_", low), "0. add-only (no drop, truncate, update of a table)")
ok(re.findall(r"create table if not exists public\.(\w+)", text) == ["tally_selfchecks"] and re.findall(r"alter table public\.(\w+)", text) == ["tally_selfchecks"]
   and "enable row level security" in low, "0. one new table, tally_selfchecks; the only table statement after it is its row security")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text))) == FNS, "0. four functions: %s" % FNS)
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")

db = pg_stand.start(int(os.environ.get("PG65_PORT") or 30650))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def err(sql, pre=""):
    r = psql_text(pre + sql)
    return r.returncode != 0, r.stderr[-300:]
def md5s(): return {f: db.one("select md5(prosrc) from pg_proc where oid = 'public.%s(%s)'::regprocedure" % (f, SIGS[f])) for f in FNS}
def tables_hash():
    names = [r["t"] for r in db.rows("select tablename as t from pg_tables where schemaname = 'public' and tablename <> 'tally_selfchecks' order by 1")]
    return {t: db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.%s x" % t) for t in names}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company'), (%(F2)s, 'Another firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2026-04-01', '2026-03-31'),
        (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" %
           {"F": q(F), "F2": q(F2), "O": q(OWNER), "X": q(OTHER), "B": q(B), "B2": q(B2), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    for r in ("anon", "authenticated", "service_role"):
        db.sql("grant usage on schema public to %s; grant usage on schema auth to %s; grant execute on function auth.uid() to %s; grant execute on function public.my_firm() to %s" % (r, r, r, r))

    print("== 1. before 65")
    ok(db.one("select count(*) from pg_class where relname = 'tally_selfchecks'") == "0" and db.one("select count(*) from pg_proc where proname like 'tally_selfcheck%'") == "0",
       "1. no tally_selfchecks and no tally_selfcheck_* function before 65 (nothing replaced)")

    # a copy: three live entries that add up, one deleted; the ledgers and their ready totals
    db.sql("""insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%(B)s, %(F)s, 'Cash', 'Cash-in-Hand', -1000), (%(B)s, %(F)s, 'Capital', 'Capital Account', 1000),
        (%(B)s, %(F)s, 'Sales', 'Sales Accounts', 0), (%(B)s, %(F)s, 'Party A', 'Sundry Debtors', 0);
      insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional) values
        (%(B)s, %(F)s, %(g1)s, '2026-10-03', 10, 'Sales', '1', 'Party A', '', false, false), (%(B)s, %(F)s, %(g2)s, '2026-10-03', 20, 'Sales', '2', 'Party A', '', false, false),
        (%(B)s, %(F)s, %(g3)s, '2026-10-05', 30, 'Receipt', '3', 'Party A', '', false, false);
      update tally_vouchers set deleted_at = now() where book_id = %(B)s and guid = %(g2)s;
      insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%(B)s, %(F)s, %(g1)s, '2026-10-03', 'Party A', -100), (%(B)s, %(F)s, %(g1)s, '2026-10-03', 'Sales', 100),
        (%(B)s, %(F)s, %(g3)s, '2026-10-05', 'Cash', -100), (%(B)s, %(F)s, %(g3)s, '2026-10-05', 'Party A', 100);
      select tally_ledger_day_rebuild(%(B)s, array['2026-10-03', '2026-10-05']::date[]);""" % {"B": q(B), "F": q(F), "g1": q(G(1)), "g2": q(G(2)), "g3": q(G(3))})

    print("== 2. 65 runs twice")
    r1 = psql_text(text); ok(r1.returncode == 0, "65 runs (first time): %s" % r1.stderr[-300:])
    m1 = md5s()
    r2 = psql_text(text); ok(r2.returncode == 0, "65 runs (second time): %s" % r2.stderr[-300:])
    ok(md5s() == m1 and all(m1.values()), "2. the second run changes no function (%s)" % m1)
    for f, m in sorted(m1.items()): print("  %s prosrc md5: %s" % (f, m))
    ok(db.one("select count(*) from pg_policies where tablename = 'tally_selfchecks'") == "1", "2. one read policy, not two")

    print("== 3. privileges")
    ok(db.one("select relrowsecurity::text from pg_class where relname = 'tally_selfchecks'") == "true", "3. row security on")
    priv = lambda role, p: db.one("select has_table_privilege(%s, 'public.tally_selfchecks', %s)::text" % (q(role), q(p)))
    ok(all(priv("anon", p) == "false" for p in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE")), "3. anon: nothing on the table")
    ok(priv("authenticated", "SELECT") == "true" and all(priv("authenticated", p) == "false" for p in ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")), "3. authenticated: SELECT only")
    for f in FNS:
        ex = lambda role: db.one("select has_function_privilege(%s, 'public.%s(%s)', 'execute')::text" % (q(role), f, SIGS[f]))
        ok(ex("service_role") == "true" and ex("anon") == "false" and ex("authenticated") == "false" and
           db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.%s(%s)'::regprocedure" % (f, SIGS[f])) == "true search_path=public, pg_temp",
           "3. %s: security definer, search_path public, pg_temp, the service role only" % f)
    bad, e = err("select public.tally_selfcheck_compare(%s, '[]'::jsonb);" % q(B), "set role authenticated;\n")
    ok(bad and "permission denied" in e, "3. authenticated calling compare: refused (%s)" % e.strip()[-80:])
    bad, e = err("select public.tally_selfcheck_record(%s, %s, null, 'x', '{}'::jsonb);" % (q(F), q(B)), "set role anon;\n")
    ok(bad and "permission denied" in e, "3. anon calling record: refused")
    bad, e = err("insert into public.tally_selfchecks (firm_id, book_id, result) values (%s, %s, 'ok');" % (q(F), q(B)), "set role authenticated;\n")
    ok(bad, "3. authenticated cannot insert a row")

    print("== 4. compare")
    before = tables_hash()
    c = j("select tally_selfcheck_compare(%s, %s)::text" % (q(B), js([[G(1), 10, 1, "20261003"], [G(2), 25, 2, "20261003"], [G(3), 35, 3, "20261005"], [G(4), 40, 4, "20261006"], [G(1), 9, 1, "20261003"]])))
    miss = {m["guid"]: m["why"] for m in c.get("missing", [])}
    ok(miss == {G(2): "deleted", G(3): "older", G(4): "absent"}, "4. deleted, older, absent found; the same or an older AlterID than FinCom's is not missing (%s)" % c)
    ok(c.get("received") == 30 and c.get("n") == 5, "4. the highest AlterID the copy holds, the entries counted (%s %s)" % (c.get("received"), c.get("n")))
    big = j("select tally_selfcheck_compare(%s, (select jsonb_agg(jsonb_build_array('g' || i, i)) from generate_series(1, 5001) i))::text" % q(B))
    ok("at most 5000" in json.dumps(big), "4. more than 5,000 entries refused (%s)" % str(big)[:120])
    ok(tables_hash() == before, "4. compare writes nothing")

    print("== 5. the copy's own check")
    cp = j("select tally_selfcheck_copy(%s)::text" % q(B))
    ok(cp.get("ok") is True and cp.get("entries") == 2 and cp.get("unbalanced") == 0 and cp.get("totalsOff") == 0 and float(cp.get("movement")) == 0 and float(cp.get("openings")) == 0 and cp.get("unknownLedgers") == 0,
       "5. a balanced copy is ok (%s)" % cp)
    # an entry that does not add up (its line to Rent, a ledger not in the list), a ready total put out of step, an opening changed
    db.sql("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional) values (%(B)s, %(F)s, %(g)s, '2026-10-06', 40, 'Journal', 'J9', '', '', false, false);""" % {"B": q(B), "F": q(F), "g": q(G(9))})
    db.sql("""insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%(B)s, %(F)s, %(g)s, '2026-10-06', 'Cash', -50), (%(B)s, %(F)s, %(g)s, '2026-10-06', 'Rent', 40);
      select tally_ledger_day_rebuild(%(B)s, array['2026-10-06']::date[]);
      update tally_ledger_day set amount = amount + 5 where book_id = %(B)s and ledger = 'Sales';
      update tally_ledgers set open = -990 where book_id = %(B)s and name = 'Cash';""" % {"B": q(B), "F": q(F), "g": q(G(9))})
    cp = j("select tally_selfcheck_copy(%s)::text" % q(B))
    ok(cp.get("ok") is False and cp.get("unbalanced") == 1 and (cp.get("unbalancedSome") or [{}])[0].get("no") == "J9", "5. an entry whose lines do not add up: found, named (%s)" % cp.get("unbalancedSome"))
    ok(cp.get("totalsOff") == 1 and (cp.get("totalsOffSome") or [{}])[0].get("ledger") == "Sales", "5. a ready total out of step with its entries: found (%s)" % cp.get("totalsOffSome"))
    ok(cp.get("unknownLedgers") == 1 and cp.get("unknownSome") == ["Rent"], "5. a ledger named by entries, not in the list: found (%s)" % cp.get("unknownSome"))
    ok(float(cp.get("openings")) == 10 and float(cp.get("movement")) == -5 and float(cp.get("tb")) == 5, "5. the openings' total and the movement (%s %s %s)" % (cp.get("openings"), cp.get("movement"), cp.get("tb")))
    words = db.one("select tally_selfcheck_words('ok', '2026-10-06 17:40+00', '2026-10-06', '2026-10-05', 3, 0, 0, 0, 0, 0, '', '', '{}', tally_selfcheck_copy(%s), '{}')" % q(B))
    ok("FinCom's copy: 1 entry does not add up to zero; the totals of 1 ledger differ from their entries; the year's entries total Rs 5.00 instead of zero; the openings differ by Rs 10.00 (Tally's difference in opening balances); 1 ledger named by entries is not in the ledger list." in words,
       "5. the copy's problems in plain words (%s)" % words)
    # put the copy right again for section 6
    db.sql("""update tally_vouchers set deleted_at = now() where book_id = %(B)s and guid = %(g)s; select tally_ledger_day_rebuild(%(B)s, array['2026-10-06', '2026-10-03']::date[]);
      update tally_ledgers set open = -1000 where book_id = %(B)s and name = 'Cash';""" % {"B": q(B), "g": q(G(9))})
    ok(j("select tally_selfcheck_copy(%s)::text" % q(B)).get("ok") is True, "5. put right: ok again")

    print("== 6. record")
    before = tables_hash()
    n0 = int(db.one("select count(*) from tally_selfchecks"))
    def rec(r, book=B, firm=F): return j("select tally_selfcheck_record(%s, %s, %s, 'go-1', %s)::text" % (q(firm), q(book), q(D1), js(r)))
    base = {"company": "GARG SHEKHAR & COMPANY", "company_guid": CG, "night": "20261006", "ran_at": "2026-10-06T23:10:00+05:30", "altvchid": 40, "altmstid": 9, "after": 1}
    a = rec(dict(base, listed=3, missing=0, fetched=0, still=0, since="20261005", gapDays=[]))
    # 2.4.0 review MEDIUM 2: the words say exactly what is checked: the entries that exist in Tally above the change
    # number checked from; deletes are not (a delete is not in Tally's list)
    ok(a.get("result") == "ok" and a.get("words", "").startswith("Checked on the night of 06-Oct-2026 at 23:10 IST: every entry that exists in Tally with a change number above 1 (changed since the night of 05-Oct-2026) is in FinCom (3 checked). Deletes made in Tally are not checked.")
       and a.get("words", "").endswith("FinCom's copy adds up.") and a.get("received") == 40 and "every change Tally made" not in a.get("words", ""), "6. ok, in plain words (%s)" % a.get("words"))
    a = rec(dict(base, listed=0, missing=0, fetched=0, still=0, altvchid=1))
    ok(a.get("result") == "ok" and "nothing changed in Tally since the last check (its change counter has not moved)." in a.get("words", ""), "6. nothing changed (%s)" % a.get("words"))
    a = rec(dict(base, listed=0, missing=0, fetched=0, still=0))
    ok(a.get("result") == "ok" and "no entry that exists in Tally has a change number above 1. Deletes made in Tally are not checked." in a.get("words", ""), "6. the counter moved, nothing listed: deletes not checked (%s)" % a.get("words"))
    a = rec(dict(base, listed=3, missing=0, fetched=0, still=0, since="20261005", sliceFrom="20261001", sliceTo="20261031"))
    ok("every entry dated 01-Oct-2026 to 31-Oct-2026 that exists in Tally with a change number above 1" in a.get("words", "") and "checked month by month" in a.get("words", ""), "6. a month slice: its dates said (%s)" % a.get("words"))
    a = rec(dict(base, listed=0, missing=0, fetched=0, still=0, restored=True, restoredFrom="20261003", since="20261003",
                 stopped="Tally was restored from a backup (its change counter went back from 50 to 40): re-check from 03-Oct-2026"))
    rr = db.rows("select data::text from tally_selfchecks where id = %s" % a.get("id"))[0] if a.get("id") else {}
    ok(a.get("result") == "not_checked" and a.get("words", "").startswith("Not checked on the night of 06-Oct-2026 (23:10 IST): Tally was restored from a backup (its change counter went back from 50 to 40): re-check from 03-Oct-2026. Upload the Day Book from 03-Oct-2026 to today")
       and '"restored": true' in rr.get("data", "") and '"restoredFrom": "20261003"' in rr.get("data", ""), "6. restored from a backup: flagged, re-check from that night (%s %s)" % (a.get("words"), rr))
    a = rec(dict(base, listed=3, missing=2, fetched=2, still=0, mastersBehind=1))
    ok(a.get("result") == "fetched" and "2 entries missing from FinCom; all 2 fetched from Tally. 1 master change in Tally not yet taken by FinCom." in a.get("words", ""), "6. fetched (%s)" % a.get("words"))
    a = rec(dict(base, listed=3, missing=3, fetched=0, still=3, deleted=1, fetchOff="Tally took 3.1 s for one entry", gapDays=["20261005", "20261003", "20261003", "bad"]))
    ok(a.get("result") == "missing" and "3 entries missing from FinCom (entries are not fetched for this company now: Tally took 3.1 s for one entry): upload the Day Book for 03-Oct-2026, 05-Oct-2026. 1 of them FinCom holds as deleted." in a.get("words", ""),
       "6. still missing: the Day Book's days (%s)" % a.get("words"))
    a = rec(dict(base, listed=0, missing=0, fetched=0, still=0, stopped="Tally took longer than 2 s to list its changes", since="20261004"))
    ok(a.get("result") == "not_checked" and a.get("words") == "Not checked on the night of 06-Oct-2026 (23:10 IST): Tally took longer than 2 s to list its changes. Upload the Day Book from 04-Oct-2026 to today to be sure nothing is missing.",
       "6. not checked: from the last good night (%s)" % a.get("words"))
    a = rec(dict(base, stopped="too many changes", since=None))
    ok("for the days worked on since the starting point" in a.get("words", ""), "6. not checked, no good night yet (%s)" % a.get("words"))
    a = rec(dict(base, listed="x", missing=2, fetched=99, still=-1, altvchid="1e99"))
    row = db.rows("select listed, missing_found, fetched, still_missing, tally_altvchid, result from tally_selfchecks where id = %s" % a.get("id"))[0] if a.get("id") else {}
    ok(row.get("listed") == "0" and row.get("fetched") == "2" and row.get("still_missing") == "0" and row.get("tally_altvchid") == "" and row.get("result") == "fetched", "6. bad numbers: 0 / null, fetched never above missing (%s)" % row)
    a = rec(dict(base, listed=1), book=B2)
    ok("not a book of this firm" in json.dumps(a), "6. another firm's book refused (%s)" % str(a)[:100])
    ok(int(db.one("select count(*) from tally_selfchecks")) == n0 + 10, "6. every call a new row")
    ok(tables_hash() == before, "6. nothing but tally_selfchecks written")
    r = db.rows("select night::text, since_night::text, gap_days::text, copy_ok::text, checked_from::text, bridge, device_id::text from tally_selfchecks where result = 'missing' order by id desc limit 1")[0]
    ok(r["night"] == "2026-10-06" and r["gap_days"] == "{2026-10-03,2026-10-05}" and r["copy_ok"] == "true" and r["checked_from"] == "1" and r["bridge"] == "go-1" and r["device_id"] == D1, "6. the row's fields (%s)" % r)
    # members read their own firm's rows only
    db.sql("insert into tally_selfchecks (firm_id, book_id, result, words) values (%s, %s, 'ok', 'another firm')" % (q(F2), q(B2)))
    mine = db.rows("set role authenticated; select count(*) as n, count(*) filter (where firm_id <> %s) as other from public.tally_selfchecks" % q(F), uid=OWNER)
    ok(mine and mine[0]["n"] == str(n0 + 10) and mine[0]["other"] == "0", "3. a member reads their own firm's rows only (%s)" % mine)
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
