// The Deductees step of every TDS return (next-challan-match, the owner's direction of 18-Oct-2026, as Winman lays a
// return out; next-tds-clear, design §3.4: one line per deductee, one status chip per row). Columns: deductee · PAN (a
// valid one with its state; else the box to type it: one indicator, round 94) · section (short code, its words on a hover) · deductions · paid · TDS. Those with no PAN, or an invalid or
// inoperative one, first and in red. The filters in the column headers (next-tds-tidy2: Name with "Rate questions only",
// PAN by its state, Section, the figures from / to); the totals in the table's foot. A row opens the
// deductee's drawer: the PAN (and the name written in the file) typed or corrected, checked at once (its form, its 4th
// letter against the name, the same PAN on another deductee), its status from TRACES through PANCheck (src/js/87) once
// that is connected ("Not checked yet · Check on TRACES" until then); its deductions with their challans; Form 16A; the
// rate explained. Saved for the deductee (TDSPanFix.set): every deduction of it, the 206AA rate and the remark C follow.
import { useState } from "react";
import { SideDrawer } from "./Shell.jsx";
import { useDraft } from "../../parts/DetailDrawer.jsx";
import { F16Link } from "./Files.jsx";
import More from "../../parts/More.jsx";
import { useCF, Th } from "./ColF.jsx";
import { PanBox, PanConflict } from "./PanBook.jsx";
import "../../lib/tdsGlobals.js";   // next-challan-match: TDSMatch, PANCheck and the matcher's rules come with the TDS screens

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
// a section as a short code: "194C" before 2026-27; "393(1)-6(i) · 194C" from it (the words on a hover)
export const secShort = (s, fy) => { const x = TDS.secNew(s, fy || S.tdsFy); return x.ref ? x.ref.replace(/ Sl\. /, "-") + " · " + x.old : TDS.sec(s) || s || ""; };
// the same, with the old section apart (hidden where the table is narrow; the hover keeps it)
export const SecShort = ({ s, fy }) => { const x = TDS.secNew(s, fy || S.tdsFy); return x.ref ? <>{x.ref.replace(/ Sl\. /, "-")}<span className="sec-old"> · {x.old}</span></> : <>{TDS.sec(s) || s || ""}</>; };
export const secTitle = (s, fy) => { const x = TDS.secNew(s, fy || S.tdsFy); return x.ref ? x.ref + " [old " + x.old + "] · " + x.label : (TDS.secName(s) ? TDS.sec(s) + " · " + TDS.secName(s) : ""); };

export function PanState({ st }) {
  const cls = st.state === "valid" ? "ok" : st.state === "unknown" ? "" : "bad";
  return <span className={"tag " + cls} data-pan-state={st.state}>{st.words}</span>;
}
// one PAN indicator per row (round 94): a valid PAN's state as a chip beside it; no PAN or not a PAN is the box to type it
const stateW = (st) => (st === "unknown" ? "Not checked" : st === "valid" ? "Operative" : st === "inoperative" ? "Inoperative" : "Invalid");
const RowChip = ({ p }) => (<span className={"tag " + (p.status.state === "valid" ? "ok" : p.status.state === "unknown" ? "" : "warn")} data-pan-state={p.status.state} title={p.status.words}>{stateW(p.status.state)}</span>);

// which deductee's panel is open: S.tdsDee = "k:" + its key. A deductee with no name has the key "" (normName of ""), so the
// bare key cannot mark it: "" (closed) would match it and its panel could never close (the owner, 22-Oct-2026: a blank
// line of MONIKA NAUTIYAL, 194J, no PAN). tdsDeducteeOpen(key) with a non-blank bare key still opens it.
export const openDee = (key) => { S.tdsDee = "k:" + key; render(); };
const isOpen = (x) => { const w = S.tdsDee; return typeof w === "string" && w !== "" && (w === "k:" + x.key || (x.key !== "" && w === x.key)); };
export default function DeducteesPan({ form, fy, q, issueOf = {}, title }) {
  const list = TDSPanFix.list(form, fy, q), locked = TDSReg.locked(fy, q, form);
  const rateN = (p) => p.rows.filter((r) => issueOf[r.id]).length;
  const unknown = list.filter((p) => p.pan && Certs.validPan(p.pan) && p.status.state === "unknown").map((p) => p.pan);
  const unit = form === "24Q" ? ["employee", "employees"] : form === "27EQ" ? ["buyer", "buyers"] : ["deductee", "deductees"];
  const panW = (p) => (p.pan && Certs.validPan(p.pan) ? stateW(p.status.state) : "No valid PAN");
  const cf = useCF("dee", [
    { k: "name", title: unit[0][0].toUpperCase() + unit[0].slice(1), kind: "q", placeholder: "Name or PAN", get: (p) => [p.name, p.party, p.pan].join(" "),
      flag: form === "26Q" ? { k: "rate", label: "Rate questions only", test: (p) => rateN(p) > 0 } : undefined },
    { k: "pan", title: "PAN", kind: "pick", get: panW },
    { k: "sec", title: "Section", kind: "pick", get: (p) => p.secs.map((x) => secShort(x, fy)).join(", ") },
    { k: "n", title: "Deductions", kind: "num", get: (p) => p.n },
    { k: "paid", title: "Paid or credited", kind: "num", get: (p) => p.paid },
    { k: "tds", title: "TDS", kind: "num", get: (p) => p.tds },
  ], list), shown = cf.shown;
  const tot = (k) => r2(shown.reduce((a, p) => a + num(p[k]), 0));
  return <div data-deductees-pan="">
    <div className="rt-tool" data-step-tool="">
      <span className="rt-sp" />
      <button className="btn small" data-pan-check-all="" disabled={!unknown.length || typeof PANCheck.provider !== "function"} onClick={() => tdsPanCheck(unknown)}>Check PANs on TRACES{typeof PANCheck.provider !== "function" ? " · not connected yet" : ""}</button>
      <More label="⋯" ariaLabel="Export" items={[["Paste PANs / import Excel (name, PAN)", () => { S.tdsPanPaste = true; render(); }, { "data-pan-paste-open": "" }], ["PAN book", () => { S.tdsPanBook = true; render(); }, { "data-pan-book-open": "" }], ["Print or save as PDF", () => printTable("tdsDeTable", (title || "") + " deductees")], ["Excel (the return’s working)", () => doAct(form === "24Q" ? "q24Excel" : "tdsExcel")]]} />
    </div>
    <div className="bk-tablewrap"><table className="bk-table rt-rows" id="tdsDeTable" data-statement="">
      <thead><tr><Th cf={cf} k="name">{form === "24Q" ? "Employee" : form === "27EQ" ? "Buyer" : "Deductee"}</Th><Th cf={cf} k="pan" cls="pan">PAN</Th><Th cf={cf} k="sec">Section</Th><Th cf={cf} k="n" cls="n">Deductions</Th><Th cf={cf} k="paid" cls="n">Paid or credited</Th><Th cf={cf} k="tds" cls="n">{form === "27EQ" ? "TCS" : "TDS"}</Th></tr></thead>
      <tbody>{shown.map((p) => <tr key={p.key} className={"dee-row" + (p.bad ? " bad" : "")} data-dee={p.key} data-dee-bad={p.bad ? "1" : undefined} tabIndex={0} onClick={() => openDee(p.key)} onKeyDown={(ev) => { if (ev.key === "Enter") openDee(p.key); }}>
        <td className="pty"><button className="linkbtn" data-dee-open={p.key} onClick={(ev) => { ev.stopPropagation(); openDee(p.key); }}>{p.name}</button>{p.aka && p.aka.length ? <small className="note" data-dee-aka="" style={{ display: "block" }}>also {p.aka.join(", ")} (one PAN)</small> : null}
          {p.fixed ? <small className="tg-sub-i" data-dee-fixed="" title="Corrected in FinCom"> ✎</small> : null}{rateN(p) ? <span className="rt-dot" title={rateN(p) + " rate question" + (rateN(p) === 1 ? "" : "s")} aria-label="rate question" data-dee-rate={rateN(p)}>•</span> : null}</td>
        <td className="dee-pan pan">{p.pan && Certs.validPan(p.pan) ? <>{p.pan}{p.source === "fincom" ? <small className="tg-sub-i" title="Saved in FinCom’s PAN book" data-pan-from="fincom"> ·F</small> : null} <RowChip p={p} /></> : <PanBox party={p.party} compact />}
          {p.conflict ? <PanConflict party={p.party} c={p.conflict} /> : null}</td>
        <td title={p.secs.map((s) => secTitle(s, fy)).filter(Boolean).join("; ")}>{p.secs.map((s) => secShort(s, fy)).join(", ")}</td><td className="n">{p.n}</td><td className="n">{money(p.paid)}</td><td className="n">{money(p.tds)}</td></tr>)}</tbody>
      {/* next-tds-tidy2: the return's TDS here (it was the summary strip's) */}
      {list.length > 0 && <tfoot><tr data-dee-total=""><td colSpan={3}>Total{cf.on ? <> · {cf.foot()}</> : null}</td><td className="n">{tot("n")}</td><td className="n">{money(tot("paid"))}</td><td className="n" data-dee-tds={tot("tds")}>{money(tot("tds"))}</td></tr></tfoot>}
    </table></div>
    {!list.length && <p className="note">No {unit[1]} in this return.</p>}
    <DeducteeDetails list={list} form={form} fy={fy} q={q} locked={locked} issueOf={issueOf} />
  </div>;
}

export function DeducteeDetails({ list, form, fy, q, locked, issueOf = {} }) {
  // what is typed and not saved stays as this deductee's draft when the panel closes (next-fix-drawers); Save clears it
  const p = list.find(isOpen) || null, dr = useDraft("deductee", p ? form + "|" + p.key : null);
  const pan = dr.value ? dr.value.pan : null, name = dr.value ? dr.value.name : null;
  const setPan = (x) => dr.set({ pan: x, name }), setName = (x) => dr.set({ pan, name: x });
  const [err, setErr] = useState(""), close = () => { S.tdsDee = ""; setErr(""); render(); };
  if (!p) return <SideDrawer open={false} onClose={close} kind="deductee" />;
  const v = pan == null ? p.pan : pan.toUpperCase().replace(/\s/g, ""), nm = name == null ? p.name : name;
  const probs = PANCheck.offline(v, p.party, list), st = PANCheck.status(v), ok = !v || Certs.validPan(v);
  const chOf = (id) => TDS.challans().find((c) => c.id === id);
  const why = p.rows.map((r) => issueOf[r.id]).filter(Boolean);
  return <SideDrawer open onClose={close} kind="deductee" draft={dr} title="Deductee details" description={p.party + " · " + p.n + " deduction" + (p.n === 1 ? "" : "s") + " · TDS " + money(p.tds)}>
    <div data-dee-dialog="">
      <div className="ach-grid">
        <label className="ach-f">Name in the file<input type="text" value={nm} maxLength={75} aria-label="Name in the file" onChange={(ev) => setName(ev.target.value)} disabled={locked} /></label>
        <label className="ach-f">PAN<input type="text" value={v} maxLength={10} aria-label="PAN" placeholder="ABCDE1234F" onChange={(ev) => setPan(ev.target.value)} disabled={locked} style={{ textTransform: "uppercase" }} /></label>
      </div>
      <p className="note" data-dee-status=""><PanState st={st} />{" "}{Certs.validPan(v) && st.state === "unknown" && <button className="linkbtn" data-dee-check="" onClick={() => tdsPanCheck([v])}>Check on TRACES</button>}</p>
      {probs.length > 0 && <ul className="note" data-dee-probs="">{probs.map((x) => <li key={x.k} className={x.bad ? "bad" : "warn"} data-dee-prob={x.k}>{x.words}</li>)}</ul>}
      {err ? <p className="note bad" role="alert" data-dee-err="">{err}</p> : null}
      {locked ? <p className="note">This return is marked filed: open a correction to change the PAN.</p>
        : <div className="row" style={{ gap: 8, margin: "4px 0 10px" }}>
          <button className="btn small primary" data-dee-save="" disabled={!ok} onClick={() => { const r = tdsDeducteeSet(p.party, { pan: v, name: nm }); if (r.ok) { dr.clear(); close(); } else setErr(r.why || "Not saved."); }}>Save for all {p.n} deduction{p.n === 1 ? "" : "s"}</button>
          <button className="btn small" onClick={close}>Cancel</button></div>}
      {form === "26Q" && <Declarations key={p.key + "|" + fy} p={p} fy={fy} locked={locked} />}
      <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th className="dt">Date</th><th>Section</th><th className="n">Paid</th><th className="n">TDS</th><th className="n">Rate</th><th>Challan</th></tr></thead>
        <tbody>{p.rows.map((r) => { const c = r.challan ? chOf(r.challan) : null; return <tr key={r.id}><td className="dt">{day(r.date)}</td><td title={secTitle(r.section, fy)}>{secShort(r.section, fy)}</td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td><td className="n">{r.rate != null ? r.rate + "%" : ""}</td>
          <td>{c ? TDSCH.label(c) : <span className="bad">Not matched</span>}</td></tr>; })}</tbody></table></div>
      {why.length > 0 && <div className="note" data-dee-rate-why=""><b>The rate:</b><ul>{why.map((x, i) => <li key={i}>{day(x.row.date)}: {x.row.rate}% used, {x.expected}% applies — {x.why}</li>)}</ul></div>}
      {Certs.validPan(p.pan) ? <p className="note">{form === "24Q" ? "Form 16" : TDS.isNew(fy) ? "Form 131 (earlier Form 16A)" : "Form 16A"}: {TRF.f16().some((r) => r.pan === p.pan && (!r.fy || r.fy === fy) && (!r.q || r.q === q)) ? <F16Link pan={p.pan} fy={fy} q={q} /> : "none brought in yet (After filing › Upload TRACES files)"}</p> : null}
    </div></SideDrawer>;
}

// next-tds-autoplace (the owner, 23-Oct-2026): the deductee's declarations for the return's year, kept with the books
// (TDSDecl, src/js/94): a transporter's (194C; remark T on its rows with no TDS) and Form 15G / 15H (from 2026-27 Form 121;
// remark B, its date and UIN in the file). Saved as ticked, or with Save declaration
const iso = (d) => { const t = TDS.ymd(d || ""); return t.length === 8 ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) : ""; };
function Declarations({ p, fy, locked }) {
  const d = TDSDecl.of(p.party, fy), b = d.b || {}, [v, setV] = useState(null);
  const cur = v || { form: b.form || "", date: iso(b.date), uin: b.uin || "" }, set = (k, x) => setV(Object.assign({}, cur, { [k]: x }));
  const c194 = p.secs.some((s) => /^194C/.test(TDS.sec(s))), isNew = TDS.isNew(fy);
  return <fieldset className="dee-decl" data-dee-decl={fy} disabled={locked}>
    <legend>Declarations · FY {fy}</legend>
    {c194 && <label className="dee-chk"><input type="checkbox" data-dee-transporter="" checked={!!d.t} onChange={(ev) => tdsDeclSet(p.party, fy, { transporter: ev.target.checked })} />
      <span>Transporter declaration received <small className="note">(10 goods carriages or fewer, PAN given): remark T where no TDS</small></span></label>}
    <div className="ach-grid">
      <label className="ach-f">{isNew ? "Form 121 (15G / 15H)" : "Form 15G / 15H"}<select aria-label="Declaration form" data-dee-bform="" value={cur.form} onChange={(ev) => set("form", ev.target.value)}>
        <option value="">None</option><option value="15G">15G</option><option value="15H">15H</option></select></label>
      {cur.form && <label className="ach-f">Received on<input type="date" aria-label="Declaration received on" data-dee-bdate="" value={cur.date} onChange={(ev) => set("date", ev.target.value)} /></label>}
      {cur.form && <label className="ach-f">UIN{isNew ? "" : " (optional)"}<input type="text" aria-label="Declaration UIN" data-dee-buin="" maxLength={26} value={cur.uin} placeholder={isNew ? "26 letters and digits" : ""} style={{ textTransform: "uppercase" }} onChange={(ev) => set("uin", ev.target.value)} /></label>}
    </div>
    {v && <div className="row" style={{ gap: 8 }}><button className="btn small" data-dee-bsave="" onClick={() => { const r = tdsDeclSet(p.party, fy, cur); if (r.ok) setV(null); }}>Save declaration</button>
      <button className="btn small" onClick={() => setV(null)}>Cancel</button></div>}
  </fieldset>;
}
