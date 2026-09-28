-- Cross-firm isolation and two-step test. Run on STAGING only (Supabase SQL editor, or execute_sql).
-- It makes a throw-away login in a second firm, tries to reach the first firm's data, and rolls everything back.
-- Expected: "ROLLBACK records=0 clients=0 backups=0 wallet=0 books=0 members=0 firms=0 secrets=0 dropkeys=0 upd=0
--            insertOther=false ... take_backup={ok:false} admin={ok:false}"
do $$
declare fa uuid; fb uuid; u uuid := gen_random_uuid(); r text := ''; n int; ins_ok boolean := false;
begin
  select firm_id into fa from public.members where role = 'owner' limit 1;
  select id into fb from public.firms where id <> fa limit 1;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-probe-' || u || '@example.invalid', '', now(), now());
  insert into public.members (user_id, firm_id, name, email, role, active) values (u, fb, 'probe', 'probe@example.invalid', 'staff', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.records where firm_id = fa; r := r || 'records=' || n;
  select count(*) into n from public.clients where firm_id = fa; r := r || ' clients=' || n;
  select count(*) into n from public.backups where firm_id = fa; r := r || ' backups=' || n;
  select count(*) into n from public.wallet_entries where firm_id = fa; r := r || ' wallet=' || n;
  select count(*) into n from public.client_books where firm_id = fa; r := r || ' books=' || n;
  select count(*) into n from public.members where firm_id = fa; r := r || ' members=' || n;
  select count(*) into n from public.firms where id = fa; r := r || ' firms=' || n;
  select count(*) into n from public.platform_secrets; r := r || ' secrets=' || n;
  select count(*) into n from public.drop_keys; r := r || ' dropkeys=' || n;
  update public.records set deleted = true where firm_id = fa; get diagnostics n = row_count; r := r || ' upd=' || n;
  begin insert into public.records (firm_id, kind, id, client_id, data) values (fa, 'entry', 'x', '', '{}'); ins_ok := true; exception when others then ins_ok := false; end;
  r := r || ' insertOther=' || ins_ok;
  r := r || ' take_backup=' || public.take_backup(fa)::text;
  begin r := r || ' admin=' || public.admin_credit(fa, 100, 'x')::text; exception when others then r := r || ' admin=denied'; end;
  begin perform public.refund_charge(fa, 100, 'x', 'x', null); r := r || ' refund=CALLABLE'; exception when others then r := r || ' refund=denied'; end;
  reset role;
  -- the owner of firm A without the second step sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.members where firm_id = fa and role = 'owner' limit 1), 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.records; r := r || ' ownerAal1records=' || n;
  reset role;
  raise exception 'ROLLBACK %', r;
end $$;
