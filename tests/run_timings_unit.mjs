// node run_timings_unit.mjs - next-timings (the owner, 26-Oct-2026): the summariser of app/src/lib/timings.js, alone (no
// browser). 1. each request's KIND is its path's pattern only (rest/<table> read|save, rpc/<fn>, fn/<function>,
// storage/<op>, auth/<step>, realtime/<what>, site/<file type>); never an id, a query value, a host or a file name.
// 2. the percentiles (nearest rank), the histogram on the bounds migration 108 reads, bytes, errors, "after idle".
// 3. the summary and the report hold none of the ids, emails, client names or tokens of the addresses measured.
// 4. the browser in a few words; the connection's type; Realtime heartbeats alone are not "something new to send".
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = await import(path.join(HERE, "..", "app", "src", "lib", "timings.js"));
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const SITE = "https://staging.fincom.live", SB = "https://abcdefghijklmnop.supabase.co";
const ID = "3f2c9a10-1b2c-4d5e-8f90-123456789abc", CID = "c_9f8e7d", EMAIL = "owner@firm.in", TOKEN = "eyJhbGciOiJIUzI1NiJ9.secret";

console.log("== 1. kinds");
const cases = [
  [SB + "/rest/v1/records?select=kind,id,data,deleted&client_id=eq." + CID + "&id=eq." + ID, "GET", "rest/records read"],
  [SB + "/rest/v1/records?on_conflict=firm_id,kind,id", "POST", "rest/records save"],
  [SB + "/rest/v1/records?on_conflict=firm_id,kind,id", undefined, "rest/records save"],
  [SB + "/rest/v1/clients?select=id&id=in.(" + CID + ")", undefined, "rest/clients read"],
  [SB + "/rest/v1/client_book_items?client_id=eq." + CID, "PATCH", "rest/client_book_items save"],
  [SB + "/rest/v1/client_book_items?client_id=eq." + CID, "DELETE", "rest/client_book_items save"],
  [SB + "/rest/v1/client_book_items?client_id=eq." + CID, undefined, "rest/client_book_items ?"],
  [SB + "/rest/v1/rpc/my_account", "POST", "rpc/my_account"],
  [SB + "/rest/v1/rpc/tally_gst_summary?p_client=" + CID, "POST", "rpc/tally_gst_summary"],
  [SB + "/functions/v1/tally-ingest", "POST", "fn/tally-ingest"],
  [SB + "/functions/v1/fincom-assistant/turn/" + ID, "POST", "fn/fincom-assistant"],
  [SB + "/functions/v1/signin", "POST", "fn/signin"],
  [SB + "/auth/v1/token?grant_type=refresh_token", "POST", "auth/token"],
  [SB + "/storage/v1/object/sign/documents/" + ID + "/" + EMAIL + ".pdf", "POST", "storage/sign"],
  [SB + "/storage/v1/object/documents/" + ID + "/bill.pdf", "GET", "storage/object read"],
  [SB + "/storage/v1/object/documents/" + ID + "/bill.pdf", "POST", "storage/object save"],
  [SB + "/storage/v1/upload/resumable", "POST", "storage/upload"],
  [SB + "/realtime/v1/api/broadcast", "POST", "realtime/broadcast"],
  [SB + "/rest/v1/" + ID + "?select=x", "GET", "rest/? read"],
  [SITE + "/legacy.js?v=" + ID, "", "site/legacy"],
  [SITE + "/assets/index-Ab12Cd.js", "", "site/js"],
  [SITE + "/assets/Tally-9x8y.css", "", "site/css"],
  [SITE + "/assets/inter-latin.woff2", "", "site/font"],
  [SITE + "/", "", "site/doc"],
  [SITE + "/review/#/client/" + CID, "", "site/doc"],
  ["https://fonts.example.com/x.woff2", "", null],
  ["https://o123.ingest.sentry.io/api/1/envelope/", "POST", null],
  ["http://localhost:9321/rest/v1/records?select=id", "GET", "rest/records read"],       // a test's stand-in for the cloud
];
for (const [u, m, want] of cases) { const k = T.kindOf(u, m, SITE); ok(k === want, (u.length > 70 ? u.slice(0, 70) + "…" : u) + " " + (m || "") + " -> " + k); }
ok(T.kindOf("not a url", "GET", undefined) === null, "an address that does not parse is not counted");

console.log("== 2. percentiles, histogram, bytes");
ok(T.pct([], 0.5) === 0 && T.pct([7], 0.95) === 7, "pct of none and of one");
const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
ok(T.pct(ten, 0.5) === 50 && T.pct(ten, 0.95) === 100 && T.pct(ten, 0.9) === 90, "nearest rank: p50 50, p90 90, p95 100 of 10..100");
const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
ok(T.pct(hundred, 0.5) === 50 && T.pct(hundred, 0.95) === 95, "p50 50, p95 95 of 1..100");
ok(T.bucketOf(0) === 0 && T.bucketOf(25) === 0 && T.bucketOf(26) === 1 && T.bucketOf(1000) === 10 && T.bucketOf(30000) === 17 && T.bucketOf(30001) === 18, "buckets on BOUNDS (the last is above 30 s)");
const mig = fs.readFileSync(path.join(HERE, "..", "server", "security", "migration-108-client-timings.sql"), "utf8");
ok(mig.includes("array[" + T.BOUNDS.join(",") + "]"), "migration 108 reads the histogram on the same bounds");
const acc = T.newAcc();
for (let i = 1; i <= 100; i++) T.add(acc, "rest/records read", i * 10, { rx: 100, wire: 400 });
T.add(acc, "rest/records save", 250, { up: 1234, status: 409 });
T.add(acc, "fn/tally-ingest", 2400, { idle: true }); T.add(acc, "fn/tally-ingest", 300); T.add(acc, "fn/tally-ingest", 320);
T.add(acc, "site/js", 5, { cached: true });
T.add(acc, "nothing", NaN); T.add(acc, "", 10); T.add(acc, "neg", -1);
const s = T.summarise(acc, { b: 199 });
const r = s.k["rest/records read"];
ok(r.n === 100 && r.p50 === 500 && r.p95 === 950 && r.max === 1000 && r.avg === 505, "records read: n 100, p50 500, p95 950, max 1000, avg 505 " + JSON.stringify([r.n, r.p50, r.p95, r.max, r.avg]));
ok(r.h.reduce((a, b) => a + b, 0) === 100 && r.h.length === 11 && r.h[10] === 30, "its histogram counts every sample (30 in 701..1000) " + JSON.stringify(r.h));
ok(r.rx === 10000 && r.wire === 40000 && !("up" in r), "bytes received summed (rx 10000, wire 40000)");
const w = s.k["rest/records save"];
ok(w.up === 1234 && w.x === 1 && w.n === 1, "a save: bytes sent 1234, one error answer");
const f = s.k["fn/tally-ingest"];
ok(f.n === 3 && f.max === 2400 && f.i && f.i.n === 1 && f.i.max === 2400, "a function's first call after idle kept apart (cold start): " + JSON.stringify(f.i));
ok(s.k["site/js"].c === 1, "a file from the cache counted");
ok(!("nothing" in s.k) && !("" in s.k) && !("neg" in s.k), "no sample without a kind or a time");
ok(s.v === 1 && s.b === 199 && s.span >= 0, "version 1, the build, the span");
ok(acc.fresh === 105, "every request is something new (" + acc.fresh + ")");
const hb = T.newAcc(); T.add(hb, "realtime/heartbeat", 80); T.add(hb, "realtime/join", 120);
ok(hb.fresh === 0, "Realtime heartbeats and joins alone are not something new to send");
const bg = T.newAcc(); T.add(bg, "rpc/tally_status", 90, { bg: true }); T.add(bg, "fn/fincom-call", 300, { bg: true });
ok(bg.fresh === 0 && T.summarise(bg).k["rpc/tally_status"].n === 1, "the page's own polls while nobody uses it: measured, not something new to send");
const many = T.newAcc(); for (let i = 0; i < 5000; i++) T.add(many, "rpc/x", i % 1000);
ok(many.k["rpc/x"].d.length === 2000 && T.summarise(many).k["rpc/x"].n === 5000, "at most 2000 samples kept a kind, every one counted");

console.log("== 3. no id, value or name leaks");
const acc2 = T.newAcc();
for (const [u, m] of cases) { const k = T.kindOf(u, m, SITE); if (k) T.add(acc2, k, 100, {}); }
const blob = JSON.stringify(T.summarise(acc2)) + T.reportText(T.summarise(acc2), { net_type: "4g", net_rtt: 150 }, "Chrome 141 · Windows", Date.now());
for (const bad of [ID, CID, EMAIL, "eq.", "supabase.co", "abcdefghijklmnop", "staging.fincom.live", "localhost", "select=", "on_conflict", "index-Ab12Cd", "bill.pdf", "documents/", TOKEN, "grant_type", "?v="])
  ok(!blob.includes(bad), "not in the summary or the report: " + bad);
ok(Object.keys(T.summarise(acc2).k).every((k) => /^(rest|rpc|fn|auth|storage|realtime|site|open|books)\/[a-z0-9_?-]*( (read|save|\?))?$/.test(k)), "every kind is a pattern: " + Object.keys(T.summarise(acc2).k).join(", "));

console.log("== 3b. a client's books opening, step by step (bookSamples)");
{
  const o = { t0: 1000, t1: 9000, local: "empty", localMs: 40, shownMs: 6100, pullMs: 1800, checkMs: 2600, days: { n: 30, hit: 0, a: 7000, b: 8400 }, parse: 900, merge: 300, save: 250, audit: 0 };
  const entries = [{ k: "rest/client_book_items read", s: 1100, rx: 50000 }, { k: "rest/records read", s: 1200, rx: 8000 }, { k: "rpc/tally_days_list", s: 6500, rx: 3000 },
    { k: "rest/tally_vouchers read", s: 6600, rx: 400000 }, { k: "storage/authenticated", s: 7000, rx: 20000 }, { k: "storage/authenticated", s: 7100, rx: 22000 }, { k: "auth/token", s: 1050, rx: 0 }];
  const out = T.bookSamples(o, entries, [[500, 700], [2000, 300], [8800, 400]]), by = Object.fromEntries(out.map(([k, ms, x]) => [k, [ms, x]]));
  ok(by["books/local empty"] && by["books/local empty"][0] === 40, "this browser's copy: read in 40 ms, it was empty (a first visit / an evicted copy / a private window)");
  ok(by["books/shown"][0] === 6100, "shown after 6.1 s");
  ok(by["books/server-changes"][0] === 1800 && by["books/server-changes"][1].rx === 58000 && by["books/server-changes"][1].q === 2, "the server's changes: 1.8 s, 58,000 bytes in 2 requests (client_book_items, records)");
  ok(by["books/cloud-check"][0] === 2600 && by["books/cloud-check"][1].rx === 445000 && by["books/cloud-check"][1].q === 4, "the cloud copy's check: 2.6 s, 445,000 bytes (days list, entries, 2 day files)");
  ok(by["books/days"][0] === 1400 && by["books/days"][1].q === 30 && by["books/days"][1].hit === 0, "the day files: 1.4 s wall, 30 asked for, none from this browser's copy");
  ok(by["books/parse"][0] === 900 && by["books/merge"][0] === 300 && by["books/save"][0] === 250 && !by["books/audit-mis"], "computing: parse 900, merge 300, save 250 ms (no audit run: not listed)");
  ok(by["books/busy"][0] === 700, "long tasks inside the opening only: 200 + 300 + 200 = 700 ms of the main thread blocked (got " + by["books/busy"][0] + ")");
  ok(by["books/total"][0] === 8000 && by["books/total"][1].q === 7 && by["books/total"][1].rx === 503000, "the whole opening: 8 s, 7 cloud requests, 503,000 bytes");
  const kept = T.bookSamples({ t0: 0, t1: 900, local: "memory", localMs: 1, shownMs: 260 }, [], null);
  ok(kept.map((x) => x[0]).join(",") === "books/local memory,books/shown,books/total", "a reopening from memory with nothing else: only its local read, shown and total (no busy without the long-task API)");
  const acc = T.newAcc(); for (const [k, ms, x] of out) T.add(acc, k, ms, x);
  const s = T.summarise(acc).k;
  ok(s["books/days"].q === 30 && s["books/days"].hit === undefined && s["books/total"].q === 7 && s["books/total"].rx === 503000, "counts and bytes carried into the summary row");
  ok(!JSON.stringify(s).includes("cid"), "no client id in the summary");
}

console.log("== 4. browser, network, report");
ok(T.browserShort("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36") === "Chrome 141 · Windows", "Chrome on Windows");
ok(T.browserShort("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0") === "Edge 141 · Windows", "Edge");
ok(T.browserShort("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15") === "Safari 18 · macOS", "Safari on a Mac");
ok(T.browserShort("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1") === "Safari 18 · iOS", "Safari on an iPhone");
ok(T.browserShort("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0") === "Firefox 131 · Linux", "Firefox on Linux");
ok(T.browserShort("") === "Other · Other", "nothing known");
ok(JSON.stringify(T.netNow({ connection: { effectiveType: "4g", rtt: 150, downlink: 9.75 } })) === '{"net_type":"4g","net_rtt":150,"net_down":9.8}', "the connection: type, rtt, downlink");
ok(JSON.stringify(T.netNow({})) === "{}" && JSON.stringify(T.netNow({ connection: { effectiveType: "<script>" } })) === "{}", "no connection API: nothing; an odd type: not kept");
const rep = T.reportText(s, { net_type: "4g", net_rtt: 150 }, "Chrome 141 · Windows", Date.UTC(2026, 9, 26, 9, 5));
ok(/^Connection timings \(this page, last \d+ min; ms: median \/ 95% \/ max, count\):\n  fn\/tally-ingest/.test(rep), "the report: its head, the slowest kind first\n" + rep);
ok(rep.includes("after idle: 2400 / max 2400, x1") && rep.includes("errors 1") && rep.includes("network 4g, rtt 150 ms"), "the report shows after-idle, errors and the network");
ok(T.reportText(null).endsWith("nothing measured yet"), "nothing measured: said so");
console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
