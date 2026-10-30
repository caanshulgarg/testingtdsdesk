// 18-Oct-2026 (Sentry FINCOM-APP-STAGING-1, "Importing a module script failed" x3 from the owner's browser right after a
// publish; his Day Book upload then did nothing): a tab opened before a publish asks for a screen's file (a lazy chunk)
// the publish replaced. One handler for every way that shows: an error or unhandled rejection whose message is one of the
// browsers' words for it (Safari "Importing a module script failed", Chrome "Failed to fetch dynamically imported module",
// Firefox "error loading dynamically imported module", webpack-style ChunkLoadError), and the loaders' own failures
// (screens/lazy.js, Statements.jsx's FSX / FAR, loadRegisters) -> FinCom refreshes ONCE. The guard is this build's id in
// sessionStorage: a build reloads at most once in a tab, so it can never loop. Storage blocked: no reload.
// 19-Oct-2026 (round 90: the same words on the CURRENT build, Safari 26.6.2, the TDS page, again after every reload; the
// files were all there): the browser's own copy can be the broken one (the service worker's kept copy, or a dropped line).
//  - each failure is told to Sentry: a breadcrumb (category "chunk") and the tag "chunk", with the file's name (from the
//    error's words, else the loader's own file, else the newest file the browser could not fetch); kept over the reload;
//  - the refresh first clears FinCom's own copies: its service worker for this address is unregistered and its caches
//    (fincom-shell:…, fincom-files:…) deleted, then "FinCom is refreshing its files…" and one reload;
//  - after that the page says so with "Reload FinCom" and "Open without saved files" (the same clean-up, then a reload:
//    cleanReload), asked by the person, never by itself.
// Vite's vite:preloadError is only told to Sentry here: the error goes on to its loader, which tries once more in the page
// (screens/lazy.js) before any reload.
// Safari 14 safe: plain string tests, no regex lookbehind, no optional chaining in what the build keeps.
const KEY = "fincom:stale-reload", LAST = "fincom:chunk-failed";
const WORDS = ["importing a module script failed", "failed to fetch dynamically imported module", "error loading dynamically imported module", "chunkloaderror", "loading chunk", "unable to preload css", "failed to load module script"];
const build = () => (typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev");

export function isStaleChunk(e) {
  if (!e) return false;
  let t = "";
  try { t = (String(e.name || "") + " " + String(e.message || "") + " " + (typeof e === "string" ? e : "")).toLowerCase(); } catch (x) { return false; }
  for (let i = 0; i < WORDS.length; i++) if (t.indexOf(WORDS[i]) >= 0) return true;
  return false;
}

// a file's name only (Books-CE9NmnME.js), never its address
const FILE = /([A-Za-z0-9_.-]{1,80}\.(?:m?js|css))(?:[?#][^\s"')]*)?/;
export function fileName(u) {
  if (!u) return "";
  const s = String(u).split("?")[0].split("#")[0], m = s.slice(s.lastIndexOf("/") + 1).match(/^[A-Za-z0-9_.-]{1,80}\.(?:m?js|css)$/);
  return m ? m[0] : "";
}
// the failing file: named in the error's words (Chrome, Firefox, Vite's "Unable to preload CSS for …"), else the loader's
// own file (hint), else the newest of FinCom's files the browser could not fetch (Safari's words name no file)
export function failedFile(e, hint) {
  try {
    const t = String((e && (e.message || (typeof e === "string" ? e : ""))) || ""), m = t.match(/(?:https?:\/\/|\.{0,2}\/)[^\s"')]*?\.(?:m?js|css)\b/) || t.match(FILE);
    const f = m && fileName(m[0]); if (f) return f;
  } catch (x) { /* */ }
  if (hint) { const f = fileName(hint); if (f) return f; }
  try {
    const es = performance.getEntriesByType("resource");
    for (let i = es.length - 1; i >= 0; i--) {
      const r = es[i], n = String(r.name || "");
      if (n.indexOf("/assets/") < 0 || !/\.(?:m?js|css)(?:\?|$)/.test(n)) continue;
      const st = typeof r.responseStatus === "number" ? r.responseStatus : -1;
      if (st >= 400 || (st <= 0 && !r.transferSize && !r.decodedBodySize && !r.encodedBodySize)) return fileName(n);
    }
  } catch (x) { /* */ }
  return "";
}

// to Sentry (src/sentry.js; kept in main.jsx until it starts): a breadcrumb and the tag. step: retry | healed | refresh | preload_error | prefetch_failed | clean_reload |
// failed | after_refresh
export function tellChunk(step, file, more) {
  const data = { file: file || "unknown" };
  if (more) for (const k in more) data[k] = more[k];
  try { if (typeof window.__fincomCrumb === "function") window.__fincomCrumb("chunk", step, data); } catch (x) { /* */ }
  try { if (typeof window.__fincomTag === "function") window.__fincomTag("chunk", data.file); } catch (x) { /* */ }
}

function say(text) {
  try {
    const old = document.querySelector("[data-stale-reload]");
    if (old) { old.textContent = text; return; }
    const d = document.createElement("div");
    d.setAttribute("data-stale-reload", ""); d.setAttribute("role", "status");
    d.className = "stale-reload";
    d.textContent = text;
    (document.body || document.documentElement).appendChild(d);
  } catch (e) { /* the reload still comes */ }
}

// FinCom's own copies of its files at this address: its service worker unregistered, its caches deleted (2.5 s at most)
export function clearFiles() {
  const here = new URL("./", location.href), path = here.pathname;
  const work = [];
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      work.push(navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.filter((r) => r.scope === here.href).map((r) => r.unregister()))));
    }
  } catch (e) { /* no workers here */ }
  try {
    if (typeof caches !== "undefined") {
      work.push(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.indexOf("fincom-shell:" + path + ":") === 0 || k === "fincom-files:" + path).map((k) => caches.delete(k)))));
    }
  } catch (e) { /* no caches here */ }
  const all = Promise.all(work.map((p) => p.catch(() => {})));
  return Promise.race([all, new Promise((ok) => setTimeout(ok, 2500))]);
}
function remember(file) { try { sessionStorage.setItem(LAST, file || "unknown"); } catch (x) { /* */ } }
// the person's "Open without saved files": the same clean-up, then a reload
export function cleanReload(file) {
  tellChunk("clean_reload", file);
  say("FinCom is refreshing its files…");
  remember(file);
  return clearFiles().then(() => { try { location.reload(); } catch (x) { /* */ } });
}

// any: a loader's own failure (the file of a screen did not come), counted as stale whatever its words. hint: the
// loader's own file, for the report
let saidFailed = null;
export function staleReload(e, any, hint) {
  if (!any && !isStaleChunk(e)) return false;
  const file = failedFile(e, hint);
  let done = true;
  try { done = sessionStorage.getItem(KEY) === build(); if (!done) sessionStorage.setItem(KEY, build()); } catch (x) { done = true; }
  if (done) { if (saidFailed !== file) { saidFailed = file; tellChunk("failed", file); } return false; }
  tellChunk("refresh", file);
  remember(file);
  window.__fincomStaleReload = (window.__fincomStaleReload || 0) + 1;
  say("FinCom is refreshing its files…");
  setTimeout(() => { clearFiles().then(() => { try { location.reload(); } catch (x) { /* */ } }); }, 400);
  return true;
}

let on = false;
export function watchStaleChunks() {
  if (on) return; on = true;
  // after a refresh: which file it was for, told again (the breadcrumb before the reload never reached Sentry)
  // (once main.jsx has set up the queue that keeps it until Sentry starts)
  try { const f = sessionStorage.getItem(LAST); if (f) { sessionStorage.removeItem(LAST); setTimeout(() => tellChunk("after_refresh", f), 0); } } catch (x) { /* */ }
  window.addEventListener("vite:preloadError", (ev) => { tellChunk("preload_error", failedFile(ev && ev.payload)); });
  window.addEventListener("unhandledrejection", (ev) => { if (staleReload(ev && ev.reason)) { try { ev.preventDefault(); } catch (x) { /* */ } } });
  window.addEventListener("error", (ev) => { if (staleReload((ev && ev.error) || (ev && ev.message))) { try { ev.preventDefault(); } catch (x) { /* */ } } });
}
watchStaleChunks();
