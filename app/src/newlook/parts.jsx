// The new look's small shared parts: a status word as a pill (the five words, one colour each: words.js) and the
// loading skeleton in a table's shape (rows of the same height as the real ones, no words, no spinner; shown after
// 150 ms so a quick load shows nothing in between).
import { useEffect, useState } from "react";
import { toneOf } from "./words.js";

export function Pill({ w }) {
  return <span className="nl-pill" data-tone={toneOf(w)} data-nl-pill={String(w || "").split(" · ")[0]}>{w}</span>;
}

export function NLSkel({ rows = 10, cols = 6, what = "" }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 150); return () => clearTimeout(t); }, []);
  return <div className={"nl-skel" + (on ? " on" : "")} role="status" aria-busy="true" aria-label={"Loading " + what} data-loading="" data-nl-skel="">
    <div className="nl-skel-head">{Array.from({ length: cols }, (_, j) => <i key={j} className="skel" />)}</div>
    {Array.from({ length: rows }, (_, i) => <div key={i} className="nl-skel-row">{Array.from({ length: cols }, (_, j) => <i key={j} className="skel" style={{ width: (j === 1 ? 70 - (i % 4) * 8 : 60 + ((i + j) % 3) * 12) + "%" }} />)}</div>)}
  </div>;
}
