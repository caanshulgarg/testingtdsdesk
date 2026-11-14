// next-speed-worker: the engine's worker, first part (app/engine/worker.js): the page's own legacy.js (its address and
// version from the page's first word, init), read in a worker, before the React app's GST wraps and the MIS screen's file. legacy.js reads a few of the page's things as it loads (the drawing's and the
// boot's, never the engines'): here they are stand-ins that do nothing, and its boot waits for a page that never comes
// (document.readyState "loading"). The timers it sets as it loads (the cloud copy's, the live line's) are not set here.
/* global importScripts */
const noop = () => {};
// a stand-in that takes anything: any property, call or new gives another
const none = (name) => new Proxy(function () {}, {
  get(t, k) { if (k === Symbol.toPrimitive) return () => ""; if (k === "then") return noop; if (k === "readyState") return "loading"; if (k === "hidden") return false; if (k === "visibilityState") return "visible"; return none(name + "." + String(k)); },
  apply() { return none(name + "()"); }, construct() { return none("new " + name); }, set() { return true; },
});
// this browser's settings, as the page sent them (Engine.sNow: sign-in left out); written to here only
const LS = new Map();
const store = {
  getItem: (k) => (LS.has(String(k)) ? LS.get(String(k)) : null), setItem: (k, v) => { LS.set(String(k), String(v)); }, removeItem: (k) => { LS.delete(String(k)); },
  clear: () => LS.clear(), key: (i) => Array.from(LS.keys())[i] ?? null, get length() { return LS.size; },
};
self.__engineLS = LS;
const put = (k, v) => { try { Object.defineProperty(self, k, { value: v, writable: true, configurable: true }); } catch (e) { /* kept as it is */ } };
put("window", self);
["document", "history", "screen"].forEach((k) => put(k, none(k)));
put("localStorage", store); put("sessionStorage", { getItem: () => null, setItem: noop, removeItem: noop, clear: noop, key: () => null, length: 0 });
put("matchMedia", () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }));
class Quiet { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
["MutationObserver", "ResizeObserver", "IntersectionObserver"].forEach((k) => put(k, Quiet));
["HTMLElement", "Element", "Node", "Image", "HTMLCanvasElement"].forEach((k) => { if (typeof self[k] === "undefined") put(k, class {}); });
["alert", "confirm", "prompt", "scrollTo", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].forEach((k) => put(k, noop));
put("innerWidth", 1400); put("innerHeight", 900);
// next-speed-worker, review of part 1: the worker can never write. Every way legacy.js writes (the books, the client,
// bank, files, rules, drafts, sales; this browser's store and settings; a file to save) throws here: a run that tried
// would fail in the worker and be worked out on the page instead. (fetch, XHR and WebSocket refuse: no network either)
export const DENIED = ["saveBooks", "saveBank", "saveBridgeSetup", "saveDraft", "saveFile", "saveNewCompany", "saveRules", "saveSales", "flushAuditLater", "flushBillSaves", "flushBillSavesAndSend", "lsSet", "lsDel"];
// Books.save's records for the page (worker.js storeMsg, Engine.store): the one write the worker makes, with this
// browser's indexedDB as the worker found it (taken before denyWrites). One transaction, given up as a whole on an error.
// Review of the full stack: the worker never makes or upgrades the database. It is opened without a version: one that
// is not there (another tab's "clear this browser's copy") is not made again (its upgrade given up), nor one without the
// store; another tab removing it meanwhile (its versionchange) gives the save up. live(): still to be written (f looks
// at it just before its writes)
const IDB = self.indexedDB;
export function storeTx(name, f) {
  return new Promise((ok, no) => {
    if (!IDB || !name) { no(new Error("no store to write to")); return; }
    let r;
    try { r = IDB.open(name); } catch (e) { no(e); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* given up */ } };
    r.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); no(r.error || new Error("the store did not open")); };
    r.onblocked = () => {};
    r.onsuccess = () => {
      const db = r.result; let t, gone = false;
      if (!db.objectStoreNames.contains("docs")) { db.close(); no(new Error("the store is not there")); return; }
      try { t = db.transaction("docs", "readwrite"); } catch (e) { db.close(); no(e); return; }
      db.onversionchange = () => { gone = true; try { t.abort(); } catch (e) { /* done */ } db.close(); };
      t.oncomplete = () => { db.close(); gone ? no(new Error("the store was removed")) : ok(); };
      t.onabort = t.onerror = () => { db.close(); no(t.error || new Error("the save was given up")); };
      try { f(t.objectStore("docs"), t, () => !gone); } catch (e) { try { t.abort(); } catch (x) { /* given up */ } }
    };
  });
}
const STORES = () => [["Store", typeof Store === "object" ? Store : null], ["IDBStore", typeof IDBStore === "object" ? IDBStore : null], ["BankDB", typeof BankDB === "object" ? BankDB : null], ["FileStore", typeof FileStore === "object" ? FileStore : null]];
const no = (what) => function () { throw new Error("the engine's worker writes nothing (" + what + ")"); };
function denyWrites() {
  DENIED.forEach((n) => { if (typeof self[n] === "function") self[n] = no(n); });
  // (the stores' every function: the engines read nothing of them either)
  STORES().forEach(([n, o]) => { if (o) Object.keys(o).forEach((k) => { if (typeof o[k] === "function") o[k] = no(n + "." + k); }); });
  if (typeof Books === "object") ["save", "drop", "load", "read"].forEach((k) => { if (typeof Books[k] === "function") Books[k] = no("Books." + k); });
  ["setItem", "removeItem", "clear"].forEach((k) => { store[k] = no("localStorage." + k); });
  put("sessionStorage", { getItem: () => null, setItem: no("sessionStorage.setItem"), removeItem: no("sessionStorage.removeItem"), clear: no("sessionStorage.clear"), key: () => null, length: 0 });
  put("indexedDB", { open: no("indexedDB.open"), deleteDatabase: no("indexedDB.deleteDatabase"), databases: no("indexedDB.databases") });
  put("caches", { open: no("caches.open"), delete: no("caches.delete"), match: no("caches.match"), keys: no("caches.keys"), has: no("caches.has") });
  try { if (self.navigator) Object.defineProperty(self.navigator, "sendBeacon", { value: no("sendBeacon"), configurable: true }); } catch (e) { /* none */ }
}

// the page's legacy.js (its address and version as the page has it), read with its timers left unset; then the engine
// reaches nothing outside: no line (its runs are written on the page). "" read, else what went wrong
export function loadLegacy(legacy) {
  if (!legacy) return "no legacy.js given";
  const st = self.setTimeout, si = self.setInterval;
  let failed = "";
  self.setTimeout = () => 0; self.setInterval = () => 0;
  // (the app's own start, src/js/27 start(), sees this and does nothing here)
  self.__fincomEngineWorker = true;
  try { importScripts(legacy); } catch (e) { failed = "legacy.js: " + ((e && e.message) || e); }
  finally { self.setTimeout = st; self.setInterval = si; }
  const refuse = () => Promise.reject(new Error("the engine's worker reaches no network"));
  put("fetch", refuse); put("XMLHttpRequest", class { open() { throw new Error("the engine's worker reaches no network"); } }); put("WebSocket", class { constructor() { throw new Error("the engine's worker reaches no network"); } });
  if (!failed) denyWrites();
  return failed;
}
