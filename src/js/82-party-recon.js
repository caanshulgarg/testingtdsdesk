/* ================================================================== */
/* A vendor's or customer's statement against its ledger in the books */
/* ================================================================== */
// The owner (14-Oct-2026): "Vendor reconciliation and customer reconciliation should come under the Reconciliation tab.
// We can upload any format, purchase and sale. AI will read that format once and after that it will use memory. Prepare
// a proper reconciliation. If the opening has a difference, then also show it in the difference."
//
// The party's statement (its ledger of the client, or a balance confirmation) in any format: read by the sheet engine
// (SheetFmt, src/js/81: fingerprint, the AI's mapping once, saved, then rules) with the statement's own fields
// (PARTY_FIELDS); against the party's ledger in FinCom's copy of the books (Tally or Zoho: LK.ledgerBooks), seen from
// both sides (their debit is our credit). Every figure is FinCom's: the AI only maps columns.
//   PartyRecon.statement(fmt, grid, hi)   → {open, rows: [{date, no, narr, dr, cr, tds, gst}], close}   (their side)
//   PartyRecon.run({side, ours, theirs})  → {open, matched, oursOnly, theirsOnly, differs, tds, gst, statement}
// In a run every amount is in OUR view and signed so a party's normal balance is positive: for a vendor what we owe
// (credit), for a customer what is owed to us (debit).

const PARTY_FIELDS = [["date", "Date"], ["no", "Document no."], ["narration", "Particulars / narration"], ["debit", "Debit"], ["credit", "Credit"],
  ["amount", "Amount (one signed column)"], ["drcr", "Dr / Cr"], ["balance", "Balance"], ["tds", "TDS"], ["gst", "GST"]];
const RECON_TOL = {days: 7, rupees: 1};

const PartyRecon = {
  // their statement, read by a mapping (their side: their debit, their credit); the opening line and a closing line found
  statement(fmt, grid, hi){
    const head = (grid[hi] || []).map(h => SheetFmt.norm(h)), map = fmt.map || {}, t = fmt.transforms || {};
    const idx = {}; PARTY_FIELDS.forEach(([f]) => { idx[f] = map[f] ? head.indexOf(map[f]) : -1; });
    const get = (r, f) => idx[f] >= 0 ? r[idx[f]] : "", a = (r, f) => SheetFmt.amount(get(r, f));
    let open = null, close = null, lastBal = null;
    const rows = [];
    grid.slice(hi + 1).forEach((r, n) => {
      if (!r || !r.some(c => String(c == null ? "" : c).trim())) return;
      const narr = String(get(r, "narration") || "").trim(), text = r.map(c => String(c == null ? "" : c)).join(" ");
      let dr = a(r, "debit"), cr = a(r, "credit");
      if (idx.amount >= 0 && !dr && !cr){ const v = a(r, "amount"), side = String(get(r, "drcr") || "").trim().toLowerCase();
        if (/^c/.test(side)) cr = Math.abs(v); else if (/^d/.test(side)) dr = Math.abs(v); else if (v < 0) cr = -v; else dr = v; }
      // a negative in the debit column is a credit (a statement that writes reversals so)
      if (dr < 0){ cr = r2(cr - dr); dr = 0; } if (cr < 0){ dr = r2(dr - cr); cr = 0; }
      const balRaw = get(r, "balance"), bal = idx.balance >= 0 && String(balRaw == null ? "" : balRaw).trim() !== "" ? this.signed(balRaw) : null;
      if (/opening|b\/f|brought\s*forward|balance\s*b\/d/i.test(narr || text)){ open = bal != null ? bal : r2(dr - cr); return; }
      if (/closing|c\/f|carried\s*forward|balance\s*c\/d/i.test(narr || text)){ close = bal != null ? bal : r2(dr - cr); return; }
      if (/^(grand\s*)?total/i.test(String(r.find(c => String(c == null ? "" : c).trim()) || ""))) return;
      if (!dr && !cr) return;
      const date = SheetFmt.date(get(r, "date"), t.date);
      rows.push({date, no: String(get(r, "no") || "").trim(), narr, dr: r2(dr), cr: r2(cr), tds: Math.abs(a(r, "tds")), gst: Math.abs(a(r, "gst")), row: hi + 2 + n});
      if (bal != null) lastBal = bal;
    });
    const moved = r2(rows.reduce((s, x) => s + x.dr - x.cr, 0));
    // the opening: as the statement says; else what its first balance implies
    if (open == null){ const first = rows[0]; open = first && idx.balance >= 0 && lastBal != null ? null : 0; if (open == null) open = 0; }
    if (close == null) close = lastBal != null ? lastBal : r2(open + moved);
    return {open: r2(open), rows, close: r2(close), moved};
  },
  // a balance written "12,345.00 Dr" / "Cr" / "-12,345" (their side: debit positive)
  signed(v){ const s = String(v == null ? "" : v); const n = Math.abs(SheetFmt.amount(s)); return /cr\.?\s*$/i.test(s.trim()) || (SheetFmt.amount(s) < 0 && !/dr\.?\s*$/i.test(s.trim())) ? -n : n; },
  // the document numbers a line carries: its own, and those in its narration
  refs(x){ const out = new Set(); [x.no].concat(typeof VR === "object" ? VR.refs(x.narr || "") : []).filter(Boolean).forEach(t => { const n = normInv(t); if (n) out.add(n); }); return out; },
  days(a, b){ return a && b ? Math.abs((Date.parse(a) - Date.parse(b)) / 86400000) : 999; },
  // ours: the ledger's lines (LK.ledgerBooks rows: dr, cr from our books), with the TDS and GST of the voucher
  oursFrom(st, side){
    const tdsL = /tds|tax\s*deducted/i, gstL = /\b(i|c|s|ut)?gst\b|input\s*tax|output\s*tax/i;
    return {open: side === "vendor" ? -num(st.open) : num(st.open), rows: (st.rows || []).map(v => {
      const tds = r2(Math.abs((v.ent || []).filter(e => tdsL.test(e.l)).reduce((s, e) => s + e.a, 0)));
      const gst = r2(Math.abs((v.ent || []).filter(e => gstL.test(e.l) && !tdsL.test(e.l)).reduce((s, e) => s + e.a, 0)));
      return {id: v.id, date: v.date, no: v.no || "", narr: [v.type, v.narr].filter(Boolean).join(": "), dr: v.dr, cr: v.cr, tds, gst};
    }), close: st.close == null ? null : (side === "vendor" ? -num(st.close) : num(st.close))};
  },
  // the reconciliation. ours: {open, rows: [{date, no, narr, dr, cr, tds, gst}], close} in our books (dr/cr ours);
  // theirs: the statement (dr/cr theirs). side "vendor" | "customer"
  run({side, ours, theirs, explained}){
    const v = side !== "customer";
    // in our view, the party's normal balance positive: a vendor's credit, a customer's debit
    const oAmt = x => r2(v ? x.cr - x.dr : x.dr - x.cr), tAmt = x => r2(v ? x.dr - x.cr : x.cr - x.dr);
    const O = ours.rows.map((x, i) => Object.assign({k: "o" + i, amt: oAmt(x), refs: this.refs(x)}, x));
    const T = theirs.rows.map((x, i) => Object.assign({k: "t" + i, amt: tAmt(x), refs: this.refs(x)}, x));
    const oOpen = r2(v ? num(ours.open) : num(ours.open)), tOpen = r2(v ? num(theirs.open) : -num(theirs.open));
    const oClose = ours.close != null ? r2(ours.close) : r2(oOpen + O.reduce((s, x) => s + x.amt, 0));
    const tClose = r2(v ? num(theirs.close) : -num(theirs.close));
    const used = new Set(), matched = [], differs = [], tdsDiff = [], gstDiff = [];
    const pair = (o, t, how) => {
      used.add(o.k); used.add(t.k);
      const diff = r2(t.amt - o.amt), late = this.days(o.date, t.date);
      if (Math.abs(diff) <= RECON_TOL.rupees && late <= RECON_TOL.days){ matched.push({o, t, how, diff}); }
      // TDS we deducted that they do not show: their figure is ours plus our TDS
      else if (o.tds && Math.abs(diff - o.tds) <= RECON_TOL.rupees){ matched.push({o, t, how, diff: 0}); tdsDiff.push({kind: "ours", o, t, amt: r2(diff), text: "TDS deducted by us, not shown by them"}); }
      else differs.push({o, t, how, diff, late: Math.round(late), text: Math.abs(diff) > RECON_TOL.rupees ? (late > RECON_TOL.days ? "a different amount and date" : "a different amount") : "a different date"});
      if (o.gst || t.gst){ const g = r2((t.gst || 0) - (o.gst || 0)); if (t.gst && Math.abs(g) > RECON_TOL.rupees) gstDiff.push({o, t, amt: g, text: "GST " + money(t.gst) + " in theirs, " + money(o.gst) + " in ours"}); }
    };
    // 1. by document number
    T.forEach(t => { if (!t.refs.size) return; const o = O.find(x => !used.has(x.k) && Math.sign(x.amt) === Math.sign(t.amt) && [...t.refs].some(r => x.refs.has(r))); if (o) pair(o, t, "number"); });
    // 2. by amount and date, within ±7 days and ±₹1 (the nearest date first)
    T.filter(t => !used.has(t.k)).forEach(t => {
      const c = O.filter(x => !used.has(x.k) && Math.abs(x.amt - t.amt) <= RECON_TOL.rupees && this.days(x.date, t.date) <= RECON_TOL.days).sort((a, b) => this.days(a.date, t.date) - this.days(b.date, t.date))[0];
      if (c) pair(c, t, "amount and date");
    });
    // 3. what is left: theirs only (TDS lines of theirs said apart), ours only
    const theirsOnly = [], oursOnly = O.filter(x => !used.has(x.k));
    T.filter(t => !used.has(t.k)).forEach(t => { if (/\btds\b|tax\s*deducted/i.test(t.narr + " " + t.no)) tdsDiff.push({kind: "theirs", t, amt: t.amt, text: "TDS shown by them, not in our books"}); else theirsOnly.push(t); });
    const ex = explained || {}, keyOf = (x) => (x.o ? x.o.k : "") + "|" + (x.t ? x.t.k : "") + (x.k || "");
    // the statement: closing as per our books, each difference grouped, = closing as per the party; what is left unexplained
    const sum = (l, f) => r2(l.reduce((s, x) => s + f(x), 0));
    const lines = [
      ["open", "Difference in opening balance", r2(tOpen - oOpen)],
      ["theirsOnly", "In their books, not in ours", sum(theirsOnly, x => x.amt)],
      ["oursOnly", "In our books, not in theirs", -sum(oursOnly, x => x.amt)],
      ["differs", "The same entry with a different amount", sum(differs, x => x.diff)],
      ["tds", "TDS: deducted by one side, not shown by the other", sum(tdsDiff, x => x.amt)],
      ["round", "Matched within ₹" + RECON_TOL.rupees, sum(matched, x => x.diff)],
    ].filter(l => Math.abs(l[2]) >= 0.005);
    const explainedTo = r2(oClose + lines.reduce((s, l) => s + l[2], 0));
    return {side, oOpen, tOpen, oClose, tClose, matched, differs, oursOnly, theirsOnly, tds: tdsDiff, gst: gstDiff, explainedKeys: Object.keys(ex),
      statement: {ours: oClose, lines, theirs: tClose, unexplained: r2(tClose - explainedTo)}, keyOf};
  }
};

// the party, from the lines above the statement's header (its name, GSTIN or PAN; not the client's own), matched to a
// ledger of the books: by GSTIN or PAN (sure), by a remembered answer (sure), by name (a guess to confirm)
PartyRecon.guessParty = function(grid, hi, co, side){
  const top = grid.slice(0, Math.max(hi, 1)).map(r => (r || []).map(c => String(c == null ? "" : c)).join(" ")).join("\n");
  const own = String(co && co.gstin || "").toUpperCase();
  const gstins = (top.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g) || []).filter(g => g !== own);
  const pans = (top.toUpperCase().match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || []).filter(p => !own || own.slice(2, 12) !== p);
  const list = (typeof B === "function" && B() && B().ledgers && B().ledgers.list) || (typeof VR === "object" ? VR.ledgers() : []);
  const g = gstins[0] || "", hitG = g && list.find(l => String(l.gstin || "").toUpperCase() === g);
  if (hitG) return {ledger: hitG.name, sure: true, how: "GSTIN " + g, key: g};
  const p = pans[0] || (g ? g.slice(2, 12) : ""), hitP = p && list.find(l => String(l.gstin || "").toUpperCase().slice(2, 12) === p || String(l.pan || "").toUpperCase() === p);
  if (hitP) return {ledger: hitP.name, sure: true, how: "PAN " + p, key: p};
  const lines = top.split("\n").map(l => l.replace(/gstin.*$/i, "").replace(/statement of account.*$/i, "").trim()).filter(l => l.length >= 3 && !(co && normName(l) === normName(co.name)));
  const key = g || p || normName(lines[0] || "");
  const remembered = key && typeof choiceValue === "function" ? choiceValue(co, "party:" + key) : "";
  if (remembered && exactLedger(remembered)) return {ledger: exactLedger(remembered), sure: true, how: "your answer before", key};
  let best = null;
  lines.forEach(l => list.forEach(x => { const sc = typeof nameSim === "function" ? nameSim(l, x.name) : (normName(l) === normName(x.name) ? 1 : 0); if (sc >= 0.8 && (!best || sc > best.sc)) best = {sc, name: x.name}; }));
  return best ? {ledger: best.name, sure: false, how: "name", key} : {ledger: "", sure: false, how: "", key, name: lines[0] || ""};
};
// our side: the party's ledger in FinCom's copy of the books (Tally or Zoho), for the period
PartyRecon.ours = function(side, ledger, from, to){ return this.oursFrom(LK.ledgerBooks(ledger, from, to), side); };
// a run, kept on the client (co.reconRuns, riding its sync): the party, the period, the file, the statement read, the notes;
// the result is worked out again whenever it is opened, from the books as they are then
PartyRecon.save = function(o){
  const co = CO(), run = {id: uid("rr"), side: o.side, ledger: o.ledger, from: o.from, to: o.to, file: o.fileName, fmtId: o.fmtId || "", fmtName: o.fmtName || "", how: o.how || "",
    stmt: {open: o.stmt.open, close: o.stmt.close, rows: o.stmt.rows}, notes: {}, by: whoAmI(), at: new Date().toISOString()};
  // next month starts from the last one: its notes come along (an entry explained then stays explained)
  const last = this.lastFor(o.side, o.ledger);
  if (last){ run.prev = last.id; run.notes = Object.assign({}, last.notes || {}); }
  co.reconRuns = [run].concat(co.reconRuns || []);
  if (o.file && typeof FileStore === "object") { try { FileStore.put(co.id, "recon:" + run.id, o.file); } catch (e){} }
  Store.saveCompany(co);
  return run;
};
PartyRecon.runs = function(side){ return ((CO() || {}).reconRuns || []).filter(r => !r.deleted && (!side || r.side === side)); };
PartyRecon.byId = function(id){ return ((CO() || {}).reconRuns || []).find(r => r.id === id) || null; };
// the last run of the same party: next month starts from it (its period after, its notes kept for the same entries)
PartyRecon.lastFor = function(side, ledger){ return this.runs(side).find(r => r.ledger === ledger) || null; };
PartyRecon.result = function(run){
  let ours;
  try { ours = this.ours(run.side, run.ledger, run.from, run.to); } catch (e){ return {error: "The books for " + run.ledger + " could not be read here: " + ((e && e.message) || e)}; }
  return this.run({side: run.side, ours, theirs: run.stmt, explained: run.notes});
};
// an item's key, the same whenever the run is worked out again (its document, date and amount)
PartyRecon.itemKey = function(x){ const a = x.o || x, b = x.t || null; return [a && a.date, a && (a.no || ""), a && (a.amt != null ? a.amt : ""), b && b.date, b && (b.no || ""), b && b.amt].join("|"); };
PartyRecon.explain = function(runId, key, note){ const r = this.byId(runId); if (!r) return; r.notes = Object.assign({}, r.notes); if (note) r.notes[key] = {note: String(note).slice(0, 300), by: whoAmI(), at: new Date().toISOString()}; else delete r.notes[key]; Store.saveCompany(CO()); render(); };
// a line in their books and not in ours: a suggestion, made an entry to review on Purchase or Sales (never posted by itself)
PartyRecon.createEntry = function(run, t){
  const cid = S.coId, amt = Math.abs(t.amt), no = t.no || "", date = t.date || run.to;
  if (run.side === "vendor"){
    const e = newEntry("Reconciliation with " + run.ledger);
    Object.assign(e.x, {vendorName: run.ledger, invoiceNo: no, invoiceDate: date, taxable: amt, total: amt, description: t.narr || ""});
    if (t.amt < 0) e.noteKind = "debit";
    e.partyLedger = run.ledger; e.readMode = "recon"; e.readNote = "Suggested by the reconciliation with " + run.ledger + ": in their statement, not in the books. Check it before approving.";
    finishNewEntry(e, cid, null); toast("Added to Purchase → To review: " + (no || run.ledger) + ". Nothing is posted until it is approved.");
  } else {
    if (typeof SL !== "function" || !SL() || SL().cid !== cid){ toast("Open Sales once, then use Create entry again."); return; }
    const v = newInvoice({number: no || "REC-" + date, date, customerName: run.ledger, taxable: amt, total: amt, noteKind: t.amt < 0 ? "credit" : ""}, "recon", {fileName: run.file});
    v.customerLedger = run.ledger; v.userLedger = true; SL().list.push(v); mapInvoice(v); saveSales();
    toast("Added to Sales → To review: " + (no || run.ledger) + ". Nothing is posted until it is approved.");
  }
  const r = this.byId(run.id); if (r){ r.notes = Object.assign({}, r.notes, {[this.itemKey(t)]: {note: "Entry made for review", by: whoAmI(), at: new Date().toISOString(), entry: true}}); Store.saveCompany(CO()); }
  render();
};
// the reconciliation as a workbook: the statement, then each kind of difference (Excel)
PartyRecon.xlsx = async function(run, res){
  await ensureXlsx();
  const st = res.statement, wb = XLSX.utils.book_new(), d = (x) => x ? fmtDate(x) : "";
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Reconciliation: " + run.ledger, ""], ["Period", d(run.from) + " to " + d(run.to)], [],
    ["Closing as per our books", st.ours]].concat(st.lines.map(l => [(l[2] >= 0 ? "Add: " : "Less: ") + l[1], l[2]])).concat([["Closing as per " + run.ledger, st.theirs], ["Unexplained difference", st.unexplained]])), "Statement");
  const rows = (l, f) => l.map(f);
  const add = (name, head, l) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(l)), name.slice(0, 31));
  add("Ours only", ["Date", "No.", "Particulars", "Amount", "Note"], rows(res.oursOnly, x => [d(x.date), x.no, x.narr, x.amt, ((run.notes || {})[this.itemKey(x)] || {}).note || ""]));
  add("Theirs only", ["Date", "No.", "Particulars", "Amount", "Note"], rows(res.theirsOnly, x => [d(x.date), x.no, x.narr, x.amt, ((run.notes || {})[this.itemKey(x)] || {}).note || ""]));
  add("Different amount or date", ["Our date", "Our no.", "Ours", "Their date", "Their no.", "Theirs", "Difference"], rows(res.differs, x => [d(x.o.date), x.o.no, x.o.amt, d(x.t.date), x.t.no, x.t.amt, x.diff]));
  add("TDS", ["Side", "No.", "Amount", "What"], rows(res.tds, x => [x.kind === "ours" ? "ours" : "theirs", (x.t || x.o).no, x.amt, x.text]));
  add("GST", ["No.", "Difference", "What"], rows(res.gst, x => [x.t.no, x.amt, x.text]));
  add("Matched", ["Our date", "Our no.", "Ours", "Their date", "Their no.", "Theirs", "How"], rows(res.matched, x => [d(x.o.date), x.o.no, x.o.amt, d(x.t.date), x.t.no, x.t.amt, x.how]));
  XLSX.writeFile(wb, "Reconciliation " + run.ledger.replace(/[^\w ]+/g, "") + " " + run.from + " to " + run.to + ".xlsx");
};
// a balance confirmation letter to the party, as a Word document (.doc: Word opens it as written)
PartyRecon.letterDoc = function(run, res){
  const co = CO(), bal = res.statement.ours, v = run.side !== "customer";
  const words = Math.abs(bal) < 0.005 ? "nil" : "₹" + INR.format(Math.abs(bal)) + " " + ((bal > 0) === v ? "payable by us to you" : "receivable by us from you");
  const html = '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Balance confirmation</title></head><body style="font-family:Calibri,Arial;font-size:11pt">' +
    "<p><b>" + esc(co.name) + "</b>" + (co.gstin ? "<br>GSTIN " + esc(co.gstin) : "") + "</p><p>Date: " + fmtDate(new Date().toISOString().slice(0, 10)) + "</p><p>To<br><b>" + esc(run.ledger) + "</b></p>" +
    "<p><b>Subject: Confirmation of balance as on " + fmtDate(run.to) + "</b></p><p>Dear Sir or Madam,</p>" +
    "<p>As per our books, the balance of your account as on " + fmtDate(run.to) + " is " + esc(words) + ". Please confirm it, or send us your statement of our account for the period " + fmtDate(run.from) + " to " + fmtDate(run.to) + " if it differs.</p>" +
    (res.statement.lines.length ? "<p>Your statement shows " + "₹" + INR.format(Math.abs(res.statement.theirs)) + ". The differences we found:</p><ul>" + res.statement.lines.map(l => "<li>" + esc(l[1]) + ": ₹" + INR.format(Math.abs(l[2])) + "</li>").join("") + "</ul>" : "") +
    "<p>Thank you.</p><p>For " + esc(co.name) + "<br><br><br>Authorised signatory</p>" +
    "<hr><p>We confirm the balance of ₹ ____________ " + (v ? "receivable from" : "payable to") + " " + esc(co.name) + " as on " + fmtDate(run.to) + ".</p><p>Signature and stamp: ____________________</p></body></html>";
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿", html], {type: "application/msword"}));
  a.download = "Balance confirmation " + run.ledger.replace(/[^\w ]+/g, "") + " " + run.to + ".doc"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return html;
};
// open the Reconciliations page on Vendors (or Customers), and pick a statement to read
function reconGo(side){ S.step = null; S.tab = "books"; S.booksTab = "recon"; S.reconTab = side === "customer" ? "customers" : "vendors"; render(); window.scrollTo(0, 0); }
function reconPickFile(side){
  let el = document.getElementById("reconIn");
  if (!el){ el = document.createElement("input"); el.type = "file"; el.id = "reconIn"; el.hidden = true; el.multiple = true; el.accept = ".xlsx,.xls,.csv,.pdf,.txt"; document.body.appendChild(el); }
  el.onchange = () => { const files = Array.from(el.files || []); el.value = ""; if (files.length) SheetImport.start(files, side === "customer" ? "customer" : "vendor"); };
  el.click();
}
