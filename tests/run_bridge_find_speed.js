// node run_bridge_find_speed.js - next-speed-2 (the speed plan of 22-Nov-2026, #6): how FinCom looks for this Windows
// login's own FinCom Bridge on 9100..9199 (Bridge.find, src/js/24-tally-bridge.js), on made-up bridges answering /ping in
// this script (no real port is opened). The owner's condition is kept: a bridge is taken only on its proof.
//   1. this login's own bridge (proved with the key, sameSession true) answering: the look stops there, the rest of the
//      100 ports are not asked (before: all 100, every look);
//   2. ports that hold the line (no answer at all): the first round waits 700 ms a port, not 1.5 s; a bridge slow to answer
//      (1.2 s) is still found, asked again with 2.5 s (only the ports that did not answer in time);
//   3. a bridge without sameSession (older than 2.5.3) and another login's: the whole range is looked at as before, the
//      proven one picked, the other login's never;
//   4. pairing (pair, the code typed) right after a look: only the ports that answered that look are asked with the code;
//      the bridge paired; one that started after the look (nothing usable among those ports) is found by a whole look.
const crypto = require("crypto"), {load, HTML} = require("./harness");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, ["Bridge"]);
const B = x.Bridge;
const LS = {};
Object.assign(ctx, {lsGet: k => (k in LS ? LS[k] : null), lsSet: (k, v) => { LS[k] = String(v); }, lsDel: k => { delete LS[k]; },
  setTimeout, clearTimeout, AbortController, TextEncoder, Uint8Array, Promise, crypto: globalThis.crypto, window: {}, Error, TypeError});
const hmac = (k, m) => crypto.createHmac("sha256", k).update(m).digest("hex");
const KEY = "k".repeat(24), CODE = "482913";
// port -> {id, ms (answer after), hang (never answers), same (sameSession), key (proves with), code (pairing window)}
let NET = {}, pings = [];
ctx.fetch = (url, opt) => {
  const u = new URL(url), port = +u.port, b = NET[port], sig = opt && opt.signal;
  if (u.pathname === "/ping") pings.push(port);
  // nothing listens: refused after 5 ms (a refused connection on this computer is a few milliseconds)
  if (!b) return new Promise((res, rej) => setTimeout(() => rej(new TypeError("Failed to fetch")), 5));
  return new Promise((res, rej) => {
    const t = b.hang ? null : setTimeout(() => {
      const n = u.searchParams.get("n") || "", body = {ok: true, version: "2.5.16", bridgeId: b.id, port};
      if (u.pathname === "/ping"){
        if (b.same !== undefined) body.sameSession = b.same;
        if (b.key) body.proof = hmac(b.key, n + b.id + port);
        if (b.code) body.pairProof = hmac(b.code, n + b.id + port);
      } else if (u.pathname === "/pair"){
        if (b.code && u.searchParams.get("code") === b.code){ b.key = b.newKey; Object.assign(body, {key: b.newKey}); }
        else Object.assign(body, {ok: false, error: "no"});
      }
      res({status: 200, ok: true, json: async () => body});
    }, b.ms || 1);
    if (sig) sig.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
  });
};
const fresh = (cfg) => { for (const k of Object.keys(LS)) delete LS[k]; B.setCfg(Object.assign({url: "http://127.0.0.1:9100", key: KEY}, cfg || {})); B.foundAt = 0; B.lastFound = null; B.lastOk = []; B.answered = null; pings = []; };
const timed = async (f) => { const t = Date.now(); const r = await f(); return [r, Date.now() - t]; };
(async () => {
  console.log("== 1. this login's own bridge answering: the look stops there");
  NET = {9103: {id: "go-aa0000000001", key: KEY, same: true, ms: 10}};
  fresh({url: "http://127.0.0.1:9150"});
  let [f, ms] = await timed(() => B.find());
  ok(f && f.port === 9103, "1. found on 9103 (" + (f && f.port) + ")");
  const asked = new Set(pings.filter(p => p !== 9150)).size;
  console.log("  info ports asked: " + asked + " of 100 (" + ms + " ms)");
  ok(asked <= 50, "1. the rest of the range is not asked (" + asked + " ports asked)");

  console.log("== 2. ports that hold the line; a slow bridge");
  NET = {};
  for (let p = 9150; p < 9200; p++) NET[p] = {hang: true};
  NET[9140] = {id: "go-aa0000000002", key: KEY, same: true, ms: 1200};
  fresh();
  [f, ms] = await timed(() => B.find());
  console.log("  info 50 ports holding the line, the bridge answering in 1.2 s: " + ms + " ms");
  ok(f && f.port === 9140, "2. the slow bridge (1.2 s) is found (" + (f && f.port) + ")");
  ok(ms < 4500, "2. the look took " + ms + " ms (before: 1.5 s a port in rounds of 16, about 6 s)");
  const second = pings.filter(p => p < 9150 && p !== 9140 && p !== 9100);     // (9100, the address kept, is asked first)
  ok(!second.some((p, i) => second.indexOf(p) !== i), "2. a port that refused is asked once only");

  console.log("== 3. an older bridge (no sameSession) and another login's: the whole range, the proven one picked");
  NET = {9101: {id: "go-bb0000000003", key: "other-login-key-000000", same: false}, 9177: {id: "go-aa0000000004", key: KEY}};
  fresh();
  f = await B.find();
  ok(f && f.port === 9177, "3. the proven bridge picked, another login's never (" + (f && f.port) + ")");
  ok(new Set(pings).size === 100, "3. all 100 ports asked (" + new Set(pings).size + ")");

  console.log("== 4. pairing right after a look");
  NET = {9104: {id: "go-aa0000000005", code: CODE, newKey: "n".repeat(24)}, 9101: {id: "go-bb0000000006", key: "other-login-key-000000", same: false}};
  fresh({key: ""});
  await B.find();                                   // (no key yet: nothing proven; the look only learns who answers)
  B.setCfg({url: "http://127.0.0.1:9100"}); pings = [];
  let j = await B.pair(CODE).catch(e => ({err: e.message}));
  const pp = new Set(pings);
  ok(j && j.key === "n".repeat(24) && B.cfg().url === "http://127.0.0.1:9104", "4. paired with the bridge on 9104 (" + JSON.stringify(j).slice(0, 80) + ")");
  ok(pp.size <= 4, "4. only the ports that answered the look were asked with the code (" + [...pp].join(",") + ")");
  NET[9188] = {id: "go-aa0000000007", code: CODE, newKey: "m".repeat(24)}; delete NET[9104];
  B.setCfg({url: "http://127.0.0.1:9100", key: ""}); pings = [];
  j = await B.pair(CODE).catch(e => ({err: e.message}));
  ok(j && j.key === "m".repeat(24) && B.cfg().url === "http://127.0.0.1:9188", "4. a bridge started after the look is found by a whole look (" + B.cfg().url + ")");

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("ERROR " + (e && e.stack || e)); process.exit(1); });
