// A client's one Tally status (next-link-record; lib/linkStatus.js linkWord: Linked / Waiting for Tally / Needs you / Not
// linked, one line, at most one button). Beside the client's title chip (TallyChip, where="title": the chip says the word,
// this the line and the button). Its own file, fetched with the Tally page's (the first file is at its size budget): it
// puts the one function on globalThis.LinkWord (lib/tallyState.js clientTallyState hands every chip over to it: the
// title, the Clients list, Client setup), whose answer carries this line (after), which TallyChip draws.
import { useState, createElement } from "react";
import "../../../src/js/98-link-record.js";
import { linkWord } from "../lib/linkStatus.js";
import { portHowWords, PORT_MIN, PORT_MAX } from "../lib/tallyPort.js";
import "./linkStatus.css";

export default function LinkStatus({ co, where = "title", company = "" }) {
  const [how, setHow] = useState(false);
  if (!co || (where !== "title" && where !== "row")) return null;
  const s = linkWord(co, company);
  if (!s || (where === "row" && s.kind === "unlinked")) return null;
  // the title bar has little room: a port problem in short there; the whole line in its tip and in the steps' box
  // (on a Tally page row the pill says the word and the line: the button only)
  const words = where === "row" ? "" : where === "title" && s.port ? "Port " + s.port.port + ": use " + PORT_MIN + "–" + PORT_MAX + ", " + s.port.free + " is free" : s.line;
  const b = s.button;
  return <span className={"link-status " + s.level} data-link-status={s.kind} data-link-status-at={where} title={s.text} role="status">
    {words && <span className="link-status-words" data-link-status-words="">{words}</span>}
    {b && <button type="button" className="linkbtn" data-link-status-go={s.kind} aria-expanded={s.port ? how : undefined}
      onClick={(ev) => { ev.stopPropagation(); if (s.port) setHow(!how); else if (b.act) b.act(); }}>{s.port && how ? "Hide the steps" : b.label}</button>}
    {s.port && how && <span className="link-status-how note" data-link-status-how="">{<b className="link-status-warn">{s.line + "."}</b>}{portHowWords(s.port.free)}</span>}
  </span>;
}
// the one function for every chip (lib/tallyState.js clientTallyState), with the line beside the title chip (TallyChip
// draws p.after(where))
if (typeof globalThis === "object") globalThis.LinkWord = (co, company) => { const w = linkWord(co, company); if (w) w.after = (where) => createElement(LinkStatus, { co, where }); return w; };
