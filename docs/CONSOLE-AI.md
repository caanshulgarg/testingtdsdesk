# The AI control centre (console phase 4)

console.fincom.live › **AI**. One place to see and change every AI feature in FinCom: its switch, its model, its price,
how much AI each plan includes, FinCom's override for a firm, the global "Stop all AI now", and what AI costs FinCom
against what firms are charged. Plan: `console-plan.md` section 3.8. Branch `next-console-ai`, migration **121**.

## How it works

```
console (AI screens) ──► console-admin ──► console_ai_*()  ──► ai_features, ai_settings, ai_plan_allowance, ai_firm_settings
                                                                        ▲
every AI edge function ──► server/_shared/ai_policy.ts ──► ai_allowed(firm, feature)   (answer kept 15 s)
```

- The console changes **data**. Every AI function asks `ai_allowed` **before any model call**, at its one entry point,
  so a switch reaches every function within about 15 seconds (the helper's cache).
- A refusal is answered in plain words: **"AI for <feature> is switched off by FinCom."**, as
  `{ok: false, kind: "ai_off", reason, error}`; 403 for a switch, 429 for a used-up allowance whose rule is "stop", 503
  when the settings could not be read (the kill switch is never skipped because of an error). The app shows the words
  wherever the feature is used.
- The firm owner's own switch and rupee cap (Settings › AI help in the app; `assistant_settings`, `asst_cap_take`) stay
  and are still checked after FinCom's. Each function's own limits (voice's 120 minutes a day, call limits, file sizes)
  are unchanged.
- Before migration 121 is run, `ai_allowed` does not exist and every feature works as before (`reason: "no_policy"`).

### What `ai_allowed(firm, feature)` checks, in order

1. the feature is registered (an unregistered code is refused: AI can never be added silently);
2. the global kill switch (`ai_settings.kill`);
3. the feature's switch (`ai_features.enabled`);
4. AI off for this firm, or this feature off for this firm (`ai_firm_settings`);
5. when the feature counts against the allowance: the firm's own allowance, else its plan's (`ai_plan_allowance`, by
   plan id; none set = no limit, today's behaviour), against this month's AI spend at FinCom's cost
   (`assistant_usage.cost_inr`, India's month). Used up and the rule is **stop**: refused ("Your firm's AI allowance for
   this month (₹500.00) is used up. AI starts again on the 1st."). The rule is **charge**: allowed, with `over: true` and
   the feature's price.

It answers `{ok, model, reason, message, over, spent_paise, allowance_paise, ...}`. `model` is the model set in the
console, or null for "the function's own choice".

## The registry today (seeded ON, as the code behaves: nothing changes until the owner changes it)

| Code | Feature | Where | Model can be set | Price today |
|---|---|---|---|---|
| `bill_read` | Bill reading | gateway, `what: "claude"` | yes (one of the gateway's models) | billing item `claude`, ₹3 a unit |
| `bill_ocr` | Page OCR (Google Vision) | gateway, `what: "vision"` | – | billing item `vision`, ₹1 a page |
| `assistant` | Ask FinCom | fincom-assistant, `ask` | – (routes per task) | included |
| `notice` | Notice reading and reply | fincom-assistant (a notice's model calls) | – | included |
| `certificates` | Certificate drafting | fincom-assistant (the certificate tool's calls) | – | included |
| `mis_describe` | My MIS described | fincom-assistant, an MIS asked for | – | included |
| `ledger_check` | GST and TDS ledger check | fincom-assistant, `ledger_guess` | – | included |
| `sheet_map` | Register format reading | fincom-assistant, `sheet_map` | – | included |
| `upload_classify` | What is this upload? | fincom-assistant, `classify` | – | included |
| `voice` | Voice typing | fincom-transcribe | – | included |
| `call_captions` | Call captions | fincom-call, `caption` | – | included |
| `call_summary` | Call summary | fincom-call, the notes | yes | included |
| `2b_match` | 2B match (AI for the left-overs) | gst-2b-match | yes | included |
| `tds_match` | TDS challan match (AI for the left-overs) | tds-challan-match | yes | included |

Bill reading and OCR are charged by the gateway through the billing items (`modules`, `charge_for`); their price is
shown here and changed in Prices. For 2B and TDS matching, AI off means the rules' result alone, with FinCom's words in
the run's line ("AI for 2B match is switched off by FinCom: the rules' result stands.").

## Add AI anywhere: how a new feature registers

A new AI feature is **one registry row plus one call**. It starts **Off**.

1. **The row**, in your feature's own migration (add-only, safe twice):

   ```sql
   insert into public.ai_features (code, name, description, provider, model_default, where_in_code, log_labels)
   values ('gst_notice_draft', 'GST notice draft', 'A first reply to a GST notice', 'anthropic', 'claude-opus-5-5',
           'server/gst-notice', '{gst_notice_draft}')
   on conflict (code) do nothing;
   ```

   `enabled` defaults to **false**: the feature is off until the Owner switches it on in the console. Add
   `model_settable = true, models_allowed = '{...}'` if your function will use the console's model, a price
   (`price_mode`, `price_per_use_paise` or the per-million-token prices) if it is charged, and
   `counts_against_allowance = false` if it is charged per use instead of from the plan's AI allowance.

2. **The call**, once, at the function's entry point, before any key is read or any model called:

   ```ts
   import { aiPolicy, refusal } from "../_shared/ai_policy.ts";
   const policy = aiPolicy((fn, args) => rpc(fn, args, SERVICE));      // once per function instance (keeps the cache)
   // ... in the request, once the firm is known:
   const p = await policy.aiAllowed(firm, "gst_notice_draft");
   if (!p.ok) { const no = refusal(p); return reply(no.status, no.body); }
   const model = p.model || "claude-opus-5-5";
   ```

3. **Log the usage** with the feature's code (`asst_cost_add` / `asst_log_add` with `p_feature: "gst_notice_draft"`), so
   the usage dashboard shows its calls and cost. A label in `assistant_log` that is not a code or one of a feature's
   `log_labels` shows as "Other".

4. **Test**: one deny test (the stub's `ai_allowed` answers `{ok: false, ...}`: no model is called and the words come
   back), and deploy the function with `server/_shared/ai_policy.ts`.

5. **Switch it on**: console › AI › Features › your feature › Change (a reason; it is in the change history).

## The console screens

| Tab | What | Who may change it |
|---|---|---|
| Usage | AI calls, FinCom's cost, charged to firms and the margin; cost against charged by day (chart); cost by feature, by model, top 20 firms; the table by day, firm, feature and model with filters, presets (Charged to firms, Paid by FinCom, Losing money) and CSV. The charts follow the table's search and filters; the date range (7, 30, 90 days, this year, or any range up to 366 days) scopes both | everyone reads |
| Features | the registry: switch, model, price, counts against the allowance | Owner |
| Plans | each plan's AI allowance a month (₹, at FinCom's cost; empty = no limit) and what happens after it (charge per use, or stop AI) | Owner, Billing |
| Firms | each firm's AI this month: spend, allowance and where it comes from, used up, FinCom's switches, the owner's own switch and cap. Override: AI off for the firm, its own allowance and rule, features off for it | Owner, Billing |
| (all tabs) | **Stop all AI now** / Switch AI back on | Owner |

Every change needs a reason and is written with its audit row in the same database transaction (`console_audit`).

### Where the numbers come from

- `assistant_log`: one row per AI request of Ask FinCom, voice typing, call captions and summaries, 2B and TDS matching,
  the ledger check, register formats and uploads: the feature label, models, calls, tokens, milliseconds (seconds of
  audio for Groq) and the cost in rupees at FinCom's cost. Mapped to codes by `ai_code_of` (`book`, `general`, `file`,
  `routing`... → Ask FinCom; a turn that used `build_mis` → My MIS described; `ledger_guess` → ledger check;
  `call_subs` → call captions).
- `wallet_entries`: the gateway's charges (`kind = 'charge'`, codes `claude` and `vision`) less refunds: what firms were
  charged for bill reading and OCR. FinCom's cost there is **estimated** from `cost_per_use_paise` (₹4.25 a Claude
  unit, ₹0.13 a Vision page), because the gateway does not log the provider's usage per call.

## Open items

- **Charge per use after the allowance**: `ai_allowed` answers `over: true` with the price; the ledger line itself waits
  for the billing module's `ledger_post` (no balance moves without a ledger row). Until then "charge" lets AI go on as
  today.
- The user app does not yet grey out AI buttons before a call (`ai_state_for_me` + the platform signal, plan 3.8); it
  shows FinCom's words when a call is refused.
- Bill reading looks like it costs more than it is charged (₹4.25 estimated against ₹3 a unit): check against the
  Anthropic dashboard before changing the price.
- `ledger_check` and `upload_classify` log `cost_inr` 0 in `assistant_log` (their cost is in `assistant_usage_feature`),
  so their cost on the dashboard reads low.

## Deploy (after the owner runs migration 121)

Migration: `server/console/migration-121-ai-control.sql` (after 118; tested by `tests/run_migration121.py`).
Functions to redeploy (each now also uploads `server/_shared/ai_policy.ts`): `gateway`, `fincom-assistant`,
`fincom-transcribe`, `gst-2b-match`, `tds-challan-match`, `fincom-call`, and `console-admin`. Their order does not
matter: before the migration each function behaves as before. The app (bill reading, voice typing, call captions) and
the console are rebuilt as usual.
