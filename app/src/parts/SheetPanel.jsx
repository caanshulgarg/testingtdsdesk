// A register uploaded on Purchase or Sales (a sheet, a PDF table or JSON): the panel beside the page (DetailDrawer)
// that says which format it is, shows a new format's mapping once to confirm or change, asks what needs an answer,
// and adds the documents to To review. The logic is SheetImport / SheetFmt (src/js/81-sheet-import.js).
import DetailDrawer from "./DetailDrawer.jsx";
import ListTable from "./ListTable.jsx";
import Button from "./Button.jsx";
import { BusyCard } from "./Reading.jsx";
import LedgerBox from "./LedgerBox.jsx";

const HOW = {
  builtin: "A format FinCom knows: read by its own rules, no AI.",
  official: "The GST portal's own JSON: read by FinCom's rules, no AI.",
  known: "A format saved earlier: read by its saved columns, no AI.",
  drift: "A format saved earlier; its columns have moved or one was added: read by their names, no AI.",
  saved: "Saved now: the next sheet of this format is read without AI.",
};
const money2 = (n) => (num(n) < 0 ? "−" : "") + money(Math.abs(num(n)));

function MapStep({ st }) {
  const g = st.read.grid || [], first = g[st.hi + 1] || [], names = st.head.map((h) => SheetFmt.norm(h));
  const fieldOf = (col) => Object.keys(st.map || {}).find((f) => st.map[f] === col) || "";
  const missing = SheetImport.mapProblems();
  return <section data-sheet-step="map">
    <p className="note" data-sheet-ai="">{st.aiErr ? "FinCom's AI could not read this format (" + st.aiErr + "): choose each column's field yourself."
      : "A format FinCom has not seen. FinCom's AI read its header and 10 rows once (names and numbers masked) and proposes these columns. Check them, change any, and save the format: the next sheet like it is read with no AI."}</p>
    <label className="f"><span>Name of the format</span><input type="text" value={st.fmtName || ""} data-sheet-name="" onChange={(ev) => { st.fmtName = ev.target.value; render(); }} /></label>
    <div className="tblwrap"><table className="data sheet-map" data-sheet-map="">
      <thead><tr><th>Column</th><th>First row</th><th>Field in FinCom</th></tr></thead>
      <tbody>{st.head.map((h, i) => { const col = names[i], f = fieldOf(col); if (!col) return null;
        return <tr key={i} data-sheet-col={col}><td><b>{h}</b>{f && st.why && st.why[f] && <div className="nr">{st.why[f]}</div>}</td><td className="nr">{String(first[i] == null ? "" : first[i]).slice(0, 40)}</td>
          <td><select aria-label={"Field for " + h} value={f} data-sheet-field={col} onChange={(ev) => { const v = ev.target.value; if (v) SheetImport.setMap(v, col); else if (f) SheetImport.setMap(f, ""); }}>
            <option value="">— not used —</option>{SheetFmt.fieldsFor(st.side).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td></tr>; })}</tbody>
    </table></div>
    <div className="row" style={{ gap: 14, flexWrap: "wrap", margin: "10px 0" }}>
      <label className="chk"><span>Dates are</span> <select aria-label="Date order" value={(st.transforms || {}).date || "dmy"} onChange={(ev) => SheetImport.setTransform("date", ev.target.value)}>
        <option value="dmy">day-month-year</option><option value="mdy">month-day-year</option><option value="ymd">year-month-day</option></select></label>
      {!SheetImport.recon(st.side) && <label className="chk"><input type="checkbox" checked={(st.transforms || {}).groupByNo !== false} onChange={(ev) => SheetImport.setTransform("groupByNo", ev.target.checked)} /> Rows with the same invoice no. are one invoice</label>}
    </div>
    {missing.length > 0 && <p className="note bad" data-sheet-missing="">Choose the column for: {missing.join(", ")}.</p>}
    <div className="row" style={{ gap: 8 }}>
      <Button className="btn primary" data-sheet-save="" disabled={missing.length > 0} onClick={() => SheetImport.saveFormat("client")}>Save the format and read the sheet</Button>
      <Button className="btn" data-sheet-save-firm="" disabled={missing.length > 0} onClick={() => SheetImport.saveFormat("firm")}>Save for every client</Button>
    </div>
  </section>;
}

function Question({ st, q }) {
  const a = (st.answers || {})[q.id];
  return <li data-sheet-q={q.id} data-sheet-q-kind={q.kind}>
    <div>{q.text}</div>
    <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      {q.options.map(([v, l]) => <button key={v} type="button" className={"btn small" + (a && a.v === v ? " primary" : "")} data-sheet-a={v} aria-pressed={!!(a && a.v === v)} onClick={() => SheetImport.answer(q.id, v)}>{l}</button>)}
      {a && a.v === "map" && <LedgerBox className="lgbox" value={a.ledger || ""} fk={"sheetq:" + q.id} data-sheet-ledger={q.id} placeholder="A ledger from Tally" aria-label={"Ledger for " + q.party}
        onCommit={(v) => { if (!exactLedger(v)) { toast("“" + v + "” is not a Tally ledger."); return false; } SheetImport.answer(q.id, "map", v); return true; }} />}
    </div>
  </li>;
}

function CheckStep({ st }) {
  const docs = st.docs || [], bad = docs.filter((d) => d.check && !d.check.ok), open = SheetImport.open(), add = SheetImport.docsToAdd();
  const tax = (d) => r2(num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.cess));
  return <section data-sheet-step="check">
    <p className="note" data-sheet-how={st.how}>{(st.fmtName ? "Format: " + st.fmtName + ". " : "") + (HOW[st.how] || "")}</p>
    {(docs.skipped || []).length > 0 && <p className="note" data-sheet-skipped="">{docs.skipped.length + " row" + (docs.skipped.length === 1 ? "" : "s") + " left out: " + Array.from(new Set(docs.skipped.map((x) => x.why))).join(", ") + "."}</p>}
    {bad.length > 0 && <div className="bk-alert bad" data-sheet-bad="">{bad.length + " document" + (bad.length === 1 ? " does" : "s do") + " not add up to the paisa; they go to To review marked so:"}
      <ul>{bad.map((d) => <li key={d.no}>{d.no + ": " + d.check.text}</li>)}</ul></div>}
    {(st.questions || []).length > 0 && <section className="sheet-qs"><h3>{open.length ? "To answer (" + open.length + ")" : "Answered"}</h3><ul className="post-attn">{st.questions.map((q) => <Question key={q.id} st={st} q={q} />)}</ul></section>}
    <ListTable name="sheetDocs" className="data" rows={docs} rowKey={(d, i) => d.no + "|" + i} unit={["document", "documents"]} limit={300}
      cols={[
        { k: "date", role: "date", label: "Date", v: (d) => d.date, cell: (d) => (d.date ? fmtDate(d.date) : "—") },
        { k: "no", role: "number", label: "No.", v: (d) => d.no, cell: (d) => <>{d.no}{d.note && <> <span className="tag">{d.note === "credit" ? "credit note" : "debit note"}</span></>}{d.itc && d.itc.available === false && <> <span className="tag warn" title={d.itc.why}>no ITC</span></>}</> },
        { k: "party", role: "party", label: "Party", v: (d) => d.party || d.gstin, cell: (d) => <>{d.party || "—"}<div className="nr">{d.gstin || ""}</div></> },
        { k: "taxable", role: "amount", label: "Taxable", cls: "n", v: (d) => num(d.taxable), cell: (d) => money2(d.taxable) },
        { k: "tax", label: "Tax", cls: "n", v: tax, sum: tax, cell: (d) => money2(tax(d)) },
        { k: "total", role: "amount", label: "Total", cls: "n", v: (d) => num(d.total), cell: (d) => money2(d.total) },
        { k: "chk", role: "status", label: "Check", v: (d) => (d.check && d.check.ok ? "adds up" : "does not add up"), cell: (d) => d.check && d.check.ok ? <span className="tag ok">adds up{d.check.roundOff ? " (round-off " + d.check.roundOff + ")" : ""}</span> : <span className="tag bad" title={d.check && d.check.text}>does not add up</span> },
      ]} />
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button className="btn primary" data-sheet-add="" disabled={open.length > 0 || !add.length} title={open.length ? "Answer the questions first" : undefined} onClick={() => SheetImport.add()}>{"Add " + add.length + " to To review"}</Button>
      <Button className="btn" onClick={() => SheetImport.close()}>Cancel</Button>
    </div>
  </section>;
}

// a party's statement: who the party is (FinCom's guess, by GSTIN, PAN or name; asked when unsure) and the period
function PartyStep({ st }) {
  const p = st.party || {}, rows = (st.stmt && st.stmt.rows) || [];
  return <section data-sheet-step="party">
    <p className="note" data-sheet-how={st.how}>{(st.fmtName ? "Format: " + st.fmtName + ". " : "") + (HOW[st.how] || "")}</p>
    <p className="note">{rows.length + " entries read; opening " + money(Math.abs(st.stmt.open)) + (st.stmt.open < 0 ? " Cr" : " Dr") + ", closing " + money(Math.abs(st.stmt.close)) + (st.stmt.close < 0 ? " Cr" : " Dr") + " (as the party writes it)."}</p>
    {p.sure ? <p data-recon-party-sure="">{"The party: " + st.ledger + " (by " + p.how + ")."}</p>
      : <p className="bk-alert" data-recon-party-ask="">{p.ledger ? "Is this " + p.ledger + "? FinCom matched it by name only: confirm it, or choose the ledger." : "Which ledger in the books is " + (p.name || "this party") + "?"}</p>}
    {st.prev && <p className="note" data-recon-prev="">{"Last reconciled up to " + fmtDate(st.prev.to) + ": its notes come along."}</p>}
    <div className="bk-form">
      <label><span>The party's ledger in the books</span><LedgerBox className="lgbox" value={st.ledger || ""} fk="reconLedger" data-recon-ledger="" placeholder="A ledger from the books" aria-label="The party's ledger"
        onCommit={(v) => { if (!exactLedger(v)) { toast("“" + v + "” is not a ledger in the books."); return false; } SheetImport.setParty("ledger", exactLedger(v)); return true; }} /></label>
      <label><span>From</span><input type="date" aria-label="From" value={st.from || ""} onChange={(ev) => SheetImport.setParty("from", ev.target.value)} /></label>
      <label><span>Up to</span><input type="date" aria-label="Up to" value={st.to || ""} onChange={(ev) => SheetImport.setParty("to", ev.target.value)} /></label>
    </div>
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button className="btn primary" data-recon-go="" disabled={!st.ledger} onClick={() => SheetImport.reconcile()}>Reconcile</Button>
      <Button className="btn" onClick={() => SheetImport.close()}>Cancel</Button>
    </div>
  </section>;
}

export default function SheetPanel() {
  const st = typeof SheetImport === "object" ? SheetImport.st() : null;
  if (!st) return null;
  const side = { sales: "Sales register", purchase: "Purchase register", vendor: "A vendor's statement", customer: "A customer's statement" }[st.side] || "Register";
  return <DetailDrawer kind="sheet" wide title={st.name} description={side}>
    <div className="sheet-panel" data-sheet-panel={st.side}>
      {st.busy && <BusyCard title={st.busy} />}
      {st.step === "error" && <><p className="bk-alert bad" data-sheet-err="">{st.err}</p><Button className="btn" onClick={() => SheetImport.close()}>Close</Button></>}
      {st.step === "map" && <MapStep st={st} />}
      {st.step === "check" && <CheckStep st={st} />}
      {st.step === "party" && <PartyStep st={st} />}
      {st.step === "done" && st.result && <section data-sheet-step="done">
        <p data-sheet-result="">{[st.result.added + " added to To review", st.result.held ? st.result.held + " held as duplicates" : "", st.result.again ? st.result.again + " already here, not added again" : ""].filter(Boolean).join(" · ")}</p>
        <Button className="btn primary" onClick={() => { SheetImport.close(); if (st.side === "sales") goState("review", "sales"); else goStep("review", "bills"); }}>Open To review</Button>
      </section>}
    </div>
  </DetailDrawer>;
}

// Client setup → Register formats: the formats FinCom has learnt for this client (and for the firm): rename, delete with a
// reason (kept), map again; and a register uploaded from here, also as a PDF table
function pickRegister(side) {
  let el = document.getElementById("sheetIn");
  if (!el) { el = document.createElement("input"); el.type = "file"; el.id = "sheetIn"; el.hidden = true; el.multiple = true; el.accept = ".xlsx,.xls,.csv,.json,.pdf"; document.body.appendChild(el); }
  el.onchange = () => { const files = Array.from(el.files || []); el.value = ""; if (files.length) { goStep("review", side === "sales" ? "sales" : "bills"); setTimeout(() => SheetImport.start(files, side, { asTable: true }), 50); } };
  el.click();
}
export function SheetFormats() {
  const co = CO(), all = (co.sheetFormats || []).concat((S.firm && S.firm.sheetFormats) || []);
  const live = all.filter((f) => !f.deleted), gone = all.filter((f) => f.deleted);
  return <section data-sheet-formats="">
    <p className="note">A register uploaded on Purchase or Sales (Excel, CSV, a PDF table or JSON) in a format FinCom has not seen is read by FinCom's AI once; the columns you confirm are kept here, and every later sheet of that format is read by them, with no AI. The GST portal's GSTR-1 and GSTR-2B, and the marketplaces' reports, FinCom reads by its own rules.</p>
    <div className="row" style={{ gap: 8, margin: "8px 0 12px" }}>
      <Button className="btn small" data-sheet-pick="purchase" onClick={() => pickRegister("purchase")}>Read a purchase register</Button>
      <Button className="btn small" data-sheet-pick="sales" onClick={() => pickRegister("sales")}>Read a sales register</Button>
    </div>
    <ListTable name="sheetFormats" className="data" rows={live} rowKey={(f) => f.id} unit={["format", "formats"]} empty="No format learnt yet. Upload a register on Purchase or Sales."
      cols={[
        { k: "name", role: "party", label: "Format", v: (f) => f.name, cell: (f) => <input type="text" defaultValue={f.name} aria-label={"Name of " + f.name} data-sheet-rename={f.id} onBlur={(ev) => { if (ev.target.value.trim() && ev.target.value !== f.name) SheetImport.rename(f.id, ev.target.value.trim()); }} /> },
        { k: "side", label: "For", v: (f) => f.side, cell: (f) => (f.side === "sales" ? "Sales" : "Purchase") + (f.scope === "firm" ? " · every client" : "") },
        { k: "cols", label: "Columns read", v: (f) => Object.keys(f.map || {}).length, cell: (f) => Object.keys(f.map || {}).map((k) => (SHEET_FIELDS.find((x) => x[0] === k) || [k, k])[1]).join(", ") },
        { k: "at", role: "date", label: "Saved", v: (f) => f.at, cell: (f) => fmtDateTime(f.at) + " · " + (f.by || "") },
        { k: "ac", role: "act", cell: (f) => <><button className="linkbtn" data-sheet-remap={f.id} onClick={() => SheetImport.remap(f.id)}>Map again</button>{" · "}<button className="linkbtn danger" data-sheet-delete={f.id} onClick={() => SheetImport.remove(f.id)}>Delete</button></> },
      ]} />
    {gone.length > 0 && <details style={{ marginTop: 10 }} data-sheet-deleted=""><summary className="note">{"Deleted (" + gone.length + ")"}</summary>
      <ul>{gone.map((f) => <li key={f.id} className="note">{f.name + ": " + (f.deleted.why || "") + " · " + (f.deleted.by || "") + ", " + fmtDateTime(f.deleted.at)}</li>)}</ul></details>}
  </section>;
}
