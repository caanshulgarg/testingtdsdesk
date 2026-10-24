// A return's Excel, down and back up (next-tds-excel, 24-Oct-2026): "Download Excel" and "Upload Excel" in the return's ⋯
// (the header's More, ReturnShell: every form, every year; no other change to the page), and once an upload is applied
// "Undo the last Excel upload". The upload is read (tdsExcel.js), set against FinCom and tried on the books in memory
// (TDSX.preview, app/src/lib/tdsXlsx.js, with Validate & file's own checkReturn), and shown sheet by sheet in a drawer:
// what is added, taken out and changed (old → new), each challan's balance before → after, the Excel's Summary beside
// FinCom's; errors block Apply, warnings need a tick. Apply keeps it all as FinCom's corrections of the return.
import { useRef, useState } from "react";
import { SideDrawer } from "./Shell.jsx";
import { checkReturn } from "./Validate.jsx";
import "../../lib/tdsXlsx.js";

const money = (v) => (v == null || v === "" ? "—" : "₹" + INR.format(r2(num(v))));
const mod = () => import("./tdsExcel.js");
const H3 = { margin: "16px 0 6px" };
const W = { date: "Date of deduction", credit: "Date paid or credited", party: "Deductee", pan: "PAN", section: "Section", code: "Collection code", rate: "Rate", paid: "Amount paid", tds: "TDS", basis: "Remark", cert: "Certificate no.", challan: "Challan",
  nameFile: "Name in the file", status: "PAN status", type: "Type", t: "Transporter declaration", decl: "15G / 15H", country: "Country", nature: "Nature", ack15ca: "15CA", tin: "Tax ID", email: "E-mail", phone: "Phone", address: "Address", dtaa: "DTAA", trc: "TRC and 10F",
  bsr: "BSR code", serial: "Serial", minor: "Minor head", interest: "Interest", fee: "Fee 234E", others: "Others", mode: "Mode" };
const show = (k, v) => (["paid", "tds", "tax", "interest", "fee", "others"].includes(k) && v !== "" && v != null ? money(v) : k === "rate" && v !== "" && v != null ? r2(v) + "%" : v === "" || v == null ? "—" : String(v));

async function upload(file, form, fy, q) {
  if (!file) return;
  S.tdsX = { busy: true, name: file.name }; render();
  try {
    const m = await mod(), x = await m.read(file);
    x.name = file.name;
    S.tdsX = { pv: TDSX.preview(form, fy, q, x, checkReturn), name: file.name, form, fy, q };
  } catch (e) { S.tdsX = { name: file.name, error: "Could not read this Excel: " + ((e && e.message) || e) }; }
  render();
}
export async function downloadExcel(form, fy, q) {
  try { const m = await mod(); await m.download(form, fy, q); toast("Downloaded: change it in Excel, then Upload Excel here."); }
  catch (e) { toast("Could not make the Excel: " + ((e && e.message) || e)); }
}
// the ⋯ items of a return
export function excelItems(form, fy, q) {
  const last = typeof TDSX === "object" ? TDSX.last(form, fy, q) : null;
  return [["Download Excel", () => downloadExcel(form, fy, q), { "data-tdsx": "down" }],
    ["Upload Excel", () => { const el = document.querySelector("[data-tdsx-upload]"); if (el) el.click(); }, { "data-tdsx": "up" }],
    last && ["Undo the last Excel upload (version " + last.ver + ")", () => { const r = TDSX.undo(form, fy, q); toast(r.ok ? "Undone: the return is as it was before the upload." : r.why); render(); }, { "data-tdsx": "undo" }]].filter(Boolean);
}

function Rows({ list, cols }) {
  return <div className="bk-tablewrap"><table className="bk-table tg-fit" data-statement=""><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{list}</tbody></table></div>;
}
function Fields({ fields }) { return <>{fields.map((f, i) => <div key={i} className="nr" data-tdsx-field={f.k}>{W[f.k] || f.label || f.k}: {show(f.k, f.from)} → <b>{show(f.k, f.to)}</b></div>)}</>; }

export function ExcelPreview({ form, fy, q }) {
  const [tick, setTick] = useState(false);
  const X = S.tdsX;
  const close = () => { S.tdsX = null; setTick(false); render(); };
  if (!X || (X.form && (X.form !== form || X.fy !== fy || X.q !== q) && !X.busy && !X.error)) return <SideDrawer open={false} onClose={close} kind="tdsx" />;
  const pv = X.pv, tcs = form === "27EQ";
  const apply = () => { const r = TDSX.apply(pv, tick); if (!r.ok) { toast(r.why); return; } S.tdsX = null; setTick(false); toast(r.n + " change" + (r.n === 1 ? "" : "s") + " applied from the Excel (version " + r.ver + "). The books from Tally are not changed; ⋯ › Undo takes it back."); render(); };
  const n = pv ? pv.n || 0 : 0, d = pv && pv.deductions, c = pv && pv.challans, e = pv && pv.deductees;
  const excel = (pv && pv.excel) || {}, sumRow = (k, label) => <tr key={k} data-tdsx-sum={k}><td>{label}</td><td className="n">{excel[k] == null ? <span className="nr">not worked out</span> : money(excel[k])}</td><td className="n">{money(pv.before && pv.before[k])}</td><td className="n"><b>{money(pv.after && pv.after[k])}</b>{excel[k] != null && pv.after && Math.abs(num(excel[k]) - num(pv.after[k])) >= 0.5 ? <div className="bad nr" data-tdsx-diff={k}>differs from the Excel</div> : null}</td></tr>;
  const title = X.busy ? "Reading the Excel…" : X.error ? "The Excel brought back" : pv.fatal ? "This Excel cannot be used here" : "The Excel brought back: " + n + " change" + (n === 1 ? "" : "s");
  return <SideDrawer open onClose={close} kind="tdsx" wide title={title} description={X.name}>
    <div className="tg-import" data-tdsx-preview="" data-tdsx-n={n}>
      {X.busy ? <p className="note">Reading…</p> : X.error ? <p className="note bad" data-tdsx-error="">{X.error}</p> : pv.fatal ? <p className="note bad" data-tdsx-fatal="">{pv.fatal}</p> : <>
        <p className="note">The file is the source for {TDS.formShort(form, fy)} {q} {fy}: what it adds, takes out and changes is below, sheet by sheet. Nothing is changed until you apply. The books from Tally are not changed: these are kept as FinCom’s corrections of the return, and one Undo takes them all back.</p>
        {pv.errors.length > 0 && <section className="dash-card" data-tdsx-errors={pv.errors.length} style={{ marginBottom: 10 }}><h3 className="bad">{pv.errors.length} error{pv.errors.length === 1 ? "" : "s"}: fix them in the Excel and upload it again</h3>
          <ul className="note">{pv.errors.slice(0, 40).map((x, i) => <li key={i} data-tdsx-err={x.sheet}>{x.sheet}{x.row ? ", row " + x.row : ""}: {x.words}</li>)}</ul></section>}
        {pv.warnings.length > 0 && <section className="dash-card" data-tdsx-warnings={pv.warnings.length} style={{ marginBottom: 10 }}><h3>{pv.warnings.length} warning{pv.warnings.length === 1 ? "" : "s"}</h3>
          <ul className="note">{pv.warnings.slice(0, 40).map((x, i) => <li key={i}>{x.sheet}{x.row ? ", row " + x.row : ""}: {x.words}</li>)}</ul>
          <label className="chk"><input type="checkbox" checked={tick} data-tdsx-tick="" onChange={(ev) => setTick(ev.target.checked)} /> I have looked at the warnings</label></section>}
        {pv.deductor.length > 0 && <><h3 style={H3}>Deductor · {pv.deductor.length} changed</h3><Rows cols={["Field", "Now", "In the Excel"]} list={pv.deductor.map((x) => <tr key={x.k} data-tdsx-deductor={x.k}><td>{x.label}</td><td>{x.from || "—"}</td><td><b>{x.to || "—"}</b></td></tr>)} /></>}
        {(c.add.length + c.edit.length + c.alloc.length + c.out.length) > 0 && <><h3 style={H3} data-tdsx-ch={c.add.length + "|" + c.edit.length + "|" + c.out.length}>Challans · {c.add.length} added, {c.edit.length + c.alloc.length} changed, {c.out.length} off this return</h3>
          <Rows cols={["Challan", "What"]} list={[].concat(c.add.map((a, i) => <tr key={"a" + i} data-tdsx-chadd=""><td>{a.lab}</td><td>new: tax {money(a.x.tax)}{a.x.interest ? ", interest " + money(a.x.interest) : ""}, {a.x.section}</td></tr>),
            c.edit.map((x, i) => <tr key={"e" + i}><td>{TDSX.labOfId(x.c.id)}</td><td><Fields fields={x.fields} /></td></tr>),
            c.alloc.map((x, i) => <tr key={"p" + i}><td>{TDSX.labOfId(x.c.id)}</td><td className="nr">allocated here: interest {money(x.from.ia)} → <b>{money(x.to.ia)}</b>, fee {money(x.from.fa)} → <b>{money(x.to.fa)}</b>, others {money(x.from.oa)} → <b>{money(x.to.oa)}</b></td></tr>),
            c.out.map((x, i) => <tr key={"o" + i}><td>{TDSX.labOfId(x.c.id)}</td><td className="nr">off this return (kept in the register)</td></tr>))} /></>}
        {pv.balances && pv.balances.length > 0 && <><h3 style={H3}>Challans' balance</h3><Rows cols={["Challan", "Now", "After", "This return uses"]} list={pv.balances.map((x) => <tr key={x.lab} data-tdsx-bal={x.lab}><td>{x.lab}</td><td className="n">{x.before == null ? "new" : money(x.before)}</td><td className={"n" + (x.after < -0.005 ? " bad" : "")}><b>{money(x.after)}</b></td><td className="n">{money(x.used)}</td></tr>)} /></>}
        {(e.add.length + e.edit.length) > 0 && <><h3 style={H3}>{tcs ? "Buyers" : form === "24Q" ? "Employees" : "Deductees"} · {e.add.length} added, {e.edit.length} changed</h3>
          <Rows cols={["Name", "What"]} list={[].concat(e.add.map((x, i) => <tr key={"a" + i} data-tdsx-deeadd=""><td>{x.party}</td><td>new <Fields fields={x.fields} /></td></tr>), e.edit.map((x, i) => <tr key={"e" + i} data-tdsx-dee={x.party}><td>{x.party}</td><td><Fields fields={x.fields} /></td></tr>))} /></>}
        {(d.add.length + d.edit.length + d.out.length + d.back.length) > 0 && <><h3 style={H3} data-tdsx-ded={d.add.length + "|" + d.edit.length + "|" + d.out.length}>{tcs ? "Collections" : "Deductions"} · {d.add.length} added, {d.edit.length} changed, {d.out.length} taken out{d.back.length ? ", " + d.back.length + " put back" : ""}</h3>
          <Rows cols={["Row", tcs ? "Buyer" : "Deductee", "What"]} list={[].concat(d.add.map((x, i) => <tr key={"a" + i} data-tdsx-dedadd=""><td className="n">{x.row}</td><td>{x.want.party}</td><td>new: {x.want.section || x.want.code} · paid {money(x.want.paid)} · {tcs ? "TCS" : "TDS"} <b>{money(x.want.tds)}</b>{x.want.ch && x.want.ch.lab ? " · challan " + x.want.ch.lab : ""}</td></tr>),
            d.edit.map((x, i) => <tr key={"e" + i} data-tdsx-dededit={x.r.id}><td className="n">{x.row}</td><td>{x.r.party || x.r.employee}</td><td><Fields fields={x.fields} /></td></tr>),
            d.out.map((x, i) => <tr key={"o" + i} data-tdsx-dedout={x.r.id}><td className="n">—</td><td>{x.r.party || x.r.employee}</td><td className="nr">taken out of the return ({money(x.r.tds)}): kept in the books{x.r.added ? " (added in FinCom: marked deleted)" : ""}</td></tr>),
            d.back.map((x, i) => <tr key={"b" + i}><td className="n">{x.row}</td><td>{x.want.party}</td><td className="nr">put back in the return</td></tr>))} /></>}
        {pv.salary.edit.length > 0 && <><h3 style={H3}>Salary annexure II · {pv.salary.edit.length} employee{pv.salary.edit.length === 1 ? "" : "s"}</h3><Rows cols={["Employee", "What"]} list={pv.salary.edit.map((x, i) => <tr key={i}><td>{x.e.name}</td><td><Fields fields={x.fields} /></td></tr>)} /></>}
        {!n && !pv.errors.length && <p className="note" data-tdsx-none="">The Excel and FinCom already agree: nothing to change.</p>}
        {pv.after && <><h3 style={H3}>Summary: the Excel’s and FinCom’s</h3><Rows cols={["", "In the Excel", "FinCom now", "FinCom after Apply"]} list={[sumRow("n", tcs ? "Collections" : "Deductions"), sumRow("tds", (tcs ? "TCS" : "TDS") + " total"), sumRow("onch", "On challans"), sumRow("gap", "On no challan"), sumRow("fee", "Late fee 234E")]} />
          {pv.valAfter && <p className="note" data-tdsx-val="">Validate & file after Apply: {pv.valAfter.errors} error{pv.valAfter.errors === 1 ? "" : "s"}, {pv.valAfter.warnings} warning{pv.valAfter.warnings === 1 ? "" : "s"}{pv.valBefore ? " (now " + pv.valBefore.errors + " and " + pv.valBefore.warnings + ")" : ""}.</p>}</>}
        {pv.notes.length > 0 && <ul className="note">{pv.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </>}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {pv && !pv.fatal && n > 0 && <button type="button" className="btn small primary" data-tdsx-apply="" disabled={pv.errors.length > 0 || (pv.warnings.length > 0 && !tick)} title={pv.errors.length ? "Fix the errors in the Excel first" : pv.warnings.length && !tick ? "Tick that the warnings were looked at" : undefined} onClick={apply}>Apply {n} change{n === 1 ? "" : "s"}</button>}
        <button type="button" className="btn small" onClick={close}>{pv && !pv.fatal && n ? "Cancel" : "Close"}</button>
      </div>
    </div>
  </SideDrawer>;
}

// the upload's file box and its preview, once per return (ReturnShell)
export function ExcelBox({ form, fy, q }) {
  const f = useRef(null);
  return <>
    <input ref={f} type="file" hidden accept=".xlsx" aria-label="Upload the return's Excel" data-tdsx-upload="" onChange={(ev) => { const x = ev.target.files && ev.target.files[0]; ev.target.value = ""; upload(x, form, fy, q); }} />
    <ExcelPreview form={form} fy={fy} q={q} />
  </>;
}
// the Deductions step's own Import box (t70's "Import corrected Excel…") hands this return's Excel here (TdsReturn.jsx
// importExcel); the old deductions-only file keeps its own preview (TDSEdit.read)
export { upload as uploadExcel };
