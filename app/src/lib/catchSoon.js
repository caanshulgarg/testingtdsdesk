// speed (11-Nov-2026, a linked client): each pull from Tally marks MIS and the audit out of date (TallyRead.after,
// src/js/18), and the open MIS or Audit tab worked them out again at once (TallyRead.catchUp: 2 s, 7 s on an office PC)
// on every pull, in a browser tab not on screen too. Here the tab works them out again only while the page is on the
// screen, and at most once in CATCH_MS for each; meanwhile it says it will (the same words), and is drawn again then.
// next-speed-render: the run itself is worked out behind the page in steps (lib/behind.jsx: a month's GST working, a
// check of the audit, 5,000 entries of the sales or the ages a step; MIS.runIn, Audit.runIn: the same runs), for the same
// period TallyRead.catchUp chose, then the books saved and the page drawn with the new figures
/* global TallyRead, render, S, MIS, Audit, GSTR, Parties, TDS, saveBooks */
import { behind } from "./behind.jsx";
export const CATCH_MS = 5000;
const WORDS = "Tally has changed since this was worked out; working it out again…";
const last = {}, armed = {};
let onVis = null;
function again(k, ms) {
  if (armed[k]) return;
  armed[k] = setTimeout(() => { armed[k] = 0; if (typeof render === "function") render(); }, ms);
}
function whenSeen() {
  if (onVis || typeof document !== "object") return;
  onVis = () => { if (document.hidden) return; document.removeEventListener("visibilitychange", onVis); onVis = null; if (typeof render === "function") render(); };
  document.addEventListener("visibilitychange", onVis);
}
// MIS's run in steps: first what the run reads many times (each month's GST working, from the books' first month so each
// month's credit carried in is there; the parties, the TDS rows, the days to pay, the cash flow and the cost centres:
// kept for the job as for one calculation), then MIS.runIn (Mis.jsx runSplit uses it too)
export function* misSteps(from, to, how) {
  const t = Audit.ymd(to), f = Audit.ymd(from), one = (fn) => { try { fn(); } catch (e) { /* the run says it */ } };
  for (const m of GSTR.months().filter((x) => x <= t.slice(0, 6))) { one(() => MIS.gst3b(m)); yield; }
  one(() => Parties.position(t)); yield;
  one(() => { TDS.rows(); TDS.salaryRows(); }); yield;
  one(() => MIS.payDays("r", t)); yield;
  one(() => MIS.payDays("p", t)); yield;
  one(() => MIS.cashActual(f, t)); yield;
  one(() => MIS.costCentres(f, t)); yield;
  return yield* MIS.runIn(from, to, how);
}
// TallyRead.catchUp's work (src/js/18), in steps: the same period, the same runs, then the mark taken off and the books saved
function* catchSteps(b, k) {
  const st = b.stale || {};
  try {
    if (k === "audit" && Audit.cfg(b).freq !== "off") { const L = (b.audit || {}).last, r = st.range || (L && L.from ? L : Audit.defaultRange(b)); yield* Audit.runIn(r.from, r.to, st.audit); }
    if (k === "mis") { const H = ((b.mis || {}).history || [])[0], r = H && H.from ? H : MIS.autoRange(b); if (r && r.from) yield* misSteps(r.from, r.to, st.mis); }
  } catch (e) { /* as TallyRead.catchUp: the mark goes, the tab shows what there is */ }
  delete st[k]; saveBooks();
  return true;
}
// "" nothing to work out; else the words to show while it is worked out (now, or once seen and CATCH_MS after the last)
export function catchSoon(b, k) {
  if (!b || !(b.stale || {})[k]) return "";
  const now = Date.now(), wait = CATCH_MS - (now - (last[k] || 0)), id = k + "|" + b.cid;
  if (typeof document === "object" && document.hidden) { whenSeen(); return WORDS; }
  // a run being worked out goes on to its end (a pull meanwhile marks the books again: the next run, CATCH_MS after)
  if (!on[id]) { if (wait > 0) { again(k, wait); return WORDS; } last[k] = now; on[id] = ++runs; }
  const n = on[id], job = behind("catch:" + id, () => [S.books, n], () => catchSteps(b, k));
  if (!job.done) return WORDS;
  delete on[id];
  return (b.stale || {})[k] ? catchSoon(b, k) : "";
}
const on = {};
let runs = 0;
