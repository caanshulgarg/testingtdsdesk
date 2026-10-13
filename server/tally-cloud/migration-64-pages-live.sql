-- Migration 64 (07-Oct-2026, next release, branch next-realtime): Look up, the ledgers and Sync activity refresh by
-- themselves (Supabase Realtime). Runs after 60 in both orders (fresh and staging: ... -> 59 -> 60 -> 64); independent of 61,
-- 62 and 63 (other branches). ADD-ONLY: no table, column, row or function removed; no statement in this file removes rows,
-- not even in a comment; safe to run twice; one transaction (lock_timeout 10 s). NOT RUN anywhere: tested on pg_stand only
-- (tests/run_migration64.py).
--
-- What those pages read: FinCom's copy of a client's books (tally_vouchers, tally_lines, tally_ledgers, tally_ledger_day,
-- tally_groups; Look up's answers from the copy and the ledger list), and, for Sync activity, tally_recorder_lines and
-- tally_alerts (in the publication since 45 and 47), tally_sync_cursor (the gap), tally_month_locks and tally_tieouts.
--
-- The copy's five tables are NOT added to the publication, for three reasons found while writing this:
--   a. tally_lines has no primary key and no replica identity: in a publication that publishes deletes (supabase_realtime
--      does), every delete on tally_lines - each day book read, each recorder line applied - would fail with "cannot
--      remove rows from table ... because it does not have a replica identity and publishes deletes" (the PostgreSQL error, paraphrased) (shown on pg_stand by the test);
--   b. Realtime applies no RLS to DELETE events: every subscriber of any firm would be sent the deleted row's primary key,
--      and these tables are hard-deleted and re-written on every day read (tally_vouchers: book and GUID; tally_ledger_day and
--      tally_ledgers: book and LEDGER NAMES of another firm's client);
--   c. a day book read rewrites thousands of rows: as many events to every open page.
-- Instead, one row per book says the copy changed:
--   1. tally_book_changes (book_id primary key, firm_id, client_id, changed_at, tables: the copy's tables changed in the last
--      transaction, n: how many transactions so far). RLS on, members read their firm's rows (firm_id = my_firm()), nobody
--      writes directly; no foreign key, and no statement anywhere removes its rows: Realtime sends only INSERT and UPDATE
--      events of it, which it filters by that policy.
--   2. tally_book_changed(), statement-level AFTER INSERT / UPDATE / DELETE triggers on the five tables (transition tables):
--      the books the statement touched are upserted into tally_book_changes, ONCE per transaction and table (a transaction-
--      local note), so one day read gives one or a few events, never thousands. It never fails the write that fired it (any
--      error is a warning). Security definer, search_path public, pg_temp, executable by nobody (a trigger function).
--   3. The supabase_realtime publication (when it exists) gets tally_book_changes, tally_sync_cursor, tally_month_locks and
--      tally_tieouts (each only when not in it yet). These three have a primary key, RLS with the firm's read policy (32, 44),
--      and no row of them is ever deleted. tally_recorder_lines and tally_alerts are in it already (45, 47).
-- Nothing else is touched; no existing row is changed by running it.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- 1. the signal table
create table if not exists public.tally_book_changes (
  book_id     uuid primary key,
  firm_id     uuid not null,
  client_id   text,
  changed_at  timestamptz not null default now(),
  tables      text[] not null default '{}',
  n           bigint not null default 0
);
create index if not exists tally_book_changes_firm on public.tally_book_changes (firm_id, changed_at desc);
alter table public.tally_book_changes enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_book_changes' and policyname = 'tally_book_changes_read') then
    create policy tally_book_changes_read on public.tally_book_changes for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_book_changes from public, anon, authenticated;
grant select on public.tally_book_changes to authenticated;

-- ---------------------------------------------------------------- 2. the trigger
create or replace function public.tally_book_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare done text := coalesce(current_setting('fincom.book_changed', true), ''); keys text[];
begin
  begin
    if tg_op = 'DELETE' then
      select array_agg(distinct d.book_id::text) into keys from old_rows d where position('|' || d.book_id::text || ':' || tg_table_name || '|' in done) = 0;
    else
      select array_agg(distinct d.book_id::text) into keys from new_rows d where position('|' || d.book_id::text || ':' || tg_table_name || '|' in done) = 0;
    end if;
    if keys is null then return null; end if;
    insert into tally_book_changes as c (book_id, firm_id, client_id, changed_at, tables, n)
    select b.book_id, b.firm_id, b.client_id, clock_timestamp(), array[tg_table_name::text], 1
      from tally_books b where b.book_id = any(keys::uuid[])
    on conflict (book_id) do update set changed_at = excluded.changed_at, client_id = coalesce(excluded.client_id, c.client_id),
      -- the tables of this transaction so far (a later transaction starts the list again)
      tables = case when position('|' || c.book_id::text || ':' in done) > 0 then (select array_agg(distinct t order by t) from unnest(c.tables || excluded.tables) t) else excluded.tables end,
      n = c.n + case when position('|' || c.book_id::text || ':' in done) > 0 then 0 else 1 end;
    perform set_config('fincom.book_changed', done || (select string_agg('|' || k || ':' || tg_table_name || '|', '') from unnest(keys) k), true);
  exception when others then
    raise warning 'tally_book_changed (% on %): %', tg_op, tg_table_name, sqlerrm;     -- never fails the write that fired it
  end;
  return null;
end $function$;
revoke all on function public.tally_book_changed() from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['tally_vouchers', 'tally_lines', 'tally_ledgers', 'tally_ledger_day', 'tally_groups'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_changed_ins') then
      execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.tally_book_changed()', t || '_changed_ins', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_changed_upd') then
      execute format('create trigger %I after update on public.%I referencing new table as new_rows for each statement execute function public.tally_book_changed()', t || '_changed_upd', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_changed_del') then
      execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.tally_book_changed()', t || '_changed_del', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. Realtime
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['tally_book_changes', 'tally_sync_cursor', 'tally_month_locks', 'tally_tieouts'] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
