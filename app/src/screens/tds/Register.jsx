// The client's challan register (tds-layout, 14-Oct-2026; the owner's rules approved 13/14-Oct-2026 and his simpler
// register of 14-Oct): one register per TAN, every return drawing on it. S.tdsView "register" (#/c/<client>/books/tds/<year>/
// challan-register; the old …/challans opens it). Each challan's row: when deposited, its BSR code and serial, the total
// challan and the balance left (tax + interest + fee), the split by head on hover (or a tap), and one action, "Use…" (a
// return to use its balance in). Opened, a challan says where it is used, its interest and fee by return, its trail, and
// (entered by hand) Change and Delete. Every amount is TDSReg's (src/js/79); nothing is worked out here.
//   AddChallan: a challan entered by hand (here and on a return's Challans tab), or changed.
//   UseBalance: "Use…", the one way a challan's balance goes to a return (TDSReg.useBalance), here and in a return.
//   TracesCheck: TRACES' consumed amount against FinCom's (a return's After filing).
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../../parts/dismiss.js";
import ListTable from "../../parts/ListTable.jsx";
import Filters, { Field as FbField } from "../../parts/Filters.jsx";
import { Info } from "../../parts/Answer.jsx";
import { Lock as LockIcon } from "lucide-react";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
// where a challan came from, in small grey words beside its number ("Entered by hand", "From Tally")
export const SrcBadge = ({ c }) => <span className="ch-src" data-ch-src={TDSReg.srcOf(c)}>{TDSReg.srcWords(c)}</span>;
export const Notes = ({ list }) => (list && list.length ? <>{list.map((n) => <span key={n} className="tag" data-note={n} style={{ fontWeight: 400 }}>{n}</span>)}</> : null);
const Lock = () => <span className="tag" data-lock="" title="The return is marked filed: change only through a correction"><LockIcon width={11} height={11} aria-hidden="true" /> filed</span>;
// the page's own line for a result longer than a toast can hold (S.tdsSaid: {at, words}); kept for two minutes or until closed
export function Said() {
  const x = S.tdsSaid;
  if (!x || Date.now() - x.at > 120000) return null;
  return <p className="note tg-said" data-said="" role="status">{x.words} <button className="linkbtn" onClick={() => { S.tdsSaid = null; render(); }}>Close</button></p>;
}
export const say = (words) => { S.tdsSaid = { at: Date.now(), words }; };

/* ---------------------------------------------------------------- the two figures and their split */
// the total challan, or the balance left (tax + interest + fee); the split by head on hover (title) or a tap, closed by
// Escape, by leaving it, or by a tap outside
export function Split({ c, kind, cx }) {
  const open = S.regSplit === kind + c.id, ref = useRef(null), x = TDSReg.split(c), b = TDSReg.balance(c, cx);
  const parts = kind === "total" ? [["Tax", x.tax], ["Interest", x.interest], ["Fee / penalty", x.fee], ["Others", x.others]]
    : [["Tax", b.tax], ["Interest", b.interest], ["Fee, penalty and others", b.fee]];
  const words = parts.map(([l, v]) => l + " " + money(v)).join(" · "), value = kind === "total" ? x.total : b.total;
  const close = () => { if (S.regSplit === kind + c.id) { S.regSplit = ""; render(); } };
  // Escape (and no further: the app's own would leave the page), a tap outside and (a phone) Back close it (parts/dismiss.js)
  useDismiss(open, ref, close);
  return <span className="reg-split" ref={ref} onBlur={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) close(); }}>
    <button className={"linkbtn reg-fig" + (kind === "left" && value < -0.005 ? " bad" : "")} title={words} aria-label={(kind === "total" ? "Total challan " : "Balance left ") + money(value) + ": " + words}
      aria-expanded={open} data-split={kind} data-split-of={c.id} data-split-words={words} onClick={() => { S.regSplit = open ? "" : kind + c.id; render(); }}>{money(value)}</button>
    {open && <small className="reg-split-pop" data-split-open={kind}>{parts.map(([l, v]) => <span key={l}>{l} <b>{money(v)}</b></span>)}</small>}
  </span>;
}

/* ---------------------------------------------------------------- Use…: a challan's balance in a return */
// one function for the register's "Use…" and a return's "Add from register" (TDSReg.useBalance). Filled in with what the
// return still needs, never more than the challan's tax left; the challan's own return first; interest and fee under More
export function UseBalance({ c, fixed, amount, onDone }) {
  const cx = TDSReg.ctx(), opts = fixed ? [] : TDSReg.openReturns(c, cx);
  const start = fixed ? fixed : opts[0] || null;
  const [k, setK] = useState(start ? TDSReg.key(start.form, start.fy, start.q) : "");
  const fill = (key) => { if (!key) return ""; const [form, fy, q] = key.split("|"); return String(Math.max(0, Math.min(TDSReg.balance(c, cx).tax, TDSReg.openTotal(fy, q, form, cx)))); };
  const [amt, setAmt] = useState(amount != null ? String(amount) : fill(k)), [i, setI] = useState(""), [f, setF] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const years = Array.from(new Set(opts.map((o) => o.fy)));
  const go = async () => {
    setBusy(true); await TDSReg.fresh();
    const [form, fy, q] = k.split("|"), r = TDSReg.useBalance(c.id, form, fy, q, amt, i, f);
    setBusy(false);
    if (!r.ok) { setMsg(r.why); return; }
    setMsg("");
    const words = money(r.tax) + " of challan " + TDSCH.label(c) + " used in " + form + " " + q + " " + fy + " (" + r.n + " deduction" + (r.n === 1 ? "" : "s") + (r.interest || r.fee ? "; interest " + money(r.interest) + ", fee " + money(r.fee) : "") + ")." +
      (r.short > 0.005 ? " " + money(r.short) + " of what you gave did not fit a whole deduction." : "");
    say(words);
    toast(words, { actions: [{ label: form + " " + q + " →", run: () => tdsGoTab(fy, q, form, "challans") }, { label: "Undo", run: () => { TDSReg.undoUse(r); S.tdsSaid = null; render(); } }] });
    render(); onDone && onDone();
  };
  return <div className="revfilter reg-use" data-use-balance={c.id}>
    {!fixed && <select aria-label="Return" value={k} onChange={(ev) => { setK(ev.target.value); setAmt(fill(ev.target.value)); }}>
      {years.map((y) => <optgroup key={y} label={TDS.yearWord(y) + " " + y}>{opts.filter((o) => o.fy === y).map((o) => <option key={o.form + o.q} value={TDSReg.key(o.form, o.fy, o.q)}>
        {o.form} {o.q}{o.own ? " (its own)" : ""}{o.open ? " · " + money(o.open) + " open" : ""}</option>)}</optgroup>)}</select>}
    <input type="text" inputMode="decimal" placeholder="tax" aria-label="Tax to use" value={amt} onChange={(ev) => setAmt(ev.target.value)} />
    <details className="reg-more"><summary>More</summary>
      <input type="text" inputMode="decimal" placeholder="interest" aria-label="Interest to use" value={i} onChange={(ev) => setI(ev.target.value)} />
      <input type="text" inputMode="decimal" placeholder="fee" aria-label="Fee to use" value={f} onChange={(ev) => setF(ev.target.value)} /></details>
    <button className="btn small primary" data-use-go="" disabled={!k || busy} onClick={go}>Use</button>
    {onDone && <button className="linkbtn" onClick={() => onDone()}>Close</button>}
    {msg && <small className="bad" data-use-err="" role="alert">{msg}</small>}
  </div>;
}

/* ---------------------------------------------------------------- a challan entered by hand */
// five fields, the rest under More details (the year is the date's)
const MORE = [["surcharge", "Surcharge"], ["cess", "Cess"], ["interest", "Interest"], ["fee", "Fee (234E)"], ["others", "Others / penalty"]];
const NATURES = ["92A", "92B", "94A", "94C", "94H", "94I", "94J", "94Q", "95", "6CE"];
function Field({ k, label, err, children }) {
  return <label className="ach-f" data-ach-field={k}><span>{label}</span>{children}{err && <small className="bad" data-ach-err={k}>{err}</small>}</label>;
}
function blankOf(c, form) {
  if (!c) return { tan: (CO() || {}).tan || "", bsr: "", date: "", serial: "", section: form === "24Q" ? "92B" : "", tax: "", minorHead: "200", surcharge: "", cess: "", interest: "", fee: "", others: "", mode: "online", note: "" };
  return { tan: c.tan || (CO() || {}).tan || "", bsr: c.bsr || "", date: tallyDate(TDS.ymd(c.date)), serial: String(c.serial || ""), section: TDSReg.natureCode(c), tax: String(c.incomeTax != null ? c.incomeTax : c.tax || ""),
    minorHead: c.minorHead || "200", surcharge: String(c.surcharge || ""), cess: String(c.cess || ""), interest: String(c.interest || ""), fee: String(c.fee || ""), others: String(c.others || ""), mode: c.mode || "online", note: c.note || "" };
}
export function AddChallan({ form, edit, onDone }) {
  const [x, setX] = useState(() => blankOf(edit, form)), [err, setErr] = useState({}), [dupT, setDupT] = useState(null), [busy, setBusy] = useState(false);
  const file = useRef(null);
  const set = (k) => (ev) => { setX({ ...x, [k]: ev.target.value }); if (err[k]) setErr({ ...err, [k]: "" }); };
  const box = (k, props) => <input value={x[k]} onChange={set(k)} {...props} />;
  const total = r2(["tax"].concat(MORE.map((m) => m[0])).reduce((a, k) => a + TDSCH.money2(x[k]), 0));
  const save = async () => {
    setBusy(true);
    const f = file.current && file.current.files && file.current.files[0];
    const r = edit ? await TDSReg.editHand(edit.id, x, f) : await TDSReg.addHand(x, f);
    setBusy(false);
    if (r.ok) {
      if (edit) toast("Challan " + TDSCH.label(r.c) + " changed.");
      else { TDSReg.placedToast(r.placed, "Challan " + TDSCH.label(r.c) + " added (entered by hand)."); if (r.placed && r.placed.placed) say("Challan " + TDSCH.label(r.c) + " added and used in " + r.placed.form + " " + r.placed.q + " " + r.placed.fy + " (draft): " + money(r.placed.tax) + ", " + r.placed.n + " deduction" + (r.placed.n === 1 ? "" : "s") + "."); }
      render(); onDone && onDone(r.c); return;
    }
    setErr(r.errors || { dup: r.why }); setDupT(r.dupTally || null);
  };
  const link = async () => {
    const f = file.current && file.current.files && file.current.files[0];
    const r = await TDSReg.linkToTally(dupT.id, x, f);
    toast(r.ok ? "Your details are kept with Tally's challan " + TDSCH.label(dupT) + "; no second copy was added." : r.why); render(); if (r.ok && onDone) onDone(dupT);
  };
  const d8 = x.date ? TDSCH.date8(x.date) : "";
  return <section className="dash-card ach" data-add-challan={edit ? "edit" : "new"}>
    <h3>{edit ? "Change challan " + TDSCH.label(edit) : "Add a challan by hand"}</h3>
    <div className="ach-grid">
      <Field k="bsr" label="BSR code" err={err.bsr}>{box("bsr", { type: "text", inputMode: "numeric", maxLength: 7, placeholder: "0240020", "aria-label": "BSR code" })}</Field>
      <Field k="date" label="Date of deposit" err={err.date}>{box("date", { type: "date", max: tallyDate(istToday()), "aria-label": "Date of deposit" })}</Field>
      <Field k="serial" label="Challan serial no." err={err.serial}>{box("serial", { type: "text", inputMode: "numeric", maxLength: 5, placeholder: "00979", "aria-label": "Challan serial number" })}</Field>
      <Field k="section" label="Nature of payment" err={err.section}>{box("section", { type: "text", list: "ach-natures", placeholder: "94C", "aria-label": "Nature of payment" })}
        <datalist id="ach-natures">{NATURES.map((n) => <option key={n} value={n} />)}</datalist></Field>
      <Field k="tax" label="Tax" err={err.tax}>{box("tax", { type: "text", inputMode: "decimal", placeholder: "0", "aria-label": "Tax", className: "n" })}</Field>
    </div>
    <details className="ach-more" open={MORE.some(([k]) => err[k]) || !!err.tan || !!err.minorHead || !!err.mode || undefined}><summary>More details: TAN, minor head, interest, fee, mode, note, receipt</summary>
      <div className="ach-grid">
        <Field k="tan" label="TAN" err={err.tan}>{box("tan", { type: "text", maxLength: 10, "aria-label": "TAN", style: { textTransform: "uppercase" } })}</Field>
        <Field k="minorHead" label="Minor head" err={err.minorHead}><select value={x.minorHead} onChange={set("minorHead")} aria-label="Minor head">
          <option value="200">200 · TDS payable by taxpayer</option><option value="400">400 · Regular assessment</option></select></Field>
        {MORE.map(([k, l]) => <Field key={k} k={k} label={l} err={err[k]}>{box(k, { type: "text", inputMode: "decimal", placeholder: "0", "aria-label": l, className: "n" })}</Field>)}
        <Field k="mode" label="Mode" err={err.mode}><select value={x.mode} onChange={set("mode")} aria-label="Mode">{TDSReg.MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field k="note" label="Note">{box("note", { type: "text", maxLength: 500, "aria-label": "Note" })}</Field>
        <label className="ach-f"><span>Challan PDF or receipt</span><input ref={file} type="file" accept=".pdf,image/*,application/pdf" data-ach-file="" aria-label="Challan PDF or receipt" /></label>
      </div></details>
    <p className="note" style={{ margin: "6px 0" }}>Total <b data-ach-total="">{money(total)}</b>{d8 ? " · " + TDS.yearWord(TDS.fyOf(d8)) + " " + TDS.fyOf(d8) : ""}</p>
    {(err.dup || dupT) && <p className="note bad" data-ach-err="dup">{err.dup}</p>}
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {dupT ? <button className="btn small primary" data-ach-link="" onClick={link}>Link to Tally's challan {TDSCH.label(dupT)}</button>
        : <button className="btn small primary" data-ach-save="" disabled={busy} onClick={save}>{edit ? "Save the change" : "Add challan"}</button>}
      <button className="btn small" onClick={() => onDone && onDone(null)}>Cancel</button>
    </div>
  </section>;
}

/* ---------------------------------------------------------------- one challan opened */
function Opened({ x, cx }) {
  const c = x.c, [edit, setEdit] = useState(false);
  const noEdit = TDSReg.canEdit(c), noDel = TDSReg.canDelete(c), trail = TDSReg.trail(c.id).slice(0, 30), p = TDSReg.portionsUsed(c, cx);
  const off = (u) => { const r = TDSReg.removeUse(c.id, u.form, u.fy, u.q); if (!r.ok) { toast(r.why); return; }
    toast("Taken off " + u.form + " " + u.q + " " + u.fy + ".", { actions: [{ label: "Undo", run: () => { TDSReg.undoRemove(r); render(); } }] }); render(); };
  return <div className="reg-open" data-reg-open={c.id}>
    <p className="note">{TDSReg.srcWords(c)}{c.enteredBy ? " by " + c.enteredBy : ""}{c.enteredAt ? " on " + fmtDateTime(c.enteredAt) : ""}{c.mode ? " · " + (c.mode === "bank" ? "paid at the bank" : "paid online") : ""}
      {" · nature " + (TDSReg.natureCode(c) || "not given")}{c.minorHead ? " · minor head " + c.minorHead : ""}{c.note ? " · " + c.note : ""}
      {c.receipt && <> · <button className="linkbtn" data-reg-receipt={c.id} onClick={() => TDSReg.receipt(c.id)}>Receipt: {c.receipt.name}</button></>}</p>
    {x.uses.length ? <table className="bk-table gf-off" style={{ margin: "6px 0" }} data-statement="">
      <thead><tr><th>Used in</th><th className="n">Tax</th><th className="n">Interest · fee in its file</th><th>Notes</th><th className="ac"></th></tr></thead>
      <tbody>{x.uses.map((u) => <tr key={u.form + u.fy + u.q} data-reg-use={u.form + "|" + u.fy + "|" + u.q}>
        <td><button className="linkbtn" onClick={() => tdsGoTab(u.fy, u.q, u.form, "challans")}>{u.form} {u.q} {u.fy}</button> {u.locked ? <Lock /> : <span className="nr" style={{ display: "inline" }}>(draft)</span>}</td>
        <td className="n">{money(u.tax)}<div className="nr">{u.n} deduction{u.n === 1 ? "" : "s"}</div></td><td className="n">{money(u.portion.interest)} · {money(u.portion.fee)}</td><td><Notes list={u.notes} /></td>
        <td className="ac">{!u.locked && <button className="btn small" data-use-off={u.form + "|" + u.fy + "|" + u.q} onClick={() => off(u)}>Take off</button>}</td></tr>)}</tbody>
    </table> : <p className="note">No return uses this challan yet.</p>}
    {(num(c.interest) > 0 || TDSReg.feeOf(c) > 0) && <p className="note" data-portions="">Interest {money(p.interest)} of {money(c.interest)} and fee {money(p.fee)} of {money(TDSReg.feeOf(c))} are in a return's file{TDSReg.explicit(c) ? " (as given)" : " (all in one return; give each return its part with Use… › More)"}.</p>}
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="btn small" disabled={!!noEdit} title={noEdit || undefined} data-reg-edit={c.id} onClick={() => setEdit(!edit)}>Change</button>
      <button className="btn small" disabled={!!noDel} title={noDel || undefined} data-reg-del={c.id} onClick={() => challanDelete(c.id)}>Delete…</button>
      {(noEdit || noDel) && <span className="note" data-reg-noedit="">{noEdit || noDel}</span>}
    </div>
    {edit && <AddChallan edit={c} onDone={() => setEdit(false)} />}
    {trail.length > 0 && <details style={{ marginTop: 6 }} data-reg-trail={c.id}><summary className="note">The trail ({trail.length})</summary>
      <ul className="note" style={{ margin: "4px 0 0 18px" }}>{trail.map((t) => <li key={t.id}>{fmtDateTime(t.at)} · {t.by || "this computer"} · {t.act}{t.form ? " " + t.form + " " + t.q + " " + t.fy : ""}{t.tax ? " · " + money(t.tax) : ""}{t.note ? " · " + t.note : ""}</li>)}</ul></details>}
  </div>;
}

/* ---------------------------------------------------------------- TRACES (a return's After filing) */
export function TracesCheck({ filter, title = "TRACES against FinCom" }) {
  const list = TDSReg.traces(filter);
  if (!list.length) return null;
  const bad = list.filter((x) => x.unknown || Math.abs(x.diff) >= 0.01);
  return <section className="dash-card" style={{ marginTop: 12 }} data-traces-check="">
    <h3>{title}</h3>
    <p className={"note" + (bad.length ? " bad" : "")}>{bad.length ? bad.length + " challan" + (bad.length === 1 ? "" : "s") + " to look at: TRACES’ consumed amount differs from what FinCom uses, or TRACES does not know the challan." : "Every challan TRACES consumed agrees with what FinCom uses."}</p>
    <ListTable name="tracesCh" rows={list} rowKey={(x, i) => x.src + x.key + x.form + x.q + i} unit={["challan", "challans"]} rowProps={(x) => ({ "data-traces-row": x.key, "data-diff": x.unknown ? "unknown" : Math.abs(x.diff) >= 0.01 ? "1" : "0" })}
      cols={[
        { k: "st", role: "status", label: "", v: (x) => (x.unknown ? 2 : Math.abs(x.diff) >= 0.01 ? 1 : 0), cell: (x) => x.unknown ? <span className="tag bad">Not known to TRACES</span> : Math.abs(x.diff) >= 0.01 ? <span className="tag bad">Differs</span> : <span className="tag ok">Same</span> },
        { k: "ch", role: "number", label: "Challan", v: (x) => x.key, cell: (x) => <>{x.label} {x.challan && <SrcBadge c={x.challan} />}</> },
        { k: "fin", label: "FinCom used", cls: "n", v: (x) => x.fincom, sum: false, cell: (x) => money(x.fincom) },
        { k: "tr", label: "TRACES consumed", cls: "n", v: (x) => x.traces, sum: false, cell: (x) => (x.unknown ? "—" : money(x.traces)) },
        { k: "diff", label: "Difference", cls: "n", v: (x) => x.diff, sum: false, td: (x) => ({ className: x.unknown || Math.abs(x.diff) >= 0.01 ? "bad" : undefined }),
          cell: (x) => (x.unknown ? <span data-traces-unknown="">{x.hint || "check its BSR code, date and serial"}</span> : money(x.diff)) },
      ]} />
  </section>;
}

/* ---------------------------------------------------------------- the register */
export default function Register() {
  const all = TDSReg.register(), cx = TDSReg.ctx(), [adding, setAdding] = useState(!!S.regAdding), [showDel, setShowDel] = useState(false), up = useRef(null);
  if (S.regAdding) S.regAdding = false;
  // "Needs a return": tax still to be used by a return (a new challan whose type could not be told among them)
  const f = S.regFl || {}, shown = all.filter((x) => !f.needs || x.bal.tax > 0.005), del = TDSReg.deletedList(), co = CO() || {};
  const upload = async (fs) => { const r = await TDSCH.upload(fs); if (r && r.placed) say(r.placed + " new challan" + (r.placed === 1 ? "" : "s") + " added to " + (r.placed === 1 ? "its draft return" : "their draft returns") + " by themselves; open one to see where."); render(); };
  return <div data-register="">
    <p className="note"><button className="linkbtn" onClick={() => tdsGo(S.tdsFy)}>← {TDS.yearWord(S.tdsFy)} {S.tdsFy}</button></p>
    <div className="rp-title"><h2 className="tg-h2">Challan register{co.tan ? " · TAN " + co.tan : ""}</h2>
      <Info label="The rules">One register for the client’s TAN; every return draws on it. A challan is never used beyond what it paid: tax, interest and fee each have their own limit. A new challan goes to the draft return of its own type and quarter by itself. A challan of another form or an earlier quarter or year may be used: a note says so, and the trail keeps it. A return marked filed is locked: its challans change only once a correction is opened for it.</Info></div>
    <Said />
    {/* the one filter bar (parts/Filters.jsx); its one filter, "Needs a return" */}
    <Filters label="Challan filters" active={!!f.needs} onClear={() => { S.regFl = {}; render(); }}
      type={<FbField label="Show"><select data-reg-filter="needs" value={f.needs ? "needs" : ""} onChange={(ev) => { S.regFl = { ...f, needs: ev.target.value === "needs" }; render(); }}>
        <option value="">Every challan</option><option value="needs">Needs a return</option></select></FbField>}
      tools={<><button className="btn small primary" data-reg-add="" onClick={() => setAdding(!adding)}>Add challan</button>
        <button className="btn small" onClick={() => up.current && up.current.click()}>Upload challans</button>
        <input ref={up} type="file" multiple hidden data-challan-upload="" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf" onChange={(ev) => { const fs = Array.from(ev.target.files || []); ev.target.value = ""; upload(fs); }} /></>} />
    {adding && <AddChallan onDone={() => setAdding(false)} />}
    <ListTable name="tdsRegister" id="tdsRegTable" rows={shown} rowKey={(x) => x.c.id} unit={["challan", "challans"]} of={all.length}
      rowProps={(x) => ({ "data-reg-row": x.c.id })}
      empty={all.length ? "Every challan is used in full." : "No challan yet. Add one by hand, upload the portal's Payment History, or bring in the books from Tally."}
      after={(x) => (S.regAddTo === x.c.id || S.regOpen === x.c.id) && <>{S.regAddTo === x.c.id && <UseBalance c={x.c} onDone={() => { S.regAddTo = ""; render(); }} />}{S.regOpen === x.c.id && <Opened x={x} cx={cx} />}</>}
      cols={[
        { k: "date", role: "date", label: "Deposited", cls: "dt", v: (x) => TDS.ymd(x.c.date), cell: (x) => day(x.c.date) },
        { k: "no", role: "number", label: "BSR code / serial", v: (x) => x.c.bsr + x.c.serial, cell: (x) => <><span className="reg-no"><button className="linkbtn" onClick={() => tdsToggle("regOpen", x.c.id)}>{S.regOpen === x.c.id ? "▾ " : "▸ "}{x.c.bsr} / {x.c.serial}</button>
          {" "}<SrcBadge c={x.c} /></span>{!TDSReg.homeForm(x.c) && <> <span className="tag warn" data-type-unknown="">Type unknown</span></>}</> },
        { k: "total", role: "amount", label: "Total challan", cls: "n", v: (x) => TDSReg.split(x.c).total, fmt: money, cell: (x) => <Split c={x.c} kind="total" cx={cx} /> },
        { k: "left", role: "status", label: "Balance left", cls: "n", v: (x) => x.bal.total, fmt: money, sum: true, td: (x) => ({ "data-reg-left": x.c.id }), cell: (x) => <Split c={x.c} kind="left" cx={cx} /> },
        { k: "ac", role: "act", cls: "ac", cell: (x) => <button className="btn small" data-reg-addto={x.c.id} onClick={() => { S.regAddTo = S.regAddTo === x.c.id ? "" : x.c.id; render(); }}>Use…</button> },
      ]} />
    {del.length > 0 && <p className="note" style={{ marginTop: 10 }}><button className="linkbtn" data-reg-deleted="" onClick={() => setShowDel(!showDel)}>Deleted ({del.length})</button></p>}
    {showDel && <ul className="note" data-reg-deleted-list="" style={{ margin: "0 0 0 18px" }}>{del.map((c) => <li key={c.id}>{TDSCH.label(c)} · {money(c.tax)} · deleted {fmtDateTime(c.deleted.at)}{c.deleted.by ? " by " + c.deleted.by : ""}: {c.deleted.reason}
      {" "}<button className="linkbtn" data-reg-restore={c.id} onClick={() => { const r = TDSReg.restore(c.id); toast(r.ok ? "Challan " + TDSCH.label(c) + " is back." : r.why); render(); }}>Restore</button></li>)}</ul>}
  </div>;
}
