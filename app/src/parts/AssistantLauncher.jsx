// FinCom Assistant's launcher, at the foot of every page. In the app's first file; the panel itself (Assistant.jsx) is
// loaded the first time it opens (round 3, 14-Oct-2026: the first file stays within its budget, run_stability.py)
import { useLayoutEffect, useRef } from "react";
import { Sparkles } from "lucide-react";

// The owner's report of 17-Oct-2026: "while in purchase field.. ask fincom is coming in approving.. I believe same thing is
// happening everywhere". The launcher is fixed at the bottom right; the bars along the foot of pages (the review table's
// Approve all, the open bill's Approve and Next bill, Bank's Create Tally file, a sticky Save) and rows scrolled under it
// sat beneath it. One rule for every page, here (tests/run_ask_fab_overlap.py): the launcher never sits over anything
// that can be pressed or typed in.
//   1. while a drawer, sheet, confirm box or other modal is open it is put away (it has its own buttons; Ctrl+J still opens
//      the panel);
//   2. over a bar fixed or stuck to the foot (an action bar, a sticky Save, a toast with buttons, "A new version … Reload")
//      it stands on top of that bar (--ask-fab-lift);
//   3. over something on the page itself (a row scrolled under it), it tucks into a small tab at the window's right edge;
//   4. if even the tab would cover something, it is put away until the page moves (Ctrl+J still opens the panel).
// The room it takes at the foot is on :root as --ask-fab-space, so the page can be scrolled clear of it.
const PRESS = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [contenteditable=true]';
const MODAL = '[aria-modal="true"], .drawer, .drawer-scrim, .bk-overlay, .firmsetup-scrim, .side-sheet-wrap, #confirmBox, .menu-scrim, [role="dialog"][data-state="open"]';
const GAP = 4;
// round 89: the TDS return's footer (the challan's figures) counts as taken though it holds no button
const FOOT = ".wd-foot";

function modalOpen(btn) {
  if (getComputedStyle(document.body).pointerEvents === "none") return true;   // a Radix modal (DrawerContent) is open
  for (const el of document.querySelectorAll(MODAL)) {
    if (btn.contains(el) || el.closest("[data-asst-panel]")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // a dialog that is a small pop-over is not a modal; one marked modal, or one fixed over much of the window, is
    if (el.getAttribute("aria-modal") === "true" || (cs.position === "fixed" && r.width * r.height > innerWidth * innerHeight * 0.25)) return true;
  }
  return false;
}

// what can be pressed under the box r, on top where it is (the launcher left out); each with the bar (fixed or sticky)
// it sits on, if any
function under(btn, r) {
  const out = [];
  const top = (x, y) => document.elementsFromPoint(x, y).find((el) => !btn.contains(el));
  for (const el of document.querySelectorAll(PRESS + ", " + FOOT)) {
    if (btn.contains(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.left >= r.right + GAP || b.right <= r.left - GAP || b.top >= r.bottom + GAP || b.bottom <= r.top - GAP) continue;
    // on top where it is seen (its part inside the window), so not something hidden under a bar or a scrim
    const x0 = Math.max(b.left, 0), x1 = Math.min(b.right, innerWidth), y0 = Math.max(b.top, 0), y1 = Math.min(b.bottom, innerHeight);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const t = top((x0 + x1) / 2, (y0 + y1) / 2);
    if (!t || !(el === t || el.contains(t))) continue;
    let bar = null;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") { bar = p; break; }
    }
    out.push({ el, bar });
  }
  return out;
}

function place(btn) {
  const root = document.documentElement;
  const set = (where, lift) => { btn.setAttribute("data-asst-place", where); btn.style.setProperty("--ask-fab-lift", Math.max(0, Math.round(lift)) + "px"); };
  if (modalOpen(btn)) { set("away", 0); root.style.setProperty("--ask-fab-space", "0px"); return; }
  let lift = 0, hits = [];
  set("full", 0);
  for (let i = 0; i < 4; i++) {
    const r = btn.getBoundingClientRect();
    hits = under(btn, r);
    if (!hits.length) break;
    // only bars at the foot of the window lift it (what is on the page itself does not: the tab is for that)
    const bars = hits.map((h) => h.bar).filter(Boolean).map((b) => b.getBoundingClientRect()).filter((b) => b.bottom >= innerHeight * 0.6 && b.height < innerHeight * 0.4);
    if (!bars.length) break;
    const want = r.bottom - (Math.min(...bars.map((b) => b.top)) - GAP);
    if (want <= 0.5 || r.top - want < innerHeight * 0.35) break;
    lift += want; set("full", lift);
  }
  if (hits.length) {
    set("tab", lift);
    if (under(btn, btn.getBoundingClientRect()).length) { set("away", 0); root.style.setProperty("--ask-fab-space", "0px"); return; }
  }
  const r = btn.getBoundingClientRect();
  root.style.setProperty("--ask-fab-space", Math.max(0, Math.round(innerHeight - r.top + GAP)) + "px");
}

// placed again when the page changes, is scrolled or resized; at most every 120 ms, and never because of itself
function usePlacement(ref, on) {
  useLayoutEffect(() => {
    const btn = ref.current;
    if (!on || !btn) { document.documentElement.style.setProperty("--ask-fab-space", "0px"); return undefined; }
    let timer = 0, frame = 0, last = 0;
    const run = () => { frame = 0; last = Date.now(); try { place(btn); } catch (e) { btn.setAttribute("data-asst-place", "full"); } };
    const soon = () => {
      if (frame || timer) return;
      const wait = Math.max(0, 120 - (Date.now() - last));
      if (!wait) frame = requestAnimationFrame(run);
      else timer = setTimeout(() => { timer = 0; frame = requestAnimationFrame(run); }, wait);
    };
    run();
    const mo = new MutationObserver((recs) => { if (recs.some((m) => !btn.contains(m.target))) soon(); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "hidden", "aria-modal", "data-state", "disabled"] });
    addEventListener("scroll", soon, { capture: true, passive: true });
    addEventListener("resize", soon);
    return () => { mo.disconnect(); removeEventListener("scroll", soon, { capture: true }); removeEventListener("resize", soon); clearTimeout(timer); cancelAnimationFrame(frame);
      document.documentElement.style.setProperty("--ask-fab-space", "0px"); };
  });
}

export function AssistantLauncher() {
  const ref = useRef(null);
  const a = ASST.st();
  const shown = !!(S.firm && !a.open && typeof Cloud === "object" && Cloud.on() && ASST.on());
  usePlacement(ref, shown);
  if (!S.firm || a.open || typeof Cloud !== "object" || !Cloud.on()) return null;
  // the firm's setting is read again until it is known (the owner's report of 14-Oct-2026, src/js/75-assistant.js loadSettings)
  if (a.settings === undefined && !a.settingsBusy) setTimeout(() => ASST.loadSettings(), 0);
  if (!ASST.on()) return null;
  const co = S.view === "company" && CO();
  // a long client name is cut with an ellipsis (assistant.css); the whole name is in the tooltip (the owner's report of 14-Oct-2026)
  const words = co ? "Ask about " + co.name : "Ask FinCom";
  return <button ref={ref} className="asst-launch" data-asst-launch="" data-asst-place="full" onClick={() => ASST.open()} title={words + " · FinCom Assistant (Ctrl+J)"} aria-label={words}><Sparkles size={16} /> <span className="asst-launch-txt">{words}</span></button>;
}
