/* ================================================================== */
/* Returns filed: the portal's own PDFs of every GST return, kept per */
/* client, GSTIN and period, with a checklist of what should be there */
/* ================================================================== */
// The record (form, period, ARN, date, file name, where the file is) is kept with the books; the PDF itself is kept in this
// browser's file store and sent to the firm's cloud documents, so it opens from any computer.
// GSTV's part the GSTR-3B engine runs is in server/_shared/gst3b.js (shared with the gst-run function); the rest is put on it here
// next-room-2: taking in a PDF (detect, figures, addRecord), filing, removing and the zip, which only Returns filed and
// Filed vs books call, are in src/js/38-gst-returns-filed-page.js, put on this same GSTV by those screens' files.
Object.assign(GSTV, {
  FORMS: {
    r1:     {l: "GSTR-1",  order: 1},
    iff:    {l: "IFF",     order: 2},
    r1a:    {l: "GSTR-1A", order: 3},
    r3b:    {l: "GSTR-3B", order: 4},
    pmt06:  {l: "PMT-06 challan", order: 5},
    cmp08:  {l: "CMP-08",  order: 6},
    gstr4:  {l: "GSTR-4",  order: 7, annual: true},
    gstr9:  {l: "GSTR-9",  order: 8, annual: true},
    gstr9c: {l: "GSTR-9C", order: 9, annual: true}
  },
  label(form){ return (this.FORMS[form] || {}).l || form || "?"; },
  isAnnual(form){ return !!(this.FORMS[form] || {}).annual; },
  // the period's name: a month, a QRMP quarter (by its last month), or a financial year
  perLabel(form, per, reg){
    if (!per) return "?";
    if (this.isAnnual(form) || /^\d{4}-\d{2}$/.test(per)) return per;
    const q = typeof GSTSet === "object" && reg && GSTSet.typeOf(per, reg) !== "monthly" && GSTSet.isQEnd(per) && (form === "r1" || form === "r3b" || form === "cmp08" || form === "r1a");
    return q ? GSTSet.qLabel(per) : GSTR.label(per);
  },
  // ---- what should be on file for a GSTIN in a financial year, by its filing type ----
  expected(fy, reg){
    const y = +fy.slice(0, 4), rows = [], types = new Set();
    for (let m = 4; m <= 15; m++){
      const ym = (m <= 12 ? y : y + 1) + String(m <= 12 ? m : m - 12).padStart(2, "0"), t = GSTSet.typeOf(ym, reg); types.add(t);
      if (t === "monthly"){ rows.push({form: "r1", per: ym, due: GSTF.due(ym, "r1", reg)}); rows.push({form: "r3b", per: ym, due: GSTF.due(ym, "r3b", reg)}); }
      else if (t === "qrmp"){
        if (GSTSet.isQEnd(ym)){ rows.push({form: "r1", per: ym, due: GSTF.due(ym, "r1", reg)}); rows.push({form: "r3b", per: ym, due: GSTF.due(ym, "r3b", reg)}); }
        else { rows.push({form: "iff", per: ym, due: GSTF.due(ym, "iff", reg), optional: true}); rows.push({form: "pmt06", per: ym, due: GSTF.due(ym, "pmt06", reg), optional: true}); }
      } else if (t === "comp" && GSTSet.isQEnd(ym)) rows.push({form: "cmp08", per: ym, due: GSTF.due(ym, "cmp08", reg)});
    }
    const nfy = (y + 1) + "-" + String(y + 2).slice(2), big = GSTF.aato(nfy).v > 50000000;
    if (types.has("comp")) rows.push({form: "gstr4", per: fy, due: (y + 1) + "-06-30"});
    if (types.has("monthly") || types.has("qrmp")){ rows.push({form: "gstr9", per: fy, due: (y + 1) + "-12-31"}); rows.push({form: "gstr9c", per: fy, due: (y + 1) + "-12-31", optional: !big, note: big ? "" : "if turnover is above ₹5 crore"}); }
    return rows;
  },
  // the filing date typed on the GST screens, for the returns that have one
  filedKey(form){ return ({r1: "r1", r3b: "r3b", iff: "iff", cmp08: "cmp08"})[form] || ""; },
  filedOn(reg, form, per){ const k = this.filedKey(form); return k && /^\d{6}$/.test(per) ? (GSTF.peek(per, reg)[k] || "") : ""; },
});
