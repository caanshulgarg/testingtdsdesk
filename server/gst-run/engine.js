// gst-run (next-cloud-gst, 09-Nov-2026): the browser's own GSTR-3B engine (server/_shared/gst3b.js, the same file build.py
// puts into the app) run on a client's books made from FinCom's cloud. Plain JavaScript, so Deno (the function) and Node
// (tests/run_gst_cloud.js) run the same file.
//   books(rows)            the books as the app holds them once a client is opened from the cloud (TCloud.load): every
//                          item of the client's work (client_book_items, put together by BookItems.join), the masters the
//                          cloud copy has (each ledger's group, GSTIN and PAN: BookSrc.ledgersInto; Tally's groups), the
//                          entries (tally_vouchers / tally_lines / tally_bills: BookSrc.apply), meta as a Day Book read
//                          sets it, and the ledger list (Books.mapLedgers on the saved list, then LedMaster.refresh)
//   step(rows, reg, kept, o)  one background run's work: the first months of the books not kept yet (kept: {ym: result}
//                          worked out on the same version and engine), at most o.max (2) months and about o.budget ms
//                          (600), each starting from the credit the month before carried (taken from what is kept, so
//                          no earlier month is worked out again). Each month is worked out as the app works it out with
//                          that month on screen: S.gstYm the month, the 2B matching of its year (gst-2b-match's run for
//                          the month's GSTIN and year) in M2B.st. Each month keeps the fingerprint of its inputs (fp,
//                          server/_shared/gst3bprint.js). -> {months: [{ym, result}], more, all: the books' months}
//   boxes(t)               a 3B's figures as kept: every box, with the lists of documents behind them counted, not kept
//   ENGINE                 a hash of the engine's own text (gst3b.js, names.js, this file's books / step / boxes) and REV
//                          (data.ts and handler.ts are counted through REV: tests/run_gst_cloud.js stops when one of the
//                          files changes and REV and tests/gst_cloud_rev.json do not)
// The engine reads S and CO() as globals (as in the app): step() sets them, works its months out at once (no await in
// between, so two requests never share them) and puts them back.
import * as names from "../_shared/names.js";
import * as E from "../_shared/gst3b.js";
import { gst3bPrint } from "../_shared/gst3bprint.js";

// the revision of the function around the engine (data.ts, handler.ts): moved by hand with tests/gst_cloud_rev.json
export const REV = "153.2";

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
  let s = REV + "|" + books.toString() + boxes.toString() + step.toString() + gst3bPrint.toString();
  const add = (v) => { if (typeof v === "function") s += v.toString(); else if (v && typeof v === "object") Object.keys(v).sort().forEach((k) => { const x = v[k]; s += k + (typeof x === "function" ? x.toString() : typeof x === "object" && x && !(x instanceof Map) && !(x instanceof WeakMap) ? JSON.stringify(x) : ""); }); };
  Object.keys(E).sort().forEach((k) => add(E[k]));
  Object.keys(names).sort().forEach((k) => add(names[k]));
  let h = 2166136261 >>> 0, h2 = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ c, 16777619) >>> 0; h2 = ((h2 * 33) ^ c) >>> 0; }
  return "e" + h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
})();

let GEN = 0;
// rows: {client, co (the client's record), book, heads, lines, bills, ledgers, groups, items, sales (records rows' data),
// runs: {"<gstin>|<fy>": run as gst-2b-match shows it}}; reg: the state code; kept: {ym: result} current
export function step(rows, reg, kept, o) {
  o = o || {}; kept = kept || {};
  const max = o.max || 2, budget = o.budget || 600, now = o.now || (() => Date.now());
  const was = { S: G.S, CO: G.CO, perRender: G.perRender, IN_RENDER: G.IN_RENDER, RENDER_GEN: G.RENDER_GEN };
  const t0 = now();
  try {
    const co = Object.assign({}, rows.co || {}, { id: rows.client });
    const S = { books: null, coId: rows.client, companies: { [rows.client]: co }, sales: { cid: rows.client, list: rows.sales || [] }, gstYm: "" };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    // the books, made once for every registration of a run (o.books: those step made before, from the same rows)
    const b = o.books || books(rows), tBooks = now() - t0;
    S.books = b;
    // the fingerprint of the inputs, as read (before anything is worked out)
    const fp0 = o.fp || gst3bPrint(b, rows.sales || [], "");
    E.GSTR._carry = null; E.GST2B._memo = null; E.GSTAdv._memo = null; E.GSTF._bills = null; E.GSTF._owe = null; E.M2B.st = {};
    const all = E.GSTR.months(), todo = all.filter((m) => !kept[m]), done = [], have = Object.assign({}, kept);
    const gstin = (E.GSTR.gstins(b) || []).find((g) => g.slice(0, 2) === reg) || "";
    for (const m of todo) {
      if (done.length >= max || (done.length && now() - t0 > budget)) break;
      // the month on screen: its year's 2B matching, nothing kept from another month but the 3Bs before it (perRender's
      // "3b|<month>|<reg>": GSTR.creditIn reads the credit the month before carried from it)
      S.gstYm = m; E.M2B.st = {};
      const fy = E.M2B.fyOf(m), r2b = (rows.runs || {})[gstin + "|" + fy];
      if (r2b) E.M2B.st[E.M2B.key(reg, fy)] = { run: r2b };
      E.GST2B._memo = null; E.GSTR._carry = null;
      const memo = new WeakMap(), g = new Map();
      memo.set(E.GSTR, g);
      Object.keys(have).forEach((k) => { if (k < m) g.set("3b|" + k + "|" + reg, have[k]); });
      G.IN_RENDER = 1; G.RENDER_GEN = ++GEN;
      G.perRender = (obj, key, fn) => { let x = memo.get(obj); if (!x) memo.set(obj, x = new Map()); if (x.has(key)) return x.get(key); const v = fn(); x.set(key, v); return v; };
      const t = E.GSTR.threeB(m, reg), res = Object.assign(boxes(t), { engine: ENGINE, fp: Object.assign({}, fp0, { run: r2b ? String(r2b.id) : "" }) });
      have[m] = res; done.push({ ym: m, result: res });
    }
    return { months: done, more: all.some((m) => !have[m]), all, vouchers: b.vouchers.length, ms: now() - t0, booksMs: o.books ? 0 : tBooks, books: b, fp: fp0 };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}
