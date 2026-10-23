// The one button calls add to a client's page (its Overview, beside the page's name): Call client, Schedule meeting,
// past calls, and for the owner the client's recording setting. Shown only with the firm account signed in.
import { Calls } from "./launch.js";

export default function CallButton({ co }) {
  if (!co || !(typeof Cloud === "object" && Cloud.on && Cloud.on())) return null;
  const role = String((Cloud.st && Cloud.st.role) || ""), staff = role === "owner" || role === "staff";
  const close = (e) => { const d = e.currentTarget.closest("details"); if (d) d.open = false; };
  return <details className="bk-menu call-menu" data-call-menu="">
    <summary className="btn small" aria-label="Calls with this client">Call</summary>
    <div className="bk-menu-list">
      {staff && <button type="button" onClick={(e) => { close(e); Calls.start({ kind: "client", client_id: co.id }); }} data-call-client="">Call client</button>}
      {staff && <button type="button" onClick={(e) => { close(e); Calls.schedule({ client_id: co.id, title: "Meeting with " + co.name }); }} data-call-schedule="">Schedule meeting</button>}
      <button type="button" onClick={(e) => { close(e); Calls.history({ client_id: co.id, name: co.name }); }} data-call-history="">Past calls</button>
      {role === "owner" && <button type="button" onClick={(e) => { close(e); Calls.settings({ client_id: co.id, name: co.name }); }} data-call-settings="">Recording setting</button>}
    </div>
  </details>;
}
