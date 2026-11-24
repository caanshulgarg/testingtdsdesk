// node run_sheet_zoho.js - a Zoho Books "Invoice" export uploaded on Sales (next-fix-zoho-sales-sheet, 24-Nov-2026: a
// client's Zoho sheet came in with no taxable value read). The sheet is made up (fixtures/sheets/make_zoho_sheet.py) in
// Zoho's own layout: 201 columns, one row a line, no "Taxable value" column (the line's taxable value is "Item Total"),
// the taxes and the customer's GSTIN past column 80, the place of supply a state code, an "Invoice Status".
//   1. Zoho's layout is a format FinCom knows by its rules (no AI): Item Total added up an invoice, the invoice's Total
//      taken once, CGST / SGST / IGST, the customer's GSTIN, the place of supply from "DL", the client's own registration;
//   2. Draft and Void invoices are left out (the owner, 24-Nov-2026: only issued invoices), and said as a count;
//   3. a wide layout FinCom does not know: the AI is sent the columns that matter (at most 80, the server's limit) with
//      their own cells, so a taxable column at column 120 reaches it; a field the AI leaves out (or every field, when its
//      answer could not be read) is taken by its plain name where one is sure; saved, the same layout needs no AI again.
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const FX = path.join(__dirname, "fixtures", "sheets");
const NAMES = ["num", "r2", "fpHash", "GST_STATES", "SALES_RATES", "stateOfGstin", "GSTIN_RE", "NORM_CACHE", "normNameRaw", "normName", "normInv", "money", "INR", "MONTHS", "toIsoDate", "Market", "GST2B", "GSTAmend", "VR", "isSheetFile"];
const h = load(HTML, NAMES);
h.ctx.window = h.ctx; vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "src", "lib", "registers.js"), "utf8").replace(/^import .*$/gm, ""), h.ctx);
const F = h.ctx.SheetFmt, co = {id: "c1", name: "ZZ Up Client", gstin: "09AANFG3202D1ZR", sheetFormats: []};
h.ctx.CO = () => co; h.ctx.S = {coId: "c1", firm: {}};
const g = F.csv(fs.readFileSync(path.join(FX, "sales_zoho_invoice.csv"), "utf8")), hi = F.head(g), head = g[hi];
ok(hi === 0 && head.length === 201, "the header found: 201 columns");

console.log("1. Zoho's invoice export: known by its rules, no AI");
const found = F.find(head, "Invoice", "c1", "sales");
ok(found && found.how === "builtin" && found.fmt.builtin === "zoho-invoice", "a format FinCom knows (" + JSON.stringify(found && [found.how, found.fmt.builtin, found.fmt.name]) + ")");
ok(!F.find(head, "Invoice", "c1", "purchase") || F.find(head, "Invoice", "c1", "purchase").fmt.builtin !== "zoho-invoice", "not on Purchase: it is a sales export");
const docs = found ? F.apply(found.fmt, g, hi, co, "sales") : [];
const by = (no) => docs.find((d) => d.no === no) || {};
ok(docs.map((d) => d.no).join() === "INV-000101,INV-000102,INV-000106,INV-000107", "four issued invoices, the lines of each one invoice (" + docs.map((d) => d.no + ":" + d.lines) + ")");
const a = by("INV-000101");
ok(a.lines === 2 && a.taxable === 15000 && a.igst === 2700 && a.cgst === 0 && a.total === 17700 && a.check && a.check.ok, "two lines: Item Total 10,000 + 5,000 = taxable 15,000, IGST 2,700, Total 17,700 taken once (" + JSON.stringify([a.taxable, a.igst, a.total]) + ")");
ok(a.gstin === "07AABCD1111E1Z1" && a.pos === "07" && !a.posFromGstin && a.date === "2026-10-03" && a.own === "09AANFG3202D1ZR" && a.party === "Dhruv Office Supplies", "the customer's GSTIN, the place of supply from “DL”, the date, the client's own registration (" + JSON.stringify([a.gstin, a.pos, a.date, a.own]) + ")");
const b = by("INV-000102");
ok(b.taxable === 2000 && b.cgst === 180 && b.sgst === 180 && b.igst === 0 && b.total === 2360 && b.pos === "09" && b.hsn === "999293", "CGST and SGST in the client's own state; HSN read");
const c = by("INV-000106");
ok(c.taxable === 8000 && c.igst === 0 && c.total === 8000 && c.check.ok && c.pos === "29", "the line discount is in Item Total (2 x 4,500 − 1,000 = 8,000); SEZ, nil tax");
const d = by("INV-000107");
ok(d.lines === 3 && d.taxable === 3500 && d.igst === 500 && d.total === 4000 && (d.items || []).map((x) => x.rate + ":" + x.taxable).join() === "5:1000,18:2500", "three lines at two rates: one item line a rate (" + JSON.stringify((d.items || []).map((x) => [x.rate, x.taxable, x.tax])) + ")");
const sum = (k) => Math.round(docs.reduce((s, x) => s + x[k], 0) * 100) / 100;
ok(sum("taxable") === 28500 && Math.round((sum("igst") + sum("cgst") + sum("sgst")) * 100) / 100 === 3560 && sum("total") === 32060, "taxable 28,500, tax 3,560, total 32,060 (" + [sum("taxable"), sum("total")] + ")");

console.log("2. Draft and Void invoices left out, said as a count");
const sk = docs.skipped || [];
ok(sk.filter((x) => x.status === "draft").length === 3 && sk.filter((x) => x.status === "void").length === 1, "the three Draft rows and the Void row left out (" + JSON.stringify(sk.map((x) => [x.row, x.why])) + ")");
const lo = F.leftOut ? F.leftOut(sk) : {};
ok(lo.status === "2 draft invoices and 1 void invoice left out: only issued invoices are read." && !(lo.rows || []).length, "said in plain words, invoices counted, not rows (" + JSON.stringify(lo) + ")");
ok(F.leftOut && F.leftOut([{row: 4, why: "a total row"}, {row: 9, why: "a draft invoice", status: "draft", no: "X1"}]).status === "1 draft invoice left out: only issued invoices are read." && F.leftOut([{row: 4, why: "a total row"}]).rows.length === 1, "one draft invoice; a total row is said as before");

console.log("3. a wide layout FinCom does not know: the AI sees the columns that matter, once");
// the same export with its columns renamed as another system might (no "Item Total", no "Invoice Status"), a
// "Taxable Amount" at column 120 and the taxes past 140
const ren = {"Item Total": "Line Amount", "Invoice Status": "State Of Doc", "Supplier Org Name": "Taxable Amount"};
const g2 = g.map((r, i) => i === 0 ? r.map((x) => ren[x] || x) : r.slice()), head2 = g2[0];
const ti = head2.indexOf("Line Amount"), ta = head2.indexOf("Taxable Amount");
g2.slice(1).forEach((r) => { r[ta] = r[ti]; });
ok(!F.find(head2, "Invoice", "c1", "sales"), "not a format FinCom knows: the AI is asked");
const sent = [];
h.ctx.SheetAI.map = async (req) => { sent.push(req); const pick = (n) => req.head.find((x) => x === n); return {ok: true, map: {date: pick("Invoice Date"), no: pick("Invoice Number"), taxable: pick("Taxable Amount"), igst: pick("IGST")}, transforms: {date: "ymd", groupByNo: true}, why: {}}; };
(async () => {
  const p = await F.propose(head2, g2.slice(1, 11), "sales");
  const q = sent[0] || {head: [], rows: []};
  ok(sent.length === 1 && q.head.length <= 80, "one call, at most 80 columns sent (" + q.head.length + " of " + head2.length + ")");
  ["Taxable Amount", "Line Amount", "CGST", "SGST", "IGST", "GST Identification Number (GSTIN)", "Place of Supply", "Invoice Number", "Invoice Date", "Customer Name", "HSN/SAC", "Total"].forEach((n) =>
    ok(q.head.includes(n), "sent: “" + n + "”"));
  ok(!q.head.includes("PayPal") && !q.head.includes("Billing Street2") && !q.head.includes("CGST(FCY)"), "blank and foreign-currency columns are not sent");
  const k = q.head.indexOf("IGST"), mk = F.masked(head2, g2.slice(1, 11));
  ok(q.rows.length === 10 && q.rows.every((r) => r.length === q.head.length) && q.rows[0][k] === mk.rows[0][head2.indexOf("IGST")], "each row's cells under their own column");
  ok(p.map.taxable === "taxableamount" && p.map.igst === "igst", "the AI's answer read (" + JSON.stringify(p.map) + ")");
  ok(p.map.cgst === "cgst" && p.map.sgst === "sgst" && p.map.gstin === "gstidentificationnumbergstin" && p.map.pos === "placeofsupply" && p.map.party === "customername" && p.map.total === "total", "what the AI left out, taken by its plain name");
  ok(p.why.cgst && /name/.test(p.why.cgst), "and said so (" + p.why.cgst + ")");
  // the AI's answer could not be read (cut off): every field FinCom is sure of by name, still
  h.ctx.SheetAI.map = async () => ({ok: true, map: {}, transforms: {date: "dmy", groupByNo: true}, why: {}});
  const p2 = await F.propose(head2, g2.slice(1, 11), "sales");
  ok(p2.map.taxable === "taxableamount" && p2.map.no === "invoicenumber" && p2.map.date === "invoicedate" && p2.map.igst === "igst", "an empty answer: the sure columns by name (" + JSON.stringify(p2.map) + ")");
  ok(F.byName && F.byName(head2, "sales").taxable === "taxableamount" && F.byName(head, "sales").taxable === "itemtotal", "by name: “Taxable Amount”, else Zoho's “Item Total”");
  // saved: the same layout is known, no AI
  co.sheetFormats.push({id: "sf-z", name: "Wide", side: "sales", fp: F.fingerprint(head2, "Invoice"), cols: head2.length, headers: head2.map((x) => F.norm(x)), map: p.map, transforms: p.transforms});
  const again = F.find(head2, "Invoice", "c1", "sales");
  ok(again && again.how === "known", "saved: the same layout again is read with no AI (" + (again && again.how) + ")");
  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
