// node run_parse_parta.mjs - bridge 2.3.1 part A (the owner's decisions of 06-Oct-2026, "item invoices enter complete"):
// the cloud's one reader (server/tally-cloud/parse.js, the Day Book days path and the recorder's entry body alike) reads
// the items (name, quantity, unit, rate, taxable value, HSN or SAC and GST rate as Tally applied them to the line, and the
// CGST / SGST / IGST / cess worked out per line), bill-wise due dates given as dates, cost centres (on ledger lines and on
// the ledger lines under items), bank details, TDS details, the e-invoice IRN and acknowledgement and the e-way bill
// number, and checks the owner's accuracy rules, each failure in plain words.
// Fixtures: bridge-go/testdata/typed-like-7.1/partA-*.xml (typed as the real TallyPrime 7.1 answers; NOT captured from a
// real Tally). Section 2 proves the entry request's fetch (bridge-go/recorder_live.go liveFetchField) carries every field
// the reader uses: each fixture cut down to the fetched fields reads exactly as the whole one.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay, d8 } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "typed-like-7.1");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;
const read = (f) => fs.readFileSync(path.join(TD, f), "utf8");
const el = (t) => t.slice(t.indexOf("<VOUCHER REMOTEID"), t.lastIndexOf("</VOUCHER>") + 10);
const G = (mid) => "226fb516-9d2d-45ad-ad78-304d86b64500-" + mid.toString(16).padStart(8, "0");
const one = (t) => parseDay(t).vouchers[0] || {};

// ---- 1. each scenario the owner named, read whole (the answer and the voucher element the bridge sends)
const CASES = [
  ["partA-sales-two-rates.xml", "sales with two items at different GST rates", (v) => [
    [J(v.items), J([
      {n: 0, item: "Widget A", qty: 10, unit: "Nos", rate: 200, taxable: 2000, alloc: 2000, hsn: "8471", gst: 18, cgst: 180, sgst: 180, igst: 0, cess: 0},
      {n: 1, item: "Rice B", qty: 20, unit: "Kg", rate: 50, taxable: 1000, alloc: 1000, hsn: "1006", gst: 5, cgst: 25, sgst: 25, igst: 0, cess: 0}])],
    [J([v.irn, v.ackNo, v.ackDate, v.eway]), J(["a5c12dca80e743321740b001fd70953e8738d109865d28ba4013750f2046f229", "112610020345678", "20261002", "381001234567"])],
    [J([v.gstin, v.pos, v.cmp, v.ref, v.refDate]), J(["07AAJFQ3158R1ZH", "Delhi", "07AAGCL4827M1Z3", "PO-88", "20260930"])],
    [J(v.costs), J([{n: 3, ledger: "Sales GST 18%", cat: "Primary Cost Category", centre: "Retail", amt: 2000}])]]],
  ["partA-purchase-igst.xml", "purchase with items (IGST)", (v) => [
    [J(v.items), J([{n: 0, item: "Widget A", qty: 5, unit: "Nos", rate: 1000, taxable: -5000, alloc: -5000, hsn: "8471", gst: 18, cgst: 0, sgst: 0, igst: -900, cess: 0}])],
    [J(v.dues), J([{n: 0, ledger: "Spike Supplier", name: "INV-77", type: "New Ref", amt: 5900, due: "20261115"}])],
    [J([v.ref, v.refDate]), J(["INV-77", "20261001"])]]],
  ["partA-credit-note-items.xml", "credit note with items", (v) => [
    [J(v.items), J([{n: 0, item: "Widget A", qty: 1, unit: "Nos", rate: 200, taxable: -200, alloc: -200, hsn: "8471", gst: 18, cgst: -18, sgst: -18, igst: 0, cess: 0}])]]],
  ["partA-receipt-against-bill.xml", "receipt against a bill", (v) => [
    [J(v.banks), J([{n: 1, ledger: "Spike Bank", type: "Cheque", no: "000451", date: "20261002", bdate: "20261003"}])], [J(v.items), "[]"]]],
  ["partA-payment-tds.xml", "payment with TDS", (v) => [
    [J(v.tds), J([{n: 1, ledger: "TDS on Contract", nature: "Payment to Contractors", party: "Spike Contractor", rate: 2, base: 100000, tax: 2000, section: "", sectionFrom: ""}])],
    [J(v.banks), J([{n: 2, ledger: "Spike Bank", type: "e-Fund Transfer", no: "UTR26100200991", date: "20261002", bdate: ""}])]]],
  ["partA-journal-cost-centres.xml", "journal with cost centres", (v) => [
    [J(v.costs), J([{n: 0, ledger: "Rent", cat: "Primary Cost Category", centre: "Head Office", amt: -20000}, {n: 0, ledger: "Rent", cat: "Primary Cost Category", centre: "Branch", amt: -10000}])]]],
  ["partA-bank-payment-utr.xml", "bank payment with UTR", (v) => [
    [J(v.banks), J([{n: 1, ledger: "Spike Bank", type: "e-Fund Transfer", no: "SBIN526275123456", date: "20261002", bdate: "20261002"}])]]],
];
for (const [file, what, want] of CASES) {
  const t = read(file);
  for (const [how, x] of [["the answer", t], ["the voucher element", el(t)]]) {
    const r = parseDay(x), v = r.vouchers[0] || {};
    ok(r.n === 1 && Math.round(r.lines.reduce((a, l) => a + l[2], 0) * 100) === 0, what + ", " + how + ": one entry, its lines add up to 0");
    ok(J(v.checks) === "[]", what + ", " + how + ": passes the accuracy checks (" + J(v.checks) + ")");
    for (const [got, exp] of want(v)) ok(got === exp, what + ", " + how + ": " + exp.slice(0, 90) + (got === exp ? "" : " -- got " + got));
  }
}

// ---- 2. the entry request's fetch carries everything the reader uses: each fixture cut down to the fetched fields (as a
// collection export answers: a field comes back only when fetched, a list only when one of its fields is) reads the same
const goSrc = fs.readFileSync(path.join(HERE, "..", "bridge-go", "recorder_live.go"), "utf8");
const strs = (code) => (code.replace(/\/\/[^\n]*/g, "").match(/"[^"]*"/g) || []).map((x) => x.slice(1, -1)).join("");
const block = goSrc.slice(goSrc.indexOf("\tliveFetchField222 = "), goSrc.indexOf("\n)", goSrc.indexOf("\tliveFetchField222 = ")));
const f222 = strs(block.slice(0, block.indexOf("\tliveFetchField = ")));
const FETCH = f222 + strs(block.slice(block.indexOf("\tliveFetchField = ") + "\tliveFetchField = liveFetchField222".length));
ok(FETCH.startsWith("GUID, MASTERID, ALTERID, DATE") && FETCH.includes("ALLINVENTORYENTRIES.STOCKITEMNAME") && FETCH.split(", ").length === 63, // 58, the bank allocation's DATE, NAME and UTR after the real 7.1 run, and the TDS list and its sub-list whole (the owner, 07-Oct-2026)
  "the fetch read from recorder_live.go: " + FETCH.split(", ").length + " fields");
function cut(voucher, fetch) {
  const want = new Set(fetch.split(", "));
  const tok = /<(\/?)([A-Za-z0-9.:_]+)([^>]*?)(\/?)>([^<]*)/g, root = {kids: []}, stack = [root];
  let m;
  while ((m = tok.exec(voucher))) {
    const top = stack[stack.length - 1];
    if (m[1] === "/") { if (stack.length > 1) stack.pop(); continue; }
    if (m[4] === "/") { top.kids.push({name: m[2], open: "<" + m[2] + m[3] + "/>", kids: [], self: true}); continue; }
    const n = {name: m[2], open: "<" + m[2] + m[3] + ">", text: m[5], kids: []};
    top.kids.push(n); stack.push(n);
  }
  const emit = (n, p0) => {
    const p = (p0 ? p0 + "." : "") + n.name.replace(/\.LIST$/, "");
    if (!n.kids.length && !/\.LIST$/.test(n.name)) return want.has(p) || (p0 && want.has(p0 + ".*")) ? (n.self ? n.open : n.open + n.text + "</" + n.name + ">") : "";
    const inner = n.kids.map((k) => emit(k, p)).join("");
    return inner ? n.open + inner + "</" + n.name + ">" : "";
  };
  const v = root.kids[0];
  return v.open + v.kids.map((k) => emit(k, "")).join("") + "</VOUCHER>";
}
const OLDFETCH = f222 + ", ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE";
for (const [file, what] of CASES) {
  const x = el(read(file)), whole = parseDay(x), part = parseDay(cut(x, FETCH));
  ok(J(part) === J(whole), what + ": the body as the 2.3.1 request fetches it reads exactly as the whole voucher" + (J(part) === J(whole) ? "" : ": " + J(part).slice(0, 300)));
  const old = parseDay(cut(x, OLDFETCH));
  ok(J(old) !== J(whole), what + ": the body as the request before part A fetched it lacked some of it");
}

// ---- 2b. the TDS section (the owner, 06-Oct-2026: "section ... deductee type"): Tally's own, from the entry's bill-wise
// detail (TDSDEDUCTEESECTIONNUMBER, a field TallyPrime 7.1 writes on every bill allocation); else the section written in
// the nature of payment's name; else blank (never guessed). The deductee type is the party ledger's (masters, part B)
{
  const T = read("partA-payment-tds.xml");
  const tdsLine = T.indexOf("<LEDGERNAME TYPE=\"String\">TDS on Contract</LEDGERNAME>");
  const at = T.indexOf("<BILLALLOCATIONS.LIST>      </BILLALLOCATIONS.LIST>", tdsLine);
  const withSec = T.slice(0, at) + "<BILLALLOCATIONS.LIST><NAME TYPE=\"String\">PAY-9</NAME><BILLTYPE TYPE=\"String\">New Ref</BILLTYPE>" +
    "<TDSDEDUCTEESECTIONNUMBER TYPE=\"String\">194C</TDSDEDUCTEESECTIONNUMBER><AMOUNT TYPE=\"Amount\">2000.00</AMOUNT></BILLALLOCATIONS.LIST>" +
    T.slice(at + "<BILLALLOCATIONS.LIST>      </BILLALLOCATIONS.LIST>".length);
  const a = one(withSec).tds[0] || {};
  ok(a.section === "194C" && a.sectionFrom === "Tally's entry" && J(one(withSec).checks) === "[]", "the section from the entry's bill-wise detail: " + J(a));
  const x = el(withSec);
  ok(J(parseDay(cut(x, FETCH)).vouchers[0].tds) === J(parseDay(x).vouchers[0].tds), "the request's fetch carries the section field (TDSDEDUCTEESECTIONNUMBER)");
  const b = one(T.replace("<CATEGORY TYPE=\"String\">Payment to Contractors</CATEGORY>", "<CATEGORY TYPE=\"String\">194C - Payment to Contractors</CATEGORY>")).tds[0] || {};
  ok(b.section === "194C" && b.sectionFrom === "the nature of payment's name", "the section written in the nature's name: " + J(b));
  const c = one(T).tds[0] || {};
  ok(c.section === "" && c.sectionFrom === "", "neither: blank, never guessed (" + J(c) + ")");
  const d = one(T.replace("<CATEGORY TYPE=\"String\">Payment to Contractors</CATEGORY>", "<CATEGORY TYPE=\"String\">Contract 1940 work</CATEGORY>")).tds[0] || {};
  ok(d.section === "", "a number inside a word is no section (" + J(d) + ")");
}

// ---- 2c. one invoice with 50 items (tests/tools/mk_sales50.py): read whole, every item, no check failing, the body as
// fetched the same
{
  const x = el(read("partA-sales-50-items.xml")), v = one(x);
  const tax = v.items.reduce((t, it) => t + it.cgst + it.sgst, 0);
  ok(v.items.length === 50 && J(v.checks) === "[]" && Math.abs(tax - 2 * 9676.75) <= 1 && v.items[49].hsn === "1050" && v.items[49].qty === 50,
    "50 items: all read, the items' tax " + tax.toFixed(2) + " against the GST lines 19353.50, no check failing (" + J(v.checks) + ")");
  ok(J(parseDay(cut(x, FETCH))) === J(parseDay(x)), "50 items: the body as the request fetches it (" + cut(x, FETCH).length + " characters) reads as the whole one");
}

// ---- 2d. round-3 L1 for the credit period (part C's finding): a long run of "<BILLCREDITPERIOD x" never closed inside a
// bill allocation is read in linear time (the attributes stop at the next "<"), and a real credit period still reads
{
  const S0 = read("partA-sales-two-rates.xml");
  const bad = S0.replace(/<BILLCREDITPERIOD JD[^\n]*<\/BILLCREDITPERIOD>/, "<BILLCREDITPERIOD x=1 ".repeat(40000));
  const t0 = Date.now(); parseDay(bad); const ms = Date.now() - t0;
  ok(ms < 1500, "a long attribute-like run in a bill allocation read in " + ms + " ms");
  ok(one(S0).dues.length === 0 && J(parseDay(S0).lines[0][5]) === J([["201", "New Ref", -3410, 30]]), "the credit period still reads (30 days): " + J(parseDay(S0).lines[0][5]));
}

// ---- 3. the owner's accuracy rules: each failure held in plain words; within one rupee of rounding passes
const S = read("partA-sales-two-rates.xml"), P = read("partA-purchase-igst.xml"), JC = read("partA-journal-cost-centres.xml");
const amtTag = (a) => '<AMOUNT TYPE="Amount">' + a + "</AMOUNT>";
{
  const v = one(S.replace(amtTag("-3410.00"), amtTag("-3400.00")));
  ok(v.checks.length && /^its lines do not add up to zero \(Rs 10\.00 more credit\)/.test(v.checks[0]), "lines that do not total zero: '" + v.checks[0] + "'");
}
{
  // CGST typed 10 rupees more than Tally's rates give, the party moved with it (the lines still add up)
  const x = S.replace(amtTag("205.00"), amtTag("215.00")).replace(amtTag("-3410.00"), amtTag("-3420.00")).replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3420.00</AMOUNT>");
  const v = one(x);
  ok(J(v.checks) === J(["the GST worked out on the items (Rs 410.00) does not match the GST ledger lines (Rs 420.00)"]), "item tax not equal to the GST ledger lines: " + J(v.checks));
  const y = S.replace(amtTag("205.00"), amtTag("205.40")).replace(amtTag("-3410.00"), amtTag("-3410.40")).replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3410.40</AMOUNT>");
  ok(J(one(y).checks) === "[]", "within one rupee (Tally's rounding per ledger): passes (" + J(one(y).checks) + ")");
}
{
  // an item's taxable value not the ledger line under it
  const x = S.replace(amtTag("2000.00") + "\n      <ACTUALQTY", amtTag("2100.00") + "\n      <ACTUALQTY");
  const v = one(x);
  ok(v.checks.some((c) => c === "item Widget A: taxable value Rs 2100.00 but the ledger lines under it come to Rs 2000.00"), "an item's taxable value not its ledger lines: " + J(v.checks));
}
{
  const v = one(S.replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3400.00</AMOUNT>"));
  ok(J(v.checks) === J(["the bill-wise details of Spike Customer come to Rs 3400.00, not the line's Rs 3410.00"]), "bill-wise not adding up to the line: " + J(v.checks));
}
{
  const v = one(JC.replace(amtTag("-10000.00"), amtTag("-9000.00")));
  ok(J(v.checks) === J(["the cost centres of Rent (Primary Cost Category) come to Rs 29000.00, not the line's Rs 30000.00"]), "cost centres not adding up to the line: " + J(v.checks));
}
{
  // IGST: the purchase's IGST typed short by 50 (the supplier moved with it)
  const v = one(P.replace(amtTag("-900.00"), amtTag("-850.00")).replace(amtTag("5900.00"), amtTag("5850.00")).replace("<AMOUNT>5900.00</AMOUNT>", "<AMOUNT>5850.00</AMOUNT>"));
  ok(J(v.checks) === J(["the GST worked out on the items (Rs 900.00) does not match the GST ledger lines (Rs 850.00)"]), "IGST not equal to the items' tax: " + J(v.checks));
}
{
  // no GST ledger lines at all (reverse charge, an unregistered supplier): the tax is not checked
  const x = S.replace(/<ALLLEDGERENTRIES\.LIST>\s*<LEDGERNAME TYPE="String">[CS]GST Output<\/LEDGERNAME>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g, "")
    .replace(amtTag("-3410.00"), amtTag("-3000.00")).replace("<AMOUNT>-3410.00</AMOUNT>", "<AMOUNT>-3000.00</AMOUNT>");
  ok(J(one(x).checks) === "[]", "an item invoice with no GST ledger lines: the tax is not checked (" + J(one(x).checks) + ")");
}
{
  const v = one(S.replace(/<ISCANCELLED TYPE="Logical">No/, '<ISCANCELLED TYPE="Logical">Yes').replace(amtTag("-3410.00"), amtTag("-3400.00")));
  ok(J(v.checks) === "[]", "a cancelled entry is not checked");
}

// ---- 3b. review M3 (06-Oct-2026): a worked-out tax that cannot be checked is a plain note saying which case ("tax not
// checked: ..."), never a hold (the owner's rule: only lines not totalling zero hold an entry)
{
  // the tax overtyped by Rs 10 on each of CGST and SGST (the party with it): with the usual names, a mismatch note
  const over = S.replace(/(<LEDGERNAME TYPE="String">CGST Output<\/LEDGERNAME>[\s\S]*?<AMOUNT TYPE="Amount">)205.00/, "$1215.00")
    .replace(/(<LEDGERNAME TYPE="String">SGST Output<\/LEDGERNAME>[\s\S]*?<AMOUNT TYPE="Amount">)205.00/, "$1215.00").split("-3410.00").join("-3430.00");
  ok(J(one(over).checks) === J(["the GST worked out on the items (Rs 410.00) does not match the GST ledger lines (Rs 430.00)"]), "tax overtyped, ledgers named CGST / SGST: the mismatch said (" + J(one(over).checks) + ")");
  // the same with GST ledgers whose names do not say GST: not checked, said so
  const odd = over.split("CGST Output").join("Output Tax - Centre").split("SGST Output").join("Output Tax - State");
  const c = one(odd).checks;
  ok(c.length === 1 && c[0].startsWith("tax not checked: no ledger line of this entry is named as a GST ledger") && c[0].includes("Output Tax - Centre") && c[0].includes("Rs 410.00"),
     "GST ledgers not named as GST: 'tax not checked', with the ledgers named (" + J(c) + ")");
  // an item without Tally's GST rate on its line (GST typed on the ledgers): not checked, said so
  const norate = S.replace(/(<STOCKITEMNAME TYPE="String">Rice B<\/STOCKITEMNAME>[\s\S]*?)<RATEDETAILS\.LIST>[\s\S]*<\/RATEDETAILS\.LIST>/, "$1");
  const c2 = one(norate).checks;
  ok(c2.length === 1 && c2[0].startsWith("tax not checked: Tally gave no GST rate on the line of") && c2[0].includes("Rice B"), "an item without Tally's rate: 'tax not checked', the item named (" + J(c2) + ")");
  // a cess based on quantity: not worked out, said so
  const qty = S.replace('<GSTRATEDUTYHEAD TYPE="String">Cess</GSTRATEDUTYHEAD>\n       <GSTRATEVALUATIONTYPE TYPE="String">Not Applicable</GSTRATEVALUATIONTYPE>',
    '<GSTRATEDUTYHEAD TYPE="String">Cess</GSTRATEDUTYHEAD>\n       <GSTRATEVALUATIONTYPE TYPE="String">Based on Quantity</GSTRATEVALUATIONTYPE>\n       <GSTRATE TYPE="Number"> 400</GSTRATE>');
  const c3 = one(qty).checks;
  ok(qty !== S && c3.length === 1 && c3[0].startsWith("tax not checked: a cess based on quantity on") && c3[0].includes("Widget A"), "a cess by quantity: 'tax not checked', the item named (" + J(c3) + ")");
}

// ---- 4. dates as Tally writes them
ok(d8("20261002") === "20261002" && d8("15-Nov-2026") === "20261115" && d8("5-Oct-26") === "20261005" && d8("30 Days") === "" && d8("") === "", "d8: yyyymmdd, d-Mon-yyyy, d-Mon-yy; a period in days is no date");
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
