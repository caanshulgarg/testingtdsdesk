// Coupons (console-plan.md 3.6; migration 120; docs/CONSOLE-COUPONS.md). Everyone sees the coupons, their redemptions
// and the report; Owner and Billing create, edit, pause, resume and end them. Each change and its audit row are one
// database transaction (console_coupon_save / console_coupon_set_status), which re-check the caller's role.
// Firms redeem a code in the user app (coupon_redeem, migration 120), never here.
import { sqlError } from "../core/router.ts";
import { ALL, ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";
import { maskRows, notFound, uuid, who } from "../core/util.ts";

export const COUPONS_LIST: ListSpec = {
  columns: { code: "text", kind: "select", terms: "text", status: "select", usage: "select", uses: "number", max_uses: "number", firms: "number",
             given_inr: "number", valid_from: "date", valid_to: "date", plans: "text", once_per_firm: "bool", new_firms_only: "bool",
             stackable: "bool", campaign: "text", created_at: "date" },
  search: ["code", "campaign", "terms", "note"],
  defaultSort: { col: "created_at", dir: "desc" },
};
export const REDEMPTIONS_LIST: ListSpec = {
  columns: { at: "date", firm: "text", code: "text", by_email: "text", source: "select", kind: "select", terms: "text", value_inr: "number",
             status: "select", months_left: "number" },
  search: ["firm", "by_email", "code"],
  defaultSort: { col: "at", dir: "desc" },
};
export const REPORT_LIST: ListSpec = {
  columns: { month: "date", code: "text", kind: "select", campaign: "text", redemptions: "number", credit_inr: "number", discount_inr: "number", total_inr: "number" },
  search: ["code", "campaign"],
  defaultSort: { col: "month", dir: "desc" },
};
export const KINDS = ["percent", "flat", "credit", "free_months", "trial_days"] as const;
const WRITERS: ("owner" | "billing")[] = ["owner", "billing"];

// the database's refusals in plain words (beside the router's own: same_status, not_allowed, bad_status)
const WORDS: Record<string, [number, string]> = {
  coupon_code: [400, "The code must be 4 to 20 letters and digits, with no spaces or signs."],
  coupon_code_taken: [409, "That code is already used by another coupon (codes are not case-sensitive)."],
  coupon_kind: [400, "Choose the coupon's kind."],
  coupon_value: [400, "Check the coupon's value, months and limits."],
  coupon_dates: [400, "The end date must be on or after the start date."],
  coupon_plan: [400, "One of the chosen plans was not found."],
  coupon_in_use: [409, "This coupon has been used, so its code and kind cannot change. Make a new coupon instead."],
  coupon_max_below_uses: [409, "Total uses cannot be less than the uses already made."],
  coupon_ended: [409, "This coupon has ended. It cannot be changed or started again."],
  no_coupon: [404, "That coupon was not found."],
};
async function db(ctx: Ctx, fn: string, args: Record<string, unknown>) {
  try { return await ctx.deps.rpc(fn, args); }
  catch (e) {
    const code = (String((e as any)?.message || e).match(/console: ([a-z_]+)/) || [])[1];
    if (code && WORDS[code]) throw new ConsoleError(WORDS[code][0], WORDS[code][1], code);
    throw sqlError(e);
  }
}

const bad = (m: string) => new ConsoleError(400, m, "bad_param");
const int = (v: unknown, what: string, min: number, max: number, need = true): number | null => {
  if (v === undefined || v === null || v === "") { if (need) throw bad(`Give ${what}.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${what[0].toUpperCase() + what.slice(1)} must be a whole number from ${min} to ${max}.`);
  return n;
};
const paise = (v: unknown, what: string, need = true): number | null => {
  if (v === undefined || v === null || v === "") { if (need) throw bad(`Give ${what}.`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw bad(`${what[0].toUpperCase() + what.slice(1)} must be more than ₹0 and at most ₹1,00,000.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw bad(`${what[0].toUpperCase() + what.slice(1)} can have at most two decimals.`);
  return Math.round(n * 100);
};
const day = (v: unknown, what: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + "T00:00:00Z"))) throw bad(`${what} is not a date.`);
  return v;
};
const yes = (v: unknown, dflt: boolean) => (v === undefined || v === null ? dflt : v === true || v === "true");

// the form's fields (rupees, as people type them) -> the database's (paise). Every rule is checked again in SQL.
export function couponData(p: any) {
  const code = String(p.code ?? "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(code)) throw new ConsoleError(400, WORDS.coupon_code[1], "coupon_code");
  const kind = String(p.kind ?? "");
  if (!(KINDS as readonly string[]).includes(kind)) throw new ConsoleError(400, WORDS.coupon_kind[1], "coupon_kind");
  let value: number, months: number | null = null, max_off_paise: number | null = null;
  if (kind === "percent") {
    value = int(p.percent, "the percent", 1, 100)!; months = int(p.months, "the months", 1, 120)!; max_off_paise = paise(p.max_off_inr, "the most off a month", false);
  } else if (kind === "flat") { value = paise(p.amount_inr, "the amount off")!; months = int(p.months, "the months", 1, 120)!; }
  else if (kind === "credit") value = paise(p.amount_inr, "the credit")!;
  else if (kind === "free_months") value = int(p.months, "the free months", 1, 36)!;
  else value = int(p.days, "the trial days", 1, 365)!;
  const valid_from = day(p.valid_from, "Valid from"), valid_to = day(p.valid_to, "Valid to");
  if (valid_from && valid_to && valid_from > valid_to) throw new ConsoleError(400, WORDS.coupon_dates[1], "coupon_dates");
  const plan_ids = Array.isArray(p.plan_ids) && p.plan_ids.length ? p.plan_ids.map((x: unknown) => uuid(x, "plan")) : null;
  const campaign = typeof p.campaign === "string" ? p.campaign.trim().slice(0, 60) : "";
  const note = typeof p.note === "string" ? p.note.trim().slice(0, 500) : "";
  const newOnly = yes(p.new_firms_only, false);
  return {
    code, kind, value, months, max_off_paise, valid_from, valid_to, plan_ids,
    max_uses: int(p.max_uses, "total uses", 1, 1000000, false),
    once_per_firm: yes(p.once_per_firm, true), new_firms_only: newOnly,
    new_firm_days: newOnly ? int(p.new_firm_days, "the days since joining", 1, 3650, false) ?? 30 : 30,
    stackable: yes(p.stackable, false), campaign, note,
  };
}

const target = (p: any) => ({ type: "coupon", id: String(p.coupon_id ?? p.code ?? "") });
const setStatus = (status: string) => async (ctx: Ctx, p: any) =>
  await db(ctx, "console_coupon_set_status", { ...who(ctx, p.reason), p_id: uuid(p.coupon_id, "coupon"), p_status: status });

export const module: Module = {
  name: "coupons",
  actions: {
    "coupons.list": { roles: ALL, kind: "read", list: COUPONS_LIST, run: async (ctx) => (await db(ctx, "console_coupons", {})) || [] },
    "coupon.get": {
      roles: ALL, kind: "read", target,
      run: async (ctx, p) => {
        const c = await db(ctx, "console_coupon", { p_id: uuid(p.coupon_id, "coupon") });
        if (!c) throw notFound("coupon");
        return c;
      },
    },
    // one coupon's redemptions (coupon_id), or every coupon's (none given)
    "coupon.redemptions": {
      roles: ALL, kind: "read", list: REDEMPTIONS_LIST, target: (p) => (p.coupon_id ? target(p) : null),
      run: async (ctx, p) => maskRows(ctx, (await db(ctx, "console_coupon_redemptions", { p_coupon: p.coupon_id ? uuid(p.coupon_id, "coupon") : null })) || [], ["by_email"]),
    },
    "coupons.report": { roles: ALL, kind: "read", list: REPORT_LIST, run: async (ctx) => (await db(ctx, "console_coupon_report", {})) || [] },
    "coupon.plans": { roles: ALL, kind: "read", run: async (ctx) => (await db(ctx, "console_coupon_plans", {})) || [] },
    "coupon.create": {
      roles: WRITERS, kind: "write", reason: true, audit: "self", target: (p) => ({ type: "coupon", id: String(p.code ?? "") }),
      run: async (ctx, p) => await db(ctx, "console_coupon_save", { ...who(ctx, p.reason), p_id: null, p_data: couponData(p) }),
    },
    "coupon.update": {
      roles: WRITERS, kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => await db(ctx, "console_coupon_save", { ...who(ctx, p.reason), p_id: uuid(p.coupon_id, "coupon"), p_data: couponData(p) }),
    },
    "coupon.pause": { roles: WRITERS, kind: "write", reason: true, audit: "self", target, run: setStatus("paused") },
    "coupon.resume": { roles: WRITERS, kind: "write", reason: true, audit: "self", target, run: setStatus("active") },
    "coupon.end": { roles: WRITERS, kind: "write", reason: true, audit: "self", target, run: setStatus("ended") },
  },
};
