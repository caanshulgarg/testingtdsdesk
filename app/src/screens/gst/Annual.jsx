// The annual returns for the year of the month chosen: GSTR-9 (built from the months in the books) and GSTR-9C (the
// reconciliation with the audited accounts). Were viewGst9 and viewGst9c (src/js/18). The figures are GST9 and GST9C
// (src/js/16); what is typed is saved by gst9Typed and gst9cSet (src/js/23). GSTR-9's own tables (GST9.html) are the
// same HTML the PDF is printed from, shown here as an old piece. The 9C PDF is printed from this screen
// (FinComReact.markup("Gst9c"), see gst9PackHtml).
import Legacy from "../../parts/Legacy.jsx";
import CommitBox from "../../parts/CommitBox.jsx";

const m = (v) => INR.format(r2(v || 0));
const regOf = (b) => S.gstReg || (GSTR.gstins(b).length === 1 ? GSTR.gstins(b)[0].slice(0, 2) : "");
const fyNow = () => GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]);
const all4 = (x) => x.igst + x.cgst + x.sgst + x.cess;
const Card = ({ title, children }) => <section className="dash-card" style={{ marginTop: 12 }}><h3>{title}</h3>{children}</section>;

// a figure typed for the year: kept when the box is left
const Typed = ({ ty, k, f }) => <CommitBox type="number" step="0.01" aria-label={k + " " + f} placeholder="0" style={{ width: 105, textAlign: "right" }}
  value={ty[k] && ty[k][f] != null ? ty[k][f] : ""} onCommit={(v) => gst9Typed(k, f, v)} />;

export function Gst9({ b }) {
  const reg = regOf(b);
  if (!reg) return <p className="note">Choose a registration above; the annual return is filed for each GSTIN.</p>;
  const fy = fyNow(), d = GST9.build(fy, reg), ty = d.typed || {}, gap6J = all4(d.T["6J"]), b12 = d.T["12books"];
  return <>
    <section className="dash-card"><h3>GSTR-9 for {GST9.label(fy) + ", " + ((GSTR.gstins(b) || []).find((g) => g.slice(0, 2) === reg) || reg)}</h3>
      <p className="note">Built from the months in the books, the same figures as each month’s GSTR-1 and 3B.{" "}
        {d.missing.length > 0 && <><span className="bad">Not in the books: {d.missing.map(GSTR.label).join(", ")}.</span>{" "}</>}
        {d.twoB ? d.twoB + " months of 2B here for table 8A." : <span className="bad">No 2B here for this year, so table 8A is empty; bring the 2B files in under 2B reconciliation.</span>}</p>
      <div className="row" style={{ gap: 8, margin: "8px 0" }}><button className="btn small primary" onClick={() => doAct("gst9Pdf")}>Download (PDF)</button><button className="btn small" onClick={() => doAct("gst9Excel")}>Excel</button></div>
      <Legacy html={GST9.html(d)} />
      {Math.abs(gap6J) >= 1 && <p className="bk-alert">{"6J: ₹" + m(gap6J) + " of the credit in the 3Bs is not in 6B to 6H. It usually comes from bills marked as ITC not available, or credit entered in a 3B that is not in the books; check before filing."}</p>}
      {d.heldEnd && Math.abs(gap6J + d.heldEnd) < 2 ? <p className="note">{"6J: ₹" + m(d.heldEnd) + " of this year’s bills was held back from 3B because it was not in 2B by March; it is taken in next year’s returns and belongs in 8C and 13 when it is."}</p> : null}
      <p className="note">{"Table 8C and 13 count bills of this year booked in Tally from April to November of the next year; table 12, this year’s credit reversed then (₹" + m(all4(b12)) + " in the books). Figures that are not in the books are typed below."}</p>
    </section>
    <Card title="Figures not in the books">
      <p className="note">Amendments made on the portal, credit from an ISD, reversals under rules 37 and 39, refunds and demands, late fee. Typed here, they go into the tables above and into the PDF and Excel.{b12 && (b12.igst + b12.cgst + b12.sgst) ? " Table 12 is taken from the books unless typed." : ""}</p>
      <div className="bk-tablewrap"><table className="bk-table gf-off">
        <thead><tr><th>Table</th><th className="n">Value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th></tr></thead>
        <tbody>{GST9.TYPED.map(([k, l]) => <tr key={k}><td>{/^\d+[A-Z]? /.test(l) ? l : k + " " + l}</td>{["taxable", "igst", "cgst", "sgst", "cess"].map((f) => <td key={f} className="n"><Typed ty={ty} k={k} f={f} /></td>)}</tr>)}
          <tr><td>14 Differential tax on 10 and 11: payable / paid</td><td className="n"><Typed ty={ty} k="14" f="payable" /></td><td className="n"><Typed ty={ty} k="14" f="paid" /></td><td colSpan={3}></td></tr></tbody>
      </table></div>
    </Card>
    <Card title="17. HSN summary of outward supplies">
      <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>HSN</th><th className="n">Rate</th><th className="n">Taxable value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
        <tbody>{d.hsnOut.slice(0, 100).map((x, i) => <tr key={i}><td>{x.hsn || "—"}</td><td className="n">{x.rate}%</td><td className="n">{m(x.taxable)}</td><td className="n">{m(x.igst)}</td><td className="n">{m(x.cgst)}</td><td className="n">{m(x.sgst)}</td></tr>)}</tbody></table></div>
    </Card>
    <Card title="18. HSN summary of inward supplies">
      <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>HSN</th><th className="n">Taxable value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
        <tbody>{d.hsnIn.slice(0, 100).map((x, i) => <tr key={i}><td>{x.hsn || "no HSN in Tally"}</td><td className="n">{m(x.taxable)}</td><td className="n">{m(x.igst)}</td><td className="n">{m(x.cgst)}</td><td className="n">{m(x.sgst)}</td></tr>)}</tbody></table></div>
    </Card>
  </>;
}

/* ---------- GSTR-9C ---------- */
const Amount = ({ k, v, ph }) => <CommitBox type="number" step="0.01" aria-label={k} placeholder={ph || "0"} style={{ width: 140, textAlign: "right" }} value={v == null ? "" : v} onCommit={(x) => gst9cSet(k, x)} />;
const Row = ({ no, l, v, bold, bad }) => <tr><td>{no}</td><td>{bold ? <b>{l}</b> : l}</td><td className={"n" + (bad && Math.abs(v) >= 1 ? " bad" : "")}>{bold ? <b>{m(v)}</b> : m(v)}</td></tr>;
const Reasons = ({ no, label, st }) => <label className="note" style={{ display: "block" }}>{label}<CommitBox as="textarea" aria-label={label} rows={2} style={{ width: "100%" }} value={st.reasons[no] || ""} onCommit={(x) => gst9cSet("reasons." + no, x)} /></label>;
const H = ({ children }) => <h3 style={{ marginTop: 12 }}>{children}</h3>;
const Table = ({ children }) => <div className="bk-tablewrap"><table className="bk-table"><tbody>{children}</tbody></table></div>;

export function Gst9c() {
  const b = S.books, reg = regOf(b);
  if (!reg) return <p className="note">Choose a registration above.</p>;
  const fy = fyNow(), c = GST9C.build(fy, reg), st = c.st;
  return (
    <section className="dash-card"><h3>GSTR-9C for {GST9.label(fy)}</h3>
      <p className="note">The reconciliation of the audited accounts with the annual return. The books give each figure; type the audited turnover and the adjustments where they apply. Reasons for any difference go in the boxes below each table.</p>
      <div className="row" style={{ gap: 8, margin: "8px 0" }}><button className="btn small primary" onClick={() => doAct("gst9cPdf")}>Download (PDF)</button><button className="btn small" onClick={() => doAct("gst9cExcel")}>Excel</button></div>
      <h3 style={{ marginTop: 10 }}>5. Reconciliation of gross turnover</h3>
      <Table>
        <tr><td>5A</td><td>Turnover (including exports) as per the audited financial statements<div className="nr">from the books: {m(c.booksTurnover)}</div></td><td className="n"><Amount k="turnover" v={st.turnover} ph={String(c.booksTurnover)} /></td></tr>
        {GST9C.ADJ.map(([k, l, sg]) => <tr key={k}><td>{k}</td><td>{l + " (" + (sg > 0 ? "+" : "–") + ")"}{c.def[k] != null && <div className="nr">from the books (table 4F): {m(c.def[k])}</div>}</td>
          <td className="n"><Amount k={"adj." + k} v={st.adj[k]} ph={c.def[k] != null ? String(c.def[k]) : "0"} /></td></tr>)}
        <Row no="5O" l="Annual turnover after adjustments" v={c.o5} bold /><Row no="5P" l="Turnover as declared in the annual return (GSTR-9)" v={c.p5} /><Row no="5Q" l="Unreconciled turnover (5O – 5P)" v={c.q5} bold bad />
      </Table>
      <Reasons no="6" label="6. Reasons for the unreconciled difference" st={st} />
      <H>7. Reconciliation of taxable turnover</H>
      <Table>
        <Row no="7A" l="Annual turnover after adjustments (5O)" v={c.o5} /><Row no="7B" l="Exempted, nil rated, non-GST supplies" v={c.exempt} /><Row no="7C" l="Zero rated supplies without payment of tax" v={c.zero} />
        <Row no="7D" l="Supplies on which tax is paid by the recipient on reverse charge" v={c.rcm} /><Row no="7E" l="Taxable turnover as per adjustments (A – (B + C + D))" v={c.e7} bold />
        <Row no="7F" l="Taxable turnover as per liability declared in the annual return" v={c.f7} /><Row no="7G" l="Unreconciled taxable turnover (E – F)" v={c.g7} bold bad />
      </Table>
      <Reasons no="8" label="8. Reasons" st={st} />
      <H>9. Reconciliation of tax paid, rate by rate</H>
      <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th className="n">Rate</th><th className="n">Taxable value</th><th className="n">Tax payable</th></tr></thead>
        <tbody>{c.rates.map((x) => <tr key={x.rate}><td className="n">{x.rate}%</td><td className="n">{m(x.taxable)}</td><td className="n">{m(x.tax)}</td></tr>)}</tbody></table></div>
      <Reasons no="10" label="10. Reasons" st={st} />
      <H>12. Reconciliation of input tax credit</H>
      <Table>
        <tr><td>12A</td><td>ITC availed as per the audited financial statements<div className="nr">from the books: {m(c.itcBooks)}</div></td><td className="n"><Amount k="itcBooks" v={st.itcBooks} ph={String(c.itcBooks)} /></td></tr>
        <tr><td>12B</td><td>ITC booked in earlier years claimed in this year (+)</td><td className="n"><Amount k="adj.12B" v={st.adj["12B"]} /></td></tr>
        <tr><td>12C</td><td>ITC booked in this year to be claimed in later years (–)</td><td className="n"><Amount k="adj.12C" v={st.adj["12C"]} /></td></tr>
        <Row no="12D" l="ITC as per the audited financial statements after adjustments" v={c.d12} bold /><Row no="12E" l="ITC claimed in the annual return (7J)" v={c.e12} /><Row no="12F" l="Unreconciled ITC" v={c.f12} bold bad />
      </Table>
      <Reasons no="13" label="13. Reasons" st={st} />
    </section>
  );
}
