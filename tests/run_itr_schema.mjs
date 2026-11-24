// node tests/run_itr_schema.mjs - every return JSON FinCom makes passes the official CBDT schema (AY 2026-27 ITR-3 V1.1,
// ITR-4 V1.1, ITR-5 V1.1, ITR-6 V1.0, fetched by tools/itr-schemas.sh with their SHA-256 pinned; not kept in the
// repository), checked with ajv (an independent JSON Schema validator) AND the page's own validator, which must agree;
// planted faults are rejected by both; nothing but an amount is ever filled in by FinCom (the rest is asked); and the
// JSON's figures are the computation's.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { importsOf, buildModel, buildProfile } from "../app/src/lib/itr/model.js";
import { compute } from "../app/src/lib/itr/tax.js";
import { makeJson } from "../app/src/lib/itr/json.js";
import { coverage } from "../app/src/lib/itr/forms.js";
import { validator } from "../app/src/lib/itr/validate.js";
import { demo } from "./itr_demo.mjs";
import { ajvFor, schemaOf, FILES, SCHEMA_DIR } from "./itr_validate.mjs";

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const PINS = { "ITR-3": "66f4bd705e0e0788fdacb37eb297ace56749d791b84f2f170f4da84236c25e8b", "ITR-4": "5e9af50083ad92faa684a02ae51693189b43df16b92c1da5a184026fc5cdc2ac",
  "ITR-5": "3bb5f158f63556c3b91706de2901dba7e4c71039e12ec7a181c4dfc96fead6a9", "ITR-6": "15fb24266820944b0ca69b16f35459eea75bdb21f653e5e07e3400d16ed83e6a" };
const ROOT = { "ITR-3": "ITR3", "ITR-4": "ITR4", "ITR-5": "ITR5", "ITR-6": "ITR6" };
const answer = (asks) => { const a = {}; asks.forEach((q) => { a[q.path] = q.choices ? (q.choices.includes("N") ? "N" : q.choices.includes("NO") ? "NO" : q.choices.includes("RES") ? "RES" : q.choices.includes("CA") ? "CA" : q.choices[0]) : q.kind === "date" ? "2026-11-25" : /PAN/i.test(q.path) ? "ZZZPV7777V" : "DEMO"; }); return a; };
const at = (doc, path) => path.split("/").filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), doc);

for (const form of Object.keys(FILES)) {
  console.log(form);
  const raw = readFileSync(SCHEMA_DIR + "/" + FILES[form]);
  ok(createHash("sha256").update(raw).digest("hex") === PINS[form], form + ": the schema file is the official one (SHA-256 pinned)");
  const schema = schemaOf(form), ajv = ajvFor(schema), mine = validator(schema);
  const D = await demo(form);
  const files = Object.entries(D.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v));
  const imports = importsOf(files), state = D.booksObj.itr["2026|state"];
  const base = { entity: D.client.entity, client: D.client, imports };
  // scenarios: the demo; a loss year; a refund with no books; MAT (companies)
  const scen = [["the demo books", state, D.books.sched]];
  const st2 = Object.assign({}, state, { filingDate: "20260720" }), books2 = JSON.parse(JSON.stringify(D.books));
  books2.sched.totals.pbt = -350000; scen.push(["a loss year, filed in time", st2, books2.sched, books2]);
  scen.push(["no books (Part A from nothing)", state, null, { ok: false, missing: ["none"] }]);
  // the reviewer's case: PBT -1 lakh with depreciation of 4 lakh (all unabsorbed depreciation), and -5 lakh (4 lakh of
  // it depreciation, 1 lakh business loss)
  const udCase = (pbt) => (m) => { m.business = Object.assign({}, m.business, { pbt, adds: [{ key: "dep_book", label: "book depreciation", amt: 400000, bp: "DepreciationDebPLCosAct" }], less: [], itDep: 400000 }); m.os = { interest: 0, dividend: 0, other: 0 }; };
  if (form !== "ITR-4") { scen.push(["PBT -1 lakh, depreciation 4 lakh", Object.assign({}, state, { filingDate: "20260720" }), D.books.sched, null, udCase(-100000)]); scen.push(["PBT -5 lakh, depreciation 4 lakh", Object.assign({}, state, { filingDate: "20260720" }), D.books.sched, null, udCase(-500000)]); }
  if (form === "ITR-6") scen.push(["MAT payable", Object.assign({}, state, { bookProfit: 90000000 }), D.books.sched]);
  if (form === "ITR-4") scen.push(["44ADA", Object.assign({}, state, { presumptive: { ada: { receipts: 4000000, cash: 100000 } } }), null]);
  for (const [name, st, sched, books, mutM] of scen) {
    const model = buildModel(Object.assign({}, base, { state: st, books: books || D.books }));
    if (mutM) mutM(model);
    const profile = buildProfile(Object.assign({}, base, { state: st }));
    const comp = compute(model);
    const first = makeJson({ form, schema, model, comp, sched, profile, answers: {}, today: "2026-11-22", dues43B: D.books.dues43B });
    ok(first.mapErrors.length === 0, form + ", " + name + ": every mapped field is in the schema" + (first.mapErrors.length ? ": " + first.mapErrors.slice(0, 3) : ""));
    ok(first.asks.every((q) => !(q.kind === "number")), form + ", " + name + ": FinCom fills no amount it does not have except with 0; " + first.asks.length + " non-amount fields asked");
    const r = makeJson({ form, schema, model, comp, sched, profile, answers: answer(first.asks), today: "2026-11-22", dues43B: D.books.dues43B });
    const a = ajv(r.doc) && !!(r.doc.ITR && r.doc.ITR[ROOT[form]]);
    ok(a, form + ", " + name + ": passes the official schema (ajv)" + (a ? "" : ": " + JSON.stringify((ajv.errors || []).slice(0, 3))));
    ok(r.schema.ok === a, form + ", " + name + ": the page's validator agrees with ajv");
    const R = r.doc.ITR[ROOT[form]];
    const ti = form === "ITR-4" ? R.IncomeDeductions.TotalIncome : R["PartB-TI"].TotalIncome;
    const refund = form === "ITR-4" ? R.Refund.RefundDue : R.PartB_TTI.Refund.RefundDue;
    const pay = form === "ITR-4" ? R.TaxPaid.BalTaxPayable : R.PartB_TTI.TaxPaid.BalTaxPayable;
    ok(ti === comp.ti && refund === comp.refund && pay === comp.payable, form + ", " + name + ": total income, refund and payable are the computation's (" + ti + ", " + refund + ", " + pay + ")");
    if (sched && form !== "ITR-4" && form !== "ITR-6") { const bs = R.PARTA_BS; ok(bs.FundSrc.TotFundSrc === bs.FundApply.TotFundApply, form + ", " + name + ": Part A-BS sources equal application (" + bs.FundSrc.TotFundSrc + ")"); }
    if (mutM) {
      const ud = R[form === "ITR-3" ? "ITR3ScheduleUD" : "ITRScheduleUD"], cfl = R.ScheduleCFL, cyUd = comp.carry.cyUd, cyBus = comp.carry.cyBus;
      ok(cyUd ? ud && ud.CurrAssYr === "2026-27" && ud.CurBalCFNY === cyUd && ud.TotDepritBalCFNY === cyUd : !ud, form + ", " + name + ": Schedule UD carries this year's unabsorbed depreciation (" + cyUd + (cyUd ? "" : ": none, the partners' 40(b) add-back leaves a profit") + ")");
      const bus = cfl ? cfl.CurrentAYloss.LossSummaryDetail[form === "ITR-6" ? "BroughtFrwdBusLossSetOffDrYr" : "BusLossOthThanSpecLossCF"] : 0;
      ok(bus === cyBus && (!cfl || !cfl.LossCFCurrentAssmntYear) && R["PartB-TI"].LossesOfCurrentYearCarriedFwd === cyBus, form + ", " + name + ": Schedule CFL's row of this year (not AY 2019-20's) carries the business loss net of the depreciation (" + cyBus + "), and Part B-TI the same");
      ok(!r.coverage.some((x) => x.key === "cf_unmapped"), form + ", " + name + ": everything carried forward is in the JSON (no block)");
    }
    if (name === "the demo books") {
      const cov = r.coverage.map((x) => x.key).join(",");
      ok(form === "ITR-6" ? cov === "sh" : cov === "", form + ": every schedule with figures is filled" + (form === "ITR-6" ? " except Schedule SH, which blocks the JSON" : "") + " (" + (cov || "none open") + ")");
      const R3 = r.doc.ITR[ROOT[form]];
      if (form !== "ITR-4") ok(R3.ScheduleDPM && R3.ScheduleDPM.PlantMachinery.Rate15.DepreciationDetail.TotalDepreciation === 180000 && R3.ScheduleDEP.SummaryFromDeprSch.TotalDepreciation === 197500, form + ": Schedule DPM by block (15% 1,80,000; 40% 17,500) and DEP's total 1,97,500");
      if (form === "ITR-3") ok(R3.ScheduleOS.IncOthThanOwnRaceHorse.IntrstFrmTermDeposit === 52000 && R3.ScheduleCYLA.BusProfExclSpecProf.IncCYLA.IncOfCurYrUnderThatHead === comp.heads.pgbp, "ITR-3: Schedule OS (term deposit interest 52,000) and CYLA from the heads");
      if (form === "ITR-6") { const bs = R3.PARTA_BSFor6FrmAY13; ok(bs.TotalAssets === bs.EquityAndLiablities.TotEquityAndLiabilities && bs.TotalAssets > 0, "ITR-6: Schedule III balance sheet: total assets = equity and liabilities (" + bs.TotalAssets + ")"); }
      if (form === "ITR-6") ok(R3.ScheduleMAT && R3.ScheduleMAT.BookProfUs115JB === model.bookProfit && R3.ScheduleMATC.CurAssYr === "2026-27", "ITR-6: Schedules MAT (book profit) and MATC");
      if (form === "ITR-5") ok(R3.PartA_GEN2.PartnerOrMemberInfo.length === 2 && R3.PartA_GEN2.PartnerOrMemberInfo[0].PAN === "ZZZPA1111A", "ITR-5: the partners' list");
      if (form === "ITR-4") { const a = model.deductions; ok(R3.IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions === comp.ded, "ITR-4: Chapter VI-A shows the allowed amounts"); }
      const tdsHeads = (form === "ITR-4" ? R3.TDSonOthThanSals.TDSonOthThanSalDtls : R3.ScheduleTDS2.TDSOthThanSalaryDtls).map((x) => x.HeadOfIncome).join(",");
      ok(/OS/.test(tdsHeads) && /BP/.test(tdsHeads), form + ": TDS head of income from the section (194A interest OS, 194J / 194C BP): " + tdsHeads);
      // planted faults: both validators reject each
      const faults = [["a lower-case PAN", (d) => { const p = form === "ITR-4" ? "PersonalInfo" : form === "ITR-3" ? "PartA_GEN1/PersonalInfo" : "PartA_GEN1/OrgFirmInfo"; at(d.ITR[ROOT[form]], p).PAN = "zzzpx9999z"; }],
        ["total income as text", (d) => { const o = form === "ITR-4" ? d.ITR.ITR4.IncomeDeductions : d.ITR[ROOT[form]]["PartB-TI"]; o.TotalIncome = String(o.TotalIncome); }],
        ["a key the schema does not have", (d) => { d.ITR[ROOT[form]].CreationInfo.Extra = 1; }],
        ["a required part removed", (d) => { delete d.ITR[ROOT[form]].Verification; }],
        ["a refund below zero", (d) => { const o = form === "ITR-4" ? d.ITR.ITR4.Refund : d.ITR[ROOT[form]].PartB_TTI.Refund; o.RefundDue = -10; }],
        ["a wrong assessment year", (d) => { d.ITR[ROOT[form]]["Form_" + ROOT[form]].AssessmentYear = "2025"; }]];
      faults.forEach(([what, f]) => { const d = JSON.parse(JSON.stringify(r.doc)); f(d); const x = ajv(d), y = mine(d).ok; ok(!x && !y, form + ": " + what + " is rejected by both validators"); });
      const strings = first.asks.filter((q) => q.kind === "yn" || q.kind === "choice");
      ok(form === "ITR-4" ? strings.some((q) => /Form10IEAEarlierAYOldRegime/.test(q.path)) : strings.some((q) => /ResidentialStatus/.test(q.path)), form + ": a Yes/No or a choice FinCom cannot know is asked, never assumed (" + strings.map((q) => q.path.split("/").pop()).slice(0, 4).join(", ") + ")");
    }
  }
}
console.log("coverage: a schedule with figures FinCom does not fill blocks the JSON");
{
  const D = await demo("ITR-3"), schema = schemaOf("ITR-3");
  const files = Object.entries(D.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v)), imports = importsOf(files);
  const mk = (extra) => { const st = Object.assign({}, D.booksObj.itr["2026|state"], extra); const model = buildModel({ entity: "P", client: D.client, imports, state: st, books: D.books }); const comp = compute(model);
    return makeJson({ form: "ITR-3", schema, model, comp, sched: D.books.sched, profile: buildProfile({ entity: "P", client: D.client, imports, state: st }), answers: {}, today: "2026-11-22" }).coverage.map((x) => x.key); };
  ok(mk({ hp: 120000 }).includes("hp"), "house property income: Schedule HP blocks");
  ok(mk({ salary: { gross: 600000 } }).includes("salary"), "salary in ITR-3: Schedule S blocks");
  ok(mk({ cg: { s111A: 50000 } }).includes("cg"), "capital gains: Schedule CG blocks");
  ok(mk({ deductions: { "80C": 100000 }, regime: "old" }).includes("via_80C"), "80C claimed: Schedule 80C details block");
  ok(mk({ losses: { business: [{ ay: "2023", amt: 50000 }] } }).includes("cfl_prior"), "earlier years' losses: CFL rows block");
  ok(mk({ audit: true, profile: { auditor: {} } }).includes("audit_info"), "a tax audit without the report's details blocks");
  ok(mk({ losses: { unabsorbedDep: 70000 } }).includes("ud"), "unabsorbed depreciation of earlier years: Schedule UD's rows block");
  // a carry-forward the map does not hold blocks: coverage() against a map without Schedules CFL / UD
  { const st = Object.assign({}, D.booksObj.itr["2026|state"], { filingDate: "20260720" }); const model = buildModel({ entity: "P", client: D.client, imports, state: st, books: D.books });
    model.business = Object.assign({}, model.business, { pbt: -500000, adds: [], less: [], itDep: 400000 }); const comp = compute(model);
    const keys = coverage({ form: "ITR-3", model, comp, profile: {} }, {}).map((x) => x.key);
    ok(keys.includes("cf_unmapped"), "this year's loss and unabsorbed depreciation not in the map: blocked (cf_unmapped)");
    const k4 = coverage({ form: "ITR-4", model, comp, profile: {} }, {}).map((x) => x.key);
    ok(k4.includes("cf_itr4"), "ITR-4 with a loss to carry forward: blocked"); }
}
console.log("presumptive income on ITR-3 / ITR-5 without books: computed, the JSON held (its no-books lines are not filled yet)");
{
  for (const [form, entity, pan] of [["ITR-3", "P", "ZZZPZ9999Z"], ["ITR-5", "F", "ZZZFZ9999Z"]]) {
    const st = { form, presumptive: { ad: { digital: 3000000, other: 500000 } }, regime: "new", llp: false };
    const model = buildModel({ entity, client: { entity, pan }, state: st, books: null, imports: importsOf([]) }), comp = compute(model);
    ok(comp.ti === 220000, form + ", no books, 44AD: the presumptive income is computed (TI " + comp.ti + ")");
    const keys = coverage({ form, model, comp, profile: {} }, {}).map((x) => x.key);
    ok(keys.includes("pres_nobooks"), form + ": the JSON is held, said (" + keys.join(",") + ")");
  }
  const st4 = { form: "ITR-4", presumptive: { ad: { digital: 3000000, other: 500000 } }, regime: "new" };
  const m4 = buildModel({ entity: "P", client: { entity: "P", pan: "ZZZPZ9999Z" }, state: st4, books: null, imports: importsOf([]) });
  ok(!coverage({ form: "ITR-4", model: m4, comp: compute(m4), profile: {} }, {}).some((x) => x.key === "pres_nobooks"), "ITR-4: not held");
}
console.log("ITR-4 houses: up to the schema's own limit (the review of 24-Nov-2026 (2))");
{
  const LW = await import("../app/src/lib/itr/law.js");
  const sch = schemaOf("ITR-4"), max = ((((sch.definitions || {}).IncomeDeductions || {}).properties || {}).PropertyDetails || {}).maxItems;
  ok(max === 2 && LW.itr4Houses && LW.itr4Houses(LW.AY) === max, "ITR-4 AY 2026-27: PropertyDetails maxItems " + max + ", law.js the same (" + (LW.itr4Houses && LW.itr4Houses(LW.AY)) + ")");
  const D = await demo("ITR-4"), files = Object.entries(D.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v)), imports = importsOf(files);
  const house = (i) => ({ id: "h" + i, kind: "L", rent: 120000, municipal: 0 });
  const keys = (n) => { const st = Object.assign({}, D.booksObj.itr["2026|state"], { houses: Array.from({ length: n }, (_, i) => house(i)) }); const model = buildModel({ entity: "P", client: D.client, imports, state: st, books: D.books }); const comp = compute(model);
    return coverage({ form: "ITR-4", model, comp, profile: {} }, {}).map((x) => x.key); };
  ok(!keys(2).includes("hp_itr4"), "ITR-4 with two houses: not blocked");
  ok(keys(3).includes("hp_itr4"), "ITR-4 with three houses: blocked");
}
console.log("the residential status chosen on the form box (the review of 24-Nov-2026 (3)): the computation and ITR-3 take it");
{
  const D = await demo("ITR-3"), schema = schemaOf("ITR-3");
  const files = Object.entries(D.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v)), imports = importsOf(files);
  const mod = (res) => buildModel({ entity: "P", client: D.client, imports, state: Object.assign({}, D.booksObj.itr["2026|state"], { resident: res }), books: D.books });
  ok(mod("NRI").resident === false && mod("NOR").resident === true && mod("RES").resident === true && mod(undefined).resident === true && mod(false).resident === false,
    "the computation: a non-resident is not a resident; not ordinarily resident is (section 6); not set as before (" + ["NRI", "NOR", "RES", undefined, false].map((x) => mod(x).resident) + ")");
  for (const res of ["RES", "NOR"]) {
    const model = mod(res), comp = compute(model), st = Object.assign({}, D.booksObj.itr["2026|state"], { resident: res });
    const j = makeJson({ form: "ITR-3", schema, model, comp, sched: D.books.sched, profile: buildProfile({ entity: "P", client: D.client, imports, state: st }), answers: {}, today: "2026-11-22" });
    ok(!j.asks.some((q) => /ResidentialStatus/.test(q.path)) && at(j.doc, "ITR/ITR3/PartA_GEN1/FilingStatus/ResidentialStatus") === res, "ITR-3 with " + res + " chosen: filled, not asked again (" + at(j.doc, "ITR/ITR3/PartA_GEN1/FilingStatus/ResidentialStatus") + ")");
  }
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
