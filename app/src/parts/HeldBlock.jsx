// The owner, 31-Oct-2026 (one book: a "Needs you" row per day from 01-Oct to 01-Nov for lines held after his Day Book upload,
// plus "19 entries may have been renumbered"): "I have updated the books now, why am I getting this; there should be an option
// to update the Day Book from there only, and after the update it should close the error." ONE plain block per company on
// Sync activity instead of a row per day (migration 136):
//   "<company>: 103 changes saved in Tally between 01-Oct and 01-Nov are not yet in FinCom. FinCom is checking them with
//    Tally now (40% · about 6 min) — or upload one Day Book for 01-Oct-2026 to 01-Nov-2026 [Upload Day Book]"
// with "Show days" folding the per-day rows (Rec.flow's own sentences) and one line on why it happens. The days are queued
// for the check by the cloud itself (136); the lines settle themselves when it is done or a Day Book covers them, and leave
// the block live (Live.joinRecorder brings each line's new state; the block counts only lines still held). The button opens
// the client's Day Book upload with the period preset (S.dbFrom / S.dbTo; the file's own dates still decide).
// Folded: the "daybook" groups (Rec.needKind) of a company, its held lines "waiting for the entry's details" (otherwise
// said as being fetched), and its renumbering item; a renumbering item alone stays as it was. The renumbering item leaves
// by itself once 136 says every day from its first day is checked (Rec.renOk, read by Rec.renumberNeeds).
import Button from "./Button.jsx";
import { ClearBtn } from "./Bell.jsx";

// tally_held_status (136): {books: [{book, client, company, held, from, to, check: {total, done, waiting, etaMin, state,
// words}, fetchOn, renumber: [{from, at, n, checked}]}]}, read every 20 s while a block or a renumbering item is shown
const HS = { books: null, at: 0, busy: false, none: false };
async function load() {
  HS.busy = true;
  const was = JSON.stringify(HS.books);
  try { const r = await TCloud.rpc("tally_held_status", { p_client: null }); HS.books = (r && r.books) || []; }
  catch (e) { HS.books = []; if (Rec.missing && Rec.missing(e)) HS.none = true; }
  HS.busy = false; HS.at = Date.now();
  if (JSON.stringify(HS.books) !== was) render();
}
function heldStatus() {
  if (!HS.none && !HS.busy && typeof TCloud === "object" && TCloud.on() && (!HS.at || (Date.now() - HS.at > 20000 && pollOk()))) { HS.at = Date.now(); setTimeout(load, 0); }
  return HS.books || [];
}
Rec.heldReload = () => { HS.at = 1; render(); };
const bookOf = (cid) => (HS.books || []).find((b) => b && b.client === cid) || null;
// a renumbering item is settled once every alert of its company is checked since it (136)
Rec.renOk = (g) => { const b = g && g.cid && bookOf(g.cid), rn = (b && b.renumber) || []; return rn.length > 0 && rn.every((a) => a.checked === true); };

const WAITING = /waiting for the entry's details/i;
const coOf = (r) => r.company || (((S.companies || {})[r.client_id] || {}).name) || "a company";
// {blocks: [{key, cid, company, days: [group], lines: [row], renumber}], needs, fetching}: Rec.flow() with each company's
// day groups folded into one block
export function foldHeld(flow) {
  const by = new Map(), k = (s) => String(s || "").trim().toLowerCase();
  const needs = flow.needs.filter((g) => {
    if (g.kind !== "daybook" || g.stuck) return true;
    const key = k(g.company);
    if (!by.has(key)) by.set(key, { key: "held|" + g.company, cid: g.cid, company: g.company, days: [], lines: [], renumber: null });
    const b = by.get(key); b.days.push(g); b.lines.push(...g.lines); if (!b.cid) b.cid = g.cid;
    return false;
  });
  const rest = needs.filter((g) => { const b = g.kind === "renumber" && by.get(k(g.company)); if (!b) return true; b.renumber = g; if (!b.cid) b.cid = g.cid; return false; });
  const fetching = flow.fetching.filter(({ r }) => { const b = r.state === "held" && WAITING.test(String(r.held_why || "")) && by.get(k(coOf(r))); if (!b) return true; b.lines.push(r); return false; });
  // a line settled or held (live): the status read again at once, so the counts follow
  const sig = [...by.values()].map((b) => b.company + ":" + b.lines.length).join("|");
  if (sig !== HS.sig) { HS.sig = sig; if (HS.at) HS.at = 1; }
  if (by.size || rest.some((g) => g.kind === "renumber") || (HS.books || []).some((b) => (b.renumber || []).length)) heldStatus();
  return { blocks: [...by.values()], needs: rest, fetching };
}

const short = (d) => fmtDate(d).replace(/-\d{4}$/, "");
async function uploadRange(cid, from, to) {
  S.dbFrom = from; S.dbTo = to;
  if (S.view !== "company" || S.coId !== cid) await openCompany(cid);
  S.dbFrom = from; S.dbTo = to;
  goClient("books:import");
}
// the block's sentence and its period: {text, from, to}
export function heldWords(b) {
  // the lines Sync activity has read (its newest 200) and, from 136, every held line of the book
  const st = bookOf(b.cid), c = (st && st.check) || {}, ymd = (x) => /^\d{8}$/.test(String(x || "")) ? x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8) : "";
  const days = [...new Set(b.days.map((g) => g.day).concat(b.lines.map((r) => String(r.vch_date || "").slice(0, 10)), st && st.held > 0 ? [ymd(st.from), ymd(st.to)] : [])
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(), d0 = days[0] || "", d1 = days[days.length - 1] || d0, n = Math.max(b.lines.length, (st && st.held) || 0);
  const from = b.renumber && b.renumber.day && (!d0 || b.renumber.day < d0) ? b.renumber.day : d0, to = b.renumber ? Rec.ymdLocal(Date.now()) : d1;
  const up = "upload one Day Book for " + (from === to ? fmtDate(from) : fmtDate(from) + " to " + fmtDate(to));
  const pct = c.total > 0 ? Math.round((100 * c.done) / c.total) : 0;
  const how = c.state === "checking" || c.state === "queued" ? "FinCom is checking them with Tally now (" + pct + "%" + (c.etaMin ? " · about " + c.etaMin + " min" : "") + ") — or " + up
    : c.state === "stopped" ? "FinCom stopped checking them with Tally" + (c.words ? " (" + c.words + ")" : "") + " — " + up
    : c.state === "off" ? (c.why === "offline" ? "FinCom checks them by itself once the Tally computer that reads older entries is connected" : "FinCom checks them by itself once reading older entries is on for the Tally computer") + " — or " + up
    : up.charAt(0).toUpperCase() + up.slice(1);
  const text = b.company + ": " + (n === 1 ? "1 change" : n + " changes") + " saved in Tally " + (d0 === d1 ? "on " + short(d0) : "between " + short(d0) + " and " + short(d1)) +
    (n === 1 ? " is" : " are") + " not yet in FinCom. " + how;
  return { text, from, to };
}

export default function HeldBlock({ b, canApply }) {
  const AC = typeof AlertClear === "object" ? AlertClear : null, w = heldWords(b);
  const clr = AC ? AC.item("needs:" + b.key, b.lines.map((r) => AlertHub.lineAtom(r)), w.text) : null;
  if (clr && AC.cleared(clr)) return null;
  return <div data-held-block={b.company} style={{ margin: "6px 0 0" }}>
    <span data-held-text="">{w.text}</span>{" "}
    {canApply && b.cid ? <Button className="btn small" data-held-upload="" data-needs-act="daybook-range" onClick={() => uploadRange(b.cid, w.from, w.to)}>Upload Day Book</Button>
      : <span className="note">{" (a member of the firm who may write does this)"}</span>}
    {" "}<ClearBtn x={clr} />
    <div className="note" data-held-why="">Why: Tally saved changes FinCom had not read yet (they reached FinCom after its last Day Book); they clear by themselves once checked or uploaded.</div>
    <details data-held-days="" style={{ margin: "2px 0 0" }}><summary className="note" style={{ cursor: "pointer" }}>Show days</summary>
      {b.renumber && <div className="note" data-held-day="renumber">{b.renumber.text}</div>}
      {b.days.slice().sort((x, y) => String(x.day).localeCompare(String(y.day))).map((g) => <div key={g.key} className="note" data-held-day={g.day}>{g.text}</div>)}
    </details>
  </div>;
}

// for another view of the Tally page (one row a client: "All entries received? No" and its What-to-do button): a client's
// held lines from 136 alone, null when none: {n, from, to (yyyy-mm-dd), check: {total, done, waiting, etaMin, state, words},
// renumberChecked, upload()} (upload: the client's Day Book upload with that period preset)
export function heldFor(cid) {
  heldStatus();
  const b = bookOf(cid), ymd = (x) => /^\d{8}$/.test(String(x || "")) ? x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8) : "";
  if (!b || !(b.held > 0)) return null;
  const from = ymd(b.from), to = ymd(b.to);
  return { n: b.held, from, to, check: b.check || {}, renumberChecked: Rec.renOk({ cid }), upload: () => uploadRange(cid, from, to) };
}
