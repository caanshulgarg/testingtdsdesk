-- FinCom Console, phase 2 "Billing core" (27-Oct-2026, branch next-console-billing; the plan: console-plan.md 3.4, 3.5,
-- 3.7, 4.2 and 6; plans-admin-review.md). NOT run on staging by the console's builder: the owner runs it, after 118.
-- Number: 119 (it takes the work 119 to 121 were reserved for: settings, plans, prices, subscriptions and the ledger).
--
-- Money: every NEW amount is in paise (bigint). The old columns stay in rupees (firms.balance, wallet_entries.amount,
-- plans.monthly_fee, modules.price, firm_modules.price), so the user app and the old functions keep working; the
-- functions here convert (rupees = paise / 100) and nothing else changes their meaning.
--
-- What it adds (add-only: no table, column or row is dropped or deleted; one transaction, lock_timeout 10 s; safe twice):
--   console_settings          platform defaults, one jsonb per section. "billing": start_credit (paise, default
--                             ₹10,000: what sign-up gives today), low_credit_warn (paise, ₹500), grace_days (7),
--                             paused_after_days (30), trial_days (0). console_billing_settings() = defaults || saved.
--                             The signup function reads start_credit (it needs its own redeploy); firms.low_balance_warn
--                             takes low_credit_warn as its default for new firms.
--   plans (columns)           code, yearly_fee_paise, per_client_fee_paise (the proper field for includes.clients_price),
--                             included_clients, included_users, features (jsonb list), ai_allowance_paise, on_website, sort,
--                             updated_at / updated_by. A trigger keeps includes.clients_price and per_client_fee_paise in
--                             step, and puts clients_price back when an edit drops it (the old screen's savePlan did:
--                             review A8, "editing the Per client plan makes every client free").
--   price_items, price_list   the metered items (today's modules plus bill reading per model, AI assistant, voice minutes,
--                             OTP, e-invoice, e-way bill) and their prices, versioned by effective date (never backdated).
--                             price_of() reads: the firm's override, then the price in force today, then modules.price.
--   subscriptions             one per firm: plan, status (trial, active, past_due, read_only, paused, cancelled), cycle,
--                             period, renewal date, trial end, past-due / grace / read-only / paused dates. Made for every
--                             firm (status active: nothing changes for anyone) and for each new firm (trigger). Kept in
--                             step with firms.plan_id / period_start. read_only, paused and cancelled make the firm
--                             read-only (firm_is_writable(), which 118's can_write() wrap asks) and stop charging;
--                             past_due does not block anything. A firm may read its own row.
--   wallet_entries (columns)  reverses_id (a refund's charge), reason, category, pay_mode, pay_ref, received_on, idem_key
--                             (unique); new kinds topup, opening, signup_credit, coupon_credit, discount, ai_usage (AI past
--                             the plan's allowance: migration 121's daily job).
--   console_credit_post(p_firm, p_amount_paise, p_kind, p_ref, p_reason, p_by)  THE way a balance changes: it locks the
--                             firm, writes the ledger line and sets the balance in one step; idempotent on (p_kind,
--                             p_ref): the same pair again returns the first line and changes nothing (another firm or
--                             amount with the same pair is refused). charge_for, refund_charge, run_monthly_core and
--                             admin_credit now go through it; so do the console's top-up, refund and adjust.
--   charge_for                the same charge key (firm, item, ref, period) is charged once: a repeat answers ok with
--                             duplicate true and charges nothing (review A4, a statement charged 17 times); refused for a
--                             read-only / paused / cancelled subscription (reason read_only).
--   billing_runs + console_billing_run   the monthly run: once per firm per month (and the fee line's key is
--                             fee:<firm>:<YYYY-MM>), the period reset (allowances refill), the fee charged, or past_due
--                             with grace_until = today + grace days; then past_due -> read_only after the grace,
--                             read_only -> paused after paused_after_days. pg_cron: 00:05 India time on the 1st (the run)
--                             and 00:20 India time daily (stages, and retrying firms that were short), where pg_cron is.
--   console_* functions       for the console-admin function (service role only): plans, prices, subscriptions, ledgers,
--                             top-up / refund / adjust (each change and its console_audit row in one transaction, the
--                             role re-checked; Billing's refund / adjust up to ₹10,000), the balance = ledger check and
--                             its adjusting entry, the data-cleanup actions (never run here: the owner presses them),
--                             the billing settings.
-- Grants: new tables RLS on; subscriptions: a firm's members select their own row; everything else the service role only.
-- Tested on pg_stand: tests/run_migration119.py (RED_WITHOUT_119=1 shows the checks fail without it).

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.console_role_check(uuid,text[])') is null or to_regprocedure('public.console_audit_add(uuid,text,text,text,text,jsonb,jsonb,text,text,text)') is null then
    raise exception 'migration 119 needs migration 118 (the console foundation) first';
  end if;
end $$;

-- ---------------------------------------------------------------- settings
create table if not exists public.console_settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value      jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.console_settings enable row level security;
revoke all on public.console_settings from public, anon, authenticated;
grant select, insert, update on public.console_settings to service_role;

-- the billing settings in force: the defaults, then what the owner saved. Amounts in paise.
create or replace function public.console_billing_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'start_credit', 1000000,        -- ₹10,000: what sign-up gives today
           'low_credit_warn', 50000,       -- ₹500
           'grace_days', 7,                -- past due -> read-only after this many days
           'paused_after_days', 30,        -- days after falling past due -> paused
           'trial_days', 0)                -- 0: a new firm starts active (no trial)
         || coalesce((select s.value from public.console_settings s where s.key = 'billing'), '{}'::jsonb)
$$;

-- the low-credit level a new firm starts with (rupees, as firms.low_balance_warn)
create or replace function public.billing_low_warn_default()
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((public.console_billing_settings() ->> 'low_credit_warn')::numeric / 100, 500)
$$;
revoke all on function public.billing_low_warn_default() from public, anon;
grant execute on function public.billing_low_warn_default() to authenticated, service_role;
alter table public.firms alter column low_balance_warn set default public.billing_low_warn_default();

-- ---------------------------------------------------------------- firms: test firms
alter table public.firms add column if not exists is_test boolean not null default false;

-- ---------------------------------------------------------------- plans: the catalogue's fields
alter table public.plans add column if not exists code text;
alter table public.plans add column if not exists yearly_fee_paise bigint;
alter table public.plans add column if not exists per_client_fee_paise bigint;
alter table public.plans add column if not exists included_clients integer;
alter table public.plans add column if not exists included_users integer;
alter table public.plans add column if not exists features jsonb not null default '[]'::jsonb;
alter table public.plans add column if not exists ai_allowance_paise bigint;
alter table public.plans add column if not exists on_website boolean not null default false;
alter table public.plans add column if not exists sort integer not null default 0;
alter table public.plans add column if not exists updated_at timestamptz;
alter table public.plans add column if not exists updated_by uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'plans_v2_check' and conrelid = 'public.plans'::regclass) then
    alter table public.plans add constraint plans_v2_check check (
      (yearly_fee_paise is null or yearly_fee_paise >= 0) and (per_client_fee_paise is null or per_client_fee_paise >= 0)
      and (included_clients is null or included_clients >= 0) and (included_users is null or included_users >= 0)
      and (ai_allowance_paise is null or ai_allowance_paise >= -1) and jsonb_typeof(features) = 'array'
      and (code is null or code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'));
  end if;
end $$;
create unique index if not exists plans_code_key on public.plans (code) where code is not null;

-- includes.clients_price (rupees, what admin_set_plan and sign-up read) and per_client_fee_paise stay in step. An edit
-- that drops clients_price from includes (the old screen rebuilt includes from its checkboxes) gets it back.
create or replace function public.plans_per_client_sync()
returns trigger language plpgsql set search_path = '' as $$
declare v numeric;
begin
  new.includes := coalesce(new.includes, '{}'::jsonb);
  v := nullif(new.includes ->> 'clients_price', '')::numeric;
  if tg_op = 'INSERT' then
    if new.per_client_fee_paise is not null then
      if v is distinct from new.per_client_fee_paise / 100.0 then
        new.includes := new.includes || jsonb_build_object('clients_price', round(new.per_client_fee_paise / 100.0, 2));
      end if;
    elsif v is not null then
      new.per_client_fee_paise := round(v * 100);
    end if;
    return new;
  end if;
  if new.per_client_fee_paise is distinct from old.per_client_fee_paise then
    -- the column changed (the console): the key follows
    if new.per_client_fee_paise is null then
      new.includes := new.includes - 'clients_price';
    elsif v is distinct from new.per_client_fee_paise / 100.0 then
      new.includes := new.includes || jsonb_build_object('clients_price', round(new.per_client_fee_paise / 100.0, 2));
    end if;
  elsif new.includes ? 'clients_price' then
    -- the key was set (an old path): the column follows
    new.per_client_fee_paise := case when v is null then null else round(v * 100) end;
  elsif old.includes ? 'clients_price' and new.per_client_fee_paise is not null then
    -- the key was dropped by an edit that rebuilt includes: it is put back
    new.includes := new.includes || jsonb_build_object('clients_price', old.includes -> 'clients_price');
  end if;
  return new;
end $$;
drop trigger if exists plans_per_client_sync on public.plans;
create trigger plans_per_client_sync before insert or update on public.plans
  for each row execute function public.plans_per_client_sync();
-- the column from the hidden key, for plans that have it (structure, not a data clean-up: includes is unchanged)
update public.plans set per_client_fee_paise = round((includes ->> 'clients_price')::numeric * 100)
 where per_client_fee_paise is null and nullif(includes ->> 'clients_price', '') is not null;

-- ---------------------------------------------------------------- price list
create table if not exists public.price_items (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  title       text not null,
  unit        text not null,
  kind        text not null check (kind in ('usage', 'monthly', 'ai')),
  module_code text,                      -- the modules row it prices (charge_for, price_of), if any
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.price_list (
  id             bigint generated always as identity primary key,
  item_code      text not null references public.price_items (code),
  price_paise    bigint not null check (price_paise >= 0 and price_paise <= 100000000),
  effective_from date not null,
  reason         text,
  set_by         uuid,
  set_at         timestamptz not null default now(),
  unique (item_code, effective_from)
);
alter table public.price_items enable row level security;
alter table public.price_list enable row level security;
revoke all on public.price_items, public.price_list from public, anon, authenticated;
grant select, insert, update on public.price_items, public.price_list to service_role;

insert into public.price_items (code, title, unit, kind, module_code, sort)
select m.code, m.title, m.unit, case when m.billing = 'per_month' then 'monthly' when m.code in ('claude', 'vision') then 'ai' else 'usage' end, m.code, m.sort
  from public.modules m
on conflict (code) do nothing;
insert into public.price_items (code, title, unit, kind, sort) values
  ('bill_read_haiku',  'Bill reading by Claude Haiku',  'per bill read', 'ai', 101),
  ('bill_read_sonnet', 'Bill reading by Claude Sonnet', 'per bill read', 'ai', 102),
  ('bill_read_opus',   'Bill reading by Claude Opus',   'per bill read', 'ai', 103),
  ('assistant',        'AI assistant (Ask FinCom)',      'per question',  'ai', 110),
  ('voice_minute',     'Voice typing and captions',      'per minute',    'ai', 111),
  ('otp',              'OTP / SMS',                      'per message',   'usage', 120),
  ('einvoice',         'E-invoice (IRN)',                'per invoice',   'usage', 121),
  ('ewaybill',         'E-way bill',                     'per bill',      'usage', 122)
on conflict (code) do nothing;
-- today's standard prices become the first version (only where an item has none yet); the new items have no price
-- until the owner sets one
insert into public.price_list (item_code, price_paise, effective_from, reason)
select m.code, round(m.price * 100), date '2026-01-01', 'The standard price before the console (modules.price)'
  from public.modules m
 where not exists (select 1 from public.price_list p where p.item_code = m.code);

-- the price in force on a day (paise), null when the item has none
create or replace function public.price_list_at(p_code text, p_on date)
returns bigint language sql stable security definer set search_path = '' as $$
  select p.price_paise from public.price_list p
   where p.item_code = p_code and p.effective_from <= coalesce(p_on, (now() at time zone 'Asia/Kolkata')::date)
   order by p.effective_from desc limit 1
$$;

-- price_of: the firm's own price, then the price list in force today, then modules.price (rupees, as before)
create or replace function public.price_of(p_firm uuid, p_code text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(fm.price, round(public.price_list_at(m.code, null) / 100.0, 2), m.price)
    from public.modules m
    left join public.firm_modules fm on fm.firm_id = p_firm and fm.code = m.code
   where m.code = p_code
$$;

-- ---------------------------------------------------------------- subscriptions
create table if not exists public.subscriptions (
  firm_id        uuid primary key references public.firms (id) on delete cascade,
  plan_id        uuid references public.plans (id),
  status         text not null default 'active' check (status in ('trial', 'active', 'past_due', 'read_only', 'paused', 'cancelled')),
  billing_cycle  text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  period_start   date not null,
  renews_on      date not null,
  trial_ends_on  date,
  past_due_since date,
  grace_until    date,
  read_only_since date,
  paused_since   date,
  status_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from public, anon, authenticated;
grant select, insert, update on public.subscriptions to service_role;
grant select on public.subscriptions to authenticated;
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select to authenticated using (firm_id = public.my_firm());

-- every firm gets one (active: nothing changes for anyone until the monthly run or the console changes it)
insert into public.subscriptions (firm_id, plan_id, status, period_start, renews_on)
select f.id, f.plan_id, 'active', f.period_start, (date_trunc('month', f.period_start) + interval '1 month')::date
  from public.firms f
on conflict (firm_id) do nothing;

-- a new firm: its subscription (a trial when the settings give trial days)
create or replace function public.subscriptions_for_new_firm()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_days integer := coalesce((public.console_billing_settings() ->> 'trial_days')::integer, 0);
        v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into public.subscriptions (firm_id, plan_id, status, period_start, renews_on, trial_ends_on)
  values (new.id, new.plan_id, case when v_days > 0 then 'trial' else 'active' end, new.period_start,
          (date_trunc('month', new.period_start) + interval '1 month')::date, case when v_days > 0 then v_today + v_days end)
  on conflict (firm_id) do nothing;
  return new;
end $$;
drop trigger if exists subscriptions_for_new_firm on public.firms;
create trigger subscriptions_for_new_firm after insert on public.firms
  for each row execute function public.subscriptions_for_new_firm();

-- the old paths (admin_set_plan, the monthly run's period) keep the subscription in step
create or replace function public.subscriptions_follow_firm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.subscriptions s
     set plan_id = new.plan_id, period_start = new.period_start, updated_at = now()
   where s.firm_id = new.id and (s.plan_id is distinct from new.plan_id or s.period_start is distinct from new.period_start);
  return new;
end $$;
drop trigger if exists subscriptions_follow_firm on public.firms;
create trigger subscriptions_follow_firm after update of plan_id, period_start on public.firms
  for each row execute function public.subscriptions_follow_firm();

-- read-only while the firm is suspended or closed (118) or its subscription is read_only, paused or cancelled.
-- Past due does not block anything. (118's can_write() wrap asks this function.)
create or replace function public.firm_is_writable()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.members m join public.firms f on f.id = m.firm_id
                      where m.user_id = auth.uid() and m.active
                        and (f.status <> 'active'
                             or exists (select 1 from public.subscriptions s where s.firm_id = f.id
                                         and s.status in ('read_only', 'paused', 'cancelled'))))
$$;
-- the app's "paused" page and banners: the firm's status and its billing status, and the one stage the app acts on:
--   stage      the console's suspended / closed first (firms.status), else billing's paused / read_only / cancelled /
--              past_due / trial, else active
--   read_only  writing is refused (the same rule as firm_is_writable(): suspended, closed, read_only, paused, cancelled)
--   can_read   false only when billing has paused the firm: "sign in and pay only" (console-plan.md 3.5); the app then
--              shows its paused page with Plan and credit and Help, and nothing of the firm's work
-- (status, reason, at: 118's fields, kept; billing_status, grace_until, renews_on, read_only_since, paused_since: 119's)
create or replace function public.my_firm_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('status', f.status, 'reason', f.status_reason, 'at', f.status_at,
                                             'billing_status', s.status, 'grace_until', s.grace_until, 'renews_on', s.renews_on,
                                             'read_only_since', s.read_only_since, 'paused_since', s.paused_since,
                                             'stage', case when f.status <> 'active' then f.status
                                                           when s.status in ('paused', 'read_only', 'cancelled', 'past_due', 'trial') then s.status
                                                           else 'active' end,
                                             'read_only', f.status <> 'active' or coalesce(s.status in ('read_only', 'paused', 'cancelled'), false),
                                             'can_read', not coalesce(s.status = 'paused', false))
                     from public.members m join public.firms f on f.id = m.firm_id
                     left join public.subscriptions s on s.firm_id = f.id
                    where m.user_id = auth.uid() and m.active limit 1), jsonb_build_object('status', null))
$$;

-- ---------------------------------------------------------------- the ledger
alter table public.wallet_entries add column if not exists reverses_id bigint references public.wallet_entries (id);
alter table public.wallet_entries add column if not exists reason text;
alter table public.wallet_entries add column if not exists category text;
alter table public.wallet_entries add column if not exists pay_mode text;
alter table public.wallet_entries add column if not exists pay_ref text;
alter table public.wallet_entries add column if not exists received_on date;
alter table public.wallet_entries add column if not exists idem_key text;
create unique index if not exists wallet_entries_idem_key on public.wallet_entries (idem_key) where idem_key is not null;
create index if not exists wallet_entries_reverses on public.wallet_entries (reverses_id) where reverses_id is not null;
-- the kinds: the old five plus topup, opening, signup_credit, coupon_credit, discount, ai_usage (the old check is replaced by a
-- wider one; no row changes)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.wallet_entries'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~ '\mkind\M' and pg_get_constraintdef(oid) !~ 'topup' loop
    execute format('alter table public.wallet_entries drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'wallet_entries_kind_v2' and conrelid = 'public.wallet_entries'::regclass) then
    alter table public.wallet_entries add constraint wallet_entries_kind_v2 check (kind in
      ('credit', 'charge', 'refund', 'adjust', 'fee', 'topup', 'opening', 'signup_credit', 'coupon_credit', 'discount', 'ai_usage'));
  end if;
end $$;

-- THE way a firm's balance changes. p_amount_paise: + adds credit, - takes it. Idempotent on (p_kind, p_ref): the same
-- pair again returns the first line ("duplicate": true) and changes nothing; the pair with another firm or amount is
-- refused (console: ref_reused). Refused: an amount of the wrong sign for its kind, a balance taken below zero, adjust /
-- refund / opening without a reason. A caller may describe the line (code, qty, note, the shown ref, reverses_id,
-- category, pay_mode, pay_ref, received_on) with set_config('fincom.ledger_meta', <json>, true) just before the call.
create or replace function public.console_credit_post(p_firm uuid, p_amount_paise bigint, p_kind text, p_ref text, p_reason text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text; v_old public.wallet_entries; v_bal numeric; v_new numeric; v_amt numeric; v_meta jsonb; v_id bigint;
begin
  if p_firm is null then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  if p_kind is null or p_kind not in ('topup', 'charge', 'fee', 'refund', 'adjust', 'opening', 'signup_credit', 'coupon_credit', 'discount', 'credit', 'ai_usage') then
    raise exception 'console: bad_kind' using errcode = '22023';
  end if;
  if p_ref is null or length(btrim(p_ref)) = 0 or length(p_ref) > 300 then raise exception 'console: bad_ref' using errcode = '22023'; end if;
  if p_amount_paise is null or p_amount_paise = 0 or abs(p_amount_paise) > 100000000000 then raise exception 'console: bad_amount' using errcode = '22023'; end if;
  if (p_kind in ('topup', 'refund', 'signup_credit', 'coupon_credit', 'discount', 'credit') and p_amount_paise < 0)
     or (p_kind in ('charge', 'fee', 'ai_usage') and p_amount_paise > 0) then
    raise exception 'console: bad_sign' using errcode = '22023';
  end if;
  if p_kind in ('adjust', 'refund', 'opening') and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'console: reason' using errcode = '22023';
  end if;
  v_meta := coalesce(nullif(current_setting('fincom.ledger_meta', true), '')::jsonb, '{}'::jsonb);
  perform set_config('fincom.ledger_meta', '', true);
  v_key := p_kind || ':' || p_ref;
  -- one firm at a time: the lock first, then the look for the same key (a second call waits, then sees the first's line)
  select balance into v_bal from public.firms where id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  select * into v_old from public.wallet_entries where idem_key = v_key;
  if found then
    if v_old.firm_id <> p_firm or round(v_old.amount * 100) <> p_amount_paise then
      raise exception 'console: ref_reused' using errcode = '23505';
    end if;
    return jsonb_build_object('entry_id', v_old.id, 'balance', v_bal, 'amount_paise', p_amount_paise, 'duplicate', true);
  end if;
  v_amt := round(p_amount_paise / 100.0, 2);
  v_new := v_bal + v_amt;
  if v_amt < 0 and v_new < 0 then raise exception 'console: below_zero' using errcode = '22023'; end if;
  update public.firms set balance = v_new where id = p_firm;
  insert into public.wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, ref, by_user, reason, category,
                                     pay_mode, pay_ref, received_on, reverses_id, idem_key)
  values (p_firm, p_kind, coalesce(v_meta ->> 'code', 'wallet'), coalesce((v_meta ->> 'qty')::numeric, 1), v_amt, v_new,
          left(coalesce(v_meta ->> 'note', p_reason, ''), 500), left(coalesce(v_meta ->> 'ref', p_ref), 300), p_by,
          nullif(left(btrim(coalesce(p_reason, '')), 1000), ''), v_meta ->> 'category', v_meta ->> 'pay_mode', v_meta ->> 'pay_ref',
          (v_meta ->> 'received_on')::date, (v_meta ->> 'reverses_id')::bigint, v_key)
  returning id into v_id;
  return jsonb_build_object('entry_id', v_id, 'balance', v_new, 'amount_paise', p_amount_paise, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------- charging (the old functions, through the ledger)
create table if not exists public.billing_charge_keys (
  firm_id   uuid not null references public.firms (id) on delete cascade,
  key       text not null,
  at        timestamptz not null default now(),
  result    jsonb not null,
  primary key (firm_id, key)
);
alter table public.billing_charge_keys enable row level security;
revoke all on public.billing_charge_keys from public, anon, authenticated;
grant select, insert, update on public.billing_charge_keys to service_role;

-- as before (plan allowance, cap then price_after, low balance refused, usage_period counted), plus: refused while the
-- subscription is read_only / paused / cancelled; the same (item, ref) in a period is charged once (a repeat answers
-- the first result with duplicate true, and counts no use); the balance moves only through console_credit_post.
create or replace function public.charge_for(p_firm uuid, p_user uuid, p_code text, p_qty numeric, p_ref text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_amount numeric; v_bal numeric; v_enabled boolean; v_billing text; v_active boolean; v_sub text; v_key text; v_prev jsonb;
  v_inc jsonb; v_cap numeric; v_used numeric; v_period date; v_price numeric; v_free numeric := 0; v_paid numeric; v_res jsonb; v_post jsonb;
begin
  if p_firm is null then return jsonb_build_object('ok', false, 'reason', 'no_firm'); end if;
  select active, period_start, balance into v_active, v_period, v_bal from public.firms where id = p_firm for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_firm'); end if;
  if not v_active then return jsonb_build_object('ok', false, 'reason', 'firm_off'); end if;
  select status into v_sub from public.subscriptions where firm_id = p_firm;
  if v_sub in ('read_only', 'paused', 'cancelled') then return jsonb_build_object('ok', false, 'reason', 'read_only', 'status', v_sub); end if;
  select m.billing, coalesce(fm.enabled, true) into v_billing, v_enabled
    from public.modules m left join public.firm_modules fm on fm.firm_id = p_firm and fm.code = m.code
   where m.code = p_code;
  if v_billing is null then return jsonb_build_object('ok', false, 'reason', 'unknown_module'); end if;
  if not v_enabled then return jsonb_build_object('ok', false, 'reason', 'module_off'); end if;
  -- the duplicate-charge guard: one charge per (item, ref, period)
  if nullif(btrim(coalesce(p_ref, '')), '') is not null then
    v_key := p_code || ':' || to_char(v_period, 'YYYY-MM-DD') || ':' || p_ref;
    select result into v_prev from public.billing_charge_keys where firm_id = p_firm and key = v_key;
    if found then
      return v_prev || jsonb_build_object('duplicate', true, 'balance', v_bal);
    end if;
  end if;
  select p.includes -> p_code into v_inc from public.plans p join public.firms f on f.plan_id = p.id where f.id = p_firm;
  select qty into v_used from public.usage_period where firm_id = p_firm and period_start = v_period and code = p_code;
  v_used := coalesce(v_used, 0);
  v_price := public.price_of(p_firm, p_code);
  if v_billing = 'free' then
    v_paid := 0; v_free := p_qty;
  elsif v_inc is not null then
    v_cap := nullif(v_inc ->> 'cap', '')::numeric;
    if v_cap is null then v_free := p_qty; v_paid := 0;
    else
      v_free := greatest(0, least(p_qty, v_cap - v_used));
      v_paid := p_qty - v_free;
      v_price := coalesce(nullif(v_inc ->> 'price_after', '')::numeric, v_price);
    end if;
  else
    v_paid := p_qty;
  end if;
  v_amount := round(coalesce(v_price, 0) * v_paid, 2);
  if v_amount > 0 and v_bal < v_amount then
    return jsonb_build_object('ok', false, 'reason', 'low_balance', 'needed', v_amount, 'balance', v_bal);
  end if;
  if v_amount > 0 then
    perform set_config('fincom.ledger_meta', jsonb_build_object('code', p_code, 'qty', v_paid, 'note', coalesce(p_note, ''), 'ref', coalesce(p_ref, ''))::text, true);
    v_post := public.console_credit_post(p_firm, -round(v_amount * 100)::bigint, 'charge',
                p_firm::text || ':' || coalesce(v_key, p_code || ':' || gen_random_uuid()::text), null, p_user);
    v_bal := (v_post ->> 'balance')::numeric;
  end if;
  insert into public.usage_period (firm_id, period_start, code, qty, spent)
  values (p_firm, v_period, p_code, p_qty, v_amount)
  on conflict (firm_id, period_start, code) do update set qty = usage_period.qty + excluded.qty, spent = usage_period.spent + excluded.spent;
  v_res := jsonb_build_object('ok', true, 'amount', v_amount, 'balance', v_bal, 'included', v_free, 'charged', v_paid);
  if v_key is not null then
    insert into public.billing_charge_keys (firm_id, key, result) values (p_firm, v_key, v_res - 'balance');
  end if;
  return v_res;
end $$;

-- the gateway's automatic refund when a provider fails (same arguments and answer as before), through the ledger and
-- linked to the charge it reverses
create or replace function public.refund_charge(p_firm uuid, p_amount numeric, p_code text, p_ref text, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_charge bigint; v_post jsonb;
begin
  if coalesce(p_amount, 0) <= 0 then return jsonb_build_object('ok', true, 'amount', 0); end if;
  select id into v_charge from public.wallet_entries
   where firm_id = p_firm and kind = 'charge' and code = p_code and ref = coalesce(p_ref, '') and coalesce(p_ref, '') <> ''
     and not exists (select 1 from public.wallet_entries r where r.reverses_id = wallet_entries.id)
   order by id desc limit 1;
  perform set_config('fincom.ledger_meta', jsonb_build_object('code', p_code, 'note', 'Refund: the provider failed', 'ref', coalesce(p_ref, ''),
                                                              'reverses_id', v_charge, 'category', 'provider_failed')::text, true);
  v_post := public.console_credit_post(p_firm, round(p_amount * 100)::bigint, 'refund',
              'auto:' || p_firm::text || ':' || coalesce(v_charge::text, gen_random_uuid()::text), 'The provider failed', p_user);
  return jsonb_build_object('ok', true, 'amount', p_amount, 'balance', (v_post ->> 'balance')::numeric);
end $$;

-- the old admin screen's "Add credit": through the ledger, and an error (not {ok:false}) when refused (review A7)
create or replace function public.admin_credit(p_firm uuid, p_amount numeric, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_post jsonb;
begin
  if not public.is_superadmin() then raise exception 'Only a platform administrator can add credit.' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Give an amount.' using errcode = '22023'; end if;
  perform set_config('fincom.ledger_meta', jsonb_build_object('note', coalesce(p_note, ''), 'ref', '')::text, true);
  v_post := public.console_credit_post(p_firm, round(p_amount * 100)::bigint, case when p_amount > 0 then 'credit' else 'adjust' end,
              'legacy:' || gen_random_uuid()::text, coalesce(nullif(btrim(p_note), ''), 'Added on the old Platform page'), auth.uid());
  return jsonb_build_object('ok', true, 'balance', (v_post ->> 'balance')::numeric);
end $$;

-- ---------------------------------------------------------------- the monthly run
create table if not exists public.billing_runs (
  firm_id         uuid not null references public.firms (id) on delete cascade,
  month           date not null check (extract(day from month) = 1),
  outcome         text not null check (outcome in ('charged', 'free', 'trial', 'short', 'skipped')),
  fee_paise       bigint not null default 0,
  detail          jsonb not null default '{}'::jsonb,
  wallet_entry_id bigint,
  tries           integer not null default 1,
  run_at          timestamptz not null default now(),
  run_by          uuid,
  primary key (firm_id, month)
);
alter table public.billing_runs enable row level security;
revoke all on public.billing_runs from public, anon, authenticated;
grant select, insert, update on public.billing_runs to service_role;

-- what a firm's month costs now (paise), with its parts: the plan's fee (monthly; yearly when its renewal is due),
-- clients above the plan's included ones at the per-client price (the firm's own clients price, else the plan's), and
-- people above the included ones at the shared-data price unless the plan includes it
create or replace function public.console_billing_fee(p_firm uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.subscriptions; p public.plans; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_parts jsonb := '[]'::jsonb; v_total bigint := 0; v_n integer; v_price numeric; v_on boolean; v_fm boolean; v_amt bigint;
begin
  select * into s from public.subscriptions where firm_id = p_firm;
  select * into p from public.plans where id = coalesce(s.plan_id, (select plan_id from public.firms where id = p_firm));
  if p.id is not null then
    if coalesce(s.billing_cycle, 'monthly') = 'yearly' then
      v_amt := case when s.renews_on is null or s.renews_on <= v_today then coalesce(p.yearly_fee_paise, round(p.monthly_fee * 1200)) else 0 end;
    else
      v_amt := round(coalesce(p.monthly_fee, 0) * 100);
    end if;
    if v_amt > 0 then
      v_parts := v_parts || jsonb_build_array(jsonb_build_object('what', 'plan', 'title', p.name, 'qty', 1, 'price_paise', v_amt, 'amount_paise', v_amt));
      v_total := v_total + v_amt;
    end if;
  end if;
  -- clients
  select true, enabled, price into v_fm, v_on, v_price from public.firm_modules where firm_id = p_firm and code = 'clients';
  if coalesce(v_fm, false) then v_price := case when v_on then v_price else null end;
  else v_price := p.per_client_fee_paise / 100.0; end if;
  if coalesce(v_price, 0) > 0 then
    select count(*) into v_n from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false) and coalesce(c.status, 'active') = 'active';
    v_n := greatest(0, v_n - coalesce(p.included_clients, 0));
    if v_n > 0 then
      v_amt := round(v_price * 100) * v_n;
      v_parts := v_parts || jsonb_build_array(jsonb_build_object('what', 'clients', 'title', 'Clients', 'qty', v_n, 'price_paise', round(v_price * 100), 'amount_paise', v_amt));
      v_total := v_total + v_amt;
    end if;
  end if;
  -- people (shared data), unless the plan includes it
  v_price := public.price_of(p_firm, 'cloud');
  if coalesce(v_price, 0) > 0 and (p.id is null or (p.includes -> 'cloud') is null)
     and coalesce((select enabled from public.firm_modules where firm_id = p_firm and code = 'cloud'), true) then
    select count(*) into v_n from public.members m where m.firm_id = p_firm and m.active;
    v_n := greatest(0, v_n - coalesce(p.included_users, 0));
    if v_n > 0 then
      v_amt := round(v_price * 100) * v_n;
      v_parts := v_parts || jsonb_build_array(jsonb_build_object('what', 'cloud', 'title', 'People (shared data)', 'qty', v_n, 'price_paise', round(v_price * 100), 'amount_paise', v_amt));
      v_total := v_total + v_amt;
    end if;
  end if;
  return jsonb_build_object('total_paise', v_total, 'parts', v_parts, 'cycle', coalesce(s.billing_cycle, 'monthly'));
end $$;

-- the run. p_mode 'month': every subscription whose month is not done yet (the 1st's job, and "Run now"); 'retry': only
-- firms that were short this month (the daily job, and after a top-up). Then the stages move on. Safe to run any number
-- of times: one billing_runs row per firm per month, and the fee line's key fee:<firm>:<YYYY-MM>. Writes one
-- console_audit row ("billing.run", with the reason given; who is null for the scheduled job). Answers the report.
-- Coupons (migration 120, docs/CONSOLE-COUPONS.md "the contract with billing"), when 120 is in: a firm's live trial_days
-- discount adds its days to the trial (from its end, or today when that is later) while the firm is active or in its
-- trial; then the month's fee loses the firm's one live fee discount (percent of the fee capped at max_off_paise, flat
-- up to the fee, or the whole fee for a free month): a 'discount' ledger line (ref: the redemption) and the fee line,
-- then coupon_discount_apply() for the month. A firm short even after the discount keeps it for the retry.
create or replace function public.console_billing_run(p_firm uuid, p_by uuid, p_mode text default 'month', p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_set jsonb := public.console_billing_settings();
  v_grace integer := coalesce((v_set ->> 'grace_days')::integer, 7);
  v_pause integer := coalesce((v_set ->> 'paused_after_days')::integer, 30);
  r record; v_run public.billing_runs; v_fee jsonb; v_amt bigint; v_post jsonb; v_out text; v_entry bigint;
  v_rows jsonb := '[]'::jsonb; v_count jsonb := '{}'::jsonb; v_role text := 'system'; v_status text; n integer;
  v_cp boolean := to_regclass('public.coupon_discounts') is not null
                  and to_regprocedure('public.coupon_discount_apply(bigint,date,bigint,text)') is not null;
  d record; v_off bigint; v_dref text;
begin
  if p_mode is null or p_mode not in ('month', 'retry') then raise exception 'console: bad_mode' using errcode = '22023'; end if;
  if p_by is not null then v_role := public.console_role_check(p_by, array['owner', 'billing']); end if;
  for r in select s.firm_id from public.subscriptions s join public.firms f on f.id = s.firm_id
            where (p_firm is null or s.firm_id = p_firm) and s.status <> 'cancelled' order by f.created_at, s.firm_id loop
    perform 1 from public.firms where id = r.firm_id for update;
    select * into v_run from public.billing_runs where firm_id = r.firm_id and month = v_month;
    if found and v_run.outcome <> 'short' and v_run.outcome <> 'skipped' then
      v_count := v_count || jsonb_build_object('already', coalesce((v_count ->> 'already')::integer, 0) + 1);
      continue;
    end if;
    if not found and p_mode = 'retry' then continue; end if;
    v_out := null; v_amt := 0; v_entry := null; v_fee := '{}'::jsonb;
    if (select status from public.firms where id = r.firm_id) <> 'active' then
      v_out := 'skipped'; v_fee := jsonb_build_object('why', 'The firm is suspended or closed.');
    else
      -- a new month: the period starts again (allowances and caps refill) whether or not the fee can be paid
      update public.firms set period_start = v_month where id = r.firm_id and period_start < v_month;
      update public.subscriptions set period_start = v_month, updated_at = now() where firm_id = r.firm_id and period_start < v_month;
      -- a coupon's longer trial (migration 120): its days added before the trial is looked at
      if v_cp and exists (select 1 from public.subscriptions where firm_id = r.firm_id and status in ('active', 'trial')) then
        for d in select x.id, x.value from public.coupon_discounts x
                  where x.firm_id = r.firm_id and x.kind = 'trial_days' and x.status in ('pending', 'active') and x.months_left > 0 order by x.id loop
          update public.subscriptions
             set status = 'trial', trial_ends_on = greatest(coalesce(trial_ends_on, v_today), v_today) + d.value::integer, updated_at = now()
           where firm_id = r.firm_id;
          perform public.coupon_discount_apply(d.id, v_today, 0, 'trial:' || r.firm_id::text || ':' || v_today::text);
        end loop;
      end if;
      if (select status = 'trial' and coalesce(trial_ends_on, v_today) > v_today from public.subscriptions where firm_id = r.firm_id) then
        v_out := 'trial';
      else
        update public.subscriptions set status = 'active', trial_ends_on = coalesce(trial_ends_on, v_today) where firm_id = r.firm_id and status = 'trial';
        v_fee := public.console_billing_fee(r.firm_id);
        v_amt := (v_fee ->> 'total_paise')::bigint;
        -- the firm's one live fee discount (coupons, migration 120; stacking keeps it to one)
        v_off := 0; d := null;
        if v_cp and v_amt > 0 then
          select x.id, x.kind, x.value, x.max_off_paise, x.from_redemption into d from public.coupon_discounts x
           where x.firm_id = r.firm_id and x.kind in ('percent', 'flat', 'free_months') and x.status in ('pending', 'active') and x.months_left > 0
             and not exists (select 1 from public.coupon_discount_months m where m.discount_id = x.id and m.period = v_month)
           order by x.id limit 1;
          if found then
            v_off := case d.kind when 'percent' then least(round(v_amt * d.value / 100.0)::bigint, coalesce(d.max_off_paise, v_amt))
                                 when 'flat' then least(d.value, v_amt) else v_amt end;
            v_fee := v_fee || jsonb_build_object('gross_paise', v_amt, 'discount_paise', v_off, 'discount_id', d.id, 'discount_kind', d.kind, 'redemption', d.from_redemption);
          end if;
        end if;
        if v_amt = 0 then
          v_out := 'free';
        elsif (select round(balance * 100) from public.firms where id = r.firm_id) >= v_amt - v_off then
          if v_off > 0 then
            -- the discount line first (credit), so a firm whose credit covers only the discounted fee is charged
            v_dref := d.from_redemption::text || ':' || to_char(v_month, 'YYYY-MM');
            perform set_config('fincom.ledger_meta', jsonb_build_object('code', 'coupon', 'note', 'Coupon discount for ' || to_char(v_month, 'Mon YYYY'), 'ref', d.from_redemption::text)::text, true);
            perform public.console_credit_post(r.firm_id, v_off, 'discount', v_dref, null, p_by);
          end if;
          perform set_config('fincom.ledger_meta', jsonb_build_object('code', 'plan', 'note', 'Monthly charge for ' || to_char(v_month, 'Mon YYYY'), 'ref', to_char(v_month, 'YYYY-MM'))::text, true);
          v_post := public.console_credit_post(r.firm_id, -v_amt, 'fee', r.firm_id::text || ':' || to_char(v_month, 'YYYY-MM'), null, p_by);
          v_entry := (v_post ->> 'entry_id')::bigint;
          if v_off > 0 then
            perform public.coupon_discount_apply(d.id, v_month, v_off, 'discount:' || v_dref);
            v_amt := v_amt - v_off;
          end if;
          v_out := 'charged';
        else
          v_out := 'short';
        end if;
      end if;
    end if;
    -- the subscription's status from the outcome
    if v_out in ('charged', 'free') then
      update public.subscriptions
         set status = 'active', past_due_since = null, grace_until = null, read_only_since = null, paused_since = null,
             renews_on = case when billing_cycle = 'yearly' and v_out = 'charged' and (v_fee -> 'parts' -> 0 ->> 'what') = 'plan'
                              then (v_month + interval '1 year')::date
                              when billing_cycle = 'yearly' then greatest(renews_on, (v_month + interval '1 month')::date)
                              else (v_month + interval '1 month')::date end,
             updated_at = now()
       where firm_id = r.firm_id and status in ('active', 'past_due', 'read_only', 'paused');
    elsif v_out = 'trial' then
      update public.subscriptions set renews_on = (v_month + interval '1 month')::date, updated_at = now() where firm_id = r.firm_id;
    elsif v_out = 'short' then
      update public.subscriptions
         set status = 'past_due', past_due_since = v_today, grace_until = v_today + v_grace, updated_at = now()
       where firm_id = r.firm_id and status in ('active', 'trial');
    end if;
    insert into public.billing_runs as b (firm_id, month, outcome, fee_paise, detail, wallet_entry_id, run_by)
    values (r.firm_id, v_month, v_out, v_amt, v_fee, v_entry, p_by)
    on conflict (firm_id, month) do update set outcome = excluded.outcome, fee_paise = excluded.fee_paise, detail = excluded.detail,
      wallet_entry_id = excluded.wallet_entry_id, tries = b.tries + 1, run_at = now(), run_by = excluded.run_by;
    v_count := v_count || jsonb_build_object(v_out, coalesce((v_count ->> v_out)::integer, 0) + 1);
    select status into v_status from public.subscriptions where firm_id = r.firm_id;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('firm_id', r.firm_id, 'firm', (select name from public.firms where id = r.firm_id),
                                                             'outcome', v_out, 'fee_paise', v_amt, 'status', v_status));
  end loop;
  -- the stages: past due -> read-only after the grace days; read-only -> paused after paused_after_days
  update public.subscriptions set status = 'read_only', read_only_since = v_today, updated_at = now()
   where status = 'past_due' and grace_until is not null and v_today > grace_until and (p_firm is null or firm_id = p_firm);
  get diagnostics n = row_count;
  v_count := v_count || jsonb_build_object('to_read_only', n);
  update public.subscriptions set status = 'paused', paused_since = v_today, updated_at = now()
   where status = 'read_only' and past_due_since is not null and v_today >= past_due_since + v_pause and (p_firm is null or firm_id = p_firm);
  get diagnostics n = row_count;
  v_count := v_count || jsonb_build_object('to_paused', n);
  perform public.console_audit_add(p_by, v_role, 'billing.run', case when p_firm is null then null else 'firm' end, p_firm::text, null,
    jsonb_build_object('month', v_month, 'mode', p_mode, 'counts', v_count), p_reason, null, null);
  return jsonb_build_object('month', v_month, 'mode', p_mode, 'counts', v_count, 'rows', v_rows);
end $$;

-- the scheduled jobs' entry: 'monthly' runs only on the 1st (India time; the job fires on the last evenings of a month
-- in UTC), 'daily' retries the short ones and moves the stages
create or replace function public.console_billing_cron(p_what text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_what = 'monthly' then
    if extract(day from (now() at time zone 'Asia/Kolkata')) <> 1 then return jsonb_build_object('skipped', 'not the 1st'); end if;
    return public.console_billing_run(null, null, 'month');
  end if;
  -- daily: the prices whose date has come reach modules.price (what old readers see), then the retry
  update public.modules m set price = round(x.price_paise / 100.0, 2)
    from (select i.module_code, public.price_list_at(i.code, null) as price_paise from public.price_items i where i.module_code is not null) x
   where x.module_code = m.code and x.price_paise is not null and m.price <> x.price_paise / 100.0;
  return public.console_billing_run(null, null, 'retry');
end $$;

-- the old "Run this month's charges" (run_monthly -> run_monthly_core): the new run, in the old answer's shape
create or replace function public.run_monthly_core(p_firm uuid default null, p_by uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := public.console_billing_run(p_firm, case when exists (select 1 from public.console_admins a where a.user_id = p_by and a.active and a.role in ('owner', 'billing')) then p_by end, 'month');
  return jsonb_build_object('ok', true, 'charged', coalesce((v -> 'counts' ->> 'charged')::integer, 0) + coalesce((v -> 'counts' ->> 'free')::integer, 0),
                            'short_of_credit', coalesce((v -> 'counts' ->> 'short')::integer, 0));
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('console-billing-monthly', '35 18 28-31 * *', 'select public.console_billing_cron(''monthly'')');
    perform cron.schedule('console-billing-daily', '50 18 * * *', 'select public.console_billing_cron(''daily'')');
  else
    raise notice 'console 119: pg_cron is not here; the monthly run is not scheduled (Run now still works)';
  end if;
end $$;

-- ---------------------------------------------------------------- console: plans
create or replace function public.console_plan_json(p public.plans)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'note', p.note, 'active', p.active, 'on_website', p.on_website, 'sort', p.sort,
           'monthly_fee_paise', round(coalesce(p.monthly_fee, 0) * 100), 'yearly_fee_paise', p.yearly_fee_paise,
           'per_client_fee_paise', p.per_client_fee_paise, 'included_clients', p.included_clients, 'included_users', p.included_users,
           'features', p.features, 'ai_allowance_paise', p.ai_allowance_paise,
           'includes', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p.includes) x(k, v) where k <> 'clients_price'),
           'firms', (select count(*) from public.firms f where f.plan_id = p.id),
           'created_at', p.created_at, 'updated_at', p.updated_at)
$$;

create or replace function public.console_plans()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.console_plan_json(p) order by p.sort, p.name), '[]'::jsonb) from public.plans p
$$;


-- a whole number from a json object, within [lo, hi] (null when the key holds null); otherwise console: <code>
create or replace function public.console_jint(p jsonb, k text, lo numeric, hi numeric, code text default 'bad_value')
returns bigint language plpgsql immutable set search_path = '' as $$
declare v jsonb := p -> k;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
     or (v #>> '{}')::numeric < lo or (v #>> '{}')::numeric > hi then
    raise exception 'console: %', code using errcode = '22023';
  end if;
  return (v #>> '{}')::bigint;
end $$;

-- create (p_plan without id) or edit a plan. p_plan: name (required for a new plan), code, note, active, on_website, sort,
-- monthly_fee_paise, yearly_fee_paise, per_client_fee_paise, included_clients, included_users, features (a list of
-- text), ai_allowance_paise (-1 = fair use), includes ({item: {cap: n | null, price_after: rupees | null}}: replaces the
-- item allowances; keys that are not items, such as clients_price, are kept). A key left out keeps its value.
create or replace function public.console_plan_save(p_by uuid, p_plan jsonb, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text; v_old public.plans; v_new public.plans; v_id uuid; v_inc jsonb := '{}'::jsonb; k text; v jsonb;
  v_before jsonb; v_cap numeric; v_after numeric; v_code text; v_name text;
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then raise exception 'console: bad_value' using errcode = '22023'; end if;
  begin v_id := nullif(p_plan ->> 'id', '')::uuid; exception when others then raise exception 'console: no_plan' using errcode = 'P0002'; end;
  if v_id is not null then
    select * into v_old from public.plans where id = v_id for update;
    if not found then raise exception 'console: no_plan' using errcode = 'P0002'; end if;
    v_before := public.console_plan_json(v_old);
  end if;
  v_name := btrim(coalesce(p_plan ->> 'name', v_old.name, ''));
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'console: bad_plan_name' using errcode = '22023'; end if;
  if exists (select 1 from public.plans where lower(name) = lower(v_name) and id is distinct from v_id) then
    raise exception 'console: plan_exists' using errcode = '23505';
  end if;
  v_code := case when p_plan ? 'code' then nullif(lower(btrim(coalesce(p_plan ->> 'code', ''))), '') else v_old.code end;
  if v_code is not null and (v_code !~ '^[a-z0-9][a-z0-9_-]{1,39}$' or exists (select 1 from public.plans where code = v_code and id is distinct from v_id)) then
    raise exception 'console: bad_plan_code' using errcode = '22023';
  end if;
  if p_plan ? 'features' and (jsonb_typeof(p_plan -> 'features') <> 'array' or jsonb_array_length(p_plan -> 'features') > 30
      or exists (select 1 from jsonb_array_elements(p_plan -> 'features') e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 160)) then
    raise exception 'console: bad_features' using errcode = '22023';
  end if;
  -- the item allowances
  if p_plan ? 'includes' then
    if jsonb_typeof(p_plan -> 'includes') <> 'object' then raise exception 'console: bad_item' using errcode = '22023'; end if;
    for k, v in select x.key, x.value from jsonb_each(p_plan -> 'includes') x loop
      if k = 'clients' or not exists (select 1 from public.modules m where m.code = k) or jsonb_typeof(v) <> 'object' then
        raise exception 'console: bad_item' using errcode = '22023';
      end if;
      v_cap := public.console_jint(v, 'cap', 0, 100000000, 'bad_item');
      if k = 'cloud' and v_cap is not null then raise exception 'console: bad_item' using errcode = '22023'; end if;
      if v ? 'price_after' and jsonb_typeof(v -> 'price_after') not in ('number', 'null') then raise exception 'console: bad_item' using errcode = '22023'; end if;
      v_after := (v ->> 'price_after')::numeric;
      if v_after is not null and (v_after < 0 or v_after > 100000) then raise exception 'console: bad_item' using errcode = '22023'; end if;
      v_inc := v_inc || jsonb_build_object(k, case when v_cap is null then jsonb_build_object('cap', null)
                                                   else jsonb_build_object('cap', v_cap, 'price_after', v_after) end);
    end loop;
    v_inc := (select coalesce(jsonb_object_agg(x.key, x.value), '{}'::jsonb) from jsonb_each(coalesce(v_old.includes, '{}'::jsonb)) x
               where not exists (select 1 from public.modules m where m.code = x.key)) || v_inc;
  else
    v_inc := coalesce(v_old.includes, '{}'::jsonb);
  end if;
  if v_id is null then
    insert into public.plans (name, code, note, active, on_website, sort, monthly_fee, yearly_fee_paise, per_client_fee_paise, included_clients,
                              included_users, features, ai_allowance_paise, includes, updated_at, updated_by)
    values (v_name, v_code, left(coalesce(p_plan ->> 'note', ''), 500), coalesce((p_plan ->> 'active')::boolean, true),
            coalesce((p_plan ->> 'on_website')::boolean, false), coalesce(public.console_jint(p_plan, 'sort', -1000, 1000), 0),
            round(coalesce(public.console_jint(p_plan, 'monthly_fee_paise', 0, 100000000), 0) / 100.0, 2),
            public.console_jint(p_plan, 'yearly_fee_paise', 0, 1000000000), public.console_jint(p_plan, 'per_client_fee_paise', 0, 10000000),
            public.console_jint(p_plan, 'included_clients', 0, 100000), public.console_jint(p_plan, 'included_users', 0, 100000),
            coalesce(p_plan -> 'features', '[]'::jsonb), public.console_jint(p_plan, 'ai_allowance_paise', -1, 100000000), v_inc, now(), p_by)
    returning * into v_new;
  else
    update public.plans set
      name = v_name, code = v_code,
      note = case when p_plan ? 'note' then left(coalesce(p_plan ->> 'note', ''), 500) else note end,
      active = case when p_plan ? 'active' then coalesce((p_plan ->> 'active')::boolean, active) else active end,
      on_website = case when p_plan ? 'on_website' then coalesce((p_plan ->> 'on_website')::boolean, on_website) else on_website end,
      sort = case when p_plan ? 'sort' then coalesce(public.console_jint(p_plan, 'sort', -1000, 1000), 0) else sort end,
      monthly_fee = case when p_plan ? 'monthly_fee_paise' then round(coalesce(public.console_jint(p_plan, 'monthly_fee_paise', 0, 100000000), 0) / 100.0, 2) else monthly_fee end,
      yearly_fee_paise = case when p_plan ? 'yearly_fee_paise' then public.console_jint(p_plan, 'yearly_fee_paise', 0, 1000000000) else yearly_fee_paise end,
      per_client_fee_paise = case when p_plan ? 'per_client_fee_paise' then public.console_jint(p_plan, 'per_client_fee_paise', 0, 10000000) else per_client_fee_paise end,
      included_clients = case when p_plan ? 'included_clients' then public.console_jint(p_plan, 'included_clients', 0, 100000) else included_clients end,
      included_users = case when p_plan ? 'included_users' then public.console_jint(p_plan, 'included_users', 0, 100000) else included_users end,
      features = case when p_plan ? 'features' then p_plan -> 'features' else features end,
      ai_allowance_paise = case when p_plan ? 'ai_allowance_paise' then public.console_jint(p_plan, 'ai_allowance_paise', -1, 100000000) else ai_allowance_paise end,
      includes = v_inc, updated_at = now(), updated_by = p_by
    where id = v_id returning * into v_new;
  end if;
  perform public.console_audit_add(p_by, v_role, 'plan.save', 'plan', v_new.id::text, v_before, public.console_plan_json(v_new), p_reason, p_ip, p_ua);
  return public.console_plan_json(v_new);
end $$;

-- ---------------------------------------------------------------- console: prices
create or replace function public.console_prices()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'code', i.code, 'title', i.title, 'unit', i.unit, 'kind', i.kind, 'module_code', i.module_code, 'active', i.active, 'sort', i.sort,
      'price_paise', public.price_list_at(i.code, v_today),
      'since', (select max(p.effective_from) from public.price_list p where p.item_code = i.code and p.effective_from <= v_today),
      'next_price_paise', (select p.price_paise from public.price_list p where p.item_code = i.code and p.effective_from > v_today order by p.effective_from limit 1),
      'next_from', (select min(p.effective_from) from public.price_list p where p.item_code = i.code and p.effective_from > v_today),
      'versions', (select count(*) from public.price_list p where p.item_code = i.code),
      'firm_prices', (select count(*) from public.firm_modules fm where fm.code = i.module_code and fm.price is not null))
    order by i.sort, i.code), '[]'::jsonb) from public.price_items i);
end $$;

create or replace function public.console_price_history(p_item text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'item_code', p.item_code, 'price_paise', p.price_paise, 'effective_from', p.effective_from,
           'reason', p.reason, 'set_by', u.email, 'set_at', p.set_at) order by p.effective_from desc), '[]'::jsonb)
    from public.price_list p left join auth.users u on u.id = p.set_by
   where p.item_code = p_item
$$;

-- a new price from a date (today or later; never backwards). The same date again replaces that date's price.
create or replace function public.console_price_set(p_by uuid, p_item text, p_price_paise bigint, p_from date, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_item public.price_items; v_before bigint;
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  select * into v_item from public.price_items where code = p_item;
  if not found then raise exception 'console: no_item' using errcode = 'P0002'; end if;
  if p_price_paise is null or p_price_paise < 0 or p_price_paise > 100000000 then raise exception 'console: bad_amount' using errcode = '22023'; end if;
  if p_from is null or p_from < v_today then raise exception 'console: backdated' using errcode = '22023'; end if;
  if p_from > v_today + 400 then raise exception 'console: bad_date' using errcode = '22023'; end if;
  v_before := public.price_list_at(p_item, p_from);
  insert into public.price_list (item_code, price_paise, effective_from, reason, set_by)
  values (p_item, p_price_paise, p_from, left(p_reason, 1000), p_by)
  on conflict (item_code, effective_from) do update set price_paise = excluded.price_paise, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  if p_from = v_today and v_item.module_code is not null then
    update public.modules set price = round(p_price_paise / 100.0, 2) where code = v_item.module_code;
  end if;
  perform public.console_audit_add(p_by, v_role, 'price.set', 'price', p_item, jsonb_build_object('price_paise', v_before),
    jsonb_build_object('price_paise', p_price_paise, 'effective_from', p_from), p_reason, p_ip, p_ua);
  return jsonb_build_object('item', p_item, 'price_paise', p_price_paise, 'effective_from', p_from, 'before_paise', v_before);
end $$;

-- ---------------------------------------------------------------- console: subscriptions
create or replace function public.console_ai_used_paise(p_firm uuid, p_from date)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare n numeric := 0;
begin
  if to_regclass('public.assistant_usage') is not null then
    execute 'select coalesce(sum(cost_inr), 0) from public.assistant_usage where firm_id = $1 and day >= $2' into n using p_firm, p_from;
  end if;
  return round(n * 100);
end $$;

create or replace function public.console_subscriptions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'firm_id', f.id, 'firm', f.name, 'is_test', f.is_test, 'firm_status', f.status, 'plan_id', s.plan_id, 'plan', coalesce(p.name, 'No plan'),
      'status', s.status, 'billing_cycle', s.billing_cycle, 'period_start', s.period_start, 'renews_on', s.renews_on,
      'trial_ends_on', s.trial_ends_on, 'past_due_since', s.past_due_since, 'grace_until', s.grace_until,
      'balance', f.balance, 'low_balance_warn', f.low_balance_warn, 'low', f.balance <= f.low_balance_warn,
      'used', (select coalesce(sum(u.spent), 0) from public.usage_period u where u.firm_id = f.id and u.period_start = f.period_start),
      'clients', (select count(*) from public.clients c where c.firm_id = f.id and not coalesce(c.deleted, false) and coalesce(c.status, 'active') = 'active'),
      'users', (select count(*) from public.members m where m.firm_id = f.id and m.active),
      'ai_used', public.console_ai_used_paise(f.id, v_month) / 100.0, 'ai_allowance', p.ai_allowance_paise / 100.0,
      'this_month', (select b.outcome from public.billing_runs b where b.firm_id = f.id and b.month = v_month))
    order by f.name), '[]'::jsonb)
    from public.subscriptions s join public.firms f on f.id = s.firm_id left join public.plans p on p.id = s.plan_id);
end $$;

create or replace function public.console_subscription(p_firm uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.subscriptions; f public.firms; p public.plans; v_month date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
begin
  select * into f from public.firms where id = p_firm;
  if not found then return null; end if;
  select * into s from public.subscriptions where firm_id = p_firm;
  select * into p from public.plans where id = coalesce(s.plan_id, f.plan_id);
  return jsonb_build_object(
    'firm_id', f.id, 'firm', f.name, 'is_test', f.is_test, 'firm_status', f.status, 'balance', f.balance, 'low_balance_warn', f.low_balance_warn,
    'subscription', to_jsonb(s), 'plan', case when p.id is null then null else public.console_plan_json(p) end,
    'fee', public.console_billing_fee(p_firm),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'title', m.title, 'unit', m.unit,
                'qty', coalesce(u.qty, 0), 'spent', coalesce(u.spent, 0), 'in_plan', (p.includes -> m.code) is not null,
                'cap', nullif(p.includes -> m.code ->> 'cap', '')::numeric, 'price', public.price_of(p_firm, m.code)) order by m.sort), '[]'::jsonb)
                from public.modules m left join public.usage_period u on u.firm_id = p_firm and u.period_start = f.period_start and u.code = m.code
               where m.active and m.billing = 'per_unit'),
    'clients', jsonb_build_object('count', (select count(*) from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false) and coalesce(c.status, 'active') = 'active'),
                                  'included', p.included_clients),
    'users', jsonb_build_object('count', (select count(*) from public.members m where m.firm_id = p_firm and m.active), 'included', p.included_users),
    'ai', jsonb_build_object('used_paise', public.console_ai_used_paise(p_firm, v_month), 'allowance_paise', p.ai_allowance_paise),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('month', b.month, 'outcome', b.outcome, 'fee_paise', b.fee_paise, 'tries', b.tries, 'run_at', b.run_at)
               order by b.month desc), '[]'::jsonb) from (select * from public.billing_runs where firm_id = p_firm order by month desc limit 12) b));
end $$;

create or replace function public.console_sub_change_plan(p_by uuid, p_firm uuid, p_plan uuid, p_cycle text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; s public.subscriptions; v_old public.plans; v_new public.plans; v_fm record; v_cycle text;
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  select * into s from public.subscriptions where firm_id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  select * into v_new from public.plans where id = p_plan;
  if not found then raise exception 'console: no_plan' using errcode = 'P0002'; end if;
  if not v_new.active then raise exception 'console: plan_retired' using errcode = '22023'; end if;
  v_cycle := coalesce(nullif(p_cycle, ''), s.billing_cycle);
  if v_cycle not in ('monthly', 'yearly') then raise exception 'console: bad_value' using errcode = '22023'; end if;
  if v_cycle = 'yearly' and v_new.yearly_fee_paise is null then raise exception 'console: no_yearly' using errcode = '22023'; end if;
  if s.plan_id is not distinct from p_plan and s.billing_cycle = v_cycle then raise exception 'console: same_status' using errcode = '22023'; end if;
  select * into v_old from public.plans where id = s.plan_id;
  update public.firms set plan_id = p_plan where id = p_firm;
  update public.subscriptions set plan_id = p_plan, billing_cycle = v_cycle, updated_at = now(), updated_by = p_by where firm_id = p_firm;
  -- the per-client price: the new plan's, unless the firm has its own (a price that is not the old plan's is kept)
  select * into v_fm from public.firm_modules where firm_id = p_firm and code = 'clients';
  if v_fm is null or v_fm.price is null or (v_old.per_client_fee_paise is not null and round(v_fm.price * 100) = v_old.per_client_fee_paise) or not v_fm.enabled then
    if v_new.per_client_fee_paise is not null then
      insert into public.firm_modules (firm_id, code, enabled, price) values (p_firm, 'clients', true, round(v_new.per_client_fee_paise / 100.0, 2))
      on conflict (firm_id, code) do update set enabled = true, price = excluded.price;
    elsif v_fm is not null then
      update public.firm_modules set enabled = false, price = null where firm_id = p_firm and code = 'clients';
    end if;
  end if;
  perform public.console_audit_add(p_by, v_role, 'sub.change_plan', 'firm', p_firm::text,
    jsonb_build_object('plan', v_old.name, 'plan_id', s.plan_id, 'cycle', s.billing_cycle),
    jsonb_build_object('plan', v_new.name, 'plan_id', p_plan, 'cycle', v_cycle), p_reason, p_ip, p_ua);
  return jsonb_build_object('firm_id', p_firm, 'plan_id', p_plan, 'plan', v_new.name, 'billing_cycle', v_cycle);
end $$;

-- set a subscription's status by hand: extend a trial (trial + a date), mark active, past due, read-only, paused, cancelled
create or replace function public.console_sub_set_status(p_by uuid, p_firm uuid, p_status text, p_trial_ends_on date, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; s public.subscriptions; v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_grace integer := coalesce((public.console_billing_settings() ->> 'grace_days')::integer, 7);
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  if p_status is null or p_status not in ('trial', 'active', 'past_due', 'read_only', 'paused', 'cancelled') then
    raise exception 'console: bad_status' using errcode = '22023';
  end if;
  select * into s from public.subscriptions where firm_id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  if p_status = 'trial' and (p_trial_ends_on is null or p_trial_ends_on <= v_today or p_trial_ends_on > v_today + 366) then
    raise exception 'console: bad_date' using errcode = '22023';
  end if;
  if s.status = p_status and (p_status <> 'trial' or s.trial_ends_on = p_trial_ends_on) then raise exception 'console: same_status' using errcode = '22023'; end if;
  update public.subscriptions set
    status = p_status,
    trial_ends_on = case when p_status = 'trial' then p_trial_ends_on else trial_ends_on end,
    past_due_since = case when p_status in ('trial', 'active', 'cancelled') then null when p_status = 'past_due' then v_today else coalesce(past_due_since, v_today) end,
    grace_until = case when p_status in ('trial', 'active', 'cancelled') then null when p_status = 'past_due' then v_today + v_grace else grace_until end,
    read_only_since = case when p_status = 'read_only' then v_today when p_status = 'paused' then read_only_since else null end,
    paused_since = case when p_status = 'paused' then v_today else null end,
    status_reason = left(p_reason, 1000), updated_at = now(), updated_by = p_by
  where firm_id = p_firm;
  perform public.console_audit_add(p_by, v_role, 'sub.set_status', 'firm', p_firm::text,
    jsonb_build_object('status', s.status, 'trial_ends_on', s.trial_ends_on), jsonb_build_object('status', p_status, 'trial_ends_on', p_trial_ends_on), p_reason, p_ip, p_ua);
  return jsonb_build_object('firm_id', p_firm, 'status', p_status);
end $$;

-- ---------------------------------------------------------------- console: the ledger
create or replace function public.console_ledger(p_firm uuid, p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'at', w.at, 'firm_id', w.firm_id, 'firm', f.name, 'is_test', f.is_test, 'kind', w.kind, 'code', w.code, 'qty', w.qty,
           'amount', w.amount, 'amount_paise', round(w.amount * 100), 'balance_after', w.balance_after, 'note', w.note, 'ref', w.ref,
           'reason', w.reason, 'category', w.category, 'pay_mode', w.pay_mode, 'pay_ref', w.pay_ref, 'received_on', w.received_on,
           'by_email', u.email, 'reverses_id', w.reverses_id,
           'refunded', case when w.kind in ('charge', 'fee') then (select coalesce(sum(r.amount), 0) from public.wallet_entries r where r.reverses_id = w.id and r.kind = 'refund') end)
         order by w.id desc), '[]'::jsonb)
    from (select * from public.wallet_entries x where p_firm is null or x.firm_id = p_firm order by x.id desc
           limit least(greatest(coalesce(p_limit, 5000), 1), 5000)) w
    join public.firms f on f.id = w.firm_id
    left join auth.users u on u.id = w.by_user
$$;

create or replace function public.console_money_role(p_by uuid, p_paise bigint)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text := public.console_role_check(p_by, array['owner', 'billing']);
begin
  -- Billing refunds and adjusts up to ₹10,000 an entry; above that an Owner (console-plan.md 2.4)
  if v = 'billing' and abs(p_paise) > 1000000 then raise exception 'console: owner_needed' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.console_credit_topup(p_by uuid, p_firm uuid, p_amount_paise bigint, p_pay_mode text, p_pay_ref text,
  p_received_on date, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_post jsonb; v_ref text; v_bal numeric; v_sub text;
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'console: bad_amount' using errcode = '22023'; end if;
  if p_amount_paise > 100000000 then raise exception 'console: too_large' using errcode = '22023'; end if;
  if p_pay_mode is null or p_pay_mode not in ('bank', 'upi', 'cheque', 'cash', 'gateway', 'other') then raise exception 'console: bad_pay_mode' using errcode = '22023'; end if;
  v_ref := btrim(coalesce(p_pay_ref, ''));
  if length(v_ref) < 3 or length(v_ref) > 100 then raise exception 'console: bad_pay_ref' using errcode = '22023'; end if;
  if p_received_on is not null and (p_received_on > (now() at time zone 'Asia/Kolkata')::date or p_received_on < date '2020-01-01') then
    raise exception 'console: bad_date' using errcode = '22023';
  end if;
  select balance into v_bal from public.firms where id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  perform set_config('fincom.ledger_meta', jsonb_build_object('note', 'Top-up (' || p_pay_mode || ' ' || v_ref || ')', 'ref', v_ref, 'pay_mode', p_pay_mode,
                                                              'pay_ref', v_ref, 'received_on', p_received_on)::text, true);
  v_post := public.console_credit_post(p_firm, p_amount_paise, 'topup', p_firm::text || ':' || lower(v_ref), p_reason, p_by);
  if not (v_post ->> 'duplicate')::boolean then
    perform public.console_audit_add(p_by, v_role, 'credit.topup', 'firm', p_firm::text, jsonb_build_object('balance', v_bal),
      jsonb_build_object('amount_paise', p_amount_paise, 'pay_mode', p_pay_mode, 'pay_ref', v_ref, 'entry_id', v_post -> 'entry_id', 'balance', v_post -> 'balance'),
      p_reason, p_ip, p_ua);
    -- a firm that was short at this month's run: try the fee again now
    select status into v_sub from public.subscriptions where firm_id = p_firm;
    if v_sub in ('past_due', 'read_only', 'paused') then
      v_post := v_post || jsonb_build_object('run', public.console_billing_run(p_firm, p_by, 'retry'));
    end if;
  end if;
  return v_post;
end $$;

-- refund one charge (or monthly fee) line, all of it or part; never more than is left of it. p_key: the dialog's own
-- key, so a second press of the same dialog changes nothing
create or replace function public.console_credit_refund(p_by uuid, p_entry bigint, p_amount_paise bigint, p_key text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; e public.wallet_entries; v_left bigint; v_amt bigint; v_post jsonb;
begin
  perform public.console_role_check(p_by, array['owner', 'billing']);
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'console: bad_ref' using errcode = '22023'; end if;
  select * into e from public.wallet_entries where id = p_entry;
  if not found then raise exception 'console: no_entry' using errcode = 'P0002'; end if;
  if e.kind not in ('charge', 'fee') then raise exception 'console: not_a_charge' using errcode = '22023'; end if;
  perform 1 from public.firms where id = e.firm_id for update;
  -- the same dialog again: the first answer
  if exists (select 1 from public.wallet_entries where idem_key = 'refund:' || p_entry || ':' || p_key) then
    return public.console_credit_post(e.firm_id, (select round(amount * 100)::bigint from public.wallet_entries where idem_key = 'refund:' || p_entry || ':' || p_key),
                                      'refund', p_entry || ':' || p_key, p_reason, p_by);
  end if;
  v_left := round(-e.amount * 100) - (select coalesce(round(sum(r.amount) * 100), 0) from public.wallet_entries r where r.reverses_id = e.id and r.kind = 'refund');
  v_amt := coalesce(p_amount_paise, v_left);
  if v_amt <= 0 then raise exception 'console: bad_amount' using errcode = '22023'; end if;
  if v_amt > v_left then raise exception 'console: over_refund' using errcode = '22023'; end if;
  v_role := public.console_money_role(p_by, v_amt);
  perform set_config('fincom.ledger_meta', jsonb_build_object('code', e.code, 'qty', 1, 'note', 'Refund of entry #' || e.id || coalesce(' (' || nullif(e.note, '') || ')', ''),
                                                              'ref', e.ref, 'reverses_id', e.id, 'category', 'refund')::text, true);
  v_post := public.console_credit_post(e.firm_id, v_amt, 'refund', p_entry || ':' || p_key, p_reason, p_by);
  perform public.console_audit_add(p_by, v_role, 'credit.refund', 'firm', e.firm_id::text,
    jsonb_build_object('entry_id', e.id, 'charge_paise', round(-e.amount * 100), 'left_paise', v_left),
    jsonb_build_object('amount_paise', v_amt, 'refund_entry_id', v_post -> 'entry_id', 'balance', v_post -> 'balance'), p_reason, p_ip, p_ua);
  return v_post;
end $$;

-- an adjustment (+ or -) with a reason and a category
create or replace function public.console_credit_adjust(p_by uuid, p_firm uuid, p_amount_paise bigint, p_category text, p_key text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_post jsonb; v_bal numeric;
begin
  perform public.console_role_check(p_by, array['owner', 'billing']);
  if p_amount_paise is null or p_amount_paise = 0 or abs(p_amount_paise) > 100000000 then raise exception 'console: bad_amount' using errcode = '22023'; end if;
  if p_category is null or p_category not in ('goodwill', 'correction', 'test_cleanup', 'other') then raise exception 'console: bad_category' using errcode = '22023'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'console: bad_ref' using errcode = '22023'; end if;
  v_role := public.console_money_role(p_by, p_amount_paise);
  select balance into v_bal from public.firms where id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  perform set_config('fincom.ledger_meta', jsonb_build_object('note', 'Adjustment (' || p_category || ')', 'ref', '', 'category', p_category)::text, true);
  v_post := public.console_credit_post(p_firm, p_amount_paise, 'adjust', p_firm::text || ':' || p_key, p_reason, p_by);
  if not (v_post ->> 'duplicate')::boolean then
    perform public.console_audit_add(p_by, v_role, 'credit.adjust', 'firm', p_firm::text, jsonb_build_object('balance', v_bal),
      jsonb_build_object('amount_paise', p_amount_paise, 'category', p_category, 'entry_id', v_post -> 'entry_id', 'balance', v_post -> 'balance'), p_reason, p_ip, p_ua);
  end if;
  return v_post;
end $$;

-- balance = ledger, per firm: the balance, the sum of its ledger lines, the difference, and how many lines' balance_after
-- does not follow from the line before
create or replace function public.console_ledger_check()
returns jsonb language sql stable security definer set search_path = '' as $$
  with chain as (
    select w.firm_id, count(*) filter (where w.balance_after <> coalesce(w.prev, 0) + w.amount) as breaks
      from (select firm_id, amount, balance_after, lag(balance_after) over (partition by firm_id order by id) as prev from public.wallet_entries) w
     group by w.firm_id),
  sums as (select firm_id, sum(amount) as total, count(*) as n, max(at) as last_at from public.wallet_entries group by firm_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'firm_id', f.id, 'firm', f.name, 'is_test', f.is_test, 'balance', f.balance, 'ledger_sum', coalesce(s.total, 0),
           'diff', f.balance - coalesce(s.total, 0), 'entries', coalesce(s.n, 0), 'chain_breaks', coalesce(c.breaks, 0),
           'last_entry_at', s.last_at, 'ok', f.balance = coalesce(s.total, 0)) order by (f.balance = coalesce(s.total, 0)), f.name), '[]'::jsonb)
    from public.firms f left join sums s on s.firm_id = f.id left join chain c on c.firm_id = f.id
$$;

-- the adjusting entry that brings the ledger to the balance (Owner): one line of the difference, kind "opening" when the
-- firm has no line at all, else "adjust" (category reconcile). The balance does not move, so this is the one ledger line
-- written outside console_credit_post.
create or replace function public.console_ledger_fix(p_by uuid, p_firm uuid, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_bal numeric; v_sum numeric; v_n bigint; v_id bigint; v_kind text;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'console: reason' using errcode = '22023'; end if;
  select balance into v_bal from public.firms where id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  select coalesce(sum(amount), 0), count(*) into v_sum, v_n from public.wallet_entries where firm_id = p_firm;
  if v_bal = v_sum then raise exception 'console: nothing_to_fix' using errcode = '22023'; end if;
  v_kind := case when v_n = 0 then 'opening' else 'adjust' end;
  insert into public.wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, ref, by_user, reason, category, idem_key)
  values (p_firm, v_kind, 'wallet', 1, v_bal - v_sum, v_bal,
          case when v_n = 0 then 'Opening balance: the ledger had no line for it' else 'Adjusting entry: the ledger brought to the balance' end,
          'reconcile', p_by, left(btrim(p_reason), 1000), 'reconcile', 'reconcile:' || p_firm::text || ':' || v_n)
  returning id into v_id;
  perform public.console_audit_add(p_by, v_role, 'ledger.fix', 'firm', p_firm::text, jsonb_build_object('balance', v_bal, 'ledger_sum', v_sum, 'entries', v_n),
    jsonb_build_object('entry_id', v_id, 'kind', v_kind, 'amount', v_bal - v_sum), p_reason, p_ip, p_ua);
  return jsonb_build_object('entry_id', v_id, 'kind', v_kind, 'amount', v_bal - v_sum, 'balance', v_bal);
end $$;

-- ---------------------------------------------------------------- console: data clean-up (the owner presses; never automatic)
-- what looks wrong: a credit of ₹10 lakh or more on a firm not marked as a test firm; a balance with no ledger line; a
-- balance that differs from its ledger
create or replace function public.console_cleanup_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select firm_id, sum(amount) as total, count(*) as n from public.wallet_entries group by firm_id),
  x as (
    select f.id, f.name, f.is_test, f.balance, coalesce(s.total, 0) as ledger_sum, coalesce(s.n, 0) as entries from public.firms f left join s on s.firm_id = f.id)
  select coalesce(jsonb_agg(jsonb_build_object('firm_id', i.id, 'firm', i.name, 'is_test', i.is_test, 'balance', i.balance, 'ledger_sum', i.ledger_sum,
           'entries', i.entries, 'issue', i.issue, 'action', i.action) order by i.issue, i.name), '[]'::jsonb)
    from (select x.*, 'large_credit' as issue, 'cleanup.test_credit' as action from x where x.balance >= 1000000 and not x.is_test
          union all
          select x.*, 'no_ledger', 'ledger.fix' from x where x.entries = 0 and x.balance <> 0
          union all
          select x.*, 'mismatch', 'ledger.fix' from x where x.entries > 0 and x.balance <> x.ledger_sum) i
$$;

-- mark a firm as a test firm and bring its credit to p_target_paise (default ₹10,000) with one adjust line
-- (category test_cleanup). Pressing it again changes nothing.
create or replace function public.console_cleanup_test_credit(p_by uuid, p_firm uuid, p_target_paise bigint, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_bal numeric; v_test boolean; v_delta bigint; v_post jsonb; v_target bigint := coalesce(p_target_paise, 1000000);
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if v_target < 0 or v_target > 100000000 then raise exception 'console: bad_amount' using errcode = '22023'; end if;
  select balance, is_test into v_bal, v_test from public.firms where id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  v_delta := v_target - round(v_bal * 100)::bigint;
  if v_test and v_delta = 0 then raise exception 'console: nothing_to_fix' using errcode = '22023'; end if;
  update public.firms set is_test = true where id = p_firm;
  if v_delta <> 0 then
    perform set_config('fincom.ledger_meta', jsonb_build_object('note', 'Test credit brought to ₹' || to_char(v_target / 100.0, 'FM99999990.00'), 'ref', '',
                                                                'category', 'test_cleanup')::text, true);
    v_post := public.console_credit_post(p_firm, v_delta, 'adjust', 'cleanup:test_credit:' || p_firm::text || ':' || v_target || ':' || round(v_bal * 100)::bigint, p_reason, p_by);
  end if;
  perform public.console_audit_add(p_by, v_role, 'cleanup.test_credit', 'firm', p_firm::text, jsonb_build_object('balance', v_bal, 'is_test', v_test),
    jsonb_build_object('balance', round(v_target / 100.0, 2), 'is_test', true, 'adjust_paise', v_delta, 'entry_id', v_post -> 'entry_id'), p_reason, p_ip, p_ua);
  return jsonb_build_object('firm_id', p_firm, 'is_test', true, 'balance', round(v_target / 100.0, 2), 'adjust_paise', v_delta);
end $$;

-- ---------------------------------------------------------------- console: the run's report, the settings
create or replace function public.console_billing_runs(p_month date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('firm_id', b.firm_id, 'firm', f.name, 'is_test', f.is_test, 'month', b.month, 'outcome', b.outcome,
           'fee', round(b.fee_paise / 100.0, 2), 'tries', b.tries, 'run_at', b.run_at, 'run_by', coalesce(u.email, 'scheduled'), 'status', s.status,
           'balance', f.balance, 'wallet_entry_id', b.wallet_entry_id) order by b.month desc, f.name), '[]'::jsonb)
    from public.billing_runs b join public.firms f on f.id = b.firm_id
    left join public.subscriptions s on s.firm_id = b.firm_id left join auth.users u on u.id = b.run_by
   where p_month is null or b.month = date_trunc('month', p_month)::date
$$;

create or replace function public.console_billing_settings_set(p_by uuid, p_value jsonb, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_before jsonb := public.console_billing_settings(); v_new jsonb := '{}'::jsonb; k text;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if p_value is null or jsonb_typeof(p_value) <> 'object' or p_value = '{}'::jsonb then raise exception 'console: bad_setting' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_value) loop
    if k not in ('start_credit', 'low_credit_warn', 'grace_days', 'paused_after_days', 'trial_days') then raise exception 'console: bad_setting' using errcode = '22023'; end if;
  end loop;
  v_new := jsonb_strip_nulls(jsonb_build_object(
    'start_credit', public.console_jint(p_value, 'start_credit', 0, 100000000, 'bad_setting'),
    'low_credit_warn', public.console_jint(p_value, 'low_credit_warn', 0, 10000000, 'bad_setting'),
    'grace_days', public.console_jint(p_value, 'grace_days', 0, 90, 'bad_setting'),
    'paused_after_days', public.console_jint(p_value, 'paused_after_days', 1, 365, 'bad_setting'),
    'trial_days', public.console_jint(p_value, 'trial_days', 0, 90, 'bad_setting')));
  if ((v_before || v_new) ->> 'paused_after_days')::integer <= ((v_before || v_new) ->> 'grace_days')::integer then
    raise exception 'console: bad_setting' using errcode = '22023';
  end if;
  insert into public.console_settings (key, value, updated_by, updated_at) values ('billing', v_new, p_by, now())
  on conflict (key) do update set value = public.console_settings.value || excluded.value, updated_by = p_by, updated_at = now();
  perform public.console_audit_add(p_by, v_role, 'settings.billing.set', 'settings', 'billing', v_before, public.console_billing_settings(), p_reason, p_ip, p_ua);
  return public.console_billing_settings();
end $$;

-- ---------------------------------------------------------------- grants
-- the console's functions: the service role only (the console-admin function and the signup function use it)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'console\_%' or p.proname in ('price_list_at', 'plans_per_client_sync',
                  'subscriptions_for_new_firm', 'subscriptions_follow_firm')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
-- as migration-1 left them: charging and the run are not for browsers (charge_usage, for signed-in people, calls charge_for)
revoke all on function public.charge_for(uuid, uuid, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.refund_charge(uuid, numeric, text, text, uuid) from public, anon, authenticated;
revoke all on function public.run_monthly_core(uuid, uuid) from public, anon, authenticated;
revoke all on function public.price_of(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_for(uuid, uuid, text, numeric, text, text) to service_role;
grant execute on function public.refund_charge(uuid, numeric, text, text, uuid) to service_role;
grant execute on function public.run_monthly_core(uuid, uuid) to service_role;
grant execute on function public.price_of(uuid, text) to service_role;

commit;
