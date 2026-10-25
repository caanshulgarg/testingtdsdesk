// Today's line of meetings (next-calls-meet, 23-Oct-2026): the meetings someone hosts or is invited to (by their sign-in
// email), open now or within the next 24 hours, each with Join; and the same as the bell's notices. Read when Today or the
// bell opens (upcoming.js), never with the page.
import { useEffect } from "react";
import { Calls } from "./launch.js";
import { refreshMeetings, soonMeetings, meetWhen } from "./upcoming.js";

export function MeetToday() {
  useEffect(() => { refreshMeetings(); }, []);
  const list = soonMeetings();
  if (!list.length) return null;
  return <div className="due-line meet-today" data-meet-today={list.length}>
    <span className="note"><b>{list.length === 1 ? "1 meeting" : list.length + " meetings"}</b> today:</span>
    {list.slice(0, 3).map((r, i) => <span key={r.id}>{i ? " · " : " "}{r.status === "open" ? "now" : meetWhen(r.scheduled_at)} {r.title} <button className="linkbtn" onClick={() => Calls.join(r.id)} data-meet-today-join={r.title}>Join</button></span>)}
    {list.length > 3 && <> · <button className="linkbtn" onClick={() => Calls.meetings()}>{list.length - 3} more</button></>}
  </div>;
}
// the bell's notices: a meeting in progress or starting within the hour
export function meetAlerts(now = Date.now()) {
  return soonMeetings(now).filter((r) => r.status === "open" || Date.parse(r.scheduled_at) - now < 3600000)
    .map((r) => ({ key: "meet:" + r.id, sev: "info", text: (r.status === "open" ? "Meeting in progress: " : "Meeting at " + meetWhen(r.scheduled_at) + ": ") + r.title, act: { label: "Join", run: () => Calls.join(r.id) } }))
    // next-calls-lobby: people asking to join (knock.jsx, once loaded), first
    .reduce((a, x) => a.concat([x]), window.FinComKnocks ? window.FinComKnocks() : []);
}
