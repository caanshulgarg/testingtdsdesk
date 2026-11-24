// The books in the ITR's own shape: Part A-BS, Part A-P&L and the trading account from the financial statements' trial
// balance (FinSt, src/js/88-fin-statements.js: every ledger carries a code), and the adjustments of Schedule BP from the
// books (book depreciation added back, depreciation under section 32 allowed, 40(a)(ia), 40A(3), 43B, 36(1)(va)).
// Every figure keeps the ledgers behind it (trace: [{ledger, group, amt}]), so the page can show where it comes from.
// schedules() and adjustments() are pure (the tests give them rows); fromApp() gathers the inputs on the page.

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };

// a neutral line -> the trial balance codes it adds, and the sign that makes it positive in the ITR
// (TB amounts: debit positive; a liability or income line is the negative of its codes)
import { page } from "./page.js";
export const BS_LINES = [
  // sources of funds
  // (3S, 4F: what the Profit & Loss A/c took in the year, the statements' own lines: the profit credited to the partners, appropriations)
  ["capital", "Proprietor's / partners' capital", ["3P", "3Q", "3R", "3S"], -1], ["shareCap", "Share capital", ["3A", "3B"], -1],
  ["reserves", "Reserves and surplus", ["4B", "4C", "4D"], -1], ["plBalance", "Profit and loss balance brought forward", ["4A", "4E", "4F"], -1],
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
  // 40(a)(i): the whole sum paid to a non-resident on which TDS was not deducted, or deducted and not deposited by the
  // due date of the return
  const nr = (f.nrMissed || []).filter((x) => R(x.base)), nrU = (f.nrUnpaid || []).filter((x) => R(x.base));
  add("40ai", "sums paid to non-residents without TDS, or with TDS not deposited by the due date (section 40(a)(i))", nr.concat(nrU).reduce((s, x) => s + N(x.base), 0), "AmtDebPLDisallowUs40", "FinCom's TDS: non-resident payments",
    nr.map((x) => ({ ledger: x.party, group: "section " + (x.section || "195") + ", not deducted", amt: R(x.base) })).concat(nrU.map((x) => ({ ledger: x.party, group: "section " + (x.section || "195") + ", not deposited by the due date", amt: R(x.base) }))));
  const cash = f.cash40A3 || [];
  add("40a3", "cash payments above the limit (section 40A(3))", cash.reduce((s, x) => s + N(x.amount), 0), "AmtDebPLDisallowUs40A", "Audit: cash payments above Rs 10,000 a day",
    cash.map((x) => ({ ledger: x.party, group: x.date, amt: R(x.amount) })));
  // 43B: the part of this year's charge unpaid by the due date (dues43B); an item whose date or employer's share is not
  // known is not added (the checks ask, and the JSON waits for the answer)
  const dues = (f.dues43B || []).filter((x) => x.kind43B && !x.unknown && !x.unknownShare && R(x.dis) > 0);
  add("43b", "this year's statutory dues unpaid by the due date of the return (section 43B)", dues.reduce((s, x) => s + N(x.dis), 0), "AmtDebPLDisallowUs43B", "the year's charge to each payable and the payments after the year end",
    dues.map((x) => ({ ledger: x.ledger, group: x.kind + (x.role ? " (" + x.role + ")" : ""), amt: R(x.dis), note: "charged this year " + R(x.charge) + ", of it unpaid " + R(x.unpaid) + (x.part != null && x.part < 1 ? ", employer's part " + Math.round(x.part * 100) + "%" : "") + (x.answered ? ", answered " + x.answered : "") })));
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
  sub("43b_prior", "43B dues of earlier years paid this year", f.prior43BPaid, "AmtDisallUs43BNowAllow", f.prior43BSrc || "Last year's 43B, paid", f.prior43BTrace);
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
    out.push({ id: "36va:PF" + e.wageMonth, fund: "PF", ym: e.wageMonth, ee: N(e.data && e.data.ee), due: due(e.wageMonth), paidOn, late: !!paidOn && paidOn > due(e.wageMonth), missing: !paidOn });
  });
  (esi || []).forEach((c) => { if (c.data && c.data.ee != null) out.push({ id: "36va:ESI" + c.wageMonth, fund: "ESI", ym: c.wageMonth, ee: N(c.data.ee), due: due(c.wageMonth), paidOn: c.paidOn, late: !!c.paidOn && c.paidOn > due(c.wageMonth), missing: !c.paidOn }); });
  return out.sort((a, b) => (a.ym + a.fund).localeCompare(b.ym + b.fund));
}
// the owner's payment dates for the months with no challan: ans {id: yyyymmdd | "none"}; after the 15th, or not paid,
// the employees' share is disallowed (36(1)(va))
export function settle36va(rows, ans) {
  ans = ans || {};
  return (rows || []).map((x) => { const a = ans[x.id]; if (!x.missing || !a) return x; return Object.assign({}, x, { missing: false, answered: a, paidOn: a === "none" ? "" : a, late: a === "none" || a > x.due }); });
}

// 43B: what each payable ledger is, and whether 43B applies to it (a deduction claimed only when paid). A PF / ESI
// ledger may be the employer's (43B in full), the employees' (36(1)(va) only, never 43B) or one for both (role "")
export function kind43B(ledger) {
  const l = String(ledger || "").toUpperCase();
  if (/\bTDS\b|\bTCS\b|TAX DEDUCTED|TAX COLLECTED/.test(l)) return { kind: "tds", on: false };
  if (/GST|CGST|SGST|IGST|UTGST|OUTPUT TAX/.test(l)) return { kind: "gst", on: false };
  // the schemes' own names (Employees' Provident Fund, Employees' State Insurance) say nothing of whose share it is
  const bare = l.replace(/EMPLOYEES?'?S?'? ?PROVIDENT FUND/g, "PROVIDENT FUND").replace(/EMPLOYEES?'?S?'? ?STATE INSURANCE/g, "STATE INSURANCE");
  const admin = /\bEDLI\b|ADMIN(ISTRATION|ISTRATIVE)? (CHARGES?|EXP)|INSPECTION CHARGES/.test(bare);
  let fund = /PROVIDENT|\bE?PF\b/.test(bare) ? "pf" : /\bESIC?\b|STATE INSURANCE/.test(bare) ? "esi" : admin ? "pf" : "";
  // "Employee's contribution" naming no fund is the employees' PF
  if (!fund && /EMPLOYEES?'?S?'? ?(SHARE|CONTRI)/.test(bare)) fund = "pf";
  if (fund) {
    // PF admin charges and EDLI are the employer's (43B in full, never split by the ECR)
    const role = admin || /EMPLOYER|\bER\b|COMPANY'?S? (SHARE|CONTRI)/.test(bare) ? "er" : /EMPLOYEE|\bEE\b|DEDUCTED|DEDUCTION|STAFF (SHARE|CONTRI)|RECOVER/.test(bare) ? "ee" : "";
    return { kind: fund, role, on: role !== "ee" };
  }
  if (/BONUS/.test(l)) return { kind: "bonus", on: true };
  if (/LEAVE/.test(l)) return { kind: "leave", on: true };
  if (/INTEREST/.test(l) && /BANK|LOAN|NBFC|FINANCE|ACCRUED/.test(l)) return { kind: "interest", on: true };
  if (/PROFESSION(AL)? TAX|\bP\.?T\.? PAYABLE|PROPERTY TAX|MUNICIPAL|ELECTRICITY DUTY|STAMP DUTY|CESS|CUSTOMS|EXCISE|LABOUR WELFARE/.test(l)) return { kind: "tax", on: true };
  return null;
}
// 43B on THIS YEAR'S charge (the review of 5a6df2218): what the year's profit and loss was charged for the ledger and is
// still unpaid on the due date of the return, never the whole balance (a 30 lakh leave provision of which 3 lakh was
// charged this year adds back at most the 3 lakh). PF / ESI payments by wage month; for the rest (the fallback) payments are taken against the oldest dues first: in the year they
// settle the opening balance before the year's charge, and after the year end what is left of the opening balance first.
// rows: payable ledgers [{ledger, opening, charge (credits of the year from the P&L; null: not known), closing, minBal (the
// lowest balance in the year: the old balance, stale)}]; a payment may carry ym (a challan's wage month)
// (positive = payable); pays: payments after the year end [{ledger, date, amt}], one per payment (pfDedup); due: the
// return's due date; last: the books' last date; share: {pf, esi} the employer's part of a ledger for both (March's ECR /
// ESI challan) or null. Each -> {id, ledger, kind, role, kind43B, opening, charge, chargeKnown, closing, paid, unpaid (of
// the year's charge), part (the employer's), dis (added back), dates, unknown (the date), unknownShare}
export function dues43B(rows, pays, due, last, share) {
  const out = [];
  rows.forEach((r) => {
    const k = kind43B(r.ledger), closing = R(r.closing); if (!k || closing <= 0) return;
    const known = r.charge != null, charge = known ? Math.max(0, R(r.charge)) : closing;
    // stale: the part of the opening balance never reduced in the year (the ledger's lowest balance in the year, at most
    // the opening): an old due, asked (already disallowed in an earlier year? paid?), never added back by FinCom
    const stale0 = k.on && r.minBal != null ? Math.max(0, Math.min(R(r.opening), R(r.minBal), closing)) : 0;
    const rest = closing - stale0, chargeOpen = Math.min(charge, rest), oldOpen = rest - chargeOpen;
    const mine = pays.filter((p) => p.ledger === r.ledger && p.date <= due).sort((a, b) => a.date.localeCompare(b.date));
    let paid = 0; const dates = [];
    mine.forEach((p) => { if (paid < closing) { paid += N(p.amt); dates.push(p.date); } });
    paid = Math.min(R(paid), closing);
    let unpaid, staleLeft;
    if (k.kind === "pf" || k.kind === "esi") {
      // PF / ESI by wage month: a payment for a month of this year (a challan's wage month, or a bank entry naming none)
      // settles this year's dues; one for a month before the year settles the old balance
      const fy0 = String(+String(due).slice(0, 4) - 1) + "04";
      const old = R(mine.filter((p) => p.ym && p.ym < fy0).reduce((a, p) => a + N(p.amt), 0)), cur = Math.max(0, paid - old);
      const onCharge = Math.min(chargeOpen, cur), over = Math.max(0, cur - onCharge - oldOpen);
      unpaid = R(chargeOpen - onCharge); staleLeft = R(Math.max(0, stale0 - old - over));
    } else {
      // bonus, leave, interest, taxes (the fallback, no link from a payment to its due): the oldest dues first, the old
      // balance, then what was left of the opening, then this year's charge
      let p = paid; const s = Math.min(stale0, p); p -= s; staleLeft = R(stale0 - s);
      unpaid = R(Math.max(0, chargeOpen - Math.max(0, p - oldOpen)));
    }
    let part = k.on ? 1 : 0, unknownShare = false;
    if (k.on && !k.role && (k.kind === "pf" || k.kind === "esi")) { const sh = share && share[k.kind]; if (sh == null) { part = null; unknownShare = unpaid > 0; } else part = sh; }
    const dis = k.on ? R(unpaid * (part == null ? 1 : part)) : 0;
    out.push({ id: "43b:" + r.ledger, ledger: r.ledger, kind: k.kind, role: k.role || "", kind43B: k.on, opening: R(r.opening), charge, chargeKnown: known, closing, paid, dates, unpaid, part, dis,
      stale: k.on ? staleLeft : 0, staleOpen: stale0, unknown: k.on && unpaid > 0 && (!last || last < due), unknownShare, trace: r.trace || [] });
  });
  return out;
}
// the owner's answers on the items whose payment date the books do not show: ans {id: yyyymmdd | "none"}. The answer
// changes the computation: paid by the due date, nothing is added back; later or not paid, the unpaid part is
export function settle43B(dues, ans, due) {
  ans = ans || {};
  return (dues || []).map((x) => {
    const a = ans[x.id]; if (!x.unknown || !a) return x;
    const late = a === "none" || a > due;
    return Object.assign({}, x, { unknown: false, answered: a, dis: late ? x.dis : 0, dates: a === "none" ? x.dates : x.dates.concat([a]) });
  });
}
export const dis43B = (dues) => R((dues || []).filter((x) => x.kind43B && !x.unknown && !x.unknownShare).reduce((s, x) => s + N(x.dis), 0));
// one payment once: a March PF / ESI challan and the bank entry in the books for it (the same ledger, the same amount
// to the rupee, and its CRN / TRRN in the narration or a date within five days) are the same payment: the challan's date
// is kept (it is the date of credit). books: [{ledger, date, amt, narr}], challans: [{ledger, date, amt, ref}]
export function pfDedup(books, challans) {
  const used = new Set(), matched = [];
  const days = (a, b) => Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8)) - Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8))) / 864e5;
  (challans || []).forEach((c) => {
    const i = books.findIndex((p, j) => !used.has(j) && p.ledger === c.ledger && Math.abs(N(p.amt) - N(c.amt)) < 1 && ((c.ref && String(p.narr || "").includes(c.ref)) || days(p.date, c.date) <= 5));
    if (i >= 0) { used.add(i); matched.push({ challan: c, book: books[i] }); }
  });
  return { pays: books.filter((p, j) => !used.has(j)).concat(challans || []), matched, booksOnly: books.filter((p, j) => !used.has(j)) };
}
// 43B(h): bills of micro and small suppliers open at the year end; each is allowed this year only if paid within the
// days of section 15 of the MSMED Act (15, or the agreed days up to 45) of its date: paid later (even after 31 March,
// before the return) or unpaid, it is added back. Bills of an earlier year (dated before fyStart) are not this year's
// expense: they are left out (paid this year, they are earlier years' 43B paid: prior43BPaid).
// bills: [{party, ref, date, amt, paidOn (yyyymmdd or "")}]
export function msme43Bh(bills, days, fyEnd, last, fyStart) {
  const add = (d, n) => { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 864e5); return t.toISOString().slice(0, 10).replace(/-/g, ""); };
  const rows = [], unknown = [], prior = [];
  (bills || []).forEach((b) => {
    const limit = add(b.date, N(days) || 15), x = Object.assign({ id: "43bh:" + b.party + "|" + (b.ref || "") + "|" + b.date }, b, { limit });
    if (fyStart && b.date < fyStart) { prior.push(x); return; }
    if (limit <= fyEnd) { rows.push(x); return; }                       // already beyond the days at the year end
    if (b.paidOn && b.paidOn <= limit) return;                           // paid in time: allowed
    if (b.paidOn && b.paidOn > limit) { rows.push(x); return; }          // paid late
    if (!last || last < limit) unknown.push(x); else rows.push(x);       // unpaid: late once the limit has passed
  });
  return { rows, unknown, prior, days: N(days) || 15 };
}
// the owner's payment dates for the MSME bills due after the books end: paid by the limit, allowed; later or not paid,
// added back
export function settleMsme(ms, ans) {
  if (!ms) return ms; ans = ans || {};
  const rows = ms.rows.slice(), unknown = [];
  (ms.unknown || []).forEach((x) => { const a = ans[x.id]; if (!a) { unknown.push(x); return; } if (a === "none" || a > x.limit) rows.push(Object.assign({}, x, { paidOn: a === "none" ? "" : a, answered: a })); });
  return Object.assign({}, ms, { rows, unknown });
}
// the same bills worked out a second way, for the check: each MSME party's own ledger in the vouchers, bills (credits)
// settled by payments (debits) oldest first, not the bill-wise references the ageing uses.
// flows: {party: {opening (credit positive), moves: [{date, amt (credit positive)}]}}
export function msmeFifo(flows, days, fyStart, fyEnd, last) {
  const bills = [];
  Object.keys(flows || {}).forEach((party) => {
    const f = flows[party], q = [];
    if (N(f.opening) > 0) q.push({ party, ref: "opening", date: "00000000", amt: N(f.opening), left: N(f.opening), paidOn: "" });
    const mv = (f.moves || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    mv.forEach((m) => {
      if (N(m.amt) > 0) { q.push({ party, ref: "", date: m.date, amt: N(m.amt), left: N(m.amt), paidOn: "" }); return; }
      let pay = -N(m.amt);
      q.forEach((b) => { if (pay <= 0 || b.left <= 0) return; const u = Math.min(b.left, pay); b.left -= u; pay -= u; if (b.left <= 0.5) b.paidOn = m.date; });
    });
    // what was open at the year end: the bills of the year not settled by 31 March
    q.forEach((b) => { if (b.date >= fyStart && b.date <= fyEnd) { const openAtEnd = !b.paidOn || b.paidOn > fyEnd; if (openAtEnd) bills.push({ party, ref: b.ref, date: b.date, amt: R(b.amt), paidOn: b.paidOn }); } });
  });
  return msme43Bh(bills, days, fyEnd, last, fyStart);
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
  const G = page(), FinSt = G.FinSt, b = G.S && G.S.books;
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
  // deducted but not deposited: a non-resident's sum goes in full under 40(a)(i), a resident's at 30% under 40(a)(ia)
  const isNr = (x) => !!nrInfo[x.party] || /^195/.test(String(x.section || ""));
  const nrUnpaid = unpaid.filter(isNr), resUnpaid = unpaid.filter((x) => !isNr(x));
  const nrAsk = resMissed.filter((x) => foreign.test(x.party)).map((x) => x.party);
  if (tdsRec) {
    tdsRec.missedBase = R(resMissed.reduce((a, x) => a + x.base, 0)); tdsRec.unpaidBase = R(resUnpaid.reduce((a, x) => a + x.base, 0)); tdsRec.nrBase = R(nrMissed.concat(nrUnpaid).reduce((a, x) => a + x.base, 0));
    // the second sources for the TDS: the returns as filed (the copy kept when each was marked filed, b.tdsSnap) and the
    // challans as TRACES consumed them (the consolidated file / challan status file, TDSReg.traces)
    try {
      const fyl = fy + "-" + String(+fy + 1).slice(2), snap = b.tdsSnap || {}, qs = [];
      let filedTds = 0, recTds = 0;
      ["26Q", "27Q"].forEach((form) => ["Q1", "Q2", "Q3", "Q4"].forEach((q) => {
        const s1 = snap[fyl + "|" + q + "|" + form];
        const mine = G.TDS.formRows ? G.TDS.formRows(form).filter((r) => r.fy === fyl && r.q === q) : [];
        if (s1 && s1.rows) { qs.push(form + " " + q); Object.values(s1.rows).forEach((r) => { filedTds += N(r[5]); }); recTds += mine.reduce((a, r) => a + N(r.tds), 0); }
        else if (mine.length) tdsRec.notFiled = (tdsRec.notFiled || []).concat([form + " " + q]);
      }));
      tdsRec.filed = qs.length ? { quarters: qs, tds: R(filedTds), records: R(recTds) } : null;
      const tr = G.TDSReg && G.TDSReg.traces ? G.TDSReg.traces({ fy: fyl }).filter((x) => x.src === "conso" || x.src === "status") : [];
      tdsRec.traces = tr.length ? { fincom: R(tr.reduce((a, x) => a + N(x.fincom), 0)), traces: R(tr.reduce((a, x) => a + N(x.traces), 0)), rows: tr.filter((x) => Math.abs(N(x.diff)) >= 1).map((x) => ({ label: x.label, a: R(x.fincom), b: R(x.traces), diff: R(x.diff) })) } : null;
    } catch (e) { notes.push("The filed TDS returns could not be read: " + ((e && e.message) || e)); }
  }
  // 43B: each payable ledger's opening, this year's charge from the P&L (its credits in vouchers that debit an income or
  // expense ledger), the year's payments, and the payments after the year end up to the due date (the bank entries and
  // the March PF / ESI challans, each payment once)
  const im = imports || {}, march = (xs) => (xs || []).filter((x) => x.wageMonth === (+fy + 1) + "03");
  const ecrM = march(im.ecr)[0], esiM = march(im.esi)[0];
  const share = { pf: ecrM ? (N(ecrM.data.eps) + N(ecrM.data.er)) / Math.max(1, N(ecrM.data.ee) + N(ecrM.data.eps) + N(ecrM.data.er)) : null, esi: esiM && esiM.data.er != null ? N(esiM.data.er) / Math.max(1, N(esiM.data.er) + N(esiM.data.ee)) : null };
  const plCode = new Set(rows.filter((r) => r.code && FinSt.CODES[r.code] && FinSt.CODES[r.code].side !== "BS").map((r) => r.ledger));
  const payRows = rows.filter((r) => ["7B", "7C", "7G", "5B", "5C", "5F", "5G"].includes(r.code) && kind43B(r.ledger)).map((r) => ({ ledger: r.ledger, opening: -N(r.py), closing: -N(r.final), charge: 0, paidInYear: 0 }));
  const byL = {}; payRows.forEach((r) => { byL[r.ledger] = r; });
  const bookPays = [], moves = {};
  vs.forEach((v) => {
    const ent = v.ent || [], pl = ent.some((e) => plCode.has(e.l) && N(e.a) < 0);
    ent.forEach((e) => {
      const r = byL[e.l]; if (!r) return;
      if (v.date >= y0 && v.date <= y1) { (moves[e.l] = moves[e.l] || []).push({ date: v.date, amt: N(e.a) }); if (N(e.a) > 0 && pl) r.charge += N(e.a); else if (N(e.a) < 0) r.paidInYear += -N(e.a); }
      else if (v.date > y1 && v.date <= due && N(e.a) < 0) bookPays.push({ ledger: e.l, date: v.date, amt: -N(e.a), narr: v.narr || "" });
    });
  });
  // each payable's lowest balance in the year (at the end of a day): the part of the opening never paid down (dues43B: stale)
  payRows.forEach((r) => {
    let bal = r.opening, min = r.opening; const ds = {};
    (moves[r.ledger] || []).forEach((m) => { ds[m.date] = (ds[m.date] || 0) + m.amt; });
    Object.keys(ds).sort().forEach((d) => { bal += ds[d]; if (bal < min) min = bal; });
    r.minBal = R(min);
  });
  const fundL = (k) => { const ls = payRows.filter((r) => { const q = kind43B(r.ledger); return q.kind === k && q.role !== "ee" && r.closing > 0; }); return ls.length === 1 ? ls[0].ledger : (ls.find((r) => !kind43B(r.ledger).role) || ls[0] || {}).ledger; };
  const challans = [];
  march(im.pfc).forEach((c) => { const l = fundL("pf"); if (l && c.paidOn <= due) challans.push({ ledger: l, date: c.paidOn, amt: N(c.data.total), ref: c.trrn || "", ym: c.wageMonth }); });
  march(im.esi).forEach((c) => { const l = fundL("esi"); if (l && c.paidOn <= due) challans.push({ ledger: l, date: c.paidOn, amt: N(c.data.total), ref: c.challan || "", ym: c.wageMonth }); });
  const dd = pfDedup(bookPays, challans);
  const dues = dues43B(payRows, dd.pays, due, last, share);
  // the PF / ESI payments after the year end, two ways: the bank entries in the books and the challans brought in
  const pfL = new Set(payRows.filter((r) => ["pf", "esi"].includes(kind43B(r.ledger).kind)).map((r) => r.ledger));
  const pfProof = pfL.size ? { books: R(bookPays.filter((p) => pfL.has(p.ledger)).reduce((a, p) => a + p.amt, 0)), challans: challans.length ? R(challans.reduce((a, c) => a + c.amt, 0)) : null,
    rows: dd.matched.map((m) => ({ label: m.book.ledger + ": " + m.book.date + " in the books, challan " + (m.challan.ref || "") + " of " + m.challan.date, a: R(m.book.amt), b: R(m.challan.amt) })).concat(dd.booksOnly.filter((p) => pfL.has(p.ledger)).map((p) => ({ label: p.ledger + ": " + p.date + " in the books, no challan", a: R(p.amt), b: null }))) } : null;
  // earlier years' 43B: the dues payable at the start of the year (opening) and what was paid in the year
  const prior43B = payRows.filter((r) => kind43B(r.ledger).on && r.opening > 0).map((r) => ({ ledger: r.ledger, opening: R(r.opening), paidInYear: R(r.paidInYear) }));
  // 43B(h): MSME bills open at the year end, settled when (the payables' ageing at each bill's limit date)
  let msme = null;
  try {
    if (G.MIS && G.MIS.ageing && G.MIS.msme) {
      const types = G.MIS.msme(), days = N((G.MIS.cfg(b) || {}).msmeDays) || 15, ag = G.MIS.ageing(y1, "p", null), memo = {};
      const openAt = (dt) => (memo[dt] = memo[dt] || G.MIS.ageing(dt, "p", null));
      const bills = [];
      ag.rows.forEach((pr) => { if (!/micro|small/i.test(types[pr.party] || "")) return; (pr.open || []).forEach((x) => bills.push({ party: pr.party, ref: x.ref, date: x.date, amt: N(x.left), paidOn: "" })); });
      const res = msme43Bh(bills, days, y1, last, y0);
      // a bill whose limit falls inside the books: still open at its limit date means paid late or unpaid
      res.unknown = res.unknown.filter((x) => x.limit > last);
      const keepRows = res.rows.filter((x) => {
        if (x.limit <= y1 || x.limit > last) return true;
        const pr = openAt(x.limit).rows.find((z) => z.party === x.party), still = pr && (pr.open || []).some((z) => z.ref === x.ref && z.date === x.date);
        return !!still;
      });
      // the second way: each MSME party's ledger in the vouchers, oldest bills settled first
      const flows = {};
      Object.keys(types).filter((p) => /micro|small/i.test(types[p] || "")).forEach((p) => { const r0 = rows.find((r) => r.ledger === p); flows[p] = { opening: r0 ? -N(r0.py) : 0, moves: [] }; });
      vs.forEach((v) => { if (v.date < y0) return; (v.ent || []).forEach((e) => { if (flows[e.l]) flows[e.l].moves.push({ date: v.date, amt: N(e.a) }); }); });
      const fifo = msmeFifo(flows, days, y0, y1, last);
      msme = { rows: keepRows, unknown: res.unknown, prior: res.prior, days, fifo: { amt: R(fifo.rows.reduce((a, x) => a + N(x.amt), 0)), unknown: fifo.unknown.length, n: fifo.rows.length },
        priorParties: Object.keys(flows).filter((p) => N(flows[p].opening) > 0) };
      // the bills of earlier years open at 31-03-2025 and paid in the year (by reference and date): last year's 43B(h)
      // add-back is allowed bill by bill (model.js prior43B)
      const ag0 = G.MIS.ageing(fy + "0331", "p", null), priorPaid = [];
      (ag0.rows || []).forEach((pr) => { if (!/micro|small/i.test(types[pr.party] || "")) return; const now = (ag.rows.find((z) => z.party === pr.party) || {}).open || [];
        (pr.open || []).forEach((x) => { const z = now.find((y) => y.ref === x.ref && y.date === x.date), paid = R(N(x.left) - (z ? N(z.left) : 0)); if (paid > 0) priorPaid.push({ party: pr.party, ref: x.ref, date: x.date, amt: paid }); }); });
      msme.priorPaid = priorPaid;
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
    tdsMissed: resMissed, tdsUnpaid: resUnpaid.map((x) => ({ party: x.party, section: x.section, base: x.base })), nrMissed, nrUnpaid: nrUnpaid.map((x) => ({ party: x.party, section: x.section, base: x.base })),
    cash40A3: fnd("cash40A3").flatMap((x) => (x.rows || []).map((r) => ({ date: r.date, party: r.party, amount: r.amount }))),
    msmeRows: msme ? msme.rows : [], penalties: fnd("penalties").reduce((a, x) => a + N(x.amount), 0), csr: sched.pl.csr.cy,
    leave43B: 0, pf36va: imports ? pf36va(imports.ecr, imports.pfc, imports.esi) : [], dues43B: dues,
  };
  return { ok: true, fy, sched, f, adj: adjustments(f), dep: td, findings, notes, comp: d.comp, inputs: d.inputs, plTally, openingTally: openSched.totals.apply, pyBs, capital, dues43B: dues, msme,
    tds: tdsRec, form3cd, esiBooks: esiL.length ? R(esiL.reduce((a, t) => a + t.amt, 0)) : null, nrAsk, last, pfProof, prior43B };
}
