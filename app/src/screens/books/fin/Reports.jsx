// The Reports area of the Financial statements page (ROUND 100): the Board's Report, the Independent Auditor's Report,
// the management representation letter and the questionnaire behind them, from the page's "Reports" menu (no more tabs:
// the page keeps its seven). Each report is a readable preview, the answers still missing marked in it and counted in one
// chip (a mark opens its question); Download Word and Download PDF; "Download all" (the statements and the three reports)
// as one PDF or as a zip of separate files. Figures in the unit and decimals the page shows.
// The model: app/src/lib/reports/* (pure; tests/run_reports_pack.js); the files: app/src/lib/reportsExport.js. The
// answers: b.fs.reports[fy] (synced with the books), last year's carried forward.
import { useEffect, useMemo } from "react";
import Button from "../../../parts/Button.jsx";
import CommitBox from "../../../parts/CommitBox.jsx";
// the page's state (S.fin) is changed here directly, not through ./util.js: a lazy chunk importing from the Books file
// makes Vite share that file's exports, and its loader is then no longer the plain import the heal of src/screens/lazy.js
// asks again with "?retry=" (tests/run_chunk_heal.py)
const st = () => (S.fin = S.fin || {});
const setFin = (patch) => { Object.assign(st(), patch); render(); };
import { QUESTIONS, SECTIONS, shown, setAnswer, docHtml, longDate, LAW } from "../../../lib/reports/index.js";
import { ReportsPack, packFor } from "../../../lib/reportsExport.js";
import "./reports.css";

export const REPORTS = [["board", "Board's Report"], ["audit", "Auditor's Report"], ["mrl", "Management representation"], ["q", "Questionnaire"]];
const SRC = { carried: "From last year", books: "From the books", default: "Default" };

const fail = (e) => toast(e && (e.finLoad || e.code === "lib_missing") ? "The Word writer is being prepared: it could not be loaded just now, try again in a moment" : "Could not make the file: " + ((e && e.message) || e));
export function downloadAll(kind, fy, o) {
  if (kind === "pdf") { ReportsPack.openPdf(["fs", "board", "audit", "mrl"], fy, o); return; }
  ReportsPack.downloadZip(fy, o).catch(fail);
}

const cr = (v) => "₹" + (Math.round((+v || 0) / 1e5) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " crore";
function Applies({ c }) {
  const ap = c.ap, sm = ap.smallTest, cls = { private: "Private company", public: "Unlisted public company", listed: "Listed company", opc: "One person company", s8: "Section 8 company" }[ap.cls];
  const bits = [cls, ap.small ? "a small company (paid-up " + cr(sm.paidUp) + ", turnover " + cr(sm.turnover) + "; limits " + cr(sm.limits.paidUp) + " / " + cr(sm.limits.turnover) + ")" : "not a small company" + (sm.why.length ? " (" + sm.why[0] + ")" : ""),
    ap.abridged ? "abridged Board's Report (Rule 8A)" : "full Board's Report", "CARO 2020: " + (ap.caro.applies ? "applies" : "not applicable"), "IFC: " + (ap.ifc.applies ? "applies" : "not applicable"), "CSR: " + (ap.csr.applies ? "applies" : "not applicable")];
  return <p className="rp-applies" data-rp-applies="">{bits.join(" · ")}</p>;
}

function Preview({ doc, c }) {
  const html = useMemo(() => docHtml(doc), [doc]);
  const n = doc.missing.length;
  return <div className="rp-wrap">
    <div className="rp-meta"><span className={"rp-chip" + (n ? " miss" : "")} data-rp-missing={n}>{n ? n + (n === 1 ? " answer missing" : " answers missing") : "All answers given"}</span>
      <span className="note">{c.inp.unitLine}</span></div>
    <article className="rp-sheet" data-rp-preview={doc.key} onClick={(ev) => { const m = ev.target.closest && ev.target.closest("mark[data-miss]"); if (m) setFin({ rep: "q", qk: m.dataset.miss, qOnly: false }); }}
      dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}

// one question: its box, where its answer came from, marked when it is still needed
function Field({ q, v, src, need, fy }) {
  const put = (x) => { setAnswer(S.books, fy, q.k, x); if (typeof saveBooks === "function") saveBooks(); render(); };
  const id = "rpq-" + q.k;
  let box;
  if (q.t === "choice") box = <select id={id} aria-label={q.l} value={v == null ? "" : v} onChange={(ev) => put(ev.target.value)}>{v == null || v === "" ? <option value="">Choose…</option> : null}{q.o.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  else if (q.t === "long") box = <CommitBox id={id} as="textarea" rows={2} aria-label={q.l} value={v == null ? "" : v} placeholder={q.hint || ""} onCommit={(x) => put(x.trim())} />;
  else if (q.t === "num" || q.t === "int") box = <CommitBox id={id} aria-label={q.l} inputMode="decimal" value={v == null ? "" : v} onCommit={(x) => { const t = String(x).replace(/[,₹\s]/g, ""); if (t === "") { put(null); return; } if (!isFinite(+t)) return false; put(q.t === "int" ? Math.round(+t) : +t); }} />;
  else if (q.t === "date") box = <CommitBox id={id} type="date" aria-label={q.l} value={v ? String(v).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") : ""} onCommit={(x) => put(x ? String(x).replace(/-/g, "") : null)} />;
  else if (q.t === "rows") {
    const list = Array.isArray(v) ? v : [];
    const set = (i, k, x) => { const l = list.map((r) => Object.assign({}, r)); l[i][k] = x; put(l); };
    box = <div className="rp-rows" data-rp-rows={q.k}>
      {list.map((r, i) => <div key={i} className="rp-row" style={{ gridTemplateColumns: "repeat(" + q.cols.length + ", minmax(0, 1fr)) auto" }}>
        {q.cols.map(([k, l]) => <CommitBox key={k} type={k === "date" ? "date" : "text"} aria-label={l + " " + (i + 1)} placeholder={l} value={k === "date" ? String(r[k] || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") : r[k] == null ? "" : r[k]}
          onCommit={(x) => set(i, k, k === "date" ? String(x || "").replace(/-/g, "") : String(x).trim())} />)}
        <button type="button" className="linkbtn" onClick={() => put(list.filter((_, j) => j !== i))}>Remove</button></div>)}
      <button type="button" className="linkbtn" data-rp-add={q.k} onClick={() => put(list.concat([Object.fromEntries(q.cols.map(([k]) => [k, ""]))]))}>Add a row</button>
    </div>;
  } else box = <CommitBox id={id} aria-label={q.l} value={v == null ? "" : v} placeholder={q.hint || ""} onCommit={(x) => put(x.trim())} />;
  return <div className={"rp-q" + (need ? " need" : "")} data-q={q.k} data-q-need={need ? "" : undefined}>
    <label htmlFor={id}>{q.l}{need && <em> needed</em>}</label>
    <div className="rp-q-box">{box}</div>
    <div className="rp-q-src">{src && SRC[src] ? <small className="note" data-q-src={src}>{SRC[src]}</small> : null}
      {src === "given" && (q.def !== undefined || q.pre) ? <button type="button" className="linkbtn" title="Back to the default or the figure from the books" onClick={() => put(null)}>Reset</button> : null}</div>
  </div>;
}

function Questionnaire({ p, fy }) {
  const s = st(), c = p.c, need = new Set(p.missing.map((q) => q.k));
  useEffect(() => { if (s.qk) { const el = document.querySelector('#app [data-q="' + s.qk + '"]'); if (el) { el.scrollIntoView({ block: "center" }); const i = el.querySelector("input, select, textarea"); if (i) i.focus(); } } }, [s.qk]);
  const only = !!s.qOnly;
  return <div className="rp-qn" data-rp-questionnaire="">
    <div className="rp-meta"><span className={"rp-chip" + (need.size ? " miss" : "")} data-rp-missing={need.size}>{need.size ? need.size + (need.size === 1 ? " answer missing" : " answers missing") : "All answers given"}</span>
      <label className="note"><input type="checkbox" aria-label="Only the answers missing" checked={only} onChange={(ev) => setFin({ qOnly: ev.target.checked })} /> only the answers missing</label>
      <span className="note">Kept for {c.fyLabel}; next year starts from these answers.</span></div>
    {SECTIONS.map(([sk, title]) => {
      const qs = QUESTIONS.filter((q) => q.s === sk && shown(q, c.ap, c.f, c.a) && (!only || need.has(q.k)));
      if (!qs.length) return null;
      return <section key={sk} className="rp-qs" data-rp-qs={sk}><h4>{title}</h4>
        {sk === "C" && !c.ap.caro.applies ? <p className="note">CARO 2020 does not apply: {c.ap.caro.reason}.</p> : null}
        {qs.map((q) => <Field key={q.k} q={q} v={c.a[q.k]} src={c.R.src[q.k]} need={need.has(q.k)} fy={fy} />)}</section>;
    })}
  </div>;
}

export default function Reports({ fy, unit, dec }) {
  const s = st(), rep = REPORTS.some(([k]) => k === s.rep) ? s.rep : "board", o = { unit, dec };
  let p;
  try { p = packFor(fy, o); } catch (e) { return <div className="bk-alert">The reports need the statements: {(e && e.message) || String(e)}</div>; }
  const doc = rep === "q" ? null : p[rep];
  const wordDl = () => ReportsPack.downloadDocx(rep, fy, o).catch(fail);
  const pdfDl = () => ReportsPack.openPdf([rep], fy, o);
  return <section className="fin-sheet rp" data-rp={rep}>
    <header className="rp-head">
      <div className="fin-seg" role="group" aria-label="Report" data-rp-seg="">
        {REPORTS.map(([k, l]) => <button key={k} type="button" aria-pressed={rep === k} data-rp-pick={k} onClick={() => setFin({ rep: k })}>{l}</button>)}</div>
      <span className="fin-sp" />
      {doc && <Button className="btn small" data-rp-dl="docx" onClick={wordDl}>Download Word</Button>}
      {doc && <Button className="btn small" data-rp-dl="pdf" onClick={pdfDl}>Download PDF</Button>}
    </header>
    <Applies c={p.c} />
    {doc ? <Preview doc={doc} c={p.c} /> : <Questionnaire p={p} fy={fy} />}
    <p className="note rp-foot">FinCom's own wording, from the books and the answers: read it through before it is signed. Limits applied: small company {cr(p.c.ap.smallTest.limits.paidUp)} / {cr(p.c.ap.smallTest.limits.turnover)} ({p.c.ap.smallTest.limits.ref}); CARO private company ₹1 crore / ₹1 crore / {cr(LAW.caroPvt.revenue)}.{p.c.a.e_board_date ? " Board's Report dated " + longDate(p.c.a.e_board_date) + "." : ""}</p>
  </section>;
}
