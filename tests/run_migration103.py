"""python3 run_migration103.py - migration-103-call-codes (23-Oct-2026, branch next-calls-meet; NOT run on staging) on a
throwaway PostgreSQL (pg_stand, port 31030 unless PG103_PORT; never a real database), after migration-102 as on staging:
  0. the file: one transaction, lock_timeout 10 s; add-only (drops only of the policy it makes again, no "delete from", no
     truncate, no column dropped or changed); names no real database; md5 printed
  1. runs, and runs a second time; rooms made before it get a code each (abc-defg-hij, no i, l or o), all different, kept
     on the second run
  2. the code is unique and of that form (a second room with the same code, or a wrong form, refused)
  3. grants: a member reads a room's code (and still never its channel key); the tries table: nobody but the service role;
     call_code_hit and call_new_code for the service role only
  4. call_code_hit counts per key and window: true up to the limit, false after it; another key counts on its own; a look
     (p_add 0) does not count
  5. call_captions: the firm's members read their firm's (a class's only the batch and the owner); nobody but the service
     role writes; call_pieces.lang readable
RED_WITHOUT_103=1: the same checks without running the file (1 to 5 fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M102 = os.path.join(HERE, "..", "server", "video-calls", "migration-102-video-calls.sql")
M = os.path.join(HERE, "..", "server", "video-calls", "migration-103-call-codes.sql")
RED = os.environ.get("RED_WITHOUT_103") == "1"
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
ok(all(d == "policy" for d in drops) and "delete from" not in code and "truncate" not in code
   and all(a[1] in ("add column", "add constraint", "enable row") for a in alters), "add-only (drops: %s; alters: %s)" % (sorted(set(drops)), sorted(set(a[1] for a in alters))))
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

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
db = pg_stand.start(int(os.environ.get("PG103_PORT") or 31030))
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
    ok(not e102, "migration 102 first, as on staging" + (": " + e102[:300] if e102 else ""))
    B = "bbbbbbbb-0000-0000-0000-000000000001"
    db.sql("insert into call_batches (id, firm_id, name) values ('%s', '%s', 'GST batch 1'); insert into call_batch_members (batch_id, firm_id, email) values ('%s', '%s', 'student@a.test');" % (B, F1, B, F1)
           + "".join("insert into call_rooms (firm_id, kind, client_id, title) values ('%s', 'client', 'c1', 'Old call %d');" % (F1, i) for i in range(40))
           + "insert into call_rooms (id, firm_id, kind, batch_id, title) values ('cccccccc-0000-0000-0000-000000000002', '%s', 'class', '%s', 'Class 1');" % (F1, B)
           + "insert into call_rooms (id, firm_id, kind, title) values ('cccccccc-0000-0000-0000-000000000003', '%s', 'help', 'Firm B call');" % F2)
    print("== 1. runs twice; old rooms get a code")
    if not RED:
        e1 = err(text); before = one("select string_agg(code, ',' order by id) from call_rooms"); e2 = err(text)
        ok(not e1 and not e2, "the file runs, and runs again" + (": " + (e1 or e2)[:400] if e1 or e2 else ""))
        ok(one("select string_agg(code, ',' order by id) from call_rooms") == before, "the second run keeps the codes")
    try: rows = db.rows("select code from call_rooms")
    except RuntimeError: rows = [{"code": None}]
    codes = [r["code"] for r in rows]
    ok(len(codes) == 42 and all(re.fullmatch(r"[a-hjkmnp-z]{3}-[a-hjkmnp-z]{4}-[a-hjkmnp-z]{3}", c or "") for c in codes), "each of the 42 rooms has a code like abc-defg-hij (%s)" % codes[:2])
    ok(len(set(codes)) == 42, "all different")
    print("== 2. unique, of its form")
    c0 = codes[0] or 'abc-defg-hjk'
    ok("duplicate key" in err("insert into call_rooms (firm_id, kind, title, code) values ('%s', 'help', 'x', '%s')" % (F1, c0)), "a second room with the same code refused")
    ok("violates check" in err("insert into call_rooms (firm_id, kind, title, code) values ('%s', 'help', 'x', 'abc-defg-hij')" % F1), "a code with i, l or o refused")
    ok("violates check" in err("insert into call_rooms (firm_id, kind, title, code) values ('%s', 'help', 'x', 'ABC-DEFG-HJK')" % F1), "capitals refused")
    ok(one("select count(*) from pg_indexes where indexname = 'call_rooms_code'") == "1", "its unique index")
    print("== 3. grants")
    n40 = read(STAFF, "select count(*) from (select id, title, code from public.call_rooms) x")
    ok(n40 == "40", "a member reads the codes of the firm's rooms (not the class they are not in): %s" % n40)
    ok("permission denied" in read(STAFF, "select chan_key from public.call_rooms limit 1"), "never the channel key")
    priv = lambda role, t: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
    ok(priv("authenticated", "call_code_tries") in ("", None) and priv("anon", "call_code_tries") in ("", None) and "INSERT" in (priv("service_role", "call_code_tries") or ""), "the tries: the service role only (%s / %s)" % (priv("authenticated", "call_code_tries"), priv("service_role", "call_code_tries")))
    fx = lambda r, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (r, f))
    ok(fx("authenticated", "public.call_code_hit(text, int, int, int)") == "false" and fx("anon", "public.call_code_hit(text, int, int, int)") == "false" and fx("service_role", "public.call_code_hit(text, int, int, int)") == "true", "call_code_hit: the service role only")
    ok(fx("authenticated", "public.call_new_code()") == "false" and fx("service_role", "public.call_new_code()") == "true", "call_new_code: the service role only")
    print("== 4. tries counted")
    hits = [one("set role service_role; select public.call_code_hit('ip:abc', 900, 3)::text") for _ in range(5)]
    ok(hits == ["true", "true", "true", "false", "false"], "within 3 then refused (%s)" % hits)
    ok(one("set role service_role; select public.call_code_hit('room:x', 900, 3)::text") == "true", "another key counts on its own")
    looks = [one("set role service_role; select public.call_code_hit('ip:look', 900, 2, 0)::text"), one("set role service_role; select public.call_code_hit('ip:look', 900, 2)::text"),
             one("set role service_role; select public.call_code_hit('ip:look', 900, 2, 0)::text"), one("set role service_role; select public.call_code_hit('ip:look', 900, 2)::text"),
             one("set role service_role; select public.call_code_hit('ip:look', 900, 2, 0)::text")]
    ok(looks == ["true", "true", "true", "true", "false"], "a look (0 added) says whether the limit is already reached, without counting (%s)" % looks)
    print("== 5. live subtitles kept with a recorded call")
    P = "dddddddd-0000-0000-0000-000000000001"
    R1 = one("select id from call_rooms where title = 'Old call 0'")
    err("insert into call_participants (id, room_id, firm_id, user_id, role, state) values ('%s', '%s', '%s', '%s', 'host', 'admitted');" % (P, R1, F1, STAFF)
           + "insert into call_participants (id, room_id, firm_id, user_id, role, state) values ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', '%s', '%s', 'host', 'admitted');" % (F1, OWN)
           + "insert into call_captions (room_id, firm_id, participant_id, who, start_ms, text, lang, tr) values ('%s', '%s', '%s', 'Riya', 1200, 'வணக்கம்', 'ta', '{\"hi\": \"नमस्ते\"}');" % (R1, F1, P)
           + "insert into call_captions (room_id, firm_id, batch_id, participant_id, who, start_ms, text, lang) values ('cccccccc-0000-0000-0000-000000000002', '%s', '%s', 'dddddddd-0000-0000-0000-000000000002', 'A', 0, 'class line', 'en');" % (F1, B))
    ok(read(STAFF, "select count(*) from public.call_captions") == "1" and read(STUDENT, "select count(*) from public.call_captions") == "2" and read(OTHER, "select count(*) from public.call_captions") == "0",
       "the firm reads its captions; a class's only the batch and the owner; another firm none")
    ok(read(STAFF, "select tr->>'hi' from public.call_captions") == "नमस्ते", "with the translations made")
    ok("permission denied" in err(as_(OWN) + "insert into public.call_captions (room_id, firm_id, participant_id, start_ms, text) values ('%s', '%s', '%s', 0, 'x')" % (R1, F1, P), OWN), "even the owner cannot write captions directly")
    ok(read(STAFF, "select count(lang) from public.call_pieces") == "0", "a transcript piece's language readable")
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
