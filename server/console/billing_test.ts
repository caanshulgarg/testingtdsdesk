// deno test server/console/billing_test.ts: the billing module (migration 119's functions faked in memory by
// tests/console_billing_fake.ts) through the REAL router: the plain words for the database's refusals, the checks made
// before the database is asked, idempotent money actions, the ledgers' filters and export, Support's one-firm ledger,
// the balance = ledger fix, the clean-up action, the monthly run twice, the settings. Every role x action allow / deny
// (and the audit rows) is in handler_test.ts, from billing_matrix.ts.
import { makeHandler } from "./core/router.ts";
import { type Deps, type Role } from "./core/types.ts";
import { MODULES } from "./registry.ts";
import { billingFake } from "../../tests/console_billing_fake.ts";
import { B_FIRM, B_FIRM2, TODAY } from "./billing_matrix.ts";
import { BILLING_WORDS } from "./modules/billing.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }
const ORIGIN = "https://console-staging.fincom.live";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID: Record<Role, string> = { owner: U(1), billing: U(2), support: U(3), viewer: U(4) };
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tok = (uid: string) => `${b64({ alg: "HS256" })}.${b64({ sub: uid, aal: "aal2" })}.sig`;
const R = "ticket 42, owner asked";

function stand() {
  const audit: any[] = [];
  const calls: string[] = [];
  const role = (by: string) => (Object.entries(ID).find(([, v]) => v === by) || [""])[0];
  const firms = [{ id: B_FIRM, name: "ABC Associates", balance: 499999610 }, { id: B_FIRM2, name: "ZZ TEST", balance: 1000 }, { id: U(103), name: "Garg Shekhar & Co", balance: 175 }];
  const bill = billingFake(firms, { roleOf: role, audit: (a, action, tt, tid, before, after) => audit.push({ who: a.p_by, role: role(a.p_by) || "system", action, target_type: tt, target_id: tid, before, after, reason: a.p_reason }) });
  const deps: Deps = {
    getUser: async (jwt) => { const id = Object.values(ID).find((v) => tok(v) === jwt); return id ? { id, email: role(id) + "@fincom.live" } : null; },
    adminRow: async (id) => (role(id) ? { role: role(id), active: true } : null),
    rpc: async (fn, a) => {
      calls.push(fn);
      if (fn === "console_audit_add") { audit.push({ who: a.p_who, role: a.p_role, action: a.p_action, target_id: a.p_target_id, after: a.p_after, reason: a.p_reason }); return 1; }
      const r = await bill(fn, a);
      if (r === undefined) throw new Error("no rpc " + fn);
      return r;
    },
    mfaFactors: async () => [], mfaDelete: async () => {}, authBan: async () => {}, rateHit: async () => true, origins: [ORIGIN], log: () => {},
  };
  const h = makeHandler(deps, MODULES);
  const call = async (who: Role, action: string, params: Record<string, unknown> = {}) => {
    const r = await h(new Request("https://x/functions/v1/console-admin", { method: "POST", body: JSON.stringify({ action, ...params }),
      headers: { Origin: ORIGIN, Authorization: "Bearer " + tok(ID[who]), "Content-Type": "application/json" } }));
    return { status: r.status, body: await r.json() };
  };
  return { call, audit, calls, firms };
}

Deno.test("the database's refusals reach the screen in plain words; unknown database text never does", async () => {
  const s = stand();
  let r = await s.call("billing", "credit.adjust", { firm_id: B_FIRM, amount_paise: 1000001, category: "goodwill", key: "adjkey0009", reason: R });
  eq([r.status, r.body.reason, r.body.error], [403, "owner_needed", BILLING_WORDS.owner_needed[1]]);
  r = await s.call("owner", "credit.topup", { firm_id: B_FIRM, amount_paise: 50000, pay_mode: "barter", pay_ref: "UTR-9", reason: R });
  eq([r.status, r.body.reason], [400, "bad_pay_mode"]);
  r = await s.call("owner", "price.set", { item: "bills", price_paise: 300, effective_from: "2020-01-01", reason: R });
  eq([r.status, r.body.reason], [400, "backdated"]);
  r = await s.call("owner", "sub.change_plan", { firm_id: B_FIRM, plan_id: U(999), reason: R });
  eq([r.status, r.body.reason], [404, "no_plan"]);
  assert(!JSON.stringify(r.body).includes("console:"), "no database text");
});

Deno.test("checks made before the database is asked: amounts are whole paise, ids are ids, dates are dates", async () => {
  const s = stand();
  for (const [action, p] of [
    ["credit.topup", { firm_id: B_FIRM, amount_paise: 500.5, pay_mode: "upi", pay_ref: "UTR-1" }],
    ["credit.topup", { firm_id: B_FIRM, amount_paise: 0, pay_mode: "upi", pay_ref: "UTR-1" }],
    ["credit.topup", { firm_id: "not-a-firm", amount_paise: 100, pay_mode: "upi", pay_ref: "UTR-1" }],
    ["credit.adjust", { firm_id: B_FIRM, amount_paise: 0, category: "goodwill", key: "adjkey0001" }],
    ["credit.adjust", { firm_id: B_FIRM, amount_paise: 100, category: "goodwill", key: "x" }],
    ["credit.refund", { entry_id: "2", key: "dialogkey01" }],
    ["price.set", { item: "bills", price_paise: 300, effective_from: "tomorrow" }],
    ["sub.set_status", { firm_id: B_FIRM, status: "gone" }],
    ["sub.set_status", { firm_id: B_FIRM, status: "trial" }],
    ["plan.save", { plan: [1, 2] }],
    ["billing.run", { mode: "everything" }],
  ] as [string, Record<string, unknown>][]) {
    const n = s.calls.filter((c) => c !== "console_audit_add").length;
    const r = await s.call("owner", action, { ...p, reason: R });
    eq(r.status, 400, action + " " + JSON.stringify(p));
    eq(s.calls.filter((c) => c !== "console_audit_add").length, n, action + ": the database was not asked");
  }
});

Deno.test("top-up: the same reference twice is one line; a refund dialog pressed twice is one refund; never more than the charge", async () => {
  const s = stand();
  const t = { firm_id: B_FIRM2, amount_paise: 500000, pay_mode: "bank", pay_ref: "NEFT-77", received_on: TODAY, reason: R };
  const a = await s.call("billing", "credit.topup", t);
  const b = await s.call("billing", "credit.topup", t);
  eq([a.status, a.body.data.duplicate, b.status, b.body.data.duplicate, b.body.data.entry_id === a.body.data.entry_id], [200, false, 200, true, true]);
  eq(s.audit.filter((x) => x.action === "credit.topup").length, 1, "audited once");
  eq(s.firms[1].balance, 6008, "₹1,008 (the seed: ₹8 more than its ledger) + ₹5,000");
  const x = await s.call("billing", "credit.topup", { ...t, amount_paise: 100 });
  eq([x.status, x.body.reason], [409, "ref_reused"]);
  // entry 2 is ABC's ₹5 bills charge (the fake's seed)
  const r1 = await s.call("owner", "credit.refund", { entry_id: 2, amount_paise: 300, key: "dialogkey01", reason: R });
  const r2 = await s.call("owner", "credit.refund", { entry_id: 2, amount_paise: 300, key: "dialogkey01", reason: R });
  eq([r1.status, r2.body.data.duplicate], [200, true]);
  const r3 = await s.call("owner", "credit.refund", { entry_id: 2, amount_paise: 300, key: "dialogkey02", reason: R });
  eq([r3.status, r3.body.reason], [409, "over_refund"]);
  const r4 = await s.call("owner", "credit.refund", { entry_id: 2, key: "dialogkey03", reason: R });
  eq(r4.status, 200, "the rest (₹2) refunded");
  const r5 = await s.call("owner", "credit.refund", { entry_id: 1, key: "dialogkey04", reason: R });
  eq(r5.body.reason, "not_a_charge");
});

Deno.test("ledgers: every firm (filters, export audited), one firm, Support only one firm, Viewer's admin emails hidden", async () => {
  const s = stand();
  await s.call("owner", "credit.adjust", { firm_id: B_FIRM, amount_paise: 2500, category: "goodwill", key: "adjkey0001", reason: R });
  let r = await s.call("owner", "ledger.list", { filters: { kind: { op: "in", values: ["charge"] } } });
  eq([r.status, r.body.data.total, r.body.data.rows.every((x: any) => x.kind === "charge")], [200, 6, true]);
  r = await s.call("owner", "ledger.list", { filters: { amount: { op: "range", from: 20, to: 30 }, firm: { op: "contains", value: "abc" } } });
  eq(r.body.data.rows.map((x: any) => [x.kind, x.amount]), [["adjust", 25]]);
  r = await s.call("owner", "ledger.list", { q: "UTR1" });
  eq(r.body.data.rows.map((x: any) => x.firm), ["ZZ TEST"]);
  r = await s.call("billing", "ledger.list", { export: "csv", filters: { kind: { op: "in", values: ["topup"] } } });
  assert(r.body.data.csv.startsWith("id,at,firm,kind,code,amount") && r.body.data.csv.split("\r\n").length === 5, r.body.data.csv);
  assert(s.audit.some((x) => x.action === "ledger.list.export"), "export audited");
  r = await s.call("support", "ledger.list");
  eq([r.status, r.body.reason], [403, "role"]);
  r = await s.call("support", "firm.ledger", { firm_id: B_FIRM2 });
  eq([r.status, r.body.data.rows.every((x: any) => x.firm === "ZZ TEST"), r.body.data.total], [200, true, 3]);
  r = await s.call("viewer", "ledger.list", { filters: { kind: { op: "in", values: ["adjust"] } } });
  eq(r.body.data.rows[0].by_email, "ad***@fincom.live");
  r = await s.call("viewer", "credit.adjust", { firm_id: B_FIRM, amount_paise: 2500, category: "goodwill", key: "adjkey0002", reason: R });
  eq(r.status, 403);
});

Deno.test("balance = ledger: the mismatch found, the adjusting entry fixes it without moving the balance, again refused", async () => {
  const s = stand();
  let r = await s.call("viewer", "ledger.check", { filters: { ok: { op: "is", value: false } } });
  eq(r.body.data.rows.map((x: any) => [x.firm, x.diff]), [["ZZ TEST", 8]]);
  const before = s.firms[1].balance;
  r = await s.call("billing", "ledger.fix", { firm_id: B_FIRM2, reason: R });
  eq([r.status, r.body.reason], [403, "role"]);
  r = await s.call("owner", "ledger.fix", { firm_id: B_FIRM2, reason: R });
  eq([r.status, r.body.data.kind, r.body.data.amount, s.firms[1].balance], [200, "adjust", 8, before]);
  r = await s.call("owner", "ledger.check", { filters: { ok: { op: "is", value: false } } });
  eq(r.body.data.total, 0);
  r = await s.call("owner", "ledger.fix", { firm_id: B_FIRM2, reason: R });
  eq([r.status, r.body.reason], [409, "nothing_to_fix"]);
});

Deno.test("clean-up: listed, never done by itself; the owner's press marks the test firm and sets ₹10,000; again refused", async () => {
  const s = stand();
  let r = await s.call("owner", "cleanup.list");
  eq(r.body.data.rows.map((x: any) => [x.firm, x.issue]).sort(), [["ABC Associates", "large_credit"], ["ZZ TEST", "mismatch"]]);
  eq(s.firms[0].balance, 499999610, "nothing changed by listing");
  r = await s.call("owner", "cleanup.test_credit", { firm_id: B_FIRM, reason: "₹50 Cr test credit of 27-Sep-2026 reversed" });
  eq([r.status, s.firms[0].balance, (s.firms[0] as any).is_test], [200, 10000, true]);
  const a = s.audit.find((x) => x.action === "cleanup.test_credit");
  eq([a.who, a.before.balance, a.after.balance], [ID.owner, 499999610, 10000]);
  r = await s.call("owner", "cleanup.test_credit", { firm_id: B_FIRM, reason: "again" + "!!" });
  eq([r.status, r.body.reason], [409, "nothing_to_fix"]);
  r = await s.call("billing", "cleanup.test_credit", { firm_id: B_FIRM, reason: R });
  eq(r.status, 403);
});

Deno.test("the monthly run: Run now twice charges once; the report lists every firm; Support cannot run it", async () => {
  const s = stand();
  let r = await s.call("billing", "billing.run", { reason: R });
  eq(r.status, 200);
  r = await s.call("owner", "billing.run", { reason: R });
  eq([r.status, r.body.data.counts.already, r.body.data.counts.short], [200, 2, 1], "done ones skipped; the short one tried again");
  r = await s.call("viewer", "billing.runs");
  eq(r.body.data.total, 3);
  r = await s.call("owner", "ledger.list", { filters: { kind: { op: "in", values: ["fee"] } } });
  eq(r.body.data.total, 1, "the per-client firm's fee, once");
  r = await s.call("support", "billing.run", { reason: R });
  eq(r.status, 403);
  eq(s.audit.filter((x) => x.action === "billing.run").length, 2);
});

Deno.test("settings: Billing reads, only the Owner saves; bad values refused; defaults are ₹10,000 / ₹500 / 7 / 30", async () => {
  const s = stand();
  let r = await s.call("billing", "settings.billing.get");
  eq(r.body.data, { start_credit: 1000000, low_credit_warn: 50000, grace_days: 7, paused_after_days: 30, trial_days: 0 });
  r = await s.call("billing", "settings.billing.set", { value: { grace_days: 3 }, reason: R });
  eq(r.status, 403);
  for (const v of [{ grace_days: 99 }, { start_credit: 1.5 }, { nope: 1 }, { paused_after_days: 7 }]) {
    r = await s.call("owner", "settings.billing.set", { value: v, reason: R });
    eq([r.status, r.body.reason], [400, "bad_setting"], JSON.stringify(v));
  }
  r = await s.call("owner", "settings.billing.set", { value: { start_credit: 20000, grace_days: 10 }, reason: R });
  eq([r.status, r.body.data.start_credit, r.body.data.grace_days, r.body.data.low_credit_warn], [200, 20000, 10, 50000]);
});
