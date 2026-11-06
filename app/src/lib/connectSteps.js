// Connect Tally in six live steps (next-tally-connect-steps, 06-Nov-2026; the owner: "still it is very cumbersome to
// connect tally.. pls give a clear flow.. instructions to connect the tally and their reliability is still a problem").
// ONE source of the steps and their words, for THIS browser's own Windows login (a shared server: each login runs its
// own TallyPrime on its own port and its own FinCom Bridge):
//   1. FinCom Bridge running in this Windows login     (the look on 127.0.0.1, its beat; an old one: update)
//   2. TallyPrime running in this login                 (the bridge's tallyWhy and ports)
//   3. Tally's connection on, with this login's port    (tallyWhy "connection off" + tallyConnectSay: mode off, the port
//                                                         held by another Tally (whose, and a free port), set but not on)
//   4. A company open in your Tally                     (this login's own companies only)
//   5. Company linked to a client                       (the Tally page's rows: Link / Connect; first time only)
//   6. Reading from Tally                               (the linked row's ledgers and entries)
// Each step is done ✓, "now" (the first one not done: its one instruction and one button) or "later". The Tally page's
// checklist (parts/TallySimple.jsx), the client's Tally box (TallyCompanies.jsx stallWhy, lib/linkStatus.js, the Tally
// icon's popover) and the top bar's Tally icon (parts/TallyIcon.jsx: globalThis.FCConnectNow) say the SAME step's words.
// A browser with no bridge (a laptop): "Do these steps on the computer or server where TallyPrime runs", with the firm's
// state, and no per-login steps. Nothing new is asked of the bridge or Tally: what ownState() (lib/tallySimple.js), the
// beats and the rows already hold. Never another login's company, and never the firm's state shown as this login's.
import { ownState, ownBridge, localBridges, LOCALB, placeOf, bridgeSay, bridgesOf, ownConnOff, NEED_V, BRIDGE, BLOCKED, NO_CO, YES } from "./tallySimple.js";
import { tallyDevs } from "./tallyState.js";
import { freePort, portHowWords } from "./tallyPort.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
const short = (u) => String(u || "").split("\\").pop().trim();
const vk = (v) => String(v || "").split(".").map((n) => String(Number(n) || 0).padStart(3, "0")).join(".");
const nOf = (n, one, many) => n + " " + (n === 1 ? one : many);
const fresh = (at) => !!at && Date.now() - Date.parse(at) < 3 * 60000;

export const TITLES = ["FinCom Bridge running in this Windows login", "TallyPrime running in this login", "Tally’s connection on, with this login’s own port",
  "A company open in your Tally", "Company linked to a client", "Reading from Tally"];
export const LAPTOP = "Do these steps on the computer or server where TallyPrime runs: open FinCom there, in the Windows login that runs TallyPrime.";
// (no bridge answered here: this may still be the Tally computer, with the bridge stopped or the browser not let in)
export const LAPTOP_HERE = "If TallyPrime runs on this computer, FinCom Bridge is not running in this Windows login: start it, or install it; if the browser asks to let this site reach apps on this computer, choose Allow.";
export const WORDS = {
  checking: "Looking for FinCom Bridge in this Windows login…",
  none: "Download FinCom Bridge and run it while signed in to this Windows login. It installs just for you: no administrator is needed.",
  first: "On the computer or server where TallyPrime runs, download FinCom Bridge and run it in the Windows login that runs TallyPrime. It installs just for you: no administrator is needed.",
  away: "FinCom Bridge is installed in this Windows login but is not running now. Start it from the Start menu (FinCom Bridge); if it is not there, download it and run it again: it keeps its settings.",
  // (the old and not-running words are bridgeSay's, lib/tallySimple.js, as the table's rows say them; the step adds the how)
  update: "Download it and run it in this login: it updates in place and keeps its settings.",
  install: "Download installs it just for you: no administrator is needed.",
  tally: (login, other) => "Open TallyPrime in this Windows login" + (login ? " (" + login + ")" : "") + "." + (other ? " The Tally FinCom sees on this computer is the Tally of " + other + ", not yours." : "") + " This step ticks by itself.",
  admin: "TallyPrime seems to run as administrator, so FinCom Bridge can’t tell it is yours. Close TallyPrime and open it again normally (not “Run as administrator”).",
  mode: (free) => "Your Tally’s connection is off. " + portHowWords(free),
  clash: (port, who, free) => "Your Tally’s port " + port + " is taken by " + (who ? "the Tally of " + who : "another program (on a shared server, usually another login’s Tally)") +
    ", so your Tally takes no connection. Give it a port of its own, " + free + ". " + portHowWords(free),
  maybeOff: (free) => "If TallyPrime is already open here, its connection may be off: " + portHowWords(free),
  // (the bridge's tally.ini says every login of this computer shares these settings, or this login may not change them)
  shared: "Careful: every Windows login that runs this TallyPrime shares these settings, so changing the port here changes it for all of them. If another login’s Tally then stops connecting, give each login its own TallyPrime folder.",
  cantWrite: "If TallyPrime does not keep the change, this Windows login may not change TallyPrime’s settings: make the change once as a user who may.",
  reopen: "Your Tally’s connection is set but not on yet. Close TallyPrime and open it again once.",
  notanswering: "TallyPrime is open in this login but does not answer FinCom. Close any message or report open in Tally; if it stays, close TallyPrime and open it again once.",
  noco: () => NO_CO,
  link: (co, client) => "“" + shown(co) + "” is open in your Tally. " + (client ? "Link it to client “" + client + "”." : "Choose which client it is."),
  rowsWait: "Reading your clients…",
  linkAny: "Link the company open in your Tally to its client in the list below.",
  reading: (co, what, todo) => "Reading “" + shown(co) + "”: " + what + ". " + todo,
};

// this login's Windows user ("made-up-a"): its own bridge's, else what the bridge answering in this session says
function loginOf(o) {
  const list = localBridges() || [], x = list.find((y) => y && y.sameSession === true) || list.find((y) => y && !Object.prototype.hasOwnProperty.call(y, "sameSession") && y.yours !== false);
  return short((o && o.own && o.own.user) || (x && x.windowsUser) || "");
}
// the computer a device's beats come from
const pcOfDev = (d) => { const i = (d && d.info) || {}, b = i.beat || {}; return lc(i.computer || b.computer || Object.values(i.bridges || {}).map((x) => x && x.computer).find(Boolean) || ""); };
// this login's computer's devices (every Windows login's key on it), and every port seen on it in their beats
function onThisPc(own) {
  const pc = lc(own && own.pc), devs = tallyDevs();
  return pc ? devs.filter((d) => pcOfDev(d) === pc) : devs.filter((d) => own && own.dev && d.id === own.dev.id);
}
// next-tally-basics (the port problem, option A, the page's part): THIS login's own port, the same number every time. Counted
// from the login's name (freePort), skipping only the ports another login of this computer uses (their beats' ports,
// Tally ports and bridges, and a port this login's bridge saw held by another login's Tally): never this login's own
// earlier tries, so the number does not move from one look to the next, and never one another login uses
export function ownPort(devs, login, held) {
  const me = lc(login), used = new Set([].concat(held || []).map(Number).filter((p) => p > 0));
  const mine = (u) => !!me && lc(short(u)) === me;
  devs.forEach((d) => { const i = d.info || {}, b = i.beat || {}, own = mine(b.windowsUser || i.user);
    [].concat(b.ports || []).forEach((p) => { if (p && Number(p.port) > 0 && (!own || p.skipped)) used.add(Number(p.port)); });
    if (!own && Number(b.tallyPort) > 0) used.add(Number(b.tallyPort));
    Object.values(i.bridges || {}).forEach((x) => { if (x && Number(x.tallyPort) > 0 && !mine(x.user)) used.add(Number(x.tallyPort)); }); });
  return freePort(used, login);
}
// whose Tally holds port n on this computer: a beat's "Tally of <user>" for that port, else another login's bridge on it
function holderOf(devs, n, me) {
  let who = "";
  devs.forEach((d) => { const i = d.info || {}, b = i.beat || {};
    [].concat(b.ports || []).forEach((p) => { const m = p && Number(p.port) === n && /^tally of (.+)$/i.exec(String(p.error || "").trim());
      if (!who && m && !/windows session|another windows user/i.test(m[1])) who = short(m[1]); });
    Object.values(i.bridges || {}).forEach((x) => { if (!who && x && Number(x.tallyPort) === n && x.user && lc(short(x.user)) !== lc(me)) {
      const ok = [].concat(b.ports || []).some((p) => p && Number(p.port) === n && p.ok && !p.skipped);
      if (ok || fresh(x.at)) who = short(x.user); } }); });
  return lc(who) === lc(me) ? "" : who;
}
// another login's Tally the bridge sees ("Tally of <user>", skipped): for step 2's words
function otherTally(ports) {
  const p = [].concat(ports || []).find((x) => x && x.skipped && /^tally of (.+)$/i.test(String(x.error || "")) && !/windows session|another windows user/i.test(String(x.error)));
  return p ? short(String(p.error).replace(/^tally of /i, "")) : "";
}

// the six steps: {mode: login | laptop, login, steps: [{n, key, title, state: done | now | later, say, act, hook}], now, firm}
// opts: {latest (the setup's version), rows, extra (the Tally page's rows and their extra: rowsFor)}
export function connectSteps(opts) {
  const o0 = opts || {}, place = placeOf();
  if (o0.latest && /^\d+(\.\d+)+$/.test(String(o0.latest)) && vk(o0.latest) > vk(BRIDGE.latest)) BRIDGE.latest = String(o0.latest);
  // (a browser with no bridge while the firm has none heard either: the first time, maybe on the Tally computer itself:
  // step 1 with where to do it, never "do these steps elsewhere" alone)
  const week = (at) => !!at && Date.now() - Date.parse(at) < 7 * 864e5;
  const first = place === "laptop" && !tallyDevs().some((d) => week(((d.info || {}).beat || {}).at || d.last_seen));
  if (place === "laptop" && !first) return { mode: "laptop", login: "", steps: TITLES.map((title, i) => ({ n: i + 1, title, state: "later", say: "" })), now: null, firm: firmWords(o0.rows) };
  let own; try { own = ownState(); } catch (e) { own = { state: "none" }; }
  const login = loginOf(own), steps = [];
  const put = (key, done, say, act, hook, doneSay) => steps.push({ n: steps.length + 1, key, title: TITLES[steps.length], done: !!done, say: say || "", doneSay: doneSay || "", act: act || null, hook: hook || "" });
  // 1. the bridge
  const b = own.own || null, ver = String((b && (b.version || (b.local && b.local.version))) || "");
  // (this login's own bridge, found and heard: done, whatever its version; an older one is said, never a block: one that
  // cannot tell whose Tally it reads on a shared computer is never taken as this login's, ownBridge)
  if (own.state === "ok") put("bridge", true, "", null, "", "FinCom Bridge" + (ver ? " " + ver : "") + " is running in this login" + (ver && o0.latest && vk(ver) < vk(o0.latest) ? " (" + o0.latest + " is ready: Download it to update)" : ""));
  else if (own.state === "checking" || (localBridges() === null && !LOCALB.cut)) put("bridge", false, WORDS.checking, null, "checking");
  else {
    const s = own.say || bridgeSay() || { kind: "nothing" };
    if (s.kind === "blocked") put("bridge", false, BLOCKED, { kind: "check" }, "blocked");
    else if (s.kind === "old") put("bridge", false, s.words + " " + WORDS.update, { kind: "download" }, "old");
    else if (own.state === "away") put("bridge", false, WORDS.away, { kind: "check" }, "away");
    else if (first) put("bridge", false, WORDS.first, { kind: "download" }, "first");
    else put("bridge", false, (s.words ? s.words + " " + WORDS.install : WORDS.none), { kind: "download" }, s.kind || "none");
  }
  // 2 and 3: TallyPrime in this login and its connection, from this login's own bridge only
  const here = own.from === "here" && typeof Bridge === "object" ? Bridge.st || {} : null;
  const src = (here && here.tallyWhy != null ? here : (b && b.beat)) || {}, ports = [].concat((here && here.sessions && here.sessions.length ? here.sessions : src.ports) || []);
  const mineP = ports.filter((p) => p && !p.skipped && p.mine !== false), okP = mineP.find((p) => p.ok);
  const names = own.names || new Map();
  const up = names.size > 0 || !!okP || (!ports.length && (!!src.tallyUp || src.tally === true || src.tallyState === "open" || src.tallyState === "busy"));
  const why = lc(src.tallyWhy), say = String(src.tallyConnectSay || "");
  const connOff = why === "connection off" || (!why && !up && !!ownConnOff(own));
  const ok1 = steps[0].done;
  if (!ok1) { put("tally", false); put("connect", false); }
  else if (up) { put("tally", true, "", null, "", "TallyPrime is running in this login"); put("connect", true, "", null, "", "Tally’s connection is on" + (okP && okP.port ? " (port " + okP.port + (holderOf(onThisPc(b), Number(okP.port), login) ? ", also used by another login’s Tally" : ", this login’s own") + ")" : "")); }
  else if (connOff || why === "not answering") {
    put("tally", true, "", null, "", "TallyPrime is running in this login");
    if (why === "not answering") put("connect", false, WORDS.notanswering, { kind: "check" }, "notanswering");
    else {
      const devs = onThisPc(b), m = /port (\d+) is used/i.exec(say), held = m ? Number(m[1]) : 0;
      const free = ownPort(devs, login, [held].concat(ports.filter((p) => p && p.skipped).map((p) => p.port)));
      const ini = [].concat(src.tallyIni || (b && b.beat && b.beat.tallyIni) || []).map((x) => lc(x && x.connect));
      const warn = /every user of this computer shares/i.test(say) || ini.some((c) => c.startsWith("off; shared")) ? " " + WORDS.shared
        : /may not change tallyprime|cannot write/i.test(say) || ini.includes("cannot write") ? " " + WORDS.cantWrite : "";
      if (held) put("connect", false, WORDS.clash(held, holderOf(devs, held, login), free) + warn, { kind: "check", free }, "clash");
      else if (/set but not on yet/i.test(say)) put("connect", false, WORDS.reopen, { kind: "check" }, "reopen");
      else put("connect", false, WORDS.mode(free) + warn, { kind: "check", free }, warn ? (warn === " " + WORDS.shared ? "shared" : "cantwrite") : "mode");
    }
  } else if (say && /close and reopen|reopen tally/i.test(say) && ver && vk(ver) < vk("2.5.4") && (!why || /^no tally running/.test(why))) {
    // bridge 2.5.3 only: it switched Tally's connection on (its tally.ini) and Tally runs without it until reopened; it says
    // "no Tally running in this login" meanwhile: its own words, as step 3 (2.5.4 tells a closed Tally apart, and an
    // "owner unknown" Tally is the administrator's words; the bridge keeps this say for a day)
    put("tally", true, "", null, "", "TallyPrime is running in this login");
    put("connect", false, shown(say), { kind: "check" }, "reopen");
  } else {
    // (a bridge before 2.5.4 cannot tell a closed Tally from one whose connection is off: both, with the menu path)
    const pre254 = !!ver && vk(ver) < vk("2.5.4") && (!why || /^no tally running/.test(why) || why === "another user");
    const free = pre254 ? ownPort(onThisPc(b), login, ports.filter((p) => p && p.skipped).map((p) => p.port)) : 0;
    put("tally", false, why === "owner unknown" ? WORDS.admin : WORDS.tally(login, otherTally(ports)) + (pre254 ? " " + WORDS.maybeOff(free) : ""), { kind: "check" }, why === "owner unknown" ? "admin" : "notrunning");
    put("connect", false);
  }
  // 4. a company open in this login's own Tally
  const ok3 = steps[2].done;
  if (ok3 && names.size) put("company", true, "", null, "", nOf(names.size, "company", "companies") + " open in your Tally");
  else put("company", false, ok3 ? WORDS.noco() : "", ok3 ? { kind: "check" } : null, ok3 ? "noco" : "");
  // 5 and 6: the Tally page's rows (this login's own open companies only: the row's "Open in Tally right now?" is Yes)
  if (o0.rowsWait) { put("link", false, steps[3].done ? WORDS.rowsWait : "", null, "checking"); put("reading", false); }
  else if (o0.rows) {
    const rows = o0.rows, x = o0.extra || {}, linked = rows.filter((r) => r.kind === "client" && r.o && r.o.w === YES);
    const ok4 = steps[3].done;
    const conn = rows.find((r) => r.kind === "client" && r.c && r.c.connect && r.r);
    if (!ok4) put("link", false);
    else if (linked.length) put("link", true, "", null, "", "“" + shown(linked[0].company) + "” is linked to client “" + linked[0].client + "”");
    else if (x.open) put("link", false, WORDS.link(x.open.company, x.best && x.best.name), { kind: "link", r: x.open, co: x.best || null }, "link");
    else if (conn) put("link", false, WORDS.link(conn.r.company, conn.client), { kind: "link", r: conn.r, co: conn.co }, "connect");
    else put("link", false, WORDS.linkAny, null, "linkany");
    const r6 = steps[4].done ? linked[0] : null;
    if (!r6) put("reading", false);
    else {
      const done = r6.l.w === YES && r6.e.w === YES;
      const what = done ? "up to date" + (r6.e.note ? " (" + lcFirst(r6.e.note) + ")" : "")
        : ["ledgers " + (r6.l.note ? lcFirst(r6.l.note) : lcFirst(r6.l.w)), "entries " + (r6.e.note ? lcFirst(r6.e.note) : lcFirst(r6.e.w))].join(" · ");
      const todo = r6.todo && !/^Nothing\b/.test(r6.todo) ? r6.todo : "Nothing to do: it comes in by itself.";
      put("reading", done, WORDS.reading(r6.company, what, done ? "" : todo).trim(), null, done ? "" : "reading", WORDS.reading(r6.company, what, "").trim());
    }
  }
  // the states: done up to the first not done; that one now; the rest later
  let seen = false;
  steps.forEach((s) => { s.state = !seen && s.done ? "done" : !seen ? ((seen = true), "now") : "later"; });
  const now = steps.find((s) => s.state === "now") || null;
  return { mode: "login", login, steps, now, firm: null };
}
const lcFirst = (s) => { const t = String(s || ""); return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t; };
// the firm's state, for a browser with no bridge (never per login): its bridges heard now, Tally open, clients linked
export function firmWords(rows) {
  const all = bridgesOf().filter((b) => fresh(b.at)), withT = all.filter((b) => b.open.length || [].concat((b.beat || {}).ports || []).some((p) => p && p.ok && !p.skipped));
  const linked = [].concat(rows || []).filter((r) => r.kind === "client" && r.c && r.c.w === YES).length;
  if (!all.length) return "For the firm now: no FinCom Bridge is connected.";
  return "For the firm now: " + nOf(all.length, "FinCom Bridge is", "FinCom Bridges are") + " connected, " + withT.length + " with Tally open" + (rows ? ", " + nOf(linked, "client", "clients") + " linked" : "") + ".";
}
// the first step not done of the four a login needs before any client (the client's box and the top bar say it): null
// when they are done, on a laptop, or while the bridge is still being looked for
export function connectNow(latest) {
  let r; try { r = connectSteps({ latest }); } catch (e) { return null; }
  const s = r.mode === "login" ? r.now : null;
  // (only where this browser is on a Tally computer: a laptop whose browser did not let FinCom look, or whose look was
  // cut, says the firm's state as before; the first time anywhere, step 1)
  if (s && placeOf() !== "pc" && s.hook !== "first") return null;
  return s && s.hook !== "checking" ? { n: s.n, title: s.title, say: s.say, hook: s.hook, login: r.login } : null;
}
// "Step 3 of 6 · Tally’s connection on…": the same words everywhere a box points to the checklist
export const stepLine = (s) => s ? "Step " + s.n + " of 6: " + s.say : "";
// the boxes outside the Tally page point here: the Tally page, its six steps at the top
export const goSteps = () => { S.tallyPanel = false; S.tallyGuide = {}; S.tallyFocus = ""; S.tallyTab = "computers"; if (typeof navHome === "function") navHome("tally"); if (typeof window === "object") window.scrollTo(0, 0); };
// a client's box with no step of its own: this login's step instead (Waiting for Tally, the port), its words and the way here
export function withStep(w) {
  if (!w || !(w.kind === "waiting" || w.port) || w.state === "offline") return w;
  // (step 4, no company open: the client's own words name its company, "Open <company> in Tally": kept; another
  // computer key's Tally, or one offline, keeps its own words too)
  const c = connectNow();
  if (!c || c.n > 3 || (w.port && c.n !== 3) || !ownOrNone(w.device)) return w;
  const line = stepLine(c);
  return Object.assign({}, w, { line, text: w.word + " — " + line, step: c, port: null, button: { label: "See the 6 steps", act: goSteps } });
}
// a computer key that is this login's own bridge's, or none known
export function ownOrNone(devId) {
  if (!devId) return true;
  let o = null; try { o = ownBridge(); } catch (e) { o = null; }
  return !!(o && o.dev && o.dev.id === devId);
}
if (typeof globalThis === "object") Object.assign(globalThis, { FCConnectNow: connectNow, FCConnectSteps: connectSteps, FCWithStep: withStep, FCStepLine: stepLine, FCGoSteps: goSteps, FCOwnOrNone: ownOrNone });
