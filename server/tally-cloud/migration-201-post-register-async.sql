-- migration-201-post-register-async.sql (18-Nov-2026, branch next-fix-posttimeout). Written, NOT run yet: the owner runs it
-- after an independent review. Runs after 199 and 200 (and 182, 185, whose functions it replaces from their latest text).
--
-- Why: with 199 and 200 a posting of 20,000 entries no longer times out, but each change of its status still did the
-- posting register's whole pass inside the trigger (about 4 s of 8), and queueing, the report moving it to done, the
-- hand-back and the cron's requeue each took about 5 s. The owner (18-Nov-2026): every request and trigger on the posting
-- path well under the timeout at 20,000, linear to 50,000.
--
-- What 201 does (the same answers; tests/run_migration201.py compares the final register with the synchronous one):
--   1. The register pass of a big posting (more than 2,000 entries) leaves the triggers: the status trigger (111's
--      tally_post_register_job_changed) and the queue trigger (tally_post_register_queued) only mark the posting
--      (tally_post_register_pending: one row a posting); tally_post_register_step(job, n) does the pass in steps of at most
--      n (2,000) entries: the queue phase (the records of the posting's ids, by key), one preparing step (each voucher and
--      the posting's results, items and marks as maps, kept with the row), then the judge in chunks (199's judge and
--      apply, the same text, on a chunk). Resumable (a cursor), idempotent, one worker a posting (an advisory lock); a
--      change while a pass runs marks it dirty: the pass finishes and runs again. A posting of 2,000 entries or fewer is
--      done in the trigger as before (no change for the usual posting). tally_post_register_apply(job) (tally-ingest after
--      each report) does one step for a big posting. The duplicate guard stays in the queue trigger, as before.
--   2. Each voucher's FinCom id (tally_fincom_id, unchanged) worked out once a voucher in the sync and the pass (it was
--      called two or three times a voucher).
--   3. 199's tally_post_ids_sync: the ids Tally took kept as maps (an array of 20,000 was searched for each id), and only
--      the ids whose live changes are written.
--   4. 182's tally_post_job_read_back: the voucher's date read as 199's judge reads it (no regular expression a voucher).
--   5. 185's tally_post_enqueue_core: the entries other live postings hold found by a hashed lookup (it read every other
--      live posting's vouchers for each voucher queued).
--   6. One cron entry, tally_post_work(): one indexed look when there is nothing to do; else 200's settling (at most 10
--      postings) and register steps, within 25 s; its pg_cron job ('tally-post-settle-itself', 200's name, every minute)
--      and the requeue's ('tally-post-requeue') carry their own statement_timeout.
-- Add-only: one table (row security on; the firm reads), its index; functions replaced from their latest text (named
-- above) or new; nothing dropped, deleted or truncated. One transaction, lock_timeout 10 s, safe twice; service_role
-- only, granted explicitly. No bridge change, no new Tally request.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the register pass in steps
create table if not exists public.tally_post_register_pending (
  job_id      uuid primary key references public.tally_post_jobs(id) on delete cascade,
  firm_id     uuid not null,
  since       timestamptz not null default now(),   -- marked (a pass wanted) since
  by_user     uuid,                                 -- who changed the posting last (the register's changed_by, as the trigger had it)
  queue       boolean not null default false,       -- the queue phase is still to do (the posting's ids' records)
  qcursor     text,                                 -- the queue phase: the last FinCom id done (by key)
  rec         boolean not null default false,       -- queued as a recorded posting (the trigger's rec)
  by_q        uuid,                                 -- who queued it
  vlist       jsonb,                                -- the pass: each voucher [ord, fincom id, entry id, xml], by ord
  maps        jsonb,                                -- the pass: {rm, im, mm}: the posting's results, items and marks by spelling (199's judge)
  cursor      integer not null default 0,           -- the pass: vouchers judged
  total       integer not null default 0,
  dirty       boolean not null default false,       -- changed while the pass ran: run again when it ends
  passes      integer not null default 0,
  last_at     timestamptz,
  done_at     timestamptz,                          -- null: a pass is wanted or running
  words       text
);
create index if not exists tally_post_register_pending_open on public.tally_post_register_pending (since) where done_at is null;
alter table public.tally_post_register_pending enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_register_pending' and policyname = 'tally_post_register_pending_read') then
    create policy tally_post_register_pending_read on public.tally_post_register_pending for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke all on public.tally_post_register_pending from anon;
revoke insert, update, delete, truncate, references, trigger on public.tally_post_register_pending from authenticated;
grant select (job_id, firm_id, since, cursor, total, dirty, passes, last_at, done_at, words) on public.tally_post_register_pending to authenticated;
grant all on public.tally_post_register_pending to service_role;
-- the pass's preparing step: each voucher (199's judge: one a FinCom id, the first by order) and the posting's results, items
-- and marks by spelling, exactly as 199's judge works them out
create or replace function public.tally_post_register_maps(j public.tally_post_jobs)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $maps$
with vs as (
  select z.fid, t.v->>'id' as eid, coalesce(t.v->>'xml', '') as xml, t.o::int as ord
    from jsonb_array_elements(case when jsonb_typeof((j).payload->'vouchers') = 'array' then (j).payload->'vouchers' else '[]'::jsonb end) with ordinality as t(v, o)
   cross join lateral (select case when jsonb_typeof(t.v) = 'object' then tally_fincom_id(t.v) end as fid) z     -- 201: once a voucher
   where jsonb_typeof(t.v) = 'object' and z.fid is not null),
v1 as (
  select distinct on (vs.fid) vs.fid, vs.eid, vs.xml, vs.ord, regexp_replace(vs.fid, '[^A-Za-z0-9]', '', 'g') as kf, regexp_replace(coalesce(vs.eid, ''), '[^A-Za-z0-9]', '', 'g') as ke
    from vs order by vs.fid, vs.ord),
rs as (
  select t.r, t.o::int as ord, regexp_replace(t.r->>'id', '[^A-Za-z0-9]', '', 'g') as k,
         (row_number() over (partition by t.r->>'sentAt', t.r->>'batchEnd', t.r->>'batchN' order by t.o))::int - 1 as pos,
         (count(*) over (partition by t.r->>'sentAt', t.r->>'batchEnd', t.r->>'batchN'))::int as gn
    from jsonb_array_elements(case when jsonb_typeof((j).results) = 'array' then (j).results else '[]'::jsonb end) with ordinality as t(r, o)
   where jsonb_typeof(t.r) = 'object' and coalesce(t.r->>'id', '') <> '' and coalesce(t.r->>'kind', '') <> 'master'),
its as (
  select t.i, regexp_replace(t.i->>'id', '[^A-Za-z0-9]', '', 'g') as k, t.o::int as ord
    from jsonb_array_elements(case when jsonb_typeof((j).items) = 'array' then (j).items else '[]'::jsonb end) with ordinality as t(i, o)
   where jsonb_typeof(t.i) = 'object' and coalesce(t.i->>'id', '') <> ''),
-- 199: per spelling, the last result, the first item and the last mark, each found once; a voucher takes the later
-- result (the earlier item, the later mark) of its two spellings, by equality, as the pair-by-pair scan chose them
rl as (select distinct on (rs.k) rs.k, rs.r, rs.pos, rs.gn, rs.ord from rs where rs.k <> '' order by rs.k, rs.ord desc),
il as (select distinct on (its.k) its.k, its.i, its.ord from its where its.k <> '' order by its.k, its.ord),
ml as (select distinct on (k) regexp_replace(m.entry_id, '[^A-Za-z0-9]', '', 'g') as k, m.action, m.vch, m.note, m.by_user, m.at, m.id
         from tally_post_marks m where m.job_id = (j).id order by k, m.at desc, m.id desc),
-- each kept as one object keyed by spelling and looked up by key (a join of these to the vouchers was planned row by row:
-- the planner takes jsonb_array_elements for 100 rows); b to e materialized: inlined, each later use of a column recomputed
-- its whole expression (20,000 entries took some 100 s)
rm as materialized (select coalesce(jsonb_object_agg(rl.k, jsonb_build_object('r', rl.r, 'pos', rl.pos, 'gn', rl.gn, 'ord', rl.ord)), '{}'::jsonb) as m from rl),
im as materialized (select coalesce(jsonb_object_agg(il.k, jsonb_build_object('i', il.i, 'ord', il.ord)), '{}'::jsonb) as m from il),
mm as materialized (select coalesce(jsonb_object_agg(ml.k, jsonb_build_object('action', ml.action, 'vch', ml.vch, 'note', ml.note, 'by_user', ml.by_user, 'at', ml.at, 'id', ml.id)), '{}'::jsonb) as m from ml)
select jsonb_build_object('v', (select coalesce(jsonb_agg(jsonb_build_array(v1.ord, v1.fid, v1.eid, v1.xml) order by v1.ord), '[]'::jsonb) from v1),
                          'rm', (select rm.m from rm), 'im', (select im.m from im), 'mm', (select mm.m from mm))
$maps$;
revoke all on function public.tally_post_register_maps(public.tally_post_jobs) from public, anon, authenticated;
grant execute on function public.tally_post_register_maps(public.tally_post_jobs) to service_role;
-- 199's judge on a chunk of the posting's vouchers (the rest of its text the same)
create or replace function public.tally_post_register_judged_part(j public.tally_post_jobs, p_v jsonb, p_rm jsonb, p_im jsonb, p_mm jsonb)
returns table (fincom_id text, entry_id text, ord integer, state text, source text, master_id text, id_inferred boolean, words text,
               by_user uuid, at timestamptz, vch_type text, vch_no text, vch_date date, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $judge$
-- 201: the vouchers of this chunk ([ord, fincom id, entry id, xml]) and the maps of the pass (tally_post_register_maps)
with v1 as (
  select (x->>0)::int as ord, x->>1 as fid, x->>2 as eid, coalesce(x->>3, '') as xml,
         regexp_replace(x->>1, '[^A-Za-z0-9]', '', 'g') as kf, regexp_replace(coalesce(x->>2, ''), '[^A-Za-z0-9]', '', 'g') as ke
    from jsonb_array_elements(coalesce(p_v, '[]'::jsonb)) x),
rm as materialized (select coalesce(p_rm, '{}'::jsonb) as m),
im as materialized (select coalesce(p_im, '{}'::jsonb) as m),
mm as materialized (select coalesce(p_mm, '{}'::jsonb) as m),
b as materialized (
  select v1.fid, v1.eid, v1.ord, v1.xml, r.r, r.pos, r.gn, it.i,
         mk.action as mk_action, mk.vch as mk_vch, mk.note as mk_note, mk.by_user as mk_by, mk.at as mk_at,
         pid.accepted_at, pid.released_at, pid.released_by, pid.matched_at, pid.matched_mid, pid.live as pid_live,
         ((j).status in ('waiting', 'taken', 'running') and (jsonb_typeof((j).resend_only) is distinct from 'array' or jsonb_array_length((j).resend_only) = 0
            or (j).resend_only ? coalesce(v1.eid, '') or (j).resend_only ? v1.fid)) as in_scope
    from v1
    -- (each map an uncorrelated subquery: worked out once; a join to it copied the whole map for every voucher)
    cross join lateral (select (select rm.m from rm) -> v1.kf as ra, (select rm.m from rm) -> v1.ke as rb, (select im.m from im) -> v1.kf as ia,
                               (select im.m from im) -> v1.ke as ib, (select mm.m from mm) -> v1.kf as ma, (select mm.m from mm) -> v1.ke as mb) z
    cross join lateral (select case when z.rb is not null and (z.ra is null or (z.rb->>'ord')::int > (z.ra->>'ord')::int) then z.rb else z.ra end as x) rx
    cross join lateral (select rx.x->'r' as r, (rx.x->>'pos')::int as pos, (rx.x->>'gn')::int as gn) r
    cross join lateral (select case when z.ib is not null and (z.ia is null or (z.ib->>'ord')::int < (z.ia->>'ord')::int) then z.ib else z.ia end -> 'i' as i) it
    left join lateral (select x.action, x.vch, x.note, x.by_user, x.at from (values (z.ma->>'action', z.ma->>'vch', z.ma->>'note', (z.ma->>'by_user')::uuid, (z.ma->>'at')::timestamptz, (z.ma->>'id')::bigint),
                                                                                (z.mb->>'action', z.mb->>'vch', z.mb->>'note', (z.mb->>'by_user')::uuid, (z.mb->>'at')::timestamptz, (z.mb->>'id')::bigint))
                                 as x(action, vch, note, by_user, at, id) where x.id is not null order by x.at desc, x.id desc limit 1) mk on true
    left join lateral (select p.accepted_at, p.released_at, p.released_by, p.matched_at, p.matched_mid, p.live from tally_post_ids p
                        where p.job_id = (j).id and p.fincom_id = v1.fid limit 1) pid on true),
c as materialized (
  select b.*,
         (b.r is not null and lower(coalesce(b.r->>'byOwner', '')) in ('true', 't', '1')) or (b.i is not null and lower(coalesce(b.i->>'byOwner', '')) in ('true', 't', '1')) as own,
         case when b.r->>'batchN' ~ '^\d{1,6}$' then (b.r->>'batchN')::int else 0 end as n,
         case when b.r->>'created' ~ '^\d{1,9}$' then (b.r->>'created')::int else 0 end as created,
         case when b.r->>'altered' ~ '^\d{1,9}$' then (b.r->>'altered')::int else 0 end as altered,
         case when b.r->>'errors' ~ '^\d{1,9}$' then (b.r->>'errors')::int else 0 end as errs,
         case when b.r->>'exceptions' ~ '^\d{1,9}$' then (b.r->>'exceptions')::int else 0 end as excs,
         case when jsonb_typeof(b.r->'lineError') = 'array' then (select nullif(string_agg(x.t, '; '), '') from jsonb_array_elements_text(b.r->'lineError') as x(t) where x.t <> '')
              else nullif(b.r->>'lineError', '') end as le,
         coalesce(nullif(b.r->>'batchEnd', ''), nullif(b.r->>'lastVchId', '')) as lv,
         (tally_post_bool(b.r->>'byReply') or tally_post_bool(b.r->>'needsReview')) as has_reply
    from b),
d as materialized (
  select c.*,
         (c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n >= 1 and c.created = c.n) as clean,
         case when c.r is null then null
              when tally_post_bool(c.r->>'alreadySent') then 'needs_review'                                    -- the bridge's own record: sent before
              when tally_post_bool(c.r->>'refused') and tally_post_bool(c.r->>'postOnly') then 'refused'       -- refused by the bridge, nothing sent
              when c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n = 1 and c.created = 1 and coalesce(c.lv, '') ~ '^\d+$' then 'in_tally'
              when c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n > 1 and c.created = c.n then 'in_tally'
              when c.has_reply and c.created = 0 and c.altered = 0 and (c.errs + c.excs > 0 or c.le is not null) then 'refused'
              when c.has_reply then 'needs_review'                                                             -- the proof's rule: never in_tally
              when tally_post_bool(c.r->>'outcomeUnknown') or c.r->>'state' in ('unknown', 'sent') or tally_post_bool(c.r->>'sent') then
                   case when tally_post_bool(c.r->>'ok') and tally_post_bool(c.r->>'verified') then 'in_tally' else 'needs_review' end
              when tally_post_bool(c.r->>'ok') and (tally_post_bool(c.r->>'verified') or c.r->>'state' = 'in_tally' or tally_post_bool(c.r->>'already') or tally_post_bool(c.r->>'alreadyThere')) then 'in_tally'
              when tally_post_bool(c.r->>'ok') then 'needs_review'                                             -- an older bridge: posted, not read back
              when tally_post_bool(c.r->>'already') or coalesce(c.r->>'message', '') ~* '^Already in Tally \(voucher no\.' then 'in_tally'
              when tally_post_result_accepted(c.r) then 'needs_review'                                        -- Tally accepted it, unconfirmed
              else 'refused' end as rstate
    from c),
e as materialized (
  select d.*,
         case
           -- a person's word on this posting (Mark posted, Not in Tally): the mark, unless the bridge reported the entry again since
           when d.own or (d.r is null and d.mk_action is not null and not d.in_scope) then
             case when d.mk_action = 'posted' then 'in_tally' when d.mk_action = 'released' then 'released'
                  when coalesce(d.r->>'state', d.i->>'state') = 'in_tally' then 'in_tally' when coalesce(d.r->>'state', d.i->>'state') = 'notfound' then 'released' else 'needs_review' end
           when d.rstate is not null then d.rstate
           when d.i is not null and d.i->>'state' in ('in_tally', 'posted') then 'in_tally'
           when d.i is not null and d.i->>'state' in ('needs_review', 'unknown') then 'needs_review'
           when d.i is not null and d.i->>'state' in ('failed', 'notfound') then case when tally_post_accept_text(d.i->>'reason') then 'needs_review' else 'refused' end
           when (j).status = 'waiting' then 'queued'
           when (j).status in ('taken', 'running') then 'sent'
           -- (174, fifth review H1) cancelled after its bridge had it, the id kept live (tally_post_cancel): it may be in Tally
           when (j).status = 'cancelled' and coalesce(d.pid_live, false) and d.released_at is null then 'needs_review'
           when (j).status = 'cancelled' and (j).taken_at is null then 'released'
           when (j).status in ('failed', 'cancelled') and (j).taken_at is null then 'refused'
           else 'needs_review' end as s0,
         case when d.own or (d.r is null and d.mk_action is not null and not d.in_scope) then 'owner'
              when d.rstate is not null or (d.i is not null and d.i->>'state' in ('in_tally', 'posted', 'needs_review', 'unknown', 'failed', 'notfound')) then 'reply'
              else 'status' end as src0
    from d),
f as (
  select e.*,
         case when e.in_scope and (j).status = 'waiting' and e.s0 not in ('in_tally', 'needs_review') then 'queued'
              when e.in_scope and (j).status in ('taken', 'running') and e.s0 in ('released', 'queued') then 'sent'
              when e.matched_at is not null and e.s0 in ('needs_review', 'refused', 'sent', 'in_tally') and e.src0 <> 'owner' then 'in_tally'
              when e.accepted_at is not null and e.released_at is null and e.s0 = 'refused' and e.src0 <> 'owner' then 'needs_review'
              when e.released_by = 'owner' and e.released_at is not null and e.mk_action is null and e.src0 <> 'owner' and e.s0 <> 'in_tally' and not e.in_scope then 'released'
              else e.s0 end as st
    from e)
-- 199: each voucher field read from its XML at the tag's first place with plain string functions (what the pattern captures
-- there: the text up to the next '<' or '"', of the pattern's length, then its closing tag); anything else by the pattern over
-- the whole XML as before: the same answer (each pattern begins with its tag), without a regular expression for every
-- voucher (20,000 vouchers: some 6 s)
select f.fid, f.eid, f.ord, f.st,
       case when f.in_scope and f.st in ('queued', 'sent') and f.s0 <> f.st then 'status'
            when f.matched_at is not null and f.st = 'in_tally' and f.src0 <> 'owner' then 'recorder'
            when f.src0 = 'owner' and coalesce(f.mk_note, '') like 'Found in % by the FinCom Bridge%' then 'bridge'
            when f.released_by = 'owner' and f.st = 'released' and f.src0 <> 'owner' and f.s0 <> 'released' then 'owner'
            else f.src0 end,
       case when f.st <> 'in_tally' then null
            when f.src0 = 'owner' then coalesce(nullif(btrim(f.mk_vch), ''), nullif(f.r->>'vchNumber', ''))
            when f.matched_at is not null and nullif(f.matched_mid, '') is not null then f.matched_mid
            when f.has_reply and f.n = 1 then coalesce(nullif(f.r->>'vchId', ''), f.lv)
            when f.has_reply and f.n > 1 and f.gn = f.n and coalesce(f.lv, '') ~ '^\d{1,18}$' then (f.lv::bigint - (f.n - 1 - f.pos))::text
            when f.has_reply then null
            else coalesce(nullif(f.r->>'masterId', ''), nullif(f.matched_mid, '')) end,
       (f.st = 'in_tally' and f.src0 = 'reply' and f.has_reply and f.n > 1 and f.matched_at is null),
       case when f.src0 = 'owner' and f.st in ('in_tally', 'released', 'needs_review') then left(coalesce(nullif(f.mk_note, ''), nullif(f.r->>'reason', ''), nullif(f.i->>'reason', '')), 1000)
            when f.st in ('in_tally', 'queued', 'sent') then null
            else left(coalesce(nullif(f.r->>'message', ''), f.le, nullif(f.r->>'reason', ''), nullif(f.i->>'reason', ''),
                               case when f.st = 'released' and f.released_why is not null then f.released_why end, nullif((j).message, '')), 1000) end,
       case when f.src0 = 'owner' then f.mk_by end,
       case when f.src0 = 'owner' then f.mk_at end,
       coalesce(nullif(f.r->>'vchType', ''), nullif(case when strpos(f.xml, '<VOUCHERTYPENAME>') = 0 then null when length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17, 101), '<', 1)) between 1 and 100 and substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17 + length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17, 101), '<', 1)), 18) = '</VOUCHERTYPENAME>' then split_part(substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17, 101), '<', 1) else substring(f.xml from '<VOUCHERTYPENAME>([^<]{1,100})</VOUCHERTYPENAME>') end, ''), nullif(case when strpos(f.xml, 'VCHTYPE="') = 0 then null when length(split_part(substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9, 101), '"', 1)) between 1 and 100 and substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9 + length(split_part(substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9, 101), '"', 1)), 1) = '"' then split_part(substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9, 101), '"', 1) else substring(f.xml from 'VCHTYPE="([^"]{1,100})"') end, '')),
       coalesce(nullif(f.r->>'vchNumber', ''), nullif(f.r->>'vchNo', ''), nullif(case when strpos(f.xml, '<VOUCHERNUMBER>') = 0 then null when length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15, 61), '<', 1)) between 1 and 60 and substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15 + length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15, 61), '<', 1)), 16) = '</VOUCHERNUMBER>' then split_part(substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15, 61), '<', 1) else substring(f.xml from '<VOUCHERNUMBER>([^<]{1,60})</VOUCHERNUMBER>') end, '')),
       case when coalesce(nullif(f.r->>'vchDate', ''), case when strpos(f.xml, '<DATE>') = 0 then null when length(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8)) = 8 and translate(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8), '0123456789', '') = '' and substr(f.xml, strpos(f.xml, '<DATE>') + 14, 7) = '</DATE>' then substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8) else substring(f.xml from '<DATE>(\d{8})</DATE>') end) ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$'
            then to_date(coalesce(nullif(f.r->>'vchDate', ''), case when strpos(f.xml, '<DATE>') = 0 then null when length(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8)) = 8 and translate(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8), '0123456789', '') = '' and substr(f.xml, strpos(f.xml, '<DATE>') + 14, 7) = '</DATE>' then substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8) else substring(f.xml from '<DATE>(\d{8})</DATE>') end), 'YYYYMMDD') end,
       (select max(abs(m.a[1]::numeric)) from regexp_matches(f.xml, '<AMOUNT>\s*(-?\d{1,15}(?:\.\d{1,4})?)\s*</AMOUNT>', 'g') as m(a))
  from (select f0.*, (select p.released_why from tally_post_ids p where p.job_id = (j).id and p.fincom_id = f0.fid limit 1) as released_why from f f0) f
 order by f.ord
$judge$;
revoke all on function public.tally_post_register_judged_part(public.tally_post_jobs, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_post_register_judged_part(public.tally_post_jobs, jsonb, jsonb, jsonb, jsonb) to service_role;
-- 199's apply on a chunk: the same steps for the records of these vouchers (found by their FinCom ids)
create or replace function public.tally_post_register_apply_part(j public.tally_post_jobs, p_by uuid, p_v jsonb, p_rm jsonb, p_im jsonb, p_mm jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp set plan_cache_mode = force_custom_plan as $fn$
declare xs jsonb; xm jsonb; fa text[] := array(select x->>1 from jsonb_array_elements(coalesce(p_v, '[]'::jsonb)) x); n integer := 0; k integer; bk uuid := tally_post_register_book(j.firm_id, j.company);
begin
  -- the judged rows, and the same keyed by FinCom id (looked up by key: a join to the rows was planned row by row)
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb), coalesce(jsonb_object_agg(t.fincom_id, to_jsonb(t)), '{}'::jsonb) into xs, xm from tally_post_register_judged_part(j, p_v, p_rm, p_im, p_mm) t;
  -- the records this posting holds, locked in one order (j.id is never null: the posting's own records, by its index)
  perform 1 from tally_post_register r
   where r.firm_id = j.firm_id and r.fincom_id = any(fa) and r.job_id = j.id and xm ? r.fincom_id
   order by r.id for update;
  -- put's first step: the voucher's own details fill what is missing, whatever the state (only where a value changes)
  with x as (select r.id, xm -> r.fincom_id as more, r.vch_type, r.vch_no, r.vch_date, r.amount, r.kind from tally_post_register r
              where r.firm_id = j.firm_id and r.fincom_id = any(fa) and r.job_id = j.id and xm ? r.fincom_id and (r.vch_type is null or r.vch_no is null or r.vch_date is null or r.amount is null or r.kind is null)),
  v as (select x.id, coalesce(x.vch_type, nullif(x.more->>'vch_type', '')) a1, coalesce(x.vch_no, nullif(x.more->>'vch_no', '')) a2,
               coalesce(x.vch_date, case when x.more->>'vch_date' ~ '^\d{4}-\d\d-\d\d$' then (x.more->>'vch_date')::date end) a3,
               coalesce(x.amount, case when x.more->>'amount' ~ '^-?\d+(\.\d+)?$' then (x.more->>'amount')::numeric end) a4,
               coalesce(x.kind, nullif(tally_post_register_kind(x.more->>'vch_type'), '')) a5
          from x)
  update tally_post_register r set vch_type = v.a1, vch_no = v.a2, vch_date = v.a3, amount = v.a4, kind = v.a5
    from v where r.id = v.id
     and (r.vch_type is distinct from v.a1 or r.vch_no is distinct from v.a2 or r.vch_date is distinct from v.a3 or r.amount is distinct from v.a4 or r.kind is distinct from v.a5);
  -- put's rule: allowed (a new attempt replaces only queued, sent, refused, released; else the stronger source), and only
  -- when something changes; then the record and its history row
  with x as (select t.fincom_id, t.state, t.source, coalesce(t.by_user, p_by) as by_, nullif(left(btrim(coalesce(t.master_id, '')), 60), '') as m,
                    t.id_inferred, nullif(left(btrim(coalesce(t.words, '')), 1000), '') as w
               from jsonb_to_recordset(xs) as t(fincom_id text, state text, source text, by_user uuid, master_id text, id_inferred boolean, words text)),
  c as (select r.id, r.state as gstate, x.*
          from tally_post_register r join x on r.firm_id = j.firm_id and r.fincom_id = x.fincom_id
         where r.job_id is not distinct from j.id
           and case when x.state in ('queued', 'sent') then r.state in ('queued', 'sent', 'refused', 'released')
                    when r.state in ('queued', 'sent') then true
                    else tally_post_register_rank(x.source) >= tally_post_register_rank(r.source) end
           and not (r.state = x.state and r.master_id is not distinct from coalesce(x.m, case when x.state = 'in_tally' then r.master_id end) and r.id_inferred = coalesce(x.id_inferred, false)
                    and r.tally_words is not distinct from x.w and r.job_id is not distinct from coalesce(j.id, r.job_id)
                    and (r.source = x.source or tally_post_register_rank(x.source) <= tally_post_register_rank(r.source)))),
  u as (update tally_post_register r set state = c.state, source = c.source, changed_by = c.by_, changed_at = now(),
               master_id = case when c.state = 'in_tally' then coalesce(c.m, case when r.state = 'in_tally' then r.master_id end) when c.state in ('queued') then null else coalesce(c.m, r.master_id) end,
               id_inferred = case when c.state = 'in_tally' then coalesce(c.id_inferred, false) and not (c.m is null and r.state = 'in_tally' and not r.id_inferred and r.master_id is not null) else false end,
               tally_words = c.w, job_id = coalesce(j.id, r.job_id),
               sent_at = case when c.state = 'sent' then coalesce(r.sent_at, now()) else r.sent_at end,
               settled_at = case when c.state in ('in_tally', 'refused', 'released') then now() else null end
          from c where r.id = c.id
        returning r.id, r.firm_id, r.fincom_id, r.state, r.job_id, r.master_id, r.id_inferred, r.tally_words, c.by_, c.source as src, c.gstate)
  insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
  select u.id, u.firm_id, u.fincom_id, u.by_, u.src, u.gstate, u.state, u.job_id, u.master_id, u.id_inferred, u.tally_words, null from u order by u.id;
  get diagnostics k = row_count; n := n + k;
  -- a record missing (an entry FinCom has no record of yet): made, with its history row
  with t as (select * from jsonb_to_recordset(xs) as t(fincom_id text, entry_id text, ord integer, state text, source text, master_id text, id_inferred boolean, words text,
                                                       by_user uuid, vch_type text, vch_no text, vch_date date, amount numeric)),
  ins as (insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, kind, company, book_id, state, master_id, id_inferred, vch_type, vch_no, vch_date, amount, tally_words,
                                           job_id, source, changed_by, queued_by, queued_at, sent_at, settled_at)
          select j.firm_id, j.client_id, t.fincom_id, t.entry_id, tally_post_register_kind(t.vch_type), j.company, bk, t.state, t.master_id, coalesce(t.id_inferred, false), t.vch_type, t.vch_no, t.vch_date, t.amount, t.words,
                 j.id, t.source, coalesce(t.by_user, p_by), j.created_by, j.created_at, case when t.state <> 'queued' then coalesce(j.taken_at, j.updated_at) end,
                 case when t.state in ('in_tally', 'refused', 'released') then now() end
            from t where not exists (select 1 from tally_post_register r where r.firm_id = j.firm_id and r.fincom_id = t.fincom_id)
           order by t.ord
          on conflict (firm_id, fincom_id) do nothing returning *)
  insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
  select ins.id, ins.firm_id, ins.fincom_id, ins.changed_by, ins.source, null, ins.state, ins.job_id, ins.master_id, ins.id_inferred, ins.tally_words, 'recorded from posting ' || j.id
    from ins order by ins.id;
  get diagnostics k = row_count; n := n + k;
  return n;
end $fn$;
revoke all on function public.tally_post_register_apply_part(public.tally_post_jobs, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_post_register_apply_part(public.tally_post_jobs, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
-- 199's queue trigger after its guard (the queued-again records and the new ones, with their history), for some ids of one
-- posting: the same text; who queued it (p_by) and the trigger's rec given
create or replace function public.tally_post_register_queue_part(j public.tally_post_jobs, p_fids text[], p_rec boolean, p_by uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp set plan_cache_mode = force_custom_plan as $fn$
declare x record;
begin
    -- queued again (a refusal, a release, or a posting recorded after the fact): back to queued, forced, as before
    for x in select nw.*, g2.id as gid from (select * from tally_post_ids i where i.job_id = j.id and i.fincom_id = any(p_fids)) nw
                join tally_post_register g2 on g2.firm_id = nw.firm_id and g2.fincom_id = nw.fincom_id
              where g2.job_id is distinct from nw.job_id order by nw.job_id, nw.fincom_id loop
      perform tally_post_register_put(x.gid, 'queued', 'queue', p_by, x.job_id, null, false, null,
        case when p_rec then 'recorded posting ' else 'queued again in posting ' end || x.job_id, true,
        jsonb_build_object('company', j.company, 'book_id', tally_post_register_book(j.firm_id, j.company), 'client_id', j.client_id, 'entry_id', x.entry_id));
    end loop;
    -- new: the record and its history row
    with ins as (insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, company, book_id, state, job_id, source, changed_by, queued_by, queued_at)
                 select nw.firm_id, nw.client_id, nw.fincom_id, nw.entry_id, j.company, tally_post_register_book(j.firm_id, j.company), 'queued', nw.job_id, 'queue',
                        p_by, p_by, now()
                   from (select * from tally_post_ids i where i.job_id = j.id and i.fincom_id = any(p_fids)) nw where not exists (select 1 from tally_post_register r where r.firm_id = nw.firm_id and r.fincom_id = nw.fincom_id)
                  order by nw.job_id, nw.fincom_id
                 on conflict (firm_id, fincom_id) do nothing returning *)
    insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, note)
    select ins.id, ins.firm_id, ins.fincom_id, ins.changed_by, 'queue', null, 'queued', ins.job_id, 'queued in posting ' || ins.job_id from ins order by ins.id;
  return coalesce(array_length(p_fids, 1), 0);
end $fn$;
revoke all on function public.tally_post_register_queue_part(public.tally_post_jobs, text[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_queue_part(public.tally_post_jobs, text[], boolean, uuid) to service_role;
-- a pass wanted for a posting (from its triggers, or tally_post_register_apply): a pass running is marked dirty (it ends,
-- then runs again); else it starts afresh. p_queue: the queue phase too (its ids' records), with the trigger's rec and who
create or replace function public.tally_post_register_mark(p_job uuid, p_firm uuid, p_by uuid, p_queue boolean, p_rec boolean, p_by_q uuid)
returns void language sql security definer set search_path = public, pg_temp as $function$
  insert into tally_post_register_pending as p (job_id, firm_id, since, by_user, queue, qcursor, rec, by_q, words)
  values (p_job, p_firm, now(), p_by, coalesce(p_queue, false), null, coalesce(p_rec, false), p_by_q, 'FinCom''s posting register follows this posting by itself')
  on conflict (job_id) do update set
    by_user = excluded.by_user,
    queue = p.queue or excluded.queue,
    qcursor = case when excluded.queue and not p.queue then null else p.qcursor end,
    rec = case when excluded.queue then excluded.rec else p.rec end,
    by_q = case when excluded.queue then excluded.by_q else p.by_q end,
    dirty = p.done_at is null and p.vlist is not null,
    since = case when p.done_at is null then p.since else now() end,
    cursor = case when p.done_at is null then p.cursor else 0 end,
    vlist = case when p.done_at is null then p.vlist end,
    maps = case when p.done_at is null then p.maps end,
    done_at = null
$function$;
revoke all on function public.tally_post_register_mark(uuid, uuid, uuid, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_mark(uuid, uuid, uuid, boolean, boolean, uuid) to service_role;

-- one step of a posting's pass (the posting named, else the one marked longest ago that no other worker holds): the queue
-- phase (at most p_n ids, by key), the preparing step, or the judge of at most p_n vouchers. Never two workers on one
-- posting (an advisory lock for the step's transaction); the cursor kept with the row; safe to run again
-- (each statement planned for its own arguments: the cron runs many steps in one session, and a plan cached for one
-- posting's ids would be a bad one for another's)
create or replace function public.tally_post_register_step(p_job uuid default null, p_n integer default 2000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set plan_cache_mode = force_custom_plan as $fn$
declare pr tally_post_register_pending%rowtype; j tally_post_jobs%rowtype; got boolean := false; n integer := greatest(1, least(coalesce(p_n, 2000), 5000));
        m jsonb; v jsonb; fa text[]; c integer; newc integer; last_ text; k integer;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  for pr in select * from tally_post_register_pending p where p.done_at is null and (p_job is null or p.job_id = p_job) order by p.since limit 20 loop
    if pg_try_advisory_xact_lock(hashtextextended('tally_post_register_pass ' || pr.job_id::text, 0)) then got := true; exit; end if;
  end loop;
  if not got then return jsonb_build_object('ok', true, 'idle', true); end if;
  select * into pr from tally_post_register_pending p where p.job_id = pr.job_id;     -- as it is now, under the lock
  if pr.done_at is not null then return jsonb_build_object('ok', true, 'job', pr.job_id, 'done', true); end if;
  select * into j from tally_post_jobs where id = pr.job_id;
  if not found then
    update tally_post_register_pending set done_at = now(), vlist = null, maps = null, words = 'the posting is no longer in FinCom' where job_id = pr.job_id;
    return jsonb_build_object('ok', true, 'job', pr.job_id, 'gone', true);
  end if;
  -- the queue phase: the posting's ids by key, at most n a step (199's queue trigger after its guard)
  if pr.queue then
    select array_agg(i.fincom_id order by i.fincom_id) into fa from (select i0.fincom_id from tally_post_ids i0 where i0.job_id = j.id and (pr.qcursor is null or i0.fincom_id > pr.qcursor)
                                                                     order by i0.fincom_id limit n) i;
    if fa is not null then perform tally_post_register_queue_part(j, fa, pr.rec, pr.by_q); last_ := fa[array_length(fa, 1)]; end if;
    if fa is null or array_length(fa, 1) < n then
      update tally_post_register_pending set queue = false, qcursor = null, last_at = now(), words = 'FinCom''s posting register: the entries recorded; their states follow' where job_id = j.id;
    else
      update tally_post_register_pending set qcursor = last_, last_at = now(), words = 'FinCom''s posting register: recording the entries' where job_id = j.id;
    end if;
    return jsonb_build_object('ok', true, 'job', j.id, 'phase', 'queue', 'n', coalesce(array_length(fa, 1), 0));
  end if;
  -- the preparing step: each voucher and the maps, kept for the pass
  if pr.vlist is null then
    m := tally_post_register_maps(j);
    update tally_post_register_pending set vlist = m->'v', maps = m - 'v', total = jsonb_array_length(m->'v'), cursor = 0, last_at = now(),
           words = 'FinCom''s posting register is catching up: 0 of ' || jsonb_array_length(m->'v') where job_id = j.id;
    return jsonb_build_object('ok', true, 'job', j.id, 'phase', 'prepare', 'total', jsonb_array_length(m->'v'));
  end if;
  -- the judge of the next chunk
  newc := least(pr.cursor + n, pr.total);
  v := jsonb_path_query_array(pr.vlist, ('$[' || pr.cursor || ' to ' || (newc - 1) || ']')::jsonpath);
  if pr.total = 0 then v := '[]'::jsonb; end if;
  c := tally_post_register_apply_part(j, pr.by_user, v, pr.maps->'rm', pr.maps->'im', pr.maps->'mm');
  if newc >= pr.total then
    update tally_post_register_pending p set cursor = 0, vlist = null, maps = null, done_at = case when p.dirty then null else now() end, dirty = false,
           passes = p.passes + 1, last_at = now(),
           words = case when p.dirty then 'FinCom''s posting register: the posting changed meanwhile; following it again' else 'FinCom''s posting register follows this posting' end
     where p.job_id = j.id;
  else
    update tally_post_register_pending set cursor = newc, last_at = now(), words = 'FinCom''s posting register is catching up: ' || newc || ' of ' || pr.total where job_id = j.id;
  end if;
  return jsonb_build_object('ok', true, 'job', j.id, 'phase', 'judge', 'done', newc, 'of', pr.total, 'changed', c, 'finished', newc >= pr.total);
end $fn$;
revoke all on function public.tally_post_register_step(uuid, integer) from public, anon, authenticated;
grant execute on function public.tally_post_register_step(uuid, integer) to service_role;

-- 111's status trigger: a posting of 2,000 entries or fewer as before (the pass now); a bigger one is marked, its pass done
-- in steps (tally_post_register_step: tally-ingest after each report, and the cron)
create or replace function public.tally_post_register_job_changed() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if coalesce(jsonb_array_length(case when jsonb_typeof(new.payload->'vouchers') = 'array' then new.payload->'vouchers' end), 0) <= coalesce(nullif(current_setting('fincom.register_sync_max', true), '')::int, 2000) then
    perform tally_post_register_apply_row(new, auth.uid());
  else
    perform tally_post_register_mark(new.id, new.firm_id, auth.uid(), false, false, null);
  end if;
  return null;
end $fn$;
revoke all on function public.tally_post_register_job_changed() from public, anon, authenticated;
grant execute on function public.tally_post_register_job_changed() to service_role;

-- 111's tally_post_register_apply (tally-ingest after each report): as before for a posting of 2,000 entries or fewer;
-- a bigger one: marked, and one step of its pass
create or replace function public.tally_post_register_apply(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare j tally_post_jobs%rowtype; n integer; s jsonb;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such posting'); end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(j.payload->'vouchers') = 'array' then j.payload->'vouchers' end), 0) <= coalesce(nullif(current_setting('fincom.register_sync_max', true), '')::int, 2000) then
    n := tally_post_register_apply_row(j, null);
    return jsonb_build_object('ok', true, 'changed', n,
      'states', (select coalesce(jsonb_object_agg(s0.state, s0.k), '{}'::jsonb) from (select r.state, count(*) k from tally_post_register r where r.job_id = p_job group by r.state) s0));
  end if;
  perform tally_post_register_mark(j.id, j.firm_id, null, false, false, null);
  s := tally_post_register_step(j.id, 2000);
  return jsonb_build_object('ok', true, 'changed', coalesce((s->>'changed')::int, 0), 'step', s);
end $fn$;
revoke all on function public.tally_post_register_apply(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_apply(uuid) to service_role;
-- 199's queue trigger: the same; after the duplicate guard, a posting of more than 2,000 ids is marked (its records and pass in steps)
create or replace function public.tally_post_register_queued() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare x record; g tally_post_register%rowtype; j tally_post_jobs%rowtype; rec boolean; jobs uuid[] := '{}'; bad record; one boolean;
begin
  select count(distinct nw.job_id) <= 1 and count(*) = count(distinct (nw.firm_id, nw.fincom_id)) into one from nw;
  if one then
    select * into j from tally_post_jobs where id = (select nw.job_id from nw limit 1);
    if not found then return null; end if;
    rec := coalesce(j.payload->>'recorded', '') = 'true' or j.status in ('done', 'failed');
    -- the records of these ids, locked in one order (the loop locked each in turn)
    perform 1 from tally_post_register r join nw on r.firm_id = nw.firm_id and r.fincom_id = nw.fincom_id order by r.id for update of r;
    if not rec then
      select nw.entry_id, nw.fincom_id, g2.state, g2.job_id into bad
        from nw join tally_post_register g2 on g2.firm_id = nw.firm_id and g2.fincom_id = nw.fincom_id
       where g2.job_id is distinct from nw.job_id and g2.state in ('queued', 'sent', 'in_tally', 'needs_review')
       order by nw.job_id, nw.fincom_id limit 1;
      if found then
        raise exception 'Not queued: % is already % in FinCom''s posting register (posting %). %', coalesce(bad.entry_id, bad.fincom_id),
          case bad.state when 'in_tally' then 'in Tally' when 'needs_review' then 'waiting for review' when 'sent' then 'with the Tally computer' else 'waiting to be sent' end,
          left(coalesce(bad.job_id::text, '?'), 8),
          case bad.state when 'in_tally' then 'It is not posted twice.' when 'needs_review' then 'Settle it first: Mark posted, or Not in Tally.' else 'Wait for that posting to finish.' end
          using errcode = 'P0001';
      end if;
    end if;
    -- 201: a posting of more than 2,000 ids: the rest (the records and the register's pass) in steps (tally_post_register_step)
    if (select count(*) from nw) > coalesce(nullif(current_setting('fincom.register_sync_max', true), '')::int, 2000) then
      perform tally_post_register_mark(j.id, j.firm_id, coalesce(auth.uid(), j.created_by), true, rec, coalesce(auth.uid(), j.created_by));
      return null;
    end if;
    -- queued again (a refusal, a release, or a posting recorded after the fact): back to queued, forced, as before
    for x in select nw.*, g2.id as gid from nw join tally_post_register g2 on g2.firm_id = nw.firm_id and g2.fincom_id = nw.fincom_id
              where g2.job_id is distinct from nw.job_id order by nw.job_id, nw.fincom_id loop
      perform tally_post_register_put(x.gid, 'queued', 'queue', coalesce(auth.uid(), j.created_by), x.job_id, null, false, null,
        case when rec then 'recorded posting ' else 'queued again in posting ' end || x.job_id, true,
        jsonb_build_object('company', j.company, 'book_id', tally_post_register_book(j.firm_id, j.company), 'client_id', j.client_id, 'entry_id', x.entry_id));
    end loop;
    -- new: the record and its history row
    with ins as (insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, company, book_id, state, job_id, source, changed_by, queued_by, queued_at)
                 select nw.firm_id, nw.client_id, nw.fincom_id, nw.entry_id, j.company, tally_post_register_book(j.firm_id, j.company), 'queued', nw.job_id, 'queue',
                        coalesce(auth.uid(), j.created_by), coalesce(auth.uid(), j.created_by), now()
                   from nw where not exists (select 1 from tally_post_register r where r.firm_id = nw.firm_id and r.fincom_id = nw.fincom_id)
                  order by nw.job_id, nw.fincom_id
                 on conflict (firm_id, fincom_id) do nothing returning *)
    insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, note)
    select ins.id, ins.firm_id, ins.fincom_id, ins.changed_by, 'queue', null, 'queued', ins.job_id, 'queued in posting ' || ins.job_id from ins order by ins.id;
    perform tally_post_register_apply_row(j, coalesce(auth.uid(), j.created_by));
    return null;
  end if;
  -- (111's loop, unchanged) ids of several postings in one statement
  for x in select nw.* from nw order by nw.job_id, nw.fincom_id loop
    select * into j from tally_post_jobs where id = x.job_id;
    if not found then continue; end if;
    rec := coalesce(j.payload->>'recorded', '') = 'true' or j.status in ('done', 'failed');
    select * into g from tally_post_register where firm_id = x.firm_id and fincom_id = x.fincom_id for update;
    if found then
      if g.job_id is not distinct from x.job_id then
        null;
      elsif g.state in ('queued', 'sent', 'in_tally', 'needs_review') and not rec then
        raise exception 'Not queued: % is already % in FinCom''s posting register (posting %). %', coalesce(x.entry_id, x.fincom_id),
          case g.state when 'in_tally' then 'in Tally' when 'needs_review' then 'waiting for review' when 'sent' then 'with the Tally computer' else 'waiting to be sent' end,
          left(coalesce(g.job_id::text, '?'), 8),
          case g.state when 'in_tally' then 'It is not posted twice.' when 'needs_review' then 'Settle it first: Mark posted, or Not in Tally.' else 'Wait for that posting to finish.' end
          using errcode = 'P0001';
      else
        perform tally_post_register_put(g.id, 'queued', 'queue', coalesce(auth.uid(), j.created_by), x.job_id, null, false, null,
          case when rec then 'recorded posting ' else 'queued again in posting ' end || x.job_id, true,
          jsonb_build_object('company', j.company, 'book_id', tally_post_register_book(j.firm_id, j.company), 'client_id', j.client_id, 'entry_id', x.entry_id));
      end if;
    else
      insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, company, book_id, state, job_id, source, changed_by, queued_by, queued_at)
      values (x.firm_id, x.client_id, x.fincom_id, x.entry_id, j.company, tally_post_register_book(j.firm_id, j.company), 'queued', x.job_id, 'queue',
              coalesce(auth.uid(), j.created_by), coalesce(auth.uid(), j.created_by), now())
      on conflict (firm_id, fincom_id) do nothing returning * into g;
      if g.id is not null then
        insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, note)
        values (g.id, g.firm_id, g.fincom_id, g.changed_by, 'queue', null, 'queued', g.job_id, 'queued in posting ' || x.job_id);
      end if;
    end if;
    if not (x.job_id = any(jobs)) then jobs := jobs || x.job_id; end if;
  end loop;
  for j in select * from tally_post_jobs where id = any(jobs) loop
    perform tally_post_register_apply_row(j, coalesce(auth.uid(), j.created_by));
  end loop;
  return null;
end $fn$;
revoke all on function public.tally_post_register_queued() from public, anon, authenticated;
grant execute on function public.tally_post_register_queued() to service_role;
-- 199's sync: the same rule; the ids Tally took as maps, and only the ids whose live changes written
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare acc text[]; acc_an text[]; am jsonb; aam jsonb;
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    -- (201: each voucher's FinCom id worked out once)
    select distinct on (z.f) new.firm_id, new.client_id, z.f, new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v cross join lateral (select tally_fincom_id(v) as f) z where z.f is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted is never freed here: stamped (accepted_at, 36b), said by the posting's own results / items as
    -- accepted and not confirmed (tally_post_job_accepted, 38), or confirmed / ok in a result or item (39); a released id
    -- is never revived
    -- 201: the ids Tally took matter only when the posting fails or is cancelled (any other status keeps every id not
    -- released live, whatever Tally took): worked out only then
    if new.status in ('failed', 'cancelled') then
    select coalesce(array_agg(distinct id), '{}') into acc from (
      select unnest(string_to_array(coalesce(tally_post_job_accepted(new.id, new.results, new.items), ''), ', ')) id
      -- (199: tally_post_result_taken and tally_post_bool written out, word for word, as in tally_post_job_accepted above)
      union select x->>'id' from jsonb_array_elements(coalesce(new.results, '[]'::jsonb)) x where x->>'id' is not null and (((lower(coalesce(x->>'verified', '')) in ('true', 't', '1')) or coalesce(x->>'state', '') in ('in_tally', 'sent') or ((lower(coalesce(x->>'byReply', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'ok', '')) in ('true', 't', '1'))) or ((lower(coalesce(x->>'needsReview', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'accepted', '')) in ('true', 't', '1')))) or (lower(coalesce(x->>'ok', '')) in ('true', 't', '1')))
      union select x->>'id' from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x where x->>'id' is not null and ((lower(coalesce(x->>'verified', '')) in ('true', 't', '1')) or coalesce(x->>'state', '') in ('in_tally', 'sent') or ((lower(coalesce(x->>'byReply', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'ok', '')) in ('true', 't', '1'))) or ((lower(coalesce(x->>'needsReview', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'accepted', '')) in ('true', 't', '1'))))) s where id <> '';
    -- the same ids in letters and digits, each worked out once (an empty spelling matches nothing, as in tally_post_id_match)
    select coalesce(array_agg(distinct an), '{}') into acc_an from (select regexp_replace(a, '[^A-Za-z0-9]', '', 'g') an from unnest(acc) a) s where an <> '';
    else
      acc := '{}'; acc_an := '{}';
    end if;
    -- 201: the same ids as maps (looked up by key: = any(acc) searched the whole array for each id), and only the ids whose
    -- live changes written
    select coalesce(jsonb_object_agg(a, true), '{}'::jsonb) into am from (select distinct unnest(acc) a) s;
    select coalesce(jsonb_object_agg(a, true), '{}'::jsonb) into aam from (select distinct unnest(acc_an) a) s;
    update tally_post_ids i set live = ((i.accepted_at is not null and i.released_at is null)
                   or (new.status not in ('failed', 'cancelled') and i.released_at is null)
                   or (i.released_at is null and coalesce(am ? i.fincom_id or am ? i.entry_id
                         or aam ? regexp_replace(coalesce(i.fincom_id, ''), '[^A-Za-z0-9]', '', 'g') or aam ? regexp_replace(coalesce(i.entry_id, ''), '[^A-Za-z0-9]', '', 'g'), false)))
     where i.job_id = new.id
       and i.live is distinct from ((i.accepted_at is not null and i.released_at is null)
                   or (new.status not in ('failed', 'cancelled') and i.released_at is null)
                   or (i.released_at is null and coalesce(am ? i.fincom_id or am ? i.entry_id
                         or aam ? regexp_replace(coalesce(i.fincom_id, ''), '[^A-Za-z0-9]', '', 'g') or aam ? regexp_replace(coalesce(i.entry_id, ''), '[^A-Za-z0-9]', '', 'g'), false)));
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;
revoke all on function public.tally_post_ids_sync() from public, anon, authenticated;
grant execute on function public.tally_post_ids_sync() to service_role;
-- 182's read-back of a posting done: the same days; each voucher's date read as 199's judge reads it (by its tag first)
create or replace function public.tally_post_job_read_back() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare b record; today date := (now() at time zone 'Asia/Kolkata')::date; ds date[];
begin
  begin
    ds := array(select y.d from (select distinct to_date(z.m, 'YYYYMMDD') as d
                                   from jsonb_array_elements(case when jsonb_typeof(new.payload->'vouchers') = 'array' then new.payload->'vouchers' else '[]'::jsonb end) v
                                  cross join lateral (select case when strpos(x.t, '<DATE>') = 0 then null
                                                                   when length(substr(x.t, strpos(x.t, '<DATE>') + 6, 8)) = 8 and translate(substr(x.t, strpos(x.t, '<DATE>') + 6, 8), '0123456789', '') = ''
                                                                        and substr(x.t, strpos(x.t, '<DATE>') + 14, 7) = '</DATE>' then substr(x.t, strpos(x.t, '<DATE>') + 6, 8)
                                                                   else substring(x.t from '<DATE>(\d{8})</DATE>') end as m
                                                              from (select coalesce(v->>'xml', '') as t) x) z
                                  where z.m ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$') y
                 where y.d <= today order by y.d desc limit 100);
    if coalesce(array_length(ds, 1), 0) = 0 then return null; end if;
    for b in select bk.book_id, bk.firm_id from tally_books bk where bk.firm_id = new.firm_id and bk.company = new.company loop
      insert into tally_light_days (book_id, firm_id, day, why, queued_at)
      select b.book_id, b.firm_id, d, 'post', now() from unnest(ds) d
      on conflict (book_id, day) do update set why = 'post', queued_at = now(), handed_at = null;
    end loop;
  exception when others then
    raise log 'tally_post_job_read_back: job %: % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end $function$;
revoke all on function public.tally_post_job_read_back() from public, anon, authenticated;
grant execute on function public.tally_post_job_read_back() to service_role;
-- 185's enqueue: the same; the entries of the client's other live postings found by a hashed lookup (each voucher queued
-- read them all)
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
        vs jsonb; dupes jsonb;   -- 184: the entries queued now, and those an earlier posting holds
        unr boolean := false;    -- 185: queued for no computer
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  -- 184: one posting of a client is queued at a time (two pages posting overlapping entries at the same moment: the second
  -- waits here, then sees the first one's posting); held to the end of the transaction
  perform pg_advisory_xact_lock(hashtext('tally_post_enqueue'), hashtext(f::text || ':' || coalesce(p_client, '')));
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null
     and not exists (select 1 from tally_split_links x where x.firm_id = f and x.book_id = t.book_id and x.client_id = p_client and x.state = 'linked')
   order by t.last_seen desc nulls last limit 1;
  -- 185: no computer keeps the company now (its key removed): the company of the client's link record
  if c.company is null then c.company := tally_link_post_to(f, p_client, null); end if;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to: its link record's (migration 110), never clients.data postTo
  select tally_link_post_to(f, p_client, c.company), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', case when exists (select 1 from tally_links l where l.firm_id = f and l.client_id = p_client and l.state = 'linked')
        then 'Posting into Tally is stopped for ' || coalesce(cname, 'this client') || ': allow it on the Tally page (the company''s ⋯ Post entries here). Nothing was posted.'
        else 'Link ' || coalesce(cname, 'this client') || ' to its company in Tally first (the Tally page). Its books in FinCom''s cloud come from ' || c.company || '.' end); end if;
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
      update tally_post_jobs set status = 'waiting', message = case when rr ->> 'state' = 'unrouted' then tally_post_unrouted_words(f, p_client, j.company) else 'Retry: waiting for the Tally computer' end, taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1, resend_only = null where id = p_id;     -- final review M1: a person's Retry is a whole Retry
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
  -- 184: an entry an earlier posting holds is left out of this one, not a reason to refuse the rest: one in a posting
  -- still waiting, taken or running (by its entry id, as before), or one whose FinCom id is live in another posting
  -- (tally_post_ids: sent and not settled, or in Tally; before 184 the insert below raised on it and refused them all).
  -- Each is answered with the posting that holds it (dupes: [{id, job, status}]); the page follows that posting
  with lv as materialized (select v->>'id' as id, j2.id as job, j2.status, j2.created_at
                from tally_post_jobs j2, jsonb_array_elements(case when jsonb_typeof(j2.payload->'vouchers') = 'array' then j2.payload->'vouchers' else '[]'::jsonb end) v
               where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')),
       x as (select t.v, t.o, coalesce(a.job, b.job) as job, coalesce(a.status, b.status) as status
               from jsonb_array_elements(case when jsonb_typeof(p_payload->'vouchers') = 'array' then p_payload->'vouchers' else '[]'::jsonb end) with ordinality t(v, o)
               left join (select distinct on (lv.id) lv.id, lv.job, lv.status from lv order by lv.id, lv.created_at) a on a.id = t.v->>'id'
               left join lateral (select i.job_id as job, j3.status from tally_post_ids i join tally_post_jobs j3 on j3.id = i.job_id
                                   where i.firm_id = f and i.live and i.fincom_id = tally_fincom_id(t.v) and i.job_id <> p_id limit 1) b on true)
  select coalesce(jsonb_agg(x.v order by x.o) filter (where x.job is null), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', x.v->>'id', 'job', x.job, 'status', x.status) order by x.o) filter (where x.job is not null), '[]'::jsonb)
    into vs, dupes from x;
  -- every entry is in an earlier posting: nothing is queued (ok false with the words an older page shows; none: the page
  -- of this branch follows the posting named instead)
  if jsonb_array_length(dupes) > 0 and jsonb_array_length(vs) = 0 then
    return jsonb_build_object('ok', false, 'none', true, 'company', c.company, 'dupes', dupes,
      'error', case when exists (select 1 from jsonb_array_elements(dupes) d where d->>'status' in ('waiting', 'taken', 'running'))
        then 'These entries are already waiting to be posted in an earlier posting, which goes on by itself. Nothing was queued again.'
        else 'These entries are held by an earlier posting (sent to Tally, or waiting to be settled there); they are not sent twice. Nothing was queued again.' end);
  end if;
  n := jsonb_array_length(vs) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  -- review M4: the computer: the target's; else the newest that may post and has the company open
  -- 185: no computer named and none has the company open (or tally_post_enqueue_to asks for none: p_target '*'): queued
  -- all the same, for no computer (device_id null), when the link can prove the company to a bridge (its GUID and data
  -- location); else refused in the words as before
  dev := case when p_device is null and p_target = '*' then null else coalesce(p_device, tally_post_device_for(f, c.company, c.device_id)) end;
  if dev is null and not tally_post_unrouted_can(f, p_client, c.company) then return jsonb_build_object('ok', false, 'company', c.company, 'error', tally_post_nobody_words(f, c.company)); end if;
  unr := dev is null;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', vs, 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  if unr then
    update tally_post_jobs set message = tally_post_unrouted_words(f, p_client, c.company) where id = p_id and status = 'waiting' and device_id is null;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company) || case when unr then jsonb_build_object('unrouted', true, 'note', tally_post_unrouted_words(f, p_client, c.company)) else '{}'::jsonb end || case when jsonb_array_length(dupes) > 0 then jsonb_build_object('dupes', dupes) else '{}'::jsonb end;
end $function$;revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) to service_role;

-- ---------------------------------------------------------------- 6. the cron's one entry
-- one indexed look when nothing waits; else 200's settling (at most 10 held postings) and register steps, within 25 s
create or replace function public.tally_post_work()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare t0 timestamptz := clock_timestamp(); s jsonb := null; k integer := 0; o jsonb;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if not exists (select 1 from tally_post_register_pending p where p.done_at is null)
     and not exists (select 1 from tally_post_jobs j where j.status = 'done' and j.checking) then
    return jsonb_build_object('ok', true, 'idle', true);
  end if;
  if exists (select 1 from tally_post_jobs j where j.status = 'done' and j.checking) and to_regprocedure('public.tally_post_settle_itself_all(integer)') is not null then
    s := tally_post_settle_itself_all(10);
  end if;
  while clock_timestamp() - t0 < interval '25 seconds' loop
    o := tally_post_register_step(null, 2000);
    exit when coalesce((o->>'idle')::boolean, false);
    k := k + 1;
  end loop;
  return jsonb_build_object('ok', true, 'settle', s, 'steps', k, 'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $fn$;
revoke all on function public.tally_post_work() from public, anon, authenticated;
grant execute on function public.tally_post_work() to service_role;

-- pg_cron, where it is: 200's job now runs tally_post_work, and both posting jobs carry their own statement_timeout (the
-- requeue of 17-Nov-2026 ran 10-28 s); a run still going is not started again by pg_cron
do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('tally-post-settle-itself', '* * * * *', 'set statement_timeout = ''40s''; select public.tally_post_work()');
    perform cron.schedule('tally-post-requeue', '* * * * *', 'set statement_timeout = ''30s''; select public.tally_post_requeue()');
  end if;
end $$;

commit;
