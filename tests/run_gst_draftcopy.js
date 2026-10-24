// node run_gst_draftcopy.js - a GSTR-1 JSON downloaded here is a draft until the month is marked filed (owner, 22-Oct-2026,
// Leads Insurance, Apr-2026: "why this is showing when I have not marked any return as filed"). A JSON downloaded before
// the fix of that day counted invoice totals as 0% sales; kept as "filed", it was compared with the books as if filed.
//   1. downloaded, not marked filed: no "books against the return filed", no amendments (9A/9C/10), no filed figures
//   2. marked filed (the date typed here, or the portal's return status, RETTRACK): compared, with the last download made
//      by the filing date
//   3. a JSON brought in from the portal counts at once
//   4. the "Not filed" tick still takes a copy out
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ", "GSTV", "GSTX", "ClosedP", "FC"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } }));
const CMP = "07AAACL1234A1ZH", reg = "07", A = x.GSTAmend, clone = o => JSON.parse(JSON.stringify(o));
ctx.S.companies = {t: {id: "t", name: "Test", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
const V = (id, type, date, no, party, ent, extra) => Object.assign({id, type, date, no, party, gstin: "", pos: "", cmp: CMP, narr: "", ent: ent.map(([l, a, o]) => Object.assign({l, a}, o || {})), hsn: []}, extra || {});
const G = {h: "9971", gr: 18};
const vs = [V("s1", "Sales", "20260410", "LEADS/2627/0002", "Beta", [["Beta", -1085683], ["Sales", 920070, G], ["Output IGST", 165613]], {gstin: "27AABCB2222B1ZI", pos: "Maharashtra"}),
  V("s2", "Sales", "20260415", "LEADS/2627/0003", "Alpha", [["Alpha", -118000], ["Sales", 100000, G], ["Output CGST", 9000], ["Output SGST", 9000]], {gstin: "07AABCA1111A1ZT", pos: "Delhi"}),
  V("s3", "Sales", "20260510", "LEADS/2627/0010", "Alpha", [["Alpha", -11800], ["Sales", 10000, G], ["Output CGST", 900], ["Output SGST", 900]], {gstin: "07AABCA1111A1ZT", pos: "Delhi"})];
const b = {cid: "t", vouchers: vs, meta: {from: "20260401", to: "20260630", gstins: [CMP], bills: 1}, under: {"Sales": "Sales Accounts", "Beta": "Sundry Debtors", "Alpha": "Sundry Debtors"},
  groups: {"Sales Accounts": "Primary", "Sundry Debtors": "Primary"}, gstins: {}, states: {}, challans: [], alloc: {}, certs: []};
b.map = x.Books.mapLedgers(vs, {});
const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
set("Output IGST", {what: "gst", kind: "gst", tax: "IGST", side: "output", reg}); set("Output CGST", {what: "gst", kind: "gst", tax: "CGST", side: "output", reg}); set("Output SGST", {what: "gst", kind: "gst", tax: "SGST", side: "output", reg});
ctx.S.books = b;
const k = CMP + "|042026", markFiled = on => { b.gstFiled = {[reg]: {"202604": {r1: on}}}; }, unmark = () => { b.gstFiled = {}; };

// the copy downloaded before the fix: LEADS/2627/0002 at 20,05,753 taxable, part of it as 0% sales
const good = x.GSTR.toJson("202604", reg, {plain: true}), buggy = clone(good);
const inv = buggy.b2b.find(g => g.ctin === "27AABCB2222B1ZI").inv[0];
ok(inv.inum === "LEADS/2627/0002", "the April JSON has LEADS/2627/0002 (" + inv.inum + ")");
inv.itms = [{num: 1, itm_det: {rt: 0, txval: 1085683, iamt: 0, csamt: 0}}, {num: 2, itm_det: {rt: 18, txval: 920070, iamt: 165613, csamt: 0}}];
A.keep(buggy, "downloaded");
ok(b.filed[k] && b.filed[k].source === "downloaded", "the download is kept");

// 1. not marked filed: a draft, used for nothing filed
ok(A.check("202604", reg) === null, "1. downloaded, not marked filed: no comparison of the books against the return filed");
const p5 = A.pending("202605", reg);
ok(p5.rows.length === 0 && p5.periods.length === 0, "1. no amendments for April in May (" + p5.rows.length + " rows, compared " + p5.periods.join() + ")");
const may = x.GSTR.toJson("202605", reg);
ok(!may.b2ba && !may.b2csa && !may.cdnra, "1. May's JSON carries no 9A, 9C or 10");
ok(A.filed(reg).length === 0 && A.filed(reg, true).length === 1, "1. not a filed copy, still listed (filed(reg, true))");
ok(A.state(reg, "202605").periods.size === 0, "1. no filed figures for April");
ok(A.nextOpen("202603", reg) === "202604", "1. April is still the next GSTR-1 to file");
ok(!A.can1a("202604", reg).filed1, "1. no GSTR-1A for a month not filed");
ok(A.drift().length === 0, "1. no 'changed since filing' warning");
if (x.ClosedP) ok(!x.ClosedP.why({}, b, "20260420", false).some(s => /GSTR-1/.test(s)), "1. an April entry is not held as in a filed return");

// 2. marked filed: compared
markFiled("2026-05-11");
const c = A.check("202604", reg);
ok(c && c.rows.some(r => r.doc.num === "LEADS/2627/0002" && r.changes.some(s => /rate 0\/18% → 18%/.test(s))), "2. marked filed: compared, LEADS/2627/0002 differs (" + (c ? c.rows.map(r => r.changes.join("; ")).join(" | ") : "none") + ")");
ok(c && Math.abs(c.filedTotal - (2005753 + 100000)) < 1, "2. taxable value filed is the download's (" + (c && c.filedTotal) + ")");
ok(A.pending("202605", reg).rows.some(r => r.what === "amend" && r.now.num === "LEADS/2627/0002"), "2. May reports the 9A amendment");
ok(A.filed(reg).length === 1, "2. now a filed copy");
// a new download after filing does not replace it
A.keep(clone(good), "downloaded");
ok(JSON.stringify(b.filed[k].json) === JSON.stringify(buggy), "2. a later download does not replace a copy of a month marked filed");
// the "Not filed" tick takes it out
b.filed[k].notFiled = true;
ok(A.check("202604", reg) === null && A.pending("202605", reg).rows.length === 0, "4. 'Not filed' ticked: not compared");
b.filed[k].notFiled = false;

// 2. several downloads: the last made by the filing date is the one filed
unmark(); b.filed = {};
A.keep(clone(buggy), "downloaded"); b.filed[k].at = "2026-05-08T06:00:00.000Z";
A.keep(clone(good), "downloaded"); b.filed[k].at = "2026-05-20T06:00:00.000Z";
ok(JSON.stringify(b.filed[k].json) === JSON.stringify(good) && (b.filed[k].prev || []).length === 1, "2. a newer download replaces a draft, the earlier one kept behind it");
ok(A.check("202604", reg) === null, "2. neither is filed until the month is marked");
markFiled("2026-05-11");
const c2 = A.check("202604", reg);
ok(c2 && c2.file.at === "2026-05-08T06:00:00.000Z" && c2.rows.length > 0, "2. filed on 11 May: compared with the download of 8 May, not of 20 May (" + (c2 && c2.file.at) + ")");
markFiled("2026-05-25");
const c3 = A.check("202604", reg);
ok(c3 && c3.file.at === "2026-05-20T06:00:00.000Z" && c3.rows.length === 0, "2. filed on 25 May: compared with the download of 20 May");

// 2. the portal's return status (RETTRACK) marks it filed
unmark();
ok(A.check("202604", reg) === null, "2. unmarked again: not compared");
if (x.GSTX && x.GSTV){
  x.GSTX.takePortal(reg, [{rtntype: "GSTR1", ret_prd: "042026", status: "Filed", dof: "11-05-2026", arn: "AA070426000001X"}]);
  const c4 = A.check("202604", reg);
  ok(c4 && c4.file.at === "2026-05-08T06:00:00.000Z", "2. the portal's return status says filed (11-05-2026): compared with the download of 8 May");
}

// 3. a JSON brought in from the portal counts at once
unmark(); b.portalFiled = {}; b.filed = {};
A.keep(clone(buggy), "portal");
const c5 = A.check("202604", reg);
ok(c5 && c5.rows.length > 0 && A.pending("202605", reg).rows.length > 0, "3. a copy brought in from the portal is compared at once, not marked filed");

// Leads Insurance: the old buggy download, not marked filed: nothing shown anywhere
unmark(); b.filed = {};
A.keep(clone(buggy), "downloaded");
ok(A.check("202604", reg) === null && A.pending("202605", reg).rows.length === 0 && A.pending("202606", reg).rows.length === 0 && !x.GSTR.toJson("202605", reg).b2ba,
  "Leads: the buggy April download, not marked filed: no comparison card, no amendments in May or June");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
