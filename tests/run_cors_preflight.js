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
    const src = fs.readFileSync(path.join(dir, "index.ts"), "utf8");
    ok(/import \{ corsFor \} from "\.\/cors\.ts"/.test(src) && /req\.method === "OPTIONS"\) return new Response\("ok", \{ headers: cors \}\)/.test(src), fn + ": index.ts answers OPTIONS with corsFor(req)");
    ok(!/const ALLOWED\s*=/.test(fs.readFileSync(path.join(dir, "cors.ts"), "utf8")), fn + ": keeps no list of its own");
    for (const o of SITES) {
      const h = m.corsFor(req(o));
      ok(h["Access-Control-Allow-Origin"] === o && covers(h["Access-Control-Allow-Headers"], APP_HEADERS) && /POST/.test(h["Access-Control-Allow-Methods"]) && h.Vary === "Origin",
        fn + ": a preflight from " + o + " is allowed, with the app's headers");
    }
    const bad = m.corsFor(req("https://evil.example"));
    ok(bad["Access-Control-Allow-Origin"] !== "https://evil.example" && bad["Access-Control-Allow-Origin"] === "https://caanshulgarg.github.io", fn + ": an unknown site is not echoed (" + bad["Access-Control-Allow-Origin"] + ")");
    ok(m.corsFor(req("null"))["Access-Control-Allow-Origin"] === "null", fn + ": the standalone file (Origin null) still works");
  }
  // ALLOWED_ORIGINS secret still adds sites
  globalThis.Deno = { env: { get: (k) => (k === "ALLOWED_ORIGINS" ? "https://extra.example, https://two.example" : undefined) } };
  ok(shared.corsFor(req("https://two.example"))["Access-Control-Allow-Origin"] === "https://two.example", "the ALLOWED_ORIGINS secret still adds sites");
  delete globalThis.Deno;

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
