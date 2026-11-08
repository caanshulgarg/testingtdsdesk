// bridge 2.5.10 (the owner's request of 08-Nov-2026): FinCom Bridge says itself whether it took up the days FinCom handed
// it for a book (Bring books, Bring another year: kind period; Bring missing days: fill; Check for changes: check): its
// beat's pickups, kept by FinCom's cloud on the computer's beat (tally_devices.info.beat.pickups, passed on at once by
// TLight.beatIn). Each: {company, book, guid, kind, takenAt, state: started | refused, pickedUtc, day, code, words, login,
// bridge}. A press takes a snapshot of those of its company first (ackSnap); an acknowledgement said after it (new, or
// changed) is the press's (ackNew): "Started at 10:42 IST on made-up-a’s Tally." or "Not started: <the bridge's own
// words>.". No acknowledgement (an older bridge, or not said yet): the page's inference as before. No clock is compared:
// only what changed since the snapshot. Loaded only with the Tally page's code (TallyBtn.jsx, TallyCheck.jsx).
import { tallyDevs } from "./tallyState.js";

const IST = 5.5 * 3600e3;
const hmIst = (at) => { const t = Date.parse(at || ""); return t ? new Date(t + IST).toISOString().slice(11, 16) + " IST" : ""; };
// (review of 2.5.10, 6: by the book FinCom's cloud matched each to, never by the company's name)
function acksOf(book) {
  const out = [];
  if (!book) return out;
  try {
    tallyDevs().forEach((d) => { const b = ((d && d.info) || {}).beat || {};
      [].concat(b.pickups || []).forEach((a) => { if (a && typeof a === "object" && !Array.isArray(a) && a.book && String(a.book) === String(book)) out.push(a); }); });
  } catch (e) { /* none */ }
  return out;
}
const idOf = (a) => [a.bridge || "", String(a.guid || "").toLowerCase(), a.kind, a.takenAt, a.state, a.code || "", a.pickedUtc || ""].join("|");
export function ackSnap(book, kinds) { return { book: String(book || ""), kinds: [].concat(kinds || []), seen: new Set(acksOf(book).map(idOf)) }; }
// the acknowledgement said since the snapshot: one that started (the newest), else the newest refusal; null when none
export function ackNew(s) {
  if (!s || !s.book) return null;
  const l = acksOf(s.book).filter((a) => s.kinds.includes(a.kind) && !s.seen.has(idOf(a)) && (a.state === "started" ? !!hmIst(a.pickedUtc) : a.state === "refused"));
  const by = (f) => (x, y) => String(f(y) || "").localeCompare(String(f(x) || ""));
  return l.filter((a) => a.state === "started").sort(by((a) => a.pickedUtc))[0] || l.sort(by((a) => a.at || a.seen))[0] || null;
}
const loginOf = (s) => String(s || "").replace(/^.*[\\/]/, "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 60);
export function ackWords(a) {
  if (!a) return "";
  if (a.state === "started") { const u = loginOf(a.login); return "Started at " + hmIst(a.pickedUtc) + " on " + (u ? u + "’s Tally" : "the Tally computer") + "."; }
  const w = String(a.words || "").replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f]/g, "").trim().replace(/[.\s]+$/, "");
  return "Not started: " + (w || "the Tally computer did not say why") + ".";
}
