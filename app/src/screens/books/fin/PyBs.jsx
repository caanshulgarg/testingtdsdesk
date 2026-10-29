// Last year's balance sheet, uploaded on the Trial balance & mapping tab (owner, 29-Oct-2026: "a previous period balance
// sheet uploader so that we can map the ledger easily"). The file is read in this browser only (FinPyBs, src/js/88-fin-pybs.js):
// an Excel or CSV by its columns, a PDF by its text (pdf.js, as the bank statements). A scanned PDF is not read: FinCom's AI
// reader does not read balance sheets, and nothing is sent anywhere. What was read shows as a table (line · amount · code ·
// used) to confirm or put right; once kept (b.fs.pyBs[fy].versions, add-only, each upload a new version) it
//   - is the PY column when FinCom's copy has no previous year,
//   - suggests each ledger's code ("from last year's balance sheet: <line>"; never over a hand choice),
//   - is checked against FinCom's opening balances, head by head, on the Checks tab.
import { useState } from "react";
import Button from "../../../parts/Button.jsx";
import { rs, codeGroups } from "./util.js";
import AiMapSlot, { earlierMapping } from "./aimapSlot.jsx";

const UNITS = [[1, "Rupees"], [1000, "Thousands"], [100000, "Lakhs"], [10000000, "Crores"]];
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function readFile(file, kind) {
  const name = file.name || "file", low = name.toLowerCase(), buf = await file.arrayBuffer();
  let sha = ""; try { sha = hex(await crypto.subtle.digest("SHA-256", buf)); } catch (e) { /* an old browser: no checksum */ }
  let r, src;
  if (/\.pdf$/.test(low) || file.type === "application/pdf") {
    if (typeof getPdf !== "function" || typeof pageTextLines !== "function") throw new Error("The PDF reader could not be loaded just now. Try again in a moment.");
    let pdf; try { pdf = await getPdf(file); } catch (e) { throw new Error("This PDF could not be opened (it may be damaged or locked with a password)."); }
    let text = "";
    for (let p = 1; p <= Math.min(pdf.numPages, 40); p++) text += pageTextLines(await (await pdf.getPage(p)).getTextContent()) + "\n";
    r = FinPyBs.fromText(text); src = "pdf";
  } else if (/\.(xlsx|xls|csv)$/.test(low)) {
    if (typeof ensureXlsx === "function") await ensureXlsx();
    if (!window.XLSX) throw new Error("The Excel reader could not be loaded just now. Try again in a moment.");
    const wb = window.XLSX.read(new Uint8Array(buf), { type: "array" });
    r = FinPyBs.fromRows(wb.SheetNames.map((n) => ({ name: n, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) })));
    src = /\.csv$/.test(low) ? "csv" : "xlsx";
  } else throw new Error("Give the balance sheet as Excel (.xlsx, .xls), CSV or PDF.");
  if (!r.lines.some((z) => z.amt != null)) throw new Error(r.why || "FinCom could not find a figure in this file.");
  return FinPyBs.prepare(Object.assign(r, { file: name, size: file.size, sha256: sha, src }), kind);
}

export function Lines({ lines, kind, edit, onLine }) {
  const groups = codeGroups(kind).map(([g, list]) => [g, list.filter(([c]) => FinSt.CODES[c] && FinSt.CODES[c].side === "BS" && !FinSt.CODES[c].sys)]).filter(([, l]) => l.length);
  return <div className="fin-box"><table className="fin-t fin-pyt" data-statement="" data-fin-table="pybs">
    <thead><tr><th>Head / note line</th><th className="no">Note</th><th className="n">Amount</th><th>Code</th><th>Used</th></tr></thead>
    <tbody>{lines.map((z, i) => z.isHead
      ? <tr key={i} className="h2" data-fin-pyline={i}><td colSpan={5}>{z.label}</td></tr>
      : <tr key={i} className={z.isTotal ? "muted" : z.face ? "" : "l1"} data-fin-pyline={i} data-code={z.code || ""} data-use={z.use ? 1 : 0}>
        <td>{z.label}{z.why && !z.use ? <span className="fin-why">{" — not used: " + z.why}</span> : null}</td>
        <td className="no">{z.note || ""}</td>
        <td className="n">{edit && !z.isTotal ? <input type="number" step="0.01" className="fin-pyamt" aria-label={"Amount: " + z.label} value={z.amt == null ? "" : z.amt}
          onChange={(ev) => onLine(i, { amt: ev.target.value === "" ? 0 : +ev.target.value })} /> : rs(z.amt)}</td>
        <td>{edit && !z.isTotal ? <select aria-label={"Code: " + z.label} data-fin-pycode={i} value={z.code || ""} onChange={(ev) => onLine(i, { code: ev.target.value, use: !!ev.target.value })}>
          <option value="">No code</option>
          {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map(([c, l]) => <option key={c} value={c}>{c + " " + l}</option>)}</optgroup>)}</select>
          : z.code ? <span className="note">{z.code + " " + ((FinSt.CODES[z.code] || {}).label || "")}</span> : ""}</td>
        <td>{edit && !z.isTotal ? <input type="checkbox" aria-label={"Use: " + z.label} checked={!!z.use} disabled={!z.code} onChange={(ev) => onLine(i, { use: ev.target.checked })} /> : z.use ? "Yes" : ""}</td>
      </tr>)}</tbody></table></div>;
}

export default function PyBs({ d, fy, kind }) {
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [show, setShow] = useState(false);
  const v = FinPyBs.latest(fy), all = FinPyBs.versions(fy), copyHasPy = d.tb.pySrc === "copy" || d.tb.pySrc === "typed";
  const pick = async (ev) => {
    const file = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!file) return;
    setBusy(true); setErr(""); setDraft(null);
    try { const r = await readFile(file, kind); r.usePy = true; setDraft(r); }
    catch (e) { setErr((e && e.message) || String(e)); }
    finally { setBusy(false); }
  };
  const line = (i, patch) => { const ls = draft.lines.slice(); ls[i] = Object.assign({}, ls[i], patch); setDraft(Object.assign({}, draft, { lines: ls })); };
  const keep = () => {
    const k = FinPyBs.save(fy, Object.assign({}, draft, { confirmed: true }));
    setDraft(null); setShow(false);
    toast("Last year's balance sheet kept (version " + k.v + "). Codes it suggests are marked in the trial balance; the Checks tab compares it with the opening balances.");
    render();
  };
  const used = (ls) => ls.filter((z) => z.use).length;
  const sum = draft ? draft.lines.filter((z) => z.use && FinSt.CODES[z.code]).reduce((a, z) => { const c = FinSt.CODES[z.code]; a[c.sign < 0 ? "l" : "a"] += +z.amt || 0; return a; }, { l: 0, a: 0 }) : null;
  return <div className="fin-pybs" data-fin-pybs="">
    <div className="fin-pybs-head">
      <div><b>Last year’s balance sheet</b>
        <p className="note" data-fin-pybs-state="">{v ? v.file + " · version " + v.v + " · " + used(v.lines) + " lines used · " + (v.usePy === false ? "not the PY column" : copyHasPy ? "PY from FinCom’s copy; this one suggests codes and is checked" : "the PY column") + (all.length > 1 ? " · " + all.length + " versions kept" : "")
          : "Upload the audited balance sheet as at " + FinSt.DMY(String(fy) + "0331") + ": FinCom suggests each ledger’s code from it and checks it against the opening balances. Read here, never sent anywhere."}</p></div>
      <label className={"btn small" + (busy ? " disabled" : "")} data-fin-pybs-up="">{busy ? "Reading…" : "Upload last year’s balance sheet (Excel or PDF)"}
        <input type="file" accept=".xlsx,.xls,.csv,.pdf,application/pdf" data-fin-pybs-file="" disabled={busy} onChange={pick} style={{ display: "none" }} /></label>
      {v && !draft && <button type="button" className="linkbtn" data-fin-pybs-show="" onClick={() => setShow(!show)}>{show ? "Hide the lines" : "Show the lines"}</button>}
      {v && !draft && show && <button type="button" className="linkbtn" data-fin-pybs-edit="" onClick={() => setDraft(Object.assign({}, v, { lines: v.lines.map((z) => Object.assign({}, z)) }))}>Put right</button>}
    </div>
    {err && <p className="bk-alert" data-fin-pybs-err="">{err}</p>}
    {draft && <div className="fin-pybs-confirm" data-fin-pybs-confirm="">
      <p className="note">{"Read from " + draft.file + ": " + draft.lines.filter((z) => z.amt != null).length + " lines with a figure. Check each line’s code and figure, then keep it."}</p>
      <div className="fin-pybs-opts">
        <label>Amounts in <select aria-label="Amounts in" data-fin-pybs-unit="" value={draft.unit} onChange={(ev) => setDraft(Object.assign({}, draft, { unit: +ev.target.value }))}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select></label>
        <label><input type="checkbox" data-fin-pybs-usepy="" checked={draft.usePy !== false} onChange={(ev) => setDraft(Object.assign({}, draft, { usePy: ev.target.checked }))} /> Use as the PY column when FinCom has no previous year</label>
        {sum && <span className="note" data-fin-pybs-sum="">{"Lines used: liabilities " + rs(sum.l) + " · assets " + rs(sum.a) + (Math.abs(sum.l - sum.a) < 0.01 ? " (they tie)" : " (differ by " + rs(sum.l - sum.a) + ")")}</span>}
      </div>
      <Lines lines={draft.lines} kind={kind} edit onLine={line} />
      <div className="fin-pybs-act"><Button className="btn small primary" data-fin-pybs-save="" onClick={keep}>Keep it</Button><Button className="btn small" onClick={() => setDraft(null)}>Cancel</Button></div>
    </div>}
    {v && !draft && show && <Lines lines={v.lines} kind={kind} />}
    {v && !draft && !earlierMapping(fy) && <AiMapSlot d={d} fy={fy} mode="open" />}
  </div>;
}

// the Checks tab's part: last year's balance sheet against FinCom's opening balances, head by head (in rupees)
export function PyCheck({ d }) {
  const c = d.pyCheck; if (!c) return null;
  return <div className="fin-pycheck" data-fin-pycheck="">
    <h4>Last year’s balance sheet vs FinCom’s opening balances</h4>
    <p className="note">{(c.bad ? c.bad + " head" + (c.bad > 1 ? "s differ" : " differs") : "Every head agrees") + " · " + (c.file || "uploaded") + ", version " + c.v + " · in rupees" + (c.unit > 1 ? " (the upload’s rounding allowed)" : "")}</p>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="pycheck"><colgroup><col /><col className="fig" /><col className="fig" /><col className="fig" /></colgroup>
      <thead><tr><th>Head</th><th className="n">Last year’s balance sheet</th><th className="n">FinCom’s opening</th><th className="n">Difference</th></tr></thead>
      <tbody>{c.rows.map((z) => <tr key={z.id} data-fin-pyhead={z.id} data-v={z.diff}><td>{z.label}</td><td className="n">{rs(z.up)}</td><td className="n">{rs(z.fc)}</td>
        <td className={"n " + (z.diff ? "fin-bad" : "fin-ok")}>{z.diff ? rs(z.diff) : "0"}</td></tr>)}</tbody></table></div>
  </div>;
}
