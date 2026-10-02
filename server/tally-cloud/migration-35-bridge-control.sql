-- Bridge control, 02-Oct-2026 (plan items 11 and 12: so a hanging Tally cannot recur). Two things an owner of the firm
-- can do from FinCom's Tally page, and the heartbeat (tally-ingest, kind "beat") passes on within one beat (30 s):
--
-- 1. Stop reading / Resume reading. FinCom Bridge stops reading Tally on one computer, or on all the firm's computers;
--    posting goes on. The bridge can also stop itself (a request over 20 s, or Tally silent for 2 minutes); it says so
--    in its beat (readStopped), and Resume from FinCom lifts that too.
--      tally_read_stops                 one row per Stop (action 'stop') and per Resume (action 'resume'); a stop is
--                                       cleared (cleared_at, cleared_by), never deleted; device_id null = all computers
--      tally_read_stop(device, reason)  an owner stops reading (device null: all computers); asked again, the same stop
--      tally_read_resume(device)        an owner clears the stops (device null: every stop of the firm) and records a
--                                       'resume' row: the beat answers readResume once, so a bridge that stopped itself
--                                       reads again
-- 2. Staged release. A new bridge version installs only where FinCom allows it: first on one pilot computer, then, after
--    a working day on the pilot, on all of them.
--      tally_bridge_releases            (firm, version): the pilot computer, when the pilot started and who started it,
--                                       what the pilot computer showed on that version (the beat records it), when the
--                                       version was approved for all and by whom
--      tally_release_pilot(version, device)  an owner makes a computer the pilot for a version
--      tally_release_approve(version)        an owner approves it for every computer. Refused until the pilot ran a
--                                       working day: 20 hours since the pilot started, the pilot computer seen on that
--                                       version (its first beat on it after the pilot started), its beats on it
--                                       spanning 6 hours or more (it was used, not started once), and it did not stop
--                                       reading by itself while on it.
-- Owner-only exactly as tally_bridge_make_main (migration-22). Members of the firm read both tables; nobody writes them
-- directly (only these functions, and tally-ingest with the service key). Adds only: nothing is dropped, deleted or
-- revoked from what is there; safe to run again. To be shown to the owner before it runs.

begin;

-- ---------------------------------------------------------------- 1. stop / resume reading
create table if not exists public.tally_read_stops (
  id          bigint generated always as identity primary key,
  firm_id     uuid not null,
  device_id   uuid,                                  -- the computer (tally_devices); null = all the firm's computers
  action      text not null default 'stop' check (action in ('stop', 'resume')),
  reason      text not null default '',
  stopped_by  uuid,                                  -- who stopped (or, on a 'resume' row, who resumed)
  stopped_at  timestamptz not null default now(),    -- when
  cleared_by  uuid,                                  -- a stop: who resumed it
  cleared_at  timestamptz                            -- a stop: when it was resumed (null: still stopped)
);
create index if not exists tally_read_stops_firm on public.tally_read_stops (firm_id, id desc);
create index if not exists tally_read_stops_live on public.tally_read_stops (firm_id) where action = 'stop' and cleared_at is null;

-- ---------------------------------------------------------------- 2. staged release
create table if not exists public.tally_bridge_releases (
  firm_id             uuid not null,
  version             text not null check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  pilot_device        uuid,                          -- the pilot computer (tally_devices)
  pilot_started_at    timestamptz,
  pilot_by            uuid,
  pilot_seen_at       timestamptz,                   -- evidence (tally-ingest's beat): the pilot computer's first beat on this version
  pilot_last_seen_at  timestamptz,                   --   and its latest one
  pilot_beats         integer not null default 0,    --   how many beats on it were noted (at most one each 5 minutes)
  pilot_self_stop     jsonb,                         --   {reason, at}: it stopped reading by itself while on this version
  approved_at         timestamptz,                   -- approved for every computer of the firm
  approved_by         uuid,
  note                text not null default '',
  primary key (firm_id, version)
);

-- both are kept: a row is never deleted (a stop is cleared, a pilot started again)
create or replace function public.tally_control_kept() returns trigger language plpgsql as $function$
begin
  raise exception '% rows are kept, never deleted', tg_table_name using errcode = '42501';
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_read_stops_kept' and tgrelid = 'public.tally_read_stops'::regclass) then
    create trigger tally_read_stops_kept before delete on public.tally_read_stops for each row execute function public.tally_control_kept();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_bridge_releases_kept' and tgrelid = 'public.tally_bridge_releases'::regclass) then
    create trigger tally_bridge_releases_kept before delete on public.tally_bridge_releases for each row execute function public.tally_control_kept();
  end if;
end $$;

-- the firm reads them; nobody writes them directly
alter table public.tally_read_stops enable row level security;
alter table public.tally_bridge_releases enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_read_stops' and policyname = 'tally_read_stops_read') then
    create policy tally_read_stops_read on public.tally_read_stops for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_releases' and policyname = 'tally_bridge_releases_read') then
    create policy tally_bridge_releases_read on public.tally_bridge_releases for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
grant select on public.tally_read_stops, public.tally_bridge_releases to authenticated;
revoke insert, update, delete, truncate on public.tally_read_stops, public.tally_bridge_releases from anon, authenticated;

-- ---------------------------------------------------------------- the owner's functions
create or replace function public.tally_read_stop(p_device uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_reason, '')), 300); had bigint; nid bigint;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can stop reading Tally' using errcode = '42501'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if why = '' then why := 'Stopped from FinCom'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_read_stops:' || f::text));
  select id into had from tally_read_stops s where s.firm_id = f and s.action = 'stop' and s.cleared_at is null and s.device_id is not distinct from p_device order by id desc limit 1;
  if had is not null then return jsonb_build_object('ok', true, 'id', had, 'already', true); end if;
  insert into tally_read_stops (firm_id, device_id, action, reason, stopped_by) values (f, p_device, 'stop', why, auth.uid()) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
end $function$;

create or replace function public.tally_read_resume(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); n int := 0; nid bigint;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can resume reading Tally' using errcode = '42501'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_read_stops:' || f::text));
  if p_device is not null and exists (select 1 from tally_read_stops s where s.firm_id = f and s.action = 'stop' and s.cleared_at is null and s.device_id is null)
    then raise exception 'reading is stopped on all computers; resume all computers first'; end if;
  -- cleared, never deleted; one computer: its own stops; all computers: every stop of the firm
  update tally_read_stops s set cleared_at = now(), cleared_by = auth.uid()
   where s.firm_id = f and s.action = 'stop' and s.cleared_at is null and (p_device is null or s.device_id = p_device);
  get diagnostics n = row_count;
  -- the beat answers readResume once from this row, so a bridge that stopped itself reads again too
  insert into tally_read_stops (firm_id, device_id, action, reason, stopped_by) values (f, p_device, 'resume', '', auth.uid()) returning id into nid;
  return jsonb_build_object('ok', true, 'cleared', n, 'id', nid);
end $function$;

create or replace function public.tally_release_pilot(p_version text, p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); r tally_bridge_releases%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can start a pilot' using errcode = '42501'; end if;
  if v !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then raise exception 'not a bridge version (like 2.1.5)'; end if;
  if p_device is null or not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if found and r.approved_at is not null then raise exception 'version % is approved for all computers already', v; end if;
  if found and r.pilot_device = p_device and r.pilot_started_at is not null then
    return jsonb_build_object('ok', true, 'version', v, 'pilot', p_device, 'started', r.pilot_started_at, 'already', true);
  end if;
  -- a new pilot (or another pilot computer): the working day starts again, with no evidence yet
  insert into tally_bridge_releases (firm_id, version, pilot_device, pilot_started_at, pilot_by) values (f, v, p_device, now(), auth.uid())
  on conflict (firm_id, version) do update set pilot_device = excluded.pilot_device, pilot_started_at = excluded.pilot_started_at, pilot_by = excluded.pilot_by,
    pilot_seen_at = null, pilot_last_seen_at = null, pilot_beats = 0, pilot_self_stop = null;
  return jsonb_build_object('ok', true, 'version', v, 'pilot', p_device, 'started', now());
end $function$;

create or replace function public.tally_release_approve(p_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); r tally_bridge_releases%rowtype; pc text;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can approve a bridge version' using errcode = '42501'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if not found or r.pilot_started_at is null or r.pilot_device is null then raise exception 'version % has not been on a pilot computer; start a pilot first', v; end if;
  if r.approved_at is not null then return jsonb_build_object('ok', true, 'version', v, 'approved', r.approved_at, 'already', true); end if;
  select name into pc from tally_devices where id = r.pilot_device;
  pc := coalesce(pc, 'the pilot computer');
  -- a working day on the pilot: 20 hours since it started, seen on the version, used on it for 6 hours, never self-stopped
  if r.pilot_started_at > now() - interval '20 hours' then
    raise exception 'the pilot of % on % has not run a working day yet: it started %; approve after %', v, pc,
      to_char(r.pilot_started_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), to_char((r.pilot_started_at + interval '20 hours') at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI');
  end if;
  if r.pilot_seen_at is null or r.pilot_seen_at < r.pilot_started_at then
    raise exception '% has not been seen running % since the pilot started; it must run it first', pc, v;
  end if;
  if coalesce(r.pilot_last_seen_at, r.pilot_seen_at) < r.pilot_seen_at + interval '6 hours' then
    raise exception '% has run % for less than 6 hours (seen % to %); let it run a working day', pc, v,
      to_char(r.pilot_seen_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), to_char(coalesce(r.pilot_last_seen_at, r.pilot_seen_at) at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI');
  end if;
  if r.pilot_self_stop is not null then
    raise exception '% stopped reading by itself while on % (%); not approved', pc, v, coalesce(r.pilot_self_stop ->> 'reason', '');
  end if;
  update tally_bridge_releases set approved_at = now(), approved_by = auth.uid() where firm_id = f and version = v;
  return jsonb_build_object('ok', true, 'version', v, 'approved', now());
end $function$;

revoke all on function public.tally_read_stop(uuid, text), public.tally_read_resume(uuid), public.tally_release_pilot(text, uuid), public.tally_release_approve(text) from public, anon;
grant execute on function public.tally_read_stop(uuid, text), public.tally_read_resume(uuid), public.tally_release_pilot(text, uuid), public.tally_release_approve(text) to authenticated;

commit;
