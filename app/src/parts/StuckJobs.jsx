// next-fix-stuck-jobs (07-Nov-2026; the owner's computer: a posting job that failed in FinCom's cloud on 05-Nov, or one
// the page handed over itself, stayed "active" in FinCom Bridge, and the bridge read no ledgers for hours: keepWait
// "Waiting: a posting into Tally is going on."). Bridge 2.5.5 lists its active postings (GET /jobs: id, company, status,
// message) and stops one (POST /jobs/cancel {id}: nothing is sent to Tally for it; a done job is left alone).
//   - Only where this computer's own bridge answers (Bridge.up): from a Mac nothing shows and nothing is asked.
//   - Asked once a page, and again (at most every 30 s) while the bridge says it waits for a posting.
//   - Cleared by itself only when FinCom's cloud has the same job (tally_post_jobs, the bridge takes a cloud job under its
//     id) as done or failed, and not checking: that job is over, the bridge's copy is stale. A job the cloud shows
//     waiting, taken or running, or one it has no row for (a posting the page handed over itself), only gets Cancel,
//     with "Stop this posting? Nothing more is sent to Tally for it."
//   - "Waiting for a posting on this computer: <company> · <status>" beside Update now and in the Tally page's top line,
//     with See postings: the list, a Cancel each.
// Nothing new is asked of Tally.
import { useEffect, useState } from "react";

const J = { list: null, at: 0, busy: false, cleared: [], err: "" };
if (typeof window === "object") window.FCStuckJobs = J;
const here = () => { try { return typeof Bridge === "object" && !!Bridge.up() && !!Bridge.on(); } catch (e) { return false; } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* */ } };
// the bridge's own keepWait (its /status, else its beat in FinCom's cloud) says a posting holds the reading
export const postingWait = (beat) => {
  const k = (typeof Bridge === "object" && Bridge.st && Bridge.st.keepWait) || (beat && beat.keepWait) || null;
  return !!(k && k.reason === "posting");
};
function dropLocal(id) {
  try { const m = JSON.parse(localStorage.getItem("tdsdesk:bridgejob") || "null"); if (m && m.id === id) localStorage.removeItem("tdsdesk:bridgejob"); } catch (e) { /* */ }
}
export async function cancelJob(id) {
  await Bridge.call("/jobs/cancel", { id }, 15000);
  dropLocal(id);
  J.list = (J.list || []).filter((j) => j.id !== id);
}
// the bridge's active postings, and the stale ones cleared (see above); force: asked now
export async function jobsLook(force) {
  if (!here() || J.busy || (!force && J.at && Date.now() - J.at < 30000)) return J.list;
  J.busy = true;
  try {
    const r = await Bridge.call("/jobs", null, 8000);
    let list = [].concat((r && r.jobs) || []).filter((j) => j && j.id);
    const ids = list.map((j) => String(j.id)).filter((id) => UUID.test(id));
    let rows = [];
    if (ids.length && typeof TCloud === "object" && TCloud.on && TCloud.on() && TCloud.restAll) {
      try { rows = await TCloud.restAll("tally_post_jobs?select=id,status,checking&id=in.(" + ids.join(",") + ")"); } catch (e) { rows = null; }
    }
    // (the cloud not read: nothing is cleared by itself)
    for (const j of list) {
      const c = (rows || []).find((x) => x && x.id === j.id);
      if (c && (c.status === "done" || c.status === "failed") && !c.checking) {
        try { await cancelJob(j.id); J.cleared.push(j.id); j.gone = true; } catch (e) { /* the list keeps it, with Cancel */ }
      }
    }
    J.list = list.filter((j) => !j.gone); J.err = "";
  } catch (e) { J.err = String((e && e.message) || e || ""); }
  finally { J.busy = false; J.at = Date.now(); redraw(); }
  return J.list;
}
const ask = async () => {
  const q = { title: "Stop this posting?", body: "Nothing more is sent to Tally for it.", ok: "Stop it", cancel: "Keep it", danger: true };
  if (typeof window.askConfirm === "function") { const r = await window.askConfirm(q); return !!(r && (r.ok || r === true)); }
  return window.confirm(q.title + " " + q.body);
};
// the line (and See postings with its list); beat: this computer's bridge's beat (its keepWait), when known
export function PostingWait({ beat, hook = "line" }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(""), wait = postingWait(beat), up = here();
  // (once a page; again, at most every 30 s, while the bridge waits for a posting)
  // and once more when the bridge stops waiting for a posting (one finished by itself: the line goes, no reload)
  useEffect(() => { if (up && (wait || !J.at)) jobsLook(false); else if (up && J.wasWait && !wait) jobsLook(true); J.wasWait = wait; });
  const list = (up && J.list) || [];
  // next-buttons: Stop posting says what came of it, for that posting (beside its button while it is listed; once it is
  // gone, under the line), for 3 minutes
  const SD = J.saids = J.saids || {}, fresh = (id) => SD[id] && Date.now() - SD[id].at < 180000 ? SD[id] : null;
  const line = (x) => x && <div className={"tsm-note" + (x.bad ? " bad" : "")} data-stuck-said={x.bad ? "bad" : "ok"} role="status">{x.text}</div>;
  const goneLines = Object.keys(SD).filter((id) => fresh(id) && !list.some((x) => x.id === id)).map((id) => <div key={id}>{line(SD[id])}</div>);
  const saidLine = goneLines.length ? goneLines : null;
  if (!list.length) return saidLine || null;
  const j = list[0];
  return <div className="tsm-note tpt-wait" data-stuck-jobs={hook} role="status">
    {"Waiting for a posting on this computer: " + (j.company || "a company") + " · " + (j.status || "waiting") + (list.length > 1 ? " (and " + (list.length - 1) + " more)" : "") + " "}
    <button type="button" className="linkbtn" data-stuck-see="" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}>{open ? "Hide postings" : "See postings"}</button>
    {open && <ul className="tsm-stuck-list" data-stuck-list="" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{list.map((x) => <li key={x.id} data-stuck-job={x.id}>
      {(x.company || "") + " · " + (x.status || "") + (x.message ? " · " + x.message : "") + " "}
      <button type="button" className="btn small" data-stuck-cancel={x.id} disabled={busy === x.id}
        onClick={async () => { if (busy || !(await ask())) return; setBusy(x.id);
          try { await cancelJob(x.id); SD[x.id] = { at: Date.now(), text: "Stopped. Nothing more is sent to Tally for it; reading goes on within a minute." }; }
          catch (e) { J.err = String((e && e.message) || e).replace(/[.\s]+$/, "");
            // (the bridge's own answer when it gave one; not reached: said so)
            SD[x.id] = { at: Date.now(), bad: true, text: /failed to fetch|networkerror|load failed|timed? ?out|aborted|refused|not answering/i.test(J.err) || !J.err
              ? "Not stopped: FinCom Bridge on this computer did not answer. Check that it is running, then try again." : "Not stopped: FinCom Bridge said: " + J.err + "." }; }
          setBusy(""); jobsLook(true); }}>{busy === x.id ? "Stopping…" : "Stop posting"}</button>{line(fresh(x.id))}</li>)}</ul>}
    {saidLine}
  </div>;
}
