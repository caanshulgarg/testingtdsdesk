// The client's challan register (tds-layout, 14-Oct-2026; the owner's rules approved 13/14-Oct-2026 and his simpler
// register of 14-Oct): one register per TAN, every return drawing on it. S.tdsView "register" (#/c/<client>/books/tds/<year>/
// challan-register; the old …/challans opens it). Round 3 B (the owner, 14-Oct-2026): each row is Deposited · BSR / serial
// (its source, "Tally" / "by hand", in small grey words) · Nature (its section, or a small "Set type" link) · Total ·
// Balance left (the split by head on hover or a tap) · Use…; no filter arrow on the headings (the one filter bar). A row's
// click opens the challan's drawer (ChallanDetail): everything about it, and Use in a return, Set type, Edit (entered by
// hand) and Delete with a reason. Every amount is TDSReg's (src/js/79); nothing is worked out here.
//   AddChallan: a challan entered by hand (here and on a return's Challans tab), or changed.
//   UseBalance: "Use…", the one way a challan's balance goes to a return (TDSReg.useBalance), here and in a return.
//   TracesCheck: TRACES' consumed amount against FinCom's (a return's After filing).
import { useRef, useState } from "react";
import { useDismiss } from "../../parts/dismiss.js";
import ListTable from "../../parts/ListTable.jsx";
import DetailDrawer from "../../parts/DetailDrawer.jsx";
import Filters, { Field as FbField } from "../../parts/Filters.jsx";
import { Info } from "../../parts/Answer.jsx";
import { Lock as LockIcon } from "lucide-react";
import "../../lib/tdsGlobals.js";   // next-challan-match: TDSMatch, PANCheck and the matcher's rules come with the TDS screens

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
// where a challan came from, in small grey words beside its number ("Entered by hand", "From Tally")
export const SrcBadge = ({ c, short }) => <span className="ch-src" data-ch-src={TDSReg.srcOf(c)}>{short ? TDSReg.srcShort(c) : TDSReg.srcWords(c)}</span>;
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
      else { TDSReg.placedToast(r.placed, "Challan " + TDSCH.label(r.c) + " added (entered by hand)."); if (r.placed && r.placed.suggested) say("Challan " + TDSCH.label(r.c) + " added. What it can pay is suggested on " + r.placed.form + " " + r.placed.q + " " + r.placed.fy + " › Challans: confirm it there."); }
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

/* ---------------------------------------------------------------- one challan, in its drawer */
// round 3 B (the owner, 14-Oct-2026): a row's click opens everything about the challan beside the register (DetailDrawer,
// kind "challan"; kept in the address, so Refresh opens it again and Back, Esc, ✕ or a click outside close it): its
// details and source, each head paid, used and left, every return it is used in (each a link), TRACES, notes, who added or
// changed it and when, and its actions: Use in a return, Set type, Edit (entered by hand only), Delete with a reason.
const Row = ({ k, children, ...rest }) => <><dt>{k}</dt><dd {...rest}>{children}</dd></>;
function voucherWords(c) {
  const vid = c.fromVoucher;
  if (!vid) return "";
  const v = ((S.books || {}).vouchers || []).find((x) => x.id === vid);
  return v ? (v.type || "Entry") + " no. " + (v.no || "—") + " of " + fmtDate(tallyDate(v.date)) + (v.party ? ", " + v.party : "") : "a payment entry in Tally";
}
function tracesWords(c) {
  const l = TDSReg.traces().filter((x) => x.challan && x.challan.id === c.id);
  if (!l.length) return ["", "Not checked with TRACES yet: read a return's consolidated file or the challan status file (a return's After filing)."];
  const u = l.find((x) => x.unknown);
  if (u) return ["bad", "Not known to TRACES" + (u.hint ? ": " + u.hint : "") + "."];
  const d = l.find((x) => Math.abs(x.diff) >= 0.01);
  if (d) return ["bad", "Differs: TRACES consumed " + money(d.traces) + ", FinCom uses " + money(d.fincom) + (d.form ? " (" + d.form + " " + d.q + " " + d.fy + ")" : "") + "."];
  return ["ok", "Agrees with TRACES: consumed " + l.map((x) => money(x.traces) + (x.form ? " in " + x.form + " " + x.q + " " + x.fy : "")).join(", ") + "."];
}
function whoWords(c) {
  const t = TDSReg.trail(c.id), add = t.filter((x) => x.act === "challan-add").pop(), ch = t.find((x) => x.act === "challan-edit" || x.act === "challan-link");
  const by = (x) => (x.by ? " by " + x.by : "");
  const added = c.enteredAt ? "Added" + (c.enteredBy ? " by " + c.enteredBy : "") + " on " + fmtDateTime(c.enteredAt)
    : add ? "Added" + by(add) + " on " + fmtDateTime(add.at) : TDSReg.srcOf(c) === "tally" ? "Added from Tally (when the books were read)" : "Added (when is not recorded)";
  return added + (ch ? " · changed" + by(ch) + " on " + fmtDateTime(ch.at) + (ch.note ? " (" + ch.note + ")" : "") : "") + ".";
}
function SetType({ c, onDone }) {
  const [v, setV] = useState(TDSReg.natureCode(c) || ""), [msg, setMsg] = useState("");
  const save = () => {
    const r = TDSReg.setNature(c.id, v);
    if (!r.ok) { setMsg(r.why); return; }
    const p = r.placed;
    toast("Challan " + TDSCH.label(c) + ": type " + TDSReg.natureCode(c) + (p && p.suggested ? "; what it pays is suggested on " + p.form + " " + p.q + " " + p.fy : "") + ".");
    if (p && p.suggested) say("Challan " + TDSCH.label(c) + " is " + TDSReg.natureCode(c) + " now. What it can pay is suggested on " + p.form + " " + p.q + " " + p.fy + " › Challans.");
    S.regSetType = ""; render(); onDone && onDone();
  };
  return <div className="revfilter reg-use" data-set-type-box={c.id}>
    <input type="text" list="ch-natures" aria-label="Nature of payment" placeholder="94C" value={v} autoFocus onChange={(ev) => { setV(ev.target.value); setMsg(""); }}
      onKeyDown={(ev) => { if (ev.key === "Enter") save(); }} />
    <datalist id="ch-natures">{NATURES.map((n) => <option key={n} value={n} />)}</datalist>
    <button className="btn small primary" data-set-type-save="" onClick={save}>Set type</button>
    <button className="linkbtn" onClick={() => { S.regSetType = ""; render(); onDone && onDone(); }}>Cancel</button>
    {msg && <small className="bad" role="alert" data-set-type-err="">{msg}</small>}
  </div>;
}
function ChallanDetail({ x, cx }) {
  const c = x.c, [act, setAct] = useState(S.regSetType === c.id ? "type" : "");
  const hand = TDSReg.srcOf(c) === "hand", noEdit = TDSReg.canEdit(c), noDel = TDSReg.canDelete(c), trail = TDSReg.trail(c.id).slice(0, 30);
  const sp = TDSReg.split(c), pu = TDSReg.portionsUsed(c, cx), bal = TDSReg.balance(c, cx), usedTax = TDSReg.usedTax(c, cx);
  const feeUsed = r2(Math.min(num(c.fee), pu.fee)), othersUsed = r2(pu.fee - feeUsed);
  const heads = [["Tax", sp.tax, usedTax, bal.tax], ["Interest", sp.interest, pu.interest, bal.interest], ["Fee", sp.fee, feeUsed, r2(sp.fee - feeUsed)], ["Others", sp.others, othersUsed, r2(sp.others - othersUsed)]];
  const [tc, tw] = tracesWords(c), ent = voucherWords(c);
  const off = (u) => { const r = TDSReg.removeUse(c.id, u.form, u.fy, u.q); if (!r.ok) { toast(r.why); return; }
    toast("Taken off " + u.form + " " + u.q + " " + u.fy + ".", { actions: [{ label: "Undo", run: () => { TDSReg.undoRemove(r); render(); } }] }); render(); };
  const del = async () => { if (await challanDelete(c.id)) closeDetail(); };
  const toggle = (k) => { if (act === k) { setAct(""); S.regSetType = ""; } else setAct(k); };
  return <div className="ch-detail" data-ch-detail={c.id}>
    <dl className="ch-dl">
      <Row k="BSR code">{c.bsr}</Row><Row k="Serial">{c.serial}</Row><Row k="Deposited">{day(c.date)}</Row>
      <Row k="Minor head">{(c.minorHead || "200") + (String(c.minorHead || "200") === "400" ? " · regular assessment" : " · TDS payable by taxpayer")}</Row>
      <Row k="Nature" data-ch-nature="">{TDSReg.natureCode(c) || "not given"}{TDSReg.homeForm(c) ? " · " + TDSReg.homeForm(c) : ""}</Row>
      <Row k="Source" data-ch-source="">{TDSReg.srcWords(c)}{ent ? " · " + ent : ""}{c.mode ? " · " + (c.mode === "bank" ? "paid at the bank" : "paid online") : ""}</Row>
      {c.receipt && <Row k="Receipt"><button className="linkbtn" data-reg-receipt={c.id} onClick={() => TDSReg.receipt(c.id)}>{c.receipt.name}</button></Row>}
    </dl>
    <table className="bk-table gf-off ch-heads" data-ch-heads="" data-statement="">
      <thead><tr><th></th><th className="n">Paid</th><th className="n">Used</th><th className="n">Left</th></tr></thead>
      <tbody>{heads.map(([l, p, u, left]) => <tr key={l} data-ch-head={l}><td>{l}</td><td className="n">{money(p)}</td><td className="n">{money(u)}</td><td className={"n" + (left < -0.005 ? " bad" : "")}>{money(left)}</td></tr>)}</tbody>
      <tfoot><tr><td><b>Total</b></td><td className="n"><b>{money(sp.total)}</b></td><td className="n"><b>{money(r2(usedTax + pu.interest + pu.fee))}</b></td><td className="n"><b>{money(bal.total)}</b></td></tr></tfoot>
    </table>
    <h4 className="ch-h">Used in</h4>
    {x.uses.length ? <ul className="ch-uses">{x.uses.map((u) => <li key={u.form + u.fy + u.q} data-ch-use={u.form + "|" + u.fy + "|" + u.q}>
      <button className="linkbtn" onClick={() => tdsGoTab(u.fy, u.q, u.form, "challans")}>{u.form} {u.q} {u.fy}</button>
      {" · "}{money(u.tax)}<span className="note">{" (" + u.n + " deduction" + (u.n === 1 ? "" : "s") + (u.portion && (u.portion.interest || u.portion.fee) ? "; interest " + money(u.portion.interest) + ", fee " + money(u.portion.fee) : "") + ")"}</span>
      {" "}{u.locked ? <Lock /> : <span className="tag" data-draft="">draft</span>}{" "}<Notes list={u.notes} />
      {!u.locked && <>{" "}<button className="linkbtn" data-use-off={u.form + "|" + u.fy + "|" + u.q} onClick={() => off(u)}>Take off</button></>}</li>)}</ul>
      : <p className="note">No return uses this challan yet.</p>}
    <h4 className="ch-h">TRACES</h4>
    <p className={"note" + (tc ? " " + tc : "")} data-ch-traces="">{tw}</p>
    {c.note && <><h4 className="ch-h">Notes</h4><p className="note" data-ch-note="">{c.note}</p></>}
    <p className="note" data-ch-who="">{whoWords(c)}</p>
    <div className="row ch-acts" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="btn small primary" data-ch-act="use" aria-expanded={act === "use"} onClick={() => toggle("use")}>Use in a return…</button>
      <button className="btn small" data-ch-act="type" aria-expanded={act === "type"} onClick={() => toggle("type")}>Set type</button>
      {hand && <button className="btn small" data-ch-act="edit" disabled={!!noEdit} title={noEdit || undefined} aria-expanded={act === "edit"} onClick={() => toggle("edit")}>Edit</button>}
      <button className="btn small" data-ch-act="delete" disabled={!!noDel} title={noDel || undefined} data-reg-del={c.id} onClick={del}>Delete…</button>
    </div>
    {(noEdit && hand) || noDel ? <p className="note" data-reg-noedit="">{(hand && noEdit) || noDel}</p> : null}
    {act === "use" && <UseBalance c={c} onDone={() => setAct("")} />}
    {act === "type" && <SetType c={c} onDone={() => setAct("")} />}
    {act === "edit" && <AddChallan edit={c} onDone={() => setAct("")} />}
    {trail.length > 0 && <details style={{ marginTop: 8 }} data-reg-trail={c.id}><summary className="note">The trail ({trail.length})</summary>
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
  const f = S.regFl || {}, shown = all.filter((x) => !f.needs || x.bal.tax > 0.005), del = TDSReg.deletedList(), co = CO() || {}, openId = detailOpen("challan");
  const upload = async (fs) => { const r = await TDSCH.upload(fs); if (r && r.placed) say(r.placed + " new challan" + (r.placed === 1 ? "" : "s") + " added; what " + (r.placed === 1 ? "it pays is" : "they pay is") + " suggested on " + (r.placed === 1 ? "its return's" : "their returns'") + " Challans tab, to confirm."); render(); };
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
    <ListTable name="tdsRegister" id="tdsRegTable" className="bk-table gf-off reg-table" rows={shown} rowKey={(x) => x.c.id} unit={["challan", "challans"]} of={all.length}
      // a row's click opens its drawer; its own controls (BSR link, Set type, the figures, Use…) do their own thing
      rowProps={(x) => ({ "data-reg-row": x.c.id, className: "reg-row" + (openId === x.c.id ? " on" : ""), tabIndex: 0, "aria-label": "Challan " + TDSCH.label(x.c),
        onClick: (ev) => { if (ev.target.closest && ev.target.closest("button, a, input, select, label, details, .reg-split-pop")) return; openDetail("challan", x.c.id); },
        onKeyDown: (ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) openDetail("challan", x.c.id); } })}
      empty={all.length ? "Every challan is used in full." : <span data-reg-empty="">No challans yet · <button className="linkbtn" data-reg-empty-add="" onClick={() => setAdding(true)}>Add challan</button> · or they come from Tally when you pay TDS there</span>}
      after={(x) => S.regAddTo === x.c.id && <UseBalance c={x.c} onDone={() => { S.regAddTo = ""; render(); }} />}
      cols={[
        { k: "date", role: "date", label: "Deposited", cls: "dt", v: (x) => TDS.ymd(x.c.date), cell: (x) => day(x.c.date) },
        { k: "no", role: "number", label: "BSR / serial", v: (x) => x.c.bsr + x.c.serial, cell: (x) => <span className="reg-no"><button className="linkbtn" onClick={() => openDetail("challan", x.c.id)}>{x.c.bsr} / {x.c.serial}</button>
          {" "}<SrcBadge c={x.c} short /></span> },
        { k: "nat", role: "party", label: "Nature", v: (x) => TDSReg.natureCode(x.c), cell: (x) => TDSReg.homeForm(x.c) || TDSReg.natureCode(x.c) ? TDSReg.natureCode(x.c)
          : <button className="linkbtn reg-settype" data-set-type={x.c.id} title="This challan gives no nature of payment: say which, and it goes to its return" onClick={() => { S.regSetType = x.c.id; openDetail("challan", x.c.id); }}>Set type</button> },
        { k: "total", role: "amount", label: "Total", cls: "n", v: (x) => TDSReg.split(x.c).total, fmt: money, cell: (x) => <Split c={x.c} kind="total" cx={cx} /> },
        { k: "left", role: "status", label: "Balance left", cls: "n", v: (x) => x.bal.total, fmt: money, sum: true, td: (x) => ({ "data-reg-left": x.c.id }), cell: (x) => <Split c={x.c} kind="left" cx={cx} /> },
        { k: "ac", role: "act", cls: "ac", cell: (x) => <button className="btn small" data-reg-addto={x.c.id} onClick={() => { S.regAddTo = S.regAddTo === x.c.id ? "" : x.c.id; render(); }}>Use…</button> },
      ]} />
    {(() => { const x = openId ? all.find((r) => r.c.id === openId) : null;
      return <DetailDrawer kind="challan" wide title={x ? "Challan " + x.c.bsr + " / " + x.c.serial : ""} description={x ? day(x.c.date) + " · " + money(TDSReg.split(x.c).total) + " · " + money(x.bal.total) + " left" : ""}>
        {x ? <ChallanDetail key={x.c.id} x={x} cx={cx} /> : null}</DetailDrawer>; })()}
    {del.length > 0 && <p className="note" style={{ marginTop: 10 }}><button className="linkbtn" data-reg-deleted="" onClick={() => setShowDel(!showDel)}>Deleted ({del.length})</button></p>}
    {showDel && <ul className="note" data-reg-deleted-list="" style={{ margin: "0 0 0 18px" }}>{del.map((c) => <li key={c.id}>{TDSCH.label(c)} · {money(c.tax)} · deleted {fmtDateTime(c.deleted.at)}{c.deleted.by ? " by " + c.deleted.by : ""}: {c.deleted.reason}
      {" "}<button className="linkbtn" data-reg-restore={c.id} onClick={() => { const r = TDSReg.restore(c.id); toast(r.ok ? "Challan " + TDSCH.label(c) + " is back." : r.why); render(); }}>Restore</button></li>)}</ul>}
  </div>;
}
