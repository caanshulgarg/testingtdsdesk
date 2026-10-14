-- Migration 82 (14-Oct-2026, FinCom Assistant; branch assistant-default). The owner's decision of 14-Oct-2026: FinCom
-- Assistant is ON for every firm unless the firm's owner switches it off, and it is not held back by a clients'-consent
-- tick (the notice "Questions may be processed by an AI provider; identifiers are masked" is shown to each person on first
-- use instead). The daily cost cap (Rs 150 a firm a day, migration 77) stays on.
--
-- What it changes, add-only (no table, column, row or function removed; no stored value changed):
--   - assistant_settings: new rows default to enabled; a firm with no row counts as ON (asst_settings below, and the
--     fincom-assistant function's own gate). A firm whose owner switched it off keeps its row (enabled false): still off.
--   - asst_settings() answers enabled = the firm's row, else true; consent is no longer asked (answered true, kept for the
--     app's older builds); default_on says the firm has never set it.
-- 80 and 81 are other branches' (tds-layout's 80); this is 82. Safe to run twice; one transaction (lock_timeout 10 s).
-- Tested on pg_stand: tests/run_assistant_sql.py.

begin;
set local lock_timeout = '10s';

alter table public.assistant_settings alter column enabled set default true;
alter table public.assistant_settings alter column consent set default true;

create or replace function public.asst_settings()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('enabled', coalesce(s.enabled, true), 'consent', true, 'default_on', s.firm_id is null, 'set_at', s.set_at,
    'owner', exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = my_firm() and m.active and m.role = 'owner'))
  from (select my_firm() f) z left join assistant_settings s on s.firm_id = z.f where z.f is not null
$$;
revoke all on function public.asst_settings() from public, anon;
grant execute on function public.asst_settings() to authenticated;

commit;
