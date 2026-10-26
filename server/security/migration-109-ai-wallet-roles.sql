-- Migration 109 (26-Oct-2026, branch next-sec-server): fixes H2 and M4 of the evening security audit of 26-Oct-2026, as the
-- owner approved them on 26-Oct-2026. NOT run on staging by the builder: the owner runs it.
--
-- 1. AI spending (audit H2). Before: a firm's owner could raise the firm's own monthly AI limit to Rs 1 crore and set the
--    rupees to a dollar (asst_set_cap(p_inr, p_rate), e.g. a rate of 1), and AI use was never taken from the wallet.
--    Now:
--    a. The platform's settings, app_settings 'ai' (the superadmin changes them through admin_set_setting, as every
--       platform setting): default_monthly_inr 3000 (a firm's monthly AI limit unless the superadmin gave the firm
--       another), inr_per_usd 85 (the rupees to a dollar, for every firm), min_balance_inr 10 (an AI call is not started
--       below this wallet balance). Read through asst_ai_conf(): a value missing, not a number or out of range gives the
--       default above.
--    b. asst_set_cap: the owner may only LOWER the firm's limit (anything from 0 up to the firm's ceiling: the platform's
--       default, or the ceiling the superadmin set for the firm); setting the default itself is the reset. A rate other
--       than the platform's is refused with words. Same arguments, result keys and grants as before.
--       admin_asst_set_cap(firm, max): the superadmin (two-step) gives one firm a higher (or lower) ceiling; null: back to
--       the platform's default. assistant_caps.ceiling_inr holds it (new column, null for every firm).
--       A limit an owner set above the ceiling before 109 counts only up to the ceiling (nothing rewritten).
--       assistant_caps.inr_per_usd is no longer read.
--    c. AI use is charged to the wallet through the existing charge_for (wallet_entries kind 'charge', module code 'ai'):
--       asst_cost_add, after each AI call (Ask FinCom, its ledger guesses, sheet and file reading, 2B and TDS challan
--       matching, the voice step's name check, call summaries: every caller of asst_cost_add), charges the call's cost in
--       rupees (the provider's dollar price x the platform's rate, as the monthly limit counts it) x the module's price.
--       The new module row 'ai' has price 1 (Rs 1 for each Rs 1 of cost: no markup), billing per_unit; the superadmin
--       changes it (or one firm's, firm_modules) through the existing admin_set_module. A plan that includes 'ai' makes it
--       free, as for every module. When the balance cannot cover a call already made, what is left is taken and the rest
--       is written off in the entry's note; the next call is refused before it is made.
--    d. asst_cap_take refuses a new AI call (why 'balance') when the wallet holds less than min_balance_inr and the call
--       would be paid for (why 'off' when the superadmin switched the 'ai' module off for the firm). The 500 calls a day
--       (daily_calls) and the monthly limit stay as they were.
--    asst_usage: cap_inr is the limit in force, rate the platform's; adds max_inr (the firm's ceiling) and the wallet's
--    balance; the keys before stay.
-- 2. Read-only members do not write books (audit M4):
--    a. tally_company_link: the same text, with plain words for a read-only member ("not allowed" before).
--    b. Postings into Tally: a trigger on tally_post_jobs refuses a signed-in read-only member's new posting and their
--       cancelling of one (tally_post_enqueue_to / tally_post_cancel had no role check); the bridge and the server
--       (service role, no signed-in user) are untouched.
--    c. Storage: "doc inbox: add to own firm" and tally_uploads_add also need can_write() (owners and staff), as every
--       other add policy has.
--    (tally-ingest's user uploads are refused to a read-only member in the function itself: server/tally-cloud/index.ts.)
-- ADD-ONLY: no table, column, row or function removed; no "delete from"; one new column, one module row and one settings
-- row (each only when missing), functions replaced with the same arguments and results, two policies tightened, one new
-- trigger. Grants explicit. One transaction (lock_timeout 10 s). Safe to run twice. Runs after 96 (and 77, 95); needs the
-- wallet (firms.balance, modules, plans, firm_modules, usage_period, wallet_entries, charge_for, price_of) and
-- tally_post_jobs / tally_companies. Tested on pg_stand: tests/run_migration109.py (RED_WITHOUT_109=1: the attacks pass).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------------------------------------------- 1a
insert into public.app_settings (name, value, updated_at)
values ('ai', jsonb_build_object('default_monthly_inr', 3000, 'inr_per_usd', 85, 'min_balance_inr', 10), now())
on conflict (name) do nothing;

insert into public.modules (code, title, unit, price, billing, active, sort)
values ('ai', 'AI help', 'per ₹1 of AI cost (the provider''s price at FinCom''s dollar rate)', 1, 'per_unit', true, 8)
on conflict (code) do nothing;

alter table public.assistant_caps add column if not exists ceiling_inr numeric(12,2) check (ceiling_inr is null or ceiling_inr between 0 and 10000000);

-- the platform's AI settings, each checked (a bad value: the default)
create or replace function public.asst_ai_conf()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'default_monthly_inr', case when jsonb_typeof(v -> 'default_monthly_inr') = 'number' and (v ->> 'default_monthly_inr')::numeric between 0 and 10000000 then (v ->> 'default_monthly_inr')::numeric else 3000 end,
    'inr_per_usd', case when jsonb_typeof(v -> 'inr_per_usd') = 'number' and (v ->> 'inr_per_usd')::numeric between 1 and 1000 then (v ->> 'inr_per_usd')::numeric else 85 end,
    'min_balance_inr', case when jsonb_typeof(v -> 'min_balance_inr') = 'number' and (v ->> 'min_balance_inr')::numeric between 0 and 100000 then (v ->> 'min_balance_inr')::numeric else 10 end)
  from (select coalesce((select s.value from app_settings s where s.name = 'ai'), '{}'::jsonb) v) z
$$;

-- a firm's limits: the calls a day, the monthly limit in force, its ceiling, the rate
create or replace function public.asst_limits(p_firm uuid, out calls integer, out cap_inr numeric, out max_inr numeric, out rate numeric, out min_balance numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c jsonb := asst_ai_conf(); x record;
begin
  select a.daily_calls, a.monthly_inr, a.ceiling_inr into x from assistant_caps a where a.firm_id = p_firm;
  calls := coalesce(x.daily_calls, 500);
  max_inr := coalesce(x.ceiling_inr, (c ->> 'default_monthly_inr')::numeric);
  cap_inr := least(coalesce(x.monthly_inr, max_inr), max_inr);
  rate := (c ->> 'inr_per_usd')::numeric;
  min_balance := (c ->> 'min_balance_inr')::numeric;
end $$;

-- may the firm's wallet pay for an AI call? ok, or why not ('balance', 'off'); free when its plan includes AI, the
-- module is free or its price is 0
create or replace function public.asst_wallet_ok(p_firm uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare bal numeric; per date; billing text; enabled boolean; inc jsonb; incap numeric; used numeric; price numeric; mn numeric := (asst_ai_conf() ->> 'min_balance_inr')::numeric;
begin
  select f.balance, f.period_start into bal, per from firms f where f.id = p_firm;
  if not found then return jsonb_build_object('ok', false, 'why', 'balance', 'balance', 0, 'min_balance_inr', mn); end if;
  select m.billing, coalesce(fm.enabled, true) into billing, enabled from modules m left join firm_modules fm on fm.firm_id = p_firm and fm.code = m.code where m.code = 'ai';
  if billing is null then return jsonb_build_object('ok', true, 'free', true, 'balance', bal); end if;      -- no 'ai' module: nothing to charge
  if not enabled then return jsonb_build_object('ok', false, 'why', 'off', 'balance', bal); end if;
  if billing = 'free' then return jsonb_build_object('ok', true, 'free', true, 'balance', bal); end if;
  select p.includes -> 'ai' into inc from plans p join firms f on f.plan_id = p.id where f.id = p_firm;
  if inc is not null then
    incap := nullif(inc ->> 'cap', '')::numeric;
    if incap is null then return jsonb_build_object('ok', true, 'free', true, 'balance', bal); end if;
    select u.qty into used from usage_period u where u.firm_id = p_firm and u.period_start = per and u.code = 'ai';
    if coalesce(used, 0) < incap then return jsonb_build_object('ok', true, 'free', true, 'balance', bal); end if;
  end if;
  price := coalesce(price_of(p_firm, 'ai'), 0);
  if price <= 0 then return jsonb_build_object('ok', true, 'free', true, 'balance', bal); end if;
  if coalesce(bal, 0) < greatest(mn, 0.01) then return jsonb_build_object('ok', false, 'why', 'balance', 'balance', bal, 'min_balance_inr', mn); end if;
  return jsonb_build_object('ok', true, 'balance', bal);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 1d
-- before an AI call: may the firm make one? (its wallet, then its rupee limit for the month and its calls for the day).
-- Takes the call when it may. 96's text with the wallet's check first and the limits of 109.
create or replace function public.asst_cap_take(p_firm uuid, p_n integer default 1)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; w jsonb; d date := (now() at time zone 'Asia/Kolkata')::date; m0 date; used integer; spent numeric; prior numeric;
begin
  m0 := date_trunc('month', d)::date;
  if p_firm is null or coalesce(p_n, 0) < 1 then return jsonb_build_object('ok', false, 'used', 0, 'cap', 0, 'period', 'month'); end if;
  select * into c from asst_limits(p_firm);
  w := asst_wallet_ok(p_firm);
  if not coalesce((w ->> 'ok')::boolean, false) then
    select u.calls into used from assistant_usage u where u.firm_id = p_firm and u.day = d;
    select coalesce(sum(u.cost_inr), 0) into spent from assistant_usage u where u.firm_id = p_firm and u.day >= m0 and u.day <= d;
    return jsonb_build_object('ok', false, 'used', coalesce(used, 0), 'cap', c.calls, 'spent_inr', round(spent, 2), 'cap_inr', c.cap_inr, 'rate', c.rate, 'day', d,
      'period', 'month', 'month', to_char(d, 'YYYY-MM'), 'why', w ->> 'why', 'balance', w -> 'balance', 'min_balance_inr', c.min_balance);
  end if;
  insert into assistant_usage (firm_id, day) values (p_firm, d) on conflict (firm_id, day) do nothing;
  -- the month's days before today (only today's row is written now)
  select coalesce(sum(u.cost_inr), 0) into prior from assistant_usage u where u.firm_id = p_firm and u.day >= m0 and u.day < d;
  update assistant_usage u set calls = u.calls + p_n where u.firm_id = p_firm and u.day = d and u.calls + p_n <= c.calls and prior + u.cost_inr < c.cap_inr
  returning u.calls, prior + u.cost_inr into used, spent;
  if used is null then
    select u.calls, prior + u.cost_inr into used, spent from assistant_usage u where u.firm_id = p_firm and u.day = d;
    spent := coalesce(spent, prior);
    return jsonb_build_object('ok', false, 'used', coalesce(used, 0), 'cap', c.calls, 'spent_inr', round(spent, 2), 'cap_inr', c.cap_inr, 'rate', c.rate, 'day', d,
      'period', 'month', 'month', to_char(d, 'YYYY-MM'), 'why', case when spent >= c.cap_inr then 'inr' else 'calls' end);
  end if;
  return jsonb_build_object('ok', true, 'used', used, 'cap', c.calls, 'spent_inr', round(spent, 2), 'cap_inr', c.cap_inr, 'rate', c.rate, 'day', d, 'warn', spent >= 0.8 * c.cap_inr,
    'period', 'month', 'month', to_char(d, 'YYYY-MM'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 1c
-- after an AI call: its cost (dollars, from the API's usage and the model's price) in rupees at the PLATFORM's rate, added
-- to the day and the feature, and charged to the firm's wallet (charge_for, module 'ai'). Returns the month's spend
-- against the limit, as before, and what the wallet was charged.
create or replace function public.asst_cost_add(p_firm uuid, p_feature text, p_cost_usd numeric, p_in integer, p_out integer, p_cache_read integer, p_cache_write integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; c record; inr numeric; spent numeric; prior numeric; feat text := left(coalesce(nullif(p_feature, ''), 'other'), 40);
        ch jsonb; ch2 jsonb; bal numeric; price numeric; part numeric; charged numeric := 0; short numeric := 0;
begin
  select * into c from asst_limits(p_firm);
  inr := round(greatest(coalesce(p_cost_usd, 0), 0) * c.rate, 4);
  insert into assistant_usage (firm_id, day) values (p_firm, d) on conflict (firm_id, day) do nothing;
  update assistant_usage u set input_tokens = u.input_tokens + greatest(coalesce(p_in, 0), 0), output_tokens = u.output_tokens + greatest(coalesce(p_out, 0), 0),
         cache_read = u.cache_read + greatest(coalesce(p_cache_read, 0), 0), cache_write = u.cache_write + greatest(coalesce(p_cache_write, 0), 0), cost_inr = u.cost_inr + inr
   where u.firm_id = p_firm and u.day = d returning u.cost_inr into spent;
  select coalesce(sum(u.cost_inr), 0) into prior from assistant_usage u where u.firm_id = p_firm and u.day >= date_trunc('month', d)::date and u.day < d;
  spent := prior + coalesce(spent, 0);
  insert into assistant_usage_feature (firm_id, day, feature, calls, cost_inr) values (p_firm, d, feat, 1, inr)
  on conflict (firm_id, day, feature) do update set calls = assistant_usage_feature.calls + 1, cost_inr = assistant_usage_feature.cost_inr + excluded.cost_inr;
  -- the wallet: the call is made, so it is charged; what the balance cannot cover is taken as far as it goes
  if inr > 0 and p_firm is not null then
    ch := charge_for(p_firm, null, 'ai', inr, 'ai:' || feat, 'AI: ' || feat);
    if coalesce((ch ->> 'ok')::boolean, false) then
      charged := coalesce((ch ->> 'amount')::numeric, 0);
    elsif ch ->> 'reason' = 'low_balance' then
      price := coalesce(price_of(p_firm, 'ai'), 0);
      select f.balance into bal from firms f where f.id = p_firm;
      part := case when price > 0 then floor(greatest(coalesce(bal, 0), 0) / price * 100) / 100 else 0 end;
      if part > 0 then
        ch2 := charge_for(p_firm, null, 'ai', part, 'ai:' || feat, 'AI: ' || feat || ' (part: Rs ' || round(inr * price - round(part * price, 2), 2) || ' not covered, the balance ran out)');
        if coalesce((ch2 ->> 'ok')::boolean, false) then charged := coalesce((ch2 ->> 'amount')::numeric, 0); end if;
      end if;
      short := greatest(round(inr * price, 2) - charged, 0);
    end if;
  end if;
  return jsonb_build_object('inr', inr, 'spent_inr', round(spent, 2), 'cap_inr', c.cap_inr, 'warn', spent >= 0.8 * c.cap_inr, 'over', spent >= c.cap_inr,
    'period', 'month', 'month', to_char(d, 'YYYY-MM'), 'charged', charged, 'short', short, 'wallet', coalesce(ch ->> 'reason', case when ch is null then 'none' else 'ok' end));
end $$;

-- what the caller may see of the firm's use (96's text; the limit in force, the platform's rate, the ceiling and the balance)
create or replace function public.asst_usage(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f uuid := my_firm(); owner boolean; d date := (now() at time zone 'Asia/Kolkata')::date; c record; spent numeric; today_inr numeric; n integer; since date; bal numeric;
begin
  if f is null then return jsonb_build_object('none', true); end if;
  owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role = 'owner');
  select * into c from asst_limits(f);
  select fi.balance into bal from firms fi where fi.id = f;
  select coalesce(u.cost_inr, 0), coalesce(u.calls, 0) into today_inr, n from (select 1) z left join assistant_usage u on u.firm_id = f and u.day = d;
  select coalesce(sum(u.cost_inr), 0) into spent from assistant_usage u where u.firm_id = f and u.day >= date_trunc('month', d)::date and u.day <= d;
  since := d - least(greatest(coalesce(p_days, 30), 1), 366);
  return jsonb_build_object('cap', c.calls, 'today', n, 'owner', owner, 'cap_inr', c.cap_inr, 'rate', c.rate, 'spent_inr', round(spent, 2),
    'warn', spent >= 0.8 * c.cap_inr, 'over', spent >= c.cap_inr, 'period', 'month', 'month', to_char(d, 'YYYY-MM'), 'today_inr', round(today_inr, 2),
    'max_inr', c.max_inr, 'balance', bal,
    'days', case when owner then coalesce((select jsonb_agg(jsonb_build_object('day', u.day, 'calls', u.calls, 'in', u.input_tokens, 'out', u.output_tokens, 'cache_read', u.cache_read, 'inr', round(u.cost_inr, 2)) order by u.day desc)
              from assistant_usage u where u.firm_id = f and u.day > since), '[]'::jsonb) else null end,
    'months', case when owner then coalesce((select jsonb_agg(jsonb_build_object('month', z.m, 'calls', z.calls, 'inr', z.inr) order by z.m desc) from
              (select to_char(u.day, 'YYYY-MM') m, sum(u.calls) calls, round(sum(u.cost_inr), 2) inr from assistant_usage u where u.firm_id = f and u.day > d - 366 group by 1) z), '[]'::jsonb) else null end,
    'features', case when owner then coalesce((select jsonb_agg(jsonb_build_object('feature', z.feature, 'questions', z.q, 'calls', z.calls, 'inr', z.inr) order by z.inr desc, z.feature) from
              (select x.feature, sum(x.questions) q, sum(x.calls) calls, round(sum(x.cost_inr), 2) inr from assistant_usage_feature x where x.firm_id = f and x.day > since group by 1) z), '[]'::jsonb) else null end,
    'questions', case when owner then coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'q', l.question, 'tools', l.tools, 'client', l.client_id, 'in', l.input_tokens, 'out', l.output_tokens,
              'route', l.route, 'feature', l.feature, 'inr', round(l.cost_inr, 2), 'fell', l.fell_through,
              'by', coalesce((select m.name from members m where m.user_id = l.user_id and m.firm_id = f limit 1), '')) order by l.at desc)
              from (select * from assistant_log x where x.firm_id = f order by x.at desc limit 200) l), '[]'::jsonb) else null end,
    'fell_through', case when owner then coalesce((select jsonb_agg(jsonb_build_object('q', z.q, 'n', z.n) order by z.n desc, z.q) from
              (select l.question q, count(*) n from assistant_log l where l.firm_id = f and l.fell_through and l.at > now() - interval '90 days' group by 1 order by 2 desc limit 50) z), '[]'::jsonb) else null end);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 1b
-- the owner LOWERS the firm's monthly limit (0 up to the ceiling; the ceiling itself is the reset); the rate is the
-- platform's (null or the same keeps it; another is refused)
create or replace function public.asst_set_cap(p_inr numeric, p_rate numeric default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := my_firm(); c record;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role = 'owner') then
    raise exception 'only the firm''s owner sets the cap';
  end if;
  select * into c from asst_limits(f);
  if p_rate is not null and p_rate <> c.rate then
    raise exception 'The rupees to a dollar (Rs %) are set by FinCom for every firm; they cannot be changed here.', c.rate;
  end if;
  if p_inr is not null and p_inr < 0 then raise exception 'cap out of range'; end if;
  if p_inr is not null and p_inr > c.max_inr then
    raise exception 'The monthly AI limit can only be lowered here: at most Rs %. To raise it, ask FinCom.', to_char(c.max_inr, 'FM99,99,99,990');
  end if;
  insert into assistant_caps (firm_id, monthly_inr, set_at, set_by) values (f, coalesce(p_inr, c.max_inr), now(), auth.uid())
  on conflict (firm_id) do update set monthly_inr = coalesce(p_inr, least(assistant_caps.monthly_inr, c.max_inr)), set_at = now(), set_by = auth.uid();
  select * into c from asst_limits(f);
  return jsonb_build_object('ok', true, 'cap_inr', c.cap_inr, 'rate', c.rate, 'max_inr', c.max_inr, 'period', 'month');
end $$;

-- the superadmin (two-step) gives one firm another ceiling (null: the platform's default); the firm's limit becomes it
create or replace function public.admin_asst_set_cap(p_firm uuid, p_max numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  if not is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'not_superadmin'); end if;
  if p_firm is null or not exists (select 1 from firms f where f.id = p_firm) then return jsonb_build_object('ok', false, 'reason', 'no_firm'); end if;
  if p_max is not null and (p_max < 0 or p_max > 10000000) then return jsonb_build_object('ok', false, 'reason', 'out_of_range'); end if;
  insert into assistant_caps (firm_id, ceiling_inr, monthly_inr, set_at, set_by)
  values (p_firm, p_max, coalesce(p_max, (asst_ai_conf() ->> 'default_monthly_inr')::numeric), now(), auth.uid())
  on conflict (firm_id) do update set ceiling_inr = excluded.ceiling_inr, monthly_inr = excluded.monthly_inr, set_at = now(), set_by = auth.uid();
  select * into c from asst_limits(p_firm);
  return jsonb_build_object('ok', true, 'cap_inr', c.cap_inr, 'max_inr', c.max_inr);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 2a
-- the hardening text (server/tally-cloud/migration-2-hardening.sql, as on staging), with words for a read-only member
create or replace function public.tally_company_link(p_company text, p_client text)
returns void language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm(); cg text; tg text;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not can_write() then raise exception 'Read-only members cannot link a Tally company to a client. Ask the firm''s owner.' using errcode = '42501'; end if;
  if not exists (select 1 from tally_companies where firm_id = f and company = p_company) then
    raise exception 'no computer has reported % yet; open it in Tally on a connected computer first', p_company;
  end if;
  if p_client is not null then
    select gstin into cg from clients where id = p_client and firm_id = f and not coalesce(deleted, false);
    if not found then raise exception 'no such client'; end if;
    select gstin into tg from tally_companies where firm_id = f and company = p_company;
    if coalesce(cg, '') <> '' and coalesce(tg, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(tg, 3, 10)) then
      raise exception 'the GSTIN of % in Tally (%) is not this client''s (%)', p_company, tg, cg;
    end if;
  end if;
  update tally_companies set client_id = p_client, linked_at = now(), linked_by = auth.uid() where firm_id = f and company = p_company;
  update tally_books b set client_id = coalesce(p_client, '') from tally_companies c where c.firm_id = f and c.company = p_company and b.book_id = c.book_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 2b
-- a signed-in read-only member may not queue a posting into Tally or cancel one (the service role and the bridge have no
-- signed-in user: untouched)
create or replace function public.tally_post_jobs_readonly_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not can_write()
     and (tg_op = 'INSERT' or (new.status is distinct from old.status and new.status in ('waiting', 'cancelled'))) then
    raise exception 'Read-only members cannot post into Tally or cancel a posting. Ask the firm''s owner or staff.' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.tally_post_jobs'::regclass and t.tgname = 'tally_post_jobs_readonly_guard') then
    create trigger tally_post_jobs_readonly_guard before insert or update on public.tally_post_jobs
      for each row execute function public.tally_post_jobs_readonly_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 2c
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'doc inbox: add to own firm') then
    execute $p$alter policy "doc inbox: add to own firm" on storage.objects to authenticated
      with check (bucket_id = 'doc-inbox' and (storage.foldername(name))[1] = (public.my_firm())::text and public.can_write())$p$;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tally_uploads_add') then
    execute $p$alter policy tally_uploads_add on storage.objects to authenticated
      with check (bucket_id = 'tally-uploads' and (storage.foldername(name))[1] = (public.my_firm())::text and public.can_write())$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- grants
revoke all on function public.asst_ai_conf(), public.asst_limits(uuid), public.asst_wallet_ok(uuid), public.tally_post_jobs_readonly_guard() from public, anon, authenticated;
grant execute on function public.asst_ai_conf(), public.asst_limits(uuid), public.asst_wallet_ok(uuid) to service_role;
revoke all on function public.asst_cap_take(uuid, integer), public.asst_cost_add(uuid, text, numeric, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.asst_cap_take(uuid, integer), public.asst_cost_add(uuid, text, numeric, integer, integer, integer, integer) to service_role;
revoke all on function public.asst_usage(integer), public.asst_set_cap(numeric, numeric), public.admin_asst_set_cap(uuid, numeric), public.tally_company_link(text, text) from public, anon;
grant execute on function public.asst_usage(integer), public.asst_set_cap(numeric, numeric), public.admin_asst_set_cap(uuid, numeric), public.tally_company_link(text, text) to authenticated, service_role;

commit;
