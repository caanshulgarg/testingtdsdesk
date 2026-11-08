-- Migration 147 (08-Nov-2026, branch next-book-start; written, NOT run: the owner reads it and runs it). The owner's
-- decision of 08-Nov-2026: reading older entries (tally_devices.period_fetch, migration 98, ROUND 103: per computer,
-- default off) is ON by default.
--   1. the column's default becomes true: a computer key made from now on reads older entries unless an owner turns it off;
--   2. every computer key whose switch no person ever touched (period_fetch_at is null: tally_device_period_fetch stamps
--      it on each turn, on or off) is turned on. A key an owner turned off (period_fetch_at set) stays off; one turned
--      on stays on. period_fetch_at / period_fetch_by are left null, so it still reads "never turned by a person".
-- Nothing else changes: older entries are still read only for a period a person chooses (tally_period_pulls), only
-- while Tally is idle, each request stopped at 2 s and the period stopped on a freeze (tally_period_stop), within the
-- computer's office hours 3 days a heartbeat and outside them up to 30 (tally_device_period_night, periodpace.js), never
-- while reading is paused or stopped; the owner's per-computer switch still wins (tally-ingest's beat, tally_period_*,
-- migrations 133, 135-137 read the same column). An owner can still turn a computer off (tally_device_period_fetch).
-- ADD-ONLY in effect: no table, column, function or policy created or dropped, no row deleted; one column default
-- changed and one guarded update. Safe to run twice (the second run changes nothing). One transaction, lock_timeout 10 s.
-- Tested by tests/run_migration147.py on a throwaway PostgreSQL (pg_stand).
--
-- Read-only, BEFORE running it (the keys it would turn on):
--   select id, firm_id, name, period_fetch, period_fetch_at from public.tally_devices
--    where period_fetch = false and period_fetch_at is null order by firm_id, name;
begin;
set local lock_timeout = '10s';

alter table public.tally_devices alter column period_fetch set default true;
update public.tally_devices set period_fetch = true where period_fetch = false and period_fetch_at is null;

commit;
