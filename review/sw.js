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
const VERSION = "mwusue84-f62034";
// round 73 B: FILES, kept at install, are what the first page needs; REST, the other files of this build, are kept once
// the first page is up and the computer is idle (the page sends "fincom:keep-rest", main.jsx)
const FILES = ["./","./legacy.js?v=18490e233867","./guard.js","./oldcheck.js","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/index-DUzmTpjw.css","./assets/index-NEaFvizW.js"];
const REST = ["./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/Books-B1phg4vK.css","./assets/Gst-BmwLksAm.css","./assets/PreFile-BA4KCfgm.css","./assets/Settings-D06NQ7oZ.css","./assets/CommitBox-CTR7p3G0.css","./assets/DetailDrawer-BbJA1sRZ.css","./assets/newlook-DLg3nk8r.css","./assets/returns-CtH_iqK_.css","./assets/NoticeLine-CtNx_YJY.css","./assets/TallyCompanies-CgPljf3Y.css","./assets/Tally-C-zXi6Bw.css","./assets/daily-Brfl8Cid.css","./assets/LinkStatus-IvmP9XTX.css","./assets/Bank-D3TAlzx2.css","./assets/Integrations-C1RPLvE9.css","./assets/calendar-BYhs-OP_.css","./assets/AssistantEntries-BiMrQpZd.css","./assets/MyMis-CEycmWma.css","./assets/Corporate-B-2qbAGV.css","./assets/Payroll-BO4BpaIP.css","./assets/ITR-BOgw_-aQ.css","./assets/FinComBooks-CnqgcSM1.css","./assets/Reports-Dci7HM2A.css","./assets/Depr-CRK3iz9Y.css","./assets/AiMap-B8Xrao83.css","./assets/firstOpen-B-pyfd2U.js","./assets/splitBooks-B5uyniwB.js","./assets/tallyJson-B5JyoQQQ.js","./assets/bridgeFollow-D7aMyajZ.js","./assets/registers-7XLS0jk5.js","./assets/01-reading-bills-CqbM0gV-.js","./assets/timings-BR_dDCAp.js","./assets/sentry-DSKqYv_P.js","./assets/Assistant-B2vXGSUS.js","./assets/Announce-CerXYb9G.js","./assets/FirmSetup-CqG4i9U0.js","./assets/Shell-DSSQqF-z.js","./assets/prefetchBuild-CRZsv-bh.js","./assets/MeetCard-D9BVk7D2.js","./assets/knock-BQurVmpX.js","./assets/realtime-DUYArwig.js","./assets/api-Bg8s4KSN.js","./assets/autopost-eM-wu9l5.js","./assets/yourData-lGRWSH4F.js","./assets/Books-CrD5Rozg.js","./assets/18-mis-pack-DROquQRN.js","./assets/chevron-down-1tL51_un.js","./assets/Gst-COpDJv_C.js","./assets/gstr1Fix-DXsrgxI0.js","./assets/Annual-DWG7qUmT.js","./assets/download-DMhYV85D.js","./assets/PreFile-xLKPdzdp.js","./assets/Settings-CAdHaAUB.js","./assets/LogoPick-DinVqKw0.js","./assets/AdvOptIn-CFucLrsz.js","./assets/bankOverlap-B_cfJyDw.js","./assets/tallyConnect-Bbsp_G27.js","./assets/99-screen-parts-BXsTEX_D.js","./assets/ownBridge-D_lQYH3o.js","./assets/tallyPort-CwxMEAN9.js","./assets/CommitBox-OS6MPa_O.js","./assets/59-post-owner-Bsx0zbsN.js","./assets/26-sales-invoice-CYhz8P78.js","./assets/42-vendor-recon-aF6FaMEC.js","./assets/finExport-aPHd2Ky8.js","./assets/88-fin-recon-DUvmussy.js","./assets/AssistantVoice-BpyTnypE.js","./assets/plus-CDOZ3uPa.js","./assets/info-BSLk53Kr.js","./assets/NoDeviceNote-D-2i6qAk.js","./assets/undo-2-NsIMP4yT.js","./assets/DetailDrawer-DOlTaTrR.js","./assets/97-postto-link-CTPuv0aO.js","./assets/98-link-record-BqlSLBKe.js","./assets/98-post-register-BjewzNvU.js","./assets/FiledCompare-D-u0pERr.js","./assets/FileApi-oZfv9wqL.js","./assets/behind-C3AXZEHJ.js","./assets/Confirm-BJKA4-xf.js","./assets/PyBs-D_YbikEP.js","./assets/NoticeLine-BrW0r4OG.js","./assets/TallyCompanies-CZmlyJjs.js","./assets/GstApiCard-D5ew6I8n.js","./assets/VendorRecon-K6cPUB-7.js","./assets/SheetPanel-BP-y8oZb.js","./assets/AutoPostSettings-iTZnazD6.js","./assets/Tally-CPxvib1g.js","./assets/BankSettings-BJfibJaA.js","./assets/Parties-Bp4HyeE9.js","./assets/GstApiAll-CWc_sMRo.js","./assets/firmNeeds-DuJ6GaGL.js","./assets/NeedAction-KlYsMbEj.js","./assets/use-today-DCR7egtH.js","./assets/chevron-right-DI2VGQ-w.js","./assets/check-C1U1qOWO.js","./assets/LedgerBox-DWfoKDL0.js","./assets/Done-BU-vUBCB.js","./assets/55-einvoice-DDqAt1Rp.js","./assets/daily-BFLoK_Hu.js","./assets/trash-Bo1ikxY4.js","./assets/LinkStatus-p7uIR1gX.js","./assets/Bank-ffeQ_DP7.js","./assets/BankChecks-DUrbr_1i.js","./assets/OldPosted-K2kM8Vin.js","./assets/words-yUKYZEMD.js","./assets/Sales-DRrOVnjf.js","./assets/Post-CcBZNeOb.js","./assets/Help-Cz7FZJho.js","./assets/Txn-DK3N_t0g.js","./assets/Compliance-0v3S0dwm.js","./assets/AddClient-DxIqw34p.js","./assets/Integrations-DyCAd0-1.js","./assets/arrow-left-CqJmOkdf.js","./assets/Meetings-CeIQi2SU.js","./assets/GateBanner-W8LNDiQA.js","./assets/DailyCheck-BhbyyS48.js","./assets/scroll-text-RxuOhIgn.js","./assets/MailForm-C5LYWWmy.js","./assets/Bank-Bo9i_1vn.js","./assets/parts-BQNMr-_W.js","./assets/Tally-BS7RiKMP.js","./assets/Due-DTrF040t.js","./assets/LedgerDrop-DtErw1zo.js","./assets/TallyPop-B5AHUIPB.js","./assets/HomeNeeds-DYfQ6daq.js","./assets/DashTds-LPeUn6pO.js","./assets/CouponBox-DI7WP_5U.js","./assets/TwoStep-BY3lMXl3.js","./assets/authLink-Bxwwv41c.js","./assets/ColFilterPop-CjNAJ2dp.js","./assets/BillPdf-eq0Kq3-_.js","./assets/calendar-DSukBhJc.js","./assets/gzUpload-CNjVdeir.js","./assets/AssistantUploads-HGAIu8HY.js","./assets/AssistantEntries-exiVjOO9.js","./assets/asstEntries-DiR9hcsH.js","./assets/AssistantMis-B66x5Hqv.js","./assets/misdef-Bt2U1WUv.js","./assets/AssistantFs-D9Kv27aJ.js","./assets/asst-compare-DFm296CF.js","./assets/VoiceRecorder-CSCOEuxe.js","./assets/Entry-Chl4N3Pz.js","./assets/MyMis-DPh3jV9A.js","./assets/Corporate-ChWyWP4x.js","./assets/Payroll-DQTSkRAT.js","./assets/payrollPost-BJc3Y0Qn.js","./assets/again-C5wJkYOB.js","./assets/tpparts-Dc2xoSm7.js","./assets/ITR-CJgjTecw.js","./assets/FinComBooks-DdYlHRqa.js","./assets/Reports-tiKxRVMG.js","./assets/reportsExport-D8uqAapi.js","./assets/Depr-BotD7qsU.js","./assets/tdsExcel-xUoHWi1r.js","./assets/r1Excel-JT_1J0vX.js","./assets/80-assets-j0JE5bMz.js","./assets/78-reports-DRzswCN4.js","./assets/Mail-v9Ogvam1.js","./assets/itcExcel-DrT0qiWS.js","./assets/AiMap-jv-OeszX.js","./assets/dayBookDrop-DEH1NkTn.js","./assets/MisSchedule-C-OcHszW.js","./assets/misExport-CGMJ-xKm.js","./assets/Aoc4-D3YXzn1U.js","./assets/engine-1672717ec4.js"];
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
