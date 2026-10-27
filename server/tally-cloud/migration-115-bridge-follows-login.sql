-- Migration 115 (27-Oct-2026, branch next-bridge-follows-login; NOT run on staging: the owner reads it and runs it).
-- The owner, 27-Oct-2026: "it should not matter whose computer is opened.. it should matter which login there... every
-- login must have their account." A FinCom Bridge sends to the firm of the FinCom login using it, not to whichever login
-- paired it first.
--
-- Found on staging: bridge go-372b35a9cdf6 (NWS144, Windows user NW144\Durgesh) was paired on 24-Oct from a login of firm
-- ABC; the person later signed in to FinCom as a member of Garg Shekhar & Company and opened IX DESIGNS in Tally; the
-- bridge kept reporting to ABC (ABC's Tally page: "Not a client").
--
-- No bridge change (bridge 2.4.7 as it is): the FinCom page on that computer already holds the bridge's local key and
-- hands it a computer key with POST /cloudlink. Given a NEW key, the bridge first asks tally-ingest {kind: "own_key",
-- oldKey} with the new key, then says hello with it, and from then on sends only with the new key (it forgets the old).
-- What this migration adds is the cloud's side of a switch between FIRMS:
--   1. tally_bridge_whose(bridge): for the page of a member who may write, whether the bridge reports to this firm, to
--      another firm (true / false only: no firm, device or name of the other firm is said), and whether a posting is
--      waiting or running on it there (then the page waits; nothing is switched while one is).
--   2. tally_bridge_follow_ask(bridge, new device): the page, after tally_device_create and before /cloudlink, records
--      the switch asked (who, when, from which firm to which); refused while a posting is waiting or running on it, for a
--      member who may not write, or for a key that is not that member's new one.
--   3. tally_bridge_follow_move(bridge, old device, new device, Windows user): tally-ingest's own_key, when the old key is
--      of ANOTHER firm (the bridge proves it holds both keys). Only with an ask of the last 15 minutes for that bridge and
--      that new key; the bridge must be bound to the old key in its firm and known there as the same Windows user. The
--      old firm's device is REVOKED when no other bridge reports on it (tally-ingest then refuses every call with it,
--      beats included); its stored data stays, nothing is deleted. A device shared with another Windows user's bridge is
--      left as it is (that bridge keeps sending); this bridge no longer holds its key. The old firm's binding of the
--      bridge id is released (reset_at, reset_why), so the bridge can be bound again there if it ever comes back.
--   4. tally_bridge_switches: add-only (no update, no delete: a trigger refuses both) — who, when, from and to which firm,
--      and what was done. A member reads the rows of the firm the bridge came TO; the old firm learns only that its
--      device was moved away (tally_devices.info.movedAway: the bridge and when; never the other firm).
-- Only one firm receives a bridge's data at a time: the bridge holds one key (the new one), and the old device is revoked.
--
-- ADD-ONLY: one new table, its trigger, four new functions. Nothing removed, no row deleted, safe to run twice, one
-- transaction, lock_timeout 10 s. Grants explicit: authenticated executes whose / ask and reads the table under RLS;
-- service_role the move; anon nothing.
-- Deploy order: 115, then tally-ingest (its own_key calls tally_bridge_follow_move for a key of another firm; without 115
-- it answers as before), then the app build (without 115 the page sees no tally_bridge_whose and does nothing).
-- Tested on pg_stand: tests/run_migration115.py. The page: tests/run_bridge_follows_login.py.

begin;
set local lock_timeout = '10s';

create table if not exists public.tally_bridge_switches (
  id          bigint generated always as identity primary key,
  bridge_id   text not null,
  state       text not null check (state in ('asked', 'done', 'refused')),
  from_firm   uuid,
  from_device uuid,
  to_firm     uuid not null,
  to_device   uuid,
  by_user     uuid,
  revoked_old boolean not null default false,
  why         text not null default '',
  at          timestamptz not null default now()
);
create index if not exists tally_bridge_switches_to on public.tally_bridge_switches (to_firm, bridge_id, at desc);
alter table public.tally_bridge_switches enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_switches' and policyname = 'tally_bridge_switches_read') then
    create policy tally_bridge_switches_read on public.tally_bridge_switches for select to authenticated using (to_firm = my_firm());
  end if;
end $$;
revoke all on public.tally_bridge_switches from public, anon, authenticated;
grant select on public.tally_bridge_switches to authenticated;
grant select, insert on public.tally_bridge_switches to service_role;

-- add-only: a row once written is never changed or removed
create or replace function public.tally_bridge_switches_keep()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  raise exception 'tally_bridge_switches is add-only' using errcode = '42501';
end $function$;
revoke all on function public.tally_bridge_switches_keep() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_bridge_switches_keep' and tgrelid = 'public.tally_bridge_switches'::regclass) then
    create trigger tally_bridge_switches_keep before update or delete on public.tally_bridge_switches
      for each row execute function public.tally_bridge_switches_keep();
  end if;
end $$;

-- internal: a posting waiting or running on a bridge (or on its device for any of its bridges) in a firm
create or replace function public.tally_bridge_follow_busy(p_firm uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select exists (select 1 from tally_post_jobs j
                  where j.firm_id = p_firm and j.status in ('waiting', 'taken', 'running')
                    and (j.target_bridge = p_bridge or j.taken_by = p_bridge or (j.device_id = p_device and j.target_bridge is null)))
$function$;
revoke all on function public.tally_bridge_follow_busy(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_bridge_follow_busy(uuid, uuid, text) to service_role;

-- 1. the page's question. {may, mine, elsewhere, busy}
create or replace function public.tally_bridge_whose(p_bridge text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40); mine boolean; o record;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if b !~ '^go-[0-9a-f]{6,32}$' then return jsonb_build_object('may', can_write(), 'mine', false, 'elsewhere', false, 'busy', false); end if;
  mine := tally_bridge_device(f, b) is not null;
  -- the other firm's live device this bridge last reported on (the latest heard)
  select d.id, d.firm_id into o from tally_bridge_ids i join tally_devices d on d.id = i.device_id and d.firm_id = i.firm_id
   where i.bridge_id = b and i.reset_at is null and i.firm_id <> f and not coalesce(d.revoked, false) and d.info -> 'bridges' ? b
   order by d.info -> 'bridges' -> b ->> 'at' desc nulls last limit 1;
  return jsonb_build_object('may', can_write(), 'mine', mine, 'elsewhere', o.id is not null and not mine,
    'busy', o.id is not null and tally_bridge_follow_busy(o.firm_id, o.id, b));
end $function$;
revoke all on function public.tally_bridge_whose(text) from public, anon;
grant execute on function public.tally_bridge_whose(text) to authenticated, service_role;

-- 2. the switch asked by a member who may write, with the new key that member just made
create or replace function public.tally_bridge_follow_ask(p_bridge text, p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40); o record;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may write can move a bridge to it' using errcode = '42501'; end if;
  if b !~ '^go-[0-9a-f]{6,32}$' then raise exception 'not a FinCom Bridge id'; end if;
  if not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false)
                  and d.created_by = auth.uid() and d.created_at > now() - interval '15 minutes') then
    raise exception 'the computer key is not a new key of this firm made by you' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_bridge_follow:' || b));
  select d.id, d.firm_id into o from tally_bridge_ids i join tally_devices d on d.id = i.device_id and d.firm_id = i.firm_id
   where i.bridge_id = b and i.reset_at is null and i.firm_id <> f and not coalesce(d.revoked, false) and d.info -> 'bridges' ? b
   order by d.info -> 'bridges' -> b ->> 'at' desc nulls last limit 1;
  if o.id is not null and tally_bridge_follow_busy(o.firm_id, o.id, b) then
    insert into tally_bridge_switches (bridge_id, state, from_firm, from_device, to_firm, to_device, by_user, why)
      values (b, 'refused', o.firm_id, o.id, f, p_device, auth.uid(), 'a posting is waiting or running on this bridge');
    return jsonb_build_object('ok', false, 'busy', true);
  end if;
  insert into tally_bridge_switches (bridge_id, state, from_firm, from_device, to_firm, to_device, by_user, why)
    values (b, 'asked', o.firm_id, o.id, f, p_device, auth.uid(), 'the signed-in member''s firm differs from the bridge''s');
  return jsonb_build_object('ok', true, 'busy', false);
end $function$;
revoke all on function public.tally_bridge_follow_ask(text, uuid) from public, anon;
grant execute on function public.tally_bridge_follow_ask(text, uuid) to authenticated, service_role;

-- 3. tally-ingest's own_key with an old key of ANOTHER firm (the bridge holds both keys)
create or replace function public.tally_bridge_follow_move(p_bridge text, p_from uuid, p_to uuid, p_user text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b text := left(btrim(coalesce(p_bridge, '')), 40); fr record; t record; a record; others int; rv boolean := false;
begin
  if b !~ '^go-[0-9a-f]{6,32}$' then return jsonb_build_object('ok', false, 'moved', false, 'error', 'Not moved: not a bridge id.'); end if;
  select d.id, d.firm_id into fr from tally_devices d where d.id = p_from and not coalesce(d.revoked, false);
  select d.id, d.firm_id into t from tally_devices d where d.id = p_to and not coalesce(d.revoked, false);
  if fr.id is null or t.id is null or fr.firm_id = t.firm_id then
    return jsonb_build_object('ok', false, 'moved', false, 'error', 'Not moved: not two live computer keys of two firms.'); end if;
  perform pg_advisory_xact_lock(hashtext('tally_bridge_follow:' || b));
  select s.* into a from tally_bridge_switches s
   where s.bridge_id = b and s.to_firm = t.firm_id and s.to_device = p_to and s.state = 'asked' and s.at > now() - interval '15 minutes'
     and not exists (select 1 from tally_bridge_switches z where z.bridge_id = b and z.to_device = p_to and z.state = 'done')
   order by s.at desc limit 1;
  if a.id is null then return jsonb_build_object('ok', false, 'moved', false, 'error', 'Not moved: no member of the new firm asked for this bridge within 15 minutes.'); end if;
  if not exists (select 1 from tally_bridge_ids i where i.firm_id = fr.firm_id and i.bridge_id = b and i.device_id = p_from and i.reset_at is null) then
    return jsonb_build_object('ok', false, 'moved', false, 'error', 'Not moved: that bridge is not bound to the old computer key given.'); end if;
  if coalesce(tally_bridge_user(p_from, b), '') = '' or tally_bridge_user(p_from, b) <> lower(btrim(coalesce(p_user, ''))) then
    return jsonb_build_object('ok', false, 'moved', false, 'error', 'Not moved: FinCom knows that bridge on the old key as another Windows user''s.'); end if;
  -- the old firm's binding released (kept, with why); the bridge no longer reports there
  update tally_bridge_ids set reset_at = now(), reset_by = a.by_user, reset_why = 'moved to the firm of the FinCom login using it'
   where firm_id = fr.firm_id and bridge_id = b and reset_at is null;
  -- the old device: revoked when no other bridge reports on it; marked moved away either way (no firm named)
  select count(*) into others from tally_devices d, jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
   where d.id = p_from and k <> b;
  rv := others = 0;
  update tally_devices set revoked = revoked or rv,
         info = coalesce(info, '{}'::jsonb) || jsonb_build_object('movedAway', jsonb_build_object('bridge', b, 'at', now(), 'revoked', rv))
   where id = p_from;
  insert into tally_bridge_switches (bridge_id, state, from_firm, from_device, to_firm, to_device, by_user, revoked_old, why)
    values (b, 'done', fr.firm_id, p_from, t.firm_id, p_to, a.by_user, rv,
            case when rv then 'moved; the old firm''s computer key was removed (its data kept)' else 'moved; the old key is shared with another bridge, so it was left' end);
  raise log 'tally_bridge_follow_move: bridge % from device % (firm %) to device % (firm %), revoked %', b, p_from, fr.firm_id, p_to, t.firm_id, rv;
  return jsonb_build_object('ok', true, 'moved', true, 'bridge', b, 'revokedOld', rv);
end $function$;
revoke all on function public.tally_bridge_follow_move(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_bridge_follow_move(text, uuid, uuid, text) to service_role;

commit;
