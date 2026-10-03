-- The main bridge of a computer, 02-Oct-2026. FinCom Bridge 2.x can run beside bridge 1.15.0 in test mode (reading
-- only) on the same computer key. Only one bridge may ever post to Tally: the "main" one. Until this is set it is the
-- bridge that does not call itself a test (bridge 1.15.0, or 2.x installed as the only bridge). Once a bridge is made
-- the main one (from FinCom's Tally page, or from the bridge's own menu), tally-ingest gives postings only to it and
-- refuses them to every other bridge on that key.
--   tally_devices + main_bridge, main_set_at, main_set_by
--   tally_bridge_make_main(device, bridge)   an owner of the firm makes a bridge the main one
-- Adds only; nothing is dropped or deleted.

begin;

alter table public.tally_devices add column if not exists main_bridge text;
alter table public.tally_devices add column if not exists main_set_at timestamptz;
alter table public.tally_devices add column if not exists main_set_by uuid;
-- the firm reads which bridge is the main one (its other columns are granted one by one, as here)
grant select (main_bridge, main_set_at, main_set_by) on public.tally_devices to authenticated;

create or replace function public.tally_bridge_make_main(p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40);
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose the main bridge' using errcode = '42501'; end if;
  if b !~ '^go-[0-9a-f]{6,32}$' then raise exception 'not a bridge FinCom has heard from'; end if;
  if not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false) and d.info -> 'bridges' ? b)
    then raise exception 'not a bridge FinCom has heard from on this computer'; end if;
  update tally_devices set main_bridge = b, main_set_at = now(), main_set_by = auth.uid() where id = p_device and firm_id = f;
  return jsonb_build_object('ok', true, 'main', b);
end $function$;
revoke all on function public.tally_bridge_make_main(uuid, text) from public, anon;
grant execute on function public.tally_bridge_make_main(uuid, text) to authenticated;

commit;
