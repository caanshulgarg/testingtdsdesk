-- Migration 80 (14-Oct-2026, branch tds-layout: one challan register per client TAN; the owner's rules approved 13/14-Oct-2026).
-- Runs after 76 (db-speed) on staging; needs only members, my_firm() and can_write() (migration.sql), so it is independent of
-- 75/75b (zoho-books), 76 (db-speed), 77 (assistant), 78 (audit) and 79 (reports, reserved) and may run before or after any.
-- ADD-ONLY: one new table, its one unique index, its row security and its grants; nothing else touched, nothing dropped, no row of any
-- other table read or changed; safe to run twice; one transaction (lock_timeout 10 s).
--
--   tds_challan_allocations  the audit trail of the client's challan register (src/js/79-challan-register.js): one row a
--                            change, never changed or removed. Which deduction a challan pays stays in the books' own copy
--                            (client_books, alloc), which every figure and the FVU file read; these rows say who changed it,
--                            when, and how: a deduction tagged or taken off (tax), a return's interest or fee portion, a
--                            return locked when marked filed, a correction opened, a challan entered by hand, edited,
--                            linked to Tally's, or deleted (with its reason, in note).
--     firm_id      the firm (default my_firm()); client_id the client; tan the client's TAN
--     challan_id   the challan's id in the books; challan_key its BSR code | yyyymmdd | serial
--     form, fy, quarter   the return ('' for a line about the challan itself)
--     deduction_id the deduction ('' for a portion, a lock of a whole return, or a line about the challan)
--     action       tag | untag | auto | tally | suggestion | balance | portion | lock | correction | challan-add | challan-edit |
--                  challan-link | challan-delete
--     tax, interest, fee   the amounts of this change; locked: the allocation is of a return marked filed
--     note         the note shown with it ("challan nature 92B used in 26Q", "challan of FY 2025-26 used in FY 2026-27")
--     client_ref   the browser's own id of the line: a line sent twice is kept once
--     created_by, created_at   who and when (auth.uid(), now()), set by the database
-- Row security: a firm's members read their firm's rows; its owner and staff (can_write()) add rows for their own firm,
-- as themselves; nobody updates or deletes (no grant, no policy). The service role keeps all rights, as on every table.
-- Tested by tests/run_migration80.py (run twice, the row security, the checks) and tests/run_migration_order.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.tds_challan_allocations (
  id bigserial primary key,
  firm_id uuid not null default public.my_firm(),
  client_id text not null,
  tan text not null default '',
  challan_id text not null default '',
  challan_key text not null default '',
  form text not null default '',
  fy text not null default '',
  quarter text not null default '',
  deduction_id text not null default '',
  action text not null,
  tax numeric(15, 2) not null default 0,
  interest numeric(15, 2) not null default 0,
  fee numeric(15, 2) not null default 0,
  locked boolean not null default false,
  note text not null default '',
  client_ref text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint tds_challan_allocations_ref unique (firm_id, client_ref),
  constraint tds_challan_allocations_form check (form in ('', '24Q', '26Q', '27Q', '27EQ')),
  constraint tds_challan_allocations_fy check (fy = '' or fy ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint tds_challan_allocations_quarter check (quarter in ('', 'Q1', 'Q2', 'Q3', 'Q4')),
  constraint tds_challan_allocations_action check (action in ('tag', 'untag', 'auto', 'tally', 'suggestion', 'balance', 'portion', 'lock', 'correction',
    'challan-add', 'challan-edit', 'challan-link', 'challan-delete')),
  constraint tds_challan_allocations_amounts check (tax >= 0 and interest >= 0 and fee >= 0),
  constraint tds_challan_allocations_lens check (char_length(client_id) <= 200 and char_length(tan) <= 10 and char_length(challan_id) <= 200
    and char_length(challan_key) <= 60 and char_length(deduction_id) <= 400 and char_length(note) <= 500 and char_length(client_ref) <= 100)
);
-- one index only: the unique (firm_id, client_ref), which a line sent twice needs; the trail is read with the books' own
-- copy, so no other index is kept up (the review of 14-Oct-2026)

alter table public.tds_challan_allocations enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tds_challan_allocations' and policyname = 'tds_challan_allocations_read') then
    create policy tds_challan_allocations_read on public.tds_challan_allocations for select to authenticated
      using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tds_challan_allocations' and policyname = 'tds_challan_allocations_add') then
    create policy tds_challan_allocations_add on public.tds_challan_allocations for insert to authenticated
      with check (firm_id = (select public.my_firm()) and (select public.can_write()) and created_by = (select auth.uid()));
  end if;
end $$;
revoke all on public.tds_challan_allocations from public, anon, authenticated;
grant select, insert on public.tds_challan_allocations to authenticated;
revoke all on sequence public.tds_challan_allocations_id_seq from public, anon, authenticated;
grant usage on sequence public.tds_challan_allocations_id_seq to authenticated;
grant all on public.tds_challan_allocations to service_role;
grant all on sequence public.tds_challan_allocations_id_seq to service_role;

commit;
