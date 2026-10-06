"""python3 run_live_members_fix.py - server/tally-cloud/live-members-fix.sql (06-Oct-2026), the owner's minimal fix for the
live database: authenticated loses INSERT, UPDATE and DELETE on public.members, so members_self (left in place) is inert and
a member can no longer make themselves owner. On throwaway PostgreSQL (pg_stand, port 30612; never a real database) with
Supabase's default grants (every public table granted to anon, authenticated and service_role), members, activity and
platform_admins as staging has them (tests/members_stand.py: the helpers, members_read, members_self, audit_members).
Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from', no drop, no policy touched,
     one statement (the revoke on members from authenticated), names no real database.
  1. before (red): 1a a staff member makes themselves owner (and audit_members logs it); 1b an inactive member switching
     themselves on, 1c moving to another firm, 1d their own user_id: refused by the policy's WITH CHECK; 1d their email
     changes.
  2. the file runs twice; no row changed (an md5 of every table's rows).
  3. after: 1a-1d refused (permission denied); a member still reads their own row and their firm's people; the service
     role (the admin edge function) still writes members; every other privilege of every role on every table, and
     members' SELECT / TRUNCATE / REFERENCES / TRIGGER for authenticated, exactly as before; the policy members_self is
     still there.
  4. the header's two read-only queries run, before and after (authenticated's members privileges; person.update rows)."""
import os, re, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand, members_stand as MS
FIX = os.environ.get("FIX_FILE") or os.path.join(HERE, "..", "server", "tally-cloud", "live-members-fix.sql")
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

text = open(FIX).read() if os.path.exists(FIX) else ""
ok(bool(text), "the file is there (%s)" % os.path.basename(FIX))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower(); code = "\n".join(l for l in re.sub(r"(?m)--.*$", "", low).splitlines() if l.strip())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0 and not re.search(r"\bdrop\b", low) and "policy" not in code, "0. no 'delete from', no drop, no policy touched (comments included for the first two)")
stm = [x.strip() for x in code.split(";") if x.strip() and not x.strip().startswith(("begin", "commit", "set local"))]
ok(stm == ["revoke insert, update, delete on table public.members from authenticated"], "0. one statement: revoke insert, update, delete on table public.members from authenticated (%s)" % stm)
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocs", low), "0. names no real database")
def line_at(s): return text.rindex("\n", 0, text.index(s)) + 1
CHECK1 = text[line_at("-- 1. authenticated"):line_at("-- 2. every change")]
CHECK2 = text[line_at("-- 2. every change"):line_at("--   Should a page")]
def sql_of(block): return "\n".join(l.strip()[2:].strip() for l in block.splitlines() if l.strip().startswith("--") and not l.strip()[2:].strip().startswith("--"))

db = pg_stand.start(30612)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                          input=sql, capture_output=True, text=True)
def grid():
    out = {}
    for x in db.rows("select r.rolname as ro, c.relname as t, p as pr from pg_class c cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'postgres')) r "
                     "cross join unnest(array[%s]) p where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and has_table_privilege(r.rolname, c.oid, p)" % ",".join(map(q, PRIVS))):
        out.setdefault((x["ro"], x["t"]), set()).add(x["pr"])
    return out
def fingerprint():
    ts = [r["n"] for r in db.rows("select relname as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")]
    return {r["t"]: r["m"] for r in db.rows(" union all ".join("select %s as t, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as m from public.%s x" % (q(t), t) for t in ts))}
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      create sequence if not exists public.activity_id_seq;
      create table if not exists public.activity (id bigint not null default nextval('activity_id_seq') primary key, firm_id uuid not null, user_id uuid default auth.uid(),
        client_id text not null default '', what text not null, detail text not null default '', at timestamptz not null default now());
      alter table public.activity enable row level security;
      create table if not exists public.platform_admins (user_id uuid primary key);
      alter table public.platform_admins enable row level security; alter table public.firms enable row level security;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;""")
    db.sql(MS.HELPERS); db.sql(MS.MEMBERS)
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing; insert into members (user_id, firm_id, name, email, role, active) values (%s, %s, 'Anshul', 'a@b.in', 'owner', true);" % (q(F), q(OWNER), q(F)))
    db.sql(MS.seed(q, F))
    ok(db.one("select has_table_privilege('authenticated', 'public.members', 'UPDATE')::text") == "true", "the stand: authenticated holds UPDATE on members (as on staging and live)")
    r = psql_text(sql_of(CHECK1)); before_q1 = r.stdout if r.returncode == 0 else r.stderr
    r2 = psql_text(sql_of(CHECK2))
    ok(r.returncode == 0 and r2.returncode == 0 and "UPDATE" in before_q1 and "user_id, firm_id, name, role, active, email, created_at" in before_q1,
       "4. before: the header's queries run; authenticated: UPDATE on members, every column %s" % ((r.stderr or "") + (r2.stderr or "")).strip()[-200:])
    print("       before:\n" + "\n".join("         " + l for l in before_q1.strip().splitlines()))
    mb0 = MS.run_cases(psql_text, q, F)
    for k, (res, w) in sorted(mb0.items()): print("       before  %-11s %-60s -> %s" % (k, w, res))
    ok(mb0["1a"][0] == "updated=1 audit=1", "1a. before: a staff member makes themselves owner, audit_members logs it (%s)" % mb0["1a"][0])
    ok(MS.rls_refused(mb0["1b"][0]) and MS.rls_refused(mb0["1c"][0]) and MS.rls_refused(mb0["1d-user_id"][0]) and mb0["1d-email"][0] == "updated=1 audit=1",
       "1b-1d. before: switching on, another firm, own user_id refused by the WITH CHECK; own email changes")
    g0, fp0 = grid(), fingerprint()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "2. pass %d: the fix runs %s" % (rnd, (r.stderr or "").strip()[-300:]))
        if r.returncode: raise SystemExit("cannot go on")
    ok(fingerprint() == fp0, "2. no row changed (%d tables)" % len(fp0))
    mb1 = MS.run_cases(psql_text, q, F)
    for k, (res, w) in sorted(mb1.items()): print("       after   %-11s %-60s -> %s" % (k, w, res))
    for k in ("1a", "1b", "1c", "1d-email", "1d-user_id"): ok(MS.refused(mb1[k][0]), "%s. after: %s: refused (%s)" % (k, mb1[k][1], mb1[k][0]))
    g1 = grid()
    want = dict(g0); want[("authenticated", "members")] = g0[("authenticated", "members")] - {"INSERT", "UPDATE", "DELETE"}
    ok(g1 == want and g1[("authenticated", "members")] == {"SELECT", "TRUNCATE", "REFERENCES", "TRIGGER"},
       "3. only authenticated's INSERT / UPDATE / DELETE on members went; every other privilege of every role as before (members for authenticated now %s)" % sorted(g1[("authenticated", "members")]))
    ok(db.one("select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'members' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')") == "0",
       "3. no column of members left writable by authenticated")
    rd = MS.attempt(psql_text, MS.STAFF_A, "select 'rows=' || count(*) from public.members;")
    ok(rd.startswith("rows=3"), "3. a member still reads their firm's people (members_read): %s" % rd)
    r = psql_text("set role service_role; update public.members set role = 'readonly' where user_id = %s; update public.members set active = true where user_id = %s; reset role;" % (q(MS.STAFF_A), q(MS.INACTIVE)))
    ok(r.returncode == 0 and db.one("select string_agg(role || ':' || active::text, ',' order by name) from members where user_id in (%s, %s)" % (q(MS.STAFF_A), q(MS.INACTIVE))) == "staff:true,readonly:true",
       "3. the service role (the admin edge function: set_person) still changes a role and switches a person on %s" % (r.stderr or "").strip()[-200:])
    ok(db.one("select count(*) from pg_policies where tablename = 'members' and policyname = 'members_self'") == "1", "3. the policy members_self is left in place (inert)")
    r = psql_text(sql_of(CHECK1)); r2 = psql_text(sql_of(CHECK2))
    print("       after:\n" + "\n".join("         " + l for l in r.stdout.strip().splitlines()))
    ok(r.returncode == 0 and r2.returncode == 0 and re.search(r"UPDATE\s*\|\s*f\s*\|\s*$", r.stdout, re.M) and re.search(r"INSERT\s*\|\s*f\s*\|\s*$", r.stdout, re.M) and re.search(r"DELETE\s*\|\s*f\s*\|", r.stdout, re.M)
       and "s@b.in role staff->readonly" in r2.stdout,
       "4. after: the header's query shows no INSERT / UPDATE / DELETE for authenticated (SELECT kept); the person.update query lists the service role's change just made (%d rows)" % len([l for l in r2.stdout.splitlines() if "person" in l or "role" in l]))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
