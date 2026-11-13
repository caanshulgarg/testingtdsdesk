"""python3 tests/run_migration186.py - server/security/migration-186-default-grants.sql (13-Nov-2026, branch next-sec-db):
what a new table of public gives by default, the server's own tables, and anon. On a throwaway PostgreSQL (pg_stand,
port 31186 unless PG186_PORT; never a real database), made-up rows only. The stand is given staging's shape first: the
default privileges of the roles that make tables give anon and authenticated everything, the server's tables (row
security on, no policy) hold it, tables with a policy hold what migration 97 wrote.
  0. the file: one transaction, lock_timeout 10 s; nothing dropped, deleted or created, no policy or function touched;
     names no real database; its md5
  1. runs, and a second time
  2. a table and a sequence made afterwards (by postgres, by supabase_admin): nothing for anon or authenticated;
     service_role as before
  3. the server's tables: nothing for public, anon or authenticated (a read refused for both), service_role unchanged
  4. anon: no privilege on any table, view, column or sequence of public
  5. authenticated: reads and writes what it did (a table with a policy, its rows only; an insert through a serial, an
     identity and a column grant), cannot set a sequence, holds no sequence of a table it cannot insert into
  6. every policy, every function's grants and everything service_role holds: the same before and after
RED_WITHOUT_186=1: the same checks without running 186 (2, 3, 4 and 5's sequence checks fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M186 = os.path.join(ROOT, "server", "security", "migration-186-default-grants.sql")
RED = os.environ.get("RED_WITHOUT_186") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M186).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M186), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(code.count("begin;") == 1 and code.count("commit;") == 1 and code.strip().startswith("begin;") and code.strip().endswith("commit;")
   and "set local lock_timeout = '10s';" in code, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\b|\btruncate\b|delete\s+from|\bcreate\b|alter\s+(table|policy|function)|\binsert\s+into\b|\bupdate\s+[a-z_.]+\s+set\b", code),
   "nothing dropped, deleted, created or altered but the default privileges; no policy or function touched")
ok(not re.search(r"\bto\s+(anon|public)\b", code) and not re.search(r"grant\s+(?!usage on sequence %s to authenticated)", code.replace("execute format('", "")),
   "its only grant: usage on the sequences authenticated inserts through")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "names no real database")

SERVER_ONLY = ["tally_check_asks", "tally_check_days", "tally_check_runs", "tally_fetch_log", "tally_gap_closes", "tally_gap_numbers", "tally_gap_retries",
               "tally_held_reads", "tally_light_days", "tally_light_pace", "tally_period_skips"]
F1, F2 = "99999999-9999-4999-8999-999999990183", "88888888-8888-4888-8888-888888880183"
U1, U2 = "aaaaaaaa-0183-4000-8000-000000000001", "aaaaaaaa-0183-4000-8000-000000000002"
SETUP = """
do $x$ declare r text; begin foreach r in array array['service_role', 'supabase_admin'] loop
  if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %%I', r); end if; end loop; end $x$;
alter role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
grant create on schema public to supabase_admin;
-- staging's default privileges (13-Nov-2026): the roles that make tables give everything
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
grant select on members, firms to anon, authenticated;
insert into firms values ('%(F1)s', 'Made-up Firm One'), ('%(F2)s', 'Made-up Firm Two');
insert into members values ('%(U1)s', '%(F1)s', 'Made-up Owner', 'owner', true), ('%(U2)s', '%(F2)s', 'Made-up Other', 'owner', true);
-- the server's own tables: row security on, no policy, the default privileges left on them
%(server_only)s
create table tally_fetch_log2 (id bigserial primary key, firm_id uuid, what text); alter table tally_fetch_log2 enable row level security;
-- tables with a policy, as migration 97 wrote them (anon: select; authenticated: what the app uses)
create table t_rows (firm_id uuid, id text, data jsonb, primary key (firm_id, id));
alter table t_rows enable row level security;
create policy t_rows_read on t_rows for select to authenticated using (firm_id = my_firm());
revoke all on t_rows from anon, authenticated; grant select on t_rows to anon, authenticated;
create table client_timings (id bigserial primary key, firm_id uuid, user_id uuid, what text);
alter table client_timings enable row level security;
create policy client_timings_insert_own on client_timings for insert to authenticated with check (user_id = auth.uid() and firm_id = my_firm());
create policy client_timings_read on client_timings for select to authenticated using (firm_id = my_firm());
revoke all on client_timings from anon, authenticated; grant select, insert on client_timings to authenticated;
revoke all on sequence client_timings_id_seq from anon, authenticated; grant usage on sequence client_timings_id_seq to authenticated;
create table activity (id bigserial primary key, firm_id uuid, user_id uuid, what text, at timestamptz default now());
alter table activity enable row level security;
create policy activity_add on activity for insert to authenticated with check (firm_id = my_firm());
create policy activity_read on activity for select to authenticated using (firm_id = my_firm());
revoke all on activity from anon, authenticated; grant select on activity to anon, authenticated; grant insert (firm_id, user_id, what) on activity to authenticated;
create table app_alert_dismissals (id bigint generated always as identity primary key, firm_id uuid, user_id uuid);
alter table app_alert_dismissals enable row level security;
create policy app_alert_dismissals_own on app_alert_dismissals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on app_alert_dismissals from anon; revoke all on sequence app_alert_dismissals_id_seq from anon;
create view t_rows_view with (security_invoker = true) as select firm_id, id from t_rows;
grant select (name) on firms to anon;
create or replace function t_open() returns int language sql security definer set search_path = public as $f$ select 1 $f$;
revoke all on function t_open() from public; grant execute on function t_open() to anon, authenticated;
insert into t_rows values ('%(F1)s', 'a', '{}'), ('%(F2)s', 'b', '{}');
""" % dict(F1=F1, F2=F2, U1=U1, U2=U2, server_only="\n".join(
    "create table %s (%s firm_id uuid, book_id uuid, note text); alter table %s enable row level security;"
    % (t, "id bigserial primary key," if t in ("tally_fetch_log", "tally_gap_closes") else "", t) for t in SERVER_ONLY))
ACL = """select c.relname as n, g.rolname as ro, string_agg(lower(a.privilege_type), ',' order by lower(a.privilege_type)) as p
  from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'S') and g.rolname = any(%s) group by 1, 2 order by 1, 2"""
def acl(db, roles):
    return {(r["n"], r["ro"]): r["p"] for r in db.rows(ACL % ("array[" + ",".join("'%s'" % x for x in roles) + "]"))}
def refused(db, sql):
    try: db.sql(sql); return ""
    except RuntimeError as e: return str(e)
db = pg_stand.start(int(os.environ.get("PG186_PORT") or 31186))
try:
    db.sql(SETUP)
    pol0 = db.rows("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2")
    fn0 = db.rows("select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1")
    svc0 = acl(db, ["service_role"])
    print("== 1. runs")
    if not RED:
        e = ""
        try: db.sql(text); db.sql(text)
        except RuntimeError as x: e = str(x)
        ok(not e, "runs, and a second time" + (": " + e[-400:] if e else ""))
    print("== 2. made afterwards")
    db.sql("create table t_after (id bigserial primary key, firm_id uuid); set role supabase_admin; create table t_after_admin (id bigserial primary key); reset role;")
    a = acl(db, ["anon", "authenticated", "service_role"])
    left = sorted(k for k in a if k[0].startswith("t_after") and k[1] != "service_role")
    ok(not left, "a table and its sequence made by postgres or supabase_admin: nothing for anon or authenticated" + (": " + str(left) if left else ""))
    ok(all((n, "service_role") in a for n in ("t_after", "t_after_id_seq", "t_after_admin", "t_after_admin_id_seq")), "service_role on them as before")
    d = db.rows("select distinct d.defaclrole::regrole::text as r, d.defaclobjtype::text as t from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a join pg_roles g on g.oid = a.grantee where d.defaclnamespace = 'public'::regnamespace and g.rolname in ('anon', 'authenticated')")
    ok(not d, "no default privilege of public names anon or authenticated" + (": " + str(d) if d else ""))
    print("== 3. the server's tables")
    a = acl(db, ["anon", "authenticated", "service_role"])
    held = sorted(k for k in a if k[0] in SERVER_ONLY + ["tally_fetch_log2"] and k[1] != "service_role")
    ok(not held, "the %d tables with row security and no policy: nothing for anon or authenticated%s" % (len(SERVER_ONLY) + 1, ": " + str(held[:6]) if held else ""))
    pub = db.one("select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and a.grantee = 0 and c.relkind in ('r', 'p')")
    ok(pub == "0", "nor for public")
    for ro in ("anon", "authenticated"):
        e = refused(db, "set role %s; set fincom.uid = '%s'; select count(*) from tally_check_asks; insert into tally_gap_closes (note) values ('x');" % (ro, U1))
        ok("permission denied" in e, "%s: a read of tally_check_asks is refused" % ro)
    ok(db.one("set role service_role; insert into tally_gap_closes (note) values ('made-up') returning note") == "made-up", "service_role writes them as before")
    print("== 4. anon")
    n = sorted(k[0] for k in acl(db, ["anon"]))
    ok(not n, "no privilege on any table, view or sequence of public" + (": " + " ".join(n[:10]) if n else ""))
    c = db.one("select count(*) from pg_attribute a join pg_class k on k.oid = a.attrelid cross join lateral aclexplode(a.attacl) x join pg_roles g on g.oid = x.grantee where k.relnamespace = 'public'::regnamespace and g.rolname = 'anon'")
    ok(c == "0", "nor on a column")
    ok(db.one("set role anon; select t_open()") == "1", "a function open to anon still answers")
    print("== 5. authenticated")
    r = db.rows("set role authenticated; set fincom.uid = '%s'; select id from t_rows" % U1)
    ok([x["id"] for x in r] == ["a"], "a table with a policy: its own firm's rows only")
    ok(db.one("set role authenticated; set fincom.uid = '%s'; select count(*) from t_rows_view" % U1) == "1", "and through the view")
    e = refused(db, "set role authenticated; set fincom.uid = '%s'; insert into client_timings (firm_id, user_id, what) values ('%s', '%s', 'open');"
                    "insert into activity (firm_id, user_id, what) values ('%s', '%s', 'made-up'); insert into app_alert_dismissals (firm_id, user_id) values ('%s', '%s');" % (U1, F1, U1, F1, U1, F1, U1))
    ok(not e, "inserts through a serial (client_timings), a column grant (activity) and an identity (app_alert_dismissals)" + (": " + e[-300:] if e else ""))
    e = refused(db, "set role authenticated; set fincom.uid = '%s'; insert into client_timings (firm_id, user_id, what) values ('%s', '%s', 'other firm');" % (U1, F2, U1))
    ok("row-level security" in e, "an insert for another firm is refused by the policy as before")
    e = refused(db, "set role authenticated; select setval('client_timings_id_seq', 1);")
    ok("permission denied" in e, "cannot set a sequence")
    a = acl(db, ["authenticated"])
    seqs = {k[0]: v for k, v in a.items() if k[0].endswith("_seq")}
    ok(seqs == {"client_timings_id_seq": "usage", "activity_id_seq": "usage", "app_alert_dismissals_id_seq": "usage"}, "holds usage on the sequences it inserts through and no other: %s" % seqs)
    ok(a.get(("t_rows", "authenticated")) == "select" and a.get(("client_timings", "authenticated")) == "insert,select", "its table privileges with a policy: as before")
    print("== 6. unchanged")
    pol1 = db.rows("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2")
    fn1 = db.rows("select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as a from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1")
    ok(pol0 == pol1 and len(pol0) == 6, "every policy (%d)" % len(pol1))
    ok(fn0 == fn1, "every function's grants (%d)" % len(fn1))
    svc1 = acl(db, ["service_role"])
    ok(all(svc1.get(k) == v for k, v in svc0.items()), "everything service_role held")
    ok(db.one("select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity and c.relname like 'tally_%' and c.relname = any(array[" + ",".join("'%s'" % t for t in SERVER_ONLY) + "])") == "0", "row security still on the server's tables")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
