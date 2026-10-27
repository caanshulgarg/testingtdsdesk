// Screens loaded when first needed (stability batch 2, route-level code splitting): the first open sends Today, Clients,
// the Overview and Purchase with the app; the books (TDS, GST, MIS, Audit, …), Bank, Sales, Post to Tally, Settings, Tally
// and Help come in their own files, fetched as soon as the app has drawn its first page (preloadScreens, main.jsx) or
// at once when their page is the one opened.
// A screen whose file is here draws at once, in the same drawing as before (no wait, no second frame); one still on its
// way shows the page's shape (Main.jsx: <Suspense fallback={<PageSkeleton/>}>) and the page is drawn again when it comes.
import { createElement } from "react";
import { FinComNav } from "../nav.js";
import { staleReload, isStaleChunk, failedFile, tellChunk, cleanReload } from "../staleChunk.js";

// 19-Oct-2026 (round 90: Safari's "Importing a module script failed" on the TDS page, the files all there): a file that did
// not come is asked for once more in the page before FinCom refreshes. The browser keeps a failed file's failure for the
// page (the same import fails again at once, without asking the line), so the second ask goes to the same file with
// "?retry=…" (a new address: past that failure and past any broken copy the service worker holds). The file's address
// is read from the loader (Vite's `import("./Books-….js")`, next to this file); a loader that does more than import a
// file (`.then(...)`) is simply called again.
export function loaderFile(load) {
  try {
    const t = String(load), m = t.match(/import\(\s*["'`]([^"'`]+)["'`]\s*\)(\s*\.)?/);
    return m ? { url: new URL(m[1], import.meta.url).href, plain: !m[2] } : null;
  } catch (e) { return null; }
}
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
function again(load, at, e) {
  const file = failedFile(e, at && at.url);
  // a code error in the file (not a file that did not come), or a style that did not come: not asked again here
  if (!isStaleChunk(e) || /unable to preload css/i.test(String((e && e.message) || ""))) return Promise.reject(e);
  tellChunk("retry", file);
  const next = at && at.plain ? () => import(/* @vite-ignore */ at.url + (at.url.indexOf("?") < 0 ? "?" : "&") + "retry=" + Date.now()) : load;
  return pause(300).then(next).then((m) => { tellChunk("healed", file); return m; }, () => { throw e; });
}

const loaders = [];
export function lazyModule(load) {
  let mod = null, failed = null, p = null;
  const at = loaderFile(load);
  const get = () => p || (p = load().catch((e) => again(load, at, e)).then((m) => {
    mod = m; failed = null;
    // drawn again in full (the old screens' finishing touches too: the tables' funnels, the guide), as any change is
    try { if (window.S && S.firm && typeof window.render === "function") window.render(); } catch (e) { /* the next drawing shows it */ }
  }, (e) => {
    failed = e; p = null;
    // 16-Oct-2026 (the owner's TDS page on Safari): say why in the console and report it (Sentry takes uncaught errors),
    // and reload FinCom once by itself (a browser holding an older copy of the program gets the new one). 18-Oct-2026:
    // once per BUILD (src/staleChunk.js), not once per tab: the guard of "fincom:lazy-reloaded" stopped the reload after
    // the second publish of a day, and the owner's tab was left asking for files that were gone
    try { console.error("FinCom: a page's program file could not be loaded:", e); } catch (x) { /* */ }
    if (staleReload(e, true, at && at.url)) return;
    setTimeout(() => { throw (e instanceof Error ? e : new Error("FinCom page file not loaded: " + String(e))); }, 0);
    try { if (typeof window.render === "function") window.render(); } catch (x) { /* */ }
  }));
  loaders.push(get);
  return (name = "default") => {
    function Lazy(props) {
      if (mod) return createElement(mod[name], props);
      // the file could not be fetched (no internet, or FinCom was updated meanwhile): say so, with two ways out (round 90:
      // "Open without saved files" clears FinCom's own copies of its files first: src/staleChunk.js)
      if (failed) return createElement("p", { className: "note", "data-lazy-failed": "" }, "This page could not be loaded" + (failed && failed.message ? " (" + String(failed.message).slice(0, 160) + ")" : "") + ". ",
        createElement("button", { className: "linkbtn", onClick: () => { failed = null; location.reload(); } }, "Reload FinCom"), " · ",
        createElement("button", { className: "linkbtn", "data-clean-reload": "", onClick: () => { cleanReload(failedFile(failed, at && at.url)); } }, "Open without saved files"));
      // the thin bar under the top bar while it comes (stability batch 3)
      const p = get(); if (!p.tracked) { p.tracked = true; FinComNav.track(p); }
      throw p;
    }
    Lazy.displayName = "Lazy(" + name + ")";
    return Lazy;
  };
}
// every screen's file, fetched once the first page is drawn (the network is free by then: the program has loaded)
// speed round (27-Oct-2026, staging: 50 script files and 9 styles, 1 MB, all at once right after the first page, on the
// same line as the person's first clicks and the firm's data): two at a time, and none ahead on a slow line or one that
// saves data (lineSlow): there a screen's file comes when its page is opened
export function lineSlow() {
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g|3g/.test(String(c.effectiveType || "")) || (c.downlink > 0 && c.downlink < 1.5))) return true;
    // what this open measured: the program (legacy.js, about 600 KB) came at under 150 KB a second
    const e = performance.getEntriesByType("resource").find((x) => /\/legacy[^/]*\.js(\?|$)/.test(x.name) && x.encodedBodySize > 100000);
    return !!(e && e.responseEnd - e.responseStart > 0 && e.encodedBodySize / ((e.responseEnd - e.responseStart) / 1000) < 150000);
  } catch (e) { return false; }
}
export function preloadScreens() {
  if (lineSlow()) return;
  const q = loaders.slice();
  const next = () => { const g = q.shift(); if (g) g().catch(() => {}).then(next); };
  next(); next();
}
