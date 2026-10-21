// What the books say, for the reports pack (ROUND 100): figures read from FinSt.build (src/js/88-fin-statements.js) and
// from the day book. Pure: no screen, no storage, no globals.
//
//   facts({d, dR, vouchers, fy})
//     d   FinSt.build(fy, {unit, dec}) in the unit the page shows (the financial summary is its figures, unchanged)
//     dR  FinSt.build(fy, {unit: 1, dec: 2}) in rupees (the tests of size: small company, CARO, IFC, CSR ...)
//     vouchers  the day book (b.vouchers: {date "yyyymmdd", ent [{l, a}]}, a debit negative), for the ageing of statutory
//               dues and the year's movements of a ledger; optional
// Every amount below is in rupees (debit positive in `rows`), unless named `disp`.
const N = (v) => +v || 0;
const R2 = (v) => Math.round(N(v) * 100) / 100;
const yearOf = (fy) => Number(String(fy).slice(0, 4));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
export const longDate = (ymd) => { const s = String(ymd || "").replace(/-/g, ""); if (!/^\d{8}$/.test(s)) return String(ymd || ""); return ord(+s.slice(6)) + " " + MONTHS[+s.slice(4, 6) - 1] + ", " + s.slice(0, 4); };
export const shortDate = (ymd) => { const s = String(ymd || "").replace(/-/g, ""); if (!/^\d{8}$/.test(s)) return String(ymd || ""); return s.slice(6) + "-" + MONTHS[+s.slice(4, 6) - 1].slice(0, 3) + "-" + s.slice(0, 4); };
export const ordinal = ord;

// statutory dues: the kind by the ledger's name, and the day of the next month by which it is payable
const DUES = [[/\bTDS\b|\bTCS\b|WITHHOLDING|INCOME TAX DEDUCTED/, "Tax deducted / collected at source", 7], [/\bGST\b|IGST|CGST|SGST|UTGST|\bCESS\b/, "Goods and Services Tax", 20],
  [/\bPF\b|PROVIDENT|\bEPF\b/, "Provident fund", 15], [/\bESI/, "Employees' State Insurance", 15], [/PROFESSIONAL TAX|\bPT\b/, "Professional tax", 15],
  [/LABOUR WELFARE|\bLWF\b/, "Labour welfare fund", 15]];
const dueKind = (l) => { const u = String(l).toUpperCase(); const k = DUES.find(([re]) => re.test(u)); return k ? { nature: k[1], day: k[2] } : { nature: "Other statutory dues", day: 15 }; };
const addMonths = (ymd, m, day) => { let y = +ymd.slice(0, 4), mo = +ymd.slice(4, 6) - 1 + m; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return String(y) + String(mo + 1).padStart(2, "0") + String(day).padStart(2, "0"); };

export function facts(o) {
  const d = o.d, dR = o.dR || o.d, fy = String(dR.fy), y = yearOf(fy), vouchers = o.vouchers || [];
  const from = (dR.tb && dR.tb.from) || y + "0401", to = (dR.tb && dR.tb.to) || (y + 1) + "0331", fyEnd = (y + 1) + "0331";
  const rows = (dR.tb && dR.tb.rows) || [];
  const NEG = ["3", "4", "5", "6", "7", "13", "14", "30", "31", "32", "33"];
  const sign = (c) => (NEG.includes(String(c).replace(/[A-Z]+$/, "")) ? -1 : 1);
  // a code's figure (sign of its note: a liability or income positive), CY and PY, rupees
  const code = (c, col) => R2(sign(c) * rows.filter((r) => r.code === c).reduce((s, r) => s + N(col === "py" ? r.py : r.final), 0));
  const codes = (cs, col) => R2(cs.reduce((s, c) => s + code(c, col), 0));
  const byCode = (cs) => rows.filter((r) => cs.includes(r.code) && (Math.abs(N(r.final)) >= 0.5 || Math.abs(N(r.py)) >= 0.5));
  const note = (k) => (dR.notes || []).find((n) => n.key === k);
  const noteT = (k, col) => { const n = note(k); return n ? N(n.total[col]) : 0; };
  const sec = (k, col) => N(((dR.bs || {}).sections || {})[k] ? dR.bs.sections[k].total[col] : 0);
  const pl = (k, col) => N(((dR.pl || {})[k] || {})[col]);
  const inp = dR.inputs || {};
  // movements of a ledger in the year from the day book: debits and credits (a debit negative in vouchers)
  const mv = {};
  vouchers.forEach((v) => { if (!v || v.date < from || v.date > to) return; (v.ent || []).forEach((e) => { const m = mv[e.l] || (mv[e.l] = { dr: 0, cr: 0, credits: [] }); const a = N(e.a); if (a < 0) m.dr += -a; else if (a > 0) { m.cr += a; m.credits.push([v.date, a]); } }); });
  const moves = (l) => mv[l] || { dr: 0, cr: 0, credits: [] };

  const F = { fy, from, to, fyEnd, y, kind: dR.kind, inputs: inp, unit: d.inputs.unit, dec: d.inputs.dec, unitLine: d.inputs.unitLine };
  F.paidUp = noteT("3", "cy"); F.paidUpPy = noteT("3", "py");
  F.reserves = noteT("4", "cy"); F.reservesPy = noteT("4", "py");
  F.netWorth = sec("EQ", "cy"); F.netWorthPy = sec("EQ", "py");
  F.turnover = noteT("13", "cy"); F.turnoverPy = noteT("13", "py");
  F.otherIncome = noteT("14", "cy"); F.revenue = pl("inc", "cy"); F.revenuePy = pl("inc", "py");
  F.pbt = pl("pbt", "cy"); F.pbtPy = pl("pbt", "py"); F.pat = pl("pat", "cy"); F.patPy = pl("pat", "py");
  F.dep = pl("dep", "cy"); F.depPy = pl("dep", "py"); F.finCost = pl("fin", "cy");
  F.bankBorrow = codes(["30A", "33A"], "cy"); F.bankBorrowPy = codes(["30A", "33A"], "py");
  F.otherBorrow = codes(["30B", "33B", "33C"], "cy");
  F.borrow = R2(F.bankBorrow + F.otherBorrow); F.borrowPy = R2(F.bankBorrowPy + codes(["30B", "33B", "33C"], "py"));
  // the peak in the year is asked (only the year-end balances are in the trial balance); the larger year-end is its prefill
  F.bankBorrowPeak = Math.max(F.bankBorrow, F.bankBorrowPy);
  F.borrowPeak = Math.max(F.borrow, F.borrowPy);
  F.ltBorrow = noteT("30", "cy"); F.stBorrow = noteT("33", "cy");
  F.termLoans = byCode(["30A"]).map((r) => ({ ledger: r.ledger, cy: -N(r.final), py: -N(r.py) }));
  F.secured = byCode(["30A", "33A"]).map((r) => ({ ledger: r.ledger, cy: -N(r.final), py: -N(r.py) }));
  // loans given and investments (s.186, CARO 3(iii)): other loans and advances, long-term loans, investments; loans to
  // employees (12G) are outside s.186
  F.loansGiven = byCode(["12H", "38D"]).map((r) => ({ ledger: r.ledger, code: r.code, cy: N(r.final), py: N(r.py), given: R2(moves(r.ledger).dr), repaid: R2(moves(r.ledger).cr) }));
  F.investments = byCode(["36A", "37A"]).map((r) => ({ ledger: r.ledger, code: r.code, cy: N(r.final), py: N(r.py), made: R2(moves(r.ledger).dr) }));
  // unsecured loans taken (deposits test): loans from directors by their names (Inputs) or "director" in the ledger's name
  const dirs = (inp.directors || []).map((x) => String(x.name || "").trim()).filter(Boolean);
  const isDir = (l) => /DIRECTOR/i.test(l) || dirs.some((n) => nameIn(n, l));
  F.loansTaken = byCode(["30B", "33B"]).map((r) => ({ ledger: r.ledger, code: r.code, cy: -N(r.final), py: -N(r.py), director: isDir(r.ledger) }));
  F.directorLoans = F.loansTaken.filter((x) => x.director);
  F.directorLoanTotal = R2(F.directorLoans.reduce((s, x) => s + x.cy, 0));
  // dividend: any ledger named dividend on the payout side (interim / final / proposed), CY
  F.dividendRows = rows.filter((r) => /DIVIDEND/i.test(r.ledger) && !/^14/.test(r.code || "") && N(r.final) > 0.5 && !/RECEIV|INCOME/i.test(r.ledger)).map((r) => ({ ledger: r.ledger, cy: N(r.final) }));
  F.dividendPaid = R2(F.dividendRows.reduce((s, x) => s + x.cy, 0));
  // reserves: the transfer to the general / other reserves in the year; share capital and premium movements
  F.reserveTransfer = R2(Math.max(0, codes(["4C", "4D"], "cy") - codes(["4C", "4D"], "py")));
  F.shareCap = code("3A", "cy"); F.shareCapPy = code("3A", "py"); F.prefCap = code("3B", "cy"); F.prefCapPy = code("3B", "py");
  F.premium = code("4B", "cy"); F.premiumPy = code("4B", "py");
  F.sharesChanged = Math.abs(F.shareCap - F.shareCapPy) >= 1 || Math.abs(F.prefCap - F.prefCapPy) >= 1;
  F.esopCharge = code("15D", "cy");
  // foreign exchange earnings and outgo (Rule 8(3)(C)): export sales and foreign-currency payments by ledger name, to be
  // confirmed as actual inflows and outflows
  const FX_IN = /EXPORT|FOREIGN|OVERSEAS|INTERNATIONAL|\bSEZ\b|\bLUT\b/i, FX_OUT = /IMPORT|FOREIGN|OVERSEAS|\bUSD\b|\bEUR\b|\bGBP\b|195|INTERNATIONAL/i;
  F.fxInRows = rows.filter((r) => /^13/.test(r.code || "") && FX_IN.test(r.ledger)).map((r) => ({ ledger: r.ledger, cy: -N(r.final) }));
  F.fxIn = R2(F.fxInRows.reduce((s, x) => s + x.cy, 0));
  F.fxOutRows = rows.filter((r) => r.side === "PL" && N(r.final) > 0 && FX_OUT.test(r.ledger) && !/^(14|13)/.test(r.code || "") && !/EXCHANGE (GAIN|LOSS)|FOREX (GAIN|LOSS)/i.test(r.ledger)).map((r) => ({ ledger: r.ledger, cy: N(r.final) }));
  F.fxOut = R2(F.fxOutRows.reduce((s, x) => s + x.cy, 0));
  F.rnd = R2(rows.filter((r) => /RESEARCH|R\s*&\s*D\b/i.test(r.ledger) && N(r.final) > 0).reduce((s, r) => s + N(r.final), 0));
  // statutory dues outstanding more than six months from the date they became payable (CARO 3(vii)(a)): each payable for
  // statutory remittances (7C) first-in first-out: the opening balance and the year's credits (deductions, liabilities)
  // in date order, the year's debits (deposits) paying the oldest first; what is left at the year end, and became payable
  // (the due day of the next month) on or before 30 September, is more than six months old on 31 March
  const cutoff = y + "0930";
  F.statDues = byCode(["7C"]).map((r) => {
    const bal = R2(-N(r.final)); if (bal <= 0.5 || !vouchers.length) return null;
    const k = dueKind(r.ledger), m = moves(r.ledger), open = R2(Math.max(0, -N(r.py)));
    const q = (open > 0.5 ? [[from, open, true]] : []).concat(m.credits.slice().sort((x, z) => (x[0] < z[0] ? -1 : x[0] > z[0] ? 1 : 0)).map(([dt, v]) => [dt, v, false]));
    let paid = m.dr;
    const left = [];
    q.forEach(([dt, v, op]) => { const use = Math.min(paid, v); paid -= use; if (v - use > 0.005) left.push([dt, R2(v - use), op]); });
    // the books' own year-end balance rules: older items trimmed, or the shortfall taken as from before the year
    let tot = R2(left.reduce((t, z) => t + z[1], 0));
    while (tot - bal > 0.005 && left.length) { const cut = Math.min(left[0][1], tot - bal); left[0][1] = R2(left[0][1] - cut); tot = R2(tot - cut); if (left[0][1] <= 0.005) left.shift(); }
    if (bal - tot > 0.5) left.unshift([from, R2(bal - tot), true]);
    let aged = 0, oldest = "", before = false;
    left.forEach(([dt, v, op]) => { const due = op ? from : addMonths(dt, 1, k.day); if (due <= cutoff) { aged += v; if (!oldest) { oldest = dt; before = op; } } });
    return aged > 0.5 ? { ledger: r.ledger, nature: k.nature, amount: R2(aged), since: oldest, before, due: before ? "" : addMonths(oldest, 1, k.day) } : null;
  }).filter(Boolean);
  F.statDuesTotal = R2(F.statDues.reduce((s, x) => s + x.amount, 0));
  F.statDueRows = byCode(["7C"]).map((r) => ({ ledger: r.ledger, cy: R2(-N(r.final)) }));
  // cash loss (CARO 3(xvii)): profit before tax with the non-cash charges added back (depreciation, share-based payments,
  // loss on sale of assets) and the profit on sale of assets taken out
  const cashProfit = (col) => R2(pl("pbt", col) + pl("dep", col) + code("15D", col) + code("17T", col) - code("14B", col));
  F.cashProfit = cashProfit("cy"); F.cashProfitPy = cashProfit("py");
  F.cashLoss = F.cashProfit < 0 ? -F.cashProfit : 0; F.cashLossPy = F.cashProfitPy < 0 ? -F.cashProfitPy : 0;
  // liquidity (CARO 3(xix), going concern)
  F.ca = sec("CA", "cy"); F.cl = sec("CL", "cy");
  F.currentRatio = F.cl ? F.ca / F.cl : 0;
  F.quickRatio = F.cl ? (F.ca - noteT("39", "cy")) / F.cl : 0;
  F.debtEquity = F.netWorth ? F.borrow / F.netWorth : 0;
  F.nwc = R2(F.ca - F.cl);
  // assets
  F.ppeAdd = N(((dR.ppe || {}).cy || { total: {} }).total.E) + N(((dR.intang || {}).cy || { total: {} }).total.E);
  F.ppeSaleCost = -N(((dR.ppe || {}).cy || { total: {} }).total.F); F.ppeSaleDep = -N(((dR.ppe || {}).cy || { total: {} }).total.J);
  F.ppeNet = N(((dR.ppe || {}).cy || { total: {} }).total.M);
  F.intangibles = N(((dR.intang || {}).cy || { total: {} }).total.M);
  F.immovable = codes(["8M", "8P"], "cy") > 0.5;
  F.inventory = noteT("39", "cy");
  F.cash = code("11D", "cy"); F.bank = code("11A", "cy"); F.fd = codes(["11B", "11C"], "cy");
  F.receivables = code("10A", "cy"); F.doubtful = -code("10B", "cy");
  F.gratuity = codes(["5A", "5E"], "cy"); F.leave = codes(["5B", "5C"], "cy");
  F.msme = code("6A", "cy");
  F.invNC = code("36A", "cy"); F.invC = code("37A", "cy");
  F.csrSpent = code("17R", "cy");
  F.employeeCost = noteT("15", "cy");
  F.remunDirectors = R2(rows.filter((r) => r.side === "PL" && /^15/.test(r.code || "") && (/DIRECTOR/i.test(r.ledger) || dirs.some((n) => nameIn(n, r.ledger)))).reduce((s, r) => s + N(r.final), 0));
  // estimates present in the books (MRL): gratuity / leave (actuarial), depreciation, deferred tax, doubtful debts
  F.estimates = [];
  if (Math.abs(F.gratuity) + Math.abs(F.leave) > 0.5) F.estimates.push("the provisions for gratuity and leave encashment");
  if (F.ppeNet + F.intangibles > 0.5) F.estimates.push("the useful lives and residual values of property, plant and equipment and intangible assets");
  if (Math.abs(codes(["9A", "31A"], "cy")) > 0.5 || Math.abs(code("22C", "cy")) > 0.5) F.estimates.push("the recognition of deferred tax");
  if (F.doubtful > 0.5) F.estimates.push("the provision for doubtful receivables");
  if (Math.abs(code("5F", "cy")) > 0.5) F.estimates.push("the provision for expenses");
  // the financial summary (Board's Report item 1): the page's unit, the statements' own figures
  const P = d.pl, g = (k) => P[k] || { cy: 0, py: 0 };
  const ebitda = (col) => N(g("pbe")[col]) + N(g("fin")[col]) + N(g("dep")[col]);
  F.summary = [
    ["Revenue from operations", g("rev")], ["Other income", g("oth")], ["Total income", g("inc"), "b"],
    ["Total expenses (excluding finance costs and depreciation)", { cy: N(g("tot").cy) - N(g("fin").cy) - N(g("dep").cy), py: N(g("tot").py) - N(g("fin").py) - N(g("dep").py) }],
    ["Profit before finance costs, depreciation and tax", { cy: ebitda("cy"), py: ebitda("py") }],
    ["Finance costs", g("fin")], ["Depreciation and amortisation", g("dep")],
    ...(N(g("exc").cy) || N(g("exc").py) ? [["Exceptional items", g("exc")]] : []),
    ["Profit / (loss) before tax", g("pbt"), "b"], ["Current tax", g("cur")],
    ...(N(g("prior").cy) || N(g("prior").py) ? [["Tax relating to earlier years", g("prior")]] : []),
    ["Deferred tax charge / (credit)", g("def")], ["Profit / (loss) for the year", g("pat"), "b"],
  ].map(([label, v, b]) => ({ label, cy: N(v.cy), py: N(v.py), bold: !!b }));
  F.eps = P.eps || null;
  F.growth = F.turnoverPy ? (F.turnover - F.turnoverPy) / F.turnoverPy : null;
  F.disp = { rev: g("rev"), pat: g("pat"), pbt: g("pbt") };
  F.noteOf = d.noteOf || {};
  return F;
}
// a person's name in a ledger's name, ignoring case, punctuation and titles
export function nameIn(name, ledger) {
  const k = (s) => " " + String(s).toUpperCase().replace(/\b(MR|MRS|MS|DR|SHRI|SMT)\b\.?/g, " ").replace(/[^A-Z0-9]+/g, " ").trim() + " ";
  const n = k(name).trim(); return n.length >= 3 && k(ledger).includes(" " + n + " ");
}
// a related party's ledgers and what the year's transactions with it were, from the trial balance (rupees)
const NATURE = { "13": "Sale of goods / services", "14": "Other income", "15": "Remuneration", "16": "Interest paid", "17A": "Rent paid", "17E": "Professional fees paid", "17V": "Commission paid",
  "40": "Purchase of materials", "41": "Purchase of goods", "30B": "Loan taken (balance)", "33B": "Loan taken (balance)", "12H": "Loan given (balance)", "38D": "Loan given (balance)",
  "36A": "Investment (balance)", "10A": "Amount receivable (balance)", "6B": "Amount payable (balance)", "6A": "Amount payable (balance)", "7A": "Amount payable (balance)", "7B": "Amount payable (balance)" };
export function relatedTx(dR, parties) {
  const rows = (dR.tb && dR.tb.rows) || [];
  return (parties || []).filter((p) => p && p.name).map((p) => {
    const led = rows.filter((r) => nameIn(p.name, r.ledger) && (Math.abs(N(r.final)) >= 0.5));
    const tx = led.map((r) => { const c = r.code || "", nat = r.side === "PL" && /REMUNERATION|SALARY|SITTING FEE/i.test(r.ledger) ? "Remuneration" : NATURE[c] || NATURE[c.replace(/[A-Z]+$/, "")] || (r.side === "PL" ? "Other transactions" : "Balance");
      return { ledger: r.ledger, code: c, nature: nat, amount: R2(Math.abs(N(r.final))), bal: !/^(13|14|15|16|17|40|41)/.test(c) }; });
    return { name: p.name, relation: p.relation || "", tx };
  });
}
