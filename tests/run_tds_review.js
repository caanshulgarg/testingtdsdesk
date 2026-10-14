// node run_tds_review.js - the independent TDS review of 14-Oct-2026 (scratchpad tds-review.md), each finding a case on the
// app's own code (the built site-test/index.html, or TDSDESK_HTML), worked out by hand here:
//   H1  a deduction paid by the next quarter's challan is in its quarter's file (June paid 7-July; March paid 30-April)
//   H2  TCS (27EQ / Form 143) return due dates: the 15th up to 2025-26; from tax year 2026-27 the TDS calendar (31 Jul,
//       31 Oct, 31 Jan, 31 May); the late fee and the words on screen from the same function   [confirmed by several sources; official text not reachable]
//   H3  27EQ collection codes as the official list (quoted below with its source); a code a person chose from the old,
//       shifted list moved to the same nature
//   H4  the section codes of the 26Q file from one table; 194J technical and professional, 194-I machinery and building
//       get different codes (the values themselves are unverified: docs/tds-codes.md)
//   H5  a challan record adds up: tax + surcharge + cess + interest + fee written in it is the total it writes
//   M1  interest and fee allocated per return like the tax: two returns never both claim a challan's whole interest
//   M2  TDS deducted in a separate entry after the bill: the bill's amount and its date are the amount and date of credit
//   M3  194-IA / 194-IB / 194M are not in 26Q: listed apart, to be filed in 26QB / 26QC / 26QD on the portal
//   M4  above a lower-deduction certificate's limit the section's rate applies, whatever the ledger is called
//   M5  TCS from 1-Apr-2026: liquor 2%, tendu leaves 2%   [confirmed by several sources; official text not reachable]
//   M6  a return's Challans figure is what that return uses, not every challan of the quarter
//   M8  Tally's payroll tags never change a 24Q marked filed
//   L1  interest for paying late on a deduction still on no challan, to date
"use strict";
const path = require("path");
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDSYear", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES"];
const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
const {ctx, x} = load(HTML, have);
ctx.S.companies = {t: {id: "t", name: "Co", tan: "DELC01234E", pan: "AAACC1234C"}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {}; ctx.money = (a) => "₹" + a;
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {};
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const V = (id, date, party, exp, tds, led, expLed) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: exp - tds}, {l: led, a: tds}, {l: expLed || "Exp", a: -exp}]});
function books(vs, extra){
  const b = Object.assign({cid: "t", vouchers: vs, map: {"TDS 194C": {kind: "tds_payable", section: "194C"}, "TDS 194J": {kind: "tds_payable", section: "194J"}, "TDS 194I": {kind: "tds_payable", section: "194I"},
    "TDS on Property": {kind: "tds_payable", section: "194IA"}, "TDS 192": {kind: "tds_payable", section: "192"}, "Bank": {kind: "bank"}},
    challans: [], alloc: {}, certs: [], pans: {"Alpha Ltd": "AAACA1234A", "Beta": "ABCPB1234B", "Gamma": "ABCPG1234G"}}, extra || {});
  ["TCS Scrap", "TCS Tendu Leaves", "TCS Liquor", "TCS Parking", "TCS Toll", "TCS Mining", "TCS Timber Forest Lease", "TCS Timber", "TCS Forest Produce"].forEach(l => { b.map[l] = {kind: "tcs_payable", section: "206C"}; });
  ctx.S.books = b; return b;
}
const firm = {tan: "DELC01234E", pan: "AAACC1234C", name: "Co"};
const lines = (t, rec) => String(t || "").split("\r\n").filter(l => new RegExp("\\^" + rec + "\\^").test(l));
const has = (n) => have.includes(n);

// ---------------- H1
let b = books([V("v1", "20260520", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("v2", "20260620", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
b.challans = [{id: "c1", bsr: "0240020", serial: "00001", date: "20260607", tax: 2000, interest: 0, section: "194C"}, {id: "c2", bsr: "0240020", serial: "00002", date: "20260707", tax: 2000, interest: 0, section: "194C"}];
b.alloc = {"v1|TDS 194C": "c1", "v2|TDS 194C": "c2"};
let f = x.TDS26Q.build("2026-27", "Q1", firm, "26Q");
ok(!f.error && lines(f.text, "DD").length === 2 && lines(f.text, "CD").some(l => /\^07072026\^00002\^/.test(l)), "H1. June's deduction paid on the 7-July challan is in the Q1 file, with that challan (" + (f.error || lines(f.text, "DD").length + " DD") + ")");
b = books([V("v3", "20260320", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
b.challans = [{id: "c3", bsr: "0240020", serial: "00003", date: "20260430", tax: 2000, interest: 0}]; b.alloc = {"v3|TDS 194C": "c3"};
f = x.TDS26Q.build("2025-26", "Q4", firm, "26Q");
ok(!f.error && lines(f.text, "DD").length === 1 && lines(f.text, "CD").some(l => /\^30042026\^00003\^/.test(l)), "H1. March's deduction paid on 30-April: the Q4 2025-26 file is built with it (" + (f.error || "ok") + ")");

// ---------------- H2
ok(x.TDS.returnDue("2026-27", "Q1", "27EQ") === "20260731" && x.TDS.returnDue("2026-27", "Q3", "27EQ") === "20270131" && x.TDS.returnDue("2026-27", "Q4", "27EQ") === "20270531",
  "H2. Form 143 (27EQ) from 2026-27 is due with the TDS returns: 31 Jul, 31 Jan, 31 May (" + [x.TDS.returnDue("2026-27", "Q1", "27EQ"), x.TDS.returnDue("2026-27", "Q4", "27EQ")] + ")");
ok(x.TDS.returnDue("2025-26", "Q1", "27EQ") === "20250715" && x.TDS.returnDue("2025-26", "Q4", "27EQ") === "20260515", "H2. up to 2025-26 the 15th, as before");
ok(x.TDS.returnDue("2026-27", "Q2", "26Q") === "20261031", "H2. the TDS returns unchanged");
b = books([{id: "s1", date: "20260510", type: "Sales", party: "Beta", ent: [{l: "Beta", a: -102000}, {l: "Sales", a: 100000}, {l: "TCS Scrap", a: 2000}]}]);
let lf = x.TDS.lateFee("2026-27", "Q1", "20260731", "27EQ");
ok(lf && lf.days === 0 && lf.fee === 0, "H2. a 2026-27 Q1 TCS return filed on 31-Jul-2026 has no late fee (" + J(lf) + ")");
ok(typeof x.TDS.dueWords === "function" && x.TDS.dueWords("2026-27", "Q1", "27EQ") === "31 Jul" && x.TDS.dueWords("2025-26", "Q1", "27EQ") === "15 Jul" && x.TDS.dueWords("2025-26", "Q2", "26Q") === "31 Oct",
  "H2. the screen's \"due …\" comes from the same function (" + (typeof x.TDS.dueWords === "function" ? [x.TDS.dueWords("2026-27", "Q1", "27EQ"), x.TDS.dueWords("2025-26", "Q1", "27EQ")] : "none") + ")");

// ---------------- H3: the official collection codes. Source: the note to Form 27EQ (Income-tax Rules, 1962, Form No. 27EQ,
// "Collection Code"), TRACES copy https://traces61contents.tdscpc.gov.in/forms/Form-27EQ.pdf, as quoted by the review:
//   A alcoholic liquor for human consumption · B timber obtained under a forest lease · C timber obtained by any mode other
//   than under a forest lease · D any other forest produce not being timber or tendu leaves · E scrap · F parking lot ·
//   G toll plaza · H mining and quarrying · I tendu leaves · J minerals, being coal or lignite or iron ore · L motor
//   vehicle · O overseas tour programme package
const OFFICIAL = [["6CA", "TCS Liquor"], ["6CB", "TCS Timber Forest Lease"], ["6CC", "TCS Timber"], ["6CD", "TCS Forest Produce"], ["6CE", "TCS Scrap"], ["6CF", "TCS Parking"],
  ["6CG", "TCS Toll"], ["6CH", "TCS Mining"], ["6CI", "TCS Tendu Leaves"]];
const got = OFFICIAL.map(([c, l]) => [c, x.TCS27EQ.codeOf(l)]);
ok(got.every(([c, g]) => c === g), "H3. each TCS ledger gets its official code: " + got.filter(([c, g]) => c !== g).map(([c, g]) => g + " should be " + c).join(", "));
const names = Object.fromEntries(x.TCS27EQ.CODES.map(([c, n]) => [c, n]));
ok(/scrap/i.test(names["6CE"] || "") && /tendu/i.test(names["6CI"] || "") && /parking/i.test(names["6CF"] || "") && /lease/i.test(names["6CB"] || ""), "H3. the code list's words match the official list");
b = books([{id: "s1", date: "20260510", type: "Sales", party: "Beta", ent: [{l: "Beta", a: -102000}, {l: "Sales", a: 100000}, {l: "TCS Scrap", a: 2000}]}]);
b.challans = [{id: "t1", bsr: "0240020", serial: "00009", date: "20260607", tax: 2000, section: "206C"}]; b.alloc = {"s1|TCS Scrap": "t1"};
f = x.TDS26Q.build("2025-26", "Q1", firm, "27EQ");
b.vouchers[0].date = "20250510";
f = x.TDS26Q.build("2025-26", "Q1", firm, "27EQ");
ok(!f.error && lines(f.text, "DD").some(l => /\^6CE\^/.test(l)), "H3. the 27EQ file writes scrap as 6CE (" + (f.error || lines(f.text, "DD")[0]) + ")");
b = books([], {tcsCodes: {"TCS Old Scrap": "6CF", "TCS Old Tendu": "6CB"}});
x.TCS27EQ.fixCodes && x.TCS27EQ.fixCodes(b);
ok(b.tcsCodes["TCS Old Scrap"] === "6CE" && b.tcsCodes["TCS Old Tendu"] === "6CI" && b.tcsCodesFixed, "H3. a code chosen from the old list moves to the same nature (scrap 6CF -> 6CE, tendu 6CB -> 6CI), once (" + J(b.tcsCodes) + ")");
x.TCS27EQ.fixCodes && x.TCS27EQ.fixCodes(b);
ok(b.tcsCodes["TCS Old Scrap"] === "6CE", "H3. and never moved twice");

// ---------------- H4
b = books([V("j1", "20250510", "Beta", 100000, 2000, "TDS 194J", "Technical Services"), V("j2", "20250511", "Beta", 100000, 10000, "TDS 194J", "Professional Fees"),
  V("i1", "20250512", "Gamma", 100000, 2000, "TDS 194I", "Machinery Hire"), V("i2", "20250513", "Gamma", 100000, 10000, "TDS 194I", "Office Rent"), V("k1", "20250514", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
const code = (id) => x.TDS26Q.codeFor(x.TDS.rows().find(r => r.id.startsWith(id + "|")));
ok(typeof x.TDS26Q.codeFor === "function" && code("j1") !== code("j2") && code("i1") !== code("i2"), "H4. 194J technical and professional, 194-I machinery and building get different codes (" + (typeof x.TDS26Q.codeFor === "function" ? [code("j1"), code("j2"), code("i1"), code("i2")] : "no codeFor") + ")");
ok(typeof x.TDS26Q.codeFor === "function" && code("k1") === "94C", "H4. 194C stays 94C");
ok(has("TDS_SEC_CODES"), "H4. the codes are one table (TDS_SEC_CODES)");
// H4 (the coordinator's research, 14-Oct-2026: several secondary sources agree; the official text not reachable): from
// FY 2026-27 the new forms carry 4-digit payment codes. Form 140: 194J(a) technical 1026, 194J(b) professional 1027, 194T
// 1067; rent (old 194-I) is UNCONFIRMED (the sources disagree): no code, listed in To fix. Form 143: liquor 1068, tendu
// 1069, timber under a forest lease 1070, other timber 1071, other forest produce 1072, scrap 1073; others unconfirmed.
// The inferred codes 1007, 1010, 1025 and 1036 are never used. Up to 2025-26 the old section codes stay.
ok(code("j2") === "4JB" && code("j1") === "4JA" && code("i1") === "4IA" && code("i2") === "4IB", "H4. a 2025-26 26Q keeps the old section codes (" + [code("j1"), code("j2"), code("i1"), code("i2")] + ")");
b = books([V("p1", "20260510", "Beta", 100000, 10000, "TDS 194J", "Professional Fees"), V("p2", "20260511", "Beta", 100000, 2000, "TDS 194J", "Technical Services"),
  V("p3", "20260512", "Gamma", 100000, 10000, "TDS 194I", "Office Rent"), V("p4", "20260513", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
b.challans = [{id: "pc1", bsr: "0240020", serial: "00011", date: "20260607", tax: 24000, interest: 0}];
b.alloc = {"p1|TDS 194J": "pc1", "p2|TDS 194J": "pc1", "p3|TDS 194I": "pc1", "p4|TDS 194C": "pc1"};
f = x.TDS26Q.build("2026-27", "Q1", firm, "26Q");
const ddOf = (party, amt) => lines(f.text, "DD").find(l => l.includes("^" + party + "^") && l.includes("^" + amt + "^")) || "";
ok(!f.error && /\^1027\^/.test(ddOf("Beta", "10000.00")) && /\^1026\^/.test(ddOf("Beta", "2000.00")), "H4. a 2026-27 Form 140 writes 194J(b) professional as 1027, 194J(a) technical as 1026 (" + (f.error || [ddOf("Beta", "10000.00").split("^")[20], ddOf("Beta", "2000.00").split("^")[20]]) + ")");
ok(!/\^10(07|10|25|36)\^/.test(f.text || "") && !/\^(1008|1009|1016|1017|1019)\^/.test(ddOf("Gamma", "10000.00")), "H4. no inferred code (1007, 1010, 1025, 1036) and no rent code picked silently");
const pc = typeof x.TDS26Q.payCodeRows === "function" ? x.TDS26Q.payCodeRows("2026-27", "Q1", "26Q") : null;
ok(pc && pc.some(z => z.row.id.startsWith("p3|") && /payment code to confirm/.test(z.why)) && !pc.some(z => /^p[12]\|/.test(z.row.id)), "H4. the 2026-27 rent deduction is in To fix: payment code to confirm (" + (pc ? J(pc.map(z => [z.row.id.split("|")[0], z.why])) : "no payCodeRows") + ")");
ok(pc && x.TDS26Q.payCodeRows("2025-26", "Q1", "26Q").length === 0, "H4. none for a 2025-26 return (the old codes)");
b = books([{id: "s9", date: "20260510", type: "Sales", party: "Beta", ent: [{l: "Beta", a: -102000}, {l: "Sales", a: 100000}, {l: "TCS Scrap", a: 2000}]},
  {id: "s8", date: "20260511", type: "Sales", party: "Beta", ent: [{l: "Beta", a: -102000}, {l: "Sales", a: 100000}, {l: "TCS Parking", a: 2000}]}]);
b.challans = [{id: "t9", bsr: "0240020", serial: "00019", date: "20260607", tax: 4000, section: "206C"}]; b.alloc = {"s9|TCS Scrap": "t9", "s8|TCS Parking": "t9"};
f = x.TDS26Q.build("2026-27", "Q1", firm, "27EQ");
ok(!f.error && lines(f.text, "DD").some(l => /\^1073\^/.test(l)), "H4. a 2026-27 Form 143 writes scrap as 1073 (" + (f.error || lines(f.text, "DD").map(l => l.split("^")[20])) + ")");
const pt = typeof x.TDS26Q.payCodeRows === "function" ? x.TDS26Q.payCodeRows("2026-27", "Q1", "27EQ") : [];
ok(pt.length === 1 && pt[0].row.id.startsWith("s8|"), "H4. a 2026-27 parking-lot collection (no confirmed code) is in To fix (" + J(pt.map(z => z.why)) + ")");

// ---------------- H5 and M1
b = books([V("v1", "20260520", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("v2", "20260620", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("v3", "20260720", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
b.challans = [{id: "c1", bsr: "0240020", serial: "00001", date: "20260607", tax: 2000, section: "194C"}, {id: "c2", bsr: "0240020", serial: "00002", date: "20260707", tax: 4000, interest: 500, fee: 200, section: "194C"}];
b.alloc = {"v1|TDS 194C": "c1", "v2|TDS 194C": "c2", "v3|TDS 194C": "c2"};
const cd = (q) => lines(x.TDS26Q.build("2026-27", q, firm, "26Q").text, "CD").find(l => /\^00002\^/.test(l)).split("^");
const adds = (r) => { const a = r.map(v => /^\d+\.\d{2}$/.test(v) ? Number(v) : null); return {parts: Math.round((a[6] + a[7] + a[8] + a[9] + a[10]) * 100), total: Math.round(a[11] * 100), interest: a[9], fee: a[10]}; };
const q1 = adds(cd("Q1")), q2 = adds(cd("Q2"));
ok(q1.parts === q1.total && q2.parts === q2.total, "H5. each challan record adds up: tax + surcharge + cess + interest + fee = its total (Q1 " + J(q1) + ", Q2 " + J(q2) + ")");
ok(q1.interest + q2.interest <= 500 && q1.fee + q2.fee <= 200, "M1. the challan's interest (500) and fee (200) are not claimed twice by Q1 and Q2 (" + [q1.interest, q2.interest, q1.fee, q2.fee] + ")");
const c2 = x.TDS.challans().find(c => c.id === "c2"), bal = x.TDSReg.balance(c2);
ok(bal.interest === 0 && bal.fee === 0 && bal.tax === 0, "M1. its balance by head: what one return claims is used (" + J(bal) + ")");

// ---------------- M2
b = books([{id: "bill", date: "20260410", type: "Purchase", no: "B1", party: "Alpha Ltd", ent: [{l: "Alpha Ltd", a: 100000}, {l: "Contract Charges", a: -100000}]},
  {id: "tj", date: "20260620", type: "Journal", no: "J1", party: "Alpha Ltd", ent: [{l: "Alpha Ltd", a: -2000}, {l: "TDS 194C", a: 2000}]}]);
b.challans = [{id: "c1", bsr: "0240020", serial: "00001", date: "20260630", tax: 2000}]; b.alloc = {"tj|TDS 194C": "c1"};
const row = x.TDS.allRows()[0];
ok(row.paid === 100000 && x.TDS.ymd(row.credit) === "20260410", "M2. a TDS entry made after the bill: the bill's ₹1,00,000 and its date are the amount and date of credit (" + J([row.paid, row.credit]) + ")");
const dd = lines(x.TDS26Q.build("2026-27", "Q1", firm, "26Q").text, "DD")[0] || "";
ok(/\^100000\.00\^2000\.00\^/.test(dd) && /\^10042026\^20062026\^/.test(dd), "M2. the file: amount 1,00,000, credited 10-04-2026, deducted 20-06-2026 (" + dd + ")");
const it = x.TDS.interest("2026-27", "Q1", "26Q").filter(i => i.kind === "deduct");
ok(it.length === 1 && it[0].months === 3 && it[0].amount === 60, "M2. interest for deducting late still found: 3 months, ₹60 (" + J(it.map(i => [i.months, i.amount])) + ")");

// ---------------- M3
b = books([V("p1", "20260510", "Beta", 6000000, 60000, "TDS on Property"), V("k1", "20260511", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
ok(!x.TDS.rows().some(r => /^194IA/.test(x.TDS.sec(r.section))), "M3. a 194-IA deduction is not in 26Q (" + x.TDS.rows().map(r => r.section) + ")");
const pr = typeof x.TDS.portalRows === "function" ? x.TDS.portalRows() : [];
ok(pr.length === 1 && pr[0].portalForm === "26QB", "M3. it is listed apart, to be filed in 26QB on the portal (" + J(pr.map(r => [r.section, r.portalForm])) + ")");

// ---------------- M4
b = books([V("v1", "20260510", "Beta", 300000, 6000, "TDS 194J"), V("v2", "20260610", "Beta", 300000, 6000, "TDS 194J")]);
b.ledInfo = {}; b.certs = [{id: "L1", party: "Beta", pan: "ABCPB1234B", section: "194J", certNo: "LDC1", rate: 2, limit: 500000, from: "20260401", to: "20270331"}];
const iss = x.Certs.issues("2026-27", "Q1").map(i => [x.TDS.ymd(i.row.date), i.expected, i.short]);
ok(iss.length === 1 && iss[0][0] === "20260610" && Math.abs(iss[0][2] - 8000) < 1, "M4. the certificate's ₹5,00,000 used up: the other ₹1,00,000 at the section's 10%, ₹8,000 short, whatever the ledger is called (" + J(iss) + ")");

// ---------------- M5
ok(x.TDS.tcsRate("6CA", "20260510") === 2 && x.TDS.tcsRate("6CI", "20260510") === 2 && x.TDS.tcsRate("6CE", "20260510") === 2, "M5. from 1-Apr-2026: liquor, tendu leaves and scrap at 2% (" + [x.TDS.tcsRate("6CA", "20260510"), x.TDS.tcsRate("6CI", "20260510"), x.TDS.tcsRate("6CE", "20260510")] + ")");
ok(x.TDS.tcsRate("6CI", "20250510") === 5 && x.TDS.tcsRate("6CE", "20250510") === 1 && x.TDS.tcsRate("6CB", "20250510") === 2.5, "M5. before: tendu 5%, scrap 1%, timber 2.5%");

// ---------------- M6
b = books([V("v1", "20260620", "Alpha Ltd", 100000, 2000, "TDS 194C"), V("v2", "20260720", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
b.challans = [{id: "cJul", bsr: "0240020", serial: "00002", date: "20260707", tax: 4000, section: "194C"}, {id: "cSal", bsr: "0240020", serial: "00009", date: "20260507", tax: 50000, section: "192"}];
b.alloc = {"v1|TDS 194C": "cJul"};
ok(typeof x.TDSReg.usedBy === "function" && x.TDSReg.usedBy("2026-27", "Q1", "26Q") === 2000 && x.TDSReg.usedBy("2026-27", "Q2", "26Q") === 0,
  "M6. 26Q Q1's Challans figure is its own ₹2,000; Q2's is nil (" + (typeof x.TDSReg.usedBy === "function" ? [x.TDSReg.usedBy("2026-27", "Q1", "26Q"), x.TDSReg.usedBy("2026-27", "Q2", "26Q")] : "none") + ")");

// ---------------- M8
b = books([], {challans: [{id: "s1", bsr: "0240020", serial: "00011", date: "20260507", tax: 5000, section: "192"}], tdsFiled: {"2026-27|Q1|24Q": {on: "2026-07-20"}}});
const prow = {id: "pay:g1|e1", date: "20260430", fy: "2026-27", q: "Q1", employee: "E1", party: "E1", section: "192", tds: 1000, paid: 50000, challan: ""};
x.Payroll.tdsRows = () => [prow];
const n = x.Payroll.autoTag(b);
ok(n === 0 && !b.alloc[prow.id], "M8. Tally's payroll tag is not put on a 24Q marked filed (" + n + ")");
b.tdsFiled = {};
ok(x.Payroll.autoTag(b) === 1 && b.alloc[prow.id] === "s1" && (b.allocLog || []).some(l => l.act === "tally"), "M8. not filed: tagged, through the one tagging (in the trail)");

// ---------------- L1
b = books([V("v1", "20260415", "Alpha Ltd", 100000, 2000, "TDS 194C")]);
const un = x.TDS.interest("2026-27", "Q1", "26Q", "20261014").filter(i => i.kind === "unpaid");
ok(un.length === 1 && un[0].months === 7 && un[0].amount === 210, "L1. April's ₹2,000 still unpaid on 14-Oct: interest to date 1.5% × 7 months = ₹210 (" + J(un.map(i => [i.months, i.amount])) + ")");

console.log("\n" + (fails.length ? fails.length + " FAILED" : "all passed"));
process.exit(fails.length ? 1 : 0);
