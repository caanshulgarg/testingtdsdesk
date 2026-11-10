// node tests/run_gst_cloud.js - next-cloud-gst: a month's GSTR-3B worked out in the cloud (server/gst-run) is the app's,
// box for box, to the paisa. Made-up books only (tests/gst_cloud_world.js; nothing of a real client).
//   The app's side: the built test page (site-test/index.html, as tests/harness.js loads it), opened on the client as the
//     app opens one from the cloud (the work items put back by BookItems.put, the masters by TallyRead.balances,
//     BookSrc.ledgersInto and Tally's groups, the entries by BookSrc.apply, the ledger list by Books.mapLedgers and
//     LedMaster.refresh), with Asia/Kolkata's clock, and its 3B worked out month by month (GSTR.threeB) with the 2B
//     matching gst-2b-match kept in M2B.st, inside one drawing (the app's memoScope / perRender), as the 3B screen does.
//   The cloud's side: the gst-run function itself in Deno (tests/run_gst_cloud_deno.ts: server/gst-run/handler.ts with a
//     fake Supabase holding the same rows and migration 153's functions, UTC clock): a member's miss (queued, nothing
//     worked out), then the background runs one after another (a month or two each, from the credit kept for the month
//     before), then the member's months given back as kept; a change (a miss again); the switches, the keys, a failure.
//   Checks: each background run's CPU (the fake's own taken out) under 1 s and its memory under 256 MB, on the made-up
//     client and on a 40,000-entry book; the fingerprint of the inputs the same on both sides (and not when they differ);
//     every box of every month equal (3.1, 3.2, 4, 5, the payment and the credit carried in and out), and the whole
//     3B object equal; the months cover QRMP (a quarter's 3B, credit held through the quarter), rules 42 and 43, rule 37,
//     an amendment of an earlier month's GSTR-1, an advance (11A and 11B), the credit carried over at least 3 months,
//     2B held / released / rejected in IMS, a 3B kept as filed. tests/gst_cloud_rev.json: REV moves when gst-run's files do.
// DENO: the deno to run (else deno on the PATH, else .deno-scratch/package/deno in the worktree).
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const {world} = require("./gst_cloud_world");
const ROOT = path.join(__dirname, "..");
const DENO = process.env.DENO || (() => { try { cp.execFileSync("deno", ["--version"], {stdio: "ignore"}); return "deno"; } catch (e){ return path.join(ROOT, ".deno-scratch", "package", "deno"); } })();
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, {recursive: true});
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "MONTHS3", "toDateObj", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GSTV", "M2B", "Audit", "TDSTally", "TDS", "BookSrc", "BookItems", "BookSync", "BOOKS_KEYS", "clone", "TallyRead", "CO",
  "RENDER_GEN", "BOOKS_REV", "drawStamp", "REACT_SCOPE", "reactScopeEnd", "reactScope", "perRender", "memoScope"];
const REVF = path.join(__dirname, "gst_cloud_rev.json"), REV_FILES = ["server/_shared/gst3b.js", "server/_shared/names.js", "server/_shared/gst3bprint.js", "server/gst-run/engine.js", "server/gst-run/data.ts", "server/gst-run/handler.ts", "server/gst-run/index.ts", "server/gst-run/migration-153-gst-cloud.sql"];
function revSha(){ const h = require("crypto").createHash("sha256"); REV_FILES.forEach(f => h.update(f + "\n" + fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^export const REV = "[^"]*";$/m, "") + "\n")); return h.digest("hex"); }
const CLIENT = "cli-syn-153", FIRM = "f1530000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------- the app's side
const app = load(HTML, NAMES), {ctx, x} = app;
ctx.S.firm = {ledTpl: {}};            // the firm's ledger templates (LedMaster.tplFor): none
function items(work){ return [...x.BookItems.split(JSON.parse(JSON.stringify(work))).values()].map(r => ({key: r.k, item: r.i, ord: r.o == null ? null : r.o, data: r.d, deleted: false})); }
// the client opened from the cloud, as TCloud.load / BookItems.pull do it
function open(rows){
  const b = {cid: CLIENT, vouchers: []};
  ctx.S.books = b; ctx.S.coId = CLIENT; ctx.S.companies = {[CLIENT]: Object.assign({}, rows.co, {id: CLIENT})};
  ctx.S.sales = {cid: CLIENT, list: rows.sales.slice()};
  ctx.CO = (cid) => ctx.S.companies[cid || ctx.S.coId];
  x.BookItems.put(b, rows.items.filter(r => !r.deleted).map(r => ({k: r.key, i: r.item, o: r.ord, d: r.data})));
  x.TallyRead.balances(b, {ledgers: rows.ledgers.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, "20250401", "20260331"); b.tb.src = "copy";
  x.BookSrc.ledgersInto(b, rows.ledgers, rows.book.ledgers_at);
  b.groups = Object.assign({}, b.groups || {}); rows.groups.forEach(g => { b.groups[g.name] = g.parent || ""; }); x.TallyRead.yearOpen(b);
  x.BookSrc.apply(b, rows.heads, rows.lines, rows.bills);
  b.meta = Object.assign({}, b.meta || {}, {bills: 1, gstins: Array.from(new Set(b.vouchers.map(v => v.cmp).filter(Boolean))).sort()});
  b.map = x.Books.mapLedgers(b.vouchers || [], b.map); try { x.LedMaster.refresh(b); } catch (e){}
  ["_carry"].forEach(k => { x.GSTR[k] = null; }); x.GST2B._memo = null; x.GSTAdv._memo = null; x.GSTF._bills = null; x.GSTF._owe = null; x.M2B.st = {};
  return b;
}
// the 3B screen on a month: S.gstYm the month, the 2B matching of its year fetched into M2B.st; every month up to it
function app3b(rows, reg, ym){
  const b = open(rows); ctx.S.gstYm = ym;
  const gstin = x.GSTR.gstins(b).find(g => g.slice(0, 2) === reg) || "", fy = x.M2B.fyOf(ym), run = rows.runs[gstin + "|" + fy];
  if (run) x.M2B.st[x.M2B.key(reg, fy)] = {run};
  // one drawing of the screen: the app's own memo (perRender) for it, as render() and memoScope give it
  return x.memoScope(() => { const out = {};
    x.GSTR.months().filter(m => m <= ym).forEach(m => { out[m] = JSON.parse(JSON.stringify(x.GSTR.threeB(m, reg))); });
    return out; });
}

// ---------------------------------------------------------------- the made-up client, in the cloud's rows
function rowsOf(w){
  // its 2Bs, read by the app's own reader (as GST2B.fromJson keeps them)
  const twoBs = {};
  w.portal.forEach(j => { const t = x.GST2B.fromJson(j); twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "upload"}); });
  const work = Object.assign({}, w.work, {twoBs});
  // the AI's pair kept by gst-2b-match for the year (the bill whose number in Tally differs from 2B's)
  const nov = twoBs[w.OWN + "|112025"].rows.find(r => r.noN === "AS110225-26".replace(/[^A-Z0-9]/g, "") || r.no === "AS/1102/25-26");
  const runs = {[w.OWN + "|2025-26"]: {id: 41, status: "done", at: "2025-12-14T06:00:00Z", result: {rows: [{id: "ai1", st: "matched-ai", g: [nov.key], b: [w.aiBill.guid], why: ["the same bill: number written another way"]}]}, decisions: {}}};
  return {client: CLIENT, co: w.co, book: Object.assign({}, w.book, {firm_id: FIRM, client_id: CLIENT}), heads: w.heads, lines: w.lines, bills: w.bills, ledgers: w.ledgers, groups: w.groups,
    items: items(work), sales: w.sales, runs, work};
}
const W = world({seed: 153});
let rows = rowsOf(W);
// GSTR-1 for June brought in from the portal as filed, then the June invoice changed in Tally (a later AlterID): the
// difference goes as an amendment in July's GSTR-1 and is paid with July's 3B; and July's 3B kept as filed (GSTF snap)
{
  open(rows); ctx.S.gstYm = "202607";
  const j = x.GSTR.toJson("202506", "07", {plain: true}); x.GSTAmend.keep(JSON.parse(JSON.stringify(j)), "portal");
  const filed = JSON.parse(JSON.stringify(ctx.S.books.filed));
  const jul = x.GSTF.snapOf(x.GSTR.threeB("202507", "07"));
  const h = rows.heads.find(z => z.guid === W.juneInv.guid); h.alter_id = 999001;
  const ls = rows.lines.filter(l => l.guid === h.guid), up = 25000, t = 4500;
  ls.forEach(l => { if (l.ledger === "Sales - Goods") l.amount += up; if (l.ledger === "Output CGST" || l.ledger === "Output SGST") l.amount += t / 2; if (l.ledger === h.party) l.amount -= up + t; });
  rows.bills.filter(z => z.guid === h.guid).forEach(z => { z.amount -= up + t; });
  const work = Object.assign({}, rows.work, {filed, gstFiled: Object.assign({}, rows.work.gstFiled, {"07": Object.assign({}, rows.work.gstFiled["07"], {"202507": {snap: jul, r3b: "2025-08-20", r1: "2025-08-11"}, "202506": {r1: "2025-07-11"}})})});
  rows = Object.assign({}, rows, {items: items(work), work});
}
// an older book of the same client (the year before, the same entries a year earlier): its months are gst_calc_book's
// for 2024-25, and the background runs fill them too
const OLDBK = "bbbbbbbb-0153-4000-8000-000000000002";
function older(r){
  const y = d => d ? String(Number(String(d).slice(0, 4)) - 1) + String(d).slice(4) : d, g = id => "old-" + id;
  return Object.assign({}, r, {book: Object.assign({}, r.book, {book_id: OLDBK, from_date: "2024-04-01", open_as_on: "2024-04-01"}),
    heads: r.heads.map(h => Object.assign({}, h, {guid: g(h.guid), day: y(h.day), ref_date: y(h.ref_date), deleted_at: h.deleted_at ? y(h.deleted_at) : null})),
    lines: r.lines.map(l => Object.assign({}, l, {guid: g(l.guid)})), bills: r.bills.map(b => Object.assign({}, b, {guid: g(b.guid)}))});
}
const OLD = older(rows);
const ASKS = ["202504", "202505", "202506", "202507", "202508", "202509", "202510", "202511", "202512", "202601", "202602", "202603"].map(ym => ({reg: "07", ym}));

// ---------------------------------------------------------------- the cloud's side (Deno)
function deno(file, args){
  const r = cp.spawnSync(DENO, ["run", "--allow-all", "--v8-flags=--expose-gc", path.join(__dirname, "run_gst_cloud_deno.ts")].concat(args), {encoding: "utf8", env: Object.assign({}, process.env, {TZ: "UTC", DENO_DIR: path.join(ROOT, ".deno-scratch", "cache")}), maxBuffer: 1 << 30});
  if (r.status !== 0){ console.log(r.stdout, r.stderr); throw new Error("deno failed"); }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
const H = ["igst", "cgst", "sgst", "cess"], BOX = {
  "3.1(a) outward taxable": t => t.net, "3.1(b) zero rated": t => t.zero, "3.1(c) nil and exempt": t => t.nil, "3.1(d) reverse charge": t => t.rcmOut, "3.1(e) non-GST": t => t.nongst,
  "3.2 to unregistered": t => t.unregPos, "4(A)(1) import of goods": t => t.impGoods, "4(A)(2) import of services": t => t.impServ, "4(A)(3) reverse charge": t => t.rcmIn,
  "4(A)(5) all other ITC": t => t.other, "4(B)(1) reversed (rules 38, 42, 43, 17(5))": t => t.rev1, "4(B)(2) reversed, others": t => t.rev2, "4(C) net ITC": t => t.netItc,
  "4(D)(1) reclaimed": t => t.reclaim, "4(D)(2) not available": t => t.na, "5 inward with no tax": t => t.inw5, "6.1 paid by credit": t => t.pay.use, "6.1 paid in cash": t => t.pay.cash,
  "credit carried in": t => t.opening, "credit carried out": t => t.pay.carry, "payable": t => t.payable};
const near0 = o => !o || H.every(h => Math.abs(Number(o[h]) || 0) < 0.005);
(async () => {
  const eng = await import(path.join(ROOT, "server", "gst-run", "engine.js")), boxes = eng.boxes;
  const {gst3bPrint, gst3bSame} = await import(path.join(ROOT, "server", "_shared", "gst3bprint.js"));
  console.log("== 0. the engine's revision");
  const rec = (() => { try { return JSON.parse(fs.readFileSync(REVF, "utf8")); } catch (e){ return {}; } })(), sha = revSha();
  if (process.env.GST_REV_WRITE){ fs.writeFileSync(REVF, JSON.stringify({rev: eng.REV, sha}, null, 2) + "\n"); console.log("  (written: " + eng.REV + " " + sha + ")"); }
  else ok(rec.sha === sha && rec.rev === eng.REV, "gst-run's files are as REV " + eng.REV + " says (" + (rec.sha === sha ? "same" : "changed: move REV in server/gst-run/engine.js, then GST_REV_WRITE=1 node tests/run_gst_cloud.js") + ")");

  if (process.env.GST_ONLY_BIG) return big();
  console.log("== 1. the background runs (gst-run in Deno, UTC): a month or two each, CPU and memory");
  const file = path.join(OUT, "gst-cloud-rows.json"), res = path.join(OUT, "gst-cloud-res.json");
  fs.writeFileSync(file, JSON.stringify({rows, old: {book: OLD.book, heads: OLD.heads, lines: OLD.lines, bills: OLD.bills}, asks: ASKS, firm: FIRM}));
  const cloud = deno(res, [file, res]);
  ok(cloud.miss.ok && cloud.miss.pending && cloud.miss.result === null && cloud.miss.started === true && cloud.kicked === 1 && cloud.keptAtMiss === 0, "a member's miss: nothing worked out in the request, the client queued (gst_calc_want true) and a background run started");
  ok(cloud.limited && cloud.limited.idle, "the same client is not taken again while a run holds it or within 20 seconds of one (the queue's rate limit)");
  const R = cloud.runs.filter(r => r.months && r.months.length), KN = cloud.kept.filter(k => k.book === rows.book.book_id && !/\|all$/.test(k.args)), KO = cloud.kept.filter(k => k.book === OLDBK && !/\|all$/.test(k.args));
  ok(R.every(r => r.ok && r.months.length <= 2) && KN.length === 12 && KO.length === 12 && cloud.queueLeft === 0, R.length + " runs, at most 2 months each; every month kept on its own book (gst_calc_book): 12 on 2025-26's book, then 12 on the older 2024-25 book; the queue empty after: " + R.map(r => (r.book === OLDBK ? "old " : "") + r.months.join("+")).join(" "));
  const worst = Math.max(...R.map(r => r.cpu));
  ok(worst < 1000, "CPU per run (the fake database's own left out): " + R.map(r => r.cpu).join(", ") + " ms; the worst " + worst + " ms (target about 1 s; the limit 2 s)");
  const hp = Math.max(...R.map(r => r.heap)), lv0 = cloud.live || {};
  ok(hp < 128 && lv0.rowsAndBooks < 64, "memory: each run's heap in use at most " + hp + " MB, alive after a collection " + lv0.rowsAndBooks + " MB (limit 256 MB for the whole function; Deno with the fake database in it: " + cloud.peakRss + " MB)");

  console.log("== 2. every box of every month: the app (Node, Asia/Kolkata, the month on screen) and what gst-run kept");
  let boxN = 0, allSame = true, fpOk = true;
  const appBy = {};
  for (const a of ASKS){
    const mine = app3b(rows, a.reg, a.ym);
    appBy[a.ym] = mine[a.ym];
    const k = KN.find(z => z.args === "07|" + a.ym), g = k && k.result, m = boxes(mine[a.ym]);
    const bad = [];
    Object.entries(BOX).forEach(([n, f]) => { boxN++; if (!g || JSON.stringify(f(g)) !== JSON.stringify(f(m))) bad.push(n + ": cloud " + JSON.stringify(g && f(g)) + " app " + JSON.stringify(f(m))); });
    const same = g && JSON.stringify(Object.assign({}, g, {engine: undefined, fp: undefined})) === JSON.stringify(m);
    if (!same) allSame = false;
    ok(!bad.length && same, a.ym + (mine[a.ym].quarter ? " (quarter " + mine[a.ym].months.join(",") + ")" : "") + ": every box equal" + (bad.length ? "; " + bad.slice(0, 3).join("; ") : same ? "" : "; the boxes agree but the whole 3B differs"));
    // the app's own fingerprint of the books it has open, with the 2B run of the month's year it read
    const b = open(rows), run = rows.runs[W.OWN + "|" + x.M2B.fyOf(a.ym)], mineFp = gst3bPrint(b, ctx.S.sales.list, run ? run.id : "");
    if (!g || !gst3bSame(mineFp, g.fp)) { fpOk = false; console.log("    fp app ", JSON.stringify(mineFp), "\n    fp cloud", JSON.stringify(g && g.fp)); }
  }
  // the older book: each month as the app works it out with that book open and the month on screen
  let oldSame = 0; const oldBad = [];
  for (const m of ["202404", "202405", "202406", "202407", "202408", "202409", "202410", "202411", "202412", "202501", "202502", "202503"]){
    const mine = app3b(OLD, "07", m), k = KO.find(z => z.args === "07|" + m);
    if (k && JSON.stringify(Object.assign({}, k.result, {engine: undefined, fp: undefined})) === JSON.stringify(boxes(mine[m]))) oldSame++; else oldBad.push(m);
  }
  ok(oldSame === 12, "the older book's 12 months: the cloud's 3B is the app's, box for box (the whole 3B)" + (oldBad.length ? "; not: " + oldBad.join(", ") : ""));
  console.log("  (" + ASKS.length + " months, " + boxN + " boxes compared; the whole 3B object compared too: " + (allSame ? "equal" : "NOT equal") + ")");
  ok(fpOk, "the fingerprint of the inputs: the app's (made from its open books) and the cloud's the same for every month, nothing pending");
  { const r2 = JSON.parse(JSON.stringify(rows)); r2.heads.push(Object.assign({}, r2.heads[0], {guid: "syn-local-1", alter_id: 1000001})); r2.lines.push(Object.assign({}, r2.lines[0], {guid: "syn-local-1"}));
    const fpX = gst3bPrint(open(r2), ctx.S.sales.list, ""), k = KN[0].result.fp;
    const r3 = JSON.parse(JSON.stringify(rows)); r3.work.map["Input IGST"] = Object.assign({}, r3.work.map["Input IGST"], {byHand: false, ok: false}); r3.items = items(r3.work);
    const fpP = gst3bPrint(open(r3), ctx.S.sales.list, "");
    const r4 = JSON.parse(JSON.stringify(rows)); r4.work.gst3b["07|202509"] = {rev2: {igst: 1}}; r4.items = items(r4.work);
    const fpW = gst3bPrint(open(r4), ctx.S.sales.list, k.run);
    ok(!gst3bSame(fpX, k) && !gst3bSame(fpP, k) && fpP.pend > 0 && !gst3bSame(fpW, k), "and not the same when the app has an entry the cloud has not, a ledger whose kind is a guess (pending), or a figure typed only here");
  }

  console.log("== 3. what the months cover (on the app's figures)");
  const T = appBy, nz = o => !near0(o);
  ok(T["202603"].quarter && T["202603"].months.join() === "202601,202602,202603" && JSON.stringify(T["202602"].opening) === JSON.stringify(T["202601"].opening), "QRMP: January to March 2026 is one 3B at March; the credit carried in holds through the quarter");
  ok(nz(T["202603"].pmt), "QRMP: PMT-06 paid in January used first in the quarter's 3B");
  ok(["202506", "202507", "202508", "202509"].some(m => nz(T[m].r42)), "rule 42: common credit reversed on the exempt share");
  ok(["202506", "202507", "202508"].some(m => nz(T[m].r43)), "rule 43: the capital good in common use");
  ok(nz(T["202510"].r37 && T["202510"].r37.rev) && nz(T["202512"].r37 && T["202512"].r37.re), "rule 37: April's unpaid bill reversed in October, taken back in December");
  ok(T["202507"].amend.rows.length > 0 && nz(T["202507"].amend.out), "an amendment: June's invoice changed after its GSTR-1, the difference in July's 3.1(a)");
  ok(nz(T["202508"].adv) && nz(T["202510"].adv) && T["202508"].adv.igst > 0 && T["202510"].adv.igst < 0, "an advance: 11A in August, 11B in October");
  const carried = ASKS.map(a => a.ym).filter(m => !T[m].quarter && nz(T[m].opening) && nz(T[m].pay.carry));
  let run = 0, best = 0; ["202507", "202508", "202509", "202510", "202511", "202512"].forEach(m => { run = carried.includes(m) ? run + 1 : 0; best = Math.max(best, run); });
  ok(best >= 3, "credit carried forward " + best + " months running (" + carried.join(", ") + "), each run starting from the credit kept for the month before");
  ok(T["202508"].opening && JSON.stringify(T["202508"].opening) === JSON.stringify(rows.work.gstFiled["07"]["202507"].snap.pay.carry), "August's credit comes from July's 3B kept as filed");
  ok(nz(T["202505"].held) && nz(T["202506"].released), "2B: a bill not yet in 2B held, then taken in the month its 2B shows it");
  ok(T["202507"].held.list.some(d => d.rejected), "IMS: a bill rejected in IMS gives no credit");
  ok(nz(T["202509"].cn2b) && nz(T["202510"].na), "2B: a supplier's credit note only in 2B; credit 2B says is not available (4(D)(2))");
  ok(nz(T["202510"].custRej && T["202510"].custRej.add), "IMS: our credit note rejected by the customer added back");
  ok(nz(T["202508"].rev2), "the figures typed into 3B (4(B)(2))");
  ok(T["202511"].other && KN.find(z => z.args === "07|202511").result.fp.run === "41", "November: the AI pair kept by gst-2b-match for 2025-26 read (run 41)");

  console.log("== 4. kept, a change, the keys, the switches, a failure");
  ok(cloud.hits.every(c => c.ok && c.cached && c.result), "the member's months given back as kept, nothing worked out");
  ok(cloud.changed.ok && cloud.changed.pending && cloud.changed.version !== cloud.miss.version, "a new entry moves the version: a miss again, queued");
  ok(cloud.other.status === 404 && cloud.noauth.status === 401 && cloud.nomember.status === 403, "another firm's client 404, no sign-in 401, not a member 403");
  ok(cloud.warmNoKey.status === 401 && cloud.warmCron.status === 200, "a background run: the service key or the timer's key only");
  ok(cloud.clientOff.status === 403 && cloud.clientOff.reason === "company_off" && cloud.clientOffWarm.kind === "gate", "a switched-off client: refused, by the member's request and the background run");
  ok(cloud.firmPaused.status === 403 && cloud.firmPaused.reason === "firm_paused", "a paused firm: refused");
  ok(cloud.failure.status === 500 && cloud.failure.ok === false && /down/.test(cloud.failure.error) && cloud.failure.cors, "a failure inside: JSON {ok: false, error} with the CORS headers");
  const q = cloud.q || {};
  ok(q.taken === 1 && q.wantWhileTaken === false && q.takenAgainWithin2min === 0 && q.keptAfterDone && q.goneWhenNothingNew, "the queue: a change while a run holds the client starts no run, is not taken again within 2 minutes, and stays queued after that run for the next; with nothing new it leaves");
  ok(q.afterThreeKilled && q.afterThreeKilled.taken === 0 && q.afterThreeKilled.tooBig === true && q.afterThreeKilled.want === false, "a run taken three times and never finished: the client too big, not taken again, no run started for it (the app works it out)");
  ok(q.afterADay && q.afterADay.want === true && q.afterADay.tooBig === false, "a too-big client wanted a day after its last run: taken back");
  ok(q.cap && q.cap.first3.join() === "c-a,c-b,c-c" && q.cap.more === 0, "at most 3 runs at once, in the order first wanted (" + (q.cap && q.cap.first3.join()) + ")");
  ok(q.delayed && q.delayed.start === false && q.delayed.now === 0 && q.delayed.later === 1, "lines queued for the drain: wanted 60 s on, not taken before");
  ok(cloud.kicksDuringRuns === 0 && cloud.kickedAgain === 2, "a background run never starts another (the timer and the members' misses do)");
  const tb = cloud.tooBigRun || {};
  ok(tb.ok && tb.big === true && tb.afterOne && tb.afterOne.too_big === false && tb.second && tb.second.big === true && tb.stored === 0 && tb.queued && tb.queued.too_big === true && tb.backOnNewEngine,
    "a run whose reading and books pass its budget: nothing stored; at the second such run the client is too big; a new engine takes it back (spent " + tb.spentMs + " ms, ready at " + tb.readyMs + " ms)");
  ok((cloud.twoAtOnce || []).length === 2 && cloud.twoAtOnce.every(x => x.ok) && new Set(cloud.twoAtOnce.map(x => x.client)).size === 2, "two runs at once in one isolate: two clients, each run with its own budget (" + JSON.stringify(cloud.twoAtOnce) + ")");

  console.log("== 4b. the version's GST keys, the engine's reads and the app's poke");
  const {GST3B_KEYS} = await import(path.join(ROOT, "server", "_shared", "gst3bprint.js"));
  const eng3b = fs.readFileSync(path.join(ROOT, "server", "_shared", "gst3b.js"), "utf8"), BK = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "js", "18-certificates-under-197-and-206aa-where-t.js"), "utf8").match(/const BOOKS_KEYS = (\[[^\]]*\])/)[1]);
  const read = new Set(); for (const mm of eng3b.matchAll(/\b(?:b|S\.books|\(S\.books \|\| \{\}\)|\(\(S\.books \|\| \{\}\)|\(S\.books && S\.books)\s*\.\s*([A-Za-z_]\w*)/g)) read.add(mm[1]);
  const reads = BK.filter(k => read.has(k) && !["vouchers", "meta"].includes(k));
  ok(reads.every(k => GST3B_KEYS.includes(k)), "every work key the engine reads is one the version counts (" + reads.length + " read: " + reads.filter(k => !GST3B_KEYS.includes(k)).join(", ") + ")");
  const sql = fs.readFileSync(path.join(ROOT, "server", "gst-run", "migration-153-gst-cloud.sql"), "utf8"), arr = (sql.match(/i\.key = any \(array\[([^\]]*)\]/) || ["", ""])[1].split(",").map(x => x.trim().replace(/^'|'$/g, "")).filter(Boolean);
  ok(JSON.stringify(arr) === JSON.stringify(GST3B_KEYS), "gst_calc_version counts exactly gst3bprint.js's GST3B_KEYS (" + arr.length + ")");
  const poke = (fs.readFileSync(path.join(ROOT, "src", "js", "54-live-sync.js"), "utf8").match(/send\.some\(x => (\/\^\([^/]*\/)\.test\(x\[2\]\.k\)\)\) Cloud\.api\("rpc\/gst_calc_poke"/) || [])[1];
  const pre = poke ? new RegExp(poke.slice(1, -1)) : null;
  const pk = poke ? poke.slice(3, -3).split("|") : [];
  ok(pre && JSON.stringify(pk.slice().sort()) === JSON.stringify(GST3B_KEYS.slice().sort()) && GST3B_KEYS.every(k => pre.test(k)) && !pre.test("gstNotes") && !pre.test("tdsFiled"), "the app pokes gst_calc_poke after saving an item of exactly those keys (BookItems.pushNow, src/js/54)");

  return big();
})().catch(e => { console.error(e); process.exit(1); });
async function big(){
  const boxes = (await import(path.join(ROOT, "server", "gst-run", "engine.js"))).boxes;
  console.log("== 5. a 40,000-entry book: CPU per background run (the limit 2 s, the target about 1 s) and memory (256 MB)");
  const big = rowsOf(world({seed: 7, scale: 1110})), bf = path.join(OUT, "gst-cloud-big.json"), br = path.join(OUT, "gst-cloud-big-res.json");
  ok(big.heads.length >= 40000, "the book: " + big.heads.length + " entries, " + big.lines.length + " lines");
  fs.writeFileSync(bf, JSON.stringify({rows: big, asks: [{reg: "07", ym: "202603"}], firm: FIRM, timing: true}));
  const bt = deno(br, [bf, br]), BR = bt.runs.filter(r => r.months && r.months.length);
  ok(bt.kept.filter(k => !/\|all$/.test(k.args)).length === 12 && BR.every(r => r.months.length <= 2), BR.length + " runs: " + BR.map(r => r.months.join("+")).join(" "));
  const bw = Math.max(...BR.map(r => r.cpu));
  ok(bw < 2000, "CPU per run under the 2 s limit" + (bw < 1000 ? " and the 1 s target" : ", NOT under the 1 s target") + " (the fake database's own left out): " + BR.map(r => r.cpu).join(", ") + " ms; the worst " + bw + " ms (wall " + Math.max(...BR.map(r => r.wall)) + " ms; reading the answers (JSON) " + BR.map(r => r.spentMs).join("/") + " ms, making the books " + BR.map(r => r.booksMs).join("/") + " ms, the step " + BR.map(r => r.ms).join("/") + " ms)");
  const bh = Math.max(...BR.map(r => r.heap)), lv = bt.live || {};
  const need = Math.max(lv.rows, lv.rowsAndBooks) + 60;
  ok(need < 256, "memory: what a run holds alive at its fullest (after a collection): the rows read " + lv.rows + " MB, the rows and the books with a month worked out " + lv.rowsAndBooks + " MB; with a Deno function's own (about 60 MB) " + need + " MB, under the 256 MB limit (heap in use during a run, garbage not yet collected included: up to " + bh + " MB; this test's process, with the fake database's 40,000 entries in it too: " + bt.peakRss + " MB)");
  const bigApp = app3b(big, "07", "202603"), bk = bt.kept.find(z => z.args === "07|202603");
  ok(bk && JSON.stringify(Object.assign({}, bk.result, {engine: undefined, fp: undefined})) === JSON.stringify(boxes(bigApp["202603"])), "the 40,000-entry book's January-March quarter: the cloud's 3B is the app's");
  [bf, br, path.join(OUT, "gst-cloud-rows.json"), path.join(OUT, "gst-cloud-res.json")].forEach(f => { try { fs.unlinkSync(f); } catch (e){} });
  console.log(fails ? fails + " FAILED" : "all ok");
  process.exit(fails ? 1 : 0);
}
