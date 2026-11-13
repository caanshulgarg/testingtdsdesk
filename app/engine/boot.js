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
// the page's legacy.js (its address and version as the page has it), read with its timers left unset; then the engine
// reaches nothing outside: no line (its runs are written on the page). "" read, else what went wrong
export function loadLegacy(legacy) {
  if (!legacy) return "no legacy.js given";
  const st = self.setTimeout, si = self.setInterval;
  let failed = "";
  self.setTimeout = () => 0; self.setInterval = () => 0;
  try { importScripts(legacy); } catch (e) { failed = "legacy.js: " + ((e && e.message) || e); }
  finally { self.setTimeout = st; self.setInterval = si; }
  const refuse = () => Promise.reject(new Error("the engine's worker reaches no network"));
  put("fetch", refuse); put("XMLHttpRequest", class { open() { throw new Error("the engine's worker reaches no network"); } }); put("WebSocket", class { constructor() { throw new Error("the engine's worker reaches no network"); } });
  return failed;
}
