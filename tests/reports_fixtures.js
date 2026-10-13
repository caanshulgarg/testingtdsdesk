// Made-up books for the Step 3 reports tests (src/js/78-reports.js): a private limited company and a partnership firm.
// Every name and figure here is invented. The books are written as vouchers for two years (FY 2024-25 and FY 2025-26)
// from opening balances, so the trial balance, the previous year and the cash and bank movements all follow from them.
// Amounts are Dr positive (FSX's sign); a voucher's lines add to nil.
const fs = require("fs"), path = require("path"), vm = require("vm");
function loadFSX(){
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "js", "78-reports.js"), "utf8");
  const ctx = {console, TextEncoder, TextDecoder, Math, JSON, Date, Intl, Number, String, Array, Object, Set, Map, RegExp, isFinite, parseFloat, Uint8Array, Uint32Array};
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx, {filename: "78-reports.js"});
  return ctx.FSX;
}
const r2 = v => Math.round(v * 100) / 100;
const months = fy => Array.from({length: 12}, (_, i) => { const y = i < 9 ? fy : fy + 1, m = ((i + 3) % 12) + 1; return y + "-" + String(m).padStart(2, "0"); });
const day = (ym, d) => ym + "-" + String(d).padStart(2, "0");
function books(spec){
  const V = {py: [], cy: []};
  let n = 0;
  const v = (yr, date, type, ent) => { const s = r2(ent.reduce((a, e) => a + e[1], 0)); if (Math.abs(s) > 0.001) throw new Error("voucher does not balance: " + JSON.stringify(ent));
    V[yr].push({date, no: type.slice(0, 3).toUpperCase() + "/" + (++n), type, ent: ent.filter(e => e[1]).map(([l, a]) => ({l, a: r2(a)}))}); };
  spec.write(v);
  // the trial balance
  const led = {}, L = l => led[l] = led[l] || {l, g: spec.groups[l] || [], po: 0, pd: 0, pc: 0, o: 0, d: 0, c: 0};
  Object.keys(spec.groups).forEach(L);
  Object.entries(spec.open).forEach(([l, a]) => { L(l).po = r2(a); });
  const mv = (yr, dk, ck) => V[yr].forEach(x => x.ent.forEach(e => { const t = L(e.l); if (e.a > 0) t[dk] = r2(t[dk] + e.a); else t[ck] = r2(t[ck] - e.a); }));
  mv("py", "pd", "pc"); mv("cy", "d", "c");
  const nominal = t => /^(sales accounts|purchase accounts|direct incomes|indirect incomes|direct expenses|indirect expenses)$/i.test(t.g[t.g.length - 1] || "");
  const stockL = t => /^stock-in-hand$/i.test(t.g[t.g.length - 1] || "");
  let pyProfit = 0;          // a credit is positive
  Object.values(led).forEach(t => {
    if (nominal(t)){ pyProfit -= t.pd - t.pc; t.o = 0; return; }
    if (stockL(t)){ const close = spec.stockPy[t.l] || 0; pyProfit += close - t.po; t.o = close; return; }
    t.o = r2(t.po + t.pd - t.pc);
  });
  pyProfit = r2(pyProfit);
  spec.profitTo.forEach(([l, share]) => { L(l).o = r2(L(l).o - Math.round(pyProfit * share) / 100 * 1); });
  // the P&L account carries what is left so that the opening trial balance agrees (it must be nil: asserted)
  const diff = r2(Object.values(led).reduce((a, t) => a + t.o, 0));
  if (Math.abs(diff) > 0.011) throw new Error("opening trial balance does not agree by " + diff);
  const tb = Object.values(led).map(t => ({l: t.l, g: t.g, o: t.o, d: t.d, c: t.c, po: t.po, pd: t.pd, pc: t.pc, msme: (spec.msme || {})[t.l] || ""}));
  return {tb, vouchers: V.cy, vouchersPy: V.py, pyProfit};
}
const close = (tb, l) => { const t = tb.find(x => x.l === l); return r2(t.o + t.d - t.c); };

// ---------------------------------------------------------------- the company
function company(){
  const G = {
    "Equity Share Capital": ["Capital Account"], "Securities Premium": ["Reserves & Surplus"], "Profit & Loss A/c": [],
    "Kite Bank Term Loan": ["Secured Loans"], "Loan from Director - A Rao": ["Unsecured Loans"], "Kite Bank Cash Credit": ["Bank OCC A/c"],
    "Alder Components": ["Sundry Creditors"], "Birch Metals": ["Sundry Creditors"], "TDS Payable": ["Duties & Taxes"], "GST Payable": ["Duties & Taxes"], "Input GST": ["Duties & Taxes"],
    "Salary Payable": ["Current Liabilities"], "Audit Fees Payable": ["Current Liabilities"], "Provision for Income Tax": ["Provisions"],
    "Plant and Machinery": ["Fixed Assets"], "Computers": ["Fixed Assets"], "Furniture and Fixtures": ["Fixed Assets"], "Investment in Shares of Wren Pvt Ltd": ["Investments"],
    "Deferred Tax Asset": ["Current Assets"], "Rent Deposit": ["Deposits (Asset)"], "Loan to Director - B Iyer": ["Loans & Advances (Asset)"], "Advance Tax & TDS": ["Loans & Advances (Asset)"],
    "Security Deposit - Tender": ["Current Assets"], "Finished Goods Stock": ["Stock-in-Hand"], "Raw Material Stock": ["Stock-in-Hand"],
    "Crane Retail": ["Sundry Debtors"], "Dove Stores": ["Sundry Debtors"], "Cash": ["Cash-in-Hand"], "Kite Bank Current A/c": ["Bank Accounts"], "Kite Bank Fixed Deposit": ["Bank Accounts"],
    "Sales": ["Sales Accounts"], "Interest on FD": ["Indirect Incomes"], "Miscellaneous Income": ["Indirect Incomes"], "Purchase - Raw Material": ["Purchase Accounts"], "Carriage Inward": ["Direct Expenses"],
    "Salaries and Wages": ["Indirect Expenses"], "Directors Remuneration": ["Indirect Expenses"], "Employer PF Contribution": ["Indirect Expenses"], "Staff Welfare": ["Indirect Expenses"],
    "Interest on Term Loan": ["Indirect Expenses"], "Interest on CC Account": ["Indirect Expenses"], "Loan Processing Fee": ["Indirect Expenses"], "Depreciation": ["Indirect Expenses"],
    "Rent": ["Indirect Expenses"], "Audit Fees": ["Indirect Expenses"], "Power and Fuel": ["Indirect Expenses"], "Repairs and Maintenance": ["Indirect Expenses"], "Printing and Stationery": ["Indirect Expenses"],
    "Bank Charges": ["Indirect Expenses"], "Travelling Expenses": ["Indirect Expenses"], "Advertisement": ["Indirect Expenses"], "Income Tax": ["Indirect Expenses"], "Deferred Tax": ["Indirect Expenses"]
  };
  const open = {"Equity Share Capital": -1000000, "Securities Premium": -200000, "Kite Bank Term Loan": -720000, "Loan from Director - A Rao": -150000, "Kite Bank Cash Credit": -250000,
    "Alder Components": -60000, "Birch Metals": -180000, "TDS Payable": -2000, "GST Payable": -30000, "Salary Payable": 0, "Audit Fees Payable": -40000, "Provision for Income Tax": -100000,
    "Plant and Machinery": 1050000, "Computers": 250000, "Furniture and Fixtures": 120000, "Investment in Shares of Wren Pvt Ltd": 200000, "Deferred Tax Asset": 25000, "Rent Deposit": 50000,
    "Loan to Director - B Iyer": 40000, "Advance Tax & TDS": 90000, "Security Deposit - Tender": 30000, "Finished Goods Stock": 280000, "Raw Material Stock": 180000,
    "Crane Retail": 350000, "Dove Stores": 200000, "Cash": 30000, "Kite Bank Current A/c": 150000, "Kite Bank Fixed Deposit": 100000};
  open["Profit & Loss A/c"] = -Object.values(open).reduce((a, b) => a + b, 0);
  const plan = {py: {sales: 5400000, purch: 2600000, carriage: 40000, sal: 700000, dir: 540000, pf: 50000, welfare: 20000, rent: 240000, power: 150000, repairs: 30000, print: 10000, bank: 5000, travel: 60000, adv: 40000, audit: 50000, fdInt: 6000, misc: 0, tlInt: 70000, ccInt: 25000, fee: 0, dep: {"Plant and Machinery": 150000, "Computers": 100000, "Furniture and Fixtures": 20000}, tax: 120000, dtax: -5000, advTax: 20000, taxPaid: 100000},
    cy: {sales: 6300000, purch: 3400000, carriage: 50000, sal: 820000, dir: 600000, pf: 60000, welfare: 25000, rent: 264000.4, power: 180000, repairs: 40000, print: 12000, bank: 6000.35, travel: 70000.45, adv: 80000, audit: 60000, fdInt: 8000, misc: 2000, tlInt: 60000, ccInt: 30000, fee: 5000, dep: {"Plant and Machinery": 165000, "Computers": 80000, "Furniture and Fixtures": 10000}, tax: 150000, dtax: -4000, advTax: 30000, taxPaid: 120000}};
  const write = v => ["py", "cy"].forEach(yr => {
    const p = plan[yr], fy = yr === "py" ? 2024 : 2025, ms = months(fy), bank = "Kite Bank Current A/c";
    ms.forEach((m, i) => {
      const s = r2(p.sales / 12), gst = r2(s * 0.18);
      v(yr, day(m, 5), "Sales", [["Crane Retail", r2((s + gst) * 0.6)], ["Dove Stores", r2((s + gst) * 0.4)], ["Sales", -s], ["GST Payable", -gst]].map(([l, a], j, arr) => j === 1 ? [l, r2(s + gst - r2((s + gst) * 0.6))] : [l, a]));
      const pu = r2(p.purch / 12), ig = r2(pu * 0.18);
      v(yr, day(m, 8), "Purchase", [["Purchase - Raw Material", pu], ["Input GST", ig], ["Alder Components", -r2((pu + ig) * 0.3)], ["Birch Metals", -r2(pu + ig - r2((pu + ig) * 0.3))]]);
      // receipts and payments
      v(yr, day(m, 20), "Receipt", [[bank, r2((s + gst) * 0.95)], ["Crane Retail", -r2((s + gst) * 0.95 * 0.6)], ["Dove Stores", -r2(r2((s + gst) * 0.95) - r2((s + gst) * 0.95 * 0.6))]]);
      v(yr, day(m, 22), "Payment", [["Alder Components", r2((pu + ig) * 0.3 * 0.95)], ["Birch Metals", r2((pu + ig) * 0.95 - r2((pu + ig) * 0.3 * 0.95))], [bank, -r2((pu + ig) * 0.95)]]);
      // GST: this month's output less input, paid
      v(yr, day(m, 24), "Journal", [["GST Payable", gst], ["Input GST", -ig], [bank, -r2(gst - ig)]]);
      // salaries (March: payable), PF, rent with TDS, expenses
      const sal = r2(p.sal / 12);
      v(yr, day(m, 28), i === 11 ? "Journal" : "Payment", [["Salaries and Wages", sal], [i === 11 ? "Salary Payable" : bank, -sal]]);
      v(yr, day(m, 28), "Payment", [["Directors Remuneration", r2(p.dir / 12)], [bank, -r2(p.dir / 12)]]);
      v(yr, day(m, 15), "Payment", [["Employer PF Contribution", r2(p.pf / 12)], [bank, -r2(p.pf / 12)]]);
      const rent = r2(p.rent / 12), tds = r2(rent * 0.1);
      v(yr, day(m, 3), "Payment", [["Rent", rent], ["TDS Payable", -tds], [bank, -r2(rent - tds)]]);
      v(yr, day(m, 7), "Payment", [["TDS Payable", i === 0 ? 2000 : r2(r2(p.rent / 12) * 0.1)], [bank, -(i === 0 ? 2000 : r2(r2(p.rent / 12) * 0.1))]]);
      v(yr, day(m, 10), "Payment", [["Power and Fuel", r2(p.power / 12)], [bank, -r2(p.power / 12)]]);
      v(yr, day(m, 2), "Contra", [["Cash", 10000], [bank, -10000]]);
      v(yr, day(m, 12), "Payment", [["Staff Welfare", r2(p.welfare / 12)], ["Printing and Stationery", r2(p.print / 12)], ["Cash", -r2(r2(p.welfare / 12) + r2(p.print / 12))]]);
      v(yr, day(m, 14), "Payment", [["Travelling Expenses", r2(p.travel / 12)], ["Cash", -r2(p.travel / 12)]]);
      v(yr, day(m, 26), "Payment", [["Bank Charges", r2(p.bank / 12)], [bank, -r2(p.bank / 12)]]);
      v(yr, day(m, 26), "Payment", [["Interest on Term Loan", r2(p.tlInt / 12)], ["Kite Bank Term Loan", 10000], [bank, -r2(r2(p.tlInt / 12) + 10000)]]);
      v(yr, day(m, 27), "Journal", [["Interest on CC Account", r2(p.ccInt / 12)], ["Kite Bank Cash Credit", -r2(p.ccInt / 12)]]);
    });
    // the year's single items
    v(yr, day(ms[4], 18), "Payment", [["Repairs and Maintenance", p.repairs], [bank, -p.repairs]]);
    v(yr, day(ms[6], 18), "Payment", [["Advertisement", p.adv], [bank, -p.adv]]);
    v(yr, day(ms[2], 30), "Payment", [["Audit Fees Payable", 40000 + (yr === "cy" ? 10000 : 0)], [bank, -(40000 + (yr === "cy" ? 10000 : 0))]]);
    v(yr, day(ms[11], 31), "Journal", [["Audit Fees", p.audit], ["Audit Fees Payable", -p.audit]]);
    v(yr, day(ms[11], 31), "Journal", [["Kite Bank Fixed Deposit", p.fdInt], ["Interest on FD", -p.fdInt]]);
    if (p.misc) v(yr, day(ms[9], 11), "Receipt", [["Cash", p.misc], ["Miscellaneous Income", -p.misc]]);
    if (p.fee) v(yr, day(ms[5], 11), "Payment", [["Loan Processing Fee", p.fee], [bank, -p.fee]]);
    [ms[2], ms[5], ms[8], ms[11]].forEach(m => v(yr, day(m, 15), "Payment", [["Advance Tax & TDS", r2(p.advTax / 4)], [bank, -r2(p.advTax / 4)]]));
    v(yr, day(ms[3], 25), "Payment", [["Provision for Income Tax", p.taxPaid], [bank, -p.taxPaid]]);
    v(yr, day(ms[11], 31), "Journal", [["Income Tax", p.tax], ["Provision for Income Tax", -p.tax]]);
    v(yr, day(ms[11], 31), "Journal", [["Deferred Tax Asset", -p.dtax], ["Deferred Tax", p.dtax]]);
    Object.entries(p.dep).forEach(([l, a]) => v(yr, day(ms[11], 31), "Journal", [["Depreciation", a], [l, -a]]));
    v(yr, day(ms[1], 9), "Purchase", [["Carriage Inward", p.carriage], [bank, -p.carriage]]);
    if (yr === "cy"){
      v(yr, day(ms[5], 3), "Payment", [["Plant and Machinery", 200000], [bank, -200000]]);
      v(yr, day(ms[7], 3), "Payment", [["Computers", 50000], [bank, -50000]]);
      v(yr, day(ms[6], 1), "Receipt", [[bank, 500000], ["Equity Share Capital", -200000], ["Securities Premium", -300000]]);
      v(yr, day(ms[9], 1), "Payment", [["Loan to Director - B Iyer", 20000], [bank, -20000]]);
    }
  });
  const B = books({groups: G, open, write, stockPy: {"Finished Goods Stock": 300000, "Raw Material Stock": 200000}, profitTo: [["Profit & Loss A/c", 100]], msme: {"Alder Components": "small"}});
  const tpMse = -close(B.tb, "Alder Components"), tpAll = -close(B.tb, "Alder Components") - close(B.tb, "Birch Metals");
  const pyMse = -B.tb.find(t => t.l === "Alder Components").o, pyAll = pyMse - B.tb.find(t => t.l === "Birch Metals").o;
  const trAll = close(B.tb, "Crane Retail") + close(B.tb, "Dove Stores"), trPy = B.tb.find(t => t.l === "Crane Retail").o + B.tb.find(t => t.l === "Dove Stores").o;
  const split = (a, parts) => { const out = parts.map(p => r2(a * p)); out[out.length - 1] = r2(a - out.slice(0, -1).reduce((s, x) => s + x, 0)); return out; };
  const age = {tp: {cy: {msme: [0].concat(split(tpMse, [0.7, 0.3, 0, 0, 0])), others: [0].concat(split(tpAll - tpMse, [0.6, 0.4, 0, 0, 0]))}, py: {msme: [0].concat(split(pyMse, [0.8, 0.2, 0, 0, 0])), others: [0].concat(split(pyAll - pyMse, [0.55, 0.45, 0, 0, 0]))}},
    tr: {cy: {ug: split(trAll, [0.55, 0.3, 0.15, 0, 0, 0])}, py: {ug: split(trPy, [0.5, 0.35, 0.15, 0, 0, 0])}}};
  const det = {
    stock: {cy: {"Finished Goods": 350000, "Raw Materials": 260000}},
    shares: {authorised: [{n: 200000, fv: 10, cls: "Equity"}], issued: {cy: {n: 120000, fv: 10}, py: {n: 100000, fv: 10}}, issuedDuring: {cy: {n: 20000}, py: {n: 0}},
      holders5: [{name: "A Rao", cy: 66000, py: 60000}, {name: "B Iyer", cy: 54000, py: 40000}], promoters: [{name: "A Rao", cy: 66000, py: 60000}, {name: "B Iyer", cy: 54000, py: 40000}]},
    loans: [{ledger: "Kite Bank Term Loan", desc: "Term loan from Kite Bank", rate: 9.5, terms: "120 monthly instalments of ₹10,000 plus interest", security: "Hypothecation of plant and machinery; personal guarantee of the directors", secured: true},
      {ledger: "Loan from Director - A Rao", desc: "Loan from a director", rate: 0, terms: "Payable on Demand"},
      {ledger: "Kite Bank Cash Credit", desc: "Cash credit from Kite Bank", rate: 10.25, terms: "Payable on Demand", security: "Hypothecation of inventories and book debts", secured: true}],
    far: {cy: [{cls: "Plant and Machinery", gOpen: 1500000, gAdd: 200000, gDel: 0, dOpen: 600000, dYear: 165000, dDel: 0}, {cls: "Furniture and Fixtures", gOpen: 200000, gAdd: 0, gDel: 0, dOpen: 100000, dYear: 10000, dDel: 0}, {cls: "Computers", gOpen: 400000, gAdd: 50000, gDel: 0, dOpen: 250000, dYear: 80000, dDel: 0}],
      py: [{cls: "Plant and Machinery", gOpen: 1500000, gAdd: 0, gDel: 0, dOpen: 450000, dYear: 150000, dDel: 0}, {cls: "Furniture and Fixtures", gOpen: 200000, gAdd: 0, gDel: 0, dOpen: 80000, dYear: 20000, dDel: 0}, {cls: "Computers", gOpen: 400000, gAdd: 0, gDel: 0, dOpen: 150000, dYear: 100000, dDel: 0}]},
    rp: {parties: [{name: "A Rao", relation: "Director"}, {name: "B Iyer", relation: "Director"}],
      tx: [{name: "A Rao", nature: "Directors' remuneration", cy: 300000, py: 270000}, {name: "B Iyer", nature: "Directors' remuneration", cy: 300000, py: 270000}, {name: "B Iyer", nature: "Loan given", cy: 20000, py: 0}],
      bal: [{name: "A Rao", relation: "Director", nature: "Loan taken (Liability)", ledger: "Loan from Director - A Rao"}, {name: "B Iyer", relation: "Director", nature: "Loan given (Asset)", ledger: "Loan to Director - B Iyer"}]},
    rpLoans: [{ledger: "Loan to Director - B Iyer", type: "Directors", basis: "demand"}],
    auditorRem: {statutory: 45000, tax: 15000, py: {statutory: 40000, tax: 10000}},
    ratioExplain: {current: "Higher receivables and inventories with the growth in sales.", de: "Repayment of the term loan and the share issue.", dscr: "Higher profits.", roe: "Higher profits.", inv: "Higher sales.", tr: "Faster collections.", tp: "Higher purchases.", nct: "Growth in sales.", np: "Higher sales at stable costs.", roce: "Higher profits.", roi: "Interest on the fixed deposit."},
    sign: {auditor: {firm: "Made-Up & Associates", frn: "123456W", partner: "C Fernandes", mno: "234567", udin: "26234567ABCDEF1234", place: "Pune", date: "01-09-2026"}, directors: [{name: "A Rao", din: "01234567"}, {name: "B Iyer", din: "07654321"}], place: "Pune", date: "01-09-2026"}
  };
  return {entity: {name: "Kestrel Widgets Private Limited", kind: "company", cin: "U12345MH2015PTC123456", pan: "AAACK1234K", udyam: "UDYAM-MH-00-0000000", address: "Plot 1, Made-up Industrial Area, Pune 411001"},
    fy: "2025", tb: B.tb, vouchers: B.vouchers, det, age, pyProfit: B.pyProfit};
}

// ---------------------------------------------------------------- the firm
function firm(){
  const G = {
    "Capital A/c - Asha Menon": ["Capital Account"], "Capital A/c - Ravi Desai": ["Capital Account"], "Current A/c - Asha Menon": ["Capital Account"], "Current A/c - Ravi Desai": ["Capital Account"], "Profit & Loss A/c": [],
    "Kite Bank Term Loan": ["Secured Loans"], "Elm Supplies": ["Sundry Creditors"], "Fig Traders": ["Sundry Creditors"], "TDS Payable": ["Duties & Taxes"], "Salary Payable": ["Current Liabilities"],
    "Provision for Income Tax": ["Provisions"], "Plant and Machinery": ["Fixed Assets"], "Computers": ["Fixed Assets"], "Furniture and Fixtures": ["Fixed Assets"], "Investment in Shares of Wren Pvt Ltd": ["Investments"],
    "Finished Goods Stock": ["Stock-in-Hand"], "Raw Material Stock": ["Stock-in-Hand"], "Gull Mart": ["Sundry Debtors"], "Cash": ["Cash-in-Hand"], "Kite Bank Current A/c": ["Bank Accounts"],
    "Advance Tax & TDS": ["Loans & Advances (Asset)"], "Staff Advance": ["Loans & Advances (Asset)"],
    "Sales": ["Sales Accounts"], "Dividend Income": ["Indirect Incomes"], "Purchase - Raw Material": ["Purchase Accounts"], "Purchase - Trading Goods": ["Purchase Accounts"],
    "Salaries and Wages": ["Indirect Expenses"], "Partner Remuneration - Asha Menon": ["Indirect Expenses"], "Partner Remuneration - Ravi Desai": ["Indirect Expenses"],
    "Interest to Partner - Asha Menon": ["Indirect Expenses"], "Interest to Partner - Ravi Desai": ["Indirect Expenses"], "Interest on Term Loan": ["Indirect Expenses"], "Depreciation": ["Indirect Expenses"],
    "Power and Fuel": ["Indirect Expenses"], "Rent": ["Indirect Expenses"], "Audit Fees": ["Indirect Expenses"], "Freight Outward": ["Indirect Expenses"], "Bank Charges": ["Indirect Expenses"], "Income Tax": ["Indirect Expenses"]
  };
  const open = {"Capital A/c - Asha Menon": -600000, "Capital A/c - Ravi Desai": -400000, "Current A/c - Asha Menon": -50000, "Current A/c - Ravi Desai": -30000, "Kite Bank Term Loan": -300000,
    "Elm Supplies": -90000, "Fig Traders": -60000, "TDS Payable": -1000, "Salary Payable": 0, "Provision for Income Tax": -80000, "Plant and Machinery": 400000, "Computers": 100000, "Furniture and Fixtures": 80000,
    "Investment in Shares of Wren Pvt Ltd": 100000, "Finished Goods Stock": 250000, "Raw Material Stock": 120000, "Gull Mart": 300000, "Cash": 20000, "Kite Bank Current A/c": 181000, "Advance Tax & TDS": 50000, "Staff Advance": 10000};
  open["Profit & Loss A/c"] = -Object.values(open).reduce((a, b) => a + b, 0);
  const plan = {py: {sales: 3600000, rm: 1200000, tg: 600000, sal: 360000, remA: 240000, remB: 180000, intA: 72000, intB: 48000, tlInt: 30000, power: 90000, rent: 120000, audit: 30000, freight: 45000, bank: 3000, div: 5000, tax: 90000, taxPaid: 80000, adv: 40000, dep: {"Plant and Machinery": 60000, "Computers": 40000, "Furniture and Fixtures": 8000}, wdA: 200000, wdB: 150000, introA: 0},
    cy: {sales: 4300000, rm: 1500000, tg: 700000, sal: 420000, remA: 264000, remB: 198000, intA: 72000, intB: 48000, tlInt: 24000, power: 100000, rent: 132000, audit: 35000, freight: 52000.6, bank: 3500.3, div: 6000, tax: 110000, taxPaid: 90000, adv: 60000, dep: {"Plant and Machinery": 66000, "Computers": 34000, "Furniture and Fixtures": 7200}, wdA: 220000, wdB: 160000, introA: 100000}};
  const write = v => ["py", "cy"].forEach(yr => {
    const p = plan[yr], fy = yr === "py" ? 2024 : 2025, ms = months(fy), bank = "Kite Bank Current A/c";
    ms.forEach((m, i) => {
      const s = r2(p.sales / 12);
      v(yr, day(m, 6), "Sales", [["Gull Mart", s], ["Sales", -s]]);
      v(yr, day(m, 21), "Receipt", [[bank, r2(s * 0.97)], ["Gull Mart", -r2(s * 0.97)]]);
      const rm = r2(p.rm / 12), tg = r2(p.tg / 12);
      v(yr, day(m, 9), "Purchase", [["Purchase - Raw Material", rm], ["Purchase - Trading Goods", tg], ["Elm Supplies", -r2((rm + tg) * 0.6)], ["Fig Traders", -r2(rm + tg - r2((rm + tg) * 0.6))]]);
      v(yr, day(m, 23), "Payment", [["Elm Supplies", r2((rm + tg) * 0.6 * 0.97)], ["Fig Traders", r2((rm + tg) * 0.97 - r2((rm + tg) * 0.6 * 0.97))], [bank, -r2((rm + tg) * 0.97)]]);
      const sal = r2(p.sal / 12); v(yr, day(m, 28), i === 11 ? "Journal" : "Payment", [["Salaries and Wages", sal], [i === 11 ? "Salary Payable" : bank, -sal]]);
      const rent = r2(p.rent / 12), tds = r2(rent * 0.1);
      v(yr, day(m, 3), "Payment", [["Rent", rent], ["TDS Payable", -tds], [bank, -r2(rent - tds)]]);
      v(yr, day(m, 7), "Payment", [["TDS Payable", i === 0 ? 1000 : r2(r2(p.rent / 12) * 0.1)], [bank, -(i === 0 ? 1000 : r2(r2(p.rent / 12) * 0.1))]]);
      v(yr, day(m, 11), "Payment", [["Power and Fuel", r2(p.power / 12)], ["Cash", -r2(p.power / 12)]]);
      v(yr, day(m, 2), "Contra", [["Cash", 8000], [bank, -8000]]);
      v(yr, day(m, 26), "Payment", [["Freight Outward", r2(p.freight / 12)], [bank, -r2(p.freight / 12)]]);
      v(yr, day(m, 26), "Payment", [["Bank Charges", r2(p.bank / 12)], [bank, -r2(p.bank / 12)]]);
      v(yr, day(m, 27), "Payment", [["Interest on Term Loan", r2(p.tlInt / 12)], ["Kite Bank Term Loan", 5000], [bank, -r2(r2(p.tlInt / 12) + 5000)]]);
      v(yr, day(m, 15), "Payment", [["Current A/c - Asha Menon", r2(p.wdA / 12)], [bank, -r2(p.wdA / 12)]]);
      v(yr, day(m, 15), "Payment", [["Current A/c - Ravi Desai", r2(p.wdB / 12)], [bank, -r2(p.wdB / 12)]]);
    });
    v(yr, day(ms[11], 31), "Journal", [["Partner Remuneration - Asha Menon", p.remA], ["Current A/c - Asha Menon", -p.remA]]);
    v(yr, day(ms[11], 31), "Journal", [["Partner Remuneration - Ravi Desai", p.remB], ["Current A/c - Ravi Desai", -p.remB]]);
    v(yr, day(ms[11], 31), "Journal", [["Interest to Partner - Asha Menon", p.intA], ["Current A/c - Asha Menon", -p.intA]]);
    v(yr, day(ms[11], 31), "Journal", [["Interest to Partner - Ravi Desai", p.intB], ["Current A/c - Ravi Desai", -p.intB]]);
    v(yr, day(ms[11], 31), "Journal", [["Audit Fees", p.audit], ["Kite Bank Current A/c", -p.audit]]);
    v(yr, day(ms[8], 20), "Receipt", [[bank, p.div], ["Dividend Income", -p.div]]);
    [ms[2], ms[5], ms[8], ms[11]].forEach(m => v(yr, day(m, 15), "Payment", [["Advance Tax & TDS", r2(p.adv / 4)], [bank, -r2(p.adv / 4)]]));
    v(yr, day(ms[3], 25), "Payment", [["Provision for Income Tax", p.taxPaid], [bank, -p.taxPaid]]);
    v(yr, day(ms[11], 31), "Journal", [["Income Tax", p.tax], ["Provision for Income Tax", -p.tax]]);
    Object.entries(p.dep).forEach(([l, a]) => v(yr, day(ms[11], 31), "Journal", [["Depreciation", a], [l, -a]]));
    if (yr === "cy"){
      v(yr, day(ms[4], 2), "Payment", [["Plant and Machinery", 100000], [bank, -100000]]);
      v(yr, day(ms[9], 20), "Payment", [["Computers", 50000], [bank, -50000]]);
      v(yr, day(ms[1], 1), "Receipt", [[bank, p.introA], ["Capital A/c - Asha Menon", -p.introA]]);
    }
  });
  const B = books({groups: G, open, write, stockPy: {"Finished Goods Stock": 270000, "Raw Material Stock": 140000}, profitTo: [["Current A/c - Asha Menon", 60], ["Current A/c - Ravi Desai", 40]]});
  const partners = [{name: "Asha Menon", share: 60, pan: "ABCPM1234A", capital: "Capital A/c - Asha Menon", current: "Current A/c - Asha Menon", rem: ["Partner Remuneration - Asha Menon"], int: ["Interest to Partner - Asha Menon"]},
    {name: "Ravi Desai", share: 40, pan: "ABCPD5678B", capital: "Capital A/c - Ravi Desai", current: "Current A/c - Ravi Desai", rem: ["Partner Remuneration - Ravi Desai"], int: ["Interest to Partner - Ravi Desai"]}];
  const det = {
    stock: {cy: {"Finished Goods": 310000, "Raw Materials": 150000}},
    partners,
    itBlocks: {cy: [{block: "Plant and Machinery (15%)", rate: 15, open: 340000, addGt180: 100000, addLt180: 0, sale: 0}, {block: "Computers (40%)", rate: 40, open: 60000, addGt180: 0, addLt180: 50000, sale: 0}, {block: "Furniture and Fixtures (10%)", rate: 10, open: 72000, addGt180: 0, addLt180: 0, sale: 0}],
      py: [{block: "Plant and Machinery (15%)", rate: 15, open: 400000}, {block: "Computers (40%)", rate: 40, open: 100000}, {block: "Furniture and Fixtures (10%)", rate: 10, open: 80000}]},
    loans: [{ledger: "Kite Bank Term Loan", desc: "Term loan from Kite Bank", rate: 9, terms: "60 monthly instalments of ₹5,000 plus interest", security: "Hypothecation of plant and machinery", secured: true}],
    auditorRem: {statutory: 25000, tax: 10000, py: {statutory: 22000, tax: 8000}},
    ratioExplain: {np: "Higher sales at stable costs.", gp: "Better prices on traded goods."},
    sign: {auditor: {firm: "Made-Up & Associates", frn: "123456W", partner: "C Fernandes", mno: "234567", udin: "26234567GHIJKL5678", place: "Pune", date: "01-09-2026"}, partners: partners.map(p => ({name: p.name, pan: p.pan})), place: "Pune", date: "01-09-2026"}
  };
  return {entity: {name: "Heron Traders & Co.", kind: "firm", pan: "AAFFH1234H", address: "Shop 2, Made-up Market Road, Nashik 422001"}, fy: "2025", tb: B.tb, vouchers: B.vouchers, det, age: null, pyProfit: B.pyProfit};
}
// the confirmed mapping for a fixture: the rules' suggestion, confirmed once
function confirmed(FSX, fx){ const st = FSX.confirm({versions: []}, FSX.mapping({versions: []}, fx.tb, fx.entity.kind).map, "test", "2026-10-13"); return st; }
// the spec's exact note order and titles (scratchpad bsformat/spec.md, sections 1.2 and 1.3)
const SPEC_COMPANY = ["General Information", "Significant Accounting Policies", "Share Capital", "Reserves and Surplus", "Long-term Borrowings", "Short-term Borrowings", "Trade Payables", "Other Current Liabilities",
  "Short-term Provisions", "Property, Plant and Equipment and Intangible Assets", "Non-current Investments", "Deferred Tax Assets (Net)", "Long-term Loans and Advances", "Inventories", "Trade Receivables", "Cash and Bank Balances",
  "Short-term Loans and Advances", "Other Current Assets", "Revenue from Operations", "Other Income", "Cost of Materials Consumed", "Change in Inventories of finished goods, work-in-progress and stock-in-trade",
  "Employee Benefits Expense", "Finance Costs", "Depreciation and Amortisation Expense", "Other Expenses", "Tax Expenses", "Earnings Per Share", "Related Party Disclosures", "Analytical Ratios",
  "Additional Regulatory Information for current and previous year", "Other Disclosures"];
const SPEC_FIRM = ["General Information", "Significant Accounting Policies", "Partners' Capital Account", "Partners' Current Account", "Reserves and Surplus", "Long-term Borrowings", "Trade Payables", "Other Current Liabilities",
  "Short-term Provisions", "Income Tax Block of Property, Plant and Equipment and Intangible Assets", "Non-current Investments", "Inventories", "Trade Receivables", "Cash and Bank Balances", "Short-term Loans and Advances",
  "Revenue from Operations", "Other Income", "Cost of Materials Consumed", "Purchases of Stock in Trade", "Change in Inventories of finished goods, work-in-progress and stock-in-trade", "Employee Benefits Expense",
  "Finance Costs", "Depreciation and Amortisation Expense", "Other Expenses", "Tax Expenses", "Analytical Ratios", "Other Disclosures"];
module.exports = {loadFSX, company, firm, confirmed, SPEC_COMPANY, SPEC_FIRM, r2};
