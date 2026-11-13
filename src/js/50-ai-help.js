/* ================================================================== */
/* AI help (Claude) in TDS and GST: it suggests, FinCom's rules and   */
/* people decide. Off unless the firm switches it on (Settings, AI    */
/* help), and off for any client the firm excludes. Nothing it says   */
/* is used until someone accepts it; who accepted and when is kept.   */
/*   1. TDS: the section for expense ledgers (and for TDS ledgers     */
/*      that have none)                                               */
/*   2. GST: pairs for the 2B invoices left after the exact matching  */
/*   3. Audit: credit blocked under section 17(5), and missed TDS     */
/*      (the audit's own checks use the accepted answers)             */
/*   4. Notices: read a GST or TDS notice, put it against the books,  */
/*      and draft a reply                                             */
/* Tax, returns and filing stay with FinCom's rules: AI is never asked */
/* to work out tax or to make a return.                               */
/* ================================================================== */
// next-room-2: what the rest of the program reads is here; asking Claude and the page's buttons (FEATURES, sub, coverage,
// reviewLedgers, accept, acceptPay, pair2b, readNotice, draft, aihAct …) are in src/js/50-ai-help-page.js, put on this same
// AIH by the AI help pages' file (app/src/parts/Ai.jsx; in the one-file site, right below).
const AIH = {
  cfg(){ return Object.assign({on: false, tds: true, r2b: true, tdsMatch: true, audit: true, notices: true}, (S.firm || {}).ai || {}); },
  // switched on for the firm, this part, and this client
  enabled(f){ const c = this.cfg(), co = CO(); return !!c.on && c[f] !== false && !(co && co.aiOff); },
  st(){ const b = S.books; b.ai = b.ai || {}; ["led", "tdsPay", "pairs"].forEach(k => { b.ai[k] = b.ai[k] || {}; }); b.ai.notices = b.ai.notices || []; b.ai.log = b.ai.log || []; return b.ai; },
  who(){ return (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "this computer"; },
  log(what, detail){ const a = this.st(); a.log.unshift({at: new Date().toISOString(), by: this.who(), what, detail: String(detail || "").slice(0, 300)}); a.log.length = Math.min(a.log.length, 500); },
  ready(f){
    if (!this.enabled(f)){ toast("AI help is off for this. Switch it on in Settings, AI help."); return false; }
    if (!claudeReady()){ toast("Claude is not available here: sign in to the firm account (Settings), or check the plan's credit."); return false; }
    return true;
  },
  rule(id){ return RULE_DEFAULTS.find(r => r.id === id); },
  // what the audit uses: only answers someone accepted
  tdsRule(l){ if (!S.books || !this.enabled("tds")) return undefined; const x = ((S.books.ai || {}).led || {})[l]; return x && x.tdsOk === "yes" && x.tds && x.tds !== "unsure" ? x.tds : undefined; },
  blocked(l){ if (!S.books || !this.enabled("audit")) return undefined; const x = ((S.books.ai || {}).led || {})[l]; return x && x.itcOk === "yes" && (x.itc === "blocked" || x.itc === "allowed") ? x.itc === "blocked" : undefined; },

  // ---------- rules first: what FinCom's own rules settle about a ledger ("" when they cannot)
  ruleTds(x){
    const k = Audit.TDS_KEY.find(([re]) => re.test(x.l));
    if (k) return k[1];
    if (Audit.under(x.l, /^purchase accounts$/i) || Audit.isFixed(x.l) && !/INSTALL|CIVIL|CONSTRUCTION/i.test(x.l) || Audit.NO_TDS_RE.test(x.l)) return "none";
    return "";
  },
  ruleItc(x){
    if (!x.itcIn) return "n/a";                             // no credit taken on it: nothing to decide
    if (Audit.BLOCKED_RE.test(x.l)) return "blocked";
    if (Audit.under(x.l, /^purchase accounts$/i)) return "allowed";
    return "";
  },
  // ---------- 1 and 3: the ledgers the rules could not settle, once each (again only when asked)
  ledgerStats(){
    const b = S.books, A = Audit, out = {};
    (b.vouchers || []).forEach(v => {
      if (Books.isSale(v) || v.cancel || v.opt) return;
      const lines = v.ent.filter(e => e.a < 0 && (A.isExpense(e.l) || A.isFixed(e.l) || A.under(e.l, /^purchase accounts$/i)) && !A.isDuties(e.l));
      if (!lines.length) return;
      const tds = Books.lines(v).tds.length > 0;
      const itc = v.ent.some(e => { const m = Books.ledgerOf(e.l); return e.a < 0 && (m.kind === "gst" || m.kind === "gst_common") && m.side === "input"; });
      const party = (v.ent.find(e => e.a > 0 && (A.isCreditor(e.l) || A.isBankL(e.l) || A.isCash(e.l))) || {}).l || v.party || "";
      lines.forEach(e => {
        const x = out[e.l] = out[e.l] || {l: e.l, group: A.path(e.l)[0] || "", amt: 0, n: 0, tds: 0, itc: 0, narr: [], parties: {}};
        x.amt = r2(x.amt - e.a); x.n++; if (tds) x.tds++; if (itc) x.itc++;
        if (v.narr && x.narr.length < 3 && !x.narr.includes(v.narr)) x.narr.push(String(v.narr).slice(0, 90));
        if (party) x.parties[party] = (x.parties[party] || 0) + 1;
      });
    });
    return Object.values(out).sort((a, c) => c.amt - a.amt);
  },
};
