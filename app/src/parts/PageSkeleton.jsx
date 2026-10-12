// A page's shape while its data comes (stability batch 1): the same cards and rows the frame of index.html draws before
// the program loads, so opening FinCom and then a client reads as one wait, not a row of different "Loading…" notes.
// Shown after 300 ms (a quick open shows nothing in between), or at once when the frame's own shape was already showing.
// What is being opened is said in one line over the shape (the owner's K7: words and a skeleton, never a blank area).
import { useEffect, useState } from "react";
import { FinComNav } from "../nav.js";
import { bootShapeShown } from "../boot.js";

let usedBoot = false, lastShown = 0, lastGone = -1e9;
export default function PageSkeleton({ what }) {
  // the first one after the frame of index.html takes over from its shape at once
  // (decided once for this showing: a redraw of the same wait does not start its 300 ms again)
  // and one that follows another at once (opening a client, then its overview reading the books) carries straight on:
  // the same words and shape, no blank 300 ms in between
  const [now] = useState(() => { const n = (!usedBoot && bootShapeShown()) || (performance.now() - lastGone < 250 && lastShown); usedBoot = true; return !!n; });
  useEffect(() => { const t0 = performance.now(); return () => { lastGone = performance.now(); lastShown = now || lastGone - t0 > 300; }; }, []);
  // the thin bar under the top bar while the page waits (stability batch 3), not while the first open hands over
  useEffect(() => { if (now) return undefined; FinComNav.start(); return () => FinComNav.done(); }, []);
  const row = <div className="boot-row"><i className="boot-bar skel"></i><i className="boot-bar skel"></i><i className="boot-bar skel"></i></div>;
  // the owner's K7: what is loading said in words over the shape (one wait: the words and the shape together, once)
  return <div className={"pg-skel" + (now ? " now" : "")} role="status" aria-busy="true" data-page-skeleton="" data-loading="">
    <div className="lt-loading-t pg-skel-t">{"Loading " + (what || "the page") + "…"}</div>
    <div className="boot-cards" aria-hidden="true"><div className="boot-card"></div><div className="boot-card"></div><div className="boot-card"></div><div className="boot-card"></div></div>
    <div className="boot-rows" aria-hidden="true">{row}{row}{row}{row}</div>
  </div>;
}
