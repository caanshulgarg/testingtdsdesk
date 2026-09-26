/* ================================================================== */
/* GSTR-9 and GSTR-9C: the year, built from the monthly figures       */
/* ================================================================== */
const GST9 = {
  Z(){ return {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}; },
  add(a, r, k){ const o = Object.assign({}, a); ["taxable", "igst", "cgst", "sgst", "cess"].forEach(f => { o[f] = r2(num(o[f]) + num(r[f]) * (k == null ? 1 : k)); }); return o; },
  sumRows(rows, k){ return rows.reduce((a, r) => this.add(a, r, k), this.Z()); },
  fyOf(ym){ return Audit.fyStart(String(ym).slice(0, 6) + "01").slice(0, 4); },
  label(fy){ return fy + "-" + String(num(fy) + 1).slice(2); },
  months(fy){ return GSTRev.fyMonths(fy + "04"); },
  build(fy, reg){
    const months = this.months(fy), have = new Set(GSTR.months()), inBooks = months.filter(m => have.has(m));
    const out = [], inn = [], t3 = {};
    inBooks.forEach(m => { GSTR.outward(m, reg).forEach(r => out.push(r)); GSTR.inward(m, reg).forEach(r => inn.push(Object.assign({ym: m}, r))); t3[m] = (typeof GSTF === "object" && GSTF.filed3b(m, reg)) || GSTR.threeBm(m, reg);
      if (typeof GSTSet === "object" && GSTSet.typeOf(m, reg) === "qrmp"){ const q = GSTSet.isQEnd(m) ? GSTR.threeB(m, reg).pay : {cash: {}, use: {}}; t3[m] = Object.assign({}, t3[m], {pay: q}); } });
    const S1 = f => this.sumRows(out.filter(f));
    const taxable = r => r.cls === "taxable" && !r.rcm;
    const T = {};
    // Part II: outward and inward supplies on which tax is payable (4), and on which it is not (5)
    T["4A"] = S1(r => taxable(r) && (r.kind === "B2C" || r.kind === "B2CL"));
    T["4B"] = S1(r => taxable(r) && r.kind === "B2B");
    T["4C"] = S1(r => r.cls === "export" && r.kind !== "CDNR" && r.kind !== "DBNR" && r.igst > 0);
    T["4D"] = S1(r => r.cls === "sez" && r.kind !== "CDNR" && r.kind !== "DBNR" && r.igst > 0);
    T["4E"] = this.Z();
    const adv = inBooks.reduce((a, m) => { const x = GSTAdv.month(m, reg).net; return this.add(a, x); }, this.Z());
    T["4F"] = adv;
    T["4G"] = inBooks.reduce((a, m) => this.add(a, Object.assign({taxable: 0}, t3[m].rcmOut)), this.Z());
    T["4H"] = ["4A", "4B", "4C", "4D", "4E", "4F", "4G"].reduce((a, k) => this.add(a, T[k]), this.Z());
    T["4I"] = S1(r => r.kind === "CDNR" && r.cls !== "exempt" && r.cls !== "nil" && r.cls !== "nongst" && !r.rcm);
    T["4J"] = S1(r => r.kind === "DBNR" && !r.rcm);
    const ty = this.typed(fy, reg), tz = k => Object.assign(this.Z(), ty[k] || {});
    T["4K"] = tz("4K"); T["4L"] = tz("4L");
    T["4N"] = this.add(this.add(this.add(this.add(T["4H"], T["4I"], -1), T["4J"]), T["4K"]), T["4L"], -1);
    T["5A"] = S1(r => r.cls === "export" && r.kind !== "CDNR" && r.kind !== "DBNR" && !(r.igst > 0));
    T["5B"] = S1(r => r.cls === "sez" && r.kind !== "CDNR" && r.kind !== "DBNR" && !(r.igst > 0));
    T["5C"] = S1(r => r.rcm && r.kind !== "CDNR");
    T["5D"] = S1(r => r.cls === "exempt" && r.kind !== "CDNR");
    T["5E"] = S1(r => r.cls === "nil" && r.kind !== "CDNR");
    T["5F"] = S1(r => r.cls === "nongst" && r.kind !== "CDNR");
    T["5G"] = ["5A", "5B", "5C", "5D", "5E", "5F"].reduce((a, k) => this.add(a, T[k]), this.Z());
    T["5H"] = S1(r => r.kind === "CDNR" && (r.rcm || r.cls === "exempt" || r.cls === "nil" || r.cls === "nongst"));
    T["5I"] = this.Z(); T["5J"] = tz("5J"); T["5K"] = tz("5K");
    T["5M"] = this.add(this.add(this.add(this.add(T["5G"], T["5H"], -1), T["5I"]), T["5J"]), T["5K"], -1);   // 5G - 5H + 5I + 5J - 5K
    T["5N"] = this.add(T["4N"], T["5M"]);
    // Part III: credit taken (6), reversed (7), and against 2B (8)
    const sumT = f => inBooks.reduce((a, m) => this.add(a, Object.assign({taxable: 0}, f(t3[m]))), this.Z());
    T["6A"] = sumT(t => t.itc);
    const cap = r => { const v = (S.books.vouchers || []).find(z => z.id === r.id); return !!(v && v.ent.some(e => e.a < 0 && Audit.isFixed(e.l))); };
    const kindOf = r => cap(r) ? "cg" : (r.supply === "Services" || /^99/.test(r.hsn || "")) ? "is" : "in";
    const inward = inn.filter(r => !r.rcm && !r.import && !r.blocked), sgn = r => r.note === "debit" ? -1 : 1;
    ["in", "cg", "is"].forEach(k => { T["6B-" + k] = inward.filter(r => kindOf(r) === k).reduce((a, r) => this.add(a, r, sgn(r)), this.Z()); });
    const rc = inn.filter(r => r.rcm && !r.import);                 // imported services are 6F, not 6C or 6D
    T["6C"] = rc.filter(r => !r.gstin).reduce((a, r) => this.add(a, r, sgn(r)), this.Z());
    T["6D"] = rc.filter(r => r.gstin).reduce((a, r) => this.add(a, r, sgn(r)), this.Z());
    T["6E"] = inn.filter(r => r.import && r.supply !== "Services").reduce((a, r) => this.add(a, r), this.Z());
    T["6F"] = inn.filter(r => r.import && r.supply === "Services").reduce((a, r) => this.add(a, r), this.Z());
    // 6H: credit reclaimed in 3B 4(D)(1) (rule 37 and typed) is already inside 6A, so it is listed here too
    T["6G"] = tz("6G"); T["6H"] = this.add(tz("6H"), sumT(t => t.reclaim || {}));
    T["6I"] = ["6B-in", "6B-cg", "6B-is", "6C", "6D", "6E", "6F", "6G", "6H"].reduce((a, k) => this.add(a, T[k]), this.Z());
    T["6J"] = this.add(T["6A"], T["6I"], -1);
    T["6O"] = T["6I"];
    T["7C"] = sumT(t => t.r42); T["7D"] = sumT(t => t.r43); T["7E"] = sumT(t => t.reversal);
    // 7A: rule 37 reversals worked out from the bills; 7H keeps what was typed in 4(B)(2) besides them
    T["7A"] = this.add(tz("7A"), sumT(t => (t.r37 && t.r37.rev) || {})); T["7B"] = tz("7B"); T["7H"] = tz("7H");
    T["7I"] = ["7A", "7B", "7C", "7D", "7E", "7H"].reduce((a, k) => this.add(a, T[k]), this.Z());
    T["7J"] = this.add(T["6O"], T["7I"], -1);
    // 8A: credit in 2B for the year's months
    let a8 = this.Z(), twoB = 0;
    GST2B.all2b(reg).filter(t => months.includes(t.ym)).forEach(t => { twoB++; t.rows.filter(r => r.itcavl !== "N" && r.sec !== "impg" && r.sec !== "impgsez").forEach(r => { a8 = this.add(a8, {taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess}, r.dir); }); });
    T["8A"] = a8;
    T["8B"] = this.add(this.add(this.add(T["6B-in"], T["6B-cg"]), T["6B-is"]), T["6H"]);
    // 8C: credit on the year's bills taken in the next year's returns, up to November
    const nextFrom = String(num(fy) + 1) + "0401", nextTo = String(num(fy) + 1) + "1130";
    let c8 = this.Z();
    GST2B.bookDocs().filter(d => (!reg || d.reg === reg) && d.bookDate >= nextFrom && d.bookDate <= nextTo && String(d.date) >= fy + "0401" && String(d.date) < nextFrom && !d.rcm)
      .forEach(d => { c8 = this.add(c8, {taxable: d.taxable, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess}, d.dir); });
    T["8C"] = c8;
    T["8D"] = this.add(T["8A"], this.add(T["8B"], T["8C"]), -1);
    T["8G"] = T["6E"]; T["8H"] = T["6E"]; T["8I"] = this.Z();
    T["13"] = T["8C"];
    // Part V: this year's supplies and credit dealt with in the next year's returns, up to November
    // 10 and 11 are amendments made in next year's GSTR-1 (typed); 12 is credit of this year's bills reversed next year
    let r12 = this.Z();
    GST2B.bookDocs().filter(d => (!reg || d.reg === reg) && d.bookDate >= nextFrom && d.bookDate <= nextTo && String(d.date) >= fy + "0401" && String(d.date) < nextFrom && d.dir < 0 && !d.rcm)
      .forEach(d => { r12 = this.add(r12, {taxable: d.taxable, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess}); });
    T["10"] = tz("10"); T["11"] = tz("11"); T["12"] = ty["12"] ? tz("12") : r12; T["12books"] = r12;
    T["14"] = Object.assign({payable: 0, paid: 0}, ty["14"] || {});
    const part6 = {}; ["15A", "15B", "15C", "15D", "15E", "15F", "15G", "16A", "16B", "16C", "19"].forEach(k => { part6[k] = tz(k); });
    // Part IV: tax payable and paid
    const pay = {};
    ["igst", "cgst", "sgst", "cess"].forEach(h => {
      const due = inBooks.reduce((s2, m) => s2 + num(t3[m].net[h]) + num(t3[m].rcmOut[h]), 0);
      const cash = inBooks.reduce((s2, m) => s2 + num(t3[m].pay.cash[h]), 0);
      const by = {}; ["igst", "cgst", "sgst", "cess"].forEach(f => { by[f] = r2(inBooks.reduce((s2, m) => s2 + num(((t3[m].pay.use[f] || {})[h]) || 0), 0)); });
      pay[h] = {due: r2(due), cash: r2(cash), itc: r2(by.igst + by.cgst + by.sgst + by.cess), by};
    });
    // Part VI: HSN summaries
    const hsn = {};
    inBooks.forEach(m => GSTR.one(m, reg).hsn.forEach(h => { const k = h.hsn + "|" + h.rate, x = hsn[k] = hsn[k] || {hsn: h.hsn, rate: h.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}; ["taxable", "igst", "cgst", "sgst", "cess"].forEach(f => { x[f] = r2(x[f] + h[f]); }); }));
    const hin = {};
    GSTR.partsOf(inn).forEach(q => { const r = q.row, k = (q.hsn || "no HSN") + "|" + q.rate, x = hin[k] = hin[k] || {hsn: q.hsn || "", rate: q.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}; ["taxable", "igst", "cgst", "sgst", "cess"].forEach(f => { x[f] = r2(x[f] + num(q[f]) * sgn(r)); }); });
    // credit held back for 2B at the year's end explains a 6J difference
    const heldEnd = inBooks.reduce((a, m) => { const x = t3[m]; return x.held ? r2(a + x.held.igst + x.held.cgst + x.held.sgst + x.held.cess - x.released.igst - x.released.cgst - x.released.sgst - x.released.cess) : a; }, 0);
    return {fy, reg, months, inBooks, missing: months.filter(m => !have.has(m)), T, pay, twoB, part6, heldEnd, typed: ty,
      hsnOut: Object.values(hsn).sort((a, c) => c.taxable - a.taxable), hsnIn: Object.values(hin).sort((a, c) => c.taxable - a.taxable)};
  },
  // figures that are not in the books, typed once per year and registration
  typed(fy, reg){ const b = S.books; b.gst9 = b.gst9 || {}; return b.gst9[fy + "|" + (reg || "")] = b.gst9[fy + "|" + (reg || "")] || {}; },
  TYPED: [["4K", "Supplies declared through amendments (+)"], ["4L", "Supplies reduced through amendments (\u2013)"], ["5J", "Supplies on which tax is not payable, declared through amendments (+)"], ["5K", "Supplies on which tax is not payable, reduced through amendments (\u2013)"],
    ["6G", "Input tax credit received from ISD"], ["6H", "ITC reclaimed (other than B above)"], ["7A", "Reversed as per rule 37"], ["7B", "Reversed as per rule 39"], ["7H", "Other reversals"],
    ["10", "Supplies / tax declared through amendments (+), net of debit notes (next year\u2019s returns)"], ["11", "Supplies / tax reduced through amendments (\u2013), net of credit notes"],
    ["12", "Reversal of ITC availed during the previous financial year"],
    ["15A", "15A Total refund claimed"], ["15B", "15B Total refund sanctioned"], ["15C", "15C Total refund rejected"], ["15D", "15D Total refund pending"], ["15E", "15E Total demand of taxes"], ["15F", "15F Total taxes paid on 15E"], ["15G", "15G Total demands pending out of 15E"],
    ["16A", "16A Supplies received from composition taxpayers"], ["16B", "16B Deemed supply under section 143 (job work)"], ["16C", "16C Goods sent on approval basis but not returned"],
    ["19", "19 Late fee payable and paid (CGST, SGST in their columns)"]],
  ROWS: [
    ["II", "4", "Outward and inward supplies on which tax is payable"],
    ["4A", "Supplies made to unregistered persons (B2C)"], ["4B", "Supplies made to registered persons (B2B)"], ["4C", "Zero rated supply (export) on payment of tax"],
    ["4D", "Supplies to SEZ on payment of tax"], ["4E", "Deemed exports"], ["4F", "Advances on which tax has been paid but invoice has not been issued"],
    ["4G", "Inward supplies on which tax is to be paid on reverse charge"], ["4H", "Sub-total (A to G)", 1], ["4I", "Credit notes issued (-)"], ["4J", "Debit notes issued (+)"],
    ["4K", "Supplies declared through amendments (+)"], ["4L", "Supplies reduced through amendments (-)"], ["4N", "Supplies and advances on which tax is to be paid", 1],
    ["II", "5", "Outward supplies on which tax is not payable"],
    ["5A", "Zero rated supply (export) without payment of tax"], ["5B", "Supply to SEZs without payment of tax"], ["5C", "Supplies on which tax is to be paid by the recipient on reverse charge"],
    ["5D", "Exempted"], ["5E", "Nil rated"], ["5F", "Non-GST supply"], ["5G", "Sub-total (A to F)", 1], ["5H", "Credit notes issued (-)"], ["5M", "Supplies on which tax is not to be paid", 1],
    ["5N", "Total turnover (including advances) (4N + 5M)", 1],
    ["III", "6", "ITC availed during the year"],
    ["6A", "Total amount of ITC availed through GSTR-3B"], ["6B-in", "Inward supplies other than imports and reverse charge: inputs"], ["6B-cg", "\u2026 capital goods"], ["6B-is", "\u2026 input services"],
    ["6C", "Inward supplies from unregistered persons on reverse charge"], ["6D", "Inward supplies from registered persons on reverse charge"], ["6E", "Import of goods"], ["6F", "Import of services"],
    ["6G", "Input tax credit received from ISD"], ["6H", "ITC reclaimed"], ["6I", "Sub-total (B to H)", 1], ["6J", "Difference (A \u2013 I)", 1],
    ["III", "7", "ITC reversed and ineligible for the year"],
    ["7A", "As per rule 37"], ["7B", "As per rule 39"], ["7C", "As per rule 42"], ["7D", "As per rule 43"], ["7E", "As per section 17(5)"], ["7H", "Other reversals"], ["7I", "Total ITC reversed", 1], ["7J", "Net ITC available for utilisation (6O \u2013 7I)", 1],
    ["III", "8", "Other ITC related information"],
    ["8A", "ITC as per GSTR-2B"], ["8B", "ITC as per 6(B) and 6(H)"], ["8C", "ITC on inward supplies of this year availed in the next year up to the time limit"], ["8D", "Difference [A \u2013 (B + C)]", 1],
    ["8G", "IGST paid on import of goods"], ["8H", "IGST credit availed on import of goods (6E)"], ["8I", "Difference (G \u2013 H)", 1],
    ["V", "10", "Particulars of the transactions for the previous year declared in the returns of April to November of the next year"],
    ["10", "Supplies / tax declared through amendments (+)"], ["11", "Supplies / tax reduced through amendments (\u2013)"], ["12", "Reversal of ITC availed during the previous year"], ["13", "ITC availed for the previous year"]],
  html(d){
    const m = v => INR.format(r2(v || 0));
    let h = '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Table</th><th>Details</th><th class="n">Taxable value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>';
    this.ROWS.forEach(r => {
      if (r.length === 3 && /^(II|III|IV|V|VI)$/.test(r[0])) { h += '<tr><td colspan="7" style="background:var(--paper)"><b>Part ' + r[0] + " \u00b7 " + r[1] + ". " + esc(r[2]) + "</b></td></tr>"; return; }
      const x = d.T[r[0]] || this.Z(), b = r[2] ? "b" : "span";
      // with no 2B here, 8A is not known: say so, rather than show the whole credit as a difference
      if (!d.twoB && (r[0] === "8A" || r[0] === "8D")){ h += "<tr><td>" + r[0] + "</td><td>" + esc(r[1]) + '</td><td></td><td class="n" colspan="4"><span class="nr">no 2B brought in for this year</span></td></tr>'; return; }
      h += "<tr><td>" + esc(r[0].replace(/-.*/, "")) + "</td><td><" + b + ">" + esc(r[1]) + "</" + b + '></td><td class="n">' + (/^[678]|^13/.test(r[0]) ? "" : m(x.taxable)) + '</td><td class="n">' + m(x.igst) + '</td><td class="n">' + m(x.cgst) + '</td><td class="n">' + m(x.sgst) + '</td><td class="n">' + m(x.cess) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    // table 9 in the return's own columns
    h += '<h3 style="margin-top:12px">Part IV \u00b7 9. Details of tax paid</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Tax</th><th class="n">Tax payable</th><th class="n">Paid in cash</th><th class="n">Paid through ITC: IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>' +
      [["igst", "Integrated tax"], ["cgst", "Central tax"], ["sgst", "State/UT tax"], ["cess", "Cess"]].map(([k, l]) => { const p = d.pay[k], by = p.by || {}; return "<tr><td>" + l + '</td><td class="n">' + m(p.due) + '</td><td class="n">' + m(p.cash) + '</td><td class="n">' + m(by.igst) + '</td><td class="n">' + m(by.cgst) + '</td><td class="n">' + m(by.sgst) + '</td><td class="n">' + m(by.cess) + "</td></tr>"; }).join("") +
      "</tbody></table></div>";
    const T14 = d.T["14"] || {};
    h += '<h3 style="margin-top:12px">14. Differential tax paid on account of 10 and 11</h3><p class="note">Payable \u20b9' + m(T14.payable) + " \u00b7 paid \u20b9" + m(T14.paid) + " (typed below)</p>";
    const p6 = d.part6 || {}, line = (k, l) => "<tr><td>" + esc(l) + '</td><td class="n">' + m((p6[k] || {}).taxable) + '</td><td class="n">' + m((p6[k] || {}).igst) + '</td><td class="n">' + m((p6[k] || {}).cgst) + '</td><td class="n">' + m((p6[k] || {}).sgst) + '</td><td class="n">' + m((p6[k] || {}).cess) + "</td></tr>";
    h += '<h3 style="margin-top:12px">Part VI \u00b7 15, 16 and 19</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Details</th><th class="n">Value / amount</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>' +
      this.TYPED.filter(([k]) => /^1[569]/.test(k)).map(([k, l]) => line(k, l)).join("") + "</tbody></table></div>";
    return h;
  }
};
const GST9C = {
  ADJ: [["5B", "Unbilled revenue at the beginning of the year", 1], ["5C", "Unadjusted advances at the end of the year", 1], ["5D", "Deemed supply under Schedule I", 1],
    ["5E", "Credit notes issued after the end of the year but reflected in the annual return", 1], ["5F", "Trade discounts accounted for in the financial statements but not permissible under GST", 1],
    ["5H", "Unbilled revenue at the end of the year", -1], ["5I", "Credit notes accounted for in the financial statements but not permissible under GST", 1],
    ["5J", "Adjustments on account of supply of goods by SEZ units to DTA units", -1], ["5K", "Turnover for the period under composition", -1],
    ["5L", "Adjustments in turnover under section 15 and its rules (+/-)", 1], ["5M", "Adjustments in turnover on account of foreign exchange fluctuations (+/-)", 1], ["5N", "Adjustments on account of other reasons (+/-)", 1]],
  st(fy, reg){ const b = S.books; b.gst9c = b.gst9c || {}; return b.gst9c[fy + "|" + reg] = b.gst9c[fy + "|" + reg] || {adj: {}, reasons: {}}; },
  build(fy, reg){
    const d9 = GST9.build(fy, reg), st = this.st(fy, reg), T = d9.T;
    // 5A: the turnover of this registration in the books, net of credit notes; replace it with the audited figure
    const booksTurnover = r2(T["5N"].taxable - T["4G"].taxable - T["4F"].taxable);
    const a5 = st.turnover != null && st.turnover !== "" ? num(st.turnover) : booksTurnover;
    // 5C: advances on which tax was paid and not yet billed, as in table 4F, unless typed
    const def = {"5C": T["4F"].taxable}, adjOf = k => st.adj[k] != null && st.adj[k] !== "" ? num(st.adj[k]) : (def[k] || 0);
    let o5 = a5; this.ADJ.forEach(([k, , sg]) => { o5 += sg * adjOf(k); });
    o5 = r2(o5);
    const p5 = r2(T["5N"].taxable - T["4G"].taxable);
    const zero = r2(T["5A"].taxable + T["5B"].taxable), exempt = r2(T["5D"].taxable + T["5E"].taxable + T["5F"].taxable - T["5H"].taxable), rcm = T["5C"].taxable;
    const e7 = r2(o5 - exempt - zero - rcm), f7 = r2(T["4N"].taxable - T["4G"].taxable);
    // 9: tax by rate in the books against the annual return (the same months, so a difference is an adjustment above)
    const rates = {};
    d9.inBooks.forEach(m => GSTR.partsOf(GSTR.outward(m, reg).filter(r => r.cls === "taxable" && !r.rcm)).forEach(q => { const r = q.row, k = String(q.rate), x = rates[k] = rates[k] || {rate: q.rate, taxable: 0, tax: 0}; const sg = r.kind === "CDNR" ? -1 : 1; x.taxable = r2(x.taxable + sg * q.taxable); x.tax = r2(x.tax + sg * (q.igst + q.cgst + q.sgst + q.cess)); }));
    // 12: credit in the books against the annual return
    const itcBooks = st.itcBooks != null && st.itcBooks !== "" ? num(st.itcBooks) : r2(T["6I"].igst + T["6I"].cgst + T["6I"].sgst + T["6I"].cess - T["6C"].igst - T["6C"].cgst - T["6C"].sgst - T["6D"].igst - T["6D"].cgst - T["6D"].sgst);
    const d12 = r2(itcBooks + num(st.adj["12B"]) - num(st.adj["12C"])), e12 = r2(T["7J"].igst + T["7J"].cgst + T["7J"].sgst + T["7J"].cess);
    return {d9, st, a5, booksTurnover, def, adjOf, o5, p5, q5: r2(o5 - p5), zero, exempt, rcm, e7, f7, g7: r2(e7 - f7), rates: Object.values(rates).sort((a, c) => a.rate - c.rate),
      itcBooks, d12, e12, f12: r2(d12 - e12)};
  }
};

