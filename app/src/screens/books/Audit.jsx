// The Audit tab of a client's books: findings from rule-based checks of the day book (each with its effect, what to do
// and the journal entry to pass), related parties, and the Form 3CD draft filled from the run. Was viewBooksAudit,
// auditTabs, viewAuditRel and viewAudit3cd (src/js/18). The checks are Audit (src/js/06); changes go through
// auditRangeSet, auditFreqSet, auditFindingSet, relAdd, relSet, relRemove (src/js/23) and doAct (auditRun, auditReport…).
//
// State: S.auditTab (find, rel, 3cd), S.auditRange, S.auditArea, S.auditSt (a status), S.auditOpen (a finding opened),
// S.auditRecheck (round 69: each finding's last Recheck, {[id]: {co, f, busy | failed | still, at, run}}, page state only).
import Legacy from "../../parts/Legacy.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import { AuditButton, AiLedgers } from "../../parts/Ai.jsx";
import { CatchUp } from "../../parts/Notes.jsx";
import Confirm from "../../parts/Confirm.jsx";
import ListTable, { ListRows } from "../../parts/ListTable.jsx";
import DateBox from "../../parts/DateBox.jsx";
import More from "../../parts/More.jsx";
// FinCom Assistant step 2: the working papers (AuditWP, src/js/77-audit.js)
import WorkingPapers from "./AuditWP.jsx";

// ₹ on every amount (clean-up batch 3)
const m = (v) => money(r2(v || 0));
const d = (x) => fmtDate(tallyDate(x));
const SEV = { high: ["SERIOUS", "var(--bad)"], medium: ["TO LOOK AT", "var(--warn)"], low: ["MINOR", "var(--muted)"] };
const REL = ["Director", "Relative of a director", "Partner or proprietor", "Shareholder with 10% or more", "Company or firm they control", "Key manager", "Other"];
import { FinComNav } from "../../nav.js";
// stability batch 3: Run now shows the thin bar while the run takes over 300 ms
const Act = ({ act, className = "btn small", children, title }) => <button className={className} title={title} onClick={() => (act === "misRun" || act === "auditRun" ? FinComNav.go(() => doAct(act)) : doAct(act))}>{children}</button>;

// clean-up batch 1 (11-Oct-2026): the tie-out with Tally (a month-end check of the books against Tally) is Audit's
// fourth tab (booksTab "tieout", its address …/books/tieout as before); the other three are S.auditTab
export function Tabs() {
  const tie = booksTab() === "tieout", t = tie ? "tieout" : S.auditTab || "find";
  const go = (id) => { if (id === "tieout") { goClient("books:tieout"); return; } if (tie) S.booksTab = "audit"; setAndShow("auditTab", id); };
  return <nav className="sbar" aria-label="Audit" style={{ marginBottom: 10 }}>{[["find", "Findings"], ["wp", "Working papers"], ["rel", "Related parties"], ["3cd", "Form 3CD draft"], ["tieout", "Tie-out with Tally"]].map(([id, l]) =>
    <button key={id} data-audit-tab={id} aria-selected={t === id} onClick={() => go(id)}>{l}</button>)}</nav>;
}

// the period, run now, how often by itself, and the report once run
function Head({ b, run }) {
  const c = Audit.cfg(b), dr = Audit.defaultRange(b), range = S.auditRange || { from: Audit.iso(dr.from), to: Audit.iso(dr.to) };
  const lyFrom = MIS.shift(Audit.ymd(range.from), -1), lyTo = MIS.shift(Audit.ymd(range.to), -1), lyHere = MIS.covered(lyFrom);
  const fin = run && Audit.finalFor(run.from, run.to);
  return <section className="dash-card" data-audit-head="">
    <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="f" style={{ minWidth: 150 }}><span>From</span><DateBox aria-label="Audit from" key={"f" + range.from} defaultValue={range.from} onChange={(ev) => auditRangeSet("from", ev.target.value)} /></label>
      <label className="f" style={{ minWidth: 150 }}><span>To</span><DateBox aria-label="Audit to" key={"t" + range.to} defaultValue={range.to} onChange={(ev) => auditRangeSet("to", ev.target.value)} /></label>
      <label className="f" style={{ minWidth: 120 }}><span>Year</span><select aria-label="Audit year" value={S.auditRange ? "" : (S.auditFy || fsLastFull())} onChange={(ev) => { S.auditFy = ev.target.value; S.auditRange = null; render(); }}>
        {S.auditRange && <option value="">dates chosen</option>}{fsYears().map((y) => <option key={y} value={y}>{y + "-" + String(num(y) + 1).slice(2)}</option>)}</select></label>
      <span className="note" style={{ alignSelf: "center" }} data-audit-period="">{fmtDate(range.from) + " to " + fmtDate(range.to) + " · " + entryCount(Audit.ymd(range.from), Audit.ymd(range.to)).text + " in the books"}</span>
      {/* round 69: once run, the run again is "Recheck all" (the same doAct) */}
      <Act act="auditRun" className="btn small primary">{run ? "Recheck all" : "Run now"}</Act><AuditButton />
      {!lyHere && typeof bridgeLive === "function" && bridgeLive(CO()) && <Act act="auditReadLy" title={d(lyFrom) + " to " + d(lyTo)}>Read last year from Tally, to compare</Act>}
    </div>
    <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: "pointer" }}>Settings and how it works</summary>
      <Confirm id="books:audit-settings" label="Audit settings" stores={["books:auditCfg"]}>
      <p className="note">Every check runs on the vouchers read from Tally. Each finding says what is wrong, what it costs, what to do, and the journal entry where one is needed. Mark each one, then download the report.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}><span className="note">Run on its own</span>
        <select aria-label="Run on its own" style={{ width: "auto" }} value={c.freq} onChange={(ev) => auditFreqSet(ev.target.value)}>
          {[["daily", "every day"], ["weekly", "every week"], ["monthly", "every month"], ["off", "only when I run it"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <p className="note" style={{ marginTop: 6 }}>On its own, it runs the first time this client is opened on a new {({ daily: "day", weekly: "week", monthly: "month" })[c.freq] || "day"}, and each time the day book is read. To run overnight with nobody here, the bridge on the Tally server will have to send the day book on a timer.</p>
      </Confirm>
    </details>
    {run && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {/* clean-up batch 2: Run now is the page's one main button; the downloads under one Download, Finalise plain */}
      <More label="Download" align="start" data-audit-download="" items={[["Download the report (PDF)", () => doAct("auditReport"), { "data-audit-report": "" }], ["Excel with the annexures", () => doAct("auditExcel")],
        ["Tally file of entries to pass (" + Audit.jesToPass(run).length + ")", () => doAct("auditJe")]]} /><Act act="auditFinal">Finalise this report</Act></div>}
    {fin && <div className="bk-alert" style={{ marginTop: 10 }}><b>The report for {d(run.from)} to {d(run.to)} is final</b>{", locked on " + fmtDate(fin.at.slice(0, 10)) + " (result code " + (fin.run.code || "") + "). Later runs track what gets put right, but the final report stays as it was. "}
      <Act act="auditFinalPdf" className="linkbtn">Download the final report</Act> · <Act act="auditUnlock" className="linkbtn">Unlock</Act></div>}
    {/* FinCom 2.4.1: the AI review of the ledgers (TDS section, blocked credit) is here, opened by "AI review of ledgers";
        it was the "AI: TDS and credit" tab of the Tally ledgers page, which has no AI now */}
    {S.auditAi && <div data-audit-ai="" style={{ marginTop: 10 }}><div className="row" style={{ justifyContent: "flex-end" }}><button className="linkbtn" onClick={() => { S.auditAi = false; render(); }}>Close the AI review</button></div><AiLedgers b={b} /></div>}
  </section>;
}

// suggested journal entries: a statement (the lines of each entry stay together, in order)
const Table = ({ head, children }) => <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr>{head}</tr></thead><tbody>{children}</tbody></table></div>;
// the lists: the one list table (spec K6)
const H = (label, role, cls) => ({ label, role, cls });

// what a finding says when opened: effect, what to do, a note, the entries to pass, the entries behind it, what was put right
function FindingBody({ f, st }) {
  const miss = f.je && f.je.length ? Audit.missingLedgers(f.je) : [], sv = Audit.solvedOf(f.id);
  return <div style={{ marginTop: 8 }}>
    <p><b>Effect.</b> {f.impact}</p><p><b>What to do.</b> {f.suggestion}</p>
    <label className="note" style={{ display: "block", margin: "6px 0" }}>Note for the report <CommitBox aria-label="Note for the report" data-fk={"an-" + f.id} value={st.note || ""} style={{ width: "100%" }} placeholder="Management response, or why it is not an issue" onCommit={(v) => auditFindingSet(f.id, "note", v)} /></label>
    {f.je && f.je.length > 0 && <>
      <p><b>Suggested entries</b>{miss.length > 0 && <> <span className="note">— to create in Tally first: {miss.join(", ")}</span></>}</p>
      <Table head={<><th className="dt">Date</th><th>Ledger</th><th className="n">Debit</th><th className="n">Credit</th></>}>
        {f.je.slice(0, 30).flatMap((j, ji) => j.lines.map((l, k) => <tr key={ji + ":" + k}><td>{k ? "" : d(j.date)}</td><td>{(l.cr ? "\u2003To " : "") + l.l}</td><td className="n">{l.dr ? m(l.dr) : ""}</td><td className="n">{l.cr ? m(l.cr) : ""}</td></tr>)
          .concat([<tr key={ji + ":n"}><td></td><td colSpan={3} className="note">({shownNarr(j.narr)})</td></tr>]))}
      </Table>
      {f.je.length > 30 && <p className="note">{f.je.length - 30} more in the Excel.</p>}
      <p className="note">Mark it “Entry to pass” and these go into the Tally file.</p>
    </>}
    {f.rows && f.rows.length > 0 && <>
      <p><b>The entries behind it</b></p>
      <ListRows name={"auditRows-" + f.id} head={[H("Date", "date", "dt"), H("Voucher", "number"), H("Party or ledger", "party"), H("Amount", "amount", "n"), H("Detail")]}>
        {f.rows.slice(0, 100).map((r, i) => <tr key={i}><td>{r.date ? d(r.date) : ""}</td><td>{r.no || ""}{r.type && <div className="nr">{r.type}</div>}</td><td>{r.party || ""}</td><td className="n">{r.amount ? m(r.amount) : ""}</td><td>{r.note || ""}</td></tr>)}
      </ListRows>
      {f.rows.length > 100 && <p className="note">The first 100 of {f.rows.length}; all are in the Excel.</p>}
    </>}
    {sv.n > 0 && <>
      <p><b style={{ color: "var(--ok)" }}>Put right</b> <span className="note">found earlier, gone when checked again</span></p>
      <ListRows name={"auditSolved-" + f.id} head={[H("Date", "date", "dt"), H("Voucher", "number"), H("Party or ledger", "party"), H("Amount", "amount", "n"), H("Put right by")]}>
        {sv.items.slice(-100).map((it, i) => { const r = it.row || {}; return <tr key={i} style={{ color: "var(--muted)" }}><td>{r.date ? d(r.date) : ""}</td><td><s>{r.no || ""}</s></td><td>{r.party || ""}</td><td className="n">{r.amount ? m(r.amount) : ""}</td><td>{fmtDate(String(it.solved).slice(0, 10))}</td></tr>; })}
      </ListRows>
    </>}
  </div>;
}

// round 69 (the owner, 16-Oct-2026: "audit part should like problem and suggestions and recheck.. and it should be in a
// table format properly.. so that anyone can read it properly"): the findings are one table, # | Severity | Area | Problem |
// Suggestion | Status | Recheck, serious first; Details opens what the card showed (FindingBody) under the row
const SEVTAG = { high: "bad", medium: "warn", low: "no" };
const areaName = (a) => (Audit.AREAS.find((x) => x[0] === a) || [])[1] || "";
// a finding's Recheck: the audit again for the same period, quietly (the run of Run now, auditRunFresh, without its
// message), then on the row: still there, or put right (and then it is under Solved too)
function recheck(f) {
  const run = ((S.books || {}).audit || {}).last;
  if (!run) return;
  const co = S.coId, keep = (x) => { S.auditRecheck = Object.assign({}, S.auditRecheck, { [f.id]: Object.assign({ co, f }, x) }); render(); };
  keep({ busy: true });
  FinComNav.go(() => auditRunFresh(run.from, run.to, "recheck").then((r) => keep({ still: r.findings.some((z) => z.id === f.id), at: new Date().toISOString(), run: r.at }), () => keep({ failed: true })));
}
// what a Recheck said holds for the run it made: a later run (Recheck all, another Recheck, a run on its own) clears it
const lastAt = () => (((S.books || {}).audit || {}).last || {}).at;
const recheckOf = (id) => { const x = (S.auditRecheck || {})[id]; return x && x.co === S.coId && (x.busy || x.failed || x.run === lastAt()) ? x : null; };
function RecheckCell({ f }) {
  const x = recheckOf(f.id);
  return <div className="audit-recheck">
    <button type="button" className="btn small" data-audit-recheck={f.id} disabled={!!(x && x.busy)} onClick={() => recheck(f)}>Recheck</button>
    {x && <small className="audit-sub" data-audit-recheck-say={f.id} style={{ color: x.busy ? "var(--muted)" : x.failed ? "var(--bad)" : x.still ? "var(--warn)" : "var(--ok)" }}>
      {x.busy ? "Checking…" : x.failed ? "Could not check; try again" : (x.still ? "Still there" : "Put right ✓") + " · checked " + fmtTime(x.at)}</small>}
  </div>;
}
function FindingsTable({ list, gone }) {
  const rows = list.map((f) => ({ f, gone: false })).concat(gone.map((f) => ({ f, gone: true })));
  const cols = [
    { k: "no", label: "#", role: "row", cls: "n", cell: (r, p, i) => i + 1 },
    { k: "sev", label: "Severity", v: (r) => -Audit.SEV[r.f.sev], cell: (r) => <><span className={"tag " + SEVTAG[r.f.sev]}>{SEV[r.f.sev][0]}</span>
      {r.f.isNew ? <> <span className="tag warn">new</span></> : r.f.more > 0 ? <> <span className="tag warn">+{r.f.more}</span></> : null}</> },
    { k: "area", label: "Area", v: (r) => areaName(r.f.area), cell: (r) => <>{areaName(r.f.area)}{r.f.clause && <small className="audit-sub">{r.f.clause}</small>}</> },
    { k: "prob", label: "Problem", cls: "wrap", cell: (r) => { const f = r.f, open = S.auditOpen === f.id, sv = Audit.solvedOf(f.id).n;
      return <><b className="audit-ftitle">{f.title}</b><div>{f.problem}</div>
        {f.amount ? <small className="audit-sub">{"Amount " + m(f.amount)}</small> : null}
        {sv > 0 && <small className="audit-sub" style={{ color: "var(--ok)" }}>{sv} put right</small>}
        <button type="button" className="linkbtn" style={{ marginTop: 4 }} data-audit-details={f.id} aria-expanded={open ? "true" : "false"} onClick={() => tdsToggle("auditOpen", f.id)}>{(open ? "▾ " : "▸ ") + "Details"}</button></>; } },
    { k: "sug", label: "Suggestion", cls: "wrap", cell: (r) => <><div>{r.f.suggestion}</div>{r.f.impact && <small className="audit-sub">{r.f.impact}</small>}</> },
    { k: "st", label: "Status", cell: (r) => <><select aria-label={"Status of " + r.f.title} style={{ width: "auto", maxWidth: "100%" }} value={Audit.status(r.f.id).s} onChange={(ev) => auditFindingSet(r.f.id, "s", ev.target.value)}>
      {Audit.STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {r.f.je && <small className="audit-sub">{r.f.je.length + " suggested entr" + (r.f.je.length === 1 ? "y" : "ies")}</small>}</> },
    { k: "re", label: "Recheck", role: "act", cell: (r) => <RecheckCell f={r.f} /> },
  ];
  return <div data-phone-scroll="" className="audit-ftable" data-audit-findings="" style={{ marginTop: 10 }}>
    <ListTable name="auditFindings" cols={cols} rows={rows} rowKey={(r) => r.f.id} unit={["finding", "findings"]}
      rowProps={(r) => ({ "data-key": r.f.id, "data-audit-gone": r.gone ? "" : undefined, style: r.gone ? { opacity: 0.75 } : undefined })}
      after={(r) => (S.auditOpen === r.f.id ? <div style={{ padding: "4px 14px 12px" }} data-audit-body={r.f.id}><FindingBody f={r.f} st={Audit.status(r.f.id)} /></div> : null)}
      empty="Nothing here. Choose Every status above, or run the audit again." />
  </div>;
}

function Findings({ b }) {
  const au = b.audit || {}, run = au.last;
  if (!run) return <><Head b={b} run={run} /><div className="bk-none" data-audit-empty="" style={{ marginTop: 12 }}>Not run yet for this period. <button className="linkbtn" onClick={() => FinComNav.go(() => doAct("auditRun"))}>Run now</button></div></>;
  // a run that no longer fits the books (other entries for its period, or the books or FinCom's checks changed) is worked
  // out again by itself for the same period, as MIS is; its old findings are not shown meanwhile (review of 02-Oct-2026:
  // "worked out on 1231 entries… the books now hold 4" asked the user to press Run again)
  // (round 69: not while a finding's Recheck is running: that run is the one worked out again, and the table stays meanwhile)
  if (Audit.stale(run) && !Object.values(S.auditRecheck || {}).some((x) => x.busy && x.co === S.coId)) {
    if (!Audit._again) { Audit._again = true; setTimeout(() => { try { Audit.run(run.from, run.to, "worked out again (the books changed since the run of " + fmtDate(String(run.at || "").slice(0, 10)) + ")"); saveBooks(); } catch (e) {} finally { Audit._again = false; render(); } }, 0); }
    return <><Head b={b} run={null} /><div className="bk-none" data-audit-again="" style={{ marginTop: 12 }}>{"Working out again for " + d(run.from) + " to " + d(run.to) + ": the books changed since the last run."}</div></>;
  }
  const f0 = run.findings, sev = (s) => f0.filter((f) => f.sev === s), sum = (l) => l.reduce((s, f) => s + f.amount, 0);
  const open = f0.filter((f) => Audit.status(f.id).s === "open").length, fresh = f0.filter((f) => f.isNew).length;
  const area = S.auditArea || "", fs = S.auditSt || "", list = f0.filter((f) => (!area || f.area === area) && (!fs || Audit.status(f.id).s === fs));
  const gone = (run.solved || []).filter((x) => x.n && !f0.some((f) => f.id === x.id) && (!area || x.area === area));
  // a finding put right by its Recheck stays on its row, saying so (round 69)
  const reGone = Object.values(S.auditRecheck || {}).filter((x) => x.co === S.coId && x.f && x.run === run.at && !x.still && !f0.some((f) => f.id === x.f.id)).map((x) => x.f)
    .filter((f) => (!area || f.area === area) && (!fs || Audit.status(f.id).s === fs));
  // the period, the last run and the tiles; then the findings with their filters (clean-up batch 3: the areas are a row of
  // chips beside the status, not a second row of tabs)
  return <>
    <Head b={b} run={run} />
    {/* clean-up batch 2: the run in one line; its result code and notes under Details */}
    <div className="note audit-runline" data-audit-runline="" style={{ margin: "10px 0" }}>{"Last run on " + fmtDateTime(run.at) + " (" + Audit.howLabel(run) + ") for " + d(run.from) + " to " + d(run.to) + ", " + run.vouchers + " vouchers. "}
      {(run.errors || []).length > 0 && <><span className="bad">Some checks could not run: {run.errors.join("; ")}</span>{" "}</>}
      <details className="inline-more" style={{ display: "inline" }}><summary className="linkbtn" style={{ display: "inline", cursor: "pointer" }}>Details</summary>
        <span>{" Result code "}<b>{run.code || ""}</b>{": the same books always give the same code." + (run.balances ? " Balances from " + run.balances + "." : "") + ((run.notes || []).length ? " " + run.notes.join(" ") : "")}</span></details></div>
    <div className="dash-tiles audit-tiles">
      <div className={"dtile" + (sev("high").length ? " warn" : "")}><span>Serious</span><b>{sev("high").length}</b><small>{m(sum(sev("high")))} involved</small></div>
      <div className="dtile"><span>To look at</span><b>{sev("medium").length}</b><small>{m(sum(sev("medium")))}</small></div>
      <div className="dtile"><span>Minor</span><b>{sev("low").length}</b><small>for good books</small></div>
      <div className="dtile"><span>Still open</span><b>{open}</b><small>{"of " + f0.length + " findings" + (fresh ? ", " + fresh + " new since the last run" : "")}</small></div>
      <div className="dtile"><span>Put right</span><b>{(run.solved || []).reduce((s2, x) => s2 + x.n, 0)}</b><small>items found earlier and gone when checked again</small></div>
    </div>
    <div className="audit-filters" data-audit-filters="">
      <div className="chip-filter" role="group" aria-label="Areas" data-audit-areas=""><button aria-pressed={!area} onClick={() => setAndShow("auditArea", "")}>All <span className="sbar-n">{f0.length}</span></button>
        {Audit.AREAS.map(([a, l]) => { const n = f0.filter((f) => f.area === a).length; return n ? <button key={a} aria-pressed={area === a} onClick={() => setAndShow("auditArea", a)}>{l} <span className="sbar-n">{n}</span></button> : null; })}</div>
      <div className="revfilter"><select aria-label="Status" style={{ width: "auto" }} value={fs} onChange={(ev) => setAndShow("auditSt", ev.target.value)}><option value="">Every status</option>{Audit.STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div></div>
    <FindingsTable list={list} gone={reGone} />
    {gone.length > 0 && <section className="dash-card" style={{ marginTop: 12, borderLeft: "4px solid var(--ok)" }}><h3 style={{ color: "var(--ok)" }}>Solved</h3><p className="note">Every item of these was put right in the books.</p>
      <ListRows name="auditGone" unit={["observation", "observations"]} head={[H("Observation"), { label: "Items", cls: "n", sum: true, fmt: String }, H("Amount", "amount", "n"), H("Last put right", "date")]}>
        {gone.map((x, i) => <tr key={x.id + ":" + i}><td>{x.title}</td><td className="n">{x.n}</td><td className="n">{m(x.amount)}</td><td>{fmtDate(String(x.items[x.items.length - 1].solved).slice(0, 10))}</td></tr>)}</ListRows></section>}
    {(au.history || []).length > 1 && <section className="dash-card" style={{ marginTop: 12 }}><h3>Earlier runs</h3>
      <ListRows name="auditRuns" unit={["run", "runs"]} head={[H("Run on", "date"), H("How"), H("Period"), { label: "Findings", cls: "n", sum: false }, { label: "Serious", cls: "n", sum: false }, H("Amount involved", "amount", "n")]}>
        {au.history.slice(0, 12).map((x, i) => <tr key={i}><td>{fmtDateTime(x.at)}</td><td>{x.how}</td><td>{d(x.from) + " to " + d(x.to)}</td><td className="n">{x.n}</td><td className="n">{x.high}</td><td className="n">{m(x.amount)}</td></tr>)}</ListRows></section>}
  </>;
}

function Related({ b }) {
  const rel = b.auditRel || [], guess = Audit.relatedGuess(), pans = b.pans || {};
  return <Confirm id="books:audit-related" label="Related parties" stores={["books:auditRel"]}>
    <section className="dash-card"><h3>Related parties</h3>
      <p className="note">Directors, partners, their relatives, and the concerns they control. Transactions with them feed clause 23 (section 40A(2)(b)), clause 36A (deemed dividend), and the related-party note. The audit only uses the people listed here.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
        <input type="search" id="relq" list="relList" aria-label="Type a ledger name" data-fk="relq" placeholder="Type a ledger name" style={{ width: 300 }} />
        <datalist id="relList">{Object.keys(Object.assign({}, b.ledInfo || {}, b.map || {})).sort().slice(0, 3000).map((n) => <option key={n} value={n} />)}</datalist>
        <Act act="relAddTyped">Add</Act></div>
      {rel.length ? <ListRows name="auditRelated" unit={["party", "parties"]} head={[H("Ledger in Tally", "party"), H("PAN"), H("Relation", "status"), H("", "act", "ac")]}>
        {rel.map((x, i) => <tr key={x.name + ":" + i} data-key={x.name}><td>{x.name}</td><td>{pans[x.name] || "—"}</td>
          <td><select aria-label={"Relation of " + x.name} style={{ width: "auto" }} value={x.relation || ""} onChange={(ev) => relSet(x.name, ev.target.value)}><option value="">choose</option>{REL.map((r) => <option key={r}>{r}</option>)}</select></td>
          <td className="ac"><button className="linkbtn" onClick={() => relRemove(x.name)}>remove</button></td></tr>)}</ListRows> : <p className="note lt-empty" data-list-empty="" style={{ border: 0 }}>No one listed yet. Type a ledger name above and use Add, or add one of those found below.</p>}
    </section>
    {guess.length > 0 && <section className="dash-card" style={{ marginTop: 12 }}><h3>Possibly related</h3><p className="note">Found in the ledgers by where they sit or what they are called. Add the ones that are related.</p>
      <div className="bk-tablewrap"><table className="bk-table" data-statement=""><tbody>{guess.map((g, i) => <tr key={g.name + ":" + i} data-key={g.name}><td>{g.name}<div className="nr">{g.why}</div></td><td>{pans[g.name] || ""}</td>
        <td className="ac"><button className="btn small" onClick={() => relAdd(g.name)}>Add</button></td></tr>)}</tbody></table></div></section>}
  </Confirm>;
}

// the Form 3CD draft, filled from the last run: Audit.form3cdHtml is also the PDF's template, so it stays HTML
function Form3cd({ b }) {
  const run = (b.audit || {}).last;
  if (!run) return <div className="bk-none">The draft is filled from the audit, which has not been run yet. <button className="linkbtn" onClick={() => setAndShow("auditTab", "find")}>Open Findings</button></div>;
  return <section className="dash-card"><div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}><More label="Download" align="start" data-audit3cd-download="" items={[["Download the draft (PDF)", () => doAct("audit3cdPdf")], ["Excel", () => doAct("audit3cdExcel")]]} /></div>
    <div className="audit3cd"><Legacy html={Audit.form3cdHtml(Audit.form3cd(run)).replace(/<table>/g, '<div class="bk-tablewrap"><table class="bk-table" data-statement="">').replace(/<\/table>/g, "</table></div>")} /></div></section>;
}

// named Audit_ so the audit checks (the global Audit) stay in reach inside this file
export default function Audit_({ b }) {
  // Tally changed since the last run: the tab says so while it is worked out again (TallyRead.catchUp, src/js/18)
  const catchUp = TallyRead.catchUp(b, "audit");
  if (catchUp) return <CatchUp text={catchUp} />;
  const t = S.auditTab || "find";
  return <><Tabs />{t === "rel" ? <Related b={b} /> : t === "3cd" ? <Form3cd b={b} /> : t === "wp" ? <WorkingPapers b={b} /> : <Findings b={b} />}</>;
}
