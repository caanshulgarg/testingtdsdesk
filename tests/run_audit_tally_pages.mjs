// node tests/run_audit_tally_pages.mjs - the audit of 22-Nov-2026 (track sync-speed-tally, tally-pages.json): the Tally
// page's own state (app/src/lib) on made-up computers, logins and companies. AUDIT_APP: another app/src folder (the code
// before the fixes: each part fails there).
//   1. this login's bridge answers but this browser holds no key yet: "connect this browser" (the code), never "not running"
//   2. the bridge answers here but FinCom's cloud refuses its key, or has not heard it for 3 minutes: never green Connected
//   3. the first-link watcher's whole-range look backs off and stops by itself
//   4. Connect this computer: no answer in time is not a refusal; the new key is kept when the bridge took it
//   5. Link: this browser's bridge is named only when the company is open in its own Tally
//   6. the list of companies open and not linked: never another login's
//   7. a client's word before lib/linkStatus.js is here: the same four words (Linked, Waiting for Tally, Not linked)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.AUDIT_APP || path.join(HERE_DIR, "..", "app", "src");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const G = globalThis;
const store = {};
G.window = G; G.__ocMsScale = 0.01;
G.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
G.TLight = { st: { loaded: true, devs: [], cos: [] } };
G.S = { firm: { firmName: "MADE UP FIRM" }, companies: {}, account: { me: { role: "owner" } } };
G.render = () => {};
let cfg = { url: "http://127.0.0.1:9103", key: "", bridgeId: "go-abc123" };
G.Bridge = { cfg: () => cfg, on: () => !!cfg.key, blocked: () => false, urlPort: (u) => Number((String(u).match(/:(\d+)/) || [])[1] || 0), st: { state: "off" } };
G.TCloud = { pane: { devices: [], companies: [], links: [] }, on: () => true, me: () => "u1" };
const tick = () => new Promise((r) => setTimeout(r, 5));   // (mineState keeps its answer for the task that asks)
const imp = (f) => import(pathToFileURL(path.join(APP, f)).href);
const OB = await imp("lib/ownBridge.js");
const TC = await imp("lib/tallyConnect.js");
const TS = await imp("lib/tallyState.js");

// ------------------------------------------------------------------ 1
console.log("== 1. found here, not connected to this browser yet");
OB.LOCALB.list = [{ sameSession: true, bridgeId: "go-abc123", port: 9103, bridgePort: 9103, version: "2.5.10", windowsUser: "MADEUP-PC\\made.up", bridge: true }];
let o = OB.ownState();
await tick(); const ic1 = OB.icon();
ok(o.state === "away" && o.unpaired === true, "1. this login's bridge with no key here: away, unpaired (" + o.state + ", " + o.unpaired + ")");
ok(!/not running|not connected now/i.test(ic1.line) && /6-digit code/.test(ic1.line), "1. the icon says to type its code, not that it is not running (" + ic1.line + ")");

// ------------------------------------------------------------------ 2
console.log("== 2. the cloud refuses the key, or does not hear the bridge");
cfg = Object.assign({}, cfg, { key: "made-up-key" });
const now = new Date().toISOString(), old = new Date(Date.now() - 10 * 60000).toISOString();
G.Bridge.st = { state: "ok", sameSession: true, user: "MADEUP-PC\\made.up", tallyUp: true, sessions: [{ port: 9000, ok: true, mine: true, companies: [{ name: "MADE UP CO" }] }], open: [{ name: "MADE UP CO", mine: true }], beat: { on: true, last: old, missedSince: old } };
await tick();
o = OB.ownState();
ok(o.state === "ok" && o.cloud === "nobeat", "2. its heartbeat missed for 10 minutes: said (" + o.cloud + ")");
const ic2 = OB.icon();
ok(ic2.word !== "Connected" && ic2.icon !== "linked", "2. the top-bar icon is not green Connected (" + ic2.icon + " " + ic2.word + ")");
await tick();
OB.HERE.refused = true;
G.Bridge.st.beat = { on: true, last: old, missedSince: new Date(Date.now() - 60000).toISOString() };
o = OB.ownState();
ok(o.cloud === "refused" && OB.icon().word !== "Connected", "2. its key refused: said, not Connected (" + o.cloud + ", " + OB.icon().word + ")");
await tick();
G.Bridge.st.beat = { on: true, last: now, missedSince: "" };
ok(!OB.ownState().cloud, "2. a refusal found before, then the heartbeat answered (a new key): over");
await tick();
OB.HERE.refused = false;
o = OB.ownState();
ok(o.state === "ok" && !o.cloud && OB.icon().word === "Connected", "2. heard and accepted: Connected (" + OB.icon().word + ")");

// ------------------------------------------------------------------ 3
console.log("== 3. the whole range of ports, by itself");
if (typeof OB.fullDue !== "function") ok(false, "3. a rule for the whole-range look (none: every 30 s for ever)");
else {
  const t0 = 1e12, m = 60000;
  ok(OB.fullDue(t0 + 40000, t0, t0) === true, "3. in the first 2 minutes: every 30 s");
  ok(OB.fullDue(t0 + 5 * m, t0, t0 + 4 * m) === false && OB.fullDue(t0 + 5 * m, t0, t0 + 2.9 * m) === true, "3. until 10 minutes: every 2 minutes");
  ok(OB.fullDue(t0 + 11 * m, t0, t0) === false && OB.fullDue(t0 + 60 * m, t0, 0) === false, "3. after 10 minutes: no more by itself");
}

// ------------------------------------------------------------------ 4
console.log("== 4. Connect this computer when the bridge answers late");
async function rekeyCase(mineAfter) {
  const calls = [];
  let whose = 0;
  cfg = { url: "http://127.0.0.1:9103", key: "made-up-key", bridgeId: "go-abc123" };
  G.TCloud = Object.assign(G.TCloud, { autoBusy: false, ingestUrl: () => "https://made-up.example/functions/v1/tally-ingest",
    rpc: async (fn) => { calls.push(fn); if (fn === "tally_device_create") return { id: "dev-made-up", key: "new-key" }; if (fn === "tally_bridge_whose") { whose++; return { mine: whose > 1 && mineAfter, elsewhere: false }; } return { ok: true }; } });
  G.Bridge.call = async () => { throw { code: "timeout", message: "FinCom Bridge did not finish connecting in time" }; };
  delete store["tdsdesk:rekeyAt"];
  let r = null, err = null;
  try { r = await TC.rekey("key not known to FinCom"); } catch (e) { err = e; }
  return { calls, r, err };
}
let c4 = await rekeyCase(true);
ok(!c4.err && !c4.calls.includes("tally_device_revoke"), "4. the bridge took the key after the page stopped waiting: the key is kept (" + c4.calls.join(", ") + ")");
c4 = await rekeyCase(false);
ok(!!c4.err && c4.calls.includes("tally_device_revoke"), "4. the bridge still not this firm's: the unused key is removed (" + c4.calls.join(", ") + ")");

// ------------------------------------------------------------------ 5
console.log("== 5. Link names this browser's bridge only for its own company");
const sent = [];
G.TCloudUp = { post: async (b) => { sent.push(b); return { ok: true, device: "dev-made-up" }; } };
G.Bridge.st = { state: "ok", open: [{ name: "MADE UP CO", mine: true }] };
await TC.linkNow("OTHER LOGIN CO", "c9");
await TC.linkNow("MADE UP CO", "c1");
ok(sent[0].bridge === "" && sent[1].bridge === "go-abc123", "5. another login's company: no bridge named (" + JSON.stringify(sent.map((x) => x.bridge)) + ")");

// ------------------------------------------------------------------ 6
console.log("== 6. companies open and not linked");
G.devState = () => ({ bridge: "online" }); G.TCloud.pane.companies = []; G.TLight.st.cos = [];
G.TLight.st.devs = [{ id: "d1", info: { beat: { open: ["MADE UP CO", "OTHER LOGIN CO"] } } }];
G.FCOwn.open = () => ({ theirs: (r) => r.company === "OTHER LOGIN CO", elsewhere: () => false });
const un = TS.unlinkedOpen();
ok(un.includes("MADE UP CO") && !un.includes("OTHER LOGIN CO"), "6. another login's company is not offered (" + un.join(", ") + ")");

// ------------------------------------------------------------------ 7
console.log("== 7. a client's word before the link words are loaded");
G.tallyLinkOf = () => ({ state: "linked", company: "MADE UP CO", line: { state: "open", computer: "" } });
G.TCloud.on = () => false;
const w7 = TS.clientTallyState({ id: "c1", name: "MADE UP CLIENT" });
ok(w7.word === "Linked", "7. linked and open: Linked, the word every other place uses (" + w7.word + ")");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
