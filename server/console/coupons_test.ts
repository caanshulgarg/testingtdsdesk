// deno test server/console/coupons_test.ts   the coupons module (modules/coupons.ts) through the real router, with the
// services faked (tests/console_coupons_fake.ts keeps migration 120's rules). The role matrix for every coupon action
// is in handler_test.ts; this file tests the module's own rules: the form's values, the plain words, the lists'
// filters (status, usage, every column), the Viewer's hidden emails, the audit rows.
import { makeHandler } from "./core/router.ts";
import { type Deps, type Role } from "./core/types.ts";
import { MODULES } from "./registry.ts";
import { COUPONS_LIST, REDEMPTIONS_LIST, REPORT_LIST, couponData } from "./modules/coupons.ts";
import { COUPON_IDS, PLAN_IDS, couponsFake } from "../../tests/console_coupons_fake.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }
const ORIGIN = "https://console-staging.fincom.live";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID: Record<Role, string> = { owner: U(1), billing: U(2), support: U(3), viewer: U(4) };
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tok = (uid: string) => `${b64({ alg: "HS256" })}.${b64({ sub: uid, aal: "aal2", exp: 9999999999 })}.sig`;
const R = "a good reason";

function stand(opts: { dbError?: string } = {}) {
  const roles = new Map(Object.entries(ID).map(([r, id]) => [id, r]));
  const audit: any[] = [];
  const addAudit = (a: any, action: string, tt: string, tid: string, before: unknown, after: unknown) =>
    audit.push({ who: a.p_by, role: roles.get(a.p_by), action, target_type: tt, target_id: tid, before, after, reason: a.p_reason });
  const f = couponsFake({ roleOf: (by) => roles.get(by) || "", audit: addAudit, emailOf: (id) => (id === ID.owner ? "anshul@fincom.live" : "") });
  const rpcs: { fn: string; a: any }[] = [];
  const deps: Deps = {
    getUser: async (jwt) => { const id = Object.values(ID).find((x) => tok(x) === jwt); return id ? { id, email: id + "@fincom.live" } : null; },
    adminRow: async (id) => (roles.has(id) ? { role: roles.get(id)!, active: true } : null),
    rpc: async (fn, a) => {
      rpcs.push({ fn, a });
      if (fn === "console_audit_add") { audit.push({ who: a.p_who, role: a.p_role, action: a.p_action, target_id: a.p_target_id, after: a.p_after, reason: a.p_reason }); return 1; }
      if (opts.dbError && fn.startsWith("console_coupon")) throw new Error(opts.dbError);
      const r = f.rpc(fn, a); if (r === undefined) throw new Error("no rpc " + fn); return r;
    },
    mfaFactors: async () => [], mfaDelete: async () => {}, authBan: async () => {}, rateHit: async () => true, origins: [ORIGIN], log: () => {},
  };
  const h = makeHandler(deps, MODULES);
  const call = async (role: Role, action: string, params: Record<string, unknown> = {}) => {
    const r = await h(new Request("https://x.supabase.co/functions/v1/console-admin", {
      method: "POST", body: JSON.stringify({ action, ...params }), headers: { Origin: ORIGIN, Authorization: "Bearer " + tok(ID[role]), "Content-Type": "application/json" },
    }));
    return { status: r.status, body: await r.json() };
  };
  return { call, audit, rpcs, f };
}

Deno.test("the form's values become the database's: rupees to paise, the kind's own fields only", () => {
  eq(couponData({ code: " diwali 20 ", kind: "percent", percent: "20", months: 3, max_off_inr: "1000.5" }),
     { code: "DIWALI20", kind: "percent", value: 20, months: 3, max_off_paise: 100050, valid_from: null, valid_to: null, plan_ids: null, max_uses: null,
       once_per_firm: true, new_firms_only: false, new_firm_days: 30, stackable: false, campaign: "", note: "" });
  const flat = couponData({ code: "WELCOME500", kind: "flat", amount_inr: 500, months: 1, percent: 99, max_uses: "100", plan_ids: [PLAN_IDS.payg], valid_from: "2026-11-01", valid_to: "2026-11-30" });
  eq([flat.value, flat.months, flat.max_off_paise, flat.max_uses, flat.plan_ids, flat.valid_from], [50000, 1, null, 100, [PLAN_IDS.payg], "2026-11-01"]);
  eq(couponData({ code: "ICAI1000", kind: "credit", amount_inr: 1000, months: 5 }).months, null, "credit has no months");
  eq(couponData({ code: "FIRST2FREE", kind: "free_months", months: 2 }).value, 2);
  eq(couponData({ code: "TRIAL30", kind: "trial_days", days: 30, new_firms_only: true, new_firm_days: 14 }).new_firm_days, 14);
  eq(couponData({ code: "TRIAL30", kind: "trial_days", days: 30, once_per_firm: false, stackable: true }).once_per_firm, false);
  const bad = (p: any) => { try { couponData(p); return ""; } catch (e) { return (e as Error).message; } };
  assert(bad({ code: "AB", kind: "credit", amount_inr: 1 }).startsWith("The code must be 4 to 20"), "short code");
  assert(bad({ code: "AB-12", kind: "credit", amount_inr: 1 }).startsWith("The code must be"), "a sign in the code");
  eq(bad({ code: "ABCD", kind: "gift", amount_inr: 1 }), "Choose the coupon's kind.");
  eq(bad({ code: "ABCD", kind: "percent", percent: 0, months: 1 }), "The percent must be a whole number from 1 to 100.");
  eq(bad({ code: "ABCD", kind: "percent", percent: 10 }), "Give the months.");
  eq(bad({ code: "ABCD", kind: "credit", amount_inr: 100001 }), "The credit must be more than ₹0 and at most ₹1,00,000.");
  eq(bad({ code: "ABCD", kind: "credit", amount_inr: 10.555 }), "The credit can have at most two decimals.");
  eq(bad({ code: "ABCD", kind: "free_months", months: 37 }), "The free months must be a whole number from 1 to 36.");
  eq(bad({ code: "ABCD", kind: "trial_days", days: 1.5 }), "The trial days must be a whole number from 1 to 365.");
  eq(bad({ code: "ABCD", kind: "credit", amount_inr: 5, valid_from: "2026-12-01", valid_to: "2026-11-01" }), "The end date must be on or after the start date.");
  eq(bad({ code: "ABCD", kind: "credit", amount_inr: 5, valid_from: "1 Nov" }), "Valid from is not a date.");
  eq(bad({ code: "ABCD", kind: "credit", amount_inr: 5, plan_ids: ["x"] }), "That plan is not valid.");
});

Deno.test("create, edit, pause, resume, end: each one audit row (by the database function), the reason kept", async () => {
  const s = stand();
  let r = await s.call("billing", "coupon.create", { code: "welcome500", kind: "flat", amount_inr: 500, months: 1, reason: R });
  eq([r.status, r.body.data.code, r.body.data.terms], [200, "WELCOME500", "₹500 off the plan fee for 1 month"]);
  const id = r.body.data.id;
  eq(s.audit.map((a) => [a.action, a.role, a.reason]), [["coupon.create", "billing", R]], "only the function's row (audit: self)");
  r = await s.call("owner", "coupon.update", { coupon_id: id, code: "WELCOME500", kind: "flat", amount_inr: 750, months: 2, reason: R });
  eq([r.status, r.body.data.value, r.body.data.months], [200, 75000, 2]);
  eq(s.audit.at(-1).action, "coupon.update"); eq(s.audit.at(-1).before.value, 50000);
  for (const [a, st] of [["coupon.pause", "paused"], ["coupon.resume", "active"], ["coupon.end", "ended"]]) {
    r = await s.call("owner", a, { coupon_id: id, reason: R });
    eq([r.status, r.body.data.status, s.audit.at(-1).action], [200, st, a], a);
  }
  r = await s.call("owner", "coupon.resume", { coupon_id: id, reason: R });
  eq([r.status, r.body.error], [409, "This coupon has ended. It cannot be changed or started again."]);
  r = await s.call("owner", "coupon.end", { coupon_id: id, reason: R });
  eq([r.status, r.body.error], [409, "It is already in that state."]);
});

Deno.test("the database's refusals in plain words; database text never reaches the screen", async () => {
  const s = stand();
  let r = await s.call("owner", "coupon.create", { code: "Welcome10", kind: "credit", amount_inr: 5, reason: R });
  eq([r.status, r.body.error], [409, "That code is already used by another coupon (codes are not case-sensitive)."]);
  r = await s.call("owner", "coupon.update", { coupon_id: COUPON_IDS.welcome, code: "WELCOME11", kind: "percent", percent: 10, months: 3, reason: R });
  eq([r.status, r.body.error], [409, "This coupon has been used, so its code and kind cannot change. Make a new coupon instead."]);
  r = await s.call("owner", "coupon.update", { coupon_id: COUPON_IDS.welcome, code: "WELCOME10", kind: "percent", percent: 10, months: 3, max_uses: 1, reason: R });
  eq([r.status, r.body.error], [409, "Total uses cannot be less than the uses already made."]);
  r = await s.call("owner", "coupon.get", { coupon_id: U(999) });
  eq([r.status, r.body.error], [404, "That coupon was not found."]);
  r = await s.call("owner", "coupon.pause", { coupon_id: "nope", reason: R });
  eq([r.status, r.body.error], [400, "That coupon is not valid."]);
  const t = stand({ dbError: 'relation "coupons" does not exist' });
  r = await t.call("owner", "coupons.list");
  eq([r.status, r.body.error], [500, "Something went wrong on the server. Nothing was changed."]);
  assert(!JSON.stringify(r.body).includes("relation"), "no database text");
  r = await stand({ dbError: "console: coupon_value" }).call("owner", "coupon.create", { code: "ABCD", kind: "credit", amount_inr: 5, reason: R });
  eq([r.status, r.body.error], [400, "Check the coupon's value, months and limits."]);
  r = await stand({ dbError: "console: not_allowed" }).call("owner", "coupon.end", { coupon_id: COUPON_IDS.welcome, reason: R });
  eq([r.status, r.body.error], [403, "Your role cannot do that."]);
});

Deno.test("a reason is required for every coupon change; nothing runs without it", async () => {
  for (const a of ["coupon.create", "coupon.update", "coupon.pause", "coupon.resume", "coupon.end"]) {
    const s = stand();
    const r = await s.call("owner", a, { coupon_id: COUPON_IDS.welcome, code: "ABCD", kind: "credit", amount_inr: 5, reason: "abc" });
    eq([r.status, r.body.reason], [400, "reason"], a);
    eq(s.rpcs.filter((x) => x.fn.startsWith("console_coupon")).length, 0, a + " nothing ran");
  }
});

Deno.test("lists: a filter on every column (status and usage too), search, sort, export audited", async () => {
  const s = stand();
  const rows = async (action: string, p: Record<string, unknown> = {}) => (await s.call("viewer", action, p)).body.data;
  eq((await rows("coupons.list")).total, 4);
  eq((await rows("coupons.list", { filters: { status: { op: "in", values: ["used_up"] } } })).rows.map((r: any) => r.code), ["ICAI1000"]);
  eq((await rows("coupons.list", { filters: { status: { op: "in", values: ["ended", "paused"] } } })).rows.map((r: any) => r.code).sort(), ["FIRST2FREE", "OLDTRIAL"]);
  eq((await rows("coupons.list", { filters: { usage: { op: "in", values: ["unused"] } } })).total, 2);
  eq((await rows("coupons.list", { filters: { usage: { op: "in", values: ["in_use"] } } })).rows[0].code, "WELCOME10");
  eq((await rows("coupons.list", { filters: { given_inr: { op: "range", from: 1500 } } })).rows.map((r: any) => r.code), ["ICAI1000"]);
  eq((await rows("coupons.list", { filters: { stackable: { op: "is", value: true } } })).rows.map((r: any) => r.code), ["ICAI1000"]);
  eq((await rows("coupons.list", { filters: { new_firms_only: { op: "is", value: true } } })).rows.map((r: any) => r.code), ["FIRST2FREE"]);
  eq((await rows("coupons.list", { filters: { kind: { op: "in", values: ["credit", "trial_days"] } } })).total, 2);
  eq((await rows("coupons.list", { q: "diwali" })).rows.map((r: any) => r.code), ["WELCOME10"]);
  eq((await rows("coupons.list", { sort: { col: "uses", dir: "desc" } })).rows[0].uses, 2);
  // every column of each list may be filtered (ListSpec covers the screen's columns)
  for (const [spec, n] of [[COUPONS_LIST, 17], [REDEMPTIONS_LIST, 10], [REPORT_LIST, 8]] as const) eq(Object.keys(spec.columns).length, n);
  const red = await rows("coupon.redemptions", { coupon_id: COUPON_IDS.welcome, filters: { source: { op: "in", values: ["signup"] } } });
  eq([red.total, red.rows[0].firm, red.rows[0].by_email], [1, "ABC Associates", "as***@abc.test"], "Viewer: emails partly hidden");
  const own = (await s.call("owner", "coupon.redemptions", { coupon_id: COUPON_IDS.welcome })).body.data.rows;
  eq(own.map((r: any) => r.by_email).sort(), ["asha@abc.test", "bina@gsc.test"]);
  eq((await rows("coupon.redemptions", {})).total, 4, "every coupon's redemptions");
  const rep = await rows("coupons.report", { filters: { code: { op: "contains", value: "icai" } } });
  assert(rep.total >= 1 && rep.rows.every((r: any) => r.code === "ICAI1000" && r.credit_inr > 0), "report: per coupon and month");
  const ex = await s.call("billing", "coupons.report", { export: "csv" });
  assert(ex.body.data.csv.startsWith("month,code,kind,campaign,redemptions,credit_inr,discount_inr,total_inr"), "CSV header");
  eq(s.audit.at(-1).action, "coupons.report.export");
  const bad = await s.call("owner", "coupons.list", { filters: { nope: { op: "contains", value: "x" } } });
  eq(bad.status, 400);
});

Deno.test("reads are audited by the router (who looked at which coupon)", async () => {
  const s = stand();
  await s.call("support", "coupon.get", { coupon_id: COUPON_IDS.icai });
  eq([s.audit.at(-1).action, s.audit.at(-1).target_id, s.audit.at(-1).role], ["coupon.get", COUPON_IDS.icai, "support"]);
  await s.call("support", "coupon.plans");
  eq(s.audit.at(-1).action, "coupon.plans");
});
