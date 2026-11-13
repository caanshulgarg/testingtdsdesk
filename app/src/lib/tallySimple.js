// The simple Tally page (02-Nov-2026, next-tally-simple; the owner, a CA: "every word understandable by anyone"; the approved
// design "Tally — Yes or No"). One row a client (and a row for each company open in Tally that no client has), each
// column answered Yes / No / Not yet / — with one short note, and at most one thing to do. Everything here is read from
// what FinCom already holds (the links, the computers' beats, the books in FinCom's cloud, the held lines, the first sync,
// the books being brought); nothing new is asked of the bridge, the cloud or Tally.
//   Client · Linked to Tally? · Open in Tally right now? · Ledgers received? · All entries received? · What to do
// No computer's name anywhere here (the owner: "no computer names like NWS144"); For support keeps those.
import { companyRows, twinOf, alikeOf, yearOf, ledgersOf, ledgersHeld, daybookHeld, cloudBook, ledBook, ledgerChanges, ledgerChangesForget, askFirst } from "../parts/TallyCompanies.jsx";
import { seenWords, coKey, lastEntry, tallyDevs } from "./tallyState.js";
import { bookSum, bookFetch, pctOf, etaWords, summary, askStatus } from "../parts/TallyFetch.jsx";
import { needDays } from "./needDays.js";
// migration 136 (next-held-settle): a client's held lines, one period, with the Day Book upload preset to it
import { heldFor } from "../parts/HeldBlock.jsx";
import { soonDraw } from "./soonDraw.js";
import { QUIET } from "./quietReads.js";
// next-tally-own-status: this person's own bridge and own Tally (the look on this computer, ownBridge, ownState, placeOf)
// are lib/ownBridge.js's, loaded at the app's start; the Tally page's tables and words here read them as before
import { NOT_MINE, AWAY, NOT_SET, lc, sameUser, fresh, bridgesOf, cfgOf, LOCALB, lookOnce, rescanLocal, localPick, rememberedOwn, day, ownBridge, NEED_V, BLOCKED, bridgeSay,
  NO_CO, NO_CO_HELP, NO_TALLY, placeOf, onTallyPc, ownState, localOpen, vk } from "./ownBridge.js";
export * from "./ownBridge.js";
// next-link-follow (migration 146): where a linked book is read from, and when nothing can answer
import { readWhere, followFetch, reasked } from "./readFollow.js";

export const YES = "Yes", NO = "No", NOTYET = "Not yet", DASH = "—";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const nOf = (n, one, many) => nf(n) + " " + (Number(n) === 1 ? one : many);
const live = () => Object.values((typeof S === "object" && S.companies) || {}).filter((c) => c && !c.deleted);
const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
// India's day, yyyymmdd
const istD8 = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
const d8 = (x) => String(x || "").replace(/-/g, "").slice(0, 8);
// "today", "yesterday", "12-Oct" (the year when it is not this one)
export function dayWords(x) {
  const s = d8(x); if (!/^\d{8}$/.test(s)) return "";
  const now = Date.now();
  if (s === istD8(now)) return "today";
  if (s === istD8(now - 864e5)) return "yesterday";
  return Number(s.slice(6, 8)) + "-" + MON[Number(s.slice(4, 6)) - 1] + (s.slice(0, 4) !== istD8(now).slice(0, 4) ? "-" + s.slice(0, 4) : "");
}
// "12-Oct and 13-Oct are missing", "12-Oct to 30-Oct is missing", "12-Oct, 14-Oct and 3 more days are missing"
export function missingWords(need) {
  const parts = [], seen = new Set();
  [].concat(need || []).slice().sort((a, b) => String(a.from).localeCompare(String(b.from))).forEach((x) => {
    const w = d8(x.from) === d8(x.to || x.from) ? dayWords(x.from) : dayWords(x.from) + " to " + dayWords(x.to);
    if (w && !seen.has(w)) { seen.add(w); parts.push(w); }
  });
  if (!parts.length) return "";
  const many = parts.length > 1 || /\bto\b/.test(parts[0]);
  const list = parts.length <= 2 ? parts.join(" and ") : parts.slice(0, 2).join(", ") + " and " + nOf(parts.length - 2, "more day", "more days");
  return list + (many ? " are missing" : " is missing");
}
// the client FinCom offers first for a Tally company: the same name (a split's date or a year off) or GSTIN, a year of a
// client's company, then the likeliest alike (twinOf / yearOf / alikeOf, as the rest of the app); null when none is alike
export function bestFor(r, all) {
  return twinM(r) || yearOf(r, all) || alikeOf(r)[0] || null;
}
// next-fix-probe-loop (03-Nov-2026): the table's name work once per table. Each client's row asked every Tally company's
// twin (twinOf), and each twin put every client's name through the name rules (tallyNameKey, server/_shared/tallyname.js):
// clients x companies x clients name keys at every drawing (50 clients and 50 companies held the page about 100 s).
// While one table is worked out (tableRows): each company's twin once, and each client's companies of its name read from
// those; and each name's answer from the name rules kept (keepAnswers below). The rows are the same (MEMO.off: without,
// for the test that compares them).
export const MEMO = { off: false, cur: null };
function twinM(r) {
  const m = MEMO.cur;
  if (!m) return twinOf(r);
  if (!m.twin.has(r)) m.twin.set(r, twinOf(r));
  return m.twin.get(r);
}
// the companies no client has whose twin is client cid, in the order of all (as all.filter would give them)
function twinsOf(all, cid) {
  const m = MEMO.cur;
  if (!m) return all.filter((r) => !r.client && twinOf(r) && twinOf(r).id === cid);
  if (!m.by) {
    m.by = new Map();
    all.forEach((r) => { if (r.client) return; const t = twinM(r); if (!t) return; if (!m.by.has(t.id)) m.by.set(t.id, []); m.by.get(t.id).push(r); });
  }
  return (m.by.get(cid) || []).slice();
}
function withTable(fn) {
  if (MEMO.off || MEMO.cur) return fn();
  MEMO.cur = { twin: new Map(), by: null };
  try { return fn(); } finally { MEMO.cur = null; }
}
// the name rules are plain functions of their words (server/_shared/tallyname.js, globals of legacy.js): each name's
// answer kept (strings only; at most 20,000 kept, then started afresh), so a page of 150 clients and 100 companies does not
// put each name through the rules again for every pair. The same answers (MEMO.off: the rules asked each time).
function keepAnswers(name, arity) {
  const g = globalThis, f = g[name];
  if (typeof f !== "function" || f.kept) return;
  const m = new Map();
  const k = arity === 1
    ? function (x) {
      if (MEMO.off || typeof x !== "string") return f.apply(this, arguments);
      let v = m.get(x);
      if (v === undefined) { if (m.size >= 20000) m.clear(); v = f.apply(this, arguments); m.set(x, v); }
      return v;
    }
    : function (x, y) {
      if (MEMO.off || typeof x !== "string" || typeof y !== "string") return f.apply(this, arguments);
      let n = m.get(x);
      if (!n) { if (m.size >= 2000) m.clear(); n = new Map(); m.set(x, n); }
      let v = n.get(y);
      if (v === undefined) { if (n.size >= 2000) n.clear(); v = f.apply(this, arguments); n.set(y, v); }
      return v;
    };
  k.kept = true;
  g[name] = k;
}
if (typeof window === "object") { keepAnswers("tallyNameKey", 1); keepAnswers("nameScore", 2); keepAnswers("clientNameFromTally", 1); keepAnswers("tallyLookKey", 1); }
// the page's own count of a client's ledgers (FinCom's cloud, tally_ledgers counted), by book: a later read of the client's
// books (TCloud.status) replaces TCloud.st[cid] and its count with it
export const LEDN = {}, ASKED_N = new Set();
const ledN = (cid) => { const bk = ledBook(cid), x = LEDN[cid]; return x && bk && x.book === bk.book ? x.n : 0; };
const firstSyncOf = (cid) => ((typeof S === "object" && S.tcoSync) || {})[cid] || null;
// the ledgers' change today (tally_ledger_rounds that sent only some ledgers, tally_ledgers.renamed_at): "x new or
// changed, y renamed". tally_ledgers keeps no "created" time, so a new ledger and a changed one are counted together
function changeWords(cid) {
  const v = ledBook(cid) ? ledgerChanges(cid) : null;
  if (!v) return { known: false, words: "" };
  const bits = [v.changed > 0 ? nf(v.changed) + " new or changed" : "", v.renamed > 0 ? nf(v.renamed) + " renamed" : ""].filter(Boolean);
  return { known: true, words: bits.length ? "Changed in Tally today: " + bits.join(", ") : "" };
}
// the held lines a person must settle by uploading that day's Day Book (the one classifier: Rec.needKind)
function heldLines(cid) {
  if (typeof AlertHub !== "object" || !AlertHub.heldFor || typeof Rec !== "object" || !Rec.needKind) return [];
  let lines = []; try { lines = AlertHub.heldFor([cid]) || []; } catch (e) { lines = []; }
  return lines.filter((l) => ["daybook", "dupid"].includes(Rec.needKind(l)));
}
// (their days, first day first)
function heldDays(cid) {
  if (typeof AlertHub !== "object" || !AlertHub.heldFor || typeof Rec !== "object" || !Rec.needKind) return [];
  let lines = []; try { lines = AlertHub.heldFor([cid]) || []; } catch (e) { lines = []; }
  return [...new Set(lines.filter((l) => ["daybook", "dupid"].includes(Rec.needKind(l))).map((l) => AlertHub.heldDay(l)).filter(Boolean))].sort();
}
// ---------- opening balances (migration 138, tally_openings_decide): FinCom's openings (tally_ledgers.open) and Tally's
// held by migration 130's guards (tally_openings_held), one call for every book of the firm, read again every 5 minutes
// and at once after a choice. A cloud without 138: nothing is said (never "same as Tally" without evidence)
export const OPEN = { at: 0, busy: false, books: null, off: false };
const rpc0 = (fn, a) => (typeof TCloud === "object" && TCloud.rpc ? TCloud.rpc(fn, a) : Promise.reject(new Error("no cloud")));
const gone = (e) => /PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String((e && e.message) || e));
export function openingsAll(force) {
  if (typeof TCloud !== "object" || !TCloud.on || !TCloud.on() || OPEN.off) return null;
  if (!OPEN.busy && (force || (!QUIET.on && Date.now() - OPEN.at > 5 * 60000 && (typeof pollOk !== "function" || pollOk())))) {
    OPEN.busy = true;
    rpc0("tally_openings_decide", { p_book: null, p_action: "status" }).then((r) => { if (r && r.ok && Array.isArray(r.books)) OPEN.books = r.books; },
      (e) => { if (gone(e)) OPEN.off = true; }).finally(() => { OPEN.at = Date.now(); OPEN.busy = false; soonDraw(); });
  }
  return OPEN.books;
}
export const openingsDecide = (book, action) => rpc0("tally_openings_decide", { p_book: book, p_action: action });
// "₹12,80,000" (paise only when there are some)
export const rupees = (n) => "₹" + Math.abs(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// a book's line: same (green) | differ (amber, with the choices) | unbalanced (amber) | null (nothing known)
export function openingsOf(cid) {
  const bk = ledBook(cid), all = openingsAll();
  if (!bk || !bk.book || !all) return null;
  const s = all.find((x) => x.book === bk.book);
  if (!s) return null;
  if (s.held && Number(s.n) > 0) {
    const why = !s.dated ? "Tally’s opening balances are not dated the day FinCom’s books begin, so they cannot be used."
      : Number(s.missing) > 0 ? "Some of these ledgers are not in FinCom yet: bring the ledgers from Tally first."
      : Number(s.pl) > 0 ? "They change income or expense ledgers: FinCom support applies these."
      : Math.abs(Number(s.candidate)) > 1 ? "Tally’s opening balances do not balance (debit and credit differ by " + rupees(s.candidate) + "), so they cannot be used." : "";
    return { state: "differ", book: bk.book, s, canUse: !why, why, words: "Opening balances differ from Tally: " + nOf(s.n, "ledger", "ledgers") + ", " + rupees(s.total) + " in total" };
  }
  if (s.held) return null;
  if (Number(s.nonzero) > 0 && !s.ties) return { state: "unbalanced", book: bk.book, s, words: "Opening balances do not balance: debit and credit differ by " + rupees(s.stored) };
  if (Number(s.nonzero) > 0 && s.ties) return { state: "same", book: bk.book, s, words: "Opening balances: same as Tally" };
  return null;
}
const iso = (x) => { const s = d8(x); return s.length === 8 ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) : ""; };

// ---------- "Open in Tally right now?" in THIS FinCom user's own Tally only (next-tally-own-login; the owner, 03-Nov-2026:
// on the shared cloud server each Windows login runs its own FinCom Bridge and its own Tally: each person's FinCom
// shows the Tally that person has opened in their own cloud login; 02-Nov-2026's next-tally-local-open trusted whatever bridge
// answered on 127.0.0.1, which on a shared server is every login's address). This user's own bridge, in this order:
//   (0) bridge 2.5.3: the local bridge whose /ping says sameSession true (this browser's own Windows session), else the
//       only one answering when it says "unknown" (not confirmed); one saying false is never this user's (localPick below);
//   (a) the bridge this browser paired with (Bridge.cfg: its key and bridge id), when the firm's computers list it;
//   (b) the bridge the signed-in member is linked to (tally_member_bridges, migration 54: TCloud.pane.links), only when no
//       2.5.3 bridge answers on this computer (one FinCom login shared by every Windows login links only one of them).
// tally_devices.created_by is not used: one person often makes every login's computer key (the owner did, on the shared
// server), so it names no Windows login. What the bridge says:
//   (c) the local bridge's own reply (Bridge.st.open, its minute check) ONLY when it is that same bridge: its Windows user
//       is the own bridge's (when both are known), else its proven id is the own bridge's id; another login's never counts;
//   else the cloud copy of the own bridge's beat (tally_devices.info.bridges[id].open / info.beat.open, every 30 s), so
//   the page also works from a browser on another computer (the owner's laptop).
// No own bridge: "—", "Your FinCom Bridge is not set up." and Set it up (the pairing steps), never another login's state.
// The header, the filters, the strip and the guided box are made from the same answer; For support still lists every
// bridge, and postings still go through FinCom's cloud to whichever bridge holds the company (unchanged).
//   ownState(): {state: "ok", from: "here" | "beat", names: Map coKey -> name} | {state: "checking" | "away" | "none"}
// next-tally-page-redesign (the owner: "Check Tally is not working… after refresh it connected"). Each Check again did half
// of what opening the page does: the Tally page's looked for this login's bridge on 127.0.0.1 again and read the cloud's
// beats, but never asked the bridge this browser is paired with for its status again, so Bridge.st kept the failed answer
// of the page's start ("down") until the minute timer; the top bar's asked that bridge and the beats, but never looked
// on 127.0.0.1 again, so a bridge started after the page was opened stayed "not found". checkAll does what a refresh does
// for the connection, in its order: the look on 127.0.0.1 (a look already going is waited for, a finished one started
// over), the paired bridge pointed at the address the look found, its status asked again, the cloud's beats, computers
// and links read again, and the page drawn. Nothing new is asked of Tally (the status is the one the page start asks).
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
// next-fix-check-again (the owner on a Mac: "Check again is not working anywhere"): each Check again ends in words, even
// when nothing changed: "Checked 14:32: your Tally is connected. This computer's FinCom Bridge is connected." A login hears
// of its own bridge and its own Tally only; a computer with none: "Checked 14:32: No Tally on this computer." (never the
// office's Tally: next-tally-own-status). "This computer's FinCom Bridge" only for one found here (never the member's
// link to an office bridge); the browser's block and a look still going said so. lead: a sentence first (the Tally box:
// the client's own state)
const hhmm = () => { const d = new Date(), p = (x) => String(x).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); };
// bridge 2.5.11: a beat saying its login's Tally is open but takes no connection (tallyWhy "connection off", or its
// details tallyOff): the bridge's words ("" otherwise)
export const offSay = (x) => { const b = x || {}; return lc(b.tallyWhy) === "connection off" || (b.tallyOff && typeof b.tallyOff === "object") ? shown(b.tallyConnectSay) || "its connection is off." : ""; };
export function checkedSay(lead) {
  const at = "Checked " + hhmm() + ": ";
  try {
    const o = ownState(), own = o.own || {}, here = o.from === "here" || !!own.local || own.how === "found" || own.how === "unsure";
    // next-own-bridge-words (the owner, 09-Nov-2026: "you don't need to tell me whose bridge is opened other than me.. if
    // there would be 20 bridges opened then I will be confused.. it should remain with the person whose FinCom and bridge
    // is opened"): a login with its own bridge hears only about its own bridge and its own Tally; no count of the firm's
    // bridges anywhere. next-tally-own-status (13-Nov-2026): a computer with no bridge of its own hears "No Tally on this
    // computer" and nothing of the office's Tally, open or closed (a login linked to an office bridge neither)
    // ownState's own reading (the bridge's answer here, else its fresh beat): names, why (whyOf), say, noCo
    const mineB = o.own && o.own.how !== "linked" && ["ok", "away", "checking"].includes(o.state) ? o.own : null;
    const nm = o.names instanceof Map ? o.names.size : 0, why = String(o.why || "");
    const mineSay = o.state === "checking" ? "still asking your FinCom Bridge." : o.state !== "ok" ? "your FinCom Bridge is not answering."
      : nm > 0 ? "your Tally is connected." : o.noCo ? "your Tally is open, but no company is open in it."
      : /connection off/i.test(why) || offSay(mineB.beat) ? "your Tally is open but takes no connection: " + (shown(o.say) || offSay(mineB.beat) || "its connection is off.")
      : why ? why : "your Tally is not open.";
    const office = mineB ? mineSay : "";
    const me = LOCALB.busy ? "Still looking on this computer." : LOCALB.perm === "denied" ? BLOCKED
      : here ? (o.state === "ok" ? "This computer's FinCom Bridge is connected." : mineB ? "" : "This computer's FinCom Bridge is not answering.")
      : own.how === "linked" ? "This computer has no FinCom Bridge: your login uses the office's."
      : o.own ? "This computer's FinCom Bridge does not answer here." : NO_TALLY + ".";
    return at + [lead ? lead + "." : "", lead ? office.charAt(0).toUpperCase() + office.slice(1) : office, me].filter(Boolean).join(" ");
  } catch (e) { return at + "could not tell, see above."; }
}
// the connection as the words saw it: the words go when it changes (Tally page: UI().said)
export function connSig() { try { const o = ownState(); return [o.state, (o.own || {}).how, LOCALB.perm].join("|"); } catch (e) { return ""; } }
// one check at a time, shared by every Check again (a second press while one runs gets the same answer); never rejects
// (a part that never answers is waited for 10 s at most: the words come all the same)
let inFlight = null;
export function checkAll(checkAgain) {
  if (!inFlight) inFlight = checkRun(checkAgain).catch(() => checkedSay()).finally(() => { inFlight = null; });
  return inFlight;
}
async function checkRun(checkAgain) {
  rescanLocal();
  for (let i = 0; i < 60 && LOCALB.busy; i++) await pause(100);
  try { const o = ownState(); if (o && o.own && o.own.local) aimLocal(o.own); } catch (e) { /* the status says why */ }
  const jobs = [];
  try { if (typeof Bridge === "object" && Bridge.on && Bridge.on() && Bridge.refresh) jobs.push(Promise.resolve().then(() => Bridge.refresh(true)).catch(() => {})); } catch (e) { /* */ }
  if (typeof checkAgain === "function") jobs.push(Promise.resolve().then(checkAgain).catch(() => {}));
  else if (typeof TCloud === "object" && TCloud.on && TCloud.on() && TCloud.refreshPane) jobs.push(Promise.resolve().then(() => TCloud.refreshPane()).catch(() => {}));
  try { if (typeof TLight === "object" && TLight.refresh && typeof TCloud === "object" && TCloud.on && TCloud.on()) { TLight.st.at = 0; jobs.push(Promise.resolve().then(() => TLight.refresh()).catch(() => {})); } } catch (e) { /* */ }
  try { if (typeof LinkRec === "object" && LinkRec.load) jobs.push(Promise.resolve().then(() => LinkRec.load(true)).catch(() => {})); } catch (e) { /* */ }
  await Promise.race([Promise.all(jobs), pause(10000)]);
  try { if (typeof TallySteady === "object" && TallySteady.now) TallySteady.now(); } catch (e) { /* */ }
  try { if (typeof render === "function") render(); } catch (e) { /* */ }
  return checkedSay();
}
// next-tally-link-any-bridge: src/js/98-link-record.js tallyServe prefers this browser's own bridge
if (typeof globalThis === "object") globalThis.tallyOwnBridge = ownBridge;
// a client's Tally open in ANOTHER Windows login of the computer that serves it (the owner, 04-Nov-2026: a linked client's
// Tally "is not working at all"; its Tally ran under another Windows user, which this login's bridge leaves
// alone): from the beats' ports only (error "Tally of <user>", reason "another user"), the user whose name is the client's
export function otherLoginOf(client, company) {
  const key = (x) => lc(x).replace(/[^a-z0-9]+/g, "");
  const two = (x) => key(String(x || "").trim().split(/\s+/).slice(0, 2).join(""));
  const names = [two(client), two(company)].filter((x) => x.length >= 4);
  let hit = "";
  tallyDevs().forEach((d) => {
    const beat = (d.info || {}).beat || {};
    [].concat(beat.ports || []).forEach((p) => {
      const m = p && /^tally of (.+)$/i.exec(String(p.error || "").trim());
      if (hit || !m || lc(p.reason) !== "another user" || /windows session/i.test(m[1])) return;
      const u = key(m[1]);
      if (u.length >= 4 && names.some((n) => n.includes(u) || u.includes(n))) hit = m[1].trim();
    });
  });
  return hit;
}
// the companies open in THIS login's own Tally, for the lists that offer a company to link: {keys, noCo, has, open, theirs}.
// has(r): open in this login's own Tally (what a picker chooses first). open(r): what a list calls open: this login's own
// only (a laptop: the firm's, as before). theirs(r): open now in another Windows login's Tally of this very computer: not
// offered here at all; one open on another computer is only seen (never open here, never chosen)
export function ownOpen() {
  let o; try { o = ownState(); } catch (e) { o = { state: "none" }; }
  return openOf(o);
}
const OPEN_OF = new WeakMap();
function openOf(o) {
  if (o && typeof o === "object" && OPEN_OF.has(o)) return OPEN_OF.get(o);
  const v = openNow(o);
  if (o && typeof o === "object") OPEN_OF.set(o, v);
  return v;
}
function openNow(o) {
  const keys = o.state === "ok" ? new Set(o.names.keys()) : new Set(), has = (r) => keys.has(coKey(r.company));
  // (the own bridge's own beat is never another's)
  const beat = new Set([].concat((o.own && o.own.open) || []).map(coKey)), place = placeOf();
  // this login: its own bridge's computer and Windows user, else the one this browser's session's bridge says
  const x = (LOCALB.list || []).find((y) => y.sameSession === true), u = (o.own && o.own.user) || (x && x.windowsUser) || "";
  const pc = (o.own && o.own.pc) || (u.includes("\\") ? u.split("\\")[0] : "");
  const sib = new Set();
  if (pc && u && place !== "laptop") bridgesOf().forEach((b) => { if (day(b.at) && lc(b.pc) === lc(pc) && sameUser(b.user, u) === false) b.open.forEach((n) => sib.add(coKey(n))); });
  const mine = (r) => has(r) || beat.has(coKey(r.company));
  // elsewhere(r): open now only in another Tally (another computer's, or not known to be this login's): never chosen for a client
  return { keys, noCo: !!o.noCo, has, laptop: place === "laptop", open: (r) => (place === "laptop" ? !!r.open : has(r)), theirs: (r) => !mine(r) && sib.has(coKey(r.company)),
    elsewhere: (r) => place !== "laptop" && !!r.open && !mine(r) };
}
// Connect in the column: the bridge found here is the one asked (/status?fresh=1 through the local connect flow)
export function aimLocal(own) {
  try {
    const x = own && own.local;
    if (!x || typeof Bridge !== "object" || !Bridge.setCfg) return;
    const u = x.url || "http://127.0.0.1:" + Number(x.bridgePort || x.port);
    if (String(cfgOf().url || "").replace(/\/+$/, "") !== u.replace(/\/+$/, "")) { Bridge.setCfg({ url: u }); Bridge.foundAt = 0; }
  } catch (e) { /* the connect says why */ }
}
export const BRING_WHY = "Open this company in Tally first";
// next-tally-connectfix (finding 6): why the computer a company is linked to does not bring its ledgers, in words, only
// when its beat (heard now) shows it cannot: the company not open in its Tally and none of the Tallys it sees answering
// for it (each skipped, or none answers). Its FinCom Bridge older than 2.5.3 (2.5.3 no longer skips a Tally whose owner
// Windows did not say): "Waiting for FinCom Bridge in the linked Windows login to update to 2.5.3"; else "FinCom Bridge
// in the linked Windows login can't see this Tally". No computer or login named on this page (the owner's rule; For
// support names them). "" when nothing says so (or not known)
export const WAIT_OLD = "Waiting for FinCom Bridge in the linked Windows login to update to ", WAIT_BLIND = "FinCom Bridge in the linked Windows login can’t see this Tally";
export function firstLinkWait(company, all) {
  const k = coKey(company), r = [].concat(all || []).find((x) => x && coKey(x.company) === k);
  const dev = r && r.device ? tallyDevs().find((d) => d.id === r.device) : null;
  // next-tally-link-any-bridge: open in another login's bridge of the firm: it reads it there, nothing to wait for
  if (!dev || (typeof globalThis.tallyServe === "function" && globalThis.tallyServe(r.company))) return "";
  const info = dev.info || {}, beat = info.beat || {}, br = info.bridges || {};
  const ids = Object.keys(br).filter((id) => id !== "v1"), has = (b) => [].concat((b && b.open) || []).some((n) => coKey(n) === k);
  const id = ids.find((x) => has(br[x])) || ids.sort((a, b) => String((br[b] || {}).at || "").localeCompare(String((br[a] || {}).at || "")))[0];
  const b = (id && br[id]) || {};
  if (!fresh(b.at || beat.at) || has(b) || has(beat)) return "";
  const ports = [].concat(beat.ports || []);
  if (!ports.length || ports.some((p) => p && p.ok && !p.skipped)) return "";
  const ver = String(b.version || beat.version || dev.version || "");
  return ver && vk(ver) < vk(NEED_V) ? WAIT_OLD + NEED_V : WAIT_BLIND;
}
const openCell = (h, own, other) => h === "yes" ? { w: YES, note: "" } : h === "no" ? { w: NO, note: other || NOT_MINE }
  : h === "checking" ? { w: DASH, note: "Checking your FinCom Bridge…" }
  // next-hang-watch: no bridge of this login answering here: why, in words, with the download (old) or the start / install
  : own && own.say && (h === "none" || h === "away") ? { w: DASH, note: own.say.words, say: own.say.kind, connect: h === "away", setup: h === "none" }
  : h === "away" ? { w: DASH, note: AWAY, connect: true } : { w: DASH, note: NOT_SET, setup: true };
const otherWords = (client, company, own) => { const u = otherLoginOf(client, company);
  if (!u) return "";
  // next-tally-connectfix (finding 7): this login's own Tally's connection is off (its tally.ini could not be written, or
  // its own Tally's ports are closed): that is why the company is not seen here, not another login
  const off = ownConnOff(own);
  return off || shown(client) + "’s Tally is open in another Windows login (" + u + "), not in this login’s. Open it in this login, or install FinCom Bridge in the " + u + " login."; };
export const CONN_OFF = "Your Tally’s connection is off, so FinCom can’t see the companies open in it. In TallyPrime: F1 → Settings → Connectivity → Client/Server configuration → TallyPrime acts as: Both, then restart Tally.";
// this login's own bridge's beat says its Tally's connection is off: FinCom Bridge could not write tally.ini ("cannot
// write"), or Tally runs in this login and none of its own ports answers (closed / not answering; another user's never
// counts); "" otherwise
export function ownConnOff(own) {
  const o = own && own.own ? own.own : own, beat = (o && o.beat) || {};
  const ini = [].concat(beat.tallyIni || []).some((x) => x && x.connect === "cannot write");
  const ports = [].concat(beat.ports || []).filter((p) => p && !p.skipped && !["another user", "another bridge", "owner unknown", "not tally"].includes(lc(p.reason)));
  const closed = !/^no tally running/i.test(String(beat.tallyWhy || "")) && ports.length > 0 && !ports.some((p) => p.ok) && ports.every((p) => ["closed", "not answering"].includes(lc(p.reason)));
  return ini || closed ? CONN_OFF : "";
}
// the companies open in THIS user's own Tally that no client has (each its own row, the strip and step 3)
export const openUnlinked = (all, own) => { const o = own || ownState(); return o.state === "ok" ? all.filter((r) => !r.client && o.names.has(coKey(r.company))) : []; };

// one client's row
function clientRow(co, all, opts) {
  const cid = co.id, k = typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null, company = (k && k.company) || "";
  const row = { key: "c:" + cid, kind: "client", cid, co, client: co.name, company, act: null, todo: "", upload: false, focus: opts.focus === cid };
  if (!company) {
    // not connected: the company of its name (or GSTIN) that FinCom has seen in Tally, open first; never one open now in
    // another login's Tally (next-tally-other-login). Open in this login's own Tally: Connect, one click, in the column
    const oo = openOf(opts.own), mine = twinsOf(all, cid).filter((r) => !oo.theirs(r) && !oo.elsewhere(r)).sort((a, b) => (oo.open(b) - oo.open(a)) || String(b.seen).localeCompare(String(a.seen)));
    // next-link-choose (the owner: "when we unlink and again link, the same company linked again without giving the
    // option"): the company a person unlinked, or one of several that look alike (askFirst), is never linked in one click:
    // Link opens the list of the firm's Tally companies (ChangePick), each with what it holds
    const r = mine[0] || null, ask = !!r && (mine.length > 1 || askFirst(r, all, co.name)), here = !!r && !ask && oo.has(r);
    Object.assign(row, { r, found: r ? r.company : "", ask,
      c: { w: NO, note: r ? (ask && mine.length > 1 ? mine.length + " companies in Tally look alike: choose one" : "Found in Tally: “" + shown(r.company) + "”") : "", connect: here },
      o: { w: DASH, note: "" }, l: { w: DASH, note: "Come after connecting" }, e: { w: DASH, note: "" } });
    if (here) row.todo = "Press Connect.";
    else if (r && !ask) { row.act = { kind: "connect", label: "Link" }; row.todo = "Link it to the Tally company shown."; }
    else { row.act = { kind: "pickco", label: "Link" }; row.todo = ask ? "Press Link and choose which Tally company is this client’s." : "Open its company in Tally, then press Link."; }
    return row;
  }
  // connected
  // open: in this user's own Tally (localOpen), never another login's bridge
  const here = localOpen(company, opts.own), open = here === "yes";
  row.c = { w: YES, note: "Tally company: " + shown(company) };
  // next-tally-page-redesign: the last entry FinCom has from Tally (the link record's read, the recorder's last line), for the table
  row.last = lastEntry(co, k) || "";
  row.o = openCell(here, opts.own, here === "no" ? otherWords(co.name, company, opts.own) : "");
  // ledgers: the first sync going (its bar), stuck (its reason, Try again), held (the count), not yet
  const x = firstSyncOf(cid), running = !!(x && !x.end && !x.err && !x.late), stuck = !!(x && !x.end && (x.err || x.late));
  const n = Math.max(ledgersOf(cid), ledN(cid), (x && x.led > 0 && x.led) || 0), held = ledgersHeld(cid) || !!(x && x.end);
  const ch = held ? changeWords(cid) : { known: false, words: "" };
  // next-tally-ledgers-button (04-Nov-2026): not yet or stuck, the button "Update from Tally" (firstSync, now: the
  // ledgers wake and, through the cloud, Update from Tally); it can run when the company is open in Tally on this user's own
  // computer or on any computer FinCom hears now, else one plain line
  // next-link-follow (migration 146): where the book is read from (another login's Tally when the linked one is offline or
  // lacks it), or the linked computer offline with the company open in no other Tally: said on the row, never a silent queue
  const rw = readWhere(company);
  row.where = rw && rw.text ? { kind: rw.kind, text: rw.text } : null;
  const anyOpen = open || all.some((r) => r.open && coKey(r.company) === coKey(company)) || !!(rw && rw.reader);
  // next-tally-connectfix (finding 6; staging: "Coming in now" / "coming in by itself" for 34 hours): no ledgers yet, and
  // the computer the company is linked to cannot bring them (its bridge older than 2.5.3, or it sees none of its Tallys):
  // the true reason, and no button that cannot work
  const wait = held ? "" : firstLinkWait(company, all);
  const bring = wait ? { bring: true, can: false, why: wait } : { bring: true, can: anyOpen, why: anyOpen ? "" : BRING_WHY };
  if (running) { const of = x.prog ? Number(x.prog.of) || 0 : 0, rd = x.prog ? Math.min(Number(x.prog.read) || 0, of || Infinity) : 0;
    const stop = of > 0 ? "" : wait;
    row.l = { w: NOTYET, note: of > 0 ? nf(rd) + " of " + nOf(of, "ledger", "ledgers") : stop || "Coming in now", syncing: !stop, ...(stop ? { why: stop } : {}) }; }
  else if (stuck && !held) row.l = Object.assign({ w: NO, note: x.err || x.why || "Nothing came from Tally in 3 minutes" }, bring);
  else if (held) row.l = { w: YES, note: n > 0 ? nOf(n, "ledger", "ledgers") : "Received", change: ch.words, link: true };
  else row.l = Object.assign({ w: NOTYET, note: "" }, bring);
  row.lKnown = ch.known;
  row.open = held ? openingsOf(cid) : null;
  // entries: being brought (the bar), missing days (held lines first), till a day, not yet
  const bs = bookSum(cid), p = bs && bs.pull && !bs.pull.done ? bs.pull : null, fill = bs ? (bookFetch(cid, bs.book) || {}).fill : null;
  const days = daybookHeld(cid), bk = cloudBook(cid), hd = heldDays(cid);
  let need = []; try { need = needDays({}, cid); } catch (e) { need = []; }
  // (the switch of the computer key the book moved from, on the same computer, reads its older days: the cloud's fetch_on)
  const canFetch = !!(bs && (bs.devices || []).some((d) => d.fetchOn)) || followFetch(company);
  // next-link-follow: entries Tally did not answer for in time (or that a computer not reading the company held) are asked
  // again by the live bridge that has the company open, by itself, before anyone is asked for a Day Book upload
  const hl = heldLines(cid), again = hl.length > 0 && reasked(hl, company);
  const hb = again ? null : heldFor(cid);
  if (again) {
    row.e = { w: NOTYET, note: "FinCom is asking Tally again for " + (hl.length === 1 ? "1 entry" : nf(hl.length) + " entries") + " where the company is open now" };
    row.todo = "Nothing yet: FinCom asks Tally again by itself first. Upload the Day Book only if this stays.";
    row.upload = true;
  } else if (hb) {
    // the held lines (136): All entries received? No, the period, FinCom's own check of them; the row's button is the upload
    const c = hb.check || {}, pct = c.total > 0 ? Math.round((100 * c.done) / c.total) : 0;
    row.e = { w: NO, note: missingWords([{ from: hb.from, to: hb.to }]) + (c.state === "checking" || c.state === "queued" ? " · FinCom is checking them with Tally now (" + pct + "%)" : "") };
    row.act = { kind: "upload", label: "Upload Day Book", run: hb.upload, held: true };
    row.todo = hb.n === 1 ? "1 change saved in Tally is not in FinCom yet. Upload the Day Book for those days." : nf(hb.n) + " changes saved in Tally are not in FinCom yet. Upload the Day Book for those days.";
  } else if (fill && Number(fill.waiting) > 0) {
    row.e = { w: NOTYET, note: "Bringing " + nOf(fill.total, "missing day", "missing days") + (Number(fill.etaMin) > 0 ? " · " + etaWords(fill.etaMin) + " left" : "") };
  } else if (p) {
    const pc = pctOf(p);
    row.e = { w: NOTYET, note: (days ? "" : "New client · ") + pc + "% received" + (Number(p.etaMin) > 0 ? " · " + etaWords(p.etaMin).replace(/^about /, "") + " left" : ""), pct: Math.max(2, pc) };
  } else if (!hd.length && need.length && need.every((x) => x.checking)) {
    // next-gap-autoread (migration 160): the recorder's gap only, FinCom reading Tally's Day Book of those days itself
    row.e = { w: NOTYET, note: "Checking with Tally\u2026 (no action needed)" };
  } else if ((hd.length && !again) || need.length) {
    const words = missingWords(hd.length ? hd.map((d) => ({ from: d, to: d })) : need);
    row.e = { w: NO, note: words || "Some entries are missing" };
    if (hd.length) { row.act = { kind: "upload", label: "Upload Day Book", day: iso(hd[0]), held: true }; row.todo = "Tally could not send these entries. Upload that day’s Day Book."; }
    else if (canFetch) { row.act = { kind: "bring", label: "Bring missing days", need }; row.todo = anyOpen ? "Press the button: FinCom brings them from Tally." : "Open the company in Tally, then press the button."; }
    // (off: a computer has this company, its reading of older entries turned off; an owner can turn it on, TallySimple's Row)
    else { row.act = { kind: "upload", label: "Upload Day Book", day: iso(need[need.length - 1].from), off: !!(bs && (bs.devices || []).length) }; row.todo = "Upload the Day Book for those days."; }
    row.upload = row.act.kind !== "upload";
  } else if (days) {
    const last = lastEntry(co, k), to = d8(bk && bk.to);
    const lastToday = last && istD8(Date.parse(last)) === istD8(Date.now());
    row.e = { w: YES, note: "Till " + (to === istD8(Date.now()) && lastToday ? seenWords(last) : dayWords(to) || seenWords(last)) };
  } else {
    row.e = { w: NOTYET, note: running || (open && held) ? "Entries starting" : "" };
  }
  // what to do (at most one button), else plain words (the entries being asked again: their own words above)
  if (!row.act && !again) {
    if (wait && row.l.w !== YES) { row.todo = wait + "."; row.upload = true; }
    else if (stuck && !held) { row.todo = "Keep the company open in Tally, then press Update from Tally."; row.upload = true; }
    else if (row.l.bring && anyOpen && !p && !(fill && Number(fill.waiting) > 0)) { row.todo = "Press Update from Tally."; row.upload = true; }
    else if (row.e.w === NOTYET || row.l.w === NOTYET) {
      // (next-tally-page-redesign; the owner on a Mac with no bridge: "0 clients are fine. 8 need you"): a company open in
      // ANY of the firm's Tallys FinCom hears now comes in by itself; only one open nowhere needs opening
      if (anyOpen || p || running || (fill && Number(fill.waiting) > 0)) row.todo = "Nothing. It is coming in by itself.";
      else row.todo = row.where && row.where.kind === "offline" ? row.where.text : "Open the company in Tally.";
      row.upload = true;
    } else if (row.where && row.where.kind === "offline") row.todo = row.where.text;
    else if (row.o.w !== YES) row.todo = "Nothing. Updates when the company is opened in Tally.";
    else row.todo = "Nothing.";
  }
  return row;
}
// a company open in Tally that no client has: choose its client (the likeliest chosen first)
function companyRow(r, all, own) {
  // next-link-choose: unlinked by a person, or another company looks alike: the client is chosen in the list (best first)
  const best = bestFor(r, all), ask = askFirst(r, all, best && best.name);
  return { key: "t:" + coKey(r.company), kind: "company", r, company: r.company, client: "", best, ask,
    c: { w: NO, note: "Open in Tally: “" + shown(r.company) + "”" }, o: openCell(localOpen(r.company, own), own), l: { w: DASH, note: "Come after connecting" }, e: { w: DASH, note: "" },
    act: { kind: "choose", label: best && !ask ? "Link" : "Link to a client" }, todo: best && !ask ? "Link it to client “" + best.name + "”." : "Choose which client it is.", upload: false };
}
// every row: the clients (by name), then the companies open in Tally that no client has (and that are not a client's
// "Found in Tally")
export function tableRows(opts) { return withTable(() => tableRowsNow(opts)); }
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
function tableRowsNow(opts) {
  opts = Object.assign({}, opts);
  opts.own = opts.own || ownState();
  const all = companyRows(), cs = live().sort(byName);
  return finishRows(cs.map((co) => safeRow(co, all, opts)), all, opts);
}
// next-tally-table (04-Nov-2026): a client whose row cannot be worked out (a state FinCom did not expect) still has its
// row (its name, its Tally company, the rest "—"); the error goes to the console and to Sentry once a client, never a
// blank page
const SAID = new Set();
function told(e, what) {
  try { console.error("[FinCom] the Tally page: " + what + ":", e); if (typeof window === "object" && typeof window.__fincomReport === "function") window.__fincomReport(e, "the Tally page (" + what + ")"); } catch (x) { /* never in the way */ }
}
function safeRow(co, all, opts) {
  try { return clientRow(co, all, opts); }
  catch (e) {
    if (!SAID.has(co.id)) { SAID.add(co.id); told(e, "a client's row"); }
    return quickRow(co, linkRows(), opts, "FinCom could not read this client’s Tally state just now; it tries again by itself.");
  }
}
// the cloud's links as FinCom last read them (TLight's every 30 s, else the Tally page's own read), as tallyLinkOf reads them
function linkRows() {
  const st = (typeof TLight === "object" && TLight.st) || {}, p = (typeof TCloud === "object" && TCloud.pane) || {};
  return ((st.cos && st.cos.length ? st.cos : p.companies) || []).filter((c) => c && c.client_id);
}
// a client's row from what is already here, at once: its name and its Tally company; the other columns fill in a moment later
function quickRow(co, cos, opts, note) {
  const k = cos.filter((c) => String(c.client_id) === String(co.id)).sort((a, b) => String(b.last_seen || "").localeCompare(String(a.last_seen || "")))[0];
  const company = (k && k.company) || "";
  return { key: "c:" + co.id, kind: "client", cid: co.id, co, client: co.name, company, quick: true, act: null, todo: note || "", upload: false, focus: opts.focus === co.id, need: false, fine: false,
    c: company ? { w: YES, note: "Tally company: " + shown(company) } : { w: NO, note: "" }, o: { w: DASH, note: note ? "" : "Checking…" }, l: { w: DASH, note: "" }, e: { w: DASH, note: "" } };
}
export function quickRows(opts) { const cos = linkRows(), o = opts || {}; return live().sort(byName).map((co) => quickRow(co, cos, o)); }

// ---------- next-tally-table (04-Nov-2026; the owner: "now the table is not showing... this tally link is the basic page that
// should work seamlessly"; Sentry "Page blocked" on home/tally from the shared server): the rows are worked out OFF the
// drawing. With staging's books (the held lines, the opening balances, the checks, the summary) one working-out of every
// row cost 100-200 ms at a 4x slower CPU and ran in every drawing of the app, several drawings in one go when answers came
// together: 300-580 ms blocks. Now a drawing takes the rows last worked out (the first drawing: quickRows, at once), and
// asks for them again; the work runs when the browser is free, a few clients at a time (25 ms, then a pause for the page),
// never while the tab is hidden, and draws the page again only when the rows changed. The same rows as tableRows().
export const ROWS = { rows: null, extra: null, sig: "", want: null, dirty: false, busy: false, n: 0, ms: 0 };
const SLICE_MS = 25;
const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 100 }) : setTimeout(fn, 0));
const hiddenNow = () => typeof document === "object" && document.visibilityState === "hidden";
// from the drawing: {rows, extra (the companies open that no client has, the one just linked, the best client; null until
// the first work is done)}
// the rows as last worked out, without asking for them (Advanced's day check: never the page's own options, its focus)
export const rowsLast = () => ROWS.rows || [];
export function rowsFor(opts) {
  // the page's own reads start from the drawing, at its moment, as when the rows were worked out in it (each returns at
  // once when not due); the working-out itself starts none of them (lib/quietReads.js)
  // (the drawing the rows asked for themselves only shows what is here: it starts none; the checks only once there are books,
  // as clientRow asked them, bookFetch)
  if (!ROWS.self) try { const b = summary(); heldFor(""); openingsAll(); if (b && b.length) askStatus(); } catch (e) { /* the next drawing */ }
  ROWS.self = false;
  ROWS.want = Object.assign({}, opts); ROWS.dirty = true;
  if (!ROWS.busy) { ROWS.busy = true; idle(rowsWork); }
  if (ROWS.rows) return { rows: ROWS.rows, extra: ROWS.extra };
  let rows = []; try { rows = quickRows(opts); } catch (e) { rows = []; }
  return { rows, extra: null };
}
function rowsWork() {
  if (hiddenNow()) {
    const on = () => { if (hiddenNow()) return; document.removeEventListener("visibilitychange", on); rowsWork(); };
    document.addEventListener("visibilitychange", on); return;
  }
  ROWS.dirty = false;
  const t0 = Date.now(), opts = Object.assign({}, ROWS.want);
  let own, all, cs;
  const p0 = performance.now();
  try { own = ownState(); } catch (e) { own = { state: "none" }; told(e, "this login's bridge"); }
  opts.own = own;
  const p1 = performance.now();
  try { all = companyRows(); cs = live().sort(byName); }
  catch (e) { told(e, "the companies"); let q = []; try { q = quickRows(opts); } catch (x) { q = []; } return rowsDone(q, null, Date.now() - t0); }
  ROWS.phase = { own: Math.round(p1 - p0), all: Math.round(performance.now() - p1), steps: [] };
  const memo = { twin: new Map(), by: null }, out = [];
  let i = 0;
  const step = () => {
    const a = performance.now(), was = MEMO.cur, q = 1;
    if (!MEMO.off) MEMO.cur = memo;
    QUIET.on += q;
    let fin = null;
    try {
      do { if (i < cs.length) out.push(safeRow(cs[i++], all, opts)); } while (i < cs.length && performance.now() - a < SLICE_MS);
      if (i >= cs.length) {
        const rows = finishRows(out, all, opts), unlinked = openUnlinked(all, own), open = unlinked[0] || null;
        fin = { rows, extra: { own, unlinked, open, best: open && !askFirst(open, all) ? bestFor(open, all) : null, just: justLinked(all), linkedN: all.filter((r) => r.client).length } };
      }
    } catch (e) { told(e, "the table"); fin = { rows: out.length ? out : quickRows(opts), extra: null }; }
    finally { MEMO.cur = was; QUIET.on -= q; }
    ROWS.phase.steps.push(Math.round(performance.now() - a));
    if (fin) rowsDone(fin.rows, fin.extra, Date.now() - t0);
    else setTimeout(step, 0);
  };
  // (the companies and this login's bridge are one piece of work, the rows the next ones: each its own task)
  setTimeout(step, 0);
}
// what the page shows of the rows, to draw it again only when that changed
function rowsSig(rows, x) {
  try {
    return JSON.stringify([rows.map((r) => [r.key, r.client, r.company, r.found, r.c, r.o, r.l, r.e, r.act && [r.act.kind, r.act.label, r.act.day], r.todo, r.upload, r.need, r.fine, r.focus,
      r.open && [r.open.state, r.open.words, r.open.canUse, r.open.why], r.best && r.best.id, r.lKnown, r.quick, r.last]),
      x && [x.unlinked.map((r) => r.company), x.open && x.open.company, x.best && x.best.id, x.just, x.linkedN, x.own && x.own.state]]);
  } catch (e) { return String(Date.now()); }
}
function rowsDone(rows, extra, ms) {
  const sig = rowsSig(rows, extra), first = !ROWS.extra && !!extra;
  Object.assign(ROWS, { rows, extra, ms, busy: false }); ROWS.n++;
  // next-speed-redraw: the table's first full rows at the next frame (the page usable); later ones with the background's drawing
  if (sig !== ROWS.sig) { ROWS.sig = sig; ROWS.self = true; soonDraw({ now: first }); }
  else if (ROWS.dirty) { ROWS.busy = true; idle(rowsWork); }
}
function finishRows(rows, all, opts) {
  const found = new Set(rows.filter((x) => x.found).map((x) => coKey(x.found)));
  openUnlinked(all, opts.own).filter((r) => !found.has(coKey(r.company))).forEach((r) => rows.push(companyRow(r, all, opts.own)));
  rows.forEach((x) => {
    // opening balances that differ or do not balance: said in the row's What to do when nothing else is asked there
    if (x.open && x.open.state !== "same" && !x.act && /^Nothing/.test(x.todo || ""))
      x.todo = x.open.state === "differ" ? "Choose which opening balances to keep (under Ledgers received?)." : "Check the opening balances in See ledgers.";
    x.need = !!x.act || !/^Nothing/.test(x.todo || "") || !!(x.open && x.open.state !== "same");
    x.fine = x.kind === "client" && x.c.w === YES && x.e.w === YES && !(x.open && x.open.state !== "same");
  });
  return rows;
}
// the filters above the table (the design's): each with its count; "Ledgers changed today" only when that is known
export const FILTERS = [["all", "All"], ["need", "Need you"], ["notconn", "Not connected"], ["closed", "Not open in Tally"], ["missing", "Entries missing"], ["ledchg", "Ledgers changed today"], ["opendiff", "Opening balances differ"], ["fine", "All fine"]];
export const PICK = {
  all: () => true,
  need: (r) => r.need,
  notconn: (r) => r.c.w === NO,
  closed: (r) => r.o.w === NO,
  missing: (r) => r.e.w === NO || r.e.w === NOTYET,
  ledchg: (r) => !!(r.l && r.l.change),
  opendiff: (r) => !!(r.open && r.open.state !== "same"),
  fine: (r) => r.fine,
};
export const ledChangeKnown = (rows) => rows.some((r) => r.lKnown);
// the openings filter only once the cloud answers for them (migration 138)
export const openKnown = () => !!OPEN.books;
// search: the client's name or the Tally company's (linked, found or open)
export function matches(r, q) {
  const k = String(q || "").trim().toLowerCase();
  if (!k) return true;
  return [r.client, r.company, r.found, r.c && r.c.note].some((x) => String(x || "").toLowerCase().includes(k));
}
// "3 clients are fine. 2 need you."
export function headWords(rows) {
  const fine = rows.filter((r) => r.fine).length, need = rows.filter((r) => r.need).length, clients = rows.filter((r) => r.kind === "client").length;
  if (!rows.length) return { fine: "No client yet.", need: "" };
  return { fine: clients ? nOf(fine, "client is fine.", "clients are fine.") : "", need: need ? (need === 1 ? "1 needs you." : nf(need) + " need you.") : "Nothing needs you." };
}
// the guided box's step, from real state only:
//   1 no bridge heard from · 2 a bridge heard, no company open in Tally that no client has · 3 such a company open
//   4 a company linked a moment ago (and nothing else waits)
export function guideStep({ installed, unlinked, just }) {
  if (!installed) return 1;
  if (unlinked.length) return 3;
  if (just) return 4;
  return 2;
}
// a company linked while the page is open ("just linked": step 4 for 10 minutes), from the links themselves, whoever made it
const JUST = { linked: null, at: 0, company: "" }, JUST_MS = 10 * 60000;
export function justLinked(all) {
  // (only once the firm's companies are read: their first read is not "just linked")
  const loaded = (typeof TCloud === "object" && TCloud.pane && Array.isArray(TCloud.pane.companies)) || (typeof TLight === "object" && !!TLight.st.loaded);
  if (!loaded) return "";
  const now = new Set(all.filter((r) => r.client).map((r) => coKey(r.company)));
  if (JUST.linked) now.forEach((k) => { if (!JUST.linked.has(k)) { JUST.at = Date.now(); JUST.company = k; } });
  JUST.linked = now;
  return JUST.at && Date.now() - JUST.at < JUST_MS && now.has(JUST.company) ? JUST.company : "";
}
if (typeof window === "object") window.FCTallySimple = { placeOf, onTallyPc, ownBridge, tableRows, rowsFor, quickRows, ROWS, guideStep, ownState, bridgeSay, otherLoginOf, rememberedOwn, firstLinkWait, ownConnOff, LOCALB, rescanLocal, lookOnce, checkAll, checkedSay, connSig, MEMO, missingWords, headWords, JUST, OPEN, LEDN, forget: () => { ledgerChangesForget(); Object.keys(LEDN).forEach((k) => delete LEDN[k]); ASKED_N.clear(); } };
