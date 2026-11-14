// node run_hang_heartbeat.mjs - next-fix-sentry-noise (14-Nov-2026): the hang reporter's heartbeat (app/src/hangWatch.js),
// run here on a made-up clock and a made-up page. A heartbeat that came over 3 s late with no long frame in it, in Safari
// (no Long Animation Frames; it holds back the timers of a window not in front) or in a window hidden or not in front
// during the gap, is the browser holding back the timers: no "Page blocked". A gap with long frames is reported as before.
//   1. Chrome, seen and in front, long frames in the gap: reported (where heartbeat, frames 3);
//   2. Chrome, seen and in front, no long frame: reported as before;
//   3. Chrome, the window not in front (blurred before the gap, hasFocus false): nothing;
//   4. Chrome, the window left and come back to during the gap: nothing;
//   5. Chrome, hidden during the gap: nothing;
//   6. Safari, in front, no long frame: nothing;
//   7. Safari, with long frames: reported;
//   8. Chrome, not in front, with long frames: reported.
// RED on staging-next's hangWatch.js: 3, 4 and 6 send a "Page blocked".
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.HANG_WATCH_JS || path.join(HERE, "..", "app", "src", "hangWatch.js");
const M = await import(pathToFileURL(SRC).href);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });

// a page on a made-up clock: run(ms) lets the timers run; hold(ms) moves the clock on with no timer run (blocked or held back)
function page(ua) {
  let perf = 1000, timers = [], id = 0, obs = null;
  const wall0 = 1_800_000_000_000, sent = [], winL = {}, docL = {};
  const d = { visibilityState: "visible", focused: true };
  set("performance", { now: () => perf });
  const RealDate = Date; const D = function (...a) { return a.length ? new RealDate(...a) : new RealDate(wall0 + perf); }; D.now = () => wall0 + perf; set("Date", D);
  set("setInterval", (fn, ms) => { timers.push({ id: ++id, at: perf + ms, fn, iv: ms }); return id; });
  set("setTimeout", (fn, ms) => { timers.push({ id: ++id, at: perf + (ms || 0), fn }); return id; });
  set("window", { addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); } });
  set("document", { get visibilityState() { return d.visibilityState; }, hasFocus: () => d.focused, addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); } });
  set("navigator", { userAgent: ua });
  const store = {}; set("sessionStorage", { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } });
  set("PerformanceObserver", class { constructor(cb) { obs = cb; } observe() {} });
  const run = (ms) => {
    const end = perf + ms;
    for (;;) {
      const t = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!t) break;
      perf = Math.max(perf, t.at);
      if (t.iv) t.at = perf + t.iv; else timers = timers.filter((x) => x !== t);
      t.fn();
    }
    perf = end;
  };
  M.watchHangs({ captureEvent: (e) => sent.push(e), addBreadcrumb: () => {}, scrubEvent: (e) => e, routeName: () => "home/clients", dsn: "", release: "x", user: {} });
  run(2500);
  return {
    sent, run, now: () => perf,
    hold: (ms) => { perf += ms; },
    frames: (list) => obs({ getEntries: () => list }),
    blur: () => { d.focused = false; (winL.blur || []).forEach((f) => f()); },
    focus: () => { d.focused = true; (winL.focus || []).forEach((f) => f()); },
    hide: (h) => { d.visibilityState = h ? "hidden" : "visible"; (docL.visibilitychange || []).forEach((f) => f()); },
  };
}
// a 4 s late heartbeat; during it (from the gap's start), optionally three long frames of 1 s (each under the 2 s of a
// frame's own report) and something else that happens
function late(p, { frames = false, during } = {}) {
  const t0 = p.now();
  p.hold(1500); if (during) during(); p.hold(2500);
  if (frames) p.frames([0, 1, 2].map((i) => ({ startTime: t0 + 200 + i * 1100, duration: 1000, scripts: [] })));
  p.run(2000);
  return p.sent.filter((e) => e.tags && e.tags.where === "heartbeat");
}

console.log("0. which browser is Safari");
if (typeof M.isSafari !== "function") ok(false, "isSafari exported"); else {
ok(M.isSafari(SAFARI) && M.isSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "Safari on a Mac and an iPhone");
ok(!M.isSafari(CHROME) && !M.isSafari(CHROME + " Edg/131.0.0.0") && !M.isSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1") &&
  !M.isSafari("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0") && !M.isSafari(""), "not Chrome, Edge, Chrome on iOS, Firefox or no browser named");
}

console.log("1-2. Chrome, seen and in front: reported as before");
{ const r = late(page(CHROME), { frames: true }); ok(r.length === 1 && r[0].tags.frames === "3" && Number(r[0].tags.ms) >= 3000, "long frames in the gap: one Page blocked, where heartbeat, frames 3 (" + JSON.stringify(r.map((e) => e.tags)) + ")"); }
{ const r = late(page(CHROME)); ok(r.length === 1 && r[0].tags.frames === "0", "no long frame: one Page blocked as before (" + r.length + ")"); }

console.log("3-5. Chrome, the window not in front or hidden during the gap, no long frame: nothing");
{ const p = page(CHROME); p.blur(); p.run(1500); const r = late(p); ok(r.length === 0, "not in front (blurred, hasFocus false): nothing (" + r.length + ")"); }
{ const p = page(CHROME); const r = late(p, { during: () => { p.blur(); p.focus(); } }); ok(r.length === 0, "left and come back to during the gap: nothing (" + r.length + ")"); }
{ const p = page(CHROME); const r = late(p, { during: () => { p.hide(true); p.hide(false); } }); ok(r.length === 0, "hidden during the gap: nothing (" + r.length + ")"); }

console.log("6-8. Safari; and long frames in a window not in front");
{ const r = late(page(SAFARI)); ok(r.length === 0, "Safari, in front, no long frame: nothing (" + r.length + ")"); }
{ const r = late(page(SAFARI), { frames: true }); ok(r.length === 1 && r[0].tags.frames === "3", "Safari with long frames: reported (" + r.length + ")"); }
{ const p = page(CHROME); p.blur(); p.run(1500); const r = late(p, { frames: true }); ok(r.length === 1 && r[0].tags.frames === "3", "not in front, with long frames: reported (" + r.length + ")"); }

console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
