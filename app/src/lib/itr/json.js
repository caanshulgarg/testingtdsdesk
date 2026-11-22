// One return JSON: the map (forms.js), completed (fill.js), validated against the official schema (validate.js), with
// FinCom's version and the checks report beside it. The schema is passed in (the page fetches it from this site's
// itr-schema/ folder, put there at publish time from incometax.gov.in: docs/ITR-MODULE.md, "The official schemas").
import { filler } from "./fill.js";
import { validator } from "./validate.js";
import { mapReturn, ROOT, sectionCodes } from "./forms.js";

const cache = new WeakMap();
function tools(schema) { let t = cache.get(schema); if (!t) { t = { fill: filler(schema), check: validator(schema), codes: sectionCodes(schema) }; cache.set(schema, t); } return t; }

export const VERSION = "fincom-itr-2026.1";
// X: {form, schema, model, comp, sched, profile, answers, today (yyyy-mm-dd), gstTurnover, fin44}
export function makeJson(X) {
  const T = tools(X.schema), root = ROOT[X.form];
  const sparse = mapReturn(Object.assign({}, X, { codes: T.codes }));
  const { doc, asks, errors } = T.fill(root, sparse, X.answers || {});
  const res = asks.length || errors.length ? { ok: false, errors: [] } : T.check(doc);
  if (!doc.ITR || !doc.ITR[root]) res.ok = false;
  return { doc, asks, mapErrors: errors, schema: res, root };
}
// the file the owner downloads: the return JSON exactly as the schema has it (Winman imports the ITR JSON as is). The
// version and the checks go in a second file beside it (a key the schema does not have would make the JSON invalid)
export function report(X, checks, made) {
  return { fincom: VERSION, form: X.form, ay: "2026-27", pan: (X.profile || {}).pan || "", made: X.now || "", schemaFile: X.schemaFile || "", schemaSha256: X.schemaSha || "",
    computation: { ti: X.comp.ti, liability: X.comp.liability, payable: X.comp.payable, refund: X.comp.refund }, secondCheck: "agreed to the rupee",
    checks: checks.map((c) => ({ id: c.id, group: c.group, title: c.title, status: c.status, diff: c.diff || 0, a: c.a || null, b: c.b || null, accepted: c.accepted || null })), jsonSha256: made || "" };
}
