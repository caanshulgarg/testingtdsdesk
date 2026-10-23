// node run_tds_autoplace.js - "Place automatically" and the remarks B, T, Y (next-tds-autoplace, the owner's approval of
// 23-Oct-2026 of sections C and D of the TDS check of 22-Oct-2026). On the app's own code (site-test/index.html, or
// TDSDESK_HTML):
//   P  the rules R1-R9 (server/_shared/tdsmatch.js tmPlan) on made-up deductions and challans: each rule hit once, the
//      automatic ones (R1-R5, only when certain) apart from the suggested ones (R6-R8, R5 with something left over, R2/R3
//      paid late), a near-miss not placed (₹1.50 over the month's total, two parties fitting one challan, two sets adding
//      up), ±₹1, a later month's own challan refused, a challan dated before a deduction never automatic, never over a
//      challan's tax
//   B  on books (TDSAuto, src/js/93): the run places only the automatic ones (N placed · M suggested · K need a challan),
//      each with its rule and reason in the trail; a return marked filed untouched; Undo restores exactly the allocation
//      before; a deduction a person took off stays off; the run again after Undo places them again
//   T  10,000 deductions: the rules and a run on books, timed
//   K  the remarks (TDSDecl, src/js/94): T from the deductee's transporter declaration (194C, PAN), B from a 15G/15H (Form
//      121) entry with its UIN in Form 140's DD field 31, Y from the limits FinCom already works out (TDSWatch), a nil
//      challan when a quarter has only nil rows; in the FVU text lines of FY 2025-26 (26Q) and FY 2026-27 (Form 140), and
//      in the Excel working; Validate & file's messages (B without its declaration, T without a PAN, Y above the limit)
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML, TM_NAMES} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES", "TDSF25", "Market", "monthName", "TDSAdd", "TDSEdit", "TDSSep",
  "TDSMatch", "PANCheck", "TDSPanFix", "TDSAuto", "TDS_REMARK", "TDSDecl", "TDSAudit"].concat(TM_NAMES);
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
["tmPlan", "tmPartyRule", "tmSubsetRule", "TM_CODES", "TDSAuto", "TDSDecl"].forEach(n => ok(have.includes(n), "the app has " + n));
if (!["tmPlan", "TDSAuto", "TDSDecl"].every(n => have.includes(n))){ console.log("\nFAILED: " + fails.length); process.exit(1); }
const {ctx, x} = load(HTML, have);
ctx.S.companies = {t: {id: "t", name: "Co", tan: "DELZ12345A", pan: "AAGCZ1234M"}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {}; ctx.money = (a) => "₹" + a;
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {}; ctx.S.firm = {};
ctx.istToday = () => "20261023";

// ---------------------------------------------------------------- P. the rules, R1 to R9
const FY = "2026-27", Q = "Q2", OPT = {fy: FY, q: Q, today: "20261023"};
const R = (id, sec, date, tds, party) => ({id, sec, date, tds, party: party || "P " + id, pan: "ABCPA1234A", fy: FY, q: Q});
const C = (id, sec, date, bal) => ({id, sec, date, minor: "200", bal, fy: x.tmFyOf(date), label: id});
const rows = [
  R("q1", "194Q", "20260703", 100), R("q2", "194Q", "20260705", 200),                                         // R1: Tally links them to CT
  R("c1", "194C", "20260710", 1000), R("c2", "194C", "20260712", 1200.4),                                      // R2: ₹2,200.40, challan ₹2,201 (within ₹1)
  R("h1", "194H", "20260711", 500), R("h2", "194H", "20260714", 499),                                          // near-miss: ₹999, challan ₹1,000.50
  R("dd1", "194D", "20260716", 800),                                                                            // R2 paid late: suggested
  R("j1", "194J", "20260710", 300), R("j2", "194J", "20260810", 400), R("j3", "194J", "20260910", 500),        // R3: the quarter ₹1,200
  R("i1", "194I", "20260801", 5000, "Landlord A"), R("i2", "194I", "20260801", 7000, "Landlord B"), R("i3", "194I", "20260815", 3000, "Landlord A"),   // R4: only B's ₹7,000
  R("a1", "194A", "20260805", 600, "Bank X"), R("a2", "194A", "20260806", 600, "Bank Y"),                     // two parties, two sets: not certain
  R("s1", "194T", "20260902", 100), R("s2", "194T", "20260903", 250), R("s3", "194T", "20260904", 400),        // R5 twice, nothing left over: automatic
  R("g1", "194G", "20260902", 100), R("g2", "194G", "20260903", 250), R("g3", "194G", "20260904", 400),        // R5 with g1 left over: suggested
  R("k1", "194K", "20260802", 300), R("k2", "194K", "20260803", 300), R("k3", "194K", "20260804", 300),        // R6: filled oldest first
  R("e1", "194EE", "20260710", 400),                                                                            // R7: a later challan, interest due
  R("n1", "194N", "20260920", 200),                                                                             // R8: an advance challan
  R("w1", "194R", "20260810", 1000), R("w2", "194R", "20260910", 1000),                                        // September's own challan never August's
];
const chs = [C("CT", "194Q", "20260807", 500), C("CB", "194C", "20260805", 2201), C("CHN", "194H", "20260807", 1000.5), C("CD", "194D", "20260820", 800),
  C("CJ", "194J", "20261007", 1200), C("CI", "194I", "20260907", 7000), C("CA", "194A", "20260906", 600), C("CS", "194T", "20261005", 650), C("CS2", "194T", "20261006", 100),
  C("CG", "194G", "20261005", 650), C("CK", "194K", "20260907", 700), C("CE", "194EE", "20260915", 500), C("CN", "194N", "20260905", 1000), C("CW", "194R", "20261007", 1000)];
const P1 = x.tmPlan(rows, chs, Object.assign({links: {CT: ["q1", "q2"]}}, OPT));
console.log(P1.map(s => "    " + s.code + (s.auto ? " auto " : " sugg ") + s.rule + " " + s.chId + " [" + s.ids.join(",") + "] " + s.reason + (s.warn ? " ! " + s.warn : "")).join("\n"));
const on = (ch) => P1.filter(s => s.chId === ch), one = (ch) => on(ch)[0] || {};
const is = (ch, code, auto, ids) => { const s = one(ch); return on(ch).length === 1 && s.code === code && !!s.auto === auto && J(s.ids) === J(ids); };
ok(x.TM_CODES && Object.keys(x.TM_CODES).join(",") === "R1,R2,R3,R4,R5,R6,R7,R8,R9", "P. the nine rules named: " + Object.keys(x.TM_CODES || {}).join(","));
ok(is("CT", "R1", true, ["q1", "q2"]), "P.R1 Tally's own link: q1, q2 on CT, automatic");
ok(is("CB", "R2", true, ["c1", "c2"]) && /₹2,200\.4/.test(one("CB").reason), "P.R2 the section's month total ₹2,200.40 = challan ₹2,201 (±₹1), paid by the due date: automatic (" + one("CB").reason + ")");
ok(!on("CHN").some(s => s.auto) && !on("CHN").some(s => s.code === "R2"), "P.R2 near-miss: ₹999 against a challan of ₹1,000.50 (₹1.50 over) is not R2 and not placed (" + J(on("CHN").map(s => s.code)) + ")");
ok(is("CD", "R2", false, ["dd1"]) && /interest/.test(one("CD").warn), "P.R2 the exact amount paid after the due date: suggested, interest said (" + one("CD").warn + ")");
ok(is("CJ", "R3", true, ["j1", "j2", "j3"]), "P.R3 the section's quarter ₹1,200 = challan: automatic");
ok(is("CI", "R4", true, ["i2"]) && /Landlord B/.test(one("CI").reason), "P.R4 one party's month total = challan, only Landlord B fits: automatic (" + one("CI").reason + ")");
ok(!on("CA").some(s => s.auto) && !on("CA").some(s => ["R4", "R5"].includes(s.code)), "P.R4/R5 near-miss: two parties (and two sets) fit ₹600: not automatic (" + J(on("CA").map(s => s.code + ":" + s.ids)) + ")");
ok(is("CS", "R5", true, ["s2", "s3"]) && is("CS2", "R4", true, ["s1"]), "P.R5 exactly one set adds up to the challan, nothing of 194T September left over (s1 went on CS2 by R4, the stronger rule): automatic (" + J(on("CS").concat(on("CS2")).map(s => s.code + (s.auto ? "+" : "-") + s.ids)) + ")");
ok(is("CG", "R5", false, ["g2", "g3"]), "P.R5 the one set adds up, but g1 is left over: suggested (" + J(on("CG").map(s => s.code + (s.auto ? "+" : "-"))) + ")");
ok(is("CK", "R6", false, ["k1", "k2"]), "P.R6 the month's challan filled oldest first: suggested");
ok(is("CE", "R7", false, ["e1"]) && /interest/.test(one("CE").warn), "P.R7 a later challan with the interest due: suggested (" + one("CE").warn + ")");
ok(is("CN", "R8", false, ["n1"]) && /advance/.test(one("CN").reason), "P.R8 an advance challan of the same year: suggested (" + one("CN").reason + ")");
ok(is("CW", "R2", true, ["w2"]) && !P1.some(s => s.ids.includes("w1")), "P. September's own challan is never August's: w2 on CW, w1 left for a challan of its own");
ok(P1.filter(s => s.auto).every(s => s.ids.every(id => rows.find(r => r.id === id).date <= chs.find(c => c.id === s.chId).date)), "P. no automatic placing on a challan dated before the deduction");
const used = {}; P1.forEach(s => (s.parts || [{chId: s.chId, paise: s.total}]).forEach(p => { used[p.chId] = (used[p.chId] || 0) + p.paise; }));
ok(chs.every(c => (used[c.id] || 0) <= Math.round(c.bal * 100)), "P. never over a challan's tax");
const all = [].concat(...P1.map(s => s.ids)); ok(new Set(all).size === all.length, "P. each deduction in one placing only");
ok(J(x.tmPlan(rows.slice().reverse(), chs.slice().reverse(), Object.assign({links: {CT: ["q1", "q2"]}}, OPT)).map(s => [s.key, s.code, s.auto]).sort()) === J(P1.map(s => [s.key, s.code, s.auto]).sort()), "P. the same answer in any order of the inputs");
ok(P1.every(s => s.code && x.TM_CODES[s.code] || s.rule === "split"), "P. every placing carries its rule (R1-R9) and a reason");
// ±₹1 exactly: ₹1.00 over is the same, ₹1.01 over is not
const pm = (bal) => x.tmPlan([R("m1", "194C", "20260710", 500)], [C("CM", "194C", "20260805", bal)], OPT)[0] || {};
ok(pm(501).code === "R2" && pm(501).auto && pm(501.01).code !== "R2", "P. ±₹1: ₹1.00 over is R2, ₹1.01 over is not (" + pm(501.01).code + ")");
// R9: the AI's pairings only ever suggested
ok(x.tmCodeOf({rule: "g", ids: [], chId: "x"}, {}, {}, []).code === "R9" && !x.tmCodeOf({rule: "g", ids: [], chId: "x"}, {}, {}, []).auto, "P.R9 the AI's pairings: suggested only");

// ---------------------------------------------------------------- B. on books: the run, its result, Undo, a filed return
const V = (id, date, party, exp, tds, led) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: exp - tds}, {l: led, a: tds}, {l: "Exp " + led, a: -exp}]});
const MAP = {"TDS 194C": {kind: "tds_payable", section: "194C"}, "TDS 194J": {kind: "tds_payable", section: "194J"}, "TDS 194A": {kind: "tds_payable", section: "194A"}, "Bank": {kind: "bank"}};
function books(vs, chs2, extra){
  const b = Object.assign({cid: "t", vouchers: vs, map: JSON.parse(J(MAP)), challans: chs2, alloc: {}, certs: [], pans: {"Alpha Ltd": "AAACA1234A", "Beta": "ABCPB1234B", "Gamma": "ABCPG1234G"}, nrInfo: {}}, extra || {});
  ctx.S.books = b; ctx.S.tdsFy = FY; ctx.S.tdsQ = Q; x.TDSReg.forget && x.TDSReg.forget(); return b;
}
const CH = (id, date, tax, section) => ({id, bsr: "0240020", serial: String(10 + id.length * 7 + id.charCodeAt(id.length - 1)).padStart(5, "0"), date, tax, interest: 0, section, minorHead: "200"});
const vs = [V("v1", "20260710", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("v2", "20260720", "Beta", 50000, 1000, "TDS 194C"), V("v3", "20260812", "Gamma", 100000, 10000, "TDS 194J"),
  V("v4", "20260905", "Alpha Ltd", 30000, 600, "TDS 194C"), V("v5", "20260906", "Beta", 30000, 600, "TDS 194C")];
let b = books(vs, [CH("chC", "20260807", 3000, "194C"), CH("chJ", "20260905", 9000, "194J"), CH("chS", "20261007", 600, "194C")]);
const before = J(b.alloc);
let res = x.TDSAuto.run("26Q", FY, Q);
ok(res.ok && res.placed === 2 && res.suggested === 1 && res.need === 2, "B. the run: 2 placed · 1 suggested · 2 need a challan (" + J({placed: res.placed, suggested: res.suggested, need: res.need, why: res.why}) + ")");
ok(x.TDSAuto.words(res) === "2 placed · 1 suggested · 2 need a challan", "B. the one result line: " + x.TDSAuto.words(res));
ok(b.alloc["v1|TDS 194C"] === "chC" && b.alloc["v2|TDS 194C"] === "chC" && !b.alloc["v4|TDS 194C"] && !b.alloc["v3|TDS 194J"], "B. only the automatic ones placed (R2 on chC); the R6 suggestion and the rest left");
const lg = (b.allocLog || []).filter(l => l.act === "auto" && l.row === "v1|TDS 194C").pop() || {};
ok(/^rule: /.test(lg.note || "") && / · R2 · run /.test(lg.note || ""), "B. the trail keeps the rule and its reason: " + lg.note);
ok(/rule/.test(x.TDSMatch.matchedBy("v1|TDS 194C").words), "B. Matched by: " + x.TDSMatch.matchedBy("v1|TDS 194C").words);
const sg = x.TDSMatch.suggestNow("26Q", FY, Q).filter(s => s.ids.length);
ok(sg.length === 1 && sg[0].code === "R6" && sg[0].chId === "chS" && J(sg[0].ids) === J(["v4|TDS 194C"]), "B. what is left suggested, with its rule: " + J(sg.map(s => s.code + ":" + s.chId + ":" + s.ids)));
const rec = x.TDSAuto.last("26Q", FY, Q);
ok(rec && rec.n === 2 && rec.form === "26Q" && rec.fy === FY && rec.q === Q && (b.matchNo || {})["auto|" + x.TDSReg.key("26Q", FY, Q)], "B. the run kept for Undo with the books (matchNo, no new item): " + J(rec && {n: rec.n}));
res = x.TDSAuto.undo("26Q", FY, Q);
ok(res.ok && res.n === 2 && J(b.alloc) === before, "B. Undo: one click, the allocation exactly as before the run (" + J(b.alloc) + ")");
ok(!x.TDSAuto.last("26Q", FY, Q), "B. nothing left to undo after Undo");
res = x.TDSAuto.run("26Q", FY, Q);
ok(res.ok && res.placed === 2, "B. the run again after Undo places them again (" + res.placed + ")");
// a person's own placing is kept by Undo: Undo takes off only what the run placed and is still where it put it
x.TDSMatch.confirm(sg[0].key, "26Q", FY, Q);
const withHand = J(b.alloc);
x.TDSAuto.undo("26Q", FY, Q);
ok(b.alloc["v4|TDS 194C"] === "chS" && !b.alloc["v1|TDS 194C"], "B. Undo leaves a person's own placing made after the run (" + J(b.alloc) + ")" + (withHand ? "" : ""));
// a deduction a person took off stays off
x.TDSAuto.run("26Q", FY, Q); x.TDSMatch.takeOff(["v1|TDS 194C"]);
x.TDSMatch.takeOff(["v2|TDS 194C"]);
res = x.TDSAuto.run("26Q", FY, Q);
ok(res.ok && !b.alloc["v1|TDS 194C"] && !b.alloc["v2|TDS 194C"], "B. deductions a person took off a challan are not put back by the run (" + J(res) + ")");
// a filed return is never touched
b = books(vs, [CH("chC", "20260807", 3000, "194C"), CH("chJ", "20260905", 9000, "194J"), CH("chS", "20261007", 600, "194C")], {tdsFiled: {[FY + "|" + Q + "|26Q"]: {on: "2026-10-20", token: ""}}});
res = x.TDSAuto.run("26Q", FY, Q);
ok(!res.ok && /marked filed/.test(res.why) && J(b.alloc) === "{}" && !(b.allocLog || []).length, "B. a return marked filed: refused, nothing placed (" + res.why + ")");
ok(!x.TDSAuto.undo("26Q", FY, Q).ok, "B. and nothing to undo there");
// a run whose return is marked filed afterwards cannot be undone
b = books(vs, [CH("chC", "20260807", 3000, "194C")]);
x.TDSAuto.run("26Q", FY, Q); b.tdsFiled = {[FY + "|" + Q + "|26Q"]: {on: "2026-10-20", token: ""}};
res = x.TDSAuto.undo("26Q", FY, Q);
ok(!res.ok && /marked filed/.test(res.why) && b.alloc["v1|TDS 194C"] === "chC", "B. Undo refused once the return is marked filed: " + res.why);

// H6 across a quarter's end (the Leads-shaped check: September's rent ₹9,025, its challan of 07-Oct ₹7,984; October's own
// challan of 07-Nov ₹9,025 is for October's rent, which is in Q3's return): never offered to September, not even suggested
ok(!x.tmPlan([R("sp", "194I", "20260901", 9025)], [C("COct", "194I", "20261107", 9025)], Object.assign({waiting: [{sec: "194I", ym: "202610"}]}, OPT)).length, "P. a later month's own challan, its month in another return (opt.waiting): not offered");
ctx.istToday = () => "20261120";   // (a day after October's challan: a challan dated after today is never used)
b = books([V("s1", "20260901", "Landlord", 90250, 9025, "TDS 194C"), V("o1", "20261001", "Landlord", 90250, 9025, "TDS 194C")], [CH("cSep", "20261007", 7984, "194C"), CH("cOct", "20261107", 9025, "194C")]);
ok(!x.TDSMatch.suggestNow("26Q", FY, "Q2").some(s => s.chId === "cOct") && x.TDSAuto.run("26Q", FY, "Q2").placed === 0, "B. September (Q2) is never given October's own challan though October is in Q3's return (" + J(x.TDSMatch.suggestNow("26Q", FY, "Q2").map(s => s.code + ":" + s.chId)) + ")");
ok(x.TDSAuto.run("26Q", FY, "Q3").placed === 1 && b.alloc["o1|TDS 194C"] === "cOct", "B. October's own challan goes to October (Q3), R2");
ctx.istToday = () => "20261023";

// ---------------------------------------------------------------- T. 10,000 deductions, timed
{
  const secs = ["194C", "194J", "194H", "194I", "194A", "194Q"], rr = [], cc = []; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 10000; i++){ const m = 7 + (i % 3); rr.push({id: "r" + i, sec: secs[i % 6], date: "2026" + String(m).padStart(2, "0") + String(1 + Math.floor(rnd() * 28)).padStart(2, "0"), tds: Math.round(rnd() * 500000) / 100 + 10, party: "P" + (i % 1500), pan: "", fy: FY, q: Q}); }
  secs.forEach((s, si) => [8, 9, 10].forEach(m => { const sum = rr.filter(r => r.sec === s && +r.date.slice(4, 6) === m - 1).reduce((a, r) => a + Math.round(r.tds * 100), 0); cc.push(C("c" + s + m, s, "2026" + String(m).padStart(2, "0") + "07", (si % 2 ? Math.round(sum / 3) : sum) / 100)); }));
  let t = Date.now(); const pl = x.tmPlan(rr, cc, OPT), ms = Date.now() - t;
  ok(ms < 2000, "T. the rules on 10,000 deductions and 18 challans: " + ms + " ms (" + pl.filter(s => s.auto).reduce((a, s) => a + s.ids.length, 0) + " automatic, " + pl.filter(s => !s.auto).reduce((a, s) => a + s.ids.length, 0) + " suggested)");
  t = Date.now(); x.tmReasons(rr, cc, pl, OPT); const ms2 = Date.now() - t;
  ok(ms2 < 1000, "T. the reasons for what is left on 10,000 deductions: " + ms2 + " ms");
  // on books: 10,000 journals, then the run
  const vv = []; for (let i = 0; i < 10000; i++){ const s = i % 2 ? "194C" : "194J", m = 7 + (i % 3), amt = 1000 + (i % 97) * 10; vv.push(V("w" + i, "2026" + String(m).padStart(2, "0") + String(1 + (i % 28)).padStart(2, "0"), "Party " + (i % 700), amt * 50, amt, "TDS " + s)); }
  const cs = []; ["194C", "194J"].forEach(s => [7, 8, 9].forEach(m => { const tot = vv.filter(v => v.ent[1].l === "TDS " + s && +v.date.slice(4, 6) === m).reduce((a, v) => a + v.ent[1].a, 0); cs.push(CH("k" + s + m, "2026" + String(m + 1).padStart(2, "0") + "07", tot, s)); }));
  b = books(vv, cs);
  t = Date.now(); res = x.TDSAuto.run("26Q", FY, Q); const ms3 = Date.now() - t;
  ok(res.ok && res.placed === 10000 && ms3 < 8000, "T. Place automatically on books of 10,000 deductions: " + res.placed + " placed in " + ms3 + " ms");
  t = Date.now(); const un = x.TDSAuto.undo("26Q", FY, Q), ms4 = Date.now() - t;
  ok(un.ok && un.n === 10000 && !Object.keys(b.alloc).length && ms4 < 5000, "T. Undo of those 10,000: " + ms4 + " ms");
}

// ---------------------------------------------------------------- K. the remarks B, T, Y
const MAPK = Object.assign(JSON.parse(J(MAP)), {"Freight": {}, "Professional Fees": {}, "Interest Paid": {}});
const VE = (id, date, party, led, amt) => ({id, date, type: "Purchase", no: id, party, ent: [{l: party, a: amt}, {l: led, a: -amt}]});
const kb = (fy, extra) => books([VE("e1", fy === FY ? "20260710" : "20250710", "Road Kings", "Freight", 80000), VE("e2", fy === FY ? "20260712" : "20250712", "Small Consult", "Professional Fees", 12000),
  VE("e3", fy === FY ? "20260715" : "20250715", "Big Consult", "Professional Fees", 200000), V("v9", fy === FY ? "20260716" : "20250716", "Alpha Ltd", 100000, 2000, "TDS 194C")],
  [CH("chK", fy === FY ? "20260807" : "20250807", 2000, "194C")], Object.assign({map: MAPK, pans: {"Alpha Ltd": "AAACA1234A", "Road Kings": "ABCPR1234K", "Small Consult": "ABCPS1234C", "Big Consult": "ABCPB1234C", "Saver": "ABCPV1234S", "No Pan Roads": ""}}, extra || {}));
const ADD = (party, section, date, paid, basis) => x.TDSAdd.save({party, section, date, credit: date, paid, rate: 0, tds: 0, basis: basis || ""});
function kRows(fy){
  const d = (m) => (fy === FY ? "2026" : "2025") + m;
  ADD("Road Kings", "194C", d("0710"), 80000); ADD("Saver", "194A", d("0801"), 30000); ADD("Small Consult", "194J", d("0712"), 12000); ADD("Big Consult", "194J", d("0715"), 200000, "Y"); ADD("No Pan Roads", "194C", d("0720"), 40000);
  x.TDSMatch.move(["v9|TDS 194C"], "chK");
}
const rowOf = (party) => x.TDS.rows().find(r => r.party === party && r.tds === 0);
const KFY = (fy) => fy === FY ? FY : "2025-26";
for (const fy of ["2025-26", FY]){
  b = kb(fy); ctx.S.tdsFy = fy; ctx.S.tdsQ = Q;
  kRows(fy);
  let r1 = x.TDSDecl.set("Road Kings", fy, {transporter: true}), r2 = x.TDSDecl.set("Saver", fy, {form: "15G", date: fy === FY ? "2026-04-10" : "2025-04-10", uin: "ABCDE12345F123456789012345"});
  x.TDSDecl.set("No Pan Roads", fy, {transporter: true});
  ok(r1.ok && r2.ok && b.nrInfo["Road Kings"].decl[fy].t && b.nrInfo["Saver"].decl[fy].b.form === "15G", fy + " K. declarations kept with the books, per deductee per year (nrInfo, no new item): " + J(b.nrInfo["Saver"]));
  const rm = (p) => x.TDS26Q.remark(rowOf(p), "26Q").remark;
  ok(rm("Road Kings") === "T", fy + " K.T a transporter's declaration (194C, PAN): its no-TDS row gets remark T (" + rm("Road Kings") + ")");
  ok(rm("Saver") === "B", fy + " K.B a 15G/15H declaration: its no-TDS row gets remark B (" + rm("Saver") + ")");
  ok(rm("Small Consult") === "Y", fy + " K.Y below the limit (₹12,000 of 194J in the year, limit ₹50,000): Y by itself (" + rm("Small Consult") + ")");
  ok(x.TDS26Q.remark(x.TDS.rows().find(r => r.party === "Alpha Ltd"), "26Q").remark === "", fy + " K. a row with its TDS deducted: no remark");
  const ck = x.TDSDecl.checks(fy, Q, "26Q"), cw = ck.map(c => c.words).join(" | ");
  ok(ck.some(c => c.k === "t-pan" && /No Pan Roads/.test(c.words) && /PAN/.test(c.words)), fy + " K. Validate: remark T needs the deductee's PAN (" + cw + ")");
  ok(ck.some(c => c.k === "y-over" && /Big Consult/.test(c.words)), fy + " K. Validate: remark Y only below the limit: Big Consult's ₹2,00,000 is above it");
  ok(!ck.some(c => /Saver|Road Kings|Small Consult/.test(c.words)), fy + " K. Validate: nothing said of the rows whose remark is right");
  x.TDSDecl.set("Saver", fy, {form: "15G", date: "", uin: ""});
  const ck2 = x.TDSDecl.checks(fy, Q, "26Q");
  ok(ck2.some(c => c.k === "b-decl" && /Saver/.test(c.words) && (fy === FY ? /UIN/.test(c.words) : /date/.test(c.words))), fy + " K. Validate: remark B needs the declaration's date" + (fy === FY ? " and its Form 121 UIN" : "") + " (" + ck2.filter(c => c.k === "b-decl").map(c => c.words).join(" | ") + ")");
  x.TDSDecl.set("Saver", fy, {form: "15G", date: fy === FY ? "2026-04-10" : "2025-04-10", uin: "ABCDE12345F123456789012345"});
  // the FVU text lines
  b.tdsAdded = Object.fromEntries(Object.entries(b.tdsAdded).filter(([, v]) => !/Big Consult|No Pan Roads/.test(v.party)));
  x.TDSReg.forget && x.TDSReg.forget();
  const f = x.TDS26Q.build(fy, Q, {tan: "BLRF02329F", pan: "AAAFF1234F", name: "Fixture Traders", flat: "12", road: "MG Road", area: "Karol Bagh", town: "New Delhi", state: "Delhi", pin: "110005", email: "a@b.in", phone: "9811111111", person: "Ravi Kumar", personDesignation: "Partner", personPan: "ABCPK1234K"}, "26Q");
  const dds = String(f.text || "").split("\r\n").filter(l => l.split("^")[1] === "DD").map(l => l.split("^"));
  const remarkAt = fy === FY ? 31 : 29, panAt = fy === FY ? 7 : 9;
  const dOf = (pan) => dds.find(d => d[panAt] === pan) || [];
  ok(!f.error && dds.length === 4, fy + " K. the file: the deduction and the three nil rows (" + (f.error || dds.length + " DD") + ")");
  ok(dOf("ABCPR1234K")[remarkAt] === "T" && dOf("ABCPV1234S")[remarkAt] === "B" && dOf("ABCPS1234C")[remarkAt] === "Y", fy + " K. the remarks in the DD records: T, B, Y (" + J(dds.map(d => [d[panAt], d[remarkAt]])) + ")");
  if (fy === FY) ok(dOf("ABCPV1234S")[30] === "ABCDE12345F123456789012345" && dOf("ABCPR1234K")[30] === "", "K. Form 140: remark B's Form 121 UIN in DD field 31, nothing there for the others");
  // a quarter with only nil rows: a nil challan
  if (fy === FY){
    b = kb(fy); b.vouchers = b.vouchers.filter(v => v.id !== "v9"); b.challans = []; x.TDSReg.forget && x.TDSReg.forget();
    ADD("Road Kings", "194C", "20260710", 80000); x.TDSDecl.set("Road Kings", fy, {transporter: true});
    const g = x.TDS26Q.build(fy, Q, {tan: "BLRF02329F", pan: "AAAFF1234F", name: "Fixture Traders", flat: "12", road: "MG Road", area: "Karol Bagh", town: "New Delhi", state: "Delhi", pin: "110005", email: "a@b.in", phone: "9811111111", person: "Ravi Kumar", personDesignation: "Partner", personPan: "ABCPK1234K"}, "26Q");
    const cd = String(g.text || "").split("\r\n").filter(l => l.split("^")[1] === "CD").map(l => l.split("^")), dd = String(g.text || "").split("\r\n").filter(l => l.split("^")[1] === "DD").map(l => l.split("^"));
    ok(!g.error && cd.length === 1 && cd[0][5] === "Y" && cd[0][14] === "" && cd[0][18] === "30092026" && cd[0][7] === "0.00" && dd.length === 1 && dd[0][31] === "T", "K. only nil rows in the quarter: a nil challan (CD field 6 \"Y\", no BSR, the quarter's last day) with the T row under it (" + (g.error || J(cd[0])) + ")");
  }
  // the Excel working
  if (fy === FY){
    b = kb(fy); kRows(fy); x.TDSDecl.set("Road Kings", fy, {transporter: true}); x.TDSDecl.set("Saver", fy, {form: "15G", date: "2026-04-10", uin: "ABCDE12345F123456789012345"});
    const xl = {console}; vm.createContext(xl); vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "xlsx.js"), "utf8") + ";globalThis.__X = XLSX;", xl);
    ctx.XLSX = xl.__X; ctx.window = {XLSX: xl.__X}; ctx.ensureXlsx = async () => {}; let saved = null; ctx.saveFile = (n, blob) => { saved = blob; };
    ctx.Blob = class { constructor(parts){ this.parts = parts; } };
    x.TDS.toExcel(FY, Q, "26Q").then(() => {
      const wb = xl.__X.read(saved.parts[0], {type: "array"}), sh = xl.__X.utils.sheet_to_json(wb.Sheets.Deductees, {header: 1});
      const h = sh[0], ri = h.indexOf("Reason for non-deduction or lower deduction"), ui = h.findIndex(c => /UIN/.test(c)), pi = h.indexOf("PAN of the deductee");
      const by = (pan) => sh.find(r => r[pi] === pan) || [];
      ok(by("ABCPR1234K")[ri] === "T" && by("ABCPV1234S")[ri] === "B" && by("ABCPS1234C")[ri] === "Y" && by("ABCPV1234S")[ui] === "ABCDE12345F123456789012345", "K. the Excel working: the remarks T, B, Y and the declaration's UIN (" + J(sh.slice(1).map(r => [r[pi], r[ri], r[ui]])) + ")");
      done();
    }).catch(e => { ok(false, "K. the Excel working: " + e.message); done(); });
  }
}
function done(){
  console.log(fails.length ? "\nFAILED: " + fails.length : "\nall passed");
  process.exit(fails.length ? 1 : 0);
}
