// The thin bar under the top bar while a page change or a run takes longer than 300 ms (stability batch 3; the owner,
// as Claude, GitHub and Turbo do). Never a full-screen spinner; nothing at all under 300 ms (styles/steady.css starts the
// bar 300 ms after it is asked for, on the compositor, so it shows even while the page is being drawn); still (no
// moving fill) under reduced motion; while it is on, the page's main part says aria-busy.
//   FinComNav.start() / done()     around any wait (counted: two waits keep it until both are done)
//   FinComNav.track(promise)       for a wait that is a promise
//   FinComNav.go(fn)               a page change asked for by a click: the bar is put up first, the page drawn on the
//                                  next frame (so the click is seen to be taken), then the bar finishes
let busy = 0, el = null, offTimer = 0;
function bar() {
  const top = document.querySelector("header.top");
  if (el && el.isConnected && el.parentElement === top) return el;
  el = document.createElement("div");
  el.className = "nav-progress"; el.setAttribute("data-nav-progress", ""); el.setAttribute("aria-hidden", "true");
  el.innerHTML = "<i></i>";
  (top || document.body).appendChild(el);
  return el;
}
function app() { return document.getElementById("app"); }
export const FinComNav = {
  start() {
    busy++;
    if (busy > 1) return;
    clearTimeout(offTimer);
    const b = bar();
    b.removeAttribute("data-on"); void b.offsetWidth;   // the 300 ms count starts again
    b.setAttribute("data-on", "1");
    const a = app(); if (a) a.setAttribute("aria-busy", "true");
  },
  done() {
    if (!busy) return;
    busy--;
    if (busy) return;
    const b = bar();
    // shown: finished to the end, then faded; never shown (under 300 ms): simply gone, nothing flashes
    let shown = false; try { shown = +getComputedStyle(b).opacity > 0.01; } catch (e) { shown = false; }
    if (!shown) { b.removeAttribute("data-on"); }
    else { b.setAttribute("data-on", "0"); offTimer = setTimeout(() => { if (!busy) b.removeAttribute("data-on"); }, 450); }
    const a = app(); if (a) a.removeAttribute("aria-busy");
  },
  track(p) {
    this.start();
    Promise.resolve(p).then(() => this.done(), () => this.done());
    return p;
  },
  go(fn) {
    this.start();
    requestAnimationFrame(() => setTimeout(() => { try { fn(); } finally { this.done(); } }, 0));
  },
  busy() { return busy > 0; },
};
window.FinComNav = FinComNav;
