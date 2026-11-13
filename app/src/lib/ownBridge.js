// This person's OWN FinCom Bridge and their own Tally (next-tally-own-status, 13-Nov-2026; the owner: "Tally open" is only
// ever about the person's own Tally, never another login's or another computer's). The own-bridge rules of 03/05/09-Nov
// (they were in lib/tallySimple.js, which only the Tally page loads) in a small file of their own, loaded once at the
// app's start (parts/TallyIcon.jsx), so every page's Tally words come from the same answer: the top bar's icon, the old
// panel, tallyStatus (src/js/49), a client's words (lib/tallyState.js, lib/linkStatus.js) and the bell (src/js/63).
// window.FCOwn: {state: mineState, bridge: their own bridge or null, place: placeOf, has(company), icon()}. Before this file has
// arrived, and before this computer is looked at, nothing is said of anyone's Tally ("Not connected on this computer", grey).
// Reading and posting are not decided here (src/js/98 tallyServe, postTargetFor: unchanged).
import { coKey, tallyDevs, lastEntry, farLine } from "./tallyState.js";
import { soonDraw } from "./soonDraw.js";

const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
const OWNKEY = () => ((typeof LocalOwner === "object" && LocalOwner && LocalOwner.P) || "tdsdesk:") + "ownbridge";
// (from lib/tallyConnect.js, which reads them from here: the one-click card's look and this one share them)
// next-tally-connectfix (04-Nov-2026): what this browser knows of THIS Windows login's own bridge, without asking it: the
// bridge a 2.5.3 look found in this login's session before (rememberOwn: its id, port and Windows user; each Windows
// login has its own browser profile), and the paired bridge's line in FinCom's cloud (its beat's Windows user and
// bridgePort). {id, user, ports}; empty when nothing is known
export function ownHint() {
  const out = { id: "", user: "", ports: [] }, add = (p) => { p = Number(p) || 0; if (p >= 1 && p <= 65535 && !out.ports.includes(p)) out.ports.push(p); };
  let m = null;
  try { m = JSON.parse(localStorage.getItem(OWNKEY()) || "null"); } catch (e) { m = null; }
  if (m && typeof m === "object") { out.id = String(m.id || ""); out.user = String(m.user || ""); add(m.port); }
  try {
    const c = (typeof Bridge === "object" && Bridge.cfg && Bridge.cfg()) || {};
    const id = out.id || (c.key ? String(c.bridgeId || "") : "");
    const r = id && typeof TCloud === "object" && TCloud.bridgesHeard ? TCloud.bridgesHeard().find((x) => x && x.id === id) : null;
    if (r) { out.id = out.id || id; out.user = out.user || String(r.user || ""); add(r.port); }
  } catch (e) { /* the cloud's list not read yet */ }
  return out;
}
// next-tally-connectfix (finding 4: on a shared server each port that answers is another login's bridge reading the
// computer's TCP table for its /ping): what this tab asked of 127.0.0.1. The look is one at a time (busy); the whole range
// 9100-9199 is asked at most once in this tab by itself, and again only on a person's ask (Connect this computer, I have
// opened it: full)
// next-tally-other-login (05-Nov-2026): gen, a new start (resetHere): a look begun before it never goes on to the range
export const HERE = { busy: null, busyFull: false, fullAt: 0, n: 0, gen: 0 };
// the last look's answer, when it found this login's bridge at this browser's address, in this start, a moment ago: every
// caller takes it (no port asked again)
export const baseNow = () => String((Bridge.cfg() || {}).url || "").replace(/\/+$/, "");
export const lastMine = () => { const L = HERE.last; return L && L.gen === HERE.gen && L.base === baseNow() && Date.now() - L.at < 5000 && L.h.mine ? L.h : null; };

export const NOT_MINE = "Not open in your Tally", AWAY = "Your FinCom Bridge is not connected now", NOT_SET = "Your FinCom Bridge is not set up.";
export const lc = (s) => String(s || "").trim().toLowerCase();
// "PC1\usera" and "usera" are the same login (one side may say no computer); two computers' are not
export const sameUser = (a, b) => { const x = lc(a), y = lc(b); if (!x || !y) return null; if (x.includes("\\") && y.includes("\\")) return x === y; return x.split("\\").pop() === y.split("\\").pop(); };
export const fresh = (at) => !!at && Date.now() - Date.parse(at) < 3 * 60000;
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
export const cfgOf = () => { try { return (typeof Bridge === "object" && Bridge.cfg && Bridge.cfg()) || {}; } catch (e) { return {}; } };

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
      if (changed && typeof document === "object" && document.querySelector("[data-tally-icon]")) soonDraw();
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
// once for this tab at its start (below), and once more the first time the Tally page or the icon's popover asks (a bridge
// started since the app was opened is found there without Check again)
export const lookOnce = () => { if (!LOCALB.n || !LOCALB.page) look(); LOCALB.page = 1; };
// Connect / I have opened it: asked again now
// next-tally-connectfix (finding 4): and the one-click card's look of the whole range 9100-9199 (lib/tallyConnect.js
// lookHere, otherwise once a tab) asked again with it
export const rescanLocal = () => { HERE.again = true; HERE.last = null; look(); };   // (a person's ask: never a moment-old answer)
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
function rememberOwn(x) {
  try { const v = JSON.stringify({ id: x.bridgeId || "", port: Number(x.bridgePort || x.port) || 0, user: x.windowsUser || "" });
    if (localStorage.getItem(OWNKEY()) !== v) localStorage.setItem(OWNKEY(), v); } catch (e) { /* storage blocked: looked for each time */ }
}
export function rememberedOwn() { try { const v = JSON.parse(localStorage.getItem(OWNKEY()) || "null"); return v && (v.id || v.port) ? v : null; } catch (e) { return null; } }
// next-tally-other-login (05-Nov-2026): a bridge older than 2.5.3 cannot tell whose Tally it reads (no sameSession; 2.5.1
// takes every Tally for Windows session 0's), so on a computer where another Windows login has a bridge of the firm its
// companies are never this login's: the page says it is old (bridgeSay), with the Download
export const day = (at) => !!at && Date.now() - Date.parse(at) < 864e5;
const shared = (b, all) => !!b.pc && all.some((x) => x !== b && day(x.at) && lc(x.pc) === lc(b.pc) && sameUser(x.user, b.user) === false);
const unproven = (b, all) => !!b && (!b.version || vk(b.version) < vk(NEED_V)) && shared(b, all);
export function ownBridge() {
  const all = bridgesOf();
  const b = ownBridgeAny(all);
  return b && !b.local && unproven(b, all) ? null : b;
}
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
// bridge 2.5.8 (asks again within 30 s while Tally names no company): step 4's help when it stays
export const NO_CO_HELP = "If the company is already open and this stays more than a minute: in TallyPrime press Alt+F3, then F3 to make sure it is loaded (enter its password or TallyVault if asked), then press Check again.";
const noCo = (o, up) => (up && !o.names.size && !o.why ? Object.assign(o, { noCo: true, why: NO_CO }) : o);
// this login's own Tally answers: its bridge's own sessions (another user's never), else (an older answer) Tally up
const upHere = (st) => { const s = [].concat(st.sessions || []).filter((x) => x && !x.skipped && x.mine !== false); return (st.sessions || []).length ? s.some((x) => x.ok) : !!st.tallyUp; };
export const upBeat = (b) => { const p = [].concat(b.ports || []); return p.length ? p.some((x) => x && x.ok && !x.skipped) : b.tally === true || b.tallyState === "open"; };
// where this browser is: "pc" a Tally computer (a bridge answers here, one is paired here, or this login's own bridge was
// found here before: rememberedOwn, next-tally-own-status), "laptop" (the look found
// none), "unknown" (not looked yet, the look cut at 5 s, or the browser does not let the page reach this computer)
export function placeOf() {
  if (cfgOf().key || (LOCALB.list || []).length || rememberedOwn()) return "pc";
  return LOCALB.list === null || LOCALB.cut || LOCALB.blocked || LOCALB.perm === "denied" ? "unknown" : "laptop";
}
export const onTallyPc = () => placeOf() === "pc";
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
// "yes" | "no" | "checking" | "away" | "none" for a company (own: ownState(), read once for the whole table)
export function localOpen(company, own) {
  const o = own || ownState();
  if (o.state !== "ok") return o.state;
  const k = coKey(company);
  return o.names.has(k) || [...o.names.values()].some((n) => !!(globalThis.LinkRec && LinkRec.same(n, company))) ? "yes" : "no";
}
export const vk = (v) => String(v || "").split(".").map((n) => String(Number(n) || 0).padStart(3, "0")).join(".");

// ---------- every page's words (next-tally-own-status)
// this person's own state for those words: ownState(), but a bridge they are only linked to as a member (how "linked":
// an office bridge seen from a computer with none) is not their own Tally (the owner's decision 2: grey, never another's)
// (asked for every client, company and line a page shows: worked out once for the task that asks, afresh in the next)
let KEPT = null;
export function mineState() {
  if (KEPT) return KEPT;
  // (an error in the rules: "Not connected on this computer", never a "Checking" that stays)
  let o; try { o = ownState(); } catch (e) { o = { state: "none" }; }
  KEPT = o.own && o.own.how === "linked" ? { state: "none" } : o;
  setTimeout(() => { KEPT = null; }, 0);
  return KEPT;
}
const mineBridge = () => { const o = mineState(); return o.own || null; };
// a company open in this person's own Tally now
export const has = (company) => { try { return localOpen(company, mineState()) === "yes"; } catch (e) { return false; } };
// the top bar's icon on the firm's pages, from this person's own bridge only: {icon, word, line}
//   green  Connected: a company is open in their own Tally        amber  their bridge answers, Tally closed or no company
//   grey   their bridge is not connected now · No Tally on this computer (no bridge of theirs: never another's) · Checking
export const NO_TALLY = "No Tally on this computer", NOT_HERE = "Not connected on this computer";
export function icon() {
  const o = mineState();
  if (o.state === "ok") return o.names.size ? { icon: "linked", word: "Connected", line: "Connected to Tally" }
    : { icon: "waiting", word: "Waiting for Tally", line: o.noCo ? "Open a company in your Tally." : "Open your Tally to connect." };
  if (o.state === "away") return { icon: "none", word: "Not connected", line: AWAY + "." };
  // (this computer not looked at yet: "Not connected on this computer", not "no Tally" yet; "Checking" only while it looks)
  return o.state === "checking" ? { icon: "none", word: "Checking", line: "Checking your Tally…" } : { icon: "none", word: LOCALB.list !== null ? NO_TALLY : NOT_HERE, line: "" };
}
// who may be told a computer's own state (its bridge stopped, its Tally closed, its key refused): the owner, and the person
// whose own bridge's computer it is; anyone else is told the data's line only (review of 1d3bce162, M3)
export const sees = (devId) => { try { if (S.account && S.account.me && S.account.me.role === "owner") return true; const b = mineBridge(); return !!devId && !!b && !!b.dev && b.dev.id === devId; } catch (e) { return false; } };
// the data's line of a client (lib/tallyState.js farLine)
// (k: the link as its asker already has it; tallyLine, src/js/49, gives its own: tallyLinkOf asks tallyLine)
export const line = (co, k) => { try { return farLine(lastEntry(co, k || (typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null))); } catch (e) { return farLine(""); } };
if (typeof window === "object") {
  window.FCOwn = { state: mineState, bridge: mineBridge, place: placeOf, has, icon, sees, line, LOCALB };
  // the look on this computer, once for this tab: after the firm's computers are first read (their bridges' ports are
  // asked too), or 6 s; the page is drawn with the answer (look), and now with what is remembered
  let n = 0;
  // (the coordinator, 13-Nov-2026: Chrome asks the person before a page may reach this computer, so the look never runs
  // by itself in a browser that has not been here before: only where this browser holds a bridge's key (paired before),
  // found its own bridge here before, or was already allowed to reach this computer. Otherwise it waits for the Tally
  // page, the icon's popover or Connect (lookOnce, rescanLocal); until then: grey "Not connected on this computer")
  const go = () => { if (LOCALB.n) return;
    if (!((typeof TLight === "object" && TLight.st.loaded) || ++n > 12)) { setTimeout(go, 500); return; }
    if (cfgOf().key || rememberedOwn()) look(); else permOf().then((v) => { if (v === "granted" && !LOCALB.n) look(); }, () => {}); };
  go(); soonDraw();
}
