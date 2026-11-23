// node tests/run_gst_carry31.js - (the owner, 23-Nov-2026; independent review of ad4be74c3) a negative 3.1(b), 3.1(c) or
// 3.1(e) is shown nil and its VALUE carried to the same box of the next return; 3.1(b)'s negative TAX (IGST, cess) is not
// carried in the box but set off against its head as negative liability (section 34(2), sections 49 and 49A, rule 88A:
// the portal's Negative Liability Statement nets by head), and no 3B JSON figure is ever negative. All this through the
// app's own wraps of GSTR.threeBm too: the Final credit for 3B (itcFinal.js, on whenever a 2B, a decision or an adjustment
// is there) and the GSTR-1 corrections (gstr1Fix.js). Made-up books only.
//   A. exempt: December 2025 a sale 10,000; January a credit note 25,000 (3.1(c) nil, 25,000 carried); February a sale
//      30,000 (5,000): plain, with an (empty) 2B loaded (itcFinal), and with a GSTR-1 correction of February (-8,000 in
//      table 8: nil, 3,000 carried to March; March 10,000 less 3,000 = 7,000)
//   B. SEZ: December 2025 a supply with payment 20,000 (IGST 3,600); January its credit note (3.1(b) nil, 20,000 carried;
//      IGST -3,600 negative liability, not in the box); February an export under LUT 50,000 and a B2C sale 1,00,000 (IGST
//      18,000): 3.1(b) 30,000 with no tax, 6.1 IGST 18,000 less 3,600 = 14,400 in cash; the JSON never negative
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "normName", "nameSim", "Books", "GSTR", "GST2B", "GST9", "GSTSet", "GSTF", "GSTQ", "ITCT", "CustIMS", "ITCLock", "GSTAdv", "GSTRev", "GSTAmend", "LedMaster", "INR"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const near = (a, c) => Math.abs((a || 0) - c) < 0.01;
const CMP = "07AAKCT5678M1Z9", reg = "07", SZ = "07AABCS3333C1Z3", XC = {taxability: "Exempt"};
const APP = path.join(__dirname, "..", "app", "src", "lib"), strip = (f) => fs.readFileSync(path.join(APP, f), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
// a fresh app each time: wrap "itc" (itcFinal), "r1" (gstr1Fix), both or none
function app(wrap){
  const {ctx, x} = load(HTML, NAMES);
  ctx.S.companies = {t: {id: "t", name: "ZZ TEST", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
  ctx.saveBooks = () => {}; ctx.render = () => {}; ctx.Cloud = {st: {email: "t@zz.test"}};
  if (wrap.includes("itc")) vm.runInContext("globalThis.__sync = (function(){" + strip("itcSync.js") + "\n; return {DECS, DEC_LABEL}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strip("itcFinal.js") + "\n})();", ctx);
  if (wrap.includes("r1")) vm.runInContext("(function(){" + strip("gstr1Fix.js") + "\n})();", ctx);
  return {ctx, x, G: x.GSTR};
}
let k = 0;
const out = (type, date, no, party, gstin, taxable, t, o) => { const tot = taxable + (t.igst || 0) + (t.cgst || 0) + (t.sgst || 0), s = /CREDIT/i.test(type) ? -1 : 1;
  return Object.assign({id: "v" + (++k), type, date, no, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
    ent: [{l: party, a: -s * tot}, {l: "Sales", a: s * taxable}].concat(["igst", "cgst", "sgst"].filter((h) => t[h]).map((h) => ({l: h.toUpperCase(), a: s * t[h]})))}, o || {}); };
function books(A, vs, o){
  const {ctx, x, G} = A, ds = vs.map((v) => v.date).sort();
  const b = {cid: "t", vouchers: vs, meta: {from: "20251201", to: ds[ds.length - 1], gstins: [CMP], bills: 1}, under: {Sales: "Sales Accounts"}, groups: {"Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"},
    gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: (o && o.twoB) ? {[CMP + "|122025"]: {ym: "202512", gstin: CMP, period: "122025", rows: []}} : {}, gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}};
  vs.forEach((v) => { b.under[v.party] = "Sundry Debtors"; if (v.gstin) b.gstins[v.party] = v.gstin; });
  b.map = x.Books.mapLedgers(vs, {});
  ["IGST", "CGST", "SGST"].forEach((t) => { b.map[t] = {n: 0, what: "gst", kind: "gst", tax: t, side: "output", reg, ok: true, byHand: true}; });
  if (o && o.r1) b.r1Fix = o.r1;
  ctx.S.books = b; G._carry = null; x.GST2B._memo = null; return b;
}
const T = (A, ym) => { A.G._carry = null; return A.G.threeB(ym, reg); };
const exempt = () => [out("Sales", "20251210", "X/1", "Harbour Clinic", "", 10000, {}, XC), out("Credit Note", "20260108", "XC/1", "Harbour Clinic", "", 25000, {}, XC),
  out("Sales", "20260210", "X/2", "Harbour Clinic", "", 30000, {}, XC), out("Sales", "20260212", "S/1", "Walk-in Customers", "", 1000, {cgst: 90, sgst: 90}),
  out("Sales", "20260310", "X/3", "Harbour Clinic", "", 10000, {}, XC)];

console.log("== A. exempt: nil and carried, through the app's wraps");
for (const [label, wrap, o] of [["the engine alone", "", {}], ["with a 2B loaded (the Final credit for 3B)", "itc", {twoB: 1}], ["with both wraps, nothing corrected", "itc r1", {twoB: 1}]]) {
  const A = app(wrap); books(A, exempt(), o);
  if (wrap.includes("itc")) ok(!!A.G.threeBm.itcFinal && A.x.GST2B.all2b(reg).length === 1, label + ": itcFinal wraps threeBm, one 2B here");
  const j = T(A, "202601"), f = T(A, "202602");
  ok(near(j.nil.taxable, 0) && j.pay.carry.cls && near(j.pay.carry.cls.nil.taxable, 25000), label + ": January 3.1(c) nil, 25,000 carried (" + j.nil.taxable + ", " + JSON.stringify(j.pay.carry.cls) + ")");
  ok(near(f.nil.taxable, 5000) && !f.pay.carry.cls, label + ": February 30,000 less 25,000 = 5,000 (" + f.nil.taxable + ")");
}
{ // a GSTR-1 correction of February: table 8, -8,000 exempt (the box is worked out again after it: nil, 3,000 carried)
  const r1 = {"07|202602": {cur: {mods: {}, dels: {}, adds: [{id: "c1", t: "nil", f: {sply_ty: "INTRB2C", nil_amt: 0, expt_amt: -8000, ngsup_amt: 0}}]}}};
  const A = app("itc r1"); books(A, exempt(), {twoB: 1, r1});
  ok(!!A.G.threeBm.r1Fix, "gstr1Fix wraps threeBm");
  const f = T(A, "202602"), m = T(A, "202603");
  ok(f.r1Fix && near(f.r1Fix.c.taxable, -8000), "February's GSTR-1 correction: table 8 -8,000 (" + JSON.stringify(f.r1Fix && f.r1Fix.c) + ")");
  ok(near(f.nil.taxable, 0) && f.pay.carry.cls && near(f.pay.carry.cls.nil.taxable, 3000), "February: 30,000 - 8,000 - 25,000 carried: nil, 3,000 carried, never negative (" + f.nil.taxable + ", " + JSON.stringify(f.pay.carry.cls) + ")");
  ok(near(m.nil.taxable, 7000), "March: 10,000 less 3,000 = 7,000 (" + m.nil.taxable + ")");
}

console.log("== B. 3.1(b): the value carried; its tax below nil off 3.1(a)'s head, in the box as in the JSON; what is left a negative liability the CA confirms");
const sez = () => [out("Sales", "20251207", "Z/1", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}), out("Credit Note", "20260112", "ZC/1", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}),
  out("Sales", "20260210", "E/2", "Kelpie Trading GmbH", "", 50000, {}, {country: "Germany"}), out("Sales", "20260212", "S/2", "Walk-in Customers", "", 100000, {igst: 18000})];
// (re-review of bac94a801, N1) what FinCom's 6.1 takes is what the JSON's 3.1 says: 6.1's tax payable per head is 3.1(a) +
// 3.1(b) as the JSON files them; a head still below nil is negative liability, set off a later month only once the CA has
// confirmed the portal's Negative Liability Statement shows it (books.gst3b["<reg>|<month>"].nls)
const agree = (A, t, ym, label) => { A.G._carry = null; const j0 = A.G.threeBJson(ym, reg).sup_details, a = j0.osup_det, z = j0.osup_zero;
  const js = {igst: a.iamt + z.iamt, cgst: a.camt, sgst: a.samt, cess: a.csamt + z.csamt};
  ok(["igst", "cgst", "sgst", "cess"].every((h) => near(t.pay.due[h], js[h])) && !/:-\d/.test(JSON.stringify(j0)), label + ": 6.1's tax payable is the JSON's 3.1(a) + 3.1(b), none negative (" + JSON.stringify(t.pay.due) + " / " + JSON.stringify(js) + ")"); };
const nls = (A, ym) => { A.ctx.S.books.gst3b = Object.assign({}, A.ctx.S.books.gst3b, {[reg + "|" + ym]: {nls: true}}); A.G._carry = null; };
for (const [label, wrap, o] of [["the engine alone", "", {}], ["with a 2B loaded", "itc", {twoB: 1}]]) {
  const A = app(wrap); books(A, sez(), o);
  const d = T(A, "202512"), j = T(A, "202601"), f = T(A, "202602");
  ok(near(d.zero.igst, 3600) && near(d.pay.cash.igst, 3600), label + ": December 3.1(b) IGST 3,600 paid (" + d.pay.cash.igst + ")");
  ok(near(j.zero.taxable, 0) && near(j.zero.igst, 0) && near(j.net.igst, 0) && j.pay.carry.cls && near(j.pay.carry.cls.zero.taxable, 20000), label + ": January 3.1(b) nil, its value 20,000 carried; 3.1(a) IGST nil (" + JSON.stringify(j.zero) + ", " + JSON.stringify(j.pay.carry.cls) + ")");
  ok(j.pay.carry.neg && near(j.pay.carry.neg.igst, 3600) && near(j.pay.cash.igst, 0), label + ": its IGST 3,600 below nil: negative liability of IGST (" + JSON.stringify(j.pay.carry.neg) + ")");
  agree(A, j, "202601", label + ", January");
  ok(near(f.zero.taxable, 30000) && near(f.zero.igst, 0) && !f.pay.negAdj && near(f.pay.cash.igst, 18000) && f.opening.negWait && near(f.opening.negWait.igst, 3600) && f.pay.carry.neg && near(f.pay.carry.neg.igst, 3600),
    label + ": February, not confirmed: 3.1(b) 30,000; IGST 18,000 in cash, the 3,600 waits for the CA (" + JSON.stringify(f.opening) + ", " + f.pay.cash.igst + ")");
  agree(A, f, "202602", label + ", February");
  nls(A, "202602"); const f2 = T(A, "202602");
  ok(f2.pay.negAdj && near(f2.pay.negAdj.igst, 3600) && near(f2.pay.cash.igst, 14400) && !f2.pay.carry.neg, label + ": February, the statement confirmed: 18,000 less 3,600, 14,400 in cash (" + JSON.stringify(f2.pay.negAdj) + ", " + f2.pay.cash.igst + ")");
}
{ // the reviewer's repro: the SEZ credit note in February itself, with an export under LUT and a B2C sale (IGST 18,000)
  const A = app("itc"); books(A, [out("Sales", "20251207", "Z/1", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}), out("Credit Note", "20260205", "ZC/1", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}),
    out("Sales", "20260210", "E/2", "Kelpie Trading GmbH", "", 50000, {}, {country: "Germany"}), out("Sales", "20260212", "S/2", "Walk-in Customers", "", 100000, {igst: 18000})], {twoB: 1});
  const f = T(A, "202602");
  ok(near(f.zero.taxable, 30000) && near(f.zero.igst, 0) && near(f.net.igst, 14400) && near(f.pay.cash.igst, 14400) && !f.pay.carry.neg, "February: 3.1(b) 30,000 with no tax; 3.1(a) IGST 18,000 less the note's 3,600 = 14,400, paid (" + JSON.stringify(f.net) + ", " + f.pay.cash.igst + ")");
  agree(A, f, "202602", "February");
}
{ // a 3.1(b) note's IGST above 3.1(a)'s IGST while 3.1(b)'s value stays positive
  const A = app(""); books(A, [out("Sales", "20251207", "Z/1", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}), out("Credit Note", "20260112", "ZC/1", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}),
    out("Sales", "20260115", "E/3", "Kelpie Trading GmbH", "", 40000, {}, {country: "Germany"}), out("Sales", "20260116", "S/3", "Walk-in Customers", "", 10000, {igst: 1800})]);
  const j = T(A, "202601");
  ok(near(j.zero.taxable, 20000) && near(j.zero.igst, 0) && near(j.net.igst, 0) && near(j.pay.cash.igst, 0) && j.pay.carry.neg && near(j.pay.carry.neg.igst, 1800),
    "January: 3.1(b) 20,000, IGST 0; 3.1(a) IGST 1,800 less 3,600: nil, 1,800 negative liability (" + JSON.stringify(j.net) + ", " + JSON.stringify(j.pay.carry.neg) + ")");
  agree(A, j, "202601", "January");
}
{ // a negative 3.1(a) head alone: nil in the box and the JSON; the rest negative liability, confirmed before it is used
  const A = app(""); books(A, [out("Sales", "20251204", "S/11", "Walk-in Customers", "", 20000, {cgst: 1800, sgst: 1800}), out("Credit Note", "20260120", "CN/11", "Walk-in Customers", "", 50000, {cgst: 4500, sgst: 4500}),
    out("Sales", "20260210", "S/12", "Walk-in Customers", "", 40000, {cgst: 3600, sgst: 3600})]);
  const j = T(A, "202601"), f = T(A, "202602");
  ok(near(j.net.cgst, 0) && near(j.net.taxable, 0) && j.pay.carry.neg && near(j.pay.carry.neg.cgst, 4500), "January: 3.1(a) nil (not -50,000 / -4,500); CGST and SGST 4,500 each negative liability (" + JSON.stringify(j.net) + ", " + JSON.stringify(j.pay.carry.neg) + ")");
  agree(A, j, "202601", "January");
  ok(near(f.pay.cash.cgst, 3600) && !f.pay.negAdj, "February, not confirmed: CGST 3,600 paid in cash (" + f.pay.cash.cgst + ")");
  nls(A, "202602"); const f2 = T(A, "202602");
  ok(near(f2.pay.cash.cgst, 0) && f2.pay.negAdj && near(f2.pay.negAdj.cgst, 3600) && f2.pay.carry.neg && near(f2.pay.carry.neg.cgst, 900), "February, confirmed: 3,600 of the 4,500 adjusted, 900 carried on (" + JSON.stringify(f2.pay.negAdj) + ", " + JSON.stringify(f2.pay.carry.neg) + ")");
}
console.log("== C. what the 3B page says, and the figures behind each box add up");
{ const lib = (A) => { vm.runInContext("globalThis.__nil = (function(){" + strip("gst3bNil.js") + "\n; return {r3bNeeds, r3bCarry}; })(); globalThis.__portal = (function(){" + strip("../screens/gst/portal.js".replace(/^/, "")) + "\n; return {r3bBills}; })();", A.ctx); return {N3: A.ctx.__nil, P: A.ctx.__portal}; };
  const A = app(""); books(A, sez()); const {N3, P} = lib(A), j = T(A, "202601"), w = N3.r3bCarry(j, "202601");
  ok(w.some((s) => /^3\.1\(b\)/.test(s) && s.includes("\u20b920,000 carried to February 2026") && /IGST \u20b93,600 below nil is taken off 3\.1\(a\)'s IGST/.test(s)), "3.1(b): the value carried, the IGST below nil taken off 3.1(a)'s (" + JSON.stringify(w) + ")");
  const x = P.r3bBills("3.1b", "202601", reg, j);
  const xa = P.r3bBills("3.1a", "202601", reg, j);
  ok(xa && !xa.off.length, "3.1(a)'s figure adds up with 3.1(b)'s IGST taken off and the nil floor (" + JSON.stringify(xa && xa.adj.map((a) => a.label + " " + a.igst)) + ", off " + JSON.stringify(xa && xa.off) + ")");
  const nd = N3.r3bNeeds(T(A, "202602"), false);
  ok(nd.some((s) => /Negative Liability Statement/.test(s) && /\u20b93,600/.test(s) && /IGST/.test(s)), "February: Needs you asks the CA to confirm the portal's Negative Liability Statement shows IGST 3,600 (" + JSON.stringify(nd) + ")");
  ok(x && !x.off.length && x.adj.length === 2, "3.1(b)'s figure (nil) is its bills and the two lines: carried on, tax taken off 3.1(a) (" + JSON.stringify(x && x.adj.map((a) => a.label)) + ", off " + JSON.stringify(x && x.off) + ")");
  const B2 = app(""); books(B2, exempt()); const L2 = lib(B2), fb = T(B2, "202602"), jn = T(B2, "202601");
  ok(!L2.P.r3bBills("3.1c", "202601", reg, jn).off.length && !L2.P.r3bBills("3.1c", "202602", reg, fb).off.length, "3.1(c): January's nil and February's 5,000 (25,000 brought in) add up to their bills and lines");
  ok(L2.N3.r3bCarry(fb, "202602").some((s) => /25,000 of credit notes brought from January 2026 taken off here/.test(s)), "February: what was brought in, said");
  const C3 = app(""); books(C3, [out("Sales", "20251210", "X/1", "Harbour Clinic", "", 10000, {}, XC), out("Credit Note", "20260108", "XC/1", "Harbour Clinic", "", 25000, {}, XC), out("Sales", "20260210", "X/2", "Harbour Clinic", "", 5000, {}, XC)]);
  const L3 = lib(C3), f3 = T(C3, "202602"), w3 = L3.N3.r3bCarry(f3, "202602");
  ok(w3.some((s) => /With them the box is below nil: shown as nil, \u20b920,000 carried to March 2026/.test(s)), "February 5,000 of its own, 25,000 brought in: says the carry took it below nil (" + JSON.stringify(w3) + ")");
  ok(L3.N3.r3bNeeds({nil: {taxable: -5000}}, true).some((s) => /filed so/.test(s) && /nothing to change/.test(s)) && L3.N3.r3bNeeds({nil: {taxable: -5000}}, false).some((s) => /work the month out again/.test(s)), "a negative box: a filed 3B is left as filed; one not filed is worked out again");
  ok(L3.N3.r3bCarry(Object.assign({}, f3, {quarter: true}), "202603").some((s) => /this quarter|brought from the quarter before/.test(s) && /the next quarter \(April 2026 to June 2026\)/.test(s)), "a quarterly return: the quarter's words");
}
console.log("== D. the cloud's 3B is not shown for a month a correction kept only here reaches (the GSTR-1 corrections, ITC adjustments)");
{ const A = app(""); books(A, exempt()); vm.runInContext("globalThis.__c3 = (function(){" + strip("../screens/gst/cloud3b.js") + "\n; return {correctedHere}; })();", A.ctx);
  const C = A.ctx.__c3; ok(typeof C.correctedHere === "function" && !C.correctedHere("07", "202602"), "nothing corrected: the cloud's 3B may be shown");
  A.ctx.S.books.r1Fix = {"07|202601": {cur: {mods: {}, dels: {}, adds: [{id: "c1", t: "nil", f: {sply_ty: "INTRB2C", expt_amt: 100}}]}}};
  ok(C.correctedHere("07", "202601") && C.correctedHere("07", "202602") && !C.correctedHere("07", "202512"), "a GSTR-1 correction of January: January and the months after it (the carry) are worked out here");
  A.ctx.S.books.r1Fix = {}; A.ctx.S.books.itcAdj = {a1: {reg: "07", ym: "202602", line: "4A5", head: "igst", amt: 10}};
  ok(C.correctedHere("07", "202602") && !C.correctedHere("07", "202601") && !C.correctedHere("29", "202602"), "an ITC adjustment of February: February on, that registration only");
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
