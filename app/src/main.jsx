// first of all: a screen's file replaced by a publish while this tab was open reloads FinCom once (src/staleChunk.js)
import { staleReload } from "./staleChunk.js";
import { createRoot } from "react-dom/client";
// Arc's typefaces, bundled with the app (no font is fetched from elsewhere): Inter for text, Geist for headings
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "./styles/index.css";
import "./parts/dismiss.js";
import App from "./App.jsx";
import { adopt } from "./store.js";
import { createElement, useSyncExternalStore } from "react";
import * as ReactAll from "react";
// next-fix-books-crash (the owner, 25-Oct-2026: TDS, GST, MIS "crashing", then "took too long"): whether React is drawing
// a component at this moment (its hooks are live only then). A render React schedules itself (a screen's file arriving, a
// component's own state) does not go through drawReact's memoScope; perRender and Books.lines (src/js/01, 04) ask this to
// keep the figures for that drawing too (reactScope), not work out the TDS rows from every entry for each part asking
const reactInternals = ReactAll.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
window.__fincomReactRendering = () => { const h = reactInternals && reactInternals.H; return !!h && h.useState !== h.useEffect; };
import Guard from "./Guard.jsx";
import { subscribe, snapshot } from "./store.js";
import { flushSync } from "react-dom";
import { Gst9c } from "./screens/gst/Annual.jsx";
import { watchFresh } from "./fresh.js";
import { preloadScreens, lineSlow } from "./screens/lazy.js";
import "./nav.js";
// calls (stage 1, 23-Oct-2026): the way in only; the call screen is its own file, fetched when a call is opened
import { guestLink, startGuest, joinHash, memberHere, takeJoin } from "./calls/launch.js";
// t70: FinCom's corrections of a TDS return (the corrected Excel brought back), read by TDS.allRowsNow (src/js/09)
import "./lib/tdsEdit.js";
// the decision on each line of 2B reconciliation, one store (ITCDec; the old remarks and follow-up decisions read into it)
import "./lib/itcSync.js";
// next-itc-simple: the credit of GSTR-3B table 4 from the decisions in 2B reconciliation and the adjustments (wraps GSTR.threeBm)
import "./lib/itcFinal.js";
// next-gstr1-excel: FinCom's GSTR-1 corrections (an Excel brought back) laid over GSTR.toJson and 3B's 3.1 (wraps them).
// Its own file (the first file is at its size budget), fetched at once; the GST screen imports it too
import("./lib/gstr1Fix.js").then(() => { try { if (typeof S === "object" && S.books && S.books.r1Fix) render(); } catch (e) { /* drawn later */ } }).catch((e) => staleReload(e, true));
// next-24q-ready: the payroll read for the 24Q pages and TCloud.load (PayLoad, src/lib/payLoad.js)
import "./lib/payLoad.js";
// Post automatically: who approved and how, the run, the bell (lib/autopostBoot.js; the rules load when needed)
import { installAutopost } from "./lib/autopostBoot.js";
// the registers' and reconciliations' engine, loaded the first time it is needed (registersLoad, src/js/82-registers.js)
// fast-firstopen: a client's books new to this browser, brought in newest year first (lib/firstOpen.js; TCloud.load)
window.loadFirstOpen = () => import("./lib/firstOpen.js");
// the bridge follows the FinCom login using it (migration 115; TCloud.autoOwn)
window.loadBridgeFollow = () => import("./lib/bridgeFollow.js");
window.loadRegisters = () => import("./lib/registers.js").catch((e) => { staleReload(e, true); throw e; });
// ROUND 99: the financial statements' Excel and PDF (src/lib/finExport.js, FinSt with it), loaded the first time they
// are asked for. Until then FinXlsx / FinPdf load it and pass the call on; the PDF's window is opened at once (a pop-up
// opened after a wait is blocked) and filled when the module is in. A module that cannot be loaded rejects with
// e.finLoad (the page then says so; the PDF's empty window is closed)
window.loadFinExport = () => import("./lib/finExport.js").catch((e) => { staleReload(e, true); const x = e instanceof Error ? e : new Error(String(e)); x.finLoad = true; throw x; });
if (!window.FinXlsx) window.FinXlsx = { download: (fy, o) => window.loadFinExport().then((m) => m.FinXlsx.download(fy, o)), make: (fy, o) => window.loadFinExport().then((m) => m.FinXlsx.make(fy, o)) };
if (!window.FinPdf) window.FinPdf = { open: (fy, o) => { const w = window.open("", "_blank"); return window.loadFinExport().then((m) => m.FinPdf.open(fy, o, w), (e) => { try { if (w) w.close(); } catch (x) { /* */ } throw e; }); } };
// calm motion (src/arc/lib/calm-motion.js): every animation in the app takes Motion's reduced path
import { MotionConfig } from "motion/react";

// a screen as plain HTML, for printing (the GSTR-9C PDF is printed from its screen: gst9PackHtml in src/js/18)
const PRINTABLE = { Gst9c };
window.FinComReact.markup = (name, props) => {
  const el = document.createElement("div"), root = createRoot(el);
  flushSync(() => root.render(createElement(PRINTABLE[name], props || {})));
  const html = el.innerHTML; root.unmount(); return html;
};

// the one guard around the whole app (each part has its own inside): an error none of them caught shows a note, is
// reported (staging only, src/sentry.js), and the next redraw tries again
function Root() {
  const v = useSyncExternalStore(subscribe, snapshot);
  return <MotionConfig reducedMotion="always"><Guard name="the app" v={v}><App /></Guard></MotionConfig>;
}

function registerWorker() {
  try {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    let asked = null; try { asked = localStorage.getItem("fincom.sw"); } catch (e) { /* storage blocked */ }
    if (asked === "off" || (local && asked !== "on")) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    // round 73 B: the worker keeps only what the first page needs when it is installed; the rest of this build's files
    // once it is ready and the computer is idle again (sw/sw.js, "fincom:keep-rest")
    // speed round: not on a slow line (lineSlow, screens/lazy.js): there each file is kept when it is first used
    navigator.serviceWorker.ready.then((r) => idle(() => { try { if (r.active && !lineSlow()) r.active.postMessage("fincom:keep-rest"); } catch (e) { /* kept when first used */ } }, 10000)).catch(() => {});
  } catch (e) { /* never in the way of the page */ }
}
const idle = (f, t) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: t }) : setTimeout(f, Math.min(t, 1500)));
// round 73 B: the first page on screen (the frame drawn before the program gone: boot.js), or 10 s at most. What is not
// needed for it (error reports, the other screens' files, the service worker) waits for it, then for an idle moment: an
// idle moment came before React had drawn the page, and those files were fetched and run while it was being drawn
const firstPage = new Promise((ok) => {
  const t0 = Date.now(), look = () => (!document.querySelector("[data-boot-part]") || Date.now() - t0 > 10000 ? ok() : setTimeout(look, 100));
  look();
});
const afterFirstPage = (f, t) => firstPage.then(() => idle(f, t));

function start() {
  // next-timings: the time each kind of request to the cloud takes from here, and each opening of a client's books
  // (lib/timings.js, its own file: it watches the books at once and starts the rest a few seconds after the first page)
  import("./lib/timings.js").then((m) => m.boot(), () => {});
  // error reports to Sentry: in a test build only (never in a live build: the import is dropped), and src/sentry.js
  // starts only on staging.fincom.live (docs/sentry.md)
  // stability batch 2: loaded once the page is drawn and the computer is idle (it was 35 KB on the way of the first open);
  // an error before then is kept (window.__fincomEarly, below) and reported when it starts
  if (import.meta.env.MODE === "test" && __FINCOM_SENTRY__) {
    const early = window.__fincomEarly = [];
    // 18-Oct-2026: the steps of Books › From Tally as breadcrumbs (tallyCrumb, src/js/23), kept until Sentry starts
    const crumbs = window.__fincomCrumbsEarly = [];
    window.__fincomCrumb = (category, step, data) => { if (crumbs.length < 30) crumbs.push({ category, step, data, timestamp: Date.now() / 1000 }); };
    // 19-Oct-2026 (round 90): the tag of a screen's file that did not come (src/staleChunk.js), kept the same way
    const tags = window.__fincomTagsEarly = [];
    window.__fincomTag = (k, v) => { if (tags.length < 10) tags.push([k, v]); };
    const keep = (e) => { if (early.length < 10) early.push(e && (e.reason || e.error) ? (e.reason || e.error) : e); };
    window.addEventListener("error", keep); window.addEventListener("unhandledrejection", keep);
    afterFirstPage(() => import("./sentry.js").then((m) => { window.removeEventListener("error", keep); window.removeEventListener("unhandledrejection", keep); m.start(); }).catch(() => {}), 3000);
  }
  adopt();
  try { installAutopost(); } catch (e) { /* never in the way of the page */ }
  createRoot(document.getElementById("react-root")).render(<Root />);
  watchFresh();
  // the other screens' files (screens/lazy.js), fetched once the first page is up
  afterFirstPage(preloadScreens, 1200);
  // stability batch 4: the service worker (sw/sw.js) keeps the app's own files on this computer: instant second opens,
  // FinCom without a line. On the site only (staging.fincom.live, the live site); on a test's local server only when
  // asked for (localStorage "fincom.sw" = "on"), so the tests see the network as before
  afterFirstPage(registerWorker, 4000);
  // the line going and coming back: said in the sidebar's quiet line at once ("No internet · work kept on this computer")
  const redrawNow = () => { try { if (window.S && S.firm && typeof window.render === "function") window.render(); } catch (e) { /* the next drawing shows it */ } };
  window.addEventListener("online", redrawNow); window.addEventListener("offline", redrawNow);
  // t70: a <details> menu (.bk-menu-list, right-aligned to its button) whose button sits near the left edge opened past
  // the window's left side (the Post page's More with the narrower sidebar): when opened, it is kept inside the window
  document.addEventListener("toggle", (ev) => {
    const d = ev.target;
    if (!d || d.tagName !== "DETAILS" || !d.open) return;
    const m = d.querySelector(":scope > .bk-menu-list");
    if (!m) return;
    m.style.left = ""; m.style.right = "";
    const r = m.getBoundingClientRect();
    if (r.left < 8) { m.style.left = "0"; m.style.right = "auto"; }
    else if (r.right > window.innerWidth - 8) { m.style.right = "0"; m.style.left = "auto"; }
  }, true);
}

// an old browser was told it is not supported (public/oldcheck.js): nothing more is started. 17-Oct-2026: nor on a page
// that index.html's build check is swapping for a newer build; and on the service worker's kept copy of the page
// (data-boot-kept, sw/sw.js: the line was too slow to bring the page), not before that check has answered (6 s at most),
// so an older build is never drawn and then replaced
// a guest's call link (#join=…): the guest's page alone, FinCom itself is not started (no sign-in)
// next-calls-meet (23-Oct-2026): a meeting's link (#/join/<code>) or the join page (#/join): the guest's page for someone
// not signed in here; a signed-in member gets FinCom with the meeting's lobby over Meetings
const guestPage = !window.__fincomOld && !window.__fincomSwapping && (guestLink() || (joinHash() && !memberHere()));
if (guestPage) startGuest().catch((e) => { try { document.body.textContent = "The call could not be opened: " + e.message; } catch (x) { /* */ } });
else if (!window.__fincomOld && !window.__fincomSwapping) {
  takeJoin();
  const check = document.documentElement.hasAttribute("data-boot-kept") && window.__fincomBootCheck;
  // 24-Oct-2026: legacy.js did not load (public/oldcheck.js): the app does not start (the page is being refreshed, or
  // says so)
  const go = () => (window.__fincomLegacy ? window.__fincomLegacy.then((ok) => { if (ok) start(); }) : start());
  if (!check) go();
  else Promise.race([check, new Promise((ok) => setTimeout(() => ok(false), 6000))]).then((swapping) => { if (!swapping && !window.__fincomSwapping) go(); }, go);
}
