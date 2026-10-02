/* ================================================================== */
/* Transactions: everything filed for this client, in one register    */
/* ================================================================== */
function txnTab(){ return S.txnTab || "bills"; }
function vchTypeOf(e, co){
  if (e.noteKind === "credit") return co.debitNoteType || "Debit Note";
  if (e.noteKind === "debit") return "Purchase";
  return co.voucherType || "Journal";
}
// in Tally: posted and confirmed there (or found there already), and not since missing from Tally's own entries in
// FinCom's cloud copy (review of 02-Oct-2026: FA/ELEC/013 posted on 29-Sep was deleted in Tally and still counted).
// A bill in a Tally file that no one has confirmed is not counted.
function billInTally(e){ return !!(e && e.exportedAt && (e.postVerified === true || e.postNote === "Already in Tally") && !e.goneFromTally); }
function tallyStateOf(e){
  if (e.goneFromTally) return ["bad", "Not in Tally any more (deleted there?)"];
  if (e.exportedAt) return billInTally(e) ? ["ok", "In Tally"] : ["sent", e.postedVia === "bridge" ? "In Tally, not confirmed" : "In a Tally file, not confirmed"];
  if (e.postError) return ["bad", "Tally refused: " + e.postError];
  if (e.status === "approved") return ["warn", "Post to Tally"];
  if (e.status === "rejected") return ["no", "No entry needed"];
  if (e.status === "duplicate") return ["warn", "Held as duplicate"];
  if (e.status === "deleted") return ["no", "Deleted"];
  return ["no", "To review"];
}
function txnRowsBills(){
  const co = CO(), d = D();
  // deleted bills are listed too, shown only under the "Deleted" filter (review of 02-Oct-2026)
  return Object.values(d.entries).map(e => {
    const x = e.x || {}, gst = num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess);
    const [cls, label] = tallyStateOf(e);
    // a purchase bill is posted as the voucher type chosen in Client setup (Testing AAD: Journal); said so beside it
    // (review of 02-Oct-2026: "Journal" on purchase bills looked like a mistake)
    return {id: e.id, kind: "bill", date: x.invoiceDate || "", up: (e.createdAt || "").slice(0, 10), vch: vchTypeOf(e, co), vchNote: e.noteKind ? "" : "the voucher type chosen for purchase bills in Client setup → Tally", no: x.invoiceNo || "",
      party: x.vendorName || e.fileName || "", taxable: num(x.taxable), gst, total: num(x.total), cls, label,
      file: e.fileName || "", docPath: e.docPath || "", hasFile: !!(S.files[e.id] || e.docPath || (S.fileIndex && S.fileIndex.has(e.id))), e};
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.up).localeCompare(String(a.up)));
}
function txnRowsSales(){
  const s = SL();
  if (!s || s.cid !== S.coId) return null;
  return s.list.map(v => {
    const x = v.x || {}, gst = num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess);
    const cls = v.status === "posted" ? "ok" : v.status === "ready" ? "warn" : v.status === "ignored" ? "no" : "no";
    const label = v.status === "posted" ? "In Tally" : v.status === "ready" ? "Post to Tally" : v.status === "ignored" ? "Set aside" : "To review";
    return {id: v.id, kind: "sale", date: x.date || "", up: (v.addedAt || "").slice(0, 10), vch: x.noteKind === "credit" ? "Credit Note" : x.noteKind === "debit" ? "Debit Note" : (s.cfg.voucherType || "Sales"),
      no: x.number || "", party: x.customerName || "", taxable: num(x.taxable), gst, total: num(x.total), cls, label, file: v.fileName || "", docPath: v.docPath || "", hasFile: !!(S.files["sv:" + v.id] || v.docPath || (S.fileIndex && S.fileIndex.has("sv:" + v.id))), v};
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function txnRowsBank(){
  const b = S.bank;
  if (!b || b.cid !== S.coId) return null;
  const stName = {};
  (b.stmts || []).forEach(st => { stName[st.id] = st; });
  return b.rows.map(r => {
    const st = stName[(r.id || "").split("-")[0]] || curStmt() || {};
    const cls = r.state === "sent" ? "ok" : r.state === "intally" ? "ok" : r.state === "ready" ? "warn" : r.state === "ignored" ? "no" : "no";
    const label = r.state === "sent" ? "In Tally" : r.state === "intally" ? "Already in Tally" : r.state === "ready" ? "Post to Tally" : r.state === "ignored" ? "Left out" : "To review";
    return {id: r.id, kind: "bank", date: r.date, up: (st.uploadedAt || "").slice(0, 10), vch: r.credit ? (CO().receiptType || "Receipt") : (CO().paymentType || "Payment"),
      no: (r.dec && (r.dec.utr || r.dec.chq)) || "", party: (r.dec && r.dec.name) || r.narr.slice(0, 40), taxable: 0, gst: 0,
      total: num(r.debit) || num(r.credit), dr: num(r.debit), cr: num(r.credit), cls, label, file: st.fileName || "", docPath: st.docPath || "", hasFile: !!(S.files["st:" + st.id] || st.docPath || (S.fileIndex && S.fileIndex.has("st:" + st.id))), stId: st.id, r};
  }).sort((a, b2) => String(b2.date).localeCompare(String(a.date)));
}
function txnF(){ S.txnF = S.txnF || {}; S.txnF[txnTab()] = S.txnF[txnTab()] || {}; return S.txnF[txnTab()]; }
function txnColPass(r){
  const f = txnF();
  if (f.from && (r.date || "") < f.from) return false;
  if (f.to && (r.date || "") > f.to) return false;
  if (f.vchs && f.vchs.length && !f.vchs.includes(r.vch)) return false;
  if (f.no && !String(r.no || "").toLowerCase().includes(f.no.toLowerCase())) return false;
  if (f.party && !String(r.party || "").toLowerCase().includes(f.party.toLowerCase())) return false;
  if (f.parties && f.parties.length && !f.parties.includes(r.party)) return false;
  if (f.min && num(r.total) < num(f.min)) return false;
  if (f.max && num(r.total) > num(f.max)) return false;
  if (f.states && f.states.length && !f.states.includes(r.label)) return false;
  if (f.doc === "yes" && !r.file) return false;
  if (f.doc === "no" && r.file) return false;
  return true;
}
function txnColOn(){ const f = txnF(); return Object.keys(f).some(k => Array.isArray(f[k]) ? f[k].length : f[k]); }
function txnFiltered(rows){
  const q = String(S.txnQ || "").trim().toLowerCase();
  const st = S.txnStatus || "";
  const stOf = r => r.e && r.e.status === "deleted" ? "del" : r.e && r.e.status === "duplicate" ? "dup" : "";
  return rows.filter(r => txnColPass(r) && (!q || [r.no, r.party, r.file, r.vch, String(r.total)].join(" ").toLowerCase().includes(q))
    && (st === "dup" || st === "del" ? stOf(r) === st : stOf(r) !== "del" && (!st || r.cls === st)));
}
// the register: React (app/src/screens/Txn.jsx)
function viewTransactions(){ return '<div data-react="Txn"></div>'; }
// the register as an Excel file (review item 30), the same rows and columns as the CSV, amounts as numbers
function txnTable(){
  const tab = txnTab();
  const rows = txnFiltered(tab === "bills" ? txnRowsBills() : tab === "sales" ? txnRowsSales() : txnRowsBank());
  const head = ["S. no.", "Date", "Uploaded", "Voucher", tab === "bank" ? "Reference" : "Invoice no.", tab === "sales" ? "Customer" : "Party",
    tab === "bank" ? "Withdrawal (₹)" : "Taxable (₹)", tab === "bank" ? "Deposit (₹)" : "GST (₹)", tab === "bank" ? "Amount (₹)" : "Invoice value (₹)", "In Tally", "Document"];
  const body = rows.map((r, i) => [i + 1, r.date ? fmtDate(r.date) : "", r.up ? fmtDate(r.up) : "", r.vch, r.no, r.party,
    num(tab === "bank" ? r.dr : r.taxable) || "", num(tab === "bank" ? r.cr : r.gst) || "", num(r.total) || "", r.label, r.file]);
  return {tab, head, body};
}
function txnExcel(){
  const t = txnTable();
  FC.excel("transactions-" + t.tab + "-" + new Date().toISOString().slice(0, 10), [[{bills: "Purchase", sales: "Sales", bank: "Bank"}[t.tab] || t.tab, [t.head].concat(t.body)]]);
}
// columns that can be hidden (the chooser on the Transactions page)
const TXN_COLS = [["date", "Date"], ["vch", "Voucher"], ["no", "Invoice no. / Reference"], ["party", "Party"], ["amts", "Taxable and GST / Withdrawal and deposit"], ["val", "Invoice value / Amount"], ["status", "In Tally"], ["doc", "Document"]];
function txnColShown(k){ return !(S.txnHide && S.txnHide[k]); }
function txnColToggle(k){ S.txnHide = Object.assign({}, S.txnHide, {[k]: txnColShown(k)}); render(); }
function txnCsv(){
  const tab = txnTab(), co = CO();
  const rows = txnFiltered(tab === "bills" ? txnRowsBills() : tab === "sales" ? txnRowsSales() : txnRowsBank());
  const head = ["S. no.", "Date", "Uploaded", "Voucher", tab === "bank" ? "Reference" : "Invoice no.", tab === "sales" ? "Customer" : "Party",
    tab === "bank" ? "Withdrawal" : "Taxable", tab === "bank" ? "Deposit" : "GST", tab === "bank" ? "Amount" : "Invoice value", "In Tally", "Document"];
  const body = rows.map((r, i) => [i + 1, r.date, r.up, r.vch, r.no, r.party, tab === "bank" ? r.dr : r.taxable, tab === "bank" ? r.cr : r.gst, r.total, r.label, r.file]);
  const csv = [head].concat(body).map(line => line.map(v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  saveFile(co.name.replace(/[^A-Za-z0-9]+/g, "-") + "-" + tab + "-" + new Date().toISOString().slice(0, 10) + ".csv", new Blob(["\ufeff" + csv], {type: "text/csv"}));
}

