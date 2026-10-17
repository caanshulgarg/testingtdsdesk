// A new build loads by itself (review of 01-Oct-2026: after a republish the browser kept the old index.html until a hard
// refresh). build.json, fetched past every cache, names the current build: on opening, an older page loads the new one
// once (by a new address, so no cache can answer); later, while the page stays open, a calm bar offers to reload.
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
// quiet refresh (owner, 14-Oct-2026): never a reload while someone works, and no message that keeps coming back. A calm
// bar at the foot of the page (17-Oct-2026: "A new version of FinCom is ready · Reload"), staying until it is pressed; the
// page loads the new build by itself only when it is not in use: the tab hidden for HIDDEN_MS, with nothing unsaved
// (unsavedWork below) and no box left half typed in
let noted = null, hiddenTimer = 0, going = false;
const HIDDEN_MS = 5 * 60000;
function note(build) {
  noted = build;
  let d = document.querySelector("[data-new-version]");
  if (!d) {
    d = document.createElement("div");
    d.setAttribute("data-new-version", ""); d.setAttribute("role", "status"); d.setAttribute("aria-live", "polite"); d.className = "new-version-bar";
    d.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:90;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);box-sizing:border-box;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#D5DBD8);padding:6px 6px 6px 14px;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:13px";
    d.innerHTML = '<span data-new-version-text="">A new version of FinCom is ready</span><span aria-hidden="true">·</span><button type="button" class="btn small" data-new-version-go="">Reload</button>';
    document.body.appendChild(d);
  }
  d.querySelector("button").onclick = () => reloadNow(d);
}
// Reload pressed: what is waiting to be saved is saved first (the same path as hiding the tab, src/js/27
// flushBillSavesAndSend), and the page waits for those saves (a few seconds at most); a page with unsaved changes
// (Drafts) still asks before it goes (its own beforeunload)
async function reloadNow(d) {
  if (going) return; going = true;
  try { if (typeof flushBillSavesAndSend === "function") flushBillSavesAndSend(); } catch (e) { /* the page's own save on leaving still runs */ }
  const t0 = Date.now();
  if (unsavedWork()) {
    const t = d && d.querySelector("[data-new-version-text]"); if (t) t.textContent = "Saving your work first…";
    while (Date.now() - t0 < 8000 && unsavedWork() && !(typeof Drafts === "object" && Drafts.anyDirty())) await new Promise((ok) => setTimeout(ok, 250));
  }
  going = false;
  go(noted);
}
function halfTyped() {
  try {
    const a = document.activeElement;
    return !!(a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && !/^(button|submit|checkbox|radio|file|range|color)$/i.test(a.type)) || a.isContentEditable) && (a.value || a.textContent || "").trim());
  } catch (e) { return true; }
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
  hiddenTimer = setTimeout(() => { if (noted && document.visibilityState === "hidden" && !unsavedWork() && !halfTyped()) go(noted); }, HIDDEN_MS);
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
  // a slow line). The page is checked before the big files by index.html's own little script (with or without the
  // service worker, 17-Oct-2026). What is left: the quiet note
  if (onOpen && tried !== build && !document.querySelector("#app .react-host")) go(build); else note(build);
}
// 17-Oct-2026 (the owner had to press Ctrl+Shift+R): an open tab looks every minute, and at once when it comes back
// (shown again, or the window focused); never more often than every 5 s
let lastCheck = 0;
function checkSoon() {
  if (Date.now() - lastCheck < 5000) return;
  lastCheck = Date.now(); checkFresh(false);
}
export function watchFresh() {
  // the address the swap used (?v=this build) back to the plain one, so a bookmark or the next open asks as usual
  try {
    const u = new URL(location.href);
    if (typeof __BUILD_ID__ !== "undefined" && u.searchParams.get("v") === __BUILD_ID__) { u.searchParams.delete("v"); history.replaceState(history.state, "", u.toString()); }
  } catch (e) { /* the address stays as it is */ }
  lastCheck = Date.now(); checkFresh(true);
  document.addEventListener("visibilitychange", whenHidden);
  // a new build's service worker took over this page: say so (the page still runs the build it opened with)
  try { navigator.serviceWorker.addEventListener("controllerchange", () => checkFresh(false)); } catch (e) { /* no workers here */ }
  setInterval(() => { lastCheck = Date.now(); checkFresh(false); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkSoon(); });
  window.addEventListener("focus", checkSoon);
}
