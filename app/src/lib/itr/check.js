// The second computation (the checker). Written apart from tax.js on purpose: it imports nothing, carries its own
// figures (typed again from the Act, not copied from law.js), and works step by step in plain code. The JSON is offered
// only when this and tax.js agree on every figure in KEYS, to the rupee (gate.js).
// It follows the same conventions as tax.js where the law leaves a choice (docs/ITR-MODULE.md, "Conventions"):
// rupee rounding of each tax figure (each special-rate part on its own), total income to the nearest 10, the final payable / refund to the nearest 10,
// interest month by month on the amount rounded down to 100, MAT shown in the tax heads when it is payable.
export const KEYS = ["gti", "ti", "sal", "hp", "cg", "normalTax", "specialTax", "rebate", "sur", "cess", "liability", "i234a", "i234b", "i234c", "f234f", "payable", "refund", "cfBus", "cfUd", "cfHp", "cfStcl", "cfLtcl", "bfHp", "bfStcl", "bfLtcl"];

function n(v) { v = Number(v); return isFinite(v) ? v : 0; }
function rup(v) { v = n(v); const s = v < 0 ? -1 : 1; const r = s * Math.round(Math.abs(v) + 1e-9); return r === 0 ? 0 : r; }
function ten(v) { v = n(v); const s = v < 0 ? -1 : 1; const r = s * Math.round(Math.abs(v) / 10 + 1e-9) * 10; return r === 0 ? 0 : r; }
function hundredDown(v) { v = n(v); return v <= 0 ? 0 : Math.floor(v / 100) * 100; }
function total(list) { let s = 0; for (const x of list || []) s += n(x && x.amt); return s; }

// slab tax written as plain bands
function slabNew(x) {
  let t = 0;
  if (x > 2400000) { t += (x - 2400000) * 0.3; x = 2400000; }
  if (x > 2000000) { t += (x - 2000000) * 0.25; x = 2000000; }
  if (x > 1600000) { t += (x - 1600000) * 0.2; x = 1600000; }
  if (x > 1200000) { t += (x - 1200000) * 0.15; x = 1200000; }
  if (x > 800000) { t += (x - 800000) * 0.1; x = 800000; }
  if (x > 400000) { t += (x - 400000) * 0.05; }
  return rup(t);
}
function slabOld(x, age, ent, resident) {
  let basic = 250000;
  if (ent === "P" && resident && age >= 80) basic = 500000; else if (ent === "P" && resident && age >= 60) basic = 300000;
  let t = 0;
  if (x > 1000000) { t += (x - 1000000) * 0.3; x = 1000000; }
  if (x > 500000) { t += (x - 500000) * 0.2; x = 500000; }
  if (x > basic) t += (x - basic) * 0.05;
  return rup(t);
}
function basicOf(inp) {
  if (inp.regime === "new") return 400000;
  if (inp.entity === "P" && inp.resident !== false && n(inp.age) >= 80) return 500000;
  if (inp.entity === "P" && inp.resident !== false && n(inp.age) >= 60) return 300000;
  return 250000;
}

// business income
function business(inp) {
  if (inp.presumptive && (inp.form === "ITR-4" || inp.presumptive.use)) {
    const p = inp.presumptive; let inc = 0;
    if (p.ad) inc += p.ad.declared != null ? n(p.ad.declared) : rup(n(p.ad.digital) * 6 / 100 + n(p.ad.other) * 8 / 100);
    if (p.ada) inc += p.ada.declared != null ? n(p.ada.declared) : rup(n(p.ada.receipts) / 2);
    if (p.ae && p.ae.vehicles && p.ae.vehicles.length) {
      let m = 0;
      for (const v of p.ae.vehicles) {
        const months = Math.min(12, Math.max(0, Math.ceil(n(v.months))));
        m += n(v.gvwKg) > 12000 ? Math.ceil(n(v.gvwKg) / 1000) * 1000 * months : 7500 * months;
      }
      inc += p.ae.declared != null ? n(p.ae.declared) : m;
    }
    return { inc: rup(inc), dep: 0, pres: !!(p.ad || p.ada) };
  }
  if (!inp.business) return { inc: 0, dep: 0, pres: false };
  const b = inp.business;
  let inc = rup(b.pbt);
  for (const a of b.adds || []) inc += rup(a.amt);
  for (const a of b.less || []) inc -= rup(a.amt);
  const dep = rup(b.itDep);
  if (b.itDep != null) inc -= dep;
  const firm = inp.entity === "F" || inp.entity === "A" || inp.entity === "B";
  if (firm && inp.partners && inp.partners.length) {
    let rem = 0, idle = 0, intAdd = 0;
    for (const p of inp.partners) {
      if (p.working === false) idle += n(p.remuneration); else rem += n(p.remuneration);
      if (n(p.rate) > 12 && n(p.interest) > 0) intAdd += n(p.interest) * (n(p.rate) - 12) / n(p.rate);
    }
    intAdd = rup(intAdd); rem = rup(rem); idle = rup(idle);
    inc += intAdd;
    const bookProfit = rup(inc - intAdd + rup(rem + idle) + intAdd);
    let limit;
    if (bookProfit <= 600000) limit = Math.max(300000, 0.9 * Math.max(0, bookProfit));
    else limit = Math.max(300000, 540000) + 0.6 * (bookProfit - 600000);
    limit = rup(limit);
    const extra = (rem > limit ? rem - limit : 0) + idle;
    inc += extra;
  }
  return { inc: rup(inc), dep, pres: false };
}

// what of a loss or of the unused basic exemption the special-rate income takes, in the order that costs the taxpayer
// least: 111A (20%); the 112 income on which tax is still charged (a property the proviso to 112(1)(a) covers, up to its
// indexed gain, and the other 112 gains at 12.5%); 112A above 1,25,000; then the 112 and 112A income that bore no tax
// anyway. v: {a: 111A, b: 112A, c: 112}; pool: the 112 sales [{g, i, el}]; noShort: a long-term loss (never 111A)
// ord "B": 112A above 1,25,000 first, then 112, then 111A; "C": 111A only down to keep (the 111A income whose tax the
// old regime's rebate of 87A still covers), then 112, 112A above 1,25,000, then the rest of 111A. live: stop before the
// income that bore no tax
function absorbSpecial(v, amt, pool, noShort, live0, ord, keep) {
  let tot = 0, live = 0;
  if (pool) for (const p of pool) if (p.g > 0) { tot += p.g; live += p.el ? Math.min(p.i > 0 ? p.i : 0, p.g) : p.g; }
  const grab = (k, cap) => { if (cap <= 0 || amt <= 0) return; const u = amt < cap ? amt : cap; v[k] -= u; amt -= u; };
  const still = () => (pool ? Math.min(v.c, live - (tot - v.c)) : v.c);
  if (ord === "B") { grab("b", v.b - 125000); grab("c", still()); if (!noShort) grab("a", v.a); }
  else if (ord === "C") { if (!noShort) grab("a", v.a - (keep || 0)); grab("c", still()); grab("b", v.b - 125000); if (!noShort) grab("a", v.a); }
  else { if (!noShort) grab("a", v.a); grab("c", still()); grab("b", v.b - 125000); }
  if (live0) return amt;
  grab("c", v.c);
  grab("b", v.b);
  return amt;
}
// the 112 tax: with the sales behind it (rel.pool), the proviso to 112(1)(a) on what is chargeable; an amount entered as
// it is, less the relief entered with it
function t112Of(c, rel) {
  if (rel && rel.pool) return tax112Again(rel.pool, c);
  const t = rup(c * 0.125), r = rup(rel && rel.rel);
  return t - (r < t ? r : t);
}
function taxParts(inp, ti, normal, s111A, s112A, s112, rel) {
  const ent = inp.entity;
  let nt, st, t111A = 0, t112 = 0;
  if (ent === "P" || ent === "H") {
    nt = inp.regime === "new" ? slabNew(normal) : slabOld(normal, n(inp.age), ent, inp.resident !== false);
    let unused = basicOf(inp) - normal; if (unused < 0) unused = 0;
    let a = s111A, b = s112A, c = s112;
    if (inp.resident !== false) {
      // the provisos to 111A(1), 112(1), 112A(2): the shortfall against the special-rate income, cheapest first
      const lo = inp._lo || {};
      const v = { a, b, c }; unused = absorbSpecial(v, unused, rel && rel.pool, false, false, lo.exO, lo.keepA); a = v.a; b = v.b; c = v.c;
    }
    t111A = rup(a * 0.2); t112 = t112Of(c, rel);
    st = t111A + t112 + rup(b > 125000 ? (b - 125000) * 0.125 : 0);
  } else if (ent === "C") {
    let rate = 0.25;
    if (inp.regime === "115BAA") rate = 0.22; else if (inp.smallCo === false) rate = 0.3;
    nt = rup(normal * rate);
    t111A = rup(s111A * 0.2); t112 = t112Of(s112, rel); st = t111A + t112 + rup(s112A > 125000 ? (s112A - 125000) * 0.125 : 0);
  } else {
    nt = rup(normal * 0.3);
    t111A = rup(s111A * 0.2); t112 = t112Of(s112, rel); st = t111A + t112 + rup(s112A > 125000 ? (s112A - 125000) * 0.125 : 0);
  }
  // rebate 87A
  // section 87A: new regime, total income (special-rate income in it) at most 12,00,000, the rebate up to 60,000 out of the
  // tax on normal income only; above 12,00,000 the tax is cut to the income above it, again only out of the normal tax.
  // Old regime: total income at most 5,00,000, up to 12,500, out of the tax on normal income, 111A and 112 (not 112A)
  let reb = 0;
  if (ent === "P" && inp.resident !== false) {
    if (inp.regime === "new") {
      if (ti <= 1200000) reb = nt < 60000 ? nt : 60000;
      else { let r = nt + st - (ti - 1200000); if (r < 0) r = 0; reb = r > nt ? nt : rup(r); }
    } else if (ti <= 500000) {
      const e = nt + t111A + t112; reb = e < 12500 ? e : 12500;
    }
  }
  return { nt, st, reb };
}
function surchargeRate(inp, ti) {
  const ent = inp.entity;
  if (ent === "C") {
    if (inp.regime === "115BAA") return { r: ti > 0 ? 0.1 : 0, at: 0 };
    if (ti > 100000000) return { r: 0.12, at: 100000000 };
    if (ti > 10000000) return { r: 0.07, at: 10000000 };
    return { r: 0, at: 0 };
  }
  if (ent === "F") return ti > 10000000 ? { r: 0.12, at: 10000000 } : { r: 0, at: 0 };
  let r = 0, at = 0;
  if (ti > 50000000) { r = 0.37; at = 50000000; } else if (ti > 20000000) { r = 0.25; at = 20000000; } else if (ti > 10000000) { r = 0.15; at = 10000000; } else if (ti > 5000000) { r = 0.1; at = 5000000; }
  if (inp.regime === "new" && r > 0.25) r = 0.25;
  return { r, at };
}
function surchargeOn(inp, parts, r) {
  const indlike = inp.entity !== "C" && inp.entity !== "F";
  const nt = Math.max(0, parts.nt - parts.reb), st = Math.max(0, parts.st - Math.max(0, parts.reb - parts.nt));
  return rup(nt * r + st * (indlike ? Math.min(r, 0.15) : r));
}
function grossTax(inp, ti, normal, a, b, c, rel) {
  const p = taxParts(inp, ti, normal, a, b, c, rel);
  const s = surchargeRate(inp, ti);
  let sur = s.r ? surchargeOn(inp, p, s.r) : 0;
  if (s.r && s.at) {
    // the same income cut down to the threshold: normal income first, then 112A, 112, 111A
    let cut = ti - s.at, nn = normal, aa = a, bb = b, cc = c;
    let u = Math.min(cut, nn); nn -= u; cut -= u;
    u = Math.min(cut, bb); bb -= u; cut -= u;
    u = Math.min(cut, cc); cc -= u; cut -= u;
    u = Math.min(cut, aa); aa -= u; cut -= u;
    const q = taxParts(inp, s.at, nn, aa, bb, cc, rel), s2 = surchargeRate(inp, s.at);
    const atThr = q.nt + q.st - q.reb + (s2.r ? surchargeOn(inp, q, s2.r) : 0);
    const mine = p.nt + p.st - p.reb + sur;
    if (mine > atThr + (ti - s.at)) sur = rup(sur - Math.min(sur, mine - atThr - (ti - s.at)));
  }
  const cess = rup((p.nt + p.st - p.reb + sur) * 0.04);
  return { nt: p.nt, st: p.st, reb: p.reb, sur, cess, tot: rup(p.nt + p.st - p.reb + sur + cess) };
}

function monthsCount(from, to) {
  if (!to || to <= from) return 0;
  const a = new Date(from.slice(0, 4) + "-" + from.slice(4, 6) + "-" + from.slice(6, 8) + "T00:00:00Z");
  const b = new Date(to.slice(0, 4) + "-" + to.slice(4, 6) + "-" + to.slice(6, 8) + "T00:00:00Z");
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() > a.getUTCDate()) m++;
  return m < 1 ? 1 : m;
}
function monthStart(from, k) {
  const y = +from.slice(0, 4), m = +from.slice(4, 6) - 1 + k, d = +from.slice(6, 8);
  const yy = y + Math.floor(m / 12), mm = m % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return String(yy) + String(mm + 1).padStart(2, "0") + String(Math.min(d, last)).padStart(2, "0");
}


// ---- the heads with schedules, worked again from the owner's rows (heads.js does the same for tax.js) ----
// salary: sections 15-17, the exemptions of section 10 (none of 10(5), 10(13A), 10(14) in the new regime), 16(ia)
// 75,000 new / 50,000 old (once, at most the salary), 16(ii) and 16(iii) in the old regime only
function salaryAgain(rows, regime) {
  const old = regime === "old";
  let net = 0, ent = 0, pt = 0, any = false;
  for (const r of rows || []) {
    any = true;
    const p1 = rup(r.s171), gross = p1 + rup(r.s172) + rup(r.s173);
    // rule 2A: "salary" is basic + DA; not given, nothing is worked on a guess (heads.js asks for it)
    const sal = r.basicDa != null && r.basicDa !== "" ? rup(r.basicDa) : 0;
    const govt = r.nature === "CGOV" || r.nature === "SGOV" || r.nature === "PE" || r.nature === "PESG";
    let ex = 0;
    for (const e of r.exempt || []) {
      let v = rup(e.amt);
      if (e.sec === "10(13A)" && r.hra) { const h = r.hra; const x1 = rup(h.received), x2 = rup(Math.max(0, n(h.rent) - sal / 10)), x3 = rup(sal * (h.metro ? 50 : 40) / 100); v = x1 < x2 ? (x1 < x3 ? x1 : x3) : (x2 < x3 ? x2 : x3); }
      if (!old && (e.sec === "10(5)" || e.sec === "10(13A)" || e.sec === "10(14)(i)" || e.sec === "10(14)(ii)")) v = 0;
      // 10(10)(i): a government employee's gratuity wholly exempt; 10(10)(iii) the others at most 20,00,000
      const cap = { "10(10)": govt ? Infinity : 2000000, "10(10AA)": govt ? Infinity : 2500000, "10(10C)": 500000, "10(10B)(i)": 500000, "10(10B)(ii)": 500000, "10(14)(ii)(115BAC)": 38400 }[e.sec];
      if (cap != null && v > cap) v = cap;
      if (v > p1 && !["10(10)", "10(10A)", "10(10AA)", "10(10C)"].includes(e.sec)) v = p1;
      ex += v;
    }
    if (ex > gross) ex = gross;
    net += gross - ex;
    if (old) { if (govt) ent += rup(Math.min(n(r.ent), 5000, sal / 5)); pt += rup(Math.min(Math.max(0, n(r.ptax)), 5000)); }
  }
  if (!any) return 0;
  const sd = Math.min(old ? 50000 : 75000, net);
  return Math.max(0, rup(net - sd - ent - pt));
}
// house property: annual value = rent - unrealised rent - municipal tax (23), the owner's share (26), 30% (24(a)),
// interest (24(b); self-occupied together at most 2,00,000 or 30,000, none in the new regime), arrears at 70% (25A)
function houseAgain(rows, regime) {
  let total = 0, room = null;
  for (const p of rows || []) {
    const sh = p.share == null || p.share === "" ? 100 : Math.min(100, Math.max(0, n(p.share)));
    let int = 0; for (const l of p.loans || []) int += rup(l.interest);
    int += rup(n(p.preConst) / 5);   // Explanation to 24(b): the pre-construction interest in five equal parts
    let inc = 0;
    if (p.kind === "S") {
      // second proviso to 24(b): 2,00,000 for all self-occupied houses together; first proviso: 30,000 for a house whose
      // loan is from before 1-04-1999
      if (room === null) room = 200000;
      let allow = regime === "old" && sh > 0 ? Math.min(int, room, p.oldLoan ? 30000 : 200000) : 0;
      if (regime === "old") room -= allow;
      inc = -allow;
    } else {
      const rent = rup(p.rent), unr = Math.min(rup(p.unrealised), rent), mt = rent > 0 ? rup(p.muniTax) : 0;
      const av = Math.max(0, rent - unr - mt), mine = rup(av * sh / 100);
      inc = mine - rup(mine * 3 / 10) - (sh > 0 ? int : 0);
    }
    total += inc + rup(n(p.arrears) * 7 / 10);
  }
  return rup(total);
}
// capital gains: long-term after 12 months (listed shares, equity funds, listed bonds, zero coupon bonds, listed
// shares bought back) or 24 (the rest), 50AA always short-term; 50C / 50CA full value; 55(2)(ac) for equity bought
// before 1-02-2018; 55(2)(b) FMV of 1-04-2001; improvements from 2001-02; exemptions at most the gain (54EC 50 lakh,
// 54 / 54F 10 crore, 54 / 54EC / 54F long-term only); 70(3) the long-term loss first against 112, 112A, then 70(2) the
// short-term loss against normal-rate, 111A, 112, 112A gains; the proviso to 112(1)(a) for land or building bought
// before 23-07-2024 by a resident individual / HUF: 12.5% above 20% with indexation ignored
const INDEX = [100, 105, 109, 113, 117, 122, 129, 137, 148, 167, 184, 200, 220, 240, 254, 264, 272, 280, 289, 301, 317, 331, 348, 363, 376];   // FY 2001-02 to 2025-26
function idxOf(fyStart) { let k = fyStart - 2001; if (k < 0) k = 0; if (k > INDEX.length - 1) k = INDEX.length - 1; return INDEX[k]; }
function fyStartOf(d) { const y = Number(String(d).slice(0, 4)), m = Number(String(d).slice(4, 6)); return m < 4 ? y - 1 : y; }
function heldLong(kind, acq, sale, listed) {
  if (kind === "mf50AA" || !acq || !sale) return false;
  const need = kind === "eq" || kind === "eqNoStt" || kind === "bond" || kind === "zcb" || (kind === "buyback" && listed !== false) ? 12 : 24;
  const y = Number(acq.slice(0, 4)), m = Number(acq.slice(4, 6)) - 1 + need, d = Number(acq.slice(6, 8));
  const yy = y + Math.floor(m / 12), mm = m % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const lim = String(yy) + String(mm + 1).padStart(2, "0") + String(d > last ? last : d).padStart(2, "0");
  return String(sale) > lim;
}
// the 54-series again: 54 (a residential house sold, the lower of the gain and the new house's cost), 54B (agricultural
// land used for agriculture in the two years before, the lower of the gain and the cost), 54F (a long-term asset other
// than a house: the gain in the proportion the cost of the new house bears to the net consideration, 54F(1)(b)); 54 / 54B /
// 54F only for an individual or HUF; the new house's cost counted up to 10 crore (54, 54F). The time limits: 54 / 54F
// "within a period of one year before or two years after", "constructed within three years"; 54B "within two years
// after"; or "deposited ... before the due date" of 139(1) in the Capital Gains Account Scheme (54(2), 54B(2), 54F(4)).
// 54EC: land or building, the bonds "within a period of six months after the date of such transfer", and not above
// 50 lakh in the year (first proviso to 54EC(1)): ecShare says how much of it each sale has
function plusMonths(d, k) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(4, 6)) - 1 + k, dd = Number(d.slice(6, 8));
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return String(yy) + String(mm + 1).padStart(2, "0") + String(dd > last ? last : dd).padStart(2, "0");
}
function claimsAgain(r, kind, lng, ent, ecShare, ecAsk, due) {
  const person = ent === "P" || ent === "H", out = [], sale = String(r.sale || "");
  for (const e of r.exempt || []) {
    const sec = String(e.sec || ""), d = String(e.date || ""), how = e.how || "bought";
    if (!lng && (sec === "54" || sec === "54EC" || sec === "54F")) continue;
    if (!person && (sec === "54" || sec === "54B" || sec === "54F")) continue;
    if (sec === "54" && !(kind === "land" && r.residential)) continue;
    if (sec === "54F" && kind === "land" && r.residential) continue;
    if ((sec === "54B" || sec === "54EC") && kind !== "land") continue;
    if (sec === "54B" && !r.agri) continue;
    if (sec === "54EC") {
      if (d && sale && (d < sale || d > plusMonths(sale, 6))) continue;
      if (ecAsk) { ecAsk[r.id] = (ecAsk[r.id] || 0) + rup(e.amt); continue; }
      let v = rup(e.amt); const have = ecShare[r.id] || 0; if (v > have) v = have; ecShare[r.id] = have - v;
      out.push({ sec, amt: v }); continue;
    }
    if (sec === "54" || sec === "54B" || sec === "54F") {
      if (d && sale) {
        let inTime;
        if (how === "cgas") inTime = d <= due;
        else if (how === "built") inTime = d >= sale && d <= plusMonths(sale, 36);
        else if (sec === "54B") inTime = d >= sale && d <= plusMonths(sale, 24);
        else inTime = d >= plusMonths(sale, -12) && d <= plusMonths(sale, 24);
        if (!inTime) continue;
      }
      let c = e.cost != null && e.cost !== "" ? rup(e.cost) : (sec === "54F" ? 0 : rup(e.amt));
      if (sec !== "54B" && c > 100000000) c = 100000000;
      out.push({ sec, cost: c }); continue;
    }
    out.push({ sec, amt: rup(e.amt) });
  }
  return out;
}
function claimOn(g, list, cons) {
  let room = g > 0 ? g : 0, t = 0;
  for (const c of list) {
    let v;
    if (c.sec === "54F") v = cons <= 0 ? 0 : c.cost >= cons ? (g > 0 ? g : 0) : (g > 0 ? g : 0) * c.cost / cons;
    else if (c.sec === "54" || c.sec === "54B") v = Math.min(g > 0 ? g : 0, c.cost);
    else v = Math.min(g > 0 ? g : 0, c.amt);
    v = rup(v > room ? room : v); room -= v; t += v;
  }
  return t;
}
// one sale: its full value, cost, gain, exemptions and (for land or building bought before 23-07-2024 by a resident
// individual / HUF) its gain with indexation
function saleAgain(r, ent, resident, ecShare, ecAsk, due) {
  const kind = r.kind || "other", acq = String(r.acq || ""), sale = String(r.sale || ""), lng = heldLong(kind, acq, sale, r.listed);
  const val = kind === "buyback" ? 0 : rup(r.value), sd = rup(r.sdv);
  let full = val; if (kind === "land" && sd > val * 1.1) full = sd; if (kind === "unlisted" && sd > val) full = sd;
  let cost = rup(r.cost);
  if (acq && acq < "20010401" && r.fmv2001 != null && r.fmv2001 !== "" && kind !== "eq") {
    cost = rup(r.fmv2001);
    // proviso to 55(2)(b): for land or building, not above the stamp duty value of 1-04-2001
    if (kind === "land" && r.sdv2001 != null && r.sdv2001 !== "" && rup(r.sdv2001) < cost) cost = rup(r.sdv2001);
  }
  const stt = (kind === "eq" && r.stt !== false) || (kind === "buyback" && r.listed !== false);
  let used = cost;
  if (stt && lng && acq && acq < "20180201" && n(r.fmv2018) > 0) { const f = rup(r.fmv2018), cap = f < full ? f : full; used = cost > cap ? cost : cap; }
  let imps = Array.isArray(r.improve) ? r.improve : r.improveCost ? [{ fy: String(fyStartOf(acq || "20200401")), amt: r.improveCost }] : [];
  imps = imps.filter((x) => Number(x.fy) >= 2001);
  let im = 0; for (const x of imps) im += n(x.amt); im = rup(im);
  const ex0 = rup(r.expenses), gain = full - used - im - ex0, cons = full - ex0;
  const cl = claimsAgain(r, kind, lng, ent, ecShare, ecAsk, due);
  const net = gain - claimOn(gain, cl, cons);
  const where = kind === "mf50AA" ? "o" : lng ? (stt ? "b" : "c") : (stt ? "a" : "o");
  let i = null;
  if (where === "c" && kind === "land" && lng && acq < "20240723" && (ent === "P" || ent === "H") && resident) {
    const s = idxOf(fyStartOf(sale)), base = idxOf(fyStartOf(acq) < 2001 ? 2001 : fyStartOf(acq));
    let ii = 0; for (const x of imps) ii += rup(n(x.amt) * s / idxOf(Number(x.fy)));
    const ig = full - rup(cost * s / base) - rup(ii) - ex0;
    i = ig - claimOn(ig, cl, cons);
  }
  return { id: r.id, where, net, i, sale };
}
function gainsAgain(rows, ent, resident, upto, order, due) {
  const list0 = (rows || []).map((r, k) => (r.id ? r : Object.assign({ id: "cg" + k }, r)));
  // the 54EC limit shared where the tax saved is the most: the sales the proviso to 112(1)(a) covers, up to their
  // indexed gain, then the other sales, then the rest of the covered ones
  const ask = {}, pre = list0.map((r) => saleAgain(r, ent, resident, {}, ask, due));
  const share = {}; let room = 5000000;
  const wantOf = (p) => Math.min(ask[p.id] || 0, p.net > 0 ? p.net : 0);
  const give = (p, cap) => { const u = Math.max(0, Math.min(room, cap)); share[p.id] = (share[p.id] || 0) + u; room -= u; };
  for (const p of pre) if (p.i != null && wantOf(p) > 0) give(p, Math.min(wantOf(p), p.i > 0 ? p.i : 0));
  for (const p of pre) if (p.i == null && wantOf(p) > 0) give(p, wantOf(p));
  for (const p of pre) if (p.i != null && wantOf(p) > 0) give(p, wantOf(p) - (share[p.id] || 0));
  const sales = list0.map((r) => saleAgain(r, ent, resident, Object.assign({}, share), null, due));
  const one = (ss) => {
    // within each of the form's categories the gains and losses net: 20% (a), applicable rates (o), 12.5% (b: 112A, c: 112)
    let a = 0, o = 0, b = 0, c = 0, lt = 0, cap = 0;
    const pool = [];
    for (const x of ss) {
      if (x.where === "a") a += x.net; else if (x.where === "o") o += x.net;
      else if (x.net < 0) lt -= x.net;
      else if (x.where === "b") b += x.net;
      else { c += x.net; pool.push({ g: rup(x.net), i: x.i == null ? null : rup(x.i), el: x.i != null }); cap += x.i == null ? x.net : Math.min(x.i > 0 ? x.i : 0, x.net); }
    }
    // 70(3): the long-term loss against 112 while it still saves tax there, then 112A above 1,25,000, then the rest
    let cut112 = 0;
    const onLong = (loss) => {
      let u = Math.max(0, Math.min(loss, c, cap - cut112)); c -= u; cut112 += u; loss -= u;
      u = Math.max(0, Math.min(loss, b - 125000)); b -= u; loss -= u;
      u = Math.max(0, Math.min(loss, c)); c -= u; cut112 += u; loss -= u;
      u = Math.max(0, Math.min(loss, b)); b -= u; loss -= u;
      return loss;
    };
    lt = onLong(lt);
    // 70(2): a short-term loss: the other short-term category and the long-term gains, in the order asked
    let la = a < 0 ? -a : 0, lo = o < 0 ? -o : 0; if (a < 0) a = 0; if (o < 0) o = 0;
    const onShort = (loss, toA) => { const have = toA ? a : o, u = Math.min(loss, have); if (toA) a -= u; else o -= u; return loss - u; };
    if (order === "B") { lo = onShort(onLong(lo), true); la = onShort(onLong(la), false); }
    else { lo = onLong(onShort(lo, true)); la = onLong(onShort(la, false)); }
    return { a: rup(a), b: rup(b), c: rup(c), o: rup(o), pool, stl: rup(la + lo), ltl: rup(lt) };
  };
  const all = one(sales);
  // 2(22)(f): the money of a buy-back (from 1-10-2024) is dividend
  let bbd = 0; for (const r of list0) if (r.kind === "buyback" && String(r.sale || "") >= "20241001") bbd += rup(r.value);
  all.bbd = bbd;
  if (!upto) return all;
  // what had accrued by a date: the gains of the sales up to it, never more than the year's and never less than at the
  // instalment before
  const run = { a: 0, b: 0, c: 0, o: 0, pool: [] };
  for (const d of ["20250615", "20250915", "20251215", "20260315", "20260331"]) {
    if (d > upto) break;
    const q = one(sales.filter((x) => x.sale && x.sale <= d));
    for (const k of ["a", "b", "c", "o"]) run[k] = Math.min(all[k], Math.max(run[k], q[k]));
    run.pool = q.pool;
  }
  return run;
}
// the proviso to 112(1)(a), read on the long-term capital gain that is part of the total income: "the tax on such
// long-term capital gains computed at 12.5% (without indexation) exceeds the tax computed at 20% (with indexation),
// such excess shall be ignored". c: the 112 income left in the total income. Whatever came off the 112 gains (losses
// set off, the unused basic exemption) is put where it saves the most: on a covered property up to its indexed gain,
// then on the other 112 gains, then on the rest of the covered property. Rounded once, at the end
function tax112Again(pool, c) {
  const cov = [], whole = rup(c * 0.125);
  let plain = 0, all = 0;
  for (const p of pool || []) { if (!(p.g > 0)) continue; all += p.g; if (p.el) cov.push({ g: p.g, i: p.i < 0 ? 0 : p.i > p.g ? p.g : p.i, off: 0 }); else plain += p.g; }
  if (!cov.length) return whole;
  let gone = all - c; if (gone < 0) gone = 0;
  for (const p of cov) { const u = gone < p.i ? gone : p.i; p.off += u; gone -= u; }
  { const u = gone < plain ? gone : plain; plain -= u; gone -= u; }
  for (const p of cov) { const room = p.g - p.off, u = gone < room ? gone : room; p.off += u; gone -= u; }
  let t = plain * 0.125;
  for (const p of cov) { const x = (p.g - p.off) * 0.125, y = (p.i - p.off > 0 ? p.i - p.off : 0) * 0.2; t += x < y ? x : y; }
  t = rup(t);
  return t < whole ? t : whole;
}

// a short-term capital loss may go first against the other short-term gains or against the long-term gains; the slab
// decides which costs less, so both are worked and the lower liability kept
// the same for a loss of another head (business loss, house property loss, unabsorbed depreciation): against the
// normal-rate income down to a slab limit, then the special-rate income in one of its orders (absorbSpecial), then the
// rest; and the order the unused basic exemption takes the special-rate income. Every order is tried with each loss's
// limits in turn and the lowest liability kept (the earlier one on a tie). Limits and orders as in tax.js, typed here again
const LIMITS = [0, 250000, 300000, 400000, 500000, 800000, 1000000, 1200000, 1600000, 2000000, 2400000, Infinity];
export function check(inp) {
  inp = inp || {};
  if (inp._lo && (inp._order || !inp.cgRows)) return checkOne(inp, inp._order || "A");
  if (inp._lo) { const x = checkOne(inp, "A"), y = checkOne(inp, "B"); return y.liability < x.liability ? y : x; }
  let out = null;
  for (const ord of inp.cgRows ? ["A", "B"] : ["A"]) {
    const go = (lo) => checkOne(Object.assign({}, inp, { _lo: lo, _order: inp.cgRows ? ord : undefined }), ord);
    const lo0 = { bus: 0, hp: 0, ud: 0, busO: "A", hpO: "A", udO: "A", exO: "A", keepA: 62500 }, first = go(lo0);
    let cur = first;
    const kinds = ["bus", "hp", "ud"].filter((k) => first.spent[k] > 0);
    const flags = kinds.map((k) => k + "O"); if (first.spec > 0) flags.push("exO");
    const opts = inp.entity === "P" && inp.regime !== "new" && inp.resident !== false && first.ti <= 1500000 ? ["A", "B", "C"] : ["A", "B"];
    let m = 0; const total = Math.pow(opts.length, flags.length);
    while (m < total) {
      let lo = Object.assign({}, lo0); let q = m; for (const f of flags) { lo[f] = opts[q % opts.length]; q = Math.floor(q / opts.length); }
      let here = m === 0 ? first : go(lo);
      // two or more losses: first the same limit for all of them, then each in turn
      if (kinds.length >= 2) for (const T of LIMITS) { const l2 = Object.assign({}, lo); for (const k of kinds) l2[k] = T; const t = go(l2); if (t.liability < here.liability) { here = t; lo = l2; } }
      for (const k of kinds) for (const T of LIMITS) { if (T === lo[k]) continue; const l2 = Object.assign({}, lo); l2[k] = T; const t = go(l2); if (t.liability < here.liability) { here = t; lo = l2; } }
      if (here.liability < cur.liability) cur = here;
      m++;
    }
    if (!out || cur.liability < out.liability) out = cur;
  }
  return out;
}
function checkOne(inp, order) {
  const ent = inp.entity;
  const dueC0 = inp.tp ? "20261130" : (inp.audit || ent === "C") ? "20261031" : "20260831";
  const bz = business(inp);
  const sal = inp.salaryRows ? salaryAgain(inp.salaryRows, inp.regime) : inp.salary ? Math.max(0, rup(inp.salary.net != null ? inp.salary.net : n(inp.salary.gross) - n(inp.salary.std))) : 0;
  let hp = inp.houseRows ? houseAgain(inp.houseRows, inp.regime) : inp.hp != null ? rup(inp.hp) : 0;
  const hp0 = hp;
  const cg0 = inp.cg || {};
  const cgx = inp.cgRows ? gainsAgain(inp.cgRows, ent, inp.resident !== false, null, order, dueC0) : { a: rup(cg0.s111A), b: rup(cg0.s112A), c: rup(cg0.s112), o: rup(cg0.other), rel: rup(cg0.relief112), pool: cg0._pool || null, stl: rup(cg0.cfStcl), ltl: rup(cg0.cfLtcl), bbd: null };
  // other sources: what the model holds, the buy-back's dividend worked here again from the sales
  let os = 0; if (inp.os) for (const k of Object.keys(inp.os)) if (typeof inp.os[k] === "number" && !(k === "buyback" && cgx.bbd != null)) os += inp.os[k];
  os = rup(os + n(cgx.bbd));
  const relQ = { rel: cgx.rel, pool: cgx.pool };
  let a = cgx.a, b = cgx.b, c = cgx.c, o = cgx.o, bp = bz.inc;
  const a0 = a, b0 = b, c0 = c, o0 = o;
  const cgHead = a + b + c + o;
  // this year's losses; what is left is carried forward: up to the year's depreciation as unabsorbed depreciation
  // (32(2), carried without limit, even in a belated return), the rest as business loss (72; none in a belated return, 80)
  const dueC = inp.tp ? "20261130" : (inp.audit || ent === "C") ? "20261031" : "20260831", lateC = !!inp.filingDate && inp.filingDate > dueC;
  let cfBus = 0, cfUd = 0, cfHp = 0;
  let s = sal;
  const LO = inp._lo || { bus: 0, hp: 0, ud: 0 }, spent = { bus: 0, hp: 0, ud: 0 };
  // a loss of another head: the normal-rate income down to the limit T, the special-rate income still taxed, the rest
  // of the normal-rate income, then the special-rate income that bore no tax. names: the heads this loss may take
  const spend = (amt, names, T, ord) => {
    const w = { s, hp, bp, os, o };
    const fromN = (cap) => { for (const k of names) { if (amt <= 0 || cap <= 0) break; const u = Math.min(Math.max(w[k], 0), amt, cap); w[k] -= u; amt -= u; cap -= u; } };
    fromN(Math.max(0, Math.max(w.s, 0) + Math.max(w.hp, 0) + Math.max(w.bp, 0) + Math.max(w.os, 0) + Math.max(w.o, 0) - T));
    const v = { a, b, c };
    amt = absorbSpecial(v, amt, cgx.pool, false, true, ord, LO.keepA);
    fromN(Infinity);
    amt = absorbSpecial(v, amt, cgx.pool, false, false, ord, LO.keepA);
    s = w.s; hp = w.hp; bp = w.bp; os = w.os; o = w.o; a = v.a; b = v.b; c = v.c;
    return amt;
  };
  if (bp < 0) {
    let loss = -bp; bp = 0;
    // 71(2A): never against salary
    const l0 = loss; loss = spend(loss, ["hp", "os", "o"], LO.bus, LO.busO); spent.bus = l0 - loss;
    cfUd = Math.min(loss, bz.dep); cfBus = lateC ? 0 : loss - cfUd;
  }
  if (hp < 0) {
    const hl = -hp;
    let room = inp.regime === "new" ? 0 : Math.min(-hp, 200000); hp = 0;
    const room0 = room;
    // 71(3A): salary and the normal-rate heads (business last: 72 can set a loss brought forward only against it)
    room = spend(room, ["s", "os", "o", "bp"], LO.hp, LO.hpO); spent.hp = room0 - room;
    cfHp = hl - (room0 - room);
  }
  // brought forward
  const L = inp.losses || {};
  const bfl = (L.business || []).slice().sort((x, y) => String(x.ay) < String(y.ay) ? -1 : 1);
  // 115BAC(2)(ii) / 115BAA(2)(ii): under the new regime (a company under 115BAA) no set-off of the part of a loss brought
  // forward that is attributable to the deductions those sections bar
  const bars = ((ent === "P" || ent === "H") && inp.regime === "new") || (ent === "C" && inp.regime === "115BAA");
  const usable = (x) => { const amt = Math.max(0, n(x.amt)), bar = bars ? Math.min(amt, Math.max(0, n(x.barred))) : 0; return amt - bar; };
  for (const x of bfl) { if (2026 - +String(x.ay).slice(0, 4) > 8 || x.inTime === false) continue; const u = Math.min(bp, usable(x)); bp -= u; }
  // 71B (house property, eight years, against house property) and 74 (capital losses, eight years: short-term against
  // any gain, long-term against long-term)
  // section 80: no business or capital loss of a year whose return was not filed by its due date (71B is not in it)
  const live = (list, isHp) => (list || []).filter((x) => 2026 - +String(x.ay).slice(0, 4) <= 8 && (isHp || x.inTime !== false)).sort((x, y) => String(x.ay) < String(y.ay) ? -1 : 1);
  let bfHp = 0, bfSt = 0, bfLt = 0;
  for (const x of live(L.hp, true)) { const u = Math.min(Math.max(hp, 0), usable(x)); hp -= u; bfHp += u; }
  for (const x of live(L.stcl)) {
    let left = Math.max(0, n(x.amt));
    const u = Math.min(Math.max(o, 0), left); o -= u; left -= u; bfSt += u;
    const v = { a, b, c }, l2 = absorbSpecial(v, left, cgx.pool, false); bfSt += left - l2; a = v.a; b = v.b; c = v.c;
  }
  for (const x of live(L.ltcl)) {
    let left = Math.max(0, n(x.amt));
    const v = { a, b, c }, l2 = absorbSpecial(v, left, cgx.pool, true); bfLt += left - l2; a = v.a; b = v.b; c = v.c;
  }
  // 32(2): unabsorbed depreciation of earlier years, year by year when given (no time limit), less what was additional
  // depreciation under the new regime (115BAC(2)(ii))
  let ud = 0;
  if ((L.ud || []).some((x) => n(x.amt) > 0)) { for (const x of L.ud) if (n(x.amt) > 0) ud += usable(x); } else ud = n(L.unabsorbedDep);
  // 32(2): any head but salary
  if (ud > 0) { const u0 = ud; ud = spend(ud, ["bp", "hp", "os", "o"], LO.ud, LO.udO); spent.ud = u0 - ud; }
  const spec = a + b + c;
  const gti = rup(s + hp + bp + os + o + spec);
  // deductions (Chapter VI-A), each section's limit typed here again from the Act
  const d = inp.deductions || {};
  let ded = 0;
  const age = n(inp.age), senior = age >= 60;
  // 80CCD(2): "salary" is basic + DA (Explanation to 80CCD); from the employers' rows themselves when there are rows
  // (every one must give it), else the figure entered; not given, nothing is allowed until it is
  let salPay = 0;
  if (inp.salaryRows && inp.salaryRows.length) { if (inp.salaryRows.every((r) => r.basicDa != null && r.basicDa !== "")) for (const r of inp.salaryRows) salPay += rup(r.basicDa); }
  else if (inp.salary) salPay = n(inp.salary.basicDa);
  const lim = (v, m) => { v = n(v); return v < 0 ? 0 : v > m ? m : v; };
  const gifts = Array.isArray(d["80G"]) ? d["80G"] : n(d["80G"]) ? [{ amt: n(d["80G"]), pct: 100, qualifying: false }] : [];
  let may;   // the sections this person may take, or null for the old regime's full list
  if (ent === "P" || ent === "H") may = inp.regime === "new" ? { "80CCD2": 1, "80CCH": 1, "80JJAA": 1 } : null;
  else if (ent === "C") may = inp.regime === "115BAA" ? { "80JJAA": 1, "80M": 1 } : { "80G": 1, "80GGA": 1, "80GGB": 1, "80JJAA": 1, "80IA": 1, "80IAB": 1, "80IAC": 1, "80IB": 1, "80IBA": 1, "80IC": 1, "80LA": 1, "80M": 1, "80PA": 1 };
  else may = { "80G": 1, "80GGA": 1, "80GGC": 1, "80JJAA": 1, "80IA": 1, "80IAB": 1, "80IAC": 1, "80IB": 1, "80IBA": 1, "80IC": 1, "80LA": 1 };
  const can = (k) => may === null || may[k] === 1;
  const done = {};
  for (const key of Object.keys(d)) {
    if (!/^80/.test(key)) continue;
    const k = key.split("_")[0];
    if (done[k] || !can(k)) continue;
    done[k] = 1;
    if (k === "80C" || k === "80CCC" || k === "80CCD1") ded += 0;
    else if (k === "80CCD1B") ded += lim(d[k], 50000);
    else if (k === "80CCD2") { let pc = 10; if (inp.regime === "new" || (ent !== "P" && ent !== "H") || d.govtEmployer) pc = 14; ded += lim(d[k], rup(salPay * pc / 100)); }
    else if (k === "80D") { ded += lim(d["80D_self"], senior || d.selfSenior ? 50000 : 25000) + lim(d["80D_parents"], d.parentsSenior ? 50000 : 25000); }
    else if (k === "80DD") ded += lim(d[k], d.ddSevere ? 125000 : 75000);
    else if (k === "80DDB") ded += lim(d[k], d.ddbSenior || senior ? 100000 : 40000);
    else if (k === "80U") ded += lim(d[k], d.uSevere ? 125000 : 75000);
    else if (k === "80TTA") ded += senior ? 0 : lim(d[k], 10000);
    else if (k === "80TTB") ded += senior ? lim(d[k], 50000) : 0;
    else if (k === "80GG") ded += lim(d[k], 60000);
    else if (k === "80EE") ded += lim(d[k], 50000);
    else if (k === "80EEA" || k === "80EEB") ded += lim(d[k], 150000);
    else if (k === "80G") ded += 0;
    else ded += n(d[k]);
  }
  if (can("80C") && (n(d["80C"]) || n(d["80CCC"]) || n(d["80CCD1"]))) ded += lim(n(d["80C"]) + n(d["80CCC"]) + n(d["80CCD1"]), 150000);
  if (can("80G") && gifts.length) {
    const ok = gifts.filter((x) => !(n(x.cash) > 2000));
    let qual = 0; for (const x of ok) if (x.qualifying) qual += n(x.amt);
    let room = gti - spec - ded; if (room < 0) room = 0;
    let left = Math.min(qual, rup(room * 0.1)), g = 0;
    for (const x of ok) if (!x.qualifying) g += n(x.amt) * n(x.pct || 100) / 100;
    for (const x of ok) if (x.qualifying) { const u = Math.min(n(x.amt), left); left -= u; g += u * n(x.pct || 100) / 100; }
    ded += rup(g);
  }
  ded = rup(ded);
  if (ded > gti - spec) ded = rup(Math.max(0, gti - spec));
  const ti = ten(Math.max(0, gti - ded));
  const normal = Math.max(0, ti - spec);
  let g = grossTax(inp, ti, normal, a, b, c, relQ);
  let out = { normalTax: g.nt, specialTax: g.st, rebate: g.reb, sur: g.sur, cess: g.cess }, liability = g.tot;
  // MAT
  if (ent === "C" && inp.regime !== "115BAA" && inp.bookProfit != null) {
    const bkp = rup(inp.bookProfit), m15 = rup(Math.max(0, bkp) * 0.15);
    let r = 0, at = 0; if (bkp > 100000000) { r = 0.12; at = 100000000; } else if (bkp > 10000000) { r = 0.07; at = 10000000; }
    let ms = rup(m15 * r);
    if (r) {
      const base = rup(at * 0.15), lr = at > 10000000 ? 0.07 : 0, atT = base + rup(base * lr);
      if (m15 + ms > atT + bkp - at) ms = rup(Math.max(0, atT + bkp - at - m15));
    }
    const matTotal = rup(m15 + ms + rup((m15 + ms) * 0.04));
    if (matTotal > liability) { out = { normalTax: m15, specialTax: 0, rebate: 0, sur: ms, cess: rup((m15 + ms) * 0.04) }; liability = matTotal; }
    else liability = rup(liability - Math.min(n(inp.matCredit), liability - matTotal));
  }
  // paid
  const P = inp.paid || {};
  const tds = rup(total(P.tds) + total(P.tdsSal)), tcs = rup(total(P.tcs)), adv = rup(total(P.advance)), sat = rup(total(P.selfAssessment));
  const due = inp.tp ? "20261130" : (inp.audit || ent === "C") ? "20261031" : "20260831";
  const filing = inp.filingDate || due;
  const assessed = Math.max(0, liability - tds - tcs);
  const saList = P.selfAssessment || [];
  const saBy = (date) => { let x = 0; for (const p of saList) if (String(p.date) <= date) x += n(p.amt); return x; };
  let i234a = 0, i234b = 0, i234c = 0, f234f = 0;
  if (filing > due && !inp.noInterest) {
    const m = monthsCount(due, filing);
    for (let k = 0; k < m; k++) i234a += hundredDown(assessed - adv - saBy(monthStart(due, k))) / 100;
    i234a = rup(i234a);
    f234f = ti <= 500000 ? 1000 : 5000;
  }
  if (assessed >= 10000 && adv < assessed * 0.9 && !inp.noInterest) {
    const m = monthsCount("20260331", filing);
    for (let k = 0; k < m; k++) i234b += hundredDown(assessed - adv - saBy(monthStart("20260331", k))) / 100;
    i234b = rup(i234b);
  }
  if (assessed >= 10000 && !inp.noInterest) {
    const advBy = (date) => { let x = 0; for (const p of P.advance || []) if (String(p.date) <= date) x += n(p.amt); return x; };
    // proviso (a) to 234C: an instalment is on the income as it stood on its date (the capital gains accrued by then)
    // when the tax on the later gains was paid by the remaining instalments up to 31 March
    const baseOn = (date) => {
      if (!inp.cgRows) return assessed;
      const g2 = gainsAgain(inp.cgRows, ent, inp.resident !== false, date, order, dueC0);
      if (g2.a === a0 && g2.b === b0 && g2.c === c0 && g2.o === o0) return assessed;
      const lw = check(Object.assign({}, inp, { cgRows: null, os: Object.assign({}, inp.os, { buyback: n(cgx.bbd != null ? cgx.bbd : (inp.os || {}).buyback) }), cg: { s111A: g2.a, s112A: g2.b, s112: g2.c, other: g2.o, _pool: g2.pool }, paid: {}, noInterest: true })).liability;
      return advBy("20260331") - advBy(date) >= liability - lw ? Math.max(0, lw - tds - tcs) : assessed;
    };
    if (bz.pres) i234c = rup(hundredDown(baseOn("20260315") - advBy("20260315")) / 100);
    else {
      const jun = advBy("20250615"), sep = advBy("20250915"), dec = advBy("20251215"), mar = advBy("20260315");
      const bj = baseOn("20250615"), bs = baseOn("20250915"), bd = baseOn("20251215"), bm = baseOn("20260315");
      if (!(jun >= 0.12 * bj)) i234c += rup(hundredDown(0.15 * bj - jun) * 3 / 100);
      if (!(sep >= 0.36 * bs)) i234c += rup(hundredDown(0.45 * bs - sep) * 3 / 100);
      i234c += rup(hundredDown(0.75 * bd - dec) * 3 / 100);
      i234c += rup(hundredDown(bm - mar) / 100);
    }
  }
  const net = liability + i234a + i234b + i234c + f234f - tds - tcs - adv - sat;
  return Object.assign(out, { sal, hp: hp0, cg: cgHead, cfStcl: lateC ? 0 : cgx.stl, cfLtcl: lateC ? 0 : cgx.ltl, spent, spec, cfBus: rup(cfBus), cfUd: rup(cfUd), cfHp: rup(cfHp), bfHp: rup(bfHp), bfStcl: rup(bfSt), bfLtcl: rup(bfLt), gti, ti, liability, i234a, i234b, i234c, f234f, payable: net > 0 ? ten(net) : 0, refund: net < 0 ? ten(-net) : 0 });
}

// the two computations side by side: [] when they agree on every figure
export function differences(a, b) {
  const out = [];
  for (const k of KEYS) if (n(a[k]) !== n(b[k])) out.push({ key: k, main: n(a[k]), check: n(b[k]), diff: n(a[k]) - n(b[k]) });
  return out;
}
