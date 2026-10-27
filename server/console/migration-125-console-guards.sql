-- FinCom Console: the guards between the console and the user app (27-Oct-2026, integration branch integ-console;
-- number 125: 124 is next-mobile's device tokens). NOT run on staging by the builder: the owner runs it, after 123.
--
-- What it adds (add-only: nothing dropped but its own triggers and policies, re-made on a second run; no row deleted or
-- rewritten; one transaction, lock_timeout 10 s; safe twice). "A firm's login" below is a request through PostgREST with
-- the person's token (current_user authenticated or anon); FinCom's functions (security definer) and the service role
-- are never stopped by these guards.
--   1. A switched-off company (clients.status <> 'active', set by the console): a firm's login cannot save its records
--      (public.records with its client_id; trigger console_company_off_records, plain words, 42501) nor upload its
--      documents (storage bucket client-docs, path <firm>/<company>/...; a RESTRICTIVE policy on storage.objects for
--      insert and update). The app keeps such changes on the computer and sends them when the company is on again.
--   2. The status columns are the console's: a firm's login cannot change clients.status / status_reason / status_by /
--      status_at (a company it makes starts active), nor firms.status / status_reason / status_by / status_at / balance /
--      plan_id / is_test / active (the old values are kept, silently, as migration 19's sync guard does: an app that sends
--      a whole row back is not broken; its other columns save). subscriptions has no write grant for signed-in people
--      (migration 119) and is not touched.
--   3. Coupons on a read-only or paused firm: coupon_redeem (migration 120) already works for them (it is the way back);
--      a free-credit coupon now retries the month's fee at once (console_billing_run(firm, null, 'retry')), so a firm
--      whose credit then covers the fee is active again without waiting for the daily job.
--   4. firm_signals: the "something changed" signal the user app listens to in Realtime (src/js/99-firm-gate.js
--      Live.joinSignals; it then reads the firm's status, plan and credit, flags, AI switches and announcements again).
--      One row per firm (scope = the firm's id) and one for every firm (scope 'all'); n counts the bumps. Bumped by
--      triggers: the firm (status, plan, credit, test mark, on/off, low-credit level), its subscription, a flag rule or
--      the AI settings for that firm; 'all' by announcements, flags, plan-wide flag rules and the AI registry, kill switch
--      and plan allowances. RLS: a member reads its firm's row and 'all'; nobody but FinCom's functions writes. Added to
--      the supabase_realtime publication.
-- Tested on pg_stand: tests/run_migration125.py (RED_WITHOUT_125=1 shows the checks fail without it), and in the chain
-- (tests/run_migration_order.py, tests/run_console_contracts.py).

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.console_audit_add(uuid,text,text,text,text,jsonb,jsonb,text,text,text)') is null or to_regclass('public.subscriptions') is null then
    raise exception 'migration 125 needs migrations 118 and 119 (the console foundation and billing) first';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. a switched-off company: no records, no uploads
-- the words for a company of the CALLER's firm that is switched off (null: on, or not the caller's)
create or replace function public.console_company_off_words(p_firm uuid, p_client text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(c.name), ''), 'This company') || ' is switched off by FinCom'
         || coalesce(': ' || nullif(btrim(c.status_reason), ''), '') || '. You can still view its work; uploads and posting to Tally are off.'
    from public.clients c
   where c.firm_id = p_firm and p_firm = public.my_firm() and c.id::text = p_client and coalesce(c.status, 'active') <> 'active'
   limit 1
$$;

-- not security definer: current_user must be the caller's
create or replace function public.console_company_off_records()
returns trigger language plpgsql set search_path = '' as $$
declare v_words text;
begin
  if current_user not in ('authenticated', 'anon') or coalesce(new.client_id, '') = '' then return new; end if;
  v_words := public.console_company_off_words(new.firm_id, new.client_id);
  if v_words is not null then raise exception '%', v_words using errcode = '42501'; end if;
  return new;
end $$;

do $$ begin
  if to_regclass('public.records') is null then
    raise notice 'console 125: public.records is not here; the records guard is not made';
  else
    drop trigger if exists console_company_off_records on public.records;
    create trigger console_company_off_records before insert or update on public.records
      for each row execute function public.console_company_off_records();
  end if;
end $$;

-- a client document's path is <firm>/<company>/<id>-<name>: refused while that company is switched off
create or replace function public.console_upload_ok(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_bucket is distinct from 'client-docs'
      or public.console_company_off_words(public.my_firm(), split_part(coalesce(p_name, ''), '/', 2)) is null
      or split_part(coalesce(p_name, ''), '/', 1) is distinct from public.my_firm()::text
$$;

do $$ begin
  if to_regclass('storage.objects') is null then
    raise notice 'console 125: storage.objects is not here; the upload guard is not made';
  else
    drop policy if exists console_company_off_insert on storage.objects;
    create policy console_company_off_insert on storage.objects as restrictive for insert to authenticated
      with check (public.console_upload_ok(bucket_id, name));
    drop policy if exists console_company_off_update on storage.objects;
    create policy console_company_off_update on storage.objects as restrictive for update to authenticated
      using (public.console_upload_ok(bucket_id, name)) with check (public.console_upload_ok(bucket_id, name));
  end if;
end $$;

-- ---------------------------------------------------------------- 2. the status columns are the console's
create or replace function public.console_status_guard_clients()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'active'; new.status_reason := null; new.status_by := null; new.status_at := null;
  else
    new.status := old.status; new.status_reason := old.status_reason; new.status_by := old.status_by; new.status_at := old.status_at;
  end if;
  return new;
end $$;
drop trigger if exists console_status_guard on public.clients;
create trigger console_status_guard before insert or update on public.clients
  for each row execute function public.console_status_guard_clients();

create or replace function public.console_status_guard_firms()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  new.status := old.status; new.status_reason := old.status_reason; new.status_by := old.status_by; new.status_at := old.status_at;
  new.balance := old.balance; new.plan_id := old.plan_id; new.is_test := old.is_test; new.active := old.active;
  return new;
end $$;
drop trigger if exists console_status_guard on public.firms;
create trigger console_status_guard before update on public.firms
  for each row execute function public.console_status_guard_firms();

-- ---------------------------------------------------------------- 3. a free-credit coupon retries the month's fee
create or replace function public.console_coupon_credit_retry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'credit' and new.status = 'finished' and old.status is distinct from 'finished'
     and exists (select 1 from public.subscriptions s where s.firm_id = new.firm_id and s.status in ('past_due', 'read_only', 'paused')) then
    perform public.console_billing_run(new.firm_id, null, 'retry', 'coupon credit');
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.coupon_redemptions') is null then
    raise notice 'console 125: coupon_redemptions is not here (migration 120); the coupon retry is not made';
  else
    drop trigger if exists console_coupon_credit_retry on public.coupon_redemptions;
    create trigger console_coupon_credit_retry after update of status on public.coupon_redemptions
      for each row execute function public.console_coupon_credit_retry();
  end if;
end $$;

-- ---------------------------------------------------------------- 4. firm_signals
create table if not exists public.firm_signals (
  scope   text primary key,                                   -- the firm's id, or 'all'
  firm_id uuid references public.firms (id) on delete cascade,  -- null: every firm
  what    text not null default '',
  at      timestamptz not null default now(),
  n       bigint not null default 0,
  check ((scope = 'all' and firm_id is null) or scope = firm_id::text)
);
alter table public.firm_signals enable row level security;
revoke all on public.firm_signals from public, anon, authenticated;
grant select on public.firm_signals to authenticated;
grant select, insert, update on public.firm_signals to service_role;
drop policy if exists firm_signals_read on public.firm_signals;
create policy firm_signals_read on public.firm_signals for select to authenticated
  using (firm_id is null or firm_id = (select public.my_firm()));

create or replace function public.firm_signal(p_firm uuid, p_what text)
returns void language sql security definer set search_path = '' as $$
  insert into public.firm_signals as s (scope, firm_id, what, at, n)
  values (coalesce(p_firm::text, 'all'), p_firm, left(coalesce(p_what, ''), 40), now(), 1)
  on conflict (scope) do update set what = excluded.what, at = now(), n = s.n + 1
$$;

create or replace function public.firm_signal_firm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.status, new.status_reason, new.plan_id, new.balance, new.is_test, new.active, new.low_balance_warn)
     is distinct from (old.status, old.status_reason, old.plan_id, old.balance, old.is_test, old.active, old.low_balance_warn) then
    perform public.firm_signal(new.id, 'firm');
  end if;
  return null;
end $$;
-- a row of a table with firm_id: that firm (TG_ARGV[0] says what)
create or replace function public.firm_signal_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_firm uuid;
begin
  v_firm := case when tg_op = 'DELETE' then old.firm_id else new.firm_id end;
  if v_firm is not null then perform public.firm_signal(v_firm, tg_argv[0]); end if;
  return null;
end $$;
-- a flag rule: its firm, or every firm for a plan's rule
create or replace function public.firm_signal_flag_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform public.firm_signal(case when r.scope = 'firm' then r.target_id end, 'flags');
  return null;
end $$;
-- a whole-platform table (statement level): every firm
create or replace function public.firm_signal_all()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.firm_signal(null, tg_argv[0]);
  return null;
end $$;

drop trigger if exists firm_signal on public.firms;
create trigger firm_signal after update on public.firms for each row execute function public.firm_signal_firm();
drop trigger if exists firm_signal on public.subscriptions;
create trigger firm_signal after insert or update on public.subscriptions for each row execute function public.firm_signal_row('plan');
do $$ begin
  if to_regclass('public.feature_flags') is not null then
    drop trigger if exists firm_signal on public.feature_flags;
    create trigger firm_signal after insert or update or delete on public.feature_flags for each statement execute function public.firm_signal_all('flags');
    drop trigger if exists firm_signal on public.feature_flag_rules;
    create trigger firm_signal after insert or update or delete on public.feature_flag_rules for each row execute function public.firm_signal_flag_rule();
  end if;
  if to_regclass('public.announcements') is not null then
    drop trigger if exists firm_signal on public.announcements;
    create trigger firm_signal after insert or update or delete on public.announcements for each statement execute function public.firm_signal_all('announcements');
  end if;
  if to_regclass('public.ai_features') is not null then
    drop trigger if exists firm_signal on public.ai_features;
    create trigger firm_signal after insert or update or delete on public.ai_features for each statement execute function public.firm_signal_all('ai');
    drop trigger if exists firm_signal on public.ai_settings;
    create trigger firm_signal after insert or update on public.ai_settings for each statement execute function public.firm_signal_all('ai');
    drop trigger if exists firm_signal on public.ai_plan_allowance;
    create trigger firm_signal after insert or update or delete on public.ai_plan_allowance for each statement execute function public.firm_signal_all('ai');
    drop trigger if exists firm_signal on public.ai_firm_settings;
    create trigger firm_signal after insert or update or delete on public.ai_firm_settings for each row execute function public.firm_signal_row('ai');
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'firm_signals') then
    alter publication supabase_realtime add table public.firm_signals;
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.console_company_off_words(uuid, text) from public, anon, authenticated;
grant execute on function public.console_company_off_words(uuid, text) to authenticated, service_role;
revoke all on function public.console_upload_ok(text, text) from public, anon;
grant execute on function public.console_upload_ok(text, text) to authenticated, service_role;
revoke all on function public.firm_signal(uuid, text) from public, anon, authenticated;
grant execute on function public.firm_signal(uuid, text) to service_role;
revoke all on function public.console_company_off_records(), public.console_status_guard_clients(), public.console_status_guard_firms(),
  public.console_coupon_credit_retry(), public.firm_signal_firm(), public.firm_signal_row(), public.firm_signal_flag_rule(), public.firm_signal_all()
  from public, anon, authenticated;

commit;
