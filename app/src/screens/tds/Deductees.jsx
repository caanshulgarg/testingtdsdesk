// The Deductees (PAN) tab of every TDS return (next-challan-match, the owner's direction of 18-Oct-2026, as Winman lays a
// return out): one row per deductee, its PAN and the PAN's status, sections, how many deductions and their total, TDS.
// Those with no PAN, or an invalid or inoperative one, first and in red. A row opens Deductee details, where the PAN (and
// the name written in the file) is typed or corrected; the PAN is checked at once here (its form, its 4th letter against
// the name, the same PAN on another deductee), its status from TRACES through PANCheck (src/js/87) once that is connected
// ("Not checked yet · Check on TRACES" until then). Saved for the deductee (TDSPanFix.set): every deduction of it, the
// 206AA rate and the remark C follow.
import { useState } from "react";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");

export function PanState({ st }) {
  const cls = st.state === "valid" ? "ok" : st.state === "unknown" ? "" : "bad";
  return <span className={"tag " + cls} data-pan-state={st.state}>{st.words}</span>;
}

export default function DeducteesPan({ form, fy, q }) {
  const list = TDSPanFix.list(form, fy, q), locked = TDSReg.locked(fy, q, form), [f, setF] = useState("");
  const shown = list.filter((p) => !f || (f === "bad" ? p.bad : f === "unknown" ? p.status.state === "unknown" : true));
  const nBad = list.filter((p) => p.bad).length, unknown = list.filter((p) => p.pan && p.status.state === "unknown").map((p) => p.pan);
  const unit = form === "24Q" ? ["employee", "employees"] : form === "27EQ" ? ["buyer", "buyers"] : ["deductee", "deductees"];
  return <div data-deductees-pan="">
    <section className="dash-card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span><b>{list.length}</b> {list.length === 1 ? unit[0] : unit[1]}{nBad ? <> · <b className="bad">{nBad} without a valid, operative PAN</b></> : " · every PAN in the right form"}</span>
        <select aria-label="Show" value={f} onChange={(ev) => setF(ev.target.value)}><option value="">All</option><option value="bad">No PAN, invalid or inoperative</option><option value="unknown">Not checked on TRACES yet</option></select>
        {unknown.length > 0 && <button className="btn small" data-pan-check-all="" onClick={() => tdsPanCheck(unknown)}>Check {unknown.length} PAN{unknown.length === 1 ? "" : "s"} on TRACES</button>}
      </div>
    </section>
    <div className="bk-tablewrap"><table className="bk-table" id="tdsDeTable" data-statement="">
      <thead><tr><th>{form === "24Q" ? "Employee" : form === "27EQ" ? "Buyer" : "Deductee"}</th><th>PAN</th><th>PAN status</th><th>Section</th><th className="n">Deductions</th><th className="n">Paid or credited</th><th className="n">TDS</th></tr></thead>
      <tbody>{shown.map((p) => <tr key={p.key} className={"dee-row" + (p.bad ? " bad" : "")} data-dee={p.key} data-dee-bad={p.bad ? "1" : undefined} tabIndex={0} onClick={() => tdsDeducteeOpen(p.key)} onKeyDown={(ev) => { if (ev.key === "Enter") tdsDeducteeOpen(p.key); }}>
        <td><button className="linkbtn" data-dee-open={p.key} onClick={(ev) => { ev.stopPropagation(); tdsDeducteeOpen(p.key); }}>{p.name}</button>{p.fixed ? <small className="tg-sub" data-dee-fixed=""> corrected in FinCom</small> : null}</td>
        <td>{p.pan || <span className="tag bad">no PAN</span>}</td>
        <td><PanState st={p.status} />{p.problems.filter((x) => !x.bad).length ? <small className="tg-sub warn"> {p.problems.filter((x) => !x.bad)[0].words}</small> : null}</td>
        <td>{p.secs.join(", ")}</td><td className="n">{p.n}</td><td className="n">{money(p.paid)}</td><td className="n">{money(p.tds)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={4}><b>{shown.length} of {list.length}</b></td><td className="n">{shown.reduce((a, p) => a + p.n, 0)}</td><td className="n">{money(shown.reduce((a, p) => a + p.paid, 0))}</td><td className="n"><b>{money(shown.reduce((a, p) => a + p.tds, 0))}</b></td></tr></tfoot>
    </table></div>
    {!list.length && <p className="note">No {unit[1]} in this return.</p>}
    <DeducteeDetails list={list} form={form} fy={fy} q={q} locked={locked} />
  </div>;
}

export function DeducteeDetails({ list, form, fy, q, locked }) {
  const p = list.find((x) => x.key === S.tdsDee) || null, [pan, setPan] = useState(null), [name, setName] = useState(null);
  const close = () => { S.tdsDee = ""; setPan(null); setName(null); render(); };
  if (!p) return <Dialog open={false} onOpenChange={() => {}} />;
  const v = pan == null ? p.pan : pan.toUpperCase().replace(/\s/g, ""), nm = name == null ? p.name : name;
  const probs = PANCheck.offline(v, p.party, list), st = PANCheck.status(v), ok = !v || Certs.validPan(v);
  return <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
    <DialogContent title="Deductee details" description={p.party + " · " + p.n + " deduction" + (p.n === 1 ? "" : "s") + " · TDS " + money(p.tds)} data-dee-dialog="">
      <div className="ach-grid">
        <label className="ach-f">Name in the file<input type="text" value={nm} maxLength={75} aria-label="Name in the file" onChange={(ev) => setName(ev.target.value)} disabled={locked} /></label>
        <label className="ach-f">PAN<input type="text" value={v} maxLength={10} aria-label="PAN" placeholder="ABCDE1234F" onChange={(ev) => setPan(ev.target.value)} disabled={locked} style={{ textTransform: "uppercase" }} /></label>
      </div>
      <p className="note" data-dee-status=""><PanState st={st} />{" "}{Certs.validPan(v) && st.state === "unknown" && <button className="linkbtn" data-dee-check="" onClick={() => tdsPanCheck([v])}>Check on TRACES</button>}</p>
      {probs.length > 0 && <ul className="note" data-dee-probs="">{probs.map((x) => <li key={x.k} className={x.bad ? "bad" : "warn"} data-dee-prob={x.k}>{x.words}</li>)}</ul>}
      <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>Date</th><th>Section</th><th className="n">Paid</th><th className="n">TDS</th><th className="n">Rate</th></tr></thead>
        <tbody>{p.rows.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{TDS.sec(r.section)}</td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td><td className="n">{r.rate != null ? r.rate + "%" : ""}</td></tr>)}</tbody></table></div>
      {locked ? <p className="note">This return is marked filed: open a correction to change the PAN.</p>
        : <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn small primary" data-dee-save="" disabled={!ok} onClick={() => { const r = tdsDeducteeSet(p.party, { pan: v, name: nm }); if (r.ok) close(); }}>Save for all {p.n} deduction{p.n === 1 ? "" : "s"}</button>
          <button className="btn small" onClick={close}>Cancel</button></div>}
    </DialogContent></Dialog>;
}
