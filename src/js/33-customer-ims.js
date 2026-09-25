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
    const co = CO() || {}, g = ((S.books.meta || {}).gstins || []).find(z => z.slice(0, 2) === reg) || reg, m = v => "\u20b9" + INR.format(r2(v));
    let t = "Dear Sir/Madam,\n\nThe following documents issued by " + (co.name || "us") + " (GSTIN " + g + ") to " + party + " (GSTIN " + gstin + ") are shown as rejected in your Invoice Management System:\n\n";
    t += list.map((x, i) => "   " + (i + 1) + ". " + (x.kind === "cn" ? "Credit note " : "Invoice ") + x.no + " dated " + GSTAmend.dmy(x.date) + ", taxable " + m(x.taxable) + ", tax " + m(x.tax) + (x.remark ? " (your remark: " + x.remark + ")" : "")).join("\n");
    t += "\n\nWe have checked them against our books and they are correct. Please accept them in IMS before you file GSTR-3B; if your return for that month is already filed, please let us know and we will report them again so that they come back to your IMS.\n\nRegards,\n" + (co.name || "");
    return t;
  },
  customers(reg){
    const m = {};
    this.items(reg).filter(x => x.open && ((x.kind === "inv" && x.act === "ask") || (x.kind === "cn" && x.act === "rejected"))).forEach(x => { const k = x.gstin; (m[k] = m[k] || {gstin: x.gstin, party: x.party, items: []}).items.push(x); });
    return Object.values(m).map(c => Object.assign(c, {email: ITCT.tallyEmail(c.party), phone: ITCT.tallyPhone(c.party), tax: r2(c.items.reduce((a, x) => a + x.tax, 0))}));
  }
};
function viewCustRejections(b){
  const reg = S.gstReg || "", money = v => INR.format(r2(v || 0)), list = CustIMS.items(reg), ym = S.gstYm || "", mo = CustIMS.month(ym, reg);
  const q = S.custImsQ || "", hits = q ? CustIMS.find(reg, q) : [];
  let h = '<section class="dash-card" style="margin-top:12px"><h3>Rejected by customers in IMS</h3>' +
    '<p class="note">Your customer\u2019s IMS actions do not come to you in a file. When a customer tells you, or the portal shows, that they rejected one of your invoices or credit notes, find it here. A rejected credit note has its tax added back to your liability by the portal in the month after the rejection; that is put into 3.1(a) here too.</p>' +
    '<div class="row" style="gap:8px;margin:8px 0;flex-wrap:wrap"><input type="search" data-custimsq data-fk="custimsq" data-keeptyped value="' + esc(q) + '" placeholder="Invoice or credit note number" style="width:260px"></div>';
  if (q) h += hits.length ? '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Document</th><th>Number</th><th class="dt">Date</th><th>Customer</th><th class="n">Tax</th><th></th></tr></thead><tbody>' +
    hits.map(r => "<tr><td>" + (r.kind === "CDNR" ? "Credit note" : r.kind === "DBNR" ? "Debit note" : "Invoice") + "</td><td>" + esc(r.no) + "</td><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.party) + '<div class="nr">' + esc(r.gstin) + '</div></td><td class="n">' + money(r.igst + r.cgst + r.sgst + (r.cess || 0)) +
      '</td><td>' + (CustIMS.store(reg)[r.id] ? '<span class="nr">already marked</span>' : '<button class="btn small" data-custimsadd="' + esc(r.id) + '">Mark as rejected</button>') + "</td></tr>").join("") + "</tbody></table></div>"
    : '<p class="note">No invoice or note to a registered customer has that number.</p>';
  if (mo.add.n || mo.back.n) h += '<p class="note"><b>' + GSTR.label(ym) + ", 3.1(a):</b> " + (mo.add.n ? "credit notes rejected by customers added back \u20b9" + money(mo.add.igst + mo.add.cgst + mo.add.sgst + mo.add.cess) + " (" + mo.add.n + ")" : "") + (mo.add.n && mo.back.n ? "; " : "") + (mo.back.n ? "accepted later, taken out again \u20b9" + money(mo.back.igst + mo.back.cgst + mo.back.sgst + mo.back.cess) + " (" + mo.back.n + ")" : "") + ".</p>";
  if (list.length) h += '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Document</th><th>Number</th><th class="dt">Date</th><th>Customer</th><th class="n">Tax</th><th>Rejected in</th><th>Added back in</th><th>What to do</th><th>Customer\u2019s remark</th></tr></thead><tbody>' +
    list.map(x => {
      const mSel = (attr, v) => '<select data-custims="' + esc(x.id) + '" data-cf="' + attr + '">' + GSTR.months().concat([CustIMS.nextYm(GSTR.months().slice(-1)[0] || x.rejYm)]).filter((z, i, a) => a.indexOf(z) === i).map(z => '<option value="' + z + '"' + (v === z ? " selected" : "") + ">" + GSTR.label(z) + "</option>").join("") + "</select>";
      const acts = '<select data-custims="' + esc(x.id) + '" data-cf="act">' + CustIMS.ACTS[x.kind].map(([v, l]) => '<option value="' + v + '"' + (x.act === v ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>" +
        (x.kind === "cn" && x.act === "accepted" ? '<div class="nr">accepted in ' + mSel("doneYm", x.doneYm || x.addYm) + "</div>" : "") +
        '<div><button class="linkbtn" data-custimsdel="' + esc(x.id) + '">not rejected after all</button></div>';
      return "<tr><td>" + (x.kind === "cn" ? "Credit note" : "Invoice") + (x.gone ? '<div class="bad">no longer in Tally</div>' : "") + "</td><td>" + esc(x.no) + "</td><td>" + fmtDate(tallyDate(x.date)) + "</td><td>" + esc(x.party) + '<div class="nr">' + esc(x.gstin) + '</div></td><td class="n">' + money(x.tax) +
        "</td><td>" + mSel("rejYm", x.rejYm) + "</td><td>" + (x.kind === "cn" ? mSel("addYm", x.addYm) : '<span class="nr">tax stays</span>') + "</td><td>" + acts +
        '</td><td><input type="text" data-custims="' + esc(x.id) + '" data-cf="remark" data-fk="custimsr-' + esc(x.id) + '" value="' + esc(x.remark || "") + '" placeholder="remark" style="width:100%"></td></tr>';
    }).join("") + "</tbody></table></div>";
  const cs = CustIMS.customers(reg);
  if (cs.length) h += '<p class="note" style="margin-top:8px">Customers to write to, asking them to accept: ' + cs.map(c => esc(c.party) + " (" + c.items.length + ') <button class="linkbtn" data-custimsletter="' + esc(c.gstin) + '">copy letter</button>' + (c.email ? ' \u00b7 <a href="mailto:' + esc(c.email) + "?subject=" + encodeURIComponent("Documents rejected in IMS") + "&body=" + encodeURIComponent(CustIMS.letter(reg, c.gstin, c.party, c.items)) + '">email</a>' : "")).join("; ") + "</p>";
  return h + "</section>";
}
if (typeof document !== "undefined") document.addEventListener("click", e => {
  const t = e.target.closest("[data-custimsadd],[data-custimsdel],[data-custimsletter]"); if (!t || !S.books) return;
  const reg = S.gstReg || "";
  if (t.dataset.custimsadd){ CustIMS.add(reg, t.dataset.custimsadd); S.custImsQ = ""; GSTR._carry = null; saveBooks(); render(); return; }
  if (t.dataset.custimsdel){ delete CustIMS.store(reg)[t.dataset.custimsdel]; GSTR._carry = null; saveBooks(); render(); return; }
  if (t.dataset.custimsletter){ const c = CustIMS.customers(reg).find(z => z.gstin === t.dataset.custimsletter); if (!c) return;
    (navigator.clipboard ? navigator.clipboard.writeText(CustIMS.letter(reg, c.gstin, c.party, c.items)) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy.")); }
});
if (typeof document !== "undefined") document.addEventListener("input", e => { const t = e.target; if (t.matches && t.matches("[data-custimsq]")){ S.custImsQ = t.value; render(); } });
if (typeof document !== "undefined") document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset || t.dataset.custims === undefined || !S.books) return;
  const s = CustIMS.store(S.gstReg || "")[t.dataset.custims]; if (!s) return;
  s[t.dataset.cf] = t.value; if (t.dataset.cf === "act" && t.value === "accepted" && !s.doneYm) s.doneYm = s.addYm;
  GSTR._carry = null; saveBooks(); if (t.dataset.cf !== "remark") render();
});
