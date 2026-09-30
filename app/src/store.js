// The one state object S lives in the business logic (legacy.js), and every change there ends in render().
// render() now does two things, in the same moment as before: the screens not yet in React redraw (they are HTML
// strings put into the page), then React redraws its own. Nothing waits: code that looks at the page right after
// render() finds it drawn.
//
// A React screen inside an old screen is marked there as <div data-react="Name">. The React screen lives in a host
// element of its own, put back in that place after every redraw, so it keeps what was typed and where the cursor was.
// The placeholder's other data-* attributes are passed to the screen as props: <div data-react="DocqPanel" data-cid="x">.
import { flushSync } from "react-dom";

const legacyRender = window.render;
let version = 0, hosts = new Map(), placed = [];
const subs = new Set();
export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const snapshot = () => version;
export const islands = () => placed;   // [{key, name, host, props}] in page order

// put each React screen's host where its placeholder is
export function adopt() {
  const seen = {};
  document.querySelectorAll("[data-react]:not(.react-host)").forEach((el) => {
    // the same screen for another client (another data-cid) gets a host, and state, of its own
    const name = el.dataset.react, props = Object.fromEntries(Object.entries(el.dataset).filter(([k]) => k !== "react"));
    const base = name + JSON.stringify(props), key = base + "#" + (seen[base] = (seen[base] || 0) + 1);
    let host = hosts.get(key);
    if (!host) {
      host = document.createElement("div"); host.className = "react-host"; host.style.display = "contents";
      host.dataset.react = name; host.dataset.key = key; hosts.set(key, host);
    }
    host.props = props;
    el.replaceWith(host);
  });
  // every host in the page now, whether just put back or left where it was (a redraw of React alone)
  placed = [...document.querySelectorAll(".react-host")].map((host) => ({ key: host.dataset.key, name: host.dataset.react, host, props: host.props || {} }));
}

// React only (no old screens redrawn): for tests, which put a placeholder in the page themselves
export function redraw() { adopt(); version++; flushSync(() => subs.forEach((f) => f())); }
window.FinComReact = { redraw };

window.render = function render() {
  // focus inside a React screen is lost when the old screen around it is redrawn: note it, give it back after
  const a = document.activeElement, inHost = a && a.closest && a.closest(".react-host");
  let sel = null; try { sel = inHost ? [a.selectionStart, a.selectionEnd] : null; } catch { /* not a text field */ }
  try { legacyRender(); }
  finally {
    adopt();
    if (inHost && a.isConnected && document.activeElement !== a) { a.focus(); try { if (sel && sel[0] != null) a.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
    version++;
    flushSync(() => subs.forEach((f) => f()));
    // the column filter pop-up sits under its funnel button, which may be in a React table
    if (typeof placeColPop === "function") placeColPop();
  }
};
