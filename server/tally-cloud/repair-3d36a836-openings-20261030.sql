-- One-off repair, staging only, NOT RUN (written 30-Oct-2026; the coordinator runs it after checking).
-- Book 3d36a836-debd-4847-93a7-73b343333a41 (IMPETUS INSURANCE BROKERS PRIVATE LIMITED, books from 2025-04-01).
--
-- What happened (read-only findings of 30-Oct-2026):
--   * 08:30:55 UTC 29-Oct: Ranjeet's bridge 2.4.7 (go-1418f6cb202d, round f4d22ad3...) added the book's 436 ledgers. A
--     ledger new to the copy takes the opening the bridge sends (tally-ingest applyLedgerList: "fresh").
--   * 13:42-13:47: Anshul's bridge 2.4.8 rounds re-sent all ledgers, but a bridge's first read marks no opening as
--     changed, so it changed no opening (applyLedgerList: "plain").
--   * 13:45:49: a trial-balance file uploaded in the app (upload_ledgers, list 6c351e65..., 100 ledgers, not declared
--     complete) set those 100 ledgers' openings, among them Cash -631867.00, correct for 1-Apr-2025.
--   So the 304 ledgers not in that file still carry the opening Ranjeet's Tally gave at 08:30. For PRIYANKA SINGH that
--   is 1,77,32,801.73, her balance on 31-Mar-2026 (the owner's Tally: opening 82,29,467.25 Cr = 177,32,801.73 less the
--   FY 2025-26 movement 95,03,334.48 that FinCom has too).
--
-- Proven wrong, and only these are changed:
--   (a) the 64 ledgers outside the uploaded file whose opening equals, to the paisa, their whole FY 2025-26 movement in
--       FinCom's own day totals, with no entry on 1-Apr-2025: their true opening is nil (the opening sent is their
--       balance on 1-Apr-2026). Indu Jain -Loan Advance (-89,50,000.00) is one of them. Sum of their openings now
--       -2,86,71,269.61.
--   (b) PRIYANKA SINGH: the owner's figure from Tally, 8229467.25 (= open - FY 2025-26 movement).
-- Every other ledger is left alone: the rest of the Rs 3.19 cr difference needs the openings read again from a Tally
-- whose answer is the opening at the books' beginning (see the fix plan), not inferred here.
--
-- Add-only: each change is kept with the value before it in tally_opening_repairs (created here if missing); open and
-- open_sent change together; the year's openings are worked out again by the function the cloud already uses.

begin;

create table if not exists public.tally_opening_repairs (
  id bigserial primary key,
  at timestamptz not null default now(),
  book_id uuid not null,
  ledger text not null,
  open_before numeric(18,2),
  open_sent_before numeric(18,2),
  open_after numeric(18,2) not null,
  why text not null
);
alter table public.tally_opening_repairs enable row level security;   -- service role only, as the other repair logs

with bk as (select '3d36a836-debd-4847-93a7-73b343333a41'::uuid as book),
mv as (
  select d.ledger, sum(d.amount) as mv, min(d.day) as first_day
  from tally_ledger_day d, bk where d.book_id = bk.book and d.day between '2025-04-01' and '2026-03-31'
  group by d.ledger
),
in_file as (   -- the 100 ledgers of the trial-balance upload of 13:45:49 UTC (not marked by its list)
  select l.name from tally_ledgers l, bk
  where l.book_id = bk.book and l.deleted_at is null
    and not exists (select 1 from tally_ledger_marks m where m.book_id = l.book_id and m.ledger = l.name
                    and m.list_id = '6c351e65-f39b-4c57-a0cf-aca93d8621c4')
),
proven as (
  select l.name, l.open, l.open_sent, 0::numeric(18,2) as open_after,
         'opening equal to the whole FY 2025-26 movement (no entry on 1-Apr-2025): the balance on 1-Apr-2026 sent as the opening by bridge go-1418f6cb202d round f4d22ad36768e05a2ecf821fef6fe1d1; true opening nil' as why
  from tally_ledgers l join mv on mv.ledger = l.name, bk
  where l.book_id = bk.book and l.deleted_at is null and l.name not in (select name from in_file)
    and l.open <> 0 and l.open = mv.mv and mv.first_day > '2025-04-01' and l.name <> 'PRIYANKA SINGH'
  union all
  select l.name, l.open, l.open_sent, 8229467.25,
         'the owner''s Tally (Ledger Vouchers, 30-Oct-2026 08:43): opening 82,29,467.25 Cr on 1-Apr-2025; FinCom had 1,77,32,801.73, her balance on 31-Mar-2026'
  from tally_ledgers l, bk where l.book_id = bk.book and l.name = 'PRIYANKA SINGH' and l.deleted_at is null and l.open = 17732801.73
)
insert into public.tally_opening_repairs (book_id, ledger, open_before, open_sent_before, open_after, why)
select '3d36a836-debd-4847-93a7-73b343333a41'::uuid, name, open, open_sent, open_after, why from proven;

-- the guard: exactly the 65 rows found on 30-Oct-2026 (64 + PRIYANKA SINGH), nothing else
do $$
declare n int; s numeric;
begin
  select count(*), sum(open_before) into n, s from public.tally_opening_repairs
   where book_id = '3d36a836-debd-4847-93a7-73b343333a41' and at = now();
  if n <> 65 or s <> (-28671269.61 + 17732801.73) then
    raise exception 'repair stopped: % rows (want 65), openings before % (want %)', n, s, (-28671269.61 + 17732801.73);
  end if;
end $$;

update public.tally_ledgers l set open = r.open_after, open_sent = r.open_after
  from public.tally_opening_repairs r
 where r.book_id = l.book_id and r.ledger = l.name and r.at = now()
   and l.book_id = '3d36a836-debd-4847-93a7-73b343333a41';

select public.tally_year_openings('3d36a836-debd-4847-93a7-73b343333a41'::uuid);

-- what is left (read it before commit): the openings' sum, nil when every opening is right
select sum(open) as openings_sum_after from public.tally_ledgers
 where book_id = '3d36a836-debd-4847-93a7-73b343333a41' and deleted_at is null;
-- expected about -1,27,66,522.69 (was -3,19,34,457.82): the 65 proven fixed, the rest needs the openings read again

commit;
