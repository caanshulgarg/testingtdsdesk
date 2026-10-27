"""python3 run_migration116.py - server/security/migration-116-write-checks.sql (27-Oct-2026, branch next-sec-fix-sql; the
security review of 27-Oct-2026, run 2: V1, V3, V4 and the lockout item 4). On a throwaway PostgreSQL (pg_stand, port
31160 unless PG116_PORT; never a real database), built 32 -> ... -> 54 as run_migration110.py, then 110, 115 and the
lockout part of security/migration-3-phase2, with made-up firms; then 116 twice. Checks:
  0. the file: one transaction, lock_timeout 10 s; create or replace only (no drop, no "delete from", no truncate);
     every function is its last definition in the repo with only the gate line added (the hook: only its "if" line
     changed); every function's grants restated; names no real database; md5
  1. a look-only member ('readonly') is refused (42501, the plain words) by tally_post_enqueue_to (Retry of a cancelled
     posting), the 3-argument tally_post_enqueue, tally_post_cancel, tally_post_row_remove and tally_post_row_restore;
     nothing changed (status, flags)
  2. staff and the owner still do each of them
  3. the service role: answered as before 116 (enqueue_to: 'not allowed'; cancel: ok false, no error); its grants kept
  4. the lock hook (as supabase_auth_admin): a locked account is refused for a password sign-in, and passes for
     token_refresh, oauth, totp (and otp, recovery); an account not locked passes a password sign-in
  5. tally_bridge_switches: authenticated cannot read from_firm or from_device; reads the safe columns (its firm's rows)
  6. runs twice: the same function texts and grants after the second run
RED_WITHOUT_116=1: the same checks without running 116 (0 holds; 1, 4 and 5 fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
M116 = os.path.join(ROOT, "server", "security", "migration-116-write-checks.sql")
M3 = os.path.join(ROOT, "server", "security", "migration-3-phase2.sql")
RED = os.environ.get("RED_WITHOUT_116") == "1"
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql",
                                           "migration-110-tally-link-record.sql", "migration-115-bridge-follows-login.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]

text = open(M116).read() if os.path.exists(M116) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M116), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in text.lower() and not re.search(r"\b(drop|truncate|alter)\s", code) and not re.search(r"\bcreate\s+(table|function|policy|trigger)\b", code),
   "create or replace only: nothing dropped, deleted, truncated or altered")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
FNS = {"tally_post_enqueue_core": ("tally-cloud/migration-110-tally-link-record.sql", "end $function$;"), "tally_post_enqueue_to": ("tally-cloud/migration-110-tally-link-record.sql", "end $function$;"),
       "tally_post_cancel": ("tally-cloud/migration-5-post-queue.sql", "end $$;"), "tally_post_row_remove": ("tally-cloud/migration-49-post-row-flags.sql", "end $function$;"),
       "tally_post_row_restore": ("tally-cloud/migration-49-post-row-flags.sql", "end $function$;"), "lockout_access_token_hook": ("security/migration-3-phase2.sql", "end $$;")}
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(FNS), "replaces only %s (%s)" % (sorted(FNS), made))
def body(t, name, end):
    i = t.index("create or replace function public." + name + "("); return t[i:t.index(end, i) + len(end)]
def last_def(name):
    """the function's last definition in the repo (in migration order: the highest number), but 116"""
    hits = []
    for d, _, fs in os.walk(os.path.join(ROOT, "server")):
        for f in fs:
            m = re.match(r"migration-(\d+)", f)
            if f.endswith(".sql") and m and "migration-116" not in f and ("create or replace function public.%s(" % name) in open(os.path.join(d, f)).read(): hits.append((int(m.group(1)), os.path.join(d, f)))
    return max(hits)[1]
GATE = re.compile(r"^  if (auth\.uid\(\) is not null and )?not can_write\(\) then raise exception 'Only the firm''s owner or staff can [a-z ]+ (Tally|the posting list)\.' using errcode = '42501'; end if;$")
for fn, (path, end) in FNS.items():
    want = os.path.normpath(os.path.join(ROOT, "server", path))
    ok(os.path.normpath(last_def(fn)) == want, "%s: its last definition is %s" % (fn, path))
    old, new = body(open(want).read(), fn, end).splitlines(), body(text, fn, end).splitlines() if fn in made else []
    if fn == "lockout_access_token_hook":
        d = [(a, b) for a, b in zip(old, new) if a != b]
        ok(len(old) == len(new) and d == [("  if until is not null then", "  if until is not null and event->>'authentication_method' = 'password' then")], "%s: byte for byte but its one 'if' line (%s)" % (fn, d))
    else:
        added = [l for l in new if l not in old]
        ok(len(new) == len(old) + 1 and len(added) == 1 and GATE.match(added[0]) and [l for l in new if l != added[0]] == old, "%s: byte for byte plus one gate line (%s)" % (fn, added))
for g in ["revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;", "grant execute on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) to service_role;",
          "revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;", "grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;",
          "revoke all on function public.tally_post_cancel(uuid) from public, anon;", "grant execute on function public.tally_post_cancel(uuid) to authenticated;",
          "revoke all on function public.tally_post_row_remove(text[], text) from public, anon;", "grant execute on function public.tally_post_row_remove(text[], text) to authenticated;",
          "revoke all on function public.tally_post_row_restore(text[]) from public, anon;", "grant execute on function public.tally_post_row_restore(text[]) to authenticated;",
          "grant execute on function public.lockout_access_token_hook(jsonb) to supabase_auth_admin;", "revoke execute on function public.lockout_access_token_hook(jsonb) from public, anon, authenticated;",
          "revoke select on public.tally_bridge_switches from authenticated;", "grant select (id, bridge_id, state, to_firm, to_device, by_user, revoked_old, why, at) on public.tally_bridge_switches to authenticated;"]:
    ok(g in text, "grant restated: " + g[:90])

F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, LOOK, O2 = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
D1, D9 = "d1000000-0000-0000-0000-000000000001", "d9000000-0000-0000-0000-000000000009"
BK1 = "b0000001-0000-0000-0000-000000000116"
J = lambda n: "%08d-0000-0000-0000-000000000116" % n
NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
db = pg_stand.start(int(os.environ.get("PG116_PORT") or 31160))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_role(role, uid, stmt):
    try: return True, db.one("set role %s; %s" % (role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpc(uid, stmt, role="authenticated"):
    good, out = as_role(role, uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
def refused(r): return "_error" in r and "Only the firm's owner or staff can" in r["_error"]
status = lambda n: db.one("select status from tally_post_jobs where id = %s" % q(J(n)))
def job(n, st, entry):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, %s)"
           % (q(J(n)), q(F), q(D1), q(json.dumps({"masters": [], "vouchers": [{"id": entry, "xml": "<VOUCHER/>"}], "ledger": ""})), q(st)))
retry = lambda uid, n, role="authenticated": rpc(uid, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(n)), role)
retry3 = lambda uid, n: rpc(uid, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(n)))
cancel = lambda uid, n, role="authenticated": rpc(uid, "select tally_post_cancel(%s::uuid)::text" % q(J(n)), role)
remove = lambda uid, k: rpc(uid, "select tally_post_row_remove(array[%s], 'seen in Tally')::text" % q(k))
restore = lambda uid, k: rpc(uid, "select tally_post_row_restore(array[%s])::text" % q(k))
flag = lambda k: db.one("select case when restored_at is null then 'removed' else 'restored' end from tally_post_row_flags where row_key = %s and kind = 'remove'" % q(k)) or "none"
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    beat = q(json.dumps({"computer": "NW144", "beat": {"at": iso(NOW), "companies": [{"name": "ZZ CO", "guid": "a1b2c3d4-0000-0000-0000-000000000001"}]},
                         "bridges": {"go-aaaa000001": {"at": iso(NOW), "computer": "NW144", "user": "anshul", "mode": "main", "open": ["ZZ CO"], "tallyPort": 9005, "dataFolder": "C:\\Users\\anshul\\TallyPrime\\Data"}}}))
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
                          alter role service_role bypassrls;   -- as on Supabase (run_migration33's schema makes it without)
                          if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
      grant select on members to authenticated, service_role;
      insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(L)s, %(F)s, 'Look', 'readonly', true), (%(O2)s, %(F2)s, 'Priya', 'owner', true);
      create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.4.7', %(I1)s, %(O)s),
        (%(D9)s, %(F2)s, 'OTHER', 'h9', '2.4.7', '{}', %(O2)s);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
      create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
        device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
        book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
      alter table public.tally_companies enable row level security;
      create policy tally_companies_read on public.tally_companies for select to authenticated using (firm_id = public.my_firm());
      grant select on public.tally_companies to authenticated;
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{}');
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, 'ZZ CO', 'c1', %(D1)s, now(), now(), %(BK1)s);
      insert into tally_books (book_id, firm_id, client_id, company) values (%(BK1)s, %(F)s, 'c1', 'ZZ CO');
      -- Supabase's auth.users, as the lock hook reads it
      create table if not exists auth.users (id uuid primary key, email text);
      grant select on auth.users to supabase_auth_admin;
      insert into auth.users values (%(O)s, 'owner@firm.test'), (%(S)s, 'ravi@firm.test');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "L": q(LOOK), "O2": q(O2), "D1": q(D1), "D9": q(D9), "I1": beat, "BK1": q(BK1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # tally_post_cancel as on staging (migration 5's text and grants; the stand starts at 32)
    m5 = open(os.path.join(SQLDIR, "migration-5-post-queue.sql")).read(); i = m5.index("create or replace function public.tally_post_cancel(")
    db.sql(m5[i:m5.index("end $$;", i) + 7] + "\nrevoke all on function public.tally_post_cancel(uuid) from public, anon;\ngrant execute on function public.tally_post_cancel(uuid) to authenticated;")
    # Supabase's default privileges: the service role may use every table and execute every function of public
    db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    m3 = open(M3).read(); r = psql_text(m3[m3.index("create table if not exists public.auth_lockout"):])
    if r.returncode: ok(False, "migration-3-phase2's lockout part runs: %s" % r.stderr[-300:]); raise SystemExit("cannot go on")
    db.one("select tally_bridge_bind(%s::uuid, 'go-aaaa000001')::text" % q(D1))
    db.sql("insert into tally_bridge_switches (bridge_id, state, from_firm, from_device, to_firm, to_device, by_user, why) values ('go-aaaa000001', 'asked', %s, %s, %s, %s, %s, 'test')" % (q(F2), q(D9), q(F), q(D1), q(OWNER)))
    job(1, "cancelled", "V1"); job(2, "waiting", "V2"); job(3, "failed", "V3"); job(4, "cancelled", "V4"); job(5, "waiting", "V5"); job(6, "failed", "V6")
    fdefs = lambda: db.rows("select p.proname, md5(pg_get_functiondef(p.oid)) d, coalesce(array_to_string(p.proacl, ','), '') a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(%s) order by 1"
                            % ("array[" + ",".join(q(f) for f in FNS) + "]"))
    tacl = lambda: db.one("select coalesce(array_to_string(relacl, ','), '') || ' / ' || coalesce((select string_agg(attname || '=' || array_to_string(attacl, ','), ';' order by attnum) from pg_attribute where attrelid = 'public.tally_bridge_switches'::regclass and attacl is not null), '') from pg_class where oid = 'public.tally_bridge_switches'::regclass")
    jobs_before = db.one("select count(*) from tally_post_jobs")

    print("== 6. runs twice")
    seen = []
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_116: not run)" % n); continue
        r = psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else "")); seen.append((fdefs(), tacl()))
    ok(len(seen) == 2 and seen[0] == seen[1] and len(seen[0][0]) == len(FNS), "the second run leaves the same function texts and grants (%d functions)" % (len(seen[0][0]) if seen else 0))
    ok(db.one("select count(*) from tally_post_jobs") == jobs_before and db.one("select count(*) from tally_bridge_switches") == "1", "nothing added or removed by the runs")

    print("== 1. a look-only member ('readonly') is refused")
    r = retry(LOOK, 1); ok(refused(r) and status(1) == "cancelled", "Retry of a cancelled posting (tally_post_enqueue_to): refused, still cancelled (%s)" % str(r.get("_error", r))[-160:])
    r = retry(LOOK, 3); ok(refused(r) and status(3) == "failed", "Retry of a failed posting: refused, still failed")
    r = retry3(LOOK, 1); ok(refused(r) and status(1) == "cancelled", "the 3-argument tally_post_enqueue (the app's Retry button): refused")
    r = rpc(LOOK, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(99)), q(json.dumps({"vouchers": [{"id": "V99", "xml": "<VOUCHER/>"}]}))))
    ok(refused(r) and db.one("select count(*) from tally_post_jobs where id = %s" % q(J(99))) == "0", "a new posting: refused, nothing queued")
    r = cancel(LOOK, 2); ok(refused(r) and status(2) == "waiting", "tally_post_cancel of a waiting posting: refused, still waiting")
    r = remove(LOOK, J(3) + ":V3"); ok(refused(r) and flag(J(3) + ":V3") == "none", "tally_post_row_remove: refused, no flag")
    for what, call in (("tally_post_enqueue_to", "tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)" % q(J(1))), ("tally_post_cancel", "tally_post_cancel(%s::uuid)" % q(J(2))),
                       ("tally_post_row_remove", "tally_post_row_remove(array[%s], '')" % q(J(3) + ":V3")), ("tally_post_row_restore", "tally_post_row_restore(array[%s])" % q(J(3) + ":V3"))):
        good, out = as_role("authenticated", LOOK, "do $$ begin perform %s; raise exception 'no refusal'; exception when insufficient_privilege then null; end $$; select 'refused'" % call)
        ok(good and out == "refused", "%s: the refusal's errcode is 42501 (%s)" % (what, out.strip()[-100:]))

    print("== 2. staff and the owner still do them")
    r = retry(STAFF, 1); ok(r.get("ok") is True and r.get("retry") is True and status(1) == "waiting", "staff: Retry of a cancelled posting waits again (%s)" % (r.get("error") or r.get("_error") or r))
    r = retry3(OWNER, 3); ok(r.get("ok") is True and status(3) == "waiting", "owner: Retry through the 3-argument tally_post_enqueue (%s)" % (r.get("error") or r.get("_error") or r))
    r = cancel(STAFF, 2); ok(r.get("ok") is True and status(2) == "cancelled", "staff: cancel (%s)" % r)
    r = cancel(OWNER, 1); ok(r.get("ok") is True and status(1) == "cancelled", "owner: cancel (%s)" % r)
    r = remove(STAFF, J(6) + ":V6"); ok(r.get("ok") is True and flag(J(6) + ":V6") == "removed", "staff: remove one row (%s)" % r)
    r = restore(LOOK, J(6) + ":V6"); ok(refused(r) and flag(J(6) + ":V6") == "removed", "look-only: restore refused, still removed")
    r = restore(STAFF, J(6) + ":V6"); ok(r.get("ok") is True and flag(J(6) + ":V6") == "restored", "staff: restores the row they removed (%s)" % r)
    r = remove(OWNER, J(4) + ":V4"); ok(r.get("ok") is True and flag(J(4) + ":V4") == "removed", "owner: remove (%s)" % r)
    r = restore(OWNER, J(4) + ":V4"); ok(r.get("ok") is True and flag(J(4) + ":V4") == "restored", "owner: restore (%s)" % r)

    print("== 3. the service role: as before")
    r = retry(None, 4, "service_role"); ok("_error" in r and "not allowed" in r["_error"] and not refused(r) and status(4) == "cancelled", "tally_post_enqueue_to: 'not allowed', as before 116 (%s)" % str(r.get("_error", r))[-120:])
    r = cancel(None, 5, "service_role"); ok(r == {"ok": False} and status(5) == "waiting", "tally_post_cancel: ok false, no error, as before 116 (%s)" % r)
    priv = lambda role, sig: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(sig)))
    ok(priv("service_role", "public.tally_post_enqueue_core(uuid,text,jsonb,uuid,text)") == "true" and priv("service_role", "public.tally_post_enqueue_to(uuid,text,jsonb,text,uuid)") == "true"
       and priv("authenticated", "public.tally_post_enqueue_core(uuid,text,jsonb,uuid,text)") == "false" and priv("anon", "public.tally_post_cancel(uuid)") == "false"
       and priv("authenticated", "public.lockout_access_token_hook(jsonb)") == "false" and priv("supabase_auth_admin", "public.lockout_access_token_hook(jsonb)") == "true", "grants: as before (core for the service role only; the hook for Supabase Auth only)")
    ok(db.one("set role service_role; update tally_post_jobs set message = 'tally-ingest' where id = %s returning status" % q(J(5))) == "waiting", "tally-ingest's own writes (service role) untouched")

    print("== 4. the lock hook: password sign-ins only")
    db.sql("insert into auth_lockout (email, fails, first_fail_at, locked_until) values ('owner@firm.test', 5, now(), now() + interval '15 minutes')")
    def hook(uid, method):
        ev = {"user_id": uid, "claims": {"sub": uid, "role": "authenticated", "aal": "aal1"}}
        if method is not None: ev["authentication_method"] = method
        good, out = as_role("supabase_auth_admin", None, "select public.lockout_access_token_hook(%s::jsonb)::text" % q(json.dumps(ev)))
        return json.loads(out) if good else {"_error": out[-300:]}
    r = hook(OWNER, "password"); ok(r.get("error", {}).get("http_code") == 403 and "Too many wrong passwords" in r["error"].get("message", ""), "locked, password: refused (403, the plain words)")
    for m in ("token_refresh", "oauth", "totp", "otp", "recovery", "oauth_provider/authorization_code"):
        r = hook(OWNER, m); ok("error" not in r and "_error" not in r and r.get("user_id") == OWNER, "locked, %s: passes (the event unchanged)" % m)
    r = hook(STAFF, "password"); ok("error" not in r and r.get("user_id") == STAFF, "not locked, password: passes")
    db.sql("update auth_lockout set locked_until = now() - interval '1 minute' where email = 'owner@firm.test'")
    r = hook(OWNER, "password"); ok("error" not in r, "after the 15 minutes, password: passes")

    print("== 5. tally_bridge_switches: not the other firm's ids")
    for col in ("from_firm", "from_device"):
        good, out = as_role("authenticated", OWNER, "select %s::text from tally_bridge_switches limit 1" % col)
        ok(not good and "permission denied" in out, "authenticated cannot read %s (%s)" % (col, out.strip()[-80:]))
    good, out = as_role("authenticated", OWNER, "select * from tally_bridge_switches limit 1"); ok(not good and "permission denied" in out, "select * refused (it names from_firm)")
    good, out = as_role("authenticated", OWNER, "select count(*) || ':' || string_agg(id || bridge_id || state || to_firm || coalesce(to_device::text, '') || coalesce(by_user::text, '') || revoked_old || why || at, ',') from tally_bridge_switches")
    ok(good and out.startswith("1:"), "the safe columns: read (its firm's row) (%s)" % out[:60])
    ok(as_role("authenticated", O2, "select count(*) from tally_bridge_switches")[1] == "0", "the other firm's member reads none (RLS kept)")
    good, out = as_role("service_role", None, "select from_firm::text from tally_bridge_switches limit 1"); ok(good and out == F2, "the service role still reads every column (%s)" % out.strip()[-120:])
    w = rpc(OWNER, "select tally_bridge_whose('go-aaaa000001')::text")
    ok(set(w) == {"may", "mine", "elsewhere", "busy"} and all(isinstance(v, bool) for v in w.values()), "tally_bridge_whose answers booleans only (%s)" % w)
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
