// The statements in the owner's workbook layout (Schedule III, or the ICAI format for a firm, LLP or proprietor):
// Balance sheet, Profit & loss, Cash flow and Notes. Every figure is FinSt.build's (src/js/88), the value the Excel's
// formula gives. A figure opens its note; a note's line opens its ledgers in the trial balance.
import { Fragment, useEffect } from "react";
import { fig, dmy, fyEnd, st, setFin } from "./util.js";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const openNote = (key) => setFin({ tab: "notes", note: key });
export const openTb = (codes, label) => setFin({ tab: "tb", tbF: { codes, label }, src: "", q: "" });

function Fig({ v, dec, note, label }) {
  const t = fig(v, dec);
  if (!note || !t || t === "-") return <>{t}</>;
  return <button type="button" className="fin-fig" data-fin-fig={note} title={"Open the note: " + label} onClick={() => openNote(note)}>{t}</button>;
}

// the period's words (FinSt.periodOf): the full year as before, a part of it by its dates
const per = (d) => d.period || { full: true };
const part = (d) => !per(d).full;
const asAt = (d) => (part(d) ? per(d).asAt : dmy(fyEnd(d.fy)));
const forWhat = (d) => (part(d) ? per(d).forWhat : "for the year ended " + dmy(fyEnd(d.fy)));

export function Sheet({ d, title, children, sub }) {
  const nm = (d.inputs && d.inputs.name) || "", P = per(d);
  return <section className="fin-sheet" data-fin-sheet="">
    <header><h3 data-fin-title="">{title}</h3><p>{[nm, d.inputs && d.inputs.cin ? "CIN " + d.inputs.cin : "", sub].filter(Boolean).join(" · ")}</p></header>
    <p className="fin-unit" data-fin-unitline="">{d.inputs.unitLine}</p>
    {P.spansNote && <p className="note" data-fin-spans="">{P.spansNote}</p>}
    {P.cmpNote && <p className="note" data-fin-cmpnote="">{P.cmpNote}</p>}
    {P.pyNote && <p className="note" data-fin-pynote="">{P.pyNote}</p>}
    {d.tb.carried && <p className="note" data-fin-carried="">{d.tb.carried.note + ", dated " + FinSt.DMY(String(+d.fy) + "0331") + " and kept in FinCom; not in Tally."}</p>}
    {(d.tb.warn || []).map((w) => <p key={w} className="note">{w}</p>)}
    {children}
  </section>;
}

function Head({ d, first = "Particulars", note = true, at = "As at " }) {
  const fy = d.fy, P = per(d), pl = at !== "As at ";
  const cy = part(d) ? (pl ? P.range : at + P.asAt) : at + dmy(fyEnd(fy)), py = part(d) ? (pl ? P.pyPlLabel : at + P.pyAsAt) : at + dmy(fyEnd(+fy - 1));
  return <>
    <colgroup><col />{note && <col style={{ width: 56 }} />}<col className="fig" /><col className="fig" /></colgroup>
    <thead><tr><th>{first}</th>{note && <th className="no">Note</th>}<th className="n" data-fin-colcy="">{cy}</th><th className="n" data-fin-colpy="">{py}</th></tr></thead>
  </>;
}
const nz = (z) => (z.cy != null && Math.abs(z.cy) > 1e-9) || (z.py != null && Math.abs(z.py) > 1e-9);

export function BalanceSheet({ d }) {
  const dec = d.inputs.dec, S2 = d.bs.sections, T = d.bs.total;
  const parts = [["I", "Equity and liabilities", ["EQ", "NCL", "CL"], T.eqL], ["II", "Assets", ["NCA", "CA"], T.assets]];
  return <Sheet d={d} title={"Balance sheet as at " + asAt(d)}>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="bs"><Head d={d} /><tbody>
      {parts.map(([r, label, secs, tot]) => <Fragment key={r}>
        <tr className="h1"><td colSpan={4}>{r + ". " + label}</td></tr>
        {secs.filter((s) => S2[s].lines.some(nz)).map((s, i) => <Fragment key={s}>
          <tr className="h2"><td colSpan={4}>{"(" + (i + 1) + ") " + S2[s].label}</td></tr>
          {S2[s].lines.filter(nz).map((z, j) => <tr key={z.id} className="l1" data-fin-line={z.id}>
            <td>{"(" + "abcdefgh"[j] + ") " + z.label}</td>
            <td className="no">{z.no ? <button type="button" className="fin-fig" onClick={() => openNote(z.note)}>{z.no}</button> : ""}</td>
            <td className="n"><Fig v={z.cy} dec={dec} note={z.no ? z.note : ""} label={z.label} /></td><td className="n"><Fig v={z.py} dec={dec} note={z.no ? z.note : ""} label={z.label} /></td></tr>)}
        </Fragment>)}
        <tr className="tot" data-fin-total={r}><td>Total</td><td className="no" /><td className="n">{fig(tot.cy, dec)}</td><td className="n">{fig(tot.py, dec)}</td></tr>
      </Fragment>)}
    </tbody></table></div>
  </Sheet>;
}

const PL_BOLD = { inc: 1, tot: 1, pbe: 1, pbt: 1, tax: 1, pat: 1 };
export function ProfitLoss({ d }) {
  const dec = d.inputs.dec, L = d.pl.lines, nk = {}; d.notes.forEach((n) => { nk[n.no] = n.key; });
  let r = 0;
  const rows = [];
  L.forEach((z) => {
    if (z.key === "mat") rows.push(<tr key="hexp" className="h2"><td colSpan={4}>{ROMAN[r++] + ". Expenses"}</td></tr>);
    if (z.key === "cur") rows.push(<tr key="htax" className="h2"><td colSpan={4}>{ROMAN[r++] + ". Tax expense"}</td></tr>);
    const inExp = ["mat", "pur", "chg", "emp", "fin", "dep", "exp"].includes(z.key), inTax = ["cur", "prior", "def"].includes(z.key);
    if (!PL_BOLD[z.key] && !nz(z) && z.key !== "rev") return;
    const label = inExp || inTax ? z.label : ROMAN[r++] + ". " + z.label, note = z.no ? nk[z.no] : "";
    rows.push(<tr key={z.key} className={PL_BOLD[z.key] ? (z.key === "pat" ? "tot" : "sub") : inExp || inTax ? "l1" : ""} data-fin-line={z.key}>
      <td>{label}</td><td className="no">{z.no ? <button type="button" className="fin-fig" onClick={() => openNote(note)}>{z.no}</button> : ""}</td>
      <td className="n"><Fig v={z.cy} dec={dec} note={note} label={z.label} /></td><td className="n"><Fig v={z.py} dec={dec} note={note} label={z.label} /></td></tr>);
  });
  const eps = d.pl.eps;
  return <Sheet d={d} title={"Statement of profit and loss " + forWhat(d)}>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="pl"><Head d={d} at="Year ended " /><tbody>
      {rows}
      {eps && <tr className="muted" data-fin-line="eps"><td>{ROMAN[r] + ". Earnings per equity share (in rupees, face value ₹" + (d.inputs.shares.face || 10) + "): basic and diluted"}</td><td className="no" />
        <td className="n">{fig(eps.cy, 2)}</td><td className="n">{fig(eps.py, 2)}</td></tr>}
    </tbody></table></div>
  </Sheet>;
}

const CF_HEAD = { pbt: "A. Cash flow from operating activities", dep: "Adjustments for:", wc_tp: "Changes in working capital:", capex: "B. Cash flow from investing activities", equity: "C. Cash flow from financing activities" };
const CF_SUB = { opBefore: 1, cashGen: 1, op: 1, inv: 1, fin: 1, net: 1 };
export function CashFlow({ d }) {
  const dec = d.inputs.dec, cf = d.cf;
  if (!cf.cy) return <Sheet d={d} title={"Cash flow statement " + forWhat(d)}><p className="note">The cash flow needs last year’s balances, which are not in FinCom’s copy. Type last year’s audited trial balance in the Trial balance tab.</p></Sheet>;
  return <Sheet d={d} title={"Cash flow statement " + forWhat(d)} sub="Indirect method (AS 3)">
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="cf"><Head d={d} note={false} at="Year ended " /><tbody>
      {cf.lines.map((z) => {
        if (z.key === "diff") return null;
        const head = CF_HEAD[z.key] ? <tr key={"h" + z.key} className={z.key === "dep" || z.key === "wc_tp" ? "muted" : "h2"}><td colSpan={3}>{CF_HEAD[z.key]}</td></tr> : null;
        if (!CF_SUB[z.key] && z.key !== "close" && z.key !== "open" && z.key !== "perNote" && !nz(z)) return head;
        const cls = z.key === "close" ? "tot" : CF_SUB[z.key] ? "sub" : z.key === "open" || z.key === "perNote" ? "" : "l1";
        return <Fragment key={z.key}>{head}<tr className={cls} data-fin-line={z.key}><td>{z.label}</td><td className="n">{fig(z.cy, dec)}</td><td className="n">{z.py == null ? "" : fig(z.py, dec)}</td></tr></Fragment>;
      })}
    </tbody></table></div>
  </Sheet>;
}

// a note's line: its codes (a line's own; a group's total: the group's codes)
const codesOf = (n, z) => z.code ? [z.code] : z.total || z.head ? n.lines.filter((y) => y.code && y.group === z.group).map((y) => y.code) : [];

function Grid({ g, dec, label }) {
  const C = [["D", "As at the start"], ["E", "Additions"], ["F", "Sales"], ["G", "As at the end"], ["H", "As at the start"], ["I", "For the year"], ["J", "On sales"], ["K", "As at the end"], ["L", "As at the start"], ["M", "As at the end"]];
  if (!g || !g.rows.length) return null;
  return <div className="fin-box"><table className="fin-t" data-statement="" data-fin-grid={label}><thead>
    <tr><th rowSpan={2}>{label}</th><th className="n" colSpan={4}>Gross block</th><th className="n" colSpan={4}>Depreciation</th><th className="n" colSpan={2}>Net block</th></tr>
    <tr>{C.map(([k, l]) => <th key={k} className="n">{l}</th>)}</tr></thead>
    <tbody>{g.rows.map((r) => <tr key={r.cls} data-fin-ppe={r.cls}><td><button type="button" className="fin-fig" onClick={() => openTb([r.g, r.a, r.dc ? (r.g.startsWith("34") ? "34D" : "8E") : ""].filter(Boolean), r.label)}>{r.label}</button></td>{C.map(([k]) => <td key={k} className="n">{r[k] == null ? "" : fig(r[k], dec)}</td>)}</tr>)}
      <tr className="sub"><td>Total</td>{C.map(([k]) => <td key={k} className="n">{g.total[k] == null ? "" : fig(g.total[k], dec)}</td>)}</tr></tbody></table>
    {g.rows.some((r) => r.dc) && <p className="note" data-fin-depcr="" style={{ margin: "6px 8px" }}>{"Depreciation of " + fig(g.rows.reduce((s, r) => s + (r.dc || 0), 0), dec) + " was credited straight to the asset ledgers in the books (" + g.rows.filter((r) => r.dc).map((r) => r.label).join(", ") + "; no accumulated-depreciation ledger). It is shown as the charge for the year, from the depreciation ledger's entries, and added back to the gross block, so the net block is the trial balance's."}</p>}
  </div>;
}

export function Notes({ d, onRegister }) {
  const dec = d.inputs.dec, s = st();
  useEffect(() => {
    if (!s.note) return;
    const el = document.getElementById("fin-note-" + s.note);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
  }, [s.note]);
  return <Sheet d={d} title={"Notes to the financial statements " + forWhat(d)}>
    <nav className="fin-notes-jump" aria-label="Notes">{d.notes.map((n) => <button key={n.key} type="button" data-fin-jump={n.key} onClick={() => setFin({ note: n.key })}>{n.no + " " + n.title}</button>)}</nav>
    {d.notes.map((n) => <section key={n.key} id={"fin-note-" + n.key} className={"fin-note" + (s.note === n.key ? " on" : "")} data-fin-note={n.key}>
      <h4>{"Note " + n.no + " · " + n.title}{(n.key === "8" || n.key === "34") && onRegister && <small><button type="button" className="linkbtn" onClick={onRegister}>Fixed asset register</button></small>}</h4>
      {(n.key === "8" || n.key === "34") ? <>
        <Grid g={n.ppe.cy} dec={dec} label={part(d) ? per(d).range : "Year ended " + dmy(fyEnd(d.fy))} />
        {n.ppe.py && !n.ppe.py.partial && n.ppe.py.rows.length > 0 && <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: "pointer" }}>{part(d) ? (per(d).cmp === "fy" ? "The last full year" : "The same period last year") : "Previous year"}</summary><Grid g={n.ppe.py} dec={dec} label={part(d) ? per(d).pyPlLabel : "Year ended " + dmy(fyEnd(+d.fy - 1))} /></details>}
      </> : <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table={"note-" + n.key}><Head d={d} note={false} at={part(d) && n.st === "PL" ? "Period " : "As at "} />
        <tbody>{n.lines.map((z, i) => {
          const cs = codesOf(n, z), cls = z.head ? "h2" : z.total ? "sub" : "l1";
          const lab = cs.length && !z.head ? <button type="button" className="fin-fig" data-fin-tbline={cs.join(",")} title="Open its ledgers in the trial balance" onClick={() => openTb(cs, "Note " + n.no + " · " + z.label)}>{z.label}</button> : z.label;
          return <tr key={i} className={cls}><td>{lab}{z.plug && (z.plug.cy || z.plug.py) ? <span className="note">{" (with rounding " + fig(z.plug.cy || z.plug.py, dec) + ")"}</span> : null}</td>
            <td className="n">{z.head ? "" : fig(z.cy, dec)}</td><td className="n">{z.head ? "" : fig(z.py, dec)}</td></tr>;
        })}
          {n.lines.length > 1 && !n.lines[n.lines.length - 1].total || Object.keys(n.groups).filter((g) => n.lines.some((y) => y.group === g && y.total)).length > 1 ?
            <tr className="tot"><td>Total</td><td className="n">{fig(n.total.cy, dec)}</td><td className="n">{fig(n.total.py, dec)}</td></tr> : null}
        </tbody></table></div>}
    </section>)}
  </Sheet>;
}
