// node run_tds_dups.js - next-tds-validate-short (the owner, 25-Oct-2026, Leads Insurance Form 140 Q1 2026-27): what a
// return carries twice, what its file leaves out, and its interest worked by hand. On the app's own code (site-test/
// index.html, or TDSDESK_HTML), on books made like Leads' (staging, read 25-Oct-2026: 39 deductions typed in FinCom on 23-24
// Oct that the books already had):
//   D  possible duplicates (TDSAdd.dups, src/js/88): "Garg Shekhar & Company" typed for Tally's "Garg Shekhar & Co." (₹2,500
//      and ₹1,000 of 30-Apr), "Amazon Internet Services Pvt. Ltd." ₹1,131 for Tally's "Amazon" ₹1,130.49, ET Infra ₹1,565 for
//      ₹1,564.64, Kiran Srivastava ₹8,582 for the books' ₹8,582 corrected in FinCom to ₹42,910, Simson ₹2,733 typed for 21-Apr
//      for the books' ₹2,733.10 of 22-May: each found once, with the nearest books row; a rent typed each month with no books
//      row, a different amount, and another month's bill are not
//   K  Keep this one (TDSAdd.keepOne): the other taken out of the return, kept (TDSEdit's out, its reason), the return and
//      its TDS one row less; refused on a return marked filed
//   L  the file leaves out what it cannot carry (TDS26Q.leftOut, src/js/92): on no challan; the file made from the rest
//      (Form 140), its leftOut and its note; nothing on a challan: no file (the one blocker)
//   I  interest by hand (TDS.interest, TDSMatch.interestTable): ₹10,000 credited 15-Apr, deducted 20-Jun, paid 10-Aug
//      (due 07-Jul): 1% x 3 + 1.5% x 3 = ₹750; not paid, 1.5% a month to today (25-Oct: 6 months from 05-May); the total =
//      on challans + not yet paid; 234E 86 days x ₹200 = ₹17,200, capped at the statement's TDS
//   A  Add deduction (the owner, 26-Oct-2026): the books' deduction a new one repeats (TDSAdd.inBooks)
//   R  the deductor's required details (TDSF25.deductorRequired): empty ones, a TAN that is not a TAN; nothing else judged
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML, TM_NAMES} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "money", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GRAM_CACHE", "gramsOf", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES", "TDSF25", "Market", "monthName", "TDSAdd", "TDSSep",
  "TDSMatch", "PANCheck", "TDSPanFix", "TDSAuto", "TDS_REMARK", "TDSDecl", "TDSAudit", "TDS26QFile"].concat(TM_NAMES);
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
["TDSAdd", "TDSMatch"].forEach(n => ok(have.includes(n), "the app has " + n));
const {ctx, x} = load(HTML, have);
ctx.window = ctx; ctx.globalThis = ctx;
// TDSEdit (app/src/lib/tdsEdit.js, the React bundle's): its wraps of the rows (a row taken out left out)
const strip = (f) => fs.readFileSync(path.join(__dirname, "..", "app", "src", "lib", f), "utf8").replace(/^import .*$/mg, "").replace(/^export default .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
vm.runInContext("(function(){" + strip("tdsEdit.js") + "\n})();", ctx);
const E = ctx.TDSEdit;
ok(typeof E === "object", "TDSEdit loaded");
ctx.S.companies = {t: {id: "t", name: "Leads Insurance", tan: "DELL12345A", pan: "AAACL1234M"}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {};
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {}; ctx.S.firm = {};
ctx.istToday = () => "20261025";
ok(typeof x.TDSAdd.dups === "function" && typeof x.TDSAdd.keepOne === "function" && typeof x.TDS26Q.leftOut === "function", "TDSAdd.dups, TDSAdd.keepOne, TDS26Q.leftOut");
if (fails.length){ console.log("\nFAILED: " + fails.length); process.exit(1); }

function r2(v){ return Math.round(v * 100) / 100; }
const V = (id, date, party, exp, tds, led) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: r2(exp - tds)}, {l: led, a: tds}, {l: "Exp " + led, a: -exp}]});
const MAP = {"TDS 94J 10%": {kind: "tds_payable", section: "194J"}, "TDS 94J 2%": {kind: "tds_payable", section: "194J"}, "TDS 94C": {kind: "tds_payable", section: "194C"}, "TDS on Rent 94I": {kind: "tds_payable", section: "194I"}, "Bank": {kind: "bank"}};
const FY = "2026-27", Q = "Q1";
const ADD = (party, section, date, paid, tds) => ({party, section, date, credit: date, paid, tds, rate: "", by: "test@test.com", at: "2026-10-24T07:00:00Z", log: [], fromVoucher: ""});
function books(){
  const b = {cid: "t", map: JSON.parse(J(MAP)), challans: [], alloc: {}, certs: [], nrInfo: {}, pans: {},
    vouchers: [V("g37", "20260430", "Garg Shekhar & Co.", 25000, 2500, "TDS 94J 10%"), V("g38", "20260430", "Garg Shekhar & Co.", 10000, 1000, "TDS 94J 10%"),
      V("g81", "20260530", "Garg Shekhar & Co.", 25000, 2500, "TDS 94J 10%"), V("am1", "20260402", "Amazon", 56524.5, 1130.49, "TDS 94J 2%"),
      V("et1", "20260401", "ET INFRA DEVELOPERS PVT LTD", 78232, 1564.64, "TDS 94C"), V("ki7", "20260410", "KIRAN SRIVASTAVA", 85815, 8582, "TDS 94J 2%"),
      V("si1", "20260522", "Simson Softwares Private Limited", 136655, 2733.10, "TDS 94J 2%")],
    tdsEdits: {"ki7|TDS 94J 2%": {f: {tds: 42910, rate: 10}, log: [{field: "tds", from: 8582, to: 42910, by: "test@test.com", at: "2026-10-19T08:34:27Z"}]}},
    tdsAdded: {gA: ADD("Garg Shekhar & Company", "194J", "20260430", 25000, 2500), gB: ADD("Garg Shekhar & Company", "194J", "20260430", 10000, 1000),
      amz: ADD("Amazon Internet Services Pvt. Ltd.", "194J", "20260402", 56525, 1131), et: ADD("ET INFRA DEVELOPERS PVT LTD", "194C", "20260401", 78232, 1565),
      ki: ADD("KIRAN SRIVASTAVA", "194J", "20260410", 85815, 8582), si: ADD("Simson Softwares Private Limited", "194J", "20260421", 136655, 2733),
      // not duplicates: a rent typed each month (no books row), a different amount, a month of its own
      r1: ADD("ZZ Landlord", "194I", "20260401", 79840, 7984), r2: ADD("ZZ Landlord", "194I", "20260501", 79840, 7984), r3: ADD("ZZ Landlord", "194I", "20260601", 79840, 7984),
      g6: ADD("Garg Shekhar & Company", "194J", "20260630", 20000, 2000)}};
  ctx.S.books = b; ctx.S.tdsFy = FY; ctx.S.tdsQ = Q; x.TDSReg.forget(); return b;
}

// ---------------------------------------------------------------- D. possible duplicates
let b = books();
const rows = x.TDS.formRows("26Q").filter(r => r.fy === FY && r.q === Q);
ok(rows.length === 7 + 10, "D. the return: 7 deductions from the books, 10 typed in FinCom (" + rows.length + ")");
const kiran = rows.find(r => r.id === "ki7|TDS 94J 2%");
ok(kiran && kiran.tds === 42910 && kiran.books && kiran.books.tds === 8582, "D. Kiran's books row corrected in FinCom: ₹42,910, the books ₹8,582 (" + (kiran && [kiran.tds, kiran.books && kiran.books.tds]) + ")");
let dp = x.TDSAdd.dups("26Q", FY, Q);
const pairs = dp.map(p => p.a.id + "=" + p.b.id).sort();
const want = ["fc:gA=g37|TDS 94J 10%", "fc:gB=g38|TDS 94J 10%", "fc:amz=am1|TDS 94J 2%", "fc:et=et1|TDS 94C", "fc:ki=ki7|TDS 94J 2%", "fc:si=si1|TDS 94J 2%"].sort();
ok(J(pairs) === J(want), "D. six pairs, each typed one with its books row (" + J(pairs) + ")");
ok(!dp.some(p => /fc:r\d|fc:g6|g81/.test(p.a.id + p.b.id)), "D. not the rent typed each month, the ₹2,000, nor May's ₹2,500");
const si = dp.find(p => p.a.id === "fc:si");
ok(si && /dates 31 days apart/.test(si.why) && /one from the books/.test(si.why), "D. Simson: 21-Apr typed, 22-May in the books: " + (si && si.why));
ok(dp.find(p => p.a.id === "fc:gA").why.startsWith("the same date, section and TDS"), "D. Garg: the same date, section and TDS");

// ---------------------------------------------------------------- K. Keep this one
const tds0 = r2(x.TDS.formRows("26Q").filter(r => r.fy === FY && r.q === Q).reduce((a, r) => a + r.tds, 0));
let k = x.TDSAdd.keepOne("26Q", "g37|TDS 94J 10%", "fc:gA");
ok(k.ok && !x.TDS.formRows("26Q").some(r => r.id === "fc:gA") && x.TDS.formRows("26Q").some(r => r.id === "g37|TDS 94J 10%"), "K. Keep the books' ₹2,500: the one typed taken out (" + J(k) + ")");
const out = (b.tdsEdits["fc:gA"] || {f: {}}).f.out || {};
ok(out.dup === "g37|TDS 94J 10%" && /possible duplicate of Journal g37 \(kept\)/.test(out.reason) && out.form === "26Q" && out.fy === FY && out.q === Q && b.tdsAdded.gA && !b.tdsAdded.gA.deleted,
  "K. kept, not deleted: taken out with its reason (" + J(out) + ")");
ok(r2(x.TDS.formRows("26Q").filter(r => r.fy === FY && r.q === Q).reduce((a, r) => a + r.tds, 0)) === r2(tds0 - 2500) && x.TDSAdd.dups("26Q", FY, Q).length === 5, "K. the return's TDS ₹2,500 less, five pairs left");
ok(E.outList().some(o => o.id === "fc:gA" && o.dup), "K. in the list of rows taken out (Put back)");
k = x.TDSAdd.keepOne("26Q", "fc:ki", "ki7|TDS 94J 2%");
ok(k.ok && !x.TDS.formRows("26Q").some(r => r.id === "ki7|TDS 94J 2%") && b.tdsEdits["ki7|TDS 94J 2%"].f.tds === 42910, "K. Kiran: keep the ₹8,582 typed, the books' row (corrected to ₹42,910) taken out, its correction kept");
delete b.tdsEdits["fc:gA"].f.out; delete b.tdsEdits["ki7|TDS 94J 2%"].f.out; x.TDSReg.forget();
ok(x.TDSAdd.dups("26Q", FY, Q).length === 6, "K. put back: six pairs again");
const lk = x.TDSReg.locked; x.TDSReg.locked = () => true;
k = x.TDSAdd.keepOne("26Q", "g37|TDS 94J 10%", "fc:gA"); x.TDSReg.locked = lk;
ok(!k.ok && !(b.tdsEdits["fc:gA"].f || {}).out, "K. a return marked filed: refused (" + k.why + ")");

// ---------------------------------------------------------------- L. the file leaves out what it cannot carry
b = books();
const firm = {tan: "DELL12345A", pan: "AAACL1234M", name: "Leads Insurance", state: "DELHI", pin: "110001", email: "a@b.in", phone: "9999999999", person: "A", personDesignation: "Director", deductorType: "K", flat: "1", town: "Delhi"};
let f = x.TDS26Q.build(FY, Q, firm, "26Q");
ok(f.error && /No challan/.test(f.error), "L. nothing on a challan: no file, the one blocker (" + f.error + ")");
b.challans.push({id: "c1", bsr: "1234567", serial: "70707", date: "20260506", tax: 5000, interest: 0, fee: 0, others: 0, section: "194J", minorHead: "200"});
b.alloc["g37|TDS 94J 10%"] = "c1"; b.alloc["g38|TDS 94J 10%"] = "c1"; x.TDSReg.forget();
const lo = x.TDS26Q.leftOut("26Q", FY, Q);
ok(lo.length === 15 && lo.every(z => z.k === "nochallan"), "L. leftOut: the 15 on no challan (" + lo.length + ")");
f = x.TDS26Q.build(FY, Q, firm, "26Q");
const dd = String(f.text || "").split("\r\n").filter(l => /\^DD\^/.test(l));
ok(!f.error && f.rows === 2 && dd.length === 2 && (f.leftOut || []).length === 15, "L. Form 140 made from the 2 on the challan, 15 left out (" + (f.error || [f.rows, dd.length, (f.leftOut || []).length]) + ")");
ok((f.notes || [])[0] && f.notes[0].startsWith("Left out of the file: 15 on no challan"), "L. the file's own note: " + ((f.notes || [])[0] || "").slice(0, 80));
ok(!/LANDLORD|AMAZON/.test(String(f.text).toUpperCase()), "L. no record of a row left out");

// ---------------------------------------------------------------- I. interest by hand
b = books(); b.vouchers = []; b.tdsEdits = {};
b.tdsAdded = {hw: Object.assign(ADD("ZZ Hand Worked Ltd", "194C", "20260620", 500000, 10000), {credit: "20260415"}), lp: ADD("ZZ Not Paid", "194J", "20260505", 120000, 12000)};
b.challans = [{id: "zzhw", bsr: "0240020", serial: "20090", date: "20260810", tax: 10000, interest: 0, fee: 0, others: 0, section: "194C", minorHead: "200"}]; b.alloc = {"fc:hw": "zzhw"}; x.TDSReg.forget();
const L = x.TDS.interest(FY, Q, "26Q", "20261025");
const hw = L.filter(z => z.row.id === "fc:hw").map(z => [z.kind, z.months, z.amount]).sort();
ok(J(hw) === J([["deduct", 3, 300], ["pay", 3, 450]]), "I. ₹10,000 credited 15-Apr, deducted 20-Jun: 1% x 3 (Apr, May, Jun) = ₹300; paid 10-Aug (due 07-Jul): 1.5% x 3 (Jun, Jul, Aug) = ₹450 (" + J(hw) + ")");
const lp = L.filter(z => z.row.id === "fc:lp").map(z => [z.kind, z.months, z.amount]);
ok(J(lp) === J([["unpaid", 6, 1080]]), "I. ₹12,000 deducted 05-May, not paid: 1.5% x 6 (May to Oct, a part counted whole) = ₹1,080 to 25-Oct (" + J(lp) + ")");
ok(x.TDS.monthsBetween("20260410", "20260512") === 2 && x.TDS.monthsBetween("20260331", "20260502") === 3 && x.TDS.monthsBetween("20260430", "20260501") === 2, "I. months are calendar months, a part counted whole (10-Apr to 12-May: 2; 31-Mar to 02-May: 3; 30-Apr to 01-May: 2)");
ok(x.TDS.dueDate("20260331", "26Q") === "20260430" && x.TDS.dueDate("20260620", "26Q") === "20260707", "I. due: 30-Apr for March, else the 7th of the next month");
const t = x.TDSMatch.interestTable("26Q", FY, Q).totals;
ok(t.interest === 1830 && t.due === 750 && t.unpaid === 1080 && r2(t.due + t.unpaid) === t.interest && t.short === 750, "I. total ₹1,830 = on challans ₹750 + not yet paid ₹1,080; not allocated ₹750 (" + J(t) + ")");
const row = x.TDSMatch.interestTable("26Q", FY, Q).rows.find(r => r.id === "fc:hw");
ok(row && row.int1 === 300 && row.int2 === 450 && row.interest === 750 && row.to === "20260810" && row.due === "20260707", "I. its row: ₹300 at 1%, ₹450 at 1.5%, deposited 10-Aug, due 07-Jul (" + J(row && [row.int1, row.int2, row.to, row.due]) + ")");
const fee = x.TDS.lateFee(FY, Q, "20261025", "26Q");
ok(fee.days === 86 && fee.fee === 17200 && fee.cap === 22000, "I. 234E: 01-Aug to 25-Oct = 86 days x ₹200 = ₹17,200, under the statement's TDS ₹22,000 (" + J(fee) + ")");
const capd = x.TDS.lateFee(FY, Q, "20261231", "26Q");
ok(capd.days === 153 && capd.fee === 22000, "I. 234E capped: 153 days x ₹200 = ₹30,600, the statement's TDS ₹22,000 (" + J(capd) + ")");

// ---------------------------------------------------------------- A. Add deduction: the books already have it (TDSAdd.inBooks)
b = books(); b.tdsAdded = {};
const kb = x.TDSAdd.inBooks({party: "Kiran Srivastava", section: "194J", date: "2026-04-10", credit: "2026-04-10", tds: 8582});
ok(kb && kb.id === "ki7|TDS 94J 2%", "A. Kiran ₹8,582 of 10-Apr typed: Tally's Journal ki7 has it, though corrected to ₹42,910 (" + (kb && kb.id) + ")");
const gb = x.TDSAdd.inBooks({party: "Garg Shekhar & Company", section: "194J", date: "20260430", tds: 1000.6});
ok(gb && gb.id === "g38|TDS 94J 10%", "A. Garg Shekhar & Company ₹1,000.60 of 30-Apr: Tally's \u201cGarg Shekhar & Co.\u201d ₹1,000 (" + (gb && gb.id) + ")");
ok(!x.TDSAdd.inBooks({party: "Garg Shekhar & Company", section: "194J", date: "20260430", tds: 1500}) && !x.TDSAdd.inBooks({party: "Garg Shekhar & Company", section: "194C", date: "20260430", tds: 1000})
  && !x.TDSAdd.inBooks({party: "Garg Shekhar & Company", section: "194J", date: "20260501", tds: 1000}) && !x.TDSAdd.inBooks({party: "Someone Else Ltd", section: "194J", date: "20260430", tds: 1000}),
  "A. not another amount, section, date or deductee");
b.tdsAdded = {gA: ADD("Garg Shekhar & Company", "194J", "20260515", 25000, 2500)}; x.TDSReg.forget();
ok(!x.TDSAdd.inBooks({party: "Garg Shekhar & Company", section: "194J", date: "20260515", tds: 2500}), "A. one added in FinCom is not the books'");

// ---------------------------------------------------------------- R. the deductor's required details (TDSF25.deductorRequired)
const FULL = {tan: "DELL12345A", pan: "AAACL1234M", name: "Leads Insurance", flat: "12", town: "Delhi", state: "DELHI", pin: "110001", email: "a@b.in", phone: "9999999999",
  person: "A", personDesignation: "Director", personPan: "ABCPK1234K", personFlat: "12", personTown: "Delhi"};
const req = (f) => x.TDSF25.deductorRequired(f).map(z => z.k + (z.bad ? "!" : ""));
ok(J(req(FULL)) === "[]", "R. every required detail given: nothing (" + J(req(FULL)) + ")");
ok(J(req(Object.assign({}, FULL, {pin: ""}))) === J(["pin"]) && J(req(Object.assign({}, FULL, {pin: "", personPin: "110002"}))) === J(["pin"]), "R. the deductor's PIN empty: required (the person's is the deductor's when not given)");
ok(J(req(Object.assign({}, FULL, {tan: "DEL12345A"}))) === J(["tan!"]) && J(req(Object.assign({}, FULL, {tan: ""}))) === J(["tan"]), "R. a TAN that is not a TAN, or none");
ok(J(req(Object.assign({}, FULL, {flat: "", town: "", personFlat: " ", state: "Atlantis"}))) === J(["flat", "town", "state", "personFlat"]), "R. address line 1, city / town, a state not of Annexure 1, the person's line 1");
ok(J(req(Object.assign({}, FULL, {flat: "A very long first line of the address, past 25"}))) === "[]" && J(req(Object.assign({}, FULL, {email: "", personEmail: "p@q.in"}))) === "[]", "R. how it is written is not judged (a long line); one e-mail of the two is enough");

console.log(fails.length ? "\nFAILED: " + fails.length : "\nall passed");
process.exit(fails.length ? 1 : 0);
