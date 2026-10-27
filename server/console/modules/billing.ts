// Billing core (console phase 2; migration 119): plans, prices, subscriptions, the credit ledger (all firms and one
// firm), top-up / refund / adjust, the balance = ledger check and its adjusting entry, the data clean-up actions, the
// monthly run and its report, and the billing settings. Every write is one database function that re-checks the role
// and writes its console_audit row in the same transaction (audit: "self"). Money crosses this file in paise (whole
// numbers); the lists show rupees so their number filters read as the screen does.
import { sqlError } from "../core/router.ts";
import { ALL, ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";
import { maskRows, notFound, uuid, who } from "../core/util.ts";

// the database's refusals (raise 'console: <code>') in plain words
export const BILLING_WORDS: Record<string, [number, string]> = {
  no_plan: [404, "That plan was not found."],
  bad_plan_name: [400, "Give the plan a name of 2 to 80 characters."],
  plan_exists: [409, "A plan with that name already exists."],
  bad_plan_code: [400, "The code is lowercase letters, digits, - or _ (2 to 40), and must not be in use."],
  bad_features: [400, "Features are a list of short lines (at most 30, each up to 160 characters)."],
  bad_item: [400, "An allowance names an item that cannot be capped here (clients never; shared data only as included)."],
  bad_value: [400, "One of the values is not a whole number in the allowed range."],
  plan_retired: [409, "That plan is retired. Choose an active plan."],
  no_yearly: [409, "That plan has no yearly price."],
  no_item: [404, "That price item was not found."],
  backdated: [400, "A price can start today or later, never in the past."],
  bad_date: [400, "That date is not allowed here."],
  bad_amount: [400, "That amount is not allowed."],
  too_large: [400, "At most ₹10,00,000 in one top-up. Split it into more than one."],
  bad_pay_mode: [400, "Choose how it was paid: bank, UPI, cheque, cash, gateway or other."],
  bad_pay_ref: [400, "Give the payment reference (UTR, cheque number…), 3 to 100 characters."],
  ref_reused: [409, "That reference was already used for a different amount or firm. Nothing was changed."],
  bad_ref: [400, "The request's key is missing. Close the dialog and try again."],
  bad_kind: [400, "That kind of ledger line is not allowed."],
  bad_sign: [400, "That amount has the wrong sign for its kind."],
  below_zero: [409, "That would take the balance below zero."],
  reason: [400, "Give a reason (at least 5 characters)."],
  no_entry: [404, "That ledger line was not found."],
  not_a_charge: [400, "Only a charge or a monthly fee can be refunded."],
  over_refund: [409, "That is more than is left to refund on this charge."],
  owner_needed: [403, "Above ₹10,000 an Owner must do this."],
  bad_category: [400, "Choose a category: goodwill, correction, test clean-up or other."],
  nothing_to_fix: [409, "Nothing to do: it is already as asked."],
  bad_setting: [400, "A setting is not in its range (paused-after days must be more than the grace days)."],
  bad_mode: [400, "Choose this month's run or a retry."],
};
async function db(ctx: Ctx, fn: string, args: Record<string, unknown>): Promise<any> {
  try { return await ctx.deps.rpc(fn, args); }
  catch (e) {
    const code = (String((e as any)?.message || e).match(/console: ([a-z_]+)/) || [])[1];
    if (code && BILLING_WORDS[code]) throw new ConsoleError(BILLING_WORDS[code][0], BILLING_WORDS[code][1], code);
    ctx.deps.log("billing " + fn, e);
    throw sqlError(e);
  }
}
const int = (v: unknown, what: string, lo: number, hi: number, optional = false): number | null => {
  if (optional && (v === undefined || v === null || v === "")) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new ConsoleError(400, `Check ${what}.`, "bad_param");
  return v;
};
const day = (v: unknown, what: string, optional = false): string | null => {
  if (optional && (v === undefined || v === null || v === "")) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new ConsoleError(400, `Give ${what} as a date.`, "bad_param");
  return v;
};
const key = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) throw new ConsoleError(400, "The request's key is missing. Close the dialog and try again.", "bad_ref");
  return v;
};
const rupees = (p: unknown) => (p === null || p === undefined ? null : Number(p) / 100);
const firmTarget = (p: any) => ({ type: "firm", id: String(p.firm_id ?? "") });

// ---- lists
export const PLANS_LIST: ListSpec = {
  columns: { name: "text", code: "text", monthly: "number", yearly: "number", per_client: "number", included_clients: "number", included_users: "number",
             ai_allowance: "number", firms: "number", active: "bool", on_website: "bool", updated_at: "date" },
  search: ["name", "code"], defaultSort: { col: "name", dir: "asc" },
};
export const PRICES_LIST: ListSpec = {
  columns: { title: "text", code: "text", unit: "text", kind: "select", price: "number", since: "date", next_price: "number", next_from: "date",
             versions: "number", firm_prices: "number", active: "bool" },
  search: ["title", "code", "unit"], defaultSort: { col: "title", dir: "asc" },
};
export const SUBS_LIST: ListSpec = {
  columns: { firm: "text", plan: "select", status: "select", billing_cycle: "select", period_start: "date", renews_on: "date", grace_until: "date",
             balance: "number", used: "number", clients: "number", users: "number", ai_used: "number", low: "bool", is_test: "bool", this_month: "select" },
  search: ["firm", "plan"], defaultSort: { col: "firm", dir: "asc" },
};
export const LEDGER_LIST: ListSpec = {
  columns: { id: "number", at: "date", firm: "text", kind: "select", code: "select", amount: "number", balance_after: "number", note: "text", ref: "text",
             reason: "text", category: "select", pay_mode: "select", pay_ref: "text", by_email: "text", refunded: "number", is_test: "bool" },
  search: ["firm", "note", "ref", "reason", "pay_ref", "by_email"], defaultSort: { col: "id", dir: "desc" },
};
export const CHECK_LIST: ListSpec = {
  columns: { firm: "text", balance: "number", ledger_sum: "number", diff: "number", entries: "number", chain_breaks: "number", ok: "bool", is_test: "bool", last_entry_at: "date" },
  search: ["firm"], defaultSort: { col: "diff", dir: "asc" },
};
export const CLEANUP_LIST: ListSpec = {
  columns: { firm: "text", issue: "select", balance: "number", ledger_sum: "number", entries: "number", is_test: "bool", action: "select" },
  search: ["firm"], defaultSort: { col: "firm", dir: "asc" },
};
export const RUNS_LIST: ListSpec = {
  columns: { firm: "text", month: "date", outcome: "select", fee: "number", tries: "number", run_at: "date", run_by: "text", status: "select", balance: "number", is_test: "bool" },
  search: ["firm", "run_by"], defaultSort: { col: "firm", dir: "asc" },
};

const planRow = (p: any) => ({ ...p, monthly: rupees(p.monthly_fee_paise), yearly: rupees(p.yearly_fee_paise), per_client: rupees(p.per_client_fee_paise),
  ai_allowance: p.ai_allowance_paise === -1 ? null : rupees(p.ai_allowance_paise) });
const ledger = async (ctx: Ctx, firm: string | null) =>
  maskRows(ctx, ((await db(ctx, "console_ledger", { p_firm: firm, p_limit: 5000 })) || []), ["by_email"]);
const self = { kind: "write" as const, reason: true, audit: "self" as const };

export const module: Module = {
  name: "billing",
  actions: {
    // ---- plans
    "plans.list": { roles: ALL, kind: "read", list: PLANS_LIST, run: async (ctx) => ((await db(ctx, "console_plans", {})) || []).map(planRow) },
    "plan.get": {
      roles: ALL, kind: "read", target: (p) => ({ type: "plan", id: String(p.plan_id ?? "") }),
      run: async (ctx, p) => {
        const id = uuid(p.plan_id, "plan");
        const x = ((await db(ctx, "console_plans", {})) || []).find((r: any) => r.id === id);
        if (!x) throw notFound("plan");
        return planRow(x);
      },
    },
    "plan.save": {
      roles: ["owner", "billing"], ...self, target: (p) => ({ type: "plan", id: String(p.plan?.id ?? "new") }),
      run: async (ctx, p) => {
        if (!p.plan || typeof p.plan !== "object" || Array.isArray(p.plan) || JSON.stringify(p.plan).length > 8000) throw new ConsoleError(400, "Fill the plan's form.", "bad_param");
        if (p.plan.id !== undefined && p.plan.id !== null) uuid(p.plan.id, "plan");
        return await db(ctx, "console_plan_save", { ...who(ctx, p.reason), p_plan: p.plan });
      },
    },
    // ---- prices
    "prices.list": {
      roles: ALL, kind: "read", list: PRICES_LIST,
      run: async (ctx) => ((await db(ctx, "console_prices", {})) || []).map((r: any) => ({ ...r, price: rupees(r.price_paise), next_price: rupees(r.next_price_paise) })),
    },
    "price.history": {
      roles: ALL, kind: "read", target: (p) => ({ type: "price", id: String(p.item ?? "") }),
      run: async (ctx, p) => {
        if (typeof p.item !== "string" || !/^[a-z][a-z0-9_]{1,39}$/.test(p.item)) throw notFound("price item");
        return (await db(ctx, "console_price_history", { p_item: p.item })) || [];
      },
    },
    "price.set": {
      roles: ["owner", "billing"], ...self, target: (p) => ({ type: "price", id: String(p.item ?? "") }),
      run: async (ctx, p) => {
        if (typeof p.item !== "string" || !/^[a-z][a-z0-9_]{1,39}$/.test(p.item)) throw notFound("price item");
        const { p_by, p_reason, p_ip, p_ua } = who(ctx, p.reason);
        return await db(ctx, "console_price_set", { p_by, p_item: p.item, p_price_paise: int(p.price_paise, "the price", 0, 100_000_000),
          p_from: day(p.effective_from, "the date it starts"), p_reason, p_ip, p_ua });
      },
    },
    // ---- subscriptions
    "subs.list": { roles: ALL, kind: "read", list: SUBS_LIST, run: async (ctx) => (await db(ctx, "console_subscriptions", {})) || [] },
    "sub.get": {
      roles: ALL, kind: "read", target: firmTarget,
      run: async (ctx, p) => { const x = await db(ctx, "console_subscription", { p_firm: uuid(p.firm_id, "firm") }); if (!x) throw notFound("firm"); return x; },
    },
    "sub.change_plan": {
      roles: ["owner", "billing"], ...self, target: firmTarget,
      run: async (ctx, p) => {
        if (p.cycle !== undefined && p.cycle !== null && !["monthly", "yearly"].includes(p.cycle)) throw new ConsoleError(400, "Choose monthly or yearly.", "bad_param");
        const { p_by, p_reason, p_ip, p_ua } = who(ctx, p.reason);
        return await db(ctx, "console_sub_change_plan", { p_by, p_firm: uuid(p.firm_id, "firm"), p_plan: uuid(p.plan_id, "plan"), p_cycle: p.cycle || null, p_reason, p_ip, p_ua });
      },
    },
    "sub.set_status": {
      roles: ["owner", "billing"], ...self, target: firmTarget,
      run: async (ctx, p) => {
        if (!["trial", "active", "past_due", "read_only", "paused", "cancelled"].includes(p.status)) throw new ConsoleError(400, "Choose a status.", "bad_status");
        const { p_by, p_reason, p_ip, p_ua } = who(ctx, p.reason);
        return await db(ctx, "console_sub_set_status", { p_by, p_firm: uuid(p.firm_id, "firm"), p_status: p.status,
          p_trial_ends_on: day(p.trial_ends_on, "the trial's last day", p.status !== "trial"), p_reason, p_ip, p_ua });
      },
    },
    // ---- the ledger: every firm (not Support), or one firm (Support too)
    "ledger.list": {
      roles: ["owner", "billing", "viewer"], kind: "read", list: LEDGER_LIST,
      run: async (ctx, p) => ledger(ctx, p.firm_id ? uuid(p.firm_id, "firm") : null),
    },
    "firm.ledger": {
      roles: ALL, kind: "read", list: LEDGER_LIST, target: firmTarget,
      run: async (ctx, p) => ledger(ctx, uuid(p.firm_id, "firm")),
    },
    "credit.topup": {
      roles: ["owner", "billing"], ...self, target: firmTarget,
      run: async (ctx, p) => {
        const { p_by, p_reason, p_ip, p_ua } = who(ctx, p.reason);
        if (typeof p.amount_paise === "number" && p.amount_paise > 100_000_000) throw new ConsoleError(400, BILLING_WORDS.too_large[1], "too_large");
        return await db(ctx, "console_credit_topup", { p_by, p_firm: uuid(p.firm_id, "firm"), p_amount_paise: int(p.amount_paise, "the amount", 1, 100_000_000),
          p_pay_mode: String(p.pay_mode || ""), p_pay_ref: String(p.pay_ref || "").slice(0, 200), p_received_on: day(p.received_on, "the date received", true), p_reason, p_ip, p_ua });
      },
    },
    "credit.refund": {
      roles: ["owner", "billing"], ...self, target: (p) => ({ type: "ledger", id: String(p.entry_id ?? "") }),
      run: async (ctx, p) => {
        const { p_by, p_reason, p_ip, p_ua } = who(ctx, p.reason);
        return await db(ctx, "console_credit_refund", { p_by, p_entry: int(p.entry_id, "the ledger line", 1, Number.MAX_SAFE_INTEGER),
          p_amount_paise: int(p.amount_paise, "the amount", 1, 100_000_000, true), p_key: key(p.key), p_reason, p_ip, p_ua });
      },
    },
    "credit.adjust": {
      roles: ["owner", "billing"], ...self, target: firmTarget,
      run: async (ctx, p) => {
        const { p_by, p_reason, p_ip, p_ua } = who(ctx, p.reason);
        const amt = int(p.amount_paise, "the amount", -100_000_000, 100_000_000)!;
        if (amt === 0) throw new ConsoleError(400, "That amount is not allowed.", "bad_amount");
        return await db(ctx, "console_credit_adjust", { p_by, p_firm: uuid(p.firm_id, "firm"), p_amount_paise: amt, p_category: String(p.category || ""), p_key: key(p.key), p_reason, p_ip, p_ua });
      },
    },
    // ---- balance = ledger
    "ledger.check": { roles: ["owner", "billing", "viewer"], kind: "read", list: CHECK_LIST, run: async (ctx) => (await db(ctx, "console_ledger_check", {})) || [] },
    "ledger.fix": {
      roles: ["owner"], ...self, target: firmTarget,
      run: async (ctx, p) => await db(ctx, "console_ledger_fix", { ...who(ctx, p.reason), p_firm: uuid(p.firm_id, "firm") }),
    },
    // ---- data clean-up (the owner presses; nothing is automatic)
    "cleanup.list": { roles: ["owner"], kind: "read", list: CLEANUP_LIST, run: async (ctx) => (await db(ctx, "console_cleanup_list", {})) || [] },
    "cleanup.test_credit": {
      roles: ["owner"], ...self, target: firmTarget,
      run: async (ctx, p) => await db(ctx, "console_cleanup_test_credit", { ...who(ctx, p.reason), p_firm: uuid(p.firm_id, "firm"),
        p_target_paise: int(p.target_paise ?? 1_000_000, "the balance to leave", 0, 100_000_000) }),
    },
    // ---- the monthly run
    "billing.run": {
      roles: ["owner", "billing"], ...self, target: (p) => (p.firm_id ? firmTarget(p) : null),
      run: async (ctx, p) => {
        const mode = p.mode === undefined ? "month" : p.mode;
        if (!["month", "retry"].includes(mode)) throw new ConsoleError(400, "Choose this month's run or a retry.", "bad_mode");
        return await db(ctx, "console_billing_run", { p_firm: p.firm_id ? uuid(p.firm_id, "firm") : null, p_by: ctx.caller.id, p_mode: mode, p_reason: p.reason });
      },
    },
    "billing.runs": {
      roles: ["owner", "billing", "viewer"], kind: "read", list: RUNS_LIST,
      run: async (ctx, p) => (await db(ctx, "console_billing_runs", { p_month: day(p.month, "the month", true) })) || [],
    },
    // ---- Settings, billing section
    "settings.billing.get": { roles: ["owner", "billing"], kind: "read", run: async (ctx) => await db(ctx, "console_billing_settings", {}) },
    "settings.billing.set": {
      roles: ["owner"], ...self, target: () => ({ type: "settings", id: "billing" }),
      run: async (ctx, p) => {
        if (!p.value || typeof p.value !== "object" || Array.isArray(p.value)) throw new ConsoleError(400, "Change at least one setting.", "bad_param");
        return await db(ctx, "console_billing_settings_set", { ...who(ctx, p.reason), p_value: p.value });
      },
    },
  },
};
