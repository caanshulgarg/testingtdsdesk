// The GSTR-1 and GSTR-3B as filed on the portal (fetched through the firm's GST API, by Fetch now or the daily run)
// against FinCom's working from the books now, month by month for the year, and table by table for the month opened.
// The comparison is GSTCMP (src/js/39); the fetching is GSTAPI.fetch / syncKept.
import { Fragment, useEffect, useState } from "react";

const money = (v) => "₹" + INR.format(r2(v || 0));
const H = [["taxable", "Taxable"], ["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"]];

function Table({ title, part, open }) {
  if (!part) return null;
  return <section className="dash-card" style={{ marginBottom: 12 }} data-cmp={title}><h3>{title}</h3>
    <div className="bk-tablewrap"><table className="bk-table compact">
      <thead><tr><th>Table</th><th></th>{H.map(([k, l]) => <th key={k} className="n">{l}</th>)}</tr></thead>
      <tbody>{part.rows.filter((r) => open || r.any || H.some(([k]) => num(r.filed[k]) || num(r.work[k]))).map((r) => <Fragment key={r.label}>
        <tr><td rowSpan={3}><b>{r.label}</b></td><td className="nr">Filed</td>{H.map(([k]) => <td key={k} className="n">{money(r.filed[k])}</td>)}</tr>
        <tr><td className="nr">FinCom</td>{H.map(([k]) => <td key={k} className="n">{money(r.work[k])}</td>)}</tr>
        <tr className={r.any ? "bad" : ""}><td className="nr">Difference</td>{H.map(([k]) => <td key={k} className={"n" + (Math.abs(r.d[k]) >= 1 ? " bad" : "")}>{Math.abs(r.d[k]) >= 1 ? money(r.d[k]) : "—"}</td>)}</tr>
      </Fragment>)}</tbody>
    </table></div>
  </section>;
}

export default function FiledCompare({ b = S.books }) {
  const [busy, setBusy] = useState(""), reg = S.gstReg || "", gstin = GSTAPI.gstinOf(reg);
  useEffect(() => { if (GSTAPI.on()) GSTAPI.syncKept().then((n) => { if (n) render(); }, () => {}); });
  const fy = GSTRev.fyMonths(S.gstYm || ""), months = fy.filter((m) => GSTR.months().includes(m) || (b.filed || {})[gstin + "|" + m.slice(4, 6) + m.slice(0, 4)] || (b.filed3b || {})[gstin + "|" + m]);
  const rows = months.map((m) => GSTCMP.month(m, reg));
  const cur = GSTCMP.month(S.gstYm, reg);
  const fetchAll = async (form) => {
    if (busy) return;
    const got = [], none = [], bad = [];
    for (const m of months) {
      if (form === "R1" ? rows.find((r) => r.ym === m).r1 : rows.find((r) => r.ym === m).r3b) continue;
      setBusy("Fetching " + GSTAPI.formOf[form] + " for " + GSTR.label(m) + "…");
      try { const x = await GSTAPI.fetch(gstin, form, m); (x.none ? none : got).push(GSTR.label(m)); } catch (e) { bad.push(GSTR.label(m) + ": " + ((e && e.message) || e)); }
    }
    if (got.length) saveBooks();
    setBusy(""); S.gstCmpMsg = [got.length ? "Fetched: " + got.join(", ") + "." : "", none.length ? "Not filed yet: " + none.join(", ") + "." : "", bad.length ? "Not fetched — " + bad.join("; ") : ""].filter(Boolean).join(" ") || "Nothing left to fetch."; render();
  };
  const cell = (part) => !part ? <span className="nr">not fetched</span> : part.any ? <span className="tag warn">differs</span> : <span className="tag ok">matches</span>;
  return <>
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Filed returns against FinCom’s working · {gstin}</h3>
      <p className="note">The GSTR-1 and GSTR-3B as filed, fetched from the portal through the firm’s GST API (each morning, or with the buttons), against what FinCom works out from the books now. A difference is a change in the books since filing, or something filed differently: amend it in the next GSTR-1, or pay or claim it in the next 3B.</p>
      {GSTAPI.on() && GSTAPI.live(gstin) ? <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn small" disabled={!!busy} onClick={() => fetchAll("R1")}>Fetch the filed GSTR-1 not here</button>
        <button className="btn small" disabled={!!busy} onClick={() => fetchAll("3B")}>Fetch the filed 3B not here</button></div>
        : <p className="note">Connect {gstin} to the portal (2B tab) to fetch the filed returns. A GSTR-1 JSON downloaded from the portal can also be brought in under Amendments.</p>}
      {(busy || S.gstCmpMsg) && <p className="note">{busy || S.gstCmpMsg}</p>}
      <div className="bk-tablewrap" style={{ marginTop: 8 }}><table className="bk-table compact" data-cmp="year">
        <thead><tr><th>Month</th><th>GSTR-1</th><th className="n">Tax filed</th><th className="n">Tax, FinCom</th><th>GSTR-3B</th><th className="n">Net ITC filed</th><th className="n">Net ITC, FinCom</th></tr></thead>
        <tbody>{rows.map((r) => {
          const t1 = (side) => r.r1 ? r2(r.r1.rows.reduce((a, x) => a + num(x[side].igst) + num(x[side].cgst) + num(x[side].sgst) + num(x[side].cess), 0)) : null;
          const itc = (side) => { if (!r.r3b) return null; const x = r.r3b.rows.find((y) => y.label.startsWith("4(C)")); return r2(num(x[side].igst) + num(x[side].cgst) + num(x[side].sgst) + num(x[side].cess)); };
          return <tr key={r.ym} className={r.ym === S.gstYm ? "picked" : ""}>
            <td><button className="linkbtn" onClick={() => gstSetYm(r.ym)}>{GSTR.label(r.ym)}</button></td>
            <td>{cell(r.r1)}</td><td className="n">{t1("filed") == null ? "" : money(t1("filed"))}</td><td className="n">{t1("work") == null ? "" : money(t1("work"))}</td>
            <td>{cell(r.r3b)}</td><td className="n">{itc("filed") == null ? "" : money(itc("filed"))}</td><td className="n">{itc("work") == null ? "" : money(itc("work"))}</td></tr>;
        })}</tbody>
      </table></div>
    </section>
    <Table title={"GSTR-1, " + GSTR.label(S.gstYm)} part={cur.r1} />
    <Table title={"GSTR-3B, " + GSTR.label(S.gstYm)} part={cur.r3b} />
    {!cur.r1 && !cur.r3b && <p className="note">Nothing filed is here for {GSTR.label(S.gstYm)} yet.</p>}
  </>;
}
