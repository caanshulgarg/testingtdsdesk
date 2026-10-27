// node tests/run_sw_webkit.js [site] - 27-Oct-2026 (the owner's BLANK page on Safari 26 right after the speed build,
// ab699ab25): that build's service worker took nothing from the line at install (fetch cache "only-if-cached"), so in
// Safari, where such a fetch fails at once when the file is not already held, the install was over in a few
// milliseconds and skipWaiting() + clients.claim() put the new worker in charge while the new build's first page was still
// loading through the previous worker. Safari stops a worker that is replaced, and the requests it was answering for the
// page (guard.js and the styles: they hold up the page's drawing and its scripts) never finished: a white page, no
// script ran, so no "did not open" note and nothing in Sentry.
// Chromium waits for the old worker's requests before it changes worker, so a browser test there cannot show it; this
// runs the built sw.js (app/dist-test/sw.js, or [site]/sw.js) as Safari would treat it:
//   1. a worker installed while an older worker is in charge (a page open): it does NOT take over by itself;
//   2. a page of its own build asks ("fincom:take-over" with its build id, src/main.jsx, once FinCom is drawn): it does;
//      a page of another build asking does not make it;
//   3. the first worker here (none in charge before): it takes over at once, as before;
//   4. guard.js (in the page's head, it holds up the page: open/dom 9.8 s and 34.8 s on 27-Oct-2026 while it waited on
//      the line) comes from this computer's copy at once; without a copy, the line; the line hanging, no endless wait.
// Fails on ab699ab25 (1), passes after.
const fs = require("fs"), path = require("path"), vm = require("vm");
const site = path.resolve(process.argv[2] || process.env.TDSDESK_SITE || path.join(__dirname, "..", "app", "dist-test"));
const src = fs.readFileSync(path.join(site, "sw.js"), "utf8");
const VERSION = (src.match(/const VERSION = "([^"]+)"/) || [])[1];
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };

function worker({ active, slowLine = 0 }) {
  const handlers = {}, store = new Map(), log = [];
  const cache = { put: async (q, r) => { store.set(String(q.url || q), r); }, match: async (q) => store.get(String((q && q.url) || q)) || null };
  const self = {
    location: new URL("https://staging.fincom.live/review/sw.js"),
    registration: { scope: "https://staging.fincom.live/review/", active: active ? {} : null },
    clients: { claim: async () => { log.push("claim"); } },
    skipWaiting: async () => { log.push("skipWaiting@" + (Date.now() - t0)); },
    addEventListener: (t, f) => { handlers[t] = f; },
  };
  const t0 = Date.now();
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async (q) => cache.match(q) };
  // Safari: "only-if-cached" fails at once for a file not held (the page is still downloading it); the line takes slowLine ms
  const fetch = (q, init) => {
    const mode = (init && init.cache) || q.cache;
    if (mode === "only-if-cached") return Promise.reject(new TypeError("not in the cache"));
    if (slowLine < 0) return new Promise(() => {});      // the line hangs
    return new Promise((ok) => setTimeout(() => ok(new Response("x", { status: 200, headers: { "Content-Type": /\.css/.test(q.url || q) ? "text/css" : /\.js/.test(q.url || q) ? "text/javascript" : "text/html" } })), slowLine));
  };
  const Req = class extends Request { constructor(u, o) { super(new URL(u, "https://staging.fincom.live/review/"), o && o.mode === "same-origin" ? Object.assign({}, o, { mode: "same-origin" }) : o); } };
  const ctx = vm.createContext({ self, caches, fetch, Request: Req, Response, URL, Promise, setTimeout, clearTimeout, console, AbortController });
  vm.runInContext(src, ctx);
  const until = (p) => { const w = []; return { waitUntil: (x) => w.push(Promise.resolve(x)), done: () => Promise.all(w) }; };
  return { handlers, log, store, t0, ctx, until, self };
}
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

(async () => {
  console.log("sw.js of build " + VERSION + " (" + site + ")");
  console.log("1. installed while an older worker is in charge (a page open, loading through it)");
  let w = worker({ active: true });
  let ev = w.until(); w.handlers.install(ev); await ev.done(); await pause(50);
  ok(!w.log.some((x) => x.startsWith("skipWaiting")), "it does not take over by itself while the page loads (" + (w.log.join(", ") || "waits") + ")");

  console.log("2. a page asks once FinCom is drawn");
  ev = w.until(); w.handlers.message(Object.assign({ data: { type: "fincom:take-over", build: "another-build" } }, ev)); await ev.done();
  ok(!w.log.some((x) => x.startsWith("skipWaiting")), "a page of another build: no");
  ev = w.until(); w.handlers.message(Object.assign({ data: { type: "fincom:take-over", build: VERSION } }, ev)); await ev.done();
  ok(w.log.some((x) => x.startsWith("skipWaiting")), "a page of its own build: it takes over (" + w.log.join(", ") + ")");

  console.log("3. the first worker here (nothing in charge before)");
  w = worker({ active: false });
  ev = w.until(); w.handlers.install(ev); await ev.done();
  ok(w.log.some((x) => x.startsWith("skipWaiting")), "takes over at once (" + w.log.join(", ") + ")");

  console.log("4. guard.js when the line hangs");
  w = worker({ active: true, slowLine: -1 });
  const shell = await w.ctx.caches.open("x"); await shell.put("https://staging.fincom.live/review/guard.js", new Response("kept", { headers: { "Content-Type": "text/javascript" } }));
  let answered = null;
  const fe = { request: new Request("https://staging.fincom.live/review/guard.js", { method: "GET" }), respondWith: (p) => { Promise.resolve(p).then((r) => { answered = r; }); }, waitUntil: () => {} };
  w.handlers.fetch(fe);
  await pause(300);
  ok(!!answered, "answered from this computer's copy at once (" + (answered ? "yes" : "still waiting") + ")");
  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
