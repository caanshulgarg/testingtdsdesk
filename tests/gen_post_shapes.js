// node tests/gen_post_shapes.js  -  the XML FinCom actually sends to FinCom Bridge for posting, written by the app's own
// builders (loaded from src/js, in ORDER.json's order, by name, as tests/harness.js loads them) into
// tests/fixtures/post-shapes/*.xml, with MANIFEST.json holding the SHA-256 of the builders' source text. FinCom Bridge's
// TestRealPostingShapesPass sends each file through the real posting path; TestPostShapesCurrent fails with
// "regenerate post-shapes" when the builders' source changed since these files were written.
// The app builds no GROUP master and no Alter of an existing ledger: those two shapes are not here (the bridge's own
// test TestPostingRuleAndPinAgree covers them).
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const SRC = path.join(__dirname, "..", "src", "js"), OUT = path.join(__dirname, "fixtures", "post-shapes");
const ORDER = JSON.parse(fs.readFileSync(path.join(SRC, "ORDER.json"), "utf8"));
const js = ORDER.map(f => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
// the builders and what they call; every other name is a stub below
const NAMES = ["xesc", "r2", "num", "amt", "toTallyDate", "fmtDate", "toDateObj", "MONTHS", "MONTHS3", "voucherXml", "vchNoFor", "remoteIdFor", "remoteIdTrial",
  "bankVoucherXml", "ledgerMasterXml", "salesVoucherXml", "customerMasterXml", "GST_STATES", "stateOfGstin", "fpHash", "setAutoNumbering"];
const re = /\n(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/g;
const decl = []; let m;
while ((m = re.exec(js))) decl.push({name: m[1], at: m.index});
const text = n => { const k = decl.findIndex(d => d.name === n); if (k < 0) throw new Error("not found: " + n); return js.slice(decl[k].at, k + 1 < decl.length ? decl[k + 1].at : js.length); };
const parts = NAMES.map(text);
// the VOUCHERTYPE numbering change: the arrow inside setAutoNumbering, taken from its source
const vtSrc = (text("setAutoNumbering").match(/const xml = (t => [^\n]*;)\n/) || [])[1];
if (!vtSrc) throw new Error("the VOUCHERTYPE builder in setAutoNumbering was not found");
const ctx = {console, Math, JSON, Date, Number, String, RegExp, Object, Array, Set, Map, isFinite, parseFloat,
  S: {bank: null, sales: {cfg: {voucherType: "Sales"}}},
  tallyLedgerName: n => n, narrationFor: e => e.narr, exactLedger: n => n, knownLedgers: () => new Map(), bankLedgers: () => ({tds: "TDS Payable"}),
  B: () => ({salesRef: []}), SL: () => ({cfg: {voucherType: "Sales"}}),
  // the invoice's lines (salesLines works them out from the invoice and the company's ledgers): given here as they come out
  salesLines: v => v.lines};
vm.createContext(ctx);
vm.runInContext(parts.filter((p, i) => NAMES[i] !== "setAutoNumbering").join("\n") + "\n;globalThis.__x = {" + NAMES.filter(n => n !== "setAutoNumbering").join(",") + "};\nglobalThis.__vt = " + vtSrc.replace(/;$/, "") + ";", ctx);
const x = ctx.__x;
const co = {name: "ZZ TEST", voucherType: "Purchase", billwise: true, createOptional: false, gstin: "27AAACZ1234Z1Z5"};
const bill = (id, no, party, lines, kind) => ({id, noteKind: kind, narr: "Bill " + no + " from " + party, x: {invoiceDate: "2026-07-01", invoiceNo: no, vendorName: party},
  partyLedger: party, snapshot: {lines}});
const shapes = {
  "purchase-bill": x.voucherXml(bill("pb1", "FA/ELEC/013", "Fingate", [{ledger: "Electricity Charges", side: "Dr", amt: 1000}, {ledger: "Fingate", side: "Cr", amt: 1000, role: "party"}]), co),
  "journal": x.voucherXml(bill("jn1", "J-7", "Rent Party", [{ledger: "Rent", side: "Dr", amt: 5000}, {ledger: "TDS on Rent", side: "Cr", amt: 500}, {ledger: "Rent Party", side: "Cr", amt: 4500, role: "party"}]), Object.assign({}, co, {voucherType: "Journal"})),
  "debit-note": x.voucherXml(bill("dn1", "CN-3", "Fingate", [{ledger: "Fingate", side: "Dr", amt: 100, role: "party"}, {ledger: "Electricity Charges", side: "Cr", amt: 100}], "credit"), co),
  "sales-invoice": x.salesVoucherXml({id: "s1", customerLedger: "Acme Traders", source: "created", x: {date: "2026-07-02", number: "INV-21", customerName: "Acme Traders", customerGstin: "27AABCA1234A1Z5", total: 1180,
    noteKind: ""}, lines: [{side: "Dr", ledger: "Acme Traders", amt: 1180, role: "party"}, {side: "Cr", ledger: "Sales 18%", amt: 1000, role: "sales"},
    {side: "Cr", ledger: "Output CGST 9%", amt: 90, role: "tax"}, {side: "Cr", ledger: "Output SGST 9%", amt: 90, role: "tax"}]}, co),
  "bank-batch": [{debit: 2500, mode: "NEFT"}, {credit: 4000, mode: "UPI"}, {debit: 1200, chq: "000123", tdsAtPay: 120}].map((r, i) => x.bankVoucherXml({id: "b" + i, fp: "fp" + i, date: "2026-07-03",
    debit: r.debit, credit: r.credit, tdsAtPay: r.tdsAtPay, dec: {utr: "UTR00" + i, mode: r.mode, chq: r.chq}, ref: "", narr: "Bank line " + i, ledger: "Fingate", billRef: i === 0 ? "FA/ELEC/013" : ""},
    {ledger: "HDFC Bank"}, co)).join(""),
  "new-ledger": x.ledgerMasterXml({name: "Fingate Services", group: "Sundry Creditors", pan: "AAACF1234F", gstin: "27AAACF1234F1Z5"}),
  "new-customer": x.customerMasterXml({name: "Acme Traders", gstin: "27AABCA1234A1Z5", address: "1 Road\nPune"}),
  "voucher-type-numbering": ["Purchase", "Journal", "Payment"].map(ctx.__vt).join(""),
};
fs.mkdirSync(OUT, {recursive: true});
for (const [k, v] of Object.entries(shapes)) fs.writeFileSync(path.join(OUT, k + ".xml"), v);
const hash = crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
fs.writeFileSync(path.join(OUT, "MANIFEST.json"), JSON.stringify({builders: NAMES, sha256: hash, files: Object.keys(shapes).map(k => k + ".xml")}, null, 2) + "\n");
console.log("wrote " + Object.keys(shapes).length + " shapes; builders' sha256 " + hash);
