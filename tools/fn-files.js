#!/usr/bin/env node
// Deploy an edge function as uploaded files taken from one commit (no raw.githubusercontent.com import).
// See tools/deploy-fn-files.md. Node 18+, git; reads only the git objects of the commit (not the working tree).
//
//   node tools/fn-files.js list    <fn> [--sha S]            files (relative imports followed), git blob and sha256
//   node tools/fn-files.js payload <fn> [--sha S] [--out F]  JSON for the Supabase MCP deploy_edge_function call
//   node tools/fn-files.js deploy  <fn> [--sha S]            Management API deploy (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF)
//   node tools/fn-files.js verify  <fn> <readback.json>      sha256 of each file in a get_edge_function read-back vs git
//
// The function's settings (commit, entry module, verify_jwt) are in tools/fn-files.json; --sha overrides the commit.
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { maxBuffer: 1 << 28 });
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const CODE = /\.(m?[jt]sx?)$/;

function conf(fn, over) {
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/fn-files.json"), "utf8"));
  const c = all[fn];
  if (!c) throw new Error(`${fn} is not in tools/fn-files.json`);
  return { ...c, sha: over || c.sha };
}

// the path in the commit, with symbolic links (e.g. server/security/functions/_shared) followed
function real(sha, p) {
  const parts = p.split("/");
  let cur = "";
  for (const part of parts) {
    cur = cur ? cur + "/" + part : part;
    const row = git("ls-tree", sha, "--", cur).toString().trim();
    if (row.startsWith("120000")) cur = path.posix.normalize(path.posix.join(path.posix.dirname(cur), git("show", `${sha}:${cur}`).toString()));
  }
  return cur;
}

// every file the entry module reaches by relative import (static, export-from, literal dynamic import, new URL(..., import.meta.url))
function collect(sha, entry) {
  const seen = new Map(), external = new Set();
  const visit = (p) => {
    if (seen.has(p)) return;
    const rp = real(sha, p);
    const buf = git("show", `${sha}:${rp}`);
    seen.set(p, { name: p, blob: git("rev-parse", `${sha}:${rp}`).toString().trim(), sha256: sha256(buf), content: buf });
    if (!CODE.test(p)) return;
    const src = buf.toString("utf8"), specs = [];
    for (const re of [
      /(?:^|[^\w$.])(?:import|export)\s*(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g,
      /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
      /new\s+URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url/g,
    ]) for (const m of src.matchAll(re)) specs.push(m[1]);
    if (/import\s*\(\s*[^"'`\s)]/.test(src)) throw new Error(`${p}: an import() of a computed name; list its files by hand`);
    for (const s of specs) {
      if (s.startsWith("./") || s.startsWith("../")) visit(path.posix.normalize(path.posix.join(path.posix.dirname(p), s)));
      else if (/^https?:/.test(s) && /raw\.githubusercontent\.com/.test(s)) throw new Error(`${p} imports ${s}`);
      else if (/^[a-z]+:/.test(s)) external.add(s);   // npm:, jsr:, https: (fetched and bundled by Supabase at deploy)
    }
  };
  visit(entry);
  return { files: [...seen.values()], external: [...external].sort() };
}

// the root index.ts: imports the entry module by a relative path, as the old one-line raw import did
function wrapper(fn, c) {
  const head = `// ${fn}: uploaded files from commit ${c.sha} (tools/fn-files.js payload ${fn}); nothing is fetched from GitHub.\n`;
  return head + (c.call ? `import { main } from "./${c.entry}"; main();\n` : `import "./${c.entry}";\n`);
}

function build(fn, over) {
  const c = conf(fn, over);
  git("cat-file", "-e", `${c.sha}^{commit}`);
  const { files, external } = collect(c.sha, c.entry);
  if (files.some((f) => f.name === "index.ts")) throw new Error("a file of the function is named index.ts at the top");
  const idx = Buffer.from(wrapper(fn, c));
  return { c, external, files: [{ name: "index.ts", blob: "(made here)", sha256: sha256(idx), content: idx }, ...files] };
}

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const [cmd, fn, extra] = process.argv.slice(2);
  if (!cmd || !fn) { console.error(fs.readFileSync(__filename, "utf8").split("\n").slice(2, 10).join("\n")); process.exit(2); }
  const b = build(fn, arg("--sha"));
  if (cmd === "list") {
    console.log(`${fn} @ ${b.c.sha}  entry ${b.c.entry}  verify_jwt ${b.c.verify_jwt}`);
    for (const f of b.files) console.log(`  ${f.sha256}  ${f.blob}  ${String(f.content.length).padStart(7)}  ${f.name}`);
    console.log("  remote (bundled at deploy): " + (b.external.join(" ") || "none"));
  } else if (cmd === "payload") {
    const out = { name: fn, entrypoint_path: "index.ts", verify_jwt: b.c.verify_jwt, files: b.files.map((f) => ({ name: f.name, content: f.content.toString("utf8") })) };
    const o = arg("--out");
    if (o) { fs.writeFileSync(o, JSON.stringify(out)); console.error(`wrote ${o} (${b.files.length} files)`); } else process.stdout.write(JSON.stringify(out));
  } else if (cmd === "deploy") {
    const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
    if (!token || !ref) throw new Error("set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF");
    const form = new FormData();
    form.append("metadata", JSON.stringify({ name: fn, entrypoint_path: "index.ts", verify_jwt: b.c.verify_jwt }));
    for (const f of b.files) form.append("file", new Blob([f.content]), f.name);
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(fn)}`, { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
    const t = await r.text();
    console.log(r.status, t);
    if (!r.ok) process.exit(1);
  } else if (cmd === "verify") {
    if (!extra) throw new Error("give the read-back JSON file");
    const back = JSON.parse(fs.readFileSync(extra, "utf8"));
    const got = new Map((back.files || []).map((f) => [String(f.name).replace(/^(\/tmp\/[^/]+\/source\/)/, ""), sha256(Buffer.from(f.content, "utf8"))]));
    let bad = 0;
    for (const f of b.files) {
      const g = got.get(f.name);
      const ok = g === f.sha256;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "DIFF"} ${f.name}${ok ? "" : "  want " + f.sha256 + " got " + (g || "(missing)")}`);
      got.delete(f.name);
    }
    for (const k of got.keys()) { bad++; console.log(`EXTRA ${k}`); }
    for (const f of back.files || []) if (/["'`]https?:\/\/raw\.githubusercontent\.com\//.test(f.content)) { bad++; console.log(`RAW-IMPORT in ${f.name}`); }
    process.exit(bad ? 1 : 0);
  } else throw new Error("unknown command " + cmd);
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
