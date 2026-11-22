// The second computation (the checker). Written apart from tax.js on purpose: it imports nothing, carries its own
// figures (typed again from the Act, not copied from law.js), and works step by step in plain code. The JSON is offered
// only when this and tax.js agree on every figure in KEYS, to the rupee (gate.js).
// It follows the same conventions as tax.js where the law leaves a choice (docs/ITR-MODULE.md, "Conventions"):
// rupee rounding of each tax figure, total income to the nearest 10, the final payable / refund to the nearest 10,
// interest month by month on the amount rounded down to 100, MAT shown in the tax heads when it is payable.
export const KEYS = ["gti", "ti", "normalTax", "specialTax", "rebate", "sur", "cess", "liability", "i234a", "i234b", "i234c", "f234f", "payable", "refund"];

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
    return { inc: rup(inc), dep: 0, pres: true };
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

function taxParts(inp, ti, normal, s111A, s112A, s112) {
  const ent = inp.entity;
  let nt, st;
  if (ent === "P" || ent === "H") {
    nt = inp.regime === "new" ? slabNew(normal) : slabOld(normal, n(inp.age), ent, inp.resident !== false);
    let unused = basicOf(inp) - normal; if (unused < 0) unused = 0;
    let a = s111A, b = s112A, c = s112;
    if (inp.resident !== false) {
      let u = Math.min(unused, c); c -= u; unused -= u;
      u = Math.min(unused, a); a -= u; unused -= u;
      u = Math.min(unused, b); b -= u; unused -= u;
    }
    st = rup(a * 0.2 + (b > 125000 ? (b - 125000) * 0.125 : 0) + c * 0.125);
  } else if (ent === "C") {
    let rate = 0.25;
    if (inp.regime === "115BAA") rate = 0.22; else if (inp.smallCo === false) rate = 0.3;
    nt = rup(normal * rate);
    st = rup(s111A * 0.2 + (s112A > 125000 ? (s112A - 125000) * 0.125 : 0) + s112 * 0.125);
  } else {
    nt = rup(normal * 0.3);
    st = rup(s111A * 0.2 + (s112A > 125000 ? (s112A - 125000) * 0.125 : 0) + s112 * 0.125);
  }
  // rebate 87A
  let reb = 0;
  if (ent === "P" && inp.resident !== false) {
    if (inp.regime === "new") {
      if (normal <= 1200000) reb = Math.min(nt, 60000);
      else if (nt > normal - 1200000) reb = rup(nt - (normal - 1200000));
    } else if (ti <= 500000) {
      reb = Math.min(nt + rup(s111A * 0.2), nt + st, 12500);
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
function grossTax(inp, ti, normal, a, b, c) {
  const p = taxParts(inp, ti, normal, a, b, c);
  const s = surchargeRate(inp, ti);
  let sur = s.r ? surchargeOn(inp, p, s.r) : 0;
  if (s.r && s.at) {
    // the same income cut down to the threshold: normal income first, then 112A, 112, 111A
    let cut = ti - s.at, nn = normal, aa = a, bb = b, cc = c;
    let u = Math.min(cut, nn); nn -= u; cut -= u;
    u = Math.min(cut, bb); bb -= u; cut -= u;
    u = Math.min(cut, cc); cc -= u; cut -= u;
    u = Math.min(cut, aa); aa -= u; cut -= u;
    const q = taxParts(inp, s.at, nn, aa, bb, cc), s2 = surchargeRate(inp, s.at);
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

export function check(inp) {
  inp = inp || {};
  const ent = inp.entity;
  const bz = business(inp);
  const sal = inp.salary ? Math.max(0, rup(n(inp.salary.gross) - n(inp.salary.std))) : 0;
  let hp = inp.hp != null ? rup(inp.hp) : 0;
  let os = 0; if (inp.os) for (const k of Object.keys(inp.os)) if (typeof inp.os[k] === "number") os += inp.os[k];
  os = rup(os);
  const cg = inp.cg || {};
  let a = rup(cg.s111A), b = rup(cg.s112A), c = rup(cg.s112), o = rup(cg.other), bp = bz.inc;
  // this year's losses
  if (bp < 0) {
    let loss = -bp; bp = 0;
    const take = (v) => { const u = Math.min(Math.max(v, 0), loss); loss -= u; return v - u; };
    hp = take(hp); os = take(os); o = take(o); c = take(c); a = take(a); b = take(b);
  }
  let s = sal;
  if (hp < 0) {
    let room = inp.regime === "new" ? 0 : Math.min(-hp, 200000); hp = 0;
    const take = (v) => { const u = Math.min(Math.max(v, 0), room); room -= u; return v - u; };
    os = take(os); bp = take(bp); o = take(o); c = take(c); a = take(a); b = take(b); s = take(s);
  }
  // brought forward
  const L = inp.losses || {};
  const bfl = (L.business || []).slice().sort((x, y) => String(x.ay) < String(y.ay) ? -1 : 1);
  for (const x of bfl) { if (2026 - +String(x.ay).slice(0, 4) > 8) continue; const u = Math.min(bp, n(x.amt)); bp -= u; }
  let ud = n(L.unabsorbedDep);
  for (const k of ["bp", "hp", "os", "o", "c", "a", "b"]) {
    if (ud <= 0) break;
    const v = { bp, hp, os, o, c, a, b }[k]; if (v <= 0) continue;
    const u = Math.min(v, ud); ud -= u;
    if (k === "bp") bp -= u; else if (k === "hp") hp -= u; else if (k === "os") os -= u; else if (k === "o") o -= u; else if (k === "c") c -= u; else if (k === "a") a -= u; else b -= u;
  }
  const spec = a + b + c;
  const gti = rup(s + hp + bp + os + o + spec);
  // deductions
  const d = inp.deductions || {};
  let ded = 0;
  if (inp.regime === "new" || ent === "C" || ent === "F") {
    const ok = ent === "C" || ent === "F" ? ["80G", "80GGB", "80GGC", "80JJAA", "80IAC"] : ["80CCD2", "80CCH", "80JJAA"];
    for (const k of Object.keys(d)) if (ok.includes(k)) ded += n(d[k]);
  } else {
    const senior = n(inp.age) >= 60;
    ded += Math.min(n(d["80C"]), 150000) + Math.min(n(d["80CCD1B"]), 50000);
    ded += Math.min(n(d["80D"]), senior ? 100000 : 75000);
    ded += senior ? Math.min(n(d["80TTB"]), 50000) : Math.min(n(d["80TTA"]), 10000);
    ded += Math.min(n(d["80GG"]), 60000);
    for (const k of ["80G", "80E", "80CCD2", "80DD", "80DDB", "80U", "80GGC", "80JJAA"]) ded += n(d[k]);
  }
  ded = rup(ded);
  if (ded > gti - spec) ded = rup(Math.max(0, gti - spec));
  const ti = ten(Math.max(0, gti - ded));
  const normal = Math.max(0, ti - spec);
  let g = grossTax(inp, ti, normal, a, b, c);
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
  const tds = rup(total(P.tds)), tcs = rup(total(P.tcs)), adv = rup(total(P.advance)), sat = rup(total(P.selfAssessment));
  const due = inp.tp ? "20261130" : (inp.audit || ent === "C") ? "20261031" : "20260831";
  const filing = inp.filingDate || due;
  const assessed = Math.max(0, liability - tds - tcs);
  const saList = P.selfAssessment || [];
  const saBy = (date) => { let x = 0; for (const p of saList) if (String(p.date) <= date) x += n(p.amt); return x; };
  let i234a = 0, i234b = 0, i234c = 0, f234f = 0;
  if (filing > due) {
    const m = monthsCount(due, filing);
    for (let k = 0; k < m; k++) i234a += hundredDown(assessed - adv - saBy(monthStart(due, k))) / 100;
    i234a = rup(i234a);
    f234f = ti <= 500000 ? 1000 : 5000;
  }
  if (assessed >= 10000 && adv < assessed * 0.9) {
    const m = monthsCount("20260331", filing);
    for (let k = 0; k < m; k++) i234b += hundredDown(assessed - adv - saBy(monthStart("20260331", k))) / 100;
    i234b = rup(i234b);
  }
  if (assessed >= 10000) {
    const advBy = (date) => { let x = 0; for (const p of P.advance || []) if (String(p.date) <= date) x += n(p.amt); return x; };
    if (bz.pres) i234c = rup(hundredDown(assessed - advBy("20260315")) / 100);
    else {
      const jun = advBy("20250615"), sep = advBy("20250915"), dec = advBy("20251215"), mar = advBy("20260315");
      if (!(jun >= 0.12 * assessed)) i234c += rup(hundredDown(0.15 * assessed - jun) * 3 / 100);
      if (!(sep >= 0.36 * assessed)) i234c += rup(hundredDown(0.45 * assessed - sep) * 3 / 100);
      i234c += rup(hundredDown(0.75 * assessed - dec) * 3 / 100);
      i234c += rup(hundredDown(assessed - mar) / 100);
    }
  }
  const net = liability + i234a + i234b + i234c + f234f - tds - tcs - adv - sat;
  return Object.assign(out, { gti, ti, liability, i234a, i234b, i234c, f234f, payable: net > 0 ? ten(net) : 0, refund: net < 0 ? ten(-net) : 0 });
}

// the two computations side by side: [] when they agree on every figure
export function differences(a, b) {
  const out = [];
  for (const k of KEYS) if (n(a[k]) !== n(b[k])) out.push({ key: k, main: n(a[k]), check: n(b[k]), diff: n(a[k]) - n(b[k]) });
  return out;
}
