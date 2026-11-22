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

// ---------------- the heads, the set-off, the total income ----------------
export function compute(inp) {
  inp = inp || {};
  const S = { lines: [], needs: [], warn: [], entity: inp.entity, form: inp.form, regime: inp.regime };
  const line = (key, label, amt, o) => { const l = Object.assign({ key, label, amt: R(amt) }, o || {}); S.lines.push(l); return l.amt; };
  const ent = inp.entity, ind = ent === "P" || ent === "H", firm = ent === "F" || ent === "A" || ent === "B", co = ent === "C";
  if (ind && inp.regime !== "new" && inp.regime !== "old") S.needs.push({ key: "regime", text: "Choose the tax regime (new is the default; old needs Form 10-IEA by the due date when there is business income)." });
  if (ent === "A" || ent === "B" || ent === "J" || ent === "L") S.needs.push({ key: "entity", text: "An AOP, BOI, local authority or artificial juridical person is not covered yet: FinCom works ITR-5 for firms and LLPs." });
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
  const sal = inp.salary ? R(pos(N(inp.salary.gross) - N(inp.salary.std))) : 0;
  if (inp.salary) line("salary", "Income from salary", sal, { sec: "oh", src: inp.salary.src });
  const hp = inp.hp != null ? R(inp.hp) : 0;
  if (inp.hp != null) line("hp", "Income from house property", hp, { sec: "oh" });
  const os = inp.os ? R(sum(Object.values(inp.os).filter((v) => typeof v === "number"))) : 0;
  if (inp.os) line("os", "Income from other sources", os, { sec: "oh", src: inp.os.src, parts: inp.os });
  const cg = inp.cg || {};
  const c111A = R(N(cg.s111A)), c112A = R(N(cg.s112A)), c112 = R(N(cg.s112)), cOth = R(N(cg.other));
  if (c111A || c112A || c112 || cOth) line("cg", "Capital gains", c111A + c112A + c112 + cOth, { sec: "oh" });

  // 3. Set-off of the year's losses (section 70, 71): business loss against any head but salary; house property loss
  // up to Rs 2 lakh against other heads (old regime; none in the new regime, 115BAC(2))
  let h = { sal, hp, pgbp, os, cOth, c112, c111A, c112A };
  let cyBizLoss = 0, cyUnabDep = 0;
  if (h.pgbp < 0) {
    let loss = -h.pgbp; h.pgbp = 0;
    for (const k of ["hp", "os", "cOth", "c112", "c111A", "c112A"]) { if (loss <= 0) break; if (h[k] > 0) { const u = Math.min(h[k], loss); h[k] -= u; loss -= u; } }
    if (loss > 0) { cyUnabDep = Math.min(loss, itDep); cyBizLoss = loss - cyUnabDep; }
    line("cyla_bp", "Business loss of the year set off against other heads (sections 70, 71)", -pgbp - loss, { sec: "sl", src: L.LOSS.src });
  }
  let cfHp = 0;
  if (h.hp < 0) {
    let loss = -h.hp; h.hp = 0;
    const cap = inp.regime === "new" ? 0 : 200000; let room = Math.min(loss, cap); const used0 = room;
    for (const k of ["os", "pgbp", "cOth", "c112", "c111A", "c112A", "sal"]) { if (room <= 0) break; if (h[k] > 0) { const u = Math.min(h[k], room); h[k] -= u; room -= u; } }
    cfHp = loss - (used0 - room);
  }
  // 4. Brought-forward losses (section 72, 32(2)): business loss within 8 years against business income only; then
  // unabsorbed depreciation against any head but salary
  const bf = inp.losses || {};
  let bfUsed = 0, bfLeft = [], udUsed = 0;
  (bf.business || []).slice().sort((a, b) => String(a.ay).localeCompare(String(b.ay))).forEach((x) => {
    const age = +String(L.AY_START) - +String(x.ay).slice(0, 4);
    if (age > L.LOSS.bizCarry) { bfLeft.push(Object.assign({}, x, { lapsed: true })); return; }
    const u = Math.min(h.pgbp, N(x.amt)); h.pgbp -= u; bfUsed += u;
    if (N(x.amt) - u > 0) bfLeft.push({ ay: x.ay, amt: N(x.amt) - u });
  });
  let ud = N(bf.unabsorbedDep);
  for (const k of ["pgbp", "hp", "os", "cOth", "c112", "c111A", "c112A"]) { if (ud <= 0) break; if (h[k] > 0) { const u = Math.min(h[k], ud); h[k] -= u; ud -= u; udUsed += u; } }
  if (bfUsed) line("bfla_bp", "Brought-forward business loss set off (section 72)", bfUsed, { sec: "sl", sign: -1, src: L.LOSS.src });
  if (udUsed) line("bfla_ud", "Unabsorbed depreciation set off (section 32(2))", udUsed, { sec: "sl", sign: -1, src: L.LOSS.src });
  S.carry = { business: bfLeft.concat(cyBizLoss ? [{ ay: L.AY_START, amt: cyBizLoss }] : []), unabsorbedDep: R(ud + cyUnabDep), hp: cfHp };
  if (cyBizLoss && inp.filingDate && inp.filingDate > dueDate(inp)) S.warn.push({ key: "s80", text: "The return is after the due date: this year's business loss of " + cyBizLoss + " cannot be carried forward (section 80). Unabsorbed depreciation still is." });
  if (bfLeft.some((x) => x.lapsed)) S.warn.push({ key: "lapsed", text: "A brought-forward business loss older than eight years has lapsed and is not set off." });

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
  const t = taxOn(inp, { ti, normal, s111A: h.c111A, s112A: h.c112A, s112: h.c112 }, S);
  const inr = (x) => { const v = String(Math.round(x)), l3 = v.slice(-3), r = v.slice(0, -3); return (r ? r.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + l3; };
  line("tax_normal", "Tax on " + inr(normal) + " at the " + t.rateName, t.normalTax, { sec: "tx", src: t.src });
  if (t.specialTax) line("tax_special", "Tax on special-rate income (111A 20%, 112A 12.5% above Rs 1.25 lakh, 112 12.5%)", t.specialTax, { sec: "tx", src: "Sections 111A, 112, 112A" });
  if (t.rebate) line("rebate", "Less: rebate under section 87A", t.rebate, { sec: "tx", sign: -1, src: L.REBATE.src, confirm: L.REBATE.special });
  if (t.sur) line("surcharge", "Surcharge" + (t.relief ? " (after marginal relief of " + t.relief + ")" : ""), t.sur, { sec: "tx", src: L.SRC_SUR });
  line("cess", "Health and Education Cess at 4%", t.cess, { sec: "tx", src: L.SRC_SUR });
  if (t.mat) line("mat", "Tax under section 115JB (MAT) on book profit " + t.mat.bookProfit + ": " + t.mat.total + " is " + (t.mat.applies ? "higher, so payable" : "lower than the normal tax"), t.mat.total, { sec: "tx", src: L.SRC_CO, info: true });
  if (t.matCreditUsed) line("mat_credit", "Less: MAT credit set off (section 115JAA)", t.matCreditUsed, { sec: "tx", sign: -1 });
  const liability = R(t.payable - t.matCreditUsed);
  line("liability", "Tax liability", liability, { sec: "tx", total: true });

  // 7. Taxes paid and interest
  const paid = inp.paid || {};
  const tds = R(sum(paid.tds, (x) => x.amt)), tcs = R(sum(paid.tcs, (x) => x.amt)), adv = R(sum(paid.advance, (x) => x.amt)), sat = R(sum(paid.selfAssessment, (x) => x.amt));
  const due = dueDate(inp), filing = inp.filingDate || due;
  const i = interest({ liability, tds, tcs, advance: paid.advance || [], sa: paid.selfAssessment || [], due, filing, presumptive: !!pres, ti });
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
    heads: { sal, hp, pgbp, os, cg: c111A + c112A + c112 + cOth, c111A, c112A, c112, cOth }, after: h, itDep,
    gti, ded, ti, normal, special, tax: t, liability, tds, tcs, adv, sat, interest: i, net: R(net), payable, refund, due, filing,
    // the figures the second computation must agree with, to the rupee
    key: { gti, ti, normalTax: t.normalTax, specialTax: t.specialTax, rebate: t.rebate, sur: t.sur, cess: t.cess, liability, i234a: i.a, i234b: i.b, i234c: i.c, f234f: i.f, payable, refund },
  });
  return S;
}

export function dueDate(inp) {
  if (inp.tp) return L.DUE.tp;
  if (inp.audit || inp.entity === "C") return L.DUE.audit;
  return L.DUE.nonAudit;
}

function deductions(inp, room, S) {
  const d = inp.deductions || {}; let tot = 0;
  const cap = (k, lim) => { const v = N(d[k]); if (v > lim) S.warn.push({ key: "via_" + k, text: "Section " + k + " claimed " + v + ", allowed up to " + lim + "." }); return Math.min(v, lim); };
  if (inp.regime === "new" || inp.entity === "C" || inp.entity === "F") {
    const allowed = inp.entity === "C" || inp.entity === "F" ? ["80G", "80GGB", "80GGC", "80JJAA", "80IAC"] : L.VIA.newAllowed;
    Object.keys(d).forEach((k) => { if (N(d[k]) && allowed.indexOf(k) < 0) S.warn.push({ key: "via_" + k, text: "Section " + k + " is not allowed " + (inp.regime === "new" ? "in the new regime (115BAC(2))" : "to this entity") + "; left out." }); else tot += N(d[k]); });
  } else {
    tot += cap("80C", L.VIA["80C"]) + cap("80CCD1B", L.VIA["80CCD1B"]);
    tot += cap("80D", N(inp.age) >= 60 ? L.VIA["80D_selfSenior"] + L.VIA["80D_parentsSenior"] : L.VIA["80D_self"] + L.VIA["80D_parentsSenior"]);
    if (N(inp.age) >= 60) tot += cap("80TTB", L.VIA["80TTB"]); else tot += cap("80TTA", L.VIA["80TTA"]);
    tot += cap("80GG", L.VIA["80GG"]);
    ["80G", "80E", "80CCD2", "80DD", "80DDB", "80U", "80GGC", "80JJAA"].forEach((k) => { tot += N(d[k]); });
  }
  tot = R(tot);
  if (tot > room) { S.warn.push({ key: "via_room", text: "Chapter VI-A deductions are limited to the gross total income other than special-rate income (" + R(room) + ")." }); tot = R(Math.max(0, room)); }
  return tot;
}

function specialTax(p) {
  return R(N(p.s111A) * L.SPECIAL.s111A + Math.max(0, N(p.s112A) - L.SPECIAL.s112AExempt) * L.SPECIAL.s112A + N(p.s112) * L.SPECIAL.s112);
}

// tax on an income split into normal and special parts, before cess; for an individual the basic exemption left
// over is used against the special-rate income (proviso to 111A / 112 / 112A, residents)
function baseTax(inp, p) {
  const ent = inp.entity;
  if (ent === "P" || ent === "H") {
    const slabs = slabsFor(inp), ex = exemptOf(slabs);
    let left = Math.max(0, ex - p.normal);
    const sp = { s111A: p.s111A, s112A: p.s112A, s112: p.s112 };
    if (inp.resident !== false) for (const k of ["s112", "s111A", "s112A"]) { const u = Math.min(left, sp[k]); sp[k] -= u; left -= u; }
    return { normalTax: slabTax(p.normal, slabs), specialTax: specialTax(sp), rateName: inp.regime === "new" ? "new regime slab rates (115BAC)" : "old regime slab rates", src: inp.regime === "new" ? L.SRC_SLABS.new : L.SRC_SLABS.old };
  }
  if (ent === "C") {
    const r = inp.regime === "115BAA" ? L.CO_RATE.baa : inp.smallCo === false ? L.CO_RATE.other : L.CO_RATE.small;
    if (inp.regime !== "115BAA" && inp.smallCo == null) inp._askSmall = true;
    return { normalTax: R(p.normal * r), specialTax: specialTax(p), rateName: (r * 100) + "% rate" + (inp.regime === "115BAA" ? " (section 115BAA)" : ""), src: L.SRC_CO };
  }
  return { normalTax: R(p.normal * L.FIRM_RATE), specialTax: specialTax(p), rateName: "30% rate", src: "Finance Act 2025, First Schedule, Part I, Paragraph C" };
}
function rebateOf(inp, p, bt) {
  if (inp.entity !== "P" || inp.resident === false) return 0;
  if (inp.regime === "new") {
    if (p.normal <= L.REBATE.new.upto) return Math.min(bt.normalTax, L.REBATE.new.max);
    const over = p.normal - L.REBATE.new.upto;        // marginal relief: the tax on normal income at most the income above 12 lakh
    return bt.normalTax > over ? R(bt.normalTax - over) : 0;
  }
  if (p.ti <= L.REBATE.old.upto) {
    const onTax = bt.normalTax + R(N(p.s111A) * L.SPECIAL.s111A);        // not against 112A tax (112A(6))
    return Math.min(Math.min(onTax, bt.normalTax + bt.specialTax), L.REBATE.old.max);
  }
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
      const safe = !o.presumptive && L.INTEREST.safe[md] != null && paid >= L.INTEREST.safe[md] * assessed;
      const short = safe ? 0 : D100(share * assessed - paid);
      const v = R(short * L.INTEREST.rate * months);
      out.cParts.push({ date, due: R(share * assessed), paid: R(paid), short, months, v });
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
