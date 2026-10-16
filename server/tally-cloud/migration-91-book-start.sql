-- migration 91 (round 64, 16-Oct-2026; the owner's GB TEXCOAT: three Day Book uploads, 560 days held, every page empty).
-- ADD-ONLY: no table, column, function or policy is created, changed or dropped; nothing is deleted. One-off.
--
-- A book filled only by Day Book uploads (tally-ingest upload_new / upload_done, migration 47) had no start
-- (tally_books.from_date) and no openings date (open_as_on): only a ledger list from a trial balance or the bridge's
-- "ledgers" call set them, and every report asks for the start (tally_pick -> tally_tb / tally_period / tally_mis / the GST and
-- TDS summaries). From round 64 tally-ingest's upload_done sets them when the book has none (bookStartFromUpload). This
-- fills in the books uploaded before that:
--   from_date  = the first day of the book's earliest sealed upload (tally_jobs kind 'upload', upload->>'from'), else the
--                book's first day held (min(tally_days.day))
--   open_as_on = the day before, when the book has none
-- Only books with days held and no start are touched; a book with a start is never moved. Running it twice changes nothing.
--
-- Read-only, BEFORE running it (the books it would touch, with the dates it would set):
--   select b.book_id, b.firm_id, b.client_id, b.company, b.open_as_on,
--          coalesce(u.first_from, d.first_day) as from_date_to_set,
--          coalesce(b.open_as_on, coalesce(u.first_from, d.first_day) - 1) as open_as_on_to_set,
--          d.days, d.first_day, d.last_day, d.entries
--     from public.tally_books b
--     join (select book_id, count(*) as days, min(day) as first_day, max(day) as last_day, coalesce(sum(n), 0) as entries
--             from public.tally_days group by book_id) d on d.book_id = b.book_id
--     left join (select book_id, min(to_date(upload->>'from', 'YYYYMMDD')) as first_from
--                  from public.tally_jobs where kind = 'upload' and sealed and coalesce(upload->>'from', '') ~ '^[0-9]{8}$'
--                 group by book_id) u on u.book_id = b.book_id
--    where b.from_date is null
--    order by b.company;
update public.tally_books b
   set from_date = s.start_day,
       open_as_on = coalesce(b.open_as_on, s.start_day - 1)
  from (select d.book_id, coalesce(u.first_from, d.first_day) as start_day
          from (select book_id, min(day) as first_day from public.tally_days group by book_id) d
          left join (select book_id, min(to_date(upload->>'from', 'YYYYMMDD')) as first_from
                       from public.tally_jobs where kind = 'upload' and sealed and coalesce(upload->>'from', '') ~ '^[0-9]{8}$'
                      group by book_id) u on u.book_id = d.book_id) s
 where s.book_id = b.book_id
   and b.from_date is null
   and s.start_day is not null;
