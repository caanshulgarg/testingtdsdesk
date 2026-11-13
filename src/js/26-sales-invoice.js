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
  const W = {sales: "the sales ledger", tax: "the output GST ledgers", round: "the round-off ledger", cust: "a customer ledger", tally: "a ledger that is in Tally", fix: "a correction", ok: "only your Confirm"};
  const parts = Object.keys(W).filter(k => n[k]).map(k => n[k] + " invoice" + (n[k] === 1 ? " needs " : "s need ") + W[k]);
  if (!parts.length) return null;
  const set = n.sales || n.tax || n.round;
  return {text: parts.join("; ") + (set ? ": set it here" : ": see To review"), btn: set ? "Set it here" : "Open To review",
    act: () => { if (set) s.showSettings = true; else s.filter = "review"; render(); }};
}
// "Edit type" on an invoice held for a person (a sheet's negative amount, or "Purchase Return" on Sales): they say what
// it is; its amounts are taken positive, a credit note's number marked as a sheet's is, and it is held no more
function salesSetKind(id, k){
  const v = inv(id); if (!v || !k) return;
  const x = v.x;
  ["taxable", "cgst", "sgst", "igst", "cess", "total"].forEach(f => { x[f] = Math.abs(num(x[f])); });
  x.noteKind = k === "invoice" ? "" : k;
  if (k === "credit" && !/^cn|\(CN\)$/i.test(x.number)) x.number += " (CN)";
  delete v.hold; mapInvoice(v); saveSales(); render();
}
if (typeof salesSetKind !== "undefined") globalThis.salesSetKind = salesSetKind;
if (typeof rereadSales !== "undefined") globalThis.rereadSales = rereadSales;
if (typeof salesWhy !== "undefined") globalThis.salesWhy = salesWhy;
if (typeof invoiceHtml !== "undefined") globalThis.invoiceHtml = invoiceHtml;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
/* @react-lazy: end */
