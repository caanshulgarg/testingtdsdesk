-- Migration 139 (04-Nov-2026, branch next-bridge-signed-list): the gated rollout of FinCom Bridge updates. The owner's
-- requirement: an automatic update must never hang a computer or anyone's Tally; the coordinator's decision: let the
-- bridges through in the heartbeat's release answer (no bridge change), only when idle with Tally, and at most ONE bridge
-- per computer each 10 minutes, recorded.
--
-- tally-ingest (server/tally-cloud/updategate.js, index.ts) works out from the beat whether the bridge is idle with Tally
-- and at its own time to look for an update, and asks this function for the computer's slot:
--
--   tally_bridge_update_gate(p_firm uuid, p_device uuid, p_computer text, p_version text, p_ready boolean, p_why text) -> jsonb
--     {gate: false}                      no gate version set (tally_bridge_update_target empty): the release as before
--     {gate: true, allowed: false, why}  not let through now: up to date (or newer), a posting of this computer waiting
--                                        or taken, not ready (p_why: busy with Tally, or not its time), or another bridge
--                                        of the same computer was let through in the last 10 minutes, or its own slot
--                                        ended and another bridge of the computer is waiting
--     {gate: true, allowed: true, until} let through: its slot (10 minutes from granted_at), recorded once per slot
--
-- Tables (RLS on, nothing for anon or authenticated; service_role only):
--   tally_bridge_update_target   one row (id 1): the version the gate lets through (the newest on FinCom's signed list),
--                                set when that list is signed; bridges older than it are gated, the others never allowed
--   tally_bridge_update_grants   each slot given: firm, computer (tally_devices) and its name, the version from and to,
--                                when and until; kept, never deleted
--   tally_bridge_update_asks     each computer's last ask while ready (one row a computer, its time moved on), so a
--                                bridge whose slot ended yields to one that waits
--
-- ADD-ONLY: three new tables, one new function, one row; nothing altered or dropped, no row deleted; safe to run twice;
-- one transaction, lock_timeout 10 s. The slot is decided under a transaction lock of the firm and computer name
-- (pg_advisory_xact_lock), so two beats at once never both get it. Grants explicit. Tested on pg_stand:
-- tests/run_migration139.py (RED_WITHOUT_139=1 fails); tally-ingest: tests/run_update_gate_ingest.py.

begin;
set local lock_timeout = '10s';

create table if not exists public.tally_bridge_update_target (
  id      smallint primary key default 1 check (id = 1),
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  gap_min integer not null default 10 check (gap_min between 1 and 1440),
  set_at  timestamptz not null default now(),
  why     text not null default ''
);
create table if not exists public.tally_bridge_update_grants (
  id           bigserial primary key,
  firm_id      uuid not null references public.firms(id) on delete cascade,
  device_id    uuid not null references public.tally_devices(id) on delete cascade,
  computer     text not null default '',
  from_version text not null default '',
  version      text not null,
  granted_at   timestamptz not null default now(),
  until        timestamptz not null,
  why          text not null default ''
);
create index if not exists tally_bridge_update_grants_slot on public.tally_bridge_update_grants (firm_id, computer, granted_at desc);
create index if not exists tally_bridge_update_grants_dev on public.tally_bridge_update_grants (device_id, granted_at desc);
create table if not exists public.tally_bridge_update_asks (
  device_id uuid primary key references public.tally_devices(id) on delete cascade,
  firm_id   uuid not null references public.firms(id) on delete cascade,
  computer  text not null default '',
  version   text not null default '',
  asked_at  timestamptz not null default now()
);
alter table public.tally_bridge_update_target enable row level security;
alter table public.tally_bridge_update_grants enable row level security;
alter table public.tally_bridge_update_asks enable row level security;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_bridge_update_grants_kept' and tgrelid = 'public.tally_bridge_update_grants'::regclass) then
    create trigger tally_bridge_update_grants_kept before delete on public.tally_bridge_update_grants for each row execute function public.tally_control_kept();
  end if;
end $$;

-- the version the gate lets through: the newest on the signed list (2.5.3, published with its signature 04-Nov-2026)
insert into public.tally_bridge_update_target (id, version, why) values (1, '2.5.3', 'migration 139: the signed list names 2.5.3')
on conflict (id) do nothing;

create or replace function public.tally_bridge_update_gate(p_firm uuid, p_device uuid, p_computer text, p_version text, p_ready boolean, p_why text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  tg record;
  comp text := left(coalesce(nullif(btrim(p_computer), ''), 'device:' || coalesce(p_device::text, '')), 120);
  gap interval;
  own record;
  other record;
  nowt timestamptz := now();
begin
  select * into tg from tally_bridge_update_target where id = 1;
  if tg is null then return jsonb_build_object('gate', false); end if;
  gap := make_interval(mins => tg.gap_min);
  if p_firm is null or p_device is null or coalesce(p_version, '') !~ '^\d+\.\d+\.\d+$' then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', 'not a bridge version');
  end if;
  if not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm) then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', 'not a computer of this firm');
  end if;
  if string_to_array(p_version, '.')::int[] >= string_to_array(tg.version, '.')::int[] then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', 'up to date');
  end if;
  if exists (select 1 from tally_post_jobs j where j.device_id = p_device and j.status in ('waiting', 'taken')) then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', 'a posting of this computer is waiting or going on');
  end if;
  if not coalesce(p_ready, false) then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', left(coalesce(nullif(p_why, ''), 'not ready'), 200));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tally_bridge_update_gate|' || p_firm::text || '|' || comp, 139));
  insert into tally_bridge_update_asks (device_id, firm_id, computer, version, asked_at) values (p_device, p_firm, comp, p_version, nowt)
  on conflict (device_id) do update set firm_id = excluded.firm_id, computer = excluded.computer, version = excluded.version, asked_at = excluded.asked_at;
  -- its own slot, still running
  select * into own from tally_bridge_update_grants g where g.device_id = p_device and g.version = tg.version order by g.granted_at desc limit 1;
  if own.id is not null and own.until > nowt then
    return jsonb_build_object('gate', true, 'allowed', true, 'until', own.until, 'since', own.granted_at);
  end if;
  -- another bridge of this computer let through in the last 10 minutes: it goes first
  select * into other from tally_bridge_update_grants g where g.firm_id = p_firm and g.computer = comp and g.device_id <> p_device and g.granted_at > nowt - gap
    order by g.granted_at desc limit 1;
  if other.id is not null then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', 'another bridge of this computer updates first (until ' || to_char(other.granted_at + gap, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ')');
  end if;
  -- its own slot ended in the last 10 minutes and another bridge of this computer, older than the gate's version, waits:
  -- that one's turn
  if own.id is not null and own.until > nowt - gap and exists (select 1 from tally_bridge_update_asks a where a.firm_id = p_firm and a.computer = comp
       and a.device_id <> p_device and a.asked_at > nowt - interval '2 minutes'
       and a.version ~ '^\d+\.\d+\.\d+$' and string_to_array(a.version, '.')::int[] < string_to_array(tg.version, '.')::int[]) then
    return jsonb_build_object('gate', true, 'allowed', false, 'why', 'another bridge of this computer waits its turn');
  end if;
  insert into tally_bridge_update_grants (firm_id, device_id, computer, from_version, version, granted_at, until, why)
  values (p_firm, p_device, comp, p_version, tg.version, nowt, nowt + gap, left(coalesce(p_why, ''), 200))
  returning * into own;
  return jsonb_build_object('gate', true, 'allowed', true, 'until', own.until, 'since', own.granted_at, 'new', true);
end $function$;

revoke all on table public.tally_bridge_update_target, public.tally_bridge_update_grants, public.tally_bridge_update_asks from public, anon, authenticated;
grant select, insert, update on table public.tally_bridge_update_target to service_role;
grant select, insert on table public.tally_bridge_update_grants to service_role;
grant select, insert, update on table public.tally_bridge_update_asks to service_role;
grant usage, select on sequence public.tally_bridge_update_grants_id_seq to service_role;
revoke all on function public.tally_bridge_update_gate(uuid, uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.tally_bridge_update_gate(uuid, uuid, text, text, boolean, text) to service_role;

commit;
