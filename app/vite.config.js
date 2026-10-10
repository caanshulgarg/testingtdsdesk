// FinCom React app. `npm run build` → dist/ (live), `npm run build:test` → dist-test/ (the testing site, staging database).
// The business logic is the program built from ../src/js by `python3 build.py --react` (legacy/live.js, legacy/test.js);
// it is served as legacy.js and runs before the React screens, which share its globals (S, render, GSTAPI, ...).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { execSync } from "node:child_process";
import crypto from "node:crypto";

// Sentry (docs/sentry.md): error reports from the test build only, unless built with FINCOM_SENTRY=off; a live build never
// carries src/sentry.js, and its page may not reach Sentry's address
const SENTRY_INGEST = "https://o4512221111320576.ingest.us.sentry.io";
const sentryOn = (mode) => mode === "test" && process.env.FINCOM_SENTRY !== "off";
const csp = (mode) => "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
  "connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* http://localhost:*" + (sentryOn(mode) ? " " + SENTRY_INGEST : "") + "; " +
  "worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

function legacy(mode) {
  const test = mode === "test", file = new URL("./legacy/" + (test ? "test" : "live") + ".js", import.meta.url);
  const read = () => {
    if (!fs.existsSync(file)) throw new Error("legacy/*.js missing: run `python3 build.py --react` in the repository first");
    return fs.readFileSync(file, "utf8");
  };
  return {
    name: "fincom-legacy",
    configureServer(server) {
      server.middlewares.use("/legacy.js", (_req, res) => { res.setHeader("Content-Type", "text/javascript"); res.end(read()); });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "legacy.js", source: read() });
      // go-bridge: FinCom Bridge 2.0 (Go) is handed out by the testing site only (assets-test/bridge-go); a live build
      // never carries it, so what live users download stays as it is
      const goDir = new URL("../assets-test/bridge-go/", import.meta.url);
      // 02-Oct-2026: and only when asked for (FINCOM_SHIP_BRIDGE=1), once a build has been tried on real Windows computers;
      // without it the Tally page says the new bridge is being tested
      if (test && process.env.FINCOM_SHIP_BRIDGE === "1" && fs.existsSync(goDir)) for (const f of fs.readdirSync(goDir)) this.emitFile({ type: "asset", fileName: "assets/bridge-go/" + f, source: fs.readFileSync(new URL(f, goDir)) });
    },
    transformIndexHtml(html) {
      // review of 01-Oct-2026: legacy.js has no hash in its name, so a browser kept an older copy after a new build (the
      // Pages cache, or a tab left open) and ran old code under the new screens. Its address now changes with its content
      if (fs.existsSync(file)) html = html.replace('src="./legacy.js"', 'src="./legacy.js?v=' + crypto.createHash("sha256").update(read()).digest("hex").slice(0, 12) + '"');
      html = html.replace("</head>", '<meta http-equiv="Content-Security-Policy" content="' + csp(mode) + '">\n</head>');
      if (test) html = html.replace("</head>", fs.readFileSync(new URL("./legacy/test-style.html", import.meta.url), "utf8") + "</head>").replace("<body>", '<body class="is-test">');
      // a named preview (publish-preview.sh review "REVIEW BUILD – Phase 1"): its own words on the strip and under the logo
      const banner = test && String(process.env.FINCOM_BANNER || "").replace(/["\\<>]/g, "");
      if (banner) html = html.replace("</head>", '<style>body.is-test::after{content:"' + banner + ' · staging database · not for real client work";background:#6B3FA0}.is-test .side-brand::after{content:"' + banner + '";color:#C9A8F0}</style>\n</head>');
      return html;
    },
  };
}

// which React build is open: the time it was built (India time) and the commit, shown at the foot of the sidebar
const sha = () => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch (e) { return ""; } };
const stamp = () => {
  const s = sha();
  // the app's one date format (review item 31): 01-Oct-2026 00:04, India time
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return "React · " + p.day + "-" + p.month.slice(0, 3) + "-" + p.year + " " + p.hour + ":" + p.minute + (s ? " · " + s : "");
};

// review of 01-Oct-2026: a republished site was not picked up until a hard refresh. Each build has an id; build.json says
// which build is current (fetched without the cache by src/fresh.js), and index.html asks not to be cached
const BUILD_ID = Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
function fresh() {
  return {
    name: "fincom-fresh",
    generateBundle() { this.emitFile({ type: "asset", fileName: "build.json", source: JSON.stringify({ build: BUILD_ID, stamp: stamp() }) }); },
    transformIndexHtml(html) {
      return html.replace("<head>", '<head>\n<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n<meta http-equiv="Pragma" content="no-cache">\n<meta http-equiv="Expires" content="0">');
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  define: { __REACT_BUILD__: JSON.stringify(stamp()), __BUILD_ID__: JSON.stringify(BUILD_ID),
    __FINCOM_SENTRY__: JSON.stringify(sentryOn(mode)), __SENTRY_RELEASE__: JSON.stringify("fincom-app-" + (sha() || BUILD_ID)) },
  plugins: [react(), legacy(mode), fresh()],
  build: { outDir: mode === "test" ? "dist-test" : "dist", emptyOutDir: true },
}));
