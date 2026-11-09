// node tests/run_gst_cloud.js - next-cloud-gst: a month's GSTR-3B worked out in the cloud (server/gst-run) is the app's,
// box for box, to the paisa. Made-up books only (tests/gst_cloud_world.js; nothing of a real client).
//   The app's side: the built test page (site-test/index.html, as tests/harness.js loads it), opened on the client as the
//     app opens one from the cloud (the work items put back by BookItems.put, the masters by TallyRead.balances,
//     BookSrc.ledgersInto and Tally's groups, the entries by BookSrc.apply, the ledger list by Books.mapLedgers and
//     LedMaster.refresh), with Asia/Kolkata's clock, and its 3B worked out month by month (GSTR.threeB) with the 2B
//     matching gst-2b-match kept in M2B.st, inside one drawing (the app's memoScope / perRender), as the 3B screen does.
//   The cloud's side: the gst-run function itself in Deno (tests/run_gst_cloud_deno.ts: server/gst-run/handler.ts with a
//     fake Supabase holding the same rows, UTC clock), for every month asked by a member; then asked again (kept: given
//     back without working out), and after a change (worked out again).
//   Checks: every box of every month equal (3.1, 3.2, 4, 5, the payment and the credit carried in and out), and the whole
//     3B object equal; the months cover QRMP (a quarter's 3B, credit held through the quarter), rules 42 and 43, rule 37,
//     an amendment of an earlier month's GSTR-1, an advance (11A and 11B), the credit carried over at least 3 months,
//     2B held / released / rejected in IMS, a 3B kept as filed; then the time per month on a 40,000-entry book (< 1 s).
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
const ASKS = ["202506", "202507", "202508", "202509", "202510", "202511", "202512", "202601", "202602", "202603"].map(ym => ({reg: "07", ym}));

// ---------------------------------------------------------------- the cloud's side (Deno)
function deno(file, args){
  const r = cp.spawnSync(DENO, ["run", "--allow-read", "--allow-env", "--allow-write", path.join(__dirname, "run_gst_cloud_deno.ts")].concat(args), {encoding: "utf8", env: Object.assign({}, process.env, {TZ: "UTC", DENO_DIR: path.join(ROOT, ".deno-scratch", "cache")}), maxBuffer: 1 << 30});
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
  const boxes = (await import(path.join(ROOT, "server", "gst-run", "engine.js"))).boxes;
  console.log("== 1. every box of every month: the app (Node, Asia/Kolkata) and gst-run (Deno, UTC)");
  const file = path.join(OUT, "gst-cloud-rows.json"), res = path.join(OUT, "gst-cloud-res.json");
  fs.writeFileSync(file, JSON.stringify({rows, asks: ASKS, firm: FIRM}));
  const t0 = Date.now(), cloud = deno(res, [file, res]);
  console.log("  (gst-run: " + cloud.calls.length + " calls, " + (Date.now() - t0) + " ms with Deno's start)");
  let boxN = 0, monthsN = 0, allSame = true;
  const appBy = {};
  for (const a of ASKS){
    const mine = app3b(rows, a.reg, a.ym), got = cloud.calls.find(c => c.ym === a.ym);
    Object.assign(appBy, mine);
    ok(got && got.ok && got.months.length === 1 && !got.months[0].cached, "gst-run answers " + a.ym + " for a member (worked out, not kept)");
    const g = got.months[0].result, m = boxes(mine[a.ym]);
    let bad = [];
    Object.entries(BOX).forEach(([k, f]) => { boxN++; if (JSON.stringify(f(g)) !== JSON.stringify(f(m))) bad.push(k + ": cloud " + JSON.stringify(f(g)) + " app " + JSON.stringify(f(m))); });
    const same = JSON.stringify(Object.assign({}, g, {engine: undefined})) === JSON.stringify(m);
    if (!same) allSame = false;
    ok(!bad.length && same, a.ym + (mine[a.ym].quarter ? " (quarter " + mine[a.ym].months.join(",") + ")" : "") + ": every box equal" + (bad.length ? "; " + bad.slice(0, 3).join("; ") : same ? "" : "; the boxes agree but the whole 3B differs"));
    monthsN++;
    // the months before it, kept by gst-run with it, are the app's too
    const kept = cloud.kept.filter(k => k.args.startsWith("07|") && k.args.slice(3) <= a.ym);
    if (a.ym === ASKS[ASKS.length - 1].ym){
      const diff = kept.filter(k => JSON.stringify(Object.assign({}, k.result, {engine: undefined})) !== JSON.stringify(boxes(mine[k.args.slice(3)])));
      ok(kept.length === Object.keys(mine).length && !diff.length, "every month from April kept by gst-run (" + kept.length + ") equals the app's" + (diff.length ? ": " + diff.map(k => k.args).join(", ") : ""));
    }
  }
  console.log("  (" + monthsN + " months, " + boxN + " boxes compared; the whole 3B object compared too: " + (allSame ? "equal" : "NOT equal") + ")");

  console.log("== 2. what the months cover (on the app's figures)");
  const T = appBy, nz = o => !near0(o);
  ok(T["202603"].quarter && T["202603"].months.join() === "202601,202602,202603" && JSON.stringify(T["202602"].opening) === JSON.stringify(T["202601"].opening), "QRMP: January to March 2026 is one 3B at March; the credit carried in holds through the quarter");
  ok(nz(T["202603"].pmt), "QRMP: PMT-06 paid in January used first in the quarter's 3B");
  ok(["202506", "202507", "202508", "202509"].some(m => nz(T[m].r42)), "rule 42: common credit reversed on the exempt share");
  ok(["202506", "202507", "202508"].some(m => nz(T[m].r43)), "rule 43: the capital good in common use");
  ok(nz(T["202510"].r37 && T["202510"].r37.rev) && nz(T["202512"].r37 && T["202512"].r37.re), "rule 37: April's unpaid bill reversed in October, taken back in December");
  ok(T["202507"].amend.rows.length > 0 && nz(T["202507"].amend.out), "an amendment: June's invoice changed after its GSTR-1, the difference in July's 3.1(a)");
  ok(nz(T["202508"].adv) && nz(T["202510"].adv) && T["202508"].adv.igst > 0 && T["202510"].adv.igst < 0, "an advance: 11A in August, 11B in October");
  const carried = ASKS.map(a => a.ym).filter(m => !T[m].quarter && T[m].months === undefined && nz(T[m].opening) && nz(T[m].pay.carry));
  let run = 0, best = 0; ["202507", "202508", "202509", "202510", "202511", "202512"].forEach(m => { run = carried.includes(m) ? run + 1 : 0; best = Math.max(best, run); });
  ok(best >= 3, "credit carried forward " + best + " months running (" + carried.join(", ") + ")");
  ok(T["202508"].opening && JSON.stringify(T["202508"].opening) === JSON.stringify(rows.work.gstFiled["07"]["202507"].snap.pay.carry), "August's credit comes from July's 3B kept as filed");
  ok(nz(T["202505"].held) && nz(T["202506"].released), "2B: a bill not yet in 2B held, then taken in the month its 2B shows it");
  ok(T["202507"].held.list.some(d => d.rejected), "IMS: a bill rejected in IMS gives no credit");
  ok(nz(T["202509"].cn2b) && nz(T["202510"].na), "2B: a supplier's credit note only in 2B; credit 2B says is not available (4(D)(2))");
  ok(nz(T["202510"].custRej && T["202510"].custRej.add), "IMS: our credit note rejected by the customer added back");
  ok(nz(T["202508"].rev2), "the figures typed into 3B (4(B)(2))");

  console.log("== 3. kept, and worked out again on a change");
  ok(cloud.again.every(c => c.ok && c.months.every(m => m.cached)), "asked again with nothing changed: every month given back as kept, nothing worked out (" + cloud.againReads + " reads for " + cloud.again.length + " asks: the member, the client, the switches, the book, the kept rows)");
  ok(cloud.changed.ok && cloud.changed.months.every(m => !m.cached) && cloud.changed.version !== cloud.calls[0].version, "a new entry moves the version: worked out again");
  ok(cloud.other.status === 404 && cloud.noauth.status === 401 && cloud.nomember.status === 403, "another firm's client 404, no sign-in 401, not a member 403");

  console.log("== 4. time per month on a 40,000-entry book (gst-run in Deno)");
  const big = rowsOf(world({seed: 7, scale: 1110})), bf = path.join(OUT, "gst-cloud-big.json"), br = path.join(OUT, "gst-cloud-big-res.json");
  ok(big.heads.length >= 40000, "the book: " + big.heads.length + " entries, " + big.lines.length + " lines");
  fs.writeFileSync(bf, JSON.stringify({rows: big, asks: [{reg: "07", ym: "202603"}], firm: FIRM, timing: true}));
  const bt = deno(br, [bf, br]);
  ok(bt.perMonth < 1000, "the books made in " + bt.booksMs + " ms; then " + bt.months + " months worked out in " + bt.ms + " ms: " + bt.perMonth + " ms a month (best of 3; the target under 1 s)");
  // and the big book's last quarter equal to the app's
  const bigApp = app3b(big, "07", "202603"), bigCloud = bt.result;
  ok(JSON.stringify(Object.assign({}, bigCloud, {engine: undefined})) === JSON.stringify(boxes(bigApp["202603"])), "the 40,000-entry book's January-March quarter: the cloud's 3B is the app's");
  console.log(fails ? fails + " FAILED" : "all ok");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
