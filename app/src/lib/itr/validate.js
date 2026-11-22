// A JSON Schema (draft-04) validator for the CBDT ITR schemas, in the page. It covers the keywords those schemas use
// (counted on the AY 2026-27 ITR-3/4/5/6 schemas): type, properties, required, additionalProperties, allOf, $ref (local),
// enum, pattern, minLength, maxLength, minimum, maximum, exclusiveMinimum / exclusiveMaximum (draft-04 booleans),
// multipleOf, items, minItems, maxItems; default and description are ignored. Any other keyword met is reported as
// not understood, so a new schema never passes by being misread. tests/run_itr_schema.mjs checks it against ajv (an
// independent validator) on every JSON FinCom makes and on planted faults.
const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "allOf", "$ref", "enum", "pattern", "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "items", "minItems", "maxItems", "default", "description", "$schema", "id", "title", "definitions"]);
const typeOk = (t, v) => t === "integer" ? typeof v === "number" && Number.isInteger(v) : t === "number" ? typeof v === "number" && isFinite(v) : t === "string" ? typeof v === "string"
  : t === "object" ? v && typeof v === "object" && !Array.isArray(v) : t === "array" ? Array.isArray(v) : t === "boolean" ? typeof v === "boolean" : t === "null" ? v === null : false;
const len = (s) => Array.from(s).length;     // code points, as JSON Schema counts them

export function validator(schema) {
  const res = new Map();
  const ref = (r) => {
    if (!/^#\//.test(r)) throw new Error("only local $ref: " + r);
    let s = schema; for (const p of r.slice(2).split("/")) s = s[p.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (!s) throw new Error("$ref not found: " + r);
    return s;
  };
  const rx = (p) => { if (!res.has(p)) res.set(p, new RegExp(p, "u")); return res.get(p); };
  function v(s, x, path, errs) {
    if (errs.length > 200) return;
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) errs.push({ path, msg: "schema keyword not understood: " + k });
    if (s.$ref) { v(ref(s.$ref), x, path, errs); return; }
    if (s.allOf) s.allOf.forEach((z) => v(z, x, path, errs));
    if (s.type) { const ts = Array.isArray(s.type) ? s.type : [s.type]; if (!ts.some((t) => typeOk(t, x))) { errs.push({ path, msg: "should be " + ts.join(" or ") }); return; } }
    if (s.enum && !s.enum.some((e) => e === x)) errs.push({ path, msg: "should be one of " + s.enum.slice(0, 12).join(", ") });
    if (typeof x === "string") {
      if (s.pattern != null && !rx(s.pattern).test(x)) errs.push({ path, msg: "does not match " + s.pattern });
      if (s.minLength != null && len(x) < s.minLength) errs.push({ path, msg: "shorter than " + s.minLength });
      if (s.maxLength != null && len(x) > s.maxLength) errs.push({ path, msg: "longer than " + s.maxLength });
    }
    if (typeof x === "number") {
      if (s.minimum != null && (s.exclusiveMinimum === true ? !(x > s.minimum) : !(x >= s.minimum))) errs.push({ path, msg: "below the minimum " + s.minimum });
      if (s.maximum != null && (s.exclusiveMaximum === true ? !(x < s.maximum) : !(x <= s.maximum))) errs.push({ path, msg: "above the maximum " + s.maximum });
      if (s.multipleOf != null) { const q = x / s.multipleOf; if (Math.abs(q - Math.round(q)) > 1e-9) errs.push({ path, msg: "not a multiple of " + s.multipleOf }); }
    }
    if (x && typeof x === "object" && !Array.isArray(x)) {
      (s.required || []).forEach((k) => { if (!(k in x)) errs.push({ path: path + "/" + k, msg: "is required" }); });
      const props = s.properties || {};
      Object.keys(x).forEach((k) => {
        if (props[k]) v(props[k], x[k], path + "/" + k, errs);
        else if (s.additionalProperties === false) errs.push({ path: path + "/" + k, msg: "is not allowed here" });
        else if (s.additionalProperties && typeof s.additionalProperties === "object") v(s.additionalProperties, x[k], path + "/" + k, errs);
      });
    }
    if (Array.isArray(x)) {
      if (s.minItems != null && x.length < s.minItems) errs.push({ path, msg: "fewer than " + s.minItems + " items" });
      if (s.maxItems != null && x.length > s.maxItems) errs.push({ path, msg: "more than " + s.maxItems + " items" });
      if (s.items && !Array.isArray(s.items)) x.forEach((it, i) => v(s.items, it, path + "/" + i, errs));
    }
  }
  return (doc) => { const errs = []; v(schema, doc, "", errs); return { ok: errs.length === 0, errors: errs }; };
}
