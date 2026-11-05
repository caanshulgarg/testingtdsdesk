-- Migration 141 (05-Nov-2026, branch next-speed, the speed round): an index for tally_unknown_ledger_entries.
--
-- Why (staging, pg_stat_statements since 24-Sep-2026): tally_unknown_ledger_entries (migration 56) is the busiest slow
-- function the page calls: 12,986 calls, 145 ms on average, 1.5 s at most. Every open page asks it once a minute
-- (src/js/61-recorder.js unkOf), the firm's books together (p_book null) and a client's books one each. Its "a ledger
-- FinCom does not have" test is
--     not exists (select 1 from tally_ledgers t where t.book_id = l.book_id and tally_nm(t.name) = l.ledger and t.deleted_at is null)
-- and no index has tally_nm(name), so each call worked out tally_nm (a regular expression) for every live ledger of the
-- firm (5,272 on staging) and sorted them. With this index the names come worked out and in order:
-- EXPLAIN ANALYZE on staging, the firm's books together: 76 ms before, 47 ms with the index (tried in a transaction that
-- was rolled back, 04-Nov-2026).
--
-- ADD-ONLY: one index, nothing else; no function, table, row, policy or grant changed (an index has no grants: who may
-- call the function and read the table is as before). tally_nm is immutable (migration 56), as an index needs. Safe to
-- run twice (if not exists); one transaction, lock_timeout 10 s: building it holds writes to tally_ledgers for the
-- moment it takes (milliseconds at staging's 5,308 rows), never reads.
-- Read back: pg_indexes has tally_ledgers_live_nm with this definition, and EXPLAIN of the function's query uses it.

begin;
set local lock_timeout = '10s';

create index if not exists tally_ledgers_live_nm on public.tally_ledgers (book_id, public.tally_nm(name)) where deleted_at is null;

commit;
