// node tests/run_gst_share_same.js - next-gst-share part B (review of 8ba35788d, L6): the browser's outputs of the GSTR-3B
// engine are byte for byte those of the base, on made-up books. The base's server/_shared/gst3b.js (with names.js,
// gst3bprint.js and gst-run's engine.js) is taken from git (GST_SAME_BASE, default origin/staging-next) into
// tests/out/same-base/ and both run side by side on the same rows: tests/gst_cloud_world.js's client (with and without
// the inward cases of tests/gst_itc_world.js, and a larger one), its 2Bs and gst-2b-match's AI pair:
//   step() every month, for registration 07 and for all (""): every box kept (the engine's own hash and source left out)
//   on the books step makes, inside one drawing: GSTR.threeB (the whole object, its lists too) and threeBm of every month,
//   GSTR.one (GSTR-1), GSTR.inward / outward, GST2B.bookDocs with skipped, GST2B.run, GSTF.bills and rule37,
//   GSTRev.turnoverNow / common / month
// Made-up names only; nothing real is read.
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const {world} = require("./gst_cloud_world");
const {itc} = require("./gst_itc_world");
const ROOT = path.join(__dirname, ".."), BASE = process.env.GST_SAME_BASE || "origin/staging-next";
const DIR = path.join(__dirname, "out", "same-base");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const app = load(HTML, ["BookItems", "GST2B"]), {x} = app;
const items = (work) => [...x.BookItems.split(JSON.parse(JSON.stringify(work))).values()].map((r) => ({key: r.k, item: r.i, ord: r.o == null ? null : r.o, data: r.d, deleted: false}));
// the base's files, as git has them
["server/_shared/gst3b.js", "server/_shared/names.js", "server/_shared/gst3bprint.js", "server/gst-run/engine.js"].forEach((f) => {
  const out = path.join(DIR, f); fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, cp.execFileSync("git", ["show", BASE + ":" + f], {cwd: ROOT, maxBuffer: 64 << 20}));
});
fs.writeFileSync(path.join(DIR, "package.json"), JSON.stringify({type: "module"}));
const strip = (o) => JSON.stringify(o, (k, v) => (k === "engine" || k === "src" || typeof v === "function") ? undefined : v);

(async () => {
  const mods = {};
  for (const [k, root] of [["base", DIR], ["head", ROOT]]) mods[k] = {eng: await import(path.join(root, "server", "gst-run", "engine.js")), E: await import(path.join(root, "server", "_shared", "gst3b.js"))};
  console.log("  (base: " + BASE + " " + cp.execFileSync("git", ["rev-parse", "--short", BASE], {cwd: ROOT}).toString().trim() + ")");
  const rowsOf = (seed, scale, withItc) => {
    const w = world({seed, scale}); if (withItc) itc(w);
    const twoBs = {};
    w.portal.forEach((j) => { const t = x.GST2B.fromJson(j); twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "upload"}); });
    const work = Object.assign({}, w.work, {twoBs});
    const nov = twoBs[w.OWN + "|112025"].rows.find((r) => r.no === "AS/1102/25-26");
    const runs = {[w.OWN + "|2025-26"]: {id: 41, status: "done", at: "2025-12-14T06:00:00Z", result: {rows: [{id: "ai1", st: "matched-ai", g: [nov.key], b: [w.aiBill.guid], why: ["made-up"]}]}, decisions: {}}};
    return {client: "cli-same", co: w.co, book: w.book, heads: w.heads, lines: w.lines, bills: w.bills, ledgers: w.ledgers, groups: w.groups, items: items(work), sales: w.sales, runs, OWN: w.OWN};
  };
  // the browser's calls inside one drawing (perRender), on the books step makes, the year's 2B matching in M2B.st
  const calls = (M, rows, reg) => {
    const {eng, E} = M, was = {S: globalThis.S, CO: globalThis.CO, perRender: globalThis.perRender};
    try {
      const S = {books: null, coId: rows.client, companies: {[rows.client]: Object.assign({}, rows.co, {id: rows.client})}, sales: {cid: rows.client, list: rows.sales}, gstYm: "202603"};
      globalThis.S = S; globalThis.CO = (c) => S.companies[c || S.coId];
      const b = eng.books(rows); S.books = b;
      E.GSTR._carry = null; E.GST2B._memo = null; E.GSTAdv._memo = null; E.GSTF._bills = null; E.GSTF._owe = null; E.M2B.st = {};
      E.M2B.st[E.M2B.key(reg, "2025-26")] = {run: rows.runs[rows.OWN + "|2025-26"]};
      const memo = new WeakMap();
      globalThis.perRender = (obj, key, fn) => { let m = memo.get(obj); if (!m) memo.set(obj, m = new Map()); if (m.has(key)) return m.get(key); const v = fn(); m.set(key, v); return v; };
      const o = {};
      E.GSTR.months().forEach((m) => { o[m] = {t: E.GSTR.threeB(m, reg), tm: E.GSTR.threeBm(m, reg), one: E.GSTR.one(m, reg), inward: E.GSTR.inward(m, reg), outward: E.GSTR.outward(m, reg),
        to: E.GSTRev.turnoverNow(m, reg), common: E.GSTRev.common(m, reg), rev: E.GSTRev.month(m, reg), r37: E.GSTF.rule37(m, reg)}; });
      o.docs = E.GST2B.bookDocs(); o.skipped = E.GST2B.skipped; o.run = E.GST2B.run(reg); o.bills = E.GSTF.bills(reg).map((z) => Object.assign({}, z, {v: z.v && z.v.id}));
      return strip(o);
    } finally { Object.assign(globalThis, was); Object.keys(was).forEach((k) => { if (was[k] === undefined) delete globalThis[k]; }); }
  };
  for (const [label, seed, scale, withItc] of [["the made-up client", 153, 0, false], ["with the inward cases of part B", 171, 0, true], ["a larger one (scale 30)", 183, 30, true]]) {
    const rows = rowsOf(seed, scale, withItc);
    for (const reg of ["07", ""]) {
      const a = strip(mods.base.eng.step(rows, reg, {}, {max: 99, ready: 1e15, total: 1e15}).months), c = strip(mods.head.eng.step(rows, reg, {}, {max: 99, ready: 1e15, total: 1e15}).months);
      ok(a === c && a.length > 1000, label + ", registration " + (reg || "all") + ": step() of every month, every box the base's (" + a.length + " characters)");
      const p = calls(mods.base, rows, reg), q = calls(mods.head, rows, reg);
      let i = 0; if (p !== q) while (p[i] === q[i]) i++;
      ok(p === q, label + ", registration " + (reg || "all") + ": threeB / threeBm (whole objects), GSTR-1, inward, outward, bookDocs and skipped, the 2B run, bills, rule 37, turnover, common credit, rules 42 and 43 the base's (" + p.length + " characters)"
        + (p === q ? "" : " - first difference at " + i + ": " + p.slice(Math.max(0, i - 80), i + 60) + " / " + q.slice(Math.max(0, i - 80), i + 60)));
    }
  }
  console.log(fails ? fails + " FAILED" : "all ok");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
