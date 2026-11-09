// node run_migration151.js IN.json OUT.json - the browser's own engine (src/js, from the test build: TDSDESK_HTML) on the
// made-up books run_migration151.py wrote: FinCom's ledger list (Books.mapLedgers), Audit.balances().at(d), Rec.fincom
// (the month-end tie-out) and MIS.ageing, each timed. The figures go to OUT.json for the Python side to compare with the SQL.
const fs = require("fs"), {load} = require("./harness"), {HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B",
  "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "FC", "LK", "Rec"];
const {ctx, x} = load(HTML, NAMES);
const inp = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), b = inp.books;
b.vouchers.forEach(v => { v.ent.forEach(e => { if (!e.b) delete e.b; }); });
b.map = x.Books.mapLedgers(b.vouchers, {});              // FinCom's ledger list as the browser makes it on load (TCloud.load)
ctx.S.books = b; ctx.S.coId = b.cid; ctx.CO = () => ({id: b.cid, name: "Made-up Heron Traders"});
const out = {map: b.map, ms: {}};
const time = (k, f) => { const t0 = Date.now(), r = f(); out.ms[k] = Date.now() - t0; return r; };
// 1. Audit.balances().at(d): the period's start is the books' first day (any period inside the copy gives the same at)
out.bal = time("balances", () => { const B = x.Audit.balances(b.tb.from, inp.dates[inp.dates.length - 1]); if (!B.ok) throw new Error(B.why); const r = {}; inp.dates.forEach(d => { r[d] = B.at(d); }); return r; });
// 2. the tie-out's five figures at each month-end
out.tie = time("tieout", () => { const r = {}; inp.months.forEach(m => { r[m] = x.Rec.fincom(b.cid, m); }); return r; });
// 3. the ageing, receivables and payables, with the balances on the day (as MIS.runNow passes them)
out.age = time("ageing", () => { const r = {}; inp.ageing.forEach(d => { const B = x.Audit.balances(b.tb.from, d), at = B.at(d); r[d] = {r: x.MIS.ageing(d, "r", at), p: x.MIS.ageing(d, "p", at)}; }); return r; });
fs.writeFileSync(process.argv[3], JSON.stringify(out));
