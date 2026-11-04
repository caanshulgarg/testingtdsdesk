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
const LONG_MS = 2000, LATE_MS = 3000, STALL_MS = 6000, EVERY_MS = 10 * 60000, KEY = "fincom.hang.at";
const build = () => (typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev");
const recent = () => { try { return Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < EVERY_MS; } catch { return false; } };
const mark = (t) => { try { sessionStorage.setItem(KEY, String(t || Date.now())); } catch { /* storage blocked: the page's own clock */ } };
// the scripts of the long frame, as stack frames (Sentry maps them back with the build's source maps)
const framesOf = (scripts) => [].concat(scripts || []).filter((s) => s && s.sourceURL).sort((a, b) => b.duration - a.duration).slice(0, 5).reverse()
  .map((s) => ({ filename: String(s.sourceURL).split("?")[0], function: s.sourceFunctionName || String(s.invoker || "").slice(0, 60) || "?", lineno: 1, colno: Math.max(0, Number(s.sourceCharPosition) || 0), in_app: true }));
export function actName(el) {
  const a = el && el.closest && el.closest("button,a,select,input,label,[role=button],[data-tab],[data-act]");
  if (!a) return "";
  const d = [...a.attributes].map((x) => x.name).find((n) => /^data-[a-z][a-z0-9-]{0,40}$/.test(n));
  return d ? d.slice(5) : a.tagName.toLowerCase();
}
// the worker: told "alive" every second with the event to send; it sends that once when the page has been silent 6 s
const WORKER = "let t=0,ev=null,url='',sent=0;onmessage=(m)=>{t=Date.now();if(m.data&&m.data.ev){ev=m.data.ev;url=m.data.url;}if(m.data&&m.data.sent)sent=m.data.sent;};" +
  "setInterval(()=>{const now=Date.now();if(!ev||!t||now-t<" + STALL_MS + "||now-sent<" + EVERY_MS + ")return;sent=now;const e=JSON.parse(ev),id=Array.from(crypto.getRandomValues(new Uint8Array(16)),(b)=>b.toString(16).padStart(2,'0')).join('');" +
  "e.event_id=id;e.timestamp=now/1000;e.tags.ms=String(now-t);fetch(url,{method:'POST',body:JSON.stringify({event_id:id,sent_at:new Date(now).toISOString()})+'\\n'+JSON.stringify({type:'event'})+'\\n'+JSON.stringify(e),keepalive:true}).catch(()=>{});postMessage({sentAt:now});},1000);";
export function watchHangs({ captureEvent, addBreadcrumb, scrubEvent, routeName, dsn, release, user }) {
  if (window.__fincomHangWatch) return;
  window.__fincomHangWatch = true;
  // the last UI actions: code names only
  document.addEventListener("click", (ev) => { const n = actName(ev.target); if (n) addBreadcrumb({ category: "ui", message: n, data: { route: routeName() } }); }, true);
  let lastFrame = 0, follow = 0;
  const send = (where, ms, frames) => {
    // one incident per 10 minutes; the page's own report right after the worker's (the same block, with where) is part of it
    const after = follow && Date.now() - follow < 120000;
    if (recent() && !after) return;
    follow = 0; mark();
    captureEvent({ level: "warning", message: "Page blocked", tags: { kind: "hang", where, route: routeName(), build: build(), ms: String(Math.round(ms)) },
      exception: { values: [{ type: "Error", value: "Page blocked", mechanism: { type: "hang", handled: true }, stacktrace: frames && frames.length ? { frames } : undefined }] } });
  };
  // (after) a long frame, with its scripts
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > LONG_MS) { lastFrame = Date.now(); send("frame", e.duration, framesOf(e.scripts)); } }))
      .observe({ type: "long-animation-frame", buffered: false });
  } catch { /* a browser without it: the heartbeat */ }
  let beat = performance.now();
  setInterval(() => {
    const now = performance.now(), gap = now - beat; beat = now;
    // (a moment later than the frame's own report, so a frame reported is not reported again)
    if (gap > LATE_MS) setTimeout(() => { if (Date.now() - lastFrame > 3000) send("heartbeat", gap, null); }, 300);
  }, 1000);
  // (during) the worker
  try {
    const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn);
    if (!m || typeof Worker !== "function" || typeof Blob !== "function") return;
    const url = "https://" + m[2] + "/api/" + m[3] + "/envelope/?sentry_version=7&sentry_key=" + m[1];
    const w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })));
    let tmpl = "", key = "";
    const tell = () => {
      const r = routeName();
      if (r !== key || !tmpl) {
        key = r;
        const e = scrubEvent({ type: "event", platform: "javascript", level: "warning", release, user, message: "Page blocked",
          tags: { kind: "hang", where: "stall", route: r, build: build(), ms: "0" },
          exception: { values: [{ type: "Error", value: "Page blocked", mechanism: { type: "hang", handled: true } }] },
          request: { url: location.href, headers: { "User-Agent": navigator.userAgent } } });
        tmpl = e && e.tags ? JSON.stringify(e) : "";
      }
      let sent = 0; try { sent = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* */ }
      w.postMessage({ ev: tmpl, url, sent });
    };
    // the worker says when it sent: this tab's incident (the page's report after it is the same one)
    w.onmessage = (m2) => { const t = Number(m2.data && m2.data.sentAt) || 0; if (t) { mark(t); follow = Date.now(); } };
    tell(); setInterval(tell, 1000);
    window.addEventListener("pagehide", () => { try { w.terminate(); } catch { /* */ } });
  } catch { /* no worker: the reports after the block only */ }
}
