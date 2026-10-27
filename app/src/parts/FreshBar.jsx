// How fresh FinCom's copy of the books is, on Reports and Look up: kept in step with Tally by the bridge, the last copy,
// or the cloud's copy; with the buttons to switch keeping in step on, bring in today's entries or check against Tally,
// and the result of that check. Was LK.freshBar (src/js/44); the work is LK (keepOn, bringToday, keepCheck).
// round 3 A (the owner, 14-Oct-2026): no status sentence here any more. "Books up to … · read …" and Update now are in
// the top bar's Tally panel; next-tally-icon: how Tally is, is the header's Tally icon only (below).
import Msg from "./Msg.jsx";
import { staleWords } from "./TallyLine.jsx";
import HeldBooks from "./HeldBooks.jsx";

const Btn = ({ onClick, className = "btn small", children }) => <button className={className} onClick={onClick}>{children}</button>;

function Check({ c }) {
  if (c.error) return <p className="note bad">The check could not run: <Msg text={c.error} /></p>;
  const odd = c.missing || c.differ || c.extra;
  return <p className={"note " + (odd || !c.listMatchesDayBook ? "bad" : "ok")}>{"Checked " + FC.monthLabel(c.ym) + " against Tally: Tally has " + c.tally + " entries, the copy " + c.copy + (odd ? " (" + c.missing + " missing, " + c.differ + " changed, " + c.extra + " no longer in Tally; the bridge puts these right on its next turn)" : ", all the same") + ". The light list "}
    {c.listMatchesDayBook ? "matches" : <b>does not match</b>}{" the day book for the first days (" + c.list + " and " + c.dayBook + " entries)" + (c.listMatchesDayBook ? "." : ": please tell us, so the bridge can be adjusted for your Tally.")}</p>;
}

// round 63 (the owner, 16-Oct-2026: "Tally messages only where they are needed, not on every page"): the Tally part of this
// bar is shown only when the books need the person: not read yet, read more than 3 days ago, days not read, reading
// stopped, or the first copy still being made. Fresh books: nothing about Tally here (the top bar's dot and its panel
// say it); a check's answer, the offline copy and the held lines (the figures are not complete) stay.
// next-tally-icon (27-Oct-2026; the owner: "don't need everywhere tally status"): no Tally status sentence here at all
// (stale books, the cloud's first copy, "Connect FinCom Bridge …", "In step with Tally now."): the header's Tally icon and
// its popover say how Tally is. Left: what the person can do (Keep in step, Bring in today's entries, Check against
// Tally), a check's answer, the offline copy, the held lines.
const OLD_MS = 3 * 86400e3;
export function booksNeedTally(b, cid) {
  b = b || {}; cid = cid || S.coId;
  const have = (b.vouchers || []).length > 0 || (typeof TCloud === "object" && TCloud.has(cid));
  if (!have) return true;
  if (staleWords(cid) && !/days? ago/.test(staleWords(cid))) return true;
  const m = (LK.fr() || {}).man || {};
  if (m.keep && (m.phase === "open" || m.phase === "first")) return true;
  const st = ((typeof TCloud === "object" && TCloud.book(cid)) || {}).state || {};
  if (st.phase === "first" || (st.trouble && st.trouble.at)) return true;
  const f = typeof booksFresh === "function" ? booksFresh(b, cid) : {}, a = typeof booksAsOf === "function" ? booksAsOf(cid) : null;
  const at = Math.max(Date.parse((f && f.at) || "") || 0, Date.parse((a && a.at) || "") || 0);
  return !at || Date.now() - at > OLD_MS;
}
// held: show the held lines' warning here (Look up leaves it to its answer, which shows it once one is on the page)
export default function FreshBar({ b, held = true }) {
  const f = LK.fr(), live = LK.live(), meta = (b && b.meta) || {}, have = (b.vouchers || []).length > 0, today = Audit.today(), m = f.man || {}, kp = f.keep || {};
  if (!have && !live && !meta.keep && !TCloud.has(S.coId)) return null;
  const chk = f.check ? <Check c={f.check} /> : null;
  // the server not answering when the books were opened: this is this computer's copy, said here (not only in passing)
  const off = b && b.offline ? <p className="note warn" data-books-offline="">{"FinCom’s server could not be reached: this is this computer’s copy of the books, as last saved here. It is brought up to date as soon as the server answers."}</p> : null;
  // the cloud's copy: what this page shows when it is the source
  const hb = held && <HeldBooks cid={S.coId} where="fresh" />;
  if (!booksNeedTally(b, S.coId)) return <>{hb}{(chk || off) && <div className="lk-fresh" data-fresh-quiet="">{chk}{off}</div>}</>;
  if (TCloud.has(S.coId) && ((meta.cloud && !m.keep) || !live)) return <>{hb}{(chk || off) && <div className="lk-fresh">{chk}{off}</div>}</>;
  let upTo = null, btns = null;
  if (m.keep) btns = live ? <Btn onClick={() => LK.keepCheck()}>Check against Tally</Btn> : null;
  else {
    upTo = have ? null : "No books in FinCom yet.";
    const keep = live && kp.ok && !kp.on, bring = live && have && String(meta.to) < today;
    if (keep || bring) btns = <>{keep && <Btn className="btn small primary" onClick={() => LK.keepOn(true)}>Keep this company in step with Tally</Btn>}
      {bring && <Btn onClick={() => LK.bringToday()}>Bring in today’s entries</Btn>}</>;
  }
  if (!upTo && !btns && !chk && !off) return hb || null;
  return <>{hb}<div className="lk-fresh">{upTo && <span className="note">{upTo}</span>}{btns}{chk}{off}</div></>;
}
