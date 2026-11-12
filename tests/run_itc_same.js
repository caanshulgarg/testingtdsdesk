// node run_itc_same.js - the ITC side old against new: app/src/lib/itcSync.js and itcFinal.js as on origin/staging-next
// (git show, or ITC_BASE_LIB, a folder with the two files) against the working tree, each in its own copy of the app
// (tests/harness.js), on the same made-up books (Zeta Traders and made-up suppliers) and the same steps (decisions,
// eligibility, notes, the Excel brought back), no month filed. After each step every line's decision in force, credit month
// and amount, and table 4 of GSTR-3B for Apr-Sep 2026 must be identical, except the steps listed in INTENDED (each says
// why it changes). run_gst_share_same.js covers server/_shared/gst3b.js; this covers the ITC wrap on top of it.
const fs = require("fs"), path = require("path"), vm = require("vm"), {execFileSync} = require("child_process");
const {load, HTML} = require("./harness");
const ROOT = path.join(__dirname, "..");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GSTV", "inregRows"];
// the steps whose figures are meant to differ, and why (the review of the filed marks, item 7 / H1)
const INTENDED = {
  "Take now on Alpha (booked Apr, in May's 2B) from April": "Take now goes into the later of the line's 2B month and its bill's month, never before its 2B (was: the month on screen, April)",
  "Excel: Take now on Alpha from April": "the same rule for the Excel brought back",
};
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const src = (which, f) => {
  if (which === "head") return fs.readFileSync(path.join(ROOT, "app", "src", "lib", f), "utf8");
  if (process.env.ITC_BASE_LIB) return fs.readFileSync(path.join(process.env.ITC_BASE_LIB, f), "utf8");
  return execFileSync("git", ["-C", ROOT, "show", (process.env.ITC_BASE_REF || "origin/staging-next") + ":app/src/lib/" + f], {encoding: "utf8"});
};
const strip = (t) => t.replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
const CMP = "09AAACZ1234A1Z5", reg = "09";
const V = (id, date, no, party, gstin, taxable, cgst) => ({id, type: "Purchase", date, no, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
  ent: [{l: "Office Expenses", a: -taxable}, {l: "Input CGST", a: -cgst}, {l: "Input SGST", a: -cgst}, {l: party, a: taxable + 2 * cgst}]});
const GA = "09AABCA1111A1Z1", GB = "09AABCB2222B1Z2", GD = "09AABCD5555E1Z6", GE = "09AABCE6666F1Z7", GO = "09AABCO4444D1Z4", GS = "09AABCS7777G1Z8", GF = "09AABCF8888H1Z9", GH = "09AABCH9999J1Z2";
const vs = [V("a1", "20260405", "A/101", "Alpha Supplies", GA, 10000, 900), V("b1", "20260410", "B/7", "Beta Traders", GB, 20000, 1800),
  V("d1", "20260412", "D/9", "Delta Services", GD, 30000, 2700), V("e1", "20260418", "E/1", "Echo Stores", GE, 5000, 450), V("f1", "20260508", "F/2", "Foxtrot Labs", GF, 8000, 720),
  V("h1", "20260620", "H/4", "Hotel Rooms", GH, 6000, 540),
  {id: "s1", type: "Sales", date: "20260420", no: "S/1", party: "Kilo Retail", gstin: "", pos: "", cmp: CMP, narr: "", hsn: [], ent: [{l: "Kilo Retail", a: -236000}, {l: "Sales", a: 200000}, {l: "CGST", a: 18000}, {l: "SGST", a: 18000}]},
  {id: "s2", type: "Sales", date: "20260520", no: "S/2", party: "Kilo Retail", gstin: "", pos: "", cmp: CMP, narr: "", hsn: [], ent: [{l: "Kilo Retail", a: -118000}, {l: "Sales", a: 100000}, {l: "CGST", a: 9000}, {l: "SGST", a: 9000}]}];
const row = (ym, gstin, party, no, date, taxable, cgst, dir = 1) => ({no, noN: no.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ym, dir, ims: "N", key: ym.slice(4) + ym.slice(0, 4) + "|" + (dir < 0 ? "cdnr" : "b2b") + "|" + gstin + "|" + no + "|" + date,
  pos: reg, rcm: false, sec: dir < 0 ? "cdnr" : "b2b", typ: "R", val: taxable + 2 * cgst, cess: 0, cgst, sgst: cgst, igst: 0, date, gstin, party, itcavl: "Y", taxable});
const TWOB = {[CMP + "|042026"]: {ym: "202604", gstin: CMP, period: "042026", rows: [row("202604", GB, "BETA TRADERS", "B/7", "20260410", 20000, 1800), row("202604", GD, "DELTA SERVICES", "D/9", "20260412", 25000, 2250),
    row("202604", GO, "OMEGA LOGISTICS", "O/5", "20260415", 5000, 450), row("202604", GS, "SIGMA PAPER", "CN/1", "20260416", 1000, 90, -1)]},
  [CMP + "|052026"]: {ym: "202605", gstin: CMP, period: "052026", rows: [row("202605", GA, "ALPHA SUPPLIES", "A/101", "20260405", 10000, 900), row("202605", GF, "FOXTROT LABS", "F/2", "20260508", 8000, 720),
    row("202605", GH, "HOTEL ROOMS", "H/4", "20260520", 6000, 540)]}};
const MONTHS = ["202604", "202605", "202606", "202607", "202608", "202609"];

function world(which) {
  const {ctx, x} = load(HTML, NAMES);
  ctx.S.companies = {t: {id: "t", name: "Zeta Traders", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
  Object.assign(ctx, {saveBooks: () => {}, render: () => {}, toast: () => {}, Cloud: {st: {email: "test@zz.test"}}});
  vm.runInContext("globalThis.__sync = (function(){" + strip(src(which, "itcSync.js")) + "\n; return {DECS, DEC_LABEL}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strip(src(which, "itcFinal.js")) + "\n})();", ctx);
  const b = {cid: "t", vouchers: JSON.parse(JSON.stringify(vs)), meta: {from: "20260401", to: "20260930", gstins: [CMP], bills: 1}, under: {}, groups: {}, gstins: {}, states: {}, challans: [], alloc: {}, certs: [],
    twoBs: JSON.parse(JSON.stringify(TWOB)), gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}};
  ["Alpha Supplies", "Beta Traders", "Delta Services", "Echo Stores", "Foxtrot Labs", "Hotel Rooms"].forEach((p) => { b.under[p] = "Sundry Creditors"; });
  b.under["Kilo Retail"] = "Sundry Debtors"; b.under.Sales = "Sales Accounts"; b.groups = {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"};
  b.map = x.Books.mapLedgers(b.vouchers, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  ["CGST", "SGST"].forEach((t) => { set(t, {what: "gst", kind: "gst", tax: t, side: "output", reg}); set("Input " + t, {what: "gst", kind: "gst", tax: t, side: "input", reg}); });
  ctx.S.books = b; ctx.S.gstReg = reg; x.GSTR._carry = null; x.GST2B._memo = null;
  const ITCF = ctx.ITCF, ITCDec = ctx.ITCDec;
  const line = (no) => ITCF.rows(reg).find((r) => r.no === no || r.bookNo === no);
  const snap = () => {
    x.GSTR._carry = null;
    const lines = ITCF.rows(reg).map((r) => [r.key, r.fixed || "", (r.s && r.s.d) || "", (r.s && r.s.ym) || "", r.e.C || "", JSON.stringify(r.e.amt || {}), r.e.el || ""]).sort();
    const t4 = MONTHS.map((m) => [m, JSON.stringify(ITCF.table4(reg, m).lines)]);
    return {lines, t4};
  };
  return {ctx, x, b, ITCF, ITCDec, line, snap};
}
const STEPS = [
  ["nothing decided", () => {}],
  ["Take in a later month (Jun) on Beta from April", (w) => w.ITCF.decide(reg, [w.line("B/7")], "later", "202606", "202604")],
  ["Take now on Beta from April", (w) => w.ITCF.decide(reg, [w.line("B/7")], "now", "", "202604")],
  ["Take now though not in 2B on Echo from April", (w) => w.ITCF.decide(reg, [w.line("E/1")], "booksnow", "", "202604")],
  ["Follow up on Echo from April", (w) => w.ITCF.decide(reg, [w.line("E/1")], "follow", "", "202604")],
  ["Take now on Echo from May (carried forward)", (w) => w.ITCF.decide(reg, [w.line("E/1")], "now", "", "202605")],
  ["Take now on Omega (only in 2B) from April", (w) => w.ITCF.decide(reg, [w.line("O/5")], "now", "", "202604")],
  ["Take now on Omega from June", (w) => w.ITCF.decide(reg, [w.line("O/5")], "now", "", "202606")],
  ["Book in Tally on Omega", (w) => w.ITCF.decide(reg, [w.line("O/5")], "book", "", "202604")],
  ["Reverse on Sigma's credit note", (w) => w.ITCF.decide(reg, [w.line("CN/1")], "reverse", "", "202604")],
  ["Delta: the books' amount though 2B is lower", (w) => w.ITCF.decide(reg, [w.line("D/9")], "booksnow", "", "202604")],
  ["Delta: ask the supplier to correct", (w) => w.ITCF.decide(reg, [w.line("D/9")], "correct", "", "202604")],
  ["Take now on Alpha (booked Apr, in May's 2B) from April", (w) => w.ITCF.decide(reg, [w.line("A/101")], "now", "", "202604")],
  ["Take now on Alpha from May", (w) => w.ITCF.decide(reg, [w.line("A/101")], "now", "", "202605")],
  ["Take now on Hotel (booked Jun, in May's 2B) from June", (w) => w.ITCF.decide(reg, [w.line("H/4")], "now", "", "202606")],
  ["Foxtrot follow up, then cleared", (w) => { w.ITCF.decide(reg, [w.line("F/2")], "follow", "", "202605"); w.ITCF.decide(reg, [w.line("F/2")], "", "", "202605"); }],
  ["Beta marked ineligible", (w) => w.ITCF.setElig(reg, w.line("B/7"), "ineligible")],
  ["Beta eligible again", (w) => w.ITCF.setElig(reg, w.line("B/7"), "eligible")],
  ["a note on Foxtrot", (w) => w.ITCDec.note(reg, w.line("F/2").key, "asked for the invoice", w.line("F/2").s)],
  ["an old remark newer than a decision, then a note (the decision in force stays)", (w) => {
    const id = reg + "|" + w.line("D/9").key; w.b.itcDec = Object.assign({}, w.b.itcDec); w.b.itcDec[id] = Object.assign({}, w.b.itcDec[id], {at: "2026-01-01T00:00:00.000Z"});
    w.b.reco2b = w.b.reco2b || {}; w.b.reco2b.tag = Object.assign({}, w.b.reco2b.tag, {d1: {tag: "Reverse in 3B", at: "2026-06-01T00:00:00.000Z"}});
    w.x.GST2B._memo = null; w.ITCDec.note(reg, w.line("D/9").key, "see the letter", w.line("D/9").s); }],
  ["eligibility set on a line decided by an old remark", (w) => w.ITCF.setElig(reg, w.line("D/9"), "ineligible")],
  ["Excel: Take now on Omega from April", (w) => { const pv = w.ITCF.preview(reg, "202604", {rows: [{key: w.line("O/5").key, dec: "Take now", takeIn: ""}]}); w.ITCF.applyImport(reg, "202604", pv); }],
  ["Excel: Take now on Alpha from April", (w) => { const pv = w.ITCF.preview(reg, "202604", {rows: [{key: w.line("A/101").key, dec: "Take now", takeIn: ""}]}); w.ITCF.applyImport(reg, "202604", pv); }],
  ["Excel: later month on Foxtrot", (w) => { const pv = w.ITCF.preview(reg, "202605", {rows: [{key: w.line("F/2").key, dec: "Take in a later month", takeIn: "Jul-2026"}]}); w.ITCF.applyImport(reg, "202605", pv); }],
  ["the books basis for the GSTIN", (w) => { w.b.itcBasis = {[reg]: "books"}; w.x.GST2B._memo = null; }],
  ["books basis: Take now on Alpha from April", (w) => w.ITCF.decide(reg, [w.line("A/101")], "now", "", "202604")],
  ["books basis: Take now on Hotel from June", (w) => w.ITCF.decide(reg, [w.line("H/4")], "now", "", "202606")],
];
const old = world("base"), now = world("head");
const diffs = (a, c) => {
  const out = [];
  const la = new Map(a.lines.map((l) => [l[0], l])), lc = new Map(c.lines.map((l) => [l[0], l]));
  new Set([...la.keys(), ...lc.keys()]).forEach((k) => { if (JSON.stringify(la.get(k)) !== JSON.stringify(lc.get(k))) out.push("line " + k + ": " + JSON.stringify(la.get(k)) + " -> " + JSON.stringify(lc.get(k))); });
  a.t4.forEach(([m, t], i) => { if (t !== c.t4[i][1]) out.push("table 4 of " + m + " differs"); });
  return out;
};
let seenIntended = 0;
STEPS.forEach(([name, fn]) => {
  let e1 = "", e2 = "";
  try { fn(old); } catch (e) { e1 = String(e && e.message); }
  try { fn(now); } catch (e) { e2 = String(e && e.message); }
  const d = diffs(old.snap(), now.snap());
  if (INTENDED[name]) { seenIntended++; ok(d.length > 0 && !e1 && !e2, name + ": differs, as intended (" + INTENDED[name] + "): " + d.slice(0, 3).join("; ")); }
  else ok(!d.length && e1 === e2, name + ": identical" + (d.length ? " -- " + d.slice(0, 4).join("; ") : "") + (e1 !== e2 ? " -- errors " + e1 + " / " + e2 : ""));
  // a step that changed something: the old copy takes the new copy's decisions, so later steps compare from the same place
  if (d.length) { old.b.itcDec = JSON.parse(JSON.stringify(now.b.itcDec || {})); }
});
ok(seenIntended === Object.keys(INTENDED).length, "every intended change was seen");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
