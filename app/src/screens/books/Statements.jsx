// Reports -> Financial statements and reports (Step 3 of the FinCom Assistant). Opened from the client's Reports tab
// (Reports.jsx, S.rxView). Four views, all worked out by FSX (src/js/78-reports.js), the same code the Assistant's tools
// call (server/assistant/tools/reports.ts), so both give the same figures:
//   fs   Schedule III statements in the firm's format: the statements (print / PDF, Excel with live formulas, Word),
//        the mapping (suggested by rule, confirmed once, versioned, new ledgers flagged), the details for you (what
//        Tally does not hold, per year), the 27 checks, and the provisional TB for the firm's utility
//   mis  the cash-basis MIS: receipts and payments by head and month, reconciled to the accrual profit
//   3cd  the Form 3CD draft: the clauses the books answer (the audit's own checks), the rest as questions for you
//   dcf  the DCF valuation: history from the books, the assumptions from you (never assumed), Excel and a Word draft
// No AI in any figure. Nothing here writes to the books: the mapping and the details are kept with the client (b.fs.rx).
// State: S.rxView, S.rxFy, S.rxTab.
import { useState } from "react";
// FSX (src/js/78-reports.js) comes with this screen, not in legacy.js (build.py react_parts): it sets globalThis.FSX
import "../../../../src/js/78-reports.js";

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
const getIn = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const setIn = (o, p, v) => { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach((k) => { if (a[k] == null || typeof a[k] !== "object") a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; };

function Field({ det, path, label, type, wide, opts }) {
  const v = getIn(det, path);
  const on = (val) => { setIn(det, path, val); keep(); };
  if (type === "bool") return <label className="rx-f"><input type="checkbox" data-rx-field={path} checked={!!v} onChange={(e) => on(e.target.checked)} /> {label}</label>;
  if (type === "select") return <label className="rx-f"><span>{label}</span><select data-rx-field={path} value={v == null ? "" : v} onChange={(e) => on(e.target.value)}><option value="">—</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>;
  if (type === "text") return <label className="rx-f wide"><span>{label}</span><textarea data-rx-field={path} rows={3} defaultValue={v == null ? "" : v} onBlur={(e) => on(e.target.value)} /></label>;
  return <label className={"rx-f" + (wide ? " wide" : "")}><span>{label}</span><input type="text" inputMode={type === "num" ? "decimal" : undefined} data-rx-field={path} defaultValue={v == null ? "" : v}
    onBlur={(e) => { const t = e.target.value.trim(); on(type === "num" ? (t === "" ? null : Number(t.replace(/,/g, ""))) : t); }} /></label>;
}
// a list of rows: cols [key, label, type]
function List({ det, path, cols, title }) {
  const rows = getIn(det, path) || [];
  const set = (i, k, val) => { const r = rows.slice(); r[i] = Object.assign({}, r[i], { [k]: val }); setIn(det, path, r); keep(); };
  return <div className="rx-list" data-rx-list={path}><div className="note"><b>{title}</b></div>
    <table className="tbl small"><thead><tr>{cols.map(([k, l]) => <th key={k}>{l}</th>)}<th></th></tr></thead><tbody>
      {rows.map((r, i) => <tr key={i}>{cols.map(([k, l, t]) => <td key={k}>{t === "bool" ? <input type="checkbox" aria-label={l} checked={!!r[k]} onChange={(e) => set(i, k, e.target.checked)} />
        : <input type="text" aria-label={l + " " + (i + 1)} defaultValue={r[k] == null ? "" : Array.isArray(r[k]) ? r[k].join(", ") : r[k]} style={{ width: t === "num" ? 110 : 170 }}
          onBlur={(e) => { const s = e.target.value.trim(); set(i, k, t === "num" ? (s === "" ? null : Number(s.replace(/,/g, ""))) : t === "list" ? s.split(",").map((z) => z.trim()).filter(Boolean) : s); }} />}</td>)}
        <td><button className="btn small" onClick={() => { const r2x = rows.slice(); r2x.splice(i, 1); setIn(det, path, r2x); keep(); }}>remove</button></td></tr>)}
    </tbody></table>
    <button className="btn small" data-rx-add={path} onClick={() => { setIn(det, path, rows.concat([{}])); keep(); }}>Add a row</button></div>;
}

function Details({ b, fy, r }) {
  const st = store(b), det = st.det[fy] = st.det[fy] || {}, M = r && r.model, co = M ? M.co : true, kind = M ? M.kind : "company";
  const AGE = (w, y, rows, heads) => <div className="rx-list"><div className="note"><b>{(w === "tp" ? "Trade payables" : "Trade receivables") + " ageing, " + (y === "cy" ? "this year" : "last year") + " (" + heads.join(" / ") + ")"}</b></div>
    {rows.map(([k, l]) => <label key={k} className="rx-f wide"><span>{l}</span><input type="text" data-rx-field={"age." + w + "." + y + "." + k} defaultValue={(getIn(det, "age." + w + "." + y + "." + k) || []).join(", ")}
      onBlur={(e) => { setIn(det, "age." + w + "." + y + "." + k, e.target.value.split(",").map((z) => Number(z.trim().replace(/[^\d.-]/g, "")) || 0)); keep(); }} /></label>)}</div>;
  const leds = M ? M.L.map((x) => x.l) : [];
  return <div className="rx-details" data-rx-details="">
    <p className="note">What Tally does not hold, kept for this client and {FC.fyLabel(fy)}. Every figure here goes into the statements as an input on the Details sheet of the Excel.</p>
    <details open><summary>The entity</summary>
      <Field det={det} path="entity.name" label="Name" wide /><Field det={det} path="entity.cin" label="CIN" /><Field det={det} path="entity.pan" label="PAN" /><Field det={det} path="entity.udyam" label="Udyam number" />
      <Field det={det} path="entity.address" label="Registered address" wide /><Field det={det} path="entity.incorporated" label="Incorporated on" /><Field det={det} path="entity.business" label="Business (a sentence)" wide /></details>
    <details><summary>Signatures</summary>
      <Field det={det} path="sign.auditor.firm" label="Audit firm" /><Field det={det} path="sign.auditor.frn" label="FRN" /><Field det={det} path="sign.auditor.partner" label="Signing partner" /><Field det={det} path="sign.auditor.mno" label="M.No" />
      <Field det={det} path="sign.auditor.udin" label="UDIN" /><Field det={det} path="sign.auditor.place" label="Place" /><Field det={det} path="sign.auditor.date" label="Date" />
      {co ? <List det={det} path="sign.directors" title="Directors who sign" cols={[["name", "Name"], ["din", "DIN"]]} />
        : kind === "proprietor" ? <><Field det={det} path="sign.proprietor.name" label="Proprietor" /><Field det={det} path="sign.proprietor.pan" label="PAN" /></>
          : <List det={det} path="partners" title="Partners (they sign; their accounts make Notes 3 and 4)" cols={[["name", "Name"], ["pan", "PAN"], ["share", "Share %", "num"], ["capital", "Capital ledger"], ["current", "Current ledger"], ["rem", "Remuneration ledgers", "list"], ["int", "Interest ledgers", "list"]]} />}
    </details>
    {co && <details><summary>Share capital and promoters</summary>
      <List det={det} path="shares.authorised" title="Authorised" cols={[["n", "Number", "num"], ["fv", "Face value", "num"], ["cls", "Class"]]} />
      <Field det={det} path="shares.issued.cy.n" label="Shares at the end of the year" type="num" /><Field det={det} path="shares.issued.cy.fv" label="Face value" type="num" />
      <Field det={det} path="shares.issued.py.n" label="Shares at the end of last year" type="num" /><Field det={det} path="shares.issued.py.fv" label="Face value last year" type="num" />
      <Field det={det} path="shares.issuedDuring.cy.n" label="Issued in the year" type="num" /><Field det={det} path="shares.issuedDuring.py.n" label="Issued last year" type="num" />
      <List det={det} path="shares.holders5" title="Shareholders holding more than 5%" cols={[["name", "Name"], ["cy", "Shares this year", "num"], ["py", "Shares last year", "num"]]} />
      <List det={det} path="shares.promoters" title="Promoters" cols={[["name", "Name"], ["cy", "Shares this year", "num"], ["py", "Shares last year", "num"]]} />
      <Field det={det} path="shares.rights" label="Rights, preferences and restrictions" type="text" />
      <Field det={det} path="shares.fiveYear.bonus" label="Bonus shares in five years" /><Field det={det} path="shares.fiveYear.nonCash" label="Shares for consideration other than cash" /><Field det={det} path="shares.fiveYear.buyback" label="Shares bought back" />
      <Field det={det} path="eps.weightedCy" label="Weighted average shares (EPS)" type="num" /><Field det={det} path="eps.weightedPy" label="Weighted average shares last year" type="num" />
      <Field det={det} path="eps.dilShares" label="Dilutive potential shares" type="num" /><Field det={det} path="eps.dilEarn" label="Adjustment to earnings for dilution" type="num" />
    </details>}
    <details><summary>Loans: repayment terms and security</summary>
      <List det={det} path="loans" title="Each borrowing (the amount outstanding comes from its ledger)" cols={[["ledger", "Ledger"], ["desc", "Description"], ["rate", "Interest rate %", "num"], ["terms", "Repayment terms"], ["security", "Nature of security"], ["secured", "Secured", "bool"]]} />
      <Field det={det} path="dscr.principalCy" label="Principal repaid in the year (for DSCR)" type="num" />
    </details>
    {co && <details><summary>Related parties</summary>
      <List det={det} path="rp.parties" title="Related parties" cols={[["name", "Name"], ["relation", "Relationship"]]} />
      <List det={det} path="rp.tx" title="Transactions" cols={[["name", "Name"], ["nature", "Nature"], ["cy", "This year", "num"], ["py", "Last year", "num"]]} />
      <List det={det} path="rp.bal" title="Outstanding balances (from the ledger when given)" cols={[["name", "Name"], ["relation", "Relationship"], ["nature", "Nature (asset / liability)"], ["ledger", "Ledger"], ["cy", "This year", "num"], ["py", "Last year", "num"]]} />
      <List det={det} path="rpLoans" title="Loans to promoters, directors, KMPs and related parties" cols={[["ledger", "Ledger"], ["type", "Promoters / Directors / KMPs / Related Parties"], ["basis", "demand / noterms"]]} />
    </details>}
    <details><summary>Auditor's remuneration, contingent liabilities, tax</summary>
      <Field det={det} path="auditorRem.statutory" label="Statutory audit fee" type="num" /><Field det={det} path="auditorRem.tax" label="Tax audit fee" type="num" /><Field det={det} path="auditorRem.other" label="Other services" type="num" />
      <Field det={det} path="auditorRem.py.statutory" label="Statutory audit fee, last year" type="num" /><Field det={det} path="auditorRem.py.tax" label="Tax audit fee, last year" type="num" />
      <List det={det} path="contingent" title="Contingent liabilities not provided for" cols={[["what", "What"], ["cy", "This year", "num"], ["py", "Last year", "num"]]} />
      <Field det={det} path="tax.netted" label="The provision for tax is shown net of advance tax" type="bool" />
    </details>
    <details><summary>Accounting policies</summary>
      <Field det={det} path="policies.switches.dep" label="Depreciation" type="select" opts={[["sch2", "WDV at Schedule II rates"], ["it", "WDV at Income-tax rates"]]} />
      {[["mat", "MAT"], ["deferredTax", "Deferred tax applies"], ["levelIV", "ICAI Level IV entity"], ["exportIncentive", "Export incentives"], ["dividend", "Dividend income"]].map(([k, l]) => <Field key={k} det={det} path={"policies.switches." + k} label={l} type="bool" />)}
      {FSX.policies(kind, (det.policies || {}).switches).map((p) => <label key={p.no} className="rx-f wide"><span>{p.no + " " + p.title}</span><textarea rows={3} data-rx-policy={p.no} defaultValue={((det.policies || {}).text || {})[p.no] || ""} placeholder={p.text.replace(/\{E\}/g, FSX.entWords(kind)[0]).replace(/\{Es\}/g, FSX.entWords(kind)[1])}
        onBlur={(e) => { const t = det.policies = det.policies || {}; t.text = t.text || {}; if (e.target.value.trim()) t.text[p.no] = e.target.value; else delete t.text[p.no]; keep(); }} /></label>)}
      <p className="note">Leave a paragraph empty to use the firm's text for the entity type (shown greyed).</p>
    </details>
    <details><summary>Fixed assets {co ? "(register)" : "(income-tax blocks)"} and closing stock</summary>
      {co ? <><List det={det} path="far.cy" title="Fixed asset register, this year" cols={[["cls", "Class"], ["line", "ppe / intang / cwip"], ["gOpen", "Gross at start", "num"], ["gAdd", "Additions", "num"], ["gDel", "Deductions", "num"], ["dOpen", "Depreciation at start", "num"], ["dYear", "For the year", "num"], ["dDel", "On deductions", "num"]]} />
        <List det={det} path="far.py" title="Fixed asset register, last year" cols={[["cls", "Class"], ["line", "ppe / intang / cwip"], ["gOpen", "Gross at start", "num"], ["gAdd", "Additions", "num"], ["gDel", "Deductions", "num"], ["dOpen", "Depreciation at start", "num"], ["dYear", "For the year", "num"], ["dDel", "On deductions", "num"]]} /></>
        : <><List det={det} path="itBlocks.cy" title="Income-tax blocks, this year" cols={[["block", "Block"], ["rate", "Rate %", "num"], ["open", "Opening WDV", "num"], ["addGt180", "Added, 180 days or more", "num"], ["addLt180", "Added, under 180 days", "num"], ["sale", "Sale value", "num"], ["stcg", "STCL / (STCG)", "num"], ["addlRate", "Additional rate %", "num"]]} />
          <List det={det} path="itBlocks.py" title="Income-tax blocks, last year" cols={[["block", "Block"], ["rate", "Rate %", "num"], ["open", "Opening WDV", "num"], ["addGt180", "Added, 180 days or more", "num"], ["addLt180", "Added, under 180 days", "num"], ["sale", "Sale value", "num"]]} /></>}
      {FSX.SUBS.inv.map((k) => <Field key={k} det={det} path={"stock.cy." + k} label={"Closing stock: " + k} type="num" />)}
      {FSX.SUBS.inv.map((k) => <Field key={"py" + k} det={det} path={"stock.py." + k} label={"Last year's closing stock: " + k} type="num" />)}
      {M && !M.rolled && <p className="note">These books are not rolled over to this year in FinCom's copy: last year's closing stock is needed for this year's opening.</p>}
    </details>
    {co && <details><summary>Ageing tables</summary>
      {["cy", "py"].map((y) => <div key={y}>{AGE("tp", y, [["msme", "MSME"], ["others", "Others"], ["dmsme", "Disputed - MSME"], ["dothers", "Disputed - Others"]], ["Unbilled", "Not due", "<1 yr", "1-2", "2-3", ">3"])}
        {AGE("tr", y, [["ug", "Undisputed, good"], ["ud", "Undisputed, doubtful"], ["dg", "Disputed, good"], ["dd", "Disputed, doubtful"]], ["Not due", "<6 m", "6 m-1 yr", "1-2", "2-3", ">3"])}</div>)}</details>}
    <details open={!!(M && M.ratioList.some((x) => x.needs && !x.reason))}><summary>Reasons for ratios that moved more than 25%</summary>
      {(M ? M.ratioList : []).filter((x) => x.needs).map((x) => <Field key={x.key} det={det} path={"ratioExplain." + x.key} label={x.name + " (" + FSX.pct2(x.variance) + ")"} wide />)}
      {M && !M.ratioList.some((x) => x.needs) && <p className="note">No ratio moved more than 25%.</p>}</details>
    {co && <details><summary>Additional regulatory information</summary>
      {FSX.ARI.map(([k, no]) => <div key={k} className="rx-ari"><Field det={det} path={"ari." + k + ".yes"} label={"Yes: " + no.replace(/^The Company (has not|has no|is not)/, "")} type="bool" />
        {getIn(det, "ari." + k + ".yes") && <Field det={det} path={"ari." + k + ".text"} label="Details" wide />}</div>)}</details>}
    <datalist id="rx-leds">{leds.map((l) => <option key={l} value={l} />)}</datalist>
  </div>;
}

function Mapping({ b, fy, r, inp }) {
  const st = store(b), kind = r.model.kind, mp = r.mapping, [q, setQ] = useState(""), [only, setOnly] = useState("");
  const lines = FSX.LINES.filter((z) => kind === "company" ? !["capital", "current"].includes(z.id) : z.id !== "share");
  const rows = inp.tb.filter((t) => !q || t.l.toLowerCase().includes(q.toLowerCase())).filter((t) => only === "new" ? mp.fresh.includes(t.l) : only === "none" ? !(mp.map[t.l] || {}).line : true);
  const tag = (m) => m.pending ? ["owner, to confirm", "warn"] : m.by === "owner" ? ["by you", "ok"] : m.by === "ai" ? ["AI suggestion, to confirm", "warn"] : m.by === "ai-confirmed" ? ["AI, confirmed", "ok"] : m.by === "none" ? ["not placed", "bad"] : ["by rule", ""];
  return <div data-rx-mapping="">
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span className="note" data-rx-map-version="">{mp.confirmed ? "Mapping version " + mp.version + " confirmed" + (mp.fresh.length ? "; " + mp.fresh.length + " new ledgers since" : "") : "Suggested from the Tally groups, by rule: confirm it once and it is used every year"}</span>
      <input type="search" placeholder="Find a ledger" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a ledger" />
      <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Show"><option value="">All ledgers</option><option value="new">New ledgers</option><option value="none">Not placed</option></select>
      <button className="btn primary small" data-rx-confirm="" onClick={() => { FSX.confirm(st.map, mp.map, typeof whoAmI === "function" ? whoAmI() : "", today()); keep(); }}>{mp.confirmed ? "Confirm changes (new version)" : "Confirm the mapping"}</button>
    </div>
    <table className="tbl small"><thead><tr><th>Ledger</th><th>Tally group</th><th>Line</th><th>Sub-head</th><th>Placed</th></tr></thead><tbody>
      {rows.map((t) => { const m = mp.map[t.l] || {}, [tg, cls] = tag(m), subs = Array.from(new Set((FSX.SUBS[m.line] || []).concat(m.sub ? [m.sub] : [])));
        return <tr key={t.l} data-rx-led={t.l} className={mp.fresh.includes(t.l) ? "rx-new" : ""}><td>{t.l}{mp.fresh.includes(t.l) && <span className="tag warn" style={{ marginLeft: 6 }}>new</span>}</td><td>{(t.g || []).join(" › ")}</td>
          <td><select aria-label={"Line for " + t.l} value={m.line || ""} onChange={(e) => { FSX.editMap(st.map, t.l, e.target.value, null, kind, t); keep(); }}><option value="">—</option>{lines.map((z) => <option key={z.id} value={z.id}>{z.face}</option>)}</select></td>
          <td><select aria-label={"Sub-head for " + t.l} value={m.sub || ""} onChange={(e) => { FSX.editMap(st.map, t.l, m.line, e.target.value, kind, t); keep(); }}>{subs.map((s) => <option key={s} value={s}>{s.replace("|", ": ")}</option>)}</select></td>
          <td><span className={"tag " + cls} title={m.why || ""}>{tg}</span></td></tr>; })}
    </tbody></table>
  </div>;
}

function Checks({ r }) {
  return <ul className="rx-checks" data-rx-checks="">{r.checks.map((c) => <li key={c.id} data-rx-check={c.id} className={c.ok ? "ok" : c.level === "warn" ? "warn" : "bad"}>
    <b>{c.id + ". " + (c.ok ? "✓ " : c.level === "warn" ? "! " : "✗ ")}</b>{c.title}{!c.ok && <ul>{c.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}</li>)}</ul>;
}

function FsView({ b }) {
  const fy = fyNow(), st = store(b), tab = S.rxTab || "statements";
  const [cols, setCols] = useState(FSX.TB_DEFAULT);
  if (!fy) return <p className="note">No year of books to make statements from yet.</p>;
  const kind = st.kind || FSX.kindOf(b);
  const inp = FSX.inputFromBooks(fy, { kind });
  const head = <div className="row rx-bar" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
    <select aria-label="Year" value={fy} onChange={(e) => setAndShow("rxFy", e.target.value)}>{years().map((y) => <option key={y} value={y}>{FC.fyLabel(y)}</option>)}</select>
    <select aria-label="Layout" data-rx-kind="" value={kind} onChange={(e) => { st.kind = e.target.value; keep(); }}>{Object.entries(FSX.KINDS).map(([k, l]) => <option key={k} value={k}>{l + (k === "company" ? " (Schedule III, Division I)" : " (ICAI non-corporate format)")}</option>)}</select>
    <label><input type="checkbox" data-rx-cashflow="" checked={!!(st.opts || {}).cashflow} onChange={(e) => { st.opts = Object.assign({}, st.opts, { cashflow: e.target.checked }); keep(); }} /> Cash flow statement (AS-3)</label>
  </div>;
  if (inp.error) return <>{head}<p className="bad">{"The statements need the ledger balances: " + inp.error + "."}</p></>;
  const r = FSX.run(inp), M = r.model, nf = r.fails.length;
  const tabs = [["statements", "Statements"], ["mapping", "Mapping" + (r.mapping.confirmed ? "" : " (to confirm)") + (r.mapping.fresh.length ? " · " + r.mapping.fresh.length + " new" : "")], ["details", "Details for you"], ["checks", "Checks" + (nf ? " · " + nf + " failed" : " · all pass")]];
  return <>{head}
    <nav className="tabs small" aria-label="Statements">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} data-rx-tab={k} onClick={() => setAndShow("rxTab", k)}>{l}</button>)}</nav>
    {tab === "statements" && <div data-rx-statements="">
      <p className="note" data-rx-summary="">{FSX.summaryText(r.summary)}</p>
      {nf > 0 && <p className="bad" data-rx-fails="">{nf + " check" + (nf === 1 ? "" : "s") + " failed: see Checks. Nothing is corrected by FinCom; the statements show the books as they are."}</p>}
      {!r.mapping.confirmed && <p className="warn">The mapping is suggested by rule and not confirmed yet (Mapping).</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" data-rx-print="" onClick={() => printHtml(FSX.html(M))}>Print / PDF</button>
        <button className="btn" data-rx-excel="" onClick={() => save(fileName("financial-statements-" + fy + ".xlsx"), FSX.excel(M, r.checks).bytes, xlsxType)}>Excel (formulas to the TB)</button>
        <button className="btn" data-rx-word="" onClick={() => save(fileName("financial-statements-" + fy + ".docx"), FSX.word(M), docxType)}>Word</button>
      </div>
      <iframe title="Financial statements" data-rx-preview="" srcDoc={FSX.html(M)} style={{ width: "100%", height: 900, border: "1px solid var(--line, #ccc)", background: "#fff", marginTop: 10 }} />
      <details className="more" style={{ marginTop: 10 }}><summary>Provisional TB for the Balance Sheet Builder utility</summary>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>{FSX.TB_COLS.map(([k, l]) => <label key={k}><input type="checkbox" checked={cols.includes(k)} onChange={(e) => setCols(e.target.checked ? FSX.TB_COLS.map((z) => z[0]).filter((z) => z === k || cols.includes(z)) : cols.filter((z) => z !== k))} /> {l}</label>)}</div>
        <button className="btn small" data-rx-tb="" onClick={() => save(fileName("provisional-TB-" + fy + ".xlsx"), FSX.tbExport(M, cols), xlsxType)}>TB (Excel)</button>
        <button className="btn small" onClick={() => saveFile(fileName("provisional-TB-" + fy + ".csv"), new Blob([FSX.tbExport(M, cols, { csv: true })], { type: "text/csv" }))}>TB (CSV)</button>
        <p className="note">The utility's own TB headings were not read (its input sheets are behind its licence); confirm them once and the columns can be matched.</p>
      </details>
    </div>}
    {tab === "mapping" && <Mapping b={b} fy={fy} r={r} inp={inp} />}
    {tab === "details" && <Details b={b} fy={fy} r={r} />}
    {tab === "checks" && <Checks r={r} />}
  </>;
}

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

export const RX_VIEWS = [["fs", "Financial statements (Schedule III)", "Balance sheet, P&L and notes in the firm's format, the 27 checks, Excel, Word and PDF"], ["mis", "Cash-basis MIS", "Receipts and payments by head and month, reconciled to the profit"],
  ["3cd", "Form 3CD draft", "The tax audit clauses the books answer; the rest as questions"], ["dcf", "DCF valuation", "History from the books, your assumptions, Excel and a draft report"]];

export default function Statements({ b }) {
  const v = S.rxView;
  return <div className="rx" data-rx-view={v}>
    <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
      <button className="btn small" data-rx-back="" onClick={() => setAndShow("rxView", null)}>← All reports</button>
      <nav className="tabs" aria-label="Statements and reports">{RX_VIEWS.map(([k, l]) => <button key={k} className={v === k ? "on" : ""} data-rx-open={k} onClick={() => setAndShow("rxView", k)}>{l}</button>)}</nav>
    </div>
    {v === "fs" && <FsView b={b} />}
    {v === "mis" && <MisView b={b} />}
    {v === "3cd" && <TaxAuditView b={b} />}
    {v === "dcf" && <DcfView b={b} />}
    <style>{".rx-f{display:inline-flex;flex-direction:column;margin:4px 10px 4px 0;font-size:12px}.rx-f.wide{display:flex}.rx-f input,.rx-f select,.rx-f textarea{min-width:180px}.rx-list{margin:8px 0}.rx-checks li.ok{color:var(--ok,#1a7f37)}.rx-checks li.bad{color:var(--bad,#b42318)}.rx-checks li.warn{color:var(--warn,#9a6700)}.rx-checks li li{color:inherit;font-weight:normal}tr.rx-new td{background:rgba(255,200,0,.08)}.rx-details details{margin:6px 0;padding:6px 8px;border:1px solid var(--line,#ddd);border-radius:6px}.rx-details summary{font-weight:600;cursor:pointer}"}</style>
  </div>;
}
