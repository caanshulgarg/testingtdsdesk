// Screens loaded when first needed (stability batch 2, route-level code splitting): the first open sends Today, Clients,
// the Overview and Purchase with the app; the books (TDS, GST, MIS, Audit, …), Bank, Sales, Post to Tally, Settings, Tally
// and Help come in their own files, fetched as soon as the app has drawn its first page (preloadScreens, main.jsx) or
// at once when their page is the one opened.
// A screen whose file is here draws at once, in the same drawing as before (no wait, no second frame); one still on its
// way shows the page's shape (Main.jsx: <Suspense fallback={<PageSkeleton/>}>) and the page is drawn again when it comes.
import { createElement } from "react";

const loaders = [];
export function lazyModule(load) {
  let mod = null, failed = null, p = null;
  const get = () => p || (p = load().then((m) => {
    mod = m; failed = null;
    // drawn again in full (the old screens' finishing touches too: the tables' funnels, the guide), as any change is
    try { if (window.S && S.firm && typeof window.render === "function") window.render(); } catch (e) { /* the next drawing shows it */ }
  }, (e) => { failed = e; p = null; try { if (typeof window.render === "function") window.render(); } catch (x) { /* */ } }));
  loaders.push(get);
  return (name = "default") => {
    function Lazy(props) {
      if (mod) return createElement(mod[name], props);
      // the file could not be fetched (no internet, or FinCom was updated meanwhile): say so, with a way out
      if (failed) return createElement("p", { className: "note", "data-lazy-failed": "" }, "This page could not be loaded. ",
        createElement("button", { className: "linkbtn", onClick: () => { failed = null; location.reload(); } }, "Reload FinCom"));
      throw get();
    }
    Lazy.displayName = "Lazy(" + name + ")";
    return Lazy;
  };
}
// every screen's file, fetched once the first page is drawn (the network is free by then: the program has loaded)
export function preloadScreens() { loaders.forEach((g) => { g().catch(() => {}); }); }
