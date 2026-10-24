// GSTR-1's Download Excel · Upload Excel (next-gstr1-excel), beside the return's other actions. Upload reads the file
// (r1Excel.js, loaded the first time), checks it and shows what it would change (app/src/lib/gstr1Fix.js, R1Fix.preview):
// per table the rows added, the rows left out and each field changed (now → in the Excel), the errors in plain words (Apply
// refused until they are fixed in the file) and the warnings (Apply once ticked "checked"), and each table's totals: the
// Excel's, FinCom's now and after Apply. Apply keeps it as FinCom's GSTR-1 corrections for the month; Undo puts back the
// month as it was before the last upload.
import { useRef, useState } from "react";
import "../../lib/gstr1Fix.js";
import { Pop } from "./ItcParts.jsx";
import { Download, Upload, Undo2 } from "lucide-react";

const money = (v) => "₹" + INR.format(r2(v || 0));
const NAME = { b2b: "4A, 4B, 6B, 6C – B2B, SEZ, DE Invoices", b2cl: "5 – B2C (Large) Invoices", exp: "6A – Exports Invoices", b2cs: "7 – B2C (Others)", nil: "8 – Nil Rated, Exempted and Non-GST",
  cdnr: "9B – Credit / Debit Notes (Registered)", cdnur: "9B – Credit / Debit Notes (Unregistered)", b2ba: "9A – Amended B2B Invoices", b2cla: "9A – Amended B2C (Large) Invoices", expa: "9A – Amended Exports Invoices",
  cdnra: "9C – Amended Credit/Debit Notes (Registered)", cdnura: "9C – Amended Credit/Debit Notes (Unregistered)", b2csa: "10 – Amended B2C (Others)", at: "11A – Advances Received", txpd: "11B – Adjustment of Advances",
  hsnb2b: "12 – HSN summary · B2B", hsnb2c: "12 – HSN summary · B2C", hsn: "12 – HSN summary", docs: "13 – Documents Issued", eco14a: "14(a) – Supplies through E-Commerce Operators" };
const H5 = [["taxable", "Taxable"], ["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"]];
const shownV = (f, v) => (v === "" || v == null ? "—" : f === "diff_percent" ? (num(v) ? "65%" : "—") : typeof v === "number" && !/^(rt|doc_num)$/.test(f) ? INR.format(v) : String(v));
const ref = (x) => x.ref || (x.f ? [x.f.ctin, x.f.inum || x.f.nt_num, x.f.hsn_sc, x.f.pos && "POS " + x.f.pos, x.f.rt != null && x.f.rt + "%"].filter(Boolean).join(" · ") : "");

export default function R1ExcelBar({ ym, reg }) {
  const file = useRef(null), [pv, setPv] = useState(null), [busy, setBusy] = useState(""), [ok, setOk] = useState(false);
  const mod = () => import("./r1Excel.js");
  const inf = R1Fix.info(ym, reg);
  const down = () => { setBusy("down"); mod().then((m) => m.download(ym, reg)).then(() => toast("Downloaded."), (e) => toast("Could not make the Excel: " + ((e && e.message) || e))).finally(() => setBusy("")); };
  const up = (f) => {
    if (!f) return; setBusy("up");
    mod().then((m) => m.read(f)).then((x) => {
      if ((x.meta.reg && x.meta.reg !== reg) || (x.meta.month && x.meta.month !== ym)) { toast("This Excel is for " + (x.meta.gstin || x.meta.reg) + ", " + GSTR.label(x.meta.month || "") + ": open that month and GSTIN first."); return; }
      if (x.meta.cid && S.coId && x.meta.cid !== S.coId) { toast("This Excel is another client's: open that client first."); return; }
      setOk(false); setPv(R1Fix.preview(ym, reg, x));
    }, (e) => toast("Could not read the Excel: " + ((e && e.message) || e))).finally(() => setBusy(""));
  };
  const apply = () => { R1Fix.apply(ym, reg, pv); setPv(null); toast("Applied: the Excel is this month's GSTR-1 in FinCom."); render(); };
  const undo = () => { if (R1Fix.undo(ym, reg)) { toast("Undone: GSTR-1 is back as it was before the last upload."); render(); } };
  const p = pv, errs = p ? p.errors : [], warns = p ? p.warnings : [];
  const can = p && p.n > 0 && !errs.length && (!warns.length || ok);
  const tabs = p ? Object.keys(p.tables).filter((t) => { const o = p.tables[t]; return o.added.length + o.deleted.length + o.modified.length; }) : [];
  return <>
    {/* the return's actions stay on one line at 1366 px (a client with several GSTINs has a GSTIN box in the title too): below
        1600 px an icon each, named and titled Download Excel / Upload Excel; the whole words on a wide screen */}
    <button type="button" className="btn small r1x-btn" data-r1x="down" aria-label="Download Excel" title="Download Excel: GSTR-1 in the portal's tables, to change (add, delete, modify)" disabled={!!busy} onClick={down}>
      <Download size={14} aria-hidden="true" />{busy === "down" ? "Making…" : <span className="r1x-w">Download Excel</span>}</button>
    <button type="button" className="btn small r1x-btn" data-r1x="up" aria-label="Upload Excel" title="Upload Excel: see what it changes, then Apply" disabled={!!busy} onClick={() => file.current && file.current.click()}>
      <Upload size={14} aria-hidden="true" />{busy === "up" ? "Reading…" : <span className="r1x-w">Upload Excel</span>}</button>
    {inf && inf.canUndo && <button type="button" className="linkbtn r1x-undo" data-r1x="undo" aria-label="Undo upload" title={"Undo the last upload: GSTR-1 as it was before it" + (inf.last ? " (" + fmtDate(String(inf.last.at || "").slice(0, 10)) + (inf.last.by ? " by " + inf.last.by : "") + ")" : "")} onClick={undo}><Undo2 size={14} aria-hidden="true" /><span className="r1x-w">Undo upload</span></button>}
    <input ref={file} type="file" hidden accept=".xlsx" aria-label="Upload the GSTR-1 Excel" data-r1x-upload="" onChange={(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; up(f); }} />
    <Pop open={!!pv} onClose={() => setPv(null)} id="r1x-import" title={"GSTR-1 Excel brought back · " + GSTR.label(ym)} description={p ? (p.n ? p.n + " change" + (p.n === 1 ? "" : "s") : "Nothing changed") + (errs.length ? " · " + errs.length + " error" + (errs.length === 1 ? "" : "s") + " to fix" : "") : ""}>
      {p && <div data-r1x-preview="" data-pv-n={p.n}>
        {errs.length > 0 && <div className="r1x-errs" data-pv-errors={errs.length} role="alert"><b>Fix {errs.length === 1 ? "this" : "these " + errs.length} in the Excel and upload it again (nothing can be applied until then):</b>
          <ul>{errs.slice(0, 40).map((e, i) => <li key={i} data-pv-error={e.t}><span className="nr">{NAME[e.t] ? NAME[e.t].split(" – ")[1] : e.t}, row {e.row}{e.ref ? " (" + e.ref + ")" : ""}:</span> {e.why}</li>)}
            {errs.length > 40 && <li>and {errs.length - 40} more</li>}</ul></div>}
        {warns.length > 0 && <div className="r1x-warns" data-pv-warnings={warns.length}><b>{warns.length} warning{warns.length === 1 ? "" : "s"} to look at:</b>
          <ul>{warns.slice(0, 20).map((e, i) => <li key={i}><span className="nr">{NAME[e.t] ? NAME[e.t].split(" – ")[1] : e.t}, row {e.row}{e.ref ? " (" + e.ref + ")" : ""}:</span> {e.why}</li>)}</ul>
          {!errs.length && <label className="r1x-ok"><input type="checkbox" data-pv-confirm="" checked={ok} onChange={(ev) => setOk(ev.target.checked)} /> I have checked these warnings; apply as it is</label>}</div>}
        {!tabs.length && <p className="note">The Excel has the same lines as FinCom’s GSTR-1 for this month.</p>}
        {tabs.map((t) => { const o = p.tables[t]; return <section key={t} className="r1x-t" data-pv-table={t} data-pv-added={o.added.length} data-pv-deleted={o.deleted.length} data-pv-modified={o.modified.length}>
          <h4>{NAME[t] || t}: {[o.added.length && o.added.length + " added", o.deleted.length && o.deleted.length + " left out", o.modified.length && o.modified.length + " changed"].filter(Boolean).join(" · ")}</h4>
          <ul className="r1x-list">
            {o.added.map((a, i) => <li key={"a" + i} data-pv-add=""><span className="tag ok">added</span> row {a.row}: {ref(a)}{a.f && a.f.txval != null ? " · taxable " + money(a.f.txval) : ""}{a.back ? " (left out before, back now)" : ""}</li>)}
            {o.deleted.map((d, i) => <li key={"d" + i} data-pv-del=""><span className="tag warn">left out</span> {d.ref}{d.l && d.l.txval != null ? " · taxable " + money(d.l.txval) : ""}<span className="nr"> · {d.manual ? "a row added in an earlier upload" : "out of this month's GSTR-1, kept in the books"}</span></li>)}
            {o.modified.map((m, i) => <li key={"m" + i} data-pv-mod={m.key}><span className="tag info">changed</span> row {m.row}: {m.ref}
              <ul>{m.fields.map((c, j) => <li key={j} data-pv-field={c.field}>{R1Fix.fieldWord(c.field)}: <s>{shownV(c.field, c.from)}</s> → <b>{shownV(c.field, c.to)}</b></li>)}</ul></li>)}
          </ul></section>; })}
        <h4>Each table’s totals: the Excel’s, FinCom’s now and after Apply</h4>
        <div className="itc-pop-table"><table className="bk-table gf-off" data-pv-totals="">
          <thead><tr><th>Table</th><th></th>{H5.map(([k, l]) => <th key={k} className="n">{l}</th>)}</tr></thead>
          <tbody>{Object.keys(p.totals).map((t) => { const x = p.totals[t], e = x.excel || x.file;
            const diff = H5.some(([k]) => Math.abs(num(e[k]) - num(x.after[k])) > 0.5);
            return [["Excel" + (x.excel ? "" : " (its rows)"), e, "excel"], ["FinCom now", x.now, "now"], ["After Apply", x.after, "after"]].map(([w, v, k], i) => <tr key={t + k} data-pv-tot={t + "|" + k} className={i === 2 && diff ? "bad" : undefined}>
              {i === 0 && <td rowSpan={3}>{NAME[t] || t}</td>}<td className="nr">{w}</td>{H5.map(([h]) => <td key={h} className="n">{money(v[h])}</td>)}</tr>); })}</tbody></table></div>
        <div className="row" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
          <button type="button" className="btn small primary" data-pv-apply="" disabled={!can} onClick={apply}>Apply{p.n ? " " + p.n + " change" + (p.n === 1 ? "" : "s") : ""}</button>
          <button type="button" className="btn small" onClick={() => setPv(null)}>Cancel</button>
          <span className="note">Kept as FinCom’s GSTR-1 corrections for {GSTR.label(ym)} (not written to Tally); Undo puts it back.</span></div>
      </div>}
    </Pop>
  </>;
}
