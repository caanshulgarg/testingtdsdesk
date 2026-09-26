/* ================================================================== */
/* Returns for GSTINs that are not monthly filers                     */
/*  QRMP: IFF (months 1-2, optional), PMT-06 (months 1-2), GSTR-1 and */
/*        GSTR-3B for the quarter                                     */
/*  Composition: CMP-08 each quarter, GSTR-4 for the year             */
/* ================================================================== */
const GSTQ = {
  H: ["igst", "cgst", "sgst", "cess"],
  z(){ return {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}; },
  add(a, x){ const o = Object.assign({}, a); ["taxable", "igst", "cgst", "sgst", "cess", "n", "total", "ineligible"].forEach(k => { if (x && x[k] != null && typeof x[k] === "number") o[k] = r2(num(o[k]) + x[k]); }); return o; },
  months(qEnd){ const all = GSTR.months(); return GSTR.expand(GSTSet.qStart(qEnd) + "-" + qEnd).filter(m => all.includes(m)); },
  // ---- QRMP ----
  // 3B for the quarter: the three months added together, the credit set off once at the end,
  // and what was deposited by PMT-06 in the first two months used before any more cash is asked for
  threeBQ(qEnd, reg){
    const ms = this.months(qEnd), ts = ms.map(m => GSTR.threeBm(m, reg)), sum = k => ts.reduce((a, t) => this.add(a, t[k] || {}), this.z());
    const keys = ["sale", "cn", "net", "adv", "zero", "nil", "nongst", "rcmOut", "rcmIn", "toUnreg", "impGoods", "impServ", "other", "blocked", "buy", "itc", "reversal", "rev1", "rev2", "reclaim", "na", "rules", "r42", "r43", "held", "released", "cn2b", "rejBack", "netItc"];
    const t = {quarter: true, months: ms, qEnd, basis: (ts[ts.length - 1] || {}).basis || "no 2B"};
    keys.forEach(k => { t[k] = sum(k); });
    t.inw5 = ts.reduce((a, x) => { Object.keys(x.inw5 || {}).forEach(k => { a[k] = r2((a[k] || 0) + num(x.inw5[k])); }); return a; }, {});
    const up = {}; ts.forEach(x => (x.unregPos || []).forEach(p => { const o = up[p.pos] = up[p.pos] || {pos: p.pos, taxable: 0, igst: 0}; o.taxable = r2(o.taxable + p.taxable); o.igst = r2(o.igst + p.igst); }));
    t.unregPos = Object.values(up).sort((a, c) => a.pos.localeCompare(c.pos));
    t.custRej = {add: ts.reduce((a, x) => this.add(a, (x.custRej || {}).add || {}), this.z()), back: ts.reduce((a, x) => this.add(a, (x.custRej || {}).back || {}), this.z())};
    t.r37 = {rev: ts.reduce((a, x) => this.add(a, (x.r37 || {}).rev || {}), this.z()), re: ts.reduce((a, x) => this.add(a, (x.r37 || {}).re || {}), this.z())};
    t.ineligible = r2(ts.reduce((a, x) => a + num(x.ineligible), 0));
    t.opening = GSTR.creditIn(ms[0] || qEnd, reg);
    t.pay = GSTR.setOff(t.net, t.rcmOut, t.netItc, t.opening);
    // PMT-06 deposits of the quarter's first two months are in the cash ledger: they pay first
    const dep = this.deposited(qEnd, reg); t.pmt = dep;
    t.cashAfter = {}; t.pmtLeft = {};
    this.H.forEach(h => { t.cashAfter[h] = r2(Math.max(0, num(t.pay.cash[h]) - num(dep[h]))); t.pmtLeft[h] = r2(Math.max(0, num(dep[h]) - num(t.pay.cash[h]))); });
    t.payable = r2(this.H.reduce((a, h) => a + t.cashAfter[h], 0));
    return t;
  },
  deposited(qEnd, reg){ const d = {igst: 0, cgst: 0, sgst: 0, cess: 0}; GSTR.expand(GSTSet.qStart(qEnd) + "-" + qEnd).filter(m => m !== qEnd).forEach(m => { const p = (GSTF.peek(m, reg).pmt06 || {}); this.H.forEach(h => { d[h] = r2(d[h] + num(p[h])); }); }); return d; },
  // PMT-06 for a quarter's first or second month. Fixed sum: 35% of the cash paid in the last quarter's 3B,
  // or all of the cash paid in the last month if that was a monthly return. Self-assessment: the month's tax after its credit.
  pmt06(ym, reg){
    const rec = GSTF.peek(ym, reg), method = rec.pmtMethod || GSTSet.peek(reg).pmt || "fixed", prevEnd = this.prevYm(GSTSet.qStart(ym)), have = GSTR.months().includes(prevEnd);
    let amt = {igst: 0, cgst: 0, sgst: 0, cess: 0}, why = "", known = true;
    if (method === "fixed"){
      if (!have){ known = false; why = "the return before this quarter is not in the books; the portal shows the amount"; }
      else { const prevQ = GSTSet.typeOf(prevEnd, reg) === "qrmp", t = GSTR.threeB(prevEnd, reg), f = prevQ ? 0.35 : 1;
        this.H.forEach(h => { amt[h] = Math.round(num(t.pay.cash[h]) * f); });
        why = prevQ ? "35% of the cash paid in the 3B for " + GSTSet.qLabel(prevEnd) : "the cash paid in the 3B for " + GSTR.label(prevEnd) + " (a monthly return)"; }
    } else { const t = GSTR.threeBm(ym, reg); this.H.forEach(h => { amt[h] = Math.max(0, Math.round(num(t.pay.cash[h]))); }); why = "the month\u2019s tax less its credit"; }
    const total = this.H.reduce((a, h) => a + amt[h], 0), paid = rec.pmt06 || {};
    return {method, amt, total, why, known, due: GSTF.due(ym, "pmt06", reg), paid, paidTotal: r2(this.H.reduce((a, h) => a + num(paid[h]), 0))};
  },
  prevYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0"); },
  // IFF: the month's invoices and notes to registered customers, optional, at most Rs 50 lakh of value a month;
  // above that, documents go in date order up to the limit and the rest wait for the quarter's GSTR-1
  LIMIT: 5000000,
  key(ctin, num){ return String(ctin || "").toUpperCase() + "|" + GST2B.normNo(num); },
  iff(ym, reg){
    const j = GSTR.toJson(ym, reg, {plain: true}), out = {gstin: j.gstin, fp: j.fp, version: j.version, hash: j.hash};
    const docs = [], dt = d => { const p = String(d || "").split("-"); return p.length === 3 ? p[2] + p[1] + p[0] : ""; };
    (j.b2b || []).forEach(g => (g.inv || []).forEach(i => docs.push({sec: "b2b", ctin: g.ctin, g, x: i, num: i.inum, d: dt(i.idt), val: num(i.val)})));
    (j.cdnr || []).forEach(g => (g.nt || []).forEach(i => docs.push({sec: "cdnr", ctin: g.ctin, g, x: i, num: i.nt_num, d: dt(i.nt_dt), val: num(i.val)})));
    docs.sort((a, c) => a.d.localeCompare(c.d) || String(a.num).localeCompare(String(c.num)));
    let run = 0; const inc = [], left = [];
    docs.forEach(x => { if (run + x.val <= this.LIMIT){ run += x.val; inc.push(x); } else left.push(x); });
    const group = (sec, inner) => { const m = new Map(); inc.filter(x => x.sec === sec).forEach(x => { const o = m.get(x.ctin) || Object.assign({}, x.g, {[inner]: []}); o[inner].push(x.x); m.set(x.ctin, o); }); return Array.from(m.values()); };
    const b2b = group("b2b", "inv"), cdnr = group("cdnr", "nt"); if (b2b.length) out.b2b = b2b; if (cdnr.length) out.cdnr = cdnr;
    const taxOf = x => (x.x.itms || []).reduce((a, it) => { const d = it.itm_det || {}; return a + num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }, 0);
    return {json: out, keys: inc.map(x => this.key(x.ctin, x.num)), n: inc.filter(x => x.sec === "b2b").length, notes: inc.filter(x => x.sec === "cdnr").length,
      val: r2(run), tax: r2(inc.reduce((a, x) => a + taxOf(x), 0)), all: docs.length, allVal: r2(docs.reduce((a, x) => a + x.val, 0)), left: left.length, over: left.length > 0};
  },
  // GSTR-1 for the quarter: everything in it, less the invoices and notes already sent in an IFF
  r1Q(qEnd, reg){
    // the documents sent in each IFF filed: as recorded when it was downloaded, else worked out again the same way
    const qs = GSTSet.qStart(qEnd), j = GSTR.toJson(qs + "-" + qEnd, reg), skip = new Set(GSTR.expand(qs + "-" + qEnd).filter(m => m !== qEnd && GSTF.peek(m, reg).iff));
    const sent = new Set(); skip.forEach(m => { (GSTF.peek(m, reg).iffKeys || this.iff(m, reg).keys).forEach(k => sent.add(k)); });
    if (sent.size){
      if (j.b2b) j.b2b = j.b2b.map(g => Object.assign({}, g, {inv: g.inv.filter(i => !sent.has(this.key(g.ctin, i.inum)))})).filter(g => g.inv.length);
      if (j.cdnr) j.cdnr = j.cdnr.map(g => Object.assign({}, g, {nt: g.nt.filter(i => !sent.has(this.key(g.ctin, i.nt_num)))})).filter(g => g.nt.length);
      if (j.b2b && !j.b2b.length) delete j.b2b; if (j.cdnr && !j.cdnr.length) delete j.cdnr;
    }
    return {json: j, skipped: Array.from(skip)};
  },
  // ---- Composition ----
  RATES: {mfr: {l: "Manufacturer: 1% of turnover", r: 1, base: "all"}, trader: {l: "Trader: 1% of turnover of taxable supplies", r: 1, base: "taxable"}, rest: {l: "Restaurant: 5% of turnover", r: 5, base: "all"}, serv: {l: "Services (notification 2/2019): 6% of turnover", r: 6, base: "all"}},
  compCat(reg){ return GSTSet.peek(reg).comp || "trader"; },
  cmp08(qEnd, reg){
    const ms = this.months(qEnd), cat = this.RATES[this.compCat(reg)];
    let all = 0, taxable = 0, exempt = 0;
    ms.forEach(m => GSTR.outward(m, reg).forEach(r => { const s = r.kind === "CDNR" ? -1 : 1; all += s * num(r.taxable); if (r.cls === "taxable") taxable += s * num(r.taxable); else exempt += s * num(r.taxable); }));
    const turnover = r2(cat.base === "all" ? all : taxable), tax = r2(turnover * cat.r / 100), half = r2(tax / 2);
    const rcm = ms.reduce((a, m) => this.add(a, GSTR.threeBm(m, reg).rcmOut), this.z());
    const rec = GSTF.peek(qEnd, reg), due = GSTF.due(qEnd, "cmp08", reg), upto = rec.cmp08 || "", late = upto ? Math.max(0, GSTF.days(due, upto)) : 0;
    const payable = r2(tax + rcm.igst + rcm.cgst + rcm.sgst + rcm.cess), interest = r2(payable * 0.18 * late / 365);
    return {months: ms, cat, all: r2(all), taxable: r2(taxable), exempt: r2(exempt), turnover, tax, cgst: half, sgst: r2(tax - half), rcm, payable, due, filed: upto, late, interest};
  },
  gstr4(fy, reg){
    const y = +fy.slice(0, 4), ms = GSTR.months().filter(m => m >= y + "04" && m <= (y + 1) + "03");
    const t4 = {reg: this.z(), regRcm: this.z(), unregRcm: this.z(), imps: this.z()};
    ms.forEach(m => GSTR.inward(m, reg).forEach(r0 => { const r = GSTR.signedIn(r0), k = r.import && r.supply !== "Goods" ? "imps" : r.rcm ? (r.gstin ? "regRcm" : "unregRcm") : r.gstin ? "reg" : null; if (k) t4[k] = this.add(t4[k], Object.assign({}, r, {n: 1})); }));
    const quarters = Array.from(new Set(ms.map(m => GSTSet.qEnd(m)))).map(q => Object.assign({q, label: GSTSet.qLabel(q)}, this.cmp08(q, reg)));
    const sumQ = k => r2(quarters.reduce((a, x) => a + num(typeof x[k] === "object" ? 0 : x[k]), 0));
    return {fy, months: ms, t4, quarters, turnover: sumQ("turnover"), tax: sumQ("tax"), rcm: quarters.reduce((a, x) => this.add(a, x.rcm), this.z()), interest: sumQ("interest"), due: (y + 1) + "-06-30"};
  },
  apiMode(){ return ((S.books || {}).gstApi) || "save"; }
};
// ---- the screens: one simple card for each step ----
function gstStep(n, title, body, done){ return '<div class="gq-step' + (done ? " done" : "") + '"><div class="gq-n">' + (done ? "\u2713" : n) + '</div><div class="gq-b"><div class="gq-t">' + title + "</div>" + body + "</div></div>"; }
function gstMoney(v){ return "\u20b9" + INR.format(r2(v || 0)); }
function gstD(s){ return s ? GSTAmend.dmy(String(s).replace(/-/g, "")) : ""; }
function viewQrmp(b, part){
  const ym = S.gstYm || "", reg = S.gstReg || "", qEnd = GSTSet.qEnd(ym), first = !GSTSet.isQEnd(ym), rec = GSTF.peek(ym, reg), q = GSTSet.qLabel(ym);
  let h = '<section class="dash-card gq"><h3>' + esc(q) + " \u00b7 " + esc(GSTR.label(ym)) + ' <span class="tag">Quarterly (QRMP)</span></h3>';
  if (first){
    const f = GSTQ.iff(ym, reg), p = GSTQ.pmt06(ym, reg);
    h += '<p class="note">This month has no GSTR-1 or 3B. Two things only:</p>' +
      gstStep(1, "IFF \u2014 optional, by " + esc(gstD(GSTF.due(ym, "iff", reg))),
        (f.all ? "<p>" + f.n + " invoice" + (f.n === 1 ? "" : "s") + (f.notes ? " and " + f.notes + " note" + (f.notes === 1 ? "" : "s") : "") + " to registered customers" + (f.over ? " in the IFF" : "") + ", value " + gstMoney(f.val) + ", tax " + gstMoney(f.tax) + ". Filing IFF lets your customers take the credit this month instead of at quarter end.</p>" +
          (f.over ? '<p class="note"><b>IFF allows \u20b950 lakh a month.</b> The month has ' + f.all + " documents worth " + gstMoney(f.allVal) + "; the IFF file carries the first " + (f.n + f.notes) + " by date, and the other " + f.left + " go in the quarter\u2019s GSTR-1.</p>" : "") +
          '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn small" data-gq="iffjson">Download IFF JSON</button><span class="note">Filed on</span><input type="date" data-gqf="iff" value="' + esc(rec.iff || "") + '" style="width:auto"></div>' +
          (rec.iff ? '<p class="note">Filed: these will be left out of the quarter\u2019s GSTR-1.</p>' : "")
          : "<p>No invoices to registered customers this month; nothing to file.</p>"), !!rec.iff || !f.all) +
      gstStep(2, "Pay tax by PMT-06 \u2014 by " + esc(gstD(p.due)),
        '<p><select data-gqf="pmtMethod" style="width:auto"><option value="fixed"' + (p.method === "fixed" ? " selected" : "") + '>Fixed sum (35% method)</option><option value="self"' + (p.method === "self" ? " selected" : "") + ">Self-assessment (this month\u2019s tax)</option></select></p>" +
        (p.known ? "<p><b>" + gstMoney(p.total) + "</b> to pay: " + esc(p.why) + ".</p>" + (p.total ? '<p class="note">IGST ' + gstMoney(p.amt.igst) + " \u00b7 CGST " + gstMoney(p.amt.cgst) + " \u00b7 SGST " + gstMoney(p.amt.sgst) + (p.amt.cess ? " \u00b7 cess " + gstMoney(p.amt.cess) : "") + "</p>" : '<p class="note">Nothing to pay this month.</p>') : '<p class="note">' + esc(p.why) + ".</p>") +
        '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><span class="note">Paid:</span>' + GSTQ.H.map(k => '<label class="note">' + k.toUpperCase() + ' <input type="number" step="1" data-gqpay="' + k + '" value="' + (p.paid[k] != null ? esc(String(p.paid[k])) : "") + '" style="width:110px"></label>').join("") + "</div>" +
        '<p class="note">What you pay here sits in the cash ledger and is used in the quarter\u2019s 3B.</p>', p.paidTotal > 0 || (p.known && !p.total));
    h += '<p class="note">GSTR-1 and GSTR-3B for ' + esc(q) + " are due " + esc(gstD(GSTF.due(qEnd, "r1", reg))) + " and " + esc(gstD(GSTF.due(qEnd, "r3b", reg))) + ".</p>";
    return h + "</section>";
  }
  // the quarter's last month: the two returns
  const r1 = GSTQ.r1Q(qEnd, reg), t = GSTR.threeB(qEnd, reg), j = r1.json;
  const cnt = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).length, 0);
  h += '<p class="note">Two returns for the whole quarter, ' + esc(t.months.map(m => GSTR.label(m)).join(", ")) + ":</p>" +
    gstStep(1, "GSTR-1 for the quarter \u2014 by " + esc(gstD(GSTF.due(qEnd, "r1", reg))),
      "<p>" + cnt("b2b") + " B2B invoices, " + cnt("cdnr") + " notes, " + (j.b2cs || []).length + " B2C small lines, " + (cnt("b2cl") + cnt("exp")) + " B2C large and export invoices." +
      (r1.skipped.length ? " Invoices already sent in IFF for " + esc(r1.skipped.map(m => GSTR.label(m)).join(" and ")) + " are left out." : "") + "</p>" +
      '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn small primary" data-act="gstJson">Download GSTR-1 JSON for the quarter</button><span class="note">Filed on</span><input type="date" data-gstf="r1" value="' + esc(GSTF.peek(qEnd, reg).r1 || "") + '" style="width:auto"></div>', !!GSTF.peek(qEnd, reg).r1) +
    gstStep(2, "GSTR-3B for the quarter \u2014 by " + esc(gstD(GSTF.due(qEnd, "r3b", reg))),
      '<div class="dash-row"><span>Tax for the quarter (after credit)</span><b>' + gstMoney(GSTQ.H.reduce((a, k) => a + num(t.pay.cash[k]), 0)) + "</b></div>" +
      '<div class="dash-row"><span>Less: paid by PMT-06 in the first two months</span><b>' + gstMoney(GSTQ.H.reduce((a, k) => a + num(t.pmt[k]), 0)) + "</b></div>" +
      '<div class="dash-row"><span><b>Still to pay</b></span><b>' + gstMoney(t.payable) + "</b></div>" +
      (GSTQ.H.some(k => t.pmtLeft[k] > 0) ? '<p class="note">PMT-06 paid more than needed: ' + gstMoney(GSTQ.H.reduce((a, k) => a + t.pmtLeft[k], 0)) + " stays in the cash ledger.</p>" : "") +
      '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn small primary" data-act="gst3bJson">Download GSTR-3B JSON for the quarter</button></div>' +
      '<p class="note">The full 3B working is on the GSTR-3B tab.</p>', !!GSTF.peek(qEnd, reg).r3b);
  return h + "</section>";
}
function viewCmp08(b){
  const ym = S.gstYm || "", reg = S.gstReg || "", qEnd = GSTSet.qEnd(ym), c = GSTQ.cmp08(qEnd, reg), rec = GSTF.peek(qEnd, reg);
  let h = '<section class="dash-card gq"><h3>CMP-08 \u00b7 ' + esc(GSTSet.qLabel(qEnd)) + ' <span class="tag">Composition</span></h3>' +
    '<p class="note">One statement a quarter, due ' + esc(gstD(c.due)) + ". Fill these figures on the portal (Returns \u2192 CMP-08).</p>" +
    gstStep(1, "Turnover and tax",
      '<div class="dash-row"><span>Sales in the quarter' + (c.cat.base === "taxable" ? " (taxable supplies)" : "") + "</span><b>" + gstMoney(c.turnover) + "</b></div>" +
      '<div class="dash-row"><span>Rate: ' + esc(c.cat.l) + " (" + gstSetLink() + ")</span><b>" + gstMoney(c.tax) + "</b></div>" +
      '<p class="note">CGST ' + gstMoney(c.cgst) + " \u00b7 SGST " + gstMoney(c.sgst) + (c.cat.base === "taxable" && c.exempt ? " \u00b7 exempt sales " + gstMoney(c.exempt) + " carry no tax" : "") + "</p>", false) +
    gstStep(2, "Tax on purchases under reverse charge",
      '<div class="dash-row"><span>Reverse charge in the quarter</span><b>' + gstMoney(c.rcm.igst + c.rcm.cgst + c.rcm.sgst + c.rcm.cess) + "</b></div>", false) +
    gstStep(3, "Pay and file",
      '<div class="dash-row"><span><b>Total to pay, in cash</b></span><b>' + gstMoney(c.payable) + "</b></div>" +
      (c.late ? '<p class="note">Filed ' + c.late + " days late: interest " + gstMoney(c.interest) + " (18% a year).</p>" : "") +
      '<div class="row" style="gap:8px;align-items:center"><span class="note">Filed on</span><input type="date" data-gqf="cmp08" data-gqq="' + qEnd + '" value="' + esc(rec.cmp08 || "") + '" style="width:auto"></div>' +
      '<p class="note">A composition dealer takes no input tax credit and charges no tax on its invoices.</p>', !!rec.cmp08);
  return h + "</section>";
}
function viewGstr4(b){
  const ym = S.gstYm || "", reg = S.gstReg || "", fy = GSTF.fyOf(ym), g = GSTQ.gstr4(fy, reg), m = gstMoney, row = (l, x) => '<tr><td>' + l + '</td><td class="n">' + m(x.taxable) + '</td><td class="n">' + m(x.igst) + '</td><td class="n">' + m(x.cgst) + '</td><td class="n">' + m(x.sgst) + "</td></tr>";
  return '<section class="dash-card gq"><h3>GSTR-4 \u00b7 ' + esc(fy) + ' <span class="tag">Composition, the year</span></h3><p class="note">The annual return, due ' + esc(gstD(g.due)) + ". Fill these figures on the portal (Returns \u2192 GSTR-4).</p>" +
    gstStep(1, "Table 4: purchases", '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th></th><th class="n">Value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
      row("4A From registered suppliers (not reverse charge)", g.t4.reg) + row("4B From registered suppliers, reverse charge", g.t4.regRcm) + row("4C From unregistered suppliers, reverse charge", g.t4.unregRcm) + row("4D Import of services", g.t4.imps) + "</tbody></table></div>", false) +
    gstStep(2, "Table 5: the year\u2019s CMP-08s", '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Quarter</th><th class="n">Turnover</th><th class="n">Tax</th><th class="n">Reverse charge</th><th class="n">Interest</th></tr></thead><tbody>' +
      g.quarters.map(x => "<tr><td>" + esc(x.label) + '</td><td class="n">' + m(x.turnover) + '</td><td class="n">' + m(x.tax) + '</td><td class="n">' + m(x.rcm.igst + x.rcm.cgst + x.rcm.sgst + x.rcm.cess) + '</td><td class="n">' + m(x.interest) + "</td></tr>").join("") +
      '<tr><td><b>Year</b></td><td class="n"><b>' + m(g.turnover) + '</b></td><td class="n"><b>' + m(g.tax) + '</b></td><td class="n"><b>' + m(g.rcm.igst + g.rcm.cgst + g.rcm.sgst + g.rcm.cess) + '</b></td><td class="n"><b>' + m(g.interest) + "</b></td></tr></tbody></table></div>", false) +
    gstStep(3, "Table 6: sales by rate", "<p>" + esc(GSTQ.RATES[GSTQ.compCat(reg)].l) + ": turnover " + m(g.turnover) + ", tax " + m(g.tax) + ".</p>", false) +
    '<p class="note">Tables 7 (TDS and TCS credit) and 8 (tax paid) are taken from the portal as filed through the year.</p></section>';
}
if (typeof document !== "undefined"){
  document.addEventListener("change", e => {
    const t = e.target; if (!t.dataset || !S.books) return;
    const ym = S.gstYm || "", reg = S.gstReg || "";
    if (t.dataset.gqf !== undefined){ const k = t.dataset.gqf, r = GSTF.rec(t.dataset.gqq || ym, reg); if (t.value === "") delete r[k]; else r[k] = t.value; GSTR._carry = null; saveBooks(); render(); return; }
    if (t.dataset.gqpay !== undefined){ const r = GSTF.rec(ym, reg); r.pmt06 = Object.assign({}, r.pmt06, {[t.dataset.gqpay]: t.value === "" ? 0 : num(t.value)}); GSTR._carry = null; saveBooks(); render(); }
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-gq]"); if (!t || !S.books) return;
    const ym = S.gstYm || "", reg = S.gstReg || "";
    if (t.dataset.gq === "iffjson"){ if (typeof ledgersReady === "function" && !ledgersReady("gst")) return; const f = GSTQ.iff(ym, reg); GSTF.rec(ym, reg).iffKeys = f.keys; saveBooks(); saveFile("IFF_" + f.json.gstin + "_" + f.json.fp + ".json", new Blob([JSON.stringify(f.json)], {type: "application/json"})); }
  });
}
