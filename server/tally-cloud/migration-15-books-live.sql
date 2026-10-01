-- fast-sync (review of 01-Oct-2026): FinCom hears at once when the cloud copy of a client's books changes. The bridge's
-- days are read in by tally-ingest, which sets tally_books.days_at each time; with tally_books in Realtime, every
-- FinCom page open on that client brings in the changed days straight away, instead of looking once a minute. Realtime
-- checks tally_books' read policy (the caller's own firm). Adds only.
begin;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_books') then
    alter publication supabase_realtime add table public.tally_books;
  end if;
end $$;
commit;
