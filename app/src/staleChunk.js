// 18-Oct-2026 (Sentry FINCOM-APP-STAGING-1, "Importing a module script failed" x3 from the owner's browser right after a
// publish; his Day Book upload then did nothing): a tab opened before a publish asks for a screen's file (a lazy chunk)
// the publish replaced. One handler for every way that shows: Vite's vite:preloadError, an error or unhandled rejection
// whose message is one of the browsers' words for it (Safari "Importing a module script failed", Chrome "Failed to fetch
// dynamically imported module", Firefox "error loading dynamically imported module", webpack-style ChunkLoadError), and
// the loaders' own failures (screens/lazy.js, Statements.jsx's FSX / FAR, loadRegisters) -> FinCom is reloaded ONCE,
// saying "FinCom was updated; reloading…". The guard is this build's id in sessionStorage: a build reloads at most once
// in a tab, so it can never loop (the next build may reload once more, after the next publish). Storage blocked: no reload.
// Safari 14 safe: plain string tests, no regex lookbehind, no optional chaining in what the build keeps.
const KEY = "fincom:stale-reload";
const WORDS = ["importing a module script failed", "failed to fetch dynamically imported module", "error loading dynamically imported module", "chunkloaderror", "loading chunk", "unable to preload css", "failed to load module script"];
const build = () => (typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev");

export function isStaleChunk(e) {
  if (!e) return false;
  let t = "";
  try { t = (String(e.name || "") + " " + String(e.message || "") + " " + (typeof e === "string" ? e : "")).toLowerCase(); } catch (x) { return false; }
  for (let i = 0; i < WORDS.length; i++) if (t.indexOf(WORDS[i]) >= 0) return true;
  return false;
}

function say() {
  try {
    if (document.querySelector("[data-stale-reload]")) return;
    const d = document.createElement("div");
    d.setAttribute("data-stale-reload", ""); d.setAttribute("role", "status");
    d.className = "stale-reload";
    d.textContent = "FinCom was updated; reloading…";
    (document.body || document.documentElement).appendChild(d);
  } catch (e) { /* the reload still comes */ }
}

// any: a loader's own failure (the file of a screen did not come), counted as stale whatever its words
export function staleReload(e, any) {
  if (!any && !isStaleChunk(e)) return false;
  let done = true;
  try { done = sessionStorage.getItem(KEY) === build(); if (!done) sessionStorage.setItem(KEY, build()); } catch (x) { done = true; }
  if (done) return false;
  window.__fincomStaleReload = (window.__fincomStaleReload || 0) + 1;
  say();
  setTimeout(() => { try { location.reload(); } catch (x) { /* */ } }, 400);
  return true;
}

let on = false;
export function watchStaleChunks() {
  if (on) return; on = true;
  window.addEventListener("vite:preloadError", (ev) => { if (staleReload(ev && ev.payload, true)) { try { ev.preventDefault(); } catch (x) { /* */ } } });
  window.addEventListener("unhandledrejection", (ev) => { if (staleReload(ev && ev.reason)) { try { ev.preventDefault(); } catch (x) { /* */ } } });
  window.addEventListener("error", (ev) => { if (staleReload((ev && ev.error) || (ev && ev.message))) { try { ev.preventDefault(); } catch (x) { /* */ } } });
}
watchStaleChunks();
