// node run_tds_excel.js - a TDS / TCS return as one Excel, down and back (next-tds-excel, 24-Oct-2026; the owner: "prepare
// this type of download and upload return .. in all types of TDS return.. user can add or delete or modify the details";
// "add challan, add deduction, add deductee within this smart excel"; "challan balance should also be there"). The logic
// without the workbook: app/src/lib/tdsXlsx.js (TDSX) and app/src/lib/tdsEdit.js (TDSEdit: its wraps of the rows), loaded
// beside the app's own TDS code (site-test/index.html, or TDSDESK_HTML) on the fixture books (tests/fixtures/books, a year on,
// and the salary sheet as tdsgst_snapshot.LOAD has them). The workbook itself, ExcelJS, openpyxl and LibreOffice:
// run_tds_excel.py.
//   A  26Q Q1 2026-27 (Form 140): the data (sheets, the challans' balance); nothing changed: no change; a rate and TDS, a
//      section, a remark B (no tax) changed, one deduction taken out, a new challan, a new deductee and a new deduction on both,
//      a PAN changed, the deductor's phone: the preview names exactly those; Apply: the return, its rows and the FVU text
//      equal the file; taken-out rows kept in the books; one Undo puts every store back as it was
//   B  refused: a bad PAN, remark B with tax, remark A with no certificate, an unknown key, a date of another quarter, a
//      section of another return, a challan not on the sheet, a new deduction pushing a challan over its balance
//   C  24Q Q1 2026-27 (the salary sheet): a TDS changed, a row taken out, one added; the Form 138 text
//   D  27Q and 27EQ smoke: a deduction from a non-resident and a collection, changed and added; their files
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
const STORES = ["tdsEdits", "tdsAdded", "alloc", "allocFrom", "challans", "chPortions", "panFix", "nrInfo", "panInoperative", "payDetails"];
// each store as JSON with its keys in order (an object's keys put back by Undo may come in another order: the same store)
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = sorted(v[k]); return o; }, {}) : v;
const state = () => { const b = ctx.S.books, o = {}; STORES.forEach((k) => { o[k] = J(sorted(b[k] === undefined ? null : b[k])); }); o.co = J(sorted(ctx.CO().tds26q)); return o; };
const rowsOf = (form, fy, q) => x.TDS.formRows(form).filter((r) => r.fy === fy && r.q === q);
const FIRM = () => x.TDS26Q.firmDetails();
const ddLines = (t) => String(t || "").split("\r\n").filter((l) => l.split("^")[1] === "DD");

// ================================================================ A. 26Q
console.log("A. 26Q Q1 2026-27 (Form 140)");
const FY = "2026-27", Q = "Q1";
let b = books();
b.challans = [{id: "chA", bsr: "0240020", serial: "10001", date: "20260607", tax: 4500, interest: 60, section: "194C", minorHead: "200", from: "upload"},
  {id: "chB", bsr: "0240020", serial: "10002", date: "20260707", tax: 3000, section: "194J", minorHead: "200", from: "upload"}];
let R = rowsOf("26Q", FY, Q);
ok(R.length === 2, "the fixture's 26Q Q1 2026-27: two deductions (" + R.map((r) => r.party + " " + r.tds).join(", ") + ")");
x.TDSCH.tag(R.map((r) => r.id), "chA", {nosave: true}); x.TDSReg.forget();
let d = X.data("26Q", FY, Q);
ok(d.deductions.length === 2 && d.challans.length === 2 && d.deductees.length >= 1 && d.deductor.length > 20, "data: deductions 2, challans 2 (the quarter's and the year's with tax left), deductees, the deductor's " + d.deductor.length + " fields");
const cA = d.challans.find((c) => c.key === "chA");
ok(cA && cA.usedHere === 4000 && cA.usedElse === 0 && cA.label === "0240020/07-06-2026/10001", "a challan: used in this return 4,000, elsewhere 0, its label BSR/dd-mm-yyyy/serial (" + J(cA && [cA.usedHere, cA.usedElse, cA.label]) + ")");
ok(d.deductions.every((r) => r.challan === cA.label) && d.summary.tds === 4000 && d.summary.onch === 4000 && d.summary.gap === 0, "each deduction names its challan by label; summary TDS 4,000, on challans 4,000, gap 0");
ok(J(d.lists.remarks) === J(["A", "B", "C", "T", "Y"]) && d.lists.sections.some(([s]) => s === "194C") && !d.lists.sections.some(([s]) => s === "195" || s === "192" || s === "194IA"), "lists: 26Q's remarks A B C T Y; its sections (194C, not 195, 192 or 194-IA)");
let pv = X.preview("26Q", FY, Q, toX(d));
ok(!pv.fatal && pv.n === 0 && !pv.errors.length, "the file as downloaded: nothing to change, no error (" + J([pv.fatal, pv.n, pv.errors.slice(0, 2)]) + ")");

const s0 = state(), x1 = toX(d), r1 = x1.deductions[0], r2_ = x1.deductions[1];
r1.rate = 1; r1.tds = 1000;                                                        // a rate and its TDS
r2_.section = "194J"; r2_.challan = "0240020/07-07-2026/10002";                   // another section, moved to the 194J challan
x1.deductor.find((y) => y.k === "phone").v = "9899999999";
x1.challans.push({row: 9, key: "", bsr: "0510308", date: "15-06-2026", serial: "00451", section: "94J", minor: "200", tax: 2500, interest: 0, fee: 0, others: 0, ia: 0, fa: 0, oa: 0, mode: "online"});
x1.deductees.push({row: 9, key: "", name: "Zenith Advisors LLP", nameFile: "", pan: "AAAFZ1234Q", status: "", type: "Non-company"});
x1.deductions.push({row: 9, key: "", date: "20-06-2026", credit: "18-06-2026", party: "Zenith Advisors LLP", pan: "", panF: true, section: "194J", rate: 10, paid: 25000, tds: null, tdsF: true, remark: "", cert: "", challan: "0510308/15-06-2026/00451"});
const pan0 = x1.deductees[0].pan; x1.deductees[0].pan = "AAACN1234F";
pv = X.preview("26Q", FY, Q, x1);
const dv = pv.deductions;
ok(!pv.errors.length, "no error (" + J(pv.errors.slice(0, 3)) + ")");
ok(dv.edit.length === 2 && dv.add.length === 1 && dv.out.length === 0 && pv.challans.add.length === 1 && pv.deductees.add.length === 1 && pv.deductees.edit.length === 1 && pv.deductor.length === 1,
  "preview: 2 deductions changed, 1 added, a new challan, a new deductee, a PAN changed, the deductor's phone (" + J([dv.edit.length, dv.add.length, pv.challans.add.length, pv.deductees.add.length, pv.deductees.edit.length, pv.deductor.length]) + ")");
const f1 = dv.edit.find((e) => e.r.id === R[0].id), f2 = dv.edit.find((e) => e.r.id === R[1].id);
ok(f1 && J(f1.fields.map((f) => f.k).sort()) === J(["rate", "tds"]) && f2 && J(f2.fields.map((f) => f.k).sort()) === J(["challan", "section"]), "the first: rate and TDS; the second: section and challan (moved) (" + J([f1 && f1.fields, f2 && f2.fields.map((f) => f.k)]) + ")");
ok(dv.add[0].want.tds === 2500 && dv.add[0].want.ch.add, "the new deduction: TDS worked out as Paid × Rate, 2,500, on the new challan");
ok(pv.balances.find((z) => z.lab === "0510308/15-06-2026/00451").after === 0 && pv.balances.find((z) => z.lab === cA.label).after === 3500 && pv.balances.find((z) => z.serial === undefined && z.lab === "0240020/07-07-2026/10002").after === 1000, "balances as the file has them: the new challan 0 left, the first 3,500, the 194J one 1,000 (" + J(pv.balances) + ")");
ok(pv.after && pv.after.tds === 1000 + R[1].tds + 2500 && J(state()) === J(s0), "the dry run: TDS after " + (pv.after && pv.after.tds) + "; the books put back as they were");
let ap = X.apply(pv, true);
ok(ap.ok && ap.ver === 1, "Apply (" + J(ap) + ")");
R = rowsOf("26Q", FY, Q);
const nr = R.find((r) => r.party === "Zenith Advisors LLP"), cNew = x.TDS.challans().find((c) => c.serial === "00451");
ok(R.length === 3 && nr && nr.pan === "AAAFZ1234Q" && nr.tds === 2500 && cNew && nr.challan === cNew.id && cNew.autoPlace === "", "the new deduction is in the return with the new deductee's PAN, on the new challan (placed by the file, not by itself)");
ok(R.find((r) => r.id === d.deductions[0].key).tds === 1000 && R.find((r) => r.id === d.deductions[1].key).section === "194J" && R.find((r) => r.id === d.deductions[1].key).challan === "chB", "the rate/TDS and the section as in the file; the second on the 194J challan");
ok(R.filter((r) => normName(r.party) === normName(d.deductees[0].key)).every((r) => r.pan === "AAACN1234F") && ctx.CO().tds26q.phone === "9899999999", "the PAN changed for every deduction of the deductee; the deductor's phone");
function normName(s){ return x.normName(s); }
const t1 = x.TDS26Q.build(FY, Q, FIRM(), "26Q");
const dd1 = ddLines(t1.text);
ok(!t1.error && dd1.length === 3 && dd1.some((l) => l.includes("AAAFZ1234Q") && l.includes("2500.00")), "the Form 140 text: the three deductions on their challans, the new one with its PAN and 2,500 (" + (t1.error || dd1.length) + ")");
const d2 = X.data("26Q", FY, Q);
ok(d2.deductions.length === 3 && d2.summary.tds === pv.after.tds && J(d2.deductions.map((r) => r.tds).sort()) === J([1000, R.find((r) => r.id === d.deductions[1].key).tds, 2500].sort()), "downloaded again: the same rows and totals as the file");
// taken out (kept in the books), then Undo
const x2 = toX(d2); x2.deductions = x2.deductions.filter((r) => r.key !== d.deductions[0].key);
pv = X.preview("26Q", FY, Q, x2);
ok(pv.deductions.out.length === 1 && !pv.errors.length, "a row deleted in the Excel: taken out of the return (" + J(pv.errors) + ")");
ap = X.apply(pv, true);
ok(ap.ok && !rowsOf("26Q", FY, Q).some((r) => r.id === d.deductions[0].key) && ctx.S.books.vouchers.some((v) => d.deductions[0].key.startsWith(v.id + "|")) && E.outList().some((o) => o.id === d.deductions[0].key), "Apply: out of the return, still in the books, listed as taken out");
let un = X.undo("26Q", FY, Q);
ok(un.ok && rowsOf("26Q", FY, Q).some((r) => r.id === d.deductions[0].key), "Undo: back in the return");
un = X.undo("26Q", FY, Q);
ok(!un.ok, "only the last upload undone once (" + un.why + ")");
// a fresh upload undone: every store as before
const s1 = state(), x3 = toX(X.data("26Q", FY, Q)); x3.deductions[0].rate = 2; x3.deductions[0].tds = null;
x3.challans.push({row: 12, key: "", bsr: "0510308", date: "16-06-2026", serial: "00452", section: "94C", minor: "200", tax: 100, interest: 0, fee: 0, others: 0, ia: 0, fa: 0, oa: 0, mode: "online"});
pv = X.preview("26Q", FY, Q, x3); ap = X.apply(pv, true);
ok(ap.ok && ap.ver === 3 && J(state()) !== J(s1), "another upload applied (version 3: the versions go on after an Undo)");
un = X.undo("26Q", FY, Q);
const s2 = state(), chs1 = JSON.parse(s1.challans), chs2 = JSON.parse(s2.challans);
ok(un.ok && STORES.filter((k) => k !== "challans").every((k) => s2[k] === s1[k]) && chs2.filter((c) => !c.deleted).length === chs1.length && chs2.find((c) => c.serial === "00452").deleted, "Undo: every store as before the upload; its new challan marked deleted (kept) (" + STORES.filter((k) => s2[k] !== s1[k]).join(",") + ")");

// ================================================================ B. refused
console.log("B. refused");
const xb = toX(X.data("26Q", FY, Q));
xb.deductees[0].pan = "ABC12";
xb.deductions[0].remark = "B";
xb.deductions[1].remark = "A"; xb.deductions[1].cert = "";
xb.deductions.push({row: 20, key: "nope|x", date: "01-05-2026", party: "Ghost", section: "194C", rate: 1, paid: 100, tds: 1, challan: ""});
xb.deductions.push({row: 21, key: "", date: "01-08-2026", party: "Later Co", section: "194C", rate: 1, paid: 100, tds: 1, challan: ""});
xb.deductions.push({row: 22, key: "", date: "02-05-2026", party: "Abroad Inc", section: "195", rate: 20, paid: 100, tds: 20, challan: ""});
xb.deductions.push({row: 23, key: "", date: "03-05-2026", party: "Nowhere", section: "194C", rate: 1, paid: 100, tds: 1, challan: "9999999/01-05-2026/00001"});
xb.deductions.push({row: 24, key: "", date: "04-06-2026", party: "Big Payee", section: "194C", rate: 2, paid: 500000, tds: null, tdsF: true, challan: cA.label});
pv = X.preview("26Q", FY, Q, xb);
const has = (re) => pv.errors.some((e) => re.test(e.words));
ok(has(/PAN “ABC12” is not a PAN/), "a bad PAN refused");
ok(has(/remark B is for a payment with no tax/), "remark B with tax refused");
ok(has(/remark A needs the lower-deduction certificate/), "remark A with no certificate refused");
ok(has(/hidden key is not one of this return/), "an unknown key refused");
ok(has(/dated 01-08-2026, not in Q1 2026-27/), "a date of another quarter refused");
ok(has(/section 195 is filed in 27Q/), "a section of another return refused");
ok(has(/is not on the Challans sheet/), "a challan not on the sheet refused");
ok(has(/over-used: deposited ₹4,500/), "a new deduction pushing a challan over its balance refused (" + J(pv.balances.find((z) => z.lab === cA.label)) + ")");
ok(!X.apply(pv, true).ok, "Apply refused while errors are left");
ok(X.preview("27Q", FY, Q, toX(d)).fatal && X.preview("26Q", FY, "Q2", toX(d)).fatal, "another return's file refused (the form, the quarter)");

// ================================================================ C. 24Q
console.log("C. 24Q Q1 2026-27 (the salary sheet)");
b = books(); b.challans = [{id: "chS", bsr: "0240020", serial: "20001", date: "20260707", tax: 40000, section: "192", minorHead: "200", from: "upload"}];
let S24 = rowsOf("24Q", FY, Q);
x.TDSCH.tag(S24.map((r) => r.id), "chS", {nosave: true}); x.TDSReg.forget(); S24 = rowsOf("24Q", FY, Q);
const t24a = x.TDS24Q_FILE.build(FY, Q, FIRM());
const d24 = X.data("24Q", FY, Q);
ok(S24.length === 6 && d24.deductions.length === 6 && J(d24.lists.remarks) === J(["C"]) && d24.lists.sections.every(([s]) => /^(192|392)/.test(s)), "24Q: the sheet's six salary rows; remark C only; sections 192 (" + S24.length + ")");
const x24 = toX(d24), asha = x24.deductions.find((r) => r.party === "Asha Verma"), ravi = x24.deductions.filter((r) => r.party === "Ravi Menon")[0];
asha.tds = 7000; x24.deductions = x24.deductions.filter((r) => r !== ravi);
x24.deductions.push({row: 30, key: "", date: "30-06-2026", party: "Asha Verma", panF: true, section: "192", rate: "", paid: 10000, tds: 1000, challan: "0240020/07-07-2026/20001"});
pv = X.preview("24Q", FY, Q, x24);
ok(!pv.errors.length && pv.deductions.edit.length === 1 && pv.deductions.out.length === 1 && pv.deductions.add.length === 1, "preview: one TDS changed, one taken out, one added (" + J(pv.errors.slice(0, 2)) + ")");
ap = X.apply(pv, true); S24 = rowsOf("24Q", FY, Q);
const tot24 = Math.round(S24.reduce((a, r) => a + r.tds, 0) * 100) / 100, want24 = Math.round((d24.summary.tds - 6405 + 7000 - (ravi.tds) + 1000) * 100) / 100;
ok(ap.ok && S24.length === 6 && tot24 === want24, "Apply: six rows, TDS " + tot24 + " = " + want24);
const t24 = x.TDS24Q_FILE.build(FY, Q, FIRM()), dd24 = ddLines(t24.text);
ok(!t24.error && dd24.length === 6 && dd24.some((l) => l.includes("7000.00")) && dd24.some((l) => l.includes("1000.00")), "the Form 138 text: six DD lines, the changed and the added (" + (t24.error || dd24.length) + ")");
ok(X.undo("24Q", FY, Q).ok && Math.round(rowsOf("24Q", FY, Q).reduce((a, r) => a + r.tds, 0) * 100) / 100 === d24.summary.tds && x.TDS24Q_FILE.build(FY, Q, FIRM()).text.split("\r\n").filter((l) => l.split("^")[1] === "DD").join() === ddLines(t24a.text).join(), "Undo: 24Q and its text as before");

// ================================================================ D. 27Q and 27EQ
console.log("D. 27Q and 27EQ smoke");
b = books();
b.vouchers.push({id: "nr1", date: "20260512", type: "Journal", no: "NR1", party: "Globex GmbH", ent: [{l: "Globex GmbH", a: 80000}, {l: "TDS 195", a: 20000}, {l: "Fees Abroad", a: -100000}]},
  {id: "tc1", date: "20260515", type: "Sales", no: "S9", party: "Scrapco", ent: [{l: "Scrapco", a: -101000}, {l: "Scrap Sales", a: 100000}, {l: "TCS Scrap", a: 1000}]});
b.map = x.Books.mapLedgers(b.vouchers, {}); b.map["TDS 195"] = Object.assign({}, b.map["TDS 195"], {kind: "tds_payable", what: "tds_payable", section: "195", ok: true});
b.map["TCS Scrap"] = Object.assign({}, b.map["TCS Scrap"], {kind: "tcs_payable", what: "tcs_payable", section: "206C", ok: true});
b.challans = [{id: "chN", bsr: "0240020", serial: "30001", date: "20260607", tax: 30000, section: "195", minorHead: "200", from: "upload"}, {id: "chT", bsr: "0240020", serial: "30002", date: "20260607", tax: 3000, section: "206CE", minorHead: "200", from: "upload"}];
x.TDSReg.forget();
const NR = rowsOf("27Q", FY, Q), TC = rowsOf("27EQ", FY, Q);
ok(NR.length === 1 && TC.length === 1, "a deduction from a non-resident (195) and a collection (206C) (" + NR.length + ", " + TC.length + ")");
const xq = toX(X.data("27Q", FY, Q));
ok(J(X.data("27Q", FY, Q).lists.remarks) === J(["A", "C"]), "27Q's remarks: A, C");
xq.deductions[0].challan = "0240020/07-06-2026/30001"; xq.deductees[0].country = "032 · GERMANY"; xq.deductees[0].dtaa = "Yes"; xq.deductees[0].nature = "27";
xq.deductions.push({row: 9, key: "", date: "20-05-2026", party: "Globex GmbH", panF: true, section: "195", rate: 10, paid: 50000, tds: null, tdsF: true, challan: "0240020/07-06-2026/30001"});
pv = X.preview("27Q", FY, Q, xq);
ok(!pv.errors.length && pv.deductions.add.length === 1 && pv.deductions.edit.length === 1 && pv.deductees.edit.length === 1, "27Q preview: a challan placed, a deduction added, the deductee's country, nature and DTAA (" + J(pv.errors.slice(0, 2)) + ")");
ok(X.apply(pv, true).ok && rowsOf("27Q", FY, Q).length === 2 && rowsOf("27Q", FY, Q).every((r) => r.challan === "chN") && x.TDS26Q.nrInfo("Globex GmbH").dtaa === true, "27Q applied: two deductions on the challan, the DTAA kept");
const tq = x.TDS26Q.build(FY, Q, FIRM(), "27Q");
ok(!tq.error && ddLines(tq.text).length === 2, "the Form 144 text: two DD lines (" + (tq.error || "") + ")");
const xe = toX(X.data("27EQ", FY, Q));
ok(X.data("27EQ", FY, Q).lists.codes.some(([c]) => c === "6CE"), "27EQ: its collection codes listed");
xe.deductions[0].section = "6CE"; xe.deductions[0].challan = "0240020/07-06-2026/30002";
xe.deductions.push({row: 9, key: "", date: "25-05-2026", party: "Scrapco", panF: true, section: "6CE", rate: 1, paid: 50000, tds: null, tdsF: true, challan: "0240020/07-06-2026/30002"});
pv = X.preview("27EQ", FY, Q, xe);
ok(!pv.errors.length && pv.deductions.add.length === 1 && pv.deductions.edit.length === 1, "27EQ preview: the code and challan of one, a collection added (" + J(pv.errors.slice(0, 2)) + ")");
ok(X.apply(pv, true).ok && rowsOf("27EQ", FY, Q).length === 2 && rowsOf("27EQ", FY, Q).every((r) => r.code === "6CE" && r.challan === "chT") && rowsOf("26Q", FY, Q).every((r) => !/^206C/.test(r.section)), "27EQ applied: two collections, code 6CE, on the challan; the added one not in 26Q");
const te = x.TDS26Q.build(FY, Q, FIRM(), "27EQ");
ok(!te.error && ddLines(te.text).length === 2, "the Form 143 text: two DD lines (" + (te.error || "") + ")");

// ================================================================ F. the owner's answers of 24-Oct-2026
console.log("F. Form 121, certificates, challans altered and deleted");
{
  // F1. Form 121 is its own choice from 2026-27 (15G / 15H for earlier years)
  b = books(); b.challans = [{id: "chA", bsr: "0240020", serial: "10001", date: "20260607", tax: 4500, section: "194C", minorHead: "200", from: "upload"}];
  R = rowsOf("26Q", FY, Q); x.TDSCH.tag(R.map((r) => r.id), "chA", {nosave: true}); x.TDSReg.forget();
  ok(x.TDSDecl.set("Nightjar Sound & Light Co", FY, {form: "121", date: "2026-04-10", uin: "ABCDE12345F123456789012345"}).ok && !x.TDSDecl.set("Nightjar Sound & Light Co", "2025-26", {form: "121", date: "2025-04-10"}).ok, "F1. TDSDecl: Form 121 kept for 2026-27, refused for 2025-26");
  x.TDSDecl.set("Nightjar Sound & Light Co", FY, {form: ""});
  let d1 = X.data("26Q", FY, Q), xf = toX(d1);
  ok(J(d1.lists.decl) === J(["121"]) && J(X.data("26Q", "2025-26", "Q4").lists.decl) === J(["15G", "15H"]), "F1. the Excel's list: Form 121 for 2026-27, 15G / 15H for 2025-26");
  xf.deductees[0].decl = "121"; xf.deductees[0].declDate = "10-04-2026"; xf.deductees[0].uin = "ABCDE12345F123456789012345";
  xf.deductions[0].rate = 0; xf.deductions[0].tds = 0; xf.deductions[0].remark = "B";
  pv = X.preview("26Q", FY, Q, xf);
  ok(!pv.errors.length && X.apply(pv, true).ok && x.TDSDecl.of("Nightjar Sound & Light Co", FY).b.form === "121", "F1. a Form 121 given in the Excel: applied, kept as 121 (" + J(pv.errors) + ")");
  const nil = rowsOf("26Q", FY, Q).find((r) => !(r.tds > 0));
  ok(nil && x.TDS26Q.remark(nil, "26Q").remark === "B" && !x.TDSDecl.checks(FY, Q, "26Q").some((c) => c.level === "error"), "F1. its row: remark B, Validate's remark checks pass");
  xf = toX(X.data("26Q", FY, Q)); xf.deductees[0].decl = "15G";
  ok(X.preview("26Q", FY, Q, xf).errors.some((e) => /Form 121/.test(e.words)), "F1. 15G given for 2026-27: refused, Form 121 asked");
  // F2. a certificate number with remark A: into the section 197 list, so the rate question goes
  b = books(); b.challans = [{id: "chA", bsr: "0240020", serial: "10001", date: "20260607", tax: 4500, section: "194C", minorHead: "200", from: "upload"}];
  R = rowsOf("26Q", FY, Q); x.TDSCH.tag(R.map((r) => r.id), "chA", {nosave: true}); x.TDSReg.forget();
  xf = toX(X.data("26Q", FY, Q)); xf.deductees[0].pan = "AAAFN1234C"; xf.deductions[1].remark = "A"; xf.deductions[1].cert = "LDC1234567"; xf.deductions[1].rate = 0.5; xf.deductions[1].tds = null;
  pv = X.preview("26Q", FY, Q, xf);
  ok(!pv.errors.length && pv.certs.length === 1 && pv.certs[0].certNo === "LDC1234567" && pv.certs[0].rate === 0.5 && pv.certs[0].from === "2026-04-01" && pv.certs[0].to === "2027-03-31", "F2. remark A with a certificate no.: the certificate to add (" + J([pv.errors, pv.certs]) + ")");
  ok(X.apply(pv, true).ok && x.Certs.all().some((c) => c.certNo === "LDC1234567" && c.pan === "AAAFN1234C" && c.section === "194C"), "F2. applied: in the client's certificates (PAN, section, rate, the year)");
  const rA = rowsOf("26Q", FY, Q).find((r) => r.id === R[1].id);
  ok(rA && x.Certs.forRow(rA) && x.TDS26Q.remark(rA, "26Q").remark === "A" && !x.Certs.issues(FY, Q).some((i) => i.row.id === rA.id), "F2. the row: covered by the certificate, remark A, no rate question");
  ok(X.undo("26Q", FY, Q).ok && !x.Certs.all().some((c) => c.certNo === "LDC1234567"), "F2. Undo: the certificate gone with the upload");
  // F3. a challan deleted in the Excel; refused while another return uses it
  b = books();
  b.challans = [{id: "chA", bsr: "0240020", serial: "10001", date: "20260607", tax: 4500, section: "194C", minorHead: "200", from: "upload"},
    {id: "chX", bsr: "0240020", serial: "10009", date: "20260610", tax: 20000, section: "194C", minorHead: "200", from: "upload"}];
  R = rowsOf("26Q", FY, Q); x.TDSCH.tag([R[0].id], "chA", {nosave: true}); x.TDSCH.tag([R[1].id], "chX", {nosave: true});
  const sal = rowsOf("24Q", FY, Q)[0]; x.TDSCH.tag([sal.id], "chX", {nosave: true}); x.TDSReg.forget();
  const s3 = state();
  xf = toX(X.data("26Q", FY, Q)); xf.challans = xf.challans.filter((c) => c.key !== "chA");
  pv = X.preview("26Q", FY, Q, xf);
  ok(!pv.errors.length && pv.challans.out.length === 1 && pv.challans.out[0].rows.length === 1 && pv.challans.out[0].rows[0].id === R[0].id, "F3. a challan row deleted: the challan to delete; this return's deduction on it named (" + J(pv.errors) + ")");
  ok(X.apply(pv, true).ok && !x.TDS.challans().some((c) => c.id === "chA") && ctx.S.books.challans.find((c) => c.id === "chA").deleted.reason.startsWith("removed by Excel upload") && !rowsOf("26Q", FY, Q).find((r) => r.id === R[0].id).challan, "F3. applied: deleted in FinCom (kept, marked who/when/why), its deduction on no challan");
  ok(X.undo("26Q", FY, Q).ok && x.TDS.challans().some((c) => c.id === "chA") && rowsOf("26Q", FY, Q).find((r) => r.id === R[0].id).challan === "chA" && J(state()) === J(s3), "F3. Undo: the challan back, its deduction on it again, every store as before (" + Object.keys(s3).filter((k) => state()[k] !== s3[k]).map((k) => k + ": " + s3[k].slice(0, 300) + " => " + state()[k].slice(0, 300)).join(" | ") + ")");
  xf = toX(X.data("26Q", FY, Q)); xf.challans = xf.challans.filter((c) => c.key !== "chX");
  pv = X.preview("26Q", FY, Q, xf);
  ok(pv.errors.some((e) => /used in 24Q 2026-27 Q1 ₹[\d,.]+ — take those off first/.test(e.words)) && !X.apply(pv, true).ok, "F3. a challan another return uses: refused, the return named (" + J(pv.errors.map((e) => e.words)) + ")");
  // F4. any challan field altered, Tally's too; the tax below what is used refused
  xf = toX(X.data("26Q", FY, Q)); xf.challans.find((c) => c.key === "chA").tax = 1000;
  pv = X.preview("26Q", FY, Q, xf);
  ok(pv.errors.some((e) => /over-used/.test(e.words)), "F4. a challan's tax below what this return uses: refused as over-used");
  b.challans.push({id: "tally:V1:k", from: "tally", madeBy: "tally-sync", fromVoucher: "V1", bsr: "0510308", serial: "00077", date: "20260611", tax: 9000, section: "194C", minorHead: "200", tallyWas: {tax: 9000, interest: 0, fee: 0, others: 0, section: "194C"}});
  x.TDSReg.forget();
  xf = toX(X.data("26Q", FY, Q)); const tc = xf.challans.find((c) => c.key === "tally:V1:k");
  tc.tax = 9500; tc.interest = 120;
  pv = X.preview("26Q", FY, Q, xf);
  ok(!pv.errors.length && pv.challans.edit.length === 1 && X.apply(pv, true).ok && x.TDS.challans().find((c) => c.id === "tally:V1:k").tax === 9500, "F4. a challan from Tally altered in the Excel: applied in FinCom (" + J(pv.errors) + ")");
  // F5. deleted: a challan from Tally is not made again by the next Tally sync; one made from a Tally payment is not proposed again
  xf = toX(X.data("26Q", FY, Q)); xf.challans = xf.challans.filter((c) => c.key !== "tally:V1:k");
  pv = X.preview("26Q", FY, Q, xf);
  ok(!pv.errors.length && /Tally is not changed/.test(pv.challans.out[0].words) && X.apply(pv, true).ok, "F5. a challan from Tally deleted: the preview says Tally is not changed (" + J(pv.challans.out.map((o) => o.words)) + ")");
  const fv = x.TDSTally.fromVouchers, lk = x.TDSTally.links;
  x.TDSTally.fromVouchers = () => [{vid: "V1", key: x.TDSCH.chKey({bsr: "0510308", date: "20260611", serial: "00077"}), bsr: "0510308", serial: "00077", date: "20260611", tax: 9000, section: "194C"},
    {vid: "V1", key: x.TDSCH.chKey({bsr: "0510308", date: "20260612", serial: "00078"}), bsr: "0510308", serial: "00078", date: "20260612", tax: 9000, section: "194C"}];
  x.TDSTally.links = () => [];
  const res = x.TDSTally.sync(ctx.S.books);
  x.TDSTally.fromVouchers = fv; x.TDSTally.links = lk;
  ok(!x.TDS.challans().some((c) => c.fromVoucher === "V1") && res.challans === 0 && ctx.S.books.challans.some((c) => c.id === "tally:V1:k" && c.deleted), "F5. the next Tally sync: the challan not made again (the same details or new ones), kept deleted (" + J({made: res.challans}) + ")");
  b.challans.push({id: "chV2", from: "hand", fromVoucher: "V2", bsr: "0510308", serial: "00079", date: "20260613", tax: 700, section: "194C", minorHead: "200"}); x.TDSReg.forget();
  xf = toX(X.data("26Q", FY, Q)); xf.challans = xf.challans.filter((c) => c.key !== "chV2");
  pv = X.preview("26Q", FY, Q, xf);
  ok(!pv.errors.length && X.apply(pv, true).ok && !x.TDSTally.notChallan({vid: "V2", date: "20260613", tax: 700}, x.TDS.challans()), "F5. a challan made from a Tally payment deleted: the payment is not proposed as a challan again");
}

// ================================================================ E. the workbook itself (ExcelJS): written, read back, nothing changed
(async () => {
  console.log("E. the workbook (ExcelJS)");
  // the module compiled in Node's own context with Node's ExcelJS (its streams), the TDSX of the app's context
  const XR = require(path.join(__dirname, "..", "assets", "exceljs.min.js"));
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "src", "screens", "tds", "tdsExcel.js"), "utf8").replace(/^export (const|function|async function) /mg, "$1 ").replace(/^if \(typeof window[^\n]*$/m, "");
  const TX = new Function("G", src.replace("const G = globalThis;", "") + "\n; return {build, read};")({ExcelJS: XR, TDSX: X}), XW = XR, TXR = TX;
  for (const form of ["26Q", "24Q", "27Q", "27EQ"]) {
    const q = form === "24Q" ? "Q4" : Q, fy0 = form === "24Q" ? "2025-26" : FY;
    const dd = X.data(form, fy0, q); let wb, buf; try { wb = await TX.build(XW, dd); } catch (e) { console.log("build failed", e); throw e; } try { buf = Buffer.from(await wb.xlsx.writeBuffer()); } catch (e) { console.log("write failed", e); throw e; }
    if (form === "26Q") fs.writeFileSync(path.join(H.OUT, "tds-excel-26Q.xlsx"), Buffer.from(buf));
    const xr = await TXR.read(buf), pvr = X.preview(form, fy0, q, xr);
    ok(!pvr.fatal && pvr.n === 0 && !pvr.errors.length && xr.deductions.length === dd.deductions.length && xr.challans.length === dd.challans.length,
      form + " " + q + " " + fy0 + ": written (" + Math.round(buf.byteLength / 1024) + " KB), read back: " + xr.deductions.length + " rows, " + xr.challans.length + " challans, nothing to change (" + J([pvr.fatal, pvr.n, pvr.errors.slice(0, 2), pvr.deductions && pvr.deductions.edit.slice(0, 1).map((e) => e.fields), pvr.deductees.edit.map((e) => e.fields), pvr.deductor, pvr.challans]) + ")");
  }
  console.log(fails.length ? "\n" + fails.length + " FAILED" : "\nall ok"); process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("crashed:", e && e.stack || e, typeof e); process.exit(1); });
