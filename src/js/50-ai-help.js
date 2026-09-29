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

  // ---------- 1 and 3: the ledgers, once each (again only when asked)
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
    const all = this.ledgerStats(), todo = all.filter(x => again || !a.led[x.l]).slice(0, 300);
    const pay = wantTds ? Object.entries(b.map || {}).filter(([n, m]) => m.kind === "tds_payable" && !m.section && !m.ok && (again || !a.tdsPay[n])).map(([n]) => n).slice(0, 60) : [];
    if (!todo.length && !pay.length){ toast("Every ledger has been reviewed. Use “Review all again” to ask afresh."); return; }
    const rules = RULE_DEFAULTS.map(r => r.id + " (" + r.old + ", " + r.label + "): " + (r.hint || "")).join("\n");
    b.busy = "AI is reviewing " + (todo.length + pay.length) + " ledgers…"; render();
    let done = 0;
    try {
      for (let i = 0; i < todo.length; i += 40){
        const batch = todo.slice(i, i + 40);
        const prompt = "You help an Indian chartered accountant review a client's expense and purchase ledgers from Tally. For each ledger give:\n" +
          (wantTds ? "- tds: which TDS provision a payment booked to it usually falls under, as one of these ids, or \"none\" when payments to it are not subject to TDS (goods purchases, taxes, bank charges, salaries go under 24Q and are \"none\" here), or \"unsure\":\n" + rules + "\n" : "") +
          (wantItc ? "- itc: \"blocked\" when GST input credit on it is usually blocked under section 17(5) of the CGST Act (motor vehicles and their repair or insurance, food and beverages, outdoor catering, beauty, health and cosmetic services, club or fitness membership, life or health insurance, travel benefits to employees, works contract or goods for building immovable property other than plant and machinery, goods for personal use, gifts and free samples, lost or destroyed goods), \"allowed\" when it is not, or \"unsure\"; and the clause, e.g. 17(5)(b)(i)\n" : "") +
          "- reason: one short sentence a CA can check.\nJudge from the ledger name, its Tally group, the narrations and the parties. Do not guess when the ledger is too vague: say unsure.\n" +
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
  viewLedgers(b){
    const a = this.st(), money = v => INR.format(r2(v || 0)), wantTds = this.enabled("tds"), wantItc = this.enabled("audit");
    if (!wantTds && !wantItc) return '<p class="note">AI help for TDS and audit is off. Settings, AI help.</p>';
    const stats = this.ledgerStats(), rows = stats.filter(x => a.led[x.l]), notYet = stats.length - rows.length;
    const pend = rows.filter(x => { const y = a.led[x.l]; return (y.tds && !y.tdsOk) || (y.itc && !y.itcOk); });
    let h = '<section class="dash-card"><h3>AI: TDS section and blocked credit, ledger by ledger</h3>' +
      '<p class="note">AI reads each expense and purchase ledger’s name, group, narrations and parties' + (wantTds ? " and suggests its TDS section" : "") + (wantItc ? (wantTds ? ", and" : " and says") + " whether GST credit on it is blocked under section 17(5)" : "") +
      ". Check and accept each: the audit’s checks for missed TDS and blocked credit then use what you accepted. Nothing here changes Tally or a return.</p>" +
      '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn small primary" data-aih="review">' + (notYet ? "Ask AI about " + notYet + " ledger" + (notYet === 1 ? "" : "s") : "Nothing new to ask") + "</button>" +
      (rows.length ? '<button class="btn small" data-aih="reviewAgain">Review all again</button>' : "") +
      '<span class="note">' + rows.length + " reviewed · " + pend.length + " to accept</span></div></section>";
    const pay = Object.entries(a.tdsPay).filter(([n]) => (b.map || {})[n] && !(b.map[n].ok && b.map[n].section));
    if (wantTds && pay.length) h += '<section class="dash-card" style="margin-top:12px"><h3>TDS ledgers without a section</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Ledger</th><th>AI suggests</th><th>Why</th><th></th></tr></thead><tbody>' +
      pay.map(([n, s]) => { const r = this.rule(s.rule); return "<tr><td>" + esc(n) + "</td><td>" + esc(r.old + " · " + r.label) + "</td><td>" + esc(s.reason) + '</td><td class="ac"><button class="btn small primary" data-aihpay="' + esc(n) + '">Accept</button> <button class="btn small" data-aihpayno="' + esc(n) + '">Not this</button></td></tr>'; }).join("") + "</tbody></table></div></section>";
    if (!rows.length) return h;
    const tdsOpts = [["unsure", "unsure"], ["none", "no TDS"]].concat(RULE_DEFAULTS.map(r => [r.id, r.old + " · " + r.label]));
    const sel = (l, f, val, opts) => '<select data-aihfix="' + esc(l) + '" data-f="' + f + '">' + opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === val ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select>";
    const list = rows.sort((x, y) => { const p = z => { const q = a.led[z.l]; return (q.tds && !q.tdsOk) || (q.itc && !q.itcOk) ? 0 : 1; }; return p(x) - p(y) || y.amt - x.amt; }).slice(0, 300);
    h += '<div class="bk-tablewrap" style="margin-top:12px"><table class="bk-table"><thead><tr><th>Ledger</th><th class="n">Booked</th>' + (wantTds ? "<th>TDS section</th>" : "") + (wantItc ? "<th>GST credit</th>" : "") + "<th>AI’s reason</th><th>Status</th></tr></thead><tbody>" +
      list.map(x => {
        const y = a.led[x.l], open = (y.tds && !y.tdsOk) || (y.itc && !y.itcOk);
        return "<tr><td>" + esc(x.l) + '<div class="nr">' + esc(x.group || "") + " · " + x.n + " entries" + (x.tds ? " · TDS on " + x.tds : "") + (x.itc ? " · credit on " + x.itc : "") + '</div></td><td class="n">' + money(x.amt) + "</td>" +
          (wantTds ? "<td>" + sel(x.l, "tds", y.tds || "unsure", tdsOpts) + "</td>" : "") +
          (wantItc ? "<td>" + sel(x.l, "itc", y.itc || "unsure", [["unsure", "unsure"], ["allowed", "allowed"], ["blocked", "blocked, 17(5)"]]) + (y.clause ? '<div class="nr">' + esc(y.clause) + "</div>" : "") + "</td>" : "") +
          "<td>" + esc(y.reason || "") + "</td><td>" + (open ? '<button class="btn small primary" data-aihok="' + esc(x.l) + '">Accept</button> <button class="btn small" data-aihno="' + esc(x.l) + '">Reject</button>'
            : '<span class="nr">' + ((y.tdsOk || y.itcOk) === "no" ? "rejected" : "accepted") + " by " + esc(y.okBy || "") + (y.okAt ? " on " + fmtDate(String(y.okAt).slice(0, 10)) : "") + "</span>") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return h;
  },
  auditButton(){
    if (!(this.enabled("tds") || this.enabled("audit"))) return "";
    const a = (S.books || {}).ai || {}, led = a.led || {}, open = Object.values(led).filter(y => (y.tds && !y.tdsOk) || (y.itc && !y.itcOk)).length;
    return '<button class="btn small" data-aih="auditReview">AI review of ledgers' + (open ? " (" + open + " to accept)" : "") + "</button>";
  },

  // ---------- 2: 2B invoices left after the matching
  r2bBar(list, free){
    if (!this.enabled("r2b") || !list.length) return "";
    this._r2 = {list, free};
    const n = Object.keys(this.st().pairs).filter(k => !this.st().pairs[k].no).length;
    return '<div class="row" style="gap:8px;align-items:center;margin:0 0 8px"><button class="btn small" data-aih="pair2b">Ask AI to pair these</button><span class="note">AI looks for the same invoice under another number or date format (e.g. INV/24-25/0045 and 45). ' +
      (n ? n + " suggestion" + (n === 1 ? "" : "s") + " below, to accept or not." : "Each suggestion waits for you to accept it.") + "</span></div>";
  },
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
  pairCell(p){
    if (!this.enabled("r2b") || !S.books.ai) return "";
    const s = (S.books.ai.pairs || {})[p.key];
    if (!s || s.no || ((GST2B.state().link || {})[p.key])) return "";
    return '<div class="nr" style="margin-top:4px">AI: ' + esc(s.label) + (s.diff ? " (tax differs by " + INR.format(s.diff) + ")" : "") + " — " + esc(s.reason) +
      ' <button class="linkbtn" data-aihpair="' + esc(p.key) + '">accept</button> · <button class="linkbtn" data-aihpairno="' + esc(p.key) + '">not this</button></div>';
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
  },
  viewNotices(b, kind){
    if (!this.enabled("notices")) return '<p class="note">AI help for notices is off. Settings, AI help.</p>';
    const list = ((b.ai || {}).notices || []).filter(n => n.kind === kind);
    let h = '<section class="dash-card"><h3>' + (kind === "tds" ? "TDS" : "GST") + " notices</h3>" +
      '<p class="note">Add the notice (PDF or photo). AI reads it, FinCom puts its points against this client’s books and returns, and AI drafts a reply for you to check. The draft uses only those figures; anything to verify is marked [to check]. Nothing is sent from here.</p>' +
      '<label class="btn small primary">Add a notice<input type="file" accept=".pdf,image/*" data-aihnotice="' + kind + '" hidden></label></section>';
    list.forEach(n => {
      const f = n.fields || {};
      h += '<section class="dash-card" style="margin-top:12px"><h3>' + esc((f.form || "Notice") + (f.ref ? " · " + f.ref : "")) + "</h3>" +
        '<p class="note">' + esc(n.name) + " · added " + fmtDate(String(n.at).slice(0, 10)) + " by " + esc(n.by || "") + (f.date ? " · dated " + fmtDate(f.date) : "") + (f.reply_by ? ' · <b>reply by ' + fmtDate(f.reply_by) + "</b>" : "") +
        ' · <button class="linkbtn" data-aihnopen="' + n.id + '">open</button> · <button class="linkbtn" data-aihndel="' + n.id + '">remove</button></p>' +
        (n.step === "failed" ? '<p class="bk-warn">Could not be read: ' + esc(n.error || "") + ' <button class="linkbtn" data-aihnretry="' + n.id + '">try again</button></p>' : "") +
        (f.summary ? "<p>" + esc(f.summary) + "</p>" : "") +
        ((f.issues || []).length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>The officer’s point</th><th>Period</th><th class="n">Amount</th></tr></thead><tbody>' +
          f.issues.map(x => "<tr><td>" + esc(x.point || "") + "</td><td>" + esc(x.period || "") + '</td><td class="n">' + (num(x.amount) ? INR.format(num(x.amount)) : "") + "</td></tr>").join("") + "</tbody></table></div>" : "") +
        (n.reply ? '<h4 style="margin:12px 0 6px">Draft reply (AI, to be checked)</h4><textarea data-aihnreply="' + n.id + '" rows="16" style="width:100%;font:13px/1.5 inherit">' + esc(n.reply) + "</textarea>" +
          '<div class="row" style="gap:8px;margin-top:6px"><button class="btn small" data-aihncopy="' + n.id + '">Copy</button><button class="btn small" data-aihndl="' + n.id + '">Download as text</button><button class="btn small" data-aihnredo="' + n.id + '">Draft again with today’s books</button></div>'
          : n.step === "read" ? '<button class="btn small primary" data-aihnredo="' + n.id + '">Draft the reply</button>' : "") + "</section>";
    });
    return h;
  },

  // ---------- Settings, AI help
  viewSettings(){
    const c = this.cfg(), cos = Object.values(S.companies || {}).sort((x, y) => String(x.name).localeCompare(String(y.name)));
    const cb = (k, on, label, dis) => '<label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" data-aihset="' + k + '"' + (on ? " checked" : "") + (dis ? " disabled" : "") + "><span>" + label + "</span></label>";
    let h = '<section class="dash-card"><h3>AI help in TDS and GST</h3>' +
      '<p class="note">Claude suggests; FinCom’s rules work out tax and make returns; your people accept or reject each suggestion, and who accepted it is kept. Each use is charged to the firm’s credit like reading a bill. The client’s ledger names, narrations, invoice details and notices are sent to Claude through the firm’s account: tell your clients, and switch it off below for any client who has not agreed.</p>' +
      cb("on", c.on, "<b>Use AI help</b>") + '<div style="margin-left:24px">' + this.FEATURES.map(([k, l]) => cb(k, c[k] !== false, esc(l), !c.on)).join("") + "</div></section>";
    h += '<section class="dash-card" style="margin-top:12px"><h3>Clients</h3><p class="note">Tick a client to keep its data away from AI, whatever is switched on above.</p><div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Client</th><th>AI off for this client</th></tr></thead><tbody>' +
      cos.map(co => "<tr><td>" + esc(co.name || co.id) + '</td><td><input type="checkbox" data-aihco="' + esc(co.id) + '"' + (co.aiOff ? " checked" : "") + ' aria-label="AI off for ' + esc(co.name || "") + '"></td></tr>').join("") + "</tbody></table></div></section>";
    const lg = S.books && S.books.ai && S.books.ai.log || [];
    if (lg.length) h += '<section class="dash-card" style="margin-top:12px"><h3>What AI did for ' + esc((CO() || {}).name || "this client") + '</h3><div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th class="dt">When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>' +
      lg.slice(0, 40).map(x => '<tr><td class="dt">' + esc(String(x.at).replace("T", " ").slice(0, 16)) + "</td><td>" + esc(x.by) + "</td><td>" + esc(x.what) + "</td><td>" + esc(x.detail) + "</td></tr>").join("") + "</tbody></table></div></section>";
    return h;
  }
};

if (typeof document !== "undefined"){
  document.addEventListener("change", async e => {
    const t = e.target; if (!t.dataset) return;
    if (t.dataset.aihset !== undefined){
      S.firm.ai = Object.assign(AIH.cfg(), {[t.dataset.aihset]: t.checked}); Store.saveFirm();
      toast(t.dataset.aihset === "on" ? (t.checked ? "AI help is on." : "AI help is off.") : "Saved."); render(); return;
    }
    if (t.dataset.aihco !== undefined){ const co = S.companies[t.dataset.aihco]; if (co){ co.aiOff = t.checked; Store.saveCompany(co); render(); } return; }
    if (!S.books) return;
    if (t.dataset.aihnotice !== undefined && t.files && t.files[0]){ const f = t.files[0]; t.value = ""; AIH.readNotice(f, t.dataset.aihnotice); return; }
    if (t.dataset.aihfix !== undefined){
      const x = AIH.st().led[t.dataset.aihfix]; if (!x) return;
      x[t.dataset.f] = t.value; x[t.dataset.f + "Ok"] = "yes"; x.okBy = AIH.who(); x.okAt = new Date().toISOString(); x.byHand = true;
      AIH.log("set by hand", t.dataset.aihfix + ": " + t.dataset.f + " " + t.value); saveBooks(); render(); return;
    }
    if (t.dataset.aihnreply !== undefined){ const n = AIH.st().notices.find(z => z.id === t.dataset.aihnreply); if (n){ n.reply = t.value; n.editedBy = AIH.who(); saveBooks(); } }
  });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-aih],[data-aihok],[data-aihno],[data-aihpay],[data-aihpayno],[data-aihpair],[data-aihpairno],[data-aihnopen],[data-aihndel],[data-aihnretry],[data-aihnredo],[data-aihncopy],[data-aihndl]");
    if (!t || !S.books) return;
    const d = t.dataset, a = AIH.st(), note = id => a.notices.find(z => z.id === id);
    if (d.aih === "review" || d.aih === "reviewAgain"){ AIH.reviewLedgers(d.aih === "reviewAgain"); return; }
    if (d.aih === "auditReview"){ S.booksTab = "ledgers"; S.lmView = "ai"; render(); AIH.reviewLedgers(false); return; }
    if (d.aih === "pair2b"){ AIH.pair2b(); return; }
    if (d.aihok !== undefined || d.aihno !== undefined){ AIH.accept(d.aihok !== undefined ? d.aihok : d.aihno, d.aihok !== undefined ? "yes" : "no"); await saveBooks(); render(); return; }
    if (d.aihpay !== undefined){ AIH.acceptPay(d.aihpay); await saveBooks(); render(); return; }
    if (d.aihpayno !== undefined){ delete a.tdsPay[d.aihpayno]; AIH.log("rejected", d.aihpayno + ": TDS ledger section"); await saveBooks(); render(); return; }
    if (d.aihpair !== undefined){
      const s = a.pairs[d.aihpair], st = GST2B.state(); if (!s) return;
      st.link[d.aihpair] = [s.id]; delete st.confirm[d.aihpair]; s.okBy = AIH.who(); s.okAt = new Date().toISOString();
      AIH.log("accepted 2B pair", s.label); await saveBooks(); render(); return;
    }
    if (d.aihpairno !== undefined){ const s = a.pairs[d.aihpairno]; if (s){ s.no = true; AIH.log("rejected 2B pair", s.label); } await saveBooks(); render(); return; }
    const n = note(d.aihnopen || d.aihndel || d.aihnretry || d.aihnredo || d.aihncopy || d.aihndl || "");
    if (!n) return;
    const file = async () => FileStore.get(CO().id, n.id, n.docPath, n.name);
    if (d.aihnopen){ const f = await file(); if (!f){ toast("The notice is not on this computer and could not be fetched."); return; } window.open(URL.createObjectURL(f), "_blank"); return; }
    if (d.aihndel){ const r = await askConfirm({title: "Remove this notice?", ok: "Remove", body: '<p class="note">The notice and its draft reply are removed from FinCom.</p>'}); if (!r || !r.ok) return; a.notices = a.notices.filter(z => z !== n); try { FileStore.drop(CO().id, n.id); } catch (x){} AIH.log("removed a notice", n.name); await saveBooks(); render(); return; }
    if (d.aihnretry){ const f = await file(); if (!f){ toast("The notice file is not here any more; add it again."); return; } a.notices = a.notices.filter(z => z !== n); AIH.readNotice(f, n.kind); return; }
    if (d.aihnredo){ n.figures = AIH.noticeFigures(n); AIH.draft(n); return; }
    if (d.aihncopy){ try { await navigator.clipboard.writeText(n.reply || ""); toast("Copied."); } catch (x){ toast("Could not copy; select the text and copy it."); } return; }
    if (d.aihndl){ saveFile("Reply " + String((n.fields || {}).form || "notice").replace(/[^\w.-]+/g, "_") + ".txt", new Blob([n.reply || ""], {type: "text/plain"})); return; }
  });
}
