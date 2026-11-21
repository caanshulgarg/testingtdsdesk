-- Migration 206 DRAFT (21-Nov-2026, branch next-assistant). DESIGN ONLY: NOT run anywhere. The number is taken when it is
-- built; read docs/ASSISTANT-PHASE1.md first. The owner reads it and runs it on staging only after the build round and its
-- reviews (acceptance rule 7).
--
-- The Assistant, phase 1: the night's checks per client, the questions to clients, the entries FinCom prepares.
--   client_contacts      a client's own contacts (several, each with a name): email, WhatsApp, and how questions go to each
--   assistant_prefs      per client: "send missing-document reminders by itself" (OFF by default)
--   assistant_mail       per firm: real sending (OFF by default: test mode, every email to the firm's own address)
--   night_runs           one row a client a night: when, the books' version, counts, ok or why not
--   night_findings       one row a finding, unique per (firm, client, kind, key): a second run the same night updates,
--                        never adds (acceptance rule 4). state: open -> resolved | ask | you | dismissed; resolved keeps
--                        its evidence; undo is a new state change, logged
--   client_asks          one row a question (one a finding at most): draft -> asked -> answered -> closed, with its history
--   ask_sends            one row an email or WhatsApp press: to whom it was meant, to whom it really went (test mode),
--                        Resend's id, the questions in it
--   night_entries        entries FinCom prepared, with why and the evidence, and the checks they passed; approve hands
--                        them to the existing posting path (the bill's or bank line's own approval in the client's work)
--   assistant_log        every action (resolve, undo, send, approve, reject, close) with who, when and the evidence
-- Who: members of the firm read their own firm's rows (my_firm()); owners and staff (can_write()) change questions,
-- contacts and entries; only the firm's owner turns real sending on (assistant_mail_set, logged); the night function
-- writes findings, runs and drafts with the service role. Nothing here posts, sends or deletes.
-- ADD-ONLY: new tables, their indexes, policies and grants (explicit: none are given by default). No existing table,
-- column, policy or function is changed or dropped. Safe to run twice. One transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade default public.my_firm(),
  client_id text not null,
  name text not null check (length(name) between 1 and 120),
  role text not null default '' check (length(role) <= 60),
  email text not null default '' check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp text not null default '' check (whatsapp ~ '^\+?[0-9 ]{0,20}$'),
  by_email boolean not null default true,
  by_whatsapp boolean not null default true,
  removed_at timestamptz,                -- removed softly: kept, never asked again
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_contacts_client on public.client_contacts (firm_id, client_id) where removed_at is null;

create table if not exists public.assistant_prefs (
  firm_id uuid not null references public.firms (id) on delete cascade default public.my_firm(),
  client_id text not null,
  auto_reminders boolean not null default false,   -- OFF by default (the owner's scope)
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (firm_id, client_id)
);

create table if not exists public.assistant_mail (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  real_send boolean not null default false,        -- OFF: test mode (every email to the firm's own address)
  test_to text not null default '',                -- the firm's own address; '' = the owner's sign-in email
  set_by uuid,
  set_at timestamptz not null default now()
);

create table if not exists public.night_runs (
  id bigserial primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  night date not null,                             -- the night (India date) the run belongs to
  books_version text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'skipped', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  why text not null default '',
  unique (firm_id, client_id, night)
);

create table if not exists public.night_findings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  kind text not null check (kind in ('advance_open', 'wrong_side', 'cash_big', 'round_sum', 'no_narration', 'expense_jump', 'suspense',
    'bank_no_bill', 'bank_month_missing', 'bank_not_posted', 'twob_not_in_books', 'sales_month_missing', 'salary_month_missing', 'salary_mismatch')),
  key text not null,                               -- stable: the voucher's guid, the bank line's id, the 2B document, the month
  facts jsonb not null,                            -- party, amount, date, refs: what the words are made from
  state text not null default 'open' check (state in ('open', 'resolved', 'ask', 'you', 'dismissed')),
  evidence jsonb not null default '[]'::jsonb,     -- [{type: entry|doc|rule|twob|salary|challan, ref, words}]
  candidates jsonb not null default '[]'::jsonb,   -- two or more that fit: shown under Needs you, never picked
  first_seen date not null,
  last_seen date not null,
  undone_by uuid, undone_at timestamptz,
  unique (firm_id, client_id, kind, key)
);
create index if not exists night_findings_client on public.night_findings (firm_id, client_id, state);

create table if not exists public.client_asks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  finding_id uuid not null references public.night_findings (id) on delete cascade,
  week date not null,                              -- the Monday of the weekly list
  text text not null,
  edited text,                                     -- the owner's words, when changed
  state text not null default 'draft' check (state in ('draft', 'asked', 'answered', 'closed')),
  answer text,
  closed_by text check (closed_by in ('document', 'entry', 'person')),
  close_ref text,
  history jsonb not null default '[]'::jsonb,      -- [{at, what, by}]
  created_at timestamptz not null default now(),
  unique (finding_id)                              -- one question a finding: never asked twice (rule 4)
);
create index if not exists client_asks_client on public.client_asks (firm_id, client_id, state, week);

create table if not exists public.ask_sends (
  id bigserial primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  meant_for text[] not null,                       -- the client's contacts (client_contacts), as they were
  sent_to text[] not null,                         -- where it really went: the firm's own address in test mode
  test_mode boolean not null,
  ask_ids uuid[] not null,
  provider_id text,                                -- Resend's id
  status text not null check (status in ('sent', 'opened_link', 'failed', 'refused')),
  why text not null default '',
  sent_by uuid not null,
  sent_at timestamptz not null default now()
);

create table if not exists public.night_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  finding_id uuid references public.night_findings (id) on delete set null,
  source text not null check (source in ('twob_inbox_bill', 'bank_self_answer')),   -- phase 2 adds gst_setoff, payroll
  dedupe text not null,                            -- party|bill number|amount (or the bank line's id): unique below
  voucher jsonb not null,                          -- {type, date, no, lines: [{ledger, dr, cr}], narration}
  why text not null,
  evidence jsonb not null,
  checks jsonb not null,                           -- each check and its result; shown as ready only when all pass
  state text not null default 'ready' check (state in ('ready', 'held', 'approved', 'rejected', 'posted')),
  work_ref text,                                   -- the bill or bank line in the client's work it became, once approved
  decided_by uuid, decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (firm_id, client_id, dedupe)
);

create table if not exists public.assistant_log (
  id bigserial primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  what text not null,                              -- resolve, undo, send, approve, reject, close, reopen, contact, setting
  ref uuid,
  evidence jsonb not null default '{}'::jsonb,
  by_user uuid,                                    -- null: the night function
  at timestamptz not null default now()
);
create index if not exists assistant_log_client on public.assistant_log (firm_id, client_id, at desc);

-- ---------------------------------------------------------------- row-level security
alter table public.client_contacts enable row level security;
alter table public.assistant_prefs enable row level security;
alter table public.assistant_mail enable row level security;
alter table public.night_runs enable row level security;
alter table public.night_findings enable row level security;
alter table public.client_asks enable row level security;
alter table public.ask_sends enable row level security;
alter table public.night_entries enable row level security;
alter table public.assistant_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_contacts' and policyname = 'client_contacts_read') then
    create policy client_contacts_read on public.client_contacts for select to authenticated using (firm_id = (select public.my_firm()));
    create policy client_contacts_add on public.client_contacts for insert to authenticated with check (firm_id = (select public.my_firm()) and public.can_write());
    create policy client_contacts_change on public.client_contacts for update to authenticated using (firm_id = (select public.my_firm()) and public.can_write()) with check (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_prefs' and policyname = 'assistant_prefs_read') then
    create policy assistant_prefs_read on public.assistant_prefs for select to authenticated using (firm_id = (select public.my_firm()));
    create policy assistant_prefs_add on public.assistant_prefs for insert to authenticated with check (firm_id = (select public.my_firm()) and public.can_write());
    create policy assistant_prefs_change on public.assistant_prefs for update to authenticated using (firm_id = (select public.my_firm()) and public.can_write()) with check (firm_id = (select public.my_firm()));
  end if;
  -- the mail setting: read by the firm; changed ONLY through assistant_mail_set (owner, logged): no write policy
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_mail' and policyname = 'assistant_mail_read') then
    create policy assistant_mail_read on public.assistant_mail for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'night_runs' and policyname = 'night_runs_read') then
    create policy night_runs_read on public.night_runs for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'night_findings' and policyname = 'night_findings_read') then
    create policy night_findings_read on public.night_findings for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  -- questions: read by the firm; their words and state changed by owners and staff (the state's moves are checked by
  -- ask_move, phase 1 build); added only by the night function
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_asks' and policyname = 'client_asks_read') then
    create policy client_asks_read on public.client_asks for select to authenticated using (firm_id = (select public.my_firm()));
    create policy client_asks_change on public.client_asks for update to authenticated using (firm_id = (select public.my_firm()) and public.can_write()) with check (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ask_sends' and policyname = 'ask_sends_read') then
    create policy ask_sends_read on public.ask_sends for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'night_entries' and policyname = 'night_entries_read') then
    create policy night_entries_read on public.night_entries for select to authenticated using (firm_id = (select public.my_firm()));
    create policy night_entries_change on public.night_entries for update to authenticated using (firm_id = (select public.my_firm()) and public.can_write()) with check (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_log' and policyname = 'assistant_log_read') then
    create policy assistant_log_read on public.assistant_log for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;

-- ---------------------------------------------------------------- grants (explicit)
revoke all on public.client_contacts, public.assistant_prefs, public.assistant_mail, public.night_runs, public.night_findings,
  public.client_asks, public.ask_sends, public.night_entries, public.assistant_log from anon, public;
grant select, insert, update on public.client_contacts, public.assistant_prefs to authenticated;
grant select on public.assistant_mail, public.night_runs, public.night_findings, public.ask_sends, public.assistant_log to authenticated;
grant select, update on public.client_asks, public.night_entries to authenticated;
grant select, insert, update on public.client_contacts, public.assistant_prefs, public.assistant_mail, public.night_runs, public.night_findings,
  public.client_asks, public.ask_sends, public.night_entries, public.assistant_log to service_role;
grant usage, select on sequence public.night_runs_id_seq, public.ask_sends_id_seq, public.assistant_log_id_seq to service_role;

-- ---------------------------------------------------------------- the owner's switch for real sending
create or replace function public.assistant_mail_set(p_real boolean, p_test_to text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm();
begin
  if f is null or not exists (select 1 from public.members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role = 'owner') then
    raise exception 'Only the firm''s owner can change this.' using errcode = '42501';
  end if;
  insert into public.assistant_mail (firm_id, real_send, test_to, set_by, set_at) values (f, p_real, coalesce(p_test_to, ''), auth.uid(), now())
    on conflict (firm_id) do update set real_send = excluded.real_send, test_to = excluded.test_to, set_by = excluded.set_by, set_at = excluded.set_at;
  insert into public.assistant_log (firm_id, client_id, what, evidence, by_user) values (f, '', 'setting', jsonb_build_object('real_send', p_real), auth.uid());
  return jsonb_build_object('real_send', p_real);
end $$;
revoke all on function public.assistant_mail_set(boolean, text) from public, anon;
grant execute on function public.assistant_mail_set(boolean, text) to authenticated;

-- The night timer (pg_cron + pg_net, as migration 168 calls gst-run): every 10 minutes from 20:30 to 23:50 UTC (02:00 to
-- 05:20 India time), a batch of clients not yet checked tonight, with the platform's cron key. Only where pg_cron, pg_net
-- and Vault are there. Kept OUT of this draft on purpose: added in the build round, after the function is deployed.

commit;
