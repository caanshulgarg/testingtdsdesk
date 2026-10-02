import { createRoot } from "react-dom/client";
import "../legacy/app.css";
import App from "./App.jsx";
import { adopt } from "./store.js";
import { createElement } from "react";
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

// an old browser was told it is not supported (public/oldcheck.js): nothing more is started
if (!window.__fincomOld) {
  adopt();
  createRoot(document.getElementById("react-root")).render(<App />);
  watchFresh();
}
