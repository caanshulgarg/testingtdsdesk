// The made-up book for the audit working papers (src/js/77-audit.js), FY 2025-26, in FinCom's voucher shape
// ({id, date, type, no, ref, party, ent: [{l, a, b}], upd, alt}; Tally's sign: a debit is negative). Background entries
// (sales and purchases on working days, amounts spread by Benford's law, entered the same day) trip no check; every check
// then has its seeded cases, and EXPECTED lists, check by check, exactly the entries it must find, to the paisa.
// Used by tests/run_audit_wp.js (the rules) and tests/run_audit_wp_ui.py (the screen, through window.__auditFixture).
"use strict";
const FROM = "20250401", TO = "20260331", GSTIN = "07AAGCL4827M1Z3";
const r2 = (x) => Math.round(x * 100) / 100;
const ymd = (t) => t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, "0") + String(t.getUTCDate()).padStart(2, "0");
const dt = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
const HOL = ["0126", "0815", "1002"];
const working = (s) => dt(s).getUTCDay() !== 0 && !HOL.includes(s.slice(4));
const addDays = (s, n) => { const t = dt(s); t.setUTCDate(t.getUTCDate() + n); return ymd(t); };

function makeBooks() {
  const V = [], E = {};
  let alt = 0, n = 0;
  const exp = (check, v, amount) => (E[check] = E[check] || []).push({ vid: v.id, amount: r2(amount) });
  const add = (o) => { const v = Object.assign({ id: "v" + (++n), no: String(n), ref: "", party: "", narr: "", upd: o.date, alt: ++alt }, o); V.push(v); return v; };
  // two ledger lines: dr (debited, negative) and cr (credited, positive)
  const two = (type, date, dr, cr, amt, o) => add(Object.assign({ type, date, ent: [{ l: dr, a: -r2(amt) }, { l: cr, a: r2(amt) }] }, o || {}));

  // ---------------------------------------------------------------- background: 240 entries, Benford-spread amounts
  const CUST = ["Alpha Traders", "Beta Stores", "Gamma Retail"], SUP = ["Delta Supplies", "Epsilon Mart"];
  let d = FROM, k = 0;
  for (let i = 0; i < 240; i++) {
    while (!working(d)) d = addDays(d, 1);
    // amounts evenly spread on a log scale from 1,000 to 1,00,000: their first digits follow Benford's law
    let amt = r2(1000 * Math.pow(10, 2 * (i + 0.5) / 240) + 0.37);
    if (i % 2 === 0) two("Sales", d, CUST[k % 3], "Sales", amt, { party: CUST[k % 3], ref: "" });
    else two("Purchase", d, "Purchase", SUP[(i >> 1) % 2], amt, { party: SUP[(i >> 1) % 2], ref: "BG/" + i });
    k++;
    if (i % 2 === 1) d = addDays(d, 3);
  }

  // ---------------------------------------------------------------- 40A(3): cash payments above 10,000 a day to one party
  let v = two("Payment", "20250506", "Delta Supplies", "Cash", 10500.50, { party: "Delta Supplies" }); exp("cash40A3", v, 10500.50);
  two("Payment", "20250507", "Delta Supplies", "Cash", 9999.99, { party: "Delta Supplies" });                     // not above 10,000
  v = two("Payment", "20250512", "Epsilon Mart", "Cash", 6000.10, { party: "Epsilon Mart" });
  two("Payment", "20250512", "Epsilon Mart", "Cash", 5000.20, { party: "Epsilon Mart" }); exp("cash40A3", v, 11000.30);   // two the same day
  // the transporter: 35,000 a day
  const fr1 = two("Journal", "20250602", "Freight", "Sharma Roadways", 30000.25), fr2 = two("Journal", "20250603", "Freight", "Sharma Roadways", 36000.75); two("Journal", "20250604", "Freight", "Sharma Roadways", 10000.33);
  two("Payment", "20250609", "Sharma Roadways", "Cash", 30000.25, { party: "Sharma Roadways" });               // within 35,000
  v = two("Payment", "20250610", "Sharma Roadways", "Cash", 36000.75, { party: "Sharma Roadways" }); exp("cash40A3", v, 36000.75);

  // ---------------------------------------------------------------- 269ST: cash received of 2 lakh or more
  v = two("Receipt", "20250703", "Cash", "Alpha Traders", 200500.50, { party: "Alpha Traders" }); exp("cash269ST", v, 200500.50);
  v = two("Receipt", "20250704", "Cash", "Beta Stores", 150000.25, { party: "Beta Stores" });
  two("Receipt", "20250704", "Cash", "Beta Stores", 60000.25, { party: "Beta Stores" }); exp("cash269ST", v, 210000.50);
  two("Receipt", "20250707", "Cash", "Gamma Retail", 199999.99, { party: "Gamma Retail" });                     // just under

  // ---------------------------------------------------------------- 269SS / 269T: cash loans of 20,000 or more
  v = two("Receipt", "20250805", "Cash", "Ramesh Gupta Loan", 25000.50); exp("cashLoans", v, 25000.50);
  v = two("Payment", "20250905", "Ramesh Gupta Loan", "Cash", 20000.00); exp("cashLoans", v, 20000.00);
  two("Receipt", "20250906", "HDFC Bank", "Ramesh Gupta Loan", 15000.15);                                        // by bank
  two("Receipt", "20250908", "Cash", "Ramesh Gupta Loan", 19999.00);                                             // under 20,000

  // ---------------------------------------------------------------- TDS: not deducted, short deducted, paid late
  const k1 = two("Journal", "20251006", "Professional Fees", "Kapoor Associates", 60000.40, { party: "Kapoor Associates" });
  const k2 = two("Journal", "20251007", "Professional Fees", "Kapoor Associates", 5000.11, { party: "Kapoor Associates" });
  v = two("Journal", "20251008", "Professional Fees", "Kapoor Associates", 4000.22, { party: "Kapoor Associates" });
  // not deducted: 194J (69,000.73 over the 50,000 limit: every bill), and the transporter's freight (194C: the two bills over
  // 30,000, 30,000.25 and 36,000.75; the year's 76,001.33 is under 1,00,000). Round 69: the audit's TDS not deducted is
  // TDSWatch.missed, the TDS page's list, and its entries are the bills that count, one by one
  E.tds = [{ vid: k1.id, party: "Kapoor Associates", amount: 60000.40 }, { vid: k2.id, party: "Kapoor Associates", amount: 5000.11 }, { vid: v.id, party: "Kapoor Associates", amount: 4000.22 },
    { vid: fr1.id, party: "Sharma Roadways", amount: 30000.25 }, { vid: fr2.id, party: "Sharma Roadways", amount: 36000.75 }];
  // short: 1% on a company (194C is 2%)
  const short = add({ type: "Journal", date: "20251110", party: "Mehta Contractors Pvt Ltd", ent: [{ l: "Contract Charges", a: -100100 }, { l: "TDS Payable 194C", a: 1001 }, { l: "Mehta Contractors Pvt Ltd", a: 99099 }] });
  E.tds.push({ vid: short.id, party: "Mehta Contractors Pvt Ltd", amount: 1001.00 });
  // late: deducted 10-May-2025, due 07-Jun-2025, paid 20-Jul-2025: 3 months at 1.5% on 1,010
  const late = add({ type: "Journal", date: "20250512", party: "Nanda Builders Pvt Ltd", ent: [{ l: "Contract Charges", a: -50500 }, { l: "TDS Payable 194C", a: 1010 }, { l: "Nanda Builders Pvt Ltd", a: 49490 }] });
  two("Journal", "20250513", "Contract Charges", "Nanda Builders Pvt Ltd", 5000.45, { party: "Nanda Builders Pvt Ltd" });
  E.tds.push({ vid: late.id, party: "Nanda Builders Pvt Ltd", amount: 45.45 });
  const challans = [{ id: "ch1", date: "20250720", tax: 1010, section: "194C", bsr: "0510001", no: "00001" }, { id: "ch2", date: "20251205", tax: 1001, section: "194C", bsr: "0510001", no: "00002" }];
  const alloc = { [late.id + "|TDS Payable 194C"]: "ch1", [short.id + "|TDS Payable 194C"]: "ch2" };

  // ---------------------------------------------------------------- 43B(h): MSME bills open beyond 45 days on 31-Mar-2026
  v = add({ type: "Purchase", date: "20260110", party: "Micro Parts Co", ref: "MP-1", ent: [{ l: "Purchase", a: -47250.75 }, { l: "Micro Parts Co", a: 47250.75, b: [["MP-1", "New Ref", 47250.75]] }] }); exp("msme43Bh", v, 47250.75);
  add({ type: "Purchase", date: "20260302", party: "Micro Parts Co", ref: "MP-2", ent: [{ l: "Purchase", a: -11800.00 }, { l: "Micro Parts Co", a: 11800.00, b: [["MP-2", "New Ref", 11800.00]] }] });   // 29 days
  v = add({ type: "Purchase", date: "20260202", party: "Small Gears", ref: "SG-7", ent: [{ l: "Purchase", a: -13600.60 }, { l: "Small Gears", a: 13600.60, b: [["SG-7", "New Ref", 13600.60]] }] }); exp("msme43Bh", v, 13600.60);
  add({ type: "Purchase", date: "20251103", party: "Medium Castings", ref: "MC-1", ent: [{ l: "Purchase", a: -22222.22 }, { l: "Medium Castings", a: 22222.22, b: [["MC-1", "New Ref", 22222.22]] }] });  // medium: outside 43B(h)

  // ---------------------------------------------------------------- 26AS: the client's own TDS credit
  add({ type: "Receipt", date: "20251204", party: "Alpha Traders", ent: [{ l: "HDFC Bank", a: -98245 }, { l: "TDS Receivable 194C", a: -2005 }, { l: "Alpha Traders", a: 100250 }] });
  v = add({ type: "Receipt", date: "20251211", party: "Beta Stores", ent: [{ l: "HDFC Bank", a: -73499.25 }, { l: "TDS Receivable 194C", a: -1500.50 }, { l: "Beta Stores", a: 74999.75 }] });
  E.tds26as = [{ vid: v.id, amount: 1500.50 }, { vid: "", amount: 3333.30 }];
  const as26 = [{ id: "as1", kind: "26AS", pan: "AAGCL4827M", fy: "2025-26", file: "26AS.txt", rows: [
    { tan: "DELA12345B", name: "ALPHA TRADERS", date: "20251204", section: "194C", amount: 100250, tax: 2005, deposited: 2005, status: "F", fy: "2025-26", q: "Q3" },
    { tan: "MUMO54321C", name: "OMEGA LIMITED", date: "20260115", section: "194J", amount: 33333, tax: 3333.30, deposited: 3333.30, status: "F", fy: "2025-26", q: "Q4" }] }];

  // ---------------------------------------------------------------- duplicates
  v = two("Payment", "20251014", "Epsilon Mart", "HDFC Bank", 7777.70, { party: "Epsilon Mart" });
  v = two("Payment", "20251014", "Epsilon Mart", "HDFC Bank", 7777.70, { party: "Epsilon Mart" }); exp("duplicates", v, 7777.70);
  two("Purchase", "20251015", "Purchase", "Delta Supplies", 12345.60, { party: "Delta Supplies", ref: "DS/101" });
  v = two("Purchase", "20251117", "Purchase", "Delta Supplies", 12399.90, { party: "Delta Supplies", ref: "DS-101" }); exp("duplicates", v, 12399.90);

  // ---------------------------------------------------------------- round sums
  v = two("Payment", "20251020", "Delta Supplies", "HDFC Bank", 50000.00, { party: "Delta Supplies" }); exp("round", v, 50000);
  v = two("Receipt", "20251021", "HDFC Bank", "Gamma Retail", 70000.00, { party: "Gamma Retail" }); exp("round", v, 70000);
  two("Payment", "20251022", "Delta Supplies", "HDFC Bank", 40000.00, { party: "Delta Supplies" });              // under 50,000
  two("Payment", "20251023", "Delta Supplies", "HDFC Bank", 55000.50, { party: "Delta Supplies" });              // not round

  // ---------------------------------------------------------------- weekend and holidays
  v = two("Sales", "20250615", "Gamma Retail", "Sales", 4321.09, { party: "Gamma Retail" }); exp("weekend", v, 4321.09);   // a Sunday
  v = two("Sales", "20250815", "Gamma Retail", "Sales", 5432.10, { party: "Gamma Retail" }); exp("weekend", v, 5432.10);   // Independence Day

  // ---------------------------------------------------------------- after the books were closed, or backdated
  v = two("Sales", "20260325", "Alpha Traders", "Sales", 8765.43, { party: "Alpha Traders", upd: "20260410" }); exp("backdated", v, 8765.43);   // altered after 31-Mar
  v = two("Sales", "20250616", "Beta Stores", "Sales", 6543.21, { party: "Beta Stores", upd: "20250801" }); exp("backdated", v, 6543.21);      // 46 days late
  v = two("Sales", "20250805", "Gamma Retail", "Sales", 3210.98, { party: "Gamma Retail", upd: "", alt: 0 }); v.alt = V.find((x) => x.date >= "20251201").alt + 0.5; exp("backdated", v, 3210.98);   // AlterID of December

  // ---------------------------------------------------------------- unusual ledgers
  v = two("Payment", "20251110", "Donation", "HDFC Bank", 25000.35); E.ledgers = [{ vid: v.id, party: "Donation", amount: 25000.35 }];
  two("Journal", "20251111", "Delta Supplies", "Telephone Expenses", 5000.50); E.ledgers.push({ vid: "", party: "Telephone Expenses", amount: 5000.50 });
  two("Payment", "20251112", "Zeta Vendor", "HDFC Bank", 12345.67, { party: "Zeta Vendor" }); E.ledgers.push({ vid: "", party: "Zeta Vendor", amount: 12345.67 });

  // ---------------------------------------------------------------- GST: input tax against 2B, turnover against GSTR-1 / 3B
  // February 2026, registration 07: two bills of Delta Supplies with input tax, 2B has only the first
  add({ type: "Purchase", date: "20260210", party: "Delta Supplies", ref: "DS/201", ent: [{ l: "Purchase", a: -20000 }, { l: "07 CGST INPUT", a: -1800 }, { l: "07 SGST INPUT", a: -1800 }, { l: "Delta Supplies", a: 23600 }] });
  v = add({ type: "Purchase", date: "20260211", party: "Delta Supplies", ref: "DS/202", ent: [{ l: "Purchase", a: -15000.55 }, { l: "07 CGST INPUT", a: -1350.05 }, { l: "07 SGST INPUT", a: -1350.05 }, { l: "Delta Supplies", a: 17700.65 }] });
  E.itc2b = [{ vid: v.id, amount: 2700.10 }];
  const twoB = { data: { gstin: GSTIN, rtnprd: "022026", gendt: "14-03-2026", docdata: { b2b: [{ ctin: "07AAACD1234D1Z5", trdnm: "DELTA SUPPLIES", supfildt: "11-03-2026", supprd: "022026",
    inv: [{ inum: "DS/201", dt: "10-02-2026", val: 23600, txval: 20000, igst: 0, cgst: 1800, sgst: 1800, cess: 0, pos: "07", rev: "N", itcavl: "Y", typ: "R" }] }] } } };
  // two taxable sales to Kappa Industries (registered); GSTR-1 as filed carries only the first, 3B as filed 3.1(a) is short by the second
  const s1 = add({ type: "Sales", date: "20260212", party: "Kappa Industries", gstin: "07AAACK7777K1Z9", cmp: GSTIN, no: "K-1", ent: [{ l: "Kappa Industries", a: -11800 }, { l: "Sales", a: 10000 }, { l: "07 CGST OUTPUT", a: 900 }, { l: "07 SGST OUTPUT", a: 900 }] });
  add({ type: "Sales", date: "20260213", party: "Kappa Industries", gstin: "07AAACK7777K1Z9", cmp: GSTIN, no: "K-2", ent: [{ l: "Kappa Industries", a: -5900.30 }, { l: "Sales", a: 5000.25 }, { l: "07 CGST OUTPUT", a: 450.03 }, { l: "07 SGST OUTPUT", a: 450.02 }] });
  E.turnover = [{ type: "GSTR-1 B2B", amount: 5000.25 }, { type: "GSTR-3B 3.1(a)", amount: 5000.25 }];
  const r1b2b = [{ ctin: "07AAACK7777K1Z9", inv: [{ inum: "K-1", idt: "12-02-2026", val: 11800, pos: "07", rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: { rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 } }] }] }];

  V.sort((a, c) => a.date.localeCompare(c.date) || a.alt - c.alt);
  const under = { "Cash": "Cash-in-Hand", "HDFC Bank": "Bank Accounts", "Sales": "Sales Accounts", "Purchase": "Purchase Accounts", "Freight": "Direct Expenses",
    "Professional Fees": "Indirect Expenses", "Contract Charges": "Indirect Expenses", "Donation": "Indirect Expenses", "Telephone Expenses": "Indirect Expenses",
    "Ramesh Gupta Loan": "Unsecured Loans", "TDS Payable 194C": "Duties & Taxes", "07 CGST INPUT": "Duties & Taxes", "07 SGST INPUT": "Duties & Taxes", "07 CGST OUTPUT": "Duties & Taxes", "07 SGST OUTPUT": "Duties & Taxes", "TDS Receivable 194C": "Loans & Advances (Asset)", "Capital": "Capital Account" };
  CUST.concat(["Kappa Industries"]).forEach((c) => { under[c] = "Sundry Debtors"; });
  SUP.concat(["Sharma Roadways", "Kapoor Associates", "Mehta Contractors Pvt Ltd", "Nanda Builders Pvt Ltd", "Micro Parts Co", "Small Gears", "Medium Castings", "Zeta Vendor"]).forEach((s) => { under[s] = "Sundry Creditors"; });
  const groups = { "Cash-in-Hand": "Current Assets", "Bank Accounts": "Current Assets", "Sundry Debtors": "Current Assets", "Loans & Advances (Asset)": "Current Assets",
    "Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "Unsecured Loans": "Loans (Liability)", "Current Assets": "", "Current Liabilities": "", "Loans (Liability)": "",
    "Sales Accounts": "", "Purchase Accounts": "", "Direct Expenses": "", "Indirect Expenses": "", "Capital Account": "" };
  const ledInfo = {};
  Object.keys(under).forEach((l) => { ledInfo[l] = { ob: 0, from: FROM }; });
  ledInfo["Cash"].ob = -1000000; ledInfo["HDFC Bank"].ob = -5000000; ledInfo["Capital"].ob = 6000000;
  const pans = { "Kapoor Associates": "AAAPK1234K", "Mehta Contractors Pvt Ltd": "AAACM1234C", "Nanda Builders Pvt Ltd": "AAACN1234B", "Sharma Roadways": "AAAFS1234R" };
  const books = { cid: "cfix", vouchers: V, meta: { from: FROM, to: TO, gstins: [GSTIN] }, under, groups, ledInfo, pans, gstins: { "Delta Supplies": "07AAACD1234D1Z5", "Kappa Industries": "07AAACK7777K1Z9" }, challans, alloc, msme: { "Micro Parts Co": "Micro", "Small Gears": "Small", "Medium Castings": "Medium" },
    tds26as: as26, tanParty: {}, twoBs: {}, filed: {}, filed3b: {} };
  return { books, expected: E, company: { id: "cfix", name: "Larkspur Audit Fixture Private Limited", pan: "AAGCL4827M", gstin: GSTIN, tan: "DELL99999E" }, from: FROM, to: TO, twoB, r1b2b, gstin: GSTIN };
}
// the parts that need FinCom's own code (x: the loaded globals, with S.books set to these books): the 2B read the way
// the app reads it, and GSTR-1 / 3B "as filed" for February 2026: FinCom's working with the seeded differences
function finish(f, x) {
  const b = f.books;
  b.map = x.Books.mapLedgers(b.vouchers, {});
  const t = x.GST2B.fromJson(f.twoB);
  b.twoBs = { [t.gstin + "|" + t.ym]: t };
  const W = x.GSTCMP.r1Work("202602", "07");
  const z = (o) => ({ txval: o.taxable, iamt: o.igst, camt: o.cgst, samt: o.sgst, csamt: o.cess, rt: 0, pos: "07", sply_ty: "INTRA", typ: "OE" });
  b.filed = { [f.gstin + "|022026"]: { source: "portal", via: "api", fetchedAt: "2026-03-12T10:00:00Z", json: { gstin: f.gstin, fp: "022026", b2b: f.r1b2b, b2cs: W.b2cs.taxable ? [z(W.b2cs)] : [] } } };
  const j3 = JSON.parse(JSON.stringify(x.GSTR.threeBJson("202602", "07")));
  j3.sup_details.osup_det.txval = Math.round((Number(j3.sup_details.osup_det.txval) - 5000.25) * 100) / 100;
  b.filed3b = { [f.gstin + "|202602"]: { gstin: f.gstin, ym: "202602", json: j3, fetchedAt: "2026-03-21T10:00:00Z" } };
  return f;
}
module.exports = { makeBooks, finish, FROM, TO };
