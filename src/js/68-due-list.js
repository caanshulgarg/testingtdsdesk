/* ================================================================== */
/* One due list across all clients (TDS/GST round 2, item 1, X1):     */
/* every GST and TDS return and TDS payment due, overdue or filed     */
/* ================================================================== */
// Shown on the firm's Today page (app/src/parts/DueList.jsx). Nothing here works out a figure of its own: each client's
// list comes from the same code its TDS and GST pages use, run on that client's books as kept on this computer
// (Books.load: the copy every opened client keeps in this browser, brought up to date from the firm's server by the
// usual sync when the firm is signed in):
//   GST   GSTV.expected (the returns a GSTIN files in a year by its filing type, with GSTF.due's due dates); filed from the
//         portal's return status (GSTX.portal, RETTRACK), the ARN date of a filed return's PDF (GSTV.copies) or the date
//         typed on the GST pages (GSTV.filedOn);
//   TDS   a return for each form and quarter that has deductions (TDS.formRows, the salary sheet for 24Q), due on
//         TDS.returnDue; filed when marked on its File tab or under Settings › Closed periods (TDSFiled.get); the late fee
//         is TDS.lateFee's;
//   TDS payments  each month's deductions (every form) against the challans they are tagged to; due on TDS.dueDate (the
//         7th, 30 April for March).
// A GST month is listed from the first month FinCom knows of for that GSTIN (the day book, a filing date, a return on
// file or a 2B), so a client added today is not shown a year of returns "overdue"; with nothing known only what falls
// due from today is listed. An IFF and a PMT-06 are optional: listed when on record or still to come, never overdue.
const DueList = {
  BACK: 365, AHEAD: 45,
  // today in India, yyyy-mm-dd (a test may set window.__dueToday)
  today(){ return (typeof window === "object" && window.__dueToday) || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); },
  iso(d){ const t = String(d || "").replace(/[^0-9]/g, ""); return t.length >= 8 ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) : ""; },
  days(a, b){ return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); },
  addDays(d, n){ return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10); },
  fyOfIso(d){ return TDS.fyOf(d.replace(/-/g, "")); },
  fysBetween(a, b){ const out = []; let y = num(this.fyOfIso(a).slice(0, 4)); const e = num(this.fyOfIso(b).slice(0, 4)); for (; y <= e; y++) out.push(y + "-" + String(y + 1).slice(2)); return out; },
  // a client's books in place of the open one while fn runs (synchronously): every TDS and GST helper reads S.books and
  // CO(); their caches are kept per books object, so nothing of one client is seen in another's
  withBooks(cid, b, fn){
    const sb = S.books, sc = S.coId;
    S.books = b; S.coId = cid;
    try { return memoScope(fn); } finally { S.books = sb; S.coId = sc; }
  },
  // the status of an item from its due date and the date it was filed or paid
  state(due, on, today){
    if (on) { const late = Math.max(0, this.days(due, on)); return {status: "filed", late}; }
    const d = this.days(today, due);
    return d < 0 ? {status: "overdue", late: -d} : {status: "due", left: d};
  },
  // the first month FinCom knows of for a GSTIN: the day book, a filing date, a return on file, a 2B
  gstStart(b, reg){
    const ms = [];
    (b.vouchers || []).forEach(v => { const m = String(v.date || "").slice(0, 6); if (/^\d{6}$/.test(m)) ms.push(m); });
    Object.keys(((b.gstFiled || {})[reg]) || {}).forEach(m => { if (/^\d{6}$/.test(m)) ms.push(m); });
    Object.keys(b.portalFiled || {}).forEach(k => { const p = k.split("|"); if (p[0] === reg && /^\d{6}$/.test(p[2] || "")) ms.push(p[2]); });
    (b.gstVault || []).forEach(x => { if (x && !x.removed && x.reg === reg && /^\d{6}$/.test(x.per || "")) ms.push(x.per); });
    Object.values(b.twoBs || {}).forEach(t => { if (t && String(t.gstin || "").slice(0, 2) === reg && /^\d{6}$/.test(t.ym || "")) ms.push(t.ym); });
    return ms.sort()[0] || "";
  },
  // every item of one client (call inside withBooks)
  items(co, b, today){
    today = today || this.today();
    const from = this.addDays(today, -this.BACK), until = this.addDays(today, this.AHEAD), out = [];
    const keep = (x) => {
      if (!x.due || x.due > until) return;
      const st = this.state(x.due, x.on, today);
      // filed or paid long ago: not listed; not filed and fallen due before the window: still listed (it is overdue)
      if (st.status === "filed" && x.due < from) return;
      if (x.optional && st.status === "overdue") return;
      out.push(Object.assign({cid: co.id, client: co.name}, x, st));
    };
    const fys = this.fysBetween(from, until);
    // ---- GST
    (GSTR.gstins(b) || []).forEach(g => {
      const reg = g.slice(0, 2), start = this.gstStart(b, reg);
      fys.forEach(fy => GSTV.expected(fy, reg).forEach(r => {
        if (!["r1", "iff", "r3b", "cmp08", "pmt06", "gstr4", "gstr9"].includes(r.form)) return;
        const annual = GSTV.isAnnual(r.form), month = annual ? (num(fy.slice(0, 4)) + 1) + "03" : r.per;
        // before FinCom knows of the GSTIN: only what is still to come
        if ((!start || month < start) && r.due < today) return;
        const portal = GSTX.portal(reg, r.form, r.per), rec = GSTV.copies(reg, r.form, r.per)[0];
        const on = this.iso((portal && portal.dof) || (rec && rec.arnDate) || GSTV.filedOn(reg, r.form, r.per) || (r.form === "pmt06" && rec ? rec.at : ""));
        const pay = r.form === "pmt06";
        keep({kind: pay ? "gstpay" : "gst", tax: "GST", what: GSTV.label(r.form), per: GSTV.perLabel(r.form, r.per, reg), gstin: g, due: r.due, on,
          optional: !!r.optional || r.form === "iff", source: portal ? "portal" : rec ? "pdf" : on ? "typed" : "",
          go: {tab: "gst", reg, ym: month, part: {r1: "r1", iff: "r1", r3b: "r3b", cmp08: "cmp08", pmt06: "qtr", gstr4: "gstr4", gstr9: "g9"}[r.form]}});
      }));
    });
    // ---- TDS returns
    const tan = String(co.tan || "").toUpperCase();
    ["26Q", "27Q", "27EQ", "24Q"].forEach(form => {
      const all = TDS.formRows(form);
      fys.forEach(fy => ["Q1", "Q2", "Q3", "Q4"].forEach(q => {
        const rows = all.filter(r => r.fy === fy && r.q === q);
        const sal = form === "24Q" && typeof TDS24Q === "object" ? TDS24Q.annexI(fy, q) : [];
        const f = TDSFiled.get(fy, q, form);
        if (!rows.length && !sal.length && !(f && f.from === "return")) return;
        const due = this.iso(TDS.returnDue(fy, q, form)), on = f ? this.iso(f.on) : "";
        const lf = rows.length || sal.length ? TDS.lateFee(fy, q, on || this.iso(today).replace(/-/g, ""), form) : null;
        keep({kind: "tds", tax: "TDS", what: TDS.formShort(form, fy), form, per: q + " " + fy, fy, q, tan, due, on, source: f ? f.from : "",
          tds: r2(rows.reduce((a, r) => a + r.tds, 0) + sal.reduce((a, e) => a + num(e.tds), 0)),
          fee: lf && lf.days > 0 ? lf.fee : 0, go: {tab: "tds", fy, q, form, sub: "file"}});
      }));
    });
    // ---- TDS payments: each month's deductions against the challans they are tagged to
    const rows = TDS.rows().concat(TDS.nrRows(), TDS.tcsRows(), TDS.salaryRows()), ch = {}, byM = {};
    TDS.challans().forEach(c => { ch[c.id] = c; });
    rows.forEach(r => { const m = TDS.ymd(r.date).slice(0, 6); if (m.length === 6) (byM[m] = byM[m] || []).push(r); });
    Object.keys(byM).sort().forEach(m => {
      const list = byM[m], due = this.iso(TDS.dueDate(m + "01"));
      const unpaid = r2(list.filter(r => !ch[r.challan]).reduce((a, r) => a + r.tds, 0)), total = r2(list.reduce((a, r) => a + r.tds, 0));
      if (!(total > 0)) return;
      const paidOn = unpaid >= 1 ? "" : list.map(r => this.iso((ch[r.challan] || {}).date)).filter(Boolean).sort().pop() || "";
      const fy = TDS.fyOf(m + "01"), q = TDS.qOf(m + "01");
      keep({kind: "tdspay", tax: "TDS", what: "TDS and TCS deposit", per: GSTR.label(m), fy, q, due, on: paidOn, tds: total, unpaid: unpaid >= 1 ? unpaid : 0,
        go: {tab: "tds", fy, q, form: "26Q", sub: "challans"}});
    });
    return out;
  },
  // ---- every client: the open one from S.books, the others from their copy on this computer
  cache: {},          // cid -> {key, items}
  keyOf(b){ return b ? [b.cid, (b.vouchers || []).length, b.mapV || 0, fpHash(JSON.stringify([b.gstFiled, b.portalFiled, b.tdsFiled, b.challans, b.alloc, b.gstSet, b.gstRegs, (b.gstVault || []).length, (b.salary || []).length])), this.today()].join("|") : ""; },
  forClient(co, b){
    const k = this.keyOf(b), c = this.cache[co.id];
    if (c && c.key === k && c.b === b) return c.items;
    const items = this.withBooks(co.id, b, () => this.items(co, b));
    this.cache[co.id] = {key: k, b, items};
    return items;
  },
  // {items, missing: [clients with no copy here], at}
  async all(){
    const cos = Object.values(S.companies || {}).filter(c => c && !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
    const items = [], missing = [];
    for (const co of cos){
      let b = S.books && S.books.cid === co.id && !S.books.loading ? S.books : null;
      if (!b) b = await Books.load(co.id);
      if (!b || b.cid !== co.id){ missing.push(co); continue; }
      try { this.forClient(co, b).forEach(x => items.push(x)); } catch (e){ missing.push(co); }
    }
    items.sort((a, c) => a.due.localeCompare(c.due) || a.client.localeCompare(c.client) || a.what.localeCompare(c.what));
    return {items, missing, at: Date.now()};
  },
  // the firm signed in: each client's work (filed marks, challans, settings) brought from the server into this computer's
  // copy, as opening the client does (BookItems.pull / BookSync.pull); once a session
  synced: false,
  async syncAll(){
    if (this.synced) return false;
    this.synced = true;
    const on = typeof BookItems === "object" && BookItems.on() ? BookItems : typeof BookSync === "object" && BookSync.on() ? BookSync : null;
    if (!on) return false;
    for (const co of Object.values(S.companies || {}).filter(c => c && !c.deleted)){
      if (S.books && S.books.cid === co.id) continue;
      try { await on.pull(co.id); } catch (e){}
    }
    return true;
  },
  // one click into the client's return (or the challans of the quarter)
  async open(x){
    if (!x || !S.companies[x.cid]) return;
    await openCompany(x.cid);
    S.tab = "books"; S.step = null; const g = x.go || {};
    try { await openBooks(x.cid); } catch (e){}
    if (S.coId !== x.cid) return;
    if (g.tab === "gst"){
      // without a day book the GST tab has only 2B and the returns filed: the return's filing is under Returns filed
      const noBooks = !(S.books && S.books.cid === x.cid && (S.books.vouchers || []).length);
      S.booksTab = "gst"; S.gstReg = g.reg; S.gstYm = g.ym; S.gstPart = noBooks ? "vault" : g.part; S.gstView = "return"; S.gstSub = ""; S.gstSeen = "";
      if (S.books && S.books.cid === x.cid) S.books.reco = null;
    } else {
      S.booksTab = "tds"; S.tdsFy = g.fy; S.tdsQ = g.q; S.tdsForm = g.form; S.tdsPickForm = g.form; S.tdsView = "return"; S.tdsTab = g.sub || ""; S.tdsOpen = ""; S.chOpen = "";
    }
    render(); window.scrollTo(0, 0);
  },
  // the words of an item's status
  words(x){
    const paid = x.kind === "tdspay" || x.kind === "gstpay";
    if (x.status === "filed") return (paid ? "Paid " : "Filed ") + fmtDate(x.on) + (x.late ? ", " + x.late + " day" + (x.late === 1 ? "" : "s") + " late" : "");
    if (x.status === "overdue") return "Overdue " + x.late + " day" + (x.late === 1 ? "" : "s");
    return x.left === 0 ? "Due today" : "Due in " + x.left + " day" + (x.left === 1 ? "" : "s");
  }
};
