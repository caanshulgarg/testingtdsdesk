-- Migration 215 (23-Nov-2026, branch next-db-load). Written and tested here (tests/run_migration215_dbload.py on pg_stand);
-- NOT run anywhere: the coordinator runs it on staging after the review. Then, separately, migration-215-indexes.sql
-- (python3 tools/apply_concurrent_indexes.py --run "<runner>" server/tally-cloud/migration-215-indexes.sql).
--
-- Less work for the database (staging, a Micro compute, went down twice on 23-Nov-2026). What pg_stat_statements showed
-- over 3 h 41 min after the restart, and what this migration does about it:
--   1. records: 445 saves (PostgREST upserts) wrote 3,895 rows of 179 (42 MB of WAL, a quarter of all the statements'
--      WAL; 179 ms each). Most were the same data sent again: a browser's own save comes back through Realtime with the
--      keys in the database's order, the browser's mark of it then differs from its own copy, and the record is sent again
--      at the next sync (every 45 s while a page is open; the app's side is fixed in src/js/27, cloudApplyNow). Every such
--      write was a new row version (no HOT: updated_at is indexed), its large data toasted and logged again, decoded by
--      Realtime and sent to every open page of the firm.
--      records_skip_same: a BEFORE UPDATE trigger, h_records_skip_same, that drops an update which changes nothing of
--      the record AS SENT (every column but updated_at and updated_by, columns added later included): no new row
--      version, no WAL, no Realtime change, updated_at not moved (there is nothing new for another computer to pull).
--      It runs BEFORE the guards (BEFORE triggers run in name order: after console_company_off_records, before
--      inbox_guard, records_touch and sync_guard): a write a guard puts back to the stored row (sync_guard keeping keys
--      a page sent empty - staging's sync_refused: ledTpl, postLog, crossBook - or inbox_guard keeping a status) is still
--      written, updated_at moved, so the page that sent it gets the server's copy back (review of 9b6e65341). A real
--      change, a deletion and a restore are as before.
--   2. tally_read_view(): 1.2 s a call (the page's "which Tally reads this company", at most once a minute a page). The
--      planner folded the lateral "tally_read_serving(...) as srv" into each place srv is used, so the serving bridges of
--      every linked book were worked out 3 to 5 times. The same function with OFFSET 0 on that lateral (evaluated once a
--      book): on staging's data the same answer, byte for byte, in 147 ms instead of 440-560 ms, 4,358 buffers instead
--      of 12,261. Replaced only when the function on the database is migration 196's (or already this one's).
--   3. (migration-215-indexes.sql) two small indexes for tally-ingest's beat, which reads a bridge's held lines and their
--      ":resolved" rows by line id without the book (2,600 buffers a read, ~5,600 reads), and for tally_read_view's own
--      "already resolved" check.
-- Not done here (see the branch's report): no table is taken out of supabase_realtime - every table in it has a page
-- listening (src/js/54-live-sync.js, src/js/99-firm-gate.js), each subscription filtered by firm_id except firm_signals
-- (one row a firm, read under RLS).
-- ADD-ONLY: one new function and its trigger; tally_read_view replaced by the same query (OFFSET 0 added); no table,
-- column, row or policy changed or dropped. Safe to run twice. One transaction, lock_timeout 10 s.
-- UNDO (by hand, if ever needed):
--   drop trigger if exists h_records_skip_same on public.records; drop function if exists public.records_skip_same();
--   and migration 196's tally_read_view (server/tally-cloud/migration-196-recorder-no-held.sql) run again.
begin;
set local lock_timeout = '10s';

-- Names first: the function and trigger this migration makes must be absent or this migration's own (its comment);
-- tally_read_view must be migration 196's or this one's. Anything else stops the migration here, naming it.
do $names$
declare bad text[] := '{}'; src text;
begin
  if to_regclass('public.records') is null then raise exception 'migration 215: public.records is not on this database. Nothing was changed.'; end if;
  if to_regprocedure('public.my_firm()') is null then raise exception 'migration 215: public.my_firm() is not on this database. Nothing was changed.'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'records_skip_same'
               and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'db load (migration 215)') then bad := bad || 'function records_skip_same'::text; end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.records'::regclass and t.tgname = 'h_records_skip_same'
               and coalesce(obj_description(t.oid, 'pg_trigger'), '') <> 'db load (migration 215)') then bad := bad || 'trigger h_records_skip_same on records'::text; end if;
  foreach src in array array['tally_recorder_lines_firm_line', 'tally_recorder_lines_held_bridge'] loop
    if to_regclass('public.' || src) is not null and coalesce(obj_description(to_regclass('public.' || src), 'pg_class'), '') <> 'db load (migration 215)' then bad := bad || ('index ' || src); end if;
  end loop;
  select md5(p.prosrc) into src from pg_proc p where p.oid = to_regprocedure('public.tally_read_view()');
  if src is null then bad := bad || 'function tally_read_view (not here: run migration 146 and 196 first)'::text;
  elsif src not in ('28afcabde810e6365e2e530fea48f34e',      -- migration 196's, as on staging on 23-Nov-2026
                    '8d7db75f64ea4ec7c9c8ad47bcb16cfb') then  -- this migration's
    bad := bad || 'function tally_read_view (changed since migration 196)'::text;
  end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 215: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- 1. records: an update that changes nothing of the record as sent is not written. Not SECURITY DEFINER: it reads only
-- the row (a trigger function needs no EXECUTE right of the writer)
create or replace function public.records_skip_same() returns trigger
language plpgsql set search_path = public, pg_temp as $function$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    return null;            -- the same record: nothing written (no row version, no WAL, no Realtime change)
  end if;
  return new;
end $function$;
comment on function public.records_skip_same() is 'db load (migration 215)';
revoke all on function public.records_skip_same() from public, anon, authenticated, service_role;

do $trg$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.records'::regclass and tgname = 'h_records_skip_same') then
    -- BEFORE triggers run in name order: h_ after console_company_off_records, before inbox_guard, records_touch, sync_guard
    create trigger h_records_skip_same before update on public.records for each row execute function public.records_skip_same();
    comment on trigger h_records_skip_same on public.records is 'db load (migration 215)';
  end if;
end $trg$;

-- 2. tally_read_view(): migration 196's query, the serving bridges of a book worked out once (offset 0)
create or replace function public.tally_read_view()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm();
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'books', (select coalesce(jsonb_agg(z.j), '[]'::jsonb) from (
    select jsonb_build_object('book', l.book_id, 'client', l.client_id, 'linkDevice', l.device_id, 'linkHeardAt', tally_read_heard(l.device_id),
      'serving', sv.srv, 'fetchOn', fo.fon,
      -- the held lines the cloud asks a serving bridge again (tally-ingest heldOwnLines' follow rules)
      'reask', case when jsonb_array_length(sv.srv) > 0 then (
        select coalesce(jsonb_agg(h.id), '[]'::jsonb) from (
          select x.id from tally_recorder_lines x
           where x.firm_id = f and x.book_id = l.book_id and x.state in ('held', 'fetching') and x.event in ('created', 'altered', 'imported')     -- 196
             and coalesce(x.line_id, '') <> '' and x.line_id not like '%:resolved'
             -- the serving bridge's own acceptance rules (bridge-go applyHeldLines): the line's company GUID, not empty, the
             -- link's; a MasterID or a type and number to ask Tally by; the company still this book; not waiting for a ledger
             and nullif(lower(btrim(coalesce(x.company_guid, ''))), '') = nullif(lower(btrim(coalesce(l.company_guid, ''))), '')
             and ((length(regexp_replace(coalesce(x.master_id::text, ''), '\D', '', 'g')) between 1 and 18 and regexp_replace(coalesce(x.master_id::text, ''), '\D', '', 'g') ~ '[1-9]') or (btrim(coalesce(x.vch_type, '')) <> '' and btrim(coalesce(x.vch_no, '')) <> ''))
             and exists (select 1 from tally_companies c where c.firm_id = f and c.company = x.company and c.book_id = l.book_id and c.client_id is not null)
             and coalesce(x.held_why, '') not like 'waiting for the ledger%'
             and not exists (select 1 from jsonb_array_elements(sv.srv) s where s ->> 'device' = x.device_id::text and s ->> 'bridge' = x.bridge)
             and (x.received_at > now() - interval '7 days'
                  or (x.received_at > now() - interval '30 days'
                      and (x.held_why like '%FinCom does not ask Tally for this company''s entries%' or x.held_why like '%Tally did not answer in time for this entry when asked again%')
                      and exists (select 1 from jsonb_array_elements(sv.srv) s where coalesce(s ->> 'version', '') ~ '^\d+\.\d+\.\d+$'
                                    and string_to_array(s ->> 'version', '.')::int[] >= array[2, 3, 4])))
             and not exists (select 1 from tally_recorder_lines y where y.firm_id = f and y.line_id = x.line_id || ':resolved')
             and not exists (select 1 from tally_month_locks k where k.book_id = x.book_id and k.unlocked_at is null and x.vch_date is not null
                               and left(k.month::text, 7) = to_char(x.vch_date, 'YYYY-MM'))
           order by x.id limit 2000) h) else '[]'::jsonb end) as j
      from tally_links l
      -- 215: offset 0 keeps this a subquery of its own, worked out once a book (without it the planner put the call in
      -- each of the four places srv is used)
      cross join lateral (select tally_read_serving(f, l.book_id) as srv offset 0) sv
      cross join lateral (select exists (select 1 from jsonb_array_elements(sv.srv) e where tally_fetch_on((e ->> 'device')::uuid)) as fon) fo
     where l.firm_id = f and l.state = 'linked') z));
end $function$;
revoke all on function public.tally_read_view() from public, anon;
grant execute on function public.tally_read_view() to authenticated, service_role;

commit;
