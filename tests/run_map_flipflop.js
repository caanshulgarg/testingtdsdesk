// node tests/run_map_flipflop.js - next-db-load-2 (23-Nov-2026): the ledger map's derived count. Staging, 23-Nov-2026: 4,450
// saves of client_book_items in 4 hours, 92% of them putting an item back to what it was two saves before, all of key
// "map", one person: a ledger's "n" and "why" ("used 224 times" / "used 235 times"). Each open copy counts a ledger's
// uses in the entries IT holds (LedMaster.refresh -> usage over b.vouchers), and two copies holding different entries
// (one has read more days of the cloud copy than the other) count differently: A saves 235, B takes it, works the map
// out again (into -> LedMaster.refresh) to 224 and saves that at its next round, A takes 224, works it out to 235...
// Now n, and the why of a guess (worked out again by every copy from its own entries), are not what an item is synced by:
// a map item whose only change is them is not sent, and one coming in is not taken. Each copy shows its own count.
// Two computers in one test, the real BookItems of src/js/54 and server/_shared/gst3b.js, a server that keeps the
// rows and passes each save to the other computer as Realtime does. Made-up ledgers.
// FLIP_SRC: another src/js folder (the code before the fix: the checks fail there).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = process.env.FLIP_SRC || path.join(__dirname, "..", "src", "js");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));
const t = fs.readFileSync(path.join(SRC, "54-live-sync.js"), "utf8"), a = t.indexOf("Object.assign(BookItems, {"), b = t.indexOf("/* ---------- Supabase Realtime");
const g = fs.readFileSync(path.join(__dirname, "..", "server", "_shared", "gst3b.js"), "utf8"), ga = g.indexOf("const BookItems = {"), gb = g.indexOf("\n};", ga);
const core = fs.readFileSync(path.join(SRC, "26-sales-from-a-marketplace.js"), "utf8"), fa = core.indexOf("function fpHash");
const st = fs.readFileSync(path.join(SRC, "27-firm-account.js"), "utf8"), sa = st.indexOf("function stableStr"), sb = st.indexOf("\n}\n", sa) + 3;

const server = {rows: [], seq: 0, saves: 0, items: 0};
function computer(name, counts){
  const ctx = {console, JSON, Object, Array, Map, Set, String, Number, Math, Date, Error, RegExp, Promise, setTimeout, clearTimeout};
  vm.createContext(ctx);
  vm.runInContext("var BookItems = " + g.slice(ga + "const BookItems = ".length, gb + 3), ctx);
  vm.runInContext(core.slice(fa, core.indexOf("\n}", fa) + 2) + "\n" + st.slice(sa, sb) + "\nthis.fpHash = fpHash; this.stableStr = stableStr;", ctx);
  ctx.num = v => Number(v) || 0; ctx.clone = clone;
  // the map as this computer works it out from the entries it holds (LedMaster.refresh: n and the guess's why)
  const refresh = bk => { Object.keys(bk.map).forEach(n => { const m = bk.map[n]; m.n = counts[n] || 0; if (!m.ok) m.why = "name says GST; used " + m.n + " times"; }); };
  ctx.S = {books: {cid: "c1", loading: false, vouchers: [{}], map: {"MADE UP CGST": {what: "gst", tax: "CGST"}, "MADE UP SGST": {what: "gst", tax: "SGST"}, "MADE UP TDS 194C": {what: "tds_payable", section: "194C", ok: true}}}};
  refresh(ctx.S.books);
  ctx.BookSync = {localWork: async (cid, keys) => clone({map: ctx.S.books.map}), openWorkParts: () => null, of: () => ({}), keys: () => ["map"], MASTERS: []};
  ctx.IDBStore = {get: async () => null, write: async () => {}};
  ctx.Live = {me: () => "u-same", noteItems(){}, ok(){}, saved(){}, saving(){}, fail(){}};
  ctx.saveBooks = async () => {}; ctx.render = () => {}; ctx.LK = {}; ctx.LedMaster = {refresh: refresh};
  ctx.Cloud = {api: async (p, o) => {
    if (p !== "rpc/save_book_items") throw new Error("not in this test: " + p);
    server.saves++; server.items += o.body.p_items.length;
    const out = o.body.p_items.map(x => { const r = {client_id: "c1", key: x.k, item: x.i, ord: x.o == null ? null : x.o, data: x.del ? null : clone(x.d), deleted: !!x.del, seq: ++server.seq, updated_by: "u-same", updated_at: new Date().toISOString(), from: name}; server.rows.push(r); return {k: x.k, i: x.i, seq: r.seq}; });
    return {ok: true, items: out};
  }};
  vm.runInContext(t.slice(a, b), ctx);
  return {name, ctx, BI: ctx.BookItems, seen: 0};
}
// the rows another computer saved since this one last looked (Realtime), then this computer's own round (the 45 s sync)
async function round(c){
  const rows = server.rows.slice(c.seen).filter(r => r.from !== c.name); c.seen = server.rows.length;
  if (rows.length) await c.BI.take("c1", clone(rows), {first: false, cursor: true});
  await c.BI.pushNow("c1");
}
(async () => {
  const A = computer("A", {"MADE UP CGST": 235, "MADE UP SGST": 235, "MADE UP TDS 194C": 40});   // more days read here
  const B = computer("B", {"MADE UP CGST": 224, "MADE UP SGST": 224, "MADE UP TDS 194C": 38});
  await round(B);                                    // B saves its map first
  const first = server.saves;
  for (let i = 0; i < 10; i++){ await round(A); await round(B); }
  const loop = server.saves - first;
  ok(first === 1, "B's first save of the map: one call (" + first + ")");
  ok(loop === 0, "then 10 rounds on each computer: " + loop + " more saves (" + server.items + " items in all; before: a save a round, the count going 224 -> 235 -> 224)");
  ok(A.ctx.S.books.map["MADE UP CGST"].n === 235 && B.ctx.S.books.map["MADE UP CGST"].n === 224, "each computer shows its own count (A 235, B 224)");
  // a real change still goes across, once
  A.ctx.S.books.map["MADE UP SGST"] = Object.assign({}, A.ctx.S.books.map["MADE UP SGST"], {ok: true, byHand: true, tax: "SGST", side: "input"});
  const s0 = server.saves;
  await round(A); await round(B); await round(A); await round(B);
  ok(server.saves - s0 === 1, "a ledger confirmed on A: saved once (" + (server.saves - s0) + ")");
  const bm = B.ctx.S.books.map["MADE UP SGST"];
  ok(bm.ok === true && bm.side === "input", "...and it is in B's map");
  ok(B.ctx.S.books.map["MADE UP SGST"].n === 224, "...with B's own count");
  console.log(fails ? "FAILED: " + fails : "ALL OK");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("  FAIL " + (e && e.stack || e)); process.exit(1); });
