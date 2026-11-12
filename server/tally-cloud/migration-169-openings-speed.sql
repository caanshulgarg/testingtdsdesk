-- Migration 169 (12-Nov-2026, branch next-fix-cloud-errs; NOT run on staging: the owner reads it and runs it). The year's
-- openings (tally_year_openings) worked out in time for a new book.
--
-- Why (Sentry FINCOM-CLOUD-STAGING-6, 7-Nov-2026 14:52 UTC): a first ledger round of a new book (about 4,000 ledgers in two
-- batches) failed on its last batch with "canceling statement due to statement timeout" (PostgREST's 8 s). The database's
-- log names the statement: tally_openings_settle -> tally_year_openings, its twins step (a CTE joined to itself, then to
-- tally_ledgers). The book's rows had come in seconds before, so the table's figures knew nothing of them and the planner
-- took the book for one row: every join a nested loop, about 4,000 x 4,000 x 2 rows compared (about 10 s on a test
-- database for 4,500 ledgers). The step that adds the twins' openings to their head is a join of the same kind.
--
-- What changes (the answer is the same, row for row; tests/run_migration169.py checks it against migration 33's):
--   the twins: one pass with window functions (the head of each key is first_value over the key, as row_number's order
--     was) and no join; only the ledgers whose merged_into changes are written, one by one by the primary key (none, or a
--     few, on most rounds);
--   the twins' openings: added to their head one head at a time, by the primary key;
--   open put back to open_sent only where it differs (a round's every ledger was written each time).
-- Everything else as migration 33 has it.
--
-- ADD-ONLY: one function replaced (create or replace, the same name, arguments and reply); no table altered, nothing dropped,
-- no row deleted; safe to run twice; one transaction, lock_timeout 10 s; run it while Tally sync is quiet. Grants explicit, as
-- before: service_role only. Tested on pg_stand: tests/run_migration169.py. tally-ingest needs no change.

begin;
set local lock_timeout = '10s';

create or replace function public.tally_year_openings(p_book uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; fd date; moved numeric := 0; n int := 0; twins int := 0; r record;
  pl constant text[] := array['sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses'];
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_ledgers set open_sent = open where book_id = p_book and open_sent is null;
  -- twins (one ledger once its name is cleaned): among the live ledgers; a live ledger whose twin is gone is its own again.
  -- The head of a key: the first by (a group first, the clean spelling first, the name); the others are merged into it
  for r in
    select k.name, k.m from (
      select name, merged_into as was, case when row_number() over w > 1 then first_value(name) over w end as m
        from tally_ledgers where book_id = p_book and deleted_at is null
      window w as (partition by tally_ledger_key(name) order by (parent <> '') desc, (name = tally_ledger_key(name)) desc, name)
    ) k where k.was is distinct from k.m
  loop
    update tally_ledgers set merged_into = r.m where book_id = p_book and name = r.name;
    twins := twins + 1;
  end loop;
  update tally_ledgers l set open = case when l.merged_into is null and l.deleted_at is null then l.open_sent else 0 end
   where l.book_id = p_book and l.open is distinct from (case when l.merged_into is null and l.deleted_at is null then l.open_sent else 0 end);
  for r in
    select merged_into, sum(open_sent) x from tally_ledgers where book_id = p_book and merged_into is not null and deleted_at is null group by merged_into
  loop
    update tally_ledgers set open = open + r.x where book_id = p_book and name = r.merged_into;
  end loop;
  if fd is null or to_char(fd, 'MM-DD') <> '04-01' then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  select coalesce(sum(open), 0), count(*) into moved, n
    from tally_ledgers where book_id = p_book and merged_into is null and deleted_at is null and lower(primary_group) = any(pl) and open <> 0;
  if n = 0 then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  update tally_ledgers set open = 0 where book_id = p_book and merged_into is null and deleted_at is null and lower(primary_group) = any(pl) and open <> 0;
  insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent) values (p_book, f, 'Profit & Loss A/c', '', moved, 0)
  on conflict (book_id, name) do update set open = tally_ledgers.open + excluded.open;
  return jsonb_build_object('ok', true, 'moved', moved, 'ledgers', n, 'twins', twins);
end $function$;
revoke all on function public.tally_year_openings(uuid) from public, anon, authenticated;
grant execute on function public.tally_year_openings(uuid) to service_role;

commit;
