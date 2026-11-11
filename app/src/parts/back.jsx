// "← Back" (the owner, 11-Nov-2026: "there is no Back button to return to the previous page"): every page reached from
// another has one in the page header, and the error box has one too (Guard.jsx). Back is the browser's own step back
// while this tab has moved within FinCom (Route.sync, src/js/52, makes each page a step in the history); with no step to
// go back to (a page opened from a link, a reload), the page above it: a return's or a report's page → its tab, a
// client's page → the client's Overview, the Overview → Clients, a section of Settings → Settings, Tally's and
// Integrations' own pages → theirs, any other firm page → Today. Today and Clients have none.
/* global Route, render */
let steps = 0;
if (typeof window === "object" && window.history && !window.__fcBack) {
  window.__fcBack = true;
  const push = window.history.pushState.bind(window.history);
  window.history.pushState = function () { steps++; return push.apply(null, arguments); };
  // (a step forward is counted down too: the safe way, the page above is used sooner, never a page outside FinCom)
  window.addEventListener("popstate", () => { if (steps > 0) steps--; });
}

export function parentOf(h) {
  h = String(h || "").replace(/\?.*$/, "");
  let m;
  if ((m = h.match(/^#\/c\/([^/]+)\/books\/([^/]+)\/./))) return "#/c/" + m[1] + "/books/" + m[2];
  if ((m = h.match(/^#\/c\/([^/]+)\/bill\//))) return "#/c/" + m[1] + "/purchase/draft";
  if ((m = h.match(/^#\/c\/([^/]+)\/(.+)$/))) return /^dash\/?$/.test(m[2]) ? "#/clients" : "#/c/" + m[1] + "/dash";
  if ((m = h.match(/^#\/(settings|tally|integrations)\/./))) return "#/" + m[1];
  if (!h || /^#\/(today|clients)\/?$/.test(h)) return "";
  return "#/today";
}
const here = () => (typeof Route === "object" && Route.of ? Route.of() : String(location.hash || ""));
export const canGoBack = () => steps > 0 || !!parentOf(here());

export function goBack() {
  if (steps > 0) { window.history.back(); return; }
  const p = parentOf(here());
  if (!p || typeof Route !== "object") return;
  // the page above takes this page's place in the history (no step back to the page left)
  Route.replaceNext = true;
  Promise.resolve(Route.apply(p)).then(() => { if (typeof render === "function") render(); window.scrollTo(0, 0); }, () => {});
}

export default function BackBtn({ className = "btn small", label = "← Back", ...rest }) {
  if (!canGoBack()) return null;
  return <button type="button" className={className} onClick={goBack} title="Back to the page before" {...rest}>{label}</button>;
}
