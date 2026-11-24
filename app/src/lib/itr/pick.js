// Which ITR form (AY 2026-27). The owner's review of 23-Nov-2026: a company was put on ITR-5. The form is recommended
// from the kind of person (Client setup's choice, else the PAN's fourth letter) and the income FinCom knows, with the
// reason in plain words, and defaulted; the person can choose another (kept per client per year: b.itr "<ay>|state",
// form + formSet). A form FinCom's JSON does not cover (forms.js ROOT) is said plainly, never built as another form.
// Pure: the tests give it the facts (tests/run_itr_formpick.mjs).
import { ROOT } from "./forms.js";
import { ITR1 } from "./law.js";

export const ALL_FORMS = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"];
// the forms whose official JSON FinCom makes (forms.js maps them, the schemas are in itr-schema/)
export const JSON_FORMS = Object.keys(ROOT);
const KIND = { P: "an individual", H: "a Hindu undivided family (HUF)", C: "a company", F: "a firm or LLP", A: "an association of persons (AOP)", B: "a body of individuals (BOI)",
  J: "an artificial juridical person", L: "a local authority", G: "a government body", T: "a trust" };
const SHORT = { P: "an individual", H: "a HUF", C: "a company", F: "a firm", A: "an AOP", B: "a BOI", J: "an artificial juridical person", L: "a local authority", G: "a government body", T: "a trust" };
const LIMIT = ITR1.maxIncome; // ITR-1 and ITR-4: total income up to Rs 50 lakh
// no PAN and no kind of taxpayer in Client setup: no form is picked and no JSON made (the review of 24-Nov-2026)
export const NO_KIND = "FinCom needs the PAN or the kind of taxpayer to pick the form. Add the PAN, or choose the kind of taxpayer, in Client setup; until then no JSON is made.";
const orList = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " or " + a[a.length - 1] : a[0] || "");
// ITR-1's rule 12 facts (law.js ITR1): what rules it out, and what is not known yet (never taken as No)
function itr1Bars(f) {
  const agri = f.agriIncome != null && f.agriIncome !== "" ? +f.agriIncome > ITR1.agriMax : f.agriOver;
  const unl = f.unlistedSold === true ? true : f.unlisted;
  const facts = [[f.director, "is a director in a company", "whether the person is a director in a company"], [unl, "has held unlisted equity shares in the year", "whether unlisted equity shares were held in the year"],
    [agri, "has agricultural income above Rs 5,000", "whether agricultural income is above Rs 5,000"]];
  return { no: facts.filter((x) => x[0] === true).map((x) => x[1]), unknown: facts.filter((x) => x[0] !== true && x[0] !== false).map((x) => x[2]) };
}

// the kind of person: Client setup's choice first, else the PAN's fourth letter (the GSTIN carries the PAN)
export function entityFrom(set, pan, gstin) {
  const s = String(set || "").toUpperCase(), p = String(pan || String(gstin || "").slice(2, 12)).toUpperCase().trim();
  const fromPan = /^[A-Z]{5}\d{4}[A-Z]$/.test(p) && KIND[p[3]] ? p[3] : "";
  // the page's FS.entityOf gives the PAN's letter too: said as the PAN's when they agree
  if (KIND[s]) return { code: s, by: s === fromPan ? "pan" : "set" };
  if (fromPan) return { code: fromPan, by: "pan", pan: p };
  return { code: "", by: "" };
}

// the forms the law allows for the kind of person
export function allowedForms(code, llp) {
  switch (code) {
    case "P": return ["ITR-1", "ITR-2", "ITR-3", "ITR-4"];
    case "H": return ["ITR-2", "ITR-3", "ITR-4"];
    case "F": return llp === true ? ["ITR-5"] : ["ITR-4", "ITR-5"];
    case "C": return ["ITR-6", "ITR-7"];
    case "A": case "B": case "J": case "L": case "G": case "T": return ["ITR-5", "ITR-7"];
    default: return ALL_FORMS.slice();
  }
}

// f: {entity (Client setup's code), pan, gstin, llp, exempt (claims exemption under section 11 / 10: true, false or
// unanswered), business (the books or presumptive figures), presumptive, audit, resident, salary, houses (how many),
// capitalGains (other than 112A up to Rs 1.25 lakh), foreign, ti (total income, when worked out); ITR-1's rule 12 facts:
// director, unlisted (held unlisted equity shares), unlistedSold (one among the gains), agriIncome or agriOver (above
// Rs 5,000): true, false or not known}
// -> {form, why, code, by, allowed}
export function recommendForm(f) {
  f = f || {};
  const e = entityFrom(f.entity, f.pan, f.gstin), code = e.code, allowed = allowedForms(code, f.llp);
  const who = e.by === "set" ? "Client setup says this is " + KIND[code] + "." : e.by === "pan" ? "The PAN's fourth letter is " + code + ": " + KIND[code] + "." : "";
  const out = (form, why) => ({ form, why: (who ? who + " " : "") + why, code, by: e.by, allowed });
  const within = !(f.ti > LIMIT), resident = f.resident !== false;
  const presOk = f.presumptive && !f.audit && within && resident && !f.capitalGains;
  switch (code) {
    case "P": case "H":
      if (f.business) {
        if (presOk) return out("ITR-4", "Business income is declared on a presumptive basis (44AD, 44ADA, 44AE) and the total income is within Rs 50 lakh: ITR-4.");
        return out("ITR-3", "There is income from business or profession (the books), so ITR-3." + (f.presumptive ? " ITR-4 does not fit: " + (f.audit ? "a tax audit applies." : !within ? "the total income is above Rs 50 lakh." : !resident ? "not a resident." : "there are capital gains.") : ""));
      }
      if (code === "P" && resident && within && !f.capitalGains && !f.foreign && !(f.houses > 2)) {
        const bar = itr1Bars(f);
        if (!bar.no.length && !bar.unknown.length) return out("ITR-1", "No business income: salary, up to two houses and other sources, total income within Rs 50 lakh; not a director in a company, no unlisted shares, agricultural income Rs 5,000 or less: ITR-1.");
        if (bar.no.length) return out("ITR-2", "No business income, but ITR-1 is not for someone who " + orList(bar.no) + ": ITR-2.");
        return out("ITR-2", "No business income. FinCom does not know yet " + orList(bar.unknown) + ", and ITR-1 is not for such a person, so ITR-2. Answer the questions below to see if ITR-1 fits.");
      }
      return out("ITR-2", "No business income" + (code === "H" ? " (ITR-1 is for individuals only)" : "") + ": " + (code === "H" ? "ITR-2." : f.capitalGains ? "there are capital gains, so ITR-2." : f.houses > 2 ? "more than two houses, so ITR-2." : f.foreign ? "assets outside India, so ITR-2." : !resident ? "not a resident, so ITR-2." : "the total income is above Rs 50 lakh, so ITR-2."));
    case "F":
      if (f.llp === true) return out("ITR-5", "An LLP files ITR-5.");
      if (f.business && presOk) return out("ITR-4", "A partnership firm with presumptive income (44AD, 44ADA, 44AE) and total income within Rs 50 lakh: ITR-4.");
      return out("ITR-5", "A firm files ITR-5" + (f.llp == null ? " (ITR-4 only for a partnership firm, not an LLP, with presumptive income)." : "."));
    case "C":
      if (f.exempt === true) return out("ITR-7", "It claims exemption under section 11 (a section 8 company): ITR-7.");
      return out("ITR-6", "A company files ITR-6 (ITR-7 only if it claims exemption under section 11, such as a section 8 company).");
    case "T":
      if (f.exempt === false) return out("ITR-5", "It does not claim exemption under section 11 or 10: ITR-5.");
      return out("ITR-7", "A trust claiming exemption under section 11 or 10 files ITR-7 (one that does not claim it files ITR-5).");
    case "A": case "B": case "J": case "L": case "G":
      if (f.exempt === true) return out("ITR-7", "It claims exemption under section 11 or 10: ITR-7.");
      return out("ITR-5", SHORT[code].charAt(0).toUpperCase() + SHORT[code].slice(1) + " files ITR-5 (ITR-7 if it claims exemption under section 11 or 10).");
    default:
      return out("ITR-5", NO_KIND);
  }
}

// the form in use: the person's own choice (formSet), or a form saved before the chooser that is right for the kind of
// person; else the recommendation (an ITR-5 kept for a company from before is not kept silently)
export function chosenForm(st, rec) {
  st = st || {};
  if (st.form && ALL_FORMS.includes(st.form) && (st.formSet || !rec.code || rec.allowed.includes(st.form))) return st.form;
  return rec.form;
}

// what the page says about the form in use: {fits, json, text}
// (ITR-5's map is a firm's or an LLP's: an AOP, BOI, trust or other person's ITR-5 is not made yet, docs/ITR-MODULE.md)
export function formStatus(form, rec) {
  // no PAN and no kind (code ""): no form counts as fitting
  const fits = !!rec.code && rec.allowed.includes(form), notFirm = form === "ITR-5" && "ABJLGT".includes(rec.code || "-");
  const json = JSON_FORMS.includes(form) && fits && !notFirm;
  let text = "";
  if (!rec.code) text = NO_KIND;
  else if (!fits) text = form + " is not for " + SHORT[rec.code] + ". Use " + rec.allowed.join(" or ") + " (recommended: " + rec.form + "). FinCom makes no JSON for a form that does not fit.";
  else if (!JSON_FORMS.includes(form)) text = "FinCom cannot make the JSON for " + form + " yet (it makes " + JSON_FORMS.join(", ") + "). The computation and the checks are shown; prepare this return in Winman.";
  else if (notFirm) text = "FinCom's ITR-5 JSON is made for firms and LLPs only; for " + SHORT[rec.code] + " it cannot make it yet. The computation and the checks are shown; prepare this return in Winman.";
  return { fits, json, text };
}
