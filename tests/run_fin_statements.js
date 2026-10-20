// node run_fin_statements.js - the financial statements in the owner's audit format (FinSt, src/js/88-fin-statements.js)
// on made-up books (tests/fixtures/fin-statements: a company shaped like the owner's audit workbooks, and a firm). Every
// expected figure below is worked out by hand from those books (see the comments); the units and decimals are checked
// both by hand-worked lines and by the rules every set of statements must keep (the balance sheet tallies, the checks
// read 0, the cash flow ends at the cash in Note 11).
const {load, openBlob, HTML, DATA, CACHE, FIXTURE} = require("./harness"), fs = require("fs"), path = require("path");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "FS", "FinSt", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(Math.abs((a == null ? NaN : a) - b) < 1e-6, w + ": " + a + (Math.abs((a == null ? NaN : a) - b) < 1e-6 ? "" : " (expected " + b + ")"));
const FIX = path.join(__dirname, "fixtures", "fin-statements");
const read = f => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

// the books FinCom would hold: the ledgers' groups, Tally's balances at the start of the copy (a debit negative, as Tally
// gives them) and one journal per year carrying each ledger's movement, plus the asset purchases on their own dates
function books(F, from, years){
  const under = Object.assign({}, F.groups), led = {};
  Object.entries(F.o).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
  const vouchers = [], bank = Object.keys(under).find(n => under[n] === "Bank Accounts");
  (F.additions || []).forEach(([l, d, a], i) => vouchers.push({id: "a" + i, date: d, type: "Journal", narr: "Purchase of " + l, ent: [{l, a: -a}, {l: bank, a}]}));
  years.forEach(([end, bs, pl, prev]) => {
    const ent = [];
    Object.keys(bs).forEach(n => { if (n === bank) return; const added = (F.additions || []).filter(([l, d]) => l === n && d <= end && d > MIS_shift(end)).reduce((s, z) => s + z[2], 0);
      const mv = Math.round(((bs[n] || 0) - (prev[n] || 0) - added) * 100) / 100; if (mv) ent.push({l: n, a: -mv}); });
    Object.entries(pl).forEach(([n, v]) => { if (v) ent.push({l: n, a: -v}); });
    ent.push({l: bank, a: Math.round(-ent.reduce((s, e) => s + e.a, 0) * 100) / 100});
    vouchers.push({id: "m" + end, date: end, type: "Journal", narr: "Movements for the year (fixture)", ent});
  });
  return {under, groups: {}, ledInfo: {}, vouchers, meta: {from}, tb: {from, to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led}, msme: {}, fs: {}};
}
function MIS_shift(end){ return String(Number(end.slice(0, 4)) - 1) + end.slice(4); }
const C = read("company.json"), Fm = read("firm.json");
const setCo = co => { ctx.CO = () => co; };
const company = () => { const b = books(C, "20240401", [["20250331", C.p, C.plp, C.o], ["20260331", C.c, C.plc, C.p]]); b.msme = {"Bluebell Print Works": "Micro"}; return b; };
const firm = () => books(Fm, "20250401", [["20260331", Fm.c, Fm.plc, Fm.o]]);
const CO = {name: "Larkspur Analytics Private Limited", pan: "AABCL1234F", cin: "U72900KA2015PTC000001", address: "12 Made-up Road, Bengaluru"};
const FIRM = {firmName: "Made-up & Associates", frn: "000000S", partner: "A. Sample", mno: "000001", place: "Bengaluru"};
ctx.S.firm = FIRM;

try {
  const FinSt = x.FinSt;
  ok(FinSt && typeof FinSt.build === "function", "FinSt is in the program (src/js/88-fin-statements.js)");

  console.log("\nThe code catalogue");
  const co = FinSt.codes("co"), nc = FinSt.codes("nc");
  ok(Object.keys(FinSt.CODES).length >= 100, "the catalogue holds " + Object.keys(FinSt.CODES).length + " codes");
  ok(["3A", "4A", "5A", "5B", "6A", "6B", "7A", "7B", "7C", "7D", "8A", "8B", "8C", "8D", "8E", "9A", "10A", "11A", "11B", "11C", "12A", "12B", "12C", "12D", "12E", "13A", "14A", "14B", "14C", "14D", "15A", "15B", "15C", "15D", "15E", "16A", "17A", "17J", "22A", "22B", "22C"].every(k => co[k]),
    "every code of the owner's workbook is in the company catalogue with the same meaning (3A share capital ... 22C deferred tax)");
  ok(co["8A"].note === "8" && co["8C"].ppe === "dep" && co["10A"].note === "10" && co["12B"].note === "12" && co["6A"].msme && co["13A"].side === "PL" && co["3A"].side === "BS",
    "8A/8C sit in the PPE note (gross / depreciation), 10A receivables, 12B advance tax and TDS, 6A the MSE payables");
  ok(!nc["3A"] && nc["3P"] && nc["3Q"] && nc["3R"] && nc["15P"] && nc["16P"] && !co["3P"], "a firm has partners' capital, current accounts, drawings, their remuneration and interest; no share capital");

  console.log("\nsuggest(): a code for each ledger from its Tally group and name");
  [["Equity Share Capital", ["Capital Account"], -100000, "co", "3A"], ["Profit & Loss A/c", ["Reserves & Surplus"], -2967000, "co", "4A"], ["Gratuity Payable", ["Provisions"], -360000, "co", "5A"],
    ["Leave Encashment Payable", ["Provisions"], -150000, "co", "5B"], ["Provision for Income Tax FY 2025-26", ["Provisions"], -683940, "co", "7D"], ["Cedar Cloud Hosting LLP", ["Sundry Creditors"], -210000, "co", "6B"],
    ["Bluebell Print Works", ["Sundry Creditors"], -55000, "co", "6A"], ["TDS Payable 192", ["Duties & Taxes"], -72000, "co", "7C"], ["Salary Payable", ["Current Liabilities"], -275000, "co", "7B"],
    ["Computers", ["Fixed Assets"], 750000, "co", "8A"], ["Accumulated Depreciation - Computers", ["Fixed Assets"], -420000, "co", "8C"], ["Office Equipment", ["Fixed Assets"], 200000, "co", "8B"],
    ["Accumulated Depreciation - Office Equipment", ["Fixed Assets"], -80000, "co", "8D"], ["Furniture and Fixtures", ["Fixed Assets"], 125000, "co", "8F"], ["Deferred Tax Asset", ["Current Assets"], 97000, "co", "9A"],
    ["Maple Holdings Inc", ["Sundry Debtors"], 3100000, "co", "10A"], ["Orchid Retail", ["Sundry Debtors"], -20000, "co", "7E"], ["Northbank Current A/c", ["Bank Accounts"], 3296799.8, "co", "11A"],
    ["Northbank Fixed Deposit 0042", ["Deposits (Asset)"], 700000, "co", "11B"], ["Cash", ["Cash-in-Hand"], 3500, "co", "11D"], ["TDS Receivable FY 2025-26", ["Loans & Advances (Asset)"], 260000, "co", "12B"],
    ["Prepaid Expenses", ["Loans & Advances (Asset)"], 52000, "co", "12C"], ["Input IGST", ["Duties & Taxes"], 75000, "co", "12D"], ["Interest Accrued on FD", ["Current Assets"], 12500, "co", "12E"],
    ["Software Services - Export", ["Sales Accounts"], -11000000, "co", "13A"], ["Interest on Fixed Deposit", ["Indirect Incomes"], -45000, "co", "14A"], ["Interest on Income Tax Refund", ["Indirect Incomes"], -8000, "co", "14D"],
    ["Exchange Gain", ["Indirect Incomes"], -35000, "co", "14C"], ["Salaries", ["Indirect Expenses"], 7200000, "co", "15A"], ["Employer PF Contribution", ["Indirect Expenses"], 360000, "co", "15B"],
    ["Gratuity Expense", ["Indirect Expenses"], 90000, "co", "15E"], ["Interest on TDS", ["Indirect Expenses"], 3500, "co", "16A"], ["Depreciation", ["Indirect Expenses"], 150000, "co", "8E"],
    ["Rent", ["Indirect Expenses"], 660000, "co", "17A"], ["Audit Fees", ["Indirect Expenses"], 75000, "co", "17D"], ["Bank Charges", ["Indirect Expenses"], 5200, "co", "17G"], ["Office Expenses", ["Indirect Expenses"], 48000, "co", "17J"],
    ["Income Tax - Current Year", ["Indirect Expenses"], 0, "co", "22A"], ["Income Tax - Prior Period", ["Indirect Expenses"], 15000, "co", "22B"], ["Deferred Tax Expense", ["Indirect Expenses"], -12000, "co", "22C"],
    ["Asha Rao Capital", ["Capital Account"], -400000, "nc", "3P"], ["Asha Rao Drawings", ["Capital Account"], 120000, "nc", "3R"], ["Asha Rao Current A/c", ["Capital Account"], -50000, "nc", "3Q"],
    ["Partners' Remuneration", ["Indirect Expenses"], 600000, "nc", "15P"], ["Interest on Partners' Capital", ["Indirect Expenses"], 84000, "nc", "16P"]].forEach(([l, gp, bal, kind, want]) => {
    ctx.S.books = company();
    const got = FinSt.suggest(l, gp, bal, kind);
    ok(got === want, "suggest(" + l + ") = " + got + (got === want ? "" : " (expected " + want + ")"));
  });

  console.log("\nThe company: trial balance for 2025-26");
  setCo(CO); let b = company(); ctx.S.books = b;
  b.fs = {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}};
  let tb = FinSt.tb("2025");
  ok(!tb.error, "the trial balance is worked out" + (tb.error ? ": " + tb.error : ""));
  const row = l => tb.rows.find(r => r.ledger === l) || {};
  eq(row("Maple Holdings Inc").cy, 3100000.75, "a debit is positive, as in the workbooks: Maple Holdings CY");
  eq(row("Maple Holdings Inc").py, 2500000, "... and its PY (from the previous year in FinCom's copy)");
  eq(row("Software Services - Export").cy, -11000000, "a revenue ledger: the year's movement, a credit negative");
  eq(row("Software Services - Export").py, -9000000, "... and last year's");
  ok(row("Maple Holdings Inc").code === "10A" && row("Maple Holdings Inc").codeSrc === "suggested", "codes come suggested, marked so");
  ok(row("Maple Holdings Inc").side === "BS" && row("Rent").side === "PL", "each row says its side (the TB's Side column the Excel's EPS and PBT read)");
  const bf = tb.rows.filter(r => r.code === "4A" && r.synthetic);
  ok(bf.length === 1, "last year's profit, still in the income and expense ledgers at the start of the year, is one row coded 4A");
  eq(bf[0] && bf[0].cy, -1564000, "... the profit of 2024-25 (19,74,000 - tax 4,10,000)");
  eq(r6(tb.rows.reduce((s, r) => s + r.final, 0)), 0, "the trial balance totals nil (CY)");
  eq(r6(tb.rows.reduce((s, r) => s + r.py, 0)), 0, "the trial balance totals nil (PY)");
  ok(tb.pySrc === "copy", "PY from the previous year in FinCom's copy (" + tb.pySrc + ")");

  console.log("\nThe statements at Rupees, 2 decimals (hand-worked)");
  let d = FinSt.build("2025", {unit: 1, dec: 2});
  ok(!d.error, "built" + (d.error ? ": " + d.error : ""));
  const n = k => d.notes.find(z => z.key === k) || {total: {}};
  const ln = (k, code) => (n(k).lines || []).find(z => z.code === code) || {};
  ok(d.notes[0] && d.notes[0].no === 3 && d.notes[0].key === "3", "the first note is Note 3 (1 and 2 are the corporate information and policies)");
  eq(n("13").total.cy, 12200000, "Note 13 revenue from operations");
  eq(n("14").total.cy, 88000.4, "Note 14 other income (45,000 + 8,000 + 35,000.40)");
  eq(n("15").total.cy, 8245000, "Note 15 employee benefits");
  eq(n("16").total.cy, 4700, "Note 16 finance costs (interest on TDS and GST)");
  eq(n("17").total.cy, 1274200.35, "Note 17 other expenses");
  eq(d.pl.dep.cy, 150000, "depreciation: the PPE schedule's charge for the year");
  eq(d.pl.pbt.cy, 2614100.05, "profit before tax 26,14,100.05");
  eq(d.pl.pbt.py, 1974000, "profit before tax, PY 19,74,000");
  eq(d.pl.tax.cy, 3000, "tax before the provision: prior years 15,000, deferred tax credit 12,000");
  eq(d.pl.pat.py, 1564000, "profit for the year, PY 15,64,000");
  eq(ln("4", "4A").cy, 4531000, "Note 4: surplus at the beginning = PY closing 29,67,000 + 15,64,000");
  eq(n("6").total.cy, 277000.5, "Note 6 trade payables: MSE 55,000 + others 2,22,000.50");
  eq(ln("6", "6A").cy, 55000, "... the micro and small enterprise (marked MSME) on its own line");
  eq(n("7").total.py, 825000, "Note 7 other current liabilities, PY");
  eq(n("11").total.cy, 4000299.8, "Note 11 cash and bank: 32,96,799.80 + 3,500 + FD 7,00,000");
  eq(n("12").groups.la.cy, 593000, "Note 12(a) short-term loans and advances");
  eq(n("12").groups.oca.cy, 12500, "Note 12(b) other current assets: interest accrued");
  eq(d.ppe.cy.total.M, 545000, "Note 8: net block 5,45,000 (gross 10,75,000 - depreciation 5,30,000)");
  eq(d.ppe.cy.total.E, 175000, "... additions 1,75,000");
  eq(d.ppe.cy.total.I, 150000, "... charge 1,50,000");
  eq(d.ppe.py.total.E, 80000, "... PY additions 80,000 (the year before, from FinCom's copy)");
  eq(d.bs.total.eqL.cy, 8587800.55, "equity and liabilities 85,87,800.55 (before the tax provision the profit is higher by what the provision will be)");
  eq(d.bs.total.assets.cy, 8587800.55, "assets 85,87,800.55");
  eq(d.bs.total.eqL.py, 6141000, "PY total 61,41,000");
  eq(d.bs.total.assets.py, 6141000, "PY assets 61,41,000");
  eq(d.cf.cy.op, 1933499.8 + 0, "cash flow: from operations 19,33,499.80 (provision not yet booked: tax paid still 4,75,000)");
  eq(d.cf.cy.taxPaid, -475000, "... income tax paid 4,75,000 (advance tax 2,00,000 + TDS 2,60,000 + prior years 15,000)");
  eq(d.cf.cy.inv, -326500, "... investing -3,26,500");
  eq(d.cf.cy.fin, -4700, "... financing -4,700");
  eq(d.cf.cy.close, 3300299.8, "... closing cash and cash equivalents 33,00,299.80");
  eq(d.cf.py && d.cf.py.op, 1239000, "PY from operations 12,39,000 (the year before worked out the same way)");
  eq(d.cf.py && d.cf.py.close, 1698000, "PY closing cash 16,98,000");

  console.log("\nComputation of income (115BAA), before the tax provision");
  const cp = d.comp, L = k => (cp.lines.find(z => z.key === k) || {}).v;
  ok(cp.regime === "115BAA", "a company defaults to section 115BAA");
  eq(L("pbt"), 2614100.05, "PBT from the profit and loss");
  eq(L("add_dep"), 150000, "add: book depreciation");
  eq(L("add_40a7"), 90000, "add: gratuity provided (40A(7))");
  eq(L("add_43b_leave"), 150000, "add: leave encashment unpaid (43B)");
  eq(L("add_int_tds"), 3500, "add: interest on late TDS");
  eq(L("add_gst_int"), 1200, "add: GST interest");
  eq(L("add_penalty"), 5000, "add: penalty");
  eq(L("less_itdep"), 146300, "less: depreciation u/s 32 (computers 1,20,000; plant 17,850; furniture 8,450 with the half rate after 30 September)");
  eq(L("less_grat_paid"), 30000, "less: gratuity paid");
  eq(L("less_43b_paid"), 120000, "less: last year's leave encashment, paid this year");
  eq(L("less_ifos"), 53000, "less: interest moved to other sources");
  eq(L("pgbp"), 2664500.05, "business income");
  eq(L("gti"), 2717500.05, "gross total income");
  eq(L("ti"), 2717500, "total income rounded u/s 288A");
  eq(L("tax"), 597850, "tax @ 22%"); eq(L("sur"), 59785, "surcharge @ 10%"); eq(L("cess"), 26305.4, "cess @ 4%");
  eq(L("taxTotal"), 683940, "tax liability"); eq(L("tds"), 260000, "less TDS"); eq(L("adv"), 200000, "less advance tax"); eq(L("payable"), 223940, "payable on self-assessment");
  const dep = cp.itdep.blocks.find(z => z.key === "c40") || {};
  eq(dep.open, 180000, "computers: opening WDV carried from 2024-25 (2,20,000 + 80,000 less 40%)");
  ok(dep.addA === 90000 && dep.addB === 60000, "... additions split at 30 September from the vouchers (90,000 / 60,000)");
  ok(cp.checks.every(z => z.label) && (cp.checks.find(z => z.key === "pbt") || {}).value === 0, "the computation's PBT agrees with the profit and loss");
  ok((cp.checks.find(z => z.key === "provision") || {}).value === -683940, "until the provision is booked, current tax in P&L - tax computed = -6,83,940");

  console.log("\nAdjustments (FinCom only, never posted to Tally) flow into the TB, the notes and the statements");
  FinSt.adjAdd("2025", {dr: "Income Tax - Current Year", cr: "Provision for Income Tax FY 2025-26", amt: 683940, narr: "Provision for income tax"});
  tb = FinSt.tb("2025");
  ok(tb.rows.some(r => r.ledger === "Provision for Income Tax FY 2025-26" && r.adj === -683940 && r.final === -683940 && r.code === "7D"), "a new ledger arrives from the adjustment, credit, coded 7D");
  ok(tb.rows.some(r => r.ledger === "Income Tax - Current Year" && r.adj === 683940 && r.final === 683940), "the debit side");
  d = FinSt.build("2025", {unit: 1, dec: 2});
  eq(d.pl.pat.cy, 1927160.05, "profit for the year after tax 19,27,160.05");
  eq(n("7").groups.ocl ? n("7").total.cy : n("7").total.cy, 1147640, "Note 7 with the provision: 11,47,640");
  eq(d.bs.total.eqL.cy, 8587800.55, "the balance sheet: 85,87,800.55 both sides");
  eq(d.cf.cy.taxPaid, -475000, "tax paid unchanged by the provision");
  ok((d.comp.checks.find(z => z.key === "provision") || {}).value === 0, "provision = tax computed");
  ok(d.checks.every(z => z.value === 0), "every check reads 0: " + d.checks.filter(z => z.value !== 0).map(z => z.label + " " + z.value).join("; "));
  ok(d.checks.length >= 9 && ["bsCy", "bsPy", "tbCy", "unmapped", "surplus", "ppeDep", "cfCy", "compPbt"].every(k => d.checks.some(z => z.key === k)), "the checks of the plan are all there");

  console.log("\nUnits and decimals");
  d = FinSt.build("2025", {unit: 1000, dec: 0});
  eq(n("13").total.cy, 12200, "thousands: revenue 12,200");
  eq(ln("10", "10A").cy, 3190, "thousands: receivables 3,190");
  eq(ln("11", "11D").cy, 4, "thousands: cash 3.5 rounds half away from zero to 4 (as Excel's ROUND)");
  eq(n("11").groups.cce.cy, 3301, "thousands: cash and cash equivalents 3,297 + 4");
  ok(d.inputs.unitLine === "(All amounts in Rupees thousand, unless otherwise stated)", "the unit line: " + d.inputs.unitLine);
  d = FinSt.build("2025", {unit: 1e5, dec: 2});
  eq(n("13").total.cy, 122, "lakhs: revenue 122.00");
  eq(ln("11", "11D").cy, 0.04, "lakhs: cash 0.035 -> 0.04");
  eq(ln("11", "11A").cy, 32.97, "lakhs: bank 32.967998 -> 32.97");
  eq(ln("10", "10A").cy, 31.9, "lakhs: receivables 31.9000075 -> 31.90");
  d = FinSt.build("2025", {unit: 1e7, dec: 2});
  eq(d.ppe.cy.total.M, 0.06, "crores: net block 0.06, not ROUND(0.0545): each gross and depreciation figure rounded (0.08-0.04, 0.02-0.01, 0.01-0.00), then added, as the schedule's formulas do");
  [1, 1000, 1e5, 1e7].forEach(u => [0, 2].forEach(dc => {
    const z = FinSt.build("2025", {unit: u, dec: dc}), bad = z.checks.filter(c2 => c2.value !== 0);
    ok(!bad.length && z.bs.total.eqL.cy === z.bs.total.assets.cy && z.bs.total.eqL.py === z.bs.total.assets.py && Math.abs(z.plug.cy) <= z.inputs.tol && Math.abs(z.plug.py) <= z.inputs.tol &&
      Math.abs(z.pl.pat.cy - 1927160.05 / u) <= z.inputs.tol + 0.5 * Math.pow(10, -dc),
      "unit " + u + ", " + dc + " decimals: tallies (" + z.bs.total.assets.cy + "), rounding put in Note 17 " + z.plug.cy + " / " + z.plug.py + " (tolerance " + z.inputs.tol + "), checks 0" + (bad.length ? ": " + bad.map(c2 => c2.label + " " + c2.value).join("; ") : ""));
    ok(z.notes.every(nt => nt.lines.every(l => l.cy == null || Math.abs(l.cy * Math.pow(10, dc) - Math.round(l.cy * Math.pow(10, dc))) < 1e-6)), "... every note line has " + dc + " decimals at most");
  }));

  console.log("\nMapping by hand: kept, carried to the next year, old line names moved to codes");
  FinSt.mapSet("Office Expenses", "17N");
  ok(b.fs.map["Office Expenses"] === "17N", "a hand code is stored in b.fs.map (synced with the books)");
  tb = FinSt.tb("2025");
  ok(tb.rows.find(r => r.ledger === "Office Expenses").codeSrc === "hand" && tb.rows.find(r => r.ledger === "Office Expenses").code === "17N", "... and shows as by hand");
  ok(FinSt.tb("2024").rows.find(r => r.ledger === "Office Expenses").code === "17N", "... and in the other year too");
  b.fs.map["Willow Labs"] = "stla"; b.fs.map["Cedar Cloud Hosting LLP"] = "tp"; b.fs.map["Prepaid Expenses"] = "oca";
  tb = FinSt.tb("2025");
  ok(tb.rows.find(r => r.ledger === "Willow Labs").code === "12H" && tb.rows.find(r => r.ledger === "Willow Labs").codeSrc === "hand", "an old line name (stla) is read as its code (12H other loans and advances), still by hand");
  const moved = FinSt.migrate(b);
  ok(moved === 3 && b.fs.map["Willow Labs"] === "12H" && b.fs.map["Cedar Cloud Hosting LLP"] === "6B" && b.fs.map["Prepaid Expenses"] === "12K" && b.fs.map["Office Expenses"] === "17N", "migrate() rewrites old line names as codes (" + moved + ")");
  const fsOld = x.FS.build("2025");
  ok(!fsOld.error && (fsOld.det.tp || []).some(([l]) => l === "Cedar Cloud Hosting LLP") && (fsOld.det.stla || []).some(([l]) => l === "Willow Labs") && Math.abs(fsOld.diff) < 1,
    "the old statements (FS) and MIS still read a code in b.fs.map as its line (6B trade payables, 12H loans and advances)");
  FinSt.mapSet("Willow Labs", ""); ok(!("Willow Labs" in b.fs.map), "an empty choice gives the ledger back to the rule");
  delete b.fs.map["Cedar Cloud Hosting LLP"]; delete b.fs.map["Prepaid Expenses"]; delete b.fs.map["Office Expenses"];
  FinSt.mapSet("Rent", "none");
  d = FinSt.build("2025", {unit: 1, dec: 2});
  ok((d.checks.find(z => z.key === "unmapped") || {}).value === 660000 + 600000, "a ledger left without a code shows as the unmapped balance (CY + PY)");
  ok(d.checks.find(z => z.key === "bsCy").value !== 0, "... and the balance sheet no longer tallies (no rounding put to hide it)");
  delete b.fs.map.Rent;

  console.log("\nCompEdits: a line overridden with a reason");
  FinSt.compEdit("2025", "less_itdep", 100000, "as per the tax auditor");
  d = FinSt.build("2025", {unit: 1, dec: 2});
  const e1 = d.comp.lines.find(z => z.key === "less_itdep");
  ok(e1.v === 100000 && e1.edited && e1.why === "as per the tax auditor" && e1.calc === 146300, "the line reads 1,00,000 with the reason, the worked-out 1,46,300 kept beside it");
  eq(d.comp.lines.find(z => z.key === "ti").v, 2763800, "total income follows: 27,17,500.05 + 46,300 rounded");
  FinSt.compEdit("2025", "less_itdep", null);
  ok(FinSt.build("2025", {unit: 1, dec: 2}).comp.lines.find(z => z.key === "less_itdep").v === 146300, "cleared: back to the worked-out figure");

  console.log("\nInputs");
  const inp = FinSt.inputs(CO, FIRM);
  ok(inp.name === CO.name && inp.cin === CO.cin && inp.auditor.firm === FIRM.firmName && inp.auditor.frn === FIRM.frn && inp.auditor.partner === FIRM.partner && inp.auditor.mno === FIRM.mno, "company and auditor from the client and the firm's settings");
  ok(inp.unit === 1000 && inp.dec === 2 && inp.kind === "co", "a company defaults to Rupees thousand, 2 decimals");
  FinSt.inputsSet({unit: 100000, shares: {number: 10000, face: 10, authorised: 100000, holders: [{name: "Maple Holdings Inc", n: 9999}]}, directors: [{name: "A. Director", din: "00000001", desig: "Director"}]});
  ok(b.fs.inputs.unit === 100000 && FinSt.inputs(CO, FIRM).shares.holders[0].n === 9999, "kept per client in b.fs.inputs");
  d = FinSt.build("2025", {});
  ok(d.inputs.unit === 100000 && d.inputs.dec === 2, "build() takes the unit from the inputs when none is given");
  eq(d.pl.eps.cy, Math.round(1927160.05 / 10000 * 100) / 100, "EPS in rupees: profit / 10,000 shares");

  console.log("\nThe firm (30%), PY from the opening balances");
  setCo({name: "Kestrel & Co", pan: "AAAFK1234K"}); b = firm(); ctx.S.books = b; b.fs = {taxDep: {"2025": {c40: 90000}}};
  d = FinSt.build("2025", {unit: 1, dec: 2});
  ok(!d.error && d.kind === "nc" && d.entity === "F", "a firm by its PAN: the non-corporate format");
  ok(d.tb.pySrc === "opening", "PY from the opening balances (" + d.tb.pySrc + "): the balance sheet only");
  ok(!d.notes.some(z => z.key === "3" && /share/i.test(z.title)) && n("3").title === "Partners' capital accounts", "Note 3 is the partners' capital accounts: " + n("3").title);
  ok(d.bs.sections.EQ.label === "Partners' funds", "the balance sheet heading: " + d.bs.sections.EQ.label);
  eq(n("3").total.cy, 1420000, "capital 7,00,000 + current 50,000 - drawings 2,10,000 + profit 8,80,000");
  eq(ln("3", "3R").cy, -210000, "drawings shown as a deduction");
  eq(n("3").total.py, 750000, "PY capital 7,50,000");
  eq(d.pl.pat.cy, 880000, "profit 8,80,000"); eq(d.bs.total.assets.cy, 1255000, "assets 12,55,000"); eq(d.bs.total.eqL.py, 600000, "PY 6,00,000");
  ok(ln("15", "15P").cy === 600000 && ln("16", "16P").cy === 84000, "partners' remuneration and interest shown in their notes");
  eq(d.cf.cy.fin, -294000, "financing: drawings 2,10,000 and interest 84,000");
  eq(d.cf.cy.close, 765000, "closing cash 7,65,000");
  ok(d.cf.py == null, "no PY cash flow without the year before");
  ok(d.pl.eps == null, "no EPS for a firm");
  const fl = k => (d.comp.lines.find(z => z.key === k) || {}).v;
  ok(d.comp.regime === "firm", "a firm's tax: 30%");
  eq(fl("ti"), 904000, "total income 8,80,000 + 60,000 - 36,000"); eq(fl("tax"), 271200, "tax @ 30%"); eq(fl("sur"), 0, "no surcharge below Rs 1 crore"); eq(fl("taxTotal"), 282048, "with cess"); eq(fl("payable"), 282050, "payable rounded to 10");
  ok(d.checks.every(z => z.value === 0), "every check reads 0: " + d.checks.filter(z => z.value !== 0).map(z => z.label + " " + z.value).join("; "));
  b.fs.pyTb = {"2025": {"Consultancy Fees": -2000000, "Salaries": 410000, "Depreciation": 40000, "Profit & Loss A/c": 250000, "Asha Rao Capital": -400000, "Vikram Sen Capital": -300000, "Asha Rao Current A/c": -50000,
    "Laptop": 150000, "Accumulated Depreciation - Laptop": -50000, "Heron Foods": 300000, "Ibis Supplies": -80000, "GST Payable": -20000, "Kestrel Bank": 1750000}};
  d = FinSt.build("2025", {unit: 1, dec: 2});
  ok(d.tb.pySrc === "typed" && ln("13", "13A").py === 2000000 && d.pl.pbt.py === 1550000, "a last-year TB typed or uploaded (b.fs.pyTb) gives the PY profit and loss too");
  eq(d.pl.dep.py, 40000, "... its depreciation from the TB (8E) when there is no schedule for the year before");
  FinSt.regimeSet("normal"); ok(FinSt.build("2025", {unit: 1, dec: 2}).comp.regime === "normal" && b.fs.regime === "normal", "the regime is kept per client");

  console.log("\nDepreciation credited straight to the asset (no accumulated-depreciation ledger), by an adjustment");
  // the company again, its furniture written down by an audit entry Dr Depreciation / Cr Furniture and Fixtures
  setCo(CO); b = company(); ctx.S.books = b; b.fs = {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}};
  const d0 = FinSt.build("2025", {unit: 1, dec: 2});
  FinSt.adjAdd("2025", {dr: "Depreciation", cr: "Furniture and Fixtures", amt: 12500, narr: "Depreciation on furniture, written off the asset"});
  d = FinSt.build("2025", {unit: 1, dec: 2});
  const fu = d.ppe.cy.rows.find(r => r.cls === "furn") || {}, fu0 = d0.ppe.cy.rows.find(r => r.cls === "furn") || {};
  ok(fu.D === fu0.D && fu.E === fu0.E && fu.F === fu0.F && fu.G === fu0.G, "furniture: gross block as before the entry (opening " + fu.D + ", additions " + fu.E + ", closing " + fu.G + ")");
  ok(fu.I === fu0.I + 12500 && fu.K === fu0.K + 12500 && fu.M === fu0.M - 12500, "... the charge and the accumulated depreciation 12,500 more (beside its accumulated-depreciation ledger), net block = the TB's closing (" + fu.I + " / " + fu.K + " / " + fu.M + ")");
  eq(d.pl.dep.cy, 162500, "the profit and loss carries the depreciation: 1,50,000 + 12,500");
  ok(d.checks.every(z => z.value === 0), "every check reads 0: " + d.checks.filter(z => z.value !== 0).map(z => z.label + " " + z.value).join("; "));
  ok((d.tb.rows.find(r => r.ledger === "Furniture and Fixtures") || {}).depCr === 12500, "the TB row says what depreciation was credited to it (depCr, the Excel's column L)");
} catch (e){ console.error(e); fails++; }
function r6(v){ return Math.round(v * 1e6) / 1e6; }

// the standard test books (tests/fixtures/books, or the client's in tests/data): Tally's usual way, the year's
// depreciation credited straight to the assets (Dr Depreciation 60,000 / Cr Laptops 40,000, Cr Licence 20,000) with
// no accumulated-depreciation ledger. The charge must still reach the P&L and the PPE note, and the balance sheet tally
(async () => {
  try {
    console.log("\nThe standard test books: depreciation credited to the asset ledgers");
    const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
    Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, msme: {}, fs: {}});
    b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; setCo({name: FIXTURE ? "Larkspur Fixture Events Private Limited" : "VMS EVENTS PRIVATE LIMITED"}); x.LedMaster.refresh(b);
    const led = {}; Object.entries(b.ledInfo).forEach(([nm, i]) => { led[nm] = {open: i.ob || 0, close: 0, parent: i.group}; });
    b.tb = {from: "20250401", to: "20260331", at: new Date().toISOString(), led};
    const d = x.FinSt.build("2025", {unit: 1, dec: 2});
    ok(!d.error, "built" + (d.error ? ": " + d.error : ""));
    const bad = d.checks.filter(z => z.value !== 0);
    ok(!bad.length, "every check reads 0" + (bad.length ? ": " + bad.map(z => z.label + " " + z.value).join("; ") : ""));
    ok(d.bs.total.eqL.cy === d.bs.total.assets.cy, "the balance sheet tallies: " + d.bs.total.eqL.cy + " / " + d.bs.total.assets.cy);
    if (FIXTURE){
      const lp = d.ppe.cy.rows.find(r => r.cls === "comp") || {}, li = d.intang.cy.rows[0] || {};
      ok(lp.D === 150000 && lp.E === 80000 && lp.F === 0 && lp.G === 230000 && lp.H === 0 && lp.I === 40000 && lp.K === 40000 && lp.M === 190000,
        "laptops: gross 1,50,000 + 80,000 = 2,30,000; depreciation 40,000 (from the Depreciation ledger's entry); net 1,90,000 = the TB (" + ["D", "E", "F", "G", "H", "I", "K", "M"].map(k => k + " " + lp[k]).join(", ") + ")");
      ok(li.D === 0 && li.E === 120000 && li.G === 120000 && li.I === 20000 && li.M === 100000, "the licence (Note 34): 1,20,000 added, amortised 20,000, net 1,00,000 (" + ["D", "E", "G", "I", "M"].map(k => k + " " + li[k]).join(", ") + ")");
      eq(d.pl.dep.cy, 60000, "the P&L: depreciation and amortisation 60,000 (EXPECTED.md)");
      eq(d.pl.pat.cy, 394550, "profit for the year 3,94,550 (EXPECTED.md)");
      eq(d.bs.total.assets.cy, 1553350, "total 15,53,350 each side (EXPECTED.md)");
      eq(d.cf.cy.capex, -200000, "cash flow: purchase of assets 2,00,000 (laptops 80,000 + licence 1,20,000), not net of the depreciation");
    }
  } catch (e){ console.error(e); fails++; }
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
