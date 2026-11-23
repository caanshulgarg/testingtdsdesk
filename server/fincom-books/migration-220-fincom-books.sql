-- Migration 220 (23-Nov-2026, branch next-books-p1). A DRAFT: written and tested here (tests/run_migration220.py on
-- pg_stand, made-up books only); NOT run anywhere. The owner runs it on staging after the review. The number is
-- provisional (the coordinator renumbers it per docs/MIGRATION-ORDER.md). Plan: docs/FULL-BOOKS-PLAN.md; this phase:
-- docs/FINCOM-BOOKS-P1.md.
--
-- FinCom Books, phase 1: one set of books (fb_*) for every client, filled from today's cloud copy of Tally / Zoho.
--   fb_books ... fb_grants          the store (plan section 2): the company, years, registrations, branches, the chart of
--                                   accounts with Schedule III codes (Division I, owner decision D6), ledgers, openings,
--                                   voucher types, series, cost centres, vouchers, lines, cost-centre splits, bill-wise
--                                   references, versions, locks / approvals (tables only, used from P4), grants per book
--   fb_audit_log                    the edit log, written by the database (AFTER triggers on every fb_* table), chained
--                                   by SHA-256 per book; nobody may change or delete it (not even service_role); a daily
--                                   self-check turns a book read-only when a trigger is off or the chain breaks
--   the mirror builder              statement triggers on the landing tables (tally_vouchers, tally_lines, tally_bills,
--                                   tally_cost_allocs, tally_ledgers, tally_groups) only NOTE what changed (fb_mirror_dirty,
--                                   one row per book and entry or master): cheap, never waiting more than 200 ms, never
--                                   failing the copy's write. Nothing is mirrored at COMMIT (owner decision 23-Nov-2026:
--                                   FinCom Books follows within 10 minutes). The catch-up (fb_mirror_catchup_run, every
--                                   3 minutes from cron, one short transaction per book and chunk) mirrors the noted
--                                   entries; an entry noted again while it was being mirrored stays noted (seq). A change
--                                   the trigger could not even note is a 'missed' row (or, if even that fails, a tick of
--                                   fb_missed_seq), and the catch-up then compares every entry of the book's window by its
--                                   content (the sweep). A book behind by more than 10 minutes is "Not in step"; within
--                                   10 minutes the page says "Updating". No function of the Tally path is replaced; only
--                                   books the firm set up (fb_enroll by the owner or staff, mirror_on) are mirrored.
--                                   Locks: per book in book_id order, the book's mirror lock first, then its edit-log lock.
--   the tie-out                     fb_tieout: FinCom Books against the copy (ledger by day, voucher counts by type and
--                                   month, openings, the opening difference, held entries, mirror errors) and against
--                                   Tally's own figures once they are read (fb_source_figures: a TODO hook for the new
--                                   reads drafted for bridge 2.5.19; nothing here asks Tally anything). "Not in step"
--                                   WARNS only (owner decision D18): fb_filing_warning never blocks a return.
--   the readers                     fb_status, fb_tb, fb_ledger, fb_ledgers, fb_daybook, fb_audit_verify (members of the
--                                   firm, RLS by firm and, where fb_grants names people, by book)
-- Owner decisions applied (23-Nov-2026): D3 a posted own-books voucher changes only as a new version with a reason;
-- D6 Division I; D7 an opening difference keeps the book "Not in step" until the owner signs it off with a reason, per
-- book; D17 one fb_* store; D18 warn only; D19 status 'sent' is out of every total; D20 the current and previous FY
-- (older vouchers are carried into the openings, exactly); D21 the tie-out nightly (cron draft, migration-220-cron.sql)
-- and on request.
-- Sign: in fb_* a debit is POSITIVE and a credit negative (plan 2); the copy keeps Tally's own sign (a credit positive),
-- so the mirror negates every amount and opening.
-- ADD-ONLY: new tables, their policies, grants and triggers, new functions, and new statement triggers on six landing
-- tables. Nothing existing is dropped, changed or replaced; no row of the copy is written. Safe to run twice: a re-run
-- skips what is there (indexes, triggers, RLS, policies), so it takes no lock that would stop the copy's writes. One
-- transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- what must be there first; and the names
do $names$
declare t text; f text; bad text[] := '{}';
  mark constant text := 'fincom books (migration 220)';
begin
  foreach t in array array['tally_books', 'tally_vouchers', 'tally_lines', 'tally_ledgers', 'tally_groups', 'tally_bills', 'tally_cost_allocs', 'members'] loop
    if to_regclass('public.' || t) is null then raise exception 'migration 220: public.% is not here (run the cloud copy''s migrations first). Nothing was changed.', t; end if;
  end loop;
  if to_regprocedure('public.my_firm()') is null or to_regprocedure('auth.uid()') is null then
    raise exception 'migration 220: my_firm() / auth.uid() are not here. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'deleted_at') then
    raise exception 'migration 220: tally_vouchers has no deleted_at (run migration 32 first). Nothing was changed.';
  end if;
  foreach t in array array['fb_books', 'fb_years', 'fb_registrations', 'fb_branches', 'fb_seed_groups', 'fb_groups', 'fb_ledgers', 'fb_openings',
      'fb_vtypes', 'fb_series', 'fb_cost_categories', 'fb_cost_centres', 'fb_vouchers', 'fb_lines', 'fb_line_cc', 'fb_bill_refs',
      'fb_voucher_versions', 'fb_locks', 'fb_approval_rules', 'fb_approvals', 'fb_grants', 'client_books_mode', 'fb_audit_log', 'fb_audit_anchors',
      'fb_tieouts', 'fb_source_figures', 'fb_mirror_errors', 'fb_mirror_dirty', 'fb_mirror_state'] loop
    if to_regclass('public.' || t) is not null and coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> mark then bad := bad || ('table ' || t); end if;
  end loop;
  foreach f in array array['fb_inr', 'fb_fy', 'fb_fy_start', 'fb_is_owner', 'fb_my_books', 'fb_audit_canon', 'fb_audit_trg', 'fb_no_delete_trg', 'fb_no_change_trg',
      'fb_no_truncate_trg', 'fb_vouchers_guard_trg', 'fb_lines_guard_trg', 'fb_check_voucher', 'fb_check_voucher_trg', 'fb_land_guid_trg', 'fb_land_name_trg',
      'fb_seed_book', 'fb_group_id', 'fb_mirror_group', 'fb_ledger_id', 'fb_mirror_ledger', 'fb_vtype_id', 'fb_vtype_base', 'fb_cc_id',
      'fb_mirror_voucher', 'fb_mirror_openings', 'fb_mirror_masters', 'fb_mirror_catchup', 'fb_mirror_catchup_all', 'fb_enroll', 'fb_tieout', 'fb_tieout_all',
      'fb_tieout_ask', 'fb_filing_warning', 'fb_opening_signoff', 'fb_source_figures_put', 'fb_audit_verify', 'fb_selfcheck', 'fb_selfcheck_all',
      'fb_status', 'fb_tb', 'fb_ledger', 'fb_ledgers', 'fb_daybook', 'fb_closing', 'fb_copy_window', 'fb_copy_openings',
      'fb_audit_eid', 'fb_vouchers_open_trg', 'fb_mirror_triage', 'fb_mirror_catchup_run', 'fb_audit_client_info', 'fb_behind_since', 'fb_mirror_failed', 'fb_mirror_one', 'fb_mirror_list', 'fb_mirror_run_failed'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f and coalesce(obj_description(p.oid, 'pg_proc'), '') <> mark) then bad := bad || ('function ' || f); end if;
  end loop;
  -- the mirror's trigger names on the copy's landing tables, each one: a trigger of that name must be ours
  foreach t in array array['tally_vouchers', 'tally_lines', 'tally_bills', 'tally_cost_allocs', 'tally_ledgers', 'tally_groups'] loop
    foreach f in array array['fb_land_i', 'fb_land_u', 'fb_land_d'] loop
      if exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid where g.tgrelid = ('public.' || t)::regclass and g.tgname = f
                 and coalesce(obj_description(p.oid, 'pg_proc'), '') <> mark) then bad := bad || ('trigger ' || f || ' on ' || t); end if;
    end loop;
  end loop;
  -- index names (one namespace with tables): an index of that name must be on our table
  foreach f in array array['fb_books_source_book', 'fb_books_client', 'fb_vouchers_source_ref', 'fb_vouchers_day', 'fb_lines_ledger', 'fb_bill_refs_party',
      'fb_audit_log_book', 'fb_audit_log_voucher', 'fb_audit_log_entity', 'fb_tieouts_book', 'fb_source_figures_book', 'fb_mirror_errors_open', 'fb_mirror_dirty_book'] loop
    if to_regclass('public.' || f) is not null and not exists (select 1 from pg_index i join pg_class c on c.oid = i.indrelid
         where i.indexrelid = to_regclass('public.' || f) and coalesce(obj_description(c.oid, 'pg_class'), '') = mark) then bad := bad || ('index ' || f); end if;
  end loop;
  -- policy names: ours read through fb_my_books() (or are the seed groups' open read)
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.policyname like 'fb\_%\_read' and p.tablename like 'fb\_%'
             and coalesce(obj_description(to_regclass('public.' || p.tablename), 'pg_class'), '') = mark
             and not (coalesce(p.qual, '') like '%fb_my_books%' or p.policyname = 'fb_seed_groups_read')) then
    bad := bad || 'a policy named fb_*_read that is not FinCom Books''s'::text;
  end if;
  if to_regclass('public.fb_missed_seq') is not null and coalesce(obj_description(to_regclass('public.fb_missed_seq'), 'pg_class'), '') <> mark then bad := bad || 'sequence fb_missed_seq'::text; end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 220: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- ---------------------------------------------------------------- the store
create table if not exists public.fb_books (
  book_id          uuid primary key default gen_random_uuid(),
  firm_id          uuid not null,
  client_id        text not null,
  source           text not null check (source in ('tally', 'zoho', 'own')),
  source_book_id   uuid,                 -- the tally_books.book_id it mirrors (tally and zoho); no foreign key: FinCom Books outlive the copy
  company          text not null default '',
  mirror_on        boolean not null default false,
  mirror_from      date,                 -- D20: the first day mirrored voucher by voucher; what is older is carried into the openings
  books_begin      date,
  in_step          boolean,
  in_step_at       timestamptz,
  not_in_step_since timestamptz,
  not_in_step_why  text not null default '',
  last_tieout_id   bigint,
  opening_signoff  jsonb,                -- D7: {amount, reason, by, at}: the owner accepted this opening difference for this book
  legal_name       text not null default '',
  constitution     text not null default '',
  cin_llpin        text not null default '',
  pan              text not null default '',
  tan              text not null default '',
  sch3_division    text not null default 'I' check (sch3_division in ('I', 'II', 'III')),
  currency         text not null default 'INR' check (currency = 'INR'),
  state            text not null default 'setting_up' check (state in ('setting_up', 'live', 'read_only', 'archived')),
  read_only_why    text not null default '',
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.fb_years (
  book_id uuid not null references public.fb_books (book_id), firm_id uuid not null, fy text not null, starts date not null, ends date not null,
  status text not null default 'open' check (status in ('open', 'closing', 'closed')), closed_by uuid, closed_at timestamptz,
  primary key (book_id, fy));

create table if not exists public.fb_registrations (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  gstin text not null, state_code text not null default '', reg_type text not null default 'regular'
    check (reg_type in ('regular', 'composition', 'sez_unit', 'isd', 'casual', 'non_resident')),
  legal_name text not null default '', trade_name text not null default '', valid_from date, valid_to date,
  einvoice boolean not null default false, eway boolean not null default false, branch_id bigint, source_ref text,
  unique (book_id, gstin));

create table if not exists public.fb_branches (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  name text not null, registration_id bigint references public.fb_registrations (id), address text not null default '',
  is_head_office boolean not null default false, ho_control_ledger_id bigint, unique (book_id, name));

-- Tally's 28 reserved groups (15 primary, 13 sub-groups) with their Schedule III line, Division I (D6). A constant list
-- every book is seeded from; a sub-group's code is the nearest reserved group's. Cross-checked against Independent
-- Books' GROUP_PARENTS (Tally's public structure, nothing copied: THIRD_PARTY_NOTICES.md)
create table if not exists public.fb_seed_groups (
  name text primary key, parent text, nature text not null check (nature in ('asset', 'liability', 'equity', 'income', 'expense')),
  sch3_code text not null, affects_gross_profit boolean not null default false, sort int not null);
insert into public.fb_seed_groups (name, parent, nature, sch3_code, affects_gross_profit, sort) values
  ('Capital Account', null, 'equity', 'EQ.SC', false, 10),
  ('Reserves & Surplus', 'Capital Account', 'equity', 'EQ.OE', false, 11),
  ('Loans (Liability)', null, 'liability', 'NCL.BOR', false, 20),
  ('Secured Loans', 'Loans (Liability)', 'liability', 'NCL.BOR', false, 21),
  ('Unsecured Loans', 'Loans (Liability)', 'liability', 'NCL.BOR', false, 22),
  ('Bank OD A/c', 'Loans (Liability)', 'liability', 'CL.BOR', false, 23),
  ('Current Liabilities', null, 'liability', 'CL.OCL', false, 30),
  ('Duties & Taxes', 'Current Liabilities', 'liability', 'CL.OCL', false, 31),
  ('Provisions', 'Current Liabilities', 'liability', 'CL.PROV', false, 32),
  ('Sundry Creditors', 'Current Liabilities', 'liability', 'CL.TP', false, 33),
  ('Branch / Divisions', null, 'liability', 'X.BRANCH', false, 40),
  ('Suspense A/c', null, 'liability', 'X.SUSP', false, 41),
  ('Fixed Assets', null, 'asset', 'NCA.PPE', false, 50),
  ('Investments', null, 'asset', 'NCA.INV', false, 51),
  ('Current Assets', null, 'asset', 'CA.OCA', false, 60),
  ('Stock-in-Hand', 'Current Assets', 'asset', 'CA.INVT', false, 61),
  ('Sundry Debtors', 'Current Assets', 'asset', 'CA.TR', false, 62),
  ('Bank Accounts', 'Current Assets', 'asset', 'CA.CASH', false, 63),
  ('Cash-in-Hand', 'Current Assets', 'asset', 'CA.CASH', false, 64),
  ('Loans & Advances (Asset)', 'Current Assets', 'asset', 'CA.LA', false, 65),
  ('Deposits (Asset)', 'Current Assets', 'asset', 'NCA.LA', false, 66),
  ('Misc. Expenses (ASSET)', null, 'asset', 'NCA.OTH', false, 70),
  ('Sales Accounts', null, 'income', 'PL.REV', true, 80),
  ('Direct Incomes', null, 'income', 'PL.REV', true, 81),
  ('Indirect Incomes', null, 'income', 'PL.OI', false, 82),
  ('Purchase Accounts', null, 'expense', 'PL.PUR', true, 90),
  ('Direct Expenses', null, 'expense', 'PL.COGS', true, 91),
  ('Indirect Expenses', null, 'expense', 'PL.OTH', false, 92)
on conflict (name) do nothing;

create table if not exists public.fb_groups (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  parent_id bigint references public.fb_groups (id), name text not null,
  reserved text not null default '',      -- the nearest of Tally's 28 reserved groups (itself, a parent, or '' if none)
  primary_name text not null default '',  -- the primary group at the top of the tree
  nature text check (nature in ('asset', 'liability', 'equity', 'income', 'expense')), sch3_code text not null default '',
  affects_gross_profit boolean not null default false, is_system boolean not null default false, sort int not null default 1000,
  inactive boolean not null default false, mirror_note text not null default '', updated_at timestamptz not null default now(),
  unique (book_id, name));

create table if not exists public.fb_ledgers (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  group_id bigint references public.fb_groups (id), name text not null, alias text not null default '', code text not null default '',
  kind text not null default 'other' check (kind in ('party', 'bank', 'cash', 'gst_tax', 'tds_tax', 'tax', 'income', 'expense', 'asset', 'stock', 'capital', 'other')),
  gstin text not null default '', pan text not null default '', state_code text not null default '', state_name text not null default '',
  gst_reg_type text not null default '', country text not null default '',
  tds_section_default text not null default '', tds_deductee_type text not null default '', lower_cert_no text not null default '',
  msme_udyam text not null default '', msme_type text not null default '',
  bill_wise boolean, credit_days int, cost_centres_on boolean, bank_ifsc text not null default '', bank_acct_masked text not null default '',
  maturity text not null default '', inactive boolean not null default false, mirror_note text not null default '',
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (book_id, name));

create table if not exists public.fb_openings (
  book_id uuid not null references public.fb_books (book_id), firm_id uuid not null, as_on date not null, ledger_id bigint not null references public.fb_ledgers (id),
  amount numeric(18,2) not null default 0, note text not null default '', primary key (book_id, as_on, ledger_id));

create table if not exists public.fb_vtypes (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  base text not null check (base in ('sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'credit_note', 'debit_note', 'delivery_note',
    'receipt_note', 'stock_journal', 'memo', 'payroll', 'unknown')),
  name text not null, approval_rule_id bigint, inactive boolean not null default false, mirror_note text not null default '', unique (book_id, name));

create table if not exists public.fb_series (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  vtype_id bigint not null references public.fb_vtypes (id), registration_id bigint references public.fb_registrations (id), fy text not null,
  prefix text not null default '', suffix text not null default '', width int not null default 0, next_no bigint not null default 1,
  restart_yearly boolean not null default true);

create table if not exists public.fb_cost_categories (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  parent_id bigint references public.fb_cost_categories (id), name text not null, inactive boolean not null default false, unique (book_id, name));
create table if not exists public.fb_cost_centres (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  category_id bigint references public.fb_cost_categories (id), parent_id bigint references public.fb_cost_centres (id), name text not null,
  inactive boolean not null default false, mirror_note text not null default '', unique (book_id, category_id, name));

create table if not exists public.fb_vouchers (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.fb_books (book_id),
  firm_id          uuid not null,
  fy               text not null,
  vtype_id         bigint references public.fb_vtypes (id),
  series_id        bigint references public.fb_series (id),
  number           text not null default '',
  date             date not null,
  branch_id        bigint references public.fb_branches (id),
  registration_id  bigint references public.fb_registrations (id),
  party_ledger_id  bigint references public.fb_ledgers (id),
  ref_no           text not null default '',
  ref_date         date,
  narration        text not null default '',
  status           text not null default 'draft' check (status in ('draft', 'pending', 'posted', 'cancelled', 'sent', 'refused', 'held')),
  memo             boolean not null default false,   -- optional (Tally) or non-accounting: shown, never in a total
  version          int not null default 1,
  gst              jsonb not null default '{}'::jsonb,
  irn              text not null default '',
  irn_ack_no       text not null default '',
  irn_ack_at       date,
  eway_no          text not null default '',
  source           text not null check (source in ('own', 'bank', 'purchase', 'sales', 'tally', 'zoho', 'import_tally', 'import_zoho')),
  source_ref       text,                             -- the Tally GUID / Zoho id
  source_alter     bigint,                           -- Tally's AlterID as last mirrored
  source_gone      boolean not null default false,   -- deleted in the source (kept here as cancelled)
  mirror_note      text not null default '',
  content_hash     text,
  edit_reason      text not null default '',
  created_by       uuid, created_at timestamptz not null default now(),
  posted_by        uuid, posted_at timestamptz,
  cancelled_by     uuid, cancelled_at timestamptz, cancel_reason text not null default '',
  updated_at       timestamptz not null default now()
);

-- lines are kept per version: a new version has new lines; no line is ever changed or removed
create table if not exists public.fb_lines (
  voucher_id uuid not null references public.fb_vouchers (id), version int not null, line_no int not null,
  book_id uuid not null, firm_id uuid not null, date date not null,
  ledger_id bigint not null references public.fb_ledgers (id), amount numeric(18,2) not null,   -- Dr positive, Cr negative
  narration text not null default '', cost_centre_id bigint references public.fb_cost_centres (id),
  tax_kind text check (tax_kind in ('cgst', 'sgst', 'igst', 'cess', 'tds', 'tcs')), tax_rate numeric, taxable_value numeric(18,2),
  hsn_sac text not null default '', tds_section text not null default '', tds_base numeric(18,2),
  primary key (voucher_id, version, line_no));
create table if not exists public.fb_line_cc (
  voucher_id uuid not null references public.fb_vouchers (id), version int not null, line_no int not null, part_no int not null,
  book_id uuid not null, firm_id uuid not null, cost_centre_id bigint not null references public.fb_cost_centres (id), amount numeric(18,2) not null,
  primary key (voucher_id, version, line_no, part_no));
create table if not exists public.fb_bill_refs (
  voucher_id uuid not null references public.fb_vouchers (id), version int not null, line_no int not null, part_no int not null,
  book_id uuid not null, firm_id uuid not null, party_ledger_id bigint not null references public.fb_ledgers (id),
  ref_type text not null check (ref_type in ('new', 'against', 'advance', 'on_account')), ref_name text not null default '',
  amount numeric(18,2) not null, bill_date date, due_date date, credit_days int,
  primary key (voucher_id, version, line_no, part_no));
create table if not exists public.fb_voucher_versions (
  voucher_id uuid not null references public.fb_vouchers (id), version int not null, book_id uuid not null, firm_id uuid not null,
  snapshot jsonb not null, reason text not null default '', at timestamptz not null default clock_timestamp(), actor uuid,
  primary key (voucher_id, version));

-- P4 (own-books entry) uses these; made now so the audit trail covers them from the first day
create table if not exists public.fb_locks (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  registration_id bigint references public.fb_registrations (id), kind text not null check (kind in ('books', 'gst', 'tds')),
  from_date date not null, to_date date not null, reason text not null default '', locked_by uuid, locked_at timestamptz not null default now(),
  unlocked_by uuid, unlocked_at timestamptz, unlock_reason text not null default '');
create table if not exists public.fb_approval_rules (
  id bigint generated always as identity primary key, book_id uuid not null references public.fb_books (book_id), firm_id uuid not null,
  vtype_id bigint references public.fb_vtypes (id), amount_over numeric(18,2), approver_role text not null default 'approver',
  two_approvers boolean not null default false, maker_can_approve boolean not null default false check (not maker_can_approve));
create table if not exists public.fb_approvals (
  voucher_id uuid not null references public.fb_vouchers (id), version int not null, book_id uuid not null, firm_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')), by_user uuid not null, at timestamptz not null default now(), note text not null default '',
  primary key (voucher_id, version, by_user));
-- per book: who may see it (RLS). No row for a book = every member of the firm (today's rule); once a row names someone,
-- only the people named (and the firm's owner) see that book
create table if not exists public.fb_grants (
  book_id uuid not null references public.fb_books (book_id), firm_id uuid not null, user_id uuid not null,
  role text not null check (role in ('viewer', 'accountant', 'approver', 'book_admin', 'auditor')), branch_ids bigint[],
  valid_until timestamptz, granted_by uuid, granted_at timestamptz not null default now(), primary key (book_id, user_id));
create table if not exists public.client_books_mode (
  firm_id uuid not null, client_id text not null, source text not null check (source in ('tally', 'zoho', 'fincom')), effective_from date not null,
  book_id uuid not null references public.fb_books (book_id), set_by uuid, set_at timestamptz not null default now(), previous jsonb,
  primary key (firm_id, client_id, effective_from));

-- the edit log (plan 2.6)
create table if not exists public.fb_audit_log (
  seq          bigint generated always as identity primary key,
  book_id      uuid not null,
  at           timestamptz not null default clock_timestamp(),
  actor        uuid,
  actor_kind   text not null,
  actor_role   text not null,
  client_info  jsonb,
  action       text not null,
  entity       text not null,
  entity_id    text not null,
  voucher_id   uuid,
  version_from int,
  version_to   int,
  before       jsonb,
  after        jsonb,
  reason       text,
  prev_hash    bytea not null,
  hash         bytea not null
);
-- the last hash of each day per book (the external copy, write-once storage, is a later step: docs/FINCOM-BOOKS-P1.md)
create table if not exists public.fb_audit_anchors (
  book_id uuid not null, day date not null, seq bigint not null, hash bytea not null, at timestamptz not null default now(), primary key (book_id, day));

create table if not exists public.fb_tieouts (
  id bigint generated always as identity primary key, book_id uuid not null, firm_id uuid not null, at timestamptz not null default now(),
  kind text not null check (kind in ('nightly', 'asked', 'build')), asked_by uuid, window_from date, window_to date,
  in_step boolean not null, copy_figures jsonb not null default '{}'::jsonb, fb_figures jsonb not null default '{}'::jsonb,
  source_figures jsonb, differences jsonb not null default '[]'::jsonb, words text not null default '');
-- Tally's (or Zoho's) own figures for the tie-out, as the bridge reads them. TODO (D16): bridge 2.5.19's new read of the
-- primary groups' closing balances lands here through fb_source_figures_put; each request is shown to the owner first.
-- Until then this table is empty and the tie-out says "Tally's own trial balance: not read yet".
create table if not exists public.fb_source_figures (
  id bigint generated always as identity primary key, book_id uuid not null, firm_id uuid not null, kind text not null check (kind in ('group_closing', 'voucher_counts', 'alter_max')),
  as_on date not null, figures jsonb not null, read_by text not null default '', at timestamptz not null default now());
create table if not exists public.fb_mirror_errors (
  id bigint generated always as identity primary key, book_id uuid, at timestamptz not null default now(), kind text not null, key text not null default '',
  error text not null, resolved_at timestamptz,
  tries int not null default 1, retry_at timestamptz);   -- an entry the catch-up cannot mirror: tried again at retry_at (3, 6, 12 ... minutes, at most an hour)
-- (a table made by an earlier draft of this migration gets the two columns; checked first, so a re-run takes no lock)
do $col$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fb_mirror_errors' and column_name = 'tries') then
    alter table public.fb_mirror_errors add column if not exists tries int not null default 1;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fb_mirror_errors' and column_name = 'retry_at') then
    alter table public.fb_mirror_errors add column if not exists retry_at timestamptz;
  end if;
end $col$;
-- the mirror's work list: what the copy changed and FinCom Books has not mirrored yet (first_at: since when; seq: bumped
-- each time it is noted again, so the catch-up never drops a note made while it was mirroring that entry)
create table if not exists public.fb_mirror_dirty (
  book_id uuid not null, kind text not null check (kind in ('v', 'l', 'g')), key text not null, seq bigint generated by default as identity,
  first_at timestamptz not null default now(), primary key (book_id, kind, key));
-- the mirror's own bookkeeping per book, kept out of fb_books so that it does not fill the edit log every few minutes:
-- when it last caught up, the sweep's position and the 'missed' rows it covers, the last fb_missed_seq value seen
create table if not exists public.fb_mirror_state (
  book_id uuid primary key references public.fb_books (book_id), mirrored_at timestamptz, sweep_after text, sweep_covers bigint[], sweep_started timestamptz,
  missed_seen bigint not null default 0);
-- the last resort of a landing trigger that could not even write its 'missed' row: a sequence tick (never blocks, never
-- rolls back); the catch-up sees it moved and sweeps
create sequence if not exists public.fb_missed_seq;

-- the indexes, made only when missing (CREATE INDEX IF NOT EXISTS would still take a SHARE lock on a re-run)
do $ix$
declare x text[];
begin
  foreach x slice 1 in array array[
    ['fb_books_source_book', 'create unique index fb_books_source_book on public.fb_books (source_book_id) where source_book_id is not null'],
    ['fb_books_client', 'create index fb_books_client on public.fb_books (firm_id, client_id)'],
    ['fb_vouchers_source_ref', 'create unique index fb_vouchers_source_ref on public.fb_vouchers (book_id, source_ref) where source_ref is not null'],
    ['fb_vouchers_day', 'create index fb_vouchers_day on public.fb_vouchers (book_id, date)'],
    ['fb_lines_ledger', 'create index fb_lines_ledger on public.fb_lines (book_id, ledger_id, date)'],
    ['fb_bill_refs_party', 'create index fb_bill_refs_party on public.fb_bill_refs (book_id, party_ledger_id)'],
    ['fb_audit_log_book', 'create index fb_audit_log_book on public.fb_audit_log (book_id, seq)'],
    ['fb_audit_log_voucher', 'create index fb_audit_log_voucher on public.fb_audit_log (voucher_id, seq) where voucher_id is not null'],
    ['fb_tieouts_book', 'create index fb_tieouts_book on public.fb_tieouts (book_id, at desc)'],
    ['fb_source_figures_book', 'create index fb_source_figures_book on public.fb_source_figures (book_id, kind, at desc)'],
    ['fb_mirror_errors_open', 'create index fb_mirror_errors_open on public.fb_mirror_errors (book_id) where resolved_at is null'],
    ['fb_audit_log_entity', 'create index fb_audit_log_entity on public.fb_audit_log (book_id, entity, entity_id, seq)'],
    ['fb_mirror_dirty_book', 'create index fb_mirror_dirty_book on public.fb_mirror_dirty (book_id, first_at)']] loop
    if to_regclass('public.' || x[1]) is null then execute x[2]; end if;
  end loop;
end $ix$;

do $c$
declare t text;
begin
  foreach t in array array['fb_books', 'fb_years', 'fb_registrations', 'fb_branches', 'fb_seed_groups', 'fb_groups', 'fb_ledgers', 'fb_openings',
      'fb_vtypes', 'fb_series', 'fb_cost_categories', 'fb_cost_centres', 'fb_vouchers', 'fb_lines', 'fb_line_cc', 'fb_bill_refs',
      'fb_voucher_versions', 'fb_locks', 'fb_approval_rules', 'fb_approvals', 'fb_grants', 'client_books_mode', 'fb_audit_log', 'fb_audit_anchors',
      'fb_tieouts', 'fb_source_figures', 'fb_mirror_errors', 'fb_mirror_dirty', 'fb_mirror_state'] loop
    execute format('comment on table public.%I is %L', t, 'fincom books (migration 220)');
  end loop;
  comment on sequence public.fb_missed_seq is 'fincom books (migration 220)';
  revoke all on sequence public.fb_missed_seq from public, anon, authenticated, service_role;
end $c$;

-- ---------------------------------------------------------------- small helpers
-- money as the owner reads it: ₹4,20,000.00 (Indian grouping)
create or replace function public.fb_inr(p numeric) returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  with s as (select to_char(abs(round(coalesce(p, 0), 2)), 'FM99999999999999990.00') as t),
  i as (select split_part(t, '.', 1) as ip, split_part(t, '.', 2) as dp from s)
  select case when round(coalesce(p, 0), 2) < 0 then '-' else '' end || '₹' ||
    case when length(ip) <= 3 then ip else regexp_replace(left(ip, length(ip) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || right(ip, 3) end || '.' || dp
  from i
$f$;
create or replace function public.fb_fy_start(d date) returns date language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select make_date(case when extract(month from d) >= 4 then extract(year from d)::int else extract(year from d)::int - 1 end, 4, 1)
$f$;
create or replace function public.fb_fy(d date) returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select extract(year from public.fb_fy_start(d))::int || '-' || lpad(((extract(year from public.fb_fy_start(d))::int + 1) % 100)::text, 2, '0')
$f$;
create or replace function public.fb_is_owner() returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = my_firm() and m.active and m.role = 'owner')
$f$;
-- the books the person may read: their firm's, and where a book names its people (fb_grants), only if named (or owner)
create or replace function public.fb_my_books() returns setof uuid language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select b.book_id from fb_books b
   where b.firm_id = my_firm()
     and (not exists (select 1 from fb_grants g where g.book_id = b.book_id)
          or exists (select 1 from fb_grants g where g.book_id = b.book_id and g.user_id = auth.uid() and (g.valid_until is null or g.valid_until > now()))
          or fb_is_owner())
$f$;

-- ---------------------------------------------------------------- the edit log, written by the database
create or replace function public.fb_audit_canon(l public.fb_audit_log) returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select jsonb_build_object('seq', l.seq, 'book', l.book_id, 'at', to_char(l.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', l.actor, 'kind', l.actor_kind, 'role', l.actor_role, 'client', l.client_info, 'action', l.action, 'entity', l.entity, 'id', l.entity_id,
    'voucher', l.voucher_id, 'vf', l.version_from, 'vt', l.version_to, 'before', l.before, 'after', l.after, 'reason', l.reason)::text
$f$;

-- a row's id in the edit log (entity_id), the same for the trigger and for the self-check's reconciliation
create or replace function public.fb_audit_eid(j jsonb) returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select coalesce(j ->> 'id',
    j ->> 'voucher_id' || ':' || coalesce(j ->> 'version', '') || ':' || coalesce(j ->> 'line_no', '') || ':' || coalesce(j ->> 'part_no', ''),
    j ->> 'ledger_id', j ->> 'user_id', j ->> 'fy', j ->> 'book_id')
$f$;

-- (timezone UTC: a row's after-image is written the same way whoever writes it, so the self-check can compare it)
create or replace function public.fb_audit_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' set timezone to 'UTC' as $f$
declare bef jsonb; aft jsonb; r public.fb_audit_log; prev bytea; hdr jsonb; act text; ci text;
begin
  aft := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  bef := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  if tg_op = 'UPDATE' and bef = aft then return null; end if;
  r.book_id := coalesce(aft ->> 'book_id', bef ->> 'book_id')::uuid;
  r.actor := auth.uid();
  r.actor_kind := coalesce(nullif(current_setting('fincom.fb_actor', true), ''), case when r.actor is null then 'system' else 'member' end);
  select m.role into r.actor_role from members m where m.user_id = r.actor and m.active order by (m.firm_id = (select b.firm_id from fb_books b where b.book_id = r.book_id)) desc limit 1;
  r.actor_role := coalesce(r.actor_role, case when r.actor is null then 'system' else 'none' end);
  -- where the change came from (PostgREST's request headers), worked out once per transaction: no subtransaction per row
  ci := current_setting('fincom.fb_client', true);
  if ci is null or ci = '' then
    hdr := null;
    if coalesce(current_setting('request.headers', true), '') <> '' then
      begin hdr := current_setting('request.headers', true)::jsonb; exception when others then hdr := null; end;
    end if;
    ci := coalesce(case when hdr is null then null else jsonb_strip_nulls(jsonb_build_object('ua', left(hdr ->> 'user-agent', 200), 'ip', split_part(hdr ->> 'x-forwarded-for', ',', 1), 'app', left(hdr ->> 'x-fincom-app', 60))) end::text, 'null');
    perform set_config('fincom.fb_client', ci, true);
  end if;
  r.client_info := nullif(ci, 'null')::jsonb;
  r.entity := tg_table_name;
  r.entity_id := fb_audit_eid(coalesce(aft, bef));
  if tg_table_name = 'fb_vouchers' then
    r.voucher_id := coalesce(aft, bef) ->> 'id'; r.version_from := (bef ->> 'version')::int; r.version_to := (aft ->> 'version')::int;
  elsif tg_table_name in ('fb_lines', 'fb_line_cc', 'fb_bill_refs', 'fb_voucher_versions', 'fb_approvals') then
    r.voucher_id := coalesce(aft, bef) ->> 'voucher_id'; r.version_to := (coalesce(aft, bef) ->> 'version')::int;
  end if;
  act := case tg_op when 'INSERT' then 'insert' when 'DELETE' then 'delete' else 'update' end;
  if tg_table_name = 'fb_vouchers' and tg_op = 'UPDATE' then
    if aft ->> 'status' = 'cancelled' and bef ->> 'status' <> 'cancelled' then act := 'cancel'; r.reason := aft ->> 'cancel_reason';
    elsif aft ->> 'status' = 'posted' and bef ->> 'status' <> 'posted' then act := 'post';
    end if;
    if r.version_from is distinct from r.version_to then r.reason := coalesce(r.reason, nullif(aft ->> 'edit_reason', '')); end if;
  elsif tg_table_name = 'fb_vouchers' and tg_op = 'INSERT' and r.actor_kind like 'system:%' then act := 'import';
  end if;
  r.action := act;
  r.reason := coalesce(r.reason, nullif(current_setting('fincom.fb_reason', true), ''));
  r.before := bef; r.after := aft;
  r.at := clock_timestamp();
  -- one writer at a time per book, so the chain is in seq order
  perform pg_advisory_xact_lock(hashtextextended('fb_audit:' || r.book_id::text, 0));
  select l.hash into prev from fb_audit_log l where l.book_id = r.book_id order by l.seq desc limit 1;
  r.prev_hash := coalesce(prev, sha256(convert_to('fincom books ' || r.book_id::text, 'UTF8')));
  r.seq := nextval(pg_get_serial_sequence('public.fb_audit_log', 'seq'));
  r.hash := sha256(r.prev_hash || convert_to(fb_audit_canon(r), 'UTF8'));
  insert into fb_audit_log overriding system value select r.*;
  return null;
end $f$;

create or replace function public.fb_no_delete_trg() returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  raise exception 'FinCom Books keeps every row: nothing is deleted from % (cancel or make it inactive instead)', tg_table_name using errcode = '42501';
end $f$;
create or replace function public.fb_no_change_trg() returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  raise exception 'FinCom Books: a row of % is never changed or deleted', tg_table_name using errcode = '42501';
end $f$;
create or replace function public.fb_no_truncate_trg() returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  raise exception 'FinCom Books: % cannot be emptied', tg_table_name using errcode = '42501';
end $f$;

-- D3: a posted own-books voucher changes only as a new version, with a reason; the version before is kept whole
create or replace function public.fb_vouchers_guard_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare mirror boolean := old.source in ('tally', 'zoho');
begin
  if new.id <> old.id or new.book_id <> old.book_id or new.source <> old.source or new.source_ref is distinct from old.source_ref or new.firm_id <> old.firm_id then
    raise exception 'FinCom Books: a voucher''s book, source and id never change' using errcode = '42501';
  end if;
  if new.version < old.version or new.version > old.version + 1 then
    raise exception 'FinCom Books: a voucher moves one version at a time (% to %)', old.version, new.version using errcode = '22023';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' and not mirror then
    raise exception 'A cancelled voucher stays cancelled; its number is kept.' using errcode = '22023';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' and not mirror and coalesce(btrim(new.cancel_reason), '') = '' then
    raise exception 'Give a reason for cancelling this voucher.' using errcode = '22023';
  end if;
  -- a posted voucher never goes back: in place it may only be cancelled (with a reason); a new version is posted,
  -- pending (for approval again) or cancelled, never a draft
  if not mirror and old.status = 'posted' and new.status not in ('posted', 'cancelled') and (new.version = old.version or new.status <> 'pending') then
    raise exception 'A posted voucher cannot go back to %; change it as a new version, with a reason, or cancel it.', new.status using errcode = '22023';
  end if;
  if new.version = old.version + 1 then
    perform set_config('fincom.fb_open', right(coalesce(current_setting('fincom.fb_open', true), ''), 20000) || ',' || new.id::text, true);
    if not mirror and old.status in ('posted', 'pending') and (coalesce(btrim(new.edit_reason), '') = '' or new.edit_reason = old.edit_reason) then
      raise exception 'Give a reason for changing a posted voucher.' using errcode = '22023';
    end if;
    insert into fb_voucher_versions (voucher_id, version, book_id, firm_id, snapshot, reason, actor)
    values (old.id, old.version, old.book_id, old.firm_id, to_jsonb(old), coalesce(new.edit_reason, ''), auth.uid());
  elsif not mirror and old.status in ('posted', 'pending')
        and (new.date, new.number, new.party_ledger_id, new.narration, new.vtype_id, new.ref_no, new.ref_date, new.gst, new.memo, new.registration_id, new.branch_id)
            is distinct from (old.date, old.number, old.party_ledger_id, old.narration, old.vtype_id, old.ref_no, old.ref_date, old.gst, old.memo, old.registration_id, old.branch_id) then
    raise exception 'A posted voucher changes only as a new version, with a reason.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $f$;

-- a voucher made, or given a new version, in this transaction may get its lines (D3: a posted voucher's current
-- version gets no new line afterwards). Own entries only; the mirror writes Tally's lines as they are
create or replace function public.fb_vouchers_open_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  perform set_config('fincom.fb_open', right(coalesce(current_setting('fincom.fb_open', true), ''), 20000) || ',' || new.id::text, true);
  return new;
end $f$;

-- a line belongs to its voucher's current version; its book, firm and date are the voucher's
create or replace function public.fb_lines_guard_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v record;
begin
  select x.version, x.book_id, x.firm_id, x.date, x.status, x.source into v from fb_vouchers x where x.id = new.voucher_id;
  if v.version is null or new.version <> v.version then
    raise exception 'FinCom Books: lines are added only to a voucher''s current version' using errcode = '22023';
  end if;
  if v.source not in ('tally', 'zoho') and v.status in ('posted', 'pending')
     and position(',' || new.voucher_id::text in coalesce(current_setting('fincom.fb_open', true), '')) = 0 then
    raise exception 'A posted voucher gets new lines only as a new version, with a reason.' using errcode = '22023';
  end if;
  new.book_id := v.book_id; new.firm_id := v.firm_id;
  if tg_table_name = 'fb_lines' then new.date := v.date; end if;
  return new;
end $f$;

-- the rules checked at COMMIT (plan 2.3): Dr = Cr to the paisa; a posted voucher has two lines or more (unless it is a
-- memo); for own entries the cost-centre parts (per cost category) and the bill references add up to their line
create or replace function public.fb_check_voucher(p_id uuid) returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v record; s numeric; n int; bad record;
begin
  select x.id, x.number, x.status, x.memo, x.version, x.source into v from fb_vouchers x where x.id = p_id;
  if v.id is null or v.status not in ('posted', 'pending', 'sent') then return; end if;
  select coalesce(sum(l.amount), 0), count(*) filter (where l.amount <> 0) into s, n from fb_lines l where l.voucher_id = p_id and l.version = v.version;
  if s <> 0 then
    raise exception 'FinCom Books: voucher % does not balance: Dr and Cr differ by %', nullif(v.number, ''), fb_inr(abs(s)) using errcode = '23514';
  end if;
  if n < 2 and not v.memo then
    raise exception 'FinCom Books: voucher % needs at least two lines', nullif(v.number, '') using errcode = '23514';
  end if;
  if v.source not in ('tally', 'zoho') then
    -- each cost category allocates the whole line (as in Tally): its centres add up to the line, category by category
    select l.line_no, l.amount, sum(c.amount) as parts into bad from fb_lines l join fb_line_cc c on c.voucher_id = l.voucher_id and c.version = l.version and c.line_no = l.line_no
      join fb_cost_centres k on k.id = c.cost_centre_id
     where l.voucher_id = p_id and l.version = v.version group by l.line_no, l.amount, k.category_id having sum(c.amount) <> l.amount limit 1;
    if bad.line_no is not null then
      raise exception 'FinCom Books: line % is % but its cost centres add up to %', bad.line_no, fb_inr(bad.amount), fb_inr(bad.parts) using errcode = '23514';
    end if;
    select l.line_no, l.amount, sum(b.amount) as parts into bad from fb_lines l join fb_bill_refs b on b.voucher_id = l.voucher_id and b.version = l.version and b.line_no = l.line_no
     where l.voucher_id = p_id and l.version = v.version group by l.line_no, l.amount having sum(b.amount) <> l.amount limit 1;
    if bad.line_no is not null then
      raise exception 'FinCom Books: line % is % but its bill references add up to %', bad.line_no, fb_inr(bad.amount), fb_inr(bad.parts) using errcode = '23514';
    end if;
  end if;
end $f$;
create or replace function public.fb_check_voucher_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if tg_table_name = 'fb_vouchers' then perform fb_check_voucher(new.id); else perform fb_check_voucher(new.voucher_id); end if;
  return null;
end $f$;

-- ---------------------------------------------------------------- the mirror builder
create or replace function public.fb_vtype_base(p text) returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  -- Tally's own type names; a type the user made ("Sales – Delhi") is 'unknown' until the voucher-type masters are read
  -- (TODO D16: bridge 2.5.19's Voucher Type read gives each type's base; nothing is guessed from a name beyond Tally's own)
  select case lower(btrim(coalesce(p, '')))
    when 'sales' then 'sales' when 'purchase' then 'purchase' when 'receipt' then 'receipt' when 'payment' then 'payment'
    when 'journal' then 'journal' when 'contra' then 'contra' when 'credit note' then 'credit_note' when 'debit note' then 'debit_note'
    when 'delivery note' then 'delivery_note' when 'receipt note' then 'receipt_note' when 'stock journal' then 'stock_journal'
    when 'memorandum' then 'memo' when 'payroll' then 'payroll' else 'unknown' end
$f$;

-- every book starts with Tally's 28 reserved groups
create or replace function public.fb_seed_book(p_book uuid) returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare f uuid; s record;
begin
  select firm_id into f from fb_books where book_id = p_book;
  for s in select * from fb_seed_groups order by (parent is not null), sort loop
    insert into fb_groups (book_id, firm_id, parent_id, name, reserved, primary_name, nature, sch3_code, affects_gross_profit, is_system, sort)
    values (p_book, f, (select g.id from fb_groups g where g.book_id = p_book and g.name = s.parent), s.name, s.name, coalesce(s.parent, s.name), s.nature, s.sch3_code,
            s.affects_gross_profit, true, s.sort)
    on conflict (book_id, name) do nothing;
  end loop;
end $f$;

-- a group from the copy (tally_groups), its parents first; nature and Schedule III code from the nearest reserved group
create or replace function public.fb_mirror_group(p_book uuid, p_name text, p_depth int default 0) returns bigint language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; t record; pid bigint; par record; seed record; gid bigint; nm text := coalesce(p_name, '');
begin
  if nm = '' or p_depth > 40 then return null; end if;
  select x.book_id, x.firm_id, x.source_book_id into b from fb_books x where x.book_id = p_book;
  select g.name, g.parent into t from tally_groups g where g.book_id = b.source_book_id and g.name = nm;
  select * into seed from fb_seed_groups s where s.name = nm;
  if t.name is null and seed.name is null then
    -- named by a ledger but not in the copy's groups: kept, without a parent, and said so
    insert into fb_groups (book_id, firm_id, name, mirror_note) values (p_book, b.firm_id, nm, 'not in Tally''s group list in the copy')
    on conflict (book_id, name) do nothing;
    select g.id into gid from fb_groups g where g.book_id = p_book and g.name = nm;
    return gid;
  end if;
  if coalesce(t.parent, seed.parent, '') not in ('', 'Primary') and coalesce(t.parent, seed.parent) <> nm then
    pid := fb_mirror_group(p_book, coalesce(t.parent, seed.parent), p_depth + 1);
  end if;
  select g.reserved, g.primary_name, g.nature, g.sch3_code, g.affects_gross_profit into par from fb_groups g where g.id = pid;
  insert into fb_groups as g (book_id, firm_id, parent_id, name, reserved, primary_name, nature, sch3_code, affects_gross_profit, is_system, inactive, mirror_note)
  values (p_book, b.firm_id, pid, nm, coalesce(seed.name, par.reserved, ''), case when pid is null then nm else coalesce(nullif(par.primary_name, ''), nm) end,
          coalesce(seed.nature, par.nature), coalesce(seed.sch3_code, par.sch3_code, ''), coalesce(seed.affects_gross_profit, par.affects_gross_profit, false),
          seed.name is not null, false, case when t.name is null then 'Tally''s reserved group (not in the copy''s group list)' else '' end)
  on conflict (book_id, name) do update set parent_id = excluded.parent_id, reserved = excluded.reserved, primary_name = excluded.primary_name,
    nature = excluded.nature, sch3_code = excluded.sch3_code, affects_gross_profit = excluded.affects_gross_profit, inactive = false,
    mirror_note = excluded.mirror_note, updated_at = now()
  where (g.parent_id, g.reserved, g.primary_name, g.nature, g.sch3_code, g.affects_gross_profit, g.inactive, g.mirror_note)
        is distinct from (excluded.parent_id, excluded.reserved, excluded.primary_name, excluded.nature, excluded.sch3_code, excluded.affects_gross_profit, false, excluded.mirror_note)
  returning g.id into gid;
  if gid is null then select g.id into gid from fb_groups g where g.book_id = p_book and g.name = nm; end if;
  return gid;
end $f$;
create or replace function public.fb_group_id(p_book uuid, p_name text) returns bigint language sql security definer set search_path to 'public', 'pg_temp' as $f$
  select coalesce((select g.id from fb_groups g where g.book_id = p_book and g.name = p_name), fb_mirror_group(p_book, p_name))
$f$;

-- a ledger from the copy (tally_ledgers): its group, GSTIN, PAN, state, TDS type; gone or merged in Tally = inactive
create or replace function public.fb_mirror_ledger(p_book uuid, p_name text) returns bigint language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; t jsonb; gid bigint; grp record; k text; lid bigint; gst text;
begin
  select x.book_id, x.firm_id, x.source_book_id into b from fb_books x where x.book_id = p_book;
  select to_jsonb(l) into t from tally_ledgers l where l.book_id = b.source_book_id and l.name = p_name;
  if t is null then
    -- lines name a ledger the copy has no master for (or it went): kept, said so
    insert into fb_ledgers as x (book_id, firm_id, name, mirror_note) values (p_book, b.firm_id, p_name, 'has entries but is not in Tally''s ledger list in the copy')
    on conflict (book_id, name) do update set mirror_note = excluded.mirror_note, updated_at = now() where x.mirror_note is distinct from excluded.mirror_note
    returning x.id into lid;
    if lid is null then select x.id into lid from fb_ledgers x where x.book_id = p_book and x.name = p_name; end if;
    return lid;
  end if;
  gid := case when coalesce(t ->> 'parent', '') <> '' then fb_group_id(p_book, t ->> 'parent') end;
  select g.reserved, g.nature into grp from fb_groups g where g.id = gid;
  k := case when grp.reserved in ('Sundry Debtors', 'Sundry Creditors') then 'party' when grp.reserved in ('Bank Accounts', 'Bank OD A/c') then 'bank'
            when grp.reserved = 'Cash-in-Hand' then 'cash' when grp.reserved = 'Duties & Taxes' then 'tax' when grp.reserved = 'Stock-in-Hand' then 'stock'
            when grp.nature = 'income' then 'income' when grp.nature = 'expense' then 'expense' when grp.nature = 'equity' then 'capital'
            when grp.nature = 'asset' then 'asset' else 'other' end;
  gst := upper(btrim(coalesce(t ->> 'gstin', '')));
  insert into fb_ledgers as x (book_id, firm_id, group_id, name, kind, gstin, pan, state_code, state_name, tds_deductee_type, inactive, mirror_note)
  values (p_book, b.firm_id, gid, p_name, k, gst, upper(btrim(coalesce(t ->> 'pan', ''))), case when gst ~ '^[0-9]{2}' then left(gst, 2) else '' end,
          coalesce(t ->> 'state', ''), coalesce(t ->> 'tds_deductee_type', ''), (t ->> 'deleted_at') is not null or coalesce(t ->> 'merged_into', '') <> '',
          case when coalesce(t ->> 'merged_into', '') <> '' then 'merged into ' || (t ->> 'merged_into') || ' in Tally' when (t ->> 'deleted_at') is not null then 'deleted in Tally' else '' end)
  on conflict (book_id, name) do update set group_id = excluded.group_id, kind = excluded.kind, gstin = excluded.gstin, pan = excluded.pan,
    state_code = excluded.state_code, state_name = excluded.state_name, tds_deductee_type = excluded.tds_deductee_type, inactive = excluded.inactive,
    mirror_note = excluded.mirror_note, updated_at = now()
  where (x.group_id, x.kind, x.gstin, x.pan, x.state_code, x.state_name, x.tds_deductee_type, x.inactive, x.mirror_note)
        is distinct from (excluded.group_id, excluded.kind, excluded.gstin, excluded.pan, excluded.state_code, excluded.state_name, excluded.tds_deductee_type, excluded.inactive, excluded.mirror_note)
  returning x.id into lid;
  if lid is null then select x.id into lid from fb_ledgers x where x.book_id = p_book and x.name = p_name; end if;
  return lid;
end $f$;
create or replace function public.fb_ledger_id(p_book uuid, p_name text) returns bigint language sql security definer set search_path to 'public', 'pg_temp' as $f$
  select coalesce((select x.id from fb_ledgers x where x.book_id = p_book and x.name = p_name), fb_mirror_ledger(p_book, p_name))
$f$;
create or replace function public.fb_vtype_id(p_book uuid, p_name text) returns bigint language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare vid bigint; base text := fb_vtype_base(p_name);
begin
  select x.id into vid from fb_vtypes x where x.book_id = p_book and x.name = coalesce(p_name, '');
  if vid is null then
    insert into fb_vtypes (book_id, firm_id, base, name, mirror_note)
    values (p_book, (select firm_id from fb_books where book_id = p_book), base, coalesce(p_name, ''),
            case when base = 'unknown' then 'its base type is read with the voucher-type masters (not read yet)' else '' end)
    on conflict (book_id, name) do nothing returning id into vid;
    if vid is null then select x.id into vid from fb_vtypes x where x.book_id = p_book and x.name = coalesce(p_name, ''); end if;
  end if;
  return vid;
end $f$;
-- cost centres as the entries name them (TODO D16: the non-payroll cost-centre masters and categories are read in 2.5.19)
create or replace function public.fb_cc_id(p_book uuid, p_category text, p_centre text) returns bigint language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare f uuid := (select firm_id from fb_books where book_id = p_book); cat bigint; cid bigint; cn text := coalesce(nullif(btrim(p_category), ''), 'Primary Cost Category');
begin
  insert into fb_cost_categories (book_id, firm_id, name) values (p_book, f, cn) on conflict (book_id, name) do nothing;
  select id into cat from fb_cost_categories where book_id = p_book and name = cn;
  select id into cid from fb_cost_centres where book_id = p_book and category_id = cat and name = coalesce(p_centre, '');
  if cid is null then
    insert into fb_cost_centres (book_id, firm_id, category_id, name, mirror_note) values (p_book, f, cat, coalesce(p_centre, ''), 'named by the entries (the cost-centre masters are not read yet)')
    on conflict (book_id, category_id, name) do nothing returning id into cid;
    if cid is null then select id into cid from fb_cost_centres where book_id = p_book and category_id = cat and name = coalesce(p_centre, ''); end if;
  end if;
  return cid;
end $f$;

-- the copy's window for a book: entries that count (not deleted, cancelled or optional), from mirror_from on
create or replace function public.fb_copy_window(p_book uuid) returns table (guid text, day date, vtype text, ledger text, amount numeric)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select l.guid, l.day, v.vtype, l.ledger, -l.amount
    from fb_books b join tally_vouchers v on v.book_id = b.source_book_id join tally_lines l on l.book_id = v.book_id and l.guid = v.guid
   where b.book_id = p_book and v.deleted_at is null and not v.cancelled and not v.optional and v.day >= b.mirror_from
$f$;

-- D20: the openings at mirror_from = Tally's opening plus every older entry of the copy, exactly (a debit positive)
create or replace function public.fb_copy_openings(p_book uuid) returns table (name text, amount numeric, note text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with b as (select x.source_book_id, x.mirror_from, x.books_begin from fb_books x where x.book_id = p_book),
  older as (
    select l.ledger, sum(l.amount) as a from b join tally_vouchers v on v.book_id = b.source_book_id join tally_lines l on l.book_id = v.book_id and l.guid = v.guid
     where v.deleted_at is null and not v.cancelled and not v.optional and v.day < b.mirror_from and (b.books_begin is null or v.day >= b.books_begin)
     group by l.ledger),
  led as (select t.name, t.open from b join tally_ledgers t on t.book_id = b.source_book_id)
  select coalesce(led.name, older.ledger), -(coalesce(led.open, 0) + coalesce(older.a, 0)),
         case when coalesce(older.a, 0) <> 0 then 'Tally''s opening and the entries before ' || to_char((select mirror_from from b), 'DD-Mon-YYYY') else 'Tally''s opening' end
    from led full join older on older.ledger = led.name
$f$;
create or replace function public.fb_mirror_openings(p_book uuid) returns int language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; n int; m int;
begin
  select x.book_id, x.firm_id, x.mirror_from into b from fb_books x where x.book_id = p_book;
  insert into fb_openings as o (book_id, firm_id, as_on, ledger_id, amount, note)
  select p_book, b.firm_id, b.mirror_from, fb_ledger_id(p_book, w.name), w.amount, w.note from fb_copy_openings(p_book) w
   where w.amount <> 0 or exists (select 1 from fb_openings o2 join fb_ledgers g on g.id = o2.ledger_id where o2.book_id = p_book and o2.as_on = b.mirror_from and g.name = w.name)
  on conflict (book_id, as_on, ledger_id) do update set amount = excluded.amount, note = excluded.note
  where (o.amount, o.note) is distinct from (excluded.amount, excluded.note);
  get diagnostics n = row_count;
  -- a ledger that left the copy altogether keeps its row, at nil
  update fb_openings o set amount = 0, note = 'not in the copy any more' from fb_ledgers g
   where o.book_id = p_book and o.as_on = b.mirror_from and g.id = o.ledger_id and o.amount <> 0
     and not exists (select 1 from fb_copy_openings(p_book) w where w.name = g.name);
  get diagnostics m = row_count;
  return n + m;
end $f$;

create or replace function public.fb_mirror_masters(p_book uuid) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; ng int := 0; nl int := 0; x record;
begin
  select k.book_id, k.source_book_id into b from fb_books k where k.book_id = p_book;
  perform fb_seed_book(p_book);
  for x in select g.name from tally_groups g where g.book_id = b.source_book_id order by g.name loop perform fb_mirror_group(p_book, x.name); ng := ng + 1; end loop;
  update fb_groups g set inactive = true, updated_at = now() where g.book_id = p_book and not g.is_system and not g.inactive
     and not exists (select 1 from tally_groups t where t.book_id = b.source_book_id and t.name = g.name);
  for x in select l.name from tally_ledgers l where l.book_id = b.source_book_id order by l.name loop perform fb_mirror_ledger(p_book, x.name); nl := nl + 1; end loop;
  return jsonb_build_object('groups', ng, 'ledgers', nl);
end $f$;

-- one voucher of the copy into FinCom Books. Never changes the source's figures: an entry whose Dr and Cr differ in the
-- copy is kept as 'held' (out of the totals, named by the tie-out); one deleted in Tally is cancelled, never removed.
-- Answers new, changed, same, cancelled, before (older than mirror_from: the openings carry it), skipped
create or replace function public.fb_mirror_voucher(p_book uuid, p_guid text) returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; t jsonb; v record; ls jsonb; bl jsonb; cc jsonb; gstj jsonb; h text; st text; v_memo boolean; note text := ''; s numeric; nz int;
  ver int; vid uuid; dt date; src text; word text; e record; ln int; grp record; gsum numeric; taken int[] := '{}'; pn int := 0;
begin
  select k.book_id, k.firm_id, k.source, k.source_book_id, k.mirror_on, k.mirror_from into b from fb_books k where k.book_id = p_book;
  if b.book_id is null or not b.mirror_on or b.source = 'own' then return 'skipped'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || p_book::text, 0));
  src := b.source; word := case when src = 'zoho' then 'Zoho' else 'Tally' end;
  select to_jsonb(x) into t from tally_vouchers x where x.book_id = b.source_book_id and x.guid = p_guid;
  select x.id, x.version, x.status, x.content_hash, x.source_alter, x.source_gone into v from fb_vouchers x where x.book_id = p_book and x.source_ref = p_guid;
  if t is null or (t ->> 'deleted_at') is not null then
    if v.id is not null and not v.source_gone then
      update fb_vouchers set status = 'cancelled', source_gone = true, cancelled_at = now(), cancel_reason = 'deleted in ' || word where id = v.id;
      return 'cancelled';
    end if;
    return case when v.id is null then 'before' else 'same' end;
  end if;
  dt := (t ->> 'day')::date;
  if dt < b.mirror_from then return 'before'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('l', l.ledger, 'a', -l.amount, 'h', coalesce(l.hsn, ''), 'r', l.rate) order by l.ledger, -l.amount, coalesce(l.hsn, ''), l.rate), '[]'::jsonb),
         count(*) filter (where l.amount <> 0), coalesce(sum(-l.amount), 0)
    into ls, nz, s from tally_lines l where l.book_id = b.source_book_id and l.guid = p_guid;
  select coalesce(jsonb_agg(jsonb_build_object('l', x.ledger, 'n', x.name, 't', x.type, 'a', -x.amount, 'd', x.bill_date, 'c', x.credit_days, 'u', x.due)
                  order by x.ledger, x.name, x.type, x.amount), '[]'::jsonb)
    into bl from tally_bills x where x.book_id = b.source_book_id and x.guid = p_guid;
  select coalesce(jsonb_agg(jsonb_build_object('l', x.ledger, 'n', x.line_no, 'k', x.category, 'c', x.centre, 'a', -x.amount) order by x.line_no, x.ledger, x.category, x.centre, x.amount), '[]'::jsonb)
    into cc from tally_cost_allocs x where x.book_id = b.source_book_id and x.guid = p_guid and x.gone_at is null;
  gstj := jsonb_strip_nulls(jsonb_build_object('gstin', nullif(t ->> 'gstin', ''), 'pos', nullif(t ->> 'pos', ''), 'cmp_gstin', nullif(t ->> 'cmp_gstin', '')));
  h := md5(jsonb_build_object('t', t ->> 'vtype', 'n', t ->> 'vno', 'd', dt, 'p', t ->> 'party', 'x', t ->> 'narration', 'c', t -> 'cancelled', 'o', t -> 'optional',
                              'r', t ->> 'ref', 'rd', t ->> 'ref_date', 'g', gstj, 'i', t ->> 'irn', 'ia', t ->> 'irn_ack_no', 'id', t ->> 'irn_ack_date', 'e', t ->> 'eway_no',
                              'l', ls, 'b', bl, 'cc', cc)::text);
  if v.id is not null and v.content_hash = h and not v.source_gone then
    if v.source_alter is distinct from (t ->> 'alter_id')::bigint then update fb_vouchers set source_alter = (t ->> 'alter_id')::bigint where id = v.id; end if;
    return 'same';
  end if;
  v_memo := coalesce((t ->> 'optional')::boolean, false);
  st := case when coalesce((t ->> 'cancelled')::boolean, false) then 'cancelled' else 'posted' end;
  if v_memo then note := 'optional in ' || word || ' (shown, kept out of the totals, as ' || word || ' does)'; end if;
  if st = 'posted' then
    if s <> 0 then st := 'held'; note := 'Dr and Cr differ by ' || fb_inr(abs(s)) || ' in the copy (kept out of the totals)';
    elsif nz < 2 and not v_memo then v_memo := true; note := 'no accounting lines in the copy (a non-accounting entry)';
    end if;
  end if;
  if v.id is null then
    ver := 1;
    insert into fb_vouchers (book_id, firm_id, fy, vtype_id, number, date, party_ledger_id, ref_no, ref_date, narration, status, memo, version, gst,
                             irn, irn_ack_no, irn_ack_at, eway_no, source, source_ref, source_alter, mirror_note, content_hash, posted_at, cancelled_at, cancel_reason)
    values (p_book, b.firm_id, fb_fy(dt), fb_vtype_id(p_book, t ->> 'vtype'), coalesce(t ->> 'vno', ''), dt,
            case when coalesce(t ->> 'party', '') <> '' then fb_ledger_id(p_book, t ->> 'party') end, coalesce(t ->> 'ref', ''), (t ->> 'ref_date')::date,
            coalesce(t ->> 'narration', ''), st, v_memo, 1, gstj, coalesce(t ->> 'irn', ''), coalesce(t ->> 'irn_ack_no', ''), (t ->> 'irn_ack_date')::date,
            coalesce(t ->> 'eway_no', ''), src, p_guid, (t ->> 'alter_id')::bigint, note, h, case when st = 'posted' then now() end,
            case when st = 'cancelled' then now() end, case when st = 'cancelled' then 'cancelled in ' || word else '' end)
    returning id into vid;
  else
    vid := v.id; ver := v.version + 1;
    update fb_vouchers set version = ver, fy = fb_fy(dt), vtype_id = fb_vtype_id(p_book, t ->> 'vtype'), number = coalesce(t ->> 'vno', ''), date = dt,
      party_ledger_id = case when coalesce(t ->> 'party', '') <> '' then fb_ledger_id(p_book, t ->> 'party') end, ref_no = coalesce(t ->> 'ref', ''),
      ref_date = (t ->> 'ref_date')::date, narration = coalesce(t ->> 'narration', ''), status = st, memo = v_memo, gst = gstj, irn = coalesce(t ->> 'irn', ''),
      irn_ack_no = coalesce(t ->> 'irn_ack_no', ''), irn_ack_at = (t ->> 'irn_ack_date')::date, eway_no = coalesce(t ->> 'eway_no', ''), source_gone = false,
      source_alter = (t ->> 'alter_id')::bigint, mirror_note = note, content_hash = h,
      posted_at = case when st = 'posted' then coalesce(posted_at, now()) else posted_at end,
      cancelled_at = case when st = 'cancelled' then coalesce(cancelled_at, now()) end, cancel_reason = case when st = 'cancelled' then 'cancelled in ' || word else '' end,
      edit_reason = case when v.source_gone then 'back in ' || word else 'changed in ' || word || ' (AlterID ' || coalesce(v.source_alter::text, '?') || ' to ' || coalesce(t ->> 'alter_id', '?') || ')' end
     where id = vid;
  end if;
  insert into fb_lines (voucher_id, version, line_no, book_id, firm_id, date, ledger_id, amount, hsn_sac, tax_rate)
  select vid, ver, x.n::int, p_book, b.firm_id, dt, fb_ledger_id(p_book, x.j ->> 'l'), (x.j ->> 'a')::numeric, coalesce(x.j ->> 'h', ''), (x.j ->> 'r')::numeric
    from jsonb_array_elements(ls) with ordinality x(j, n);
  -- bill-wise references name the line's ledger only (the copy keeps no line number for bills): the ledger's line whose
  -- amount is what its references add up to, else its first line
  for grp in select x.j ->> 'l' as led, sum((x.j ->> 'a')::numeric) as s from jsonb_array_elements(bl) x(j) group by 1 order by 1 loop
    select l.line_no into ln from fb_lines l join fb_ledgers g on g.id = l.ledger_id where l.voucher_id = vid and l.version = ver and g.name = grp.led
     order by (l.amount = grp.s) desc, l.line_no limit 1;
    if ln is null then continue; end if;
    for e in select x.j, x.n from jsonb_array_elements(bl) with ordinality x(j, n) where x.j ->> 'l' = grp.led order by x.n loop
      insert into fb_bill_refs (voucher_id, version, line_no, part_no, book_id, firm_id, party_ledger_id, ref_type, ref_name, amount, bill_date, due_date, credit_days)
      values (vid, ver, ln, e.n::int, p_book, b.firm_id, fb_ledger_id(p_book, e.j ->> 'l'),
              case lower(coalesce(e.j ->> 't', '')) when 'agst ref' then 'against' when 'advance' then 'advance' when 'on account' then 'on_account' else 'new' end,
              coalesce(e.j ->> 'n', ''), (e.j ->> 'a')::numeric, (e.j ->> 'd')::date, (e.j ->> 'u')::date, (e.j ->> 'c')::int);
    end loop;
  end loop;
  -- cost centres: the copy's line number (tally_cost_allocs.line_no) keeps one line's parts together; they land on the line
  -- of that ledger whose amount is what one category of them adds up to (not yet taken), else the ledger's first line
  for grp in select x.j ->> 'l' as led, x.j ->> 'n' as lno, min(x.j ->> 'k') as k1 from jsonb_array_elements(cc) x(j) group by 1, 2 order by (x.j ->> 'n')::int nulls last, 1 loop
    select sum((y ->> 'a')::numeric) into gsum from jsonb_array_elements(cc) y where y ->> 'l' = grp.led and y ->> 'n' is not distinct from grp.lno and y ->> 'k' = grp.k1;
    ln := null;
    select l.line_no into ln from fb_lines l join fb_ledgers g on g.id = l.ledger_id where l.voucher_id = vid and l.version = ver and g.name = grp.led and not (l.line_no = any (taken))
     order by (l.amount = gsum) desc, l.line_no limit 1;
    if ln is null then
      select l.line_no into ln from fb_lines l join fb_ledgers g on g.id = l.ledger_id where l.voucher_id = vid and l.version = ver and g.name = grp.led order by l.line_no limit 1;
    end if;
    if ln is null then continue; end if;
    taken := taken || ln;
    for e in select y as j from jsonb_array_elements(cc) y where y ->> 'l' = grp.led and y ->> 'n' is not distinct from grp.lno order by y ->> 'k', y ->> 'c', (y ->> 'a')::numeric loop
      pn := pn + 1;
      insert into fb_line_cc (voucher_id, version, line_no, part_no, book_id, firm_id, cost_centre_id, amount)
      values (vid, ver, ln, pn, p_book, b.firm_id, fb_cc_id(p_book, e.j ->> 'k', e.j ->> 'c'), (e.j ->> 'a')::numeric);
    end loop;
  end loop;
  return case when v.id is null then 'new' else 'changed' end;
end $f$;

-- the landing tables' statement triggers: note what changed, for the enrolled books only. They never raise, and never
-- wait more than 200 ms for a lock (a re-run of this migration, the catch-up deleting the same note, or anything else
-- holding fb_books or fb_mirror_dirty makes this a 'missed' row, naming the copy's books, for the catch-up's sweep;
-- if even that row cannot be written, a tick of fb_missed_seq). An update that changes nothing notes nothing. The
-- caller's lock_timeout is put back as it was
create or replace function public.fb_land_guid_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare lt text := current_setting('lock_timeout'); any_on boolean; srcs text;
begin
  begin
    perform set_config('lock_timeout', '200ms', true);
    select exists (select 1 from fb_books where mirror_on) into any_on;
    if any_on then
      if tg_op = 'INSERT' then
        with n as (insert into fb_mirror_dirty as d (book_id, kind, key) select distinct b.book_id, 'v', x.guid from nt x join fb_books b on b.source_book_id = x.book_id and b.mirror_on
          on conflict (book_id, kind, key) do update set seq = excluded.seq returning d.book_id, d.kind, d.key)
        -- noted again (put right in the source?): an entry waiting for its retry time is tried at the next run
        update fb_mirror_errors e set retry_at = null from n where e.resolved_at is null and e.retry_at is not null and e.kind = 'catchup' and e.book_id = n.book_id and e.key = n.kind || ':' || n.key;
      elsif tg_op = 'DELETE' then
        with n as (insert into fb_mirror_dirty as d (book_id, kind, key) select distinct b.book_id, 'v', x.guid from ot x join fb_books b on b.source_book_id = x.book_id and b.mirror_on
          on conflict (book_id, kind, key) do update set seq = excluded.seq returning d.book_id, d.kind, d.key)
        -- noted again (put right in the source?): an entry waiting for its retry time is tried at the next run
        update fb_mirror_errors e set retry_at = null from n where e.resolved_at is null and e.retry_at is not null and e.kind = 'catchup' and e.book_id = n.book_id and e.key = n.kind || ':' || n.key;
      else
        -- only the entries whose rows really changed (the rows of each entry compared as a whole, before and after)
        with n as (insert into fb_mirror_dirty as d (book_id, kind, key) select distinct b.book_id, 'v', x.guid
          from (select coalesce(n.book_id, o.book_id) as book_id, coalesce(n.guid, o.guid) as guid
                  from (select z.book_id, z.guid, md5(string_agg(z::text, '|' order by z::text)) as h from nt z group by 1, 2) n
                  full join (select z.book_id, z.guid, md5(string_agg(z::text, '|' order by z::text)) as h from ot z group by 1, 2) o on o.book_id = n.book_id and o.guid = n.guid
                 where n.h is distinct from o.h) x
          join fb_books b on b.source_book_id = x.book_id and b.mirror_on
          on conflict (book_id, kind, key) do update set seq = excluded.seq returning d.book_id, d.kind, d.key)
        -- noted again (put right in the source?): an entry waiting for its retry time is tried at the next run
        update fb_mirror_errors e set retry_at = null from n where e.resolved_at is null and e.retry_at is not null and e.kind = 'catchup' and e.book_id = n.book_id and e.key = n.kind || ':' || n.key;
      end if;
    end if;
    perform set_config('lock_timeout', lt, true);
  exception when others then
    begin
      perform set_config('lock_timeout', '200ms', true);
      -- the copy's books the statement touched (more than 5: '' = every enrolled book is swept)
      if tg_op = 'DELETE' then select case when count(distinct x.book_id) > 5 then '' else string_agg(distinct x.book_id::text, ',') end into srcs from ot x;
      else select case when count(distinct x.book_id) > 5 then '' else string_agg(distinct x.book_id::text, ',') end into srcs from nt x; end if;
      insert into fb_mirror_errors (kind, key, error) values ('missed', coalesce(srcs, ''), left(tg_table_name || ': ' || sqlerrm, 500));
      perform set_config('lock_timeout', lt, true);
    exception when others then
      begin perform nextval('public.fb_missed_seq'); exception when others then null; end;
    end;
  end;
  return null;
end $f$;
create or replace function public.fb_land_name_trg() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare k text := tg_argv[0]; lt text := current_setting('lock_timeout'); any_on boolean; srcs text;
begin
  begin
    perform set_config('lock_timeout', '200ms', true);
    select exists (select 1 from fb_books where mirror_on) into any_on;
    if any_on then
      if tg_op = 'INSERT' then
        with n as (insert into fb_mirror_dirty as d (book_id, kind, key) select distinct b.book_id, k, x.name from nt x join fb_books b on b.source_book_id = x.book_id and b.mirror_on
          on conflict (book_id, kind, key) do update set seq = excluded.seq returning d.book_id, d.kind, d.key)
        -- noted again (put right in the source?): an entry waiting for its retry time is tried at the next run
        update fb_mirror_errors e set retry_at = null from n where e.resolved_at is null and e.retry_at is not null and e.kind = 'catchup' and e.book_id = n.book_id and e.key = n.kind || ':' || n.key;
      elsif tg_op = 'DELETE' then
        with n as (insert into fb_mirror_dirty as d (book_id, kind, key) select distinct b.book_id, k, x.name from ot x join fb_books b on b.source_book_id = x.book_id and b.mirror_on
          on conflict (book_id, kind, key) do update set seq = excluded.seq returning d.book_id, d.kind, d.key)
        -- noted again (put right in the source?): an entry waiting for its retry time is tried at the next run
        update fb_mirror_errors e set retry_at = null from n where e.resolved_at is null and e.retry_at is not null and e.kind = 'catchup' and e.book_id = n.book_id and e.key = n.kind || ':' || n.key;
      else
        with n as (insert into fb_mirror_dirty as d (book_id, kind, key) select distinct b.book_id, k, x.name
          from (select coalesce(n.book_id, o.book_id) as book_id, coalesce(n.name, o.name) as name
                  from (select z.book_id, z.name, md5(z::text) as h from nt z) n
                  full join (select z.book_id, z.name, md5(z::text) as h from ot z) o on o.book_id = n.book_id and o.name = n.name
                 where n.h is distinct from o.h) x
          join fb_books b on b.source_book_id = x.book_id and b.mirror_on
          on conflict (book_id, kind, key) do update set seq = excluded.seq returning d.book_id, d.kind, d.key)
        -- noted again (put right in the source?): an entry waiting for its retry time is tried at the next run
        update fb_mirror_errors e set retry_at = null from n where e.resolved_at is null and e.retry_at is not null and e.kind = 'catchup' and e.book_id = n.book_id and e.key = n.kind || ':' || n.key;
      end if;
    end if;
    perform set_config('lock_timeout', lt, true);
  exception when others then
    begin
      perform set_config('lock_timeout', '200ms', true);
      -- the copy's books the statement touched (more than 5: '' = every enrolled book is swept)
      if tg_op = 'DELETE' then select case when count(distinct x.book_id) > 5 then '' else string_agg(distinct x.book_id::text, ',') end into srcs from ot x;
      else select case when count(distinct x.book_id) > 5 then '' else string_agg(distinct x.book_id::text, ',') end into srcs from nt x; end if;
      insert into fb_mirror_errors (kind, key, error) values ('missed', coalesce(srcs, ''), left(tg_table_name || ': ' || sqlerrm, 500));
      perform set_config('lock_timeout', lt, true);
    exception when others then
      begin perform nextval('public.fb_missed_seq'); exception when others then null; end;
    end;
  end;
  return null;
end $f$;

-- before each catch-up run: a 'missed' row that names no FinCom book becomes one for the books of the copy's books it
-- names (only when it names none, for every enrolled book); fb_missed_seq moved since a book last looked = a 'missed'
-- row for that book
create or replace function public.fb_mirror_triage() returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare n1 int; n2 int := 0; sv bigint;
begin
  insert into fb_mirror_state (book_id, missed_seen) select b.book_id, (select case when q.is_called then q.last_value else 0 end from fb_missed_seq q) from fb_books b where b.mirror_on on conflict do nothing;
  insert into fb_mirror_errors (book_id, kind, key, error)
  select b.book_id, 'missed', '', e.error from fb_mirror_errors e join fb_books b on b.mirror_on and (e.key = '' or b.source_book_id::text = any (string_to_array(e.key, ',')))
   where e.book_id is null and e.kind = 'missed' and e.resolved_at is null;
  update fb_mirror_errors set resolved_at = now() where book_id is null and kind = 'missed' and resolved_at is null;
  get diagnostics n1 = row_count;
  select case when is_called then last_value else 0 end into sv from fb_missed_seq;
  if sv > 0 then
    insert into fb_mirror_errors (book_id, kind, key, error)
    select st.book_id, 'missed', 'seq', 'a change could not be noted (fb_missed_seq moved)' from fb_mirror_state st join fb_books b on b.book_id = st.book_id and b.mirror_on where st.missed_seen < sv;
    get diagnostics n2 = row_count;
    update fb_mirror_state st set missed_seen = sv where st.missed_seen < sv;
  end if;
  return jsonb_build_object('missed', n1, 'seq', n2);
end $f$;

-- one note or entry into FinCom Books
create or replace function public.fb_mirror_one(p_book uuid, p_kind text, p_key text) returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if p_kind = 'g' then perform fb_mirror_group(p_book, p_key); return 'group';
  elsif p_kind = 'l' then perform fb_mirror_ledger(p_book, p_key); return 'ledger';
  else return fb_mirror_voucher(p_book, p_key); end if;
end $f$;
-- a chunk of them in ONE subtransaction (not one per entry: no subtransaction overflow). If one fails, the chunk is
-- split in halves and each half retried the same way, so only the failing entry ends up on its own; it answers
-- 'failed: <error>'
create or replace function public.fb_mirror_list(p_book uuid, p_kinds text[], p_keys text[]) returns text[] language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare out text[] := '{}'; i int; m int := coalesce(array_length(p_keys, 1), 0); h int;
begin
  if m = 0 then return out; end if;
  begin
    for i in 1 .. m loop out := out || fb_mirror_one(p_book, p_kinds[i], p_keys[i]); end loop;
    return out;
  exception when others then
    if m = 1 then return array['failed: ' || left(sqlerrm, 450)]; end if;
    h := m / 2;
    return fb_mirror_list(p_book, p_kinds[1:h], p_keys[1:h]) || fb_mirror_list(p_book, p_kinds[h + 1:m], p_keys[h + 1:m]);
  end;
end $f$;

-- an entry the catch-up could not mirror: logged once (tries counted), kept noted so that it counts as behind, and left
-- alone until its retry time (3 minutes, then doubling, at most an hour), so one bad entry never holds up a run
create or replace function public.fb_mirror_failed(p_book uuid, p_kind text, p_key text, p_err text) returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  insert into fb_mirror_dirty (book_id, kind, key) values (p_book, p_kind, p_key) on conflict do nothing;
  update fb_mirror_errors e set tries = e.tries + 1, error = left(p_err, 500), retry_at = now() + least(interval '3 minutes' * power(2, least(e.tries, 5)), interval '1 hour')
   where e.book_id = p_book and e.kind = 'catchup' and e.key = p_kind || ':' || p_key and e.resolved_at is null;
  if not found then
    insert into fb_mirror_errors (book_id, kind, key, error, retry_at) values (p_book, 'catchup', p_kind || ':' || p_key, left(p_err, 500), now() + interval '3 minutes');
  end if;
end $f$;

-- a catch-up run that failed as a whole for a book: one open row per book, counted (not a new row every 3 minutes)
create or replace function public.fb_mirror_run_failed(p_book uuid, p_err text) returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  update fb_mirror_errors e set tries = e.tries + 1, error = left(p_err, 500) where e.book_id = p_book and e.kind = 'catchup' and e.key = 'run' and e.resolved_at is null;
  if not found then insert into fb_mirror_errors (book_id, kind, key, error) values (p_book, 'catchup', 'run', left(p_err, 500)); end if;
end $f$;

-- since when a book is behind the copy: its oldest note, or its oldest open 'missed' row (null = up to date)
create or replace function public.fb_behind_since(p_book uuid) returns timestamptz language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select nullif(least(coalesce((select min(d.first_at) from fb_mirror_dirty d where d.book_id = p_book), 'infinity'),
                      coalesce((select min(e.at) from fb_mirror_errors e where e.book_id = p_book and e.kind = 'missed' and e.resolved_at is null), 'infinity')), 'infinity')
$f$;

-- one book, under its mirror lock (taken first): 1. the noted entries and masters, oldest first; 2. new or changed by
-- AlterID, or gone from the copy (a cross-check that also builds a new book); 3. the sweep, when a change may have been
-- missed: every entry of the window compared by its content hash, in chunks, from fb_mirror_state.sweep_after. A sweep
-- covers exactly the 'missed' rows open when it starts (sweep_covers); a later one starts the next sweep, so a change
-- missed behind the sweep's position is never lost. p_max entries a call
create or replace function public.fb_mirror_catchup(p_book uuid, p_max int default 2000) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; st record; g record; n int := 0; res text; cnt jsonb := '{}'::jsonb; left_n int; act text := coalesce(current_setting('fincom.fb_actor', true), '');
  lim int := greatest(1, least(p_max, 20000)); od boolean := false; last_g text; got int := 0; avail int; swept boolean; failed int := 0;
  dk text[] := '{}'; dkey text[] := '{}'; dseq bigint[] := '{}'; covers bigint[]; nk text[]; nkey text[]; nseq bigint[]; rs text[]; gl text[]; i int; okn int := 0;
begin
  select k.book_id, k.source_book_id, k.mirror_from, k.mirror_on, k.state into b from fb_books k where k.book_id = p_book;
  if b.book_id is null or not b.mirror_on then return jsonb_build_object('skipped', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || p_book::text, 0));
  perform set_config('fincom.fb_actor', 'system:mirror', true);
  insert into fb_mirror_state (book_id, missed_seen) values (p_book, (select case when q.is_called then q.last_value else 0 end from fb_missed_seq q)) on conflict do nothing;
  select * into st from fb_mirror_state s where s.book_id = p_book;
  -- 1. the notes, one chunk in one subtransaction
  select array_agg(z.kind order by z.o), array_agg(z.key order by z.o), array_agg(z.seq order by z.o) into nk, nkey, nseq
    from (select d.kind, d.key, d.seq, row_number() over (order by d.kind <> 'g', d.kind <> 'l', d.first_at, d.key) as o
            from fb_mirror_dirty d where d.book_id = p_book
             and not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = d.kind || ':' || d.key and e.resolved_at is null and e.retry_at > now())
           order by 4 limit lim) z;
  if nkey is not null then
    rs := fb_mirror_list(p_book, nk, nkey);
    for i in 1 .. array_length(nkey, 1) loop
      if rs[i] like 'failed: %' then
        failed := failed + 1; perform fb_mirror_failed(p_book, nk[i], nkey[i], substr(rs[i], 9));
      else
        okn := okn + 1;
        if nk[i] = 'v' then
          n := n + 1; cnt := jsonb_set(cnt, array[rs[i]], to_jsonb(coalesce((cnt ->> rs[i])::int, 0) + 1));
          if rs[i] = 'before' then od := true; end if;
        elsif nk[i] = 'l' then od := true;
        end if;
        dk := dk || nk[i]; dkey := dkey || nkey[i]; dseq := dseq || nseq[i];
      end if;
    end loop;
  end if;
  if od then perform fb_mirror_openings(p_book); end if;
  -- the notes mirrored are removed at once (only if not noted again since they were read: seq), before the scans below,
  -- so a copy write on the same entry seldom meets this row lock (and waits 200 ms at most if it does)
  delete from fb_mirror_dirty d using unnest(dk, dkey, dseq) u(kind, key, seq) where d.book_id = p_book and d.kind = u.kind and d.key = u.key and d.seq = u.seq;
  -- 2. by AlterID, and gone from the copy
  if n < lim then
    select array_agg(z.guid) into gl from (
      select v.guid from tally_vouchers v left join fb_vouchers f on f.book_id = p_book and f.source_ref = v.guid
       where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.deleted_at is null and (f.id is null or f.source_alter is distinct from v.alter_id or f.source_gone)
         and not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = 'v:' || v.guid and e.resolved_at is null and e.retry_at > now())
      union all
      select f.source_ref from fb_vouchers f left join tally_vouchers v on v.book_id = b.source_book_id and v.guid = f.source_ref
       where f.book_id = p_book and f.source_ref is not null and not f.source_gone and (v.guid is null or v.deleted_at is not null)
         and not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = 'v:' || f.source_ref and e.resolved_at is null and e.retry_at > now())
      limit lim - n) z;
    if gl is not null then
      rs := fb_mirror_list(p_book, array_fill('v'::text, array[array_length(gl, 1)]), gl);
      for i in 1 .. array_length(gl, 1) loop
        n := n + 1;
        if rs[i] like 'failed: %' then failed := failed + 1; perform fb_mirror_failed(p_book, 'v', gl[i], substr(rs[i], 9));
        else okn := okn + 1; cnt := jsonb_set(cnt, array[rs[i]], to_jsonb(coalesce((cnt ->> rs[i])::int, 0) + 1)); end if;
      end loop;
    end if;
  end if;
  -- 3. the sweep
  if st.sweep_after is null then
    select array_agg(e.id order by e.id) into covers from fb_mirror_errors e where e.book_id = p_book and e.kind = 'missed' and e.resolved_at is null;
    if covers is not null then
      -- a change may have been missed: the masters are compared too (once per sweep, not every run)
      perform fb_mirror_masters(p_book); perform fb_mirror_openings(p_book);
      update fb_mirror_state set sweep_after = '', sweep_covers = covers, sweep_started = now() where book_id = p_book;
      st.sweep_after := ''; st.sweep_covers := covers;
    end if;
  end if;
  swept := st.sweep_after is null;
  if not swept and n < lim then
    avail := lim - n;
    select array_agg(z.guid order by z.guid) into gl from (select v.guid from tally_vouchers v where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.guid > st.sweep_after order by v.guid limit avail) z;
    got := coalesce(array_length(gl, 1), 0);
    if got > 0 then
      last_g := gl[got];
      -- (an entry waiting for its retry time is passed over here; it stays noted and is tried at that time)
      gl := array(select x from unnest(gl) x where not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = 'v:' || x and e.resolved_at is null and e.retry_at > now()) order by x);
      if coalesce(array_length(gl, 1), 0) > 0 then
        rs := fb_mirror_list(p_book, array_fill('v'::text, array[array_length(gl, 1)]), gl);
        for i in 1 .. array_length(gl, 1) loop
          n := n + 1;
          if rs[i] like 'failed: %' then failed := failed + 1; perform fb_mirror_failed(p_book, 'v', gl[i], substr(rs[i], 9));
          else okn := okn + 1; cnt := jsonb_set(cnt, array['swept_' || rs[i]], to_jsonb(coalesce((cnt ->> ('swept_' || rs[i]))::int, 0) + 1)); end if;
        end loop;
      end if;
    end if;
    swept := got < avail;
    if swept then
      update fb_mirror_errors set resolved_at = now() where id = any (st.sweep_covers) and resolved_at is null;
      update fb_mirror_state set sweep_after = null, sweep_covers = null, sweep_started = null where book_id = p_book;
      perform fb_mirror_openings(p_book);
    else
      update fb_mirror_state set sweep_after = last_g where book_id = p_book;
    end if;
  end if;
  update fb_mirror_errors e set resolved_at = now() where e.book_id = p_book and e.kind = 'catchup' and e.key <> 'run' and e.resolved_at is null
     and not exists (select 1 from fb_mirror_dirty d where d.book_id = p_book and d.kind || ':' || d.key = e.key);
  select count(*) into left_n from tally_vouchers v left join fb_vouchers f on f.book_id = p_book and f.source_ref = v.guid
   where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.deleted_at is null and (f.id is null or f.source_alter is distinct from v.alter_id);
  left_n := left_n + (select count(*) from fb_mirror_dirty d where d.book_id = p_book);
  if left_n = 0 and swept then
    update fb_mirror_errors set resolved_at = now() where book_id = p_book and resolved_at is null and kind in ('catchup', 'tieout');
    if b.state = 'setting_up' then update fb_books set state = 'live' where book_id = p_book; end if;
  end if;
  if failed = 0 then update fb_mirror_state set mirrored_at = now() where book_id = p_book; end if;
  perform set_config('fincom.fb_actor', act, true);
  -- done: entries actually mirrored (a failed one is not progress)
  return jsonb_build_object('done', okn, 'tried', n, 'left', left_n, 'failed', failed, 'by', cnt, 'sweep', case when st.sweep_after is not null then (case when swept then 'done' else 'going' end) end);
end $f$;
-- (service role, tests) every enrolled book in ONE transaction, in book_id order; the timer uses fb_mirror_catchup_run
create or replace function public.fb_mirror_catchup_all(p_max int default 5000) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; out jsonb := '[]'::jsonb; budget int := p_max; r jsonb;
begin
  perform fb_mirror_triage();
  for b in select k.book_id from fb_books k where k.mirror_on order by k.book_id loop
    exit when budget <= 0;
    begin
      r := fb_mirror_catchup(b.book_id, budget);
      budget := budget - coalesce((r ->> 'done')::int, 0);
      out := out || jsonb_build_object('book', b.book_id, 'r', r);
    exception when others then
      perform fb_mirror_run_failed(b.book_id, sqlerrm);
    end;
  end loop;
  return out;
end $f$;
-- the timer's runner (every 3 minutes): one short transaction per book and chunk (COMMIT after each), round-robin across
-- the books, so a run holds one book's locks at a time, a note is deleted moments after it is read, and one book (or one
-- bad entry) never takes the whole run. A procedure (CALL) for the timer
-- only: not SECURITY DEFINER and with no SET clause, as COMMIT needs; names are qualified
create or replace procedure public.fb_mirror_catchup_run(p_max int default 5000) language plpgsql as $p$
declare act uuid[]; nxt uuid[]; id uuid; budget int := p_max; r jsonb; d int; share int;
begin
  perform public.fb_mirror_triage();
  commit;
  -- books being built first; the rest in an order that turns by one book a minute, so no book is always last
  select array_agg(z.book_id order by z.su desc, (z.rn + floor(extract(epoch from clock_timestamp()) / 60)::bigint) % z.cnt) into act
    from (select k.book_id, k.state = 'setting_up' as su, row_number() over (order by k.book_id) as rn, count(*) over () as cnt from public.fb_books k where k.mirror_on) z;
  -- round-robin: each pass gives every book still busy an equal share of what is left of the run (50 to 500 entries);
  -- a book drops out when a chunk mirrors nothing or it is up to date; every call costs at least 1, so a run always ends
  while budget > 0 and coalesce(array_length(act, 1), 0) > 0 loop
    share := greatest(50, least(500, budget / array_length(act, 1)));
    nxt := '{}';
    foreach id in array act loop
      exit when budget <= 0;
      begin
        r := public.fb_mirror_catchup(id, share);
        d := coalesce((r ->> 'done')::int, 0);
      exception when others then
        perform public.fb_mirror_run_failed(id, sqlerrm);
        r := null; d := 0;
      end;
      commit;
      budget := budget - greatest(d, 1);
      if d > 0 and not (coalesce((r ->> 'left')::int, 0) = 0 and coalesce(r ->> 'sweep', 'done') = 'done') then nxt := nxt || id; end if;
    end loop;
    act := nxt;
  end loop;
end $p$;

-- the firm's owner or staff (can_write(); owner decision 23-Nov-2026) set up FinCom Books for a client: one book per company of the copy, mirrored from today (D20: the current
-- and previous financial year voucher by voucher, older entries carried in the openings). Small books are built at once;
-- the rest by the catch-up every 3 minutes
create or replace function public.fb_enroll(p_client text) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare f uuid := my_firm(); t record; bk uuid; out jsonb := '[]'::jsonb; mf date; r jsonb; src text; act text := coalesce(current_setting('fincom.fb_actor', true), '');
begin
  if f is null or not can_write() then raise exception 'You can look at this client but cannot set up FinCom Books (the firm''s owner or staff can).' using errcode = '42501'; end if;
  perform set_config('fincom.fb_actor', 'system:mirror', true);
  for t in select x.book_id, x.client_id, x.company, x.from_date, to_jsonb(x) ->> 'source' as source from tally_books x where x.firm_id = f and x.client_id = p_client order by x.from_date nulls last loop
    src := case when t.source = 'zoho' then 'zoho' else 'tally' end;
    select k.book_id into bk from fb_books k where k.source_book_id = t.book_id;
    if bk is null then
      bk := gen_random_uuid();
      perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || bk::text, 0));   -- the mirror lock first, as everywhere
      mf := greatest(coalesce(t.from_date, date '1900-04-01'), fb_fy_start(current_date) - interval '1 year')::date;
      insert into fb_books (book_id, firm_id, client_id, source, source_book_id, company, mirror_on, mirror_from, books_begin, state, created_by)
      values (bk, f, t.client_id, src, t.book_id, coalesce(t.company, ''), true, mf, t.from_date, 'setting_up', auth.uid());
      insert into client_books_mode (firm_id, client_id, source, effective_from, book_id, set_by)
      values (f, t.client_id, src, mf, bk, auth.uid()) on conflict (firm_id, client_id, effective_from) do nothing;
    else
      perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || bk::text, 0));
      update fb_books set mirror_on = true where book_id = bk and not mirror_on;
    end if;
    insert into fb_mirror_state (book_id, missed_seen) values (bk, (select case when q.is_called then q.last_value else 0 end from fb_missed_seq q)) on conflict do nothing;
    perform fb_mirror_masters(bk);
    perform fb_mirror_openings(bk);
    r := fb_mirror_catchup(bk, 2000);
    out := out || jsonb_build_object('book', bk, 'company', t.company, 'built', r);
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'This client has no books in FinCom''s cloud copy yet.' using errcode = '22023'; end if;
  perform set_config('fincom.fb_actor', act, true);
  return jsonb_build_object('books', out);
end $f$;

-- ---------------------------------------------------------------- the tie-out
-- a ledger's balance in FinCom Books at a date (a debit positive): the openings and every posted entry, never a memo,
-- held, sent or cancelled one
create or replace function public.fb_closing(p_book uuid, p_on date) returns table (ledger_id bigint, open numeric, dr numeric, cr numeric, bal numeric)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with b as (select k.mirror_from from fb_books k where k.book_id = p_book),
  o as (select x.ledger_id, x.amount from fb_openings x, b where x.book_id = p_book and x.as_on = b.mirror_from),
  m as (select l.ledger_id, sum(l.amount) filter (where l.amount > 0) as dr, -sum(l.amount) filter (where l.amount < 0) as cr
          from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version, b
         where l.book_id = p_book and v.status = 'posted' and not v.memo and l.date >= b.mirror_from and l.date <= p_on group by l.ledger_id)
  select coalesce(o.ledger_id, m.ledger_id), coalesce(o.amount, 0), coalesce(m.dr, 0), coalesce(m.cr, 0), coalesce(o.amount, 0) + coalesce(m.dr, 0) - coalesce(m.cr, 0)
    from o full join m on m.ledger_id = o.ledger_id
$f$;

create or replace function public.fb_tieout(p_book uuid, p_kind text default 'nightly', p_by uuid default null) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; diffs jsonb := '[]'::jsonb; d jsonb; ins boolean; words text := ''; tid bigint; opsum numeric; sf record; held int; errs int; sent int;
  copy_fig jsonb; fb_fig jsonb; grp record; ndiff int := 0; src_fig jsonb; word text; act text := coalesce(current_setting('fincom.fb_actor', true), '');
begin
  select k.* into b from fb_books k where k.book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  word := case when b.source = 'zoho' then 'Zoho' else 'Tally' end;
  -- what the copy changed in the last minutes is mirrored first, so the check compares like with like. Asked by a member
  -- (or with an opening sign-off), at most 500 entries, so the request stays short; still behind then: "Updating", and
  -- nothing is stored (the book's step stays as it was)
  if fb_behind_since(p_book) is not null or exists (select 1 from fb_mirror_state st where st.book_id = p_book and st.sweep_after is not null) then
    perform fb_mirror_catchup(p_book, case when p_kind = 'asked' then 500 else 20000 end);
    if p_kind = 'asked' and (fb_behind_since(p_book) is not null or exists (select 1 from fb_mirror_state st where st.book_id = p_book and st.sweep_after is not null)) then
      perform set_config('fincom.fb_actor', act, true);
      return jsonb_build_object('in_step', null, 'updating', true, 'words', 'FinCom Books is still bringing in the latest changes from ' || word || '. Check again in a few minutes.');
    end if;
  end if;
  perform set_config('fincom.fb_actor', 'system:tieout', true);
  -- 1. ledger by day: the copy against FinCom Books (to the paisa)
  with c as (select w.ledger, w.day, sum(w.amount) as a from fb_copy_window(p_book) w group by 1, 2),
  f as (select g.name as ledger, l.date as day, sum(l.amount) as a from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version
          join fb_ledgers g on g.id = l.ledger_id where l.book_id = p_book and v.status = 'posted' and not v.memo and l.date >= b.mirror_from group by 1, 2),
  x as (select coalesce(c.ledger, f.ledger) as ledger, coalesce(c.day, f.day) as day, coalesce(c.a, 0) as copy, coalesce(f.a, 0) as fb
          from c full join f on f.ledger = c.ledger and f.day = c.day where coalesce(c.a, 0) <> coalesce(f.a, 0))
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'ledger_day', 'ledger', x.ledger, 'day', x.day, 'copy', x.copy, 'fincom', x.fb, 'diff', x.fb - x.copy,
           'group', coalesce((select coalesce(nullif(gg.reserved, ''), gg.name) from fb_ledgers lg join fb_groups gg on gg.id = lg.group_id where lg.book_id = p_book and lg.name = x.ledger), '')) order by x.ledger, x.day), '[]'::jsonb)
    into d from x;
  -- a day's difference that is exactly the held entries of that ledger and day is named as their cause
  select coalesce(jsonb_agg(case when h.a is not null and h.a = -(e ->> 'diff')::numeric then e || jsonb_build_object('cause', 'held') else e end), '[]'::jsonb) into d
    from jsonb_array_elements(d) e
    left join lateral (select sum(-l.amount) as a from fb_vouchers v join tally_lines l on l.book_id = b.source_book_id and l.guid = v.source_ref
                        where v.book_id = p_book and v.status = 'held' and v.date = (e ->> 'day')::date and l.ledger = e ->> 'ledger') h on true;
  diffs := diffs || d;
  -- 2. entries by type and month (every entry not deleted in the source)
  with c as (select v.vtype, to_char(v.day, 'YYYY-MM') as m, count(*) as n from tally_vouchers v where v.book_id = b.source_book_id and v.deleted_at is null and v.day >= b.mirror_from group by 1, 2),
  f as (select coalesce(t.name, '') as vtype, to_char(v.date, 'YYYY-MM') as m, count(*) as n from fb_vouchers v left join fb_vtypes t on t.id = v.vtype_id
         where v.book_id = p_book and v.source_ref is not null and not v.source_gone group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'count', 'vtype', coalesce(c.vtype, f.vtype), 'month', coalesce(c.m, f.m), 'copy', coalesce(c.n, 0), 'fincom', coalesce(f.n, 0))), '[]'::jsonb)
    into d from c full join f on f.vtype = c.vtype and f.m = c.m where coalesce(c.n, 0) <> coalesce(f.n, 0);
  diffs := diffs || d;
  -- 3. openings (Tally's opening plus the older entries, D20)
  with c as (select w.name, w.amount as a from fb_copy_openings(p_book) w),
  f as (select g.name, o.amount as a from fb_openings o join fb_ledgers g on g.id = o.ledger_id where o.book_id = p_book and o.as_on = b.mirror_from)
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'opening', 'ledger', coalesce(c.name, f.name), 'copy', coalesce(c.a, 0), 'fincom', coalesce(f.a, 0))), '[]'::jsonb)
    into d from c full join f on f.name = c.name where coalesce(c.a, 0) <> coalesce(f.a, 0);
  diffs := diffs || d;
  -- 4. D7: a difference in opening balances keeps the book Not in step until the owner signs it off (that amount)
  select coalesce(sum(o.amount), 0) into opsum from fb_openings o where o.book_id = p_book and o.as_on = b.mirror_from;
  if opsum <> 0 and ((b.opening_signoff ->> 'amount') is null or (b.opening_signoff ->> 'amount')::numeric <> opsum) then
    diffs := diffs || jsonb_build_array(jsonb_build_object('kind', 'opening_difference', 'amount', opsum));
  end if;
  -- 5. entries held (Dr and Cr differ in the copy) and changes the mirror could not apply
  select count(*) into held from fb_vouchers v where v.book_id = p_book and v.status = 'held';
  if held > 0 then
    diffs := diffs || coalesce((select jsonb_agg(jsonb_build_object('kind', 'held', 'guid', v.source_ref, 'number', v.number, 'date', v.date, 'why', v.mirror_note) order by v.date)
                                  from (select * from fb_vouchers v where v.book_id = p_book and v.status = 'held' order by v.date limit 50) v), '[]'::jsonb);
  end if;
  select count(*) into errs from fb_mirror_errors e where e.book_id = p_book and e.resolved_at is null;
  if errs > 0 then diffs := diffs || jsonb_build_array(jsonb_build_object('kind', 'mirror_error', 'n', errs)); end if;
  -- 6. Tally's own figures, once read (TODO D16 / bridge 2.5.19): each primary group's closing at the date read
  select * into sf from fb_source_figures s where s.book_id = p_book and s.kind = 'group_closing' order by s.at desc limit 1;
  if sf.id is not null then
    with f as (select g.primary_name as grp, sum(c.bal) as a from fb_closing(p_book, sf.as_on) c join fb_ledgers l on l.id = c.ledger_id join fb_groups g on g.id = l.group_id group by 1),
    s as (select key as grp, value::numeric as a from jsonb_each_text(sf.figures))
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'source_group', 'group', coalesce(s.grp, f.grp), 'as_on', sf.as_on, 'source', coalesce(s.a, 0), 'fincom', coalesce(f.a, 0),
             'diff', coalesce(f.a, 0) - coalesce(s.a, 0)) order by coalesce(s.grp, f.grp)), '[]'::jsonb)
      into d from s full join f on f.grp = s.grp where coalesce(s.a, 0) <> coalesce(f.a, 0);
    diffs := diffs || d;
    src_fig := jsonb_build_object('as_on', sf.as_on, 'read_at', sf.at, 'groups', sf.figures);
  end if;
  select count(*) into sent from fb_vouchers v where v.book_id = p_book and v.status = 'sent';
  ins := jsonb_array_length(diffs) = 0;
  -- the words: the biggest group difference first ("Sundry Debtors differs by ₹4,200.00")
  if not ins then
    select x.g, sum(x.d) as s, count(*) over () as n into grp from (
      select coalesce(nullif(e ->> 'group', ''), e ->> 'ledger') as g, (e ->> 'diff')::numeric as d from jsonb_array_elements(diffs) e where e ->> 'kind' = 'ledger_day' and e ->> 'cause' is null
      union all select e ->> 'group', (e ->> 'diff')::numeric from jsonb_array_elements(diffs) e where e ->> 'kind' = 'source_group') x
     group by x.g having sum(x.d) <> 0
     -- the biggest first; of equal ones, the balance sheet's group (Sundry Debtors before Sales Accounts)
     order by abs(sum(x.d)) desc, coalesce((select sg.sort from fb_seed_groups sg where sg.name = x.g), 1000), x.g limit 1;
    select count(*) into ndiff from jsonb_array_elements(diffs);
    words := case
      when grp.g is not null then grp.g || ' differs by ' || fb_inr(abs(grp.s)) || case when grp.n > 1 then ' (and ' || (grp.n - 1) || ' more)' else '' end
      when exists (select 1 from jsonb_array_elements(diffs) e where e ->> 'kind' = 'opening_difference') then 'Difference in opening balances in ' || word || ': ' || fb_inr(abs(opsum)) || ' (the owner may accept it with a reason)'
      when held > 0 then held || case when held = 1 then ' entry is' else ' entries are' end || ' held: Dr and Cr differ in the copy'
      when errs > 0 then 'A change from ' || word || ' could not be applied (FinCom is looking into it)'
      when exists (select 1 from jsonb_array_elements(diffs) e where e ->> 'kind' = 'count') then 'The number of entries differs (FinCom Books is still being built, or an entry is missing)'
      else 'An opening balance differs' end;
  end if;
  select jsonb_build_object('ledgers', count(distinct w.ledger), 'entries', count(distinct w.guid), 'total_dr', coalesce(sum(w.amount) filter (where w.amount > 0), 0)) into copy_fig from fb_copy_window(p_book) w;
  select jsonb_build_object('entries', count(*) filter (where v.status = 'posted' and not v.memo), 'memo', count(*) filter (where v.memo), 'held', held, 'sent', sent,
           'cancelled', count(*) filter (where v.status = 'cancelled'), 'opening_total', opsum,
           'alter_max', max(v.source_alter), 'copy_alter_max', (select max(t.alter_id) from tally_vouchers t where t.book_id = b.source_book_id))
    into fb_fig from fb_vouchers v where v.book_id = p_book;
  insert into fb_tieouts (book_id, firm_id, kind, asked_by, window_from, window_to, in_step, copy_figures, fb_figures, source_figures, differences, words)
  values (p_book, b.firm_id, p_kind, p_by, b.mirror_from, current_date, ins, copy_fig, fb_fig, src_fig,
          (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(diffs) e limit 200) z), words)
  returning id into tid;
  update fb_books set in_step = ins, in_step_at = now(), last_tieout_id = tid,
    not_in_step_since = case when ins then null else coalesce(not_in_step_since, now()) end,
    not_in_step_why = case when ins then '' else words end
   where book_id = p_book;
  perform set_config('fincom.fb_actor', act, true);
  return jsonb_build_object('id', tid, 'in_step', ins, 'words', words, 'differences', jsonb_array_length(diffs), 'source_read', sf.id is not null, 'sent', sent);
end $f$;
create or replace function public.fb_tieout_all() returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; n int := 0; bad int := 0; r jsonb;
begin
  for b in select k.book_id from fb_books k where k.mirror_on order by k.book_id loop
    begin
      r := fb_tieout(b.book_id, 'nightly'); n := n + 1; if not (r ->> 'in_step')::boolean then bad := bad + 1; end if;
    exception when others then
      insert into fb_mirror_errors (book_id, kind, error) values (b.book_id, 'tieout', left(sqlerrm, 500)); bad := bad + 1;
    end;
  end loop;
  return jsonb_build_object('books', n, 'not_in_step', bad);
end $f$;
-- a member asks for it (D21: on request too); at most once in 10 minutes a book
create or replace function public.fb_tieout_ask(p_book uuid) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare last timestamptz;
begin
  if not exists (select 1 from fb_my_books() m where m = p_book) or not can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select max(t.at) into last from fb_tieouts t where t.book_id = p_book and t.kind = 'asked';
  if last > now() - interval '10 minutes' then
    raise exception 'Checked a few minutes ago; ask again after %.', to_char((last + interval '10 minutes') at time zone 'Asia/Kolkata', 'HH24:MI') using errcode = '22023';
  end if;
  return fb_tieout(p_book, 'asked', auth.uid());
end $f$;
-- D18: before a return is filed for a period, the books' step WARNS (never blocks): {warn, words, books[]}
create or replace function public.fb_filing_warning(p_client text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare out jsonb := '[]'::jsonb; b record;
begin
  for b in select k.*, fb_behind_since(k.book_id) as behind from fb_books k where k.client_id = p_client and k.book_id in (select fb_my_books()) and k.mirror_on
             and (k.in_step is not true or fb_behind_since(k.book_id) < now() - interval '10 minutes')
             and (k.mirror_from is null or k.mirror_from <= p_to) loop
    out := out || jsonb_build_object('book', b.book_id, 'company', b.company, 'source', b.source, 'since', case when b.behind < now() - interval '10 minutes' then b.behind else b.not_in_step_since end,
      'why', case when b.behind < now() - interval '10 minutes' then 'it is ' || floor(extract(epoch from (now() - b.behind)) / 60) || ' minutes behind'
                  when b.in_step is false then b.not_in_step_why
                  else 'not checked yet' end);
  end loop;
  return jsonb_build_object('warn', jsonb_array_length(out) > 0, 'block', false, 'books', out,
    'words', case when jsonb_array_length(out) = 0 then '' else 'FinCom Books is not in step with ' || case when out -> 0 ->> 'source' = 'zoho' then 'Zoho Books' else 'Tally' end
      || ' for this period: ' || coalesce(out -> 0 ->> 'why', '') || '. You can still file; check the figures first.' end);
end $f$;
-- D7: the owner accepts a book's opening difference, with a reason (kept on the book and in the edit log)
create or replace function public.fb_opening_signoff(p_book uuid, p_reason text) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; s numeric;
begin
  select k.* into b from fb_books k where k.book_id = p_book and k.firm_id = my_firm();
  if b.book_id is null or not fb_is_owner() then raise exception 'Only the firm''s owner accepts an opening difference.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 500 then raise exception 'Give the reason (up to 500 letters).' using errcode = '22023'; end if;
  select coalesce(sum(o.amount), 0) into s from fb_openings o where o.book_id = p_book and o.as_on = b.mirror_from;
  if s = 0 then raise exception 'The openings of these books add up: nothing to accept.' using errcode = '22023'; end if;
  perform set_config('fincom.fb_reason', p_reason, true);
  update fb_books set opening_signoff = jsonb_build_object('amount', s, 'reason', p_reason, 'by', auth.uid(), 'at', now()) where book_id = p_book;
  perform set_config('fincom.fb_reason', '', true);
  return fb_tieout(p_book, 'asked', auth.uid());
end $f$;
-- TODO (D16, bridge 2.5.19): the bridge's new read of Tally's own figures is written here by tally-ingest (service role).
-- Kinds: group_closing {primary group: closing, a debit positive}. Nothing calls it until the owner approves the request.
create or replace function public.fb_source_figures_put(p_book uuid, p_kind text, p_as_on date, p_figures jsonb, p_read_by text default '') returns bigint
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare i bigint;
begin
  if jsonb_typeof(p_figures) <> 'object' then raise exception 'figures must be an object' using errcode = '22023'; end if;
  insert into fb_source_figures (book_id, firm_id, kind, as_on, figures, read_by) values (p_book, (select firm_id from fb_books where book_id = p_book), p_kind, p_as_on, p_figures, left(coalesce(p_read_by, ''), 100))
  returning id into i;
  return i;
end $f$;

-- ---------------------------------------------------------------- the daily self-check of the edit log
create or replace function public.fb_audit_verify(p_book uuid, p_from_seq bigint default 0) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare r public.fb_audit_log; prev bytea; n bigint := 0;
begin
  if auth.uid() is not null and not exists (select 1 from fb_my_books() m where m = p_book) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from_seq > 0 then select l.hash into prev from fb_audit_log l where l.book_id = p_book and l.seq < p_from_seq order by l.seq desc limit 1; end if;
  prev := coalesce(prev, sha256(convert_to('fincom books ' || p_book::text, 'UTF8')));
  for r in select * from fb_audit_log l where l.book_id = p_book and l.seq >= p_from_seq order by l.seq loop
    if r.prev_hash <> prev or r.hash <> sha256(r.prev_hash || convert_to(fb_audit_canon(r), 'UTF8')) then
      return jsonb_build_object('ok', false, 'bad_seq', r.seq, 'checked', n);
    end if;
    prev := r.hash; n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'checked', n, 'last', encode(prev, 'hex'));
end $f$;
-- the nightly self-check of one book: every guard trigger there and on (the edit log's, the guards, the commit checks,
-- and the landing triggers); the whole chain (time linear in the book's log rows); the last anchor; every
-- voucher version logged; and every current row equal to the edit log's last record of it (a row changed with the log's
-- trigger off is found). Any problem turns the book read-only, saying why
create or replace function public.fb_selfcheck(p_book uuid) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' set timezone to 'UTC' as $f$
declare t text; x text[]; probs text[] := '{}'; ver jsonb; anc record; bad_v int; nd bigint; act text := coalesce(current_setting('fincom.fb_actor', true), '');
  books_tables text[] := array['fb_books', 'fb_years', 'fb_registrations', 'fb_branches', 'fb_groups', 'fb_ledgers', 'fb_openings', 'fb_vtypes', 'fb_series',
      'fb_cost_categories', 'fb_cost_centres', 'fb_vouchers', 'fb_lines', 'fb_line_cc', 'fb_bill_refs', 'fb_voucher_versions', 'fb_locks', 'fb_approval_rules',
      'fb_approvals', 'fb_grants', 'client_books_mode'];
  want text[] := '{}';
begin
  foreach t in array books_tables loop want := want || array[[t, 'fb_audit'], [t, 'fb_no_delete'], [t, 'fb_no_truncate']]; end loop;
  foreach t in array array['fb_lines', 'fb_line_cc', 'fb_bill_refs', 'fb_voucher_versions', 'fb_tieouts', 'fb_source_figures', 'fb_audit_anchors'] loop want := want || array[[t, 'fb_keep']]; end loop;
  foreach t in array array['fb_tieouts', 'fb_source_figures', 'fb_audit_anchors'] loop want := want || array[[t, 'fb_no_truncate']]; end loop;
  foreach t in array array['fb_lines', 'fb_line_cc', 'fb_bill_refs'] loop want := want || array[[t, 'fb_lines_guard'], [t, 'fb_check']]; end loop;
  foreach t in array array['tally_vouchers', 'tally_lines', 'tally_bills', 'tally_cost_allocs', 'tally_ledgers', 'tally_groups'] loop
    want := want || array[[t, 'fb_land_i'], [t, 'fb_land_u'], [t, 'fb_land_d']];
  end loop;
  want := want || array[['fb_vouchers', 'fb_vouchers_guard'], ['fb_vouchers', 'fb_vouchers_open'], ['fb_vouchers', 'fb_check'],
                        ['fb_audit_log', 'fb_audit_log_keep'], ['fb_audit_log', 'fb_audit_log_no_truncate']];
  foreach x slice 1 in array want loop
    if not exists (select 1 from pg_trigger g where g.tgrelid = to_regclass('public.' || x[1]) and g.tgname = x[2] and g.tgenabled in ('O', 'A')) then
      probs := probs || (case when x[2] = 'fb_audit' then 'the edit log''s trigger ' else 'the trigger ' end || x[2] || ' on ' || x[1] || ' is missing or switched off');
    end if;
  end loop;
  -- the whole chain, every night (the anchors are a cross-check of it, and the copy kept outside the database)
  select * into anc from fb_audit_anchors a where a.book_id = p_book order by a.day desc limit 1;
  ver := fb_audit_verify(p_book, 0);
  if not (ver ->> 'ok')::boolean then probs := probs || ('the edit log''s chain breaks at entry ' || (ver ->> 'bad_seq')); end if;
  if anc.seq is not null and not exists (select 1 from fb_audit_log l where l.book_id = p_book and l.seq = anc.seq and l.hash = anc.hash) then
    probs := probs || 'the edit log no longer matches its last daily anchor'::text;
  end if;
  select count(*) into bad_v from fb_vouchers v where v.book_id = p_book
     and (select count(distinct coalesce(l.version_to, 1)) from fb_audit_log l where l.voucher_id = v.id and l.entity = 'fb_vouchers') < v.version;
  if bad_v > 0 then probs := probs || (bad_v || ' vouchers have versions with no edit-log entry'); end if;
  -- every current row against the log's last after-image of it
  foreach t in array books_tables loop
    execute format('select count(*) from public.%I r where r.book_id = $1 and to_jsonb(r) is distinct from
                      (select l.after from public.fb_audit_log l where l.book_id = $1 and l.entity = %L and l.entity_id = public.fb_audit_eid(to_jsonb(r)) order by l.seq desc limit 1)', t, t)
      into nd using p_book;
    if nd > 0 then probs := probs || (nd || ' rows of ' || t || ' differ from the edit log''s last record of them'); end if;
  end loop;
  if array_length(probs, 1) > 0 then
    perform set_config('fincom.fb_actor', 'system:selfcheck', true);
    update fb_books set state = 'read_only', read_only_why = array_to_string(probs, '; ') where book_id = p_book and (state <> 'read_only' or read_only_why <> array_to_string(probs, '; '));
  else
    insert into fb_audit_anchors (book_id, day, seq, hash)
    select p_book, current_date, l.seq, l.hash from fb_audit_log l where l.book_id = p_book order by l.seq desc limit 1
    on conflict (book_id, day) do nothing;
  end if;
  perform set_config('fincom.fb_actor', act, true);
  return jsonb_build_object('ok', array_length(probs, 1) is null, 'problems', to_jsonb(probs), 'checked', ver -> 'checked');
end $f$;
create or replace function public.fb_selfcheck_all() returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; n int := 0; bad int := 0; r jsonb;
begin
  for b in select k.book_id from fb_books k order by k.book_id loop
    begin
      r := fb_selfcheck(b.book_id); n := n + 1; if not (r ->> 'ok')::boolean then bad := bad + 1; end if;
    exception when others then
      bad := bad + 1;
      insert into fb_mirror_errors (book_id, kind, key, error) values (b.book_id, 'selfcheck', 'run', left(sqlerrm, 500));
    end;
  end loop;
  return jsonb_build_object('books', n, 'read_only', bad);
end $f$;

-- ---------------------------------------------------------------- the readers (the FinCom Books page)
create or replace function public.fb_status(p_client text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
begin
  return jsonb_build_object('owner', fb_is_owner(), 'can_set_up', coalesce(can_write(), false), 'books', coalesce((
    select jsonb_agg(jsonb_build_object('book', b.book_id, 'source', b.source, 'company', b.company, 'state', b.state, 'read_only_why', b.read_only_why,
      'mirror_on', b.mirror_on, 'from', b.mirror_from, 'in_step', b.in_step, 'checked_at', b.in_step_at, 'since', b.not_in_step_since, 'why', b.not_in_step_why,
      'opening_signoff', b.opening_signoff,
      -- how far behind the copy (owner decision 23-Nov-2026: FinCom Books follows within 10 minutes): within 10 minutes the
      -- page says "Updating"; beyond, "Not in step"
      'behind_since', fb_behind_since(b.book_id),
      'behind_minutes', floor(extract(epoch from (now() - fb_behind_since(b.book_id))) / 60),
      'late', coalesce(fb_behind_since(b.book_id) < now() - interval '10 minutes', false),
      'mirrored_at', (select st.mirrored_at from fb_mirror_state st where st.book_id = b.book_id),
      'counts', (select jsonb_build_object('posted', count(*) filter (where v.status = 'posted' and not v.memo), 'memo', count(*) filter (where v.memo and v.status = 'posted'),
                  'held', count(*) filter (where v.status = 'held'), 'sent', count(*) filter (where v.status = 'sent'), 'cancelled', count(*) filter (where v.status = 'cancelled'),
                  'last', max(v.date), 'waiting', (select count(*) from fb_mirror_dirty d where d.book_id = b.book_id and d.kind = 'v'))
                  from fb_vouchers v where v.book_id = b.book_id),
      'tieout', (select jsonb_build_object('at', t.at, 'kind', t.kind, 'in_step', t.in_step, 'words', t.words, 'source_read', t.source_figures is not null,
                  'differences', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(t.differences) e limit 20) z),
                  'n', jsonb_array_length(t.differences)) from fb_tieouts t where t.id = b.last_tieout_id))
      order by b.mirror_from desc nulls last)
      from fb_books b where b.client_id = p_client and b.book_id in (select fb_my_books())), '[]'::jsonb));
end $f$;

-- the edit log's client_info (IP address, browser) is personal: members read the log without it (column grants below);
-- the firm's owner reads it here, from a seq on (at most 500 rows)
create or replace function public.fb_audit_client_info(p_book uuid, p_from_seq bigint default 0, p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if not fb_is_owner() or not exists (select 1 from fb_books b where b.book_id = p_book and b.firm_id = my_firm()) then
    raise exception 'Only the firm''s owner sees where a change was made from.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('seq', l.seq, 'at', l.at, 'client', l.client_info) order by l.seq)
                     from (select * from fb_audit_log l where l.book_id = p_book and l.seq >= p_from_seq order by l.seq limit greatest(1, least(p_limit, 500))) l), '[]'::jsonb);
end $f$;

-- the trial balance at a date, ledger by ledger with its group, from the entries (recomputed every time)
create or replace function public.fb_tb(p_book uuid, p_on date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; rws jsonb; tot record;
begin
  if not exists (select 1 from fb_my_books() m where m = p_book) then raise exception 'Not a book of your firm.' using errcode = '42501'; end if;
  select k.mirror_from, k.company into b from fb_books k where k.book_id = p_book;
  if p_on < b.mirror_from then raise exception 'FinCom Books for this company start on %.', to_char(b.mirror_from, 'DD-Mon-YYYY') using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'l', l.name, 'g', coalesce(nullif(g.reserved, ''), g.name, ''), 'grp', coalesce(g.name, ''), 'p', coalesce(g.primary_name, ''),
           'nature', coalesce(g.nature, ''), 'sch3', coalesce(g.sch3_code, ''), 'psch3', coalesce(pg.sch3_code, g.sch3_code, ''), 'gsort', coalesce(psg.sort, sg.sort, g.sort, 1000), 'open', c.open, 'dr', c.dr, 'cr', c.cr, 'close', c.bal,
           'inactive', l.inactive, 'note', l.mirror_note)
           order by coalesce(sg.sort, g.sort, 1000), coalesce(nullif(g.reserved, ''), g.name), l.name), '[]'::jsonb)
    into rws from fb_closing(p_book, p_on) c join fb_ledgers l on l.id = c.ledger_id left join fb_groups g on g.id = l.group_id
    left join fb_seed_groups sg on sg.name = g.reserved
    left join fb_groups pg on pg.book_id = p_book and pg.name = g.primary_name left join fb_seed_groups psg on psg.name = g.primary_name
   where c.open <> 0 or c.dr <> 0 or c.cr <> 0;
  select coalesce(sum(c.bal) filter (where c.bal > 0), 0) as dr, coalesce(-sum(c.bal) filter (where c.bal < 0), 0) as cr,
         coalesce(sum(c.open), 0) as open_diff into tot from fb_closing(p_book, p_on) c;
  return jsonb_build_object('on', p_on, 'from', b.mirror_from, 'company', b.company, 'rows', rws, 'dr', tot.dr, 'cr', tot.cr, 'ties', tot.dr = tot.cr,
    'opening_difference', tot.open_diff,
    'entries', (select count(*) from fb_vouchers v where v.book_id = p_book and v.status = 'posted' and not v.memo and v.date <= p_on));
end $f$;

create or replace function public.fb_ledgers(p_book uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if not exists (select 1 from fb_my_books() m where m = p_book) then raise exception 'Not a book of your firm.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'group', coalesce(nullif(g.reserved, ''), g.name, ''), 'kind', l.kind, 'inactive', l.inactive) order by l.name)
                     from fb_ledgers l left join fb_groups g on g.id = l.group_id where l.book_id = p_book), '[]'::jsonb);
end $f$;

-- one ledger between two dates: the opening at the first, each entry with the other side and a running balance, the
-- closing; and its bill-wise references up to the second date (worked into pending bills by the page's ported rules)
create or replace function public.fb_ledger(p_book uuid, p_ledger bigint, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; led record; op numeric; rws jsonb; bills jsonb; n int;
begin
  if not exists (select 1 from fb_my_books() m where m = p_book) then raise exception 'Not a book of your firm.' using errcode = '42501'; end if;
  select k.mirror_from into b from fb_books k where k.book_id = p_book;
  select l.*, coalesce(nullif(g.reserved, ''), g.name, '') as gname into led from fb_ledgers l left join fb_groups g on g.id = l.group_id where l.id = p_ledger and l.book_id = p_book;
  if led.id is null then raise exception 'No such ledger in these books.' using errcode = '22023'; end if;
  p_from := greatest(p_from, b.mirror_from);
  if p_to < p_from then raise exception 'The dates are the wrong way round.' using errcode = '22023'; end if;
  select coalesce(c.bal, 0) into op from fb_closing(p_book, p_from - 1) c where c.ledger_id = p_ledger;
  op := coalesce(op, 0);
  select count(*) into n from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version
   where l.book_id = p_book and l.ledger_id = p_ledger and l.date between p_from and p_to and v.status = 'posted' and not v.memo;
  if n > 5000 then raise exception 'More than 5,000 entries: choose shorter dates.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'date', z.date, 'vtype', z.vtype, 'number', z.number, 'against', z.against, 'narration', z.narration,
           'amount', z.amount, 'bal', op + z.run) order by z.date, z.number, z.id), '[]'::jsonb)
    into rws from (
      select v.id, v.date, t.name as vtype, v.number, v.narration, sum(l.amount) as amount,
             (select string_agg(distinct g2.name, ', ') from fb_lines l2 join fb_ledgers g2 on g2.id = l2.ledger_id where l2.voucher_id = v.id and l2.version = v.version and l2.ledger_id <> p_ledger) as against,
             sum(sum(l.amount)) over (order by v.date, v.number, v.id) as run
        from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version left join fb_vtypes t on t.id = v.vtype_id
       where l.book_id = p_book and l.ledger_id = p_ledger and l.date between p_from and p_to and v.status = 'posted' and not v.memo
       group by v.id, v.date, t.name, v.number, v.narration) z;
  select coalesce(jsonb_agg(jsonb_build_object('voucher', v.id, 'date', v.date, 'number', v.number, 'type', r.ref_type, 'name', r.ref_name, 'amount', r.amount,
           'bill_date', r.bill_date, 'due', r.due_date, 'days', r.credit_days) order by v.date, v.number, r.part_no), '[]'::jsonb)
    into bills from fb_bill_refs r join fb_vouchers v on v.id = r.voucher_id and v.version = r.version
   where r.book_id = p_book and r.party_ledger_id = p_ledger and v.status = 'posted' and not v.memo and v.date <= p_to;
  return jsonb_build_object('ledger', jsonb_build_object('id', led.id, 'name', led.name, 'group', led.gname, 'kind', led.kind, 'gstin', led.gstin, 'pan', led.pan,
           'state', led.state_name, 'inactive', led.inactive, 'note', led.mirror_note),
         'from', p_from, 'to', p_to, 'open', op, 'rows', rws, 'close', op + coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(rws) e), 0),
         'bills', bills, 'books_from', b.mirror_from,
         'books_open', coalesce((select o.amount from fb_openings o where o.book_id = p_book and o.as_on = b.mirror_from and o.ledger_id = p_ledger), 0));
end $f$;

-- the day book between two dates (at most 62 days, 3,000 entries): every entry with its lines and status; totals of the
-- posted ones only (held, memo, sent and cancelled entries are shown, never added)
create or replace function public.fb_daybook(p_book uuid, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare rws jsonb; tot jsonb; n int;
begin
  if not exists (select 1 from fb_my_books() m where m = p_book) then raise exception 'Not a book of your firm.' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'Choose up to two months.' using errcode = '22023'; end if;
  select count(*) into n from fb_vouchers v where v.book_id = p_book and v.date between p_from and p_to;
  if n > 3000 then raise exception 'More than 3,000 entries: choose shorter dates.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'date', v.date, 'vtype', coalesce(t.name, ''), 'number', v.number, 'party', coalesce(p.name, ''), 'narration', v.narration,
           'status', v.status, 'memo', v.memo, 'note', v.mirror_note, 'version', v.version, 'cancel_reason', v.cancel_reason,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object('l', g.name, 'a', l.amount) order by l.line_no), '[]'::jsonb) from fb_lines l join fb_ledgers g on g.id = l.ledger_id
                      where l.voucher_id = v.id and l.version = v.version)) order by v.date, t.name, v.number, v.id), '[]'::jsonb)
    into rws from fb_vouchers v left join fb_vtypes t on t.id = v.vtype_id left join fb_ledgers p on p.id = v.party_ledger_id
   where v.book_id = p_book and v.date between p_from and p_to;
  select jsonb_build_object('posted', count(distinct v.id) filter (where v.status = 'posted' and not v.memo),
           'dr', coalesce(sum(l.amount) filter (where l.amount > 0 and v.status = 'posted' and not v.memo), 0),
           'cr', coalesce(-sum(l.amount) filter (where l.amount < 0 and v.status = 'posted' and not v.memo), 0),
           'held', count(distinct v.id) filter (where v.status = 'held'), 'memo', count(distinct v.id) filter (where v.memo),
           'sent', count(distinct v.id) filter (where v.status = 'sent'), 'cancelled', count(distinct v.id) filter (where v.status = 'cancelled'))
    into tot from fb_vouchers v left join fb_lines l on l.voucher_id = v.id and l.version = v.version where v.book_id = p_book and v.date between p_from and p_to;
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', rws, 'totals', tot);
end $f$;

-- ---------------------------------------------------------------- triggers, RLS, grants
do $t$
declare t text; fn text;
  books_tables text[] := array['fb_books', 'fb_years', 'fb_registrations', 'fb_branches', 'fb_groups', 'fb_ledgers', 'fb_openings', 'fb_vtypes', 'fb_series',
      'fb_cost_categories', 'fb_cost_centres', 'fb_vouchers', 'fb_lines', 'fb_line_cc', 'fb_bill_refs', 'fb_voucher_versions', 'fb_locks', 'fb_approval_rules',
      'fb_approvals', 'fb_grants', 'client_books_mode'];
  readable text[] := array['fb_books', 'fb_years', 'fb_registrations', 'fb_branches', 'fb_groups', 'fb_ledgers', 'fb_openings', 'fb_vtypes', 'fb_series',
      'fb_cost_categories', 'fb_cost_centres', 'fb_vouchers', 'fb_lines', 'fb_line_cc', 'fb_bill_refs', 'fb_voucher_versions', 'fb_locks', 'fb_approval_rules',
      'fb_approvals', 'fb_audit_log', 'fb_tieouts'];
begin
  foreach t in array books_tables loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_audit') then
      execute format('create trigger fb_audit after insert or update or delete on public.%I for each row execute function public.fb_audit_trg()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_no_delete') then
      execute format('create trigger fb_no_delete before delete on public.%I for each row execute function public.fb_no_delete_trg()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_no_truncate') then
      execute format('create trigger fb_no_truncate before truncate on public.%I for each statement execute function public.fb_no_truncate_trg()', t);
    end if;
  end loop;
  -- lines, splits, references, versions, results and the log itself: written once, never changed
  foreach t in array array['fb_lines', 'fb_line_cc', 'fb_bill_refs', 'fb_voucher_versions', 'fb_tieouts', 'fb_source_figures', 'fb_audit_anchors'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_keep') then
      execute format('create trigger fb_keep before update or delete on public.%I for each row execute function public.fb_no_change_trg()', t);
    end if;
  end loop;
  foreach t in array array['fb_tieouts', 'fb_source_figures', 'fb_audit_anchors'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_no_truncate') then
      execute format('create trigger fb_no_truncate before truncate on public.%I for each statement execute function public.fb_no_truncate_trg()', t);
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fb_audit_log'::regclass and tgname = 'fb_audit_log_keep') then
    create trigger fb_audit_log_keep before update or delete on public.fb_audit_log for each row execute function public.fb_no_change_trg();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fb_audit_log'::regclass and tgname = 'fb_audit_log_no_truncate') then
    create trigger fb_audit_log_no_truncate before truncate on public.fb_audit_log for each statement execute function public.fb_no_truncate_trg();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fb_vouchers'::regclass and tgname = 'fb_vouchers_guard') then
    create trigger fb_vouchers_guard before update on public.fb_vouchers for each row execute function public.fb_vouchers_guard_trg();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fb_vouchers'::regclass and tgname = 'fb_vouchers_open') then
    create trigger fb_vouchers_open before insert on public.fb_vouchers for each row execute function public.fb_vouchers_open_trg();
  end if;
  foreach t in array array['fb_lines', 'fb_line_cc', 'fb_bill_refs'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_lines_guard') then
      execute format('create trigger fb_lines_guard before insert on public.%I for each row execute function public.fb_lines_guard_trg()', t);
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.fb_vouchers'::regclass and tgname = 'fb_check') then
    create constraint trigger fb_check after insert or update on public.fb_vouchers deferrable initially deferred for each row execute function public.fb_check_voucher_trg();
  end if;
  foreach t in array array['fb_lines', 'fb_line_cc', 'fb_bill_refs'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_check') then
      execute format('create constraint trigger fb_check after insert on public.%I deferrable initially deferred for each row execute function public.fb_check_voucher_trg()', t);
    end if;
  end loop;
  -- the landing tables: three statement triggers each (insert, update, delete), new, each made only when missing (a re-run
  -- takes no lock on the copy's tables); nothing of theirs is changed
  foreach t in array array['tally_vouchers', 'tally_lines', 'tally_bills', 'tally_cost_allocs', 'tally_ledgers', 'tally_groups'] loop
    fn := case when t in ('tally_ledgers', 'tally_groups') then format('public.fb_land_name_trg(%L)', case when t = 'tally_ledgers' then 'l' else 'g' end) else 'public.fb_land_guid_trg()' end;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_land_i') then
      execute format('create trigger fb_land_i after insert on public.%I referencing new table as nt for each statement execute function %s', t, fn);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_land_u') then
      execute format('create trigger fb_land_u after update on public.%I referencing old table as ot new table as nt for each statement execute function %s', t, fn);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'fb_land_d') then
      execute format('create trigger fb_land_d after delete on public.%I referencing old table as ot for each statement execute function %s', t, fn);
    end if;
  end loop;

  -- RLS on every table; members read their firm's books (and, where a book names its people, only if named); nobody
  -- writes any table directly, the service role included: every write goes through the functions above
  -- (on a re-run, RLS and the policies are there and are left alone: ALTER TABLE / DROP POLICY would take ACCESS
  -- EXCLUSIVE locks on fb_books and block the landing triggers)
  foreach t in array books_tables || array['fb_seed_groups', 'fb_audit_log', 'fb_audit_anchors', 'fb_tieouts', 'fb_source_figures', 'fb_mirror_errors', 'fb_mirror_dirty', 'fb_mirror_state'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      execute format('alter table public.%I enable row level security', t);
    end if;
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  foreach t in array readable loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t and p.policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (book_id = any (array(select public.fb_my_books())))', t || '_read', t);
    end if;
    if t = 'fb_audit_log' then
      -- every column but client_info (IP address, browser): that one only through fb_audit_client_info, for the owner
      execute 'grant select (seq, book_id, at, actor, actor_kind, actor_role, action, entity, entity_id, voucher_id, version_from, version_to, before, after, reason, prev_hash, hash) on public.fb_audit_log to authenticated';
    else
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'fb_seed_groups' and p.policyname = 'fb_seed_groups_read') then
    create policy fb_seed_groups_read on public.fb_seed_groups for select to authenticated using (true);
  end if;
  grant select on public.fb_seed_groups to authenticated;
end $t$;
-- the identity sequences: nobody but the functions' owner uses them
do $s$
declare r record;
begin
  for r in select s.relname from pg_class s join pg_depend d on d.objid = s.oid and d.deptype = 'i' join pg_class t on t.oid = d.refobjid
            where s.relkind = 'S' and t.relname like 'fb\_%' and t.relnamespace = 'public'::regnamespace loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', r.relname);
    execute format('grant usage, select on sequence public.%I to service_role', r.relname);
  end loop;
end $s$;

do $g$
declare f record;
  members_fns text[] := array['fb_status', 'fb_tb', 'fb_ledger', 'fb_ledgers', 'fb_daybook', 'fb_enroll', 'fb_tieout_ask', 'fb_filing_warning', 'fb_opening_signoff', 'fb_audit_verify', 'fb_inr', 'fb_fy',
                              'fb_audit_client_info'];
  server_fns text[] := array['fb_mirror_catchup', 'fb_mirror_catchup_all', 'fb_mirror_triage', 'fb_tieout', 'fb_tieout_all', 'fb_source_figures_put', 'fb_selfcheck', 'fb_selfcheck_all', 'fb_audit_verify',
                             'fb_status', 'fb_tb', 'fb_ledger', 'fb_daybook', 'fb_inr', 'fb_fy'];
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fb_inr', 'fb_fy', 'fb_fy_start', 'fb_is_owner', 'fb_my_books', 'fb_audit_canon', 'fb_audit_trg', 'fb_no_delete_trg',
              'fb_no_change_trg', 'fb_no_truncate_trg', 'fb_vouchers_guard_trg', 'fb_lines_guard_trg', 'fb_check_voucher', 'fb_check_voucher_trg', 'fb_land_guid_trg',
              'fb_land_name_trg', 'fb_seed_book', 'fb_group_id', 'fb_mirror_group', 'fb_ledger_id', 'fb_mirror_ledger', 'fb_vtype_id',
              'fb_vtype_base', 'fb_cc_id', 'fb_mirror_voucher', 'fb_mirror_openings', 'fb_mirror_masters', 'fb_mirror_catchup', 'fb_mirror_catchup_all', 'fb_enroll',
              'fb_tieout', 'fb_tieout_all', 'fb_tieout_ask', 'fb_filing_warning', 'fb_opening_signoff', 'fb_source_figures_put', 'fb_audit_verify', 'fb_selfcheck',
              'fb_selfcheck_all', 'fb_status', 'fb_tb', 'fb_ledger', 'fb_ledgers', 'fb_daybook', 'fb_closing', 'fb_copy_window', 'fb_copy_openings',
              'fb_audit_eid', 'fb_vouchers_open_trg', 'fb_mirror_triage', 'fb_mirror_catchup_run', 'fb_audit_client_info', 'fb_behind_since', 'fb_mirror_failed', 'fb_mirror_one', 'fb_mirror_list', 'fb_mirror_run_failed') loop
    execute format('comment on routine %s is %L', f.oid::regprocedure, 'fincom books (migration 220)');
    execute format('revoke all on routine %s from public, anon, authenticated, service_role', f.oid::regprocedure);
    if f.proname = any(members_fns) then execute format('grant execute on routine %s to authenticated', f.oid::regprocedure); end if;
    if f.proname = any(server_fns) then execute format('grant execute on routine %s to service_role', f.oid::regprocedure); end if;
  end loop;
  -- RLS calls these for the person reading (they answer only the person's own books)
  grant execute on function public.fb_my_books() to authenticated, service_role;
  grant execute on function public.fb_is_owner() to authenticated;
end $g$;

commit;
