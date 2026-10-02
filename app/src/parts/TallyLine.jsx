// FinCom Bridge 2.1.3 reads Tally only after an event, and Tally cannot send its changes by itself, so a client's Tally
// is said in one line with one button (tallyLine, booksAsOf and tallyUpdateNow in src/js/49-tally-cloud.js):
//   TallyLine: "Tally open on NWS144 · last read 15:34" / "Tally is closed on NWS144" / "NWS144 is offline" /
//              "Tally is not answering on NWS144 since 12:28" / "Background reading paused on NWS144" · Update now
//   BooksAsOf: "Books as of 15:34 · Update now", wherever the client's books figures are shown

export default function TallyLine({ co, update = true }) {
  if (!co || typeof tallyLine !== "function") return null;
  const l = tallyLine(co);
  if (!l) return null;
  return <span className="tally-line" data-tally-line={l.state}>
    <span className={"tag " + l.level} data-tally-line-text="">{l.text}</span>
    {update && <>{" "}<button className="linkbtn" data-update-now="" onClick={() => tallyUpdateNow(co.id)}>Update now</button></>}
  </span>;
}

export function BooksAsOf({ cid }) {
  if (typeof booksAsOf !== "function") return null;
  const a = booksAsOf(cid);
  if (!a) return null;
  return <span className="books-asof" data-books-asof="" title={a.say}>
    <b>{a.text}</b>{" · "}<button className="linkbtn" data-update-now="" onClick={() => tallyUpdateNow(cid)}>Update now</button>
  </span>;
}
