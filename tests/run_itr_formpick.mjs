// node tests/run_itr_formpick.mjs - which ITR form (the owner's review of 23-Nov-2026: a company was put on ITR-5).
// The form is recommended from the PAN's fourth letter (or the kind chosen in Client setup) and the income FinCom knows,
// with the reason in plain words; the person can choose another, kept per client per year; a form FinCom's JSON does
// not cover (ITR-1, ITR-2, ITR-7) is said plainly and never mapped as another form. Made-up PANs and figures only.
// ITR_LIB=<dir> runs the same cases against another copy of app/src/lib/itr (the fail-before log)
const LIB = process.env.ITR_LIB ? new URL("file://" + process.env.ITR_LIB.replace(/\/?$/, "/")) : new URL("../app/src/lib/itr/", import.meta.url);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(a === b, w + " (" + a + (a === b ? "" : ", expected " + b) + ")");
let P = {};
try { P = await import(new URL("pick.js", LIB)); } catch (e) { ok(false, "app/src/lib/itr/pick.js loads: " + String(e && e.message).slice(0, 100)); }
const { recommendForm, allowedForms, chosenForm, formStatus, entityFrom, JSON_FORMS } = P;
const T = (name, fn) => { try { fn(); } catch (e) { ok(false, name + ": threw " + String(e && e.message).slice(0, 120)); } };

console.log("1. the kind of person from the PAN's fourth letter (Client setup's choice first)");
T("entity", () => {
  eq(entityFrom("", "ZZZCX1234Z").code, "C", "ZZZCX1234Z: C, a company");
  eq(entityFrom("", "ZZZpx1234z").code, "P", "lower case PAN read too");
  eq(entityFrom("F", "ZZZCX1234Z").code, "F", "the kind chosen in Client setup wins over the PAN");
  eq(entityFrom("C", "ZZZCX1234Z").by, "pan", "the page's code agreeing with the PAN: said as the PAN's fourth letter");
  ok(/fourth letter is C/.test(recommendForm({ entity: "C", pan: "ZZZCX1234Z" }).why), "the page passes the code and the PAN: the reason still names the PAN's letter");
  eq(entityFrom("", "NOTAPAN").code, "", "no PAN: not known");
  eq(entityFrom("", "", "07ZZZTX1234Z1Z5").code, "T", "no PAN: read from the GSTIN");
});

console.log("2. the recommendation, with its reason");
T("company", () => {
  const r = recommendForm({ pan: "ZZZCX1234Z" });
  eq(r.form, "ITR-6", "company (C): ITR-6");
  ok(/fourth letter is C/.test(r.why) && /company/i.test(r.why) && /ITR-6/.test(r.why), "the reason says the PAN's fourth letter and the form: " + r.why);
  ok(!allowedForms("C").includes("ITR-5"), "ITR-5 is not offered as right for a company");
  eq(recommendForm({ pan: "ZZZCX1234Z", exempt: true }).form, "ITR-7", "a section 8 company claiming exemption: ITR-7");
  ok(/section 11|section 8/.test(recommendForm({ pan: "ZZZCX1234Z", exempt: true }).why), "ITR-7's reason names the exemption");
});
T("individual", () => {
  eq(recommendForm({ pan: "ZZZPX1234Z", business: true }).form, "ITR-3", "individual with business income (the books): ITR-3");
  const r12 = { director: false, unlisted: false, agriOver: false };
  eq(recommendForm(Object.assign({ pan: "ZZZPX1234Z", business: true, presumptive: true, ti: 1800000 }, r12)).form, "ITR-4", "individual, presumptive, income within 50 lakh, rule 12 answered No: ITR-4");
  eq(recommendForm({ pan: "ZZZPX1234Z", business: true, presumptive: true, ti: 1800000 }).form, "ITR-3", "individual, presumptive, but rule 12 not answered: ITR-3 (never ITR-4 on a guess)");
  eq(recommendForm({ pan: "ZZZPX1234Z", business: true, presumptive: true, ti: 6000000 }).form, "ITR-3", "presumptive but income above 50 lakh: ITR-3");
  eq(recommendForm({ pan: "ZZZPX1234Z", business: true, presumptive: true, audit: true }).form, "ITR-3", "presumptive with a tax audit: ITR-3");
  eq(recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000, director: false, unlisted: false, agriIncome: 0 }).form, "ITR-1", "salary only, within 50 lakh, not a director, no unlisted shares or agricultural income: ITR-1");
  eq(recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000 }).form, "ITR-2", "salary only, but whether a director, unlisted shares, agricultural income not known: ITR-2 (never ITR-1 on a guess)");
  eq(recommendForm({ pan: "ZZZPX1234Z", salary: true, capitalGains: true }).form, "ITR-2", "salary and capital gains: ITR-2");
  eq(recommendForm({ pan: "ZZZPX1234Z", salary: true, houses: 3 }).form, "ITR-2", "more than two houses: ITR-2");
  eq(recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 5500000 }).form, "ITR-2", "income above 50 lakh: ITR-2");
  eq(recommendForm({ pan: "ZZZPX1234Z", salary: true, resident: false }).form, "ITR-2", "a non-resident: ITR-2");
  ok(/business/i.test(recommendForm({ pan: "ZZZPX1234Z", business: true }).why), "ITR-3's reason names the business income");
});
T("HUF", () => {
  eq(recommendForm({ pan: "ZZZHX1234Z", business: true }).form, "ITR-3", "HUF with business: ITR-3");
  eq(recommendForm({ pan: "ZZZHX1234Z", business: true, presumptive: true, ti: 1800000, director: false, unlisted: false, agriOver: false }).form, "ITR-4", "HUF, presumptive, rule 12 answered No: ITR-4");
  eq(recommendForm({ pan: "ZZZHX1234Z", business: true, presumptive: true, ti: 1800000 }).form, "ITR-3", "HUF, presumptive, rule 12 not answered: ITR-3");
  eq(recommendForm({ pan: "ZZZHX1234Z", business: true, presumptive: true, ti: 1800000, director: true, unlisted: false, agriOver: false }).form, "ITR-3", "HUF, presumptive, a director (its karta): ITR-3");
  eq(recommendForm({ pan: "ZZZHX1234Z", salary: false }).form, "ITR-2", "HUF without business: ITR-2 (ITR-1 is for individuals only)");
  ok(!allowedForms("H").includes("ITR-1"), "ITR-1 not right for a HUF");
});
T("firm", () => {
  eq(recommendForm({ pan: "ZZZFX1234Z", business: true }).form, "ITR-5", "firm: ITR-5");
  eq(recommendForm({ pan: "ZZZFX1234Z", business: true, presumptive: true, llp: false, ti: 2000000, agriOver: false }).form, "ITR-4", "a partnership firm, presumptive, within 50 lakh, agricultural income Rs 5,000 or less: ITR-4");
  eq(recommendForm({ pan: "ZZZFX1234Z", business: true, presumptive: true, llp: false, ti: 2000000 }).form, "ITR-5", "a partnership firm, presumptive, agricultural income not answered: ITR-5");
  eq(recommendForm({ pan: "ZZZFX1234Z", business: true, presumptive: true, llp: false, ti: 2000000, agriOver: true }).form, "ITR-5", "a partnership firm with agricultural income above Rs 5,000: ITR-5");
  eq(recommendForm({ pan: "ZZZFX1234Z", business: true, presumptive: true, llp: true }).form, "ITR-5", "an LLP is never ITR-4: ITR-5");
  ok(!allowedForms("F", true).includes("ITR-4"), "ITR-4 not right for an LLP");
});
T("others", () => {
  ["A", "B", "J", "L", "G"].forEach((k) => eq(recommendForm({ pan: "ZZZ" + k + "X1234Z" }).form, "ITR-5", k + ": ITR-5"));
  ["A", "B", "J", "L", "G"].forEach((k) => eq(recommendForm({ pan: "ZZZ" + k + "X1234Z", exempt: true }).form, "ITR-7", k + " claiming exemption: ITR-7"));
  eq(recommendForm({ pan: "ZZZTX1234Z" }).form, "ITR-7", "trust (T): ITR-7");
  eq(recommendForm({ pan: "ZZZTX1234Z", exempt: false }).form, "ITR-5", "a trust not claiming exemption: ITR-5");
  const u = recommendForm({ pan: "" });
  ok(!!u.form && /needs the PAN or the kind of taxpayer to pick the form/.test(u.why), "no PAN: a form still in the chooser and the reason says FinCom needs the PAN or the kind of taxpayer: " + u.why);
  ok(!recommendForm({ pan: "" }).code && !recommendForm({ pan: "", gstin: "" }).code, "no PAN, no GSTIN, no kind: not known");
});

console.log("3. the person's own choice, kept; an old saved form that does not fit is not kept silently");
T("choice", () => {
  const rec = recommendForm({ pan: "ZZZCX1234Z" });
  eq(chosenForm({}, rec), "ITR-6", "nothing chosen: the recommended form");
  eq(chosenForm({ form: "ITR-5" }, rec), "ITR-6", "ITR-5 saved for a company before the chooser (not chosen by the person): the recommendation");
  eq(chosenForm({ form: "ITR-5", formSet: true }, rec), "ITR-5", "ITR-5 chosen by the person: kept");
  eq(chosenForm({ form: "ITR-4" }, recommendForm({ pan: "ZZZPX1234Z", business: true })), "ITR-4", "an individual's ITR-4 saved before: kept (it fits)");
  eq(chosenForm({ form: "ITR-4" }, recommendForm({ pan: "ZZZPX1234Z", business: true, presumptive: true, director: true })), "ITR-3", "an ITR-4 saved before for one now said to be a director: not kept silently, ITR-3");
  eq(chosenForm({ form: "ITR-4", formSet: true }, recommendForm({ pan: "ZZZPX1234Z", business: true, presumptive: true, director: true })), "ITR-4", "ITR-4 chosen by the person: kept (the page says it does not fit)");
});

console.log("4. what the JSON covers: a form it does not cover is said plainly, never built as another form");
T("status", () => {
  ok(JSON_FORMS && ["ITR-3", "ITR-4", "ITR-5", "ITR-6"].every((f) => JSON_FORMS.includes(f)) && !JSON_FORMS.includes("ITR-7") && !JSON_FORMS.includes("ITR-1") && !JSON_FORMS.includes("ITR-2"), "the JSON covers ITR-3, 4, 5, 6 (" + JSON_FORMS + ")");
  const rec = recommendForm({ pan: "ZZZCX1234Z" });
  let s = formStatus("ITR-5", rec);
  ok(!s.fits && !s.json && /not for a company/.test(s.text) && /ITR-6/.test(s.text), "ITR-5 for a company: does not fit, no JSON: " + s.text);
  s = formStatus("ITR-7", recommendForm({ pan: "ZZZCX1234Z", exempt: true }));
  ok(s.fits && !s.json && /JSON/.test(s.text) && /ITR-7/.test(s.text), "ITR-7: fits, but FinCom's JSON does not cover it, said plainly: " + s.text);
  s = formStatus("ITR-6", rec);
  ok(s.fits && s.json && !s.text, "ITR-6 for a company: fits, the JSON is made");
  s = formStatus("ITR-5", recommendForm({ pan: "ZZZAX1234Z" }));
  ok(s.fits && !s.json && /firms and LLPs/.test(s.text), "ITR-5 for an AOP: fits, but the ITR-5 map is a firm's: no JSON, said: " + s.text);
  ok(formStatus("ITR-5", recommendForm({ pan: "ZZZFX1234Z" })).json, "ITR-5 for a firm: the JSON is made");
  s = formStatus("ITR-1", recommendForm({ pan: "ZZZPX1234Z", salary: true }));
  ok(s.fits && !s.json, "ITR-1: fits a salaried person, no JSON yet");
  // the review of 24-Nov-2026: with no PAN and no kind of taxpayer, no form counts as fitting and no JSON is made
  const u = recommendForm({ pan: "" });
  ["ITR-3", "ITR-4", "ITR-5", "ITR-6", u.form].forEach((f) => { const z = formStatus(f, u); ok(!z.fits && !z.json && /needs the PAN or the kind of taxpayer to pick the form/.test(z.text), "no PAN, no kind: " + f + " builds no JSON, said plainly: " + z.text); });
});

console.log("5. the JSON builder refuses a form it has no map for (never another form's JSON)");
try {
  const F = await import(new URL("forms.js", LIB));
  let threw = false; try { F.mapReturn({ form: "ITR-7", model: {}, comp: {} }); } catch (e) { threw = /no map/.test(String(e.message)); }
  ok(threw, "mapReturn(ITR-7) throws 'no map' rather than building another form");
} catch (e) { ok(false, "forms.js: " + e.message); }

console.log("6. on the page: FinCom's own names are a classic script's const (S, FS), never properties of window");
// the page's program declares them as a script does: a global const, a function; nothing on globalThis for S and FS
try {
  const vm = await import("node:vm");
  vm.runInThisContext(`const S = { coId: "c1", companies: { c1: { id: "c1", name: "SAMPLE WORKS PRIVATE LIMITED", pan: "ZZZCX4321Z" }, c2: { id: "c2", name: "SAMPLE PERSON", pan: "ZZZPX4321Z" } }, books: { cid: "c1", itr: {} } };
    const FS = { entityOf(co) { const p = String((co || {}).pan || ""); return { code: p[3] || "" }; } };
    function CO(cid) { return S.companies[cid || S.coId]; }
    var __saved = 0; function saveBooks() { __saved++; return Promise.resolve(); }`);
  ok(globalThis.S === undefined && globalThis.FS === undefined, "the stand-in's S and FS are not on globalThis (as on the page)");
  const A = await import(new URL("appData.js", LIB)), ST = await import(new URL("store.js", LIB));
  const c = A.clientOf();
  eq(c.entity, "C", "clientOf(): the company's kind from FS (was \"\" read as window.FS: ITR-5, \"Other\")");
  const store = ST.makeStore(ST.appDeps());
  await store.setState({ form: "ITR-7", formSet: true });
  const kept = vm.runInThisContext("S.books.itr['2026|state']");
  ok(kept && kept.form === "ITR-7" && kept.formSet === true, "the chosen form is kept in the open client's books for AY 2026-27 (was lost: window.S)");
  eq(vm.runInThisContext("__saved"), 1, "and the books are saved");
  eq(store.state().form, "ITR-7", "read back for the same client and year");
  eq(store.state("2027").form, undefined, "another year has its own choice");
  vm.runInThisContext("S.coId = 'c2'; S.books = { cid: 'c2', itr: {} };");
  eq(store.state().form, undefined, "another client has its own choice");
  eq(A.clientOf().entity, "P", "and its own kind (P)");
} catch (e) { ok(false, "page names: threw " + String(e && e.stack).slice(0, 200)); }

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
