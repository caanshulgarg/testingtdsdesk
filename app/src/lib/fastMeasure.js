// next-fast-measure (08-Nov-2026): the fast-read measurement's verdict on the Tally page (Advanced, read only), from a
// row of tally_fast_measures (migration 148) as FinCom's cloud keeps it: times, counts and field names only. The same
// rule as the cloud's (server/tally-cloud/fastmeasure.js fastMeasurePass) and the bridge's: every request under 1.5 s,
// every window hold under 1 s, every compared entry the same (at least one), the plan run to its end with Tally's window
// watched.
export const PASS_MS = 1500, HOLD_MS = 1000;

export function fastVerdict(row) {
  const r = (row && row.result) || {};
  const res = Array.isArray(r.results) ? r.results : [];
  let worst = 0, hold = 0, same = 0, differ = 0, stopped = r.stopped || "";
  const fields = new Set();
  for (const e of res) {
    worst = Math.max(worst, Number(e.ms) || 0, Number(e.objectMs) || 0);
    hold = Math.max(hold, Number(e.holdMs) || 0, Number(e.objectHoldMs) || 0);
    if (e.stopped && !stopped) stopped = e.stopped;
    if (e.compare) { same += Number(e.compare.same) || 0; differ += Number(e.compare.differ) || 0; (e.compare.fields || []).forEach((f) => fields.add(String(f))); }
  }
  const why = [];
  if (r.ok !== true || r.error) why.push(r.error || "not measured");
  if (stopped) why.push(stopped);
  if (worst >= PASS_MS) why.push("a request took " + (worst / 1000).toFixed(2) + " s (1.5 s at most)");
  if (hold >= HOLD_MS) why.push("Tally's window held " + (hold / 1000).toFixed(2) + " s (under 1 s)");
  if (differ > 0) why.push(differ + " of " + (same + differ) + " entries not the same");
  if (same + differ === 0 && r.ok === true && !r.error) why.push("no entry compared");
  if (r.watched !== true && r.ok === true) why.push("Tally's window could not be watched");
  return { pass: why.length === 0, worst, hold, same, differ, fields: [...fields].sort(), why, version: String(row && row.tally_version || r.tallyVersion || "") };
}

export function fastWords(row) {
  const v = fastVerdict(row);
  const head = (v.pass ? "PASS" : "NOT A PASS") + (v.version ? " · TallyPrime " + v.version : "") + " · worst " + (v.worst / 1000).toFixed(2) + " s · window held " + (v.hold / 1000).toFixed(2) + " s · " + (v.same) + " of " + (v.same + v.differ) + " entries the same";
  return { ...v, head, detail: v.why.join("; ") + (v.fields.length ? (v.why.length ? "; " : "") + "fields that differed: " + v.fields.join(", ") : "") };
}
