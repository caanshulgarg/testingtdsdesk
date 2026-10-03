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

const m = (v) => v == null ? "" : money(v);
// days late, late fee and interest of each return (request of 02-Oct-2026), from the filing date: the portal's (GST API),
// the ARN date on the PDF, or the date typed; the late fee and interest the 3B PDF shows as paid beside them
function Late({ x }) {
  if (!x) return <><td></td><td></td><td></td></>;
  if (!x.filed) return <><td className="nr" colSpan={3}>{x.due && x.due < GSTF.today() ? "no filing date yet" : ""}</td></>;
  if (!x.days) return <><td>on time</td><td></td><td></td></>;
  return <><td className="bad" data-late={x.form + "|" + x.per}>{x.days} day{x.days === 1 ? "" : "s"}</td>
    <td>{x.form === "iff" ? <span className="nr">{x.note}</span> : <>{m(x.fee)}{x.paidFee != null && <div className="nr">3B shows {m(x.paidFee)} paid</div>}</>}</td>
    <td>{x.form === "r3b" ? <>{x.interest != null ? m(x.interest) : <span className="nr">needs the cash paid</span>}{x.paidInterest != null && <div className="nr">3B shows {m(x.paidInterest)} paid</div>}</> : ""}</td></>;
}

function Checklist({ st, reg, late }) {
  return <div className="bk-tablewrap"><table className="bk-table compact">
    <thead><tr><th>Period</th><th>Return</th><th>Due</th><th>Filed on</th><th>ARN</th><th>Days late</th><th>Late fee</th><th>Interest (18%)</th><th>Portal PDF</th></tr></thead>
    <tbody>{st.map((r, i) => {
      const lx = late[r.form + "|" + r.per], pt = GSTX.portal(reg, r.form, r.per);
      const c = GSTV.copies(reg, r.form, r.per), rec = c[0], filed = (pt && pt.dof) || (rec && rec.arnDate) || GSTV.filedOn(reg, r.form, r.per);
      const pick = <Pick label="add" className="linkbtn" bound={{ form: r.form, per: r.per, reg }} />;
      const pdf = rec ? <><OpenLinks id={rec.id} />{c.length > 1 && <> <span className="nr">{c.length} copies</span></>}{rec.note && <div className="bad">{rec.note}</div>}</>
        : r.s === "missing" ? <><span className="bad">missing</span> · {pick}</> : r.s === "notdue" ? <><span className="nr">not due yet</span> · {pick}</> : <><span className="nr">{r.note || "optional"}</span> · {pick}</>;
      return <tr key={r.form + "|" + r.per + ":" + i} data-key={r.form + "|" + r.per}><td>{GSTV.perLabel(r.form, r.per, reg)}</td><td>{GSTV.label(r.form)}{r.optional && !rec && <> <span className="nr">optional</span></>}{rec && rec.formRead && rec.formRead !== rec.form && <div className="nr">the PDF says {GSTV.label(rec.formRead)}</div>}</td>
        <td>{d(r.due)}</td><td>{d(filed)}{pt && <div className="nr">from the portal</div>}</td><td>{(pt && pt.arn) || (rec && rec.arn) || ""}</td><Late x={lx} /><td>{pdf}</td></tr>;
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

// GSTR-1 + IFF against 3B 3.1(a), and 3B 3.1(d) against the reverse charge in the books, quarter by quarter; figures read
// from the PDFs above, or typed where a PDF could not be read
function Cross({ reg, fy }) {
  const c = GSTX.cross(reg, fy), ok = (v) => v == null ? "" : Math.abs(v) < 1 ? <span className="ok">agrees</span> : <span className="bad">{money(v)}</span>;
  const box = (form, per, path, v) => <CommitBox type="number" step="0.01" aria-label={GSTV.label(form) + " " + GSTR.label(per) + " " + path} value={v == null ? "" : v} placeholder="from the PDF" style={{ width: 120 }} onCommit={(x) => GSTX.figSet(reg, form, per, path, x)} />;
  return <section className="dash-card" style={{ marginTop: 12 }} data-cross="">
    <h3>GSTR-1 + IFF against GSTR-3B, {fy}</h3>
    <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Period</th><th>GSTR-1 / IFF taxable value</th><th className="n">GSTR-1 + IFF</th><th className="n">3B 3.1(a)</th><th>Check</th><th className="n">Books (FinCom)</th><th>3B 3.1(d) reverse charge CGST</th><th className="n">Books RCM CGST</th><th>Check</th></tr></thead>
      <tbody>{c.rows.map((r) => <tr key={r.per} data-key={r.per}><td>{r.label}</td>
        <td>{r.parts.map((p) => <div key={p.m} className="note">{GSTV.label(p.form) + " " + GSTR.label(p.m) + ": "}{p.source === "pdf" ? money(p.taxable) : box(p.form, p.m, "tl.taxable", p.taxable)}</div>)}</td>
        <td className="n" data-r1="">{r.r1 == null ? "" : money(r.r1)}</td>
        <td className="n" data-r3b="">{r.r3b == null ? box("r3b", r.per, "a.taxable", null) : money(r.r3b)}</td><td>{ok(r.diff)}</td><td className="n">{money(r.books)}</td>
        <td>{r.rcm3b ? money(r.rcm3b.cgst) : box("r3b", r.per, "d.cgst", null)}</td><td className="n">{money(r.rcmBooks.cgst)}</td><td data-rcm="">{r.rcmDiff == null ? "" : r.rcmDiff < 1 ? <span className="ok">agrees</span> : <span className="bad">differs by {money(r.rcmDiff)}</span>}</td></tr>)}
        <tr className="tot"><td>Year</td><td></td><td className="n" data-r1-year="">{c.r1 == null ? "" : money(c.r1)}</td><td className="n" data-r3b-year="">{c.r3b == null ? "" : money(c.r3b)}</td><td>{c.r1 != null && c.r3b != null ? ok(r2(c.r1 - c.r3b)) : ""}</td><td className="n">{money(c.books)}</td><td colSpan={3}></td></tr>
      </tbody></table></div>
    <p className="note">The GSTR-1 and IFF figure is the Total Liability line of each PDF (net of credit notes); 3B is table 3.1(a). Where a PDF could not be read, type its figure here. The books column is FinCom’s working from the day book; the invoices behind any difference are on <button className="linkbtn" onClick={() => gstPartGo("recon")}>Filed vs books</button>.</p>
  </section>;
}

// PDFs taken off the list: kept, with who, when and why, and Restore
function Removed({ list, reg }) {
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>Removed from the list</h3>
    <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Return</th><th>Period</th><th>File</th><th>Removed</th><th></th></tr></thead>
      <tbody>{list.map((x) => <tr key={x.id}><td>{GSTV.label(x.form)}</td><td>{GSTV.perLabel(x.form, x.per, reg)}</td><td>{x.name}</td>
        <td>{fmtDateTime(x.removed.at)}{x.removed.by ? " by " + x.removed.by : ""}{x.removed.reason ? " · " + x.removed.reason : ""}</td>
        <td><button className="linkbtn" onClick={() => gstvRestore(x.id)}>restore</button></td></tr>)}</tbody></table></div>
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
  const toSort = GSTV.list().filter((x) => x.sort), late = {};
  GSTX.late(reg, fy).forEach((x) => { late[x.form + "|" + x.per] = x; });
  const removed = GSTV.all().filter((x) => x.removed && x.reg === reg);
  const kept = GSTV.list().filter((x) => x.reg === reg && !x.sort && GSTV.fyOfPer(x.per) === fy).sort((a, c) => String(a.per).localeCompare(String(c.per)) || String(c.at).localeCompare(String(a.at)));
  return <>
    <section className="dash-card">
      <div className="gf-ctl" style={{ flexWrap: "wrap", gap: 8 }}><h3 style={{ margin: 0 }}>Returns filed · {g}</h3>
        <select aria-label="Year" style={{ width: "auto" }} value={fy} onChange={(ev) => setAndShow("gstvFy", ev.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <Pick label="Add PDFs from the portal" className="btn small primary" multiple />
        {have > 0 && <button className="btn small" onClick={() => gstvZip()}>Download the year ({have} PDF{have === 1 ? "" : "s"}, zip)</button>}
        {typeof GSTAPI === "object" && GSTAPI.on() && GSTAPI.live(g) && <button className="btn small" data-track="" onClick={() => GSTAPI.track(reg, fy).then((n) => { toast(n ? n + " return" + (n === 1 ? "" : "s") + " marked filed from the portal, with ARN and date." : "Nothing new from the portal."); render(); }, (e) => toast("The portal’s list could not be read: " + ((e && e.message) || e)))}>Mark filed from the portal</button>}
      </div>
      <div className="gf-chips"><span className="gf-chip">On file <b>{have}</b></span>{miss > 0 && <span className="gf-chip warn">PDF missing <b>{miss}</b></span>}
        {toSort.length > 0 && <a className="gf-chip warn" href="#gstvsort">To sort <b>{toSort.length}</b></a>}</div>
      <Drop />
      <Checklist st={st} reg={reg} late={late} />
      <p className="note">Kept in this browser and, when the firm account is on, in its cloud documents, so any computer of the firm can open them. The checklist follows the filing type in GST settings. Filing dates typed on the GST screens and ARN dates read from the PDFs fill each other in. When the GST API is connected, each return is marked filed with its ARN and date from the portal; the portal’s PDF itself is still downloaded from the portal and added here.</p>
    </section>
    {toSort.length > 0 && <ToSort list={toSort} gl={GSTR.gstins(b) || []} />}
    {GSTR.months().length > 0 && <Cross reg={reg} fy={fy} />}
    {kept.length > 0 && <Kept kept={kept} fy={fy} reg={reg} />}
    {removed.length > 0 && <Removed list={removed} reg={reg} />}
  </>;
}
