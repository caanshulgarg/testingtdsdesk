-- Migration 208 (22-Nov-2026, branch next-daily-p2). A DRAFT: written and tested here (tests/run_migration208.py on
-- pg_stand, after 206 and 207); NOT run anywhere. The owner runs it on staging after the review. docs/DAILY-CHECK-PHASE2.md.
--
-- Daily Check, phase 2: FinCom prepares the GST set-off, payroll and monthly journals and the salary payments itself
-- (server/_shared/dailyjournals.js); each is an entry on the existing Entries tab, approved through the existing path.
--   night_findings.kind     may also be setoff_due, payroll_due, recurring_due, ledger_pick (its check widened by name)
--   night_entries.source    may also be gst_setoff, payroll, recurring (its check widened by name)
--   daily_trust             per client and kind of action: the trust level (0 asks first, the default; 1 done then told;
--                           2 done quietly) and the owner's limit ("never above this alone"); kind '*' = the client's limit.
--                           Phase 2 builds the levels, the settings and the suggestions only: every entry still waits for
--                           Approve (decision D1)
--   trust_set / trust_dismiss   the OWNER sets a level or a limit, or puts a suggestion off (logged)
--   trust_stats             per client and kind: approvals since the last rejection, level change or put-off (the page's
--                           promotion suggestion after 20)
--   entry_claim / entry_release / entry_approved   (review M3) Approve of a journal claims the entry first (ready ->
--                           approving, atomically, one person at a time), posts through the existing path, then records it
--                           approved, or releases the claim if the post failed; a claim left 30 minutes may be taken again
--   remind_due / remind_logged  "Remind by itself" (assistant-night's timer, service role only): document requests asked
--                           once and still needed, at most weekly; each logged
-- Grants: every right Supabase gives anon and authenticated by default is taken back (public too); then only what the page
-- reads and calls. ADD-ONLY: one new table, its policy and grants, new functions, three check constraints widened (each
-- dropped and made again with more values, by name, only if it is 206's). No row is changed; nothing of 206 or 207 is
-- replaced. Safe to run twice. One transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

-- 206 and 207 first; then the names: every table and function this migration makes must be absent or be its own (marked
-- by its comment). Anything else of the same name stops the migration here, naming it.
do $names$
declare t text; f text; bad text[] := '{}';
begin
  if to_regprocedure('public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text)') is null
     or coalesce(obj_description(to_regprocedure('public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text)'), 'pg_proc'), '') <> 'daily check (migration 206)' then
    raise exception 'migration 208: run migrations 206 and 207 first (night_apply is not Daily Check''s)';
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.client_asks'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%fincom%') then
    raise exception 'migration 208: run migration 207 first';
  end if;
  foreach t in array array['daily_trust'] loop
    if to_regclass('public.' || t) is not null and coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> 'daily check (migration 208)' then bad := bad || ('table ' || t); end if;
  end loop;
  foreach f in array array['trust_set', 'trust_dismiss', 'trust_stats', 'trust_kind_of', 'remind_due', 'remind_logged', 'entry_claim', 'entry_release', 'entry_approved'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'daily check (migration 208)') then bad := bad || ('function ' || f); end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 208: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- ---------------------------------------------------------------- the two checks widened (by name; only 206's own)
do $c$
declare n text;
begin
  select c.conname into n from pg_constraint c where c.conrelid = 'public.night_findings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%advance_open%';
  if n is null then raise exception 'migration 208: night_findings has no kind check'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.night_findings'::regclass and conname = n)) not like '%setoff_due%' then
    execute format('alter table public.night_findings drop constraint %I', n);
    alter table public.night_findings add constraint night_findings_kind_check check (kind in ('advance_open', 'wrong_side', 'cash_big', 'round_sum', 'no_narration', 'expense_jump', 'suspense',
      'bank_no_bill', 'bank_month_missing', 'twob_not_in_books', 'sales_month_missing', 'salary_month_missing', 'salary_mismatch',
      'setoff_due', 'payroll_due', 'recurring_due', 'ledger_pick'));
  end if;
  n := null;
  select c.conname into n from pg_constraint c where c.conrelid = 'public.night_entries'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%twob_inbox_bill%';
  if n is null then raise exception 'migration 208: night_entries has no source check'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.night_entries'::regclass and conname = n)) not like '%gst_setoff%' then
    execute format('alter table public.night_entries drop constraint %I', n);
    alter table public.night_entries add constraint night_entries_source_check check (source in ('twob_inbox_bill', 'bank_self_answer', 'gst_setoff', 'payroll', 'recurring'));
  end if;
  n := null;
  select c.conname into n from pg_constraint c where c.conrelid = 'public.night_entries'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%withdrawn%';
  if n is null then raise exception 'migration 208: night_entries has no state check'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.night_entries'::regclass and conname = n)) not like '%approving%' then
    execute format('alter table public.night_entries drop constraint %I', n);
    alter table public.night_entries add constraint night_entries_state_check check (state in ('ready', 'held', 'approved', 'rejected', 'withdrawn', 'approving'));
  end if;
end $c$;

-- ---------------------------------------------------------------- the trust levels
create table if not exists public.daily_trust (
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  kind text not null check (kind in ('bank', 'recurring', 'payroll', 'setoff', 'new_ledger', '*')),
  level smallint not null default 0 check (level between 0 and 2),
  limit_amt numeric(14, 2) not null default 0 check (limit_amt >= 0),
  dismissed_at timestamptz,                 -- the owner put the promotion suggestion off: asked again after 20 more
  set_by uuid, set_at timestamptz not null default now(),
  primary key (firm_id, client_id, kind)
);
alter table public.daily_trust enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_trust' and policyname = 'daily_trust_read') then
    create policy daily_trust_read on public.daily_trust for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
revoke all on public.daily_trust from public, anon, authenticated;
grant select on public.daily_trust to authenticated;
grant select, insert, update on public.daily_trust to service_role;

-- an entry's source as a kind of action
create or replace function public.trust_kind_of(p_source text) returns text language sql immutable set search_path = '' as $$
  select case p_source when 'bank_self_answer' then 'bank' when 'recurring' then 'recurring' when 'payroll' then 'payroll' when 'gst_setoff' then 'setoff' else '' end
$$;

-- the owner sets a client's level for a kind (or the client's limit: kind '*', level 0). Every change logged
create or replace function public.trust_set(p_client text, p_kind text, p_level integer, p_limit numeric default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); was public.daily_trust;
begin
  if f is null or not public.asst_is_owner() then raise exception 'Only the firm''s owner can change this.' using errcode = '42501'; end if;
  if p_kind not in ('bank', 'recurring', 'payroll', 'setoff', 'new_ledger', '*') then raise exception 'Unknown kind.' using errcode = '22023'; end if;
  if p_level is null or p_level not between 0 and 2 or (p_kind = '*' and p_level <> 0) then raise exception 'Level 0, 1 or 2.' using errcode = '22023'; end if;
  if p_limit is not null and (p_limit < 0 or p_limit > 999999999999) then raise exception 'The limit is an amount in rupees.' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients cl where cl.firm_id = f and cl.id::text = p_client) then raise exception 'No such client.' using errcode = '22023'; end if;
  select * into was from public.daily_trust where firm_id = f and client_id = p_client and kind = p_kind;
  insert into public.daily_trust (firm_id, client_id, kind, level, limit_amt, set_by, set_at) values (f, p_client, p_kind, p_level, coalesce(p_limit, 0), auth.uid(), now())
    on conflict (firm_id, client_id, kind) do update set level = excluded.level, limit_amt = coalesce(p_limit, public.daily_trust.limit_amt), set_by = excluded.set_by, set_at = excluded.set_at;
  perform public.asst_log(f, p_client, 'trust', p_kind, jsonb_build_object('level', p_level, 'was', coalesce(was.level, 0), 'limit', coalesce(p_limit, was.limit_amt, 0)));
  return jsonb_build_object('ok', true, 'level', p_level);
end $$;
create or replace function public.trust_dismiss(p_client text, p_kind text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm();
begin
  if f is null or not public.asst_is_owner() then raise exception 'Only the firm''s owner can change this.' using errcode = '42501'; end if;
  if p_kind not in ('bank', 'recurring', 'payroll', 'setoff', 'new_ledger') then raise exception 'Unknown kind.' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients cl where cl.firm_id = f and cl.id::text = p_client) then raise exception 'No such client.' using errcode = '22023'; end if;
  insert into public.daily_trust (firm_id, client_id, kind, dismissed_at, set_by, set_at) values (f, p_client, p_kind, now(), auth.uid(), now())
    on conflict (firm_id, client_id, kind) do update set dismissed_at = now();
  perform public.asst_log(f, p_client, 'trust_later', p_kind, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
-- per client and kind: entries approved through Daily Check (no edits: an edited one is made where it was edited, not
-- here) since the last rejection of that kind, the last level change and the last put-off
create or replace function public.trust_stats() returns table (client_id text, kind text, approved integer, last_at timestamptz, level integer, limit_amt numeric, dismissed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with f as (select public.my_firm() as firm),
  e as (select n.client_id, public.trust_kind_of(n.source) as kind, n.state, n.decided_at from public.night_entries n, f
         where n.firm_id = f.firm and public.trust_kind_of(n.source) <> '' and n.state in ('approved', 'rejected') and n.decided_at is not null),
  cut as (select e.client_id, e.kind, greatest(max(e.decided_at) filter (where e.state = 'rejected'), max(t.set_at), max(t.dismissed_at)) as since
            from e left join public.daily_trust t on t.firm_id = (select firm from f) and t.client_id = e.client_id and t.kind = e.kind group by e.client_id, e.kind)
  select e.client_id, e.kind, count(*) filter (where e.state = 'approved' and (c.since is null or e.decided_at > c.since))::int, max(e.decided_at) filter (where e.state = 'approved'),
         coalesce(max(t.level), 0)::int, coalesce(max(t.limit_amt), 0), max(t.dismissed_at)
    from e join cut c on c.client_id = e.client_id and c.kind = e.kind
    left join public.daily_trust t on t.firm_id = (select firm from f) and t.client_id = e.client_id and t.kind = e.kind
   where exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.firm_id = (select firm from f))
   group by e.client_id, e.kind
$$;

-- ---------------------------------------------------------------- (review M3) Approve of a journal: claim, then approved or released
-- the claim: ready -> approving, one at a time (row lock), by owners and staff of the firm; a claim left 30 minutes (the
-- page closed half way) may be taken again. The night never touches an entry being approved (night_apply changes only
-- ready, held and withdrawn ones)
create or replace function public.entry_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.night_entries;
begin
  select * into r from public.night_entries where id = p_id and firm_id = public.my_firm() for update;
  if r.id is null or not public.can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not (r.state = 'ready' or (r.state = 'approving' and r.updated_at < now() - interval '30 minutes')) then
    raise exception 'This entry is not ready (it may be being approved).' using errcode = '22023';
  end if;
  update public.night_entries set state = 'approving', decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'claim', r.id::text, jsonb_build_object('source', r.source, 'dedupe', r.dedupe, 'was', r.state));
  return jsonb_build_object('ok', true);
end $$;
-- the post failed: back to ready (the claimer only, or a claim left 30 minutes)
create or replace function public.entry_release(p_id uuid, p_why text default '') returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.night_entries;
begin
  select * into r from public.night_entries where id = p_id and firm_id = public.my_firm() for update;
  if r.id is null or not public.can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if r.state <> 'approving' then return jsonb_build_object('ok', true, 'state', r.state); end if;
  if r.decided_by is distinct from auth.uid() and r.updated_at >= now() - interval '30 minutes' then raise exception 'Someone else is approving this entry.' using errcode = '22023'; end if;
  update public.night_entries set state = 'ready', decided_by = null, decided_at = null, updated_at = now() where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'release', r.id::text, jsonb_build_object('why', left(coalesce(p_why, ''), 300)));
  return jsonb_build_object('ok', true);
end $$;
-- Tally took it (or it is queued): approved, by the person who claimed it
create or replace function public.entry_approved(p_id uuid, p_work_ref text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.night_entries;
begin
  select * into r from public.night_entries where id = p_id and firm_id = public.my_firm() for update;
  if r.id is null or not public.can_write() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if r.state <> 'approving' or r.decided_by is distinct from auth.uid() then raise exception 'Claim the entry first.' using errcode = '22023'; end if;
  update public.night_entries set state = 'approved', decided_at = now(), work_ref = coalesce(nullif(p_work_ref, ''), work_ref), updated_at = now(), approved_once = true where id = r.id;
  perform public.asst_log(r.firm_id, r.client_id, 'approved', r.id::text, jsonb_build_object('source', r.source, 'work', coalesce(nullif(p_work_ref, ''), r.work_ref), 'voucher', r.voucher, 'evidence', r.evidence));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- "Remind by itself" (the timer only)
-- the reminders due now: clients whose switch is on, turned on by an owner who is still an active owner; their document
-- requests (a statement, a 2B bill, a salary sheet, a cash bill) whose finding still needs the client and whose question
-- is not answered or closed, sent once before (in real sending: really asked; in test mode: a test send), with no send of
-- it in the last 7 days and no reminder to the client in the last 7 days. p_live: the server's switch (ASSISTANT_MAIL_LIVE)
create or replace function public.remind_due(p_live boolean) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; r record; qs jsonb; ct jsonb; m public.assistant_mail; real boolean;
begin
  for r in select p.firm_id, p.client_id, p.set_by from public.assistant_prefs p
            where p.auto_reminders
              and exists (select 1 from public.members mb where mb.user_id = p.set_by and mb.firm_id = p.firm_id and mb.active and mb.role = 'owner')
              and exists (select 1 from public.clients cl where cl.firm_id = p.firm_id and cl.id::text = p.client_id and not coalesce(cl.deleted, false))
              and not exists (select 1 from public.daily_log l where l.firm_id = p.firm_id and l.client_id = p.client_id and l.what = 'remind' and l.evidence->>'status' = 'sent' and l.at > now() - interval '7 days')
            order by p.firm_id, p.client_id loop
    m := null;
    select * into m from public.assistant_mail x where x.firm_id = r.firm_id;
    real := coalesce(m.real_send, false) and coalesce(p_live, false);
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'text', coalesce(a.edited, a.text), 'state', a.state) order by a.created_at), '[]'::jsonb) into qs
      from public.client_asks a join public.night_findings n on n.id = a.finding_id
     where a.firm_id = r.firm_id and a.client_id = r.client_id and n.state = 'ask'
       and n.kind in ('bank_month_missing', 'twob_not_in_books', 'salary_month_missing', 'cash_big')
       and a.state in ('draft', 'asked') and (not real or a.state = 'asked')
       and exists (select 1 from public.ask_sends s where s.firm_id = a.firm_id and s.client_id = a.client_id and s.channel = 'email' and s.status = 'sent' and a.id = any (s.ask_ids) and s.test_mode = not real)
       and not exists (select 1 from public.ask_sends s where s.firm_id = a.firm_id and s.client_id = a.client_id and s.status in ('sent', 'sending') and a.id = any (s.ask_ids) and s.sent_at > now() - interval '7 days');
    if jsonb_array_length(qs) = 0 then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'email', case when c.by_email then c.email else '' end) order by c.created_at), '[]'::jsonb) into ct
      from public.client_contacts c where c.firm_id = r.firm_id and c.client_id = r.client_id and c.removed_at is null;
    out := out || jsonb_build_array(jsonb_build_object('firm_id', r.firm_id, 'client_id', r.client_id, 'by', r.set_by, 'questions', qs, 'contacts', ct,
      'real_send', coalesce(m.real_send, false), 'test_to', coalesce(m.test_to, ''), 'owner_email', (select u.email from auth.users u where u.id = r.set_by),
      'client', (select to_jsonb(cl)->>'name' from public.clients cl where cl.firm_id = r.firm_id and cl.id::text = r.client_id),
      'firm', (select to_jsonb(fi)->>'name' from public.firms fi where fi.id = r.firm_id)));
  end loop;
  return out;
end $$;
create or replace function public.remind_logged(p_firm uuid, p_client text, p_send bigint, p_ids uuid[], p_status text, p_why text) returns void language sql security definer set search_path = '' as $$
  insert into public.daily_log (firm_id, client_id, what, ref, evidence)
  values (p_firm, coalesce(p_client, ''), 'remind', coalesce(p_send::text, ''), jsonb_build_object('status', left(coalesce(p_status, ''), 20), 'questions', coalesce(to_jsonb(p_ids), '[]'::jsonb), 'why', left(coalesce(p_why, ''), 300),
    'test', coalesce((select s.test_mode from public.ask_sends s where s.id = p_send), true), 'to', coalesce((select to_jsonb(s.sent_to) from public.ask_sends s where s.id = p_send), '[]'::jsonb)))
$$;

-- ---------------------------------------------------------------- function grants (explicit)
revoke all on function public.trust_kind_of(text), public.trust_set(text, text, integer, numeric), public.trust_dismiss(text, text), public.trust_stats(),
  public.remind_due(boolean), public.remind_logged(uuid, text, bigint, uuid[], text, text),
  public.entry_claim(uuid), public.entry_release(uuid, text), public.entry_approved(uuid, text) from public, anon, authenticated;
grant execute on function public.trust_set(text, text, integer, numeric), public.trust_dismiss(text, text), public.trust_stats(),
  public.entry_claim(uuid), public.entry_release(uuid, text), public.entry_approved(uuid, text) to authenticated;
grant execute on function public.remind_due(boolean), public.remind_logged(uuid, text, bigint, uuid[], text, text) to service_role;

-- ---------------------------------------------------------------- this migration's own names (checked at the top on a second run)
do $mark$
declare r record;
begin
  comment on table public.daily_trust is 'daily check (migration 208)';
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array['trust_set', 'trust_dismiss', 'trust_stats', 'trust_kind_of', 'remind_due', 'remind_logged', 'entry_claim', 'entry_release', 'entry_approved']) loop
    execute format('comment on function %s is %L', r.sig, 'daily check (migration 208)');
  end loop;
end $mark$;

commit;
