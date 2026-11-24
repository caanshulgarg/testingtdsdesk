// "New look" (phase 1 of docs/UX-QUICKBOOKS-OF-INDIA.md): a switch per person, off unless turned on, kept like the other
// choices of a person (the rows' density, parts/density.js: localStorage fincom:newlook:<email>; blocked storage: kept
// while the page is open). Only this switch is in the app's first file; everything the new look draws comes in its own
// files (newlook/*.jsx), fetched only while it is on. Off, every page is exactly as before.
const key = () => "fincom:newlook:" + ((typeof S === "object" && S && S.account && S.account.me && S.account.me.email) || "local");
const mem = {};
export function newLook() {
  const k = key();
  if (!(k in mem)) { let v = null; try { v = localStorage.getItem(k); } catch (e) { v = null; } mem[k] = v === "on"; }
  return mem[k];
}
export function setNewLook(on) {
  const k = key(); mem[k] = !!on;
  try { localStorage.setItem(k, on ? "on" : "off"); } catch (e) { /* kept while the page is open */ }
  if (typeof render === "function") render();
}
// the five status words (New · To review · Ready · Done · Problem) for the states of the upload pages' row of states
export const NL_STATE = { review: "To review", ready: "Ready", errors: "Problem", intally: "Done", ignored: "Set aside", rejected: "Problem · no entry", duplicate: "To review · repeats" };
// the new menu's items, put here by the new look's file once it has come (newlook/Shell.jsx)
export const nlTree = () => (newLook() && window.__nlTree ? window.__nlTree() : null);
if (typeof window === "object") window.FCNewLook = { on: newLook, set: setNewLook };
