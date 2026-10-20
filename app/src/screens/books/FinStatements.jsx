// Financial statements (ROUND 99, 20-Oct-2026): one page for a client's balance sheet, profit and loss, cash flow, notes
// and computation of income in the owner's audit format, every figure linked to the trial balance by its code. Replaces
// the Accounts page (its Mapping is the Trial balance & mapping tab). Opens from the client's menu (books:fs), from
// Reports ("Financial statements"), and from old links to books:fs.
//
// Header: year · Unit · Decimals · Details (the company's details, a drawer) · Download Excel · Download PDF (with trial
// balance), built by window.FinXlsx.download / window.FinPdf.open in the chosen unit and decimals. Tabs: Balance sheet · Profit & loss · Cash flow · Notes · Computation of income ·
// Trial balance & mapping · Checks (a red count only when a check is not 0).
//
// The figures: FinSt.build (src/js/88-fin-statements.js, docs/fin-statements-api.md). The page's state: S.fin (tab, note,
// the trial balance's filters, ticks, an edit; fin/util.js), S.fsFy (the year, as before). S.fsTab === "dep" still opens
// the fixed asset register (FixedAssets.jsx), from Note 8 and from the register's old links.
import { useEffect } from "react";
import PageTabs from "../../parts/PageTabs.jsx";
import Button from "../../parts/Button.jsx";
import Msg from "../../parts/Msg.jsx";
import HowPage from "../../parts/HowPage.jsx";
import FixedAssets from "./FixedAssets.jsx";
import { UNITS, st, setFin, built, fig } from "./fin/util.js";
import { BalanceSheet, ProfitLoss, CashFlow, Notes, openNote } from "./fin/Sheets.jsx";
import { Tb } from "./fin/Tb.jsx";
import { Comp } from "./fin/Comp.jsx";
import Details from "./fin/Details.jsx";
import "./fin/fin.css";

export const FIN_TABS = [["bs", "Balance sheet"], ["pl", "Profit & loss"], ["cf", "Cash flow"], ["notes", "Notes"], ["comp", "Computation of income"], ["tb", "Trial balance & mapping"], ["checks", "Checks"]];

function Seg({ label, value, list, onPick }) {
  return <div className="fin-seg" role="group" aria-label={label} data-fin-seg={label}><span>{label}</span>
    {list.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} data-v={v} onClick={() => value !== v && onPick(v)}>{l}</button>)}</div>;
}

// the downloads: the Excel and the PDF (window.FinXlsx / window.FinPdf, app/src/lib/finExport.js, loaded the first time),
// in the unit and decimals chosen in the header. Only when that module cannot be loaded (offline, a failed fetch) a word
function download(kind, fy, o) {
  const X = kind === "xlsx" ? window.FinXlsx : window.FinPdf, fn = X && (kind === "xlsx" ? X.download : X.open);
  const notLoaded = () => toast(kind === "xlsx" ? "Excel is being prepared: it could not be loaded just now, try again in a moment" : "The PDF is being prepared: it could not be loaded just now, try again in a moment");
  const failed = (e) => (e && (e.finLoad || e.code === "lib_missing") ? notLoaded() : toast("Could not build the file: " + ((e && e.message) || e)));
  if (typeof fn !== "function") { notLoaded(); return; }
  try {
    const r = fn.call(X, fy, o);
    if (r && typeof r.then === "function") r.catch(failed);
  } catch (e) { failed(e); }
}

// where each check is put right
const FIX = { bsCy: ["bs"], bsPy: ["bs"], tbCy: ["tb"], tbPy: ["tb"], unmapped: ["tb", { src: "none", tbF: null }], surplus: ["notes", { note: "4" }], ppeDep: ["notes", { note: "8" }],
  ppeNet: ["notes", { note: "8" }], cfCy: ["cf"], cfPy: ["cf"], deferredTax: ["notes", { note: "9" }], compPbt: ["comp"], unit: [""] };
function Checks({ d }) {
  const dec = d.inputs.dec, bad = d.checks.filter((c) => c.value !== 0);
  return <section className="fin-sheet" data-fin-checks="">
    <header><h3>Checks</h3><p>{bad.length ? bad.length + " of " + d.checks.length + " do not read 0." : "Every check reads 0."}</p></header>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="checks"><colgroup><col /><col className="fig" /><col style={{ width: 80 }} /></colgroup>
      <thead><tr><th>Check</th><th className="n">Difference</th><th /></tr></thead>
      <tbody>{d.checks.map((c) => { const f = FIX[c.key] || [""], rupees = /^tb/.test(c.key) || c.key === "compPbt";
        return <tr key={c.key} data-fin-check={c.key} data-v={c.value}><td>{c.label}</td>
          <td className={"n " + (c.value ? "fin-bad" : "fin-ok")}>{c.value ? fig(c.value, rupees ? 2 : dec) : "0"}</td>
          <td className="n">{c.value !== 0 && f[0] && <button type="button" className="linkbtn" onClick={() => setFin(Object.assign({ tab: f[0] }, f[1] || {}))}>Open</button>}</td></tr>; })}
      </tbody></table></div>
  </section>;
}

function Body({ d, tab, fy, kind }) {
  const reg = () => { S.fsTab = "dep"; render(); window.scrollTo(0, 0); };
  if (tab === "pl") return <ProfitLoss d={d} />;
  if (tab === "cf") return <CashFlow d={d} />;
  if (tab === "notes") return <Notes d={d} onRegister={reg} />;
  if (tab === "comp") return <Comp d={d} fy={fy} kind={kind} />;
  if (tab === "tb") return <Tb d={d} fy={fy} kind={kind} />;
  if (tab === "checks") return <Checks d={d} />;
  return <BalanceSheet d={d} />;
}

export default function FinStatements({ b }) {
  const s = st(), years = fsYears(), fy = fsYearNow(), c = FS.cfg(b), kind = c.kind === "co" ? "co" : "nc";
  // old line names in the hand mapping (the Accounts page's) are moved to codes once
  useEffect(() => { if (b && b.fs && b.fs.map && !b.fs.migrated) { try { FinSt.migrate(b); } catch (e) {} b.fs.migrated = 1; } }, [b]);
  if (S.fsTab === "dep") return <>
    <p style={{ margin: "0 0 8px" }}><button type="button" className="linkbtn" data-fin-back="" onClick={() => { S.fsTab = ""; render(); }}>← Financial statements</button></p>
    <FixedAssets b={b} fy={fy} /></>;
  if (!fy) return <div className="bk-none">The statements are made from the day book, which is not in yet. <button className="linkbtn" onClick={() => goClient("books:import")}>Bring in from Tally</button></div>;
  const inp = FinSt.inputs(), unit = inp.unit, dec = inp.dec;
  const d = built(b, fy, unit, dec), tab = FIN_TABS.some(([k]) => k === s.tab) ? s.tab : "bs";
  const bad = d && !d.error ? d.checks.filter((x) => x.value !== 0).length : 0;
  const tabs = FIN_TABS.map(([k, l]) => k === "checks" && bad ? [k, l, bad] : [k, l]);
  return <div className="fin" data-fin="" data-phone-scroll="" data-fin-unit={unit} data-fin-dec={dec}>
    <div className="fin-head" data-fin-head="">
      <select aria-label="Year" value={fy} onChange={(ev) => fsFyGo(ev.target.value)}>{years.map((y) => <option key={y} value={y}>{FC.fyLabel(y)}</option>)}</select>
      <Seg label="Unit" value={unit} list={UNITS} onPick={(v) => { FinSt.inputsSet({ unit: v }); render(); }} />
      <Seg label="Decimals" value={dec} list={[[0, "0"], [2, "2"]]} onPick={(v) => { FinSt.inputsSet({ dec: v }); render(); }} />
      <span className="fin-sp" />
      <Button className="btn small" data-fin-details-open="" onClick={() => openDetail("finInputs", fy)}>Details</Button>
      <Button className="btn small" data-fin-dl="xlsx" onClick={() => download("xlsx", fy, { unit, dec })}>Download Excel</Button>
      <Button className="btn small" data-fin-dl="pdf" onClick={() => download("pdf", fy, { unit, dec, includeTb: !!s.pdfTb })}>Download PDF</Button>
      <label className="note" style={{ whiteSpace: "nowrap" }}><input type="checkbox" aria-label="PDF with the trial balance" checked={!!s.pdfTb} onChange={(ev) => setFin({ pdfTb: ev.target.checked })} /> with trial balance</label>
    </div>
    <PageTabs tabs={tabs} value={tab} onPick={(k) => setFin({ tab: k, note: k === "notes" ? s.note : "" })} label="Financial statements" attr="data-fin-tab" max={7} className="fin-tabs" />
    {d.error ? <div className="bk-alert" data-fs-need="">The balances are needed: <Msg text={d.error} /> <button className="linkbtn" onClick={() => goClient("books:import")}>Bring in the balances from Tally</button></div>
      : <><Body d={d} tab={tab} fy={fy} kind={kind} /><Details d={d} /></>}
    <div style={{ marginTop: 14 }}><HowPage page="fs" /></div>
  </div>;
}
export { openNote };
