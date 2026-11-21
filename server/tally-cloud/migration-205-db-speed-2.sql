-- Migration 205 (21-Nov-2026, branch next-fix-dbspeed; written, NOT run: the owner reads it and runs it). After 204 or
-- before it; it needs nothing of 199-204. The owner: "every documents, page, cloud should be lightening fast ... effect
-- should remain same". Every answer and every access the same as before (tests/run_migration205.py):
--
--   1. staging's performance advisor: five row-security policies asked auth.uid() once per row; now once per statement,
--      (select auth.uid()), the same rows and the same writes allowed (each altered in place, and only if its words are
--      staging's: otherwise the file stops and says which). The 21 foreign keys it names as having no index get one
--      each (CONCURRENTLY, if not there). tally_sync_reads has no key a primary key could be made of without a new
--      column, so it is left as it is.
--   2. gst_calc_gstins (38 ms, 1,234 calls) read every entry of the book for its company GSTINs (a book has a few): now
--      one look-up per distinct GSTIN (a loose scan on a new index, tally_vouchers (book_id, cmp_gstin)).
--   3. gst_itc_inputs (106 ms): its GSTINs as in 2 (before: every live entry sorted). The rest as it was. (Finding the
--      first and last dated month from each end of the book was tried: slower on staging, so not done.)
--
-- No table, column or policy added, nothing dropped, no row changed. One transaction with lock_timeout 3 s for the
-- functions and the policies; then the indexes, CONCURRENTLY, with lock_timeout 3 s (if one times out, run the file
-- again: everything in it is if-not-there, create-or-replace or the same alter). Safe twice.

begin;
set local lock_timeout = '3s';

create or replace function public.gst_calc_gstins(p_book uuid, p_client text)
 returns text[]
 language sql stable security definer set search_path = public, pg_temp
as $function$
  -- 205: the book's GSTINs by a loose index scan (one look-up per distinct GSTIN: a book has a few)
  with recursive cmp(g) as (
    select (select v.cmp_gstin from tally_vouchers v where v.book_id = p_book and v.cmp_gstin > '' order by v.cmp_gstin limit 1)
    union all
    select (select v.cmp_gstin from tally_vouchers v where v.book_id = p_book and v.cmp_gstin > cmp.g order by v.cmp_gstin limit 1) from cmp where cmp.g is not null)
  select coalesce(array_agg(distinct g order by g), '{}'::text[]) from (
    select upper(cmp.g) g from cmp where cmp.g is not null
    union select upper(c.data->>'gstin') from tally_books b join clients c on c.firm_id = b.firm_id and c.id = p_client
     where b.book_id = p_book and coalesce(c.data->>'gstin', '') <> '') x
   where g ~ '^\d{2}[A-Z0-9]{13}$';
$function$;
revoke all on function public.gst_calc_gstins(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_gstins(uuid, text) to service_role;

create or replace function public.gst_itc_inputs(p_book uuid, p_reg text, p_engine text, p_version text)
 returns jsonb
 language sql stable security definer set search_path = public, pg_temp
as $function$
  with recursive nb as (select distinct b.ledger, b.name from gst_itc_bill b where b.book_id = p_book and b.nb and b.reg = coalesce(p_reg, '')),
  live as (select v.guid, v.day, v.cmp_gstin, v.cancelled, v.optional, v.vno from tally_vouchers v where v.book_id = p_book and v.deleted_at is null),
  dated as (select l.day from live l where exists (select 1 from tally_lines x where x.book_id = p_book and x.guid = l.guid and coalesce(x.ledger, '') <> '')
              or (coalesce(l.cancelled, false) and coalesce(l.vno, '') <> '')),
  -- 205: the GSTINs of the live entries by a loose index scan (one look-up per distinct GSTIN: a book has a few)
  cmp(g) as (select (select v.cmp_gstin from tally_vouchers v where v.book_id = p_book and v.cmp_gstin > '' and v.deleted_at is null order by v.cmp_gstin limit 1)
             union all
             select (select v.cmp_gstin from tally_vouchers v where v.book_id = p_book and v.cmp_gstin > cmp.g and v.deleted_at is null order by v.cmp_gstin limit 1)
               from cmp where cmp.g is not null)
  select jsonb_build_object(
    'first', (select to_char(min(d.day), 'YYYYMM') from dated d),
    'last', (select to_char(max(d.day), 'YYYYMM') from dated d),
    'gstins', (select coalesce(jsonb_agg(distinct upper(cmp.g)), '[]'::jsonb) from cmp where cmp.g is not null),
    'months', (select coalesce(jsonb_object_agg(q.ym, q.rows), '{}'::jsonb) from (
                 select m.ym, jsonb_agg(jsonb_build_object('reg', m.reg, 'sec', m.sec, 'k1', m.k1, 'k2', m.k2, 'k3', m.k3, 'n', m.n, 'taxable', m.taxable, 'igst', m.igst,
                          'cgst', m.cgst, 'sgst', m.sgst, 'cess', m.cess, 'qty', m.qty) order by m.sec, m.k1, m.k2, m.k3) rows
                   from gst_month m where m.book_id = p_book and m.reg = coalesce(p_reg, '') and m.sec <> '*' group by m.ym) q),
    'status', (select coalesce(jsonb_object_agg(m.ym, m.status), '{}'::jsonb) from gst_month m where m.book_id = p_book and m.reg = '' and m.sec = '*'),
    'docs', (select coalesce(jsonb_agg(jsonb_build_object('guid', d.guid, 'doc', d.doc) order by d.doc->>'bookDate', d.guid), '[]'::jsonb)
               from gst_itc_doc d where d.book_id = p_book and d.reg in (coalesce(p_reg, ''), '')),
    'bills', (select coalesce(jsonb_agg(jsonb_build_object('guid', b.guid, 'seq', b.seq, 'rec', b.rec) order by b.day, b.guid, b.seq), '[]'::jsonb)
                from gst_itc_bill b join nb on nb.ledger = b.ledger and nb.name = b.name where b.book_id = p_book),
    'moves', (select coalesce(jsonb_object_agg(z.ledger, z.ms), '{}'::jsonb) from (
                select q.ledger, jsonb_agg(jsonb_build_array(q.ym, q.amt) order by q.ym) ms from (
                  select x.ledger, to_char(l.day, 'YYYYMM') ym, sum(x.amount) amt
                    from tally_lines x join live l on l.guid = x.guid
                   where x.book_id = p_book and x.ledger in (select distinct nb.ledger from nb)
                     and not coalesce(l.cancelled, false) and not coalesce(l.optional, false)
                   group by x.ledger, to_char(l.day, 'YYYYMM')) q group by q.ledger) z),
    'carry', (select coalesce(jsonb_object_agg(c.ym, c.carry), '{}'::jsonb) from gst_itc_month c
               where c.book_id = p_book and c.reg = coalesce(p_reg, '') and c.engine = coalesce(p_engine, '') and c.version = coalesce(p_version, '') and coalesce(p_version, '') <> ''),
    'refs', (select coalesce(jsonb_object_agg(c.ym, c.ref), '{}'::jsonb) from gst_itc_month c
               where c.book_id = p_book and c.reg = coalesce(p_reg, '') and c.engine = coalesce(p_engine, '') and c.version = coalesce(p_version, '') and coalesce(p_version, '') <> '' and c.ref is not null));
$function$;
revoke all on function public.gst_itc_inputs(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.gst_itc_inputs(uuid, text, text, text) to service_role;

-- assistant_mismatch_status_owner_read (select on assistant_mismatch_status)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_mismatch_status' and policyname = 'assistant_mismatch_status_owner_read'
                   and replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()') = '(EXISTS ( SELECT 1
   FROM (assistant_mismatches x
     JOIN members m ON ((m.firm_id = x.firm_id)))
  WHERE ((x.id = assistant_mismatch_status.mismatch_id) AND (x.firm_id = my_firm()) AND (m.user_id = auth.uid()) AND m.active AND (m.role = ''owner''::text))))') then
    raise exception 'migration 205: the policy assistant_mismatch_status_owner_read is not as staging has it (21-Nov-2026): not altered';
  end if;
end $$;
alter policy assistant_mismatch_status_owner_read on public.assistant_mismatch_status using ((EXISTS ( SELECT 1
   FROM (assistant_mismatches x
     JOIN members m ON ((m.firm_id = x.firm_id)))
  WHERE ((x.id = assistant_mismatch_status.mismatch_id) AND (x.firm_id = my_firm()) AND (m.user_id = (select auth.uid())) AND m.active AND (m.role = 'owner'::text)))));

-- assistant_mismatches_owner_read (select on assistant_mismatches)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_mismatches' and policyname = 'assistant_mismatches_owner_read'
                   and replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()') = '((firm_id = my_firm()) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.user_id = auth.uid()) AND (m.firm_id = assistant_mismatches.firm_id) AND m.active AND (m.role = ''owner''::text)))))') then
    raise exception 'migration 205: the policy assistant_mismatches_owner_read is not as staging has it (21-Nov-2026): not altered';
  end if;
end $$;
alter policy assistant_mismatches_owner_read on public.assistant_mismatches using (((firm_id = my_firm()) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.user_id = (select auth.uid())) AND (m.firm_id = assistant_mismatches.firm_id) AND m.active AND (m.role = 'owner'::text))))));

-- assistant_uploads_add (insert on assistant_uploads)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_uploads' and policyname = 'assistant_uploads_add'
                   and replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()') = '((firm_id = my_firm()) AND can_write() AND (created_by = auth.uid()) AND ((path ~~ ((my_firm())::text || ''/%/uploads/%''::text)) OR (path ~~ ((my_firm())::text || ''/%/notices/%''::text))))') then
    raise exception 'migration 205: the policy assistant_uploads_add is not as staging has it (21-Nov-2026): not altered';
  end if;
end $$;
alter policy assistant_uploads_add on public.assistant_uploads with check (((firm_id = my_firm()) AND can_write() AND (created_by = (select auth.uid())) AND ((path ~~ ((my_firm())::text || '/%/uploads/%'::text)) OR (path ~~ ((my_firm())::text || '/%/notices/%'::text)))));

-- client_timings_insert_own (insert on client_timings)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_timings' and policyname = 'client_timings_insert_own'
                   and replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()') = '((user_id = auth.uid()) AND (firm_id = my_firm()) AND (at > (now() - ''00:05:00''::interval)) AND (at < (now() + ''00:05:00''::interval)))') then
    raise exception 'migration 205: the policy client_timings_insert_own is not as staging has it (21-Nov-2026): not altered';
  end if;
end $$;
alter policy client_timings_insert_own on public.client_timings with check (((user_id = (select auth.uid())) AND (firm_id = my_firm()) AND (at > (now() - '00:05:00'::interval)) AND (at < (now() + '00:05:00'::interval))));

-- client_timings_read_owner (select on client_timings)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_timings' and policyname = 'client_timings_read_owner'
                   and replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()') = '(is_superadmin() OR ((firm_id = my_firm()) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.user_id = auth.uid()) AND (m.firm_id = client_timings.firm_id) AND (m.role = ''owner''::text) AND COALESCE(m.active, true))))))') then
    raise exception 'migration 205: the policy client_timings_read_owner is not as staging has it (21-Nov-2026): not altered';
  end if;
end $$;
alter policy client_timings_read_owner on public.client_timings using ((is_superadmin() OR ((firm_id = my_firm()) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.user_id = (select auth.uid())) AND (m.firm_id = client_timings.firm_id) AND (m.role = 'owner'::text) AND COALESCE(m.active, true)))))));

commit;

set lock_timeout = '3s';
-- 2, 3: the company GSTINs of a book, one look-up each
create index concurrently if not exists tally_vouchers_cmp_gstin on public.tally_vouchers (book_id, cmp_gstin);
-- 1: the foreign keys the advisor names (a delete of the row they point at no longer reads the whole table)
create index concurrently if not exists assistant_notice_events_notice_id_fkey_idx on public.assistant_notice_events (notice_id);
create index concurrently if not exists call_batch_members_firm_id_fkey_idx on public.call_batch_members (firm_id);
create index concurrently if not exists call_captions_batch_id_fkey_idx on public.call_captions (batch_id);
create index concurrently if not exists call_captions_firm_id_fkey_idx on public.call_captions (firm_id);
create index concurrently if not exists call_captions_participant_id_fkey_idx on public.call_captions (participant_id);
create index concurrently if not exists call_consents_firm_id_fkey_idx on public.call_consents (firm_id);
create index concurrently if not exists call_consents_participant_id_fkey_idx on public.call_consents (participant_id);
create index concurrently if not exists call_consents_recording_id_fkey_idx on public.call_consents (recording_id);
create index concurrently if not exists call_invites_firm_id_fkey_idx on public.call_invites (firm_id);
create index concurrently if not exists call_messages_firm_id_fkey_idx on public.call_messages (firm_id);
create index concurrently if not exists call_messages_participant_id_fkey_idx on public.call_messages (participant_id);
create index concurrently if not exists call_pieces_firm_id_fkey_idx on public.call_pieces (firm_id);
create index concurrently if not exists call_recordings_batch_id_fkey_idx on public.call_recordings (batch_id);
create index concurrently if not exists call_recordings_firm_id_fkey_idx on public.call_recordings (firm_id);
create index concurrently if not exists call_remote_sessions_room_id_fkey_idx on public.call_remote_sessions (room_id);
create index concurrently if not exists call_transcripts_batch_id_fkey_idx on public.call_transcripts (batch_id);
create index concurrently if not exists call_transcripts_firm_id_fkey_idx on public.call_transcripts (firm_id);
create index concurrently if not exists firm_signals_firm_id_fkey_idx on public.firm_signals (firm_id);
create index concurrently if not exists subscriptions_plan_id_fkey_idx on public.subscriptions (plan_id);
create index concurrently if not exists tally_bridge_update_asks_firm_id_fkey_idx on public.tally_bridge_update_asks (firm_id);
create index concurrently if not exists tally_work_claims_firm_id_fkey_idx on public.tally_work_claims (firm_id);
reset lock_timeout;
