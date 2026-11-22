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
  // 40(a)(ia): 30% of the sums on which TDS was not deducted, and of those whose TDS was deducted but not deposited by the
  // due date of the return; 40(a)(i): the whole sum paid to a non-resident without TDS
  const tds = (f.tdsMissed || []).filter((x) => R(x.base)), unp = (f.tdsUnpaid || []).filter((x) => R(x.base));
  add("40aia", "30% of sums on which TDS was not deducted, or not deposited by the due date (section 40(a)(ia))", tds.concat(unp).reduce((s, x) => s + N(x.base) * 0.3, 0), "AmtDebPLDisallowUs40", "FinCom's TDS: should have deducted; deducted but not deposited",
    tds.map((x) => ({ ledger: x.party, group: "section " + x.section + ", not deducted", amt: R(N(x.base) * 0.3), note: "30% of " + R(x.base) })).concat(unp.map((x) => ({ ledger: x.party, group: "section " + x.section + ", not deposited by the due date", amt: R(N(x.base) * 0.3), note: "30% of " + R(x.base) }))));
  const nr = (f.nrMissed || []).filter((x) => R(x.base));
  add("40ai", "sums paid to non-residents without TDS (section 40(a)(i))", nr.reduce((s, x) => s + N(x.base), 0), "AmtDebPLDisallowUs40", "FinCom's TDS: non-resident payments", nr.map((x) => ({ ledger: x.party, group: "section " + (x.section || "195"), amt: R(x.base) })));
  const cash = f.cash40A3 || [];
  add("40a3", "cash payments above the limit (section 40A(3))", cash.reduce((s, x) => s + N(x.amount), 0), "AmtDebPLDisallowUs40A", "Audit: cash payments above Rs 10,000 a day",
    cash.map((x) => ({ ledger: x.party, group: x.date, amt: R(x.amount) })));
  const dues = (f.dues43B || []).filter((x) => x.kind43B && !x.unknown && R(N(x.closing) - N(x.paidByDue)) > 0);
  add("43b", "statutory dues unpaid by the due date of the return (section 43B)", dues.reduce((s, x) => s + Math.max(0, N(x.closing) - N(x.paidByDue)), 0), "AmtDebPLDisallowUs43B", "Balances at 31-03-2026 and payments after",
    dues.map((x) => ({ ledger: x.ledger, group: x.kind, amt: R(N(x.closing) - N(x.paidByDue)), note: "payable " + R(x.closing) + ", paid by the due date " + R(x.paidByDue) })));
  add("43b_leave", "leave encashment and bonus provided, not paid (section 43B)", f.leave43B, "AmtDebPLDisallowUs43B", "Provisions 5B / 5C", f.leaveTrace);
  const mrows = f.msmeRows || [];
  add("43bh", "dues to micro and small enterprises not paid within the time of the MSMED Act (section 43B(h))", mrows.length ? mrows.reduce((s, x) => s + N(x.amt), 0) : f.msme43Bh, "AmtDebPLDisallowUs43B", "the books: MSME bills open at the year end and when settled",
    mrows.map((x) => ({ ledger: x.party, group: (x.ref || "") + " limit " + x.limit + (x.paidOn ? ", paid " + x.paidOn : ", unpaid"), amt: R(x.amt) })));
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
    // no challan: the payment date is not known: neither disallowed nor taken as in time (the checks ask)
    out.push({ fund: "PF", ym: e.wageMonth, ee: N(e.data && e.data.ee), due: due(e.wageMonth), paidOn, late: !!paidOn && paidOn > due(e.wageMonth), missing: !paidOn });
  });
  (esi || []).forEach((c) => { if (c.data && c.data.ee != null) out.push({ fund: "ESI", ym: c.wageMonth, ee: N(c.data.ee), due: due(c.wageMonth), paidOn: c.paidOn, late: !!c.paidOn && c.paidOn > due(c.wageMonth), missing: !c.paidOn }); });
  return out.sort((a, b) => (a.ym + a.fund).localeCompare(b.ym + b.fund));
}

// 43B: what each payable ledger is, and whether 43B applies to it (a deduction claimed only when paid)
export function kind43B(ledger) {
  const l = String(ledger || "").toUpperCase();
  if (/\bTDS\b|\bTCS\b|TAX DEDUCTED|TAX COLLECTED/.test(l)) return { kind: "tds", on: false };
  if (/GST|CGST|SGST|IGST|UTGST|OUTPUT TAX/.test(l)) return { kind: "gst", on: false };
  if (/PROVIDENT|\bE?PF\b/.test(l)) return { kind: "pf", on: true };
  if (/\bESIC?\b|STATE INSURANCE/.test(l)) return { kind: "esi", on: true };
  if (/BONUS/.test(l)) return { kind: "bonus", on: true };
  if (/LEAVE/.test(l)) return { kind: "leave", on: true };
  if (/INTEREST/.test(l) && /BANK|LOAN|NBFC|FINANCE|ACCRUED/.test(l)) return { kind: "interest", on: true };
  if (/PROFESSION(AL)? TAX|\bP\.?T\.? PAYABLE|PROPERTY TAX|MUNICIPAL|ELECTRICITY DUTY|STAMP DUTY|CESS|CUSTOMS|EXCISE|LABOUR WELFARE/.test(l)) return { kind: "tax", on: true };
  return null;
}
// rows: payable ledgers at the year end [{ledger, closing (positive = payable)}]; pays: payments after the year end
// [{ledger, date, amt}] (debits in the later entries, and the March PF / ESI challans); due: the return's due date;
// last: the books' last date; share: {pf, esi} the employer's part of a PF / ESI payable (March's ECR / challan) or null
export function dues43B(rows, pays, due, last, share) {
  const out = [];
  rows.forEach((r) => {
    const k = kind43B(r.ledger); if (!k || R(r.closing) <= 0) return;
    let closing = R(r.closing), part = 1, unknownShare = false;
    if (k.kind === "pf" || k.kind === "esi") { const sh = share && share[k.kind]; if (sh == null) unknownShare = true; else part = sh; }
    const mine = pays.filter((p) => p.ledger === r.ledger && p.date <= due).sort((a, b) => a.date.localeCompare(b.date));
    let paid = 0; const dates = [];
    mine.forEach((p) => { if (paid < closing) { paid += N(p.amt); dates.push(p.date); } });
    paid = Math.min(R(paid), closing);
    const open = closing - paid;
    // the employer's part of what is open (PF / ESI): the employee's part is 36(1)(va), not 43B
    out.push({ ledger: r.ledger, kind: k.kind, kind43B: k.on, closing: k.on && part < 1 ? R(closing * part) : closing, paidByDue: k.on && part < 1 ? R(paid * part) : paid, dates,
      unknown: (open > 0 && (!last || last < due)) || (unknownShare && open > 0), trace: r.trace || [] });
  });
  return out;
}
// 43B(h): bills of micro and small suppliers open at the year end; each is allowed this year only if paid within the
// days of section 15 of the MSMED Act (15, or the agreed days up to 45) of its date: paid later (even after 31 March,
// before the return) or unpaid, it is added back. bills: [{party, ref, date, amt, paidOn (yyyymmdd or "")}]
export function msme43Bh(bills, days, fyEnd, last) {
  const add = (d, n) => { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 864e5); return t.toISOString().slice(0, 10).replace(/-/g, ""); };
  const rows = [], unknown = [];
  (bills || []).forEach((b) => {
    const limit = add(b.date, N(days) || 15), x = Object.assign({}, b, { limit });
    if (limit <= fyEnd) { rows.push(x); return; }                       // already beyond the days at the year end
    if (b.paidOn && b.paidOn <= limit) return;                           // paid in time: allowed
    if (b.paidOn && b.paidOn > limit) { rows.push(x); return; }          // paid late
    if (!last || last < limit) unknown.push(x); else rows.push(x);       // unpaid: late once the limit has passed
  });
  return { rows, unknown, days: N(days) || 15 };
}
// the profit before tax as Tally's own profit and loss gives it: every ledger under Tally's revenue groups (sales,
// purchases, direct and indirect incomes and expenses, by the books' group chain, not FinCom's codes), with the stock
export function tallyPbt(movements, groupOf, stock) {
  const REV = /^(SALES ACCOUNTS|PURCHASE ACCOUNTS|DIRECT INCOMES|INDIRECT INCOMES|DIRECT EXPENSES|INDIRECT EXPENSES|INCOME \(DIRECT\)|INCOME \(INDIRECT\)|EXPENSES \(DIRECT\)|EXPENSES \(INDIRECT\))$/i;
  let pl = 0, n = 0;
  Object.keys(movements).forEach((l) => { const g = groupOf(l); if (g && REV.test(g)) { pl += N(movements[l]); n++; } });
  if (!n || !stock) return null;
  return R(-pl + N(stock.closing) - N(stock.opening));
}

// ------------- on the page -------------
// fy "2025"; returns {ok, sched, adj, f, dep, findings, plTally, openingTally, pyBs, capital, dues43B, msme, tds, form3cd,
// esiBooks, nrAsk} or {ok: false, missing: [...]}: what is not there is said ("Missing data"), never made up
export function fromApp(fy, imports, due) {
  const G = typeof window === "object" ? window : globalThis, FinSt = G.FinSt, b = G.S && G.S.books;
  if (!b || !(b.vouchers || []).length) return { ok: false, missing: ["The day book is not in yet: bring the books in from Tally."] };
  if (!FinSt) return { ok: false, missing: ["The statements' program is not loaded."] };
  const d = FinSt.build(fy, { unit: 1, dec: 0 });
  if (!d || d.error) return { ok: false, missing: ["The financial statements could not be made: " + ((d && d.error) || "") + "."] };
  const y0 = fy + "0401", y1 = (+fy + 1) + "0331";
  due = due || ((+fy + 1) + "0831");
  const rows = (d.tb.rows || []).filter((r) => !r.synthetic || r.code).map((r) => ({ ledger: r.ledger, group: r.group, code: r.code, final: r.final, py: r.py, side: r.side }));
  const sched = schedules(rows, FinSt.CODES);
  const td = FinSt.taxDep ? FinSt.taxDep(fy) : null;
  const notes = [], vs = (b.vouchers || []).filter((v) => !v.cancel && !v.optional);
  let last = ""; vs.forEach((v) => { if (v.date > last) last = v.date; });
  // the audit's findings for the year, worked out without writing anything (Audit.calcIn)
  let findings = [];
  try {
    if (G.Audit && G.Audit.calcIn) { const it = G.Audit.calcIn(y0, y1); let r; while (!(r = it.next()).done); findings = (r.value && r.value.findings) || []; }
    else notes.push("Audit checks are not loaded: 40A(3) and the penalties from the books are missing.");
  } catch (e) { notes.push("Audit checks could not run: " + ((e && e.message) || e)); }
  const fnd = (id) => findings.filter((x) => x.id === id || x.check === id);
  // TDS records: not deducted (TDSWatch), deducted but not deposited by the due date, non-resident parties (27Q's nrInfo)
  const nrInfo = b.nrInfo || {}, foreign = /\b(INC|LLC|GMBH|PTE|PTY|IRELAND|SINGAPORE|USA|UK|B\.?V|AG|SARL)\b/i;
  let missed = [], unpaid = [], tdsRec = null;
  try {
    if (G.TDSWatch && G.TDSWatch.missed) missed = G.TDSWatch.missed(fy + "-" + String(+fy + 1).slice(2)).map((e) => ({ party: e.party, section: e.section, base: N(e.uncovered) }));
    if (G.TDS && G.TDS.allRows) {
      const ch = {}; (G.TDS.challans() || []).forEach((c) => { ch[c.id] = c; });
      const fyRows = G.TDS.allRows().filter((r) => r.date >= y0 && r.date <= y1);
      unpaid = fyRows.filter((r) => !r.challan || !ch[r.challan] || String(ch[r.challan].date || "") > due).map((r) => ({ party: r.party, section: r.section, base: N(r.paid), tds: N(r.tds) }));
      tdsRec = { ok: true, deducted: R(fyRows.reduce((a, r) => a + N(r.tds), 0)), deposited: R(fyRows.filter((r) => r.challan && ch[r.challan] && String(ch[r.challan].date || "") <= due).reduce((a, r) => a + N(r.tds), 0)),
        unpaid: unpaid.map((x) => ({ party: x.party, section: x.section, tds: x.tds })), missedBase: 0, unpaidBase: 0, nrBase: 0 };
    }
  } catch (e) { notes.push("TDS could not be read: " + ((e && e.message) || e)); }
  const nrMissed = missed.filter((x) => nrInfo[x.party]), resMissed = missed.filter((x) => !nrInfo[x.party]);
  const nrAsk = resMissed.filter((x) => foreign.test(x.party)).map((x) => x.party);
  if (tdsRec) { tdsRec.missedBase = R(resMissed.reduce((a, x) => a + x.base, 0)); tdsRec.unpaidBase = R(unpaid.reduce((a, x) => a + x.base, 0)); tdsRec.nrBase = R(nrMissed.reduce((a, x) => a + x.base, 0)); }
  // 43B: the payable ledgers at the year end, and the payments in the later entries and the March challans up to the due date
  const pays = [];
  vs.forEach((v) => { if (v.date <= y1 || v.date > due) return; (v.ent || []).forEach((e) => { if (N(e.a) < 0) pays.push({ ledger: e.l, date: v.date, amt: -N(e.a) }); }); });
  const im = imports || {}, march = (xs) => (xs || []).filter((x) => x.wageMonth === (+fy + 1) + "03");
  const ecrM = march(im.ecr)[0], esiM = march(im.esi)[0];
  const share = { pf: ecrM ? (N(ecrM.data.eps) + N(ecrM.data.er)) / Math.max(1, N(ecrM.data.ee) + N(ecrM.data.eps) + N(ecrM.data.er)) : null, esi: esiM && esiM.data.er != null ? N(esiM.data.er) / Math.max(1, N(esiM.data.er) + N(esiM.data.ee)) : null };
  const payRows = rows.filter((r) => ["7B", "7C", "7G", "5B", "5C", "5F", "5G"].includes(r.code)).map((r) => ({ ledger: r.ledger, closing: -N(r.final) }));
  march(im.pfc).forEach((c) => { const l = payRows.find((r) => kind43B(r.ledger) && kind43B(r.ledger).kind === "pf"); if (l && c.paidOn <= due) pays.push({ ledger: l.ledger, date: c.paidOn, amt: N(c.data.total) }); });
  march(im.esi).forEach((c) => { const l = payRows.find((r) => kind43B(r.ledger) && kind43B(r.ledger).kind === "esi"); if (l && c.paidOn <= due) pays.push({ ledger: l.ledger, date: c.paidOn, amt: N(c.data.total) }); });
  const dues = dues43B(payRows, pays, due, last, share);
  // 43B(h): MSME bills open at the year end, settled when (the payables' ageing at each bill's limit date)
  let msme = null;
  try {
    if (G.MIS && G.MIS.ageing && G.MIS.msme) {
      const types = G.MIS.msme(), days = N((G.MIS.cfg(b) || {}).msmeDays) || 15, ag = G.MIS.ageing(y1, "p", null), memo = {};
      const openAt = (dt) => (memo[dt] = memo[dt] || G.MIS.ageing(dt, "p", null));
      const bills = [];
      ag.rows.forEach((pr) => { if (!/micro|small/i.test(types[pr.party] || "")) return; (pr.open || []).forEach((x) => bills.push({ party: pr.party, ref: x.ref, date: x.date, amt: N(x.left), paidOn: "" })); });
      const res = msme43Bh(bills, days, y1, last);
      // a bill whose limit falls inside the books: still open at its limit date means paid late or unpaid
      res.unknown = res.unknown.filter((x) => x.limit > last);
      const keepRows = res.rows.filter((x) => {
        if (x.limit <= y1 || x.limit > last) return true;
        const pr = openAt(x.limit).rows.find((z) => z.party === x.party), still = pr && (pr.open || []).some((z) => z.ref === x.ref && z.date === x.date);
        return !!still;
      });
      msme = { rows: keepRows, unknown: res.unknown, days };
    }
  } catch (e) { notes.push("MSME bills could not be read: " + ((e && e.message) || e)); }
  // the profit before tax from Tally's own groups (not FinCom's codes), with the stock-in-hand ledgers
  const mov = {};
  vs.forEach((v) => { if (v.date < y0 || v.date > y1) return; (v.ent || []).forEach((e) => { mov[e.l] = (mov[e.l] || 0) - N(e.a); }); });
  const prim = (l) => { const p = typeof G.ledGroupPath === "function" ? G.ledGroupPath(b, l) : []; return p.length ? String(p[p.length - 1]).toUpperCase() : ""; };
  const stockRows = rows.filter((r) => /STOCK.IN.HAND/i.test(r.group || "") || /STOCK.IN.HAND/.test(prim(r.ledger)));
  const stock = stockRows.length || !sched.bs.inventory.cy ? { closing: stockRows.reduce((a, r) => a + N(r.final), 0), opening: stockRows.reduce((a, r) => a + N(r.py), 0) } : null;
  const plTally = tallyPbt(mov, prim, stock);
  // opening balances (Tally) against last year's audited balance sheet, uploaded (FinPyBs)
  const bsRows = rows.filter((r) => r.code && FinSt.CODES[r.code] && FinSt.CODES[r.code].side === "BS");
  const openSched = schedules(bsRows.map((r) => Object.assign({}, r, { final: r.py, py: 0 })), FinSt.CODES);
  let pyBs = null;
  try {
    const v = G.FinPyBs && G.FinPyBs.latest ? G.FinPyBs.latest(fy) : null;
    if (v) { const kind = (b.fs && b.fs.kind) || (d.kind || "co"), py = G.FinPyBs.pyRows(v, kind) || {};
      const pys = schedules(Object.keys(py).map((code) => ({ ledger: code, code, final: N(py[code]), py: 0 })), FinSt.CODES);
      pyBs = { total: pys.totals.apply, capital: pys.bs.capital.cy + pys.bs.shareCap.cy + pys.bs.reserves.cy + pys.bs.plBalance.cy, src: "last year's audited balance sheet, uploaded " + String(v.at || "").slice(0, 10) }; }
  } catch (e) { notes.push("Last year's balance sheet could not be read: " + ((e && e.message) || e)); }
  // capital: the year's entries in the capital ledgers
  const capL = new Set(rows.filter((r) => ["3P", "3Q", "3R"].includes(r.code)).map((r) => r.ledger));
  let introduced = 0, drawings = 0;
  vs.forEach((v) => { if (v.date < y0 || v.date > y1) return; (v.ent || []).forEach((e) => { if (!capL.has(e.l)) return; if (N(e.a) > 0) introduced += N(e.a); else drawings += -N(e.a); }); });
  const capital = { closing: R(sched.bs.capital.cy + sched.bs.plBalance.cy + sched.totals.pat), profit: sched.totals.pat, introduced: R(introduced), drawings: R(drawings) };
  // 3CD: the saved Audit run of the whole year, its clauses' totals
  let form3cd = null;
  try {
    const run = b.audit && b.audit.last;
    if (run && G.Audit && G.Audit.form3cd && String(run.from) === y0 && String(run.to) === y1) {
      const cd = G.Audit.form3cd(run), cl = (no) => (cd.find ? cd.find((x) => x.no === no) : null) || { rows: [] };
      const amt = (c, i) => R((c.rows || []).reduce((a, r) => a + N(r[i]), 0));
      form3cd = [{ clause: "21(b)(ii)(A)", what: "sums on which TDS was not deducted", amt: amt(cl("21(b)(ii)(A)"), 1), itrBase: R(resMissed.reduce((a, x) => a + x.base, 0)), itrSrc: "the sums behind 40(a)(ia) in Schedule BP", at: run.at },
        { clause: "21(d)(A)", what: "cash payments above the limit", amt: amt(cl("21(d)(A)"), 2), itrKey: "add:40a3", itrSrc: "Schedule BP, 40A(3)", at: run.at }];
    }
  } catch (e) { notes.push("The 3CD draft could not be read: " + ((e && e.message) || e)); }
  const byName = (re) => sched.pl.salaries.trace.concat(sched.pl.pf.trace, sched.pl.staffWelfare.trace).filter((t) => re.test(t.ledger));
  const esiL = byName(/\bESIC?\b|STATE INSURANCE/i);
  const f = {
    bookDep: sched.pl.depreciation.cy, bookDepTrace: sched.pl.depreciation.trace,
    itDep: td && td.total != null ? td.total : null, itBlocks: td ? td.blocks : [],
    taxProvision: sched.pl.taxCurrent.cy + sched.pl.taxDeferred.cy, taxTrace: sched.pl.taxCurrent.trace.concat(sched.pl.taxDeferred.trace),
    interestIncome: sched.pl.interestInc.cy, interestTrace: sched.pl.interestInc.trace, profitOnSale: sched.pl.profitAssets.cy,
    lossOnSale: (sched.pl.otherExp.trace.filter((t) => t.code === "17T")).reduce((a, t) => a + t.amt, 0),
    tdsMissed: resMissed, tdsUnpaid: unpaid.map((x) => ({ party: x.party, section: x.section, base: x.base })), nrMissed,
    cash40A3: fnd("cash40A3").flatMap((x) => (x.rows || []).map((r) => ({ date: r.date, party: r.party, amount: r.amount }))),
    msmeRows: msme ? msme.rows : [], penalties: fnd("penalties").reduce((a, x) => a + N(x.amount), 0), csr: sched.pl.csr.cy,
    leave43B: 0, pf36va: imports ? pf36va(imports.ecr, imports.pfc, imports.esi) : [], dues43B: dues,
  };
  return { ok: true, fy, sched, f, adj: adjustments(f), dep: td, findings, notes, comp: d.comp, inputs: d.inputs, plTally, openingTally: openSched.totals.apply, pyBs, capital, dues43B: dues, msme,
    tds: tdsRec, form3cd, esiBooks: esiL.length ? R(esiL.reduce((a, t) => a + t.amt, 0)) : null, nrAsk, last };
}
