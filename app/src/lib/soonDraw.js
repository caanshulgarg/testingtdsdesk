// next-tally-table (04-Nov-2026; the owner: "now the table is not showing... this tally link is the basic page that should
// work seamlessly"): the Tally page's answers (each client's ledger count, the books, the firm's summary, the checks, the
// opening balances, this computer's look on 127.0.0.1) each drew the WHOLE app at once (render()), so answers that came in
// together drew it several times in one go: 400-580 ms blocks at a 4x slower CPU (the shared server). Now they ask for one
// drawing, made at the next frame. A hidden tab draws nothing (nobody sees it, and a drawing could ask the cloud again): it
// draws once when it is shown again.
let queued = false, waiting = false;
const hidden = () => typeof document === "object" && document.visibilityState === "hidden";
function go() { if (!queued) return; queued = false; try { render(); } catch (e) { /* the next drawing shows it */ } }
export function soonDraw() {
  if (queued || typeof render !== "function") return;
  queued = true;
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
