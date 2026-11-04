// The gated rollout of FinCom Bridge updates (migration 139; the owner's requirement of 04-Nov-2026: an update must never
// hang a computer or anyone's Tally). No bridge change: bridges 2.4.7-2.5.3 update only when the heartbeat answer's
// release says allowed (bridge-go/update.go releaseRefuses), and look for an update 2 minutes after they start and then
// every 6 hours. A bridge older than the gate's version is allowed only when
//   a) its latest beat shows it idle with Tally: Tally not busy (busySince empty, tallyState not busy), not updating,
//      no request waiting to be tried again, no posting waiting or taken (the database checks those), and no request
//      to Tally for 3 minutes (its request count unchanged for 3 minutes; or none at all today with no Tally of its own
//      open: nothing to send to);
//   b) it is at its own time to look (2 minutes after a start the cloud saw, then every 6 hours, from 4 minutes before
//      to 6 minutes after; up to 3 possible starts are kept, as a gap in the beats may be a start or only a network gap;
//      a bridge whose start the cloud did not see, or saw more than 12 h 10 min ago, is at its time always: its turn then
//      comes in 10-minute slots);
//   c) its computer's one slot is its own: at most one bridge per computer is let through each 10 minutes, recorded in
//      tally_bridge_update_grants (tally_bridge_update_gate, migration 139, decides that under a lock).
// Everything else is answered allowed: false, which those bridges take as "FinCom has not allowed it on this computer";
// they look again at their next time (6 hours later). Pure functions here; the database call is in index.ts.

export const QUIET_MS = 3 * 60 * 1000;
export const FIRST_CHECK_MS = 2 * 60 * 1000;
export const EVERY_MS = 6 * 3600 * 1000;
export const BEFORE_MS = 4 * 60 * 1000, AFTER_MS = 6 * 60 * 1000;
export const TRUST_MS = 12 * 3600 * 1000 + 10 * 60 * 1000;

const t = (s) => { const x = Date.parse(String(s || "")); return isNaN(x) ? NaN : x; };
const iso = (ms) => new Date(ms).toISOString();

// what the request counter says, as one key: a new request (or a new day, or a restart) changes it
export function reqKey(reqs) {
  const r = reqs && typeof reqs === "object" ? reqs : {};
  const l = r.last && typeof r.last === "object" ? r.last : {};
  return JSON.stringify([String(r.day || ""), Number(r.n) || 0, String(l.at || ""), String(l.kind || "")]);
}

// the gate's record of a bridge (info.updGate), carried from beat to beat: when its requests last changed (quietSince)
// and when it may have started as far as the cloud saw (starts: at most 3, newest last; startAt: the newest). A start
// that is sure (a first beat, a new version, its request count started again) replaces the others; one only guessed
// from a gap in its beats (it may have been a network gap, not a start) is added beside them
export function gateTrack(prevInfo, beat, nowMs) {
  const prev = prevInfo && typeof prevInfo.updGate === "object" && prevInfo.updGate ? prevInfo.updGate : null;
  const pb = prevInfo && typeof prevInfo.beat === "object" && prevInfo.beat ? prevInfo.beat : null;
  const key = reqKey(beat?.reqs);
  const now = iso(nowMs);
  const live = (xs) => xs.filter((x) => typeof x === "string" && nowMs - t(x) < TRUST_MS && t(x) <= nowMs + 60000);
  let starts = prev ? live(Array.isArray(prev.starts) ? prev.starts : prev.startAt ? [prev.startAt] : []) : [];
  let how = prev ? String(prev.startHow || "") : "";
  const every = Math.max(10, Math.min(600, Number(pb?.every) || 60)) * 1000;
  const gap = pb ? nowMs - t(pb.at) : NaN;
  const pr = pb?.reqs && typeof pb.reqs === "object" ? pb.reqs : null, cr = beat?.reqs && typeof beat.reqs === "object" ? beat.reqs : null;
  if (!pb) { starts = [now]; how = "first beat"; }
  else if (String(pb.version || "") && String(beat?.version || "") && pb.version !== beat.version) { starts = [now]; how = "a new version"; }
  else if (pr && cr && pr.day && pr.day === cr.day && (Number(cr.n) || 0) < (Number(pr.n) || 0)) { starts = [now]; how = "its request count started again"; }
  else if (!(gap <= 2 * every + 15000)) { starts = [...starts, now].slice(-3); how = "beats again after " + Math.round(gap / 1000) + " s"; }
  else if (!prev) {
    // the first beat the gate sees: the starts from the connection history (each time the bridge beat again after
    // being off, in the last 12 h 10 min), if any; else not known
    const h = (Array.isArray(prevInfo?.history) ? prevInfo.history : []).filter((e) => e && e.kind === "bridge")
      .map((e) => e.state === "offline" ? e.to : e.state === "online" ? e.at : "").filter(Boolean).map((x) => iso(t(x)));
    starts = live(h).slice(-3);
    if (starts.length) how = "the connection history";
  }
  const quietSince = prev && prev.reqKey === key && prev.quietSince ? String(prev.quietSince) : now;
  return { reqKey: key, quietSince, starts, startAt: starts.length ? starts[starts.length - 1] : "", startHow: how };
}

// whether the bridge is at its time to look for an update (b), by any of its possible starts, and when that time is
function windowOf(s, nowMs) {
  const t0 = s + FIRST_CHECK_MS;
  const k = Math.max(0, Math.round((nowMs - t0) / EVERY_MS));
  const pc = t0 + k * EVERY_MS;
  const at = nowMs >= pc - BEFORE_MS && nowMs <= pc + AFTER_MS;
  return { at, check: pc, next: at ? pc : nowMs < pc - BEFORE_MS ? pc : pc + EVERY_MS };
}
export function checkWindow(g, nowMs) {
  const ss = (Array.isArray(g?.starts) ? g.starts : g?.startAt ? [g.startAt] : []).map(t).filter((s) => !isNaN(s) && nowMs - s <= TRUST_MS);
  if (!ss.length) return { at: true, known: false, next: "" };
  const ws = ss.map((s) => windowOf(s, nowMs));
  const hit = ws.find((w) => w.at);
  if (hit) return { at: true, known: true, check: iso(hit.check), next: iso(hit.check) };
  const next = Math.min(...ws.map((w) => w.next));
  return { at: false, known: true, check: iso(next), next: iso(next) };
}

// a) idle with Tally, as far as the beat says; "" when idle, else why not
export function busyWhy(beat, g, nowMs) {
  if (!beat || typeof beat !== "object") return "no beat";
  if (beat.busySince) return "Tally is busy (since " + beat.busySince + ")";
  if (beat.tallyState === "busy") return "Tally is busy";
  if (beat.updating) return "it is reading Tally";
  if (beat.tallyRetry) return "a request to Tally waits to be tried again";
  const r = beat.reqs && typeof beat.reqs === "object" ? beat.reqs : null;
  const none = !!r && (Number(r.n) || 0) === 0 && !r.last && !beat.tally;
  if (!none && !(nowMs - t(g?.quietSince) >= QUIET_MS)) return "a request to Tally in the last 3 minutes";
  return "";
}

// "1.2.3" < "1.2.10"
export function olderThan(a, b) {
  const x = String(a || "").split(".").map(Number), y = String(b || "").split(".").map(Number);
  if (x.length !== 3 || y.length !== 3 || x.some(isNaN) || y.some(isNaN)) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}
