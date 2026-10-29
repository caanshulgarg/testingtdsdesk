// Computation of income (FinSt.comp, in rupees): from the profit before tax in the P&L, the additions and deductions,
// income from other sources, the total income and the tax by the client's regime (asked once, FinSt.regimeSet). Any
// line can be changed with a reason (FinSt.compEdit); the worked-out figure stays beside it. Annexure 1: depreciation
// under the Income-tax Act by block, the opening WDV typed once (FinSt.taxDepSet) and carried forward. Its checks last.
import { useState } from "react";
import Button from "../../../parts/Button.jsx";
import CommitBox from "../../../parts/CommitBox.jsx";
import { rs, st, setFin, dmy, fyEnd } from "./util.js";

const REGIMES = { co: [["115BAA", "Section 115BAA (22% + 10% surcharge + 4% cess)"], ["normal", "Normal rates (25% / 30%)"]],
  nc: [["firm", "Firm or LLP (30%)"], ["slab", "Slab rates (section 115BAC)"]] };
const SEC = { A: "", "A+": "Add:", "A-": "Less:", "A=": "", B: "", C: "", D: "" };
const BOLD = { pgbp: 1, gti: 1, ti: 1, taxTotal: 1, payable: 1 };

function Regime({ d, kind }) {
  const set = (d.tb && (S.books.fs || {}).regime) || "", [open, setOpen] = useState(false);
  const list = REGIMES[kind], cur = d.comp.regime;
  const name = (REGIMES.co.concat(REGIMES.nc).find(([k]) => k === cur) || [cur, cur])[1];
  if (set && !open) return <p className="note" data-fin-regime={cur}>{"Tax regime: " + name + ". "}<button type="button" className="linkbtn" onClick={() => setOpen(true)}>Change</button></p>;
  return <div className="fin-regime" data-fin-regime-ask="">
    <span>{set ? "Tax regime for this client:" : "Which tax regime does this client follow? Asked once; FinCom remembers it."}</span>
    {list.map(([k, l]) => <Button key={k} className={"btn small" + (k === cur ? " primary" : "")} data-fin-regime-pick={k} onClick={() => { FinSt.regimeSet(k); setOpen(false); toast("Tax regime kept: " + l + "."); render(); }}>{l}</Button>)}
  </div>;
}

function Line({ z, fy }) {
  const s = st(), on = s.edit === z.key, [v, setV] = useState(""), [why, setWhy] = useState("");
  const start = () => { setV(String(z.v)); setWhy(z.why || ""); setFin({ edit: z.key }); };
  const save = () => {
    if (!why.trim()) { toast("Say why the figure is changed."); return; }
    if (v === "" || isNaN(+v)) { toast("Type the amount."); return; }
    FinSt.compEdit(fy, z.key, +v, why.trim()); toast("Changed, with the reason kept."); setFin({ edit: "" });
  };
  const reset = () => { FinSt.compEdit(fy, z.key, null); toast("Back to the worked-out figure."); setFin({ edit: "" }); };
  const cls = BOLD[z.key] ? "sub" : z.sec === "A+" || z.sec === "A-" ? "l1" : "";
  return <tr className={cls + (on ? " on" : "")} data-fin-comp={z.key}>
    <td>{z.label}{z.edited && <span className="fin-why" data-fin-why="">{"Changed: " + z.why + " (worked out " + rs(z.calc) + ")"}</span>}</td>
    <td className="n">{on ? <div className="fin-edit">
      <input type="number" step="0.01" aria-label={"Amount: " + z.label} value={v} onChange={(ev) => setV(ev.target.value)} />
      <input className="why" aria-label={"Why: " + z.label} placeholder="Why" value={why} onChange={(ev) => setWhy(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") save(); }} />
      <Button className="btn small" onClick={save}>Save</Button>
      {z.edited && <Button className="btn small" onClick={reset}>Use worked out</Button>}
      <Button className="btn small" onClick={() => setFin({ edit: "" })}>Cancel</Button></div> : rs(z.v)}</td>
    <td className="n" style={{ width: 60 }}>{!on && <button type="button" className="linkbtn" aria-label={"Change: " + z.label} data-fin-edit={z.key} onClick={start}>Change</button>}</td>
  </tr>;
}

function TaxDep({ c, fy }) {
  const it = c.itdep, by = {}; it.blocks.forEach((z) => { by[z.key] = z; });
  const typed = ((S.books.fs || {}).taxDep || {})[fy] || {};
  return <>
    <h5>Annexure 1: depreciation under section 32 (Income-tax Act)</h5>
    <p className="note">{it.carried && !Object.keys(typed).length ? "Opening WDV carried from last year; type a figure to change it." : "Type each block’s opening WDV once; the next years carry it forward. Additions come from the entries, split at 30 September."}</p>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="itdep"><thead><tr><th>Block</th><th className="n">Opening WDV</th><th className="n">Added to 30-Sep</th><th className="n">Added after</th>
      <th className="n">Sold</th><th className="n">Depreciation</th><th className="n">Closing WDV</th></tr></thead>
      <tbody>{FinSt.BLOCKS.map(([k, name]) => { const z = by[k] || { open: 0, addA: 0, addB: 0, sale: 0, dep: 0, close: 0 };
        return <tr key={k} data-fin-block={k}><td>{name}</td>
          <td className="n"><CommitBox type="number" step="0.01" aria-label={"Opening WDV: " + name} value={typed[k] != null ? typed[k] : z.open || ""} placeholder="0.00"
            onCommit={(v) => { FinSt.taxDepSet(fy, k, v === "" ? "" : +v); render(); }} /></td>
          <td className="n">{rs(z.addA)}</td><td className="n">{rs(z.addB)}</td><td className="n">{rs(z.sale)}</td><td className="n">{rs(z.dep)}</td><td className="n">{rs(z.close)}</td></tr>; })}
        <tr className="sub"><td>Total</td><td colSpan={4} /><td className="n">{rs(it.total)}</td><td /></tr></tbody></table></div>
  </>;
}

export function Comp({ d, fy, kind }) {
  const c = d.comp;
  // a part of the year: the computation is for a full financial year only, and says so
  if (!c) return <section className="fin-sheet fin-comp" data-fin-compsheet=""><header><h3>Computation of income</h3><p>{d.period ? d.period.range : ""}</p></header>
    <p className="note" data-fin-compnote="">{d.compNote}</p></section>;
  return <section className="fin-sheet fin-comp" data-fin-compsheet="">
    <header><h3>{"Computation of income, assessment year " + c.ay}</h3><p>{[d.inputs.name, d.inputs.pan ? "PAN " + d.inputs.pan : "", "previous year ended " + dmy(fyEnd(fy))].filter(Boolean).join(" · ")}</p></header>
    <p className="fin-unit">(Amounts in rupees)</p>
    <Regime d={d} kind={kind} />
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="comp"><colgroup><col /><col style={{ width: 170 }} /><col style={{ width: 70 }} /></colgroup>
      <thead><tr><th>Particulars</th><th className="n">Amount</th><th /></tr></thead>
      <tbody>{c.lines.map((z, i) => {
        const prev = c.lines[i - 1], head = SEC[z.sec] && (!prev || prev.sec !== z.sec) ? <tr key={"h" + z.key} className="h2"><td colSpan={3}>{SEC[z.sec]}</td></tr> : null;
        return [head, <Line key={z.key} z={z} fy={fy} />];
      })}</tbody></table></div>
    <TaxDep c={c} fy={fy} />
    <h5>Checks</h5>
    <ul className="fin-checks" data-fin-compchecks="">{c.checks.map((k) => <li key={k.key} className={k.value ? (k.key === "provision" ? "note" : "fin-bad") : "fin-ok"} data-fin-check={"comp-" + k.key}>
      {k.label + ": " + (k.value ? rs(k.value) : "0")}{k.value && k.key === "provision" ? " — book the provision as an adjustment in the Trial balance tab." : ""}</li>)}</ul>
  </section>;
}
