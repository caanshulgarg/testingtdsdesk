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

// The box being typed in, inside a React screen, can leave the page in a redraw: taken out while the old screens are
// redrawn, or replaced when an old piece shown in a React screen (<Legacy>) is drawn again. Note it before, and give
// it back after: the same box, or the one with the same data-fk (with what was typed, for data-keeptyped boxes),
// with the cursor where it was; and what was typed in data-draft boxes. The old render() did this for its own screens.
function noteFocus() {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest(".react-host")) return null;
  let sel = null; try { sel = [a.selectionStart, a.selectionEnd]; } catch { /* not a text field */ }
  const drafts = {};
  document.querySelectorAll(".react-host [data-draft]").forEach((x) => { if (x.id) drafts[x.id] = x.value; });
  const fk = a.dataset && (a.dataset.fk || (a.hasAttribute("data-draft") && a.id ? "id:" + a.id : null));
  return { a, fk, sel, value: a.value, keep: a.hasAttribute("data-keeptyped"), drafts };
}
function giveFocus(f) {
  if (!f) return;
  Object.entries(f.drafts).forEach(([id, v]) => { const x = document.getElementById(id); if (x && x.value !== v) x.value = v; });
  const el = f.a.isConnected ? f.a : !f.fk ? null : f.fk.startsWith("id:") ? document.getElementById(f.fk.slice(3))
    : document.querySelector('.react-host [data-fk="' + CSS.escape(f.fk) + '"]');
  // only when the focus was lost in the redraw: a screen that moved it on purpose (a box opened) keeps its choice
  const now = document.activeElement;
  if (!el || now === el || (now && now !== document.body && now.isConnected)) return;
  if (el !== f.a && f.keep && el.value !== f.value) el.value = f.value;
  el.focus();
  try { if (f.sel && f.sel[0] != null) el.setSelectionRange(f.sel[0], f.sel[1]); } catch { /* not a text field */ }
}

// React only (no old screens redrawn); also for tests, which put a placeholder in the page themselves
// React draws, then any React screen placed inside an old piece it has just drawn (<Legacy>) is put in and drawn too
// (an old piece puts such a screen in place itself, so a new one shows up as a new entry in `placed`)
// A drawing of React is one calculation for the business logic: figures worked out from the whole books (the TDS rows,
// a month's 3B) are worked out once for it, not each time a screen asks (memoScope, src/js/01)
function drawReact() { return typeof window.memoScope === "function" ? window.memoScope(drawReactNow) : drawReactNow(); }
function drawReactNow() {
  const keys = () => placed.map((p) => p.key).join("|");
  adopt();
  for (let i = 0; i < 4; i++) {
    const before = keys();
    version++; flushSync(() => subs.forEach((fn) => fn()));
    if (document.querySelector("[data-react]:not(.react-host)")) adopt();
    if (keys() === before) break;
  }
}
export function redraw() { const f = noteFocus(); drawReact(); giveFocus(f); }
window.FinComReact = { redraw };

// A redraw of the old screens takes every React screen out of the page for a moment. If that happens while the mouse
// button is down (a box being left because a button was pressed: the box's change or blur redraws), the browser
// drops the click, since the button it went down on left the page. So while the button is held, only React redraws
// (it never takes anything out), and the full redraw follows as soon as the button is let go and the click is done.
let held = false, owed = false;
addEventListener("pointerdown", () => { held = true; }, true);
const letGo = () => { held = false; if (owed) { owed = false; setTimeout(() => window.render(), 0); } };
addEventListener("pointerup", letGo, true);
addEventListener("pointercancel", letGo, true);

window.render = function render() {
  if (held) { owed = true; redraw(); return; }
  const f = noteFocus();
  // the ledger list open under a box in a React screen: the old screens' redraw closes it (the box is out of the page
  // for a moment), so it is opened again once React has put the box back
  const acFk = typeof AC === "object" ? AC.fk : null;
  try { legacyRender(); }
  finally {
    drawReact();
    giveFocus(f);
    // the column filter pop-up sits under its funnel button, which may be in a React table
    if (typeof placeColPop === "function") placeColPop();
    // the old screens' finishing touches, for old pieces shown inside React screens: the funnels on their tables
    // and the "How this tab works" button (they ran while those pieces were out of the page)
    if (typeof GridF === "object") GridF.after();
    if (typeof Help === "object") Help.after();
    // the guide beside a tab ("How this tab works") follows the page, which React may have just changed
    if (typeof Help === "object") Help.after();
    if (acFk && !AC.fk) { const el = document.querySelector('[data-fk="' + CSS.escape(acFk) + '"]'); if (el && document.activeElement === el) acOpen(el); }
  }
};
