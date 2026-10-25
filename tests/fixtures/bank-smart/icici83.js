// A made-up ICICI statement shaped like the owner's first real use (25-Oct-2026: Testing AAD, ICICI Bank, 05-Oct-2026 to
// 21-Oct-2026, 83 entries): ICICI's narrations ("UPI/<ref>/<name>/<handle>//<id>", "MMT/IMPS/<ref>/<code>/<name cut to
// ten letters>/<IFSC>", "INF/NEFT/<ref>/<bank code>/<a/c>"), for tests/run_bank_smart.py and the bank page's screenshots.
// Evaluated in the page as one arrow function taking where the client's Tally ledgers are:
//   "books": only in the client's books (Books -> From Tally: the ledger masters XML uploaded; S.books.ledInfo / under),
//            as Testing AAD's were on staging (no book in FinCom's cloud copy, no bridge, nothing kept in this browser);
//   "cloud": in FinCom's cloud copy (Ledgers' own list, src "cloud");
//   "none":  nowhere.
// The client is opened on its bank page with the statement decoded and suggested by FinCom's own code. Deterministic.
(src) => {
  let seed = 20261025;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const amt = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  const n12 = () => String(100000000000 + Math.floor(rnd() * 899999999999));
  const c = newCompany({ name: "ICICI TESTING CO", gstin: "09AANFG3202D1ZR" });
  c.bankAccounts = [{ id: "i1", bank: "ICICI Bank", acct: "123405001234", last4: "1234", ledger: "ICICI Bank" }];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const UPI = [["UPIPay", "XXshar @axl"], ["RAMESHKUMA", "rameshk@okhdfc"], ["SWIGGY", "swiggy@icici"], ["Blinkit", "blinkit.payu@hdfcbank"], ["MOHAN LAL", "mohanlal77@oksbi"]];
  const IMPS = [["BULD80088625", "KumkumRagh"], ["BULD80088625", "AnilSharma"], ["MOBL45120098", "VikasTrade"]];
  const fixed = [
    ["MMT/IMPS/528114093821/BULD80088625/KumkumRagh/SBIN0004321", 15000, 0],
    ["INF/NEFT/IN12345678/ICIC00NOBCL/80088625", 0, 250000],
    ["UPI/110860578274/UPIPay/XXshar @axl//ICId214d4900a", 1200, 0],
  ];
  const rows = [];
  let bal = 845000;
  for (let i = 0; i < 83; i++) {
    let narr, out = true, a;
    if (i < fixed.length) { narr = fixed[i][0]; out = fixed[i][1] > 0; a = fixed[i][1] || fixed[i][2]; }
    else {
      const k = pick(["upi", "upi", "upi", "imps", "neft", "chg", "inf"]);
      if (k === "upi") { const p = pick(UPI); a = amt(80, 9000); out = rnd() < 0.7; narr = "UPI/" + n12() + "/" + p[0] + "/" + p[1] + "//ICI" + Math.floor(rnd() * 1e9).toString(16); }
      if (k === "imps") { const p = pick(IMPS); a = amt(2000, 60000); out = rnd() < 0.5; narr = "MMT/IMPS/" + n12() + "/" + p[0] + "/" + p[1] + "/" + pick(["SBIN0004321", "HDFC0001234", "UTIB0000456"]); }
      if (k === "neft") { a = amt(10000, 200000); out = rnd() < 0.5; narr = "NEFT-" + pick(["HDFCN", "SBINN"]) + n12() + "-" + pick(["CLOUD WIZARD CONSULTING", "BHARTI AIRTEL LIMITED", "KIYARA PRINTERS"]) + "-" + n12().slice(0, 10); }
      if (k === "chg") { a = pick([17.7, 59, 118]); narr = pick(["SMS Chgs Jul-Sep 26", "Cheque Book Charges", "Min Bal Chgs"]); }
      if (k === "inf") { a = amt(5000, 90000); out = rnd() < 0.5; narr = "INF/NEFT/IN" + Math.floor(rnd() * 1e8) + "/ICIC00NOBCL/80088625"; }
    }
    bal = Math.round((bal + (out ? -a : a)) * 100) / 100;
    const day = new Date(Date.UTC(2026, 9, 5) + Math.floor(i * 17 / 83) * 86400000).toISOString().slice(0, 10);
    rows.push({ id: "ic-" + i, fp: "fpic-" + i, date: day, debit: out ? a : 0, credit: out ? 0 : a, balance: bal, narr, ref: "", balOk: true,
      dec: decodeNarr(narr, c.name), state: "attention", ledger: "", userSet: false });
  }
  const names = [["ICICI Bank", "Bank Accounts"], ["Cash", "Cash-in-Hand"], ["Bank Charges", "Indirect Expenses"], ["Kumkum Raghav", "Sundry Creditors"],
    ["Anil Sharma & Sons", "Sundry Debtors"], ["Vikas Traders", "Sundry Creditors"], ["CLOUD WIZARD CONSULTING PRIVATE LIMITED", "Sundry Debtors"], ["Bharti Airtel Limited", "Sundry Creditors"],
    ["Kiyara Printers", "Sundry Creditors"], ["Staff Welfare", "Indirect Expenses"], ["Office Expenses", "Indirect Expenses"], ["Conveyance", "Indirect Expenses"]];
  const list = names.map(([name, group]) => ({ name, group }));
  if (src === "books") {
    // what Books -> From Tally's masters upload keeps (bringMastersFile, src/js/23): ledInfo and under, nothing in Ledgers
    const ledInfo = {}, under = {};
    names.forEach(([n, g]) => { ledInfo[n] = { group: g }; under[n] = g; });
    S.books = { cid: c.id, loading: false, vouchers: [], map: {}, challans: [], alloc: {}, pans: {}, gstins: {}, ledInfo, under, groups: { "Sundry Creditors": "Current Liabilities" }, ledInfoAt: "2026-10-09T09:57:28.989Z" };
  } else if (src === "cloud") {
    Ledgers.st[c.id] = { list, parents: {}, at: new Date().toISOString(), srcAt: new Date().toISOString(), src: "cloud", file: "Tally, from the copy in FinCom's cloud", book: "bk1", cloudAt: "" };
    Ledgers.ver++;
  }
  S.bank = { cid: c.id, loading: false, stmts: [{ id: "stic", acctId: "i1", bank: "ICICI Bank", acct: "123405001234", from: rows[0].date, to: rows[rows.length - 1].date, opening: 845000, closing: bal,
      totDr: 0, totCr: 0, badRows: 0, summaryOk: true }], cur: "stic", rows, rules: [], wrules: [],
    ledgers: src === "cloud" ? { list, importedAt: new Date().toISOString(), live: true, src: "cloud" } : { list: [], importedAt: "" }, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100,
    pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: { rows: {} }, histVer: 0, postedTags: {}, salesRef: [] };
  choiceConfirm(c, "bank:i1", "ICICI Bank");
  suggestAll(rows);
  render();
  return rows.length;
}
