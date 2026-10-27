// The AI control centre (console phase 4; console-plan.md 3.8; docs/CONSOLE-AI.md). Every AI feature in FinCom is one
// row of ai_features (migration 121); the AI functions ask ai_allowed(firm, feature) before any model call
// (server/_shared/ai_policy.ts), so what is set here is what they do, within about 15 seconds.
//   Reads (every role): the registry and the global switch (ai.overview, ai.features.list), the plans' AI allowance
//   (ai.plans.list), the firms' AI state this
//   month (ai.firms.list), usage by day, firm, feature and model (ai.usage.list) and its charts (ai.usage.summary).
//   Writes (a reason; each change and its audit row are one database transaction, audit "self"):
//     ai.feature.set  switch a feature, its model, its price            Owner (console-plan.md 2.4)
//     ai.kill         "Stop all AI now", and back on                    Owner
//     ai.plan.set     a plan's AI allowance (paise a month) and after   Owner, Billing
//     ai.firm.set     a firm: AI off, own allowance, features off       Owner, Billing
import { ALL, ConsoleError, type ListSpec, type Module } from "../core/types.ts";
import { applyQuery, parseQuery } from "../core/listquery.ts";
import { uuid, who } from "../core/util.ts";

// the database's refusals of this module (raise 'console: ai_*') in plain words
const WORDS: Record<string, [number, string]> = {
  ai_no_feature: [404, "That AI feature is not in the registry."],
  ai_no_plan: [404, "That plan was not found."],
  ai_bad_model: [400, "That model cannot be chosen for this feature."],
  ai_bad_value: [400, "One of the values is not allowed. Nothing was changed."],
  ai_bad_range: [400, "The start date must be on or before the end date."],
};
async function rpc(ctx: any, fn: string, args: Record<string, unknown>) {
  try { return await ctx.deps.rpc(fn, args); }
  catch (e) {
    const code = (String((e as any)?.message || e).match(/console: (ai_[a-z_]+)/) || [])[1];
    if (code && WORDS[code]) throw new ConsoleError(WORDS[code][0], WORDS[code][1], code);
    throw e;            // the router's own words (not_allowed, no_firm, same_status, ...)
  }
}

const CODE = /^[a-z0-9_]{2,40}$/;
const code = (v: unknown) => { if (typeof v !== "string" || !CODE.test(v)) throw new ConsoleError(400, "Choose an AI feature.", "bad_param"); return v; };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown, what: string) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v) || isNaN(Date.parse(v))) throw new ConsoleError(400, `Give the ${what} as a date.`, "bad_param");
  return v;
};
// rupees typed on the screen are sent as paise (whole numbers); null = no limit / the plan's
const paise = (v: unknown, what: string) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1_000_000_000) throw new ConsoleError(400, `The ${what} must be a whole number of paise, 0 or more.`, "bad_param");
  return v;
};
const after = (v: unknown, allowNull: boolean) => {
  if ((v === undefined || v === null || v === "") && allowNull) return null;
  if (v !== "charge" && v !== "stop") throw new ConsoleError(400, "Choose what happens after the allowance: charge per use, or stop.", "bad_param");
  return v;
};
const bool = (v: unknown, what: string) => { if (typeof v !== "boolean") throw new ConsoleError(400, `Say yes or no for ${what}.`, "bad_param"); return v; };

export const FEATURES_LIST: ListSpec = {
  columns: { code: "text", name: "text", provider: "select", model: "text", enabled: "bool", price_mode: "select", price_per_use_paise: "number",
             billing_item: "text", counts_against_allowance: "bool", updated_at: "date" },
  search: ["code", "name", "model", "where_in_code"],
  defaultSort: { col: "name", dir: "asc" },
};
export const PLANS_LIST: ListSpec = {
  columns: { plan: "text", allowance_paise: "number", after_allowance: "select", set: "bool", firms: "number", updated_at: "date" },
  search: ["plan"],
  defaultSort: { col: "plan", dir: "asc" },
};
export const FIRMS_LIST: ListSpec = {
  columns: { firm: "text", plan: "select", ai_off: "bool", features_off: "text", allowance_paise: "number", allowance_from: "select",
             after_allowance: "select", spent_paise: "number", calls: "number", over: "bool", owner_switch: "bool", owner_cap_paise: "number", updated_at: "date" },
  search: ["firm", "plan"],
  defaultSort: { col: "spent_paise", dir: "desc" },
};
export const USAGE_LIST: ListSpec = {
  columns: { day: "date", firm: "text", feature: "select", model: "select", calls: "number", tokens_in: "number", tokens_out: "number",
             seconds: "number", cost_paise: "number", charged_paise: "number", margin_paise: "number" },
  search: ["firm", "feature_name", "model"],
  defaultSort: { col: "day", dir: "desc" },
};

const firmRows = async (ctx: any) => (((await rpc(ctx, "console_ai_firms", { p_limit: 5000 })) || []) as any[]).map((r) => ({
  ...r, id: r.firm_id, features_off: (r.features_off || []).join(", "),
  over: r.allowance_paise !== null && r.allowance_paise !== undefined && Number(r.spent_paise) >= Number(r.allowance_paise),
}));
const usage = async (ctx: any, p: any) => (await rpc(ctx, "console_ai_usage", { p_from: day(p.from, "start"), p_to: day(p.to, "end") })) || { rows: [], total: 0, truncated: false };

// the charts and tiles: the same rows as the table, after the same search and filters
export function summarise(rows: any[]) {
  const sum = (xs: any[], k: string) => xs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const group = (k: string) => {
    const m = new Map<string, any[]>();
    for (const r of rows) { const key = String(r[k] ?? ""); if (!m.has(key)) m.set(key, []); m.get(key)!.push(r); }
    return [...m.entries()];
  };
  const by_day = group("day").map(([d, xs]) => ({ day: d, calls: sum(xs, "calls"), cost_paise: sum(xs, "cost_paise"), charged_paise: sum(xs, "charged_paise") }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const by_feature = group("feature").map(([f, xs]) => ({ feature: f, name: xs[0].feature_name || f, calls: sum(xs, "calls"), cost_paise: sum(xs, "cost_paise"), charged_paise: sum(xs, "charged_paise") }))
    .sort((a, b) => b.cost_paise - a.cost_paise || a.feature.localeCompare(b.feature));
  const by_model = group("model").map(([m, xs]) => ({ model: m || "(not logged)", calls: sum(xs, "calls"), cost_paise: sum(xs, "cost_paise") }))
    .sort((a, b) => b.cost_paise - a.cost_paise);
  const top_firms = group("firm_id").map(([id, xs]) => ({ firm_id: id, firm: xs[0].firm || id, calls: sum(xs, "calls"), cost_paise: sum(xs, "cost_paise"), charged_paise: sum(xs, "charged_paise") }))
    .sort((a, b) => b.cost_paise - a.cost_paise || String(a.firm).localeCompare(String(b.firm))).slice(0, 20);
  return {
    totals: { calls: sum(rows, "calls"), cost_paise: sum(rows, "cost_paise"), charged_paise: sum(rows, "charged_paise"), seconds: sum(rows, "seconds"),
              firms: new Set(rows.map((r) => r.firm_id)).size },
    by_day, by_feature, by_model, top_firms,
  };
}

export const module: Module = {
  name: "ai",
  actions: {
    "ai.overview": { roles: ALL, kind: "read", run: async (ctx) => await rpc(ctx, "console_ai_overview", {}) },
    "ai.features.list": {
      roles: ALL, kind: "read", list: FEATURES_LIST,
      run: async (ctx) => (((await rpc(ctx, "console_ai_overview", {})) || {}).features || []).map((f: any) => ({ ...f, id: f.code })),
    },
    "ai.feature.set": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target: (p) => ({ type: "ai_feature", id: String(p.code ?? "") }),
      run: async (ctx, p) => {
        const patch: Record<string, unknown> = {};
        if (p.enabled !== undefined) patch.enabled = bool(p.enabled, "on");
        if (p.counts_against_allowance !== undefined) patch.counts_against_allowance = bool(p.counts_against_allowance, "counts against the allowance");
        if (p.model !== undefined) {
          if (p.model !== null && (typeof p.model !== "string" || p.model.length > 80)) throw new ConsoleError(400, "Choose a model.", "bad_param");
          patch.model = p.model || null;
        }
        if (p.price_mode !== undefined) {
          if (!["included", "per_use", "per_token"].includes(p.price_mode)) throw new ConsoleError(400, "Choose how it is priced.", "bad_param");
          patch.price_mode = p.price_mode;
        }
        for (const k of ["price_per_use_paise", "price_in_mtok_paise", "price_out_mtok_paise", "cost_per_use_paise"]) {
          if (p[k] !== undefined) { const v = paise(p[k], "price"); if (v === null) throw new ConsoleError(400, "Give the price in paise.", "bad_param"); patch[k] = v; }
        }
        if (!Object.keys(patch).length) throw new ConsoleError(400, "Nothing to change.", "bad_param");
        return await rpc(ctx, "console_ai_feature_set", { ...who(ctx, p.reason), p_code: code(p.code), p_patch: patch });
      },
    },
    "ai.kill": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target: () => ({ type: "ai_settings", id: "global" }),
      run: async (ctx, p) => await rpc(ctx, "console_ai_kill", { ...who(ctx, p.reason), p_on: bool(p.on, "stop all AI") }),
    },
    "ai.plan.set": {
      roles: ["owner", "billing"], kind: "write", reason: true, audit: "self", target: (p) => ({ type: "plan", id: String(p.plan_id ?? "") }),
      run: async (ctx, p) => await rpc(ctx, "console_ai_plan_set", { ...who(ctx, p.reason), p_plan: uuid(p.plan_id, "plan"),
        p_allowance_paise: paise(p.allowance_paise, "allowance"), p_after: after(p.after_allowance, false) }),
    },
    "ai.firm.set": {
      roles: ["owner", "billing"], kind: "write", reason: true, audit: "self", target: (p) => ({ type: "firm", id: String(p.firm_id ?? "") }),
      run: async (ctx, p) => {
        const off = p.features_off === undefined || p.features_off === null ? [] : p.features_off;
        if (!Array.isArray(off) || off.length > 50) throw new ConsoleError(400, "Choose the features to switch off.", "bad_param");
        return await rpc(ctx, "console_ai_firm_set", { ...who(ctx, p.reason), p_firm: uuid(p.firm_id, "firm"), p_ai_off: bool(p.ai_off, "AI off"),
          p_allowance_paise: paise(p.allowance_paise, "allowance"), p_after: after(p.after_allowance, true), p_features_off: off.map(code) });
      },
    },
    "ai.plans.list": {
      roles: ALL, kind: "read", list: PLANS_LIST,
      run: async (ctx) => (((await rpc(ctx, "console_ai_overview", {})) || {}).plans || []).map((p: any) => ({ ...p, id: p.plan_id })),
    },
    "ai.firms.list": { roles: ALL, kind: "read", list: FIRMS_LIST, run: async (ctx) => await firmRows(ctx) },
    // params: from, to (YYYY-MM-DD, India days; default the last 30 days; at most 366)
    "ai.usage.list": { roles: ALL, kind: "read", list: USAGE_LIST, run: async (ctx, p) => (await usage(ctx, p)).rows || [] },
    // the same params, search and filters as ai.usage.list -> totals, by day, by feature, by model, top 20 firms
    "ai.usage.summary": {
      roles: ALL, kind: "read",
      run: async (ctx, p) => {
        const lq = parseQuery({ q: p.q, filters: p.filters }, USAGE_LIST);
        const u = await usage(ctx, p);
        const rows = applyQuery(u.rows || [], { ...lq, export: true }, USAGE_LIST).rows;
        return { ...summarise(rows), rows: rows.length, truncated: !!u.truncated, total_rows: u.total || 0 };
      },
    },
  },
};
