/* ================================================================== */
/* ITC follow-up: every bill and note that 2B and Tally do not agree  */
/* on, carried from month to month until it is settled                */
/* ================================================================== */
// Nothing here is typed in or remembered by hand: the list is worked out again, each time, from the books and every
// 2B brought in. Only the decision on each item, its note and the dates suppliers were written to are kept.
const ITCT = {
  CATS: {
    waiting:   {label: "In Tally, not in 2B", law: "Credit waits until the supplier reports the bill (section 16(2)(aa)); it is taken in the month it appears in 2B, up to 30 November after the year.", warn: true,
                acts: [["follow", "Follow up the supplier"], ["wait", "Wait, no letter"], ["expense", "Give up the credit: charge the tax to cost"]]},
    diff:      {label: "In both, amounts differ", law: "Credit is taken on the lower of the bill and 2B; the rest waits until the supplier amends, or Tally is corrected.", warn: true,
                acts: [["supplier", "Ask the supplier to amend"], ["books", "Correct Tally"], ["accept", "Accept: the lower is final"]]},
    tobook:    {label: "In 2B, not in Tally", law: "Credit needs the bill in the books and the goods or services received (section 16(2)); book it, or keep it pending or reject it in IMS.", warn: true,
                acts: [["book", "Book it in Tally"], ["pending", "Keep pending in IMS, book later"], ["reject", "Not ours: reject in IMS"]]},
    nocredit:  {label: "In 2B, booked without credit", law: "The bill is in Tally with the tax charged to cost, and 2B shows the credit as available.", warn: true,
                acts: [["take", "Take the credit: put the tax to input in Tally"], ["leave", "Leave it: the tax stays in cost"]]},
    suppcn:    {label: "Supplier\u2019s credit note in 2B", law: "A credit note in 2B reduces credit in that month unless it is rejected in IMS; book it in Tally as a debit note.", warn: true,
                acts: [["accept", "Accept in IMS; book it in Tally"], ["reject", "Reject in IMS: disputed"]]},
    ournote:   {label: "Note in Tally, not in 2B", law: "Credit is already reduced in the books; the supplier still has to report the note.", warn: false,
                acts: [["follow", "Follow up the supplier"], ["ok", "Nothing to do"]]},
    rejinv:    {label: "Invoice rejected in IMS", law: "A rejected invoice gives no credit. The supplier\u2019s tax stays until they amend or cancel it in GSTR-1A or a later GSTR-1; the amended document comes back to IMS. Once 3B is filed the rejection is final for that month.", warn: true,
                acts: [["keep", "Keep rejected: no credit; reverse the input tax in Tally"], ["accept", "Change to accept in IMS before filing 3B"]]},
    rejcn:     {label: "Credit note rejected in IMS", law: "A rejected credit note does not reduce your credit; the supplier\u2019s tax goes back up in their 3B. Reverse the debit note in Tally, or accept it in IMS if it is right.", warn: true,
                acts: [["keep", "Keep rejected: credit not reduced; reverse it in Tally"], ["accept", "Accept in IMS: credit reduced"]]},
    confirm:   {label: "To confirm", law: "Probably the same bill with a different number or no GSTIN in Tally: confirm it under 2B reconciliation.", warn: true, acts: []},
    unchecked: {label: "Not checked yet", law: "The 2B for the bill\u2019s month is not here, so it cannot be said whether the supplier reported it. Bring in that month\u2019s 2B.", warn: false, acts: []},
    na:        {label: "In 2B, credit not available", law: "2B marks it not available (place of supply in another state, or after the time limit); no credit, nothing to follow up.", warn: false, acts: []},
    later:     {label: "Taken in a later month", law: "Booked in one month, in 2B of a later month: the credit was taken then.", warn: false, acts: []}
  },
  store(reg){ const b = S.books; b.itcTrack = b.itcTrack || {}; const t = b.itcTrack[reg || ""] = b.itcTrack[reg || ""] || {}; t.dec = t.dec || {}; t.sent = t.sent || {}; t.contact = t.contact || {}; return t; },
  dec(reg, key){ return ((this.store(reg).dec[key]) || {}); },
  // the last day to take credit on a bill: 30 November after the end of its year (section 16(4))
  deadline(d){ const s = String(d || ""); if (s.length < 6) return ""; const y = num(s.slice(0, 4)), m = num(s.slice(4, 6)), fy = m >= 4 ? y : y - 1; return (fy + 1) + "1130"; },
  today(){ const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },
  tx(o){ return r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)); },
  items(reg){
    const b = S.books, res = GST2B.run(reg), loaded = (res.loaded || []).slice().sort(), last = loaded[loaded.length - 1] || "", first = loaded[0] || "";
    const vById = new Map((b.vouchers || []).map(v => [v.id, v])), out = [], today = this.today();
    const add = (cat, o) => { const k = o.key, dd = this.dec(reg, k), c = this.CATS[cat];
      const x = Object.assign({cat, act: dd.act || (c.acts[0] ? c.acts[0][0] : ""), note: dd.note || "", decidedAt: dd.at || ""}, o);
      const closed = {na: 1, later: 1, unchecked: 1}[cat] || (cat === "waiting" && x.act === "expense") || (cat === "diff" && x.act === "accept") || (cat === "tobook" && x.act === "reject") ||
        (cat === "nocredit" && x.act === "leave") || (cat === "ournote" && x.act === "ok");
      x.open = !closed;
      out.push(x); };
    const bk = d => ({supplier: d.party, gstin: d.gstin || "", no: d.no, date: d.date, ym: d.ym, booked: d.bookDate, voucher: d.voucher, type: d.type, taxable: d.taxable, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess, tax: this.tax(d)});
    // in Tally, not in 2B
    res.onlyBooks.forEach(d => {
      const v = vById.get(d.id);
      if (d.ineligible || (v && Books.isImport(v)) || (d.rcm && !d.gstin)) return;
      // judged only against the 2B of the bill's own month (by booking or by bill date), or a later one when that month's is here
      const covered = loaded.includes(d.ym) || loaded.includes(String(d.date).slice(0, 6)), dl = this.deadline(d.date);
      const o = Object.assign(bk(d), {key: "B|" + (d.gstin || d.party) + "|" + d.noN + "|" + d.dir, where: "Tally", since: d.ym, deadline: dl, overdue: dl && today > dl,
        checked: covered ? "not in 2B up to " + GSTR.label(last) : "no 2B here for " + GSTR.label(d.ym) + " or later", covered});
      add(!covered ? "unchecked" : d.dir > 0 ? "waiting" : "ournote", o);
    });
    // in both
    res.pairs.forEach(x => {
      const d = x.books[0], s = x.sum, t2 = this.tx(x.p), t1 = this.tx(s);
      const base = {supplier: x.p.party || d.party, gstin: x.p.gstin, no: x.p.no, date: x.p.date, ym: d.ym, booked: d.bookDate, voucher: x.books.map(z => z.voucher).join(", "), taxable: s.taxable, igst: s.igst, cgst: s.cgst, sgst: s.sgst, cess: s.cess, tax: t1,
        tax2b: t2, ym2b: x.p.ym, issues: x.issues, deadline: this.deadline(d.date)};
      if (x.status === "probable") add("confirm", Object.assign(base, {key: "C|" + x.p.key, where: "both?"}));
      else if (x.status === "diff") add("diff", Object.assign(base, {key: "D|" + x.p.gstin + "|" + x.p.noN + "|" + x.p.dir, where: "both", gap: r2(t1 - t2), claim: Math.min(t1, t2)}));
      if (x.status !== "probable" && x.books.some(z => z.ym < x.p.ym)) add("later", Object.assign({}, base, {key: "L|" + x.p.key, where: "both", claimedIn: x.p.ym}));
    });
    // rejected in IMS
    (res.rejected || []).forEach(x => {
      const p = x.p, inT = x.books.length > 0, s2 = x.sum;
      const o = {supplier: p.party, gstin: p.gstin, no: p.no, date: p.date, ym: p.ym, ym2b: p.ym, taxable: inT ? s2.taxable : p.taxable, igst: inT ? s2.igst : p.igst, cgst: inT ? s2.cgst : p.cgst, sgst: inT ? s2.sgst : p.sgst, cess: inT ? s2.cess : p.cess,
        tax: inT ? this.tax(s2) : this.tax(p), tax2b: this.tax(p), where: inT ? "both" : "2B", key: "R|" + p.key, deadline: this.deadline(p.date), ims: "rejected", remarks: p.remarks || "",
        booked: inT ? x.books[0].bookDate : "", voucher: x.books.map(d => d.voucher).join(", "), bookedAs: inT ? "" : "not booked", issues: p.remarks ? ["your remark: " + p.remarks] : []};
      const cat = p.dir < 0 ? "rejcn" : "rejinv";
      add(cat, o);
      if (!inT){ const last = out[out.length - 1]; last.open = false; last.act = "keep"; }
    });
    // in 2B, not in Tally
    res.only2b.forEach(p => {
      const base = {supplier: p.party, gstin: p.gstin, no: p.no, date: p.date, ym: p.ym, ym2b: p.ym, taxable: p.taxable, igst: p.igst, cgst: p.cgst, sgst: p.sgst, cess: p.cess, tax: this.tax(p), tax2b: this.tax(p),
        where: "2B", key: "P|" + p.gstin + "|" + p.noN + "|" + p.dir, deadline: this.deadline(p.date), reason: p.itcavl === "N" ? (p.rsn === "P" ? "place of supply" : p.rsn === "C" ? "after the time limit" : "not available") : "",
        bookedAs: p.bookedNoCredit ? p.bookedNoCredit.type + " " + (p.bookedNoCredit.no || "") + " of " + GSTAmend.dmy(p.bookedNoCredit.date) : "", ims: p.ims ? GST2B.IMS[p.ims] || p.ims : ""};
      if (p.itcavl === "N") add("na", base);
      else if (p.dir < 0) add("suppcn", base);
      else if (p.bookedNoCredit) add("nocredit", base);
      else add("tobook", base);
    });
    return {items: out, loaded, last, first, missing: this.missingMonths(loaded)};
  },
  tax(o){ return r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)); },
  // months of the books with no 2B here: nothing can be followed up for them
  missingMonths(loaded){ const have = new Set(loaded); return GSTR.months().filter(m => !have.has(m)); },
  // what to write to one supplier: its bills not in 2B, and the ones that differ
  letter(reg, gstin, party, items){
    const co = CO(), m = v => INR.format(r2(v || 0));
    const w = items.filter(x => x.cat === "waiting" && x.act === "follow"), d = items.filter(x => x.cat === "diff" && x.act === "supplier"), n = items.filter(x => x.cat === "ournote" && x.act === "follow"),
      rj = items.filter(x => (x.cat === "rejinv" || x.cat === "rejcn") && x.act === "keep");
    let t = "Dear " + (party || "Sir/Madam") + ",\n\nWe are " + co.name + (co.gstin || gstin ? " (GSTIN " + ((GSTR.gstins(S.books) || []).find(g => g.slice(0, 2) === reg) || co.gstin || "") + ")" : "") + ". Our GST credit depends on your returns, so please look at the following:\n";
    if (w.length) t += "\n1. Invoices in our books that do not appear in our GSTR-2B. Please report them in your GSTR-1 / IFF:\n" + w.map((x, i) => "   " + (i + 1) + ". Invoice " + x.no + " dated " + GSTAmend.dmy(x.date) + ", taxable " + m(x.taxable) + ", tax " + m(x.tax)).join("\n") + "\n";
    if (d.length) t += "\n" + (w.length ? "2" : "1") + ". Invoices reported with different figures. Please amend them in your GSTR-1:\n" + d.map((x, i) => "   " + (i + 1) + ". Invoice " + x.no + " dated " + GSTAmend.dmy(x.date) + ": tax " + m(x.tax) + " in our books, " + m(x.tax2b) + " in your return" + (x.issues && x.issues.length ? " (" + x.issues.filter(z => !/^booked in|^value differs/.test(z)).join("; ") + ")" : "")).join("\n") + "\n";
    if (n.length) t += "\n" + (1 + (w.length ? 1 : 0) + (d.length ? 1 : 0)) + ". Credit notes you issued to us that are not in your return:\n" + n.map((x, i) => "   " + (i + 1) + ". Note " + x.no + " dated " + GSTAmend.dmy(x.date) + ", tax " + m(x.tax)).join("\n") + "\n";
    if (rj.length) t += "\n" + (1 + (w.length ? 1 : 0) + (d.length ? 1 : 0) + (n.length ? 1 : 0)) + ". Documents we have rejected in the Invoice Management System. Please amend or cancel them in your GSTR-1A / GSTR-1:\n" + rj.map((x, i) => "   " + (i + 1) + ". " + (x.cat === "rejcn" ? "Credit note " : "Invoice ") + x.no + " dated " + GSTAmend.dmy(x.date) + ", tax " + m(x.tax2b) + (x.remarks ? " (" + x.remarks + ")" : "")).join("\n") + "\n";
    t += "\nThe last date for us to take this credit is 30 November after the end of the year of each invoice. Please confirm once reported.\n\nRegards,\n" + co.name;
    return {text: t, n: w.length + d.length + n.length + rj.length};
  },
  suppliers(reg, items){
    const m = {};
    items.filter(x => x.open && ((x.cat === "waiting" && x.act === "follow") || (x.cat === "diff" && x.act === "supplier") || (x.cat === "ournote" && x.act === "follow") || ((x.cat === "rejinv" || x.cat === "rejcn") && x.act === "keep"))).forEach(x => {
      const k = x.gstin || x.supplier, s = m[k] = m[k] || {key: k, gstin: x.gstin, party: x.supplier, items: [], tax: 0, oldest: x.date, deadline: x.deadline};
      s.items.push(x); s.tax = r2(s.tax + (x.cat === "diff" ? Math.abs(x.gap) : x.cat === "rejcn" || x.cat === "rejinv" ? x.tax2b : x.tax)); if (String(x.date) < String(s.oldest)) s.oldest = x.date; if (x.deadline && (!s.deadline || x.deadline < s.deadline)) s.deadline = x.deadline;
    });
    const st = this.store(reg), b = S.books, info = b.ledInfo || {};
    return Object.values(m).map(s => { const k = GSTSet.contact(s.gstin, s.party, st.contact[s.key]), sent = st.sent[s.key] || [];
      return Object.assign(s, {email: k.email, phone: k.phone, sent, lastSent: sent[sent.length - 1] || ""}); }).sort((a, c) => c.tax - a.tax);
  },
  tallyEmail(party){ const i = ((S.books.ledInfo || {})[party]) || {}; return i.email || ""; },
  tallyPhone(party){ const i = ((S.books.ledInfo || {})[party]) || {}; return i.phone || ""; }
};

// the ITC follow-up page: React (app/src/screens/gst/ItcFollow.jsx)
function itctSupplier(key){ const reg = S.gstReg || "", R = ITCT.items(reg), s = ITCT.suppliers(reg, R.items).find(z => z.key === key); return s ? {reg, s, L: ITCT.letter(reg, s.gstin, s.party, s.items)} : null; }
// what the user decides on a line, and a note to it (kept, carried to later months)
function itctSetAct(key, act){ const st = ITCT.store(S.gstReg || ""); st.dec[key] = Object.assign({}, st.dec[key], {act, at: ITCT.today()}); saveBooks(); render(); }
function itctSetNote(key, note){ const st = ITCT.store(S.gstReg || ""); st.dec[key] = Object.assign({}, st.dec[key], {note}); saveBooks(); }
// one letter to a supplier with every bill waiting on them: copied, or opened in the mail app or WhatsApp; logged as written
function itctWrite(how, key){
  const x = itctSupplier(key); if (!x) return;
  if (how === "itctCopy") (navigator.clipboard ? navigator.clipboard.writeText(x.L.text) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy; use the Excel."));
  if (how === "itctMail"){ if (!x.s.email){ toast("Type the supplier's email first."); return; } window.open("mailto:" + encodeURIComponent(x.s.email) + "?subject=" + encodeURIComponent("GST: invoices not in our GSTR-2B") + "&body=" + encodeURIComponent(x.L.text), "_blank"); }
  if (how === "itctWa"){ const ph = String(x.s.phone || "").replace(/\D/g, ""); if (!ph){ toast("Type the supplier's phone first."); return; } window.open("https://wa.me/" + (ph.length === 10 ? "91" + ph : ph) + "?text=" + encodeURIComponent(x.L.text), "_blank"); }
  itctLogSent(x.reg, x.s.key); render();
}
function itctLogSent(reg, key){ const st = ITCT.store(reg); st.sent[key] = (st.sent[key] || []).concat([ITCT.today()]); saveBooks(); }
async function itctExcel(){
  await ensureXlsx();
  const reg = S.gstReg || "", R = ITCT.items(reg), wb = XLSX.utils.book_new(), d = s => GSTAmend.dmy(s);
  const actLabel = x => ((ITCT.CATS[x.cat].acts.find(a => a[0] === x.act) || [])[1]) || "";
  const row = x => [ITCT.CATS[x.cat].label, x.supplier, x.gstin, x.no, d(x.date), x.where === "2B" ? (x.bookedAs || "not booked") : d(x.booked || x.date) + " " + (x.voucher || ""), x.where === "Tally" ? (x.covered ? "not in 2B" : "no 2B yet") : GSTR.label(x.ym2b || x.ym),
    x.taxable, x.igst, x.cgst, x.sgst, x.cess, x.tax, x.tax2b != null ? x.tax2b : "", x.deadline ? d(x.deadline) : "", actLabel(x), x.note, (x.issues || []).join("; ")];
  const head = ["What", "Supplier", "GSTIN", "Bill no.", "Bill date", "In Tally", "In 2B", "Taxable", "IGST", "CGST", "SGST", "Cess", "Tax", "Tax in 2B", "Last date for credit", "What to do", "Note", "Differences"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(R.items.filter(x => x.open).map(row))), "Open");
  // what to do on the portal's IMS, taken from the decisions
  const ims = R.items.filter(x => (x.where === "2B" && (x.cat === "tobook" || x.cat === "suppcn" || x.cat === "nocredit")) || x.cat === "rejinv" || x.cat === "rejcn").map(x => [x.supplier, x.gstin, x.no, d(x.date), GSTR.label(x.ym2b), x.tax2b != null ? x.tax2b : x.tax,
    x.cat === "rejinv" || x.cat === "rejcn" ? (x.act === "accept" ? "Change to Accept" : "Leave rejected") : x.cat === "suppcn" ? (x.act === "reject" ? "Reject" : "Accept") : x.act === "reject" ? "Reject" : x.act === "pending" ? "Pending" : "Accept", actLabel(x), (x.ims || "") + (x.remarks ? " \u00b7 " + x.remarks : "")]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Supplier", "GSTIN", "Document", "Date", "2B month", "Tax", "IMS action", "Why", "IMS status in 2B"]].concat(ims)), "IMS actions");
  const sups = ITCT.suppliers(reg, R.items);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Supplier", "GSTIN", "Email", "Phone", "Bills", "Tax waiting", "Last written", "Letter"]].concat(sups.map(s => [s.party, s.gstin, s.email, s.phone, s.items.length, s.tax, s.lastSent ? d(s.lastSent) : "", ITCT.letter(reg, s.gstin, s.party, s.items).text]))), "Letters");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(R.items.filter(x => !x.open).map(row))), "Settled");
  const g = (GSTR.gstins(S.books) || []).find(z => z.slice(0, 2) === reg) || reg;
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-ITC-follow-up-" + g + "-" + ITCT.today() + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
