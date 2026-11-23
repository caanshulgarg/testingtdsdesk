-- Migration 215 (23-Nov-2026, branch next-short-day-note). A DRAFT, NOT run anywhere. Runs after 57 (and everything
-- after it: nothing later redefines tally_ingest_day). ADD-ONLY: no table, column, row or function removed; one function
-- replaced with the same signature, result and grants; safe to run twice; one transaction (lock_timeout 10 s). Nothing is
-- rewritten by running it.
--
--   tally_ingest_day (8 arguments): 57's text with one change. A Day Book file that brings entries on a short read (fewer
--   than the bridge counted for the day, p_n) now records the day's note 'short read: <entries> of <n>' (the same words
--   as its answer's refused), where before the note was cleared. A later full read clears it, as any read with entries
--   did. Everything else is 57's: the empty-read paths, the marks, the counts (n is p_n, as before), the answer.
--   Why: the sales check with reading entries off on the Tally computer (next-fix-sales-readsoff, src/js/26-sales-invoice.js
--   SALES_DAY_BAD) holds back an invoice whose day's tally_days note says 'short read'.
--
--   Guard: the live function must be 57's text (md5 of prosrc dd3749b6477664947227df46083f605d) or already this one
--   ('migration 215' in its text), else nothing changes. Before applying, read the live md5 on staging:
--     select md5(p.prosrc) from pg_proc p where p.oid = 'public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)'::regprocedure;
--   Grants as before (and as 57): revoked from public, anon, authenticated; execute for service_role only.
--   security definer, search_path = public, pg_temp. Tested on pg_stand: tests/run_migration215.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

do $$
declare m text; src text;
begin
  select md5(p.prosrc), p.prosrc into m, src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tally_ingest_day'
     and pg_get_function_identity_arguments(p.oid) = 'p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean';
  if m is null then raise exception 'migration 215: tally_ingest_day (8 arguments) is missing (needs migration 57)'; end if;
  if m <> 'dd3749b6477664947227df46083f605d' and position('migration 215' in src) = 0 then
    raise exception 'migration 215: tally_ingest_day is not migration 57''s text (md5 %); nothing changed', m;
  end if;
end $$;

-- ---------------------------------------------------------------- tally_ingest_day: 57's text, a short read with entries keeps its note
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text; emptied boolean := false; live_n int; prev_empty timestamptz; d_empty timestamptz; d_note text; pend int; capped boolean := false; lk date; ent jsonb;
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
  -- migration 44: a day of a locked month (or an entry moving out of one) stores nothing: no entry, no mark, no record
  lk := tally_month_locked(p_book, touched);
  if lk is not null then
    return jsonb_build_object('ok', true, 'day', p_day, 'touched', '[]'::jsonb, 'marked', 0, 'sent', 0, 'locked', true,
      'refused', format('month locked: %s (locked by the owner; nothing stored, nothing marked)', to_char(lk, 'YYYY-MM')));
  end if;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the day's entries not in the file: marked, kept (lines and bills kept too) - but NEVER on a short read (migration 38,
  -- item 9): a file with no entries, or fewer than the bridge counted for the day (p_n), upserts what came and marks
  -- nothing; the answer says refused: 'short read: n of p_n' and tally-ingest logs it. Migration 44: marked before the
  -- entries are taken (the marked rows are never the file's), the cache of the day rebuilt after both
  select d.empty_at into prev_empty from tally_days d where d.book_id = p_book and d.day = p_day;
  select count(*) into live_n from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
  if n_in = 0 and coalesce(p_n, 0) = 0 and p_empty is true then
    -- migration 39: the bridge positively read the day and Tally listed no entries. Migration 42: a day that still has
    -- live entries is emptied only on the SECOND consecutive empty read (the first is recorded in tally_days.empty_at
    -- and refused); a day with no live entries has nothing to mark and is recorded as empty at once. Decided by
    -- empty_at and the live count alone, never by tally_days.n. A later file with entries un-marks them and clears the record
    -- the cap (migration 43): the book's days still PENDING a second empty read, however old (a first empty read never
    -- confirmed), plus the days an empty read MARKED in the last 24 hours; days with nothing to mark never count
    select count(*) into pend from tally_days d where d.book_id = p_book and d.empty_at is not null
       and (d.note like 'empty day with%' or (d.empty_at >= now() - interval '24 hours' and d.note ~ '^\d+ entries marked deleted on the second empty read'));
    if live_n = 0 then
      emptied := true; d_empty := now(); d_note := 'empty day, nothing to mark';
    elsif pend >= 10 then
      short := format('%s days of this book read empty within 24 hours: a read fault; this day is not emptied and not recorded; nothing marked', pend);
      capped := true;
    elsif prev_empty is null then
      short := format('empty day with %s live entries: confirm by a second empty read', live_n);
      d_empty := now(); d_note := short;
    else
      update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
      get diagnostics marked = row_count; emptied := true;
      d_empty := now(); d_note := format('%s entries marked deleted on the second empty read (the first at %s)', marked, to_char(prev_empty at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"'));
    end if;
  elsif n_in = 0 or n_in < coalesce(p_n, 0) then
    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
    -- migration 215: entries came in on a short read and no note is set yet: the day keeps the note, so a reader of
    -- tally_days (the sales check with reads off, src/js/26-sales-invoice.js) sees the day is only partly in the copy
    if n_in > 0 and d_note is null then d_note := short; end if;
  else
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
    get diagnostics marked = row_count;
  end if;
  -- the entries in the file, each dated the day: the one entry path (owner item 95), which replaces their lines and
  -- bills and rebuilds the cache of the days they had and have
  ent := tally_ingest_entries(p_book, (select coalesce(jsonb_agg(x || jsonb_build_object('day', p_day) order by o), '[]'::jsonb) from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines, true, false);     -- 57: the entry path with the entry's details (the Day Book: authoritative, p_keep false)
  if not (p_day = any(array(select jsonb_array_elements_text(coalesce(ent->'touched', '[]'::jsonb))::date))) then perform tally_ledger_day_rebuild(p_book, array[p_day]); end if;
  -- the day's bookkeeping. An empty read is recorded (empty_at, note); a file with entries clears the record. Migration 42:
  -- an empty file that marked nothing (a refused first empty read, a short read) keeps the n the day had, so the day's
  -- count is never zeroed by a read that changed nothing
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at, empty_at, note) values (p_book, f, p_day, p_n, p_alter, p_bytes, now(), d_empty, d_note)
  on conflict (book_id, day) do update set
     n = case when n_in = 0 and not emptied then tally_days.n else excluded.n end,
     alter_max = excluded.alter_max, bytes = excluded.bytes, at = now(),
     empty_at = case when n_in > 0 then null else coalesce(excluded.empty_at, tally_days.empty_at) end,
     note = case when n_in > 0 then excluded.note else coalesce(excluded.note, tally_days.note) end;     -- 215: null for a full read, as before; the short read's note
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end || case when emptied then jsonb_build_object('empty', true) else '{}'::jsonb end || case when d_empty is not null and not emptied then jsonb_build_object('emptyPending', true) else '{}'::jsonb end || case when capped then jsonb_build_object('emptyCapped', true) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;

commit;
