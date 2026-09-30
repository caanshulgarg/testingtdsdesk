/* ================================================================== */
/* Closed periods: entries dated where the books are closed, or where */
/* a GST or TDS return has been filed, are not stopped; FinCom warns   */
/* and asks before they go to Tally, and the audit trail records it.  */
/* ================================================================== */
const ClosedP = {
  cfg(co){ co = co || CO() || {}; return Object.assign({to: "", gst: true, tds: true, tdsFiled: {}}, co.closed || {}); },
  set(co, k, v){ co.closed = Object.assign(this.cfg(co), {[k]: v}); Store.saveCompany(co); },
  qKey(d){ const y = num(d.slice(0, 4)), m = num(d.slice(4, 6)), fy = m >= 4 ? y : y - 1; return fy + "-" + String(fy + 1).slice(2) + "|Q" + (Math.floor(((m + 8) % 12) / 3) + 1); },
  qLabel(k){ const [fy, q] = k.split("|"); return q + " " + fy; },
  quarters(){
    const t = Audit.today(), out = []; let fy = num(Audit.fyStart(t).slice(0, 4));
    for (let i = 0; i < 3; i++, fy--) ["Q4", "Q3", "Q2", "Q1"].forEach(q => { const k = fy + "-" + String(fy + 1).slice(2) + "|" + q, first = {Q1: fy + "0401", Q2: fy + "0701", Q3: fy + "1001", Q4: (fy + 1) + "0101"}[q]; if (first <= t) out.push(k); });
    return out;
  },
  // what a date runs into: books closed, a GST return filed for its month, a TDS return filed for its quarter (only for entries with TDS)
  why(co, b, d, hasTds){
    const c = this.cfg(co), out = [];
    if (!/^\d{8}$/.test(String(d || ""))) return out;
    if (c.to && d <= FC.d8(c.to)) out.push("the books are closed up to " + FC.when(FC.d8(c.to)));
    if (c.gst && b){
      const ym = d.slice(0, 6), seen = new Set();
      Object.entries(b.gstFiled || {}).forEach(([reg, recs]) => {
        let r = (recs || {})[ym] || {}, qe = ym;
        try { if (typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp"){ qe = GSTSet.qEnd(ym); r = (recs || {})[qe] || {}; } } catch (e){}
        const lab = FC.monthLabel(qe);
        if (r.r3b && !seen.has("3b" + qe)){ seen.add("3b" + qe); out.push("GSTR-3B for " + lab + " was filed on " + fmtDate(r.r3b)); }
        else if (r.r1 && !seen.has("1" + qe)){ seen.add("1" + qe); out.push("GSTR-1 for " + lab + " was filed on " + fmtDate(r.r1)); }
      });
      if (!seen.size) Object.values(b.filed || {}).forEach(f => { if (f && !f.notFiled && f.ym === ym && !seen.has("p" + ym)){ seen.add("p" + ym); out.push("GSTR-1 for " + FC.monthLabel(ym) + " is filed on the portal"); } });
    }
    if (c.tds && hasTds){ const k = this.qKey(d), f = (c.tdsFiled || {})[k]; if (f) out.push("the TDS return for " + this.qLabel(k) + " was filed on " + fmtDate(f) + "; a correction statement will be needed"); }
    return out;
  },
  // the same, for a screen, with the books already open
  note(d, hasTds){ const co = CO(); if (!co) return []; const b = S.books && S.books.cid === co.id ? S.books : null; return this.why(co, b, FC.d8(d), hasTds); },
  tag(d, hasTds){ const w = this.note(d, hasTds); return w.length ? ' <span class="tag warn cp-tag" title="' + esc("Closed period: " + w.join("; ")) + '">closed period</span>' : ""; },
  async booksOf(co){
    if (S.books && S.books.cid === co.id && !S.books.loading) return S.books;
    if (this._b && this._b.cid === co.id && Date.now() - this._b.at < 60000) return this._b.b;
    let b = null; try { b = await Books.load(co.id); } catch (e){}
    this._b = {cid: co.id, at: Date.now(), b};
    return b;
  },
  // before anything is posted to Tally: warn, and let the user go ahead or hold these entries back
  async gate(payload){
    const list = [].concat(payload.vouchers || []);
    if (!list.length) return [];
    const co = Object.values(S.companies || {}).find(c => c.tallyName && c.tallyName === payload.company) || CO();
    if (!co) return [];
    const b = await this.booksOf(co), hits = [];
    list.forEach(it => {
      const x = String(it.xml || ""), d = (x.match(/^\s*<VOUCHER\b[\s\S]*?<DATE>(\d{8})<\/DATE>/) || [])[1];
      if (!d) return;
      const tds = /<LEDGERNAME>[^<]*\b(TDS|TCS)\b[^<]*<\/LEDGERNAME>/i.test(x);
      const w = this.why(co, b, d, tds);
      if (w.length) hits.push({id: it.id, d, w, no: (x.match(/<VOUCHERNUMBER>([^<]*)<\/VOUCHERNUMBER>/) || [])[1] || "", type: (x.match(/VCHTYPE="([^"]*)"/) || [])[1] || ""});
    });
    if (!hits.length) return [];
    const byWhy = {};
    hits.forEach(h => h.w.forEach(w => { (byWhy[w] = byWhy[w] || []).push(h); }));
    const body = "<p>" + hits.length + " of the " + list.length + " entries are dated in a closed period:</p><ul class=\"cp-list\">" +
      Object.entries(byWhy).map(([w, hs]) => "<li><b>" + esc(w.charAt(0).toUpperCase() + w.slice(1)) + "</b>: " + hs.length + " entr" + (hs.length === 1 ? "y" : "ies") + " (" + hs.slice(0, 4).map(h => FC.when(h.d) + (h.no ? " no. " + esc(h.no) : "")).join(", ") + (hs.length > 4 ? ", …" : "") + ")</li>").join("") + "</ul>" +
      "<p>They can still be posted. If they are, the return or the closed books will not agree with Tally until it is put right, and the audit trail records that you chose to post them.</p>";
    const r = await askConfirm({title: "Post into a closed period?", body, ok: "Post them anyway", wide: true});
    if (r && r.ok){
      try { auditEvent("post_closed_period", {company: payload.company, entries: hits.length, reasons: Object.keys(byWhy).slice(0, 6)}, co.id); } catch (e){}
      return [];
    }
    return hits.map(h => ({id: h.id, message: "Not sent: dated in a closed period (" + h.w[0] + "). You chose to hold it back; post it again to send it."}));
  }

};
// Client setup, closed periods (app/src/screens/SettingsMore.jsx): the closing date, a warning on or off, a TDS return filed
function closedSet(co, k, v){
  if (k === "to"){ ClosedP.set(co, "to", v); toast(v ? "Books closed up to " + fmtDate(v) + " for " + co.name + "." : "No closing date."); }
  else if (k.indexOf("q:") === 0){ const q = k.slice(2), f = Object.assign({}, ClosedP.cfg(co).tdsFiled); if (v) f[q] = v; else delete f[q]; ClosedP.set(co, "tdsFiled", f); }
  else ClosedP.set(co, k, v);
  render();
}
