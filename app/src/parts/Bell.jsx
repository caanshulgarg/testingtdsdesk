// Every alert of the app in one place (the owner's round 3 of the UI pass, 05-Oct-2026): the bell in the top bar with
// the count, and the list it opens; and the ONE slim line the Tally page and a client's Books page show. The alerts
// themselves (one a problem, plain words, the advice that matches the cause, clearing themselves) are AlertHub.list()
// (src/js/63-alerts.js).
// Clear (08-Oct-2026, the owner: "There should be option to clear notifications everywhere.. in the bell of desktop even
// we dont have that option"): a Clear on every notification, Clear all at the top of the bell, and the same Clear on every
// slim line of the pages (ClearBtn, exported). What is cleared is kept per person (AlertClear, src/js/63-alerts.js: the
// cloud, migration 68; this browser when not signed in) and never shown again; it changes no data. After a Clear, for a
// few seconds: "Cleared N notifications · Undo" (UndoSnack).
import { useState } from "react";
import { createPortal } from "react-dom";

// the Clear of one notification ({key, fp, text}: an AlertHub alert, or AlertClear.item(...) for a page's own line)
export function ClearBtn({ x, label = "Clear" }) {
  if (typeof AlertClear !== "object" || !x || !x.fp) return null;
  return <button className="linkbtn al-clear" data-alert-clear="" title="Clear: not shown again to you"
    onClick={(ev) => { ev.stopPropagation(); AlertClear.clear([x]); }}>{label}</button>;
}

// "Cleared N notifications · Undo", for a few seconds after a Clear
function UndoSnack() {
  const u = typeof AlertClear === "object" ? AlertClear.undoShown() : null;
  if (!u) return null;
  // on the page's body (above the top bar's layer, the bottom bar and a message at the bottom)
  return createPortal(<div className="al-snack" role="status" data-alerts-undo="">
    <span>{"Cleared " + u.n + (u.n === 1 ? " notification" : " notifications") + " · "}</span>
    <button className="linkbtn" data-alerts-undo-btn="" onClick={() => AlertClear.undoLast()}>Undo</button>
  </div>, document.body);
}

const SEV = { bad: "Needs action", warn: "Attention", info: "Information" };

function Item({ x }) {
  const [open, setOpen] = useState(false);
  return <li className={"al-item al-" + x.sev} data-alert-key={x.key} data-sev={x.sev}>
    <span className="al-dot" aria-label={SEV[x.sev]} title={SEV[x.sev]} />
    <div className="al-body">
      <div data-alert-text="">{x.text}</div>
      {x.fix && <div className="al-fix" data-alert-fix="">{x.fix}</div>}
      <div className="al-acts">
        {x.act && <button className="btn small" data-alert-act="" onClick={() => { S.alertsOpen = false; x.act.run(); }}>{x.act.label}</button>}
        {!x.selfClear && x.alert && <button className="linkbtn" data-alert-read="" onClick={() => AlertHub.read(x)}>Mark read</button>}
        {x.details && <button className="linkbtn al-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</button>}
        <ClearBtn x={x} />
      </div>
      {x.details && <div className="al-details note" data-alert-details="" hidden={!open}>{x.details}</div>}
    </div>
  </li>;
}

export default function Bell() {
  if (typeof AlertHub !== "object") return null;
  const list = AlertHub.list(), n = list.length, worst = n ? list[0].sev : "";
  const close = () => { S.alertsOpen = false; render(); };
  return <span className="bell-wrap">
    <button className={"bell" + (worst ? " al-" + worst : "")} data-bell="" aria-haspopup="dialog" aria-expanded={!!S.alertsOpen}
      title={n ? n + (n === 1 ? " alert" : " alerts") : "No alerts"} aria-label={n ? n + (n === 1 ? " alert" : " alerts") : "No alerts"}
      onClick={() => { S.alertsOpen = !S.alertsOpen; if (S.alertsOpen) AlertHub.refresh(); render(); }}>
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z" /></svg>
      {n > 0 && <span className="bell-n" data-bell-count="">{n}</span>}
    </button>
    {S.alertsOpen && <>
      <button className="menu-scrim" onClick={close} aria-label="Close" />
      <div className="alerts-panel" role="dialog" aria-label="Alerts" data-alerts-panel="">
        <div className="fm-head"><b>Alerts</b>
          <span className="row" style={{ gap: 6, alignItems: "center" }}>
            {n > 0 && typeof AlertClear === "object" && <button className="btn small" data-alerts-clear-all="" title="Clear every notification here: they are not shown again to you"
              onClick={() => AlertClear.clear(list)}>Clear all</button>}
            <button className="icon" onClick={close} aria-label="Close">✕</button></span></div>
        {typeof Rec === "object" && Rec.alerts && Rec.alerts.msg && Rec.alerts.msg.err && <p className="note bad" data-alerts-msg="" style={{ padding: "8px 14px", margin: 0 }}>{Rec.alerts.msg.err}</p>}
        {n ? <ul className="al-list">{list.map((x) => <Item key={x.key} x={x} />)}</ul>
          : <p className="note" style={{ padding: "8px 14px" }}>Nothing needs your attention.</p>}
      </div>
    </>}
    <UndoSnack />
  </span>;
}

// the ONE slim line (one row, never wrapping) on the Tally page (every client) and on a client's Books page (its own):
// the first alert, its button, and how many more are in the bell
export function AlertLine({ cid }) {
  if (typeof AlertHub !== "object") return null;
  const all = AlertHub.list().filter((x) => x.sev !== "info" && (!cid || x.cid === cid));
  if (!all.length) return null;
  const x = all[0];
  return <div className={"alert-line al-" + x.sev} data-alert-line="" data-sev={x.sev} title={x.text + " " + (x.fix || "")}>
    <span className="al-dot" aria-hidden="true" />
    <span className="al-line-text">{x.text + (x.fix ? " " + x.fix : "")}</span>
    {x.act && <button className="btn small" data-alert-act="" onClick={() => x.act.run()}>{x.act.label}</button>}
    {all.length > 1 && <button className="linkbtn" onClick={() => { S.alertsOpen = true; render(); }}>{"+" + (all.length - 1) + " more"}</button>}
    <ClearBtn x={x} />
  </div>;
}
