-- Migration 54 (05-Oct-2026, FinCom Bridge 2.3.0): one bridge for each Windows user on a shared Windows server. NW144 runs
-- several users' TallyPrime, each in its own Windows session; each user's FinCom Bridge has its own local port, its own
-- computer key (its own tally_devices row, named "<PC> · <Windows user>") and its own entry in info.bridges. A posting now
-- names the bridge that is to post it, so it goes into the right user's Tally.
-- Runs AFTER 53 (fresh database: ... -> 52 -> 53 -> 54; staging: after 53). ADD-ONLY: no table, column, row or function
-- removed; no statement that removes rows anywhere in this file, not even in a comment; safe to run twice; one transaction.
--
--   1. tally_post_jobs.target_bridge (text, null): the bridge (its id, "go-…") that is to post the posting. Null: the
--      computer's main bridge, as today (every posting queued before 54, and those queued by an older FinCom page).
--   2. tally_bridge_prefs (device, bridge): changes_only, an owner's switch per bridge ("Changes only": a staff member's
--      bridge that reads Tally's changes and never posts). tally_bridge_changes_only(p_device, p_bridge, p_on), owners only.
--   3. tally_member_bridges (firm, member): the bridge a member posts through by default, set by an owner on the Tally page.
--      tally_member_bridge_link(p_user, p_device, p_bridge), owners only; a null bridge unlinks (the row stays, bridge null).
--   4. tally_post_enqueue_to(p_id, p_client, p_payload, p_target): tally_post_enqueue (36b's, unchanged, every check of it
--      kept) with a target. No target given: the poster's own linked bridge, unless it is changes only (then none: the main
--      bridge). A target other than the poster's own linked bridge: owners only. A changes-only bridge is never a target; a
--      bridge FinCom has not heard from on one of the firm's computers is refused. The posting goes to the target's computer
--      (device_id). Members only.
--   5. tally_post_take_for(p_device, p_bridge, p_main): tally_post_take (36b's) for one bridge: the oldest waiting posting of
--      its computer that names it, or names none when p_main (it is the computer's main bridge, tally-ingest decides); a
--      changes-only bridge takes none, nor a bridge FinCom has not heard from on that computer. The service role only (tally-ingest).
--   The 3-argument tally_post_enqueue and tally_post_take stay as they are (an older FinCom page, an older cloud function).
--   Tested on pg_stand only: tests/run_migration54.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- 1. the bridge a posting is for
alter table public.tally_post_jobs add column if not exists target_bridge text;

-- ---------------------------------------------------------------- 2. changes only, per bridge
create table if not exists public.tally_bridge_prefs (
  device_id    uuid not null references public.tally_devices(id) on delete cascade,
  bridge_id    text not null,
  firm_id      uuid not null references public.firms(id) on delete cascade,
  changes_only boolean not null default false,
  set_by       uuid,
  set_at       timestamptz not null default now(),
  primary key (device_id, bridge_id)
);
alter table public.tally_bridge_prefs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_prefs' and policyname = 'tally_bridge_prefs_read') then
    create policy tally_bridge_prefs_read on public.tally_bridge_prefs for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke insert, update on public.tally_bridge_prefs from anon, authenticated;
grant select on public.tally_bridge_prefs to authenticated;

-- ---------------------------------------------------------------- 3. the bridge a member posts through
create table if not exists public.tally_member_bridges (
  firm_id   uuid not null references public.firms(id) on delete cascade,
  user_id   uuid not null,
  device_id uuid references public.tally_devices(id) on delete set null,
  bridge_id text,
  set_by    uuid,
  set_at    timestamptz not null default now(),
  primary key (firm_id, user_id)
);
alter table public.tally_member_bridges enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_member_bridges' and policyname = 'tally_member_bridges_read') then
    create policy tally_member_bridges_read on public.tally_member_bridges for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke insert, update on public.tally_member_bridges from anon, authenticated;
grant select on public.tally_member_bridges to authenticated;

-- the firm's computer (not removed) on which FinCom has heard from a bridge: its id, or null (internal: granted to nobody)
create or replace function public.tally_bridge_device(p_firm uuid, p_bridge text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $function$
  select d.id from tally_devices d
   where d.firm_id = p_firm and not coalesce(d.revoked, false) and coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$' and d.info -> 'bridges' ? p_bridge
   order by d.info -> 'bridges' -> p_bridge ->> 'at' desc nulls last limit 1
$function$;
revoke all on function public.tally_bridge_device(uuid, text) from public, anon, authenticated;

-- whether a bridge is switched to changes only (internal: granted to nobody)
create or replace function public.tally_bridge_changes_only_on(p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select p.changes_only from tally_bridge_prefs p where p.device_id = p_device and p.bridge_id = p_bridge), false)
$function$;
revoke all on function public.tally_bridge_changes_only_on(uuid, text) from public, anon, authenticated;

create or replace function public.tally_bridge_changes_only(p_device uuid, p_bridge text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40);
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can switch a bridge to changes only' using errcode = '42501'; end if;
  if not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false) and d.info -> 'bridges' ? b)
    then raise exception 'not a bridge FinCom has heard from on this computer'; end if;
  insert into tally_bridge_prefs (device_id, bridge_id, firm_id, changes_only, set_by, set_at) values (p_device, b, f, coalesce(p_on, false), auth.uid(), now())
    on conflict (device_id, bridge_id) do update set changes_only = excluded.changes_only, set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('ok', true, 'device', p_device, 'bridge', b, 'changesOnly', coalesce(p_on, false));
end $function$;
revoke all on function public.tally_bridge_changes_only(uuid, text, boolean) from public, anon;
grant execute on function public.tally_bridge_changes_only(uuid, text, boolean) to authenticated;

create or replace function public.tally_member_bridge_link(p_user uuid, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := nullif(left(btrim(coalesce(p_bridge, '')), 40), '');
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can link a member to a bridge' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = p_user and m.firm_id = f) then raise exception 'not a member of this firm'; end if;
  if b is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false) and d.info -> 'bridges' ? b)
    then raise exception 'not a bridge FinCom has heard from on this computer'; end if;
  insert into tally_member_bridges (firm_id, user_id, device_id, bridge_id, set_by, set_at)
    values (f, p_user, case when b is null then null else p_device end, b, auth.uid(), now())
    on conflict (firm_id, user_id) do update set device_id = excluded.device_id, bridge_id = excluded.bridge_id, set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('ok', true, 'user', p_user, 'bridge', b);
end $function$;
revoke all on function public.tally_member_bridge_link(uuid, uuid, text) from public, anon;
grant execute on function public.tally_member_bridge_link(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- 4. queueing with a target
create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb;
begin
  if f is null then raise exception 'not allowed'; end if;
  is_owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  select mb.device_id, mb.bridge_id into own from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.bridge_id is not null;
  if t is null then
    -- the poster's own linked bridge, unless it is changes only (then none: the computer's main bridge, as today)
    if own.bridge_id is not null and tally_bridge_device(f, own.bridge_id) is not null
       and not tally_bridge_changes_only_on(tally_bridge_device(f, own.bridge_id), own.bridge_id) then t := own.bridge_id; end if;
  else
    if t is distinct from own.bridge_id and not is_owner then
      return jsonb_build_object('ok', false, 'error', 'Only an owner of the firm can post through another bridge than your own.'); end if;
    if tally_bridge_device(f, t) is null then
      return jsonb_build_object('ok', false, 'error', 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'); end if;
    if tally_bridge_changes_only_on(tally_bridge_device(f, t), t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'); end if;
  end if;
  if t is not null then tdev := tally_bridge_device(f, t); end if;
  r := tally_post_enqueue(p_id, p_client, p_payload);
  if coalesce((r->>'ok')::boolean, false) and t is not null then
    -- a new posting, or a Retry waiting again: it is for the target, on its computer (a posting already taken keeps its own)
    update tally_post_jobs set target_bridge = t, device_id = tdev where id = p_id and firm_id = f and status = 'waiting'
      and (target_bridge is null or coalesce((r->>'again')::boolean, false) = false);
  end if;
  return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
end $function$;
revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text) from public, anon;
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- 5. the hand-out, per bridge
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language sql security definer set search_path = public, pg_temp as $function$
  update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, message = 'Taken by the Tally computer'
   where id = (select j.id from tally_post_jobs j
                where j.device_id = p_device and j.status = 'waiting'
                  and (j.target_bridge = p_bridge or (j.target_bridge is null and coalesce(p_main, false)))
                  and not tally_bridge_changes_only_on(p_device, p_bridge)
                  and exists (select 1 from tally_devices d where d.id = p_device and d.info -> 'bridges' ? p_bridge)
                order by j.created_at limit 1 for update skip locked)
  returning *;
$function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;

commit;
