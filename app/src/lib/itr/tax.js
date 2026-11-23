// The Computation of Income, AY 2026-27: the first of the two computations (the second, written apart: check.js).
// Pure: compute(input) -> the sheet. Rupees, whole; every line carries where it comes from (src) and how (why).
// The input is the return model the page assembles (books.js for the books, the owner's answers, the imports); its
// shape is in docs/ITR-MODULE.md, "The return model". Nothing here reads the page, the books or the network.
import * as L from "./law.js";

const N = (v) => (typeof v === "number" && isFinite(v) ? v : +v || 0);
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const R10 = (v) => { const x = N(v); const r = Math.round(Math.abs(x) / 10 + 1e-9) * 10 * Math.sign(x); return r === 0 ? 0 : r; };
const D100 = (v) => Math.floor(Math.max(0, N(v)) / 100) * 100;
const pos = (v) => Math.max(0, N(v));
const sum = (a, f) => (a || []).reduce((s, x) => s + N(f ? f(x) : x), 0);
export const fmtDate = (ymd) => (ymd ? String(ymd).slice(6, 8) + "-" + String(ymd).slice(4, 6) + "-" + String(ymd).slice(0, 4) : "");

// ---------------- the slabs ----------------
export function slabTax(income, slabs) {
  let t = 0, lo = 0;
  for (const [hi, r] of slabs) { if (income > lo) t += (Math.min(income, hi) - lo) * r; lo = hi; }
  return R(t);
}
function slabsFor(inp) {
  if (inp.regime === "new") return L.SLABS.new;
  if (inp.entity === "P" && inp.resident !== false && N(inp.age) >= 80) return L.SLABS.oldSuper;
  if (inp.entity === "P" && inp.resident !== false && N(inp.age) >= 60) return L.SLABS.oldSenior;
  return L.SLABS.old;
}
const exemptOf = (slabs) => slabs[0][1] === 0 ? slabs[0][0] : 0;

// ---------------- presumptive (44AD, 44ADA, 44AE) ----------------
export function presumptive(p, entity, llp) {
  const out = { lines: [], income: 0, needs: [], receipts: 0, cash: 0 };
  if (!p) return out;
  const okEntity = (entity === "P" || entity === "H" || (entity === "F" && !llp));
  if (p.ad) {
    const dig = N(p.ad.digital), oth = N(p.ad.other), gross = dig + oth, min = R(dig * L.P44AD.digital + oth * L.P44AD.other);
    const lowCash = gross > 0 && oth / gross <= L.P44AD.cashShare, limit = lowCash ? L.P44AD.limitLowCash : L.P44AD.limit;
    const declared = p.ad.declared == null ? min : N(p.ad.declared);
    out.receipts += gross; out.cash += oth;
    if (!okEntity) out.needs.push({ key: "44ad_entity", text: "Section 44AD is for a resident individual, HUF or firm (not an LLP)." });
    if (gross > limit) out.needs.push({ key: "44ad_limit", text: "Turnover " + gross + " is above the 44AD limit of " + limit + (lowCash ? " (cash receipts not more than 5%)" : " (cash receipts above 5%)") + ": ITR-3/ITR-5 with books and a tax audit." });
    if (declared < min) out.needs.push({ key: "44ad_low", text: "Income declared under 44AD (" + declared + ") is below 6% / 8% of turnover (" + min + "): books and a tax audit are needed (44AD(5), 44AB(e))." });
    out.lines.push({ key: "p44ad", label: "Section 44AD: 6% of " + dig + " received digitally + 8% of " + oth + " other", amt: declared, min, gross, dig, oth, limit, src: L.P44AD.src });
    out.income += declared;
  }
  if (p.ada) {
    const rec = N(p.ada.receipts), cash = N(p.ada.cash), min = R(rec * L.P44ADA.rate);
    const lowCash = rec > 0 && cash / rec <= L.P44ADA.cashShare, limit = lowCash ? L.P44ADA.limitLowCash : L.P44ADA.limit;
    const declared = p.ada.declared == null ? min : N(p.ada.declared);
    out.receipts += rec; out.cash += cash;
    if (!(entity === "P" || (entity === "F" && !llp))) out.needs.push({ key: "44ada_entity", text: "Section 44ADA is for a resident individual or a firm other than an LLP (not an HUF: ITR-4 rule 212)." });
    if (rec > limit) out.needs.push({ key: "44ada_limit", text: "Gross receipts " + rec + " are above the 44ADA limit of " + limit + "." });
    if (declared < min) out.needs.push({ key: "44ada_low", text: "Income declared under 44ADA (" + declared + ") is below 50% of receipts (" + min + ")." });
    out.lines.push({ key: "p44ada", label: "Section 44ADA: 50% of gross receipts " + rec, amt: declared, min, gross: rec, cash, limit, src: L.P44ADA.src });
    out.income += declared;
  }
  if (p.ae && (p.ae.vehicles || []).length) {
    const vs = p.ae.vehicles;
    if (vs.length > L.P44AE.maxVehicles) out.needs.push({ key: "44ae_count", text: "More than ten goods carriages: 44AE does not apply." });
    let min = 0;
    vs.forEach((v) => { const m = Math.min(12, Math.max(0, Math.ceil(N(v.months)))); min += N(v.gvwKg) > L.P44AE.heavyKg ? Math.ceil(N(v.gvwKg) / 1000) * L.P44AE.perTonMonth * m : L.P44AE.perVehicleMonth * m; });
    const declared = p.ae.declared == null ? min : N(p.ae.declared);
    if (declared < min) out.needs.push({ key: "44ae_low", text: "Income declared under 44AE (" + declared + ") is below the presumptive " + min + "." });
    out.lines.push({ key: "p44ae", label: "Section 44AE: " + vs.length + " goods carriage" + (vs.length === 1 ? "" : "s"), amt: declared, min, src: L.P44AE.src });
    out.income += declared;
  }
  return out;
}

// ---------------- section 40(b) ----------------
// bookProfit: Explanation 3: the net profit as computed under Chapter IV-D, before the partners' remuneration
export function limit40b(bookProfit) {
  const bp = N(bookProfit);
  if (bp <= L.S40B.first) return R(Math.max(L.S40B.firstMin, L.S40B.firstRate * Math.max(0, bp)));
  return R(Math.max(L.S40B.firstMin, L.S40B.firstRate * L.S40B.first) + (bp - L.S40B.first) * L.S40B.restRate);
}
export function partners40b(partners, pgbpBeforeRem) {
  const ps = partners || [];
  const interestAdd = R(sum(ps, (p) => (N(p.rate) > L.S40B.interest * 100 && N(p.interest) > 0 ? N(p.interest) * (N(p.rate) - L.S40B.interest * 100) / N(p.rate) : 0)));
  const rem = R(sum(ps, (p) => (p.working === false ? 0 : p.remuneration)));
  const notWorking = R(sum(ps, (p) => (p.working === false ? p.remuneration : 0)));
  const bookProfit = R(N(pgbpBeforeRem) + interestAdd);
  const lim = limit40b(bookProfit);
  return { interestAdd, rem, notWorking, bookProfit, limit: lim, allowed: Math.min(rem, lim), remAdd: Math.max(0, rem - lim) + notWorking };
}

// ---------------- the special-rate income: where a reduction saves the most ----------------
// A loss of another head (71, 32(2)), a loss brought forward (74) or the unused basic exemption (provisos to 111A(1),
// 112(1), 112A(2)) set against the special-rate income takes it cheapest-for-the-taxpayer first: 111A (20%); the 112
// income still taxed (a property the proviso to 112(1)(a) covers up to its indexed gain, and the other 112 gains:
// tax112); 112A above its Rs 1.25 lakh exemption; then what saves nothing: the rest of 112, 112A's exempt part (the
// final review of b8126ecbc). h: the income by key; k: the keys of 111A, 112, 112A in h; pool: the 112 rows (heads.js);
// longOnly: a long-term loss (74(1)(b)): never against 111A. Returns what is left of amt; rec gets what each key took
// order "B": 112A above its exemption first, then the 112 income still taxed, then 111A: where 87A (old regime) rebates
// the tax on 111A and 112 but not on 112A, leaving 111A taxed can cost less. Order "C": 111A only down to keepA (the
// 111A income whose tax the rebate still absorbs), then 112, 112A above, then the rest of 111A. compute() tries them
export function takeSpecial(h, amt, k, pool, rec, longOnly, usefulOnly, order, keepA) {
  const gross = pool ? sum(pool, (x) => pos(x.gain)) : 0, useful = pool ? sum(pool, (x) => (x.elig ? Math.min(pos(x.idx), pos(x.gain)) : pos(x.gain))) : 0;
  const take = (key, cap) => { const u = Math.min(amt, Math.max(0, cap)); if (u <= 0) return; h[key] -= u; amt -= u; if (rec) rec[key] = (rec[key] || 0) + u; };
  const live112 = () => (pool ? Math.min(h[k.c], useful - (gross - h[k.c])) : h[k.c]);
  if (order === "B") { take(k.b, h[k.b] - L.SPECIAL.s112AExempt); take(k.c, live112()); if (!longOnly) take(k.a, h[k.a]); }
  else if (order === "C") { if (!longOnly) take(k.a, h[k.a] - N(keepA)); take(k.c, live112()); take(k.b, h[k.b] - L.SPECIAL.s112AExempt); if (!longOnly) take(k.a, h[k.a]); }
  else { if (!longOnly) take(k.a, h[k.a]); take(k.c, live112()); take(k.b, h[k.b] - L.SPECIAL.s112AExempt); }
  if (usefulOnly) return amt;
  take(k.c, h[k.c]);
  take(k.b, h[k.b]);
  return amt;
}
const HK = { a: "c111A", c: "c112", b: "c112A" };

// ---------------- the heads, the set-off, the total income ----------------
// a short-term capital loss can go against the other short-term gains or the 12.5% gains first (heads.js bucketsOf):
// which saves more depends on the slab, so both are worked and the lower tax liability kept (S.cgAlt: the second order)
// the same choice for a loss of another head (business loss, a house property loss, unabsorbed depreciation): against
// the normal-rate income first, the special-rate income first, or the normal-rate income down to a slab limit first
// (inp._lo: that limit for each; 0 = normal first, Infinity = special first). Each loss's limit is tried in turn and the
// lowest liability kept; the rebate of 87A (only against the normal tax in the new regime; not against 112A in the old)
// is why the special-rate income first can cost less. Ties keep the earlier choice (normal first, order A)
export const LOSS_LIMITS = [0, 250000, 300000, 400000, 500000, 800000, 1000000, 1200000, 1600000, 2000000, 2400000, Infinity];
export function compute(inp) {
  inp = inp || {};
  if (inp._lo) return computeOne(inp);
  const alt = inp.cg && inp.cg.alt;
  const run = (B, lo) => { const S = computeOne(Object.assign({}, inp, { _lo: lo, cg: B ? Object.assign({}, inp.cg, { s111A: alt.s111A, s112A: alt.s112A, s112: alt.s112, other: alt.stApp, cfStcl: alt.cfStcl, cfLtcl: alt.cfLtcl, at: alt.at, alt: null }) : inp.cg ? Object.assign({}, inp.cg, { alt: null }) : inp.cg })); S.cgAlt = B; return S; };
  let best = null, other = null;
  for (const B of alt ? [false, true] : [false]) {
    const lo0 = { bus: 0, hp: 0, ud: 0, busO: "A", hpO: "A", udO: "A", exO: "A" }, first = run(B, lo0);
    let cur = first;
    const kinds = ["bus", "hp", "ud"].filter((k) => Object.keys(first.setoff[k]).length);
    // every combination of the special-rate orders (each loss's and the basic exemption's), and for each the slab limit
    // of each loss tried in turn
    // order "C" (keep the 111A income the old regime's rebate absorbs) only where the rebate could apply
    const flags = kinds.map((k) => k + "O").concat(first.special > 0 ? ["exO"] : []);
    const opts = inp.entity === "P" && inp.regime !== "new" && inp.resident !== false && first.ti <= L.REBATE.old.upto + 1000000 ? ["A", "B", "C"] : ["A", "B"];
    const keepA = R(L.REBATE.old.max / L.SPECIAL.s111A);
    for (let m = 0; m < Math.pow(opts.length, flags.length); m++) {
      let lo = Object.assign({}, lo0, { keepA }); let q = m; flags.forEach((f) => { lo[f] = opts[q % opts.length]; q = Math.floor(q / opts.length); });
      let best0 = m === 0 ? first : run(B, lo);
      // with two or more losses, also start from the same limit for every loss (the losses one at a time can miss it)
      if (kinds.length > 1) for (const T of LOSS_LIMITS) { const l2 = Object.assign({}, lo); kinds.forEach((k) => { l2[k] = T; }); const t = run(B, l2); if (t.liability < best0.liability) { best0 = t; lo = l2; } }
      for (const k of kinds) for (const T of LOSS_LIMITS) { if (T === lo[k]) continue; const l2 = Object.assign({}, lo, { [k]: T }), t = run(B, l2); if (t.liability < best0.liability) { best0 = t; lo = l2; } }
      if (best0.liability < cur.liability) cur = best0;
    }
    if (!best || cur.liability < best.liability) { if (best) other = best; best = cur; } else other = cur;
  }
  best.cgOther = other ? other.liability : null;
  return best;
}
function computeOne(inp) {
  const S = { lines: [], needs: [], warn: [], entity: inp.entity, form: inp.form, regime: inp.regime };
  const line = (key, label, amt, o) => { const l = Object.assign({ key, label, amt: R(amt) }, o || {}); S.lines.push(l); return l.amt; };
  const ent = inp.entity, ind = ent === "P" || ent === "H", firm = ent === "F" || ent === "A" || ent === "B", co = ent === "C";
  if (ind && inp.regime !== "new" && inp.regime !== "old") S.needs.push({ key: "regime", text: "Choose the tax regime (new is the default; old needs Form 10-IEA by the due date when there is business income)." });
  if (ent === "A" || ent === "B" || ent === "J" || ent === "L") S.needs.push({ key: "entity", text: "An AOP, BOI, local authority or artificial juridical person is not covered yet: FinCom works ITR-5 for firms and LLPs." });
  if (co && inp.regime === "normal" && inp.smallCo == null) S.needs.push({ key: "small_co", text: "The company's turnover or gross receipts of FY 2023-24: within Rs 400 crore (25%) or above (30%)? Answer it on Data." });
  if (co && inp.regime === "normal" && inp.bookProfit != null && !inp.bookProfitOk) S.needs.push({ key: "mat_bp", text: "Book profit under section 115JB: enter it with the Explanation 1 adjustments and confirm it on Data (the profit after tax as it is is not book profit)." });
  if (co && inp.regime !== "115BAA" && inp.regime !== "normal") S.needs.push({ key: "regime", text: "Say whether the company is under section 115BAA." });

  // 1. Profits and gains of business or profession
  let pgbp = 0, itDep = 0, pres = null, p40 = null;
  if (inp.presumptive && (inp.form === "ITR-4" || inp.presumptive.use)) {
    pres = presumptive(inp.presumptive, ent, inp.llp);
    pres.lines.forEach((l) => line(l.key, l.label, l.amt, { sec: "bp", src: l.src, min: l.min }));
    S.needs.push(...pres.needs);
    pgbp = pres.income;
    S.presumptive = pres;
  } else if (inp.business) {
    const b = inp.business;
    const pbt = line("pbt", "Net profit before tax as per the profit and loss account", b.pbt, { sec: "bp", src: b.pbtSrc || "Part A-P&L", trace: b.pbtTrace });
    let adds = 0, less = 0;
    (b.adds || []).forEach((a) => { adds += line("add:" + a.key, "Add: " + a.label, a.amt, { sec: "bp", sign: 1, src: a.src, trace: a.trace, why: a.why }); });
    (b.less || []).forEach((a) => { less += line("less:" + a.key, "Less: " + a.label, a.amt, { sec: "bp", sign: -1, src: a.src, trace: a.trace, why: a.why }); });
    itDep = R(N(b.itDep));
    if (b.itDep != null) less += line("less:itdep", "Less: depreciation under section 32 (Schedule DEP)", itDep, { sec: "bp", sign: -1, src: "Section 32; Appendix I to the Income-tax Rules", trace: b.itDepTrace });
    pgbp = pbt + adds - less;
    if (firm && (inp.partners || []).length) {
      // the remuneration is in the P&L; 40(b) adds back what is above the limit
      const before = pgbp + R(sum(inp.partners, (p) => p.remuneration));
      p40 = partners40b(inp.partners, before);
      if (p40.interestAdd) pgbp += line("add:40b_int", "Add: interest to partners above 12% a year (40(b)(iv))", p40.interestAdd, { sec: "bp", sign: 1, src: L.S40B.src });
      if (p40.remAdd) pgbp += line("add:40b_rem", "Add: partners' remuneration above the 40(b)(v) limit (book profit " + p40.bookProfit + ", limit " + p40.limit + ")", p40.remAdd, { sec: "bp", sign: 1, src: L.S40B.src });
      S.p40b = p40;
    }
    line("pgbp", "Profits and gains of business or profession", pgbp, { sec: "bp", total: true });
  }
  pgbp = R(pgbp);

  // 2. Other heads
  // salary: the income under the head as Schedule S works it (heads.js), else gross less the standard deduction
  const sal = inp.salary ? R(inp.salary.net != null ? pos(inp.salary.net) : pos(N(inp.salary.gross) - N(inp.salary.std))) : 0;
  if (inp.salary) line("salary", "Income from salary", sal, { sec: "oh", src: inp.salary.src || "Sections 15-17, 16" });
  const hp = inp.hp != null ? R(inp.hp) : 0;
  if (inp.hp != null) line("hp", "Income from house property", hp, { sec: "oh", src: "Sections 22-27 (Schedule HP)" });
  const os = inp.os ? R(sum(Object.values(inp.os).filter((v) => typeof v === "number"))) : 0;
  if (inp.os) line("os", "Income from other sources", os, { sec: "oh", src: inp.os.src, parts: inp.os });
  const cg = inp.cg || {};
  const c111A = R(N(cg.s111A)), c112A = R(N(cg.s112A)), c112 = R(N(cg.s112)), cOth = R(N(cg.other));
  if (c111A || c112A || c112 || cOth) line("cg", "Capital gains", c111A + c112A + c112 + cOth, { sec: "oh", src: "Sections 45-55A, 111A, 112, 112A (Schedule CG)" });

  // 3. Set-off of the year's losses (sections 70, 71). A loss takes the normal-rate income down to the limit lo (inp._lo:
  // compute() tries each and keeps the lowest liability), then the special-rate income cheapest first (takeSpecial), then
  // the rest of the normal-rate income.
  // Business loss: against any head but salary (71(2A)). House property loss: up to Rs 2 lakh (71(3A); none in the new
  // regime, 115BAC(2)); salary and the other normal-rate heads first, business income last among them so a business
  // loss brought forward (72, business income only) still finds it
  let h = { sal, hp, pgbp, os, cOth, c112, c111A, c112A };
  const lo = inp._lo || { bus: 0, hp: 0, ud: 0 };
  const applyLoss = (amt, keys, T, rec, order) => {
    const normal = pos(h.sal) + pos(h.hp) + pos(h.pgbp) + pos(h.os) + pos(h.cOth);
    const fromNormal = (cap) => { for (const k of keys) { if (amt <= 0 || cap <= 0) break; if (h[k] > 0) { const u = Math.min(h[k], amt, cap); h[k] -= u; amt -= u; cap -= u; rec[k] = (rec[k] || 0) + u; } } };
    // normal down to the limit; the special-rate income still taxed; the rest of the normal; then what saves nothing
    fromNormal(Math.max(0, normal - T));
    amt = takeSpecial(h, amt, HK, cg.pool112, rec, false, true, order, lo.keepA);
    fromNormal(Infinity);
    return takeSpecial(h, amt, HK, cg.pool112, rec, false, false, order, lo.keepA);
  };
  // each set-off by head, for Schedules CYLA and BFLA (forms.js)
  const setoff = { bus: {}, hp: {}, bf: 0, ud: {}, bfHp: 0, bfCg: {} };
  let cyBizLoss = 0, cyUnabDep = 0;
  if (h.pgbp < 0) {
    let loss = -h.pgbp; h.pgbp = 0;
    loss = applyLoss(loss, ["hp", "os", "cOth"], lo.bus, setoff.bus, lo.busO);
    if (loss > 0) { cyUnabDep = Math.min(loss, itDep); cyBizLoss = loss - cyUnabDep; }
    line("cyla_bp", "Business loss of the year set off against other heads (sections 70, 71)", -pgbp - loss, { sec: "sl", src: L.LOSS.src });
  }
  let cfHp = 0;
  if (h.hp < 0) {
    let loss = -h.hp; h.hp = 0;
    const cap = inp.regime === "new" ? 0 : 200000; let room = Math.min(loss, cap); const used0 = room;
    room = applyLoss(room, ["sal", "os", "cOth", "pgbp"], lo.hp, setoff.hp, lo.hpO);
    cfHp = loss - (used0 - room);
  }
  // 4. Brought-forward losses, each within eight assessment years: 72 business loss against business income; 71B house
  // property loss against house property income; 74 short-term capital loss against any capital gain, long-term only
  // against long-term gains. Then 32(2) unabsorbed depreciation (no limit) against any head but salary
  const bf = inp.losses || {};
  const afterCyla = Object.assign({}, h);
  const bfOf = (list, heads, by, spec) => { let used = 0; const left = [];
    (list || []).slice().sort((a, b) => String(a.ay).localeCompare(String(b.ay))).forEach((x) => {
      if (+String(L.AY_START) - +String(x.ay).slice(0, 4) > L.LOSS.bizCarry) { left.push(Object.assign({}, x, { lapsed: true })); return; }
      // section 80: a business or capital loss is carried forward only from a return filed by its due date (a house
      // property loss, 71B, is not under section 80)
      if (x.inTime === false && heads[0] !== "hp") { left.push(Object.assign({}, x, { lapsed: true, s80: true })); return; }
      // 115BAC(2)(ii) (and 115BAA(2)(ii)): in the new regime the part of a business or house property loss brought forward
      // that came from deductions it bars (24(b) self-occupied interest, 10AA, 32(1)(iia), 35AD ...) is not set off
      let a = pos(x.amt) - (barOn && (heads[0] === "pgbp" || heads[0] === "hp") ? Math.min(pos(x.amt), pos(x.barred)) : 0);
      for (const k of heads) { if (a <= 0) break; if (h[k] > 0) { const u = Math.min(h[k], a); h[k] -= u; a -= u; used += u; if (by) by[k] = (by[k] || 0) + u; } }
      if (spec && a > 0) { const a0 = a; a = takeSpecial(h, a, HK, cg.pool112, by, spec === "lt"); used += a0 - a; }
      if (a > 0) left.push({ ay: x.ay, amt: R(a) });
    });
    return { used: R(used), left }; };
  const barOn = ((ent === "P" || ent === "H") && inp.regime === "new") || (co && inp.regime === "115BAA");
  if (barOn && (bf.business || []).concat(bf.hp || [], bf.ud || []).some((x) => pos(x.amt) && (x.barred == null || x.barred === ""))) S.needs.push({ key: "bf_115bac", text: "Losses of earlier years: say what part of each business or house property loss came from deductions the " + (co ? "115BAA" : "new") + " regime does not allow (24(b) interest on a self-occupied house, 10AA, additional depreciation 32(1)(iia), 35AD), and of unabsorbed depreciation what was additional depreciation; that part is not set off (" + (co ? "115BAA(2)(ii)" : "115BAC(2)(ii)") + "). Enter 0 if none." });
  const bfB = bfOf(bf.business, ["pgbp"]), bfH = bfOf(bf.hp, ["hp"]);
  const bfS = bfOf(bf.stcl, ["cOth"], setoff.bfCg, "all"), bfL = bfOf(bf.ltcl, [], setoff.bfCg, "lt");
  const bfUsed = bfB.used, bfLeft = bfB.left;
  setoff.bfHp = bfH.used;
  // unabsorbed depreciation: year by year (Schedule UD; 32(2): no time limit, and section 80 does not apply), less in
  // the new regime the part from additional depreciation (32(1)(iia), 115BAC(2)(ii)); or one amount as entered
  const udRows = (bf.ud || []).filter((x) => pos(x.amt));
  const udGross = udRows.length ? R(sum(udRows, (x) => pos(x.amt))) : R(N(bf.unabsorbedDep));
  let ud = udRows.length ? R(sum(udRows, (x) => pos(x.amt) - (barOn ? Math.min(pos(x.amt), pos(x.barred)) : 0))) : N(bf.unabsorbedDep), udUsed = 0;
  if (ud > 0) { const u0 = ud; ud = applyLoss(ud, ["pgbp", "hp", "os", "cOth"], lo.ud, setoff.ud, lo.udO); udUsed += u0 - ud; }
  setoff.bf = bfUsed;
  if (bfUsed) line("bfla_bp", "Brought-forward business loss set off (section 72)", bfUsed, { sec: "sl", sign: -1, src: L.LOSS.src });
  if (bfH.used) line("bfla_hp", "Brought-forward house property loss set off (section 71B)", bfH.used, { sec: "sl", sign: -1, src: "Section 71B: eight assessment years, against income from house property only" });
  if (bfS.used || bfL.used) line("bfla_cg", "Brought-forward capital losses set off (section 74)", bfS.used + bfL.used, { sec: "sl", sign: -1, src: "Section 74: eight assessment years; a short-term loss against any capital gain, a long-term loss against long-term gains only" });
  if (udUsed) line("bfla_ud", "Unabsorbed depreciation set off (section 32(2))", udUsed, { sec: "sl", sign: -1, src: L.LOSS.src });
  const late = !!(inp.filingDate && inp.filingDate > dueDate(inp));
  // section 80: a belated return carries no business loss of the year forward (unabsorbed depreciation still goes)
  // capital losses left after the set-off within the head (74), none from a belated return (80)
  const stcl = late ? 0 : R(N(cg.cfStcl)), ltcl = late ? 0 : R(N(cg.cfLtcl));
  S.carry = { bfHp: bfH.left.filter((x) => !x.lapsed), bfStcl: bfS.left.filter((x) => !x.lapsed), bfLtcl: bfL.left.filter((x) => !x.lapsed), business: bfLeft.filter((x) => !x.lapsed).concat(cyBizLoss && !late ? [{ ay: L.AY_START, amt: cyBizLoss }] : []), unabsorbedDep: R(ud + cyUnabDep), cyUd: R(cyUnabDep), bfUd: udGross, bfUdNet: R(udRows.length ? sum(udRows, (x) => pos(x.amt) - (barOn ? Math.min(pos(x.amt), pos(x.barred)) : 0)) : N(bf.unabsorbedDep)), bfUdLeft: R(ud), udUsed: R(udUsed), cyBus: R(cyBizLoss), hp: cfHp, stcl, ltcl, lostS80: late ? cyBizLoss : 0, lostCg: late ? R(N(cg.cfStcl) + N(cg.cfLtcl)) : 0 };
  if (late && (N(cg.cfStcl) || N(cg.cfLtcl))) S.warn.push({ key: "s80cg", text: "The return is after the due date: this year's capital loss of " + R(N(cg.cfStcl) + N(cg.cfLtcl)) + " cannot be carried forward (section 80)." });
  if (cyBizLoss && inp.filingDate && inp.filingDate > dueDate(inp)) S.warn.push({ key: "s80", text: "The return is after the due date: this year's business loss of " + cyBizLoss + " cannot be carried forward (section 80). Unabsorbed depreciation still is." });
  if (bfLeft.some((x) => x.lapsed)) S.warn.push({ key: "lapsed", text: "A brought-forward business loss older than eight years has lapsed and is not set off." });
  if (bfH.left.concat(bfS.left, bfL.left).some((x) => x.lapsed)) S.warn.push({ key: "lapsed_oth", text: "A house property or capital loss brought forward from more than eight years ago has lapsed (71B, 74) and is not set off." });

  const special = h.c111A + h.c112A + h.c112;
  const gti = R(h.sal + h.hp + h.pgbp + h.os + h.cOth + special);
  line("gti", "Gross total income", gti, { sec: "ti", total: true });

  // 5. Chapter VI-A, within the limits and never against special-rate income
  const ded = deductions(inp, gti - special, S);
  if (ded) line("via", "Less: deductions under Chapter VI-A", ded, { sec: "ti", sign: -1, src: L.VIA.src });
  const ti = R10(pos(gti - ded));
  line("ti", "Total income (rounded off under section 288A)", ti, { sec: "ti", total: true, src: L.ROUND.income });
  const normal = Math.max(0, ti - special);

  // 6. Tax
  const t = taxOn(inp, { ti, normal, s111A: h.c111A, s112A: h.c112A, s112: h.c112, relief: R(N(cg.relief112)), pool: cg.pool112 }, S);
  t.p112 = (t.parts || {}).p112 || null; t.relief112 = N((t.parts || {}).relief112);
  const inr = (x) => { const v = String(Math.round(x)), l3 = v.slice(-3), r = v.slice(0, -3); return (r ? r.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + l3; };
  line("tax_normal", "Tax on " + inr(normal) + " at the " + t.rateName, t.normalTax, { sec: "tx", src: t.src });
  if (t.specialTax) line("tax_special", "Tax on special-rate income (111A 20%, 112A 12.5% above Rs 1.25 lakh, 112 12.5%)" + (t.relief112 ? ", after " + t.relief112 + " ignored under the proviso to 112(1)(a)" : ""), t.specialTax, { sec: "tx", src: "Sections 111A, 112, 112A; proviso to 112(1)(a)" });
  if (t.rebate) line("rebate", "Less: rebate under section 87A", t.rebate, { sec: "tx", sign: -1, src: L.REBATE.src });
  if (t.sur) line("surcharge", "Surcharge" + (t.relief ? " (after marginal relief of " + t.relief + ")" : ""), t.sur, { sec: "tx", src: L.SRC_SUR });
  line("cess", "Health and Education Cess at 4%", t.cess, { sec: "tx", src: L.SRC_SUR });
  if (t.mat) line("mat", "Tax under section 115JB (MAT) on book profit " + t.mat.bookProfit + ": " + t.mat.total + " is " + (t.mat.applies ? "higher, so payable" : "lower than the normal tax"), t.mat.total, { sec: "tx", src: L.SRC_CO, info: true });
  if (t.matCreditUsed) line("mat_credit", "Less: MAT credit set off (section 115JAA)", t.matCreditUsed, { sec: "tx", sign: -1 });
  const liability = R(t.payable - t.matCreditUsed);
  line("liability", "Tax liability", liability, { sec: "tx", total: true });

  // 7. Taxes paid and interest
  const paid = inp.paid || {};
  const tds = R(sum(paid.tds, (x) => x.amt) + sum(paid.tdsSal, (x) => x.amt)), tcs = R(sum(paid.tcs, (x) => x.amt)), adv = R(sum(paid.advance, (x) => x.amt)), sat = R(sum(paid.selfAssessment, (x) => x.amt));
  const due = dueDate(inp), filing = inp.filingDate || due;
  // 234C, proviso (a): a shortfall from capital gains not foreseen is not interest-bearing when the tax on them is paid in
  // the remaining instalments; the tax on the income as it stood at each instalment date (heads.js: what had accrued)
  const liabAt = {};
  if (cg.at && !inp.noInterest) Object.keys(cg.at).forEach((d) => { const a = cg.at[d]; if (a.s111A === c111A && a.s112A === c112A && a.s112 === c112 && a.stApp === cOth) return;
    const sub = Object.assign({}, inp, { noInterest: true, paid: {}, cg: { s111A: a.s111A, s112A: a.s112A, s112: a.s112, other: a.stApp, pool112: (cg.poolAt || {})[d] || [] } });
    liabAt[d] = compute(sub).liability; });
  const i = inp.noInterest ? { a: 0, b: 0, c: 0, f: 0, cParts: [] } : interest({ liability, tds, tcs, advance: paid.advance || [], sa: paid.selfAssessment || [], due, filing, presumptive: !!(pres && inp.presumptive && (inp.presumptive.ad || inp.presumptive.ada)), ti, liabAt });
  if (i.a) line("i234a", "Interest under section 234A (" + i.monthsA + " months)", i.a, { sec: "in", src: L.INTEREST.src });
  if (i.b) line("i234b", "Interest under section 234B (" + i.monthsB + " months)", i.b, { sec: "in", src: L.INTEREST.src });
  if (i.c) line("i234c", "Interest under section 234C", i.c, { sec: "in", src: L.INTEREST.src });
  if (i.f) line("f234f", "Fee under section 234F", i.f, { sec: "in", src: L.FEE234F.src });
  line("tds", "Less: TDS", tds, { sec: "pd", sign: -1 }); if (tcs) line("tcs", "Less: TCS", tcs, { sec: "pd", sign: -1 });
  line("adv", "Less: advance tax", adv, { sec: "pd", sign: -1 }); if (sat) line("sat", "Less: self-assessment tax", sat, { sec: "pd", sign: -1 });
  const net = liability + i.a + i.b + i.c + i.f - tds - tcs - adv - sat;
  const payable = net > 0 ? R10(net) : 0, refund = net < 0 ? R10(-net) : 0;
  line(payable ? "payable" : "refund", payable ? "Tax payable (rounded off under section 288B)" : "Refund due (rounded off under section 288B)", payable || refund, { sec: "pd", total: true, src: L.ROUND.tax });

  Object.assign(S, {
    heads: { sal, hp, pgbp, os, cg: c111A + c112A + c112 + cOth, c111A, c112A, c112, cOth }, after: h, afterCyla, setoff, itDep,
    gti, ded, ti, normal, special, tax: t, liability, tds, tcs, adv, sat, interest: i, net: R(net), payable, refund, due, filing,
    // the figures the second computation must agree with, to the rupee
    key: { gti, ti, sal, hp, cg: c111A + c112A + c112 + cOth, normalTax: t.normalTax, specialTax: t.specialTax, rebate: t.rebate, sur: t.sur, cess: t.cess, liability, i234a: i.a, i234b: i.b, i234c: i.c, f234f: i.f, payable, refund, cfBus: late ? 0 : R(cyBizLoss), cfUd: R(cyUnabDep), cfHp: R(cfHp), cfStcl: stcl, cfLtcl: ltcl, bfHp: bfH.used, bfStcl: bfS.used, bfLtcl: bfL.used },
  });
  return S;
}

export function dueDate(inp) {
  if (inp.tp) return L.DUE.tp;
  if (inp.audit || inp.entity === "C") return L.DUE.audit;
  return L.DUE.nonAudit;
}

// Chapter VI-A within each section's own limit (old regime individuals / HUF); the new regime and other entities take
// only the sections the law leaves them. d: the claims; flags: selfSenior / parentsSenior / ddSevere / uSevere /
// ddbSenior / govtEmployer. 80G: a list [{amt, pct: 100 | 50, qualifying, cash}]
function deductions(inp, room, S) {
  const d = inp.deductions || {}, ent = inp.entity, ind = ent === "P" || ent === "H", V = L.VIA;
  const warn = (k, t) => S.warn.push({ key: "via_" + k, text: t });
  const cap = (k, lim, why) => { const v = N(d[k]); if (v > lim) warn(k, "Section " + k + " claimed " + v + ", allowed up to " + lim + (why ? " (" + why + ")" : "") + "."); return Math.max(0, Math.min(v, lim)); };
  // "salary" for 80CCD(2): basic + dearness allowance (never the whole gross); asked when not given
  const salary = inp.salary ? N(inp.salary.basicDa) : 0;
  if (N(d["80CCD2"]) && !(inp.salary && inp.salary.basicDa != null)) S.needs.push({ key: "ccd2_basic", text: "Section 80CCD(2): give the basic salary + dearness allowance on Schedules; the 14% / 10% limit is on it, not on the gross salary." });
  const allowedSet = ind ? (inp.regime === "new" ? V.newAllowed : null) : ent === "C" ? (inp.regime === "115BAA" ? V.baaAllowed : V.coAllowed) : V.firmAllowed;
  const g80 = Array.isArray(d["80G"]) ? d["80G"] : N(d["80G"]) ? [{ amt: N(d["80G"]), pct: 100, qualifying: false }] : [];
  const claimed = Object.keys(d).filter((k) => /^80/.test(k) && (k === "80G" ? g80.some((x) => N(x.amt)) : N(d[k])));
  const ok = (k) => { const base = k.replace(/_.*$/, ""); if (allowedSet && allowedSet.indexOf(base) < 0) { warn(base, "Section " + base + " is not allowed " + (ind ? "in the new regime (115BAC(2))" : ent === "C" && inp.regime === "115BAA" ? "under section 115BAA (115BAA(2)(ii))" : "to this entity") + "; left out."); return false; } return true; };
  let tot = 0;
  const alw = {}, put = (k, v) => { v = R(v); alw[k] = (alw[k] || 0) + v; return v; };
  const seen = new Set();
  claimed.forEach((k) => { const base = k.replace(/_.*$/, ""); if (seen.has(base)) return; seen.add(base); if (!ok(k)) return;
    switch (base) {
      case "80C": case "80CCC": case "80CCD1": break;   // together under 80CCE, below
      case "80CCD1B": tot += put(base, cap(k, V["80CCD1B"])); break;
      case "80CCD2": { const r = inp.regime === "new" || !ind ? V.ccd2New : d.govtEmployer ? V.ccd2New : V.ccd2Old; tot += put(base, cap(k, R(salary * r), (r * 100) + "% of salary" + (salary ? "" : ": no salary"))); break; }
      case "80D": { tot += put("80D", Math.min(N(d["80D_self"]), N(inp.age) >= 60 || d.selfSenior ? V.d80SelfSenior : V.d80Self) + Math.min(N(d["80D_parents"]), d.parentsSenior ? V.d80ParSenior : V.d80Par));
        const lim = (N(inp.age) >= 60 || d.selfSenior ? V.d80SelfSenior : V.d80Self); if (N(d["80D_self"]) > lim) warn("80D_self", "Section 80D (self and family) claimed " + N(d["80D_self"]) + ", allowed up to " + lim + ".");
        const lp = d.parentsSenior ? V.d80ParSenior : V.d80Par; if (N(d["80D_parents"]) > lp) warn("80D_parents", "Section 80D (parents) claimed " + N(d["80D_parents"]) + ", allowed up to " + lp + "."); break; }
      case "80DD": tot += put(base, cap(k, d.ddSevere ? V.dd80Severe : V.dd80)); break;
      case "80DDB": tot += put(base, cap(k, d.ddbSenior || N(inp.age) >= 60 ? V.ddb80Senior : V.ddb80)); break;
      case "80U": tot += put(base, cap(k, d.uSevere ? V.u80Severe : V.u80)); break;
      case "80TTA": if (N(inp.age) >= 60) warn(k, "Section 80TTA is not for a senior citizen (80TTB instead); left out."); else tot += put(base, cap(k, V["80TTA"])); break;
      case "80TTB": if (N(inp.age) < 60) warn(k, "Section 80TTB is for senior citizens only; left out."); else tot += put(base, cap(k, V["80TTB"])); break;
      case "80GG": tot += put(base, cap(k, V["80GG"])); break;
      case "80EE": tot += put(base, cap(k, V.ee80)); break;
      case "80EEA": case "80EEB": tot += put(base, cap(k, V.eea80)); break;
      case "80G": break;  // below, on the adjusted gross total income
      default: tot += put(base, N(d[k]));
    }
  });
  if (["80C", "80CCC", "80CCD1"].some((k) => claimed.includes(k) && ok(k))) { const c = N(d["80C"]) + N(d["80CCC"]) + N(d["80CCD1"]); if (c > V["80C"]) warn("80C", "Sections 80C, 80CCC and 80CCD(1) claimed " + c + ", allowed together up to " + V["80C"] + " (80CCE)."); tot += put("80C", Math.min(c, V["80C"])); }
  if (g80.length && claimed.includes("80G") && ok("80G")) {
    // a cash donation above Rs 2,000 is not allowed (80G(5D)); qualifying donations within 10% of the adjusted gross total income
    const adj = Math.max(0, room - tot), good = g80.filter((x) => { if (N(x.cash) > V.g80Cash) { warn("80G_cash", "A donation of " + N(x.amt) + " has " + N(x.cash) + " in cash: not allowed (80G(5D))."); return false; } return true; });
    let q = 0; good.filter((x) => x.qualifying).forEach((x) => { q += N(x.amt); });
    const qLim = R(adj * V.g80Limit); let qLeft = Math.min(q, qLim), g = 0;
    good.filter((x) => !x.qualifying).forEach((x) => { g += N(x.amt) * N(x.pct || 100) / 100; });
    good.filter((x) => x.qualifying).forEach((x) => { const u = Math.min(N(x.amt), qLeft); qLeft -= u; g += u * N(x.pct || 100) / 100; });
    if (q > qLim) warn("80G_limit", "Qualifying donations " + q + " are limited to 10% of the adjusted gross total income (" + qLim + ").");
    tot += put("80G", g);
  }
  tot = R(tot);
  S.viaAllowed = alw; S.viaCapped = tot > room;
  if (tot > room) { warn("room", "Chapter VI-A deductions are limited to the gross total income other than special-rate income (" + R(room) + ")."); tot = R(Math.max(0, room)); }
  return tot;
}

// the proviso to 112(1)(a), on the 112 income actually chargeable (after the set-offs and the basic exemption; the
// review of 1dc8f9d8e): for each property it covers (land or building bought before 23-07-2024 by a resident individual
// or HUF, heads.js), the tax is the lower of 12.5% of its gain and 20% of its gain with indexation. What came off the 112
// income (chg below the pool) comes off the covered properties first, row by row up to each one's indexed gain (every
// rupee there saves at least 12.5%), then off the other 112 gains, then off what is left of the covered properties.
// pool: [{id, gain, idx, elig}] (heads.js poolOf). -> {tax, relief, rows: [{id, charge, chargeIdx, taxA, taxB, excess}]}
export function tax112(pool, chg) {
  chg = pos(chg);
  const el = (pool || []).filter((x) => x.elig && N(x.gain) > 0);
  if (!el.length) return { tax: R(chg * L.SPECIAL.s112), relief: 0, rows: [] };
  const total = sum(pool, (x) => pos(x.gain)), rows = el.map((x) => ({ id: x.id, g: pos(x.gain), i: Math.min(pos(x.idx), pos(x.gain)), r: 0 }));
  let red = Math.max(0, total - chg);
  rows.forEach((x) => { const u = Math.min(red, x.i); x.r += u; red -= u; });
  let other = Math.max(0, total - sum(rows, (x) => x.g)); const u0 = Math.min(red, other); other -= u0; red -= u0;
  rows.forEach((x) => { const u = Math.min(red, x.g - x.r); x.r += u; red -= u; });
  let t = other * L.SPECIAL.s112;
  rows.forEach((x) => { x.charge = x.g - x.r; x.chargeIdx = Math.max(0, x.i - x.r); x.a = x.charge * L.SPECIAL.s112; x.b = x.chargeIdx * 0.2; t += Math.min(x.a, x.b); });
  const full = R(chg * L.SPECIAL.s112), tax = Math.min(full, R(t));
  return { tax, relief: full - tax, rows: rows.map((x) => ({ id: x.id, charge: R(x.charge), chargeIdx: R(x.chargeIdx), taxA: R(x.a), taxB: R(x.b), excess: Math.max(0, R(x.a) - R(x.b)) })) };
}
// tax on each special-rate part (after any exemption set against it); without rows behind the 112 income (an amount
// entered as it is), a relief entered with it comes off the 112 tax
function specialParts(p) {
  let t112, rel, p112 = null;
  if (p.pool) { p112 = tax112(p.pool, p.s112); t112 = p112.tax; rel = p112.relief; }
  else { const full = R(N(p.s112) * L.SPECIAL.s112); rel = Math.min(full, R(N(p.relief))); t112 = full - rel; }
  return { t111A: R(N(p.s111A) * L.SPECIAL.s111A), t112, t112A: R(Math.max(0, N(p.s112A) - L.SPECIAL.s112AExempt) * L.SPECIAL.s112A), relief112: rel, p112 };
}
function specialTax(p) { const t = specialParts(p); return t.t111A + t.t112 + t.t112A; }

// tax on an income split into normal and special parts, before cess; for an individual the basic exemption left
// over is used against the special-rate income (proviso to 111A / 112 / 112A, residents)
function baseTax(inp, p) {
  const ent = inp.entity;
  if (ent === "P" || ent === "H") {
    const slabs = slabsFor(inp), ex = exemptOf(slabs);
    let left = Math.max(0, ex - p.normal);
    const sp = { s111A: p.s111A, s112A: p.s112A, s112: p.s112, relief: p.relief, pool: p.pool };
    // the unused exemption where it saves most (takeSpecial): 111A, the 112 income still taxed, 112A above 1.25 lakh, the rest
    if (inp.resident !== false) left = takeSpecial(sp, left, { a: "s111A", c: "s112", b: "s112A" }, p.pool, null, false, false, inp._lo && inp._lo.exO, inp._lo && inp._lo.keepA);
    const parts = specialParts(sp);
    return { normalTax: slabTax(p.normal, slabs), specialTax: parts.t111A + parts.t112 + parts.t112A, parts, relief112: parts.relief112, p112: parts.p112, rateName: inp.regime === "new" ? "new regime slab rates (115BAC)" : "old regime slab rates", src: inp.regime === "new" ? L.SRC_SLABS.new : L.SRC_SLABS.old };
  }
  if (ent === "C") {
    const r = inp.regime === "115BAA" ? L.CO_RATE.baa : inp.smallCo === false ? L.CO_RATE.other : L.CO_RATE.small;
    return { normalTax: R(p.normal * r), specialTax: specialTax(p), parts: specialParts(p), rateName: (r * 100) + "% rate" + (inp.regime === "115BAA" ? " (section 115BAA)" : ""), src: L.SRC_CO };
  }
  return { normalTax: R(p.normal * L.FIRM_RATE), specialTax: specialTax(p), parts: specialParts(p), rateName: "30% rate", src: "Finance Act 2025, First Schedule, Part I, Paragraph C" };
}
// 87A (resident individuals). New regime: total income up to 12 lakh, special-rate income included; the rebate, and the
// marginal relief above 12 lakh (the tax at most the income above 12 lakh), only ever against the tax on normal income.
// Old regime: total income up to 5 lakh; against the tax on normal income, 111A and 112, never 112A (112A(6)).
function rebateOf(inp, p, bt) {
  if (inp.entity !== "P" || inp.resident === false) return 0;
  if (inp.regime === "new") {
    if (p.ti <= L.REBATE.new.upto) return Math.min(bt.normalTax, L.REBATE.new.max);
    const over = p.ti - L.REBATE.new.upto;
    return Math.min(bt.normalTax, Math.max(0, R(bt.normalTax + bt.specialTax - over)));
  }
  if (p.ti <= L.REBATE.old.upto) { const t = bt.parts || { t111A: 0, t112: 0 }; return Math.min(bt.normalTax + t.t111A + t.t112, L.REBATE.old.max); }
  return 0;
}
function surRate(inp, ti) {
  const ent = inp.entity;
  const bands = ent === "C" ? (inp.regime === "115BAA" ? null : L.SUR_CO) : ent === "F" ? L.SUR_FIRM : L.SUR_IND;
  if (!bands) return { rate: ti > 0 ? L.SUR_115BAA : 0, thr: 0, flat: true };
  let rate = 0, thr = 0;
  bands.forEach(([t, r]) => { if (ti > t) { rate = r; thr = t; } });
  if ((ent === "P" || ent === "H") && inp.regime === "new") rate = Math.min(rate, L.SUR_IND_NEW_CAP);
  return { rate, thr };
}
function surOf(inp, bt, rate, rebate) {
  const ind = inp.entity === "P" || inp.entity === "H" || inp.entity === "A" || inp.entity === "B";
  const nt = Math.max(0, bt.normalTax - rebate), st = bt.specialTax - Math.max(0, rebate - bt.normalTax);
  return R(nt * rate + Math.max(0, st) * (ind ? Math.min(rate, L.SUR_SPECIAL_CAP) : rate));
}
// the income at a threshold: the excess taken off the normal income first, then special
function atThreshold(p, thr) {
  let ex = p.ti - thr; const q = Object.assign({}, p, { ti: thr });
  const n = Math.min(ex, q.normal); q.normal -= n; ex -= n;
  for (const k of ["s112A", "s112", "s111A"]) { const u = Math.min(ex, q[k]); q[k] -= u; ex -= u; }
  return q;
}
export function taxOn(inp, p, S) {
  const bt = baseTax(inp, p), rebate = rebateOf(inp, p, bt);
  const sr = surRate(inp, p.ti);
  let sur = sr.rate ? surOf(inp, bt, sr.rate, rebate) : 0, relief = 0;
  if (sr.rate && !sr.flat && sr.thr) {
    // marginal relief: tax + surcharge at most the tax + surcharge on the threshold plus the income above it
    const q = atThreshold(p, sr.thr), bq = baseTax(inp, q), rq = rebateOf(inp, q, bq), lo = surRate(inp, sr.thr);
    const atT = bq.normalTax + bq.specialTax - rq + (lo.rate ? surOf(inp, bq, lo.rate, rq) : 0);
    const now = bt.normalTax + bt.specialTax - rebate + sur;
    const cap = atT + (p.ti - sr.thr);
    if (now > cap) { const was = sur; sur = R(sur - Math.min(sur, now - cap)); relief = was - sur; }
  }
  const before = bt.normalTax + bt.specialTax - rebate + sur;
  const cess = R(before * L.CESS);
  let payable = R(before + cess), mat = null, matCreditUsed = 0;
  if (inp.entity === "C" && inp.regime !== "115BAA" && inp.bookProfit != null) {
    const bp = R(inp.bookProfit), base = R(Math.max(0, bp) * L.CO_RATE.mat);
    const m = surRate(Object.assign({}, inp, { regime: "normal" }), bp);
    let msur = R(base * m.rate);
    if (m.rate && m.thr) {
      const lo = surRate(Object.assign({}, inp, { regime: "normal" }), m.thr), atT = R(m.thr * L.CO_RATE.mat) + R(R(m.thr * L.CO_RATE.mat) * lo.rate);
      if (base + msur > atT + (bp - m.thr)) msur = R(Math.max(0, atT + (bp - m.thr) - base));
    }
    const total = R(base + msur + R((base + msur) * L.CESS));
    mat = { bookProfit: bp, tax: base, sur: msur, total, applies: total > payable };
    if (mat.applies) {
      // MAT payable: the tax heads become MAT's (the credit of the difference is carried, 115JAA)
      mat.credit = total - payable;
      return Object.assign(bt, { rebate: 0, sur: msur, relief: 0, cess: R((base + msur) * L.CESS), payable: total, mat, matCreditUsed: 0, normalTaxShown: bt.normalTax, normalTax: base, specialTax: 0, rateName: "MAT 15% of book profit (115JB)" });
    }
    matCreditUsed = Math.min(N(inp.matCredit), Math.max(0, payable - total));
  } else if (inp.entity === "C" && inp.regime === "115BAA" && N(inp.matCredit)) {
    S && S.warn.push({ key: "mat_lapse", text: "MAT credit is not available to a company under section 115BAA (115JAA(8))." });
  }
  return Object.assign(bt, { rebate, sur, relief, cess, payable, mat, matCreditUsed });
}

// ---------------- interest 234A / 234B / 234C and fee 234F ----------------
const ymd = (y, m, d) => String(y) + String(m).padStart(2, "0") + String(d).padStart(2, "0");
// months or part of a month from the day after `from` up to `to` (both yyyymmdd), as the Act counts them
export function monthsAfter(from, to) {
  if (!to || to <= from) return 0;
  const y0 = +from.slice(0, 4), m0 = +from.slice(4, 6), d0 = +from.slice(6, 8), y1 = +to.slice(0, 4), m1 = +to.slice(4, 6), d1 = +to.slice(6, 8);
  let m = (y1 - y0) * 12 + (m1 - m0);
  if (d1 > d0) m += 1;
  return Math.max(m, 1);
}
export function interest(o) {
  const liability = N(o.liability), credit = N(o.tds) + N(o.tcs);
  const adv = sum(o.advance, (x) => x.amt), assessed = Math.max(0, liability - credit);
  const sa = (o.sa || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const out = { a: 0, b: 0, c: 0, f: 0, monthsA: 0, monthsB: 0, cParts: [] };
  // 234A: from the day after the due date to the filing, on the tax less advance tax, TDS, TCS and any self-assessment
  // tax paid by the due date; a self-assessment payment after the due date stops the interest on it from its month on
  if (o.filing > o.due) {
    const months = monthsAfter(o.due, o.filing); out.monthsA = months;
    for (let k = 0; k < months; k++) {
      const start = addMonths(o.due, k);           // the period (start, start + 1 month]
      const paidSa = sum(sa.filter((x) => x.date <= start), (x) => x.amt);
      out.a += D100(assessed - adv - paidSa) * L.INTEREST.rate;
    }
    out.a = R(out.a);
  }
  // 234B: advance tax below 90% of the assessed tax (from 1 April of the assessment year to the filing)
  if (assessed >= L.INTEREST.advanceMin && adv < 0.9 * assessed) {
    const start0 = ymd(+L.AY_START, 3, 31), months = monthsAfter(start0, o.filing); out.monthsB = months;
    for (let k = 0; k < months; k++) {
      const start = addMonths(start0, k);
      const paidSa = sum(sa.filter((x) => x.date <= start), (x) => x.amt);
      out.b += D100(assessed - adv - paidSa) * L.INTEREST.rate;
    }
    out.b = R(out.b);
  }
  // 234C: the instalments, on the tax on the returned income less TDS and TCS
  if (assessed >= L.INTEREST.advanceMin) {
    const fy0 = +L.AY_START - 1;
    const inst = o.presumptive ? [["0315", 1, 1]] : L.INTEREST.inst;
    inst.forEach(([md, share, months]) => {
      const date = (md === "0315" ? fy0 + 1 : fy0) + md;
      const paid = sum((o.advance || []).filter((x) => x.date <= date), (x) => x.amt);
      // proviso (a) to 234C: the instalment on the income as it stood on its date, when the tax on the capital gains
      // after it was paid in the remaining instalments (by 31 March)
      let base = assessed;
      const la = (o.liabAt || {})[date];
      if (la != null) { const later = sum((o.advance || []).filter((x) => x.date > date && x.date <= fy0 + 1 + "0331"), (x) => x.amt); if (later >= N(o.liability) - la) base = Math.max(0, la - credit); }
      const safe = !o.presumptive && L.INTEREST.safe[md] != null && paid >= L.INTEREST.safe[md] * base;
      const short = safe ? 0 : D100(share * base - paid);
      const v = R(short * L.INTEREST.rate * months);
      out.cParts.push({ date, due: R(share * base), paid: R(paid), short, months, v });
      out.c += v;
    });
  }
  if (o.filing > o.due) out.f = N(o.ti) <= L.FEE234F.smallIncome ? L.FEE234F.small : L.FEE234F.full;
  return out;
}
function addMonths(d, k) {
  let y = +d.slice(0, 4), m = +d.slice(4, 6) + k; const day = +d.slice(6, 8);
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(day, last));
}

// both regimes for an individual / HUF, for the choice (the page shows both; the owner chooses)
export function compareRegimes(inp) {
  const a = compute(Object.assign({}, inp, { regime: "new" })), b = compute(Object.assign({}, inp, { regime: "old" }));
  return { new: a.liability, old: b.liability, better: a.liability <= b.liability ? "new" : "old", saving: Math.abs(a.liability - b.liability) };
}
