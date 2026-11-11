// speed (11-Nov-2026, a linked client): each pull from Tally marks MIS and the audit out of date (TallyRead.after,
// src/js/18), and the open MIS or Audit tab worked them out again at once (TallyRead.catchUp: 2 s, 7 s on an office PC)
// on every pull, in a browser tab not on screen too. Here the tab works them out again only while the page is on the
// screen, and at most once in CATCH_MS for each; meanwhile it says it will (the same words), and is drawn again then.
/* global TallyRead, render */
export const CATCH_MS = 5000;
const WORDS = "Tally has changed since this was worked out; working it out again\u2026";
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
// "" nothing to work out; else the words to show while it is worked out (now, or once seen and CATCH_MS after the last)
export function catchSoon(b, k) {
  if (!b || !(b.stale || {})[k]) return "";
  const now = Date.now(), wait = CATCH_MS - (now - (last[k] || 0));
  if (typeof document === "object" && document.hidden) { whenSeen(); return WORDS; }
  if (wait > 0) { again(k, wait); return WORDS; }
  const t = TallyRead.catchUp(b, k);
  if (t) last[k] = now;
  return t;
}
