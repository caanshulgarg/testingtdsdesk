// node run_ledger_names_receivables.js - review of 02-Oct-2026: Testing AAD's trade receivables were 11,550 short
// (1,11,85,854.38 against 1,11,97,404.38) on Reports, MIS and the balance sheet. A copy of the books kept from before the
// names were cleaned named two debtors with encoded line breaks in their balances ("MCS Project Pvt Ltd&#13;&#10;",
// 6,000 Cr, and "RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;", 17,550 Dr), with no group: the first went to
// other current liabilities, the second to other current assets. The group is now looked up by the clean name
// (ledGroupPath, src/js/00) and the names kept with the books are cleaned once (TallyRead.cleanNames, src/js/18).
// Runs the built app's own code (site-test/index.html) on made-up books; no client data.
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "INR", "esc", "ledNm", "ledEnt", "ledClean", "ledKey", "LED_IDX", "ledIdx", "ledUnder", "ledGroupPath", "LedMaster",
  "Audit", "Parties", "MIS", "FS", "TallyRead", "Books"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const raw = /&#\d+;|&amp;|\r|\n/;
ctx.memoScope = f => f();
ctx.fmtDate = d => String(d || ""); ctx.tallyDate = d => String(d || "");
ctx.saveBooks = () => {};
ctx.LK = {cache: {}};
ctx.S.coId = "t"; ctx.S.companies = {t: {id: "t", name: "Test", pan: "AANFG3202D"}};
const groups = {"Current Assets": "", "Sundry Debtors": "Current Assets", "Master Cad": "Sundry Debtors", "Rakesh Kumar": "Sundry Debtors", "Bank Accounts": "Current Assets",
  "Sales Accounts": "", "Current Liabilities": "", "Sundry Creditors": "Current Liabilities"};
const books = () => ({cid: "t", meta: {from: "20250401", to: "20260331", bills: 1}, map: {}, groups: Object.assign({}, groups),
  under: {"MCS Project Pvt Ltd": "Master Cad", "RAKVIK TECHNOLOGIES PRIVATE LIMITED": "Rakesh Kumar", "Good Debtor Ltd": "Sundry Debtors", "ICICI Bank": "Bank Accounts", "Sales": "Sales Accounts"},
  tb: {from: "20250401", to: "20260331", at: "2026-10-01T00:00:00Z", led: {
    // as kept by a browser that read the ledgers before migration-23: the master's twin with the line breaks
    "MCS Project Pvt Ltd&#13;&#10;": {open: 6000, close: 0, parent: ""},
    "MCS Project Pvt Ltd": {open: 0, close: 0, parent: "Master Cad"},
    "RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;": {open: -17550, close: 0, parent: ""},
    "Good Debtor Ltd": {open: -100000, close: 0, parent: "Sundry Debtors"},
    "ICICI Bank": {open: -50000, close: 0, parent: "Bank Accounts"}}},
  vouchers: [{id: "v1", date: "20250510", type: "Sales", no: "S/1", party: "Good Debtor Ltd", ent: [{l: "Good Debtor Ltd", a: -11800, b: [["S/1", "New Ref", -11800]]}, {l: "Sales", a: 11800}]},
    {id: "v2", date: "20250610", type: "Receipt", no: "R/1", party: "Good Debtor Ltd\r\n", ent: [{l: "ICICI Bank", a: -5000}, {l: "Good Debtor Ltd\r\n", a: 5000, b: [["", "On Account", 5000]]}]}]});

// 1. the lookup: a name with encoded line breaks finds its group, with no change to the books
ctx.S.books = books();
ok(x.Audit.isDebtor("RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;") && x.Audit.isDebtor("MCS Project Pvt Ltd&#13;&#10;"), "1. both names with &#13;&#10; are under Sundry Debtors (ledGroupPath)");
ok(x.Books.groupPath("RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;").join(" > ") === "Rakesh Kumar > Sundry Debtors > Current Assets", "1. the same path for every report (Books.groupPath = Audit.path)");
ok(x.ledKey("A  B&#13;&#10;") === x.ledKey("a b") && x.ledClean("X &amp; Y&#13;&#10;") === "X & Y" && x.ledClean("Arktos  Control & Instruments") === "Arktos  Control & Instruments",
  "1. ledKey matches through entities, line breaks and spaces; ledClean keeps Tally's own double spaces");
ok(x.FS.place("RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;", -17550, "nc") === "tr" && x.FS.place("MCS Project Pvt Ltd&#13;&#10;", 6000, "nc") === "ocl", "1. on the balance sheet: 17,550 Dr in trade receivables, 6,000 Cr an advance from a customer");

const P0 = x.Parties.position("20260331");
ok(P0.ok && P0.rows.r.some(r => /^RAKVIK/.test(r.l) && r.dr === 17550), "1. even before the books are cleaned, RAKVIK's 17,550 Dr counts as owed to you (Parties.position)");

// 2. the books cleaned once: one ledger per clean name, balances added, no raw name kept anywhere
const n = x.TallyRead.cleanNames(ctx.S.books), b = ctx.S.books;
ok(n > 0 && !Object.keys(b.tb.led).some(k => raw.test(k)) && !b.vouchers.some(v => raw.test(v.party) || v.ent.some(e => raw.test(e.l))), "2. cleanNames: no &#13;&#10; or line break left in the balances or the entries (" + n + " names)");
ok(b.tb.led["MCS Project Pvt Ltd"].open === 6000 && b.tb.led["MCS Project Pvt Ltd"].parent === "Master Cad" && b.tb.led["RAKVIK TECHNOLOGIES PRIVATE LIMITED"].open === -17550, "2. the twin's 6,000 Cr is added to MCS Project Pvt Ltd, which keeps its group");
ok(x.TallyRead.cleanNames(b) === 0, "2. a second cleaning changes nothing");

// 3. trade receivables: the debtor counts, and is shown clean
const P = x.Parties.position("20260331");
// Good Debtor: 1,00,000 + 11,800 - 5,000 = 1,06,800 Dr; RAKVIK 17,550 Dr; MCS 6,000 Cr (an advance)
ok(P.ok && P.owed === 124350 && P.custAdv === 6000, "3. owed to you 1,24,350 (1,06,800 + 17,550) and 6,000 advance from MCS Project (" + [P.owed, P.custAdv] + ")");
const A = x.MIS.ageing("20260331", "r", P.at);
ok(A.sum.owe === 124350 && !A.rows.some(p => raw.test(p.party)), "3. MIS's receivables: the same 1,24,350, no name shown with &#13;&#10;");
ok(A.rows.some(p => p.party === "RAKVIK TECHNOLOGIES PRIVATE LIMITED" && p.und === 17550), "3. RAKVIK's 17,550 (an opening balance, no bill here) is owed, not bill-wise");
const d = x.FS.build("2025");
ok(!d.error && d.put.tr === 124350 && !(d.det.oca || []).some(r => /RAKVIK/.test(r[0])) && (d.det.ocl || []).some(r => r[0] === "MCS Project Pvt Ltd"), "3. balance sheet: trade receivables 1,24,350; RAKVIK not in other current assets (" + (d.error || d.put.tr) + ")");
const html = x.FS.html(d);
ok(!/&#13;|&amp;#13;|&#10;/.test(html) && html.includes("RAKVIK TECHNOLOGIES PRIVATE LIMITED"), "3. the statements never show &#13;&#10;");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
