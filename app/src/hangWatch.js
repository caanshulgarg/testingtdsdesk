// next-hang-watch (04-Nov-2026; the owner: "still it is not working.. showing page irresponsive", Chrome's "Page unresponsive"):
// a hang throws nothing, so Sentry heard nothing. This reports one, with where it was. Part of the Sentry chunk (src/sentry.js,
// staging only, loaded after the first page), so neither legacy.js nor the first file grows.
//   - after: a frame that blocked the page over 2 s (Long Animation Frames: the scripts that ran, their file, function and
//     place; Chrome 123+), else a 1 s heartbeat that came over 3 s late: one warning "Page blocked", level warning;
//   - during: a small worker the page tells "alive" every second; 6 s without a word (the page is stuck, perhaps for good,
//     and the person may close it) and the worker itself sends the same warning, "stall", with how long so far.
// One incident per tab per 10 minutes (sessionStorage; the worker's own report and the page's after it are one incident).
// Tagged: kind hang, where (frame / heartbeat / stall), the page's NAME (route), the build (__BUILD_ID__), ms. The last UI
// actions are breadcrumbs "ui" of code names only (the data-* attribute of what was clicked, never its text), and the event
// goes through the one scrubber (server/_shared/sentry-scrub.js) as every event does; the worker's copy is that same
// scrubbed event made beforehand, only its time and ms filled in.
//
// next-tally-table (04-Nov-2026; FINCOM-APP-STAGING-G, its first 16 events): none of them was a page that blocked. The
// shared server's tab had gone to the background (its requests fell from about 25 a minute to 2 at 09:37): a hidden tab's
// timers are held back by the browser (seconds at first, then once a minute), so the heartbeat came 6-8 s late and the
// worker, whose own clock keeps going, heard nothing for 55 s, every 10 minutes; the Macs' 233-1,033 s "stalls" were the
// computer asleep. Now:
//   - only a page that is SEEN counts: the worker is told at once when the tab is hidden or shown and counts nothing while
//     hidden; a heartbeat or a frame is reported only when the page was seen from its start to its end;
//   - a computer that slept is not a hang: the worker's own one-second clock came late (over 3 s), or the gap is over a
//     minute (a page truly stuck that long is told by the worker while it is stuck);
//   - each report says what ran: the long frames of the gap (their scripts as the stack, the longest as tag "script"),
//     and the last UI step (tag "last_ui", its code name, and "ui_s", the seconds since).
// hang-tally-sync (FINCOM-APP-STAGING-G, staging 6-Nov-2026 06:59 UTC: the Tally page blocked 4,283 ms about 10 s after
// Try again, where frame, and no stack): the long frame named no script with a file, so nothing said whether the time was
// the page's code, a script without a file, or the browser laying out and painting the page. Each report now says how the
// frame's time was spent (the frame's own figures, Long Animation Frames): script_ms (its scripts, with a file or not),
// style_ms (style and layout), render_ms (the whole rendering step, style and layout among it), other_ms (the rest: neither
// a script nor the rendering step, as a large table shown by a one-line script: tests/run_hang_render.py, 35 of 38 s), and
// invoker, what started the longest script (a code name: TimerHandler:setTimeout, IDBRequest.onsuccess, DIV.onclick)
// Review: the invoker can carry the page's addresses (IFRAME[src=/review/...], a script's URL): only an entry point's code
// name is sent (not for a script file's own run: classic-script, module-script), cut at "[", "#" or "://", and only in
// the shape Name.member or Name:member (the scrubber keeps that shape alone: INVOKER, server/_shared/sentry-scrub.js).
// The scripts run in the rendering step (requestAnimationFrame, from renderStart on) count as scripts, not rendering
export const INVOKER = /^[A-Z][A-Za-z]*(?:[.:][A-Za-z]+){1,3}$/;
export const invokerOf = (s) => { if (!s || /script$/.test(String(s.invokerType || ""))) return "";
  const v = String(s.invoker || "").split(/\[|#|:\/\//)[0]; return INVOKER.test(v) ? v : ""; };
export function frameTags(list) {
  let render = 0, style = 0, script = 0, all = 0, top = null;
  [].concat(list || []).forEach((e) => {
    if (!e) return;
    const end = (Number(e.startTime) || 0) + (Number(e.duration) || 0); all += Number(e.duration) || 0;
    let inRender = 0;
    [].concat(e.scripts || []).forEach((x) => { if (!x) return; const d = Number(x.duration) || 0; script += d; if (e.renderStart > 0 && x.startTime >= e.renderStart) inRender += d; if (!top || d > top.duration) top = x; });
    if (e.renderStart > 0) render += Math.max(0, end - e.renderStart - inRender);
    if (e.styleAndLayoutStart > 0) style += Math.max(0, end - e.styleAndLayoutStart);
  });
  const t = { render_ms: String(Math.round(render)), style_ms: String(Math.round(style)), script_ms: String(Math.round(script)), other_ms: String(Math.round(Math.max(0, all - script - render))) };
  const inv = invokerOf(top); if (inv) t.invoker = inv;
  return t;
}
const LONG_MS = 2000, LATE_MS = 3000, STALL_MS = 6000, EVERY_MS = 10 * 60000, SLEPT_MS = 60000, KEY = "fincom.hang.at";
const build = () => (typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev");
const recent = () => { try { return Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < EVERY_MS; } catch { return false; } };
const mark = (t) => { try { sessionStorage.setItem(KEY, String(t || Date.now())); } catch { /* storage blocked: the page's own clock */ } };
const seen = () => typeof document !== "object" || document.visibilityState !== "hidden";
const file = (u) => String(u || "").split("?")[0].split("#")[0];
// next-fix-sentry-noise (14-Nov-2026): a late heartbeat with no long frame in it, in Safari (no Long Animation Frames; it
// holds back a window's timers when the window is not in front) or in a window hidden or not in front during the gap,
// is the browser holding back the timers, not a page that blocked: not reported. A gap with long frames is reported as before
export const isSafari = (ua) => /safari/i.test(String(ua || "")) && !/chrome|chromium|crios|fxios|edg|android|opr\//i.test(String(ua || ""));
export const timersHeld = ({ frames, safari, seen: s, focused }) => !frames && (!!safari || !s || !focused);
const focusedNow = () => typeof document !== "object" || typeof document.hasFocus !== "function" || document.hasFocus();
// the scripts of the long frames, as stack frames (Sentry maps them back with the build's source maps)
const framesOf = (scripts) => [].concat(scripts || []).filter((s) => s && s.sourceURL).sort((a, b) => b.duration - a.duration).slice(0, 5).reverse()
  .map((s) => ({ filename: file(s.sourceURL), function: s.sourceFunctionName || String(s.invoker || "").slice(0, 60) || "?", lineno: 1, colno: Math.max(0, Number(s.sourceCharPosition) || 0), in_app: true }));
// "Tally-Ab12.js:clientRow" for the longest script of the frames
const scriptTag = (scripts) => { const s = [].concat(scripts || []).filter((x) => x && x.sourceURL).sort((a, b) => b.duration - a.duration)[0];
  return s ? (file(s.sourceURL).split("/").pop() + ":" + (s.sourceFunctionName || String(s.invoker || "").slice(0, 40) || "?")).slice(0, 120) : ""; };
export function actName(el) {
  const a = el && el.closest && el.closest("button,a,select,input,label,[role=button],[data-tab],[data-act]");
  if (!a) return "";
  const d = [...a.attributes].map((x) => x.name).find((n) => /^data-[a-z][a-z0-9-]{0,40}$/.test(n));
  return d ? d.slice(5) : a.tagName.toLowerCase();
}
// the worker: told "alive" every second with the event to send, and at once when the tab is hidden or shown; it sends
// that once when the SEEN page has been silent 6 s. Its own clock late by over 3 s: the computer slept, start again
export const WORKER = "let t=0,ev=null,url='',sent=0,vis=true,tick=Date.now();onmessage=(m)=>{const d=m.data||{};if('vis' in d)vis=!!d.vis;t=Date.now();if(d.ev){ev=d.ev;url=d.url;}if(d.sent)sent=d.sent;};" +
  "setInterval(()=>{const now=Date.now(),self=now-tick;tick=now;if(self>3000){t=now;postMessage({slept:now});return;}if(!vis||!ev||!t||now-t<" + STALL_MS + "||now-sent<" + EVERY_MS + ")return;sent=now;const e=JSON.parse(ev),id=Array.from(crypto.getRandomValues(new Uint8Array(16)),(b)=>b.toString(16).padStart(2,'0')).join('');" +
  "e.event_id=id;e.timestamp=now/1000;e.tags.ms=String(now-t);fetch(url,{method:'POST',body:JSON.stringify({event_id:id,sent_at:new Date(now).toISOString()})+'\\n'+JSON.stringify({type:'event'})+'\\n'+JSON.stringify(e),keepalive:true}).catch(()=>{});postMessage({sentAt:now});},1000);";
export function watchHangs({ captureEvent, addBreadcrumb, scrubEvent, routeName, dsn, release, user }) {
  if (window.__fincomHangWatch) return;
  window.__fincomHangWatch = true;
  // the last UI actions: code names only; the last one kept for the report
  const ui = { n: "", at: 0 };
  document.addEventListener("click", (ev) => { const n = actName(ev.target); if (n) { ui.n = n; ui.at = Date.now(); addBreadcrumb({ category: "ui", message: n, data: { route: routeName() } }); } }, true);
  const uiTags = () => (ui.n ? { last_ui: ui.n, ui_s: String(Math.round((Date.now() - ui.at) / 1000)) } : {});
  // when the page was last hidden and last shown (performance.now()): a gap that has either in it was not seen throughout
  let hidAt = seen() ? -1 : performance.now(), shownAt = -1, tellNow = null;
  const seenSince = (t0) => seen() && hidAt < t0 && shownAt < t0;
  // when the window was last left and last come back to (performance.now()): a gap with either in it was not in front throughout
  let blurAt = focusedNow() ? -1 : performance.now(), focusAt = -1;
  window.addEventListener("blur", () => { blurAt = performance.now(); });
  window.addEventListener("focus", () => { focusAt = performance.now(); });
  const focusedSince = (t0) => focusedNow() && blurAt < t0 && focusAt < t0;
  // the long frames (over 150 ms) of the last minute, with their scripts: what ran during a late heartbeat
  const lf = [];
  let lastFrame = 0, follow = 0;
  const send = (where, ms, scripts, more) => {
    // one incident per 10 minutes; the page's own report right after the worker's (the same block, with where) is part of it
    const after = follow && Date.now() - follow < 120000;
    if (recent() && !after) return;
    follow = 0; mark();
    const frames = framesOf(scripts), tags = Object.assign({ kind: "hang", where, route: routeName(), build: build(), ms: String(Math.round(ms)), vis: seen() ? "seen" : "hidden" }, uiTags(), more || {});
    const st = scriptTag(scripts); if (st) tags.script = st;
    captureEvent({ level: "warning", message: "Page blocked", tags,
      exception: { values: [{ type: "Error", value: "Page blocked", mechanism: { type: "hang", handled: true }, stacktrace: frames.length ? { frames } : undefined }] } });
  };
  // (after) a long frame, with its scripts, when the page was seen from its start
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => {
      if (e.duration > 150) { lf.push({ t: e.startTime, end: e.startTime + e.duration, scripts: [].concat(e.scripts || []), e }); while (lf.length > 30) lf.shift(); }
      if (e.duration > LONG_MS && seenSince(e.startTime)) { lastFrame = Date.now(); send("frame", e.duration, e.scripts, frameTags([e])); }
    })).observe({ type: "long-animation-frame", buffered: false });
  } catch { /* a browser without it: the heartbeat */ }
  // the computer slept: the worker says so (its own clock came late), or the wall clock moved on more than this page's
  // own clock (a Mac's stops while asleep)
  let beat = performance.now(), wall = Date.now(), sleptAt = 0;
  document.addEventListener("visibilitychange", () => {
    const now = performance.now();
    if (seen()) { shownAt = now; beat = now; wall = Date.now(); } else hidAt = now;
    if (tellNow) tellNow();
  });
  setInterval(() => {
    const now = performance.now(), gap = now - beat, from = beat, w = Date.now(), late = w - wall - gap > 1000; beat = now; wall = w;
    // (a moment later than the frame's own report, so a frame reported is not reported again); a gap over a minute is a
    // computer that slept (the worker tells a page truly stuck that long, while it is stuck)
    if (gap > LATE_MS && gap < SLEPT_MS && !late && seenSince(from)) setTimeout(() => {
      if (Date.now() - lastFrame <= 3000 || Date.now() - sleptAt < gap + 2500) return;
      const scripts = [], es = []; let n = 0;
      lf.forEach((f) => { if (f.end > from && f.t < now) { n++; scripts.push(...f.scripts); es.push(f.e); } });
      if (timersHeld({ frames: n, safari: isSafari(navigator.userAgent), seen: seenSince(from), focused: focusedSince(from) })) return;
      send("heartbeat", gap, scripts, Object.assign({ frames: String(n) }, n ? frameTags(es) : {}));
    }, 300);
  }, 1000);
  // (during) the worker
  try {
    const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn);
    if (!m || typeof Worker !== "function" || typeof Blob !== "function") return;
    const url = "https://" + m[2] + "/api/" + m[3] + "/envelope/?sentry_version=7&sentry_key=" + m[1];
    const w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })));
    let tmpl = "", key = "";
    const tell = () => {
      const r = routeName(), u = uiTags(), k = r + "|" + (u.last_ui || "") + "|" + Math.floor((Number(u.ui_s) || 0) / 60);
      if (k !== key || !tmpl) {
        key = k;
        const e = scrubEvent({ type: "event", platform: "javascript", level: "warning", release, user, message: "Page blocked",
          tags: Object.assign({ kind: "hang", where: "stall", route: r, build: build(), ms: "0", vis: "seen" }, u),
          exception: { values: [{ type: "Error", value: "Page blocked", mechanism: { type: "hang", handled: true } }] },
          request: { url: location.href, headers: { "User-Agent": navigator.userAgent } } });
        tmpl = e && e.tags ? JSON.stringify(e) : "";
      }
      let sent = 0; try { sent = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* */ }
      w.postMessage({ ev: tmpl, url, sent, vis: seen() });
    };
    tellNow = tell;
    // the worker says when it sent: this tab's incident (the page's report after it is the same one)
    w.onmessage = (m2) => { const d = m2.data || {}, t = Number(d.sentAt) || 0; if (d.slept) sleptAt = Number(d.slept) || Date.now(); if (t) { mark(t); follow = Date.now(); } };
    tell(); setInterval(tell, 1000);
    window.addEventListener("pagehide", () => { try { w.terminate(); } catch { /* */ } });
  } catch { /* no worker: the reports after the block only */ }
}
