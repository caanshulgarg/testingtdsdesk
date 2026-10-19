// The Deductees step of every TDS return (next-challan-match, the owner's direction of 18-Oct-2026, as Winman lays a
// return out; next-tds-clear, design §3.4: one line per deductee, one status chip per row). Columns: deductee · PAN ·
// PAN status · section (short code, its words on a hover) · deductions · paid · TDS. Those with no PAN, or an invalid or
// inoperative one, first and in red. Show: All · PAN problems · Not checked · Rate questions; Find. A row opens the
// deductee's drawer: the PAN (and the name written in the file) typed or corrected, checked at once (its form, its 4th
// letter against the name, the same PAN on another deductee), its status from TRACES through PANCheck (src/js/87) once
// that is connected ("Not checked yet · Check on TRACES" until then); its deductions with their challans; Form 16A; the
// rate explained. Saved for the deductee (TDSPanFix.set): every deduction of it, the 206AA rate and the remark C follow.
import { useState } from "react";
import { SideDrawer } from "./Shell.jsx";
import { F16Link } from "./Files.jsx";
import More from "../../parts/More.jsx";
import { Search } from "../../parts/Filters.jsx";
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
// one chip per row: the PAN's state (no PAN said here too)
const RowChip = ({ p }) => (!p.pan ? <span className="tag warn" data-pan-state="none">No PAN</span> : !Certs.validPan(p.pan) ? <span className="tag warn" data-pan-state="form">Not a PAN</span>
  : <span className={"tag " + (p.status.state === "valid" ? "ok" : p.status.state === "unknown" ? "" : "warn")} data-pan-state={p.status.state} title={p.status.words}>{p.status.state === "unknown" ? "Not checked" : p.status.state === "valid" ? "Operative" : p.status.state === "inoperative" ? "Inoperative" : "Invalid"}</span>);

export default function DeducteesPan({ form, fy, q, issueOf = {}, title }) {
  const list = TDSPanFix.list(form, fy, q), locked = TDSReg.locked(fy, q, form), [find, setFind] = useState("");
  const f = S.tdsDeeF || "";
  const rateN = (p) => p.rows.filter((r) => issueOf[r.id]).length;
  const qq = find.trim().toLowerCase();
  const shown = list.filter((p) => (!qq || [p.name, p.party, p.pan, p.secs.join(" ")].join(" ").toLowerCase().includes(qq))
    && (!f || (f === "bad" ? p.bad : f === "unknown" ? p.pan && p.status.state === "unknown" : f === "rate" ? rateN(p) > 0 : true)));
  const nBad = list.filter((p) => p.bad).length, unknown = list.filter((p) => p.pan && Certs.validPan(p.pan) && p.status.state === "unknown").map((p) => p.pan), nRate = list.filter((p) => rateN(p) > 0).length;
  const unit = form === "24Q" ? ["employee", "employees"] : form === "27EQ" ? ["buyer", "buyers"] : ["deductee", "deductees"];
  const setF = (v) => { S.tdsDeeF = v; render(); };
  const pill = (k, label, n) => <button type="button" className={"seg" + (f === k ? " on" : "")} aria-pressed={f === k} data-dee-show={k || "all"} onClick={() => setF(k)}>{label}{n != null ? <span className="sbar-n">{n}</span> : null}</button>;
  return <div data-deductees-pan="">
    <div className="rt-tool" data-step-tool="">
      <Search value={find} placeholder="Find deductee or PAN" label="Find a deductee or PAN" data-fk="tdsf-deductees" onChange={setFind} />
      <span className="segs" role="group" aria-label="Show">{pill("", "All")}{pill("bad", "PAN problems", nBad)}{pill("unknown", "Not checked", unknown.length)}{form === "26Q" ? pill("rate", "Rate questions", nRate) : null}</span>
      <span className="rt-sp" />
      <button className="btn small" data-pan-check-all="" disabled={!unknown.length || typeof PANCheck.provider !== "function"} onClick={() => tdsPanCheck(unknown)}>Check PANs on TRACES{typeof PANCheck.provider !== "function" ? " · not connected yet" : ""}</button>
      <More label="⋯" ariaLabel="Export" items={[["Paste PANs / import Excel (name, PAN)", () => { S.tdsPanPaste = true; render(); }, { "data-pan-paste-open": "" }], ["PAN book", () => { S.tdsPanBook = true; render(); }, { "data-pan-book-open": "" }], ["Print or save as PDF", () => printTable("tdsDeTable", (title || "") + " deductees")], ["Excel (the return’s working)", () => doAct(form === "24Q" ? "q24Excel" : "tdsExcel")]]} />
    </div>
    <div className="bk-tablewrap"><table className="bk-table rt-rows" id="tdsDeTable" data-statement="">
      <thead><tr><th>{form === "24Q" ? "Employee" : form === "27EQ" ? "Buyer" : "Deductee"}</th><th>PAN</th><th>PAN status</th><th>Section</th><th className="n">Deductions</th><th className="n">Paid or credited</th><th className="n">TDS</th></tr></thead>
      <tbody>{shown.map((p) => <tr key={p.key} className={"dee-row" + (p.bad ? " bad" : "")} data-dee={p.key} data-dee-bad={p.bad ? "1" : undefined} tabIndex={0} onClick={() => tdsDeducteeOpen(p.key)} onKeyDown={(ev) => { if (ev.key === "Enter") tdsDeducteeOpen(p.key); }}>
        <td className="pty"><button className="linkbtn" data-dee-open={p.key} onClick={(ev) => { ev.stopPropagation(); tdsDeducteeOpen(p.key); }}>{p.name}</button>
          {p.fixed ? <small className="tg-sub-i" data-dee-fixed="" title="Corrected in FinCom"> ✎</small> : null}{rateN(p) ? <span className="rt-dot" title={rateN(p) + " rate question" + (rateN(p) === 1 ? "" : "s")} aria-label="rate question" data-dee-rate={rateN(p)}>•</span> : null}</td>
        <td>{p.pan && Certs.validPan(p.pan) ? <>{p.pan}{p.source === "fincom" ? <small className="tg-sub-i" title="Saved in FinCom’s PAN book" data-pan-from="fincom"> ·F</small> : null}</> : <PanBox party={p.party} compact />}</td>
        <td><RowChip p={p} />{p.conflict ? <PanConflict party={p.party} c={p.conflict} /> : null}</td>
        <td title={p.secs.map((s) => secTitle(s, fy)).filter(Boolean).join("; ")}>{p.secs.map((s) => secShort(s, fy)).join(", ")}</td><td className="n">{p.n}</td><td className="n">{money(p.paid)}</td><td className="n">{money(p.tds)}</td></tr>)}</tbody>
    </table></div>
    <p className="note dee-count" data-dee-count="">{shown.length === list.length ? list.length : shown.length + " of " + list.length} {list.length === 1 ? unit[0] : unit[1]} · {money(shown.reduce((a, p) => a + p.paid, 0))} paid · {money(shown.reduce((a, p) => a + p.tds, 0))} TDS
      {(f || qq) ? <> · <button type="button" className="linkbtn" data-ded-clear="" onClick={() => { setFind(""); setF(""); }}>Clear filters</button></> : null}</p>
    {!list.length && <p className="note">No {unit[1]} in this return.</p>}
    <DeducteeDetails list={list} form={form} fy={fy} q={q} locked={locked} issueOf={issueOf} />
  </div>;
}

export function DeducteeDetails({ list, form, fy, q, locked, issueOf = {} }) {
  const p = list.find((x) => x.key === S.tdsDee) || null, [pan, setPan] = useState(null), [name, setName] = useState(null);
  const close = () => { S.tdsDee = ""; setPan(null); setName(null); render(); };
  if (!p) return <SideDrawer open={false} onClose={close} kind="deductee" />;
  const v = pan == null ? p.pan : pan.toUpperCase().replace(/\s/g, ""), nm = name == null ? p.name : name;
  const probs = PANCheck.offline(v, p.party, list), st = PANCheck.status(v), ok = !v || Certs.validPan(v);
  const chOf = (id) => TDS.challans().find((c) => c.id === id);
  const why = p.rows.map((r) => issueOf[r.id]).filter(Boolean);
  return <SideDrawer open onClose={close} kind="deductee" title="Deductee details" description={p.party + " · " + p.n + " deduction" + (p.n === 1 ? "" : "s") + " · TDS " + money(p.tds)}>
    <div data-dee-dialog="">
      <div className="ach-grid">
        <label className="ach-f">Name in the file<input type="text" value={nm} maxLength={75} aria-label="Name in the file" onChange={(ev) => setName(ev.target.value)} disabled={locked} /></label>
        <label className="ach-f">PAN<input type="text" value={v} maxLength={10} aria-label="PAN" placeholder="ABCDE1234F" onChange={(ev) => setPan(ev.target.value)} disabled={locked} style={{ textTransform: "uppercase" }} /></label>
      </div>
      <p className="note" data-dee-status=""><PanState st={st} />{" "}{Certs.validPan(v) && st.state === "unknown" && <button className="linkbtn" data-dee-check="" onClick={() => tdsPanCheck([v])}>Check on TRACES</button>}</p>
      {probs.length > 0 && <ul className="note" data-dee-probs="">{probs.map((x) => <li key={x.k} className={x.bad ? "bad" : "warn"} data-dee-prob={x.k}>{x.words}</li>)}</ul>}
      {locked ? <p className="note">This return is marked filed: open a correction to change the PAN.</p>
        : <div className="row" style={{ gap: 8, margin: "4px 0 10px" }}>
          <button className="btn small primary" data-dee-save="" disabled={!ok} onClick={() => { const r = tdsDeducteeSet(p.party, { pan: v, name: nm }); if (r.ok) close(); }}>Save for all {p.n} deduction{p.n === 1 ? "" : "s"}</button>
          <button className="btn small" onClick={close}>Cancel</button></div>}
      <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>Date</th><th>Section</th><th className="n">Paid</th><th className="n">TDS</th><th className="n">Rate</th><th>Challan</th></tr></thead>
        <tbody>{p.rows.map((r) => { const c = r.challan ? chOf(r.challan) : null; return <tr key={r.id}><td>{day(r.date)}</td><td title={secTitle(r.section, fy)}>{secShort(r.section, fy)}</td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td><td className="n">{r.rate != null ? r.rate + "%" : ""}</td>
          <td>{c ? TDSCH.label(c) : <span className="bad">Not matched</span>}</td></tr>; })}</tbody></table></div>
      {why.length > 0 && <div className="note" data-dee-rate-why=""><b>The rate:</b><ul>{why.map((x, i) => <li key={i}>{day(x.row.date)}: {x.row.rate}% used, {x.expected}% applies — {x.why}</li>)}</ul></div>}
      {Certs.validPan(p.pan) ? <p className="note">{form === "24Q" ? "Form 16" : TDS.isNew(fy) ? "Form 131 (earlier Form 16A)" : "Form 16A"}: {TRF.f16().some((r) => r.pan === p.pan && (!r.fy || r.fy === fy) && (!r.q || r.q === q)) ? <F16Link pan={p.pan} fy={fy} q={q} /> : "none brought in yet (After filing › Upload TRACES files)"}</p> : null}
    </div></SideDrawer>;
}
