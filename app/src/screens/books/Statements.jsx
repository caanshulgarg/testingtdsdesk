// Reports -> Financial statements and reports (Step 3 of the FinCom Assistant). Opened from the client's Reports tab
// (Reports.jsx, S.rxView). Three views, all worked out by FSX (src/js/78-reports.js), the same code the Assistant's tools
// call (server/assistant/tools/reports.ts), so both give the same figures. The financial statements themselves are the
// one Financial statements page (FinStatements.jsx, ROUND 99): its entry is the Reports list's "Financial statements";
// the older "Financial statements (Schedule III)" view here is gone and an old link to it (S.rxView "fs") opens that page
//   mis  the cash-basis MIS: receipts and payments by head and month, reconciled to the accrual profit
//   3cd  the Form 3CD draft: the clauses the books answer (the audit's own checks), the rest as questions for you
//   dcf  the DCF valuation: history from the books, the assumptions from you (never assumed), Excel and a Word draft
// No AI in any figure. Nothing here writes to the books: what is typed (the DCF's assumptions, the 3CD draft) is kept with
// the client (b.fs.rx).
// State: S.rxView, S.rxFy, S.rxTab.
import { useState } from "react";
import { staleReload } from "../../staleChunk.js";
// FSX (src/js/78-reports.js) is its own file, fetched the first time a report is opened (not in legacy.js, build.py
// react_parts; not with the page): "Preparing…" meanwhile. It sets globalThis.FSX. The fixed asset register's code, FAR
// (src/js/80-assets.js, globalThis.FAR), comes with it: the statements and the 3CD draft take the register's figures.
// AuditWP (src/js/77-audit.js, also with the Audit screen) too: the 3CD draft takes its checks (FSX.shared).
let fsxLoad = null, farLoad = null;
export function loadFAR() {
  if (globalThis.FAR) return Promise.resolve(globalThis.FAR);
  return farLoad || (farLoad = import("../../../../src/js/80-assets.js").then(() => { try { render(); } catch (e) { /* the next drawing shows it */ } return globalThis.FAR; },
    (e) => { farLoad = null; if (staleReload(e, true)) throw e; S.farLoadFailed = String((e && e.message) || e); try { render(); } catch (x) { /* */ } throw e; }));
}
export function loadFSX() {
  if (globalThis.FSX && globalThis.FAR) return Promise.resolve(globalThis.FSX);
  return fsxLoad || (fsxLoad = Promise.all([import("../../../../src/js/78-reports.js"), loadFAR(), import("../../../../src/js/77-audit.js")]).then(() => { try { render(); } catch (e) { /* the next drawing shows it */ } return globalThis.FSX; },
    (e) => { fsxLoad = null; if (staleReload(e, true)) throw e; S.rxLoadFailed = String((e && e.message) || e); try { render(); } catch (x) { /* */ } throw e; }));
}

const today = () => new Date().toISOString().slice(0, 10);
const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const fileName = (s) => String((CO() || {}).name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-" + s;
const save = (name, bytes, type) => saveFile(name, new Blob([bytes], { type }));
const printHtml = (html) => { const w = window.open("", "_blank"); if (!w) return; w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400); };
const years = () => (typeof fsYears === "function" ? fsYears() : []);
const fyNow = () => S.rxFy && years().includes(S.rxFy) ? S.rxFy : (typeof fsLastFull === "function" ? fsLastFull() : years()[0]);
const store = (b) => FSX.store(b);
const keep = () => { saveBooks(); render(); };
// a value deep in the details: path "sign.auditor.frn"
function MisView({ b }) {
  const fy = fyNow(), [from, setFrom] = useState(fy ? fy + "-04-01" : ""), [to, setTo] = useState(fy ? (Number(fy) + 1) + "-03-31" : "");
  const inp = from && to ? FSX.cashFromBooks(from.replace(/-/g, ""), to.replace(/-/g, "")) : { error: "choose the dates" };
  const cm = inp.error ? null : FSX.cashMis(inp);
  return <div data-rx-mis="">
    <div className="row" style={{ gap: 8, alignItems: "center" }}><input type="date" aria-label="MIS from" value={from} onChange={(e) => setFrom(e.target.value)} /> to <input type="date" aria-label="MIS to" value={to} onChange={(e) => setTo(e.target.value)} />
      {cm && <><button className="btn" data-rx-mis-excel="" onClick={() => save(fileName("cash-MIS-" + from + "-" + to + ".xlsx"), FSX.cashMisExcel(cm), xlsxType)}>Excel</button><button className="btn" onClick={() => printHtml(FSX.cashMisHtml(cm))}>Print / PDF</button></>}</div>
    {inp.error && <p className="bad">{inp.error}</p>}
    {cm && <><p className="note" data-rx-mis-summary="">{"Received " + FSX.money(cm.totals.receipts) + ", paid " + FSX.money(cm.totals.payments) + ", net " + FSX.money(cm.totals.net) + "; cash and bank moved " + FSX.money(cm.cash.move) + " in the books" + (cm.voucherDiff ? " (difference " + FSX.money(cm.voucherDiff) + ")" : " (agrees)") + "."}</p>
      <iframe title="Cash basis MIS" srcDoc={FSX.cashMisHtml(cm)} style={{ width: "100%", height: 760, border: "1px solid #ccc", background: "#fff" }} /></>}
  </div>;
}

function TaxAuditView({ b }) {
  const fy = fyNow(), [d, setD] = useState(null);
  return <div data-rx-3cd="">
    <p className="note">The clauses the books can answer, from the audit's own checks (the same ones the Audit tab shows); every other clause becomes a question for you. A draft: never for filing as it is.</p>
    <button className="btn primary" data-rx-3cd-make="" onClick={() => { try { const r = FSX.taxAuditFromBooks(fy), st = store(b); st.tax3cd = Object.assign({}, st.tax3cd, { [fy]: { at: today(), src: r.src, d3: r.d3, counts: r.counts } }); setD(r); saveBooks(); } catch (e) { setD({ error: e.message }); } }}>{"Make the draft for " + FC.fyLabel(fy)}</button>
    {d && d.error && <p className="bad">{d.error}</p>}
    {d && d.d3 && <><div className="row" style={{ gap: 8, margin: "8px 0" }}><button className="btn" onClick={() => save(fileName("3CD-DRAFT-" + fy + ".xlsx"), FSX.form3cdExcel(d.d3), xlsxType)}>Excel (DRAFT)</button><button className="btn" onClick={() => save(fileName("3CD-DRAFT-" + fy + ".docx"), FSX.form3cdWord(d.d3), docxType)}>Word (DRAFT)</button></div>
      <p className="note">{"Checks from " + d.src + "."}</p>
      <table className="tbl small"><thead><tr><th>Clause</th><th>Particulars</th><th>From</th><th>Rows</th><th>Note</th></tr></thead><tbody>
        {d.d3.clauses.map((c) => <tr key={c.no} data-rx-clause={c.no}><td>{c.no}</td><td>{c.title}</td><td><span className={"tag " + (c.src === "books" ? "ok" : c.src === "confirm" ? "warn" : "")}>{c.src === "books" ? "books" : c.src === "confirm" ? "to confirm" : c.src === "given" ? "given" : "for you"}</span></td><td className="n">{c.rows.length || ""}</td><td className="note">{c.note}</td></tr>)}
      </tbody></table></>}
  </div>;
}

function DcfView({ b }) {
  const st = store(b), A = st.dcf = st.dcf || {}, fy = fyNow();
  const ys = years().filter((y) => y <= fy).slice(0, 5).reverse();
  const hist = [];
  ys.forEach((y) => { const inp = FSX.inputFromBooks(y); if (!inp.error) hist.push(FSX.histFrom([FSX.run(inp).model])[0]); });
  const d = FSX.dcf(hist, A);
  const F2 = ([k, l, t]) => <label key={k} className="rx-f"><span>{l}</span><input type="text" data-rx-dcf={k} defaultValue={A[k] == null ? "" : Array.isArray(A[k]) ? A[k].join(", ") : A[k]}
    onBlur={(e) => { const s = e.target.value.trim(); A[k] = s === "" ? null : t === "list" ? s.split(",").map((z) => Number(z.trim())) : t === "num" ? Number(s.replace(/,/g, "")) : s; keep(); }} /></label>;
  const T = (k) => ["revGrowth", "ebitdaMargin", "netBorrowing"].includes(k) ? "list" : ["valuationDate", "method"].includes(k) ? "text" : "num";
  return <div data-rx-dcf-view="">
    <p className="note">{"History from the books: " + (hist.length ? hist.map((h) => FC.fyLabel(h.fy)).join(", ") : "none") + (hist.length < 3 ? " (three to five years are needed for a fair view)" : "") + ". Every assumption is yours; FinCom never fills one in."}</p>
    <div className="rx-form">{FSX.DCF_NEED.map(([k, l]) => F2([k, l + (T(k) === "list" ? " (comma between years)" : ""), T(k)]))}
      {[["wacc", "WACC % (or the parts below)"], ["rf", "Risk-free rate %"], ["beta", "Beta"], ["erp", "Equity risk premium %"], ["kd", "Pre-tax cost of debt %"], ["de", "Debt / equity"], ["netDebt", "Net debt at the valuation date"], ["ke", "Cost of equity % (FCFE)"], ["interestPct", "Interest % of revenue (FCFE)"], ["netBorrowing", "Net borrowing each year (FCFE)"]].map(([k, l]) => F2([k, l, T(k)]))}</div>
    {d.error ? <p className="bad" data-rx-dcf-missing="">{d.error}</p> : <>
      <p data-rx-dcf-result="">{"Value per share ₹" + FSX.dec2(d.perShare) + "; equity value ₹" + FSX.money(FSX.P(d.equity)) + " at a discount rate of " + FSX.pct2(d.rate) + " and terminal growth of " + FSX.pct2(d.g) + "."}</p>
      <div className="row" style={{ gap: 8 }}><button className="btn" onClick={() => save(fileName("DCF-" + fy + ".xlsx"), FSX.dcfExcel(d, CO()), xlsxType)}>Excel (live formulas)</button><button className="btn" onClick={() => save(fileName("DCF-draft-report.docx"), FSX.dcfWord(d, CO()), docxType)}>Word draft report</button></div>
      <p className="note">The report must be issued by a registered valuer / merchant banker.</p></>}
  </div>;
}

export const RX_VIEWS = [["mis", "Cash-basis MIS", "Receipts and payments by head and month, reconciled to the profit"],
  ["3cd", "Form 3CD draft", "The tax audit clauses the books answer; the rest as questions"], ["dcf", "DCF valuation", "History from the books, your assumptions, Excel and a draft report"]];

export default function Statements({ b }) {
  const v = S.rxView;
  if (!globalThis.FSX || !globalThis.FAR) {
    loadFSX().catch(() => {});
    return <div className="rx" data-rx-view={v}><button className="btn small" data-rx-back="" onClick={() => setAndShow("rxView", null)}>← All reports</button>
      {S.rxLoadFailed ? <p className="note" data-rx-load-failed="">The reports could not be loaded. <button className="linkbtn" onClick={() => { S.rxLoadFailed = null; loadFSX().catch(() => {}); render(); }}>Try again</button></p>
        : <p className="note" data-rx-preparing="">Preparing…</p>}</div>;
  }
  return <div className="rx" data-rx-view={v}>
    <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
      <button className="btn small" data-rx-back="" onClick={() => setAndShow("rxView", null)}>← All reports</button>
      <nav className="tabs" aria-label="Statements and reports">{RX_VIEWS.map(([k, l]) => <button key={k} className={v === k ? "on" : ""} data-rx-open={k} onClick={() => setAndShow("rxView", k)}>{l}</button>)}</nav>
    </div>
    {v === "mis" && <MisView b={b} />}
    {v === "3cd" && <TaxAuditView b={b} />}
    {v === "dcf" && <DcfView b={b} />}
    <style>{".rx-f{display:inline-flex;flex-direction:column;margin:4px 10px 4px 0;font-size:12px}.rx-f.wide{display:flex}.rx-f input,.rx-f select,.rx-f textarea{min-width:180px}.rx-list{margin:8px 0}.rx-checks li.ok{color:var(--ok,#1a7f37)}.rx-checks li.bad{color:var(--bad,#b42318)}.rx-checks li.warn{color:var(--warn,#9a6700)}.rx-checks li li{color:inherit;font-weight:normal}tr.rx-new td{background:rgba(255,200,0,.08)}.rx-details details{margin:6px 0;padding:6px 8px;border:1px solid var(--line,#ddd);border-radius:6px}.rx-details summary{font-weight:600;cursor:pointer}"}</style>
  </div>;
}
