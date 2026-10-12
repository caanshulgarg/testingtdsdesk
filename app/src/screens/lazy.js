// Screens loaded when first needed (stability batch 2, route-level code splitting): the first open sends Today, Clients,
// the Overview and Purchase with the app; the books (TDS, GST, MIS, Audit, …), Bank, Sales, Post to Tally, Settings, Tally
// and Help come in their own files, fetched as soon as the app has drawn its first page (preloadScreens, main.jsx) or
// at once when their page is the one opened.
// A screen whose file is here draws at once, in the same drawing as before (no wait, no second frame); one still on its
// way shows the page's shape (Main.jsx: <Suspense fallback={<PageSkeleton/>}>) and the page is drawn again when it comes.
import { createElement } from "react";
import { FinComNav } from "../nav.js";

const loaders = [];
// reliability item 4: a file that could not be fetched is fetched once more by itself, after a short wait (a dropped
// line, a moment of the site being republished); when that fails too, the screen's crash wall offers Reload FinCom
const RETRY_MS = 700;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export function lazyModule(load) {
  let mod = null, failed = null, p = null;
  const get = () => p || (p = load().catch(() => wait(RETRY_MS).then(load)).then((m) => {
    mod = m; failed = null;
    // drawn again in full (the old screens' finishing touches too: the tables' funnels, the guide), as any change is
    try { if (window.S && S.firm && typeof window.render === "function") window.render(); } catch (e) { /* the next drawing shows it */ }
  }, (e) => {
    failed = e instanceof Error ? e : new Error(String(e)); failed.fincomLoad = true;
    try { if (typeof window.render === "function") window.render(); } catch (x) { /* */ }
  }));
  loaders.push(get);
  return (name = "default") => {
    function Lazy(props) {
      if (mod) return createElement(mod[name], props);
      // the file could not be fetched twice (no internet, or FinCom was updated meanwhile): the screen's crash wall
      // (Guard.jsx, parts/CrashWall.jsx) says so and offers Reload FinCom
      if (failed) throw failed;
      // the thin bar under the top bar while it comes (stability batch 3)
      const p = get(); if (!p.tracked) { p.tracked = true; FinComNav.track(p); }
      throw p;
    }
    Lazy.displayName = "Lazy(" + name + ")";
    return Lazy;
  };
}
// every screen's file, fetched once the first page is drawn (the network is free by then: the program has loaded)
export function preloadScreens() { loaders.forEach((g) => { g().catch(() => {}); }); }
