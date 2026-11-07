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
import { ATTACHMENTS, BS_HEADS, LEAVES, PL_HEADS, UNITS, autoCols, guessSheets, linesOfSheets, checks, csvOf, figures, fromBooks, fromUpload, linesOf, num, sheetLines, sheetRows, totalChecks, udinOk } from "./aoc4.js";
import { annual } from "./eforms.js";
import { dmy, dueIn, finKey, fyEnd, fyNext, lastClosedFy, today } from "./dates.js";
import { shown } from "./Profile.jsx";
import { H } from "./docPrint.js";

const STEPS = [["Statements", "From Books or an upload"], ["Figures in AOC-4 order", "Check and adjust"], ["Attachments", "Reports, signed copies"], ["Ready for MCA", "File, then save the SRN"]];
const fmt = (v) => { const n = +v || 0; if (Math.abs(n) < 0.005) return "-"; const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)); return n < 0 ? "(" + s + ")" : s; };
const save = async (name, blob) => { if (typeof window.saveFile === "function") return window.saveFile(name, blob); const a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); return true; };

// the statements worked out once for each state of the books (FinSt.build reads two years of balances)
let memo = { key: "", v: null };
function booksFigures(b, fy) {
  // the books' revision (BOOKS_REV: every save of the books, a voucher edited in FinCom included) is in the key
  let k = ""; try { k = [b.cid, fy, typeof BOOKS_REV === "number" ? BOOKS_REV : "", (b.vouchers || []).length, (b.tb || {}).at || "", JSON.stringify(b.fs || {})].join("|"); } catch (e) { k = String(Date.now()); }
  if (memo.key !== k) memo = { key: k, v: fromBooks(finKey(fy)) };
  return memo.v;
}

// a file read: every sheet (the person picks one), at most 400 lines of at most 30 columns each (XLSX reads 401 rows at
// most, and each sheet's used range is cut before it is read: a sheet formatted far down stays quick); a CSV read as
// UTF-8. Kept on this page only while it is open: what is saved is the lines made from it (linesOf), never the raw cells
async function readSheet(file) {
  if (/\.pdf$/i.test(file.name)) throw new Error("Reading a PDF comes in phase 2: upload the Excel or CSV for now.");
  if (typeof window.ensureXlsx === "function") await window.ensureXlsx();
  if (!window.XLSX) throw new Error("The Excel reader could not be loaded.");
  const X = window.XLSX, opt = { sheetRows: 401 };
  const wb = /\.csv$/i.test(file.name) ? X.read(await file.text(), Object.assign({ type: "string", raw: true }, opt)) : X.read(await file.arrayBuffer(), Object.assign({ type: "array" }, opt));
  const sheets = (wb.SheetNames || []).map((name) => ({ name, rows: sheetLines(X, wb.Sheets[name]) })).filter((x) => x.rows.length);
  if (!sheets.length) throw new Error("No lines found in the file.");
  return { file: file.name, sheets };
}

function Grid({ heads, f, edit, setEdit, which, final, onBad }) {
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
          key={String(f[col][k])} defaultValue={fmt(f[col][k])} onBlur={(ev) => { const v = num(ev.target.value); if (isNaN(v)) { onBad(ev.target.value); return; } if (Math.abs(v - (+f[col][k] || 0)) < 0.005) return; setEdit(k, Object.assign({}, e, { [col]: v })); }} /></td>)}
        <td style={{ fontSize: 12, color: "var(--corp-muted)" }}>{f.src[k]}{edited && !final && <input aria-label={"Why " + label + " was changed"} data-aoc4-why={k} defaultValue={e.why || ""} placeholder="why it was changed (needed)"
          style={{ display: "block", marginTop: 4, fontSize: 12, minHeight: 28, borderColor: e.why ? undefined : "var(--corp-warn)" }} onBlur={(ev) => setEdit(k, Object.assign({}, e, { why: ev.target.value.trim() }))} />}
          {edited && !final && <button className="linkbtn" style={{ fontSize: 12 }} data-aoc4-undo={k} onClick={() => setEdit(k, null)}>Back to the source's figure</button>}</td></tr>;
    })}</tbody></table></div>;
}

function UploadMap({ up, set, raw, setRaw }) {
  const opts = [["", "Choose the head"], ["-", "Not used (a total or a heading)"]].concat(LEAVES.map(([k, l]) => [k, l]));
  const sheet = raw && raw.file === up.file ? raw.sheets.find((x) => x.name === up.sheet) || raw.sheets[0] : null;
  const recut = (sheetName, cols, plName) => set(linesOfSheets(up.file, raw.sheets, sheetName, plName === undefined ? up.plSheet || "" : plName, cols));
  return <div data-aoc4-map="" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {sheet ? <div className="corp-row" style={{ fontSize: 13 }}>
      {raw.sheets.length > 1 && <label className="corp-f"><span>Balance sheet: sheet</span><select data-aoc4-sheet="" value={sheet.name} onChange={(e) => recut(e.target.value, undefined, up.plSheet === e.target.value ? "" : up.plSheet || "")}>{raw.sheets.map((x) => <option key={x.name} value={x.name}>{x.name + " · " + x.rows.length + " lines"}</option>)}</select></label>}
      {raw.sheets.length > 1 && <label className="corp-f"><span>Profit and loss: sheet</span><select data-aoc4-pl-sheet="" value={up.plSheet || ""} onChange={(e) => recut(sheet.name, undefined, e.target.value)}>
        <option value="">The same sheet</option>{raw.sheets.filter((x) => x.name !== sheet.name).map((x) => <option key={x.name} value={x.name}>{x.name + " · " + x.rows.length + " lines"}</option>)}</select></label>}
      {[["label", "Item column"], ["cy", "Current year column"], ["py", "Previous year column"]].map(([k, l]) => <label key={k} className="corp-f"><span>{l}</span>
      <select data-aoc4-col={k} value={up.cols[k]} onChange={(e) => recut(sheet.name, Object.assign({}, up.cols, { [k]: +e.target.value }))}>
        {Array.from({ length: Math.min(30, Math.max(3, ...sheet.rows.map((r) => r.length))) }, (_, j) => <option key={j} value={j}>{"Column " + String.fromCharCode(65 + j) + (sheet.rows[0] && sheet.rows[0][j] !== undefined ? ": " + String(sheet.rows[0][j]).slice(0, 18) : "")}</option>)}</select></label>)}</div>
      : <p className="corp-note" style={{ margin: 0 }}>{(up.sheet ? "Sheet " + up.sheet + " · " : "") + "To choose other columns or another sheet, upload the file again."}</p>}
    <p className="corp-note" style={{ margin: 0 }}>Amounts: (1,000), -1,000, 1,000- and 1,000 Cr are read as negative; 1,000 Dr as positive; ₹ and Rs. are left out.</p>
    <div className="corp-scroll" style={{ maxHeight: 360 }}><table className="corp-table"><thead><tr><th>Line in the file</th><th className="n">Current</th><th className="n">Previous</th><th>AOC-4 head</th></tr></thead>
      <tbody>{up.lines.map((z, i) => <tr key={i} data-upload-row={i} data-unmapped={!(up.map || {})[i] && (z.cy || z.py) ? "" : undefined}><td>{z.label}</td>
        <td className="n">{isNaN(z.cy) ? <span style={{ color: "var(--corp-bad)" }}>not an amount</span> : fmt(z.cy)}</td><td className="n">{isNaN(z.py) ? <span style={{ color: "var(--corp-bad)" }}>not an amount</span> : fmt(z.py)}</td>
        <td><select aria-label={"AOC-4 head for " + (z.label || "line " + (i + 1))} data-upload-head={i} value={(up.map || {})[i] || ""} onChange={(e) => { const m = Object.assign({}, up.map), g = Object.assign({}, up.guessed); if (e.target.value) m[i] = e.target.value; else delete m[i]; delete g[i]; set(Object.assign({}, up, { map: m, guessed: g })); }}>
          {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {(up.guessed || {})[i] && <span className="corp-note" data-upload-guessed={i} style={{ display: "block", fontSize: 11, color: "var(--corp-warn)" }}>guessed from its words: check the head</span>}</td></tr>)}</tbody></table></div>
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
  const [tab, setTab] = useState("bs"), [err, setErr] = useState(""), [busy, setBusy] = useState(""), [raw, setRaw] = useState(null), [mapOpen, setMapOpen] = useState(false);
  // a viewer, or a page whose copy is not in, looks and downloads; nothing it does is kept
  const may = canEdit(co.id);
  // any change to a form marked Ready puts it back to In progress (it is Ready again only by Ready for MCA)
  const back = () => (fl.status === "ready" ? { status: "in_progress", steps: Math.min(fl.steps || 0, 2) } : {});
  const change = (patch, extra) => keep(patch, Object.assign(back(), extra || {}));
  const keep = (patch, extra) => may && saveFiling(co.id, Object.assign({ ref: row.ref, form: "AOC-4", kind: "annual", period: fy, due: row.due, status: fl.status || "in_progress", steps: fl.steps || 0 }, extra || {}, { data: Object.assign({}, data, patch) }));
  const source = data.source || "books", final = fl.status === "filed";
  // each source has its own edits (switching source starts with that source's); older drafts kept one set, the Books'
  const editsOf = (src) => (data.editsBy ? data.editsBy[src] || {} : src === "books" ? data.edits || {} : {});
  const edits = editsOf(source);
  // the books: opened here when they are not (the Statements page's way)
  const b = S.books && S.books.cid === co.id ? S.books : null;
  if (source === "books" && !b) { if (typeof openBooks === "function") openBooks(co.id); }
  let base = null, why = "";
  // a filed AOC-4 is shown (and downloaded) as it was saved: never worked out again; filed with nothing saved: said
  if (final) { if (data.figures) base = { cy: data.figures, py: data.pyFigures || {}, src: data.srcSaved || {}, unmapped: [], info: {} }; else why = "Marked filed without figures saved in FinCom: nothing is worked out for a filed form."; }
  else if (source === "upload") base = data.upload && data.upload.lines ? fromUpload(data.upload) : null;
  else if (!b || b.loading) why = "Opening the books…";
  else if (!(b.vouchers || []).length) why = "The books have no day book yet: bring it in from Tally (Books › From Tally), or upload the balance sheet and P&L instead.";
  else { const x = booksFigures(b, fy); if (x.error) why = x.error; else base = x; }
  const f = base ? figures(base, final && data.figures ? {} : edits) : null;
  const prev = (c.filings || []).find((x) => x.ref === "annual:AOC-4:" + fyNext(fy, -1) && x.status === "filed");
  const un = (base && base.unmapped) || [], noWhy = Object.entries(edits).filter(([, e]) => !String(e.why || "").trim()).map(([k]) => k);
  const cks = f ? checks(f, { lastFiled: prev && prev.data && prev.data.figures, lastFy: fyNext(fy, -1), udin: data.udin, unmapped: un, totals: base.totals ? totalChecks(f, base.totals) : [], bad: base.bad }) : [];
  const bsOk = !!cks.find((x) => x.key === "bs" && x.ok), guessLeft = base && base.guessed && !base.headsOk;
  // what holds back Next (the figures) and Ready (as well: the balance sheet tallies, the UDIN is right, the heads checked)
  const holdNext = un.length ? "Not in any head: map every line first" : noWhy.length ? "Give the reason for each figure changed" : base && base.bad && base.bad.length ? "Some cells of the file are not amounts" : "";
  // the file's own totals (P&L ones included: total income, total expenses, profit) must agree, as the balance sheet must tally
  const badTotal = cks.find((x) => /^total\d+$/.test(x.key) && x.ok === false);
  const hold = holdNext || (!bsOk ? "The balance sheet does not tally" : badTotal ? badTotal.text : !udinOk(data.udin) ? "Enter the auditor's UDIN (18 characters)" : guessLeft ? "Check the heads guessed from the file's words (or tick that you have)" : "");
  const att = data.attach || {}, attDone = ATTACHMENTS.every(([k]) => att[k] === "ready" || att[k] === "na");
  const stepNow = !f ? 0 : !data.figuresOk ? 1 : !attDone ? 2 : 3;
  // a figure changed: kept with this source's edits; after Ready, the form is in progress again
  const setEdit = (k, e) => { const ed = Object.assign({}, edits); if (e) ed[k] = e; else delete ed[k];
    change({ editsBy: Object.assign({ books: editsOf("books"), upload: editsOf("upload") }, { [source]: ed }), edits: undefined, figuresOk: false }, fl.status === "ready" ? { steps: Math.min(fl.steps || 0, 1) } : null); };
  const d = dueIn(row.due);
  const meta = { company: P.name || co.name, cin: P.cin, fy, source: source === "upload" ? "the uploaded " + ((data.upload || {}).file || "file") : "FinCom Books", cyDate: dmy(fyEnd(fy)), pyDate: dmy(fyEnd(fyNext(fy, -1))) };
  const fileBase = (meta.company + " AOC-4 figures FY " + fy).replace(/[\\/:*?"<>|]+/g, " ");
  // Save draft keeps the figures; a form Ready keeps the figures it was made Ready with: figures that differ take it back to
  // In progress (change), never replaced quietly; downloads keep nothing
  // equal as values, whatever the order of the keys (the server's jsonb keeps its own)
  const canon = (x) => (x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
  const same = (a, b) => JSON.stringify(canon(a || {})) === JSON.stringify(canon(b || {}));
  const stamp = () => {
    if (final || !f) return;
    if (fl.status === "ready") { if (!same(f.cy, data.figures) || !same(f.py, data.pyFigures)) change({ figures: f.cy, pyFigures: f.py, srcSaved: f.src, figuresOk: false }, { steps: Math.min(fl.steps || 0, 1) }); return; }
    keep({ figures: f.cy, pyFigures: f.py, srcSaved: f.src });
  };
  const download = async (kind) => {
    if (!f) return; setBusy(kind); setErr("");
    try {
      const rows = sheetRows(f, meta);
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
    try {
      const r = await readSheet(file), g = guessSheets(r.sheets), up = linesOfSheets(r.file, r.sheets, g.bs, g.pl);
      // a new file starts again: the figures changed by hand for the upload go (asked first)
      if (Object.keys(editsOf("upload")).length && !window.confirm("A new file: the figures you changed by hand for the upload will be cleared. Go on?")) return;
      setRaw(r); change({ source: "upload", upload: up, editsBy: { books: editsOf("books"), upload: {} }, edits: undefined, figuresOk: false });
    } catch (x) { setErr(String((x && x.message) || x)); } finally { setBusy(""); }
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
          {!final && <Button className="btn" data-aoc4-save="" disabled={!f} onClick={() => { stamp(); }}>Save draft</Button>}
          {stepNow === 1 && !final && holdNext && <span className="corp-note" data-aoc4-hold="" style={{ color: "var(--corp-bad)" }}>{holdNext}</span>}
          {stepNow === 1 && !final && <Button className="btn primary" data-aoc4-next="" disabled={!f || !!holdNext} title={holdNext || undefined} onClick={() => { if (holdNext) return; keep({ figuresOk: true, figures: f.cy, pyFigures: f.py, srcSaved: f.src }, { steps: Math.max(fl.steps || 0, 2), status: "in_progress" }); }}>Next: attachments</Button>}
          {stepNow === 3 && !final && <Button className="btn primary" data-aoc4-ready="" disabled={!!hold} title={hold || undefined} onClick={() => { if (hold) return; keep({ figures: f.cy, pyFigures: f.py, srcSaved: f.src }, { steps: 4, status: "ready" }); goClient("books:corp-forms"); }}>Ready for MCA</Button>}
          {stepNow === 3 && !final && hold && <span className="corp-note" data-aoc4-hold="" style={{ color: "var(--corp-bad)" }}>{hold}</span>}
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
          <label className="corp-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}><input type="radio" name="aoc4src" data-aoc4-src="books" checked={source === "books"} disabled={final} onChange={() => change({ source: "books", figuresOk: false })} />
            <span><b>From FinCom Books</b><br /><span className="corp-note">{"Balance sheet & P&L of FY " + fy + (base && source === "books" ? " · books " + dmy(String(base.info.from).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) + " to " + dmy(String(base.info.to).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) + " · " + base.info.ledgers + " ledgers mapped to Schedule III · previous year from " + base.info.py : " · the Statements page's figures")}</span></span></label>
          <label className="corp-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}><input type="radio" name="aoc4src" data-aoc4-src="upload" checked={source === "upload"} disabled={final} onChange={() => change({ source: "upload", figuresOk: false })} />
            <span><b>Upload balance sheet &amp; P&amp;L</b><br /><span className="corp-note">Excel or CSV from the auditor: FinCom reads the lines and you map them to the form's heads. PDF: coming in phase 2.</span></span></label>
          {source === "upload" && !final && <div className="corp-row"><label className="btn small" style={{ cursor: "pointer" }}><input type="file" accept=".xlsx,.xls,.csv" data-aoc4-file="" style={{ display: "none" }} onChange={upload} />{data.upload ? "Upload another file" : "Choose the Excel or CSV"}</label>
            <span className="btn small" aria-disabled="true" title="Reading a PDF balance sheet comes in phase 2" style={{ opacity: 0.55 }}>PDF · coming</span>
            {data.upload && <span className="corp-note">{data.upload.file + " · " + Object.keys(data.upload.map || {}).length + " lines mapped"}</span>}</div>}
          {source === "upload" && data.upload && data.upload.lines && !final && <details data-aoc4-mapping="" open={mapOpen || !Object.keys(data.upload.map || {}).length || undefined} onToggle={(e) => setMapOpen(e.currentTarget.open)}><summary style={{ cursor: "pointer", fontSize: 13 }}>Map the file's lines to AOC-4's heads</summary>
            <UploadMap up={data.upload} raw={raw} setRaw={setRaw} set={(up) => change({ upload: Object.assign({}, up, { headsOk: false }), figuresOk: false })} /></details>}
          {source === "upload" && data.upload && data.upload.lines && !final && <label className="corp-row" style={{ fontSize: 13 }}>
            <span>{"Amounts in the file are in" + (data.upload.unitFound && data.upload.unitFound !== 1 ? " (found in its headings)" : "")}</span>
            <select data-aoc4-unit="" value={data.upload.unit || 1} onChange={(e) => change({ upload: Object.assign({}, data.upload, { unit: +e.target.value }), figuresOk: false })}>
              {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>
            <span className="corp-note" data-aoc4-unit-used="">{(data.upload.unit || 1) === 1 ? "read as rupees" : "multiplied by " + new Intl.NumberFormat("en-IN").format(data.upload.unit) + " to rupees"}</span></label>}
          {source === "upload" && data.upload && Object.keys(data.upload.guessed || {}).length > 0 && !final && <label className="corp-row" style={{ fontSize: 13 }} data-aoc4-heads-ok="">
            <input type="checkbox" checked={!!data.upload.headsOk} onChange={(e) => (e.target.checked ? keep : change)({ upload: Object.assign({}, data.upload, { headsOk: e.target.checked }) })} />
            {"I've checked the heads (" + Object.keys(data.upload.guessed).length + " guessed from the file's words)"}</label>}
          {source === "upload" && data.upload && !data.upload.lines && !final && <p className="corp-note">This upload was kept in an older form: upload the file again.</p>}
          {f && un.length > 0 && <div data-aoc4-unmapped="" style={{ border: "1px solid var(--corp-bad)", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
            <b style={{ color: "var(--corp-bad)" }}>{"Not in any head: " + un.length + (un.length === 1 ? " line" : " lines") + ", ₹" + fmt(un.reduce((x, z) => x + Math.abs(z.cy || 0), 0)) + " this year, ₹" + fmt(un.reduce((x, z) => x + Math.abs(z.py || 0), 0)) + " last year"}</b>
            <ul style={{ margin: "6px 0", paddingLeft: 18 }}>{un.slice(0, 12).map((z, i) => <li key={i}>{(z.label || "(no name)") + " · " + fmt(z.cy) + " / " + fmt(z.py)}</li>)}{un.length > 12 && <li>{"and " + (un.length - 12) + " more"}</li>}</ul>
            {source === "upload" ? <button className="linkbtn" data-aoc4-map-open="" onClick={() => setMapOpen(true)}>Map them</button>
              : <button className="linkbtn" onClick={() => { S.fsTab = "map"; goClient("books:fs"); }}>Give these ledgers their codes in Statements</button>}</div>}
          {busy === "upload" && <p className="corp-note" role="status">Reading the file…</p>}
          {err && <p className="corp-note" role="alert" style={{ color: "var(--corp-bad)" }} data-aoc4-error="">{err}</p>}
        </section>
        <section className="corp-card" style={{ overflow: "hidden" }}>
          <div role="tablist" aria-label="Statement" className="sbar" style={{ margin: "0 18px" }}>
            {[["bs", "Balance sheet"], ["pl", "Profit & loss"], ["co", "Company & auditor details"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} data-aoc4-tab={k} onClick={() => setTab(k)}>{l}</button>)}</div>
          {!f ? <div className="corp-empty" data-aoc4-wait="">{source === "upload" ? "Upload the balance sheet and P&L (Excel or CSV) to begin." : why}</div>
            : tab === "bs" ? <Grid heads={BS_HEADS} f={f} edit={edits} setEdit={setEdit} which="bs" final={final || !may} onBad={(v) => setErr("“" + v + "” is not an amount.")} />
            : tab === "pl" ? <Grid heads={PL_HEADS} f={f} edit={edits} setEdit={setEdit} which="pl" final={final || !may} onBad={(v) => setErr("“" + v + "” is not an amount.")} />
            : <div className="corp-card-body" style={{ paddingTop: 14 }}><div className="corp-grid">
              {[["cin", "CIN", P.cin], ["auditor", "Auditor", P.auditor], ["frn", "Auditor's FRN", P.auditorFrn]].map(([k, l, v]) => <label key={k} className="corp-f"><span>{l}</span><input type="text" value={v || ""} readOnly aria-label={l} /></label>)}
              {[["udin", "Auditor's UDIN"], ["signedOn", "Date the statements were signed"], ["agm", "Date of the AGM"]].map(([k, l]) => <label key={k} className="corp-f"><span>{l}</span>
                <input type={k === "udin" ? "text" : "date"} data-aoc4-detail={k} defaultValue={k === "agm" ? (data.agm || (P.agms || {})[fy] || "") : data[k] || ""} disabled={final} onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(data[k] || "")) change({ [k]: v }); }} /></label>)}</div>
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
              // all done: the third step; one back to To do: in progress again (Ready only by Ready for MCA)
              if (all) keep({ attach: na }, data.figuresOk ? { steps: Math.max(fl.steps || 0, 3) } : null); else change({ attach: na }, { steps: Math.min(fl.steps || 0, 2) }); }} style={{ maxWidth: 130 }}>
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
