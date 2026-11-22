// From the figures FinCom maps (a sparse object, in the official schema's own names) to a complete return JSON:
//   - an amount (integer / number) the schema requires and FinCom does not map is 0 (the CBDT utilities do the same for
//     a line with nothing in it); every mapped amount carries its source in the map (forms.js);
//   - anything else the schema requires (a Yes/No, a choice, a name, a date) is NEVER made up: unless the map gives it
//     or the owner has answered it (answers: {path: value}), it is returned in `asks` with the schema's own description
//     and choices, and the JSON is not offered until each is answered;
//   - a mapped key the schema does not have is a mapping error (`errors`), so a renamed field is caught at once.
// The schema is the official CBDT JSON Schema (draft-04); validate.js then validates the result.
export function filler(schema) {
  const D = schema.definitions || {};
  const deref = (s) => { let n = 0; while (s && s.$ref && n++ < 50) s = D[s.$ref.split("/").pop()]; return s || {}; };
  // a schema with its allOf parts laid together (the CBDT schemas put a string's rules in allOf)
  function flat(s) {
    s = deref(s);
    if (!s.allOf) return s;
    const o = Object.assign({}, s); delete o.allOf;
    s.allOf.forEach((x) => { const f = flat(x); Object.keys(f).forEach((k) => { if (k === "properties") o.properties = Object.assign({}, o.properties, f.properties); else if (k === "required") o.required = (o.required || []).concat(f.required); else if (o[k] == null) o[k] = f[k]; }); });
    return o;
  }
  const kindOf = (s) => s.type || (s.properties ? "object" : s.items ? "array" : s.enum ? "string" : "string");
  function zeroOk(s) { if (s.minimum == null) return true; return s.exclusiveMinimum === true ? 0 > s.minimum : 0 >= s.minimum; }
  return function fill(rootKey, sparse, answers) {
    const asks = [], errors = [], ans = answers || {};
    const root = flat(flat(D.ITR || schema).properties[rootKey] || {});
    function walk(s, v, path) {
      s = flat(s);
      const t = kindOf(s);
      // an answer from the page comes as text: given the schema's own type (an integer choice such as ReturnFileSec)
      const typed = (x) => ((t === "integer" || t === "number") && typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x.trim()) ? +x : x);
      if (v === undefined || v === null) {
        if (ans[path] !== undefined) return typed(ans[path]);
        if (t === "object") return walk(s, {}, path);
        if (t === "integer" || t === "number") { if (zeroOk(s)) return 0; asks.push(ask(s, path)); return null; }
        if (t === "array") { if (s.minItems > 0) { asks.push(ask(s, path)); return null; } return []; }
        asks.push(ask(s, path)); return null;
      }
      if (t === "object") {
        if (typeof v !== "object" || Array.isArray(v)) { errors.push(path + ": an object was expected"); return v; }
        const props = s.properties || {}, req = s.required || [], out = {};
        Object.keys(v).forEach((k) => { if (!props[k]) errors.push(path + "/" + k + ": not in the schema"); });
        Object.keys(props).forEach((k) => {
          if (v[k] !== undefined && v[k] !== null) out[k] = walk(props[k], v[k], path + "/" + k);
          else if (req.includes(k)) out[k] = walk(props[k], undefined, path + "/" + k);
          else if (ans[path + "/" + k] !== undefined) out[k] = walk(props[k], undefined, path + "/" + k);
        });
        return out;
      }
      if (t === "array") { if (!Array.isArray(v)) { errors.push(path + ": a list was expected"); return v; } return v.map((x, i) => walk(s.items || {}, x, path + "/" + i)); }
      return v;
    }
    const doc = { ITR: { [rootKey]: walk(root, sparse, "/" + rootKey) } };
    return { doc, asks, errors };
  };
  function ask(s, path) {
    const f = s, choices = f.enum ? f.enum.slice() : f.pattern && /^[A-Z](\|[A-Z])+$/.test(f.pattern) ? f.pattern.split("|") : null;
    const kind = choices && choices.every((c) => c === "Y" || c === "N") ? "yn" : choices ? "choice" : /date/i.test(path) || (f.pattern && /\\d\{3\}-/.test(f.pattern)) ? "date" : f.type === "integer" ? "number" : "text";
    return { path, kind, choices, label: (f.description || path.split("/").pop()).slice(0, 300), max: f.maxLength || null, pattern: f.pattern || "" };
  }
}

// a sparse object from [path, value] pairs ("A/B/C" -> {A: {B: {C: v}}}); a value of undefined is left out
export function put(o, path, v) {
  if (v === undefined) return o;
  const ks = path.split("/").filter(Boolean); let x = o;
  ks.slice(0, -1).forEach((k) => { x[k] = x[k] && typeof x[k] === "object" ? x[k] : {}; x = x[k]; });
  x[ks[ks.length - 1]] = v; return o;
}
