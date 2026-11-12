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
      if (!seen.size) Object.values(b.filed || {}).forEach(f => { if (f && f.source === "portal" && !f.notFiled && f.ym === ym && !seen.has("p" + ym)){ seen.add("p" + ym); out.push("GSTR-1 for " + FC.monthLabel(ym) + " is filed on the portal"); } });
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
// A GST month filed (the review of the filed marks, item 7): the ONE check every change to a month's GST figures asks
// (ITC decisions, 2B pairs, B2C summary marks, places of supply, a 2B brought in again). "Filed" is what GSTAmend counts
// (its proof and the copies that stand as filed: GSTAmend.nextOpen, check, can1a) and, for 3B, the marks: the date typed,
// the ARN (GST API or the browser helper), the 3B kept as filed, the portal's PDF in Returns filed (sorted, not one still to
// sort), the portal's return status list (b.portalFiled) and a 3B brought back from the portal (b.filed3b). A downloaded or
// API-saved GSTR-1 copy alone is not a filing. A QRMP month's returns are the quarter's.
// filed(reg, ym, form "r3b" | "r1") -> {filed, form, per, on, arn, how: api | helper | pdf | date | kept | portal} or null
const GSTLock = {
  H: ["igst", "cgst", "sgst", "cess"],
  per(reg, ym){ try { if (typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp") return GSTSet.qEnd(ym); } catch (e){} return ym; },
  filed(reg, ym, form){
    form = form || "r3b";
    const b = S.books;
    if (!reg || !b || !/^\d{6}$/.test(String(ym || ""))) return null;
    const pf = (k, per) => (b.portalFiled || {})[reg + "|" + k + "|" + per] || null;
    const one = (per, k) => {
      const r = GSTF.peek(per, reg), v = typeof GSTV === "object" ? GSTV.copies(reg, k, per)[0] : null, p = pf(k, per);
      const g = k === "r3b" ? ((GSTR.gstins(b) || []).find(z => z.slice(0, 2) === reg) || "") : "", f3 = g ? (b.filed3b || {})[g + "|" + per] : null;
      const arn = r[k + "Arn"] || (v && v.arn) || (p && p.arn) || "";
      const on = r[k] || (v && v.arnDate) || (p && p.dof) || (k === "r3b" && r.snap ? String(r.snapAt || "").slice(0, 10) : "") || (f3 ? String(f3.fetchedAt || "").slice(0, 10) : "");
      if (!on && !arn) return null;
      return {filed: true, form: k, per, on, arn, how: r[k + "Via"] === "api" ? "api" : r[k + "Arn"] ? "helper" : v ? "pdf" : p ? "portal" : r[k] ? "date" : r.snap ? "kept" : "portal"};
    };
    const per = this.per(reg, ym);
    if (form === "r3b") return one(per, "r3b");
    const x = (per !== ym && one(ym, "iff")) || one(per, "r1");
    if (x) return x;
    // GSTAmend's own notion (its proof, and a copy that stands as filed: brought in from the portal, or downloaded and marked)
    const m = [ym, per].find(z => (typeof GSTAmend === "object") && (GSTAmend.proof(z, reg) || GSTAmend.filed(reg).some(f => f.ym === z && !f.notFiled)));
    return m ? {filed: true, form: "r1", per: m, on: "", arn: "", how: "portal"} : null;
  },
  words(x){
    return ({r3b: "GSTR-3B", r1: "GSTR-1", iff: "IFF"})[x.form] + " for " + GSTR.label(x.per) + " is filed" + (x.arn ? " (ARN " + x.arn + ")" : x.on ? " (on " + fmtDate(x.on) + ")" : "") +
      (x.how === "pdf" ? ", as the portal's PDF in Returns filed says (if that PDF is the wrong one, remove it or sort it again there)" : "") + ". " +
      (x.form === "r3b" ? "Changes to a filed 3B are made as an adjustment in the current month (ITC adjustments)." : "Changes go into the next return as an amendment.");
  },
  // the first filed return among these months, in words ("" when every one is open)
  why(reg, months, forms){
    for (const m of new Set((months || []).filter(Boolean))) for (const f of forms || ["r3b"]){ const x = this.filed(reg, m, f); if (x) return this.words(x); }
    return "";
  },
  // refused: the words shown, true; open: false
  refuse(reg, months, forms){ const w = this.why(reg, months, forms); if (w) toast(w); return !!w; },
  // a change FinCom allows on a filed month when a person says so (B2C summary marks, places of supply: the filed GSTR-1
  // stays as it is and the change goes as an amendment; a 2B brought in again): asked, with a reason, and the audit trail
  // records it. w: the words (else worked out from the months). true: go on
  async ask(reg, months, forms, what, w){
    w = w || this.why(reg, months, forms);
    if (!w) return true;
    const ans = await askConfirm({title: "Change a filed month?", ok: "Change anyway",
      body: esc(w) + " The filed return is not changed." + '<label class="f" style="margin-top:12px"><span>Why (kept in the audit trail)</span><input type="text" id="cbxWhy" autocomplete="off" aria-label="Why"></label>',
      read: () => ((document.getElementById("cbxWhy") || {}).value || "").trim(), validate: (d) => d ? "" : "Say why: it is kept in the audit trail."});
    if (!ans || !ans.ok) return false;
    try { auditEvent("gst_filed_changed", {reg, months: Array.from(new Set((months || []).filter(Boolean))).slice(0, 12), what: what || "", why: w, reason: ans.data || ""}, S.coId); } catch (e){}
    return true;
  },
  // go() now when every month is open (no wait: the change is made in this call), else once asked as above
  gate(reg, months, forms, what, go, w){ if (!(w = w || this.why(reg, months, forms))) return go(); this.ask(reg, months, forms, what, w).then(y => { if (y) go(); }); },
  // the months of these entries of the books (place of supply, B2C summary marks)
  months(ids){ const s = new Set(ids || []); return ((S.books || {}).vouchers || []).filter(v => s.has(v.id)).map(v => String(v.date).slice(0, 6)); },
  // any GSTR-3B of the registration filed (a quick look, before anything is worked out)
  any(reg){
    const b = S.books || {};
    if (Object.values((b.gstFiled || {})[reg || ""] || {}).some(r => r && (r.r3b || r.r3bArn || r.snap))) return true;
    if (Object.keys(b.portalFiled || {}).some(k => k.indexOf(reg + "|r3b|") === 0) || Object.keys(b.filed3b || {}).some(k => k.slice(0, 2) === reg)) return true;
    return typeof GSTV === "object" && GSTV.list().some(x => !x.sort && x.reg === reg && x.form === "r3b");
  },
  // the credit every ITC line gives each month (4(A)(5) and 4(B)(1), app/src/lib/itcFinal.js)
  // (only for the months fm says are filed, when given: the rest cannot refuse anything)
  credits(reg, fm){
    const F = typeof ITCF === "object" ? ITCF : null, by = {};
    if (!F) return by;
    F.rows(reg).forEach(r => {
      if (r.fixed) return;
      const ms = new Set([r.e.C, r.bm, r.tm].concat(Object.keys(r.booksBy || {}), Object.keys(r.blkBy || {})).filter(m => m && (!fm || fm(m))));
      ms.forEach(m => { const a = F.effect(r, r.e, m), c = F.revEffect(r, r.e, m), o = by[m] = by[m] || {}; this.H.forEach(h => { o[h] = r2((o[h] || 0) + num(a[h])); o["r" + h] = r2((o["r" + h] || 0) + num(c[h])); }); });
    });
    return by;
  },
  // a change to the 2B reconciliation (change(st): applied to GST2B.state()): the words when it would move the credit of a
  // month whose 3B is filed (every line compared: a re-match that runs on to other bills is caught), else "". Worked out,
  // not guessed: a bill of a filed month whose credit was taken there, linked now to an open month's 2B, moves nothing filed.
  // Nothing filed for the registration: "" at once. Allowed and keep (the default): the change stays applied, with the
  // matching worked out for it (the caller's own same change then costs nothing); refused, or keep false: put back as it
  // was, with the matching of before
  pair(reg, keys, ids, change, keep){
    if (typeof ITCF !== "object" || typeof GST2B !== "object" || !S.books || !this.any(reg)) return "";
    const st = GST2B.state(), saved = JSON.stringify({confirm: st.confirm, link: st.link, opt: st.opt});
    const fc = new Map(), fm = m => { if (!fc.has(m)) fc.set(m, !!this.filed(reg, m)); return fc.get(m); };
    const was = this.credits(reg, fm), m0 = GST2B._memo, i0 = ITCF._memo ? ITCF._memo() : null;
    let w = "", done = false;
    try {
      if (change) change(st);
      const now = this.credits(reg, fm);
      const ms = Array.from(new Set(Object.keys(was).concat(Object.keys(now)))).sort().filter(m => this.H.some(h => Math.abs(((was[m] || {})[h] || 0) - ((now[m] || {})[h] || 0)) >= 0.005 || Math.abs(((was[m] || {})["r" + h] || 0) - ((now[m] || {})["r" + h] || 0)) >= 0.005));
      w = this.why(reg, ms); done = !w && keep !== false;
    } finally {
      if (!done){ const o = JSON.parse(saved); st.confirm = o.confirm; st.link = o.link; if (o.opt === undefined) delete st.opt; else st.opt = o.opt; GST2B._memo = m0; if (ITCF._memo) ITCF._memo(i0); }
    }
    return w;
  },
  // a change to the books' settings that moves credit between months or between the rows of table 4 (the ledger's ISD
  // switch on next-gst-isd-2b, or anything like it): t4 is the 4(A)/4(B) rows of every filed 3B month of a registration as
  // the books work them out now; guardBooks(what, apply, undo, go) applies the change, compares, undoes it (apply and undo
  // must move b.mapV or whatever the 3B's caches are keyed on), then go() at once when no filed month moves, else asked
  // with a reason (the words say a filed 3B is adjusted in the current month). For entries Tally types (not a click):
  // t4 before the books are put in, t4Moved after, and the words shown as a warning
  t4(reg){
    const out = {};
    (GSTR.months() || []).forEach(m => { if (!this.filed(reg, m)) return; GSTR._carry = null; const t = GSTR.threeBm(m, reg) || {};
      out[m] = JSON.stringify(["impGoods", "impServ", "rcmIn", "isd", "other", "rev1", "rev2"].map(k => this.H.map(h => r2(num((t[k] || {})[h]))))); });
    return out;
  },
  t4Moved(reg, was, now){ return this.why(reg, Object.keys(was).filter(m => was[m] !== now[m])); },
  guardBooks(what, apply, undo, go){
    const regs = (GSTR.gstins(S.books) || []).map(g => g.slice(0, 2)).filter(r => this.any(r));
    if (!regs.length) return go();
    const was = regs.map(r => this.t4(r)); let w = "", reg = regs[0];
    try { apply(); regs.forEach((r, i) => { const x = this.t4Moved(r, was[i], this.t4(r)); if (x && !w){ w = x; reg = r; } }); }
    finally { undo(); GSTR._carry = null; }
    if (!w) return go();
    this.ask(reg, [], ["r3b"], what, w).then(y => { if (y) go(); else render(); });
  },
  // a 2B brought in (again) for a month whose 3B is filed: the words, else "" (it would match that month's bills again)
  twoB(gstin, ym){ return gstin && ym ? this.why(String(gstin).slice(0, 2), [ym]) : ""; }
};
if (typeof globalThis === "object") globalThis.GSTLock = GSTLock;
// Client setup, closed periods (app/src/screens/SettingsMore.jsx): the closing date, a warning on or off, a TDS return filed
function closedSet(co, k, v){
  if (k === "to"){ ClosedP.set(co, "to", v); toast(v ? "Books closed up to " + fmtDate(v) + " for " + co.name + "." : "No closing date."); }
  else if (k.indexOf("q:") === 0){ const q = k.slice(2), f = Object.assign({}, ClosedP.cfg(co).tdsFiled); if (v) f[q] = v; else delete f[q]; ClosedP.set(co, "tdsFiled", f); }
  else ClosedP.set(co, k, v);
  render();
}
