// Add client (the Clients page; was in screens/Clients.jsx): a client without Tally, typed. A client of the same or a
// similar name, or the same GSTIN, is said under the name with Open it; adding one of the same name again is asked first.
// 24-Oct-2026 (next-tally-one-page): a client from Tally is added on the Tally page only; here one button opens it.
// ux-wins (13-Nov-2026, the UI review and the owner's decisions), in its own file (the first file is at its size budget):
//   - "Track returns and payments from which month?" (this month unless changed; never a month still to come), kept as the client's trackFrom (yyyymm): Compliance
//     shows nothing unfiled that fell due before that month began (DueList.items, src/js/68). A new client no longer opens on a year of
//     "overdue" returns;
//   - what is wrong is said under its own box (aria-invalid, role=alert), the box focused; it was a message in a corner;
//   - Esc cancels, as Cancel does; the first lines say the two ways in a few words.
/* global S, sortedCompanies, similarClients, askConfirm, esc, saveNewCompany, openCompany, navHome, doAct, gstinValid, Store, DueList */
import { useState } from "react";

// this month in India, yyyy-mm (the due list's own today: a test sets window.__dueToday)
export const monthNow = () => String(typeof DueList === "object" ? DueList.today() : new Date().toISOString()).slice(0, 7);

// the one question and its one answer, the same words on Add client and on Compliance (the owner's decision: returns AND
// payments that fell due before the month are left out, and the page says so)
export const TRACK_ASK = "Track returns and payments from which month?";
export const TRACK_NOTE = "Returns and payments that fell due before it are not shown. Filed and paid ones stay.";
export default function AddClient() {
  const others = sortedCompanies();
  const [v, setV] = useState({ name: "", gstin: "", copyFrom: "", turnover10cr: false, from: monthNow() }), [err, setErr] = useState({});
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }); if (err[k]) setErr({ ...err, [k]: "" }); };
  const live = Object.values(S.companies || {}).filter((c) => !c.deleted);
  const dups = typeof similarClients === "function" && (v.name.trim() || v.gstin.trim()) ? similarClients(v.name, v.gstin, live) : [];
  const openIt = (c) => { S.addingCo = false; openCompany(c.id); };
  const wrong = (k, text) => { setErr({ [k]: text }); const el = document.getElementById({ name: "ncName", gstin: "ncGstin", from: "ncFrom" }[k]); if (el) el.focus(); };
  const save = async () => {
    const name = v.name.trim(), gstin = v.gstin.trim().toUpperCase();
    if (!name) return wrong("name", "Enter the client name.");
    if (gstin && !gstinValid(gstin)) return wrong("gstin", "This GSTIN fails its check. Check each character, or leave it blank.");
    if (gstin && live.some((c) => c.gstin === gstin)) return wrong("gstin", "A client with this GSTIN already exists.");
    // (a month still to come would hide what falls due until then: this month is the latest)
    if (!/^\d{4}-\d\d$/.test(v.from) || v.from > monthNow()) return wrong("from", "Choose this month or an earlier one.");
    const same = dups.find((d) => d.why === "same");
    if (same && !(await askConfirm({ title: same.client.name + " already exists", ok: "Add another",
      body: "<p>A client named <b>" + esc(same.client.name) + "</b> is already in FinCom. Open it from Clients instead, or add another client with this name.</p>" }))) return;
    const before = new Set(Object.keys(S.companies || {}));
    if (!saveNewCompany({ ...v, dupOk: !!same })) return;
    // the month returns are tracked from, on the client just added
    const co = Object.values(S.companies).find((c) => !before.has(c.id));
    if (co && /^\d{4}-\d\d$/.test(v.from)) { co.trackFrom = v.from.replace("-", ""); Store.saveCompany(co); }
  };
  const field = (k, id) => ({ id, "aria-invalid": err[k] ? "true" : undefined, "aria-describedby": err[k] ? id + "Err" : undefined });
  const said = (k, id) => err[k] ? <span className="f-err" id={id + "Err"} role="alert" data-add-err={k}>{err[k]}</span> : null;
  return <div data-add-client-form="" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); doAct("cancelCo"); } }}>
    <h2>Add client</h2>
    <p className="note addc-tally" data-add-from-tally="" style={{ margin: "4px 0 0" }}>{"Books in Tally? "}
      <button className="linkbtn" data-add-tally-go="" onClick={() => { S.addingCo = false; S.tallyGuide = {}; S.tallyFocus = ""; navHome("tally"); }}>Add it from the Tally page</button>
      {". Or type the name below."}</p>
    <div className="grid" style={{ marginTop: 10 }} onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") save(); }}>
      <label className="f wide"><span>Client name</span><input type="text" {...field("name", "ncName")} autoFocus autoComplete="off" placeholder="e.g. Gupta Traders Pvt Ltd" value={v.name} onChange={set("name")} />{said("name", "ncName")}</label>
      <label className="f"><span>GSTIN</span><input type="text" {...field("gstin", "ncGstin")} autoComplete="off" placeholder="09AAACG1111A1Z5" value={v.gstin} onChange={set("gstin")} />{said("gstin", "ncGstin")}</label>
      {dups.length > 0 && <div className="addc-dup wide" data-add-dup={dups[0].why} role="status">
        <span>{dups[0].why === "gstin" ? dups[0].client.name + " already has this GSTIN." : dups[0].why === "same" ? dups[0].client.name + " already exists." : "A client with a similar name exists: " + dups[0].client.name + "."}</span>
        <button className="linkbtn" data-add-dup-open={dups[0].client.id} onClick={() => openIt(dups[0].client)}>Open it</button></div>}
      <label className="f"><span>{TRACK_ASK}</span><input type="month" {...field("from", "ncFrom")} data-add-from="" value={v.from} max={monthNow()} onChange={set("from")} />
        {said("from", "ncFrom")}<span className="note" style={{ margin: "2px 0 0", whiteSpace: "normal" }}>{TRACK_NOTE}</span></label>
      {others.length > 0 && <label className="f wide"><span>Copy ledger names from</span>
        <select value={v.copyFrom} onChange={set("copyFrom")}><option value="">Standard names</option>{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>}
    </div>
    <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" checked={v.turnover10cr} onChange={set("turnover10cr")} /> Turnover last year was above ₹10 crore</label>
    <div className="row" style={{ marginTop: 12 }}>
      <button className="btn primary" onClick={save}>Add and open</button>
      <button className="btn" onClick={() => doAct("cancelCo")}>Cancel</button>
    </div>
  </div>;
}
