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
const AIH = {
  FEATURES: [["tds", "TDS: suggest the section for expense ledgers"], ["r2b", "GST: suggest pairs for 2B invoices left unmatched"],
    ["audit", "Audit: flag credit blocked under section 17(5), and expenses where TDS looks missed"], ["notices", "Notices: read a GST or TDS notice and draft a reply"]],
  cfg(){ return Object.assign({on: false, tds: true, r2b: true, audit: true, notices: true}, (S.firm || {}).ai || {}); },
  // switched on for the firm, this part, and this client
  enabled(f){ const c = this.cfg(), co = CO(); return !!c.on && c[f] !== false && !(co && co.aiOff); },
  sub(){ const c = this.cfg(); return c.on ? "on: " + this.FEATURES.filter(([k]) => c[k] !== false).length + " of 4 parts" : "off"; },
  st(){ const b = S.books; b.ai = b.ai || {}; ["led", "tdsPay", "pairs"].forEach(k => { b.ai[k] = b.ai[k] || {}; }); b.ai.notices = b.ai.notices || []; b.ai.log = b.ai.log || []; return b.ai; },
  who(){ return (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "this computer"; },
  log(what, detail){ const a = this.st(); a.log.unshift({at: new Date().toISOString(), by: this.who(), what, detail: String(detail || "").slice(0, 300)}); a.log.length = Math.min(a.log.length, 500); },
  ready(f){
    if (!this.enabled(f)){ toast("AI help is off for this. Switch it on in Settings, AI help."); return false; }
    if (!claudeReady()){ toast("Claude is not available here: sign in to the firm account (Settings), or check the plan's credit."); return false; }
    return true;
  },
  tx(d){ return r2(num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.cess)); },
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
  // who settled each ledger: the rules, AI (accepted), or no one yet
  coverage(){
    const a = (S.books && S.books.ai) || {}, led = a.led || {}, c = {n: 0, tds: {rules: 0, ai: 0, pend: 0}, itc: {rules: 0, ai: 0, pend: 0, na: 0}, ai: {asIs: 0, changed: 0, rejected: 0, waiting: 0}};
    this.ledgerStats().forEach(x => {
      c.n++;
      const y = led[x.l], rt = this.ruleTds(x), ri = this.ruleItc(x);
      if (rt) c.tds.rules++; else if (y && y.tdsOk === "yes" && y.tds && y.tds !== "unsure") c.tds.ai++; else c.tds.pend++;
      if (ri === "n/a") c.itc.na++; else if (ri) c.itc.rules++; else if (y && y.itcOk === "yes" && y.itc && y.itc !== "unsure") c.itc.ai++; else c.itc.pend++;
      if (y){ if ((y.tdsOk || y.itcOk) === "no") c.ai.rejected++; else if (y.tdsOk === "yes" || y.itcOk === "yes") c.ai[y.byHand ? "changed" : "asIs"]++; else c.ai.waiting++; }
    });
    Object.values(a.pairs || {}).forEach(s => { if (s.no) c.ai.rejected++; else if (s.okBy) c.ai.asIs++; else c.ai.waiting++; });
    return c;
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
  async reviewLedgers(again){
    if (!(this.ready("tds") || this.enabled("audit") && this.ready("audit"))) return;
    const b = S.books, a = this.st(), wantTds = this.enabled("tds"), wantItc = this.enabled("audit");
    // only what the rules leave: a ledger whose TDS provision or credit the rules settle is not sent to AI
    const all = this.ledgerStats(), open = all.filter(x => (wantTds && !this.ruleTds(x)) || (wantItc && !this.ruleItc(x)));
    const todo = open.filter(x => again || !a.led[x.l]).slice(0, 300);
    const pay = wantTds ? Object.entries(b.map || {}).filter(([n, m]) => m.kind === "tds_payable" && !m.section && !m.ok && (again || !a.tdsPay[n])).map(([n]) => n).slice(0, 60) : [];
    if (!todo.length && !pay.length){ toast(open.length ? "Every ledger the rules leave has been reviewed. Use “Review all again” to ask afresh." : "FinCom’s rules settle every ledger here: nothing for AI."); return; }
    const rules = RULE_DEFAULTS.map(r => r.id + " (" + r.old + ", " + r.label + "): " + (r.hint || "")).join("\n");
    b.busy = "AI is reviewing " + (todo.length + pay.length) + " ledgers…"; render();
    let done = 0;
    try {
      for (let i = 0; i < todo.length; i += 40){
        const batch = todo.slice(i, i + 40);
        const prompt = "You help an Indian chartered accountant review a client's expense and purchase ledgers from Tally. For each ledger give:\n" +
          (wantTds ? "- tds: which TDS provision a payment booked to it usually falls under, as one of these ids, or \"none\" when payments to it are not subject to TDS (goods purchases, taxes, bank charges, salaries go under 24Q and are \"none\" here), or \"unsure\":\n" + rules + "\n" : "") +
          (wantItc ? "- itc: \"blocked\" when GST input credit on it is usually blocked under section 17(5) of the CGST Act (motor vehicles and their repair or insurance, food and beverages, outdoor catering, beauty, health and cosmetic services, club or fitness membership, life or health insurance, travel benefits to employees, works contract or goods for building immovable property other than plant and machinery, goods for personal use, gifts and free samples, lost or destroyed goods), \"allowed\" when it is not, or \"unsure\"; and the clause, e.g. 17(5)(b)(i)\n" : "") +
          "- reason: one short sentence a CA can check.\nThese are the ledgers FinCom’s own rules could not settle, so they are the unclear ones. Judge from the ledger name, its Tally group, the narrations and the parties. Do not guess when the ledger is too vague: say unsure.\n" +
          "Ledgers:\n" + batch.map((x, k) => k + ". " + x.l + " | group: " + (x.group || "?") + " | " + x.n + " entries, " + INR.format(x.amt) + " | TDS deducted on " + x.tds + " | GST credit taken on " + x.itc +
            (x.narr.length ? " | narrations: " + x.narr.join(" / ") : "") + " | parties: " + Object.keys(x.parties).slice(0, 3).join(", ")).join("\n") +
          '\nReply with only JSON: {"items":[{"i":0,"tds":"contractor","itc":"allowed","clause":"","reason":"..."}]}';
        const j = await claudeRead(prompt, [], false);
        (j.items || []).forEach(it => {
          const x = batch[it.i]; if (!x) return;
          const tds = wantTds ? (it.tds === "none" || it.tds === "unsure" || this.rule(it.tds) ? it.tds : "unsure") : "";
          const itc = wantItc ? (["blocked", "allowed", "unsure"].includes(it.itc) ? it.itc : "unsure") : "";
          a.led[x.l] = {tds, itc, clause: String(it.clause || "").slice(0, 30), reason: String(it.reason || "").slice(0, 300), at: new Date().toISOString(), amt: x.amt, group: x.group, tdsIn: x.tds, itcIn: x.itc, n: x.n};
          done++;
        });
      }
      if (pay.length){
        const prompt = "These are TDS payable ledgers in an Indian client's Tally with no section set. For each, say which provision it is for, as one of these ids, or \"unsure\":\n" + rules +
          "\nLedgers:\n" + pay.map((n, k) => k + ". " + n).join("\n") + '\nReply with only JSON: {"items":[{"i":0,"rule":"professional","reason":"..."}]}';
        const j = await claudeRead(prompt, [], false);
        (j.items || []).forEach(it => { const n = pay[it.i]; if (n && this.rule(it.rule)) { a.tdsPay[n] = {rule: it.rule, reason: String(it.reason || "").slice(0, 300), at: new Date().toISOString()}; done++; } });
      }
      this.log("AI reviewed ledgers", done + " ledgers");
      await saveBooks();
      toast("AI reviewed " + done + " ledgers. Check each suggestion and accept it; the audit uses only what is accepted.");
    } catch (e){ toast("AI could not review the ledgers: " + errCopy(e && e.code)); }
    b.busy = ""; render();
  },
  accept(l, how){
    const x = this.st().led[l]; if (!x) return;
    if (how === "yes" || how === "no"){ if (x.tds) x.tdsOk = how; if (x.itc) x.itcOk = how; }
    x.okBy = this.who(); x.okAt = new Date().toISOString();
    this.log(how === "yes" ? "accepted" : "rejected", l + ": TDS " + (x.tds || "-") + ", credit " + (x.itc || "-"));
  },
  acceptPay(n){
    const s = this.st().tdsPay[n], m = (S.books.map || {})[n], r = s && this.rule(s.rule);
    if (!s || !m || !r) return;
    m.section = r.old; m.byHand = m.ok = true; m.okAt = new Date().toISOString(); m.why = "AI suggested " + r.old + " (" + r.label + "), accepted by " + this.who();
    S.books.mapV = (S.books.mapV || 0) + 1; S.books.reco = null; delete this.st().tdsPay[n];
    this.log("accepted", n + ": section " + r.old);
  },
  // ---------- 2: 2B invoices left after the matching
  cands(p, free){
    const pan = String(p.gstin || "").slice(2, 12), t = this.tx(p);
    return free.filter(d => d.dir === p.dir && (!d.gstin || String(d.gstin).slice(2, 12) === pan) &&
      (Math.abs(this.tx(d) - t) <= Math.max(50, t * 0.15) || Math.abs(num(d.taxable) - num(p.taxable)) <= Math.max(100, num(p.taxable) * 0.15)))
      .sort((a, c) => Math.abs(this.tx(a) - t) - Math.abs(this.tx(c) - t)).slice(0, 6);
  },
  async pair2b(){
    if (!this.ready("r2b") || !this._r2) return;
    const a = this.st(), st = GST2B.state(), {list, free} = this._r2;
    const todo = list.filter(p => !a.pairs[p.key] && !(st.link || {})[p.key]).map(p => ({p, c: this.cands(p, free)})).filter(x => x.c.length).slice(0, 200);
    if (!todo.length){ toast("Nothing close enough in Tally for AI to look at."); return; }
    const b = S.books; b.busy = "AI is looking at " + todo.length + " invoices…"; render();
    let n = 0;
    try {
      for (let i = 0; i < todo.length; i += 25){
        const batch = todo.slice(i, i + 25);
        const d = x => "no " + x.no + ", " + GSTAmend.dmy(x.date) + ", taxable " + num(x.taxable) + ", tax " + this.tx(x) + (x.party ? ", " + x.party : "");
        const prompt = "You match invoices in an Indian supplier's GSTR-1 (as seen in the buyer's GSTR-2B) to purchase entries in the buyer's Tally. For each 2B invoice, choose the Tally entry that is the same invoice, or none.\n" +
          "The same invoice is often written differently: prefixes, years and slashes (INV/24-25/0045, 0045 and 45 are the same number), a date a few days apart, or a rounding difference. Different amounts with unrelated numbers are not the same invoice. When unsure, choose none.\n" +
          batch.map((x, k) => k + ". 2B: " + d(x.p) + "\n" + x.c.map((c, m) => "   " + m + ") Tally: " + d(c)).join("\n")).join("\n") +
          '\nReply with only JSON: {"items":[{"i":0,"pick":0,"confidence":0.0,"reason":"..."}]} with pick -1 for none.';
        const j = await claudeRead(prompt, [], false);
        (j.items || []).forEach(it => {
          const x = batch[it.i]; if (!x) return;
          const c = x.c[it.pick]; if (!c || num(it.confidence) < 0.5) return;
          const diff = r2(this.tx(c) - this.tx(x.p));
          a.pairs[x.p.key] = {id: c.id, no: false, label: c.no + " · vch " + c.voucher + " · " + GSTAmend.dmy(c.date), diff, conf: r2(num(it.confidence)), reason: String(it.reason || "").slice(0, 200), at: new Date().toISOString()};
          n++;
        });
      }
      this.log("AI suggested 2B pairs", n + " pairs");
      await saveBooks();
      toast(n ? "AI suggested " + n + " pair" + (n === 1 ? "" : "s") + ". Accept the right ones in the list." : "AI found no confident pairs.");
    } catch (e){ toast("AI could not pair them: " + errCopy(e && e.code)); }
    b.busy = ""; render();
  },
  // ---------- 4: notices
  noticeFigures(n){
    const b = S.books, out = {};
    try {
      if (n.kind === "tds"){
        const qOf = d => { const m = +String(d).slice(4, 6); return m >= 4 && m <= 6 ? "Q1" : m <= 9 && m >= 7 ? "Q2" : m >= 10 ? "Q3" : "Q4"; };
        const rows = TDS.allRows(), by = {};
        rows.filter(r => !n.fy || r.fy === n.fy).forEach(r => { const k = r.fy + " " + (r.q || qOf(r.date)) + " " + r.section; const x = by[k] = by[k] || {deductions: 0, paid: 0, tds: 0}; x.deductions++; x.paid = r2(x.paid + num(r.paid)); x.tds = r2(x.tds + num(r.tds)); });
        out.tdsInBooks = by;
        out.challans = TDS.challans().filter(c => !n.fy || TDS.fyOf(c.date) === n.fy).map(c => ({date: c.date, amount: c.amount || c.total, bsr: c.bsr, no: c.no})).slice(0, 60);
      } else {
        const regs = Object.keys(b.gstFiled || {}).concat(Object.values(b.filed || {}).map(f => String(f.gstin).slice(0, 2)));
        const reg = n.gstin ? String(n.gstin).slice(0, 2) : (S.gstReg || regs[0] || "");
        const months = (n.months || []).filter(m => /^\d{6}$/.test(m)).slice(0, 12);
        months.forEach(ym => {
          const f = {};
          try { f.salesInBooks = GSTR.sum(GSTR.outward(ym, reg)); } catch (e){}
          try { f.purchasesInBooks = GSTR.sum(GSTR.inward(ym, reg).map(r => GSTR.signedIn(r))); } catch (e){}
          try { const c = GSTAmend.check(ym, reg); if (c) f.gstr1 = {filedTaxable: c.filedTotal, booksTaxable: c.booksTotal, documentsDiffering: c.rows.length}; } catch (e){}
          const s3 = ((b.gstFiled || {})[reg] || {})[ym]; if (s3 && s3.snap && JSON.stringify(s3.snap).length < 4000) f.gstr3bFiled = s3.snap;
          try { const r = GST2B.run(reg); if (r && r.portal) { const p = r.portal.filter(x => x.ym === ym); f.in2b = {invoices: p.length, tax: r2(p.reduce((s, x) => s + this.tx(x), 0))}; } } catch (e){}
          out[ym] = f;
        });
      }
    } catch (e){}
    return out;
  },
  async readNotice(file, kind){
    if (!this.ready("notices")) return;
    const b = S.books, co = CO(), a = this.st();
    const rec = {id: "nt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, name: file.name, size: file.size, at: new Date().toISOString(), by: this.who(), step: "reading"};
    a.notices.unshift(rec);
    try { await FileStore.put(co.id, rec.id, file); S.files[rec.id] = file; if (CloudDocs.on()) CloudDocs.add(co.id, rec.id, file, "notice"); } catch (e){}
    b.busy = "AI is reading the notice…"; render();
    try {
      let text = "", imgs = [];
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)){
        const pg = await pdfPages(file, [1, 2, 3, 4, 5, 6]);
        text = String(pg.text || "").trim();
        if (text.length < 400) for (const c of pg.canvases.slice(0, Math.max(1, S.imgMax || 4))) imgs.push(await imgBlob(c, "page"));
      } else imgs.push(await imgBlob(await imageToCanvas(file), "page"));
      const prompt = "This is a notice to an Indian taxpayer (GST or income-tax TDS/TCS). Read it and give its details.\n" + (text ? "Text of the notice:\n" + text.slice(0, 14000) + "\n" : "") +
        'Reply with only JSON: {"law":"GST|TDS|Income tax|other","form":"e.g. ASMT-10, DRC-01, DRC-01A, 143(1)(a), TRACES default","ref":"reference or DIN","date":"YYYY-MM-DD","reply_by":"YYYY-MM-DD or empty","authority":"",' +
        '"gstin":"","tan":"","fy":"e.g. 2024-25","months":["YYYYMM"],"quarter":"","section":"","amount":0,"summary":"two or three plain sentences","issues":[{"point":"what the officer says","amount":0,"period":""}]}';
      const j = await claudeRead(prompt, imgs, true);
      rec.fields = j; rec.fy = j.fy || ""; rec.gstin = j.gstin || ""; rec.months = [].concat(j.months || []);
      rec.figures = this.noticeFigures(rec);
      rec.step = "read";
      this.log("AI read a notice", (j.form || "") + " " + (j.ref || "") + " (" + file.name + ")");
      await saveBooks(); render();
      await this.draft(rec);
    } catch (e){ rec.step = "failed"; rec.error = errCopy(e && e.code); toast("AI could not read the notice: " + rec.error); }
    b.busy = ""; await saveBooks(); render();
  },
  async draft(rec){
    if (!this.ready("notices")) return;
    const b = S.books, co = CO(); b.busy = "AI is drafting the reply…"; render();
    try {
      const prompt = "Draft a reply to this notice for an Indian chartered accountant to check, correct and send for the client.\n" +
        "Client: " + (co.name || "") + (co.gstin ? ", GSTIN " + co.gstin : "") + (co.pan ? ", PAN " + co.pan : "") + "\nThe notice, as read: " + JSON.stringify(rec.fields || {}).slice(0, 6000) +
        "\nFigures from the client's books and returns in FinCom (the only facts you may use; say plainly where they do not explain the officer's point): " + JSON.stringify(rec.figures || {}).slice(0, 8000) +
        "\nWrite in formal Indian tax-reply style: the addressee, the reference, a subject line, then each point of the notice answered in turn with the figures, what is accepted and what is not, and what documents are attached. " +
        "Do not invent facts, dates, payments or documents; where something must be checked or attached, write it as [to check: …]. End with [Authorised signatory] and [Place, date]." +
        '\nReply with only JSON: {"reply":"the full letter","points":[{"issue":"","answer":"","to_check":""}]}';
      const j = await claudeRead(prompt, [], true);
      rec.reply = String(j.reply || ""); rec.points = [].concat(j.points || []); rec.step = "drafted"; rec.draftAt = new Date().toISOString();
      this.log("AI drafted a reply", (rec.fields || {}).form + " " + ((rec.fields || {}).ref || ""));
      toast("The reply is drafted. Read every line and correct it before it goes.");
    } catch (e){ toast("AI could not draft the reply: " + errCopy(e && e.code)); }
    b.busy = ""; await saveBooks(); render();
  }
};

// AI help's buttons and boxes (app/src/parts/Ai.jsx)
function aihSet(k, on){ S.firm.ai = Object.assign(AIH.cfg(), {[k]: on}); Store.saveFirm(); toast(k === "on" ? (on ? "AI help is on." : "AI help is off.") : "Saved."); render(); }
function aihCo(id, on){ const co = S.companies[id]; if (co){ co.aiOff = on; Store.saveCompany(co); render(); } }
function aihNotice(file, kind){ AIH.readNotice(file, kind); }
function aihFix(l, f, v){
  const x = AIH.st().led[l]; if (!x) return;
  x[f] = v; x[f + "Ok"] = "yes"; x.okBy = AIH.who(); x.okAt = new Date().toISOString(); x.byHand = true;
  AIH.log("set by hand", l + ": " + f + " " + v); saveBooks(); render();
}
function aihReply(id, v){ const n = AIH.st().notices.find(z => z.id === id); if (n){ n.reply = v; n.editedBy = AIH.who(); saveBooks(); } }
function aihAct(a){
  if (a === "review" || a === "reviewAgain") AIH.reviewLedgers(a === "reviewAgain");
  else if (a === "auditReview"){ S.booksTab = "ledgers"; S.lmView = "ai"; render(); AIH.reviewLedgers(false); }
  else if (a === "pair2b") AIH.pair2b();
}
// Accept / Reject is its own confirm step (review 18): saved at once, not kept as a draft of the page (src/js/60)
async function aihAccept(l, yes){ await Drafts.direct(() => { AIH.accept(l, yes ? "yes" : "no"); return saveBooks(); }, {bypass: true}); render(); }
async function aihPay(n, yes){ await Drafts.direct(() => { if (yes) AIH.acceptPay(n); else { delete AIH.st().tdsPay[n]; AIH.log("rejected", n + ": TDS ledger section"); } return saveBooks(); }, {bypass: true}); render(); }
async function aihPair(key, yes){
  const a = AIH.st(), s = a.pairs[key]; if (!s) return;
  if (yes){ const st = GST2B.state(); st.link[key] = [s.id]; delete st.confirm[key]; s.okBy = AIH.who(); s.okAt = new Date().toISOString(); AIH.log("accepted 2B pair", s.label); }
  else { s.no = true; AIH.log("rejected 2B pair", s.label); }
  await saveBooks(); render();
}
// a notice: open its file, remove it (asked first), read it again, draft again, copy or download the reply
async function aihNote(how, id){
  const a = AIH.st(), n = a.notices.find(z => z.id === id); if (!n) return;
  const file = async () => FileStore.get(CO().id, n.id, n.docPath, n.name);
  if (how === "open"){ const f = await file(); if (!f){ toast("The notice is not on this computer and could not be fetched."); return; } window.open(URL.createObjectURL(f), "_blank"); return; }
  if (how === "del"){ const r = await askConfirm({title: "Remove this notice?", ok: "Remove", body: '<p class="note">The notice and its draft reply are removed from FinCom.</p>'}); if (!r || !r.ok) return; a.notices = a.notices.filter(z => z !== n); try { FileStore.drop(CO().id, n.id); } catch (x){} AIH.log("removed a notice", n.name); await saveBooks(); render(); return; }
  if (how === "retry"){ const f = await file(); if (!f){ toast("The notice file is not here any more; add it again."); return; } a.notices = a.notices.filter(z => z !== n); AIH.readNotice(f, n.kind); return; }
  if (how === "redo"){ n.figures = AIH.noticeFigures(n); AIH.draft(n); return; }
  if (how === "copy"){ try { await navigator.clipboard.writeText(n.reply || ""); toast("Copied."); } catch (x){ toast("Could not copy; select the text and copy it."); } return; }
  if (how === "dl") saveFile("Reply " + String((n.fields || {}).form || "notice").replace(/[^\w.-]+/g, "_") + ".txt", new Blob([n.reply || ""], {type: "text/plain"}));
}
