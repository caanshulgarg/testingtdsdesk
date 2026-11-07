// Corporate › e-Forms › AOC-4 (the design "3 · AOC-4 prepared from the balance sheet and P&L"): the year's balance sheet and
// P&L from FinCom's Financial statements (FinSt, the Statements page's own model: lib/finGlobals.js) or from an uploaded
// Excel/CSV (its columns mapped), in the order of form AOC-4, both years, the source of each figure, editable with a reason;
// the checks before filing; the attachments; and the "figures in MCA order" sheet as Excel, CSV and PDF. A lazy chunk of its
// own (with FinSt), loaded when the builder is opened. FinCom does not file: the SRN is typed in e-Forms after filing.
import { useState } from "react";
import "../../lib/finGlobals.js";
import Button from "../../parts/Button.jsx";
import { Card } from "./parts.jsx";
import { canEdit, corpOf, saveFiling } from "./store.js";
import { ATTACHMENTS, BS_HEADS, LEAVES, PL_HEADS, checks, csvOf, figures, fromBooks, fromUpload, num, sheetRows } from "./aoc4.js";
import { annual } from "./eforms.js";
import { dmy, dueIn, finKey, fyEnd, fyNext, lastClosedFy, today } from "./dates.js";
import { shown } from "./Profile.jsx";
import { H } from "./docPrint.js";

const STEPS = [["Statements", "From Books or an upload"], ["Figures in AOC-4 order", "Check and adjust"], ["Attachments", "Reports, signed copies"], ["Ready for MCA", "File, then save the SRN"]];
const fmt = (v) => { const n = +v || 0; if (Math.abs(n) < 0.005) return "-"; const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)); return n < 0 ? "(" + s + ")" : s; };
const save = async (name, blob) => { if (typeof window.saveFile === "function") return window.saveFile(name, blob); const a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); return true; };

// the words a line of an uploaded statement is read by
const SYN = { sc: /share capital/, rs: /reserves|surplus|retained/, msw: /share warrant/, sapp: /application money/, ltb: /long[- ]term borrow/, dtl: /deferred tax liab/, oltl: /other long[- ]term liab/, ltp: /long[- ]term prov/,
  stb: /short[- ]term borrow/, tpm: /(micro|msme)/, tpo: /trade payable|sundry creditor|creditors/, ocl: /other current liab/, stp: /short[- ]term prov/, ppe: /property|plant|tangible|fixed asset/, intang: /^intangible|intangible assets$/,
  cwip: /work[- ]in[- ]progress|cwip/, iaud: /under development/, nci: /non[- ]current invest/, dta: /deferred tax asset/, ltla: /long[- ]term loan/, onca: /other non[- ]current asset/, ci: /current invest/, inv: /inventor|stock/,
  tr: /trade receiv|debtor/, cash: /cash|bank/, stla: /short[- ]term loan/, oca: /other current asset/, rev: /revenue|sales|turnover/, oth: /other income/, mat: /material/, pur: /purchase/, chg: /change.*inventor/,
  emp: /employee|salar|staff/, fin: /finance cost|interest/, dep: /depreciation|amorti/, exp: /other expense/, exc: /exceptional/, exo: /extraordinary/, cur: /current tax|income tax/, def: /deferred tax/ };
export function guessHead(label) {
  const l = String(label || "").toLowerCase().trim();
  if (!l || /^total|^profit|^loss|^\(?[a-z]?\)?\s*$/.test(l) || /total$/.test(l)) return "";
  const order = ["tpm", "chg", "dta", "dtl", "iaud", "cwip", "nci", "ci", "oltl", "onca", "ocl", "oca", "ltla", "stla", "ltb", "stb", "ltp", "stp", "sc", "rs", "msw", "sapp", "ppe", "intang", "inv", "tr", "cash", "tpo", "oth", "rev", "mat", "pur", "emp", "fin", "dep", "exc", "exo", "cur", "def", "exp"];
  return order.find((k) => SYN[k].test(l)) || "";
}

// the statements worked out once for each state of the books (FinSt.build reads two years of balances)
let memo = { key: "", v: null };
function booksFigures(b, fy) {
  let k = ""; try { k = [b.cid, fy, (b.vouchers || []).length, (b.tb || {}).at || "", JSON.stringify(b.fs || {})].join("|"); } catch (e) { k = String(Date.now()); }
  if (memo.key !== k) memo = { key: k, v: fromBooks(finKey(fy)) };
  return memo.v;
}

async function readSheet(file) {
  if (/\.pdf$/i.test(file.name)) throw new Error("Reading a PDF comes in phase 2: upload the Excel or CSV for now.");
  if (typeof window.ensureXlsx === "function") await window.ensureXlsx();
  if (!window.XLSX) throw new Error("The Excel reader could not be loaded.");
  const buf = await file.arrayBuffer(), wb = window.XLSX.read(buf, { type: "array" }), ws = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).filter((r) => r.some((c) => String(c).trim() !== "")).slice(0, 400);
  // the columns: the label (the first mostly-text column), this year and last year (the first two mostly-number columns)
  const w = Math.max(0, ...rows.map((r) => r.length)), isNum = (c) => c !== "" && !isNaN(num(c)) && /\d/.test(String(c));
  const score = Array.from({ length: w }, (_, j) => rows.reduce((s, r) => s + (isNum(r[j]) ? 1 : 0), 0)), text = Array.from({ length: w }, (_, j) => rows.reduce((s, r) => s + (r[j] && !isNum(r[j]) ? 1 : 0), 0));
  const label = text.indexOf(Math.max(...text)), nums = score.map((s, j) => [s, j]).filter(([s, j]) => j !== label && s > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 2).map(([, j]) => j).sort((a, b) => a - b);
  const cols = { label: Math.max(0, label), cy: nums[0] != null ? nums[0] : 1, py: nums[1] != null ? nums[1] : 2 };
  const map = {}; rows.forEach((r, i) => { const k = guessHead(r[cols.label]); if (k && (isNum(r[cols.cy]) || isNum(r[cols.py]))) map[i] = k; });
  return { file: file.name, rows, cols, map };
}

function Grid({ heads, f, edit, setEdit, which, final }) {
  return <div className="corp-scroll"><table className="corp-table" style={{ minWidth: 720 }} data-aoc4-table={which}>
    <thead><tr><th>Item (Schedule III)</th><th className="n">Current year</th><th className="n">Previous year</th><th>Source</th></tr></thead>
    <tbody>{heads.map(([k, label, sec], i) => {
      if (k === "sec") return <tr key={i} className="corp-sec"><td colSpan={4}>{label}</td></tr>;
      if (k === "grp") return <tr key={i}><td colSpan={4} style={{ fontWeight: 600, fontSize: 13 }}>{label}</td></tr>;
      if (k === "tot") return <tr key={i} className="corp-tot" data-aoc4-total={sec}><td>{label}</td><td className="n">{fmt(f.tot.cy[sec])}</td><td className="n">{fmt(f.tot.py[sec])}</td><td /></tr>;
      const e = edit[k] || {}, edited = f.edited.includes(k);
      return <tr key={i} data-aoc4-line={k}><td style={{ paddingLeft: 32 }}>{label}{k === "tpo" && !(+f.cy.tpm) && +f.cy.tpo > 0 && <span className="corp-note" style={{ color: "var(--corp-warn)" }}> · MSME split needed</span>}</td>
        {["cy", "py"].map((col) => <td key={col} className="n" style={{ width: 160 }}><input aria-label={label + (col === "cy" ? " current year" : " previous year")} data-aoc4-input={k + ":" + col} disabled={final} inputMode="decimal"
          style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", background: edited && e[col] != null && e[col] !== "" ? "var(--brand-tint)" : undefined }}
          key={String(f[col][k])} defaultValue={fmt(f[col][k])} onBlur={(ev) => { const v = num(ev.target.value); if (Math.abs(v - (+f[col][k] || 0)) < 0.005) return; setEdit(k, Object.assign({}, e, { [col]: v })); }} /></td>)}
        <td style={{ fontSize: 12, color: "var(--corp-muted)" }}>{f.src[k]}{edited && !final && <input aria-label={"Why " + label + " was changed"} data-aoc4-why={k} defaultValue={e.why || ""} placeholder="why it was changed"
          style={{ display: "block", marginTop: 4, fontSize: 12, minHeight: 28 }} onBlur={(ev) => setEdit(k, Object.assign({}, e, { why: ev.target.value.trim() }))} />}
          {edited && !final && <button className="linkbtn" style={{ fontSize: 12 }} data-aoc4-undo={k} onClick={() => setEdit(k, null)}>Back to the source's figure</button>}</td></tr>;
    })}</tbody></table></div>;
}

function UploadMap({ up, set }) {
  const opts = [["", "Not used (total or heading)"]].concat(LEAVES.map(([k, l]) => [k, l]));
  return <div data-aoc4-map="" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div className="corp-row" style={{ fontSize: 13 }}>{[["label", "Item column"], ["cy", "Current year column"], ["py", "Previous year column"]].map(([k, l]) => <label key={k} className="corp-f"><span>{l}</span>
      <select data-aoc4-col={k} value={up.cols[k]} onChange={(e) => set(Object.assign({}, up, { cols: Object.assign({}, up.cols, { [k]: +e.target.value }) }))}>
        {Array.from({ length: Math.max(3, ...up.rows.map((r) => r.length)) }, (_, j) => <option key={j} value={j}>{"Column " + String.fromCharCode(65 + j) + (up.rows[0] && up.rows[0][j] !== undefined ? ": " + String(up.rows[0][j]).slice(0, 18) : "")}</option>)}</select></label>)}</div>
    <div className="corp-scroll" style={{ maxHeight: 360 }}><table className="corp-table"><thead><tr><th>Line in the file</th><th className="n">Current</th><th className="n">Previous</th><th>AOC-4 head</th></tr></thead>
      <tbody>{up.rows.map((r, i) => <tr key={i} data-upload-row={i}><td>{String(r[up.cols.label] || "")}</td><td className="n">{fmt(num(r[up.cols.cy]))}</td><td className="n">{fmt(num(r[up.cols.py]))}</td>
        <td><select aria-label={"AOC-4 head for " + String(r[up.cols.label] || "line " + (i + 1))} data-upload-head={i} value={up.map[i] || ""} onChange={(e) => { const m = Object.assign({}, up.map); if (e.target.value) m[i] = e.target.value; else delete m[i]; set(Object.assign({}, up, { map: m })); }}>
          {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td></tr>)}</tbody></table></div>
  </div>;
}

function printSheet(rows, title) {
  const w = window.open("", "_blank");
  if (!w) { if (typeof toast === "function") toast("Allow pop-ups for this site to save the PDF."); return null; }
  const body = rows.map((r) => { const isHead = r.length === 1, isTot = r.length === 4 && r[3] === "" && typeof r[1] === "number";
    return isHead ? "<tr class=\"h\"><td colspan=\"4\">" + H(r[0]) + "</td></tr>" : r.length ? "<tr" + (isTot ? ' class="t"' : "") + "><td>" + H(String(r[0]).trim()) + "</td><td class=\"n\">" + (typeof r[1] === "number" ? fmt(r[1]) : H(r[1])) + "</td><td class=\"n\">" + (typeof r[2] === "number" ? fmt(r[2]) : H(r[2])) + "</td><td class=\"s\">" + H(r[3] || "") + "</td></tr>" : "<tr><td colspan=\"4\">&nbsp;</td></tr>"; }).join("");
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + H(title) + "</title><style>@page{size:A4 portrait;margin:14mm}body{font:11.5px/1.45 Inter,Arial,sans-serif;color:#18202E}table{width:100%;border-collapse:collapse}td{padding:3px 6px;border-bottom:1px solid #E1E5EC;vertical-align:top}" +
    "td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.s{color:#6A7385;font-size:10px}tr.h td{font-weight:700;color:#14213D;border-bottom:1px solid #14213D;padding-top:8px}tr.t td{font-weight:700;border-top:1px solid #18202E}</style></head><body data-aoc4-print=\"\"><table>" + body + "</table></body></html>");
  w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* */ } }, 300);
  return w;
}

export default function Aoc4({ co }) {
  const c = corpOf(co.id), P = shown(co), fy = S.corpFy || lastClosedFy(today());
  const row = annual(P, fy, c.filings).find((r) => r.form === "AOC-4") || {};
  const fl = (c.filings || []).find((x) => x.ref === row.ref) || {}, data = fl.data || {};
  const [tab, setTab] = useState("bs"), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  // a viewer, or a page whose copy is not in, looks and downloads; nothing it does is kept
  const may = canEdit(co.id);
  const keep = (patch, extra) => may && saveFiling(co.id, Object.assign({ ref: row.ref, form: "AOC-4", kind: "annual", period: fy, due: row.due, status: fl.status || "in_progress", steps: fl.steps || 0 }, extra || {}, { data: Object.assign({}, data, patch) }));
  const source = data.source || "books";
  // the books: opened here when they are not (the Statements page's way)
  const b = S.books && S.books.cid === co.id ? S.books : null;
  if (source === "books" && !b) { if (typeof openBooks === "function") openBooks(co.id); }
  let base = null, why = "";
  if (source === "upload") base = data.upload ? fromUpload(data.upload) : null;
  else if (!b || b.loading) why = "Opening the books…";
  else if (!(b.vouchers || []).length) why = "The books have no day book yet: bring it in from Tally (Books › From Tally), or upload the balance sheet and P&L instead.";
  else { const x = booksFigures(b, fy); if (x.error) why = x.error; else base = x; }
  const f = base ? figures(base, data.edits) : null;
  const prev = (c.filings || []).find((x) => x.ref === "annual:AOC-4:" + fyNext(fy, -1) && x.status === "filed");
  const cks = f ? checks(f, { lastFiled: prev && prev.data && prev.data.figures, lastFy: fyNext(fy, -1), udin: data.udin }) : [];
  const att = data.attach || {}, attDone = ATTACHMENTS.every(([k]) => att[k] === "ready" || att[k] === "na");
  const stepNow = !f ? 0 : !data.figuresOk ? 1 : !attDone ? 2 : 3;
  const setEdit = (k, e) => { const ed = Object.assign({}, data.edits); if (e) ed[k] = e; else delete ed[k]; keep({ edits: ed, figuresOk: false }); };
  const d = dueIn(row.due), final = fl.status === "filed";
  const meta = { company: P.name || co.name, cin: P.cin, fy, source: source === "upload" ? "the uploaded " + ((data.upload || {}).file || "file") : "FinCom Books", cyDate: dmy(fyEnd(fy)), pyDate: dmy(fyEnd(fyNext(fy, -1))) };
  const fileBase = (meta.company + " AOC-4 figures FY " + fy).replace(/[\\/:*?"<>|]+/g, " ");
  const stamp = () => keep({ figures: f.cy, pyFigures: f.py });
  const download = async (kind) => {
    if (!f) return; setBusy(kind); setErr("");
    try {
      const rows = sheetRows(f, meta); stamp();
      if (kind === "csv") await save(fileBase + ".csv", new Blob(["﻿" + csvOf(rows)], { type: "text/csv;charset=utf-8" }));
      else if (kind === "xlsx") {
        if (typeof window.ensureXlsx === "function") await window.ensureXlsx();
        const X = window.XLSX; if (!X) throw new Error("The Excel writer could not be loaded.");
        const ws = X.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch: 58 }, { wch: 18 }, { wch: 18 }, { wch: 40 }];
        const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "AOC-4 figures");
        await save(fileBase + ".xlsx", new Blob([X.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      } else printSheet(rows, fileBase);
    } catch (e) { setErr(String((e && e.message) || e)); } finally { setBusy(""); }
  };
  const upload = async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
    setErr(""); setBusy("upload");
    try { const up = await readSheet(file); keep({ source: "upload", upload: up, edits: {}, figuresOk: false }); } catch (x) { setErr(String((x && x.message) || x)); } finally { setBusy(""); }
  };
  return <div data-corp-page="aoc4" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    {!may && <p className="corp-note" data-corp-readonly="">Read only: the firm's owner or staff prepare the AOC-4.</p>}
    <header className="corp-card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <nav aria-label="Breadcrumb" className="corp-note"><button className="linkbtn" onClick={() => goClient("books:corp")}>{P.name || co.name}</button> › <button className="linkbtn" data-aoc4-back="" onClick={() => goClient("books:corp-forms")}>e-Forms</button> › AOC-4</nav>
          <div className="corp-row"><h1 style={{ fontSize: 24 }}>{"AOC-4 · financial statements, FY " + fy}</h1>
            {row.due && <span className="corp-chip" data-tone={final ? "ok" : d.tone || undefined}>{final ? "Filed" + (fl.srn ? " · SRN " + fl.srn : "") : "Due " + dmy(row.due) + (d.words ? " · " + d.words : "")}</span>}</div>
        </div>
        <div className="corp-row">
          <Button className="btn" data-aoc4-save="" disabled={!f} onClick={() => { stamp(); }}>Save draft</Button>
          {stepNow === 1 && <Button className="btn primary" data-aoc4-next="" disabled={!f} onClick={() => { keep({ figuresOk: true, figures: f.cy, pyFigures: f.py }, { steps: Math.max(fl.steps || 0, 2), status: final ? "filed" : "in_progress" }); }}>Next: attachments</Button>}
          {stepNow === 3 && !final && <Button className="btn primary" data-aoc4-ready="" onClick={() => { keep({ figures: f.cy, pyFigures: f.py }, { steps: 4, status: "ready" }); goClient("books:corp-forms"); }}>Ready for MCA</Button>}
        </div>
      </div>
      <ol aria-label="Steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        {STEPS.map(([t, s], i) => { const done = i < stepNow || (i === 3 && (fl.status === "ready" || final)); return <li key={t} data-aoc4-step={i} data-done={done ? "" : undefined} aria-current={i === stepNow ? "step" : undefined} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
          <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flex: "0 0 auto",
            background: done ? "var(--corp-navy)" : i === stepNow ? "var(--brand-tint)" : "var(--corp-tint)", color: done ? "var(--corp-card)" : "var(--corp-navy)" }}>{done ? "✓" : i + 1}</span>
          <span><b>{t}</b><br /><span className="corp-note" style={{ fontSize: 12 }}>{s}</span></span></li>; })}
      </ol>
    </header>
    <div className="corp-cols">
      <div className="corp-main">
        <section className="corp-card" style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }} data-aoc4-source="">
          <label className="corp-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}><input type="radio" name="aoc4src" data-aoc4-src="books" checked={source === "books"} disabled={final} onChange={() => keep({ source: "books", figuresOk: false })} />
            <span><b>From FinCom Books</b><br /><span className="corp-note">{"Balance sheet & P&L of FY " + fy + (base && source === "books" ? " · books " + dmy(String(base.info.from).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) + " to " + dmy(String(base.info.to).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) + " · " + base.info.ledgers + " ledgers mapped to Schedule III · previous year from " + base.info.py : " · the Statements page's figures")}</span></span></label>
          <label className="corp-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}><input type="radio" name="aoc4src" data-aoc4-src="upload" checked={source === "upload"} disabled={final} onChange={() => keep({ source: "upload", figuresOk: false })} />
            <span><b>Upload balance sheet &amp; P&amp;L</b><br /><span className="corp-note">Excel or CSV from the auditor: FinCom reads the lines and you map them to the form's heads. PDF: coming in phase 2.</span></span></label>
          {source === "upload" && !final && <div className="corp-row"><label className="btn small" style={{ cursor: "pointer" }}><input type="file" accept=".xlsx,.xls,.csv" data-aoc4-file="" style={{ display: "none" }} onChange={upload} />{data.upload ? "Upload another file" : "Choose the Excel or CSV"}</label>
            <span className="btn small" aria-disabled="true" title="Reading a PDF balance sheet comes in phase 2" style={{ opacity: 0.55 }}>PDF · coming</span>
            {data.upload && <span className="corp-note">{data.upload.file + " · " + Object.keys(data.upload.map || {}).length + " lines mapped"}</span>}</div>}
          {source === "upload" && data.upload && !final && <details data-aoc4-mapping="" open={!Object.keys(data.upload.map || {}).length}><summary style={{ cursor: "pointer", fontSize: 13 }}>Map the file's lines to AOC-4's heads</summary>
            <UploadMap up={data.upload} set={(up) => keep({ upload: up, figuresOk: false })} /></details>}
          {busy === "upload" && <p className="corp-note" role="status">Reading the file…</p>}
          {err && <p className="corp-note" role="alert" style={{ color: "var(--corp-bad)" }} data-aoc4-error="">{err}</p>}
        </section>
        <section className="corp-card" style={{ overflow: "hidden" }}>
          <div role="tablist" aria-label="Statement" className="sbar" style={{ margin: "0 18px" }}>
            {[["bs", "Balance sheet"], ["pl", "Profit & loss"], ["co", "Company & auditor details"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} data-aoc4-tab={k} onClick={() => setTab(k)}>{l}</button>)}</div>
          {!f ? <div className="corp-empty" data-aoc4-wait="">{source === "upload" ? "Upload the balance sheet and P&L (Excel or CSV) to begin." : why}</div>
            : tab === "bs" ? <Grid heads={BS_HEADS} f={f} edit={data.edits || {}} setEdit={setEdit} which="bs" final={final} />
            : tab === "pl" ? <Grid heads={PL_HEADS} f={f} edit={data.edits || {}} setEdit={setEdit} which="pl" final={final} />
            : <div className="corp-card-body" style={{ paddingTop: 14 }}><div className="corp-grid">
              {[["cin", "CIN", P.cin], ["auditor", "Auditor", P.auditor], ["frn", "Auditor's FRN", P.auditorFrn]].map(([k, l, v]) => <label key={k} className="corp-f"><span>{l}</span><input type="text" value={v || ""} readOnly aria-label={l} /></label>)}
              {[["udin", "Auditor's UDIN"], ["signedOn", "Date the statements were signed"], ["agm", "Date of the AGM"]].map(([k, l]) => <label key={k} className="corp-f"><span>{l}</span>
                <input type={k === "udin" ? "text" : "date"} data-aoc4-detail={k} defaultValue={k === "agm" ? (data.agm || (P.agms || {})[fy] || "") : data[k] || ""} disabled={final} onBlur={(e) => keep({ [k]: e.target.value.trim() })} /></label>)}</div>
              <p className="corp-note">The CIN and the auditor come from Company profile; edit them there.</p></div>}
        </section>
        <div className="corp-row" data-aoc4-out="">
          <span className="corp-note">Figures in MCA order:</span>
          <Button className="btn small" data-aoc4-xlsx="" disabled={!f || busy === "xlsx"} onClick={() => download("xlsx")}>Excel</Button>
          <Button className="btn small" data-aoc4-csv="" disabled={!f} onClick={() => download("csv")}>CSV</Button>
          <Button className="btn small" data-aoc4-pdf="" disabled={!f} onClick={() => download("pdf")}>PDF</Button>
          {source === "books" && <Button className="btn small" data-aoc4-fs-pdf="" disabled={!f} onClick={() => { if (window.FinPdf && window.FinPdf.open) window.FinPdf.open(finKey(fy), {}); }}>Financial statements PDF</Button>}
        </div>
      </div>
      <aside className="corp-side">
        <section className="corp-card corp-card-body corp-checks" style={{ paddingTop: 16 }} data-aoc4-checks="">
          <h2 style={{ fontSize: 17 }}>Checks before filing</h2>
          {!f ? <p className="corp-note">Worked out once the figures are in.</p> : cks.map((x) => <div key={x.key} data-check={x.key} data-ok={x.ok === true ? "yes" : x.ok === false ? "no" : "na"}>
            <span data-mark={x.ok === true ? "ok" : x.ok === null ? "info" : x.warn ? "warn" : "bad"}>{x.ok === true ? "✓" : x.ok === null ? "i" : "!"}</span><span>{x.text}</span></div>)}
        </section>
        <section className="corp-card corp-card-body" style={{ paddingTop: 16 }} data-aoc4-attach="">
          <h2 style={{ fontSize: 17 }}>Attachments</h2>
          {ATTACHMENTS.map(([k, l, how]) => <div key={k} className="corp-row" style={{ justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--corp-soft)", paddingBottom: 8, flexWrap: "nowrap" }} data-attach={k}>
            <span style={{ minWidth: 0 }}>{l}<br /><span className="corp-note" style={{ fontSize: 12 }}>{how}</span></span>
            <select aria-label={"State of: " + l} data-attach-state={k} disabled={final} value={att[k] || ""} onChange={(e) => { const na = Object.assign({}, att, { [k]: e.target.value }), all = ATTACHMENTS.every(([z]) => na[z] === "ready" || na[z] === "na");
              keep({ attach: na }, data.figuresOk && all ? { steps: Math.max(fl.steps || 0, 3), status: final ? "filed" : "in_progress" } : null); }} style={{ maxWidth: 130 }}>
              <option value="">To do</option><option value="ready">Ready</option><option value="na">Not applicable</option></select></div>)}
          <div className="corp-row" style={{ fontSize: 13 }}>
            <button className="linkbtn" onClick={() => { S.fsTab = "reports"; goClient("books:fs"); }}>Board's report: draft it in Statements › Reports</button>
            <button className="linkbtn" onClick={() => goClient("books:corp-docs")}>Notice of the AGM: Resolutions &amp; minutes</button></div>
        </section>
        <section className="corp-card corp-card-body" style={{ paddingTop: 16, background: "var(--corp-tint)" }}>
          <b>At the end</b>
          <span className="corp-note">FinCom gives the figures in the order of the MCA form, and the attachments as PDFs. You file on the MCA portal with DSC, then save the SRN in e-Forms; the due list updates by itself.</span>
          <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => goClient("books:corp-forms")}>Save the SRN in e-Forms ›</button>
        </section>
      </aside>
    </div>
  </div>;
}
