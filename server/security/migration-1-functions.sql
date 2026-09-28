-- Security hardening 1: who may call the database functions.
-- Found in the VAPT review (Sep 2026): anyone holding the public (anon) key could call
-- refund_charge / charge_for / run_monthly_core / take_backup / price_of directly through /rest/v1/rpc,
-- e.g. adding credit to any firm's wallet. These are internal: only the gateway (service role),
-- other functions and the nightly job use them.

-- 1. internal money and job functions: nobody outside the server
revoke execute on function public.refund_charge(uuid, numeric, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.charge_for(uuid, uuid, text, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.run_monthly_core(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.price_of(uuid, text) from public, anon, authenticated;

-- 2. every other function: signed-in users only, except the three the public pages use
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and p.proname not in ('signup_info', 'post_inbox', 'refresh_inbox_link')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname not in ('refund_charge', 'charge_for', 'run_monthly_core', 'price_of') then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;

-- 3. a charge is always for at least one unit
create or replace function public.charge_usage(p_code text, p_qty numeric, p_ref text default '', p_note text default '')
returns jsonb language sql security definer set search_path to 'public' as $$
  select case when coalesce(p_qty, 0) <= 0 or p_qty > 1000 then jsonb_build_object('ok', false, 'reason', 'bad_qty')
              else public.charge_for(public.my_firm(), auth.uid(), p_code, p_qty, p_ref, p_note) end
$$;

-- 4. a backup on request: only the firm's owner, for their own firm (or the platform administrator);
--    the nightly job (no signed-in user) backs up every firm as before
create or replace function public.take_backup(p_firm uuid default null::uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_data jsonb; v_n int := 0;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_superadmin() then
    if p_firm is null or p_firm is distinct from public.my_firm()
       or not exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'owner') then
      return jsonb_build_object('ok', false, 'reason', 'Only the firm owner can take a backup of their own firm.');
    end if;
  end if;
  for r in select id, name from public.firms where p_firm is null or id = p_firm loop
    select jsonb_build_object(
      'firm', to_jsonb(f) - 'balance',
      'clients', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.clients c where c.firm_id = r.id and not c.deleted),
      'records', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.records x where x.firm_id = r.id and not x.deleted),
      'client_books', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) from public.client_books k where k.firm_id = r.id),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'email', m.email, 'role', m.role, 'active', m.active)), '[]'::jsonb) from public.members m where m.firm_id = r.id)
    ) into v_data from public.firms f where f.id = r.id;
    insert into public.backups (firm_id, clients, records, bytes, data)
    values (r.id, coalesce(jsonb_array_length(v_data -> 'clients'), 0), coalesce(jsonb_array_length(v_data -> 'records'), 0), octet_length(v_data::text), v_data);
    v_n := v_n + 1;
    delete from public.backups b where b.firm_id = r.id and b.id not in (select id from public.backups where firm_id = r.id order by taken_at desc limit 14);
  end loop;
  return jsonb_build_object('ok', true, 'firms', v_n);
end $function$;
revoke execute on function public.take_backup(uuid) from public, anon;
grant execute on function public.take_backup(uuid) to authenticated;
revoke execute on function public.charge_usage(text, numeric, text, text) from public, anon;
grant execute on function public.charge_usage(text, numeric, text, text) to authenticated;

-- 5. the gateway gives money back through this (it called a function that did not exist)
grant execute on function public.refund_charge(uuid, numeric, text, text, uuid) to service_role;
grant execute on function public.charge_for(uuid, uuid, text, numeric, text, text) to service_role;
