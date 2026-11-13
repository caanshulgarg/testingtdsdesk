"""python3 tests/run_migration195.py - server/security/migration-195-review-lows.sql (13-Nov-2026, branch next-sec-db):
the small items of the database review. On a throwaway PostgreSQL (pg_stand, port 31195 unless PG195_PORT; never a real
database), made-up rows only. First the stand is made as the database is before 195: migration 101's own file (Post
automatically), migration 1's charge_usage (cut from its file), a stand-in post_inbox (its real text is not in the repo:
195 keeps whatever is there), Storage's table with the two upload policies, the functions and policies 195 names with the
texts of the migrations that made them.
  0. the file: one transaction, lock_timeout 10 s; nothing dropped; names no real database; its md5
  1. runs, and a second time (post_inbox is not wrapped twice)
  A. autopost_claim / autopost_mark: owner and staff as before (the same answer and rows); a sign-in without the
     two-step, or a firm that is read-only: refused, nothing written; look-only as before
  B. charge_usage: a look-only member is answered look_only and nothing is charged; owner and staff, a bad quantity and
     a person of no firm exactly as before
  C. post_inbox: an https link or a plain path is taken exactly as before (the old text runs, word for word); any other
     kind of link or path is refused and nothing is kept; anon may still call it, nobody the copy
  D. Storage: owner and staff add to their firm's folder of doc-inbox and tally-uploads as before; look-only, a
     read-only firm, another firm's folder: refused
  E. trigger functions: not executable by anon or authenticated; the triggers still run for them
  F. search_path fixed on the five; the two procedures, tally_nm and sync_empty left; every answer the same
  G. the four policies: auth.uid() asked once ("select"); the rows each person reads and may add the same as before
  H. the two indexes
RED_WITHOUT_195=1: the same checks without running 195 (A to H fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
N = "195"
M = os.path.join(ROOT, "server", "security", "migration-%s-review-lows.sql" % N)
M101 = os.path.join(ROOT, "server", "security", "migration-101-autopost.sql")
M1 = os.path.join(ROOT, "server", "security", "migration-1-functions.sql")
RED = os.environ.get("RED_WITHOUT_" + N) == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(code.count("begin;") == 1 and code.count("commit;") == 1 and code.strip().startswith("begin;") and code.strip().endswith("commit;")
   and "set local lock_timeout = '10s';" in code, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\b|\btruncate\b|delete\s+from|create\s+(table|trigger|policy)|alter\s+table", code), "nothing dropped; no table, trigger or policy made; policies altered in place")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "names no real database")
t101 = open(M101).read()
for fn in ("autopost_claim", "autopost_mark"):
    old = re.search(r"create or replace function public\.%s\(.*?\nend \$\$;" % fn, t101, re.S).group(0)
    new = re.search(r"create or replace function public\.%s\(.*?\nend \$\$;" % fn, text, re.S).group(0)
    kept = [l for l in new.splitlines() if "my_firm() is distinct from f" not in l and "not public.can_write()" not in l and "-- %s:" % N not in l]
    ok(kept == old.splitlines() and len(new.splitlines()) == len(old.splitlines()) + 3, "%s: 101's text with three lines added, nothing else changed" % fn)
charge_old = re.search(r"create or replace function public\.charge_usage\(.*?\n\$\$;", open(M1).read(), re.S).group(0)

F1, F2, F3 = ("99999999-9999-4999-8999-99999999%s%d" % (N, i) for i in (1, 2, 3))
U = {k: "aaaaaaaa-0%s-4000-8000-%012d" % (N, i) for i, k in enumerate(["owner", "staff", "look", "aal1", "other", "ro_staff", "nobody"], 1)}
q = lambda s: "'" + str(s).replace("'", "''") + "'"
SETUP = """
do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter table firms add column read_only boolean not null default false;
create table t_aal1 (user_id uuid primary key);
create or replace function my_firm() returns uuid language sql stable security definer set search_path = public as $f$
  select firm_id from members where user_id = auth.uid() and active and not exists (select 1 from t_aal1 a where a.user_id = auth.uid()) $f$;
create or replace function can_write() returns boolean language sql stable security definer set search_path = public as $f$
  select exists (select 1 from members m join firms f on f.id = m.firm_id where m.user_id = auth.uid() and m.active and m.role in ('owner', 'staff') and not f.read_only) $f$;
create or replace function is_superadmin() returns boolean language sql stable security definer set search_path = public as $f$ select false $f$;
grant select on members to authenticated; grant select, update on firms to authenticated;
insert into firms (id, name) values (%(F1)s, 'Made-up Firm One'), (%(F2)s, 'Made-up Firm Two'), (%(F3)s, 'Made-up Read-only Firm');
update firms set read_only = true where id = %(F3)s;
insert into members (user_id, firm_id, name, role) values (%(owner)s, %(F1)s, 'Made-up Owner', 'owner'), (%(staff)s, %(F1)s, 'Made-up Staff', 'staff'), (%(look)s, %(F1)s, 'Made-up Look', 'readonly'),
  (%(aal1)s, %(F1)s, 'Made-up One Step', 'staff'), (%(other)s, %(F2)s, 'Made-up Other', 'owner'), (%(ro_staff)s, %(F3)s, 'Made-up RO Staff', 'staff');
insert into t_aal1 values (%(aal1)s);
-- what 101 leans on
create table clients (firm_id uuid, id text, name text, data jsonb default '{}', deleted boolean default false, primary key (firm_id, id));
create table sync_refused (id bigserial primary key, firm_id uuid, user_id uuid, tbl text, kind text, row_id text, what text, at timestamptz default now());
""" % dict({k: q(v) for k, v in U.items()}, F1=q(F1), F2=q(F2), F3=q(F3))
AFTER101 = """
insert into clients (firm_id, id, name, data) values (%(F1)s, 'c1', 'Made-up Client', '{"choices": {"autopost": {"value": {"on": true, "perEntry": 50000, "perDay": 100000}}}}'),
  (%(F3)s, 'c3', 'Made-up RO Client', '{"choices": {"autopost": {"value": {"on": true}}}}');
-- B. the charge: charge_for written down, not worked out
create table t_charges (firm uuid, usr uuid, code text, qty numeric, ref text, note text);
create or replace function charge_for(p_firm uuid, p_user uuid, p_code text, p_qty numeric, p_ref text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if p_firm is null then return jsonb_build_object('ok', false, 'reason', 'no_firm'); end if;
  insert into t_charges values (p_firm, p_user, p_code, p_qty, p_ref, p_note); return jsonb_build_object('ok', true, 'balance', 100 - p_qty);
end $f$;
revoke all on function charge_for(uuid, uuid, text, numeric, text, text) from public;
%(charge)s
revoke all on function charge_usage(text, numeric, text, text) from public; grant execute on function charge_usage(text, numeric, text, text) to authenticated;
-- C. a stand-in for the inbox function (its real text is on the database only)
create table drop_keys (key_hash text primary key, firm_id uuid); insert into drop_keys values (md5('made-up-drop-key'), %(F1)s);
create table t_inbox (id uuid primary key, firm_id uuid, client_id text, data jsonb);
create or replace function post_inbox(p_key text, p_id uuid, p_client_id text, p_data jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid;   -- begin with the key
begin
  select firm_id into f from drop_keys where key_hash = md5(p_key);
  if f is null then return jsonb_build_object('ok', false, 'error', 'bad key'); end if;
  if coalesce(p_data->>'fileName', '') = '' or coalesce(p_data->>'url', p_data->>'filePath', '') = '' then return jsonb_build_object('ok', false, 'error', 'fileName and url or filePath'); end if;
  insert into t_inbox values (p_id, f, p_client_id, p_data) on conflict (id) do update set data = excluded.data;
  return jsonb_build_object('ok', true, 'id', p_id);
end $function$;
revoke all on function post_inbox(text, uuid, text, jsonb) from public; grant execute on function post_inbox(text, uuid, text, jsonb) to anon, authenticated, service_role;
-- D. Storage
create schema storage;
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select, insert on storage.objects to authenticated;
create policy "doc inbox: add to own firm" on storage.objects for insert to authenticated with check (bucket_id = 'doc-inbox' and (storage.foldername(name))[1] = public.my_firm()::text);
create policy tally_uploads_add on storage.objects for insert to authenticated with check (bucket_id = 'tally-uploads' and (storage.foldername(name))[1] = public.my_firm()::text);
create policy client_docs_add on storage.objects for insert to authenticated with check (bucket_id = 'client-docs' and (storage.foldername(name))[1] = public.my_firm()::text and public.can_write());
-- E, F. the functions as their migrations made them (26, 21, 77, 23, 19, 47)
create table tally_post_jobs (id serial primary key, firm_id uuid, status text, dismissed_at timestamptz, dismissed_by uuid, dismiss_note text, dismiss_auto boolean default false);
create or replace function public.tally_post_jobs_undismiss_on_retry() returns trigger language plpgsql as $function$
begin
  if new.status = 'waiting' and old.status in ('failed', 'cancelled') then
    new.dismissed_at := null; new.dismissed_by := null; new.dismiss_note := null; new.dismiss_auto := false;
  end if;
  return new;
end $function$;
create trigger tally_post_jobs_undismiss_on_retry before update of status on public.tally_post_jobs for each row execute function public.tally_post_jobs_undismiss_on_retry();
create or replace function public.firms_guard() returns trigger language plpgsql as $function$
begin
  if coalesce(btrim(new.name), '') = '' and coalesce(btrim(old.name), '') <> '' then new.name := old.name; end if;
  return new;
end $function$;
create trigger firms_guard before update on public.firms for each row execute function public.firms_guard();
grant execute on function tally_post_jobs_undismiss_on_retry(), firms_guard() to anon, authenticated;
create or replace function public.asst_none(p_tool text) returns jsonb language sql immutable as $f$ select jsonb_build_object('tool', p_tool, 'none', true, 'rows', '[]'::jsonb) $f$;
create or replace function public.asst_col(p_k text, p_label text, p_t text default 'text') returns jsonb language sql immutable as $f$ select jsonb_build_object('k', p_k, 'label', p_label, 't', p_t) $f$;
create or replace function public.asst_tds_rule(p_ledger text) returns table (rule text, section text) language sql immutable as $f$
  select * from (values ('rent_building', '194-I'), ('professional', '194J')) r(rule, section) where r.rule = case when p_ledger ~* 'RENT' then 'rent_building' else 'professional' end $f$;
create or replace function public.tally_nm(p text) returns text language sql immutable as $f$ select btrim(regexp_replace(coalesce(p, ''), '[ \\t]*(&#13;|&#10;|\\r|\\n)+[ \\t]*', ' ', 'g')) $f$;
create or replace function public.sync_empty(v jsonb) returns boolean language sql immutable as $f$ select v is null or v = 'null'::jsonb or v = '{}'::jsonb $f$;
create or replace function public.sync_empty(v text) returns boolean language sql immutable as $f$ select coalesce(btrim(v), '') = '' $f$;
create table t_drained (n int);
create or replace procedure public.tally_recorder_drain_run(p_budget_ms integer) language plpgsql as $f$ begin insert into t_drained values (1); commit; insert into t_drained values (2); commit; end $f$;
-- G. the four policies with the texts of migrations 77 and 108
create table assistant_mismatches (id bigserial primary key, firm_id uuid, what text);
create table assistant_mismatch_status (id bigserial primary key, mismatch_id bigint, status text);
create table client_timings (id bigserial primary key, firm_id uuid, user_id uuid, at timestamptz default now(), what text);
alter table assistant_mismatches enable row level security; alter table assistant_mismatch_status enable row level security; alter table client_timings enable row level security;
create policy assistant_mismatches_owner_read on public.assistant_mismatches for select to authenticated
  using (firm_id = public.my_firm() and exists (select 1 from public.members m where m.user_id = auth.uid() and m.firm_id = assistant_mismatches.firm_id and m.active and m.role = 'owner'));
create policy assistant_mismatch_status_owner_read on public.assistant_mismatch_status for select to authenticated
  using (exists (select 1 from public.assistant_mismatches x join public.members m on m.firm_id = x.firm_id
                  where x.id = assistant_mismatch_status.mismatch_id and x.firm_id = public.my_firm() and m.user_id = auth.uid() and m.active and m.role = 'owner'));
create policy client_timings_insert_own on public.client_timings for insert to authenticated
  with check (user_id = auth.uid() and firm_id = public.my_firm() and at > now() - interval '5 minutes' and at < now() + interval '5 minutes');
create policy client_timings_read_owner on public.client_timings for select to authenticated
  using (public.is_superadmin() or (firm_id = public.my_firm() and exists (select 1 from public.members m
    where m.user_id = auth.uid() and m.firm_id = client_timings.firm_id and m.role = 'owner' and coalesce(m.active, true))));
grant select on assistant_mismatches, assistant_mismatch_status to authenticated; grant select, insert on client_timings to authenticated; grant usage on sequence client_timings_id_seq to authenticated;
insert into assistant_mismatches (firm_id, what) values (%(F1)s, 'one'), (%(F2)s, 'two');
insert into assistant_mismatch_status (mismatch_id, status) values (1, 'open'), (2, 'open');
insert into client_timings (firm_id, user_id, what) values (%(F1)s, %(staff)s, 'made-up'), (%(F2)s, %(other)s, 'made-up');
-- H.
create table assistant_notices (id uuid primary key default gen_random_uuid(), firm_id uuid);
create table assistant_notice_events (id bigint generated by default as identity primary key, notice_id uuid not null references assistant_notices (id) on delete cascade, firm_id uuid not null, what text not null);
create table firm_signals (scope text primary key, firm_id uuid references firms (id) on delete cascade, n bigint default 0);
""" % dict({k: q(v) for k, v in U.items()}, F1=q(F1), F2=q(F2), F3=q(F3), charge=charge_old)

db = pg_stand.start(int(os.environ.get("PG%s_PORT" % N) or 31195))
AS = lambda who, role="authenticated": "set role %s; set fincom.uid = %s; " % (role, q(U[who]) if who else "''")
def J(sql):
    try: return json.loads(db.one(sql))
    except RuntimeError as e: return {"error!": str(e)[-200:]}
def refused(sql):
    try: db.sql(sql); return ""
    except RuntimeError as e: return str(e)
RUN = "bbbbbbbb-0%s-4000-8000-000000000001" % N
claim = lambda who, cl="c1", eid="bank:1": J(AS(who) + "select autopost_claim(%s, %s, %s)" % (q(cl), q(RUN), q(json.dumps([{"id": eid, "kind": "bank", "amount": "100"}]))))
mark = lambda who, st, cl="c1", eid="bank:1": J(AS(who) + "select autopost_mark(%s, %s, array[%s], %s, null)" % (q(cl), q(RUN), q(eid), q(st)))
post = lambda data, key="made-up-drop-key", i=1: J("set role anon; select post_inbox(%s, %s, 'c1', %s)" % (q(key), q("cccccccc-0%s-4000-8000-%012d" % (N, i)), q(json.dumps(data))))
POL = "select policyname, coalesce(qual, '') as qual, coalesce(with_check, '') as chk from pg_policies where policyname in ('assistant_mismatches_owner_read', 'assistant_mismatch_status_owner_read', 'client_timings_insert_own', 'client_timings_read_owner') order by 1"
def reads():
    out = {}
    for who in ("owner", "staff", "look", "aal1", "other"):
        out[who] = [db.one(AS(who) + "select count(*) from %s" % t) for t in ("assistant_mismatches", "assistant_mismatch_status", "client_timings")]
    return out
try:
    db.sql(SETUP); db.sql(t101); db.sql(AFTER101)
    read0, base_src = reads(), db.one("select prosrc from pg_proc where proname = 'post_inbox'")
    asst0 = db.rows("select asst_none('x')::text a, asst_col('k', 'L')::text b, (select string_agg(rule || section, ',') from asst_tds_rule('Office RENT')) c, tally_nm(E' a \\n b ') d, sync_empty('{}'::jsonb)::text e, sync_empty(' ')::text f")
    print("== 1. runs")
    if not RED:
        e = refused(text) or refused(text)
        ok(not e, "runs, and a second time" + (": " + e[-500:] if e else ""))
    print("== A. Post automatically")
    c = claim("staff")
    ok(c.get("ok") is True and c.get("taken") == ["bank:1"] and c.get("day_used") == 100, "staff with the two-step done: the entry claimed as before (%s)" % json.dumps(c)[:90])
    ok(mark("staff", "queued").get("n") == 1 and mark("owner", "undone").get("ok") is True, "marked queued by staff, undone by the owner, as before")
    ok(claim("look").get("error") == "Only the owner or staff may post.", "look-only: refused with 101's own words")
    n0 = db.one("select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from autopost_claims")
    c = claim("aal1", eid="bank:2"); m = mark("aal1", "released")
    ok(c.get("ok") is False and "two-step" in c.get("error", "") and m.get("ok") is False and "two-step" in m.get("error", ""), "a sign-in without the two-step: claim and mark refused (%s)" % c.get("error", c))
    c = claim("ro_staff", cl="c3", eid="bank:3"); m = mark("ro_staff", "released", cl="c3")
    ok(c.get("ok") is False and "read-only" in c.get("error", "") and m.get("ok") is False and "read-only" in m.get("error", ""), "a firm that is read-only: claim and mark refused (%s)" % c.get("error", c))
    ok(db.one("select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from autopost_claims") == n0, "nothing written by the refused calls")
    ok(db.one("select has_function_privilege('authenticated', 'autopost_claim(text, uuid, jsonb)', 'execute')::text || has_function_privilege('anon', 'autopost_mark(text, uuid, text[], text, uuid)', 'execute')::text") in ("truefalse", "tf"), "signed-in people may call them, anon not")
    print("== B. a charge by the app")
    r = J(AS("look") + "select charge_usage('bank', 5, 'made-up.pdf', 'note')")
    ok(r == {"ok": False, "reason": "look_only"} and db.one("select count(*) from t_charges") == "0", "look-only: %s, nothing charged" % json.dumps(r))
    r = J(AS("staff") + "select charge_usage('bank', 5, 'made-up.pdf', 'note')")
    row = db.rows("select firm, usr, code, qty, ref, note from t_charges")
    ok(r == {"ok": True, "balance": 95} and row == [{"firm": F1, "usr": U["staff"], "code": "bank", "qty": "5", "ref": "made-up.pdf", "note": "note"}], "staff: charged through charge_for with the same arguments")
    ok(J(AS("owner") + "select charge_usage('bills', 1)").get("ok") is True and J(AS("staff") + "select charge_usage('bank', 0)") == {"ok": False, "reason": "bad_qty"}
       and J(AS("staff") + "select charge_usage('bank', 1001)") == {"ok": False, "reason": "bad_qty"} and J(AS("nobody") + "select charge_usage('bank', 1)") == {"ok": False, "reason": "no_firm"},
       "the owner, a bad quantity and a person of no firm: as before")
    ok("permission denied" in refused("set role anon; select charge_usage('bank', 1);"), "anon may not call it")
    print("== C. the document inbox")
    good = [({"fileName": "a.pdf", "url": "https://files.example/a.pdf?sig=1"}, "an https link"), ({"fileName": "b.pdf", "filePath": F1 + "/c1/b.pdf"}, "a plain path"), ({"fileName": "c.pdf", "url": "HTTPS://files.example/c.pdf", "filePath": "x/y.pdf"}, "both")]
    for i, (d, w) in enumerate(good, 1):
        r = post(d, i=i)
        ok(r.get("ok") is True and json.loads(db.one("select data::text from t_inbox where id = %s" % q(r.get("id", "00000000-0000-0000-0000-000000000000")))) == d, "%s: kept exactly as given" % w)
    ok(post({"fileName": "a.pdf", "url": "https://files.example/a"}, key="wrong") == {"ok": False, "error": "bad key"} and post({"url": "https://files.example/a"}).get("error") == "fileName and url or filePath", "the old text's own refusals, word for word")
    n0 = db.one("select count(*) from t_inbox")
    bad = [{"url": "http://files.example/a.pdf"}, {"url": "javascript:alert(1)"}, {"url": "data:text/html,x"}, {"url": " https://files.example/a"}, {"url": "//files.example/a"}, {"url": "https://"},
           {"filePath": "../other/a.pdf"}, {"filePath": "/abs/a.pdf"}, {"filePath": "a/../../b.pdf"}, {"filePath": "file:///etc/x"}, {"filePath": "\\\\host\\share"}, {"url": "https://ok.example/a", "filePath": "x/../y"}]
    got = [post(dict({"fileName": "x.pdf"}, **d), i=50 + i) for i, d in enumerate(bad)]
    ok(all("error!" in g and "https://" in g["error!"] for g in got) and db.one("select count(*) from t_inbox") == n0, "%d other kinds of link or path: each refused, nothing kept%s" % (len(bad), "" if all("error!" in g for g in got) else ": taken " + str([b for b, g in zip(bad, got) if "error!" not in g][:4])))
    fn = db.rows("select p.proname, p.prosrc = %s as same, p.prosecdef::text as def, coalesce((select string_agg(a.grantee::regrole::text, ',' order by 1) from aclexplode(p.proacl) a where a.grantee <> p.proowner and a.grantee <> 0), '') as acl from pg_proc p where p.proname in ('post_inbox', 'post_inbox_base') order by 1" % q(base_src))
    ok([(f["proname"], f["same"], f["acl"]) for f in fn] == ([("post_inbox", "t", "anon,authenticated,service_role")] if RED else [("post_inbox", "f", "anon,authenticated,service_role"), ("post_inbox_base", "t", "")]),
       "post_inbox keeps its grants; post_inbox_base is the old text word for word, for nobody: %s" % [(f["proname"], f["same"], f["acl"]) for f in fn])
    print("== D. Storage")
    put = lambda who, bucket, firm: refused(AS(who) + "insert into storage.objects (bucket_id, name) values (%s, %s);" % (q(bucket), q(firm + "/made-up/file.xml")))
    ok(not put("staff", "doc-inbox", F1) and not put("owner", "tally-uploads", F1) and not put("staff", "tally-uploads", F1), "owner and staff add to their firm's folder as before")
    ok(all("row-level security" in put("look", b, F1) for b in ("doc-inbox", "tally-uploads")), "look-only: refused in both buckets")
    ok(all("row-level security" in put("ro_staff", b, F3) for b in ("doc-inbox", "tally-uploads")), "a read-only firm's staff: refused in both")
    ok("row-level security" in put("staff", "doc-inbox", F2) and "row-level security" in put("staff", "tally-uploads", F2), "another firm's folder: refused as before")
    sp = {r["policyname"]: r["with_check"] for r in db.rows("select policyname, with_check from pg_policies where schemaname = 'storage' order by 1")}
    ok(all(sp[k].count("can_write()") == 1 for k in sp) and "doc-inbox" in sp["doc inbox: add to own firm"] and "foldername" in sp["tally_uploads_add"], "each policy's own text kept, can_write() asked once")
    print("== E. trigger functions")
    tf = db.rows("select p.proname, has_function_privilege('anon', p.oid, 'execute')::text a, has_function_privilege('authenticated', p.oid, 'execute')::text b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype order by 1")
    ok(len(tf) >= 3 and all(r["a"] in ("f", "false") and r["b"] in ("f", "false") for r in tf), "none of the %d executable by anon or authenticated" % len(tf))
    e = refused(AS("owner") + "update firms set name = '  ' where id = %s;" % q(F1))
    ok(not e and db.one("select name from firms where id = %s" % q(F1)) == "Made-up Firm One", "a trigger still runs for a signed-in person (firms_guard kept the firm's name)")
    print("== F. search_path")
    cfg = {r["sig"]: r["cfg"] for r in db.rows("select p.oid::regprocedure::text as sig, coalesce(p.proconfig::text, '') as cfg from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tally_post_jobs_undismiss_on_retry', 'firms_guard', 'asst_none', 'asst_col', 'asst_tds_rule', 'tally_nm', 'sync_empty', 'tally_recorder_drain_run')")}
    pinned = sorted(k.split("(")[0] for k, v in cfg.items() if "search_path=public, pg_temp" in v)
    ok(pinned == ["asst_col", "asst_none", "asst_tds_rule", "firms_guard", "tally_post_jobs_undismiss_on_retry"], "fixed on: %s" % ", ".join(pinned))
    ok(sorted(k.split("(")[0] for k, v in cfg.items() if not v) == ["sync_empty", "sync_empty", "tally_nm", "tally_recorder_drain_run"], "left: the procedure that commits, tally_nm, sync_empty")
    e = refused("call tally_recorder_drain_run(10);")
    ok(not e and db.one("select count(*) from t_drained") == "2", "the procedure still commits as it goes")
    asst1 = db.rows("select asst_none('x')::text a, asst_col('k', 'L')::text b, (select string_agg(rule || section, ',') from asst_tds_rule('Office RENT')) c, tally_nm(E' a \\n b ') d, sync_empty('{}'::jsonb)::text e, sync_empty(' ')::text f")
    ok(asst1 == asst0, "every answer the same")
    db.sql("insert into tally_post_jobs (status, dismissed_at) values ('failed', now()); update tally_post_jobs set status = 'waiting';")
    ok(db.one("select dismissed_at is null from tally_post_jobs") in ("t", "true"), "and the retry trigger works")
    print("== G. the four policies")
    pol = db.rows(POL)
    ok(len(pol) == 4 and all("auth.uid()" in (p["qual"] + p["chk"]) and not re.search(r"(?<!SELECT )auth\.uid\(\)", p["qual"] + p["chk"]) for p in pol), "auth.uid() asked through a select in all four")
    ok(reads() == read0 and read0["owner"] == ["1", "1", "1"] and read0["staff"] == ["0", "0", "0"] and read0["other"] == ["1", "1", "1"], "every person reads the same rows as before (the owner theirs, staff none)")
    ok(not refused(AS("staff") + "insert into client_timings (firm_id, user_id, what) values (%s, %s, 'mine');" % (q(F1), q(U["staff"])))
       and "row-level security" in refused(AS("staff") + "insert into client_timings (firm_id, user_id, what) values (%s, %s, 'another person');" % (q(F1), q(U["owner"])))
       and "row-level security" in refused(AS("staff") + "insert into client_timings (firm_id, user_id, at, what) values (%s, %s, now() - interval '1 hour', 'old');" % (q(F1), q(U["staff"]))),
       "a timing is added for oneself, now; for another person or another time refused, as before")
    print("== H. the indexes")
    ix = sorted(r["indexname"] for r in db.rows("select indexname from pg_indexes where indexname in ('assistant_notice_events_notice', 'firm_signals_firm')"))
    ok(ix == ["assistant_notice_events_notice", "firm_signals_firm"], "assistant_notice_events (notice_id) and firm_signals (firm_id): %s" % ix)
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
