/* ================================================================== */
/* ITC reversal: rule 42 (common inputs) and rule 43 (capital goods)  */
/* ================================================================== */
const GSTRev = {
  HEADS: ["igst", "cgst", "sgst", "cess"],
  z(){ return {igst: 0, cgst: 0, sgst: 0, cess: 0}; },
  add(a, c, k){ const o = {}; this.HEADS.forEach(h => { o[h] = r2(num(a[h]) + num(c[h]) * (k == null ? 1 : k)); }); return o; },
  total(x){ return r2(this.HEADS.reduce((s, h) => s + num(x[h]), 0)); },
  settings(){ return Object.assign({d2: true}, (S.books && S.books.rev) || {}); },
  // turnover of the month: E is exempt, nil rated and non-GST; F is all of it, exports included
  turnover(ym, reg){
    let T = 0, Z = 0, E = 0;
    GSTR.outward(ym, reg).forEach(r => {
      const sign = r.kind === "CDNR" ? -1 : 1, v = num(r.taxable) * sign;
      if (r.cls === "export" || r.cls === "sez") Z += v;
      else if (r.cls === "exempt" || r.cls === "nil" || r.cls === "nongst") E += v;
      else T += v;
    });
    return {taxable: r2(T), zero: r2(Z), exempt: r2(E), total: r2(T + Z + E)};
  },
  // rule 42(1)(h): a month with no turnover takes E and F of the last month that had some
  ratio(ym, reg){
    const t = this.turnover(ym, reg);
    if (t.total > 0) return {E: t.exempt, F: t.total, from: ym, t};
    const earlier = GSTR.months().filter(m => m < ym).reverse();
    for (const m of earlier){ const x = this.turnover(m, reg); if (x.total > 0) return {E: x.exempt, F: x.total, from: m, t}; }
    return {E: 0, F: 0, from: "", t};
  },
  common(ym, reg){
    let c = this.z(), n = 0;
    GSTR.inward(ym, reg).forEach(r => {
      if (!r.common) return;
      n++;
      c = this.add(c, {igst: r.common.IGST, cgst: r.common.CGST, sgst: r.common.SGST, cess: r.common.CESS}, r.note === "debit" ? -1 : 1);
    });
    return {c, n};
  },
  rule42(ym, reg){
    const {c, n} = this.common(ym, reg), q = this.ratio(ym, reg), k = q.F ? q.E / q.F : 0;
    const D1 = {}, D2 = {}, C3 = {};
    const d2on = this.settings().d2;
    this.HEADS.forEach(h => { D1[h] = r2(c[h] * k); D2[h] = d2on ? r2(c[h] * 0.05) : 0; C3[h] = r2(c[h] - D1[h] - D2[h]); });
    return {C2: c, n, ratio: q, share: k, D1, D2, C3, reverse: this.add(D1, D2)};
  },
  // the months a capital good's credit is spread over: 60 from the month it is put to use
  assets(reg){ return ((S.books && S.books.assets) || []).filter(a => !reg || !a.reg || a.reg === reg); },
  tm(a, ym){
    const start = String(a.date || "").replace(/-/g, "").slice(0, 6);
    if (a.use !== "common" || start.length !== 6 || ym < start) return null;
    const idx = (num(ym.slice(0, 4)) - num(start.slice(0, 4))) * 12 + num(ym.slice(4, 6)) - num(start.slice(4, 6));
    if (idx >= 60) return null;
    const sold = String(a.sold || "").replace(/-/g, "").slice(0, 6);
    if (sold && ym > sold) return null;
    const o = {};
    this.HEADS.forEach(h => { o[h] = r2(num(a[h]) / 60); });
    return o;
  },
  rule43(ym, reg){
    let Tr = this.z(); const used = [];
    this.assets(reg).forEach(a => { const t = this.tm(a, ym); if (t){ Tr = this.add(Tr, t); used.push({a, tm: t}); } });
    const q = this.ratio(ym, reg), k = q.F ? q.E / q.F : 0, Te = {};
    this.HEADS.forEach(h => { Te[h] = r2(Tr[h] * k); });
    return {Tr, Te, used, ratio: q, share: k};
  },
  // what goes into 3B 4(B)(1) for the month (or every month when none is chosen)
  month(ym, reg){
    const months = ym ? [ym] : GSTR.months();
    let r42 = this.z(), r43 = this.z();
    months.forEach(m => { r42 = this.add(r42, this.rule42(m, reg).reverse); r43 = this.add(r43, this.rule43(m, reg).Te); });
    return {r42, r43, total: this.add(r42, r43)};
  },
  fyMonths(ym){
    const y = num(ym.slice(0, 4)), mo = num(ym.slice(4, 6)), start = mo >= 4 ? y : y - 1;
    const out = [];
    for (let i = 0; i < 12; i++){ const m = 4 + i, yy = m > 12 ? start + 1 : start; out.push(String(yy) + String(m > 12 ? m - 12 : m).padStart(2, "0")); }
    return out;
  },
  // rule 42(2): the year worked out again on the year's turnover, and the difference
  year(ym, reg){
    const have = new Set(GSTR.months()), months = this.fyMonths(ym).filter(m => have.has(m));
    let C2 = this.z(), monthly = this.z(), E = 0, F = 0;
    const rows = months.map(m => {
      const r = this.rule42(m, reg), t = r.ratio.t;
      C2 = this.add(C2, r.C2); monthly = this.add(monthly, r.D1); E += t.exempt; F += t.total;
      return {ym: m, C2: r.C2, share: r.share, D1: r.D1, D2: r.D2, from: r.ratio.from};
    });
    const k = F ? E / F : 0, annual = {};
    this.HEADS.forEach(h => { annual[h] = r2(C2[h] * k); });
    const diff = this.add(annual, monthly, -1);
    return {months, rows, C2, E: r2(E), F: r2(F), share: k, annual, monthly, diff, fy: months.length ? months[0].slice(0, 4) : ""};
  }
};

