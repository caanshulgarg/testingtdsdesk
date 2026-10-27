// Reading bills: the queue of files being read, the check of what can read them, the upload option, and the
// "reading…" cards above a client's work. Was viewJobs, readingCheck, uploadOptions, billsBusyCard, docsBusyCard
// in src/js/01; the reading itself (pump, jobAction, ...) stays there.
import { useState } from "react";
import ReadBadge from "./ReadBadge.jsx";

export function BusyCard({ title, detail, done, total }) {
  const pct = total ? Math.round(Math.min(1, done / total) * 100) : null;
  const m = pct === null && detail ? String(detail).match(/(?:page )?(\d+) of (\d+)/i) : null;
  const p2 = m ? Math.round((m[1] / m[2]) * 100) : pct;
  return (
    <div className="busycard" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div className="busytext">
        <b>{title}</b>{detail && <span className="note">{detail}</span>}
        {p2 !== null && <div className="busybar"><i style={{ width: p2 + "%" }} /></div>}
      </div>
      {total ? <span className="busyn">{num(done)} / {num(total)}</span> : null}
    </div>
  );
}

const BUSY = ["waiting", "checking", "reading"];
// above a client's work: the bills being read for it, and documents being saved to the firm account
export function Working() {
  const mine = (S.jobs || []).filter((j) => j.cid === S.coId || j.target === S.coId || j.target === "auto");
  const busy = mine.filter((j) => BUSY.includes(j.status)), n = CloudDocs.queue.length;
  let bills = null;
  if (busy.length) {
    const now = busy.find((j) => j.status === "reading") || busy[0];
    const stage = now.msg || { waiting: "waiting its turn", checking: "checking whether it was uploaded before", reading: "reading it" }[now.status] || "";
    const secs = now.startedAt ? Math.round((Date.now() - now.startedAt) / 1000) : 0;
    bills = <BusyCard title={"Reading " + (busy.length === 1 ? "a bill" : busy.length + " bills") + "…"} detail={now.name + " · " + stage + (secs > 3 ? " · " + secs + "s" : "")} done={mine.length - busy.length} total={mine.length} />;
  }
  return <>
    {bills}
    {n > 0 && <BusyCard title={"Saving " + n + " document" + (n === 1 ? "" : "s") + " to the firm account…"} detail="This happens in the background; you can carry on." done={0} total={0} />}
  </>;
}

const LABEL = { waiting: ["Waiting", "no"], checking: ["Checking", "no"], reading: ["Reading", "no"], done: ["Done", "ok"], held: ["Held: duplicate", "warn"],
  duplicate: ["Not uploaded: duplicate", "warn"], failed: ["Could not read", "bad"], partial: ["Partly read", "warn"], unsorted: ["Unsorted", "warn"], typed: ["Typed in", "ok"],
  notread: ["Not read yet: in To review", "bad"] };

// the files being read or read lately. which: "auto" (uploads for any client) or a client's id
export function Jobs({ which }) {
  const jobs = S.jobs.filter((j) => which === "auto" ? j.target === "auto" : j.target === which || j.cid === which || j.target === "auto");
  if (!jobs.length) return null;
  const n = (st) => jobs.filter((j) => j.status === st).length, busy = n("waiting") + n("checking") + n("reading");
  const by = (re) => jobs.filter((j) => re.test(j.method || "")).length;
  const summary = [n("done") + n("typed") ? n("done") + n("typed") + " added" : "", by(/^free-/) ? by(/^free-/) + " free" : "", by(/claude/) ? by(/claude/) + " by Claude" : "",
    n("duplicate") + n("held") ? n("duplicate") + n("held") + " duplicate" : "", n("failed") ? n("failed") + " failed" : "", n("unsorted") ? n("unsorted") + " unsorted" : ""].filter(Boolean).join(" · ");
  return (
    <div className="jobs">
      <div className="jobshead">
        <b>{busy ? "Reading " + (jobs.length - busy) + " of " + jobs.length + "…" : jobs.length + " file" + (jobs.length === 1 ? "" : "s") + " processed"}</b>
        <span className="note">{summary}</span>
        {!busy && <button className="btn small" onClick={() => doAct("clearJobs")}>Clear list</button>}
      </div>
      {busy > 0 && <div className="bar jobbar"><div className="add" style={{ left: 0, width: Math.round(((jobs.length - busy) / jobs.length) * 100) + "%" }} /></div>}
      <ul className="joblist">
        {jobs.slice().reverse().map((j) => {
          const [t, cls] = LABEL[j.status] || [j.status, "no"], again = j.status === "failed" || j.status === "partial";
          const canOpen = (j.status === "duplicate" && j.dupRef && j.dupRef.cid) || (["held", "done", "typed", "notread"].includes(j.status) && j.entryId);
          const act = (kind) => () => jobAction(kind, j.id);
          return (
            <li key={j.id}>
              <div className="jn">
                <span className="jname">{j.name}{j.method && <> <ReadBadge mode={READ_LABELS[j.method] || j.method} /></>}</span>
                <span className={"tag " + cls}>{(j.status === "reading" || j.status === "checking") && <span className="dot sm" />}{t}</span>
              </div>
              {j.msg && <div className="note">{j.msg}</div>}
              {(again || canOpen) && <div className="row" style={{ gap: 6, marginTop: 4 }}>
                {again && <>
                  <button className="btn small" onClick={act("retry")}>Read again</button>
                  <button className="btn small" onClick={act("google")} disabled={!googleReady()}>With Google OCR</button>
                  <button className="btn small" onClick={act("claude")} disabled={!claudeReady()}>With Claude</button>
                  {j.status === "failed" && <button className="btn small" onClick={act("type")}>Type it in</button>}
                </>}
                {canOpen && <button className="btn small" onClick={act("open")}>Open</button>}
              </div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// what can read bills here, in small tags, with a link to the reading check in Settings
export function ReadingCheck() {
  const ocr = { idle: ["no", "Free OCR: checking…"], available: ["ok", S.ocrKind === "built-in" ? "Free OCR: built in" : "Free OCR: available"], loading: ["no", "Free OCR: loading…"],
    ready: ["ok", "Free OCR: working"], unavailable: ["bad", "Free OCR: blocked here"] }[S.ocrState] || ["no", "Free OCR"];
  const cl = !S.sampleReady ? ["no", "Claude: checking…"] : viaPlatform() ? ["ok", "Claude: in your plan"] : S.engine === "api" ? ["ok", "Claude: your API key"]
    : S.engine === "claude" ? (S.readBlocked || S.samplePerm === "denied" ? ["bad", "Claude: access declined"] : ["ok", "Claude: available"]) : ["bad", "Claude: not set up"];
  const pdf = window.pdfjsLib || window.TDS_ASSETS ? ["ok", "PDF text: free"] : ["bad", "PDF reader missing"];
  const sum = selfTestSummary();
  const selfT = sum.state === "ok" ? ["ok", "Self-test: passed"] : sum.state === "fail" ? ["bad", "Self-test: failed"] : sum.state === "busy" ? ["no", "Self-test: running…"] : null;
  const google = !hasGoogle() ? null : (S.googleAuto && !S.googleAuto.ok) || (S.googleLast && !S.googleLast.ok) ? ["bad", "Google OCR: not working"]
    : S.googleAuto && S.googleAuto.ok ? ["ok", "Google OCR: working"] : ["ok", "Google OCR: set up"];
  const tags = (selfT ? [selfT] : []).concat([pdf, ocr, cl], google ? [google] : []);
  return (
    <div className="rcheck">
      {tags.map(([c, t]) => <span key={t}><span className={"tag " + c}>{t}</span>{" "}</span>)}
      <button className="linkbtn" onClick={() => doAct("goReading")}>Reading check</button>
    </div>
  );
}

export function UploadOptions() {
  const [on, setOn] = useState(!!S.splitPdf);
  return (
    <label className="chk small">
      <input type="checkbox" checked={on} onChange={(e) => { setSplitPdf(e.target.checked); setOn(e.target.checked); }} /> A PDF holds many bills: read each page as a separate bill
    </label>
  );
}
