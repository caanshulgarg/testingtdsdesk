// FinCom's service worker (stability batch 4): the app's own files kept on this computer, so a second open is instant
// and FinCom opens without a line. Built by vite.config.js (fincom-sw) with this build's id and file list.
// Rules (the owner's, 11-Oct-2026):
//  - never an outdated app after a release: the page itself (index.html) always comes from the network first (past
//    every cache, with a short wait), and only from here when there is no line; every other file has its build's hash
//    in its name or address, so a new build's files are new files. A new build's worker takes over once a page of its
//    build has drawn FinCom (27-Oct-2026: never while a page is loading; install below) and drops the old build's files; the open page says "A newer FinCom is out. Reload" (fresh.js);
//  - only FinCom's own code, styles and fonts are kept: nothing from Supabase (the firm's data), the bridge, Sentry or
//    any other address goes through here at all; build.json is always the network's;
//  - on sign-out the page clears the files kept after the first open (fincom-files:…) as well (src/js/27).
const VERSION = "mw7h3b95-4b5c54";
// round 73 B: FILES, kept at install, are what the first page needs; REST, the other files of this build, are kept once
// the first page is up and the computer is idle (the page sends "fincom:keep-rest", main.jsx)
const FILES = ["./","./legacy.js?v=08c6da481751","./guard.js","./oldcheck.js","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/index-CSe2P1p6.css","./assets/index-CGB3tA9l.js"];
const REST = ["./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/Books-B1phg4vK.css","./assets/Gst-BmwLksAm.css","./assets/PreFile-Cs_yLHdm.css","./assets/Tally-CkcGG7Q0.css","./assets/Bank-BGYHovsP.css","./assets/returns-C85MxT0v.css","./assets/DetailDrawer-BbJA1sRZ.css","./assets/TallyCompanies-VrjlRbnt.css","./assets/Integrations-C1RPLvE9.css","./assets/AssistantEntries-BiMrQpZd.css","./assets/MyMis-CEycmWma.css","./assets/Corporate-B-2qbAGV.css","./assets/Reports-Dci7HM2A.css","./assets/Depr-CRK3iz9Y.css","./assets/AiMap-B8Xrao83.css","./assets/firstOpen-BzUPfZtE.js","./assets/tallyJson-B5JyoQQQ.js","./assets/bridgeFollow-ClNnSeti.js","./assets/registers-uJZDOZG8.js","./assets/timings-Co8Gx-Cj.js","./assets/sentry-DSO5A4Z2.js","./assets/Assistant-CTcHwtmb.js","./assets/Announce-C4TuvGBq.js","./assets/FirmSetup-DH6kYMRA.js","./assets/MeetCard-BksuJeZq.js","./assets/knock-bLplPKxn.js","./assets/realtime-DUYArwig.js","./assets/api-Bg8s4KSN.js","./assets/autopost-BqQkRMNP.js","./assets/yourData-lGRWSH4F.js","./assets/Books-Di16d3EH.js","./assets/chevron-down-CCiggV7G.js","./assets/Gst-DTyuN4ZT.js","./assets/gstr1Fix-BqczUdp_.js","./assets/undo-2-C0iY3-Bi.js","./assets/PreFile-DMJOj5Rk.js","./assets/Settings-Bk5MHrUl.js","./assets/LogoPick-CQ6L8tAv.js","./assets/AdvOptIn-CJqkf3KV.js","./assets/Tally-luPZCDgu.js","./assets/NeedAction-eP5I_ZYU.js","./assets/Bank-bK2k10XU.js","./assets/bankOverlap-6mEgTqHg.js","./assets/BankSettings-V0jXqfMJ.js","./assets/Sales-sJCBx1XN.js","./assets/55-einvoice-BdpnM8ZI.js","./assets/LedgerSelect-DPluDY3C.js","./assets/Post-hZhvvRFZ.js","./assets/BankChecks-CxJ8PcD2.js","./assets/Help-BICgXPkl.js","./assets/Txn-CW2iSen5.js","./assets/Parties-DYL3t-Qe.js","./assets/VendorRecon-nUz3QOEw.js","./assets/42-vendor-recon-DUYmbB4a.js","./assets/Compliance-B4g4ks3l.js","./assets/tallyConnect-BJ2DEx1Q.js","./assets/finExport-DukdsBw-.js","./assets/88-fin-recon--Mt0XGpq.js","./assets/AssistantVoice-BeJiWxg-.js","./assets/plus-CyyaXQE_.js","./assets/NoDeviceNote-C4q80Scp.js","./assets/DetailDrawer-HOVn0adN.js","./assets/97-postto-link-CBecr08N.js","./assets/98-post-register-BwhN5gnf.js","./assets/FiledCompare-BtgkbHwi.js","./assets/FileApi-DvH6rw_X.js","./assets/PyBs-DwPPSoUD.js","./assets/GstApiCard-K3uj0Dip.js","./assets/SheetPanel-vUnwC3Os.js","./assets/GstApiAll-CSr6gqlF.js","./assets/LedgerBox-v1MQLI2z.js","./assets/TallyCompanies-BO0tthrJ.js","./assets/Integrations-BgISUk4g.js","./assets/Meetings-xLHIiQyU.js","./assets/GateBanner-CdGzgZpl.js","./assets/LedgerDrop-B84OLb4l.js","./assets/TallyPop-6aeZMIpI.js","./assets/CouponBox-C6ROnqeN.js","./assets/TwoStep-D36uaFGc.js","./assets/authLink-CSz7_cYH.js","./assets/gzUpload-DVwRGgD4.js","./assets/AssistantUploads-6YDxCWGH.js","./assets/AssistantEntries-esj9s6Jb.js","./assets/trash-12vG8vg3.js","./assets/AssistantMis-qDajIIaX.js","./assets/misdef-Xh-mU6XF.js","./assets/AssistantFs-CZkzoMHz.js","./assets/asst-compare-DOSXzDPp.js","./assets/VoiceRecorder-e1pYwtGf.js","./assets/MyMis-Dhb5d7Ow.js","./assets/Corporate-B-C_XUPA.js","./assets/Reports-C2f9pyJb.js","./assets/reportsExport-DVMJDqMl.js","./assets/Depr-DLG1Ndma.js","./assets/tdsExcel-DRrP_g7y.js","./assets/r1Excel-JT_1J0vX.js","./assets/80-assets-j0JE5bMz.js","./assets/78-reports-DN6ANTCg.js","./assets/itcExcel-BvD8-Tm1.js","./assets/AiMap-BDzce7UY.js","./assets/dayBookDrop-DEH1NkTn.js","./assets/MisSchedule-Vei6Rhx6.js","./assets/misExport-BL6g0jBn.js","./assets/Aoc4-CEc1QkUi.js"];
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = "fincom-shell:" + SCOPE + ":" + VERSION, RUNTIME = "fincom-files:" + SCOPE;
const CODE = /\.(js|mjs|css|woff2?|wasm)$/;

// a file whose name or address carries its build's hash may come from the browser's cache (the page has just fetched it:
// not again over the line); the page and the two little scripts without a hash past it
const HASHED = (f) => /^\.\/assets\//.test(f) || /^\.\/legacy\.js\?v=/.test(f);
const ask = (f) => new Request(f, { cache: HASHED(f) ? "default" : "reload" });
// 24-Oct-2026 (Safari, right after a publish): each file kept on its own, and only a real answer (keepable); one file
// that does not come (a publish half way across GitHub's servers) no longer fails the whole install and leaves the older
// worker in charge. A file not kept now is fetched and kept when it is first used
// speed round (27-Oct-2026): the browser looks for a new worker at every open, so right after a publish the new worker was
// installed WHILE the page was still downloading the same files, and fetched them all a second time beside it (legacy.js,
// 600 KB, twice at once on the first open after each release; the owner: "it's too slow" on office Wi-Fi). Now the
// install takes only what the browser already holds (only-if-cached: never the line), and the page itself (5 KB); the rest
// of the first page's files is kept by keepRest below once the page is up and idle, or when first used
// 27-Oct-2026 (the owner's BLANK page on Safari after the speed build): that install took nothing from the line, so it
// was over in a few milliseconds, and skipWaiting() + clients.claim() put the new worker in charge WHILE the new build's
// first page was still loading through the previous worker. Safari stops a worker that is replaced, and the requests it
// was answering for the page (guard.js, the styles: they hold up the page's drawing and its scripts) never finished: a
// white page, no script ran, so no watch and no report. Now a new build's worker never takes over by itself while a page
// is open: it waits until a page of ITS build has drawn FinCom and asks ("fincom:take-over" with its build id,
// src/main.jsx), or, as browsers do anyway, until no FinCom page is open. A worker installed with no page in its charge
// (the first open here) still starts at once.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(FILES.map((f) => {
    const q = f === "./" ? ask(f) : new Request(f, { cache: "only-if-cached", mode: "same-origin" });
    return fetch(q).then((r) => (f === "./" ? r.ok && !r.redirected : keepable(r)) ? c.put(new Request(f), r) : null).catch(() => null);
  }))).then(() => { if (!self.registration.active) return self.skipWaiting(); }));
});
// the rest, one file after another (never in the way of the page's own requests); a file already kept is not fetched again
let keeping = null;
function keepRest() {
  return keeping || (keeping = caches.open(SHELL).then(async (c) => {
    for (const f of FILES.filter((x) => x !== "./").concat(REST)) {
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
  // a page of this build has drawn FinCom (its own requests are done): this worker may take over now (install, above)
  if (e.data && e.data.type === "fincom:take-over" && e.data.build === VERSION) e.waitUntil(self.skipWaiting());
});

// the page: the network first, past the browser's cache; this computer's copy only when there is no answer (or none in 4 s).
// 24-Oct-2026 (Sentry FINCOM-APP-STAGING-3 / -5, Mac Safari, right after a publish: "did not open in 20 s", the page the
// worker's kept copy, "error loading script legacy.js"): a page asked for by its build (?v=…, index.html's check found a
// newer build than the kept page) waited for the network with no end. When that one request hung, the kept page
// stayed on screen with its program held back (it was being swapped; in Safari its scripts' loads were cancelled by the
// swap), until Safari was quit. Now no wait is without an end, and a request that hangs is given up and asked again:
//  - the plain page: the network for 4 s; then, before the kept copy is handed back, build.json (2.5 s) says which build
//    is out: a kept copy of another build is never handed back while the line answers, the page is asked again instead;
//  - the page by its build: 6 s, then asked once more past every cache (10 s); the kept copy only when that fails too.
const wait = (ms) => new Promise((ok) => setTimeout(() => ok(null), ms));
function net(req, ms, cacheMode) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const p = fetch(req, ctl ? { cache: cacheMode, signal: ctl.signal } : { cache: cacheMode });
  return { p, stop: () => { try { if (ctl) ctl.abort(); } catch (e) { /* */ } }, within: () => Promise.race([p.catch(() => null), wait(ms)]) };
}
const keptBuild = (t) => { const m = /"fincom:opened"\)===\"([^"]+)\"/.exec(t || ""); return m ? m[1] : ""; };
async function serverBuild() {
  try {
    const r = await Promise.race([fetch("./build.json?t=" + Date.now(), { cache: "no-store" }), wait(2500)]);
    if (!r || !r.ok) return "";
    const j = await r.json();
    return (j && j.build) || "";
  } catch (e) { return ""; }
}
async function page(req) {
  const cache = await caches.open(SHELL);
  const keep = (r) => { if (r && r.ok && !r.redirected) cache.put("./", r.clone()).catch(() => {}); return r; };
  const want = new URL(req.url).searchParams.get("v");
  const first = net(req, want ? 6000 : 4000, "no-cache");
  let r = await first.within();
  if (r) return keep(r);
  const c = await cache.match("./").catch(() => null);
  const ct = c ? await c.clone().text().catch(() => "") : "", cb = keptBuild(ct);
  if (!want) {
    const sb = await serverBuild();
    if (c && (!sb || sb === cb)) { first.p.then(keep, () => {}); return kept(c, ct); }   // no line, or the kept one is current
  } else if (c && cb === want) { first.p.then(keep, () => {}); return kept(c, ct); }
  // the line answers but the page did not come: asked again past every cache
  first.stop();
  const again = net(req, 10000, "reload");
  r = await again.within();
  if (r) return keep(r);
  if (c) return kept(c, ct);
  return again.p;
}
// the kept copy is marked (data-boot-kept on <html>): its program waits for index.html's build check before it starts,
// so an older build is swapped before it is drawn (src/main.jsx)
async function kept(c, text) {
  try {
    const t = text || await c.clone().text();
    return new Response(t.replace("<html ", '<html data-boot-kept="" '), { status: c.status, statusText: c.statusText, headers: c.headers });
  } catch (e) { return c; }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(SCOPE)) return;   // Supabase, the bridge, Sentry: never here
  if (req.mode === "navigate") { e.respondWith(page(req)); return; }
  // 24-Oct-2026: a file the page asks for straight from the network (?fincom-net=…: legacy.js's second try, oldcheck.js)
  // is not answered here at all
  if (u.searchParams.has("fincom-net")) return;
  const rest = u.pathname.slice(SCOPE.length);
  // the two little scripts without a hash in their name: the network first, this computer's copy without a line
  // 27-Oct-2026: they hold up the page: this computer's copy first (little, below)
  if (rest === "guard.js" || rest === "oldcheck.js") { e.respondWith(little(req, e)); return; }
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
// guard.js and oldcheck.js, the two little scripts without a hash: they hold up the reading of the page (guard.js in its
// head, oldcheck.js in its body), and asking the line for them first cost the owner's opens 3 s and 28 s on office Wi-Fi
// (client_timings 27-Oct-2026: open/dom 9.8 s and 34.8 s, every other file from here, one script waiting on the line).
// They change seldom and any build runs with either copy: this computer's copy at once, the line's asked meanwhile and
// kept for the next open; without a copy, the line, and never more than 4 s of waiting when a copy turns up
async function little(req, e) {
  const c = await caches.open(SHELL);
  const n = fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) c.put(req, r.clone()).catch(() => {}); return r; });
  try { e.waitUntil(n.catch(() => {})); } catch (x) { /* kept when it comes, if the worker is still up */ }
  const h = await caches.match(req, { ignoreSearch: true, ignoreVary: true }).catch(() => null);
  if (h && h.ok) { n.catch(() => {}); return h; }
  const r = await Promise.race([n.catch(() => null), wait(4000)]);
  if (r) return r;
  const h2 = await caches.match(req, { ignoreSearch: true, ignoreVary: true }).catch(() => null);
  return h2 || n.catch(() => Response.error());
}
async function asset(req) {
  let hit = null;
  try { hit = await caches.match(req, { ignoreVary: true }); } catch (e) { hit = null; }
  if (hit && hit.ok && !hit.redirected && hit.type !== "opaque" && hit.type !== "opaqueredirect") return hit;
  // 24-Oct-2026: a request that hangs (no answer in 15 s) is given up and asked once more, as a dropped line is
  let r;
  const once = (q, ms) => Promise.race([fetch(q), new Promise((ok, no) => setTimeout(() => no(new Error("timeout")), ms))]);
  try { r = await once(req, 15000); } catch (e) {
    try { r = await once(new Request(req.url, { cache: "reload", credentials: "same-origin" }), 30000); } catch (e2) { return Response.error(); }
  }
  if (keepable(r)) { const c = r.clone(); caches.open(RUNTIME).then((s) => s.put(req, c)).catch(() => {}); }
  return r;
}
