/* ================================================================== */
/* Our invoices and credit notes rejected by the customer in IMS      */
/* ================================================================== */
// The customer's IMS is theirs: nothing about their action comes to us in a file, so the rejections are marked
// here by hand, document by document, from the books' own sales. What each one does:
//  - an invoice rejected: our tax stays as reported. If the invoice is right, the customer accepts it (before their 3B)
//    or we send it again by amending it; if it is wrong, it is corrected in Tally (reported as an amendment) or cancelled
//    by a credit note.
//  - a credit note rejected: the portal adds its tax back to our liability, in the 3B of the month after the customer
//    rejected it. That add-back is put into 3.1(a) here in the same month, and taken out again if the customer later
//    accepts it (usually after we amend and send it again).
const CustIMS = {
  ACTS: {
    inv: [["ask", "Invoice is right: ask the customer to accept it, or send it again by amendment"], ["amend", "Details wrong: correct it in Tally, it goes as an amendment"], ["cancel", "Not a supply: issue a credit note"], ["done", "Settled"]],
    cn: [["rejected", "Rejected: its tax is added back to 3.1(a)"], ["accepted", "Customer accepted it later"]]
  },
  store(reg){ const b = S.books; b.outRej = b.outRej || {}; return b.outRej[reg || ""] = b.outRej[reg || ""] || {}; },
  // documents the customer can act on in IMS: invoices and notes to registered customers
  docs(reg){ return GSTR.outward(null, reg).filter(r => r.gstin && (r.kind === "B2B" || r.kind === "CDNR" || r.kind === "DBNR" || (r.kind === "EXP" && r.cls === "sez"))); },
  nextYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  find(reg, q){ const n = GST2B.normNo(q); if (!n) return []; return this.docs(reg).filter(r => GST2B.normNo(r.no) === n || GST2B.normNo(r.no).endsWith(n)).slice(0, 12); },
  add(reg, id){
    const r = this.docs(reg).find(z => z.id === id); if (!r) return null;
    const st = this.store(reg); if (st[id]) return st[id];
    const ym = GSTR.ym(r.date), today = ITCT.today(), rejYm = today.slice(0, 7).replace("-", "") > ym ? today.slice(0, 7).replace("-", "") : ym;
    return st[id] = {kind: r.kind === "CDNR" ? "cn" : "inv", no: r.no, date: r.date, party: r.party, gstin: r.gstin, rejYm, addYm: this.nextYm(rejYm), act: r.kind === "CDNR" ? "rejected" : "ask", remark: "", doneYm: "", at: today};
  },
  items(reg){
    const st = this.store(reg), byId = new Map(this.docs(reg).map(r => [r.id, r]));
    return Object.keys(st).map(id => { const s = st[id], r = byId.get(id);
      const tax = r ? {igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess || 0, taxable: r.taxable} : {igst: 0, cgst: 0, sgst: 0, cess: 0, taxable: 0};
      const open = s.kind === "cn" ? s.act !== "accepted" : s.act !== "done";
      return Object.assign({id, gone: !r}, s, tax, {tax: r2(tax.igst + tax.cgst + tax.sgst + tax.cess), open}); })
      .sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // 3.1(a) for a month: rejected credit notes added back, and taken out again in the month the customer accepts them
  month(ym, reg){
    const add = {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, back = {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []};
    const put = (o, x) => { ["taxable", "igst", "cgst", "sgst", "cess"].forEach(k => { o[k] = r2(o[k] + num(x[k])); }); o.n++; o.list.push(x); };
    if (!S.books || !S.books.outRej) return {add, back};
    this.items(reg).filter(x => x.kind === "cn" && !x.gone).forEach(x => { if (x.addYm === ym) put(add, x); if (x.act === "accepted" && x.doneYm === ym) put(back, x); });
    return {add, back};
  },
  letter(reg, gstin, party, list){
    const co = CO() || {}, g = (GSTR.gstins(S.books) || []).find(z => z.slice(0, 2) === reg) || reg, m = v => "\u20b9" + INR.format(r2(v));
    let t = "Dear Sir/Madam,\n\nThe following documents issued by " + (co.name || "us") + " (GSTIN " + g + ") to " + party + " (GSTIN " + gstin + ") are shown as rejected in your Invoice Management System:\n\n";
    t += list.map((x, i) => "   " + (i + 1) + ". " + (x.kind === "cn" ? "Credit note " : "Invoice ") + x.no + " dated " + GSTAmend.dmy(x.date) + ", taxable " + m(x.taxable) + ", tax " + m(x.tax) + (x.remark ? " (your remark: " + x.remark + ")" : "")).join("\n");
    t += "\n\nWe have checked them against our books and they are correct. Please accept them in IMS before you file GSTR-3B; if your return for that month is already filed, please let us know and we will report them again so that they come back to your IMS.\n\nRegards,\n" + (co.name || "");
    return t;
  },
  customers(reg){
    const m = {};
    this.items(reg).filter(x => x.open && ((x.kind === "inv" && x.act === "ask") || (x.kind === "cn" && x.act === "rejected"))).forEach(x => { const k = x.gstin; (m[k] = m[k] || {gstin: x.gstin, party: x.party, items: []}).items.push(x); });
    return Object.values(m).map(c => { const k = GSTSet.contact(c.gstin, c.party); return Object.assign(c, {email: k.email, phone: k.phone, tax: r2(c.items.reduce((a, x) => a + x.tax, 0))}); });
  }
};
// the "Rejected by customers in IMS" card under GSTR-1: React (app/src/screens/gst/CustIms.jsx)
// a document marked as rejected by the customer, or not after all
function custImsAdd(id){ CustIMS.add(S.gstReg || "", id); S.custImsQ = ""; GSTR._carry = null; saveBooks(); render(); }
function custImsRemove(id){ delete CustIMS.store(S.gstReg || "")[id]; GSTR._carry = null; saveBooks(); render(); }
// what is kept for one: rejYm, addYm, doneYm, act, remark
function custImsSet(id, key, val){
  const s = CustIMS.store(S.gstReg || "")[id]; if (!s) return;
  s[key] = val; if (key === "act" && val === "accepted" && !s.doneYm) s.doneYm = s.addYm;
  GSTR._carry = null; saveBooks(); if (key !== "remark") render();
}
function custImsLetter(gstin){
  const reg = S.gstReg || "", c = CustIMS.customers(reg).find(z => z.gstin === gstin); if (!c) return;
  (navigator.clipboard ? navigator.clipboard.writeText(CustIMS.letter(reg, c.gstin, c.party, c.items)) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy."));
}
