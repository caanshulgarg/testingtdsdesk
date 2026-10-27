// The checks of app/src/lib/native.js and jpegPdf.js, run in a real Chromium page by run_native_unit.py (a real DOM,
// File, Blob, fetch of blob: addresses). Each phone feature is checked twice: on the web (no Capacitor, or Capacitor's
// web runtime) it does what the web app does today; with a stand-in Capacitor (its bridge: nativePromise, addListener)
// it calls the phone. Nothing here reaches a network.
import * as N from "../app/src/lib/native.js";
import { jpegsToPdf, jpegSize, pageSize } from "../app/src/lib/jpegPdf.js";

const out = [];
const ok = (c, w) => out.push([!!c, w]);
const tick = () => new Promise((r) => setTimeout(r, 0));

export function fakeCap(platform = "android", handlers = {}) {
  const calls = [], listeners = {};
  const Capacitor = {
    isNativePlatform: () => true, getPlatform: () => platform,
    nativePromise: (p, m, o) => { calls.push([p, m, o]); const h = handlers[p + "." + m]; return Promise.resolve().then(() => (h ? h(o) : {})); },
    addListener: (p, e, cb) => { (listeners[p + "." + e] = listeners[p + "." + e] || []).push(cb); return { remove() {} }; },
    convertFileSrc: (u) => "data:application/pdf;base64," + btoa("%PDF-1.4 shared " + u),
  };
  return { calls, listeners, Capacitor, fire: (k, ev) => (listeners[k] || []).forEach((cb) => cb(ev)) };
}
function mk(Capacitor, extra = {}) {
  const toasts = [], handed = [];
  const w = Object.assign({ document, localStorage, sessionStorage, history, location, KeyboardEvent, MutationObserver, HTMLAnchorElement,
    fetch: (...a) => fetch(...a), matchMedia: (q) => matchMedia(q), toast: (m) => toasts.push(m), handleFiles: (fs, mode) => handed.push([fs, mode]) }, Capacitor ? { Capacitor } : {}, extra);
  w.toasts = toasts; w.handed = handed;
  return w;
}
// a JPEG's header up to its frame (SOF0): enough for the PDF's page; the bytes are carried as they are
function jpeg(w, h, comps = 3) {
  const app0 = [0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xFF, 0xC0, 0, 8 + 3 * comps, 8, h >> 8, h & 255, w >> 8, w & 255, comps]; for (let i = 0; i < comps; i++) sof.push(i + 1, 0x11, 0);
  return new Uint8Array([0xFF, 0xD8, ...app0, ...sof, 0xFF, 0xD9]);
}
const text = (u8) => new TextDecoder("latin1").decode(u8);

export async function run() {
  out.length = 0;
  // ------------------------------------------------------------------ detection
  ok(!N.isNative(mk(null)) && N.platform(mk(null)) === "web", "no Capacitor: the web");
  ok(!N.isNative(mk({ isNativePlatform: () => false, getPlatform: () => "web" })), "Capacitor's web runtime: the web");
  ok(N.isNative(mk(fakeCap("ios").Capacitor)) && N.platform(mk(fakeCap("ios").Capacitor)) === "ios", "a phone (iOS)");
  ok(!N.isNative(mk({ isNativePlatform: () => { throw new Error("x"); } })), "a broken bridge: the web");

  // ------------------------------------------------------------------ the PDF of scanned pages
  const s = jpegSize(jpeg(2200, 3100));
  ok(s && s.width === 2200 && s.height === 3100 && s.comps === 3, "a JPEG's size from its frame (" + JSON.stringify(s) + ")");
  ok(jpegSize(new Uint8Array([1, 2, 3, 4])) === null, "not a JPEG: no size");
  const [pw, ph] = pageSize(2200, 3100);
  ok(Math.abs(pw - 595.28) < 0.01 && ph > 830 && ph < 845, "a 12 MP photo: A4's width, its own proportion (" + pw + " x " + ph + ")");
  const pages = [jpeg(2200, 3100), jpeg(1200, 1600, 1), jpeg(800, 600)];
  const pdf = jpegsToPdf(pages), t = text(pdf);
  ok(t.startsWith("%PDF-1.4\n") && t.trimEnd().endsWith("%%EOF"), "a PDF from its first byte to its end");
  ok((t.match(/\/Type \/Page\b/g) || []).length === 3 && /\/Count 3\b/.test(t), "three pages");
  const xrefAt = Number(/startxref\n(\d+)\n/.exec(t)[1]);
  ok(t.slice(xrefAt, xrefAt + 4) === "xref", "startxref points at the table");
  const offs = t.slice(xrefAt).split("\n").filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  ok(offs.length === 11 && offs.every((o, i) => t.slice(o).startsWith((i + 1) + " 0 obj")), "every object where the table says (" + offs.length + ")");
  ok(/\/ColorSpace \/DeviceGray/.test(t) && t.includes("/Filter /DCTDecode /Length " + pages[1].length + " >>"), "a grey photo stays grey; each JPEG embedded as it is, with its length");
  const at = t.indexOf("stream\n", t.indexOf("/Width 2200")) + 7;
  ok(pages[0].every((b, i) => pdf[at + i] === b), "the photo's bytes unchanged inside the PDF");
  let threw = ""; try { jpegsToPdf([new Uint8Array([1, 2, 3])]); } catch (e) { threw = e.message; }
  ok(/not a JPEG/.test(threw), "a page that is not a JPEG is refused");

  // ------------------------------------------------------------------ camera scan
  const cam = document.createElement("input"); cam.type = "file"; cam.id = "camIn"; let clicked = 0; cam.click = () => { clicked++; }; document.body.appendChild(cam);
  const ww = mk(null);
  const rWeb = await N.scan({ w: ww });
  ok(rWeb.web && clicked === 1 && !ww.handed.length, "web: Take photo as today (the #camIn input), no camera call");
  cam.remove();
  let f = fakeCap("android"), shots = 0;
  let wn = mk(f.Capacitor);
  const answers = ["more", "more", "done"];
  const r3 = await N.scan({ w: wn, take: async () => jpeg(1000 + ++shots, 1400), ask: async () => answers.shift() });
  const [[files3, mode3]] = wn.handed;
  ok(r3.pages === 3 && files3.length === 1 && files3[0].type === "application/pdf" && /\(3 pages\)\.pdf$/.test(files3[0].name) && mode3 === "company", "three pages: one PDF into the open client's uploads (" + files3[0].name + ")");
  ok(text(new Uint8Array(await files3[0].arrayBuffer())).startsWith("%PDF-1.4"), "the file handed is the PDF");
  wn = mk(f.Capacitor);
  const r1 = await N.scan({ w: wn, take: async () => jpeg(900, 1200), ask: async () => "done" });
  ok(r1.pages === 1 && wn.handed[0][0][0].type === "image/jpeg" && /\.jpg$/.test(wn.handed[0][0][0].name), "one page: the photo itself");
  wn = mk(f.Capacitor);
  const rc = await N.scan({ w: wn, take: async () => jpeg(900, 1200), ask: async () => "cancel" });
  ok(rc.pages === 0 && !wn.handed.length, "Cancel: nothing uploaded");
  wn = mk(f.Capacitor);
  const rx = await N.scan({ w: wn, take: async () => { throw new Error("User cancelled photos app"); }, ask: async () => "done" });
  ok(rx.pages === 0 && !wn.handed.length, "the camera closed without a photo: nothing uploaded");
  f = fakeCap("android", { "Camera.getPhoto": () => ({ base64String: N.bytesToB64(jpeg(640, 480)) }) });
  wn = mk(f.Capacitor);
  await N.scan({ w: wn, ask: async () => "done" });
  const g = f.calls.find((c) => c[0] === "Camera" && c[1] === "getPhoto");
  ok(g && g[2].allowEditing === true && g[2].source === "CAMERA" && g[2].resultType === "base64" && wn.handed.length === 1, "the phone's camera, with its crop editor, base64");
  // the sheet between pages, as drawn on a phone
  wn = mk(fakeCap().Capacitor);
  let shot = 0;
  const pr = N.scan({ w: wn, take: async () => jpeg(500, 700) });
  await tick(); await tick();
  ok(document.querySelector("[data-native-sheet]") && /Page 1 kept/.test(document.querySelector("[data-native-sheet]").textContent), "the sheet: Page 1 kept");
  document.querySelector("[data-native-sheet-done]").click();
  await pr; shot = wn.handed.length;
  ok(shot === 1 && !document.querySelector("[data-native-sheet]"), "Done reads it; the sheet goes");

  // ------------------------------------------------------------------ the session
  const KEY = "tdsdesk:cloudsess";
  const mkCloud = () => ({ sess() { const r = sessionStorage.getItem(KEY) || localStorage.getItem(KEY); return r ? JSON.parse(r) : null; },
    setSess(s) { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } } });
  localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
  let cloud = mkCloud(); const origSet = cloud.setSess;
  ok(N.secureSession(mk(null)).install(cloud) === false && cloud.setSess === origSet, "web: the session's writer untouched");
  cloud.setSess({ access_token: "a1", user_id: "u1" });
  ok(localStorage.getItem(KEY) && !sessionStorage.getItem(KEY), "web: kept in localStorage, as today");
  cloud.setSess(null);
  f = fakeCap("ios"); cloud = mkCloud(); const changes = [];
  localStorage.setItem(KEY, JSON.stringify({ access_token: "old", user_id: "u0" }));
  ok(N.secureSession(mk(f.Capacitor)).install(cloud, (s, b) => changes.push([s && s.user_id, b && b.user_id])) === true, "phone: the writer wrapped");
  await tick();
  ok(!localStorage.getItem(KEY) && JSON.parse(sessionStorage.getItem(KEY)).access_token === "old" && f.calls.some((c) => c[1] === "internalSetItem" && JSON.parse(c[2].data).access_token === "old"), "a session left in localStorage moved to the Keychain (sessionStorage while the app runs)");
  cloud.setSess({ access_token: "a2", user_id: "u2" }); await tick();
  const set = f.calls.filter((c) => c[1] === "internalSetItem").pop();
  ok(!localStorage.getItem(KEY) && cloud.sess().access_token === "a2" && set[2].prefixedKey === N.SESSION_KEY && set[2].access === 1 && set[2].sync === false, "a sign-in: Keychain (this device only, not synced), never localStorage");
  cloud.setSess(null); await tick();
  ok(!cloud.sess() && f.calls.some((c) => c[1] === "internalRemoveItem") && JSON.stringify(changes) === JSON.stringify([["u2", "u0"], [null, "u2"]]), "a sign-out: removed from the Keychain; the change told (" + JSON.stringify(changes) + ")");
  ok(N.secureSession(mk(f.Capacitor)).install(cloud) === false, "wrapped once only");

  // ------------------------------------------------------------------ exports: download or share
  const A = HTMLAnchorElement.prototype, before = A.click;
  ok(N.catchDownloads(mk(null)) === false && A.click === before, "web: downloads as today (the anchor's click untouched)");
  f = fakeCap("android", { "Filesystem.writeFile": (o) => ({ uri: "file:///cache/" + o.path }) });
  wn = mk(f.Capacitor);
  ok(N.catchDownloads(wn) === true, "phone: the export's click caught");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["Sheet,1\n"], { type: "text/csv" })); a.download = "TDS register: Q2/2026.csv"; document.body.appendChild(a); a.click(); a.remove();
  for (let i = 0; i < 20 && !f.calls.some((c) => c[0] === "Share"); i++) await new Promise((r) => setTimeout(r, 20));
  const wr = f.calls.find((c) => c[0] === "Filesystem"), sh = f.calls.find((c) => c[0] === "Share");
  ok(wr && wr[2].directory === "CACHE" && wr[2].path === "exports/TDS register Q2 2026.csv" && atob(wr[2].data) === "Sheet,1\n", "written to the app's cache under a safe name (" + (wr && wr[2].path) + ")");
  ok(sh && sh[2].files[0] === "file:///cache/exports/TDS register Q2 2026.csv", "offered on the share sheet (Save to Files, Drive, WhatsApp)");
  let plain = 0; const b = document.createElement("a"); b.href = "#/today"; b.addEventListener("click", (e) => { e.preventDefault(); plain++; }); b.click();
  ok(plain === 1, "a plain link's click still a click");
  A.click = before; delete A.__nativeClick;

  // ------------------------------------------------------------------ back button
  const T = (o) => N.backAction(Object.assign({ hash: "#/tds", overlay: false, historyLength: 3 }, o));
  ok(T({ overlay: true }) === "close" && T({}) === "back" && T({ historyLength: 1 }) === "home" && T({ hash: "#/today" }) === "exit" && T({ hash: "" }) === "exit", "back: close what is open, the page before, Today, then leave");

  // ------------------------------------------------------------------ deep links
  const D = N.deepLinkHash;
  ok(D("https://app.fincom.live/#/clients") === "#/clients" && D("fincom://open#/today") === "#/today", "a FinCom link opens its page");
  ok(D("https://app.fincom.live/#access_token=x&type=recovery") === "#access_token=x&type=recovery", "a password-reset link reaches the sign-in");
  ok(D("https://evil.example/#/today") === null && D("https://app.fincom.live/#javascript:alert(1)") === null && D("https://fincom.live/#/today") === null && D("") === null, "anything else ignored");

  // ------------------------------------------------------------------ app lock
  const signedCloud = { on: () => true };
  let v = 0;
  const lw = N.appLock(mk(null, { Cloud: signedCloud }), { verify: async () => { v++; }, available: async () => true });
  ok((await lw.lock()) === false && !document.querySelector("[data-native-lock]") && v === 0, "web: no lock");
  localStorage.removeItem("fincom.applock");
  let pass = false;
  const ln = N.appLock(mk(fakeCap().Capacitor, { Cloud: signedCloud }), { verify: async () => { if (!pass) throw new Error("no match"); }, available: async () => true });
  ok((await ln.lock()) === false && document.querySelector("[data-native-lock]") && ln.locked(), "phone: a failed fingerprint keeps FinCom covered");
  pass = true; await ln.unlock();
  ok(!document.querySelector("[data-native-lock]") && !ln.locked(), "the right fingerprint (or passcode) opens it");
  ok(ln.state(false, 1000) === null && ln.state(true, 30000) === null, "back within a minute: not asked again");
  ln.state(false, 100000); const again = ln.state(true, 100000 + N.LOCK_AFTER_MS);
  ok(again && (await again) === true, "back after a minute: asked again");
  localStorage.setItem("fincom.applock", "off");
  ok((await ln.lock()) === false && !ln.locked(), "the lock turned off in settings: not asked");
  localStorage.removeItem("fincom.applock");
  const lo = N.appLock(mk(fakeCap().Capacitor, { Cloud: { on: () => false } }), { verify: async () => {}, available: async () => true });
  ok((await lo.lock()) === false && !lo.locked(), "nobody signed in: no lock");

  // ------------------------------------------------------------------ push
  ok((await N.pushClient(mk(null)).register()) === false, "web: no push registration");
  const rpcs = [];
  f = fakeCap("android", { "PushNotifications.checkPermissions": () => ({ receive: "prompt" }), "PushNotifications.requestPermissions": () => ({ receive: "granted" }) });
  const fetched = [];
  const pc = N.pushClient(mk(f.Capacitor, { Cloud: { rpc: async (n, a2) => { rpcs.push([n, a2]); }, cfg: () => ({ url: "https://stand.test/", key: "anon" }) }, fetch: async (u, o) => { if (/push-off/.test(u)) return new Response("", { status: 404 }); fetched.push([u, o]); return new Response("{}"); } }));
  pc.wire();
  ok((await pc.register()) === true && f.calls.some((c) => c[1] === "register"), "phone: permission asked, then registered");
  f.fire("PushNotifications.registration", { value: "fcm-token-abc" }); await tick();
  ok(rpcs.length === 1 && rpcs[0][0] === "device_token_save" && rpcs[0][1].p_platform === "android" && rpcs[0][1].p_token === "fcm-token-abc", "the token saved to the firm account (device_token_save)");
  pc.forget({ access_token: "ending" }); await tick();
  ok(fetched.length === 1 && fetched[0][0] === "https://stand.test/rest/v1/rpc/device_token_forget" && fetched[0][1].headers.Authorization === "Bearer ending", "a sign-out forgets the phone with the session that is ending");
  const loc = { hash: "" };
  const pr2 = fakeCap(); N.pushClient(mk(pr2.Capacitor, { location: loc })).wire();
  pr2.fire("PushNotifications.pushNotificationActionPerformed", { notification: { data: { route: "#/compliance" } } });
  pr2.fire("PushNotifications.pushNotificationActionPerformed", { notification: { data: { route: "https://evil.example" } } });
  ok(loc.hash === "#/compliance", "a notification tapped opens its FinCom page (and nothing else)");
  const denied = fakeCap("ios", { "PushNotifications.checkPermissions": () => ({ receive: "denied" }) });
  ok((await N.pushClient(mk(denied.Capacitor)).register()) === false && !denied.calls.some((c) => c[1] === "register"), "notifications refused on the phone: not registered");
  const nofb = fakeCap("android", { "PushNotifications.checkPermissions": () => ({ receive: "granted" }) });
  ok((await N.pushClient(mk(nofb.Capacitor, { fetch: async () => new Response('{"push":"off"}') })).register()) === false && !nofb.calls.some((c) => c[0] === "PushNotifications"), "a build without Firebase (push-off.json): push never asked for");

  // ------------------------------------------------------------------ share to FinCom
  f = fakeCap();
  const got = await N.sharedFiles({ files: [{ uri: "file:///x/bill.pdf", name: "bill.pdf", mimeType: "application/pdf" }, { uri: "file:///x/song.mp3", name: "song.mp3", mimeType: "audio/mpeg" }] }, mk(f.Capacitor));
  ok(got.length === 1 && got[0].name === "bill.pdf" && got[0].type === "application/pdf" && /shared file:\/\/\/x\/bill\.pdf/.test(await got[0].text()), "a shared PDF read through the app's file address; a song left out");
  ok(N.shareMode(mk(null, { S: { coId: "c1" } })) === "company" && N.shareMode(mk(null, { S: { coId: "" } })) === "auto", "into the open client's uploads, else each bill to its client (auto)");

  // ------------------------------------------------------------------ start
  ok(N.start(mk(null)) === null && !document.documentElement.classList.contains("fincom-native"), "web: start does nothing");
  f = fakeCap("android");
  cloud = mkCloud(); cloud.on = () => false;
  const ws = mk(f.Capacitor, { Cloud: cloud });
  const api = N.start(ws);
  ok(api && ws.FinComNative === api && api.platform === "android" && typeof api.scan === "function", "phone: window.FinComNative");
  ok(document.documentElement.classList.contains("fincom-native") && document.querySelector("[data-native-css]") && f.calls.some((c) => c[0] === "StatusBar" && c[1] === "setStyle"), "the frame: safe areas, the status bar");
  ok(["App.backButton", "App.appUrlOpen", "App.appStateChange", "CapacitorShareTarget.shareReceived", "PushNotifications.registration"].every((k) => f.listeners[k] && f.listeners[k].length), "listening: back, links, the app's state, shares, push");
  ok(cloud.__nativeSess === true, "the session kept in the Keychain");
  f.fire("CapacitorShareTarget.shareReceived", { files: [{ uri: "file:///x/b.pdf", name: "b.pdf", mimeType: "application/pdf" }] });
  for (let i = 0; i < 20 && !ws.handed.length; i++) await new Promise((r) => setTimeout(r, 20));
  ok(ws.handed.length === 1 && ws.handed[0][1] === "auto", "a PDF shared to FinCom goes into uploads");
  ok(N.start(ws) === api, "started once");
  HTMLAnchorElement.prototype.click = before; delete HTMLAnchorElement.prototype.__nativeClick;
  document.documentElement.classList.remove("fincom-native", "fincom-android");
  return out;
}
