/* ================================================================== */
/* Returns for GSTINs that are not monthly filers                     */
/*  QRMP: IFF (months 1-2, optional), PMT-06 (months 1-2), GSTR-1 and */
/*        GSTR-3B for the quarter                                     */
/*  Composition: CMP-08 each quarter, GSTR-4 for the year             */
/* ================================================================== */
// GSTQ: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
// the QRMP, CMP-08 and GSTR-4 pages: React (app/src/screens/gst/Periodic.jsx)
// a date or choice kept for a month (or quarter end) and GSTIN: IFF filed on, PMT-06 method, CMP-08 filed on
function gqSetField(k, v, ym){ const r = GSTF.rec(ym || S.gstYm || "", S.gstReg || ""); if (v === "") delete r[k]; else r[k] = v; GSTR._carry = null; saveBooks(); render(); }
// PMT-06 paid, head by head
function gqSetPaid(k, v){ const r = GSTF.rec(S.gstYm || "", S.gstReg || ""); r.pmt06 = Object.assign({}, r.pmt06, {[k]: v === "" ? 0 : num(v)}); GSTR._carry = null; saveBooks(); render(); }
// the IFF file for the month; a copy is kept so the quarter's GSTR-1 leaves these invoices out once filed
function gqIffJson(){
  const ym = S.gstYm || "", reg = S.gstReg || "";
  if (typeof ledgersReady === "function" && !ledgersReady("gst")) return;
  const f = GSTQ.iff(ym, reg); GSTF.rec(ym, reg).iffKeys = f.keys;
  try { GSTAmend.keep(JSON.parse(JSON.stringify(f.json)), "downloaded", {iff: true}); } catch (e2){}
  saveBooks(); saveFile("IFF_" + f.json.gstin + "_" + f.json.fp + ".json", new Blob([JSON.stringify(f.json)], {type: "application/json"}));
}

// IFF: filed (a date or ARN: its documents are recorded then), or not filed on purpose (they go in the quarter's GSTR-1)
// (the date taken off takes the whole mark off: its ARN and the documents recorded, GSTMark in src/js/35)
function gqIffFiled(ym, k, v){ const reg = S.gstReg || "", r = GSTF.rec(ym, reg); if (v === "" && k === "iff") GSTMark.clear(ym, reg, "iff"); else if (v === "") delete r[k]; else { r[k] = v; delete r.iffSkip; GSTQ.iffSnap(ym, reg); } GSTR._carry = null; saveBooks(); render(); }
function gqIffSkip(ym, on){ const r = GSTF.rec(ym, S.gstReg || ""); if (on){ r.iffSkip = new Date().toISOString(); delete r.iff; delete r.iffArn; delete r.iffDocs; } else delete r.iffSkip; GSTR._carry = null; saveBooks(); render(); }
function gqQuarterType(type){ GSTQ.setQuarterType(S.gstYm || "", S.gstReg || "", type); saveBooks(); render(); }
