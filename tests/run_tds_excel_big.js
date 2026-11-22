// node run_tds_excel_big.js - a TDS return's Excel with more deductions than the fixed 2,000 rows the workbook used to cover
// (review of 22-Nov-2026, track mis-audit): 2,100 made-up deductions of Rs 10,000 / TDS Rs 200 on the fixture books' 26Q
// Q1 2026-27. The workbook (app/src/screens/tds/tdsExcel.js, ExcelJS from assets/) must total every row (Summary, the
// challan's use, the Deductions' subtotals reach the last row), and reading it back must give all 2,100, so the upload
// takes none of them out of the return. TDSX_JS points at another tdsExcel.js (the check before the fix: it fails there).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const H = require("./harness");
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || H.CACHE;
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES", "TDSF25", "Market", "monthName", "TDSAdd", "TDSSep",
  "TDSMatch", "PANCheck", "TDSPanFix", "TDSAuto", "TDS_REMARK", "TDSDecl", "TDSAudit"].concat(H.TM_NAMES);
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const have = NAMES.filter(n => { try { H.load(H.HTML, [n]); return true; } catch (e){ return false; } });
const {ctx, x} = H.load(H.HTML, have);
ctx.window = ctx; ctx.globalThis = ctx;
ctx.S.companies = {t: {id: "t", name: "ZZ TDSGST", tan: "DELZ12345A", pan: "AAGCL4827M", gstin: "07AAGCL4827M1Z3", tds26q: {flat: "12 First Floor", state: "07", pin: "110005", email: "a@b.in", phone: "9811111111", person: "Ravi Kumar", personDesignation: "Partner", personPan: "ABCPK1234K"}}};
ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; let saves = 0; ctx.saveBooks = () => { saves++; return Promise.resolve(); }; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.render = () => {}; ctx.toast = () => {}; ctx.money = (a) => "₹" + a;
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {}; ctx.S.firm = {}; ctx.Store = {saveCompany(){}, saveFirm(){}};
ctx.istToday = () => "20261024"; ctx.D = () => ({parties: {}});
const APP = path.join(__dirname, "..", "app", "src", "lib");
const strip = (f) => fs.readFileSync(path.join(APP, f), "utf8").replace(/^import .*$/mg, "").replace(/^export default .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
vm.runInContext("(function(){" + strip("tdsEdit.js") + "\n})();\n(function(){" + strip("tdsXlsx.js") + "\n})();", ctx);
const X = ctx.TDSX, E = ctx.TDSEdit;
ok(typeof X === "object" && typeof E === "object" && x.TDS.allRowsNow.tdsx && x.TDS.tcsRowsNow.tdsx && x.TDS.salaryRowsNow.tdsx, "TDSX and TDSEdit loaded; TDS's rows wrapped (26Q/27Q, 27EQ, 24Q)");

// the fixture books, a year on, the salary sheet (tdsgst_snapshot.LOAD)
const bk = JSON.parse(fs.readFileSync(process.env.TDSDESK_CACHE, "utf8"));
const on = (d) => { const t = String(d || ""); return /^\d{8}$/.test(t) ? String(+t.slice(0, 4) + 1) + t.slice(4) : t; };
function books(extra){
  const next = bk.vouchers.map((v) => Object.assign({}, v, {id: v.id + "+1y", date: on(v.date)}));
  const b = Object.assign({loading: false, challans: [], alloc: {}}, JSON.parse(J(bk)), {vouchers: bk.vouchers.concat(next), cid: "t"}, extra || {});
  b.salary = [];
  for (let i = 0; i < 24; i++){ const y = 2025 + Math.floor((i + 3) / 12), m = (i + 3) % 12 + 1, d = y + "-" + String(m).padStart(2, "0") + "-28";
    b.salary.push({name: "Asha Verma", pan: "ABCPV1234K", code: "E1", date: d, gross: 95000, exempt: 12000, standard: 6250, profTax: 200, chapter6: 12500, taxable: 64050, tds: 6405, surcharge: 0, cess: 0, regime: "N"});
    b.salary.push({name: "Ravi Menon", pan: "", code: "E2", date: d, gross: 42000, exempt: 4000, standard: 6250, profTax: 200, chapter6: 0, taxable: 31550, tds: 1250 + i, surcharge: 0, cess: 0, regime: "O"}); }
  ctx.S.books = b; b.map = x.Books.mapLedgers(b.vouchers, {}); x.TDSReg.forget(); return b;
}
// the workbook as tdsExcel.read gives it back, made from TDSX.data (dates dd-mm-yyyy, the PAN column a formula)
function toX(d){
  return {meta: Object.assign({}, d.meta), keys: d.meta.keys, name: "test.xlsx", deductor: d.deductor.map((y, i) => ({row: i + 3, k: y.k, v: y.v})),
    challans: d.challans.map((c, i) => ({row: i + 3, key: c.key, bsr: c.bsr, date: X.dmy(c.date), serial: c.serial, section: c.section, minor: c.minor, tax: c.tax, interest: c.interest, fee: c.fee, others: c.others, ia: c.ia, fa: c.fa, oa: c.oa, mode: c.mode})),
    deductions: d.deductions.map((r, i) => ({row: i + 3, key: r.key, date: X.dmy(r.date), credit: X.dmy(r.credit), party: r.party, pan: r.pan, panF: !r.panOwn, section: r.section, rate: r.rate, paid: r.paid, tds: r.tds, tdsF: true, remark: r.remark, cert: r.cert, challan: r.challan})),
    deductees: d.deductees.map((p, i) => Object.assign({row: i + 3}, p)), salary: (d.salary || []).map((s, i) => Object.assign({row: i + 3, key: s.key}, s.v)), summary: null};
}

const XL = process.env.TDSX_JS || path.join(__dirname, "..", "app", "src", "screens", "tds", "tdsExcel.js");
// ExcelJS and the workbook's code in a context of their own (the harness's context shares the host's Array, which ExcelJS's
// array checks do not take); the return's data goes in as plain JSON
const cx = vm.createContext({console, setTimeout, clearTimeout, setImmediate, clearImmediate, queueMicrotask, TextEncoder, TextDecoder});
cx.globalThis = cx; cx.self = cx; cx.TDSX = X;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "exceljs.min.js"), "utf8"), cx);
const T = {}; cx.__T = T;
vm.runInContext("(function(T){" + fs.readFileSync(XL, "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ") + "\nT.build = build; T.read = read; })(__T)", cx);
(async () => {
  const b = books(); b.challans = [{id: "chBig", bsr: "0240020", serial: "40001", date: "20260607", tax: 420000, section: "194C", minorHead: "200", from: "upload"}];
  const d = X.data("26Q", "2026-27", "Q1");
  ok(d && d.deductions && d.deductions.length > 0 && d.challans.length > 0, "the return's data: " + (d.deductions || []).length + " deductions, " + (d.challans || []).length + " challans");
  const r0 = d.deductions[0], ch = d.challans[0];
  d.deductions = Array.from({length: 2100}, (_, i) => Object.assign({}, r0, {key: "big" + i, party: "Made-up Contractor " + String(i).padStart(4, "0"), paid: 10000, tds: 200, rate: 2, challan: ch.label || r0.challan}));
  const wb = await T.build(cx.ExcelJS, vm.runInContext("JSON.parse", cx)(JSON.stringify(d)), {});
  const wx = wb.getWorksheet("Deductions"), sum = wb.getWorksheet("Summary");
  const f1 = String((wx.getCell("A1").value || {}).formula || "") + " " + JSON.stringify(wx.getRow(1).values);
  const lastRef = Math.max(0, ...(f1.match(/\d+(?=\))/g) || ["0"]).map(Number));
  ok(lastRef >= 2102, "the Deductions' subtotals reach row " + lastRef + " (2,100 rows from row 3 end at 2102)");
  // the Summary's lines (count, amount paid, TDS, TDS on challans): each formula's last row
  let sumMax = Infinity; [3, 4, 5, 6].forEach(r => { const f = String((sum.getRow(r).getCell(3).value || {}).formula || ""); const m = (f.match(/\$(\d+)\)/) || [])[1]; sumMax = Math.min(sumMax, m ? +m : 0); });
  ok(sumMax >= 2102, "the Summary's count, amount, TDS and TDS on challans reach row " + sumMax);
  const wc = wb.getWorksheet("Challans"); let chMax = 0;
  wc.eachRow(r => r.eachCell(c => { const f = c.value && c.value.formula; if (f && /SUMIF/.test(f)) (f.match(/\$(\d+)/g) || []).forEach(m => { chMax = Math.max(chMax, +m.slice(1)); }); }));
  ok(chMax >= 2102, "a challan's use in this return sums to row " + chMax);
  const buf = await wb.xlsx.writeBuffer();
  const back = await T.read({arrayBuffer: async () => (buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf)});
  const n = (back.deductions || []).filter(y => /^big/.test(y.key || "")).length;
  ok(n === 2100, "read back: all 2,100 deductions (got " + n + "), so none is taken out of the return on upload");
  console.log(fails.length ? fails.length + " FAILED" : "all passed");
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
