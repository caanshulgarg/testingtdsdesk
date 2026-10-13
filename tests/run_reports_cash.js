// node run_reports_cash.js - Step 3: the cash-basis MIS (FSX.cashMis, src/js/78-reports.js): receipts and payments by head and
// by month from the cash and bank vouchers, reconciled to the profit on the accrual basis. Made-up books
// (tests/reports_fixtures.js). Test data only.
//   1. receipts less payments = the movement in the cash and bank ledgers, for the year and for every month
//   2. receipts and payments by head equal the cash and bank lines against that head's ledgers
//   3. contra entries (bank to cash) are neither a receipt nor a payment
//   4. the reconciliation: the accrual profit plus the movement in every other balance = the cash movement, to the paisa
//   5. the Excel: every figure a formula over the voucher lines, recalculated independently; the PDF (print) view
const F = require("./reports_fixtures"), X = F.loadFSX(), fs = require("fs"), path = require("path"), {execFileSync} = require("child_process");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const OUT = process.env.TDSDESK_OUT || path.join(__dirname, "out"); fs.mkdirSync(OUT, {recursive: true});
const P = v => Math.round(v * 100);
for (const which of ["company", "firm"]){
  console.log("\n== " + which);
  const fx = F[which](), map = X.mapping({versions: []}, fx.tb, fx.entity.kind).map;
  const cm = X.cashMis({entity: fx.entity, from: "2025-04-01", to: "2026-03-31", tb: fx.tb, vouchers: fx.vouchers, map});
  const isCash = l => X.isCashLed((fx.tb.find(t => t.l === l) || {}).g);
  const cashL = fx.tb.filter(t => isCash(t.l)), move = cashL.reduce((a, t) => a + P(t.d) - P(t.c), 0);
  ok(cm.totals.receipts - cm.totals.payments === move && cm.cash.move === move, "1. receipts " + X.money(cm.totals.receipts) + " - payments " + X.money(cm.totals.payments) + " = the cash and bank movement " + X.money(move));
  const byMonth = {}; fx.vouchers.forEach(v => { const m = v.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + v.ent.filter(e => isCash(e.l)).reduce((a, e) => a + P(e.a), 0); });
  const mOk = cm.months.every(m => cm.rec.reduce((a, h) => a + (h.m[m] || 0), 0) - cm.pay.reduce((a, h) => a + (h.m[m] || 0), 0) === byMonth[m]);
  ok(cm.months.length === 12 && mOk, "1. and month by month (12 months)");
  // 2. a head: the customers' receipts are the bank lines of the receipts from them
  const debtors = fx.tb.filter(t => (t.g[0] || "") === "Sundry Debtors").map(t => t.l);
  const fromCust = fx.vouchers.filter(v => v.ent.some(e => debtors.includes(e.l)) && v.ent.some(e => isCash(e.l))).reduce((a, v) => a + v.ent.filter(e => isCash(e.l)).reduce((s, e) => s + P(e.a), 0), 0);
  const h = cm.rec.find(z => z.head === "Sundry Debtors");
  ok(h && h.t === fromCust, "2. receipts from customers (Sundry Debtors) " + X.money(h ? h.t : 0) + " = the bank lines of those receipts " + X.money(fromCust));
  const rent = cm.pay.find(z => z.head === "Indirect Expenses");
  ok(rent && cm.lines.filter(x => x.head === "Indirect Expenses").reduce((a, x) => a + x.p, 0) === rent.t, "2. each head is the sum of its lines (Indirect Expenses " + X.money(rent ? rent.t : 0) + ")");
  // a payment net of TDS: the bank paid is spread over the debit side only (rent), not shown as a receipt of TDS
  ok(!cm.rec.some(z => z.head === "Duties & Taxes" && cm.lines.some(x => x.head === "Duties & Taxes" && x.r && /Payment/.test(x.type))), "2. rent paid net of TDS: the payment goes to rent, not a receipt of TDS");
  // 3. contra
  const contra = fx.vouchers.filter(v => v.type === "Contra");
  ok(contra.length === 12 && !cm.lines.some(x => contra.some(v => v.no === x.no)), "3. the 12 bank-to-cash contras are neither receipts nor payments");
  // 4. the reconciliation
  ok(cm.diff === 0 && cm.voucherDiff === 0 && cm.recon[0][0].startsWith("Profit for the period"), "4. accrual profit " + X.money(cm.recon[0][1]) + " + the movement in " + (cm.recon.length - 1) + " balance sheet lines = the cash movement (difference " + cm.diff + ")");
  const pl = -fx.tb.filter(t => /^(Sales Accounts|Purchase Accounts|Direct Incomes|Indirect Incomes|Direct Expenses|Indirect Expenses)$/.test(t.g[t.g.length - 1] || "")).reduce((a, t) => a + P(t.d) - P(t.c), 0);
  ok(cm.recon[0][1] === pl, "4. the profit is the P&L ledgers' movement in the period (before closing stock, as the books show it)");
  // with the closing stock of the statements (Tally without integrated stock): the profit of the statements, stock reconciled
  const st = which === "company" ? {open: 500000, close: 610000} : {open: 410000, close: 460000};
  const cm2 = X.cashMis({entity: fx.entity, from: "2025-04-01", to: "2026-03-31", tb: fx.tb, vouchers: fx.vouchers, map, stock: st});
  ok(cm2.diff === 0 && cm2.recon[0][1] === cm.recon[0][1] + P(st.close - st.open) && cm2.recon.some(z => /^Less: .*Inventories/.test(z[0]) && z[1] === -P(st.close - st.open)), "4. with the closing stock given: the statements' profit " + X.money(cm2.recon[0][1]) + ", less the increase in inventories; still ties");
  // 5. Excel and print
  const xb = X.cashMisExcel(cm), file = path.join(OUT, "reports-cash-" + which + ".xlsx"); fs.writeFileSync(file, xb);
  const html = X.cashMisHtml(cm); fs.writeFileSync(path.join(OUT, "reports-cash-" + which + ".html"), html);
  let rc = ""; try { rc = execFileSync("python3", ["-W", "ignore", path.join(__dirname, "reports_recalc.py"), file], {encoding: "utf8", timeout: 300000}); } catch (e){ rc = String(e.stdout || e.message); }
  const counts = [...rc.matchAll(/(\d+) formulas, (\d+) differ/g)].map(m => [Number(m[1]), Number(m[2])]);
  ok(counts.length >= 1 && counts.every(([n, d]) => n > 50 && d === 0), "5. the Excel recalculated independently: " + rc.split("\n").filter(l => /formulas/.test(l)).map(l => l.replace(/^\S+ /, "")).join("; "));
  ok(/@bottom-right\{content:counter\(page\) " \/ " counter\(pages\)\}/.test(html) && html.includes("Reconciliation to the accrual profit"), "5. the print (PDF) view, with the reconciliation");
}
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
