/* ================================================================== */
/* TDS and GST ledgers, confirmed on the TDS and GST pages (the       */
/* owner's request of 14-Oct-2026): "When we click confirm ledger, if */
/* we want to unconfirm that, we can do that. Ledgers from Tally      */
/* should appear while confirming, a default guess from AI reading    */
/* every ledger should be there. Earlier TDS and GST ledger           */
/* confirmation in TDS and GST pages was good UI; we should do that   */
/* from there only, so remove that from Settings."                    */
/* ================================================================== */
// The screen is app/src/screens/books/TaxLedgers.jsx: a "Ledgers" view of the TDS page (S.tdsView "ledgers") and a
// "Ledgers" section of the GST page (S.gstView "ledgers"), as the Tally ledgers tab sat beside TDS and GST before the
// Arc / ui-tidy rework. The old places lead here: Books › Tally ledgers (…/books/ledgers, …/from-tally/ledgers,
// booksTabGo("ledgers"), lmViewGo) opens the TDS page's Ledgers with every kind shown (TaxLed.go("all")); Client setup
// keeps one line pointing here, in place of its GST / TDS / reverse charge ledger boxes.
//
// One row a ledger of the client's Tally: the ledger master's (b.map, what the returns read), the ledger check's (src/js/57),
// and every ledger of FinCom's cloud copy (tally_ledgers, with its group, opening and Tally's nature of payment) that is
// a TDS or GST ledger by Tally's tax type, nature of payment or name. Each row has ONE answer and where it came from:
//   "confirmed"  a person confirmed it (who and when);
//   "rule"       FinCom's rules (Tally's master, the day book, the name; the ledger master's own guess): what the figures use
//                today, unconfirmed, flagged in To fix as before;
//   "ai"         FinCom's rules could not tell, and AI read the ledger's name, group and a few entries (fincom-assistant,
//                action "ledger_guess", server/assistant/ledgers.ts): shown as "AI guess" with its reason, counted in
//                nothing until a person confirms it;
//   "none"       neither could tell: a person chooses (Change).
// Confirm (a row, or "Confirm all shown") keeps the row's answer as confirmed; Unconfirm puts a confirmed ledger back to
// "to confirm" with its last answer (so no figure moves), with who and when kept on the ledger (m.unok, m.hist). A return
// already marked filed is never changed by it: the row says the filed return used the earlier choice.
//
// The ledgers FinCom posts to (were Client setup's boxes): the TDS ledger of each payment type ("tds:<id>"), the input
// CGST / SGST / IGST ("gst:cgst", …; src/js/60's choices, confirmed or guessed) and the reverse charge ledgers, each
// chosen from the client's Tally ledgers with a search ("TDS payable 194C").
const TaxLed = {
  ext: {},            // cid -> {book, at, by: {lower name -> {open, nature, dtype}}, busy, err}
  ai: {asked: {}, busy: {}, err: {}, last: {}},
  // ---------- what a ledger is for ----------
  kindOfWhat(w){ return !w || w === "none" ? "" : LedMaster.isTds(w) ? "tds" : LedMaster.isGst(w) ? "gst" : ""; },
  kindOfName(n, t){
    const tt = String((t && t.taxType) || "").toUpperCase();
    if (tt === "TDS" || tt === "TCS" || (t && t.nature)) return "tds";
    if (tt === "GST") return "gst";
    if (/\bTDS\b|\bTCS\b|\b19[2-9]\s*-?\s*[A-Z]{0,2}\b|\b206\s*C/i.test(n)) return "tds";
    if (/\bGST\b|\b(C|S|I|UT)\s*\.?\s*GST\b|\bCESS\b|\bRCM\b|REVERSE\s*CHARGE|\bITC\b/i.test(n)) return "gst";
    return "";
  },
  // ---------- the client's Tally ledgers (FinCom's cloud copy, the bridge's list, the masters file) ----------
  // {name -> {name, group, chain, open, taxType, nature, dutyHead, dtype}}
  tally(b){
    const cid = b.cid, out = {}, info = b.ledInfo || {}, ex = (this.ext[cid] || {}).by || {};
    const add = (n, x) => { if (!n) return; const o = out[n] = out[n] || {name: n, group: "", chain: [], open: null, taxType: "", nature: "", dutyHead: "", dtype: ""};
      ["group", "taxType", "dutyHead"].forEach(k => { if (!o[k] && x[k]) o[k] = x[k]; }); if (!o.nature && (x.tdsNature || x.nature)) o.nature = x.tdsNature || x.nature;
      if ((!o.chain || !o.chain.length) && Array.isArray(x.chain)) o.chain = x.chain.slice(); };
    (typeof Ledgers === "object" ? Ledgers.list(cid) : []).forEach(l => l && add(l.name, l));
    Object.entries(info).forEach(([n, i]) => add(n, i || {}));
    Object.values(out).forEach(o => { const e = ex[o.name.toLowerCase()]; if (e){ if (e.open != null) o.open = e.open; if (!o.nature && e.nature) o.nature = e.nature; if (e.dtype) o.dtype = e.dtype; }
      if (!o.group) o.group = (b.under || {})[o.name] || ""; if (!o.chain.length && o.group) o.chain = LedCheck.chain(b, o.name).length ? LedCheck.chain(b, o.name) : [o.group]; });
    return out;
  },
  // a Tally ledger that is about TDS or GST by what Tally says of it, or by its name
  taxLikeTally(t){ return !!(t && (/^(GST|TDS|TCS)$/i.test(t.taxType || "") || t.nature || LedMaster.taxLike(t.name, null, t))); },

  // ---------- the rows ----------
  says(a){ return a && a.what ? LedPage.says(a) : "Not known yet"; },
  // one ledger: its answer, where it came from, and what the page shows of it
  row(b, n, tl){
    const m = (b.map || {})[n] || null, it = ((b.ledCheck || {}).items || {})[n] || null, ai = it && it.ai && it.ai.what ? it.ai : null, t = (tl || this.tally(b))[n] || {};
    const s = LedPage.checkOf(b, n) || (!m && t.name ? this.ruleOfTally(b, t) : null);
    let ans = null, src = "none", why = "";
    if (m && m.ok){ ans = LedPage.ans(m); src = "confirmed"; why = m.why || ""; }
    else if (m && m.what){ ans = LedPage.ans(m); src = "rule"; why = m.why || ""; }
    else if (s && s.what){ ans = {what: s.what, side: s.side || "", tax: s.tax || "", rate: s.rate, section: s.section || ""}; src = "rule"; why = (s.ev || []).map(e => LedCheck.SRC[e.src] + ": " + e.say).join("; "); }
    else if (ai){ ans = {what: ai.what, side: ai.side || "", tax: ai.tax || "", rate: ai.rate, section: ai.section || ""}; src = "ai"; why = ai.reason || ""; }
    const kind = this.kindOfWhat(ans && ans.what) || this.kindOfName(n, t) || (ai ? this.kindOfWhat(ai.what) : "");
    const sec = ans && LedMaster.isTds(ans.what) ? ans.section || "" : "";
    return {n, m, it, ok: !!(m && m.ok), src, ans, says: this.says(ans), why, ai, aiSays: ai ? this.says(ai) : "", kind,
      group: t.group || (it && it.group) || (b.under || {})[n] || "", open: t.open == null ? null : t.open, tally: !!(t && t.name), inBooks: !!m,
      nature: kind === "tds" ? (t.nature || LedPage.nature(b, n, sec)) : "", dtype: t.dtype || "",
      itc: ans && LedMaster.isGst(ans.what) ? this.itc(ans) : "", used: m ? (m.n || 0) : 0, ex: LedPage.example(b, n),
      unok: m && !m.ok && m.unok ? m.unok : null, okBy: m && m.ok ? m.okBy || "" : "", okAt: m && m.ok ? m.okAt || "" : ""};
  },
  // the rules' answer for a ledger of Tally's list that no entry uses and the masters file did not bring (the check only
  // reads the books' ledgers): LedCheck.suggest on what Tally's list says of it (group, tax type, nature of payment, name);
  // kept for the list's version. Nothing is written: it counts in nothing until a person confirms it
  ruleOfTally(b, t){
    const k = t.name + "|" + t.group + "|" + t.taxType + "|" + t.nature, c = this._rt = this._rt && this._rt.b === b ? this._rt : {b, by: {}};
    if (k in c.by) return c.by[k];
    let s = null;
    try { const bb = Object.create(b); bb.ledInfo = Object.assign({}, b.ledInfo, {[t.name]: {group: t.group, taxType: t.taxType, tdsNature: t.nature, dutyHead: t.dutyHead}});
      s = LedCheck.suggest(bb, t.name, null, typeof LedMaster.tplFor === "function" ? LedMaster.tplFor(b, t.name) : null); } catch (e){ s = null; }
    return c.by[k] = s && s.what && s.conf !== "low" ? s : null;
  },
  itc(a){ return a.what === "ineligible" ? "ITC not to be taken" : a.what === "gst_common" ? "common credit (rule 42)" : /^gst_(setoff|interest|control)$/.test(a.what) ? "" : a.side === "input" ? "ITC eligible" : ""; },
  // every row: the ledger master's tax ledgers, the check's, Tally's tax ledgers, and those AI was asked about; "unclear":
  // the check's candidates (every ledger under Duties & Taxes, …) that neither the rules nor the master can tell
  all(b){
    const c = LedPage.ensure(b), tl = this.tally(b), map = b.map || {}, info = b.ledInfo || {}, main = new Set(), unclear = new Set();
    LedPage.main(b).forEach(r => main.add(r.n));
    Object.values(tl).forEach(t => { const m = map[t.name]; if (m && (m.ok || m.what === "none" || m.what === "bank" || m.what === "roundoff")) return; if (!m && this.taxLikeTally(t)) main.add(t.name); });
    (c.names || []).forEach(n => { const m = map[n];
      if (main.has(n) || (m && m.ok) || (m && m.byHand && m.what) || (m && /^(bank|roundoff)$/.test(m.what || "")) || LedPage.checkOf(b, n)) return;
      unclear.add(n); });
    const rows = Array.from(main).sort((x, y) => x.localeCompare(y)).map(n => this.row(b, n, tl));
    const more = Array.from(unclear).sort((x, y) => x.localeCompare(y)).map(n => Object.assign(this.row(b, n, tl), {unclear: true})).filter(r => r.src !== "confirmed");
    return {rows, more, tally: tl, info};
  },
  // the rows for one page: TDS, GST, or all; a ledger no one can place yet is shown on both pages
  forKind(b, kind){
    const a = this.all(b), pick = r => kind === "all" || r.kind === kind || !r.kind;
    return {rows: a.rows.filter(pick), more: a.more.filter(pick), tally: a.tally};
  },
  // ---------- confirm, unconfirm ----------
  who(){ return typeof whoAmI === "function" ? whoAmI() : "this computer"; },
  write(m, a){
    LedMaster.applyWhat(m, a.what || "none");
    if (LedMaster.isGst(a.what)){ m.tax = a.tax || m.tax; m.side = a.side || m.side; if (a.rate != null && a.rate !== "") m.gstRate = num(a.rate); }
    if (LedMaster.isTds(a.what)){ m.section = a.section || ""; if (a.rate != null && a.rate !== "") m.rate = num(a.rate); }
  },
  // each row keeps its answer and is confirmed by this person; an AI guess or a rule guess not yet in the ledger master is
  // written into it first (the person's own choice, made by this click). Saved at once, with Undo
  confirm(b, names, how){
    const want = new Set([].concat(names || [])), a = this.all(b), rows = a.rows.concat(a.more).filter(r => want.has(r.n) && !r.ok && r.ans && r.ans.what);
    if (!rows.length) return 0;
    const was = LedPage.before(b, rows.map(r => r.n)), at = new Date().toISOString(), who = this.who();
    Drafts.direct(() => {
      b.map = b.map || {};
      rows.forEach(r => { const m = b.map[r.n] = b.map[r.n] || {n: 0};
        if (r.src === "ai" || !m.what){ this.write(m, r.ans); m.why = r.src === "ai" ? "AI guess, confirmed by " + who + ": " + (r.why || "") : r.why || m.why || ""; m.src = r.src === "ai" ? ["ai"] : m.src; } });
      const ns = rows.map(r => r.n), u = LedCheck.usage(b, ns);
      LedMaster.confirm(b, ns, true);
      rows.forEach(r => { const m = b.map[r.n], it = ((b.ledCheck || {}).items || {})[r.n];
        m.okHow = how || "row"; m.okFrom = r.src; delete m.unok; delete m.kept;
        m.hist = (m.hist || []).concat([{act: "confirm", by: who, at, says: r.says, from: r.src}]).slice(-12);
        m.prev = (was.find(x => x[0] === r.n) || [])[1] || null;
        if (it){ it.okSig = LedCheck.sig(u[r.n]); it.okAt = at; it.okBy = who; it.state = "confirmed"; } });
      LedPage.dirty(b); saveBooks();
    }, {bypass: true});
    S.ledUndo = {cid: b.cid, text: rows.length === 1 ? "Confirmed: " + rows[0].n + "." : rows.length + " ledgers confirmed.", list: was};
    render();
    return rows.length;
  },
  // back to "to confirm" with its last answer: the figures do not move (the returns read the same answer, now flagged in
  // To fix as unconfirmed); who and when are kept on the ledger. Filed returns are not touched: they are named
  unconfirm(b, n){
    const m = (b.map || {})[n]; if (!m || !m.ok) return null;
    const was = LedPage.before(b, [n]), at = new Date().toISOString(), who = this.who(), says = this.says(LedPage.ans(m)), filed = this.filedUsing(b, n);
    Drafts.direct(() => {
      const prevOk = {by: m.okBy || "", at: m.okAt || ""};
      LedMaster.confirm(b, [n], false);
      m.unok = {by: who, at, was: prevOk, says, filed};
      m.hist = (m.hist || []).concat([{act: "unconfirm", by: who, at, says}]).slice(-12);
      delete m.okHow; delete m.okFrom; delete m.kept; m.prev = was[0][1];
      const it = ((b.ledCheck || {}).items || {})[n]; if (it){ it.state = "pending"; delete it.okSig; }
      LedPage.dirty(b); saveBooks();
    }, {bypass: true});
    S.ledUndo = {cid: b.cid, text: "Unconfirmed: " + n + ". It is back to confirm, as " + says + "." + (filed.length ? " " + this.filedSay(filed) : ""), list: was};
    render();
    return {filed};
  },
  filedSay(f){ return (f.length === 1 ? "The filed return " + f[0] + " used" : f.length + " filed returns (" + f.slice(0, 3).join(", ") + (f.length > 3 ? ", …" : "") + ") used") + " the earlier choice; " + (f.length === 1 ? "it is" : "they are") + " not changed."; },
  // the returns marked filed that have entries on this ledger: TDS (b.tdsFiled, "fy|q|form") and GST (b.gstFiled[reg][ym])
  filedUsing(b, n){
    const out = [], qs = new Set(), yms = new Set();
    (b.vouchers || []).forEach(v => { if (v.cancel || !(v.ent || []).some(e => e.l === n)) return; const d = String(v.date || ""); if (!/^\d{8}$/.test(d)) return;
      try { qs.add(TDS.fyOf(d) + "|" + TDS.qOf(d)); } catch (e){} yms.add(d.slice(0, 6)); });
    Object.entries(b.tdsFiled || {}).forEach(([k, f]) => { const p = k.split("|"); if (f && qs.has(p[0] + "|" + p[1])) out.push((typeof TDS === "object" && TDS.formShort ? TDS.formShort(p[2], p[0]) : p[2]) + " " + p[1] + " " + p[0]); });
    Object.entries(b.gstFiled || {}).forEach(([reg, recs]) => Object.entries(recs || {}).forEach(([ym, r]) => { if (!r || !yms.has(ym)) return;
      const lab = typeof GSTR === "object" && GSTR.label ? GSTR.label(ym) : ym; if (r.r1) out.push("GSTR-1 " + lab); if (r.r3b) out.push("GSTR-3B " + lab); }));
    return out;
  },

  // ---------- the AI guess, for what the rules cannot tell ----------
  // on while the firm's assistant is on (on by default, the owner's decision of 14-Oct-2026; Settings › AI help); tests replace
  // fetchGuess with a fake
  aiOn(){
    if (typeof Cloud !== "object" || !Cloud.on() || typeof ASST !== "object") return false;
    const st = ASST.st().settings; if (!st && !ASST.st().settingsBusy) ASST.loadSettings(); return !!(st && !st.error && st.enabled);   // on by default since 14-Oct-2026 (the owner's decision); no consent tick
  },
  async fetchGuess(body){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(ASST.url(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !(j && j.guesses)) throw Object.assign(new Error(j.error || ("AI could not be asked (" + r.status + ").")), {kind: j.kind || "other"});
    return j;
  },
  // ---------- the ledgers FinCom posts to (were Client setup's boxes) ----------
  // a search over the client's Tally ledgers: every word of the question that is not a filler word ("which ledger is")
  // counts; a TDS section in it ("194C", "94C") matches the ledger's section; the ledgers of a preferred group first
  find(cid, q, opts){
    opts = opts || {};
    const list = typeof Ledgers === "object" ? Ledgers.list(cid) : [], b = S.books && S.books.cid === cid ? S.books : null;
    const words = String(q || "").toLowerCase().replace(/[^a-z0-9%()&]+/g, " ").split(" ").filter(w => w && !/^(which|what|is|the|a|an|for|of|ledger|ledgers|in|tally|to|my|our)$/.test(w));
    const sec = typeof LedCheck === "object" ? LedCheck.section(q || "") : "";
    const out = [];
    list.forEach(l => {
      if (!l || !l.name) return;
      const hay = (l.name + " " + (l.group || "") + " " + (l.tdsNature || "") + " " + (l.taxType || "") + " " + (l.dutyHead || "")).toLowerCase();
      let score = 0;
      words.forEach(w => { if (hay.includes(w)) score += 2; else if (w === "payable" && /duties|tax/.test(hay)) score += 1; else if (w === "input" && /itc|input/.test(hay)) score += 1; });
      const ls = sec ? LedCheck.section(l.name) || LedCheck.section(l.tdsNature || "") : "";
      if (sec && ls === sec) score += 4; else if (sec && ls && ls !== sec) score -= 4;
      if (opts.prefer && opts.prefer.test(l.group || "")) score += 1;
      if (!words.length || score > 0) out.push({l, score, used: b && b.map && b.map[l.name] ? b.map[l.name].n || 0 : 0});
    });
    return out.sort((x, y) => y.score - x.score || y.used - x.used || x.l.name.localeCompare(y.l.name)).slice(0, opts.max || 30).map(x => x.l);
  },
  // ---------- the old places lead here ----------
  // kind: "tds", "gst" or "all" (the old Tally ledgers tab showed both)
  go(kind){
    kind = kind || "tds";
    S.tab = "books"; S.ledKind = kind; S.ledEdit = ""; S.ledEditPrev = null;
    if (kind === "gst"){ S.booksTab = "gst"; S.gstView = "ledgers"; }
    else { S.booksTab = "tds"; S.tdsView = "ledgers"; }
    // fix-lookup (11-Nov-2026, "← Back"): a step of its own in the history; replacing the page before lost the way back to it
    render(); if (typeof window === "object" && window.scrollTo) window.scrollTo(0, 0);
  },
  // the Tally ledgers tab asked for (an old link, a bookmark, code that sets S.booksTab = "ledgers"): moved, the address
  // replaced; true when it moved
  redirect(){
    if (S.booksTab !== "ledgers") return false;
    S.booksTab = "tds"; S.tdsView = "ledgers"; S.ledKind = "all";
    return true;
  }
};
