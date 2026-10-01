// A new build loads by itself (review of 01-Oct-2026: after a republish the browser kept the old index.html until a hard
// refresh). build.json, fetched past every cache, names the current build: on opening, an older page loads the new one
// once (by a new address, so no cache can answer); later, while the page stays open, a note offers to reload.
const KEY = "fincom-reloaded-for";
async function current() {
  try {
    const r = await fetch("build.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.build ? j.build : null;
  } catch (e) { return null; }
}
function note(build) {
  if (document.getElementById("fresh-note")) return;
  const d = document.createElement("div");
  d.id = "fresh-note"; d.setAttribute("role", "status");
  d.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:90;background:#064E3B;color:#fff;padding:10px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:14px";
  d.innerHTML = 'A newer FinCom is out. <button style="margin-left:10px" class="btn small">Reload</button>';
  d.querySelector("button").onclick = () => go(build);
  document.body.appendChild(d);
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
  if (onOpen && tried !== build) go(build); else note(build);
}
export function watchFresh() {
  checkFresh(true);
  setInterval(() => checkFresh(false), 10 * 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkFresh(false); });
}
