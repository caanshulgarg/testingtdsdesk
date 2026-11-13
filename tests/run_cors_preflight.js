// node tests/run_cors_preflight.js - every function the browser calls answers a preflight from FinCom's own sites
// (review of 02-Oct-2026: the gateway's own copy of the allowed sites lacked staging.fincom.live, the browser stopped
// bill reading before it was sent). Loads each function's CORS handler as deployed (the per-function cors.ts, which
// takes the one list from server/_shared/cors.ts) and checks the "*" functions take their headers from it too.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const SITES = ["https://staging.fincom.live", "https://app.fincom.live", "https://fincom.live"];
const APP_HEADERS = ["apikey", "authorization", "content-type", "x-client-info"];
const req = (origin) => ({ headers: { get: (k) => (k.toLowerCase() === "origin" ? origin : null) } });
const covers = (h, list) => { const have = String(h || "").toLowerCase().split(",").map((s) => s.trim()); return list.every((x) => have.includes(x)); };

(async () => {
  const shared = await import(path.join(ROOT, "server/_shared/cors.ts"));
  ok(SITES.every((s) => shared.ALLOWED_ORIGINS.includes(s)), "the shared list has staging.fincom.live, app.fincom.live and fincom.live");
  ok(covers(shared.ALLOW_HEADERS, APP_HEADERS.concat(["x-fincom-device"])), "the shared headers cover the app's and the bridge's: " + shared.ALLOW_HEADERS);

  // functions that check the origin: their own cors.ts, as each index.ts imports it
  for (const fn of ["gateway", "admin", "signin"]) {
    const dir = path.join(ROOT, "server/security/functions", fn);
    const m = await import(path.join(dir, "cors.ts"));
    // where the function answers a request: admin in index.ts; gateway and signin in handler.ts since their rules moved
    // there for the Deno tests
    const idx = fs.readFileSync(path.join(dir, "index.ts"), "utf8");
    const hasHandler = fs.existsSync(path.join(dir, "handler.ts")), src = hasHandler ? fs.readFileSync(path.join(dir, "handler.ts"), "utf8") : idx;
    const where = hasHandler ? "handler.ts" : "index.ts";
    const imported = /import \{ corsFor \} from "\.\/cors\.ts"/.test(src) || (/import \{ corsFor \} from "\.\/cors\.ts"/.test(idx) && /cors: corsFor\b/.test(idx));
    const options = /const cors = (corsFor\(req\)|d\.cors\(req\));[\s\S]{0,400}?req\.method === "OPTIONS"\) return new Response\("ok", \{ headers: cors \}\)/.test(src);
    const first = src.indexOf('req.method === "OPTIONS"'), auth = src.search(/getUser\(|authToken\(|\.rpc\(/);
    ok(imported && options, fn + ": " + where + " answers OPTIONS with corsFor(req)");
    ok(first > 0 && (auth < 0 || first < src.indexOf("getUser(", first) || src.indexOf("getUser(", first) < 0) && !/\bOPTIONS\b[\s\S]{0,200}"Access-Control-Allow-Origin": "\*"/.test(src), fn + ": the preflight is answered before any sign-in check, with the list's headers (never \"*\")");
    ok(!/const ALLOWED\s*=/.test(fs.readFileSync(path.join(dir, "cors.ts"), "utf8")), fn + ": keeps no list of its own");
    for (const o of SITES) {
      const h = m.corsFor(req(o));
      ok(h["Access-Control-Allow-Origin"] === o && covers(h["Access-Control-Allow-Headers"], APP_HEADERS) && /POST/.test(h["Access-Control-Allow-Methods"]) && h.Vary === "Origin",
        fn + ": a preflight from " + o + " is allowed, with the app's headers");
    }
    const bad = m.corsFor(req("https://evil.example"));
    ok(bad["Access-Control-Allow-Origin"] !== "https://evil.example" && bad["Access-Control-Allow-Origin"] === "https://caanshulgarg.github.io", fn + ": an unknown site is not echoed (" + bad["Access-Control-Allow-Origin"] + ")");
    // a file opened from disk and a developer's own machine are not on the fixed list
    for (const o of ["null", "http://localhost:8000", "http://127.0.0.1:8000"]) ok(m.corsFor(req(o))["Access-Control-Allow-Origin"] === "https://caanshulgarg.github.io", fn + ": " + o + " is not allowed unless the function's secret lists it");
  }
  // the console's two sites: the sign-in function answers them (the console signs in there); gateway and admin do not
  const consoleSites = JSON.parse(/export const DEFAULT_ORIGINS = (\[[^\]]*\]);/.exec(fs.readFileSync(path.join(ROOT, "server/console/core/router.ts"), "utf8"))[1]);
  ok(consoleSites.length === 2 && JSON.stringify(consoleSites) === JSON.stringify(shared.CONSOLE_ORIGINS), "the console's sites here are the console function's own two");
  for (const fn of ["gateway", "admin", "signin"]) {
    const m = await import(path.join(ROOT, "server/security/functions", fn, "cors.ts"));
    for (const o of consoleSites) {
      const got = m.corsFor(req(o))["Access-Control-Allow-Origin"];
      ok(fn === "signin" ? got === o : got === "https://caanshulgarg.github.io", fn + ": a preflight from " + o + (fn === "signin" ? " is allowed" : " is not allowed"));
    }
  }
  // ALLOWED_ORIGINS secret still adds sites
  globalThis.Deno = { env: { get: (k) => (k === "ALLOWED_ORIGINS" ? "https://extra.example, https://two.example" : undefined) } };
  ok(shared.corsFor(req("https://two.example"))["Access-Control-Allow-Origin"] === "https://two.example", "the ALLOWED_ORIGINS secret still adds sites");
  // L5: staging's secret may still allow them for calls; links and redirects go to https sites only, whatever the secret says
  globalThis.Deno = { env: { get: (k) => (k === "ALLOWED_ORIGINS" ? "null, http://localhost:8000, https://extra.example, http://plain.example, https://localhost:8443" : undefined) } };
  ok(shared.corsFor(req("null"))["Access-Control-Allow-Origin"] === "null" && shared.corsFor(req("http://localhost:8000"))["Access-Control-Allow-Origin"] === "http://localhost:8000", "the secret (staging) still allows a file from disk and a developer's machine to call");
  const links = shared.linkOrigins();
  ok(SITES.every((x) => links.includes(x)) && links.includes("https://extra.example") && !links.some((x) => x === "null" || /^http:|localhost|127\./.test(x)), "links and redirects: https sites only (" + links.join(" ") + ")");
  delete globalThis.Deno;
  ok(!shared.ALLOWED_ORIGINS.some((x) => x === "null" || !/^https:\/\//.test(x)), "the fixed list is https sites only");

  // functions that keep "*": headers from the shared file, and the OPTIONS answer uses them
  for (const [fn, dir, methods] of [["tally-ingest", "server/tally-cloud", "POST"], ["gst-api", "server/gst-api", "GET, POST"], ["gst-taxpro", "server/gst-taxpro", "GET, POST"], ["support-mail", "server/support-mail", "POST"]]) {
    const src = fs.readFileSync(path.join(ROOT, dir, "index.ts"), "utf8");
    ok(/import \{ corsFor \} from "\.\.\/_shared\/cors\.ts"/.test(src) && /const cors = corsFor\(null, \{ any: true/.test(src) && !/"Access-Control-Allow-Headers"/.test(src), fn + ": takes its CORS headers from the shared file");
    ok(fs.existsSync(path.join(ROOT, dir, "../_shared/cors.ts")), fn + ": ../_shared/cors.ts resolves from its folder");
    const h = shared.corsFor(null, { any: true, methods: methods + ", OPTIONS" });
    ok(h["Access-Control-Allow-Origin"] === "*" && covers(h["Access-Control-Allow-Headers"], APP_HEADERS.concat(fn === "tally-ingest" ? ["x-fincom-device"] : [])), fn + ": \"*\" with the app's headers" + (fn === "tally-ingest" ? " and x-fincom-device" : ""));
  }
  ok(fs.realpathSync(path.join(ROOT, "server/security/functions/_shared/cors.ts")) === fs.realpathSync(path.join(ROOT, "server/_shared/cors.ts")), "server/security/functions/_shared is the same folder as server/_shared");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
