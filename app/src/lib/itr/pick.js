// Which ITR form (AY 2026-27). The owner's review of 23-Nov-2026: a company was put on ITR-5. The form is recommended
// from the kind of person (the PAN's fourth letter; Client setup's choice only without a PAN) and the income FinCom knows, with the
// reason in plain words, and defaulted; the person can choose another (kept per client per year: b.itr "<ay>|state",
// form + formSet). A form FinCom's JSON does not cover (forms.js ROOT) is said plainly, never built as another form.
// Pure: the tests give it the facts (tests/run_itr_formpick.mjs).
import { ROOT } from "./forms.js";
import { ITR1, ITR4, AY, itr4Houses, itr1Houses, resStatus, RES_PATH } from "./law.js";
export { resStatus };

export const ALL_FORMS = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"];
// the forms whose official JSON FinCom makes (forms.js maps them, the schemas are in itr-schema/)
export const JSON_FORMS = Object.keys(ROOT);
const KIND = { P: "an individual", H: "a Hindu undivided family (HUF)", C: "a company", F: "a firm or LLP", A: "an association of persons (AOP)", B: "a body of individuals (BOI)",
  J: "an artificial juridical person", L: "a local authority", G: "a government body", T: "a trust" };
const SHORT = { P: "an individual", H: "a HUF", C: "a company", F: "a firm", A: "an AOP", B: "a BOI", J: "an artificial juridical person", L: "a local authority", G: "a government body", T: "a trust" };
const LIMIT = ITR1.maxIncome; // ITR-1 and ITR-4: total income up to Rs 50 lakh
// no PAN and no kind of taxpayer in Client setup: no form is picked and no JSON made (the review of 24-Nov-2026)
export const NO_KIND = "FinCom needs the PAN or the kind of taxpayer to pick the form. Add the PAN, or choose the kind of taxpayer, in Client setup; until then no JSON is made.";
const orList = (a, w) => (a.length > 1 ? a.slice(0, -1).join(", ") + " " + (w || "or") + " " + a[a.length - 1] : a[0] || "");
// rule 12's facts for ITR-1 and ITR-4 (law.js ITR1, ITR4), asked on the form box: what rules the form out, and what is
// not known yet (never taken as No). The director question is for an individual only (rule 12: "a person who is a
// director in a company"; a HUF cannot be one, and its karta's directorship is his own, not the HUF's); the unlisted-share and the agricultural income ones for a firm (not an LLP) too (rule 12(1)(b)
// proviso; the portal's ITR-4 FAQ); the residential status for an individual or HUF (RES only; not set: not known); a
// firm whether it is a partnership firm or an LLP (the review of 24-Nov-2026 (3)).
// [fact, said of the person, the question]
function rule12(f, agriMax, code) {
  const agri = f.agriIncome != null && f.agriIncome !== "" ? +f.agriIncome > agriMax : f.agriOver;
  const unl = f.unlistedSold === true ? true : f.unlisted;
  const facts = [];
  if (code === "F" && f.llp !== true && f.llp !== false) facts.push([undefined, "is an LLP", "whether it is a partnership firm or an LLP"]);
  if (code === "P") facts.push([f.director, "is a director in a company", "whether the person is a director in a company"]);
  facts.push([unl, "held unlisted shares", "whether unlisted shares were held in the year"], [agri, "has agricultural income above Rs 5,000", "whether agricultural income is above Rs 5,000"]);
  if (code === "P" || code === "H") {
    const r = resStatus(f.resident);
    facts.push([r ? r !== "RES" : undefined, r === "NOR" ? "is not ordinarily resident" : r === "NRI" ? "is a non-resident" : "is a non-resident or not ordinarily resident", "the residential status"]);
  }
  return { no: facts.filter((x) => x[0] === true).map((x) => x[1]), unknown: facts.filter((x) => x[0] !== true && x[0] !== false), facts };
}
// the proviso's other bars for ITR-1 and ITR-4 that FinCom has the data for (no question asked): a firm said not to be
// resident, assets outside India (ITR-1 and ITR-4 have no Schedule FA; rows left in Schedule FA after a No bar it only
// while they are there), TDS under 194N (26AS / AIS), a loss of earlier years brought forward, and more houses than the
// form takes (law.js itr4Houses and itr1Houses, by the year's schema)
function otherBars(f, form, code) {
  const out = [];
  if (code !== "P" && code !== "H" && resStatus(f.resident) && resStatus(f.resident) !== "RES") out.push("is not a resident");
  if (f.foreign) out.push("has assets outside India");
  else if (f.faRows > 0) out.push("has rows in Schedule FA (assets outside India)");
  if (f.tds194N) out.push("had tax deducted under section 194N (cash withdrawn)");
  if (f.bfLoss) out.push("has a loss of earlier years brought forward");
  const maxH = form === "ITR-4" ? itr4Houses(f.ay || AY) : itr1Houses(f.ay || AY);
  if (f.houses > maxH) out.push("has more than " + (maxH === 2 ? "two house properties" : "one house property"));
  return out;
}
// who a rule 12 bar is said of: "ITR-4 is not for someone who ...", "... a HUF that ...", "... a firm that ..."
const BARRED_WHO = { P: "someone who", H: "a HUF that", F: "a firm that" };
function notFor(form, code, items) {
  return form + " is not for " + (BARRED_WHO[code] || SHORT[code] || "this client") + " " + orList(items);
}
// the forms rule 12 rules out on what is known ({form: [what rules it out]}), and the answers each still needs
// ({form: [questions]}: no JSON for it until they are given)
function barredForms(f, code) {
  const b = {}, q = {};
  const one = (form, max) => { const r = rule12(f, max, code), n = r.no.concat(otherBars(f, form, code)); if (n.length) b[form] = n; if (r.unknown.length) q[form] = r.unknown.map((x) => x[2]); };
  if (code === "P") one("ITR-1", ITR1.agriMax);
  if (code === "P" || code === "H" || (code === "F" && f.llp !== true)) one("ITR-4", ITR4.agriMax);
  return { barred: b, unknown: q };
}
// "ITR-4 is not for someone who is a director in a company, held unlisted shares or has agricultural income above
// Rs 5,000. Answer the questions below to see if it fits." (the owner's words, 24-Nov-2026: never as if ruled out)
function askWhy(form, code, f, agriMax) {
  const u = rule12(f, agriMax, code).unknown.map((x) => x[1]);
  return notFor(form, code, u) + ". Answer the questions below to see if it fits.";
}

// the kind of person: the PAN's fourth letter settles it (the GSTIN carries the PAN); Client setup's choice only when
// there is no PAN. A Client setup kind that differs from the PAN is kept (set) to say so
export function entityFrom(set, pan, gstin) {
  const s = String(set || "").toUpperCase(), p = String(pan || String(gstin || "").slice(2, 12)).toUpperCase().trim();
  const fromPan = /^[A-Z]{5}\d{4}[A-Z]$/.test(p) && KIND[p[3]] ? p[3] : "";
  if (fromPan) return KIND[s] && s !== fromPan ? { code: fromPan, by: "pan", pan: p, set: s } : { code: fromPan, by: "pan", pan: p };
  if (KIND[s]) return { code: s, by: "set" };
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
// unanswered), business (the books or presumptive figures), presumptive, audit, resident (false: not a resident),
// salary, houses (how many), capitalGains (other than 112A up to Rs 1.25 lakh), foreign (assets outside India said),
// faRows (rows in Schedule FA), tds194N (TDS under 194N in 26AS / AIS), bfLoss (a loss of earlier years brought
// forward), ti (total income, when worked out); rule 12's answers: director, unlisted (held unlisted equity shares),
// unlistedSold (one among the gains), agriIncome or agriOver (above Rs 5,000): true, false or not known. ITR-1 asks the
// three of an individual; ITR-4 the three of an individual or HUF, the unlisted shares and agricultural income of a firm}
// -> {form, why, code, by, allowed, barred, unknown} (barred: the forms rule 12 rules out on what is known, with why;
// not in allowed. unknown: the answers a form still needs: no JSON for it until given)
export function recommendForm(f) {
  f = f || {};
  const e = entityFrom(f.entity, f.pan, f.gstin), code = e.code, bf = barredForms(f, code), barred = bf.barred, allowed = allowedForms(code, f.llp).filter((x) => !barred[x]);
  const who = e.by === "set" ? "Client setup says this is " + KIND[code] + "." : e.by === "pan" ? "The PAN's fourth letter is " + code + ": " + KIND[code] + "." + (e.set ? " Client setup says " + KIND[e.set] + "; FinCom follows the PAN (correct the kind in Client setup if the PAN is right)." : "") : "";
  // faLeft: Schedule FA has rows though assets outside India is not answered Yes (the page offers to remove them)
  const out = (form, why) => ({ form, why: (who ? who + " " : "") + why, code, by: e.by, allowed, barred, unknown: bf.unknown, faLeft: !f.foreign && f.faRows > 0 });
  const within = !(f.ti > LIMIT);
  // presumptive income within the limits ITR-4 has besides rule 12's (a tax audit, the total income, capital gains)
  const presOk = f.presumptive && !f.audit && within && !f.capitalGains;
  switch (code) {
    case "P": case "H":
      if (f.business) {
        if (presOk) {
          // rule 12 (law.js ITR4): never ITR-4 on a guess; ITR-3 fits either way
          const no = barred["ITR-4"];
          if (no) return out("ITR-3", "Business income is declared on a presumptive basis, but " + notFor("ITR-4", code, no) + ", so ITR-3 for the income from business or profession.");
          if (!bf.unknown["ITR-4"]) return out("ITR-4", "Business income is declared on a presumptive basis (44AD, 44ADA, 44AE) and the total income is within Rs 50 lakh; a resident, " + (code === "H" ? "" : "not a director in a company, ") + "no unlisted shares, agricultural income Rs 5,000 or less: ITR-4.");
          return out("ITR-3", "There is income from business or profession, so ITR-3. " + askWhy("ITR-4", code, f, ITR4.agriMax));
        }
        return out("ITR-3", "There is income from business or profession (the books), so ITR-3." + (f.presumptive ? " ITR-4 does not fit: " + (f.audit ? "a tax audit applies." : !within ? "the total income is above Rs 50 lakh." : "there are capital gains.") : ""));
      }
      if (code === "P" && within && !f.capitalGains) {
        const no = barred["ITR-1"];
        if (no) return out("ITR-2", "No business income, but " + notFor("ITR-1", "P", no) + ": ITR-2.");
        if (!bf.unknown["ITR-1"]) return out("ITR-1", "No business income: salary, up to " + (itr1Houses(f.ay || AY) === 2 ? "two houses" : "one house") + " and other sources, total income within Rs 50 lakh; a resident, not a director in a company, no unlisted shares, agricultural income Rs 5,000 or less: ITR-1.");
        return out("ITR-2", "No business income, so ITR-2. " + askWhy("ITR-1", code, f, ITR1.agriMax));
      }
      return out("ITR-2", "No business income" + (code === "H" ? " (ITR-1 is for individuals only)" : "") + ": " + (code === "H" ? "ITR-2." : f.capitalGains ? "there are capital gains, so ITR-2." : "the total income is above Rs 50 lakh, so ITR-2."));
    case "F":
      if (f.llp === true) return out("ITR-5", "An LLP files ITR-5.");
      if (f.business && presOk) {
        // rule 12 (law.js ITR4): a firm that held unlisted shares or has agricultural income above Rs 5,000 is not on
        // ITR-4; not known, ITR-5
        const no = barred["ITR-4"];
        if (no) return out("ITR-5", "A partnership firm with presumptive income, but " + notFor("ITR-4", "F", no) + ": ITR-5.");
        if (!bf.unknown["ITR-4"]) return out("ITR-4", "A partnership firm with presumptive income (44AD, 44ADA, 44AE), total income within Rs 50 lakh, no unlisted shares and agricultural income Rs 5,000 or less: ITR-4.");
        return out("ITR-5", "A firm files ITR-5. " + askWhy("ITR-4", code, f, ITR4.agriMax));
      }
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

// what the page says about the form in use: {fits, json, text, tone} (tone "bad": the form does not fit; "info": a
// note, as the page's other notes)
// (ITR-5's map is a firm's or an LLP's: an AOP, BOI, trust or other person's ITR-5 is not made yet, docs/ITR-MODULE.md)
export function formStatus(form, rec) {
  // no PAN and no kind (code ""): no form counts as fitting
  const fits = !!rec.code && rec.allowed.includes(form), notFirm = form === "ITR-5" && "ABJLGT".includes(rec.code || "-");
  // rule 12's answers a form still needs (ITR-1, ITR-4): no JSON until every one is given (the review of 24-Nov-2026)
  const ask = fits && rec.unknown && rec.unknown[form];
  const json = JSON_FORMS.includes(form) && fits && !notFirm && !ask;
  const say = [];
  const bar = !fits && rec.code && rec.barred && rec.barred[form];
  if (!rec.code) say.push(NO_KIND);
  else if (bar) say.push(notFor(form, rec.code, bar) + ". Use " + rec.allowed.join(" or ") + " (recommended: " + rec.form + "). FinCom makes no JSON for a form that does not fit.");
  else if (!fits) say.push(form + " is not for " + SHORT[rec.code] + ". Use " + rec.allowed.join(" or ") + " (recommended: " + rec.form + "). FinCom makes no JSON for a form that does not fit.");
  else {
    if (ask) say.push(JSON_FORMS.includes(form) ? "Before FinCom makes the " + form + " JSON, answer the questions below: " + orList(ask, "and") + "." : "Answer the questions below to see if " + form + " fits: " + orList(ask, "and") + ".");
    if (!JSON_FORMS.includes(form)) say.push("FinCom cannot make the JSON for " + form + " yet (it makes " + JSON_FORMS.join(", ") + "). The computation and the checks are shown; prepare this return in Winman.");
    else if (notFirm) say.push("FinCom's ITR-5 JSON is made for firms and LLPs only; for " + SHORT[rec.code] + " it cannot make it yet. The computation and the checks are shown; prepare this return in Winman.");
  }
  // no PAN and no kind: a note in the info tone, not red (the review of 24-Nov-2026 (3))
  return { fits, json, text: say.join(" "), tone: fits || !rec.code ? "info" : "bad" };
}

// what the recommendation needs to know, from the client, the return's state (b.itr "<ay>|state"), the books and the
// files brought in (the page asks it before the computation; tests/run_itr_formpick.mjs gives it made-up state)
export function factsOf(client, st, books, im) {
  client = client || {}; st = st || {};
  const p = st.presumptive || {}, figs = !!((p.ad && (+p.ad.digital || +p.ad.other)) || (p.ada && +p.ada.receipts) || (p.ae && (p.ae.vehicles || []).length));
  const presumptive = st.presumptiveOpt === true || (st.presumptiveOpt == null && figs);
  // rule 12's other bars from what FinCom holds: Schedule FA's rows, TDS under 194N (26AS, AIS), losses of earlier years
  const fa = st.fa ? Object.values(st.fa).filter(Array.isArray).reduce((a, v) => a + v.filter((r) => r && Object.keys(r).length).length, 0) : 0;
  const is194N = (r) => r && /^194N/.test(String(r.sec || "").toUpperCase()) && +r.tax > 0;
  const as26 = im && im.as26 && im.as26.data, ais = im && im.ais && im.ais.data;
  const tds194N = !!((as26 && (as26.tds || []).some(is194N)) || (ais && (ais.rows || []).some(is194N)));
  // a loss marked "No: the loss is lost" (its return was late, section 80) is not brought forward; section 80 is not for
  // a house property loss (71B) or unabsorbed depreciation (32(2))
  const L = st.losses || {}, live = (k, x) => x && +x.amt > 0 && !(x.inTime === false && k !== "hp" && k !== "ud");
  const bfLoss = +L.unabsorbedDep > 0 || ["business", "hp", "stcl", "ltcl", "ud"].some((k) => (L[k] || []).some((x) => live(k, x)));
  // the residential status: the return's own (state.resident), else the ITR-3 answer given before; not set: not known
  const resident = resStatus(st.resident) || resStatus(((st.answers || {})["ITR-3"] || {})[RES_PATH]);
  return { entity: client.entitySet || client.entity, pan: client.pan, gstin: client.gstin, llp: st.llp === true || st.llp === false ? st.llp : client.llp, exempt: st.exempt11, audit: !!st.audit, resident,
    business: !!(books && books.ok) || presumptive, presumptive, salary: !!((st.salaries || []).length || (st.salary && +st.salary.gross)), houses: (st.houses || []).length,
    capitalGains: !!((st.cgRows || []).length || st.cg), foreign: (st.profile || {}).foreignAssets === "YES", faRows: fa, tds194N, bfLoss,
    // rule 12 for ITR-1 and ITR-4 (law.js ITR1, ITR4): asked on the form box, never taken as No when not answered
    director: st.director, unlisted: st.unlisted, unlistedSold: (st.cgRows || []).some((r) => r && r.kind === "unlisted"), agriOver: st.agriOver };
}
