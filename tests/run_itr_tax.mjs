// node tests/run_itr_tax.mjs - the Computation of Income, AY 2026-27 (app/src/lib/itr/tax.js), on figures worked out by
// hand: slabs of both regimes, 87A with its marginal relief, the surcharge bands with marginal relief (individual, firm,
// company), 115BAA, MAT and its credit, 40(b), 44AD / 44ADA / 44AE and their thresholds, loss set-off and carry-forward,
// Chapter VI-A limits, 234A / 234B / 234C / 234F, 43B and 36(1)(va) by their dates, rounding. Then the second computation
// (check.js) against the first on 600 made-up returns, and a planted difference caught.
import { compute, limit40b, presumptive, monthsAfter, interest } from "../app/src/lib/itr/tax.js";
import { check, differences, KEYS } from "../app/src/lib/itr/check.js";
import { adjustments, pf36va, dues43B } from "../app/src/lib/itr/books.js";

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(a === b, w + " (" + a + (a === b ? "" : " ≠ " + b) + ")");
const biz = (pbt, o = {}) => Object.assign({ form: "ITR-3", entity: "P", regime: "new", age: 40, business: { pbt, adds: [], less: [] } }, o);
const L = (x) => compute(x).liability;

console.log("new regime and 87A (115BAC(1A), 87A as amended by the Finance Act 2025)");
eq(L(biz(1200000)), 0, "TI 12,00,000: tax 60,000, rebate 60,000");
eq(compute(biz(1210000)).tax.rebate, 51500, "TI 12,10,000: marginal relief, rebate 51,500 (tax limited to the 10,000 above 12 lakh)");
eq(L(biz(1210000)), 10400, "TI 12,10,000: 10,000 + cess 400");
eq(L(biz(1275000)), 74100, "TI 12,75,000: tax 71,250 is below the 75,000 above 12 lakh: no relief, + cess");
eq(L(biz(400000)), 0, "TI 4,00,000: nil slab");
eq(L(biz(2500000)), 4.5e5 * 0 + Math.round((20000 + 40000 + 60000 + 80000 + 100000 + 30000) * 1.04), "TI 25,00,000: every slab, + cess");
console.log("old regime");
eq(L(biz(500000, { regime: "old" })), 0, "TI 5,00,000: rebate 12,500");
eq(L(biz(500010, { regime: "old" })), 13002, "TI 5,00,010: no rebate (12,502 + cess 500)");
eq(L(biz(600000, { regime: "old", age: 65 })), 31200, "senior: exemption 3 lakh (30,000 + cess)");
eq(L(biz(600000, { regime: "old", age: 82 })), 20800, "super senior: exemption 5 lakh (20,000 + cess)");
eq(compute(biz(600000, { regime: "old", entity: "H", age: 82 })).tax.normalTax, 32500, "an HUF has no senior slabs");
eq(compute(biz(450000, { entity: "H", regime: "new" })).tax.rebate, 0, "no 87A for an HUF");
console.log("surcharge and marginal relief");
eq(compute(biz(5000000, { regime: "old" })).tax.sur, 0, "old, TI 50 lakh: no surcharge");
const s1 = compute(biz(5010000, { regime: "old" }));
eq(s1.tax.sur, 7000, "old, TI 50,10,000: surcharge cut to 7,000 by marginal relief"); eq(s1.liability, 1375400, "old, TI 50,10,000: liability");
eq(compute(biz(5010000)).tax.sur, 7000, "new, TI 50,10,000: marginal relief, 7,000");
eq(compute(biz(60000000)).tax.sur, Math.round(compute(biz(60000000)).tax.normalTax * 0.25), "new regime, TI 6 crore: surcharge capped at 25%");
eq(compute(biz(60000000, { regime: "old" })).tax.sur, Math.round(compute(biz(60000000, { regime: "old" })).tax.normalTax * 0.37), "old regime, TI 6 crore: 37%");
const sp = compute(biz(30000000, { cg: { s111A: 5000000 } }));
eq(sp.tax.sur, Math.round(sp.tax.normalTax * 0.25 + sp.tax.specialTax * 0.15), "on 111A income the surcharge is at most 15%");
const firm = (pbt, o) => Object.assign({ form: "ITR-5", entity: "F", regime: "firm", business: { pbt, adds: [], less: [] } }, o || {});
eq(L(firm(10050000)), 3172000, "firm, TI 1,00,50,000: 12% surcharge cut to 35,000 (marginal relief)");
eq(L(firm(1000000)), 312000, "firm, TI 10 lakh: 30% + cess, no rebate");
const co = (pbt, o) => Object.assign({ form: "ITR-6", entity: "C", regime: "normal", smallCo: true, business: { pbt, adds: [], less: [] } }, o || {});
eq(L(co(100100000)), 27924000, "company 25%, TI 10,01,00,000: the 12% band cut by marginal relief");
eq(compute(co(10000000, { smallCo: false })).tax.normalTax, 3000000, "company above Rs 400 crore turnover: 30%");
eq(L(co(10000000, { regime: "115BAA" })), 2516800, "115BAA, TI 1 crore: 25.168%");
console.log("MAT (115JB) and its credit (115JAA)");
const m1 = compute(co(1000000, { bookProfit: 5000000 }));
eq(m1.liability, 780000, "book profit 50 lakh: MAT 7,50,000 + cess is above the normal 2,60,000: MAT payable");
ok(m1.tax.mat.applies && m1.tax.mat.credit === 520000, "the MAT credit of the year (5,20,000) is worked out");
eq(L(co(1000000, { bookProfit: 1000000, matCredit: 50000 })), 210000, "normal tax above MAT: 50,000 of MAT credit set off");
eq(L(co(1000000, { bookProfit: 1000000, matCredit: 500000 })), 156000, "the credit only down to the MAT (1,56,000)");
ok(compute(co(1000000, { regime: "115BAA", bookProfit: 9e6, matCredit: 1000 })).tax.mat === null, "no MAT under 115BAA");
console.log("40(b) (Finance (No. 2) Act 2024)");
eq(limit40b(500000), 450000, "book profit 5 lakh: 90% (4,50,000)"); eq(limit40b(200000), 300000, "book profit 2 lakh: 3 lakh");
eq(limit40b(-100000), 300000, "a loss: 3 lakh"); eq(limit40b(1000000), 780000, "10 lakh: 5.4 lakh + 60% of 4 lakh");
const f40 = compute(firm(400000, { partners: [{ remuneration: 900000, interest: 100000, rate: 18 }] }));
ok(f40.p40b.interestAdd === 33333 && f40.p40b.bookProfit === 1333333 && f40.p40b.limit === 980000 && f40.p40b.remAdd === 0, "interest above 12% added back (33,333); remuneration within the limit");
const f41 = compute(firm(-500000, { partners: [{ remuneration: 900000 }] }));
eq(f41.p40b.remAdd, 540000, "a firm with book profit 4 lakh: 9 lakh paid, 3.6 lakh (90%) allowed, 5.4 lakh added back");
eq(compute(firm(100000, { partners: [{ remuneration: 200000, working: false }] })).p40b.remAdd, 200000, "a sleeping partner's remuneration is not allowed");
console.log("presumptive income");
const p1 = presumptive({ ad: { digital: 10000000, other: 2000000 } }, "P");
ok(p1.income === 760000 && !p1.needs.length, "44AD: 6% of 1 crore + 8% of 20 lakh = 7,60,000");
ok(!presumptive({ ad: { digital: 24000000, other: 1000000 } }, "P").needs.length, "44AD: 2.5 crore with cash 4%: within the 3 crore limit");
ok(presumptive({ ad: { digital: 22000000, other: 3000000 } }, "P").needs.some((n) => n.key === "44ad_limit"), "44AD: 2.5 crore with cash 12%: above the 2 crore limit (Needs you)");
ok(presumptive({ ad: { digital: 1000000, other: 0, declared: 50000 } }, "P").needs.some((n) => n.key === "44ad_low"), "44AD: declared below 6%: Needs you");
ok(presumptive({ ad: { digital: 1000000, other: 0 } }, "F", true).needs.some((n) => n.key === "44ad_entity"), "44AD is not for an LLP");
ok(presumptive({ ada: { receipts: 6000000, cash: 200000 } }, "P").income === 3000000, "44ADA: 50% of 60 lakh (cash 3.3%: 75 lakh limit)");
ok(presumptive({ ada: { receipts: 6000000, cash: 600000 } }, "P").needs.some((n) => n.key === "44ada_limit"), "44ADA: 60 lakh with cash 10%: above 50 lakh");
ok(presumptive({ ada: { receipts: 100000 } }, "H").needs.some((n) => n.key === "44ada_entity"), "44ADA is not for an HUF");
eq(presumptive({ ae: { vehicles: [{ gvwKg: 15500, months: 12 }, { gvwKg: 7000, months: 6.2 }] } }, "P").income, 192000 + 52500, "44AE: 16 tons x 1,000 x 12 + 7,500 x 7 months");
const r4 = compute({ form: "ITR-4", entity: "P", regime: "new", presumptive: { ad: { digital: 4000000, other: 500000 } }, paid: { advance: [{ date: "20260310", amt: 1000 }] } });
eq(r4.heads.pgbp, 280000, "ITR-4: business income from 44AD");
console.log("losses (sections 70-80)");
const l1 = compute(biz(-300000, { os: { interest: 100000 }, business: { pbt: -300000, adds: [], less: [], itDep: 0 } }));
ok(l1.gti === 0 && l1.carry.business[0].amt === 200000, "business loss set off against other sources, 2 lakh carried forward");
const l2 = compute(biz(0, { os: { interest: 100000 }, business: { pbt: -50000, adds: [], less: [], itDep: 250000 } }));
ok(l2.carry.unabsorbedDep === 200000 && !l2.carry.business.length, "a loss from depreciation is unabsorbed depreciation (no time limit)");
const l3 = compute(biz(500000, { losses: { business: [{ ay: "2017", amt: 100000 }, { ay: "2018", amt: 150000 }], unabsorbedDep: 50000 } }));
ok(l3.gti === 300000 && l3.warn.some((w) => w.key === "lapsed"), "AY 2017-18's loss has lapsed (8 years); 2018-19's and the unabsorbed depreciation are set off");
ok(compute(biz(-100000, { filingDate: "20261120", business: { pbt: -100000, adds: [], less: [] } })).warn.some((w) => w.key === "s80"), "late return: this year's business loss is not carried forward (section 80)");
const l4 = compute(biz(500000, { regime: "old", salary: { gross: 600000, std: 50000 }, hp: -300000 }));
ok(l4.gti === 500000 + 550000 - 200000, "house property loss: 2 lakh set off in the old regime");
ok(compute(biz(500000, { hp: -300000 })).gti === 500000, "no house property loss set off in the new regime");
ok(compute(biz(-800000, { salary: { gross: 1000000, std: 75000 } })).gti === 925000, "a business loss is never set off against salary");
console.log("Chapter VI-A");
const d1 = compute(biz(1000000, { regime: "old", deductions: { "80C": 200000, "80TTA": 15000 } }));
ok(d1.ded === 160000 && d1.warn.some((w) => w.key === "via_80C"), "old: 80C capped at 1.5 lakh, 80TTA at 10,000");
const d2 = compute(biz(1000000, { salary: { gross: 800000, std: 75000 }, deductions: { "80C": 150000, "80CCD2": 50000 } }));
ok(d2.ded === 50000 && d2.warn.some((w) => w.key === "via_80C"), "new regime: 80C left out, 80CCD(2) allowed (within 14% of salary)");
ok(compute(biz(100000, { regime: "old", cg: { s111A: 300000 }, deductions: { "80C": 150000 } })).ded === 100000, "deductions never against special-rate income");
console.log("special rates");
const c1 = compute(biz(300000, { cg: { s111A: 200000 } }));
ok(c1.tax.specialTax === 20000 && c1.tax.rebate === 0 && c1.liability === 20800, "new regime: the unused exemption against 111A; no 87A on special-rate tax (confirm)");
eq(compute(biz(1000000, { cg: { s112A: 225000 } })).tax.specialTax, 12500, "112A: 12.5% above 1.25 lakh");
console.log("rounding (288A, 288B)");
eq(compute(biz(744565)).ti, 744570, "total income to the nearest 10");
eq(compute(biz(1300000, { paid: { tds: [{ amt: 1234 }] } })).payable % 10, 0, "payable to the nearest 10");
console.log("interest and fee");
eq(monthsAfter("20260831", "20261115"), 3, "234A months: 31-08 to 15-11 is 3"); eq(monthsAfter("20260831", "20260901"), 1, "one day late is a month"); eq(monthsAfter("20260331", "20261115"), 8, "234B months: April to November is 8");
const i1 = interest({ liability: 100000, due: "20260831", filing: "20261115", advance: [], sa: [], ti: 900000 });
ok(i1.a === 3000 && i1.b === 8000 && i1.c === 450 + 1350 + 2250 + 1000 && i1.f === 5000, "tax 1 lakh unpaid, filed 15-11-2026: 234A 3,000, 234B 8,000, 234C 5,050, 234F 5,000");
const i2 = interest({ liability: 100000, due: "20260831", filing: "20261115", advance: [], sa: [{ date: "20260910", amt: 100000 }], ti: 900000 });
ok(i2.a === 1000 && i2.b === 6000, "self-assessment tax paid 10-09-2026: 234A 1 month, 234B 6 months");
const i3 = interest({ liability: 100000, due: "20260831", filing: "20260731", advance: [{ date: "20250610", amt: 15000 }, { date: "20250910", amt: 30000 }, { date: "20251210", amt: 30000 }, { date: "20260310", amt: 25000 }], sa: [], ti: 900000 });
ok(i3.a === 0 && i3.b === 0 && i3.c === 0 && i3.f === 0, "every instalment on time, filed in time: no interest, no fee");
const i4 = interest({ liability: 100000, due: "20260831", filing: "20260731", advance: [{ date: "20250610", amt: 12000 }, { date: "20250910", amt: 24000 }, { date: "20251210", amt: 39000 }, { date: "20260310", amt: 25000 }], sa: [], ti: 900000 });
eq(i4.c, 0, "234C: 12% by June and 36% by September are safe");
eq(interest({ liability: 100000, due: "20260831", filing: "20260731", advance: [{ date: "20260310", amt: 90000 }], sa: [], presumptive: true, ti: 900000 }).c, 100, "44AD / 44ADA: one instalment by 15 March (shortfall 10,000, 1 month)");
ok(interest({ liability: 9000, due: "20260831", filing: "20260731", advance: [], sa: [] }).b === 0, "tax below 10,000: no advance tax, no 234B / 234C");
eq(interest({ liability: 0, due: "20260831", filing: "20261001", advance: [], sa: [], ti: 450000 }).f, 1000, "234F: 1,000 when total income is up to 5 lakh");
console.log("43B and 36(1)(va) by their dates");
const pv = pf36va([{ wageMonth: "202504", data: { ee: 5040 } }, { wageMonth: "202505", data: { ee: 5000 } }, { wageMonth: "202603", data: { ee: 4000 } }],
  [{ wageMonth: "202504", paidOn: "20250515" }, { wageMonth: "202505", paidOn: "20250616" }, { wageMonth: "202603", paidOn: "20260414" }], [{ wageMonth: "202512", paidOn: "20260116", data: { ee: 375 } }]);
ok(!pv.find((x) => x.ym === "202504").late, "PF for April paid on 15 May: in time");
ok(pv.find((x) => x.ym === "202505").late && pv.find((x) => x.ym === "202505").due === "20250615", "PF for May paid on 16 June: late (due 15 June, no grace)");
ok(!pv.find((x) => x.ym === "202603").late && pv.find((x) => x.ym === "202603").due === "20260415", "PF for March paid 14 April 2026: in time (due 15 April)");
ok(pv.find((x) => x.fund === "ESI").late && pv.find((x) => x.fund === "ESI").due === "20260115", "ESI for December paid 16 January: late (December's due date crosses the year)");
const a1 = adjustments({ dues43B: dues43B([{ ledger: "PF PAYABLE", closing: 20000 }, { ledger: "BONUS PAYABLE", closing: 50000 }], [{ ledger: "PF PAYABLE", date: "20260415", amt: 20000 }, { ledger: "BONUS PAYABLE", date: "20260820", amt: 5000 }], "20260831", "20260930", { pf: 1 }), pf36va: pv });
ok(a1.adds.find((a) => a.key === "43b").amt === 45000, "43B: bonus payable 50,000, 5,000 paid by the due date: 45,000 added back; PF paid in full: nothing");
ok(a1.adds.find((a) => a.key === "36va").amt === 5375, "36(1)(va): the late months' employees' share added back (5,000 + 375)");
ok(pf36va([{ wageMonth: "202506", data: { ee: 900 } }], [], []).every((x) => !x.late && x.missing), "36(1)(va): no challan is not late (Missing data), never disallowed");
ok(a1.adds.find((a) => a.key === "43b").bp === "AmtDebPLDisallowUs43B" && a1.adds.find((a) => a.key === "36va").bp === "AmtDebPLDisallowUs36", "each goes to its own Schedule BP line");
const a2 = adjustments({ tdsMissed: [{ party: "X", section: "194C", base: 100000 }], tdsUnpaid: [{ party: "Z", section: "194J", base: 40000 }], nrMissed: [{ party: "W INC", section: "195", base: 70000 }], cash40A3: [{ date: "20250901", party: "Y", amount: 15000 }], bookDep: 1000, itDep: 900 });
ok(a2.adds.find((a) => a.key === "40aia").amt === 42000 && a2.adds.find((a) => a.key === "40ai").amt === 70000 && a2.adds.find((a) => a.key === "40a3").amt === 15000 && a2.itDep === 900, "40(a)(ia) 30% of not deducted (1L) and not deposited by the due date (40,000); 40(a)(i) 100% for the non-resident; 40A(3) in full; section 32 allowed");

console.log("golden cases (hand-worked, CA style): 87A, Chapter VI-A, the company rate");
// 87A, new regime (the reading the owner will confirm): eligibility on TOTAL income, special-rate income included; the
// rebate (and its marginal relief) only ever against the tax on normal income
const g1 = compute(biz(1100000, { cg: { s111A: 80000 } }));
ok(g1.ti === 1180000 && g1.tax.normalTax === 50000 && g1.tax.rebate === 50000 && g1.tax.specialTax === 16000 && g1.liability === 16640, "G1 new: business 11L + 111A 80,000 (TI 11.8L): rebate 50,000 on the normal tax only; 111A tax 16,000 + cess = 16,640");
const g2 = compute(biz(1100000, { cg: { s111A: 200000 } }));
ok(g2.ti === 1300000 && g2.tax.rebate === 0 && g2.liability === 93600, "G2 new: business 11L + 111A 2L (TI 13L): the whole tax (90,000) is below the 1L above 12L, so no relief; 93,600");
const g2b = compute(biz(1160000, { cg: { s111A: 50000 } }));
ok(g2b.ti === 1210000 && g2b.tax.rebate === 56000 && g2b.liability === 10400, "G2b new: TI 12.1L with 111A 50,000: total tax 66,000 limited to the 10,000 above 12L, the relief (56,000) only from the normal tax; 10,400");
ok(compute(biz(1300000)).tax.rebate === 0 && compute(biz(1210000)).tax.rebate === 51500, "G2c new: plain business income, the marginal relief as before");
// 87A, old regime: total income up to 5L; against normal, 111A and 112 tax, never 112A
const g3 = compute(biz(300000, { regime: "old", cg: { s112: 180000 } }));
ok(g3.ti === 480000 && g3.tax.rebate === 12500 && g3.liability === 13000, "G3 old: business 3L + 112 LTCG 1.8L: rebate 12,500 (112 tax eligible); 13,000");
const g4 = compute(biz(150000, { regime: "old", cg: { s112A: 330000 } }));
ok(g4.ti === 480000 && g4.tax.rebate === 0 && g4.tax.specialTax === 13125 && g4.liability === 13650, "G4 old: normal 1.5L + 112A 3.3L: the unused 1L exemption against 112A, 1.05L above 1.25L at 12.5% = 13,125; no rebate on 112A; 13,650");
// the unused exemption first against 111A (20%), then 112 (12.5%), then 112A
const g5 = compute(biz(200000, { cg: { s111A: 300000, s112: 100000 } }));
ok(g5.tax.specialTax === 32500 && g5.tax.rebate === 0 && g5.liability === 33800, "G5 new: normal 2L, 111A 3L, 112 1L: the 2L unused against 111A first: 20,000 + 12,500 = 32,500; 33,800");
// Chapter VI-A, old regime, age 40, salary 10L (private employer)
const g6 = compute(biz(1500000, { regime: "old", salary: { gross: 1000000, std: 50000 }, deductions: { "80C": 160000, "80D_self": 30000, "80D_parents": 60000, parentsSenior: true, "80DD": 90000, "80DDB": 50000, "80U": 140000, uSevere: true, "80CCD2": 120000, "80TTA": 12000 } }));
ok(g6.ded === 150000 + 25000 + 50000 + 75000 + 40000 + 125000 + 100000 + 10000, "G6 old: 80C 1.5L, 80D 25k + 50k (senior parents), 80DD 75k, 80DDB 40k, 80U 1.25L (severe), 80CCD(2) 10% of salary = 1L, 80TTA 10k = " + g6.ded);
const g6s = compute(biz(1500000, { regime: "old", age: 65, deductions: { "80D_self": 70000, "80TTA": 10000, "80TTB": 70000, "80DDB": 120000 } }));
ok(g6s.ded === 50000 + 50000 + 100000 && g6s.warn.some((w) => w.key === "via_80TTA"), "G6s old, senior: 80D 50k, 80TTB 50k (80TTA not for a senior), 80DDB 1L (senior patient): " + g6s.ded);
const g6g = compute(biz(1000000, { regime: "old", deductions: { "80C": 150000, "80CCD1B": 50000, "80G": [{ amt: 200000, pct: 50, qualifying: true }, { amt: 20000, pct: 100, qualifying: false }, { amt: 5000, pct: 100, qualifying: false, cash: 5000 }] } }));
ok(g6g.ded === 150000 + 50000 + 40000 + 20000, "G6g 80G: adjusted GTI 8L, qualifying limit 80,000 at 50% = 40,000; 100% without limit 20,000; a cash donation above 2,000 nothing: " + g6g.ded);
// new regime, individual: only 80CCD(2) at 14% of salary, 80CCH (and 80JJAA, section 115BAC(2)(ii))
const g7 = compute(biz(500000, { salary: { gross: 1000000, std: 75000 }, deductions: { "80C": 150000, "80CCD2": 200000, "80CCH": 10000, "80D_self": 25000 } }));
ok(g7.ded === 140000 + 10000 && g7.warn.some((w) => w.key === "via_80C") && g7.warn.some((w) => w.key === "via_80CCD2"), "G7 new: 80CCD(2) 14% of 10L = 1.4L, 80CCH 10k; 80C and 80D left out: " + g7.ded);
ok(compute(biz(500000, { regime: "old", salary: { gross: 1000000, std: 50000 }, deductions: { "80CCD2": 200000, govtEmployer: true } })).ded === 140000, "G7b old, government employer: 80CCD(2) 14%");
// companies: 115BAA allows only 80JJAA and 80M; the 25% rate is asked, never assumed
const g8 = compute(co(5000000, { regime: "115BAA", deductions: { "80IAC": 1000000, "80G": [{ amt: 100000, pct: 100, qualifying: false }], "80JJAA": 200000 } }));
ok(g8.ded === 200000 && g8.warn.some((w) => w.key === "via_80IAC") && g8.warn.some((w) => w.key === "via_80G"), "G8 115BAA: 80IAC and 80G not allowed, 80JJAA allowed");
ok(compute(co(5000000, { regime: "normal", deductions: { "80IAC": 1000000 } })).ded === 1000000, "G8b normal company: 80IAC allowed");
const g9 = compute(co(5000000, { smallCo: undefined }));
ok(g9.needs.some((n) => n.key === "small_co"), "G9 company, the FY 2023-24 turnover not answered: Needs you (the 25% rate is never assumed)");
ok(compute(co(5000000, { bookProfit: 4000000 })).needs.some((n) => n.key === "mat_bp"), "MAT: book profit not confirmed with the 115JB adjustments: Needs you");
ok(!compute(co(5000000, { bookProfit: 4000000, bookProfitOk: true })).needs.some((n) => n.key === "mat_bp"), "MAT: book profit confirmed: no question");
// 234C: one instalment only for 44AD / 44ADA, not 44AE
const r44ae = compute({ form: "ITR-4", entity: "P", regime: "new", age: 40, presumptive: { ae: { vehicles: Array.from({ length: 10 }, () => ({ gvwKg: 40000, months: 12 })) } }, paid: { advance: [{ date: "20260310", amt: 400000 }] } });
ok(r44ae.interest.cParts.length === 4, "44AE alone: the four instalments of 234C (one instalment is only for 44AD / 44ADA)");
ok(compute(biz(-100000, { filingDate: "20261120", business: { pbt: -100000, adds: [], less: [] } })).carry.business.length === 0, "a belated return: this year's business loss is not carried forward");

console.log("the second computation against the first");
let seed = 20262027; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)], amt = (m) => Math.round(rnd() * m);
let agree = 0, firstDiff = null;
for (let i = 0; i < 600; i++) {
  const ent = pick(["P", "P", "H", "F", "C"]), form = ent === "C" ? "ITR-6" : ent === "F" ? "ITR-5" : pick(["ITR-3", "ITR-4"]);
  const m = { form, entity: ent, age: pick([30, 45, 62, 81]), regime: ent === "C" ? pick(["normal", "115BAA"]) : ent === "F" ? "firm" : pick(["new", "old"]), smallCo: pick([true, false, undefined]), audit: rnd() < 0.3, filingDate: pick(["", "20260731", "20260915", "20261115", "20261230"]) };
  if (form === "ITR-4") m.presumptive = { ad: { digital: amt(2e7), other: amt(3e6) }, ada: rnd() < 0.3 ? { receipts: amt(6e6), cash: amt(2e5) } : undefined };
  else { m.business = { pbt: amt(4e8) - (rnd() < 0.15 ? 2e8 : 0), adds: [{ key: "x", label: "x", amt: amt(2e5) }], less: [{ key: "y", label: "y", amt: amt(1e5) }], itDep: rnd() < 0.5 ? amt(3e5) : undefined };
    if (rnd() < 0.2) m.business.pbt = amt(2e6) - 1e6; }
  if (ent === "F") m.partners = [{ remuneration: amt(3e6), interest: amt(3e5), rate: pick([10, 12, 15, 18]), working: rnd() < 0.9 }];
  if (ent === "C" && rnd() < 0.6) { m.bookProfit = amt(5e8); m.matCredit = amt(1e6); }
  if (rnd() < 0.4) m.os = { interest: amt(4e5), dividend: amt(1e5) };
  if (rnd() < 0.3 && ent !== "C") m.salary = { gross: amt(2e6), std: 75000 };
  if (rnd() < 0.3) m.cg = { s111A: amt(5e6), s112A: amt(3e6), s112: amt(1e6) };
  if (rnd() < 0.2) m.hp = amt(4e5) - 2e5;
  if (rnd() < 0.3) m.losses = { business: [{ ay: pick(["2016", "2019", "2023"]), amt: amt(5e5) }], unabsorbedDep: amt(2e5) };
  if (rnd() < 0.4) m.deductions = { "80C": amt(2e5), "80D_self": amt(6e4), "80D_parents": amt(6e4), parentsSenior: rnd() < 0.5, "80G": [{ amt: amt(2e5), pct: pick([50, 100]), qualifying: rnd() < 0.5, cash: amt(5000) }], "80CCD2": amt(2e5),
    "80TTA": amt(2e4), "80TTB": amt(6e4), "80DD": amt(1.5e5), ddSevere: rnd() < 0.5, "80DDB": amt(1.2e5), ddbSenior: rnd() < 0.5, "80U": amt(1.5e5), uSevere: rnd() < 0.5, "80CCH": amt(2e4), "80JJAA": amt(1e5), "80IAC": amt(1e5), "80M": amt(5e4), "80GGC": amt(3e4) };
  if (rnd() < 0.2) m.age = 65;
  m.paid = { tds: [{ amt: amt(3e5) }], tcs: [{ amt: amt(1e4) }], advance: [{ date: "20250612", amt: amt(1e6) }, { date: "20250914", amt: amt(1e6) }, { date: "20251215", amt: amt(1e6) }, { date: "20260313", amt: amt(1e6) }].filter(() => rnd() < 0.7), selfAssessment: rnd() < 0.4 ? [{ date: pick(["20260720", "20261005"]), amt: amt(5e5) }] : [] };
  const d = differences(compute(m).key, check(m));
  if (!d.length) agree++; else if (!firstDiff) firstDiff = { m, d };
}
ok(agree === 600, "600 made-up returns, every entity and form: the two computations agree on all " + KEYS.length + " figures" + (firstDiff ? ": " + JSON.stringify(firstDiff.d) + " " + JSON.stringify(firstDiff.m).slice(0, 400) : ""));
const good = compute(biz(1275000)), bad = Object.assign({}, good.key, { cess: good.key.cess + 1 });
ok(differences(bad, check(biz(1275000))).some((x) => x.key === "cess" && x.diff === 1), "a planted one-rupee difference in the cess is caught");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
