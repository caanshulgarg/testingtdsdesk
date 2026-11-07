// Corporate › e-Forms (the design "2 · Client › Corporate › e-Forms"): the year's annual forms with their due dates
// (rules.js), each tracked Not started -> In progress (n of 4) -> Ready -> Filed (SRN and date), or Not needed with a reason;
// the event-based forms, started from what happened in the company; the forms filed with their SRNs; and every rule with
// the section it rests on. FinCom does not file: the person files on the MCA portal with DSC and types the SRN in here.
import { useState } from "react";
import Button from "../../parts/Button.jsx";
import { canEdit, corpOf, dropFiling, saveFiling, saveProfile } from "./store.js";
import { ANNUAL, EVENT, srnOk } from "./rules.js";
import { agmOf, annual, events, open, startEvent, words } from "./eforms.js";
import { dmy, dueIn, fyNext, lastClosedFy, today } from "./dates.js";
import { shown } from "./Profile.jsx";

function Steps({ n }) { return <div className="corp-steps" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} data-on={i < n ? "" : undefined} />)}</div>; }

function Due({ r }) {
  if (!open(r)) return <span>{dmy(r.due) ? dmy(r.due).slice(0, 6) : ""}</span>;
  const d = dueIn(r.due);
  return <span className="when" data-tone={d.tone} style={{ fontWeight: 600 }}>{dmy(r.due)}{d.words && <span style={{ fontWeight: 500 }}>{" · " + d.words}</span>}</span>;
}

function Progress({ r }) {
  if (r.status === "filed") return <span className="corp-chip" data-tone="ok" data-form-words="">{words(r)}</span>;
  if (r.status === "not_needed") return <span className="corp-note" data-form-words="">{words(r)}</span>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><Steps n={r.done} /><span className="corp-note" style={{ fontSize: 12 }} data-form-words="">{words(r)}</span></div>;
}

// a form opened in its row: its four steps, Filed (SRN, date), Not needed (why), the rule it rests on
function Detail({ co, r, close }) {
  if (!canEdit(co.id)) return <div className="corp-card-body" data-form-detail={r.ref} style={{ padding: "14px 20px 18px", background: "var(--corp-tint)" }}>
    <span>{words(r)}</span><p className="corp-help" data-form-law="" style={{ margin: 0 }}>{r.law}</p></div>;
  const [srn, setSrn] = useState(r.srn || ""), [on, setOn] = useState(r.filedOn || today()), [why, setWhy] = useState(r.status === "not_needed" ? r.reason : "");
  const base = { ref: r.ref, form: r.form, kind: r.kind, period: r.period, director: r.din || r.director || "", due: r.due, event: r.event || "", data: r.data || {} };
  const keep = (patch) => saveFiling(co.id, Object.assign({}, base, { status: r.status === "not_needed" && r.auto ? "not_started" : r.status, steps: r.done, srn: r.srn, filedOn: r.filedOn, reason: r.reason }, patch));
  const step = (i, v) => { const n = v ? Math.max(r.done, i + 1) : i; keep({ steps: n, status: n >= 4 ? "ready" : n > 0 ? "in_progress" : "not_started" }); };
  const okSrn = srnOk(srn);
  const filed = () => {
    keep({ status: "filed", srn: srn.trim().toUpperCase(), filedOn: on, steps: 4 });
    // DIR-3 KYC filed: the director's KYC is done for the year (Directors & KMP)
    if (r.form === "DIR-3 KYC") { const p = corpOf(co.id).profile; saveProfile(co.id, { directors: (p.directors || []).map((d) => ((d.din || "") === (r.din || "") && d.name === r.director ? Object.assign({}, d, { kyc: Array.from(new Set((d.kyc || []).concat([r.period]))) }) : d)) }); }
    close();
  };
  return <div className="corp-card-body" data-form-detail={r.ref} style={{ padding: "14px 20px 18px", background: "var(--corp-tint)", borderTop: "1px solid var(--corp-soft)" }}>
    {r.status !== "filed" && r.status !== "not_needed" && <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 18, flexWrap: "wrap" }}>
      <legend className="corp-note" style={{ marginBottom: 6 }}>Steps</legend>
      {r.steps.map((s, i) => <label key={s} className="chk" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" data-form-step={i} checked={r.done > i} onChange={(e) => step(i, e.target.checked)} /> {(i + 1) + ". " + s}</label>)}
    </fieldset>}
    {r.builder === "aoc4" && r.status !== "filed" && <div className="corp-row"><Button className="btn small primary" data-open-aoc4="" onClick={() => { S.corpFy = r.period; goClient("books:corp-aoc4"); }}>Open the AOC-4 builder</Button>
      <span className="corp-note">Figures in the form's order from the balance sheet and P&amp;L, checked, with the attachments.</span></div>}
    {r.status !== "filed" ? <div className="corp-row" style={{ alignItems: "flex-end" }}>
      <label className="corp-f"><span>SRN (after filing on the MCA portal)</span><input type="text" data-form-srn="" value={srn} onChange={(e) => setSrn(e.target.value)} placeholder="AB1234567" maxLength={14} /></label>
      <label className="corp-f"><span>Filed on</span><input type="date" data-form-filed-on="" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      <Button className="btn small primary" data-form-filed="" disabled={!okSrn || !on} onClick={filed}>Mark as filed</Button>
      {srn && !okSrn && <span className="corp-note">An SRN is a letter and 7 to 11 letters or digits (e.g. AB1234567).</span>}
    </div> : <div className="corp-row"><span>{words(r)}</span><button className="linkbtn" data-form-unfile="" onClick={() => keep({ status: r.done >= 4 ? "ready" : "in_progress", srn: "", filedOn: "" })}>Not filed after all</button></div>}
    {r.status !== "filed" && (r.status === "not_needed" ? <div className="corp-row"><span>{words(r)}</span>
      <button className="linkbtn" data-form-needed="" onClick={() => keep({ status: "not_started", reason: "", steps: 0 })}>Needed after all</button></div>
      : <div className="corp-row" style={{ alignItems: "flex-end" }}>
        <label className="corp-f" style={{ flex: "1 1 260px" }}><span>Not needed? Say why</span><input type="text" data-form-why="" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. no deposits or loans outstanding on 31 March" /></label>
        <Button className="btn small" data-form-not-needed="" disabled={!why.trim()} onClick={() => { keep({ status: "not_needed", reason: why.trim() }); close(); }}>Not needed</Button></div>)}
    {r.kind === "event" && <div className="corp-row">{r.resolution && <button className="linkbtn" onClick={() => { S.corpNew = r.resolution; goClient("books:corp-docs"); }}>Make the board resolution</button>}
      <button className="linkbtn" data-form-drop="" onClick={() => { dropFiling(co.id, r.ref); close(); }}>Remove this form</button></div>}
    <p className="corp-help" data-form-law="" style={{ margin: 0 }}>{r.law}</p>
  </div>;
}

function Table({ co, rows, openRef, setOpen, empty, cols = "annual" }) {
  if (!rows.length) return <div className="corp-card corp-empty">{empty}</div>;
  return <section className="corp-card" style={{ overflow: "hidden" }}>
    <div className="corp-scroll"><table className="corp-table" style={{ minWidth: 820 }} data-forms-table={cols}>
      <thead><tr><th>Form</th><th>What it is</th><th>Due</th><th style={{ width: 240 }}>Progress</th><th aria-label="Action" /></tr></thead>
      <tbody>{rows.map((r) => [<tr key={r.ref} data-form={r.form} data-form-ref={r.ref} data-status={r.status} data-due={r.due || ""}>
        <td><b style={{ color: "var(--corp-navy)" }}>{r.form}</b></td>
        <td>{r.what}{r.kind === "event" && r.event ? <span className="corp-note">{" · event of " + dmy(r.event)}</span> : r.dueFrom ? <><br /><span className="corp-note" style={{ fontSize: 12 }}>{r.dueFrom}</span></> : null}</td>
        <td><Due r={r} /></td>
        <td><Progress r={r} /></td>
        <td style={{ textAlign: "right" }}><Button className={"btn small" + (openRef !== r.ref && open(r) && r.done > 0 ? " primary" : "")} data-form-open={r.ref} aria-expanded={openRef === r.ref}
          onClick={() => setOpen(openRef === r.ref ? "" : r.ref)}>{openRef === r.ref ? "Close" : !open(r) ? (r.status === "filed" ? "View" : "Why") : r.done > 0 ? "Continue" : "Start"}</Button></td>
      </tr>, openRef === r.ref ? <tr key={r.ref + ":d"}><td colSpan={5} style={{ padding: 0 }}><Detail co={co} r={r} close={() => setOpen("")} /></td></tr> : null])}</tbody>
    </table></div>
  </section>;
}

function EventStart({ co, rule, close }) {
  const [on, setOn] = useState(today()), [note, setNote] = useState("");
  return <div className="corp-card corp-card-body" style={{ paddingTop: 16 }} data-event-start={rule.form}>
    <h3>{rule.event + " · " + rule.form}</h3>
    <p className="corp-note">{"Due within " + rule.days + " days of the event. " + rule.law}</p>
    <div className="corp-row" style={{ alignItems: "flex-end" }}>
      <label className="corp-f"><span>Date of the event</span><input type="date" data-event-date="" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      <label className="corp-f" style={{ flex: "1 1 240px" }}><span>Note (optional)</span><input type="text" data-event-note="" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the director's name, the bank" /></label>
      <Button className="btn small primary" data-event-go="" disabled={!on} onClick={() => { saveFiling(co.id, startEvent(rule, on, note)); close(true); }}>Start tracking</Button>
      <button className="linkbtn" onClick={() => close(false)}>Cancel</button>
    </div>
  </div>;
}

export default function Forms({ co }) {
  const c = corpOf(co.id), P = shown(co), on = today();
  const [tab, setTab] = useState("annual"), [openRef, setOpen] = useState(""), [ev, setEv] = useState(null);
  const may = canEdit(co.id);
  const fy = S.corpFy || lastClosedFy(on), rows = annual(P, fy, c.filings), evs = events(c.filings), a = agmOf(P, fy);
  const setFy = (f) => { S.corpFy = f; setOpen(""); render(); };
  const filed = annual(P, fy, c.filings).concat(evs).filter((r) => r.status === "filed" && !r.fromProfile);
  const allFiled = (c.filings || []).filter((f) => f.status === "filed");
  const TABS = [["annual", "Annual filings · FY " + fy], ["event", "Event-based" + (evs.filter(open).length ? " (" + evs.filter(open).length + ")" : "")], ["filed", "Filed & SRNs"], ["all", "All forms"]];
  return <div data-corp-page="forms" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><div className="corp-eyebrow">{"Corporate · " + (P.name || co.name)}</div><h1>e-Forms</h1></div>
      <div className="corp-row">
        <span className="corp-row" style={{ gap: 4 }} aria-label="Financial year">
          <Button className="btn small" aria-label="Year before" onClick={() => setFy(fyNext(fy, -1))}>‹</Button>
          <b data-forms-fy="" style={{ minWidth: 92, textAlign: "center" }}>{"FY " + fy}</b>
          <Button className="btn small" aria-label="Year after" disabled={fy >= lastClosedFy(on)} onClick={() => setFy(fyNext(fy, 1))}>›</Button></span>
        {may && <Button className="btn primary" data-forms-prepare="" onClick={() => { setTab("all"); setOpen(""); }}>Prepare a form</Button>}
      </div>
    </header>
    <div className="corp-card" style={{ padding: "12px 16px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }} data-forms-agm="">
      <label className="corp-f" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><span>{"AGM for FY " + fy + " held on"}</span>
        <input type="date" data-forms-agm-date="" disabled={!may} value={(P.agms || {})[fy] || ""} onChange={(e) => saveProfile(co.id, { agms: Object.assign({}, P._own.agms, { [fy]: e.target.value }) })} /></label>
      <span className="corp-note">{a.held ? "The due dates run from it." : P.cls === "opc" ? "An OPC holds no AGM (s.96(1))." : "Not entered: the due dates run from " + dmy(a.date) + ", the last day for the AGM (s.96(1))."}</span>
    </div>
    <div role="tablist" aria-label="e-Forms" className="sbar" style={{ margin: 0 }}>
      {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} data-forms-tab={k} onClick={() => { setTab(k); setOpen(""); }}>{l}</button>)}
    </div>
    {tab === "annual" && <Table co={co} rows={rows} openRef={openRef} setOpen={setOpen} empty="No annual forms." />}
    {tab === "event" && <Table co={co} rows={evs} openRef={openRef} setOpen={setOpen} cols="event" empty="No event-based form started. Pick what happened in the company below." />}
    {tab === "filed" && (allFiled.length ? <section className="corp-card" style={{ overflow: "hidden" }}><div className="corp-scroll"><table className="corp-table" data-forms-table="filed">
      <thead><tr><th>Form</th><th>For</th><th>SRN</th><th>Filed on</th></tr></thead>
      <tbody>{allFiled.slice().sort((x, y) => String(y.filedOn).localeCompare(String(x.filedOn))).map((f) => <tr key={f.ref} data-filed={f.form}><td><b>{f.form}</b></td>
        <td>{f.kind === "event" ? ((f.data && f.data.event) || "") + " · " + dmy(f.event) : "FY " + f.period + (f.director ? " · " + f.director : "")}</td><td className="corp-num">{f.srn || "—"}</td><td>{dmy(f.filedOn) || "—"}</td></tr>)}</tbody></table></div></section>
      : <div className="corp-card corp-empty">{filed.length ? "" : "Nothing filed yet. A form marked as filed, with its SRN, is listed here."}</div>)}
    {tab === "all" && <section className="corp-card" style={{ overflow: "hidden" }}><div className="corp-scroll"><table className="corp-table" data-forms-table="rules">
      <thead><tr><th>Form</th><th>When</th><th>The rule</th></tr></thead>
      <tbody>{ANNUAL.map((r) => <tr key={"a" + r.form} data-rule={r.form}><td><b>{r.form}</b><br /><span className="corp-note">{r.what}</span></td><td>Every year</td><td className="corp-help">{r.law}</td></tr>)}
        {EVENT.map((r) => <tr key={"e" + r.form + r.event} data-rule={r.form}><td><b>{r.form}</b><br /><span className="corp-note">{r.event}</span></td><td>{"Within " + r.days + " days"}</td>
          <td className="corp-help">{r.law} <button className="linkbtn" data-rule-start={r.form} onClick={() => { setEv(r); setTab("event"); }}>Start</button></td></tr>)}</tbody></table></div>
      <p className="corp-help" style={{ padding: "10px 20px 14px", margin: 0 }}>The rules are in one file (screens/corp/rules.js) with the section or rule each rests on, for a Company Secretary to check.</p></section>}
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }} data-forms-events="">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 19 }}>Something changed in the company?</h2>
        <span className="corp-note">Pick the event: FinCom tracks its form from the event's date, and makes the board resolution where there is one.</span></div>
      {ev && <EventStart co={co} rule={ev} close={(done) => { setEv(null); if (done) setTab("event"); }} />}
      <div className="corp-tiles">{EVENT.map((r) => <button key={r.form + r.event} className="corp-tile" data-event={r.form} disabled={!may} onClick={() => setEv(r)}>
        <b>{r.event}</b><small>{r.form + " · within " + r.days + " days"}</small></button>)}</div>
    </section>
  </div>;
}
