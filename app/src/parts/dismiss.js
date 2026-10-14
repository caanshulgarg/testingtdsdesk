// Every overlay closes the same way (the owner, 14-Oct-2026: "When we open More or Check before filing or anything, I need
// to go to the cross to remove it. If I click on the screen it should close."). One place for the whole app:
//   - a click or tap outside the overlay closes it; that first click only closes (it never also presses what was under it);
//   - Esc closes the top overlay and goes no further (the app's own Esc would otherwise leave the client);
//   - on a phone, Back closes the top overlay (a step in the browser's history while it is open);
//   - an overlay with typed, unsaved input (guard() true) asks "Discard?" first, on an outside click and on Esc;
//   - a confirm step (confirm: true: delete with a reason, Mark filed) never closes on an outside click; Esc asks if
//     something was typed, else it is Cancel.
// React overlays: useDismiss(open, ref, close, opts). Native <details> menus (More, the older bk-menu ones) need nothing:
// they are closed here by their class. Legacy code reads window.FCOverlay (src/js: askConfirm, the help panel, the router).
import { useEffect, useRef } from "react";

const stack = [];                       // [{ref, close, opts, id, pushed}], the last is the top
let seq = 0, skipPop = 0, swallowUntil = 0;
const PHONE = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
// the native popups: More, the older bk-menu menus, the column pickers, the "why" and the Info (i) popovers
const MENUS = "details.more[open], details.bk-menu[open], details.colpick[open], details.ab-why[open], details.info[open]";

// the click that follows a closing pointerdown is not passed on (the first click only closes)
function swallowNextClick() { swallowUntil = Date.now() + 700; }
function inside(el, t) { return !!(el && t && (el === t || (el.contains && el.contains(t)))); }
// something above every overlay (the legacy confirm box, the toast) or inside a portal the overlay owns
function above(t) { return !!(t && t.closest && t.closest("#confirmBox, #toast, [data-overlay-keep]")); }
function confirmOpen() { const c = typeof document !== "undefined" && document.getElementById("confirmBox"); return !!(c && c.style && c.style.display === "flex"); }

async function ask(top) {
  // "Discard?" for typed input; window.askConfirm is the app's own confirm box (src/js/23)
  if (typeof window.askConfirm !== "function") return window.confirm("Discard what you typed?");
  const r = await window.askConfirm({ title: "Discard what you typed?", body: "It is not saved.", ok: "Discard", cancel: "Keep editing" });
  return !!(r && r.ok);
}
async function tryClose(top, how) {
  const typed = top.opts.guard ? !!top.opts.guard() : false;
  if (how === "outside" && top.opts.confirm) return false;               // a confirm step stays
  if (typed && !(await ask(top))) return false;
  top.close(how);
  return true;
}

function onPointerDown(ev) {
  swallowUntil = 0;                     // a new press: nothing left over from the last one
  if (ev.button && ev.button !== 0) return;
  const t = ev.target;
  if (above(t) || confirmOpen()) return;
  // the native menus: one open menu closes when the press is outside it
  const menus = Array.from(document.querySelectorAll(MENUS)).filter((d) => !inside(d, t));
  if (menus.length) { menus.forEach((d) => { d.open = false; }); swallowNextClick(); return; }
  const top = stack[stack.length - 1];
  if (!top || inside(top.ref.current, t) || (top.opts.also && top.opts.also().some((el) => inside(el, t)))) return;
  if (top.opts.confirm) return;
  swallowNextClick();
  tryClose(top, "outside");
}
function onClick(ev) {
  if (Date.now() < swallowUntil) { swallowUntil = 0; ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); }
}
// the click a closing press would make comes right after its release; when the press's target went away with the
// overlay there is no click, so nothing is swallowed later on
function onPointerUp() { if (swallowUntil) setTimeout(() => { swallowUntil = 0; }, 120); }
// the older pop-ups that handle their own Esc (a column's filter, a grid filter, the suggestions under a field)
function legacyPop() {
  const ac = document.getElementById("acBox");
  return !!(document.querySelector("#colpop, #gfpop") || (ac && ac.offsetParent !== null && ac.childElementCount));
}
function onKey(ev) {
  if (ev.key !== "Escape" || confirmOpen() || legacyPop()) return;
  const menus = Array.from(document.querySelectorAll(MENUS));
  if (menus.length) {
    ev.preventDefault(); ev.stopImmediatePropagation();
    menus.forEach((d) => { d.open = false; const s = d.querySelector("summary"); if (s && s.focus) s.focus(); });
    return;
  }
  const top = stack[stack.length - 1];
  if (!top || top.opts.esc === false) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  tryClose(top, "esc");
}
if (typeof window !== "undefined" && !window.FCOverlay) {
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
}

// Back (a phone): the router asks first (src/js/52 popstate); true = handled here, the page stays
function onBack() {
  if (skipPop) { skipPop--; return true; }
  const top = stack.slice().reverse().find((x) => x.pushed);
  if (!top) return false;
  top.pushed = false;
  const typed = top.opts.guard ? !!top.opts.guard() : false;
  if (typed) {
    // keep the step back while it asks; closed only once the person says Discard
    try { history.pushState({ fcOverlay: top.id }, "", location.href); top.pushed = true; } catch (e) { /* the step is gone; it stays open */ }
    ask(top).then((ok) => { if (ok) top.close("back"); });
    return true;
  }
  top.close("back");
  return true;
}
function open(entry) {
  stack.push(entry);
  if (PHONE() && entry.opts.back !== false && typeof history !== "undefined") {
    try { history.pushState({ fcOverlay: entry.id }, "", location.href); entry.pushed = true; } catch (e) { /* no step: Back leaves as before */ }
  }
}
function shut(entry) {
  const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1);
  // closed by Esc, a click or ✕: the step it added to the history goes again
  if (entry.pushed) { entry.pushed = false; skipPop++; try { history.back(); } catch (e) { skipPop--; } }
}

// for code outside React (src/js): a legacy overlay registers the same way
window.FCOverlay = window.FCOverlay || {
  onBack, swallowNextClick,
  // FCOverlay.add(el, close, opts) -> remove()
  add(el, close, opts) { const e = { ref: { current: el }, close, opts: opts || {}, id: ++seq }; open(e); return () => shut(e); },
  any() { return stack.length > 0 || !!document.querySelector(MENUS); },
};

// useDismiss(open, ref, close, opts): while open, the overlay in ref closes on an outside press, on Esc and (a phone) on Back.
// opts: guard() true when typed input would be lost; confirm: a confirm step (no outside close); also(): more elements that
// count as inside (a portal, the button that opened it); esc: false when the overlay keeps Esc for itself; back: false.
export function useDismiss(isOpen, ref, close, opts) {
  const live = useRef({ close, opts: opts || {} });
  live.current.close = close; live.current.opts = opts || {};
  useEffect(() => {
    if (!isOpen) return undefined;
    const entry = { ref, id: ++seq, pushed: false, close: (how) => live.current.close(how), get opts() { return live.current.opts; } };
    open(entry);
    return () => shut(entry);
  }, [isOpen]);
}
export default useDismiss;
