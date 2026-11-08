// next-link-follow (08-Nov-2026; migration 146): reads follow the company. The cloud hands a linked book's reads to the
// ONE bridge of the firm that has the company open now (the link's own first; else another login's, the link moved and
// the move kept in tally_read_moves). The page says plainly where the book is read from, and says at once when nothing
// can answer (the linked computer offline and the company open in no other Tally), instead of a button that queues work
// for a bridge that never answers. From what the page already holds: the link record (LinkRec, src/js/98), the beats
// (tallyDevs), the serving bridge (tallyServe, src/js/98, the link's key first as the cloud chooses) and the moves (read
// here, once a minute at most; none on a cloud without 146: the words come from the beats alone). No computer is named.
import { tallyDevs, seenWords } from "./tallyState.js";

export const OFFLINE_MS = 5 * 60000;
export const MOVES = { rows: null, at: 0, busy: false, off: false };
const gone = (e) => /PGRST20[25]|42P01|Could not find|schema cache|does not exist|\b404\b/i.test(String((e && e.message) || e));
export function movesLoad(force) {
  if (MOVES.off || MOVES.busy || typeof Cloud !== "object" || !Cloud.api) return MOVES.rows;
  if (!force && MOVES.at && Date.now() - MOVES.at < 60000) return MOVES.rows;
  MOVES.busy = true;
  Promise.resolve().then(() => Cloud.api("tally_read_moves?select=id,book_id,from_device,to_device,to_bridge,why,fetch_on,at,undone_at&order=id.desc&limit=300"))
    .then((r) => { MOVES.rows = [].concat(r || []); }, (e) => { if (gone(e)) MOVES.off = true; })
    .finally(() => { MOVES.at = Date.now(); MOVES.busy = false; });
  return MOVES.rows;
}
// the book's latest move, while not put back
export function moveOf(book) {
  const m = book ? [].concat(MOVES.rows || []).find((x) => x && x.book_id === book) : null;
  return m && !m.undone_at ? m : null;
}
// when a computer key was last heard (any of its bridges, its beat), ms; 0: never
export function heardAt(d) {
  if (!d) return 0;
  const i = d.info || {}, ts = [Date.parse((i.beat || {}).at || ""), Date.parse(d.last_seen || "")];
  Object.values(i.bridges && typeof i.bridges === "object" ? i.bridges : {}).forEach((b) => ts.push(Date.parse((b && b.at) || "")));
  return Math.max(0, ...ts.filter((t) => t > 0));
}
const pcOf = (d) => { const i = (d && d.info) || {}; return String(i.computer || (i.beat || {}).computer || "").trim().toLowerCase(); };
const ownId = () => { try { const b = typeof globalThis.tallyOwnBridge === "function" ? globalThis.tallyOwnBridge() : null; return (b && b.id) || ""; } catch (e) { return ""; } };
export const offlineWords = (at) => "The computer this client is linked to is offline (" + (at ? "since " + seenWords(new Date(at).toISOString()) : "not heard from yet") + "). Open the company in Tally on this computer, or start FinCom Bridge there.";
// {kind: linked | here | other | offline | closed, text, at, sv, move} for a linked company; null when not known (no link
// record, the page's link code not loaded)
export function readWhere(company) {
  const L = globalThis.LinkRec, rec = L && L.ofName ? L.ofName(company) : null;
  if (!rec || typeof globalThis.tallyServe !== "function") return null;
  movesLoad();
  const mv = moveOf(rec.book_id), home = mv && mv.to_device === rec.device_id && mv.from_device ? mv.from_device : rec.device_id;
  const devs = tallyDevs(), hd = devs.find((d) => d.id === home), at = heardAt(hd), online = !!at && Date.now() - at < OFFLINE_MS;
  let sv = null; try { sv = globalThis.tallyServe(company, { rec, own: "" }); } catch (e) { sv = null; }
  if (sv) {
    if (!home || sv.dev.id === home) return { kind: "linked", text: "", at, sv, move: mv };
    const mine = !!ownId() && sv.id === ownId();
    const where = mine ? "this computer’s Tally (your login)" : hd && pcOf(hd) && pcOf(hd) === pcOf(sv.dev) ? "another Windows login’s Tally" : "another computer’s Tally";
    return { kind: mine ? "here" : "other", text: "Read from " + where + " — " + (online ? "the company is not open in the linked login’s Tally" : "the linked login’s bridge is offline"), at, sv, move: mv };
  }
  if (home && !online) return { kind: "offline", text: offlineWords(at), at, sv: null, move: mv };
  return { kind: "closed", text: "", at, sv: null, move: mv };
}
// a button's result when nothing can answer it now ("" when a bridge with the company open answers)
export function noAnswer(company) {
  const w = readWhere(company);
  if (!w || w.sv) return "";
  return w.kind === "offline" ? "Nothing can answer now. " + w.text
    : "Nothing can answer now: “" + String(company || "").trim() + "” is not open in any Tally FinCom hears. Open it in Tally; FinCom then brings it by itself.";
}
// the book's older days are read under the switch of the key it moved from (the same computer): the cloud's fetch_on
export function followFetch(company) {
  const w = readWhere(company);
  return !!(w && w.sv && w.move && w.move.fetch_on && w.move.to_device === w.sv.dev.id);
}
// held lines that a live bridge with the company open asks of its own Tally again by itself (the cloud's follow, 146):
// lines Tally did not answer for in time, or whose computer does not read this company, held in the last 30 days, from
// another computer key than the one serving the company now
export const SLOW = /FinCom does not ask Tally for this company's entries|Tally did not answer in time/i;
export function reasked(lines, company) {
  const xs = [].concat(lines || []);
  if (!xs.length) return false;
  const w = readWhere(company);
  if (!w || !w.sv) return false;
  return xs.every((l) => l && SLOW.test(String(l.held_why || "")) && Date.now() - (Date.parse(l.received_at || "") || 0) < 30 * 864e5 && String(l.device_id || "") !== String(w.sv.dev.id));
}
