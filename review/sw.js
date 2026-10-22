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
const VERSION = "mvjlgm76-3b5fca";
// round 73 B: FILES, kept at install, are what the first page needs; REST, the other files of this build, are kept once
// the first page is up and the computer is idle (the page sends "fincom:keep-rest", main.jsx)
const FILES = ["./","./legacy.js?v=2e1b4aa130d5","./guard.js","./oldcheck.js","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/index-DD-LSYcm.css","./assets/index-CYo14njv.js"];
const REST = ["./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/Books-sypdaYHo.css","./assets/returns-C85MxT0v.css","./assets/Integrations-C1RPLvE9.css","./assets/AssistantEntries-BiMrQpZd.css","./assets/MyMis-CEycmWma.css","./assets/Reports-Dci7HM2A.css","./assets/registers-CzgUIo79.js","./assets/sentry-DScu2xWY.js","./assets/Assistant-zArMASTz.js","./assets/Books-Bk36G583.js","./assets/88-fin-statements-zUVODDMw.js","./assets/chevron-down-BuAk9eoH.js","./assets/Gst-TzRinIXe.js","./assets/Settings-CMra68Wz.js","./assets/AdvOptIn-SDTVonkQ.js","./assets/Tally-C-pR0QFh.js","./assets/NeedAction-EBv-pYBH.js","./assets/Bank-CHPgAObp.js","./assets/BankSettings-CpkN9efR.js","./assets/Sales-JOSp4m2-.js","./assets/55-einvoice-BdpnM8ZI.js","./assets/LedgerSelect-BX2sQtZb.js","./assets/Post-D9jciHoc.js","./assets/BankChecks-B8I8i8_e.js","./assets/Help-BOWXoZuf.js","./assets/Txn-DbAstAqR.js","./assets/Parties-Dz2AVccr.js","./assets/VendorRecon-BZzXIe9a.js","./assets/Compliance-11bgItfz.js","./assets/Integrations-2TOHfH2S.js","./assets/GstApiCard-DPpRKBjw.js","./assets/GstApiAll-5fFFn2Ar.js","./assets/FiledCompare-BGWHfDnq.js","./assets/FileApi-B-BqEdBl.js","./assets/SheetPanel-bSZVZnRA.js","./assets/LedgerBox-T8yN7PQR.js","./assets/OlderEntries-CgfjYiuq.js","./assets/AssistantUploads-BtU0dgu3.js","./assets/AssistantEntries-BPuQc2qy.js","./assets/AssistantMis-9Jw1kNAn.js","./assets/VoiceRecorder-CoKZskCT.js","./assets/MyMis-DW9bJjP0.js","./assets/AssistantVoice-CHEqQaHA.js","./assets/trash-Bcd3-WHv.js","./assets/misdef-Xh-mU6XF.js","./assets/Reports-Cbo38jDj.js","./assets/reportsExport-COrL1KJI.js","./assets/80-assets-j0JE5bMz.js","./assets/finExport-BhhvSwJj.js","./assets/78-reports-DN6ANTCg.js","./assets/MisSchedule-BEH8NRYY.js","./assets/misExport-BQ8-cT7x.js"];
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
      // round 90: a real script / style / font answer only (keepable, below); a broken kept copy is replaced
      try { const h = await caches.match(f, { ignoreVary: true }); if (!h || !good(h)) { const q = ask(f), r = await fetch(q); if (keepable(r)) await c.put(q, r); } } catch (e) { /* kept when it is first used */ }
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
  e.respondWith(asset(req));
});

// 19-Oct-2026 (round 90: Safari's "Importing a module script failed" on the TDS page, the files all there, again after
// every reload): a kept copy is only ever a real answer of this site with a script, style or font in it.
//  - kept: an answer that is ok, "basic" (this site's own), not redirected, and a script / style / font by its type;
//  - a kept copy that is not ok, redirected or opaque (kept by an older worker, or broken) is passed over: the network's;
//  - the line dropped (a network error): asked once more past the browser's cache (cache: "reload") before giving up.
const KEEP = /(javascript|ecmascript|text\/css|font\/|application\/(x-)?font|woff|wasm)/i;
const good = (r) => !!r && r.ok && r.type === "basic" && !r.redirected;
const keepable = (r) => good(r) && KEEP.test(r.headers.get("Content-Type") || "");
async function asset(req) {
  let hit = null;
  try { hit = await caches.match(req, { ignoreVary: true }); } catch (e) { hit = null; }
  if (hit && hit.ok && !hit.redirected && hit.type !== "opaque" && hit.type !== "opaqueredirect") return hit;
  let r;
  try { r = await fetch(req); } catch (e) {
    try { r = await fetch(new Request(req, { cache: "reload" })); } catch (e2) { return Response.error(); }
  }
  if (keepable(r)) { const c = r.clone(); caches.open(RUNTIME).then((s) => s.put(req, c)).catch(() => {}); }
  return r;
}
