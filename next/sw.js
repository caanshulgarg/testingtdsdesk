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
const VERSION = "mwunekcu-e64aa3";
// round 73 B: FILES, kept at install, are what the first page needs; REST, the other files of this build, are kept once
// the first page is up and the computer is idle (the page sends "fincom:keep-rest", main.jsx)
const FILES = ["./","./legacy.js?v=db38ad15ed46","./guard.js","./oldcheck.js","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/geist-latin-wght-normal-BgDaEnEv.woff2","./assets/index-DUzmTpjw.css","./assets/index-B5lCbXh6.js"];
const REST = ["./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","./assets/Books-B1phg4vK.css","./assets/Gst-BmwLksAm.css","./assets/PreFile-BA4KCfgm.css","./assets/Settings-D06NQ7oZ.css","./assets/CommitBox-CTR7p3G0.css","./assets/DetailDrawer-BbJA1sRZ.css","./assets/newlook-DLg3nk8r.css","./assets/returns-CtH_iqK_.css","./assets/NoticeLine-CtNx_YJY.css","./assets/TallyCompanies-CgPljf3Y.css","./assets/Tally-C-zXi6Bw.css","./assets/daily-Brfl8Cid.css","./assets/LinkStatus-IvmP9XTX.css","./assets/Bank-D3TAlzx2.css","./assets/Integrations-C1RPLvE9.css","./assets/calendar-BYhs-OP_.css","./assets/AssistantEntries-BiMrQpZd.css","./assets/MyMis-CEycmWma.css","./assets/Corporate-B-2qbAGV.css","./assets/Payroll-BO4BpaIP.css","./assets/ITR-BOgw_-aQ.css","./assets/FinComBooks-CnqgcSM1.css","./assets/Reports-Dci7HM2A.css","./assets/Depr-CRK3iz9Y.css","./assets/AiMap-B8Xrao83.css","./assets/firstOpen-B-pyfd2U.js","./assets/splitBooks-B5uyniwB.js","./assets/tallyJson-B5JyoQQQ.js","./assets/bridgeFollow-B6YoU2xm.js","./assets/registers-C_hYg6h_.js","./assets/01-reading-bills-CqbM0gV-.js","./assets/timings-BR_dDCAp.js","./assets/sentry-DWulhiYA.js","./assets/Assistant-DoU-9bm5.js","./assets/Announce-DNSsSwqu.js","./assets/FirmSetup-Btyr4jwm.js","./assets/Shell-CF8DS0Qk.js","./assets/prefetchBuild-BSlFRzgD.js","./assets/MeetCard-IQllkarT.js","./assets/knock-B9T1wQOw.js","./assets/realtime-DUYArwig.js","./assets/api-Bg8s4KSN.js","./assets/autopost-eM-wu9l5.js","./assets/yourData-lGRWSH4F.js","./assets/Books-CoVVav-e.js","./assets/18-mis-pack-DROquQRN.js","./assets/chevron-down-BJ8gGKPe.js","./assets/Gst-Chnqe9I-.js","./assets/gstr1Fix-B6bzkpBu.js","./assets/Annual-DHpJyFMF.js","./assets/download-p5MFlwr9.js","./assets/PreFile-D1QMctKn.js","./assets/Settings-CQHLEeOn.js","./assets/LogoPick-x2-44Sr2.js","./assets/AdvOptIn-DEaNh4Fu.js","./assets/bankOverlap-B_cfJyDw.js","./assets/tallyConnect-Dy5h2yij.js","./assets/99-screen-parts-BXsTEX_D.js","./assets/ownBridge-DhJHSnvM.js","./assets/tallyPort-CwxMEAN9.js","./assets/CommitBox-B3YfJQyX.js","./assets/59-post-owner-Bsx0zbsN.js","./assets/26-sales-invoice-Coyj5c0U.js","./assets/42-vendor-recon-aF6FaMEC.js","./assets/finExport-aPHd2Ky8.js","./assets/88-fin-recon-DUvmussy.js","./assets/AssistantVoice-DDtwyxow.js","./assets/plus-D0gvAmPs.js","./assets/info-K1PIbhZN.js","./assets/NoDeviceNote-Ym3eukvf.js","./assets/undo-2-DrvY-MAW.js","./assets/DetailDrawer-B00gOBwk.js","./assets/97-postto-link-CTPuv0aO.js","./assets/98-link-record-BqlSLBKe.js","./assets/98-post-register-BjewzNvU.js","./assets/FiledCompare-CdM4qvTB.js","./assets/FileApi-8ysR6qmS.js","./assets/behind-Dy7utaEH.js","./assets/Confirm-CZpxVEtH.js","./assets/PyBs-DzidKSfW.js","./assets/NoticeLine-CxfHGSc_.js","./assets/TallyCompanies-BQ_1ltO-.js","./assets/GstApiCard-Cny8c4Nq.js","./assets/VendorRecon-x1yt8c6f.js","./assets/SheetPanel-acrGHnNM.js","./assets/AutoPostSettings-DXnE0O0M.js","./assets/Tally-DZnHf0_F.js","./assets/BankSettings-QntE2O7R.js","./assets/Parties-B3tTdLVI.js","./assets/GstApiAll-CIpQ7B4U.js","./assets/firmNeeds-IgmtcAi8.js","./assets/NeedAction-CKL2c0Gw.js","./assets/use-today-CzUHmJfR.js","./assets/chevron-right-BWBCH3GK.js","./assets/check-CNLdh2k8.js","./assets/LedgerBox-BQiuetxa.js","./assets/Done-BAx7g4-K.js","./assets/55-einvoice-DEXMfLex.js","./assets/daily-BoOC51ja.js","./assets/trash-XREQuuqT.js","./assets/LinkStatus-BQ6vvYvb.js","./assets/Bank-ffZHx_F2.js","./assets/BankChecks-C71ST_Ly.js","./assets/words-yUKYZEMD.js","./assets/Sales-k4yMDua2.js","./assets/Post-dOrazP6X.js","./assets/Help-D7TD558f.js","./assets/Txn-CNLOWG71.js","./assets/Compliance-DNaWqKIy.js","./assets/AddClient-r5UUZmEA.js","./assets/Integrations-DAT7ajSi.js","./assets/arrow-left-BaWqUB72.js","./assets/Meetings-Bn1uc29p.js","./assets/GateBanner-DgSm0Z4p.js","./assets/DailyCheck-BLu8_42c.js","./assets/scroll-text-Ducxnel5.js","./assets/MailForm-DtLjCBsv.js","./assets/Bank-V0j9dKHN.js","./assets/parts-CEcxz3ct.js","./assets/Tally-Bneqhd65.js","./assets/Due-DBMpjdAi.js","./assets/LedgerDrop-DM3sfGFq.js","./assets/TallyPop-Dc7pASPz.js","./assets/HomeNeeds-S77GhSjY.js","./assets/DashTds-BkLjrBFU.js","./assets/CouponBox-lOCtxuKz.js","./assets/TwoStep-DDE-WfWF.js","./assets/authLink-Dd8BFuc-.js","./assets/ColFilterPop-BikF9eP6.js","./assets/BillPdf-CUFF_ycD.js","./assets/calendar-BMrO_3fU.js","./assets/gzUpload-CNjVdeir.js","./assets/AssistantUploads-BLeEysZ3.js","./assets/AssistantEntries-0JuvjJmI.js","./assets/asstEntries-DiR9hcsH.js","./assets/AssistantMis-DWyG1FT_.js","./assets/misdef-Bt2U1WUv.js","./assets/AssistantFs-Cb1NJ174.js","./assets/asst-compare-DFm296CF.js","./assets/VoiceRecorder-BqdaPghD.js","./assets/Entry-B7767qhY.js","./assets/MyMis-JR0--hJy.js","./assets/Corporate-B3AaA7uz.js","./assets/Payroll-CvOLh7A0.js","./assets/payrollPost-BmOaIvjU.js","./assets/again-BefqNvZN.js","./assets/tpparts-Dc2xoSm7.js","./assets/ITR-DQop_wq4.js","./assets/FinComBooks-DwrFdHHd.js","./assets/Reports-wdQXdNzX.js","./assets/reportsExport-D8uqAapi.js","./assets/Depr-BdgDCE9n.js","./assets/tdsExcel-xUoHWi1r.js","./assets/r1Excel-JT_1J0vX.js","./assets/80-assets-j0JE5bMz.js","./assets/78-reports-DRzswCN4.js","./assets/Mail-DNhWjRkP.js","./assets/itcExcel-DrT0qiWS.js","./assets/AiMap-C2p4mdeV.js","./assets/dayBookDrop-DEH1NkTn.js","./assets/MisSchedule-SGZvo5w_.js","./assets/misExport-DpLPW9IT.js","./assets/Aoc4-fzS6HqSZ.js","./assets/engine-1672717ec4.js"];
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
