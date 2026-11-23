// node tests/run_itr_schedules.mjs - the schedules built in next-itr-schedules: S (salary), HP (house property), CG (capital
// gains: 111A, 112A with the 31-01-2018 grandfathering, 112 and its proviso for land or building bought before
// 23-07-2024, 50AA, 50C, buy-back losses, set-off within the head, carry forward), AL (assets and liabilities), FA
// (foreign assets), SH (shareholding of an unlisted company) and the Ind AS parts of ITR-6. Every figure is worked by
// hand here; every made-up return goes through both computations (tax.js, check.js) and the official schema (ajv and
// the page's validator). Made-up data only.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { salaryHead, houseHead, capitalGains, longTerm, CII, salaryFromForm16 } from "../app/src/lib/itr/heads.js";
import { importsOf, buildModel, buildProfile } from "../app/src/lib/itr/model.js";
import { compute } from "../app/src/lib/itr/tax.js";
import { check, differences } from "../app/src/lib/itr/check.js";
import { makeJson } from "../app/src/lib/itr/json.js";
import { verify } from "../app/src/lib/itr/verify.js";
import { read } from "../app/src/lib/itr/imports.js";
import { validator } from "../app/src/lib/itr/validate.js";
import { demo } from "./itr_demo.mjs";
import { ajvFor, schemaOf } from "./itr_validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)), FX = join(HERE, "fixtures", "itr");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(a === b, w + " (" + a + (a === b ? "" : ", expected " + b) + ")");
const ROOT = { "ITR-3": "ITR3", "ITR-4": "ITR4", "ITR-5": "ITR5", "ITR-6": "ITR6" };

// ---------------- Schedule S: salary ----------------
console.log("Salary (sections 15 to 17, 10, 16)");
const emp = { employer: "DEMO EMPLOYER PVT LTD", tan: "DELD99999D", nature: "OTH", s171: 1200000, s172: 50000, s173: 0, basicDa: 600000,
  exempt: [{ sec: "10(13A)", amt: 0 }], hra: { metro: true, received: 240000, rent: 300000 }, ptax: 2400, tds: 90000 };
let s = salaryHead([emp], { regime: "new" });
eq(s.gross, 1250000, "new regime: gross salary 17(1) + 17(2)");
eq(s.exempt, 0, "new regime: no HRA exemption (115BAC(2), rule 198)");
eq(s.std, 75000, "new regime: standard deduction 75,000 (16(ia))");
eq(s.ptax, 0, "new regime: no professional tax (16(iii), rule 195)");
eq(s.income, 1175000, "new regime: income from salary");
s = salaryHead([emp], { regime: "old" });
eq(s.exempt, 240000, "old regime: HRA the least of received 2,40,000, rent less 10% of salary 2,40,000, 50% of salary 3,00,000 (10(13A), rule 2A)");
eq(s.std, 50000, "old regime: standard deduction 50,000");
eq(s.ptax, 2400, "old regime: professional tax");
eq(s.income, 957600, "old regime: income from salary");
const two = salaryHead([emp, Object.assign({}, emp, { employer: "SECOND DEMO EMPLOYER", tan: "MUMD88888D", s171: 30000, s172: 0, hra: null, ptax: 0 })], { regime: "new" });
eq(two.std, 75000, "two employers: one standard deduction in all");
const small = salaryHead([{ employer: "X", s171: 40000 }], { regime: "new" });
eq(small.std, 40000, "standard deduction at most the salary");
const grat = salaryHead([{ employer: "X", nature: "OTH", s171: 3000000, exempt: [{ sec: "10(10)", amt: 2500000 }] }], { regime: "new" });
eq(grat.exempt, 2000000, "gratuity 10(10) at most Rs 20 lakh for a non-government employer (rule 181)");
ok(grat.warn.some((w) => /10\(10\)/.test(w.text)), "the cut is said");

// ---------------- Schedule HP ----------------
console.log("House property (sections 22 to 27, 71(3A), 71B)");
const let1 = { kind: "L", addr: { line: "1 DEMO ROAD", city: "NEW DELHI", state: "07", pin: "110001" }, share: 100, rent: 360000, unrealised: 0, muniTax: 12000, loans: [{ bank: "DEMO BANK", account: "HL001", date: "20180401", total: 2000000, outstanding: 1200000, interest: 150000 }], tenants: [{ name: "DEMO TENANT", pan: "ZZZPT1111T" }] };
let h = houseHead([let1], { regime: "old" });
const p0 = h.props[0];
eq(p0.av, 348000, "annual value: rent less municipal tax paid (23(1))");
eq(p0.std30, 104400, "30% of the annual value (24(a))");
eq(p0.income, 93600, "let out: 3,48,000 - 1,04,400 - interest 1,50,000 (24(b))");
const sop = { kind: "S", addr: { line: "2 DEMO LANE", city: "NEW DELHI", state: "07", pin: "110002" }, share: 100, loans: [{ bank: "DEMO BANK", account: "HL002", date: "20200101", total: 5000000, outstanding: 4000000, interest: 240000 }] };
h = houseHead([let1, sop], { regime: "old" });
eq(h.props[1].income, -200000, "self-occupied: interest at most Rs 2 lakh (24(b) second proviso)");
eq(h.total, -106400, "the head: 93,600 - 2,00,000");
h = houseHead([let1, sop], { regime: "new" });
eq(h.props[1].income, 0, "new regime: no interest on a self-occupied house (115BAC(2), rule 232)");
eq(h.total, 93600, "new regime: the head");
const co = { kind: "L", addr: { line: "3 DEMO MARG", city: "PUNE", state: "27", pin: "411001" }, share: 50, coOwners: [{ name: "DEMO SPOUSE", pan: "ZZZPS2222S", share: 50 }], rent: 600000, muniTax: 20000, loans: [{ bank: "DEMO HFC", account: "HL3", date: "20190101", total: 1000000, outstanding: 600000, interest: 50000 }] };
h = houseHead([co], { regime: "old" });
eq(h.props[0].own, 290000, "co-owned 50%: the owner's share of the annual value (rule 212)");
eq(h.props[0].income, 153000, "co-owned: 2,90,000 - 87,000 - 50,000");
eq(h.rentOwn, 300000, "the owner's share of the rent (for the AIS check)");
h = houseHead([sop, Object.assign({}, sop, { addr: { line: "4", city: "X", state: "07", pin: "110003" } }), Object.assign({}, sop, { addr: { line: "5", city: "Y", state: "07", pin: "110004" } })], { regime: "old" });
ok(h.needs.some((n) => n.key === "hp_sop3"), "three self-occupied houses: one must be deemed let out (23(4), rule 223)");
h = houseHead([Object.assign({}, let1, { arrears: 100000 })], { regime: "old" });
eq(h.props[0].arrears, 70000, "arrears of rent received: 70% (25A)");

// ---------------- Schedule CG ----------------
console.log("Capital gains (sections 45, 48, 49, 50AA, 50C, 54-series, 55(2)(ac), 70, 74, 111A, 112, 112A)");
eq(CII["2025"], 376, "cost inflation index FY 2025-26: 376");
eq(CII["2010"], 167, "cost inflation index FY 2010-11: 167");
ok(longTerm("eq", "20240620", "20250621") && !longTerm("eq", "20240620", "20250620"), "listed equity: long-term only when held more than 12 months (2(42A))");
ok(!longTerm("land", "20231201", "20251130") && longTerm("land", "20231201", "20251202"), "land: more than 24 months");
ok(!longTerm("mf50AA", "20200101", "20251201"), "specified mutual fund: always short-term (50AA)");
const rows = [
  { id: "a", kind: "eq", desc: "DEMO LISTED EQUITY", acq: "20170510", sale: "20250620", value: 300000, cost: 100000, fmv2018: 160000, expenses: 0 },
  { id: "b", kind: "eq", desc: "DEMO EQUITY FUND", acq: "20250110", sale: "20250805", value: 260000, cost: 200000 },
  { id: "c", kind: "land", desc: "DEMO PLOT", acq: "20100601", sale: "20251115", value: 6000000, sdv: 6400000, cost: 2000000, improve: [{ fy: "2015", amt: 500000 }], expenses: 100000 },
  { id: "d", kind: "mf50AA", desc: "DEMO DEBT FUND", acq: "20230601", sale: "20251201", value: 540000, cost: 500000 },
  { id: "e", kind: "unlisted", desc: "DEMO UNLISTED CO", acq: "20220101", sale: "20250901", value: 250000, cost: 300000 },
];
let g = capitalGains(rows, { entity: "P", resident: true });
const by = (id) => g.rows.find((r) => r.id === id);
eq(by("a").costUsed, 160000, "112A grandfathering: the higher of cost and the lower of FMV on 31-01-2018 and the sale value (55(2)(ac))");
eq(by("a").gain, 140000, "112A gain");
eq(by("c").fullValue, 6000000, "50C: stamp duty value within 110% of the consideration, the consideration stands");
eq(by("c").gain, 3400000, "land: gain without indexation (48 as amended)");
eq(by("c").idxGain, 656849, "land: gain with indexation (CII 376 / 167 and 376 / 254)");
eq(by("c").excess, 293630, "proviso to 112(1)(a): 12.5% (4,25,000) exceeds 20% with indexation (1,31,370) by 2,93,630, ignored");
eq(g.s111A, 60000, "111A: 60,000");
eq(g.stApp, 40000, "short-term at the normal rates (50AA)");
eq(g.s112A, 140000, "112A: 1,40,000");
eq(g.s112, 3350000, "112: 34,00,000 less the long-term loss 50,000 (70(3))");
eq(g.relief112, 293630, "the proviso's excess");
const g50 = capitalGains([{ id: "x", kind: "land", acq: "20150101", sale: "20250701", value: 5000000, sdv: 5600000, cost: 4000000 }], { entity: "P", resident: true });
eq(g50.rows[0].fullValue, 5600000, "50C: stamp duty value above 110% taken as the full value");
const gNr = capitalGains([rows[2]], { entity: "P", resident: false });
eq(gNr.relief112, 0, "no indexation option for a non-resident (rule 445)");
const gCo = capitalGains([rows[2]], { entity: "C", resident: true });
eq(gCo.relief112, 0, "no indexation option for a company");
const gl = capitalGains([{ id: "l1", kind: "eq", acq: "20250401", sale: "20250901", value: 100000, cost: 180000 }, { id: "l2", kind: "eq", acq: "20200101", sale: "20250901", value: 500000, cost: 300000 }, { id: "l3", kind: "other", acq: "20190101", sale: "20251001", value: 100000, cost: 400000 }], { entity: "P", resident: true });
eq(gl.s111A, 0, "short-term loss 80,000 ...");
eq(gl.s112A, 0, "... and long-term loss 3,00,000 against 112A gain 2,00,000 (70(3)): the long-term loss first");
eq(gl.cfStcl, 80000, "short-term loss kept for later years (74): it can go against any gain then");
eq(gl.cfLtcl, 100000, "long-term loss carried forward (74): 3,00,000 - 2,00,000");
const bb = capitalGains([{ id: "bb", kind: "buyback", listed: true, acq: "20230101", sale: "20251010", value: 0, cost: 120000 }], { entity: "P", resident: true });
eq(bb.cfLtcl, 120000, "buy-back after 1-10-2024: the cost is a capital loss (46A, 2(22)(f)); the money is dividend");
const ex = capitalGains([Object.assign({}, rows[2], { exempt: [{ sec: "54EC", amt: 6000000 }] })], { entity: "P", resident: true });
eq(ex.rows[0].exemptAmt, 3400000, "an exemption at most the gain");
ok(ex.warn.some((w) => /54EC/.test(w.text)), "54EC above Rs 50 lakh is said");
eq(g.at["20250615"].s112A, 0, "234C: 112A gain on 20-06-2025 accrues after 15-06");
eq(g.at["20250915"].s111A, 60000, "234C: 111A gain by 15-09");
eq(g.at["20251215"].s112, 3350000, "234C: the plot's gain by 15-12");

// ---------------- the whole return, both computations ----------------
console.log("Returns through both computations and the official schema");
const answer = (asks) => { const a = {}; asks.forEach((q) => { a[q.path] = q.choices ? (q.choices.includes("N") ? "N" : q.choices.includes("NO") ? "NO" : q.choices.includes("RES") ? "RES" : q.choices[0]) : q.kind === "date" ? "2026-11-20" : /PAN/i.test(q.path) ? "ZZZPX9999Z" : "DEMO"; }); return a; };
async function run(form, extra, name, mutate) {
  const D = await demo(form), schema = schemaOf(form), ajv = ajvFor(schema), mine = validator(schema);
  const files = Object.entries(D.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v));
  const imports = importsOf(files), state = Object.assign({}, D.booksObj.itr["2026|state"], extra);
  state.profile = Object.assign({}, D.booksObj.itr["2026|state"].profile, extra.profile || {});
  const base = { entity: D.client.entity, client: D.client, imports, books: D.books };
  const model = buildModel(Object.assign({}, base, { state })), profile = buildProfile(Object.assign({}, base, { state }));
  if (mutate) mutate(model);
  const comp = compute(model), two = check(model), dd = differences(comp.key, two);
  ok(dd.length === 0, form + ", " + name + ": the two computations agree" + (dd.length ? ": " + JSON.stringify(dd.slice(0, 4)) : ""));
  const X = { form, schema, model, comp, sched: D.books.sched, profile, today: "2026-11-22", dues43B: D.books.dues43B };
  const first = makeJson(Object.assign({ answers: {} }, X));
  ok(first.mapErrors.length === 0, form + ", " + name + ": every mapped field is in the schema" + (first.mapErrors.length ? ": " + first.mapErrors.slice(0, 4) : ""));
  const r = makeJson(Object.assign({ answers: answer(first.asks) }, X));
  const good = ajv(r.doc) && !!r.doc.ITR[ROOT[form]];
  ok(good, form + ", " + name + ": passes the official schema (ajv)" + (good ? "" : ": " + JSON.stringify((ajv.errors || []).slice(0, 3))));
  ok(mine(r.doc).ok === good, form + ", " + name + ": the page's validator agrees");
  return { D, model, comp, two, json: r, doc: r.doc.ITR[ROOT[form]], first, imports, state };
}
const SAL = [Object.assign({}, emp)];
const HPS = [let1, sop];
const CGS = rows;

// ITR-3, old regime: salary, two houses, capital gains
let R3 = await run("ITR-3", { regime: "old", form10iea: "ACK123", salaries: SAL, houses: HPS, cgRows: CGS }, "salary, house property, capital gains (old regime)");
let c = R3.comp, d = R3.doc;
eq(c.heads.sal, 957600, "ITR-3: salary head");
eq(c.heads.hp, -106400, "ITR-3: house property head");
eq(d.ScheduleS.TotIncUnderHeadSalaries, 957600, "Schedule S: income under the head");
eq(d.ScheduleS.Salaries[0].Salarys.GrossSalary, 1250000, "Schedule S: the employer's gross salary");
eq(d.ScheduleS.AllwncExtentExemptUs10, 240000, "Schedule S: HRA exempt");
eq(d.ScheduleS.Section10_13A.EligbleExmpAllwncUs13A, 240000, "Schedule S: the 10(13A) table");
eq(d.ScheduleHP.TotalIncomeChargeableUnHP, -106400, "Schedule HP: the head");
eq(d.ScheduleHP.PropertyDetails[0].Rentdetails.ThirtyPercentOfBalance, 104400, "Schedule HP: 30%");
eq(d.ScheduleHP.PropertyDetails[1].Rentdetails.IntOnBorwCap, 200000, "Schedule HP: the self-occupied interest capped");
eq(d.ScheduleHP.PropertyDetails[0].Rentdetails.Section24B.TotalInterestUs24B, 150000, "Schedule HP: table 24(b)");
const cg3 = d.ScheduleCGFor23;
eq(cg3.ShortTermCapGainFor23.EquityMFonSTT[0].EquityMFonSTTDtls.CapgainonAssets, 60000, "Schedule CG: 111A");
eq(cg3.LongTermCapGain23.SaleOfEquityShareUs112A.CapgainonAssets, 140000, "Schedule CG: 112A");
eq(d.Schedule112A.Balance112A, 140000, "Schedule 112A: the balance");
eq(d.Schedule112A.Schedule112ADtls[0].CostAcqWithoutIndx, 160000, "Schedule 112A: cost under 55(2)(ac)");
eq(cg3.LongTermCapGain23.SaleofLandBuild.SaleofLandBuildDtls[0].ExcessAmtSec1121a, 293630, "Schedule CG: the proviso's excess for the plot");
eq(cg3.LongTermCapGain23.SaleofLandBuild.TotalExcessTax, 293630, "Schedule CG: total excess");
eq(cg3.SumOfCGIncm, c.heads.cg, "Schedule CG: sum of capital gains is the head (" + c.heads.cg + ")");
eq(c.heads.cg, 60000 + 40000 + 140000 + 3350000, "the head: 111A + normal + 112A + 112");
const si = d.ScheduleSI.SplCodeRateTax, si112 = si.find((x) => x.SecCode === "22"), si1A = si.find((x) => x.SecCode === "1A");
ok(si1A && si1A.SplRateInc === 60000 && si112 && si112.SplRateInc > 0, "Schedule SI: 111A at 20% and 112 at 12.5%");
eq(d["PartB-TI"].CapGain.TotalCapGains, c.heads.cg, "Part B-TI: capital gains");
eq(d.PartB_TTI.ComputationOfTaxLiability.TaxPayableOnTI.TaxAtSpecialRates, c.tax.specialTax, "Part B-TTI: tax at special rates is the computation's");
ok(!R3.json.coverage.some((x) => ["hp", "salary", "cg"].includes(x.key)), "ITR-3: Schedules S, HP and CG no longer block the JSON");
// the 112 proviso reaches the tax: 12.5% on the plot less the excess
const t112 = Math.round(3350000 * 0.125);
ok(c.tax.parts.t112 === t112 - 293630 || c.tax.parts.t112 < t112, "the proviso's excess comes off the 112 tax (" + c.tax.parts.t112 + ")");

// new regime: the house property loss is not set off (115BAC(2)) and is carried forward (71B)
R3 = await run("ITR-3", { regime: "new", houses: [Object.assign({}, let1, { rent: 120000, muniTax: 0, loans: [Object.assign({}, let1.loans[0], { interest: 300000 })] })] }, "new regime, a house property loss");
eq(R3.comp.heads.hp, -216000, "new regime: let-out loss 84,000 - 3,00,000");
eq(R3.comp.carry.hp, 216000, "new regime: the loss carried forward whole");
eq(R3.doc.ScheduleCFL.CurrentAYloss.LossSummaryDetail.TotalHPPTILossCF, 216000, "Schedule CFL: house property loss");

// capital losses carried forward (74), and lost in a belated return (80)
R3 = await run("ITR-3", { regime: "new", cgRows: [{ id: "l3", kind: "other", desc: "DEMO GOLD", acq: "20190101", sale: "20251001", value: 100000, cost: 400000 }], filingDate: "20260720" }, "a long-term capital loss filed in time");
eq(R3.comp.carry.ltcl, 300000, "long-term capital loss carried forward");
eq(R3.doc.ScheduleCFL.CurrentAYloss.LossSummaryDetail.TotalLTCGPTILossCF, 300000, "Schedule CFL: long-term capital loss");
R3 = await run("ITR-3", { regime: "new", cgRows: [{ id: "l3", kind: "other", desc: "DEMO GOLD", acq: "20190101", sale: "20251001", value: 100000, cost: 400000 }], filingDate: "20261125" }, "the same loss, a belated return");
eq(R3.comp.carry.ltcl, 0, "section 80: no capital loss carried forward from a belated return");

// 234C, proviso (a): a gain of March is not a shortfall of the June instalment when its tax is paid by 31 March
const march = [{ id: "z", kind: "eq", desc: "DEMO LATE SALE", acq: "20200101", sale: "20260310", value: 5000000, cost: 1000000 }];
const payMarch = (m) => { m.paid.advance.push({ bsr: "0000001", date: "20260315", serial: "9", amt: 600000 }); };
const lateGain = await run("ITR-3", { regime: "new", cgRows: march }, "a large gain in March, its tax paid on 15 March", payMarch);
const earlyGain = await run("ITR-3", { regime: "new", cgRows: [Object.assign({}, march[0], { sale: "20250510" })] }, "the same gain in May", payMarch);
const unpaid = await run("ITR-3", { regime: "new", cgRows: march }, "the gain in March, its tax not paid by 31 March");
const c0 = (r) => r.comp.interest.cParts[0];
ok(c0(lateGain).due < c0(earlyGain).due, "234C on 15-06: the March gain is left out of the June instalment (" + c0(lateGain).due + " against " + c0(earlyGain).due + " for a May gain)");
ok(c0(unpaid).due === c0(earlyGain).due, "234C: the proviso needs the tax paid in the remaining instalments; unpaid, the June instalment is on the whole tax (" + c0(unpaid).due + ")");
ok(lateGain.comp.interest.c < unpaid.comp.interest.c, "234C: less interest when the gain's tax was paid in time (" + lateGain.comp.interest.c + " against " + unpaid.comp.interest.c + ")");

// ITR-3 total income above Rs 1 crore: Schedule AL (rule 905)
const big = [{ id: "big", kind: "eq", desc: "DEMO BIG SALE", acq: "20150101", sale: "20250701", value: 150000000, cost: 10000000 }];
R3 = await run("ITR-3", { regime: "new", cgRows: big }, "income above Rs 1 crore, no Schedule AL");
ok(R3.json.coverage.some((x) => x.key === "al"), "above Rs 1 crore without Schedule AL: the JSON is blocked");
const AL = { immovable: [{ desc: "DEMO FLAT", addr: { flat: "5", locality: "DEMO NAGAR", city: "NEW DELHI", state: "07", pin: "110005" }, amt: 4000000 }], deposits: 900000, shares: 2500000, insurance: 0, loans: 0, cash: 50000, jewellery: 300000, art: 0, vehicles: 800000, liabilities: 1500000, firms: [] };
R3 = await run("ITR-3", { regime: "new", cgRows: big, al: AL }, "income above Rs 1 crore with Schedule AL");
ok(!R3.json.coverage.some((x) => x.key === "al"), "Schedule AL filled: not blocking");
eq(R3.doc.ScheduleAL.MovableAsset.DepositsInBank, 900000, "Schedule AL: deposits");
eq(R3.doc.ScheduleAL.LiabilityInRelatAssets, 1500000, "Schedule AL: liabilities");
eq(R3.doc.ScheduleAL.InterstAOPFlag, "N", "Schedule AL: no interest in a firm");
let ck = verify({ model: R3.model, main: R3.comp, imports: R3.imports, books: R3.D.books, coverage: R3.json.coverage, accepted: {} });
ok(ck.some((x) => x.id === "al_bs"), "Checks: Schedule AL against the balance sheet (other than Part A-BS)");
const alDup = await run("ITR-3", { regime: "new", cgRows: big, al: Object.assign({}, AL, { cash: 85000 }) }, "AL repeats the business's cash");
ck = verify({ model: alDup.model, main: alDup.comp, imports: alDup.imports, books: alDup.D.books, coverage: alDup.json.coverage, accepted: {} });
ok(ck.find((x) => x.id === "al_bs").status === "needs", "Checks: AL cash equal to the books' cash to the rupee is asked (ITR-3 AL is other than Part A-BS)");

// Schedule FA
const FA = { DetailsForiegnBank: [{ CountryName: "UNITED STATES OF AMERICA", CountryCode: "1", Bankname: "DEMO FOREIGN BANK", AddressOfBank: "1 DEMO STREET", ZipCode: "10001", ForeignAccountNumber: "000111", OwnerStatus: "OWNER", AccOpenDate: "2019-04-01", PeakBalanceDuringYear: 500000, ClosingBalance: 400000, IntrstAccured: 8000 }] };
R3 = await run("ITR-3", { regime: "new", fa: FA, profile: { foreignAssets: "YES" } }, "Schedule FA");
ok(!R3.json.coverage.some((x) => x.key === "fa"), "Schedule FA filled: not blocking");
eq(R3.doc.ScheduleFA.DetailsForiegnBank[0].PeakBalanceDuringYear, 500000, "Schedule FA: peak balance");
R3 = await run("ITR-3", { regime: "new", profile: { foreignAssets: "YES" } }, "foreign assets said, FA empty");
ok(R3.json.coverage.some((x) => x.key === "fa"), "foreign assets YES with Schedule FA empty: blocked");

// ITR-3 checks: Form 16, AIS salary, AIS rent, AIS sales against the schedules
const f16text = readFileSync(join(FX, "form16-demo.txt"), "utf8");
const f16 = read("form16-demo.txt", f16text.replace(/ZZZPX9999Z/g, "ZZZPX9999Z"));
ok(f16.kind === "form16" && f16.pan === "ZZZPX9999Z" && f16.ay === "2026", "Form 16 read: kind, PAN, AY (" + (f16.kind || f16.error && f16.error.code) + ")");
ok(f16.data && f16.data.tan === "DELD99999D" && f16.data.s171 === 1200000 && f16.data.tds === 90000, "Form 16: TAN, 17(1), TDS");
const row = salaryFromForm16(f16.data);
eq(row.s172, 50000, "Form 16 -> Schedule S row: 17(2)");
const R3s = await run("ITR-3", { regime: "new", salaries: SAL, houses: [let1], cgRows: CGS }, "the checks' return", (m) => { m.paid.tdsSal.push({ tan: "DELD99999D", name: "DEMO EMPLOYER PVT LTD", sec: "192", gross: 1250000, amt: 90000 }); });
eq(R3s.doc.ScheduleTDS1.TDSonSalary[0].TotalTDSSal, 90000, "Schedule TDS1: TDS on salary from 26AS (192)");
eq(R3s.doc.ScheduleTDS1.TDSonSalary[0].IncChrgSal, 1175000, "Schedule TDS1: the employer's chargeable salary");
const imp = Object.assign({}, R3s.imports, { f16: [{ kind: "form16", data: f16.data, name: "form16-demo.txt" }] });
imp.ais = { data: { rows: [{ code: "TDS-192", desc: "Salary", amount: 1250000, tax: 90000, cat: "salary", srcId: "DELD99999D" }, { code: "TDS-194I(b)", desc: "Rent on land or building", amount: 360000, tax: 36000, cat: "rent" },
  { code: "SFT-017(SAL)", desc: "Sale of securities and units of mutual fund", amount: 1100000, cat: "cgsale" }, { code: "SFT-012(SAL)", desc: "Sale of immovable property", amount: 6000000, cat: "cgprop" }] } };
ck = verify({ model: R3s.model, main: R3s.comp, imports: imp, books: R3s.D.books, coverage: R3s.json.coverage, accepted: {} });
const st = (id) => (ck.find((x) => x.id === id) || {}).status;
eq(st("f16_salary"), "matched", "Checks: Form 16 gross salary against Schedule S");
eq(st("f16_tds"), "matched", "Checks: Form 16 TDS against the TDS claimed on salary");
eq(st("ais_salary"), "matched", "Checks: AIS salary against Schedule S");
eq(st("ais_rent"), "matched", "Checks: AIS rent against Schedule HP (the owner's share)");
eq(st("ais_cg_sec"), "matched", "Checks: AIS sale of securities 11,00,000 against Schedule CG (3,00,000 + 2,60,000 + 5,40,000)");
eq(st("ais_cg_prop"), "matched", "Checks: AIS sale of property against Schedule CG");
imp.ais.data.rows[2].amount = 1150000;
ck = verify({ model: R3s.model, main: R3s.comp, imports: imp, books: R3s.D.books, coverage: R3s.json.coverage, accepted: {} });
const dif = ck.find((x) => x.id === "ais_cg_sec");
ok(dif.status === "difference" && dif.diff === -50000, "Checks: a sale in the AIS not in Schedule CG is a difference of 50,000 (" + dif.diff + ")");

// ITR-4: salary, one house, 112A within 1.25 lakh
const R4 = await run("ITR-4", { regime: "new", salaries: SAL, houses: [let1], cgRows: [{ id: "a4", kind: "eq", desc: "DEMO LISTED EQUITY", acq: "20200101", sale: "20250701", value: 200000, cost: 100000 }] }, "salary, a house, 112A");
eq(R4.doc.IncomeDeductions.IncomeFromSal, 1175000, "ITR-4: salary");
eq(R4.doc.IncomeDeductions.TotalIncomeChargeableUnHP, 93600, "ITR-4: house property");
eq(R4.doc.LTCG112A.LongCap112A, 100000, "ITR-4: LTCG 112A from the rows");
eq(R4.doc.IncomeDeductions.PropertyDetails[0].Rentdetails.IncomeOfHP, 93600, "ITR-4: the property");

// ITR-5: a firm's house property and capital gains
const R5 = await run("ITR-5", { houses: [Object.assign({}, let1, { kind: "L" })], cgRows: [rows[1], rows[2], rows[4]] }, "a firm: house property, capital gains");
eq(R5.doc.ScheduleHP.TotalIncomeChargeableUnHP, 93600, "ITR-5: Schedule HP");
eq(R5.comp.heads.c112, 3350000, "ITR-5: a firm's land at 12.5% without indexation, the unlisted loss set off");
eq(R5.comp.cgRelief || 0, 0, "ITR-5: no proviso for a firm");
eq(R5.doc.ScheduleCG.SumOfCGIncm, R5.comp.heads.cg, "ITR-5: Schedule CG");

// ITR-6: SH, AL, Ind AS
const SH = { listed: [], DtlsSHEndPreviousYearUC: [{ ShareholderName: "DEMO PROMOTER ONE", ResidentialStatus: "RES", ShareType: "ES", PAN: "ZZZPA1111A", AllotmentDate: "2015-04-01", NumberOfSharesHeld: 5000, FaceValuePerShare: 10, IssuePricePerShare: 10, AmountReceived: 50000 },
  { ShareholderName: "DEMO PROMOTER TWO", ResidentialStatus: "RES", ShareType: "ES", PAN: "ZZZPB2222B", AllotmentDate: "2015-04-01", NumberOfSharesHeld: 5000, FaceValuePerShare: 10, IssuePricePerShare: 10, AmountReceived: 50000 }] };
let R6 = await run("ITR-6", { sh: SH, profile: { listed: false, indAs: false, authorised: 500000 } }, "an unlisted company with Schedule SH");
ok(!R6.json.coverage.some((x) => x.key === "sh"), "ITR-6: Schedule SH filled, not blocking");
eq(R6.doc.ScheduleSH.ShrhldngUnlistedCompany.DtlsSHEndPreviousYearUC.length, 2, "Schedule SH-1: two shareholders");
ck = verify({ model: R6.model, main: R6.comp, imports: R6.imports, books: R6.D.books, coverage: R6.json.coverage, accepted: {} });
ok(ck.find((x) => x.id === "sh_capital"), "Checks: Schedule SH against the share capital in the balance sheet");
const R6i = await run("ITR-6", { sh: SH, indAsOci: { remeasure: -20000 }, profile: { listed: false, indAs: true, authorised: 500000 } }, "an Ind AS company");
ok(!R6i.json.coverage.some((x) => x.key === "indas"), "ITR-6 Ind AS: Part A-BS / P&L Ind AS filled, not blocking");
const bi = R6i.doc.PARTA_BSIndAS;
eq(bi.TotalAssets, bi.EquityAndLiablities.Liabilities.CurrentLiabilities.TotalEquityLiab, "Ind AS balance sheet: assets = equity and liabilities (" + bi.TotalAssets + ")");
ok(bi.TotalAssets > 0, "Ind AS balance sheet carries the books' figures");
eq(R6i.doc.PARTA_PLIndAS.DebitsToPL.DebitPlAcnt.PBT, R6i.D.books.sched.totals.pbt, "Ind AS P&L: profit before tax");
eq(R6i.doc.PARTA_PLIndAS.OtherComprnsvInc.ItemsNotReclsfdPnL.ReMesDefinedBenftPlans, -20000, "Ind AS: OCI entered");
eq(R6i.doc.PARTA_BSFor6FrmAY13.TotalAssets, 0, "Ind AS company: the Schedule III (Division I) parts left at 0");
ck = verify({ model: R6i.model, main: R6i.comp, imports: R6i.imports, books: R6i.D.books, coverage: R6i.json.coverage, accepted: {} });
ok(ck.find((x) => x.id === "indas_map" && x.status === "needs"), "Checks: the Ind AS mapping from the books is asked to be confirmed");
const AL6 = { DtlsLoansAdvancesUC: [{ PersonName: "DEMO BORROWER", PAN: "ZZZPC3333C", OpeningBalance: 100000, AmountReceived: 0, AmountPaid: 20000, InterestCredited: 0, ClosingBalance: 120000, InterestRate: 0 }] };
R6 = await run("ITR-6", { sh: SH, al6: AL6, profile: { listed: false, indAs: false, authorised: 500000 } }, "an unlisted company with Schedule AL-1");
ok(R6.doc.ScheduleAL && R6.doc.ScheduleAL.AsstLiabilitiesUnlistedCompany.ALUnlistedCompanyFlag === "Y", "ITR-6: Schedule AL-1 given");

// random returns through both computations
console.log("Random returns through both computations");
let agree = 0;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const kinds = ["eq", "eq", "land", "unlisted", "mf50AA", "other", "bond", "buyback"];
const D3 = await demo("ITR-3"), files3 = Object.entries(D3.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v));
for (let i = 0; i < 300; i++) {
  const cgr = Array.from({ length: rnd(0, 4) }, (_, j) => { const k = kinds[rnd(0, kinds.length - 1)], y = rnd(2000, 2025), m = rnd(1, 12); const acq = String(y) + String(m).padStart(2, "0") + "15";
    const sale = "2025" + String(rnd(4, 12)).padStart(2, "0") + String(rnd(1, 28)).padStart(2, "0");
    return { id: "r" + j, kind: k, listed: true, acq: acq > sale ? "20200101" : acq, sale, value: k === "buyback" ? 0 : rnd(0, 9000000), cost: rnd(0, 6000000), sdv: k === "land" ? rnd(0, 9000000) : 0, fmv2018: rnd(0, 3) ? rnd(0, 5000000) : 0, expenses: rnd(0, 50000), improve: k === "land" && rnd(0, 1) ? [{ fy: String(rnd(2001, 2024)), amt: rnd(0, 900000) }] : [] }; });
  const hs = Array.from({ length: rnd(0, 3) }, () => ({ kind: ["L", "S", "D"][rnd(0, 2)], share: [100, 50][rnd(0, 1)], rent: rnd(0, 900000), muniTax: rnd(0, 30000), unrealised: rnd(0, 1) ? rnd(0, 50000) : 0, arrears: rnd(0, 3) ? 0 : rnd(0, 100000), loans: rnd(0, 1) ? [{ bank: "B", account: "1", date: "20200101", total: 1, outstanding: 1, interest: rnd(0, 400000) }] : [] }));
  const sal = rnd(0, 1) ? [{ employer: "E", nature: ["OTH", "CGOV"][rnd(0, 1)], s171: rnd(0, 3000000), s172: rnd(0, 200000), s173: rnd(0, 100000), basicDa: rnd(0, 1500000), ptax: rnd(0, 2500), ent: rnd(0, 6000), exempt: [{ sec: ["10(5)", "10(10)", "10(10AA)", "10(13A)"][rnd(0, 3)], amt: rnd(0, 400000) }], hra: rnd(0, 1) ? { metro: !!rnd(0, 1), received: rnd(0, 300000), rent: rnd(0, 400000) } : null }] : [];
  const stR = Object.assign({}, D3.booksObj.itr["2026|state"], { regime: ["new", "old"][rnd(0, 1)], form10iea: "X", cgRows: cgr, houses: hs, salaries: sal, filingDate: ["20260720", "20261125", "20260301"][rnd(0, 2)], resident: rnd(0, 5) > 0 });
  const m = buildModel({ entity: "P", client: D3.client, imports: importsOf(files3), books: D3.books, state: stR });
  if (rnd(0, 2) === 0) m.business = Object.assign({}, m.business, { pbt: rnd(-3000000, 3000000) });
  const dd2 = differences(compute(m).key, check(m));
  if (!dd2.length) agree++; else if (agree + 1 === i) console.log("    differ: " + JSON.stringify(dd2.slice(0, 3)));
}
eq(agree, 300, "300 random returns with salary, houses and capital gains: both computations agree on every figure");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
