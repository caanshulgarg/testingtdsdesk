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
--   6. tally_bridge_ids (review M3): a bridge id ("go-…", which the bridge reports itself) belongs to the first computer key
--      that reported it; tally_bridge_bind(p_device, p_bridge) (the service role: tally-ingest, on every call naming a bridge)
--      binds an id not bound yet and says whether it is this computer's; tally-ingest refuses an id bound to another computer.
--      The ids heard from before 54 on exactly one computer are bound to it here; an id seen on two is left unbound (the
--      first computer to report it afterwards gets it). Targets resolve through these bindings only.
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

-- ---------------------------------------------------------------- 6. a bridge id belongs to one computer (review M3)
create table if not exists public.tally_bridge_ids (
  bridge_id text primary key,
  device_id uuid not null references public.tally_devices(id) on delete cascade,
  firm_id   uuid not null references public.firms(id) on delete cascade,
  first_at  timestamptz not null default now()
);
alter table public.tally_bridge_ids enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_bridge_ids' and policyname = 'tally_bridge_ids_read') then
    create policy tally_bridge_ids_read on public.tally_bridge_ids for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke insert, update on public.tally_bridge_ids from anon, authenticated;
grant select on public.tally_bridge_ids to authenticated;
-- the ids heard from before 54 on exactly one computer (not removed): bound to it (an insert only; safe twice)
insert into public.tally_bridge_ids (bridge_id, device_id, firm_id)
select x.k, (array_agg(x.id))[1], (array_agg(x.firm_id))[1]
  from (select d.id, d.firm_id, k from public.tally_devices d,
               jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
         where not coalesce(d.revoked, false) and k ~ '^go-[0-9a-f]{6,32}$') x
 group by x.k having count(*) = 1
on conflict (bridge_id) do nothing;

-- tally-ingest, on every call naming a bridge: binds an id not bound yet to this computer; true when it is this computer's
create or replace function public.tally_bridge_bind(p_device uuid, p_bridge text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare b text := left(btrim(coalesce(p_bridge, '')), 40);
begin
  if b !~ '^go-[0-9a-f]{6,32}$' then return true; end if;   -- bridge 1.15.0 ("v1") has no id of its own
  insert into tally_bridge_ids (bridge_id, device_id, firm_id) select b, d.id, d.firm_id from tally_devices d where d.id = p_device
    on conflict (bridge_id) do nothing;
  return exists (select 1 from tally_bridge_ids i where i.bridge_id = b and i.device_id = p_device);
end $function$;
revoke all on function public.tally_bridge_bind(uuid, text) from public, anon, authenticated;

-- the firm's computer (not removed) a bridge id is bound to, and on which FinCom has heard from it: its id, or null
-- (internal: granted to nobody)
create or replace function public.tally_bridge_device(p_firm uuid, p_bridge text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $function$
  select d.id from tally_bridge_ids i join tally_devices d on d.id = i.device_id
   where i.bridge_id = p_bridge and d.firm_id = p_firm and not coalesce(d.revoked, false) and coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$'
     and d.info -> 'bridges' ? p_bridge
$function$;
revoke all on function public.tally_bridge_device(uuid, text) from public, anon, authenticated;

-- whether a bridge is switched to changes only (internal: granted to nobody)
create or replace function public.tally_bridge_changes_only_on(p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select p.changes_only from tally_bridge_prefs p where p.device_id = p_device and p.bridge_id = p_bridge), false)
$function$;
revoke all on function public.tally_bridge_changes_only_on(uuid, text) from public, anon, authenticated;

-- whether a bridge may be given postings: not changes only, and the main bridge of its computer (the one chosen,
-- tally_devices.main_bridge; none chosen: a bridge not in test mode), as tally-ingest's mayPost (internal: granted to nobody)
create or replace function public.tally_bridge_may_post(p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select not tally_bridge_changes_only_on(p_device, p_bridge)
     and exists (select 1 from tally_devices d where d.id = p_device and d.info -> 'bridges' ? p_bridge
                   and (case when nullif(d.main_bridge, '') is not null then d.main_bridge = p_bridge
                             else coalesce(d.info -> 'bridges' -> p_bridge ->> 'mode', 'main') <> 'test' end))
$function$;
revoke all on function public.tally_bridge_may_post(uuid, text) from public, anon, authenticated;

-- review M4: a computer may be given a posting naming no bridge: one of its bridges may post (none heard from yet: as
-- before, it may) (internal: granted to nobody)
create or replace function public.tally_device_may_post(p_device uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select case when not exists (select 1 from tally_devices d, jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k where d.id = p_device)
              then exists (select 1 from tally_devices d where d.id = p_device and not coalesce(d.revoked, false))
              else exists (select 1 from tally_devices d, jsonb_object_keys(d.info -> 'bridges') k
                            where d.id = p_device and not coalesce(d.revoked, false) and jsonb_typeof(d.info -> 'bridges') = 'object' and tally_bridge_may_post(d.id, k)) end
$function$;
revoke all on function public.tally_device_may_post(uuid) from public, anon, authenticated;

-- review M4: the computer a new posting naming no bridge goes to: the newest of the firm's computers that may post and has
-- the company open (any bridge's open list there), the company's own computer first (tally_companies.device_id, when it
-- may post); null when none (internal: granted to nobody)
create or replace function public.tally_post_device_for(p_firm uuid, p_company text, p_pref uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $function$
  select d.id from tally_devices d
   where d.firm_id = p_firm and not coalesce(d.revoked, false) and tally_device_may_post(d.id)
     and (d.id = p_pref
          or exists (select 1 from jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) b
                      where jsonb_typeof(b.value -> 'open') = 'array'
                        and exists (select 1 from jsonb_array_elements_text(b.value -> 'open') o where lower(tally_nm(o)) = lower(tally_nm(p_company)))))
   order by (d.id = p_pref) desc, d.last_seen desc nulls last, d.id limit 1
$function$;
revoke all on function public.tally_post_device_for(uuid, text, uuid) from public, anon, authenticated;

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
-- 36b's tally_post_enqueue, every check kept; a NEW posting goes to p_device for p_target (both given or both null), or
-- with none to tally_post_device_for (review M4); queueing again or a Retry never moves a posting (review M2). Internal:
-- granted to nobody (tally_post_enqueue_to and the 3-argument tally_post_enqueue call it)
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid;
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
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id (and for the
  -- same bridge and computer as before: never moved, review M2)
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      select coalesce(i.entry_id, i.fincom_id) into dup from tally_post_ids i
       where i.job_id = p_id and exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live) limit 1;
      if dup is not null then return jsonb_build_object('ok', false, 'error', 'Not queued again: the entry ' || dup || ' is being posted in another posting; wait for that one to finish (or cancel it).'); end if;
      update tally_post_jobs set status = 'waiting', message = 'Retry: waiting for the Tally computer', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1 where id = p_id;
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
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
  if dev is null then return jsonb_build_object('ok', false, 'company', c.company,
      'error', 'No computer that may post has ' || c.company || ' open; open it in Tally on a computer whose FinCom Bridge posts (not one set to changes only), then post again. Nothing was queued.'); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $function$;
revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb;
begin
  if f is null then raise exception 'not allowed'; end if;
  is_owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  select mb.device_id, mb.bridge_id into own from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.bridge_id is not null;
  if t is null then
    -- the poster's own linked bridge, when it may post and is still bound to the linked computer (else none: as today)
    if own.bridge_id is not null and tally_bridge_device(f, own.bridge_id) is not distinct from own.device_id and own.device_id is not null
       and tally_bridge_may_post(own.device_id, own.bridge_id) then t := own.bridge_id; tdev := own.device_id; end if;
  else
    if t is distinct from own.bridge_id and not is_owner then
      return jsonb_build_object('ok', false, 'error', 'Only an owner of the firm can post through another bridge than your own.'); end if;
    tdev := tally_bridge_device(f, t);
    if tdev is null then
      return jsonb_build_object('ok', false, 'error', 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'); end if;
    -- review M3: named with its computer, the one the bridge id is bound to
    if p_device is null or p_device <> tdev then
      return jsonb_build_object('ok', false, 'error', 'That bridge is not on the computer named; nothing was queued. Refresh the Tally page and choose it again.'); end if;
    if tally_bridge_changes_only_on(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'); end if;
    if not tally_bridge_may_post(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge only reads Tally: another bridge is the main one on its computer. Nothing was queued.'); end if;
  end if;
  r := tally_post_enqueue_core(p_id, p_client, p_payload, tdev, t);
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

commit;
