// node run_migration152.js IN.json OUT.json - the browser's own engine (src/js, from the test build: TDSDESK_HTML) on the
// made-up books run_migration152.py wrote: MIS.runNow for each period, as the MIS page runs it. The parts migration 152
// works out (sales, purchases, the profit and loss, the period before and last year, month and year to date, cash and
// bank, the cash flow, compliance without GST 3B, MSME, the control, days of sales and purchases) go to OUT.json for the
// Python side to compare with the SQL, each run timed.
const fs = require("fs"), {load} = require("./harness"), {HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B",
  "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "FC", "LK", "Rec", "choiceSplit", "choiceAcc", "choiceLegacy", "choiceRec", "choiceDerive", "choiceGet", "choiceUsable"];
const {ctx, x} = load(HTML, NAMES);
const inp = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), b = inp.books;
b.vouchers.forEach(v => { v.ent.forEach(e => { if (!e.b) delete e.b; }); });
b.map = x.Books.mapLedgers(b.vouchers, inp.saved || {});   // FinCom's ledger list as the browser makes it on load, with the ones set by hand
ctx.S.books = b; ctx.S.coId = b.cid; ctx.S.companies = {[b.cid]: inp.company}; ctx.CO = () => Object.assign({id: b.cid, name: "Made-up Heron Traders"}, inp.company);
const out = {map: b.map, runs: {}, ms: {}};
inp.periods.forEach(([from, to]) => {
  const t0 = Date.now(), r = x.MIS.runNow(from, to, "test");
  out.ms[from + "|" + to] = Date.now() - t0;
  out.runs[from + "|" + to] = {sales: r.sales, purchases: r.purchases, goods: r.goods, pl: r.pl, prev: r.prev, ly: r.ly, prevRange: r.prevRange, lyRange: r.lyRange, mtd: r.mtd, ytd: r.ytd,
    cash: r.cash, flow: r.p2.cash, comp: {gstPay: r.comp.gst.map(g => ({ym: g.ym, pay: g.pay})), tds: r.comp.tds, tdsRoll: r.comp.tdsRoll},
    msme: r.msme.map(m => ({party: m.party, type: m.type, amt: m.amt, bills: m.bills.map(z => ({ref: z.ref, date: z.date, age: z.age, amt: z.amt, left: z.left}))})),
    control: r.control, dso: r.dso, dpo: r.dpo, owe: {r: r.recv.sum.owe, p: r.pay.sum.owe}};
});
fs.writeFileSync(process.argv[3], JSON.stringify(out));
