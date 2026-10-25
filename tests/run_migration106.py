"""python3 run_migration106.py - migration-106-call-lobby (25-Oct-2026, branch next-calls-lobby; NOT run on staging) on a
throwaway PostgreSQL (pg_stand, port 31060 unless PG106_PORT; never a real database), after migrations 102 and 103 as on
staging:
  0. the file: one transaction, lock_timeout 10 s; add-only; names no real database; md5 printed
  1. runs, and runs a second time; the rows there before keep their state (seen_at, left_why empty)
  2. left_why only 'stale' or empty; the lobby's partial index
  3. call_watch: row-level security on, no policy; nobody but the service role reads or writes it
  4. grants: a member reads seen_at and left_why of the firm's people (never otp_hash or cf_session); writes only by the
     service role
RED_WITHOUT_106=1: the same checks without running the file (1 to 4 fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M102 = os.path.join(HERE, "..", "server", "video-calls", "migration-102-video-calls.sql")
M103 = os.path.join(HERE, "..", "server", "video-calls", "migration-103-call-codes.sql")
M = os.path.join(HERE, "..", "server", "video-calls", "migration-106-call-lobby.sql")
RED = os.environ.get("RED_WITHOUT_106") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
alters = re.findall(r"alter\s+table\s+([\w.]+)\s+(\w+(?:\s+\w+)?)", code)
ok(not drops and "delete from" not in code and "truncate" not in code and not re.search(r"^\s*update\s", code, re.M)
   and all(a[1] in ("add column", "add constraint", "enable row") for a in alters), "add-only (drops: %s; alters: %s)" % (sorted(set(drops)), sorted(set(a[1] for a in alters))))
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
ok("grant select (seen_at, left_why) on public.call_participants to authenticated" in text and "revoke all on public.call_watch from public, anon, authenticated" in text, "explicit grants")

STAND = r"""
create extension if not exists pgcrypto;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create table if not exists public.clients (id text primary key, firm_id uuid, name text, deleted boolean default false);
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
"""
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
OWN, STAFF, STUDENT, OTHER = ("aaaaaaaa-aaaa-aaaa-aaaa-%012d" % i for i in range(1, 5))
EMAIL = {OWN: "owner@a.test", STAFF: "staff@a.test", STUDENT: "student@a.test", OTHER: "o@b.test"}
db = pg_stand.start(int(os.environ.get("PG106_PORT") or 31060))
def as_(uid): return "set role authenticated; set request.jwt.claims = '{\"sub\":\"%s\",\"email\":\"%s\"}'; " % (uid, EMAIL[uid])
def err(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
def one(s, uid=None):
    try: return db.one(s, uid)
    except RuntimeError as e: return "ERROR " + str(e)[:300]
def read(uid, q): return one(as_(uid) + q, uid)
try:
    db.sql(STAND + ("insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'owner'), ('%s', '%s', 'staff'), ('%s', '%s', 'staff'), ('%s', '%s', 'owner');"
            % (F1, F2, OWN, F1, STAFF, F1, STUDENT, F1, OTHER, F2)) + " insert into clients values ('c1', '%s', 'Client One');" % F1
           + " grant usage on schema auth to authenticated, service_role; grant select on members, firms, clients to authenticated, service_role;")
    e102 = err(open(M102).read())
    e103 = err(open(M103).read())
    ok(not e102 and not e103, "migrations 102 and 103 first, as on staging" + (": " + (e102 or e103)[:300] if e102 or e103 else ""))
    B = "bbbbbbbb-0000-0000-0000-000000000001"
    db.sql("insert into call_batches (id, firm_id, name) values ('%s', '%s', 'GST batch 1'); insert into call_batch_members (batch_id, firm_id, email) values ('%s', '%s', 'student@a.test');" % (B, F1, B, F1)
           + "".join("insert into call_rooms (firm_id, kind, client_id, title) values ('%s', 'client', 'c1', 'Old call %d');" % (F1, i) for i in range(40))
           + "insert into call_rooms (id, firm_id, kind, batch_id, title) values ('cccccccc-0000-0000-0000-000000000002', '%s', 'class', '%s', 'Class 1');" % (F1, B)
           + "insert into call_rooms (id, firm_id, kind, title) values ('cccccccc-0000-0000-0000-000000000003', '%s', 'help', 'Firm B call');" % F2)
    R1 = one("select id from call_rooms where title = 'Old call 0'")
    db.sql("insert into call_participants (id, room_id, firm_id, user_id, role, state, admitted_at) values ('dddddddd-0000-0000-0000-000000000001', '%s', '%s', '%s', 'host', 'admitted', now());" % (R1, F1, STAFF)
           + "insert into call_participants (id, room_id, firm_id, name, role, state) values ('dddddddd-0000-0000-0000-000000000002', '%s', '%s', 'Dr. Anu Tyagi Garg', 'guest', 'waiting');" % (R1, F1))
    print("== 1. runs twice")
    if not RED:
        e1 = err(text); e2 = err(text)
        ok(not e1 and not e2, "the file runs, and runs again" + (": " + (e1 or e2)[:400] if e1 or e2 else ""))
    ok(one("select string_agg(state || ':' || coalesce(seen_at::text, '-') || ':' || coalesce(left_why, '-'), ',' order by id) from call_participants") == "admitted:-:-,waiting:-:-", "the rows there before keep their state, nothing filled in")
    print("== 2. left_why and the index")
    ok(not err("update call_participants set state = 'left', left_why = 'stale', seen_at = now() where id = 'dddddddd-0000-0000-0000-000000000002'"), "left (stale) written")
    ok("violates check" in err("update call_participants set left_why = 'bored' where id = 'dddddddd-0000-0000-0000-000000000002'"), "any other reason refused")
    ok(one("select count(*) from pg_indexes where indexname = 'call_participants_waiting' and indexdef like '%WHERE%waiting%'") == "1", "the lobby's partial index on waiting rows")
    print("== 3. call_watch")
    ok(one("select relrowsecurity::text from pg_class where relname = 'call_watch'") == "true" and one("select count(*) from pg_policies where tablename = 'call_watch'") == "0", "row-level security on, no policy")
    priv = lambda role, t: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
    ok(priv("authenticated", "call_watch") in ("", None) and priv("anon", "call_watch") in ("", None) and "INSERT" in (priv("service_role", "call_watch") or "") and "UPDATE" in (priv("service_role", "call_watch") or ""), "the service role only (%s / %s)" % (priv("authenticated", "call_watch"), priv("service_role", "call_watch")))
    ok(not err("set role service_role; insert into public.call_watch (user_id, firm_id) values ('%s', '%s') on conflict (user_id) do update set seen_at = now(); insert into public.call_watch (user_id, firm_id) values ('%s', '%s') on conflict (user_id) do update set seen_at = now();" % (STAFF, F1, STAFF, F1)), "the function's upsert, twice")
    ok("permission denied" in err(as_(OWN) + "select * from public.call_watch", OWN), "a member never reads it")
    print("== 4. grants on call_participants")
    ok(read(STAFF, "select count(seen_at)::text || '/' || count(left_why)::text from public.call_participants") == "1/1", "a member reads seen_at and left_why of the firm's people")
    ok("permission denied" in read(STAFF, "select otp_hash from public.call_participants limit 1") and "permission denied" in read(STAFF, "select cf_session from public.call_participants limit 1"), "never a code's hash or the call service's session")
    ok("permission denied" in err(as_(OWN) + "update public.call_participants set seen_at = now()", OWN), "nobody but the service role writes")
    ok(read(OTHER, "select count(*) from public.call_participants") == "0", "another firm reads none")
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
