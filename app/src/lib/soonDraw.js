// next-tally-table (04-Nov-2026; the owner: "now the table is not showing... this tally link is the basic page that should
// work seamlessly"): the Tally page's answers (each client's ledger count, the books, the firm's summary, the checks, the
// opening balances, this computer's look on 127.0.0.1) each drew the WHOLE app at once (render()), so answers that came in
// together drew it several times in one go: 400-580 ms blocks at a 4x slower CPU (the shared server). Now they ask for one
// drawing, made at the next frame. A hidden tab draws nothing (nobody sees it, and a drawing could ask the cloud again): it
// draws once when it is shown again.
// next-scroll-rdp (the owner: on the shared server, the Tally page "doesn't move" with the wheel): a drawing of the whole
// app is 80-180 ms there, and one made while the page is being scrolled holds the scroll's frames. While the person
// scrolls (a scroll or a wheel in the last 400 ms: the clicks of a wheel come closer than that) the drawing waits for the scroll to stop, at most 10 s.
let queued = false, waiting = false, since = 0, moved = 0;
const QUIET_MS = 400, MAX_WAIT_MS = 10000;
const hidden = () => typeof document === "object" && document.visibilityState === "hidden";
if (typeof addEventListener === "function") {
  const mark = () => { moved = Date.now(); };
  addEventListener("scroll", mark, { capture: true, passive: true });
  addEventListener("wheel", mark, { capture: true, passive: true });
}
function go() {
  if (!queued) return;
  const now = Date.now(), q = now - moved;
  if (q < QUIET_MS && now - since < MAX_WAIT_MS) { setTimeout(go, QUIET_MS - q + 10); return; }
  queued = false; try { render(); } catch (e) { /* the next drawing shows it */ }
}
export function soonDraw() {
  if (queued || typeof render !== "function") return;
  queued = true; since = Date.now();
  if (hidden()) {
    if (!waiting) {
      waiting = true;
      const on = () => { if (hidden()) return; document.removeEventListener("visibilitychange", on); waiting = false; go(); };
      document.addEventListener("visibilitychange", on);
    }
    return;
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
  setTimeout(go, 1000);
}
