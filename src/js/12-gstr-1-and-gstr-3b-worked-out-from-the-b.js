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
  // the months of the books; with no day book, the year before and this year up to last month, so the GST tab works
  // from its registrations alone
  months(){
    const b = S.books;
    if (!b) return [];
    const seen = Array.from(new Set((b.vouchers || []).map(v => this.ym(v.date)).filter(x => x.length === 6))).sort();
    // every month from the books' first to their last, with or without entries (review of 01-Oct-2026: Apr-Jun 2026 were
    // missing because no entry fell in them)
    const m = [];
    if (seen.length){ let x = seen[0]; while (x <= seen[seen.length - 1] && m.length < 240){ m.push(x); x = this.nextYm(x); } }
    if (m.length || !this.gstins(b).length) return m;
    const d = new Date(), y = d.getFullYear(), mo = d.getMonth() + 1, fy = mo >= 4 ? y : y - 1, out = [];
    let x = (fy - 1) + "04"; const last = (mo === 1 ? (y - 1) + "12" : y + String(mo - 1).padStart(2, "0"));
    while (x <= last){ out.push(x); x = this.nextYm(x); }
    return out;
  },
  // the client's registrations: read from Tally, added in GST settings, and its own GSTIN
  gstins(b){
    b = b || S.books || {};
    const co = typeof CO === "function" ? CO() : null, own = co && (!b.cid || b.cid === co.id) ? String(co.gstin || "").toUpperCase().trim() : "";
    const all = [].concat(((b.meta || {}).gstins) || [], (b.gstRegs || []).map(r => r.gstin), /^\d{2}[A-Z0-9]{13}$/.test(own) ? [own] : []);
    return Array.from(new Set(all.map(g => String(g).toUpperCase()).filter(g => /^\d{2}[A-Z0-9]{13}$/.test(g))));
  },
  inP(date, per){ const m = String(date).slice(0, 6), p = String(per); return p.length > 6 ? m >= p.slice(0, 6) && m <= p.slice(7, 13) : m === p; },
  pStart(per){ return String(per).slice(0, 6); },
  pEnd(per){ const p = String(per); return p.length > 6 ? p.slice(7, 13) : p; },
  expand(per){ const out = []; let m = this.pStart(per); const e = this.pEnd(per); while (m <= e){ out.push(m); m = this.nextYm(m); } return out; },
  nextYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  // a month as "Apr-2025" (the date format of the rest of FinCom, without the day)
  label(ym){ return fmtDate(ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-01").replace(/^\d+[-\s]/, ""); },
  regOf(v){
    let r = "";
    for (const e of v.ent){ const m = Books.ledgerOf(e.l); if ((m.kind === "gst" || m.kind === "gst_common" || m.kind === "ineligible") && m.reg){ if (r && r !== m.reg){ r = ""; break; } r = m.reg; } }
    return r || String(v.cmp || "").slice(0, 2);
  },
  // the entries of one month (build 193): from an index made once per drawing or calculation, not the whole year each time
  // the entries GST is worked out from. Optional entries are memoranda in Tally, not in the books, and never in a return
  // (review of 01-Oct-2026: GSTR-1 counted 13 Optional sales of one client, each also entered as a regular invoice: their
  // tax twice; the server's GST summary, which leaves them out, showed it). Cancelled entries are left out too (review of
  // 02-Oct-2026: as the server's summary and MIS do); table 13 counts their numbers on its own
  vIn(ym){
    const all = (S.books.vouchers || []).filter(v => !v.opt && !v.cancel);
    if (typeof perRender !== "function" || !ym || String(ym).length !== 6) return all;
    return perRender(this, "byMonth", () => { const m = {}; all.forEach(v => { const k = String(v.date).slice(0, 6); (m[k] = m[k] || []).push(v); }); return m; })[ym] || [];
  },
  // one row per invoice and rate, from the sales side
  outward(ym, reg){
    const b = S.books, out = [];
    this.vIn(ym).forEach(v => {
      if (!Books.isSale(v)) return;
      if (ym && !this.inP(v.date, ym)) return;
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
      const interState = !!(gstin && v.cmp && gstin.slice(0, 2) !== String(v.cmp).slice(0, 2)) || (!gstin && v.pos && v.pos !== (b.stateOf || v.pos) && L.tax.IGST > 0);
      // B2C large: inter-state to an unregistered person above Rs 1 lakh from 1 August 2024 (Rs 2.5 lakh before)
      const b2cl = !gstin && L.tax.IGST > 0 && L.total > (String(v.date) >= "20240801" ? 100000 : 250000);
      out.push({id: v.id, date: v.date, no: v.no || v.ref || "", party: v.party, gstin, pos: v.pos || "",
        cls, rcm: Books.isRcm(v), hsn: (parts[0] && parts[0].hsn) || (v.hsn || [])[0] || "", supply: (parts[0] && parts[0].supply) || v.supply || "", eco: "", tcs: 0, parts, mixed: new Set(parts.map(q => q.rate)).size > 1,
        kind: note ? (note === "credit" ? "CDNR" : "DBNR") : cls === "export" ? "EXP" : (cls === "sez" && gstin) ? "B2B" : cls === "sez" ? "EXP" : (cls === "exempt" || cls === "nil" || cls === "nongst") ? "NIL" : gstin ? "B2B" : b2cl ? "B2CL" : "B2C",
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
      if (ym && !GSTR.inP(d, ym)) return null;
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
    this.vIn(ym).forEach(v => {
      if (Books.isSale(v)) return;
      if (ym && !this.inP(v.date, ym)) return;
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
      let party = v.party, gstin = String(v.gstin || gst[v.party] || "").toUpperCase(), taxable = L.taxable, parts = L.parts || [], guessed = false, taxOnly = false;
      if (!purch){
        // a journal or payment: the value is what sits on the same side as the tax
        if (!gstin){ const e = v.ent.find(x => gst[x.l]); if (e){ party = e.l; gstin = String(gst[e.l]).toUpperCase(); } }
        taxable = 0;
        v.ent.forEach(e => { if (e.l !== party && !Books.ledgerOf(e.l).kind && (e.a < 0) === (signed < 0)) taxable = r2(taxable + Math.abs(e.a)); });
        // an entry with only an input-tax line and no supplier GSTIN (a bank payment with only IGST) still takes input tax
        // (request of 02-Oct-2026: it was dropped here and in the server's summary); it is marked so the lists can say why
        // it can never be in 2B
        if (!taxable && !gstin && !rcm) taxOnly = true;
        if (!taxable && rcm){ const rt = num((String(v.narr || "").match(/@\s*(\d+(?:\.\d+)?)\s*%/) || [])[1]) || 18; taxable = r2((tax - L.tax.CESS) * 100 / rt); guessed = true; }
        const rt = taxable ? Books.snapRate(Math.round(r2(tax - L.tax.CESS) / taxable * 10000) / 100) : 0;
        parts = [{rate: rt, hsn: parts[0] ? parts[0].hsn : "", supply: v.supply || "", taxable, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, cess: L.tax.CESS, guessed}];
      }
      if (!taxable && !tax) return;
      out.push({id: v.id, date: v.date, no: Books.supInv(v), voucher: v.no || "", type: v.type, party, gstin, refDate: v.refDate || "",
        taxable, cgst: L.tax.CGST, sgst: L.tax.SGST, igst: L.tax.IGST, cess: L.tax.CESS, parts, valueGuessed: guessed, bill: purch,
        cls: Books.supplyClass(v), rcm, import: Books.isImport(v), supply: v.supply || (parts[0] && parts[0].supply) || "",
        blocked: !!v.ineligibleFlag, hsn: (parts[0] && parts[0].hsn) || (v.hsn || [])[0] || "",
        ineligible: L.ineligible || 0, common: L.common || null, dir: this.itcDir(v), note: this.itcDir(v) < 0 ? "debit" : "", narr: v.narr || "", taxOnly});
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
      const h = hsnRows[key] = hsnRows[key] || {hsn: q.hsn || "", rate: q.rate, supply: q.supply, desc: q.desc || "", unit: q.unit || "", n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0,
        b2b: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}, b2c: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}};
      h.n++; ["taxable", "igst", "cgst", "sgst", "cess", "qty"].forEach(f => { h[f] = r2(h[f] + sg * num(q[f])); h[reg2][f] = r2(h[reg2][f] + sg * num(q[f])); });
      if (!h.supply) h.supply = q.supply; if (!h.desc) h.desc = q.desc || ""; if (!h.unit) h.unit = q.unit || "";
    });
    // documents issued (table 13), by nature: invoices 1, debit notes 4, credit notes 5; cancelled numbers counted in their series
    const series = {}, natOf = r => r.kind === "CDNR" ? 5 : r.kind === "DBNR" ? 4 : 1;
    const inSeries = (no, nat, cancelled) => {
      const pre = String(no).replace(/\d+[A-Za-z]?$/, ""), k = nat + "|" + pre, sr = series[k] = series[k] || {nat, pre, from: no, to: no, n: 0, cancelled: 0};
      sr.n++; if (cancelled) sr.cancelled++;
      const key = x => pre + String(String(x).slice(pre.length)).padStart(12, "0");
      if (key(no) < key(sr.from)) sr.from = no;
      if (key(no) > key(sr.to)) sr.to = no;
    };
    rows.filter(r => r.no && !r.eco).forEach(r => inSeries(r.no, natOf(r), false));
    ((S.books || {}).vouchers || []).filter(v => v.cancel && v.no && (!ym || this.inP(v.date, ym)) && Books.isSale(v) && (!reg || String(v.cmp || "").slice(0, 2) === reg || !v.cmp))
      .forEach(v => inSeries(v.no, /CREDIT NOTE/i.test(v.type) ? 5 : /DEBIT NOTE/i.test(v.type) ? 4 : 1, true));
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
  // round 43: a credit or debit note to a buyer with no GSTIN goes in table 9B unregistered (cdnur) when the invoice it
  // changes is a B2C large one (inter-state, above the limit: typ B2CL) or an export (EXPWP / EXPWOP); otherwise it adjusts
  // B2C small. The invoice is not named on the note in the books: a B2C large invoice to the same buyer and place, on or
  // before the note, is taken as it
  cdnurTyp(r){
    if (r.gstin || !(r.kind === "CDNR" || r.kind === "DBNR")) return "";
    if (r.cls === "export") return r.igst ? "EXPWP" : "EXPWOP";
    if (!(r.igst > 0)) return "";
    const b2cl = this.outward("", "").filter(x => x.kind === "B2CL" && x.party === r.party && String(x.pos || "") === String(r.pos || "") && String(x.date) <= String(r.date));
    return b2cl.length ? "B2CL" : "";
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
  // the differences the amendments reported in a month's GSTR-1 make to outward tax (round 43): {out, zero, rows}
  amendDiff(ym, reg){
    const z = () => ({taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}), res = {out: z(), zero: z(), rows: []};
    if (!reg || typeof GSTAmend !== "object" || !((S.books || {}).filed) || !Object.keys(S.books.filed).length) return res;
    let p = null; try { p = GSTAmend.pending(ym, reg); } catch (e){ return res; }
    const pick = d => ({taxable: num(d && d.txval), igst: num(d && d.iamt), cgst: num(d && d.camt), sgst: num(d && d.samt), cess: num(d && d.csamt)});
    (p.rows || []).forEach(r => {
      if (r.act === "skip" || !(r.what === "amend" || (r.what === "gone" && r.act === "nil"))) return;
      const now = r.kind === "B2CS" ? pick(r.b2cs.now) : pick(r.now), was = r.kind === "B2CS" ? pick(r.was && {txval: r.was.txval, iamt: (r.was.iamt || 0)}) : pick(r.was);
      if (r.kind === "B2CS"){ const w = (GSTAmend.state(reg, ym).b2cs[r.P] || new Map()).get(r.b2cs.pos + "|" + r.b2cs.rt + "|" + r.b2cs.sply_ty); if (w) Object.assign(was, pick(w)); }
      const sg = r.kind === "CDNR" && ((r.now || r.was || {}).ntty || "C") === "C" ? -1 : 1;
      const zeroRated = r.kind === "EXP" || /^SEW/.test(String((r.now || r.was || {}).inv_typ || ""));
      const to = zeroRated ? res.zero : res.out;
      Object.keys(to).forEach(k => { to[k] = r2(to[k] + sg * (now[k] - was[k])); });
      res.rows.push({P: r.P, kind: r.kind, num: (r.now || r.was || {}).num, sign: sg});
    });
    return res;
  },
  // the 3B as filed for a month: a monthly filer's month, or at the end of a QRMP quarter the quarter's
  threeB(ym, reg){ return typeof perRender === "function" ? perRender(this, "3b|" + ym + "|" + (reg || ""), () => this.threeBNow(ym, reg)) : this.threeBNow(ym, reg); },
  threeBNow(ym, reg){
    if (typeof GSTSet === "object" && reg && GSTSet.typeOf(ym, reg) === "qrmp" && GSTSet.isQEnd(ym) && typeof GSTQ === "object") return GSTQ.threeBQ(ym, reg);
    return this.threeBm(ym, reg);
  },
  threeBm(ym, reg){
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
    let other = S2(r => !r.import && !r.rcm);
    const blocked = S2(r => r.blocked);
    // credit only as far as 2B shows it (section 16(2)(aa), rule 36(4)): bills not yet in 2B are held back,
    // and taken in the month their 2B carries them
    const basis = this.itcBasis(ym, reg), held = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, released = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, cn2b = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, rejBack = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []};
    if (basis.on){
      const add = (o, d) => { o.igst = r2(o.igst + d.igst); o.cgst = r2(o.cgst + d.cgst); o.sgst = r2(o.sgst + d.sgst); o.cess = r2(o.cess + d.cess); o.n++; o.list.push(d); };
      const vById = new Map((S.books.vouchers || []).map(v => [v.id, v]));
      const claimable = d => d.dir > 0 && !d.rcm && !d.ineligible && !(vById.get(d.id) && Books.isImport(vById.get(d.id)));
      basis.res.onlyBooks.filter(d => d.ym === ym && claimable(d)).forEach(d => add(held, d));
      basis.res.pairs.forEach(x => { if (x.p.ym > ym) x.books.filter(d => d.ym === ym && claimable(d)).forEach(d => add(held, d));
        if (x.p.ym === ym) x.books.filter(d => d.ym < ym && basis.loaded.has(d.ym) && this.itcBasis(d.ym, reg, true) && claimable(d)).forEach(d => add(released, d)); });
      // in both, but more tax in Tally than in 2B: the excess waits (the lower of the two is taken)
      basis.res.pairs.filter(x => x.status === "diff").forEach(x => {
        const bks = x.books.filter(d => d.ym === ym && claimable(d)); if (!bks.length || x.p.ym > ym) return;
        const bt = bks.reduce((a, d) => a + d.igst + d.cgst + d.sgst + d.cess, 0), pt = num(x.p.igst) + num(x.p.cgst) + num(x.p.sgst) + num(x.p.cess), ex = r2(bt - pt);
        if (ex < 1 || bt <= 0) return;
        const f = ex / bt; bks.forEach(d => add(held, {id: d.id, no: d.no, party: d.party, igst: r2(d.igst * f), cgst: r2(d.cgst * f), sgst: r2(d.sgst * f), cess: r2(d.cess * f), excess: true}));
      });
      // rejected in IMS: an invoice in Tally gives no credit (held, never released unless accepted again);
      // a credit note booked in Tally (as our debit note) does not reduce credit while it stays rejected
      (basis.res.rejected || []).forEach(x => { const dk = typeof ITCT === "object" ? ITCT.dec(reg, "R|" + x.p.key).act : "";
        if (dk === "accept") return;
        x.books.filter(d => !d.rcm && !d.ineligible).forEach(d => {
          // in the month the bill was booked, if that month is on the 2B basis; else in the month of the 2B that shows the rejection
          const here = d.ym === ym || (x.p.ym === ym && d.ym < ym && !this.itcBasis(d.ym, reg, true));
          if (!here || (d.ym !== ym && d.ym > x.p.ym)) return;
          if (d.dir > 0) add(held, Object.assign({}, d, {rejected: true})); else if (x.p.ym === ym || d.ym === ym) add(rejBack, d); }); });
      // a supplier's credit note in this month's 2B, not in Tally, reduces credit unless it is rejected in IMS
      basis.res.only2b.filter(p => p.ym === ym && p.dir < 0 && p.itcavl !== "N" && (typeof ITCT !== "object" || ITCT.dec(reg, "P|" + p.gstin + "|" + p.noN + "|" + p.dir).act !== "reject")).forEach(p => add(cn2b, p));
      other = Object.assign({}, other, {igst: r2(other.igst - held.igst + released.igst - cn2b.igst + rejBack.igst), cgst: r2(other.cgst - held.cgst + released.cgst - cn2b.cgst + rejBack.cgst), sgst: r2(other.sgst - held.sgst + released.sgst - cn2b.sgst + rejBack.sgst), cess: r2(other.cess - held.cess + released.cess - cn2b.cess + rejBack.cess)});
    }
    // 4(D)(2): credit 2B says is not available (place of supply in another state, or after the section 16(4) time limit)
    const na = {igst: 0, cgst: 0, sgst: 0, cess: 0};
    (typeof GST2B === "object" ? GST2B.all2b(reg) : []).filter(t => t.ym === ym).forEach(t => t.rows.filter(r => r.itcavl === "N" && !r.rej).forEach(r => { ["igst", "cgst", "sgst", "cess"].forEach(k => { na[k] = r2(na[k] + r.dir * num(r[k])); }); }));
    const typed = ((S.books.gst3b || {})[(reg || "") + "|" + ym]) || {}, tv = (k, h) => num(((typed[k] || {})[h]));
    const rev2 = {igst: tv("rev2", "igst"), cgst: tv("rev2", "cgst"), sgst: tv("rev2", "sgst"), cess: tv("rev2", "cess")};
    const reclaim = {igst: tv("reclaim", "igst"), cgst: tv("reclaim", "cgst"), sgst: tv("reclaim", "sgst"), cess: tv("reclaim", "cess")};
    // rule 37 (a GST setting, off unless switched on): credit on bills unpaid 180 days after their date is reversed in 4(B)(2),
    // and reclaimed when paid
    const r37 = typeof GSTF === "object" && ((S.books.rule37On || {})[reg || ""]) ? GSTF.rule37(ym, reg) : null;
    if (r37) ["igst", "cgst", "sgst", "cess"].forEach(h => { rev2[h] = r2(rev2[h] + r37.rev[h]); reclaim[h] = r2(reclaim[h] + r37.re[h]); });
    // reclaimed credit is taken in 4(A)(5) and shown again in 4(D)(1)
    other = Object.assign({}, other, {igst: r2(other.igst + reclaim.igst), cgst: r2(other.cgst + reclaim.cgst), sgst: r2(other.sgst + reclaim.sgst), cess: r2(other.cess + reclaim.cess)});
    // table 5: inward supplies with no tax (from unregistered or composition suppliers, exempt, nil, non-GST), inter- and intra-state
    const own = String(reg || "").slice(0, 2), gstOf = r => String(r.gstin || "").slice(0, 2);
    const noTax = inn.filter(r => r.bill && !r.import && !r.rcm && r.dir > 0 && !(num(r.igst) || num(r.cgst) || num(r.sgst)) && r.taxable);
    const inw5 = {gstInter: 0, gstIntra: 0, ngInter: 0, ngIntra: 0};
    noTax.forEach(r => { const inter = gstOf(r) && gstOf(r) !== own; const k = (r.cls === "nongst" ? "ng" : "gst") + (inter ? "Inter" : "Intra"); inw5[k] = r2(inw5[k] + num(r.taxable)); });
    // 3.2: inter-state supplies to unregistered persons, place of supply by place of supply
    const posOf = r => String(STATE_CODES[String(r.pos || "").toUpperCase()] || "").padStart(2, "0");
    const unregPos = {};
    this.partsOf(out.filter(r => !r.gstin && r.igst > 0 && r.cls === "taxable")).forEach(q => { const r = q.row, k = posOf(r) || "97", sg = r.kind === "CDNR" ? -1 : 1, x = unregPos[k] = unregPos[k] || {pos: k, taxable: 0, igst: 0}; x.taxable = r2(x.taxable + sg * q.taxable); x.igst = r2(x.igst + sg * q.igst); });
    const adv = GSTAdv.month(ym, reg).net;                           // 11A less 11B goes into 3.1(a)
    // round 43: the amendments of earlier months reported in this month's GSTR-1 (tables 9A, 9C, 10): their differences are
    // paid with this month's 3B (3.1(a); an SEZ or export invoice's in 3.1(b)); the earlier month's filed 3B is not changed
    const amd = this.amendDiff(ym, reg);
    const rul = GSTRev.month(ym, reg);                               // rules 42 and 43 go into 4(B)(1)
    // our credit notes rejected by the customer in IMS: the portal adds the tax back to 3.1(a)
    const cust = typeof CustIMS === "object" ? CustIMS.month(ym, reg) : {add: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}, back: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}};
    const cx = k => r2(cust.add[k] - cust.back[k]);
    const net = {taxable: r2(taxableOut.taxable - cn.taxable + adv.taxable + cx("taxable") + amd.out.taxable), cgst: r2(taxableOut.cgst - cn.cgst + adv.cgst + cx("cgst") + amd.out.cgst), sgst: r2(taxableOut.sgst - cn.sgst + adv.sgst + cx("sgst") + amd.out.sgst),
      igst: r2(taxableOut.igst - cn.igst + adv.igst + cx("igst") + amd.out.igst), cess: r2(taxableOut.cess - cn.cess + adv.cess + cx("cess") + amd.out.cess)};
    ["taxable", "igst", "cgst", "sgst", "cess"].forEach(k => { zero[k] = r2(num(zero[k]) + amd.zero[k]); });
    const itc = {cgst: r2(impGoods.cgst + impServ.cgst + rcmIn.cgst + other.cgst), sgst: r2(impGoods.sgst + impServ.sgst + rcmIn.sgst + other.sgst),
                 igst: r2(impGoods.igst + impServ.igst + rcmIn.igst + other.igst), cess: r2(impGoods.cess + impServ.cess + rcmIn.cess + other.cess)};
    // 4(B)(1): rules 38, 42 and 43 and section 17(5), reversed for good; 4(B)(2): other reversals, which may come back
    const reversal = {cgst: blocked.cgst, sgst: blocked.sgst, igst: blocked.igst, cess: blocked.cess};
    const rules = rul.total;
    const rev1 = {igst: r2(rules.igst + reversal.igst), cgst: r2(rules.cgst + reversal.cgst), sgst: r2(rules.sgst + reversal.sgst), cess: r2(rules.cess + reversal.cess)};
    const netItc = {cgst: r2(itc.cgst - rev1.cgst - rev2.cgst), sgst: r2(itc.sgst - rev1.sgst - rev2.sgst), igst: r2(itc.igst - rev1.igst - rev2.igst), cess: r2(itc.cess - rev1.cess - rev2.cess)};
    const opening = this.creditIn(ym, reg);
    const pay = this.setOff(net, rcmOut, netItc, opening);
    return {sale: taxableOut, cn, net, adv, amend: amd, custRej: cust, rules, r42: rul.r42, r43: rul.r43, zero, nil, nongst, rcmOut, rcmIn, toUnreg, impGoods, impServ, other, blocked,
      buy: this.sum(inn), itc, reversal, rev1, rev2, reclaim, r37, na, inw5, unregPos: Object.values(unregPos).sort((a, c) => a.pos.localeCompare(c.pos)),
      basis: basis.on ? "2b" : basis.why, held, released, cn2b, rejBack, netItc, ineligible: this.sum(inn).ineligible, opening, pay, payable: pay.cash};
  },
  // credit on the 2B basis for a month: on when that month's 2B is here and the client has not chosen the books basis
  itcBasis(ym, reg, quick){
    const b = S.books, choice = ((b.itcBasis || {})[reg || ""]) || "2b";
    if (!reg || typeof GST2B !== "object") return quick ? false : {on: false, why: "no registration chosen"};
    const loaded = new Set(GST2B.all2b(reg).map(t => t.ym));
    const on = choice === "2b" && loaded.has(ym);
    if (quick) return on;
    return on ? {on, loaded, res: GST2B.run(reg)} : {on: false, why: choice === "books" ? "books" : "no 2B"};
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
    const b = S.books, key = [reg, b.vouchers && b.vouchers.length, b.mapV || 0, JSON.stringify((b.gstOpen || {})[reg || ""] || {}), JSON.stringify(((b.gstFiled || {})[reg || ""]) || {}).length, JSON.stringify(b.rule37On || {}), JSON.stringify(b.gstSet || {}).length, JSON.stringify(b.gstRev || {}).length, JSON.stringify(b.gstAdv || {}).length, JSON.stringify(b.itcBasis || {}), JSON.stringify(b.gst3b || {}), Object.keys(b.twoBs || {}).join(","), JSON.stringify(((b.reco2b || {}).confirm) || {}).length, JSON.stringify(((b.reco2b || {}).link) || {}).length].join("|");
    if (!this._carry || this._carry.key !== key || this._carry.v !== b.vouchers) this._carry = {key, v: b.vouchers, m: {}};
    if (this._carry.m[ym]) return this._carry.m[ym];
    const months = this.months(), i = months.indexOf(ym), open = (b.gstOpen || {})[reg || ""] || {};
    let bal = {igst: num(open.igst), cgst: num(open.cgst), sgst: num(open.sgst), cess: num(open.cess)};
    if (i > 0 && typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp" && GSTSet.qStart(ym) !== ym && months.includes(GSTSet.qStart(ym))){ this._carry.m[ym] = this.creditIn(GSTSet.qStart(ym), reg); return this._carry.m[ym]; }
    if (i > 0){ const prev = months[i - 1], f = typeof GSTF === "object" ? GSTF.filed3b(prev, reg) : null, t = f || this.threeB(prev, reg); bal = Object.assign({}, t.pay.carry); }
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
    if (typeof GSTF === "object") add("Credit notes issued after 30 November following the invoice\u2019s year", GSTF.lateCn(ym, reg).map(x => ({no: x.no + " (for " + x.orig + ")", party: x.party})), "Section 34(2): these cannot reduce your tax. Keep them out of 3.1(a) or issue them as financial credit notes without GST.");
    if (typeof GSTF === "object"){ const e = GSTF.einv(ym, reg);
      if (e.uses){ add("Invoices to registered customers without an e-invoice (IRN)", e.missing, "Generate the IRN before reporting; GSTR-1 is filled from e-invoices and an invoice without one is not a valid tax invoice where e-invoicing applies.");
        add("E-invoices generated more than 30 days after the invoice date", e.late, "For turnover of \u20b910 crore and above the IRP refuses these; check the date and the turnover limit that applies."); } }
    add("Invoices with items at more than one rate", out.filter(r => r.mixed), "Split rate by rate in the return, from each item's rate in Tally.");
    // G-A1, G-A2 (10-Oct-2026): what the portal refuses, found before the file is made
    add("Buyer GSTINs that are not valid", out.filter(r => r.gstin && !gstinValid(r.gstin)).map(r => ({no: r.gstin, party: r.party})), "The 15th character (the check digit) or the form of the GSTIN is wrong, so the portal refuses the invoice. Correct the GSTIN on the party ledger in Tally.");
    const dn = this.docNoIssues(ym, reg);
    add("Invoice numbers longer than 16 characters", dn.long, "The portal takes at most 16 characters. Shorten the number in Tally (and on the invoice), e.g. drop the year's prefix.");
    add("Invoice numbers with characters the portal does not take", dn.chars, "Only letters, digits, / and - are allowed, and a number cannot be only zeros. Change the number in Tally.");
    add("Invoice numbers used twice in the financial year", dn.dup, "Each invoice (and each credit or debit note) needs its own number in the year. Renumber one of them in Tally.");
    add("Purchases with no supplier GSTIN", inn.filter(r => !r.gstin && (r.cgst || r.sgst || r.igst)), "Needed to match against 2B.");
    add("Supplier GSTINs that are not valid", inn.filter(r => r.gstin && !gstinValid(r.gstin)).map(r => ({no: r.gstin, party: r.party})), "The check digit or the form of the GSTIN is wrong: the bill can never match 2B. Correct the GSTIN on the supplier's ledger in Tally.");
    add("Purchases marked ITC not to be taken", inn.filter(r => r.blocked), "These are kept out of the credit claimed.");
    add("Inward supplies under reverse charge", inn.filter(r => r.rcm), "Tax on these is payable by you and shown in 3.1(d).");
    // for the year's grid: a check that is only for information is not an error
    list.forEach(c => { if (/^(Purchases marked ITC not to be taken|Inward supplies under reverse charge|Advances kept on account, not counted|Invoices with items at more than one rate)$/.test(c.what)) c.info = true; c.ret = /^(Purchases|Supplier|Inward)/.test(c.what) ? "r3b" : "r1"; });
    if (GSTAdv.ready()){
      const a = GSTAdv.month(ym, reg);
      add("Advances where the rate was assumed at 18%", a.at.filter(r => r.rateFrom === "assumed").map(r => ({no: r.no, party: r.party})), "The customer has no invoice to take a rate from. Set it under Advances.");
      add("Advances kept on account, not counted", a.untaxed.filter(r => /on account/.test(r.why)).map(r => ({no: r.ref, party: r.party})), "Mark any that are advances under Advances.");
    }
    return list;
  },
  // G-A2: the invoice and note numbers of a month that the portal refuses: over 16 characters; characters other than letters,
  // digits, / and -, or only zeros; the same number twice in the financial year (invoices and notes counted apart, capitals
  // and small letters the same, as the portal counts them). Only documents reported one by one (B2B, B2C large, exports,
  // notes); B2C small goes as totals
  docNoIssues(ym, reg){
    const ONE = {B2B: 1, B2CL: 1, EXP: 1, CDNR: 1, DBNR: 1};
    const rows = this.outward(ym, reg).filter(r => ONE[r.kind] && String(r.no || "").trim());
    const s = r => String(r.no).trim();
    const fyM = (() => { const y = num(String(ym).slice(0, 4)), m = num(String(ym).slice(4, 6)), f = m >= 4 ? y : y - 1, out = []; for (let i = 0; i < 12; i++){ const mm = (i + 3) % 12 + 1; out.push((mm >= 4 ? f : f + 1) + String(mm).padStart(2, "0")); } return out; })();
    const idx = typeof perRender === "function" ? perRender(this, "docNos|" + reg + "|" + fyM[0], () => this.docNoIndex(fyM, reg)) : this.docNoIndex(fyM, reg);
    const keyOf = r => (r.note ? "N|" : "I|") + s(r).toUpperCase();
    return {long: rows.filter(r => s(r).length > 16), chars: rows.filter(r => !/^[A-Za-z0-9/-]+$/.test(s(r)) || /^0+$/.test(s(r))),
      dup: rows.filter(r => (idx[keyOf(r)] || []).some(id => id !== r.id))};
  },
  docNoIndex(months, reg){
    const ONE = {B2B: 1, B2CL: 1, EXP: 1, CDNR: 1, DBNR: 1}, have = new Set(this.months()), idx = {};
    months.filter(m => have.has(m)).forEach(m => this.outward(m, reg).forEach(r => {
      if (!ONE[r.kind] || !String(r.no || "").trim()) return;
      const k = (r.note ? "N|" : "I|") + String(r.no).trim().toUpperCase();
      (idx[k] = idx[k] || []).includes(r.id) || idx[k].push(r.id);
    }));
    return idx;
  },
  // G-E1: the errors to fix before filing a month's GSTR-1 (sales side) and 3B (purchase side), for the year's grid
  errorsFor(ym, reg){
    const all = typeof perRender === "function" ? perRender(this, "chk|" + ym + "|" + reg, () => this.checks(ym, reg)) : this.checks(ym, reg);
    const n = ret => all.filter(c => !c.info && c.ret === ret).reduce((a, c) => a + c.n, 0);
    return {r1: n("r1"), r3b: n("r3b")};
  },
  // the file the portal takes: GSTR-1 as JSON
  toJson(ym, reg, opts){
    const g = this.one(ym, reg);
    const gstin = (GSTR.gstins(S.books) || []).find(x => !reg || x.slice(0, 2) === reg) || "";
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
        rchrg: r.rcm ? "Y" : "N", inv_typ: r.cls === "sez" ? (r.igst > 0 ? "SEWP" : "SEWOP") : "R", itms: items(r)
      })}));
    };
    const b2csMap = {};
    this.partsOf(g.b2c).forEach(q => { const r = q.row;
      const pos = posOf(r), key = pos + "|" + q.rate + "|" + (r.igst ? "INTER" : "INTRA");
      const x = b2csMap[key] = b2csMap[key] || {sply_ty: r.igst ? "INTER" : "INTRA", pos, typ: "OE", rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      x.txval = r2(x.txval + q.taxable); x.iamt = r2(x.iamt + q.igst); x.camt = r2(x.camt + q.cgst); x.samt = r2(x.samt + q.sgst); x.csamt = r2(x.csamt + q.cess);
    });
    // a credit or debit note to a buyer with no GSTIN (request of 02-Oct-2026: Puresens Exports LLP's credit note 12 of
    // 31-Mar-2026, 1,500, was left out of the GSTR-1 file, so GSTR-1 and 3.1(a) differed): it adjusts B2C small (table 7)
    // by place of supply and rate, as the portal takes it
    const urTyp = r => this.cdnurTyp(r), cdnur = g.cdnr.filter(r => !r.gstin && urTyp(r));
    this.partsOf(g.cdnr.filter(r => !r.gstin && !urTyp(r))).forEach(q => { const r = q.row, sg = r.note === "credit" ? -1 : 1;
      const pos = posOf(r), key = pos + "|" + q.rate + "|" + (r.igst ? "INTER" : "INTRA");
      const x = b2csMap[key] = b2csMap[key] || {sply_ty: r.igst ? "INTER" : "INTRA", pos, typ: "OE", rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      x.txval = r2(x.txval + sg * Math.abs(q.taxable)); x.iamt = r2(x.iamt + sg * Math.abs(q.igst)); x.camt = r2(x.camt + sg * Math.abs(q.cgst)); x.samt = r2(x.samt + sg * Math.abs(q.sgst)); x.csamt = r2(x.csamt + sg * Math.abs(q.cess));
    });
    // table 8: one row per kind of supply, intra- or inter-state (the place of supply against the registration's state),
    // to a registered or an unregistered person (round 43: every nil, exempt and non-GST supply went in one INTRB2B row)
    const nilBy = {};
    g.nil.forEach(r => { const pos = posOf(r), own = String(reg || (gstin || "").slice(0, 2)), k = (pos && own && pos !== own && pos !== "00" ? "INTR" : "INTRA") + (r.gstin ? "B2B" : "B2C");
      const o = nilBy[k] = nilBy[k] || {sply_ty: k, expt_amt: 0, nil_amt: 0, ngsup_amt: 0};
      if (r.cls === "exempt") o.expt_amt = r2(o.expt_amt + r.taxable); else if (r.cls === "nil") o.nil_amt = r2(o.nil_amt + r.taxable); else o.ngsup_amt = r2(o.ngsup_amt + r.taxable); });
    const fe = this.pEnd(ym), out = {gstin, fp: fe.slice(4, 6) + fe.slice(0, 4), version: "GST3.2.1", hash: "hash"};
    if (g.b2b.length) out.b2b = byParty(g.b2b, "inv");
    if (g.b2cl.length){
      const m = {};
      g.b2cl.forEach(r => { const pos = posOf(r); (m[pos] = m[pos] || []).push(r); });
      out.b2cl = Object.entries(m).map(([pos, rs]) => ({pos, inv: rs.map(r => ({inum: String(r.no), idt: dmy(r.date), val: r2(r.total), itms: items(r)}))}));
    }
    if (Object.keys(b2csMap).length) out.b2cs = Object.values(b2csMap);
    if (g.cdnr.some(r => r.gstin)) out.cdnr = byParty(g.cdnr.filter(r => r.gstin), "nt");
    if (cdnur.length) out.cdnur = cdnur.map(r => ({typ: urTyp(r), ntty: r.note === "credit" ? "C" : "D", nt_num: String(r.no), nt_dt: dmy(r.date), val: r2(Math.abs(r.total)),
      ...(urTyp(r) === "B2CL" ? {pos: posOf(r)} : {}), itms: items(r)}));
    // exports with payment of IGST (WPAY) and under a bond or LUT, without it (WOPAY): two lists (round 43: all went as WPAY)
    if (g.exp.length) out.exp = ["WPAY", "WOPAY"].map(t => ({exp_typ: t, inv: g.exp.filter(r => (r.igst > 0) === (t === "WPAY")).map(r => ({inum: String(r.no), idt: dmy(r.date), val: r2(r.total), itms: items(r)}))})).filter(x => x.inv.length);
    const nilRows = Object.values(nilBy).filter(o => o.expt_amt || o.nil_amt || o.ngsup_amt);
    if (nilRows.length) out.nil = {inv: nilRows};
    const adv = GSTAdv.month(ym, reg);
    if (adv.at.length) out.at = GSTAdv.json(adv.at);
    if (adv.txpd.length) out.txpd = GSTAdv.json(adv.txpd);
    // table 12: HSN with its rate, no total value; from the January 2025 return period in two lists, supplies to registered (B2B) and to unregistered (B2C) persons
    // the unit as the portal's list has it: "NA" for services, as the portal's own file does
    const UQC = ["BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM", "CCM", "CMS", "CTN", "DOZ", "DRM", "GGK", "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR", "MTS", "NOS", "OTH", "PAC", "PCS", "PRS", "QTL", "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD", "TON", "TUB", "UGS", "UNT", "YDS"];
    const ALIAS = {NO: "NOS", NUMBERS: "NOS", PC: "PCS", PIECE: "PCS", PIECES: "PCS", KG: "KGS", KGS: "KGS", KILOGRAM: "KGS", GM: "GMS", GRAM: "GMS", GRAMS: "GMS", MT: "MTS", TONNE: "TON", LTRS: "LTR", LITRE: "LTR", L: "LTR", ML: "MLT", MTRS: "MTR", METER: "MTR", METRE: "MTR", M: "MTR", SQFT: "SQF", SQMT: "SQM", PKT: "PAC", PACK: "PAC", PACKET: "PAC", BOXES: "BOX", SETS: "SET", PAIR: "PRS", PAIRS: "PRS", ROLL: "ROL", ROLLS: "ROL", DOZEN: "DOZ", BOTTLE: "BTL", CARTON: "CTN", UNIT: "UNT", UNITS: "UNT", QUINTAL: "QTL"};
    const uqcOf = h => (h.supply === "Services" || /^99/.test(h.hsn || "")) ? "NA" : UQC.includes(String(h.unit || "").toUpperCase()) ? String(h.unit).toUpperCase() : ALIAS[String(h.unit || "").toUpperCase()] || (h.unit ? "OTH" : "NOS");
    const hsnLine = (h, x, i) => ({num: i + 1, hsn_sc: h.hsn || "", desc: String(h.desc || "").slice(0, 30), uqc: uqcOf(h), qty: uqcOf(h) === "NA" ? 0 : r2(Math.abs(num(x.qty))), rt: h.rate,
      txval: r2(x.taxable), iamt: r2(x.igst), camt: r2(x.cgst), samt: r2(x.sgst), csamt: r2(x.cess)});
    if (g.hsn.length){
      if (ym >= "202501") out.hsn = {hsn_b2b: g.hsn.filter(h => Math.abs(h.b2b.taxable) >= 0.01).map((h, i) => hsnLine(h, h.b2b, i)), hsn_b2c: g.hsn.filter(h => Math.abs(h.b2c.taxable) >= 0.01).map((h, i) => hsnLine(h, h.b2c, i))};
      else out.hsn = {data: g.hsn.map((h, i) => hsnLine(h, h, i))};
    }
    if (g.series.length){
      const nats = Array.from(new Set(g.series.map(x => x.nat))).sort((a, c) => a - c);
      out.doc_issue = {doc_det: nats.map(n => ({doc_num: n, docs: g.series.filter(x => x.nat === n).map((x, i) => ({num: i + 1, from: String(x.from), to: String(x.to), totnum: x.n, cancel: x.cancelled, net_issue: x.n - x.cancelled}))}))};
    }
    if (!(opts && opts.plain) && reg) GSTAmend.addTo(out, this.pStart(ym), reg);
    return out;
  },
  async toJsonFile(ym, reg){
    const ft = typeof GSTSet === "object" && reg ? GSTSet.typeOf(ym, reg) : "monthly";
    const j = ft === "qrmp" ? (GSTSet.isQEnd(ym) ? GSTQ.r1Q(ym, reg).json : GSTQ.iff(ym, reg).json) : this.toJson(ym, reg);
    // the copy kept here is what later months' amendments are measured against
    const extra = ft === "qrmp" ? (GSTSet.isQEnd(ym) ? {quarter: GSTSet.qStart(ym) + "-" + ym} : {iff: true}) : null;
    if (reg && j.gstin){ try { GSTAmend.keep(JSON.parse(JSON.stringify(j)), "downloaded", extra); saveBooks(); } catch (e){} }
    saveFile("GSTR1_" + (j.gstin || "") + "_" + j.fp + ".json", new Blob([JSON.stringify(j)], {type: "application/json"}));
    return j;
  },
  // GSTR-3B in the shape the portal takes
  threeBJson(ym, reg){
    const t = this.threeB(ym, reg);
    const gstin = (GSTR.gstins(S.books) || []).find(x => !reg || x.slice(0, 2) === reg) || "";
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
      ], itc_rev: [{ty: "RUL", iamt: r2(t.rev1.igst), camt: r2(t.rev1.cgst), samt: r2(t.rev1.sgst), csamt: r2(t.rev1.cess)},
        {ty: "OTH", iamt: r2(t.rev2.igst), camt: r2(t.rev2.cgst), samt: r2(t.rev2.sgst), csamt: r2(t.rev2.cess)}],
        itc_net: sup(0, t.netItc.igst, t.netItc.cgst, t.netItc.sgst, t.netItc.cess),
        // 4(D)(1) credit reclaimed (ty RUL) and 4(D)(2) ineligible under 16(4) or place of supply (ty OTH)
        itc_inelg: [{ty: "RUL", iamt: r2(t.reclaim.igst), camt: r2(t.reclaim.cgst), samt: r2(t.reclaim.sgst), csamt: r2(t.reclaim.cess)},
          {ty: "OTH", iamt: r2(t.na.igst), camt: r2(t.na.cgst), samt: r2(t.na.sgst), csamt: r2(t.na.cess)}]},
      inward_sup: {isup_details: [{ty: "GST", inter: r2(t.inw5.gstInter), intra: r2(t.inw5.gstIntra)}, {ty: "NONGST", inter: r2(t.inw5.ngInter), intra: r2(t.inw5.ngIntra)}]}
    };
    out.itc_elg.itc_avl.splice(3, 0, {ty: "ISD", iamt: 0, camt: 0, samt: 0, csamt: 0});
    if (t.unregPos.length) out.inter_sup = {unreg_details: t.unregPos.filter(x => Math.abs(x.taxable) >= 0.01).map(x => ({pos: x.pos, txval: r2(x.taxable), iamt: r2(x.igst)})), comp_details: [], uin_details: []};
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

