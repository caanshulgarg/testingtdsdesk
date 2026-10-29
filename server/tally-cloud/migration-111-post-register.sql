-- Migration 111: the posting register (branch next-post-register, 26-Oct-2026; build stabilisation step 3, approved by
-- the owner on 26-Oct; NOT RUN). Runs after 55 (and everything after it on staging). Add-only: two new tables, new
-- functions, new triggers, one new index; no existing function, table or row is changed or removed; safe to run twice;
-- one transaction.
--
-- ONE record per entry FinCom sends to Tally (bill, bank line, sales, journal), per firm and FinCom id, with ONE state:
--   queued        waiting to be sent
--   sent          the bridge has it
--   in_tally      Tally's reply named it, or a later check found it
--   refused       Tally refused it, with Tally's words (or the bridge refused it before sending: nothing reached Tally)
--   needs_review  the outcome is unknown (part of a batch reply where Tally created fewer than sent, no answer, ...)
--   released      a person said "not in Tally" (or the posting was cancelled before the Tally computer took it)
-- with the client, the company and its book, Tally's voucher id (MasterID) when known (id_inferred when it is worked out
-- from a batch's LASTVCHID), the voucher type, number, date and amount, the posting (job), who and when for every change
-- (changed_by, changed_at, source) and the history (tally_post_register_history: add-only, never updated or removed).
--
-- THE RULE ON TALLY'S REPLY (docs/tally-72-proof.md e.: a batch reply gives CREATED / ERRORS / EXCEPTIONS / LASTVCHID /
-- LINEERROR, never which voucher failed; a refusal counts under EXCEPTIONS):
--   * a request of ONE voucher with CREATED 1, a LASTVCHID and no errors, exceptions or LINEERROR -> in_tally, that MasterID;
--   * a batch with CREATED equal to the vouchers sent and no errors, exceptions or LINEERROR -> in_tally, each MasterID
--     worked out from LASTVCHID in the order sent and marked id_inferred (only when every answer of the request is here);
--   * a request where Tally created NOTHING (CREATED 0, ALTERED 0) and named errors -> refused, with Tally's words;
--   * anything else -> needs_review for EVERY voucher of that request, never in_tally.
-- Later evidence settles needs_review, sent and inferred lines (never a person's word):
--   * the add-on's recorder line (tally_recorder_lines) whose FinCom id (the narration's TDSDesk:<id>, payload fid) or
--     REMOTEGUID (payload remoteGuid) is the entry's -> in_tally with that line's MasterID;
--   * a Day Book entry (tally_vouchers.fincom_id) -> in_tally;
--   * the bridge's per-voucher check by MasterID (day 15, FinComVoucherObject): tally_post_register_confirm(fincom id,
--     MasterID, source) (service role).
-- tally_post_register_settle_book(book) applies the first two (tally-ingest after recorder lines and day files; pg_cron
-- every 10 minutes for every book with an unsettled line: tally_post_register_settle_all()).
--
-- WHO WRITES IT: nobody directly (RLS: members of the firm read; no insert/update/delete grant). Triggers and functions:
--   tally_post_ids (after insert, per statement)   a posting queued: each entry queued (a new record, or the same record
--        moved to the new posting). THE DUPLICATE GUARD: a FinCom id whose record is queued, sent, in_tally or needs_review
--        in ANOTHER posting is refused (the whole posting is refused, with the entry named). A posting recorded after it
--        went straight to a bridge (tally_post_record) is a fact, never refused.
--   tally_post_jobs (after update)   a status change (taken, running, done, failed, cancelled, waiting again), and for a
--        recorded posting its results: the posting's entries judged again (tally_post_register_judged).
--   tally_post_jobs (before update of status)   a PERSON's Retry (auth.uid() set) is refused while an entry it would send
--        again needs review (the cron's requeue, with no person, is never stopped here).
--   tally_post_marks (after insert)   a person's Mark posted (in_tally, their Tally id) or release (released, their reason),
--        through the existing RPCs (tally_post_job_mark_posted, 55's check confirm / tally_post_id_release_owner).
--   tally_post_register_apply(job)   tally-ingest's posts_update, after each update of a bridge's posting.
--   tally_post_register_mark_posted(fincom id, vch, note) / tally_post_register_release(fincom id, why)   the two owner
--        actions by FinCom id, mapped onto the existing RPCs: tally_post_job_mark_posted; tally_post_id_release_owner
--        (55: only after the bridge's "not seen" check was confirmed), else tally_post_settle_ask (the bridge looks first).
-- Precedence of what a record says: a person (owner) > evidence (recorder, Day Book, the bridge's check) > Tally's reply >
-- the posting's status; a new attempt (queued, sent) replaces only refused, released, queued or sent.
--
-- THE BACKFILL: every entry of every posting already here, judged by the same function (results and items as the bridge
-- reported them, tally_post_ids' acceptance / release / recorder match, tally_post_marks), one record per FinCom id (the
-- posting where the id is live, else the newest), a history row 'backfill'. A second run adds nothing.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- the register and its history
create table if not exists public.tally_post_register (
  id            bigint generated always as identity primary key,
  firm_id       uuid not null,
  client_id     text not null,
  fincom_id     text not null,                   -- tally_fincom_id: the TDSDesk:<id> tag of the voucher, else FinCom's entry id (letters and digits)
  entry_id      text,                            -- FinCom's own entry id (a bill, a bank line, a sales invoice)
  kind          text,                            -- bill | bank | sales | journal | note | voucher (from the voucher type)
  company       text,
  book_id       uuid,
  state         text not null check (state in ('queued', 'sent', 'in_tally', 'refused', 'needs_review', 'released')),
  master_id     text,                            -- Tally's voucher id (MasterID) when known
  id_inferred   boolean not null default false,  -- master_id (or the state itself) worked out from a batch's LASTVCHID
  vch_type      text,
  vch_no        text,
  vch_date      date,
  amount        numeric,
  tally_words   text,                            -- Tally's words (a refusal, a reply that needs review) or the person's reason
  job_id        uuid,                            -- the posting now holding the record
  source        text not null default 'queue',   -- queue | status | reply | recorder | daybook | bridge | owner
  changed_by    uuid,
  changed_at    timestamptz not null default now(),
  queued_by     uuid,
  queued_at     timestamptz not null default now(),
  sent_at       timestamptz,
  settled_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists tally_post_register_fid on public.tally_post_register (firm_id, fincom_id);
create index if not exists tally_post_register_client on public.tally_post_register (firm_id, client_id, changed_at desc);
create index if not exists tally_post_register_job on public.tally_post_register (job_id);
create index if not exists tally_post_register_open on public.tally_post_register (book_id, state) where state in ('sent', 'needs_review', 'refused') or id_inferred;

create table if not exists public.tally_post_register_history (
  id            bigint generated always as identity primary key,
  register_id   bigint not null references public.tally_post_register(id),
  firm_id       uuid not null,
  fincom_id     text not null,
  at            timestamptz not null default now(),
  by_user       uuid,
  source        text not null,
  from_state    text,
  to_state      text not null,
  job_id        uuid,
  master_id     text,
  id_inferred   boolean,
  words         text,
  note          text
);
create index if not exists tally_post_register_history_reg on public.tally_post_register_history (register_id, id);

alter table public.tally_post_register enable row level security;
alter table public.tally_post_register_history enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_register' and policyname = 'tally_post_register_read') then
    create policy tally_post_register_read on public.tally_post_register for select to authenticated using (firm_id = public.my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_register_history' and policyname = 'tally_post_register_history_read') then
    create policy tally_post_register_history_read on public.tally_post_register_history for select to authenticated using (firm_id = public.my_firm());
  end if;
end $do$;
revoke all on public.tally_post_register from public, anon, authenticated;
revoke all on public.tally_post_register_history from public, anon, authenticated;
grant select on public.tally_post_register to authenticated;
grant select on public.tally_post_register_history to authenticated;
grant all on public.tally_post_register to service_role;
grant all on public.tally_post_register_history to service_role;
-- their identities' sequences too (Supabase gives nothing by default on new objects from 30-Oct-2026: run_migration_grants 4)
grant usage, select on sequence public.tally_post_register_id_seq, public.tally_post_register_history_id_seq to service_role;

-- never removed: a row of either table, and the history never changed
create or replace function public.tally_post_register_keep() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'DELETE' then raise exception 'the posting register keeps every row: nothing is removed from %', tg_table_name using errcode = '42501'; end if;
  raise exception 'the posting register''s history is add-only' using errcode = '42501';
end $fn$;
revoke all on function public.tally_post_register_keep() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_register_keep' and tgrelid = 'public.tally_post_register'::regclass) then
    create trigger tally_post_register_keep before delete on public.tally_post_register for each row execute function public.tally_post_register_keep();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_register_history_keep' and tgrelid = 'public.tally_post_register_history'::regclass) then
    create trigger tally_post_register_history_keep before update or delete on public.tally_post_register_history for each row execute function public.tally_post_register_keep();
  end if;
end $do$;

-- the recorder lines of a book by FinCom id (the evidence's lookup)
create index if not exists tally_recorder_lines_fid on public.tally_recorder_lines (book_id, (payload->>'fid')) where payload ? 'fid';

-- ---------------------------------------------------------------- small helpers
-- how much a source's word weighs: a person > evidence > Tally's reply > the posting's status > the queue
create or replace function public.tally_post_register_rank(p_source text) returns integer language sql immutable set search_path = public, pg_temp as $fn$
  select case p_source when 'owner' then 5 when 'recorder' then 4 when 'daybook' then 4 when 'bridge' then 4 when 'reply' then 3 else 2 end
$fn$;
-- the kind of entry, from Tally's voucher type
create or replace function public.tally_post_register_kind(p_type text) returns text language sql immutable set search_path = public, pg_temp as $fn$
  select case when p_type is null or btrim(p_type) = '' then null
              when lower(p_type) ~ '^(payment|receipt|contra)' then 'bank'
              when lower(p_type) ~ '^sales' then 'sales'
              when lower(p_type) ~ '^purchase' then 'bill'
              when lower(p_type) ~ '^journal' then 'journal'
              when lower(p_type) ~ '^(credit|debit) note' then 'note'
              else 'voucher' end
$fn$;
revoke all on function public.tally_post_register_rank(text) from public, anon;
revoke all on function public.tally_post_register_kind(text) from public, anon;
grant execute on function public.tally_post_register_rank(text) to authenticated, service_role;
grant execute on function public.tally_post_register_kind(text) to authenticated, service_role;

-- ---------------------------------------------------------------- the judge: what each entry of a posting is
-- One SELECT over the posting row j (its payload, results, items, status) and what tally_post_ids and tally_post_marks
-- hold for it. Used by the live triggers and by the backfill; the staging count mirrors this very text
-- (tests/run_migration111.py --staging-sql). Never writes.
create or replace function public.tally_post_register_judged(j public.tally_post_jobs)
returns table (fincom_id text, entry_id text, ord integer, state text, source text, master_id text, id_inferred boolean, words text,
               by_user uuid, at timestamptz, vch_type text, vch_no text, vch_date date, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $judge$
with vs as (
  select tally_fincom_id(t.v) as fid, t.v->>'id' as eid, coalesce(t.v->>'xml', '') as xml, t.o::int as ord
    from jsonb_array_elements(case when jsonb_typeof((j).payload->'vouchers') = 'array' then (j).payload->'vouchers' else '[]'::jsonb end) with ordinality as t(v, o)
   where jsonb_typeof(t.v) = 'object' and tally_fincom_id(t.v) is not null),
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
  select t.i, regexp_replace(t.i->>'id', '[^A-Za-z0-9]', '', 'g') as k
    from jsonb_array_elements(case when jsonb_typeof((j).items) = 'array' then (j).items else '[]'::jsonb end) as t(i)
   where jsonb_typeof(t.i) = 'object' and coalesce(t.i->>'id', '') <> ''),
b as (
  select v1.fid, v1.eid, v1.ord, v1.xml, r.r, r.pos, r.gn, it.i,
         mk.action as mk_action, mk.vch as mk_vch, mk.note as mk_note, mk.by_user as mk_by, mk.at as mk_at,
         pid.accepted_at, pid.released_at, pid.released_by, pid.matched_at, pid.matched_mid,
         ((j).status in ('waiting', 'taken', 'running') and (jsonb_typeof((j).resend_only) is distinct from 'array' or jsonb_array_length((j).resend_only) = 0
            or (j).resend_only ? coalesce(v1.eid, '') or (j).resend_only ? v1.fid)) as in_scope
    from v1
    left join lateral (select rs.r, rs.pos, rs.gn from rs where rs.k <> '' and (rs.k = v1.kf or rs.k = v1.ke) order by rs.ord desc limit 1) r on true
    left join lateral (select its.i from its where its.k <> '' and (its.k = v1.kf or its.k = v1.ke) limit 1) it on true
    left join lateral (select m.action, m.vch, m.note, m.by_user, m.at from tally_post_marks m
                        where m.job_id = (j).id and regexp_replace(m.entry_id, '[^A-Za-z0-9]', '', 'g') in (v1.kf, v1.ke) order by m.at desc, m.id desc limit 1) mk on true
    left join lateral (select p.accepted_at, p.released_at, p.released_by, p.matched_at, p.matched_mid from tally_post_ids p
                        where p.job_id = (j).id and p.fincom_id = v1.fid limit 1) pid on true),
c as (
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
d as (
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
e as (
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
       coalesce(nullif(f.r->>'vchType', ''), nullif(substring(f.xml from '<VOUCHERTYPENAME>([^<]{1,100})</VOUCHERTYPENAME>'), ''), nullif(substring(f.xml from 'VCHTYPE="([^"]{1,100})"'), '')),
       coalesce(nullif(f.r->>'vchNumber', ''), nullif(f.r->>'vchNo', ''), nullif(substring(f.xml from '<VOUCHERNUMBER>([^<]{1,60})</VOUCHERNUMBER>'), '')),
       case when coalesce(nullif(f.r->>'vchDate', ''), substring(f.xml from '<DATE>(\d{8})</DATE>')) ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$'
            then to_date(coalesce(nullif(f.r->>'vchDate', ''), substring(f.xml from '<DATE>(\d{8})</DATE>')), 'YYYYMMDD') end,
       (select max(abs(m.a[1]::numeric)) from regexp_matches(f.xml, '<AMOUNT>\s*(-?\d{1,15}(?:\.\d{1,4})?)\s*</AMOUNT>', 'g') as m(a))
  from (select f0.*, (select p.released_why from tally_post_ids p where p.job_id = (j).id and p.fincom_id = f0.fid limit 1) as released_why from f f0) f
 order by f.ord
$judge$;
revoke all on function public.tally_post_register_judged(public.tally_post_jobs) from public, anon, authenticated;
grant execute on function public.tally_post_register_judged(public.tally_post_jobs) to service_role;

-- ---------------------------------------------------------------- one change of one record (internal)
-- p_force: a new attempt (the record moved to another posting, queued again). Answers true when the record changed.
create or replace function public.tally_post_register_put(p_id bigint, p_state text, p_source text, p_by uuid, p_job uuid, p_master text, p_inferred boolean,
                                                          p_words text, p_note text, p_force boolean default false, p_more jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $fn$
declare g tally_post_register%rowtype; allowed boolean; m text := nullif(left(btrim(coalesce(p_master, '')), 60), ''); w text := nullif(left(btrim(coalesce(p_words, '')), 1000), '');
begin
  select * into g from tally_post_register where id = p_id for update;
  if not found then return false; end if;
  allowed := case
    when p_force then true
    when p_state in ('queued', 'sent') then g.state in ('queued', 'sent', 'refused', 'released')
    when g.state in ('queued', 'sent') then true
    else tally_post_register_rank(p_source) >= tally_post_register_rank(g.source) end;
  -- the voucher's own details fill what is missing, whatever the state
  update tally_post_register set vch_type = coalesce(vch_type, nullif(p_more->>'vch_type', '')), vch_no = coalesce(vch_no, nullif(p_more->>'vch_no', '')),
         vch_date = coalesce(vch_date, case when p_more->>'vch_date' ~ '^\d{4}-\d\d-\d\d$' then (p_more->>'vch_date')::date end),
         amount = coalesce(amount, case when p_more->>'amount' ~ '^-?\d+(\.\d+)?$' then (p_more->>'amount')::numeric end),
         kind = coalesce(kind, nullif(p_more->>'kind', ''))
   where id = p_id and (vch_type is null or vch_no is null or vch_date is null or amount is null or kind is null) and p_more <> '{}'::jsonb;
  if not allowed then return false; end if;
  if g.state = p_state and g.master_id is not distinct from coalesce(m, case when p_state = 'in_tally' then g.master_id end) and g.id_inferred = coalesce(p_inferred, false)
     and g.tally_words is not distinct from w and g.job_id is not distinct from coalesce(p_job, g.job_id)
     and (g.source = p_source or tally_post_register_rank(p_source) <= tally_post_register_rank(g.source)) then
    return false;
  end if;
  update tally_post_register set state = p_state, source = p_source, changed_by = p_by, changed_at = now(),
         master_id = case when p_state = 'in_tally' then coalesce(m, case when g.state = 'in_tally' then g.master_id end) when p_state in ('queued') then null else coalesce(m, master_id) end,
         id_inferred = case when p_state = 'in_tally' then coalesce(p_inferred, false) and not (m is null and g.state = 'in_tally' and not g.id_inferred and g.master_id is not null) else false end,
         tally_words = w,
         job_id = coalesce(p_job, job_id),
         queued_by = case when p_force then coalesce(p_by, queued_by) else queued_by end,
         queued_at = case when p_force then now() else queued_at end,
         sent_at = case when p_state = 'sent' then coalesce(case when p_force then null else sent_at end, now()) when p_force then null else sent_at end,
         settled_at = case when p_state in ('in_tally', 'refused', 'released') then now() else null end,
         company = coalesce(nullif(p_more->>'company', ''), company), book_id = coalesce(case when p_more->>'book_id' ~ '^[0-9a-f-]{36}$' then (p_more->>'book_id')::uuid end, book_id),
         client_id = coalesce(nullif(p_more->>'client_id', ''), client_id), entry_id = coalesce(nullif(p_more->>'entry_id', ''), entry_id)
   where id = p_id;
  insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
  select r.id, r.firm_id, r.fincom_id, p_by, p_source, g.state, r.state, r.job_id, r.master_id, r.id_inferred, r.tally_words, nullif(left(coalesce(p_note, ''), 300), '')
    from tally_post_register r where r.id = p_id;
  return true;
end $fn$;
revoke all on function public.tally_post_register_put(bigint, text, text, uuid, uuid, text, boolean, text, text, boolean, jsonb) from public, anon, authenticated;

-- the book of a posting's company
create or replace function public.tally_post_register_book(p_firm uuid, p_company text) returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select t.book_id from tally_companies t where t.firm_id = p_firm and t.company = p_company and t.book_id is not null order by t.last_seen desc nulls last limit 1),
                  (select b.book_id from tally_books b where b.firm_id = p_firm and lower(b.company) = lower(p_company) limit 1))
$fn$;
revoke all on function public.tally_post_register_book(uuid, text) from public, anon, authenticated;

-- a posting's entries judged and written (internal): only the records this posting holds (one moved on to a later posting
-- is left alone); a record missing (an entry FinCom has no record of yet) is made
create or replace function public.tally_post_register_apply_row(j public.tally_post_jobs, p_by uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare x record; g tally_post_register%rowtype; n integer := 0; bk uuid := tally_post_register_book(j.firm_id, j.company); more jsonb;
begin
  for x in select * from tally_post_register_judged(j) loop
    more := jsonb_build_object('vch_type', x.vch_type, 'vch_no', x.vch_no, 'vch_date', x.vch_date, 'amount', x.amount, 'kind', tally_post_register_kind(x.vch_type));
    select * into g from tally_post_register where firm_id = j.firm_id and fincom_id = x.fincom_id;
    if not found then
      insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, kind, company, book_id, state, master_id, id_inferred, vch_type, vch_no, vch_date, amount, tally_words,
                                       job_id, source, changed_by, queued_by, queued_at, sent_at, settled_at)
      values (j.firm_id, j.client_id, x.fincom_id, x.entry_id, tally_post_register_kind(x.vch_type), j.company, bk, x.state, x.master_id, coalesce(x.id_inferred, false), x.vch_type, x.vch_no, x.vch_date, x.amount, x.words,
              j.id, x.source, coalesce(x.by_user, p_by), j.created_by, j.created_at, case when x.state <> 'queued' then coalesce(j.taken_at, j.updated_at) end,
              case when x.state in ('in_tally', 'refused', 'released') then now() end)
      on conflict (firm_id, fincom_id) do nothing returning * into g;
      if g.id is not null then
        insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
        values (g.id, g.firm_id, g.fincom_id, g.changed_by, g.source, null, g.state, g.job_id, g.master_id, g.id_inferred, g.tally_words, 'recorded from posting ' || j.id);
        n := n + 1;
      end if;
    elsif g.job_id is not distinct from j.id then
      if tally_post_register_put(g.id, x.state, x.source, coalesce(x.by_user, p_by), j.id, x.master_id, x.id_inferred, x.words, null, false, more) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $fn$;
revoke all on function public.tally_post_register_apply_row(public.tally_post_jobs, uuid) from public, anon, authenticated;

-- tally-ingest's posts_update (service role): the posting's entries written after each update of the bridge
create or replace function public.tally_post_register_apply(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare j tally_post_jobs%rowtype; n integer;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such posting'); end if;
  n := tally_post_register_apply_row(j, null);
  return jsonb_build_object('ok', true, 'changed', n,
    'states', (select coalesce(jsonb_object_agg(s.state, s.k), '{}'::jsonb) from (select r.state, count(*) k from tally_post_register r where r.job_id = p_job group by r.state) s));
end $fn$;
revoke all on function public.tally_post_register_apply(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_apply(uuid) to service_role;

-- ---------------------------------------------------------------- triggers
-- a posting queued: its entries, with THE DUPLICATE GUARD
create or replace function public.tally_post_register_queued() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare x record; g tally_post_register%rowtype; j tally_post_jobs%rowtype; rec boolean; jobs uuid[] := '{}';
begin
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
  -- the voucher details of the new postings, and a posting recorded after the fact (or queued already finished): its results
  for j in select * from tally_post_jobs where id = any(jobs) loop
    perform tally_post_register_apply_row(j, coalesce(auth.uid(), j.created_by));
  end loop;
  return null;
end $fn$;
revoke all on function public.tally_post_register_queued() from public, anon, authenticated;

-- a posting's status changed (or a recorded posting's results): its entries judged again
create or replace function public.tally_post_register_job_changed() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform tally_post_register_apply_row(new, auth.uid());
  return null;
end $fn$;
revoke all on function public.tally_post_register_job_changed() from public, anon, authenticated;

-- a PERSON's Retry never sends again an entry that needs review (the cron's requeue has no person and is never stopped)
create or replace function public.tally_post_register_retry_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare who text;
begin
  if new.status = 'waiting' and old.status is distinct from 'waiting' and auth.uid() is not null then
    select string_agg(coalesce(r.entry_id, r.fincom_id), ', ' order by r.fincom_id) into who from tally_post_register r
     where r.job_id = new.id and r.state = 'needs_review'
       and (jsonb_typeof(new.resend_only) is distinct from 'array' or jsonb_array_length(new.resend_only) = 0 or new.resend_only ? coalesce(r.entry_id, '') or new.resend_only ? r.fincom_id);
    if who is not null then
      raise exception 'Not sent again: % of this posting needs review in FinCom''s posting register (%). Mark it posted, or Not in Tally, first.',
        case when position(',' in who) > 0 then 'entries' else 'an entry' end, who using errcode = 'P0001';
    end if;
  end if;
  return new;
end $fn$;
revoke all on function public.tally_post_register_retry_guard() from public, anon, authenticated;

-- a person's mark (Mark posted, a release), through the existing RPCs
create or replace function public.tally_post_register_marked() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare g tally_post_register%rowtype; k text := regexp_replace(coalesce(new.entry_id, ''), '[^A-Za-z0-9]', '', 'g');
begin
  select * into g from tally_post_register r where r.firm_id = new.firm_id and r.job_id = new.job_id
     and (r.entry_id = new.entry_id or r.fincom_id = new.entry_id or regexp_replace(r.fincom_id, '[^A-Za-z0-9]', '', 'g') = k or regexp_replace(coalesce(r.entry_id, ''), '[^A-Za-z0-9]', '', 'g') = k)
   order by (r.entry_id = new.entry_id) desc limit 1;
  if not found then return null; end if;
  if new.action = 'posted' then
    perform tally_post_register_put(g.id, 'in_tally', case when coalesce(new.note, '') like 'Found in % by the FinCom Bridge%' then 'bridge' else 'owner' end, new.by_user, new.job_id,
      new.vch, false, new.note, 'marked posted (tally_post_marks ' || new.id || ')', false);
  elsif new.action = 'released' then
    perform tally_post_register_put(g.id, 'released', 'owner', new.by_user, new.job_id, null, false, new.note, 'released (tally_post_marks ' || new.id || ')', false);
  end if;
  return null;
end $fn$;
revoke all on function public.tally_post_register_marked() from public, anon, authenticated;

do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_register_queued' and tgrelid = 'public.tally_post_ids'::regclass) then
    create trigger tally_post_register_queued after insert on public.tally_post_ids referencing new table as nw for each statement execute function public.tally_post_register_queued();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_register_job_changed' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_register_job_changed after update on public.tally_post_jobs for each row
      when (old.status is distinct from new.status or (new.device_id is null and (old.results is distinct from new.results or old.items is distinct from new.items)))
      execute function public.tally_post_register_job_changed();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_register_retry_guard' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_register_retry_guard before update of status on public.tally_post_jobs for each row execute function public.tally_post_register_retry_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_register_marked' and tgrelid = 'public.tally_post_marks'::regclass) then
    create trigger tally_post_register_marked after insert on public.tally_post_marks for each row execute function public.tally_post_register_marked();
  end if;
end $do$;

-- ---------------------------------------------------------------- evidence: the recorder and the Day Book
-- a book's records that sent, need review, were refused, or carry an inferred id, settled by what Tally itself shows:
-- the add-on's line (its FinCom id or REMOTEGUID) or a Day Book entry (tally_vouchers.fincom_id). Never a release
create or replace function public.tally_post_register_settle_book(p_book uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare b record; g record; l record; v record; n integer := 0;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  select bk.book_id, bk.firm_id, bk.company into b from tally_books bk where bk.book_id = p_book;
  if b.book_id is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  for g in select r.* from tally_post_register r
            where r.firm_id = b.firm_id and (r.book_id = p_book or (r.book_id is null and lower(coalesce(r.company, '')) = lower(coalesce(b.company, ''))))
              and (r.state in ('sent', 'needs_review', 'refused') or (r.state = 'in_tally' and r.id_inferred)) loop
    select ln.id, ln.master_id, ln.vch_no, ln.object_guid into l from tally_recorder_lines ln
     where ln.book_id = p_book and ln.event in ('created', 'altered', 'imported') and ln.state <> 'failed' and ln.payload ? 'fid'
       and (ln.payload->>'fid') in (g.fincom_id, coalesce(g.entry_id, g.fincom_id))
     order by ln.id desc limit 1;
    if l.id is null then
      select ln.id, ln.master_id, ln.vch_no, ln.object_guid into l from tally_recorder_lines ln
       where ln.book_id = p_book and ln.event in ('created', 'altered', 'imported') and ln.state <> 'failed'
         and coalesce(ln.payload->>'remoteGuid', ln.payload->>'remote_guid', '') <> ''
         and coalesce(ln.payload->>'remoteGuid', ln.payload->>'remote_guid') in (g.fincom_id, coalesce(g.entry_id, g.fincom_id))
       order by ln.id desc limit 1;
    end if;
    if l.id is not null then
      if tally_post_register_put(g.id, 'in_tally', 'recorder', null, g.job_id, nullif(l.master_id, ''), false, null,
           'the add-on''s line ' || l.id || ' (' || coalesce(nullif(l.vch_no, ''), 'no number') || ')', false, jsonb_build_object('vch_no', l.vch_no)) then
        update tally_post_register set vch_no = coalesce(nullif(l.vch_no, ''), vch_no) where id = g.id;
        n := n + 1;
      end if;
      continue;
    end if;
    select tv.guid, tv.vno into v from tally_vouchers tv
     where tv.book_id = p_book and tv.fincom_id in (g.fincom_id, coalesce(g.entry_id, g.fincom_id)) and tv.deleted_at is null and not coalesce(tv.cancelled, false)
     limit 1;
    if v.guid is not null then
      if tally_post_register_put(g.id, 'in_tally', 'daybook', null, g.job_id, case when g.state = 'in_tally' then g.master_id end, g.state = 'in_tally' and g.id_inferred, null,
           'in the Day Book (' || coalesce(nullif(v.vno, ''), 'no number') || ')', false) then
        update tally_post_register set vch_no = coalesce(nullif(v.vno, ''), vch_no) where id = g.id;
        n := n + 1;
      end if;
    end if;
    l := null; v := null;
  end loop;
  return jsonb_build_object('ok', true, 'settled', n);
end $fn$;
revoke all on function public.tally_post_register_settle_book(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_settle_book(uuid) to service_role;

-- every book with an unsettled record (pg_cron, every 10 minutes)
create or replace function public.tally_post_register_settle_all()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare bk uuid; n integer := 0; k integer := 0; r jsonb;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  for bk in select distinct coalesce(r0.book_id, tally_post_register_book(r0.firm_id, r0.company)) from tally_post_register r0
             where r0.state in ('sent', 'needs_review', 'refused') or (r0.state = 'in_tally' and r0.id_inferred) loop
    continue when bk is null;
    r := tally_post_register_settle_book(bk); k := k + 1; n := n + coalesce((r->>'settled')::int, 0);
  end loop;
  return jsonb_build_object('ok', true, 'books', k, 'settled', n);
end $fn$;
revoke all on function public.tally_post_register_settle_all() from public, anon, authenticated;
grant execute on function public.tally_post_register_settle_all() to service_role;

-- THE HOOK FOR THE BRIDGE (day 15: the per-voucher check by MasterID, FinComVoucherObject, comparing the TDSDesk tag or
-- REMOTEGUID in its answer): the entry IS in Tally as that MasterID. Service role (tally-ingest). Settles sent,
-- needs_review, refused and inferred records (never a queued or released one); a person's word stands. p_firm (or p_book) when the bridge knows it;
-- a FinCom id found in two firms without it is refused
create or replace function public.tally_post_register_confirm(p_fincom_id text, p_vch text, p_source text, p_firm uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare g tally_post_register%rowtype; k integer; mid text := btrim(coalesce(p_vch, '')); src text := left(coalesce(nullif(btrim(p_source), ''), 'bridge'), 80); changed boolean;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if mid !~ '^\d{1,18}$' then return jsonb_build_object('ok', false, 'error', 'the MasterID is digits'); end if;
  select count(*) into k from tally_post_register r where (r.fincom_id = p_fincom_id or r.entry_id = p_fincom_id) and (p_firm is null or r.firm_id = p_firm);
  if k = 0 then return jsonb_build_object('ok', false, 'error', 'no such FinCom id in the register'); end if;
  if k > 1 then return jsonb_build_object('ok', false, 'error', 'that FinCom id is in more than one record: name the firm'); end if;
  select * into g from tally_post_register r where (r.fincom_id = p_fincom_id or r.entry_id = p_fincom_id) and (p_firm is null or r.firm_id = p_firm) for update;
  if g.state in ('queued', 'released') then return jsonb_build_object('ok', false, 'state', g.state, 'error', 'not settled from a check: the record is ' || g.state); end if;
  changed := tally_post_register_put(g.id, 'in_tally', 'bridge', null, g.job_id, mid, false, null, 'confirmed by ' || src, false);
  select * into g from tally_post_register where id = g.id;
  return jsonb_build_object('ok', true, 'changed', changed, 'state', g.state, 'master_id', g.master_id, 'source', g.source);
end $fn$;
revoke all on function public.tally_post_register_confirm(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_confirm(text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------- the two owner actions by FinCom id
-- Mark posted (a Tally id, a reason): 55's tally_post_job_mark_posted (any member who may post; name and time kept)
create or replace function public.tally_post_register_mark_posted(p_fincom_id text, p_vch text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f uuid := my_firm(); g tally_post_register%rowtype; r jsonb;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can mark an entry posted' using errcode = '42501'; end if;
  select * into g from tally_post_register where firm_id = f and (fincom_id = p_fincom_id or entry_id = p_fincom_id) order by (fincom_id = p_fincom_id) desc limit 1;
  if not found or g.job_id is null then raise exception 'this entry is not in your firm''s posting register'; end if;
  r := tally_post_job_mark_posted(g.job_id, coalesce(g.entry_id, g.fincom_id), p_vch, p_note);
  select * into g from tally_post_register where id = g.id;
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('state', g.state, 'master_id', g.master_id);
end $fn$;
revoke all on function public.tally_post_register_mark_posted(text, text, text) from public, anon;
grant execute on function public.tally_post_register_mark_posted(text, text, text) to authenticated;

-- Not in Tally (a reason): 55's tally_post_id_release_owner when the bridge's "not seen" check was confirmed; else 55's
-- tally_post_settle_ask (the owner's rule: the bridge looks in Tally first; nothing is released or sent meanwhile)
create or replace function public.tally_post_register_release(p_fincom_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f uuid := my_firm(); g tally_post_register%rowtype; r jsonb;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can release an entry' using errcode = '42501'; end if;
  if btrim(coalesce(p_why, '')) = '' then raise exception 'say why: what you saw in Tally (kept with the entry)'; end if;
  select * into g from tally_post_register where firm_id = f and (fincom_id = p_fincom_id or entry_id = p_fincom_id) order by (fincom_id = p_fincom_id) desc limit 1;
  if not found or g.job_id is null then raise exception 'this entry is not in your firm''s posting register'; end if;
  if g.state in ('queued', 'sent') then return jsonb_build_object('ok', false, 'state', g.state, 'error', 'This entry is still being sent to Tally; wait for it to finish.'); end if;
  if g.state = 'released' then return jsonb_build_object('ok', true, 'state', g.state, 'already', true); end if;
  if exists (select 1 from tally_post_checks k where k.job_id = g.job_id and k.state = 'confirmed' and tally_post_id_match(k.entry_id, k.entry_id, coalesce(g.entry_id, g.fincom_id))) then
    r := tally_post_id_release_owner(g.job_id, coalesce(g.entry_id, g.fincom_id), p_why);
  else
    r := tally_post_settle_ask(g.job_id, coalesce(g.entry_id, g.fincom_id), p_why) || jsonb_build_object('asked', true);
  end if;
  select * into g from tally_post_register where id = g.id;
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('state', g.state);
end $fn$;
revoke all on function public.tally_post_register_release(text, text) from public, anon;
grant execute on function public.tally_post_register_release(text, text) to authenticated;

-- ---------------------------------------------------------------- the backfill (once: a second run adds nothing)
-- @backfill-begin
with picked as (
  select distinct on (j.firm_id, x.fincom_id) j.id as job, j.firm_id, j.client_id, j.company, j.created_by, j.created_at, j.taken_at, j.updated_at, x.*
    from tally_post_jobs j
    cross join lateral tally_post_register_judged(j) x
   order by j.firm_id, x.fincom_id,
            (exists (select 1 from tally_post_ids p where p.job_id = j.id and p.fincom_id = x.fincom_id and p.live)) desc, j.created_at desc, j.id desc),
ins as (
  insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, kind, company, book_id, state, master_id, id_inferred, vch_type, vch_no, vch_date, amount, tally_words,
                                   job_id, source, changed_by, changed_at, queued_by, queued_at, sent_at, settled_at)
  select p.firm_id, p.client_id, p.fincom_id, p.entry_id, tally_post_register_kind(p.vch_type), p.company, tally_post_register_book(p.firm_id, p.company), p.state, p.master_id, coalesce(p.id_inferred, false),
         p.vch_type, p.vch_no, p.vch_date, p.amount, p.words, p.job, p.source, p.by_user, coalesce(p.at, p.updated_at, now()), p.created_by, p.created_at,
         case when p.state <> 'queued' then coalesce(p.taken_at, p.updated_at) end, case when p.state in ('in_tally', 'refused', 'released') then coalesce(p.at, p.updated_at, now()) end
    from picked p
  on conflict (firm_id, fincom_id) do nothing
  returning *)
insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
select ins.id, ins.firm_id, ins.fincom_id, ins.changed_by, ins.source, null, ins.state, ins.job_id, ins.master_id, ins.id_inferred, ins.tally_words, 'backfill (migration 111)' from ins;
-- @backfill-end

-- the evidence already here settles what it can (recorder lines, Day Book entries)
do $do$ declare r jsonb; begin
  r := tally_post_register_settle_all();
  raise notice 'migration 111: register %, settled from evidence %', (select jsonb_object_agg(s.state, s.k) from (select state, count(*) k from tally_post_register group by state) s), r;
end $do$;

-- every 10 minutes, where the database has pg_cron
do $do$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('tally-post-register-settle', '*/10 * * * *', 'select public.tally_post_register_settle_all()');
  end if;
end $do$;

commit;
