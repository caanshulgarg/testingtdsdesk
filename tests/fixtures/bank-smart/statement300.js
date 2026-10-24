// A made-up HDFC statement of 300 mixed lines (UPI, IMPS, NEFT, RTGS, cheques, ATM, card, charges, interest, GST, TDS,
// salary, NACH), for tests/run_bank_smart.py and the bank page's screenshots. Evaluated in the page as one arrow
// function: it opens a client "SMART TRADERS" on its bank page with this statement, every line decoded and suggested
// by FinCom's own code (decodeNarr, suggestAll), as an upload would leave it. Deterministic (a fixed seed).
() => {
  let seed = 20261024;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const amt = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  const n12 = () => String(400000000000 + Math.floor(rnd() * 99999999999));
  const c = newCompany({name: "SMART TRADERS", gstin: "09AAKFS1234C1Z5"});
  c.bankAccounts = [{id: "a1", bank: "HDFC", acct: "50100012345678", last4: "5678", ledger: "HDFC Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  // payees: [name in the narration, UPI handle, has a Tally ledger]
  const UPI_OUT = [["SHARMA STATIONERY", "sharmastationery@ybl"], ["GUPTA ELECTRICALS", "guptaelec@okaxis"], ["RAJ TEA STALL", "rajtea@paytm"], ["BLINKIT", "blinkit.payu@hdfcbank"],
    ["SWIGGY", "swiggy@icici"], ["UBER INDIA", "uber@axisbank"], ["AIRTEL", "airtel.payu@axisbank"], ["MOHAN LAL", "mohanlal77@oksbi"]];
  const UPI_IN = [["RAMESH GUPTA", "ramesh.gupta@okhdfc"], ["NEHA VERMA", "nehav@ybl"], ["ANKIT JAIN", "ankitjain@paytm"], ["SUNRISE MART", "sunrisemart@okicici"]];
  const PARTIES = ["VIKAS TRADERS", "CLOUD WIZARD CONSULTING PVT LTD", "ACME INDUSTRIES LTD", "KAPOOR AND SONS", "MEHTA BROS", "BLUE DART EXPRESS LTD", "NAVNEET TENDERS", "ORBIT LOGISTICS"];
  const STAFF = ["RAJESH KUMAR", "POOJA SINGH", "AMIT YADAV", "SUNITA DEVI"];
  const IFSC = ["ICIC0001234", "SBIN0004321", "UTIB0000456", "PUNB0123400", "KKBK0005678"];
  const kinds = [];
  const add = (k, n) => { for (let i = 0; i < n; i++) kinds.push(k); };
  add("upiOut", 62); add("upiIn", 38); add("impsOut", 18); add("impsIn", 12); add("neftOut", 28); add("neftIn", 18); add("salary", 12); add("rtgs", 8);
  add("chqPaid", 14); add("chqDep", 10); add("atm", 10); add("pos", 14); add("charges", 14); add("interest", 4); add("gst", 8); add("tds", 5); add("nach", 10); add("trf", 15);
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let bal = 1250000;
  const rows = kinds.map((k, i) => {
    const day = new Date(Date.UTC(2026, 3, 1) + Math.floor(i * 182 / kinds.length) * 86400000).toISOString().slice(0, 10);
    let narr = "", out = true, a = 0, ref = "";
    if (k === "upiOut") { const p = pick(UPI_OUT); ref = n12(); a = amt(80, 6000); narr = "UPI/DR/" + ref + "/" + p[0].slice(0, 20) + "/" + pick(["YESB", "HDFC", "ICIC", "SBIN"]) + "/" + p[1] + "/" + pick(["Paid", "Payment", "Office", "NA"]); }
    if (k === "upiIn") { const p = pick(UPI_IN); ref = n12(); a = amt(500, 25000); out = false; narr = "UPI/CR/" + ref + "/" + p[0] + "/" + pick(["HDFC", "UTIB", "KKBK"]) + "/" + p[1] + "/" + pick(["Fees", "Payment", "NA"]); }
    if (k === "impsOut") { const p = pick(PARTIES); ref = n12(); a = amt(2000, 90000); narr = "IMPS/P2A/" + ref + "/" + p.slice(0, 22) + "/" + pick(IFSC) + "/Payment"; }
    if (k === "impsIn") { const p = pick(PARTIES); ref = n12(); a = amt(2000, 90000); out = false; narr = "MMT/IMPS/" + ref + "/" + p.slice(0, 22) + "/" + pick(IFSC); }
    if (k === "neftOut") { const p = pick(PARTIES); ref = "N" + n12(); a = amt(10000, 300000); narr = "NEFT DR-" + pick(IFSC) + "-" + p + "-NETBANK, MUM-" + ref + "-INV " + Math.floor(rnd() * 900 + 100); }
    if (k === "neftIn") { const p = pick(PARTIES); ref = pick(["SBIN", "UTIB", "ICIC"]) + "N" + n12(); a = amt(10000, 400000); out = false; narr = "NEFT CR-" + pick(IFSC) + "-" + p + "-SMART TRADERS-" + ref; }
    if (k === "salary") { const p = pick(STAFF); ref = "N" + n12(); a = amt(18000, 45000); narr = "NEFT DR-" + pick(IFSC) + "-" + p + "-SALARY " + ["APR", "MAY", "JUN", "JUL", "AUG", "SEP"][Math.floor(i * 6 / 300)] + " 2026-" + ref; }
    if (k === "rtgs") { const p = pick(PARTIES.slice(1, 4)); ref = "HDFCR5" + n12(); a = amt(250000, 900000); out = rnd() < 0.5; narr = "RTGS " + (out ? "DR" : "CR") + "-" + pick(IFSC) + "-" + p + "-" + ref; }
    if (k === "chqPaid") { const p = pick(PARTIES); ref = String(100000 + Math.floor(rnd() * 899999)).slice(0, 6); a = amt(5000, 150000); narr = "CHQ PAID-MICR CTS-" + ref + "-" + p; }
    if (k === "chqDep") { const p = pick(PARTIES); ref = String(100000 + Math.floor(rnd() * 899999)).slice(0, 6); a = amt(5000, 150000); out = false; narr = "CHQ DEP-CLG-" + ref + "-" + p + "-LUCKNOW"; }
    if (k === "atm") { a = pick([2000, 5000, 10000, 20000]); narr = "ATW-512345XXXXXX4321-S1ANLK" + Math.floor(rnd() * 90 + 10) + "-LUCKNOW"; }
    if (k === "pos") { a = amt(300, 12000); narr = "POS 512345XXXXXX4321 " + pick(["AMAZON PAY INDIA", "RELIANCE DIGITAL", "INDIAN OIL PETROL", "DMART LUCKNOW"]); }
    if (k === "charges") { a = pick([17.7, 59, 118, 236, 590]); narr = pick(["SMS CHARGES FOR QTR ENDED", "CONSOLIDATED CHARGES FOR A/C", "NEFT CHRG INCL GST", "DEBIT CARD ANNUAL FEE", "CHQ BOOK ISSUE CHARGES"]); }
    if (k === "interest") { a = amt(800, 6000); out = false; narr = "CREDIT INTEREST CAPITALISED " + day; }
    if (k === "gst") { ref = "2604" + n12().slice(0, 10); a = amt(5000, 80000); narr = "GST PAYMENT CPIN " + ref + " GSTN 09AAKFS1234C1Z5"; }
    if (k === "tds") { a = amt(2000, 30000); narr = "TDS PAYMENT ITNS281 CIN " + n12().slice(0, 9) + " OLTAS"; }
    if (k === "nach") { a = pick([4520, 12750, 31200]); narr = "ACH D- " + pick(["HDFC LTD HOME LOAN", "BAJAJ FINANCE LTD", "ICICI PRU LIFE"]) + "-" + n12().slice(0, 8); }
    if (k === "trf") { a = amt(10000, 200000); out = rnd() < 0.6; narr = (out ? "FT - DR - " : "FT - CR - ") + "50100098765432 - SMART TRADERS FD"; }
    bal = Math.round((bal + (out ? -a : a)) * 100) / 100;
    return {id: "s300-" + i, fp: "fp300-" + i, date: day, debit: out ? a : 0, credit: out ? 0 : a, balance: bal, narr, ref, balOk: true,
      dec: decodeNarr(narr, c.name), state: "attention", ledger: "", userSet: false};
  });
  const led = (name, group) => ({name, group});
  const ledgers = [led("HDFC Bank", "Bank Accounts"), led("Cash", "Cash-in-Hand"), led("Bank Charges", "Indirect Expenses"), led("Interest Received", "Indirect Incomes"),
    led("Salaries", "Indirect Expenses"), led("Electronic Cash Ledger", "Current Assets"), led("TDS Payable", "Duties & Taxes"), led("Office Expenses", "Indirect Expenses"),
    led("Staff Welfare", "Indirect Expenses"), led("Conveyance", "Indirect Expenses"), led("Telephone Expenses", "Indirect Expenses"), led("Loan EMI", "Loans (Liability)"),
    led("SMART TRADERS FD", "Bank Accounts"), led("Sales Receipts Suspense", "Suspense A/c"),
    led("SHARMA STATIONERY", "Sundry Creditors"), led("GUPTA ELECTRICALS", "Sundry Creditors"), led("RAMESH GUPTA", "Sundry Debtors"), led("SUNRISE MART", "Sundry Debtors"),
    led("VIKAS TRADERS", "Sundry Creditors"), led("CLOUD WIZARD CONSULTING PVT LTD", "Sundry Creditors"), led("ACME INDUSTRIES LTD", "Sundry Debtors"),
    led("KAPOOR AND SONS", "Sundry Creditors"), led("MEHTA BROS", "Sundry Debtors"), led("BLUE DART EXPRESS LTD", "Sundry Creditors")];
  S.bank = {cid: c.id, loading: false, stmts: [{id: "st300", acctId: "a1", bank: "HDFC", acct: "50100012345678", from: rows[0].date, to: rows[rows.length - 1].date, opening: 1250000, closing: bal,
      totDr: 0, totCr: 0, badRows: 0, summaryOk: true}], cur: "st300", rows, rules: [], wrules: [],
    ledgers: {list: ledgers, importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100,
    pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  // the account's Tally ledger was confirmed when the first statement came (a one-time step: its banner is not part of the
  // everyday page)
  choiceConfirm(c, "bank:a1", "HDFC Bank");
  suggestAll(rows);
  render();
  return rows.length;
}
