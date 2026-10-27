// Final credit for 3B (next-itc-simple, the owner, 24-Oct-2026: "one main tab should be Final credit taking into 3B ..
// option to increase or decrease like TDS add deduction or remove"). GSTR-3B table 4 for the month as GSTR.threeB has it
// (one figure: app/src/lib/itcFinal.js wraps GSTR.threeBm), each figure opening the lines behind it (ItcFigure.jsx), how
// 4(A)(5) is made from the decisions in 2B reconciliation, and the adjustments: "+ Add adjustment" (3B line, head, amount
// with a minus to reduce, reason) and Remove (with the reason, kept in the trail), as TDS's Add deduction.
//
// State: S.ifOpen (the figure open in its window), S.ifAdd ({} new, {id} change: the side panel).
import { useState } from "react";
import { Panel } from "../../parts/DetailDrawer.jsx";
import { Pop, ExcelBar } from "./ItcParts.jsx";
import FigureDetail, { FIG_LABEL } from "./ItcFigure.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const H = ["igst", "cgst", "sgst", "cess"];
const tot = (o) => r2(H.reduce((a, k) => a + num((o || {})[k]), 0));

function AddAdj({ reg, M }) {
  const o = S.ifAdd, rec = o && o.id ? ITCAdj.list(reg, M).find((a) => a.id === o.id) : null;
  const [v, setV] = useState(null), [err, setErr] = useState(""), [del, setDel] = useState(o && o.del ? "" : null);
  const close = () => { S.ifAdd = null; setV(null); setErr(""); setDel(null); render(); };
  const x = v || (rec ? { line: rec.line, head: rec.head, amt: String(rec.amt), reason: rec.reason } : { line: "4A5", head: "igst", amt: "", reason: "" });
  const set = (k, val) => setV(Object.assign({}, x, { [k]: val }));
  const save = () => { const r = ITCAdj.save(reg, M, x, rec ? rec.id : undefined); if (!r.ok) { setErr(r.why); toast(r.why); return; } toast((rec ? "Changed: " : "Added: ") + ITCF.LINE_LABEL[x.line] + " " + money(num(String(x.amt).replace(/,/g, "")))); close(); };
  return <Panel open={!!o} onClose={close} title={rec ? "Change the adjustment" : "Add an adjustment"} description={"GSTR-3B " + GSTR.label(M) + " · kept with the client's books; Tally is not changed"} attrs={{ "data-drawer": "itc-adj" }}>
    {o && <div className="addded" data-itc-adj-form={rec ? rec.id : "new"}>
      <div className="ach-grid">
        <label className="ach-f">3B line<select aria-label="3B line" value={x.line} onChange={(ev) => set("line", ev.target.value)}>{ITCF.LINES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="ach-f">Head<select aria-label="Head" value={x.head} onChange={(ev) => set("head", ev.target.value)}>{ITCF.HEADS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="ach-f">Amount<input type="text" inputMode="decimal" aria-label="Amount" value={x.amt} placeholder="e.g. 1800, or -1800 to reduce" onChange={(ev) => set("amt", ev.target.value)} /><small className="note">a minus reduces the line</small></label>
        <label className="ach-f">Reason<input type="text" aria-label="Reason" value={x.reason} placeholder="e.g. credit note received after the books closed" onChange={(ev) => set("reason", ev.target.value)} /></label>
      </div>
      {err ? <p className="note bad" role="alert" data-itc-adj-err="">{err}</p> : null}
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn small primary" data-itc-adj-save="" onClick={save}>{rec ? "Save" : "Add adjustment"}</button>
        <button type="button" className="btn small" onClick={close}>Cancel</button>
        {rec && del == null && <button type="button" className="linkbtn" data-itc-adj-delete="" onClick={() => setDel("")}>Remove…</button>}
      </div>
      {rec && del != null && <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="ach-f">Why it is taken out<input type="text" aria-label="Why it is taken out" value={del} onChange={(ev) => setDel(ev.target.value)} /></label>
        <button type="button" className="btn small" data-itc-adj-delete-go="" disabled={!del.trim()} onClick={() => { const r = ITCAdj.remove(rec.id, del); toast(r.ok ? "Removed (kept in the trail)." : r.why); if (r.ok) close(); }}>Remove the adjustment</button></div>}
    </div>}
  </Panel>;
}

export default function ItcFinal({ b }) {
  const reg = S.gstReg || "", M = S.gstYm || "";
  if (!reg || !M) return <p className="note">Choose the month and GSTIN above.</p>;
  const T = ITCF.table4(reg, M), t = T.t, L = Object.fromEntries(T.lines), c = t.itcCats || {}, adj = ITCAdj.list(reg, M), gone = ITCAdj.removed(reg, M);
  const open = S.ifOpen || "", go = (id) => { S.ifOpen = id; render(); }, close = () => { S.ifOpen = ""; render(); };
  const Fig = ({ id, v, bold }) => <button type="button" className="linkbtn r3b-fig" data-if-fig={id} onClick={() => go(id)}>{bold ? <b>{money(v)}</b> : money(v)}</button>;
  const Line = ({ id, label, bold, minus }) => { const x = L[id] || {}; return <tr data-if-line={id} className={bold ? "tg-tot" : ""}><td>{bold ? <b>{label}</b> : label}{minus && <span className="nr"> (less)</span>}</td>
    {H.map((k) => <td key={k} className="n"><Fig id={id} v={x[k]} bold={bold} /></td>)}<td className="n"><Fig id={id} v={tot(x)} bold /></td></tr>; };
  const part = (k) => (c[k] && c[k].n ? c[k] : null);
  const base = t.itcBase || {}, recl = t.reclaim || {}, a5 = (t.itcAdj || {})["4A5"] || {};
  const steps = [["Bills in the books this month", base, 1, "books"], ["Less: not taken this month (not in 2B, a later month, follow-up, reversed)", part("held"), -1, "held"],
    ["Less: more tax in the books than in 2B (the lower is taken)", part("excess"), -1, "excess"], ["Add: taken now, booked in another month (carried forward or deferred)", part("released"), 1, "released"],
    ["Add: taken now, only in 2B", part("from2b"), 1, "from2b"], ["Less: suppliers' credit notes in 2B, not in the books", part("cn2b"), -1, "cn2b"], ["Add: rejected credit notes, not reducing credit", part("rejBack"), 1, "rejBack"],
    ["Add: ITC reclaimed (also 4(D)(1))", tot(recl) ? recl : null, 1, "reclaim"], ["Adjustments", tot(a5) ? a5 : null, 1, "adj"]].filter((x) => x[1]);
  return <div data-itc-final={M}>
    <section className="dash-card" style={{ marginBottom: 12 }}>
      <div className="if-head"><h3>Final credit for GSTR-3B · {GSTR.label(M)}</h3>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><button type="button" className="btn small" data-if-3b="" onClick={() => gstPartGo("r3b")}>Open GSTR-3B</button><ExcelBar reg={reg} M={M} /></div></div>
      <p className="note" style={{ margin: "2px 0 10px" }}>The credit that goes into table 4, from the decisions in <button type="button" className="linkbtn" onClick={() => gstPartGo("r2b")}>2B reconciliation</button> and the adjustments below. GSTR-3B uses exactly these figures. Click a figure to see the lines behind it.</p>
      <div className="bk-tablewrap"><table className="bk-table gf-off if-table" data-statement="" data-if-table="">
        <thead><tr><th>Table 4</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th><th className="n">Total</th></tr></thead>
        <tbody>
          <tr className="tg-group"><td colSpan={6}><b>(A) ITC available</b></td></tr>
          <Line id="4A1" label="(1) Import of goods" /><Line id="4A2" label="(2) Import of services" /><Line id="4A3" label="(3) Inward supplies on reverse charge" /><Line id="4A5" label="(5) All other ITC" />
          <Line id="4A" label="Total (A)" bold />
          <tr className="tg-group"><td colSpan={6}><b>(B) ITC reversed</b></td></tr>
          <Line id="4B1" label="(1) Rules 38, 42, 43 and section 17(5)" minus /><Line id="4B2" label="(2) Others" minus />
          <Line id="4C" label="(C) Net ITC available, (A) less (B)" bold />
          <tr className="tg-group"><td colSpan={6}><b>(D) Other details</b></td></tr>
          <Line id="4D1" label="(1) ITC reclaimed, reversed under 4(B)(2) earlier" /><Line id="4D2" label="(2) Ineligible ITC: section 16(4) and place of supply" />
        </tbody></table></div>
    </section>
    <section className="dash-card" style={{ marginBottom: 12 }} data-if-steps="">
      <h3>How 4(A)(5) is made</h3>
      <div className="bk-tablewrap"><table className="bk-table gf-off if-table">
        <thead><tr><th></th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th><th className="n">Total</th></tr></thead>
        <tbody>{steps.map(([l, o, s, k]) => <tr key={k} data-if-step={k}><td>{k === "adj" || k === "reclaim" ? l : <button type="button" className="linkbtn" onClick={() => go("4A5")}>{l}</button>}{o.n ? <span className="nr"> · {o.n} line{o.n === 1 ? "" : "s"}</span> : null}</td>
          {H.map((h) => <td key={h} className="n">{money(num(o[h]) * s)}</td>)}<td className="n">{money(tot(o) * s)}</td></tr>)}
          <tr className="tg-tot"><td><b>4(A)(5) All other ITC</b></td>{H.map((h) => <td key={h} className="n"><b>{money(num(L["4A5"][h]))}</b></td>)}<td className="n"><b data-if-a5="">{money(tot(L["4A5"]))}</b></td></tr></tbody></table></div>
    </section>
    <section className="dash-card" data-if-adj="">
      <div className="if-head"><h3>Adjustments</h3><button type="button" className="btn small primary" data-if-add="" onClick={() => { S.ifAdd = {}; render(); }}>+ Add adjustment</button></div>
      <p className="note" style={{ margin: "2px 0 8px" }}>Anything the books and 2B do not show: a credit to add or reduce on a line of table 4. Each is kept with the reason and who added it; a removed one stays in the trail.</p>
      <div className="bk-tablewrap"><table className="bk-table gf-off" data-if-adj-table="">
        <thead><tr><th>3B line</th><th>Head</th><th className="n">Amount</th><th>Reason</th><th>Added</th><th></th></tr></thead>
        <tbody>{adj.map((a) => <tr key={a.id} data-if-adj-row={a.id}><td>{ITCF.LINE_LABEL[a.line]}</td><td>{a.head === "cess" ? "Cess" : a.head.toUpperCase()}</td><td className={"n" + (a.amt < 0 ? " bad" : "")}>{money(a.amt)}</td><td>{a.reason}</td>
          <td className="nr">{(a.by ? a.by + " · " : "") + (a.at ? fmtDateTime(a.at) : "")}</td>
          <td style={{ whiteSpace: "nowrap" }}><button type="button" className="linkbtn" data-if-adj-edit={a.id} onClick={() => { S.ifAdd = { id: a.id }; render(); }}>Change</button> · <button type="button" className="linkbtn" data-if-adj-remove={a.id} onClick={() => { S.ifAdd = { id: a.id, del: true }; render(); }}>Remove</button></td></tr>)}
          {!adj.length && <tr><td colSpan={6} className="note" data-if-adj-empty="">No adjustment for {GSTR.label(M)}.</td></tr>}</tbody></table></div>
      {gone.length > 0 && <details style={{ marginTop: 8 }}><summary className="linkbtn">Removed ({gone.length})</summary><ul className="note">{gone.map((a) => <li key={a.id}>{ITCF.LINE_LABEL[a.line]}, {a.head.toUpperCase()} {money(a.amt)}: {a.reason} — removed{a.deleted.by ? " by " + a.deleted.by : ""}: {a.deleted.reason}</li>)}</ul></details>}
    </section>
    <AddAdj reg={reg} M={M} key={((S.ifAdd && S.ifAdd.id) || "new") + (S.ifAdd && S.ifAdd.del ? ":del" : "")} />
    <Pop open={!!open} onClose={close} id={"if-" + open} title={FIG_LABEL[open] || open} description={"GSTR-3B " + GSTR.label(M) + " · the lines behind the figure"}>
      {open && <FigureDetail id={open} reg={reg} M={M} t={t} onGo={close} />}
    </Pop>
  </div>;
}
