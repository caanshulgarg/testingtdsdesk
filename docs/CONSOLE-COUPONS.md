# Console: coupons (phase 3)

Branch `next-console-coupons`, migration 120 (`server/console/migration-120-coupons.sql`). The plan: console-plan.md 3.6.
**Not run on staging.** The owner runs the migration and deploys the function (the commands are at the end).

## What a coupon is

| Kind | `kind` | `value` | `months` | What the firm gets |
|---|---|---|---|---|
| % off | `percent` | 1 to 100 | 1 to 120 (required) | That % off the plan fee for N billing months. `max_off_paise` is the optional cap per month |
| Flat ₹ off | `flat` | paise | 1 to 120 (required) | That amount off the plan fee each month for N months |
| Free credit | `credit` | paise (at most ₹1,00,000) | – | Added to the firm's credit at once, through billing's `console_credit_post` |
| Free months | `free_months` | months (1 to 36) | – | No plan fee for N months |
| Longer trial | `trial_days` | days (1 to 365) | – | N days added to the trial |

**Rules on each coupon:**
- the code: 4 to 20 letters and digits, kept in capitals, unique and not case-sensitive;
- valid from and valid to (India dates, both days included);
- the plans it applies to (none chosen means every plan; checked against `firms.plan_id`);
- total uses (blank means no limit) and the uses so far;
- once per firm (on by default);
- new firms only: the firm joined within N days (30 by default);
- stacking (off by default; see below);
- status: active, paused or ended. Ended is final. Uses already made keep running whatever the status.

**Stacking.** A coupon that does not stack needs the firm to have no running coupon. A coupon that stacks needs every running coupon of the firm to stack too, and at most one fee discount (`percent`, `flat` or `free_months`) runs at a time.

"Running" means a redemption whose status is `active`:
- a free-credit redemption is `finished` at once;
- a discount or trial is `active` until billing has applied all of it.

## Where firms enter a code

The one door is `coupon_redeem(p_code text, p_source text default 'settings')`. It is for signed-in people only (not anon).
- `p_source` is `signup` or `settings`.
- It answers `{ok: true, redemption_id, kind, code, message}` or `{ok: false, code, error}`.
- A refusal is an answer, not an error, so the try is counted.
- The words are plain, for example: "That code is not valid. Check it and try again.", "Your firm has already used this code.", "This code is only for firms that joined in the last 30 days."

The rules are checked in this order:
1. signed in;
2. the firm's owner, of an active (not suspended) firm;
3. not 5 wrong codes this hour, counted per firm and per person;
4. the code exists;
5. it is active;
6. today is within its dates;
7. the firm's plan;
8. new firms only;
9. once per firm;
10. uses left;
11. stacking.

It takes a lock on the firm and then the coupon's row, so two firms taking the last use get one success and one "used up".

In the user app:
- **Sign-up.** "Have a coupon?" is a link on the register form's details step. Its box (`app/src/parts/CouponBox.jsx`, its own chunk of about 1 KB) loads only when the link is pressed. The code is kept on that computer (`localStorage fincom:signup-coupon`) and is redeemed once, with source `signup`, at the first sign-in with the firm (`Cloud.signupCoupon`, src/js/27). A toast says what the firm got, or why not, with "You can enter it in Settings, Plan and credit."
- **Settings › Plan and credit.** A "Have a coupon?" box, shown to the firm's owner only.

## THE CONTRACT WITH BILLING: `coupon_discounts`

Percent, flat and free-months coupons, and extended trials, are **pending discounts on the firm's subscription**. Coupons never change a fee or a trial themselves: the billing monthly run applies them.

**Table `coupon_discounts`.** Billing reads it with the service role.

| Column | Meaning |
|---|---|
| `id` bigint | the discount |
| `firm_id` uuid | the firm |
| `kind` | `percent`, `flat`, `free_months` or `trial_days` |
| `value` bigint | percent: 1 to 100 off the plan fee. flat: **paise** off the plan fee each month. free_months: the months granted (the whole plan fee is waived while `months_left > 0`). trial_days: the days to add to the trial |
| `max_off_paise` | percent only: the most taken off in one month (null means no cap) |
| `months_left` int | billing months still to apply. For trial_days: 1 until applied |
| `from_redemption` uuid | `coupon_redemptions.id`. Use it as the ledger line's reference |
| `status` | `pending` (none applied yet), `active` (some applied), `finished`, `reversed` |
| `given_paise`, `last_period` | kept by `coupon_discount_apply` |

**What the monthly run does, for each firm** (live discounts: `status in ('pending','active') and months_left > 0`):
1. Work out the plan fee for the period.
2. Apply the firm's fee discount; at most one is live, and stacking keeps it so:
   - percent: `round(fee × value / 100)`, capped at `max_off_paise`;
   - flat: `min(value, fee)`;
   - free_months: the whole fee.
3. Write its own ledger lines (the `fee` line, and a `discount` line linked to `from_redemption`) with its own idempotency key.
4. Call `select public.coupon_discount_apply(<id>, <period first day>, <paise taken off>, <ledger line ref>)`. It:
   - is idempotent per (discount, period): a second call answers `{applied: false}` and changes nothing;
   - counts `months_left` down and adds the paise to the discount and to its redemption's `value_paise`;
   - finishes both when the count reaches 0.

   It refuses `coupon: discount_done` for a discount that is finished or reversed.
5. For `trial_days`: add `value` days to the subscription's trial end, then call `coupon_discount_apply(<id>, <the day applied>, 0, <ref>)` once. That finishes it.

Billing never updates `coupon_discounts` directly; it uses the function. Rows are never deleted.

**Free credit** is posted at redemption time, in the same transaction, by calling migration 119's function:

```sql
console_credit_post(p_firm uuid, p_amount_paise bigint, p_kind text, p_ref text, p_reason text, p_by uuid)
```

The call is `console_credit_post(firm, value, 'coupon_credit', <redemption id>, 'Coupon <CODE>', <the person>)` (`coupon_credit` is the ledger kind migration 119 allows for it; integ-console fixed the earlier `'coupon'`, which 119 refused as `bad_kind`).

Migration 120 does not create this function. If 119 is not in yet, a free-credit code answers "This code cannot be used just now. Try again later." and nothing is used up. The tests stub it, in test setup only.

## The redemption ledger: `coupon_redemptions`

Each row records:
- who (`by_user`; `by_admin` is kept for a later "apply to a firm");
- the firm, and when;
- the source (`signup`, `settings`; `console` later);
- the terms promised (`promised` jsonb: a copy of the coupon at that moment, with its terms in words);
- the value given so far (`value_paise`: the credit at once, discounts as billed);
- the days added (trial);
- the status.

Once per firm is also kept by a unique index: `(coupon_id, firm_id)` where the redemption was once-per-firm and is not reversed.

A firm may read its own redemptions and discounts. The coupons table and the attempts are never shown to firms.

## Console

In the menu: **Coupons** (`console/src/modules/coupons`; server `server/console/modules/coupons.ts`).

| Screen | What it shows |
|---|---|
| `#/coupons` | the list. Filters on every column: code, kind, terms, status (active, not started, paused, used up, expired, ended), usage (not used yet, in use, all uses taken), uses, total uses, firms, rupees given, valid from and to, plans, once per firm, new firms only, stacks, campaign, created. Presets Active / Paused / Finished / All. Export CSV. Pause, Resume and End on each row |
| `#/coupons/new`, `#/coupons/<id>/edit` | create and edit. The fields of the chosen kind, and "Firms get: …" in words. A used coupon keeps its code and kind. An ended one is not edited |
| `#/coupons/<id>` | the coupon, with Pause / Resume / End, and its redemptions (a DataTable: when, firm, by, where, given so far, status, months left; export) |
| `#/coupons/report` | rupees given per coupon and per month: free credit in the month it was used, discounts in the billing month they were taken off. Presets This month / Last 12 months / All; export |

**Roles:** everyone may view. Owner and Billing may create, edit, pause, resume and end.

**Audit:**
- Each change and its `console_audit` row are written in one transaction by `console_coupon_save` / `console_coupon_set_status`, with before and after. These functions re-check the role.
- Views and exports are audited by the router.
- A reason (5 characters or more) is required for every change.

**Shared pieces touched:**
- `console/src/ui/DataTable.jsx`: a column may be `list: false`, meaning a filter only, not shown as a table column.
- `tests/console_stand.ts` serves the coupon functions from `tests/console_coupons_fake.ts`.
- `run_console_ui.py`: the menu check allows modules added later.

## Tests

- `tests/run_migration120.py` (pg_stand, real SQL): every rule, the plain words, the grants and RLS, the console writes and their audit rows, billing's contract, the report, and the races. The races are two firms taking the last use at once, and one firm sending a once-per-firm code twice at once. `RED_WITHOUT_120=1` fails.
- `server/console/coupons_test.ts` and `handler_test.ts` (Deno; `tests/run_console_server.py` runs every test in server/console):
  - every role against every coupon action, allowed or refused, audited either way;
  - the form's values (rupees to paise);
  - the plain words;
  - a filter on every column;
  - the Viewer's hidden emails;
  - exports audited.
- `tests/run_console_coupons_ui.py` (Playwright, the console stand): the list's filters and presets, export, create / edit / pause / resume / end, the redemptions, the report, roles, phone 390 px and dark mode.
- `tests/run_coupon_box_ui.py` (Playwright on app/dist-test, `coupon_redeem` running on pg_stand):
  - sign-up: the code is kept, then redeemed at the first sign-in;
  - Settings › Plan: wrong, used and good codes;
  - staff see no box;
  - the budgets: main ≤ 260 KB gzip, legacy ≤ 600 KB.

## Deploy (the owner; nothing here was run on staging)

1. After 119, run `server/console/migration-120-coupons.sql` in the SQL editor. It is safe twice.
2. Deploy console-admin, which now includes the coupons module:

   ```
   python3 -I scratchpad/fn_deploy.py <checkout> console-admin server/console/index.ts
   ```

3. Build and publish the console: `console/publish.sh`.
4. Build and publish the user app as usual (`app/publish-preview.sh` / promote).

**Open:**
- Reversing a redemption, and "apply to a firm" from the console, are left for later. The columns `by_admin`, `reversed` and source `console` are ready.
- Step-up for coupon creation (plan 2.1 item 4) waits for the router's step-up.
- The signup code is kept on the computer where the form was filled. On another computer the firm owner enters it in Settings.
