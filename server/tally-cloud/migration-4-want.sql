-- build 197: Update now from any computer. A person asks (tally_want_update); the bridge on the Tally computer hears it
-- with its next heartbeat (every minute) and runs the update. Separate columns so the heartbeat never overwrites a request.
alter table public.tally_devices add column if not exists want_update_at timestamptz, add column if not exists want_sent_at timestamptz;
create or replace function public.tally_want_update(p_client text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm(); n int;
begin
  if f is null then raise exception 'not allowed'; end if;
  update tally_devices d set want_update_at = now()
   where d.firm_id = f and not coalesce(d.revoked, false)
     and d.id in (select c.device_id from tally_companies c where c.firm_id = f and c.client_id = p_client and c.device_id is not null);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'devices', n);
end $$;
revoke all on function public.tally_want_update(text) from public, anon;
grant execute on function public.tally_want_update(text) to authenticated;
