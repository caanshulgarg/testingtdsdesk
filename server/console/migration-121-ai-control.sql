-- FinCom Console, phase 4 "AI control centre" (27-Oct-2026, branch next-console-ai; docs/CONSOLE-AI.md; the plan:
-- console-plan.md section 3.8). NOT run on staging by the builder: the owner runs it. Number 121 (given to this module).
-- Needs migration 118 (console_audit_add, console_role_check) and the assistant's tables (migrations 77 and 96).
--
-- What it adds (add-only; nothing dropped or rewritten; one transaction, lock_timeout 10 s; safe to run twice):
--   ai_features        the registry: one row for every place FinCom uses AI (code, name, provider, the model the
--                      function uses today, whether the console may set the model, the models allowed, on/off, the price
--                      to the firm (included, per use, per million tokens; or the billing item that charges it today),
--                      FinCom's estimated cost per use where the provider's usage is not logged, whether it counts
--                      against the plan's AI allowance, and the usage-log labels that are this feature). A NEW ROW
--                      STARTS OFF (enabled default false): a feature added later is off until the owner switches it on.
--                      The seed rows below are today's features, ON, with today's models and prices: nothing changes
--                      until the owner changes it.
--   ai_settings        one row: the global kill switch ("Stop all AI now"), its reason, who and when.
--   ai_plan_allowance  per plan (plan id; the plans table itself is the billing module's and is not touched): the AI
--                      allowance in paise a month (null: no limit, today's behaviour) and what happens after it is used
--                      up: 'charge' (AI goes on, pay per use) or 'stop'.
--   ai_firm_settings   per firm: AI off for the firm, the firm's own allowance (null: the plan's), its own after-rule,
--                      and features switched off for the firm only.
--   ai_allowed(firm, feature)   THE one rule every AI function asks before a model call (server/_shared/ai_policy.ts
--                      caches the answer for 15 s): {ok, model, reason, message, ...}. Refuses an unregistered feature,
--                      the kill switch, a feature that is off, AI off for the firm or the feature off for the firm, and
--                      a used-up allowance whose rule is 'stop', in plain words ("AI for <feature> is switched off by
--                      FinCom"). The firm owner's own switch and rupee cap (assistant_settings, asst_cap_take) stay as
--                      they are and are still checked by each function.
--   ai_code_of(feature label, tools)    the usage log's label -> the registry's code (for the dashboard).
--   console_ai_*()     the console-admin function's reads and writes (service role only). Every write checks the
--                      caller's console role itself and writes its audit row (console_audit_add) in the same
--                      transaction: console_ai_feature_set, console_ai_kill (owner), console_ai_plan_set,
--                      console_ai_firm_set (owner, billing). Reads: console_ai_overview, console_ai_firms,
--                      console_ai_usage (rows by day, firm, feature and model; the console's charts are worked out
--                      from the same rows, after the same filters, in the console-admin function).
-- Money is in paise (integers). The usage read: assistant_log (every AI call of Ask FinCom, voice, captions, call
-- summaries, 2B and TDS matching: cost_inr at FinCom's cost), wallet_entries (the gateway's charges for bill reading
-- and OCR: what the firm was charged; FinCom's cost there is estimated from cost_per_use_paise).
-- Grants: RLS on with no policy; tables and functions to the service role only; anon and authenticated nothing.
-- Tested on pg_stand: tests/run_migration121.py (RED_WITHOUT_121=1 shows the checks fail without it).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- tables
create table if not exists public.ai_features (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(name) between 2 and 80),
  description text not null default '',
  provider text not null default 'anthropic' check (provider ~ '^[a-z0-9_]{2,30}$'),
  model_default text not null default '',          -- what the function uses when no model is set (words, for the screen)
  model text,                                      -- the model the console set; null: the function's own choice
  model_settable boolean not null default false,   -- the function reads `model` (others choose per task)
  models_allowed text[] not null default '{}',     -- the choices offered when model_settable
  enabled boolean not null default false,          -- a new feature starts OFF
  price_mode text not null default 'included' check (price_mode in ('included', 'per_use', 'per_token')),
  price_per_use_paise integer not null default 0 check (price_per_use_paise between 0 and 10000000),
  price_in_mtok_paise integer not null default 0 check (price_in_mtok_paise between 0 and 100000000),
  price_out_mtok_paise integer not null default 0 check (price_out_mtok_paise between 0 and 100000000),
  billing_item text,                               -- charged today by this billing item (modules.code) instead
  cost_per_use_paise integer not null default 0 check (cost_per_use_paise between 0 and 10000000),
  counts_against_allowance boolean not null default true,
  log_labels text[] not null default '{}',         -- assistant_log.feature values that are this feature
  where_in_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.ai_settings (
  id boolean primary key default true check (id),
  kill boolean not null default false,
  kill_reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.ai_plan_allowance (
  plan_id uuid primary key,                        -- plans.id (the billing module's table; no foreign key on purpose)
  allowance_paise bigint check (allowance_paise is null or allowance_paise between 0 and 1000000000),
  after_allowance text not null default 'charge' check (after_allowance in ('charge', 'stop')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.ai_firm_settings (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  ai_off boolean not null default false,
  allowance_paise bigint check (allowance_paise is null or allowance_paise between 0 and 1000000000),
  after_allowance text check (after_allowance is null or after_allowance in ('charge', 'stop')),
  features_off text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.ai_features enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_plan_allowance enable row level security;
alter table public.ai_firm_settings enable row level security;
revoke all on public.ai_features, public.ai_settings, public.ai_plan_allowance, public.ai_firm_settings from public, anon, authenticated;
grant select, insert, update, delete on public.ai_features, public.ai_plan_allowance, public.ai_firm_settings to service_role;
grant select, update on public.ai_settings to service_role;

-- ---------------------------------------------------------------- the registry's seed: today's features, ON, as they are
-- (on conflict do nothing: a second run, or a row the owner already changed, is left alone)
insert into public.ai_features (code, name, description, provider, model_default, model, model_settable, models_allowed, enabled,
  price_mode, price_per_use_paise, billing_item, cost_per_use_paise, counts_against_allowance, log_labels, where_in_code) values
 ('bill_read', 'Bill reading', 'Reading a bill, sales invoice, statement or notice with Claude', 'anthropic',
  'claude-sonnet-5 (claude-opus-5 for the careful re-read)', null, true, '{claude-sonnet-5,claude-sonnet-4-6,claude-opus-5}', true,
  'per_use', 300, 'claude', 425, false, '{}', 'gateway, what "claude"'),
 ('bill_ocr', 'Page OCR', 'Reading the text of a scanned page with Google Vision', 'google',
  'Google Vision text detection', null, false, '{}', true, 'per_use', 100, 'vision', 13, false, '{}', 'gateway, what "vision"'),
 ('assistant', 'Ask FinCom', 'The assistant: questions on the books, tax questions, files', 'anthropic',
  'Haiku 5.5 routes, Sonnet 5.5 answers, Opus 5.5 for heavy work', null, false, '{}', true, 'included', 0, null, 0, true,
  '{routing,book,general,file,heavy,prefile,cache,""}', 'fincom-assistant, action "ask"'),
 ('notice', 'Notice reading and reply', 'A tax notice read, checked and answered', 'anthropic',
  'claude-opus-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{notice}', 'fincom-assistant, a notice attached or asked about'),
 ('certificates', 'Certificate drafting', 'Net worth, turnover and other certificates from the figures', 'anthropic',
  'claude-sonnet-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{certificates}', 'fincom-assistant, tools/certificates.ts'),
 ('mis_describe', 'My MIS described', 'An MIS laid out from the person''s words (build_mis)', 'anthropic',
  'claude-sonnet-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{}', 'fincom-assistant, mis.ts (build_mis)'),
 ('ledger_check', 'GST and TDS ledger check', 'The AI guess for ledgers the rules could not tell', 'anthropic',
  'claude-haiku-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{ledger_guess}', 'fincom-assistant, action "ledger_guess"'),
 ('sheet_map', 'Register format reading', 'The columns of a new register format', 'anthropic',
  'claude-haiku-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{sheet_map}', 'fincom-assistant, action "sheet_map"'),
 ('upload_classify', 'What is this upload?', 'The kind of an uploaded file the rules could not tell', 'anthropic',
  'claude-haiku-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{upload}', 'fincom-assistant, action "classify"'),
 ('voice', 'Voice typing', 'Clearer listening (Whisper on Groq), and names corrected', 'groq',
  'whisper-large-v3 (turbo for a long clip); claude-haiku-5-5 for names', null, false, '{}', true, 'included', 0, null, 0, true,
  '{voice}', 'fincom-transcribe'),
 ('call_captions', 'Call captions', 'Live subtitles and their translation in meetings', 'groq',
  'whisper-large-v3-turbo; llama-3.1-8b-instant to translate', null, false, '{}', true, 'included', 0, null, 0, true,
  '{call_subs}', 'fincom-call, action "caption"'),
 ('call_summary', 'Call summary', 'The notes of a meeting: summary, decisions, actions', 'anthropic',
  'claude-sonnet-5-5', null, true, '{claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5}', true, 'included', 0, null, 0, true,
  '{call_summary}', 'fincom-call, the notes'),
 ('2b_match', '2B match', 'GSTR-2B against the purchases: AI for what the rules left', 'anthropic',
  'claude-sonnet-5-5', null, true, '{claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5}', true, 'included', 0, null, 0, true,
  '{2b_match}', 'gst-2b-match'),
 ('tds_match', 'TDS challan match', 'Challans against deductions: AI for what the rules left', 'anthropic',
  'claude-sonnet-5-5', null, true, '{claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5}', true, 'included', 0, null, 0, true,
  '{tds_match}', 'tds-challan-match')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- the one rule
-- the firm's AI spend this month (India's month), at FinCom's cost, in paise (the assistant's own daily totals)
create or replace function public.ai_month_spend_paise(p_firm uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(u.cost_inr) * 100), 0)::bigint from public.assistant_usage u
   where u.firm_id = p_firm and u.day >= date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date
$$;

create or replace function public.ai_allowed(p_firm uuid, p_feature text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f record; g record; s record; p record; v_plan uuid; v_limit bigint; v_after text; v_spent bigint := 0; v_off text;
begin
  select * into f from public.ai_features where code = p_feature;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unregistered', 'feature', p_feature,
      'message', 'AI for ' || coalesce(nullif(p_feature, ''), 'this feature') || ' is not registered with FinCom, so it is switched off.');
  end if;
  v_off := 'AI for ' || f.name || ' is switched off by FinCom.';
  select * into g from public.ai_settings where id;
  if coalesce(g.kill, false) then return jsonb_build_object('ok', false, 'reason', 'killed', 'feature', f.code, 'name', f.name, 'message', v_off); end if;
  if not f.enabled then return jsonb_build_object('ok', false, 'reason', 'feature_off', 'feature', f.code, 'name', f.name, 'message', v_off); end if;
  select * into s from public.ai_firm_settings where firm_id = p_firm;
  if found and s.ai_off then return jsonb_build_object('ok', false, 'reason', 'firm_off', 'feature', f.code, 'name', f.name, 'message', v_off); end if;
  if found and f.code = any (s.features_off) then return jsonb_build_object('ok', false, 'reason', 'firm_feature_off', 'feature', f.code, 'name', f.name, 'message', v_off); end if;
  -- the allowance: the firm's own, else its plan's; none set: no limit (today's behaviour)
  if f.counts_against_allowance then
    select plan_id into v_plan from public.firms where id = p_firm;
    select * into p from public.ai_plan_allowance where plan_id = v_plan;
    v_limit := coalesce(s.allowance_paise, p.allowance_paise);
    v_after := coalesce(s.after_allowance, p.after_allowance, 'charge');
    if v_limit is not null then
      v_spent := public.ai_month_spend_paise(p_firm);
      if v_spent >= v_limit then
        if v_after = 'stop' then
          return jsonb_build_object('ok', false, 'reason', 'allowance', 'feature', f.code, 'name', f.name, 'spent_paise', v_spent, 'allowance_paise', v_limit,
            'message', 'Your firm''s AI allowance for this month (₹' || to_char(v_limit / 100.0, 'FM99,99,99,990.00') || ') is used up. AI starts again on the 1st.');
        end if;
        return jsonb_build_object('ok', true, 'reason', 'over_allowance', 'feature', f.code, 'name', f.name, 'model', f.model, 'over', true,
          'spent_paise', v_spent, 'allowance_paise', v_limit, 'price_mode', f.price_mode, 'price_per_use_paise', f.price_per_use_paise,
          'price_in_mtok_paise', f.price_in_mtok_paise, 'price_out_mtok_paise', f.price_out_mtok_paise);
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'reason', 'on', 'feature', f.code, 'name', f.name, 'model', f.model, 'over', false,
    'spent_paise', v_spent, 'allowance_paise', v_limit);
end $$;

-- the usage log's label (and tools) -> the registry's code; a label that is itself a code is that code
create or replace function public.ai_code_of(p_feature text, p_tools text[])
returns text language sql stable security definer set search_path = '' as $$
  select case when 'build_mis' = any (coalesce(p_tools, '{}')) then 'mis_describe' else coalesce(
    (select f.code from public.ai_features f where f.code = p_feature),
    (select f.code from public.ai_features f where coalesce(p_feature, '') = any (f.log_labels) order by f.code limit 1),
    'other') end
$$;

-- ---------------------------------------------------------------- console reads
create or replace function public.console_ai_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plans jsonb := '[]';
begin
  if to_regclass('public.plans') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'plan', p.name, 'allowance_paise', a.allowance_paise,
               'after_allowance', coalesce(a.after_allowance, 'charge'), 'set', a.plan_id is not null, 'updated_at', a.updated_at,
               'firms', (select count(*) from public.firms x where x.plan_id = p.id)) order by p.name), '[]'::jsonb)
             from public.plans p left join public.ai_plan_allowance a on a.plan_id = p.id$q$ into v_plans;
  end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('kill', s.kill, 'kill_reason', s.kill_reason, 'updated_at', s.updated_at, 'updated_by', s.updated_by,
                   'updated_by_email', (select u.email from auth.users u where u.id = s.updated_by)) from public.ai_settings s where s.id),
    'features', coalesce((select jsonb_agg(to_jsonb(f) - 'log_labels' || jsonb_build_object('log_labels', f.log_labels,
                   'updated_by_email', (select u.email from auth.users u where u.id = f.updated_by)) order by f.code) from public.ai_features f), '[]'::jsonb),
    'plans', v_plans,
    'firm_overrides', (select count(*) from public.ai_firm_settings where ai_off or allowance_paise is not null or after_allowance is not null or cardinality(features_off) > 0),
    'month', to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM'));
end $$;

-- every firm with its AI state this month: plan, the allowance in force and where it comes from, spend, FinCom's
-- switches for the firm, and the firm owner's own switch and cap (assistant_settings, assistant_caps)
create or replace function public.console_ai_firms(p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_plan text := 'null::text'; v_m0 date := date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date;
begin
  if to_regclass('public.plans') is not null then v_plan := '(select p.name from public.plans p where p.id = f.plan_id)'; end if;
  execute format($q$
    select coalesce(jsonb_agg(x order by x.spent_paise desc, x.firm), '[]'::jsonb) from (
      select f.id as firm_id, f.name as firm, %s as plan, f.plan_id,
             coalesce(s.ai_off, false) as ai_off, coalesce(s.features_off, '{}') as features_off,
             s.allowance_paise as firm_allowance_paise, s.after_allowance as firm_after,
             a.allowance_paise as plan_allowance_paise, coalesce(a.after_allowance, 'charge') as plan_after,
             coalesce(s.allowance_paise, a.allowance_paise) as allowance_paise,
             coalesce(s.after_allowance, a.after_allowance, 'charge') as after_allowance,
             case when s.allowance_paise is not null then 'firm' when a.allowance_paise is not null then 'plan' else 'none' end as allowance_from,
             coalesce((select round(sum(u.cost_inr) * 100) from public.assistant_usage u where u.firm_id = f.id and u.day >= $1), 0)::bigint as spent_paise,
             coalesce((select sum(u.calls) from public.assistant_usage u where u.firm_id = f.id and u.day >= $1), 0)::bigint as calls,
             (select st.enabled from public.assistant_settings st where st.firm_id = f.id) as owner_switch,
             (select round(c.monthly_inr * 100) from public.assistant_caps c where c.firm_id = f.id)::bigint as owner_cap_paise,
             s.updated_at
        from public.firms f
        left join public.ai_firm_settings s on s.firm_id = f.id
        left join public.ai_plan_allowance a on a.plan_id = f.plan_id
       limit $2) x$q$, v_plan) into v using v_m0, least(greatest(coalesce(p_limit, 5000), 1), 5000);
  return v;
end $$;

-- the usage rows: by India's day, firm, feature (the registry's code) and model, from the assistant's log and the
-- gateway's charges. Money in paise. At most 366 days.
create or replace function public.console_ai_usage_rows(p_from date, p_to date)
returns table (day date, firm_id uuid, feature text, model text, calls bigint, tokens_in bigint, tokens_out bigint, seconds bigint,
               cost_paise bigint, charged_paise bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date); v_from date;
begin
  v_from := greatest(coalesce(p_from, v_to - 29), v_to - 366);
  if v_from > v_to then raise exception 'console: ai_bad_range' using errcode = '22023'; end if;
  return query
  with lg as (
    select (a.at at time zone 'Asia/Kolkata')::date as d, a.firm_id as f, public.ai_code_of(a.feature, a.tools) as code,
           coalesce(a.models[cardinality(a.models)], '') as m, a.calls::bigint as c, a.input_tokens::bigint as ti, a.output_tokens::bigint as tout,
           a.ms::bigint as ms, coalesce(a.cost_inr, 0) as cost
      from public.assistant_log a
     where a.at >= (v_from::timestamp at time zone 'Asia/Kolkata') and a.at < ((v_to + 1)::timestamp at time zone 'Asia/Kolkata')
  ), l as (
    select lg.d, lg.f, lg.code, lg.m, sum(lg.c)::bigint, sum(lg.ti)::bigint, sum(lg.tout)::bigint,
           (case when coalesce(ft.provider, '') = 'groq' then sum(lg.ms) / 1000 else 0 end)::bigint,
           round(sum(lg.cost) * 100)::bigint, 0::bigint
      from lg left join public.ai_features ft on ft.code = lg.code
     group by lg.d, lg.f, lg.code, lg.m, ft.provider
  ), w as (
    select (e.at at time zone 'Asia/Kolkata')::date as d, e.firm_id as f, ft.code, ''::text as m,
           count(*) filter (where e.kind = 'charge' and coalesce(e.note, '') not like 'usage %')::bigint as c,
           round(sum(case when e.kind = 'charge' then abs(e.amount) when e.kind = 'refund' then -abs(e.amount) else 0 end) * 100)::bigint as charged,
           max(ft.price_per_use_paise) as price, max(ft.cost_per_use_paise) as unit_cost
      from public.wallet_entries e join public.ai_features ft on ft.billing_item = e.code
     where e.kind in ('charge', 'refund')
       and e.at >= (v_from::timestamp at time zone 'Asia/Kolkata') and e.at < ((v_to + 1)::timestamp at time zone 'Asia/Kolkata')
     group by 1, 2, 3
  )
  select * from l
  union all
  select w.d, w.f, w.code, w.m, w.c, 0::bigint, 0::bigint, 0::bigint,
         case when w.price > 0 then round(greatest(w.charged, 0)::numeric / w.price * w.unit_cost)::bigint else 0::bigint end,
         w.charged
    from w;
end $$;

create or replace function public.console_ai_usage(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; n bigint;
begin
  select count(*) into n from public.console_ai_usage_rows(p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.day || '|' || r.firm_id || '|' || r.feature || '|' || r.model,
           'day', r.day, 'firm_id', r.firm_id, 'firm', fm.name, 'feature', r.feature, 'feature_name', coalesce(ft.name, r.feature),
           'model', r.model, 'calls', r.calls, 'tokens_in', r.tokens_in, 'tokens_out', r.tokens_out, 'seconds', r.seconds,
           'cost_paise', r.cost_paise, 'charged_paise', r.charged_paise, 'margin_paise', r.charged_paise - r.cost_paise)
         order by r.day desc, r.cost_paise desc), '[]'::jsonb)
    into v
    from (select * from public.console_ai_usage_rows(p_from, p_to) order by day desc, cost_paise desc limit 5000) r
    left join public.firms fm on fm.id = r.firm_id left join public.ai_features ft on ft.code = r.feature;
  return jsonb_build_object('rows', v, 'total', n, 'truncated', n > 5000);
end $$;

-- ---------------------------------------------------------------- console writes (the change and its audit row together)
create or replace function public.console_ai_feature_set(p_by uuid, p_code text, p_patch jsonb, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; f public.ai_features; n public.ai_features; k text;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  select * into f from public.ai_features where code = p_code for update;
  if not found then raise exception 'console: ai_no_feature' using errcode = 'P0002'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'console: ai_bad_value' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('enabled', 'model', 'price_mode', 'price_per_use_paise', 'price_in_mtok_paise', 'price_out_mtok_paise',
                 'cost_per_use_paise', 'counts_against_allowance') then
      raise exception 'console: ai_bad_value' using errcode = '22023';
    end if;
  end loop;
  n := f;
  begin
    if p_patch ? 'enabled' then n.enabled := (p_patch->>'enabled')::boolean; end if;
    if p_patch ? 'counts_against_allowance' then n.counts_against_allowance := (p_patch->>'counts_against_allowance')::boolean; end if;
    if p_patch ? 'price_mode' then n.price_mode := p_patch->>'price_mode'; end if;
    if p_patch ? 'price_per_use_paise' then n.price_per_use_paise := (p_patch->>'price_per_use_paise')::integer; end if;
    if p_patch ? 'price_in_mtok_paise' then n.price_in_mtok_paise := (p_patch->>'price_in_mtok_paise')::integer; end if;
    if p_patch ? 'price_out_mtok_paise' then n.price_out_mtok_paise := (p_patch->>'price_out_mtok_paise')::integer; end if;
    if p_patch ? 'cost_per_use_paise' then n.cost_per_use_paise := (p_patch->>'cost_per_use_paise')::integer; end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'console: ai_bad_value' using errcode = '22023';
  end;
  if p_patch ? 'model' then
    n.model := nullif(p_patch->>'model', '');
    if n.model is not null and (not f.model_settable or not (n.model = any (f.models_allowed))) then
      raise exception 'console: ai_bad_model' using errcode = '22023';
    end if;
  end if;
  if n.price_mode not in ('included', 'per_use', 'per_token') or n.enabled is null or n.counts_against_allowance is null
     or (f.billing_item is not null and (p_patch ? 'price_mode' or p_patch ? 'price_per_use_paise' or p_patch ? 'price_in_mtok_paise' or p_patch ? 'price_out_mtok_paise')) then
    raise exception 'console: ai_bad_value' using errcode = '22023';
  end if;
  begin
    update public.ai_features set enabled = n.enabled, model = n.model, price_mode = n.price_mode, price_per_use_paise = n.price_per_use_paise,
           price_in_mtok_paise = n.price_in_mtok_paise, price_out_mtok_paise = n.price_out_mtok_paise, cost_per_use_paise = n.cost_per_use_paise,
           counts_against_allowance = n.counts_against_allowance, updated_at = now(), updated_by = p_by
     where code = p_code;
  exception when check_violation then raise exception 'console: ai_bad_value' using errcode = '22023';
  end;
  perform public.console_audit_add(p_by, v_role, 'ai.feature.set', 'ai_feature', p_code,
    jsonb_build_object('enabled', f.enabled, 'model', f.model, 'price_mode', f.price_mode, 'price_per_use_paise', f.price_per_use_paise,
      'price_in_mtok_paise', f.price_in_mtok_paise, 'price_out_mtok_paise', f.price_out_mtok_paise, 'cost_per_use_paise', f.cost_per_use_paise,
      'counts_against_allowance', f.counts_against_allowance),
    jsonb_build_object('enabled', n.enabled, 'model', n.model, 'price_mode', n.price_mode, 'price_per_use_paise', n.price_per_use_paise,
      'price_in_mtok_paise', n.price_in_mtok_paise, 'price_out_mtok_paise', n.price_out_mtok_paise, 'cost_per_use_paise', n.cost_per_use_paise,
      'counts_against_allowance', n.counts_against_allowance), p_reason, p_ip, p_ua);
  return jsonb_build_object('code', p_code, 'enabled', n.enabled, 'model', n.model);
end $$;

create or replace function public.console_ai_kill(p_by uuid, p_on boolean, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old boolean;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if p_on is null then raise exception 'console: ai_bad_value' using errcode = '22023'; end if;
  select kill into v_old from public.ai_settings where id for update;
  if v_old = p_on then raise exception 'console: same_status' using errcode = '22023'; end if;
  update public.ai_settings set kill = p_on, kill_reason = case when p_on then nullif(left(p_reason, 1000), '') else null end,
         updated_at = now(), updated_by = p_by where id;
  perform public.console_audit_add(p_by, v_role, case when p_on then 'ai.kill' else 'ai.unkill' end, 'ai_settings', 'global',
    jsonb_build_object('kill', v_old), jsonb_build_object('kill', p_on), p_reason, p_ip, p_ua);
  return jsonb_build_object('kill', p_on);
end $$;

create or replace function public.console_ai_plan_set(p_by uuid, p_plan uuid, p_allowance_paise bigint, p_after text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.ai_plan_allowance; v_ok boolean := true;
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  if p_plan is null then raise exception 'console: ai_no_plan' using errcode = 'P0002'; end if;
  if to_regclass('public.plans') is not null then
    execute 'select exists (select 1 from public.plans where id = $1)' into v_ok using p_plan;
  end if;
  if not v_ok then raise exception 'console: ai_no_plan' using errcode = 'P0002'; end if;
  if (p_allowance_paise is not null and (p_allowance_paise < 0 or p_allowance_paise > 1000000000)) or coalesce(p_after, '') not in ('charge', 'stop') then
    raise exception 'console: ai_bad_value' using errcode = '22023';
  end if;
  select * into v_old from public.ai_plan_allowance where plan_id = p_plan for update;
  insert into public.ai_plan_allowance (plan_id, allowance_paise, after_allowance, updated_at, updated_by)
  values (p_plan, p_allowance_paise, p_after, now(), p_by)
  on conflict (plan_id) do update set allowance_paise = excluded.allowance_paise, after_allowance = excluded.after_allowance,
     updated_at = now(), updated_by = p_by;
  perform public.console_audit_add(p_by, v_role, 'ai.plan.set', 'plan', p_plan::text,
    case when v_old.plan_id is null then null else jsonb_build_object('allowance_paise', v_old.allowance_paise, 'after_allowance', v_old.after_allowance) end,
    jsonb_build_object('allowance_paise', p_allowance_paise, 'after_allowance', p_after), p_reason, p_ip, p_ua);
  return jsonb_build_object('plan_id', p_plan, 'allowance_paise', p_allowance_paise, 'after_allowance', p_after);
end $$;

create or replace function public.console_ai_firm_set(p_by uuid, p_firm uuid, p_ai_off boolean, p_allowance_paise bigint, p_after text,
  p_features_off text[], p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.ai_firm_settings; v_feats text[];
begin
  v_role := public.console_role_check(p_by, array['owner', 'billing']);
  if not exists (select 1 from public.firms where id = p_firm) then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  if p_ai_off is null or (p_allowance_paise is not null and (p_allowance_paise < 0 or p_allowance_paise > 1000000000))
     or (p_after is not null and p_after not in ('charge', 'stop')) then
    raise exception 'console: ai_bad_value' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_feats from unnest(coalesce(p_features_off, '{}')) x;
  if exists (select 1 from unnest(v_feats) x where not exists (select 1 from public.ai_features f where f.code = x)) then
    raise exception 'console: ai_no_feature' using errcode = 'P0002';
  end if;
  select * into v_old from public.ai_firm_settings where firm_id = p_firm for update;
  insert into public.ai_firm_settings (firm_id, ai_off, allowance_paise, after_allowance, features_off, updated_at, updated_by)
  values (p_firm, p_ai_off, p_allowance_paise, p_after, v_feats, now(), p_by)
  on conflict (firm_id) do update set ai_off = excluded.ai_off, allowance_paise = excluded.allowance_paise, after_allowance = excluded.after_allowance,
     features_off = excluded.features_off, updated_at = now(), updated_by = p_by;
  perform public.console_audit_add(p_by, v_role, 'ai.firm.set', 'firm', p_firm::text,
    case when v_old.firm_id is null then null else jsonb_build_object('ai_off', v_old.ai_off, 'allowance_paise', v_old.allowance_paise,
      'after_allowance', v_old.after_allowance, 'features_off', v_old.features_off) end,
    jsonb_build_object('ai_off', p_ai_off, 'allowance_paise', p_allowance_paise, 'after_allowance', p_after, 'features_off', v_feats), p_reason, p_ip, p_ua);
  return jsonb_build_object('firm_id', p_firm, 'ai_off', p_ai_off, 'allowance_paise', p_allowance_paise, 'after_allowance', p_after, 'features_off', v_feats);
end $$;

-- ---------------------------------------------------------------- grants: the service role only
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'console\_ai\_%' or p.proname in ('ai_allowed', 'ai_code_of', 'ai_month_spend_paise')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

commit;
