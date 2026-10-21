// What every report reads (ROUND 100): the figures (facts.js), the answers (questionnaire.js), what applies
// (applicability.js), and small helpers to write amounts in the page's unit and to mark an answer not given yet.
import { facts, longDate, ordinal } from "./facts.js";
import { resolve, Q, isMissing } from "./questionnaire.js";
import { applicability } from "./applicability.js";
import { money } from "./doc.js";

const N = (v) => +v || 0;
const UNIT_WORD = { 1: "", 1000: " thousand", 100000: " lakh", 10000000: " crore" };

//   makeContext({d, dR, vouchers, store, fy})   d / dR: FinSt.build in the page's unit / in rupees; store: b.fs.reports
export function makeContext(o) {
  const d = o.d, dR = o.dR || o.d, fy = String(o.fy || d.fy);
  const f = facts({ d, dR, vouchers: o.vouchers, fy });
  const R = resolve(o.store || {}, fy, f, d.inputs);
  const ap = applicability(f, R.a);
  const unit = N(d.inputs.unit) || 1, dec = d.inputs.dec === 0 ? 0 : 2;
  const inp = d.inputs, y = Number(fy.slice(0, 4));
  const c = {
    d, dR, f, R, a: R.a, ap, inp, fy, unit, dec, y,
    name: inp.name || "the Company",
    yearEnd: longDate((y + 1) + "0331"), yearEndPy: longDate(y + "0331"),
    fyLabel: "FY " + y + "-" + String(y + 1).slice(2), fyLabelPy: "FY " + (y - 1) + "-" + String(y).slice(2),
    // a figure from the statements, already in the unit (the financial summary): as the statements show it
    fig: (v) => money(v, dec),
    // a rupee amount in the page's unit, in prose: "₹12,200.00 thousand"
    amt: (rupees) => "₹" + money(N(rupees) / unit, dec).replace(/^\((.*)\)$/, "($1)") + (UNIT_WORD[unit] || ""),
    // a rupee amount in the unit, for a table (no ₹)
    tamt: (rupees) => money(N(rupees) / unit, dec),
    // an answer, or a marked gap when it is required and not given
    A: (k, fmt) => { const q = Q[k], v = R.a[k]; if (!q) return ""; if (isMissing(q, v)) return { miss: shortLabel(q), k }; return fmt ? fmt(v) : String(v); },
    has: (k) => { const q = Q[k]; return !!q && !isMissing(q, R.a[k]); },
    yes: (k) => R.a[k] === "yes" || R.a[k] === true,
    date: (k) => c.A(k, (v) => longDate(v)),
    ord: ordinal,
  };
  return c;
}
// a question's label, short enough to stand in the text
function shortLabel(q) { return q.l.replace(/\s*\(.*?\)\s*/g, " ").replace(/\?$/, "").replace(/^(POSH|MD&A|Rule 11\(e\)|3\(.*?\)): /, "$1: ").trim(); }
