// Parts shared by the 2B & ITC tabs and the GSTR-3B popups (next-itc-simple, 24-Oct-2026):
//   Pop        a window in the middle of the page (Arc's dialog through PanelDialog: ✕, Esc, a click outside and Back close it)
//   LinesTable the lines behind a figure, in a Pop
//   ExcelBar   Download Excel · Upload Excel, and the preview of what an Excel brought back would change, then Apply
import { useRef, useState } from "react";
import { PanelDialog } from "../../parts/DetailDrawer.jsx";
import "./itc.css";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (/^\d{8}$/.test(String(d || "")) ? fmtDate(tallyDate(d)) : String(d || ""));
const H = ["igst", "cgst", "sgst", "cess"];
const tot = (o) => r2(H.reduce((a, k) => a + num((o || {})[k]), 0));

export function Pop({ open, onClose, title, description, id, wide = true, children }) {
  return <PanelDialog open={!!open} onClose={onClose} title={title || ""} description={description}
    attrs={{ className: "itc-pop", "data-pop": id || "", style: { width: wide ? "min(calc(100vw - 24px), 1080px)" : "min(calc(100vw - 24px), 560px)" } }}>
    <div className="itc-pop-body">{children}</div></PanelDialog>;
}

// lines: [{party, gstin, no, bookNo, date, amt (by head), note}]; heads shown: IGST CGST SGST Cess Total
export function LinesTable({ lines, empty = "No line behind this figure.", sign = 1 }) {
  const [more, setMore] = useState(200);
  const list = lines.slice(0, more), sum = H.reduce((o, k) => { o[k] = r2(lines.reduce((a, x) => a + num((x.amt || {})[k]) * sign, 0)); return o; }, {});
  return <div className="itc-pop-table"><table className="bk-table gf-off" data-pop-lines="">
    <thead><tr><th>#</th><th>Supplier · GSTIN</th><th>Invoice · date</th><th>Why</th>{H.map((k) => <th key={k} className="n">{k === "cess" ? "Cess" : k.toUpperCase()}</th>)}<th className="n">Total</th></tr></thead>
    <tbody>{list.map((x, i) => <tr key={(x.key || "") + ":" + i} data-pop-line={x.key || ""}><td className="n">{i + 1}</td><td>{x.party || "—"}<div className="nr">{x.gstin || "no GSTIN"}</div></td>
      <td>{x.no || x.bookNo || ""}<div className="nr">{day(x.date)}</div></td><td className="nr">{x.why || ""}</td>
      {H.map((k) => <td key={k} className="n">{money(num((x.amt || {})[k]) * sign)}</td>)}<td className="n"><b>{money(tot(x.amt) * sign)}</b></td></tr>)}
      {lines.length > list.length && <tr><td colSpan={9} style={{ textAlign: "center" }}><button type="button" className="linkbtn" onClick={() => setMore(lines.length)}>Show all {lines.length}</button></td></tr>}
      {!lines.length && <tr><td colSpan={9} className="note">{empty}</td></tr>}</tbody>
    <tfoot><tr className="tg-tot"><td colSpan={4}><b>{lines.length} line{lines.length === 1 ? "" : "s"}</b></td>{H.map((k) => <td key={k} className="n"><b>{money(sum[k])}</b></td>)}<td className="n"><b data-pop-total="">{money(tot(sum))}</b></td></tr></tfoot>
  </table></div>;
}

const word = (s) => (s && s.code ? ITCF.DEC_LABEL[s.code] + (s.code === "later" && s.ym ? " · " + GSTR.label(s.ym) : s.code === "later" ? " · month to pick" : "") : "FinCom decides");

// the Excel: download, and bring one back (a preview first, then Apply)
export function ExcelBar({ reg, M }) {
  const file = useRef(null), [pv, setPv] = useState(null), [busy, setBusy] = useState("");
  const mod = () => import("./itcExcel.js");
  const down = () => { setBusy("down"); mod().then((m) => m.download(reg, M)).then(() => toast("Downloaded."), (e) => toast("Could not make the Excel: " + ((e && e.message) || e))).finally(() => setBusy("")); };
  const up = (f) => {
    if (!f) return; setBusy("up");
    mod().then((m) => m.read(f)).then((x) => {
      if (x.meta && ((x.meta.reg && x.meta.reg !== reg) || (x.meta.month && x.meta.month !== M))) { toast("This Excel is for " + (x.meta.gstin || x.meta.reg) + ", " + GSTR.label(x.meta.month || "") + ": open that month and GSTIN first."); return; }
      setPv({ x, p: ITCF.preview(reg, M, x) });
    }, (e) => toast("Could not read the Excel: " + ((e && e.message) || e))).finally(() => setBusy(""));
  };
  const apply = () => { ITCF.applyImport(reg, M, pv.p); setPv(null); toast("Applied from the Excel."); render(); };
  const p = pv && pv.p, n = p ? p.changes.length + p.notes.length + p.adj.add.length + p.adj.edit.length + p.adj.del.length : 0;
  const now = p ? ITCF.table4(reg, M).lines : [];
  return <>
    <button type="button" className="btn small" data-itc-excel="down" disabled={!!busy} onClick={down}>{busy === "down" ? "Making…" : "Download Excel"}</button>
    <button type="button" className="btn small" data-itc-excel="up" disabled={!!busy} onClick={() => file.current && file.current.click()}>{busy === "up" ? "Reading…" : "Upload Excel"}</button>
    <input ref={file} type="file" hidden accept=".xlsx" aria-label="Upload the 2B and ITC Excel" data-itc-upload="" onChange={(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; up(f); }} />
    <Pop open={!!pv} onClose={() => setPv(null)} id="itc-import" title={"Excel brought back · " + GSTR.label(M)} description={n ? n + " change" + (n === 1 ? "" : "s") + " to apply" : "Nothing to change"}>
      {p && <div data-itc-preview="">
        {p.unknown.length > 0 && <p className="bad" data-pv-unknown={p.unknown.length}>{p.unknown.length} row{p.unknown.length === 1 ? "" : "s"} refused: the hidden key is not one of this month’s lines (edited, or from another month or client){p.unknown.length <= 5 ? ": " + p.unknown.map((y) => (y.party || "") + " " + (y.no || y.bookNo || "") + " (row " + y.row + ")").join(", ") : ""}.</p>}
        {p.refused.length > 0 && <div className="bad" data-pv-refused={p.refused.length}>{p.refused.length} decision{p.refused.length === 1 ? "" : "s"} refused:<ul>{p.refused.slice(0, 8).map((x, i) => <li key={i}>{(x.r.party || "") + " " + (x.r.no || x.r.bookNo || "")}: {x.why}</li>)}</ul></div>}
        {p.adj.bad.length > 0 && <div className="bad" data-pv-adjbad={p.adj.bad.length}>Adjustments refused:<ul>{p.adj.bad.map((x, i) => <li key={i}>row {x.row}: {x.why}</li>)}</ul></div>}
        <h4 data-pv-changes={p.changes.length}>{p.changes.length} decision{p.changes.length === 1 ? "" : "s"} changed</h4>
        {p.changes.length > 0 && <div className="itc-pop-table"><table className="bk-table gf-off"><thead><tr><th>Supplier · GSTIN</th><th>Invoice</th><th>Now</th><th>From the Excel</th></tr></thead>
          <tbody>{p.changes.map((c, i) => <tr key={i} data-pv-change={c.r.key}><td>{c.r.party || "—"}<div className="nr">{c.r.gstin}</div></td><td>{c.r.no || c.r.bookNo}</td><td>{word(c.from)}</td><td><b>{word(c.to)}</b></td></tr>)}</tbody></table></div>}
        {p.notes.length > 0 && <p data-pv-notes={p.notes.length}>{p.notes.length} note{p.notes.length === 1 ? "" : "s"} changed.</p>}
        <h4 data-pv-adj={p.adj.add.length + "|" + p.adj.edit.length + "|" + p.adj.del.length}>Adjustments: {p.adj.add.length} added, {p.adj.edit.length} changed, {p.adj.del.length} removed</h4>
        {(p.adj.add.length + p.adj.edit.length + p.adj.del.length) > 0 && <ul>{p.adj.add.map((a, i) => <li key={"a" + i}>Add {ITCF.LINE_LABEL[a.line]}, {a.head.toUpperCase()} {money(a.amt)}: {a.reason}</li>)}
          {p.adj.edit.map((a, i) => <li key={"e" + i}>Change {ITCF.LINE_LABEL[a.line]}, {a.head.toUpperCase()} {money(a.amt)}: {a.reason}</li>)}
          {p.adj.del.map((a, i) => <li key={"d" + i}>Remove {ITCF.LINE_LABEL[a.line]}, {a.head.toUpperCase()} {money(a.amt)}: {a.reason}</li>)}</ul>}
        {p.missing.length > 0 && <p className="note" data-pv-missing={p.missing.length}>{p.missing.length} line{p.missing.length === 1 ? " is" : "s are"} here but not in the Excel: left as they are{p.missing.length <= 6 ? " (" + p.missing.map((r) => (r.party || "") + " " + (r.no || r.bookNo || "")).join(", ") + ")" : ""}.</p>}
        {p.final && <><h4>Table 4: the Excel’s figures and FinCom’s now</h4><div className="itc-pop-table"><table className="bk-table gf-off" data-pv-final="">
          <thead><tr><th>Line</th>{H.map((k) => <th key={k} className="n">{k === "cess" ? "Cess" : k.toUpperCase()}</th>)}</tr></thead>
          <tbody>{now.map(([k, v]) => { const e = p.final[k]; return <tr key={k} data-pv-line={k}><td>{(ITCF.LINE_LABEL[k] || { "4A": "4(A) Total ITC available", "4C": "4(C) Net ITC available", "4D1": "4(D)(1) ITC reclaimed" }[k] || k)}</td>
            {H.map((h) => <td key={h} className="n">{e && e[h] != null ? <><b>{money(e[h])}</b>{Math.abs(num(e[h]) - num(v[h])) > 0.005 && <div className="nr">now {money(v[h])}</div>}</> : <span className="nr">{money(v[h])}</span>}</td>)}</tr>; })}</tbody></table></div>
          {!p.final.calc && <p className="note">The Excel was saved without its formulas worked out: Apply, and FinCom works the figures out from the decisions.</p>}</>}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button type="button" className="btn small primary" data-pv-apply="" disabled={!n} onClick={apply}>Apply</button>
          <button type="button" className="btn small" onClick={() => setPv(null)}>Cancel</button></div>
      </div>}
    </Pop>
  </>;
}
