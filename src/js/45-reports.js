/* ================================================================== */
/* Reports: every report in one place, by area, each area opening with */
/* a few figures and a small chart for the year                        */
/* ================================================================== */
const RPT = {
  AREAS: [
    {id: "overview", title: "How the business is doing", ic: "c1"},
    {id: "parties", title: "Customers and suppliers", ic: "c3"},
    {id: "cash", title: "Bank and cash", ic: "c2"},
    {id: "gst", title: "GST", ic: "c4"},
    {id: "tds", title: "TDS", ic: "c5"},
    {id: "audit", title: "Audit and accounts", ic: "c6"}
  ],
  // every report: [id, area, name, what it shows, where it opens]
  LIST: [
    ["mis-summary", "overview", "MIS summary", "Sales, profit, cash, who owes whom and the tax due next", {mis: "summary"}],
    ["mis-pl", "overview", "Profit and loss, month by month", "Every income and expense head by month, open to the vouchers", {mis: "pl"}],
    ["mis-cash", "overview", "Cash flow and 13-week forecast", "Money in and out, and the weeks ahead", {mis: "cash"}],
    ["mis-ratios", "overview", "Ratios", "Margins, returns, liquidity and working capital days", {mis: "ratios"}],
    ["mis-budget", "overview", "Budget against actual", "Each head against the budget for the year", {mis: "budget"}],
    ["mis-cc", "overview", "Cost centres", "Income and costs by cost centre", {mis: "cc"}],
    ["mis-pack", "overview", "MIS pack (PDF)", "The whole MIS for the year, ready to send", {act: "misPack"}],
    ["mis-recv", "parties", "Receivables ageing", "What each customer owes, by age, bill by bill", {mis: "recv"}],
    ["mis-pay", "parties", "Payables ageing", "What is owed to each supplier, with MSME dues past 45 days", {mis: "pay"}],
    ["let-confirm", "parties", "Balance confirmations", "Letters asking parties to confirm their balance, for the audit", {letters: "confirm"}],
    ["let-remind", "parties", "Dues reminders", "Reminders to customers with bills past their days", {letters: "remind"}],
    ["lk-bills-r", "parties", "Open bills of customers", "Every unpaid bill on a date", {lk: {kind: "bills", led: "", side: "r"}}],
    ["lk-bills-p", "parties", "Open bills of suppliers", "Every bill still to pay on a date", {lk: {kind: "bills", led: "", side: "p"}}],
    ["mis-sales", "parties", "Sales by customer", "Each customer, month by month", {mis: "sales"}],
    ["mis-purch", "parties", "Purchases and expenses by supplier", "Each supplier, month by month", {mis: "purch"}],
    ["lk-group-bank", "cash", "Bank balances", "Each bank account: opening, in, out, closing", {lk: {kind: "group", grp: "Bank Accounts"}}],
    ["lk-cash", "cash", "Cash book", "The cash account for any dates", {lk: {kind: "ledger", led: "@cash"}}],
    ["lk-bank", "cash", "Bank book", "A bank account for any dates", {lk: {kind: "ledger", led: "@bank"}}],
    ["go-bank", "cash", "Bank statements and reconciliation", "Statements brought in, and how they agree with Tally", {go: "bank"}],
    ["go-txn", "cash", "Transactions", "Everything uploaded and posted from FinCom", {go: "txn"}],
    ["gst-r1", "gst", "GSTR-1", "Outward supplies worked out from the books", {gst: "r1"}],
    ["gst-r3b", "gst", "GSTR-3B", "Tax, credit and cash to pay, month by month", {gst: "r3b"}],
    ["gst-inreg", "gst", "Input register", "Every bill with its credit", {gst: "inreg"}],
    ["gst-r2b", "gst", "2B reconciliation", "Bills in Tally against 2B", {gst: "r2b"}],
    ["gst-follow", "gst", "ITC follow-up", "Credit waiting on suppliers, carried month to month", {gst: "follow"}],
    ["gst-vault", "gst", "Returns filed", "The portal’s copy of every return", {gst: "vault"}],
    ["gst-g9", "gst", "GSTR-9 and 9C", "The annual return and reconciliation", {gst: "g9"}],
    ["mis-comp", "gst", "Compliance calendar", "GST and TDS by month, and what falls due", {mis: "comp"}],
    ["tds-q", "tds", "TDS by quarter", "Challans, deductees and deductions for 26Q", {tds: "challans"}],
    ["tds-checks", "tds", "Interest, late fee and checks", "Short deduction, late deposit and rate questions", {tds: "checks"}],
    ["tds-ledgers", "tds", "TDS and GST ledgers", "The ledgers FinCom reads for tax, to confirm", {ledgers: "pending"}],
    ["au-find", "audit", "Audit findings", "Every voucher checked the way an auditor would", {audit: "find"}],
    ["au-3cd", "audit", "Form 3CD draft", "The tax audit report clauses from the books", {audit: "3cd"}],
    ["au-rel", "audit", "Related parties", "Dealings with related parties", {audit: "rel"}],
    ["fs", "audit", "Balance sheet and profit and loss", "Schedule III or the ICAI format, with notes", {fs: 1}],
    ["lk-tb", "audit", "Trial balance on a date", "Every ledger’s balance, grouped", {lk: {kind: "tb"}}],
    ["lk-group", "audit", "Group summary", "Each ledger under a group, for any dates", {lk: {kind: "group", grp: ""}}],
    ["lk-find", "audit", "Find any entry", "By party, narration, number or amount", {lk: {kind: "find", q: ""}}]
  ],
  fys(){
    const m = (S.books || {}).meta || {}, f = String(m.from || ""), t = String(m.to || "");
    if (!f || !t) return [];
    const out = []; for (let y = num(Audit.fyStart(t).slice(0, 4)); y >= num(Audit.fyStart(f).slice(0, 4)); y--) out.push(String(y));
    return out;
  },
  range(){
    const ys = this.fys(), fy = S.rptFy && ys.includes(S.rptFy) ? S.rptFy : ys[0];
    if (!fy) return null;
    const to = (num(fy) + 1) + "0331", end = String((S.books.meta || {}).to || "");
    return {fy, from: fy + "0401", to: end && end < to ? end : to, fyEnd: to};
  },
  data(){
    const b = S.books, R = this.range(); if (!R) return null;
    const key = [b.cid, R.from, R.to, (b.vouchers || []).length, b.mapV || 0, ((b.audit || {}).last || {}).at || "", (b.tb || {}).at || "", JSON.stringify(b.gstFiled || {}).length].join("|");
    if (this._d && this._d.key === key) return this._d.d;
    const months = MIS.monthsOf(R.from, R.to), pl = MIS.pl(R.from, R.to);
    const bal = Audit.balances(R.from, R.to), balTo = bal.ok ? bal.at(R.to) : null;
    const recv = MIS.ageing(R.to, "r", balTo), pay = MIS.ageing(R.to, "p", balTo), msme = MIS.msme(), md = MIS.cfg(b).msmeDays;
    const msmeDue = r2(pay.rows.filter(p => /micro|small/i.test(msme[p.party] || "")).reduce((s, p) => s + p.bills.filter(x => x.ref && x.amt > 0 && x.age > md).reduce((a, x) => a + x.amt, 0), 0));
    const inM = {}, outM = {}, sales = {}, purch = {};
    months.forEach(m => { inM[m] = 0; outM[m] = 0; });
    (b.vouchers || []).forEach(v => {
      if (v.date < R.from || v.date > R.to || v.opt || v.cancel || /CONTRA/i.test(v.type)) return;
      const m = v.date.slice(0, 6); if (inM[m] == null) return;
      v.ent.forEach(e => { if (Audit.isCash(e.l) || Audit.isBankL(e.l)){ if (e.a < 0) inM[m] = r2(inM[m] - e.a); else outM[m] = r2(outM[m] + e.a); } });
    });
    const H = k => (pl.heads[k] || {m: {}, t: 0});
    months.forEach(m => { sales[m] = r2((H("rev").m[m] || 0)); purch[m] = r2((H("pur").m[m] || 0) + (H("dir").m[m] || 0)); });
    let comp = null; try { comp = MIS.compliance(R.from, R.to); } catch (e){ comp = {gst: [], tds: [], audit: null}; }
    const cashBank = balTo ? r2(Object.keys(balTo).filter(l => Audit.isCash(l) || Audit.isBankL(l)).reduce((s, l) => s - balTo[l], 0)) : null;
    const au = (b.audit || {}).last, open = au ? au.findings.filter(f => Audit.status(f.id).s === "open") : [];
    const d = {R, months, pl, bal, recv, pay, msmeDue, inM, outM, sales, purch, comp, cashBank, au, open,
      tdsDeductees: new Set(TDS.rows().filter(r => r.date >= R.from && r.date <= R.to).map(r => r.pan || r.party)).size};
    this._d = {key, d};
    return d;
  },
  tile(l, v, sub, rid, cls){ return '<button class="dtile' + (cls ? " " + cls : "") + '"' + (rid ? ' data-rpt="' + rid + '"' : "") + "><span>" + esc(l) + "</span><b>" + v + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</button>"; },
  areaDash(id, d){
    const m = v => INR0.format(r2(v || 0)), mon = d.months.map(x => FC.shortMonth(x)), T = this.tile.bind(this), pct = (a, c) => c ? (Math.round(a / c * 1000) / 10) + "%" : "—";
    if (id === "overview"){
      const rev = (d.pl.heads.rev || {t: 0}).t;
      return '<div class="dash-tiles">' + T("Sales", m(rev), "the year so far", "mis-sales") + T("Gross profit", m(d.pl.gross.t), pct(d.pl.gross.t, rev) + " of sales", "mis-pl") +
        T("Profit before tax", m(d.pl.pbt.t), pct(d.pl.pbt.t, rev) + " of sales", "mis-pl", d.pl.pbt.t < 0 ? "warn" : "") + T("Cash and bank", d.cashBank == null ? "—" : m(d.cashBank), d.cashBank == null ? "balances not read yet" : "on " + FC.when(d.R.to), "lk-group-bank") + "</div>" +
        FC.bars(mon, [{name: "Sales", cls: "c1", values: d.months.map(x => d.sales[x])}, {name: "Purchases and direct costs", cls: "c2", values: d.months.map(x => d.purch[x])}], {label: "Sales and purchases by month"});
    }
    if (id === "parties"){
      const owed = A => A.sum.tally != null ? A.sum.tally : A.sum.open;
      return '<div class="dash-tiles">' + T("Owed to you", m(owed(d.recv)), d.recv.rows.length + " customers", "mis-recv") + T("Over 90 days", m(d.recv.sum.b[3] + d.recv.sum.b[4]), "customers", "let-remind", d.recv.sum.b[3] + d.recv.sum.b[4] > 0 ? "warn" : "") +
        T("You owe", m(owed(d.pay)), d.pay.rows.length + " suppliers", "mis-pay") + T("MSME past " + MIS.cfg(S.books).msmeDays + " days", m(d.msmeDue), "section 43B(h)", "mis-pay", d.msmeDue > 0 ? "warn" : "") + "</div>" +
        FC.bars(MIS.BUCKETS.map(z => z[1]), [{name: "Owed to you", cls: "c1", values: d.recv.sum.b}, {name: "You owe", cls: "c3", values: d.pay.sum.b}], {label: "Ageing, in days"});
    }
    if (id === "cash"){
      const ti = Object.values(d.inM).reduce((s, x) => s + x, 0), to = Object.values(d.outM).reduce((s, x) => s + x, 0);
      return '<div class="dash-tiles">' + T("Received", m(ti), "into bank and cash", "lk-group-bank") + T("Paid out", m(to), "from bank and cash", "lk-group-bank") + T("Net", m(ti - to), ti - to < 0 ? "more went out" : "more came in", "mis-cash", ti - to < 0 ? "warn" : "") +
        T("Balance now", d.cashBank == null ? "—" : m(d.cashBank), d.cashBank == null ? "balances not read yet" : "on " + FC.when(d.R.to), "lk-group-bank") + "</div>" +
        FC.bars(mon, [{name: "Received", cls: "c1", values: d.months.map(x => d.inM[x])}, {name: "Paid", cls: "c3", values: d.months.map(x => d.outM[x])}], {label: "Money in and out by month"});
    }
    if (id === "gst"){
      const g = d.comp.gst || [], s = k => g.reduce((a, x) => a + num(x[k]), 0), last = g[g.length - 1] || {};
      return '<div class="dash-tiles">' + T("Tax on sales", m(s("out")), "the year so far", "gst-r3b") + T("Input credit", m(s("itc")), "the year so far", "gst-inreg") + T("Paid in cash", m(s("pay")), "after credit", "gst-r3b") +
        T("Last month", m(last.pay), last.ym ? "to pay for " + FC.monthLabel(last.ym) : "", "gst-r3b") + "</div>" +
        (g.length ? FC.bars(g.map(x => FC.shortMonth(x.ym)), [{name: "Tax on sales", cls: "c4", values: g.map(x => x.out)}, {name: "Input credit", cls: "c2", values: g.map(x => x.itc)}], {label: "GST by month"}) : "");
    }
    if (id === "tds"){
      const t = d.comp.tds || [], ded = t.reduce((a, x) => a + x.ded, 0), dep = t.reduce((a, x) => a + x.dep, 0);
      return '<div class="dash-tiles">' + T("Deducted", m(ded), "the year so far", "tds-q") + T("Deposited", m(dep), "by challan", "tds-q") + T("Not yet deposited", m(Math.max(0, ded - dep)), "", "tds-checks", ded - dep > 1 ? "warn" : "") + T("Deductees", String(d.tdsDeductees), "with TDS this year", "tds-q") + "</div>" +
        (t.length ? FC.bars(t.map(x => FC.shortMonth(x.ym)), [{name: "Deducted", cls: "c5", values: t.map(x => x.ded)}, {name: "Deposited", cls: "c2", values: t.map(x => x.dep)}], {label: "TDS by month"}) : "");
    }
    if (id === "audit"){
      if (!d.au) return '<div class="fc-empty small"><p class="note">The audit has not been run for this client yet.</p><button class="btn small primary" data-rpt="au-find">Run the audit</button></div>';
      const high = d.open.filter(f => f.sev === "high");
      return '<div class="dash-tiles">' + T("Serious, still open", String(high.length), m(high.reduce((s, f) => s + num(f.amount), 0)) + " involved", "au-find", high.length ? "warn" : "") + T("All open", String(d.open.length), "findings", "au-find") +
        T("Put right", String((d.au.solved || []).reduce((s, x) => s + x.n, 0)), "since earlier runs", "au-find") + T("Last run", FC.when(String(d.au.at).slice(0, 10).replace(/-/g, "")), esc(FC.span(d.au.from, d.au.to)), "au-find") + "</div>" +
        (high.length ? '<ul class="rpt-top">' + high.slice(0, 3).map(f => '<li><span class="tag bad">serious</span> ' + esc(f.title) + "</li>").join("") + "</ul>" : "");
    }
    return "";
  },
  view(b){
    const have = (b.vouchers || []).length > 0, q = String(S.rptQ || "").toLowerCase().trim();
    let h = '<section class="dash-card rpt-head"><div class="rpt-top-row"><div><h3>Reports</h3><p class="note" style="margin:0">Every report for ' + esc(CO().name) + " in one place. Click a figure or a report to open it.</p></div>" +
      '<input type="search" id="rptQ" data-fk="rptQ" data-keeptyped value="' + esc(S.rptQ || "") + '" placeholder="Find a report: ageing, 3B, cash, ratios…" aria-label="Find a report">' +
      (have ? '<select data-rptfy aria-label="Year">' + this.fys().map(y => '<option value="' + y + '"' + (this.range().fy === y ? " selected" : "") + ">" + FC.fyLabel(y) + "</option>").join("") + "</select>" : "") + "</div></section>";
    if (!have) h += FC.noBooks("Reports");
    const d = have ? this.data() : null;
    if (q){
      const hits = this.LIST.filter(r => (r[2] + " " + r[3] + " " + this.AREAS.find(a => a.id === r[1]).title).toLowerCase().includes(q));
      return h + '<section class="dash-card" style="margin-top:12px"><h3>' + hits.length + " report" + (hits.length === 1 ? "" : "s") + ' found</h3><div class="rpt-links">' +
        (hits.length ? hits.map(r => this.link(r)).join("") : '<p class="note">Nothing by that name. Try Look up for a ledger or an entry.</p>') + "</div></section>";
    }
    h += '<div class="rpt-grid">';
    this.AREAS.forEach(a => {
      h += '<section class="dash-card rpt-area rpt-' + a.id + '"><div class="rpt-ah"><i class="rpt-dot ' + a.ic + '" aria-hidden="true"></i><h3>' + esc(a.title) + "</h3>" + (d ? '<span class="note">' + FC.fyLabel(d.R.fy) + (d.R.to < d.R.fyEnd ? ", to " + FC.when(d.R.to) : "") + "</span>" : "") + "</div>" +
        (d ? this.areaDash(a.id, d) : "") + '<div class="rpt-links">' + this.LIST.filter(r => r[1] === a.id).map(r => this.link(r)).join("") + "</div></section>";
    });
    return h + "</div>";
  },
  link(r){ return '<button class="rpt-link" data-rpt="' + r[0] + '"><b>' + esc(r[2]) + "</b><span>" + esc(r[3]) + "</span></button>"; },
  open(id){
    const r = this.LIST.find(x => x[0] === id); if (!r) return;
    const to = r[4], R = this.range(), b = S.books;
    if (to.mis){
      if (!(b.vouchers || []).length){ FC.go("import"); return; }
      const last = (b.mis || {}).last;
      if (R && !(last && last.from === R.from && last.to === R.to)){ try { MIS.run(R.from, R.to, "opened from Reports"); saveBooks(); } catch (e){ toast("Could not work out the MIS: " + e.message); } }
      if (R) S.misRange = {from: FC.iso(R.from), to: FC.iso(R.to)};
      FC.go("mis", {misTab: to.mis, misLed: ""}); return;
    }
    if (to.act === "misPack"){ this.open("mis-summary"); setTimeout(() => { const bt = document.querySelector('[data-act="misPack"]'); if (bt) bt.click(); }, 50); return; }
    if (to.gst){ FC.go("gst", {gstPart: to.gst}); return; }
    if (to.tds){ FC.go("tds", {tdsTab: to.tds}); return; }
    if (to.audit){
      if (to.audit === "find" && !(b.audit || {}).last && R && (b.vouchers || []).length){ try { Audit.run(R.from, R.to, "run from Reports"); saveBooks(); } catch (e){} }
      FC.go("audit", {auditTab: to.audit}); return;
    }
    if (to.ledgers){ FC.go("ledgers", {lmView: to.ledgers}); return; }
    if (to.fs){ FC.go("fs", R ? {fsFy: R.fy} : {}); return; }
    if (to.letters){ FC.go("letters", {ltrMode: to.letters}); return; }
    if (to.go){ S.tab = "books"; const el = document.createElement("button"); el.dataset.goclient = to.go; document.body.appendChild(el); el.click(); el.remove(); return; }
    if (to.lk){
      const x = LK.st(), spec = Object.assign({}, to.lk), p = R ? {from: R.from, to: R.to} : FC.period("ytd");
      if (spec.led === "@cash") spec.led = FC.ledgers().find(l => Audit.isCash(l)) || "";
      if (spec.led === "@bank") spec.led = FC.ledgers().find(l => Audit.isBankL(l)) || "";
      Object.assign(x, {from: p.from, to: p.to, asOn: p.to, heard: "", res: null, q: "", typ: ""}, spec);
      FC.go("lookup");
      const ready = spec.kind === "tb" || spec.kind === "bills" || (spec.kind === "ledger" && spec.led) || (spec.kind === "group" && spec.grp) || (spec.kind === "find" && false);
      if (ready) LK.run("auto");
    }
  }
};
function viewBooksReports(b){ return RPT.view(b); }
if (typeof document !== "undefined"){
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-rpt]"); if (!t || !S.books) return;
    e.preventDefault(); RPT.open(t.dataset.rpt);
  });
  document.addEventListener("input", e => { if (e.target && e.target.id === "rptQ"){ S.rptQ = e.target.value; softRender(); } });
  document.addEventListener("change", e => { if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-rptfy")){ S.rptFy = e.target.value; render(); } });
}
