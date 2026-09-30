// The Audit tab of a client's books: findings from rule-based checks of the day book (each with its effect, what to do
// and the journal entry to pass), related parties, and the Form 3CD draft filled from the run. Was viewBooksAudit,
// auditTabs, viewAuditRel and viewAudit3cd (src/js/18). The checks are Audit (src/js/06); changes go through
// auditRangeSet, auditFreqSet, auditFindingSet, relAdd, relSet, relRemove (src/js/23) and doAct (auditRun, auditReport…).
//
// State: S.auditTab (find, rel, 3cd), S.auditRange, S.auditArea, S.auditSt (a status), S.auditOpen (a finding opened).
import Legacy from "../../parts/Legacy.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import { AuditButton } from "../../parts/Ai.jsx";

const m = (v) => INR.format(r2(v || 0));
const d = (x) => fmtDate(tallyDate(x));
const SEV = { high: ["SERIOUS", "#B42318"], medium: ["TO LOOK AT", "#B9541B"], low: ["MINOR", "#5A6B63"] };
const REL = ["Director", "Relative of a director", "Partner or proprietor", "Shareholder with 10% or more", "Company or firm they control", "Key manager", "Other"];
const Act = ({ act, className = "btn small", children, title }) => <button className={className} title={title} onClick={() => doAct(act)}>{children}</button>;

function Tabs() {
  const t = S.auditTab || "find";
  return <nav className="sbar" aria-label="Audit" style={{ marginBottom: 10 }}>{[["find", "Findings"], ["rel", "Related parties"], ["3cd", "Form 3CD draft"]].map(([id, l]) =>
    <button key={id} aria-selected={t === id} onClick={() => setAndShow("auditTab", id)}>{l}</button>)}</nav>;
}

// the period, run now, how often by itself, and the report once run
function Head({ b, run }) {
  const c = Audit.cfg(b), dr = Audit.defaultRange(b), range = S.auditRange || { from: Audit.iso(dr.from), to: Audit.iso(dr.to) };
  const lyFrom = MIS.shift(Audit.ymd(range.from), -1), lyTo = MIS.shift(Audit.ymd(range.to), -1), lyHere = MIS.covered(lyFrom);
  const fin = run && Audit.finalFor(run.from, run.to);
  return <section className="dash-card"><h3>Audit of the books</h3>
    <p className="note">Every check runs on the vouchers read from Tally. Each finding says what is wrong, what it costs, what to do, and the journal entry where one is needed. Mark each one, then download the report.</p>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <label className="note">From <input type="date" aria-label="Audit from" defaultValue={range.from} onChange={(ev) => auditRangeSet("from", ev.target.value)} /></label>
      <label className="note">to <input type="date" aria-label="Audit to" defaultValue={range.to} onChange={(ev) => auditRangeSet("to", ev.target.value)} /></label>
      <Act act="auditRun" className="btn small primary">Run now</Act><AuditButton />
      {!lyHere && typeof bridgeLive === "function" && bridgeLive(CO()) && <Act act="auditReadLy" title={d(lyFrom) + " to " + d(lyTo)}>Read last year from Tally, to compare</Act>}
      <span className="note" style={{ marginLeft: 12 }}>Run on its own</span>
      <select aria-label="Run on its own" style={{ width: "auto" }} value={c.freq} onChange={(ev) => auditFreqSet(ev.target.value)}>
        {[["daily", "every day"], ["weekly", "every week"], ["monthly", "every month"], ["off", "only when I run it"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
    <p className="note" style={{ marginTop: 6 }}>On its own, it runs the first time this client is opened on a new {({ daily: "day", weekly: "week", monthly: "month" })[c.freq] || "day"}, and each time the day book is read. To run overnight with nobody here, the bridge on the Tally server will have to send the day book on a timer.</p>
    {run && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <Act act="auditReport" className="btn small primary">Download the report (PDF)</Act><Act act="auditExcel">Excel with the annexures</Act>
      <Act act="auditJe">Tally file of entries to pass ({Audit.jesToPass(run).length})</Act><Act act="auditFinal">Finalise this report</Act></div>}
    {fin && <div className="bk-alert" style={{ marginTop: 10 }}><b>The report for {d(run.from)} to {d(run.to)} is final</b>{", locked on " + fmtDate(fin.at.slice(0, 10)) + " (result code " + (fin.run.code || "") + "). Later runs track what gets put right, but the final report stays as it was. "}
      <Act act="auditFinalPdf" className="linkbtn">Download the final report</Act> · <Act act="auditUnlock" className="linkbtn">Unlock</Act></div>}
  </section>;
}

const Table = ({ head, children }) => <div className="bk-tablewrap"><table className="bk-table"><thead><tr>{head}</tr></thead><tbody>{children}</tbody></table></div>;

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
          .concat([<tr key={ji + ":n"}><td></td><td colSpan={3} className="note">({j.narr})</td></tr>]))}
      </Table>
      {f.je.length > 30 && <p className="note">{f.je.length - 30} more in the Excel.</p>}
      <p className="note">Mark it “Entry to pass” and these go into the Tally file.</p>
    </>}
    {f.rows && f.rows.length > 0 && <>
      <p><b>The entries behind it</b></p>
      <Table head={<><th className="dt">Date</th><th>Voucher</th><th>Party or ledger</th><th className="n">Amount</th><th>Detail</th></>}>
        {f.rows.slice(0, 100).map((r, i) => <tr key={i}><td>{r.date ? d(r.date) : ""}</td><td>{r.no || ""}{r.type && <div className="nr">{r.type}</div>}</td><td>{r.party || ""}</td><td className="n">{r.amount ? m(r.amount) : ""}</td><td>{r.note || ""}</td></tr>)}
      </Table>
      {f.rows.length > 100 && <p className="note">The first 100 of {f.rows.length}; all are in the Excel.</p>}
    </>}
    {sv.n > 0 && <>
      <p><b style={{ color: "#1F7A4D" }}>Put right</b> <span className="note">found earlier, gone when checked again</span></p>
      <Table head={<><th className="dt">Date</th><th>Voucher</th><th>Party or ledger</th><th className="n">Amount</th><th>Put right by</th></>}>
        {sv.items.slice(-100).map((it, i) => { const r = it.row || {}; return <tr key={i} style={{ color: "#5A6B63" }}><td>{r.date ? d(r.date) : ""}</td><td><s>{r.no || ""}</s></td><td>{r.party || ""}</td><td className="n">{r.amount ? m(r.amount) : ""}</td><td>{fmtDate(String(it.solved).slice(0, 10))}</td></tr>; })}
      </Table>
    </>}
  </div>;
}

function Finding({ f }) {
  const st = Audit.status(f.id), open = S.auditOpen === f.id, [word, col] = SEV[f.sev], solved = Audit.solvedOf(f.id).n;
  return <section className="dash-card" data-key={f.id} style={{ marginTop: 10, borderLeft: "4px solid " + col }}>
    <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div className="nr" style={{ color: col, fontWeight: 700 }}>{word + " · " + ((Audit.AREAS.find((a) => a[0] === f.area) || [])[1] || "") + (f.clause ? " · " + f.clause : "")}
          {f.isNew ? <> <span className="tag warn">new</span></> : f.more > 0 ? <> <span className="tag warn">+{f.more}</span></> : null}</div>
        <button className="linkbtn" style={{ fontSize: 16, fontWeight: 600, textAlign: "left" }} onClick={() => tdsToggle("auditOpen", f.id)}>{(open ? "▾ " : "▸ ") + f.title}</button>
        <div className="note">{f.problem + (f.amount ? " · ₹" + m(f.amount) : "")}{solved > 0 && <> · <span style={{ color: "#1F7A4D" }}>{solved} put right</span></>}</div>
      </div>
      <div><select aria-label={"Status of " + f.title} style={{ width: "auto" }} value={st.s} onChange={(ev) => auditFindingSet(f.id, "s", ev.target.value)}>{Audit.STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {f.je && <div className="nr">{f.je.length + " suggested entr" + (f.je.length === 1 ? "y" : "ies")}</div>}</div>
    </div>
    {open && <FindingBody f={f} st={st} />}
  </section>;
}

function Findings({ b }) {
  const au = b.audit || {}, run = au.last;
  if (!run) return <><Head b={b} run={run} /><div className="bk-none" style={{ marginTop: 12 }}>Not run yet. Choose the period and press Run now.</div></>;
  const f0 = run.findings, sev = (s) => f0.filter((f) => f.sev === s), sum = (l) => l.reduce((s, f) => s + f.amount, 0);
  const open = f0.filter((f) => Audit.status(f.id).s === "open").length, fresh = f0.filter((f) => f.isNew).length;
  const area = S.auditArea || "", fs = S.auditSt || "", list = f0.filter((f) => (!area || f.area === area) && (!fs || Audit.status(f.id).s === fs));
  const gone = (run.solved || []).filter((x) => x.n && !f0.some((f) => f.id === x.id) && (!area || x.area === area));
  return <>
    <Head b={b} run={run} />
    <p className="note" style={{ margin: "10px 0" }}>{"Last run " + run.how + " on " + fmtDate(run.at.slice(0, 10)) + " at " + run.at.slice(11, 16) + " for " + d(run.from) + " to " + d(run.to) + ", " + run.vouchers + " vouchers. Result code "}
      <b>{run.code || ""}</b>{": the same books always give the same code." + (run.balances ? " Balances from " + run.balances + "." : "") + (run.notes.length ? " " + run.notes.join(" ") : "")}
      {run.errors.length > 0 && <>{" "}<span className="bad">Some checks could not run: {run.errors.join("; ")}</span></>}</p>
    <div className="dash-tiles">
      <div className={"dtile" + (sev("high").length ? " warn" : "")}><span>Serious</span><b>{sev("high").length}</b><small>{m(sum(sev("high")))} involved</small></div>
      <div className="dtile"><span>To look at</span><b>{sev("medium").length}</b><small>{m(sum(sev("medium")))}</small></div>
      <div className="dtile"><span>Minor</span><b>{sev("low").length}</b><small>for good books</small></div>
      <div className="dtile"><span>Still open</span><b>{open}</b><small>{"of " + f0.length + " findings" + (fresh ? ", " + fresh + " new since the last run" : "")}</small></div>
      <div className="dtile"><span>Put right</span><b>{(run.solved || []).reduce((s2, x) => s2 + x.n, 0)}</b><small>items found earlier and gone when checked again</small></div>
    </div>
    <nav className="sbar" aria-label="Areas"><button aria-selected={!area} onClick={() => setAndShow("auditArea", "")}>All <span className="sbar-n">{f0.length}</span></button>
      {Audit.AREAS.map(([a, l]) => { const n = f0.filter((f) => f.area === a).length; return n ? <button key={a} aria-selected={area === a} onClick={() => setAndShow("auditArea", a)}>{l} <span className="sbar-n">{n}</span></button> : null; })}</nav>
    <div className="revfilter"><select aria-label="Status" style={{ width: "auto" }} value={fs} onChange={(ev) => setAndShow("auditSt", ev.target.value)}><option value="">Every status</option>{Audit.STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
    {list.map((f, i) => <Finding key={f.id + ":" + i} f={f} />)}
    {!list.length && <div className="bk-none" style={{ marginTop: 10 }}>Nothing here.</div>}
    {gone.length > 0 && <section className="dash-card" style={{ marginTop: 12, borderLeft: "4px solid #1F7A4D" }}><h3 style={{ color: "#1F7A4D" }}>Solved</h3><p className="note">Every item of these was put right in the books.</p>
      <Table head={<><th>Observation</th><th className="n">Items</th><th className="n">Amount</th><th>Last put right</th></>}>
        {gone.map((x, i) => <tr key={x.id + ":" + i}><td>{x.title}</td><td className="n">{x.n}</td><td className="n">{m(x.amount)}</td><td>{fmtDate(String(x.items[x.items.length - 1].solved).slice(0, 10))}</td></tr>)}</Table></section>}
    {(au.history || []).length > 1 && <section className="dash-card" style={{ marginTop: 12 }}><h3>Earlier runs</h3>
      <Table head={<><th>Run on</th><th>How</th><th>Period</th><th className="n">Findings</th><th className="n">Serious</th><th className="n">Amount involved</th></>}>
        {au.history.slice(0, 12).map((x, i) => <tr key={i}><td>{fmtDate(x.at.slice(0, 10)) + " " + x.at.slice(11, 16)}</td><td>{x.how}</td><td>{d(x.from) + " to " + d(x.to)}</td><td className="n">{x.n}</td><td className="n">{x.high}</td><td className="n">{m(x.amount)}</td></tr>)}</Table></section>}
  </>;
}

function Related({ b }) {
  const rel = b.auditRel || [], guess = Audit.relatedGuess(), pans = b.pans || {};
  return <>
    <section className="dash-card"><h3>Related parties</h3>
      <p className="note">Directors, partners, their relatives, and the concerns they control. Transactions with them feed clause 23 (section 40A(2)(b)), clause 36A (deemed dividend), and the related-party note. The audit only uses the people listed here.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
        <input type="search" id="relq" list="relList" aria-label="Type a ledger name" data-fk="relq" placeholder="Type a ledger name" style={{ width: 300 }} />
        <datalist id="relList">{Object.keys(Object.assign({}, b.ledInfo || {}, b.map || {})).sort().slice(0, 3000).map((n) => <option key={n} value={n} />)}</datalist>
        <Act act="relAddTyped">Add</Act></div>
      {rel.length ? <Table head={<><th>Ledger in Tally</th><th>PAN</th><th>Relation</th><th className="ac"></th></>}>
        {rel.map((x, i) => <tr key={x.name + ":" + i} data-key={x.name}><td>{x.name}</td><td>{pans[x.name] || "—"}</td>
          <td><select aria-label={"Relation of " + x.name} style={{ width: "auto" }} value={x.relation || ""} onChange={(ev) => relSet(x.name, ev.target.value)}><option value="">choose</option>{REL.map((r) => <option key={r}>{r}</option>)}</select></td>
          <td className="ac"><button className="linkbtn" onClick={() => relRemove(x.name)}>remove</button></td></tr>)}</Table> : <p className="note">No one listed yet.</p>}
    </section>
    {guess.length > 0 && <section className="dash-card" style={{ marginTop: 12 }}><h3>Possibly related</h3><p className="note">Found in the ledgers by where they sit or what they are called. Add the ones that are related.</p>
      <div className="bk-tablewrap"><table className="bk-table"><tbody>{guess.map((g, i) => <tr key={g.name + ":" + i} data-key={g.name}><td>{g.name}<div className="nr">{g.why}</div></td><td>{pans[g.name] || ""}</td>
        <td className="ac"><button className="btn small" onClick={() => relAdd(g.name)}>Add</button></td></tr>)}</tbody></table></div></section>}
  </>;
}

// the Form 3CD draft, filled from the last run: Audit.form3cdHtml is also the PDF's template, so it stays HTML
function Form3cd({ b }) {
  const run = (b.audit || {}).last;
  if (!run) return <div className="bk-none">Run the audit first (Findings → Run now); the draft is filled from it.</div>;
  return <section className="dash-card"><div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}><Act act="audit3cdPdf" className="btn small primary">Download the draft (PDF)</Act><Act act="audit3cdExcel">Excel</Act></div>
    <div className="audit3cd"><Legacy html={Audit.form3cdHtml(Audit.form3cd(run)).replace(/<table>/g, '<div class="bk-tablewrap"><table class="bk-table">').replace(/<\/table>/g, "</table></div>")} /></div></section>;
}

// named Audit_ so the audit checks (the global Audit) stay in reach inside this file
export default function Audit_({ b }) {
  // Tally changed since the last run: the tab says so while it is worked out again (TallyRead.catchUp, src/js/18)
  const catchUp = TallyRead.catchUp(b, "audit");
  if (catchUp) return <Legacy html={catchUp} />;
  const t = S.auditTab || "find";
  return <><Tabs />{t === "rel" ? <Related b={b} /> : t === "3cd" ? <Form3cd b={b} /> : <Findings b={b} />}</>;
}
