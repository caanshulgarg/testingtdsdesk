// FinCom Bridge 2.1.3 reads Tally only after an event, and Tally cannot send its changes by itself, so a client's Tally
// is said in one line with one button (tallyLine, booksAsOf and tallyUpdateNow in src/js/49-tally-cloud.js):
//   TallyLine: "Connected · Tally open on NWS144 · last read 15:34" / "Tally not open on NWS144" / "NWS144 is offline" /
//              "Tally is not answering on NWS144 since 12:28" / "Reading paused on NWS144" · Update now
//   (FinCom 2.3.5: one vocabulary with the Tally page's cards: Connected / Offline / Tally not open / Reading stopped /
//   Needs you)
//   BooksAsOf: "Books as of 15:34 · Update now", wherever the client's books figures are shown

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
