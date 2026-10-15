// How fresh FinCom's copy of the books is, on Reports and Look up: kept in step with Tally by the bridge, the last copy,
// or the cloud's copy; with the buttons to switch keeping in step on, bring in today's entries or check against Tally,
// and the result of that check. Was LK.freshBar (src/js/44); the work is LK (keepOn, bringToday, keepCheck).
// round 3 A (the owner, 14-Oct-2026): no status sentence here any more. "Books up to … · read …" and Update now are in
// the top bar's Tally panel; this keeps what needs the person: the first copy's progress, Tally not answering, the buttons,
// a check's answer, the offline copy, and the one amber line when the books are stale (parts/TallyLine.jsx BooksStale).
import Msg from "./Msg.jsx";
import { BooksStale, staleWords } from "./TallyLine.jsx";
import HeldBooks from "./HeldBooks.jsx";

const hhmm = (s2) => fmtTime(s2);
const Btn = ({ onClick, className = "btn small", children }) => <button className={className} onClick={onClick}>{children}</button>;

function Check({ c }) {
  if (c.error) return <p className="note bad">The check could not run: <Msg text={c.error} /></p>;
  const odd = c.missing || c.differ || c.extra;
  return <p className={"note " + (odd || !c.listMatchesDayBook ? "bad" : "ok")}>{"Checked " + FC.monthLabel(c.ym) + " against Tally: Tally has " + c.tally + " entries, the copy " + c.copy + (odd ? " (" + c.missing + " missing, " + c.differ + " changed, " + c.extra + " no longer in Tally; the bridge puts these right on its next turn)" : ", all the same") + ". The light list "}
    {c.listMatchesDayBook ? "matches" : <b>does not match</b>}{" the day book for the first days (" + c.list + " and " + c.dayBook + " entries)" + (c.listMatchesDayBook ? "." : ": please tell us, so the bridge can be adjusted for your Tally.")}</p>;
}

// the cloud's copy of the books: only what needs saying (the first copy still being made, Tally not answering). Was
// TCloud.bar (src/js/49); how old the copy is, is in the Tally panel
function CloudBar({ cid }) {
  const bk = TCloud.book(cid); if (!bk) return null;
  const st = bk.state || {};
  return <>{st.phase === "first" && <><b>The books</b>{": the first copy is still being made (up to " + FC.when(String(st.doneTo || "")) + ")."}</>}
    {st.trouble && st.trouble.at && <>{" "}<span className="note">{"Tally did not answer at " + fmtTime(st.trouble.at) + "; the bridge carries on by itself."}</span></>}</>;
}

// round 63 (the owner, 16-Oct-2026: "Tally messages only where they are needed, not on every page"): the Tally part of this
// bar is shown only when the books need the person: not read yet, read more than 3 days ago, days not read, reading
// stopped, or the first copy still being made. Fresh books: nothing about Tally here (the top bar's dot and its panel
// say it); a check's answer, the offline copy and the held lines (the figures are not complete) stay.
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
  const f = LK.fr(), live = LK.live(), meta = (b && b.meta) || {}, have = (b.vouchers || []).length > 0, sch = f.sch || {}, today = Audit.today(), m = f.man || {}, kp = f.keep || {};
  if (!have && !live && !meta.keep && !TCloud.has(S.coId)) return null;
  const chk = f.check ? <Check c={f.check} /> : null;
  // the server not answering when the books were opened: this is this computer's copy, said here (not only in passing)
  const off = b && b.offline ? <p className="note warn" data-books-offline="">{"FinCom’s server could not be reached: this is this computer’s copy of the books, as last saved here. It is brought up to date as soon as the server answers."}</p> : null;
  // the cloud's copy: what this page shows when it is the source
  const hb = held && <HeldBooks cid={S.coId} where="fresh" />, hd = typeof booksHeld === "function" && !!booksHeld(S.coId);
  if (!booksNeedTally(b, S.coId)) return <>{hb}{(chk || off) && <div className="lk-fresh" data-fresh-quiet="">{chk}{off}</div>}</>;
  const stale = <BooksStale cid={S.coId} />;
  if (TCloud.has(S.coId) && ((meta.cloud && !m.keep) || !live)) return <>{hb}<div className="lk-fresh">{stale}<span className="note"><CloudBar cid={S.coId} /></span>{chk}{off}</div></>;
  let upTo, btns = null;
  if (m.keep) {
    const seenMin = m.seen ? (Date.now() - Date.parse(m.seen)) / 60000 : 999;
    if (m.phase === "open") upTo = "The bridge is reading the opening balances, a few ledgers at a time.";
    else if (m.phase === "first") { const pct = Math.max(0, Math.min(99, Math.round(Audit.days(m.from, m.doneTo || m.from) / Math.max(1, Audit.days(m.from, today)) * 100))); upTo = <>The bridge is copying this company from Tally a few days at a time: up to <b>{FC.when(m.doneTo)}</b>{" (" + pct + "%). It carries on whenever the company is open in Tally."}</>; }
    else { const f = booksFresh(b, S.coId); upTo = f.skipped.length ? <span className="bad">Figures touching the days not read may be out; the bridge tries them again at the next update.</span> : seenMin < 5 && !hd ? "In step with Tally now." : null; }
    upTo = <>{upTo}
      {m.trouble && m.trouble.at && <>{" "}<span className="note">{"Tally did not answer at " + hhmm(m.trouble.at) + "; the bridge leaves it alone for a while and tries again at the next update."}</span></>}</>;
    btns = live ? <Btn onClick={() => LK.keepCheck()}>Check against Tally</Btn> : null;
  } else {
    upTo = have ? null : "No books in FinCom yet.";
    if (live) {
      btns = <>{kp.ok ? (kp.on ? null : <Btn className="btn small primary" onClick={() => LK.keepOn(true)}>Keep this company in step with Tally</Btn>) : <span className="note">Install FinCom Bridge from the Tally page to keep companies in step while they are open.</span>}
        {have && String(meta.to) < today && <Btn onClick={() => LK.bringToday()}>Bring in today’s entries</Btn>}
        {sch.on && <span className="note">{"Nightly copy is on" + (sch.next ? ", next " + sch.next : "") + "."}</span>}</>;

    } else btns = <span className="note">Connect FinCom Bridge to keep this up to date.</span>;
  }
  return <>{hb}<div className="lk-fresh">{stale}{upTo && <span className="note">{upTo}</span>}{btns}{chk}{off}</div></>;
}
