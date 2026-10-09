// The client's Tally link (the Tally redesign, the owner, 09-Oct-2026: "tally link is very confusing.. whatever actionable
// is or what relevant information is.. this should be there"), on Client setup → Tally and the client's From Tally tab:
//   linked:     ONE line, "Linked to GARG SHEKHAR on NWS144 · last entry 14:03 IST · Connected", with Change company and
//               Update now (Resume instead, for an owner, while reading is stopped), and "Tally page" (the Tally page,
//               focused on this client's computer and company);
//   not linked: three numbered steps in plain words;
//   then, only when a person must act, one plain line each with its button: entries held that need that day's Day Book
//   (and the cloud's gap), other held entries, the company's starting point.
// The words come from what the page already reads: tallyLine (src/js/49, TLight's computers and companies), the held
// lines (AlertHub.heldFor, Rec.needKind: src/js/61, 63) and the days that need a Day Book (needDays, From Tally). No new
// request is made: Change company calls the same tally_company_link as Settings → Books in the cloud (TCloud.link).
import { useState } from "react";
import { needDays } from "../screens/books/FromTally.jsx";

const STATE = { open: ["ok", "Connected"], closed: ["warn", "Tally not open"], offline: ["bad", "Not connected"], notanswering: ["bad", "Tally not answering"],
  paused: ["warn", "Reading paused"], stopped: ["bad", "Reading stopped"] };
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");

// the Tally company linked to this client (FinCom's cloud), and the companies a computer has seen (for Change company)
function linkOf(co) {
  const tl = (typeof TLight === "object" && TLight.st) || {}, cos = tl.cos || (typeof TCloud === "object" && TCloud.pane && TCloud.pane.companies) || [];
  const link = cos.find((c) => String(c.client_id || "") === String(co.id));
  return { company: (link && link.company) || "", seen: cos };
}
// the held lines of this client, by what a person must do (Rec.needKind): daybook (with dupid), baseline, other
function heldNeeds(cid) {
  const out = { daybook: 0, baseline: 0, other: 0 };
  if (typeof AlertHub !== "object" || !AlertHub.heldFor || typeof Rec !== "object" || !Rec.needKind) return out;
  let lines = []; try { lines = AlertHub.heldFor([cid]) || []; } catch (e) { lines = []; }
  lines.forEach((l) => { const k = Rec.needKind(l); if (!k) return; if (k === "daybook" || k === "dupid") out.daybook++; else if (k === "baseline") out.baseline++; else if (k !== "readstop") out.other++; });
  return out;
}

function ChangeCompany({ co, cur, seen, done }) {
  const free = seen.filter((c) => c.company && (!c.client_id || String(c.client_id) === String(co.id)));
  if (!free.length) return <span className="note" data-tally-link-nochoice="">No other Tally company has been seen yet. Open it in TallyPrime on the Tally computer; it shows up here within a minute.</span>;
  return <select data-tally-link-pick="" aria-label={"Tally company for " + co.name} defaultValue={cur || ""}
    onChange={async (ev) => { const v = ev.target.value; if (!v || v === cur) return; await TCloud.link(v, co.id); done(); }}>
    <option value="">Choose the Tally company…</option>
    {free.map((c) => <option key={c.company} value={c.company}>{c.company}</option>)}</select>;
}

export default function TallyLink({ co, where = "setup", b = null }) {
  const [pick, setPick] = useState(false);
  if (!co) return null;
  const l = typeof tallyLine === "function" ? tallyLine(co) : null, { company, seen } = linkOf(co), owner = isOwner();
  const cloud = typeof TCloud === "object" && TCloud.on();
  const openTally = () => (typeof openTallyFor === "function" ? openTallyFor(co.id) : navHome("tally"));
  const tallyBtn = <button className="linkbtn" data-tally-link-page="" onClick={openTally}>Tally page</button>;
  // not linked: three steps, in plain words
  if (!company && !l) return <section className="tlink" data-tally-link="unlinked">
    <b>{co.name + " is not linked to Tally yet"}</b>
    <ol className="tlink-steps" data-tally-link-steps="">
      <li>Install FinCom Bridge on the computer where TallyPrime runs. <button className="linkbtn" data-tally-link-install="" onClick={openTally}>How</button></li>
      <li>{"Open " + (co.tallyName ? co.tallyName : "this client's company") + " in TallyPrime on that computer."}</li>
      <li>Choose that company for this client:{" "}
        {cloud ? <ChangeCompany co={co} cur="" seen={seen} done={() => render()} /> : <span className="note">sign in to the firm account first.</span>}</li>
    </ol>
  </section>;
  const [lv, word] = l ? STATE[l.state] || [l.level, l.text] : ["warn", "Not connected"];
  const last = l && l.read ? tallyHm(l.read) : "";
  const text = "Linked to " + (company || co.tallyName || "its Tally company") + (l && l.computer ? " on " + l.computer : "") + " · last entry " + (last || "not received yet");
  // what a person must do, one line each
  const h = heldNeeds(co.id), books = b || (S.books && S.books.cid === co.id ? S.books : null);
  const days = needDays(books || {}, co.id), nd = days.reduce((a, x) => a + x.days, 0);
  const needs = [];
  // From Tally lists each day with its own Upload: there the line says how many and points to them
  if (nd || h.daybook) needs.push(<li key="daybook" data-tally-need="daybook"><span>{nd ? plural(nd, "day needs", "days need") + " that day's Day Book" + (h.daybook ? " (" + plural(h.daybook, "entry", "entries") + " waiting)" : "")
      : plural(h.daybook, "entry needs", "entries need") + " that day's Day Book"}</span>
    <button className="btn small primary" data-tally-need-upload="" onClick={() => where === "books" && days.length ? tallyPickFor(tallyDate(days[0].from), tallyDate(days[0].to)) : goClient("books:import")}>Upload</button></li>);
  if (h.baseline) needs.push(<li key="baseline" data-tally-need="baseline"><span>{"The starting point of " + (company || "this company") + " is not recorded yet: " + plural(h.baseline, "entry waits", "entries wait")}</span>
    <button className="btn small" data-tally-need-baseline="" onClick={openTally}>Open the Tally page</button></li>);
  if (h.other) needs.push(<li key="held" data-tally-need="held"><span>{plural(h.other, "entry from Tally is", "entries from Tally are") + " held and need a look"}</span>
    <button className="btn small" data-tally-need-held="" onClick={() => Rec.openActivity(co.id, "held")}>See them</button></li>);
  const stopped = l && l.state === "stopped";
  return <section className="tlink" data-tally-link={l ? l.state : "linked"}>
    <div className="tlink-line">
      <span data-tally-link-text="">{text + " · "}<span className={"tag " + lv} data-tally-link-state="">{word}</span>
        {stopped && <span className="note" data-tally-link-why="">{" " + l.text.replace(/^Reading stopped /, "(") + ")"}</span>}</span>
      <span className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {stopped ? (owner && l.stop ? <button className="btn small primary" data-read-resume-line="" onClick={() => TCloud.readResume(l.stop.all ? null : { device: { id: l.stop.deviceId }, computer: l.stop.computer || l.computer })}>Resume</button>
          : <span className="note">An owner of the firm can resume it.</span>)
          : <button className="btn small" data-update-now="" onClick={() => tallyUpdateNow(co.id)}>{l && l.reading ? "Reading now…" : "Update now"}</button>}
        {cloud && <button className="btn small" data-tally-link-change="" aria-expanded={pick ? "true" : "false"} onClick={() => setPick(!pick)}>Change company</button>}
        {tallyBtn}
      </span>
    </div>
    {pick && <div style={{ marginTop: 8 }} data-tally-link-changebox=""><ChangeCompany co={co} cur={company} seen={seen} done={() => setPick(false)} /></div>}
    {needs.length > 0 && <ul className="tlink-needs" data-tally-link-needs="">{needs}</ul>}
  </section>;
}
