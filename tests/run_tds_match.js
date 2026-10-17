// node run_tds_match.js - the one challan matcher (next-challan-match, the owner's request of 17-Oct-2026: "very confusing
// which challan to knock off against which deduction ... create something any fresher can understand"). On the app's own
// code (the built site-test/index.html, or TDSDESK_HTML):
//   R  the rules (server/_shared/tdsmatch.js, tmRules) one by one on made-up deductions and challans: a From Tally,
//      b same section same month exact, c same section whole quarter exact, d fill, e several sections in one challan,
//      f an earlier challan's balance, a split offered; every suggestion's reason in words; never over-used; the same
//      answer for the same inputs in any order; "Not this" not suggested again by another rule
//   A  the AI's answer checked by the code (tmAiParse, tmAiCheck): an id not sent, a deduction twice, over a challan's
//      balance, another tax year, a split that does not add up: dropped; only the masked PAN is sent
//   B  on books (TDSMatch, src/js/86): suggestions shown, nothing tagged until confirmed; Confirm one / Confirm all /
//      Not this / Move / Take off; a split kept and the FVU file writes two deductee records under two challans; the file
//      refuses while a deduction is on no challan (the list said); interest and fee written only as allocated (Form 140
//      CD 24 / 25, 0.00 when none; 26Q of 2025-26 CD 25 / 34 / 39 the portion)
//   S  Form 138 from the salary sheet: rows with stable ids, matched, the file's CD and DD records
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES", "TDSF25", "Market", "monthName",
  "TM_RULES", "tmNum", "tmP", "tmInr", "tmYmd", "tmMonth", "tmDmy", "tmFyOf", "tmNextYm", "tmSecOk", "tmYearOk", "tmTdsHead", "tmKey", "tmByDate", "tmChOrder", "tmDue", "tmRules", "TM_CONF", "TM_SCHEMA", "TM_SYSTEM",
  "TM_AI_ROWS", "TM_AI_CHS", "TM_MON", "tmMask", "tmClip", "tmAiInput", "tmAiPrompt", "tmAiParse", "tmAiCheck", "tmReasons", "tmLateInterest", "tmMonths", "TDSMatch"];
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
["tmRules", "tmAiParse", "tmAiCheck", "TDSMatch"].forEach(n => ok(have.includes(n), "the app has " + n));
if (!have.includes("tmRules") || !have.includes("TDSMatch")){ console.log("\nFAILED: " + fails.length); process.exit(1); }
const {ctx, x} = load(HTML, have);
ctx.S.companies = {t: {id: "t", name: "Co", tan: "DELZ12345A", pan: "AAGCZ1234M"}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {}; ctx.money = (a) => "₹" + a;
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {};

// ---------------------------------------------------------------- R. the rules
const R = (id, sec, date, tds, party) => ({id, sec, date, tds, party: party || "P " + id, pan: "ABCPA1234A", fy: x.tmFyOf(date), q: "Q1"});
const C = (id, sec, date, bal, extra) => Object.assign({id, sec, date, minor: "200", bal, fy: x.tmFyOf(date), label: id}, extra || {});
const rows = [
  R("c1", "194C", "20260405", 1000), R("c2", "194C", "20260412", 1200), R("c3", "194C", "20260420", 800),          // b: 3,000 = challan CB
  R("j1", "194J", "20260410", 500), R("j2", "194J", "20260515", 700), R("j3", "194J", "20260610", 300),            // c: 1,500 = challan CJ (quarter)
  R("h1", "194H", "20260502", 400), R("h2", "194H", "20260510", 600), R("h3", "194H", "20260520", 900),            // d: CH 1,000 takes h1 + h2
  R("a1", "194A", "20260503", 300), R("i1", "194I", "20260504", 700),                                               // e: CN (no section) 1,000
  R("q1", "194Q", "20260615", 250),                                                                                 // f: CE paid 05-Apr, 250 left
  R("d1", "194D", "20260510", 1500),                                                                                // split: CD1 1,000 + CD2 800
  R("t1", "194C", "20260601", 100), R("t2", "194C", "20260602", 200),                                               // a: Tally links them to CT
];
const chs = [C("CB", "194C", "20260507", 3000), C("CJ", "194J", "20260705", 1500), C("CH", "194H", "20260607", 1000), C("CN", "", "20260606", 1000),
  C("CE", "194Q", "20260405", 250), C("CD1", "194D", "20260605", 1000), C("CD2", "194D", "20260607", 800), C("CT", "194C", "20260707", 300), C("C400", "194C", "20260507", 3000, {minor: "400"})];
const opt = {fy: "2026-27", q: "Q1", links: {CT: ["t1", "t2"]}};
const S1 = x.tmRules(rows, chs, opt), by = (ch) => S1.filter(s => s.chId === ch);
console.log(S1.map(s => "    " + s.rule + " " + s.chId + " [" + s.ids.join(",") + "] " + s.reason + (s.warn ? " ! " + s.warn : "")).join("\n"));
ok(J(by("CT").map(s => [s.rule, s.ids])) === J([["a", ["t1", "t2"]]]) && by("CT")[0].words === "From Tally", "R.a Tally's link first: CT takes t1, t2 (\"From Tally\")");
ok(J(by("CB").map(s => [s.rule, s.ids])) === J([["b", ["c1", "c2", "c3"]]]), "R.b 194C April ₹3,000 = challan CB ₹3,000");
ok(by("CB")[0].reason === "194C · April 2026 · total ₹3,000 = challan ₹3,000", "R.b the reason in words: " + (by("CB")[0] || {}).reason);
ok(by("CB")[0].words === "Same section, same month, exact amount", "R.b the rule in words");
ok(J(by("CJ").map(s => [s.rule, s.ids])) === J([["c", ["j1", "j2", "j3"]]]) && by("CJ")[0].words === "Same section, whole quarter, exact amount", "R.c 194J's quarter ₹1,500 = challan CJ");
ok(J(by("CH").map(s => [s.rule, s.ids])) === J([["d", ["h1", "h2"]]]) && by("CH")[0].words === "Same section, same month", "R.d CH fills with h1, h2 (oldest first, whole rows, up to ₹1,000); h3 left");
ok(J(by("CN").map(s => [s.rule, s.ids])) === J([["e", ["a1", "i1"]]]) && /194A, 194I/.test(by("CN")[0].reason) && /one challan per section/.test(by("CN")[0].info), "R.e the no-section challan CN takes 194A and 194I of May (info: one challan per section per month)");
ok(J(by("CE").map(s => [s.rule, s.ids])) === J([["f", ["q1"]]]) && /before these deductions/.test(by("CE")[0].warn), "R.f an earlier challan's balance, with a warning");
const sp = S1.find(s => s.rule === "split");
ok(sp && J(sp.ids) === J(["d1"]) && J(sp.parts) === J([{chId: "CD1", paise: 100000}, {chId: "CD2", paise: 50000}]) && sp.words === "Split across challans", "R.split 194D ₹1,500: no challan holds it, offered as ₹1,000 on CD1 and ₹500 on CD2");
ok(!S1.some(s => s.chId === "C400"), "R. a minor head 400 challan is never suggested");
ok(!S1.some(s => s.ids.includes("h3")), "R. h3 (₹900) is left: no challan has room, and no split can hold it");
const used = {}; S1.forEach(s => { if (s.parts) s.parts.forEach(p => { used[p.chId] = (used[p.chId] || 0) + p.paise; }); else used[s.chId] = (used[s.chId] || 0) + s.total; });
ok(chs.every(c => (used[c.id] || 0) <= x.tmP(c.bal)), "R. never over-used: what every challan's suggestions use is within its balance");
const ids = [].concat(...S1.map(s => s.ids)); ok(new Set(ids).size === ids.length, "R. each deduction in one suggestion only");
const shuffled = x.tmRules(rows.slice().reverse(), chs.slice().reverse(), opt);
ok(J(shuffled.map(s => s.key).sort()) === J(S1.map(s => s.key).sort()) && J(x.tmRules(rows, chs, opt)) === J(S1), "R. deterministic: the same suggestions in any order of the inputs");
const noB = x.tmRules(rows, chs, Object.assign({}, opt, {no: {[by("CB")[0].key]: true}}));
ok(!noB.some(s => s.chId === "CB" && J(s.ids) === J(["c1", "c2", "c3"])), "R. \"Not this\" is not suggested again by another rule (" + noB.filter(s => s.chId === "CB").map(s => s.rule + ":" + s.ids).join(" ") + ")");
// late payment: d says interest is due
const late = x.tmRules([R("l1", "194C", "20260410", 500)], [C("CL", "194C", "20260620", 500)], {fy: "2026-27", q: "Q1"});
ok(late.length === 1 && late[0].rule === "b", "R.b a challan paid late still matches exactly");
const lateD = x.tmRules([R("l1", "194C", "20260410", 500), R("l2", "194C", "20260411", 400)], [C("CL", "194C", "20260620", 600)], {fy: "2026-27", q: "Q1"});
ok(lateD.length === 1 && lateD[0].rule === "d" && /after the due date 07-05-2026/.test(lateD[0].warn), "R.d a challan after the due date: interest said (" + (lateD[0] || {}).warn + ")");
// Q4: a challan of up to 31 May after the year; another year's never
const q4 = x.tmRules([Object.assign(R("m1", "194C", "20270320", 500), {q: "Q4", fy: "2026-27"})], [C("CM", "194C", "20270430", 500), C("CX", "194C", "20270610", 500)], {fy: "2026-27", q: "Q4"});
ok(q4.length === 1 && q4[0].chId === "CM", "R. Q4: March's TDS paid 30 April matches; a challan of June is another year's");

// ---------------------------------------------------------------- A. the AI's answer, checked by the code
const left = rows.filter(r => !ids.includes(r.id)), leftCh = chs.map(c => Object.assign({}, c, {bal: c.id === "CH" ? 0 : c.id === "CN" ? 0 : c.bal}));
const inp = x.tmAiInput([R("z1", "194C", "20260410", 900, "Zed Traders"), R("z2", "194C", "20260411", 100)], [C("CZ", "194C", "20260507", 950, {bsr: "0240020", serial: "00011", narr: "TDS April contractors"}), C("CY", "194C", "20260507", 100)]);
ok(!J(inp).includes("ABCPA1234A") && J(inp).includes("******234A") && J(inp).includes("Zed Traders") && J(inp).includes("TDS April contractors"), "A. sent: the PAN masked to its last 4, the deductee's name, the narration");
ok(J(Object.keys(inp.d[0]).sort()) === J(["date", "id", "month", "pan", "party", "section", "tds"]) && J(Object.keys(inp.c.find(c => c.narration)).sort()) === J(["balance", "bsr", "date", "id", "narration", "section", "serial"]), "A. only those fields");
const rev = {}; Object.keys(inp.map).forEach(k => { rev[inp.map[k]] = k; });
const ans = {pairs: [{challan: rev.CZ, rows: [rev.z1], reason: "same month", confidence: "high"}, {challan: "C9", rows: [rev.z2], reason: "x", confidence: "high"}, {challan: rev.CY, rows: [rev.z1], reason: "twice", confidence: "high"}],
  splits: [{row: rev.z2, parts: [{challan: rev.CZ, amount: 50}, {challan: rev.CY, amount: 50}], reason: "split", confidence: "low"}]};
const pa = x.tmAiParse(J(ans), inp.map);
ok(pa.ok && pa.pairs.length === 1 && pa.splits.length === 1 && pa.bad === 2, "A. an id not sent and a deduction used twice: dropped (" + pa.bad + ")");
ok(!x.tmAiParse("pairs: none", inp.map).ok, "A. an answer not JSON: refused whole");
const rr = [R("z1", "194C", "20260410", 900), R("z2", "194C", "20260411", 100)], cc = [C("CZ", "194C", "20260507", 950), C("CY", "194C", "20260507", 100)];
const ck = x.tmAiCheck(pa, rr, cc, {fy: "2026-27", q: "Q1"});
ok(ck.sugg.length === 2 && ck.sugg[0].rule === "g" && ck.sugg[0].reason === "AI: same month" && ck.sugg[1].rule === "split" && /low confidence/.test(ck.sugg[1].reason), "A. a valid pairing and a split that adds up: suggestions labelled \"AI: <reason>\"");
const over = x.tmAiCheck({pairs: [{chId: "CY", ids: ["z1"], reason: "over", confidence: "high"}], splits: []}, rr, cc, {fy: "2026-27", q: "Q1"});
ok(over.sugg.length === 0 && over.dropped === 1 && /balance/.test(over.why[0]), "A. over a challan's balance: refused");
const both = x.tmAiCheck({pairs: [{chId: "CZ", ids: ["z1"], reason: "a", confidence: "high"}, {chId: "CZ", ids: ["z2"], reason: "b", confidence: "high"}], splits: []}, rr, cc, {fy: "2026-27", q: "Q1"});
ok(both.sugg.length === 1 && both.dropped === 1, "A. two pairings together never over-use one challan (₹900 + ₹100 on ₹950)");
const yr = x.tmAiCheck({pairs: [{chId: "CO", ids: ["z1"], reason: "old", confidence: "high"}], splits: []}, rr, [C("CO", "194C", "20250507", 5000)], {fy: "2026-27", q: "Q1"});
ok(yr.sugg.length === 0, "A. a challan of another tax year: refused");
const bad = x.tmAiCheck({pairs: [], splits: [{rowId: "z1", parts: [{chId: "CZ", paise: 50000}, {chId: "CY", paise: 30000}], reason: "s", confidence: "high"}]}, rr, cc, {fy: "2026-27", q: "Q1"});
ok(bad.sugg.length === 0 && /add up/.test(bad.why[0]), "A. a split whose parts do not add up to the paisa: refused");
const early = x.tmAiCheck({pairs: [{chId: "CE2", ids: ["z1"], reason: "left over", confidence: "medium"}], splits: []}, rr, [C("CE2", "194C", "20260402", 900)], {fy: "2026-27", q: "Q1"});
ok(early.sugg.length === 1 && /before/.test(early.sugg[0].warn), "A. a challan paid before the deduction: allowed, with a warning");

// ---------------------------------------------------------------- B. on books
const V = (id, date, party, exp, tds, led) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: exp - tds}, {l: led, a: tds}, {l: "Exp", a: -exp}]});
function books(vs, chs2, extra){
  const b = Object.assign({cid: "t", vouchers: vs, map: {"TDS 194C": {kind: "tds_payable", section: "194C"}, "TDS 194J": {kind: "tds_payable", section: "194J"}, "Bank": {kind: "bank"}},
    challans: chs2, alloc: {}, certs: [], pans: {"Alpha Ltd": "AAACA1234A", "Beta": "ABCPB1234B", "Gamma": "ABCPG1234G"}, nrInfo: {}}, extra || {});
  ctx.S.books = b; ctx.S.tdsFy = "2026-27"; ctx.S.tdsQ = "Q1"; return b;
}
const FIRM = {tan: "BLRF02329F", pan: "AAAFF1234F", name: "Fixture Traders", flat: "12 First Floor", road: "MG Road", area: "Karol Bagh", town: "New Delhi", state: "Delhi", pin: "110005",
  email: "accounts@fixture.example", phone: "9811111111", person: "Ravi Kumar", personDesignation: "Partner", personPan: "ABCPK1234K", personFlat: "12 First Floor",
  personRoad: "MG Road", personArea: "Karol Bagh", personTown: "New Delhi", personState: "Delhi", personPin: "110005", personEmail: "ravi@fixture.example", personPhone: "9822222222"};
const vs = [V("v1", "20260410", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("v2", "20260420", "Beta", 50000, 1000, "TDS 194C"), V("v3", "20260512", "Gamma", 100000, 10000, "TDS 194J"),
  V("v4", "20260520", "Alpha Ltd", 150000, 3000, "TDS 194C")];
const CH = (id, date, tax, section, extra) => Object.assign({id, bsr: "0240020", serial: String(id.length * 7 + id.charCodeAt(id.length - 1)).padStart(5, "0"), date, tax, interest: 0, section, minorHead: "200"}, extra || {});
let b = books(vs, [CH("chA", "20260507", 3000, "194C", {interest: 120}), CH("chJ1", "20260606", 6000, "194J"), CH("chJ2", "20260607", 4000, "194J"), CH("chM", "20260606", 3000, "194C")]);
let sg = x.TDSMatch.suggest("26Q", "2026-27", "Q1");
ok(Object.keys(b.alloc).length === 0, "B. nothing is tagged by working out the suggestions");
const sA = sg.find(s => s.chId === "chA"), sM = sg.find(s => s.chId === "chM"), sSplit = sg.find(s => s.rule === "split");
ok(sA && sA.rule === "b" && sA.ids.length === 2 && sM && sM.rule === "b" && sSplit && sSplit.ids[0] === "v3|TDS 194J", "B. suggested: April's 194C to chA, May's to chM, the ₹10,000 194J split across chJ1 and chJ2 (" + sg.map(s => s.rule + ":" + s.chId).join(", ") + ")");
// file refused while anything is on no challan
let f = x.TDS26Q.build("2026-27", "Q1", FIRM, "26Q");
ok(f.error && /4 deductions are on no challan/.test(f.error) && (f.untagged || []).length === 4, "B. the file refuses while deductions are on no challan, and lists them: " + f.error);
let r = x.TDSMatch.confirm(sA.key, "26Q", "2026-27", "Q1");
ok(r.ok && b.alloc["v1|TDS 194C"] === "chA" && b.alloc["v2|TDS 194C"] === "chA", "B. Confirm one: its deductions on chA");
ok(/Same section, same month, exact amount/.test(x.TDSMatch.matchedBy("v1|TDS 194C").words) && /suggestion confirmed by/.test(x.TDSMatch.matchedBy("v1|TDS 194C").words), "B. Matched by: " + x.TDSMatch.matchedBy("v1|TDS 194C").words);
r = x.TDSMatch.notThis(sM.key, "26Q", "2026-27", "Q1");
ok(r.ok && !x.TDSMatch.suggest("26Q", "2026-27", "Q1").some(s => s.key === sM.key), "B. Not this: that suggestion is gone");
r = x.TDSMatch.move(["v4|TDS 194C"], "chM");
ok(r.ok && b.alloc["v4|TDS 194C"] === "chM" && /you/.test(x.TDSMatch.matchedBy("v4|TDS 194C").words), "B. Move to challan: by a person (" + x.TDSMatch.matchedBy("v4|TDS 194C").words + ")");
r = x.TDSMatch.takeOff(["v4|TDS 194C"]);
ok(r.ok && !b.alloc["v4|TDS 194C"], "B. Take off challan");
r = x.TDSMatch.move(["v4|TDS 194C", "v1|TDS 194C"], "chA");
ok(!r.ok && /left on this challan/.test(r.why), "B. a move beyond the challan's balance refused: " + r.why);
// confirm all: the split is not confirmed by Confirm all (it is offered, done in its dialog)
x.TDSMatch.takeOff(["v1|TDS 194C", "v2|TDS 194C"]); delete (b.matchNo || {})[sM.key];
r = x.TDSMatch.confirmAll("26Q", "2026-27", "Q1");
ok(r.n === 3 && b.alloc["v4|TDS 194C"] === "chM" && !b.alloc["v3|TDS 194J"], "B. Confirm all: 3 deductions on 2 challans; the split left for its dialog (" + J(r) + ")");
const sp2 = x.TDSMatch.suggest("26Q", "2026-27", "Q1").find(s => s.rule === "split");
r = x.TDSMatch.split("v3|TDS 194J", [{chId: "chJ1", tds: 6000}, {chId: "chJ2", tds: 3000}]);
ok(!r.ok && /add up/.test(r.why), "B. a split whose parts do not add up to the deduction: refused (" + r.why + ")");
r = x.TDSMatch.split("v3|TDS 194J", sp2.parts.map(p => ({chId: p.chId, tds: p.paise / 100})));
const parts = x.TDS.rows().filter(z => z.splitOf === "v3|TDS 194J");
ok(r.ok && parts.length === 2 && J(parts.map(z => [z.tds, z.paid, z.challan, z.date])) === J([[6000, 60000, "chJ1", "20260512"], [4000, 40000, "chJ2", "20260512"]]), "B. split: two rows, the tax and the amount paid in proportion, the same dates, each on its challan (" + J(parts.map(z => [z.tds, z.paid, z.challan])) + ")");
f = x.TDS26Q.build("2026-27", "Q1", FIRM, "26Q");
const rec = (t, k) => String(t || "").split("\r\n").filter(l => l.split("^")[1] === k).map(l => l.split("^"));
const cds = rec(f.text, "CD"), dds = rec(f.text, "DD");
ok(!f.error && cds.length === 4 && dds.length === 5, "B. the file: 4 challans, 5 deductee records (the split row is two) (" + (f.error || cds.length + " CD, " + dds.length + " DD") + ")");
const cdOf = (id) => cds.find(c => c[16] === b.challans.find(z => z.id === id).serial), ddUnder = (c) => dds.filter(d => d[4] === c[3]);
ok(J(["chJ1", "chJ2"].map(id => ddUnder(cdOf(id)).map(d => [d[7], d[23]]))) === J([[["ABCPG1234G", "6000.00"]], [["ABCPG1234G", "4000.00"]]]), "B. the split writes two deductee records, each under its own challan (DD 24)");
// interest: written only as allocated (Form 140 CD 24, 0.00 when none); offered pre-filled, confirmed by Confirm all
ok(cdOf("chA")[8] === "120.00" && cdOf("chA")[23] === "120.00", "B. Confirm all also allocated chA's interest ₹120 (its only user): Form 140 field 9 120 as deposited, field 24 120 allocated");
x.TDSReg.setPortion("chA", "26Q", "2026-27", "Q1", 0, 0);
f = x.TDS26Q.build("2026-27", "Q1", FIRM, "26Q");
ok(rec(f.text, "CD").find(c => c[16] === b.challans.find(z => z.id === "chA").serial)[23] === "0.00", "B. none allocated: field 24 0.00 (the interest stays in field 9, as deposited)");
const iS = x.TDSMatch.suggest("26Q", "2026-27", "Q1").find(s => s.rule === "int");
ok(iS && iS.chId === "chA" && iS.interest === 120 && iS.words === "Interest allocated to this return", "B. the interest is offered again as a suggestion: " + (iS || {}).reason);
r = x.TDSMatch.confirm(iS.key, "26Q", "2026-27", "Q1");
f = x.TDS26Q.build("2026-27", "Q1", FIRM, "26Q");
ok(r.ok && rec(f.text, "CD").find(c => c[16] === b.challans.find(z => z.id === "chA").serial)[23] === "120.00", "B. confirmed: field 24 120.00");
ok(x.TDSMatch.defaultPortion(b.challans.find(z => z.id === "chA"), "26Q", "2026-27", "Q1").interest === 120, "B. the default interest to allocate: the challan's interest, this return its only user");
const chk = x.TDSMatch.checks("26Q", "2026-27", "Q1");
ok(!chk.block.length, "B. nothing blocks the file now (" + J(chk.block) + ")");
r = x.TDSMatch.unsplit("v3|TDS 194J");
ok(r.ok && !x.TDS.rows().some(z => z.splitOf) && !b.alloc["v3|TDS 194J#1"], "B. a split undone: the row whole again, on no challan");
ok(x.TDSMatch.checks("26Q", "2026-27", "Q1").block.some(k => k.k === "untagged"), "B. the checks block the file: a deduction on no challan");

// FY 2025-26 (26Q, FVU 8.7): a challan shared by two quarters, each writes its own portion only
const vo = [V("o1", "20250610", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("o2", "20250710", "Beta", 50000, 1000, "TDS 194C")];
b = books(vo, [CH("chS", "20250807", 3000, "194C", {interest: 90, fee: 200})]);
x.TDSCH.tag(["o1|TDS 194C"], "chS"); x.TDSCH.tag(["o2|TDS 194C"], "chS");
const old = (q) => rec(x.TDS26Q.build("2025-26", q, FIRM, "26Q").text, "CD")[0];
ok(J([old("Q1")[24], old("Q1")[33], old("Q1")[38], old("Q2")[24], old("Q2")[38]]) === J(["0.00", "0.00", "0.00", "0.00", "0.00"]), "B. 26Q 2025-26, nothing allocated: interest and fee 0.00 in both quarters (they once took the whole into one)");
x.TDSReg.setPortion("chS", "26Q", "2025-26", "Q1", 60, 0); x.TDSReg.setPortion("chS", "26Q", "2025-26", "Q2", 30, 200);
ok(J([old("Q1")[24], old("Q1")[33], old("Q1")[38], old("Q1")[26]]) === J(["60.00", "60.00", "0.00", "2060.00"]) && J([old("Q2")[24], old("Q2")[38], old("Q2")[26]]) === J(["30.00", "200.00", "1230.00"]), "B. 26Q 2025-26: Q1 writes interest 60, Q2 interest 30 and fee 200: each its portion, the totals add up");

// ---------------------------------------------------------------- S. Form 138 from the salary sheet
b = books([], [CH("chSal", "20260507", 9000, "192"), CH("chSal2", "20260606", 5000, "192")], {salary: [
  {name: "Ravi Menon", pan: "ABCPM1234R", date: "2026-04-30", gross: 200000, tds: 4000}, {name: "Sunita Rao", pan: "ABCPR5678S", date: "2026-04-30", gross: 80000, tds: 5000},
  {name: "Ravi Menon", pan: "ABCPM1234R", date: "2026-05-31", gross: 200000, tds: 5000}]});
const sal = x.TDS.salaryRows().filter(z => z.fy === "2026-27");
ok(sal.length === 3 && sal.every(z => /^sal:/.test(z.id)) && J(x.TDS.salaryRows().map(z => z.id)) === J(sal.map(z => z.id)), "S. the salary sheet's rows have stable ids (" + sal.map(z => z.id).join(", ") + ")");
f = x.TDS24Q_FILE.build("2026-27", "Q1", FIRM);
ok(f.error && /on no challan/.test(f.error), "S. Form 138 refused while salary TDS is on no challan: " + f.error);
const s138 = x.TDSMatch.suggest("24Q", "2026-27", "Q1");
ok(s138.length === 2 && s138[0].rule === "b" && s138[0].chId === "chSal" && s138[1].chId === "chSal2", "S. matched like the others: April ₹9,000 = chSal, May ₹5,000 = chSal2 (" + s138.map(s => s.rule + ":" + s.chId).join(", ") + ")");
x.TDSMatch.confirmAll("24Q", "2026-27", "Q1");
f = x.TDS24Q_FILE.build("2026-27", "Q1", FIRM);
const c138 = rec(f.text, "CD"), d138 = rec(f.text, "DD");
ok(!f.error && c138.length === 2 && d138.length === 3 && J(d138.map(d => [d[7], d[24]])) === J([["ABCPM1234R", "4000.00"], ["ABCPR5678S", "5000.00"], ["ABCPM1234R", "5000.00"]]), "S. Form 138 from the sheet: 2 CD and 3 DD records (" + (f.error || c138.length + " CD, " + d138.length + " DD") + ")");
ok(x.TDS24Q_FILE.build("2026-27", "Q4", FIRM).error && /Protean/.test(x.TDS24Q_FILE.build("2026-27", "Q4", FIRM).error), "S. Q4 still waits on Protean's layout");
// the books' 192 alone: matched, but no file (they do not say which employee)
b = books([V("w1", "20260430", "Salary Payable", 50000, 5000, "TDS 192")], [CH("chW", "20260507", 5000, "192")]);
b.map["TDS 192"] = {kind: "tds_payable", section: "192"};
ok(x.TDSMatch.suggest("24Q", "2026-27", "Q1").length === 1, "S. the books' 192 deductions are matched too");
x.TDSMatch.confirmAll("24Q", "2026-27", "Q1");
ok(/salary sheet/.test(x.TDS24Q_FILE.build("2026-27", "Q1", FIRM).error || ""), "S. but the file asks for the salary sheet or Tally's payroll: " + x.TDS24Q_FILE.build("2026-27", "Q1", FIRM).error);


// ---------------------------------------------------------------- M. the owner's measure: "only 1 or 2% work should remain"
// 100 made-up deductions of Q1 2026-27 (194C, 194J, 194H, 194I; April to June), each month's challan as businesses pay
// them, with what goes wrong in real books: a challan naming 194JB for 194JA work, June's 194H paid on a challan marked
// 194C, April's 194I challan short by one deduction, four 194C deductions on a challan naming no section. The AI is a
// stand-in (never the real API): it pairs a month's leftovers with a challan of that month whose balance is their total.
{
  const secs = ["194C", "194J", "194H", "194I"], months = ["202604", "202605", "202606"], rowsM = [], chsM = [];
  let k = 0;
  secs.forEach((sec, si) => months.forEach((ym, mi) => {
    const list = [];
    for (let i = 0; i < 8; i++){ k++; list.push(R("m" + k, sec === "194J" && ym === "202606" ? "194JA" : sec, ym + String(3 + i * 3).padStart(2, "0"), 500 + ((k * 137) % 900) + (k % 3) * 0.5)); }
    rowsM.push(...list);
    let bal = list.reduce((a, r) => a + x.tmP(r.tds), 0) / 100;
    if (sec === "194I" && ym === "202604") bal = (x.tmP(bal) - x.tmP(list[7].tds)) / 100;          // short by the last deduction
    const csec = sec === "194J" && ym === "202606" ? "194JB" : sec === "194H" && ym === "202606" ? "194C" : sec;
    chsM.push(C("M" + si + mi, csec, x.tmNextYm(ym) + "07", bal));
  }));
  for (let i = 0; i < 4; i++){ k++; rowsM.push(R("m" + k, "194C", "202604" + String(25 + i), 1000)); }
  chsM.push(C("MN", "", "20260505", 4000));
  const optM = {fy: "2026-27", q: "Q1", today: "20261017"};
  const rules = x.tmRules(rowsM, chsM, optM), taken = new Set([].concat(...rules.map(s => s.ids))), use = {};
  rules.forEach(s => (s.parts || [{chId: s.chId, paise: s.total}]).forEach(p2 => { use[p2.chId] = (use[p2.chId] || 0) + p2.paise; }));
  const leftCh = chsM.map(c => Object.assign({}, c, {bal: (x.tmP(c.bal) - (use[c.id] || 0)) / 100}));
  const inpM = x.tmAiInput(rowsM.filter(r => !taken.has(r.id)), leftCh.filter(c => c.bal > 0));
  // the stand-in AI: a month's leftover deductions, paired with a challan deposited the next month whose balance is their total
  const byMonth = {}; inpM.d.forEach(d => { (byMonth[d.month] = byMonth[d.month] || []).push(d); });
  const pairs = [];
  Object.entries(byMonth).forEach(([mo, ds]) => {
    const bySec = {}; ds.forEach(d => { (bySec[d.section] = bySec[d.section] || []).push(d); });
    Object.values(bySec).forEach(g => { const tot = Math.round(g.reduce((a, d) => a + d.tds * 100, 0)); const c = inpM.c.find(c => Math.round(c.balance * 100) === tot && c.date.slice(3, 10) === x.tmNextYm(mo.replace("-", "")).slice(4, 6) + "-" + x.tmNextYm(mo.replace("-", "")).slice(0, 4));
      if (c) pairs.push({challan: c.id, rows: g.map(d => d.id), reason: "same month, the challan's balance is their total", confidence: "high"}); });
  });
  const aiM = x.tmAiCheck(x.tmAiParse(J({pairs, splits: [], interest: []}), inpM.map), rowsM.filter(r => !taken.has(r.id)), leftCh, optM);
  const all = rules.concat(aiM.sugg), cov = new Set([].concat(...all.map(s => s.ids)));
  const reasons = x.tmReasons(rowsM, chsM, all, optM), why = new Set(reasons.map(z => z.rowId));
  const pct = Math.round(cov.size / rowsM.length * 1000) / 10;
  console.log("    M. " + rowsM.length + " deductions: " + rules.length + " rule suggestions cover " + taken.size + ", AI " + aiM.sugg.length + " more; " + cov.size + " suggested (" + pct + "%), " + reasons.length + " with a reason");
  reasons.forEach(z => console.log("       " + z.rowId + ": " + z.words));
  ok(rowsM.length === 100 && pct >= 98, "M. at least 98% of the deductions get a valid suggestion after the rules and the AI (" + pct + "%)");
  ok(rowsM.every(r => cov.has(r.id) || why.has(r.id)), "M. 100% get a suggestion or a reason with the next step");
  ok(reasons.every(z => /pay|Move to challan|split|check/i.test(z.words) && z.step), "M. every reason says the next step");
  const sh = reasons.find(z => z.step === "pay");
  ok(sh && /^No challan paid yet for 194I, April 2026: pay ₹[\d,.]+ \(TDS ₹[\d,.]+ \+ interest ₹[\d,.]+ to 17-10-2026\)/.test(sh.words) || (sh && /used up: pay/.test(sh.words)), "M. the short one: " + (sh || {}).words);
  const tot = new Set(rowsM.map(r => r.id)); ok(all.every(s => s.ids.every(id => tot.has(id))), "M. suggestions name only these deductions");
}
// reasons: other section, a split short, a 400 challan
{
  const rs = x.tmReasons([R("o1", "194C", "20260410", 500)], [C("OJ", "194J", "20260507", 800)], [], {fy: "2026-27", q: "Q1", today: "20260601"});
  ok(rs[0].step === "move" && /OJ \(194J\) has ₹800 left, but this is 194C: if it was paid for this, use Move to challan/.test(rs[0].words), "R. another section's challan with room: " + rs[0].words);
  const r4 = x.tmReasons([R("o2", "194C", "20260410", 500)], [C("O4", "194C", "20260507", 800, {minor: "400"})], [], {fy: "2026-27", q: "Q1", today: "20260601"});
  ok(r4[0].step === "pay" && /minor head 400/.test(r4[0].words), "R. only a minor head 400 challan: " + r4[0].words);
  const r5 = x.tmReasons([R("o3", "194C", "20260410", 5000)], [C("OS", "194C", "20260507", 3000)], [], {fy: "2026-27", q: "Q1", today: "20261017"});
  ok(r5[0].step === "pay" && /has ₹3,000 left but this needs ₹5,000: pay ₹2,\d{3} \(the TDS short ₹2,000 \+ interest ₹\d+ to 17-10-2026\), then split/.test(r5[0].words), "R. a challan short: " + r5[0].words);
}

console.log(fails.length ? "\nFAILED: " + fails.length : "\nall passed");
process.exit(fails.length ? 1 : 0);
