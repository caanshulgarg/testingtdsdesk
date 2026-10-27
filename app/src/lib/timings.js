// next-timings (the owner, 26-Oct-2026: "measure FinCom's REAL round-trip latency from the office to the cloud, so we
// know which improvement matters"): how long each kind of request to FinCom's cloud and to the site takes in this
// browser, from the browser's own Resource Timing (performance.getEntriesByType("resource") and a PerformanceObserver),
// the Realtime connection's heartbeat and join replies (Live, src/js/54), and the page's own open (navigation timing and
// the "fincom-ready" mark set by main.jsx when the first page is drawn).
// Its own file (the first file and legacy.js are at their size budgets), started by main.jsx a few seconds after the
// first page, when the computer is idle.
// Each request is kept only as its KIND (the path's pattern: rest/<table> read|save, rpc/<fn>, fn/<function>,
// storage/<op>, auth/<step>, realtime/<what>, site/<file type>, open/<step>) and its time; never the address, an id, a
// query, a body or anything typed. Every 15 minutes (and when the page is hidden), if something new happened, one
// summary row goes to public.client_timings (migration 108): per kind the count, median, 95th percentile, max, average,
// a histogram on fixed bounds (BOUNDS, the same in migration 108's client_timings_report), bytes when the browser gives
// them, and the browser, the system and the connection's type in a few words.
// The diagnostic report (Settings › Reading bills, "Copy report") carries the summary of this page (report()).
// Also each opening of a client's books, step by step (watchBooks, bookSamples: this browser's copy read and whether it
// was there, the server's changes, the cloud copy's check and its day files, the time computing), wrapped around
// legacy.js's own functions at run time from here (legacy.js itself is not changed); installed as the app starts.

// the histogram's upper bounds in ms; the last bucket is everything above 30 s. migration 108 has the same list
export const BOUNDS = [25, 50, 75, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 5000, 8000, 15000, 30000];
export const EVERY = 15 * 60 * 1000;
const CAP = 2000;                  // samples kept a kind (the histogram counts every one)
const IDLE_GAP = 5 * 60 * 1000;    // a function called after this long without a call (or the first time on this page):
                                   // counted apart as "after idle" (the cloud may have to start it again: a cold start)
const NAME = /^[a-z][a-z0-9_-]{0,62}$/i;
const SELF = "rest/client_timings save";

const nm = (s) => (NAME.test(s || "") ? s.toLowerCase() : "?");
const isRead = (m) => m === "GET" || m === "HEAD";

// the kind of one request: its pattern only (no host, id, query value or file name), or null for a request that is
// neither FinCom's cloud nor the site (a font's or a map's server, a browser extension)
export function kindOf(url, method, siteOrigin) {
  let u;
  try { u = new URL(url, siteOrigin || undefined); } catch (e) { return null; }
  const p = u.pathname, m = String(method || "").toUpperCase();
  let r = /^\/(rest|functions|storage|auth|realtime)\/v1(?:\/|$)(.*)$/.exec(p);
  if (r && u.origin !== siteOrigin) {
    const seg = r[2].split("/").filter(Boolean);
    if (r[1] === "rest") {
      if (seg[0] === "rpc") return "rpc/" + nm(seg[1]);
      const how = m ? (isRead(m) ? "read" : "save") : u.searchParams.has("on_conflict") ? "save" : u.searchParams.has("select") ? "read" : "?";
      return "rest/" + nm(seg[0]) + " " + how;
    }
    if (r[1] === "functions") return "fn/" + nm(seg[0]);
    if (r[1] === "auth") return "auth/" + nm(seg[0]);
    if (r[1] === "realtime") return "realtime/" + nm(seg[seg.length - 1]);
    // storage: object/sign/<bucket>/<path> -> storage/sign; object/<bucket>/<path> -> storage/object (read or save)
    if (seg[0] === "object") {
      const op = ["sign", "public", "authenticated", "info", "list", "upload", "move", "copy"].includes(seg[1]) ? seg[1] : "object";
      return "storage/" + op + (op === "object" && m ? (isRead(m) ? " read" : " save") : "");
    }
    return "storage/" + nm(seg[0]);
  }
  if (u.origin !== siteOrigin) return null;
  const f = p.split("/").pop() || "";
  if (/^legacy([.-][^/]*)?\.js$/i.test(f)) return "site/legacy";
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(f) || [])[1];
  if (!ext) return "site/doc";
  const e = ext.toLowerCase();
  return "site/" + ({ js: "js", mjs: "js", css: "css", woff2: "font", woff: "font", ttf: "font", html: "doc", json: "json", wasm: "wasm",
    png: "img", jpg: "img", jpeg: "img", svg: "img", webp: "img", ico: "img", gif: "img", txt: "txt" }[e] || "other");
}

export function bucketOf(ms) {
  for (let i = 0; i < BOUNDS.length; i++) if (ms <= BOUNDS[i]) return i;
  return BOUNDS.length;
}
// the nearest-rank percentile of sorted numbers
export function pct(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

// one accumulator: kind -> {d: samples (at most CAP), h: histogram, n, sum, max, rx, wire, up, c (from cache), x (an
// error answer), i: the "after idle" samples of a function}
export function newAcc() { return { since: Date.now(), k: Object.create(null), fresh: 0 }; }
export function add(acc, kind, ms, x) {
  if (!kind || !(ms >= 0) || !isFinite(ms)) return;
  x = x || {};
  const a = acc.k[kind] || (acc.k[kind] = { d: [], h: [], n: 0, sum: 0, max: 0, rx: 0, wire: 0, up: 0, c: 0, x: 0, i: [] });
  const v = Math.round(ms);
  a.n++; a.sum += v; if (v > a.max) a.max = v;
  const b = bucketOf(v); a.h[b] = (a.h[b] || 0) + 1;
  if (a.d.length < CAP) a.d.push(v); else a.d[Math.floor(Math.random() * CAP)] = v;
  if (x.rx > 0) a.rx += x.rx;
  if (x.wire > 0) a.wire += x.wire;
  if (x.up > 0) a.up += x.up;
  if (x.cached) a.c++;
  if (x.status >= 400) a.x++;
  if (x.idle && a.i.length < CAP) a.i.push(v);
  if (x.q > 0) a.q = (a.q || 0) + x.q;
  if (x.hit > 0) a.hit = (a.hit || 0) + x.hit;
  // what counts as something new to send: a request or the page's open, not the Realtime heartbeat alone, nor what the
  // page asks by itself while nobody uses it (x.bg: a poll with no key or click for 2 minutes; still measured)
  if (!/^realtime\//.test(kind) && !x.bg) acc.fresh++;
}

// the summary of an accumulator, as sent (summary jsonb) and as the report reads it
export function summarise(acc, extra) {
  const k = {};
  for (const kind of Object.keys(acc.k).sort()) {
    const a = acc.k[kind];
    if (!a.n) continue;
    const d = a.d.slice().sort((x, y) => x - y);
    const h = []; for (let i = 0; i <= BOUNDS.length; i++) h.push(a.h[i] || 0);
    while (h.length && !h[h.length - 1]) h.pop();
    const o = { n: a.n, p50: pct(d, 0.5), p95: pct(d, 0.95), max: a.max, avg: Math.round(a.sum / a.n), h };
    if (a.rx) o.rx = a.rx;
    if (a.wire) o.wire = a.wire;
    if (a.up) o.up = a.up;
    if (a.c) o.c = a.c;
    if (a.x) o.x = a.x;
    if (a.q) o.q = a.q;
    if (a.hit) o.hit = a.hit;
    if (a.i.length) { const s = a.i.slice().sort((x, y) => x - y); o.i = { n: s.length, p50: pct(s, 0.5), max: s[s.length - 1] }; }
    k[kind] = o;
  }
  return Object.assign({ v: 1, span: Math.max(0, Math.round((Date.now() - acc.since) / 1000)) }, extra || {}, { k });
}

// one opening of a client's books (the coordinator for the owner, 26-Oct-2026: "why every new visit loads books of
// existing clients every time"), as samples: o = {t0, t1 (ms, the page's clock), local: "memory" | "kept" | "kept-empty"
// | "empty", localMs, shownMs, pullMs, checkMs, days: {n, hit, a, b}, parse, merge, save, audit}; entries: the cloud's
// requests made meanwhile [{k: kind, s: start, rx: bytes}]; long: the page's long tasks [[start, duration]].
//   books/local <state>       reading this browser's copy (memory or IndexedDB), and whether it was there
//   books/shown               from the opening to the books on screen
//   books/server-changes      the server's changes since this computer last looked (client_book_items, records)
//   books/cloud-check         the cloud copy's check and catch-up (TCloud.openLoad: days list, entries, day files)
//   books/days                the day files: wall time, q files asked for, hit of them from this browser's copy
//   books/parse, books/merge, books/save, books/audit-mis   time computing (reading Day Books, putting them into the
//                             books, saving here, the audit and MIS worked out again), summed for the opening
//   books/busy                the page's long tasks during the opening (the main thread blocked, any cause)
//   books/total               from the opening to the end of the cloud check; rx/q every cloud request meanwhile
export function bookSamples(o, entries, long) {
  const out = [], sum = (f) => entries.filter(f).reduce((a, e) => [a[0] + (e.rx > 0 ? e.rx : 0), a[1] + 1], [0, 0]);
  const items = sum((e) => /^rest\/(client_book_items|records) /.test(e.k)), copy = sum((e) => /^(rest|rpc)\/tally_/.test(e.k)), days = sum((e) => /^storage\/(authenticated|object)/.test(e.k)), all = sum(() => true);
  if (o.localMs != null) out.push(["books/local " + (o.local || "empty"), o.localMs, {}]);
  if (o.shownMs != null) out.push(["books/shown", o.shownMs, {}]);
  if (o.pullMs != null) out.push(["books/server-changes", o.pullMs, { rx: items[0], q: items[1] }]);
  if (o.checkMs != null) out.push(["books/cloud-check", o.checkMs, { rx: copy[0] + days[0], q: copy[1] + days[1] }]);
  if (o.days && o.days.n) out.push(["books/days", o.days.b - o.days.a, { q: o.days.n, hit: o.days.hit, rx: days[0] }]);
  for (const k of ["parse", "merge", "save", "audit"]) if (o[k] > 0) out.push(["books/" + (k === "audit" ? "audit-mis" : k), o[k], {}]);
  if (long) out.push(["books/busy", long.reduce((a, [s, d]) => a + Math.max(0, Math.min(s + d, o.t1) - Math.max(s, o.t0)), 0), {}]);
  out.push(["books/total", o.t1 - o.t0, { rx: all[0], q: all[1] }]);
  return out;
}

// "Chrome 141 · Windows": the browser and the system in a few words, never the whole user-agent string
export function browserShort(ua) {
  ua = String(ua || "");
  const b = /Edg\/(\d+)/.exec(ua) ? "Edge " + /Edg\/(\d+)/.exec(ua)[1]
    : /OPR\/(\d+)/.exec(ua) ? "Opera " + /OPR\/(\d+)/.exec(ua)[1]
    : /Firefox\/(\d+)/.exec(ua) ? "Firefox " + /Firefox\/(\d+)/.exec(ua)[1]
    : /Chrome\/(\d+)/.exec(ua) ? "Chrome " + /Chrome\/(\d+)/.exec(ua)[1]
    : /Version\/(\d+)[.\d]* .*Safari\//.exec(ua) ? "Safari " + /Version\/(\d+)/.exec(ua)[1] : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Other";
  return b + " · " + os;
}
export function netNow(nav) {
  const c = nav && nav.connection;
  if (!c) return {};
  const o = {};
  if (typeof c.effectiveType === "string" && /^[a-z0-9-]{1,10}$/i.test(c.effectiveType)) o.net_type = c.effectiveType;
  if (c.rtt >= 0 && isFinite(c.rtt)) o.net_rtt = Math.round(c.rtt);
  if (c.downlink >= 0 && isFinite(c.downlink)) o.net_down = Math.round(c.downlink * 10) / 10;
  return o;
}

// the diagnostic report's lines: the slowest kinds first (by their 95th percentile), at most 30
export function reportText(sum, net, browser, sentAt) {
  const rows = Object.entries((sum && sum.k) || {}).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 30);
  const since = sum && sum.span != null ? Math.round(sum.span / 60) : 0;
  const head = "Connection timings (this page, last " + since + " min; ms: median / 95% / max, count):";
  if (!rows.length) return head + "\n  nothing measured yet";
  const w = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, o]) => "  " + k.padEnd(w) + "  " + o.p50 + " / " + o.p95 + " / " + o.max + "  x" + o.n
    + (o.i ? "  (after idle: " + o.i.p50 + " / max " + o.i.max + ", x" + o.i.n + ")" : "") + (o.x ? "  errors " + o.x : ""));
  const n = net || {};
  lines.push("  " + (browser || "") + (n.net_type ? " · network " + n.net_type : "") + (n.net_rtt != null ? ", rtt " + n.net_rtt + " ms" : "")
    + (n.net_down != null ? ", " + n.net_down + " Mbit/s" : "") + (sentAt ? " · last sent " + new Date(sentAt).toTimeString().slice(0, 5) : ""));
  return head + "\n" + lines.join("\n");
}

// ---------------------------------------------------------------- in the page
const T = { win: null, page: null, sentAt: 0, fails: 0, started: false, methods: new Map(), lastFn: Object.create(null), pend: new Map(),
  books: false, bo: null, long: null, dayGot: new Set(), input: Date.now(), active: 120000 };
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; };

function cloud() {
  return typeof Cloud === "object" && Cloud && Cloud.on && Cloud.on() && Cloud.st && Cloud.st.firm && !Cloud.st.mfa ? Cloud : null;
}
// the page's open and a client's books opening are always something new; a request only within 2 minutes of the
// person's last key or click (an open tab polling all night sends no row)
function both(kind, ms, x) {
  x = Object.assign({}, x, { bg: !/^(open|books|prefetch)\//.test(kind) && Date.now() - T.input > T.active });
  add(T.win, kind, ms, x); add(T.page, kind, ms, x);
}
const keyOf = (url) => { try { const u = new URL(url, location.href); return u.pathname + u.search; } catch (e) { return ""; } };

function take(e) {
  try {
    if (!e || !e.name || /^(data|blob):/.test(e.name)) return;
    const key = keyOf(e.name), q = T.methods.get(key), seen = q && q.shift();
    if (q && !q.length) T.methods.delete(key);
    const kind = kindOf(e.name, seen && seen.m, location.origin);
    if (!kind || kind === SELF) return;
    let idle = false;
    if (kind.startsWith("fn/")) { const last = T.lastFn[kind]; idle = !last || e.startTime - last > IDLE_GAP; T.lastFn[kind] = e.startTime + e.duration; }
    both(kind, e.duration, { rx: e.encodedBodySize, wire: e.transferSize, up: seen && seen.up, cached: e.transferSize === 0 && e.decodedBodySize > 0, status: e.responseStatus, idle });
  } catch (x) { /* never in the way */ }
}

// the method and the size of what is sent, for the Resource Timing entry of the same address (Resource Timing has
// neither): a read and a save to the same table are told apart. Only for the cloud's addresses; nothing else is kept
function watchFetch() {
  const f0 = window.fetch;
  if (typeof f0 !== "function" || f0.__timed) return;
  const f = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && /\/(rest|functions|storage|auth)\/v1\//.test(url)) {
        const m = String((init && init.method) || (input && input.method) || "GET").toUpperCase(), b = init && init.body;
        const up = typeof b === "string" ? b.length : b && typeof b.size === "number" ? b.size : b && typeof b.byteLength === "number" ? b.byteLength : 0;
        const day = /\/tally-days\/.*?(\d{8})\.xml\.gz/.exec(url);
        if (day) { if (T.dayGot.size > 2000) T.dayGot.clear(); T.dayGot.add(day[1]); }
        const key = keyOf(url), q = T.methods.get(key) || [];
        if (T.methods.size > 300) T.methods.clear();
        q.push({ m, up }); T.methods.set(key, q.slice(-20));
      }
    } catch (e) { /* never in the way */ }
    return f0.apply(this, arguments);
  };
  f.__timed = true;
  window.fetch = f;
}

// Realtime (Live, src/js/54-live-sync.js): the time from a heartbeat or a channel's join to its reply
function watchLive() {
  if (typeof Live !== "object" || !Live || Live.__timed || typeof Live.send !== "function" || typeof Live.got !== "function") return;
  const s0 = Live.send, g0 = Live.got;
  Live.send = function (topic, event) {
    const ref = s0.apply(this, arguments);
    try {
      if (ref && (event === "heartbeat" || event === "phx_join")) {
        const now = performance.now();
        for (const [r, p] of T.pend) if (now - p.t > 60000) T.pend.delete(r);
        T.pend.set(String(ref), { t: now, k: event === "heartbeat" ? "realtime/heartbeat" : "realtime/join" });
      }
    } catch (e) { /* never in the way */ }
    return ref;
  };
  Live.got = function (m) {
    try {
      if (m && m.event === "phx_reply" && m.ref != null && T.pend.has(String(m.ref))) {
        const p = T.pend.get(String(m.ref)); T.pend.delete(String(m.ref));
        both(p.k, performance.now() - p.t, { status: m.payload && m.payload.status === "error" ? 500 : 200 });
      }
    } catch (e) { /* never in the way */ }
    return g0.apply(this, arguments);
  };
  Live.__timed = true;
}

function openTimes() {
  try {
    const n = performance.getEntriesByType("navigation")[0];
    if (n) {
      if (n.responseStart > 0) both("open/first-byte", n.responseStart);
      if (n.domContentLoadedEventEnd > 0) both("open/dom", n.domContentLoadedEventEnd);
      if (n.loadEventEnd > 0) both("open/load", n.loadEventEnd);
    }
    const r = performance.getEntriesByName("fincom-ready")[0];
    if (r) both("open/ready", r.startTime);
  } catch (e) { /* not in this browser */ }
}

function build() {
  const v = typeof APP_VERSION === "string" ? (/build (\d+)/.exec(APP_VERSION) || [])[1] : "";
  return v ? { b: Number(v) } : {};
}
function row() {
  return Object.assign({ browser: browserShort(navigator.userAgent) }, netNow(navigator), { summary: summarise(T.win, build()) });
}
// one summary row, when something new happened and someone is signed in. hidden: the page is going away (keepalive)
export async function send(hidden) {
  const C = cloud();
  if (!T.started || !C || !T.win.fresh || T.fails >= 3) return false;
  const body = row(), was = T.win;
  T.win = newAcc();
  try {
    if (hidden) {
      const c = C.cfg(), s = C.sess();
      if (!s || !s.access_token || (typeof LocalOwner === "object" && LocalOwner.guard && LocalOwner.guard("POST", s))) throw new Error("not now");
      await fetch(c.url.replace(/\/+$/, "") + "/rest/v1/client_timings", { method: "POST", keepalive: true,
        headers: { apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(body) })
        .then((r) => { if (!r.ok) throw new Error("" + r.status); });
    } else await C.api("client_timings", { method: "POST", headers: { Prefer: "return=minimal" }, body });
    T.sentAt = Date.now(); T.fails = 0;
    ls("fincom.timings.last", JSON.stringify({ at: T.sentAt, sum: body.summary }));
    return true;
  } catch (e) {
    // kept for the next try (an older cloud without migration 108: three refusals and this page stops trying)
    T.fails++;
    for (const [k, a] of Object.entries(T.win.k)) { const o = was.k[k]; if (!o) { was.k[k] = a; continue; } for (const v of a.d) add(was, k, v); }
    T.win = was;
    return false;
  }
}

// a function of legacy.js timed where it stands (the function itself is called as before, with the same this, arguments
// and answer; a promise's answer or failure is passed on unchanged). pre: before the call, its answer handed to on
function timed(obj, name, on, pre) {
  const f = obj && obj[name];
  if (typeof f !== "function" || f.__timed) return;
  const w = function () {
    const args = arguments, t = performance.now();
    let tok; try { tok = pre ? pre.apply(this, args) : undefined; } catch (e) { /* never in the way */ }
    const done = (v) => { try { on(performance.now() - t, args, v, tok); } catch (e) { /* never in the way */ } };
    const r = f.apply(this, args);
    if (r && typeof r.then === "function") return r.then((v) => { done(v); return v; }, (e) => { done(undefined); throw e; });
    done(r);
    return r;
  };
  w.__timed = true;
  try { obj[name] = w; } catch (e) { /* not writable: not timed */ }
}
const active = () => T.bo && !T.bo.closed ? T.bo : null;
const forCid = (cid) => { const o = active(); return o && o.cid === cid ? o : null; };
function closeOpen(o) {
  if (!o || o.closed) return;
  o.closed = true; clearTimeout(o.timer);
  o.t1 = performance.now();
  let entries = [];
  try {
    entries = performance.getEntriesByType("resource").filter((e) => e.startTime >= o.t0 && e.startTime <= o.t1)
      .map((e) => ({ k: kindOf(e.name, "", location.origin), s: e.startTime, rx: e.encodedBodySize })).filter((e) => e.k && !/^site\//.test(e.k));
  } catch (e) { /* none */ }
  for (const [k, ms, x] of bookSamples(o, entries, T.long)) both(k, ms, x);
}
const closeIn = (o, ms) => { if (!o || o.closed) return; clearTimeout(o.timer); o.timer = setTimeout(() => closeOpen(o), ms); };

// each opening of a client's books (openBooksNow, src/js/18), step by step (bookSamples). Installed as soon as the app
// starts (main.jsx), so the first opening of a visit is measured too; nothing of a client (its id, name or figures) is kept
export function watchBooks() {
  if (T.books || typeof window === "undefined" || typeof performance === "undefined") return;
  T.books = true;
  T.win = T.win || newAcc(); T.page = T.page || newAcc();
  watchFetch();
  try { const L = T.long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (L.length > 500) L.splice(0, 250); L.push([e.startTime, e.duration]); })).observe({ type: "longtask", buffered: true }); } catch (e) { T.long = null; }
  timed(window, "openBooksNow", (ms, a) => {
    const o = forCid(a[0]);
    if (!o) return;
    o.shownMs = ms;
    // the cloud copy's check starts once the page is drawn; without it (no Tally copy) the audit and MIS follow within 4 s
    closeIn(o, typeof TCloud === "object" && TCloud && TCloud.on && TCloud.on() ? 120000 : 4000);
  }, (cid) => {
    closeOpen(T.bo);
    T.bo = { cid, t0: performance.now(), days: { n: 0, hit: 0, a: 0, b: 0 }, parse: 0, merge: 0, save: 0, audit: 0 };
    closeIn(T.bo, 120000);
  });
  if (typeof Books === "object" && Books) timed(Books, "load", (ms, a, v, mem) => {
    const o = forCid(a[0]);
    if (!o || o.localMs != null) return;
    o.localMs = ms;
    o.local = mem ? "memory" : v && v.cid === a[0] ? ((v.vouchers || []).length ? "kept" : "kept-empty") : "empty";
  }, (cid) => !!(Books.mem && Books.mem.has && Books.mem.has(cid)));
  if (typeof Books === "object" && Books) timed(Books, "importDayBook", (ms) => { const o = active(); if (o) o.parse += ms; });
  if (typeof BookSync === "object" && BookSync) timed(BookSync, "pull", (ms, a) => { const o = forCid(a[0]); if (o && o.pullMs == null) o.pullMs = ms; });
  if (typeof TCloud === "object" && TCloud) {
    timed(TCloud, "openLoad", (ms, a) => { const o = forCid(a[0]); if (!o || o.checkMs != null) return; o.checkMs = ms; closeIn(o, 2000); });
    timed(TCloud, "day", (ms, a, v, t) => {
      const o = active(); if (!o) return;
      const d = String(a[1] || ""), got = T.dayGot.has(d); T.dayGot.delete(d);
      o.days.n++; if (!got) o.days.hit++;
      if (!o.days.a || t < o.days.a) o.days.a = t;
      o.days.b = Math.max(o.days.b, t + ms);
    }, () => performance.now());
  }
  if (typeof TallyRead === "object" && TallyRead) { const m = (ms) => { const o = active(); if (o) o.merge += ms; }; timed(TallyRead, "merge", m); timed(TallyRead, "after", m); }
  timed(window, "saveBooks", (ms) => { const o = active(); if (o) o.save += ms; });
  const au = (ms) => { const o = active(); if (o) o.audit += ms; };
  if (typeof Audit === "object" && Audit) timed(Audit, "maybeRun", au);
  if (typeof MIS === "object" && MIS) timed(MIS, "maybeRun", au);
}

// prefetch-books: a step of the clients' books brought in after sign-in (Prefetch, src/js/98): prefetch/start (sign-in to
// the first read), prefetch/items, prefetch/books, prefetch/client, prefetch/all, prefetch/paused, prefetch/stop-<why>
export function mark(kind, ms, x) {
  try { if (!/^prefetch\/[a-z-]+$/.test(kind)) return; T.win = T.win || newAcc(); T.page = T.page || newAcc(); both(kind, ms, x || {}); } catch (e) { /* never in the way */ }
}

// from main.jsx's start(), as the app starts (this file is fetched then; main.jsx has only the import, its first file is
// at its size budget): room for the requests made until the summary starts, the books watched at once, the first page's
// end marked "fincom-ready" (the frame drawn before the program gone, looked for every 100 ms as main.jsx's firstPage
// does; 10 s at most), then the rest 3 s later when the computer is idle
export function boot() {
  try { performance.setResourceTimingBufferSize(1500); } catch (e) { /* not in this browser */ }
  try { watchBooks(); } catch (e) { /* never in the way */ }
  const t0 = Date.now();
  const look = () => {
    if (document.querySelector("[data-boot-part]") && Date.now() - t0 < 10000) { setTimeout(look, 100); return; }
    try { performance.mark("fincom-ready"); } catch (e) { /* */ }
    setTimeout(() => (typeof requestIdleCallback === "function" ? requestIdleCallback(start, { timeout: 5000 }) : start()), 3000);
  };
  look();
}

export function report() {
  let sum = T.page ? summarise(T.page) : null;
  let at = T.sentAt;
  if (!sum || !Object.keys(sum.k).length) { try { const l = JSON.parse(ls("fincom.timings.last") || "null"); if (l && l.sum) { sum = l.sum; at = l.at; } } catch (e) { /* none kept */ } }
  return reportText(sum, netNow(navigator), browserShort(navigator.userAgent), at);
}

export function start() {
  if (T.started || typeof performance === "undefined" || !performance.getEntriesByType) return;
  T.started = true; T.win = T.win || newAcc(); T.page = T.page || newAcc();
  watchFetch(); watchLive();
  openTimes();
  try { performance.getEntriesByType("resource").forEach(take); } catch (e) { /* not in this browser */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach(take)).observe({ type: "resource" }); } catch (e) { /* the entries read above only */ }
  // Live may start after this (the firm's sign-in): looked for again
  const live = setInterval(() => { watchLive(); if (typeof Live === "object" && Live && Live.__timed) clearInterval(live); }, 5000);
  const every = Number(window.__fincomTimingsEvery) >= 1000 ? Number(window.__fincomTimingsEvery) : EVERY;
  T.active = Math.min(120000, 2 * every);
  const used = () => { T.input = Date.now(); };
  document.addEventListener("pointerdown", used, { capture: true, passive: true });
  document.addEventListener("keydown", used, { capture: true, passive: true });
  setInterval(() => { send(false); }, every);
  const away = () => { if (document.visibilityState === "hidden") send(true); };
  document.addEventListener("visibilitychange", away);
  window.addEventListener("pagehide", () => send(true));
  window.__fincomTimings = { report, send, summary: () => summarise(T.page) };
}
