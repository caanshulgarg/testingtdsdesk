// node tests/run_itr_law.mjs - the independent CA reviews of next-itr-schedules (1dc8f9d8e, 23ee460d1): the points where
// both computations shared the same wrong rule, so their agreement could not catch it. Every expected figure here is
// worked by hand from the Act (the working is in the comment beside it), never taken from either computation. Made-up data.
// ITR_LIB=<dir> runs the same cases against another copy of app/src/lib/itr (an older commit's, for the fail-before log):
// what an older copy lacks is bridged by the adapter below, so its wrong figures show as FAIL rather than as a crash.
const LIB = process.env.ITR_LIB ? new URL("file://" + process.env.ITR_LIB.replace(/\/?$/, "/")) : new URL("../app/src/lib/itr/", import.meta.url);
const H = await import(new URL("heads.js", LIB)), MD = await import(new URL("model.js", LIB)), TX = await import(new URL("tax.js", LIB)), CK = await import(new URL("check.js", LIB)), VF = await import(new URL("verify.js", LIB));
const { salaryHead, houseHead, capitalGains, salaryFromForm16 } = H, { compute } = TX, { check, differences } = CK;
// the adapter: an older model.js put the heads into the model inside buildModel only
const headsInto = MD.headsInto || ((M, st) => {
  const hctx = { regime: M.regime, entity: M.entity, resident: M.resident !== false }; M.os = M.os || {};
  if ((st.salaries || []).length) { const sh = salaryHead(st.salaries, hctx); M.salaryRows = st.salaries; M.salaryHead = sh; M.salary = { gross: sh.gross, std: sh.std, net: sh.income, basicDa: sh.basicDa }; }
  if ((st.houses || []).length) { const hh = houseHead(st.houses, hctx); M.houseRows = st.houses; M.hpHead = hh; M.hp = hh.total; }
  if ((st.cgRows || []).length) { const g = capitalGains(st.cgRows, hctx); M.cgRows = st.cgRows; M.cgHead = g; M.cg = { s111A: g.s111A, s112A: g.s112A, s112: g.s112, other: g.stApp, relief112: g.relief112, cfStcl: g.cfStcl, cfLtcl: g.cfLtcl, at: g.at, reliefAt: g.reliefAt, pool112: g.pool112, poolAt: g.poolAt, alt: g.alt }; }
  return M; });
const schedulesChecks = VF.schedulesChecks || (() => []);
const needsOf = (x) => (x && x.needs) || [];

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(a === b, w + " (" + a + (a === b ? "" : ", expected " + b) + ")");
const T = (name, fn) => { try { fn(); } catch (e) { ok(false, name + ": threw " + String(e && e.message).slice(0, 120)); } };
const paid0 = () => ({ tds: [], tdsSal: [], tcs: [], advance: [], selfAssessment: [] });
function mk(o, st) {
  const M = Object.assign({ entity: "P", form: "ITR-3", resident: true, age: 40, deductions: {}, losses: {}, paid: paid0(), filingDate: "20260720", form10iea: "X", noInterest: true }, o);
  headsInto(M, st || {});
  return M;
}
// both computations; each must give the hand-worked figure on its own
function both(M) { const a = compute(M), b = check(M); return { a, b, dd: differences(a.key, b) }; }
let r, g, s, h, M, ck, plot;
const same = (r, k, v, w) => { eq(r.a.key[k], v, w + " - first computation"); eq(r.b[k], v, w + " - second computation"); };

// ---------------- B1: the order of set-off across heads ----------------
console.log("B1 set-off across heads (sections 70, 71, 71(2A), 71(3A), 32(2))");
T("B1 set-off across heads (sections 70, 71, 71(2A), 71(3A), 32(2))", () => {
// old regime: salary 20,00,000 - 50,000 = 19,50,000; self-occupied interest 2,50,000 -> loss 2,00,000 (24(b));
// 112A gain 3,00,000. The house loss goes against salary (normal rates): normal 17,50,000, 112A 3,00,000.
// Slab tax on 17,50,000: 12,500 + 1,00,000 + 30% of 7,50,000 = 3,37,500; 112A: 12.5% of 1,75,000 = 21,875;
// 3,59,375 + cess 14,375 = 3,73,750.
r = both(mk({ regime: "old" }, { salaries: [{ employer: "DEMO EMPLOYER", s171: 2000000 }], houses: [{ kind: "S", loans: [{ bank: "B", date: "20200101", interest: 250000 }] }],
  cgRows: [{ id: "q", kind: "eq", acq: "20200101", sale: "20250701", value: 400000, cost: 100000 }] }));
same(r, "liability", 373750, "old regime: the house loss against salary, not against the 112A gain: 3,73,750");
same(r, "specialTax", 21875, "old regime: 112A untouched by the house loss");
// new regime: business loss 2,00,000 (not against salary, 71(2A)); 111A 2,00,000, 112 (unlisted shares) 2,00,000,
// salary 20,75,000 - 75,000 = 20,00,000. The loss goes against 111A (20%) before 112 (12.5%): special tax 12.5% of
// 2,00,000 = 25,000. Slab tax on 20,00,000 (new): 20,000 + 40,000 + 60,000 + 80,000 = 2,00,000. 2,25,000 + 9,000 = 2,34,000.
r = both(mk({ regime: "new", business: { pbt: -200000, adds: [], less: [] } }, { salaries: [{ employer: "DEMO EMPLOYER", s171: 2075000 }],
  cgRows: [{ id: "a", kind: "eq", acq: "20250101", sale: "20250901", value: 400000, cost: 200000 }, { id: "u", kind: "unlisted", acq: "20200101", sale: "20250901", value: 500000, cost: 300000 }] }));
same(r, "specialTax", 25000, "new regime: business loss against 111A (20%) before 112 (12.5%): special tax 25,000");
same(r, "liability", 234000, "new regime: liability 2,34,000");
// unabsorbed depreciation brought forward 1,50,000: against 111A before 112 (32(2), not against salary)
r = both(mk({ regime: "new", losses: { unabsorbedDep: 150000 } }, { salaries: [{ employer: "DEMO EMPLOYER", s171: 2075000 }],
  cgRows: [{ id: "a", kind: "eq", acq: "20250101", sale: "20250901", value: 400000, cost: 200000 }, { id: "u", kind: "unlisted", acq: "20200101", sale: "20250901", value: 500000, cost: 300000 }] }));
// 111A 2,00,000 - 1,50,000 = 50,000 at 20% = 10,000; 112 2,00,000 at 12.5% = 25,000
same(r, "specialTax", 35000, "unabsorbed depreciation against 111A first, never salary: special tax 10,000 + 25,000");

// ---------------- B2: the proviso to 112(1)(a) on the gain actually chargeable ----------------
});
console.log("B2 proviso to section 112(1)(a)");
T("B2 proviso to section 112(1)(a)", () => {
plot = { id: "c", kind: "land", desc: "DEMO PLOT", acq: "20100601", sale: "20251115", value: 6000000, sdv: 6400000, cost: 2000000, improve: [{ fy: "2015", amt: 500000 }], expenses: 100000 };
// unindexed 60,00,000 - 20,00,000 - 5,00,000 - 1,00,000 = 34,00,000; indexed: cost 20,00,000 x 376/167 = 45,02,994,
// improvement 5,00,000 x 376/254 = 7,40,157 -> 60,00,000 - 45,02,994 - 7,40,157 - 1,00,000 = 6,56,849.
// new regime, no other income: the basic exemption 4,00,000 comes off the gain (proviso to 112(1)): chargeable
// 30,00,000 / indexed 2,56,849. Tax = the lower of 12.5% x 30,00,000 = 3,75,000 and 20% x 2,56,849 = 51,370;
// cess 2,055: 53,425.
r = both(mk({ regime: "new" }, { cgRows: [plot] }));
same(r, "liability", 53425, "new regime, the plot alone: tax on the chargeable gain, 53,425");
const pr = (r.a.tax.p112 || { rows: [] }).rows[0] || {};
eq(pr.taxA, 375000, "per property: 12.5% of the chargeable gain (TaxSec1121a)");
eq(pr.taxB, 51370, "per property: 20% of the chargeable indexed gain (TaxSec1121aiiB)");
eq(pr.excess, 323630, "per property: the excess ignored (ExcessAmtSec1121a)");
// old regime, age 40: exemption 2,50,000: 12.5% x 31,50,000 = 3,93,750; 20% x 4,06,849 = 81,370; + cess 3,255 = 84,625
r = both(mk({ regime: "old" }, { cgRows: [plot] }));
same(r, "liability", 84625, "old regime, the plot alone: 84,625");
// a long-term loss on gold 3,00,000 set off within the head goes against the plot first (in the taxpayer's favour);
// salary 15,75,000 - 75,000 = 15,00,000 (new): 20,000 + 40,000 + 45,000 = 1,05,000. Plot chargeable 31,00,000,
// indexed 3,56,849: lower of 3,87,500 and 71,370 = 71,370. 1,76,370 + 7,055 = 1,83,425
r = both(mk({ regime: "new" }, { salaries: [{ employer: "E", s171: 1575000 }], cgRows: [plot, { id: "g", kind: "other", desc: "DEMO GOLD", acq: "20150101", sale: "20250801", value: 100000, cost: 400000 }] }));
same(r, "liability", 183425, "a long-term loss set off within the head: the proviso on what is left, 1,83,425");

// ---------------- B3: 54EC once a year, land or building; 54 / 54B / 54F for individuals and HUFs ----------------
});
console.log("B3 sections 54, 54EC, 54F: who and what");
T("B3 sections 54, 54EC, 54F: who and what", () => {
const twoPlots = [1, 2].map((k) => ({ id: "p" + k, kind: "land", acq: "20150101", sale: "20250701", value: 6000000, cost: 2000000, exempt: [{ sec: "54EC", amt: 5000000 }] }));
g = capitalGains(twoPlots, { entity: "P", resident: true });
// gains 40,00,000 each; 54EC at most 50,00,000 in all in the year (first proviso to 54EC(1)): 40,00,000 + 10,00,000
eq(g.rows[0].exemptAmt + g.rows[1].exemptAmt, 5000000, "two plots claiming 54EC of 50 lakh each: 50 lakh in all");
g = capitalGains([{ id: "s", kind: "unlisted", acq: "20200101", sale: "20250701", value: 3000000, cost: 1000000, exempt: [{ sec: "54EC", amt: 2000000 }] }], { entity: "P", resident: true });
eq(g.rows[0].exemptAmt, 0, "54EC on unlisted shares: nil (54EC is for land or building)");
g = capitalGains([{ id: "f", kind: "land", acq: "20150101", sale: "20250701", value: 6000000, cost: 2000000, exempt: [{ sec: "54F", amt: 4000000, cost: 9000000 }] }], { entity: "F", resident: true });
eq(g.rows[0].exemptAmt, 0, "54F for a firm: nil (individuals and HUFs only)");
g = capitalGains([{ id: "n", kind: "land", acq: "20150101", sale: "20250701", value: 6000000, cost: 2000000, exempt: [{ sec: "54", amt: 4000000, cost: 9000000 }] }], { entity: "P", resident: true });
eq(g.rows[0].exemptAmt, 0, "section 54 on a plot (not a residential house): nil");

// ---------------- B4: the amount of 54F and 54 ----------------
});
console.log("B4 the amount of 54F and 54");
T("B4 the amount of 54F and 54", () => {
// 54F: gain x cost of the new house (at most 10 crore) / net consideration: 15 cr x 10 cr / 20 cr = 7.5 cr
g = capitalGains([{ id: "o", kind: "other", acq: "20150101", sale: "20250701", value: 200000000, cost: 50000000, exempt: [{ sec: "54F", cost: 120000000 }] }], { entity: "P", resident: true });
eq(g.rows[0].exemptAmt, 75000000, "54F: 15 crore x 10 crore / 20 crore = 7.5 crore");
// 54: the lower of the gain and the new house's cost, the cost at most 10 crore
g = capitalGains([{ id: "h", kind: "land", residential: true, acq: "20150101", sale: "20250701", value: 200000000, cost: 50000000, exempt: [{ sec: "54", cost: 120000000 }] }], { entity: "P", resident: true });
eq(g.rows[0].exemptAmt, 100000000, "54: the lower of the gain 15 crore and the cost (capped at 10 crore)");
g = capitalGains([{ id: "h2", kind: "land", residential: true, acq: "20150101", sale: "20250701", value: 9000000, cost: 5000000, exempt: [{ sec: "54", cost: 3000000 }] }], { entity: "P", resident: true });
eq(g.rows[0].exemptAmt, 3000000, "54: a cheaper new house: its cost 30 lakh");

// ---------------- the review's other points ----------------
});
console.log("Salary: basic + DA, the employer's kind, gratuity");
T("Salary: basic + DA, the employer's kind, gratuity", () => {
s = salaryHead([{ employer: "E", nature: "OTH", s171: 1200000, exempt: [{ sec: "10(13A)", amt: 0 }], hra: { metro: true, received: 240000, rent: 300000 } }], { regime: "old" });
ok(needsOf(s).some((n) => /basic/i.test(n.text)), "HRA claimed with basic + DA blank: asked (not taken as the whole 17(1))");
eq(s.exempt, 0, "until it is given, no HRA exemption is worked on a guess");
const f16row = salaryFromForm16({ employer: "DEMO EMPLOYER", tan: "DELD99999D", s171: 1000000 });
ok(!f16row.nature, "Form 16 row: the employer's kind is not assumed");
s = salaryHead([f16row], { regime: "new" });
ok(needsOf(s).some((n) => /kind of employer|employer.*kind|government/i.test(n.text)), "the employer's kind is asked");
s = salaryHead([{ employer: "G", nature: "CGOV", s171: 5000000, exempt: [{ sec: "10(10)", amt: 3000000 }] }], { regime: "new" });
eq(s.exempt, 3000000, "government employee's gratuity: wholly exempt (10(10)(i))");
ok(s.warn.some((w) => /utility/i.test(w.text)), "said that the utility may cap it at 25 lakh");
M = mk({ regime: "new", deductions: { "80CCD2": 100000 } }, { salaries: [{ employer: "E", nature: "OTH", s171: 1200000 }] });
ok(needsOf(compute(M)).some((n) => /basic/i.test(n.text)), "80CCD(2) with basic + DA blank: asked");
});
console.log("Capital gains: dates, buy-back, 55(2)(b)");
T("Capital gains: dates, buy-back, 55(2)(b)", () => {
g = capitalGains([{ id: "d1", kind: "eq", acq: "20200101", sale: "20250301", value: 100, cost: 50 }], { entity: "P" });
ok(needsOf(g).some((n) => /1-04-2025/.test(n.text)), "a sale before 1-04-2025 is not of this year: asked");
g = capitalGains([{ id: "d2", kind: "eq", acq: "20251001", sale: "20250901", value: 100, cost: 50 }], { entity: "P" });
ok(needsOf(g).some((n) => /before the sale/i.test(n.text)), "bought after it was sold: asked");
g = capitalGains([{ id: "d3", kind: "eq", acq: "20200101", value: 100, cost: 50 }], { entity: "P" });
ok(needsOf(g).some((n) => /date of sale/i.test(n.text)), "no date of sale: blocks");
M = mk({ regime: "new" }, { cgRows: [{ id: "bb", kind: "buyback", listed: true, acq: "20230101", sale: "20251010", value: 200000, cost: 120000 }] });
eq(M.os.buyback, 200000, "buy-back of 10-10-2025: the 2,00,000 received is dividend (2(22)(f)) in other sources");
eq(M.cgHead.cfLtcl, 120000, "its cost 1,20,000 a long-term capital loss (46A)");
g = capitalGains([{ id: "o1", kind: "land", acq: "19950101", sale: "20250701", value: 9000000, cost: 300000, fmv2001: 2500000, sdv2001: 2000000 }], { entity: "P", resident: true });
eq(g.rows[0].cost, 2000000, "55(2)(b) proviso: FMV of 1-04-2001 at most the stamp duty value of that date");
g = capitalGains([{ id: "o2", kind: "land", acq: "19950101", sale: "20250701", value: 9000000, cost: 300000, fmv2001: 2500000 }], { entity: "P", resident: true });
ok(needsOf(g).some((n) => /stamp duty value on 1-04-2001/i.test(n.text)), "FMV of 1-04-2001 for land without the stamp duty value of that date: asked");
});
console.log("House property: the 30,000 cap by each loan's date, pre-construction interest");
T("House property: the 30,000 cap by each loan's date, pre-construction interest", () => {
// house A: loan before 1-04-1999, interest 50,000 -> 30,000; house B: interest 2,50,000 -> what is left of 2,00,000: 1,70,000
h = houseHead([{ kind: "S", oldLoan: true, loans: [{ interest: 50000 }] }, { kind: "S", loans: [{ interest: 250000 }] }], { regime: "old" });
eq(h.props[0].interestAllowed, 30000, "old loan's house: 30,000");
eq(h.props[1].interestAllowed, 170000, "the other house: 2,00,000 in all less 30,000");
h = houseHead([{ kind: "L", rent: 300000, loans: [{ interest: 100000 }], preConst: 100000 }], { regime: "old" });
eq(h.props[0].interestAllowed, 120000, "pre-construction interest 1,00,000: a fifth, 20,000, with the year's 1,00,000 (24(b) Explanation)");
});
console.log("Losses of earlier years (71B, 74), section 80");
T("Losses of earlier years (71B, 74), section 80", () => {
// house income 93,600 against the 71B loss of AY 2023-24 1,50,000: 93,600 set off, 56,400 left
// STCL of AY 2022-23 1,00,000 against short-term (normal) 40,000 then 111A 60,000; LTCL of AY 2017-18 lapsed (74(1): 8 years)
r = both(mk({ regime: "new", losses: { hp: [{ ay: "2023", amt: 150000 }], stcl: [{ ay: "2022", amt: 100000 }], ltcl: [{ ay: "2017", amt: 500000 }] } }, {
  houses: [{ kind: "L", rent: 360000, muniTax: 12000, loans: [{ interest: 150000 }] }],
  cgRows: [{ id: "b", kind: "eq", acq: "20250110", sale: "20250805", value: 260000, cost: 200000 }, { id: "d", kind: "mf50AA", acq: "20230601", sale: "20251201", value: 540000, cost: 500000 }, { id: "l", kind: "other", acq: "20150101", sale: "20250801", value: 900000, cost: 400000 }] }));
same(r, "bfHp", 93600, "71B: the earlier house loss against this year's house income");
same(r, "bfStcl", 100000, "74: the earlier short-term loss against the short-term gains");
same(r, "bfLtcl", 0, "74: a loss of AY 2017-18 has lapsed (eight years)");
same(r, "gti", 500000, "gross total income: 0 + 0 + 0 + long-term 5,00,000");
ok(r.dd.length === 0, "the two computations agree (" + JSON.stringify(r.dd.slice(0, 3)) + ")");
});
console.log("Checks: Form 16's regime, 194IA");
T("Checks: Form 16's regime, 194IA", () => {
M = mk({ regime: "old" }, { salaries: [{ employer: "DEMO EMPLOYER", tan: "DELD99999D", nature: "OTH", s171: 1000000 }] });
ck = schedulesChecks({ model: M, main: compute(M), imports: { f16: [{ kind: "form16", data: { employer: "DEMO EMPLOYER", tan: "DELD99999D", s171: 1000000, optOut: "No" } }] } });
ok((ck.find((x) => x.id === "f16_regime") || {}).status === "needs", "Form 16 says the new regime (no opt-out), the return the old: asked");
M = mk({ regime: "new" }, { cgRows: [Object.assign({}, plot)] });
M.paid.tds.push({ tan: "DELX00000X", name: "DEMO BUYER", sec: "194IA", gross: 6000000, amt: 60000 });
ck = schedulesChecks({ model: M, main: compute(M), imports: { as26: { data: { tds: [], tcs: [], paid: [] } } } });
// 1% of the higher of the consideration 60,00,000 and the stamp duty value 64,00,000 (194IA as amended from 1-10-2024)
const t194 = ck.find((x) => x.id === "tds_194ia") || {};
ok(t194.status === "difference" && t194.diff === -4000, "194IA: 1% of 64,00,000 expected, 60,000 in 26AS: a difference of 4,000 (" + t194.status + " " + t194.diff + ")");
});

// ---------------- the re-review of 23ee460d1 ----------------
console.log("N1 set-off within capital gains (70(2), 70(3)): the order that saves the most tax");
T("N1", () => {
  // new regime, other income 20,00,000 (slab tax 2,00,000). 112A gain 1,25,000; unlisted shares (112) gain 1,00,000;
  // a listed share sold at a long-term loss of 1,00,000. The loss against 112 (12.5%): 112 nil, and 112A 1,25,000 is
  // within its Rs 1.25 lakh exemption: special tax nil. (Against 112A it would leave 112 taxed: 12,500.)
  r = both(mk({ regime: "new", os: { other: 2000000 } }, { cgRows: [{ id: "q", kind: "eq", acq: "20200101", sale: "20250701", value: 225000, cost: 100000 },
    { id: "u", kind: "unlisted", acq: "20200101", sale: "20250901", value: 300000, cost: 200000 }, { id: "l", kind: "eq", acq: "20200101", sale: "20250801", value: 100000, cost: 200000 }] }));
  same(r, "specialTax", 0, "long-term loss against 112 before 112A (keeping the 1.25 lakh exemption): special tax nil");
  same(r, "liability", 208000, "liability 2,00,000 + cess 8,000");
});
T("STCL by slab", () => {
  // a 111A loss of 1,00,000, a normal-rate short-term gain (50AA fund) of 1,00,000 and a 112 gain of 1,00,000.
  const rs = [{ id: "a", kind: "eq", acq: "20250101", sale: "20250901", value: 100000, cost: 200000 }, { id: "d", kind: "mf50AA", acq: "20230601", sale: "20251201", value: 600000, cost: 500000 },
    { id: "u", kind: "unlisted", acq: "20200101", sale: "20250901", value: 300000, cost: 200000 }];
  // other income 25,00,000 (top slab 30%): the loss against the normal-rate gain: normal 25,00,000 = 3,30,000; 112 at
  // 12.5% = 12,500; 3,42,500 + cess 13,700 = 3,56,200 (against 112 instead: 26,00,000 = 3,60,000 + cess = 3,74,400)
  r = both(mk({ regime: "new", os: { other: 2500000 } }, { cgRows: rs }));
  same(r, "specialTax", 12500, "top slab: the short-term loss against the normal-rate gain");
  same(r, "liability", 356200, "top slab: 3,56,200");
  // other income 5,00,000: against the normal-rate gain: normal 5,00,000 (tax 5,000, rebated under 87A), 112 12,500
  // + cess = 13,000; against 112: normal 6,00,000 (tax 10,000, rebated), 112 nil: nil. The lower: nil
  r = both(mk({ regime: "new", os: { other: 500000 } }, { cgRows: rs }));
  same(r, "liability", 0, "low slab: the short-term loss against 112 instead, liability nil");
  same(r, "specialTax", 0, "low slab: special tax nil");
});
console.log("54EC: the Rs 50 lakh shared where it saves tax; the dates");
T("54EC allocation", () => {
  // two plots sold on 1-07-2025 for 60,00,000 each, cost 20,00,000 (gain 40,00,000 each); 50 lakh claimed on each, 50
  // lakh allowed in all. Plot A bought 1-06-2008: indexed cost 20,00,000 x 376/137 = 54,89,051, indexed gain 5,10,949
  // (the proviso's 20% binds). Plot B bought 1-04-2023: 20,00,000 x 376/348 = 21,60,920, indexed gain 38,39,080.
  // Each plot up to its indexed gain first: A 5,10,949, B 38,39,080; the 6,49,971 left to A. A: gain 28,39,080, indexed
  // nil -> tax nil; B: gain 1,60,920, indexed nil -> nil. (By entry order A 40,00,000 and B 10,00,000: B taxed 3,25,000.)
  const rs = [{ id: "A", kind: "land", acq: "20080601", sale: "20250701", value: 6000000, cost: 2000000, exempt: [{ sec: "54EC", amt: 5000000, date: "20251001" }] },
    { id: "B", kind: "land", acq: "20230401", sale: "20250701", value: 6000000, cost: 2000000, exempt: [{ sec: "54EC", amt: 5000000, date: "20251001" }] }];
  g = capitalGains(rs, { entity: "P", resident: true });
  eq(g.rows[0].exemptAmt, 1160920, "plot A: 5,10,949 + 6,49,971");
  eq(g.rows[1].exemptAmt, 3839080, "plot B: up to its indexed gain, 38,39,080");
  r = both(mk({ regime: "new" }, { cgRows: rs }));
  same(r, "specialTax", 0, "both plots' tax nil");
  g = capitalGains([Object.assign({}, rs[0], { exempt: [{ sec: "54EC", amt: 5000000, date: "20260215" }] })], { entity: "P", resident: true });
  eq(g.rows[0].exemptAmt, 0, "54EC bonds bought more than six months after the sale: nil");
  g = capitalGains([Object.assign({}, rs[0], { exempt: [{ sec: "54EC", amt: 5000000 }] })], { entity: "P", resident: true });
  ok(needsOf(g).some((n) => /date.*54EC|54EC.*date/i.test(n.text)), "54EC without the date of investment: asked");
});
console.log("54, 54F, 54B: the windows and the land");
T("54 windows", () => {
  const house = (e) => [{ id: "h", kind: "land", residential: true, acq: "20150101", sale: "20250701", value: 9000000, cost: 5000000, exempt: [e] }];
  const ctx = { entity: "P", resident: true, due: "20260831" };
  eq(capitalGains(house({ sec: "54", cost: 3000000, how: "bought", date: "20230101" }), ctx).rows[0].exemptAmt, 0, "54: a house bought more than a year before the sale: nil");
  eq(capitalGains(house({ sec: "54", cost: 3000000, how: "bought", date: "20240901" }), ctx).rows[0].exemptAmt, 3000000, "54: bought within a year before: 30 lakh");
  eq(capitalGains(house({ sec: "54", cost: 3000000, how: "built", date: "20280601" }), ctx).rows[0].exemptAmt, 3000000, "54: built within three years: allowed");
  eq(capitalGains(house({ sec: "54", cost: 3000000, how: "cgas", date: "20260915" }), ctx).rows[0].exemptAmt, 0, "54: deposited in the Capital Gains Account Scheme after the due date (139(1)): nil");
  eq(capitalGains(house({ sec: "54", cost: 3000000, how: "cgas", date: "20260801" }), ctx).rows[0].exemptAmt, 3000000, "54: deposited by the due date: allowed");
  const farm = (o) => [Object.assign({ id: "f", kind: "land", acq: "20150101", sale: "20250701", value: 3000000, cost: 1000000, exempt: [{ sec: "54B", cost: 1500000, how: "bought", date: "20251101" }] }, o)];
  eq(capitalGains(farm({}), ctx).rows[0].exemptAmt, 0, "54B: not said to be agricultural land used for agriculture for two years: nil");
  g = capitalGains(farm({ agri: true }), ctx);
  ok(needsOf(g).some((n) => /rural/i.test(n.text)), "agricultural land: asked whether it is rural (not a capital asset, 2(14)(iii))");
  eq(capitalGains(farm({ agri: true, agriUrban: true }), ctx).rows[0].exemptAmt, 1500000, "54B: urban agricultural land, used for agriculture: the new land's cost 15 lakh");
});
console.log("Earlier years' losses: section 80; 80CCD(2) in the second computation; 194IA for a co-owned property");
T("s80 and 80CCD2", () => {
  // a short-term loss of AY 2022-23 whose return was filed late (section 80): not set off
  r = both(mk({ regime: "new", losses: { stcl: [{ ay: "2022", amt: 100000, filed: "20230120", inTime: false }] } }, { cgRows: [{ id: "b", kind: "eq", acq: "20250110", sale: "20250805", value: 260000, cost: 200000 }] }));
  same(r, "bfStcl", 0, "a capital loss of a year whose return was late: not carried, not set off (80)");
  // salary 20,75,000 - 75,000 = 20,00,000; 80CCD(2) 2,00,000 claimed, at most 14% of basic + DA 10,00,000 = 1,40,000:
  // total income 18,60,000, even when the model's own basic + DA figure is wrong (the second computation reads the rows)
  M = mk({ regime: "new", deductions: { "80CCD2": 200000 } }, { salaries: [{ employer: "E", nature: "OTH", s171: 2075000, basicDa: 1000000 }] });
  M.salary = Object.assign({}, M.salary, { basicDa: 5 });
  eq(check(M).ti, 1860000, "the second computation's 80CCD(2) limit from its own salary rows: total income 18,60,000");
  // a half share of a property sold for 60,00,000 in all: 194IA applies (the whole consideration is Rs 50 lakh or
  // more, from 1-10-2024): 1% of the own 30,00,000 = 30,000
  M = mk({ regime: "new" }, { cgRows: [{ id: "c", kind: "land", acq: "20150101", sale: "20251001", value: 3000000, sdv: 3000000, totalConsid: 6000000, cost: 2000000 }] });
  M.paid.tds.push({ tan: "DELX00000X", name: "DEMO BUYER", sec: "194IA", gross: 3000000, amt: 30000 });
  ck = schedulesChecks({ model: M, main: compute(M), imports: { as26: { data: { tds: [], tcs: [], paid: [] } } } });
  ok((ck.find((x) => x.id === "tds_194ia") || {}).status === "matched", "194IA: a co-owned property sold for 60 lakh in all: 1% of the own share, 30,000, matched");
});

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
