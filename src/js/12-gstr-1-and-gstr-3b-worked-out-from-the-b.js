/* ================================================================== */
/* GSTR-1 and GSTR-3B, worked out from the books and the ledger setup */
/* ================================================================== */
const STATE_CODES = {"JAMMU AND KASHMIR": "01", "HIMACHAL PRADESH": "02", "PUNJAB": "03", "CHANDIGARH": "04", "UTTARAKHAND": "05", "HARYANA": "06", "DELHI": "07",
  "RAJASTHAN": "08", "UTTAR PRADESH": "09", "BIHAR": "10", "SIKKIM": "11", "ARUNACHAL PRADESH": "12", "NAGALAND": "13", "MANIPUR": "14", "MIZORAM": "15",
  "TRIPURA": "16", "MEGHALAYA": "17", "ASSAM": "18", "WEST BENGAL": "19", "JHARKHAND": "20", "ODISHA": "21", "CHHATTISGARH": "22", "MADHYA PRADESH": "23",
  "GUJARAT": "24", "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "26", "MAHARASHTRA": "27", "KARNATAKA": "29", "GOA": "30", "LAKSHADWEEP": "31",
  "KERALA": "32", "TAMIL NADU": "33", "PUDUCHERRY": "34", "ANDAMAN AND NICOBAR ISLANDS": "35", "TELANGANA": "36", "ANDHRA PRADESH": "37", "LADAKH": "38", "OTHER TERRITORY": "97"};
const GSTR = {
  ym(d){ return String(d).slice(0, 6); },
  months(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    return Array.from(new Set(b.vouchers.map(v => this.ym(v.date)).filter(x => x.length === 6))).sort();
  },
  label(ym){ return fmtDate(ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-01").replace(/^\d+\s/, ""); },
  regOf(v){
    let r = "";
    for (const e of v.ent){ const m = Books.ledgerOf(e.l); if ((m.kind === "gst" || m.kind === "gst_common" || m.kind === "ineligible") && m.reg){ if (r && r !== m.reg){ r = ""; break; } r = m.reg; } }
    return r || String(v.cmp || "").slice(0, 2);
  },
  // one row per invoice and rate, from the sales side
  outward(ym, reg){
    const b = S.books, out = [];
    (b.vouchers || []).forEach(v => {
      if (!Books.isSale(v)) return;
      if (ym && this.ym(v.date) !== ym) return;
      if (reg && this.regOf(v) !== reg) return;
      const L = Books.lines(v);
      const tax = r2(L.tax.CGST + L.tax.SGST + L.tax.IGST);
      if (!L.taxable && !tax) return;
      const note = /CREDIT NOTE/i.test(v.type) ? "credit" : /DEBIT NOTE/i.test(v.type) ? "debit" : "";
      const exp = /EXPORT/i.test(v.type);
      const gstin = (v.gstin || "").toUpperCase();
      const parts = L.parts || [];
      const rate = parts.length === 1 ? parts[0].rate : L.taxable ? Books.snapRate(Math.round(tax / L.taxable * 10000) / 100) : 0;
      const cls = Books.supplyClass(v);
      const interState = !!(gstin && v.cmp && gstin.slice(0, 2) !== String(v.cmp).slice(0, 2)) || (!gstin && v.pos && v.pos !== (b.stateOf || v.pos) && L.igst > 0);
      const b2cl = !gstin && L.igst > 0 && L.total > 250000;
      out.push({id: v.id, date: v.date, no: v.no || v.ref || "", party: v.party, gstin, pos: v.pos || "",
        cls, rcm: Books.isRcm(v), hsn: (parts[0] && parts[0].hsn) || (v.hsn || [])[0] || "", supply: (parts[0] && parts[0].supply) || v.supply || "", eco: "", tcs: 0, parts, mixed: new Set(parts.map(q => q.rate)).size > 1,
        kind: note ? (note === "credit" ? "CDNR" : "DBNR") : (cls === "export" || cls === "sez") ? "EXP" : (cls === "exempt" || cls === "nil" || cls === "nongst") ? "NIL" : gstin ? "B2B" : b2cl ? "B2CL" : "B2C",
        taxable: L.taxable, cgst: L.tax.CGST, sgst: L.tax.SGST, igst: L.tax.IGST, cess: L.tax.CESS,
        rate, total: L.total, note, type: v.type});
    });
    return out.concat(this.fromSales(ym)).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // invoices that came from a marketplace, kept in Sales
  fromSales(ym){
    const s = S.sales;
    if (!s || s.cid !== S.coId) return [];
    return (s.list || []).filter(v => v.source === "market" && v.status !== "ignored").map(v => {
      const x = v.x || {}, d = String(x.date || "").replace(/-/g, "");
      if (ym && d.slice(0, 6) !== ym) return null;
      const tax = r2(num(x.cgst) + num(x.sgst) + num(x.igst));
      return {id: v.id, date: d, no: x.number || "", party: x.customerName || "", gstin: (x.customerGstin || "").toUpperCase(),
        pos: x.placeOfSupply || "", cls: "taxable", rcm: false, hsn: x.hsn || "", supply: "", eco: x.ecommerce || "market",
        tcs: num(x.tcs), kind: x.noteKind === "credit" ? "CDNR" : (x.customerGstin ? "B2B" : "B2C"), note: x.noteKind || "",
        taxable: num(x.taxable), cgst: num(x.cgst), sgst: num(x.sgst), igst: num(x.igst), cess: num(x.cess),
        rate: num(x.rate) || (num(x.taxable) ? Math.round(tax / num(x.taxable) * 10000) / 100 : 0), total: num(x.total)};
    }).filter(Boolean);
  },
  // the purchase side, for the credit in 3B: every bill, and every journal or payment that takes input tax
  // (an expense booked in a journal, bank charges, reverse charge on rent); not the month's set-off,
  // and not tax only moved between ledgers (to a control account, or a rounding)
  inward(ym, reg){
    const b = S.books, out = [], gst = b.gstins || {};
    (b.vouchers || []).forEach(v => {
      if (Books.isSale(v)) return;
      if (ym && this.ym(v.date) !== ym) return;
      const purch = Books.isPurchase(v);
      let inTax = false, outTax = false, signed = 0;
      v.ent.forEach(e => { const m = Books.ledgerOf(e.l);
        if (((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") || m.kind === "ineligible"){ inTax = true; signed += e.a; }
        else if ((m.kind === "gst" || m.kind === "gst_common") && m.side === "output" && !m.rcm) outTax = true; });
      if (!purch && (!inTax || outTax)) return;
      if (reg && this.regOf(v) !== reg) return;
      const L = Books.lines(v);
      const tax = r2(L.tax.CGST + L.tax.SGST + L.tax.IGST + L.tax.CESS);
      const rcm = Books.isRcm(v);
      let party = v.party, gstin = String(v.gstin || gst[v.party] || "").toUpperCase(), taxable = L.taxable, parts = L.parts || [], guessed = false;
      if (!purch){
        // a journal or payment: the value is what sits on the same side as the tax
        if (!gstin){ const e = v.ent.find(x => gst[x.l]); if (e){ party = e.l; gstin = String(gst[e.l]).toUpperCase(); } }
        taxable = 0;
        v.ent.forEach(e => { if (e.l !== party && !Books.ledgerOf(e.l).kind && (e.a < 0) === (signed < 0)) taxable = r2(taxable + Math.abs(e.a)); });
        if (!taxable && !gstin && !rcm) return;
        if (!taxable && rcm){ const rt = num((String(v.narr || "").match(/@\s*(\d+(?:\.\d+)?)\s*%/) || [])[1]) || 18; taxable = r2((tax - L.tax.CESS) * 100 / rt); guessed = true; }
        const rt = taxable ? Books.snapRate(Math.round(r2(tax - L.tax.CESS) / taxable * 10000) / 100) : 0;
        parts = [{rate: rt, hsn: parts[0] ? parts[0].hsn : "", supply: v.supply || "", taxable, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, cess: L.tax.CESS, guessed}];
      }
      if (!taxable && !tax) return;
      out.push({id: v.id, date: v.date, no: v.ref || v.no || "", voucher: v.no || "", type: v.type, party, gstin, refDate: v.refDate || "",
        taxable, cgst: L.tax.CGST, sgst: L.tax.SGST, igst: L.tax.IGST, cess: L.tax.CESS, parts, valueGuessed: guessed, bill: purch,
        cls: Books.supplyClass(v), rcm, import: Books.isImport(v), supply: v.supply || (parts[0] && parts[0].supply) || "",
        blocked: !!v.ineligibleFlag, hsn: (parts[0] && parts[0].hsn) || (v.hsn || [])[0] || "",
        ineligible: L.ineligible || 0, common: L.common || null, dir: this.itcDir(v), note: this.itcDir(v) < 0 ? "debit" : "", narr: v.narr || ""});
    });
    return out;
  },
  sum(rows){
    return rows.reduce((a, r) => ({n: a.n + 1, taxable: r2(a.taxable + num(r.taxable)), cgst: r2(a.cgst + num(r.cgst)),
      sgst: r2(a.sgst + num(r.sgst)), igst: r2(a.igst + num(r.igst)), cess: r2(a.cess + num(r.cess)),
      ineligible: r2(a.ineligible + num(r.ineligible))}), {n: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, ineligible: 0});
  },
  // GSTR-1, in the parts the return itself has
  one(ym, reg){
    const rows = this.outward(ym, reg);
    const part = k => rows.filter(r => r.kind === k);
    const byRate = list => {
      const m = {};
      this.partsOf(list).forEach(q => { const k = String(q.rate); (m[k] = m[k] || []).push(q); });
      return Object.entries(m).sort((a, c) => num(a[0]) - num(c[0])).map(([rate, rs]) => Object.assign({rate: num(rate)}, this.sum(rs)));
    };
    // the HSN summary, split into supplies to registered and unregistered persons as table 12 now asks;
    // a credit note takes its value off
    const hsnRows = {};
    this.partsOf(rows.filter(r => r.cls === "taxable" || r.cls === "export" || r.cls === "sez" || r.cls === "exempt" || r.cls === "nil")).forEach(q => {
      const key = (q.hsn || "no HSN") + "|" + q.rate, sg = q.row.kind === "CDNR" ? -1 : 1, reg2 = q.row.gstin ? "b2b" : "b2c";
      const h = hsnRows[key] = hsnRows[key] || {hsn: q.hsn || "", rate: q.rate, supply: q.supply, n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, b2b: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}, b2c: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}};
      h.n++; ["taxable", "igst", "cgst", "sgst", "cess"].forEach(f => { h[f] = r2(h[f] + sg * num(q[f])); h[reg2][f] = r2(h[reg2][f] + sg * num(q[f])); });
      if (!h.supply) h.supply = q.supply;
    });
    const series = {};
    rows.forEach(r => {
      const pre = String(r.no).replace(/\d+$/, ""), sr = series[pre] = series[pre] || {pre, from: r.no, to: r.no, n: 0, cancelled: 0};
      sr.n++;
      if (String(r.no) < String(sr.from)) sr.from = r.no;
      if (String(r.no) > String(sr.to)) sr.to = r.no;
    });
    const eco = rows.filter(r => r.eco);
    const ecoBy = {};
    eco.forEach(r => {
      const k = r.eco, e = ecoBy[k] = ecoBy[k] || {eco: k, n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tcs: 0};
      e.n++; e.taxable = r2(e.taxable + r.taxable); e.igst = r2(e.igst + r.igst); e.cgst = r2(e.cgst + r.cgst);
      e.sgst = r2(e.sgst + r.sgst); e.cess = r2(e.cess + r.cess); e.tcs = r2(e.tcs + num(r.tcs));
    });
    return {rows, eco, ecoBy: Object.values(ecoBy), b2b: part("B2B"), b2cl: part("B2CL"), b2c: part("B2C"), cdnr: part("CDNR").concat(part("DBNR")),
      exp: part("EXP"), nil: part("NIL"), rcm: rows.filter(r => r.rcm),
      b2cRates: byRate(part("B2C")), hsn: Object.values(hsnRows).sort((a, c) => c.taxable - a.taxable),
      series: Object.values(series), total: this.sum(rows)};
  },
  // each row's rate and HSN parts; a row with none is one part at its own rate
  partsOf(rows){
    const out = [];
    rows.forEach(r => { const ps = r.parts && r.parts.length ? r.parts : [{rate: r.rate, hsn: r.hsn, supply: r.supply, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess}];
      ps.forEach(q => out.push(Object.assign({}, q, {row: r, n: 1, ineligible: 0}))); });
    return out;
  },
  // GSTR-3B: what goes out, what comes in, and what is left to pay
  // which way a purchase-side voucher moves credit: input tax debited adds to it (a bill, or the supplier's debit note);
  // input tax credited takes it away (the supplier's credit note, or a return), whatever the voucher type is called
  itcDir(v){
    let signed = 0;
    v.ent.forEach(e => { const m = Books.ledgerOf(e.l); if (((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") || m.kind === "ineligible") signed += e.a; });
    return signed > 0.004 ? -1 : signed < -0.004 ? 1 : (/DEBIT NOTE/i.test(v.type) ? -1 : 1);
  },
  signedIn(r){ return r.dir < 0 ? Object.assign({}, r, {taxable: -r.taxable, cgst: -r.cgst, sgst: -r.sgst, igst: -r.igst, cess: -r.cess, ineligible: -(r.ineligible || 0)}) : r; },
  threeB(ym, reg){
    const out = this.outward(ym, reg), inn = this.inward(ym, reg).map(r => this.signedIn(r));
    const S1 = f => this.sum(out.filter(f)), S2 = f => this.sum(inn.filter(f));
    const taxableOut = S1(r => r.cls === "taxable" && r.kind !== "CDNR");
    const cn = S1(r => r.kind === "CDNR");
    const zero = S1(r => r.cls === "export" || r.cls === "sez");
    const nil = S1(r => r.cls === "exempt" || r.cls === "nil");
    const nongst = S1(r => r.cls === "nongst");
    const rcmOut = S2(r => r.rcm || (r.import && r.supply !== "Goods"));   // 3.1(d): tax we pay on inward supplies, imported services included
    const rcmIn = S2(r => r.rcm && !r.import);                      // 4(A)(3): the credit of that tax, other than on imports
    const toUnreg = S1(r => !r.gstin && r.igst > 0);                 // 3.2 inter-state to unregistered
    const impGoods = S2(r => r.import && r.supply === "Goods");
    const impServ = S2(r => r.import && r.supply !== "Goods");
    const other = S2(r => !r.import && !r.rcm);
    const blocked = S2(r => r.blocked);
    const adv = GSTAdv.month(ym, reg).net;                           // 11A less 11B goes into 3.1(a)
    const rul = GSTRev.month(ym, reg);                               // rules 42 and 43 go into 4(B)(1)
    const net = {taxable: r2(taxableOut.taxable - cn.taxable + adv.taxable), cgst: r2(taxableOut.cgst - cn.cgst + adv.cgst), sgst: r2(taxableOut.sgst - cn.sgst + adv.sgst),
      igst: r2(taxableOut.igst - cn.igst + adv.igst), cess: r2(taxableOut.cess - cn.cess + adv.cess)};
    const itc = {cgst: r2(impGoods.cgst + impServ.cgst + rcmIn.cgst + other.cgst), sgst: r2(impGoods.sgst + impServ.sgst + rcmIn.sgst + other.sgst),
                 igst: r2(impGoods.igst + impServ.igst + rcmIn.igst + other.igst), cess: r2(impGoods.cess + impServ.cess + rcmIn.cess + other.cess)};
    const reversal = {cgst: r2(blocked.cgst + this.sum(inn).ineligible ? blocked.cgst : blocked.cgst), sgst: blocked.sgst, igst: blocked.igst, cess: blocked.cess};
    const rules = rul.total;
    const netItc = {cgst: r2(itc.cgst - reversal.cgst - rules.cgst), sgst: r2(itc.sgst - reversal.sgst - rules.sgst), igst: r2(itc.igst - reversal.igst - rules.igst), cess: r2(itc.cess - reversal.cess - rules.cess)};
    const opening = this.creditIn(ym, reg);
    const pay = this.setOff(net, rcmOut, netItc, opening);
    return {sale: taxableOut, cn, net, adv, rules, r42: rul.r42, r43: rul.r43, zero, nil, nongst, rcmOut, rcmIn, toUnreg, impGoods, impServ, other, blocked,
      buy: this.sum(inn), itc, reversal, netItc, ineligible: this.sum(inn).ineligible, opening, pay, payable: pay.cash};
  },
  HEADS: ["igst", "cgst", "sgst", "cess"],
  // payment of tax, sections 49 and 49A with rule 88A: IGST credit first against IGST, what is left of it against
  // CGST and SGST; only then CGST credit against CGST and then IGST, SGST credit against SGST and then IGST;
  // CGST never against SGST, cess only against cess. Reverse charge is paid in cash. Credit left over is carried.
  setOff(liab, rcm, credit, opening){
    const L = {}, C = {}, use = {igst: {igst: 0, cgst: 0, sgst: 0}, cgst: {cgst: 0, igst: 0}, sgst: {sgst: 0, igst: 0}, cess: {cess: 0}};
    this.HEADS.forEach(h => { L[h] = Math.max(0, r2(num(liab[h]))); C[h] = Math.max(0, r2(num(credit[h]) + num((opening || {})[h]))); });
    // a negative figure (more credit notes than invoices in the month) is not tax to pay
    const take = (from, to, amt) => { const a = r2(Math.min(amt, C[from], L[to])); if (a > 0){ C[from] = r2(C[from] - a); L[to] = r2(L[to] - a); use[from][to] = r2(use[from][to] + a); } };
    take("igst", "igst", Infinity);
    // what IGST credit is left goes where CGST or SGST credit falls short, then to the rest
    take("igst", "cgst", Math.max(0, L.cgst - C.cgst)); take("igst", "sgst", Math.max(0, L.sgst - C.sgst));
    const half = r2(C.igst / 2); take("igst", "cgst", half); take("igst", "sgst", Infinity); take("igst", "cgst", Infinity);
    take("cgst", "cgst", Infinity); take("sgst", "sgst", Infinity);
    take("cgst", "igst", Infinity); take("sgst", "igst", Infinity);
    take("cess", "cess", Infinity);
    const cash = {}, rc = {};
    this.HEADS.forEach(h => { rc[h] = Math.max(0, r2(num((rcm || {})[h]))); cash[h] = r2(L[h] + rc[h]); });
    return {use, cash, rcmCash: rc, carry: C, due: liab};
  },
  // the credit carried into a month: the balance typed for the first month here, then each month's left-over
  creditIn(ym, reg){
    const b = S.books, key = [reg, b.vouchers && b.vouchers.length, b.mapV || 0, JSON.stringify((b.gstOpen || {})[reg || ""] || {}), JSON.stringify(b.gstRev || {}).length, JSON.stringify(b.gstAdv || {}).length].join("|");
    if (!this._carry || this._carry.key !== key || this._carry.v !== b.vouchers) this._carry = {key, v: b.vouchers, m: {}};
    if (this._carry.m[ym]) return this._carry.m[ym];
    const months = this.months(), i = months.indexOf(ym), open = (b.gstOpen || {})[reg || ""] || {};
    let bal = {igst: num(open.igst), cgst: num(open.cgst), sgst: num(open.sgst), cess: num(open.cess)};
    if (i > 0){ const prev = months[i - 1], t = this.threeB(prev, reg); bal = Object.assign({}, t.pay.carry); }
    this._carry.m[ym] = bal;
    return bal;
  },
  // what would be rejected or questioned, before it is filed
  checks(ym, reg){
    const out = this.outward(ym, reg), inn = this.inward(ym, reg), list = [];
    const add = (what, rows, how) => { if (rows.length) list.push({what, n: rows.length, how, rows: rows.slice(0, 5)}); };
    add("Invoices to a registered party with no GSTIN", out.filter(r => r.kind === "B2B" && !r.gstin), "Fill the GSTIN on the party ledger in Tally.");
    add("Outward invoices with no place of supply", out.filter(r => !r.pos && r.kind !== "NIL"), "Set the place of supply on the voucher.");
    add("Outward invoices with no HSN", out.filter(r => !r.hsn && r.cls === "taxable"), "HSN is needed in the GSTR-1 summary.");
    add("Tax that does not fit the taxable value", out.filter(r => r.taxable && this.partsOf([r]).some(q => !Books.GST_RATES.includes(q.rate))), "Check the rate on these invoices.");
    add("Invoices with items at more than one rate", out.filter(r => r.mixed), "Split rate by rate in the return, from each item's rate in Tally.");
    add("Purchases with no supplier GSTIN", inn.filter(r => !r.gstin && (r.cgst || r.sgst || r.igst)), "Needed to match against 2B.");
    add("Purchases marked ITC not to be taken", inn.filter(r => r.blocked), "These are kept out of the credit claimed.");
    add("Inward supplies under reverse charge", inn.filter(r => r.rcm), "Tax on these is payable by you and shown in 3.1(d).");
    if (GSTAdv.ready()){
      const a = GSTAdv.month(ym, reg);
      add("Advances where the rate was assumed at 18%", a.at.filter(r => r.rateFrom === "assumed").map(r => ({no: r.no, party: r.party})), "The customer has no invoice to take a rate from. Set it under Advances.");
      add("Advances kept on account, not counted", a.untaxed.filter(r => /on account/.test(r.why)).map(r => ({no: r.ref, party: r.party})), "Mark any that are advances under Advances.");
    }
    return list;
  },
  // the file the portal takes: GSTR-1 as JSON
  toJson(ym, reg, opts){
    const g = this.one(ym, reg);
    const gstin = ((S.books.meta || {}).gstins || []).find(x => !reg || x.slice(0, 2) === reg) || "";
    const dmy = d => String(d).length === 8 ? String(d).slice(6, 8) + "-" + String(d).slice(4, 6) + "-" + String(d).slice(0, 4) : d;
    // one item per rate on the invoice
    const items = r => { const m = {}; this.partsOf([r]).forEach(q => { const k = String(q.rate), x = m[k] = m[k] || {rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
        x.txval = r2(x.txval + num(q.taxable)); x.iamt = r2(x.iamt + num(q.igst)); x.camt = r2(x.camt + num(q.cgst)); x.samt = r2(x.samt + num(q.sgst)); x.csamt = r2(x.csamt + num(q.cess)); });
      return Object.values(m).sort((a, c) => a.rt - c.rt).map((x, i) => ({num: i + 1, itm_det: Object.assign({rt: x.rt, txval: x.txval, csamt: x.csamt}, r.igst ? {iamt: x.iamt} : {camt: x.camt, samt: x.samt})})); };
    const posOf = r => { const st = STATE_CODES[(r.pos || "").toUpperCase()] || (r.gstin || "").slice(0, 2); return String(st || "").padStart(2, "0"); };
    const byParty = (rows, wrap) => {
      const m = {};
      rows.forEach(r => { (m[r.gstin] = m[r.gstin] || []).push(r); });
      return Object.entries(m).map(([ctin, rs]) => ({ctin, [wrap]: rs.map(r => wrap === "nt" ? {
        ntty: r.note === "credit" ? "C" : "D", nt_num: String(r.no), nt_dt: dmy(r.date), val: r2(Math.abs(r.total)),
        pos: posOf(r), rchrg: r.rcm ? "Y" : "N", inv_typ: "R", itms: items(r)
      } : {
        inum: String(r.no), idt: dmy(r.date), val: r2(r.total), pos: posOf(r),
        rchrg: r.rcm ? "Y" : "N", inv_typ: r.cls === "sez" ? "SEWP" : "R", itms: items(r)
      })}));
    };
    const b2csMap = {};
    this.partsOf(g.b2c).forEach(q => { const r = q.row;
      const pos = posOf(r), key = pos + "|" + q.rate + "|" + (r.igst ? "INTER" : "INTRA");
      const x = b2csMap[key] = b2csMap[key] || {sply_ty: r.igst ? "INTER" : "INTRA", pos, typ: "OE", rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      x.txval = r2(x.txval + q.taxable); x.iamt = r2(x.iamt + q.igst); x.camt = r2(x.camt + q.cgst); x.samt = r2(x.samt + q.sgst); x.csamt = r2(x.csamt + q.cess);
    });
    const nilSum = g.nil.reduce((a, r) => ({expt_amt: r2(a.expt_amt + (r.cls === "exempt" ? r.taxable : 0)),
      nil_amt: r2(a.nil_amt + (r.cls === "nil" ? r.taxable : 0)), ngsup_amt: r2(a.ngsup_amt + (r.cls === "nongst" ? r.taxable : 0))}),
      {expt_amt: 0, nil_amt: 0, ngsup_amt: 0});
    const out = {gstin, fp: ym.slice(4, 6) + ym.slice(0, 4), version: "GST3.2.1", hash: "hash"};
    if (g.b2b.length) out.b2b = byParty(g.b2b, "inv");
    if (g.b2cl.length){
      const m = {};
      g.b2cl.forEach(r => { const pos = posOf(r); (m[pos] = m[pos] || []).push(r); });
      out.b2cl = Object.entries(m).map(([pos, rs]) => ({pos, inv: rs.map(r => ({inum: String(r.no), idt: dmy(r.date), val: r2(r.total), itms: items(r)}))}));
    }
    if (Object.keys(b2csMap).length) out.b2cs = Object.values(b2csMap);
    if (g.cdnr.length) out.cdnr = byParty(g.cdnr.filter(r => r.gstin), "nt");
    if (g.exp.length) out.exp = [{exp_typ: "WPAY", inv: g.exp.map(r => ({inum: String(r.no), idt: dmy(r.date), val: r2(r.total), itms: items(r)}))}];
    if (nilSum.expt_amt || nilSum.nil_amt || nilSum.ngsup_amt) out.nil = {inv: [Object.assign({sply_ty: "INTRB2B"}, nilSum)]};
    const adv = GSTAdv.month(ym, reg);
    if (adv.at.length) out.at = GSTAdv.json(adv.at);
    if (adv.txpd.length) out.txpd = GSTAdv.json(adv.txpd);
    // table 12: HSN with its rate; from May 2025 in two lists, supplies to registered (B2B) and to unregistered (B2C) persons
    const hsnLine = (h, x, i) => ({num: i + 1, hsn_sc: h.hsn || "", desc: h.supply || "", uqc: h.supply === "Goods" ? "NOS" : "OTH", qty: 0, rt: h.rate,
      val: r2(x.taxable + x.igst + x.cgst + x.sgst + x.cess), txval: r2(x.taxable), iamt: r2(x.igst), camt: r2(x.cgst), samt: r2(x.sgst), csamt: r2(x.cess)});
    if (g.hsn.length){
      if (ym >= "202505") out.hsn = {hsn_b2b: g.hsn.filter(h => Math.abs(h.b2b.taxable) >= 0.01).map((h, i) => hsnLine(h, h.b2b, i)), hsn_b2c: g.hsn.filter(h => Math.abs(h.b2c.taxable) >= 0.01).map((h, i) => hsnLine(h, h.b2c, i))};
      else out.hsn = {data: g.hsn.map((h, i) => hsnLine(h, h, i))};
    }
    if (g.series.length) out.doc_issue = {doc_det: [{doc_num: 1, docs: g.series.map((x, i) => ({num: i + 1, from: String(x.from), to: String(x.to), totnum: x.n, cancel: 0, net_issue: x.n}))}]};
    if (!(opts && opts.plain) && reg) GSTAmend.addTo(out, ym, reg);
    return out;
  },
  async toJsonFile(ym, reg){
    const j = this.toJson(ym, reg);
    // the copy kept here is what later months' amendments are measured against
    if (reg && j.gstin){ try { GSTAmend.keep(JSON.parse(JSON.stringify(j)), "downloaded"); saveBooks(); } catch (e){} }
    saveFile("GSTR1_" + (j.gstin || "") + "_" + j.fp + ".json", new Blob([JSON.stringify(j)], {type: "application/json"}));
    return j;
  },
  // GSTR-3B in the shape the portal takes
  threeBJson(ym, reg){
    const t = this.threeB(ym, reg);
    const gstin = ((S.books.meta || {}).gstins || []).find(x => !reg || x.slice(0, 2) === reg) || "";
    const sup = (txval, iamt, camt, samt, csamt) => ({txval: r2(txval), iamt: r2(iamt), camt: r2(camt), samt: r2(samt), csamt: r2(csamt)});
    const out = {gstin, ret_period: ym.slice(4, 6) + ym.slice(0, 4),
      sup_details: {
        osup_det: sup(t.net.taxable, t.net.igst, t.net.cgst, t.net.sgst, t.net.cess),
        osup_zero: sup(t.zero.taxable, t.zero.igst, 0, 0, t.zero.cess),
        osup_nil_exmp: {txval: r2(t.nil.taxable)},
        isup_rev: sup(t.rcmOut.taxable, t.rcmOut.igst, t.rcmOut.cgst, t.rcmOut.sgst, t.rcmOut.cess),
        osup_nongst: {txval: r2(t.nongst.taxable)}
      },
      itc_elg: {itc_avl: [
        {ty: "IMPG", iamt: r2(t.impGoods.igst), camt: 0, samt: 0, csamt: r2(t.impGoods.cess)},
        {ty: "IMPS", iamt: r2(t.impServ.igst), camt: 0, samt: 0, csamt: r2(t.impServ.cess)},
        {ty: "ISRC", iamt: r2(t.rcmOut.igst), camt: r2(t.rcmOut.cgst), samt: r2(t.rcmOut.sgst), csamt: r2(t.rcmOut.cess)},
        {ty: "OTH", iamt: r2(t.other.igst), camt: r2(t.other.cgst), samt: r2(t.other.sgst), csamt: r2(t.other.cess)}
      ], itc_rev: [{ty: "RUL", iamt: r2(t.rules.igst), camt: r2(t.rules.cgst), samt: r2(t.rules.sgst), csamt: r2(t.rules.cess)},
        {ty: "OTH", iamt: r2(t.reversal.igst), camt: r2(t.reversal.cgst), samt: r2(t.reversal.sgst), csamt: r2(t.reversal.cess)}],
        itc_net: sup(0, t.netItc.igst, t.netItc.cgst, t.netItc.sgst, t.netItc.cess)}
    };
    if (t.toUnreg.taxable) out.inter_sup = {unreg_details: [{pos: "", txval: r2(t.toUnreg.taxable), iamt: r2(t.toUnreg.igst)}]};
    return out;
  },
  async toExcel(ym, reg){
    await ensureXlsx();
    const g = this.one(ym, reg), t = this.threeB(ym, reg);
    const d = s => String(s).length === 8 ? String(s).slice(6, 8) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(0, 4) : s;
    const cols = ["GSTIN", "Party", "Invoice no.", "Date", "Place of supply", "Rate", "Taxable", "IGST", "CGST", "SGST", "Cess", "Invoice value"];
    const line = r => [r.gstin, r.party, r.no, d(r.date), r.pos, r.rate, r.taxable, r.igst, r.cgst, r.sgst, r.cess, r.total];
    const wb = XLSX.utils.book_new();
    const add = (name, head, body) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(body)), name);
    add("B2B", cols, g.b2b.map(line));
    add("B2C large", cols, g.b2cl.map(line));
    add("B2C small", cols, g.b2c.map(line));
    if (g.nil.length) add("Nil, exempt, non-GST", cols, g.nil.map(line));
    if (g.rcm.length) add("Reverse charge", cols, g.rcm.map(line));
    add("Credit and debit notes", cols.concat(["Kind"]), g.cdnr.map(r => line(r).concat([r.note])));
    if (g.exp.length) add("Exports", cols, g.exp.map(line));
    add("HSN summary", ["HSN", "Goods or services", "Rate", "Invoices", "Taxable", "IGST", "CGST", "SGST", "Cess"], g.hsn.map(h => [h.hsn, h.supply, h.rate, h.n, h.taxable, h.igst, h.cgst, h.sgst, h.cess]));
    add("Documents issued", ["Series", "From", "To", "Issued"], g.series.map(x => [x.pre, x.from, x.to, x.n]));
    {
      const a = GSTAdv.month(ym, reg), ah = ["Date", "Receipt", "Customer", "GSTIN", "Bill ref", "Received", "Rate", "Rate from", "Place of supply", "Advance less tax", "IGST", "CGST", "SGST"];
      const al = r => [d(r.date), r.no, r.party, r.gstin, r.ref, r.received, r.rate, r.rateFrom, r.pos, r.taxable, r.igst, r.cgst, r.sgst];
      if (a.at.length) add("11A Advances received", ah, a.at.map(al));
      if (a.txpd.length) add("11B Advances adjusted", ["Adjusted on", "By"].concat(ah), a.txpd.map(r => [d(r.adjDate), r.by].concat(al(r))));
    }
    add("Before filing", ["What", "How many", "What to do"], GSTR.checks(ym, reg).map(c => [c.what, c.n, c.how]));
    if (reg){
      const p = GSTAmend.pending(ym, reg);
      if (p.rows.length) add("Amendments", ["Month filed", "Document", "GSTIN", "Number", "Date", "Taxable now", "What differs", "Reported as"],
        p.rows.map(r => { const x = r.now || r.was; return [GSTR.label(r.P), x.kind, x.ctin || "", x.num, d(x.date), r.now ? r.now.txval : 0, r.changes.join("; "), r.act]; }));
    }
    add("GSTR-3B", ["", "Taxable", "IGST", "CGST", "SGST", "Cess"], [
      ["3.1(a) Outward taxable supplies", t.sale.taxable, t.sale.igst, t.sale.cgst, t.sale.sgst, t.sale.cess],
      ["Add: tax on advances, 11A less 11B", t.adv.taxable, t.adv.igst, t.adv.cgst, t.adv.sgst, t.adv.cess],
      ["Less: credit notes", -t.cn.taxable, -t.cn.igst, -t.cn.cgst, -t.cn.sgst, -t.cn.cess],
      ["3.1(b) Zero rated: exports and SEZ", t.zero.taxable, t.zero.igst, t.zero.cgst, t.zero.sgst, t.zero.cess],
      ["3.1(c) Nil rated and exempt", t.nil.taxable, "", "", "", ""],
      ["3.1(d) Inward on reverse charge", t.rcmOut.taxable, t.rcmOut.igst, t.rcmOut.cgst, t.rcmOut.sgst, t.rcmOut.cess],
      ["3.1(e) Non-GST outward", t.nongst.taxable, "", "", "", ""],
      ["3.2 Inter-state to unregistered", t.toUnreg.taxable, t.toUnreg.igst, "", "", ""],
      [], ["4(A)(1) Import of goods", t.impGoods.taxable, t.impGoods.igst, t.impGoods.cgst, t.impGoods.sgst, t.impGoods.cess],
      ["4(A)(2) Import of services", t.impServ.taxable, t.impServ.igst, t.impServ.cgst, t.impServ.sgst, t.impServ.cess],
      ["4(A)(3) Inward on reverse charge", t.rcmOut.taxable, t.rcmOut.igst, t.rcmOut.cgst, t.rcmOut.sgst, t.rcmOut.cess],
      ["4(A)(5) All other ITC", t.other.taxable, t.other.igst, t.other.cgst, t.other.sgst, t.other.cess],
      ["4(B)(1) Reversed: rule 42", "", t.r42.igst, t.r42.cgst, t.r42.sgst, t.r42.cess],
      ["4(B)(1) Reversed: rule 43", "", t.r43.igst, t.r43.cgst, t.r43.sgst, t.r43.cess],
      ["4(B)(2) Reversed: ITC not to be taken", t.blocked.taxable, t.reversal.igst, t.reversal.cgst, t.reversal.sgst, t.reversal.cess],
      ["4(C) Net ITC available", "", t.netItc.igst, t.netItc.cgst, t.netItc.sgst, t.netItc.cess],
      [], ["Tax payable", "", t.payable.igst, t.payable.cgst, t.payable.sgst, t.payable.cess]]);
    const outBin = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-GSTR1-3B-" + (ym || "all") + (reg ? "-" + reg : "") + ".xlsx",
      new Blob([outBin], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

