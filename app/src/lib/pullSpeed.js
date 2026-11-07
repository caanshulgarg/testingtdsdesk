// next-fast-entries (the owner's "Yes to both", 07-Nov-2026): the time left of "Bring books from Tally" from the
// bridge's own speed when its beat gives one. Only a bridge whose fast read is on (FastEntries) reports a speed, and
// FinCom's cloud keeps it by BOOK (tally-ingest speedBooksFor: the book of that company whose recorded company GUID is
// the bridge's): info.beat.periodPull.speed [{book, perMin}], the entries FinCom took in the bridge's last 10 minutes
// of the period's own days (never counting or "Check for changes" days), a minute. It is used only while that beat is
// under 3 minutes old and the period's entries are being brought (not while its days are counted); nothing is carried
// past that (no older speed, no decay). Otherwise the cloud's own estimate (tally_period_status_of) as before.
export const SPEED_FRESH_MS = 3 * 60 * 1000;

// the bridge's entries a minute for the book, from the fresh beats of the firm's computers (0: none)
export function bridgeSpeed(book, devs, now = Date.now()) {
  let best = 0;
  if (!book) return 0;
  for (const d of [].concat(devs || [])) {
    const b = ((d && d.info) || {}).beat || {}, t = Date.parse(b.at || "");
    if (!t || now - t > SPEED_FRESH_MS || t - now > 60000) continue;
    for (const s of [].concat((b.periodPull || {}).speed || [])) {
      if (s && s.book === book) best = Math.max(best, Math.floor(Number(s.perMin) || 0));
    }
  }
  return best;
}

// a book of tally_fetch_summary with its period's rate and time left from the bridge's speed when there is one (a copy;
// the book as it is otherwise)
export function pullPaced(book, devs, now = Date.now()) {
  const p = book && book.pull;
  if (!p || p.state !== "going" || p.done || p.counting) return book;
  const r = bridgeSpeed(book.book, devs, now);
  if (!(r > 0)) return book;
  const y = Number(p.y || 0), left = Math.max(0, y - Math.min(Number(p.x || 0), y));
  return { ...book, pull: { ...p, rate: r, etaMin: left > 0 ? Math.max(1, Math.ceil(left / r)) : p.etaMin, paceFrom: "bridge" } };
}
