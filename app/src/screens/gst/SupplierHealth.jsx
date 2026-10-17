// Supplier health (TDS/GST round 2, item 4): the client's suppliers as its 2B shows them, for the year of the month
// chosen: not filing (their bills in the books, nothing of theirs in 2B for the last N months), bills missing from 2B,
// filing late (2B's filing date after the due date of their return period), a GSTIN that fails its check digit, and the
// credit at risk. SupHealth (src/js/71-supplier-health.js). FinCom's GST API (TaxPro) has no "search taxpayer" call, so a
// supplier's registration status is not shown: the page says so. Nothing here changes a figure.
import { useState } from "react";
import ListTable from "../../parts/ListTable.jsx";
// SupHealth (src/js/71-supplier-health.js) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../../src/js/71-supplier-health.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const TAG = { notfiling: ["bad", "Not filing"], bad: ["bad", "GSTIN not valid"], missing: ["warn", "Bills missing from 2B"], late: ["warn", "Files late"], ok: ["ok", "Files"] };

export default function SupplierHealth() {
  const reg = S.gstReg || "", fy = GSTF.fyOf(S.gstYm || ""), [n, setN] = useState(SupHealth.N), [f, setF] = useState("flag");
  const r = SupHealth.run(reg, fy, n);
  if (!r.months.length) return <section className="dash-card" data-sup-health=""><h3>Supplier health</h3>
    <p className="note">Bring in or fetch the client’s 2B for {fy} (2B reconciliation) first: whether a supplier files is read from it.</p></section>;
  const rows = r.list.filter((x) => f === "all" || (f === "flag" ? x.status !== "ok" : x.status === f)), count = (k) => r.list.filter((x) => (k === "flag" ? x.status !== "ok" : k === "all" || x.status === k)).length;
  const risk = r2(r.list.filter((x) => x.status === "notfiling").reduce((a, x) => a + x.atRisk, 0));
  return <section className="dash-card" data-sup-health={reg + "|" + fy}>
    <div className="rp-title"><h3>Supplier health, {fy}</h3>
      <span className="note">From the 2B of {r.months.map((m) => GSTR.label(m)).join(", ")}.</span></div>
    <p className="note" data-sup-source="">FinCom’s GST connection has no “search taxpayer” call, so a supplier’s registration (active, cancelled or suspended) cannot be read here: check the suppliers flagged below on the GST portal’s Search Taxpayer before taking their credit. Whether they file is read from the client’s 2B.</p>
    <div className="gf-chips" style={{ margin: "8px 0" }} role="group" aria-label="Show">
      {[["flag", "To look at"], ["notfiling", "Not filing"], ["missing", "Bills missing"], ["late", "Files late"], ["bad", "GSTIN not valid"], ["all", "All"]].map(([k, l]) =>
        <button key={k} data-sup-chip={k} className={"gf-chip" + (f === k ? " on" : "") + (k === "notfiling" && count(k) ? " warn" : "")} aria-pressed={f === k} onClick={() => setF(k)}>{l} <b>{count(k)}</b></button>)}
      <label className="note" style={{ marginLeft: 8 }}>Not filing after <select aria-label="Months without 2B" value={n} onChange={(ev) => setN(+ev.target.value)}>{[1, 2, 3, 4, 6].map((x) => <option key={x} value={x}>{x}</option>)}</select> month{n === 1 ? "" : "s"} without 2B</label>
    </div>
    {risk > 0 && <p className="note bad" data-sup-risk="">Credit at risk from suppliers not filing: <b>{money(risk)}</b> (tax on their bills that no 2B has).</p>}
    <ListTable name="supHealth" rows={rows} rowKey={(x) => x.gstin} unit={["supplier", "suppliers"]} empty={f === "flag" ? "Every supplier with bills in these months is in 2B, on time." : "No supplier here."}
      rowProps={(x) => ({ "data-sup": x.gstin, "data-status": x.status })}
      cols={[
        { k: "party", role: "party", label: "Supplier", v: (x) => x.party, cell: (x) => <>{x.party}<div className="nr">{x.gstin}</div></> },
        { k: "risk", role: "amount", label: "Credit not in 2B", cls: "n", v: (x) => x.atRisk, sum: true, fmt: money, td: (x) => ({ className: x.atRisk >= 1 ? "bad" : undefined }), cell: (x) => (x.atRisk >= 1 ? <>{money(x.atRisk)}<div className="nr">{x.missing} bill{x.missing === 1 ? "" : "s"}</div></> : "—") },
        { k: "st", role: "status", label: "Status", v: (x) => x.status, cell: (x) => <span className={"tag " + TAG[x.status][0]}>{TAG[x.status][1]}</span> },
        { k: "seen", label: "Last in 2B", v: (x) => x.lastSeen, cell: (x) => (x.lastSeen ? GSTR.label(x.lastSeen) : "never") },
        { k: "why", label: "What 2B shows", cell: (x) => <span className="nr">{SupHealth.words(x).join("; ") || x.docs2b + " document" + (x.docs2b === 1 ? "" : "s") + " in 2B, on time"}</span> },
        { k: "act", role: "act", label: "", cell: (x) => (x.status === "notfiling" || x.status === "missing" ? <button className="linkbtn" onClick={() => gstPartGo("follow")}>ITC follow-up</button> : null) },
      ]} />
  </section>;
}
