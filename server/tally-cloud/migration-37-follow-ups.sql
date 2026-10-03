-- Migration 37 (03-Oct-2026, round 4: the migration-32 follow-ups 7, 8, 10, 11, 12, 13, 14 and the Tally page's item
-- 23). Runs AFTER 32 -> 33 -> 35 -> 34 -> 36 -> 36b (docs/MIGRATION-ORDER.md); it needs nothing of 36 beyond its being
-- there, and keeps 36b's rule (an id Tally accepted, accepted_at, is never freed by the sync or by the bridge's release).
-- Adds only: columns, one index, functions (new, or replaced with the same arguments) and policies where missing.
-- Nothing is dropped, deleted or revoked from what is there; safe to run again (every step is "if not exists" or a
-- replace). To be shown to the owner before it runs. Every function here: security definer, search_path = public, pg_temp.
--
--   7.  id release        tally_post_ids + released_at, released_by ('bridge'), released_why (36b adds the same columns).
--                         tally_post_id_release(job, id, why) (tally-ingest, service role): ONE entry's id set free (live =
--                         false) when Tally refused it or it was not found there, the other entries of the posting
--                         untouched; never an id Tally accepted (accepted_at, 36b: released false, why 'accepted by
--                         Tally'; only the owner's tally_post_id_release_owner frees it). The id is matched as the tag
--                         spells it, as the bridge stamps it (letters and digits) or by FinCom's entry id. tally_post_ids_sync
--                         (the trigger that follows the posting's status) never turns a released id live again, so a
--                         Retry of the posting leaves it free and the bill can be queued afresh; an accepted id stays live
--   8.  versions + lines  tally_voucher_versions + lines jsonb: [ledger, amount, hsn, rate, bills] of the entry as it was
--                         in that version, filled by tally_ingest_day after it has the lines; filled once, never changed
--                         (the append-only trigger lets exactly that one fill through: lines from null to a value, nothing
--                         else on the row)
--   10. clear baseline    tally_sync_cursor + cleared_at, cleared_by, cleared_note; tally_baseline_clear(book, note) for an
--                         owner of the firm: state back to 'ok' with the note (an empty note refused); who and when kept
--   11. soft delete       tally_ingest_day no longer deletes entries. The day's entries are upserted by (book, GUID) with
--                         deleted_at = null; the day's entries NOT in the file get deleted_at = now() and stay (their lines
--                         and bills stay too); the lines and bills of a RE-SENT entry are replaced, after the lines it had
--                         are put on its version row (item 8); tally_ledger_day is rebuilt from live entries only (not
--                         deleted, not cancelled, not optional); the tally_days bookkeeping (n, alter_max, bytes, at) as
--                         today. The reports read live entries only wherever they join tally_vouchers: tally_tb,
--                         tally_period and tally_tds_summary read tally_ledger_day only (already live-only; tally_tb and
--                         tally_period replaced here only for the search_path, tally_tds_summary not touched),
--                         tally_mis and tally_gst_summary gain "v.deleted_at is null" and nothing else. Beyond item 11's
--                         list, with the same one-line change, so a deleted entry never shows anywhere: tally_ledger (a
--                         ledger's statement), tally_find (search) and tally_vouchers_in (the entries read back)
--   12. lease             tally_company_lease + released_at; tally_lease_release marks the row (kept, until untouched);
--                         tally_lease_take treats a released or expired row as free and takes it in place
--   13. balance on a date tally_balances_on(book, as_on): each live ledger's opening, its entries from the book's start
--                         to the date (tally_ledger_day) and the closing, with parent and primary group; merged twins and
--                         deleted ledgers left out; for a member of the book's firm (42501 otherwise)
--   14. FinCom id column  tally_vouchers + fincom_id (the "TDSDesk:<id>" the bridge read from the FULL narration, sent as
--                         "fid") and an index (book_id, fincom_id); origin = 'fincom' when it is set (the narration tag
--                         stays as the fallback; the trigger also fills fincom_id from the tag when none is sent); the
--                         rows already here backfilled from their narrations
--   23. withdraw          tally_bridge_releases + withdrawn_at, withdrawn_by, withdrawn_why; tally_release_withdraw(version,
--                         why) for an owner (a reason needed; the row kept; an approved version can be withdrawn);
--                         tally_release_approve refuses a withdrawn version; tally_release_pilot on one starts afresh: the
--                         withdrawal (and an approval, if any) cleared and written into note with who/when/why
--   grants                service role only: tally_post_id_release, tally_ingest_day, tally_lease_take/release,
--                         tally_voucher_version_lines; members (authenticated): tally_baseline_clear, tally_balances_on,
--                         tally_release_withdraw and the reports; members read tally_post_ids and tally_sync_cursor
--                         (policies added only where missing)

begin;

-- ---------------------------------------------------------------- columns and the index (7, 8, 10, 12, 14, 23)
alter table public.tally_post_ids add column if not exists released_at timestamptz;
alter table public.tally_post_ids add column if not exists released_by text;              -- 'bridge' (tally-ingest) | 'owner'
alter table public.tally_post_ids add column if not exists released_why text;
alter table public.tally_post_ids add column if not exists accepted_at timestamptz;        -- 36b's; here too so the functions below hold on a cloud without 36b
alter table public.tally_post_ids add column if not exists accepted_vch text;
alter table public.tally_voucher_versions add column if not exists lines jsonb;            -- [[ledger, amount, hsn, rate, bills], ...]
alter table public.tally_sync_cursor add column if not exists cleared_at timestamptz;
alter table public.tally_sync_cursor add column if not exists cleared_by uuid;
alter table public.tally_sync_cursor add column if not exists cleared_note text;
alter table public.tally_company_lease add column if not exists released_at timestamptz;
alter table public.tally_vouchers add column if not exists fincom_id text;
create index if not exists tally_vouchers_fincom on public.tally_vouchers (book_id, fincom_id) where fincom_id is not null;
alter table public.tally_bridge_releases add column if not exists withdrawn_at timestamptz;
alter table public.tally_bridge_releases add column if not exists withdrawn_by uuid;
alter table public.tally_bridge_releases add column if not exists withdrawn_why text;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_ids' and policyname = 'tally_post_ids_read') then
    create policy tally_post_ids_read on public.tally_post_ids for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_sync_cursor' and policyname = 'tally_sync_cursor_read') then
    create policy tally_sync_cursor_read on public.tally_sync_cursor for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
grant select on public.tally_post_ids, public.tally_sync_cursor to authenticated;

-- ---------------------------------------------------------------- 7. an id released per entry
create or replace function public.tally_post_id_release(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int; acc int; k text := nullif(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g'), '');
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- the entry by its FinCom id (the tag), by FinCom's entry id, or by that id in letters and digits (as the bridge stamps
  -- it); never one Tally accepted (36b: accepted_at): the voucher is in Tally, and freeing the id would let it be doubled
  update tally_post_ids set live = false, released_at = now(), released_by = 'bridge', released_why = left(btrim(coalesce(p_why, '')), 500)
   where job_id = p_job and released_at is null and accepted_at is null
     and (fincom_id = p_id or entry_id = p_id or (k is not null and (regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = k or regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') = k)));
  get diagnostics n = row_count;
  if n = 0 then
    select count(*) into acc from tally_post_ids where job_id = p_job and accepted_at is not null and released_at is null
       and (fincom_id = p_id or entry_id = p_id or (k is not null and (regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = k or regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') = k)));
    if acc > 0 then return jsonb_build_object('ok', true, 'released', false, 'n', 0, 'why', 'accepted by Tally'); end if;
  end if;
  return jsonb_build_object('ok', true, 'released', n > 0, 'n', n);
end $function$;

-- as migration-32, plus: a released id never turns live again (a Retry of the posting leaves it free), and an id Tally
-- accepted (36b, accepted_at) is never freed by a failed or cancelled posting (the same text as 36b's)
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted (accepted_at) is never freed here (36b); a released id is never revived
    update tally_post_ids set live = (accepted_at is not null and released_at is null) or (new.status not in ('failed', 'cancelled') and released_at is null) where job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;

-- ---------------------------------------------------------------- 8. versions carry their lines
-- the one change the append-only table allows: lines filled once (null -> a value), the rest of the row the same
create or replace function public.tally_voucher_versions_frozen() returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  if tg_op = 'UPDATE' and old.lines is null and new.lines is not null and (to_jsonb(new) - 'lines') = (to_jsonb(old) - 'lines') then return new; end if;
  raise exception 'tally_voucher_versions is append-only' using errcode = '42501';
end $function$;

-- the lines an entry holds now, written on the version row of its current AlterID when that row has none yet:
-- [ledger, amount, hsn, rate, bills], bills as [name, type, amount, credit days] (tally_bills, by the line's ledger)
create or replace function public.tally_voucher_version_lines(p_book uuid, p_guids text[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_voucher_versions ver set lines = coalesce(x.lines, '[]'::jsonb)
    from tally_vouchers v
    left join lateral (
      select jsonb_agg(jsonb_build_array(l.ledger, l.amount, l.hsn, l.rate,
               coalesce((select jsonb_agg(jsonb_build_array(b.name, b.type, b.amount, b.credit_days) order by b.name, b.type, b.amount) from tally_bills b
                          where b.book_id = l.book_id and b.guid = l.guid and b.ledger = l.ledger), '[]'::jsonb)) order by l.ledger, l.amount) as lines
        from tally_lines l where l.book_id = v.book_id and l.guid = v.guid) x on true
   where v.book_id = p_book and v.guid = any(p_guids)
     and ver.book_id = v.book_id and ver.tally_guid = v.guid and ver.alter_id = coalesce(v.alter_id, 0) and ver.lines is null;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ---------------------------------------------------------------- 14. origin from the FinCom id (the narration tag kept as the fallback)
create or replace function public.tally_vouchers_origin() returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  if new.fincom_id is null and new.narration ~ 'TDSDesk:[A-Za-z0-9]' then new.fincom_id := substring(new.narration from 'TDSDesk:([A-Za-z0-9._-]+)'); end if;
  if new.fincom_id is not null or new.narration ~ 'TDSDesk:[A-Za-z0-9]' then new.origin := 'fincom'; end if;
  return new;
end $function$;
-- the rows already here: the id from the tag their narration kept (shortNarr keeps it at the end)
update public.tally_vouchers set fincom_id = substring(narration from 'TDSDesk:([A-Za-z0-9._-]+)'), origin = 'fincom'
 where fincom_id is null and narration ~ 'TDSDesk:[A-Za-z0-9._-]';

-- ---------------------------------------------------------------- 11. tally_ingest_day: upsert, mark, never delete an entry
-- p_vouchers: [{guid, alter, type, no, party, narr, cancel, opt, gstin, pos, ref, refDate, cmp, fid}], p_lines: [[guid, ledger,
-- amount, hsn, rate, bills]] as before; "fid" (item 14) is new and may be missing. Answer: ok, day, touched (the days
-- rebuilt), marked (the day's entries not in the file, now deleted_at), sent (entries in the file)
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the entries in the file: inserted, or brought up to date in place (deleted_at cleared); a version row for each AlterID
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, fincom_id, deleted_at)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         tally_nm(x->>'party'), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15),
         case when coalesce(x->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then x->>'fid' end, null
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc
  on conflict (book_id, guid) do update set
     day = excluded.day, alter_id = excluded.alter_id, vtype = excluded.vtype, vno = excluded.vno, party = excluded.party, narration = excluded.narration,
     cancelled = excluded.cancelled, optional = excluded.optional, gstin = excluded.gstin, pos = excluded.pos, ref = excluded.ref, ref_date = excluded.ref_date,
     cmp_gstin = excluded.cmp_gstin, deleted_at = null,
     fincom_id = coalesce(excluded.fincom_id, substring(excluded.narration from 'TDSDesk:([A-Za-z0-9._-]+)'), tally_vouchers.fincom_id),
     origin = case when excluded.fincom_id is not null or excluded.narration ~ 'TDSDesk:[A-Za-z0-9]' then 'fincom' else tally_vouchers.origin end;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  on conflict (book_id, tally_guid, alter_id) do nothing;
  -- the day's entries not in the file: marked, kept (lines and bills kept too)
  update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
  get diagnostics marked = row_count;
  -- a re-sent entry's lines and bills are replaced (its old ones are on its old version row)
  delete from tally_bills b where b.book_id = p_book and b.guid = any(sent);
  delete from tally_lines l where l.book_id = p_book and l.guid = any(sent);
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then p_day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then p_day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x, jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where coalesce(b->>2, '') <> '';
  perform tally_voucher_version_lines(p_book, sent);
  -- the day cache, from live entries only
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(touched);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(touched) and v.deleted_at is null and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at) values (p_book, f, p_day, p_n, p_alter, p_bytes, now())
  on conflict (book_id, day) do update set n = excluded.n, alter_max = excluded.alter_max, bytes = excluded.bytes, at = now();
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0));
end $function$;

-- the reports, as live on staging, with "v.deleted_at is null" where they join tally_vouchers and nothing else changed
create or replace function public.tally_tb(p_client text, p_as_on date)
returns table(ledger text, parent text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_as_on); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
    with lg as (select tally_nm(t.name) as name, max(t.parent) as parent, sum(t.open) as open from tally_ledgers t
                 where t.book_id = bk and t.merged_into is null group by 1),
    mv as (select tally_nm(d.ledger) as ledger, sum(d.amount) m from tally_ledger_day d where d.book_id = bk and d.day between b.from_date and p_as_on group by 1)
    select coalesce(lg.name, mv.ledger), coalesce(lg.parent, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.ledger = lg.name;
end $function$;

create or replace function public.tally_period(p_client text, p_from date, p_to date)
returns table(ledger text, parent text, open numeric, dr numeric, cr numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
  with names as (select l.name as n from tally_ledgers l where l.book_id = bk union select d.ledger from tally_ledger_day d where d.book_id = bk),
  before as (select d.ledger as n, sum(d.amount) as a from tally_ledger_day d where d.book_id = bk and d.day >= b.from_date and d.day < p_from group by d.ledger),
  inside as (select d.ledger as n, sum(d.dr) as dr, sum(d.cr) as cr from tally_ledger_day d where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by d.ledger)
  select x.n, t.parent, coalesce(t.open, 0) + coalesce(be.a, 0), coalesce(i.dr, 0), coalesce(i.cr, 0)
    from names x left join tally_ledgers t on t.book_id = bk and t.name = x.n left join before be on be.n = x.n left join inside i on i.n = x.n
   order by x.n;
end $function$;

create or replace function public.tally_mis(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with led as (
    select l.name, coalesce(l.open, 0) as open, tally_mis_head(l.name, l.chain) as hd,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts') as sales,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry debtors') as deb,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry creditors') as cred,
           exists (select 1 from unnest(l.chain) g where lower(g) in ('bank accounts', 'cash-in-hand', 'bank od a/c', 'bank occ a/c')) as cash
      from tally_ledgers l where l.book_id = bk and l.merged_into is null),
  mv as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as a from tally_ledger_day d
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2),
  sg as (select * from (values ('rev', 1), ('oth', 1), ('pur', -1), ('dir', -1), ('emp', -1), ('exp', -1), ('fin', -1), ('dep', -1), ('tax', -1)) s(hd, sign)),
  hm as (select l.hd, m.ym, round(sum(m.a * s.sign), 2) as v from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  ht as (select hd, round(sum(v), 2) as t, jsonb_object_agg(ym, v) as m from hm group by hd),
  hl as (select l.hd, m.ledger, round(sum(m.a * s.sign), 2) as t from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  tops as (select hd, jsonb_agg(jsonb_build_object('l', ledger, 't', t) order by abs(t) desc, ledger) as led from (select *, row_number() over (partition by hd order by abs(t) desc, ledger) as r from hl) z where r <= 15 group by hd),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  tot as (select mo.ym,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) as income,
           coalesce(sum(hm.v) filter (where hm.hd = 'rev'), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir')), 0) as gross,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp')), 0) as ebitda,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep')), 0) as pbt,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep', 'tax')), 0) as pat
         from months mo left join hm on hm.ym = mo.ym group by mo.ym),
  -- sales by customer: the Sales Accounts lines of each entry, under the entry's party (else its debtor line)
  sl as (select coalesce(nullif(v.party, ''), (select x.ledger from tally_lines x join led dl on dl.name = x.ledger and dl.deb where x.book_id = bk and x.guid = v.guid limit 1), '') as party, sum(t.amount) as a
           from tally_lines t join led l on l.name = t.ledger and l.sales join tally_vouchers v on v.book_id = t.book_id and v.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional group by 1),
  -- balances on the last date
  bal as (select l.name, l.deb, l.cred, l.cash, l.open + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.ledger = l.name and d.day between b.from_date and p_to), 0) as c
            from led l where l.deb or l.cred or l.cash)
  select jsonb_build_object(
    'from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'company', b.company,
    'months', (select jsonb_agg(ym order by ym) from months),
    'heads', coalesce((select jsonb_object_agg(ht.hd, jsonb_build_object('t', ht.t, 'm', ht.m, 'led', coalesce(tops.led, '[]'::jsonb))) from ht left join tops on tops.hd = ht.hd), '{}'::jsonb),
    'income', (select jsonb_build_object('t', round(sum(income), 2), 'm', jsonb_object_agg(ym, round(income, 2))) from tot),
    'gross', (select jsonb_build_object('t', round(sum(gross), 2), 'm', jsonb_object_agg(ym, round(gross, 2))) from tot),
    'ebitda', (select jsonb_build_object('t', round(sum(ebitda), 2), 'm', jsonb_object_agg(ym, round(ebitda, 2))) from tot),
    'pbt', (select jsonb_build_object('t', round(sum(pbt), 2), 'm', jsonb_object_agg(ym, round(pbt, 2))) from tot),
    'pat', (select jsonb_build_object('t', round(sum(pat), 2), 'm', jsonb_object_agg(ym, round(pat, 2))) from tot),
    'sales', jsonb_build_object('total', coalesce((select round(sum(a), 2) from sl), 0),
       'other', coalesce((select round(sum(m.a), 2) from mv m join led l on l.name = m.ledger where l.hd in ('rev', 'oth') and not l.sales), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', party, 't', round(a, 2)) order by a desc) from (select * from sl order by a desc limit 20) z), '[]'::jsonb)),
    'recv', jsonb_build_object('owed', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where deb), 0), 'advance', coalesce((select round(sum(greatest(c, 0)), 2) from bal where deb), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owed', round(-c, 2)) order by c) from (select * from bal where deb and c < 0 order by c limit 20) z), '[]'::jsonb)),
    'pay', jsonb_build_object('owe', coalesce((select round(sum(greatest(c, 0)), 2) from bal where cred), 0), 'advance', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where cred), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owe', round(c, 2)) order by c desc) from (select * from bal where cred and c > 0 order by c desc limit 20) z), '[]'::jsonb)),
    'cash', jsonb_build_object('total', coalesce((select round(sum(-c), 2) from bal where cash), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('l', name, 'bal', round(-c, 2)) order by name) from bal where cash), '[]'::jsonb)),
    'grouped', exists (select 1 from led where hd <> '' limit 1),
    'at', now())
  into res;
  return res;
end $function$;

create or replace function public.tally_gst_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind = 'gst' and what in ('gst', 'gst_rcm', 'gst_import')),
  sales as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null and exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts')),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  -- the tax on documents only (review: the month's set-off and payment entries moved the tax ledgers too): output tax on
  -- entries with a sales or income line, input tax on entries with an expense, purchase or fixed-asset line
  nom as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses', 'fixed assets'))),
  inc as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes'))),
  docs as (select v.guid,
             exists (select 1 from tally_lines x join inc on inc.name = x.ledger where x.book_id = bk and x.guid = v.guid) as outward,
             exists (select 1 from tally_lines x join nom on nom.name = x.ledger where x.book_id = bk and x.guid = v.guid) as doc
             from tally_vouchers v where v.book_id = bk and v.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional),
  tx as (select to_char(t.day, 'YYYYMM') as ym, k.side, k.what, upper(k.tax) as tax, sum(t.amount) as net
           from tally_lines t join k on k.ledger = t.ledger join docs on docs.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to
            and ((k.side = 'output' and docs.outward) or (k.side <> 'output' and docs.doc)) group by 1, 2, 3, 4),
  sv as (select to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as v from tally_ledger_day d join sales s on s.name = d.ledger
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1),
  heads as (select * from (values ('CGST'), ('SGST'), ('IGST'), ('CESS')) h(tax)),
  per as (select mo.ym,
    (select jsonb_object_agg(h.tax, coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and side = 'output' and what = 'gst' and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as out_tax,
    (select jsonb_object_agg(h.tax, coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and side = 'input' and what in ('gst', 'gst_import') and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as in_tax,
    coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'output'), 0) as rcm_out,
    coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'input'), 0) as rcm_in,
    coalesce((select round(v, 2) from sv where sv.ym = mo.ym), 0) as taxable_sales
    from months mo)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'mapped', (select count(*) from k),
    'months', coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'out', out_tax, 'in', in_tax, 'rcmOut', rcm_out, 'rcmIn', rcm_in, 'taxableSales', taxable_sales) order by ym), '[]'::jsonb), 'at', now())
  into res from per;
  return res;
end $function$;

create or replace function public.tally_ledger(p_client text, p_ledger text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype; ob numeric; lines jsonb; nm text := tally_nm(p_ledger);
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  select coalesce((select sum(t.open) from tally_ledgers t where t.book_id = bk and t.merged_into is null and tally_nm(t.name) = nm), 0)
       + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and tally_nm(d.ledger) = nm and d.day >= b.from_date and d.day < p_from), 0)
    into ob;
  select coalesce(jsonb_agg(jsonb_build_array(to_char(l.day, 'YYYYMMDD'), v.vtype, v.vno, v.party, v.narration, l.amount, l.guid) order by l.day, v.vno), '[]'::jsonb)
    into lines
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = bk and tally_nm(l.ledger) = nm and l.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional;
  return jsonb_build_object('open', ob, 'lines', lines, 'from', b.from_date, 'company', b.company, 'daysAt', b.days_at);
end $function$;

create or replace function public.tally_find(p_client text, p_q text, p_from date, p_to date, p_type text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_from); words text[]; amt numeric; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  if regexp_replace(coalesce(p_q, ''), '[₹,\s]', '', 'g') ~ '^\d+(\.\d+)?$' then amt := regexp_replace(p_q, '[₹,\s]', '', 'g')::numeric;
  else words := array_remove(string_to_array(lower(trim(coalesce(p_q, ''))), ' '), ''); end if;
  with hit as (
    select v.guid, v.day, v.vtype, v.vno, v.party, v.narration, v.optional,
           (select coalesce(sum(l.amount) filter (where l.amount > 0), 0) from tally_lines l where l.book_id = bk and l.guid = v.guid) as tot,
           (select jsonb_agg(jsonb_build_array(l.ledger, l.amount)) from tally_lines l where l.book_id = bk and l.guid = v.guid) as ent
      from tally_vouchers v
     where v.book_id = bk and v.day between p_from and p_to and v.deleted_at is null and not v.cancelled
       and (p_type is null or p_type = '' or v.vtype = p_type)
       and (case when amt is not null then exists (select 1 from tally_lines l where l.book_id = bk and l.guid = v.guid and abs(abs(l.amount) - amt) < 1)
                 when coalesce(array_length(words, 1), 0) = 0 then true
                 else (select bool_and(position(w in lower(concat_ws(' ', v.party, v.narration, v.vno, v.vtype,
                          (select string_agg(l.ledger, ' ') from tally_lines l where l.book_id = bk and l.guid = v.guid)))) > 0) from unnest(words) w) end)
  )
  select jsonb_build_object('n', (select count(*) from hit), 'total', (select coalesce(sum(tot) filter (where not optional), 0) from hit),
    'opt', (select count(*) filter (where optional) from hit),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(to_char(h.day, 'YYYYMMDD'), h.vtype, h.vno, h.party, h.narration, h.tot, h.guid, h.ent, h.optional) order by h.day, h.vno, h.guid)
                        from (select * from hit order by day, vno, guid limit greatest(1, least(coalesce(p_limit, 500), 5000)) offset greatest(0, coalesce(p_offset, 0))) h), '[]'::jsonb))
    into res;
  return res;
end $function$;

create or replace function public.tally_vouchers_in(p_client text, p_from date, p_to date, p_ledger text default null, p_types text[] default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  with bk as (select tally_pick(p_client, p_to) b),
  v as (select v.* from tally_vouchers v, bk where v.book_id = bk.b and v.day between p_from and p_to and v.deleted_at is null
          and (p_types is null or v.vtype = any(p_types))
          and (p_ledger is null or exists (select 1 from tally_lines l where l.book_id = v.book_id and l.guid = v.guid and l.ledger = tally_nm(p_ledger)))
        order by v.day, v.vno limit 20000)
  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(v.day, 'YYYYMMDD'), 'type', v.vtype, 'number', v.vno, 'party', v.party, 'narration', v.narration, 'guid', v.guid,
      'optional', case when v.optional then 'Yes' else 'No' end, 'cancelled', case when v.cancelled then 'Yes' else 'No' end,
      'reference', v.ref, 'referenceDate', coalesce(to_char(v.ref_date, 'YYYYMMDD'), ''), 'cmpGstin', v.cmp_gstin, 'gstin', v.gstin,
      'entries', (select coalesce(jsonb_agg(jsonb_build_object('ledger', l.ledger, 'amount', l.amount::text)), '[]'::jsonb) from tally_lines l where l.book_id = v.book_id and l.guid = v.guid))
    order by v.day, v.vno), '[]'::jsonb) from v;
$function$;

-- ---------------------------------------------------------------- 10. clear the baseline
create or replace function public.tally_baseline_clear(p_book uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); note text := left(btrim(coalesce(p_note, '')), 500); c tally_sync_cursor%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can clear a company''s baseline' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = f) then raise exception 'not a company of your firm'; end if;
  if note = '' then raise exception 'say in a note what was done (a fresh baseline taken, a backup restored and re-read, ...)'; end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  update tally_sync_cursor set state = 'ok', cleared_at = now(), cleared_by = auth.uid(), cleared_note = note, updated_at = now()
   where book_id = p_book returning * into c;
  if c.book_id is null then raise exception 'this company has no sync record yet (nothing read from it since FinCom Bridge 2.1.4)'; end if;
  return jsonb_build_object('ok', true, 'state', c.state, 'cleared', c.cleared_at, 'by', c.cleared_by, 'note', c.cleared_note);
end $function$;

-- ---------------------------------------------------------------- 12. the lease: released, kept, reused
create or replace function public.tally_lease_take(p_firm uuid, p_book uuid, p_holder text, p_device uuid, p_ttl integer, p_info jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare l tally_company_lease%rowtype; ttl int := greatest(30, least(coalesce(p_ttl, 120), 900));
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext('lease' || p_book::text));
  select * into l from tally_company_lease where book_id = p_book;
  -- held by another bridge only while its lease is live: not released, not expired
  if l.book_id is not null and l.holder <> p_holder and l.released_at is null and l.until > now() then
    return jsonb_build_object('ok', true, 'held', true, 'holder', jsonb_build_object('bridge', l.holder, 'computer', l.info->>'computer', 'user', l.info->>'user',
      'until', to_char(l.until at time zone 'Asia/Kolkata', 'HH24:MI'), 'untilAt', l.until));
  end if;
  insert into tally_company_lease (book_id, firm_id, holder, device_id, info, taken_at, until, released_at)
  values (p_book, p_firm, p_holder, p_device, coalesce(p_info, '{}'::jsonb), now(), now() + make_interval(secs => ttl), null)
  on conflict (book_id) do update set holder = excluded.holder, device_id = excluded.device_id, info = excluded.info,
     taken_at = case when tally_company_lease.holder = excluded.holder and tally_company_lease.released_at is null and tally_company_lease.until > now() then tally_company_lease.taken_at else now() end,
     until = excluded.until, released_at = null;
  return jsonb_build_object('ok', true, 'held', false, 'lease', jsonb_build_object('until', now() + make_interval(secs => ttl), 'ttl', ttl));
end $function$;

create or replace function public.tally_lease_release(p_firm uuid, p_book uuid, p_holder text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_company_lease set released_at = now() where book_id = p_book and firm_id = p_firm and holder = p_holder and released_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'released', n > 0);
end $function$;

-- ---------------------------------------------------------------- 13. balances as on a date
create or replace function public.tally_balances_on(p_book uuid, p_as_on date)
returns table(ledger text, parent text, primary_group text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype;
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null or b.firm_id is distinct from my_firm() then raise exception 'not a company of your firm' using errcode = '42501'; end if;
  return query
    with lg as (select l.name, l.parent, l.primary_group, coalesce(l.open, 0) as open from tally_ledgers l
                 where l.book_id = p_book and l.merged_into is null and l.deleted_at is null),
    mv as (select d.ledger as name, sum(d.amount) as m from tally_ledger_day d where d.book_id = p_book and d.day >= b.from_date and d.day <= p_as_on group by d.ledger)
    select coalesce(lg.name, mv.name), coalesce(lg.parent, ''), coalesce(lg.primary_group, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.name = lg.name
     where lg.name is not null
        or not exists (select 1 from tally_ledgers x where x.book_id = p_book and x.name = mv.name)   -- a day row under a name the masters lack: shown, as tally_tb does
     order by 1;
end $function$;

-- ---------------------------------------------------------------- 23. withdraw a bridge version
create or replace function public.tally_release_withdraw(p_version text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); why text := left(btrim(coalesce(p_why, '')), 500); r tally_bridge_releases%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can withdraw a bridge version' using errcode = '42501'; end if;
  if why = '' then raise exception 'give the reason the version is withdrawn'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if not found then raise exception 'version % has not been piloted or approved here; nothing to withdraw', v; end if;
  if r.withdrawn_at is not null then return jsonb_build_object('ok', true, 'version', v, 'withdrawn', r.withdrawn_at, 'already', true); end if;
  update tally_bridge_releases set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_why = why where firm_id = f and version = v;
  return jsonb_build_object('ok', true, 'version', v, 'withdrawn', now());
end $function$;

-- as migration-34 part E, plus: a withdrawn version may be piloted again; the withdrawal (and an approval it had) is
-- cleared and written into note, so a new working day on the pilot decides it afresh
create or replace function public.tally_release_pilot(p_version text, p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); r tally_bridge_releases%rowtype; was text := '';
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can start a pilot' using errcode = '42501'; end if;
  if v !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then raise exception 'not a bridge version (like 2.1.5)'; end if;
  if p_device is null or not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if found and r.withdrawn_at is not null then
    was := 'withdrawn ' || to_char(r.withdrawn_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' by ' || coalesce(r.withdrawn_by::text, '?') || ': ' || coalesce(r.withdrawn_why, '')
        || case when r.approved_at is not null then ' (approved ' || to_char(r.approved_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' by ' || coalesce(r.approved_by::text, '?') || ')' else '' end
        || '; piloted again ' || to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' by ' || coalesce(auth.uid()::text, '?');
  elsif found and r.approved_at is not null then raise exception 'version % is approved for all computers already', v;
  elsif found and r.pilot_device = p_device and r.pilot_started_at is not null then
    return jsonb_build_object('ok', true, 'version', v, 'pilot', p_device, 'started', r.pilot_started_at, 'already', true);
  end if;
  -- a new pilot (or another pilot computer): the working day starts again, with no evidence yet
  insert into tally_bridge_releases (firm_id, version, pilot_device, pilot_started_at, pilot_by) values (f, v, p_device, now(), auth.uid())
  on conflict (firm_id, version) do update set pilot_device = excluded.pilot_device, pilot_started_at = excluded.pilot_started_at, pilot_by = excluded.pilot_by,
    pilot_seen_at = null, pilot_last_seen_at = null, pilot_beats = 0, pilot_self_stop = null, pilot_allowlist_measured = null, pilot_allowlist_hash = null,
    withdrawn_at = null, withdrawn_by = null, withdrawn_why = null,
    approved_at = case when was <> '' then null else tally_bridge_releases.approved_at end,
    approved_by = case when was <> '' then null else tally_bridge_releases.approved_by end,
    note = case when was <> '' then left(tally_bridge_releases.note || case when tally_bridge_releases.note <> '' then E'\n' else '' end || was, 4000) else tally_bridge_releases.note end;
  return jsonb_build_object('ok', true, 'version', v, 'pilot', p_device, 'started', now(), 'was', nullif(was, ''));
end $function$;

-- as migration-34 part E (live on staging), plus: a withdrawn version is refused
create or replace function public.tally_release_approve(p_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); r tally_bridge_releases%rowtype; pc text;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can approve a bridge version' using errcode = '42501'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if not found or r.pilot_started_at is null or r.pilot_device is null then raise exception 'version % has not been on a pilot computer; start a pilot first', v; end if;
  if r.withdrawn_at is not null then
    raise exception 'version % was withdrawn % (%); start a new pilot before it can be approved', v, to_char(r.withdrawn_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), coalesce(r.withdrawn_why, '');
  end if;
  if r.approved_at is not null then return jsonb_build_object('ok', true, 'version', v, 'approved', r.approved_at, 'already', true); end if;
  select name into pc from tally_devices where id = r.pilot_device;
  pc := coalesce(pc, 'the pilot computer');
  -- a working day on the pilot: 20 hours since it started, seen on the version, used on it for 6 hours, never self-stopped
  if r.pilot_started_at > now() - interval '20 hours' then
    raise exception 'the pilot of % on % has not run a working day yet: it started %; approve after %', v, pc,
      to_char(r.pilot_started_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), to_char((r.pilot_started_at + interval '20 hours') at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI');
  end if;
  if r.pilot_seen_at is null or r.pilot_seen_at < r.pilot_started_at then
    raise exception '% has not been seen running % since the pilot started; it must run it first', pc, v;
  end if;
  if coalesce(r.pilot_last_seen_at, r.pilot_seen_at) < r.pilot_seen_at + interval '6 hours' then
    raise exception '% has run % for less than 6 hours (seen % to %); let it run a working day', pc, v,
      to_char(r.pilot_seen_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), to_char(coalesce(r.pilot_last_seen_at, r.pilot_seen_at) at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI');
  end if;
  if r.pilot_self_stop is not null then
    raise exception '% stopped reading by itself while on % (%); not approved', pc, v, coalesce(r.pilot_self_stop ->> 'reason', '');
  end if;
  if r.pilot_allowlist_measured is distinct from true then
    raise exception '% reports its request allow-list on % as %; every request must be measured before the version goes to other computers', pc, v,
      case when r.pilot_allowlist_measured is null then 'not yet reported' else 'not measured' end;
  end if;
  update tally_bridge_releases set approved_at = now(), approved_by = auth.uid() where firm_id = f and version = v;
  return jsonb_build_object('ok', true, 'version', v, 'approved', now());
end $function$;

-- ---------------------------------------------------------------- grants
revoke all on function public.tally_post_id_release(uuid, text, text), public.tally_voucher_version_lines(uuid, text[]),
  public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer), public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb),
  public.tally_lease_release(uuid, uuid, text), public.tally_post_ids_sync() from public, anon, authenticated;
grant execute on function public.tally_post_id_release(uuid, text, text), public.tally_voucher_version_lines(uuid, text[]),
  public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer), public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb),
  public.tally_lease_release(uuid, uuid, text) to service_role;
revoke all on function public.tally_baseline_clear(uuid, text), public.tally_balances_on(uuid, date), public.tally_release_withdraw(text, text),
  public.tally_release_pilot(text, uuid), public.tally_release_approve(text) from public, anon;
grant execute on function public.tally_baseline_clear(uuid, text), public.tally_balances_on(uuid, date), public.tally_release_withdraw(text, text),
  public.tally_release_pilot(text, uuid), public.tally_release_approve(text) to authenticated, service_role;
revoke all on function public.tally_tb(text, date), public.tally_period(text, date, date), public.tally_mis(text, date, date), public.tally_gst_summary(text, date, date),
  public.tally_ledger(text, text, date, date), public.tally_find(text, text, date, date, text, integer, integer), public.tally_vouchers_in(text, date, date, text, text[]) from public, anon;
grant execute on function public.tally_tb(text, date), public.tally_period(text, date, date), public.tally_mis(text, date, date), public.tally_gst_summary(text, date, date),
  public.tally_ledger(text, text, date, date), public.tally_find(text, text, date, date, text, integer, integer), public.tally_vouchers_in(text, date, date, text, text[]) to authenticated, service_role;

commit;
