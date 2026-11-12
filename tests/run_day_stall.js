// node tests/run_day_stall.js - TCloud.dayGet (src/js/49-tally-cloud.js), the download of Tally's day files (TCloud.day,
// FirstOpen.fetchDay / fetchMonth): given up only when no byte comes for DAY_MS (here 100 ms), however long the whole
// takes; a read that never ends, abort or not, still ends; a refused answer lets the connection go. Mock fetches only.
"use strict";
const path = require("path"), src = require("fs").readFileSync(path.join(__dirname, "..", "src", "js", "49-tally-cloud.js"), "utf8");
const T = eval("({DAY_MS: 100, " + src.match(/  async dayGet\(url, init\)\{[\s\S]*?\n  \},\n/)[0] + "})");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const stream = (chunks, gap, deaf) => async () => ({ok: true, status: 200, headers: new Headers({"content-type": "application/octet-stream"}), body: new ReadableStream({async pull(c){ const x = chunks.shift(); if (!x){ c.close(); return; } if (deaf && !chunks.length) await new Promise(() => {}); await wait(gap); c.enqueue(new Uint8Array(x)); }})});
(async () => {
  globalThis.fetch = stream([[1, 2], [3], [4, 5, 6]], 60);
  const a = await T.dayGet("u", {});
  ok(a.ok && a.type === "application/octet-stream" && Array.from(new Uint8Array(a.gz)).join(",") === "1,2,3,4,5,6", "slow but steady (180 ms, a part every 60 ms): all of it");
  globalThis.fetch = stream([[1], [2]], 10, true);
  const t0 = Date.now(); let e1 = null; try { await T.dayGet("u", {}); } catch (e){ e1 = e; }
  ok(e1 && e1.timedOut && /stalled; it will be fetched again/.test(e1.message) && Date.now() - t0 < 1000, "a read that never ends: ended after " + (Date.now() - t0) + " ms (" + (e1 && e1.message) + ")");
  let aborted = false; globalThis.fetch = async (u, o) => { o.signal.addEventListener("abort", () => { aborted = true; }); return {ok: false, status: 404, headers: new Headers()}; };
  const c = await T.dayGet("u", {});
  ok(c.status === 404 && !c.ok && aborted, "a refused answer (404): said, and the connection let go");
  globalThis.fetch = () => new Promise(() => {});
  let e2 = null; try { await T.dayGet("u", {}); } catch (e){ e2 = e; }
  ok(e2 && e2.timedOut, "no answer at all: ended (" + (e2 && e2.message) + ")");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
