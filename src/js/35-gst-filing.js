/* ================================================================== */
/* Filing a GST month: due dates, late fee, interest, rule 37, the    */
/* checks the portal runs (DRC-01B, DRC-01C), filed 3B copies, and    */
/* the set-off journal for Tally                                      */
/* ================================================================== */
// GSTF: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
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
