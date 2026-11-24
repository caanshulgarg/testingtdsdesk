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
const VERSION = "mwu0mirj-695d74";
// round 73 B: FILES, kept at install, are what the first page needs; REST, the other files of this build, are kept once
// the first page is up and the computer is idle (the page sends "fincom:keep-rest", main.jsx)
const FILES = ["./","./legacy.js?v=097dc654643b","./guard.js","./oldcheck.js","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/index-Bnp5VmLV.css","./assets/index-nUrHLnYn.js"];
const REST = ["./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/Books-B1phg4vK.css","./assets/Gst-BmwLksAm.css","./assets/PreFile-BA4KCfgm.css","./assets/Settings-D06NQ7oZ.css","./assets/CommitBox-CTR7p3G0.css","./assets/DetailDrawer-BbJA1sRZ.css","./assets/newlook-DLg3nk8r.css","./assets/returns-CtH_iqK_.css","./assets/NoticeLine-CtNx_YJY.css","./assets/TallyCompanies-CgPljf3Y.css","./assets/Tally-C-zXi6Bw.css","./assets/daily-Brfl8Cid.css","./assets/LinkStatus-IvmP9XTX.css","./assets/Bank-D3TAlzx2.css","./assets/Integrations-C1RPLvE9.css","./assets/calendar-BYhs-OP_.css","./assets/AssistantEntries-BiMrQpZd.css","./assets/MyMis-CEycmWma.css","./assets/Corporate-B-2qbAGV.css","./assets/Payroll-BO4BpaIP.css","./assets/ITR-B83Pliau.css","./assets/FinComBooks-CnqgcSM1.css","./assets/Reports-Dci7HM2A.css","./assets/Depr-CRK3iz9Y.css","./assets/AiMap-B8Xrao83.css","./assets/firstOpen-B-pyfd2U.js","./assets/splitBooks-B5uyniwB.js","./assets/tallyJson-B5JyoQQQ.js","./assets/bridgeFollow-Cr7olNxE.js","./assets/registers-CMQooJrM.js","./assets/01-reading-bills-CqbM0gV-.js","./assets/timings-BR_dDCAp.js","./assets/sentry-CSlOvq27.js","./assets/Assistant-BJgnBPCk.js","./assets/Announce-CaSmli_g.js","./assets/FirmSetup-BVLa-ujc.js","./assets/Shell-UIJXotaF.js","./assets/prefetchBuild-ERHnjO_j.js","./assets/MeetCard-vo1aA2Sz.js","./assets/knock-BHF1Ul3T.js","./assets/realtime-DUYArwig.js","./assets/api-Bg8s4KSN.js","./assets/autopost-B0PXaahd.js","./assets/yourData-lGRWSH4F.js","./assets/Books-CkQqnpC4.js","./assets/18-mis-pack-DROquQRN.js","./assets/chevron-down-DDwbV2Od.js","./assets/Gst-QUV9Tgyc.js","./assets/gstr1Fix-UdpkrbzL.js","./assets/Annual-DF-PLdJQ.js","./assets/download-B6ARpk7b.js","./assets/PreFile-DO3wTdOt.js","./assets/Settings-DFXP1wzp.js","./assets/LogoPick-BHOucr3P.js","./assets/AdvOptIn-Lzb1h38Z.js","./assets/bankOverlap-B_cfJyDw.js","./assets/tallyConnect-2oxWWz7j.js","./assets/99-screen-parts-BfZoV8Sb.js","./assets/ownBridge-B_DyKR6k.js","./assets/tallyPort-CwxMEAN9.js","./assets/CommitBox-Bac-PKt6.js","./assets/59-post-owner-BtJknLYn.js","./assets/26-sales-invoice-CgXbyDF9.js","./assets/42-vendor-recon-aF6FaMEC.js","./assets/finExport-aPHd2Ky8.js","./assets/88-fin-recon-DUvmussy.js","./assets/AssistantVoice-BL5rFvo8.js","./assets/plus-Biv4whoT.js","./assets/info-DlFBAOb6.js","./assets/NoDeviceNote-42ayD3V9.js","./assets/undo-2-DJM1Mwn9.js","./assets/DetailDrawer-Bs4cOAY1.js","./assets/97-postto-link-CTPuv0aO.js","./assets/98-link-record-BqlSLBKe.js","./assets/98-post-register-BjewzNvU.js","./assets/FiledCompare-C-mDoI_d.js","./assets/FileApi-DqByuZuQ.js","./assets/behind-BVybS1SA.js","./assets/Confirm-BW0WNZCg.js","./assets/PyBs-BDNhvhuJ.js","./assets/NoticeLine-V9E1bwtX.js","./assets/TallyCompanies-DbVtYhG4.js","./assets/GstApiCard-B1mpuSSi.js","./assets/VendorRecon-NQFVDnd4.js","./assets/SheetPanel-Bwg5nalQ.js","./assets/AutoPostSettings-CJMx8jgf.js","./assets/Tally-hFRfNir1.js","./assets/BankSettings-CQNoi84f.js","./assets/Parties-B_7-OE0J.js","./assets/GstApiAll-yGwynYE7.js","./assets/firmNeeds-Dt4OFvKi.js","./assets/NeedAction-mYNYEubJ.js","./assets/use-today-D3Tvqw3e.js","./assets/chevron-right-DgdjF5AS.js","./assets/check-C7llfnSj.js","./assets/LedgerBox-Ciap2rH0.js","./assets/Done-DZOEaXgG.js","./assets/55-einvoice-DEXMfLex.js","./assets/daily-cQekhJct.js","./assets/trash-CT11EoF4.js","./assets/LinkStatus-DYVFQ-Sb.js","./assets/Bank-CyzpUx9S.js","./assets/BankChecks-BWtqemkE.js","./assets/words-yUKYZEMD.js","./assets/Sales-BsiKgDkp.js","./assets/Post--3JK6lb3.js","./assets/Help-DgxQnmXK.js","./assets/Txn-Nb2fO0AZ.js","./assets/Compliance-DtJJ8oMh.js","./assets/AddClient-OwIL7fYu.js","./assets/Integrations-eCb4Ha1-.js","./assets/arrow-left-Bs4zcUAT.js","./assets/Meetings-CVZRZfnw.js","./assets/GateBanner-Ah4EukAB.js","./assets/DailyCheck-CuHjOJih.js","./assets/scroll-text-BNCVIiG9.js","./assets/MailForm-BJzTiVmj.js","./assets/Bank-BhGNIyQm.js","./assets/parts-Ck0dygGC.js","./assets/Tally-CeamlAMY.js","./assets/Due-ZDgJ5VDz.js","./assets/LedgerDrop-CDqCCq_N.js","./assets/TallyPop-B900Rl3f.js","./assets/HomeNeeds-DFVXxcSJ.js","./assets/DashTds-DZg5m0LV.js","./assets/CouponBox-qQFsrMQ7.js","./assets/TwoStep-CysX_fBV.js","./assets/authLink-B6o89Spe.js","./assets/ColFilterPop-wBRWu6o1.js","./assets/BillPdf-BE04Lg0_.js","./assets/calendar-BmA3YbZZ.js","./assets/gzUpload-CNjVdeir.js","./assets/AssistantUploads-DovTjuhB.js","./assets/AssistantEntries-DiD2CKag.js","./assets/asstEntries-CMkgI0nm.js","./assets/AssistantMis-DLaV8H-K.js","./assets/misdef-Bt2U1WUv.js","./assets/AssistantFs-BSTD5-cZ.js","./assets/asst-compare-DFm296CF.js","./assets/VoiceRecorder-UFw5ktib.js","./assets/Entry-DH2SXKIr.js","./assets/MyMis-DYP4zMPC.js","./assets/Corporate-M3qMz2yk.js","./assets/Payroll-ByemjV2M.js","./assets/payrollPost-CiqP3TwS.js","./assets/again-GkN01t78.js","./assets/tpparts-Dc2xoSm7.js","./assets/ITR-Ca6ZMk2-.js","./assets/FinComBooks-aNMfhJFG.js","./assets/Reports-BZhRi_6S.js","./assets/reportsExport-D8uqAapi.js","./assets/Depr-CmZ6stv9.js","./assets/tdsExcel-xUoHWi1r.js","./assets/r1Excel-JT_1J0vX.js","./assets/80-assets-j0JE5bMz.js","./assets/78-reports-DRzswCN4.js","./assets/Mail-YhyTx_l2.js","./assets/itcExcel-DrT0qiWS.js","./assets/AiMap-CrVCnyj2.js","./assets/dayBookDrop-DEH1NkTn.js","./assets/MisSchedule-B28x1x-R.js","./assets/misExport-mGqCLEj2.js","./assets/Aoc4-DocswItT.js","./assets/engine-1672717ec4.js"];
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
