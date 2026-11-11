// node tests/run_cloud_wait_unit.mjs - the reliability round of 11-Nov-2026, the two small pieces by themselves (the code
// is read out of src/js, as the page runs it):
// 1. Cloud.timed / Cloud.waitFor (src/js/27): a request with no answer is given up after its wait with e.timedOut and
//    words a person can read, and is itself stopped; an answer or a failure in time passes through as it is and stops
//    nothing; the wait: 20 s, a second more for each 8 KB sent, two minutes at most, or the caller's own.
// 2. TStale / tallyMark (src/js/49): a read that failed is "Could not check just now, trying again" as of the last good
//    read; the computers' state is judged at that moment (never "offline" from FinCom's own failure); a status loses its
//    green tick and says so; when the read works again nothing is marked.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(HERE, "..", "src", "js", f), "utf8");
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("not found: " + a); return s.slice(i, j); };
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("== 1. Cloud.timed, Cloud.waitFor");
const Cloud = new Function("num", "return ({" + cut(src("27-firm-account.js"), "  WAIT: 20000,", "  async authCall(") + "});")((x) => Number(x) || 0);
ok(Cloud.waitFor({}, undefined) === 20000 && Cloud.waitFor(null, "") === 20000, "a read waits 20 s");
ok(Cloud.waitFor({}, "x".repeat(80000)) === 30000, "a save of 80 KB: 30 s (" + Cloud.waitFor({}, "x".repeat(80000)) + ")");
ok(Cloud.waitFor({}, "x".repeat(5e6)) === 120000, "two minutes at most");
ok(Cloud.waitFor({ timeout: 90000 }, "") === 90000 && Cloud.waitFor({ timeout: 5000 }, "x".repeat(5e6)) === 5000, "the caller's own wait");
{
  let sig = null, t0 = Date.now(), err = null;
  await Cloud.timed(60, (s) => { sig = s; return new Promise(() => {}); }).catch((e) => { err = e; });
  ok(err && err.timedOut === true && Date.now() - t0 < 500, "no answer: given up after its wait (e.timedOut)");
  ok(/did not answer in 0 seconds|did not answer/.test(err.message) && /timed out/.test(err.message) && /Check the internet/.test(err.message), "in words a person can read (" + err.message + ")");
  ok(sig && sig.aborted === true, "the request itself is stopped (its signal)");
  let s2 = null; const v = await Cloud.timed(200, async (s) => { s2 = s; await sleep(20); return 7; });
  await sleep(300);
  ok(v === 7 && s2.aborted === false, "an answer in time passes through; nothing is stopped afterwards");
  let e2 = null; await Cloud.timed(200, async () => { throw new Error("Cloud error 500"); }).catch((e) => { e2 = e; });
  ok(e2 && e2.message === "Cloud error 500" && !e2.timedOut, "a failure in time is the caller's own failure");
  let e3 = null; await Cloud.timed(200, () => { throw new Error("thrown at once"); }).catch((e) => { e3 = e; });
  ok(e3 && e3.message === "thrown at once", "a function that throws at once is a failure, not a crash");
  // a request that fails only after it was given up: no second, unhandled failure
  let un = 0; const h = () => { un++; }; process.on("unhandledRejection", h);
  await Cloud.timed(30, (s) => new Promise((_, no) => s.addEventListener("abort", () => no(new Error("aborted"))))).catch(() => {});
  await sleep(50); process.off("unhandledRejection", h);
  ok(un === 0, "the stopped request's own failure is not left unhandled");
}

console.log("== 2. TStale, tallyMark");
const { TStale, tallyMark } = new Function("tallyHm", cut(src("49-tally-cloud.js"), "const TStale = {", "function devState(") + "; return {TStale, tallyMark};")(
  (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(11, 16) + " IST");
const now = Date.now();
ok(TStale.now() === null && TStale.clock(now) === now, "nothing read yet, nothing failed: not marked, the clock is now");
TStale.ok("light"); const okAt = TStale.by.light.okAt;
ok(TStale.now() === null && TStale.clock(now + 5000) === now + 5000, "the read worked: not marked");
TStale.fail("light", new Error("Cloud error 520"));
const st = TStale.now();
ok(st && st.words === "Could not check just now, trying again" && st.at === okAt && /^as of \d\d:\d\d IST$/.test(st.as), "the read failed: the words, as of the last good read (" + JSON.stringify(st) + ")");
ok(TStale.clock(now + 10 * 60000) === okAt, "ten minutes of failures: the computers are judged at the last good read, their beats do not age");
const m = tallyMark({ state: "connected", level: "ok", word: "Connected", text: "Connected" });
ok(m.level === "warn" && m.state === "connected" && /could not check just now, trying again \(as of \d\d:\d\d IST\)/.test(m.text) && m.stale.at === okAt, "a connected status: no green tick, the words and the time (" + m.text + ")");
ok(tallyMark({ state: "offline", level: "bad", text: "Disconnected" }).level === "bad", "a bad one stays bad");
const u = { state: "unlinked", level: "warn", text: "Not linked" };
ok(tallyMark(u) === u && tallyMark(null) === null, "a client not linked (FinCom's own fact) is not marked");
TStale.fail("sum", new Error("x"));
ok(TStale.now().at === 0 && TStale.now().as === "nothing read yet", "another read that never worked: the oldest counts (nothing read yet)");
TStale.ok("sum"); TStale.ok("light");
const p = { state: "connected", level: "ok", text: "Connected" };
ok(TStale.now() === null && tallyMark(p) === p && TStale.clock(now + 99) === now + 99, "the reads work again: nothing marked");

console.log(fails ? "\n" + fails + " failed" : "\nall passed");
process.exit(fails ? 1 : 0);
