// node run_sentry_scrub.mjs - the one Sentry scrubber (server/_shared/sentry-scrub.js), shared by the app and tally-ingest:
// the owner's conditions of 08-Oct-2026 (docs/sentry.md). Realistic events, breadcrumbs and stack frames carrying made-up
// GSTINs, PANs, amounts, names, narrations, bill numbers, Tally XML, emails, file names and ids in URLs
// (tests/fixtures/sentry-sensitive.json) go in; none may come out, and an event may carry only the allowed fields.
// A failure here fails CI (tests/ci/tests.txt).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, "..");
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "sentry-sensitive.json"), "utf8"));
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const leaks = (x) => { const s = typeof x === "string" ? x : JSON.stringify(x); return [...FX.strings, ...FX.tokens].filter((t) => s.includes(t)); };

// the fields an event may carry (docs/sentry.md, "What is sent"); anything else is a failure
const ALLOWED = {
  top: ["event_id", "timestamp", "platform", "level", "release", "environment", "exception", "message", "breadcrumbs", "tags", "user", "request", "contexts", "sdk"],
  exception: ["type", "value", "mechanism", "stacktrace"], mechanism: ["type", "handled"], frame: ["filename", "function", "module", "lineno", "colno", "in_app"],
  breadcrumb: ["type", "category", "level", "timestamp", "message", "data"], crumbData: ["from", "to"],
  tags: ["route", "install", "where", "kind", "guard", "firm", "mode"], user: ["id"], request: ["url", "headers"], headers: ["User-Agent"],
  contexts: ["os", "runtime", "browser"], context: ["name", "version"], sdk: ["name", "version", "settings"], settings: ["infer_ip"],
};
function shape(e) {
  const bad = [];
  const only = (o, keys, where) => { if (o && typeof o === "object") for (const k of Object.keys(o)) if (!keys.includes(k)) bad.push(where + "." + k); };
  only(e, ALLOWED.top, "event");
  for (const v of e.exception?.values || []) {
    only(v, ALLOWED.exception, "exception"); only(v.mechanism, ALLOWED.mechanism, "mechanism");
    only(v.stacktrace, ["frames"], "stacktrace");
    for (const f of v.stacktrace?.frames || []) only(f, ALLOWED.frame, "frame");
  }
  if (e.exception) only(e.exception, ["values"], "exception");
  for (const b of e.breadcrumbs || []) { only(b, ALLOWED.breadcrumb, "breadcrumb"); only(b.data, ALLOWED.crumbData, "breadcrumb.data"); }
  only(e.tags, ALLOWED.tags, "tags"); only(e.user, ALLOWED.user, "user");
  only(e.request, ALLOWED.request, "request"); only(e.request?.headers, ALLOWED.headers, "request.headers");
  only(e.contexts, ALLOWED.contexts, "contexts"); for (const c of Object.values(e.contexts || {})) only(c, ALLOWED.context, "context");
  only(e.sdk, ALLOWED.sdk, "sdk"); only(e.sdk?.settings, ALLOWED.settings, "sdk.settings");
  return bad;
}

const S = await import(path.join(ROOT, "server", "_shared", "sentry-scrub.js"));

// ---- 1. the words of an error: every made-up text, none of its business data left
for (const t of FX.texts) {
  const out = S.scrubText(t);
  ok(!leaks(out).length && out.length <= 300, "scrubText leaves no business data: " + JSON.stringify(out) + (leaks(out).length ? " LEAKS " + leaks(out) : ""));
}
// what is useful stays: the engine's own words and code names
ok(S.scrubText("Cannot read properties of undefined (reading 'vendorName')") === "Cannot read properties of undefined (reading 'vendorName')", "a JavaScript engine message is kept whole");
ok(S.scrubText("x.map is not a function") === "x.map is not a function", "'x.map is not a function' kept");
ok(S.scrubText("Failed to fetch") === "Failed to fetch", "'Failed to fetch' kept");
ok(/^Ledger … does not exist/.test(S.scrubText("Ledger 'Zeta Supplies Ltd' does not exist")), "a name in a message becomes …: " + S.scrubText("Ledger 'Zeta Supplies Ltd' does not exist"));
ok(S.scrubText("a".repeat(5000)).length <= 300 && S.scrubText(null) === "" && S.scrubText({ toString() { return "ALPHA TRADERS"; } }) === "…", "long text cut; null empty; an object's own text scrubbed");
ok(S.scrubType("TypeError") === "TypeError" && S.scrubType("ALPHA TRADERS") === "Error" && S.scrubType("Zeta Supplies Ltd") === "Error", "an error's type: an error class name, else 'Error'");
ok(S.scrubRoute("client/invoices") === "client/invoices" && S.scrubRoute("home/tally") === "home/tally" && S.scrubRoute("https://staging.fincom.live/review/?client=cmufksrrqjub2g") === "other" && S.scrubRoute("client/ALPHA TRADERS") === "other",
  "a route is a page's name or 'other'");
ok(S.scrubUrl("https://staging.fincom.live/review/?client=cmufksrrqjub2g#gstin=09AANFG3202D1ZR") === "https://staging.fincom.live/review/", "a page's address without its query and hash");
ok(S.scrubUrl("https://qbocskaiewaxqcvaunzc.supabase.co/rest/v1/tally_post_jobs/00000004-1111-4111-8111-000000000000/cmufksrrqjub2g") === "https://qbocskaiewaxqcvaunzc.supabase.co/rest/v1/tally_post_jobs/:id/:id", "ids in an address's path become :id");
ok(S.scrubUrl("mailto:priya.sharma@alphatraders.in") === "" && S.scrubUrl("https://priya:secret@x.example/a") === "https://x.example/a", "no email or user in an address");

// ---- 2. breadcrumbs: navigation (page names) and console errors (scrubbed) only
const T = 1760000000;
const crumbs = [
  { type: "http", category: "xhr", timestamp: T, data: { method: "GET", url: "https://qbocskaiewaxqcvaunzc.supabase.co/rest/v1/bills?id=eq.cmufksrrqjub2g", status_code: 200 } },
  { type: "http", category: "fetch", timestamp: T, data: { method: "POST", url: "https://x.supabase.co/functions/v1/tally-ingest?client=cmufksrrqjub2g", request_body_size: 10 } },
  { category: "ui.click", timestamp: T, message: "button.btn > span 'Post ALPHA TRADERS ₹1,25,000.00'" },
  { category: "ui.input", timestamp: T, message: "input[name=vendorPan] AAAPA1234A" },
  { category: "navigation", timestamp: T, data: { from: "/review/?client=cmufksrrqjub2g", to: "/review/#bill=AB/101" } },
  { category: "navigation", timestamp: T, data: { from: "home/clients", to: "client/invoices" } },
  { category: "console", level: "log", timestamp: T, message: "loaded ALPHA TRADERS", data: { arguments: ["loaded", { party: "ALPHA TRADERS" }] } },
  { category: "console", level: "warning", timestamp: T, message: "slow Zeta Supplies Ltd" },
  { category: "console", level: "error", timestamp: T, message: "[FinCom] the page could not be drawn: Error: Party ALPHA TRADERS owes ₹1,25,000.00", data: { arguments: ["[FinCom]", { gstin: "09AANFG3202D1ZR" }], logger: "console" } },
  { category: "sentry.event", timestamp: T, message: "ALPHA TRADERS", event_id: "x" },
  { type: "default", category: "custom", timestamp: T, message: "Priya Sharma opened Kappa Labs", data: { pan: "ABCPK7777Q" } },
];
const kept = crumbs.map((b) => S.scrubBreadcrumb(JSON.parse(JSON.stringify(b)))).filter(Boolean);
ok(kept.length === 2 && kept[0].category === "navigation" && kept[0].data.from === "home/clients" && kept[0].data.to === "client/invoices" && kept[1].category === "console" && kept[1].level === "error",
  "only a navigation between named pages and a console error are kept (" + JSON.stringify(kept) + ")");
ok(!leaks(kept).length, "no business data in the kept breadcrumbs" + (leaks(kept).length ? ": " + leaks(kept) : ""));
ok(kept[1].message.startsWith("[FinCom] the page could not be drawn:") && !("data" in kept[1]), "the console error's words, scrubbed, never its arguments: " + kept[1].message);

// ---- 3. a whole event as the browser SDK makes it, with everything the SDK or a scope could add
const frames = [
  { filename: "https://staging.fincom.live/review/legacy.js?v=0123456789ab", abs_path: "https://staging.fincom.live/review/legacy.js?v=0123456789ab#client=cmufksrrqjub2g", function: "postOne", lineno: 1201, colno: 17, in_app: true,
    pre_context: ["const party = 'ALPHA TRADERS';"], context_line: "throw new Error(party + ' 09AANFG3202D1ZR')", post_context: ["// 1,25,000.00"], vars: { party: "ALPHA TRADERS", amount: 125000, gstin: "09AANFG3202D1ZR" } },
  { filename: "C:\\Users\\priya\\Downloads\\Alpha_Traders_Invoice_AB-101.pdf", function: "ALPHA TRADERS", lineno: 1, colno: 1 },
  { filename: "file:///home/priya/fincom/app/src/screens/Bill.jsx", function: "Bill", lineno: 40, colno: 3, module: "/home/priya/fincom" },
];
const ev = {
  event_id: "0123456789abcdef0123456789abcdef", timestamp: T, platform: "javascript", level: "error", logger: "console",
  release: "fincom-app-abc1234", environment: "production", dist: "x", server_name: "PRIYA-LAPTOP", transaction: "/review/?client=cmufksrrqjub2g",
  message: "Party ALPHA TRADERS owes ₹1,25,000.00", logentry: { message: "Party %s", params: ["ALPHA TRADERS"], formatted: "Party ALPHA TRADERS" },
  exception: { values: [
    { type: "TypeError", value: FX.texts[0], mechanism: { type: "onerror", handled: false, data: { party: "ALPHA TRADERS" } }, stacktrace: { frames } },
    { type: "ALPHA TRADERS", value: FX.texts[3], module: "Kappa Labs", thread_id: 1, stacktrace: { frames: frames.slice(0, 1) } },
  ] },
  breadcrumbs: crumbs,
  tags: { route: "client/invoices", install: "0123456789abcdef0123456789abcdef", client: "ALPHA TRADERS", gstin: "09AANFG3202D1ZR", guard: "this screen", where: "Party ALPHA TRADERS", firm: "cmufksrrqjub2g" },
  extra: { party: "ALPHA TRADERS", narration: "being rent paid for september to landlord", xml: FX.texts[3] },
  user: { id: "0123456789abcdef0123456789abcdef", email: "priya.sharma@alphatraders.in", username: "Priya Sharma", ip_address: "{{auto}}", name: "Priya Sharma" },
  request: { url: "https://staging.fincom.live/review/?client=cmufksrrqjub2g#gstin=09AANFG3202D1ZR", query_string: "client=cmufksrrqjub2g", cookies: "sb=cmufksrrqjub2g", data: { pan: "AAAPA1234A" },
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", Referer: "https://staging.fincom.live/review/?client=cmufksrrqjub2g", Cookie: "sb=x" } },
  contexts: { os: { name: "Windows", version: "10" }, browser: { name: "Chrome", version: "140.0.0.0" }, state: { state: { value: { S: { party: "ALPHA TRADERS" } } } }, react: { componentStack: "at Bill (ALPHA TRADERS)" },
    trace: { trace_id: "x" }, culture: { locale: "en-IN", timezone: "Asia/Kolkata" } },
  fingerprint: ["ALPHA TRADERS"], modules: { "alpha-traders": "1.0" }, debug_meta: { images: [{ code_file: "C:\\Users\\priya\\x.js" }] },
  sdk: { name: "sentry.javascript.browser", version: "10.75.1", integrations: ["GlobalHandlers"], packages: [{ name: "npm:@sentry/browser", version: "10.75.1" }], settings: { infer_ip: "auto" } },
  spans: [{ description: "GET /bills?id=eq.cmufksrrqjub2g" }], measurements: { x: { value: 1 } }, threads: { values: [{ name: "Priya" }] },
  attachments: [{ filename: "Alpha_Traders_Invoice_AB-101.pdf" }],
};
const out = S.scrubEvent(JSON.parse(JSON.stringify(ev)));
ok(out && typeof out === "object", "an event comes out");
ok(!leaks(out).length, "no business data anywhere in the event" + (leaks(out).length ? ": " + leaks(out).join(", ") + " in " + JSON.stringify(out).slice(0, 1500) : ""));
const bad = shape(out);
ok(!bad.length, "only the allowed fields (" + (bad.join(", ") || "none other") + ")");
ok(out.environment === "staging", "environment is always 'staging' (" + out.environment + ")");
ok(out.tags.route === "client/invoices" && out.tags.install === "0123456789abcdef0123456789abcdef" && out.tags.guard === "this screen" && !("where" in out.tags) && !("firm" in out.tags) && !("client" in out.tags),
  "tags: the page's name, the install id and the guard kept; a tag with data in it dropped (" + JSON.stringify(out.tags) + ")");
ok(out.user && Object.keys(out.user).join() === "id" && out.user.id === "0123456789abcdef0123456789abcdef", "user: the random install id only");
ok(out.request.url === "https://staging.fincom.live/review/" && Object.keys(out.request.headers).join() === "User-Agent", "request: the page's address without query or hash, and the browser's User-Agent only");
ok(out.sdk.settings.infer_ip === "never", "the SDK tells Sentry never to infer the IP address");
const f0 = out.exception.values[0].stacktrace.frames;
ok(f0.length === 3 && f0[0].filename === "https://staging.fincom.live/review/legacy.js" && f0[0].function === "postOne" && f0[0].lineno === 1201 && f0[1].filename === "?" && f0[1].function === "?" && f0[2].filename === "screens/Bill.jsx" && !("module" in f0[2]),
  "stack frames: file (no query, no user's folders), function, line and column (" + JSON.stringify(f0.map((f) => [f.filename, f.function])) + ")");
ok(out.exception.values[1].type === "Error", "an exception type carrying data becomes 'Error'");
ok(out.breadcrumbs.length === 2, "breadcrumbs filtered inside the event too");
ok(S.scrubEvent({ ...ev, environment: "staging", release: "ALPHA TRADERS" }).release === undefined, "a release that is not a version is dropped");
ok(S.scrubEvent(null) === null && S.scrubEvent("x") === null, "nothing that is not an event goes out");
// replay, feedback, attachments: never an event of their own
ok(S.scrubEvent({ ...ev, type: "replay_event" }) === null && S.scrubEvent({ ...ev, type: "feedback" }) === null && S.scrubEvent({ ...ev, type: "transaction" }) === null, "a replay, feedback or transaction event is dropped");

// ---- 4. the same scrubber everywhere ("one module shared by everything")
const appSrc = fs.readFileSync(path.join(ROOT, "app", "src", "sentry.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(ROOT, "server", "_shared", "sentry.ts"), "utf8");
ok(/from "\.\.\/\.\.\/server\/_shared\/sentry-scrub\.js"/.test(appSrc) && /beforeSend: *\(?e/.test(appSrc) && /beforeBreadcrumb:/.test(appSrc), "the app's Sentry takes beforeSend and beforeBreadcrumb from the shared scrubber");
ok(/from "\.\/sentry-scrub\.js"/.test(cloudSrc) && /scrubEvent\(/.test(cloudSrc), "tally-ingest's reports go through the shared scrubber");
ok(/sendDefaultPii: false/.test(appSrc) && !/replayIntegration|feedbackIntegration|Replay|Feedback|captureFeedback|httpClientIntegration|contextLinesIntegration|extraErrorDataIntegration|captureConsoleIntegration/.test(appSrc) && /defaultIntegrations: false/.test(appSrc),
  "app: sendDefaultPii false; no replay, feedback, HTTP-client or extra-data integration; no default integrations");
// reliability item 2: the speed of real use (Web Vitals) on a sample of page opens; no request is traced or carries a header
const rate = (appSrc.match(/PERF_SAMPLE_RATE = ([0-9.]+)/) || [])[1];
ok(rate && +rate >= 0.1 && +rate <= 0.2 && /tracesSampleRate:/.test(appSrc), "app: page speed sampled at 10-20% of page opens (" + rate + ")");
ok(/browserTracingIntegration\(\{[^}]*traceFetch: false/.test(appSrc) && /traceXHR: false/.test(appSrc) && /tracePropagationTargets: \[\]/.test(appSrc) && /enableInp: true/.test(appSrc),
  "app: page-load speed and INP only; no fetch/XHR spans, no trace headers on any request");
ok(/beforeSendTransaction: *\(?t/.test(appSrc) && /scrubTransaction\(/.test(appSrc) && /beforeSendSpan: *\(?s/.test(appSrc) && /scrubSpan\(/.test(appSrc), "app: every speed sample goes through the shared scrubber (scrubTransaction, scrubSpan)");
ok(/xhr: false/.test(appSrc) && /fetch: false/.test(appSrc) && /dom: false/.test(appSrc) && /history: false/.test(appSrc), "app: no XHR/fetch/click/history breadcrumbs");


// ---- 5. speed samples (reliability item 2): a page load's transaction and an interaction's INP span, rebuilt from the
// allowed fields only: Web Vitals as numbers, the release, the page's name; never an address with ids, a span's words,
// an element's text or label, a resource's address
const TX_ALLOWED = ["type", "event_id", "timestamp", "start_timestamp", "platform", "release", "environment", "transaction", "transaction_info", "contexts", "measurements", "spans", "tags", "user", "request", "sdk"];
const tx = {
  type: "transaction", event_id: "0123456789abcdef0123456789abcdef", timestamp: T + 3, start_timestamp: T, platform: "javascript", release: "fincom-app-abc1234", environment: "production",
  transaction: "/review/?client=cmufksrrqjub2g", transaction_info: { source: "url" }, server_name: "PRIYA-LAPTOP",
  contexts: { trace: { trace_id: "0123456789abcdef0123456789abcdef", span_id: "0123456789abcdef", op: "pageload", origin: "auto.pageload.browser", status: "ok",
    data: { "url.full": "https://staging.fincom.live/review/?client=cmufksrrqjub2g#gstin=09AANFG3202D1ZR", "lcp.element": "div.party > b.ALPHA TRADERS", "lcp.url": "https://x/Alpha_Traders_Invoice_AB-101.pdf", "cls.source.1": "td[title='Zeta Supplies Ltd']" } },
    browser: { name: "Chrome", version: "140.0.0.0" }, culture: { locale: "en-IN" }, state: { party: "ALPHA TRADERS" } },
  measurements: { lcp: { value: 1834.2, unit: "millisecond" }, fcp: { value: 900, unit: "millisecond" }, cls: { value: 0.02, unit: "" }, ttfb: { value: 120.5, unit: "millisecond" },
    "ttfb.requestTime": { value: 80, unit: "millisecond" }, inp: { value: 96, unit: "millisecond" }, "ALPHA TRADERS": { value: 1 }, "mark.cmufksrrqjub2g": { value: 2 }, fp: { value: "1,25,000.00" } },
  spans: [{ description: "GET https://qbocskaiewaxqcvaunzc.supabase.co/rest/v1/bills?gstin=eq.09AANFG3202D1ZR", op: "http.client" }, { description: "https://staging.fincom.live/review/assets/index.js", op: "resource.script" }],
  tags: { route: "client/invoices", client: "ALPHA TRADERS" }, user: { id: "0123456789abcdef0123456789abcdef", email: "priya.sharma@alphatraders.in" },
  request: { url: "https://staging.fincom.live/review/?client=cmufksrrqjub2g", headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0", Referer: "https://staging.fincom.live/review/?client=cmufksrrqjub2g" } },
  sdk: { name: "sentry.javascript.browser", version: "10.75.1" }, extra: { party: "ALPHA TRADERS" }, breadcrumbs: [{ message: "ALPHA TRADERS" }],
};
const tout = S.scrubTransaction(JSON.parse(JSON.stringify(tx)));
ok(tout && tout.type === "transaction", "a page load's speed sample comes out");
ok(!leaks(tout).length && !/cmufksrrqjub2g|supabase|Alpha_Traders|\?|#/.test(JSON.stringify(tout.contexts) + tout.transaction + JSON.stringify(tout.request || {})), "no business data, no address with ids, in a speed sample" + (leaks(tout).length ? ": " + leaks(tout) : ""));
ok(Object.keys(tout).every((k) => TX_ALLOWED.includes(k)), "only the allowed fields in a speed sample (" + Object.keys(tout).filter((k) => !TX_ALLOWED.includes(k)) + ")");
ok(tout.transaction === "fincom-app" && tout.environment === "staging" && tout.release === "fincom-app-abc1234", "named fincom-app, environment staging, tagged with the release");
ok(JSON.stringify(Object.keys(tout.measurements).sort()) === JSON.stringify(["cls", "fcp", "inp", "lcp", "ttfb", "ttfb.requestTime"]) && tout.measurements.lcp.value === 1834.2 && tout.measurements.lcp.unit === "millisecond" && tout.measurements.cls.value === 0.02,
  "Web Vitals kept as numbers (LCP, FCP, CLS, TTFB, INP); other measurements dropped (" + Object.keys(tout.measurements) + ")");
ok(Array.isArray(tout.spans) && tout.spans.length === 0, "no span of a page load is sent (requests, scripts, marks: addresses and words)");
ok(JSON.stringify(Object.keys(tout.contexts.trace).sort()) === JSON.stringify(["op", "origin", "span_id", "status", "trace_id"]) && tout.contexts.trace.op === "pageload", "the trace context: ids and op only, none of its data");
ok(tout.tags.route === "client/invoices" && !("client" in tout.tags) && JSON.stringify(tout.user) === '{"id":"0123456789abcdef0123456789abcdef"}', "tags: the page's name; user: the install id only");
ok(S.scrubTransaction({ ...tx, type: "event" }) === null && S.scrubTransaction(null) === null && S.scrubTransaction({ ...tx, contexts: {} }) === null, "only a transaction with its trace context comes out");
const sp = {
  span_id: "0123456789abcdef", trace_id: "0123456789abcdef0123456789abcdef", parent_span_id: "fedcba9876543210", segment_id: "0123456789abcdef", is_segment: true,
  start_timestamp: T, timestamp: T + 0.2, op: "ui.interaction.click", origin: "auto.http.browser.inp", status: "ok", exclusive_time: 96,
  description: "body > div#app > button.btn[aria-label=\"Post ALPHA TRADERS ₹1,25,000.00\"]", profile_id: "x",
  data: { "sentry.op": "ui.interaction.click", "sentry.origin": "auto.http.browser.inp", "sentry.exclusive_time": 96, release: "fincom-app-abc1234", environment: "production", transaction: "/review/?client=cmufksrrqjub2g",
    user: "priya.sharma@alphatraders.in", "user_agent.original": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0", "client.address": "{{auto}}", replay_id: "abc", "url.full": "https://staging.fincom.live/review/?client=cmufksrrqjub2g",
    "sentry.pageload.span_id": "0123456789abcdef", "lcp.element": "ALPHA TRADERS" },
  measurements: { inp: { value: 96, unit: "millisecond" }, "ALPHA TRADERS": { value: 1 } },
};
const sout = S.scrubSpan(JSON.parse(JSON.stringify(sp)));
ok(sout && sout.span_id === sp.span_id && sout.trace_id === sp.trace_id && sout.op === "ui.interaction.click", "an interaction's INP span comes out, its ids and op kept");
ok(!leaks(sout).length && !/cmufksrrqjub2g|button|aria|priya|\{\{auto\}\}/.test(JSON.stringify(sout)), "no business data, element, label, address or email in an INP span" + (leaks(sout).length ? ": " + leaks(sout) : "") + " " + JSON.stringify(sout).slice(0, 600));
ok(sout.description === "interaction" && sout.data.transaction === "fincom-app" && sout.data.environment === "staging" && sout.data.release === "fincom-app-abc1234" && !("user" in sout.data),
  "described as 'interaction' on fincom-app, environment staging, with the release");
ok(sout.measurements && sout.measurements.inp && sout.measurements.inp.value === 96 && Object.keys(sout.measurements).join() === "inp", "INP kept as a number; other measurements dropped");
ok(S.scrubSpan({ ...sp, op: "http.client" }).description === "interaction" && S.scrubSpan({ ...sp, op: "GET ALPHA TRADERS" }).op === "other", "a span's op only from its known shape");
ok(S.scrubSpan(null) && typeof S.scrubSpan(null) === "object", "scrubSpan always returns an object (Sentry keeps the raw span when it gets none)");

console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
