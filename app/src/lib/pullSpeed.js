// next-fast-entries (the owner's "Yes to both", 07-Nov-2026): the time left of "Bring books from Tally" from the
// bridge's own speed when its beat gives one. FinCom's cloud keeps it from the beat (tally-ingest periodPullOf:
// info.beat.periodPull.speed [{company, perMin}], the entries FinCom took in the bridge's last 10 minutes, a minute); it
// is used only while that beat is fresh (3 minutes), only while the entries are being brought (not while the year's days
// are counted), else the cloud's own estimate (tally_period_status_of) stays. Nothing new is asked of anyone.
export const SPEED_FRESH_MS = 3 * 60 * 1000;
const key = (n) => String(n || "").replace(/\s+/g, " ").trim().toLowerCase();

// the bridge's entries a minute for the company, from the fresh beats of the firm's computers (0: none)
export function bridgeSpeed(company, devs, now = Date.now()) {
  let best = 0;
  for (const d of [].concat(devs || [])) {
    const b = ((d && d.info) || {}).beat || {}, t = Date.parse(b.at || "");
    if (!t || now - t > SPEED_FRESH_MS || t - now > 60000) continue;
    for (const s of [].concat((b.periodPull || {}).speed || [])) {
      if (s && key(s.company) === key(company)) best = Math.max(best, Math.floor(Number(s.perMin) || 0));
    }
  }
  return best;
}

// a book of tally_fetch_summary with its period's rate and time left from the bridge's speed when there is one (a copy;
// the book as it is otherwise)
export function pullPaced(book, devs, now = Date.now()) {
  const p = book && book.pull;
  if (!p || p.state !== "going" || p.done || p.counting) return book;
  const r = bridgeSpeed(book.company, devs, now);
  if (!(r > 0)) return book;
  const y = Number(p.y || 0), left = Math.max(0, y - Math.min(Number(p.x || 0), y));
  return { ...book, pull: { ...p, rate: r, etaMin: left > 0 ? Math.max(1, Math.ceil(left / r)) : p.etaMin, paceFrom: "bridge" } };
}
