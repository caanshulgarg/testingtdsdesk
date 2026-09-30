// Returns filed: the portal's PDFs of every return of the GSTIN for a year, against the checklist of what was due,
// kept in this browser and the firm's cloud documents. Was viewGstReturnsFiled (src/js/38). The checklist is
// GSTV.expected(); PDFs are read and filed by gstvTake; opening, sorting and removing are gstvOpen … gstvZip (38).
//
// State: S.gstvFy (the year shown).
import { useState } from "react";
import CommitBox from "../../parts/CommitBox.jsx";

const d = (s) => s ? GSTAmend.dmy(String(s).replace(/-/g, "")) : "";

// a file picker shown as a button or a link; the PDFs picked are filed (for one return and period, when bound)
function Pick({ label, className, style, bound, multiple }) {
  return <label className={className} style={{ cursor: "pointer", ...style }}>{label}
    <input type="file" accept="application/pdf,.pdf" multiple={multiple} hidden aria-label={label}
      onChange={(ev) => { const t = ev.target; if (t.files && t.files.length) gstvTake(t.files, bound || null); t.value = ""; }} /></label>;
}

// the portal's PDFs dropped here are read and filed
function Drop() {
  const [on, setOn] = useState(false);
  return <div className={"gstv-drop" + (on ? " on" : "")} onDragOver={(ev) => { ev.preventDefault(); setOn(true); }} onDragLeave={() => setOn(false)}
    onDrop={(ev) => { ev.preventDefault(); setOn(false); gstvTake(ev.dataTransfer.files, null); }}>
    Drop the PDFs downloaded from the GST portal here — GSTR-1, GSTR-3B, IFF, GSTR-1A, CMP-08, GSTR-4, GSTR-9, 9C, PMT-06 challans. Each is read for its return, GSTIN, period and ARN and filed in its place.</div>;
}

// data-id: which PDF a button is for (tests find them by it)
const OpenLinks = ({ id, remove }) => <><button className="linkbtn" data-id={id} onClick={() => gstvOpen(id)}>open</button> · <button className="linkbtn" data-id={id} onClick={() => gstvDownload(id)}>download</button>
  {remove && <> · <button className="linkbtn" data-id={id} onClick={() => gstvRemove(id)}>remove</button></>}</>;

function Checklist({ st, reg }) {
  return <div className="bk-tablewrap"><table className="bk-table compact">
    <thead><tr><th>Period</th><th>Return</th><th>Due</th><th>Filed on</th><th>ARN</th><th>Portal PDF</th></tr></thead>
    <tbody>{st.map((r, i) => {
      const c = GSTV.copies(reg, r.form, r.per), rec = c[0], filed = (rec && rec.arnDate) || GSTV.filedOn(reg, r.form, r.per);
      const pick = <Pick label="add" className="linkbtn" bound={{ form: r.form, per: r.per, reg }} />;
      const pdf = rec ? <><OpenLinks id={rec.id} />{c.length > 1 && <> <span className="nr">{c.length} copies</span></>}{rec.note && <div className="bad">{rec.note}</div>}</>
        : r.s === "missing" ? <><span className="bad">missing</span> · {pick}</> : r.s === "notdue" ? <><span className="nr">not due yet</span> · {pick}</> : <><span className="nr">{r.note || "optional"}</span> · {pick}</>;
      return <tr key={r.form + "|" + r.per + ":" + i} data-key={r.form + "|" + r.per}><td>{GSTV.perLabel(r.form, r.per, reg)}</td><td>{GSTV.label(r.form)}{r.optional && !rec && <> <span className="nr">optional</span></>}</td>
        <td>{d(r.due)}</td><td>{d(filed)}</td><td>{(rec && rec.arn) || ""}</td><td>{pdf}</td></tr>;
    })}</tbody>
  </table></div>;
}

// PDFs that could not be read for sure: which GSTIN, return and period each is
function ToSort({ list, gl }) {
  const forms = Object.entries(GSTV.FORMS);
  return <section className="dash-card" id="gstvsort" style={{ marginTop: 12 }}><h3>To sort</h3><p className="note">These could not be read for sure. Say which return and period each is, and it is filed in its place.</p>
    <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>File</th><th>GSTIN</th><th>Return</th><th>Period</th><th></th></tr></thead>
      <tbody>{list.map((x, i) => <tr key={x.id + ":" + i} data-key={x.id}>
        <td>{x.name}{x.why && <div className="nr">{x.why}</div>} <button className="linkbtn" data-id={x.id} onClick={() => gstvOpen(x.id)}>open</button></td>
        <td><select aria-label="GSTIN" style={{ width: "auto" }} value={x.reg || ""} onChange={(ev) => gstvSetSort(x.id, "reg", ev.target.value)}>{gl.map((z) => <option key={z} value={z.slice(0, 2)}>{z}</option>)}</select></td>
        <td><select aria-label="Return" style={{ width: "auto" }} value={x.form || ""} onChange={(ev) => gstvSetSort(x.id, "form", ev.target.value)}><option value="">—</option>{forms.map(([k, f]) => <option key={k} value={k}>{f.l}</option>)}</select></td>
        <td><CommitBox aria-label="Period" value={x.per || ""} placeholder={GSTV.isAnnual(x.form) ? "2025-26" : "YYYYMM, e.g. 202603"} style={{ width: 150 }} onCommit={(v) => gstvSetSort(x.id, "per", v)} /></td>
        <td><button className="btn small" onClick={() => gstvFileIt(x.id)}>File it</button> <button className="linkbtn" data-id={x.id} onClick={() => gstvRemove(x.id)}>remove</button></td>
      </tr>)}</tbody></table></div>
  </section>;
}

function Kept({ kept, fy, reg }) {
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>Every PDF on file, {fy}</h3>
    <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Return</th><th>Period</th><th>File</th><th className="dt">Added</th><th>By</th><th>Cloud</th><th></th></tr></thead>
      <tbody>{kept.map((x, i) => <tr key={x.id + ":" + i}>
        <td>{GSTV.label(x.form)}</td><td>{GSTV.perLabel(x.form, x.per, reg)}</td><td>{x.name}<div className="nr">{Math.max(1, Math.round((x.size || 0) / 1024))} KB</div></td>
        <td>{d(String(x.at).slice(0, 10))}</td><td>{x.by || ""}</td><td>{x.docPath ? "✓" : <span className="nr">this computer</span>}</td><td><OpenLinks id={x.id} remove /></td>
      </tr>)}</tbody></table></div>
  </section>;
}

export default function ReturnsFiled({ b }) {
  const reg = S.gstReg || "", years = GSTV.years(reg);
  const fy = years.includes(S.gstvFy) ? S.gstvFy : (GSTF.fyOf(S.gstYm || GSTR.months().slice(-1)[0] || "") || years[0]);
  S.gstvFy = fy;
  const g = (GSTR.gstins(b) || []).find((z) => z.slice(0, 2) === reg) || reg, rows = GSTV.expected(fy, reg);
  // PDFs of returns not on the checklist (filed though not due, say) are listed too
  const exp = new Set(rows.map((r) => r.form + "|" + r.per)), seen = new Set();
  GSTV.list().filter((x) => x.reg === reg && !x.sort && x.form && GSTV.fyOfPer(x.per) === fy && !exp.has(x.form + "|" + x.per))
    .forEach((x) => { if (!seen.has(x.form + "|" + x.per)) { seen.add(x.form + "|" + x.per); rows.push({ form: x.form, per: x.per, extra: true }); } });
  rows.sort((a, c) => GSTV.isAnnual(a.form) - GSTV.isAnnual(c.form) || String(a.per).localeCompare(String(c.per)) || GSTV.FORMS[a.form].order - GSTV.FORMS[c.form].order);
  const st = rows.map((r) => Object.assign({}, r, GSTV.status(r, reg))), have = st.filter((x) => x.s === "have").length, miss = st.filter((x) => x.s === "missing").length;
  const toSort = GSTV.list().filter((x) => x.sort);
  const kept = GSTV.list().filter((x) => x.reg === reg && !x.sort && GSTV.fyOfPer(x.per) === fy).sort((a, c) => String(a.per).localeCompare(String(c.per)) || String(c.at).localeCompare(String(a.at)));
  return <>
    <section className="dash-card">
      <div className="gf-ctl" style={{ flexWrap: "wrap", gap: 8 }}><h3 style={{ margin: 0 }}>Returns filed · {g}</h3>
        <select aria-label="Year" style={{ width: "auto" }} value={fy} onChange={(ev) => setAndShow("gstvFy", ev.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <Pick label="Add PDFs from the portal" className="btn small primary" multiple />
        {have > 0 && <button className="btn small" onClick={() => gstvZip()}>Download the year ({have} PDF{have === 1 ? "" : "s"}, zip)</button>}
      </div>
      <div className="gf-chips"><span className="gf-chip">On file <b>{have}</b></span>{miss > 0 && <span className="gf-chip warn">PDF missing <b>{miss}</b></span>}
        {toSort.length > 0 && <a className="gf-chip warn" href="#gstvsort">To sort <b>{toSort.length}</b></a>}</div>
      <Drop />
      <Checklist st={st} reg={reg} />
      <p className="note">Kept in this browser and, when the firm account is on, in its cloud documents, so any computer of the firm can open them. The checklist follows the filing type in GST settings. Filing dates typed on the GST screens and ARN dates read from the PDFs fill each other in. When the GST API is connected, filing status and ARN will be fetched; the portal’s PDF itself is still downloaded from the portal and added here.</p>
    </section>
    {toSort.length > 0 && <ToSort list={toSort} gl={GSTR.gstins(b) || []} />}
    {kept.length > 0 && <Kept kept={kept} fy={fy} reg={reg} />}
  </>;
}
