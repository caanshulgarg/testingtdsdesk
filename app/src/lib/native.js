// FinCom on Android and iOS (branch next-mobile; the mobile plan, mobile-plan.md): the one place that talks to the phone.
// The phone app is this same web app in a Capacitor shell (../../mobile). This file is in the MOBILE build only: main.jsx
// imports it behind __FINCOM_MOBILE__ (false in the web builds, so Vite drops the import and the web bundle does not
// change) and only when window.Capacitor says it is running on a phone. It uses the native bridge Capacitor puts in the
// page (Capacitor.nativePromise / addListener), so app/ needs no Capacitor package.
// Every feature has the web's behaviour as its fallback: off a phone each function does what the web app does today.
//   scan          camera bill / statement capture, several pages, each cropped in the camera's editor, made one PDF and
//                 handed to the upload and reading flow (handleFiles). Web: the existing "Take photo" input (#camIn)
//   share target  a PDF or photo shared to FinCom from another app goes into uploads (the open client's, or each bill to
//                 its client by GSTIN). Web: nothing (drag and drop as today)
//   session       the sign-in kept in the Keychain (iOS) / Keystore (Android) instead of localStorage; while the app runs
//                 it is in sessionStorage only (Cloud.sess reads it there first). Web: localStorage as today
//   app lock      fingerprint / Face ID (or the phone's passcode) when FinCom opens and after a minute in the background
//   status bar and safe areas, the Android back button on the app's hash routes, file save / share for the Excel and
//   PDF exports (an <a download> click becomes the phone's share sheet), push registration after sign-in, deep links
export const SESSION_KEY = "fincom_cloudsess";   // the Keychain / Keystore entry (secure storage's prefixedKey)
export const KEYCHAIN_THIS_DEVICE = 1;              // whenUnlockedThisDeviceOnly: never in a backup or another phone
export const LOCK_AFTER_MS = 60_000;                // the app lock asks again after a minute in the background
const HOME = /^#?\/?(today)?$/;

const win = () => (typeof window !== "undefined" ? window : globalThis);
// the program's own objects (src/js: const Cloud, const S) are top-level names of a classic script, not window's
// properties: read by name (a test hands them on its stand-in window instead)
/* global Cloud, S */
export const theCloud = (w) => (w.Cloud !== undefined ? w.Cloud : typeof Cloud !== "undefined" ? Cloud : null);
export const theState = (w) => (w.S !== undefined ? w.S : typeof S !== "undefined" ? S : null);
export function cap(w = win()) { return (w && w.Capacitor) || null; }
export function isNative(w = win()) {
  const c = cap(w);
  try { return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform()); } catch (e) { return false; }
}
export function platform(w = win()) { return isNative(w) ? String(cap(w).getPlatform()) : "web"; }
export const call = (plugin, method, opts, w = win()) => cap(w).nativePromise(plugin, method, opts || {});
export const listen = (plugin, event, cb, w = win()) => cap(w).addListener(plugin, event, cb);

// ---------------------------------------------------------------------------------------------- bytes
export function b64ToBytes(b64) {
  const s = atob(String(b64 || "").replace(/^data:[^,]*,/, "")), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const stamp = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " +
  String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");

// ---------------------------------------------------------------------------------------------- the session
// the storage key the program uses (src/js/43 SESS_KEY: "tdsdesk:cloudsess", the test build's "tdsdesk-test:cloudsess")
export const webKey = (w = win()) => (w.__fincomNativeLs || "tdsdesk:") + "cloudsess";
export function secureSession(w = win()) {
  const native = isNative(w);
  const keychainSet = (txt) => call("SecureStorage", "internalSetItem", { prefixedKey: SESSION_KEY, data: txt, sync: false, access: KEYCHAIN_THIS_DEVICE }, w);
  const keychainDel = () => call("SecureStorage", "internalRemoveItem", { prefixedKey: SESSION_KEY, sync: false }, w);
  // the session out of localStorage (it stays in sessionStorage while the app runs) and into the Keychain
  const move = () => {
    if (!native) return null;
    const k = webKey(w);
    let txt = null;
    // localStorage first: the program's writer has just put the new session there ("Keep me signed in")
    try { txt = w.localStorage.getItem(k) || w.sessionStorage.getItem(k); } catch (e) { txt = null; }
    if (!txt) return null;
    try { w.sessionStorage.setItem(k, txt); w.localStorage.removeItem(k); } catch (e) { /* kept where it was */ }
    return keychainSet(txt).catch(() => null);
  };
  // Cloud.setSess is the program's one writer of the session: wrapped, so every sign-in and token refresh is kept in the
  // Keychain, and a sign-out removes it there too. Web: not wrapped (localStorage as today)
  const install = (Cloud, onChange) => {
    if (!native || !Cloud || Cloud.__nativeSess) return false;
    const orig = Cloud.setSess;
    Cloud.setSess = function (s) {
      const before = this.sess && this.sess();
      const r = orig.call(this, s);
      if (s) move(); else keychainDel().catch(() => null);
      try { if (onChange) onChange(s || null, before || null); } catch (e) { /* never in the way of the sign-in */ }
      return r;
    };
    Cloud.__nativeSess = true;
    move();
    return true;
  };
  return { install, move, keychainSet, keychainDel };
}

// ---------------------------------------------------------------------------------------------- camera scan
export const SCAN_OPTIONS = { quality: 80, allowEditing: true, resultType: "base64", source: "CAMERA", correctOrientation: true, width: 2200, saveToGallery: false };
// pages: [Uint8Array JPEG] -> a File for the upload flow (one page: the photo; more: one PDF)
export async function scanFile(pages, when = new Date()) {
  if (pages.length === 1) return new File([pages[0]], "Scan " + stamp(when) + ".jpg", { type: "image/jpeg" });
  const { jpegsToPdf } = await import("./jpegPdf.js");
  return new File([jpegsToPdf(pages)], "Scan " + stamp(when) + " (" + pages.length + " pages).pdf", { type: "application/pdf" });
}
const cancelled = (e) => /cancel/i.test(String((e && (e.message || e.code)) || e));
// ask(n) -> "more" | "done" | "cancel" after page n is kept (the little sheet below on a phone)
export async function scan({ w = win(), ask = (n) => askSheet(n, w), take, hand, max = 20 } = {}) {
  if (!isNative(w)) {
    // web: the existing "Take photo" (an <input capture>, src/js/27 doAct "camera")
    const el = w.document && w.document.getElementById("camIn");
    if (el) el.click();
    return { web: true };
  }
  take = take || (() => call("Camera", "getPhoto", SCAN_OPTIONS, w).then((r) => b64ToBytes(r.base64String)));
  hand = hand || ((files) => w.handleFiles(files, "company"));
  const pages = [];
  while (pages.length < max) {
    let jpg;
    try { jpg = await take(); } catch (e) { if (cancelled(e)) break; throw e; }
    pages.push(jpg);
    const a = await ask(pages.length);
    if (a === "cancel") return { pages: 0 };
    if (a !== "more") break;
  }
  if (!pages.length) return { pages: 0 };
  const file = await scanFile(pages);
  await hand([file]);
  return { pages: pages.length, name: file.name };
}
function askSheet(n, w) {
  const d = w.document;
  return new Promise((done) => {
    const box = d.createElement("div");
    box.setAttribute("data-native-sheet", "");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Scanned pages");
    box.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:10001;padding:16px 16px calc(16px + env(safe-area-inset-bottom));background:var(--surface,#fff);color:var(--foreground,#1E2A25);border-top:1px solid var(--border,#D7DEDA);border-radius:16px 16px 0 0;box-shadow:0 -8px 24px rgba(0,0,0,.12);font:15px/1.4 Inter Variable,-apple-system,Segoe UI,sans-serif";
    const p = d.createElement("p"); p.style.margin = "0 0 12px"; p.textContent = n === 1 ? "Page 1 kept." : n + " pages kept.";
    const row = d.createElement("div"); row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    const btn = (label, v, primary) => {
      const b = d.createElement("button"); b.type = "button"; b.className = "btn" + (primary ? " primary" : ""); b.textContent = label; b.setAttribute("data-native-sheet-" + v, "");
      b.onclick = () => { box.remove(); done(v); }; row.appendChild(b);
    };
    btn("Add a page", "more"); btn(n === 1 ? "Done: read it" : "Done: read " + n + " pages", "done", true); btn("Cancel", "cancel");
    box.append(p, row); d.body.appendChild(box);
  });
}

// ---------------------------------------------------------------------------------------------- share to FinCom
export const SHARE_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|application\/vnd\.(openxmlformats-officedocument\.spreadsheetml\.sheet|ms-excel)|text\/csv)$/i;
export const SHARE_EXT = /\.(pdf|jpe?g|jfif|png|webp|heic|xlsx|xls|csv)$/i;
export async function sharedFiles(ev, w = win()) {
  const out = [];
  for (const f of (ev && ev.files) || []) {
    if (!SHARE_TYPES.test(f.mimeType || "") && !SHARE_EXT.test(f.name || "")) continue;
    const src = f.uri && /^(https?:|data:|blob:)/.test(f.uri) ? f.uri : cap(w).convertFileSrc(f.uri);
    const blob = await (await w.fetch(src)).blob();
    out.push(new File([blob], f.name || "Shared file", { type: f.mimeType || blob.type || "" }));
  }
  return out;
}
// the open client's uploads when one is open, else each bill to the client whose GSTIN it is billed to ("auto")
export function shareMode(w = win()) { const st = theState(w); return st && st.coId ? "company" : "auto"; }

// ---------------------------------------------------------------------------------------------- files out
const safeName = (n) => String(n || "FinCom file").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "FinCom file";
// an export (blob: or data: address) written to the app's cache and offered on the phone's share sheet (Save to Files,
// Drive, WhatsApp, mail...). Web: the browser's download, as today
export async function saveFile(href, name, w = win()) {
  if (!isNative(w)) return false;
  const bytes = new Uint8Array(await (await w.fetch(href)).arrayBuffer());
  const path = "exports/" + safeName(name);
  const r = await call("Filesystem", "writeFile", { path, data: bytesToB64(bytes), directory: "CACHE", recursive: true }, w);
  await call("Share", "share", { title: safeName(name), files: [r.uri], dialogTitle: "Save or send " + safeName(name) }, w).catch((e) => { if (!cancelled(e)) throw e; });
  return true;
}
// every export in FinCom ends in a.download = name; a.click() (src/js/01 saveFile, lib/finExport.js, reportsExport.js...):
// on a phone that click goes to saveFile instead (a WebView does not download blob: addresses)
export function catchDownloads(w = win(), say = (m) => { try { w.toast(m); } catch (e) { /* */ } }) {
  if (!isNative(w)) return false;
  const A = w.HTMLAnchorElement && w.HTMLAnchorElement.prototype;
  if (!A || A.__nativeClick) return false;
  const orig = A.click;
  A.click = function () {
    const href = this.getAttribute("href") || "";
    if (this.hasAttribute("download") && /^(blob:|data:)/.test(href)) { saveFile(href, this.getAttribute("download") || "FinCom file", w).catch((e) => say("The file could not be saved: " + ((e && e.message) || e))); return; }
    return orig.call(this);
  };
  A.__nativeClick = true;
  return true;
}

// ---------------------------------------------------------------------------------------------- back button (Android)
// what the back button does: close what is open over the page, else the page before, else Today, else leave the app
export function backAction({ hash, overlay, historyLength }) {
  if (overlay) return "close";
  if (HOME.test(String(hash || ""))) return "exit";
  if (historyLength > 1) return "back";
  return "home";
}
const overlayOpen = (d) => !!d.querySelector("[data-native-sheet], [role=dialog]:not([hidden]), .side-sheet-wrap .side-sheet, #modal:not(.hidden)");
export function onBack(w = win()) {
  const d = w.document, a = backAction({ hash: w.location.hash, overlay: overlayOpen(d), historyLength: w.history.length });
  if (a === "close") {
    const sheet = d.querySelector("[data-native-sheet-cancel]");
    if (sheet) sheet.click(); else d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  } else if (a === "back") w.history.back();
  else if (a === "home") w.location.hash = "#/today";
  else call("App", "minimizeApp", {}, w).catch(() => null);
  return a;
}

// ---------------------------------------------------------------------------------------------- deep links
// https://app.fincom.live/#/clients (the web app's own address), fincom://open#/today (the app's own scheme), a sign-in link (#access_token=...):
// the part after # opens in the app; anything else is ignored
export function deepLinkHash(url) {
  const m = /^(https:\/\/app\.fincom\.live\/|fincom:\/\/)[^#]*#(.*)$/i.exec(String(url || ""));
  if (!m) return null;
  const h = m[2];
  if (/^\/[\w\-/=&.?%]{0,200}$/.test(h)) return "#" + h;
  if (/(^|&)access_token=/.test(h) && /(^|&)type=(invite|recovery|signup|magiclink)(&|$)/.test(h)) return "#" + h;
  return null;
}

// ---------------------------------------------------------------------------------------------- app lock
export function lockWanted(w = win()) { try { return w.localStorage.getItem("fincom.applock") !== "off"; } catch (e) { return true; } }
export function appLock(w = win(), { verify, available } = {}) {
  verify = verify || (() => call("NativeBiometric", "verifyIdentity", { reason: "Unlock FinCom", title: "Unlock FinCom", subtitle: "Your clients' books are on this phone", useFallback: true, maxAttempts: 3 }, w));
  available = available || (() => call("NativeBiometric", "isAvailable", { useFallback: true }, w).then((r) => !!(r && r.isAvailable), () => false));
  let away = 0, cover = null, busy = false;
  const signedIn = () => { try { return !!(theCloud(w) && theCloud(w).on && theCloud(w).on()); } catch (e) { return false; } };
  const show = () => {
    if (cover) return cover;
    const d = w.document;
    cover = d.createElement("div"); cover.setAttribute("data-native-lock", "");
    cover.style.cssText = "position:fixed;inset:0;z-index:10002;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--surface,#fff);color:var(--foreground,#1E2A25);font:16px Inter Variable,-apple-system,sans-serif";
    const t = d.createElement("p"); t.textContent = "FinCom is locked"; t.style.margin = "0";
    const b = d.createElement("button"); b.type = "button"; b.className = "btn primary"; b.textContent = "Unlock"; b.onclick = () => unlock();
    cover.append(t, b); d.body.appendChild(cover);
    return cover;
  };
  const unlock = async () => {
    if (busy) return false; busy = true;
    try { await verify(); if (cover) { cover.remove(); cover = null; } return true; } catch (e) { return false; } finally { busy = false; }
  };
  const lock = async () => {
    if (!isNative(w) || !lockWanted(w) || !signedIn() || !(await available())) return false;
    show(); return unlock();
  };
  return {
    lock, unlock, locked: () => !!cover,
    // App's appStateChange: going to the background notes the time; back after LOCK_AFTER_MS asks again
    state: (active, now = Date.now()) => { if (!active) { away = now; return null; } const long = away && now - away >= LOCK_AFTER_MS; away = 0; return long ? lock() : null; },
  };
}

// ---------------------------------------------------------------------------------------------- push
export function pushClient(w = win()) {
  let token = "";
  const save = (s) => token && theCloud(w) && theCloud(w).rpc("device_token_save", { p_platform: platform(w), p_token: token, p_app_version: w.__fincomAppVersion || null }).catch(() => null);
  // the sign-out: told to the server with the session that is ending (Cloud.api would find it gone)
  const forget = (old) => {
    if (!token || !old || !old.access_token || !theCloud(w)) return null;
    const c = theCloud(w).cfg();
    return w.fetch(String(c.url).replace(/\/+$/, "") + "/rest/v1/rpc/device_token_forget", { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + old.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ p_token: token }) }).catch(() => null);
  };
  const register = async () => {
    if (!isNative(w)) return false;
    // a build made without Firebase's settings (CI: no GOOGLE_SERVICES_JSON) says so with push-off.json: Firebase is not
    // there, and asking it for a token would stop the app on Android
    if (await w.fetch("./push-off.json", { cache: "no-store" }).then((r) => r.ok, () => false)) return false;
    let p = await call("PushNotifications", "checkPermissions", {}, w).catch(() => ({}));
    if (p.receive === "prompt" || p.receive === "prompt-with-rationale") p = await call("PushNotifications", "requestPermissions", {}, w).catch(() => ({}));
    if (p.receive !== "granted") return false;
    await call("PushNotifications", "register", {}, w);
    return true;
  };
  const wire = () => {
    listen("PushNotifications", "registration", (t) => { token = String((t && t.value) || ""); save(); }, w);
    // a notification tapped: its page opened (a FinCom hash only)
    listen("PushNotifications", "pushNotificationActionPerformed", (a) => {
      const route = a && a.notification && a.notification.data && a.notification.data.route;
      if (/^#\/[\w\-/=&.?%]{0,200}$/.test(String(route || ""))) w.location.hash = route;
    }, w);
  };
  return { register, wire, save, forget, token: () => token };
}

// ---------------------------------------------------------------------------------------------- the frame
export const NATIVE_CSS = "html.fincom-native header.top{padding-top:env(safe-area-inset-top)}" +
  "html.fincom-native body{padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}" +
  "@media (max-width:600px){html.fincom-native .side:not(.hidden){padding-bottom:env(safe-area-inset-bottom)}}" +
  "html.fincom-native{-webkit-tap-highlight-color:transparent}";
function frame(w) {
  const d = w.document;
  d.documentElement.classList.add("fincom-native", "fincom-" + platform(w));
  const st = d.createElement("style"); st.setAttribute("data-native-css", ""); st.textContent = NATIVE_CSS; d.head.appendChild(st);
  const dark = () => d.documentElement.getAttribute("data-theme") === "dark" || (d.documentElement.getAttribute("data-theme") !== "light" && w.matchMedia && w.matchMedia("(prefers-color-scheme: dark)").matches);
  // the status bar's words light on a dark page, dark on a light one
  const bar = () => call("StatusBar", "setStyle", { style: dark() ? "DARK" : "LIGHT" }, w).catch(() => null);
  bar();
  try { w.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bar); } catch (e) { /* */ }
  try { new w.MutationObserver(bar).observe(d.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); } catch (e) { /* */ }
  call("SplashScreen", "hide", {}, w).catch(() => null);
}

// ---------------------------------------------------------------------------------------------- start
// main.jsx (mobile build, on a phone): everything above wired once. window.FinComNative is what the screens read (the
// upload box's "Scan pages" button) and what the settings will use (the app lock)
export function start(w = win()) {
  if (!isNative(w) || w.FinComNative) return w.FinComNative || null;
  const push = pushClient(w), lock = appLock(w);
  frame(w);
  // the app's version (the stores' version name), sent with the push token
  call("App", "getInfo", {}, w).then((i) => { w.__fincomAppVersion = String((i && i.version) || "").slice(0, 40) || null; }, () => null);
  secureSession(w).install(theCloud(w), (s, before) => {
    if (s && (!before || before.user_id !== s.user_id)) push.register().catch(() => null);
    if (!s) push.forget(before);
  });
  catchDownloads(w);
  push.wire();
  if (theCloud(w) && theCloud(w).on && theCloud(w).on()) push.register().catch(() => null);
  listen("App", "backButton", () => onBack(w), w);
  listen("App", "appUrlOpen", (e) => {
    const h = deepLinkHash(e && e.url);
    if (!h) return;
    if (/access_token=/.test(h)) { w.location.replace(w.location.pathname + h); w.location.reload(); } else w.location.hash = h;
  }, w);
  listen("App", "appStateChange", (s) => { lock.state(!!(s && s.isActive)); if (s && s.isActive) push.save(); }, w);
  listen("CapacitorShareTarget", "shareReceived", (ev) => {
    sharedFiles(ev, w).then((fs) => { if (fs.length) w.handleFiles(fs, shareMode(w)); else w.toast("FinCom takes PDFs, photos and Excel files."); }, () => w.toast("The shared file could not be opened."));
  }, w);
  lock.lock();
  w.FinComNative = { platform: platform(w), scan: () => scan({ w }).catch((e) => w.toast("The camera could not be used: " + ((e && e.message) || e))), saveFile: (h, n) => saveFile(h, n, w),
    lock, setAppLock: (on) => { try { w.localStorage.setItem("fincom.applock", on ? "on" : "off"); } catch (e) { /* */ } } };
  try { const st = theState(w); if (typeof w.render === "function" && st && st.firm) w.render(); } catch (e) { /* drawn next time */ }
  return w.FinComNative;
}
