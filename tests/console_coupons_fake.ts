// An in-memory stand-in for migration 120's console_coupon* functions, keeping their rules (roles, codes unique and
// in capitals, a used coupon keeps its code and kind, an ended one is final, one audit row per change). Used by
// server/console/handler_test.ts and server/console/coupons_test.ts (Deno) and tests/console_stand.ts (the screens).
// The SQL itself is tested on PostgreSQL by tests/run_migration120.py.
type Audit = (a: any, action: string, tt: string, tid: string, before: unknown, after: unknown) => void;
export type CouponFakeOpts = { roleOf: (by: string) => string; audit: Audit; emailOf?: (id: string | null) => string; seed?: boolean };

export const COUPON_IDS = { welcome: "c0000000-0000-4000-8000-000000000001", icai: "c0000000-0000-4000-8000-000000000002", ended: "c0000000-0000-4000-8000-000000000003",
                            paused: "c0000000-0000-4000-8000-000000000004" };
export const PLAN_IDS = { payg: "00000000-0000-4000-8000-000000000201", monthly: "00000000-0000-4000-8000-000000000202" };
const PLANS = [{ id: PLAN_IDS.monthly, name: "Monthly, all included" }, { id: PLAN_IDS.payg, name: "Pay as you go" }];
const inr = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const mo = (n: number) => n + (n === 1 ? " month" : " months");
export function terms(kind: string, value: number, months: number | null, maxOff: number | null) {
  if (kind === "percent") return `${value}% off the plan fee for ${mo(months!)}` + (maxOff ? ` (up to ${inr(maxOff)} a month)` : "");
  if (kind === "flat") return `${inr(value)} off the plan fee for ${mo(months!)}`;
  if (kind === "credit") return `${inr(value)} of free credit`;
  if (kind === "free_months") return `${value} free ${value === 1 ? "month" : "months"} of the plan fee`;
  return `${value} more ${value === 1 ? "day" : "days"} of trial`;
}
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

export function couponsFake(o: CouponFakeOpts) {
  const err = (code: string) => { throw new Error("console: " + code); };
  const need = (by: string) => { const r = o.roleOf(by); if (!["owner", "billing"].includes(r)) err("not_allowed"); return r; };
  const email = o.emailOf || (() => "");
  const coupons: any[] = [];
  const redemptions: any[] = [];
  const months: any[] = [];
  let n = 100;
  const base = { months: null, max_off_paise: null, valid_from: null, valid_to: null, plan_ids: null, max_uses: null, uses: 0, once_per_firm: true,
                 new_firms_only: false, new_firm_days: 30, stackable: false, status: "active", campaign: null, note: null, created_by: null, updated_by: null, ended_at: null };
  if (o.seed !== false) {
    coupons.push({ ...base, id: COUPON_IDS.welcome, code: "WELCOME10", kind: "percent", value: 10, months: 3, max_off_paise: 50000, max_uses: 100, uses: 2, campaign: "Diwali", created_at: ago(20), updated_at: ago(20) });
    coupons.push({ ...base, id: COUPON_IDS.icai, code: "ICAI1000", kind: "credit", value: 100000, max_uses: 2, uses: 2, stackable: true, campaign: "ICAI seminar", created_at: ago(40), updated_at: ago(40) });
    coupons.push({ ...base, id: COUPON_IDS.paused, code: "FIRST2FREE", kind: "free_months", value: 2, status: "paused", new_firms_only: true, created_at: ago(15), updated_at: ago(2) });
    coupons.push({ ...base, id: COUPON_IDS.ended, code: "OLDTRIAL", kind: "trial_days", value: 15, status: "ended", ended_at: ago(5), created_at: ago(90), updated_at: ago(5) });
    const F1 = "00000000-0000-4000-8000-000000000101", F2 = "00000000-0000-4000-8000-000000000102";
    redemptions.push({ id: "r1", coupon_id: COUPON_IDS.welcome, firm_id: F1, firm: "ABC Associates", by_email: "asha@abc.test", source: "signup", at: ago(10), kind: "percent", value_paise: 50000, status: "active", months_left: 2 });
    redemptions.push({ id: "r2", coupon_id: COUPON_IDS.welcome, firm_id: F2, firm: "Garg Shekhar & Co", by_email: "bina@gsc.test", source: "settings", at: ago(3), kind: "percent", value_paise: 0, status: "active", months_left: 3 });
    redemptions.push({ id: "r3", coupon_id: COUPON_IDS.icai, firm_id: F1, firm: "ABC Associates", by_email: "asha@abc.test", source: "settings", at: ago(35), kind: "credit", value_paise: 100000, status: "finished", months_left: null });
    redemptions.push({ id: "r4", coupon_id: COUPON_IDS.icai, firm_id: F2, firm: "Garg Shekhar & Co", by_email: "bina@gsc.test", source: "signup", at: ago(1), kind: "credit", value_paise: 100000, status: "finished", months_left: null });
    months.push({ redemption: "r1", period: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 8) + "01", amount: 50000 });
  }
  const row = (c: any) => {
    const t = today();
    const rs = redemptions.filter((r) => r.coupon_id === c.id && r.status !== "reversed");
    const given = rs.reduce((s, r) => s + r.value_paise, 0);
    return {
      id: c.id, code: c.code, kind: c.kind, value: c.value, months: c.months, max_off_paise: c.max_off_paise, terms: terms(c.kind, c.value, c.months, c.max_off_paise),
      valid_from: c.valid_from, valid_to: c.valid_to, plan_ids: c.plan_ids,
      plans: c.plan_ids ? PLANS.filter((p) => c.plan_ids.includes(p.id)).map((p) => p.name).sort().join(", ") : "All plans",
      max_uses: c.max_uses, uses: c.uses, once_per_firm: c.once_per_firm, new_firms_only: c.new_firms_only, new_firm_days: c.new_firm_days, stackable: c.stackable,
      set_status: c.status,
      status: c.status !== "active" ? c.status : c.valid_to && c.valid_to < t ? "expired" : c.max_uses && c.uses >= c.max_uses ? "used_up" : c.valid_from && c.valid_from > t ? "scheduled" : "active",
      usage: c.uses === 0 ? "unused" : c.max_uses && c.uses >= c.max_uses ? "full" : "in_use",
      given_paise: given, given_inr: given / 100, firms: new Set(rs.map((r) => r.firm_id)).size,
      campaign: c.campaign, note: c.note, created_at: c.created_at, updated_at: c.updated_at, ended_at: c.ended_at,
      created_by_email: email(c.created_by), updated_by_email: email(c.updated_by),
    };
  };
  const rpc = (fn: string, a: any): any => {
    switch (fn) {
      case "console_coupons": return [...coupons].sort((x, y) => y.created_at.localeCompare(x.created_at)).map(row);
      case "console_coupon": { const c = coupons.find((x) => x.id === a.p_id); return c ? row(c) : null; }
      case "console_coupon_plans": return PLANS;
      case "console_coupon_redemptions":
        return redemptions.filter((r) => !a.p_coupon || r.coupon_id === a.p_coupon).map((r) => {
          const c = coupons.find((x) => x.id === r.coupon_id)!;
          return { ...r, code: c.code, terms: terms(c.kind, c.value, c.months, c.max_off_paise), value_inr: r.value_paise / 100 };
        });
      case "console_coupon_report": {
        const m = new Map<string, any>();
        const add = (cid: string, month: string, red: number, credit: number, disc: number) => {
          const c = coupons.find((x) => x.id === cid)!, k = cid + ":" + month;
          const r = m.get(k) || { id: k, coupon_id: cid, month, code: c.code, kind: c.kind, campaign: c.campaign, redemptions: 0, credit_paise: 0, discount_paise: 0 };
          r.redemptions += red; r.credit_paise += credit; r.discount_paise += disc; m.set(k, r);
        };
        for (const r of redemptions) add(r.coupon_id, new Date(Date.parse(r.at) + 5.5 * 3600000).toISOString().slice(0, 8) + "01", 1, r.kind === "credit" ? r.value_paise : 0, 0);
        for (const x of months) add(redemptions.find((r) => r.id === x.redemption)!.coupon_id, x.period, 0, 0, x.amount);
        return [...m.values()].map((r) => ({ ...r, total_paise: r.credit_paise + r.discount_paise, credit_inr: r.credit_paise / 100, discount_inr: r.discount_paise / 100,
                                             total_inr: (r.credit_paise + r.discount_paise) / 100 }));
      }
      case "console_coupon_save": {
        const role = need(a.p_by);
        const d = a.p_data || {};
        if (!/^[A-Z0-9]{4,20}$/.test(d.code || "")) err("coupon_code");
        if (!["percent", "flat", "credit", "free_months", "trial_days"].includes(d.kind)) err("coupon_kind");
        if (d.valid_from && d.valid_to && d.valid_from > d.valid_to) err("coupon_dates");
        const clash = coupons.find((x) => x.code === d.code && x.id !== a.p_id);
        if (clash) err("coupon_code_taken");
        if (!a.p_id) {
          const c = { ...base, ...d, id: `c0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, created_by: a.p_by, updated_by: a.p_by, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          coupons.push(c); o.audit(a, "coupon.create", "coupon", c.id, null, row(c)); return row(c);
        }
        const c = coupons.find((x) => x.id === a.p_id); if (!c) err("no_coupon");
        if (c.status === "ended") err("coupon_ended");
        if (c.uses > 0 && (d.code !== c.code || d.kind !== c.kind)) err("coupon_in_use");
        if (d.max_uses && d.max_uses < c.uses) err("coupon_max_below_uses");
        const before = row(c);
        Object.assign(c, d, { updated_by: a.p_by, updated_at: new Date().toISOString() });
        o.audit(a, "coupon.update", "coupon", c.id, before, row(c)); void role; return row(c);
      }
      case "console_coupon_set_status": {
        need(a.p_by);
        if (!["active", "paused", "ended"].includes(a.p_status)) err("bad_status");
        const c = coupons.find((x) => x.id === a.p_id); if (!c) err("no_coupon");
        if (c.status === a.p_status) err("same_status");
        if (c.status === "ended") err("coupon_ended");
        const before = { status: c.status, code: c.code };
        c.status = a.p_status; c.updated_by = a.p_by; c.updated_at = new Date().toISOString(); if (a.p_status === "ended") c.ended_at = c.updated_at;
        o.audit(a, a.p_status === "paused" ? "coupon.pause" : a.p_status === "ended" ? "coupon.end" : "coupon.resume", "coupon", c.id, before, { status: a.p_status, code: c.code });
        return row(c);
      }
    }
    return undefined;
  };
  return { rpc, coupons, redemptions };
}
