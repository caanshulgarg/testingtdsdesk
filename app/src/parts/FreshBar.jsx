// How fresh FinCom's copy of the books is, on Reports and Look up: kept in step with Tally by the bridge, the last copy,
// or the cloud's copy; with the buttons to switch keeping in step on, bring in today's entries or check against Tally,
// and the result of that check. Was LK.freshBar (src/js/44); the work is LK (keepOn, bringToday, keepCheck).
// 2.1.3: first "Books as of 15:34 · Update now" (parts/TallyLine.jsx): Tally cannot send its changes by itself.
import Msg from "./Msg.jsx";
import { BooksAsOf } from "./TallyLine.jsx";
import HeldBooks from "./HeldBooks.jsx";

const hhmm = (s2) => fmtTime(s2);
const Btn = ({ onClick, className = "btn small", children }) => <button className={className} onClick={onClick}>{children}</button>;

function Check({ c }) {
  if (c.error) return <p className="note bad">The check could not run: <Msg text={c.error} /></p>;
  const odd = c.missing || c.differ || c.extra;
  return <p className={"note " + (odd || !c.listMatchesDayBook ? "bad" : "ok")}>{"Checked " + FC.monthLabel(c.ym) + " against Tally: Tally has " + c.tally + " entries, the copy " + c.copy + (odd ? " (" + c.missing + " missing, " + c.differ + " changed, " + c.extra + " no longer in Tally; the bridge puts these right on its next turn)" : ", all the same") + ". The light list "}
    {c.listMatchesDayBook ? "matches" : <b>does not match</b>}{" the day book for the first days (" + c.list + " and " + c.dayBook + " entries)" + (c.listMatchesDayBook ? "." : ": please tell us, so the bridge can be adjusted for your Tally.")}</p>;
}

// the cloud's copy of the books: how old, days not read yet, Tally not answering. Was TCloud.bar (src/js/49)
function CloudBar({ cid }) {
  const bk = TCloud.book(cid); if (!bk) return null;
  const st = bk.state || {}, sk = [].concat(st.skipped || []).filter(Boolean);
  // the same sentence as every other page (booksFresh, src/js/49)
  return <>{st.phase === "first" ? <><b>The books</b>{": the first copy is still being made (up to " + FC.when(String(st.doneTo || "")) + ")."}</> : <span data-fresh="" className={sk.length ? "bad" : ""}>{booksFresh(S.books, cid).text}</span>}
    {st.trouble && st.trouble.at && <>{" "}<span className="note">{"Tally did not answer at " + fmtTime(st.trouble.at) + "; the bridge carries on by itself."}</span></>}</>;
}

// held: show the held lines' warning here (Look up leaves it to its answer, which shows it once one is on the page)
export default function FreshBar({ b, held = true }) {
  const f = LK.fr(), live = LK.live(), meta = (b && b.meta) || {}, have = (b.vouchers || []).length > 0, sch = f.sch || {}, today = Audit.today(), m = f.man || {}, kp = f.keep || {};
  if (!have && !live && !meta.keep && !TCloud.has(S.coId)) return null;
  const chk = f.check ? <Check c={f.check} /> : null;
  // the cloud's copy: what this page shows when it is the source
  const hb = held && <HeldBooks cid={S.coId} where="fresh" />, hd = typeof booksHeld === "function" && !!booksHeld(S.coId);
  if (TCloud.has(S.coId) && ((meta.cloud && !m.keep) || !live)) return <>{hb}<div className="lk-fresh"><span className="note"><BooksAsOf cid={S.coId} />{" "}<CloudBar cid={S.coId} /> Totals come from this copy, so Tally is never held up.</span>{chk}</div></>;
  let upTo, btns = null;
  if (m.keep) {
    const seenMin = m.seen ? (Date.now() - Date.parse(m.seen)) / 60000 : 999;
    if (m.phase === "open") upTo = "The bridge is reading the opening balances, a few ledgers at a time.";
    else if (m.phase === "first") { const pct = Math.max(0, Math.min(99, Math.round(Audit.days(m.from, m.doneTo || m.from) / Math.max(1, Audit.days(m.from, today)) * 100))); upTo = <>The bridge is copying this company from Tally a few days at a time: up to <b>{FC.when(m.doneTo)}</b>{" (" + pct + "%). It carries on whenever the company is open in Tally."}</>; }
    else { const f = booksFresh(b, S.coId); upTo = <span data-fresh="" className={f.skipped.length ? "bad" : ""}>{f.text}{f.skipped.length ? " Figures touching those days may be out; the bridge tries them again at the next update." : ""}{seenMin < 5 && !hd ? " In step with Tally now." : ""}</span>; }
    upTo = <>{upTo}
      {m.trouble && m.trouble.at && <>{" "}<span className="note">{"Tally did not answer at " + hhmm(m.trouble.at) + "; the bridge leaves it alone for a while and tries again at the next update."}</span></>}</>;
    btns = live ? <Btn onClick={() => LK.keepCheck()}>Check against Tally</Btn> : null;
  } else {
    upTo = have ? <span data-fresh="">{booksFresh(b, S.coId).text}</span> : "No books in FinCom yet.";
    if (live) {
      btns = <>{kp.ok ? (kp.on ? null : <Btn className="btn small primary" onClick={() => LK.keepOn(true)}>Keep this company in step with Tally</Btn>) : <span className="note">Install FinCom Bridge from the Tally page to keep companies in step while they are open.</span>}
        {have && String(meta.to) < today && <Btn onClick={() => LK.bringToday()}>Bring in today’s entries</Btn>}
        {sch.on && <span className="note">{"Nightly copy is on" + (sch.next ? ", next " + sch.next : "") + "."}</span>}</>;
      if (kp.on) upTo = <>{upTo} The bridge reads it when this client is opened, on Update now, and in the nightly catch-up.</>;
    } else btns = <span className="note">Connect FinCom Bridge to keep this up to date.</span>;
  }
  return <>{hb}<div className="lk-fresh"><span className="note"><BooksAsOf cid={S.coId} />{" "}{upTo} Totals come from this copy, so Tally is never held up.</span>{btns}{chk}</div></>;
}
