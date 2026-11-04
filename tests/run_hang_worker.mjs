// node run_hang_worker.mjs - next-tally-table (04-Nov-2026; Sentry FINCOM-APP-STAGING-G, its first 16 events all a page not
// seen or a computer asleep): the hang reporter's worker (app/src/hangWatch.js WORKER), run here on a made-up clock:
//   1. the page seen and silent 7 s (truly stuck): one "stall", with how long so far;
//   2. the page hidden (its timers held back by the browser), silent 60 s: nothing; shown again: counted from then;
//   3. the computer asleep 17 minutes (the worker's own one-second clock comes late): nothing; awake and silent 7 s: one;
//   4. two stalls within 10 minutes: one report.
// RED on 2827a1820's worker: 2 and 3 send a "stall" (55 s and 1,033 s, as Sentry got).
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { WORKER } = await import(path.join(HERE, "..", "app", "src", "hangWatch.js"));
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
// a worker on a made-up clock: tick() is its setInterval, msg() what the page posts
function worker() {
  let now = 1_800_000_000_000, every = null;
  const sent = [], posted = [];
  const D = function (t) { return new Date(t === undefined ? now : t); }; D.now = () => now;
  const ctx = {
    Date: D, JSON, String, Array, Uint8Array, crypto: { getRandomValues: (a) => { a.fill(7); return a; } },
    setInterval: (fn) => { every = fn; return 1; }, fetch: (url, o) => { sent.push({ url, body: o.body, at: now }); return Promise.resolve({}); },
    postMessage: (m) => posted.push(m), onmessage: null,
  };
  vm.createContext(ctx);
  vm.runInContext(WORKER, ctx);
  const ev = JSON.stringify({ tags: { kind: "hang", where: "stall", ms: "0" }, message: "Page blocked" });
  return {
    msg: (d) => ctx.onmessage({ data: Object.assign({ ev, url: "https://sentry.example/api/1/envelope/" }, d) }),
    // the clock moves by ms, the worker's interval runs each second (or once, late, when it slept)
    run: (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { now += step; every(); } },
    sleep: (ms) => { now += ms; every(); },
    sent, posted, ms: () => sent.map((s) => JSON.parse(s.body.split("\n")[2]).tags.ms),
  };
}

console.log("1. seen and silent 7 s: one stall");
{ const w = worker(); w.msg({ vis: true }); w.run(5000); ok(w.sent.length === 0, "nothing in the first 5 s"); w.run(3000); ok(w.sent.length === 1 && Number(w.ms()[0]) >= 6000, "a stall, with how long so far (" + w.ms() + " ms)"); }

console.log("2. hidden: nothing; shown again: counted from then");
{ const w = worker(); w.msg({ vis: true }); w.run(2000); w.msg({ vis: false }); w.run(60000);
  ok(w.sent.length === 0, "hidden and silent 60 s (the browser holds a hidden tab's timers): nothing (" + w.sent.length + ")");
  w.msg({ vis: true }); w.run(4000); ok(w.sent.length === 0, "shown again, 4 s: nothing");
  w.run(4000); ok(w.sent.length === 1 && Number(w.ms()[0]) < 9000, "shown and then silent 7 s: one stall, counted from when shown (" + w.ms() + " ms)"); }

console.log("3. asleep 17 minutes: nothing");
{ const w = worker(); w.msg({ vis: true }); w.run(2000); w.sleep(17 * 60000);
  ok(w.sent.length === 0, "the worker's clock came 17 minutes late (the computer slept): nothing (" + w.ms() + ")");
  ok(w.posted.some((m) => m.slept), "and it tells the page, so the page's own late heartbeat is not reported either");
  w.run(3000); ok(w.sent.length === 0, "awake, 3 s: nothing"); w.run(5000); ok(w.sent.length === 1 && Number(w.ms()[0]) < 9000, "awake and silent 7 s: one stall (" + w.ms() + " ms)"); }

console.log("4. one incident per 10 minutes");
{ const w = worker(); w.msg({ vis: true }); w.run(8000); w.msg({ vis: true }); w.run(8000); ok(w.sent.length === 1, "two stalls within 10 minutes: one report (" + w.sent.length + ")"); }

console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
