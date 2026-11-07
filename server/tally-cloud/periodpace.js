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

// the bridge's speed per company from its beat, only while its fast read is on (review of 0de692f49, 1 and 7):
// periodPull.fast.speed [{company, guid, perMin}] -> [{company, guid, perMin}], at most 5, whole numbers 1..100000, a
// company name and a GUID each; anything else dropped (a bridge with the switch off reports none and none is kept)
export function speedOf(beat) {
  if (!fastOn(beat)) return [];
  const l = beat.periodPull.fast.speed;
  if (!Array.isArray(l)) return [];
  const out = [];
  for (const v of l) {
    if (out.length >= 5) break;
    const n = Math.floor(Number(v && v.perMin));
    const company = typeof (v && v.company) === "string" ? v.company.trim() : "", guid = typeof (v && v.guid) === "string" ? v.guid.trim().toLowerCase() : "";
    if (company && company.length <= 200 && guid && guid.length <= 100 && n >= 1 && n <= 100000) out.push({ company, guid, perMin: n });
  }
  return out;
}

// each speed as the book it is for: the book FinCom keeps under that company name (bookOf) whose recorded company GUID
// (guidOf) is the bridge's; a book with no GUID recorded, another GUID, or a lookup that fails: left out. [{book, perMin}]
export async function speedBooks(speeds, bookOf, guidOf) {
  const out = [];
  for (const s of speeds) {
    try {
      const book = await bookOf(s.company);
      if (!book || out.some((x) => x.book === book)) continue;
      const g = String((await guidOf(book)) || "").trim().toLowerCase();
      if (g && g === s.guid) out.push({ book: String(book), perMin: s.perMin });
    } catch { /* left out */ }
  }
  return out;
}

// review (6): a database without tally_period_next_paced: the older tally_period_next takes its pace from p_max (more
// than 3 is "night"), so by day it is asked at most 3 (a fast bridge's day is never recorded as night), at night only
// the room left (never more than fits)
export function olderNextMax(room, night) {
  const r = Math.max(0, Math.floor(Number(room) || 0));
  return night === true ? r : Math.min(3, r);
}
