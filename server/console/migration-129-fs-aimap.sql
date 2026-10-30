-- The Financial statements page's one-time AI mapping (29-Oct-2026, branch next-fs-aimap): its row in the AI control
-- centre's registry (migration 121's ai_features), so FinCom's console can switch it on or off by itself and the usage
-- dashboard names it. NOT run on staging by the builder: the owner runs it. Needs migration 121.
-- Until it is run, fincom-assistant's action "fs_aimap" asks ai_allowed for "fs_aimap", gets "unregistered", and follows
-- the assistant's own switch ("assistant": the kill switch, the firm's AI off, the allowance), so nothing is skipped.
-- Add-only; safe to run twice (on conflict do nothing: a row the owner already changed is left alone). ON, as the other
-- assistant features: included in the firm's plan, counted against its AI allowance, on the firm's monthly rupee cap.
begin;
set local lock_timeout = '10s';
insert into public.ai_features (code, name, description, provider, model_default, model, model_settable, models_allowed, enabled,
  price_mode, price_per_use_paise, billing_item, cost_per_use_paise, counts_against_allowance, log_labels, where_in_code) values
 ('fs_aimap', 'Financial statements mapping', 'Ledgers mapped to the Schedule III lines once, from the audited balance sheet', 'anthropic',
  'claude-sonnet-5-5', null, false, '{}', true, 'included', 0, null, 0, true, '{fs_aimap}', 'fincom-assistant, action "fs_aimap" (fsmap.ts)')
on conflict (code) do nothing;
commit;
