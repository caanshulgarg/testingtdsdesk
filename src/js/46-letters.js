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
    if (x.tally && x.tally.asOn === asOn) return {ok: true, src: (x.tally.cloud ? "the books in the cloud, " : "Tally, read ") + fmtDate(x.tally.at.slice(0, 10)), bal: x.tally.bal};
    const B = LK.bal(Audit.fyStart(asOn), asOn);
    if (!B.ok) return {ok: false, why: B.why};
    const at = B.at(asOn), bal = {};
    Object.keys(at).forEach(l => { bal[l] = -r2(at[l]); });
    return {ok: true, src: B.src, bal};
  },
  async readTally(asOn){
    const x = this.st();
    // build 194: from the books in the cloud when there are any (worked out there in a moment); Tally only without them
    const cloud = typeof TCloud === "object" && TCloud.on() && TCloud.has(S.coId);
    x.busy = cloud ? "Working out every ledger\u2019s balance\u2026" : "Reading every ledger\u2019s balance from Tally\u2026"; render();
    try { const r = cloud ? await TCloud.tb(S.coId, asOn) : (await LK.loadNames(), await LK.tbTally(asOn)); const bal = {}; r.rows.forEach(z => { bal[z.l] = z.bal; }); x.tally = {asOn, at: new Date().toISOString(), bal, cloud}; }
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
  byName(kind, l){ return (kind === "confirm" ? this.confirmRows().rows : this.remindRows()).find(r => r.l === l); }
};
// Letters (app/src/screens/books/Letters.jsx): what its buttons, ticks and boxes do
function ltrMode(m){ const x = LTR.st(); x.mode = m; x.q = ""; render(); }
function ltrSet(k, v, isDate){ const x = LTR.st(); x[k] = isDate ? FC.d8(v) : v; if (k === "asOn") x.sel = {}; render(); }
function ltrQ(v){ LTR.st().q = v; FinComReact.redraw(); }
function ltrSide(k, on){ LTR.st().sides[k] = on; render(); }
function ltrSel(key, on){ LTR.st().sel[key] = on; render(); }
function ltrOne(kind, how, l){
  const r = LTR.byName(kind, l); if (!r) return;
  if (how === "print"){ LTR.print(kind, [r]); return; }
  const ok = how === "mail" ? LTR.mailto(kind, r) : LTR.whatsapp(kind, r);
  if (ok){ LTR.mark(kind, r, how === "mail" ? "email" : "WhatsApp", new Date().toISOString()); saveBooks(); render(); }
}
function ltrAct(a){
  const x = LTR.st();
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
}
// typed: kept a moment after the typing stops
function ltrContact(l, k, v){ const s = LTR.store(); s.contacts[l] = Object.assign({}, s.contacts[l], {[k]: v.trim()}); later("ltrc", saveBooks, 800); }
function ltrTheir(l, v){ const s = LTR.store(), asOn = LTR.st().asOn, m = s.conf[asOn] = s.conf[asOn] || {}; m[l] = Object.assign({}, m[l], {their: v}); later("ltrt", () => { saveBooks(); render(); }, 900); }
function ltrCfgType(k, v){ LTR.store().cfg[k] = v; later("ltrcfg", saveBooks, 800); }
// chosen: kept and shown at once
function ltrReply(l, v){ const s = LTR.store(), asOn = LTR.st().asOn, m = s.conf[asOn] = s.conf[asOn] || {}; m[l] = Object.assign({}, m[l], {reply: v, replyAt: new Date().toISOString()}); saveBooks(); render(); }
function ltrCfg(k, v){ LTR.store().cfg[k] = v; saveBooks(); render(); }
