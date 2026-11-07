// next-fast-entries (the owner's "Yes to both", 07-Nov-2026): how many days of the period FinCom hands a bridge in one
// beat answer, and the bridge's own speed kept from its beat for the page's "about N min left". Pure functions here; the
// database call (tally_period_next_paced, migration 98, unchanged) is in index.ts.
//   - by day 3 days an answer, outside the computer's office hours 30 (ROUND 103, unchanged);
//   - a bridge whose beat says its fast read is on (periodPull.fast.on === true: FastEntries, off by default) is handed
//     up to 30 by day too: it reads them as one window, each request still stopped at 2 s, postings first, idle only;
//   - the pace said to the database (p_night, the status line's "night"/"day") stays the computer's own hours: a fast
//     bridge by day is not called "night".

export const DAY_MAX = 3;
export const WIDE_MAX = 30;

// the beat says the bridge reads windows of days (its FastEntries switch)
export function fastOn(beat) {
  const f = beat && typeof beat === "object" && beat.periodPull && typeof beat.periodPull === "object" ? beat.periodPull.fast : null;
  return !!(f && typeof f === "object" && f.on === true);
}

// {max, night}: the days an answer, and the pace said to the database
export function periodPace(night, beat) {
  const n = night === true;
  return { max: n || fastOn(beat) ? WIDE_MAX : DAY_MAX, night: n };
}

// the bridge's speed per company from its beat (periodPull.companies[key].entriesPerMin): [{company, perMin}], at most
// 50, whole numbers 1..100000; anything else dropped
export function speedOf(beat) {
  const c = beat && beat.periodPull && typeof beat.periodPull === "object" ? beat.periodPull.companies : null;
  if (!c || typeof c !== "object" || Array.isArray(c)) return [];
  const out = [];
  for (const [k, v] of Object.entries(c)) {
    if (out.length >= 50) break;
    const n = Math.floor(Number(v && v.entriesPerMin));
    if (typeof k === "string" && k.trim() && k.length <= 200 && n >= 1 && n <= 100000) out.push({ company: k.trim(), perMin: n });
  }
  return out;
}
