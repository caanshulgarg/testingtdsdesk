// deno test server/tally-cloud/updategate_test.ts - migration 139's gate, the part worked out from the beat
// (updategate.js): when the bridge last started as far as the cloud saw, whether it is at its own time to look for an
// update (2 minutes after a start, then every 6 hours), and whether it is idle with Tally. Made-up bridges only.
import { gateTrack, checkWindow, busyWhy, reqKey, olderThan, QUIET_MS, EVERY_MS } from "./updategate.js";

function assert(c: unknown, w: string) { if (!c) throw new Error(w); }
const T0 = Date.parse("2026-11-04T05:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const R0 = { day: "2026-11-04", n: 0, last: null };
const R5 = { day: "2026-11-04", n: 5, last: { kind: "TDSDeskCompanies", ms: 120, at: "2026-11-04T10:30:00" } };
const beat = (at: number, x: Record<string, unknown> = {}) => ({ at: iso(at), every: 30, version: "2.5.1", busySince: "", tallyState: "closed", tally: false, updating: false, reqs: R0, ...x });

Deno.test("the start: a first beat, a beat after a gap, a new version, the request count started again; else kept", () => {
  let g = gateTrack({}, beat(T0), T0);
  assert(g.startAt === iso(T0) && g.startHow === "first beat", "first beat: " + JSON.stringify(g));
  const g2 = gateTrack({ beat: beat(T0), updGate: g }, beat(T0 + 30000), T0 + 30000);
  assert(g2.startAt === iso(T0), "a beat 30 s later keeps the start");
  const g3 = gateTrack({ beat: beat(T0), updGate: g }, beat(T0 + 200000), T0 + 200000);
  assert(g3.startAt === iso(T0 + 200000) && /again after 200 s/.test(g3.startHow) && g3.starts.join() === [iso(T0), iso(T0 + 200000)].join(), "a gap of 200 s: a possible start beside the first");
  assert(checkWindow(g3, T0 + 120e3 + EVERY_MS).at && checkWindow(g3, T0 + 200e3 + 120e3 + EVERY_MS).at, "either start's time counts (a network gap does not lose the real one)");
  const g4 = gateTrack({ beat: beat(T0, { version: "2.5.1" }), updGate: g }, beat(T0 + 30000, { version: "2.5.3" }), T0 + 30000);
  assert(g4.startAt === iso(T0 + 30000) && g4.starts.length === 1, "a new version: started again (the only start)");
  const g5 = gateTrack({ beat: beat(T0, { reqs: R5 }), updGate: g }, beat(T0 + 30000, { reqs: { ...R5, n: 1 } }), T0 + 30000);
  assert(g5.startAt === iso(T0 + 30000), "the count went down the same day: started again");
});

Deno.test("the start from the connection history when the gate first sees a bridge", () => {
  const hist = [{ kind: "bridge", state: "offline", at: iso(T0 - 9 * 3600e3), to: iso(T0 - 3600e3) }, { kind: "tally", state: "open", at: iso(T0 - 1800e3) }];
  const g = gateTrack({ beat: beat(T0 - 30000), history: hist }, beat(T0), T0);
  assert(g.startAt === iso(T0 - 3600e3) && g.starts.length === 1 && g.startHow === "the connection history", JSON.stringify(g));
  const old = [{ kind: "bridge", state: "offline", at: iso(T0 - 30 * 3600e3), to: iso(T0 - 20 * 3600e3) }];
  assert(gateTrack({ beat: beat(T0 - 30000), history: old }, beat(T0), T0).startAt === "", "a start over 12 h ago: not known");
  assert(gateTrack({ beat: beat(T0 - 30000) }, beat(T0), T0).startAt === "", "no history: not known");
});

Deno.test("its time to look: 2 minutes after the start, then every 6 hours, from 4 minutes before to 6 after", () => {
  const g = { startAt: iso(T0) };
  assert(checkWindow(g, T0).at, "at the start (the check 2 minutes later)");
  assert(checkWindow(g, T0 + 8 * 60e3).at && !checkWindow(g, T0 + 9 * 60e3).at, "until 6 minutes after the check");
  const w = checkWindow(g, T0 + 3600e3);
  assert(!w.at && w.next === iso(T0 + 120e3 + EVERY_MS), "an hour after: not, next at start + 6 h 2 min: " + JSON.stringify(w));
  assert(checkWindow(g, T0 + 120e3 + EVERY_MS - 3 * 60e3).at && !checkWindow(g, T0 + 120e3 + EVERY_MS - 5 * 60e3).at, "around the second check");
  const u = checkWindow({ startAt: "" }, T0), o = checkWindow({ startAt: iso(T0 - 13 * 3600e3) }, T0);
  assert(u.at && !u.known && o.at && !o.known, "start not known or over 12 h 10 min ago: always its time (the 10-minute slots decide)");
});

Deno.test("idle with Tally", () => {
  const g = { quietSince: iso(T0) };
  assert(busyWhy(beat(T0), g, T0) === "", "no Tally of its own, no request today: idle at once");
  assert(/busy/.test(busyWhy(beat(T0, { busySince: "2026-11-04T10:00:00" }), g, T0)), "busySince: busy");
  assert(/busy/.test(busyWhy(beat(T0, { tallyState: "busy" }), g, T0)), "Tally busy");
  assert(/reading/.test(busyWhy(beat(T0, { updating: true }), g, T0)), "reading Tally");
  assert(/tried again/.test(busyWhy(beat(T0, { tallyRetry: { words: "x" } }), g, T0)), "a request waiting to be tried again");
  assert(/3 minutes/.test(busyWhy(beat(T0, { reqs: R5, tally: true }), g, T0 + QUIET_MS - 1000)), "requests changed under 3 minutes ago");
  assert(busyWhy(beat(T0, { reqs: R5, tally: true }), g, T0 + QUIET_MS) === "", "3 minutes quiet: idle");
  assert(/3 minutes/.test(busyWhy(beat(T0, { reqs: R0, tally: true }), g, T0 + 1000)), "its own Tally open, even with no request: waits the 3 minutes");
  assert(/no beat/.test(busyWhy(null, g, T0)), "no beat: not idle");
});

Deno.test("quiet since: kept while the request count stays, moved when it changes", () => {
  const p = { beat: beat(T0, { reqs: R5 }), updGate: { reqKey: reqKey(R5), quietSince: iso(T0 - 600e3), startAt: iso(T0 - 3600e3) } };
  assert(gateTrack(p, beat(T0 + 30000, { reqs: R5 }), T0 + 30000).quietSince === iso(T0 - 600e3), "unchanged: kept");
  const moved = gateTrack(p, beat(T0 + 30000, { reqs: { ...R5, n: 6 } }), T0 + 30000);
  assert(moved.quietSince === iso(T0 + 30000) && moved.startAt === iso(T0 - 3600e3), "a new request: moved, the start kept");
});

Deno.test("olderThan", () => {
  assert(olderThan("2.4.7", "2.5.3") && olderThan("2.5.2", "2.5.10") && !olderThan("2.5.3", "2.5.3") && !olderThan("x", "2.5.3"), "versions");
});
