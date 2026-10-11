// A page's shape while its data comes (stability batch 1): the same cards and rows the frame of index.html draws before
// the program loads, so opening FinCom and then a client reads as one wait, not a row of different "Loading…" notes.
// Shown after 300 ms (a quick open shows nothing in between), or at once when the frame's own shape was already showing.
// What is being opened is said to a screen reader (role=status), not printed over the shape.
import { useState } from "react";
import { bootShapeShown } from "../boot.js";

let usedBoot = false;
export default function PageSkeleton({ what }) {
  // the first one after the frame of index.html takes over from its shape at once
  // (decided once for this showing: a redraw of the same wait does not start its 300 ms again)
  const [now] = useState(() => { const n = !usedBoot && bootShapeShown(); usedBoot = true; return n; });
  const row = <div className="boot-row"><i className="boot-bar"></i><i className="boot-bar"></i><i className="boot-bar"></i></div>;
  return <div className={"pg-skel" + (now ? " now" : "")} role="status" aria-busy="true" data-page-skeleton="">
    <span className="sr-only">{"Opening " + (what || "the page") + "…"}</span>
    <div className="boot-cards" aria-hidden="true"><div className="boot-card"></div><div className="boot-card"></div><div className="boot-card"></div><div className="boot-card"></div></div>
    <div className="boot-rows" aria-hidden="true">{row}{row}{row}{row}</div>
  </div>;
}
