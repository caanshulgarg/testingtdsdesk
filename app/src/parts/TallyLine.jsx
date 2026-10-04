// FinCom Bridge 2.1.3 reads Tally only after an event, and Tally cannot send its changes by itself, so a client's Tally
// is said in one line with one button (tallyLine, booksAsOf and tallyUpdateNow in src/js/49-tally-cloud.js):
//   TallyLine: "Tally open on NWS144 · last read 15:34" / "Tally is closed on NWS144" / "NWS144 is offline" /
//              "Tally is not answering on NWS144 since 12:28" / "Background reading paused on NWS144" · Update now
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

// phase 2 (migration 44, item 9): a PC without the recorder changed Tally (tally_sync_cursor.gap): one red line a book with
// the cloud's words, the change numbers, and the way to fill the gap (Books -> From Tally -> Day Book, the dates filled in
// from gap.since to today). Nothing without a gap, or on a cloud without the column (Rec.gapFor, src/js/61)
export function GapLine({ cid }) {
  if (typeof Rec !== "object" || !cid) return null;
  const list = Rec.gapFor(cid);
  if (!list.length) return null;
  return <>{list.map(({ book, gap }) => <div key={book} className="bk-alert bad" data-gap-line="" style={{ margin: "4px 0" }}>
    {Rec.gapWords(gap) + " "}<button className="btn small" data-gap-upload="" onClick={() => Rec.uploadDays(cid, gap)}>Upload the Day Book for these days</button>
  </div>)}</>;
}
// phase 2 (F36, N102): at the top of a client's pages, in red, each computer that keeps the client's company open in Tally
// without recording its changes (FinCom Bridge 2.1.9's heartbeat: info.bridges[id].recorder), then the gap line. Nothing
// while no bridge reports a recorder (before 2.1.9)
export function RecorderNotes({ cid }) {
  if (typeof Rec !== "object" || !cid || typeof TCloud !== "object" || !TCloud.on()) return null;
  const off = [...new Set(Rec.clientNotRecording(cid).map((x) => x.pc))];
  const gaps = Rec.gapFor(cid);
  // round 20 (d.1): this client's unread alerts (tally_alerts, migration 47), a line each, with Mark read for owner and staff
  const alerts = Rec.clientAlerts(cid), can = Rec.canWrite(), msg = Rec.alerts.msg;
  if (!off.length && !gaps.length && !alerts.length) return null;
  return <div data-recorder-notes="" style={{ margin: "0 0 10px" }}>
    {off.map((pc) => <p key={pc} className="bk-alert bad" data-recorder-banner="" style={{ margin: "4px 0" }}>{"Tally changes are not being recorded on " + pc}</p>)}
    {alerts.map((x) => <p key={x.id} className="bk-alert warn" data-client-alert={String(x.id)} style={{ margin: "4px 0" }}>
      {Rec.alertKind(x.kind) + ": " + (x.words || "") + (x.at ? " (" + fmtDateTime(x.at) + ")" : "") + " "}
      {can && <button className="linkbtn" data-alert-read="" disabled={!!(msg && msg.busy)} onClick={() => Rec.alertRead(x)}>Mark read</button>}</p>)}
    {msg && msg.err && alerts.length > 0 && <p className="bk-alert bad" data-alerts-msg="" style={{ margin: "4px 0" }}>{msg.err}</p>}
    <GapLine cid={cid} />
    <button className="linkbtn note" data-sync-open="" onClick={() => Rec.openActivity(cid)}>See this client’s sync activity</button>
  </div>;
}
