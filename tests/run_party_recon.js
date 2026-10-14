// node run_party_recon.js - a vendor's and a customer's statement against the party's ledger in the books (PartyRecon,
// app/src/lib/registers.js): the statement read in two formats (debit and credit columns; one amount with Dr / Cr and a running
// balance), seen from both sides (their debit is our credit), the opening difference a line of its own, each kind of
// difference (matched by number; by amount and date within ±7 days and ±₹1; the same entry with another amount; ours only;
// theirs only; TDS deducted by us and not shown by them; TDS shown by them only; GST), and the statement adding up to
// the paisa: closing as per our books + each difference = closing as per the party, nothing unexplained.
const fs = require("fs"), path = require("path");
const {load, HTML} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const FX = path.join(__dirname, "fixtures", "sheets");
const h = load(HTML, ["num", "r2", "money", "INR", "fpHash", "GST_STATES", "stateOfGstin", "GSTIN_RE", "normName", "normInv", "Market", "GST2B", "GSTAmend", "VR", "isSheetFile"]);
// the engine is a file of its own, loaded by the app when first used: run here on the program's helpers
const vm = require("vm"); h.ctx.window = h.ctx; vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "src", "lib", "registers.js"), "utf8"), h.ctx);
const F = h.ctx.SheetFmt, P = h.ctx.PartyRecon;
const csv = (n) => F.csv(fs.readFileSync(path.join(FX, n), "utf8"));

// ---- the vendor's statement in its first format: debit and credit columns
const g1 = csv("vendor_stmt_a.csv"), hi1 = F.head(g1);
const st1 = P.statement({map: {date: "date", no: "vchno", narration: "particulars", debit: "debit", credit: "credit", gst: "gst"}, transforms: {date: "dmy"}}, g1, hi1);
ok(st1.open === 5000 && st1.rows.length === 8 && st1.close === 5000 + 11800 + 35400 + 2950.6 + 590 - 20000 - 1180 + 0 - 1000 + 4130,
  "format A: the opening line read (5,000 Dr), 8 entries, the closing worked out (" + st1.open + ", " + st1.rows.length + ", " + st1.close + ")");
// ---- the same statement in a second format: one amount, Dr / Cr, a running balance written "Cr"
const g2 = csv("vendor_stmt_b.csv"), hi2 = F.head(g2);
const st2 = P.statement({map: {date: "txndate", no: "refno", narration: "description", amount: "amount", drcr: "drcr", balance: "balance"}, transforms: {date: "dmy"}}, g2, hi2);
ok(JSON.stringify(st2.rows.map((x) => [x.no, x.dr, x.cr])) === JSON.stringify(st1.rows.map((x) => [x.no, x.dr, x.cr])) && st2.open === st1.open && st2.close === st1.close,
  "format B (one amount with Dr / Cr, balance column): the same entries, opening and closing (" + st2.open + ", " + st2.close + ")");

// ---- our books: the vendor's ledger (LK.ledgerBooks rows: our debit and credit), with the vouchers' TDS and GST lines
const ent = (tds, gst) => [{l: "TDS Payable - Professional", a: -tds}, {l: "Input CGST", a: gst / 2}, {l: "Input SGST", a: gst / 2}];
const ours = P.oursFrom({open: -4000, close: null, rows: [
  {id: "v1", date: "2026-07-05", no: "KIT/101", type: "Purchase", narr: "laptops", dr: 0, cr: 11800, ent: ent(0, 1800)},              // matched by number
  {id: "v2", date: "2026-07-07", no: "J/12", type: "Journal", narr: "Delhi Legal DL/77 retainer", dr: 0, cr: 32400, ent: ent(3000, 5400)},  // DL/77: their 35,400 = ours 32,400 + TDS 3,000
  {id: "v3", date: "2026-07-14", no: "J/13", type: "Journal", narr: "stationery", dr: 0, cr: 2950, ent: ent(0, 450)},                  // NEW/9 by amount and date: 2,950 vs 2,950.60, 2 days
  {id: "v4", date: "2026-07-20", no: "P/7", type: "Payment", narr: "NEFT", dr: 20000, cr: 0, ent: []},                                 // their payment line on 25-Jul: 5 days
  {id: "v5", date: "2026-07-30", no: "X/1", type: "Purchase", narr: "courier", dr: 0, cr: 700, ent: ent(0, 0)},                        // ours only
  {id: "v6", date: "2026-07-09", no: "KIT/CN/4", type: "Debit Note", narr: "returned mouse", dr: 1180, cr: 0, ent: ent(0, 180)},        // matched by number (a debit in ours)
  {id: "v7", date: "2026-07-26", no: "INV/88", type: "Purchase", narr: "repairs", dr: 0, cr: 4000, ent: ent(0, 600)},                  // INV/88: theirs 4,130 (another amount)
]}, "vendor");
ok(ours.open === 4000 && ours.rows.find((x) => x.no === "J/12").tds === 3000 && ours.rows.find((x) => x.no === "KIT/101").gst === 1800, "ours: the opening (4,000 owed), the voucher's TDS and GST read");
const r = P.run({side: "vendor", ours, theirs: st1});
const nos = (l, s) => l.map((x) => (x[s] || x).no).sort();
ok(r.matched.length === 5 && JSON.stringify(nos(r.matched, "t")) === JSON.stringify(["DL/77", "KIT/101", "KIT/CN/4", "NEFT-UTR77", "NEW/9"]),
  "matched: by number (KIT/101, the debit note, DL/77 net of our TDS) and by amount and date within ±7 days / ±₹1 (NEW/9, the payment) (" + nos(r.matched, "t") + ")");
ok(r.matched.find((x) => x.t.no === "NEW/9").how === "amount and date" && r.matched.find((x) => x.t.no === "NEW/9").diff === 0.6, "NEW/9: 2,950.60 against 2,950.00, two days apart: matched within the tolerance (0.60 said)");
ok(r.differs.length === 1 && r.differs[0].t.no === "INV/88" && r.differs[0].diff === 130 && r.differs[0].text === "a different amount", "the same entry with a different amount: INV/88, 130 more in theirs");
ok(r.oursOnly.length === 1 && r.oursOnly[0].no === "X/1", "in our books, not in theirs: X/1 (700)");
ok(r.theirsOnly.length === 1 && r.theirsOnly[0].no === "LF/3" && r.theirsOnly[0].amt === 590, "in their books, not in ours: LF/3 (late fee, 590)");
ok(r.tds.length === 2 && r.tds.find((x) => x.kind === "ours").amt === 3000 && r.tds.find((x) => x.kind === "theirs").amt === -1000,
  "TDS: deducted by us and not shown by them (3,000 on DL/77); shown by them and not in our books (1,000)");
ok(r.gst.length === 1 && r.gst[0].t.no === "KIT/101" && r.gst[0].amt === 18, "GST where the lines carry tax: KIT/101, 1,818 in theirs against 1,800 in ours");
const S = r.statement, line = (k) => (S.lines.find((l) => l[0] === k) || [0, 0, 0])[2];
ok(line("open") === 1000 && S.lines[0][1] === "Difference in opening balance", "the opening: 5,000 in theirs, 4,000 in ours: “Difference in opening balance” 1,000, a line of its own");
const oClose = 4000 + 11800 + 32400 + 2950 - 20000 + 700 - 1180 + 4000;
ok(S.ours === oClose && S.theirs === st1.close && S.unexplained === 0 && Math.round((S.ours + S.lines.reduce((s, l) => s + l[2], 0)) * 100) / 100 === S.theirs,
  "the statement adds up to the paisa: ours " + S.ours + " + " + S.lines.map((l) => l[1] + " " + l[2]).join(", ") + " = theirs " + S.theirs + "; unexplained " + S.unexplained);

// ---- a customer: their credit is our debit
const cust = csv("customer_stmt.csv"), hc = F.head(cust);
const sc = P.statement({map: {date: "date", no: "billno", narration: "narration", debit: "dr", credit: "cr", balance: "balance"}, transforms: {date: "dmy"}}, cust, hc);
const oc = P.oursFrom({open: 10000, close: null, rows: [
  {id: "s1", date: "2026-07-03", no: "S/101", type: "Sales", narr: "", dr: 17400, cr: 0, ent: []},
  {id: "s2", date: "2026-07-18", no: "R/5", type: "Receipt", narr: "NEFT", dr: 0, cr: 15000, ent: []},
  {id: "s3", date: "2026-07-28", no: "S/102", type: "Sales", narr: "", dr: 2360, cr: 0, ent: []}]}, "customer");
const rc = P.run({side: "customer", ours: oc, theirs: sc});
ok(sc.open === -10000 && rc.tOpen === 10000 && rc.oOpen === 10000 && !rc.statement.lines.some((l) => l[0] === "open"), "a customer: their opening 10,000 Cr is our 10,000 Dr: no opening difference");
ok(rc.matched.length === 2 && rc.oursOnly.length === 1 && rc.oursOnly[0].no === "S/102" && rc.statement.unexplained === 0 && rc.statement.ours === 14760 && rc.statement.theirs === 12400,
  "a customer: two matched, S/102 not yet in their books; 14,760 in ours, 12,400 in theirs, nothing unexplained (" + JSON.stringify(rc.statement) + ")");

console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
