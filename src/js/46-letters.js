/* ================================================================== */
/* Letters: balance confirmations for the audit, and dues reminders    */
/* to customers. Nothing is sent from here: letters are printed or     */
/* saved as PDF, or opened in the user's own email or WhatsApp.        */
/* ================================================================== */
const LTR = {
  st(){
    const cid = S.coId;
    if (!S.ltr || S.ltr.cid !== cid){
      // confirmations are asked for at the year end: the last 31 March up to the books' last day
      const a = FC.anchor(), lastFyEnd = a.slice(4) === "0331" ? a : num(Audit.fyStart(a).slice(0, 4)) + "0331";
      S.ltr = {cid, asOn: lastFyEnd, remOn: a, sides: {r: true, p: true, o: false}, min: 1, q: "", show: "all", sel: {}, credit: 30, tone: "friendly", busy: "", tally: null};
    }
    if (S.ltrMode){ S.ltr.mode = S.ltrMode; S.ltrMode = null; }
    S.ltr.mode = S.ltr.mode || "confirm";
    return S.ltr;
  },
  store(){ const b = S.books; b.letters = b.letters || {}; ["conf", "rem", "contacts"].forEach(k => { b.letters[k] = b.letters[k] || {}; }); b.letters.cfg = b.letters.cfg || {}; return b.letters; },
  cfg(){ return Object.assign({replyTo: "company", auditor: "", auditorEmail: "", days: 15, negative: false, attach: true, msme: false, udyam: "", signer: ""}, this.store().cfg); },
  contact(party){
    const b = S.books, own = (this.store().contacts || {})[party] || {}, g = String((b.gstins || {})[party] || "").toUpperCase(), gc = ((b.gstContacts || {})[g]) || {}, i = (b.ledInfo || {})[party] || {};
    return {email: own.email != null ? own.email : (gc.email || i.email || ""), phone: own.phone != null ? own.phone : (gc.phone || i.phone || i.mobile || ""), addr: own.addr != null ? own.addr : (i.addr || "")};
  },
  // ---------- balances on a date: from the books, or read from Tally
  balances(asOn){
    const x = this.st();
    if (x.tally && x.tally.asOn === asOn) return {ok: true, src: "Tally, read " + fmtDate(x.tally.at.slice(0, 10)), bal: x.tally.bal};
    const B = LK.bal(Audit.fyStart(asOn), asOn);
    if (!B.ok) return {ok: false, why: B.why};
    const at = B.at(asOn), bal = {};
    Object.keys(at).forEach(l => { bal[l] = -r2(at[l]); });
    return {ok: true, src: B.src, bal};
  },
  async readTally(asOn){
    const x = this.st();
    x.busy = "Reading every ledger’s balance from Tally…"; render();
    try { await LK.loadNames(); const r = await LK.tbTally(asOn); const bal = {}; r.rows.forEach(z => { bal[z.l] = z.bal; }); x.tally = {asOn, at: new Date().toISOString(), bal}; }
    catch (e){ toast("Could not read Tally: " + ((e && e.message) || e)); }
    x.busy = ""; render();
  },
  // which side a party is on, from Tally's groups when they have been read, else the books'
  isOther(l){ const p = FC.path(l).join("|"); return /loans \(liability\)|secured loans|unsecured loans|loans? (&|and) advances|deposits \(asset\)/i.test(p) || (!p && Audit.isLoan(l)); },
  side(l){ const p = FC.path(l).map(x => x.toLowerCase()); return p.includes("sundry debtors") ? "r" : p.includes("sundry creditors") ? "p" : this.isOther(l) ? "o" : ""; },
  // ---------- the parties to write to, with their balance
  confirmRows(){
    const x = this.st(), B = this.balances(x.asOn);
    if (!B.ok) return {B, rows: []};
    const rec = this.store().conf[x.asOn] || {}, q = x.q.toLowerCase();
    const rows = Object.keys(B.bal).map(l => ({l, side: this.side(l), bal: B.bal[l]})).filter(r => r.side && x.sides[r.side] && Math.abs(r.bal) >= Math.max(0.5, num(x.min)))
      .map(r => Object.assign(r, {gstin: (S.books.gstins || {})[r.l] || "", c: this.contact(r.l), s: rec[r.l] || {}}))
      .filter(r => !q || (r.l + " " + r.gstin).toLowerCase().includes(q))
      .filter(r => x.show === "all" || (x.show === "notsent" ? !r.s.sentAt : x.show === "waiting" ? r.s.sentAt && !r.s.reply : x.show === "differs" ? r.s.reply === "differs" : true))
      .sort((a, c) => a.side.localeCompare(c.side) || Math.abs(c.bal) - Math.abs(a.bal));
    return {B, rows};
  },
  remindRows(){
    const x = this.st(), A = MIS.ageing(x.remOn, "r"), rem = this.store().rem, q = x.q.toLowerCase(), cr = num(x.credit);
    return A.rows.map(p => {
      const over = p.bills.filter(z => z.ref && z.amt > 0 && z.age > cr), amt = r2(over.reduce((s, z) => s + z.amt, 0));
      return {l: p.party, total: p.total, over, amt, oldest: over.reduce((m, z) => Math.max(m, z.age), 0), c: this.contact(p.party), last: (rem[p.party] || [])[0] || null, gstin: (S.books.gstins || {})[p.party] || ""};
    }).filter(r => r.amt >= 1 && (!q || (r.l + " " + r.gstin).toLowerCase().includes(q))).sort((a, c) => c.amt - a.amt);
  },
  // ---------- the words
  whoWrites(){ const co = CO(); return {name: co.name, gstin: co.gstin || "", signer: this.cfg().signer}; },
  replyTo(){ const c = this.cfg(), co = CO(); return c.replyTo === "auditor" && c.auditor ? {name: c.auditor, email: c.auditorEmail} : {name: co.name, email: (this.cfg().companyEmail || "")}; },
  meaning(bal){ return bal > 0 ? "due from you to us" : "due from us to you"; },
  confirmText(r){
    const x = this.st(), c = this.cfg(), W = this.whoWrites(), R = this.replyTo(), amt = "₹" + INR.format(Math.abs(r.bal)) + (r.bal > 0 ? " Dr" : " Cr");
    return {subject: "Confirmation of balance as on " + FC.when(x.asOn) + " – " + W.name,
      body: "Dear Sir or Madam,\n\nAs per our books of account, the balance in your account as on " + FC.when(x.asOn) + " is " + amt + ", being the amount " + this.meaning(r.bal) + ".\n\n" +
        "Please confirm this balance by replying to " + (R.email ? R.name + " at " + R.email : R.name) + " within " + c.days + " days. If your books show a different balance, please send your statement of our account so that the difference can be reconciled." +
        (c.negative ? "\n\nIf we do not hear from you within " + c.days + " days, we shall take the balance as correct." : "") + "\n\nThank you.\n\nFor " + W.name + (W.signer ? "\n" + W.signer : "") + "\nAuthorised signatory"};
  },
  TONES: {
    friendly: ["A friendly reminder", "This is a friendly reminder that the bills below are past their due date. We would be grateful if you could arrange the payment at the earliest."],
    firm: ["Payment overdue", "The bills below are overdue despite our earlier reminders. Please arrange the payment within 7 days of this letter."],
    final: ["Final reminder before further action", "In spite of earlier reminders, the bills below remain unpaid. Unless the payment is received within 7 days, we shall be constrained to take such further steps as are open to us, without further notice."]
  },
  remindText(r){
    const x = this.st(), c = this.cfg(), W = this.whoWrites(), T = this.TONES[x.tone] || this.TONES.friendly;
    const lines = r.over.slice(0, 15).map(z => "  " + (z.ref || "on account") + ", dated " + FC.when(z.date) + ": ₹" + INR.format(z.amt) + " (" + z.age + " days)").join("\n") + (r.over.length > 15 ? "\n  and " + (r.over.length - 15) + " more bills" : "");
    return {subject: T[0] + ": ₹" + INR.format(r.amt) + " due – " + W.name,
      body: "Dear Sir or Madam,\n\n" + T[1] + "\n\n" + lines + "\n\nTotal overdue: ₹" + INR.format(r.amt) + "\n\n" +
        (c.msme ? "We are registered as a micro or small enterprise" + (c.udyam ? " (Udyam " + c.udyam + ")" : "") + ". Under sections 15 and 16 of the MSMED Act, 2006, payment is due within the agreed period, not more than 45 days, after which compound interest at three times the bank rate notified by the Reserve Bank applies.\n\n" : "") +
        "If you have already paid, please share the payment details so that we can match them.\n\nFor " + W.name + (W.signer ? "\n" + W.signer : "") + "\nAuthorised signatory"};
  },
  // ---------- printed letters (and PDF, through the print window)
  letterHead(){ const W = this.whoWrites(); return '<div class="lh"><div class="lhn">' + esc(W.name) + "</div>" + (W.gstin ? '<div class="lhs">GSTIN ' + esc(W.gstin) + "</div>" : "") + "</div>"; },
  toBlock(r){ return '<div class="to">To<br><b>' + esc(r.l) + "</b>" + (r.c.addr ? "<br>" + esc(r.c.addr).replace(/\n/g, "<br>") : "") + (r.gstin ? "<br>GSTIN " + esc(r.gstin) : "") + "</div>"; },
  confirmHtml(r){
    const x = this.st(), c = this.cfg(), t = this.confirmText(r), R = this.replyTo();
    let h = '<div class="page">' + this.letterHead() + '<div class="dt">Date: ' + fmtDate(new Date().toISOString().slice(0, 10)) + "</div>" + this.toBlock(r) +
      '<p class="sub">Subject: ' + esc(t.subject.split(" – ")[0]) + "</p>" + t.body.split("\n\n").slice(0, -1).map(p => "<p>" + esc(p) + "</p>").join("") +
      '<p class="sig">For ' + esc(this.whoWrites().name) + "<br><br><br>" + (this.whoWrites().signer ? esc(this.whoWrites().signer) + "<br>" : "") + "Authorised signatory</p>";
    if (c.attach){
      const st = LK.ledgerBooks(r.l, Audit.fyStart(x.asOn), x.asOn);
      if (st.rows.length && st.rows.length <= 80){
        h += '<div class="ann"><h3>Statement of your account, ' + FC.span(st.from, st.to) + '</h3><table><thead><tr><th>Date</th><th>Particulars</th><th>No.</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>' +
          (st.open != null ? "<tr><td>" + FC.when(st.from) + '</td><td>Opening balance</td><td></td><td class="n">' + (st.open > 0 ? FC.amt(st.open) : "") + '</td><td class="n">' + (st.open < 0 ? FC.amt(-st.open) : "") + "</td></tr>" : "") +
          st.rows.map(v => "<tr><td>" + FC.when(v.date) + "</td><td>" + esc(v.type) + (v.narr ? ": " + esc(v.narr.slice(0, 60)) : "") + "</td><td>" + esc(v.no || "") + '</td><td class="n">' + FC.amt(v.dr) + '</td><td class="n">' + FC.amt(v.cr) + "</td></tr>").join("") +
          '<tr><td></td><td><b>Closing balance</b></td><td></td><td class="n"><b>' + (r.bal > 0 ? FC.amt(r.bal) : "") + '</b></td><td class="n"><b>' + (r.bal < 0 ? FC.amt(-r.bal) : "") + "</b></td></tr></tbody></table></div>";
      } else if (st.rows.length) h += '<p class="small">The statement of your account for the year (' + st.rows.length + " entries) is available on request.</p>";
    }
    h += '<div class="slip"><div class="cut">✂ - - - - - - - - - - please sign and return - - - - - - - - - -</div><p><b>To: ' + esc(R.name) + "</b>" + (R.email ? " (" + esc(R.email) + ")" : "") + "</p>" +
      "<p>We confirm that the balance of our account with " + esc(this.whoWrites().name) + " as on " + FC.when(x.asOn) + " is:</p>" +
      '<p>☐ ₹' + INR.format(Math.abs(r.bal)) + " " + (r.bal > 0 ? "payable by us" : "receivable by us") + ", as stated above, correct.</p>" +
      "<p>☐ not correct. Our books show ₹ ____________________ " + (r.bal > 0 ? "payable / receivable" : "receivable / payable") + ". Our statement is enclosed.</p>" +
      '<div class="sg"><span>Signature and stamp</span><span>Name</span><span>Date</span></div><p class="small">For ' + esc(r.l) + "</p></div></div>";
    return h;
  },
  remindHtml(r){
    const t = this.remindText(r), T = this.TONES[this.st().tone] || this.TONES.friendly, c = this.cfg();
    return '<div class="page">' + this.letterHead() + '<div class="dt">Date: ' + fmtDate(new Date().toISOString().slice(0, 10)) + "</div>" + this.toBlock(r) +
      '<p class="sub">Subject: ' + esc(T[0]) + "</p><p>Dear Sir or Madam,</p><p>" + esc(T[1]) + "</p>" +
      '<table><thead><tr><th>Bill</th><th>Date</th><th class="n">Days</th><th class="n">Amount due</th></tr></thead><tbody>' +
      r.over.map(z => "<tr><td>" + esc(z.ref || "on account") + "</td><td>" + FC.when(z.date) + '</td><td class="n">' + z.age + '</td><td class="n">' + FC.amt(z.amt) + "</td></tr>").join("") +
      '<tr><td><b>Total overdue</b></td><td></td><td></td><td class="n"><b>' + FC.amt(r.amt) + "</b></td></tr></tbody></table>" +
      (c.msme ? "<p>" + esc(t.body.split("\n\n").find(p => /MSMED/.test(p)) || "") + "</p>" : "") +
      "<p>If you have already paid, please share the payment details so that we can match them.</p>" +
      '<p class="sig">For ' + esc(this.whoWrites().name) + "<br><br><br>" + (this.whoWrites().signer ? esc(this.whoWrites().signer) + "<br>" : "") + "Authorised signatory</p></div>";
  },
  STYLE: "<style>@page{size:A4 portrait;margin:16mm}body{padding:0;font:12.5px/1.55 Georgia,'Times New Roman',serif;color:#111}.page{page-break-after:always;max-width:720px;margin:0 auto}.page:last-child{page-break-after:auto}" +
    ".lh{border-bottom:2px solid #047857;padding-bottom:8px;margin-bottom:14px}.lhn{font-size:20px;font-weight:700;color:#064e3b}.lhs{font-size:11px;color:#444}.dt{text-align:right;margin-bottom:10px}.to{margin-bottom:14px}.sub{font-weight:700;text-decoration:underline}" +
    ".sig{margin-top:22px}.ann{margin-top:16px}.ann h3{font-size:13px;margin:0 0 6px}table{border-collapse:collapse;width:100%;font:11px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;margin:8px 0}th,td{border:1px solid #cfd8d3;padding:3px 6px;text-align:left}th{background:#ecfdf5}td.n,th.n{text-align:right}" +
    ".slip{margin-top:26px;border:1px dashed #777;padding:10px 14px}.cut{text-align:center;font-size:10px;color:#666;margin:-4px 0 8px}.sg{display:flex;justify-content:space-between;margin-top:34px;font-size:11px;color:#444}.sg span{border-top:1px solid #999;padding-top:3px;width:30%}.small{font-size:11px;color:#444}</style>",
  print(kind, rows){
    if (!rows.length){ toast("Tick the parties first."); return; }
    const html = rows.map(r => kind === "confirm" ? this.confirmHtml(r) : this.remindHtml(r)).join("");
    printView(CO().name + (kind === "confirm" ? " balance confirmations " + FC.when(this.st().asOn) : " payment reminders"), this.STYLE + html);
    const at = new Date().toISOString();
    rows.forEach(r => this.mark(kind, r, "printed", at));
    saveBooks(); render();
  },
  mark(kind, r, via, at){
    const s = this.store();
    if (kind === "confirm"){ const x = this.st(), m = s.conf[x.asOn] = s.conf[x.asOn] || {}; m[r.l] = Object.assign({}, m[r.l], {sentAt: at, via, bal: r.bal}); }
    else { s.rem[r.l] = [{at, via, amt: r.amt, tone: this.st().tone}].concat(s.rem[r.l] || []).slice(0, 12); }
  },
  mailto(kind, r){
    const t = kind === "confirm" ? this.confirmText(r) : this.remindText(r);
    if (!r.c.email){ toast("Type " + r.l + "’s email first."); return false; }
    let body = t.body; if (body.length > 1800) body = body.slice(0, 1800) + "\n…";
    window.open("mailto:" + encodeURIComponent(r.c.email) + "?subject=" + encodeURIComponent(t.subject) + "&body=" + encodeURIComponent(body), "_blank");
    return true;
  },
  whatsapp(kind, r){
    const ph = String(r.c.phone || "").replace(/\D/g, "");
    if (!ph){ toast("Type " + r.l + "’s phone first."); return false; }
    const t = kind === "confirm" ? this.confirmText(r) : this.remindText(r);
    window.open("https://wa.me/" + (ph.length === 10 ? "91" + ph : ph) + "?text=" + encodeURIComponent(t.subject + "\n\n" + t.body.slice(0, 1500)), "_blank");
    return true;
  },
  // ---------- the page
  view(b){
    const x = this.st(), have = (b.vouchers || []).length > 0, live = typeof bridgeLive === "function" && bridgeLive(CO());
    let h = '<section class="dash-card"><div class="rpt-top-row"><div><h3>Confirmations and reminders</h3><p class="note" style="margin:0">Letters are printed or saved as PDF, or opened in your own email or WhatsApp to send. Nothing is sent from FinCom.</p></div></div>' +
      '<div class="lk-kinds" role="tablist" aria-label="Letters"><button role="tab" data-ltrmode="confirm" aria-selected="' + (x.mode === "confirm") + '">Balance confirmations</button><button role="tab" data-ltrmode="remind" aria-selected="' + (x.mode === "remind") + '">Dues reminders</button><button role="tab" data-ltrmode="settings" aria-selected="' + (x.mode === "settings") + '">Letter settings</button></div></section>';
    if (!have && x.mode !== "settings") return h + FC.noBooks("Letters");
    if (x.busy) h += busyCard("Reading Tally…", x.busy, 0, 0);
    if (live) setTimeout(() => LK.autoFresh(), 0);
    if (LK.fr().busy) h += busyCard("Bringing the books up to date\u2026", LK.fr().busy, 0, 0);
    if (x.mode === "settings") return h + this.viewSettings();
    return h + (x.mode === "confirm" ? this.viewConfirm(live) : this.viewRemind());
  },
  contactCells(r){
    return '<td><input type="email" class="ltr-in" data-ltrc="' + esc(r.l) + '|email" value="' + esc(r.c.email) + '" placeholder="email" aria-label="' + esc(r.l) + ' email"></td>' +
      '<td><input type="tel" class="ltr-in sm" data-ltrc="' + esc(r.l) + '|phone" value="' + esc(r.c.phone) + '" placeholder="phone" aria-label="' + esc(r.l) + ' phone"></td>';
  },
  viewConfirm(live){
    const x = this.st(), {B, rows} = this.confirmRows(), c = this.cfg();
    let h = '<section class="dash-card" style="margin-top:12px"><div class="lk-form">' +
      '<label class="f"><span>Balance as on</span><input type="date" data-ltrf="asOn" value="' + FC.iso(x.asOn) + '"></label>' +
      '<div class="f"><span>Write to</span><div class="row" style="gap:12px">' + [["r", "Customers"], ["p", "Suppliers"], ["o", "Loans and advances"]].map(([k, l]) => '<label class="chk"><input type="checkbox" data-ltrside="' + k + '"' + (x.sides[k] ? " checked" : "") + "> " + l + "</label>").join("") + "</div></div>" +
      '<label class="f"><span>Balances of at least</span><input type="text" inputmode="decimal" data-ltrf="min" value="' + esc(x.min) + '"></label>' +
      '<label class="f"><span>Show</span><select data-ltrf="show">' + [["all", "Every party"], ["notsent", "Not sent yet"], ["waiting", "Sent, no reply yet"], ["differs", "Replied with a difference"]].map(([v, l]) => '<option value="' + v + '"' + (x.show === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
      '<label class="f lk-wide"><span>Find</span><input type="search" data-fk="ltrQ" data-ltrf="q" data-keeptyped value="' + esc(x.q) + '" placeholder="party or GSTIN"></label></div>' +
      '<p class="note" style="margin:8px 0 0">Replies go to <b>' + esc(this.replyTo().name) + "</b>" + (c.replyTo === "auditor" ? " (the auditor)" : "") + ". " + (c.attach ? "Each letter carries the party’s statement of account for the year." : "") + ' <button class="linkbtn" data-ltrmode="settings">Change</button></p></section>';
    if (!B.ok) return h + '<div class="fc-empty"><h3>The balances on ' + FC.when(x.asOn) + ' are not in FinCom\u2019s copy of the books yet</h3><p class="note">' + esc(B.why || "") + '.</p>' + LK.freshBar(S.books) + "</div>";
    const rec = this.store().conf[x.asOn] || {}, all = Object.values(rec), sent = all.filter(s => s.sentAt).length, agreed = all.filter(s => s.reply === "agreed").length, diff = all.filter(s => s.reply === "differs").length;
    const picked = rows.filter(r => x.sel[r.l]);
    h += '<div class="dash-tiles" style="margin-top:12px"><div class="dtile"><span>Parties</span><b>' + rows.length + "</b><small>" + esc(B.src) + '</small></div><div class="dtile"><span>Sent</span><b>' + sent + '</b><small>for this date</small></div><div class="dtile"><span>Agreed</span><b>' + agreed + '</b><small>confirmed by the party</small></div><div class="dtile' + (diff ? " warn" : "") + '"><span>Differences</span><b>' + diff + "</b><small>to reconcile</small></div></div>";
    if (!rows.length) return h + '<div class="bk-none">No party with a balance matches. Change the choices above.</div>';
    h += '<div class="row ltr-bar"><button class="btn primary" data-ltr="print"' + (picked.length ? "" : " disabled") + ">Print or PDF the letters (" + picked.length + ")</button>" +
      '<button class="btn" data-ltr="selall">' + (picked.length === rows.length ? "Untick all" : "Tick all " + rows.length) + '</button><button class="btn" data-ltr="excel">Excel of the list</button></div>';
    h += '<div class="bk-tablewrap"><table class="bk-table lk-t ltr-t"><thead><tr><th class="ck"></th><th>Party</th><th class="n">Balance</th><th>Email</th><th>Phone</th><th>Sent</th><th>Reply</th><th class="ac"></th></tr></thead><tbody>' +
      rows.map(r => '<tr><td class="ck"><input type="checkbox" data-ltrsel="' + esc(r.l) + '"' + (x.sel[r.l] ? " checked" : "") + ' aria-label="Tick ' + esc(r.l) + '"></td><td><button class="linkbtn strong" data-lkled="' + esc(r.l) + '">' + esc(r.l) + '</button><span class="nr">' + ({r: "customer", p: "supplier", o: "loan or advance"}[r.side]) + (r.gstin ? " · " + esc(r.gstin) : "") + "</span></td>" +
        '<td class="n">' + FC.drcr(r.bal) + "</td>" + this.contactCells(r) +
        "<td>" + (r.s.sentAt ? fmtDate(r.s.sentAt.slice(0, 10)) + '<span class="nr">' + esc(r.s.via || "") + "</span>" : '<span class="note">not yet</span>') + "</td>" +
        '<td><select class="ltr-in sm" data-ltrreply="' + esc(r.l) + '">' + [["", "—"], ["agreed", "Agreed"], ["differs", "Differs"], ["none", "No reply"]].map(([v, l]) => '<option value="' + v + '"' + ((r.s.reply || "") === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
        (r.s.reply === "differs" ? '<input type="text" class="ltr-in sm" inputmode="decimal" data-ltrtheir="' + esc(r.l) + '" value="' + esc(r.s.their || "") + '" placeholder="their figure" aria-label="Their balance">' + (num(r.s.their) ? '<span class="nr bad">difference ' + INR.format(Math.abs(r2(Math.abs(r.bal) - num(r.s.their)))) + "</span>" : "") : "") + "</td>" +
        '<td class="ac"><button class="btn small" data-ltrone="confirm|print|' + esc(r.l) + '">Letter</button><button class="btn small" data-ltrone="confirm|mail|' + esc(r.l) + '" title="Opens your email with the letter written">Email</button><button class="btn small" data-ltrone="confirm|wa|' + esc(r.l) + '">WhatsApp</button></td></tr>').join("") +
      "</tbody></table></div>";
    return h;
  },
  viewRemind(){
    const x = this.st(), rows = this.remindRows(), c = this.cfg(), picked = rows.filter(r => x.sel["rem|" + r.l]);
    let h = '<section class="dash-card" style="margin-top:12px"><div class="lk-form">' +
      '<label class="f"><span>Bills due as on</span><input type="date" data-ltrf="remOn" value="' + FC.iso(x.remOn) + '"></label>' +
      '<label class="f"><span>Credit allowed</span><select data-ltrf="credit">' + [0, 15, 30, 45, 60, 90].map(d => '<option value="' + d + '"' + (num(x.credit) === d ? " selected" : "") + ">" + (d ? d + " days" : "none") + "</option>").join("") + "</select></label>" +
      '<label class="f"><span>Tone</span><select data-ltrf="tone">' + [["friendly", "Friendly"], ["firm", "Firm"], ["final", "Final reminder"]].map(([v, l]) => '<option value="' + v + '"' + (x.tone === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
      '<label class="f lk-wide"><span>Find</span><input type="search" data-fk="ltrQ2" data-ltrf="q" data-keeptyped value="' + esc(x.q) + '" placeholder="customer or GSTIN"></label></div>' +
      '<label class="chk" style="margin-top:8px"><input type="checkbox" data-ltrcfg="msme"' + (c.msme ? " checked" : "") + "> The client is a micro or small enterprise: mention the MSMED Act interest</label></section>";
    const tot = rows.reduce((s, r) => s + r.amt, 0);
    h += '<div class="dash-tiles" style="margin-top:12px"><div class="dtile warn"><span>Overdue</span><b>' + INR0.format(tot) + "</b><small>past " + num(x.credit) + ' days</small></div><div class="dtile"><span>Customers</span><b>' + rows.length + '</b><small>with bills overdue</small></div><div class="dtile"><span>Over 90 days</span><b>' + INR0.format(rows.reduce((s, r) => s + r.over.filter(z => z.age > 90).reduce((a, z) => a + z.amt, 0), 0)) + '</b><small>the oldest</small></div><div class="dtile"><span>Reminded</span><b>' + rows.filter(r => r.last).length + "</b><small>at least once</small></div></div>";
    if (!rows.length) return h + '<div class="fc-empty"><h3>Nothing overdue</h3><p class="note">No customer has a bill older than ' + num(x.credit) + " days on " + FC.when(x.remOn) + ". Bills are read from the bill-wise details in Tally.</p></div>";
    h += '<div class="row ltr-bar"><button class="btn primary" data-ltr="rprint"' + (picked.length ? "" : " disabled") + ">Print or PDF the reminders (" + picked.length + ")</button>" +
      '<button class="btn" data-ltr="rselall">' + (picked.length === rows.length ? "Untick all" : "Tick all " + rows.length) + "</button></div>";
    h += '<div class="bk-tablewrap"><table class="bk-table lk-t ltr-t"><thead><tr><th class="ck"></th><th>Customer</th><th class="n">Overdue</th><th class="n">Oldest</th><th>Email</th><th>Phone</th><th>Last reminder</th><th class="ac"></th></tr></thead><tbody>' +
      rows.map(r => '<tr><td class="ck"><input type="checkbox" data-ltrsel="rem|' + esc(r.l) + '"' + (x.sel["rem|" + r.l] ? " checked" : "") + ' aria-label="Tick ' + esc(r.l) + '"></td><td><button class="linkbtn strong" data-lkled="' + esc(r.l) + '">' + esc(r.l) + '</button><span class="nr">' + r.over.length + " bill" + (r.over.length === 1 ? "" : "s") + " · owes " + INR.format(r.total) + " in all</span></td>" +
        '<td class="n">' + INR.format(r.amt) + '</td><td class="n' + (r.oldest > 90 ? " bad" : "") + '">' + r.oldest + " days</td>" + this.contactCells(r) +
        "<td>" + (r.last ? fmtDate(r.last.at.slice(0, 10)) + '<span class="nr">' + esc(r.last.via) + ", " + esc(r.last.tone || "") + "</span>" : '<span class="note">never</span>') + "</td>" +
        '<td class="ac"><button class="btn small" data-ltrone="remind|print|' + esc(r.l) + '">Letter</button><button class="btn small" data-ltrone="remind|mail|' + esc(r.l) + '">Email</button><button class="btn small" data-ltrone="remind|wa|' + esc(r.l) + '">WhatsApp</button></td></tr>').join("") +
      "</tbody></table></div>";
    return h;
  },
  viewSettings(){
    const c = this.cfg(), inp = (k, l, ph, t) => '<label class="f"><span>' + l + '</span><input type="' + (t || "text") + '" data-ltrcfg="' + k + '" value="' + esc(c[k] || "") + '" placeholder="' + esc(ph || "") + '"></label>';
    return '<section class="dash-card" style="margin-top:12px"><h3>Who the letters are from, and where replies go</h3><div class="lk-form">' +
      inp("signer", "Signed by (name and designation)", "Rakesh Mehra, Director") + inp("companyEmail", "The client’s email for replies", "accounts@client.in", "email") +
      '<label class="f"><span>Replies go to</span><select data-ltrcfg="replyTo"><option value="company"' + (c.replyTo !== "auditor" ? " selected" : "") + '>The client</option><option value="auditor"' + (c.replyTo === "auditor" ? " selected" : "") + ">The auditor, directly</option></select></label>" +
      inp("auditor", "Auditor’s name", "Mehra & Iyer, Chartered Accountants") + inp("auditorEmail", "Auditor’s email", "audit@firm.in", "email") +
      '<label class="f"><span>Days to reply</span><input type="text" inputmode="numeric" data-ltrcfg="days" value="' + esc(c.days) + '"></label>' + inp("udyam", "Udyam number (for reminders)", "UDYAM-UP-00-0000000") + "</div>" +
      '<div class="stack" style="gap:6px;margin-top:10px"><label class="chk"><input type="checkbox" data-ltrcfg="attach"' + (c.attach ? " checked" : "") + "> Put the party’s statement of account for the year under each confirmation</label>" +
      '<label class="chk"><input type="checkbox" data-ltrcfg="negative"' + (c.negative ? " checked" : "") + "> Say that no reply means the balance is taken as correct (a negative confirmation; the auditor decides whether that is enough)</label>" +
      '<label class="chk"><input type="checkbox" data-ltrcfg="msme"' + (c.msme ? " checked" : "") + "> The client is a micro or small enterprise: mention the MSMED Act interest in reminders</label></div>" +
      '<p class="note" style="margin-top:10px">For an audit, confirmations are best sent by the auditor with replies coming straight back to the auditor (SA 505). Choose “The auditor, directly” for that.</p></section>';
  },
  byName(kind, l){ return (kind === "confirm" ? this.confirmRows().rows : this.remindRows()).find(r => r.l === l); }
};
function viewBooksLetters(b){ return LTR.view(b); }
if (typeof document !== "undefined"){
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-ltr],[data-ltrmode],[data-ltrone]"); if (!t || !S.books) return;
    const x = LTR.st();
    if (t.dataset.ltrmode){ x.mode = t.dataset.ltrmode; x.q = ""; render(); return; }
    if (t.dataset.ltrone){
      const [kind, how, l] = t.dataset.ltrone.split("|"), r = LTR.byName(kind, l); if (!r) return;
      if (how === "print"){ LTR.print(kind, [r]); return; }
      const ok = how === "mail" ? LTR.mailto(kind, r) : LTR.whatsapp(kind, r);
      if (ok){ LTR.mark(kind, r, how === "mail" ? "email" : "WhatsApp", new Date().toISOString()); saveBooks(); render(); }
      return;
    }
    const a = t.dataset.ltr;
    if (a === "print") LTR.print("confirm", LTR.confirmRows().rows.filter(r => x.sel[r.l]));
    else if (a === "rprint") LTR.print("remind", LTR.remindRows().filter(r => x.sel["rem|" + r.l]));
    else if (a === "selall" || a === "rselall"){
      const rows = a === "selall" ? LTR.confirmRows().rows : LTR.remindRows(), key = r => (a === "selall" ? "" : "rem|") + r.l, all = rows.every(r => x.sel[key(r)]);
      rows.forEach(r => { x.sel[key(r)] = !all; }); render();
    }
    else if (a === "excel"){
      const rows = LTR.confirmRows().rows;
      FC.excel("balance-confirmations-" + FC.iso(x.asOn), [["Confirmations", [["Party", "Kind", "GSTIN", "Balance", "Dr or Cr", "Email", "Phone", "Sent on", "Sent by", "Reply", "Their figure", "Difference"]].concat(rows.map(r => [r.l, {r: "Customer", p: "Supplier", o: "Loan or advance"}[r.side], r.gstin, Math.abs(r.bal), r.bal > 0 ? "Dr" : "Cr", r.c.email, r.c.phone, r.s.sentAt ? r.s.sentAt.slice(0, 10) : "", r.s.via || "", r.s.reply || "", r.s.their || "", r.s.their ? r2(Math.abs(r.bal) - num(r.s.their)) : ""]))]])
        .catch(er => toast("Could not build the file: " + (er && er.message)));
    }
  });
  document.addEventListener("input", e => {
    const t = e.target; if (!t.dataset || !S.books || !S.ltr) return;
    if (t.dataset.ltrf === "q"){ S.ltr.q = t.value; softRender(); return; }
    if (t.dataset.ltrc){ const [l, k] = t.dataset.ltrc.split("|"), s = LTR.store(); s.contacts[l] = Object.assign({}, s.contacts[l], {[k]: t.value.trim()}); later("ltrc", saveBooks, 800); return; }
    if (t.dataset.ltrtheir){ const s = LTR.store(), m = s.conf[S.ltr.asOn] = s.conf[S.ltr.asOn] || {}; m[t.dataset.ltrtheir] = Object.assign({}, m[t.dataset.ltrtheir], {their: t.value}); later("ltrt", () => { saveBooks(); render(); }, 900); return; }
    if (t.dataset.ltrcfg && t.type !== "checkbox" && t.tagName !== "SELECT"){ LTR.store().cfg[t.dataset.ltrcfg] = t.value; later("ltrcfg", saveBooks, 800); }
  });
  document.addEventListener("change", e => {
    const t = e.target; if (!t.dataset || !S.books || !S.ltr) return;
    const x = S.ltr;
    if (t.dataset.ltrf && t.dataset.ltrf !== "q"){ x[t.dataset.ltrf] = t.type === "date" ? FC.d8(t.value) : t.value; if (t.dataset.ltrf === "asOn") x.sel = {}; render(); return; }
    if (t.dataset.ltrside){ x.sides[t.dataset.ltrside] = t.checked; render(); return; }
    if (t.dataset.ltrsel !== undefined){ x.sel[t.dataset.ltrsel] = t.checked; render(); return; }
    if (t.dataset.ltrreply){ const s = LTR.store(), m = s.conf[x.asOn] = s.conf[x.asOn] || {}; m[t.dataset.ltrreply] = Object.assign({}, m[t.dataset.ltrreply], {reply: t.value, replyAt: new Date().toISOString()}); saveBooks(); render(); return; }
    if (t.dataset.ltrcfg && (t.type === "checkbox" || t.tagName === "SELECT")){ LTR.store().cfg[t.dataset.ltrcfg] = t.type === "checkbox" ? t.checked : t.value; saveBooks(); render(); }
  });
}
