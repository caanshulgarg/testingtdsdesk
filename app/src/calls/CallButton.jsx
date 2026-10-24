// The Call button on a client's page (its Overview, beside the page's name): the same ways as Meetings, with this client
// chosen: Start a call now (the client's call: its open call is joined, not made twice), Create a meeting for later (a
// link and a code to send), Schedule a meeting (a time, people, the invite), past calls, and for the owner the client's
// recording setting. Shown only with the firm account signed in.
import { Calls } from "./launch.js";

export default function CallButton({ co }) {
  if (!co || !(typeof Cloud === "object" && Cloud.on && Cloud.on())) return null;
  const role = String((Cloud.st && Cloud.st.role) || ""), staff = role === "owner" || role === "staff";
  const close = (e) => { const d = e.currentTarget.closest("details"); if (d) d.open = false; };
  return <details className="bk-menu call-menu" data-call-menu="">
    <summary className="btn small" aria-label="Calls and meetings with this client">Call</summary>
    <div className="bk-menu-list">
      {staff && <button type="button" onClick={(e) => { close(e); Calls.start({ kind: "client", client_id: co.id }); }} data-call-client="">Start a call now</button>}
      {staff && <button type="button" onClick={(e) => { close(e); Calls.later({ client_id: co.id, title: "Meeting with " + co.name }); }} data-call-later="">Create a meeting for later</button>}
      {staff && <button type="button" onClick={(e) => { close(e); Calls.schedule({ client_id: co.id, title: "Meeting with " + co.name }); }} data-call-schedule="">Schedule a meeting</button>}
      <button type="button" onClick={(e) => { close(e); Calls.history({ client_id: co.id, name: co.name }); }} data-call-history="">Past calls</button>
      {staff && <button type="button" onClick={(e) => { close(e); Calls.meetings(); }} data-call-meetings="">All meetings</button>}
      {role === "owner" && <button type="button" onClick={(e) => { close(e); Calls.settings({ client_id: co.id, name: co.name }); }} data-call-settings="">Recording setting</button>}
    </div>
  </details>;
}
