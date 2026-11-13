// next-speed-worker (owner-approved, step 1 of the speed work: screens never freeze): the engine's worker. The page's
// own code (boot.js: legacy.js; then, in the page's order, the React app's GST wraps and the MIS screen's file) works
// out the day's audit and the month's MIS for the page's job (src/js/06-audit.js: Audit.autoEngine, Engine) off the
// page's thread: the same run, up to where the page's steps would ask prog.keep; the page writes it into the books.
// Built by app/vite.config.js (fincom-legacy) into assets/engine-<hash>.js, fetched only when a run first needs it.
// The page's words (data.t): init (legacy.js's address), begin / S / bk / bv / end (the books, in parts, a version each), run, cancel. Its answers:
// ready / fail, prog (how far), mis (the figures), audit + rows + end (the findings, then their rows in parts), err.
/* global S, MIS, Audit, BOOKS_REV, JOB_MEMO, IN_RENDER, reactScopeEnd */
import { loadLegacy } from "./boot.js";

const SLICE_MS = 50, PROG_MS = 100, ROWS = 5000;
const say = (m) => self.postMessage(m);
const err = (e) => String((e && e.message) || e || "failed");
let books = null, next = null;
const queue = [];
let job = null;
const EST = {};

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
  if (!job) { job = queue.shift() || null; if (!job) return; job = run(job); }
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
    else if (m.t === "S") { Object.keys(m.s || {}).forEach((k) => { S[k] = m.s[k]; }); const L = self.__engineLS; L.clear(); Object.keys(m.ls || {}).forEach((k) => L.set(k, m.ls[k])); if (books) S.books = books; }
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
  } catch (e) { say({ t: "fail", e: err(e) }); return; }
  say({ t: "ready" });
}
self.addEventListener("error", (e) => { try { e.preventDefault(); } catch (x) { /* kept */ } });
