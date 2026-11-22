-- Migration 206 (22-Nov-2026, branch next-assistant). Written and tested here (tests/run_migration206.py on pg_stand);
-- NOT run anywhere: the owner runs it on staging after the review. docs/ASSISTANT-PHASE1.md.
--
-- Daily Check, phase 1: the night's checks per client, the questions to clients, the entries FinCom prepares.
--   client_contacts      a client's own contacts (several, each with a name): email, WhatsApp, how questions go to each
--   assistant_prefs      per client: "remind by itself" (OFF by default; only the owner turns it on)
--   assistant_mail       per firm: real sending (OFF by default = test mode: every email to the firm's own address)
--   night_runs           one row a client a night (claimed by night_due, finished by night_apply)
--   night_findings       one row a finding, unique per (firm, client, kind, key): a second run the same night updates it,
--                        never adds one (acceptance rule 4). state: ask | you | resolved | cleared | dismissed
--   client_asks          one question a finding at most (unique finding_id): draft -> asked -> answered -> closed; a
--                        closed or answered question is never made again
--   ask_sends            each email or WhatsApp: to whom it was meant, where it really went (test mode), Resend's id
--   night_entries        entries FinCom prepared (unique per dedupe), with why, evidence and the checks they passed;
--                        "ready" only when every check passed, else "held"
--   assistant_log        every action (night, undo, choose, edit, close, answer, approve, reject, send, setting, contact)
-- Functions: night_due / night_apply / night_fail / night_missed and ask_send_begin / ask_send_finish (service role only:
-- the night and send functions), finding_undo, finding_choose, ask_edit, ask_close, ask_reopen, ask_answer, entry_decide
-- (owners and staff: can_write), ask_send_prepare, ask_whatsapp_opened, prefs_set, assistant_mail_set (the OWNER only).
-- Grants (review S1): every right Supabase gives anon and authenticated by default is taken back; then only what the page
-- reads and calls. The send log and the action log are not readable from the page.
-- Who: members of the firm read their firm's rows; nobody writes the questions, findings or entries directly (no write
-- policy): only through the functions above, each checked and logged. Contacts: owners and staff, logged by a trigger.
-- ADD-ONLY: new tables, their indexes, policies, grants (explicit) and new functions. No existing table, column, policy
-- or function is changed or dropped. Safe to run twice. One transaction, lock_timeout 10 s.
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
  removed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_contacts_client on public.client_contacts (firm_id, client_id) where removed_at is null;

create table if not exists public.assistant_prefs (
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  auto_reminders boolean not null default false,
  set_by uuid, set_at timestamptz not null default now(),
  primary key (firm_id, client_id)
);

create table if not exists public.assistant_mail (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  real_send boolean not null default false,
  test_to text not null default '' check (test_to = '' or test_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  test_whatsapp text not null default '' check (test_whatsapp ~ '^\+?[0-9 ]{0,20}$'),   -- WhatsApp in test mode opens to this
  set_by uuid, set_at timestamptz not null default now()
);

create table if not exists public.night_runs (
  id bigserial primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  night date not null,
  books_version text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'skipped', 'failed')),
  tries integer not null default 1,
  counts jsonb not null default '{}'::jsonb,
  why text not null default '',
  unique (firm_id, client_id, night)
);

create table if not exists public.night_findings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  kind text not null check (kind in ('advance_open', 'wrong_side', 'cash_big', 'round_sum', 'no_narration', 'expense_jump', 'suspense',
    'bank_no_bill', 'bank_month_missing', 'twob_not_in_books', 'sales_month_missing', 'salary_month_missing', 'salary_mismatch')),
  key text not null check (length(key) between 1 and 300),
  facts jsonb not null default '{}'::jsonb,
  state text not null default 'ask' check (state in ('ask', 'you', 'resolved', 'cleared', 'dismissed')),
  evidence jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  first_seen date not null,
  last_seen date not null,
  decided_by uuid, decided_at timestamptz,          -- a person chose (Needs you): the night keeps the choice
  undone_by uuid, undone_at timestamptz,            -- a person undid FinCom's answer: never resolved by itself again
  unique (firm_id, client_id, kind, key)
);
create index if not exists night_findings_client on public.night_findings (firm_id, client_id, state);

create table if not exists public.client_asks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  finding_id uuid not null references public.night_findings (id) on delete cascade,
  week date not null,
  text text not null check (length(text) between 1 and 1000),
  edited text check (edited is null or length(edited) between 1 and 1000),
  state text not null default 'draft' check (state in ('draft', 'asked', 'answered', 'closed')),
  answer text check (answer is null or length(answer) <= 2000),
  closed_by text check (closed_by in ('document', 'entry', 'person')),
  close_ref text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (finding_id)
);
create index if not exists client_asks_client on public.client_asks (firm_id, client_id, state, week);

create table if not exists public.ask_sends (
  id bigserial primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  meant_for text[] not null default '{}',
  sent_to text[] not null default '{}',
  test_mode boolean not null,
  ask_ids uuid[] not null default '{}',
  provider_id text,
  status text not null check (status in ('sending', 'sent', 'opened_link', 'failed', 'refused')),
  why text not null default '',
  sent_by uuid not null,
  sent_at timestamptz not null default now()
);
create index if not exists ask_sends_day on public.ask_sends (firm_id, sent_at desc);

create table if not exists public.night_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  finding_id uuid references public.night_findings (id) on delete set null,
  source text not null check (source in ('twob_inbox_bill', 'bank_self_answer')),
  dedupe text not null check (length(dedupe) between 1 and 300),
  work_ref text not null default '',
  voucher jsonb not null,
  reason text not null default '',
  why text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  state text not null default 'ready' check (state in ('ready', 'held', 'approved', 'rejected', 'withdrawn')),
  decided_by uuid, decided_at timestamptz,
  approved_once boolean not null default false,    -- approved at least once: undo stays refused while it may be in the books
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, client_id, dedupe)
);

create table if not exists public.assistant_log (
  id bigserial primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null default '',
  what text not null,
  ref text,
  evidence jsonb not null default '{}'::jsonb,
  by_user uuid,
  at timestamptz not null default now()
);
create index if not exists assistant_log_client on public.assistant_log (firm_id, client_id, at desc);

-- ---------------------------------------------------------------- row-level security: read your firm; contacts by policy
alter table public.client_contacts enable row level security;
alter table public.assistant_prefs enable row level security;
alter table public.assistant_mail enable row level security;
alter table public.night_runs enable row level security;
alter table public.night_findings enable row level security;
alter table public.client_asks enable row level security;
alter table public.ask_sends enable row level security;
alter table public.night_entries enable row level security;
alter table public.assistant_log enable row level security;
do $$
declare t text;
begin
  foreach t in array array['client_contacts', 'assistant_prefs', 'assistant_mail', 'night_runs', 'night_findings', 'client_asks', 'ask_sends', 'night_entries', 'assistant_log'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (firm_id = (select public.my_firm()))', t || '_read', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_contacts' and policyname = 'client_contacts_add') then
    create policy client_contacts_add on public.client_contacts for insert to authenticated with check (firm_id = (select public.my_firm()) and public.can_write());
    create policy client_contacts_change on public.client_contacts for update to authenticated using (firm_id = (select public.my_firm()) and public.can_write()) with check (firm_id = (select public.my_firm()));
  end if;
end $$;

-- review S1: Supabase gives anon and authenticated every right on a new table; all taken back, then only what the page
-- reads (and contacts, which owners and staff write under their policies). The send log and the action log are read by
-- nobody but the service role (and the console).
revoke all on public.client_contacts, public.assistant_prefs, public.assistant_mail, public.night_runs, public.night_findings,
  public.client_asks, public.ask_sends, public.night_entries, public.assistant_log from public, anon, authenticated;
grant select, insert, update on public.client_contacts to authenticated;
grant select on public.assistant_prefs, public.assistant_mail, public.night_runs, public.night_findings, public.client_asks, public.night_entries to authenticated;
revoke all on sequence public.night_runs_id_seq, public.ask_sends_id_seq, public.assistant_log_id_seq from public, anon, authenticated;
grant select, insert, update on public.client_contacts, public.assistant_prefs, public.assistant_mail, public.night_runs, public.night_findings,
  public.client_asks, public.ask_sends, public.night_entries, public.assistant_log to service_role;
grant usage, select on sequence public.night_runs_id_seq, public.ask_sends_id_seq, public.assistant_log_id_seq to service_role;

-- ---------------------------------------------------------------- helpers
create or replace function public.asst_is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'owner' and m.firm_id = public.my_firm())
$$;
create or replace function public.asst_log(p_firm uuid, p_client text, p_what text, p_ref text, p_ev jsonb) returns void language sql security definer set search_path = '' as $$
  insert into public.assistant_log (firm_id, client_id, what, ref, evidence, by_user) values (p_firm, coalesce(p_client, ''), p_what, p_ref, coalesce(p_ev, '{}'::jsonb), auth.uid())
$$;
create or replace function public.asst_hist(h jsonb, p_what text) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(h, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'what', left(p_what, 300)))
$$;
-- the Monday of a night's week (the weekly list)
create or replace function public.asst_week(d date) returns date language sql immutable set search_path = '' as $$ select d - (extract(isodow from d)::int - 1) $$;

-- contacts: every change logged
-- an address in the log, masked: the first 2 letters and the domain of an email, the last 4 digits of a number
create or replace function public.asst_mask(v text) returns text language sql immutable set search_path = '' as $$
  select case when coalesce(v, '') = '' then '' when position('@' in v) > 0 then left(v, 2) || '…@' || split_part(v, '@', 2)
              else '…' || right(regexp_replace(v, '\D', '', 'g'), 4) end
$$;
-- contacts: every change logged, with what changed (addresses masked)
create or replace function public.client_contacts_logged() returns trigger language plpgsql security definer set search_path = '' as $$
declare ch jsonb := '{}'::jsonb;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then ch := jsonb_build_object('added', true, 'email', public.asst_mask(new.email), 'whatsapp', public.asst_mask(new.whatsapp));
  else
    if new.email is distinct from old.email then ch := ch || jsonb_build_object('email', public.asst_mask(old.email) || ' → ' || public.asst_mask(new.email)); end if;
    if new.whatsapp is distinct from old.whatsapp then ch := ch || jsonb_build_object('whatsapp', public.asst_mask(old.whatsapp) || ' → ' || public.asst_mask(new.whatsapp)); end if;
    if new.name is distinct from old.name then ch := ch || jsonb_build_object('name', true); end if;
    if new.by_email is distinct from old.by_email or new.by_whatsapp is distinct from old.by_whatsapp then ch := ch || jsonb_build_object('send_by', true); end if;
    if new.removed_at is not null and old.removed_at is null then ch := ch || jsonb_build_object('removed', true); end if;
  end if;
  insert into public.assistant_log (firm_id, client_id, what, ref, evidence, by_user) values (new.firm_id, new.client_id, 'contact', new.id::text, ch || jsonb_build_object('name', left(new.name, 60)), auth.uid());
  return new;
end $$;
drop trigger if exists client_contacts_logged on public.client_contacts;   -- made again just below: the only drop here (a trigger of this migration)
create trigger client_contacts_logged before insert or update on public.client_contacts for each row execute function public.client_contacts_logged();

-- ---------------------------------------------------------------- the night (service role only)
-- the clients to check tonight (India date): no run yet, or a run stuck for 30 minutes, or failed (at most 3 tries);
-- each is claimed at once (running), so a timer that fires twice never checks a client twice. p_n null (the timer): as
-- many as tonight's window needs, the clients left spread over the ticks left until 05:20 India time (review: every
-- client every night), at most 20 a tick
create or replace function public.night_due(p_n integer default null) returns table (firm_id uuid, client_id text) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_night date := (now() at time zone 'Asia/Kolkata')::date; v_left int; v_ticks int; v_n int;
begin
  select count(*) into v_left from public.clients cl
   where not coalesce(cl.deleted, false) and coalesce(cl.status, 'active') = 'active'
     and exists (select 1 from public.tally_books b where b.firm_id = cl.firm_id and b.client_id = cl.id::text)
     and not exists (select 1 from public.night_runs r where r.firm_id = cl.firm_id and r.client_id = cl.id::text and r.night = v_night and r.status in ('ok', 'partial', 'skipped'));
  perform public.ask_send_sweep();
  v_ticks := greatest(1, ceil(extract(epoch from ((v_night + time '05:20') - (now() at time zone 'Asia/Kolkata'))) / 600.0)::int);
  v_n := coalesce(p_n, least(20, greatest(4, ceil(v_left::numeric / v_ticks)::int)));
  return query
  with c as (
    select cl.firm_id, cl.id::text as client_id from public.clients cl
     where not coalesce(cl.deleted, false) and coalesce(cl.status, 'active') = 'active'
       and exists (select 1 from public.tally_books b where b.firm_id = cl.firm_id and b.client_id = cl.id::text)
       and not exists (select 1 from public.night_runs r where r.firm_id = cl.firm_id and r.client_id = cl.id::text and r.night = v_night
                        and (r.status in ('ok', 'partial', 'skipped') or (r.status = 'running' and r.started_at > now() - interval '30 minutes') or r.tries >= 3))
     order by cl.firm_id, cl.id limit greatest(1, least(v_n, 20))),
  claim as (
    insert into public.night_runs as r (firm_id, client_id, night, status) select c.firm_id, c.client_id, v_night, 'running' from c
      on conflict (firm_id, client_id, night) do update set status = 'running', started_at = now(), tries = r.tries + 1
    returning r.firm_id, r.client_id)
  select claim.firm_id, claim.client_id from claim;
end $$;

-- after the window: every client with books not checked tonight gets a run row saying so, and one log line per firm
create or replace function public.night_missed() returns integer language plpgsql security definer set search_path = '' as $$
declare v_night date := (now() at time zone 'Asia/Kolkata')::date; n int := 0; r record;   -- run at 05:35 India time: tonight's date
begin
  for r in select cl.firm_id, cl.id::text as client_id from public.clients cl
            where not coalesce(cl.deleted, false) and coalesce(cl.status, 'active') = 'active'
              and exists (select 1 from public.tally_books b where b.firm_id = cl.firm_id and b.client_id = cl.id::text)
              and not exists (select 1 from public.night_runs x where x.firm_id = cl.firm_id and x.client_id = cl.id::text and x.night = v_night and x.status in ('ok', 'partial', 'skipped')) loop
    insert into public.night_runs as x (firm_id, client_id, night, status, why, finished_at) values (r.firm_id, r.client_id, v_night, 'failed', 'not reached tonight', now())
      on conflict (firm_id, client_id, night) do update set status = 'failed', why = case when x.why = '' then 'not reached tonight' else x.why end, finished_at = now();
    n := n + 1;
  end loop;
  insert into public.assistant_log (firm_id, client_id, what, ref, evidence)
    select x.firm_id, '', 'night_missed', v_night::text, jsonb_build_object('clients', count(*), 'which', jsonb_agg(x.client_id)) from public.night_runs x
     where x.night = v_night and x.status = 'failed' group by x.firm_id;
  return n;
end $$;

-- one client's night: findings, questions, entries, the run, all at once and safe to repeat (rule 4)
create or replace function public.night_apply(p_firm uuid, p_client text, p_night date, p_version text, p_findings jsonb, p_entries jsonb, p_complete boolean, p_why text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  f jsonb; e jsonb; cur public.night_findings; fid uuid; st text; ev jsonb; seen text[] := '{}'; eseen text[] := '{}';
  q public.client_asks; wk date := public.asst_week(p_night); c_new int := 0; c_asks int := 0; c_closed int := 0; c_res int := 0; c_you int := 0; c_ent int := 0; c_clear int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('night|' || p_firm::text || '|' || p_client));
  insert into public.night_runs as r (firm_id, client_id, night, books_version, status) values (p_firm, p_client, p_night, coalesce(p_version, ''), 'running')
    on conflict (firm_id, client_id, night) do update set books_version = excluded.books_version;
  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    seen := seen || ((f->>'kind') || '|' || (f->>'key'));
    st := f->>'state'; ev := case when st = 'resolved' then coalesce(f->'evidence', '[]'::jsonb) else '[]'::jsonb end;
    cur := null;
    select * into cur from public.night_findings x where x.firm_id = p_firm and x.client_id = p_client and x.kind = f->>'kind' and x.key = f->>'key';
    if cur.id is not null then
      if cur.decided_by is not null or cur.state = 'dismissed' then st := cur.state; ev := cur.evidence;      -- a person's choice stays
      elsif cur.undone_at is not null and st = 'resolved' then                                               -- undone or rejected: never resolved again
        st := case when cur.state = 'you' then 'you' else 'ask' end; ev := '[]'::jsonb; end if;
      update public.night_findings set facts = coalesce(f->'facts', '{}'::jsonb), state = st, evidence = ev,
        candidates = case when st = 'you' and cur.decided_by is null then coalesce(f->'candidates', '[]'::jsonb) else candidates end, last_seen = greatest(last_seen, p_night)
       where id = cur.id;
      fid := cur.id;
    else
      insert into public.night_findings (firm_id, client_id, kind, key, facts, state, evidence, candidates, first_seen, last_seen)
        values (p_firm, p_client, f->>'kind', f->>'key', coalesce(f->'facts', '{}'::jsonb), st, ev, case when st = 'you' then coalesce(f->'candidates', '[]'::jsonb) else '[]'::jsonb end, p_night, p_night)
        returning id into fid;
      c_new := c_new + 1;
    end if;
    if st = 'resolved' then c_res := c_res + 1; elsif st = 'you' then c_you := c_you + 1; end if;
    select * into q from public.client_asks a where a.finding_id = fid;
    if st = 'ask' and q.id is null and coalesce(f->'facts'->>'ask_text', '') <> '' then
      -- a new question; one a finding, ever: a closed or answered one is never made again (unique finding_id)
      insert into public.client_asks (firm_id, client_id, finding_id, week, text, history)
        values (p_firm, p_client, fid, wk, f->'facts'->>'ask_text', public.asst_hist(null, 'Found by the night check')) on conflict (finding_id) do nothing;
      c_asks := c_asks + 1;
    elsif st = 'ask' and q.id is not null and q.state = 'closed' and q.closed_by in ('document', 'entry') and cur.id is not null and cur.state = 'resolved' then
      -- FinCom's answer is gone (the document or entry went): asked again, as a new Draft on this week's list
      update public.client_asks set state = 'draft', closed_by = null, close_ref = null, week = wk, history = public.asst_hist(history, 'Asked again: FinCom''s answer is no longer there') where id = q.id;
      c_asks := c_asks + 1;
    elsif st = 'resolved' and q.id is not null and q.state <> 'closed' then
      -- closes by itself: the document came, or the entry is in the books
      update public.client_asks set state = 'closed',
        closed_by = case when exists (select 1 from jsonb_array_elements(ev) x where x->>'t' in ('doc', 'twob', 'challan', 'salary')) then 'document' else 'entry' end,
        close_ref = ev->0->>'ref', history = public.asst_hist(history, 'Closed: ' || coalesce(ev->0->>'label', 'answered'))
       where id = q.id;
      c_closed := c_closed + 1;
    end if;
  end loop;
  if p_complete then
    -- what is no longer found (the books were put right): cleared, its open question closed
    for cur in select * from public.night_findings x where x.firm_id = p_firm and x.client_id = p_client and x.state in ('ask', 'you') and x.decided_by is null
                and not ((x.kind || '|' || x.key) = any (seen)) loop
      update public.night_findings set state = 'cleared' where id = cur.id;
      update public.client_asks set state = 'closed', closed_by = 'entry', history = public.asst_hist(history, 'Closed: no longer found in the books')
       where finding_id = cur.id and state in ('draft', 'asked');
      c_clear := c_clear + 1;
    end loop;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    eseen := eseen || (e->>'dedupe');
    select x.id into fid from public.night_findings x where x.firm_id = p_firm and x.client_id = p_client and (x.kind || '|' || x.key) = e->>'finding_key';
    -- only for a finding still resolved by FinCom (an undone one makes none)
    if fid is null or not exists (select 1 from public.night_findings x where x.id = fid and x.state = 'resolved' and x.undone_at is null) then continue; end if;
    insert into public.night_entries as n (firm_id, client_id, finding_id, source, dedupe, work_ref, voucher, reason, why, evidence, checks, state)
      values (p_firm, p_client, fid, e->>'source', e->>'dedupe', coalesce(e->>'work_ref', ''), coalesce(e->'voucher', '{}'::jsonb), coalesce(e->>'reason', ''), coalesce(e->>'why', ''),
              coalesce(e->'evidence', '[]'::jsonb), coalesce(e->'checks', '[]'::jsonb), case when (e->>'ready')::boolean then 'ready' else 'held' end)
      on conflict (firm_id, client_id, dedupe) do update set voucher = excluded.voucher, reason = excluded.reason, why = excluded.why, evidence = excluded.evidence, checks = excluded.checks,
        state = excluded.state, finding_id = excluded.finding_id, work_ref = excluded.work_ref, updated_at = now()
       where n.state in ('ready', 'held', 'withdrawn') and n.decided_by is null;
    c_ent := c_ent + 1;
  end loop;
  if p_complete then
    update public.night_entries set state = 'withdrawn', updated_at = now()
     where firm_id = p_firm and client_id = p_client and state in ('ready', 'held') and not (dedupe = any (eseen));
    -- an approval the books and FinCom do not show (the night made the same entry again: its bill is still not approved, its
    -- bank line still has no ledger) more than 30 minutes after it was recorded: put back as ready, logged
    for e in select jsonb_build_object('id', n.id, 'dedupe', n.dedupe) from public.night_entries n
              where n.firm_id = p_firm and n.client_id = p_client and n.state = 'approved' and n.dedupe = any (eseen) and n.decided_at < now() - interval '30 minutes' loop
      update public.night_entries set state = 'ready', decided_by = null, decided_at = null, updated_at = now() where id = (e->>'id')::uuid;
      insert into public.assistant_log (firm_id, client_id, what, ref, evidence) values (p_firm, p_client, 'approval_not_found', e->>'id', e);
    end loop;
  end if;
  update public.night_runs set finished_at = now(), status = case when p_complete then 'ok' else 'partial' end, why = left(coalesce(p_why, ''), 500),
    counts = jsonb_build_object('findings', jsonb_array_length(coalesce(p_findings, '[]'::jsonb)), 'new', c_new, 'asks', c_asks, 'closed', c_closed, 'resolved', c_res, 'you', c_you, 'entries', c_ent, 'cleared', c_clear)
   where firm_id = p_firm and client_id = p_client and night = p_night;
  insert into public.assistant_log (firm_id, client_id, what, ref, evidence) values (p_firm, p_client, 'night', p_night::text,
    jsonb_build_object('new', c_new, 'asks', c_asks, 'closed', c_closed, 'resolved', c_res, 'you', c_you, 'entries', c_ent, 'cleared', c_clear, 'version', p_version));
  return jsonb_build_object('new', c_new, 'asks', c_asks, 'closed', c_closed, 'resolved', c_res, 'you', c_you, 'entries', c_ent, 'cleared', c_clear);
end $$;

-- a run that could not be done (no books, the console's switch off, an error): kept with why
create or replace function public.night_fail(p_firm uuid, p_client text, p_night date, p_status text, p_why text) returns void language sql security definer set search_path = '' as $$
  insert into public.night_runs as r (firm_id, client_id, night, status, why, finished_at) values (p_firm, p_client, p_night, case when p_status = 'skipped' then 'skipped' else 'failed' end, left(coalesce(p_why, ''), 500), now())
    on conflict (firm_id, client_id, night) do update set status = excluded.status, why = excluded.why, finished_at = now()
$$;

-- ---------------------------------------------------------------- what people do on the page (owners and staff)
create or replace function public.asst_finding(p_id uuid) returns public.night_findings language plpgsql stable security definer set search_path = '' as $$
declare r public.night_findings;
begin
  select * into r from public.night_findings where id = p_id and firm_id = public.my_firm();
  if r.id is null or not public.can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return r;
end $$;

-- Undo FinCom's answer: back as a question (Draft), never resolved by itself again; its prepared entry withdrawn
create or replace function public.finding_undo(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.night_findings := public.asst_finding(p_id);
begin
  if r.state <> 'resolved' then raise exception 'Only something FinCom answered can be undone.' using errcode = '22023'; end if;
  -- approved, or approved once and no longer made by the night (its bill approved, its line set: in the books or on the way)
  if exists (select 1 from public.night_entries n where n.finding_id = r.id and (n.state = 'approved' or (n.approved_once and n.state = 'withdrawn'))) then
    raise exception 'Its entry was approved. Undo it where it was approved (Purchase or Bank).' using errcode = '22023';
  end if;
  update public.night_findings set state = 'ask', evidence = '[]'::jsonb, undone_by = auth.uid(), undone_at = now(), decided_by = null, decided_at = null where id = r.id;
  insert into public.client_asks as a (firm_id, client_id, finding_id, week, text, history)
    values (r.firm_id, r.client_id, r.id, public.asst_week((now() at time zone 'Asia/Kolkata')::date), coalesce(nullif(r.facts->>'ask_text', ''), 'Please tell us about this entry.'), public.asst_hist(null, 'Undone: FinCom''s answer put back as a question'))
    on conflict (finding_id) do update set state = 'draft', closed_by = null, close_ref = null, history = public.asst_hist(a.history, 'Undone: asked again')
    where a.state = 'closed' and a.closed_by in ('document', 'entry');
  update public.night_entries set state = 'withdrawn', updated_at = now() where finding_id = r.id and state in ('ready', 'held');
  perform public.asst_log(r.firm_id, r.client_id, 'undo', r.id::text, jsonb_build_object('kind', r.kind, 'key', r.key, 'evidence', r.evidence));
  return jsonb_build_object('ok', true);
end $$;

-- Needs you: the person picks one of the candidates (p_ref), or asks the client ("ask"), or says it is nothing ("dismiss")
create or replace function public.finding_choose(p_id uuid, p_ref text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.night_findings := public.asst_finding(p_id); c jsonb;
begin
  if r.state <> 'you' then raise exception 'This is not waiting for you.' using errcode = '22023'; end if;
  if p_ref = 'ask' then
    update public.night_findings set state = 'ask', decided_by = auth.uid(), decided_at = now() where id = r.id;
    insert into public.client_asks (firm_id, client_id, finding_id, week, text, history)
      values (r.firm_id, r.client_id, r.id, public.asst_week((now() at time zone 'Asia/Kolkata')::date), coalesce(nullif(r.facts->>'ask_text', ''), 'Please tell us about this entry.'), public.asst_hist(null, 'To ask: chosen by a person'))
      on conflict (finding_id) do nothing;
  elsif p_ref = 'dismiss' then
    update public.night_findings set state = 'dismissed', decided_by = auth.uid(), decided_at = now() where id = r.id;
  else
    select x into c from jsonb_array_elements(r.candidates) x where x->>'ref' = p_ref;
    if c is null then raise exception 'That choice is not one of the candidates.' using errcode = '22023'; end if;
    if exists (select 1 from public.night_findings o, jsonb_array_elements(o.evidence) ev
                where o.firm_id = r.firm_id and o.client_id = r.client_id and o.id <> r.id and o.state = 'resolved' and o.undone_at is null and ev->>'ref' = p_ref) then
      raise exception 'That one is already used for another item.' using errcode = '22023';
    end if;
    update public.night_findings set state = 'resolved', evidence = jsonb_build_array(c), decided_by = auth.uid(), decided_at = now() where id = r.id;
  end if;
  perform public.asst_log(r.firm_id, r.client_id, 'choose', r.id::text, jsonb_build_object('kind', r.kind, 'choice', p_ref, 'candidate', c));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.asst_ask(p_id uuid) returns public.client_asks language plpgsql stable security definer set search_path = '' as $$
declare r public.client_asks;
begin
  select * into r from public.client_asks where id = p_id and firm_id = public.my_firm();
  if r.id is null or not public.can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return r;
end $$;
create or replace function public.ask_edit(p_id uuid, p_text text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.client_asks := public.asst_ask(p_id); t text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if r.state not in ('draft', 'asked') then raise exception 'Only a question not answered yet can be changed.' using errcode = '22023'; end if;
  if t is null or length(t) > 1000 then raise exception 'Type the question (up to 1,000 letters).' using errcode = '22023'; end if;
  update public.client_asks set edited = case when t = text then null else t end, history = public.asst_hist(history, 'Edited') where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'edit', r.id::text, jsonb_build_object('from', coalesce(r.edited, r.text), 'to', t));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.ask_close(p_id uuid, p_why text default '') returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.client_asks := public.asst_ask(p_id);
begin
  if r.state = 'closed' then return jsonb_build_object('ok', true); end if;
  update public.client_asks set state = 'closed', closed_by = 'person', history = public.asst_hist(history, 'Closed' || case when coalesce(p_why, '') <> '' then ': ' || left(p_why, 200) else '' end) where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'close', r.id::text, jsonb_build_object('why', p_why));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.ask_reopen(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.client_asks := public.asst_ask(p_id);
begin
  if r.state <> 'closed' then raise exception 'Only a closed question can be opened again.' using errcode = '22023'; end if;
  update public.client_asks set state = 'draft', closed_by = null, close_ref = null, history = public.asst_hist(history, 'Opened again') where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'reopen', r.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.ask_answer(p_id uuid, p_text text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.client_asks := public.asst_ask(p_id); t text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if r.state not in ('asked', 'draft') then raise exception 'This question is answered or closed already.' using errcode = '22023'; end if;
  if t is null or length(t) > 2000 then raise exception 'Type the reply (up to 2,000 letters).' using errcode = '22023'; end if;
  update public.client_asks set state = 'answered', answer = t, history = public.asst_hist(history, 'Reply: ' || left(t, 200)) where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'answer', r.id::text, jsonb_build_object('reply', left(t, 200)));
  return jsonb_build_object('ok', true);
end $$;

-- An entry approved or rejected. The page first does the EXISTING approval (the bill's in Purchase, the bank line's in
-- Bank), which puts it on the Post page; this records the decision with what it became (p_work_ref)
create or replace function public.entry_decide(p_id uuid, p_decision text, p_work_ref text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.night_entries;
begin
  select * into r from public.night_entries where id = p_id and firm_id = public.my_firm();
  if r.id is null or not public.can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Approve or reject.' using errcode = '22023'; end if;
  if r.state <> 'ready' and not (r.state = 'held' and p_decision = 'rejected') then raise exception 'This entry is not ready.' using errcode = '22023'; end if;
  update public.night_entries set state = p_decision, decided_by = auth.uid(), decided_at = now(), work_ref = coalesce(nullif(p_work_ref, ''), work_ref), updated_at = now(),
    approved_once = approved_once or p_decision = 'approved' where id = r.id;
  if p_decision = 'rejected' and r.finding_id is not null then
    update public.night_findings set state = 'you', candidates = evidence, evidence = '[]'::jsonb, undone_by = auth.uid(), undone_at = now() where id = r.finding_id and state = 'resolved';
    update public.client_asks set state = 'draft', closed_by = null, close_ref = null, history = public.asst_hist(history, 'Asked again: FinCom''s entry was rejected')
     where finding_id = r.finding_id and state = 'closed' and closed_by in ('document', 'entry');
  end if;
  perform public.asst_log(r.firm_id, r.client_id, p_decision, r.id::text, jsonb_build_object('source', r.source, 'work', coalesce(nullif(p_work_ref, ''), r.work_ref), 'voucher', r.voucher, 'evidence', r.evidence));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- sending (the firm's OWNER only)
-- What may go: only questions still needed from the client (the finding is "ask", the question Draft or Asked): a
-- resolved finding or a closed question can never get into a message (acceptance rule 6). The addresses come from
-- client_contacts, never from the caller. Limits: 1 real email a client a day, 50 a firm a day; 20 test emails a day.
create or replace function public.ask_send_prepare(p_client text, p_ids uuid[], p_channel text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := public.my_firm(); m public.assistant_mail; qs jsonb; ct jsonb; real_today int; firm_today int; test_today int;
begin
  if f is null or not public.asst_is_owner() then raise exception 'Only the firm''s owner sends questions.' using errcode = '42501'; end if;
  if p_channel not in ('email', 'whatsapp') then raise exception 'Email or WhatsApp.' using errcode = '22023'; end if;
  select * into m from public.assistant_mail where firm_id = f;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'text', coalesce(a.edited, a.text), 'state', a.state) order by a.created_at), '[]'::jsonb) into qs
    from public.client_asks a join public.night_findings n on n.id = a.finding_id
   where a.firm_id = f and a.client_id = p_client and a.id = any (coalesce(p_ids, '{}')) and a.state in ('draft', 'asked') and n.state = 'ask';
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'email', case when c.by_email then c.email else '' end, 'whatsapp', case when c.by_whatsapp then c.whatsapp else '' end) order by c.created_at), '[]'::jsonb) into ct
    from public.client_contacts c where c.firm_id = f and c.client_id = p_client and c.removed_at is null;
  select count(*) filter (where s.client_id = p_client and not s.test_mode), count(*) filter (where not s.test_mode), count(*) filter (where s.test_mode)
    into real_today, firm_today, test_today
    from public.ask_sends s where s.firm_id = f and s.channel = 'email' and s.status = 'sent' and s.sent_at > now() - interval '24 hours';
  return jsonb_build_object('firm_id', f, 'by', auth.uid(), 'questions', qs, 'contacts', ct, 'real_send', coalesce(m.real_send, false), 'test_to', coalesce(m.test_to, ''), 'test_whatsapp', coalesce(m.test_whatsapp, ''),
    'client', (select to_jsonb(cl)->>'name' from public.clients cl where cl.firm_id = f and cl.id::text = p_client),
    'firm', (select to_jsonb(fi)->>'name' from public.firms fi where fi.id = f), 'real_today', real_today, 'firm_today', firm_today, 'test_today', test_today);
end $$;
-- review: the send log cannot be written by hand. The send function (service role) claims a send first: the firm's lock,
-- the day's limits counted with the claim itself (atomic), a row "sending"; then finishes it with what Resend said. Only a
-- real send that went marks the questions Asked; a test never does.
-- a claim still "sending" after 10 minutes (the function stopped half way): failed, logged
create or replace function public.ask_send_sweep() returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with x as (update public.ask_sends set status = 'failed', why = 'no answer from the send function in 10 minutes' where status = 'sending' and sent_at < now() - interval '10 minutes' returning firm_id, client_id, id)
  insert into public.assistant_log (firm_id, client_id, what, ref, evidence) select firm_id, client_id, 'send_stale', id::text, '{}'::jsonb from x;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.ask_send_begin(p_firm uuid, p_by uuid, p_client text, p_ids uuid[], p_channel text, p_meant text[], p_sent_to text[], p_test boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare n_client int; n_firm int; n_test int; v bigint;
begin
  if not exists (select 1 from public.members m where m.user_id = p_by and m.firm_id = p_firm and m.active and m.role = 'owner') then
    raise exception 'Only the firm''s owner sends questions.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('send|' || p_firm::text));
  perform public.ask_send_sweep();
  select count(*) filter (where s.client_id = p_client and not s.test_mode), count(*) filter (where not s.test_mode), count(*) filter (where s.test_mode)
    into n_client, n_firm, n_test
    from public.ask_sends s where s.firm_id = p_firm and s.channel = 'email' and s.status in ('sending', 'sent') and s.sent_at > now() - interval '24 hours';
  if p_channel = 'email' and not coalesce(p_test, true) and (n_client >= 1 or n_firm >= 50) then raise exception 'Already emailed this client today. Try tomorrow.' using errcode = '22023'; end if;
  if p_channel = 'email' and coalesce(p_test, true) and n_test >= 20 then raise exception '20 test emails today already. Try tomorrow.' using errcode = '22023'; end if;
  insert into public.ask_sends (firm_id, client_id, channel, meant_for, sent_to, test_mode, ask_ids, status, sent_by)
    values (p_firm, p_client, p_channel, coalesce(p_meant, '{}'), coalesce(p_sent_to, '{}'), coalesce(p_test, true), coalesce(p_ids, '{}'), 'sending', p_by) returning id into v;
  return v;
end $$;
create or replace function public.ask_send_finish(p_send bigint, p_status text, p_provider text, p_why text default '') returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.ask_sends; n int := 0;
begin
  select * into s from public.ask_sends where id = p_send and status = 'sending' for update;
  if s.id is null then raise exception 'No such send.' using errcode = '22023'; end if;
  if p_status not in ('sent', 'failed', 'refused') then raise exception 'Bad status.' using errcode = '22023'; end if;
  update public.ask_sends set status = p_status, provider_id = p_provider, why = left(coalesce(p_why, ''), 500) where id = s.id;
  if p_status = 'sent' then
    update public.client_asks a set state = case when s.test_mode then a.state else 'asked' end,
      history = public.asst_hist(a.history, case when s.test_mode then 'Test email to the firm' else 'Emailed to ' || array_to_string(s.sent_to, ', ') end)
     where a.firm_id = s.firm_id and a.client_id = s.client_id and a.id = any (s.ask_ids) and a.state in ('draft', 'asked')
       and exists (select 1 from public.night_findings x where x.id = a.finding_id and x.state = 'ask');
    get diagnostics n = row_count;
  end if;
  insert into public.assistant_log (firm_id, client_id, what, ref, evidence, by_user) values (s.firm_id, s.client_id, 'send', s.id::text,
    jsonb_build_object('channel', s.channel, 'test', s.test_mode, 'status', p_status, 'questions', n, 'to', s.sent_to, 'meant', s.meant_for, 'why', p_why), s.sent_by);
  return jsonb_build_object('ok', true, 'marked', n);
end $$;
-- WhatsApp: the owner opened the link here. The server decides what it was: a test unless the firm sends for real AND the
-- number is one of the client's own contacts; only then are the questions marked Asked
create or replace function public.ask_whatsapp_opened(p_client text, p_ids uuid[], p_to text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); real boolean; to_d text := regexp_replace(coalesce(p_to, ''), '\D', '', 'g'); n int := 0;
begin
  if f is null or not public.asst_is_owner() then raise exception 'Only the firm''s owner sends questions.' using errcode = '42501'; end if;
  real := coalesce((select m.real_send from public.assistant_mail m where m.firm_id = f), false)
      and exists (select 1 from public.client_contacts c where c.firm_id = f and c.client_id = p_client and c.removed_at is null and c.by_whatsapp
                   and length(to_d) >= 10 and right(regexp_replace(c.whatsapp, '\D', '', 'g'), 10) = right(to_d, 10));
  insert into public.ask_sends (firm_id, client_id, channel, meant_for, sent_to, test_mode, ask_ids, status, sent_by)
    values (f, p_client, 'whatsapp', '{}', array[public.asst_mask(p_to)], not real, coalesce(p_ids, '{}'), 'opened_link', auth.uid());
  update public.client_asks a set state = case when real then 'asked' else a.state end,
    history = public.asst_hist(a.history, case when real then 'WhatsApp to ' || public.asst_mask(p_to) else 'Test WhatsApp to the firm' end)
   where a.firm_id = f and a.client_id = p_client and a.id = any (coalesce(p_ids, '{}')) and a.state in ('draft', 'asked')
     and exists (select 1 from public.night_findings x where x.id = a.finding_id and x.state = 'ask');
  get diagnostics n = row_count;
  perform public.asst_log(f, p_client, 'send', 'whatsapp', jsonb_build_object('test', not real, 'to', public.asst_mask(p_to), 'questions', n));
  return jsonb_build_object('ok', true, 'test', not real);
end $$;

create or replace function public.prefs_set(p_client text, p_auto boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm();
begin
  if f is null or not public.asst_is_owner() then raise exception 'Only the firm''s owner can change this.' using errcode = '42501'; end if;
  insert into public.assistant_prefs (firm_id, client_id, auto_reminders, set_by, set_at) values (f, p_client, coalesce(p_auto, false), auth.uid(), now())
    on conflict (firm_id, client_id) do update set auto_reminders = excluded.auto_reminders, set_by = excluded.set_by, set_at = excluded.set_at;
  perform public.asst_log(f, p_client, 'setting', 'auto_reminders', jsonb_build_object('on', p_auto));
  return jsonb_build_object('auto_reminders', coalesce(p_auto, false));
end $$;

create or replace function public.assistant_mail_set(p_real boolean, p_test_to text default '', p_test_whatsapp text default '') returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm();
begin
  if f is null or not public.asst_is_owner() then raise exception 'Only the firm''s owner can change this.' using errcode = '42501'; end if;
  -- the test address is the firm's own: exactly an active member's email (never a client's, never just the same domain)
  if coalesce(p_test_to, '') <> '' and not exists (select 1 from public.members m join auth.users u on u.id = m.user_id
       where m.firm_id = f and m.active and lower(u.email) = lower(btrim(p_test_to))) then
    raise exception 'The test address must be a member''s own email.' using errcode = '22023';
  end if;
  insert into public.assistant_mail (firm_id, real_send, test_to, test_whatsapp, set_by, set_at) values (f, coalesce(p_real, false), coalesce(p_test_to, ''), coalesce(p_test_whatsapp, ''), auth.uid(), now())
    on conflict (firm_id) do update set real_send = excluded.real_send, test_to = excluded.test_to, test_whatsapp = excluded.test_whatsapp, set_by = excluded.set_by, set_at = excluded.set_at;
  perform public.asst_log(f, '', 'setting', 'real_send', jsonb_build_object('real_send', p_real, 'test_to', p_test_to <> '', 'test_whatsapp', p_test_whatsapp <> ''));
  return jsonb_build_object('real_send', coalesce(p_real, false));
end $$;

-- ---------------------------------------------------------------- function grants (explicit; review S1)
-- Supabase lets anon and authenticated run every new function: all taken back, then given only to who calls it
revoke all on function public.asst_is_owner(), public.asst_log(uuid, text, text, text, jsonb), public.asst_hist(jsonb, text), public.asst_week(date), public.asst_mask(text),
  public.client_contacts_logged(), public.night_due(integer), public.night_missed(), public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text), public.night_fail(uuid, text, date, text, text),
  public.asst_finding(uuid), public.asst_ask(uuid), public.finding_undo(uuid), public.finding_choose(uuid, text), public.ask_edit(uuid, text), public.ask_close(uuid, text),
  public.ask_reopen(uuid), public.ask_answer(uuid, text), public.entry_decide(uuid, text, text), public.ask_send_prepare(text, uuid[], text),
  public.ask_send_begin(uuid, uuid, text, uuid[], text, text[], text[], boolean), public.ask_send_finish(bigint, text, text, text), public.ask_whatsapp_opened(text, uuid[], text),
  public.prefs_set(text, boolean), public.assistant_mail_set(boolean, text, text), public.ask_send_sweep() from public, anon, authenticated;
grant execute on function public.night_due(integer), public.night_missed(), public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text), public.night_fail(uuid, text, date, text, text),
  public.ask_send_begin(uuid, uuid, text, uuid[], text, text[], text[], boolean), public.ask_send_finish(bigint, text, text, text), public.ask_send_sweep() to service_role;
grant execute on function public.finding_undo(uuid), public.finding_choose(uuid, text), public.ask_edit(uuid, text), public.ask_close(uuid, text), public.ask_reopen(uuid),
  public.ask_answer(uuid, text), public.entry_decide(uuid, text, text), public.ask_send_prepare(text, uuid[], text), public.ask_whatsapp_opened(text, uuid[], text),
  public.prefs_set(text, boolean), public.assistant_mail_set(boolean, text, text) to authenticated;

commit;
