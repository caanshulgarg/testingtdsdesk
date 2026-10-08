import { createRoot } from "react-dom/client";
import "../legacy/app.css";
import App from "./App.jsx";
import { adopt } from "./store.js";
import { createElement, useSyncExternalStore } from "react";
import Guard from "./Guard.jsx";
import { subscribe, snapshot } from "./store.js";
import { flushSync } from "react-dom";
import { Gst9c } from "./screens/gst/Annual.jsx";
import { watchFresh } from "./fresh.js";

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
  return <Guard name="the app" v={v}><App /></Guard>;
}

// an old browser was told it is not supported (public/oldcheck.js): nothing more is started
if (!window.__fincomOld) {
  // error reports to Sentry: in a test build only (never in a live build: the import is dropped), and src/sentry.js
  // starts only on staging.fincom.live (docs/sentry.md)
  if (import.meta.env.MODE === "test" && __FINCOM_SENTRY__) import("./sentry.js").then((m) => m.start()).catch(() => {});
  adopt();
  createRoot(document.getElementById("react-root")).render(<Root />);
  watchFresh();
}
