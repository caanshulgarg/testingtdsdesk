// GSTR-1 corrections made in FinCom (next-gstr1-excel; the owner, 24-Oct-2026: "prepare this type of download and upload
// return in GSTR-1 .. user can add or delete or modify the details"). The GSTR-1 Excel (screens/gst/r1Excel.js) is the
// return in the portal's own tables; brought back, it becomes the source of that month's return:
//   - a row from the books keeps its hidden key; any field changed there is a correction of that line;
//   - a row taken out of the sheet is EXCLUDED from GSTR-1 (never deleted from the books);
//   - a row added (no key) is a new manual entry of the return.
// THE STORE: S.books.r1Fix["<reg>|<yyyymm>"] (one of BOOKS_KEYS, so each month is its own synced books item, never written
// to Tally) = {cur: {mods: {lineKey: {field: value}}, dels: {lineKey: 1}, adds: [{id, t, f}], skip: {amendment id: the act
// it had}, at, by, file, n}, vers: [{cur, at, by}] (the state before each upload, kept, newest last), log: [...]}.
// Undo puts back the state before the last upload, all of it. No other GSTR-1 corrections store existed: what is reused is
// GSTAmend's own choice per amendment (S.books.amendFix, "skip" = left out): an amendment row (9A, 9C, 10) or a document
// missed in an earlier month (reported now) taken out of the Excel is that choice, so the amendments screen, the JSON and
// 3B's 3.1 (GSTR.amendDiff) all leave it out.
// WHERE IT IS READ: GSTR.toJson (src/js/12) is wrapped: the month's JSON is laid out as lines (one per document and rate, as
// the portal's offline tool), the corrections laid over them, and the JSON put together again. The GSTR-1 screen (portal.js
// reads the JSON), the JSON file for the portal, IFF and a QRMP quarter's GSTR-1 (the months together) read it. GSTR.threeBm
// is wrapped too: what the corrections change in the JSON moves 3.1(a) (b) (c) (e) and 3.2 (t.r1Fix says by how much; the
// 3.1 window lists it), and the payment again. A month with no corrections: nothing here runs, everything as before.
// window.R1Fix: lines/tables for the Excel, preview (what an Excel brought back changes, and what is wrong in it), apply,
// undo. tests/run_gstr1_excel.js runs this file in node; tests/run_gstr1_excel.py the round trip in the app.
const N = (v) => (typeof num === "function" ? num(v) : +v || 0);
const R = (v) => Math.round((N(v) + Number.EPSILON) * 100) / 100;
const NK = (n) => String(n == null ? "" : n).toUpperCase().replace(/\s+/g, "");
const who = () => { try { return (Cloud.st && Cloud.st.email) || ((Cloud.sess && Cloud.sess()) || {}).email || ""; } catch (e) { return ""; } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const TAXF = ["txval", "iamt", "camt", "samt", "csamt"];

// ---------- the portal's tables as lines
// documents with items: g the group fields (the JSON's outer list), inner the list of documents in a group (none: the
// section is the list of documents), doc the document's fields, id the field that names a document (none: the doc fields)
export const IT = {
  b2b: { g: ["ctin"], inner: "inv", doc: ["inum", "idt", "val", "pos", "rchrg", "inv_typ", "etin", "diff_percent"], id: "inum" },
  b2cl: { g: ["pos"], inner: "inv", doc: ["inum", "idt", "val", "etin", "diff_percent"], id: "inum" },
  exp: { g: ["exp_typ"], inner: "inv", doc: ["inum", "idt", "val", "sbpcode", "sbnum", "sbdt"], id: "inum" },
  cdnr: { g: ["ctin"], inner: "nt", doc: ["ntty", "nt_num", "nt_dt", "val", "pos", "rchrg", "inv_typ", "diff_percent"], id: "nt_num", note: true },
  cdnur: { g: [], inner: null, doc: ["typ", "ntty", "nt_num", "nt_dt", "val", "pos", "diff_percent"], id: "nt_num", note: true },
  b2ba: { g: ["ctin"], inner: "inv", doc: ["oinum", "oidt", "inum", "idt", "val", "pos", "rchrg", "inv_typ", "diff_percent"], id: "oinum", amend: "B2B" },
  b2cla: { g: ["pos"], inner: "inv", doc: ["oinum", "oidt", "inum", "idt", "val", "diff_percent"], id: "oinum", amend: "B2CL" },
  expa: { g: ["exp_typ"], inner: "inv", doc: ["oinum", "oidt", "inum", "idt", "val", "sbpcode", "sbnum", "sbdt"], id: "oinum", amend: "EXP" },
  cdnra: { g: ["ctin"], inner: "nt", doc: ["ont_num", "ont_dt", "ntty", "nt_num", "nt_dt", "val", "pos", "rchrg", "inv_typ"], id: "ont_num", note: true, amend: "CDNR" },
  cdnura: { g: [], inner: null, doc: ["typ", "ont_num", "ont_dt", "ntty", "nt_num", "nt_dt", "val", "pos"], id: "ont_num", note: true, amend: "CDNUR" },
  b2csa: { g: [], inner: null, doc: ["omon", "sply_ty", "pos", "typ", "diff_percent"], id: null, direct: true, amend: "B2CS" },
  at: { g: [], inner: null, doc: ["pos", "sply_ty", "diff_percent"], id: null, direct: true, amt: "ad_amt" },
  txpd: { g: [], inner: null, doc: ["pos", "sply_ty", "diff_percent"], id: null, direct: true, amt: "ad_amt" },
};
// summary tables, a line each: where they sit in the JSON and what makes two lines one
export const FL = {
  b2cs: { get: (j) => j.b2cs, set: (j, v) => { j.b2cs = v; }, key: (l) => [l.pos, N(l.rt), l.sply_ty, l.typ || "OE", l.etin || ""], sum: TAXF },
  nil: { get: (j) => (j.nil || {}).inv, set: (j, v) => { j.nil = { inv: v }; }, key: (l) => [l.sply_ty], sum: ["nil_amt", "expt_amt", "ngsup_amt"] },
  hsnb2b: { get: (j) => (j.hsn || {}).hsn_b2b, set: (j, v) => { j.hsn = Object.assign({}, j.hsn || {}, { hsn_b2b: v }); }, key: (l) => [String(l.hsn_sc || ""), N(l.rt), l.uqc || ""], sum: ["qty"].concat(TAXF), hsn: true },
  hsnb2c: { get: (j) => (j.hsn || {}).hsn_b2c, set: (j, v) => { j.hsn = Object.assign({}, j.hsn || {}, { hsn_b2c: v }); }, key: (l) => [String(l.hsn_sc || ""), N(l.rt), l.uqc || ""], sum: ["qty"].concat(TAXF), hsn: true },
  hsn: { get: (j) => (j.hsn || {}).data, set: (j, v) => { j.hsn = Object.assign({}, j.hsn || {}, { data: v }); }, key: (l) => [String(l.hsn_sc || ""), N(l.rt), l.uqc || ""], sum: ["qty"].concat(TAXF), hsn: true },
  docs: { key: (l) => [N(l.doc_num), String(l.from || "")] },
  eco14a: { get: (j) => (j.supeco || {}).clttx, set: (j, v) => { j.supeco = Object.assign({}, j.supeco || {}, { clttx: v }); }, key: (l) => [l.etin], sum: ["suppval", "igst", "cgst", "sgst", "cess"] },
};
export const TABLES = ["b2b", "b2cl", "exp", "b2cs", "nil", "cdnr", "cdnur", "b2ba", "b2cla", "expa", "cdnra", "cdnura", "b2csa", "at", "txpd", "hsnb2b", "hsnb2c", "hsn", "docs", "eco14a"];
export const isAmend = (t) => !!(IT[t] && IT[t].amend);
const OPT = new Set(["etin", "diff_percent", "sbpcode", "sbnum", "sbdt"]);
const INTER_ALWAYS = new Set(["b2cl", "exp", "cdnur", "b2cla", "expa", "cdnura"]);
const SPLY = new Set(["b2cs", "at", "txpd", "b2csa"]);

// a line of a document table: {_t, _k, group fields, doc fields, rt, txval, iamt, camt, samt, csamt, _h ("i" IGST, "cs"
// CGST and SGST), _w (the item wrapped in itm_det)}
function flatten(j, t) {
  const out = [], seen = {};
  const key = (l) => { let k = t + "|" + l._k; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += "#" + seen[k]; return k; };
  if (IT[t]) {
    const c = IT[t], groups = c.inner ? j[t] || [] : [{ __docs: j[t] || [] }];
    groups.forEach((g) => (c.inner ? g[c.inner] || [] : g.__docs).forEach((x) => (x.itms || []).forEach((it) => {
      const d = it.itm_det || it, l = { _t: t };
      c.g.forEach((f) => { l[f] = g[f]; }); c.doc.forEach((f) => { if (x[f] != null) l[f] = x[f]; });
      l.rt = N(d.rt); l.txval = N(d[c.amt || "txval"]); l.iamt = N(d.iamt); l.camt = N(d.camt); l.samt = N(d.samt); l.csamt = N(d.csamt);
      l._h = d.iamt != null ? "i" : d.camt != null || d.samt != null ? "cs" : ""; l._w = !!it.itm_det;
      const docId = c.id ? NK(x[c.id]) : c.doc.map((f) => x[f] == null ? "" : x[f]).join("|");
      l._k = c.g.map((f) => NK(g[f])).concat([docId, N(d.rt)]).join("|");
      l._k = key(l); out.push(l);
    })));
  } else if (t === "docs") {
    ((j.doc_issue || {}).doc_det || []).forEach((d) => (d.docs || []).forEach((x) => {
      const l = { _t: t, doc_num: N(d.doc_num), from: String(x.from == null ? "" : x.from), to: String(x.to == null ? "" : x.to), totnum: N(x.totnum), cancel: N(x.cancel), net_issue: N(x.net_issue) };
      l._k = FL.docs.key(l).join("|"); l._k = key(l); out.push(l);
    }));
  } else if (FL[t]) {
    (FL[t].get(j) || []).forEach((x) => {
      const l = Object.assign({ _t: t }, x); delete l.num;
      if (FL[t].hsn || t === "b2cs") { l.rt = N(x.rt); TAXF.forEach((f) => { l[f] = N(x[f]); }); }
      l._k = FL[t].key(l).map((v) => NK(v)).join("|"); l._k = key(l); out.push(l);
    });
  }
  return out;
}
// whether a line's tax is IGST: as its item was (_h), else as its table and place of supply say
function interOf(l, t, reg) {
  if (INTER_ALWAYS.has(t)) return true;
  if (SPLY.has(t)) return l.sply_ty ? l.sply_ty === "INTER" : !!reg && String(l.pos || "") !== reg;
  if (/^(SEWP|SEWOP|CBW)$/.test(String(l.inv_typ || ""))) return true;
  return !!reg && !!l.pos && String(l.pos) !== reg;
}
const hOf = (l, t, reg) => (N(l.iamt) ? "i" : N(l.camt) || N(l.samt) ? "cs" : interOf(l, t, reg) ? "i" : "cs");
function item(l, c, i, t, reg) {
  const d = { rt: N(l.rt) }; d[c.amt || "txval"] = R(l.txval);
  const h = l._h || hOf(l, t, reg);
  if (h === "i") d.iamt = R(l.iamt); else { d.camt = R(l.camt); d.samt = R(l.samt); }
  d.csamt = R(l.csamt);
  return c.direct ? d : { num: i + 1, itm_det: d };
}
function build(j, t, lines, reg) {
  if (IT[t]) {
    const c = IT[t], groups = new Map();
    lines.forEach((l) => {
      const gk = c.g.map((f) => NK(l[f])).join("|"), g = groups.get(gk) || { head: l, docs: new Map() };
      groups.set(gk, g);
      const dk = c.id ? NK(l[c.id]) : c.doc.map((f) => (l[f] == null ? "" : l[f])).join("|");
      const d = g.docs.get(dk) || { head: l, items: [] }; g.docs.set(dk, d); d.items.push(l);
    });
    const docOf = (d) => {
      const x = {}; c.doc.forEach((f) => { const v = d.head[f]; if (v == null || (OPT.has(f) || (f === "pos" && !c.g.length && t !== "b2csa" && !SPLY.has(t))) && (v === "" || v === 0)) return; x[f] = v; });
      // items at one rate are one item (a quarter's months together, or two lines given the same rate)
      const byRt = new Map(); d.items.forEach((l) => { const k = N(l.rt), o = byRt.get(k); if (!o) byRt.set(k, Object.assign({}, l)); else TAXF.forEach((f) => { o[f] = R(N(o[f]) + N(l[f])); }); });
      x.itms = Array.from(byRt.values()).sort((a, b) => a.rt - b.rt).map((l, i) => item(l, c, i, t, reg));
      return x;
    };
    const list = Array.from(groups.values()).map((g) => {
      const docs = Array.from(g.docs.values()).map(docOf);
      if (!c.inner) return docs;
      const o = {}; c.g.forEach((f) => { o[f] = g.head[f]; }); o[c.inner] = docs; return [o];
    }).flat();
    if (list.length) j[t] = list; else delete j[t];
    return j;
  }
  if (t === "docs") {
    const by = new Map();
    lines.forEach((l) => { const k = N(l.doc_num); (by.get(k) || by.set(k, []).get(k)).push(l); });
    const det = Array.from(by.keys()).sort((a, b) => a - b).map((k) => ({ doc_num: k, docs: by.get(k).map((l, i) => ({ num: i + 1, from: String(l.from), to: String(l.to), totnum: N(l.totnum), cancel: N(l.cancel), net_issue: N(l.totnum) - N(l.cancel) })) }));
    if (det.length) j.doc_issue = { doc_det: det }; else delete j.doc_issue;
    return j;
  }
  const F = FL[t], m = new Map();
  lines.forEach((l) => {
    const k = F.key(l).map((v) => NK(v)).join("|"), o = m.get(k);
    if (!o) { const x = {}; Object.keys(l).forEach((f) => { if (f[0] !== "_" && f !== "name") x[f] = l[f]; }); m.set(k, x); return; }
    F.sum.forEach((f) => { o[f] = R(N(o[f]) + N(l[f])); });
  });
  let list = Array.from(m.values());
  if (t === "b2cs") list = list.map((x) => { const o = { sply_ty: x.sply_ty, pos: x.pos, typ: x.typ || "OE", rt: N(x.rt), txval: R(x.txval) }; if (x.etin) o.etin = x.etin; if (x.diff_percent) o.diff_percent = x.diff_percent;
    if (x.sply_ty === "INTER") o.iamt = R(x.iamt); else { o.camt = R(x.camt); o.samt = R(x.samt); } o.csamt = R(x.csamt); return o; });
  if (F.hsn) list = list.map((x, i) => ({ num: i + 1, hsn_sc: String(x.hsn_sc || ""), desc: String(x.desc || "").slice(0, 30), uqc: x.uqc || "", qty: R(x.qty), rt: N(x.rt), txval: R(x.txval), iamt: R(x.iamt), camt: R(x.camt), samt: R(x.samt), csamt: R(x.csamt) }));
  if (t === "eco14a") list = list.map((x) => ({ etin: x.etin, suppval: R(x.suppval), igst: R(x.igst), cgst: R(x.cgst), sgst: R(x.sgst), cess: R(x.cess), flag: x.flag || "N" }));
  if (t === "nil") list = list.map((x) => ({ sply_ty: x.sply_ty, expt_amt: R(x.expt_amt), nil_amt: R(x.nil_amt), ngsup_amt: R(x.ngsup_amt) }));
  if (list.length) F.set(j, list);
  else if (F.hsn) { if (j.hsn) { const k = t === "hsnb2b" ? "hsn_b2b" : t === "hsnb2c" ? "hsn_b2c" : "data"; delete j.hsn[k]; if (!Object.keys(j.hsn).length) delete j.hsn; } }
  else if (t === "nil") delete j.nil; else if (t === "eco14a") delete j.supeco; else delete j[t];
  return j;
}
export function linesOf(j) { const o = {}; TABLES.forEach((t) => { o[t] = flatten(j, t); }); return o; }

// ---------- the store
const K = (reg, ym) => (reg || "") + "|" + ym;
const ALL = () => ((S.books || {}).r1Fix) || {};
export function curOf(reg, ym) { const e = ALL()[K(reg, ym)]; return e && e.cur && !empty(e.cur) ? e.cur : null; }
function empty(c) { return !c || (!Object.keys(c.mods || {}).length && !Object.keys(c.dels || {}).length && !(c.adds || []).length); }
// a line after the corrections: its changed fields over it; tables whose type follows the place of supply worked out again
function modded(l, m, reg) {
  const o = Object.assign({}, l, m);
  ["rt", "val", "qty", "nil_amt", "expt_amt", "ngsup_amt", "totnum", "cancel", "suppval", "igst", "cgst", "sgst", "cess"].concat(TAXF).forEach((f) => { if (m[f] != null) o[f] = N(m[f]); });
  if (SPLY.has(l._t) && m.pos != null) o.sply_ty = reg && String(o.pos) !== reg ? "INTER" : "INTRA";
  if (["iamt", "camt", "samt", "pos", "inv_typ", "sply_ty"].some((f) => m[f] != null)) o._h = hOf(o, l._t, reg);
  return o;
}
function lineOfAdd(a, reg) {
  const l = Object.assign({ _t: a.t, _k: "add|" + a.id, _add: a.id }, a.f);
  ["rt", "val", "qty", "nil_amt", "expt_amt", "ngsup_amt", "totnum", "cancel", "suppval", "igst", "cgst", "sgst", "cess"].concat(TAXF).forEach((f) => { if (l[f] != null) l[f] = N(l[f]); });
  if (SPLY.has(a.t)) l.sply_ty = reg && String(l.pos || "") !== reg ? "INTER" : "INTRA";
  if (IT[a.t]) { l._h = hOf(l, a.t, reg); l._w = !IT[a.t].direct; }
  return l;
}
// a table's lines with the corrections laid over them, each keeping its key (a line of the books its own, an added one add|id)
function fixLines(j, t, fix, reg) {
  return flatten(j, t).filter((l) => !(fix.dels || {})[l._k]).map((l) => ((fix.mods || {})[l._k] ? modded(l, fix.mods[l._k], reg) : l))
    .concat(isAmend(t) ? [] : (fix.adds || []).filter((a) => a.t === t).map((a) => lineOfAdd(a, reg)));
}
const touched = (fix) => { const ts = new Set(); Object.keys(fix.mods || {}).concat(Object.keys(fix.dels || {})).forEach((k) => ts.add(k.split("|")[0])); (fix.adds || []).forEach((a) => ts.add(a.t)); return ts; };
// lay a month's corrections over its JSON (plain: the month's own tables only, no amendment tables)
export function overlay(j, fix, reg, plain) {
  if (!fix || empty(fix)) return j;
  touched(fix).forEach((t) => {
    if (!IT[t] && !FL[t]) return;
    if (plain && isAmend(t)) return;
    build(j, t, fixLines(j, t, fix, reg), reg);
  });
  return j;
}
// the receivers' names given in the Excel (a name is not in the JSON; the GSTR-1 screen shows it beside the GSTIN)
export function names(reg, ym) {
  const fix = curOf(reg, ym), o = {};
  if (!fix) return o;
  (fix.adds || []).forEach((a) => { if (a.f && a.f.ctin && a.f.name) o[String(a.f.ctin).toUpperCase()] = a.f.name; });
  Object.values(fix.mods || {}).forEach((m) => { if (m.ctin && m.name) o[String(m.ctin).toUpperCase()] = m.name; });
  return o;
}

// ---------- what a month's JSON gives GSTR-3B: 3.1(a) (b) (c) (e) and 3.2, from the tables as the books' rows go there
const z5 = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
function fig(j, tables) {
  const o = { a: z5(), b: z5(), c: z5(), e: z5(), unreg: {} };
  const put = (to, l, sg) => { to.taxable = R(to.taxable + sg * N(l.txval)); to.igst = R(to.igst + sg * N(l.iamt)); to.cgst = R(to.cgst + sg * N(l.camt)); to.sgst = R(to.sgst + sg * N(l.samt)); to.cess = R(to.cess + sg * N(l.csamt)); };
  const un = (l, sg) => { const p = String(l.pos || "97").padStart(2, "0"), x = o.unreg[p] = o.unreg[p] || { taxable: 0, igst: 0 }; x.taxable = R(x.taxable + sg * N(l.txval)); x.igst = R(x.igst + sg * N(l.iamt)); };
  tables.forEach((t) => flatten(j, t).forEach((l) => {
    const sg = IT[t] && IT[t].note ? (String(l.ntty || "C").toUpperCase() === "D" ? 1 : -1) : 1;
    if (t === "b2b" || t === "b2ba") put(/^SEW/.test(String(l.inv_typ || "")) ? o.b : o.a, l, 1);
    else if (t === "exp" || t === "expa") put(o.b, l, 1);
    else if (t === "b2cl" || t === "b2cla") { put(o.a, l, 1); if (t === "b2cl") un(l, 1); }
    else if (t === "b2cs" || t === "b2csa") { put(o.a, l, 1); if (t === "b2cs" && l.sply_ty === "INTER") un(l, 1); }
    else if (t === "cdnr" || t === "cdnra") put(o.a, l, sg);
    else if (t === "cdnur" || t === "cdnura") { put(o.a, l, sg); if (t === "cdnur" && l.typ === "B2CL") un(l, sg); }
    else if (t === "at") put(o.a, l, 1);
    else if (t === "txpd") put(o.a, l, -1);
    else if (t === "nil") { o.c.taxable = R(o.c.taxable + N(l.nil_amt) + N(l.expt_amt)); o.e.taxable = R(o.e.taxable + N(l.ngsup_amt)); }
  }));
  return o;
}
const OWN3B = ["b2b", "b2cl", "exp", "b2cs", "cdnr", "cdnur", "at", "txpd", "nil"], AMD3B = ["b2ba", "b2cla", "expa", "cdnra", "cdnura", "b2csa"];
function sub5(a, b) { const o = z5(); Object.keys(o).forEach((k) => { o[k] = R(N(a[k]) - N(b[k])); }); return o; }
// the change the month's corrections make to its 3B: {a, b, c, e, unreg: {pos: {taxable, igst}}}
export function delta3b(ym, reg) {
  const fix = curOf(reg, ym);
  if (!fix || !GSTR.toJson.orig) return null;
  const base = GSTR.toJson.orig.call(GSTR, ym, reg, { plain: true }), corr = overlay(clone(base), fix, reg, true);
  const f0 = fig(base, OWN3B), f1 = fig(corr, OWN3B);
  const d = { a: sub5(f1.a, f0.a), b: sub5(f1.b, f0.b), c: sub5(f1.c, f0.c), e: sub5(f1.e, f0.e), unreg: {} };
  // an amendment row's revised figures changed in the Excel: the difference is paid with this month's 3B too
  if (Object.keys(fix.mods || {}).some((k) => isAmend(k.split("|")[0]))) {
    const fb = GSTR.toJson.orig.call(GSTR, ym, reg), fc = overlay(clone(fb), fix, reg, false), a0 = fig(fb, AMD3B), a1 = fig(fc, AMD3B);
    ["a", "b"].forEach((k) => { const x = sub5(a1[k], a0[k]); Object.keys(x).forEach((h) => { d[k][h] = R(d[k][h] + x[h]); }); });
  }
  new Set(Object.keys(f0.unreg).concat(Object.keys(f1.unreg))).forEach((p) => {
    const x = f1.unreg[p] || { taxable: 0, igst: 0 }, y = f0.unreg[p] || { taxable: 0, igst: 0 };
    if (Math.abs(x.taxable - y.taxable) > 0.004 || Math.abs(x.igst - y.igst) > 0.004) d.unreg[p] = { taxable: R(x.taxable - y.taxable), igst: R(x.igst - y.igst) };
  });
  return d;
}
function fix3b(t, ym, reg) {
  if (!t || t.quarter || !curOf(reg, ym)) return t;
  const d = delta3b(ym, reg);
  if (!d) return t;
  const plus = (o, x) => { const r = Object.assign({}, o || {}); Object.keys(x).forEach((k) => { r[k] = R(N(r[k]) + N(x[k])); }); return r; };
  t.net = plus(t.net, d.a); t.zero = plus(t.zero, d.b); t.nil = plus(t.nil, { taxable: d.c.taxable }); t.nongst = plus(t.nongst, { taxable: d.e.taxable });
  const up = {}; (t.unregPos || []).forEach((x) => { up[x.pos] = Object.assign({}, x); });
  let ut = 0, ui = 0;
  Object.keys(d.unreg).forEach((p) => { const x = up[p] = up[p] || { pos: p, taxable: 0, igst: 0 }; x.taxable = R(x.taxable + d.unreg[p].taxable); x.igst = R(x.igst + d.unreg[p].igst); ut += d.unreg[p].taxable; ui += d.unreg[p].igst; });
  t.unregPos = Object.values(up).filter((x) => Math.abs(x.taxable) >= 0.005 || Math.abs(x.igst) >= 0.005).sort((a, c) => a.pos.localeCompare(c.pos));
  t.toUnreg = plus(t.toUnreg, { taxable: ut, igst: ui });
  t.r1Fix = d;
  if (t.netItc && typeof GSTR.setOff === "function") { t.pay = GSTR.setOff(t.net, t.rcmOut, t.netItc, t.opening); t.payable = t.pay.cash; }
  return t;
}

// a QRMP quarter's GSTR-1 (toJson for "yyyymm-yyyymm"): with a month corrected, the months' own corrected tables together
function quarter(j, per, reg, opts) {
  const months = GSTR.expand(per);
  if (!months.some((m) => curOf(reg, m))) return j;
  const out = { gstin: j.gstin, fp: j.fp, version: j.version, hash: j.hash }, all = {};
  months.forEach((m) => { const lm = linesOf(GSTR.toJson(m, reg, { plain: true })); TABLES.forEach((t) => { all[t] = (all[t] || []).concat(lm[t]); }); });
  TABLES.forEach((t) => { if (all[t].length) build(out, t, all[t], reg); });
  if (!(opts && opts.plain) && reg && typeof GSTAmend === "object") GSTAmend.addTo(out, GSTR.pStart(per), reg);
  return out;
}

// ---------- the wraps (once)
let seenFix = null;
if (typeof GSTR === "object" && GSTR.toJson && !GSTR.toJson.r1Fix) {
  const oj = GSTR.toJson;
  GSTR.toJson = function (ym, reg, opts) {
    const j = oj.call(this, ym, reg, opts);
    try {
      if (String(ym || "").length > 6) return quarter(j, ym, reg, opts);
      const fix = curOf(reg, ym);
      return fix ? overlay(j, fix, reg, !!(opts && opts.plain)) : j;
    } catch (e) { if (typeof console === "object") console.error("GSTR-1 corrections", e); return j; }
  };
  GSTR.toJson.r1Fix = true; GSTR.toJson.orig = oj;
  const ob = GSTR.threeBm;
  GSTR.threeBm = function (ym, reg) { const t = ob.call(this, ym, reg); try { return fix3b(t, ym, reg); } catch (e) { if (typeof console === "object") console.error("GSTR-1 corrections in 3B", e); return t; } };
  Object.assign(GSTR.threeBm, { itcFinal: ob.itcFinal, orig: ob.orig || ob, r1Fix: true });
  // the credit carried month to month is kept against what it depends on: a correction changes it
  const oc = GSTR.creditIn;
  GSTR.creditIn = function (ym, reg) { const f = (S.books || {}).r1Fix; if (f !== seenFix) { seenFix = f; this._carry = null; } return oc.call(this, ym, reg); };
}

// ---------- the Excel's data: the corrected month as lines, with the keys, the names and FinCom's totals
const tot0 = () => ({ n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
// a table's totals as the GSTR-1 screen adds them (portal.js r1Portal): 9B's notes as listed, 9C's credit notes less, nil
// as the three amounts
export function totalsOf(t, lines) {
  const o = tot0(), sg = (l) => (IT[t] && IT[t].note && IT[t].amend ? (String(l.ntty || "C").toUpperCase() === "D" ? 1 : -1) : 1);
  lines.forEach((l) => {
    o.n++;
    if (t === "nil") { o.taxable = R(o.taxable + N(l.nil_amt) + N(l.expt_amt) + N(l.ngsup_amt)); return; }
    if (t === "docs") { o.n += N(l.totnum) - N(l.cancel) - 1; return; }
    if (t === "eco14a") { o.taxable = R(o.taxable + N(l.suppval)); o.igst = R(o.igst + N(l.igst)); o.cgst = R(o.cgst + N(l.cgst)); o.sgst = R(o.sgst + N(l.sgst)); o.cess = R(o.cess + N(l.cess)); return; }
    const s = sg(l);
    o.taxable = R(o.taxable + s * N(l.txval)); o.igst = R(o.igst + s * N(l.iamt)); o.cgst = R(o.cgst + s * N(l.camt)); o.sgst = R(o.sgst + s * N(l.samt)); o.cess = R(o.cess + s * N(l.csamt));
  });
  return o;
}
// the month as it is now (corrections laid over), table by table, each line with its key; late: a document missed in an
// earlier month reported now (not in the month's own JSON)
export function now(ym, reg) {
  // the lines keep their keys (laid over the books' JSON here, not read back from the corrected one)
  const fx = curOf(reg, ym), base = GSTR.toJson.orig.call(GSTR, ym, reg), own = new Set(), L = {};
  TABLES.forEach((t) => { L[t] = fx ? fixLines(base, t, fx, reg) : flatten(base, t); });
  Object.values(linesOf(GSTR.toJson.orig.call(GSTR, ym, reg, { plain: true }))).forEach((ls) => ls.forEach((l) => own.add(l._k)));
  if (fx) (fx.adds || []).forEach((a) => own.add("add|" + a.id));
  const full = fx ? overlay(clone(base), fx, reg, false) : base;
  const nm = {};
  try { GSTR.one(ym, reg).rows.forEach((r) => { if (r.gstin && !nm[r.gstin]) nm[r.gstin] = r.party; }); } catch (e) { /* no books */ }
  const books = Object.assign({}, nm), fix = curOf(reg, ym) || {};
  Object.assign(nm, names(reg, ym));
  TABLES.forEach((t) => L[t].forEach((l) => {
    if (!isAmend(t) && !own.has(l._k)) l._late = true;
    if (l.ctin) { const m = (fix.mods || {})[l._k], a = l._add ? (fix.adds || []).find((x) => x.id === l._add) : null; l.name = (m && m.name) || (a && a.f.name) || books[l.ctin] || nm[l.ctin] || ""; }
  }));
  const totals = {}; TABLES.forEach((t) => { totals[t] = totalsOf(t, L[t]); });
  return { lines: L, totals, names: nm, books, full };
}
// what goes in the Excel: the month, the registration and every table
export function excelData(ym, reg) {
  const n = now(ym, reg), gstin = (GSTR.gstins(S.books) || []).find((x) => x.slice(0, 2) === reg) || "";
  return { ym, reg, gstin, label: GSTR.label(ym), client: ((typeof CO === "function" && CO()) || {}).name || "", cid: S.coId || "", lines: n.lines, totals: n.totals,
    split: ym >= "202501", adv: typeof GSTAdv === "object" && GSTAdv.ready(), eco: n.lines.eco14a.length > 0 };
}

// ---------- what an Excel brought back changes, and what is wrong in it
export const RATES = () => ((typeof Books === "object" && Books.GST_RATES) || [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40]);
export const UQC = ["BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM", "CCM", "CMS", "CTN", "DOZ", "DRM", "GGK", "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR", "MTS", "NOS", "OTH", "PAC", "PCS", "PRS", "QTL", "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD", "TON", "TUB", "UGS", "UNT", "YDS", "NA"];
export const NIL_TY = ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"];
const STATES = () => new Set(Object.values(typeof STATE_CODES === "object" ? STATE_CODES : {}).concat(["96", "97"]));
const FIELD_WORDS = { ctin: "GSTIN/UIN", name: "Receiver name", inum: "Invoice number", idt: "Invoice date", val: "Value", pos: "Place of supply", rchrg: "Reverse charge", inv_typ: "Invoice type",
  etin: "E-commerce GSTIN", diff_percent: "Applicable % of tax rate", rt: "Rate", txval: "Taxable value", iamt: "IGST", camt: "CGST", samt: "SGST", csamt: "Cess", exp_typ: "Export type", sbpcode: "Port code",
  sbnum: "Shipping bill no.", sbdt: "Shipping bill date", ntty: "Note type", nt_num: "Note number", nt_dt: "Note date", typ: "Type", oinum: "Original invoice number", oidt: "Original invoice date",
  ont_num: "Original note number", ont_dt: "Original note date", omon: "Original month", sply_ty: "Supply type", nil_amt: "Nil rated", expt_amt: "Exempted", ngsup_amt: "Non-GST", hsn_sc: "HSN",
  desc: "Description", uqc: "UQC", qty: "Quantity", doc_num: "Nature of document", from: "Sr. No. From", to: "Sr. No. To", totnum: "Total number", cancel: "Cancelled", suppval: "Net value of supplies",
  igst: "IGST", cgst: "CGST", sgst: "SGST", cess: "Cess" };
export const fieldWord = (f) => FIELD_WORDS[f] || f;
const NUMF = new Set(["rt", "val", "qty", "nil_amt", "expt_amt", "ngsup_amt", "totnum", "cancel", "suppval", "igst", "cgst", "sgst", "cess", "doc_num", "diff_percent"].concat(TAXF));
const same = (f, a, b) => (NUMF.has(f) ? Math.abs(N(a) - N(b)) < 0.005 : String(a == null ? "" : a).trim() === String(b == null ? "" : b).trim());
const FIELDS = (t) => (IT[t] ? IT[t].g.concat(IT[t].doc, ["rt"], TAXF, ["name"]) : t === "nil" ? ["sply_ty", "nil_amt", "expt_amt", "ngsup_amt"] : FL[t] && FL[t].hsn ? ["hsn_sc", "desc", "uqc", "qty", "rt"].concat(TAXF)
  : t === "b2cs" ? ["pos", "typ", "etin", "diff_percent", "rt"].concat(TAXF) : t === "docs" ? ["doc_num", "from", "to", "totnum", "cancel"] : t === "eco14a" ? ["etin", "suppval", "igst", "cgst", "sgst", "cess"] : []);
const dmyOk = (s) => { const m = String(s || "").match(/^(\d{2})-(\d{2})-(\d{4})$/); if (!m) return null; const d = new Date(+m[3], +m[2] - 1, +m[1]); return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? m[3] + m[2] : null; };
const money = (v) => (typeof INR === "object" ? INR.format(R(v)) : R(v).toFixed(2));
const DOC_NO = { b2b: "inum", b2cl: "inum", exp: "inum", cdnr: "nt_num", cdnur: "nt_num" };
const DOC_DT = { b2b: "idt", b2cl: "idt", exp: "idt", cdnr: "nt_dt", cdnur: "nt_dt", b2ba: "idt", b2cla: "idt", expa: "idt", cdnra: "nt_dt", cdnura: "nt_dt" };

// the problems of one line of the file: [{level: "error" | "warning", why}]
function check(t, f, reg, ym) {
  const out = [], E = (why) => out.push({ level: "error", why }), W = (why) => out.push({ level: "warning", why });
  const states = STATES(), gv = (g) => (typeof gstinValid === "function" ? gstinValid(g) : /^\d{2}[A-Z0-9]{13}$/.test(String(g || "")));
  const pos = String(f.pos == null ? "" : f.pos);
  const posOk = () => { if (!pos) { E("the place of supply is empty"); return false; } if (!states.has(pos)) { E("the place of supply “" + pos + "” is not a state code"); return false; } return true; };
  if (IT[t] || t === "b2cs" || (FL[t] && FL[t].hsn)) {
    const rt = N(f.rt);
    if (f.rt === "" || f.rt == null || !RATES().some((r) => Math.abs(r - rt) < 0.001)) E("the rate " + (f.rt === "" || f.rt == null ? "is empty" : rt + "% is not a GST rate") + " (" + RATES().join(", ") + ")");
    else {
      const want = R(N(f.txval) * rt / 100 * (N(f.diff_percent) ? N(f.diff_percent) : 1)), got = R(N(f.iamt) + N(f.camt) + N(f.samt));
      if (Math.abs(want - got) > 1) E("the tax " + money(got) + " is not the taxable value " + money(f.txval) + " × " + rt + "% = " + money(want) + " (more than ₹1 apart)");
      if (Math.abs(N(f.camt) - N(f.samt)) > 1) E("CGST " + money(f.camt) + " and SGST " + money(f.samt) + " differ");
    }
  }
  const num0 = DOC_NO[t] || (IT[t] && IT[t].amend && IT[t].id !== null ? (IT[t].note ? "nt_num" : "inum") : "");
  if (num0) {
    const no = String(f[num0] == null ? "" : f[num0]).trim();
    if (!no) E("the " + fieldWord(num0).toLowerCase() + " is empty");
    else {
      if (no.length > 16) E("the number “" + no + "” is longer than 16 characters (the portal takes 16)");
      if (!/^[A-Za-z0-9/-]+$/.test(no) || /^0+$/.test(no)) E("the number “" + no + "” has characters the portal does not take (only letters, digits, / and -, and not only zeros)");
    }
  }
  const dt = DOC_DT[t];
  if (dt) {
    const p = dmyOk(f[dt]);
    if (!p) E("the date “" + (f[dt] || "") + "” is not a date (dd-mm-yyyy)");
    else if (!isAmend(t) && !GSTR.inP(p + "01", ym)) W("the date " + f[dt] + " is outside " + GSTR.label(String(ym).slice(0, 6)) + (String(ym).length > 6 ? " – " + GSTR.label(String(ym).slice(7)) : ""));
  }
  const own = reg || "";
  if (t === "b2b" || t === "cdnr" || t === "b2ba" || t === "cdnra") {
    const g = String(f.ctin || "").toUpperCase();
    if (!g) E("the GSTIN/UIN of the recipient is empty");
    else if (!gv(g)) E("the GSTIN “" + g + "” is not valid (its form or its check digit)");
    if (posOk()) {
      const inter = /^(SEWP|SEWOP|CBW)$/.test(String(f.inv_typ || "")) || pos !== own;
      if (inter && (N(f.camt) || N(f.samt))) E("the place of supply " + pos + " is not the registration's state " + own + ": the tax is IGST, not CGST and SGST");
      if (!inter && N(f.iamt)) E("the place of supply " + pos + " is the registration's state: the tax is CGST and SGST, not IGST");
      if (g && gv(g) && String(f.inv_typ || "R") === "R" && g.slice(0, 2) !== pos && g.slice(0, 2) !== "99") W("the place of supply " + pos + " is not the recipient's state " + g.slice(0, 2) + " (from its GSTIN): right only for goods sent elsewhere");
    }
    if (f.rchrg && !/^[YN]$/.test(String(f.rchrg))) E("reverse charge is Y or N");
    if (t === "b2b" && f.inv_typ && !/^(R|SEWP|SEWOP|DE|CBW)$/.test(String(f.inv_typ))) E("the invoice type “" + f.inv_typ + "” is not one of the portal's");
  }
  if (t === "b2cl" || t === "b2cla") { if (posOk() && pos === own) E("B2C (Large) is an inter-State supply: the place of supply cannot be the registration's state " + own); if (N(f.camt) || N(f.samt)) E("B2C (Large): the tax is IGST only"); }
  if (t === "exp" || t === "expa") { if (!/^(WPAY|WOPAY)$/.test(String(f.exp_typ || ""))) E("the export type is WPAY or WOPAY"); else if (f.exp_typ === "WOPAY" && N(f.iamt)) E("an export without payment (WOPAY) has no IGST"); }
  if (t === "cdnur" || t === "cdnura") { if (!/^(B2CL|EXPWP|EXPWOP)$/.test(String(f.typ || ""))) E("the UR type is B2CL, EXPWP or EXPWOP"); }
  if (IT[t] && IT[t].note && !/^[CD]$/.test(String(f.ntty || ""))) E("the note type is C or D");
  if (t === "b2cs" || t === "at" || t === "txpd" || t === "b2csa") {
    if (posOk()) { const inter = pos !== own; if (inter && (N(f.camt) || N(f.samt))) E("the place of supply " + pos + " is another state: the tax is IGST, not CGST and SGST"); if (!inter && N(f.iamt)) E("the place of supply " + pos + " is the registration's state: the tax is CGST and SGST, not IGST"); }
    if (t === "b2cs" && f.typ && !/^(OE|E)$/.test(String(f.typ))) E("the type is OE or E");
  }
  if (t === "nil" && !NIL_TY.includes(String(f.sply_ty || ""))) E("the description is not one of the four kinds of supply");
  if (FL[t] && FL[t].hsn) {
    if (!/^\d{4,8}$/.test(String(f.hsn_sc || ""))) E("the HSN “" + (f.hsn_sc || "") + "” is not 4 to 8 digits");
    if (!UQC.includes(String(f.uqc || "").toUpperCase())) E("the UQC “" + (f.uqc || "") + "” is not one of the portal's units");
  }
  if (t === "docs") { if (!f.doc_num || N(f.doc_num) < 1 || N(f.doc_num) > 12) E("the nature of document is not one of the portal's"); if (!String(f.from || "").trim() || !String(f.to || "").trim()) E("Sr. No. From and To are needed"); if (N(f.cancel) > N(f.totnum)) E("more cancelled than issued"); }
  if (f.etin && !gv(String(f.etin).toUpperCase())) E("the e-commerce GSTIN “" + f.etin + "” is not valid");
  return out;
}

// preview: x = the Excel read back ({meta, tables: {t: [{row, key, f}]}, summary: {t: {...}}}); what it changes against the
// month as FinCom has it now, what is wrong in it, and the corrections it would leave (fix: against the books)
export function preview(ym, reg, x) {
  const cur = now(ym, reg), base = linesOf(GSTR.toJson.orig.call(GSTR, ym, reg)), baseOwn = new Set();
  Object.values(base).forEach((ls) => ls.forEach((l) => { if (l.ctin) l.name = cur.books[l.ctin] || ""; }));
  Object.values(linesOf(GSTR.toJson.orig.call(GSTR, ym, reg, { plain: true }))).forEach((ls) => ls.forEach((l) => baseOwn.add(l._k)));
  const old = curOf(reg, ym) || { mods: {}, dels: {}, adds: [] }, oldAdd = new Map((old.adds || []).map((a) => [a.id, a]));
  const fix = { mods: {}, dels: {}, adds: [], skip: {} }, errors = [], warnings = [], tables = {}, amendRows = amendIndex(ym, reg);
  let addN = 0;
  const T = (t) => (tables[t] = tables[t] || { added: [], deleted: [], modified: [] });
  const sheetTables = new Set(Object.keys(x.tables || {}));
  TABLES.forEach((t) => {
    if (!sheetTables.has(t)) return;                                 // a table with no sheet in the file (advances off): as it is
    const rows = x.tables[t] || [], baseBy = new Map(base[t].map((l) => [l._k, l])), curBy = new Map(cur.lines[t].map((l) => [l._k, l])), seen = new Set();
    rows.forEach((y) => {
      const f = y.f || {};
      check(t, f, reg, ym).forEach((p) => (p.level === "error" ? errors : warnings).push({ t, row: y.row, why: p.why, ref: refOf(t, f) }));
      let key = String(y.key || "").trim();
      if (key && seen.has(key)) { warnings.push({ t, row: y.row, why: "a copy of another row (the same hidden key): taken as a new entry", ref: refOf(t, f) }); key = ""; }
      if (key) seen.add(key);
      if (!key) {
        if (isAmend(t)) { errors.push({ t, row: y.row, why: "an amendment row cannot be added here: amendments come from the returns filed (add the document in its own table)", ref: refOf(t, f) }); return; }
        // the same file brought back twice: a row with no key exactly like an entry added before is that entry
        const pf = pick(t, f), twin = (old.adds || []).find((a) => a.t === t && !seen.has("add|" + a.id) && !diff(t, Object.assign({}, a.f), pf).length && !diff(t, Object.assign({}, pf), a.f).length);
        if (twin) { seen.add("add|" + twin.id); fix.adds.push({ id: twin.id, t, f: pf }); return; }
        const a = { id: "m" + Date.now().toString(36) + (addN++).toString(36), t, f: pf };
        fix.adds.push(a); T(t).added.push({ row: y.row, f: a.f }); return;
      }
      if (key.startsWith("add|")) {
        const was = oldAdd.get(key.slice(4));
        if (!was || was.t !== t) { errors.push({ t, row: y.row, why: "the hidden key is not one of this month's entries (edited, or from another month or client)", ref: refOf(t, f) }); return; }
        const a = { id: was.id, t, f: pick(t, f) }; fix.adds.push(a);
        const c = curBy.get(key), ch = c ? diff(t, c, a.f) : [];
        if (ch.length) T(t).modified.push({ row: y.row, key, ref: refOf(t, a.f), fields: ch });
        return;
      }
      const b = baseBy.get(key);
      if (!b) { errors.push({ t, row: y.row, why: "the hidden key is not one of this month's lines (edited, or from another month or client)", ref: refOf(t, f) }); return; }
      const m = {}; FIELDS(t).forEach((fl) => { if (f[fl] !== undefined && !same(fl, b[fl], f[fl]) && !(fl === "name" && !String(f[fl] || "").trim())) m[fl] = f[fl]; });
      if (Object.keys(m).length) fix.mods[key] = m;
      const c = curBy.get(key) || modded(b, m, reg), ch = diff(t, c, f);
      if (!curBy.has(key)) T(t).added.push({ row: y.row, f, back: true });           // excluded before, back in the file
      else if (ch.length) T(t).modified.push({ row: y.row, key, ref: refOf(t, f), fields: ch });
    });
    // rows of the month no longer in the file: excluded (an amendment or a document missed earlier: left out, GSTAmend's choice)
    base[t].forEach((l) => {
      if (seen.has(l._k)) return;
      const c = curBy.get(l._k), wasOut = !c;
      if (isAmend(t) || !baseOwn.has(l._k)) { const id = amendRows(t, l); if (id) { fix.skip[id] = ((S.books || {}).amendFix || {})[id] || null; if (!wasOut) T(t).deleted.push({ key: l._k, ref: refOf(t, l), l: c }); } return; }
      fix.dels[l._k] = 1;
      if (!wasOut) T(t).deleted.push({ key: l._k, ref: refOf(t, c), l: c });
    });
    (old.adds || []).filter((a) => a.t === t && !seen.has("add|" + a.id)).forEach((a) => { const c = curBy.get("add|" + a.id); T(t).deleted.push({ key: "add|" + a.id, ref: refOf(t, a.f), l: c, manual: true }); });
  });
  // the same number for two documents (invoices and notes counted apart; capitals and small letters the same)
  const docs = new Map();
  ["b2b", "b2cl", "exp", "cdnr", "cdnur"].forEach((t) => (x.tables && x.tables[t] || []).forEach((y) => {
    const f = y.f || {}, no = NK(f[DOC_NO[t]]); if (!no) return;
    const k = (IT[t].note ? "N|" : "I|") + no, id = t + "|" + NK(f.ctin || f.pos || f.exp_typ || f.typ || "") + "|" + (f[DOC_DT[t]] || ""), o = docs.get(k);
    if (!o) docs.set(k, { id, row: y.row, t }); else if (o.id !== id) errors.push({ t, row: y.row, why: "the number " + f[DOC_NO[t]] + " is used for another document too (" + o.t + " row " + o.row + ")", ref: refOf(t, f) });
  }));
  // a new or renumbered document whose number another month of the year already has in the books
  try {
    const fy = (() => { const y = +String(ym).slice(0, 4), m = +String(ym).slice(4, 6), s = m >= 4 ? y : y - 1, o = []; for (let i = 0; i < 12; i++) { const mm = (i + 3) % 12 + 1; o.push((mm >= 4 ? s : s + 1) + String(mm).padStart(2, "0")); } return o; })();
    const idx = typeof GSTR.docNoIndex === "function" ? GSTR.docNoIndex(fy.filter((m) => m !== String(ym).slice(0, 6)), reg) : {};
    const chk = (t, f, row) => { const no = String(f[DOC_NO[t]] || "").trim(); if (no && idx[(IT[t].note ? "N|" : "I|") + no.toUpperCase()]) errors.push({ t, row, why: "the number " + no + " is used in another month of the year in the books", ref: refOf(t, f) }); };
    Object.keys(tables).forEach((t) => { if (!DOC_NO[t]) return; tables[t].added.forEach((a) => chk(t, a.f, a.row)); tables[t].modified.forEach((m) => { if (m.fields.some((c) => c.field === DOC_NO[t])) { const y = (x.tables[t] || []).find((r) => r.row === m.row); if (y) chk(t, y.f, m.row); } }); });
  } catch (e) { /* the year's other months not in the books */ }
  // the totals: the Excel's own (its Summary, when worked out), FinCom's now and after Apply
  const after = afterTotals(ym, reg, fix), totals = {};
  TABLES.forEach((t) => {
    if (!sheetTables.has(t) && !cur.lines[t].length) return;
    const fileTot = totalsOf(t, (x.tables[t] || []).map((y) => Object.assign({ _t: t }, y.f)));
    const sm = x.summary && x.summary[t];
    totals[t] = { now: cur.totals[t], after: after[t], file: fileTot, excel: sm && sm.calc ? sm : null };
  });
  const n = Object.values(tables).reduce((a, o) => a + o.added.length + o.deleted.length + o.modified.length, 0);
  return { ym, reg, tables, errors, warnings, totals, fix, n, meta: x.meta || {} };
}
const refOf = (t, f) => { f = f || {}; return [f.ctin, f.inum || f.nt_num || f.oinum || f.ont_num, f.hsn_sc, f.pos && !f.ctin && !f.inum && !f.nt_num ? "POS " + f.pos : "", f.rt != null && f.rt !== "" && (t === "b2cs" || FL[t] && FL[t].hsn) ? f.rt + "%" : "", f.from ? f.from + "–" + f.to : "", f.sply_ty && t === "nil" ? f.sply_ty : "", f.etin && t === "eco14a" ? f.etin : ""].filter(Boolean).join(" · "); };
function pick(t, f) { const o = {}; FIELDS(t).forEach((fl) => { if (f[fl] !== undefined && f[fl] !== null && f[fl] !== "") o[fl] = f[fl]; }); return o; }
function diff(t, c, f) { const out = []; FIELDS(t).forEach((fl) => { if (f[fl] === undefined) return; const a = c[fl] == null ? "" : c[fl], b = f[fl] == null ? "" : f[fl]; if (!same(fl, a, b) && !(fl === "name" && !String(b).trim())) out.push({ field: fl, from: a, to: b }); }); return out; }
// the amendment (GSTAmend.pending's row id) a line of an amendment table, or a document missed earlier, comes from
function amendIndex(ym, reg) {
  let rows = [];
  try { rows = reg && typeof GSTAmend === "object" && GSTAmend.filed(reg).length ? GSTAmend.pending(ym, reg).rows : []; } catch (e) { rows = []; }
  return (t, l) => {
    const kind = IT[t] && IT[t].amend ? IT[t].amend : { b2b: "B2B", b2cl: "B2CL", exp: "EXP", cdnr: "CDNR", cdnur: "CDNUR" }[t];
    const hit = rows.find((r) => {
      if (r.act === "skip" || r.kind !== kind) return false;
      if (kind === "B2CS") return r.b2cs && GSTAmend.fpOf(r.P) === String(l.omon) && r.b2cs.pos === String(l.pos) && N(r.b2cs.rt) === N(l.rt);
      const d = isAmend(t) ? r.was : r.now; if (!d) return false;
      const no = isAmend(t) ? l.oinum || l.ont_num : l.inum || l.nt_num;
      return NK(d.num) === NK(no) && (!l.ctin || String(d.ctin || "") === String(l.ctin));
    });
    return hit ? hit.id : "";
  };
}
// FinCom's tables if the corrections were these (nothing kept): a dry run of the overlay
function afterTotals(ym, reg, fix) {
  const full = GSTR.toJson.orig.call(GSTR, ym, reg), skip = Object.keys(fix.skip || {});
  let j = overlay(clone(full), fix, reg, false);
  if (skip.length) {
    // what an amendment left out takes away from the file
    const L = linesOf(j), ids = amendIndex(ym, reg);
    TABLES.forEach((t) => { const keep = L[t].filter((l) => !skip.includes(ids(t, l))); if (keep.length !== L[t].length) build(j, t, keep, reg); });
  }
  const L = linesOf(j), o = {}; TABLES.forEach((t) => { o[t] = totalsOf(t, L[t]); });
  return o;
}

// ---------- Apply and Undo
export function apply(ym, reg, pv) {
  const b = S.books, k = K(reg, ym), at = new Date().toISOString(), by = who();
  b.r1Fix = Object.assign({}, b.r1Fix || {});
  const was = b.r1Fix[k] || {}, prev = was.cur || null;
  const cur = Object.assign({}, pv.fix, { at, by, file: (pv.meta && pv.meta.file) || "", n: pv.n });
  // an amendment taken out of the file: GSTAmend's own choice, left out (what it was kept, for Undo)
  if (Object.keys(cur.skip || {}).length) { b.amendFix = Object.assign({}, b.amendFix || {}); Object.keys(cur.skip).forEach((id) => { b.amendFix[id] = "skip"; }); }
  b.r1Fix[k] = { cur, vers: (was.vers || []).concat([{ cur: prev, at, by }]).slice(-10), log: (was.log || []).concat([{ act: "upload", at, by, n: pv.n, file: cur.file }]).slice(-30) };
  if (GSTR) GSTR._carry = null;
  saveBooks();
  return b.r1Fix[k];
}
export function info(ym, reg) {
  const e = ALL()[K(reg, ym)];
  if (!e) return null;
  const c = e.cur && !empty(e.cur) ? e.cur : null, last = (e.log || [])[(e.log || []).length - 1] || null;
  return { cur: c, n: c ? Object.keys(c.mods || {}).length + Object.keys(c.dels || {}).length + (c.adds || []).length : 0, canUndo: (e.vers || []).length > 0, last };
}
// Undo: the month as it was before the last upload, all of it (the amendments left out by it put back)
export function undo(ym, reg) {
  const b = S.books, k = K(reg, ym), e = (b.r1Fix || {})[k];
  if (!e || !(e.vers || []).length) return false;
  const v = e.vers[e.vers.length - 1], at = new Date().toISOString(), by = who();
  const sk = (e.cur && e.cur.skip) || {};
  if (Object.keys(sk).length) { b.amendFix = Object.assign({}, b.amendFix || {}); Object.keys(sk).forEach((id) => { if (sk[id] == null) delete b.amendFix[id]; else b.amendFix[id] = sk[id]; }); }
  b.r1Fix = Object.assign({}, b.r1Fix, { [k]: { cur: v.cur, vers: e.vers.slice(0, -1), log: (e.log || []).concat([{ act: "undo", at, by }]).slice(-30) } });
  if (GSTR) GSTR._carry = null;
  saveBooks();
  return true;
}

export const R1Fix = { IT, FL, TABLES, UQC, NIL_TY, RATES, isAmend, linesOf, overlay, curOf, names, delta3b, now, excelData, totalsOf, preview, apply, undo, info, fieldWord, check };
if (typeof window !== "undefined") window.R1Fix = R1Fix;
else if (typeof globalThis === "object") globalThis.R1Fix = R1Fix;
// Large saves sent compressed (lib/gzUpload.js, loaded with the first one: Cloud.api in src/js/27-firm-account.js asks
// window.loadGzUpload). Its loader is set here, in a file fetched with every open, as the first file and legacy.js are
// at their size budgets; until it is set every save goes as before
if (typeof window === "object") window.loadGzUpload = () => import("./gzUpload.js");
