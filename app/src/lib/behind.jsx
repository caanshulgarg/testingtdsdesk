// next-speed-render (11-Nov-2026, 51,758 made-up entries: MIS, Audit, the TDS ledgers, the Reports list and the tie-out
// each held the page 1.2-3 s, 5-13 s on an office PC, before it showed anything). A page's figures worked out behind it:
// the page is drawn at once with "Working out…" where they go, and fills in as they come.
//
// behind(key, sig, make): make() gives a generator, the working in steps (each yield a point where the browser may draw
// and take a click); about STEP_MS of steps run in a task, then the browser has the page again. The steps share what they
// work out as one calculation does (perRender, src/js/01: JOB_MEMO, the job's own, for as long as the job runs), and the
// answer is the generator's own, run to its end: the same figures as working it out at once (drain). Kept per books (the
// books object) while sig() gives the same list (compared item by item: the books' save BOOKS_REV, the entries, ...), so a
// second open is at once; when the books change, the last figures are handed out (old: true) while the new ones are
// worked out, then drawn in their place. The books changed under a job: it stops, and the page's next drawing starts it
// again. In a drawing the first steps run there (up to IN_MS, books of up to SMALL entries), so small books never show "Working out…".
// Returns {v, done, old, part}: v the figures (or the last ones while new ones are worked out), part what the job has
// said so far (what it yields). An error is thrown where the page asks, as working it out at once would.
/* global S, IN_RENDER, JOB_MEMO, reactScopeEnd, soonRender, render */
// how long the steps may run in a drawing, in a task, and how often a job's progress is drawn (ms); a test sets them
// (window.FinComBehind) to see the steps one task at a time
export const BEHIND = { IN_MS: 25, STEP_MS: 12, DRAW_MS: 150, SMALL: 8000 };
if (typeof window === "object") window.FinComBehind = BEHIND;
const kept = new WeakMap(), jobs = {};
const same = (a, c) => !!a && !!c && a.length === c.length && a.every((x, i) => x === c[i]);
const now = () => (typeof performance === "object" ? performance.now() : Date.now());
const draw = () => { if (typeof soonRender === "function") soonRender({ now: true }); else if (typeof render === "function") render(); };

// the job's steps for about ms; true when it is done (its answer, or its error, kept)
function step(j, ms) {
  const t0 = now(), was = JOB_MEMO;
  if (typeof reactScopeEnd === "function") reactScopeEnd();
  JOB_MEMO = j.memo; IN_RENDER++;
  try {
    for (;;) {
      const r = j.it.next();
      if (r.done) { j.all[j.key] = { sig: j.sig, v: r.value }; break; }
      if (r.value !== undefined) j.part = r.value;
      if (now() - t0 >= ms) return false;
    }
  } catch (e) { j.all[j.key] = { sig: j.sig, err: e }; }
  finally { IN_RENDER--; JOB_MEMO = was; }
  if (jobs[j.key] === j) delete jobs[j.key];
  return true;
}
function soon(j) {
  const go = () => {
    if (jobs[j.key] !== j) return;
    if (S.books !== j.b || !same(j.sigOf(), j.sig)) { delete jobs[j.key]; draw(); return; }
    const p = j.part, done = step(j, BEHIND.STEP_MS);
    if (done || (j.part !== p && now() - j.drawn >= BEHIND.DRAW_MS)) { j.drawn = now(); draw(); }
    if (!done) soon(j);
  };
  if (typeof MessageChannel === "function" && !(typeof document === "object" && document.hidden)) {
    const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); go(); }; ch.port2.postMessage(0);
  } else setTimeout(go, 0);
}
export function behind(key, sig, make, inMs) {
  const b = S.books || null, s = sig(), all = b ? kept.get(b) || {} : {}, k = all[key];
  if (b) kept.set(b, all);
  if (k && same(k.sig, s)) { if (k.err) throw k.err; return { v: k.v, done: true }; }
  let j = jobs[key];
  if (!j || j.b !== b || !same(j.sig, s)) {
    j = jobs[key] = { key, b, sig: s, sigOf: sig, it: make(), memo: new Map(), all, part: undefined, drawn: now() };
    // in a drawing only for books of up to SMALL entries (a step on large books can be long by itself)
    const ms = inMs != null ? inMs : b && (b.vouchers || []).length <= BEHIND.SMALL ? BEHIND.IN_MS : 0;
    if (ms > 0 && step(j, ms)) return behind(key, sig, make, 0);
    soon(j);
  }
  return { v: k && !k.err ? k.v : undefined, done: false, old: !!(k && !k.err), part: j.part };
}
// a working's steps run to the end at once (an action, a test): the same figures
export function drain(it) { let r; while (!(r = it.next()).done); return r.value; }
// "Working out…" where a figure goes
export const Working = ({ text }) => <span className="note" data-working="">{text || "Working out…"}</span>;
