// The simple Tally page (02-Nov-2026, next-tally-simple; the owner, a CA: "every word understandable by anyone"; the approved
// design "Tally — Yes or No"). One row a client (and a row for each company open in Tally that no client has), each
// column answered Yes / No / Not yet / — with one short note, and at most one thing to do. Everything here is read from
// what FinCom already holds (the links, the computers' beats, the books in FinCom's cloud, the held lines, the first sync,
// the books being brought); nothing new is asked of the bridge, the cloud or Tally.
//   Client · Linked to Tally? · Open in Tally right now? · Ledgers received? · All entries received? · What to do
// No computer's name anywhere here (the owner: "no computer names like NWS144"); For support keeps those.
import { companyRows, twinOf, alikeOf, yearOf, ledgersOf, ledgersHeld, daybookHeld, cloudBook, ledBook, ledgerChanges, ledgerChangesForget } from "../parts/TallyCompanies.jsx";
import { seenWords, coKey, lastEntry, tallyDevs } from "./tallyState.js";
import { bookSum, bookFetch, pctOf, etaWords, summary, askStatus } from "../parts/TallyFetch.jsx";
import { needDays } from "./needDays.js";
// migration 136 (next-held-settle): a client's held lines, one period, with the Day Book upload preset to it
import { heldFor } from "../parts/HeldBlock.jsx";
import { soonDraw } from "./soonDraw.js";
import { QUIET } from "./quietReads.js";
import { HERE, ownHint, lastMine } from "./tallyConnect.js";
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
if (typeof window === "object") { keepAnswers("tallyNameKey", 1); keepAnswers("nameScore", 2); keepAnswers("clientNameFromTally", 1); }
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
export const NOT_MINE = "Not open in your Tally", AWAY = "Your FinCom Bridge is not connected now", NOT_SET = "Your FinCom Bridge is not set up.";
const lc = (s) => String(s || "").trim().toLowerCase();
// "PC1\usera" and "usera" are the same login (one side may say no computer); two computers' are not
const sameUser = (a, b) => { const x = lc(a), y = lc(b); if (!x || !y) return null; if (x.includes("\\") && y.includes("\\")) return x === y; return x.split("\\").pop() === y.split("\\").pop(); };
const fresh = (at) => !!at && Date.now() - Date.parse(at) < 3 * 60000;
// every bridge on the firm's computers (revoked ones left out by tallyDevs): {dev, id, user, open, at, port, beat}
export function bridgesOf() {
  const out = [];
  tallyDevs().forEach((d) => {
    const info = d.info || {}, beat = info.beat || {}, br = info.bridges || {}, ids = Object.keys(br);
    ids.forEach((id) => {
      const b = br[id] || {}, user = b.user || (ids.length === 1 ? info.user || beat.windowsUser : "") || "";
      // the computer's beat is this bridge's when it is the only one there, the main one, or of the same Windows user
      const beatMine = ids.length === 1 || d.main_bridge === id || sameUser(beat.windowsUser, user) === true;
      const at = [b.at || "", beatMine ? beat.at || "" : ""].sort().pop();
      const open = Array.isArray(b.open) ? b.open : beatMine ? [].concat(beat.open || []) : [];
      // bridge 2.5.3: each Windows login's bridge has its own port of 9100..9199, said in its beat (bridgePort)
      const port = Number(b.bridgePort || (beatMine ? beat.bridgePort : 0)) || 0;
      out.push({ dev: d, id, user, open: open.map((n) => String((n && n.name) || n || "")).filter(Boolean), at, port, beat: beatMine ? beat : b,
        version: String(b.version || (beatMine ? beat.version : "") || ""), pc: String(b.computer || info.computer || beat.computer || "") });
    });
  });
  return out;
}
const cfgOf = () => { try { return (typeof Bridge === "object" && Bridge.cfg && Bridge.cfg()) || {}; } catch (e) { return {}; } };

// ---------- bridge 2.5.3 (next-tally-samesession; the owner, 03-Nov-2026: one FinCom login for everyone on the shared
// server, each Windows login its own bridge): the browser finds its OWN Windows login's bridge by itself. /ping (nothing
// secret sent) on 127.0.0.1 at the firm's bridges' ports (their beats' bridgePort), 9103 and 9100..9110, all at once,
// short waits. The bridge says sameSession: true (this browser runs in its owner's Windows session), false (another
// session: never this user's), "unknown" (Windows did not say). 2.5.2 and older say nothing: as before.
// next-fix-probe-loop (03-Nov-2026; build mw0mxsrv-dd8f8d at review/: "Site is crashing.. not working properly", rolled
// back): drawing the page NEVER asks the network. The look was started from inside ownState(), i.e. from every drawing of
// the Tally page, and its answer drew the whole app again (render), so a drawing could start a look whose answer drew the
// page, which looked again (2-minute clock, a beat with another port) and drew again. Now: localBridges() only reads; the
// look runs once per tab (lookOnce, from the Tally page once its computers are read) and on an explicit ask (rescanLocal:
// Connect, I have opened it), one at a time; its answer draws the page only when it changed and the Tally page is shown.
export const LOCALB = { list: null, busy: false, at: 0, ports: "", sig: "", n: 0 };
const PROBE_MS = 900;
const isNew = (b) => !!b && Object.prototype.hasOwnProperty.call(b, "sameSession");
function portsToTry() {
  const ps = new Set([9103]);
  for (let p = 9100; p <= 9110; p++) ps.add(p);
  bridgesOf().forEach((b) => { if (b.port >= 9100 && b.port <= 9199) ps.add(b.port); });
  return [...ps].sort((a, b) => a - b);
}
// what the last look found (null: not looked yet); reads only, whoever calls it, as often as the page is drawn
export const localBridges = () => LOCALB.list;
const sigOf = (xs) => JSON.stringify(xs.map((x) => [Number(x.bridgePort || x.port) || 0, x.bridgeId || "", x.sameSession, x.windowsUser || "", x.version || ""]));
function look() {
  if (typeof Bridge !== "object" || !Bridge.probe || (Bridge.blocked && Bridge.blocked())) { LOCALB.blocked = true; if (LOCALB.list === null) LOCALB.list = []; return; }
  LOCALB.blocked = false;
  if (LOCALB.busy) return;            // an ask while asking is that same look
  LOCALB.busy = true;
  const gen = ++LOCALB.n, ports = portsToTry(); LOCALB.ports = ports.join(",");
  // next-hang-watch: Chrome's own leave for a site to reach this computer's apps (Local Network Access; Chrome 142+): a
  // page that may not reach 127.0.0.1 finds no bridge, and says so in those words (bridgeSay)
  permOf().then((v) => { LOCALB.perm = v; }, () => {});
  // next-tally-table: the look never holds the page. Each /ping stops at PROBE_MS; whatever has not settled after 5 s (a
  // browser that holds a request to this computer while it asks the person) counts as nothing found, and the page says so
  setTimeout(() => { if (gen === LOCALB.n && LOCALB.busy) { LOCALB.busy = false; LOCALB.cut = true; if (LOCALB.list === null) { LOCALB.list = []; soonDraw(); } } }, 5000);
  // next-tally-other-login (05-Nov-2026): the remembered address first: this browser's address and this login's own bridge's
  // port; the firm's other ports only when neither answers as this login's bridge (sameSession true)
  const ask = (ps) => Promise.all(ps.map((p) => Promise.resolve().then(() => Bridge.probe(p, PROBE_MS)).catch(() => null)));
  const sure = (xs) => xs.some((x) => x && x.sameSession === true);
  // the one-click card's look in flight (lib/tallyConnect.js lookHere, the same remembered address first) is waited for
  // and its answers used: no port asked twice. A new start meanwhile (resetHere) or another address: asked again from
  // that address, never the other ports for the old one
  const g = HERE.gen, u0 = String(cfgOf().url || ""), asked = new Set();
  // (waited for at most a second: a card's look gone on to the range, or a Tally that never answers, never holds this one)
  const stage1 = Promise.race([Promise.resolve(HERE.busy || lastMine()).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 1000))]).then((h) => {
    if (HERE.gen !== g) return null;   // (a new start while waiting: asked again, from the new start)
    const had = h && !h.stale && h.gen === HERE.gen ? [].concat(h.all || []).filter(Boolean) : [];
    if (h && !h.stale && h.gen === HERE.gen) [].concat(h.asked || [], had.map((x) => Number(x.port) || 0)).forEach((p) => asked.add(p));
    if (sure(had)) return had;
    let hint = []; try { hint = ownHint().ports; } catch (e) { hint = []; }
    const first = [...new Set([Bridge.urlPort ? Bridge.urlPort(cfgOf().url || "") : 0].concat(hint))].filter((p) => p >= 1 && !asked.has(p));
    first.forEach((p) => asked.add(p));
    return ask(first).then((ys) => had.concat(ys.filter(Boolean)));
  });
  // its answer is every caller's a moment later (HERE.last), and the card's look waits for it (HERE.lookP)
  const lp = HERE.lookP = stage1.then((xs) => { const m = (xs || []).find((x) => x && x.sameSession === true);
    if (m && HERE.gen === g) HERE.last = { at: Date.now(), gen: g, base: u0.replace(/\/+$/, ""), h: { mine: m, other: null, old: null, known: false, hint: { id: "", user: "", ports: [] }, all: xs, asked: [...asked], gen: g } }; }, () => {})
    .finally(() => { if (HERE.lookP === lp) HERE.lookP = null; });
  stage1.then(async (xs) => (!xs ? null : sure(xs) ? xs : HERE.gen !== g || String(cfgOf().url || "") !== u0 ? null : xs.concat(await ask(ports.filter((p) => !asked.has(p))))))
    .then((xs) => xs && xs.filter((x) => x && (x.bridge || x.version)), () => [])
    .then((list) => {
      if (gen !== LOCALB.n) return;    // (a look started over meanwhile: its answer counts, not this one)
      if (!list) { LOCALB.busy = false; look(); return; }
      fixRemembered(list, ports);
      const sig = sigOf(list), changed = LOCALB.list === null || sig !== LOCALB.sig;
      Object.assign(LOCALB, { list, sig, at: Date.now(), busy: false, cut: false });
      // (a later task: never inside the drawing that asked; only when it changes what the Tally page or a picker shows)
      if (changed && typeof document === "object" && document.querySelector("#app [data-tally-simple], [data-tlk-pick-box], [data-tally-pop-link]")) soonDraw();
    }, () => { LOCALB.busy = false; if (LOCALB.list === null) LOCALB.list = []; });
}
// next-tally-connectfix (finding 3; staging: after another login's bridge took this login's old port 9102, this browser's
// remembered bridge address pointed at that login's bridge until a full scan): the look found this login's own bridge
// (sameSession true) and the remembered address (Bridge.cfg().url) is another login's now, or silent on a port just asked:
// the own bridge's address is remembered instead, at once
function fixRemembered(list, ports) {
  try {
    const pk = localPick(list);
    if (!pk || !pk.sure || typeof Bridge !== "object" || !Bridge.setCfg) return;
    const norm = (u) => String(u || "").replace(/\/+$/, ""), u = norm(cfgOf().url), mineU = norm(pk.x.url || "http://127.0.0.1:" + Number(pk.x.bridgePort || pk.x.port));
    // (localhost and 127.0.0.1 at the same port are the same address: kept as saved)
    if (!mineU || u === mineU || (Bridge.localUrl && !Bridge.localUrl(u)) || (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) && Bridge.urlPort(u) === Bridge.urlPort(mineU))) return;
    const at = list.find((x) => norm(x.url) === u), port = Bridge.urlPort ? Bridge.urlPort(u) : 0;
    const otherNow = at ? at.sameSession === false || (!!at.windowsUser && !!pk.x.windowsUser && sameUser(at.windowsUser, pk.x.windowsUser) === false) : ports.includes(port);
    if (otherNow) { Bridge.setCfg({ url: mineU }); Bridge.foundAt = 0; }
  } catch (e) { /* kept as it was */ }
}
function permOf() {
  try {
    if (typeof navigator !== "object" || !navigator.permissions || !navigator.permissions.query) return Promise.resolve("");
    const q = (name) => navigator.permissions.query({ name }).then((r) => r.state, () => "");
    return q("loopback-network").then((a) => a || q("local-network-access"));
  } catch (e) { return Promise.resolve(""); }
}
// once for this tab (the Tally page, once the firm's computers are read: their ports are asked too)
export const lookOnce = () => { if (!LOCALB.n) look(); };
// Connect / I have opened it: asked again now
// next-tally-connectfix (finding 4): and the one-click card's look of the whole range 9100-9199 (lib/tallyConnect.js
// lookHere, otherwise once a tab) asked again with it
export const rescanLocal = () => { HERE.again = true; HERE.last = null; look(); };   // (a person's ask: never a moment-old answer)
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
// when nothing changed: "Checked 14:32: the office Tally is connected (2 bridges, Tally open in 2). This computer has no
// FinCom Bridge." From the bridges' Tally (a bridge heard but Tally closed is not "connected"); "This computer's FinCom
// Bridge" only for one found here (never the member's link to an office bridge); the browser's block and a look still
// going said so. lead: a sentence first (the Tally box: the client's own state)
const hhmm = () => { const d = new Date(), p = (x) => String(x).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); };
const nBr = (n) => n + (n > 1 ? " bridges" : " bridge");
// a bridge of the firm (bridgesOf) whose Tally is open: a company open there, or its beat's ports say so
export const tallyOpenOn = (b) => !!(b.open.length || upBeat(b.beat || {}));
export function checkedSay(lead) {
  const at = "Checked " + hhmm() + ": ";
  try {
    const o = ownState(), own = o.own || {}, here = o.from === "here" || !!own.local || own.how === "found" || own.how === "unsure";
    const on = bridgesOf().filter((b) => b.at && Date.now() - Date.parse(b.at) < 3 * 60000), k = on.filter(tallyOpenOn).length;
    const office = !on.length ? "no FinCom Bridge of the firm is online." : k ? "the office Tally is connected (" + nBr(on.length) + ", Tally open in " + k + ")."
      : nBr(on.length) + " online, but Tally is not open.";
    const me = LOCALB.busy ? "Still looking on this computer." : LOCALB.perm === "denied" ? BLOCKED
      : here ? (o.state === "ok" ? "This computer's FinCom Bridge is connected." : "This computer's FinCom Bridge is not answering.")
      : own.how === "linked" ? "This computer has no FinCom Bridge: your login uses the office's."
      : o.own ? "This computer's FinCom Bridge does not answer here." : "This computer has no FinCom Bridge.";
    return at + (lead ? lead + ". " + office.charAt(0).toUpperCase() + office.slice(1) : office) + " " + me;
  } catch (e) { return at + "could not tell, see above."; }
}
// the connection as the words saw it: the words go when it changes (Tally page: UI().said)
export function connSig() { try { const o = ownState(); return [o.state, (o.own || {}).how, bridgesOf().filter((b) => b.at && Date.now() - Date.parse(b.at) < 3 * 60000).length, LOCALB.perm].join("|"); } catch (e) { return ""; } }
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
// the firm's bridge (bridgesOf) a local /ping answer is: its id (given with "yours"), its port, else its Windows user
function cloudOf(x, all) {
  return (x.bridgeId && all.find((b) => b.id === x.bridgeId)) || (Number(x.bridgePort || x.port) && all.find((b) => b.port && b.port === Number(x.bridgePort || x.port)))
    || (x.windowsUser && all.find((b) => sameUser(b.user, x.windowsUser) === true)) || null;
}
// the local answer that is this firm's bridge b (or null)
function localOf(b, list) {
  return (list || []).find((x) => (x.bridgeId && x.bridgeId === b.id) || (b.port && Number(x.bridgePort || x.port) === b.port) || (x.windowsUser && sameUser(b.user, x.windowsUser) === true)) || null;
}
// this browser's own bridge among the local answers: {x, sure} | null
export function localPick(list) {
  const xs = list || [], t = xs.filter((x) => x.sameSession === true);
  if (t.length) return { x: t[0], sure: true };
  if (xs.length === 1 && xs[0].sameSession === "unknown") return { x: xs[0], sure: false };
  return null;
}
// next-hang-watch (04-Nov-2026; the owner, in one Windows login of the shared server: "while tally is open still system is not
// recognising the tally"): the own bridge a 2.5.3 look found (sameSession true) is remembered in this browser. Each Windows
// login has its own browser profile, so its own storage: when a later look finds nothing (the bridge stopped, or the
// browser did not let the page reach 127.0.0.1), the page still knows which bridge is this login's and shows its beat
// from FinCom's cloud, saying so (ownState: from "beat", how "remembered")
const OWNKEY = () => ((typeof LocalOwner === "object" && LocalOwner && LocalOwner.P) || "tdsdesk:") + "ownbridge";
function rememberOwn(x) {
  try { const v = JSON.stringify({ id: x.bridgeId || "", port: Number(x.bridgePort || x.port) || 0, user: x.windowsUser || "" });
    if (localStorage.getItem(OWNKEY()) !== v) localStorage.setItem(OWNKEY(), v); } catch (e) { /* storage blocked: looked for each time */ }
}
export function rememberedOwn() { try { const v = JSON.parse(localStorage.getItem(OWNKEY()) || "null"); return v && (v.id || v.port) ? v : null; } catch (e) { return null; } }
// next-tally-other-login (05-Nov-2026): a bridge older than 2.5.3 cannot tell whose Tally it reads (no sameSession; 2.5.1
// takes every Tally for Windows session 0's), so on a computer where another Windows login has a bridge of the firm its
// companies are never this login's: the page says it is old (bridgeSay), with the Download
const day = (at) => !!at && Date.now() - Date.parse(at) < 864e5;
const shared = (b, all) => !!b.pc && all.some((x) => x !== b && day(x.at) && lc(x.pc) === lc(b.pc) && sameUser(x.user, b.user) === false);
const unproven = (b, all) => !!b && (!b.version || vk(b.version) < vk(NEED_V)) && shared(b, all);
export function ownBridge() {
  const all = bridgesOf();
  const b = ownBridgeAny(all);
  return b && !b.local && unproven(b, all) ? null : b;
}
// next-tally-link-any-bridge: src/js/98-link-record.js tallyServe prefers this browser's own bridge
if (typeof globalThis === "object") globalThis.tallyOwnBridge = ownBridge;
function ownBridgeAny(all) {
  const c = cfgOf(), list = localBridges() || [];
  // (0) bridge 2.5.3: the local bridge in this browser's own Windows session (beats the pairing and the member link)
  const pk = localPick(list);
  if (pk) {
    if (pk.sure) rememberOwn(pk.x);
    const b = cloudOf(pk.x, all);
    const base = b || { dev: null, id: pk.x.bridgeId || "", user: pk.x.windowsUser || "", open: [], at: "", port: Number(pk.x.bridgePort || pk.x.port) || 0, beat: {} };
    return Object.assign({}, base, { how: pk.sure ? "found" : "unsure", local: pk.x });
  }
  // a bridge saying sameSession false is never this user's
  const notMine = (b) => { const x = localOf(b, list); return !!x && x.sameSession === false; };
  // (0b) the bridge found here before (rememberOwn), while no local bridge says it is this session's
  const m = rememberedOwn();
  const rb = m ? all.find((b) => (m.id && b.id === m.id) || (!m.id && m.port && b.port === m.port && sameUser(b.user, m.user) !== false)) : null;
  if (rb && !notMine(rb)) return Object.assign({ how: "remembered" }, rb);
  // (a) paired in this browser
  const a = c.key && c.bridgeId ? all.find((b) => b.id === c.bridgeId) : null;
  if (a && !notMine(a)) return Object.assign({ how: "paired" }, a);
  // (b) linked to the signed-in member: only when no 2.5.3 bridge answers here (the owner's laptop; older bridges: as before)
  if (list.some(isNew)) return null;
  const me = typeof TCloud === "object" && TCloud.me ? TCloud.me() : "";
  const l = me && ((typeof TCloud === "object" && TCloud.pane && TCloud.pane.links) || []).find((x) => x && x.user_id === me && x.bridge_id);
  const b = l ? all.find((x) => x.id === l.bridge_id && (!l.device_id || x.dev.id === l.device_id)) : null;
  // next-tally-other-login (staging, 05-Nov-2026: one FinCom login for every Windows login, linked to one login's bridge;
  // a browser in another login that did not find its own bridge showed that login's Tally): never on a computer where
  // another Windows login has a bridge of the firm (the link names one login of many); a laptop keeps it
  const pl = placeOf();
  return b && !notMine(b) && pl !== "unknown" && !(pl === "pc" && shared(b, all)) ? Object.assign({ how: "linked" }, b) : null;
}
// what this browser's look on 127.0.0.1 says when it found no bridge of this Windows login (null when it found one, or has
// not looked yet): an older bridge that is this Windows user's (2.5.2 and older say nothing of the session, so FinCom can't
// tell which login's Tally it serves) | none of this login's answering (other logins' bridges did) | nothing answered at all
export const NEED_V = "2.5.3";
// the newest FinCom Bridge (this site's latest.json, as the Tally page reads it; lib/connectSteps.js keeps it), named
// when a bridge here is too old
export const BRIDGE = { latest: "2.5.4" };
export const BLOCKED = "This browser does not let FinCom reach FinCom Bridge on this computer. Allow it: the icon left of the address › Site settings › Local network access › Allow, then reload this page.";
export function bridgeSay(list0) {
  const list = list0 === undefined ? localBridges() : list0;
  if (!list || localPick(list)) return null;
  // next-tally-connectfix (audit item 8): the browser's leave to reach this computer refused: that, never "not running"
  if (LOCALB.perm === "denied") return { kind: "blocked", words: BLOCKED };
  const old = list.find((x) => !isNew(x) && x.yours !== false);
  if (old) return { kind: "old", version: String(old.version || ""), words: "Your FinCom Bridge is old (" + (old.version || "before " + NEED_V) + "). Install " + BRIDGE.latest + " to connect this login’s Tally." };
  if (!list.length && LOCALB.perm === "denied") return { kind: "blocked", words: BLOCKED };
  return { kind: list.length ? "notrunning" : "nothing", words: "FinCom Bridge is not running in this Windows login: start it, or install it." +
    (list.length ? "" : " If it is running, choose Allow when the browser asks to let this site reach apps on this computer.") };
}
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
// (c) the bridge answering this browser, when it is the own bridge (else null)
function hereIfOwn(own) {
  try {
    if (typeof Bridge !== "object" || Bridge.blocked() || !Bridge.on()) return null;
    const st = Bridge.st || {};
    if (st.state !== "ok") return null;
    // found by its session (2.5.3): the bridge this browser reads is it when it is at its address
    if (own.local) { const p = Bridge.urlPort ? Bridge.urlPort(cfgOf().url || "") : 0; return p && p === Number(own.local.port) && st.sameSession !== false ? st : null; }
    const u = sameUser(st.user, own.user), id = !!cfgOf().bridgeId && cfgOf().bridgeId === own.id;
    return u === true || (u === null && id) ? st : null;
  } catch (e) { return null; }
}
// bridge 2.5.3's plain reasons: why none of this user's Tallys answers (tallyWhy, each port's reason), and Tally's
// connection switched on (tallyConnectSay)
function whyOf(src) {
  const s = src || {}, why = shown(s.tallyWhy), say = shown(s.tallyConnectSay);
  let words = "";
  if (why) {
    if (/^no tally running/i.test(why)) words = "Tally is not open in your Windows login.";
    else {
      const per = [...new Set([].concat(s.ports || s.sessions || []).filter((p) => p && (p.reason || p.error) && lc(p.reason || "") === lc(why))
        .map((p) => shown(p.error && lc(p.error).startsWith(lc(p.reason || why)) ? p.error : p.reason || p.error)).filter(Boolean))];
      words = "Tally is open but FinCom can’t use it: " + (per.length ? per.join("; ") : why);
    }
  }
  return { why: words, say };
}
// next-tally-other-login: this login's own Tally open with no company loaded: said plainly (never another login's company)
export const NO_CO = "Tally is open, but no company is open in it. Open your company in TallyPrime: it shows here within a minute.";
const noCo = (o, up) => (up && !o.names.size && !o.why ? Object.assign(o, { noCo: true, why: NO_CO }) : o);
// this login's own Tally answers: its bridge's own sessions (another user's never), else (an older answer) Tally up
const upHere = (st) => { const s = [].concat(st.sessions || []).filter((x) => x && !x.skipped && x.mine !== false); return (st.sessions || []).length ? s.some((x) => x.ok) : !!st.tallyUp; };
const upBeat = (b) => { const p = [].concat(b.ports || []); return p.length ? p.some((x) => x && x.ok && !x.skipped) : b.tally === true || b.tallyState === "open"; };
// where this browser is: "pc" a Tally computer (a bridge answers here, or one is paired here), "laptop" (the look found
// none), "unknown" (not looked yet, the look cut at 5 s, or the browser does not let the page reach this computer)
export function placeOf() {
  if (cfgOf().key || (LOCALB.list || []).length) return "pc";
  return LOCALB.list === null || LOCALB.cut || LOCALB.blocked || LOCALB.perm === "denied" ? "unknown" : "laptop";
}
export const onTallyPc = () => placeOf() === "pc";
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
export function ownState() {
  const list = localBridges();
  // the first look on this computer not done yet (at most a second)
  if (list === null && LOCALB.busy) return { state: "checking" };
  const own = ownBridge(), say = bridgeSay(list);
  if (!own) return { state: "none", say };
  const st = hereIfOwn(own), unsure = own.how === "unsure";
  // (another Windows user's Tally on this computer, when the bridge says so, is not this user's)
  const by = (ns) => new Map(ns.filter(Boolean).map((n) => [coKey(n), String(n)]));
  if (st) return noCo(Object.assign({ state: "ok", from: "here", own, unsure, names: by([].concat(st.open || []).filter((x) => x && x.mine !== false).map((x) => x.name)) }, whyOf(st.tallyWhy != null ? st : own.beat)), upHere(st));
  if (fresh(own.at)) return noCo(Object.assign({ state: "ok", from: "beat", own, unsure, names: by(own.open), far: own.how === "remembered" && !!say && (say.kind === "blocked" ? "blocked" : "far") }, whyOf(own.beat)),
    upBeat(own.beat || {}));
  // this browser holds the own bridge's key, its first answer not read yet
  const c = cfgOf(), b = typeof Bridge === "object" ? Bridge.st || {} : {};
  if (!own.local && c.key && c.bridgeId === own.id && b.state === "off" && !b.error) return { state: "checking", own };
  return { state: "away", own, unsure, say };
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
// "yes" | "no" | "checking" | "away" | "none" for a company (own: ownState(), read once for the whole table)
export function localOpen(company, own) {
  const o = own || ownState();
  if (o.state !== "ok") return o.state;
  const k = coKey(company);
  return o.names.has(k) || [...o.names.values()].some((n) => !!(globalThis.LinkRec && LinkRec.same(n, company))) ? "yes" : "no";
}
export const BRING_WHY = "Open this company in Tally first";
// next-tally-connectfix (finding 6): why the computer a company is linked to does not bring its ledgers, in words, only
// when its beat (heard now) shows it cannot: the company not open in its Tally and none of the Tallys it sees answering
// for it (each skipped, or none answers). Its FinCom Bridge older than 2.5.3 (2.5.3 no longer skips a Tally whose owner
// Windows did not say): "Waiting for FinCom Bridge in the linked Windows login to update to 2.5.3"; else "FinCom Bridge
// in the linked Windows login can't see this Tally". No computer or login named on this page (the owner's rule; For
// support names them). "" when nothing says so (or not known)
export const WAIT_OLD = "Waiting for FinCom Bridge in the linked Windows login to update to ", WAIT_BLIND = "FinCom Bridge in the linked Windows login can’t see this Tally";
const vk = (v) => String(v || "").split(".").map((n) => String(Number(n) || 0).padStart(3, "0")).join(".");
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
    const r = mine[0] || null, here = !!r && oo.has(r);
    Object.assign(row, { r, found: r ? r.company : "",
      c: { w: NO, note: r ? "Found in Tally: “" + shown(r.company) + "”" : "", connect: here },
      o: { w: DASH, note: "" }, l: { w: DASH, note: "Come after connecting" }, e: { w: DASH, note: "" } });
    if (here) row.todo = "Press Connect.";
    else if (r) { row.act = { kind: "connect", label: "Link" }; row.todo = "Link it to the Tally company shown."; }
    else { row.act = { kind: "pickco", label: "Link" }; row.todo = "Open its company in Tally, then press Link."; }
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
  // next-tally-ledgers-button (04-Nov-2026): not yet or stuck, the button "Bring ledgers from Tally" (firstSync, now: the
  // ledgers wake and, through the cloud, Update now); it can run when the company is open in Tally on this user's own
  // computer or on any computer FinCom hears now, else one plain line
  // next-link-follow (migration 146): where the book is read from (another login's Tally when the linked one is offline or
  // lacks it), or the linked computer offline with the company open in no other Tally: said on the row, never a silent queue
  const rw = readWhere(company);
  row.where = rw && rw.text ? { kind: rw.kind, text: rw.text } : null;
  const anyOpen = open || all.some((r) => r.open && coKey(r.company) === coKey(company)) || !!(rw && rw.sv);
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
    row.act = { kind: "upload", label: "Upload Day Book", run: hb.upload };
    row.todo = hb.n === 1 ? "1 change saved in Tally is not in FinCom yet. Upload the Day Book for those days." : nf(hb.n) + " changes saved in Tally are not in FinCom yet. Upload the Day Book for those days.";
  } else if (fill && Number(fill.waiting) > 0) {
    row.e = { w: NOTYET, note: "Bringing " + nOf(fill.total, "missing day", "missing days") + (Number(fill.etaMin) > 0 ? " · " + etaWords(fill.etaMin) + " left" : "") };
  } else if (p) {
    const pc = pctOf(p);
    row.e = { w: NOTYET, note: (days ? "" : "New client · ") + pc + "% received" + (Number(p.etaMin) > 0 ? " · " + etaWords(p.etaMin).replace(/^about /, "") + " left" : ""), pct: Math.max(2, pc) };
  } else if ((hd.length && !again) || need.length) {
    const words = missingWords(hd.length ? hd.map((d) => ({ from: d, to: d })) : need);
    row.e = { w: NO, note: words || "Some entries are missing" };
    if (hd.length) { row.act = { kind: "upload", label: "Upload Day Book", day: iso(hd[0]) }; row.todo = "Tally could not send these entries. Upload that day’s Day Book."; }
    else if (canFetch) { row.act = { kind: "bring", label: "Bring missing days", need }; row.todo = anyOpen ? "Press the button: FinCom brings them from Tally." : "Open the company in Tally, then press the button."; }
    else { row.act = { kind: "upload", label: "Upload Day Book", day: iso(need[need.length - 1].from) }; row.todo = "Upload the Day Book for those days."; }
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
    else if (stuck && !held) { row.todo = "Keep the company open in Tally, then press Bring ledgers from Tally."; row.upload = true; }
    else if (row.l.bring && anyOpen && !p && !(fill && Number(fill.waiting) > 0)) { row.todo = "Press Bring ledgers from Tally."; row.upload = true; }
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
  const best = bestFor(r, all);
  return { key: "t:" + coKey(r.company), kind: "company", r, company: r.company, client: "", best,
    c: { w: NO, note: "Open in Tally: “" + shown(r.company) + "”" }, o: openCell(localOpen(r.company, own), own), l: { w: DASH, note: "Come after connecting" }, e: { w: DASH, note: "" },
    act: { kind: "choose", label: best ? "Link" : "Link to a client" }, todo: best ? "Link it to client “" + best.name + "”." : "Choose which client it is.", upload: false };
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
        fin = { rows, extra: { own, unlinked, open, best: open ? bestFor(open, all) : null, just: justLinked(all), linkedN: all.filter((r) => r.client).length } };
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
