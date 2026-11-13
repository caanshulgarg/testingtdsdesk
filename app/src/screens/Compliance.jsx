// Compliance (the TDS & GST makeover, round 46, 11-Oct-2026): the firm's page for what is due across every client, one
// row per return or payment, one click into it. It was the list at the foot of Today; Today keeps a one-line count.
// ux-wins (the owner, 13-Nov-2026): "Start tracking from…": the month a client's returns are tracked from (trackFrom,
// asked when a client is added: parts/AddClient.jsx). Nothing of an earlier period shows as overdue (DueList, src/js/68);
// for a client added before, or one that came from Tally with years of books, it is set here.
/* global S, sortedCompanies, doAct, Store, DueList, GSTR, toast, render */
import { useState } from "react";
import DueAll from "../parts/DueList.jsx";
import { monthNow } from "../parts/AddClient.jsx";
import "../parts/returns.css";

const dash = (ym) => (ym ? ym.slice(0, 4) + "-" + ym.slice(4) : "");
function TrackFrom({ onSaved }) {
  const cos = sortedCompanies();
  const [open, setOpen] = useState(false), [cid, setCid] = useState(cos[0].id), co = S.companies[cid] || cos[0];
  const [m, setM] = useState(null), month = m != null ? m : dash(co.trackFrom) || monthNow();
  const keep = (ym) => {
    co.trackFrom = ym; Store.saveCompany(co); delete DueList.cache[co.id];
    toast(ym ? co.name + ": returns tracked from " + GSTR.label(ym) + "." : co.name + ": every return is tracked again.");
    setM(null); setOpen(false); onSaved(); render();
  };
  if (!open) return <p className="note cmp-track" style={{ margin: "0 0 10px" }}><button type="button" className="linkbtn" data-track-open="" aria-expanded="false" onClick={() => setOpen(true)}>Start tracking from…</button></p>;
  return <div className="pane cmp-track" data-track-from="" style={{ margin: "0 0 12px" }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
    <b>Start tracking from…</b>
    <p className="note" style={{ margin: "2px 0 8px" }}>Returns before this month do not show as due or overdue. Filed ones stay.</p>
    <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="f"><span>Client</span><select data-track-client="" value={co.id} onChange={(e) => { setCid(e.target.value); setM(null); }}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="f"><span>Track returns from</span><input type="month" data-track-month="" value={month} max={monthNow()} onChange={(e) => setM(e.target.value)} /></label>
      <button type="button" className="btn small primary" data-track-save="" disabled={!/^\d{4}-\d\d$/.test(month)} onClick={() => keep(month.replace("-", ""))}>Save</button>
      {co.trackFrom && <button type="button" className="btn small" data-track-clear="" onClick={() => keep("")}>Track every period</button>}
      <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  </div>;
}

export default function Compliance() {
  const [n, setN] = useState(0);
  if (!sortedCompanies().length) return <div className="tg-empty" data-list-empty="">No clients yet. Each client’s GST and TDS returns appear here once it is added.
    <div><button className="btn small primary" onClick={() => doAct("addCo")}>Add client</button></div></div>;
  return <section className="compliance" data-compliance=""><TrackFrom onSaved={() => setN(n + 1)} /><DueAll key={n} /></section>;
}
