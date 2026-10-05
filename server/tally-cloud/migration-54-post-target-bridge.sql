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
--   4. tally_post_enqueue_to(p_id, p_client, p_payload, p_target, p_device): a posting with a target. No target given: the
--      poster's own linked bridge, when it may post (not changes only, the main bridge of its computer) and is still bound
--      to the linked computer; else none. A target other than the poster's own: owners only; it must be named with its
--      computer (p_device), which must be the computer the bridge id is bound to (6.); a changes-only or read-only bridge,
--      or one not heard from, is refused. The target and its computer are set only on a NEW posting (review M2): queueing
--      a posting again, or a Retry, never moves it. tally_post_enqueue_core holds 36b's tally_post_enqueue text (every
--      check kept) with the computer chosen for a new posting (review M4): the target's; with none, the newest of the
--      firm's computers that may post and has the company open (the company's own computer first), never a changes-only
--      one; with none at all, refused in plain words. The 3-argument tally_post_enqueue (36b's) is replaced by a call to
--      tally_post_enqueue_to with no target, so an older FinCom page gets the same rules. Members only.
--   5. tally_post_take_for(p_device, p_bridge, p_main): tally_post_take (36b's) for one bridge: the oldest waiting posting of
--      its computer that names it, or names none when p_main (it is the computer's main bridge, tally-ingest decides); a
--      changes-only bridge takes none, nor a bridge FinCom has not heard from on that computer. The service role only (tally-ingest).
--   6. tally_bridge_ids (review M3): a bridge id ("go-…", which the bridge reports itself) belongs, within a firm, to the
--      first of the firm's computer keys that reported it (review M-A: bound per firm; one live binding per (firm, id); the
--      same id under another firm's computer, e.g. a cloned Windows profile, is that firm's own business: it never refuses,
--      and its computer's name and Windows user never appear in this firm's rows). tally_bridge_bind(p_device, p_bridge)
--      (the service role: tally-ingest, on every call naming a bridge) binds an id not bound yet in the computer's firm and
--      says whether it is this computer's; tally-ingest refuses an id bound to another computer of the same firm.
--      The ids heard from before 54 on exactly one computer of a firm are bound to it here; an id seen on two computers of
--      the same firm is left unbound there (the first of them to report it afterwards gets it), and named in a NOTICE.
--      Targets resolve through the firm's own bindings only.
--      A refused key: plain words on its own line (info.idRefused) and to its bridge, and ONE alert per (id, computer) for
--      the owners (tally_bridge_alerts; tally_bridge_alert_read). tally_bridge_reset(p_bridge, p_why), owners only, within
--      their firm: the binding kept with who, when and why (never removed), its alerts cleared; the next of the firm's
--      computers to report the id gets it.
--   7. Words (Fix 3): nobody can post into a company just now (none has it open; only changes-only bridges have it; the
--      poster's own bridge not heard from for 3 minutes): the company named, and what to do.
--   8. No posting stranded (review M-B): a waiting posting whose bridge can no longer post (switched to Changes only,
--      another bridge made the main one on its computer, not heard from there any more, in test mode), or naming no bridge
--      on a computer none of whose bridges may post, is moved to the bridge of the SAME computer key that may post (its
--      main bridge), else failed with plain words naming the company and what to do; never left waiting for ever
--      (tally_post_reroute, one posting; tally_post_rescue(p_device), every waiting posting of a computer: the service role,
--      tally-ingest, when it refuses a bridge postings). Run when an owner switches a bridge to Changes only, when a
--      computer's main bridge changes (a trigger on tally_devices.main_bridge), when a posting is queued again, and on Retry
--      (Retry: moved the same way, or refused in plain words; nothing changed). Never to another computer key: on a shared
--      Windows server each key is one Windows user's own Tally, so moving a posting there would post someone's entries into
--      another person's Tally without anyone choosing it (review M2 kept); posting the entries again as a new posting
--      chooses afresh, by the same rules as the 3-argument enqueue, for the person who posts them.
--   9. The owner's rule of 05-Oct-2026: no conditions on any bridge. Every bridge, of any Windows user, owner or staff, reads
--      and posts as soon as it is installed and paired; "Changes only" stays an owner's optional switch, off by default;
--      no limit by user, company or number of bridges; each bridge handles only its own Windows user's Tally:
--      a. a posting with no bridge named goes through the POSTER'S OWN bridge: the one the member is linked to (when it may
--         post and has the company open, or no other bridge of theirs has it), else the newest heard of the bridges that may
--         post and have the company open on a computer key the member made (tally_devices.created_by, kept by
--         tally_device_create); none: refused in plain words naming the company and what to do (tally_post_own_words),
--         never routed into another person's Tally. A bridge other than the poster's own (linked, or on a key they made):
--         an owner's explicit choice only. tally_post_device_for prefers the company's own computer only when it has the
--         company open there.
--      b. the poster's own bridge not heard from for 3 minutes: queued all the same, with a note ("waits for your FinCom
--         Bridge on <PC · user>"); the bridge takes it when it is back.
--      c. tally_member_bridge_link: any member who may write links HIMSELF (p_user = the caller) to a bridge FinCom has heard
--         from, unless it posts for another member already; an owner links anyone, as before.
--      d. the main-bridge rule (tally_devices.main_bridge) holds only among the bridges of ONE Windows user
--         (info.bridges[id].user, case ignored): on a computer key shared by several Windows users (1.15.0's settings
--         carried over), another user's main bridge stops nobody. Moving a posting (tally_post_reroute, tally_post_rescue)
--         never crosses Windows users: no bridge of the same user that may post, the posting fails in plain words.
--         A posting naming no bridge (older ones) is still taken only by the computer's main bridge, as before, and is
--         never moved. tally_bridge_own_key(p_bridge, p_to): a member's bridge on such a shared key moves to a NEW computer
--         key that member made for it (TCloud.auto); the old binding kept with who, when and why; its postings and links go
--         with it (the same bridge, the same Windows user's Tally).
--      e. tally_device_create: no limit of 50 computer keys a firm (one key for each Windows user's bridge); otherwise
--         migration.sql's text.
--      f. tally_want_update (Update now): wakes every computer key (not removed) whose bridges have the client's company open,
--         the company's own computer as before, and the caller's own keys.
--      g. tally_read_resume: a bridge that stopped reading by itself is resumed by any member who may write, on a computer
--         key they made; FinCom's own Stop (set by an owner, one computer or all) is still resumed only by an owner.
--  10. (item A) New bridge versions go to every computer by themselves: no pilot, no approval. tally-ingest's beat offers
--      the newest version on FinCom's signed list to every bridge, except a version the firm's owner HELD
--      (tally_bridge_releases.held_*: tally_release_hold / tally_release_unhold, owners only, a reason needed) or withdrew
--      (migration 37); the owner's "Roll back to <version>" (tally_bridge_rollbacks: tally_release_rollback /
--      tally_release_rollback_clear, owners only; one standing a firm) offers that version instead. Every action kept in
--      tally_bridge_release_log (who, when, why); rows kept, never removed.
--  11. (item C) "Apply now" on a held change line (tally_recorder_release_held): any member who may write (can_write()),
--      not only an owner; migration 53's text otherwise; the same checks as for any line; who and when kept.
--   tally_post_take stays as it is (an older cloud function).
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

-- ---------------------------------------------------------------- 6. a bridge id belongs to one computer (review M3, Fix 2)
-- one row per binding; the live one has reset_at null (one per firm and id, review M-A). An owner's release (tally_bridge_reset) keeps the row
-- with who, when and why; the next computer to report the id is bound by a new row. Rows are never removed
create table if not exists public.tally_bridge_ids (
  id        bigserial primary key,
  bridge_id text not null,
  device_id uuid not null references public.tally_devices(id) on delete cascade,
  firm_id   uuid not null references public.firms(id) on delete cascade,
  first_at  timestamptz not null default now(),
  reset_at  timestamptz,
  reset_by  uuid,
  reset_why text
);
create unique index if not exists tally_bridge_ids_live on public.tally_bridge_ids (firm_id, bridge_id) where reset_at is null;
create index if not exists tally_bridge_ids_firm on public.tally_bridge_ids (firm_id, bridge_id);
alter table public.tally_bridge_ids enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_ids' and policyname = 'tally_bridge_ids_read') then
    create policy tally_bridge_ids_read on public.tally_bridge_ids for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke insert, update on public.tally_bridge_ids from anon, authenticated;
grant select on public.tally_bridge_ids to authenticated;
-- Fix 2a: every id reported today (tally_devices.info.bridges, computers not removed) bound to the computer reporting it,
-- within its firm (review M-A); an id reported by two or more computers of the same firm is bound to none there and named
-- in a NOTICE for the owner (an insert only; safe twice)
insert into public.tally_bridge_ids (bridge_id, device_id, firm_id)
select x.k, (array_agg(x.id))[1], x.firm_id
  from (select d.id, d.firm_id, k from public.tally_devices d,
               jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
         where not coalesce(d.revoked, false) and k ~ '^go-[0-9a-f]{6,32}$') x
 where not exists (select 1 from public.tally_bridge_ids i where i.bridge_id = x.k and i.firm_id = x.firm_id)
 group by x.firm_id, x.k having count(distinct x.id) = 1
on conflict do nothing;
do $$
declare r record;
begin
  for r in select x.k, string_agg(x.id::text || ' (' || coalesce(x.name, '') || ')', ', ' order by x.id::text) as devs
             from (select d.id, d.name, d.firm_id, k from public.tally_devices d,
                          jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
                    where not coalesce(d.revoked, false) and k ~ '^go-[0-9a-f]{6,32}$') x
            where not exists (select 1 from public.tally_bridge_ids i where i.bridge_id = x.k and i.firm_id = x.firm_id and i.reset_at is null)
            group by x.firm_id, x.k having count(distinct x.id) > 1
  loop
    raise notice 'Migration 54: bridge id % is reported by more than one computer of one firm (%): bound to none; the first of them to report it from now on gets it (an owner can release it on the Tally page)', r.k, r.devs;
  end loop;
end $$;

-- Fix 2c: a computer key refused a bridge id: ONE alert per (id, computer) for the firm's owners (the bell), naming the
-- computer and Windows user that tried; cleared when the identity is released. Rows are never removed
create table if not exists public.tally_bridge_alerts (
  id              bigserial primary key,
  firm_id         uuid not null references public.firms(id) on delete cascade,
  bridge_id       text not null,
  device_id       uuid not null references public.tally_devices(id) on delete cascade,
  owner_device_id uuid,
  tried_computer  text not null default '',
  tried_user      text not null default '',
  words           text not null default '',
  at              timestamptz not null default now(),
  last_at         timestamptz not null default now(),
  read_at         timestamptz,
  read_by         uuid,
  cleared_at      timestamptz
);
create unique index if not exists tally_bridge_alerts_once on public.tally_bridge_alerts (bridge_id, device_id) where cleared_at is null;
alter table public.tally_bridge_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_alerts' and policyname = 'tally_bridge_alerts_read') then
    create policy tally_bridge_alerts_read on public.tally_bridge_alerts for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke insert, update on public.tally_bridge_alerts from anon, authenticated;
grant select on public.tally_bridge_alerts to authenticated;

-- a bridge on a computer in words: "<PC> · <Windows user>" from its heartbeat, else the computer's name (internal)
create or replace function public.tally_bridge_words(p_device uuid, p_bridge text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(nullif(concat_ws(' · ', nullif(d.info -> 'bridges' -> p_bridge ->> 'computer', ''), nullif(d.info -> 'bridges' -> p_bridge ->> 'user', '')), ''), d.name, '')
    from tally_devices d where d.id = p_device
$function$;
revoke all on function public.tally_bridge_words(uuid, text) from public, anon, authenticated;

-- tally-ingest, on every call naming a bridge: binds an id not bound yet in this computer's firm to this computer (review
-- M-A: only the firm's own bindings count; another firm's never refuses). {own: true} when it is this computer's; else
-- {own: false, words}, the one alert for the owner kept, and the words on this computer's line (info.idRefused); a
-- computer that is the id's own again loses its idRefused
create or replace function public.tally_bridge_bind(p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b text := left(btrim(coalesce(p_bridge, '')), 40); bound uuid; w text; me record; f uuid;
begin
  if b !~ '^go-[0-9a-f]{6,32}$' then return jsonb_build_object('own', true); end if;   -- bridge 1.15.0 ("v1") has no id of its own
  select d.firm_id into f from tally_devices d where d.id = p_device;
  if f is null then return jsonb_build_object('own', true); end if;
  insert into tally_bridge_ids (bridge_id, device_id, firm_id) values (b, p_device, f)
    on conflict (firm_id, bridge_id) where reset_at is null do nothing;
  select i.device_id into bound from tally_bridge_ids i where i.firm_id = f and i.bridge_id = b and i.reset_at is null;
  if bound = p_device then
    update tally_devices set info = info - 'idRefused' where id = p_device and info ? 'idRefused' and info -> 'idRefused' ->> 'bridge' = b;
    return jsonb_build_object('own', true);
  end if;
  w := 'This computer key cannot use bridge ' || b || ': it belongs to ' || tally_bridge_words(bound, b) || '. Ask the firm''s owner.';
  select d.firm_id, d.info -> 'bridges' -> b ->> 'computer' as c, d.info -> 'bridges' -> b ->> 'user' as u, d.name into me from tally_devices d where d.id = p_device;
  insert into tally_bridge_alerts (firm_id, bridge_id, device_id, owner_device_id, tried_computer, tried_user, words)
    values (me.firm_id, b, p_device, bound, coalesce(nullif(me.c, ''), me.name, ''), coalesce(me.u, ''), w)
    on conflict (bridge_id, device_id) where cleared_at is null do update set last_at = now();
  update tally_devices set info = info || jsonb_build_object('idRefused', jsonb_build_object('bridge', b, 'words', w, 'at', now())) where id = p_device;
  return jsonb_build_object('own', false, 'words', w);
end $function$;
revoke all on function public.tally_bridge_bind(uuid, text) from public, anon, authenticated;

-- Fix 2b: an owner releases a bridge's identity ("Release this bridge's identity" on the Tally page), in the owner's firm
-- only: the binding kept with who, when and why; its alerts cleared; the next of the firm's computers that reports the id
-- is bound to it
create or replace function public.tally_bridge_reset(p_bridge text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40); n int;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can release a bridge''s identity' using errcode = '42501'; end if;
  update tally_bridge_ids set reset_at = now(), reset_by = auth.uid(), reset_why = left(coalesce(p_why, ''), 300)
   where bridge_id = b and firm_id = f and reset_at is null;
  get diagnostics n = row_count;
  update tally_bridge_alerts set cleared_at = now() where bridge_id = b and firm_id = f and cleared_at is null;
  update tally_devices set info = info - 'idRefused' where firm_id = f and info -> 'idRefused' ->> 'bridge' = b;
  raise log 'tally_bridge_reset: bridge % released by % (%)', b, auth.uid(), left(coalesce(p_why, ''), 300);
  return jsonb_build_object('ok', true, 'bridge', b, 'released', n > 0, 'at', now());
end $function$;
revoke all on function public.tally_bridge_reset(text, text) from public, anon;
grant execute on function public.tally_bridge_reset(text, text) to authenticated;

-- an owner marks a bridge alert read (the bell)
create or replace function public.tally_bridge_alert_read(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm();
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can mark it read' using errcode = '42501'; end if;
  update tally_bridge_alerts set read_at = coalesce(read_at, now()), read_by = coalesce(read_by, auth.uid()) where id = p_id and firm_id = f;
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.tally_bridge_alert_read(bigint) from public, anon;
grant execute on function public.tally_bridge_alert_read(bigint) to authenticated;

-- the firm's computer (not removed) a bridge id is bound to, and on which FinCom has heard from it: its id, or null
-- (internal: granted to nobody)
create or replace function public.tally_bridge_device(p_firm uuid, p_bridge text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $function$
  select d.id from tally_bridge_ids i join tally_devices d on d.id = i.device_id
   where i.firm_id = p_firm and i.bridge_id = p_bridge and i.reset_at is null and d.firm_id = p_firm and not coalesce(d.revoked, false) and coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$'
     and d.info -> 'bridges' ? p_bridge
$function$;
revoke all on function public.tally_bridge_device(uuid, text) from public, anon, authenticated;

-- whether a bridge is switched to changes only (internal: granted to nobody)
create or replace function public.tally_bridge_changes_only_on(p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select p.changes_only from tally_bridge_prefs p where p.device_id = p_device and p.bridge_id = p_bridge), false)
$function$;
revoke all on function public.tally_bridge_changes_only_on(uuid, text) from public, anon, authenticated;

-- the Windows user a bridge works for (info.bridges[id].user, trimmed, case ignored); null when FinCom has not heard from
-- it on that computer (internal: granted to nobody)
create or replace function public.tally_bridge_user(p_device uuid, p_bridge text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select lower(btrim(coalesce(d.info -> 'bridges' -> p_bridge ->> 'user', ''))) from tally_devices d
   where d.id = p_device and jsonb_typeof(d.info -> 'bridges') = 'object' and d.info -> 'bridges' ? p_bridge
$function$;
revoke all on function public.tally_bridge_user(uuid, text) from public, anon, authenticated;

-- whether a bridge may be given postings: not changes only, and (9d) the main bridge among the bridges of ITS OWN Windows
-- user on its computer (tally_devices.main_bridge, when that is a bridge of the same user); else (no main chosen, or the
-- main bridge is another Windows user's) a bridge not in test mode. As tally-ingest's mayPost (internal: granted to nobody)
create or replace function public.tally_bridge_may_post(p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select not tally_bridge_changes_only_on(p_device, p_bridge)
     and exists (select 1 from tally_devices d where d.id = p_device and d.info -> 'bridges' ? p_bridge
                   and (case when nullif(d.main_bridge, '') is not null and d.info -> 'bridges' ? d.main_bridge
                                  and tally_bridge_user(d.id, d.main_bridge) = tally_bridge_user(d.id, p_bridge) then d.main_bridge = p_bridge
                             else coalesce(d.info -> 'bridges' -> p_bridge ->> 'mode', 'main') <> 'test' end))
$function$;
revoke all on function public.tally_bridge_may_post(uuid, text) from public, anon, authenticated;

-- a posting naming no bridge (queued before 54, or for a bridge 1.15.0 with no id of its own) is taken, as before, only by
-- the computer's main bridge (the one chosen; none chosen: a bridge not in test mode), never a changes-only one (internal:
-- granted to nobody)
create or replace function public.tally_bridge_takes_unnamed(p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select not tally_bridge_changes_only_on(p_device, p_bridge)
     and exists (select 1 from tally_devices d where d.id = p_device and d.info -> 'bridges' ? p_bridge
                   and (case when nullif(d.main_bridge, '') is not null then d.main_bridge = p_bridge
                             else coalesce(d.info -> 'bridges' -> p_bridge ->> 'mode', 'main') <> 'test' end))
$function$;
revoke all on function public.tally_bridge_takes_unnamed(uuid, text) from public, anon, authenticated;

-- review M4: a computer may be given a posting naming no bridge: its main bridge may take it (none heard from yet: as
-- before, it may) (internal: granted to nobody)
create or replace function public.tally_device_may_post(p_device uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select case when not exists (select 1 from tally_devices d, jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k where d.id = p_device)
              then exists (select 1 from tally_devices d where d.id = p_device and not coalesce(d.revoked, false))
              else exists (select 1 from tally_devices d, jsonb_object_keys(d.info -> 'bridges') k
                            where d.id = p_device and not coalesce(d.revoked, false) and jsonb_typeof(d.info -> 'bridges') = 'object' and tally_bridge_takes_unnamed(d.id, k)) end
$function$;
revoke all on function public.tally_device_may_post(uuid) from public, anon, authenticated;

-- review M4: the computer a new posting naming no bridge goes to: the newest of the firm's computers that may post and has
-- the company open (any bridge's open list there), the company's own computer first (tally_companies.device_id) only when
-- it has the company open too (9a); null when none. tally_post_enqueue_to no longer leaves the choice to it (the poster's
-- own bridge, 9a); kept for tally_post_enqueue_core called with no computer (internal: granted to nobody)
create or replace function public.tally_post_device_for(p_firm uuid, p_company text, p_pref uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $function$
  select d.id from tally_devices d
   where d.firm_id = p_firm and not coalesce(d.revoked, false) and tally_device_may_post(d.id)
     and exists (select 1 from jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) b
                  where jsonb_typeof(b.value -> 'open') = 'array'
                    and exists (select 1 from jsonb_array_elements_text(b.value -> 'open') o where lower(tally_nm(o)) = lower(tally_nm(p_company))))
   order by (d.id = p_pref) desc, d.last_seen desc nulls last, d.id limit 1
$function$;
revoke all on function public.tally_post_device_for(uuid, text, uuid) from public, anon, authenticated;

-- Fix 3: why nobody can post into a company just now, naming the company and what to do (internal: granted to nobody)
create or replace function public.tally_post_nobody_words(p_firm uuid, p_company text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  with b as (select d.id as dev, k.key as bridge, tally_bridge_words(d.id, k.key) as w, tally_bridge_may_post(d.id, k.key) as may,
                    tally_bridge_changes_only_on(d.id, k.key) as co,
                    (jsonb_typeof(k.value -> 'open') = 'array' and exists (select 1 from jsonb_array_elements_text(k.value -> 'open') o where lower(tally_nm(o)) = lower(tally_nm(p_company)))) as has
               from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
              where d.firm_id = p_firm and not coalesce(d.revoked, false)),
       mayl as (select coalesce(string_agg(distinct w, ', '), '') as l from b where may),
       col as (select coalesce(string_agg(distinct w, ', '), '') as l, count(distinct w) as n from b where has and co)
  select 'Nobody can post into ' || p_company || ' just now: '
      || case when col.n = 1 then 'the only computer that has it open (' || col.l || ') is set to Changes only. '
              when col.n > 1 then 'the only computers that have it open (' || col.l || ') are set to Changes only. '
              else 'no computer has it open in Tally. ' end
      || 'Open the company in Tally on ' || case when mayl.l <> '' then 'a computer that may post (' || mayl.l || ')' else 'a computer whose FinCom Bridge may post' end
      || case when col.n > 0 then ', or ask the owner to switch Changes only off for that bridge.' else ', then post again.' end
    from mayl, col
$function$;
revoke all on function public.tally_post_nobody_words(uuid, text) from public, anon, authenticated;

-- review M-B, 9d: the bridge of a computer key that may post FOR ONE WINDOWS USER (p_user, as tally_bridge_user gives it):
-- that user's main bridge there; none chosen: the newest heard from not in test mode, never a changes-only one; null when
-- none. Never another Windows user's bridge (internal: granted to nobody)
create or replace function public.tally_bridge_poster(p_device uuid, p_user text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select k.key from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
   where d.id = p_device and not coalesce(d.revoked, false) and p_user is not null
     and lower(btrim(coalesce(k.value ->> 'user', ''))) = p_user and tally_bridge_may_post(d.id, k.key)
   order by (k.key = d.main_bridge) desc nulls last, k.value ->> 'at' desc nulls last, k.key limit 1
$function$;
revoke all on function public.tally_bridge_poster(uuid, text) from public, anon, authenticated;

-- review M-B: why a posting cannot be posted where it waits, and what to do, in plain words (internal: granted to nobody)
create or replace function public.tally_post_stranded_words(p_device uuid, p_bridge text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  select x.id, x.name, x.main_bridge, x.info into d from tally_devices x where x.id = p_device;
  if p_bridge is null then
    return 'the computer it was for (' || coalesce(nullif(d.name, ''), 'a computer removed from FinCom') || ') has no FinCom Bridge that may post just now (each is set to Changes only or only reads Tally). '
        || 'Ask the firm''s owner to make one of its bridges the main one or switch Changes only off for it (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post.';
  end if;
  return 'the FinCom Bridge it was for (' || coalesce(nullif(tally_bridge_words(p_device, p_bridge), ''), p_bridge) || ') '
      || case when tally_bridge_changes_only_on(p_device, p_bridge) then 'is set to Changes only'
              when d.id is null or not coalesce(d.info -> 'bridges' ? p_bridge, false) then 'has not been heard from on its computer for a long time'
              when nullif(d.main_bridge, '') is not null and d.main_bridge <> p_bridge then 'only reads Tally now: another bridge of the same Windows user is the main one on its computer'
              else 'is in test mode' end
      || ', and no other bridge of the same Windows user on that computer may post. '
      || case when tally_bridge_changes_only_on(p_device, p_bridge) then 'Ask the firm''s owner to switch Changes only off for that bridge (Tally page), then Retry'
              when d.id is null or not coalesce(d.info -> 'bridges' ? p_bridge, false) then 'Start that FinCom Bridge on its computer, then Retry'
              when nullif(d.main_bridge, '') is not null and d.main_bridge <> p_bridge then 'Make that bridge the main one again (Tally page), then Retry'
              else 'Switch that bridge out of test mode, then Retry' end
      || '; or post these entries again so FinCom chooses a bridge that may post.';
end $function$;
revoke all on function public.tally_post_stranded_words(uuid, text) from public, anon, authenticated;

-- review M-B: one posting that cannot be posted where it waits: moved to the same computer key's bridge of the SAME
-- Windows user that may post (9d) ({state: moved}), else ({state: stranded, words}) failed in plain words when p_fail;
-- {state: ok} when it can be posted. Never to another computer key (review M2), never to another Windows user's bridge,
-- and a posting naming no bridge is never given one. Internal: granted to nobody
create or replace function public.tally_post_reroute(p_id uuid, p_fail boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare j record; nb text; w text;
begin
  select x.id, x.device_id, x.target_bridge, x.company into j from tally_post_jobs x where x.id = p_id;
  if not found then return jsonb_build_object('state', 'none'); end if;
  if (j.target_bridge is not null and tally_bridge_may_post(j.device_id, j.target_bridge))
     or (j.target_bridge is null and tally_device_may_post(j.device_id)) then return jsonb_build_object('state', 'ok'); end if;
  nb := case when j.target_bridge is not null then tally_bridge_poster(j.device_id, tally_bridge_user(j.device_id, j.target_bridge)) end;
  if nb is not null then
    -- a bridge 1.15.0 ("v1") has no id of its own: the posting then names none (the computer's main bridge)
    update tally_post_jobs set target_bridge = case when nb ~ '^go-[0-9a-f]{6,32}$' then nb end, updated_at = now(),
           message = left('Moved to ' || coalesce(nullif(tally_bridge_words(j.device_id, nb), ''), nb) || ' (the same Windows user, the same computer): the bridge it was for can no longer post', 300)
     where id = p_id;
    return jsonb_build_object('state', 'moved', 'bridge', nb);
  end if;
  w := tally_post_stranded_words(j.device_id, j.target_bridge);
  if coalesce(p_fail, false) then
    update tally_post_jobs set status = 'failed', taken_at = null, updated_at = now(), message = 'Not posted into ' || j.company || ': ' || w
     where id = p_id and status = 'waiting';
  end if;
  return jsonb_build_object('state', 'stranded', 'words', w);
end $function$;
revoke all on function public.tally_post_reroute(uuid, boolean) from public, anon, authenticated;

-- review M-B: every waiting posting of a computer that cannot be posted where it waits: moved or failed (above). The
-- service role only (tally-ingest, when it refuses a bridge postings); the owner's switch and the trigger below call it
create or replace function public.tally_post_rescue(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; x jsonb; moved int := 0; failed int := 0;
begin
  for r in select j.id from tally_post_jobs j where j.device_id = p_device and j.status = 'waiting' order by j.created_at for update skip locked loop
    x := tally_post_reroute(r.id, true);
    if x ->> 'state' = 'moved' then moved := moved + 1; elsif x ->> 'state' = 'stranded' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'moved', moved, 'failed', failed);
end $function$;
revoke all on function public.tally_post_rescue(uuid) from public, anon, authenticated;

-- review M-B: a computer's main bridge changed (its menu "Switch to main bridge", or the Tally page): its waiting
-- postings for a bridge that may no longer post are moved or failed at once
create or replace function public.tally_post_rescue_on_main()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  perform tally_post_rescue(new.id);
  return null;
end $function$;
revoke all on function public.tally_post_rescue_on_main() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_devices_main_rescue' and tgrelid = 'public.tally_devices'::regclass) then
    create trigger tally_devices_main_rescue after update of main_bridge on public.tally_devices for each row
      when (old.main_bridge is distinct from new.main_bridge) execute function public.tally_post_rescue_on_main();
  end if;
end $$;

-- an owner's "Changes only" for a bridge; switched on, the bridge's waiting postings are moved or failed (review M-B)
create or replace function public.tally_bridge_changes_only(p_device uuid, p_bridge text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40); x jsonb := '{}'::jsonb;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can switch a bridge to changes only' using errcode = '42501'; end if;
  if not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false) and d.info -> 'bridges' ? b)
    then raise exception 'not a bridge FinCom has heard from on this computer'; end if;
  insert into tally_bridge_prefs (device_id, bridge_id, firm_id, changes_only, set_by, set_at) values (p_device, b, f, coalesce(p_on, false), auth.uid(), now())
    on conflict (device_id, bridge_id) do update set changes_only = excluded.changes_only, set_by = excluded.set_by, set_at = excluded.set_at;
  if coalesce(p_on, false) then x := tally_post_rescue(p_device); end if;
  return jsonb_build_object('ok', true, 'device', p_device, 'bridge', b, 'changesOnly', coalesce(p_on, false), 'moved', coalesce((x ->> 'moved')::int, 0), 'failed', coalesce((x ->> 'failed')::int, 0));
end $function$;
revoke all on function public.tally_bridge_changes_only(uuid, text, boolean) from public, anon;
grant execute on function public.tally_bridge_changes_only(uuid, text, boolean) to authenticated;

-- the bridge a member posts through: an owner links anyone; (9c) any member who may write links HIMSELF (p_user = the
-- caller), to a bridge FinCom has heard from that does not post for another member already (TCloud.auto does it after
-- pairing, for this browser's own proven bridge). Who and when are kept (set_by, set_at)
create or replace function public.tally_member_bridge_link(p_user uuid, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := nullif(left(btrim(coalesce(p_bridge, '')), 40), '');
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    if p_user is distinct from auth.uid() or not can_write()
      then raise exception 'only an owner of the firm can link another member to a bridge; you can link yourself to your own' using errcode = '42501'; end if;
    if b is not null and exists (select 1 from tally_member_bridges mb where mb.firm_id = f and mb.device_id = p_device and mb.bridge_id = b and mb.user_id <> auth.uid())
      then raise exception 'that bridge posts for another member already; ask the firm''s owner' using errcode = '42501'; end if;
  end if;
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
-- 36b's tally_post_enqueue, every check kept; a NEW posting goes to p_device for p_target (both given or both null), or
-- with none to tally_post_device_for (review M4); queueing again or a Retry never moves a posting to another computer key
-- (review M2): one whose bridge can no longer post is moved to that same computer's bridge that may post, or (Retry)
-- refused in plain words (review M-B). Internal:
-- granted to nobody (tally_post_enqueue_to and the 3-argument tally_post_enqueue call it)
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
begin
  if f is null then raise exception 'not allowed'; end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null order by t.last_seen desc nulls last limit 1;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to
  select nullif(btrim(cl.data->>'postTo'), ''), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', 'Choose the Tally company ' || coalesce(cname, 'this client') || ' may post to (Client setup → Tally). Its books in FinCom''s cloud come from ' || c.company || '.'); end if;
  if lower(tally_nm(allowed)) <> lower(tally_nm(c.company)) then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', coalesce(cname, 'This client') || ' may post only to ' || allowed || ', but its books in FinCom''s cloud come from ' || c.company || '. Nothing was posted.'); end if;
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id (and on the
  -- same computer as before: never moved to another computer key, review M2; its bridge no longer able to post: that
  -- computer's bridge that may post, else refused in plain words, review M-B)
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      select coalesce(i.entry_id, i.fincom_id) into dup from tally_post_ids i
       where i.job_id = p_id and exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live) limit 1;
      if dup is not null then return jsonb_build_object('ok', false, 'error', 'Not queued again: the entry ' || dup || ' is being posted in another posting; wait for that one to finish (or cancel it).'); end if;
      rr := tally_post_reroute(p_id, false);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not queued again for ' || j.company || ': ' || (rr ->> 'words')); end if;
      update tally_post_jobs set status = 'waiting', message = 'Retry: waiting for the Tally computer', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1 where id = p_id;
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
    end if;
    -- still waiting for a bridge that can no longer post: moved, or failed in plain words (review M-B)
    if j.status = 'waiting' then
      rr := tally_post_reroute(p_id, true);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not posted into ' || j.company || ': ' || (rr ->> 'words')); end if;
    end if;
    return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'again', true);
  end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  select v->>'id' into dup from tally_post_jobs j2, jsonb_array_elements(j2.payload->'vouchers') v
   where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')
     and v->>'id' in (select x->>'id' from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x) limit 1;
  if dup is not null then return jsonb_build_object('ok', false, 'error', 'Some of these entries are already waiting to be posted; wait for that posting to finish.'); end if;
  -- review M4: the computer: the target's; else the newest that may post and has the company open
  dev := coalesce(p_device, tally_post_device_for(f, c.company, c.device_id));
  if dev is null then return jsonb_build_object('ok', false, 'company', c.company, 'error', tally_post_nobody_words(f, c.company)); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $function$;
revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

-- whether a bridge's open list holds a company (internal: granted to nobody)
create or replace function public.tally_bridge_has_open(p_device uuid, p_bridge text, p_company text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'open') = 'array'
                          and exists (select 1 from jsonb_array_elements_text(d.info -> 'bridges' -> p_bridge -> 'open') o where lower(tally_nm(o)) = lower(tally_nm(p_company)))
                     from tally_devices d where d.id = p_device), false)
$function$;
revoke all on function public.tally_bridge_has_open(uuid, text, text) from public, anon, authenticated;

-- 9a: whether a bridge is a member's own: the one they are linked to, or one on a computer key they made
-- (tally_devices.created_by) on which every bridge is of the same Windows user (a key shared by several Windows users
-- tells FinCom nothing of whose Tally is whose: there only a link counts; an id not bound to that key, a copied one, does
-- not count) (internal: granted to nobody)
create or replace function public.tally_bridge_is_own(p_firm uuid, p_user uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select p_user is not null and p_device is not null and (
         exists (select 1 from tally_member_bridges mb where mb.firm_id = p_firm and mb.user_id = p_user and mb.device_id = p_device and mb.bridge_id = p_bridge)
      or exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm and not coalesce(d.revoked, false) and d.created_by = p_user
                    and jsonb_typeof(d.info -> 'bridges') = 'object' and d.info -> 'bridges' ? p_bridge
                    and not exists (select 1 from jsonb_each(d.info -> 'bridges') o where lower(btrim(coalesce(o.value ->> 'user', ''))) <> tally_bridge_user(d.id, p_bridge)
                                       and (o.key !~ '^go-[0-9a-f]{6,32}$' or tally_bridge_device(p_firm, o.key) = d.id))))
$function$;
revoke all on function public.tally_bridge_is_own(uuid, uuid, uuid, text) from public, anon, authenticated;

-- 9a: the poster's own bridge for a company with no link to go by: of the member's own bridges (above, on keys they made)
-- that may post and have the company open, bound to that key (a "go-" id), the newest heard from; {device, bridge}
-- (bridge null: a bridge 1.15.0 with no id, the key's only user), or null (internal: granted to nobody)
create or replace function public.tally_post_own_bridge(p_firm uuid, p_company text, p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select jsonb_build_object('device', d.id, 'bridge', case when k.key ~ '^go-[0-9a-f]{6,32}$' then k.key end)
    from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
   where d.firm_id = p_firm and not coalesce(d.revoked, false) and d.created_by = p_user and p_user is not null
     and tally_bridge_is_own(p_firm, p_user, d.id, k.key) and tally_bridge_may_post(d.id, k.key) and tally_bridge_has_open(d.id, k.key, p_company)
     and (case when k.key ~ '^go-[0-9a-f]{6,32}$' then tally_bridge_device(p_firm, k.key) = d.id else tally_bridge_takes_unnamed(d.id, k.key) end)
   order by k.value ->> 'at' desc nulls last, d.last_seen desc nulls last, k.key limit 1
$function$;
revoke all on function public.tally_post_own_bridge(uuid, text, uuid) from public, anon, authenticated;

-- 9a: why the poster has no own bridge to post into a company through, naming the company and what to do (internal:
-- granted to nobody)
create or replace function public.tally_post_own_words(p_firm uuid, p_company text, p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  with own as (select tally_bridge_words(d.id, k.key) as w, tally_bridge_may_post(d.id, k.key) as may, tally_bridge_has_open(d.id, k.key, p_company) as has
                 from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
                where d.firm_id = p_firm and not coalesce(d.revoked, false) and tally_bridge_is_own(p_firm, p_user, d.id, k.key))
  select 'Nobody can post into ' || p_company || ' from your sign-in just now: '
      || case when not exists (select 1 from own)
                then 'FinCom has not heard from a FinCom Bridge of yours. Install FinCom Bridge on the computer where you use Tally, as your own Windows user ("Just for me"), and connect it to FinCom; then open '
                     || p_company || ' in Tally there and post again.'
              when exists (select 1 from own where has)
                then 'your FinCom Bridge (' || (select string_agg(distinct w, ', ') from own where has) || ') has it open but is set to Changes only or only reads Tally. '
                     || 'Ask the firm''s owner to switch Changes only off for it (Tally page), then post again.'
              else 'your FinCom Bridge (' || coalesce((select string_agg(distinct w, ', ') from own where may), (select string_agg(distinct w, ', ') from own)) || ') does not have '
                     || p_company || ' open in Tally. Open ' || p_company || ' in Tally there, then post again.' end
$function$;
revoke all on function public.tally_post_own_words(uuid, text, uuid) from public, anon, authenticated;

-- a posting, with the bridge that posts it. A posting already queued (queued again, Retry): as it was, never moved (review
-- M2, M-B: the core). A new one: the bridge named (p_target, with its computer p_device), which must be the poster's own
-- unless an owner names it; none named: the poster's own bridge (9a), or refused in plain words. The bridge not heard from
-- for 3 minutes: queued all the same with a note (9b)
create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb; seen record; co text;
        allowed text; pick jsonb; lk boolean; mine boolean := true; note text;
begin
  if f is null then raise exception 'not allowed'; end if;
  -- the same posting again: the core decides, by 36b's rules, and never moves it to another computer key
  if exists (select 1 from tally_post_jobs j where j.id = p_id) then
    r := tally_post_enqueue_core(p_id, p_client, p_payload, null, null);
    return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
  end if;
  -- no Tally company for the client, or not the one it may post to: the core's own words (nothing queued)
  select t2.company into co from tally_companies t2 where t2.firm_id = f and t2.client_id = p_client and t2.device_id is not null order by t2.last_seen desc nulls last limit 1;
  select nullif(btrim(cl.data->>'postTo'), '') into allowed from clients cl where cl.firm_id = f and cl.id = p_client;
  if co is null or allowed is null or lower(tally_nm(allowed)) <> lower(tally_nm(co)) then
    return tally_post_enqueue_core(p_id, p_client, p_payload, null, null) || jsonb_build_object('target', null); end if;
  is_owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  select mb.device_id, mb.bridge_id into own from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.bridge_id is not null;
  if t is null then
    -- 9a: the poster's own bridge: the linked one (when it may post, is still bound to the linked computer, and has the
    -- company open or no other own bridge has it), else the newest of their own that may post with the company open
    lk := own.bridge_id is not null and own.device_id is not null and tally_bridge_device(f, own.bridge_id) is not distinct from own.device_id
          and tally_bridge_may_post(own.device_id, own.bridge_id);
    pick := tally_post_own_bridge(f, co, auth.uid());
    if lk and (pick is null or tally_bridge_has_open(own.device_id, own.bridge_id, co)) then
      t := own.bridge_id; tdev := own.device_id;
    elsif pick is not null then
      tdev := (pick ->> 'device')::uuid; t := pick ->> 'bridge';
    else
      return jsonb_build_object('ok', false, 'company', co, 'error', tally_post_own_words(f, co, auth.uid()));
    end if;
  else
    tdev := tally_bridge_device(f, t);
    mine := tally_bridge_is_own(f, auth.uid(), tdev, t);
    if not mine and not is_owner then
      return jsonb_build_object('ok', false, 'error', 'Only an owner of the firm can post through another bridge than your own.'); end if;
    if tdev is null then
      return jsonb_build_object('ok', false, 'error', 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'); end if;
    -- review M3: named with its computer, the one the bridge id is bound to
    if p_device is null or p_device <> tdev then
      return jsonb_build_object('ok', false, 'error', 'That bridge is not on the computer named; nothing was queued. Refresh the Tally page and choose it again.'); end if;
    if tally_bridge_changes_only_on(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'); end if;
    if not tally_bridge_may_post(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge only reads Tally: another bridge of the same Windows user is the main one on its computer. Nothing was queued.'); end if;
  end if;
  -- 9b: not heard from for more than 3 minutes: queued all the same; the bridge takes it when it is back
  if t is not null then
    select d.info -> 'bridges' -> t ->> 'at' as at, d.info -> 'bridges' -> t ->> 'user' as u into seen from tally_devices d where d.id = tdev;
    if coalesce(seen.at, '') !~ '^\d{4}-\d\d-\d\dT' or seen.at::timestamptz < now() - interval '3 minutes' then
      note := 'Queued: waits for ' || case when mine then 'your' else 'the' end || ' FinCom Bridge on ' || tally_bridge_words(tdev, t) || ' (not heard from since '
        || coalesce(to_char(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz end at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', 'it was set up')
        || '); it is posted as soon as that bridge is back. If it does not come back by itself, start it there (sign in to Windows' || coalesce(' as ' || nullif(seen.u, ''), '') || ').';
    end if;
  end if;
  r := tally_post_enqueue_core(p_id, p_client, p_payload, tdev, t);
  if note is not null and coalesce((r ->> 'ok')::boolean, false) then
    update tally_post_jobs set message = left(note, 300) where id = p_id and firm_id = f and status = 'waiting';
    r := r || jsonb_build_object('note', note);
  end if;
  return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
end $function$;
revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated;

-- an older FinCom page (the 3-argument call): the same rules, no target named
create or replace function public.tally_post_enqueue(p_id uuid, p_client text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  return tally_post_enqueue_to(p_id, p_client, p_payload, null, null);
end $function$;
revoke all on function public.tally_post_enqueue(uuid, text, jsonb) from public, anon;
grant execute on function public.tally_post_enqueue(uuid, text, jsonb) to authenticated;

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

-- ---------------------------------------------------------------- 9. no conditions on any bridge (the owner's rule, 05-Oct-2026)
-- 9e: a new computer key (one for each Windows user's bridge): migration.sql's tally_device_create, without its limit of 50
-- keys a firm. Its key is shown once; only its hash is kept; created_by is the member whose page made it
create or replace function public.tally_device_create(p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $function$
declare f uuid := my_firm(); k text; d uuid;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'give the computer a name'; end if;
  k := 'fcd_' || encode(gen_random_bytes(24), 'hex');
  insert into tally_devices (firm_id, name, key_hash, created_by) values (f, left(trim(p_name), 80), encode(digest(k, 'sha256'), 'hex'), auth.uid()) returning id into d;
  return jsonb_build_object('id', d, 'key', k);
end $function$;
revoke all on function public.tally_device_create(text) from public, anon;
grant execute on function public.tally_device_create(text) to authenticated;

-- 9d: a member's bridge on a computer key shared with another Windows user whose bridge is the main one there (1.15.0's
-- settings carried over) moves to a NEW key that member made for it (TCloud.auto): the member must be linked to that
-- bridge on the shared key (9c), the new key made by them within 15 minutes with nothing reported on it yet. The old
-- binding is kept with who, when and why (never removed); a new one binds the id to the new key; the bridge's waiting and
-- running postings and the members' links to it go with it (the same bridge, the same Windows user's Tally)
create or replace function public.tally_bridge_own_key(p_bridge text, p_to uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b text := left(btrim(coalesce(p_bridge, '')), 40); frm uuid; d record; tn text; nj int; nl int;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if b !~ '^go-[0-9a-f]{6,32}$' then raise exception 'not a bridge id'; end if;
  select x.name into tn from tally_devices x where x.id = p_to and x.firm_id = f and not coalesce(x.revoked, false) and x.created_by = auth.uid()
     and x.created_at > now() - interval '15 minutes'
     and not coalesce(jsonb_typeof(x.info -> 'bridges') = 'object' and x.info -> 'bridges' <> '{}'::jsonb, false);
  if not found then raise exception 'not a new computer key of yours' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_bridge_ids:' || f::text || ':' || b));
  select i.device_id into frm from tally_bridge_ids i where i.firm_id = f and i.bridge_id = b and i.reset_at is null;
  if frm is null then return jsonb_build_object('ok', true, 'moved', false, 'bridge', b); end if;   -- not bound yet: the new key binds it when the bridge reports
  if frm = p_to then return jsonb_build_object('ok', true, 'moved', false, 'bridge', b); end if;
  if not exists (select 1 from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.device_id = frm and mb.bridge_id = b)
    then raise exception 'you are not linked to that bridge; link yourself to it first' using errcode = '42501'; end if;
  select x.id, x.main_bridge into d from tally_devices x where x.id = frm;
  if nullif(d.main_bridge, '') is null or d.main_bridge = b or tally_bridge_user(frm, d.main_bridge) is null or tally_bridge_user(frm, b) is null
     or tally_bridge_user(frm, d.main_bridge) = tally_bridge_user(frm, b)
    then raise exception 'that bridge''s computer key is not shared with another Windows user''s main bridge; it keeps its key'; end if;
  update tally_bridge_ids set reset_at = now(), reset_by = auth.uid(), reset_why = left('moved to its own computer key (' || coalesce(tn, '') || ') by its member', 300)
   where firm_id = f and bridge_id = b and reset_at is null;
  insert into tally_bridge_ids (bridge_id, device_id, firm_id) values (b, p_to, f) on conflict do nothing;
  update tally_post_jobs set device_id = p_to, updated_at = now() where firm_id = f and device_id = frm and target_bridge = b and status in ('waiting', 'taken', 'running');
  get diagnostics nj = row_count;
  update tally_member_bridges set device_id = p_to where firm_id = f and device_id = frm and bridge_id = b;
  get diagnostics nl = row_count;
  update tally_bridge_alerts set cleared_at = now() where firm_id = f and bridge_id = b and cleared_at is null;
  raise log 'tally_bridge_own_key: bridge % moved from % to % by %', b, frm, p_to, auth.uid();
  return jsonb_build_object('ok', true, 'moved', true, 'bridge', b, 'from', frm, 'to', p_to, 'postings', nj, 'links', nl);
end $function$;
revoke all on function public.tally_bridge_own_key(text, uuid) from public, anon;
grant execute on function public.tally_bridge_own_key(text, uuid) to authenticated;

-- 9f: Update now (migration-4's tally_want_update): wakes the company's own computer as before, every computer key (not
-- removed) whose bridges have the client's company open, and the caller's own keys. Nothing when the client has no Tally
-- company yet
create or replace function public.tally_want_update(p_client text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); n int;
begin
  if f is null then raise exception 'not allowed'; end if;
  if not exists (select 1 from tally_companies c where c.firm_id = f and c.client_id = p_client) then return jsonb_build_object('ok', false, 'devices', 0); end if;
  update tally_devices d set want_update_at = now()
   where d.firm_id = f and not coalesce(d.revoked, false)
     and (d.id in (select c.device_id from tally_companies c where c.firm_id = f and c.client_id = p_client and c.device_id is not null)
          or d.created_by = auth.uid()
          or exists (select 1 from tally_companies c, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) b
                      where c.firm_id = f and c.client_id = p_client and tally_bridge_has_open(d.id, b.key, c.company)));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'devices', n);
end $function$;
revoke all on function public.tally_want_update(text) from public, anon;
grant execute on function public.tally_want_update(text) to authenticated;

-- 9g: Resume reading (migration-35's tally_read_resume): an owner as before; any member who may write resumes a bridge
-- that stopped reading by itself, on a computer key they made, one computer at a time. FinCom's own Stop (an owner's,
-- for that computer or for all) is resumed only by an owner. Cleared, never deleted; the 'resume' row tells the bridge
-- (readResume in its beat) to read again
create or replace function public.tally_read_resume(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); n int := 0; nid bigint;
begin
  if f is null then raise exception 'only a member of the firm can resume reading Tally' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    if not can_write() or p_device is null
       or not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false) and d.created_by = auth.uid())
      then raise exception 'only an owner of the firm, or the member whose computer key it is, can resume reading Tally there' using errcode = '42501'; end if;
    if exists (select 1 from tally_read_stops s where s.firm_id = f and s.action = 'stop' and s.cleared_at is null and (s.device_id is null or s.device_id = p_device))
      then raise exception 'reading was stopped from FinCom by an owner of the firm; only an owner can resume it' using errcode = '42501'; end if;
  end if;
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
revoke all on function public.tally_read_resume(uuid) from public, anon;
grant execute on function public.tally_read_resume(uuid) to authenticated;

-- ---------------------------------------------------------------- 10. new bridge versions go to every computer by themselves
-- (the owner's rule of 05-Oct-2026, item A): no pilot, no approval. tally-ingest's beat offers the newest version on
-- FinCom's signed list to every bridge, except a version the firm's owner HELD (below) or withdrew (migration 37); the
-- owner's "Roll back to <version>" offers that older version instead until cleared. tally_release_pilot / _approve stay
-- in the database (add-only) and are no longer offered by the app. Who, when and why are kept for each action
alter table public.tally_bridge_releases add column if not exists held_at timestamptz;
alter table public.tally_bridge_releases add column if not exists held_by uuid;
alter table public.tally_bridge_releases add column if not exists held_why text;
create table if not exists public.tally_bridge_rollbacks (
  id         bigserial primary key,
  firm_id    uuid not null references public.firms(id) on delete cascade,
  version    text not null check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  why        text not null default '',
  set_by     uuid,
  set_at     timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid
);
create unique index if not exists tally_bridge_rollbacks_live on public.tally_bridge_rollbacks (firm_id) where cleared_at is null;
create table if not exists public.tally_bridge_release_log (
  id      bigserial primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  version text not null default '',
  action  text not null check (action in ('hold', 'unhold', 'rollback', 'rollback_clear')),
  why     text not null default '',
  by_user uuid,
  at      timestamptz not null default now()
);
alter table public.tally_bridge_rollbacks enable row level security;
alter table public.tally_bridge_release_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_rollbacks' and policyname = 'tally_bridge_rollbacks_read') then
    create policy tally_bridge_rollbacks_read on public.tally_bridge_rollbacks for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_release_log' and policyname = 'tally_bridge_release_log_read') then
    create policy tally_bridge_release_log_read on public.tally_bridge_release_log for select to authenticated using (firm_id = my_firm());
  end if;
  -- kept, never removed (migration 35's guard)
  if not exists (select 1 from pg_trigger where tgname = 'tally_bridge_rollbacks_kept' and tgrelid = 'public.tally_bridge_rollbacks'::regclass) then
    create trigger tally_bridge_rollbacks_kept before delete on public.tally_bridge_rollbacks for each row execute function public.tally_control_kept();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_bridge_release_log_kept' and tgrelid = 'public.tally_bridge_release_log'::regclass) then
    create trigger tally_bridge_release_log_kept before delete on public.tally_bridge_release_log for each row execute function public.tally_control_kept();
  end if;
end $$;
revoke insert, update on public.tally_bridge_rollbacks, public.tally_bridge_release_log from anon, authenticated;
grant select on public.tally_bridge_rollbacks, public.tally_bridge_release_log to authenticated;

-- the caller's firm when they are one of its owners, else an error naming what only an owner does (internal)
create or replace function public.tally_owner_firm(p_what text)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm();
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can %', p_what using errcode = '42501'; end if;
  return f;
end $function$;
revoke all on function public.tally_owner_firm(text) from public, anon, authenticated;

-- an owner holds a version: no bridge of the firm takes it (a reason needed; who, when, why kept)
create or replace function public.tally_release_hold(p_version text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_owner_firm('hold a bridge version'); v text := btrim(coalesce(p_version, '')); why text := left(btrim(coalesce(p_why, '')), 500);
begin
  if v !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then raise exception 'not a bridge version (like 2.3.1)'; end if;
  if why = '' then raise exception 'give the reason the version is held'; end if;
  insert into tally_bridge_releases (firm_id, version, held_at, held_by, held_why) values (f, v, now(), auth.uid(), why)
    on conflict (firm_id, version) do update set held_at = now(), held_by = auth.uid(), held_why = why;
  insert into tally_bridge_release_log (firm_id, version, action, why, by_user) values (f, v, 'hold', why, auth.uid());
  return jsonb_build_object('ok', true, 'version', v, 'held', now());
end $function$;
revoke all on function public.tally_release_hold(text, text) from public, anon;
grant execute on function public.tally_release_hold(text, text) to authenticated;

-- an owner lets a held version go again (the hold kept in the log)
create or replace function public.tally_release_unhold(p_version text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_owner_firm('let a held bridge version go'); v text := btrim(coalesce(p_version, ''));
begin
  update tally_bridge_releases set held_at = null, held_by = null, held_why = null where firm_id = f and version = v and held_at is not null;
  if not found then return jsonb_build_object('ok', true, 'version', v, 'already', true); end if;
  insert into tally_bridge_release_log (firm_id, version, action, why, by_user) values (f, v, 'unhold', left(btrim(coalesce(p_why, '')), 500), auth.uid());
  return jsonb_build_object('ok', true, 'version', v);
end $function$;
revoke all on function public.tally_release_unhold(text, text) from public, anon;
grant execute on function public.tally_release_unhold(text, text) to authenticated;

-- an owner rolls every bridge of the firm back to a version: the beat offers it as a rollback until cleared (one standing
-- at a time; an earlier one is cleared, kept). The bridge's own tray "Roll back to the previous version" is apart
create or replace function public.tally_release_rollback(p_version text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_owner_firm('roll the bridges back'); v text := btrim(coalesce(p_version, '')); why text := left(btrim(coalesce(p_why, '')), 500); nid bigint;
begin
  if v !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then raise exception 'not a bridge version (like 2.2.4)'; end if;
  if why = '' then raise exception 'give the reason for the rollback'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_bridge_rollbacks:' || f::text));
  update tally_bridge_rollbacks set cleared_at = now(), cleared_by = auth.uid() where firm_id = f and cleared_at is null;
  insert into tally_bridge_rollbacks (firm_id, version, why, set_by) values (f, v, why, auth.uid()) returning id into nid;
  insert into tally_bridge_release_log (firm_id, version, action, why, by_user) values (f, v, 'rollback', why, auth.uid());
  return jsonb_build_object('ok', true, 'version', v, 'id', nid);
end $function$;
revoke all on function public.tally_release_rollback(text, text) from public, anon;
grant execute on function public.tally_release_rollback(text, text) to authenticated;

create or replace function public.tally_release_rollback_clear(p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_owner_firm('clear a rollback'); n int; v text;
begin
  perform pg_advisory_xact_lock(hashtext('tally_bridge_rollbacks:' || f::text));
  select version into v from tally_bridge_rollbacks where firm_id = f and cleared_at is null;
  update tally_bridge_rollbacks set cleared_at = now(), cleared_by = auth.uid() where firm_id = f and cleared_at is null;
  get diagnostics n = row_count;
  if n > 0 then insert into tally_bridge_release_log (firm_id, version, action, why, by_user) values (f, coalesce(v, ''), 'rollback_clear', left(btrim(coalesce(p_why, '')), 500), auth.uid()); end if;
  return jsonb_build_object('ok', true, 'cleared', n);
end $function$;
revoke all on function public.tally_release_rollback_clear(text) from public, anon;
grant execute on function public.tally_release_rollback_clear(text) to authenticated;

-- ---------------------------------------------------------------- 11. "Apply now" on a held line: any member who may write
-- (the owner's rule of 05-Oct-2026, item C): migration 53's tally_recorder_release_held, its text the same but for who may
-- call it (can_write(): an owner or staff; was owners only). The same checks run as for any line (tally_recorder_line);
-- who pressed it and when are kept on a line it applied (released_by, released_at); a line that fails a check stays held
-- with its reason (held_why)
create or replace function public.tally_recorder_release_held(p_line bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_recorder_lines%rowtype; one jsonb;
begin
  if f is null or not can_write()
    then raise exception 'only a member of the firm who may make changes can apply a held line' using errcode = '42501'; end if;
  select * into r from tally_recorder_lines where id = p_line and firm_id = f;
  if r.id is null then raise exception 'not a line of your firm'; end if;
  if r.state <> 'held' then raise exception 'line % is %, not held', p_line, r.state; end if;
  if r.event in ('ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted') then     -- every ledger line (review L4)
    return jsonb_build_object('ok', false, 'id', p_line, 'line_id', r.line_id, 'state', 'held', 'why', 'a ledger line is applied by the bridge''s next ledger list, not by a release');
  end if;
  perform pg_advisory_xact_lock(hashtext(r.book_id::text));
  perform set_config('fincom.recorder_release', p_line::text, true);
  one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
           'vch_date', r.vch_date, 'vch_no', r.vch_no, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), p_line);
  perform set_config('fincom.recorder_release', '', true);
  -- stamped released only when the release applied it; one that stays held (its month still locked) is not (review L3)
  if one->>'state' = 'applied' then
    update tally_recorder_lines set released_at = now(), released_by = auth.uid() where id = p_line;
    -- applied now: its AlterID counts for the gap check as any applied line's (review L2)
    if r.alter_id is not null and r.alter_id < 1000000000000000 and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported')
       and tally_recorder_ids_together(p_line) then     -- 53: only a line whose ids belong together
      insert into tally_sync_cursor (book_id, firm_id) values (r.book_id, f) on conflict (book_id) do nothing;
      update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = r.book_id;
    end if;
  end if;
  return jsonb_build_object('ok', true) || one;
end $function$;
revoke all on function public.tally_recorder_release_held(bigint) from public, anon;
grant execute on function public.tally_recorder_release_held(bigint) to authenticated;

commit;
