// next-fast-measure (08-Nov-2026): the fast-read measurement a bridge sends (tally-ingest {kind: "fast_measure"}),
// cleaned to exactly the fields FinCom keeps (migration 143, tally_fast_measures): times, counts and field NAMES only.
// Pure; the database call is in index.ts. Anything else in the body is dropped; a body that is not a measurement is
// refused (null).

export const FAST_MEASURE_COMPANY = "ZZ TEST";
const KINDS = new Set(["locate", "W1", "W2", "object"]);
const n = (v, max = 1e7) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0; };
const s = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
// a field's name as the bridge gives it: tag paths ("ALLLEDGERENTRIES.LIST/AMOUNT"), never a value
const FIELD = /^[A-Za-z0-9_.\/ ()-]{1,120}$/;

export function cleanFastMeasure(r) {
  if (!r || typeof r !== "object" || Array.isArray(r) || !Array.isArray(r.results)) return null;
  const results = [];
  for (const x of r.results.slice(0, 200)) {
    if (!x || typeof x !== "object" || !KINDS.has(x.kind)) continue;
    const e = { kind: x.kind, days: n(x.days, 31), rows: n(x.rows, 1e6), ms: n(x.ms, 600000), holdMs: n(x.holdMs, 600000) };
    if (x.asked != null) e.asked = n(x.asked, 100);
    if (x.objectMs != null) e.objectMs = n(x.objectMs, 600000);
    if (x.objectHoldMs != null) e.objectHoldMs = n(x.objectHoldMs, 600000);
    if (s(x.stopped, 200)) e.stopped = s(x.stopped, 200);
    if (s(x.note, 80)) e.note = s(x.note, 80);
    if (x.compare && typeof x.compare === "object") {
      e.compare = { same: n(x.compare.same, 1000), differ: n(x.compare.differ, 1000), left: n(x.compare.left, 1000),
        fields: (Array.isArray(x.compare.fields) ? x.compare.fields : []).filter((f) => typeof f === "string" && FIELD.test(f)).slice(0, 40) };
    }
    results.push(e);
  }
  return {
    ok: r.ok === true, state: s(r.state, 12), at: s(r.at, 40), bridge: s(r.bridge, 20), tallyVersion: s(r.tallyVersion, 40), plan: s(r.plan, 8),
    busiestDay: n(r.busiestDay, 1e6), busiest31: n(r.busiest31, 1e7), stopped: s(r.stopped, 200), error: s(r.error, 200), watched: r.watched === true,
    worstMs: n(r.worstMs, 600000), worstHoldMs: n(r.worstHoldMs, 600000), compared: n(r.compared, 1000), differ: n(r.differ, 1000),
    pass: r.pass === true, line: s(r.line, 400), results,
  };
}

// the page's verdict from a kept row (the bridge's own is not trusted alone): worst under 1.5 s, every window hold under
// 1 s, every compared entry the same, at least one compared, the plan run to its end with Tally's window watched
export function fastMeasurePass(r) {
  if (!r || r.ok !== true || r.stopped || r.error || r.watched !== true) return false;
  let worst = 0, hold = 0, same = 0, differ = 0;
  for (const e of r.results || []) {
    worst = Math.max(worst, e.ms || 0, e.objectMs || 0);
    hold = Math.max(hold, e.holdMs || 0, e.objectHoldMs || 0);
    if (e.stopped) return false;
    if (e.compare) { same += e.compare.same || 0; differ += e.compare.differ || 0; }
  }
  return worst < 1500 && hold < 1000 && differ === 0 && same > 0;
}
