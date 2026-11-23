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
  limits: { "10(10)": [2000000, Infinity], "10(10AA)": [2500000, Infinity], "10(10C)": [500000, 500000], "10(10B)(i)": [500000, 500000], "10(10B)(ii)": [500000, 500000], "10(14)(ii)(115BAC)": [38400, 38400] },
  src: "Sections 15-17; section 10 (10(5), 10(10) Rs 20 lakh (10(10)(iii)), a government employee's wholly exempt (10(10)(i)), 10(10AA) Rs 25 lakh, 10(10B), 10(10C) Rs 5 lakh, 10(13A) with rule 2A, 10(14)); section 16(ia) standard deduction Rs 75,000 in the new regime (115BAC(1A)), Rs 50,000 in the old; 16(ii) entertainment allowance (government employees, old regime); 16(iii) tax on employment (old regime); 115BAC(2)",
};
export const NATURES = ["CGOV", "SGOV", "PSU", "PE", "PESG", "PEPS", "PEO", "OTH"];
// rows: [{employer, tan, nature, addr, s171, s172, s173, basicDa, exempt: [{sec, amt}], hra: {metro, received, rent}, ent, ptax, tds}]
// basicDa: "salary" for rule 2A (HRA), 16(ii) and 80CCD(2) is basic + dearness allowance (forming part of retirement
// benefits) + commission at a fixed percentage of turnover (rule 2A Explanation (ii)); never the whole of 17(1): asked
// when blank and one of those is used
export function salaryHead(rows, ctx) {
  const regime = (ctx || {}).regime === "old" ? "old" : "new", out = { rows: [], gross: 0, exempt: 0, net: 0, std: 0, ent: 0, ptax: 0, ded16: 0, income: 0, basicDa: 0, basicDaKnown: true, warn: [], needs: [], src: SAL_LAW.src };
  (rows || []).forEach((r, i) => {
    const known = r.basicDa != null && r.basicDa !== "";
    const s171 = R(r.s171), s172 = R(r.s172), s173 = R(r.s173), gross = s171 + s172 + s173, basicDa = known ? R(r.basicDa) : 0, govt = GOVT.includes(r.nature);
    const who = (r.employer || "Employer " + (i + 1));
    if (!known) out.basicDaKnown = false;
    if (!NATURES.includes(r.nature)) out.needs.push({ key: "sal_nature_" + i, text: who + ": say the kind of employer (central or state government, public sector, pensioner, other): Schedule S needs it, and the limits of 10(10), 10(10AA) and 16(ii) depend on it." });
    const hraUsed = regime === "old" && (r.exempt || []).some((e) => e.sec === "10(13A)") && r.hra, entUsed = regime === "old" && govt && N(r.ent) > 0;
    if (!known && (hraUsed || entUsed)) out.needs.push({ key: "sal_basic_" + i, text: who + ": give the basic salary + dearness allowance (rule 2A): " + (hraUsed ? "the HRA exemption" : "the entertainment allowance") + " is worked on it, not on the whole salary under 17(1)." });
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
      if (e.sec === "10(10)" && govt && amt > 2500000) out.warn.push({ key: "sal_grat_govt_" + i, text: "Gratuity of a government employee, " + amt + ", is wholly exempt (10(10)(i)) and is taken so; the department's utility may cap it at Rs 25 lakh: compare the utility's figure before filing." });
      if (amt > s171 && e.sec !== "10(10)" && e.sec !== "10(10A)" && e.sec !== "10(10AA)" && e.sec !== "10(10C)") { out.warn.push({ key: "sal_17_" + e.sec, text: "Section " + e.sec + " exemption is more than the salary under 17(1); cut to it." }); amt = s171; }
      ex.push({ sec: e.sec, amt: R(amt), desc: e.desc || "" });
    });
    let exempt = R(sum(ex, (x) => x.amt)); if (exempt > gross) exempt = gross;
    // 16(ii): government employees, old regime: the least of the allowance, Rs 5,000 and a fifth of the salary
    const ent = regime === "old" && govt ? R(Math.min(N(r.ent), SAL_LAW.ent, 0.2 * basicDa)) : 0;
    const ptax = regime === "old" ? R(Math.min(pos(r.ptax), SAL_LAW.ptaxMax)) : 0;
    if (regime === "old" && N(r.ptax) > SAL_LAW.ptaxArt276) out.warn.push({ key: "sal_ptax", text: "Tax on employment of " + R(r.ptax) + " is above Rs 2,500 a year (Article 276(2) of the Constitution): confirm." });
    const x = { i, employer: r.employer || "", tan: r.tan || "", nature: r.nature || "", basicDaKnown: known, addr: r.addr || null, s171, s172, s173, gross, exemptRows: ex, exempt, net: gross - exempt, ent, ptax, basicDa, hra, tds: R(r.tds), src: r.src || "entered" };
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
  // the kind of employer is not in Form 16: asked on Schedules (never assumed)
  return { employer: d.employer || "", tan: d.tan || "", nature: "", addr: d.addr || null, s171: R(d.s171), s172: R(d.s172), s173: R(d.s173), basicDa: d.basicDa != null ? R(d.basicDa) : undefined,
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
    // 24(b) Explanation: interest of the years before the house was bought or built, a fifth each year for five years
    const preConst = R(N(p.preConst) / 5), interest = R(sum(p.loans, (l) => l.interest)) + preConst;
    const x = { i, kind, share, preConst, rent: 0, unrealised: 0, muniTax: 0, ded: 0, av: 0, own: 0, std30: 0, interest, interestAllowed: 0, arrears: 0, income: 0, loans: p.loans || [], addr: p.addr || null, coOwners: p.coOwners || [], tenants: p.tenants || [] };
    if (kind === "S" && ctx && ctx.entity && ctx.entity !== "P" && ctx.entity !== "H") out.needs.push({ key: "hp_sop_entity_" + i, text: "House " + (i + 1) + ": only an individual or HUF has a self-occupied house; a firm's or company's house is let out or deemed let out." });
    if (kind === "S") {
      sops++;
      // 24(b) second proviso: the self-occupied houses' interest together at most Rs 2 lakh; a house whose loan was taken
      // before 1-04-1999 (or is for repairs) at most Rs 30,000 of it (first proviso), by that house's own loan
      if (sopLeft == null) sopLeft = HP_LAW.sopCap;
      const own = p.oldLoan ? HP_LAW.sopCapOld : HP_LAW.sopCap;
      const a = regime === "new" || share === 0 ? 0 : Math.min(interest, own, sopLeft);
      if (regime === "new" && interest) out.warn.push({ key: "hp_sop_new", text: "Interest of " + interest + " on a self-occupied house is not allowed in the new regime (115BAC(2))." });
      else if (a < interest && share) out.warn.push({ key: "hp_sop_cap_" + i, text: "House " + (i + 1) + ": interest on a self-occupied house is allowed up to " + (p.oldLoan ? "Rs 30,000 for a loan before 1-04-1999" : "Rs 2 lakh") + (own > sopLeft ? " (Rs 2 lakh for all self-occupied houses together)" : "") + " (24(b)); " + (interest - a) + " is not allowed." });
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
  rates: { s111A: 0.2, s112A: 0.125, s112: 0.125, idx: 0.2 }, exempt112A: 125000, due: "20260831", fyStart: "20250401", fyEnd: "20260331", cut: "20240723", gf: "20180201", y2001: "20010401", sdvTol: 1.1, s54EC: 5000000, s54cap: 100000000,
  dates: ["20250615", "20250915", "20251215", "20260315", "20260331"],
  src: "Sections 2(42A) (long-term: more than 12 months for listed securities and equity fund units, 24 months for the rest, transfers from 23-07-2024), 45, 48 (no indexation from 23-07-2024), 49, 50AA (specified mutual funds, market-linked and unlisted debentures: short-term), 50C (stamp duty value above 110%), 50CA, 55(2)(ac) (cost of equity bought before 1-02-2018: FMV on 31-01-2018), 55(2)(b) (FMV on 1-04-2001), 46A and 2(22)(f) (buy-back from 1-10-2024: the money is dividend, the cost a capital loss), 54 / 54B / 54EC (Rs 50 lakh) / 54F (Rs 10 crore), 70(2)-(3), 74, 111A (20%), 112 (12.5%; proviso to 112(1)(a): for land or building bought before 23-07-2024 by a resident individual or HUF, the tax above 20% with indexation is ignored), 112A (12.5% above Rs 1.25 lakh)",
};
const LISTED12 = ["eq", "eqNoStt", "bond", "zcb"];
export const CG_KINDS = [["eq", "Listed equity share / equity fund unit (STT paid)"], ["eqNoStt", "Listed share without STT"], ["bond", "Listed bond or debenture"], ["unlisted", "Unlisted share"],
  ["land", "Land or building"], ["mfDebt", "Other mutual fund unit (bought before 1-04-2023)"], ["mf50AA", "Specified mutual fund / market-linked or unlisted debenture (50AA)"], ["other", "Other asset (gold, art ...)"], ["buyback", "Shares bought back by the company"]];
export const fyOf = (d) => { const y = +String(d).slice(0, 4), m = +String(d).slice(4, 6); return m >= 4 ? y : y - 1; };
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
const IND = (ctx) => ctx.entity === "P" || ctx.entity === "H";
// the 54-series on one basis of the gain (without indexation, and with it for the proviso to 112(1)(a)): each claim's
// own rule, together at most the gain. c: the claims as allowed for this row (allowedClaims)
function exemptOn(G, claims, netCons) {
  let left = pos(G), tot = 0;
  claims.forEach((c) => {
    let a = 0;
    if (c.sec === "54" || c.sec === "54B") a = Math.min(pos(G), c.cost);                                 // 54(1), 54B(1): the lower of the gain and the new asset's cost
    else if (c.sec === "54F") a = netCons > 0 ? (c.cost >= netCons ? pos(G) : pos(G) * c.cost / netCons) : 0;  // 54F(1)(b): gain x cost / net consideration
    else a = Math.min(pos(G), c.amt);                                                                    // 54EC (as allowed this year), 54D, 54G, 54GA ...
    a = R(Math.min(a, left)); left -= a; tot += a;
  });
  return tot;
}
// which claims the law lets this row have: 54 a residential house sold; 54B agricultural land used for agriculture for
// two years; 54EC land or building, the bonds bought within six months of the sale (Rs 50 lakh in all in a year: ec, below);
// 54F any long-term asset other than a residential house; 54 / 54B / 54F only for an individual or HUF; the new house's
// cost at most Rs 10 crore (54(1), 54F(1) provisos); the new asset bought within its window (54 / 54F: a year before or
// two years after; built within three years; 54B: two years after) or the money deposited in the Capital Gains Account
// Scheme by the due date of 139(1) (54(2), 54B(2), 54F(4)). ec: {want} on the first pass (what 54EC each sale could
// take), {alloc} on the second (the 50 lakh as shared out by capitalGains)
function windowOk(sec, e, sale, ctx) {
  const d = String(e.date || ""), how = e.how || "bought", due = ctx.due || CG_LAW.due;
  if (!d || !sale) return true;
  if (how === "cgas") return d <= due;
  if (how === "built") return d >= sale && d <= addMonths(sale, 36);
  if (sec === "54B") return d >= sale && d <= addMonths(sale, 24);
  return d >= addMonths(sale, -12) && d <= addMonths(sale, 24);
}
function allowedClaims(r, kind, lt, ctx, ec, warn, needs, G) {
  const who = r.desc || "a sale", out = [], sale = String(r.sale || "");
  (r.exempt || []).forEach((e, j) => {
    const sec = String(e.sec || ""), amt = R(e.amt), cost0 = e.cost != null && e.cost !== "" ? R(e.cost) : null;
    const no = (why) => { warn.push({ key: "cg_ex_" + sec + "_" + r.id + "_" + j, text: "Section " + sec + " " + why + ": left out for " + who + "." }); };
    if (["54", "54EC", "54F"].includes(sec) && !lt) return no("is for long-term gains only");
    if (["54", "54B", "54F"].includes(sec) && !IND(ctx)) return no("is for an individual or HUF only");
    if (sec === "54" && !(kind === "land" && r.residential)) return no("is for the sale of a residential house (mark the sale as a residential house if it is one)");
    if (sec === "54F" && kind === "land" && r.residential) return no("is for an asset other than a residential house (section 54 is for a house)");
    if (sec === "54B" && kind !== "land") return no("is for agricultural land");
    if (sec === "54B" && !r.agri) return no("is for agricultural land used for agriculture by the person or a parent in the two years before the sale (tick it on the sale if it was)");
    if (sec === "54EC" && kind !== "land") return no("is for land or building only");
    if (sec === "54EC") {
      const d = String(e.date || "");
      if (!d) needs.push({ key: "cg_54ec_date_" + r.id + "_" + j, text: who + ": give the date the 54EC bonds were bought (within six months of the sale)." });
      else if (d < sale || d > addMonths(sale, 6)) return no("needs the bonds bought within six months after the sale (bought " + d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) + ")");
      if (ec.alloc == null) { ec.want[r.id] = (ec.want[r.id] || 0) + amt; return; }
      const a = Math.min(amt, ec.alloc[r.id] || 0); ec.alloc[r.id] = (ec.alloc[r.id] || 0) - a;
      return out.push({ sec, amt: a });
    }
    if (sec === "54" || sec === "54F" || sec === "54B") {
      if (!e.date) needs.push({ key: "cg_" + sec + "_date_" + r.id + "_" + j, text: who + ": give the date the new " + (sec === "54B" ? "land" : "house") + " was bought or built, or the money deposited in the Capital Gains Account Scheme (section " + sec + ")." });
      else if (!windowOk(sec, e, sale, ctx)) return no(e.how === "cgas" ? "needs the money deposited in the Capital Gains Account Scheme by the due date of the return (139(1))" : sec === "54B" ? "needs the new land bought within two years after the sale" : e.how === "built" ? "needs the house built within three years after the sale" : "needs the house bought within a year before or two years after the sale");
      let cost = cost0 != null ? cost0 : sec === "54F" ? null : amt;
      if (cost == null) { needs.push({ key: "cg_54f_cost_" + r.id, text: who + ": give the cost of the new house for section 54F (the exemption is the gain x the cost / the net consideration)." }); cost = 0; }
      if (sec !== "54B" && cost > CG_LAW.s54cap) { warn.push({ key: "cg_54cap_" + r.id, text: "Section " + sec + ": the new house's cost above Rs 10 crore is not counted." }); cost = CG_LAW.s54cap; }
      return out.push({ sec, cost });
    }
    out.push({ sec, amt });
  });
  return out;
}
function rowGain(r, ctx, warn, needs, ec) {
  ec = ec || { want: {} };
  const kind = r.kind || "other", acq = String(r.acq || ""), sale = String(r.sale || ""), lt = longTerm(kind, acq, sale, r), who = r.desc || "A sale";
  if (!sale) needs.push({ key: "cg_nosale_" + r.id, text: who + ": give the date of sale (it decides the holding period, the rate and the instalment of 234C)." });
  else if (sale < CG_LAW.fyStart || sale > CG_LAW.fyEnd) needs.push({ key: "cg_saledate_" + r.id, text: who + ": the date of sale must be within 1-04-2025 to 31-03-2026 (the previous year)." });
  if (acq && sale && acq > sale) needs.push({ key: "cg_acqdate_" + r.id, text: who + ": the date of purchase must be before the sale." });
  // a buy-back: the money received is dividend (2(22)(f)); nil consideration here, the cost a capital loss (46A)
  const value = kind === "buyback" ? 0 : R(r.value), sdv = R(r.sdv);
  // full value: 50C for land or building (the stamp duty value when above 110% of the consideration), 50CA for unlisted shares
  const fullValue = kind === "land" ? (sdv > CG_LAW.sdvTol * value ? sdv : value) : kind === "unlisted" ? Math.max(value, sdv) : value;
  let cost = R(r.cost);
  // 55(2)(b): an asset held on 1-04-2001, its FMV of that date at the option; for land or building at most its stamp
  // duty value on that date (proviso)
  if (acq && acq < CG_LAW.y2001 && r.fmv2001 != null && r.fmv2001 !== "" && kind !== "eq") {
    cost = R(r.fmv2001);
    if (kind === "land") {
      if (r.sdv2001 != null && r.sdv2001 !== "") cost = Math.min(cost, R(r.sdv2001));
      else needs.push({ key: "cg_sdv2001_" + r.id, text: who + ": give the stamp duty value on 1-04-2001: the FMV of that date is taken at most at it (proviso to 55(2)(b))." });
    }
  }
  // STT paid: listed equity / equity fund units, and listed shares bought back (tendered through the exchange)
  const stt = (kind === "eq" && r.stt !== false) || (kind === "buyback" && r.listed !== false);
  let costUsed = cost;
  if (stt && lt && acq && acq < CG_LAW.gf && r.fmv2018 != null && r.fmv2018 !== "" && N(r.fmv2018) > 0) costUsed = Math.max(cost, Math.min(R(r.fmv2018), fullValue));
  const imps = Array.isArray(r.improve) ? r.improve : r.improveCost ? [{ fy: String(fyOf(acq || "20200401")), amt: r.improveCost }] : [];
  // 55(1)(b): improvement before 1-04-2001 is not counted
  const imp = R(sum(imps.filter((x) => +x.fy >= 2001), (x) => x.amt)), exp = R(r.expenses);
  const gain = fullValue - costUsed - imp - exp, netCons = fullValue - exp;
  const bucket = kind === "mf50AA" ? "stApp" : !lt ? (stt ? "s111A" : "stApp") : stt ? "s112A" : "s112";
  // agricultural land in a rural area is not a capital asset (2(14)(iii)): asked
  if (kind === "land" && r.agri && r.agriUrban !== true) needs.push({ key: "cg_rural_" + r.id, text: who + ": agricultural land: is it within the limits of a municipality or the distance from one in 2(14)(iii)? Rural agricultural land is not a capital asset and its sale is not taxed; say it is urban to keep it here." });
  const claims = allowedClaims(r, kind, lt, ctx, ec, warn, needs, gain);
  const exemptAmt = exemptOn(gain, claims, netCons), net = gain - exemptAmt;
  // the proviso to 112(1)(a): land or building bought before 23-07-2024 by a resident individual or HUF: the gain with
  // indexation (CII of the year of sale / of the year of purchase, 2001-02 at the earliest) and the exemptions on it
  let idxGain = null, idxNet = null, idxCost = 0, idxImp = 0;
  if (kind === "land" && lt && acq && acq < CG_LAW.cut && IND(ctx) && ctx.resident !== false) {
    const cs = CII[fyOf(sale)], ca = CII[Math.max(2001, fyOf(acq))];
    idxCost = R(cost * cs / ca);
    idxImp = R(sum(imps.filter((x) => +x.fy >= 2001), (x) => R(N(x.amt) * cs / CII[Math.min(2025, +x.fy)])));
    idxGain = fullValue - idxCost - idxImp - exp;
    idxNet = idxGain - exemptOn(idxGain, claims, netCons);
  }
  return { id: r.id, kind, desc: r.desc || "", acq, sale, lt, value, sdv, totalConsid: R(r.totalConsid) || null, fullValue, cost, costUsed, imp, exp, gain, exemptAmt, net, bucket, stt, idxGain, idxNet, idxCost, idxImp, exempt: r.exempt || [], claims, residential: !!r.residential, src: r.src || "entered" };
}
// the head from the rows: set-off within the head. Table E's categories: 20% (111A), the applicable rates, 12.5% (112 and
// 112A together); within a category gains and losses net (the form's own lines). A category's net loss then goes: a
// long-term loss only against the 12.5% gains (70(3)), a short-term loss against any (70(2)). Within the 12.5% category
// the loss goes where it saves the most: on 112 up to what is still taxed there (a covered property up to its indexed
// gain, the other 112 gains; tax.js tax112), then on 112A above its Rs 1.25 lakh exemption, then the rest of 112, then
// 112A's exempt part (the review of 23ee460d1). A short-term loss: order "A" the other short-term category first, then
// the 12.5% gains; "B" the 12.5% gains first. Which saves more depends on the slab: tax.js works both and keeps the lower
function bucketsOf(rs, order) {
  const off = {}, put = (k, v) => { off[k] = (off[k] || 0) + v; };
  let a = 0, o = 0;
  rs.forEach((x) => { if (x.bucket === "s111A") a += x.net; else if (x.bucket === "stApp") o += x.net; });
  const g112 = rs.filter((x) => x.bucket === "s112" && x.net > 0), g112A = rs.filter((x) => x.bucket === "s112A" && x.net > 0);
  let c112 = sum(g112, (x) => x.net), c112A = sum(g112A, (x) => x.net), r112 = 0;
  const U = sum(g112, (x) => (x.idxNet != null ? Math.min(pos(x.idxNet), x.net) : x.net));
  const toLT = (loss, from) => {
    const take = (k, cap) => { const u = Math.min(loss, Math.max(0, cap)); if (u <= 0) return; loss -= u; if (k === "s112") { c112 -= u; r112 += u; } else c112A -= u; put(from + ">" + k, u); };
    take("s112", Math.min(c112, U - r112)); take("s112A", c112A - CG_LAW.exempt112A); take("s112", c112); take("s112A", c112A);
    return loss;
  };
  const ltLoss = toLT(sum(rs.filter((x) => (x.bucket === "s112" || x.bucket === "s112A") && x.net < 0), (x) => -x.net), "lt");
  let la = Math.max(0, -a), lo = Math.max(0, -o); a = Math.max(0, a); o = Math.max(0, o);
  const toST = (loss, from) => { const u = Math.min(loss, from === "stApp" ? a : o); if (u <= 0) return loss; if (from === "stApp") a -= u; else o -= u; put(from + ">" + (from === "stApp" ? "s111A" : "stApp"), u); return loss - u; };
  const st = (loss, from) => (order === "B" ? toST(toLT(loss, from), from) : toLT(toST(loss, from), from));
  lo = st(lo, "stApp"); la = st(la, "s111A");
  return { b: { stApp: R(o), s111A: R(a), s112: R(c112), s112A: R(c112A) }, off, cfStcl: R(la + lo), cfLtcl: R(ltLoss) };
}
// the gains taxed under 112 before any set-off, row by row, for the proviso to 112(1)(a) (tax.js tax112): the gain
// without indexation and, for a property the proviso covers, with it
const poolOf = (rs) => rs.filter((x) => x.bucket === "s112" && x.net > 0).map((x) => ({ id: x.id, gain: R(x.net), idx: x.idxNet == null ? null : R(x.idxNet), elig: x.idxNet != null }));
// the Rs 50 lakh of 54EC shared among the sales that claim it (first proviso to 54EC(1)), where it saves the most tax:
// a property the proviso to 112(1)(a) covers up to its indexed gain first (each rupee there saves 20% or at least
// 12.5%), then the other sales, then what is left of the covered ones; never by the order the sales were entered
function share54EC(first, want) {
  let left = CG_LAW.s54EC; const alloc = {}, give = (x, cap) => { const u = Math.min(left, Math.max(0, cap)); if (u > 0) { alloc[x.id] = (alloc[x.id] || 0) + u; left -= u; } };
  const ws = first.filter((x) => want[x.id] > 0).map((x) => ({ id: x.id, w: Math.min(want[x.id], pos(x.net)), i: x.idxNet == null ? null : pos(x.idxNet) }));
  ws.filter((x) => x.i != null).forEach((x) => give(x, Math.min(x.w, x.i)));
  ws.filter((x) => x.i == null).forEach((x) => give(x, x.w));
  ws.filter((x) => x.i != null).forEach((x) => give(x, x.w - (alloc[x.id] || 0)));
  return alloc;
}
// rows: [{id, kind, desc, acq, sale, value, sdv, totalConsid, cost, improve: [{fy, amt}], expenses, fmv2018, fmv2001, sdv2001, stt, listed, residential, agri, agriUrban, exempt: [{sec, amt, cost, date, how}], buyers, addr, isin, qty, inBooks}]
// ctx: {entity, resident, due}
export function capitalGains(rows, ctx) {
  ctx = ctx || {};
  const rows1 = (rows || []).map((r, i) => Object.assign({ id: r.id || "cg" + i }, r));
  // first pass: each sale without 54EC, and what 54EC it claims; then the 50 lakh shared; then the sales again
  const want = {}, first = rows1.map((r) => rowGain(r, ctx, [], [], { want }));
  const alloc = share54EC(first, want), given = Object.assign({}, alloc);
  const warn = [], needs = [];
  const rs = rows1.map((r) => rowGain(r, ctx, warn, needs, { alloc }));
  const wanted = R(sum(first, (x) => Math.min(want[x.id] || 0, pos(x.net)))), got = R(sum(Object.values(given)));
  if (got < wanted) warn.push({ key: "cg_54ec_cap", text: "Section 54EC: " + wanted + " claimed on the sales' gains, at most Rs 50 lakh in all in a year (first proviso to 54EC(1)); " + got + " allowed, shared where it saves the most tax." });
  const k = bucketsOf(rs, "A"), kB = bucketsOf(rs, "B");
  // what had accrued by each instalment date of 234C (the proviso to 234C: a capital gain is not an earlier shortfall)
  const atOf = (ord, all) => { const at = {}, run = { stApp: 0, s111A: 0, s112: 0, s112A: 0 };
    CG_LAW.dates.forEach((d) => { const q = bucketsOf(rs.filter((x) => x.sale && x.sale <= d), ord).b; const o = {}; Object.keys(run).forEach((key) => { run[key] = Math.min(all.b[key], Math.max(run[key], q[key])); o[key] = run[key]; }); at[d] = o; });
    return at; };
  const poolAt = {}; CG_LAW.dates.forEach((d) => { poolAt[d] = poolOf(rs.filter((x) => x.sale && x.sale <= d)); });
  const at = atOf("A", k);
  const differ = ["stApp", "s111A", "s112", "s112A"].some((x) => k.b[x] !== kB.b[x]) || k.cfStcl !== kB.cfStcl || k.cfLtcl !== kB.cfLtcl;
  const alt = differ ? Object.assign({ order: "B", setoff: kB.off, cfStcl: kB.cfStcl, cfLtcl: kB.cfLtcl, at: atOf("B", kB) }, kB.b, { total: kB.b.stApp + kB.b.s111A + kB.b.s112 + kB.b.s112A }) : null;
  rs.forEach((x) => { if (x.kind === "eq" && x.lt && x.acq < CG_LAW.gf && !(N((rows1.find((r) => r.id === x.id) || {}).fmv2018) > 0)) warn.push({ key: "cg_fmv_" + x.id, text: (x.desc || "An equity sale") + ": bought before 1-02-2018, the FMV on 31-01-2018 is not given (55(2)(ac)); the cost is taken as it is." }); });
  // a buy-back from 1-10-2024: the whole amount received is dividend (2(22)(f)), income from other sources
  const buybackDividend = R(sum(rows1.filter((r) => r.kind === "buyback" && String(r.sale || "") >= "20241001"), (r) => r.value));
  return Object.assign({ rows: rs, order: "A", setoff: k.off, cfStcl: k.cfStcl, cfLtcl: k.cfLtcl, pool112: poolOf(rs), at, poolAt, alt, buybackDividend, warn, needs, src: CG_LAW.src }, k.b, { total: k.b.stApp + k.b.s111A + k.b.s112 + k.b.s112A });
}
// the head as the computation chose it (tax.js keeps the short-term loss order with the lower tax: S.cgAlt)
export const cgAsChosen = (g, S) => (g && g.alt && S && S.cgAlt ? Object.assign({}, g, g.alt) : g);
