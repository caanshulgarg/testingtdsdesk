/* ================================================================== */
/* Filing a GST month: due dates, late fee, interest, rule 37, the    */
/* checks the portal runs (DRC-01B, DRC-01C), filed 3B copies, and    */
/* the set-off journal for Tally                                      */
/* ================================================================== */
// GSTF: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
// the filing card under GSTR-3B and GSTR-1A under Amendments: React (app/src/screens/gst/Filing.jsx)
// a filing date (r1, r3b) or a figure from the portal (portalFee1, portalFee3, portalInt) for the month and GSTIN
// the filed mark of a return (k: r1, r3b, iff) is ONE thing (the review of the filed marks, item 6): the date, the ARN, how
// it was filed (k + "Via": api, helper) and what was kept with it (the 3B as filed, the IFF's documents). Set together;
// taken off together, so marking it again (by hand, the GST API or the browser helper) starts afresh
const GSTMark = {
  set(ym, reg, k, on, arn, via){
    const r = GSTF.rec(ym, reg);
    r[k] = on || r[k] || GSTF.today();
    if (arn){ r[k + "Arn"] = arn; if (via) r[k + "Via"] = via; else delete r[k + "Via"]; }
    if (k === "r3b" && !r.snap && typeof GSTR === "object"){ r.snap = GSTF.snapOf(GSTR.threeB(ym, reg)); r.snapAt = new Date().toISOString(); }
    if (k === "iff"){ delete r.iffSkip; if (typeof GSTQ === "object") GSTQ.iffSnap(ym, reg); }
    GSTR._carry = null; return r;
  },
  clear(ym, reg, k){
    const r = GSTF.rec(ym, reg), was = {on: r[k] || "", arn: r[k + "Arn"] || "", via: r[k + "Via"] || ""};
    [k, k + "Arn", k + "Via"].concat(k === "r3b" ? ["snap", "snapAt"] : k === "iff" ? ["iffDocs", "iffSnapAt"] : []).forEach(f => { delete r[f]; });
    GSTR._carry = null;
    if (was.on || was.arn) try { auditEvent("gst_filed_mark_off", {reg, ym, form: k, on: was.on, arn: was.arn, via: was.via}, S.coId); } catch (e){}
    return r;
  },
  // the date box emptied: a mark with an ARN (the GST API, the browser helper), the 3B kept as filed or the IFF's documents is asked about first,
  // saying what goes with it; a date alone goes at once. go(): after it is taken off
  ask(ym, reg, k, go){
    const r = GSTF.peek(ym, reg), arn = r[k + "Arn"], kept = k === "r3b" && r.snap, docs = k === "iff" && r.iffDocs && Object.keys(r.iffDocs).length;
    if (!arn && !kept && !docs){ this.clear(ym, reg, k); return go(); }
    const how = r[k + "Via"] === "api" ? " (filed through the GST API)" : r[k + "Via"] === "helper" ? " (read from the portal by the browser helper)" : "";
    const what = [arn ? "its ARN " + arn + how : "", kept ? "the 3B kept as filed (the next month’s carried credit and GSTR-9 then use the books as they are now)" : "", docs ? "the documents recorded as in the IFF" : ""].filter(Boolean);
    askConfirm({title: "Take off the filed mark?", ok: "Take it off", danger: true,
      body: esc(({r3b: "GSTR-3B", r1: "GSTR-1", iff: "IFF"})[k] + " for " + GSTR.label(ym) + " goes back to not filed. With the date go " + what.join(" and ") + ". The return on the portal is not touched.")})
      .then(a => { if (a && a.ok){ this.clear(ym, reg, k); go(); } else render(); });
  }
};
function gstfSet(k, v){
  const ym = S.gstYm || "", reg = S.gstReg || "", r = GSTF.rec(ym, reg);
  if ((k === "r1" || k === "r3b") && v === "") return GSTMark.ask(ym, reg, k, () => { saveBooks(); render(); });
  if (k === "r1" || k === "r3b") r[k] = v;
  if (k === "portalFee1" || k === "portalFee3" || k === "portalInt"){ if (v === "") delete r[k]; else r[k] = num(v); }
  GSTR._carry = null; saveBooks(); render();
}
// after filing: keep the 3B as filed (or remove the kept copy), and the set-off journal for Tally
function gstfSnap(){ const ym = S.gstYm || "", r = GSTF.rec(ym, S.gstReg || ""); r.snap = GSTF.snapOf(GSTR.threeB(ym, S.gstReg || "")); r.snapAt = new Date().toISOString(); if (!r.r3b) r.r3b = GSTF.today(); GSTR._carry = null; saveBooks(); render(); toast("3B for " + GSTR.label(ym) + " kept as filed."); }
// the kept copy removed (to keep it again from the books as they are now): the month stays filed, its date as it is. One
// filed with an ARN keeps its copy (take the date off to take the whole mark off)
// The next month's 3B carries its credit from this copy: with that one filed, asked first, and the audit trail records it
function gstfUnsnap(){
  const ym = S.gstYm || "", reg = S.gstReg || "", r = GSTF.rec(ym, reg);
  if (r.r3bArn){ toast("GSTR-3B for " + GSTR.label(ym) + " was filed with ARN " + r.r3bArn + ": its kept copy stays."); return; }
  const go = () => { delete r.snap; delete r.snapAt; GSTR._carry = null; saveBooks(); render(); };
  const nx = GSTR.nextYm(ym), w = typeof GSTLock === "object" ? GSTLock.why(reg, [nx]) : "";
  if (!w) return go();
  askConfirm({title: "Remove the kept copy?", ok: "Remove it", danger: true,
    body: esc(w) + " Its credit carried forward came from this kept copy of " + esc(GSTR.label(ym)) + "; without it the carry is worked out from the books as they are now."})
    .then(a => { if (!a || !a.ok) return; try { auditEvent("gst_kept_copy_removed", {reg, ym, nextFiled: nx}, S.coId); } catch (e){} go(); });
}
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
