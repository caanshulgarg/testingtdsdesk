/* ================================================================== */
/* GST against the filed returns (request of 02-Oct-2026): the books  */
/* invoice by invoice against the filed GSTR-1 / IFF and 2B, the tax  */
/* type against the customer's state, GSTR-1 + IFF against 3B, days   */
/* late, credit in 2B not claimed, Optional entries, entries deleted  */
/* in Tally, and the corrections to make when the returns are final   */
/* ================================================================== */
// The screen is app/src/screens/gst/Recon.jsx ("Filed vs books"); the 3B page and Returns filed show parts of it.
// next-room-2: only what the rest of the program calls is here (fig, portal, takePortal); the working the GST screens alone
// call is in src/js/56-gst-recon-filed.js, put on this same GSTX by those screens' files (in the one-file site, right below).
const GSTX = {
  H: ["igst", "cgst", "sgst", "cess"],
  // ---------- filed figures: from the PDFs of the returns filed, or typed ----------
  fig(reg, form, per){
    const typed = (GSTF.peek(per, reg).fig || {})[form];
    if (typed) return Object.assign({source: "typed"}, typed);
    const rec = GSTV.copies(reg, form, per).find(x => x.fig);
    return rec ? Object.assign({source: "pdf", rec: rec.id}, rec.fig) : null;
  },
  // ---------- 13. marked filed from the portal (ARN and date) ----------
  portal(reg, form, per){ return ((S.books || {}).portalFiled || {})[reg + "|" + form + "|" + per] || null; },
  // the portal's return status list (GSTN RETTRACK through gst-taxpro): each filed return marked, with its ARN and date
  takePortal(reg, list){
    const b = S.books; b.portalFiled = b.portalFiled || {}; let n = 0;
    (list || []).forEach(x => {
      const st = String(x.status || "").toLowerCase(); if (!/filed/.test(st) || /not\s*filed/.test(st)) return;
      const per = /^\d{6}$/.test(String(x.ret_prd || "")) ? x.ret_prd.slice(2, 6) + x.ret_prd.slice(0, 2) : ""; if (!per) return;
      const t = String(x.rtntype || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      let form = t === "GSTR3B" ? "r3b" : t === "GSTR1" ? "r1" : t === "IFF" ? "iff" : t === "CMP08" ? "cmp08" : t === "GSTR1A" ? "r1a" : t === "GSTR9" ? "gstr9" : "";
      if (!form) return;
      form = GSTV.formFor(form, per, reg);
      const m = String(x.dof || "").match(/^(\d{2})-(\d{2})-(\d{4})$/), dof = m ? m[3] + "-" + m[2] + "-" + m[1] : String(x.dof || "");
      const k = reg + "|" + form + "|" + per, had = b.portalFiled[k];
      if (!had || had.arn !== x.arn || had.dof !== dof) n++;
      b.portalFiled[k] = {arn: x.arn || "", dof, mof: x.mof || "", at: new Date().toISOString()};
      const fk = GSTV.filedKey(form); if (fk && dof) GSTF.rec(per, reg)[fk] = dof;
    });
    return n;
  },
};
