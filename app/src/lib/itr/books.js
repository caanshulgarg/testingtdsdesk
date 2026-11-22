// The books in the ITR's own shape: Part A-BS, Part A-P&L and the trading account from the financial statements' trial
// balance (FinSt, src/js/88-fin-statements.js: every ledger carries a code), and the adjustments of Schedule BP from the
// books (book depreciation added back, depreciation under section 32 allowed, 40(a)(ia), 40A(3), 43B, 36(1)(va)).
// Every figure keeps the ledgers behind it (trace: [{ledger, group, amt}]), so the page can show where it comes from.
// schedules() and adjustments() are pure (the tests give them rows); fromApp() gathers the inputs on the page.

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };

// a neutral line -> the trial balance codes it adds, and the sign that makes it positive in the ITR
// (TB amounts: debit positive; a liability or income line is the negative of its codes)
export const BS_LINES = [
  // sources of funds
  ["capital", "Proprietor's / partners' capital", ["3P", "3Q", "3R"], -1], ["shareCap", "Share capital", ["3A", "3B"], -1],
  ["reserves", "Reserves and surplus", ["4B", "4C", "4D"], -1], ["plBalance", "Profit and loss balance brought forward", ["4A", "4E"], -1],
  ["securedBank", "Secured loans from banks", ["30A", "33A"], -1], ["unsecuredOthers", "Unsecured loans from others", ["30B", "33B", "33C"], -1],
  ["deferredTax", "Deferred tax liability", ["31A"], -1], ["advancesIn", "Advances received", ["7E"], -1],
  // application of funds
  ["grossBlock", "Gross block", [], 1], ["accDep", "Accumulated depreciation", [], -1], ["cwip", "Capital work-in-progress", ["35A", "35B"], 1],
  ["investLong", "Long-term investments", ["36A"], 1], ["investCurrent", "Current investments", ["37A"], 1], ["inventory", "Inventories", ["39A"], 1],
  ["debtors", "Sundry debtors", ["10A", "10B"], 1], ["cash", "Cash in hand", ["11D"], 1], ["bank", "Balances with banks", ["11A", "11B", "11C"], 1],
  ["otherCA", "Other current assets", ["12E", "12K", "38C"], 1], ["advRecoverable", "Advances recoverable", ["12C", "12F", "12G", "12H", "38B", "38D"], 1],
  ["deposits", "Deposits", ["12A", "38A"], 1], ["revenueAuth", "Balances with revenue authorities", ["12B", "12D"], 1], ["dta", "Deferred tax asset", ["9A"], 1],
  ["creditors", "Sundry creditors and other payables", ["6A", "6B", "7A", "7B", "7C", "7F", "7G", "7H", "32A"], -1],
  ["provTax", "Provision for income tax", ["7D"], -1], ["provEmp", "Provisions for leave, gratuity", ["5A", "5B", "5C", "5E"], -1], ["provOther", "Other provisions", ["5D", "5F", "5G"], -1],
];
export const PL_LINES = [
  ["saleGoods", "Sale of goods", ["13B"], -1], ["saleServices", "Sale of services", ["13A"], -1], ["otherOpRev", "Other operating revenue", ["13C"], -1],
  ["interestInc", "Interest income", ["14A", "14D"], -1], ["profitAssets", "Profit on sale of fixed assets", ["14B"], -1], ["fxGain", "Exchange gain", ["14C"], -1], ["miscInc", "Other income", ["14E"], -1],
  ["materials", "Cost of materials consumed", ["40A"], 1], ["purchases", "Purchases of stock-in-trade", ["41A"], 1], ["stockChange", "Change in inventories", ["42A"], 1],
  ["salaries", "Salaries and wages", ["15A", "15D"], 1], ["pf", "Contribution to PF and other funds", ["15B"], 1], ["staffWelfare", "Staff welfare", ["15C"], 1], ["gratuity", "Gratuity", ["15E"], 1],
  ["partnerRem", "Remuneration to partners", ["15P"], 1], ["interestStat", "Interest on statutory dues", ["16A"], 1], ["interestExp", "Interest on borrowings", ["16B", "16C"], 1], ["partnerInt", "Interest to partners", ["16P"], 1],
  ["rent", "Rent", ["17A"], 1], ["travel", "Travelling and conveyance", ["17C"], 1], ["audit", "Audit fees", ["17D"], 1], ["professional", "Legal and professional", ["17E"], 1],
  ["insurance", "Insurance", ["17F"], 1], ["power", "Power and fuel", ["17K"], 1], ["repairs", "Repairs and maintenance", ["17L"], 1], ["telephone", "Communication", ["17M"], 1],
  ["rates", "Rates and taxes", ["17P"], 1], ["advert", "Advertisement and promotion", ["17Q"], 1], ["csr", "CSR / donations", ["17R"], 1], ["badDebts", "Bad debts", ["17S"], 1],
  ["commission", "Commission and brokerage", ["17V"], 1], ["otherExp", "Other expenses", ["17B", "17G", "17H", "17J", "17N", "17T", "17U", "17W"], 1],
  ["depreciation", "Depreciation and amortisation", ["8E", "34D"], 1], ["exceptional", "Exceptional items", ["43A"], 1],
  ["taxCurrent", "Provision for current tax", ["22A", "22B"], 1], ["taxDeferred", "Deferred tax", ["22C"], 1],
];

// rows: [{ledger, group, code, final (rupees, debit +), py}], codes: FinSt.CODES (for the PPE gross / dep codes)
export function schedules(rows, codes) {
  const by = {};
  rows.forEach((r) => { if (r.code) (by[r.code] = by[r.code] || []).push(r); });
  const line = ([key, label, cs, sign], pick) => {
    const trace = [];
    let cy = 0, py = 0;
    cs.forEach((c) => (by[c] || []).forEach((r) => { cy += N(r.final) * sign; py += N(r.py) * sign; trace.push({ ledger: r.ledger, group: r.group || "", code: c, amt: R(N(r.final) * sign), py: R(N(r.py) * sign) }); }));
    return { key, label, cy: R(cy), py: R(py), trace: pick ? trace.filter(pick) : trace };
  };
  const bs = {}, pl = {};
  BS_LINES.forEach((d) => { bs[d[0]] = line(d); });
  const gross = Object.keys(codes || {}).filter((c) => codes[c].ppe === "gross"), dep = Object.keys(codes || {}).filter((c) => codes[c].ppe === "dep");
  bs.grossBlock = line(["grossBlock", "Gross block", gross, 1]);
  bs.accDep = line(["accDep", "Accumulated depreciation", dep, -1]);
  PL_LINES.forEach((d) => { pl[d[0]] = line(d); });
  const plTotal = (keys) => keys.reduce((s, k) => s + pl[k].cy, 0);
  const revenue = plTotal(["saleGoods", "saleServices", "otherOpRev"]), other = plTotal(["interestInc", "profitAssets", "fxGain", "miscInc"]);
  const expKeys = PL_LINES.map((d) => d[0]).filter((k) => !["saleGoods", "saleServices", "otherOpRev", "interestInc", "profitAssets", "fxGain", "miscInc", "taxCurrent", "taxDeferred"].includes(k));
  const expenses = plTotal(expKeys);
  const pbt = R(revenue + other - expenses), pat = R(pbt - pl.taxCurrent.cy - pl.taxDeferred.cy);
  // the year's profit is not closed into capital in the trial balance: it is added to the owners' funds here
  const equity = R(bs.capital.cy + bs.shareCap.cy + bs.reserves.cy + bs.plBalance.cy + pat);
  const sources = R(equity + bs.securedBank.cy + bs.unsecuredOthers.cy + bs.deferredTax.cy + bs.advancesIn.cy);
  const fixed = R(bs.grossBlock.cy - bs.accDep.cy + bs.cwip.cy);
  const ca = R(bs.inventory.cy + bs.debtors.cy + bs.cash.cy + bs.bank.cy + bs.otherCA.cy), la = R(bs.advRecoverable.cy + bs.deposits.cy + bs.revenueAuth.cy);
  const cl = R(bs.creditors.cy + bs.provTax.cy + bs.provEmp.cy + bs.provOther.cy);
  const apply = R(fixed + bs.investLong.cy + bs.investCurrent.cy + ca + la - cl + bs.dta.cy);
  // trading account: opening and closing stock from the inventory ledgers
  const trading = { sales: R(revenue), openingStock: bs.inventory.py, closingStock: bs.inventory.cy, purchases: pl.purchases.cy + pl.materials.cy, stockChange: pl.stockChange.cy };
  trading.directGap = R(trading.openingStock - trading.closingStock - trading.stockChange);    // 0 when the stock ledgers and 42A agree
  trading.grossProfit = R(trading.sales + trading.closingStock - trading.openingStock - trading.purchases);
  // a code the ITR lines do not take is shown, never dropped
  const used = new Set(BS_LINES.flatMap((d) => d[2]).concat(PL_LINES.flatMap((d) => d[2]), gross, dep));
  const unplaced = rows.filter((r) => r.code && !used.has(r.code) && R(r.final)).map((r) => ({ ledger: r.ledger, code: r.code, amt: R(r.final) }));
  const unmapped = rows.filter((r) => !r.code && R(r.final)).map((r) => ({ ledger: r.ledger, group: r.group || "", amt: R(r.final) }));
  return { bs, pl, trading, totals: { revenue: R(revenue), other: R(other), expenses: R(expenses), pbt, pat, equity, sources, fixed, ca, la, cl, apply, diff: R(sources - apply) }, unplaced, unmapped };
}

// Schedule BP's adjustments. f: {bookDep, itDep, itBlocks, taxProvision, interestIncome (to other sources), profitOnSale,
// lossOnSale, tdsMissed [{party, section, base, disallow}], cash40A3 [{date, party, amount}], dues43B [{ledger, kind, closing,
// paidByDue}], leave43B, msme43Bh, prior43BPaid, pf36va [{ym, ee, due, paidOn, late}], penalties, csr}
// -> {adds, less, itDep}: each {key, label, amt, bp (the Schedule BP line), src, trace}
export function adjustments(f) {
  const adds = [], less = [];
  const add = (key, label, amt, bp, src, trace, why) => { if (R(amt)) adds.push({ key, label, amt: R(amt), bp, src, trace: trace || [], why }); };
  const sub = (key, label, amt, bp, src, trace) => { if (R(amt)) less.push({ key, label, amt: R(amt), bp, src, trace: trace || [] }); };
  add("dep_book", "depreciation debited to the profit and loss account", f.bookDep, "DepreciationDebPLCosAct", "Part A-P&L, depreciation", f.bookDepTrace);
  add("tax", "income tax and deferred tax debited", f.taxProvision, "OthItemDisallowUs28To44DA", "Part A-P&L, tax provisions", f.taxTrace);
  const tds = (f.tdsMissed || []).filter((x) => R(x.disallow));
  add("40aia", "30% of sums on which TDS was not deducted or paid (section 40(a)(ia))", tds.reduce((s, x) => s + N(x.disallow), 0), "AmtDebPLDisallowUs40", "FinCom's TDS: should have deducted",
    tds.map((x) => ({ ledger: x.party, group: "section " + x.section, amt: R(x.disallow), note: "30% of " + R(x.base) })));
  const cash = f.cash40A3 || [];
  add("40a3", "cash payments above the limit (section 40A(3))", cash.reduce((s, x) => s + N(x.amount), 0), "AmtDebPLDisallowUs40A", "Audit: cash payments above Rs 10,000 a day",
    cash.map((x) => ({ ledger: x.party, group: x.date, amt: R(x.amount) })));
  const dues = (f.dues43B || []).filter((x) => R(N(x.closing) - N(x.paidByDue)) > 0);
  add("43b", "statutory dues unpaid by the due date of the return (section 43B)", dues.reduce((s, x) => s + Math.max(0, N(x.closing) - N(x.paidByDue)), 0), "AmtDebPLDisallowUs43B", "Balances at 31-03-2026 and payments after",
    dues.map((x) => ({ ledger: x.ledger, group: x.kind, amt: R(N(x.closing) - N(x.paidByDue)), note: "payable " + R(x.closing) + ", paid by the due date " + R(x.paidByDue) })));
  add("43b_leave", "leave encashment and bonus provided, not paid (section 43B)", f.leave43B, "AmtDebPLDisallowUs43B", "Provisions 5B / 5C", f.leaveTrace);
  add("43bh", "dues to micro and small enterprises beyond 45 days (section 43B(h))", f.msme43Bh, "AmtDebPLDisallowUs43B", "Audit: MSME bills unpaid", f.msmeTrace);
  const late = (f.pf36va || []).filter((x) => x.late);
  add("36va", "employees' PF / ESI contributions paid after their due dates (section 36(1)(va))", late.reduce((s, x) => s + N(x.ee), 0), "AmtDebPLDisallowUs36", "ECR and challans brought in",
    late.map((x) => ({ ledger: (x.fund || "PF") + " " + x.ym.slice(4, 6) + "-" + x.ym.slice(0, 4), group: "due " + x.due + ", paid " + (x.paidOn || "not paid"), amt: R(x.ee) })));
  add("penalty", "penalties and interest on taxes (section 37)", f.penalties, "AmtDebPLDisallowUs37", "Audit: penalties", f.penaltyTrace);
  add("csr", "CSR expenditure (Explanation 2 to section 37(1))", f.csr, "AmtDebPLDisallowUs37", "Part A-P&L, CSR");
  add("loss_sale", "loss on sale of fixed assets", f.lossOnSale, "OthItemDisallowUs28To44DA", "Part A-P&L, loss on sale");
  sub("os_interest", "interest income shown under other sources", f.interestIncome, "IncRecCredPLOthHeadDtls.OtherSources", "Part A-P&L, interest income", f.interestTrace);
  sub("profit_sale", "profit on sale of fixed assets (taken in the block, section 43(6))", f.profitOnSale, "AnyOthAmtAllDeduct", "Part A-P&L, profit on sale");
  sub("43b_prior", "43B dues of earlier years paid this year", f.prior43BPaid, "AmtDisallUs43BNowAllow", "Last year's 43B, paid");
  return { adds, less, itDep: f.itDep == null ? null : R(f.itDep) };
}

// 36(1)(va) from the files brought in: for each wage month, the employees' share and when it reached the fund
// ecr: [{wageMonth, data: {ee}}], pfc: [{wageMonth, paidOn}], esi: [{wageMonth, paidOn, data: {ee}}]
export function pf36va(ecr, pfc, esi) {
  const due = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6), ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1; return String(ny) + String(nm).padStart(2, "0") + "15"; };
  const out = [];
  (ecr || []).forEach((e) => {
    const pays = (pfc || []).filter((c) => c.wageMonth === e.wageMonth), paidOn = pays.map((c) => c.paidOn).sort().slice(-1)[0] || "";
    out.push({ fund: "PF", ym: e.wageMonth, ee: N(e.data && e.data.ee), due: due(e.wageMonth), paidOn, late: !paidOn || paidOn > due(e.wageMonth), missing: !paidOn });
  });
  (esi || []).forEach((c) => { if (c.data && c.data.ee != null) out.push({ fund: "ESI", ym: c.wageMonth, ee: N(c.data.ee), due: due(c.wageMonth), paidOn: c.paidOn, late: c.paidOn > due(c.wageMonth), missing: false }); });
  return out.sort((a, b) => (a.ym + a.fund).localeCompare(b.ym + b.fund));
}

// ------------- on the page -------------
// fy "2025"; returns {ok, sched, adj, dep, gst, tds, audit3cd, notes} or {ok: false, missing: [...]}: what is not there is
// said ("Missing data"), never made up
export function fromApp(fy, imports) {
  const G = typeof window === "object" ? window : globalThis, FinSt = G.FinSt, b = G.S && G.S.books;
  if (!b || !(b.vouchers || []).length) return { ok: false, missing: ["The day book is not in yet: bring the books in from Tally."] };
  if (!FinSt) return { ok: false, missing: ["The statements' program is not loaded."] };
  const d = FinSt.build(fy, { unit: 1, dec: 0 });
  if (!d || d.error) return { ok: false, missing: ["The financial statements could not be made: " + ((d && d.error) || "") + "."] };
  const rows = (d.tb.rows || []).map((r) => ({ ledger: r.ledger, group: r.group, code: r.code, final: r.final, py: r.py }));
  const sched = schedules(rows, FinSt.CODES);
  const td = FinSt.taxDep ? FinSt.taxDep(fy) : null;
  const notes = [];
  // the audit's findings for the year, worked out without writing anything (Audit.calcIn)
  let findings = [];
  try {
    if (G.Audit && G.Audit.calcIn) { const it = G.Audit.calcIn(fy + "0401", (+fy + 1) + "0331"); let r; while (!(r = it.next()).done); findings = (r.value && r.value.findings) || []; }
    else notes.push("Audit checks are not loaded: 40(a)(ia), 40A(3) and 43B from the books are missing.");
  } catch (e) { notes.push("Audit checks could not run: " + ((e && e.message) || e)); }
  const fnd = (id) => findings.filter((x) => x.id === id || x.check === id);
  const byCode = (c) => sched.pl[Object.keys(sched.pl).find((k) => PL_LINES.find((x) => x[0] === k)[2].includes(c))];
  const f = {
    bookDep: sched.pl.depreciation.cy, bookDepTrace: sched.pl.depreciation.trace,
    itDep: td && td.total != null ? td.total : null, itBlocks: td ? td.blocks : [],
    taxProvision: sched.pl.taxCurrent.cy + sched.pl.taxDeferred.cy, taxTrace: sched.pl.taxCurrent.trace.concat(sched.pl.taxDeferred.trace),
    interestIncome: sched.pl.interestInc.cy, interestTrace: sched.pl.interestInc.trace, profitOnSale: sched.pl.profitAssets.cy,
    lossOnSale: (sched.pl.otherExp.trace.filter((t) => t.code === "17T")).reduce((s, t) => s + t.amt, 0),
    tdsMissed: fnd("tdsMissed").map((x) => ({ party: x.party, section: x.section, base: x.base, disallow: R(N(x.base) * 0.3) })),
    cash40A3: fnd("cash40A3").flatMap((x) => (x.rows || []).map((r) => ({ date: r.date, party: r.party, amount: r.amount }))),
    msme43Bh: fnd("msme43Bh").reduce((s, x) => s + N(x.amount), 0),
    penalties: fnd("penalties").reduce((s, x) => s + N(x.amount), 0),
    csr: byCode("17R") ? sched.pl.csr.cy : 0,
    leave43B: Math.max(0, sched.bs.provEmp.trace.filter((t) => t.code === "5B" || t.code === "5C").reduce((s, t) => s + t.amt - t.py, 0)),
    pf36va: imports ? pf36va(imports.ecr, imports.pfc, imports.esi) : [],
    dues43B: [],
  };
  const d43 = fnd("balances:43B")[0] || findings.find((x) => x.key === "43B");
  if (d43) notes.push("Statutory dues payable at the year end are listed under Checks; whether each was paid by the due date is asked there.");
  return { ok: true, fy, sched, f, adj: adjustments(f), dep: td, findings, notes, comp: d.comp, inputs: d.inputs };
}
