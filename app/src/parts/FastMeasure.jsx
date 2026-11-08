// next-fast-measure (08-Nov-2026): "Fast read measured on ZZ TEST" under Advanced (for support), read only, shown only
// when a measurement was sent (tally_fast_measures, migration 143; nothing shown on a cloud without it). Each run: when,
// TallyPrime's version, PASS or NOT A PASS (lib/fastMeasure.js: worst under 1.5 s, window hold under 1 s, every entry the
// same), and why not. Times, counts and field names only: the cloud holds no entry data. Nothing to press.
import { useEffect, useState } from "react";
import { fastWords } from "../lib/fastMeasure.js";

const when = (at) => { const t = Date.parse(at || ""); return t ? new Date(t + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST" : ""; };

export default function FastMeasure() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    if (typeof Cloud !== "object" || !Cloud.api) return;
    Promise.resolve(Cloud.api("tally_fast_measures?select=received_at,tally_version,bridge,pass,line,result&order=received_at.desc&limit=5"))
      .then((r) => { if (live) setRows(Array.isArray(r) ? r : []); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);
  if (!rows || !rows.length) return null;
  return <div className="tfm" data-fast-measure="">
    <h4 className="tadv-h" style={{ margin: "0 0 6px" }}>Fast read measured on ZZ TEST</h4>
    <p className="note" style={{ margin: "0 0 6px" }}>From the bridge’s tray (Measure the fast read). A pass is needed before the fast read may be switched on for that computer.</p>
    {rows.map((r, i) => { const w = fastWords(r);
      return <p key={i} className={"note " + (w.pass ? "ok" : "bad")} data-fast-measure-row={w.pass ? "pass" : "fail"} style={{ margin: "2px 0" }}>
        <b>{when(r.received_at)}</b>{" · " + w.head}{w.detail ? <><br />{w.detail}</> : null}</p>; })}
  </div>;
}
