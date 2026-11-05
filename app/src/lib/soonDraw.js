// next-tally-table (04-Nov-2026; the owner: "now the table is not showing... this tally link is the basic page that should
// work seamlessly"): the Tally page's answers (each client's ledger count, the books, the firm's summary, the checks, the
// opening balances, this computer's look on 127.0.0.1) each drew the WHOLE app at once (render()), so answers that came in
// together drew it several times in one go: 400-580 ms blocks at a 4x slower CPU (the shared server). Now they ask for one
// drawing, made at the next frame. A hidden tab draws nothing (nobody sees it, and a drawing could ask the cloud again): it
// draws once when it is shown again.
// next-scroll-rdp (the owner: on the shared server, the Tally page "doesn't move" with the wheel): a drawing of the whole
// app is 80-180 ms there, and one made while the page is being scrolled holds the scroll's frames. While the person
// scrolls (a scroll or a wheel in the last 400 ms: the clicks of a wheel come closer than that) the drawing waits for the scroll to stop, at most 10 s.
// next-speed-redraw (05-Nov-2026): the drawing itself is soonRender (src/js/01), the one for every background drawing of
// the app (quietRender too): answers that come one after another are drawn together, never sooner than half a second
// after the last drawing. soonDraw({ now: true }): at the next frame, without that wait (the page's own first answer).
export function soonDraw(o) {
  if (typeof soonRender === "function") { soonRender(o); return; }
  try { if (typeof render === "function") render(); } catch (e) { /* the next drawing shows it */ }
}
