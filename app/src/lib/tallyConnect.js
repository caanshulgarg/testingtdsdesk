// One click to connect Tally on this computer (28-Oct-2026, next-tally-oneclick; the owner: "There should be a simple
// click to connect and get the company. Don't want to wait for auto connect, just a clickable option").
//
// Why it was needed (staging, 28-Oct-2026): after the staging data was wiped, FinCom Bridge on NWS144 kept the computer
// key of the deleted firm. tally-ingest refused every beat with 401 ("This computer's key is not valid any more"), yet
// nothing on FinCom's side ever made a new key: TCloud.auto (src/js/49) makes one only when the bridge says it has none
// (GET /cloudlink connected:false) — and a bridge with a dead key still says connected:true (bridge-go/cloud.go
// cloudLinkStatus: a key is configured) — and bridgeFollow.follow only moved a bridge that reports to ANOTHER live firm.
// A bridge whose key FinCom no longer knows reports to no firm at all, so it was left alone for ever.
//
// Here (no bridge change; the bridge's existing local API only):
//   connectNow()  finds this computer's FinCom Bridge (/ping, nothing secret sent); this browser's key proven, it asks the
//                 cloud whose the bridge is (tally_bridge_whose) and, unless it already reports to this firm with a fresh
//                 heartbeat, makes a computer key of the signed-in firm (tally_device_create) and hands it over with
//                 POST /cloudlink, exactly as the first connection does. The bridge replaces its old key and says hello
//                 to tally-ingest before it answers, so "Connected" is known at once, not a beat later. A refusal: the
//                 unused key is removed (no pile of keys).
//   keyRefused()  the same question without changing anything: true when the bridge here holds a key FinCom does not
//                 know (reports to no firm, its heartbeat not reaching FinCom).
//   findTally()   the bridge's status asked fresh (/status?fresh=1: the same light company request it always sends) and its
//                 diagnosis (/diagnose: no Tally request): each Tally it sees, its port, whose it is, its companies.
//   usePort(p)    the page's existing Tally pin (bridgePin, src/js/24): FinCom asks only the Tally on that port.
//   typePort(p)   FinCom Bridge 2.4.8 and later (bridge-go/anyport.go): the bridge itself tries the typed port (POST
//                 /ports/use: the same light company request, at most 2 seconds) and keeps it only when it answers as
//                 TallyPrime and is this Windows user's; else its plain reason (nothing listening, not Tally, another
//                 user's Tally, no answer in 2 seconds). An older bridge: the page's pin as before (usePort).
// Every step is bounded (STEP_MS), so nothing spins for ever; each answer is {st, say} in plain words.
/* global Bridge, TCloud, S, bridgePin, bridgeVer */

export const STEP_MS = 20000, LINK_MS = 45000;
const BEAT_FRESH_MS = 120000;

// a promise with a limit: on time, its value; late, an error with the reason given
export function within(p, ms, why) {
  let t;
  ms *= (typeof window !== "undefined" && window.__ocMsScale) || 1;    // the tests: a shorter limit
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((_, no) => { t = setTimeout(() => no({ code: "timeout", message: why }), ms); })]);
}
const msg = (e) => String((e && e.message) || e || "no answer");
const pcName = (st) => (st && st.computer ? st.computer + (st.user ? " (" + String(st.user).split("\\").pop() + ")" : "") : "this computer");
const firmName = () => (typeof S === "object" && S.firm && S.firm.firmName) || "your firm";

// the bridge's own heartbeat, from its /status (beat: {on, last, missedSince}): fresh when FinCom answered it lately
export function beatFresh(beat, now) {
  if (!beat || !beat.on) return false;
  const last = Date.parse(beat.last || "");
  return !!last && !beat.missedSince && (now || Date.now()) - last < BEAT_FRESH_MS;
}
// the bridge's key is dead: the cloud does not know the bridge for any live firm, and its heartbeat does not get through
export function deadKey(whose, beat) {
  return !!whose && !whose.mine && !whose.elsewhere && !beatFresh(beat);
}

// "PC1\usera" and "usera" are the same login (one side may say no computer); two computers' are not; null: not known
const lc = (s) => String(s || "").trim().toLowerCase();
export const sameUser = (a, b) => { const x = lc(a), y = lc(b); if (!x || !y) return null; if (x.includes("\\") && y.includes("\\")) return x === y; return x.split("\\").pop() === y.split("\\").pop(); };
const OWNKEY = () => ((typeof LocalOwner === "object" && LocalOwner && LocalOwner.P) || "tdsdesk:") + "ownbridge";
// next-tally-connectfix (04-Nov-2026): what this browser knows of THIS Windows login's own bridge, without asking it: the
// bridge a 2.5.3 look found in this login's session before (lib/tallySimple.js rememberOwn: its id, port and Windows user;
// each Windows login has its own browser profile), and the paired bridge's line in FinCom's cloud (its beat's Windows user
// and bridgePort). {id, user, ports}; empty when nothing is known
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
// a /ping answer is this login's bridge: its session says so (2.5.3), or (older, or Windows did not say) it is this
// Windows user's with an id, and its Windows user is not another than this login's own bridge's (when both are known)
const isMine = (b, hint) => !!b && (b.sameSession === true || (b.yours !== false && !!b.bridgeId && b.sameSession !== false
  && !(hint.user && b.windowsUser && sameUser(b.windowsUser, hint.user) === false)));
const isOther = (b, hint) => !!b && (b.yours === false || b.sameSession === false || (b.sameSession !== true && !!hint.user && !!b.windowsUser && sameUser(b.windowsUser, hint.user) === false));

// next-tally-connectfix (finding 4: on a shared server each port that answers is another login's bridge reading the
// computer's TCP table for its /ping): what this tab asked of 127.0.0.1. The look is one at a time (busy); the whole range
// 9100-9199 is asked at most once in this tab by itself, and again only on a person's ask (Connect this computer, I have
// opened it: full)
// next-tally-other-login (05-Nov-2026): gen, a new start (resetHere): a look begun before it never goes on to the range
export const HERE = { busy: null, busyFull: false, fullAt: 0, n: 0, gen: 0 };
export function resetHere() { Object.assign(HERE, { busy: null, busyFull: false, fullAt: 0, n: 0, gen: HERE.gen + 1, last: null, lookP: null }); }
// the last look's answer, when it found this login's bridge at this browser's address, in this start, a moment ago: every
// caller takes it (no port asked again)
const baseNow = () => String((Bridge.cfg() || {}).url || "").replace(/\/+$/, "");
export const lastMine = () => { const L = HERE.last; return L && L.gen === HERE.gen && L.base === baseNow() && Date.now() - L.at < 5000 && L.h.mine ? L.h : null; };

// this computer's FinCom Bridge as /ping finds it (nothing secret sent): mine (with its id), another Windows user's, an
// older bridge, or none; known: this login's own bridge is known to exist (installed here, not answering now). First the
// remembered address and this login's own bridge's port (its beat's bridgePort); only when none of them is this login's
// bridge, the whole range (once a tab, or when full)
export function lookHere(opts) {
  const full = !!(opts && opts.full), L = lastMine();
  if (L) return Promise.resolve(L);
  // the Tally page's own look in flight (lib/tallySimple.js look): its answer first
  if (HERE.lookP) return HERE.lookP.then(() => lookHere(opts));
  if (HERE.busy && (HERE.busyFull || !full)) return HERE.busy;
  // a light look in flight and the whole range asked for: that look's answer first; this login's bridge found by it, no range
  if (HERE.busy) return HERE.busy.then((h) => (h && !h.stale && (h.mine || h.ranged) ? h : lookHere(opts)), () => lookHere(opts));
  const p = lookHereOnce(full).finally(() => { if (HERE.busy === p) { HERE.busy = null; HERE.busyFull = false; } });
  HERE.busy = p; HERE.busyFull = full;
  return p;
}
async function lookHereOnce(full) {
  HERE.n++;
  const g = HERE.gen, c = Bridge.cfg(), base = String(c.url || "").replace(/\/+$/, ""), hint = ownHint();
  // (localhost and 127.0.0.1 are one address: told apart by port only)
  const port = (u) => (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) ? Bridge.urlPort(u) : 0), key = (u) => (port(u) ? "p" + port(u) : u), same = (a, b) => key(a || "") === key(b || "");
  const urls = [];
  [base].concat(hint.ports.map((p) => "http://127.0.0.1:" + p)).forEach((u) => { if (u && !urls.some((x) => same(x, u))) urls.push(u); });
  const ask = urls.slice(0, 4);
  let all = (await Promise.all(ask.map((u) => (port(u) ? Bridge.probe(port(u), 2500) : Bridge.probeUrl(u, 2500))))).filter(Boolean);
  // a new start meanwhile (another address, another login's scene): this look ends here, never asking the whole range
  if (HERE.gen !== g || !same(baseNow(), base)) return { mine: null, other: null, old: null, known: false, hint, all, asked: ask.map(port), stale: true, gen: g };
  // finding 3: the remembered address is trusted only when what answers there is this login's (its session or its Windows
  // user); another login's bridge on it (it took the port when this login's stopped): the range is asked at once
  let ranged = false;
  if (!all.some((b) => isMine(b, hint)) && (full || !HERE.fullAt)) {
    HERE.fullAt = Date.now(); ranged = true;
    const asked = new Set(all.map((b) => Number(b.port) || Bridge.urlPort(b.url || "")));
    all = all.concat((await Promise.all(Bridge.PORTS.filter((p) => !asked.has(p)).map((p) => Bridge.probe(p, 2500)))).filter(Boolean));
  }
  const mine = all.find((b) => b.sameSession === true) || all.find((b) => isMine(b, hint)),
    other = all.find((b) => !isMine(b, hint) && isOther(b, hint)), old = all.find((b) => b.yours !== false && !b.bridgeId && b.sameSession !== false && !isOther(b, hint));
  // the remembered address now another login's (or silent) and this login's bridge found elsewhere: remembered there
  if (mine && mine.url && !same(mine.url, base)) {
    const atBase = all.find((b) => same(b.url, base));
    if (!atBase || isOther(atBase, hint)) { try { Bridge.setCfg({ url: mine.url }); Bridge.foundAt = 0; } catch (e) { /* kept as it was */ } }
  }
  // finding 2: this login's own bridge is known (found in this login before, or paired here and heard by the cloud) and is
  // not the one answering: it is installed, only not running in this login
  const known = !mine && !!(hint.user ? !(other && other.windowsUser && sameUser(other.windowsUser, hint.user) === true) : hint.id && !(other && other.bridgeId === hint.id));
  const res = { mine, other, old, known, hint, all, asked: ask.map(port), ranged, gen: g };
  if (HERE.gen === g) HERE.last = { at: Date.now(), gen: g, base, h: res };
  HERE.lastAny = { at: Date.now(), gen: g, h: res };
  return res;
}
// next-tally-connectfix (audit item 8): Chrome's Local Network Access permission (Chrome 142+). Once a person said Block,
// every /ping fails as if no bridge ran, and nothing in the page could say why. The permission's state ("denied" |
// "granted" | "prompt" | "" when the browser does not tell) is asked once and followed (its change event); denied: the
// page says the plain fix and never that the bridge is not running
export const LNA = { st: "", asked: null };
export const LNA_SAY = "Chrome blocked FinCom from talking to FinCom Bridge on this computer: click the icon at the left of the address bar › Local network access › Allow, then reload this page.";
export function checkLna() {
  if (LNA.asked) return LNA.asked;
  LNA.asked = (async () => {
    try {
      if (typeof navigator !== "object" || !navigator.permissions || !navigator.permissions.query) return "";
      for (const name of ["local-network-access", "loopback-network"]) {
        let s = null;
        try { s = await navigator.permissions.query({ name }); } catch (e) { s = null; }
        if (s) { LNA.st = s.state; try { s.onchange = () => { LNA.st = s.state; if (typeof render === "function") render(); }; } catch (e) { /* read again next time */ } return LNA.st; }
      }
    } catch (e) { /* the browser does not say */ }
    return "";
  })();
  return LNA.asked;
}
export const lnaDenied = () => LNA.st === "denied";
if (typeof window !== "undefined") checkLna();
export const START_SAY = "FinCom Bridge is installed but not running in this login: start it from the Start menu (FinCom Bridge).";

// the cloud's view of the bridge (migration 115); null when the cloud cannot say
export async function whoseIs(id) {
  if (!/^go-[0-9a-f]{6,32}$/.test(String(id || ""))) return null;
  try { return await within(TCloud.rpc("tally_bridge_whose", { p_bridge: id }), STEP_MS, "FinCom's cloud did not answer"); } catch (e) { return null; }
}

// a computer key of the signed-in firm, made and handed to the proven bridge (POST /cloudlink). The bridge proves itself
// again in Bridge.call before the key goes; refused: the key just made is removed
let inflight = null;
export function rekey(why) {
  // one at a time: a second asker (the code box's link and the button together) waits for the same key
  if (!inflight) inflight = rekeyOnce(why).finally(() => { inflight = null; });
  return inflight;
}
// next-tally-connectfix (finding 1; staging 29-Oct, 31-Oct, 03-Nov-2026: two computer keys made within a second for one
// bridge, the second refused for ever, "This computer key cannot use bridge go-…: it belongs to …"): a bridge FinCom's
// cloud already has for this firm is bound to its first computer key (migration 54), so a new key for it is always
// refused. Before a key is made: TCloud.auto's own hand-over in this tab finished first, another tab's within the last
// minute waited for, and the cloud asked again; the bridge this firm's: no key made ({already: true})
const REKEY_KEY = "tdsdesk:rekeyAt";
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms * ((typeof window !== "undefined" && window.__ocMsScale) || 1)));
async function stillNeeded() {
  for (let i = 0; i < 30 && typeof TCloud === "object" && TCloud.autoBusy; i++) await pause(500);
  let other = 0;
  try { other = Number(localStorage.getItem(REKEY_KEY) || 0); } catch (e) { other = 0; }
  if (other && Date.now() - other < 60000) await pause(Math.min(15000, 60000 - (Date.now() - other)));
  const w = await whoseIs((Bridge.cfg() || {}).bridgeId || "");
  return !(w && w.mine);
}
async function rekeyOnce(why) {
  if (!(await stillNeeded())) return { already: true };
  try { localStorage.setItem(REKEY_KEY, String(Date.now())); } catch (e) { /* one tab only, then */ }
  if (typeof TCloud === "object") TCloud.autoAt = Date.now() + 60000;   // TCloud.auto makes none meanwhile
  const st = Bridge.st || {};
  const d = await within(TCloud.rpc("tally_device_create", { p_name: String([st.computer || "Office computer", st.user || ""].filter(Boolean).join(" · ")).slice(0, 80) }), STEP_MS, "FinCom's cloud did not make a key for this computer in time. Try again.");
  if (!d || !d.key) throw { message: "FinCom's cloud did not make a key for this computer." };
  let r;
  try { r = await within(Bridge.call("/cloudlink", { url: TCloud.ingestUrl(), key: d.key }, LINK_MS), LINK_MS + 2000, "FinCom Bridge did not finish connecting in time (it needs the internet to reach FinCom). Try again."); }
  catch (e) { try { await TCloud.rpc("tally_device_revoke", { p_id: d.id }); } catch (e2) { /* left unused */ } throw e; }
  TCloud.autoAt = Date.now() + 60000; TCloud.autoErr = "";
  TCloud.rekeyed = { at: Date.now(), why: why || "" };
  return r || {};
}

// true when this browser's proven bridge holds a key FinCom does not know (the page then says so with Connect this
// computer); false when it reports to a firm, or nothing can be told (no key here, an older cloud). Asks no Tally
export async function keyRefused() {
  if (typeof Bridge !== "object" || !Bridge.on() || typeof TCloud !== "object" || !TCloud.on()) return false;
  if (!(await within(Bridge.ensureProven(), 6000, "").catch(() => false))) return false;
  try { await within(Bridge.refresh(false), STEP_MS, ""); } catch (e) { return false; }
  if (Bridge.st.state !== "ok") return false;
  return deadKey(await whoseIs(Bridge.cfg().bridgeId), Bridge.st.beat);
}

// the one click. Returns {st, say, ...}: ok | code (this browser not connected to the bridge yet: its code) | none |
// other | old | blocked | signin | error
export async function connectNow(opts) {
  opts = opts || {};
  if (typeof Bridge !== "object" || Bridge.blocked()) return { st: "blocked", say: "Pages opened inside claude.ai cannot reach programs on this computer. Open FinCom in Chrome or Edge on the Tally computer." };
  if (typeof TCloud !== "object" || !TCloud.on()) return { st: "signin", say: "Sign in to the firm account first." };
  if ((await within(checkLna(), 3000, "").catch(() => "")) === "denied") return { st: "lna", say: LNA_SAY };
  // 1. this browser's key for the bridge here, proven now
  let proven = false;
  if (Bridge.on()) {
    proven = await within(Bridge.ensureProven(), 6000, "").catch(() => false);
    if (!proven) { Bridge.foundAt = 0; await within(Bridge.refind(), 8000, "").catch(() => false); proven = await within(Bridge.ensureProven(), 6000, "").catch(() => false); }
  }
  if (!proven) {
    const h = await within(lookHere({ full: true }), 8000, "").catch(() => ({}));
    if (h.mine) return { st: "code", found: h.mine, say: "Found FinCom Bridge " + (h.mine.version || "") + " on this computer. This browser is not connected to it yet: right-click the FinCom icon near the clock and choose “Connect FinCom on this computer…”. FinCom opens and connects by itself; or type the 6 digits it shows." };
    if (h.old) return { st: "old", say: "An older FinCom Bridge" + (h.old.version ? " (" + h.old.version + ")" : "") + " is running here. Download the new one below and open it: it takes over by itself." };
    // finding 2: this login's own bridge is known (installed here) and only another login's answers: start it, not install
    if (h.known) return { st: "stopped", say: START_SAY };
    if (h.other) return { st: "other", say: "The FinCom Bridge here belongs to another Windows user" + (h.other.windowsUser || h.other.user ? " (" + (h.other.windowsUser || h.other.user) + ")" : "") + ". Install FinCom Bridge while signed in to Windows as you (“Just for me”)." };
    return { st: "none", say: "FinCom Bridge is not running on this computer. Download it below and open it; if it is installed, start it from the Start menu (FinCom Bridge)." };
  }
  // 2. the bridge's own status (no Tally request), its cloud link and the cloud's view of it
  try { await within(Bridge.refresh(false), STEP_MS, "FinCom Bridge did not answer in time."); } catch (e) { return { st: "error", say: msg(e) }; }
  if (Bridge.st.state !== "ok") return { st: "error", say: Bridge.st.error || "FinCom Bridge did not answer." };
  let link = null;
  try { link = await within(Bridge.call("/cloudlink", null, 15000), STEP_MS, "FinCom Bridge did not answer in time."); } catch (e) { return { st: "error", say: msg(e) }; }
  const id = Bridge.cfg().bridgeId || "", whose = await whoseIs(id), pc = pcName(Bridge.st), firm = firmName();
  const same = !!(link && link.connected && link.url === TCloud.ingestUrl());
  const justNow = TCloud.rekeyed && Date.now() - TCloud.rekeyed.at < BEAT_FRESH_MS;
  if (same && whose && whose.mine && (beatFresh(Bridge.st.beat) || justNow) && !opts.force) return { st: "ok", already: true, pc, say: "Connected: " + pc + " sends Tally to " + firm + "." };
  // reports to another live firm: moved here the way a login change moves it (asked of the cloud, never mid-posting)
  if (whose && whose.elsewhere) {
    try {
      const moved = window.loadBridgeFollow ? await (await window.loadBridgeFollow()).follow() : false;
      if (moved && !TCloud.followWait) return { st: "ok", pc, say: "Connected: " + pc + " now sends Tally to " + firm + "." };
      return { st: "error", say: TCloud.followWait ? "Not yet: " + TCloud.followWait + " in the other firm. FinCom tries again in a minute." : "This bridge sends to another firm, and FinCom's cloud did not move it (only a member who may write can)." };
    } catch (e) { return { st: "error", say: msg(e) }; }
  }
  // finding 1: the cloud already has this bridge for this firm (bound to its first computer key, heard from): a new key
  // would be refused for ever, so none is made. Its heartbeat is asked for now (the wake the Tally page already sends)
  if (whose && whose.mine) {
    try { if (typeof TWake === "object" && TWake.send) TWake.send({ kind: "wake", what: "active" }); } catch (e) { /* the next beat comes by itself */ }
    if (TCloud.refreshPane) Promise.resolve(TCloud.refreshPane()).catch(() => {});
    if (link && link.connected) return { st: "ok", already: true, waiting: !beatFresh(Bridge.st.beat), pc, say: beatFresh(Bridge.st.beat) ? "Connected: " + pc + " sends Tally to " + firm + "." : "Connected: " + pc + " is " + firm + "’s; waiting for its first heartbeat." };
    return { st: "error", held: true, pc, say: "FinCom’s cloud already has this FinCom Bridge for " + firm + " under its first computer key, but the bridge holds no key now. An owner can press “Release this bridge's identity” on the Tally page (For support), then Connect this computer again." };
  }
  const why = !same ? "not connected" : whose && !whose.mine ? "key not known to FinCom" : "asked";
  try {
    const r = await rekey(why);
    if (r && r.already) return { st: "ok", already: true, waiting: true, pc, say: "Connected: " + pc + " is " + firm + "’s; waiting for its first heartbeat." };
    if (TCloud.refreshPane) Promise.resolve(TCloud.refreshPane()).catch(() => {});
    return { st: "ok", pc, fresh: true, replaced: same, say: "Connected: " + pc + " sends Tally to " + (r.firm || firm) + (same && why !== "asked" ? ". Its old key (not valid any more) was replaced." : ".") };
  } catch (e) {
    return { st: "error", say: "Connecting " + pc + " to " + firm + " did not work: " + msg(e) };
  }
}

// each Tally the bridge here sees: {port, mine, ok, state, companies, user, error}; plus the diagnosis' TallyPrimes (port,
// owner) when none answers. Asks Tally only the light company request the bridge always sends
export async function findTally() {
  if (typeof Bridge !== "object" || !Bridge.on()) return { st: "noconnect", say: "Connect this computer first." };
  try { await within(Bridge.refresh(true), STEP_MS, "FinCom Bridge did not answer in time (Tally may be busy: a message box or a long report open in Tally)."); }
  catch (e) { return { st: "error", say: msg(e) }; }
  const st = Bridge.st;
  if (st.state !== "ok") return { st: "error", say: st.error || "FinCom Bridge did not answer." };
  const list = [].concat(st.sessions || []).map((s) => ({ port: Number(s.port) || 0, mine: s.mine !== false && !s.skipped, ok: !!s.ok && !s.skipped, busy: !!s.busy,
    user: s.user || "", error: s.error || "", companies: [].concat(s.companies || []).map((c) => c.name).filter(Boolean) }));
  let diag = null;
  if (!list.some((x) => x.ok && x.mine)) { try { diag = await within(Bridge.diagnose(), STEP_MS, ""); } catch (e) { diag = null; } }
  const pin = Number((Bridge.cfg() || {}).port) || 0;
  const mine = list.filter((x) => x.ok && x.mine && (!pin || x.port === pin));
  if (mine.length) return { st: "found", list, pin, say: mine.map((x) => "TallyPrime on port " + x.port + ": " + (x.companies.length ? x.companies.length + (x.companies.length === 1 ? " company" : " companies") + " open" : "no company open")).join(" · ") };
  const tallies = diag && !diag.error ? [].concat(diag.tallies || []) : [];
  const fix = [].concat((diag && diag.findings) || []).find((f) => f && f.level !== "ok");
  return { st: "none", list, pin, tallies, fix: fix ? fix.text + (fix.fix ? " " + fix.fix : "") : "",
    say: pin ? "No TallyPrime answers on port " + pin + " on this computer." : "No TallyPrime answers FinCom Bridge on this computer." };
}

// the page's own Tally pin (src/js/24 bridgePin): only the Tally on that port is asked; 0: back to automatic
export function usePort(p) {
  const n = Number(String(p || "").replace(/\D/g, "")) || 0;
  if (n && (n < 1 || n > 65535)) return false;
  if (typeof bridgePin === "function") bridgePin(n); else Bridge.setCfg({ port: n });
  return true;
}

// 2.4.8: the bridge here takes a typed port itself (POST /ports/use); an older one only knows the page's pin
export const ANYPORT_VERSION = "2.4.8";
export function bridgeTakesPort() {
  const v = typeof Bridge === "object" && Bridge.st && Bridge.st.version;
  if (!v) return false;
  const k = (x) => String(x || "").split(".").map((n) => String(Number(n) || 0).padStart(3, "0")).join(".");
  return (typeof bridgeVer === "function" ? bridgeVer(v) >= bridgeVer(ANYPORT_VERSION) : k(v) >= k(ANYPORT_VERSION));
}

// Use this port: a 2.4.8 bridge tries it and keeps it only when it is your own TallyPrime ({st: "ok"|"refused"|"bad"|
// "error", say}); 0: automatic again. An older bridge: the page's pin, as before ({st: "pinned"})
export async function typePort(p) {
  const n = Number(String(p == null ? "" : p).replace(/\D/g, "")) || 0;
  if (n > 65535) return { st: "bad", say: "Type a port number from 1 to 65535 (TallyPrime: F1 → Settings → Connectivity)." };
  if (!bridgeTakesPort()) return usePort(n) ? { st: "pinned", port: n } : { st: "bad", say: "Type a port number from 1 to 65535." };
  let j;
  try { j = await within(Bridge.call("/ports/use", { port: n }, 15000), STEP_MS, "FinCom Bridge did not answer in time."); }
  catch (e) { return { st: e && e.code === "bridge" ? "refused" : "error", port: n, say: msg(e) }; }
  usePort(n); // the page asks only that Tally, as before (0: automatic)
  if (!n) return { st: "ok", port: 0, say: "FinCom Bridge finds your TallyPrime by itself again." };
  const cos = [].concat(j.companies || []);
  return { st: "ok", port: n, companies: cos, say: "Your TallyPrime answered on port " + n + " (" + (cos.length ? cos.length + (cos.length === 1 ? " company" : " companies") + " open" : "no company open") + "). FinCom Bridge keeps this port." };
}

// the companies open in the Tally found (the same request as Find Tally; read again when older than 10 seconds)
export async function getCompanies() {
  if (typeof Bridge !== "object" || !Bridge.on()) return { st: "noconnect", say: "Connect this computer first." };
  if (!(Bridge.st && Bridge.st.state === "ok" && Date.now() - (Bridge.st.at || 0) < 10000)) {
    try { await within(Bridge.refresh(true), STEP_MS, "FinCom Bridge did not answer in time (Tally may be busy: a message box or a long report open in Tally)."); }
    catch (e) { return { st: "error", say: msg(e) }; }
  }
  const st = Bridge.st;
  if (st.state !== "ok") return { st: "error", say: st.error || "FinCom Bridge did not answer." };
  if (!st.tallyUp) return { st: "none", list: [], say: "TallyPrime is not answering on this computer. Press Find Tally." };
  const list = [].concat(st.open || []).map((o) => ({ company: o.name, gstin: o.gstin || "", port: o.port }));
  return { st: list.length ? "found" : "none", list, say: list.length ? list.length + (list.length === 1 ? " company" : " companies") + " open in Tally." : "Tally is open, but no company is open in it. Open your company in TallyPrime, then press Get companies again." };
}

// next-tally-linknow (28-Oct-2026; the owner: "FinCom should not deny. If I click, it should link it."). A company open in
// Tally that FinCom's cloud has no row for yet (the bridge reports its companies every 5 minutes; on staging the owner's
// five clicks on "Salesify Marketing LLP 2026-27" were refused meanwhile): tally-ingest's "link_now" registers it for the
// device of the firm that runs this browser's own bridge (else one whose beat has it open) and links it, in one call.
// The answer's row goes into what this page shows at once, so the row says Linked without a reload
export const LINKNOW_MS = 30000;
export const cloudKnows = (company) => [].concat((typeof TLight === "object" && TLight.st && TLight.st.cos) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.companies) || [])
  .some((r) => r && r.company === company);
export async function linkNow(company, cid) {
  if (typeof TCloudUp !== "object") throw new Error("Sign in to the firm account first.");
  const bridge = typeof Bridge === "object" && Bridge.cfg ? String(Bridge.cfg().bridgeId || "") : "";
  const j = await within(TCloudUp.post({ kind: "link_now", company, client: cid, bridge }, {}), LINKNOW_MS, "FinCom's cloud did not answer in time (the internet on this computer?). Press Link again.");
  const row = { company, client_id: cid, device_id: (j && j.device) || "", gstin: "", last_seen: new Date().toISOString(), linked_at: new Date().toISOString(), linked_by: "" };
  [(typeof TLight === "object" && TLight.st && TLight.st.cos) || null, (typeof TCloud === "object" && TCloud.pane && TCloud.pane.companies) || null]
    .forEach((list) => { if (Array.isArray(list) && !list.some((r) => r && r.company === company)) list.push(Object.assign({}, row)); });
  return j;
}

// for support and the tests (tests/run_tally_connect_norekey.py, run_tally_here_light.py)
if (typeof window !== "undefined") window.FCTallyConnect = { connectNow, lookHere, HERE, resetHere, ownHint, rekey, START_SAY, LNA, LNA_SAY, checkLna, getCompanies, findTally };
