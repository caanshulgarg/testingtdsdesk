// Screens loaded when first needed (stability batch 2, route-level code splitting): the first open sends Today, Clients,
// the Overview and Purchase with the app; the books (TDS, GST, MIS, Audit, …), Bank, Sales, Post to Tally, Settings, Tally
// and Help come in their own files, fetched as soon as the app has drawn its first page (preloadScreens, main.jsx) or
// at once when their page is the one opened.
// A screen whose file is here draws at once, in the same drawing as before (no wait, no second frame); one still on its
// way shows the page's shape (Main.jsx: <Suspense fallback={<PageSkeleton/>}>) and the page is drawn again when it comes.
import { createElement } from "react";
import { FinComNav } from "../nav.js";

const loaders = [];
// round 64 (the owner's Safari, 16-Oct-2026: "This page could not be loaded" on GB TEXCOAT's TDS, nothing in Sentry): a
// page's file that could not be fetched once stays failed for the whole visit (the browser keeps the failed module; asking
// again does not fetch it again), so one network blip, or a file of a build published meanwhile, left TDS, GST, MIS,
// Accounts and Audit dead until a reload. Now: the failure goes to the console and to Sentry (staging build; the error and
// the file's name only, never the firm's data), and the page reloads by itself, once in two minutes (the address keeps
// the page); after that the note and its Reload button as before
const RELOAD_KEY = "fincom:pageFileReload";
function pageFileFailed(e, shown) {
  try { console.error("[FinCom] a page's file could not be loaded:", e); } catch (x) { /* */ }
  try { if (typeof window.__fincomReport === "function") window.__fincomReport(e instanceof Error ? e : new Error(String(e)), "page file not loaded"); } catch (x) { /* */ }
  if (!shown) return false;              // fetched ahead in the background: tried again when its page is opened
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch (x) { return false; }
  if (Date.now() - last < 120000) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (x) { return false; }
  try { location.reload(); return true; } catch (x) { return false; }
}
export function lazyModule(load) {
  let mod = null, failed = null, p = null, shown = false;
  const get = () => p || (p = load().then((m) => {
    mod = m; failed = null;
    // drawn again in full (the old screens' finishing touches too: the tables' funnels, the guide), as any change is
    try { if (window.S && S.firm && typeof window.render === "function") window.render(); } catch (e) { /* the next drawing shows it */ }
  }, (e) => { p = null; if (pageFileFailed(e, shown) || !shown) return; failed = e; try { if (typeof window.render === "function") window.render(); } catch (x) { /* */ } }));
  loaders.push(get);
  return (name = "default") => {
    function Lazy(props) {
      if (mod) return createElement(mod[name], props);
      // the file could not be fetched (no internet, or FinCom was updated meanwhile): say so, with a way out
      if (failed) return createElement("p", { className: "note", "data-lazy-failed": "" }, "This page could not be loaded. ",
        createElement("button", { className: "linkbtn", onClick: () => { failed = null; location.reload(); } }, "Reload FinCom"));
      // the thin bar under the top bar while it comes (stability batch 3)
      shown = true;
      const p = get(); if (!p.tracked) { p.tracked = true; FinComNav.track(p); }
      throw p;
    }
    Lazy.displayName = "Lazy(" + name + ")";
    return Lazy;
  };
}
// every screen's file, fetched once the first page is drawn (the network is free by then: the program has loaded)
export function preloadScreens() { loaders.forEach((g) => { g().catch(() => {}); }); }
