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

  // next-zoho-sheet-followups: the invoice's own figures Zoho repeats on every line (made up, sales_zoho_more.csv)
  const gm = F.csv(fs.readFileSync(path.join(FX, "sales_zoho_more.csv"), "utf8")), hm = F.head(gm), fm = F.find(gm[hm], "Invoice", "c1", "sales");
  const md = fm ? F.apply(fm.fmt, gm, hm, co, "sales") : [], M = (no) => md.find((x) => x.no === no) || {};
  const fig = (x) => JSON.stringify([x.taxable, x.cgst, x.sgst, x.igst, x.total, x.check && x.check.ok, x.roundOff]);
  ok(fm && fm.fmt.builtin === "zoho-invoice" && md.length === 10, "4. the more cases: a Zoho export, ten invoices (" + md.length + ")");
  console.log("4. shipping: part of the value of supply (s.15(2)(c) CGST Act), taken once an invoice");
  let z = M("Z-201");
  ok(z.taxable === 1500 && z.cgst === 135 && z.sgst === 135 && z.igst === 0 && z.total === 1770 && z.check.ok, "Z-201: shipping 500 on two lines added once; its tax 90 split CGST + SGST by the place of supply (" + fig(z) + ")");
  z = M("Z-202");
  ok(z.taxable === 2200 && z.igst === 396 && z.cgst === 0 && z.total === 2596 && z.check.ok, "Z-202: shipping 200 at 18% with no amount: IGST 36 worked out, Delhi (" + fig(z) + ")");
  ok((z.items || []).length === 0 || (z.items || []).every((x) => x.rate === 18), "Z-202: one rate, 18% (" + JSON.stringify(z.items || []) + ")");
  z = M("Z-203");
  ok(z.taxable === 1300 && z.cgst === 90 && z.sgst === 90 && z.igst === 54 && z.total === 1534 && z.check.ok, "Z-203: its tax type IGST: IGST, though the place of supply is the client's state (" + fig(z) + ")");
  z = M("Z-204");
  ok(z.taxable === 1000 && z.cgst === 90 && z.total === 1280 && !z.check.ok && z.check.diff === 100, "Z-204: shipping with no tax amount or rate: not added, left to the sum check (" + fig(z) + ")");
  console.log("5. an invoice discount before tax, taken once");
  z = M("Z-205");
  ok(z.taxable === 4500 && z.igst === 810 && z.total === 5310 && z.check.ok, "Z-205: 3,000 + 2,000 less the invoice's 500 = 4,500, taken once (" + fig(z) + ")");
  z = M("Z-206");
  ok(z.taxable === 1000 && z.igst === 180 && z.total === 1080 && !z.check.ok, "Z-206: a discount after tax: taxable not cut, left to the sum check (" + fig(z) + ")");
  console.log("6. tax-inclusive: Item Total less its tax");
  z = M("Z-207");
  ok(z.taxable === 2000 && z.cgst === 115 && z.sgst === 115 && z.total === 2230 && z.check.ok && (z.items || []).map((x) => x.rate + ":" + x.taxable).join() === "5:1000,18:1000", "Z-207: 1,050 and 1,180 with tax in them: 1,000 at 5% and 1,000 at 18% (" + fig(z) + JSON.stringify((z.items || []).map((x) => [x.rate, x.taxable])) + ")");
  console.log("7. Adjustment: the invoice's round off, once, only when it explains the total");
  z = M("Z-208");
  ok(z.taxable === 1000 && z.total === 1205 && z.check.ok && z.roundOff === 25, "Z-208: Adjustment 25 on two lines: round off 25, once (" + fig(z) + ")");
  z = M("Z-209");
  ok(z.total === 1169.5 && z.check.ok && z.roundOff === -10.5, "Z-209: Adjustment -10.50: round off -10.50 (" + fig(z) + ")");
  z = M("Z-210");
  ok(z.total === 1230 && !z.check.ok && !z.roundOff, "Z-210: Adjustment 25 that does not explain the total: no round off, does not add up (" + fig(z) + ")");
  ok(!md.filter((x) => !["Z-208", "Z-209"].includes(x.no)).some((x) => x.roundOff), "no round off on the others");
  ok(docs.every((x) => !x.roundOff) && docs.map((x) => x.taxable).join() === "15000,2000,8000,3500", "the first sheet as before");

  console.log("8. the AI mapped one tax column: CGST, SGST and IGST are not added by name");
  h.ctx.SheetAI.map = async (req) => { const pick = (n) => req.head.find((x) => x === n) || n; return {ok: true, map: {date: pick("Invoice Date"), no: pick("Invoice Number"), taxable: pick("Taxable Amount"), tax: pick("Item Tax Amount")}, transforms: {date: "ymd", groupByNo: true}, why: {}}; };
  const p3 = await F.propose(head2, g2.slice(1, 11), "sales");
  ok(p3.map.tax === "itemtaxamount" && !p3.map.cgst && !p3.map.sgst && !p3.map.igst && !p3.why.cgst, "tax mapped: no CGST / SGST / IGST by name (" + JSON.stringify(p3.map) + ")");
  ok(p3.map.party === "customername" && p3.map.gstin === "gstidentificationnumbergstin", "the other fields still by name");

  console.log("9. a client's own saved mapping for this exact header wins over the Zoho rule");
  const zfp = F.fingerprint(head, "Invoice");
  co.sheetFormats.push({id: "sf-own", name: "Our Zoho", side: "sales", fp: zfp, cols: head.length, headers: head.map((x) => F.norm(x)), map: {no: "invoicenumber", date: "invoicedate", taxable: "subtotal", total: "total"}, transforms: {date: "dmy", groupByNo: true}});
  const mine = F.find(head, "Invoice", "c1", "sales");
  ok(mine && mine.how === "known" && mine.fmt.id === "sf-own", "the client's own saved one, first (" + JSON.stringify(mine && [mine.how, mine.fmt.id]) + ")");
  const CO0 = h.ctx.CO; h.ctx.CO = (id) => id === "c2" ? {id: "c2", sheetFormats: []} : co;
  const other = F.find(head, "Invoice", "c2", "sales"); h.ctx.CO = CO0;
  ok(other && other.how === "builtin" && other.fmt.builtin === "zoho-invoice", "another client: the Zoho rule (" + JSON.stringify(other && [other.how, other.fmt.id]) + ")");
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-own");
  co.sheetFormats.push({id: "sf-drift", name: "Near", side: "sales", fp: "fnot", cols: head.length + 1, headers: [], map: {no: "invoicenumber", date: "invoicedate", taxable: "subtotal"}, transforms: {}});
  const near = F.find(head, "Invoice", "c1", "sales");
  ok(near && near.how === "builtin", "a saved layout that is only near (drift): the Zoho rule still (" + (near && near.how) + ")");
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-drift");
  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
