// Compliance (the TDS & GST makeover, round 46, 11-Oct-2026): the firm's page for what is due across every client, one
// row per return or payment, one click into it. It was the list at the foot of Today; Today keeps a one-line count.
// ux-wins (the owner, 13-Nov-2026): "Start tracking from…": the month a client's returns are tracked from (trackFrom,
// asked when a client is added: parts/AddClient.jsx). Nothing that fell due before that month shows (DueList, src/js/68);
// for a client added before, or one that came from Tally with years of books, it is set here.
/* global S, sortedCompanies, doAct, Store, DueList, GSTR, toast, render */
// the client saved for certain: Store.put (src/js/01) queues the write and marks Store.failed when it does not go through
async function saveForSure(co) {
  const was = Store.failed; Store.failed = false; Store.saveCompany(co);
  try { await (Store.chains || {})["companies/" + co.id]; } catch (e) { /* said below */ }
  const bad = !!Store.failed; Store.failed = was || bad; return !bad;
}
import { useState, useRef, useEffect } from "react";
import DueAll from "../parts/DueList.jsx";
import { monthNow, TRACK_ASK, TRACK_NOTE } from "../parts/AddClient.jsx";
import "../parts/returns.css";

const dash = (ym) => (ym ? ym.slice(0, 4) + "-" + ym.slice(4) : "");
function TrackFrom({ onSaved }) {
  const cos = sortedCompanies();
  const [open, setOpen] = useState(false), [cid, setCid] = useState(cos[0].id), co = S.companies[cid] || cos[0];
  const [m, setM] = useState(null), month = m != null ? m : dash(co.trackFrom) || monthNow();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), first = useRef(null), was = useRef(false);
  // the cursor goes into the panel when it opens, and back to its button when it closes (Esc closes it from anywhere)
  useEffect(() => {
    if (open) { was.current = true; if (first.current) first.current.focus(); const esc = (e) => { if (e.key === "Escape") setOpen(false); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }
    if (was.current) { was.current = false; const b = document.querySelector("[data-track-open]"); if (b) b.focus(); }
  }, [open]);
  const keep = async (ym) => {
    // (a month still to come would hide what falls due until then: this month is the latest)
    if (ym && ym > monthNow().replace("-", "")) { setErr("Choose this month or an earlier one."); return; }
    const old = co.trackFrom; setBusy(true); setErr("");
    co.trackFrom = ym; const ok = await saveForSure(co); setBusy(false);
    // said only once it is saved; not saved: as it was, and why
    if (!ok) { co.trackFrom = old; setErr("Not saved: FinCom could not write it. Try again."); return; }
    delete DueList.cache[co.id];
    toast(ym ? co.name + ": returns and payments tracked from " + GSTR.label(ym) + "." : co.name + ": every return and payment is tracked again.");
    setM(null); setOpen(false); onSaved(); render();
  };
  if (!open) return <p className="note cmp-track" style={{ margin: "0 0 10px" }}><button type="button" className="linkbtn" data-track-open="" aria-expanded="false" onClick={() => setOpen(true)}>Start tracking from…</button></p>;
  return <div className="pane cmp-track" data-track-from="" style={{ margin: "0 0 12px" }}>
    <b>{TRACK_ASK}</b>
    <p className="note" style={{ margin: "2px 0 8px" }}>{TRACK_NOTE}</p>
    <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="f"><span>Client</span><select ref={first} data-track-client="" value={co.id} onChange={(e) => { setCid(e.target.value); setM(null); }}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="f"><span>From</span><input type="month" data-track-month="" aria-invalid={err ? "true" : undefined} aria-describedby={err ? "trackErr" : undefined} value={month} max={monthNow()} onChange={(e) => { setM(e.target.value); setErr(""); }} /></label>
      <button type="button" className="btn small primary" data-track-save="" disabled={busy || !/^\d{4}-\d\d$/.test(month)} onClick={() => keep(month.replace("-", ""))}>Save</button>
      {co.trackFrom && <button type="button" className="btn small" data-track-clear="" disabled={busy} onClick={() => keep("")}>Track every period</button>}
      <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
    </div>
    {err && <p className="f-err" id="trackErr" role="alert" data-track-err="" style={{ margin: "6px 0 0", color: "var(--bad)" }}>{err}</p>}
  </div>;
}

export default function Compliance() {
  const [n, setN] = useState(0);
  if (!sortedCompanies().length) return <div className="tg-empty" data-list-empty="">No clients yet. Each client’s GST and TDS returns appear here once it is added.
    <div><button className="btn small primary" onClick={() => doAct("addCo")}>Add client</button></div></div>;
  return <section className="compliance" data-compliance=""><TrackFrom onSaved={() => setN(n + 1)} /><DueAll key={n} /></section>;
}
