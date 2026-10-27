// tests/console_billing_fake.ts: an in-memory stand-in for migration 119's console functions, for the Deno tests
// (server/console/billing_test.ts, handler_test.ts) and the screen tests' stand (tests/console_stand.ts). It keeps the
// rules the console relies on: the role re-check, one audit row per change, idempotent posts on (kind, ref), the
// ₹10 lakh top-up ceiling, Billing's ₹10,000 refund / adjust limit, never refunding more than a charge, the run once
// per firm per month. The real SQL is tested on PostgreSQL by tests/run_migration119.py.
export type FakeFirm = { id: string; name: string; balance: number; plan_id?: string | null; is_test?: boolean };
type Hooks = { roleOf(by: string): string; audit(a: any, action: string, tt: string, tid: string, before: unknown, after: unknown): void };

export function billingFake(firms: FakeFirm[], h: Hooks) {
  const err = (code: string): never => { throw new Error("console: " + code); };
  const need = (by: string, roles: string[]) => { const r = h.roleOf(by); if (!roles.includes(r)) err("not_allowed"); return r; };
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const month = today.slice(0, 8) + "01";
  const P = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
  const plans: any[] = [
    { id: P(1), name: "Pay as you go", code: "payg", note: "", active: true, on_website: true, sort: 1, monthly_fee_paise: 0, yearly_fee_paise: null, per_client_fee_paise: null,
      included_clients: null, included_users: null, features: ["Bills at ₹2"], ai_allowance_paise: null, includes: {}, updated_at: null },
    { id: P(2), name: "Per client", code: "per-client", note: "", active: true, on_website: true, sort: 2, monthly_fee_paise: 0, yearly_fee_paise: null, per_client_fee_paise: 5000,
      included_clients: 0, included_users: null, features: ["Everything for each client"], ai_allowance_paise: 100000, includes: { bills: { cap: null }, cloud: { cap: null } }, updated_at: null },
    { id: P(3), name: "Monthly, all included", code: "all", note: "", active: true, on_website: true, sort: 3, monthly_fee_paise: 400000, yearly_fee_paise: 4000000, per_client_fee_paise: null,
      included_clients: null, included_users: null, features: ["Everything unlimited"], ai_allowance_paise: -1, includes: { bills: { cap: null }, bank: { cap: null }, cloud: { cap: null } }, updated_at: null },
  ];
  const items: any[] = [
    ["bills", "Purchase bills", "per bill read and booked", "usage", 200], ["bank", "Bank statements", "per statement line", "usage", 25],
    ["claude", "Reading by Claude", "per bill Claude reads", "ai", 300], ["cloud", "Shared data", "per person per month", "monthly", 10000],
    ["bill_read_haiku", "Bill reading by Claude Haiku", "per bill read", "ai", null], ["voice_minute", "Voice typing and captions", "per minute", "ai", null],
    ["otp", "OTP / SMS", "per message", "usage", null], ["einvoice", "E-invoice (IRN)", "per invoice", "usage", null], ["ewaybill", "E-way bill", "per bill", "usage", null],
  ].map(([code, title, unit, kind, price], i) => ({ code, title, unit, kind, sort: i, active: true, module_code: price === null ? null : code }));
  const prices: any[] = items.filter((i, n) => [200, 25, 300, 10000][n] !== undefined && i.module_code)
    .map((i, n) => ({ id: n + 1, item_code: i.code, price_paise: [200, 25, 300, 10000][n], effective_from: "2026-01-01", reason: "before the console", set_by: null, set_at: "2026-01-01T00:00:00Z" }));
  const subs = new Map<string, any>(firms.map((f, i) => [f.id, { firm_id: f.id, plan_id: f.plan_id ?? plans[i % 3].id, status: i === 1 ? "past_due" : "active",
    billing_cycle: "monthly", period_start: month, renews_on: null, trial_ends_on: null, grace_until: i === 1 ? today : null }]));
  const ledger: any[] = [];
  const runs: any[] = [];
  let settings: Record<string, number> = { start_credit: 1000000, low_credit_warn: 50000, grace_days: 7, paused_after_days: 30, trial_days: 0 };
  const firm = (id: string) => firms.find((f) => f.id === id) || err("no_firm");
  const post = (firmId: string, paise: number, kind: string, ref: string, reason: string | null, by: string | null, meta: any = {}) => {
    const f = firm(firmId);
    const k = kind + ":" + ref, old = ledger.find((e) => e.idem_key === k);
    if (old) { if (old.firm_id !== firmId || Math.round(old.amount * 100) !== paise) err("ref_reused"); return { entry_id: old.id, balance: f.balance, amount_paise: paise, duplicate: true }; }
    if (paise < 0 && f.balance + paise / 100 < 0) err("below_zero");
    f.balance = Math.round((f.balance + paise / 100) * 100) / 100;
    const e = { id: ledger.length + 1, at: new Date().toISOString(), firm_id: firmId, kind, code: meta.code || "wallet", qty: 1, amount: paise / 100, balance_after: f.balance,
                note: meta.note || reason || "", ref: meta.ref ?? ref, reason, category: meta.category || null, pay_mode: meta.pay_mode || null, pay_ref: meta.pay_ref || null,
                received_on: meta.received_on || null, by_user: by, reverses_id: meta.reverses_id || null, idem_key: k };
    ledger.push(e);
    return { entry_id: e.id, balance: f.balance, amount_paise: paise, duplicate: false };
  };
  // a little history: a top-up and two charges per firm (the second firm's balance has no line for ₹8: a mismatch)
  firms.forEach((f, i) => {
    const b = f.balance; f.balance = 0;
    post(f.id, Math.round((b + 10) * 100), "topup", "seed-" + i, "opening", null, { note: "Top-up (bank UTR" + i + ")", pay_mode: "bank", pay_ref: "UTR" + i });
    post(f.id, -500, "charge", "seed-c-" + i, null, null, { code: "bills", note: "bills", ref: "stmt-" + i });
    post(f.id, -500, "charge", "seed-d-" + i, null, null, { code: "bank", note: "statement", ref: "stmt-" + i });
    if (i === 1) f.balance += 8;
  });
  const emailOf = (_: string | null) => "";
  const planJson = (p: any) => ({ ...p, firms: [...subs.values()].filter((s) => s.plan_id === p.id).length });
  const jint = (o: any, k: string, lo: number, hi: number, code = "bad_value") => {
    const v = o[k]; if (v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) err(code);
    return v;
  };
  const priceAt = (code: string, on = today) => prices.filter((p) => p.item_code === code && p.effective_from <= on).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]?.price_paise ?? null;
  const check = () => firms.map((f) => {
    const mine = ledger.filter((e) => e.firm_id === f.id), sum = Math.round(mine.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    return { firm_id: f.id, firm: f.name, is_test: !!f.is_test, balance: f.balance, ledger_sum: sum, diff: Math.round((f.balance - sum) * 100) / 100, entries: mine.length,
             chain_breaks: 0, last_entry_at: mine.at(-1)?.at || null, ok: Math.abs(f.balance - sum) < 0.005 };
  });
  const fee = (id: string) => {
    const s = subs.get(id), p = plans.find((x) => x.id === s?.plan_id);
    const parts = p && p.monthly_fee_paise ? [{ what: "plan", title: p.name, qty: 1, price_paise: p.monthly_fee_paise, amount_paise: p.monthly_fee_paise }] : [];
    if (p?.per_client_fee_paise) parts.push({ what: "clients", title: "Clients", qty: 3, price_paise: p.per_client_fee_paise, amount_paise: 3 * p.per_client_fee_paise });
    return { total_paise: parts.reduce((t, x) => t + x.amount_paise, 0), parts, cycle: s?.billing_cycle || "monthly" };
  };
  const run = (firmId: string | null, by: string | null, mode: string, reason: string | null = null) => {
    const role = by ? need(by, ["owner", "billing"]) : "system";
    if (!["month", "retry"].includes(mode)) err("bad_mode");
    const rows: any[] = [], counts: Record<string, number> = {};
    for (const s of subs.values()) {
      if (firmId && s.firm_id !== firmId) continue;
      const done = runs.find((r) => r.firm_id === s.firm_id && r.month === month);
      if (done && done.outcome !== "short") { counts.already = (counts.already || 0) + 1; continue; }
      if (!done && mode === "retry") continue;
      const f = firm(s.firm_id), amt = fee(s.firm_id).total_paise;
      let outcome = "free", entry = null;
      if (amt > 0 && Math.round(f.balance * 100) >= amt) { entry = post(f.id, -amt, "fee", f.id + ":" + month.slice(0, 7), null, by, { code: "plan", note: "Monthly charge", ref: month.slice(0, 7) }).entry_id; outcome = "charged"; }
      else if (amt > 0) outcome = "short";
      if (outcome === "short") { if (s.status === "active") Object.assign(s, { status: "past_due", grace_until: today }); }
      else Object.assign(s, { status: "active", grace_until: null });
      s.period_start = month;
      if (done) Object.assign(done, { outcome, fee_paise: amt, tries: done.tries + 1, run_at: new Date().toISOString(), run_by: by, wallet_entry_id: entry });
      else runs.push({ firm_id: s.firm_id, month, outcome, fee_paise: amt, tries: 1, run_at: new Date().toISOString(), run_by: by, wallet_entry_id: entry });
      counts[outcome] = (counts[outcome] || 0) + 1;
      rows.push({ firm_id: f.id, firm: f.name, outcome, fee_paise: amt, status: s.status });
    }
    h.audit({ p_by: by, p_reason: reason }, "billing.run", firmId ? "firm" : "", firmId || "", null, { month, mode, counts });
    void role;
    return { month, mode, counts, rows };
  };

  return async function rpc(fn: string, a: any): Promise<any> {
    // console_ledger(p_from, p_to, p_limit) is the exports' overload (migration 122, console_ops_fake.ts), not this one
    if (fn === "console_ledger" && "p_from" in (a || {})) return undefined;
    switch (fn) {
      case "console_plans": return plans.map(planJson);
      case "console_plan_save": {
        const role = need(a.p_by, ["owner", "billing"]), x = a.p_plan || {};
        const old = x.id ? plans.find((p) => p.id === x.id) || err("no_plan") : null;
        const name = String(x.name ?? old?.name ?? "").trim();
        if (name.length < 2 || name.length > 80) err("bad_plan_name");
        if (plans.some((p) => p.name.toLowerCase() === name.toLowerCase() && p !== old)) err("plan_exists");
        if (x.includes) for (const [k, v] of Object.entries<any>(x.includes)) if (k === "clients" || (k === "cloud" && v?.cap != null) || !items.some((i) => i.code === k)) err("bad_item");
        const nums: Record<string, [number, number]> = { monthly_fee_paise: [0, 1e8], yearly_fee_paise: [0, 1e9], per_client_fee_paise: [0, 1e7], included_clients: [0, 1e5], included_users: [0, 1e5], ai_allowance_paise: [-1, 1e8], sort: [-1000, 1000] };
        for (const [k, [lo, hi]] of Object.entries(nums)) if (k in x) jint(x, k, lo, hi);
        const before = old ? planJson(old) : null;
        const p = old || { id: crypto.randomUUID(), monthly_fee_paise: 0, yearly_fee_paise: null, per_client_fee_paise: null, included_clients: null, included_users: null,
                           features: [], ai_allowance_paise: null, includes: {}, active: true, on_website: false, sort: 0, note: "", code: null };
        Object.assign(p, Object.fromEntries(Object.entries(x).filter(([k]) => k !== "id")), { name, updated_at: new Date().toISOString() });
        if (!old) plans.push(p);
        h.audit({ ...a, p_by: a.p_by }, "plan.save", "plan", p.id, before, planJson(p)); void role;
        return planJson(p);
      }
      case "console_prices": return items.map((i) => {
        const fut = prices.filter((p) => p.item_code === i.code && p.effective_from > today).sort((x, y) => x.effective_from.localeCompare(y.effective_from))[0];
        return { ...i, price_paise: priceAt(i.code), since: prices.filter((p) => p.item_code === i.code && p.effective_from <= today).map((p) => p.effective_from).sort().at(-1) || null,
                 next_price_paise: fut?.price_paise ?? null, next_from: fut?.effective_from ?? null, versions: prices.filter((p) => p.item_code === i.code).length, firm_prices: 0 };
      });
      case "console_price_history": return prices.filter((p) => p.item_code === a.p_item).map((p) => ({ ...p, set_by: emailOf(p.set_by) })).reverse();
      case "console_price_set": {
        need(a.p_by, ["owner", "billing"]);
        if (!items.some((i) => i.code === a.p_item)) err("no_item");
        if (a.p_from < today) err("backdated");
        const before = priceAt(a.p_item, a.p_from), ex = prices.find((p) => p.item_code === a.p_item && p.effective_from === a.p_from);
        if (ex) Object.assign(ex, { price_paise: a.p_price_paise, reason: a.p_reason, set_by: a.p_by });
        else prices.push({ id: prices.length + 1, item_code: a.p_item, price_paise: a.p_price_paise, effective_from: a.p_from, reason: a.p_reason, set_by: a.p_by, set_at: new Date().toISOString() });
        h.audit(a, "price.set", "price", a.p_item, { price_paise: before }, { price_paise: a.p_price_paise, effective_from: a.p_from });
        return { item: a.p_item, price_paise: a.p_price_paise, effective_from: a.p_from, before_paise: before };
      }
      case "console_subscriptions": return [...subs.values()].map((s) => {
        const f = firm(s.firm_id), p = plans.find((x) => x.id === s.plan_id);
        return { ...s, firm: f.name, is_test: !!f.is_test, firm_status: "active", plan: p?.name || "No plan", balance: f.balance, low_balance_warn: 500, low: f.balance <= 500,
                 used: 10, clients: 3, users: 2, ai_used: 12.5, ai_allowance: p?.ai_allowance_paise ? p.ai_allowance_paise / 100 : null, this_month: runs.find((r) => r.firm_id === s.firm_id && r.month === month)?.outcome || null };
      });
      case "console_subscription": {
        const s = subs.get(a.p_firm); if (!s) return null;
        const f = firm(a.p_firm), p = plans.find((x) => x.id === s.plan_id);
        return { firm_id: f.id, firm: f.name, is_test: !!f.is_test, firm_status: "active", balance: f.balance, low_balance_warn: 500, subscription: s, plan: p ? planJson(p) : null,
                 fee: fee(f.id), items: [{ code: "bills", title: "Purchase bills", unit: "per bill", qty: 40, spent: 80, in_plan: !!p?.includes?.bills, cap: null, price: 2 },
                                         { code: "bank", title: "Bank statements", unit: "per line", qty: 300, spent: 75, in_plan: false, cap: null, price: 0.25 }],
                 clients: { count: 3, included: p?.included_clients ?? null }, users: { count: 2, included: p?.included_users ?? null },
                 ai: { used_paise: 1250, allowance_paise: p?.ai_allowance_paise ?? null }, runs: runs.filter((r) => r.firm_id === f.id) };
      }
      case "console_sub_change_plan": {
        need(a.p_by, ["owner", "billing"]);
        const s = subs.get(a.p_firm) || err("no_firm"), p = plans.find((x) => x.id === a.p_plan) || err("no_plan");
        if (!p.active) err("plan_retired");
        const cycle = a.p_cycle || s.billing_cycle;
        if (s.plan_id === a.p_plan && s.billing_cycle === cycle) err("same_status");
        const before = { plan_id: s.plan_id, cycle: s.billing_cycle };
        Object.assign(s, { plan_id: a.p_plan, billing_cycle: cycle });
        h.audit(a, "sub.change_plan", "firm", a.p_firm, before, { plan_id: a.p_plan, plan: p.name, cycle });
        return { firm_id: a.p_firm, plan_id: a.p_plan, plan: p.name, billing_cycle: cycle };
      }
      case "console_sub_set_status": {
        need(a.p_by, ["owner", "billing"]);
        const s = subs.get(a.p_firm) || err("no_firm");
        if (s.status === a.p_status && a.p_status !== "trial") err("same_status");
        if (a.p_status === "trial" && (!a.p_trial_ends_on || a.p_trial_ends_on <= today)) err("bad_date");
        const before = { status: s.status };
        Object.assign(s, { status: a.p_status, trial_ends_on: a.p_status === "trial" ? a.p_trial_ends_on : s.trial_ends_on });
        h.audit(a, "sub.set_status", "firm", a.p_firm, before, { status: a.p_status });
        return { firm_id: a.p_firm, status: a.p_status };
      }
      case "console_ledger": return ledger.filter((e) => !a.p_firm || e.firm_id === a.p_firm).map((e) => {
        const f = firm(e.firm_id);
        return { ...e, firm: f.name, is_test: !!f.is_test, amount_paise: Math.round(e.amount * 100), by_email: e.by_user ? "admin@fincom.live" : null,
                 refunded: ["charge", "fee"].includes(e.kind) ? ledger.filter((r) => r.reverses_id === e.id).reduce((t, r) => t + r.amount, 0) : null };
      }).reverse();
      case "console_credit_topup": {
        const role = need(a.p_by, ["owner", "billing"]);
        if (a.p_amount_paise > 100000000) err("too_large");
        if (!["bank", "upi", "cheque", "cash", "gateway", "other"].includes(a.p_pay_mode)) err("bad_pay_mode");
        if (String(a.p_pay_ref).trim().length < 3) err("bad_pay_ref");
        const r = post(a.p_firm, a.p_amount_paise, "topup", a.p_firm + ":" + String(a.p_pay_ref).trim().toLowerCase(), a.p_reason, a.p_by,
                       { note: `Top-up (${a.p_pay_mode} ${a.p_pay_ref})`, pay_mode: a.p_pay_mode, pay_ref: a.p_pay_ref, received_on: a.p_received_on, ref: a.p_pay_ref });
        if (!r.duplicate) { h.audit(a, "credit.topup", "firm", a.p_firm, null, { amount_paise: a.p_amount_paise, entry_id: r.entry_id }); void role; }
        return r;
      }
      case "console_credit_refund": {
        need(a.p_by, ["owner", "billing"]);
        const e = ledger.find((x) => x.id === a.p_entry) || err("no_entry");
        if (!["charge", "fee"].includes(e.kind)) err("not_a_charge");
        const k = "refund:" + a.p_entry + ":" + a.p_key, done = ledger.find((x) => x.idem_key === k);
        if (done) return { entry_id: done.id, balance: firm(e.firm_id).balance, duplicate: true };
        const left = Math.round(-e.amount * 100) - Math.round(ledger.filter((r) => r.reverses_id === e.id).reduce((t, r) => t + r.amount, 0) * 100);
        const amt = a.p_amount_paise ?? left;
        if (amt <= 0) err("bad_amount");
        if (amt > left) err("over_refund");
        if (h.roleOf(a.p_by) === "billing" && amt > 1000000) err("owner_needed");
        const r = post(e.firm_id, amt, "refund", a.p_entry + ":" + a.p_key, a.p_reason, a.p_by, { code: e.code, note: "Refund of entry #" + e.id, reverses_id: e.id, category: "refund", ref: e.ref });
        h.audit(a, "credit.refund", "firm", e.firm_id, { entry_id: e.id, left_paise: left }, { amount_paise: amt, refund_entry_id: r.entry_id });
        return r;
      }
      case "console_credit_adjust": {
        need(a.p_by, ["owner", "billing"]);
        if (!["goodwill", "correction", "test_cleanup", "other"].includes(a.p_category)) err("bad_category");
        if (h.roleOf(a.p_by) === "billing" && Math.abs(a.p_amount_paise) > 1000000) err("owner_needed");
        const r = post(a.p_firm, a.p_amount_paise, "adjust", a.p_firm + ":" + a.p_key, a.p_reason, a.p_by, { note: "Adjustment (" + a.p_category + ")", category: a.p_category, ref: "" });
        if (!r.duplicate) h.audit(a, "credit.adjust", "firm", a.p_firm, null, { amount_paise: a.p_amount_paise, entry_id: r.entry_id });
        return r;
      }
      case "console_ledger_check": return check();
      case "console_ledger_fix": {
        need(a.p_by, ["owner"]);
        const c = check().find((x) => x.firm_id === a.p_firm) || err("no_firm");
        if (c.ok) err("nothing_to_fix");
        const f = firm(a.p_firm), kind = c.entries ? "adjust" : "opening";
        ledger.push({ id: ledger.length + 1, at: new Date().toISOString(), firm_id: f.id, kind, code: "wallet", qty: 1, amount: c.diff, balance_after: f.balance, note: "Adjusting entry",
                      ref: "reconcile", reason: a.p_reason, category: "reconcile", by_user: a.p_by, reverses_id: null, idem_key: "reconcile:" + f.id + ":" + c.entries });
        h.audit(a, "ledger.fix", "firm", f.id, { balance: f.balance, ledger_sum: c.ledger_sum }, { kind, amount: c.diff });
        return { entry_id: ledger.length, kind, amount: c.diff, balance: f.balance };
      }
      case "console_cleanup_list": return check().flatMap((c) => [
        ...(c.balance >= 1000000 && !c.is_test ? [{ ...c, issue: "large_credit", action: "cleanup.test_credit" }] : []),
        ...(!c.ok ? [{ ...c, issue: c.entries ? "mismatch" : "no_ledger", action: "ledger.fix" }] : []),
      ]);
      case "console_cleanup_test_credit": {
        need(a.p_by, ["owner"]);
        const f = firm(a.p_firm), delta = a.p_target_paise - Math.round(f.balance * 100);
        if (f.is_test && delta === 0) err("nothing_to_fix");
        const before = { balance: f.balance, is_test: !!f.is_test };
        f.is_test = true;
        if (delta) post(f.id, delta, "adjust", "cleanup:test_credit:" + f.id + ":" + a.p_target_paise, a.p_reason, a.p_by, { category: "test_cleanup", note: "Test credit brought down" });
        h.audit(a, "cleanup.test_credit", "firm", f.id, before, { balance: f.balance, is_test: true, adjust_paise: delta });
        return { firm_id: f.id, is_test: true, balance: f.balance, adjust_paise: delta };
      }
      case "console_billing_run": return run(a.p_firm, a.p_by, a.p_mode, a.p_reason ?? null);
      case "console_billing_runs": return runs.filter((r) => !a.p_month || r.month === a.p_month.slice(0, 8) + "01").map((r) => {
        const f = firm(r.firm_id);
        return { ...r, firm: f.name, is_test: !!f.is_test, fee: r.fee_paise / 100, run_by: r.run_by ? "admin@fincom.live" : "scheduled", status: subs.get(r.firm_id)?.status, balance: f.balance };
      });
      case "console_billing_settings": return { ...settings };
      case "console_billing_settings_set": {
        need(a.p_by, ["owner"]);
        const allowed: Record<string, [number, number]> = { start_credit: [0, 1e8], low_credit_warn: [0, 1e7], grace_days: [0, 90], paused_after_days: [1, 365], trial_days: [0, 90] };
        const v = a.p_value || {};
        if (!Object.keys(v).length) err("bad_setting");
        for (const k of Object.keys(v)) { if (!allowed[k]) err("bad_setting"); jint(v, k, allowed[k][0], allowed[k][1], "bad_setting"); }
        const next = { ...settings, ...v };
        if (next.paused_after_days <= next.grace_days) err("bad_setting");
        const before = settings; settings = next;
        h.audit(a, "settings.billing.set", "settings", "billing", before, next);
        return { ...settings };
      }
    }
    return undefined;
  };
}
