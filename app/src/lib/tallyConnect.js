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

// this computer's FinCom Bridge as /ping finds it (nothing secret sent): mine (with its id), another Windows user's, an
// older bridge, or none. The configured address first, then the user's range at once
export async function lookHere() {
  const c = Bridge.cfg(), first = await Bridge.probeUrl(c.url.replace(/\/+$/, ""), 2500);
  let all = first ? [first] : [];
  if (!(first && first.yours !== false && first.bridgeId)) all = all.concat((await Promise.all(Bridge.PORTS.map((p) => Bridge.probe(p, 2500)))).filter(Boolean));
  const mine = all.find((b) => b.yours !== false && b.bridgeId), other = all.find((b) => b.yours === false), old = all.find((b) => b.yours !== false && !b.bridgeId);
  return { mine, other, old };
}

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
async function rekeyOnce(why) {
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
  // 1. this browser's key for the bridge here, proven now
  let proven = false;
  if (Bridge.on()) {
    proven = await within(Bridge.ensureProven(), 6000, "").catch(() => false);
    if (!proven) { Bridge.foundAt = 0; await within(Bridge.refind(), 8000, "").catch(() => false); proven = await within(Bridge.ensureProven(), 6000, "").catch(() => false); }
  }
  if (!proven) {
    const h = await within(lookHere(), 8000, "").catch(() => ({}));
    if (h.mine) return { st: "code", found: h.mine, say: "Found FinCom Bridge " + (h.mine.version || "") + " on this computer. This browser is not connected to it yet: right-click the FinCom icon near the clock and choose “Connect FinCom on this computer…”. FinCom opens and connects by itself; or type the 6 digits it shows." };
    if (h.other) return { st: "other", say: "The FinCom Bridge here belongs to another Windows user" + (h.other.user ? " (" + h.other.user + ")" : "") + ". Install FinCom Bridge while signed in to Windows as you (“Just for me”)." };
    if (h.old) return { st: "old", say: "An older FinCom Bridge" + (h.old.version ? " (" + h.old.version + ")" : "") + " is running here. Download the new one below and open it: it takes over by itself." };
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
  const why = !same ? "not connected" : whose && !whose.mine ? "key not known to FinCom" : "asked";
  try {
    const r = await rekey(why);
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
