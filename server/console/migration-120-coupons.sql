-- FinCom Console, phase 3 "Coupons" (27-Oct-2026, branch next-console-coupons; docs/CONSOLE-COUPONS.md; the plan:
-- console-plan.md 3.6). NOT run on staging by the console's builder: the owner runs it.
-- Number: 120. Runs after 118 (console_admins, console_audit_add, firms.status). For free-credit coupons it calls
-- public.console_credit_post(uuid, bigint, text, text, text, uuid), which migration 119 (billing) makes; this file does
-- NOT make it. Until 119 is run, a free-credit code answers "This code cannot be used just now" and nothing is used up.
--
-- What it adds (add-only; nothing dropped or rewritten; one transaction, lock_timeout 10 s; safe to run twice):
--   coupons                 one row per code: kind (percent, flat, credit, free_months, trial_days), value, months,
--                           the most taken off a month (percent), valid from / to (India dates), plans (null = all),
--                           total uses and its counter, once per firm, new firms only (within N days of joining),
--                           stacking (default no), status (active, paused, ended), campaign, note, who and when.
--                           The code is kept in capitals: unique and not case-sensitive.
--   coupon_redemptions      the redemption ledger: who, firm, when, source (signup, settings; console later), the terms
--                           promised (a copy of the coupon then), the value given so far (paise), status (active,
--                           finished, reversed).
--   coupon_discounts        THE CONTRACT WITH BILLING (docs/CONSOLE-COUPONS.md): percent, flat and free-months coupons,
--                           and extended trials, wait here for the monthly run: firm, kind, value, months_left,
--                           from_redemption, status. Billing applies a month with coupon_discount_apply() (idempotent
--                           per period), which writes coupon_discount_months and counts the month down.
--   coupon_discount_months  one row per discount per billing period: the rupees (paise) taken off, the ledger ref.
--   coupon_attempts         the user app's tries (for "5 wrong codes an hour"); never shown to firms.
--   coupon_redeem(code, source)   the user app's one door (authenticated): every rule in one place, the redemption, the
--                           use counted, the credit posted (console_credit_post, kind 'coupon', ref = the redemption
--                           id) or the discount recorded, all in one transaction. Answers {ok, code, error | message};
--                           a refusal is in plain words and is not an error (so the try is counted).
--   console_coupon*()       the console's reads and writes (service role only; each write re-checks the caller's
--                           console role and writes its console_audit row in the same transaction).
-- Grants: RLS on for every table. coupons, coupon_attempts: no policy, service role only. coupon_redemptions and
-- coupon_discounts: a signed-in member may read their own firm's rows (select only). anon gets nothing.
-- Tested on pg_stand: tests/run_migration120.py (RED_WITHOUT_120=1 shows the checks fail without it).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- tables
create table if not exists public.coupons (
  id             uuid primary key default gen_random_uuid(),
  code           text not null check (code ~ '^[A-Z0-9]{4,20}$'),
  kind           text not null check (kind in ('percent', 'flat', 'credit', 'free_months', 'trial_days')),
  -- percent: 1 to 100; flat and credit: paise; free_months: months; trial_days: days
  value          bigint not null check (value > 0),
  months         integer check (months is null or months between 1 and 120),      -- percent and flat: how many billing months
  max_off_paise  bigint check (max_off_paise is null or max_off_paise > 0),       -- percent only: the most taken off a month
  valid_from     date,                                                             -- India dates, both days included
  valid_to       date,
  plan_ids       uuid[],                                                           -- null: every plan
  max_uses       integer check (max_uses is null or max_uses > 0),               -- null: no limit
  uses           integer not null default 0 check (uses >= 0),
  once_per_firm  boolean not null default true,
  new_firms_only boolean not null default false,
  new_firm_days  integer not null default 30 check (new_firm_days between 1 and 3650),
  stackable      boolean not null default false,
  status         text not null default 'active' check (status in ('active', 'paused', 'ended')),
  campaign       text check (campaign is null or length(campaign) <= 60),
  note           text check (note is null or length(note) <= 500),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  ended_at       timestamptz,
  constraint coupons_terms check (
       (kind = 'percent'     and value between 1 and 100 and months is not null)
    or (kind = 'flat'        and value <= 10000000 and months is not null and max_off_paise is null)
    or (kind = 'credit'      and value <= 10000000 and months is null and max_off_paise is null)
    or (kind = 'free_months' and value between 1 and 36 and months is null and max_off_paise is null)
    or (kind = 'trial_days'  and value between 1 and 365 and months is null and max_off_paise is null)),
  constraint coupons_dates check (valid_from is null or valid_to is null or valid_from <= valid_to),
  constraint coupons_max_uses check (max_uses is null or uses <= max_uses)
);
create unique index if not exists coupons_code_key on public.coupons (code);
alter table public.coupons enable row level security;
revoke all on public.coupons from public, anon, authenticated;
grant select, insert, update on public.coupons to service_role;

create table if not exists public.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons (id),
  firm_id     uuid not null references public.firms (id),
  by_user     uuid,                                     -- the signed-in person (sign-up, settings)
  by_admin    uuid,                                     -- a console admin (later: "apply to a firm")
  source      text not null check (source in ('signup', 'settings', 'console')),
  at          timestamptz not null default now(),
  kind        text not null,
  promised    jsonb not null,                           -- the coupon's terms at that moment (code, kind, value, months, ...)
  value_paise bigint not null default 0 check (value_paise >= 0),   -- given so far: the credit at once; discounts as billed
  days        integer,                                  -- trial_days: the days added
  status      text not null default 'active' check (status in ('active', 'finished', 'reversed')),
  once        boolean not null,                         -- the coupon was once-per-firm when this was made
  finished_at timestamptz
);
-- once per firm, kept by the database too (beside the lock in coupon_redeem)
create unique index if not exists coupon_redemptions_once on public.coupon_redemptions (coupon_id, firm_id) where once and status <> 'reversed';
create index if not exists coupon_redemptions_coupon on public.coupon_redemptions (coupon_id, at desc);
create index if not exists coupon_redemptions_firm on public.coupon_redemptions (firm_id, at desc);
alter table public.coupon_redemptions enable row level security;
revoke all on public.coupon_redemptions from public, anon, authenticated;
grant select on public.coupon_redemptions to authenticated;
grant select, insert, update on public.coupon_redemptions to service_role;
drop policy if exists coupon_redemptions_own on public.coupon_redemptions;
create policy coupon_redemptions_own on public.coupon_redemptions for select to authenticated using (firm_id = public.my_firm());

-- the contract with billing (docs/CONSOLE-COUPONS.md): what the monthly run takes off a firm's plan fee
create table if not exists public.coupon_discounts (
  id              bigint generated always as identity primary key,
  firm_id         uuid not null references public.firms (id),
  kind            text not null check (kind in ('percent', 'flat', 'free_months', 'trial_days')),
  -- percent: 1 to 100 (% off the plan fee); flat: paise off the plan fee each month; free_months: the months granted
  -- (the whole plan fee is waived while months_left > 0); trial_days: the days to add to the trial
  value           bigint not null check (value > 0),
  max_off_paise   bigint,                               -- percent only: the most taken off in one month
  months_left     integer not null check (months_left >= 0),   -- billing months still to apply (trial_days: 1 until applied)
  from_redemption uuid not null references public.coupon_redemptions (id),
  status          text not null default 'pending' check (status in ('pending', 'active', 'finished', 'reversed')),
  given_paise     bigint not null default 0 check (given_paise >= 0),
  last_period     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists coupon_discounts_redemption on public.coupon_discounts (from_redemption);
create index if not exists coupon_discounts_live on public.coupon_discounts (firm_id) where status in ('pending', 'active');
alter table public.coupon_discounts enable row level security;
revoke all on public.coupon_discounts from public, anon, authenticated;
grant select on public.coupon_discounts to authenticated;
grant select, insert, update on public.coupon_discounts to service_role;
drop policy if exists coupon_discounts_own on public.coupon_discounts;
create policy coupon_discounts_own on public.coupon_discounts for select to authenticated using (firm_id = public.my_firm());

create table if not exists public.coupon_discount_months (
  discount_id  bigint not null references public.coupon_discounts (id),
  period       date not null,                           -- the billing period's first day
  amount_paise bigint not null check (amount_paise >= 0),
  ledger_ref   text,                                    -- billing's ledger line (its id or idempotency key)
  applied_at   timestamptz not null default now(),
  primary key (discount_id, period)
);
create index if not exists coupon_discount_months_period on public.coupon_discount_months (period);
alter table public.coupon_discount_months enable row level security;
revoke all on public.coupon_discount_months from public, anon, authenticated;
grant select, insert on public.coupon_discount_months to service_role;

create table if not exists public.coupon_attempts (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  firm_id uuid,
  user_id uuid,
  code    text check (code is null or length(code) <= 40),
  ok      boolean not null,
  reason  text
);
create index if not exists coupon_attempts_firm on public.coupon_attempts (firm_id, at desc);
create index if not exists coupon_attempts_user on public.coupon_attempts (user_id, at desc);
alter table public.coupon_attempts enable row level security;
revoke all on public.coupon_attempts from public, anon, authenticated;
grant select, insert on public.coupon_attempts to service_role;

-- ---------------------------------------------------------------- helpers
-- rupees as people write them in India: 1,00,000 (paise kept when there are any)
create or replace function public.coupon_inr(p_paise bigint)
returns text language sql immutable set search_path = '' as $$
  select '₹' || case when p_paise % 100 = 0 then to_char(p_paise / 100, 'FM99,99,99,99,99,990')
                     else to_char(p_paise / 100.0, 'FM99,99,99,99,99,990.00') end
$$;
-- the terms in words: "20% off the plan fee for 3 months (up to ₹1,000 a month)"
create or replace function public.coupon_terms(p_kind text, p_value bigint, p_months integer, p_max_off bigint)
returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'percent' then p_value || '% off the plan fee for ' || p_months || case when p_months = 1 then ' month' else ' months' end
                        || case when p_max_off is not null then ' (up to ' || public.coupon_inr(p_max_off) || ' a month)' else '' end
    when 'flat' then public.coupon_inr(p_value) || ' off the plan fee for ' || p_months || case when p_months = 1 then ' month' else ' months' end
    when 'credit' then public.coupon_inr(p_value) || ' of free credit'
    when 'free_months' then p_value || case when p_value = 1 then ' free month' else ' free months' end || ' of the plan fee'
    when 'trial_days' then p_value || case when p_value = 1 then ' more day' else ' more days' end || ' of trial'
    else p_kind end
$$;
create or replace function public.coupon_today()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------------------------------------------------------------- the user app's door
-- A firm's owner enters a code at sign-up (after the firm is made) or in Settings › Plan. Every rule is checked here,
-- in this order, under a lock on the firm and the coupon's row (two firms taking the last use: one gets it):
--   signed in, an owner of an active firm, not 5 wrong codes this hour (firm or person), the code exists, active (not
--   paused or ended), within its dates, for the firm's plan, new firms only, once per firm, uses left, stacking.
create or replace function public.coupon_redeem(p_code text, p_source text default 'settings')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_firm uuid; v_role text; v_fst text; v_plan uuid; v_born timestamptz;
  v_code text; c public.coupons%rowtype;
  v_today date := public.coupon_today();
  v_fail text; v_detail text; v_red uuid; v_msg text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'signin', 'error', 'Sign in first.'); end if;
  v_firm := public.my_firm();
  select m.role into v_role from public.members m where m.user_id = v_uid and m.firm_id = v_firm and m.active limit 1;
  select f.status, f.plan_id, f.created_at into v_fst, v_plan, v_born from public.firms f where f.id = v_firm;
  if v_firm is null or v_role is null then
    return jsonb_build_object('ok', false, 'code', 'no_firm', 'error', 'Your login is not linked to a firm yet.');
  end if;
  if v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not_owner', 'error', 'Only the firm''s owner can add a coupon.');
  end if;
  if coalesce(v_fst, 'active') <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'firm_paused', 'error', 'Your firm''s account is paused, so a coupon cannot be added.');
  end if;
  if p_source is null or p_source not in ('signup', 'settings') then
    return jsonb_build_object('ok', false, 'code', 'bad_source', 'error', 'That request is not valid.');
  end if;
  -- wrong codes (a code that does not exist) only: a real code refused for a rule is not counted
  if (select count(*) from public.coupon_attempts a where a.firm_id = v_firm and a.reason = 'bad_code' and a.at > now() - interval '1 hour') >= 5
     or (select count(*) from public.coupon_attempts a where a.user_id = v_uid and a.reason = 'bad_code' and a.at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'error', 'Too many wrong codes. Try again in an hour.');
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));

  -- one firm at a time (stacking, once per firm), then the coupon's row (its uses)
  perform pg_advisory_xact_lock(hashtextextended('coupon:firm:' || v_firm::text, 0));
  begin
    if v_code !~ '^[A-Z0-9]{4,20}$' then raise exception 'coupon: bad_code'; end if;
    select * into c from public.coupons where code = v_code for update;
    if not found then raise exception 'coupon: bad_code'; end if;
    if c.status = 'paused' then raise exception 'coupon: paused'; end if;
    if c.status = 'ended' then raise exception 'coupon: ended'; end if;
    if c.valid_from is not null and v_today < c.valid_from then v_detail := to_char(c.valid_from, 'DD Mon YYYY'); raise exception 'coupon: not_yet'; end if;
    if c.valid_to is not null and v_today > c.valid_to then v_detail := to_char(c.valid_to, 'DD Mon YYYY'); raise exception 'coupon: expired'; end if;
    if c.plan_ids is not null and (v_plan is null or not (v_plan = any (c.plan_ids))) then raise exception 'coupon: wrong_plan'; end if;
    if c.new_firms_only and (v_born is null or v_born < now() - make_interval(days => c.new_firm_days)) then
      v_detail := c.new_firm_days::text; raise exception 'coupon: not_new';
    end if;
    if exists (select 1 from public.coupon_redemptions r where r.coupon_id = c.id and r.firm_id = v_firm and r.status <> 'reversed')
       and c.once_per_firm then
      raise exception 'coupon: used_by_firm';
    end if;
    if c.max_uses is not null and c.uses >= c.max_uses then raise exception 'coupon: used_up'; end if;
    -- stacking: a coupon that does not stack needs the firm to have none running; one that stacks needs every running
    -- one to stack too, and at most one fee discount (percent, flat, free months) at a time
    if exists (select 1 from public.coupon_redemptions r join public.coupons x on x.id = r.coupon_id
                where r.firm_id = v_firm and r.status = 'active' and (not c.stackable or not x.stackable)) then
      raise exception 'coupon: no_stack';
    end if;
    if c.kind in ('percent', 'flat', 'free_months') and exists (
         select 1 from public.coupon_redemptions r where r.firm_id = v_firm and r.status = 'active' and r.kind in ('percent', 'flat', 'free_months')) then
      raise exception 'coupon: one_discount';
    end if;
    if c.kind = 'credit' and to_regprocedure('public.console_credit_post(uuid,bigint,text,text,text,uuid)') is null then
      raise exception 'coupon: unavailable';
    end if;

    insert into public.coupon_redemptions (coupon_id, firm_id, by_user, source, kind, promised, days, once)
    values (c.id, v_firm, v_uid, p_source, c.kind,
            jsonb_build_object('code', c.code, 'kind', c.kind, 'value', c.value, 'months', c.months, 'max_off_paise', c.max_off_paise,
                               'terms', public.coupon_terms(c.kind, c.value, c.months, c.max_off_paise)),
            case when c.kind = 'trial_days' then c.value::integer end, c.once_per_firm)
    returning id into v_red;
    update public.coupons set uses = uses + 1 where id = c.id;
    if c.kind = 'credit' then
      execute 'select public.console_credit_post($1, $2, $3, $4, $5, $6)'
        using v_firm, c.value, 'coupon', v_red::text, 'Coupon ' || c.code, v_uid;
      update public.coupon_redemptions set value_paise = c.value, status = 'finished', finished_at = now() where id = v_red;
      v_msg := public.coupon_inr(c.value) || ' has been added to your credit.';
    else
      insert into public.coupon_discounts (firm_id, kind, value, max_off_paise, months_left, from_redemption)
      values (v_firm, c.kind, c.value, c.max_off_paise,
              case c.kind when 'free_months' then c.value::integer when 'trial_days' then 1 else c.months end, v_red);
      v_msg := case c.kind
        when 'trial_days' then 'Your trial is longer by ' || c.value || case when c.value = 1 then ' day.' else ' days.' end
        when 'free_months' then 'Your plan fee is waived for the next ' || c.value || case when c.value = 1 then ' month.' else ' months.' end
        else 'Applied: ' || public.coupon_terms(c.kind, c.value, c.months, c.max_off_paise) || ', from your next bill.' end;
    end if;
  exception when raise_exception then
    v_fail := substring(sqlerrm from '^coupon: ([a-z_]+)$');
    if v_fail is null then raise; end if;
  end;

  if v_fail is not null then
    insert into public.coupon_attempts (firm_id, user_id, code, ok, reason) values (v_firm, v_uid, left(v_code, 40), false, v_fail);
    return jsonb_build_object('ok', false, 'code', v_fail, 'error', case v_fail
      when 'bad_code' then 'That code is not valid. Check it and try again.'
      when 'paused' then 'This code is paused just now. Try again later.'
      when 'ended' then 'This code has ended.'
      when 'not_yet' then 'This code can be used from ' || v_detail || '.'
      when 'expired' then 'This code expired on ' || v_detail || '.'
      when 'wrong_plan' then 'This code is not for your firm''s plan.'
      when 'not_new' then 'This code is only for firms that joined in the last ' || v_detail || ' days.'
      when 'used_by_firm' then 'Your firm has already used this code.'
      when 'used_up' then 'This code has been used up.'
      when 'no_stack' then 'Your firm already has a coupon running, and this code cannot be added to it.'
      when 'one_discount' then 'Your firm already has a discount running. Only one discount can run at a time.'
      when 'unavailable' then 'This code cannot be used just now. Try again later.'
      else 'That code cannot be used.' end);
  end if;
  insert into public.coupon_attempts (firm_id, user_id, code, ok, reason) values (v_firm, v_uid, v_code, true, null);
  return jsonb_build_object('ok', true, 'redemption_id', v_red, 'kind', c.kind, 'code', c.code, 'message', v_msg);
end $$;

-- ---------------------------------------------------------------- billing's side (service role only)
-- The monthly run applies one discount for one period: idempotent (a second call for the same period changes nothing),
-- counts the month down, adds the rupees given to the discount and its redemption, and finishes both at zero. For
-- trial_days, billing adds the days to the trial and calls this once with p_amount_paise 0.
create or replace function public.coupon_discount_apply(p_discount bigint, p_period date, p_amount_paise bigint, p_ledger_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.coupon_discounts%rowtype; n integer;
begin
  if p_period is null or p_amount_paise is null or p_amount_paise < 0 then raise exception 'coupon: bad_apply' using errcode = '22023'; end if;
  select * into d from public.coupon_discounts where id = p_discount for update;
  if not found then raise exception 'coupon: no_discount' using errcode = 'P0002'; end if;
  if exists (select 1 from public.coupon_discount_months where discount_id = d.id and period = p_period) then
    return jsonb_build_object('applied', false, 'months_left', d.months_left, 'status', d.status);
  end if;
  if d.status not in ('pending', 'active') or d.months_left <= 0 then raise exception 'coupon: discount_done' using errcode = '22023'; end if;
  insert into public.coupon_discount_months (discount_id, period, amount_paise, ledger_ref) values (d.id, p_period, p_amount_paise, left(p_ledger_ref, 200));
  get diagnostics n = row_count;
  update public.coupon_discounts
     set months_left = months_left - 1, given_paise = given_paise + p_amount_paise, last_period = p_period, updated_at = now(),
         status = case when months_left - 1 = 0 then 'finished' else 'active' end
   where id = d.id returning * into d;
  update public.coupon_redemptions
     set value_paise = value_paise + p_amount_paise,
         status = case when d.status = 'finished' then 'finished' else status end,
         finished_at = case when d.status = 'finished' then now() else finished_at end
   where id = d.from_redemption;
  return jsonb_build_object('applied', n = 1, 'months_left', d.months_left, 'status', d.status);
end $$;

-- ---------------------------------------------------------------- the console (service role only)
create or replace function public.console_coupon_row(c public.coupons)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'value', c.value, 'months', c.months, 'max_off_paise', c.max_off_paise,
    'terms', public.coupon_terms(c.kind, c.value, c.months, c.max_off_paise),
    'valid_from', c.valid_from, 'valid_to', c.valid_to, 'plan_ids', to_jsonb(c.plan_ids),
    'plans', case when c.plan_ids is null then 'All plans'
                  else coalesce((select string_agg(p.name, ', ' order by p.name) from public.plans p where p.id = any (c.plan_ids)), '–') end,
    'max_uses', c.max_uses, 'uses', c.uses, 'once_per_firm', c.once_per_firm, 'new_firms_only', c.new_firms_only,
    'new_firm_days', c.new_firm_days, 'stackable', c.stackable, 'set_status', c.status,
    'status', case when c.status <> 'active' then c.status
                   when c.valid_to is not null and c.valid_to < public.coupon_today() then 'expired'
                   when c.max_uses is not null and c.uses >= c.max_uses then 'used_up'
                   when c.valid_from is not null and c.valid_from > public.coupon_today() then 'scheduled'
                   else 'active' end,
    'usage', case when c.uses = 0 then 'unused' when c.max_uses is not null and c.uses >= c.max_uses then 'full' else 'in_use' end,
    'given_paise', g.given, 'given_inr', g.given / 100.0, 'firms', g.firms,
    'campaign', c.campaign, 'note', c.note, 'created_at', c.created_at, 'updated_at', c.updated_at, 'ended_at', c.ended_at,
    'created_by_email', (select u.email from auth.users u where u.id = c.created_by),
    'updated_by_email', (select u.email from auth.users u where u.id = c.updated_by))
  from (select coalesce(sum(r.value_paise), 0)::bigint as given, count(distinct r.firm_id) as firms
          from public.coupon_redemptions r where r.coupon_id = c.id and r.status <> 'reversed') g
$$;

create or replace function public.console_coupons()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.console_coupon_row(c) order by c.created_at desc), '[]'::jsonb) from public.coupons c
$$;

create or replace function public.console_coupon(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.console_coupon_row(c) from public.coupons c where c.id = p_id
$$;

create or replace function public.console_coupon_plans()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb) from public.plans p
$$;

-- one coupon's redemptions (p_coupon null: every coupon's)
create or replace function public.console_coupon_redemptions(p_coupon uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'coupon_id', r.coupon_id, 'code', r.promised ->> 'code', 'firm_id', r.firm_id, 'firm', f.name,
           'by_email', coalesce(u.email, a.email), 'source', r.source, 'at', r.at, 'kind', r.kind,
           'terms', r.promised ->> 'terms', 'value_paise', r.value_paise, 'value_inr', r.value_paise / 100.0, 'days', r.days,
           'status', r.status, 'months_left', d.months_left, 'discount_status', d.status)
         order by r.at desc), '[]'::jsonb)
    from public.coupon_redemptions r
    join public.firms f on f.id = r.firm_id
    left join auth.users u on u.id = r.by_user
    left join auth.users a on a.id = r.by_admin
    left join public.coupon_discounts d on d.from_redemption = r.id
   where p_coupon is null or r.coupon_id = p_coupon
$$;

-- what was given, per coupon and per month (India months): credit by the month it was redeemed, discounts by the
-- billing period they were applied to
create or replace function public.console_coupon_report()
returns jsonb language sql stable security definer set search_path = '' as $$
  with given as (
    select r.coupon_id, date_trunc('month', r.at at time zone 'Asia/Kolkata')::date as month,
           1 as redemptions, case when r.kind = 'credit' then r.value_paise else 0 end as credit, 0::bigint as discount
      from public.coupon_redemptions r where r.status <> 'reversed'
    union all
    select r.coupon_id, date_trunc('month', m.period)::date, 0, 0, m.amount_paise
      from public.coupon_discount_months m
      join public.coupon_discounts d on d.id = m.discount_id
      join public.coupon_redemptions r on r.id = d.from_redemption),
  t as (select g.coupon_id, g.month, sum(g.redemptions)::int as redemptions, sum(g.credit)::bigint as credit, sum(g.discount)::bigint as discount
          from given g group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.coupon_id::text || ':' || t.month, 'coupon_id', t.coupon_id, 'month', t.month, 'code', c.code, 'kind', c.kind,
           'campaign', c.campaign, 'redemptions', t.redemptions,
           'credit_paise', t.credit, 'discount_paise', t.discount, 'total_paise', t.credit + t.discount,
           'credit_inr', t.credit / 100.0, 'discount_inr', t.discount / 100.0, 'total_inr', (t.credit + t.discount) / 100.0)
         order by t.month desc, c.code), '[]'::jsonb)
    from t join public.coupons c on c.id = t.coupon_id
$$;

-- create (p_id null) or edit a coupon (Owner, Billing). p_data: code, kind, value, months, max_off_paise, valid_from,
-- valid_to, plan_ids, max_uses, once_per_firm, new_firms_only, new_firm_days, stackable, campaign, note.
-- Once a coupon has been used, its code and kind stay as they are; an ended coupon is not edited.
create or replace function public.console_coupon_save(p_by uuid, p_id uuid, p_data jsonb, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text; o public.coupons%rowtype; n public.coupons%rowtype; v_before jsonb; v_plans uuid[];
  d jsonb := coalesce(p_data, '{}'::jsonb);
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  n.code := upper(regexp_replace(coalesce(d ->> 'code', ''), '\s', '', 'g'));
  if n.code !~ '^[A-Z0-9]{4,20}$' then raise exception 'console: coupon_code' using errcode = '22023'; end if;
  n.kind := d ->> 'kind';
  if n.kind is null or n.kind not in ('percent', 'flat', 'credit', 'free_months', 'trial_days') then raise exception 'console: coupon_kind' using errcode = '22023'; end if;
  begin
    n.value := (d ->> 'value')::bigint;
    n.months := case when n.kind in ('percent', 'flat') then (d ->> 'months')::integer end;
    n.max_off_paise := case when n.kind = 'percent' then nullif(d ->> 'max_off_paise', '')::bigint end;
    n.valid_from := nullif(d ->> 'valid_from', '')::date;
    n.valid_to := nullif(d ->> 'valid_to', '')::date;
    n.max_uses := nullif(d ->> 'max_uses', '')::integer;
    n.new_firm_days := coalesce(nullif(d ->> 'new_firm_days', '')::integer, 30);
    n.once_per_firm := coalesce((d ->> 'once_per_firm')::boolean, true);
    n.new_firms_only := coalesce((d ->> 'new_firms_only')::boolean, false);
    n.stackable := coalesce((d ->> 'stackable')::boolean, false);
    if jsonb_typeof(d -> 'plan_ids') = 'array' and jsonb_array_length(d -> 'plan_ids') > 0 then
      select array_agg(x::uuid order by x) into v_plans from jsonb_array_elements_text(d -> 'plan_ids') x;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception 'console: coupon_value' using errcode = '22023';
  end;
  n.plan_ids := v_plans;
  if v_plans is not null and exists (select 1 from unnest(v_plans) x where not exists (select 1 from public.plans p where p.id = x)) then
    raise exception 'console: coupon_plan' using errcode = '22023';
  end if;
  n.campaign := nullif(left(trim(coalesce(d ->> 'campaign', '')), 60), '');
  n.note := nullif(left(trim(coalesce(d ->> 'note', '')), 500), '');
  if n.value is null or n.value <= 0
     or (n.kind = 'percent' and n.value > 100) or (n.kind in ('flat', 'credit') and n.value > 10000000)
     or (n.kind = 'free_months' and n.value > 36) or (n.kind = 'trial_days' and n.value > 365)
     or (n.kind in ('percent', 'flat') and (n.months is null or n.months not between 1 and 120))
     or (n.max_off_paise is not null and n.max_off_paise <= 0)
     or (n.max_uses is not null and n.max_uses <= 0) or n.new_firm_days not between 1 and 3650 then
    raise exception 'console: coupon_value' using errcode = '22023';
  end if;
  if n.valid_from is not null and n.valid_to is not null and n.valid_from > n.valid_to then raise exception 'console: coupon_dates' using errcode = '22023'; end if;

  if p_id is null then
    if exists (select 1 from public.coupons where code = n.code) then raise exception 'console: coupon_code_taken' using errcode = '23505'; end if;
    insert into public.coupons (code, kind, value, months, max_off_paise, valid_from, valid_to, plan_ids, max_uses, once_per_firm,
                                new_firms_only, new_firm_days, stackable, campaign, note, created_by, updated_by)
    values (n.code, n.kind, n.value, n.months, n.max_off_paise, n.valid_from, n.valid_to, n.plan_ids, n.max_uses, n.once_per_firm,
            n.new_firms_only, n.new_firm_days, n.stackable, n.campaign, n.note, p_by, p_by)
    returning * into n;
    perform public.console_audit_add(p_by, v_role, 'coupon.create', 'coupon', n.id::text, null, public.console_coupon_row(n), p_reason, p_ip, p_ua);
  else
    select * into o from public.coupons where id = p_id for update;
    if not found then raise exception 'console: no_coupon' using errcode = 'P0002'; end if;
    if o.status = 'ended' then raise exception 'console: coupon_ended' using errcode = '22023'; end if;
    if o.uses > 0 and (n.code <> o.code or n.kind <> o.kind) then raise exception 'console: coupon_in_use' using errcode = '22023'; end if;
    if n.max_uses is not null and n.max_uses < o.uses then raise exception 'console: coupon_max_below_uses' using errcode = '22023'; end if;
    if n.code <> o.code and exists (select 1 from public.coupons where code = n.code and id <> o.id) then
      raise exception 'console: coupon_code_taken' using errcode = '23505';
    end if;
    v_before := public.console_coupon_row(o);
    update public.coupons set code = n.code, kind = n.kind, value = n.value, months = n.months, max_off_paise = n.max_off_paise,
           valid_from = n.valid_from, valid_to = n.valid_to, plan_ids = n.plan_ids, max_uses = n.max_uses, once_per_firm = n.once_per_firm,
           new_firms_only = n.new_firms_only, new_firm_days = n.new_firm_days, stackable = n.stackable, campaign = n.campaign,
           note = n.note, updated_by = p_by, updated_at = now()
     where id = o.id returning * into n;
    perform public.console_audit_add(p_by, v_role, 'coupon.update', 'coupon', n.id::text, v_before, public.console_coupon_row(n), p_reason, p_ip, p_ua);
  end if;
  return public.console_coupon_row(n);
exception when unique_violation then
  raise exception 'console: coupon_code_taken' using errcode = '23505';
end $$;

-- pause (active -> paused), resume (paused -> active), end (active or paused -> ended, for good). Redemptions already
-- made keep running whatever the coupon's status.
create or replace function public.console_coupon_set_status(p_by uuid, p_id uuid, p_status text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; o public.coupons%rowtype; n public.coupons%rowtype;
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  if p_status is null or p_status not in ('active', 'paused', 'ended') then raise exception 'console: bad_status' using errcode = '22023'; end if;
  select * into o from public.coupons where id = p_id for update;
  if not found then raise exception 'console: no_coupon' using errcode = 'P0002'; end if;
  if o.status = p_status then raise exception 'console: same_status' using errcode = '22023'; end if;
  if o.status = 'ended' then raise exception 'console: coupon_ended' using errcode = '22023'; end if;
  update public.coupons set status = p_status, updated_by = p_by, updated_at = now(),
         ended_at = case when p_status = 'ended' then now() else ended_at end
   where id = o.id returning * into n;
  perform public.console_audit_add(p_by, v_role, case p_status when 'paused' then 'coupon.pause' when 'ended' then 'coupon.end' else 'coupon.resume' end,
    'coupon', o.id::text, jsonb_build_object('status', o.status, 'code', o.code), jsonb_build_object('status', p_status, 'code', o.code), p_reason, p_ip, p_ua);
  return public.console_coupon_row(n);
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'console\_coupon%' or p.proname = 'coupon_discount_apply') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke all on function public.coupon_redeem(text, text) from public, anon;
grant execute on function public.coupon_redeem(text, text) to authenticated, service_role;
revoke all on function public.coupon_inr(bigint) from public, anon;
revoke all on function public.coupon_terms(text, bigint, integer, bigint) from public, anon;
revoke all on function public.coupon_today() from public, anon;
grant execute on function public.coupon_inr(bigint), public.coupon_terms(text, bigint, integer, bigint), public.coupon_today() to authenticated, service_role;

commit;
