-- Migration 96 (17-Oct-2026, branch next-ai-monthly; the owner's decision of 17-Oct-2026): the firm's AI cost limit becomes
-- MONTHLY: Rs 3,000 a firm a calendar month (India's date, Asia/Kolkata) instead of Rs 150 a day. It is shared by Ask FinCom
-- (fincom-assistant) and the 2B matching (gst-2b-match), as before; the warning at 80% stays; no new AI call at 100%; the
-- firm's owner can still change it in Settings › AI help.
--
-- What it changes:
--   1. assistant_caps.monthly_inr (new column, default 3000, 0 to 10,000,000). A firm's row from before gets 3000; its
--      daily_inr is kept as it was and is no longer read. daily_calls (500 a day, the limit on a runaway loop) stays a DAY's
--      count, as before.
--   2. asst_cap_take, asst_cost_add, asst_usage and asst_set_cap (77's text, the only definitions; same arguments, results,
--      SECURITY DEFINER, search_path and grants): the rupee check sums assistant_usage's days of the current calendar month
--      (India's date) against monthly_inr; the setter sets monthly_inr. The JSON keeps its keys (cap_inr, spent_inr, warn,
--      over, ...; spent_inr is now the month's) and adds 'period': 'month' and 'month' (YYYY-MM); asst_usage adds
--      'today_inr' (today's spend). assistant_usage stays one row a firm a day: nothing is moved or rewritten.
--   The month's sum is taken as: the month's earlier days (no longer written) read first, plus today's row in the same
--   UPDATE that takes the call, so two calls at once still cannot both pass the cap (the row lock re-checks today's cost).
-- ADD-ONLY: no table, column, row or function removed; no statement here deletes rows; safe to run twice; one transaction
-- (lock_timeout 10 s). Runs after 77 (and 95, whose gst-2b-match calls asst_cap_take / asst_cost_add). Tested on pg_stand:
-- tests/run_migration96.py; tests/run_assistant_sql.py (the cap in the assistant's chain).

begin;
set local lock_timeout = '10s';

alter table public.assistant_caps add column if not exists monthly_inr numeric(12,2) not null default 3000 check (monthly_inr between 0 and 10000000);

-- before a Claude call: may the firm make one? (under its rupee cap for the month and its call limit for the day). Takes the
-- call when it may.
create or replace function public.asst_cap_take(p_firm uuid, p_n integer default 1)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; d date := (now() at time zone 'Asia/Kolkata')::date; m0 date; used integer; spent numeric; prior numeric;
begin
  m0 := date_trunc('month', d)::date;
  if p_firm is null or coalesce(p_n, 0) < 1 then return jsonb_build_object('ok', false, 'used', 0, 'cap', 0, 'period', 'month'); end if;
  select coalesce(x.daily_calls, 500) calls, coalesce(x.monthly_inr, 3000) inr, coalesce(x.inr_per_usd, 85) rate into c
    from (select 1) z left join assistant_caps x on x.firm_id = p_firm;
  insert into assistant_usage (firm_id, day) values (p_firm, d) on conflict (firm_id, day) do nothing;
  -- the month's days before today (only today's row is written now)
  select coalesce(sum(u.cost_inr), 0) into prior from assistant_usage u where u.firm_id = p_firm and u.day >= m0 and u.day < d;
  update assistant_usage u set calls = u.calls + p_n where u.firm_id = p_firm and u.day = d and u.calls + p_n <= c.calls and prior + u.cost_inr < c.inr
  returning u.calls, prior + u.cost_inr into used, spent;
  if used is null then
    select u.calls, prior + u.cost_inr into used, spent from assistant_usage u where u.firm_id = p_firm and u.day = d;
    spent := coalesce(spent, prior);
    return jsonb_build_object('ok', false, 'used', coalesce(used, 0), 'cap', c.calls, 'spent_inr', round(spent, 2), 'cap_inr', c.inr, 'rate', c.rate, 'day', d,
      'period', 'month', 'month', to_char(d, 'YYYY-MM'), 'why', case when spent >= c.inr then 'inr' else 'calls' end);
  end if;
  return jsonb_build_object('ok', true, 'used', used, 'cap', c.calls, 'spent_inr', round(spent, 2), 'cap_inr', c.inr, 'rate', c.rate, 'day', d, 'warn', spent >= 0.8 * c.inr,
    'period', 'month', 'month', to_char(d, 'YYYY-MM'));
end $$;

-- after a Claude call: its cost (in dollars, from the API's usage and the model's price) in rupees at the firm's rate,
-- added to the day and the feature. Returns what the firm has spent this month against its monthly cap.
create or replace function public.asst_cost_add(p_firm uuid, p_feature text, p_cost_usd numeric, p_in integer, p_out integer, p_cache_read integer, p_cache_write integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; rate numeric; cap numeric; inr numeric; spent numeric; prior numeric;
begin
  select coalesce(x.inr_per_usd, 85), coalesce(x.monthly_inr, 3000) into rate, cap from (select 1) z left join assistant_caps x on x.firm_id = p_firm;
  inr := round(greatest(coalesce(p_cost_usd, 0), 0) * rate, 4);
  insert into assistant_usage (firm_id, day) values (p_firm, d) on conflict (firm_id, day) do nothing;
  update assistant_usage u set input_tokens = u.input_tokens + greatest(coalesce(p_in, 0), 0), output_tokens = u.output_tokens + greatest(coalesce(p_out, 0), 0),
         cache_read = u.cache_read + greatest(coalesce(p_cache_read, 0), 0), cache_write = u.cache_write + greatest(coalesce(p_cache_write, 0), 0), cost_inr = u.cost_inr + inr
   where u.firm_id = p_firm and u.day = d returning u.cost_inr into spent;
  select coalesce(sum(u.cost_inr), 0) into prior from assistant_usage u where u.firm_id = p_firm and u.day >= date_trunc('month', d)::date and u.day < d;
  spent := prior + coalesce(spent, 0);
  insert into assistant_usage_feature (firm_id, day, feature, calls, cost_inr) values (p_firm, d, left(coalesce(nullif(p_feature, ''), 'other'), 40), 1, inr)
  on conflict (firm_id, day, feature) do update set calls = assistant_usage_feature.calls + 1, cost_inr = assistant_usage_feature.cost_inr + excluded.cost_inr;
  return jsonb_build_object('inr', inr, 'spent_inr', round(spent, 2), 'cap_inr', cap, 'warn', spent >= 0.8 * cap, 'over', spent >= cap,
    'period', 'month', 'month', to_char(d, 'YYYY-MM'));
end $$;

-- what the caller may see of the firm's use: everyone this month's spend and the monthly cap (and the 80% warning) and
-- today's count of calls; the owner also the days, the months, the features that use the money, the questions, and the
-- questions no fixed question fitted
create or replace function public.asst_usage(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f uuid := my_firm(); owner boolean; d date := (now() at time zone 'Asia/Kolkata')::date; c record; spent numeric; today_inr numeric; n integer; since date;
begin
  if f is null then return jsonb_build_object('none', true); end if;
  owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role = 'owner');
  select coalesce(x.daily_calls, 500) calls, coalesce(x.monthly_inr, 3000) inr, coalesce(x.inr_per_usd, 85) rate into c from (select 1) z left join assistant_caps x on x.firm_id = f;
  select coalesce(u.cost_inr, 0), coalesce(u.calls, 0) into today_inr, n from (select 1) z left join assistant_usage u on u.firm_id = f and u.day = d;
  select coalesce(sum(u.cost_inr), 0) into spent from assistant_usage u where u.firm_id = f and u.day >= date_trunc('month', d)::date and u.day <= d;
  since := d - least(greatest(coalesce(p_days, 30), 1), 366);
  return jsonb_build_object('cap', c.calls, 'today', n, 'owner', owner, 'cap_inr', c.inr, 'rate', c.rate, 'spent_inr', round(spent, 2),
    'warn', spent >= 0.8 * c.inr, 'over', spent >= c.inr, 'period', 'month', 'month', to_char(d, 'YYYY-MM'), 'today_inr', round(today_inr, 2),
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

-- the owner sets the firm's monthly cap in rupees and the rate (null keeps it)
create or replace function public.asst_set_cap(p_inr numeric, p_rate numeric default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := my_firm();
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role = 'owner') then
    raise exception 'only the firm''s owner sets the cap';
  end if;
  if (p_inr is not null and (p_inr < 0 or p_inr > 10000000)) or (p_rate is not null and (p_rate < 1 or p_rate > 1000)) then raise exception 'cap out of range'; end if;
  insert into assistant_caps (firm_id, monthly_inr, inr_per_usd, set_at, set_by) values (f, coalesce(p_inr, 3000), coalesce(p_rate, 85), now(), auth.uid())
  on conflict (firm_id) do update set monthly_inr = coalesce(p_inr, assistant_caps.monthly_inr), inr_per_usd = coalesce(p_rate, assistant_caps.inr_per_usd), set_at = now(), set_by = auth.uid();
  return jsonb_build_object('ok', true, 'cap_inr', (select monthly_inr from assistant_caps where firm_id = f), 'rate', (select inr_per_usd from assistant_caps where firm_id = f), 'period', 'month');
end $$;

-- the same grants as 77's
revoke all on function public.asst_cap_take(uuid, integer), public.asst_cost_add(uuid, text, numeric, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.asst_cap_take(uuid, integer), public.asst_cost_add(uuid, text, numeric, integer, integer, integer, integer) to service_role;
revoke all on function public.asst_usage(integer), public.asst_set_cap(numeric, numeric) from public, anon;
grant execute on function public.asst_usage(integer), public.asst_set_cap(numeric, numeric) to authenticated;

commit;
