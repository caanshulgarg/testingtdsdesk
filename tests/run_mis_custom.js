// node run_mis_custom.js - "My MIS" (ROUND 105, B1): the report-definition engine (app/src/lib/misCustom.js), fed by the
// browser's books through the adapter (app/src/lib/misData.js), against the existing MIS (src/js/07-mis.js) and Financial
// statements (src/js/88-fin-statements.js) on the made-up books, to the rupee (to the paisa where both keep paise):
//   1. the fixture books (tests/fixtures/books): the P&L heads and profit lines month by month and for the year equal
//      MIS.pl; sales by customer, top N and "Others", equal MIS.sales; the ratios equal MIS.ratios; GST by month equals
//      MIS.compliance; receivables / payables by age equal MIS.ageing; cash and bank at the end equal MIS's balances;
//      quarters and months add to the year; filters by voucher type and party; every figure's ledger rows add to it;
//      a typed budget's variance;
//   2. the financial-statement fixture (tests/fixtures/fin-statements): rows by FinSt code equal the trial balance by
//      code and the notes' totals (Note 13, 15, 17), this year against last year with the % change;
//   3. units (actual, thousands, lakhs, crores) and decimals (0, 2) as the statements round them (Excel's ROUND);
//   4. the definition's check: wrong values replaced and said; names checked against the books, unknown ones listed;
//      a definition from the AI carries no amount.
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, CACHE, FIXTURE_DIR} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev",
  "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "Parties", "FS", "FinSt", "GSTSet", "GSTF", "GSTQ", "choiceSplit", "choiceAcc", "choiceLegacy", "choiceDerive", "choiceRec", "choiceGet", "choiceUsable"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const near = (a, b) => Math.abs((a == null ? NaN : +a) - b) < 0.005;
const eq = (a, b, w) => ok(near(a, b), w + ": " + a + (near(a, b) ? "" : " (expected " + b + ")"));
const APP = path.join(__dirname, "..", "app", "src", "lib");

(async () => {
  const E = await import(path.join(APP, "misCustom.js")), A = await import(path.join(APP, "misData.js")), D = await import(path.join(__dirname, "..", "server", "_shared", "misdef.js"));
  const T = await import(path.join(APP, "misTemplates.js"));
  const {ctx, x} = load(HTML, NAMES);
  const G = () => Object.assign({}, x, {S: ctx.S, CO: ctx.CO});
  // ---------------------------------------------------------------- 1. the fixture books
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.coId = "t";
  ctx.S.companies = {t: {id: "t", name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3", choices: {advGst: {value: "on", state: "confirmed", by: "test", at: "2026-10-22T00:00:00Z"}}}};
  ctx.CO = () => ctx.S.companies.t;
  x.LedMaster.refresh(b);
  const FROM = "20250401", TO = "20260331";
  const r = x.MIS.run(FROM, TO, "test"), pl = r.pl;
  const run = (def, need) => { const n = D.normalizeDef(def); ok(!n.problems.length || need === "problems", "the definition is clean" + (n.problems.length ? ": " + n.problems.join("; ") : "")); const data = A.buildMisData(G(), n.def, {today: "20260415"}); return E.run(n.def, data, {today: "20260415"}); };
  const blk = (res, i = 0) => res.blocks[i];
  const row = (B, key) => B.rows.find((z) => z.key === key) || {cells: {}};

  console.log("\nThe profit and loss by MIS head, month by month (Monthly P&L template) = MIS.pl");
  const mpl = T.TEMPLATES.find((t) => t.key === "pl");
  ok(!!mpl, "the Monthly P&L template is there");
  let res = run(Object.assign({}, mpl.def, {period: {kind: "fy", fy: "2025"}}));
  ok(res.period.from === FROM && res.period.to === TO, "the period: the financial year " + res.period.from + "-" + res.period.to);
  let B = blk(res);
  ok(B.cols.filter((c) => c.kind === "period").length === 12, "12 month columns and a total");
  let allHeads = true, allMonths = true;
  x.MIS.HEADS.forEach(([k]) => {
    const H = pl.heads[k]; if (!H) return;
    const R = row(B, "head:" + k);
    if (!near(R.cells.t, H.t)) { allHeads = false; console.log("    " + k + " " + R.cells.t + " vs MIS " + H.t); }
    pl.months.forEach((m) => { if (!near(R.cells[m], H.m[m] || 0)) { allMonths = false; console.log("    " + k + " " + m + " " + R.cells[m] + " vs MIS " + H.m[m]); } });
  });
  ok(allHeads, "every head's total equals MIS.pl (to the paisa)");
  ok(allMonths, "every head's month equals MIS.pl, the expense set-off in the period's last month as MIS has it");
  ["income", "gross", "ebitda", "pbt", "pat"].forEach((k) => {
    eq(row(B, "head:" + k).cells.t, pl[k].t, "MIS's " + k);
    ok(pl.months.every((m) => near(row(B, "head:" + k).cells[m], pl[k].m[m])), "... and its months");
  });
  eq(row(B, "head:pbt").cells.t, 394550, "fixture: profit before tax 3,94,550 (EXPECTED.md)");
  // a head opens to its ledgers: their entries add to the figure
  const dir = row(B, "head:dir"), led = dir.src.ledgers;
  ok(led.length >= 1, "the Direct expenses figure names its ledgers (" + led.join(", ") + ")");
  const ent = E.entries(res.data, {ledgers: led, from: FROM, to: TO});
  eq(Math.round(-ent.reduce((s, v) => s + v.amt, 0) * 100) / 100, dir.cells.t, "the ledger rows of Direct expenses add to its figure");
  ok(ent.every((v) => v.date && v.no != null && v.type), "each ledger row has its date, number and type");

  console.log("\nQuarters and the year add up; last year not in these books");
  res = run({blocks: [{type: "table", rows: {by: "head", items: ["rev", "exp", "pbt"]}, cols: {by: "quarter"}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  ok(B.cols.filter((c) => c.kind === "period").length === 4, "4 quarter columns");
  ok(["rev", "exp", "pbt"].every((k) => near(B.cols.filter((c) => c.kind === "period").reduce((s, c) => s + row(B, "head:" + k).cells[c.key], 0), row(B, "head:" + k).cells.t)), "the quarters add to the year");
  eq(row(B, "head:rev").cells.t, pl.heads.rev.t, "the year's revenue");
  res = run({blocks: [{type: "table", rows: {by: "head", items: ["rev"]}, cols: {by: "year", compare: "ly", pct: ["change"]}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  ok(row(B, "head:rev").cells.ly == null && B.notes.some((n) => /last year/i.test(n)), "last year is not in these books: no figure, and a note says so");

  console.log("\nSales by customer, top 3 and Others (Sales trend template) = MIS.sales");
  res = run({blocks: [{type: "table", rows: {by: "customer", top: 3, others: true}, cols: {by: "month"}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  const sr = r.sales.rows;
  ok(B.rows.filter((z) => z.kind === "line").length === 3 && B.rows.some((z) => z.kind === "others"), "3 customers and Others");
  ok(sr.slice(0, 3).every((p, i) => B.rows[i].label === p.party && near(B.rows[i].cells.t, p.t)), "the top 3 customers and their sales, in MIS's order");
  eq(row(B, "others").cells.t, Math.round(sr.slice(3).reduce((s, p) => s + p.t, 0) * 100) / 100, "Others: the rest of the customers");
  eq(B.total.cells.t, r.sales.total, "the total: MIS's sales for the year (15,50,000)");
  ok(sr.slice(0, 3).every((p, i) => Object.keys(p.m).every((m) => near(B.rows[i].cells[m], p.m[m]))), "each customer's months equal MIS's");
  res = run({blocks: [{type: "table", rows: {by: "customer", top: 3, others: true}, cols: {by: "year", pct: ["share"]}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  eq(B.rows[0].cells.share, Math.round(sr[0].t / r.sales.total * 1000) / 10, "% of total: the largest customer's share");
  const sup = run({blocks: [{type: "table", rows: {by: "supplier", top: 0}, cols: {by: "year"}}], period: {kind: "fy", fy: "2025"}});
  eq(blk(sup).total.cells.t, r.purchases.total, "purchases by supplier: MIS's purchases for the year");

  console.log("\nRatios = MIS.ratios");
  res = run({blocks: [{type: "table", rows: {by: "ratio", items: ["gross", "op", "net", "emp", "exp", "dso", "dpo", "current", "quick", "debtEq", "icover", "wc"]}, cols: {by: "year"}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  const L = Object.fromEntries(r.p2.ratios.list.map((z) => [z[0], z[1]]));
  [["gross", "Gross margin"], ["op", "Operating margin (before interest and depreciation)"], ["net", "Net margin (before tax)"], ["emp", "Employee costs to revenue"], ["exp", "Other expenses to revenue"],
    ["dso", "Days of sales owed to you"], ["current", "Current ratio"], ["quick", "Quick ratio"], ["debtEq", "Debt to equity"], ["icover", "Interest cover"], ["wc", "Working capital"]].forEach(([k, l]) => {
    const got = row(B, "ratio:" + k).cells.t, want = L[l];
    ok(got === want || near(got, want), l + ": " + got + (got === want || near(got, want) ? "" : " (MIS " + want + ")"));
  });
  ok(row(B, "ratio:dpo").cells.t == null && !("Days of purchases you owe" in L) === !r.goods, "days of purchases: none for a client that buys no goods, as MIS");
  eq(row(B, "ratio:dso").cells.t, r.dso, "days of sales owed, the figure on MIS's summary");

  console.log("\nGST by month (GST summary template) = MIS.compliance");
  res = run({blocks: [{type: "table", rows: {by: "gst", items: ["out", "itc", "rcm", "due", "pay"]}, cols: {by: "month"}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  ok(r.comp.gst.every((g) => near(row(B, "gst:out").cells[g.ym], g.out) && near(row(B, "gst:itc").cells[g.ym], g.itc) && near(row(B, "gst:due").cells[g.ym], g.due) && near(row(B, "gst:pay").cells[g.ym], g.pay) && near(row(B, "gst:rcm").cells[g.ym], g.rcm)),
    "output tax, credit, reverse charge, to pay and paid, month by month");
  eq(row(B, "gst:pay").cells.t, r.comp.gst.reduce((s, g) => s + g.pay, 0), "GST paid from the bank for the year");

  console.log("\nReceivables and payables by age = MIS.ageing");
  ["r", "p"].forEach((side) => {
    res = run({blocks: [{type: "table", rows: {by: "ageing", side, top: 5, others: true}}], period: {kind: "fy", fy: "2025"}});
    B = blk(res); const A = side === "r" ? r.recv : r.pay;
    ok(D.AGE_BUCKETS.every((l, i) => near(B.total.cells["b" + i], A.sum.nb[i])), (side === "r" ? "receivables" : "payables") + ": every age bucket's total");
    eq(B.total.cells.und, A.sum.und, "... not bill-wise"); eq(B.total.cells.t, A.sum.owe, "... owed, " + (side === "r" ? "7,18,200" : "3,22,400") + " (EXPECTED.md)");
  });

  console.log("\nCash and bank at the end (Cash & bank template) = MIS's balances");
  res = run(Object.assign({}, T.TEMPLATES.find((t) => t.key === "cash").def, {period: {kind: "fy", fy: "2025"}}));
  B = res.blocks.find((z) => z.rows.some((y) => y.key.startsWith("ledger:")));
  r.balances.bank.concat(r.balances.cash).forEach(([l, v]) => { if (Math.abs(v) >= 0.005) eq(row(B, "ledger:" + l).cells.t, v, l + " on 31-Mar-2026"); });

  console.log("\nFilters: voucher type and party; dr, cr, count");
  res = run({filters: {vtype: ["Sales"]}, blocks: [{type: "table", rows: {by: "head", items: ["rev", "emp"]}, cols: {by: "year"}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  const salesOnly = b.vouchers.filter((v) => v.type === "Sales" && !v.opt && !v.cancel && v.date >= FROM && v.date <= TO).reduce((s, v) => s + v.ent.filter((e) => x.Audit.under(e.l, /^sales accounts$/i)).reduce((a, e) => a + e.a, 0), 0);
  eq(row(B, "head:rev").cells.t, salesOnly, "Sales entries only: revenue from the sales entries");
  eq(row(B, "head:emp").cells.t, 0, "... and no employee costs");
  const party = sr[0].party;
  res = run({filters: {party: [party]}, blocks: [{type: "table", rows: {by: "customer"}, cols: {by: "year"}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  ok(B.rows.filter((z) => z.kind === "line").length === 1 && near(B.rows[0].cells.t, sr[0].t), "one party: only its sales (" + party + ")");
  const bank = r.balances.bank[0][0];
  res = run({blocks: [{type: "table", rows: {by: "ledger", items: [bank]}, measure: "dr", cols: {by: "year"}}, {type: "table", rows: {by: "ledger", items: [bank]}, measure: "cr", cols: {by: "year"}}, {type: "table", rows: {by: "ledger", items: [bank]}, measure: "count", cols: {by: "year"}}], period: {kind: "fy", fy: "2025"}});
  const V = b.vouchers.filter((v) => !v.opt && !v.cancel && v.date >= FROM && v.date <= TO && v.ent.some((e) => e.l === bank));
  const dr = V.reduce((s, v) => s + v.ent.filter((e) => e.l === bank && e.a < 0).reduce((a, e) => a - e.a, 0), 0), cr = V.reduce((s, v) => s + v.ent.filter((e) => e.l === bank && e.a > 0).reduce((a, e) => a + e.a, 0), 0);
  eq(row(res.blocks[0], "ledger:" + bank).cells.t, dr, bank + ": debits"); eq(row(res.blocks[1], "ledger:" + bank).cells.t, cr, "... credits"); eq(row(res.blocks[2], "ledger:" + bank).cells.t, V.length, "... number of entries");

  console.log("\nTop N and Others by ledger under a group; a typed budget");
  res = run({blocks: [{type: "table", rows: {by: "ledger", under: ["Indirect Expenses"], top: 2, others: true}, cols: {by: "year", pct: ["share"]}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  const lines = B.rows.filter((z) => z.kind === "line");
  ok(lines.length === 2 && lines[0].cells.t >= lines[1].cells.t && row(B, "others").cells.t <= lines[1].cells.t * 100, "the 2 largest ledgers, largest first, then Others");
  eq(lines.concat([row(B, "others")]).reduce((s, z) => s + z.cells.t, 0), B.total.cells.t, "the rows and Others add to the total");
  const sh = B.rows.filter((z) => z.kind !== "total").reduce((s, z) => s + (z.cells.share || 0), 0); ok(Math.abs(sh - 100) <= 0.2, "the shares add to 100% (to a tenth each): " + sh);
  res = run({budget: {"head:rev": {"202504": 100000, "202505": 100000}}, blocks: [{type: "table", rows: {by: "head", items: ["rev"]}, cols: {by: "month", compare: "budget", pct: ["change"]}}], period: {kind: "range", from: "20250401", to: "20250531"}});
  B = blk(res); const rv = row(B, "head:rev");
  eq(rv.cells.bud, 200000, "budget for April-May");
  eq(rv.cells.chg, Math.round((rv.cells.t - 200000) / 200000 * 1000) / 10, "% against the budget");

  // ---------------------------------------------------------------- 2. the financial-statement fixture
  console.log("\nRows by Financial-statement code = FinSt's trial balance and notes; this year against last year");
  const FIX = path.join(__dirname, "fixtures", "fin-statements"), F = JSON.parse(fs.readFileSync(path.join(FIX, "company.json"), "utf8"));
  const shift = (end) => String(Number(end.slice(0, 4)) - 1) + end.slice(4);
  const fb = (() => {
    const under = Object.assign({}, F.groups), ledg = {}; Object.entries(F.o).forEach(([n, v]) => { ledg[n] = {open: -v, close: 0, parent: under[n]}; });
    const vouchers = [], bk = Object.keys(under).find((n) => under[n] === "Bank Accounts");
    (F.additions || []).forEach(([l, d, a], i) => vouchers.push({id: "a" + i, date: d, type: "Journal", narr: "Purchase of " + l, ent: [{l, a: -a}, {l: bk, a}]}));
    [["20250331", F.p, F.plp, F.o], ["20260331", F.c, F.plc, F.p]].forEach(([end, bs, plx, prev]) => {
      const e2 = [];
      Object.keys(bs).forEach((n) => { if (n === bk) return; const added = (F.additions || []).filter(([l, d]) => l === n && d <= end && d > shift(end)).reduce((s, z) => s + z[2], 0);
        const mv = Math.round(((bs[n] || 0) - (prev[n] || 0) - added) * 100) / 100; if (mv) e2.push({l: n, a: -mv}); });
      Object.entries(plx).forEach(([n, v]) => { if (v) e2.push({l: n, a: -v}); });
      e2.push({l: bk, a: Math.round(-e2.reduce((s, e) => s + e.a, 0) * 100) / 100});
      vouchers.push({id: "m" + end, date: end, type: "Journal", narr: "Movements for the year (fixture)", ent: e2});
    });
    return {under, groups: {}, ledInfo: {}, vouchers, meta: {from: "20240401"}, tb: {from: "20240401", to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led: ledg}, msme: {"Bluebell Print Works": "Micro"}, fs: {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}}, map: {}, challans: [], alloc: {}};
  })();
  ctx.S.books = fb; ctx.S.companies = {t: {id: "t", name: "Larkspur Analytics Private Limited", pan: "AABCL1234F"}}; ctx.CO = () => ctx.S.companies.t;
  const tb = x.FinSt.tb("2025"), fsd = x.FinSt.build("2025", {unit: 1, dec: 2});
  ok(!tb.error && !fsd.error, "FinSt worked out the fixture");
  const byCode = {}; tb.rows.forEach((z) => { if (!z.synthetic && z.code) byCode[z.code] = (byCode[z.code] || 0) + z.cy; });
  const codes = ["13A", "14A", "14C", "15A", "15B", "17A", "17D", "10A", "11A", "6B", "7C", "12B"];
  res = run({blocks: [{type: "table", rows: {by: "code", items: codes}, cols: {by: "year", compare: "ly", pct: ["change"]}}], period: {kind: "fy", fy: "2025"}});
  B = blk(res);
  codes.forEach((c) => eq(row(B, "code:" + c).cells.t, x.FinSt.RND(x.FinSt.CODES[c].sign * (byCode[c] || 0), 2), c + " " + x.FinSt.CODES[c].label + " (the trial balance by code, in the note's sign)"));
  const note = (k) => fsd.notes.find((n) => n.key === k);
  [["13", ["13A", "13B", "13C"]], ["15", ["15A", "15B", "15C", "15D", "15E"]], ["17", Object.keys(x.FinSt.CODES).filter((c) => x.FinSt.CODES[c].note === "17")]].forEach(([k, cs]) => {
    res = run({blocks: [{type: "table", rows: {by: "code", items: cs}, cols: {by: "year", compare: "ly"}}], period: {kind: "fy", fy: "2025"}});
    eq(blk(res).total.cells.t, note(k).total.cy, "Note " + k + " " + note(k).title + ": the total, this year");
    eq(blk(res).total.cells.ly, note(k).total.py, "... and last year");
  });
  res = run({blocks: [{type: "table", rows: {by: "code", items: ["13A"]}, cols: {by: "year", compare: "ly", pct: ["change"]}}], period: {kind: "fy", fy: "2025"}});
  const r13 = row(blk(res), "code:13A");
  eq(r13.cells.chg, Math.round((r13.cells.t - r13.cells.ly) / Math.abs(r13.cells.ly) * 1000) / 10, "% change on last year (" + r13.cells.ly + " to " + r13.cells.t + ")");
  res = run({blocks: [{type: "table", rows: {by: "head", items: ["rev", "pbt"]}, cols: {by: "year", compare: "ly"}}], period: {kind: "fy", fy: "2025"}});
  const pl25 = x.MIS.pl("20250401", "20260331"), pl24 = x.MIS.pl("20240401", "20250331");
  eq(row(blk(res), "head:pbt").cells.t, pl25.pbt.t, "profit before tax this year = MIS.pl"); eq(row(blk(res), "head:pbt").cells.ly, pl24.pbt.t, "... and last year = MIS.pl of the year before");

  // ---------------------------------------------------------------- 3. units and decimals
  console.log("\nUnits and decimals, as the statements round them");
  const U = (unit, dec) => ({unit, dec});
  ok(E.fmt(1550000, U(1, 2)) === "15,50,000.00" && E.fmt(1550000, U(1, 0)) === "15,50,000", "rupees: 15,50,000.00 / 15,50,000");
  ok(E.fmt(1550000, U(1000, 0)) === "1,550" && E.fmt(1550499.99, U(1000, 2)) === "1,550.50", "thousands: 1,550 / 1,550.50");
  ok(E.fmt(1550000, U(100000, 2)) === "15.50" && E.fmt(-1550000, U(100000, 2)) === "-15.50", "lakhs: 15.50, a negative -15.50");
  ok(E.fmt(1550000, U(10000000, 2)) === "0.16" && E.fmt(1550000, U(10000000, 0)) === "0", "crores: 0.16 / 0");
  ok(E.scale(2.675, U(1, 2)) === 2.68 && E.scale(0.035, U(1, 2)) === 0.04 && E.scale(-12345, U(1000, 0)) === -12, "Excel's ROUND: half away from zero, binary noise cleared");
  ok(E.fmt(12.5, {unit: 100000, dec: 2}, "%") === "12.5%" && E.fmt(1.23, {unit: 100000, dec: 2}, "times") === "1.23", "a ratio is never scaled by the unit");

  // ---------------------------------------------------------------- 4. the definition's check
  console.log("\nThe definition's check");
  let n = D.normalizeDef({name: "X", units: {unit: 7, dec: 5}, period: {kind: "decade"}, blocks: [{type: "radar", rows: {by: "colour"}, measure: "close", cols: {by: "week"}}, {rows: {by: "head", items: ["rev", "nonsense"]}}]});
  ok(n.def.units.unit === 1 && n.def.units.dec === 2 && n.def.period.kind === "fy" && n.def.blocks[0].type === "table" && n.def.blocks[0].rows.by === "head" && n.def.blocks[0].measure === "move" && n.def.blocks[0].cols.by === "month",
    "wrong values replaced by the defaults");
  ok(n.problems.length >= 5 && n.problems.some((p) => /nonsense/.test(p)), "... each one said (" + n.problems.length + ")");
  ok(n.def.blocks[1].rows.items.join() === "rev", "an unknown MIS head left out");
  ctx.S.books = b;
  const data = A.buildMisData(G(), D.normalizeDef({blocks: []}).def, {today: "20260415"});
  const chk = await D.checkNames(D.normalizeDef({blocks: [{rows: {by: "ledger", items: ["tamarind urban bank - ca 0042", "Salaries To Staf"]}}, {rows: {by: "group", items: ["indirect expenses"]}}]}).def, E.lookIn(data));
  ok(chk.def.blocks[0].rows.items[0] === "Tamarind Urban Bank - CA 0042" && chk.def.blocks[1].rows.items[0] === "Indirect Expenses", "a known name takes the books' spelling");
  ok(chk.unknown.length === 1 && chk.unknown[0].name === "Salaries To Staf" && chk.unknown[0].choices.length > 0, "an unknown ledger is listed with the closest names (" + (chk.unknown[0] || {}).choices + ")");
  const ai = D.stripAmounts(D.normalizeDef({name: "MIS ₹ 5,00,000", budget: {"head:rev": {"202504": 500000}}, blocks: [{title: "Sales over 1,00,000"}]}).def);
  ok(!Object.keys(ai.budget).length && !/\d{3}/.test(JSON.stringify(ai.blocks.map((z) => z.title)) + ai.name), "a definition from the AI: no budget, no amount in its words");
  // every template runs on the books, with no problem and a figure in each block
  T.TEMPLATES.forEach((t) => { const rr = run(Object.assign({}, t.def, {period: {kind: "fy", fy: "2025"}})); ok(rr.blocks.length === t.def.blocks.length && rr.blocks.every((z) => !z.error), "template " + t.name + ": " + rr.blocks.length + " blocks worked out"); });

  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
