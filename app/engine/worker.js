// next-speed-worker (owner-approved, step 1 of the speed work: screens never freeze): the engine's worker. The page's
// own code (boot.js: legacy.js; then, in the page's order, the React app's GST wraps and the MIS screen's file) works
// out the day's audit and the month's MIS for the page's job (src/js/06-audit.js: Audit.autoEngine, Engine) off the
// page's thread: the same run, up to where the page's steps would ask prog.keep; the page writes it into the books.
// Built by app/vite.config.js (fincom-legacy) into assets/engine-<hash>.js, fetched only when a run first needs it.
// The page's words (data.t): init (legacy.js's address), begin / S / bk / bv / end (the books, in parts, a version each), run, cancel. Its answers:
// ready / fail, prog (how far), mis (the figures), audit + rows + end (the findings, then their rows in parts), err.
/* global S, MIS, Audit, BOOKS_REV, JOB_MEMO, IN_RENDER, reactScopeEnd */
import { loadLegacy, DENIED } from "./boot.js";

const SLICE_MS = 50, PROG_MS = 100, ROWS = 5000;
const say = (m) => self.postMessage(m);
const err = (e) => String((e && e.message) || e || "failed");
let books = null, next = null;
const queue = [];
let job = null;
const EST = {};

// review of part 1: every run starts afresh. What a run keeps for itself (per drawing: RENDER_GEN; per save: BOOKS_REV)
// is worked out again, the caches the page empties by hand (GSTR._carry: a client's choice changed, as advances in GST;
// GST2B._memo; GST's kept checks, GSTR._ck / _ckAt) are emptied, and every other "_" cache of the engines is put back as
// it was when they loaded (taken in init: CACHED)
const CACHED = new Map();
const ENGINES = () => { const o = {}; [["MIS", () => MIS], ["Audit", () => Audit], ["Parties", () => Parties], ["GSTR", () => GSTR], ["GST2B", () => GST2B], ["M2B", () => M2B],
  ["GSTF", () => GSTF], ["GSTAdv", () => GSTAdv], ["GSTSet", () => GSTSet], ["GSTAmend", () => GSTAmend], ["GSTQ", () => GSTQ], ["GSTCMP", () => GSTCMP], ["GSTV", () => GSTV],
  ["TDS", () => TDS], ["TDSWatch", () => TDSWatch], ["Books", () => Books], ["LedMaster", () => LedMaster], ["LK", () => LK], ["FS", () => FS], ["ITCF", () => ITCF], ["ITCDec", () => ITCDec], ["Ledgers", () => Ledgers]]
  .forEach(([n, f]) => { try { const x = f(); if (x && typeof x === "object") o[n] = x; } catch (e) { /* not in these files */ } }); return o; };
// (a value that cannot be made afresh, not plain data: left as it is, KEEP)
const KEEP = {};
const blank = (v) => { if (v === KEEP) return KEEP; if (v instanceof WeakMap) return new WeakMap(); if (v instanceof Map) return new Map(); if (v instanceof Set) return new Set();
  if (v && typeof v === "object") { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return KEEP; } } return v; };
function takeCaches() {
  const E = ENGINES();
  Object.keys(E).forEach((n) => { const m = new Map(); Object.keys(E[n]).forEach((k) => { if (k[0] === "_" && typeof E[n][k] !== "function") m.set(k, blank(E[n][k])); }); CACHED.set(n, m); });
}
function fresh() {
  RENDER_GEN++; BOOKS_REV++;
  const E = ENGINES();
  Object.keys(E).forEach((n) => {
    const o = E[n], m = CACHED.get(n) || new Map();
    Object.keys(o).forEach((k) => { if (k[0] !== "_" || typeof o[k] === "function") return;
      try { if (!m.has(k)) delete o[k]; else { const v = blank(m.get(k)); if (v !== KEEP) o[k] = v; } } catch (e) { /* (one that cannot be changed: left) */ } });
  });
  if (typeof GSTR === "object") { GSTR._carry = null; GSTR._ckAt = null; if ("_ck" in GSTR) GSTR._ck = new WeakMap(); }
  if (typeof GST2B === "object") GST2B._memo = null;
}
// S as the page sends it (review of part 1: replaced, not added to: a field the page no longer sends is gone)
function setS(s) { Object.keys(S).forEach((k) => { if (k !== "books" && !(k in s)) delete S[k]; }); Object.keys(s).forEach((k) => { S[k] = s[k]; }); }
// the page's clear (another client, a sign-out): nothing of the last is kept
function clearAll() {
  // (each job it held answered "dropped" at once: the page does not wait for its time, review of the full stack)
  queue.forEach((q) => say({ t: "dropped", id: q.id })); if (job) say({ t: "dropped", id: job.id });
  books = null; next = null; queue.length = 0;
  if (job) { try { job.it.return(); } catch (x) { /* closed */ } job = null; }
  setS({}); S.books = null; self.__engineLS.clear(); if (typeof M2B === "object") M2B.st = {};
  fresh();
}
// a test's check (tests/run_speed_worker.py) that every write here is refused: each tried, and what it did
async function selftest() {
  const tries = { saveBooks: () => saveBooks(), "Store.saveCompany": () => Store.saveCompany({ id: "zz" }), "IDBStore.write": () => IDBStore.write([["zz", 1]]), "Books.save": () => Books.save("zz", {}),
    "localStorage.setItem": () => localStorage.setItem("zz", "1"), "sessionStorage.setItem": () => sessionStorage.setItem("zz", "1"), "indexedDB.open": () => indexedDB.open("zz"),
    fetch: () => fetch("/zz"), lsSet: () => lsSet("zz", "1") };
  DENIED.forEach((n) => { if (!tries[n] && typeof self[n] === "function") tries[n] = () => self[n](); });
  const out = {};
  for (const k of Object.keys(tries)) { try { const r = tries[k](); if (r && typeof r.then === "function") await r; out[k] = "done"; } catch (e) { out[k] = "refused: " + err(e); } }
  return out;
}
function begin(m) {
  // a new version of the books: what is kept from the last, the rest comes in parts
  const o = {};
  if (books) m.keep.forEach((k) => { o[k] = books[k]; });
  o.vouchers = m.keepV && books ? books.vouchers : [];
  next = { ver: m.ver, b: o, keepV: !!m.keepV };
}
function run(m) {
  const b = S.books, prog = { k: 0, of: 0, keep: () => true };
  let it;
  if (m.kind === "audit") it = Audit.calcIn(m.from, m.to, prog);
  else {
    const regs = new Set((GSTR.gstins(b) || []).map((g) => String(g).slice(0, 2))).size || 1;
    prog.of = EST.mis || (GSTR.months().filter((x) => x <= Audit.ymd(m.to).slice(0, 6)).length * (regs + 1) + 12 + Math.ceil((b.vouchers || []).length / 5000) * 9);
    it = MIS.steps(m.from, m.to, m.how, prog);
  }
  return { id: m.id, kind: m.kind, it, prog, memo: new Map(), n: 0, said: 0 };
}
function done(j, v) {
  if (j.kind === "mis") { EST.mis = j.n; say({ t: "mis", id: j.id, r: v }); return; }
  // the findings first (their rows after, in parts: no one word to copy that holds the page)
  const full = v.full, c = Object.assign({}, v, { b: null, full: null, ran: Array.from(v.ran), findings: v.findings.map((f) => Object.assign({}, f, { rows: [] })) });
  say({ t: "audit", id: j.id, c, n: full.map((r) => r.length) });
  full.forEach((rows, i) => { for (let k = 0; k < rows.length; k += ROWS) say({ t: "rows", id: j.id, i, rows: rows.slice(k, k + ROWS) }); });
  say({ t: "end", id: j.id });
}
// the job a slice at a time (a cancel is read between them), the books' state set as the page's job sets it
function step() {
  if (!job) {
    const m = queue.shift() || null; if (!m) return;
    try { fresh(); job = run(m); } catch (e) { job = null; say({ t: "err", id: m.id, e: err(e) }); if (queue.length) setTimeout(step, 0); return; }
  }
  const j = job, t0 = performance.now(), was = JOB_MEMO;
  let fin = false, v = null;
  if (typeof reactScopeEnd === "function") reactScopeEnd();
  JOB_MEMO = j.memo; IN_RENDER++;
  try {
    for (;;) { const r = j.it.next(); if (r.done) { fin = true; v = r.value; break; } j.n++; if (performance.now() - t0 >= SLICE_MS) break; }
  } catch (e) { fin = true; job = null; say({ t: "err", id: j.id, e: err(e) }); }
  finally { IN_RENDER--; JOB_MEMO = was; }
  if (fin && job === j) { job = null; try { done(j, v); } catch (e) { say({ t: "err", id: j.id, e: err(e) }); } }
  else if (!fin) {
    const now = performance.now();
    if (now - j.said >= PROG_MS) { j.said = now; say({ t: "prog", id: j.id, k: j.kind === "mis" ? Math.min(j.n, Math.max(j.prog.of - 1, 0)) : j.prog.k, of: j.prog.of }); }
  }
  if (job || queue.length) setTimeout(step, 0);
}
self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.t === "init") init(m.legacy);
    else if (m.t === "begin") begin(m);
    else if (m.t === "clear") clearAll();
    else if (m.t === "selftest") selftest().then((r) => say({ t: "selftest", r }));
    else if (m.t === "state") say({ t: "state", r: { books: !!books, n: books ? (books.vouchers || []).length : 0, s: Object.keys(S).sort(), ls: Array.from(self.__engineLS.keys()), m2b: typeof M2B === "object" ? Object.keys(M2B.st || {}).length : 0, queue: queue.length, job: !!job } });
    else if (m.t === "S") { setS(m.s || {}); const L = self.__engineLS; L.clear(); Object.keys(m.ls || {}).forEach((k) => L.set(k, m.ls[k])); if (m.g && m.g.M2B && typeof M2B === "object") M2B.st = m.g.M2B; if (books) S.books = books; }
    else if (m.t === "bk") { if (next && next.ver === m.ver) next.b[m.k] = m.v; }
    else if (m.t === "bv") { if (next && next.ver === m.ver) { const V = next.b.vouchers; for (let i = 0; i < m.v.length; i++) V.push(m.v[i]); } }
    else if (m.t === "end") {
      // a new books object (and BOOKS_REV moved): nothing a page's cache kept of the last version is read again
      if (next && next.ver === m.ver) { books = next.b; next = null; S.books = books; BOOKS_REV++; }
    }
    else if (m.t === "run") { if (!books) { say({ t: "err", id: m.id, e: "no books" }); return; } S.books = books; queue.push(m); if (!job) setTimeout(step, 0); }
    else if (m.t === "cancel") {
      if (job && job.id === m.id) { try { job.it.return(); } catch (x) { /* closed */ } job = null; }
      const i = queue.findIndex((q) => q.id === m.id); if (i >= 0) queue.splice(i, 1);
    }
  } catch (x) { if (m.id) say({ t: "err", id: m.id, e: err(x) }); }
};
// legacy.js first, then the React app's GST wraps (in the page's order: main.jsx) and the MIS screen's file, which
// find its names. The worker writes nothing into the books: the MIS's figures go to the page as they are (MIS.madeIn's
// last part, madeKeep, is the page's)
let started = false;
async function init(legacy) {
  if (started) return; started = true;
  const f = loadLegacy(legacy);
  if (f) { say({ t: "fail", e: f }); return; }
  try {
    await import("../src/lib/itcFinal.js");
    await import("../src/lib/gstr1Fix.js");
    await import("../../src/js/18-mis-pack.js");
    MIS.madeKeep = function (r) { return r; };
    takeCaches();
  } catch (e) { say({ t: "fail", e: err(e) }); return; }
  say({ t: "ready" });
}
self.addEventListener("error", (e) => { try { e.preventDefault(); } catch (x) { /* kept */ } });
