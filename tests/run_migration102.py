"""python3 run_migration102.py - migration-102-video-calls (23-Oct-2026, branch next-video-calls; NOT run on staging) on a
throwaway PostgreSQL (pg_stand, port 31020 unless PG102_PORT; never a real database), with Storage and pg_cron made plain:
  0. the file: one transaction, lock_timeout 10 s; add-only (drops only of the policies it makes again, no "delete from",
     no truncate, no table altered but to turn row-level security on); names no real database; md5 printed
  1. runs, and runs a second time (and a third); the twelve tables, the two private buckets and the daily timer once
  2. grants are explicit: a member reads (a room without its channel key, a person without their code's hash or Cloudflare
     session); nobody but the service role writes; anon nothing; the owner functions for members, the sweep for the
     service role only
  3. row-level security: a member reads only the firm's calls; a class's room, recordings, transcript and chat only the
     batch's members (by sign-in email) and the owner; a soft-deleted recording is hidden
  4. the owner functions: a client's recording setting only by the owner, for the firm's own client; a recording deleted
     softly (still in the table, its reason kept), by the owner only
  5. the retention sweep marks recordings past their days deleted, nothing removed
  6. the bucket policy: the firm's folder only; a class's folder only for the batch and the owner
  7. the checks: a kind, a class without a batch, a client call without a client, a chat line too long or empty, a file
     over 20 MB, a batch email not lower case are refused
RED_WITHOUT_102=1: the same checks without running the file (1 to 7 fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "video-calls", "migration-102-video-calls.sql")
RED = os.environ.get("RED_WITHOUT_102") == "1"
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
ok(all(d == "policy" for d in drops) and "delete from" not in code and "truncate" not in code
   and not re.search(r"\balter\s+table\b(?!\s+public\.call_\w+\s+enable row level security)", code), "add-only (drops only of the policies it makes again: %s)" % sorted(set(drops)))
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
ok(len(re.findall(r"create table if not exists public\.(\w+)", text)) == 12, "twelve new tables")
ok(all(("enable row level security" in text and ("public." + t) in text.split("enable row level security")[0] + text) for t in re.findall(r"create table if not exists public\.(\w+)", text)), "each with row-level security")

STAND = r"""
create extension if not exists pgcrypto;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select on storage.objects, storage.buckets to authenticated;
create schema if not exists cron;
create table if not exists cron.job (jobname text primary key, schedule text, command text);
create or replace function cron.schedule(job_name text, sched text, cmd text) returns bigint language sql as $$
  insert into cron.job values (job_name, sched, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create table if not exists public.clients (id text primary key, firm_id uuid, name text, deleted boolean default false);
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
"""
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
OWN, STAFF, LOOK, STUDENT, OTHER = ("aaaaaaaa-aaaa-aaaa-aaaa-%012d" % i for i in range(1, 6))
EMAIL = {OWN: "owner@a.test", STAFF: "staff@a.test", LOOK: "look@a.test", STUDENT: "student@a.test", OTHER: "o@b.test"}
db = pg_stand.start(int(os.environ.get("PG102_PORT") or 31020))
def as_(uid):
    return "set role authenticated; set request.jwt.claims = '{\"sub\":\"%s\",\"email\":\"%s\"}'; " % (uid, EMAIL[uid])
def err(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
def one(s, uid=None):
    try: return db.one(s, uid)
    except RuntimeError as e: return "ERROR " + str(e)[:300]
def read(uid, q):
    return one(as_(uid) + q, uid)
try:
    db.sql(STAND + ("insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'owner'), ('%s', '%s', 'staff'), ('%s', '%s', 'readonly'), ('%s', '%s', 'staff'), ('%s', '%s', 'owner');"
            % (F1, F2, OWN, F1, STAFF, F1, LOOK, F1, STUDENT, F1, OTHER, F2))
           + " insert into clients values ('c1', '%s', 'Client One'), ('c2', '%s', 'Client Two');" % (F1, F2)
           + " grant usage on schema auth to authenticated, service_role; grant select on members, firms, clients to authenticated, service_role;")
    print("== 1. runs twice")
    if not RED:
        e1 = err(text); e2 = err(text); e3 = err(text)
        ok(not e1 and not e2 and not e3, "the file runs, and runs again (twice)" + (": " + (e1 or e2 or e3)[:400] if e1 or e2 or e3 else ""))
    tables = ["call_batches", "call_batch_members", "call_rooms", "call_participants", "call_invites", "call_messages", "call_recordings", "call_pieces",
              "call_transcripts", "call_consents", "call_client_settings", "call_remote_sessions"]
    ok(one("select count(*) from information_schema.tables where table_schema = 'public' and table_name in (%s)" % ",".join("'%s'" % t for t in tables)) == "12", "the twelve tables")
    ok(one("select count(*)::text || ':' || coalesce(bool_and(not public)::text, 'x') from storage.buckets where id in ('call-recordings', 'call-files')") == "2:true", "the two private buckets, once each")
    ok(one("select file_size_limit from storage.buckets where id = 'call-files'") == "20971520", "chat files: 20 MB at most")
    job = db.rows("select schedule, command from cron.job where jobname = 'call-retention'")
    ok(len(job) == 1 and "call_retention_sweep" in job[0]["command"], "the daily retention timer, once")
    print("== 2. grants")
    priv = lambda role, t: one("select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t)) or ""
    colpriv = lambda role, t: one("select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where grantee = '%s' and table_name = '%s' and privilege_type = 'SELECT'" % (role, t)) or ""
    ok(all(priv("anon", t) in ("", None) for t in tables) and all(colpriv("anon", t) in ("", None) for t in tables), "anon: nothing on any of them")
    ok(all("DELETE" in priv("service_role", t) and "INSERT" in priv("service_role", t) for t in tables), "the service role: everything")
    ok(all(priv("authenticated", t) in ("SELECT", "", None) for t in tables), "a member: select at most (writes go through the function)")
    ok(priv("authenticated", "call_invites") in ("", None) and colpriv("authenticated", "call_invites") in ("", None), "a member: nothing on the guest links")
    ok("chan_key" not in colpriv("authenticated", "call_rooms") and "title" in colpriv("authenticated", "call_rooms"), "a member reads a room but never its channel key (%s)" % colpriv("authenticated", "call_rooms"))
    ok("otp_hash" not in colpriv("authenticated", "call_participants") and "cf_session" not in colpriv("authenticated", "call_participants") and "name" in colpriv("authenticated", "call_participants"),
       "a member reads people but never a code's hash or a Cloudflare session")
    fx = lambda r, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (r, f))
    ok(fx("authenticated", "public.call_retention_sweep()") == "false" and fx("service_role", "public.call_retention_sweep()") == "true", "the sweep: the service role only")
    ok(fx("anon", "public.call_client_setting_set(text, boolean, int)") == "false" and fx("authenticated", "public.call_client_setting_set(text, boolean, int)") == "true", "the owner functions: members (they check the owner), never anon")
    print("== 3. row-level security")
    B = "bbbbbbbb-0000-0000-0000-000000000001"
    R1, R2, R3 = "cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"
    db.sql(("insert into call_batches (id, firm_id, name) values ('%s', '%s', 'GST batch 1');"
            "insert into call_batch_members (batch_id, firm_id, email, name) values ('%s', '%s', 'student@a.test', 'S');"
            "insert into call_rooms (id, firm_id, kind, client_id, title) values ('%s', '%s', 'client', 'c1', 'Call with Client One');"
            "insert into call_rooms (id, firm_id, kind, batch_id, title) values ('%s', '%s', 'class', '%s', 'Class 1');"
            "insert into call_rooms (id, firm_id, kind, client_id, title) values ('%s', '%s', 'client', 'c2', 'Firm B call');"
            "insert into call_recordings (room_id, firm_id, prefix, retain_until) values ('%s', '%s', 'x', current_date + 90);"
            "insert into call_recordings (room_id, firm_id, batch_id, prefix, retain_until) values ('%s', '%s', '%s', 'y', current_date + 365);"
            "insert into call_recordings (room_id, firm_id, prefix, retain_until) values ('%s', '%s', 'z', current_date + 90);"
            "insert into call_transcripts (room_id, firm_id, batch_id) values ('%s', '%s', '%s');"
            "insert into call_participants (id, room_id, firm_id, user_id, role, state, otp_hash) values ('dddddddd-0000-0000-0000-000000000001', '%s', '%s', '%s', 'host', 'admitted', 'h');"
            "insert into call_messages (room_id, firm_id, participant_id, author, body) values ('%s', '%s', 'dddddddd-0000-0000-0000-000000000001', 'O', 'hello'), ('%s', '%s', null, 'O', 'class line');")
           % (B, F1, B, F1, R1, F1, R2, F1, B, R3, F2, R1, F1, R2, F1, B, R3, F2, R2, F1, B, R1, F1, OWN, R1, F1, R2, F1))
    rooms = lambda uid: read(uid, "select string_agg(title, '|' order by title) from public.call_rooms")
    ok(rooms(STAFF) == "Call with Client One" and rooms(LOOK) == "Call with Client One", "staff and look-only read the firm's client call, not the class they are not in (%s / %s)" % (rooms(STAFF), rooms(LOOK)))
    ok(rooms(STUDENT) == "Call with Client One|Class 1" and rooms(OWN) == "Call with Client One|Class 1", "the batch member and the owner also read the class (%s / %s)" % (rooms(STUDENT), rooms(OWN)))
    ok(rooms(OTHER) == "Firm B call", "another firm reads only its own (%s)" % rooms(OTHER))
    ok("permission denied" in read(STAFF, "select chan_key from public.call_rooms limit 1"), "selecting the channel key is refused")
    ok("permission denied" in read(STAFF, "select * from public.call_rooms limit 1"), "so is select * (the app names its columns)")
    recs = lambda uid: read(uid, "select string_agg(prefix, ',' order by prefix) from public.call_recordings")
    ok(recs(STAFF) == "x" and recs(STUDENT) == "x,y" and recs(OTHER) == "z", "recordings: a class's only for its batch (%s / %s / %s)" % (recs(STAFF), recs(STUDENT), recs(OTHER)))
    ok(read(STAFF, "select count(*) from public.call_transcripts") == "0" and read(STUDENT, "select count(*) from public.call_transcripts") == "1", "a class's transcript: the batch only")
    ok(read(STAFF, "select string_agg(body, ',') from public.call_messages") == "hello" and read(STUDENT, "select count(*) from public.call_messages") == "2", "a class's chat: the batch only")
    for t, q in [("call_rooms", "insert into public.call_rooms (firm_id, kind, title) values ('%s', 'help', 'x')" % F1),
                 ("call_messages", "insert into public.call_messages (room_id, firm_id, author, body) values ('%s', '%s', 'x', 'y')" % (R1, F1)),
                 ("call_recordings", "update public.call_recordings set deleted_at = now()"),
                 ("call_client_settings", "insert into public.call_client_settings (firm_id, client_id, allow_recording) values ('%s', 'c1', true)" % F1)]:
        ok("permission denied" in err(as_(OWN) + q, OWN), "even the owner cannot write %s directly" % t)
    print("== 4. the owner functions")
    ok("Only the firm's owner" in err(as_(STAFF) + "select public.call_client_setting_set('c1', true, 60)", STAFF), "staff cannot turn recording on for a client")
    ok("not one of your firm" in err(as_(OWN) + "select public.call_client_setting_set('c2', true, 60)", OWN), "the owner cannot set another firm's client")
    ok(not err(as_(OWN) + "select public.call_client_setting_set('c1', true, 60)", OWN) and one("select allow_recording::text || ':' || retention_days from call_client_settings where client_id = 'c1'") == "true:60", "the owner turns it on, 60 days")
    ok("check" in err(as_(OWN) + "select public.call_client_setting_set('c1', true, 3)", OWN), "fewer than 7 days refused")
    rid = one("select id from call_recordings where prefix = 'x'")
    ok("Only the firm's owner" in err(as_(STAFF) + "select public.call_recording_delete('%s', 'no')" % rid, STAFF), "staff cannot delete a recording")
    ok(read(OWN, "select public.call_recording_delete('%s', 'client asked')::text" % rid) == "true", "the owner deletes it")
    ok(one("select (deleted_at is not null)::text || ':' || deleted_why from call_recordings where id = '%s'" % rid) == "true:client asked" and recs(STAFF) in ("", None),
       "softly: the row stays, marked, with the reason; members no longer see it")
    print("== 5. the retention sweep")
    db.sql("insert into call_recordings (room_id, firm_id, prefix, retain_until) values ('%s', '%s', 'old', current_date - 1)" % (R1, F1))
    n = one("set role service_role; select public.call_retention_sweep()")
    ok(n == "1" and one("select deleted_why from call_recordings where prefix = 'old'") == "kept for its days" and one("select count(*) from call_recordings") == "4", "past its days: marked deleted, nothing removed (%s)" % n)
    print("== 6. the bucket policy")
    db.sql("insert into storage.objects (bucket_id, name) values ('call-recordings', '%s/client/%s/rec/1.webm'), ('call-recordings', '%s/class/%s/%s/1.webm'), ('call-files', '%s/client/%s/f.pdf'), ('call-recordings', '%s/client/x/1.webm')"
           % (F1, R1, F1, B, R2, F1, R1, F2))
    objs = lambda uid: read(uid, "select count(*) from storage.objects")
    ok(objs(STAFF) == "2" and objs(STUDENT) == "3" and objs(OWN) == "3" and objs(OTHER) == "1", "the firm's folder only; the class folder only for the batch and owner (%s %s %s %s)" % (objs(STAFF), objs(STUDENT), objs(OWN), objs(OTHER)))
    print("== 7. the checks")
    bad = [err("insert into call_rooms (firm_id, kind) values ('%s', 'party')" % F1), err("insert into call_rooms (firm_id, kind) values ('%s', 'class')" % F1),
           err("insert into call_rooms (firm_id, kind) values ('%s', 'client')" % F1), err("insert into call_messages (room_id, firm_id, body) values ('%s', '%s', '')" % (R1, F1)),
           err("insert into call_messages (room_id, firm_id, body) values ('%s', '%s', repeat('x', 4001))" % (R1, F1)),
           err("insert into call_messages (room_id, firm_id, body, file) values ('%s', '%s', '', '{\"size\": 20971521}')" % (R1, F1)),
           err("insert into call_batch_members (batch_id, firm_id, email) values ('%s', '%s', 'Upper@A.test')" % (B, F1))]
    ok(all("violates" in b for b in bad), "refused: %d of %d" % (sum("violates" in b for b in bad), len(bad)))
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
