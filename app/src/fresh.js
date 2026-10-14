// A new build loads by itself (review of 01-Oct-2026: after a republish the browser kept the old index.html until a hard
// refresh). build.json, fetched past every cache, names the current build: on opening, an older page loads the new one
// once (by a new address, so no cache can answer); later, while the page stays open, a small chip offers to reload.
const KEY = "fincom-reloaded-for";
async function current() {
  // no line: no check (it could only fail; stability batch 6), the next one runs when the page is shown again
  if (typeof navigator === "object" && navigator.onLine === false) return null;
  try {
    const r = await fetch("build.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.build ? j.build : null;
  } catch (e) { return null; }
}
// quiet refresh (owner, 14-Oct-2026): never a reload while someone works, and no message that keeps coming back. A small
// chip at the foot of the page, "New version – Refresh", staying until it is pressed; the page loads the new build by
// itself only when it is not in use: the tab hidden for HIDDEN_MS, with nothing unsaved (unsavedWork below)
let noted = null, hiddenTimer = 0;
const HIDDEN_MS = 5 * 60000;
function note(build) {
  noted = build;
  let d = document.querySelector("[data-new-version]");
  if (!d) {
    d = document.createElement("div");
    d.setAttribute("data-new-version", ""); d.setAttribute("role", "status"); d.className = "new-version-chip";
    d.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:90;display:flex;align-items:center;gap:8px;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#D5DBD8);padding:4px 6px 4px 12px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:13px";
    d.innerHTML = '<span>New version</span><button type="button" class="btn small" data-new-version-go="">Refresh</button>';
    document.body.appendChild(d);
  }
  d.querySelector("button").onclick = () => go(noted);
}
// something not yet saved here: a save on its way or failed, a change not yet sent to the firm's cloud, a page with
// unsaved changes (Drafts), a bill being read. Any doubt counts as unsaved
export function unsavedWork() {
  try {
    if (typeof Live === "object" && Live.sv && Live.sv.state && Live.sv.state !== "saved") return true;
    if (typeof cloudChanges === "function" && typeof Cloud === "object" && Cloud.on() && cloudChanges().changes.length) return true;
    if (typeof Drafts === "object" && Drafts.anyDirty()) return true;
    if (typeof BookItems === "object" && Object.values(BookItems.st || {}).some((x) => x && x.timer)) return true;
    if (typeof S === "object" && (S.jobs || []).some((j) => ["waiting", "checking", "reading"].includes(j.status))) return true;
    return false;
  } catch (e) { return true; }
}
function whenHidden() {
  clearTimeout(hiddenTimer);
  if (!noted || document.visibilityState !== "hidden") return;
  hiddenTimer = setTimeout(() => { if (noted && document.visibilityState === "hidden" && !unsavedWork()) go(noted); }, HIDDEN_MS);
}
function go(build) {
  try { sessionStorage.setItem(KEY, build); } catch (e) { /* private window */ }
  const u = new URL(location.href); u.searchParams.set("v", build);
  location.replace(u.toString());
}
export async function checkFresh(onOpen) {
  if (typeof __BUILD_ID__ === "undefined" || location.protocol === "file:") return;
  const build = await current();
  if (!build || build === __BUILD_ID__) return;
  let tried = null; try { tried = sessionStorage.getItem(KEY); } catch (e) { /* private window */ }
  // stability batch 4: never a second load after the app has loaded (that loaded everything twice after each release on
  // a slow line). The page is checked before the big files by index.html's own little script when no service worker
  // serves it; with the worker the page itself always comes from the network first. What is left: the quiet note
  if (onOpen && tried !== build && !document.querySelector("#app .react-host")) go(build); else note(build);
}
export function watchFresh() {
  checkFresh(true);
  document.addEventListener("visibilitychange", whenHidden);
  // a new build's service worker took over this page: say so (the page still runs the build it opened with)
  try { navigator.serviceWorker.addEventListener("controllerchange", () => checkFresh(false)); } catch (e) { /* no workers here */ }
  setInterval(() => checkFresh(false), 10 * 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkFresh(false); });
}
