// next-link-follow (08-Nov-2026; migration 146; the owner: "it should connect to both Tally rather than switching… like
// Tally can be opened by n persons and used simultaneously"): every bridge of the firm with the company open (under the
// link's GUID, the link's data location, reading not stopped) serves a linked book at the same time, the work shared by
// claims in the cloud. The page says plainly which Tally it is read from ("Being read from 2 logins' Tally", "Read from
// this computer's Tally (your login) — the linked login's bridge is offline"), and at once when nothing can answer (the
// linked computer offline and the company open in no other Tally), instead of a button that queues work for a bridge
// that never answers. All from the cloud's own list (tally_read_view, read once a minute at most): the serving bridges,
// when the link's key was last heard, fetchOn, and the held lines a serving bridge is asked again. On a cloud without 146
// (no view) the page is as before; only the buttons' "Nothing can answer now" stays, and only when no bridge FinCom hears
// has the company open (true either way). No computer is named.
import { tallyDevs, seenWords } from "./tallyState.js";

export const VIEW = { books: null, at: 0, busy: false, off: false };
const gone = (e) => /PGRST202|42883|Could not find the function|schema cache|does not exist|\b404\b/i.test(String((e && e.message) || e));
export function viewLoad(force) {
  if (VIEW.off || VIEW.busy || typeof TCloud !== "object" || !TCloud.rpc) return VIEW.books;
  if (!force && VIEW.at && Date.now() - VIEW.at < 60000) return VIEW.books;
  VIEW.busy = true;
  Promise.resolve().then(() => TCloud.rpc("tally_read_view", {}))
    .then((r) => { if (r && r.ok && Array.isArray(r.books)) VIEW.books = r.books; }, (e) => { if (gone(e)) VIEW.off = true; })
    .finally(() => { VIEW.at = Date.now(); VIEW.busy = false; });
  return VIEW.books;
}
export const followOn = () => !VIEW.off && Array.isArray(VIEW.books);
const OFFLINE_MS = 5 * 60000;
const live = (iso) => { const t = Date.parse(iso || ""); return !!t && Date.now() - t < OFFLINE_MS; };
const pcOf = (d) => { const i = (d && d.info) || {}; return String(i.computer || (i.beat || {}).computer || "").trim().toLowerCase(); };
const ownId = () => { try { const b = typeof globalThis.tallyOwnBridge === "function" ? globalThis.tallyOwnBridge() : null; return (b && b.id) || ""; } catch (e) { return ""; } };
export const offlineWords = (iso) => "The computer this client is linked to is offline (" + (Date.parse(iso || "") ? "since " + seenWords(iso) : "not heard from yet") + "). Open the company in Tally on this computer, or start FinCom Bridge there.";
function bookOf(company) {
  const L = globalThis.LinkRec, rec = L && L.ofName ? L.ofName(company) : null;
  viewLoad();
  if (!rec || !followOn()) return null;
  return VIEW.books.find((b) => b && b.book === rec.book_id) || null;
}
// {kind: linked | shared | here | other | offline | closed, text, reader, n, book} for a linked company; null when not
// known (no 146, no link record)
export function readWhere(company) {
  const b = bookOf(company);
  if (!b) return null;
  const sv = [].concat(b.serving || []).filter((x) => x && x.device && x.bridge), n = sv.length, linkLive = live(b.linkHeardAt), own = ownId();
  if (n >= 2) {
    const mine = !!own && sv.some((x) => x.bridge === own);
    return { kind: "shared", n, reader: sv[0], book: b, text: "Being read from " + n + " logins’ Tally" + (mine ? ", yours included" : "") };
  }
  if (n === 1) {
    const r = sv[0];
    if (r.linked) return { kind: "linked", n, text: "", reader: r, book: b };
    const devs = tallyDevs(), hd = devs.find((d) => d.id === b.linkDevice), rd = devs.find((d) => d.id === r.device);
    const mine = !!own && r.bridge === own;
    const where = mine ? "this computer’s Tally (your login)" : hd && rd && pcOf(hd) && pcOf(hd) === pcOf(rd) ? "another Windows login’s Tally" : "another computer’s Tally";
    return { kind: mine ? "here" : "other", n, reader: r, book: b,
      text: "Read from " + where + " — " + (linkLive ? "the company is not open in the linked login’s Tally" : "the linked login’s bridge is offline") };
  }
  // review of 314a178f1: the cloud's list is empty also when the link has no GUID, the bridge is older than 2.4.5 or its
  // beat lists over 50 companies: when a bridge FinCom hears has the company open for reading (tallyServe), not known
  // (null: the page as before), never "offline" or "Nothing can answer now"
  if (heardOpen(company)) return null;
  return linkLive ? { kind: "closed", n, text: "", reader: null, book: b } : { kind: "offline", n, text: offlineWords(b.linkHeardAt), reader: null, book: b };
}
// a bridge FinCom hears has the company open for reading (98-link-record's tallyServe, reads: true); unsure: true
function heardOpen(company) {
  if (typeof globalThis.tallyServe !== "function") return false;
  try { return globalThis.tallyServe(company, { own: "", reads: true }) !== null; } catch (e) { return true; }
}
// a button's result when nothing can answer it now ("" when a bridge with the company open answers)
export function noAnswer(company) {
  const w = readWhere(company);
  if (w) return w.reader ? "" : w.kind === "offline" ? "Nothing can answer now. " + w.text : closedWords(company);
  // (no 146, or not decided lately: only when no bridge FinCom hears has the company open for reading)
  if (typeof globalThis.tallyServe !== "function") return "";
  return heardOpen(company) ? "" : closedWords(company);
}
const closedWords = (company) => "Nothing can answer now: “" + String(company || "").trim() + "” is not open in any Tally FinCom hears. Open it in Tally; FinCom then brings it by itself.";
// the book's older days are read by a serving bridge under the switch that holds there (the cloud's fetchOn)
export function followFetch(company) { const w = readWhere(company); return !!(w && w.reader && w.book.fetchOn === true); }
// held lines the cloud asks a serving bridge's Tally again by itself (every one of them in its list): only then is
// "asking Tally again" said and the Day Book upload kept back
export function reasked(lines, company) {
  const xs = [].concat(lines || []), w = readWhere(company);
  if (!xs.length || !w || !w.reader) return false;
  const ids = new Set([].concat(w.book.reask || []).map(String));
  return xs.every((l) => l && ids.has(String(l.id)));
}
