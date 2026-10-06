-- Migration 59 (06-Oct-2026, bridge 2.3.1: the owner's decision on a ledger renamed in Tally and fetched for an unknown
-- name). Runs after 58 and before 60 (fresh database and staging: ... -> 56 -> 57 -> 58 -> 59 -> 60; it needs only
-- tally_books and my_firm()). ADD-ONLY: one new table, its index, its row security and its grants; nothing else touched,
-- no statement here removes rows; safe to run twice; one transaction (lock_timeout 10 s). No function.
--
-- An entry names a ledger FinCom does not have; the bridge fetches it from its own Tally by that name (FinComLedgerByName,
-- 2.3.1 part B) and Tally's answer has the GUID of a ledger FinCom already holds under another name: the ledger was
-- renamed in Tally. 2.3.1 does not rename (2.3.2 will): tally-ingest records the name here, and an entry using Tally's new
-- name is applied under FinCom's existing ledger (its lines' ledger names mapped from the new name to FinCom's, never a
-- second ledger, the amounts untouched), without asking Tally again.
--
--   tally_ledger_aliases   (book_id, tally_name) -> fincom_name, with Tally's GUID and when it was last seen; written by
--                          tally-ingest (service role) only; the firm's members read their own rows (the note for 2.3.2).
--                          Review H2 (06-Oct-2026): an alias is used only while valid: confirmed_at (a fetch by its name
--                          gave this GUID) set and ended_at not set (ended when the GUID is seen under another name or the
--                          name with another GUID; kept, never removed). Otherwise the entry is held and the ledger fetched
-- Tested by tests/run_migration59.py and tests/run_migration_order.py (59 in both orders).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.tally_ledger_aliases (
  book_id uuid not null references public.tally_books (book_id) on delete restrict,
  firm_id uuid not null,
  tally_name text not null,           -- the ledger's name in Tally now (the name the entry uses)
  fincom_name text not null,          -- the ledger FinCom holds (its name kept until 2.3.2 renames)
  tally_guid text not null default '',
  seen_at timestamptz not null default now(),
  confirmed_at timestamptz,           -- review H2: the last fetch by this name (FinComLedgerByName) that gave this GUID
  ended_at timestamptz,               -- review H2: the GUID seen under another name, or the name with another GUID
  primary key (book_id, tally_name)
);
alter table public.tally_ledger_aliases add column if not exists confirmed_at timestamptz;
alter table public.tally_ledger_aliases add column if not exists ended_at timestamptz;
create index if not exists tally_ledger_aliases_guid on public.tally_ledger_aliases (book_id, tally_guid);

alter table public.tally_ledger_aliases enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_aliases' and policyname = 'tally_ledger_aliases_read') then
    create policy tally_ledger_aliases_read on public.tally_ledger_aliases for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_ledger_aliases from public, anon, authenticated;
grant select on public.tally_ledger_aliases to authenticated;
grant all on public.tally_ledger_aliases to service_role;

commit;
