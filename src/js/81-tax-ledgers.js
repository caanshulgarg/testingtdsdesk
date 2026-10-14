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
  // the opening balance and Tally's nature of payment, from FinCom's cloud copy (read once a book; the ledger list itself
  // does not carry them). Nothing is asked of Tally
  async loadExt(cid){
    const bk = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid) ? TCloud.book(cid) : null, cur = this.ext[cid];
    if (!bk || (cur && cur.book === bk.book && (cur.at || cur.busy))) return;
    this.ext[cid] = {book: bk.book, busy: true, by: (cur && cur.by) || {}};
    const q = sel => "tally_ledgers?select=" + sel + "&merged_into=is.null&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc";
    let rows = null;
    for (const sel of ["name,open,tds_nature,tds_deductee_type", "name,open"]){ try { rows = await TCloud.restAll(q(sel)); break; } catch (e){ this.ext[cid].err = (e && e.message) || String(e); } }
    const by = {};
    [].concat(rows || []).forEach(r => { if (r && r.name) by[ledNm(r.name).toLowerCase()] = {open: r.open == null || r.open === "" ? null : num(r.open), nature: r.tds_nature || "", dtype: r.tds_deductee_type || ""}; });
    this.ext[cid] = {book: bk.book, at: new Date().toISOString(), by};
    if (typeof render === "function") render();
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
  // the count for the notice line ("19 ledgers to confirm"): the same as LedMaster.pending, by kind
  pending(b, kind){
    return LedMaster.pending(b).filter(([n, m]) => { if (!kind || kind === "all") return true; const k = this.kindOfWhat(m.what) || this.kindOfName(n, (b.ledInfo || {})[n]); return !k || k === kind; });
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
  // the ledgers to ask about: not confirmed, no answer from the rules or the master, not asked before with the same facts
  toAsk(b, rows){ return rows.filter(r => !r.ok && r.src !== "rule" && r.src !== "confirmed" && !(r.it && r.it.ai && r.it.ai.key === this.aiKey(b, r))); },
  aiKey(b, r){ const it = r.it || {}; return [r.n, r.group, (it.use || {}).n || 0].join("|"); },
  // what goes to the server for one ledger: name, group, opening, Tally's tax type and nature, the use, 3 sample entries
  // (the server masks identifiers and the parties named in them)
  payload(b, r, tl){
    const t = tl[r.n] || {}, it = r.it || ((b.ledCheck || {}).items || {})[r.n] || {}, use = it.use || {};
    return {name: r.n, group: r.group || t.group || "", chain: (t.chain || []).slice(0, 6), open: r.open, taxType: t.taxType || "", nature: t.nature || "",
      use: use.say || "not used in the day book", samples: (use.samples || []).slice(0, 3).map(s => s.date + " " + s.type + " " + s.side + " " + s.amt + " | " + (s.lines || []).join(", "))};
  },
  parties(b){ const set = new Set(); Object.keys(b.gstins || {}).concat(Object.keys(b.pans || {})).forEach(n => set.add(n));
    Object.entries(b.under || {}).forEach(([n, g]) => { if (/sundry (debtors|creditors)/i.test(g || "")) set.add(n); }); return Array.from(set).slice(0, 2000); },
  async fetchGuess(body){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(ASST.url(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !(j && j.guesses)) throw Object.assign(new Error(j.error || ("AI could not be asked (" + r.status + ").")), {kind: j.kind || "other"});
    return j;
  },
  MAPK: {gst_output: ["gst", "output"], gst_input: ["gst", "input"], gst_rcm: ["gst_rcm", "output"], gst_ineligible: ["ineligible", "input"], tds_payable: ["tds_payable", ""], tds_receivable: ["tds_receivable", ""],
    tcs_payable: ["tcs_payable", ""], tcs_receivable: ["tcs_receivable", ""], tax_interest: ["", ""], not_tax: ["none", ""]},
  // one batch for the client (at most 100), kept with the books as the check's "ai" (src/js/57's shape): a guess, pending
  async ask(b, opts){
    opts = opts || {};
    const cid = b.cid;
    if (this.ai.busy[cid]) return 0;
    if (!this.aiOn() && !opts.force){ this.ai.err[cid] = "off"; return 0; }
    const a = this.all(b), rows = this.toAsk(b, a.rows.concat(a.more)).slice(0, 100);
    if (!rows.length) return 0;
    this.ai.busy[cid] = true; this.ai.asked[cid] = Date.now(); render();
    let j = null;
    try { j = await this.fetchGuess({action: "ledger_guess", client_id: cid, ledgers: rows.map(r => this.payload(b, r, a.tally)), parties: this.parties(b)}); this.ai.err[cid] = ""; }
    catch (e){ this.ai.err[cid] = (e && e.kind) === "off" || (e && e.kind) === "consent" ? "off" : (e && e.message) || "AI could not be asked"; }
    this.ai.busy[cid] = false;
    const c = LedCheck.st(b), at = new Date().toISOString(), byName = new Map(rows.map(r => [r.n, r]));
    let n = 0;
    ((j && j.guesses) || []).forEach(g => { const r = byName.get(g.name), k = this.MAPK[g.kind]; if (!r || !k) return;
      const it = c.items[g.name] = c.items[g.name] || {s: {what: "", conf: "low", ev: []}, use: {n: 0, say: "not used in the day book"}, state: "pending", tallyOnly: !r.inBooks};
      const what = g.kind === "tax_interest" ? (/TDS|TCS|19\d|206C/i.test(g.name) || /^tds/.test(g.section || "") ? "tds_interest" : "gst_interest") : k[0];
      it.ai = {what, side: k[1], tax: g.head || "", rate: g.rate == null ? null : num(g.rate), section: LedCheck.section(g.section || ""), conf: ["high", "medium", "low"].includes(g.confidence) ? g.confidence : "low",
        reason: String(g.reason || "").slice(0, 200), at, key: this.aiKey(b, r), model: (j && j.model) || ""};
      n++; });
    this.ai.last[cid] = {at, n, asked: rows.length, cached: (j && j.cached) || 0, usd: (j && j.usd) || 0};
    if (n){ Drafts.direct(() => saveBooks(), {bypass: true}); }
    render();
    return n;
  },
  // drawn with the page: the AI guess asked once by itself where the rules cannot tell (the owner: "a default guess from
  // AI reading every ledger should be there"); again only when a ledger's facts change
  auto(b, rows){
    const cid = b.cid;
    if (!cid || this.ai.busy[cid] || Date.now() - (this.ai.asked[cid] || 0) < 60000 || !this.aiOn()) return;
    if (!this.toAsk(b, rows).length) return;
    setTimeout(() => { if (S.books === b) this.ask(b); }, 0);
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
  // the posting choices of each page
  postKeys(kind){
    if (kind === "gst") return [["gst:cgst", "Input CGST"], ["gst:sgst", "Input SGST"], ["gst:igst", "Input IGST"]];
    return rules().filter(r => r.basis !== "never").map(r => ["tds:" + r.id, r.label, r]);
  },
  // a person's choice from the list: checked (a TDS ledger of another section is refused), then confirmed
  postSet(co, key, value){
    value = String(value || "").trim();
    if (!co || !value) return false;
    const [k, sub] = choiceSplit(key);
    if (k === "tds"){ const r = ruleOf(sub), c = tdsLedgerCheck(co.id, value, Ledgers.sec(r.old)); if (!c.ok && c.msg){ toast(c.msg + "."); return false; } if (c.name) value = c.name; }
    if (k === "rcm"){ Drafts.direct(() => { co.gst = co.gst || {}; co.gst[sub] = value; Store.saveCompany(co); }, {bypass: true}); toast("Saved: " + value + "."); render(); return true; }
    choiceConfirm(co, key, value); toast("Confirmed: " + value + "."); render(); return true;
  },
  postUnconfirm(co, key){ const r = choiceUnconfirm(co, key); if (r) toast("Unconfirmed: " + r.value + ". Posting waits until it is confirmed again."); render(); return r; },

  // ---------- the old places lead here ----------
  // kind: "tds", "gst" or "all" (the old Tally ledgers tab showed both)
  go(kind){
    kind = kind || "tds";
    S.tab = "books"; S.ledKind = kind; S.ledEdit = ""; S.ledEditPrev = null;
    if (kind === "gst"){ S.booksTab = "gst"; S.gstView = "ledgers"; }
    else { S.booksTab = "tds"; S.tdsView = "ledgers"; }
    if (typeof Route === "object") Route.replaceNext = true;
    render(); if (typeof window === "object" && window.scrollTo) window.scrollTo(0, 0);
  },
  // the Tally ledgers tab asked for (an old link, a bookmark, code that sets S.booksTab = "ledgers"): moved, the address
  // replaced; true when it moved
  redirect(){
    if (S.booksTab !== "ledgers") return false;
    S.booksTab = "tds"; S.tdsView = "ledgers"; S.ledKind = "all";
    if (typeof Route === "object") Route.replaceNext = true;
    return true;
  }
};
