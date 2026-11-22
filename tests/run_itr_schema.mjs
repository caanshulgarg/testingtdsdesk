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
  if (form === "ITR-6") scen.push(["MAT payable", Object.assign({}, state, { bookProfit: 90000000 }), D.books.sched]);
  if (form === "ITR-4") scen.push(["44ADA", Object.assign({}, state, { presumptive: { ada: { receipts: 4000000, cash: 100000 } } }), null]);
  for (const [name, st, sched, books] of scen) {
    const model = buildModel(Object.assign({}, base, { state: st, books: books || D.books }));
    const profile = buildProfile(Object.assign({}, base, { state: st }));
    const comp = compute(model);
    const first = makeJson({ form, schema, model, comp, sched, profile, answers: {}, today: "2026-11-22" });
    ok(first.mapErrors.length === 0, form + ", " + name + ": every mapped field is in the schema" + (first.mapErrors.length ? ": " + first.mapErrors.slice(0, 3) : ""));
    ok(first.asks.every((q) => !(q.kind === "number")), form + ", " + name + ": FinCom fills no amount it does not have except with 0; " + first.asks.length + " non-amount fields asked");
    const r = makeJson({ form, schema, model, comp, sched, profile, answers: answer(first.asks), today: "2026-11-22" });
    const a = ajv(r.doc) && !!(r.doc.ITR && r.doc.ITR[ROOT[form]]);
    ok(a, form + ", " + name + ": passes the official schema (ajv)" + (a ? "" : ": " + JSON.stringify((ajv.errors || []).slice(0, 3))));
    ok(r.schema.ok === a, form + ", " + name + ": the page's validator agrees with ajv");
    const R = r.doc.ITR[ROOT[form]];
    const ti = form === "ITR-4" ? R.IncomeDeductions.TotalIncome : R["PartB-TI"].TotalIncome;
    const refund = form === "ITR-4" ? R.Refund.RefundDue : R.PartB_TTI.Refund.RefundDue;
    const pay = form === "ITR-4" ? R.TaxPaid.BalTaxPayable : R.PartB_TTI.TaxPaid.BalTaxPayable;
    ok(ti === comp.ti && refund === comp.refund && pay === comp.payable, form + ", " + name + ": total income, refund and payable are the computation's (" + ti + ", " + refund + ", " + pay + ")");
    if (sched && form !== "ITR-4" && form !== "ITR-6") { const bs = R.PARTA_BS; ok(bs.FundSrc.TotFundSrc === bs.FundApply.TotFundApply, form + ", " + name + ": Part A-BS sources equal application (" + bs.FundSrc.TotFundSrc + ")"); }
    if (name === "the demo books") {
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
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
