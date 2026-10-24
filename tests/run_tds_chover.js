// node run_tds_chover.js - a challan is never over-used (next-fix-challan-over; the owner, 24-Oct-2026: Leads Insurance's
// challan 60606 of 30-Apr-2026, ₹2,567, showed "Amount utilised (all returns) ₹4,775.78 · Balance ₹-2,208.78": ₹2,275.78
// of 26Q 2025-26 Q4 from Tally, then a ₹2,500 deduction typed in FinCom put on it with ₹291.22 left). On the app's own code
// (site-test/index.html, or TDSDESK_HTML):
//   G  the guard (TDSAdd.room, src/js/88): adding the ₹2,500 deduction on the challan refused with "Challan 60606 has
//      ₹291.22 left; this deduction's TDS is ₹2,500.00", nothing written; one within ₹1 of what is left kept; moving it on
//      (TDSMatch.move / TDSCH.tag) or choosing the challan when editing it refused; TDS corrected on a deduction that stays
//      on its challan is a correction (kept), the challan then over its tax the return's error
//   A  Place automatically (TDSAuto.run) never puts it there
//   O  books over-used before (an old allocation): not changed by itself; the return using it (26Q 2025-26 Q4) has the
//      error in Validate & file (TDSMatch.checks "over", TDSReg.overUsed); the over-used deduction can still be corrected
//      (its date) and taken off
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML, TM_NAMES} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "money", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES", "TDSF25", "Market", "monthName", "TDSAdd", "TDSEdit", "TDSSep",
  "TDSMatch", "PANCheck", "TDSPanFix", "TDSAuto", "TDS_REMARK", "TDSDecl", "TDSAudit"].concat(TM_NAMES);
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
ok(have.includes("TDSAdd") && have.includes("TDSAuto"), "the app has TDSAdd and TDSAuto");
const {ctx, x} = load(HTML, have);
ctx.S.companies = {t: {id: "t", name: "Leads Insurance", tan: "DELL12345A", pan: "AAACL1234M"}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {};
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {}; ctx.S.firm = {};
ctx.istToday = () => "20261024";
ok(typeof x.TDSAdd.room === "function", "G. TDSAdd.room, the guard of a placing outside TDSCH.tag");

const FY = "2025-26", Q = "Q4", K = "26Q|2025-26|Q4";
const V = (id, date, party, exp, tds, led) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: r2(exp - tds)}, {l: led, a: tds}, {l: "Exp " + led, a: -exp}]});
function r2(v){ return Math.round(v * 100) / 100; }
const MAP = {"TDS 94J 2%": {kind: "tds_payable", section: "194J"}, "Bank": {kind: "bank"}};
const CH = {id: "chmvd92j2nq35qd", bsr: "1234567", serial: "60606", date: "20260430", tax: 2567, interest: 0, fee: 0, others: 0, section: "194J", minorHead: "200"};
const ROW = "v456c|TDS 94J 2%";
function books(alloc, added){
  const b = {cid: "t", vouchers: [V("v456c", "20260101", "Animall Technologies", 113789, 2275.78, "TDS 94J 2%")], map: JSON.parse(J(MAP)), challans: [Object.assign({}, CH)],
    alloc: Object.assign({[ROW]: CH.id}, alloc || {}), tdsAdded: added || {}, certs: [], pans: {"Animall Technologies": "AAICA1234B", "Garg Shekhar & Company": "AAFFG1234C"}, nrInfo: {}};
  ctx.S.books = b; ctx.S.tdsFy = FY; ctx.S.tdsQ = Q; x.TDSReg.forget(); return b;
}
const bal = () => { x.TDSReg.forget(); return x.TDSReg.balance(x.TDS.challans()[0]).tax; };
const GARG = {party: "Garg Shekhar & Company", section: "194J", credit: "2026-03-31", date: "2026-03-31", paid: 25000, rate: 10, tds: 2500};

// ---------------------------------------------------------------- G. the guard
let b = books();
ok(x.TDS.rows().some(r => r.id === ROW && r.fy === FY && r.q === Q && r.challan === CH.id), "G. the fixture: Animall's ₹2,275.78 of 26Q 2025-26 Q4 on challan 60606 (" + J(x.TDS.rows().map(r => [r.id, r.fy, r.q, r.tds, r.challan])) + ")");
ok(Math.abs(bal() - 291.22) < 0.005, "G. challan 60606: ₹2,567 − ₹2,275.78 = ₹291.22 left (" + bal() + ")");
let res = x.TDSAdd.save(Object.assign({}, GARG, {challan: CH.id}));
ok(!res.ok && res.why.startsWith("Challan 60606 has ₹291.22 left; this deduction's TDS is ₹2,500.00"), "G. the hand-added ₹2,500 on it refused, in words: " + res.why);
ok(!Object.keys(b.tdsAdded || {}).length && Object.keys(b.alloc).length === 1 && Math.abs(bal() - 291.22) < 0.005, "G. nothing written: no deduction kept, the challan's balance ₹291.22 (" + J(b.alloc) + ")");
res = x.TDSAdd.save(Object.assign({}, GARG, {paid: 2920, tds: 292, challan: CH.id}));
ok(res.ok && Math.abs(bal() - (-0.78)) < 0.005, "G. one within ₹1 of what is left (₹292.00 on ₹291.22) kept (" + J(res) + ", balance " + bal() + ")");
const small = res.key;
res = x.TDSAdd.save(Object.assign({}, GARG, {paid: 2925, tds: 292.5, challan: CH.id}), small);
ok(res.ok && Math.abs(bal() - (-1.28)) < 0.005 && x.TDSReg.overUsed(FY, Q, "26Q").length === 1, "G. its TDS corrected while it stays on the challan: a correction, kept; the challan then over its tax is the return's error (" + J(res) + ", balance " + bal() + ")");
x.TDSAdd.remove(small, "test"); b = books();
res = x.TDSAdd.save(Object.assign({}, GARG));
ok(res.ok && !b.alloc[res.id], "G. the ₹2,500 kept on no challan (" + J(res) + ")");
const fc = res.id;
res = x.TDSMatch.move([fc], CH.id);
ok(!res.ok && /291\.22 left on this challan/.test(res.why) && !b.alloc[fc], "G. moving it onto challan 60606 refused (TDSCH.tag): " + res.why);
res = x.TDSAdd.save(Object.assign({}, GARG, {challan: CH.id}), fc.slice(3));
ok(!res.ok && /^Challan 60606 has ₹291\.22 left/.test(res.why) && !b.alloc[fc], "G. editing it and choosing challan 60606 refused: " + res.why);
ok(x.TDSAdd.room(CH.id, 2275.78, ROW) === "" && x.TDSAdd.room(CH.id, 2566, ROW) === "" && /has ₹2,567\.00 left; this deduction's TDS is ₹2,600\.00/.test(x.TDSAdd.room(CH.id, 2600, ROW)),
  "G. a deduction on the challan: its TDS may grow to what is left plus its own, not past (" + x.TDSAdd.room(CH.id, 2600, ROW) + ")");

// ---------------------------------------------------------------- A. Place automatically
res = x.TDSAuto.run("26Q", FY, Q);
ok(res.ok && !b.alloc[fc] && bal() >= -0.005, "A. Place automatically never puts the ₹2,500 on challan 60606 (" + J({placed: res.placed, suggested: res.suggested, need: res.need, why: res.why}) + ", balance " + bal() + ")");
const sg = (() => { try { return x.TDSMatch.suggest("26Q", FY, Q); } catch (e){ return []; } })();
ok(!sg.some(s => s.chId === CH.id && s.ids.includes(fc)), "A. nor suggests it there whole (" + J(sg.map(s => s.chId + ":" + s.ids)) + ")");

// ---------------------------------------------------------------- O. over-used before
b = books({["fc:mvkzxln6ag1e"]: CH.id}, {mvkzxln6ag1e: {party: "Garg Shekhar & Company", section: "194J", date: "20260331", credit: "", paid: 25000, tds: 2500, rate: 10, by: "test@test.com", at: "2026-10-23T13:19:00Z", log: [{act: "add"}]}});
const was = J(b.alloc);
ok(Math.abs(bal() - (-2208.78)) < 0.005 && Math.abs(x.TDSReg.usedTax(x.TDS.challans()[0]) - 4775.78) < 0.005, "O. the owner's books: used ₹4,775.78, balance ₹-2,208.78 (" + bal() + ")");
x.TDSReg.forget();
const uses = x.TDSReg.ctx().uses[CH.id] || {};
ok(J(Object.keys(uses)) === J([K]) && Math.abs(uses[K].tax - 4775.78) < 0.005, "O. where it is used: 26Q 2025-26 Q4 alone, ₹4,775.78 (" + J(Object.keys(uses)) + ")");
ok(x.TDSReg.overUsed(FY, Q, "26Q").length === 1 && !x.TDSReg.overUsed("2026-27", "Q1", "26Q").length, "O. over-used counted in 26Q 2025-26 Q4 (its To fix), not in 2026-27 Q1");
const ch = x.TDSMatch.checks("26Q", FY, Q), blk = ch.block.find(z => z.k === "over");
ok(blk && /Challan 1234567\/30-Apr-2026\/60606 is used ₹2,208\.78 beyond its tax/.test(blk.words), "O. Validate & file of 26Q 2025-26 Q4: the error (" + (blk && blk.words) + ")");
ok(J(b.alloc) === was, "O. the books over-used before are not changed by themselves");
res = x.TDSAdd.save(Object.assign({}, GARG, {date: "2026-03-30", credit: "2026-03-30"}), "mvkzxln6ag1e");
ok(res.ok && b.alloc["fc:mvkzxln6ag1e"] === CH.id && J(Object.keys(b.alloc).sort()) === J(Object.keys(JSON.parse(was)).sort()), "O. the over-used deduction can still be corrected (its date), on the same challan (" + J(res) + ")");
res = x.TDSMatch.takeOff(["fc:mvkzxln6ag1e"]);
ok(res.ok && !b.alloc["fc:mvkzxln6ag1e"] && Math.abs(bal() - 291.22) < 0.005 && !x.TDSReg.overUsed(FY, Q, "26Q").length, "O. taken off: ₹291.22 left again, no error (the owner's fix)");

console.log(fails.length ? "\nFAILED: " + fails.length : "\nall passed");
process.exit(fails.length ? 1 : 0);
