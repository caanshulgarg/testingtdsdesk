// The heads of income that have their own schedules, AY 2026-27 (FY 2025-26): salary (Schedule S), house property
// (Schedule HP) and capital gains (Schedules CG, 112A, SI). Pure: rows in, the head worked out line by line, every rule
// with its section. Used by the main computation (model.js -> tax.js). The second computation (check.js) works the same
// heads again from the same rows with its own code and figures: a wrong rule here is caught by the two disagreeing.
// Rows are the owner's entries, brought in from Form 16 and the AIS where FinCom can read them (imports.js); dates are
// yyyymmdd. Every amount is in whole rupees.

const N = (v) => (typeof v === "number" && isFinite(v) ? v : +v || 0);
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const pos = (v) => Math.max(0, N(v));
const sum = (a, f) => (a || []).reduce((s, x) => s + N(f ? f(x) : x), 0);

// ---------------- Schedule S: salary (sections 15 to 17, 10, 16) ----------------
// exemptions not allowed in the new regime: section 115BAC(2)(i) (validation rule 198)
const NEW_NO = ["10(5)", "10(13A)", "10(14)(i)", "10(14)(ii)"];
const GOVT = ["CGOV", "SGOV", "PE", "PESG"];
export const SAL_LAW = {
  std: { new: 75000, old: 50000 }, ent: 5000, ptaxMax: 5000, ptaxArt276: 2500,
  limits: { "10(10)": [2000000, 2500000], "10(10AA)": [2500000, Infinity], "10(10C)": [500000, 500000], "10(10B)(i)": [500000, 500000], "10(10B)(ii)": [500000, 500000], "10(14)(ii)(115BAC)": [38400, 38400] },
  src: "Sections 15-17; section 10 (10(5), 10(10) Rs 20 lakh / 25 lakh, 10(10AA) Rs 25 lakh, 10(10B), 10(10C) Rs 5 lakh, 10(13A) with rule 2A, 10(14)); section 16(ia) standard deduction Rs 75,000 in the new regime (115BAC(1A)), Rs 50,000 in the old; 16(ii) entertainment allowance (government employees, old regime); 16(iii) tax on employment (old regime); 115BAC(2)",
};
// rows: [{employer, tan, nature, addr, s171, s172, s173, basicDa, exempt: [{sec, amt}], hra: {metro, received, rent}, ent, ptax, tds}]
export function salaryHead(rows, ctx) {
  const regime = (ctx || {}).regime === "old" ? "old" : "new", out = { rows: [], gross: 0, exempt: 0, net: 0, std: 0, ent: 0, ptax: 0, ded16: 0, income: 0, basicDa: 0, warn: [], src: SAL_LAW.src };
  (rows || []).forEach((r, i) => {
    const s171 = R(r.s171), s172 = R(r.s172), s173 = R(r.s173), gross = s171 + s172 + s173, basicDa = R(r.basicDa != null && r.basicDa !== "" ? r.basicDa : s171), govt = GOVT.includes(r.nature);
    const ex = [];
    let hra = null;
    (r.exempt || []).forEach((e) => {
      let amt = R(e.amt);
      if (e.sec === "10(13A)" && r.hra) {
        // the least of: the HRA received, rent paid less 10% of salary, 50% (metro) / 40% of salary (rule 2A)
        const rec = R(r.hra.received), rent10 = R(pos(N(r.hra.rent) - 0.1 * basicDa)), pc = R(basicDa * (r.hra.metro ? 0.5 : 0.4));
        amt = Math.min(rec, rent10, pc); hra = { metro: !!r.hra.metro, received: rec, rent: R(r.hra.rent), basicDa, rent10, pc, eligible: amt };
      }
      if (regime === "new" && NEW_NO.includes(e.sec)) { if (amt) out.warn.push({ key: "sal_new_" + e.sec, text: "Section " + e.sec + " exemption of " + amt + " is not allowed in the new regime (115BAC(2)); left out." }); amt = 0; }
      const lim = SAL_LAW.limits[e.sec];
      if (lim) { const L = govt ? lim[1] : lim[0]; if (amt > L) { out.warn.push({ key: "sal_lim_" + e.sec, text: "Section " + e.sec + " exemption claimed " + amt + ", allowed up to " + L + "." }); amt = L; } }
      if (amt > s171 && e.sec !== "10(10)" && e.sec !== "10(10A)" && e.sec !== "10(10AA)" && e.sec !== "10(10C)") { out.warn.push({ key: "sal_17_" + e.sec, text: "Section " + e.sec + " exemption is more than the salary under 17(1); cut to it." }); amt = s171; }
      ex.push({ sec: e.sec, amt: R(amt), desc: e.desc || "" });
    });
    let exempt = R(sum(ex, (x) => x.amt)); if (exempt > gross) exempt = gross;
    // 16(ii): government employees, old regime: the least of the allowance, Rs 5,000 and a fifth of the salary
    const ent = regime === "old" && govt ? R(Math.min(N(r.ent), SAL_LAW.ent, 0.2 * basicDa)) : 0;
    const ptax = regime === "old" ? R(Math.min(pos(r.ptax), SAL_LAW.ptaxMax)) : 0;
    if (regime === "old" && N(r.ptax) > SAL_LAW.ptaxArt276) out.warn.push({ key: "sal_ptax", text: "Tax on employment of " + R(r.ptax) + " is above Rs 2,500 a year (Article 276(2) of the Constitution): confirm." });
    const x = { i, employer: r.employer || "", tan: r.tan || "", nature: r.nature || "OTH", addr: r.addr || null, s171, s172, s173, gross, exemptRows: ex, exempt, net: gross - exempt, ent, ptax, basicDa, hra, tds: R(r.tds), src: r.src || "entered" };
    out.rows.push(x);
    out.gross += gross; out.exempt += exempt; out.net += x.net; out.ent += ent; out.ptax += ptax; out.basicDa += basicDa;
  });
  // one standard deduction for all employers, at most the salary (16(ia))
  out.std = out.rows.length ? Math.min(SAL_LAW.std[regime], out.net) : 0;
  out.ded16 = out.std + out.ent + out.ptax;
  out.income = R(pos(out.net - out.ded16));
  return out;
}
// a Form 16 read by imports.js -> a row of Schedule S
export function salaryFromForm16(d) {
  d = d || {};
  return { employer: d.employer || "", tan: d.tan || "", nature: "OTH", addr: d.addr || null, s171: R(d.s171), s172: R(d.s172), s173: R(d.s173), basicDa: d.basicDa != null ? R(d.basicDa) : undefined,
    exempt: (d.exempt || []).filter((e) => R(e.amt)).map((e) => ({ sec: e.sec, amt: R(e.amt) })), ptax: R(d.ptax), ent: R(d.ent), tds: R(d.tds), src: "Form 16" };
}

// ---------------- Schedule HP: house property (sections 22 to 27) ----------------
export const HP_LAW = { std: 0.3, sopCap: 200000, sopCapOld: 30000, arrears: 0.7, sopMax: 2,
  src: "Sections 22, 23 (annual value; municipal taxes paid in the year; 23(2) self-occupied nil, at most two, 23(4)), 24(a) 30%, 24(b) interest (self-occupied at most Rs 2 lakh, Rs 30,000 for a loan before 1-04-1999 or for repairs; nil in the new regime, 115BAC(2)), 25A arrears and unrealised rent (30% off), 26 co-owners" };
// props: [{kind: L | S | D, addr, share (%), coOwners, tenants, rent, unrealised, muniTax, loans: [{bank, account, date, total, outstanding, interest}], arrears, oldLoan, inBooks}]
export function houseHead(props, ctx) {
  const regime = (ctx || {}).regime === "old" ? "old" : "new", out = { props: [], total: 0, rentOwn: 0, warn: [], needs: [], src: HP_LAW.src };
  let sopLeft = null, sops = 0;
  (props || []).forEach((p, i) => {
    const share = p.share == null || p.share === "" ? 100 : Math.max(0, Math.min(100, N(p.share))), kind = ["L", "S", "D"].includes(p.kind) ? p.kind : "L";
    const interest = R(sum(p.loans, (l) => l.interest));
    const x = { i, kind, share, rent: 0, unrealised: 0, muniTax: 0, ded: 0, av: 0, own: 0, std30: 0, interest, interestAllowed: 0, arrears: 0, income: 0, loans: p.loans || [], addr: p.addr || null, coOwners: p.coOwners || [], tenants: p.tenants || [] };
    if (kind === "S" && ctx && ctx.entity && ctx.entity !== "P" && ctx.entity !== "H") out.needs.push({ key: "hp_sop_entity_" + i, text: "House " + (i + 1) + ": only an individual or HUF has a self-occupied house; a firm's or company's house is let out or deemed let out." });
    if (kind === "S") {
      sops++;
      // 24(b) second proviso: the self-occupied houses' interest together at most Rs 2 lakh (Rs 30,000 for an old loan)
      if (sopLeft == null) sopLeft = p.oldLoan ? HP_LAW.sopCapOld : HP_LAW.sopCap;
      const a = regime === "new" || share === 0 ? 0 : Math.min(interest, sopLeft);
      if (regime === "new" && interest) out.warn.push({ key: "hp_sop_new", text: "Interest of " + interest + " on a self-occupied house is not allowed in the new regime (115BAC(2))." });
      else if (a < interest && share) out.warn.push({ key: "hp_sop_cap", text: "Interest on self-occupied houses is allowed up to " + (p.oldLoan ? "Rs 30,000" : "Rs 2 lakh") + " in all (24(b)); " + (interest - a) + " is not allowed." });
      if (regime !== "new") sopLeft -= a;
      x.interestAllowed = a;
    } else {
      x.rent = R(p.rent); x.unrealised = Math.min(R(p.unrealised), x.rent); x.muniTax = x.rent > 0 ? R(p.muniTax) : 0;
      if (!x.rent) out.needs.push({ key: "hp_rent_" + i, text: "House " + (i + 1) + " is " + (kind === "D" ? "deemed let out" : "let out") + " with no rent: give the rent or the expected rent (rule 217)." });
      x.ded = x.unrealised + x.muniTax; x.av = R(pos(x.rent - x.ded)); x.own = R(x.av * share / 100); x.std30 = R(x.own * HP_LAW.std);
      x.interestAllowed = share === 0 ? 0 : interest;
      out.rentOwn += R(x.rent * share / 100);
    }
    x.arrears = R(N(p.arrears) * HP_LAW.arrears);
    x.income = R(x.own - x.std30 - x.interestAllowed + x.arrears);
    out.props.push(x); out.total += x.income;
  });
  if (sops > HP_LAW.sopMax) out.needs.push({ key: "hp_sop3", text: sops + " houses are self-occupied: at most two can be (23(4)); say which is deemed let out and give its expected rent." });
  out.total = R(out.total);
  return out;
}

// ---------------- Schedules CG, 112A: capital gains ----------------
// cost inflation index (rule 7(5) / notifications under section 48 Explanation (v)); FY 2025-26: 376 (Notification
// 70/2025). Indexation is used only for the proviso to 112(1)(a): land or building bought before 23-07-2024 by a
// resident individual or HUF
export const CII = { 2001: 100, 2002: 105, 2003: 109, 2004: 113, 2005: 117, 2006: 122, 2007: 129, 2008: 137, 2009: 148, 2010: 167, 2011: 184, 2012: 200, 2013: 220, 2014: 240,
  2015: 254, 2016: 264, 2017: 272, 2018: 280, 2019: 289, 2020: 301, 2021: 317, 2022: 331, 2023: 348, 2024: 363, 2025: 376 };
export const CG_LAW = {
  rates: { s111A: 0.2, s112A: 0.125, s112: 0.125, idx: 0.2 }, exempt112A: 125000, cut: "20240723", gf: "20180201", y2001: "20010401", sdvTol: 1.1, s54EC: 5000000, s54cap: 100000000,
  dates: ["20250615", "20250915", "20251215", "20260315", "20260331"],
  src: "Sections 2(42A) (long-term: more than 12 months for listed securities and equity fund units, 24 months for the rest, transfers from 23-07-2024), 45, 48 (no indexation from 23-07-2024), 49, 50AA (specified mutual funds, market-linked and unlisted debentures: short-term), 50C (stamp duty value above 110%), 50CA, 55(2)(ac) (cost of equity bought before 1-02-2018: FMV on 31-01-2018), 55(2)(b) (FMV on 1-04-2001), 46A and 2(22)(f) (buy-back from 1-10-2024: the money is dividend, the cost a capital loss), 54 / 54B / 54EC (Rs 50 lakh) / 54F (Rs 10 crore), 70(2)-(3), 74, 111A (20%), 112 (12.5%; proviso to 112(1)(a): for land or building bought before 23-07-2024 by a resident individual or HUF, the tax above 20% with indexation is ignored), 112A (12.5% above Rs 1.25 lakh)",
};
const LISTED12 = ["eq", "eqNoStt", "bond", "zcb"];
export const CG_KINDS = [["eq", "Listed equity share / equity fund unit (STT paid)"], ["eqNoStt", "Listed share without STT"], ["bond", "Listed bond or debenture"], ["unlisted", "Unlisted share"],
  ["land", "Land or building"], ["mfDebt", "Other mutual fund unit (bought before 1-04-2023)"], ["mf50AA", "Specified mutual fund / market-linked or unlisted debenture (50AA)"], ["other", "Other asset (gold, art ...)"], ["buyback", "Shares bought back by the company"]];
const fyOf = (d) => { const y = +String(d).slice(0, 4), m = +String(d).slice(4, 6); return m >= 4 ? y : y - 1; };
function addMonths(d, k) {
  let y = +String(d).slice(0, 4), m = +String(d).slice(4, 6) + k; const day = +String(d).slice(6, 8);
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return String(y) + String(m).padStart(2, "0") + String(Math.min(day, last)).padStart(2, "0");
}
// held for more than 12 / 24 months (section 2(42A)); 50AA assets are never long-term
export function longTerm(kind, acq, sale, r) {
  if (kind === "mf50AA" || !acq || !sale) return false;
  const months = LISTED12.includes(kind) || (kind === "buyback" && (!r || r.listed !== false)) ? 12 : 24;
  return String(sale) > addMonths(acq, months);
}
const ST = ["stApp", "s111A"], LT = ["s112", "s112A"];
function rowGain(r, ctx, warn) {
  const kind = r.kind || "other", acq = String(r.acq || ""), sale = String(r.sale || ""), lt = longTerm(kind, acq, sale, r);
  const value = kind === "buyback" ? 0 : R(r.value), sdv = R(r.sdv);
  // full value: 50C for land or building (the stamp duty value when above 110% of the consideration), 50CA for unlisted shares
  const fullValue = kind === "land" ? (sdv > CG_LAW.sdvTol * value ? sdv : value) : kind === "unlisted" ? Math.max(value, sdv) : value;
  let cost = R(r.cost);
  if (acq && acq < CG_LAW.y2001 && r.fmv2001 != null && r.fmv2001 !== "" && kind !== "eq") cost = R(r.fmv2001);
  const stt = kind === "eq" && r.stt !== false;
  let costUsed = cost;
  if (stt && lt && acq && acq < CG_LAW.gf && r.fmv2018 != null && r.fmv2018 !== "" && N(r.fmv2018) > 0) costUsed = Math.max(cost, Math.min(R(r.fmv2018), fullValue));
  const imps = Array.isArray(r.improve) ? r.improve : r.improveCost ? [{ fy: String(fyOf(acq || "20200401")), amt: r.improveCost }] : [];
  // 55(1)(b): improvement before 1-04-2001 is not counted
  const imp = R(sum(imps.filter((x) => +x.fy >= 2001), (x) => x.amt)), exp = R(r.expenses);
  const gain = fullValue - costUsed - imp - exp;
  const bucket = kind === "mf50AA" ? "stApp" : !lt ? (stt ? "s111A" : "stApp") : stt ? "s112A" : "s112";
  // the 54-series exemptions, at most the gain
  let ex = 0;
  (r.exempt || []).forEach((e) => {
    let a = R(e.amt);
    if (["54", "54EC", "54F"].includes(e.sec) && !lt) { warn.push({ key: "cg_ex_st_" + r.id, text: "Section " + e.sec + " is for long-term gains only: left out for " + (r.desc || "a sale") + "." }); a = 0; }
    if (e.sec === "54EC" && a > CG_LAW.s54EC) { warn.push({ key: "cg_54ec_" + r.id, text: "Section 54EC: at most Rs 50 lakh invested in a year; " + a + " cut to it." }); a = CG_LAW.s54EC; }
    if ((e.sec === "54" || e.sec === "54F") && a > CG_LAW.s54cap) { warn.push({ key: "cg_54cap_" + r.id, text: "Section " + e.sec + ": the new house's cost above Rs 10 crore is not counted; cut." }); a = CG_LAW.s54cap; }
    ex += a;
  });
  const exemptAmt = Math.min(ex, pos(gain)), net = gain - exemptAmt;
  // the proviso to 112(1)(a): land or building bought before 23-07-2024 by a resident individual or HUF
  let idxGain = null, excess = 0, idxCost = 0, idxImp = 0;
  if (kind === "land" && lt && acq && acq < CG_LAW.cut && (ctx.entity === "P" || ctx.entity === "H") && ctx.resident !== false) {
    const cs = CII[fyOf(sale)], ca = CII[Math.max(2001, fyOf(acq))];
    idxCost = R(cost * cs / ca);
    idxImp = R(sum(imps.filter((x) => +x.fy >= 2001), (x) => R(N(x.amt) * cs / CII[Math.min(2025, +x.fy)])));
    idxGain = fullValue - idxCost - idxImp - exp;
    const idxNet = idxGain - Math.min(ex, pos(idxGain));
    excess = Math.max(0, R(pos(net) * CG_LAW.rates.s112) - R(pos(idxNet) * CG_LAW.rates.idx));
  }
  return { id: r.id, kind, desc: r.desc || "", acq, sale, lt, value, sdv, fullValue, cost, costUsed, imp, exp, gain, exemptAmt, net, bucket, stt, idxGain, idxCost, idxImp, excess, exempt: r.exempt || [], src: r.src || "entered" };
}
// the head from the rows: set-off within the head (70(2): a short-term loss against any gain; 70(3): a long-term loss
// against long-term gains only); the long-term loss is set off first, so the short-term loss, which goes further, is
// kept for next years if anything is left; short-term loss against the normal-rate gains, then 111A, 112, 112A
function bucketsOf(rs) {
  const b = { stApp: 0, s111A: 0, s112: 0, s112A: 0 }, off = {};
  rs.forEach((x) => { b[x.bucket] += x.net; });
  const use = (from, to) => { const l = -b[from]; if (l <= 0 || b[to] <= 0) return; const u = Math.min(l, b[to]); b[from] += u; b[to] -= u; off[from + ">" + to] = (off[from + ">" + to] || 0) + u; };
  for (const f of LT) for (const t of LT) if (f !== t) use(f, t);
  for (const f of ST) for (const t of ["stApp", "s111A", "s112", "s112A"]) if (f !== t) use(f, t);
  const cfStcl = R(sum(ST, (k) => pos(-b[k]))), cfLtcl = R(sum(LT, (k) => pos(-b[k])));
  Object.keys(b).forEach((k) => { b[k] = R(pos(b[k])); });
  return { b, off, cfStcl, cfLtcl };
}
// rows: [{id, kind, desc, acq, sale, value, sdv, cost, improve: [{fy, amt}], expenses, fmv2018, fmv2001, stt, listed, exempt: [{sec, amt}], buyers, addr, isin, qty, inBooks}]
// ctx: {entity, resident}
export function capitalGains(rows, ctx) {
  ctx = ctx || {};
  const warn = [], rs = (rows || []).map((r, i) => rowGain(Object.assign({ id: r.id || "cg" + i }, r), ctx, warn));
  const k = bucketsOf(rs), relief = R(sum(rs.filter((x) => x.bucket === "s112"), (x) => x.excess));
  // what had accrued by each instalment date of 234C (the proviso to 234C: a capital gain is not an earlier shortfall)
  const at = {}, run = { stApp: 0, s111A: 0, s112: 0, s112A: 0 };
  CG_LAW.dates.forEach((d) => { const q = bucketsOf(rs.filter((x) => x.sale && x.sale <= d)).b; const o = {}; Object.keys(run).forEach((key) => { run[key] = Math.min(k.b[key], Math.max(run[key], q[key])); o[key] = run[key]; }); at[d] = o; });
  const reliefAt = {}; CG_LAW.dates.forEach((d) => { reliefAt[d] = R(sum(rs.filter((x) => x.bucket === "s112" && x.sale && x.sale <= d), (x) => x.excess)); });
  rs.forEach((x) => { if (x.kind === "eq" && x.lt && x.acq < CG_LAW.gf && !(N((rows.find((r) => (r.id || "") === x.id) || {}).fmv2018) > 0)) warn.push({ key: "cg_fmv_" + x.id, text: (x.desc || "An equity sale") + ": bought before 1-02-2018, the FMV on 31-01-2018 is not given (55(2)(ac)); the cost is taken as it is." }); });
  return Object.assign({ rows: rs, setoff: k.off, cfStcl: k.cfStcl, cfLtcl: k.cfLtcl, relief112: relief, at, reliefAt, warn, src: CG_LAW.src }, k.b, { total: k.b.stApp + k.b.s111A + k.b.s112 + k.b.s112A });
}
