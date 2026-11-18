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
--        in Tally since?); (b) proven absent by (1) and (2), yet Tally replied it created this one entry alone (reply_vch,
--        batch_n 1). Neither is marked nor released; the posting stays held with each entry and why in its words and in
--        tally_post_self_settle.conflicts.
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
-- Add-only: one new table (tally_post_self_settle: row security on, the firm reads, service_role writes), one column added
-- to tally_post_checks (auto, default false), one partial index of tally_post_jobs (held postings), four new functions,
-- one pg_cron job where pg_cron is; 55's tally_member_name replaced from its text with one case added (the made-up asker
-- of a check asked by itself is named "FinCom (by itself)"). Nothing dropped, deleted or truncated. One transaction,
-- lock_timeout 10 s, safe twice; service_role only, granted explicitly. No bridge change, no new Tally request: the checks
-- are 55's (the owner-approved one-voucher reads). Tested by tests/run_migration200.py.
begin;
set local lock_timeout = '10s';

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

-- 55's tally_member_name: the same, and the made-up member who asks a check by itself named as FinCom
create or replace function public.tally_member_name(p_firm uuid, p_user uuid) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select case when p_user = '00000000-0000-0000-0000-000000000200'::uuid then 'FinCom (by itself)' else
         coalesce((select nullif(btrim(m.name), '') from members m where m.firm_id = p_firm and m.user_id = p_user limit 1), 'a member of the firm') end
$function$;
revoke all on function public.tally_member_name(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tally_member_name(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- 2. one held posting settled by the evidence
-- the stamp written on an entry's result ('r') or item ('i'), by "FinCom (by itself)". In Tally: verified and in_tally, as the
-- bridge's own read-back writes it (the register judges it by the recorder's match: source 'recorder'; a late report of the
-- bridge that drops it is stamped again on the next run, the match stays). Not in Tally: as an owner's Not in Tally writes it
-- (byOwner: a late report never undoes a release; the register says released)
create or replace function public.tally_post_self_stamp(p_kind text, p_cls text, p_company text, p_vch text, p_mid text, p_at text, p_day text)
returns jsonb language sql immutable set search_path = public, pg_temp as $function$
  select case
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
revoke all on function public.tally_post_self_stamp(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_self_stamp(text, text, text, text, text, text, text) to service_role;

create or replace function public.tally_post_settle_itself(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  j tally_post_jobs%rowtype; w tally_post_windows%rowtype; cur tally_sync_cursor%rowtype; complete boolean := false;
  me constant uuid := '00000000-0000-0000-0000-000000000200';
  at_ text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  day_ text := to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST';
  e jsonb; n_in int; n_out int; n_wait int; n_conf int; n_asked int := 0; conf jsonb; conf_words text;
  res jsonb; its jsonb; o jsonb; st text; chk boolean; msg text; said text;
  pkm jsonb; lcm jsonb; pmm jsonb; skm jsonb; hit jsonb; byeid jsonb; byfid jsonb; n_resend int := 0; resend_due boolean := false;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  -- the posting, unless a report of its bridge holds it this moment (then the next run)
  select * into j from tally_post_jobs where id = p_job for update skip locked;
  if not found then return jsonb_build_object('ok', true, 'job', p_job, 'busy', true); end if;
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

  -- each entry of the posting not settled yet (no result ok, no item in Tally, not released), with its evidence
  with v as (
    -- the posting's own ids (one a FinCom id, with its voucher's entry id: tally_post_ids_sync made them from the payload),
    -- in their order: the payload is not read again
    select i.fincom_id fid, coalesce(nullif(i.entry_id, ''), i.fincom_id) eid, row_number() over (order by i.fincom_id) o
      from tally_post_ids i where i.job_id = p_job),
  x as materialized (
    select v.fid, v.eid, v.o, p.matched_at, coalesce(nullif(p.matched_vch, ''), nullif(p.matched_mid, '')) as mvch, nullif(p.matched_mid, '') as mid,
           nullif(p.reply_vch, '') as reply_vch, p.batch_n, lcm -> v.eid as lc, (pmm ->> v.eid)::timestamptz as marked_at
      from v left join tally_post_ids p on p.job_id = p_job and p.fincom_id = v.fid
     where not (pkm ? v.fid or pkm ? v.eid or pkm ? regexp_replace(v.fid, '[^A-Za-z0-9]', '', 'g') or pkm ? regexp_replace(coalesce(v.eid, ''), '[^A-Za-z0-9]', '', 'g'))
       and p.released_at is null),
  y as materialized (
    select x.fid, x.eid, x.o, x.matched_at, x.mvch, x.mid, x.reply_vch, x.batch_n, x.marked_at, (x.lc->>'id')::bigint as cid, x.lc->>'state' as cst,
           (x.lc->>'asked')::timestamptz as c_asked, (x.lc->>'at')::timestamptz as c_at, x.lc->>'cb' as cb, (x.lc->>'cd')::uuid as cd, (x.lc->>'last')::timestamptz as c_last
      from x),
  c as materialized (
    select y.*,
           case when y.matched_at is not null and y.cst = 'notseen' and y.c_at > y.matched_at then 'conflict'
                when y.matched_at is not null then 'in'
                when y.cst = 'notseen' and complete and (y.marked_at is null or y.marked_at <= y.c_asked)
                     and tally_post_check_bridge_ok(p_job, y.cd, y.cb, true) then
                     case when y.reply_vch is not null and coalesce(y.batch_n, 0) = 1 then 'conflict' else 'out' end
                else 'wait' end as cls
      from y),
  d as (
    select c.*,
           case when c.cls <> 'conflict' then null
                when c.matched_at is not null then 'FinCom''s read-back found it in Tally' || coalesce(' (voucher ' || c.mvch || ')', '') || ' on '
                       || to_char(c.matched_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY') || ', but the FinCom Bridge did not see it on its day on '
                       || to_char(c.c_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST (deleted or redated in Tally since?): look in Tally; Mark posted if it is there, else Not in Tally'
                else 'Tally replied that it created this entry alone (Tally''s voucher id ' || c.reply_vch || '), yet the FinCom Bridge did not see it and FinCom''s read of every change in Tally since the posting has no such entry: look in Tally before it is sent again' end as why
      from c)
  select coalesce(jsonb_agg(jsonb_build_object('fid', d.fid, 'eid', d.eid, 'cls', d.cls, 'mvch', d.mvch, 'mid', d.mid, 'cid', d.cid, 'cst', d.cst, 'cb', d.cb, 'cd', d.cd,
                                               'c_last', d.c_last, 'why', d.why) order by d.o), '[]'::jsonb)
    into e from d;
  select count(*) filter (where x->>'cls' = 'in'), count(*) filter (where x->>'cls' = 'out'), count(*) filter (where x->>'cls' = 'wait'), count(*) filter (where x->>'cls' = 'conflict'),
         coalesce(jsonb_agg(jsonb_build_object('entry', x->>'eid', 'why', x->>'why')) filter (where x->>'cls' = 'conflict'), '[]'::jsonb),
         coalesce(jsonb_object_agg(x->>'eid', x->>'cls') filter (where x->>'cls' in ('in', 'out')), '{}'::jsonb),
         coalesce(jsonb_object_agg(x->>'fid', x->>'cls') filter (where x->>'cls' in ('in', 'out')), '{}'::jsonb)
    into n_in, n_out, n_wait, n_conf, conf, byeid, byfid from jsonb_array_elements(e) x;

  -- the stamps on the posting's results and items (an entry with none gets one), one pass each
  if n_in + n_out > 0 then
    -- each spelling of a settled entry -> the entry (its first, by entry id, as distinct on chose)
    select coalesce(jsonb_object_agg(z.key, z.s), '{}'::jsonb) into skm from (
      select distinct on (k.key) k.key, jsonb_build_object('eid', x->>'eid', 'cls', x->>'cls', 'mvch', x->>'mvch', 'mid', x->>'mid') s
        from jsonb_array_elements(e) x cross join lateral (values (x->>'fid'), (x->>'eid'), (nullif(regexp_replace(x->>'fid', '[^A-Za-z0-9]', '', 'g'), '')),
                                                                 (nullif(regexp_replace(coalesce(x->>'eid', ''), '[^A-Za-z0-9]', '', 'g'), ''))) k(key)
       where x->>'cls' in ('in', 'out') and k.key is not null order by k.key, x->>'eid') z;
    with rr as materialized (
      select t.o, t.r, case when jsonb_typeof(t.r) = 'object' then coalesce(skm -> (t.r->>'id'), skm -> nullif(regexp_replace(coalesce(t.r->>'id', ''), '[^A-Za-z0-9]', '', 'g'), '')) end as m
        from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) with ordinality t(r, o))
    select coalesce(jsonb_agg(case when rr.m is null then rr.r else rr.r || tally_post_self_stamp('r', rr.m->>'cls', j.company, rr.m->>'mvch', rr.m->>'mid', at_, day_) end order by rr.o), '[]'::jsonb),
           coalesce(jsonb_object_agg(rr.m->>'eid', true) filter (where rr.m is not null), '{}'::jsonb)
      into res, hit from rr;
    res := res || coalesce((select jsonb_agg(jsonb_build_object('id', x->>'eid', 'kind', 'voucher') || tally_post_self_stamp('r', x->>'cls', j.company, x->>'mvch', x->>'mid', at_, day_) order by x->>'eid')
                              from jsonb_array_elements(e) x where x->>'cls' in ('in', 'out') and not (hit ? (x->>'eid'))), '[]'::jsonb);
    with ii as materialized (
      select t.o, t.i, case when jsonb_typeof(t.i) = 'object' then coalesce(skm -> (t.i->>'id'), skm -> nullif(regexp_replace(coalesce(t.i->>'id', ''), '[^A-Za-z0-9]', '', 'g'), '')) end as m
        from jsonb_array_elements(case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) with ordinality t(i, o))
    select coalesce(jsonb_agg(case when ii.m is null then ii.i else ii.i || tally_post_self_stamp('i', ii.m->>'cls', j.company, null, null, at_, day_) end order by ii.o), '[]'::jsonb),
           coalesce(jsonb_object_agg(ii.m->>'eid', true) filter (where ii.m is not null), '{}'::jsonb)
      into its, hit from ii;
    its := its || coalesce((select jsonb_agg(jsonb_build_object('id', x->>'eid', 'kind', 'voucher') || tally_post_self_stamp('i', x->>'cls', j.company, null, null, at_, day_) order by x->>'eid')
                              from jsonb_array_elements(e) x where x->>'cls' in ('in', 'out') and not (hit ? (x->>'eid'))), '[]'::jsonb);
    -- IN: the stamp of an acceptance kept (the recorder matched a live id: it stays live)
    update tally_post_ids p set accepted_at = coalesce(p.accepted_at, now()), accepted_vch = coalesce(p.accepted_vch, nullif(p.matched_vch, ''), nullif(p.matched_mid, ''))
     where p.job_id = p_job and byfid ->> p.fincom_id = 'in';
    -- OUT: released as a member's confirm releases it (released_by 'owner': tally-ingest hands such ids back as released, so
    -- the bridge sends each once)
    update tally_post_ids p set live = false, released_at = now(), released_by = 'owner',
           released_why = left('Not in Tally, proven by itself on ' || day_ || ': the FinCom Bridge did not see it in ' || j.company || ', and FinCom has read every change in Tally since the posting', 500)
     where p.job_id = p_job and byfid ->> p.fincom_id = 'out';
    -- (no tally_post_marks rows: its per-row register trigger would look through the whole posting for each entry; the
    -- stamps above, the checks below and tally_post_self_settle keep who and why, and the register follows below)
    -- the checks: IN closes a waiting or "not seen" one; OUT confirms its latest "not seen" one (as a member's confirm, by itself)
    update tally_post_checks k set state = 'superseded', superseded_at = now(), checked_at = coalesce(k.checked_at, now()),
           words = left('Found in Tally by FinCom''s read-back on ' || day_ || '; this check is closed by itself', 500)
     where k.job_id = p_job and k.state in ('waiting', 'notseen') and byeid ->> k.entry_id = 'in';
    update tally_post_checks k set state = 'confirmed', confirmed_by = me, confirmed_at = now(), resent = false,
           confirmed_why = left('By itself: not seen in Tally by the FinCom Bridge, and FinCom has read every change in Tally since the posting (' || day_ || ')', 500)
     where k.job_id = p_job and k.state = 'notseen' and byeid ->> k.entry_id = 'out' and (lcm -> k.entry_id ->> 'id')::bigint = k.id;
  else
    res := coalesce(j.results, '[]'::jsonb); its := coalesce(j.items, '[]'::jsonb);
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

  -- the posting's state: still held while an entry waits or conflicts; else as tally_post_job_settle says
  -- entries proven not in Tally, to be handed back (by tally_post_settle_resend)
  if n_wait + n_conf = 0 then
    select count(distinct k.entry_id) into n_resend from tally_post_checks k
     where k.job_id = p_job and k.state = 'confirmed' and k.confirmed_by = me and not coalesce(k.resent, false);
  end if;
  -- tally_post_job_settle (a pass over the whole posting) only when its answer is the posting's state: nothing waits, nothing
  -- is handed back; else the posting stays held and its counts come from its ids (indexed)
  if n_wait + n_conf > 0 or (n_resend > 0 and j.stop_reason is null) then
    select jsonb_build_object('total', count(*), 'posted', count(*) filter (where i.released_at is null) - n_wait - n_conf) into o from tally_post_ids i where i.job_id = p_job;
  else
    o := tally_post_job_settle(j.status, j.checking, j.payload, res, its);
  end if;
  conf_words := (select string_agg((c0->>'entry') || ': ' || (c0->>'why'), '; ') from jsonb_array_elements(conf) c0);
  if n_wait + n_conf > 0 then
    st := 'done'; chk := true;
    msg := left(case when n_conf > 0 then 'A person must look in Tally for ' || n_conf || ' entr' || case when n_conf = 1 then 'y' else 'ies' end || ' (the evidence disagrees): ' || conf_words || '. ' else '' end
             || case when n_wait > 0 then 'Being checked in Tally by itself: ' || n_wait || ' entr' || case when n_wait = 1 then 'y' else 'ies' end
                     || ' not confirmed yet; FinCom looks again by itself every minute and sends nothing again until each is proven. ' else '' end
             || 'Posted ' || (o->>'posted') || ' of ' || (o->>'total') || '.', 500);
  else
    st := o->>'status'; chk := (o->>'checking')::boolean;
    msg := left('Settled by itself on ' || day_ || ': posted ' || (o->>'posted') || ' of ' || (o->>'total')
             || case when n_in > 0 then '; ' || n_in || ' confirmed from FinCom''s read-back of Tally' else '' end
             || case when n_out > 0 then '; ' || n_out || ' proven not in Tally' else '' end, 500);
  end if;
  -- to be sent again: once nothing waits, every entry released by itself and not sent yet. The posting stays held (done,
  -- checking) until tally_post_settle_resend hands those back, in its own statement (the change of status runs the sync and
  -- the register's triggers: with this pass in one statement, some 8 s at 20,000); never a posting whose posting into Tally
  -- was stopped (stop_reason: said)
  if n_wait + n_conf = 0 then
    if n_resend > 0 and j.stop_reason is not null then
      said := 'not sent again: posting into Tally is stopped for this posting (' || left(j.stop_reason, 200) || ')';
      msg := left(msg || '; ' || said, 500);
    elsif n_resend > 0 then
      st := 'done'; chk := true; resend_due := true;
      msg := left(msg || '; ' || n_resend || ' entr' || case when n_resend = 1 then 'y' else 'ies' end || ' proven not in Tally: being sent again by itself (only those)', 500);
    end if;
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
  return jsonb_build_object('ok', true, 'job', p_job, 'status', st, 'checking', chk, 'posted', (o->>'posted')::int, 'total', (o->>'total')::int, 'register', n_in + n_out > 0 and not resend_due, 'resend', resend_due,
    'found', n_in, 'released', n_out, 'waiting', n_wait, 'asked', n_asked, 'conflicts', conf, 'complete', complete, 'resent', false,
    'words', coalesce(said, msg));
end $fn$;
revoke all on function public.tally_post_settle_itself(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_settle_itself(uuid) to service_role;

-- the entries released by itself (proven not in Tally), handed back alone (resend_only) to the bridge that looked (as
-- tally_post_check_confirm does after a member's confirm); the posting waits again for it. Only a posting still held, nothing
-- waiting or contradictory (tally_post_settle_itself said resend), its posting into Tally not stopped; the 36b resend guard
-- still refuses one Tally accepted and nobody settled. Safe to call again: nothing is handed back twice
create or replace function public.tally_post_settle_resend(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare j tally_post_jobs%rowtype; me constant uuid := '00000000-0000-0000-0000-000000000200'; resend jsonb; lastc record; v_n int;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job for update skip locked;
  if not found then return jsonb_build_object('ok', true, 'job', p_job, 'busy', true, 'resent', false); end if;
  if j.status <> 'done' or not coalesce(j.checking, false) or j.stop_reason is not null then
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'status', j.status);
  end if;
  if exists (select 1 from tally_post_self_settle s where s.job_id = p_job and (s.waiting > 0 or jsonb_array_length(s.conflicts) > 0)) then
    return jsonb_build_object('ok', true, 'job', p_job, 'resent', false, 'error', 'entries of it are still being checked');
  end if;
  select coalesce(jsonb_agg(distinct k.entry_id), '[]'::jsonb) into resend from tally_post_checks k
   where k.job_id = p_job and k.state = 'confirmed' and k.confirmed_by = me and not coalesce(k.resent, false);
  v_n := jsonb_array_length(resend);
  if v_n = 0 then return jsonb_build_object('ok', true, 'job', p_job, 'resent', false); end if;
  select k.checked_bridge, k.checked_device into lastc from tally_post_checks k
   where k.job_id = p_job and k.state = 'confirmed' and k.confirmed_by = me and not coalesce(k.resent, false) order by k.id desc limit 1;
  update tally_post_jobs set resend_only = (select coalesce(jsonb_agg(distinct z), '[]'::jsonb) from jsonb_array_elements_text(coalesce(resend_only, '[]'::jsonb) || resend) z),
         target_bridge = case when lastc.checked_bridge ~ '^go-[0-9a-f]{6,32}$' then lastc.checked_bridge else target_bridge end,
         device_id = coalesce(lastc.checked_device, device_id),
         status = 'waiting', checking = false, taken_at = null, attempts = coalesce(attempts, 0) + 1, updated_at = now(),
         message = left(regexp_replace(coalesce(message, ''), '; [0-9]+ entr(y|ies) proven not in Tally: being sent again by itself \(only those\)$', '')
                        || '; sent again by itself: ' || v_n || ' entr' || case when v_n = 1 then 'y' else 'ies' end || ' proven not in Tally (only those)', 500)
   where id = p_job;
  update tally_post_checks k set resent = true where k.job_id = p_job and k.state = 'confirmed' and k.confirmed_by = me and not coalesce(k.resent, false);
  update tally_post_self_settle set settled_at = now(), words = left('sent again by itself: ' || v_n || ' proven not in Tally', 500) where job_id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'resent', true, 'n', v_n, 'entries', resend, 'bridge', lastc.checked_bridge);
end $fn$;
revoke all on function public.tally_post_settle_resend(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_settle_resend(uuid) to service_role;

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
  return jsonb_build_object('ok', true, 'looked', k, 'settled', settled, 'errors', errs);
end $fn$;
revoke all on function public.tally_post_settle_itself_all(integer) from public, anon, authenticated;
grant execute on function public.tally_post_settle_itself_all(integer) to service_role;

do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('tally-post-settle-itself', '* * * * *', 'select public.tally_post_settle_itself_all()');
  end if;
end $$;

commit;
