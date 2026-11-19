-- migration-200-post-settle-itself.sql (18-Nov-2026, branch next-fix-posttimeout). Written, NOT run yet: the owner runs it
-- after an independent review. Runs after 199 (it uses 199's fast tally_post_job_settle and indexes).
--
-- Why (staging, 17-Nov-2026): posting c66d0e82 (661 entries) is "Held: Tally accepted ... but nobody has confirmed it"
-- though all 661 entries are in Tally once each: its last reports were cancelled by the statement timeout (199), so the
-- posting kept the results of 451 entries; the cron held it for an owner (36b/174), and nothing settles a held posting
-- but a person. FinCom's own read-back of Tally (the recorder, 44/45/182) has matched every one of the 661 by its FinCom
-- id (tally_post_ids.matched_at), and the posting register says in_tally for all of them; the posting itself never learns.
--
-- The owner's rule (18-Nov-2026): a posting never stays "Held", on either side; every posting settles by itself; no human
-- confirm when the evidence is clear; never a double post; a person only for truly contradictory evidence, named.
--
-- What 200 does: tally_post_settle_itself(job) settles a posting held for checking (done, checking) entry by entry, by
-- evidence only (no guess, no AI):
--   IN   (posted): FinCom's read-back of Tally holds the entry by its FinCom id (matched_at: the recorder read the voucher
--        from Tally, with its GUID): stamped in Tally in the posting (verified, by "FinCom (by itself)"; the register says
--        in_tally from the recorder), its waiting check closed. A check the bridge answered
--        "found" already marks it (55, unchanged).
--   OUT  (released for re-post): BOTH (1) the posting's own bridge looked in Tally after the posting and has no such voucher
--        (its latest check 'notseen', from the bridge 55's tally_post_check_bridge_ok accepts, no Mark posted since it was
--        asked) AND (2) FinCom has read every change Tally made up to after the posting (the book's gap check matched
--        Tally's change number at or above the posting window's a1 after the window was saved: 45/150/182; a posted entry
--        is credited there only when read back, so one Tally made would have been matched) and the entry was not matched.
--        Then released (as tally_post_check_confirm does, in the name "FinCom (by itself)"); once nothing else of the
--        posting waits, tally_post_settle_resend (its own statement) hands those entries alone back to that bridge
--        (resend_only, the posting waiting again); the bridge gets them in `released` and sends each once. Until then the
--        posting stays held, so a failed hand-back is retried by the cron.
--   CONFLICT (a person, named): (a) read back in Tally, but a later look by the bridge did not see it (deleted or redated
--        in Tally since?); (b) proven absent by (1) and (2), yet anything of Tally's says it took the entry (the review of
--        18-Nov-2026: both proofs look for the narration TDSDesk:<entry> in the posting's company, so a voucher created in
--        another company or with its narration edited is not found by them): stamped accepted (accepted_at), a reply of
--        its own or of its request that created or altered vouchers (reply_vch, batch_end, a result Tally accepted, a
--        result of the same request with created > 0), or created in another company (wrongCompany). Never released by
--        itself: flagged on the entry itself (its result and item: needs review, conflict, why; the register holds it as
--        needs_review, so no other posting queues it), named in the posting's words and tally_post_self_settle.conflicts.
--        A conflict does not hold the posting: the rest settles (re-checked by itself until proven), and the posting is
--        done with those entries "need review". Entries proven not in Tally beside an accepted one a person must settle
--        wait, released (36b's guard keeps such a posting from the bridge), and are handed back by the cron once that is
--        settled (tally_post_settle_resend_due).
--   WAIT (re-checked by itself): anything else. A check is asked by itself (tally_post_checks, auto, asked by "FinCom (by
--        itself)") when none waits and none was answered or given up in the last 15 minutes: the bridge looks in Tally
--        through 55's own path (the beat counts waiting checks; posts_take hands them; at most 5 a turn, postings first).
--        A check given up (10 unable tries or 24 h, 55) is simply asked again later: never "given up" for good, never held.
--        The posting says "being checked in Tally by itself", never "nobody has confirmed it".
--   tally_post_settle_itself_all(max): every held posting (oldest tried first), at most 25 a run and 20 s, each followed by
--        its hand-back or the posting register's pass (199's apply) in its own step; pg_cron every minute
--        ('tally-post-settle-itself'). tally-ingest also calls tally_post_settle_itself (then the hand-back or the register)
--        after a report that leaves a posting held and after every check report, so settling follows the evidence at once.
-- Set-based throughout (lookups by key, never joined row by row): a held posting of 20,000 entries settles in one pass of
-- about 2 s; the hand-back's change of status about 5 s (the triggers of 36b/40/111); each under the 8 s statement timeout.
--
-- Never twice (the review of 19-Nov-2026): between an entry's release by itself and its hand-back (a moment, or days while
-- an entry beside it waits for a person) the entry may be posted again in another posting; tally_post_settle_resend never
-- hands back one another posting has since (its FinCom id there, or its register record moved there): its check closed,
-- that posting named. 201's queue keeps such an entry to its posting until then. tally_post_settle_resend_due hands each
-- back on its own (one that fails is kept with its record and tried last; the others go on).
-- The third review of 19-Nov-2026 (NO-SHIP, fixed before any run): an entry a member released by "I looked in Tally: not
-- there" while its posting was held (55/174) waited for the hand-back unreserved, so it could be posted in another posting
-- and then handed back too. One rule for every path now: tally_post_resend_owed (what a posting owes, whoever released it),
-- tally_post_resend_elsewhere (the entries another posting has since), tally_post_resend_list (the whole list a hand-back
-- sends, those elsewhere closed; never a list kept from an earlier hand-back), tally_post_resend_ok (tally-ingest's
-- post_ok: a held posting's list not handed back yet, or one with an entry posted elsewhere, is not sent). 174's
-- tally_post_check_confirm hands back through the same list; the cron hands back a settled posting that still owes
-- entries (a Mark posted settled it); a posting whose posting into Tally was stopped is never handed back, even once 174
-- clears its stop (its entries' checks closed: free for a person). 199, 200, 201 (and 202) are one release, applied
-- together in one session: 200 refuses to run without 199.
-- Add-only: one new table (tally_post_self_settle: row security on, the firm reads, service_role writes), one column added
-- to tally_post_checks (auto, default false), two partial indexes (held postings; checks released by itself not handed
-- back yet) and one of tally_post_ids (firm, FinCom id, created: the hand-back's lookup), five new functions,
-- one pg_cron job where pg_cron is (only while 201 has not run: run again after 201, 201's command is kept); 55's tally_member_name replaced from its text with one case added (the made-up asker
-- of a check asked by itself is named "FinCom (by itself)"). Nothing dropped, deleted or truncated. One transaction,
-- lock_timeout 10 s, safe twice; service_role only, granted explicitly. No bridge change, no new Tally request: the checks
-- are 55's (the owner-approved one-voucher reads). Tested by tests/run_migration200.py.
begin;
set local lock_timeout = '10s';

-- 199, 200 and 201 are one release, applied together in one session in that order (docs/MIGRATION-ORDER.md: alone, 199 or
-- 199 + 200 leave a posting of 20,000 entries at 4-6 s a status change). 200 never runs without 199
do $$ begin
  if to_regprocedure('public.tally_post_id_accept_many(uuid,jsonb)') is null then
    raise exception 'migration 200 runs after 199 (199, 200 and 201 are applied together, in that order, in one session)';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. the record of each held posting's settling
create table if not exists public.tally_post_self_settle (
  job_id      uuid primary key references public.tally_post_jobs(id) on delete cascade,
  firm_id     uuid not null,
  tries       integer not null default 0,
  tried_at    timestamptz,
  settled_at  timestamptz,
  found       integer not null default 0,           -- marked posted by itself (all runs)
  released    integer not null default 0,           -- proven not in Tally, released and sent again (all runs)
  waiting     integer not null default 0,           -- still being checked (the last run)
  asked       integer not null default 0,           -- checks asked by itself (all runs)
  conflicts   jsonb not null default '[]'::jsonb,   -- [{entry, why}]: a person must look (the last run)
  words       text
);
alter table public.tally_post_self_settle enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_self_settle' and policyname = 'tally_post_self_settle_read') then
    create policy tally_post_self_settle_read on public.tally_post_self_settle for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke all on public.tally_post_self_settle from anon;
revoke insert, update, delete, truncate, references, trigger on public.tally_post_self_settle from authenticated;
grant select on public.tally_post_self_settle to authenticated;
grant all on public.tally_post_self_settle to service_role;

-- a check asked by itself (55's checks: asked_by is then the made-up member below)
alter table public.tally_post_checks add column if not exists auto boolean not null default false;
-- the held postings, found at once by the cron
create index if not exists tally_post_jobs_held on public.tally_post_jobs (updated_at) where status = 'done' and checking;
-- the entries released by itself and not handed back yet, found at once by the cron (tally_post_settle_resend_due)
create index if not exists tally_post_checks_resend_due on public.tally_post_checks (job_id) where state = 'confirmed' and resent is not true;
-- an entry's ids in every posting of the firm, live or not (tally_post_settle_resend: never handed back once another posting
-- has it; the live ones alone had an index)
create index if not exists tally_post_ids_firm_fid on public.tally_post_ids (firm_id, fincom_id, created_at);

-- 55's tally_member_name: the same, and the made-up member who asks a check by itself named as FinCom
create or replace function public.tally_member_name(p_firm uuid, p_user uuid) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select case when p_user = '00000000-0000-0000-0000-000000000200'::uuid then 'FinCom (by itself)' else
         coalesce((select nullif(btrim(m.name), '') from members m where m.firm_id = p_firm and m.user_id = p_user limit 1), 'a member of the firm') end
$function$;
revoke all on function public.tally_member_name(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tally_member_name(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- never twice: one rule for every way an entry is sent again
-- (the third review of 19-Nov-2026) An entry released for re-sending waits for its posting's hand-back: a moment, or days
-- (its posting held while an entry beside it is checked, or waits for a person). It was released by itself (200) or by a
-- member's "I looked in Tally: not there" (55/174's tally_post_check_confirm: named in the posting's resend_only while
-- the posting stays held). Meanwhile its id is not live, so another posting could take it to Tally, and the hand-back then
-- sent it a second time. Every path now asks these three:
-- tally_post_resend_owed(firm, job): the entries a posting still owes to send again, one row an entry: its id there released
-- and not live; its latest confirmed check not handed back (resent not true) and confirmed after the posting was last taken;
-- confirmed by itself, or by a member who named it in resend_only (one answered by another bridge is released only and
-- named nowhere: free to post anew); never of a cancelled posting (free). p_job null: every posting of the firm (the
-- queue's reserve, 201). By 200's partial index of such checks
create or replace function public.tally_post_resend_owed(p_firm uuid, p_job uuid)
returns table (job_id uuid, entry_id text, fincom_id text, check_id bigint, checked_bridge text, checked_device uuid)
language sql stable security definer set search_path = public, pg_temp as $function$
  select distinct on (k.job_id, k.entry_id) k.job_id, k.entry_id, i.fincom_id, k.id, k.checked_bridge, k.checked_device
    from tally_post_checks k
    join tally_post_jobs j on j.id = k.job_id
    -- (its id by key: by the entry id, else the FinCom id of an entry with none; an OR here read the posting's ids for each)
    cross join lateral (select i1.fincom_id, i1.released_at, i1.live from tally_post_ids i1 where i1.job_id = k.job_id and i1.entry_id = k.entry_id
                        union all
                        select i2.fincom_id, i2.released_at, i2.live from tally_post_ids i2 where i2.job_id = k.job_id and i2.fincom_id = k.entry_id and coalesce(i2.entry_id, '') = ''
                        limit 1) i
   where k.state = 'confirmed' and k.resent is not true and k.firm_id = p_firm and j.firm_id = p_firm and (p_job is null or k.job_id = p_job)
     and j.status <> 'cancelled'
     and (k.confirmed_by = '00000000-0000-0000-0000-000000000200'::uuid or (jsonb_typeof(j.resend_only) = 'array' and j.resend_only ? k.entry_id))
     and (j.taken_at is null or k.confirmed_at is null or j.taken_at < k.confirmed_at)
     and i.released_at is not null and not i.live
   order by k.job_id, k.entry_id, k.id desc
$function$;
revoke all on function public.tally_post_resend_owed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tally_post_resend_owed(uuid, uuid) to service_role;

-- tally_post_resend_elsewhere(job, entries): of those entries, the ones another posting has taken since (never handed back
-- then: Tally has them, or will, from there): the FinCom id in another posting's ids (live, or put there after this posting
-- released it), or its register record held by a posting queued after that release. By key. {entry: that posting}
create or replace function public.tally_post_resend_elsewhere(p_job uuid, p_entries jsonb)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_object_agg(g.eid, g.other), '{}'::jsonb) from (
    select distinct on (z.eid) z.eid, z.other from (
      select e.eid, coalesce(o2.job_id, rg.job_id)::text as other
        from jsonb_array_elements_text(case when jsonb_typeof(p_entries) = 'array' then p_entries else '[]'::jsonb end) e(eid)
        cross join lateral (select i1.firm_id, i1.fincom_id, i1.released_at from tally_post_ids i1 where i1.job_id = p_job and i1.entry_id = e.eid
                            union all
                            select i2.firm_id, i2.fincom_id, i2.released_at from tally_post_ids i2 where i2.job_id = p_job and i2.fincom_id = e.eid and coalesce(i2.entry_id, '') = ''
                            limit 1) i
        left join lateral (select o.job_id from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_job
                              and (o.live or o.created_at >= coalesce(i.released_at, '-infinity'::timestamptz)) order by o.created_at desc limit 1) o2 on true
        left join lateral (select r.job_id from tally_post_register r join tally_post_jobs oj on oj.id = r.job_id
                            where r.firm_id = i.firm_id and r.fincom_id = i.fincom_id and r.job_id <> p_job
                              and oj.created_at >= coalesce(i.released_at, '-infinity'::timestamptz) limit 1) rg on true
       where o2.job_id is not null or rg.job_id is not null) z order by z.eid, z.other) g
$function$;
revoke all on function public.tally_post_resend_elsewhere(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_post_resend_elsewhere(uuid, jsonb) to service_role;

-- tally_post_resend_list(job): what a hand-back sends (the caller holds the posting's row): every entry the posting owes,
-- whoever confirmed it, less those another posting has since; theirs closed here (superseded, naming that posting). The
-- whole list, never only the newest (the review: 200's hand-back merged a member's earlier entry unchecked; a posting's
-- resend_only kept from an earlier hand-back is never sent again). {resend: [...], gone: {entry: posting}, gw: words,
-- bridge, device: the latest such check's}. Used by tally_post_settle_resend and tally_post_check_confirm
create or replace function public.tally_post_resend_list(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f uuid; owed jsonb; gone jsonb; gw text; lastc record; resend jsonb;
begin
  -- (service_role only by its grant; also called inside tally_post_check_confirm, a member's own call)
  select j.firm_id into f from tally_post_jobs j where j.id = p_job;
  select coalesce(jsonb_agg(o.entry_id order by o.entry_id), '[]'::jsonb) into owed from tally_post_resend_owed(f, p_job) o;
  gone := tally_post_resend_elsewhere(p_job, owed);
  if gone <> '{}'::jsonb then
    gw := (select string_agg(g.key || ' (in posting ' || left(g.value, 8) || ')', ', ' order by g.key) from jsonb_each_text(gone) g);
    update tally_post_checks k set state = 'superseded', superseded_at = now(),
           words = left('Not sent again by this posting: posted again in posting ' || left(gone ->> k.entry_id, 8) || ' since it was released ('
                        || to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST)', 500)
     where k.job_id = p_job and k.state = 'confirmed' and k.resent is not true and gone ? k.entry_id;
  end if;
  select coalesce(jsonb_agg(z order by z), '[]'::jsonb) into resend from jsonb_array_elements_text(owed) z where not gone ? z;
  select o.checked_bridge, o.checked_device into lastc from tally_post_resend_owed(f, p_job) o order by o.check_id desc limit 1;
  return jsonb_build_object('resend', resend, 'gone', gone, 'gw', gw, 'bridge', lastc.checked_bridge, 'device', lastc.checked_device);
end $fn$;
revoke all on function public.tally_post_resend_list(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_resend_list(uuid) to service_role;

-- tally_post_resend_ok(job): may the bridge send the entries of this posting's resend_only now (tally-ingest's post_ok)?
-- null: yes; else why not: a posting held for checking whose entries were released by a member but not handed back yet
-- (174's held posting with a re-send list: the bridge that still holds it in memory would post them before the hand-back),
-- or an entry of the list another posting has taken since
create or replace function public.tally_post_resend_ok(p_job uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case
    when jsonb_typeof(j.resend_only) is distinct from 'array' or jsonb_array_length(j.resend_only) = 0 then null
    when j.status = 'done' and coalesce(j.checking, false) and exists (select 1 from tally_post_resend_owed(j.firm_id, j.id) o where j.resend_only ? o.entry_id)
      then 'This posting is held for checking in FinCom; the entries released for sending again go when it is handed back, not before.'
    when tally_post_resend_elsewhere(j.id, j.resend_only) <> '{}'::jsonb
      then 'Not sent: ' || (select string_agg(g.key || ' was posted again in posting ' || left(g.value, 8), ', ' order by g.key) from jsonb_each_text(tally_post_resend_elsewhere(j.id, j.resend_only)) g)
           || ' since it was released; it is not sent twice.'
  end
  from tally_post_jobs j where j.id = p_job
$function$;
revoke all on function public.tally_post_resend_ok(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_resend_ok(uuid) to service_role;

-- ---------------------------------------------------------------- 2. one held posting settled by the evidence
-- the stamp written on an entry's result ('r') or item ('i'), by "FinCom (by itself)". In Tally: verified and in_tally, as the
-- bridge's own read-back writes it (the register judges it by the recorder's match: source 'recorder'; a late report of the
-- bridge that drops it is stamped again on the next run, the match stays). Not in Tally: as an owner's Not in Tally writes it
-- (byOwner: a late report never undoes a release; the register says released)
create or replace function public.tally_post_self_stamp(p_kind text, p_cls text, p_company text, p_vch text, p_mid text, p_at text, p_day text, p_why text)
returns jsonb language sql immutable set search_path = public, pg_temp as $function$
  select case
    -- CONFLICT: the entry flagged for a person (needs review: never released, never sent again by itself; the posting
    -- settles with it as "needs review", and the register holds it as needs_review, so no other posting queues it)
    when p_cls = 'conflict' and p_kind = 'r' then jsonb_build_object('ok', false, 'verified', false, 'state', 'needs_review', 'needsReview', true, 'outcomeUnknown', false, 'conflict', true,
           'by', 'FinCom (by itself)', 'byItself', true, 'byItselfAt', p_at, 'reason', left('A person must look in Tally: ' || coalesce(p_why, 'the evidence disagrees'), 500))
    when p_cls = 'conflict' then jsonb_build_object('state', 'needs_review', 'outcomeUnknown', false, 'conflict', true, 'by', 'FinCom (by itself)', 'byItself', true, 'byItselfAt', p_at,
           'reason', left('A person must look in Tally: ' || coalesce(p_why, 'the evidence disagrees'), 500))
    when p_cls = 'in' and p_kind = 'r' then jsonb_build_object('ok', true, 'verified', true, 'state', 'in_tally', 'outcomeUnknown', false, 'needsReview', false, 'reason', '',
           'vchNumber', coalesce(p_vch, ''), 'masterId', coalesce(p_mid, ''), 'by', 'FinCom (by itself)', 'byItself', true, 'byItselfAt', p_at,
           'message', 'In Tally: found by FinCom''s read-back of ' || coalesce(p_company, 'the company') || coalesce(' (voucher ' || nullif(p_vch, '') || ')', '') || '; settled by itself on ' || p_day)
    when p_cls = 'in' then jsonb_build_object('state', 'in_tally', 'reason', '', 'outcomeUnknown', false, 'by', 'FinCom (by itself)', 'byItself', true, 'byItselfAt', p_at)
    when p_kind = 'r' then jsonb_build_object('ok', false, 'verified', false, 'state', 'notfound', 'outcomeUnknown', false, 'needsReview', false, 'byOwner', true, 'byOwnerAt', p_at,
           'by', 'FinCom (by itself)', 'byItself', true,
           'reason', 'Not in Tally (proven on ' || p_day || ': the FinCom Bridge did not see it in ' || coalesce(p_company, 'the company') || ', and FinCom has read every change in Tally since the posting): released by itself and sent again once')
    else jsonb_build_object('state', 'notfound', 'outcomeUnknown', false, 'byOwner', true, 'byOwnerAt', p_at, 'by', 'FinCom (by itself)', 'byItself', true,
           'reason', 'Not in Tally (proven on ' || p_day || '): released by itself and sent again once') end
$function$;
revoke all on function public.tally_post_self_stamp(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_self_stamp(text, text, text, text, text, text, text, text) to service_role;

create or replace function public.tally_post_settle_itself(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  j tally_post_jobs%rowtype; w tally_post_windows%rowtype; cur tally_sync_cursor%rowtype; complete boolean := false;
  me constant uuid := '00000000-0000-0000-0000-000000000200';
  at_ text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  day_ text := to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST';
  e jsonb; n_in int; n_out int; n_wait int; n_conf int; n_asked int := 0; conf jsonb; conf_words text;
  res jsonb; its jsonb; o jsonb; st text; chk boolean; msg text; said text;
  pkm jsonb; lcm jsonb; pmm jsonb; skm jsonb; evm jsonb; hit jsonb; byeid jsonb; byfid jsonb; n_resend int := 0; resend_due boolean := false; blocked boolean := false;
  jr record; x0 text; o_set jsonb; k_ int; n_out_f int; lt0 text;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  -- the posting as it is now, NOT locked (the review of 18-Nov-2026: a report of its bridge never waits on this pass): the
  -- evidence is worked out first; the posting is locked only for the writes, and only if it has not changed since (its
  -- row version, xmin), each write re-checking what it decides by (else nothing is written: the next run)
  select t as r, t.xmin::text as xm into jr from tally_post_jobs t where t.id = p_job;
  if jr.r is null then return jsonb_build_object('ok', true, 'job', p_job, 'busy', true); end if;
  j := jr.r; x0 := jr.xm;
  if j.status <> 'done' or not coalesce(j.checking, false) then
    return jsonb_build_object('ok', true, 'job', p_job, 'status', j.status, 'checking', coalesce(j.checking, false), 'held', false);
  end if;
  -- (2) FinCom has read every change Tally made up to after the posting: the book's gap check matched Tally's change number
  -- at or above the window's a1 (Tally's number after the posting), under the same starting point, after the window was saved
  select * into w from tally_post_windows where job_id = p_job;
  if w.id is not null then
    select * into cur from tally_sync_cursor where book_id = w.book_id;
    complete := cur.book_id is not null and cur.match_alter is not null and cur.match_alter >= w.a1 and cur.match_start is not distinct from cur.start_at
                and cur.match_at is not null and cur.match_at >= w.at;
  end if;

  -- the posting's results and items as maps (keys: each id, and its letters and digits), its checks and marks by entry: worked
  -- out once into variables and looked up by key (joined row by row, a posting of 20,000 entries took minutes)
  select coalesce(jsonb_object_agg(k.key, true), '{}'::jsonb) into pkm from (
    select s.key from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) x
      cross join lateral (values (x->>'id'), (nullif(regexp_replace(coalesce(x->>'id', ''), '[^A-Za-z0-9]', '', 'g'), ''))) s(key)
     where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' and lower(coalesce(x->>'ok', '')) in ('true', 't', '1') and s.key is not null
    union
    select s.key from jsonb_array_elements(case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) x
      cross join lateral (values (x->>'id'), (nullif(regexp_replace(coalesce(x->>'id', ''), '[^A-Za-z0-9]', '', 'g'), ''))) s(key)
     where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' and x->>'state' = 'in_tally' and s.key is not null) k;
  select coalesce(jsonb_object_agg(c.entry_id, jsonb_build_object('id', c.id, 'state', c.state, 'asked', c.asked_at, 'at', c.checked_at, 'cb', c.checked_bridge, 'cd', c.checked_device,
                                                                  'last', coalesce(c.given_up_at, c.checked_at, c.last_try_at, c.asked_at))), '{}'::jsonb)
    into lcm from (select distinct on (k.entry_id) k.* from tally_post_checks k where k.job_id = p_job order by k.entry_id, k.id desc) c;
  select coalesce(jsonb_object_agg(m.entry_id, m.at), '{}'::jsonb) into pmm
    from (select m0.entry_id, max(m0.at) as at from tally_post_marks m0 where m0.job_id = p_job and m0.action = 'posted' group by m0.entry_id) m;
  -- (review of 18-Nov-2026, never a double post) what Tally itself said of an entry, by each spelling of its id: both proofs
  -- of absence look for the narration TDSDesk:<entry> in the posting's own company, so a voucher Tally created in another
  -- company, or whose narration was edited since, is not found by them. An entry Tally said it took is therefore never
  -- released by itself: its own result says Tally took it (44's tally_post_result_accepted: accepted, held, created or
  -- altered, a voucher id, number or GUID, Tally's words of creation), its request's reply created or altered vouchers
  -- (a result of the same request: sentAt, batchEnd, batchN), Tally created it in another company (wrongCompany), or its
  -- item says Tally took it. The kind kept: 'wrong' (the company), 'reply' (its own), 'batch' (its request's)
  with rs as (
    select t.r, nullif(t.r->>'wrongCompany', '') as wc,
           -- (44's tally_post_result_accepted, written out word for word as 199 writes it: a function with its own search_path is
           -- never inlined, some 0.05 ms a call)
           (not (lower(coalesce(t.r->>'postOnly', '')) in ('true', 't', '1')) and ((lower(coalesce(t.r->>'accepted', '')) in ('true', 't', '1')) or (lower(coalesce(t.r->>'held', '')) in ('true', 't', '1')) or (coalesce(t.r->>'created', '') ~ '^\d+$' and (t.r->>'created')::int > 0) or (coalesce(t.r->>'altered', '') ~ '^\d+$' and (t.r->>'altered')::int > 0) or coalesce(t.r->>'lastVchId', '') <> '' or coalesce(t.r->>'vchNumber', '') <> '' or coalesce(t.r->>'masterId', '') <> '' or coalesce(t.r->>'guid', '') <> '' or ((coalesce(t.r->>'message', '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(t.r->>'message', '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(t.r->>'message', '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')) or coalesce(t.r->>'message', '') ~* 'replied ''(created|altered)''') or ((coalesce(t.r->>'reason', '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(t.r->>'reason', '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(t.r->>'reason', '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')) or coalesce(t.r->>'reason', '') ~* 'replied ''(created|altered)'''))) as own,
           case when coalesce(nullif(t.r->>'batchEnd', ''), '') <> '' or coalesce(t.r->>'batchN', '') ~ '^[1-9][0-9]{0,5}$'
                then coalesce(t.r->>'sentAt', '') || '|' || coalesce(t.r->>'batchEnd', '') || '|' || coalesce(t.r->>'batchN', '') end as bk,
           (case when coalesce(t.r->>'created', '') ~ '^[0-9]{1,9}$' then (t.r->>'created')::int else 0 end) + (case when coalesce(t.r->>'altered', '') ~ '^[0-9]{1,9}$' then (t.r->>'altered')::int else 0 end) as made
      from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) t(r)
     where jsonb_typeof(t.r) = 'object' and coalesce(t.r->>'id', '') <> ''),
  -- (each request's count as one object looked up by key: a join of the results to their requests was planned row by row)
  bg as materialized (select coalesce(jsonb_object_agg(b.bk, b.made), '{}'::jsonb) as m from (select rs.bk, max(rs.made) as made from rs where rs.bk is not null group by rs.bk having max(rs.made) > 0) b),
  ev as (
    select rs.r->>'id' as id, case when rs.wc is not null then 1 when rs.own then 2 else 3 end as pri,
           case when rs.wc is not null then jsonb_build_object('k', 'wrong', 'c', rs.wc) when rs.own then jsonb_build_object('k', 'reply', 'n', rs.made)
                else jsonb_build_object('k', 'batch', 'n', z.made) end as ev
      from rs cross join lateral (select (select bg.m from bg) ->> rs.bk as made) z
     where rs.wc is not null or rs.own or z.made is not null
    union all
    select t.i->>'id', case when nullif(t.i->>'wrongCompany', '') is not null then 1 else 2 end,
           case when nullif(t.i->>'wrongCompany', '') is not null then jsonb_build_object('k', 'wrong', 'c', t.i->>'wrongCompany') else jsonb_build_object('k', 'reply', 'n', 0) end
      from jsonb_array_elements(case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) t(i)
     where jsonb_typeof(t.i) = 'object' and coalesce(t.i->>'id', '') <> '' and (nullif(t.i->>'wrongCompany', '') is not null or (not (lower(coalesce(t.i->>'postOnly', '')) in ('true', 't', '1')) and ((lower(coalesce(t.i->>'accepted', '')) in ('true', 't', '1')) or (lower(coalesce(t.i->>'held', '')) in ('true', 't', '1')) or ((coalesce(t.i->>'reason', '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(t.i->>'reason', '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(t.i->>'reason', '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')) or coalesce(t.i->>'reason', '') ~* 'replied ''(created|altered)''')))))
  select coalesce(jsonb_object_agg(z.key, z.ev), '{}'::jsonb) into evm from (
    select distinct on (k.key) k.key, ev.ev from ev cross join lateral (values (ev.id), (nullif(regexp_replace(ev.id, '[^A-Za-z0-9]', '', 'g'), ''))) k(key)
     where k.key is not null order by k.key, ev.pri) z;

  -- each entry of the posting not settled yet (no result ok, no item in Tally, not released), with its evidence
  with v as (
    -- the posting's own ids (one a FinCom id, with its voucher's entry id: tally_post_ids_sync made them from the payload),
    -- in their order: the payload is not read again. Read once, with every field below (the third review: a second join of
    -- the same ids by key was planned row by row when the posting's ids had no statistics yet: 20,000 x 20,000)
    select i.fincom_id fid, coalesce(nullif(i.entry_id, ''), i.fincom_id) eid, row_number() over (order by i.fincom_id) o,
           i.matched_at, i.matched_vch, i.matched_mid, i.reply_vch, i.batch_n, i.batch_end, i.accepted_at, i.released_at
      from tally_post_ids i where i.job_id = p_job),
  x as materialized (
    select v.fid, v.eid, v.o, v.matched_at, coalesce(nullif(v.matched_vch, ''), nullif(v.matched_mid, '')) as mvch, nullif(v.matched_mid, '') as mid,
           nullif(v.reply_vch, '') as reply_vch, v.batch_n, nullif(v.batch_end, '') as batch_end, v.accepted_at, lcm -> v.eid as lc, (pmm ->> v.eid)::timestamptz as marked_at,
           coalesce(evm -> v.fid, evm -> v.eid, evm -> regexp_replace(v.fid, '[^A-Za-z0-9]', '', 'g'), evm -> regexp_replace(coalesce(v.eid, ''), '[^A-Za-z0-9]', '', 'g')) as ev
      from v
     where not (pkm ? v.fid or pkm ? v.eid or pkm ? regexp_replace(v.fid, '[^A-Za-z0-9]', '', 'g') or pkm ? regexp_replace(coalesce(v.eid, ''), '[^A-Za-z0-9]', '', 'g'))
       and v.released_at is null),
  y as materialized (
    select x.fid, x.eid, x.o, x.matched_at, x.mvch, x.mid, x.reply_vch, x.batch_n, x.batch_end, x.accepted_at, x.ev, x.marked_at, (x.lc->>'id')::bigint as cid, x.lc->>'state' as cst,
           (x.lc->>'asked')::timestamptz as c_asked, (x.lc->>'at')::timestamptz as c_at, x.lc->>'cb' as cb, (x.lc->>'cd')::uuid as cd, (x.lc->>'last')::timestamptz as c_last
      from x),
  c as materialized (
    select y.*,
           case when y.matched_at is not null and y.cst = 'notseen' and y.c_at > y.matched_at then 'conflict'
                when y.matched_at is not null then 'in'
                when y.cst = 'notseen' and complete and (y.marked_at is null or y.marked_at <= y.c_asked)
                     and tally_post_check_bridge_ok(p_job, y.cd, y.cb, true) then
                     -- never released by itself when anything of Tally's says it took the entry (the review's rule: the proofs of
                     -- absence go by the narration in this company): stamped accepted, a reply of its own or of its request, or
                     -- created in another company. Flagged for a person instead (CONFLICT)
                     case when y.accepted_at is not null or y.reply_vch is not null or y.batch_end is not null or y.ev is not null then 'conflict' else 'out' end
                else 'wait' end as cls
      from y),
  d as (
    select c.*,
           case when c.cls <> 'conflict' then null
                when c.matched_at is not null then 'FinCom''s read-back found it in Tally' || coalesce(' (voucher ' || c.mvch || ')', '') || ' on '
                       || to_char(c.matched_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY') || ', but the FinCom Bridge did not see it on its day on '
                       || to_char(c.c_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST (deleted or redated in Tally since?): look in Tally; Mark posted if it is there, else Not in Tally'
                when c.ev->>'k' = 'wrong' then 'Tally created it in ' || (c.ev->>'c') || ' instead of ' || coalesce(j.company, 'the posting''s company') || ', so the FinCom Bridge and FinCom''s read of '
                       || coalesce(j.company, 'the company') || ' cannot see it: look in Tally (both companies); Mark posted if it is there, else Not in Tally'
                when c.reply_vch is not null and coalesce(c.batch_n, 0) = 1 then 'Tally replied that it created this entry alone (Tally''s voucher id ' || c.reply_vch || '), yet the FinCom Bridge did not see it and FinCom''s read of every change in Tally since the posting has no such entry: look in Tally before it is sent again'
                when c.ev->>'k' = 'reply' or c.reply_vch is not null then 'Tally''s reply for this entry says it was created' || case when coalesce((c.ev->>'n')::int, 0) > 0 then ' (created ' || (c.ev->>'n') || ')' else '' end
                       || ', yet the FinCom Bridge did not see it and FinCom''s read of Tally has no such entry (another company, or its narration edited?): look in Tally before it is sent again'
                when c.ev->>'k' = 'batch' or c.batch_end is not null then 'Tally''s reply to the request that carried this entry says it created ' || coalesce(nullif(c.ev->>'n', ''), 'some') || ' voucher(s) of it'
                       || ', yet the FinCom Bridge did not see this one and FinCom''s read of Tally has no such entry: look in Tally before it is sent again'
                else 'Tally accepted this entry (FinCom stamped it accepted on ' || to_char(c.accepted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST), yet the FinCom Bridge did not see it and FinCom''s read of Tally has no such entry (another company, or its narration edited?): look in Tally before it is sent again' end as why
      from c)
  select coalesce(jsonb_agg(jsonb_build_object('fid', d.fid, 'eid', d.eid, 'cls', d.cls, 'mvch', d.mvch, 'mid', d.mid, 'cid', d.cid, 'cst', d.cst, 'cb', d.cb, 'cd', d.cd,
                                               'c_last', d.c_last, 'why', d.why) order by d.o), '[]'::jsonb)
    into e from d;
  select count(*) filter (where x->>'cls' = 'in'), count(*) filter (where x->>'cls' = 'out'), count(*) filter (where x->>'cls' = 'wait'), count(*) filter (where x->>'cls' = 'conflict'),
         coalesce(jsonb_agg(jsonb_build_object('entry', x->>'eid', 'why', x->>'why')) filter (where x->>'cls' = 'conflict'), '[]'::jsonb),
         coalesce(jsonb_object_agg(x->>'eid', x->>'cls') filter (where x->>'cls' in ('in', 'out')), '{}'::jsonb),
         coalesce(jsonb_object_agg(x->>'fid', x->>'cls') filter (where x->>'cls' in ('in', 'out')), '{}'::jsonb)
    into n_in, n_out, n_wait, n_conf, conf, byeid, byfid from jsonb_array_elements(e) x;

  -- the stamps on the posting's results and items (an entry with none gets one), one pass each; a conflict's flag too
  if n_in + n_out + n_conf > 0 then
    -- each spelling of a settled entry -> the entry (its first, by entry id, as distinct on chose)
    select coalesce(jsonb_object_agg(z.key, z.s), '{}'::jsonb) into skm from (
      select distinct on (k.key) k.key, jsonb_build_object('eid', x->>'eid', 'cls', x->>'cls', 'mvch', x->>'mvch', 'mid', x->>'mid', 'why', x->>'why') s
        from jsonb_array_elements(e) x cross join lateral (values (x->>'fid'), (x->>'eid'), (nullif(regexp_replace(x->>'fid', '[^A-Za-z0-9]', '', 'g'), '')),
                                                                 (nullif(regexp_replace(coalesce(x->>'eid', ''), '[^A-Za-z0-9]', '', 'g'), ''))) k(key)
       where x->>'cls' in ('in', 'out', 'conflict') and k.key is not null order by k.key, x->>'eid') z;
    with rr as materialized (
      select t.o, t.r, case when jsonb_typeof(t.r) = 'object' then coalesce(skm -> (t.r->>'id'), skm -> nullif(regexp_replace(coalesce(t.r->>'id', ''), '[^A-Za-z0-9]', '', 'g'), '')) end as m
        from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) with ordinality t(r, o))
    select coalesce(jsonb_agg(case when rr.m is null then rr.r else rr.r || tally_post_self_stamp('r', rr.m->>'cls', j.company, rr.m->>'mvch', rr.m->>'mid', at_, day_, rr.m->>'why') end order by rr.o), '[]'::jsonb),
           coalesce(jsonb_object_agg(rr.m->>'eid', true) filter (where rr.m is not null), '{}'::jsonb)
      into res, hit from rr;
    res := res || coalesce((select jsonb_agg(jsonb_build_object('id', x->>'eid', 'kind', 'voucher') || tally_post_self_stamp('r', x->>'cls', j.company, x->>'mvch', x->>'mid', at_, day_, x->>'why') order by x->>'eid')
                              from jsonb_array_elements(e) x where x->>'cls' in ('in', 'out', 'conflict') and not (hit ? (x->>'eid'))), '[]'::jsonb);
    with ii as materialized (
      select t.o, t.i, case when jsonb_typeof(t.i) = 'object' then coalesce(skm -> (t.i->>'id'), skm -> nullif(regexp_replace(coalesce(t.i->>'id', ''), '[^A-Za-z0-9]', '', 'g'), '')) end as m
        from jsonb_array_elements(case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) with ordinality t(i, o))
    select coalesce(jsonb_agg(case when ii.m is null then ii.i else ii.i || tally_post_self_stamp('i', ii.m->>'cls', j.company, null, null, at_, day_, ii.m->>'why') end order by ii.o), '[]'::jsonb),
           coalesce(jsonb_object_agg(ii.m->>'eid', true) filter (where ii.m is not null), '{}'::jsonb)
      into its, hit from ii;
    its := its || coalesce((select jsonb_agg(jsonb_build_object('id', x->>'eid', 'kind', 'voucher') || tally_post_self_stamp('i', x->>'cls', j.company, null, null, at_, day_, x->>'why') order by x->>'eid')
                              from jsonb_array_elements(e) x where x->>'cls' in ('in', 'out', 'conflict') and not (hit ? (x->>'eid'))), '[]'::jsonb);
  else
    res := coalesce(j.results, '[]'::jsonb); its := coalesce(j.items, '[]'::jsonb);
  end if;

  -- (tally_post_job_settle, a pass over the whole posting, worked out before the lock: its answer is the posting's state
  -- when nothing waits)
  -- (needed when nothing is handed back: none proven not in Tally, or held back by a conflict or a stop; else worked out
  -- under the lock in the rare case it is needed after all)
  if n_wait = 0 and (n_out = 0 or n_conf > 0 or j.stop_reason is not null) then o_set := tally_post_job_settle(j.status, j.checking, j.payload, res, its); end if;
  n_out_f := (select count(*) from jsonb_each_text(byfid) b where b.value = 'out');

  -- the writes: the posting locked now, unless a report holds it this moment or it changed since it was read (then the
  -- next run); every row it writes taken at once or not at all (a report never waits on this; this never waits long)
  perform 1 from tally_post_jobs t where t.id = p_job and t.xmin::text = x0 for no key update skip locked;
  if not found then return jsonb_build_object('ok', true, 'job', p_job, 'busy', true); end if;
  lt0 := current_setting('lock_timeout');
  perform set_config('lock_timeout', '300ms', true);
  begin
    if n_in + n_out > 0 then
      perform 1 from tally_post_checks k where k.job_id = p_job and k.state in ('waiting', 'notseen') and byeid ->> k.entry_id in ('in', 'out') for update nowait;
      -- IN: the stamp of an acceptance kept (the recorder matched a live id: it stays live)
      update tally_post_ids p set accepted_at = coalesce(p.accepted_at, now()), accepted_vch = coalesce(p.accepted_vch, nullif(p.matched_vch, ''), nullif(p.matched_mid, ''))
       where p.job_id = p_job and byfid ->> p.fincom_id = 'in';
      -- OUT: released as a member's confirm releases it (released_by 'owner': tally-ingest hands such ids back as released, so
      -- the bridge sends each once)
      update tally_post_ids p set live = false, released_at = now(), released_by = 'owner',
             released_why = left('Not in Tally, proven by itself on ' || day_ || ': the FinCom Bridge did not see it in ' || j.company || ', and FinCom has read every change in Tally since the posting', 500)
       where p.job_id = p_job and byfid ->> p.fincom_id = 'out'
         -- re-checked as written: nothing of Tally's came for it meanwhile (a report's stamp, a read-back, a person's mark)
         and p.released_at is null and p.accepted_at is null and p.matched_at is null and nullif(p.reply_vch, '') is null and nullif(p.batch_end, '') is null;
      get diagnostics k_ = row_count;
      if k_ <> n_out_f then raise exception 'the evidence changed while it was settled' using errcode = 'P0200'; end if;
      -- (no tally_post_marks rows: its per-row register trigger would look through the whole posting for each entry; the
      -- stamps above, the checks below and tally_post_self_settle keep who and why, and the register follows below)
      -- the checks: IN closes a waiting or "not seen" one; OUT confirms its latest "not seen" one (as a member's confirm, by itself)
      update tally_post_checks k set state = 'superseded', superseded_at = now(), checked_at = coalesce(k.checked_at, now()),
             words = left('Found in Tally by FinCom''s read-back on ' || day_ || '; this check is closed by itself', 500)
       where k.job_id = p_job and k.state in ('waiting', 'notseen') and byeid ->> k.entry_id = 'in';
      update tally_post_checks k set state = 'confirmed', confirmed_by = me, confirmed_at = now(), resent = false,
             confirmed_why = left('By itself: not seen in Tally by the FinCom Bridge, and FinCom has read every change in Tally since the posting (' || day_ || ')', 500)
       where k.job_id = p_job and k.state = 'notseen' and byeid ->> k.entry_id = 'out' and (lcm -> k.entry_id ->> 'id')::bigint = k.id;
      get diagnostics k_ = row_count;
      if k_ <> n_out then raise exception 'the evidence changed while it was settled' using errcode = 'P0200'; end if;
    end if;

    -- WAIT: a check asked by itself where none waits and none was answered in the last 15 minutes (at most 100 a run: the
    -- bridge answers 5 a turn); never for an entry while a posting of it is going on (55's bridge says unable then)
    with ask as (
      select x->>'eid' eid from jsonb_array_elements(e) x
       where x->>'cls' = 'wait' and coalesce(x->>'cst', '') <> 'waiting'
         and (x->>'c_last' is null or (x->>'c_last')::timestamptz < now() - interval '15 minutes')
         -- seen "not seen" already: asked again only after 6 hours (it waits for FinCom's read of Tally to be complete)
         and not coalesce(x->>'cst' = 'notseen' and (x->>'c_last')::timestamptz > now() - interval '6 hours', false)
       order by x->>'eid' limit 100),
    ins as (insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, last_words, auto)
            select j.firm_id, p_job, ask.eid, j.company, me, 'FinCom checks by itself whether Tally has this entry (the posting was held for checking)',
                   'Waiting for the FinCom Bridge to look in ' || j.company || ' in Tally', true from ask
            on conflict do nothing returning 1)
    select count(*) into n_asked from ins;

    -- the posting's state: still held while an entry waits (it is checked again by itself); else as tally_post_job_settle says.
    -- A conflict never holds the posting: it is flagged on the entry (needs review, for a person) and the posting settles
    -- with it. Entries proven not in Tally, to be handed back (by tally_post_settle_resend)
    if n_wait = 0 then
      -- (third review) every entry the posting owes, whoever released it (a member's confirm while it was held, too)
      select count(*) into n_resend from tally_post_resend_owed(j.firm_id, p_job);
      -- (third review LOW) posting into Tally stopped for this posting: never handed back, now or later (the stop flag is
      -- cleared once the posting settles, 174): those entries' checks are closed here; proven not in Tally and released,
      -- they are free for a person to post again once posting is allowed
      if n_resend > 0 and j.stop_reason is not null then
        update tally_post_checks k set state = 'superseded', superseded_at = now(),
               words = left('Not sent again by itself: posting into Tally was stopped for this posting (' || left(j.stop_reason, 200) || '). Not in Tally and released: post it again once posting is allowed (' || day_ || ')', 500)
         where k.job_id = p_job and k.state = 'confirmed' and k.resent is not true and k.entry_id in (select o.entry_id from tally_post_resend_owed(j.firm_id, p_job) o);
      end if;
      -- an entry flagged for a person that Tally accepted keeps the whole posting from going back to the bridge (36b's guard:
      -- never 'waiting' while Tally accepted an entry nobody settled): those proven not in Tally wait, released, and are handed
      -- back by the cron once a person has settled it (tally_post_settle_resend_due); the posting settles meanwhile
      if n_resend > 0 and n_conf > 0 and j.stop_reason is null then
        blocked := tally_post_job_accepted(p_job, res, its) is not null;
      end if;
    end if;
    -- tally_post_job_settle (a pass over the whole posting) only when its answer is the posting's state: nothing waits, nothing
    -- is handed back; else the posting stays held and its counts come from its ids (indexed)
    if n_wait > 0 or (n_resend > 0 and j.stop_reason is null and not blocked) then
      select jsonb_build_object('total', count(*), 'posted', count(*) filter (where i.released_at is null) - n_wait - n_conf) into o from tally_post_ids i where i.job_id = p_job;
    else
      o := coalesce(o_set, tally_post_job_settle(j.status, j.checking, j.payload, res, its));
    end if;
    conf_words := (select string_agg((c0->>'entry') || ': ' || (c0->>'why'), '; ') from jsonb_array_elements(conf) c0);
    if n_wait > 0 then
      st := 'done'; chk := true;
      msg := left(case when n_conf > 0 then 'A person must look in Tally for ' || n_conf || ' entr' || case when n_conf = 1 then 'y' else 'ies' end || ' (the evidence disagrees): ' || conf_words || '. ' else '' end
               || case when n_wait > 0 then 'Being checked in Tally by itself: ' || n_wait || ' entr' || case when n_wait = 1 then 'y' else 'ies' end
                       || ' not confirmed yet; FinCom looks again by itself every minute and sends nothing again until each is proven. ' else '' end
               || 'Posted ' || (o->>'posted') || ' of ' || (o->>'total') || '.', 500);
    else
      st := o->>'status'; chk := (o->>'checking')::boolean;
      msg := left('Settled by itself on ' || day_ || ': posted ' || (o->>'posted') || ' of ' || (o->>'total')
               || case when n_conf > 0 then '; ' || n_conf || ' need review: a person must look in Tally (the evidence disagrees)' else '' end
               || case when n_in > 0 then '; ' || n_in || ' confirmed from FinCom''s read-back of Tally' else '' end
               || case when n_out > 0 then '; ' || n_out || ' proven not in Tally' else '' end, 500);
    end if;
    -- to be sent again: once nothing waits, every entry released by itself and not sent yet. The posting stays held (done,
    -- checking) until tally_post_settle_resend hands those back, in its own statement (the change of status runs the sync and
    -- the register's triggers: with this pass in one statement, some 8 s at 20,000); never a posting whose posting into Tally
    -- was stopped (stop_reason: said)
    if n_wait = 0 then
      if n_resend > 0 and j.stop_reason is not null then
        said := 'not sent again: posting into Tally is stopped for this posting (' || left(j.stop_reason, 200) || '); ' || n_resend || ' entr' || case when n_resend = 1 then 'y' else 'ies' end
                || ' not in Tally, released: post them again once posting is allowed';
        msg := left(msg || '; ' || said, 500);
      elsif n_resend > 0 and blocked then
        msg := left(msg || '; ' || n_resend || ' entr' || case when n_resend = 1 then 'y' else 'ies' end || ' proven not in Tally: sent again by itself once the entries that need review are settled', 500);
      elsif n_resend > 0 then
        st := 'done'; chk := true; resend_due := true;
        msg := left(msg || '; ' || n_resend || ' entr' || case when n_resend = 1 then 'y' else 'ies' end || ' proven not in Tally: being sent again by itself (only those)', 500);
      end if;
      -- which entries need a person, and why (after the counts: the words are cut at 500)
      if n_conf > 0 then msg := left(msg || '. Need review: ' || conf_words, 500); end if;
    end if;
    update tally_post_jobs set results = res, items = its, status = st, checking = chk, done = greatest(coalesce(done, 0), (o->>'posted')::int), message = msg, updated_at = now()
     where id = p_job;
    -- (the posting register follows in its own statement, by the caller: tally_post_settle_itself_all, or tally-ingest when the
    -- answer says 'register'; the status trigger runs it on a change of status. Both in one statement: some 6 s at 20,000)

    insert into tally_post_self_settle as s (job_id, firm_id, tries, tried_at, settled_at, found, released, waiting, asked, conflicts, words)
    values (p_job, j.firm_id, 1, now(), case when not chk then now() end, n_in, n_out, n_wait, n_asked, conf, coalesce(said, msg))
    on conflict (job_id) do update set tries = s.tries + 1, tried_at = now(), settled_at = case when not chk then now() else s.settled_at end,
       found = s.found + excluded.found, released = s.released + excluded.released, waiting = excluded.waiting, asked = s.asked + excluded.asked,
       conflicts = excluded.conflicts, words = excluded.words;
    perform set_config('lock_timeout', lt0, true);
  exception when lock_not_available or sqlstate 'P0200' then
    perform set_config('lock_timeout', lt0, true);
    return jsonb_build_object('ok', true, 'job', p_job, 'busy', true, 'why', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'job', p_job, 'status', st, 'checking', chk, 'posted', (o->>'posted')::int, 'total', (o->>'total')::int, 'register', n_in + n_out + n_conf > 0 and not resend_due, 'resend', resend_due,
    'found', n_in, 'released', n_out, 'waiting', n_wait, 'asked', n_asked, 'conflicts', conf, 'complete', complete, 'resent', false,
    'words', coalesce(said, msg));
end $fn$;
revoke all on function public.tally_post_settle_itself(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_settle_itself(uuid) to service_role;

-- the entries a posting owes (tally_post_resend_owed: proven not in Tally and released by itself, or released by a member's
-- confirm while it was held), handed back alone (resend_only) to the bridge that looked (as tally_post_check_confirm does);
-- the posting waits again for it. Only a posting settled or held, nothing waiting (tally_post_settle_itself said resend, or
-- the cron's tally_post_settle_resend_due), its posting into Tally not stopped; the 36b resend guard still refuses one
-- Tally accepted and nobody settled. Safe to call again: nothing is handed back twice.
-- Never twice (the reviews of 19-Nov-2026): the hand-back can wait days, and meanwhile the entry may be posted again in
-- another posting, which puts it in Tally; the bridge would then honour this posting's release and send it a second time.
-- 201's queue keeps every such entry to this posting until it is handed back; here, as the last word, the WHOLE list
-- (tally_post_resend_list: every entry owed, whoever confirmed it; never a list kept from an earlier hand-back) is read
-- for entries another posting has since: never handed back, their checks closed (superseded, naming that posting)
create or replace function public.tally_post_settle_resend(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare j tally_post_jobs%rowtype; l jsonb; resend jsonb; v_n int; gone jsonb; v_g int; o jsonb; gw text; blk text; n_owed int; day_ text;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  -- (no key update: a report's insert that refers to the posting is never kept waiting by it)
  select * into j from tally_post_jobs where id = p_job for no key update skip locked;
  if not found then return jsonb_build_object('ok', true, 'job', p_job, 'busy', true, 'resent', false); end if;
  -- (a posting settled, with entries for a person or not: done or failed, not checking; held: done, checking)
  if j.status not in ('done', 'failed') or j.stop_reason is not null then
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'status', j.status);
  end if;
  -- (an entry flagged for a person does not stop the others: it is never among those handed back)
  if exists (select 1 from tally_post_self_settle s where s.job_id = p_job and s.waiting > 0) and j.checking then
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'error', 'entries of it are still being checked');
  end if;
  select count(*) into n_owed from tally_post_resend_owed(j.firm_id, p_job);
  if n_owed = 0 then return jsonb_build_object('ok', true, 'job', p_job, 'resent', false); end if;
  day_ := to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST';
  -- (third review LOW) posting into this posting's company no longer allowed (174's rule, read again: unlinked, stopped,
  -- renamed): never handed back; the entries, not in Tally and released, are free for a person to post again
  blk := tally_post_job_blocked(p_job);
  if blk is not null then
    update tally_post_checks k set state = 'superseded', superseded_at = now(),
           words = left('Not sent again by itself: posting into Tally is no longer allowed for this posting (' || left(blk, 300) || '). Not in Tally and released: post it again once it is allowed (' || day_ || ')', 500)
     where k.job_id = p_job and k.state = 'confirmed' and k.resent is not true and k.entry_id in (select o2.entry_id from tally_post_resend_owed(j.firm_id, p_job) o2);
    o := tally_post_job_settle(j.status, j.checking, j.payload, j.results, j.items);
    update tally_post_jobs set status = coalesce(o->>'status', status), checking = coalesce((o->>'checking')::boolean, false), updated_at = now(),
           message = left(regexp_replace(coalesce(message, ''), '; [0-9]+ entr(y|ies) proven not in Tally: (being sent again by itself \(only those\)|sent again by itself once the entries that need review are settled)', '')
                          || '; not sent again: posting into Tally is no longer allowed for it (' || n_owed || ' not in Tally, released: post them again once it is allowed)', 500)
     where id = p_job;
    update tally_post_self_settle set settled_at = now(), words = left('not sent again: posting into Tally is no longer allowed for it', 500) where job_id = p_job;
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'blocked', blk);
  end if;
  -- the whole list owed, less those another posting has since (theirs closed)
  l := tally_post_resend_list(p_job);
  resend := l->'resend'; gone := l->'gone'; gw := l->>'gw';
  v_n := jsonb_array_length(resend); v_g := (select count(*) from jsonb_object_keys(gone));
  if v_n = 0 then
    -- nothing left to hand back: the posting settles (it was held only for the hand-back)
    o := tally_post_job_settle(j.status, j.checking, j.payload, j.results, j.items);
    update tally_post_jobs set status = coalesce(o->>'status', status), checking = coalesce((o->>'checking')::boolean, false), updated_at = now(),
           message = left(regexp_replace(coalesce(message, ''), '; [0-9]+ entr(y|ies) proven not in Tally: (being sent again by itself \(only those\)|sent again by itself once the entries that need review are settled)', '')
                          || '; not sent again: ' || coalesce(gw, '') || ' posted again elsewhere since', 500)
     where id = p_job;
    update tally_post_self_settle set settled_at = now(), words = left('not sent again: ' || coalesce(gw, '') || ' posted again elsewhere since', 500) where job_id = p_job;
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'elsewhere', gone);
  end if;
  -- 36b's guard, asked first: an entry Tally accepted that nobody settled (one flagged for a person) keeps the posting from
  -- the bridge; those proven not in Tally wait, released, until a person has settled it (the cron asks again)
  if tally_post_job_accepted(p_job, j.results, j.items) is not null then
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'review', true, 'error', 'entries of it need review by a person first') || case when v_g > 0 then jsonb_build_object('elsewhere', gone) else '{}'::jsonb end;
  end if;
  -- the list replaces any earlier one (an entry of an earlier hand-back is never sent again from it)
  update tally_post_jobs set resend_only = resend,
         target_bridge = case when (l->>'bridge') ~ '^go-[0-9a-f]{6,32}$' then l->>'bridge' else target_bridge end,
         device_id = coalesce((l->>'device')::uuid, device_id),
         status = 'waiting', checking = false, taken_at = null, attempts = coalesce(attempts, 0) + 1, updated_at = now(),
         message = left(regexp_replace(coalesce(message, ''), '; [0-9]+ entr(y|ies) proven not in Tally: (being sent again by itself \(only those\)|sent again by itself once the entries that need review are settled)$', '')
                        || case when v_g > 0 then '; not sent again: ' || gw || ' posted again elsewhere since' else '' end
                        || '; sent again by itself: ' || v_n || ' entr' || case when v_n = 1 then 'y' else 'ies' end || ' not in Tally (only those)', 500)
   where id = p_job;
  update tally_post_checks k set resent = true where k.job_id = p_job and k.state = 'confirmed' and k.resent is not true and resend ? k.entry_id;
  update tally_post_self_settle set settled_at = now(), words = left('sent again by itself: ' || v_n || ' not in Tally', 500) where job_id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'resent', true, 'n', v_n, 'entries', resend, 'bridge', l->>'bridge') || case when v_g > 0 then jsonb_build_object('elsewhere', gone) else '{}'::jsonb end;
end $fn$;
revoke all on function public.tally_post_settle_resend(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_settle_resend(uuid) to service_role;

-- the postings settled (done or failed, not held) that still owe entries (tally_post_resend_owed: 36b's guard held them
-- while an entry Tally accepted waited for a person; or a member released one while the posting was held, and the posting
-- was settled by a Mark posted, which hands nothing back): handed back by themselves (tally_post_settle_resend asks the
-- guard first); found by the partial index of such checks, at most p_max a run. Each on its own (the review of
-- 19-Nov-2026): one that fails is kept with its record (words, tried_at: tried last next time) and the others go on
create or replace function public.tally_post_settle_resend_due(p_max integer default 5)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r record; o jsonb; k int := 0; n int := 0; errs int := 0;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  for r in select d.job_id, d.firm_id from (
             select distinct k0.job_id, j.firm_id from tally_post_checks k0 join tally_post_jobs j on j.id = k0.job_id
              where k0.state = 'confirmed' and k0.resent is not true
                and j.status in ('done', 'failed') and not coalesce(j.checking, false) and j.stop_reason is null
                and exists (select 1 from tally_post_resend_owed(j.firm_id, j.id))) d
             left join tally_post_self_settle s on s.job_id = d.job_id
            order by s.tried_at nulls first, d.job_id
            limit greatest(1, least(coalesce(p_max, 5), 50)) loop
    begin
      o := tally_post_settle_resend(r.job_id);
      n := n + case when coalesce((o->>'resent')::boolean, false) then 1 else 0 end;
      -- (one held back by 36b's guard is tried last next time)
      if not coalesce((o->>'resent')::boolean, false) then
        insert into tally_post_self_settle as s (job_id, firm_id, tries, tried_at, words) values (r.job_id, r.firm_id, 1, now(), left(coalesce(o->>'error', 'not handed back this time'), 500))
        on conflict (job_id) do update set tries = s.tries + 1, tried_at = now();
      end if;
    exception when others then
      errs := errs + 1;
      raise log 'tally_post_settle_resend_due: job %: % %', r.job_id, sqlstate, sqlerrm;
      begin
        insert into tally_post_self_settle as s (job_id, firm_id, tries, tried_at, words) values (r.job_id, r.firm_id, 1, now(), left('Could not be handed back this time: ' || sqlerrm, 500))
        on conflict (job_id) do update set tries = s.tries + 1, tried_at = now(), words = excluded.words;
      exception when others then null;   -- (the posting gone meanwhile: the log line above keeps it)
      end;
    end;
    k := k + 1;
  end loop;
  return jsonb_build_object('ok', true, 'looked', k, 'resent', n, 'errors', errs);
end $fn$;
revoke all on function public.tally_post_settle_resend_due(integer) from public, anon, authenticated;
grant execute on function public.tally_post_settle_resend_due(integer) to service_role;

-- 55/174's tally_post_check_confirm ("I looked in Tally: not there - post again", a member); changed (the third review of
-- 19-Nov-2026, never twice): a posting settled is handed back with every entry it owes (tally_post_resend_list: this one
-- and any a member released while it was held, never one another posting has since, never a list kept from an earlier
-- hand-back); nothing left to send: not handed back. Every line else as 174's
create or replace function public.tally_post_check_confirm(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); v_why text := left(btrim(coalesce(p_why, '')), 500); j tally_post_jobs%rowtype; c tally_post_checks%rowtype; eid text; r jsonb; v_resent boolean := false; said text; v_other boolean;
        l jsonb; resend jsonb; gw text;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can confirm this' using errcode = '42501'; end if;
  if v_why = '' then raise exception 'give a reason: where you looked in Tally (kept with your name and the time)'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  select * into c from tally_post_checks k where k.job_id = p_job and k.entry_id = eid order by k.id desc limit 1 for update;
  if c.id is null or c.state <> 'notseen' then
    return jsonb_build_object('ok', false, 'state', coalesce(c.state, ''), 'error', 'Not sent again: the FinCom Bridge has not reported this entry as not seen in Tally (or that check was closed). Press "Not in Tally - post again" first: the bridge looks in Tally.');
  end if;
  if not tally_post_check_bridge_ok(p_job, c.checked_device, c.checked_bridge, true) then
    return jsonb_build_object('ok', false, 'error', 'Not sent again: the check was not answered by the bridge that posts this posting.');
  end if;
  if exists (select 1 from tally_post_marks m where m.job_id = p_job and m.entry_id = eid and m.action = 'posted' and m.at > c.asked_at) then
    return jsonb_build_object('ok', false, 'error', 'Not sent again: the entry was marked posted after the check was asked.');
  end if;
  r := tally_post_release_core(f, auth.uid(), p_job, eid,
         left(v_why || ' (the FinCom Bridge did not see it in ' || j.company || ' on ' || to_char(c.checked_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST; confirmed by ' || tally_member_name(f, auth.uid()) || ')', 500));
  select * into j from tally_post_jobs where id = p_job;
  -- (174, sixth review M-A) answered by another bridge (the one that took it is gone): released only, never sent again
  -- (the posting stays with the bridge that took it, which nobody else may take)
  v_other := coalesce(j.taken_by, j.target_bridge) is not null and c.checked_bridge is distinct from coalesce(j.taken_by, j.target_bridge);
  if not v_other then
  update tally_post_jobs set resend_only = case when coalesce(resend_only, '[]'::jsonb) @> jsonb_build_array(eid) then resend_only else coalesce(resend_only, '[]'::jsonb) || jsonb_build_array(eid) end,
         target_bridge = case when c.checked_bridge ~ '^go-[0-9a-f]{6,32}$' then c.checked_bridge else target_bridge end, device_id = coalesce(c.checked_device, device_id)
   where id = p_job;
  end if;
  -- (third review) the check confirmed first: the hand-back below reads what the posting owes from the checks
  update tally_post_checks set state = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), confirmed_why = v_why, resent = false where id = c.id;
  if v_other then
    said := 'released; you can post it again';
  elsif j.status in ('failed', 'done') and not coalesce(j.checking, false) then
    begin
      -- (third review, never twice) every entry it owes, less those another posting has since
      l := tally_post_resend_list(p_job); resend := l->'resend'; gw := l->>'gw';
      if jsonb_array_length(resend) = 0 then
        said := 'released; not sent again: ' || coalesce(gw, 'nothing is left to send') || ' posted again elsewhere since';
      else
        update tally_post_jobs set status = 'waiting', resend_only = resend,
               message = left('Not in Tally (looked by ' || tally_member_name(f, auth.uid()) || '): sent again' || case when gw is not null then '; not sent again: ' || gw || ' posted again elsewhere since' else '' end, 500),
               taken_at = null, updated_at = now(), attempts = coalesce(attempts, 0) + 1 where id = p_job;
        update tally_post_checks k set resent = true where k.job_id = p_job and k.state = 'confirmed' and k.resent is not true and resend ? k.entry_id;
        v_resent := resend ? eid;
        if gw is not null then said := 'sent again; not sent again: ' || gw || ' posted again elsewhere since'; end if;
      end if;
    exception when others then
      said := sqlerrm;
    end;
  else
    -- (174, fifth review L1) a cancelled posting is not sent again: the entry is free to post anew
    said := case when j.status = 'cancelled' then 'released; you can post it again' else 'released; it is sent again when the posting''s other entries are settled' end;
  end if;
  return jsonb_build_object('ok', true, 'state', 'confirmed', 'resent', v_resent, 'job', p_job, 'entry', eid, 'check', c.id, 'words', said);
end $function$;
revoke all on function public.tally_post_check_confirm(uuid, text, text) from public, anon;
grant execute on function public.tally_post_check_confirm(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 3. every held posting, by the cron
create or replace function public.tally_post_settle_itself_all(p_max integer default 25)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r record; o jsonb; t0 timestamptz := clock_timestamp(); k int := 0; settled int := 0; errs int := 0;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  for r in select j.id, j.firm_id from tally_post_jobs j left join tally_post_self_settle s on s.job_id = j.id
            where j.status = 'done' and j.checking
            order by s.tried_at nulls first, j.updated_at limit greatest(1, least(coalesce(p_max, 25), 200)) loop
    begin
      o := tally_post_settle_itself(r.id);
      k := k + 1; settled := settled + case when not coalesce((o->>'checking')::boolean, true) then 1 else 0 end;
      -- in their own steps: the entries proven not in Tally handed back (the change of status runs the register's trigger),
      -- else the posting register follows the stamps (199's one-pass apply)
      if coalesce((o->>'resend')::boolean, false) then
        perform tally_post_settle_resend(r.id);
      elsif coalesce((o->>'register')::boolean, false) and to_regprocedure('public.tally_post_register_apply(uuid)') is not null then
        perform tally_post_register_apply(r.id);
      end if;
    exception when others then
      errs := errs + 1;
      insert into tally_post_self_settle as s (job_id, firm_id, tries, tried_at, words) values (r.id, r.firm_id, 1, now(), left('Could not be settled this time: ' || sqlerrm, 500))
      on conflict (job_id) do update set tries = s.tries + 1, tried_at = now(), words = excluded.words;
    end;
    exit when clock_timestamp() - t0 > interval '20 seconds';
  end loop;
  -- and the hand-backs a person's settling has let through
  begin
    o := tally_post_settle_resend_due(5);
  exception when others then errs := errs + 1;
  end;
  return jsonb_build_object('ok', true, 'looked', k, 'settled', settled, 'errors', errs, 'resent_due', coalesce((o->>'resent')::int, 0));
end $fn$;
revoke all on function public.tally_post_settle_itself_all(integer) from public, anon, authenticated;
grant execute on function public.tally_post_settle_itself_all(integer) to service_role;

-- (only while 201 has not run: 201 gives the same job its own command, a CALL of tally_post_work_run; this file run again
-- after 201 leaves it as it is)
do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null and to_regprocedure('public.tally_post_work_run(integer)') is null then
    perform cron.schedule('tally-post-settle-itself', '* * * * *', 'select public.tally_post_settle_itself_all()');
  end if;
end $$;

commit;
