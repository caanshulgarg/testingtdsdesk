// node run_sheet_engine.js - the sheet-format engine (src/js/80-sheet-import.js) on the made-up registers in
// tests/fixtures/sheets (make_sheets.py), with no browser: the header found, the fingerprint, a saved format found again
// (exact, and with a column added), a real change not, the AI shown only the header and 10 masked rows, every figure
// worked out by FinCom's rules to the paisa (Rs., commas, brackets negative, an invoice on two rows, a total row left
// out, a single tax column split by the place of supply), a PDF table's rows, another portal's JSON flattened to paths,
// GSTR-1 and GSTR-2B JSON by rules (credit notes negative, B2CS by rate and place of supply, ITC not available said).
const fs = require("fs"), path = require("path");
const {load, HTML} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const FX = path.join(__dirname, "fixtures", "sheets");
const NAMES = ["num", "r2", "fpHash", "GST_STATES", "stateOfGstin", "GSTIN_RE", "normName", "Market", "GST2B", "GSTAmend", "SHEET_FIELDS", "SheetFmt"];
const h = load(HTML, NAMES), F = h.x.SheetFmt;
h.ctx.CO = () => ({name: "ZZ Up Client", gstin: "09AANFG3202D1ZR"});
const csv = (n) => F.csv(fs.readFileSync(path.join(FX, n), "utf8"));
const co = h.ctx.CO();

// ---- a CA's own register
const g = csv("purchase_register.csv"), hi = F.head(g), head = g[hi];
ok(hi === 0 && head[0] === "Inv Dt" && head.length === 11, "the header row found (" + head.slice(0, 4) + ")");
const map = {date: "invdt", no: "billno", party: "supplier", gstin: "gstin", doctype: "doctype", taxable: "taxableamt", igst: "igst", cgst: "cgst", sgst: "sgst", total: "total"};
const fmt = {id: "sf1", name: "CA register", side: "purchase", fp: F.fingerprint(head, ""), cols: head.length, map, transforms: {date: "dmy", groupByNo: true}};
const docs = F.apply(fmt, g, hi, co, "purchase");
const by = (no) => docs.find((d) => d.no === no) || {};
ok(docs.length === 4 && docs.skipped.length === 1 && docs.skipped[0].why === "a total row", "4 documents; the total row left out (" + docs.map((d) => d.no) + ")");
ok(by("KIT/101").date === "2026-07-05" && by("KIT/101").taxable === 10000 && by("KIT/101").cgst === 900 && by("KIT/101").total === 11800 && by("KIT/101").check.ok, "Rs. and commas read; 05/07/2026 is 5 July");
const dl = by("DL/77");
ok(dl.lines === 2 && dl.taxable === 30000 && dl.igst === 5400 && dl.total === 35400 && dl.check.ok, "an invoice on two rows is one document: 30,000 + 5,400 = 35,400 (" + JSON.stringify([dl.taxable, dl.igst, dl.total]) + ")");
const cn = by("KIT/CN/4");
ok(cn.note === "credit" && cn.taxable === -1000 && cn.cgst === -90 && cn.total === -1180 && cn.check.ok, "the credit note in brackets is negative: −1,000 − 180 = −1,180");
ok(by("NEW/9").taxable === 2500.5 && by("NEW/9").cgst === 225.05 && by("NEW/9").total === 2950.6 && by("NEW/9").check.ok, "to the paisa: 2,500.50 + 450.10 = 2,950.60");
const sum = (k) => Math.round(docs.reduce((a, d) => a + d[k], 0) * 100) / 100;
ok(sum("taxable") === 41500.5 && sum("total") === 48970.6, "the documents add up to the sheet's own total row: taxable 41,500.50, total 48,970.60 (" + sum("taxable") + ", " + sum("total") + ")");
const bad = F.finish({no: "X", taxable: 100, igst: 18, cgst: 0, sgst: 0, cess: 0, total: 119.5, rates: []});
ok(!bad.check.ok && bad.check.diff === 1.5 && /not the total 119.50/.test(bad.check.text), "a document that does not add up is said, with its figures");
ok(F.finish({no: "Y", taxable: 100, igst: 18, cgst: 0, sgst: 0, cess: 0, total: 118.4, rates: []}).check.roundOff === 0.4, "a round-off up to ₹1 is said as a round-off");

// ---- the format remembered: exact, drift, a real change
h.ctx.S.firm = {sheetFormats: []};
h.ctx.CO = () => ({name: "ZZ Up Client", gstin: "09AANFG3202D1ZR", sheetFormats: [fmt]});
let f1 = F.find(head, "", "c1", "purchase");
ok(f1 && f1.how === "known" && f1.fmt.id === "sf1", "the same sheet again: its saved format, exactly (no AI)");
const gd = csv("purchase_register_drift.csv"), hd = gd[F.head(gd)];
f1 = F.find(hd, "", "c1", "purchase");
ok(f1 && f1.how === "drift", "a column added and one unused renamed: the saved format still reads it, by the columns' names");
const dd = f1 && F.apply(f1.fmt, gd, F.head(gd), co, "purchase");
ok(dd && JSON.stringify(dd.map((d) => [d.no, d.total])) === JSON.stringify(docs.map((d) => [d.no, d.total])), "… with the same documents and figures");
const gc = csv("purchase_register_changed.csv");
ok(F.find(gc[F.head(gc)], "", "c1", "purchase") === null, "the columns renamed (a real change): no format found, so it is asked again");
ok(F.fingerprint(head, "") !== F.fingerprint(hd, "") && F.fingerprint(head, "B2B") !== F.fingerprint(head, "Sheet1"), "the fingerprint: the header names, their count and the sheet's name");

// ---- what the AI would see: the header and 10 rows, masked
const m = F.masked(head, g.slice(1, 40));
const seen = JSON.stringify(m);
ok(m.rows.length === Math.min(10, g.length - 1) && !/AAACK1234A|Kashi|Delhi Legal|Nirmal/.test(seen) && /GSTIN_1/.test(seen) && /TEXT_\d/.test(seen) && /05\/07\/2026/.test(seen) && /11,800.00/.test(seen),
  "the AI is shown the header and at most 10 rows: GSTINs and names masked, dates and amounts as they are");

// ---- one tax column, split by the place of supply
const g2 = [["Date", "No", "Customer", "Customer GSTIN", "Taxable", "GST", "Value"], ["01-07-2026", "S1", "A", "09AAAFR1111R1Z1", "1000", "180", "1180"], ["02-07-2026", "S2", "B", "07AABFD5678B1Z2", "1000", "180", "1180"]];
const one = F.apply({map: {date: "date", no: "no", party: "customer", gstin: "customergstin", taxable: "taxable", tax: "gst", total: "value"}, transforms: {}}, g2, 0, co, "sales");
ok(one[0].cgst === 90 && one[0].sgst === 90 && one[0].igst === 0 && one[1].igst === 180 && one[1].cgst === 0 && one.every((d) => d.check.ok), "one tax column: the same state is CGST + SGST, another IGST");

// ---- the 2B Excel (built-in: no AI) and the Amazon report (built-in)
const b = F.builtin(["GSTIN of supplier", "Trade/Legal name", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"], "purchase");
ok(b && b.builtin === "2b-excel" && b.map.no === "invoicenumber" && b.map.igst === "integratedtax", "GSTR-2B Excel is a format FinCom knows (" + (b && b.name) + ")");
const g2b = [[], ["GSTIN of supplier", "Trade/Legal name", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "Place of supply", "Supply Attract Reverse Charge", "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)"],
  ["07AABFD5678B1Z2", "DELHI LEGAL LLP", "DL/77", "Regular", "06/07/2026", 35400, "Uttar Pradesh", "No", 25000, 4500, 0, 0, 0], ["07AABFD5678B1Z2", "DELHI LEGAL LLP", "DL/77", "Regular", "06/07/2026", 35400, "Uttar Pradesh", "No", 5000, 900, 0, 0, 0]];
const d2b = F.apply(b, g2b, 1, co, "purchase");
ok(d2b.length === 1 && d2b[0].taxable === 30000 && d2b[0].igst === 5400 && d2b[0].total === 35400 && d2b[0].pos === "09" && d2b[0].check.ok, "2B Excel: the invoice value on each of its rows is counted once (35,400), place of supply 09");
const ga = csv("amazon_tax_report.csv"), ba = F.builtin(ga[0], "sales");
const da = ba && F.apply(ba, ga, 0, co, "sales");
ok(ba && ba.builtin === "amazon" && da.length === 3 && da.find((d) => d.no === "AMZ-UP-1").taxable === 1500 && da.find((d) => d.note === "credit").total === -2360, "the Amazon report (built-in): an order on two lines, a refund as a credit note (" + (da || []).map((d) => d.no + " " + d.total) + ")");

// ---- another portal's JSON: its list of records, each flattened to paths (mapped like columns)
const oj = F.fromJson(JSON.parse(fs.readFileSync(path.join(FX, "other_portal.json"), "utf8")));
ok(oj.kind === "grid" && oj.sheet === "json:data.invoices" && oj.grid[0].includes("invoice.no") && oj.grid[0].includes("amounts.gross") && oj.grid.length === 3, "another portal's JSON: its records as rows, its paths as columns (" + oj.grid[0] + ")");
const od = F.apply({map: {no: "invoiceno", date: "invoicedate", party: "buyername", gstin: "buyergstin", taxable: "amountsnet", cgst: "amountscgst", sgst: "amountssgst", total: "amountsgross"}, transforms: {}}, oj.grid, 0, co, "sales");
ok(od.length === 2 && od[1].total === 1416.29 && od[1].check.ok && od[0].date === "2026-07-11", "… read by its mapping, to the paisa (1,200.25 + 216.04 = 1,416.29)");

// ---- GSTR-1 JSON, by rules
const j1 = JSON.parse(fs.readFileSync(path.join(FX, "gstr1.json"), "utf8"));
ok(F.fromJson(j1).kind === "gstr1", "GSTR-1 JSON is known by its keys");
const r1 = F.from1(j1), d1 = (no) => r1.docs.find((d) => d.no === no) || {};
ok(d1("S/101").taxable === 15000 && d1("S/101").cgst === 1200 && d1("S/101").total === 17400 && d1("S/101").check.ok && d1("S/101").gstin === "09AAACK1234A1Z5", "b2b: an invoice of two rates, 15,000 + 2,400 = 17,400");
ok(d1("CN/7").note === "credit" && d1("CN/7").total === -1180 && d1("CN/7").taxable === -1000, "cdnr: the credit note is negative");
ok(d1("CNU/2").note === "credit" && d1("CNU/2").igst === -50 && d1("CNU/2").total === -1050, "cdnur: read here, negative");
ok(d1("EXP/1").total === 50000 && d1("EXP/1").igst === 0, "exp: the export invoice");
ok(!r1.docs.some((d) => /hsn|doc/i.test(d.sec || "")), "hsn and doc are summaries: no entry");
const b2 = r1.b2cs.map((x) => [x.pos, x.rates[0], x.taxable, x.cgst, x.igst, x.total]);
ok(r1.b2cs.length === 2 && JSON.stringify(b2.find((x) => x[0] === "09")) === JSON.stringify(["09", 18, 21000.5, 1890.05, 0, 24780.6]) && b2.find((x) => x[0] === "07")[5] === 4200,
  "b2cs: one summary per rate and place of supply (two 18% rows in 09 added up to the paisa: " + JSON.stringify(b2) + ")");

// ---- GSTR-2B JSON, by rules
const j2 = JSON.parse(fs.readFileSync(path.join(FX, "gstr2b.json"), "utf8"));
ok(F.fromJson(j2).kind === "gstr2b", "GSTR-2B JSON is known by its keys");
const r2b = F.from2b(j2), e2 = (no) => r2b.find((d) => d.no === no) || {};
ok(e2("KIT/101").total === 11800 && e2("KIT/101").date === "2026-07-05" && e2("KIT/101").party === "KASHI IT SOLUTIONS" && e2("KIT/101").itc.available, "b2b: the invoice, ITC available");
ok(e2("KIT/CN/4").note === "credit" && e2("KIT/CN/4").total === -1180 && e2("KIT/CN/4").cgst === -90, "cdnr: the supplier's credit note is negative");
ok(e2("MM/55").itc && e2("MM/55").itc.available === false && /place of supply/.test(e2("MM/55").itc.why), "ITC not available (rsn P) is said on the document");
ok(e2("7654321").igst === 18000 && e2("7654321").taxable === 100000, "impg: the import of goods (bill of entry 7654321)");

console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
