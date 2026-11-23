import NoticeLine from "./NoticeLine.jsx";
import Button from "./Button.jsx";
// The notes of a client's Books and GST pages (split from parts/Notes.jsx, next-fix-audit-all: the first file's size budget,
// tests/run_legacy_room.py): ledgers still to confirm (TDS, GST), filed GST returns the books no longer match, whether the
// TDS and GST work is saved for the firm, Tally having changed since a tab was worked out, and what FinCom's server is
// doing for the client. Only the Books and GST screens (their own files) draw them, so they come with those files.

// the ledgers still to be confirmed, above the TDS or GST work that uses them
export function LedgerBanner({ b, which }) {
  // one count everywhere (review of 01-Oct-2026): the same ledgers as the "N to confirm" on the Tally ledgers tab
  const p = TaxLed.pending(b, which || "all");
  if (!p.length) return null;
  // one row (round 3, 05-Oct-2026); the ledgers' names on hover
  return <NoticeLine sev="bad" data-ledger-banner="" style={{ marginBottom: 12 }} text={p.length + " ledger" + (p.length === 1 ? " is" : "s are") + " still to be confirmed: the figures use guesses and the return files wait."}
    how={"Still to confirm: " + p.slice(0, 6).map((x) => x[0]).join(", ") + (p.length > 6 ? " and " + (p.length - 6) + " more" : "") + ". Confirm them on the " + (which === "gst" ? "GST" : "TDS") + " page's Ledgers."}>
    <Button className="btn small" data-ledger-confirm="" onClick={() => TaxLed.go(which === "gst" ? "gst" : "tds")}>Confirm them</Button></NoticeLine>;
}

// filed GST returns that the books no longer match
export function GstDriftNote({ b }) {
  if (b.gstDrift === undefined) { try { b.gstDrift = GSTAmend.drift(); } catch (e) { b.gstDrift = []; } }
  const d = b.gstDrift || [];
  if (!d.length) return null;
  return <div className="bk-warn" role="status">{d.slice(0, 3).map((x, i) => <p key={i}>{GSTAmend.driftLine(x)}</p>)}
    {d.length > 3 && <p>{(d.length - 3) + " more filed return" + (d.length > 4 ? "s" : "") + " changed."}</p>}
    <Button className="btn small" onClick={() => booksTabGo("gst", "amend")}>See the amendments</Button></div>;
}

// whether the TDS and GST work is kept for the firm, or only in this browser
export function SyncNote({ cid, tab }) {
  const info = !tab, note = (t, cls) => <p className={"note" + (cls ? " " + cls : "")} style={{ margin: "6px 0" }}>{t}</p>;
  if (!(typeof Cloud === "object" && Cloud.on())) return null;
  if (BookSync.off) return info ? note("The firm’s database is not set up for shared TDS and GST work yet: it is kept in this browser only.") : null;
  const s = BookSync.st[cid] || {};
  if (s.readonly) return note("Look-only access: changes here are not saved for the firm.");
  if (s.error) return note("TDS and GST work not saved to the firm yet: " + plainText(s.error) + ". It is safe in this browser and will be sent at the next sync.", "warn");
  // live sync: only a warning (offline, not saved yet) stays by the work; "Saving…" and "Saved 08:07" are the top bar's
  // save chip (round 3 A, the owner 14-Oct-2026)
  if (typeof BookItems === "object" && BookItems.on()) { const n = BookItems.note(cid); if (n && n.cls) return <p className={"note " + n.cls} data-booksave style={{ margin: "6px 0" }}>{n.t}</p>; }
  return null;
}

// Tally changed since a tab was worked out: it is worked out again, and says so meanwhile (lib/catchSoon.js)
export function CatchUp({ text }) {
  return <p className="bk-warn" role="status">{text}</p>;
}

// fast-sync: what FinCom's server is doing for this client (a day book being read in, the kept day books read again),
// live; it carries on when this page is closed (TCloud.jobs, migration-13)
// compact (From Tally, 2.4.0): "Sending DayBook.xml to FinCom’s cloud: 42%", the sizes and what happens if the page is
// closed on hover
// active (round 63: Tally messages only where needed): only a job going on or stopped (the Books tabs other than From
// Tally); a job done today is said on From Tally only
export function JobsNote({ cid, compact, active = false }) {
  if (typeof TCloud !== "object" || !TCloud.on()) return null;
  if (TCloud.jobs[cid] === undefined && TCloud.jobsOk !== false) { TCloud.jobs[cid] = []; setTimeout(() => TCloud.jobsLoad(cid), 0); }
  const day = Date.now() - 86400000;
  const list = (TCloud.jobs[cid] || []).filter((j) => j.status === "queued" || j.status === "running" || (active ? j.status === "failed" && Date.parse(j.updated_at) > day : Date.parse(j.updated_at) > day)).slice(0, 3);
  // round 20 (d.2): a Day Book on its way to Storage from this page: its progress bar
  const up = typeof TCloudUp === "object" && TCloudUp.prog ? TCloudUp.prog[cid] : null;
  const pct = up && up.size ? Math.floor((up.sent * 100) / up.size) : 0;
  const more = "(" + (up ? (up.sent / 1048576).toFixed(1) + " of " + (up.size / 1048576).toFixed(1) : "") + " MB). If the page is closed, it goes on from here the next time this client is opened.";
  const bar = up ? <div data-upload-progress="" style={{ margin: "4px 0" }} title={compact ? more : undefined}><span className="note">{"Sending " + up.name + " to FinCom’s cloud: " + pct + "%" + (compact ? "" : " " + more)}</span>
    <progress data-upload-bar="" max={100} value={pct} style={{ display: "block", width: "100%", maxWidth: 420 }} /></div> : null;
  if (!list.length) return bar;
  return <div data-jobs>{bar}{list.map((j) => <p key={j.id} className={"note" + (j.status === "failed" ? " bad" : "")} style={{ margin: "4px 0" }} data-job={j.status}>{TCloud.jobLine(j)}</p>)}</div>;
}
