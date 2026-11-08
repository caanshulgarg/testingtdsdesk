// bridge 2.5.10 (the owner: "Bridge should work every time except when Tally itself is unavailable"). From what the page
// already reads (the firm's computers, tally_devices: info.beat.at, info.lastStop / info.beat.lastStop kept by
// tally-ingest), never asking anything new:
//   bridgeStopped(devs)  every FinCom Bridge of the firm silent for more than 10 minutes (the newest heartbeat, within the
//                        last 7 days): {at, dev, title, todo}; the top line says "the office Tally computer", the
//                        computer's name only under Advanced (stoppedWhere)
//   bridgeBack(devs)     a bridge heard now that says why its last run ended, within 24 hours of running again:
//                        "FinCom Bridge restarted itself at 10:42 IST after its heartbeat stopped moving."
// Loaded only with the Tally page's code (TallySimple.jsx).
const IST = 5.5 * 3600e3, MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STOP_MS = 10 * 60000, LIVE_MS = 3 * 60000;
function when(t, now) {
  const d = new Date(t + IST), n = new Date(now + IST), hm = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + " IST";
  const day = (x) => Math.floor(x.getTime() / 864e5);
  return day(d) === day(n) ? hm : day(n) - day(d) === 1 ? "yesterday " + hm : d.getUTCDate() + "-" + MON[d.getUTCMonth()] + " " + hm;
}
const beatAt = (d) => Date.parse(String((((d && d.info) || {}).beat || {}).at || (d && d.last_seen) || "")) || 0;
const live = (devs) => [].concat(devs || []).filter((d) => d && !d.revoked);
export function bridgeStopped(devs, now = Date.now()) {
  const l = live(devs).map((d) => ({ d, t: beatAt(d) })).filter((x) => x.t > 0).sort((a, b) => b.t - a.t);
  if (!l.length) return null;
  const { d, t } = l[0];
  if (now - t <= STOP_MS || now - t > 7 * 864e5) return null;
  return { at: t, dev: d, title: "FinCom Bridge on the office Tally computer stopped answering at " + when(t, now),
    todo: "Check that the office Tally computer is on and signed in to Windows. FinCom Bridge starts again by itself within 5 minutes; if it does not, restart that computer." };
}
const WHY = { exit: "it stopped unexpectedly", panic: "an error inside FinCom Bridge", stall: "its heartbeat stopped moving", hang: "it stopped answering on that computer",
  unclean: "the computer was turned off or restarted", notRunning: "it was found not running" };
export function bridgeBack(devs, now = Date.now()) {
  let best = null;
  live(devs).forEach((d) => {
    if (now - beatAt(d) > LIVE_MS) return;
    const i = (d && d.info) || {};
    [i.lastStop, (i.beat || {}).lastStop].forEach((s) => {
      const b = s && Date.parse(s.back || "");
      if (b && now - b < 864e5 && now - b > -3600e3 && (s.why === "sleep" || WHY[s.why]) && (!best || b > best.b)) best = { b, s, d };
    });
  });
  if (!best) return null;
  const w = best.s.why === "sleep" ? "FinCom Bridge was back at " + when(best.b, now) + " after the office Tally computer slept or its clock changed."
    : "FinCom Bridge restarted itself at " + when(best.b, now) + " after " + WHY[best.s.why] + ".";
  return { at: best.b, why: best.s.why, dev: best.d, text: w };
}
// under Advanced only: which computer
export const stoppedWhere = (st, pcName) => st ? "FinCom Bridge on " + (pcName || "the office Tally computer") + " stopped answering at " + when(st.at, Date.now()) + "." : "";
