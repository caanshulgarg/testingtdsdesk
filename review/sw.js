// FinCom's service worker (stability batch 4): the app's own files kept on this computer, so a second open is instant
// and FinCom opens without a line. Built by vite.config.js (fincom-sw) with this build's id and file list.
// Rules (the owner's, 11-Oct-2026):
//  - never an outdated app after a release: the page itself (index.html) always comes from the network first (past
//    every cache, with a short wait), and only from here when there is no line; every other file has its build's hash
//    in its name or address, so a new build's files are new files. A new build's worker takes over at once (skipWaiting,
//    clients.claim) and drops the old build's files; the open page says "A newer FinCom is out. Reload" (fresh.js);
//  - only FinCom's own code, styles and fonts are kept: nothing from Supabase (the firm's data), the bridge, Sentry or
//    any other address goes through here at all; build.json is always the network's;
//  - on sign-out the page clears the files kept after the first open (fincom-files:…) as well (src/js/27).
const VERSION = "mv9pwbp7-e6f52f";
const FILES = ["./","./legacy.js?v=b96d683b2ee5","./guard.js","./oldcheck.js","./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/index-CPFHwsGQ.css","./assets/Books-CHTEXAAj.css","./assets/returns-CI7VCqLE.css","./assets/Integrations-C1RPLvE9.css","./assets/index-M6CLIvAQ.js","./assets/registers-DwPoKqdV.js","./assets/sentry-CqFut6nB.js","./assets/Assistant-Co2f3AWk.js","./assets/Books-B3x_2F_e.js","./assets/Gst-Be00RQya.js","./assets/Settings-DlLRs6qn.js","./assets/Ai-D1jkx1rK.js","./assets/Tally--0UZrIb3.js","./assets/NeedAction-FyQvlPM2.js","./assets/Bank-Vp40uTjl.js","./assets/BankSettings-BuJ8rhhI.js","./assets/Sales-C0MW1AyK.js","./assets/LedgerSelect-DZ_zMeAh.js","./assets/Confirm-BJ5gnBOW.js","./assets/Post-BICYGQ5F.js","./assets/BankChecks-CVjc3vJ1.js","./assets/Help-BRdrpx8C.js","./assets/Txn-BHta4P61.js","./assets/Parties-DRtcY_FR.js","./assets/VendorRecon-C1lDn5A2.js","./assets/Compliance-BOxvSYgV.js","./assets/Integrations-BCvooUzx.js","./assets/GstApiCard-B1LAXXka.js","./assets/GstApiAll-CalPQQoL.js","./assets/FiledCompare-D52sL4CM.js","./assets/SheetPanel-BwIBxdgH.js","./assets/DetailDrawer-DmSfb5mj.js","./assets/LedgerBox-Cq1hyAMt.js","./assets/AssistantUploads-BzHLThXR.js","./assets/80-assets-j0JE5bMz.js","./assets/78-reports-DIMOY2X8.js"];
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = "fincom-shell:" + SCOPE + ":" + VERSION, RUNTIME = "fincom-files:" + SCOPE;
const CODE = /\.(js|mjs|css|woff2?|wasm)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => (k.startsWith("fincom-shell:" + SCOPE + ":") && k !== SHELL) || k === RUNTIME).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => {
  if (e.data === "fincom:signed-out") e.waitUntil(caches.delete(RUNTIME));
});

// the page: the network first, past the browser's cache; this computer's copy only when there is no answer (or none in 4 s)
async function page(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) cache.put("./", r.clone()); return r; });
  try {
    const r = await Promise.race([net, new Promise((ok) => setTimeout(ok, 4000)).then(() => null)]);
    if (r) return r;
    return (await cache.match("./")) || (await net);
  } catch (e) {
    const c = await cache.match("./");
    if (c) return c;
    throw e;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(SCOPE)) return;   // Supabase, the bridge, Sentry: never here
  if (req.mode === "navigate") { e.respondWith(page(req)); return; }
  const rest = u.pathname.slice(SCOPE.length);
  // the two little scripts without a hash in their name: the network first, this computer's copy without a line
  if (rest === "guard.js" || rest === "oldcheck.js") { e.respondWith(caches.open(SHELL).then((c) => fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }, () => c.match(req, { ignoreSearch: true }).then((h) => h || Response.error())))); return; }
  // kept here: only files whose name or address carries their build's hash (assets/…, legacy.js?v=…)
  if (!((rest.startsWith("assets/") && CODE.test(rest)) || (rest === "legacy.js" && u.search))) return;
  e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.type === "basic") { const c = r.clone(); caches.open(RUNTIME).then((s) => s.put(req, c)); }
    return r;
  })));
});
