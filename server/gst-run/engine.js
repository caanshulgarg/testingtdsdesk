// gst-run (next-cloud-gst, 09-Nov-2026): the browser's own GSTR-3B engine (server/_shared/gst3b.js, the same file build.py
// puts into the app) run on a client's books made from FinCom's cloud. Plain JavaScript, so Deno (the function) and Node
// (tests/run_gst_cloud.js) run the same file.
//   books(rows)            the books as the app holds them once a client is opened from the cloud (TCloud.load): every
//                          item of the client's work (client_book_items, put together by BookItems.join), the masters the
//                          cloud copy has (each ledger's group, GSTIN and PAN: BookSrc.ledgersInto; Tally's groups), the
//                          entries (tally_vouchers / tally_lines / tally_bills: BookSrc.apply), meta as a Day Book read
//                          sets it, and the ledger list (Books.mapLedgers on the saved list, then LedMaster.refresh)
//   run(rows, asks)        the 3B of each month asked ([{reg, ym}]) and of every month before it in the books (the credit
//                          carried in is worked out month by month, as the app does), with the state the engine reads
//                          (S, CO(), the 2B matching kept by gst-2b-match for M2B)
//   boxes(t)               a 3B's figures as kept: every box, with the lists of documents behind them counted, not kept
// The engine reads S and CO() as globals (as in the app): run() sets them, works everything out at once (no await in
// between, so two requests never share them) and puts them back.
import * as names from "../_shared/names.js";
import * as E from "../_shared/gst3b.js";

const G = globalThis;
// what the app's program has around the engine: names.js (put at its head by build.py too)
for (const [k, v] of Object.entries(names)) if (G[k] === undefined) G[k] = v;

// the keys the app keeps with Tally's reading and never sends as work (BookSync.FROM_TALLY, src/js/41)
const FROM_TALLY = ["vouchers", "meta", "tb", "mis", "payroll"];

// (as in the app, the books being opened are S.books while they are made: LedMaster.refresh looks a ledger's groups up
// through S.books; run() sets S first)
export function books(rows) {
  const b = { cid: rows.client, vouchers: [], map: {} };
  if (G.S && typeof G.S === "object") G.S.books = b;
  // the client's work, item by item (BookItems.put, src/js/54: each key's items joined; a deleted item is gone)
  const by = {};
  (rows.items || []).forEach((r) => { if (r && !r.deleted && FROM_TALLY.indexOf(r.key) < 0) (by[r.key] = by[r.key] || []).push({ k: r.key, i: r.item || "", o: r.ord, d: r.data }); });
  Object.keys(by).sort().forEach((k) => { const v = E.BookItems.join(by[k]); if (v !== undefined) b[k] = v; });
  // the cloud copy's masters (TCloud.load: TallyRead.balances puts each ledger's group where the books have none,
  // BookSrc.ledgersInto its GSTIN and PAN, TCloud.groupsInto Tally's groups)
  const led = rows.ledgers || [];
  led.forEach((l) => { if (l && l.name && l.parent) { const n = E.ledClean(l.name); (b.under = b.under || {})[n] = b.under[n] || E.ledClean(l.parent); } });
  E.BookSrc.ledgersInto(b, led, rows.book && rows.book.ledgers_at);
  if ((rows.groups || []).length) { b.groups = Object.assign({}, b.groups || {}); rows.groups.forEach((x) => { b.groups[x.name] = x.parent || ""; }); }
  // the entries: the cloud copy's rows, as Books.importDayBook makes them (BookSrc.fromCopy), deleted ones out
  E.BookSrc.apply(b, rows.heads || [], rows.lines || [], rows.bills || []);
  // meta as a Day Book read sets it (TallyRead.merge): bill-wise on, the company's GSTINs from its entries
  b.meta = Object.assign({}, b.meta || {}, { bills: 1, gstins: Array.from(new Set(b.vouchers.map((v) => v.cmp).filter(Boolean))).sort() });
  // FinCom's ledger list as TCloud.load makes it on opening: the one saved (a ledger set by hand or confirmed stays as it
  // is), a guess for the rest (Books.mapLedgers), each guess then filled from the masters (LedMaster.refresh; without
  // the app's tplFor, which reads the firm's other clients)
  b.map = E.Books.mapLedgers(b.vouchers, b.map || {});
  try { E.LedMaster.refresh(b); } catch (e) { /* as the app: a refresh that fails leaves the guesses */ }
  return b;
}

// a 3B's figures as kept: lists of documents (held, released, the amendments' rows...) are counted, not kept;
// the places of supply (3.2) and a quarter's months are kept as they are
export function boxes(t) {
  const keep = { unregPos: 1, months: 1 };
  const walk = (x, k) => {
    if (Array.isArray(x)) return keep[k] || !x.some((y) => y && typeof y === "object") ? x.map((y) => walk(y, "")) : { n: x.length };
    if (x && typeof x === "object") { const o = {}; Object.keys(x).forEach((j) => { if (typeof x[j] !== "function" && x[j] !== undefined) o[j] = walk(x[j], j); }); return o; }
    return x;
  };
  return walk(t, "");
}

// the engine's own text: a result worked out by another engine is worked out again
export const ENGINE = (() => {
  let s = "";
  const add = (v) => { if (typeof v === "function") s += v.toString(); else if (v && typeof v === "object") Object.keys(v).sort().forEach((k) => { const x = v[k]; s += k + (typeof x === "function" ? x.toString() : typeof x === "object" && x && !(x instanceof Map) && !(x instanceof WeakMap) ? JSON.stringify(x) : ""); }); };
  Object.keys(E).sort().forEach((k) => add(E[k]));
  let h = 2166136261 >>> 0, h2 = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ c, 16777619) >>> 0; h2 = ((h2 * 33) ^ c) >>> 0; }
  return "e" + h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
})();

let GEN = 0;
// rows: {client, co (the client's record), book, heads, lines, bills, ledgers, groups, items, sales (records rows' data),
// runs: {"<gstin>|<fy>": run as gst-2b-match shows it}}; asks: [{reg, ym}]
export function run(rows, asks) {
  const was = { S: G.S, CO: G.CO, perRender: G.perRender, IN_RENDER: G.IN_RENDER, RENDER_GEN: G.RENDER_GEN };
  const t0 = Date.now();
  try {
    const co = Object.assign({}, rows.co || {}, { id: rows.client });
    const S = { books: null, coId: rows.client, companies: { [rows.client]: co }, sales: { cid: rows.client, list: rows.sales || [] }, gstYm: "" };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    const b = books(rows);
    // the app's figures for one drawing are worked out once (perRender, src/js/01; Books.lines' own keep): the same here,
    // for one run
    let memo = new WeakMap();
    G.IN_RENDER = 1; G.RENDER_GEN = ++GEN;
    G.perRender = (o, key, fn) => { let m = memo.get(o); if (!m) memo.set(o, m = new Map()); if (m.has(key)) return m.get(key); const v = fn(); m.set(key, v); return v; };
    const tb = Date.now() - t0;
    E.GSTR._carry = null; E.GST2B._memo = null; E.GSTAdv._memo = null; E.M2B.st = {};
    const months = E.GSTR.months(), out = [];
    for (const a of asks) {
      const reg = String(a.reg || ""), ym = String(a.ym || "");
      // M2B reads the year of the month on screen (S.gstYm): here, the month asked
      S.gstYm = ym; E.M2B.st = {};
      const gstin = (E.GSTR.gstins(b) || []).find((g) => g.slice(0, 2) === reg) || "", fy = E.M2B.fyOf(ym);
      const r2b = (rows.runs || {})[gstin + "|" + fy];
      if (r2b) E.M2B.st[E.M2B.key(reg, fy)] = { run: r2b };
      // each month asked is one drawing of the 3B screen: nothing kept from the one before
      E.GST2B._memo = null; E.GSTR._carry = null; memo = new WeakMap(); G.RENDER_GEN = ++GEN;
      const t1 = Date.now();
      const done = [];
      // every month up to the one asked, in order (each one's credit carried into the next)
      for (const m of months.filter((x) => x <= ym).concat(months.includes(ym) ? [] : [ym])) {
        const t = E.GSTR.threeB(m, reg);
        done.push({ reg, ym: m, result: Object.assign(boxes(t), { engine: ENGINE }) });
      }
      out.push({ reg, ym, ms: Date.now() - t1, months: done });
    }
    return { months, out, booksMs: tb, vouchers: b.vouchers.length };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}
