-- server/tally-cloud/rollback-142-post-any-bridge.sql: the rollback of migration 142 (06-Nov-2026, next-tally-post-any).
-- NOT a migration file: run only to undo 142 (tested: ROLLBACK_142=<this file> tests/run_migration142.py).
-- Puts back the definitions 142 replaced, byte for byte from their last migrations, and makes the page's check say no:
--   tally_post_take_for      <- migration-54-post-target-bridge.sql
--   tally_post_enqueue_to    <- security/migration-116-write-checks.sql
--   tally_post_any_bridge()  -> false (the page then keeps the poster's own bridge's rule; the function stays: add-only)
-- The other functions 142 added (tally_bridge_serves, tally_post_serving_bridge, tally_post_pickable_ok,
-- tally_post_pickable, tally_post_mine_ok, tally_post_count_for) stay; nothing calls them once tally-ingest is back on v74.
-- Nothing dropped or deleted. One transaction.
begin;
set local lock_timeout = '10s';
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language sql security definer set search_path = public, pg_temp as $function$
  update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
         taken_by = case when p_bridge ~ '^go-[0-9a-f]{6,32}$' then p_bridge else taken_by end   -- final review M1: the bridge that took it
   where id = (select j.id from tally_post_jobs j
                where j.device_id = p_device and j.status = 'waiting'
                  and (j.target_bridge = p_bridge or (j.target_bridge is null and coalesce(p_main, false)))
                  and not tally_bridge_changes_only_on(p_device, p_bridge)
                  and exists (select 1 from tally_devices d where d.id = p_device and d.info -> 'bridges' ? p_bridge)
                order by j.created_at limit 1 for update skip locked)
  returning *;
$function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb; seen record; co text;
        allowed text; pick jsonb; lk boolean; mine boolean := true; note text;
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  -- the same posting again: the core decides, by 36b's rules, and never moves it to another computer key
  if exists (select 1 from tally_post_jobs j where j.id = p_id) then
    r := tally_post_enqueue_core(p_id, p_client, p_payload, null, null);
    return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
  end if;
  -- no Tally company for the client, or not the one it may post to: the core's own words (nothing queued)
  select t2.company into co from tally_companies t2 where t2.firm_id = f and t2.client_id = p_client and t2.device_id is not null order by t2.last_seen desc nulls last limit 1;
  allowed := tally_link_post_to(f, p_client, co);
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
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;

create or replace function public.tally_post_any_bridge()
returns boolean language sql stable security invoker set search_path = public, pg_temp as $function$
  select false
$function$;
revoke all on function public.tally_post_any_bridge() from public, anon;
grant execute on function public.tally_post_any_bridge() to authenticated, service_role;

commit;
