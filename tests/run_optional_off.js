// node tests/run_optional_off.js - owner, 23-Nov-2026: "optional entries to be defaulted off in every client". The
// app's own code (src/js, loaded by name as tests/harness.js does), made-up clients only:
//   1. a new client starts with Optional vouchers off (newCompany; the client copied from another; the first version's adopt)
//   2. a client with no stored value posts regular vouchers: purchase bill, journal, debit note and sales invoice all
//      say <ISOPTIONAL>No</ISOPTIONAL>; switched on deliberately, Yes (the same two values as before, nothing else)
//   3. ticking it in Client setup (coCommit) stamps when (createOptionalAt), so a deliberate choice is told apart from
//      an old copy that still holds the old default (src/js/27 clientOptKeep, tests/run_client_merge.js)
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const SRC = path.join(__dirname, "..", "src", "js");
const ORDER = JSON.parse(fs.readFileSync(path.join(SRC, "ORDER.json"), "utf8"));
const shared = ["server/_shared/names.js", "server/_shared/gst3b.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/^export .*$/m, ""));
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oo-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + shared.concat(ORDER.map(f => fs.readFileSync(path.join(SRC, f), "utf8"))).join("\n") + "\n</script>");
const {ctx, x} = load(html, ["uid", "GSTIN_RE", "GST_DEFAULTS", "TDS_LEDGER_DEFAULTS", "EXPENSE_DEFAULTS", "newCompany", "xesc", "r2", "num", "amt", "toTallyDate", "fmtDate",
  "MONTHS", "voucherXml", "vchNoFor", "remoteIdFor", "remoteIdTrial", "salesVoucherXml", "GST_STATES", "stateOfGstin", "fpHash", "vchTypeOf", "billVt", "salesVt", "salesAgainstOf", "coCommit", "bankOptSet", "optStamp"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
Object.assign(ctx, {tallyLedgerName: n => n, narrationFor: e => e.narr, exactLedger: n => n, knownLedgers: () => new Map(), B: () => ({salesRef: []}),
  SL: () => ({cfg: {voucherType: "Sales"}}), salesCmpGstin: (v, co) => co.gstin || "", salesOwnStates: () => ["27"], salesRegOf: () => ({code: "27", gstin: "27AAACZ1234Z1Z5"}),
  salesLines: v => v.lines});
ctx.S = {bank: null, sales: {cfg: {voucherType: "Sales"}}, companies: {}};

// 1. new clients
const c = x.newCompany({name: "ZZ New Client", gstin: "27AAACZ1234Z1Z5"});
ok(c.createOptional === false, "a new client starts with Optional vouchers off (" + c.createOptional + ")");
ok(x.newCompany({name: "ZZ Asked", createOptional: true}).createOptional === true, "on only when asked for on purpose");
const s27 = fs.readFileSync(path.join(SRC, "27-firm-account.js"), "utf8"), s01 = fs.readFileSync(path.join(SRC, "01-documents-in-the-firm-account.js"), "utf8");
const copy = (s27.match(/const co = newCompany\(Object\.assign\(src \? \{([^}]*)\}/) || [])[1];
ok(copy !== undefined && !/createOptional/.test(copy), "a client added as a copy of another starts off too (setup copied, Optional not)");
const adopt = (s01.match(/adoptLegacy\(settings, parties, entries\)\{[\s\S]*?\}\);/) || [""])[0];
ok(adopt && !/createOptional/.test(adopt), "the first version's settings, adopted: off too");

// 2. what goes to Tally
const stored = JSON.parse(JSON.stringify({name: "ZZ Old Client", voucherType: "Purchase", billwise: true, gstin: "27AAACZ1234Z1Z5"}));   // no createOptional stored
const bill = (id, no, party, lines, kind) => ({id, noteKind: kind, narr: "Bill " + no + " from " + party, x: {invoiceDate: "2026-07-01", invoiceNo: no, vendorName: party}, partyLedger: party, snapshot: {lines}});
const sale = {id: "s1", customerLedger: "Acme Traders", source: "created", x: {date: "2026-07-02", number: "INV-21", customerName: "Acme Traders", customerGstin: "27AABCA1234A1Z5", total: 1180, noteKind: ""},
  lines: [{side: "Dr", ledger: "Acme Traders", amt: 1180, role: "party"}, {side: "Cr", ledger: "Sales 18%", amt: 1000, role: "sales"}, {side: "Cr", ledger: "Output CGST 9%", amt: 90, role: "tax"}, {side: "Cr", ledger: "Output SGST 9%", amt: 90, role: "tax"}]};
const shapes = co => ({
  "purchase bill": x.voucherXml(bill("pb1", "FA/ELEC/013", "Fingate", [{ledger: "Electricity Charges", side: "Dr", amt: 1000}, {ledger: "Fingate", side: "Cr", amt: 1000, role: "party"}]), co),
  "journal": x.voucherXml(bill("jn1", "J-7", "Rent Party", [{ledger: "Rent", side: "Dr", amt: 5000}, {ledger: "Rent Party", side: "Cr", amt: 5000, role: "party"}]), Object.assign({}, co, {voucherType: "Journal"})),
  "debit note": x.voucherXml(bill("dn1", "CN-3", "Fingate", [{ledger: "Fingate", side: "Dr", amt: 100, role: "party"}, {ledger: "Electricity Charges", side: "Cr", amt: 100}], "credit"), co),
  "sales invoice": x.salesVoucherXml(sale, co)});
const tag = xml => (xml.match(/<ISOPTIONAL>[^<]*<\/ISOPTIONAL>/g) || []);
for (const [k, xml] of Object.entries(shapes(stored))) ok(tag(xml).length === 1 && tag(xml)[0] === "<ISOPTIONAL>No</ISOPTIONAL>", "no stored value: the " + k + " goes as a regular voucher " + tag(xml).join(""));
for (const [k, xml] of Object.entries(shapes(Object.assign({}, stored, x.newCompany({name: "ZZ"}), {voucherType: "Purchase"})))) ok(tag(xml)[0] === "<ISOPTIONAL>No</ISOPTIONAL>", "a new client: the " + k + " goes regular");
for (const [k, xml] of Object.entries(shapes(Object.assign({}, stored, {createOptional: true})))) ok(tag(xml).length === 1 && tag(xml)[0] === "<ISOPTIONAL>Yes</ISOPTIONAL>", "switched on deliberately: the " + k + " goes as Optional");

// 3. the tick in Client setup stamps when it was chosen
const co = x.newCompany({name: "ZZ Ticked"}); ctx.S.companies[co.id] = co;
Object.assign(ctx, {CO: () => co, Store: {saveCompany(){}}, refreshStats(){}, render(){}, setPath: (o, p, v) => { o[p] = v; }, toast(){}});
const before = new Date().toISOString();
x.coCommit("createOptional", true);
ok(co.createOptional === true && typeof co.createOptionalAt === "string" && co.createOptionalAt >= before, "ticked in Client setup: on, with the time it was chosen (" + co.createOptionalAt + ")");
x.coCommit("createOptional", false);
ok(co.createOptional === false && co.createOptionalAt >= before, "unticked: off, stamped too");
// a slow clock: the stamp is never older than the copy's own (+1 ms), so a tick always beats the copy it was made on
co.createOptionalAt = "2999-01-01T00:00:00.000Z"; x.coCommit("createOptional", true);
ok(co.createOptionalAt === "2999-01-01T00:00:00.001Z", "ticked on a copy stamped later than this clock: stamped 1 ms after it (" + co.createOptionalAt + ")");
co.bankOptionalAt = "2999-01-01T00:00:00.000Z"; x.bankOptSet("bankOptional", false);
ok(co.bankOptionalAt === "2999-01-01T00:00:00.001Z", "the bank tick the same (" + co.bankOptionalAt + ")");
co.bankOptionalAt = undefined;
// bank entries' own tick (Bank settings, bankOptSet): stamped the same way (bankOptionalAt)
const b0 = new Date().toISOString();
x.bankOptSet("bankOptional", true);
ok(co.bankOptional === true && typeof co.bankOptionalAt === "string" && co.bankOptionalAt >= b0, "bank entries ticked Optional: on, with when (" + co.bankOptionalAt + ")");
x.bankOptSet("bankAuto", false);
ok(co.bankAuto === false && !("bankAutoAt" in co), "another bank tick: no stamp");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
