// The phone app's copy of FinCom (branch next-mobile): the user app (../app) built for Capacitor.
//   node scripts/build-web.mjs              -> ../app/dist-mobile       (live database; the store build)
//   node scripts/build-web.mjs --staging    -> ../app/dist-mobile-test  (staging database; internal testers only)
//   --skip-legacy                           the program (app/legacy/*.js) is already built
// Steps: the program (python3 build.py --react, as for the web), then Vite with FINCOM_MOBILE=1 (app/vite.config.js,
// fincom-mobile: the relative base "./", src/lib/native.js and native-boot.js in, no service worker), then a check of
// what came out. `npm run sync` runs this and then `npx cap sync` (copies it into android/ and ios/).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", ".."), APP = path.join(ROOT, "app");
const staging = process.argv.includes("--staging");
const out = path.join(APP, staging ? "dist-mobile-test" : "dist-mobile");
const run = (cmd, args, cwd, env = {}) => { console.log("> " + cmd + " " + args.join(" ")); execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } }); };

if (!process.argv.includes("--skip-legacy")) run("python3", ["build.py", "--react"], ROOT);
if (!fs.existsSync(path.join(APP, "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund"], APP);
run("npx", ["vite", "build"].concat(staging ? ["--mode", "test"] : []), APP, { FINCOM_MOBILE: "1" });

// what the phone needs from the build, checked: the page starts through native-boot.js, its addresses are relative
// (the app's files are served from the phone itself), the viewport reaches under the notch, no service worker
const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
const bad = [];
if (!/<script src="\.\/native-boot\.js" data-legacy="\.\/legacy\.js\?v=[0-9a-f]+" data-entry="\.\/assets\/index-[\w-]+\.js"><\/script>/.test(html)) bad.push("the page does not start through native-boot.js");
if (/<script[^>]+src="\/(?!\/)/.test(html) || /href="\/(?!\/)/.test(html)) bad.push("an absolute address (/...) in the page: the base must be relative");
if (!/viewport-fit=cover/.test(html)) bad.push("no viewport-fit=cover");
if (fs.existsSync(path.join(out, "sw.js"))) bad.push("a service worker in the phone's copy");
if (!fs.existsSync(path.join(out, "native-boot.js")) || !fs.existsSync(path.join(out, "legacy.js"))) bad.push("native-boot.js or legacy.js missing");
const js = fs.readdirSync(path.join(out, "assets")).filter((f) => /^native-[\w-]+\.js$/.test(f));
if (!js.length) bad.push("src/lib/native.js is not in the build (its own file, assets/native-*.js)");
if (bad.length) { console.error("build-web: " + bad.join("; ")); process.exit(1); }
console.log("build-web: " + path.relative(ROOT, out) + " ready (" + (staging ? "staging" : "live") + " database)");
