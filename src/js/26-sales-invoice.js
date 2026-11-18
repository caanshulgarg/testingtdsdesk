/* @react-lazy: begin 26-sales-invoice.js (the React app loads this file with its Sales screen (app/src/screens/Sales.jsx): build.py react_parts) */
/* Sales: the printed invoice (was in src/js/26) */
/* ---------- the printed invoice ---------- */
function invoiceHtml(x, co, cfg){
  const inter = isInterState(x, co);
  const home = stateOfGstin(co.gstin);
  const items = (x.items || []).filter(it => it.desc || num(it.taxable));
  const hsn = new Map();
  items.forEach(it => { const k = (it.hsn || "\u2014") + "|" + num(it.gstRate); const e = hsn.get(k) || {hsn: it.hsn || "\u2014", rate: num(it.gstRate), taxable: 0}; e.taxable = r2(e.taxable + num(it.taxable)); hsn.set(k, e); });
  const f = n => INR.format(r2(n));
  const e = esc;
  const lines = items.length ? items : [{desc: "As per details", hsn: "", qty: "", unit: "", rate: "", taxable: x.taxable, gstRate: num(x.taxable) ? r2((num(x.cgst) + num(x.sgst) + num(x.igst)) / num(x.taxable) * 100) : 0}];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tax Invoice ' + e(x.number) + "</title><style>" +
    "@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0}" +
    ".inv{max-width:780px;margin:0 auto;border:1px solid #333}.row{display:flex}.cell{padding:6px 8px}.b{border-bottom:1px solid #333}.r{border-right:1px solid #333}" +
    "h1{font-size:18px;margin:0}h2{font-size:14px;margin:0;letter-spacing:.08em}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:4px 5px;vertical-align:top}" +
    "th{background:#f0f0f0;font-size:10px}.n{text-align:right;white-space:nowrap}.muted{color:#555}.w50{width:50%}.tot td{font-weight:bold}.sign{height:70px}" +
    "@media print{.noprint{display:none}}</style></head><body>" +
    '<p class="noprint" style="text-align:center"><button onclick="window.print()">Print / Save as PDF</button></p>' +
    '<div class="inv"><div class="cell b" style="text-align:center"><h2>TAX INVOICE</h2>' + (x.irn ? '<div class="muted">IRN: ' + e(x.irn) + "</div>" : "") +
      (x.ackNo ? '<div class="muted">Ack. No.: ' + e(x.ackNo) + (x.ackDt ? " · Ack. Date: " + e(fmtDateTime(x.ackDt)) : "") + "</div>" : "") +
      (x.irnStatus === "cancelled" ? '<div><b>IRN CANCELLED</b></div>' : "") +
      // the signed QR code of the e-invoice (rule 48(4)), drawn in the printed page from the IRP's signed text
      (x.signedQr && x.irnStatus !== "cancelled" ? '<div id="einvqr" style="display:inline-block;margin-top:6px"></div><scr' + 'ipt src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></scr' + 'ipt>' +
        "<scr" + "ipt>try{new QRCode(document.getElementById('einvqr'),{text:" + JSON.stringify(String(x.signedQr)).replace(/</g, "\\u003c") + ",width:150,height:150,correctLevel:QRCode.CorrectLevel.L})}catch(e){}</scr" + "ipt>" : "") + "</div>" +
    '<div class="row b"><div class="cell r w50"><h1>' + e(co.name) + "</h1>" + (cfg.address ? "<div>" + e(cfg.address).replace(/\n/g, "<br>") + "</div>" : "") +
      (co.gstin ? "<div><b>GSTIN:</b> " + e(co.gstin) + "</div>" : "") + (co.pan || co.gstin ? "<div><b>PAN:</b> " + e(co.pan || String(co.gstin).slice(2, 12)) + "</div>" : "") +
      (home ? "<div><b>State:</b> " + e(GST_STATES[home] || "") + " (" + home + ")</div>" : "") + (cfg.phone ? "<div>Phone: " + e(cfg.phone) + "</div>" : "") + (cfg.email ? "<div>Email: " + e(cfg.email) + "</div>" : "") + "</div>" +
      '<div class="cell w50"><table style="border:0"><tbody>' +
      [["Invoice No.", x.number], ["Invoice Date", fmtDate(x.date)], ["Place of Supply", x.pos ? (GST_STATES[x.pos] || "") + " (" + e(x.pos) + ")" : ""], ["Reverse Charge", "No"], ["Order / PO Ref.", x.poNo], ["E-way Bill No.", x.ewayNo], ["Credit period", x.dueDays ? x.dueDays + " days" : ""]]
        .filter(r => r[1]).map(r => '<tr><td style="border:0;padding:2px 0" class="muted">' + r[0] + '</td><td style="border:0;padding:2px 0"><b>' + e(r[1]) + "</b></td></tr>").join("") + "</tbody></table></div></div>" +
    '<div class="cell b"><div class="muted">Bill to</div><div style="font-size:13px"><b>' + e(x.customerName) + "</b></div>" + (x.address ? "<div>" + e(x.address).replace(/\n/g, "<br>") + "</div>" : "") +
      "<div><b>GSTIN:</b> " + (x.customerGstin ? e(x.customerGstin) : "Unregistered") + (x.pos ? " &nbsp; <b>State:</b> " + e(GST_STATES[x.pos] || "") + " (" + e(x.pos) + ")" : "") + "</div></div>" +
    "<table><thead><tr><th>#</th><th>Description of goods / services</th><th>HSN/SAC</th><th class=\"n\">Qty</th><th>Unit</th><th class=\"n\">Rate</th><th class=\"n\">Disc %</th><th class=\"n\">Taxable value</th><th class=\"n\">GST %</th>" +
      (inter ? '<th class="n">IGST</th>' : '<th class="n">CGST</th><th class="n">SGST</th>') + '<th class="n">Amount</th></tr></thead><tbody>' +
      lines.map((it, i) => { const t = r2(num(it.taxable) * num(it.gstRate) / 100), c = r2(t / 2);
        return "<tr><td>" + (i + 1) + "</td><td>" + e(it.desc) + "</td><td>" + e(it.hsn || "") + '</td><td class="n">' + e(it.qty) + "</td><td>" + e(it.unit || "") + '</td><td class="n">' + (it.rate !== "" ? f(it.rate) : "") + '</td><td class="n">' + (num(it.disc) ? num(it.disc) : "") + '</td><td class="n">' + f(it.taxable) + '</td><td class="n">' + num(it.gstRate) + "%</td>" +
          (inter ? '<td class="n">' + f(t) + "</td>" : '<td class="n">' + f(c) + '</td><td class="n">' + f(t - c) + "</td>") + '<td class="n">' + f(num(it.taxable) + t) + "</td></tr>"; }).join("") +
      '<tr class="tot"><td colspan="7" class="n">Total</td><td class="n">' + f(x.taxable) + "</td><td></td>" + (inter ? '<td class="n">' + f(x.igst) + "</td>" : '<td class="n">' + f(x.cgst) + '</td><td class="n">' + f(x.sgst) + "</td>") + '<td class="n">' + f(num(x.taxable) + num(x.cgst) + num(x.sgst) + num(x.igst)) + "</td></tr></tbody></table>" +
    '<div class="row b"><div class="cell r w50"><div class="muted">Amount in words</div><div><b>' + e(rupeesInWords(x.total)) + "</b></div>" +
      (x.notes ? '<div style="margin-top:6px" class="muted">Notes</div><div>' + e(x.notes).replace(/\n/g, "<br>") + "</div>" : "") + "</div>" +
      '<div class="cell w50"><table><tbody><tr><td>Taxable value</td><td class="n">' + f(x.taxable) + "</td></tr>" +
      (inter ? '<tr><td>IGST</td><td class="n">' + f(x.igst) + "</td></tr>" : '<tr><td>CGST</td><td class="n">' + f(x.cgst) + '</td></tr><tr><td>SGST</td><td class="n">' + f(x.sgst) + "</td></tr>") +
      (num(x.cess) ? '<tr><td>Cess</td><td class="n">' + f(x.cess) + "</td></tr>" : "") + (num(x.roundOff) ? '<tr><td>Round off</td><td class="n">' + f(x.roundOff) + "</td></tr>" : "") +
      '<tr class="tot"><td>Invoice total</td><td class="n">\u20b9 ' + f(x.total) + "</td></tr></tbody></table></div></div>" +
    (hsn.size ? '<table><thead><tr><th>HSN/SAC</th><th class="n">Taxable value</th><th class="n">Rate</th>' + (inter ? '<th class="n">IGST</th>' : '<th class="n">CGST</th><th class="n">SGST</th>') + '<th class="n">Total tax</th></tr></thead><tbody>' +
      Array.from(hsn.values()).map(hh => { const t = r2(hh.taxable * hh.rate / 100), c = r2(t / 2); return "<tr><td>" + e(hh.hsn) + '</td><td class="n">' + f(hh.taxable) + '</td><td class="n">' + hh.rate + "%</td>" + (inter ? '<td class="n">' + f(t) + "</td>" : '<td class="n">' + f(c) + '</td><td class="n">' + f(t - c) + "</td>") + '<td class="n">' + f(t) + "</td></tr>"; }).join("") + "</tbody></table>" : "") +
    '<div class="row"><div class="cell r w50">' + (cfg.bankAc ? '<div class="muted">Bank details</div><div>' + e(cfg.bankName) + (cfg.bankBranch ? ", " + e(cfg.bankBranch) : "") + "<br>A/c No.: <b>" + e(cfg.bankAc) + "</b><br>IFSC: <b>" + e(cfg.bankIfsc) + "</b></div>" : "") +
      (cfg.terms ? '<div class="muted" style="margin-top:6px">Terms and conditions</div><div>' + e(cfg.terms).replace(/\n/g, "<br>") + "</div>" : "") + "</div>" +
      '<div class="cell w50" style="text-align:right"><div>For <b>' + e(co.name) + '</b></div><div class="sign"></div><div>' + e(cfg.signatory || "Authorised Signatory") + "</div></div></div>" +
    '<div class="cell" style="border-top:1px solid #333;text-align:center" class="muted">This is a computer-generated invoice.</div></div></body></html>';
}
// an invoice read again (was in src/js/25: used on this screen only)
async function rereadSales(v, force){
  const s = SL(); if (!s) return;
  const file = S.files["sv:" + v.id];
  if (!file){ toast("The file for this invoice is not on this computer any more. Upload it again."); return; }
  if (force === "claude" && !claudeReady()){ toast("Claude is not available on this plan or in this view."); return; }
  if (force === "google" && !googleReady()){ toast("Google OCR is not set up."); return; }
  s.busy = force === "claude" ? "Reading again with Claude\u2026" : force === "google" ? "Reading again with Google OCR\u2026" : "Reading again\u2026"; render();
  try {
    const r = await readSalesFile(file, s.cid, m => { s.busy = m + "\u2026"; render(); }, null, force);
    Object.assign(v.x, r.x || {});
    v.method = r.method; v.problems = []; mapInvoice(v); saveSales();
    toast("Read again: " + (r.method || "") + ". Check the invoice.");
  } catch (e){ toast("Could not read it that way: " + errCopy(e && e.code)); }
  s.busy = ""; render();
}
// Why nothing can be posted (next-fix-sheet-import, 13-Nov-2026: "Post to Tally" was disabled, or did nothing, with no
// reason said): what the invoices under To review wait for, each invoice counted once by the first thing it needs, with
// where that is set. {text, btn, act} for the bar (app/src/screens/Sales.jsx), or null when nothing waits
function salesWhy(){
  const s = SL(), n = {};
  ((s && s.list) || []).filter(v => v.status === "review").forEach(v => {
    const p = (v.problems || [])[0], L = v.ledgerIssues || [], has = re => L.some(x => re.test(x));
    const k = p ? "fix" : has(/^sales ledger/) ? "sales" : has(/output ledger/) ? "tax" : has(/round-off/) ? "round" : has(/^customer ledger/) ? "cust" : L.length ? "tally" : "ok";
    n[k] = (n[k] || 0) + 1;
  });
  // (next-fix-sales-sync) the first correction named, whole: the bar showed the words before a colon only
  const fix1 = (((s && s.list) || []).find(v => v.status === "review" && (v.problems || []).length) || {problems: [""]}).problems[0];
  const W = {sales: "the sales ledger", tax: "the output GST ledgers", round: "the round-off ledger", cust: "a customer ledger", tally: "a ledger that is in Tally", fix: "a correction" + (fix1 ? " (" + fix1 + ")" : ""), ok: "only your Confirm"};
  const parts = Object.keys(W).filter(k => n[k]).map(k => n[k] + " invoice" + (n[k] === 1 ? " needs " : "s need ") + W[k]);
  if (!parts.length) return null;
  // next-fix-igst-pick: the output GST ledgers a person must choose (several fit, none by its state), each choice once
  // with its candidates, and how many waiting invoices it sets
  const ch = new Map();
  // (an invoice whose registration is not known, with several: chosen on its own row, never for the client: review of
  // 2f8b825a7; the bar says how many, and that the sheet's "Our GSTIN" column tells it)
  let unknown = 0;
  ((s && s.list) || []).filter(v => v.status === "review").forEach(v => { if ((v.taxAsk || []).some(a => !a.ck)) unknown++; (v.taxAsk || []).filter(a => a.ck).forEach(a => {
    const c = ch.get(a.ck) || {ck: a.ck, kind: a.kind, reg: a.reg, cands: a.cands, n: 0}; c.n++; ch.set(a.ck, c); }); });
  const set = n.sales || n.tax || n.round;
  return {text: parts.join("; ") + (set ? ": set it here" : ": see To review"), btn: set ? "Set it here" : "Open To review",
    act: () => { if (set) s.showSettings = true; else s.filter = "review"; render(); }, choices: Array.from(ch.values()), unknown};
}
// "Edit type" on an invoice held for a person (a sheet's negative amount, or "Purchase Return" on Sales): they say what
// it is; its amounts are taken positive, a credit note's number marked as a sheet's is, and it is held no more
function salesSetKind(id, k){
  const v = inv(id); if (!v || !k || !v.hold || v.status !== "review") return;   // only a held invoice still in To review
  const x = v.x;
  ["taxable", "cgst", "sgst", "igst", "cess", "total"].forEach(f => { x[f] = Math.abs(num(x[f])); });
  (x.items || []).forEach(it => ["taxable", "igst", "cgst", "sgst", "tax"].forEach(f => { if (it[f] != null && it[f] !== "") it[f] = Math.abs(num(it[f])); }));
  x.noteKind = k === "invoice" ? "" : k;
  if (k === "credit" && !/^cn|\(CN\)$/i.test(x.number)) x.number += " (CN)";
  delete v.hold; mapInvoice(v); saveSales(); render();
}
// "Post one by one to find the cause": each invoice Tally refused in a batch is sent again on its own, through the same
// posting path (Bridge.post: the same voucher XML, one voucher a request). Allowed because "created 0" is a definite
// refusal: Tally made nothing of the request (the bridge forgets such a request, the cloud's id is not live). Each one's
// own answer is kept on it and listed (s.oneByOne). With ids (an invoice's own "Try again"): those invoices, refused on
// their own too, or held as not confirmed. The duplicate check runs first, every time
async function salesPostOneByOne(ids){
  const s = SL(), co = CO(s.cid);
  let list = s.list.filter(v => v.status === "review" && (ids ? ids.includes(v.id) && (v.refused || v.needsCheck) : v.refused && !v.refused.single));
  if (!list.length){ toast(ids ? "This invoice is not waiting to be tried again." : "No invoice refused in a batch is waiting."); return; }
  if (!(await ensureTallyCompany(co))) return;
  const tn = tallyCoName(co), out = [];
  s.oneByOne = {at: new Date().toISOString(), rows: out};
  try {
    s.busy = "Checking Tally for invoices already booked\u2026"; render();
    try { await salesCheckTally(list); }
    catch (e){ toast((e && e.message) || "Tally could not be checked, so nothing was posted."); return; }
    list.filter(v => v.status === "intally").forEach(v => { delete v.refused; out.push({id: v.id, number: v.x.number, ok: true, word: "Already in Tally: not posted again"}); });
    list.filter(v => v.status !== "intally" && salesDupOf(v)).forEach(v => out.push({id: v.id, number: v.x.number, ok: false, word: salesDupWords(salesDupOf(v)) + " Not posted: press “Post duplicate anyway” on it to post it."}));
    list = list.filter(v => v.status !== "intally" && !salesDupOf(v));
    for (let i = 0; i < list.length; i++){
      const v = list[i];
      s.busy = "Posting one by one: " + (i + 1) + " of " + list.length + " (" + v.x.number + ")\u2026"; render();
      const masters = mastersFor([v]), now = new Date().toISOString();
      let r = null;
      try {
        const j = await Bridge.post({company: tn, client: co.id, masters: masters.map(l => ({id: "led:" + l.name, xml: (/sundry/i.test(l.group || "sundry") ? customerMasterXml : ledgerMasterXml)(l)})), vouchers: [{id: v.id, xml: salesVoucherXml(v, co)}]});
        const by = new Map([].concat(j.results || []).map(x => [x.id, x]));
        masters.forEach(l => { const m = by.get("led:" + l.name); if (m && m.ok){ l.sent = true; l.sentAt = now; } });
        r = by.get(v.id) || null;
      } catch (e){ r = {ok: false, outcomeUnknown: true, message: (e && e.message) || String(e)}; }
      const no = salesRefusal(r), said = plainMsg(r && r.message) || "";
      // Tally said why and made nothing (a line error with created 0): its words, the invoice put right and posted again
      const told = r && r.ok === false && !r.outcomeUnknown && !r.held && r.created != null && r.created !== "" && num(r.created) === 0 && !num(r.altered) && [].concat(r.lineError || []).some(x => String(x || "").trim());
      let word;
      delete v.refused; delete v.needsCheck;
      if (r && r.ok && r.verified === true){ v.status = "posted"; v.postedAt = now; v.postError = ""; v.postedInto = r.company || ""; v.postedOptional = !!r.optional; learnCustomer(v); word = "Posted"; }
      else if (r && r.held){ v.status = "ready"; v.postError = said; v.postJob = r.job; word = "Queued: " + said; }
      else if (no){ salesMarkRefused(v, r, {n: 1, exceptions: no.exceptions}, true); word = "Refused by Tally on its own, with no reason given: this voucher is one that stops the batch"; }
      else if (told){ v.postError = said; mapInvoice(v); word = "Not posted: " + said; }
      // (no answer, a timeout, an answer not read back, anything else: it may be in Tally; held until the check runs again)
      else { v.needsCheck = true; v.postError = "Not confirmed: check Tally before posting again" + (said ? " [" + said + "]" : ""); mapInvoice(v); word = "Not confirmed: check Tally before posting again"; }
      salesOverrideSpent([v]);   // (a "Post duplicate anyway" is good for this one attempt)
      out.push({id: v.id, number: v.x.number, ok: v.status === "posted", word});
      saveSales();
    }
  } finally { s.busy = ""; saveBank({newLed: true}); saveSales(); render(); }
  const okN = out.filter(x => x.ok).length;
  toast("One by one: " + okN + " of " + out.length + " posted" + (okN < out.length ? "; the rest say why under To review" : "") + ".");
  render();
}
// The owner (16-Nov-2026): every ledger FinCom set on an invoice can be changed by a person, on the invoice (a searchable
// box of the client's exact Tally ledger names) and on several at once; what a person picks is kept ("set by you"),
// never worked out again, until they press "undo, let FinCom pick". Posted invoices are not changed.
//   role: "party" | "sales" | "igst" | "cgst" | "sgst" | "cess"; rate: the GST rate of the line ("all" in bulk)
// Returns whether the invoice had such a line (false: nothing changed)
function salesLineSet(v, role, rate, ledger){
  const l = exactLedger(ledger); if (!l || !v || !["review", "ready"].includes(v.status)) return false;
  const lines = salesLines(v), all = rate === "all" || rate == null || rate === "";
  if (role === "party"){
    if (v.custSource !== "Set by you") v.custWas = {ledger: v.customerLedger || "", source: v.custSource || "", user: !!v.userLedger, sure: !!v.custSure};
    v.customerLedger = l; v.userLedger = true; v.custSource = "Set by you";
  } else if (role === "sales"){
    const rates = lines.filter(x => x.role === "sales" && (all || num(x.rate) === num(rate))).map(x => num(x.rate));
    if (!rates.length) return false;
    v.salesLedgers = Object.assign({}, v.salesLedgers); v.salesBy = Object.assign({}, v.salesBy);
    rates.forEach(r => { if (!v.salesBy[r]) v.salesBy[r] = {was: (v.salesLedgers || {})[r] || ""}; v.salesLedgers[r] = l; });
  } else {
    const keys = [].concat(...lines.filter(x => x.role === "tax" && x.kind === role).map(x => x.keys || [])).filter(k => role === "cess" || all || k === salesTaxKey(role, rate));
    if (!keys.length) return false;
    v.taxLedgers = Object.assign({}, v.taxLedgers); keys.forEach(k => { v.taxLedgers[k] = l; });
  }
  delete v.refused;   // (changed: not the voucher Tally refused)
  mapInvoice(v);
  return true;
}
// "undo, let FinCom pick": the person's choice on that line is let go, the ledger worked out as for any invoice
function salesLineUnset(id, role, keys){
  const s = SL(), v = inv(id); if (!v || !["review", "ready"].includes(v.status)) return;
  const before = [salesSnapshot(v)];
  if (role === "party"){
    const w = v.custWas; delete v.custWas;
    if (w && exactLedger(w.ledger)){ v.customerLedger = w.ledger; v.custSource = w.source; v.userLedger = w.user; v.custSure = w.sure; }
    else { v.customerLedger = ""; v.userLedger = false; v.custSource = ""; }
  } else if (role === "sales"){
    [].concat(keys).forEach(r => { const b = (v.salesBy || {})[r]; if (!b) return; if (b.was) v.salesLedgers[r] = b.was; else delete v.salesLedgers[r]; delete v.salesBy[r]; });
  } else [].concat(keys || []).forEach(k => { if (v.taxLedgers) delete v.taxLedgers[k]; });
  mapInvoice(v); salesSetUndo("Invoice " + esc(v.x.number || "") + ": FinCom picks the ledger again", before); saveSales(); render();
}
// one line of the invoice that is open (or any invoice by id), from its box
function salesLinePick(id, role, rate, ledger){
  const s = SL(), v = inv(id);
  if (!exactLedger(ledger)){ toast("\u201c" + ledger + "\u201d is not a Tally ledger. Choose one from the list."); return false; }
  if (!v || !["review", "ready"].includes(v.status)){ toast("A posted invoice is not changed."); return false; }
  if (role === "party"){ setCustomerLedger(v, ledger); render(); return true; }
  const before = [salesSnapshot(v)];
  if (!salesLineSet(v, role, rate, ledger)) return false;
  salesSetUndo("Invoice " + esc(v.x.number || "") + ": " + esc(role) + " \u2192 <b>" + esc(exactLedger(ledger)) + "</b>", before); saveSales(); render();
  return true;
}
// "Change ledger" on the invoices ticked: one line (sales, party, IGST, CGST, SGST or cess; a rate, or all) on each that
// is not posted; undone with Undo
function salesBulkLine(role, rate, ledger){
  const s = SL(), l = exactLedger(ledger);
  if (!l){ toast("\u201c" + ledger + "\u201d is not a Tally ledger. Choose one from the list."); return null; }
  const rows = s.list.filter(v => s.sel.has(v.id)), before = [];
  let changed = 0, skipped = 0;
  rows.forEach(v => {
    if (!["review", "ready"].includes(v.status)){ skipped++; return; }
    const snap = salesSnapshot(v);
    if (salesLineSet(v, role, rate, l)){ changed++; before.push(snap); s.sticky.add(v.id); } else skipped++;
  });
  if (before.length) salesSetUndo("Changed the " + esc(role) + " ledger on " + changed + " invoice" + (changed === 1 ? "" : "s") + " \u2192 <b>" + esc(l) + "</b>", before);
  saveSales();
  const msg = "Changed on " + changed + " invoice" + (changed === 1 ? "" : "s") + "; " + skipped + " skipped (posted / no such line)";
  s.bulkLineMsg = msg; toast(msg + "."); render();
  return {changed, skipped};
}
if (typeof salesLinePick !== "undefined") globalThis.salesLinePick = salesLinePick;
if (typeof salesLineUnset !== "undefined") globalThis.salesLineUnset = salesLineUnset;
if (typeof salesBulkLine !== "undefined") globalThis.salesBulkLine = salesBulkLine;
// "Post duplicate anyway" (the owner, 16-Nov-2026: any person, no role needed): an invoice whose number Tally, or FinCom's
// own posted record, already has under a Sales-class type is posted again only when a person presses it and confirms a
// second time; who and when are kept on the invoice and in the audit trail. It is then Ready, and goes with Post to Tally
async function salesDupOverride(id){
  const s = SL(), v = inv(id), d = v && salesDupOf(v); if (!d || !["review", "ready"].includes(v.status)) return;
  const words = salesDupWords(d);
  const a = await askConfirm({title: "Post a duplicate?", ok: "Post duplicate anyway", danger: true, body: '<p class="note" data-dup-first=""><b>' + esc(words) + "</b></p><p class=\"note\">Invoice " + esc(v.x.number || "") + " has the same number and type. Posting it creates a second voucher of that number in Tally.</p>"});
  if (!a) return;
  const b = await askConfirm({title: "Post it again, for certain?", ok: "Yes, post the duplicate", danger: true, body: '<p class="note" data-dup-again="">Tally will have two vouchers numbered ' + esc(d.number || v.x.number || "") + ". This is kept with your name and the time.</p>"});
  if (!b || !inv(id)) return;
  v.dupOverride = {no: normInvNo(v.x.number), by: whoAmI(), at: new Date().toISOString(), of: d};
  delete v.dupBlock; s.dupSkipped = (s.dupSkipped || []).filter(x => x !== id);
  auditEvent("sales_duplicate_override", "Invoice " + (v.x.number || v.id) + ": posted again over " + words + " (by " + v.dupOverride.by + ")", s.cid);
  mapInvoice(v); saveSales(); toast(v.status === "ready" ? "Ready to post: it goes with Post to Tally." : "Kept. It still needs: " + ((v.problems || []).concat(v.ledgerIssues || [])[0] || "a look"));
  render();
}
if (typeof salesDupOverride !== "undefined") globalThis.salesDupOverride = salesDupOverride;
if (typeof salesSetKind !== "undefined") globalThis.salesSetKind = salesSetKind;
if (typeof salesPostOneByOne !== "undefined") globalThis.salesPostOneByOne = salesPostOneByOne;
if (typeof rereadSales !== "undefined") globalThis.rereadSales = rereadSales;
if (typeof salesWhy !== "undefined") globalThis.salesWhy = salesWhy;
if (typeof invoiceHtml !== "undefined") globalThis.invoiceHtml = invoiceHtml;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
// next-fix-sales-sync: the invoices waiting, looked at again on this computer (src/js/25, salesSynced). True when it ran
const salesFilled = new Set();
function salesRemapWaiting(){
  const s = SL(), b = B(), L = b && b.cid === (s && s.cid) && b.ledgers.list;
  if (!s || s.loading || s.busy || !(L && L.length) || (s.remapKey && s.remapKey === L)) return false;
  let filled = 0;
  salesNoIdx = Ledgers.keyed(s.list, v => normInvNo(v.x.number));
  try {
    Ledgers.run(() => s.list.forEach(v => {
      if (!["review", "ready"].includes(v.status) || v.postJob || v.needsMap) return;
      const k = v.__vw, before = k && JSON.stringify(v) === k.after ? k.before : JSON.stringify(v), blank = !v.customerLedger;
      mapInvoice(v, true);
      const after = JSON.stringify(v), key = s.cid + "|" + v.id + "|" + v.customerLedger;
      if (blank && v.customerLedger && !salesFilled.has(key)){ salesFilled.add(key); filled++; delete v.__vw; }
      else if (after !== before) Object.defineProperty(v, "__vw", {value: {before, after}, configurable: true, writable: true, enumerable: false});
      else delete v.__vw;
    }));
  } finally { salesNoIdx = null; }
  s.remapKey = L;
  if (filled) saveSales();
  return true;
}
if (typeof salesRemapWaiting !== "undefined") globalThis.salesRemapWaiting = salesRemapWaiting;
// next-fix-sales-hang (FINCOM-APP-STAGING-K, staging 18-Nov-2026: 2,063 ms in React's click handler on Sales, last_ui
// side-client): the client card opens the switcher, which draws the page again in the click's task, Sales with it. Each
// invoice waiting showed its duplicate check (SalesAsk), and with no index by number each check went through every
// invoice of the client (salesOfNo: the whole list): the drawing, and the problems worked out again on opening
// (loadSales), went as the square of the invoices. f is run with the invoices listed by number once: within a drawing
// the one list for the whole drawing (perRender, src/js/01), else made for f. tests/run_hang_sales_open.py
function salesByNo(f){
  const s = SL(), was = salesNoIdx;
  if (was || !s || !s.list) return f();
  const make = () => Ledgers.keyed(s.list, v => normInvNo(v.x.number));
  salesNoIdx = typeof perRender === "function" ? perRender(s, "salesByNo", make) : make();
  try { return f(); } finally { salesNoIdx = was; }
}
function salesDupNow(v){ return salesByNo(() => salesDupOf(v)); }
if (typeof salesByNo !== "undefined") globalThis.salesByNo = salesByNo;
if (typeof salesDupNow !== "undefined") globalThis.salesDupNow = salesDupNow;
// (this file comes with the Sales screen: what is open is looked at now)
setTimeout(() => { try { if (salesRemapWaiting()) render(); } catch (e){} }, 0);
/* @react-lazy: end */
