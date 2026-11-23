// node run_gst9_excel.js - the GSTR-9C working's Excel (gst9Excel, src/js/08-gstr-9-and-gstr-9c.js) writes its derived lines
// as formulas on the lines above (review of 22-Nov-2026, track mis-audit): 5O (5A with the adjustments), 5Q (5O - 5P), 7E,
// 7G, 12D and 12F, so a corrected 5A moves them; GSTR-9's Table 14 has its figures as numbers. Made-up figures; the
// working (GST9C.build, GST9.build) is a stand-in, the Excel is the site's SheetJS (assets/xlsx.js).
// TDSDESK_HTML points at another build (the check before a fix: it fails there).
const fs = require("fs"), path = require("path"), vm = require("vm"), {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "gst9Excel"]);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
Object.assign(ctx, {globalThis: ctx, self: ctx, Uint8Array, ArrayBuffer, TextEncoder}); vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "xlsx.js"), "utf8"), ctx);
let saved = null; Object.assign(ctx, {ensureXlsx: async () => {}, saveFile: (n, b) => { saved = b; }, Blob: class { constructor(p){ this.p = p; } }, CO: () => ({name: "Made-up Co"}),
  GSTR: {gstins: () => ["07AAACM0000A1Z5"], months: () => ["202603"]}});
ctx.S.books = {}; ctx.S.gstReg = "07"; ctx.S.gstYm = "202603";
const ADJ = [["5B", "Unbilled revenue at the beginning of the year", 1], ["5C", "Unadjusted advances at the end of the year", 1], ["5H", "Unbilled revenue at the end of the year", -1]];
const adj = {"5B": 10000, "5C": 5000, "5H": 2000};
ctx.GST9C = {ADJ, build: () => ({a5: 1000000, adjOf: k => adj[k] || 0, o5: 1013000, p5: 1010000, q5: 3000, st: {reasons: {}, adj: {"12B": 100, "12C": 50}}, exempt: 20000, zero: 30000, rcm: 0, e7: 963000, f7: 960000, g7: 3000,
  rates: [], itcBooks: 90000, d12: 90050, e12: 90000, f12: 50})};
ctx.GST9 = {fyOf: () => "2025", ROWS: [], Z: () => ({}), TYPED: [], build: () => ({T: {"14": {payable: 1234.5, paid: 1000}}, pay: {igst: {due: 0, cash: 0}, cgst: {due: 0, cash: 0}, sgst: {due: 0, cash: 0}, cess: {due: 0, cash: 0}}, part6: {}, hsnOut: [], hsnIn: []})};
(async () => {
  await x.gst9Excel("9C");
  const wb = ctx.XLSX.read(saved.p[0], {type: "array"}), ws = wb.Sheets["GSTR-9C"], rowOf = k => { for (let r = 1; r < 60; r++) if (ws["A" + r] && ws["A" + r].v === k) return r; return 0; };
  const C = k => ws["C" + rowOf(k)] || {};
  ["5O", "5Q", "7A", "7E", "7G", "12D", "12F"].forEach(k => ok(!!C(k).f, k + " is a formula" + (C(k).f ? ": =" + C(k).f : " (a fixed " + C(k).v + ")")));
  // worked out from the cells: 5A corrected to 11,00,000 moves 5O and 5Q
  const val = (ref, over) => { const c = ws[ref] || {}; if (over && over[ref] != null) return over[ref]; if (!c.f) return +c.v || 0; return Function("return " + c.f.replace(/[A-Z]+\d+/g, m => "(" + val(m, over) + ")"))(); };
  const a5 = "C" + rowOf("5A"), over = {[a5]: 1100000};
  ok(C("5O").f && Math.abs(val("C" + rowOf("5O"), over) - 1113000) < 0.01 && Math.abs(val("C" + rowOf("5Q"), over) - 103000) < 0.01, "5A corrected to 11,00,000: 5O becomes 11,13,000 and 5Q 1,03,000");
  ok(C("5O").f && Math.abs(val("C" + rowOf("5O")) - 1013000) < 0.01 && Math.abs(val("C" + rowOf("12F")) - 50) < 0.01, "as written, the formulas give the working's own figures (5O 10,13,000, 12F 50)");
  saved = null; await x.gst9Excel("9");
  const w9 = ctx.XLSX.read(saved.p[0], {type: "array"}).Sheets["GSTR-9"]; let r14 = 0; for (let r = 1; r < 60; r++) if (w9["A" + r] && w9["A" + r].v === "14" && w9["C" + r] && w9["C" + r].t === "n") r14 = r;
  ok(r14 && w9["C" + r14].v === 1234.5 && w9["D" + r14].v === 1000, "GSTR-9 Table 14: payable 1,234.50 and paid 1,000 as numbers");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
