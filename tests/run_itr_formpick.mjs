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
  // the review of 24-Nov-2026 (2): the PAN's fourth letter settles the kind; Client setup's kind is used only without a PAN
  eq(entityFrom("F", "ZZZCX1234Z").code, "C", "Client setup says a firm, the PAN's fourth letter is C: the PAN is followed");
  eq(entityFrom("F", "ZZZCX1234Z").set, "F", "and what Client setup said is kept, to say so");
  eq(entityFrom("F", "").code, "F", "no PAN: the kind chosen in Client setup");
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
  eq(recommendForm({ pan: "ZZZFX1234Z", business: true, presumptive: true, llp: false, ti: 2000000, unlisted: false, agriOver: false }).form, "ITR-4", "a partnership firm, presumptive, within 50 lakh, no unlisted shares, agricultural income Rs 5,000 or less: ITR-4");
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

console.log("7. the review of 24-Nov-2026 (2): rule 12 in full for ITR-1 and ITR-4, the PAN settles the kind");
const N3 = { director: false, unlisted: false, agriOver: false };
const PRES = { business: true, presumptive: true, ti: 1800000 };
T("firm unlisted", () => {
  const F = (o) => recommendForm(Object.assign({ pan: "ZZZFX1234Z", llp: false }, PRES, o));
  eq(F({ unlisted: false, agriOver: false }).form, "ITR-4", "a partnership firm, presumptive, no unlisted shares, agricultural income Rs 5,000 or less: ITR-4");
  let r = F({ unlisted: true, agriOver: false });
  ok(r.form === "ITR-5" && /firm that held unlisted shares/.test(r.why), "a firm that held unlisted equity shares: ITR-5, said: " + r.why);
  ok(r.barred["ITR-4"] && !r.allowed.includes("ITR-4"), "and ITR-4 is not for it");
  r = F({ agriOver: false });
  ok(r.form === "ITR-5" && /unlisted/.test(r.why) && !/director/.test(r.why), "a firm, unlisted shares not answered: ITR-5, the firm is asked about unlisted shares (never director): " + r.why);
  eq(F({ director: true, unlisted: false, agriOver: false }).form, "ITR-4", "a firm: the director question is for individuals and HUFs only");
  const s = formStatus("ITR-4", F({ unlisted: true, agriOver: false }));
  ok(!s.fits && !s.json && /ITR-4 is not for a firm that held unlisted shares/.test(s.text), "ITR-4 chosen by hand for a firm with unlisted shares: no JSON, said: " + s.text);
});
T("blank answers", () => {
  const P = (o) => recommendForm(Object.assign({ pan: "ZZZPX1234Z" }, PRES, o));
  let s = formStatus("ITR-4", P({}));
  ok(s.fits && !s.json && s.tone === "info", "an individual, rule 12 not answered, ITR-4 chosen by hand: no JSON yet, in the info tone (" + s.tone + ")");
  ok(/answer the questions below/i.test(s.text) && /director/.test(s.text) && /unlisted/.test(s.text) && /agricultural/.test(s.text) && /ITR-4/.test(s.text), "and it says which questions to answer: " + s.text);
  s = formStatus("ITR-4", P({ director: false, unlisted: false }));
  ok(!s.json && /agricultural/.test(s.text) && !/director/.test(s.text), "one answer missing: only that one named: " + s.text);
  s = formStatus("ITR-4", P(N3));
  ok(s.fits && s.json && !s.text, "all three answered No: the ITR-4 JSON is made");
  s = formStatus("ITR-4", recommendForm(Object.assign({ pan: "ZZZFX1234Z", llp: false }, PRES, { agriOver: false })));
  ok(!s.json && /unlisted/.test(s.text) && !/director/.test(s.text), "a firm, unlisted not answered: no ITR-4 JSON, asked: " + s.text);
  s = formStatus("ITR-4", recommendForm(Object.assign({ pan: "ZZZHX1234Z" }, PRES)));
  ok(!s.json && /director/.test(s.text), "a HUF, not answered: no ITR-4 JSON: " + s.text);
  s = formStatus("ITR-1", recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000 }));
  ok(s.fits && !s.json && s.tone === "info" && /answer the questions below/i.test(s.text) && /director/.test(s.text), "ITR-1 chosen by hand, not answered: the questions named the same way: " + s.text);
  s = formStatus("ITR-1", recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000, ...N3 }));
  ok(!/answer the questions/i.test(s.text), "ITR-1, all answered: no question asked");
  s = formStatus("ITR-3", recommendForm({ pan: "ZZZPX1234Z", business: true }));
  ok(s.json && !s.text, "ITR-3 needs none of these answers: its JSON as before");
});
T("PAN settles the kind", () => {
  let r = recommendForm({ entity: "F", pan: "ZZZCX1234Z", business: true, presumptive: true, llp: false, agriOver: false, unlisted: false });
  ok(r.form === "ITR-6" && r.code === "C", "Client setup says a firm, the PAN a company: ITR-6 (" + r.form + ")");
  ok(/fourth letter is C/.test(r.why) && /Client setup says a firm/i.test(r.why) && /follows the PAN/.test(r.why), "said plainly: " + r.why);
  ok(!r.allowed.includes("ITR-5") && !r.allowed.includes("ITR-4"), "a company PAN never gets ITR-5 or ITR-4 (" + r.allowed + ")");
  ["ITR-4", "ITR-5"].forEach((f) => { const s = formStatus(f, r); ok(!s.fits && !s.json, "a company PAN, " + f + " chosen by hand: no JSON: " + s.text); });
  r = recommendForm({ entity: "P", pan: "ZZZFX1234Z" });
  ok(r.code === "F" && /Client setup says an individual/.test(r.why), "Client setup says an individual, the PAN a firm: a firm, said: " + r.why);
  r = recommendForm({ entity: "C", pan: "ZZZCX1234Z" });
  ok(!/Client setup says/.test(r.why), "Client setup and the PAN agree: nothing more said");
  eq(recommendForm({ entity: "C" }).form, "ITR-6", "no PAN: Client setup's kind is used");
});
T("assets outside India", () => {
  let r = recommendForm(Object.assign({ pan: "ZZZPX1234Z", foreign: true }, PRES, N3));
  ok(r.form === "ITR-3" && /outside India/.test(r.why) && r.barred["ITR-4"], "presumptive, assets outside India: ITR-3 (no Schedule FA in ITR-4): " + r.why);
  r = recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000, foreign: true, ...N3 });
  ok(r.form === "ITR-2" && r.barred["ITR-1"], "salary, assets outside India: ITR-2, ITR-1 barred");
  let s = formStatus("ITR-4", recommendForm(Object.assign({ pan: "ZZZPX1234Z", foreign: true }, PRES, N3)));
  ok(!s.fits && !s.json && /outside India/.test(s.text), "ITR-4 chosen by hand with assets outside India: no JSON, said: " + s.text);
  r = recommendForm(Object.assign({ pan: "ZZZFX1234Z", llp: false, foreign: true }, PRES, N3));
  ok(r.form === "ITR-5" && r.barred["ITR-4"], "a firm with assets outside India: ITR-5");
});
T("two houses in ITR-4", () => {
  eq(recommendForm(Object.assign({ pan: "ZZZPX1234Z", houses: 2 }, PRES, N3)).form, "ITR-4", "presumptive, two houses (AY 2026-27): ITR-4");
  const r = recommendForm(Object.assign({ pan: "ZZZPX1234Z", houses: 3 }, PRES, N3));
  ok(r.form === "ITR-3" && r.barred["ITR-4"] && /two houses|more than two/.test(r.why), "three houses: ITR-3: " + r.why);
});
T("other rule 12 bars", () => {
  const cases = [["a non-resident", { resident: false }, /not a resident|non-resident/], ["TDS under 194N", { tds194N: true }, /194N/], ["losses of earlier years", { bfLoss: true }, /loss/]];
  for (const [w, o, re] of cases) {
    let r = recommendForm(Object.assign({ pan: "ZZZPX1234Z" }, PRES, N3, o));
    ok(r.form === "ITR-3" && r.barred["ITR-4"] && re.test(r.why), "presumptive, " + w + ": ITR-3, ITR-4 barred: " + r.why);
    const s = formStatus("ITR-4", r);
    ok(!s.fits && !s.json && re.test(s.text), w + ", ITR-4 chosen by hand: no JSON, said: " + s.text);
    r = recommendForm(Object.assign({ pan: "ZZZPX1234Z", salary: true, ti: 900000 }, N3, o));
    ok(r.form === "ITR-2" && r.barred["ITR-1"], "salary, " + w + ": ITR-2, ITR-1 barred");
    r = recommendForm(Object.assign({ pan: "ZZZFX1234Z", llp: false }, PRES, N3, o));
    ok(r.form === "ITR-5" && r.barred["ITR-4"], "a firm, " + w + ": ITR-5");
  }
});
T("wording when not answered", () => {
  const r = recommendForm(Object.assign({ pan: "ZZZPX1234Z" }, PRES));
  ok(r.why.includes("ITR-4 is not for someone who is a director in a company, held unlisted shares or has agricultural income above Rs 5,000. Answer the questions below to see if it fits."), "the owner's words: " + r.why);
  ok(!/does not know yet|ITR-4 is not for such a person/.test(r.why), "not said as if ruled out already");
  const r1 = recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000 });
  ok(r1.why.includes("ITR-1 is not for someone who is a director in a company, held unlisted shares or has agricultural income above Rs 5,000. Answer the questions below to see if it fits."), "ITR-1 the same: " + r1.why);
});
T("no JSON yet in the info tone", () => {
  const s = formStatus("ITR-2", recommendForm({ pan: "ZZZPX1234Z", salary: true, ti: 900000, ...N3 }));
  ok(s.tone === "info" && /FinCom cannot make the JSON for ITR-2 yet/.test(s.text) && /Winman/.test(s.text), "ITR-2: the no-JSON-yet note in the info tone (" + s.tone + "): " + s.text);
  ok(formStatus("ITR-5", recommendForm({ pan: "ZZZCX1234Z" })).tone === "bad", "a form that does not fit: still the warning tone");
});

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
