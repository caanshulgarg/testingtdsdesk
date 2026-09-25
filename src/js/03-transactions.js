/* ================================================================== */
/* Transactions: everything filed for this client, in one register    */
/* ================================================================== */
function txnTab(){ return S.txnTab || "bills"; }
function vchTypeOf(e, co){
  if (e.noteKind === "credit") return co.debitNoteType || "Debit Note";
  if (e.noteKind === "debit") return "Purchase";
  return co.voucherType || "Journal";
}
function tallyStateOf(e){
  if (e.exportedAt) return e.postUnverified ? ["sent", "In Tally, not confirmed"] : ["ok", "In Tally"];
  if (e.postError) return ["bad", "Tally refused: " + e.postError];
  if (e.status === "approved") return ["warn", "Ready to post"];
  if (e.status === "rejected") return ["no", "No entry needed"];
  if (e.status === "duplicate") return ["warn", "Held as duplicate"];
  return ["no", "To review"];
}
function txnRowsBills(){
  const co = CO(), d = D();
  return Object.values(d.entries).map(e => {
    const x = e.x || {}, gst = num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess);
    const [cls, label] = tallyStateOf(e);
    return {id: e.id, kind: "bill", date: x.invoiceDate || "", up: (e.createdAt || "").slice(0, 10), vch: vchTypeOf(e, co), no: x.invoiceNo || "",
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
    const label = v.status === "posted" ? "In Tally" : v.status === "ready" ? "Ready to post" : v.status === "ignored" ? "Set aside" : "To review";
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
    const label = r.state === "sent" ? "In Tally" : r.state === "intally" ? "Already in Tally" : r.state === "ready" ? "Ready to post" : r.state === "ignored" ? "Left out" : "To review";
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
  return rows.filter(r => txnColPass(r) && (!q || [r.no, r.party, r.file, r.vch, String(r.total)].join(" ").toLowerCase().includes(q)) && (!st || r.cls === st));
}
function viewTransactions(){
  const co = CO();
  const tab = txnTab();
  const rowsAll = tab === "bills" ? txnRowsBills() : tab === "sales" ? txnRowsSales() : txnRowsBank();
  if (rowsAll === null){
    if (tab === "sales" && (!S.sales || S.sales.cid !== co.id)) loadSales(co.id).then(() => render());
    if (tab === "bank" && (!S.bank || S.bank.cid !== co.id)) loadBank(co.id).then(() => render());
    return '<p class="note">Opening\u2026</p>';
  }
  if (!S.fileIndex || S.fileIndexCid !== co.id){ S.fileIndexCid = co.id; FileStore.index(co.id).then(() => render()); }
  const rows = txnFiltered(rowsAll);
  const money = v => v ? INR.format(r2(v)) : "\u2014";
  let h = '<nav class="sbar" aria-label="Kind">' + [["bills", "Purchase", txnRowsBills().length], ["sales", "Sales", S.sales && S.sales.cid === co.id ? S.sales.list.length : null], ["bank", "Bank", S.bank && S.bank.cid === co.id ? S.bank.rows.length : null]]
    .map(([id, label, n]) => '<button data-txntab="' + id + '" aria-selected="' + (tab === id) + '">' + label + (n == null ? "" : ' <span class="sbar-n">' + n + "</span>") + "</button>").join("") + "</nav>";
  h += '<div class="revfilter"><input type="search" id="txnq" data-fk="txnq" data-keeptyped value="' + esc(S.txnQ || "") + '" placeholder="Find by invoice no., party, file or amount">' +
    '<select data-txnstatus aria-label="Status"><option value="">Any status</option>' +
    [["ok", "In Tally"], ["warn", "Ready or held"], ["no", "Not posted"], ["bad", "Refused by Tally"]].map(([v, l]) => '<option value="' + v + '"' + (S.txnStatus === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
    '<span class="note">' + rows.length + " of " + rowsAll.length + "</span>" +
    '<button class="btn small" data-act="txnCsv">Download as CSV</button></div>';
  h += colChipBar("txn", rows.length, rowsAll.length + (tab === "bank" ? " lines" : tab === "sales" ? " invoices" : " bills"));
  h += '<div class="bk-tablewrap"><table class="bk-table txntbl"><thead><tr><th class="n">S. no.</th>' +
    colHead("txn", "date", "Date", "dt") + colHead("txn", "vch", "Voucher") + colHead("txn", "no", tab === "bank" ? "Reference" : "Invoice no.") + colHead("txn", "party", tab === "sales" ? "Customer" : "Party") +
    (tab === "bank" ? '<th class="n">Withdrawal</th><th class="n">Deposit</th>' : '<th class="n">Taxable</th><th class="n">GST</th>') +
    colHead("txn", "val", tab === "bank" ? "Amount" : "Invoice value", "n") + colHead("txn", "status", "In Tally") + colHead("txn", "doc", "Document") + '<th class="ac"></th></tr></thead><tbody>';
  h += rows.map((r, i) => "<tr><td class=\"n\">" + (i + 1) + '</td><td>' + (r.date ? fmtDate(r.date) : "\u2014") + (r.up ? '<div class="nr">up ' + fmtDate(r.up) + "</div>" : "") + "</td>" +
    "<td>" + esc(r.vch) + "</td><td>" + esc(r.no || "\u2014") + "</td><td>" + esc(r.party) + "</td>" +
    (tab === "bank" ? '<td class="n">' + money(r.dr) + '</td><td class="n">' + money(r.cr) + "</td>" : '<td class="n">' + money(r.taxable) + '</td><td class="n">' + money(r.gst) + "</td>") +
    '<td class="n">' + money(r.total) + '</td><td><span class="tag ' + r.cls + '">' + esc(r.label) + "</span></td>" +
    "<td>" + (r.file ? (r.hasFile
      ? '<button class="linkbtn" data-txnopen="' + (r.kind === "bank" ? "st:" + r.stId : r.kind === "sale" ? "sv:" + r.id : r.id) + '" data-txnpath="' + esc(r.docPath || "") + '" data-txnname="' + esc(r.file) + '" title="Open ' + esc(r.file) + '">\ud83d\udcce ' + esc(r.file.slice(0, 18)) + "</button>" +
        '<div class="nr">' + (r.docPath ? '<span class="tag ok" title="Anyone in the firm can open it, from any computer">in the firm account</span>' : '<span class="tag" title="It is on this computer only">this computer only</span>') + "</div>"
      : '<span class="note" title="The file was uploaded before documents were kept, or on another computer">' + esc(r.file.slice(0, 18)) + "</span>") : "\u2014") + "</td>" +
    '<td class="ac"><button class="btn small" data-txngo="' + r.id + '" data-txnkind="' + r.kind + '">Open</button></td></tr>').join("");
  h += "</tbody></table>" + (rows.length ? "" : ((S.txnQ || S.txnStatus || txnColOn()) ? noMatchNote("txn") : '<div class="bk-none">Nothing here yet.</div>')) + "</div>";
  return h;
}
function txnCsv(){
  const tab = txnTab(), co = CO();
  const rows = txnFiltered(tab === "bills" ? txnRowsBills() : tab === "sales" ? txnRowsSales() : txnRowsBank());
  const head = ["S. no.", "Date", "Uploaded", "Voucher", tab === "bank" ? "Reference" : "Invoice no.", tab === "sales" ? "Customer" : "Party",
    tab === "bank" ? "Withdrawal" : "Taxable", tab === "bank" ? "Deposit" : "GST", tab === "bank" ? "Amount" : "Invoice value", "In Tally", "Document"];
  const body = rows.map((r, i) => [i + 1, r.date, r.up, r.vch, r.no, r.party, tab === "bank" ? r.dr : r.taxable, tab === "bank" ? r.cr : r.gst, r.total, r.label, r.file]);
  const csv = [head].concat(body).map(line => line.map(v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  saveFile(co.name.replace(/[^A-Za-z0-9]+/g, "-") + "-" + tab + "-" + new Date().toISOString().slice(0, 10) + ".csv", new Blob(["\ufeff" + csv], {type: "text/csv"}));
}

