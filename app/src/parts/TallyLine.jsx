// FinCom Bridge 2.1.3 reads Tally only after an event, and Tally cannot send its changes by itself, so a client's Tally
// is said in one line with one button (tallyLine, booksAsOf and tallyUpdateNow in src/js/49-tally-cloud.js):
//   TallyLine: "Connected · Tally open on NWS144 · last read 15:34" / "Tally not open on NWS144" / "NWS144 is offline" /
//              "Tally is not answering on NWS144 since 12:28" / "Reading paused on NWS144" · Update now
//   (FinCom 2.3.5: one vocabulary with the Tally page's cards: Connected / Offline / Tally not open / Reading stopped /
//   Needs you)
//   BooksAsOf: "Books as of 15:34 · Update now" (no longer on the pages: round 3 A, below)
//   round 3 A (the owner, 14-Oct-2026): how fresh the books are leaves the page body. PanelBooks, in the top bar's Tally
//   panel: "Books up to 13-Oct-2026 · read 15:34" and Update now, the rest (and the timing) under Details for support.
//   BooksStale: on a page, one small amber line, only when the books are over 2 days old, a day was not read, or
//   reading has stopped; it opens the panel.

export default function TallyLine({ co, update = true }) {
  if (!co || typeof tallyLine !== "function") return null;
  const l = tallyLine(co);
  if (!l) return null;
  // round 4, item 25: FinCom has stopped reading on the client's computer: "Reading stopped by <name> at <time>: <reason>",
  // and Resume for an owner (tally_read_resume for that computer, or for all when the stop is for all); no Update now
  if (l.state === "stopped") {
    const owner = S.account && S.account.me && S.account.me.role === "owner";
    return <span className="tally-line" data-tally-line="stopped">
      <span className="tag bad" data-tally-line-text="">{l.text}</span>
      {owner && l.stop && typeof TCloud === "object" && <>{" · "}<button className="linkbtn" data-read-resume-line="" onClick={() => TCloud.readResume(l.stop.all ? null : { device: { id: l.stop.deviceId }, computer: l.stop.computer || l.computer })}>Resume</button></>}
    </span>;
  }
  return <span className="tally-line" data-tally-line={l.state}>
    <span className={"tag " + l.level} data-tally-line-text="">{l.text}</span>
    {update && <>{" "}<button className="linkbtn" data-update-now="" onClick={() => tallyUpdateNow(co.id)}>Update now</button></>}
  </span>;
}

// round 14c (C6, owner item 5): the cloud copy may hold no entries for the current financial year; one note here, the
// piece every books screen shows (booksYearNote, src/js/49), none when the copy has current-year entries
const YearNote = ({ cid }) => { const t = typeof booksYearNote === "function" ? booksYearNote(cid) : ""; return t ? <span className="books-year-note" data-books-year-note="">{t}</span> : null; };
export function BooksAsOf({ cid }) {
  if (typeof booksAsOf !== "function") return null;
  const a = booksAsOf(cid);
  if (!a) return <YearNote cid={cid} />;
  return <span className="books-asof" data-books-asof="" title={a.say}>
    <b>{a.text}</b>{" · "}<button className="linkbtn" data-update-now="" onClick={() => tallyUpdateNow(cid)}>Update now</button>
    {" "}<YearNote cid={cid} />
  </span>;
}

const STALE_DAYS = 2;
const dayOf = (d8) => (d8 && typeof tallyDate === "function" ? fmtDate(tallyDate(d8)) : "");
// what is wrong with the books' freshness, in words, or "" (books read within 2 days, every day read, reading on)
export function staleWords(cid) {
  const co = S.companies && S.companies[cid];
  const l = co && typeof tallyLine === "function" ? tallyLine(co) : null;
  if (l && l.state === "stopped") return String(l.text || "Reading from Tally has stopped").replace(/\.?$/, ".");
  const a = typeof booksAsOf === "function" ? booksAsOf(cid) : null;
  const f = typeof booksFresh === "function" ? booksFresh(S.books && S.books.cid === cid ? S.books : {}, cid) : { skipped: [] };
  if (f.skipped && f.skipped.length) return "Books: " + f.skipped.length + (f.skipped.length === 1 ? " day" : " days") + " not read from Tally yet (" + f.skipped.slice(0, 3).map(dayOf).join(", ") + (f.skipped.length > 3 ? " and " + (f.skipped.length - 3) + " more" : "") + ").";
  const at = a && Date.parse(a.at);
  if (at && Date.now() - at > STALE_DAYS * 86400e3) {
    const d = Math.floor((Date.now() - at) / 86400e3);
    return "Books last read from Tally " + d + " days ago (" + fmtDate(new Date(at)) + ").";
  }
  return "";
}
export function BooksStale({ cid }) {
  // the books hold nothing of this financial year (round 14c C6): said in the same one line
  const w = staleWords(cid), y = typeof booksYearNote === "function" ? booksYearNote(cid) : "";
  if (!w && !y) return null;
  return <p className="books-stale" data-books-stale="" role="status">{w}{w && y ? " " : ""}{y && <span data-books-year-note="">{y}</span>}{" "}
    <button className="linkbtn" data-books-stale-open="" onClick={() => { if (!S.tallyPanel) doAct("tallyPanel"); }}>See Tally</button></p>;
}
// whether the panel shows the books' part (it then carries the one Update now)
export function panelBooksShown(cid) {
  if (!cid) return false;
  const a = typeof booksAsOf === "function" ? booksAsOf(cid) : null;
  const f = typeof booksFresh === "function" ? booksFresh(S.books && S.books.cid === cid ? S.books : {}, cid) : null;
  return !!(a || (f && f.last));
}
// the Tally panel's books part: what the books hold, when they were read, Update now; Details for support
export function PanelBooks({ cid }) {
  if (!panelBooksShown(cid)) return null;
  const a = typeof booksAsOf === "function" ? booksAsOf(cid) : null;
  const b = S.books && S.books.cid === cid ? S.books : null;
  const f = typeof booksFresh === "function" ? booksFresh(b || {}, cid) : null;
  const up = () => (a && typeof tallyUpdateNow === "function" ? tallyUpdateNow(cid) : doAct("keepNow"));
  const w = staleWords(cid);
  return <div className="tp-books" data-panel-books="">
    <p style={{ margin: "10px 0 4px" }}><b>{"Books up to " + (f && f.last ? dayOf(f.last) : "—")}</b>
      {a && <span className="note">{" · read " + tallyHm(a.at)}</span>}{" · "}
      <button className="linkbtn" data-update-now="" onClick={up}>Update now</button></p>
    {w && <p className="books-stale" style={{ margin: "0 0 4px" }}>{w}</p>}
    <YearNote cid={cid} />
    <details className="tp-details" data-panel-details=""><summary className="note">Details</summary><div className="note">
      {a && <p data-books-asof="" title={a.say}>{a.text + "."}</p>}
      {a && <p>{a.say}</p>}
      {f && <p data-fresh="">{f.text}</p>}
      {b && b.openMs != null && <p data-opentime="">{"Opened in " + (b.openMs / 1000).toFixed(1) + " s" + (b.readyMs != null ? ", every entry in " + (b.readyMs / 1000).toFixed(1) + " s" : "") + "."}</p>}
    </div></details>
  </div>;
}
