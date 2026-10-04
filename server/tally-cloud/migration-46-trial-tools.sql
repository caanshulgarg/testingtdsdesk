-- Migration 46 (04-Oct-2026, round 19: the trial tools for any company; the owner's decision). Runs AFTER 45 (fresh
-- database: ... -> 44 -> 45 -> 46; staging: after 45; docs/MIGRATION-ORDER.md). Add-only (three columns added if missing,
-- two functions created or replaced; nothing dropped or removed), safe to run twice. Shown to the owner before it runs.
--
--   The trial tools in FinCom Bridge's tray (read test, note change numbers, send results, 30 s lock, time saving) no longer
--   check the company's name. Guard (a), owner only: the bridge has no idea of the firm's owner, so the owner turns the tools
--   on per computer on FinCom's Tally page ("Trial tools on this computer", default off). While it is off the tray does not
--   show them. tally-ingest's beat answers trialTools: true / false from this column (a cloud without 46 answers false).
--
--   1. tally_devices.trial_tools boolean not null default false (every computer off), trial_tools_at timestamptz,
--      trial_tools_by uuid; the three readable by the firm (as 43's post_settings_* columns; RLS keeps it to the firm's
--      computers).
--   2. tally_device_trial_tools(p_device uuid, p_on boolean) returns jsonb: the caller must be an active owner of the device's
--      firm (the owner check of tally_device_post_settings, migration 43 / 44); a revoked computer, another firm's or an
--      unknown one is 'not a computer of your firm'; p_on null is refused with words. Stamps trial_tools_at / trial_tools_by
--      on every call; answers {ok, device, trialTools, at, by}. Security definer, search_path = public, pg_temp; revoked from
--      public and anon, granted to authenticated (the checks are inside).
--   3. Review 46 H1 (docs/reviews/migration-46-review.md, Fixed; the owner's decision, the safer reading): tally_start_point
--      replaced, 44's 7 arguments, SET and grants (the service role's alone). 44's rule "a new company GUID resets the
--      starting point (needs_baseline)" is REPLACED: a GUID other than the book's company GUID (the first one kept,
--      tally_sync_guard, 32) marks the book needs_baseline as today and NEVER moves the point (answers otherCompany: true,
--      set: false, bookGuid); a starting point recorded without a GUID (the gap check's) only gets the GUID stamped, the
--      numbers and any open gap kept; a point another GUID moved before 46 is kept and the book marked needs_baseline with
--      words. The only way to a new starting point (under a new GUID or the same) is the owner's tally_baseline_clear (37):
--      it sets state ok and cleared_at but not start_at / start_guid, so a cursor cleared after its start (cleared_at >
--      start_at) is recorded afresh by the next call, once (the GUID it brings becomes the book's company GUID; gap,
--      gap_at and last_match_at cleared with it). The first call after the clear wins, from whichever PC beats first.
--      tally-ingest's beat skips the gap check for an otherCompany answer.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the switch per computer
alter table public.tally_devices add column if not exists trial_tools boolean not null default false;
alter table public.tally_devices add column if not exists trial_tools_at timestamptz;
alter table public.tally_devices add column if not exists trial_tools_by uuid;
grant select (trial_tools, trial_tools_at, trial_tools_by) on public.tally_devices to authenticated;

-- ---------------------------------------------------------------- 2. the owner turns it on or off
create or replace function public.tally_device_trial_tools(p_device uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); d tally_devices%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can turn the trial tools on or off for a computer' using errcode = '42501'; end if;
  if p_device is null or not exists (select 1 from tally_devices x where x.id = p_device and x.firm_id = f and not coalesce(x.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if p_on is null then raise exception 'say whether the trial tools are on or off (true or false)'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_device_trial_tools:' || p_device::text));
  update tally_devices set trial_tools = p_on, trial_tools_at = now(), trial_tools_by = auth.uid()
   where id = p_device and firm_id = f;
  select * into d from tally_devices where id = p_device;
  return jsonb_build_object('ok', true, 'device', p_device, 'trialTools', d.trial_tools, 'at', d.trial_tools_at, 'by', d.trial_tools_by);
end $function$;
revoke all on function public.tally_device_trial_tools(uuid, boolean) from public, anon;
grant execute on function public.tally_device_trial_tools(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 3. another company's GUID never moves the starting point (review 46 H1)
create or replace function public.tally_start_point(p_firm uuid, p_book uuid, p_guid text, p_altvch bigint, p_altmst bigint, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); c tally_sync_cursor%rowtype; done boolean := false; other boolean; fresh boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- ALTVCHID 0 or less is unknown (an unread value), never a starting point; 10^15 or more is past Tally's range (44's review M2, L9)
  if p_altvch is null or p_altvch <= 0 or p_altvch >= 1000000000000000 or (p_altmst is not null and (p_altmst < 0 or p_altmst >= 1000000000000000)) then
    raise exception 'the starting point needs the highest voucher AlterID (more than 0, below 10^15)';
  end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  select * into c from tally_sync_cursor where book_id = p_book;
  -- the owner's baseline clear (tally_baseline_clear, 37) after the starting point: this call records afresh, and the GUID
  -- it brings is the book's company from now on (so tally_sync_guard does not flag it)
  fresh := c.start_at is not null and c.cleared_at is not null and c.cleared_at > c.start_at;
  if fresh and g is not null then
    update tally_sync_cursor set company_guid = g, updated_at = now() where book_id = p_book;
  end if;
  -- the GUID as today: another company GUID marks the book needs_baseline (tally_sync_guard, migration 32)
  perform tally_sync_guard(p_firm, p_book, g, null, null, p_device, p_bridge);
  select * into c from tally_sync_cursor where book_id = p_book;
  -- another company than the book's (a same-named company on another PC, a restored or re-created one): never moves the point
  other := g is not null and c.company_guid is not null and c.company_guid <> g;
  if other then
    null;
  elsif c.start_at is null or fresh then
    update tally_sync_cursor set last_voucher_alterid = p_altvch, last_master_alterid = p_altmst, start_guid = coalesce(g, case when fresh then c.company_guid else c.start_guid end),
           start_at = now(), start_device = p_device, gap = case when fresh then null else gap end, gap_at = case when fresh then null else gap_at end,
           last_match_at = case when fresh then null else last_match_at end, updated_at = now()
     where book_id = p_book;
    done := true;
  elsif g is not null and c.start_guid is null then
    -- a starting point the gap check recorded without a GUID: the GUID stamped, the numbers kept (an open gap is never forgiven)
    update tally_sync_cursor set start_guid = g, updated_at = now() where book_id = p_book;
  elsif g is not null and c.start_guid <> g then
    -- a point another GUID moved before 46: kept; the owner's baseline clear records it afresh
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), updated_at = now(),
           state_why = format('the starting point (%s) was recorded under another company GUID (%s); this book''s is %s: the owner''s baseline clear records it afresh', c.last_voucher_alterid, c.start_guid, g)
     where book_id = p_book;
  end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  return jsonb_build_object('ok', true, 'set', done, 'startVoucher', c.last_voucher_alterid, 'startMaster', c.last_master_alterid, 'guid', c.start_guid, 'at', c.start_at, 'state', c.state, 'why', c.state_why,
    'otherCompany', other, 'bookGuid', c.company_guid, 'afterClear', done and fresh);
end $function$;
revoke all on function public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text) to service_role;

commit;
