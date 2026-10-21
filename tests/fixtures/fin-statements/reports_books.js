// The made-up books of the reports pack's tests (ROUND 100; tests/run_reports_pack.js, tests/run_reports_pack_ui.py): the
// company of run_fin_statements.js (company.json) with a few ledgers added (names invented): a loan from a director, a
// loan given, a director's remuneration, last year's statutory dues deposited in April and this year's March dues
// credited at the year end, and a TDS payable of June 2025 never deposited (more than six months old on 31 March 2026).
// node reports_books.js  -> the books as JSON (for the screen test)
const fs = require("fs"), path = require("path");
const FIX = __dirname;
const F = JSON.parse(fs.readFileSync(path.join(FIX, "company.json"), "utf8"));
// the made-up additions (names invented): a director's loan, a loan given, a director's remuneration, a TDS payable
Object.assign(F.groups, {"Loan from Director Asha Rao": "Unsecured Loans", "Loan to Fernhill Traders": "Loans & Advances (Asset)", "Director Remuneration - Vikram Sen": "Indirect Expenses", "TDS Payable 194C": "Duties & Taxes", "Northbank Overdraft": "Bank OD A/c"});
F.c["Loan from Director Asha Rao"] = -500000; F.c["Loan to Fernhill Traders"] = 300000;
F.plc["Director Remuneration - Vikram Sen"] = 1200000;

function books(from, years){
  const under = Object.assign({}, F.groups), led = {};
  Object.entries(F.o).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
  const vouchers = [], bank = Object.keys(under).find(n => under[n] === "Bank Accounts"), shift = e => String(Number(e.slice(0, 4)) - 1) + e.slice(4);
  (F.additions || []).forEach(([l, d, a], i) => vouchers.push({id: "a" + i, date: d, type: "Journal", narr: "Purchase of " + l, ent: [{l, a: -a}, {l: bank, a}]}));
  years.forEach(([end, bs, pl, prev]) => {
    const ent = [];
    Object.keys(bs).forEach(n => { if (n === bank) return; const added = (F.additions || []).filter(([l, d]) => l === n && d <= end && d > shift(end)).reduce((s, z) => s + z[2], 0);
      const mv = Math.round(((bs[n] || 0) - (prev[n] || 0) - added) * 100) / 100; if (mv) ent.push({l: n, a: -mv}); });
    Object.entries(pl).forEach(([n, v]) => { if (v) ent.push({l: n, a: -v}); });
    ent.push({l: bank, a: Math.round(-ent.reduce((s, e) => s + e.a, 0) * 100) / 100});
    vouchers.push({id: "m" + end, date: end, type: "Journal", narr: "Movements for the year (fixture)", ent});
  });
  // the statutory dues of last year deposited in April, this year's March dues credited at the year end (net nil: the
  // balances stay those of the fixture), so that the day book reads like real books for the ageing
  Object.entries(F.p).filter(([n]) => F.groups[n] === "Duties & Taxes" && /PAYABLE|OUTPUT/i.test(n) || /^PF Payable$/.test(n)).forEach(([n, v], i) => {
    if (v < 0) { vouchers.push({id: "sp" + i, date: "20250407", type: "Payment", narr: "Deposited", ent: [{l: n, a: v}, {l: bank, a: -v}]}); vouchers.push({id: "sc" + i, date: "20260331", type: "Journal", narr: "March dues", ent: [{l: n, a: -v}, {l: bank, a: v}]}); }
  });
  // a bank overdraft drawn ₹15,00,000 mid-year and brought down to ₹5,00,000 by the year end (the peak is in September)
  vouchers.push({id: "od1", date: "20250915", type: "Receipt", narr: "Overdraft drawn", ent: [{l: bank, a: -1500000}, {l: "Northbank Overdraft", a: 1500000}]});
  vouchers.push({id: "od2", date: "20251231", type: "Payment", narr: "Overdraft repaid", ent: [{l: "Northbank Overdraft", a: -1000000}, {l: bank, a: 1000000}]});
  // TDS on a contractor's bill of June 2025, never deposited: payable by 7 July 2025, so more than six months old at 31 March 2026
  vouchers.push({id: "t1", date: "20250630", type: "Journal", narr: "TDS on contract", ent: [{l: "Juniper Travels", a: -5000}, {l: "TDS Payable 194C", a: 5000}]});
  return {under, groups: {}, ledInfo: {}, vouchers, meta: {from}, tb: {from, to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led}, msme: {"Bluebell Print Works": "Micro"}, fs: {}};
}

const company = () => books("20240401", [["20250331", F.p, F.plp, F.o], ["20260331", F.c, F.plc, F.p]]);
module.exports = {company, F};
if (require.main === module) process.stdout.write(JSON.stringify(company()));
