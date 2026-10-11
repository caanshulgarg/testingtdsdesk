import { createRoot } from "react-dom/client";
// Arc's typefaces, bundled with the app (no font is fetched from elsewhere): Inter for text, Geist for headings
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "./styles/index.css";
import App from "./App.jsx";
import { adopt } from "./store.js";
import { createElement, useSyncExternalStore } from "react";
import Guard from "./Guard.jsx";
import { subscribe, snapshot } from "./store.js";
import { flushSync } from "react-dom";
import { Gst9c } from "./screens/gst/Annual.jsx";
import { watchFresh } from "./fresh.js";
import { preloadScreens } from "./screens/lazy.js";
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

// an old browser was told it is not supported (public/oldcheck.js): nothing more is started
if (!window.__fincomOld) {
  // error reports to Sentry: in a test build only (never in a live build: the import is dropped), and src/sentry.js
  // starts only on staging.fincom.live (docs/sentry.md)
  // stability batch 2: loaded once the page is drawn and the computer is idle (it was 35 KB on the way of the first open);
  // an error before then is kept (window.__fincomEarly, below) and reported when it starts
  const idle = (f, t) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: t }) : setTimeout(f, Math.min(t, 1500)));
  if (import.meta.env.MODE === "test" && __FINCOM_SENTRY__) {
    const early = window.__fincomEarly = [];
    const keep = (e) => { if (early.length < 10) early.push(e && (e.reason || e.error) ? (e.reason || e.error) : e); };
    window.addEventListener("error", keep); window.addEventListener("unhandledrejection", keep);
    idle(() => import("./sentry.js").then((m) => { window.removeEventListener("error", keep); window.removeEventListener("unhandledrejection", keep); m.start(); }).catch(() => {}), 3000);
  }
  adopt();
  createRoot(document.getElementById("react-root")).render(<Root />);
  watchFresh();
  // the other screens' files (screens/lazy.js), fetched once the first page is up
  idle(preloadScreens, 1200);
}
