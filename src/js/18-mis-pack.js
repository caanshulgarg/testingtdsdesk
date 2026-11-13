/* @react-lazy: begin 18-mis-pack.js (the React app loads this file with its Books › MIS screen (app/src/screens/books/Mis.jsx): build.py react_parts) */
/* MIS: the monthly pack and its Excel (were in src/js/18) */
// the monthly pack: one document for the owner
function misPackHtml(r){
  const m = v => INR.format(r2(v || 0)), co = CO();
  const pl = [["Revenue from operations", (r.pl.heads.rev || {t: 0}).t], ["Other income", (r.pl.heads.oth || {t: 0}).t], ["Purchases and direct expenses", ((r.pl.heads.pur || {t: 0}).t + (r.pl.heads.dir || {t: 0}).t)], ["Gross profit", r.pl.gross.t, 1],
    ["Employee costs", (r.pl.heads.emp || {t: 0}).t], ["Other expenses", (r.pl.heads.exp || {t: 0}).t], ["Finance costs", (r.pl.heads.fin || {t: 0}).t], ["Depreciation", (r.pl.heads.dep || {t: 0}).t], ["Profit before tax", r.pl.pbt.t, 1]];
  const owed = A => A.sum.owe != null ? A.sum.owe : A.sum.tally != null ? A.sum.tally : A.sum.open;
  let h = '<div style="border-bottom:2px solid #15201B;padding-bottom:8px;margin-bottom:12px"><div style="font-size:12px;color:#5A6B63">MIS</div><h1 style="font-size:22px;margin:4px 0">' + esc(co.name) + "</h1>" +
    '<div>' + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to)) + " \u00b7 prepared " + fmtDate(r.at.slice(0, 10)) + " \u00b7 result code " + esc(r.code) + (r.control ? (r.control.ok ? " \u00b7 agrees with Tally\u2019s balances" : " \u00b7 " + r.control.n + " ledgers differ from Tally") : "") + "</div></div>";
  h += "<h2>At a glance</h2><table><tbody>" + [["Sales", m(r.sales.total) + (r.prev ? " (previous period " + m(r.prev.sales) + ")" : "") + (r.ly ? " (last year " + m(r.ly.sales) + ")" : "")], ["Profit before tax", m(r.pl.pbt.t)],
    ["Received / paid", m(r.cash.rec) + " / " + m(r.cash.pay)], ["Owed to you", m(owed(r.recv)) + " (over 90 days " + m((r.recv.sum.nb || r.recv.sum.b)[3] + (r.recv.sum.nb || r.recv.sum.b)[4]) + ")"], ["You owe", m(owed(r.pay)) + " (MSME past " + MIS.cfg(S.books).msmeDays + " days " + m(r.msme.reduce((s, x) => s + x.amt, 0)) + ")"]]
    .map(([a, c]) => "<tr><td>" + a + "</td><td>" + c + "</td></tr>").join("") + "</tbody></table>";
  h += "<h2>Profit and loss</h2><table><tbody>" + pl.map(([a, v, bold]) => "<tr><td>" + (bold ? "<b>" + a + "</b>" : a) + '</td><td class="n">' + (bold ? "<b>" + m(v) + "</b>" : m(v)) + "</td></tr>").join("") + "</tbody></table>" +
    '<p class="note">Before the change in stock.</p>';
  if (r.balances.cash) h += "<h2>Cash and bank</h2><table><tbody>" + r.balances.cash.concat(r.balances.bank).filter(x => Math.abs(x[1]) >= 1).map(([l, v]) => "<tr><td>" + esc(l) + '</td><td class="n">' + m(v) + "</td></tr>").join("") + "</tbody></table>";
  // open bills by age: the parties with the most outstanding
  // the ages of what is owed on balance (MIS.netOpen), and what no bill dates, as on the MIS page (review of 02-Oct-2026)
  const age = (t, A) => { const nb = p => p.nb || p.b, open = p => nb(p).reduce((a, v) => a + v, 0) + num(p.und), rows = A.rows.filter(p => open(p) > 0).sort((a, c) => open(c) - open(a) || a.party.localeCompare(c.party));
    return "<h2>" + t + "</h2><table><thead><tr><th>Party</th>" + MIS.BUCKETS.map(z => '<th class="n">' + z[1] + "</th>").join("") + '<th class="n">Not bill-wise</th><th class="n">Owed</th></tr></thead><tbody>' +
    rows.slice(0, 15).map(p => "<tr><td>" + esc(p.party) + "</td>" + nb(p).map(v => '<td class="n">' + (v ? m(v) : "") + "</td>").join("") + '<td class="n">' + (num(p.und) ? m(p.und) : "") + '</td><td class="n">' + m(open(p)) + "</td></tr>").join("") +
    "<tr><td><b>All</b></td>" + (A.sum.nb || A.sum.b).map(v => '<td class="n"><b>' + m(v) + "</b></td>").join("") + '<td class="n"><b>' + m(A.sum.und) + '</b></td><td class="n"><b>' + m(A.sum.owe != null ? A.sum.owe : A.sum.open) + "</b></td></tr></tbody></table>" +
    (Math.abs(A.sum.pre) >= 1 && A.sum.tally == null ? '<p class="note">' + m(Math.abs(A.sum.pre)) + " was settled against bills from before the books read here; they are not in these figures.</p>" : ""); };
  h += age("Receivables, largest 15", r.recv) + age("Payables, largest 15", r.pay);
  h += "<h2>Top customers</h2><table><tbody>" + r.sales.rows.slice(0, 10).map(x => "<tr><td>" + esc(x.party) + '</td><td class="n">' + m(x.t) + '</td><td class="n">' + (r.sales.total ? Math.round(x.t / r.sales.total * 1000) / 10 + "%" : "") + "</td></tr>").join("") + "</tbody></table>";
  // review of 02-Oct-2026: GST worked out to pay (the 3B working's cash) and what the books show paid from the bank, each
  // under its own heading
  h += "<h2>Compliance</h2><table><thead><tr><th>Month</th><th class=\"n\">GST worked out to pay</th><th class=\"n\">GST paid from the bank</th><th class=\"n\">TDS deducted</th><th class=\"n\">TDS deposited</th></tr></thead><tbody>" +
    r.comp.gst.map((x, i) => "<tr><td>" + GSTR.label(x.ym) + '</td><td class="n">' + m(x.due) + '</td><td class="n">' + m(x.pay) + '</td><td class="n">' + m(r.comp.tds[i].ded) + '</td><td class="n">' + m(r.comp.tds[i].dep) + "</td></tr>").join("") + "</tbody></table>" +
    "<h2>Due in the coming weeks</h2><table><tbody>" + r.dues.map(([d, l]) => "<tr><td>" + fmtDate(tallyDate(d)) + "</td><td>" + esc(l) + "</td></tr>").join("") + "</tbody></table>";
  if (r.p2){
    const F = r.p2.fc, C = r.p2.cash;
    h += "<h2>Cash flow</h2><table><tbody><tr><td>From operations</td><td class=\"n\">" + m(C.op.t) + "</td></tr><tr><td>From investing</td><td class=\"n\">" + m(C.inv.t) + "</td></tr><tr><td>From financing</td><td class=\"n\">" + m(C.fin.t) + "</td></tr><tr><td><b>Net change</b></td><td class=\"n\"><b>" + m(C.net) + "</b></td></tr>" +
      (C.open != null ? "<tr><td>Cash and bank at the start</td><td class=\"n\">" + m(C.open) + "</td></tr><tr><td><b>Cash and bank at the end</b></td><td class=\"n\"><b>" + m(C.close) + "</b></td></tr>" : "") + "</tbody></table>" +
      (C.open != null && !C.ties ? '<p class="note">Opening plus the net change differs from the closing balance by ' + m(C.diff) + ".</p>" : "");
    h += "<h2>The next 13 weeks</h2><table><thead><tr><th>Week of</th><th class=\"n\">In</th><th class=\"n\">Out</th>" + (F.opening != null ? "<th class=\"n\">Cash at the end</th>" : "<th class=\"n\">Net</th>") + "</tr></thead><tbody>" +
      F.weeks.map(w => "<tr><td>" + fmtDate(tallyDate(w.from)) + '</td><td class="n">' + m(w.inn) + '</td><td class="n">' + m(w.out) + '</td><td class="n">' + m(F.opening != null ? w.close : w.net) + "</td></tr>").join("") + "</tbody></table>";
    const V = MIS.budgetVs(r);
    if (V.has) h += "<h2>Budget against actual</h2><table><thead><tr><th>Head</th><th class=\"n\">Budget</th><th class=\"n\">Actual</th><th class=\"n\">Difference</th></tr></thead><tbody>" + V.rows.map(x => "<tr><td>" + esc(x.l) + '</td><td class="n">' + m(x.budget) + '</td><td class="n">' + m(x.actual) + '</td><td class="n">' + m(x.diff) + "</td></tr>").join("") + "</tbody></table>";
    if (r.p2.cc.rows.length) h += "<h2>Cost centres, largest 15 by income</h2><table><thead><tr><th>Cost centre</th><th class=\"n\">Income</th><th class=\"n\">Costs</th><th class=\"n\">Profit</th><th class=\"n\">Margin</th></tr></thead><tbody>" +
      r.p2.cc.rows.slice(0, 15).map(x => "<tr><td>" + esc(x.name) + '</td><td class="n">' + m(x.inc) + '</td><td class="n">' + m(x.exp) + '</td><td class="n">' + m(x.profit) + '</td><td class="n">' + (x.margin == null ? "" : x.margin + "%") + "</td></tr>").join("") + "</tbody></table>";
  }
  return h + '<p class="note" style="margin-top:16px">Prepared from the books in Tally by ' + esc(co.firm || (S.firm && S.firm.firmName) || "the firm") + ".</p>";
}
async function misExcel(r){
  await ensureXlsx();
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n.slice(0, 31)), months = r.pl.months;
  const pl = heldSheetRows(S.coId).concat([["Head", "Ledger"].concat(months.map(GSTR.label)).concat(["Period"])]);
  MIS.HEADS.forEach(([k, l]) => { const H = r.pl.heads[k]; if (!H) return; pl.push([l, ""].concat(months.map(mm => H.m[mm] || 0)).concat([H.t])); H.led.forEach(x => pl.push(["", x.l].concat(months.map(mm => x.m[mm] || 0)).concat([x.t]))); });
  [["Gross profit", r.pl.gross], ["Profit before tax", r.pl.pbt], ["Profit after tax", r.pl.pat]].forEach(([l, x]) => pl.push([l, ""].concat(months.map(mm => x.m[mm] || 0)).concat([x.t])));
  add("Profit and loss", pl);
  const age = A => [["Party"].concat(MIS.BUCKETS.map(z => z[1] + " days")).concat(["Not bill-wise", "Owed", "Advance", "Tally balance", "Bills as raised: before these books", "advances", "on account", "total"])].concat(A.rows.map(p => [p.party].concat(p.nb || p.b).concat([p.und || 0, Math.max(0, p.net != null ? p.net : p.total), p.advance || 0, p.tally == null ? "" : p.tally, p.pre, p.adv, p.unalloc, p.total])));
  add("Receivables", age(r.recv)); add("Payables", age(r.pay));
  add("Bills owed to you", [["Customer", "Bill", "Date", "Days", "Outstanding"]].concat(r.recv.rows.flatMap(p => p.bills.map(z => [p.party, z.ref || "on account", Audit.iso(z.date), z.age, z.amt]))));
  add("Bills you owe", [["Supplier", "Bill", "Date", "Days", "Outstanding", "MSME"]].concat(r.pay.rows.flatMap(p => p.bills.map(z => [p.party, z.ref || "on account", Audit.iso(z.date), z.age, z.amt, p.msme || ""]))));
  add("Sales by customer", [["Customer"].concat(r.sales.months.map(GSTR.label)).concat(["Total"])].concat(r.sales.rows.map(x => [x.party].concat(r.sales.months.map(mm => x.m[mm] || 0)).concat([x.t]))));
  add("Purchases by supplier", [["Supplier"].concat(r.purchases.months.map(GSTR.label)).concat(["Total"])].concat(r.purchases.rows.map(x => [x.party].concat(r.purchases.months.map(mm => x.m[mm] || 0)).concat([x.t]))));
  add("Expense heads", [["Ledger"].concat(r.purchases.months.map(GSTR.label)).concat(["Total", "Jumped in"])].concat(r.purchases.heads.map(x => [x.l].concat(r.purchases.months.map(mm => x.m[mm] || 0)).concat([x.t, x.jumps.map(GSTR.label).join(", ")]))));
  add("Compliance", [["Month", "GST output", "GST credit", "GST worked out to pay", "GST paid from the bank", "TDS deducted", "TDS deposited"]].concat(r.comp.gst.map((x, i) => [GSTR.label(x.ym), x.out, x.itc, x.due, x.pay, r.comp.tds[i].ded, r.comp.tds[i].dep])));
  if (r.p2){
    add("Cash flow", [["Section", "What"].concat(r.p2.cash.months.map(GSTR.label)).concat(["Period"])].concat(r.p2.cash.rows.map(x => [x.sec, x.lab].concat(r.p2.cash.months.map(mm => x.m[mm] || 0)).concat([x.t]))));
    add("13 weeks", [["Week of", "Date", "What", "Who", "Amount", "Why this date"]].concat(r.p2.fc.weeks.flatMap(w => w.items.map(z => [Audit.iso(w.from), Audit.iso(z.d), z.what, z.who, z.amt, z.why]))));
    add("Ratios", [["Ratio", "Value", "Unit"]].concat(r.p2.ratios.list.map(([l, v, u]) => [l, v == null ? "" : v, u])));
    add("Cost centres", [["Category", "Cost centre", "From", "To", "Income", "Costs", "Profit", "Margin %"]].concat(r.p2.cc.rows.map(x => [x.cat, x.name, Audit.iso(x.first), Audit.iso(x.last), x.inc, x.exp, x.profit, x.margin == null ? "" : x.margin])));
    const V = MIS.budgetVs(r); if (V.has) add("Budget", [["Head", "Budget", "Actual", "Difference", "%"]].concat(V.rows.map(x => [x.l, x.budget, x.actual, x.diff, x.pct == null ? "" : x.pct])));
  }
  const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-MIS-" + r.from + "-" + r.to + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
// next-cloud-mis: a run from FinCom's cloud's figures (MIS.cloudOk / cloudWork in src/js/07-mis.js say when they may be
// used); here, with the MIS screen, not in legacy.js
const MisCloud = {
  // a run asked for (MIS.runSoon, src/js/07) that did not end in a run: said, and (but for one that gave way) kept for the
  // MIS tab's line (failed). Here, with the job's steps (MIS.steps), not in legacy.js
  wantSay(j, k){
    const w = j.want, p = fmtDate(tallyDate(Audit.ymd(w.from))) + " to " + fmtDate(tallyDate(Audit.ymd(w.to)));
    // (the earlier run no longer fits the books: its figures are not shown; the setting changed: the run on its own follows it)
    const t = k === "fail" ? "Could not work out the MIS for " + p + "." + (this.stale(j.b) ? "" : " The figures shown are from the earlier run.") + " Press Run now to try again."
      : j.sig && j.sig.freq !== this.cfg(j.b).freq ? "The MIS settings changed; it will run again with the new setting." : "The MIS for " + p + " was not worked out: another run or client came first.";
    this.failed = k === "drop" ? null : {b: j.b, t};
    toast(t);
  },
  // budget against actual, head by head and month by month (moved from src/js/07-mis.js for legacy.js's budget,
  // next-fix-mis-freeze: only the MIS screen asks for it)
  budgetVs(r){
    const fy = Audit.fyStart(r.to).slice(0, 4), bud = this.budgetFor(fy), rows = [];
    this.HEADS.forEach(([k, l, sign]) => {
      const H = r.pl.heads[k] || {t: 0, m: {}}, B = bud[k] || {};
      const bt = r2(r.pl.months.reduce((s2, mm) => s2 + num(B[mm]), 0));
      if (!bt && !H.t) return;
      rows.push({k, l, sign, actual: H.t, budget: bt, diff: r2(H.t - bt), pct: bt ? Math.round((H.t - bt) / Math.abs(bt) * 1000) / 10 : null, m: r.pl.months.map(mm => ({ym: mm, a: H.m[mm] || 0, b: num(B[mm])}))});
    });
    const pbtB = r2(rows.reduce((s2, x) => s2 + x.budget * x.sign, 0));
    return {fy, rows, has: Object.keys(bud).length > 0, pbt: {actual: r.pl.pbt.t, budget: pbtB, diff: r2(r.pl.pbt.t - pbtB)}};
  },
  // the run in steps behind the page (app/src/lib/catchSoon.js, Mis.jsx runSplit, the month's MIS on its own: Audit.autoBegin):
  // first what the run reads many times (each month's GST working, from the books' first month so each month's credit
  // carried in is there; the parties, the TDS rows, the days to pay, the cash flow and the cost centres: kept for the job
  // as for one calculation, JOB_MEMO), then runIn. (moved from catchSoon.js, next-fix-mis-freeze; here, not in legacy.js)
  *steps(from, to, how, prog){
    const t = Audit.ymd(to), f = Audit.ymd(from), one = fn => { try { fn(); } catch (e){ /* the run says it */ } };
    // (a month's working for each registration a step of its own, kept as gst3b keeps it)
    const regs = Array.from(new Set((GSTR.gstins(S.books) || []).map(g => String(g).slice(0, 2))));
    for (const m of GSTR.months().filter(x => x <= t.slice(0, 6))){
      if (regs.length > 1) for (const rg of regs){ one(() => this.keep("3b" + m + rg, () => GSTR.threeBm(m, rg))); yield; }
      one(() => this.gst3b(m)); yield;
    }
    one(() => Parties.position(t)); yield;
    one(() => { TDS.rows(); TDS.salaryRows(); }); yield;
    // the days to pay, each in steps of its own (payIn), kept as payDays keeps them
    for (const s of ["r", "p"]){ try { const v = yield* this.payIn(s, t); perRender(this, "pd" + s + t, () => v); } catch (e){ /* the run says it */ } yield; }
    one(() => this.cashActual(f, t)); yield;
    one(() => this.costCentres(f, t)); yield;
    return yield* this.runIn(from, to, how, prog);
  },
  cloudFits(b, c){ const m = b && b.meta && b.meta.cloud; return !!(c && m && c.partial === false && c.misV === this.V && c.book === m.book && c.version === m.ver && this.cloudOk(b)); },
  async cloudAsk(b, from, to){
    let t; const late = new Promise((_, no) => { t = setTimeout(() => no(new Error("no answer")), 30000); });
    try { const j = await Promise.race([Cloud.fn("mis-run", {action: "now", client: b.cid, from: Audit.ymd(from), to: Audit.ymd(to)}), late]); return j && j.result ? Object.assign({}, j.result, {kept: !!j.kept}) : null; }
    finally { clearTimeout(t); }
  },
  // "cloud" (the run made from the cloud's figures, saved), "here" (local() worked it out), "busy" or "stopped"
  async cloudGo(from, to, how, local){
    const b = S.books, m = b && b.meta && b.meta.cloud;
    if (this._again || !b || b.loading) return "busy";
    if (!this.cloudOk(b)){ local(); if (m && m.book && !m.big && this.cloudOn()) this.cloudAsk(b, from, to).catch(() => {}); return "here"; }
    this._again = true; let c = null;
    try { c = await this.cloudAsk(b, from, to); } catch (e){ c = null; }
    this._again = false;
    if (S.books !== b || b.loading) return "stopped";
    let r = null;
    if (this.cloudFits(b, c)) try { r = memoScope(() => this.fromCloud(c, how)); } catch (e){ r = null; }
    if (!r){ local(); return "here"; }
    saveBooks(null, b).catch(() => {}); render(); return "cloud";
  },
  // runNow's answer from the cloud's figures; what the cloud leaves out (GST 3B's workings, the dues, the 13 weeks, the
  // ratios, registrations, cost centres, the audit's count, the MSME list) is worked out here as runNow does, and so is
  // the ageing, from the cloud's balances on the day (its bills are needed here for the page and the Excel). The balances
  // in the order the books here hold their ledgers, so every sum over them adds up as runNow's
  fromCloud(c, how){
    const b = S.books, from = c.from, to = c.to, bal = Audit.balances(from, to), cb = c.balances && c.balances.at;
    if (!bal.ok || !cb || !c.p2 || !c.comp) return null;
    const balTo = {};
    Object.keys((b.tb || {}).led || {}).forEach(l => { if (l in cb) balTo[l] = cb[l]; });
    Object.keys(cb).forEach(l => { if (!(l in balTo)) balTo[l] = cb[l]; });
    // the sales as runNow's (the cloud's own note on the ledger masters left out)
    const sales = Object.assign({}, c.sales); delete sales.masters;
    const r = this.made(from, to, how, bal, balTo, {sales, purchases: c.purchases, pl: c.pl, prev: c.prev, ly: c.ly, prevRange: c.prevRange, lyRange: c.lyRange, mtd: c.mtd, ytd: c.ytd,
      cash: c.cash, recv: this.ageing(to, "r", balTo), pay: this.ageing(to, "p", balTo), comp: this.compliance(from, to, c.comp), owed: c.owed, goods: c.goods, flow: c.p2.cash});
    r.cloud = {at: c.at, kept: !!c.kept};
    return r;
  }
};
if (typeof MIS === "object") Object.assign(MIS, MisCloud);
if (typeof misPackHtml !== "undefined") globalThis.misPackHtml = misPackHtml;
if (typeof misExcel !== "undefined") globalThis.misExcel = misExcel;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
/* @react-lazy: end */
