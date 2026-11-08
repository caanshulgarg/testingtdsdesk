-- Migration 143 (08-Nov-2026, branch next-fast-measure; NOT run on staging: the owner reads it and runs it). The fast-read
-- measurement (docs/fast-entries-design.md section 9b; docs/fast-entries-measure-steps.md): a person at the Tally
-- computer clicks "Measure the fast read (ZZ TEST only)" in the FinCom Bridge tray; the bridge times the two window
-- requests on the company named exactly ZZ TEST and sends the result (tally-ingest {kind: "fast_measure"}). Kept here,
-- one row a run, for the Tally page's hidden results panel (Advanced) and for FinCom to read before FastEntries is
-- switched on for that computer. Times, counts and field NAMES only: no entry data.
--
-- ADD-ONLY: one new table; no table altered, nothing dropped, no row deleted; safe to run twice; one transaction,
-- lock_timeout 10 s. Grants explicit: service_role (tally-ingest) reads and inserts; authenticated reads its own firm's
-- rows only (row security, my_firm()); anon nothing.
--
-- Deploy: this file first, then tally-ingest (it answers "not set up yet" until this has run), then the app. Tested on
-- pg_stand: tests/run_migration143.py.

begin;
set local lock_timeout = '10s';

create table if not exists public.tally_fast_measures (
  id             bigint generated always as identity primary key,
  firm_id        uuid not null,
  book_id        uuid not null references public.tally_books(book_id) on delete restrict,
  device_id      uuid,
  received_at    timestamptz not null default now(),
  measured_at    text not null default '',
  bridge         text not null default '' check (length(bridge) <= 20),
  tally_version  text not null default '' check (length(tally_version) <= 40),
  pass           boolean not null default false,
  worst_ms       integer,
  worst_hold_ms  integer,
  compared       integer,
  differ         integer,
  line           text not null default '' check (length(line) <= 400),
  result         jsonb not null check (pg_column_size(result) <= 65536)
);
create index if not exists tally_fast_measures_book on public.tally_fast_measures (book_id, received_at desc);
alter table public.tally_fast_measures enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_fast_measures' and policyname = 'tally_fast_measures_read') then
    create policy tally_fast_measures_read on public.tally_fast_measures for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_fast_measures from public, anon, authenticated;
grant select on public.tally_fast_measures to authenticated;
grant select, insert on public.tally_fast_measures to service_role;

commit;
