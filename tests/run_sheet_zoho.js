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
const NAMES = ["num", "r2", "fpHash", "GST_STATES", "SALES_RATES", "stateOfGstin", "GSTIN_RE", "NORM_CACHE", "normNameRaw", "normName", "normInv", "money", "INR", "MONTHS", "toIsoDate", "Market", "GST2B", "GSTAmend", "VR", "isSheetFile", "GST_CHARS", "gstinCheckChar", "gstinValid"];
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
  // (review of 4bd26c5e9: one invoice is CGST + SGST or IGST, never both: the shipping tax goes as the items' tax does)
  ok(z.taxable === 1300 && z.cgst === 117 && z.sgst === 117 && z.igst === 0 && z.total === 1534 && z.check.ok, "Z-203: its items carry CGST + SGST: the shipping tax 54 split 27 + 27 too, its tax type “IGST” not followed (" + fig(z) + ")");
  ok(md.every((x) => !(x.igst && (x.cgst || x.sgst))), "no invoice carries both IGST and CGST / SGST (" + md.filter((x) => x.igst && (x.cgst || x.sgst)).map((x) => x.no) + ")");
  // the items carry no tax (nil-rated): the tax type, else the place of supply
  const nilShip = (type, cust) => { const H = gm[hm].map((x) => F.norm(x)), c = (n) => H.indexOf(n), rows = gm.filter((r, i) => i > hm && r[c("invoicenumber")] === "Z-203").map((r) => r.slice());
    rows.forEach((r) => { ["cgst", "sgst", "igst"].forEach((n) => { r[c(n)] = "0.00"; }); r[c("shippingchargetaxtype")] = type; r[c("total")] = "1354.00"; if (cust) r[c("placeofsupply")] = cust; });
    return F.apply(fm.fmt, [gm[hm]].concat(rows), 0, co, "sales")[0] || {}; };
  let n1 = nilShip("IGST"), n2 = nilShip(""), n3 = nilShip("", "DL");
  ok(n1.igst === 54 && !n1.cgst && n1.total === 1354 && n1.check.ok, "no tax on the items, its tax type IGST: IGST 54 (" + fig(n1) + ")");
  ok(n2.cgst === 27 && n2.sgst === 27 && !n2.igst && n3.igst === 54 && !n3.cgst, "no tax on the items, no tax type: by the place of supply (UP: 27 + 27; DL: IGST 54) (" + fig(n2) + fig(n3) + ")");
  // the items carry IGST: the shipping tax IGST, whatever its tax type says
  const H0 = gm[hm].map((x) => F.norm(x)), z2rows = gm.filter((r, i) => i > hm && r[H0.indexOf("invoicenumber")] === "Z-202").map((r) => { r = r.slice(); r[H0.indexOf("shippingchargetaxtype")] = "GST"; return r; });
  const z2 = F.apply(fm.fmt, [gm[hm]].concat(z2rows), 0, co, "sales")[0] || {};
  ok(z2.igst === 396 && !z2.cgst && !z2.sgst, "Z-202 with its tax type “GST”: its items carry IGST, so IGST (" + fig(z2) + ")");
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
  ok(md.every((x) => x.gstin && h.ctx.gstinValid(x.gstin)), "the made-up GSTINs of the sheet pass the check character (" + md.map((x) => x.gstin).filter((g, i, a) => a.indexOf(g) === i) + ")");
  console.log("7b. tax-inclusive with no Item Total column: the invoice's whole tax taken off once");
  const noIt = gm.map((r, i) => i === hm ? r.map((x) => x === "Item Total" ? "Line Note" : x) : r.slice()), fn = F.find(noIt[hm], "Invoice", "c1", "sales");
  ok(fn && fn.fmt.builtin === "zoho-invoice" && fn.fmt.transforms.docTaxable === true, "no Item Total: SubTotal, taken once");
  const ni = fn ? F.apply(fn.fmt, noIt, hm, co, "sales") : [], n7 = ni.find((x) => x.no === "Z-207") || {};
  ok(n7.taxable === 2000 && n7.cgst === 115 && n7.sgst === 115 && n7.total === 2230 && n7.check.ok, "Z-207: SubTotal 2,230 less its whole tax 230 = 2,000 (" + fig(n7) + ")");
  ok(!(n7.items || []).some((x) => x.taxable < 0 || (x.tax && !x.taxable)), "no item line with a negative taxable value or tax on nothing (" + JSON.stringify(n7.items || []) + ")");
  const n8 = ni.find((x) => x.no === "Z-205") || {};
  ok(n8.taxable === 4500 && n8.check.ok, "Z-205 with SubTotal: 5,000 less the invoice's 500, once (" + fig(n8) + ")");
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
  // (review of 4bd26c5e9) a mapping saved before FinCom read Zoho's status (15d4414a0) has no status column, and none
  // of the rule's once-an-invoice transforms: the rule's essentials are laid on it, its own column choices kept
  ok(mine && mine.fmt.map.status === "invoicestatus" && mine.fmt.transforms.groupByNo === true && mine.fmt.transforms.docTotal === true && mine.fmt.transforms.docTaxable === false && mine.fmt.map.taxable === "itemtotal" && mine.fmt.transforms.zoho && mine.fmt.transforms.zoho.adj === "adjustment",
    "the rule's status column and transforms laid on it; its SubTotal read as Item Total, which the header has (review of 1352e5dfb) (" + JSON.stringify(mine && [mine.fmt.map, mine.fmt.transforms]) + ")");
  const od = mine ? F.apply(mine.fmt, g, hi, co, "sales") : [];
  ok(od.map((x) => x.no).join() === "INV-000101,INV-000102,INV-000106,INV-000107", "with the saved mapping: Draft INV-000103 / 104 and Void INV-000105 still left out (" + od.map((x) => x.no) + ")");
  ok((od.skipped || []).filter((x) => x.status === "draft").length === 3 && (od.skipped || []).filter((x) => x.status === "void").length === 1, "… and counted as Draft and Void");
  ok(od.map((x) => x.taxable).join() === "15000,2000,8000,3500" && od.every((x) => x.check.ok), "its SubTotal taken once an invoice: taxable 15,000 / 2,000 / 8,000 / 3,500 (" + JSON.stringify(od.map((x) => [x.taxable, x.total, x.check])) + ")");
  ok(co.sheetFormats.find((x) => x.id === "sf-own").map.status === undefined, "the saved mapping itself is not changed");
  // a stale mapping (taxable = SubTotal, no docTaxable / docTotal) on a nil-rated invoice of two rows: 8,000, not 16,000
  const HZ = head.map((x) => F.norm(x)), cz = (n) => HZ.indexOf(n), tpl = g.find((r, i) => i > hi && r[cz("invoicenumber")] === "INV-000106");
  const nil = [5000, 3000].map((it) => { const r = tpl.slice(); r[cz("invoicenumber")] = "INV-000301"; r[cz("itemtotal")] = it.toFixed(2); r[cz("subtotal")] = "8000.00"; r[cz("total")] = "8000.00"; return r; });
  co.sheetFormats.push({id: "sf-stale", name: "Old Zoho", side: "sales", fp: zfp, cols: head.length, headers: HZ, map: {no: "invoicenumber", date: "invoicedate", party: "customername", taxable: "subtotal", total: "total"}, transforms: {date: "dmy", groupByNo: true}, at: "2026-11-01"});
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-own");
  const st2 = F.find(head, "Invoice", "c1", "sales"), nd = st2 ? F.apply(st2.fmt, [head].concat(nil), 0, co, "sales") : [];
  ok(st2 && st2.how === "known" && nd.length === 1 && nd[0].taxable === 8000 && nd[0].total === 8000 && nd[0].check.ok, "a stale saved mapping: SubTotal 8,000 on each of two rows is 8,000 once, not 16,000 (" + JSON.stringify(nd.map((x) => [x.no, x.taxable, x.total])) + ")");
  // a saved mapping that chose Item Total: added up (its own column choice kept)
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-stale");
  co.sheetFormats.push({id: "sf-it", name: "Zoho lines", side: "sales", fp: zfp, cols: head.length, headers: HZ, map: {no: "invoicenumber", date: "invoicedate", party: "customername", taxable: "itemtotal", total: "total", hsn: "itemname"}, transforms: {date: "ymd", groupByNo: true}});
  const st3 = F.find(head, "Invoice", "c1", "sales"), nd3 = st3 ? F.apply(st3.fmt, [head].concat(nil), 0, co, "sales") : [];
  ok(st3 && st3.fmt.map.hsn === "itemname" && st3.fmt.transforms.date === "ymd" && st3.fmt.transforms.docTaxable === false && nd3.length === 1 && nd3[0].taxable === 8000, "a saved mapping's own column choices kept (HSN, the date order), Item Total added up: 8,000 (" + JSON.stringify(nd3.map((x) => x.taxable)) + ")");
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-it");
  co.sheetFormats.push({id: "sf-own", name: "Our Zoho", side: "sales", fp: zfp, cols: head.length, headers: HZ, map: {no: "invoicenumber"}, transforms: {}});
  const CO0 = h.ctx.CO; h.ctx.CO = (id) => id === "c2" ? {id: "c2", sheetFormats: []} : co;
  const other = F.find(head, "Invoice", "c2", "sales"); h.ctx.CO = CO0;
  ok(other && other.how === "builtin" && other.fmt.builtin === "zoho-invoice", "another client: the Zoho rule (" + JSON.stringify(other && [other.how, other.fmt.id]) + ")");
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-own");
  co.sheetFormats.push({id: "sf-drift", name: "Near", side: "sales", fp: "fnot", cols: head.length + 1, headers: [], map: {no: "invoicenumber", date: "invoicedate", taxable: "subtotal"}, transforms: {}});
  const near = F.find(head, "Invoice", "c1", "sales");
  ok(near && near.how === "builtin", "a saved layout that is only near (drift): the Zoho rule still (" + (near && near.how) + ")");
  co.sheetFormats = co.sheetFormats.filter((x) => x.id !== "sf-drift");

  console.log("10. review of 1352e5dfb: every item at the rate the sheet gives, never a rate no item carries");
  co.sheetFormats = [];
  const HD = gm[hm], HN = HD.map((x) => F.norm(x)), cc = (n) => HN.indexOf(n), tp = gm[hm + 1];
  const row = (o) => { const r = tp.map(() => ""); r[cc("invoicedate")] = "2026-10-20"; r[cc("invoicenumber")] = o.no; r[cc("invoicestatus")] = "Open"; r[cc("customername")] = "Ujala Lamps";
    r[cc("placeofsupply")] = o.pos || "UP"; r[cc("gstidentificationnumbergstin")] = o.pos === "DL" ? "07AAACD4444H1ZV" : "09AAACU5555J1ZZ"; r[cc("suppliergstregistrationnumber")] = "09AANFG3202D1ZR";
    r[cc("isinclusivetax")] = o.incl ? "true" : "false"; r[cc("isdiscountbeforetax")] = "true";
    Object.entries(o.v || {}).forEach(([k, v]) => { r[cc(k)] = String(v); }); return r; };
  const rd = (hd, rows, fmt) => { const f = fmt || (F.find(hd, "Invoice", "c1", "sales") || {}).fmt; return f ? F.apply(f, [hd].concat(rows), 0, co, "sales") : []; };
  const its = (x) => (x.items || []).map((i) => i.rate + ":" + i.taxable + ":" + i.tax).join();
  const both = (x) => JSON.stringify([x.taxable, x.igst, x.cgst, x.sgst, x.total, its(x), x.check && x.check.ok, x.hold || ""]);
  // A1: a discount before tax on an invoice of two rates (IGST): 1,000 at 18% and 1,000 at 5%, 200 off: 900 + 900
  const a1 = (rate) => [row({no: "A1", pos: "DL", v: {itemtotal: "1000.00", igst: "162.00", "igstrate%": rate ? "18.00" : "", subtotal: "2000.00", total: "2007.00", entitydiscountamount: "200.00"}}),
    row({no: "A1", pos: "DL", v: {itemtotal: "1000.00", igst: "45.00", "igstrate%": rate ? "5.00" : "", subtotal: "2000.00", total: "2007.00", entitydiscountamount: "200.00"}})];
  let w = rd(HD, a1(true))[0] || {};
  ok(its(w) === "5:900:45,18:900:162" && w.taxable === 1800 && w.check.ok, "A1: the discount shared, each line at the rate the sheet gives: 900 at 5%, 900 at 18% (" + both(w) + ")");
  w = rd(HD, a1(false))[0] || {};
  ok(its(w) === "5:900:45,18:900:162", "A1 with no rate on the rows: each line's rate from its figures after the discount (" + both(w) + ")");
  // the same, CGST + SGST, the rates in CGST Rate % and SGST Rate %
  w = rd(HD, [row({no: "A1c", v: {itemtotal: "1000.00", cgst: "81.00", sgst: "81.00", "cgstrate%": "9.00", "sgstrate%": "9.00", subtotal: "2000.00", total: "2007.00", entitydiscountamount: "200.00"}}),
    row({no: "A1c", v: {itemtotal: "1000.00", cgst: "22.50", sgst: "22.50", "cgstrate%": "2.50", "sgstrate%": "2.50", subtotal: "2000.00", total: "2007.00", entitydiscountamount: "200.00"}})])[0] || {};
  ok(its(w) === "5:900:45,18:900:162" && w.check.ok, "A1 within the state: CGST Rate % + SGST Rate % (" + both(w) + ")");
  // tax-inclusive with a discount: 1,180 at 18% and 1,050 at 5%, 223 off the prices with tax: 900 + 900
  w = rd(HD, [row({no: "I1", pos: "DL", incl: 1, v: {itemtotal: "1180.00", igst: "162.00", "igstrate%": "18.00", subtotal: "2230.00", total: "2007.00", entitydiscountamount: "223.00"}}),
    row({no: "I1", pos: "DL", incl: 1, v: {itemtotal: "1050.00", igst: "45.00", "igstrate%": "5.00", subtotal: "2230.00", total: "2007.00", entitydiscountamount: "223.00"}})])[0] || {};
  ok(its(w) === "5:900:45,18:900:162" && w.taxable === 1800 && w.check.ok, "tax-inclusive with a discount: 900 at 5%, 900 at 18% (" + both(w) + ")");
  w = rd(HD, [row({no: "D1", pos: "DL", v: {itemtotal: "1000.00", igst: "162.00", "igstrate%": "18.00", subtotal: "2000.00", total: "2124.00", entitydiscountamount: "200.00"}}),
    row({no: "D1", pos: "DL", v: {itemtotal: "1000.00", igst: "162.00", "igstrate%": "18.00", subtotal: "2000.00", total: "2124.00", entitydiscountamount: "200.00"}})])[0] || {};
  ok(!its(w) && w.taxable === 1800 && w.rate === 18 && w.check.ok, "one rate on two lines with a discount: one line at 18% (" + both(w) + ")");
  // A2: SubTotal only (no Item Total): 6,000 at 5% and 7,000 at 18%, SubTotal 13,000 (a blend of 12%, a GST rate)
  const HD2 = HD.map((x) => x === "Item Total" ? "Line Note" : x);
  const a2 = (rates, sub, incl) => [row({no: "A2", incl, v: {cgst: "150.00", sgst: "150.00", "cgstrate%": rates ? "2.50" : "", "sgstrate%": rates ? "2.50" : "", subtotal: sub, total: "14560.00"}}),
    row({no: "A2", incl, v: {cgst: "630.00", sgst: "630.00", "cgstrate%": rates ? "9.00" : "", "sgstrate%": rates ? "9.00" : "", subtotal: sub, total: "14560.00"}})];
  w = rd(HD2, a2(true, "13000.00"))[0] || {};
  ok(its(w) === "5:6000:300,18:7000:1260" && w.taxable === 13000 && w.check.ok && !w.hold, "A2: SubTotal split by rate (each rate's tax / its rate): 6,000 at 5%, 7,000 at 18%, never one line at 12% (" + both(w) + ")");
  w = rd(HD2, a2(true, "14560.00", 1))[0] || {};
  ok(its(w) === "5:6000:300,18:7000:1260" && w.taxable === 13000 && w.check.ok && !w.hold, "A2 tax-inclusive: the same (" + both(w) + ")");
  w = rd(HD2, a2(false, "13000.00"))[0] || {};
  ok(w.hold === "SubTotal cannot be split by GST rate: the rows carry tax but the sheet gives no rate. Check the invoice in Zoho", "A2 with no rate on the rows: held, said plainly (" + both(w) + ")");
  w = rd(HD2, a2(true, "13500.00"))[0] || {};
  ok(w.hold === "SubTotal 13500.00 does not match the taxable values worked out from each GST rate (13000.00). Check the invoice in Zoho", "A2 whose rates do not add up to SubTotal: held (" + both(w) + ")");
  // (review of b2a451774) a nil-rated row the sheet gives a rate (0%) is a rate of its own: it takes what is left of
  // SubTotal. SubTotal 10,000 less 1,000 off: 5,400 at 5% (tax 270) and 3,600 nil
  w = rd(HD2, [row({no: "C1", v: {cgst: "135.00", sgst: "135.00", "cgstrate%": "2.5", "sgstrate%": "2.5", subtotal: "10000.00", total: "9270.00", entitydiscountamount: "1000.00"}}),
    row({no: "C1", v: {cgst: "0.00", sgst: "0.00", "cgstrate%": "0", "sgstrate%": "0", subtotal: "10000.00", total: "9270.00", entitydiscountamount: "1000.00"}})])[0] || {};
  ok(its(w) === "0:3600:0,5:5400:270" && w.taxable === 9000 && w.check.ok && !w.hold, "C: 5% and a nil row, SubTotal and a discount: 5,400 at 5% and 3,600 nil, never one line at 3% (" + both(w) + ")");
  w = rd(HD2, [row({no: "C2", v: {cgst: "135.00", sgst: "135.00", "cgstrate%": "2.5", "sgstrate%": "2.5", subtotal: "5400.00", total: "5670.00"}})])[0] || {};
  ok(!its(w) && w.taxable === 5400 && w.rate === 5 && w.check.ok && !w.hold, "one row at 5%: one line (" + both(w) + ")");
  // a saved mapping of SubTotal on a header that has Item Total: Item Total
  const zfp2 = F.fingerprint(HD, "Invoice"), sv = (map) => { co.sheetFormats = [{id: "sv", name: "Mine", side: "sales", fp: zfp2, cols: HD.length, headers: HN, map, transforms: {date: "ymd", groupByNo: true}}]; return F.find(HD, "Invoice", "c1", "sales").fmt; };
  const s7 = [row({no: "S7", v: {itemtotal: "6000.00", cgst: "150.00", sgst: "150.00", subtotal: "13000.00", total: "14560.00"}}), row({no: "S7", v: {itemtotal: "7000.00", cgst: "630.00", sgst: "630.00", subtotal: "13000.00", total: "14560.00"}})];
  let fm7 = sv({no: "invoicenumber", date: "invoicedate", taxable: "subtotal", total: "total"});
  w = rd(HD, s7, fm7)[0] || {};
  ok(fm7.map.taxable === "itemtotal" && fm7.transforms.docTaxable === false && its(w) === "5:6000:300,18:7000:1260", "a saved mapping of SubTotal, the header has Item Total: Item Total, rate-wise (" + both(w) + ")");
  // B: a saved mapping that reads Total as the taxable value: the rule's taxable value, and the sum check on Total
  const b1 = [row({no: "B1", v: {itemtotal: "1000.00", cgst: "90.00", sgst: "90.00", subtotal: "1000.00", total: "1180.00"}})];
  let fb = sv({no: "invoicenumber", date: "invoicedate", taxable: "total"});
  w = rd(HD, b1, fb)[0] || {};
  ok(fb.map.taxable === "itemtotal" && fb.map.total === "total" && w.taxable === 1000 && w.total === 1180 && w.check.ok, "saved taxable = Total: refused, Item Total; checked against Total (" + JSON.stringify(fb.map) + both(w) + ")");
  fb = sv({no: "invoicenumber", date: "invoicedate", taxable: "itemtotal", cgst: "cgst", sgst: "sgst", total: "balance"});
  w = rd(HD, b1.map((r) => { r = r.slice(); r[cc("balance")] = "0.00"; return r; }), fb)[0] || {};
  ok(fb.map.total === "total" && w.total === 1180 && w.check.ok, "saved total = Balance: the rule's Total (" + JSON.stringify(fb.map) + both(w) + ")");
  fb = sv({no: "invoicenumber", date: "invoicedate", taxable: "itemtotal", cess: "total"});
  ok(fb.map.cess === "cess", "an invoice-level column for another field (cess = Total): not read, the rule's CESS instead (" + JSON.stringify(fb.map) + ")");
  // (review of b2a451774, E) a saved single tax column (it carries the cess too): Zoho's own CGST / SGST / IGST / CESS
  // columns are read instead, so the cess is never put in CGST + SGST (400 as 200 + 200 at 40%)
  fb = sv({no: "invoicenumber", date: "invoicedate", taxable: "itemtotal", tax: "itemtaxamount", total: "total"});
  w = rd(HD, [row({no: "S1", v: {itemtotal: "1000.00", cgst: "140.00", sgst: "140.00", cess: "120.00", itemtaxamount: "400.00", subtotal: "1000.00", total: "1400.00"}})], fb)[0] || {};
  ok(!fb.map.tax && fb.map.cgst === "cgst" && fb.map.sgst === "sgst" && fb.map.igst === "igst" && fb.map.cess === "cess" && w.cgst === 140 && w.sgst === 140 && w.cess === 120 && w.rate === 28 && w.check.ok,
    "saved one tax column: Zoho's CGST 140 + SGST 140 at 28% and CESS 120 read instead (" + JSON.stringify(fb.map) + both(w) + JSON.stringify([w.cess, w.rate]) + ")");
  fb = sv({no: "invoicenumber", date: "invoicedate", taxable: "itemtotal", igst: "itemtaxamount", total: "total"});
  ok(!fb.map.cgst && !fb.map.sgst && fb.map.igst === "itemtaxamount", "saved the full tax in IGST: no CGST / SGST filled in (" + JSON.stringify(fb.map) + ")");
  co.sheetFormats = [];

  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
