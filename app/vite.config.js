// FinCom React app. `npm run build` → dist/ (live), `npm run build:test` → dist-test/ (the testing site, staging database).
// The business logic is the program built from ../src/js by `python3 build.py --react` (legacy/live.js, legacy/test.js);
// it is served as legacy.js and runs before the React screens, which share its globals (S, render, GSTAPI, ...).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { execSync } from "node:child_process";

const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
  "connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* http://localhost:*; " +
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
    generateBundle() { this.emitFile({ type: "asset", fileName: "legacy.js", source: read() }); },
    transformIndexHtml(html) {
      html = html.replace("</head>", '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n</head>');
      if (test) html = html.replace("</head>", fs.readFileSync(new URL("./legacy/test-style.html", import.meta.url), "utf8") + "</head>").replace("<body>", '<body class="is-test">');
      return html;
    },
  };
}

// which React build is open: the time it was built (India time) and the commit, shown at the foot of the sidebar
const stamp = () => {
  let sha = ""; try { sha = execSync("git rev-parse --short HEAD").toString().trim(); } catch (e) {}
  return "React · " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + (sha ? " · " + sha : "");
};

export default defineConfig(({ mode }) => ({
  base: "./",
  define: { __REACT_BUILD__: JSON.stringify(stamp()) },
  plugins: [react(), legacy(mode)],
  build: { outDir: mode === "test" ? "dist-test" : "dist", emptyOutDir: true },
}));
