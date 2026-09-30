/* ================================================================== */
/* Filing a GST month: due dates, late fee, interest, rule 37, the    */
/* checks the portal runs (DRC-01B, DRC-01C), filed 3B copies, and    */
/* the set-off journal for Tally                                      */
/* ================================================================== */
const GSTF = {
  // monthly filers: GSTR-1 by the 11th, GSTR-3B by the 20th of the next month
  // monthly: GSTR-1 by the 11th, 3B by the 20th of the next month. QRMP: GSTR-1 by the 13th and 3B by the 22nd or 24th
  // (by state) after the quarter; IFF by the 13th and PMT-06 by the 25th of the next month in the quarter's first two months.
  // Composition: CMP-08 by the 18th after the quarter.
  due(ym, which, reg){
    const t = typeof GSTSet === "object" ? GSTSet.typeOf(ym, reg || "") : "monthly", d = (m, day) => m.slice(0, 4) + "-" + m.slice(4, 6) + "-" + day;
    if (t === "monthly") return d(GSTR.nextYm(ym), which === "r1" ? "11" : "20");
    const qn = GSTR.nextYm(GSTSet.qEnd(ym));
    if (t === "comp") return which === "cmp08" ? d(qn, "18") : "";
    if (!GSTSet.isQEnd(ym)) return which === "iff" ? d(GSTR.nextYm(ym), "13") : which === "pmt06" ? d(GSTR.nextYm(ym), "25") : "";
    return d(qn, which === "r1" ? "13" : GSTSet.Q22.has(String(reg || "").slice(0, 2)) ? "22" : "24");
  },
  // whether the month has a GSTR-1 and a 3B of its own under the filing type
  files(ym, reg){ const t = typeof GSTSet === "object" ? GSTSet.typeOf(ym, reg || "") : "monthly"; return t === "monthly" || (t === "qrmp" && GSTSet.isQEnd(ym)); },
  days(a, b){ return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); },
  today(){ return new Date().toISOString().slice(0, 10); },
  store(reg){ const b = S.books; b.gstFiled = b.gstFiled || {}; return b.gstFiled[reg || ""] = b.gstFiled[reg || ""] || {}; },
  rec(ym, reg){ const s = this.store(reg); return s[ym] = s[ym] || {}; },
  peek(ym, reg){ return (((S.books || {}).gstFiled || {})[reg || ""] || {})[ym] || {}; },
  fyOf(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m >= 4 ? y + "-" + String(y + 1).slice(2) : (y - 1) + "-" + String(y).slice(2); },
  // aggregate turnover of the year before, for the late fee caps: typed, else from the books (all registrations)
  aato(fy){
    const t = num(((S.books.gstAato || {})[fy]));
    if (t) return {v: t, from: "typed"};
    const y0 = +fy.slice(0, 4) - 1, months = GSTR.months().filter(m => m >= y0 + "04" && m <= (y0 + 1) + "03");
    if (months.length < 12) return {v: 0, from: months.length ? "part" : "none", n: months.length};
    let v = 0; months.forEach(m => GSTR.outward(m, "").forEach(r => { v += (r.kind === "CDNR" ? -1 : 1) * num(r.taxable); }));
    return {v: r2(v), from: "books"};
  },
  // late fee, section 47 as capped by notifications 19/2021 (3B) and 20/2021 (GSTR-1): Rs 50 a day (Rs 20 for a nil return),
  // half CGST and half SGST, capped at Rs 500 for nil, else Rs 2,000 / 5,000 / 10,000 by turnover
  // with no filing date typed, an estimate "if filed today" is given only for a month that has just fallen due
  unknown(due, filed){ return !filed && this.days(due, this.today()) > 45; },
  lateFee(ym, reg, which, nil){
    const r = this.peek(ym, reg), filed = r[which] || "", due = this.due(ym, which, reg), upto = filed || this.today(), d = Math.max(0, this.days(due, upto));
    if (!due) return {days: 0, fee: 0, due, filed, cap: 0, none: true};
    if (this.unknown(due, filed)) return {days: 0, fee: 0, due, filed, cap: 0, unknown: true};
    if (!d) return {days: 0, fee: 0, due, filed, cap: 0};
    const a = this.aato(this.fyOf(ym)), cap = nil ? 500 : !a.v ? 10000 : a.v <= 15000000 ? 2000 : a.v <= 50000000 ? 5000 : 10000;
    const fee = Math.min(d * (nil ? 20 : 50), cap);
    return {days: d, fee, cgst: fee / 2, sgst: fee / 2, due, filed, cap, capFrom: a.from, estimated: !filed};
  },
  // interest, section 50(1) with its proviso: 18% a year on the tax paid in cash, for the days after the due date
  interest(ym, reg, t){
    const r = this.peek(ym, reg), due = this.due(ym, "r3b", reg), upto = r.r3b || this.today(), d = !due || this.unknown(due, r.r3b) ? 0 : Math.max(0, this.days(due, upto));
    const cash = t.quarter ? t.cashAfter : t.pay.cash, heads = {};
    ["igst", "cgst", "sgst", "cess"].forEach(h => { heads[h] = r2(num(cash[h]) * 0.18 * d / 365); });
    return {days: d, due, filed: r.r3b || "", heads, total: r2(heads.igst + heads.cgst + heads.sgst + heads.cess), estimated: !r.r3b};
  },
  // rule 37: credit on a bill not paid within 180 days of its date is reversed in the return of the month the 181st day falls in,
  // on the unpaid part, and taken back in the month it is paid (4(D)(1)). Only bills kept bill-wise in Tally can be followed.
  bills(reg){
    const b = S.books, key = reg + "|" + (b.vouchers || []).length + "|" + (b.mapV || 0);
    if (this._bills && this._bills.key === key && this._bills.v === b.vouchers) return this._bills.list;
    const bills = {};
    (b.vouchers || []).filter(v => !v.opt && !v.cancel).forEach(v => v.ent.forEach(e => (e.b || []).forEach(([name, type, amt]) => {
      if (!name) return;
      const k = e.l + "|" + name, x = bills[k] = bills[k] || {party: e.l, ref: name, billed: 0, pays: [], v: null, tax: {}};
      if (type === "New Ref" && amt > 0 && Books.isPurchase(v) && !Books.isRcm(v) && GSTR.regOf(v) === reg){
        x.billed = r2(x.billed + amt); x.v = v;
        // the invoice's full value, credited to the supplier on this voucher: the unpaid share is measured against it
        x.gross = r2(v.ent.filter(z => z.l === e.l && z.a > 0).reduce((a, z) => a + z.a, 0));
        v.ent.forEach(z => { const m = Books.ledgerOf(z.l); if (z.a < 0 && (m.kind === "gst" || m.kind === "gst_common") && m.side === "input"){ const h = String(m.tax || "").toLowerCase(); if (h) x.tax[h] = r2((x.tax[h] || 0) - z.a); } });
      } else if (amt < 0) x.pays.push({date: v.date, amt: -amt});
    })));
    const list = Object.values(bills).filter(x => x.v && Object.keys(x.tax).length && x.billed > 0).map(x => {
      const d0 = String(x.v.refDate || x.v.date), dt = new Date(Date.UTC(+d0.slice(0, 4), +d0.slice(4, 6) - 1, +d0.slice(6, 8) + 180));
      x.revYm = dt.toISOString().slice(0, 7).replace("-", ""); x.billDate = d0; return x; });
    this._bills = {key, v: b.vouchers, list};
    return list;
  },
  // what a supplier's ledger shows as owing at a month's end: credits less debits, opening balance included
  owing(reg){
    const b = S.books, key = (b.vouchers || []).length + "|" + (b.mapV || 0);
    if (!this._owe || this._owe.key !== key || this._owe.v !== b.vouchers){
      const by = {};
      (b.vouchers || []).filter(v => !v.opt && !v.cancel).forEach(v => v.ent.forEach(e => { (by[e.l] = by[e.l] || []).push([String(v.date).slice(0, 6), e.a]); }));
      Object.values(by).forEach(l => l.sort((a, c) => a[0].localeCompare(c[0])));
      this._owe = {key, v: b.vouchers, by};
    }
    return (party, end) => { const op = num((((b.ledInfo || {})[party]) || {}).ob); let s2 = op; (this._owe.by[party] || []).forEach(([m, a]) => { if (m <= end) s2 += a; }); return Math.max(0, s2); };
  },
  rule37(ym, reg){
    const Z = () => ({igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}), rev = Z(), re = Z(), paidBy = (x, end) => x.pays.filter(p => String(p.date).slice(0, 6) <= end).reduce((a, p) => a + p.amt, 0);
    const put = (o, x, share, why) => { ["igst", "cgst", "sgst", "cess"].forEach(h => { o[h] = r2(o[h] + r2(num(x.tax[h]) * share)); }); o.n++; o.list.push({party: x.party, ref: x.ref, date: x.billDate, share: r2(share), why, tax: r2(Object.values(x.tax).reduce((a, v) => a + v, 0) * share)}); };
    const owe = this.owing(reg);
    this.bills(reg).forEach(x => {
      if (x.revYm > ym) return;
      // a payment made on account, not against the bill, still pays it: never more unpaid than the ledger owes
      const unpaidAt = end => Math.max(0, Math.min(x.billed - paidBy(x, end), owe(x.party, end))) / Math.max(x.billed, x.gross || 0);
      const atRev = unpaidAt(x.revYm);
      if (atRev * Math.max(x.billed, x.gross || 0) < 1) return;
      if (x.revYm === ym) put(rev, x, atRev, (atRev < 0.01 ? "under 1%" : Math.round(atRev * 100) + "%") + " unpaid after 180 days");
      else {
        // paid in this month, after the reversal: that share comes back
        const prev = GSTR.months()[GSTR.months().indexOf(ym) - 1] || x.revYm, before = unpaidAt(prev < x.revYm ? x.revYm : prev), now = unpaidAt(ym), back = r2(before - now);
        if (back > 0.0001) put(re, x, back, "paid in " + GSTR.label(ym));
      }
    });
    return {rev, re};
  },
  // a kept copy of the 3B as filed: its figures stand for the month in GSTR-9 and its credit left over is carried
  filed3b(ym, reg){ const r = this.peek(ym, reg); return r.snap || null; },
  snapOf(t){ const c = JSON.parse(JSON.stringify(t)); ["held", "released", "cn2b", "rejBack", "custRej", "r37"].forEach(k => { if (c[k] && c[k].list) delete c[k].list; if (c[k] && c[k].add) { delete c[k].add.list; delete c[k].back.list; } if (c[k] && c[k].rev){ delete c[k].rev.list; delete c[k].re.list; } }); delete c.unregPos; return c; },
  // DRC-01B (rule 88C): liability in GSTR-1 higher than paid in 3B; DRC-01C (rule 88D): credit in 3B above 2B.
  // The portal intimates when the difference passes its limit; the limit is set here as notified, and the difference is always shown.
  LIM: {b: {amt: 2500000, pct: 20}, c: {amt: 500000, pct: 20}},
  drc(ym, reg, t){
    const tax = x => r2(num(x.igst) + num(x.cgst) + num(x.sgst) + num(x.cess));
    const filed = !t.quarter && typeof GSTAmend === "object" ? GSTAmend.filed(reg).find(f => f.ym === ym && !f.notFiled) : null;
    let r1 = null, r1From = "books";
    if (filed){ r1From = "filed"; const n = GSTAmend.norm(filed.json); let s = 0; n.docs.forEach(d => { s += (d.kind === "CDNR" && d.nt === "C" ? -1 : 1) * r2(num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt)); }); n.b2cs.forEach(d => { s += num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }); r1 = r2(s); }
    if (r1 == null) r1 = r2(tax(t.sale) - tax(t.cn) + tax(t.zero) + tax(t.adv));
    // 3.1(a) and (b) as they go in 3B (advances in both; our credit notes rejected by customers add to 3B only)
    const r3 = r2(tax(t.net) - (t.custRej ? tax(t.custRej.add) - tax(t.custRej.back) : 0) + tax(t.zero));
    const gapB = r2(r1 - r3), limB = Math.max(this.LIM.b.amt, r1 * this.LIM.b.pct / 100);
    let avl = 0, have2b = false;
    (typeof GST2B === "object" ? GST2B.all2b(reg) : []).filter(x => x.ym === ym).forEach(x => { have2b = true; x.rows.filter(r => r.itcavl !== "N" && !r.rej && !r.rcm && r.sec !== "impg" && r.sec !== "isd").forEach(r => { avl += r.dir * (num(r.igst) + num(r.cgst) + num(r.sgst) + num(r.cess)); }); });
    avl = r2(avl);
    const claimed = tax(t.other), gapC = r2(claimed - avl), limC = Math.max(this.LIM.c.amt, avl * this.LIM.c.pct / 100);
    return {b: {r1, r3, gap: gapB, lim: r2(limB), flag: gapB > limB, from: r1From}, c: {have2b, avl, claimed, gap: gapC, lim: r2(limC), flag: have2b && gapC > limC}};
  },
  // section 34(2): a credit note reduces tax only if issued by 30 November after the year of the invoice
  lateCn(ym, reg){
    const out = [];
    (S.books.vouchers || []).forEach(v => {
      if (!Books.isSale(v) || !/CREDIT NOTE/i.test(v.type) || (ym && GSTR.ym(v.date) !== ym) || (reg && GSTR.regOf(v) !== reg)) return;
      const od = String(v.refDate || ""); if (!/^\d{8}$/.test(od)) return;
      const fyEnd = +od.slice(4, 6) >= 4 ? +od.slice(0, 4) + 1 : +od.slice(0, 4), lim = fyEnd + "1130";
      if (String(v.date) > lim) out.push({no: v.no, party: v.party, date: v.date, orig: v.ref, origDate: od, lim});
    });
    return out;
  },
  // e-invoices made from Tally: once any voucher of the registration carries an IRN, invoices to registered customers without
  // one are listed, and so are IRNs taken more than 30 days after the invoice (the limit for turnover of Rs 10 crore and above)
  einv(ym, reg){
    const mode = typeof GSTSet === "object" ? GSTSet.einvMode(reg) : "auto";
    const vs = (S.books.vouchers || []).filter(v => Books.isSale(v) && (!reg || GSTR.regOf(v) === reg));
    if (mode !== "auto" || !vs.some(v => v.irn)) return {uses: false, missing: [], late: [], mode};
    const iso = d => { const x = String(d || "").replace(/-/g, ""); return x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8); };
    const kinds = new Set(["B2B", "EXP", "CDNR", "DBNR"]), byId = new Map(vs.map(v => [v.id, v]));
    const out = GSTR.outward(ym, reg).filter(r => kinds.has(r.kind) && (r.gstin || r.kind === "EXP"));
    const missing = out.filter(r => !(byId.get(r.id) || {}).irn).map(r => ({no: r.no, party: r.party}));
    const late = out.map(r => byId.get(r.id)).filter(v => v && v.irn && /^\d{8}$/.test(String(v.irnDate || "").replace(/-/g, "").slice(0, 8)))
      .filter(v => this.days(iso(v.date), iso(String(v.irnDate).replace(/-/g, "").slice(0, 8))) > 30).map(v => ({no: v.no, party: v.party}));
    return {uses: true, missing, late};
  },
  // the month's set-off and cash payment as one journal for Tally: output tax debited, input tax and the cash ledger credited
  journal(ym, reg){
    const t = GSTR.threeB(ym, reg), P = t.pay, H = ["igst", "cgst", "sgst", "cess"], lines = [], rec = this.peek(ym, reg);
    const led = (kind, head, side, rcm) => { const e = Object.entries(S.books.map || {}).filter(([, m]) => m.kind === kind && (m.tax === head || (rcm && !m.tax) || (rcm && !head)) && (!m.reg || m.reg === reg) && m.side === side && !!m.rcm === !!rcm).sort((a, c) => (c[1].tax ? 1 : 0) - (a[1].tax ? 1 : 0) || (c[1].n || 0) - (a[1].n || 0)); if (!e.length && rcm) return led(kind, "", side, true) || Object.entries(S.books.map || {}).filter(([, m]) => m.kind === kind && m.rcm && m.side === side && (!m.reg || m.reg === reg)).map(z => z[0])[0] || null;
      return e.length ? e[0][0] : null; };
    const cashL = (S.books.gstCashLedger || {})[reg] || rec.cashLedger || (reg + " GST ELECTRONIC CASH LEDGER"), missing = [];
    const add = (l, dr, cr, what) => { if (!r2(dr) && !r2(cr)) return; if (!l){ missing.push(what); return; }
      const o = lines.find(z => z.l === l && (dr ? z.dr : z.cr)); if (o){ o.dr = r2(o.dr + r2(dr)); o.cr = r2(o.cr + r2(cr)); } else lines.push({l, dr: r2(dr), cr: r2(cr)}); };
    H.forEach(to => {
      const HU = to.toUpperCase(), used = H.reduce((a, from) => a + num((P.use[from] || {})[to]), 0), cashTo = r2(num(P.cash[to]) - num((P.rcmCash || {})[to]));
      add(led("gst", HU, "output"), used + cashTo, 0, HU + " output ledger");
    });
    H.forEach(from => { const HU = from.toUpperCase(), used = Object.values(P.use[from] || {}).reduce((a, v) => a + num(v), 0); if (used) add(led("gst", HU, "input"), 0, used, HU + " input ledger"); });
    H.forEach(h => { const rc = num((P.rcmCash || {})[h]); if (rc) add(led("gst", h.toUpperCase(), "output", true), rc, 0, h.toUpperCase() + " reverse charge payable ledger"); });
    const cash = r2(H.reduce((a, h) => a + num(P.cash[h]), 0));
    if (cash) lines.push({l: cashL, dr: 0, cr: cash});
    // rounding: keep the voucher balanced
    // paise only: a larger difference means a ledger is missing, and the journal is not offered as balanced
    const d = r2(lines.reduce((a, l) => a + l.dr - l.cr, 0)); if (Math.abs(d) >= 0.01 && Math.abs(d) < 1 && lines.length) lines[lines.length - 1].cr = r2(lines[lines.length - 1].cr + d);
    const balanced = Math.abs(r2(lines.reduce((a, l) => a + l.dr - l.cr, 0))) < 0.01;
    const nx = (GSTR.nextYm ? GSTR.nextYm(ym) : CustIMS.nextYm(ym));
    const date = rec.r3b ? rec.r3b.replace(/-/g, "") : (this.due(ym, "r3b", reg) || (nx + "-20")).replace(/-/g, "");
    return {balanced, date, narr: "GSTR-3B " + GSTR.label(ym) + ": tax set off against input tax credit and paid in cash (sections 49, 49A; rule 88A)", lines, missing, cash, cashL};
  }
};
function label0(ym){ return GSTR.label(ym); }
// the filing card under GSTR-3B and GSTR-1A under Amendments: React (app/src/screens/gst/Filing.jsx)
// a filing date (r1, r3b) or a figure from the portal (portalFee1, portalFee3, portalInt) for the month and GSTIN
function gstfSet(k, v){
  const r = GSTF.rec(S.gstYm || "", S.gstReg || "");
  if (k === "r1" || k === "r3b") r[k] = v;
  if (k === "portalFee1" || k === "portalFee3" || k === "portalInt"){ if (v === "") delete r[k]; else r[k] = num(v); }
  GSTR._carry = null; saveBooks(); render();
}
// after filing: keep the 3B as filed (or remove the kept copy), and the set-off journal for Tally
function gstfSnap(){ const ym = S.gstYm || "", r = GSTF.rec(ym, S.gstReg || ""); r.snap = GSTF.snapOf(GSTR.threeB(ym, S.gstReg || "")); r.snapAt = new Date().toISOString(); if (!r.r3b) r.r3b = GSTF.today(); GSTR._carry = null; saveBooks(); render(); toast("3B for " + GSTR.label(ym) + " kept as filed."); }
function gstfUnsnap(){ const r = GSTF.rec(S.gstYm || "", S.gstReg || ""); delete r.snap; delete r.snapAt; GSTR._carry = null; saveBooks(); render(); }
function gstfJournal(){
  const ym = S.gstYm || "", reg = S.gstReg || "", J = GSTF.journal(ym, reg); if (!J.lines.length){ toast("Nothing to set off this month."); return; }
  if (!J.balanced){ toast("A ledger is missing in Tally (" + J.missing.join(", ") + "); the journal would not balance."); return; }
  const co = CO() || {}; saveFile(String(co.name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-GST-setoff-" + reg + "-" + ym + ".xml", new Blob([Audit.jeXml([{date: J.date, narr: J.narr, lines: J.lines}])], {type: "application/xml"}));
}
// the GSTR-1A file; a copy is kept so the next GSTR-1 does not report these again
function gst1aJson(){
  const ym = S.gstYm || "", reg = S.gstReg || "", r = GSTAmend.json1a(ym, reg); if (!r || !r.rows.length) return;
  const out = Object.assign({version: "GST3.2.1", hash: "hash"}, r.json);
  GSTAmend.keep1a(out); saveBooks();
  saveFile("GSTR1A_" + out.gstin + "_" + out.fp + ".json", new Blob([JSON.stringify(out)], {type: "application/json"}));
  render(); toast("GSTR-1A for " + GSTR.label(ym) + " downloaded and kept.");
}
