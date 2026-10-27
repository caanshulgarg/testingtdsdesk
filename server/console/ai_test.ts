// deno test server/console/ai_test.ts   The AI control centre's console actions (modules/ai.ts) through the real router,
// every service faked in memory with migration 121's rules: each write checks the caller's role itself and writes its
// audit row with the change; the model must be one allowed; a billing item's price is not set here.
//   1. every role against every ai.* action: allowed ones run (reads audited by the router, writes by "the database"),
//      refused ones answer 403 and the refusal is audited
//   2. writes need a reason; bad values are refused in plain words before the database; the database's ai_* refusals
//      come back in plain words
//   3. the kill switch, a feature switched off, a plan's allowance and a firm's override change what ai_allowed says
//   4. usage: the list's server-side filters, sort and CSV export; the summary works out the same filtered rows
import { makeHandler } from "./core/router.ts";
import { type Deps, type Role } from "./core/types.ts";
import { MODULES } from "./registry.ts";
import { summarise } from "./modules/ai.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }

const ORIGIN = "https://console-staging.fincom.live";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID: Record<Role, string> = { owner: U(1), billing: U(2), support: U(3), viewer: U(4) };
const F1 = U(101), F2 = U(102), P1 = U(201), P2 = U(202);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tok = (uid: string) => `${b64({ alg: "HS256" })}.${b64({ sub: uid, aal: "aal2", exp: 9999999999 })}.sig`;
const ALL: Role[] = ["owner", "billing", "support", "viewer"];
const R = "the owner asked by phone";

// console-plan.md 2.4: AI usage for everyone; per-firm switch and allowance Owner and Billing; registry, models, prices
// and the global kill switch Owner only
const EXPECT: Record<string, Role[]> = {
  "ai.overview": ALL, "ai.features.list": ALL, "ai.plans.list": ALL, "ai.firms.list": ALL, "ai.usage.list": ALL, "ai.usage.summary": ALL,
  "ai.feature.set": ["owner"], "ai.kill": ["owner"], "ai.plan.set": ["owner", "billing"], "ai.firm.set": ["owner", "billing"],
};
const PARAMS: Record<string, Record<string, unknown>> = {
  "ai.feature.set": { code: "tds_match", enabled: false, reason: R }, "ai.kill": { on: true, reason: R },
  "ai.plan.set": { plan_id: P1, allowance_paise: 50000, after_allowance: "stop", reason: R },
  "ai.firm.set": { firm_id: F1, ai_off: false, allowance_paise: null, after_allowance: null, features_off: ["voice"], reason: R },
  "ai.usage.list": { from: "2026-10-01", to: "2026-10-27" }, "ai.usage.summary": { from: "2026-10-01", to: "2026-10-27" },
};

function fake() {
  const roleOf: Record<string, Role> = Object.fromEntries(Object.entries(ID).map(([r, id]) => [id, r as Role]));
  const audit: any[] = [], calls: string[] = [];
  const features: Record<string, any> = {
    tds_match: { code: "tds_match", name: "TDS challan match", provider: "anthropic", model: null, model_settable: true, models_allowed: ["claude-haiku-5-5", "claude-sonnet-5-5"], enabled: true,
      price_mode: "included", price_per_use_paise: 0, billing_item: null, counts_against_allowance: true, where_in_code: "tds-challan-match", updated_at: "2026-10-27T10:00:00Z" },
    bill_read: { code: "bill_read", name: "Bill reading", provider: "anthropic", model: null, model_settable: true, models_allowed: ["claude-sonnet-5", "claude-opus-5"], enabled: true,
      price_mode: "per_use", price_per_use_paise: 300, billing_item: "claude", counts_against_allowance: false, where_in_code: "gateway", updated_at: "2026-10-27T10:00:00Z" },
    voice: { code: "voice", name: "Voice typing", provider: "groq", model: null, model_settable: false, models_allowed: [], enabled: true,
      price_mode: "included", price_per_use_paise: 0, billing_item: null, counts_against_allowance: true, where_in_code: "fincom-transcribe", updated_at: "2026-10-27T10:00:00Z" },
  };
  const settings = { kill: false };
  const plans: Record<string, any> = { [P1]: { plan_id: P1, plan: "Pay as you go", allowance_paise: null, after_allowance: "charge" }, [P2]: { plan_id: P2, plan: "Monthly", allowance_paise: null, after_allowance: "charge" } };
  const firms: Record<string, any> = { [F1]: { name: "ABC Associates", plan_id: P1, spent: 60000 }, [F2]: { name: "Garg & Co", plan_id: P2, spent: 100 } };
  const over: Record<string, any> = {};
  const err = (c: string) => { throw new Error("console: " + c); };
  const roleCheck = (by: string, roles: string[]) => { if (!roles.includes(roleOf[by])) err("not_allowed"); };
  const add = (a: any, action: string, tt: string, tid: string, before: unknown, after: unknown) => audit.push({ who: a.p_by, role: roleOf[a.p_by], action, target_type: tt, target_id: tid, before, after, reason: a.p_reason });
  // migration 121's ai_allowed, for the effect checks
  const allowed = (firm: string, feature: string) => {
    const f = features[feature];
    if (!f) return { ok: false, reason: "unregistered" };
    const off = "AI for " + f.name + " is switched off by FinCom.";
    if (settings.kill) return { ok: false, reason: "killed", message: off };
    if (!f.enabled) return { ok: false, reason: "feature_off", message: off };
    const s = over[firm];
    if (s?.ai_off) return { ok: false, reason: "firm_off", message: off };
    if (s?.features_off?.includes(feature)) return { ok: false, reason: "firm_feature_off", message: off };
    const p = plans[firms[firm].plan_id];
    const limit = s?.allowance_paise ?? p?.allowance_paise ?? null, rule = s?.after_allowance ?? p?.after_allowance ?? "charge";
    if (f.counts_against_allowance && limit !== null && firms[firm].spent >= limit) return rule === "stop" ? { ok: false, reason: "allowance" } : { ok: true, reason: "over_allowance", over: true };
    return { ok: true, reason: "on", model: f.model };
  };
  const ROWS = [
    { id: "a", day: "2026-10-26", firm_id: F1, firm: "ABC Associates", feature: "assistant", feature_name: "Ask FinCom", model: "claude-sonnet-5-5", calls: 10, tokens_in: 1000, tokens_out: 200, seconds: 0, cost_paise: 5000, charged_paise: 0, margin_paise: -5000 },
    { id: "b", day: "2026-10-26", firm_id: F1, firm: "ABC Associates", feature: "bill_read", feature_name: "Bill reading", model: "", calls: 4, tokens_in: 0, tokens_out: 0, seconds: 0, cost_paise: 1700, charged_paise: 1200, margin_paise: -500 },
    { id: "c", day: "2026-10-27", firm_id: F2, firm: "Garg & Co", feature: "voice", feature_name: "Voice typing", model: "whisper-large-v3", calls: 3, tokens_in: 0, tokens_out: 0, seconds: 90, cost_paise: 0, charged_paise: 0, margin_paise: 0 },
    { id: "d", day: "2026-10-27", firm_id: F2, firm: "Garg & Co", feature: "assistant", feature_name: "Ask FinCom", model: "claude-haiku-5-5", calls: 2, tokens_in: 100, tokens_out: 20, seconds: 0, cost_paise: 30, charged_paise: 0, margin_paise: -30 },
  ];
  let usageArgs: any = null;
  const rpc = async (fn: string, a: any): Promise<any> => {
    calls.push(fn);
    switch (fn) {
      case "console_audit_add":
        audit.push({ who: a.p_who, role: a.p_role, action: a.p_action, target_type: a.p_target_type, target_id: a.p_target_id, after: a.p_after, reason: a.p_reason });
        return audit.length;
      case "console_ai_overview": return { settings: { ...settings }, features: Object.values(features).map((f) => ({ ...f })), plans: Object.values(plans), firm_overrides: Object.keys(over).length };
      case "console_ai_firms": return Object.entries(firms).map(([id, f]) => ({ firm_id: id, firm: f.name, plan: plans[f.plan_id].plan, plan_id: f.plan_id, ai_off: !!over[id]?.ai_off,
        features_off: over[id]?.features_off || [], allowance_paise: over[id]?.allowance_paise ?? plans[f.plan_id].allowance_paise, allowance_from: over[id]?.allowance_paise != null ? "firm" : plans[f.plan_id].allowance_paise != null ? "plan" : "none",
        after_allowance: "charge", spent_paise: f.spent, calls: 3, owner_switch: null, owner_cap_paise: null }));
      case "console_ai_usage": usageArgs = a; return { rows: ROWS.map((r) => ({ ...r })), total: ROWS.length, truncated: false };
      case "console_ai_feature_set": {
        roleCheck(a.p_by, ["owner"]);
        const f = features[a.p_code]; if (!f) err("ai_no_feature");
        if ("model" in a.p_patch && a.p_patch.model !== null && !(f.model_settable && f.models_allowed.includes(a.p_patch.model))) err("ai_bad_model");
        if (f.billing_item && ["price_mode", "price_per_use_paise"].some((k) => k in a.p_patch)) err("ai_bad_value");
        const before = { enabled: f.enabled, model: f.model };
        Object.assign(f, a.p_patch); add(a, "ai.feature.set", "ai_feature", a.p_code, before, a.p_patch); return { code: a.p_code };
      }
      case "console_ai_kill":
        roleCheck(a.p_by, ["owner"]); if (settings.kill === a.p_on) err("same_status");
        settings.kill = a.p_on; add(a, a.p_on ? "ai.kill" : "ai.unkill", "ai_settings", "global", null, { kill: a.p_on }); return { kill: a.p_on };
      case "console_ai_plan_set":
        roleCheck(a.p_by, ["owner", "billing"]); if (!plans[a.p_plan]) err("ai_no_plan");
        Object.assign(plans[a.p_plan], { allowance_paise: a.p_allowance_paise, after_allowance: a.p_after });
        add(a, "ai.plan.set", "plan", a.p_plan, null, { allowance_paise: a.p_allowance_paise, after_allowance: a.p_after }); return {};
      case "console_ai_firm_set":
        roleCheck(a.p_by, ["owner", "billing"]); if (!firms[a.p_firm]) err("no_firm");
        if (a.p_features_off.some((x: string) => !features[x])) err("ai_no_feature");
        over[a.p_firm] = { ai_off: a.p_ai_off, allowance_paise: a.p_allowance_paise, after_allowance: a.p_after, features_off: a.p_features_off };
        add(a, "ai.firm.set", "firm", a.p_firm, null, over[a.p_firm]); return {};
    }
    throw new Error("fake: no rpc " + fn);
  };
  const deps: Deps = {
    getUser: async (jwt) => { const id = Object.values(ID).find((v) => tok(v) === jwt); return id ? { id, email: roleOf[id] + "@fincom.live" } : null; },
    adminRow: async (uid) => (roleOf[uid] ? { role: roleOf[uid], active: true } : null),
    rpc, mfaFactors: async () => [], mfaDelete: async () => {}, authBan: async () => {}, rateHit: async () => true, origins: [ORIGIN], log: () => {},
  };
  const h = makeHandler(deps, MODULES);
  const call = async (role: Role, action: string, params: Record<string, unknown> = {}) => {
    const r = await h(new Request("https://x.supabase.co/functions/v1/console-admin", {
      method: "POST", body: JSON.stringify({ action, ...params }), headers: { Origin: ORIGIN, Authorization: "Bearer " + tok(ID[role]), "Content-Type": "application/json" } }));
    return { status: r.status, body: await r.json() };
  };
  return { call, audit, calls, features, settings, plans, over, allowed, usageArgs: () => usageArgs };
}

Deno.test("1. the ai module's actions are the expected ones, and every role against every action", async () => {
  const names = MODULES.find((m) => m.name === "ai")!.actions;
  eq(Object.keys(names).sort(), Object.keys(EXPECT).sort(), "actions");
  for (const [action, roles] of Object.entries(EXPECT)) {
    for (const role of ALL) {
      const s = fake();
      const r = await s.call(role, action, PARAMS[action] || {});
      if (roles.includes(role)) {
        assert(r.status === 200 && r.body.ok, `${role} ${action}: ${r.status} ${JSON.stringify(r.body)}`);
        const row = s.audit.find((x) => x.action.startsWith(action === "ai.kill" ? "ai.kill" : action));
        assert(row && row.who === ID[role] && row.role === role, `${role} ${action}: audited ${JSON.stringify(s.audit)}`);
        if (EXPECT[action].length < 4) eq(row.reason, R, `${action}: the reason kept`);
      } else {
        eq([r.status, r.body.reason], [403, "role"], `${role} ${action} refused`);
        assert(s.audit.some((x) => x.action === "access.denied" && x.after?.action === action), `${role} ${action}: the refusal audited`);
        assert(!s.calls.some((c) => c.startsWith("console_ai_")), `${role} ${action}: nothing ran`);
      }
    }
  }
});

Deno.test("2. a reason for every write; bad values refused in plain words; the database's refusals in plain words", async () => {
  const s = fake();
  for (const a of ["ai.feature.set", "ai.kill", "ai.plan.set", "ai.firm.set"]) {
    const r = await s.call("owner", a, { ...PARAMS[a], reason: "no" });
    eq([r.status, r.body.reason], [400, "reason"], a + " without a reason");
  }
  const bad = async (a: string, p: Record<string, unknown>, status: number, words: RegExp) => {
    const r = await s.call("owner", a, { ...p, reason: R });
    assert(r.status === status && words.test(r.body.error), `${a} ${JSON.stringify(p)}: ${r.status} ${r.body.error}`);
  };
  await bad("ai.feature.set", { code: "tds_match" }, 400, /Nothing to change/);
  await bad("ai.feature.set", { code: "Bad Code!", enabled: true }, 400, /Choose an AI feature/);
  await bad("ai.feature.set", { code: "tds_match", enabled: "yes" }, 400, /yes or no/);
  await bad("ai.feature.set", { code: "tds_match", price_per_use_paise: 2.5 }, 400, /whole number of paise/);
  await bad("ai.feature.set", { code: "nope", enabled: true }, 404, /not in the registry/);
  await bad("ai.feature.set", { code: "tds_match", model: "gpt-9" }, 400, /cannot be chosen/);
  await bad("ai.feature.set", { code: "voice", model: "whisper-large-v3" }, 400, /cannot be chosen/);
  await bad("ai.feature.set", { code: "bill_read", price_per_use_paise: 500 }, 400, /not allowed/);
  await bad("ai.plan.set", { plan_id: "x", allowance_paise: 1, after_allowance: "stop" }, 400, /plan is not valid/);
  await bad("ai.plan.set", { plan_id: U(299), allowance_paise: 1, after_allowance: "stop" }, 404, /plan was not found/);
  await bad("ai.plan.set", { plan_id: P1, allowance_paise: -1, after_allowance: "stop" }, 400, /0 or more/);
  await bad("ai.plan.set", { plan_id: P1, allowance_paise: 100, after_allowance: "later" }, 400, /charge per use, or stop/);
  await bad("ai.firm.set", { firm_id: F1, ai_off: false, features_off: ["nope"] }, 404, /not in the registry/);
  await bad("ai.firm.set", { firm_id: U(199), ai_off: false }, 404, /firm was not found/);
  await bad("ai.kill", { on: "now" }, 400, /yes or no/);
  await bad("ai.usage.list", { from: "27-10-2026" }, 400, /as a date/);
  // what reached the database is only what was allowed
  eq(Object.values(s.features).map((f: any) => [f.code, f.enabled, f.model, f.price_per_use_paise]),
     [["tds_match", true, null, 0], ["bill_read", true, null, 300], ["voice", true, null, 0]], "nothing changed");
});

Deno.test("3. the switches change what the AI functions are told (ai_allowed), and each change is in the change history", async () => {
  const s = fake();
  eq(s.allowed(F1, "tds_match").ok, true, "on by default");
  await s.call("owner", "ai.feature.set", { code: "tds_match", enabled: false, reason: R });
  eq(s.allowed(F1, "tds_match"), { ok: false, reason: "feature_off", message: "AI for TDS challan match is switched off by FinCom." }, "a feature off");
  await s.call("owner", "ai.feature.set", { code: "tds_match", enabled: true, model: "claude-haiku-5-5", reason: R });
  eq(s.allowed(F1, "tds_match").model, "claude-haiku-5-5", "the console's model");
  await s.call("owner", "ai.kill", { on: true, reason: "key leaked" });
  eq([s.allowed(F1, "voice").reason, s.allowed(F2, "tds_match").reason], ["killed", "killed"], "Stop all AI now");
  eq((await s.call("owner", "ai.kill", { on: true, reason: R })).status, 409, "already stopped");
  await s.call("owner", "ai.kill", { on: false, reason: "key replaced" });
  eq(s.allowed(F1, "voice").ok, true, "AI back on");
  // a plan's allowance (₹500) used up: stop -> refused; charge -> allowed, over
  await s.call("billing", "ai.plan.set", { plan_id: P1, allowance_paise: 50000, after_allowance: "stop", reason: R });
  eq(s.allowed(F1, "voice").reason, "allowance", "ABC spent ₹600 of ₹500: stopped");
  eq(s.allowed(F1, "bill_read").ok, true, "bill reading is charged per read, not from the allowance");
  await s.call("billing", "ai.plan.set", { plan_id: P1, allowance_paise: 50000, after_allowance: "charge", reason: R });
  eq(s.allowed(F1, "voice"), { ok: true, reason: "over_allowance", over: true }, "charge per use after it");
  // the firm's own: a bigger allowance, then AI off for the firm, then one feature off
  await s.call("billing", "ai.firm.set", { firm_id: F1, ai_off: false, allowance_paise: 100000, after_allowance: "stop", features_off: [], reason: R });
  eq(s.allowed(F1, "voice").reason, "on", "the firm's ₹1,000 wins over the plan's");
  await s.call("owner", "ai.firm.set", { firm_id: F1, ai_off: true, reason: R });
  eq(s.allowed(F1, "voice").reason, "firm_off", "AI off for the firm");
  eq(s.allowed(F2, "voice").reason, "on", "another firm untouched");
  await s.call("owner", "ai.firm.set", { firm_id: F2, ai_off: false, features_off: ["voice"], reason: R });
  eq([s.allowed(F2, "voice").reason, s.allowed(F2, "tds_match").reason], ["firm_feature_off", "on"], "one feature off for one firm");
  eq(s.audit.filter((x) => x.action.startsWith("ai.") && !x.action.endsWith("list")).map((x) => x.action),
     ["ai.feature.set", "ai.feature.set", "ai.kill", "ai.unkill", "ai.plan.set", "ai.plan.set", "ai.firm.set", "ai.firm.set", "ai.firm.set"], "every change audited");
  // the firms list shows it
  const fl = await s.call("viewer", "ai.firms.list", { filters: { ai_off: { op: "is", value: true } } });
  eq(fl.body.data.rows.map((r: any) => [r.firm, r.allowance_from, r.over]), [["ABC Associates", "plan", true]], "the firms list, AI-off filter (the whole override was set again: the plan's allowance, used up)");
});

Deno.test("4. usage: filters, sort, export on the server; the summary from the same filtered rows", async () => {
  const s = fake();
  const all = await s.call("viewer", "ai.usage.list", { from: "2026-10-01", to: "2026-10-27" });
  eq(s.usageArgs(), { p_from: "2026-10-01", p_to: "2026-10-27" }, "the dates to the database");
  eq([all.body.data.total, all.body.data.rows[0].day], [4, "2026-10-27"], "all rows, newest first");
  const f = await s.call("viewer", "ai.usage.list", { filters: { feature: { op: "in", values: ["assistant"] } }, sort: { col: "cost_paise", dir: "desc" } });
  eq(f.body.data.rows.map((r: any) => r.id), ["a", "d"], "Ask FinCom only, by cost");
  const m = await s.call("viewer", "ai.usage.list", { q: "garg", filters: { cost_paise: { op: "range", from: 1 } } });
  eq(m.body.data.rows.map((r: any) => r.id), ["d"], "search and a number range");
  const csv = await s.call("support", "ai.usage.list", { export: "csv", filters: { firm: { op: "contains", value: "ABC" } } });
  assert(csv.body.data.csv.startsWith("day,firm,feature,model,calls") && csv.body.data.csv.split("\r\n").length === 4, csv.body.data.csv);
  assert(s.audit.some((x) => x.action === "ai.usage.list.export"), "the export audited");
  const sum = await s.call("viewer", "ai.usage.summary", { from: "2026-10-01", to: "2026-10-27", filters: { feature: { op: "in", values: ["assistant", "bill_read"] } } });
  const d = sum.body.data;
  eq(d.totals, { calls: 16, cost_paise: 6730, charged_paise: 1200, seconds: 0, firms: 2 }, "totals of the filtered rows");
  eq(d.by_day.map((x: any) => [x.day, x.cost_paise]), [["2026-10-26", 6700], ["2026-10-27", 30]], "by day, oldest first");
  eq(d.by_feature.map((x: any) => x.feature), ["assistant", "bill_read"], "by feature, by cost");
  eq(d.top_firms.map((x: any) => [x.firm, x.cost_paise, x.charged_paise]), [["ABC Associates", 6700, 1200], ["Garg & Co", 30, 0]], "top firms");
  eq(d.by_model.map((x: any) => x.model), ["claude-sonnet-5-5", "(not logged)", "claude-haiku-5-5"], "by model");
  const bad = await s.call("viewer", "ai.usage.summary", { filters: { nope: { op: "in", values: ["x"] } } });
  eq(bad.status, 400, "a filter not on the list refused");
  eq(summarise([]).totals, { calls: 0, cost_paise: 0, charged_paise: 0, seconds: 0, firms: 0 }, "no rows: zeros");
});
