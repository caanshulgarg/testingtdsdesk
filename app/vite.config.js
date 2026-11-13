// FinCom React app. `npm run build` → dist/ (live), `npm run build:test` → dist-test/ (the testing site, staging database).
// The business logic is the program built from ../src/js by `python3 build.py --react` (legacy/live.js, legacy/test.js);
// it is served as legacy.js and runs before the React screens, which share its globals (S, render, GSTAPI, ...).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { transform as esbuildTransform, build as esbuildBuild } from "esbuild";

// Arc UI (src/arc, copied from github.com/kuratlielia/arc-library; see src/arc/README.md). Its files import each other
// as "@/lib/…" and "@/registry/…", so "@" is src/arc. "motion/react" is FinCom's calm version of Motion
// (src/arc/lib/calm-motion.js): every Arc component takes its reduced-motion path, short fades and no travel.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const alias = [
  { find: /^@\//, replacement: here("./src/arc/") },
  { find: /^motion\/react$/, replacement: here("./src/arc/lib/calm-motion.js") },
];

// Sentry (docs/sentry.md): error reports from the test build only, unless built with FINCOM_SENTRY=off; a live build never
// carries src/sentry.js, and its page may not reach Sentry's address
const SENTRY_INGEST = "https://o4512221111320576.ingest.us.sentry.io";
const sentryOn = (mode) => mode === "test" && process.env.FINCOM_SENTRY !== "off";
// stability batch 2: no font from Google (the IBM Plex link was never used), so neither its host is allowed
// the bot check on the sign-in page (src/lib/bot.jsx, 26-Oct-2026): Cloudflare Turnstile's public site key, from
// FINCOM_TURNSTILE_SITE_KEY or app/turnstile.json ({"test": "<key>", "live": "<key>"}). Empty: no widget, nothing of it in
// the build, and Cloudflare's address stays out of the CSP (the page as before)
const turnstileKey = (mode) => {
  if (process.env.FINCOM_TURNSTILE_SITE_KEY !== undefined) return process.env.FINCOM_TURNSTILE_SITE_KEY.trim();
  try { return String(JSON.parse(fs.readFileSync(new URL("./turnstile.json", import.meta.url), "utf8"))[mode === "test" ? "test" : "live"] || "").trim(); } catch (e) { return ""; }
};
const TURNSTILE = "https://challenges.cloudflare.com";
// FinCom's console (console phase 1b): the address the Settings link for FinCom's own people opens, from
// FINCOM_CONSOLE_URL or app/console.json ({"test": "https://console-staging.fincom.live", "live": "https://console.fincom.live"})
const consoleUrl = (mode) => {
  if (process.env.FINCOM_CONSOLE_URL) return process.env.FINCOM_CONSOLE_URL.trim();
  try { return String(JSON.parse(fs.readFileSync(new URL("./console.json", import.meta.url), "utf8"))[mode === "test" ? "test" : "live"] || "").trim(); } catch (e) { return ""; }
};
const csp = (mode, hashes = "") => "default-src 'self'; script-src 'self'" + hashes + (turnstileKey(mode) ? " " + TURNSTILE : "") + " 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
  "connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* http://localhost:*" + (sentryOn(mode) ? " " + SENTRY_INGEST : "") + "; " +
  "worker-src 'self' blob:; frame-src 'self' blob:" + (turnstileKey(mode) ? " " + TURNSTILE : "") + "; object-src 'none'; base-uri 'self'; form-action 'self'";

// 17-Oct-2026 (Mac Safari stuck on "Opening FinCom"): the code is written down to what Safari 14 and Chrome 87 read
// (esbuild rewrites newer syntax); newer helpers come from public/guard.js. public/oldcheck.js tells older browsers
const TARGET = ["es2020", "safari14", "chrome87", "firefox78", "edge88"];

// next-speed-worker (owner-approved): the engine's worker (engine/worker.js: the page's own legacy.js, read in the worker,
// with the React app's GST wraps and the MIS screen's file), one file of its own, assets/engine-<hash>.js, kept out of
// legacy.js and the first file (tests/run_legacy_room.py) and fetched only when a run first needs it. legacy.js gets its
// address in place of its mark (src/js/06-audit.js Engine.URL), and legacy.js?v= is worked out from both, so a new
// engine is a new legacy.js address too
const ENGINE_MARK = '"__FINCOM_ENGINE__"';
let engineP = null;
function engine() {
  return engineP || (engineP = esbuildBuild({
    entryPoints: [here("./engine/worker.js")], bundle: true, write: false, format: "iife", target: TARGET, minify: true, charset: "utf8", legalComments: "none",
    // the page's alone, not in the worker: the GSTR-1 file's upload part (never fetched there), and the MIS screen's pack
    // and Excel (put on globalThis by the MIS screen's own file; left out here, so only that file has them)
    plugins: [{ name: "engine-page-only", setup(b) {
      b.onResolve({ filter: /gzUpload\.js$/ }, () => ({ path: "./gzUpload.js", external: true }));
      b.onLoad({ filter: /18-mis-pack\.js$/ }, (a) => {
        const src = fs.readFileSync(a.path, "utf8"), out = src.replace(/^if \(typeof (misPackHtml|misExcel) !== "undefined"\) globalThis\.\1 = \1;$/gm, "");
        if (src.length - out.length < 40) throw new Error("18-mis-pack.js: its globalThis.misPackHtml / misExcel lines not found for the engine's worker");
        return { contents: out, loader: "js" };
      });
    } }],
  }).then((r) => { const code = r.outputFiles[0].text; return { code, file: "assets/engine-" + crypto.createHash("sha256").update(code).digest("hex").slice(0, 10) + ".js" }; }));
}
const withEngine = (src, file) => {
  if (src.split(ENGINE_MARK).length !== 2) throw new Error("legacy.js must hold the engine's mark " + ENGINE_MARK + " once (src/js/06-audit.js Engine.URL)");
  return src.replace(ENGINE_MARK, JSON.stringify("./" + file));
};
async function legacyV(src) { const e = await engine(); return crypto.createHash("sha256").update(src + "\n" + e.file).digest("hex").slice(0, 12); }

function legacy(mode) {
  const test = mode === "test", file = new URL("./legacy/" + (test ? "test" : "live") + ".js", import.meta.url);
  const read = () => {
    if (!fs.existsSync(file)) throw new Error("legacy/*.js missing: run `python3 build.py --react` in the repository first");
    return fs.readFileSync(file, "utf8");
  };
  return {
    name: "fincom-legacy",
    configureServer(server) {
      server.middlewares.use("/legacy.js", (_req, res) => { engine().then((e) => { res.setHeader("Content-Type", "text/javascript"); res.end(withEngine(read(), e.file)); }); });
      server.middlewares.use("/assets/engine-", (_req, res) => { engine().then((e) => { res.setHeader("Content-Type", "text/javascript"); res.end(e.code); }); });
    },
    async generateBundle() {
      // stability batch 2: the program minified (2.5 MB -> about a third less to send and to read), with its source map
      // for error reports (src/sentry.js). Only whitespace, syntax and the names inside functions change: the program's
      // own top-level names (S, render, GSTAPI, …), which the React screens and the tests use, stay as they are
      // (esbuild keeps a classic script's top-level names), and so does every string (publish-preview.sh's database check)
      const eng = await engine();
      this.emitFile({ type: "asset", fileName: eng.file, source: eng.code });
      const src = withEngine(read(), eng.file);
      const out = await esbuildTransform(src, { minify: true, sourcemap: "external", sourcefile: "legacy.src.js", charset: "utf8", legalComments: "inline", target: TARGET });
      this.emitFile({ type: "asset", fileName: "legacy.js", source: out.code + "//# sourceMappingURL=legacy.js.map\n" });
      this.emitFile({ type: "asset", fileName: "legacy.js.map", source: out.map });
      // go-bridge: FinCom Bridge 2.0 (Go) is handed out by the testing site only (assets-test/bridge-go); a live build
      // never carries it, so what live users download stays as it is
      const goDir = new URL("../assets-test/bridge-go/", import.meta.url);
      // 02-Oct-2026: and only when asked for (FINCOM_SHIP_BRIDGE=1), once a build has been tried on real Windows computers;
      // without it the Tally page says the new bridge is being tested
      if (test && process.env.FINCOM_SHIP_BRIDGE === "1" && fs.existsSync(goDir)) for (const f of fs.readdirSync(goDir)) this.emitFile({ type: "asset", fileName: "assets/bridge-go/" + f, source: fs.readFileSync(new URL(f, goDir)) });
    },
    async transformIndexHtml(html) {
      // review of 01-Oct-2026: legacy.js has no hash in its name, so a browser kept an older copy after a new build (the
      // Pages cache, or a tab left open) and ran old code under the new screens. Its address now changes with its content
      if (fs.existsSync(file)) {
        const v = await legacyV(read());
        html = html.replace('src="./legacy.js"', 'src="./legacy.js?v=' + v + '"');
        // stability batch 2: fetched from the start (it was found only when the page's end was read: 2.1 s on an office PC)
        // speed round (27-Oct-2026): not "low" any more: the program is on the first page's critical path (the app's entry
        // waits for it), and at low priority it came after the fonts and styles
        html = html.replace("<!--fincom-preload-->", '<link rel="preload" as="script" href="./legacy.js?v=' + v + '">');
      }
      // the frame drawn before the program loads (index.html, stability batch 1): its little script gets this build's
      // storage prefix (the test build keeps its own, tdsdesk-test:) and id, and is allowed by its hash, the one inline script
      html = html.replace("__FINCOM_LS__", test ? "tdsdesk-test:" : "tdsdesk:").replaceAll("__FINCOM_BUILD__", BUILD_ID);
      // the page's own healer (index.html, fincom-heal) reports by its own beacon, on the testing site only
      html = html.replace("__FINCOM_REPORT__", sentryOn(mode) ? SENTRY_INGEST + "/api/4512221234724864/store/?sentry_version=7&sentry_key=7f2432ad2a6406244d931f4856c30933" : "");
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => !/type="module"/.test(m[0]))
        .map((m) => " 'sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64") + "'").join("");
      html = html.replace("</head>", '<meta http-equiv="Content-Security-Policy" content="' + csp(mode, hashes) + '">\n</head>');
      // the "FinCom did not open" note (public/oldcheck.js) reports the browser on the testing site only
      if (sentryOn(mode)) html = html.replace('<script src="./oldcheck.js"></script>', '<script src="./oldcheck.js" data-report="' + SENTRY_INGEST + '/api/4512221234724864/store/?sentry_version=7&amp;sentry_key=7f2432ad2a6406244d931f4856c30933"></script>');
      if (test) html = html.replace("</head>", fs.readFileSync(new URL("./legacy/test-style.html", import.meta.url), "utf8") + "</head>").replace("<body>", '<body class="is-test">');
      // a named preview (publish-preview.sh review "REVIEW BUILD – Phase 1"): its own words on the strip and under the logo
      const banner = test && String(process.env.FINCOM_BANNER || "").replace(/["\\<>]/g, "");
      if (banner) html = html.replace("</head>", '<style>body.is-test::after{content:"' + banner + ' · staging database · not for real client work";background:#6B3FA0}.is-test .side-brand::after{content:"' + banner + '";color:#C9A8F0}</style>\n</head>');
      // the trial address (docs/RELEASE-FLOW.md): the same files at staging.fincom.live/next/ say TRIAL (index.html marks
      // a page served from /next/ with data-trial), so promote-next.sh can copy them to review/ unchanged
      if (test) html = html.replace("</head>", '<style>html[data-trial] body.is-test::after{content:"TRIAL' + (banner ? " · " + banner : "") + ' · a new build on trial · staging database · not for real client work";background:#B42318}html[data-trial] .is-test .side-brand::after{content:"TRIAL";color:#F97066}html[data-trial] .is-test header.top{box-shadow:inset 0 3px 0 #B42318}</style>\n</head>');
      return html;
    },
  };
}

// stability batch 2: the two faces of the first screen (Inter for the text, Geist for headings and figures, latin) are
// fetched from the start, so the headings do not change typeface after they appear (fonts.css has the ₹ sign inline)
function preloadFonts() {
  return {
    name: "fincom-preload-fonts",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx || !ctx.bundle) return html;
        const want = [/^assets\/inter-latin-wght-normal-[\w-]+\.woff2$/, /^assets\/geist-latin-wght-normal-[\w-]+\.woff2$/];
        const files = Object.keys(ctx.bundle).filter((f) => want.some((r) => r.test(f)));
        const links = files.map((f) => '<link rel="preload" as="font" type="font/woff2" crossorigin href="./' + f + '">').join("\n");
        html = html.replace("</head>", links + "\n</head>");
        // round 73 B: legacy.js is deferred, and deferred scripts run in the page's order, so the app's entry (which Vite
        // puts in <head>) goes right after it, as before: the program first, then the React screens. It is still fetched
        // from the start (modulepreload in <head>)
        const entry = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>\n?/);
        const leg = html.match(/<script defer src="\.\/legacy\.js[^"]*"><\/script>/);
        if (entry && leg && html.indexOf(entry[0]) < html.indexOf(leg[0])) {
          html = html.replace(entry[0], '<link rel="modulepreload" crossorigin href="' + entry[1] + '">\n');
          html = html.replace(leg[0], leg[0] + "\n" + entry[0].trim());
        }
        return html;
      },
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

// stability batch 4: the service worker (sw/sw.js), with this build's id and the files of its first open: the page, the
// program (legacy.js?v=…), the app's scripts, styles and fonts (not the source maps, not the downloads). Round 73 B: in two
// parts. SHELL, kept when the worker is installed: what the first page needs (the page, the two little scripts, the
// program, the app's entry with what it imports at once and its styles, the two faces preloaded); REST, the other screens'
// files, the OCR and spreadsheet engines and the other fonts, kept once the first page is up and the computer is idle
// (the page asks: main.jsx, "fincom:keep-rest")
function serviceWorker(mode) {
  const legacyFile = new URL("./legacy/" + (mode === "test" ? "test" : "live") + ".js", import.meta.url);
  return {
    name: "fincom-sw",
    // written once the files are on disk (Vite drops a CSS-only chunk after generateBundle): only files that are there
    async writeBundle(o, bundle) {
      const v = fs.existsSync(legacyFile) ? await legacyV(fs.readFileSync(legacyFile, "utf8")) : "";
      // calls (stage 1, 23-Oct-2026): the call screen's files are fetched only when a call is opened, never kept ahead
      const all = Object.keys(bundle).filter((f) => fs.existsSync(o.dir + "/" + f)).filter((f) => (/^assets\/.*\.(js|css)$/.test(f) || /^assets\/(inter|geist)-latin(-ext)?-wght-normal-[\w-]+\.woff2$/.test(f)) && !/^assets\/bridge-go\//.test(f)
        && !/^assets\/(CallScreen|CallMenu|guest|calls)-[\w-]+\.(js|css)$/.test(f));
      // the entry chunk and what it imports at once (not import()), with their styles
      const first = new Set(), walk = (f) => {
        const c = bundle[f]; if (!c || first.has(f)) return; first.add(f);
        ((c.viteMetadata && c.viteMetadata.importedCss) || []).forEach((x) => first.add(x));
        (c.imports || []).forEach(walk);
      };
      Object.keys(bundle).filter((f) => bundle[f].type === "chunk" && bundle[f].isEntry).forEach(walk);
      const isShell = (f) => first.has(f) || /^assets\/(inter|geist)-latin-wght-normal-[\w-]+\.woff2$/.test(f);
      const shell = ["./", "./legacy.js?v=" + v, "./guard.js", "./oldcheck.js"].concat(all.filter(isShell).map((f) => "./" + f));
      const rest = all.filter((f) => !isShell(f)).map((f) => "./" + f);
      const src = fs.readFileSync(new URL("./sw/sw.js", import.meta.url), "utf8").replace("__SW_BUILD__", BUILD_ID).replace("__SW_FILES__", JSON.stringify(shell)).replace("__SW_REST__", JSON.stringify(rest));
      fs.writeFileSync(o.dir + "/sw.js", src);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  define: { __REACT_BUILD__: JSON.stringify(stamp()), __BUILD_ID__: JSON.stringify(BUILD_ID),
    __FINCOM_SENTRY__: JSON.stringify(sentryOn(mode)), __TURNSTILE_KEY__: JSON.stringify(turnstileKey(mode)), __CONSOLE_URL__: JSON.stringify(consoleUrl(mode) || "https://console.fincom.live"), __SENTRY_RELEASE__: JSON.stringify("fincom-app-" + (sha() || BUILD_ID)) },
  plugins: [react(), legacy(mode), fresh(), preloadFonts(), serviceWorker(mode)],
  resolve: { alias },
  build: { outDir: mode === "test" ? "dist-test" : "dist", emptyOutDir: true, target: TARGET },
}));
