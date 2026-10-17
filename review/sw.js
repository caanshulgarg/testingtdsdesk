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
const VERSION = "mvce2hsn-1c032b";
// round 73 B: FILES, kept at install, are what the first page needs; REST, the other files of this build, are kept once
// the first page is up and the computer is idle (the page sends "fincom:keep-rest", main.jsx)
const FILES = ["./","./legacy.js?v=3ff1b7740e55","./guard.js","./oldcheck.js","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/index-h4OcD_n9.css","./assets/index-C1ab8yKU.js"];
const REST = ["./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/Books-CHTEXAAj.css","./assets/returns-C85MxT0v.css","./assets/Integrations-C1RPLvE9.css","./assets/registers-CzgUIo79.js","./assets/sentry-gLiaBZ6V.js","./assets/Assistant-BFNpjPkB.js","./assets/Books-BRpXwlO8.js","./assets/chevron-down-DTbggI4k.js","./assets/Gst-BOcqqcZX.js","./assets/Settings-D1_crZtA.js","./assets/Ai-DjL1hTjl.js","./assets/Tally-C0WZvbwI.js","./assets/NeedAction-CUYlRxbz.js","./assets/Bank-B9muFm-y.js","./assets/BankSettings-aPC2h15f.js","./assets/Sales-DQbXk1PN.js","./assets/LedgerSelect-DLxhpKPf.js","./assets/Confirm-BOSapIYN.js","./assets/Post-B53JKP_J.js","./assets/BankChecks-JyXKvCFn.js","./assets/Help-D0U8oxE_.js","./assets/Txn-BMjEZ8Nw.js","./assets/Parties-C7a481nF.js","./assets/VendorRecon-lCnrGCzt.js","./assets/Compliance-DJTT47E6.js","./assets/Integrations-DNNlxJ6O.js","./assets/GstApiCard-B2o_D9sf.js","./assets/GstApiAll-BhavRmah.js","./assets/FiledCompare-fSMzEb3A.js","./assets/FileApi-C-G1hPwD.js","./assets/SheetPanel-CFhZO6t2.js","./assets/DetailDrawer-DIMCUEJ4.js","./assets/LedgerBox-DzR5wPjf.js","./assets/AssistantUploads-CBGd_TRN.js","./assets/80-assets-j0JE5bMz.js","./assets/78-reports-DhXo2pjA.js"];
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = "fincom-shell:" + SCOPE + ":" + VERSION, RUNTIME = "fincom-files:" + SCOPE;
const CODE = /\.(js|mjs|css|woff2?|wasm)$/;

// a file whose name or address carries its build's hash may come from the browser's cache (the page has just fetched it:
// not again over the line); the page and the two little scripts without a hash past it
const HASHED = (f) => /^\.\/assets\//.test(f) || /^\.\/legacy\.js\?v=/.test(f);
const ask = (f) => new Request(f, { cache: HASHED(f) ? "default" : "reload" });
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map(ask))).then(() => self.skipWaiting()));
});
// the rest, one file after another (never in the way of the page's own requests); a file already kept is not fetched again
let keeping = null;
function keepRest() {
  return keeping || (keeping = caches.open(SHELL).then(async (c) => {
    for (const f of REST) {
      try { if (!(await caches.match(f, { ignoreVary: true }))) await c.add(ask(f)); } catch (e) { /* kept when it is first used */ }
    }
  }).finally(() => { keeping = null; }));
}
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => (k.startsWith("fincom-shell:" + SCOPE + ":") && k !== SHELL) || k === RUNTIME).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => {
  if (e.data === "fincom:signed-out") e.waitUntil(caches.delete(RUNTIME));
  if (e.data === "fincom:keep-rest") e.waitUntil(keepRest());
});

// the page: the network first, past the browser's cache; this computer's copy only when there is no answer (or none in 4 s).
// A page asked for by its build (?v=…: index.html's check found a newer build than the page it was given) waits for the
// network as long as it takes (17-Oct-2026: on a slow line the 4 s wait handed back the old page again)
async function page(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) cache.put("./", r.clone()); return r; });
  const byBuild = new URL(req.url).searchParams.has("v");
  try {
    const r = byBuild ? await net : await Promise.race([net, new Promise((ok) => setTimeout(ok, 4000)).then(() => null)]);
    if (r) return r;
    const c = await cache.match("./");
    return c ? kept(c) : await net;
  } catch (e) {
    const c = await cache.match("./");
    if (c) return kept(c);
    throw e;
  }
}
// the kept copy is marked (data-boot-kept on <html>): its program waits for index.html's build check before it starts,
// so an older build is swapped before it is drawn (src/main.jsx)
async function kept(c) {
  try {
    const t = await c.clone().text();
    return new Response(t.replace("<html ", '<html data-boot-kept="" '), { status: c.status, statusText: c.statusText, headers: c.headers });
  } catch (e) { return c; }
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
