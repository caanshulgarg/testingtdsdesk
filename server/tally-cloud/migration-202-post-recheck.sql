-- migration-202-post-recheck.sql (19-Nov-2026, branch next-fix-posttimeout). Written, NOT run yet: the owner runs it after
-- an independent review, with 199, 200 and 201 (one release: 199, 200, 201, 202, in that order, in one session).
--
-- The owner (19-Nov-2026): an entry that "needs review" does not just wait for a person. FinCom rechecks it against Tally by
-- itself, then marks it posted, or sends it again; never a double entry. And: an entry is only ever posted into the Tally
-- company its client is linked to (by the company's GUID).
--
--   1. The recheck (tally_post_recheck_job, by the cron through 201's tally_post_work_run): every entry the posting register
--      holds as needs_review (changed within the last day; a posting not being sent or held) is rechecked on a back-off (2,
--      10 and 30 minutes, then hourly) for a day, then left to a person in words. Each look, by evidence only:
--        (a) the FinCom Bridge's existing check by narration (55's tally_post_checks, asked by itself, answered by the
--            posting's own bridge with its two approved one-voucher reads; no new request to Tally);
--        (b) FinCom's own read of the company's Day Book (tally_vouchers / tally_lines of the linked company's book): the
--            same day, voucher type, amount, party ledger (and number when the entry has one), so an edited narration
--            still matches; and the recorder's read-back by narration (tally_post_ids.matched_at).
--   2. The outcomes, the safe direction only:
--        found (the read-back, the bridge's check "found", or exactly one voucher of the Day Book like it): marked posted,
--          by itself, in the linked company; never sent again;
--        more than one voucher like it: found, a person picks (Mark posted): never sent again;
--        a voucher of that day and amount but not like it in every field, or anything of Tally's saying it took the entry
--          (stamped accepted, a reply of its own or its request that created or altered vouchers): kept needs review with
--          the reason, looked at again; never sent again;
--        Tally created it in another company (wrongCompany): needs review, said plainly; never sent again (it should not
--          happen any more: the bridge posts only into the linked company);
--        sent again only when ALL of these hold: the bridge's check by narration "not seen" since it needed review; no
--          Day Book voucher like it (same day and amount); FinCom's read of the company complete since the posting (the
--          book's match at or above the posting window's a1, 45/150/182); nothing of Tally's says it took it. Then it is
--          released by itself (as 200 releases) and handed back by 200's tally_post_settle_resend: the reservation (201)
--          and the taken-elsewhere guard apply.
--   3. The hand-out (185's tally_post_take_for): a posting is handed to a bridge only when that bridge reports the linked
--      company's GUID open (its own list of open companies, else its key's beat): tally_post_linked_open.
-- Add-only: one table (row security on, the firm reads), two partial indexes, functions new or replaced from their latest
-- text (185's tally_post_take_for; 201's tally_post_work_due, tally_post_work, tally_post_work_run gain the recheck).
-- Nothing dropped or deleted. One transaction, lock_timeout 10 s, safe twice; service_role only, granted explicitly. No
-- bridge change, no new Tally request.
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.tally_post_work_run(integer)') is null or to_regprocedure('public.tally_post_resend_owed(uuid,uuid)') is null then
    raise exception 'migration 202 runs after 199, 200 and 201 (one release, in that order, in one session)';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. the recheck of each entry that needs review
create table if not exists public.tally_post_rechecks (
  job_id      uuid not null references public.tally_post_jobs(id) on delete cascade,
  fincom_id   text not null,
  firm_id     uuid not null,
  entry_id    text,
  since       timestamptz not null,                 -- the register's record needed review since (its changed_at)
  tries       integer not null default 0,
  next_at     timestamptz not null default now(),
  last_at     timestamptz,
  state       text not null default 'open',         -- open | posted | resent | person | settled
  words       text,
  primary key (job_id, fincom_id)
);
create index if not exists tally_post_rechecks_due on public.tally_post_rechecks (next_at) where state = 'open';
create index if not exists tally_post_register_review on public.tally_post_register (changed_at) where state = 'needs_review';
alter table public.tally_post_rechecks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_rechecks' and policyname = 'tally_post_rechecks_read') then
    create policy tally_post_rechecks_read on public.tally_post_rechecks for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke all on public.tally_post_rechecks from anon;
revoke insert, update, delete, truncate, references, trigger on public.tally_post_rechecks from authenticated;
grant select on public.tally_post_rechecks to authenticated;
grant all on public.tally_post_rechecks to service_role;

-- the entries that need review, taken up (changed within the last day; again when the record changes again): one indexed look
create or replace function public.tally_post_recheck_enroll()
returns integer language sql security definer set search_path = public, pg_temp as $function$
  with n as (
    insert into tally_post_rechecks as rc (job_id, fincom_id, firm_id, entry_id, since, next_at)
    select r.job_id, r.fincom_id, r.firm_id, r.entry_id, r.changed_at, now()
      from tally_post_register r
     where r.state = 'needs_review' and r.changed_at > now() - interval '1 day' and r.job_id is not null
       and exists (select 1 from tally_post_ids i where i.job_id = r.job_id and i.fincom_id = r.fincom_id)
       and not exists (select 1 from tally_post_rechecks x where x.job_id = r.job_id and x.fincom_id = r.fincom_id and x.since >= r.changed_at)
    on conflict (job_id, fincom_id) do update set since = excluded.since, tries = 0, next_at = now(), state = 'open', words = null
      where rc.since < excluded.since
    returning 1)
  select count(*)::int from n
$function$;
revoke all on function public.tally_post_recheck_enroll() from public, anon, authenticated;
grant execute on function public.tally_post_recheck_enroll() to service_role;

-- anything to recheck now (the cron's idle look: two indexed looks)
create or replace function public.tally_post_recheck_any()
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select exists (select 1 from tally_post_rechecks x where x.state = 'open' and x.next_at <= now())
      or exists (select 1 from tally_post_register r where r.state = 'needs_review' and r.changed_at > now() - interval '1 day' and r.job_id is not null
                  and not exists (select 1 from tally_post_rechecks x where x.job_id = r.job_id and x.fincom_id = r.fincom_id and x.since >= r.changed_at))
$function$;
revoke all on function public.tally_post_recheck_any() from public, anon, authenticated;
grant execute on function public.tally_post_recheck_any() to service_role;

-- the entries of one posting due now (at most 1,000), rechecked by the evidence, set-based. The posting is locked only for the
-- writes (skip locked: a report never waits on this). -> {job, posted, pick, kept, wrong, resend, asked, person}
create or replace function public.tally_post_recheck_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  j tally_post_jobs%rowtype; w tally_post_windows%rowtype; cur tally_sync_cursor%rowtype; complete boolean := false; bk uuid;
  me constant uuid := '00000000-0000-0000-0000-000000000200';
  at_ text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  day_ text := to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST';
  e jsonb; skm jsonb; res jsonb; its jsonb; hit jsonb; n_in int := 0; n_out int := 0; n_pick int := 0; n_kept int := 0; n_wrong int := 0; n_asked int := 0; n_person int := 0;
  lt0 text; k_ int; byfid jsonb; vchm jsonb; pvm jsonb; rim jsonb; fem jsonb; vdm jsonb; ladm jsonb; days date[]; dk jsonb; byeid jsonb; outc jsonb;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job for no key update skip locked;
  if not found then return jsonb_build_object('ok', true, 'job', p_job, 'busy', true); end if;
  -- a posting being sent, or held for checking (200 settles that), is looked at later
  if j.status in ('waiting', 'taken', 'running') or (j.status = 'done' and coalesce(j.checking, false)) then
    update tally_post_rechecks set next_at = now() + interval '10 minutes' where job_id = p_job and state = 'open' and next_at <= now();
    return jsonb_build_object('ok', true, 'job', p_job, 'later', true);
  end if;
  -- FinCom's read of the linked company complete since the posting (as 200: the book's match at or above the window's a1)
  select * into w from tally_post_windows where job_id = p_job;
  if w.id is not null then
    select * into cur from tally_sync_cursor where book_id = w.book_id;
    complete := cur.book_id is not null and cur.match_alter is not null and cur.match_alter >= w.a1 and cur.match_start is not distinct from cur.start_at
                and cur.match_at is not null and cur.match_at >= w.at;
  end if;
  bk := tally_post_register_book(j.firm_id, j.company);
  -- the posting's vouchers, results and items by id, each worked out once into a map and looked up by key (a join of
  -- them to the entries was planned row by row: 20,000 x 2,000)
  -- (the due entries' ids first: the maps hold only theirs)
  select coalesce(jsonb_object_agg(k.k, true), '{}'::jsonb) into dk from (
    select x.fincom_id, coalesce(nullif(i.entry_id, ''), i.fincom_id) as eid from tally_post_rechecks x join tally_post_ids i on i.job_id = x.job_id and i.fincom_id = x.fincom_id
     where x.job_id = p_job and x.state = 'open' and x.next_at <= now() order by x.fincom_id limit 1000) z cross join lateral (values (z.fincom_id), (z.eid)) k(k);
  select coalesce(jsonb_object_agg(z.id, z.xml), '{}'::jsonb) into pvm from (
    select distinct on (v0->>'id') v0->>'id' as id, v0->>'xml' as xml
      from jsonb_array_elements(case when jsonb_typeof(j.payload->'vouchers') = 'array' then j.payload->'vouchers' else '[]'::jsonb end) v0
     where jsonb_typeof(v0) = 'object' and dk ? (v0->>'id') order by v0->>'id') z;
  select coalesce(jsonb_object_agg(z.id, z.a), '{}'::jsonb) into rim from (
    select x->>'id' as id, jsonb_agg(x) as a from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end
                                                              || case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) x
     where jsonb_typeof(x) = 'object' and dk ? (x->>'id') group by x->>'id') z;
  -- the due entries' own fields as the posting carried them (date, type, number, party, amount: the Day Book's fields), by
  -- entry; then the Day Book of the linked company for those days (its vouchers by GUID, and their GUIDs by day and amount)
  select coalesce(jsonb_object_agg(z.fid, jsonb_build_object('day', z.day, 'vtype', z.vtype, 'vno', z.vno, 'party', z.party, 'amt', trim_scale(z.amt)::text)), '{}'::jsonb) into fem from (
    select d0.fid,
           to_date(nullif(substring(vx.xml from '<DATE>(\d{8})</DATE>'), ''), 'YYYYMMDD') as day,
           lower(btrim(coalesce(nullif(substring(vx.xml from 'VCHTYPE="([^"]*)"'), ''), substring(vx.xml from '<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>'), ''))) as vtype,
           nullif(btrim(coalesce(substring(vx.xml from '<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>'), '')), '') as vno,
           nullif(lower(btrim(replace(replace(replace(coalesce(substring(vx.xml from '<PARTYLEDGERNAME>([^<]*)</PARTYLEDGERNAME>'), ''), '&amp;', '&'), '&apos;', ''''), '&quot;', '"'))), '') as party,
           (select max(abs(m.a[1]::numeric)) from regexp_matches(coalesce(vx.xml, ''), '<AMOUNT>\s*(-?\d{1,15}(?:\.\d{1,4})?)\s*</AMOUNT>', 'g') as m(a)) as amt
      from (select x.fincom_id fid, coalesce(nullif(i.entry_id, ''), i.fincom_id) eid from tally_post_rechecks x join tally_post_ids i on i.job_id = x.job_id and i.fincom_id = x.fincom_id
             where x.job_id = p_job and x.state = 'open' and x.next_at <= now() order by x.fincom_id limit 1000) d0
      cross join lateral (select coalesce(pvm ->> d0.eid, pvm ->> d0.fid) as xml) vx) z;
  days := array(select distinct (e0.value ->> 'day')::date from jsonb_each(fem) e0 where e0.value ->> 'day' is not null and e0.value ->> 'amt' is not null);
  select coalesce(jsonb_object_agg(v.guid, jsonb_build_object('vtype', lower(btrim(v.vtype)), 'vno', nullif(btrim(v.vno), ''), 'party', lower(btrim(v.party)), 'fid', v.fincom_id)), '{}'::jsonb)
    into vdm from tally_vouchers v where v.book_id = bk and v.day = any(days) and not v.cancelled and not v.optional and v.deleted_at is null;
  select coalesce(jsonb_object_agg(z.k, z.g), '{}'::jsonb) into ladm from (
    select l.day::text || '|' || trim_scale(abs(l.amount))::text as k, jsonb_agg(distinct l.guid) as g
      from jsonb_object_keys(vdm) g(guid) join tally_lines l on l.book_id = bk and l.guid = g.guid group by 1) z;   -- (each voucher's lines by its key)
  lt0 := current_setting('lock_timeout');
  perform set_config('lock_timeout', '300ms', true);
  begin
  with d as materialized (   -- due, and still needing review in this posting
    select x.fincom_id fid, coalesce(nullif(i.entry_id, ''), i.fincom_id) eid, x.since, x.tries, i.matched_at, coalesce(nullif(i.matched_vch, ''), nullif(i.matched_mid, '')) mvch, nullif(i.matched_mid, '') mid,
           i.accepted_at, nullif(i.reply_vch, '') reply_vch, nullif(i.batch_end, '') batch_end, i.released_at, (r.state = 'needs_review' and r.job_id = p_job) as still
      from tally_post_rechecks x
      join tally_post_ids i on i.job_id = x.job_id and i.fincom_id = x.fincom_id
      left join tally_post_register r on r.firm_id = x.firm_id and r.fincom_id = x.fincom_id
     where x.job_id = p_job and x.state = 'open' and x.next_at <= now()
     order by x.fincom_id limit 1000),
  -- (b) FinCom's read of the Day Book: each entry's candidates by its day and amount (the maps worked out above), and
  -- whether each is like it in type, party and number (when the entry has one): looked up by key, never joined
  cand as materialized (
    select d.fid, g.guid, vdm -> g.guid ->> 'vno' as vno,
           ((vdm -> g.guid ->> 'vtype') = (fem -> d.fid ->> 'vtype') and (fem -> d.fid ->> 'vno' is null or (vdm -> g.guid ->> 'vno') = (fem -> d.fid ->> 'vno'))
            and (fem -> d.fid ->> 'party' is null or (vdm -> g.guid ->> 'party') = (fem -> d.fid ->> 'party'))
            and (vdm -> g.guid ->> 'fid' is null or (vdm -> g.guid ->> 'fid') = d.fid)) as alike
      from d cross join lateral jsonb_array_elements_text(coalesce(ladm -> ((fem -> d.fid ->> 'day') || '|' || (fem -> d.fid ->> 'amt')), '[]'::jsonb)) g(guid)
     where vdm ? g.guid),
  cs as (select cand.fid, count(*) filter (where cand.alike) as n_alike, count(*) as n_loose,
                (array_agg(coalesce(cand.vno, cand.guid) order by cand.guid) filter (where cand.alike))[1] as vch,
                string_agg(coalesce(cand.vno, cand.guid), ', ' order by cand.guid) as vchs
           from cand group by cand.fid),
  lc as (select distinct on (k.entry_id) k.entry_id, k.id, k.state, k.asked_at, k.checked_at, k.checked_bridge, k.checked_device, coalesce(k.given_up_at, k.checked_at, k.last_try_at, k.asked_at) as c_last
           from tally_post_checks k where k.job_id = p_job order by k.entry_id, k.id desc),
  pm as (select m.entry_id, max(m.at) as at from tally_post_marks m where m.job_id = p_job and m.action = 'posted' group by m.entry_id),
  ev as (   -- what the posting's own results and items say Tally did with each (as 200 reads them): another company, or took it
    select r.fid, max(nullif(r.r->>'wrongCompany', '')) as wc,
           bool_or(lower(coalesce(r.r->>'accepted', '')) in ('true', 't', '1') or lower(coalesce(r.r->>'held', '')) in ('true', 't', '1')
                   or (coalesce(r.r->>'created', '') ~ '^\d+$' and (r.r->>'created')::int > 0) or (coalesce(r.r->>'altered', '') ~ '^\d+$' and (r.r->>'altered')::int > 0)
                   or coalesce(r.r->>'lastVchId', '') <> '' or coalesce(r.r->>'vchNumber', '') <> '' or coalesce(r.r->>'masterId', '') <> '' or coalesce(r.r->>'guid', '') <> ''
                   or coalesce(r.r->>'batchEnd', '') <> '' or (lower(coalesce(r.r->>'ok', '')) in ('true', 't', '1') and not coalesce(r.r->>'byItself', '') = 'true')) as took
      from (select d.fid, x.r from d cross join lateral jsonb_array_elements(coalesce(rim -> d.eid, '[]'::jsonb) || case when d.fid <> d.eid then coalesce(rim -> d.fid, '[]'::jsonb) else '[]'::jsonb end) x(r)) r
     group by r.fid),
  -- each kept as one object keyed by entry and looked up by key (joined, the planner took them row by row)
  csm as materialized (select coalesce(jsonb_object_agg(cs.fid, to_jsonb(cs)), '{}'::jsonb) as m from cs),
  evm as materialized (select coalesce(jsonb_object_agg(ev.fid, to_jsonb(ev)), '{}'::jsonb) as m from ev),
  lcm as materialized (select coalesce(jsonb_object_agg(lc.entry_id, to_jsonb(lc)), '{}'::jsonb) as m from lc),
  pmm as materialized (select coalesce(jsonb_object_agg(pm.entry_id, pm.at), '{}'::jsonb) as m from pm),
  dz as materialized (
    select d.*, z.cs_, z.ev_, z.lc_, z.pm_ from d
     cross join lateral (select (select csm.m from csm) -> d.fid as cs_, (select evm.m from evm) -> d.fid as ev_, (select lcm.m from lcm) -> d.eid as lc_, (select pmm.m from pmm) ->> d.eid as pm_) z),
  c0 as materialized (
    select dz.fid, dz.eid, dz.since, dz.tries, dz.matched_at, dz.mvch, dz.mid, dz.accepted_at, dz.reply_vch, dz.batch_end, dz.released_at, dz.still,
           coalesce((dz.cs_->>'n_alike')::int, 0) as n_alike, coalesce((dz.cs_->>'n_loose')::int, 0) as n_loose, dz.cs_->>'vch' as vch, dz.cs_->>'vchs' as vchs,
           dz.ev_->>'wc' as wc, coalesce((dz.ev_->>'took')::boolean, false) as took, (dz.lc_->>'id')::bigint as cid, dz.lc_->>'state' as cst, (dz.lc_->>'checked_at')::timestamptz as c_at,
           dz.lc_->>'checked_bridge' as cb, (dz.lc_->>'checked_device')::uuid as cd, (dz.lc_->>'c_last')::timestamptz as c_last, (dz.lc_->>'asked_at')::timestamptz as c_asked, dz.pm_::timestamptz as marked_at
      from dz),
  c as materialized (
    select c0.*,
           case when not coalesce(c0.still, false) or c0.released_at is not null then 'settled'
                when c0.matched_at is not null then 'in'
                when c0.n_alike = 1 then 'in'
                when c0.n_alike > 1 then 'pick'
                when c0.wc is not null then 'wrong'
                when c0.n_loose > 0 then 'kept'
                when c0.cst = 'notseen' and c0.c_at > c0.since and complete and (c0.marked_at is null or c0.marked_at <= c0.c_asked)
                     and c0.accepted_at is null and c0.reply_vch is null and c0.batch_end is null and not c0.took
                     and tally_post_check_bridge_ok(p_job, c0.cd, c0.cb, true) then 'out'
                when c0.accepted_at is not null or c0.reply_vch is not null or c0.batch_end is not null or c0.took then 'kept'
                else 'wait' end as cls
      from c0)
  select coalesce(jsonb_agg(jsonb_build_object('fid', c.fid, 'eid', c.eid, 'cls', c.cls, 'tries', c.tries, 'since', c.since, 'cst', c.cst, 'c_last', c.c_last, 'cid', c.cid,
                                               'vch', coalesce(c.mvch, c.vch), 'mid', c.mid, 'vchs', c.vchs, 'n', c.n_alike, 'nl', c.n_loose, 'wc', c.wc, 'took', c.took,
                                               'by', case when c.matched_at is not null then 'readback' else 'content' end) order by c.fid), '[]'::jsonb)
    into e from c;
  if jsonb_array_length(e) = 0 then perform set_config('lock_timeout', lt0, true); return jsonb_build_object('ok', true, 'job', p_job, 'idle', true); end if;
  select count(*) filter (where x->>'cls' = 'in'), count(*) filter (where x->>'cls' = 'out'), count(*) filter (where x->>'cls' = 'pick'), count(*) filter (where x->>'cls' = 'kept'),
         count(*) filter (where x->>'cls' = 'wrong'), coalesce(jsonb_object_agg(x->>'fid', x->>'cls') filter (where x->>'cls' in ('in', 'out')), '{}'::jsonb),
         coalesce(jsonb_object_agg(x->>'fid', x->>'vch') filter (where x->>'cls' = 'in' and x->>'vch' is not null), '{}'::jsonb),
         coalesce(jsonb_object_agg(x->>'eid', x->>'cls') filter (where x->>'cls' in ('in', 'out')), '{}'::jsonb),
         coalesce(jsonb_object_agg(x->>'cid', true) filter (where x->>'cls' = 'out' and x->>'cid' is not null), '{}'::jsonb)
    into n_in, n_out, n_pick, n_kept, n_wrong, byfid, vchm, byeid, outc from jsonb_array_elements(e) x;

  -- found / released: the stamps on the posting's results and items, by itself (200's stamps; found by the Day Book's content
  -- says so); the posting's status as it was (a settled posting stays settled)
  if n_in + n_out > 0 then
    select coalesce(jsonb_object_agg(z.key, z.s), '{}'::jsonb) into skm from (
      select distinct on (k.key) k.key, x s from jsonb_array_elements(e) x cross join lateral (values (x->>'fid'), (x->>'eid')) k(key)
       where x->>'cls' in ('in', 'out') and k.key is not null order by k.key) z;
    with rr as materialized (select t.o, t.r, case when jsonb_typeof(t.r) = 'object' then skm -> (t.r->>'id') end as m
                               from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) with ordinality t(r, o))
    select coalesce(jsonb_agg(case when rr.m is null then rr.r else rr.r || tally_post_self_stamp('r', rr.m->>'cls', j.company, rr.m->>'vch', rr.m->>'mid', at_, day_, null)
                                 || case when rr.m->>'cls' = 'in' and rr.m->>'by' = 'content' then jsonb_build_object('message', 'In Tally: found in FinCom''s read of the Day Book of ' || j.company || ' (the same date, type, amount and party; voucher ' || coalesce(rr.m->>'vch', '?') || '); marked posted by itself on ' || day_) else '{}'::jsonb end
                                 || case when rr.m->>'cls' = 'in' then jsonb_build_object('needsReview', false, 'conflict', false) else '{}'::jsonb end end order by rr.o), '[]'::jsonb),
           coalesce(jsonb_object_agg(rr.m->>'eid', true) filter (where rr.m is not null), '{}'::jsonb) into res, hit from rr;
    res := res || coalesce((select jsonb_agg(jsonb_build_object('id', x->>'eid', 'kind', 'voucher') || tally_post_self_stamp('r', x->>'cls', j.company, x->>'vch', x->>'mid', at_, day_, null) order by x->>'eid')
                              from jsonb_array_elements(e) x where x->>'cls' in ('in', 'out') and not (hit ? (x->>'eid'))), '[]'::jsonb);
    with ii as materialized (select t.o, t.i, case when jsonb_typeof(t.i) = 'object' then skm -> (t.i->>'id') end as m
                               from jsonb_array_elements(case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) with ordinality t(i, o))
    select coalesce(jsonb_agg(case when ii.m is null then ii.i else ii.i || tally_post_self_stamp('i', ii.m->>'cls', j.company, null, null, at_, day_, null)
                                 || case when ii.m->>'cls' = 'in' then jsonb_build_object('conflict', false) else '{}'::jsonb end end order by ii.o), '[]'::jsonb),
           coalesce(jsonb_object_agg(ii.m->>'eid', true) filter (where ii.m is not null), '{}'::jsonb) into its, hit from ii;
    its := its || coalesce((select jsonb_agg(jsonb_build_object('id', x->>'eid', 'kind', 'voucher') || tally_post_self_stamp('i', x->>'cls', j.company, null, null, at_, day_, null) order by x->>'eid')
                              from jsonb_array_elements(e) x where x->>'cls' in ('in', 'out') and not (hit ? (x->>'eid'))), '[]'::jsonb);
    perform 1 from tally_post_checks k where k.job_id = p_job and k.state in ('waiting', 'notseen') and byeid ? k.entry_id for update nowait;   -- (by key: maps, never a list searched)
    update tally_post_ids p set accepted_at = coalesce(p.accepted_at, now()), accepted_vch = coalesce(p.accepted_vch, vchm ->> p.fincom_id)
     where p.job_id = p_job and byfid ->> p.fincom_id = 'in';
    -- released as 200 releases (re-checked as written: nothing of Tally's came for it meanwhile)
    update tally_post_ids p set live = false, released_at = now(), released_by = 'owner',
           released_why = left('Not in Tally, proven by itself on ' || day_ || ' (rechecked: the FinCom Bridge did not see it in ' || j.company || ', no voucher like it in its Day Book, and FinCom has read every change in Tally since the posting)', 500)
     where p.job_id = p_job and byfid ->> p.fincom_id = 'out'
       and p.released_at is null and p.accepted_at is null and p.matched_at is null and nullif(p.reply_vch, '') is null and nullif(p.batch_end, '') is null;
    get diagnostics k_ = row_count;
    if k_ <> n_out then raise exception 'the evidence changed while it was rechecked' using errcode = 'P0200'; end if;
    update tally_post_checks k set state = 'superseded', superseded_at = now(), checked_at = coalesce(k.checked_at, now()),
           words = left('Found in Tally by FinCom''s recheck on ' || day_ || '; this check is closed by itself', 500)
     where k.job_id = p_job and k.state in ('waiting', 'notseen') and byeid ->> k.entry_id = 'in';
    update tally_post_checks k set state = 'confirmed', confirmed_by = me, confirmed_at = now(), resent = false,
           confirmed_why = left('By itself (recheck): not seen in Tally by the FinCom Bridge, no voucher like it in the Day Book, and FinCom has read every change in Tally since the posting (' || day_ || ')', 500)
     where k.job_id = p_job and k.state = 'notseen' and outc ? k.id::text;
    get diagnostics k_ = row_count;
    if k_ <> n_out then raise exception 'the evidence changed while it was rechecked' using errcode = 'P0200'; end if;
    update tally_post_jobs set results = res, items = its,
           message = left('Rechecked by itself on ' || day_ || ':' || case when n_in > 0 then ' ' || n_in || ' found in Tally, marked posted;' else '' end
                          || case when n_out > 0 then ' ' || n_out || ' proven not in Tally, sent again once;' else '' end || ' ' || coalesce(message, ''), 500), updated_at = now()
     where id = p_job;
  end if;

  -- wait: the bridge's check by narration asked by itself (none waiting, none answered in the last 15 minutes; one "not seen"
  -- waits for FinCom's read of Tally to be complete), at most 100 a run (the bridge answers 5 a turn)
  with ask as (select x->>'eid' eid from jsonb_array_elements(e) x
                where x->>'cls' in ('wait', 'kept') and coalesce(x->>'cst', '') <> 'waiting'
                  and (x->>'c_last' is null or (x->>'c_last')::timestamptz < now() - interval '15 minutes' or (x->>'c_last')::timestamptz <= (x->>'since')::timestamptz)
                  and not coalesce(x->>'cst' = 'notseen' and (x->>'c_last')::timestamptz > (x->>'since')::timestamptz and not complete and (x->>'c_last')::timestamptz > now() - interval '6 hours', false)
                order by x->>'eid' limit 100),
  ins as (insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, last_words, auto)
          select j.firm_id, p_job, ask.eid, j.company, me, 'FinCom rechecks by itself whether Tally has this entry (it needed review)', 'Waiting for the FinCom Bridge to look in ' || j.company || ' in Tally', true from ask
          on conflict do nothing returning 1)
  select count(*) into n_asked from ins;

  -- the recheck rows: their outcome, the next look on the back-off (2, 10, 30 minutes, then hourly), a person after a day
  update tally_post_rechecks x set tries = x.tries + 1, last_at = now(),
         state = case z.cls when 'in' then 'posted' when 'out' then 'resent' when 'settled' then 'settled' when 'pick' then 'person' when 'wrong' then 'person'
                            else case when x.since < now() - interval '1 day' then 'person' else 'open' end end,
         next_at = now() + case x.tries when 0 then interval '2 minutes' when 1 then interval '10 minutes' when 2 then interval '30 minutes' else interval '1 hour' end,
         words = left(case z.cls
           when 'in' then case when z.by = 'readback' then 'Found in Tally by FinCom''s read-back' else 'Found in FinCom''s read of the Day Book of ' || j.company || ' (voucher ' || coalesce(z.vch, '?') || ')' end || ': marked posted by itself on ' || day_
           when 'out' then 'Not in Tally (proven on ' || day_ || '): released by itself; sent again once by its posting'
           when 'settled' then 'Settled meanwhile'
           when 'pick' then 'Found ' || z.n || ' vouchers like it in ' || j.company || ' (' || coalesce(z.vchs, '') || '): a person picks the one it is (Mark posted). It is never sent again by itself'
           when 'wrong' then 'Tally created it in ' || z.wc || ', not in ' || j.company || ' (the company its client is linked to): a person must look in Tally. It is never sent again by itself'
           when 'kept' then case when coalesce(z.nl, 0) > 0 then 'A voucher of the same day and amount is in ' || j.company || ' (' || coalesce(z.vchs, '') || ') but not like it in every field: a person must look. It is never sent again by itself'
                                 else 'Tally''s reply says it took this entry, yet it is not found yet: looked at again by itself; never sent again by itself' end
           else 'Being rechecked in Tally by itself (look ' || (x.tries + 1) || ')' end
           || case when z.cls in ('wait', 'kept') and x.since < now() - interval '1 day' then '. FinCom stopped looking by itself after a day: a person must look in Tally (Mark posted if it is there, else Not in Tally)' else '' end, 500)
    from (select x0->>'fid' fid, x0->>'cls' cls, x0->>'by' by, x0->>'vch' vch, x0->>'vchs' vchs, (x0->>'n')::int n, (x0->>'nl')::int nl, x0->>'wc' wc from jsonb_array_elements(e) x0) z
   where x.job_id = p_job and x.fincom_id = z.fid;
  select count(*) into n_person from tally_post_rechecks x where x.job_id = p_job and x.state = 'person' and x.last_at = now();
  perform set_config('lock_timeout', lt0, true);
  exception when lock_not_available or sqlstate 'P0200' then
    perform set_config('lock_timeout', lt0, true);
    return jsonb_build_object('ok', true, 'job', p_job, 'busy', true, 'why', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'job', p_job, 'posted', n_in, 'resend', n_out > 0, 'released', n_out, 'pick', n_pick, 'kept', n_kept, 'wrong', n_wrong, 'asked', n_asked, 'person', n_person,
                            'register', n_in + n_out > 0);
end $fn$;
revoke all on function public.tally_post_recheck_job(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_recheck_job(uuid) to service_role;

-- the cron's piece: new entries taken up, then the posting whose recheck is due longest (not one of p_skip). Its follow-up
-- (the hand-back through 200's guarded path, else the register following the stamps) in the caller's next transaction
create or replace function public.tally_post_recheck_run(p_skip uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r record; o jsonb;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  perform tally_post_recheck_enroll();
  select x.job_id into r from tally_post_rechecks x where x.state = 'open' and x.next_at <= now() and not (x.job_id = any(coalesce(p_skip, '{}'))) order by x.next_at limit 1;
  if r.job_id is null then return jsonb_build_object('ok', true, 'idle', true); end if;
  begin
    o := tally_post_recheck_job(r.job_id);
  exception when others then
    perform tally_post_work_error('recheck', r.job_id, sqlstate, sqlerrm);
    update tally_post_rechecks set next_at = now() + interval '10 minutes', words = left('Could not be rechecked this time: ' || sqlerrm, 500) where job_id = r.job_id and state = 'open' and next_at <= now();
    o := jsonb_build_object('ok', false, 'error', left(sqlerrm, 300));
  end;
  return jsonb_build_object('ok', true, 'job', r.job_id, 'recheck', o,
    'then', case when coalesce((o->>'resend')::boolean, false) then 'resend' when coalesce((o->>'register')::boolean, false) then 'register' end);
end $fn$;
revoke all on function public.tally_post_recheck_run(uuid[]) from public, anon, authenticated;
grant execute on function public.tally_post_recheck_run(uuid[]) to service_role;

-- ---------------------------------------------------------------- 2. the cron (201's texts, with the recheck)
create or replace function public.tally_post_work_due()
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  -- one indexed look each: an open pass, a pass asked for, a held posting, a hand-back due, a recheck due (202)
  select exists (select 1 from tally_post_register_pending p where p.done_at is null)
      or exists (select 1 from tally_post_register_wants w)
      or exists (select 1 from tally_post_jobs j where j.status = 'done' and j.checking)
      -- (the third review) a settled posting that still owes entries (200's tally_post_resend_owed), whoever released them
      or exists (select 1 from tally_post_checks k join tally_post_jobs j on j.id = k.job_id
                  where k.state = 'confirmed' and k.resent is not true and j.status in ('done', 'failed') and not coalesce(j.checking, false) and j.stop_reason is null
                    and exists (select 1 from tally_post_resend_owed(j.firm_id, j.id)))
      or tally_post_recheck_any()
$function$;
revoke all on function public.tally_post_work_due() from public, anon, authenticated;
grant execute on function public.tally_post_work_due() to service_role;

create or replace function public.tally_post_work()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare t0 timestamptz := clock_timestamp(); o jsonb; s jsonb := null; k integer := 0; skip uuid[] := '{}'; rc jsonb;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if not tally_post_work_due() then return jsonb_build_object('ok', true, 'idle', true); end if;
  -- (each piece on its own: one that fails is kept and the next goes on)
  begin
    s := tally_post_work_settle('{}');
  exception when others then
    perform tally_post_work_error('settle', null, sqlstate, sqlerrm); s := jsonb_build_object('ok', false, 'idle', true, 'error', left(sqlerrm, 300));
  end;
  if s->>'then' is not null then perform tally_post_work_then((s->>'job')::uuid, s->>'then'); end if;
  if coalesce((s->>'idle')::boolean, false) then
    begin
      perform tally_post_settle_resend_due(1);
    exception when others then perform tally_post_work_error('resend', null, sqlstate, sqlerrm);
    end;
    -- 202: one posting's recheck, and its follow-up
    begin
      rc := tally_post_recheck_run('{}');
    exception when others then perform tally_post_work_error('recheck', null, sqlstate, sqlerrm); rc := null;
    end;
    if rc->>'then' is not null then perform tally_post_work_then((rc->>'job')::uuid, rc->>'then'); end if;
    loop
      begin
        o := tally_post_register_step(null, 2000, skip);
      exception when others then
        perform tally_post_work_error('register', null, sqlstate, sqlerrm); exit;
      end;
      exit when coalesce((o->>'idle')::boolean, false) or coalesce((o->>'busy')::boolean, false);
      if o ? 'error' then skip := skip || (o->>'job')::uuid; end if;
      k := k + 1;
      exit when clock_timestamp() - t0 > interval '1 second';
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'settle', s, 'recheck', rc, 'steps', k, 'more', tally_post_work_due(), 'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $fn$;
revoke all on function public.tally_post_work() from public, anon, authenticated;
grant execute on function public.tally_post_work() to service_role;

-- 201's run, with up to 10 postings' rechecks (each, then its follow-up) after the hand-backs
create or replace procedure public.tally_post_work_run(p_seconds integer default 25)
language plpgsql as $proc$
declare t0 timestamptz := clock_timestamp(); lim interval := make_interval(secs => greatest(1, least(coalesce(p_seconds, 25), 50))); tried uuid[] := '{}'; s jsonb; o jsonb; n int := 0; busy int := 0;
        skip uuid[] := '{}'; rtried uuid[] := '{}'; m int := 0;
begin
  if not public.tally_post_work_due() then return; end if;
  -- (the review of 19-Nov-2026) each piece in a block of its own: one that fails (a bad posting) is undone, kept
  -- (tally_post_work_error) and left for this run; the rest goes on. Every COMMIT outside those blocks (a COMMIT is refused
  -- inside a block with an exception handler)
  loop
    exit when n >= 10 or clock_timestamp() - t0 > lim;
    begin
      s := public.tally_post_work_settle(tried);
    exception when others then
      perform public.tally_post_work_error('settle', null, sqlstate, sqlerrm); s := jsonb_build_object('idle', true);
    end;
    commit;
    exit when coalesce((s->>'idle')::boolean, false);
    tried := tried || (s->>'job')::uuid; n := n + 1;
    if s->>'then' is not null then
      o := public.tally_post_work_then((s->>'job')::uuid, s->>'then');   -- (its own handler)
      commit;
    end if;
  end loop;
  begin
    o := public.tally_post_settle_resend_due(5);   -- (each hand-back in its own block there)
  exception when others then
    perform public.tally_post_work_error('resend', null, sqlstate, sqlerrm);
  end;
  commit;
  -- 202: the rechecks due (one posting a piece), each with its follow-up in its own transaction
  loop
    exit when m >= 10 or clock_timestamp() - t0 > lim;
    begin
      s := public.tally_post_recheck_run(rtried);
    exception when others then
      perform public.tally_post_work_error('recheck', null, sqlstate, sqlerrm); s := jsonb_build_object('idle', true);
    end;
    commit;
    exit when coalesce((s->>'idle')::boolean, false);
    rtried := rtried || (s->>'job')::uuid; m := m + 1;
    if s->>'then' is not null then
      o := public.tally_post_work_then((s->>'job')::uuid, s->>'then');
      commit;
    end if;
  end loop;
  loop
    exit when clock_timestamp() - t0 > lim;
    begin
      o := public.tally_post_register_step(null, 2000, skip);
    exception when others then
      perform public.tally_post_work_error('register', null, sqlstate, sqlerrm); o := jsonb_build_object('idle', true);
    end;
    commit;
    exit when coalesce((o->>'idle')::boolean, false);
    -- a step that failed: kept by the step, that posting left out for the rest of this run
    if o ? 'error' then skip := skip || (o->>'job')::uuid; continue; end if;
    -- a posting a report holds this moment: the step is left for later; a few in a row, then the next run
    if coalesce((o->>'busy')::boolean, false) then busy := busy + 1; exit when busy >= 5; perform pg_sleep(0.2); else busy := 0; end if;
  end loop;
end $proc$;
revoke all on procedure public.tally_post_work_run(integer) from public, anon, authenticated;
grant execute on procedure public.tally_post_work_run(integer) to service_role;

-- ---------------------------------------------------------------- 3. only into the linked company (its GUID open there)
-- may this bridge be handed this posting? The posting's client is linked to its company (tally_links, linked, its GUID
-- known) and the bridge reports that very GUID open: its own list of open companies (info.bridges[id].cos, 146) when it
-- sends one, else its key's beat (companies, open). Else nothing is handed to it (it waits for a bridge that has it open)
create or replace function public.tally_post_linked_open(p_job uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                    where l.firm_id = j.firm_id and l.client_id = j.client_id and l.state = 'linked'
                      and lower(tally_nm(tc.company)) = lower(tally_nm(j.company))
                      and nullif(btrim(coalesce(l.company_guid, '')), '') is not null
                      and case when jsonb_typeof(me.info -> 'bridges' -> p_bridge -> 'cos') = 'array'
                            then exists (select 1 from jsonb_array_elements(me.info -> 'bridges' -> p_bridge -> 'cos') c where jsonb_typeof(c) = 'array'
                                          and lower(btrim(coalesce(c ->> 1, ''))) = lower(btrim(l.company_guid)))
                            else jsonb_typeof(me.info -> 'beat' -> 'companies') = 'array'
                             and exists (select 1 from jsonb_array_elements(me.info -> 'beat' -> 'companies') c where jsonb_typeof(c) = 'object'
                                          and lower(btrim(coalesce(c ->> 'guid', ''))) = lower(btrim(l.company_guid)) and coalesce(c ->> 'open', 'true') <> 'false') end)
      from tally_post_jobs j
      join tally_devices me on me.id = p_device and not coalesce(me.revoked, false)
     where j.id = p_job), false)
$function$;
revoke all on function public.tally_post_linked_open(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_linked_open(uuid, uuid, text) to service_role;

-- 185's tally_post_take_for; changed: the bridge's own postings and those picked up are handed out only when it reports the
-- linked company's GUID open (tally_post_linked_open; the third loop asked it already, 185's tally_post_unrouted_ok)
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language plpgsql security definer set search_path = public, pg_temp as $function$
declare jid uuid; fm uuid; i integer;
begin
  -- 174: the posting about to be handed out is checked (tally_post_job_blocked); one that may no longer be posted is held
  -- (tally_post_hold_job: failed when never taken, else the stop flag) and the next is looked at; a stop-flagged one never
  select d.firm_id into fm from tally_devices d where d.id = p_device;
  -- 54's text: the bridge's own postings first (4a.: a go- bridge only for a company its own beat has open)
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j
     where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main)
       and j.firm_id = fm and j.stop_reason is null
       and (j.taken_by = p_bridge or (j.taken_by is null and ((j.taken_at is null and j.first_taken_at is null) or p_bridge !~ '^go-[0-9a-f]{6,32}$')))   -- once taken: only by the bridge that took it (H2a; a v1 take, by its history too: a v1 bridge, LOW 6 / fourth review LOW 1)
       and tally_post_linked_open(j.id, p_device, p_bridge)   -- 202: the linked company's GUID open on this bridge
     order by j.created_at limit 1 for update skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
             taken_by = case when p_bridge ~ '^go-[0-9a-f]{6,32}$' then p_bridge else taken_by end   -- final review M1: the bridge that took it
       where id = jid
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
  -- 142: a posting of the firm never taken, whose bridge does not have the company open now while this one does
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j join tally_devices me on me.id = p_device
     where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge)
       and j.stop_reason is null
       and tally_post_linked_open(j.id, p_device, p_bridge)   -- 202
     order by j.created_at limit 1 for update of j skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (the one it was queued for did not have it open)', 300)
       where id = jid and status = 'waiting' and taken_by is null and taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
  -- 185: a posting queued for no computer (device_id null), never taken: the first FinCom Bridge 2.x that has that very
  -- company open (tally_post_unrouted_ok: the link's GUID in its beat and the link's data location) takes it. The row is
  -- locked (skip locked: a second bridge asking at the same moment is handed nothing) and taken in ONE update that holds
  -- only while it is still waiting, for no computer and never taken: it then belongs to this bridge and its key
  -- (device_id, target_bridge, taken_by), as a posting picked up (142) does. An older bridge (no "go-" id) never comes here
  if coalesce(p_bridge, '') !~ '^go-[0-9a-f]{6,32}$' then return; end if;
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j
     where j.firm_id = fm and j.status = 'waiting' and j.device_id is null and j.stop_reason is null and tally_post_unrouted_ok(j.id, p_device, p_bridge)
     order by j.created_at limit 1 for update of j skip locked;
    if jid is null then return; end if;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (it was queued for whichever computer opens it)', 300)
       where id = jid and status = 'waiting' and device_id is null and taken_by is null and taken_at is null and first_taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
end $function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

commit;
