// The one Sentry scrubber: every event and breadcrumb FinCom sends to Sentry goes through it (the app's beforeSend and
// beforeBreadcrumb, app/src/sentry.js; tally-ingest's reports, server/_shared/sentry.ts). The bridge (Go) has the same rules
// in bridge-go/crash.go. Plain JavaScript with no imports, so the app's build, Deno and Node's tests load it unchanged.
//
// The owner's conditions (08-Oct-2026, docs/sentry.md): no business data leaves. An ALLOW-LIST: an event is rebuilt from
// the few fields known to be safe, and every text in it is cut down to words known to be safe:
//   - the error's type (an error class name, else "Error") and its message, scrubbed (scrubText);
//   - the stack trace: each frame's file (no query, hash or user folder), function, line and column;
//   - release, environment (always "staging"), platform, level, time, event id;
//   - tags: the page's NAME (route, never its parameters), a random per-install id, and a few fixed code names;
//   - the browser (User-Agent) or the runtime / OS name and version;
//   - breadcrumbs: navigation between named pages, and console errors (scrubbed) only.
// Everything else (extra, other contexts, request bodies, query strings, cookies, user email / name / IP, fingerprints,
// modules, attachments, replays, feedback, spans) is dropped.

export const SENTRY_ENVIRONMENT = "staging";

// ---- the words of an error. Each word is kept only when it is a known word of error messages, a short number, a known
// acronym or product name, an error class name, or a code name (camelCase, snake_case, a.b.c). Anything else - names,
// GSTINs, PANs, amounts, bill numbers, emails, addresses, ids, file names, Tally XML - becomes "…".
const WORDS = new Set((
  "a an the of to in on at by for from with without into onto as is are was were be been being not no nor and or but if " +
  "then else than this that these those it its it's can cannot can't could couldn't would should must may might will won't " +
  "do does did done don't doesn't didn't has have had having get got set unset new old same other another any all each every " +
  "some none only also just still yet again already more less most least too very there here when where which what who why how " +
  "read reading write writing call called calling load loaded loading parse parsing open opened close closed send sent sending " +
  "receive received fetch fetched fetching request requested response responded reply answer answered find found " +
  "undefined null nan true false infinity object objects array arrays string strings number numbers function functions " +
  "property properties method methods value values key keys type types index item items element elements node nodes " +
  "argument arguments parameter parameters variable variables constructor prototype instance class module modules " +
  "token tokens character characters input output end start position line lines column columns field fields " +
  "length size count limit maximum minimum max min range offset depth stack frame frames level levels " +
  "error errors exception exceptions failed failure fail fails failing invalid valid unexpected expected unknown missing " +
  "unable allowed permitted denied refused rejected blocked aborted abort aborts timeout timed out exceeded overflow " +
  "network connection connect connected disconnected reset refused unreachable offline online server client browser " +
  "permission permissions access unauthorized forbidden authentication authenticated session expired " +
  "defined declared initialized initialised assign assigned assignment constant reference iterable callable " +
  "syntax json html xml http https url uri script scripts resource resources chunk chunks dynamically imported import " +
  "export exports default promise promises async await rejection unhandled handled uncaught caught throw thrown " +
  "quota storage database table tables column row rows relation constraint violates violated duplicate unique primary " +
  "schema cache query queries rpc exist exists does doesn't support supported unsupported operation operations " +
  "memory internal external panic runtime nil pointer dereference slice bounds out channel closed goroutine goroutines deadlock " +
  "map maps concurrent iteration conversion interface converted division zero integer divide address addresses capacity " +
  "asleep writes reads signal segmentation violation fault " +
  "page pages screen screens part drawn draw render rendering shown show component components hook hooks " +
  "bill bills ledger ledgers bank statement statements entry entries voucher vouchers posting postings post posted " +
  "company companies party parties upload uploads uploaded file files document documents report reports book books " +
  "sync line queue queued job jobs bridge cloud computer device beat heartbeat recorder lease guard state step " +
  "day days month months year years period list lists name names id ids number amount amounts date dates tax " +
  "please try retry later now again ok yes because while during after before since until via per"
).split(/\s+/));
// written in capitals: acronyms and product names, kept as written
const NAMES = new Set(["JSON", "HTML", "XML", "HTTP", "HTTPS", "URL", "URI", "API", "DOM", "CSS", "SQL", "RPC", "JWT", "UUID", "ID", "OK", "NaN",
  "CORS", "TLS", "SSL", "TCP", "DNS", "GST", "TDS", "PDF", "CSV", "IST", "UTF", "EOF", "IO", "OS", "PGRST", "TypeScript", "JavaScript",
  "FinCom", "Tally", "TallyPrime", "React", "Supabase", "Deno", "Chrome", "Firefox", "Safari", "Edge", "Windows", "Linux", "Go",
  "Sentry", "Postgres", "PostgreSQL", "WebSocket", "Promise", "Object", "Array", "String", "Number", "Function", "Symbol", "Date",
  "Map", "Set", "Response", "Request", "Headers", "Blob", "File", "Storage", "Worker", "Element", "Node", "Document", "Window"]);
const ERROR_CLASS = /^[A-Z][A-Za-z]{0,40}(Error|Exception)$/;
// a code name (release-240 review M3: only code identifiers, never a file or a firm's name written in lower case):
// camelCase (vendorName), a call (render(), x.map()), or a dotted name with a capital after the first part (pkg.Func,
// Books.lines); never snake_case, never all lower-case dotted words (mehta.textiles.pvt), never a file name (acme_corp.pdf);
// at most two digits, never three capitals running
const CODE = /^[a-z$][A-Za-z0-9$]*(\.[A-Za-z$][A-Za-z0-9$]*)*(\(\))?$/;
// a lower-case a.b only when b is a well-known method or property ("x.map is not a function")
const METHODS = new Set("map filter forEach reduce find findIndex some every push pop shift slice splice concat join split trim replace includes indexOf length keys values entries then catch finally json text call apply bind toString toFixed get set has add delete clear close open send read write".split(" "));
const FILE_EXT = new Set("pdf xls xlsx xlsm csv tsv xml json txt doc docx zip rar png jpg jpeg gif webp heic tif tiff bmp htm html eml msg ods odt pptx ppt".split(" "));
const codeName = (w) => {
  if (w.length > 60 || !CODE.test(w) || (w.match(/\d/g) || []).length > 2 || /[A-Z]{3}/.test(w)) return false;
  const call = w.endsWith("()"), parts = (call ? w.slice(0, -2) : w).split(".");
  if (FILE_EXT.has(parts[parts.length - 1].toLowerCase())) return false;
  if (parts.length === 1) return call || /[A-Z]/.test(parts[0]);
  return call || parts.some((p) => /[A-Z]/.test(p)) || (parts.length === 2 && METHODS.has(parts[1]));
};
function safeWord(w) {
  if (/^\d{1,2}$/.test(w)) return true;
  if (WORDS.has(w)) return true;
  if (/^[A-Z][a-z']+$/.test(w) && WORDS.has(w.toLowerCase())) return true;   // the first word of a sentence
  if (NAMES.has(w)) return true;
  if (ERROR_CLASS.test(w)) return true;
  return codeName(w);
}
const LEAD = /^[(\[{'"“‘`<]+/, TRAIL = /[)\]}'"”’`>:;,.!?]+$/;
// the text of an error, scrubbed. Never longer than max characters
export function scrubText(s, max = 300) {
  if (s == null) return "";
  let t;
  try { t = typeof s === "string" ? s : String(s); } catch { return "…"; }
  t = t.slice(0, 4000);
  // Tally's XML, or any markup: never its content
  t = t.replace(/<[^>]{0,400}>/g, " … ");
  const out = t.split(/\s+/).filter(Boolean).map((tok) => {
    const lead = (tok.match(LEAD) || [""])[0];
    const rest = tok.slice(lead.length);
    const trail = (rest.match(TRAIL) || [""])[0];
    const core = rest.slice(0, rest.length - trail.length);
    if (!core) return /^[(\[{)\]}:;,.!?'"“”‘’`-]+$/.test(tok) ? tok : "…";
    // quotes and brackets around a kept word stay; a dropped word drops them too
    return safeWord(core) ? lead + core + trail : "…" + (/^[:;,.]+$/.test(trail) ? trail : "");
  }).join(" ");
  // runs of dropped words become one
  const joined = out.replace(/…[:;,.]?(?:\s+…[:;,.]?)+/g, "…").replace(/\s+/g, " ").trim();
  return joined.length > max ? joined.slice(0, max - 1) + "…" : joined;
}

// an error's type: an error class name, else "Error"
export function scrubType(t) { return typeof t === "string" && ERROR_CLASS.test(t) ? t : (t === "Error" ? "Error" : "Error"); }

// a page's NAME (never its parameters): view/tab, words of code only; anything else "other"
const ROUTE = /^[a-z][A-Za-z0-9]{0,30}(\/[a-z][A-Za-z0-9]{0,30}){0,2}$/;
export function scrubRoute(r) { return typeof r === "string" && ROUTE.test(r) && !/[A-Z]{3}/.test(r) ? r : "other"; }

// an id in a path: long, or mixing letters and digits (a uuid, a client id), or a GSTIN / PAN
const looksId = (seg) => seg.length > 24 || /^[0-9a-f-]{16,}$/i.test(seg) || (/\d/.test(seg) && /[a-z]/i.test(seg) && seg.length >= 8 && !/\.(js|mjs|jsx|ts|tsx|go|css|json|html|map)$/.test(seg)) ||
  /^\d{3,}$/.test(seg) || !/^[A-Za-z0-9._-]+$/.test(seg);
// an address: scheme, host and path; no user, password, query or hash; ids in the path become ":id". Only http(s)
export function scrubUrl(u) {
  if (typeof u !== "string") return "";
  let x;
  try { x = new URL(u); } catch { return ""; }
  if (x.protocol !== "http:" && x.protocol !== "https:") return "";
  const path = x.pathname.split("/").map((seg) => (seg === "" ? "" : looksId(decodeURIComponentSafe(seg)) ? ":id" : seg)).join("/");
  return x.protocol + "//" + x.host + path;
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

// a stack frame's file: a script's address (scrubUrl), or the last two parts of a code file's path (never the folders,
// which may carry a Windows user's name); anything else "?"
const CODE_FILE = /\.(js|mjs|cjs|jsx|ts|tsx|go)$/;
function scrubFile(f) {
  if (typeof f !== "string" || !f) return "?";
  if (f === "<anonymous>" || f === "native" || f === "[native code]") return f;
  if (/^https?:\/\//.test(f)) { const u = scrubUrl(f); return u && (CODE_FILE.test(u) || u.endsWith("/")) ? u : "?"; }
  const parts = f.replace(/^file:\/\//, "").split(/[\\/]+/).filter(Boolean);
  const last = parts.slice(-2).filter((p) => /^[A-Za-z0-9._-]{1,80}$/.test(p) && !looksId(p) || CODE_FILE.test(p));
  const name = parts[parts.length - 1] || "";
  if (!CODE_FILE.test(name) || !/^[A-Za-z0-9._-]{1,80}$/.test(name)) return "?";
  return (last.length === 2 && !/^(users|home|documents and settings)$/i.test(last[0]) ? last[0] + "/" : "") + name;
}
// a function's name: "async " / "new " and dotted parts, each a code name, a known word or name, a class or component
// name with two capitals or more (PostStep, DocqPanel), or a minified name (at most 3 characters)
const FUNC = /^(?:(?:async|new) )?([A-Za-z_$][\w$]*(?:\.(?:<anonymous>|<computed>|[A-Za-z_$][\w$]*))*)(?: \[as ([A-Za-z_$][\w$]*)\])?$/;
const funcPart = (p) => p === "<anonymous>" || p === "<computed>" || p.length <= 3 || safeWord(p) || (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(p) && p.length <= 40);
function scrubFunc(fn) {
  const m = typeof fn === "string" && fn.length <= 80 ? fn.match(FUNC) : null;
  return m && m[1].split(".").every(funcPart) && (!m[2] || funcPart(m[2])) ? fn : "?";
}
export function scrubFrame(f) {
  if (!f || typeof f !== "object") return null;
  const o = { filename: scrubFile(f.filename || f.abs_path), function: scrubFunc(f.function) };
  // a Go package path (fincom/bridge, github.com/getsentry/sentry-go): never a folder on a disk
  if (typeof f.module === "string" && /^[a-z][a-z0-9._-]*(\/[A-Za-z0-9._-]+){0,4}$/.test(f.module) && f.module.length <= 80) o.module = f.module;
  if (Number.isInteger(f.lineno) && f.lineno >= 0) o.lineno = f.lineno;
  if (Number.isInteger(f.colno) && f.colno >= 0) o.colno = f.colno;
  if (typeof f.in_app === "boolean") o.in_app = f.in_app;
  return o;
}

// ---- breadcrumbs: navigation between named pages, and console errors (their words scrubbed, never their arguments)
export function scrubBreadcrumb(b) {
  if (!b || typeof b !== "object") return null;
  const ts = typeof b.timestamp === "number" ? b.timestamp : undefined;
  if (b.category === "navigation") {
    const d = b.data || {}, from = scrubRoute(d.from), to = scrubRoute(d.to);
    if (to === "other") return null;
    return { type: "navigation", category: "navigation", timestamp: ts, data: { from, to } };
  }
  if (b.category === "console" && b.level === "error") return { type: "default", category: "console", level: "error", timestamp: ts, message: scrubText(b.message, 200) };
  return null;
}

// ---- tags: these keys only, each with its own shape
const TAGS = {
  route: (v) => (scrubRoute(v) === v ? v : undefined),
  install: (v) => (/^[0-9a-f]{32}$/.test(v) ? v : undefined),       // the random per-install id
  firm: (v) => (/^[0-9a-f]{12}$/.test(v) ? v : undefined),          // a hash of the firm's id, never the id
  kind: (v) => (/^[a-z][a-z_]{0,30}$/.test(v) ? v : undefined),     // tally-ingest's request kind (beat, posts_update, ...)
  // a fixed place in the code: a snake_case name (light_check, tally_ingest: set by the code, never data; release-240 M3
  // keeps snake_case out of free text only), or words the scrubber keeps
  where: (v) => (/^[a-z]+(?:_[a-z]+){0,3}$/.test(v) || (/^[a-z][a-z0-9_ .:-]{0,60}$/.test(v) && scrubText(v) === v) ? v : undefined),
  guard: (v) => (/^[A-Za-z][A-Za-z0-9 ']{0,40}$/.test(v) && (scrubText(v) === v || (/^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(v) && !/[A-Z]{3}/.test(v))) ? v : undefined),   // a part of the page
  mode: (v) => (/^[a-z]{1,12}$/.test(v) ? v : undefined),
};
const CONTEXT_VALUE = /^[A-Za-z0-9 ._()+\/-]{1,80}$/;
const LEVELS = ["fatal", "error", "warning", "info", "debug"], PLATFORMS = ["javascript", "node", "go", "other"];
const RELEASE = /^[a-z][a-z-]{1,30}-[A-Za-z0-9._+-]{1,40}$/;

// an event, rebuilt from the allowed fields only; null when it is not an error event (a replay, feedback, transaction...)
export function scrubEvent(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  if (e.type && e.type !== "event" && e.type !== "error") return null;
  const o = {};
  if (typeof e.event_id === "string" && /^[0-9a-f]{32}$/.test(e.event_id)) o.event_id = e.event_id;
  if (typeof e.timestamp === "number") o.timestamp = e.timestamp;
  o.platform = PLATFORMS.includes(e.platform) ? e.platform : "other";
  o.level = LEVELS.includes(e.level) ? e.level : "error";
  if (typeof e.release === "string" && RELEASE.test(e.release)) o.release = e.release;
  o.environment = SENTRY_ENVIRONMENT;
  const vals = (e.exception && Array.isArray(e.exception.values) ? e.exception.values : []).slice(-5).map((v) => {
    const x = { type: scrubType(v && v.type), value: scrubText(v && v.value) };
    if (v && v.mechanism && typeof v.mechanism === "object") x.mechanism = { type: /^[a-z][a-zA-Z0-9_.]{0,40}$/.test(v.mechanism.type) ? v.mechanism.type : "generic", handled: v.mechanism.handled !== false };
    const fr = v && v.stacktrace && Array.isArray(v.stacktrace.frames) ? v.stacktrace.frames.slice(-50).map(scrubFrame).filter(Boolean) : [];
    if (fr.length) x.stacktrace = { frames: fr };
    return x;
  });
  if (vals.length) o.exception = { values: vals };
  const msg = typeof e.message === "string" ? e.message : e.message && typeof e.message === "object" ? e.message.formatted || e.message.message : e.logentry && (e.logentry.formatted || e.logentry.message);
  if (msg) o.message = scrubText(msg);
  const crumbs = (Array.isArray(e.breadcrumbs) ? e.breadcrumbs : e.breadcrumbs && Array.isArray(e.breadcrumbs.values) ? e.breadcrumbs.values : []).map(scrubBreadcrumb).filter(Boolean).slice(-30);
  if (crumbs.length) o.breadcrumbs = crumbs;
  const tags = {};
  for (const [k, ok] of Object.entries(TAGS)) { const v = e.tags && e.tags[k]; if (typeof v === "string") { const s = ok(v); if (s !== undefined) tags[k] = s; } }
  if (Object.keys(tags).length) o.tags = tags;
  if (e.user && typeof e.user.id === "string" && /^[0-9a-f]{32}$/.test(e.user.id)) o.user = { id: e.user.id };
  if (e.request && typeof e.request === "object") {
    const r = {}, url = scrubUrl(e.request.url), ua = e.request.headers && e.request.headers["User-Agent"];
    if (url) r.url = url;
    if (typeof ua === "string" && /^[A-Za-z0-9 ._()\/;:,+-]{1,300}$/.test(ua)) r.headers = { "User-Agent": ua };
    if (Object.keys(r).length) o.request = r;
  }
  const ctx = {};
  for (const k of ["os", "runtime", "browser"]) {
    const c = e.contexts && e.contexts[k];
    if (!c || typeof c !== "object") continue;
    const x = {};
    for (const f of ["name", "version"]) if (typeof c[f] === "string" && CONTEXT_VALUE.test(c[f])) x[f] = c[f];
    if (Object.keys(x).length) ctx[k] = x;
  }
  if (Object.keys(ctx).length) o.contexts = ctx;
  const sdk = e.sdk || {};
  o.sdk = { name: typeof sdk.name === "string" && /^sentry\.[a-z.]{1,40}$/.test(sdk.name) ? sdk.name : "sentry.javascript.fincom",
    version: typeof sdk.version === "string" && /^[0-9][0-9A-Za-z.+-]{0,30}$/.test(sdk.version) ? sdk.version : "0", settings: { infer_ip: "never" } };
  return o;
}
