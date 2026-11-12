// node run_filed_2b_months.js - GSTLock.twoB (src/js/47) compares only the ITC lines' credit of the filed months (what
// table 4 reads from a 2B); this checks that it gives the same answer as comparing table 4 of every filed month in full
// (GSTLock.tryBooks, GSTR.threeBm before and after), on made-up worlds (Zeta Traders, made-up suppliers): bills matched to
// a later month's 2B, a year-end credit note in the next year's 2B, a 2B document that takes a bill from another month's
// pair (a chain), a document rejected in IMS, amounts that differ; each 2B replaced by one with a document more, one less,
// another amount, the same, and a first 2B for a month that had none
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GSTV", "GSTMark", "GSTLock", "GSTLockMore", "ITCLock", "inregRows"];
let fails = 0, n = 0; const ok = (c, w) => { n++; if (!c) { console.log("  FAIL " + w); fails++; } };
const {ctx, x} = load(HTML, NAMES);
const CMP = "09AAACZ1234A1Z5", reg = "09";
ctx.S.companies = {t: {id: "t", name: "Zeta Traders", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
Object.assign(ctx, {saveBooks: () => {}, render: () => {}, toast: () => {}, auditEvent: () => {}, Cloud: {st: {}}});
const LIB = path.join(__dirname, "..", "app", "src", "lib");
const strip = (f) => fs.readFileSync(path.join(LIB, f), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
vm.runInContext("globalThis.__s=(function(){" + strip("itcSync.js") + ";return {DECS,DEC_LABEL};})();(function(){const {DECS,DEC_LABEL}=globalThis.__s;" + strip("itcFinal.js") + "})();", ctx);
const ITCF = ctx.ITCF, L = x.GSTLock;
const V = (id, date, no, party, gstin, taxable, cgst, type = "Purchase") => ({id, type, date, no, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
  ent: type === "Debit Note" ? [{l: "Office Expenses", a: taxable}, {l: "Input CGST", a: cgst}, {l: "Input SGST", a: cgst}, {l: party, a: -(taxable + 2 * cgst)}]
    : [{l: "Office Expenses", a: -taxable}, {l: "Input CGST", a: -cgst}, {l: "Input SGST", a: -cgst}, {l: party, a: taxable + 2 * cgst}]});
const row = (ym, gstin, party, no, date, taxable, cgst, o = {}) => Object.assign({no, noN: no.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ym, dir: 1, ims: "N", key: ym.slice(4) + ym.slice(0, 4) + "|" + (o.dir < 0 ? "cdnr" : "b2b") + "|" + gstin + "|" + no + "|" + date,
  pos: reg, rcm: false, sec: o.dir < 0 ? "cdnr" : "b2b", typ: "R", val: taxable + 2 * cgst, cess: 0, cgst, sgst: cgst, igst: 0, date, gstin, party, itcavl: "Y", taxable}, o);
const S = {M: "09AABCM4444M1Z4", I: "09AABCI9999I1Z3", A: "09AABCA1111A1Z1", B: "09AABCB2222B1Z2", C: "09AABCC3333C1Z3", D: "09AABCD5555E1Z6", E: "09AABCE6666F1Z7", X: "09AABCX7777X1Z9", R: "09AABCR8888R1Z8"};
const tb = (ym, rows) => ({ym, gstin: CMP, period: ym.slice(4) + ym.slice(0, 4), rows});
// the worlds: vouchers, 2Bs, the months filed
const worlds = {
  "bills matched to a later month's 2B": {
    vs: [V("a1", "20260405", "A/1", "Alpha", S.A, 10000, 900), V("b1", "20260410", "B/7", "Beta", S.B, 20000, 1800), V("c1", "20260502", "C/3", "Gamma", S.C, 4000, 360), V("e1", "20260418", "E/1", "Echo", S.E, 5000, 450)],
    twoBs: [tb("202604", [row("202604", S.B, "BETA", "B/7", "20260410", 20000, 1800)]), tb("202605", [row("202605", S.A, "ALPHA", "A/1", "20260405", 10000, 900), row("202605", S.C, "GAMMA", "C/3", "20260502", 4000, 360)])],
    filed: ["202604", "202605"]},
  "a year-end credit note in the next year's 2B": {
    vs: [V("d1", "20260310", "D/9", "Delta", S.D, 30000, 2700), V("n1", "20260328", "CN/4", "Delta", S.D, 2000, 180, "Debit Note"), V("b1", "20260410", "B/7", "Beta", S.B, 20000, 1800)],
    twoBs: [tb("202603", [row("202603", S.D, "DELTA", "D/9", "20260310", 30000, 2700)]), tb("202604", [row("202604", S.D, "DELTA", "CN/4", "20260328", 2000, 180, {dir: -1}), row("202604", S.B, "BETA", "B/7", "20260410", 20000, 1800)])],
    filed: ["202603", "202604"]},
  "a chain: a 2B document takes a bill from another month's pair": {
    vs: [V("x1", "20260405", "X/1", "Xray", S.X, 10000, 900), V("x2", "20260406", "X/1A", "Xray", S.X, 10000, 900)],
    twoBs: [tb("202604", [row("202604", S.X, "XRAY", "X/1", "20260405", 9000, 810)]), tb("202605", [row("202605", S.X, "XRAY", "X/1A", "20260406", 10000, 900)])],
    filed: ["202604"]},
  "rejected in IMS, amounts that differ": {
    vs: [V("r1", "20260412", "R/5", "Romeo", S.R, 6000, 540), V("d1", "20260412", "D/9", "Delta", S.D, 30000, 2700)],
    twoBs: [tb("202604", [row("202604", S.R, "ROMEO", "R/5", "20260412", 6000, 540, {ims: "R", rej: true}), row("202604", S.D, "DELTA", "D/9", "20260412", 25000, 2250)])],
    filed: ["202604"]},
  "an ISD: a March bill in April's 2B, a 2B-only row of an ISD's GSTIN": {
    vs: [V("m1", "20260310", "M/3", "Mike Supplies", S.M, 10000, 900), V("b1", "20260410", "B/7", "Beta", S.B, 20000, 1800), V("c1", "20260502", "C/3", "Gamma", S.C, 4000, 360)],
    twoBs: [tb("202603", []), tb("202604", [row("202604", S.M, "MIKE", "M/3", "20260310", 10000, 900), row("202604", S.B, "BETA", "B/7", "20260410", 20000, 1800), row("202604", S.I, "ISD HO", "I/1", "20260420", 5000, 450, {sec: "isd"})]),
      tb("202605", [row("202605", S.C, "GAMMA", "C/3", "20260502", 4000, 360)])],
    filed: ["202603", "202604"], ledgers: {"Isd HO": S.I}, then: () => { const r = ITCF.rows(reg).find((z) => z.no === "I/1"); if (r) ITCF.decide(reg, [r], "now", "", "202604"); }},
  "an ISD supplier's credit note: April bill and June note, both filed": {
    vs: [V("d1", "20260412", "D/9", "Delta", S.D, 30000, 2700), V("n1", "20260615", "CN/7", "Delta", S.D, 2000, 180, "Debit Note")],
    twoBs: [tb("202604", [row("202604", S.D, "DELTA", "D/9", "20260412", 30000, 2700)]), tb("202606", [row("202606", S.D, "DELTA", "CN/7", "20260615", 2000, 180, {dir: -1})])],
    filed: ["202604", "202606"]},
  "an ISD supplier's credit note in no 2B": {
    vs: [V("d1", "20260412", "D/9", "Delta", S.D, 30000, 2700), V("n1", "20260615", "CN/7", "Delta", S.D, 2000, 180, "Debit Note")],
    twoBs: [tb("202604", [row("202604", S.D, "DELTA", "D/9", "20260412", 30000, 2700)]), tb("202606", [])],
    filed: ["202604", "202606"]},
  "QRMP April-June: a May bill and a June credit note": {
    vs: [V("d1", "20260512", "D/9", "Delta", S.D, 30000, 2700), V("n1", "20260615", "CN/7", "Delta", S.D, 2000, 180, "Debit Note")],
    twoBs: [tb("202606", [row("202606", S.D, "DELTA", "D/9", "20260512", 30000, 2700), row("202606", S.D, "DELTA", "CN/7", "20260615", 2000, 180, {dir: -1})])],
    filed: ["202606"], gstSet: {[reg]: {filing: [{from: "202604", type: "qrmp"}]}}},
};
function setup(w) {
  const b = {cid: "t", vouchers: JSON.parse(JSON.stringify(w.vs)), meta: {from: "20250401", to: "20260930", gstins: [CMP], bills: 1}, under: {}, groups: {}, gstins: {}, states: {}, challans: [], alloc: {}, certs: [],
    twoBs: {}, gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}, gstSet: JSON.parse(JSON.stringify(w.gstSet || {}))};
  w.twoBs.forEach((t) => { b.twoBs[CMP + "|" + t.period] = JSON.parse(JSON.stringify(t)); });
  b.vouchers.forEach((v) => { b.gstins[v.party] = v.gstin; });
  Object.entries(w.ledgers || {}).forEach(([n, g]) => { b.gstins[n] = g; });
  b.vouchers.forEach((v) => { b.under[v.party] = "Sundry Creditors"; });
  b.groups = {"Sundry Creditors": "Current Liabilities"}; b.map = x.Books.mapLedgers(b.vouchers, {});
  Object.keys(w.ledgers || {}).forEach((n) => { b.map[n] = b.map[n] || {n: 0}; });
  ["CGST", "SGST"].forEach((t) => { b.map["Input " + t] = Object.assign(b.map["Input " + t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "input", reg, ok: true, byHand: true}); });
  ctx.S.books = b; ctx.S.gstReg = reg; x.GSTR._carry = null; x.GST2B._memo = null;
  ITCF.rows(reg); if (w.then) w.then();
  w.filed.forEach((m) => { x.GSTF.rec(m, reg).r3b = "2026-10-20"; });
  ITCF.rows(reg);
  return b;
}
const variants = (w, b) => {
  const out = [];
  Object.values(b.twoBs).forEach((t) => {
    const c = (f) => { const y = JSON.parse(JSON.stringify(t)); f(y); return y; };
    out.push(["the same 2B for " + t.ym, c(() => {})]);
    if (t.rows.length) out.push(["2B for " + t.ym + " without its first document", c((y) => { y.rows.shift(); })]);
    out.push(["2B for " + t.ym + " with a document whose credit is not available (4(D)(2))", c((y) => { y.rows.push(row(t.ym, S.E, "ECHO", "NA/1", t.ym + "15", 3000, 270, {itcavl: "N"})); })]);
    if (t.rows.length) out.push(["2B for " + t.ym + " with its first document's tax lower", c((y) => { y.rows[0].cgst -= 45; y.rows[0].sgst -= 45; y.rows[0].taxable -= 500; })]);
    b.vouchers.forEach((v, i) => { if (i < 3) out.push(["2B for " + t.ym + " with " + v.no + " in it", c((y) => { if (!y.rows.some((r) => r.no === v.no)) y.rows.push(row(t.ym, v.gstin, v.party.toUpperCase(), v.no, v.date, 10000, 900)); })]); });
  });
  ["202605", "202606"].forEach((ym) => { if (!b.twoBs[CMP + "|" + ym.slice(4) + ym.slice(0, 4)]) b.vouchers.slice(0, 2).forEach((v) => out.push(["a first 2B for " + ym + " with " + v.no, tb(ym, [row(ym, v.gstin, v.party.toUpperCase(), v.no, v.date, 10000, 900)])])); });
  return out;
};
let moved = 0;
Object.entries(worlds).forEach(([name, w]) => {
  const b0 = setup(w), vars = variants(w, b0);
  vars.forEach(([what, t]) => {
    const b = setup(w), k = CMP + "|" + t.period, had = k in b.twoBs, old = b.twoBs[k];
    const put = () => { b.twoBs[k] = JSON.parse(JSON.stringify(t)); x.GST2B._memo = null; }, back = () => { if (had) b.twoBs[k] = old; else delete b.twoBs[k]; x.GST2B._memo = null; };
    const full = L.tryBooks([reg], put, back);
    const red = L.twoB(JSON.parse(JSON.stringify(t)));
    back(); ITCF.rows(reg);
    const a = full ? full.months.join(",") : "", c = red ? red.months.join(",") : "";
    if (a) moved++;
    if (process.env.SHOW) console.log("  " + name + " / " + what + ": " + a);
    ok(a === c, name + " / " + what + ": the full compare says [" + a + "], the lines' compare [" + c + "]");
  });
});
// the ISD switch: GSTLock.isdMoves (the ledger's credit by month, nothing worked out again) against table 4 in full
let isdN = 0, isdMoved = 0;
Object.entries(worlds).forEach(([name, w]) => {
  const b0 = setup(w), names = Array.from(new Set(b0.vouchers.map((v) => v.party).concat(Object.keys(w.ledgers || {}))));
  names.forEach((led) => [true, false].forEach((on) => {
    const b = setup(w);
    if (!on) { b.map[led] = Object.assign({}, b.map[led], {isd: {at: "x"}}); b.mapV = (b.mapV || 0) + 1; x.GST2B._memo = null; x.GSTR._carry = null; ITCF.rows(reg); }
    const was = b.map[led], flip = (v) => () => { b.map = Object.assign({}, b.map, {[led]: v}); b.mapV = (b.mapV || 0) + 1; x.GST2B._memo = null; x.GSTR._carry = null; };
    const full = L.tryBooks([reg], flip(Object.assign({}, was, {isd: on ? {at: "x"} : undefined})), flip(was));
    const red = L.isdMoves(led);
    const a = full ? full.months.join(",") : "", c = red ? red.months.join(",") : ""; isdN++; if (a) isdMoved++;
    if (process.env.SHOW) console.log("  ISD " + (on ? "on" : "off") + " " + name + " / " + led + ": " + a);
    ok(a === c, "ISD switch " + (on ? "on" : "off") + ", " + name + " / " + led + ": the full compare says [" + a + "], the ledger's credit [" + c + "]");
  }));
});
console.log("  ISD switch: " + isdN + " cases (" + isdMoved + " moving a filed month)");
ok(isdMoved >= 4, "enough ISD cases move a filed month (" + isdMoved + ")");
console.log("  " + (n - fails) + " of " + n + " cases agree (" + moved + " in which a filed month moves)");
ok(moved >= 5, "enough of the cases move a filed month to mean something (" + moved + ")");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
