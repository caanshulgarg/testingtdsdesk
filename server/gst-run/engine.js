// gst-run (next-cloud-gst, 09-Nov-2026): the browser's own GSTR-3B engine (server/_shared/gst3b.js, the same file build.py
// puts into the app) run on a client's books made from FinCom's cloud. Plain JavaScript, so Deno (the function) and Node
// (tests/run_gst_cloud.js) run the same file.
//   books(rows)            the books as the app holds them once a client is opened from the cloud (TCloud.load): every
//                          item of the client's work (client_book_items, put together by BookItems.join), the masters the
//                          cloud copy has (each ledger's group, GSTIN and PAN: BookSrc.ledgersInto; Tally's groups), the
//                          entries (tally_vouchers / tally_lines / tally_bills: BookSrc.apply), meta as a Day Book read
//                          sets it, and the ledger list (Books.mapLedgers on the saved list, then LedMaster.refresh)
//   step(rows, reg, kept, o)  one background run's work: the first months of the books (of o.only) not kept yet (kept:
//                          {ym: result} worked out on the same version and engine), at most o.max (2) months, within the
//                          time from the request's start (o.ready, o.total: else {big: true}, nothing worked out), each
//                          starting from the credit the month before carried (taken from what is kept, so
//                          no earlier month is worked out again). Each month is worked out as the app works it out with
//                          that month on screen: S.gstYm the month, the 2B matching of its year (gst-2b-match's run for
//                          the month's GSTIN and year) in M2B.st. Each month keeps the fingerprint of its inputs (fp,
//                          server/_shared/gst3bprint.js). -> {months: [{ym, result}], more, all: the books' months}
//   boxes(t)               a 3B's figures as kept: every box, with the lists of documents behind them counted, not kept
//   ctxOf(b) / ctxDiff(a, c) / shares(rows, ctx) / parity(rows, ym, reg, sums)   next-gst-share (migration 164, shadow):
//                          the book's context for entryShares (its ledger list, groups, GSTINs, places of supply typed),
//                          which ledgers and entries a new context moves, a batch of entries' shares, and a month of
//                          today's engine against the cloud's sums of the shares (every figure, to the paisa)
//   itcMonths(inp, reg, yms) / engineItc(rows, reg, yms, o) / itcCompare(eng, cloud)   next-gst-share part B (migration
//                          171, shadow): a month's 3B (tables 4, 5, 6) by today's engine on what the cloud keeps (the month
//                          sums, each entry's document and allocations, the suppliers' movement, the credit carried in),
//                          today's engine on the whole book for the same months, and every box of both to the paisa
//   ENGINE                a hash of the engine's own text (gst3b.js, names.js, this file's books / step / boxes) and REV
//                          (data.ts and handler.ts are counted through REV: tests/run_gst_cloud.js stops when one of the
//                          files changes and REV and tests/gst_cloud_rev.json do not)
// The engine reads S and CO() as globals (as in the app): step() sets them, works its months out at once (no await in
// between, so two requests never share them) and puts them back.
import * as names from "../_shared/names.js";
import * as E from "../_shared/gst3b.js";
import { gst3bPrint } from "../_shared/gst3bprint.js";

// the revision of the function around the engine (data.ts, handler.ts): moved by hand with tests/gst_cloud_rev.json
export const REV = "171.4";

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
  // the entries: the cloud copy's rows, as Books.importDayBook makes them (BookSrc.fromCopy), deleted ones out; or the
  // list fromCopy made of the same rows before (rows.made: gst_calc_prep, migration 162), put in the same way (BookSrc.put:
  // of a deleted entry nothing is in the list, and the books start with none)
  if (!rows.made) rows.made = E.BookSrc.fromCopy(rows.heads || [], rows.lines || [], rows.bills || []);
  E.BookSrc.apply(b, rows.heads || [], rows.lines || [], rows.bills || [], rows.made);
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
  let s = REV + "|" + books.toString() + boxes.toString() + step.toString() + gst3bPrint.toString() + ctxOf.toString() + contextOf.toString() + shares.toString() + engineSums.toString()
    + itcRow.toString() + sumRows.toString() + addSum.toString() + shareSrc.toString() + monthBook.toString() + itcMonths.toString() + engineItc.toString();
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
  // the budget is the run's own work (o.spent: the ms the request already spent reading answers, its JSON and unpacking;
  // then this step's): reading and making the books over o.ready (1100 ms) is too big for a run; the first month is then
  // worked out, a further one only when, at the pace of the one before, it ends by o.total (1500 ms). Waiting on the database is not counted (an edge
  // function's CPU limit does not count it either)
  const max = o.max || 2, now = o.now || (() => Date.now()), ready = o.ready || 1100, total = o.total || 1500;
  const was = { S: G.S, CO: G.CO, perRender: G.perRender, IN_RENDER: G.IN_RENDER, RENDER_GEN: G.RENDER_GEN };
  const t0 = now(), spent = o.spent || 0, used = () => spent + now() - t0;
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
    const all = E.GSTR.months(), want = (m) => !o.only || o.only.includes(m), todo = all.filter((m) => !kept[m] && want(m)), done = [], have = Object.assign({}, kept);
    const gstin = (E.GSTR.gstins(b) || []).find((g) => g.slice(0, 2) === reg) || "";
    const atReady = used();
    // too big for a run: with o.keep, the entries made of the book's rows (fromCopy's list, nothing worked out on them
    // yet) as JSON, for gst_calc_prep: the next run starts from them instead of the rows
    if (todo.length && atReady > ready) return { big: true, months: [], more: true, all, vouchers: b.vouchers.length, ms: now() - t0, booksMs: o.books ? 0 : tBooks, books: b, fp: fp0, atReady,
      made: o.keep && !rows.fromPrep && rows.made ? JSON.stringify(rows.made) : undefined };
    let last = atReady;
    for (const m of todo) {
      if (done.length >= max || (done.length && used() + last > total)) break;     // the first month always (ready by o.ready)
      const tm = now();
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
      const t = E.GSTR.threeB(m, reg), res = Object.assign(boxes(t), { engine: ENGINE, src: E.GST3B_SRC, fp: Object.assign({}, fp0, { run: r2b ? String(r2b.id) : "" }) });
      have[m] = res; done.push({ ym: m, result: res }); last = now() - tm;
    }
    return { months: done, more: all.some((m) => want(m) && !have[m]), all, vouchers: b.vouchers.length, ms: now() - t0, booksMs: o.books ? 0 : tBooks, books: b, fp: fp0, atReady };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}

// ---------------------------------------------------------------- next-gst-share (migration 164, shadow mode)
// what entryShares reads of the books besides the entry: the ledger list (each ledger's settings; how many entries use
// it and the words of the guess left out), the ledgers' groups and Tally's groups, the parties' GSTINs, the places of
// supply typed (gstPosFix), the state. JSON, kept by gst_share_ctx_put
const CTX_DROP = { n: 1, why: 1 };
export function ctxOf(b) {
  const map = {};
  Object.keys(b.map || {}).sort().forEach((k) => { const m = b.map[k] || {}, o = {}; Object.keys(m).sort().forEach((j) => { if (!CTX_DROP[j] && m[j] !== undefined) o[j] = m[j]; }); map[k] = o; });
  return { map, under: b.under || {}, groups: b.groups || {}, gstins: b.gstins || {}, gstPosFix: b.gstPosFix || {}, stateOf: b.stateOf || "" };
}
// the whole book's context (rows as for step), with S set as step sets it
export function contextOf(rows) {
  const was = { S: G.S, CO: G.CO };
  try {
    const S = { books: null, coId: rows.client, companies: { [rows.client]: Object.assign({}, rows.co || {}, { id: rows.client }) }, sales: { cid: rows.client, list: [] }, gstYm: "" };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    return ctxOf(books(rows));
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}
// the books a batch of entries is worked out on: the context and the entries alone (BookSrc.apply, as books() puts them)
function ctxBooks(ctx, rows) {
  const b = { cid: rows.client, vouchers: [], map: ctx.map || {}, under: ctx.under || {}, groups: ctx.groups || {}, gstins: ctx.gstins || {}, gstPosFix: ctx.gstPosFix || {}, meta: {} };
  if (ctx.stateOf) b.stateOf = ctx.stateOf;
  E.BookSrc.apply(b, rows.heads || [], rows.lines || [], rows.bills || []);
  return b;
}
// each ledger's part of a context (its settings, its groups up to the top, its GSTIN, the party switch): a new context
// moves the entries on the ledgers whose part changed, and the entries whose place of supply typed changed. all: the
// state moved (every entry)
export function ctxDiff(a, c) {
  if (!a) return { all: true, ledgers: [], guids: [] };
  const part = (x, n) => JSON.stringify([(x.map || {})[n] || null, E.ledGroupPath(x, n), (x.gstins || {})[n] || ""]);
  const names = new Set([].concat(Object.keys(a.map || {}), Object.keys(c.map || {}), Object.keys(a.under || {}), Object.keys(c.under || {}), Object.keys(a.gstins || {}), Object.keys(c.gstins || {})));
  const moved = [...names].filter((n) => part(a, n) !== part(c, n));
  // the names the copy's lines and entries carry (tally_lines.ledger, tally_vouchers.party: Tally's text with only its
  // line breaks taken out, migration 23's tally_nm; "&amp;" can stay as it came) are the ledger list's own keys (made
  // from those lines); the groups and GSTINs are kept under the cleaned name (ledClean: "&"). A ledger moved under
  // either form names every form of it the ledger list has, so the SQL finds its lines
  const byClean = new Map();
  [a, c].forEach((x) => Object.keys(x.map || {}).forEach((k) => { const n = E.ledClean(k); if (!byClean.has(n)) byClean.set(n, new Set()); byClean.get(n).add(k); }));
  const out = new Set(moved);
  moved.forEach((n) => (byClean.get(E.ledClean(n)) || []).forEach((k) => out.add(k)));
  const ledgers = [...out].sort();
  const ids = new Set([].concat(Object.keys(a.gstPosFix || {}), Object.keys(c.gstPosFix || {})));
  const guids = [...ids].filter((i) => JSON.stringify((a.gstPosFix || {})[i] || null) !== JSON.stringify((c.gstPosFix || {})[i] || null)).sort();
  return { all: String(a.stateOf || "") !== String(c.stateOf || ""), ledgers, guids };
}
// a batch's shares (rows: {client, heads, lines, bills} of gst_share_rows; ctx: ctxOf of the whole book) ->
// {shares: [{guid, ym, reg, sec, k1, k2, k3, n, ...}], errors: [{guid, error}: an entry whose share could not be worked
// out (the rest go on)], unknown: [ledgers not in the
// context: the batch is not to be kept, the context is to be made again]}
export function shares(rows, ctx) {
  const was = { S: G.S, CO: G.CO };
  try {
    const S = { books: null, coId: rows.client, companies: { [rows.client]: Object.assign({}, rows.co || {}, { id: rows.client }) }, sales: { cid: rows.client, list: [] }, gstYm: "" };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    const b = ctxBooks(ctx, rows); S.books = b;
    const unknown = new Set();
    b.vouchers.forEach((v) => v.ent.forEach((e) => { if (!b.map[e.l]) unknown.add(e.l); }));
    const out = [];
    const errors = [], docs = [];
    b.vouchers.forEach((v) => {
      try {
        const x = E.entryShares(v);
        x.rows.forEach((r) => out.push(Object.assign({ guid: v.id, ym: x.ym, reg: x.reg }, r)));
        // part B: the entry's document (2B matching) and bill-wise allocations (rule 37), one row an entry (gst_itc_doc)
        // (an entry with no month of six digits, a cancelled one with an odd date: its document is its error, the rest go on)
        if (x.doc || x.bills.length) { if (/^\d{6}$/.test(x.ym)) docs.push(itcRow(v.id, x)); else errors.push({ guid: v.id, error: "its document could not be kept: month " + (x.ym || "none") }); }
      } catch (e) { errors.push({ guid: v.id, error: String((e && e.message) || e).slice(0, 300) }); }
    });
    return { shares: out, docs, errors, unknown: [...unknown].sort() };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}
// part B: an entry's row of gst_itc_doc (migration 171): its document as GST2B.docOf made it (imp: an import) and its
// bill-wise allocations as GSTF.billRecs made them (the voucher of a bill kept as its id and dates), with the registration
// the document is in ("" when only the book's registrations can say: shareSrc's docs fills it) and the entry's (the
// allocations': rule 37 reads a registration's bills)
function itcRow(guid, x) {
  return { guid, ym: x.ym, doc_reg: x.doc ? String(x.doc.reg || "") : "", bill_reg: x.reg || "", doc: x.doc || null,
    bills: x.bills.map((r) => { const o = { l: r.l, name: r.name, amt: r.amt, date: r.date, nb: r.nb, reg: r.reg }; if (r.nb) Object.assign(o, { gross: r.gross, tax: r.tax, v: r.v }); return o; }) };
}
// today's engine on a month, in the shape of gst_month's rows (reg, sec, k1, k2, k3 -> n and the figures): 3.1 and 3.2
// from GSTR.sec31 (threeBm's own), GSTR-1 from GSTR.one; the marketplace sales kept in Sales are left out (they are not
// entries of the book: notes.market says how many there are). b: books() of the whole book, S set by the caller
const FIG = ["taxable", "igst", "cgst", "sgst", "cess", "qty"];
export function engineSums(ym, reg) {
  const out = new Map(), put = (sec, k1, k2, k3, o, keepN) => {
    const key = [reg, sec, k1, k2, k3].join("\u0001"), x = { reg, sec, k1: String(k1), k2: String(k2), k3: String(k3), n: keepN ? Number(o.n || 0) : null };
    FIG.forEach((f) => { x[f] = E.r2(E.num(o[f])); }); out.set(key, x);
  };
  const rows = E.GSTR.outward(ym, reg).filter((r) => !r.eco), inn = E.GSTR.inward(ym, reg).map((r) => E.GSTR.signedIn(r));
  const P = E.GSTR.sec31(rows, inn);
  put("3B.sale", "", "", "", P.taxableOut, true); put("3B.cn", "", "", "", P.cn, true); put("3B.zero", "", "", "", P.zero, true); put("3B.nil", "", "", "", P.nil, true);
  put("3B.nongst", "", "", "", P.nongst, true); put("3B.rcm", "", "", "", P.rcmOut, true); put("3B.unreg", "", "", "", P.toUnreg, true);
  P.unregPos.forEach((q) => put("3B.pos", q.pos, "", "", q, false));
  const one = E.GSTR.one(ym, reg), S1 = (l) => E.GSTR.sum(l);
  [["R1.B2B", one.b2b], ["R1.B2CL", one.b2cl], ["R1.B2C", one.b2c], ["R1.EXP", one.exp], ["R1.NIL", one.nil]].forEach(([s, l]) => put(s, "", "", "", S1(l), true));
  put("R1.CDNR+DBNR", "", "", "", S1(one.cdnr), true);
  one.b2cRates.forEach((q) => put("R1.B2CS", String(q.rate), "", "", q, true));
  one.hsn.forEach((h) => { ["b2b", "b2c"].forEach((k) => put("R1.HSN", h.hsn || "", String(h.rate), k, h[k], false)); put("R1.HSN", h.hsn || "", String(h.rate), "*", h, true); });
  // part B: table 4's books part (GSTR.sec4, qty its ineligible), 3.1(d) with its ineligible, table 5's parts by state and
  // kind, rule 42's common credit (GSTRev.common) and turnover by part (GSTRev.toPart: the entries', not the marketplace's)
  const P4 = E.GSTR.sec4(inn), q = (o) => Object.assign({}, o, { qty: o.ineligible });
  [["4.rcmIn", P4.rcmIn], ["4.impG", P4.impGoods], ["4.impS", P4.impServ], ["4.other", P4.other], ["4.blocked", P4.blocked], ["4.buy", P4.buy], ["4.rcm31", P.rcmOut]].forEach(([s4, o]) => put(s4, "", "", "", q(o), true));
  // next-gst-isd: 4(A)(4), the ISD's entries (a month with none has no row, as the cloud's sums have none)
  if (P4.isd && P4.isd.n) put("4.isd", "", "", "", q(P4.isd), true);
  const n5 = new Map();
  inn.filter((r) => E.GSTR.noTaxIn(r)).forEach((r) => { const p = E.GSTR.noTaxPart(r), k = p.k1 + "\u0001" + p.k2, x = n5.get(k) || { k1: p.k1, k2: p.k2, n: 0, taxable: 0 }; x.n++; x.taxable = E.r2(x.taxable + p.taxable); n5.set(k, x); });
  n5.forEach((x) => put("5.inw", x.k1, x.k2, "", x, true));
  const cm = E.GSTRev.common(ym, reg);
  if (cm.n) put("42.common", "", "", "", Object.assign({ n: cm.n }, cm.c), true);
  const to = new Map();
  rows.forEach((r) => { const k = E.GSTRev.toPart(r), x = to.get(k) || { n: 0, taxable: 0 }; x.n++; x.taxable = E.r2(x.taxable + (r.kind === "CDNR" ? -1 : 1) * E.num(r.taxable)); to.set(k, x); });
  to.forEach((x, k) => put("42.to", k, "", "", x, true));
  return out;
}
// the cloud's month rows (gst_month_get) in the same shape: one registration (or all, reg ""), CDNR and DBNR together,
// B2CS by rate, HSN by HSN and rate with its two halves
export function cloudSums(rows, reg) {
  const out = new Map(), put = (sec, k1, k2, k3, r, keepN) => {
    const key = [reg, sec, k1, k2, k3].join("\u0001");
    const x = out.get(key) || { reg, sec, k1, k2, k3, n: keepN ? 0 : null, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0 };
    if (keepN) x.n += Number(r.n || 0);
    FIG.forEach((f) => { x[f] = Math.round((x[f] + Number(r[f] || 0)) * 100) / 100; }); out.set(key, x);
  };
  (rows || []).filter((r) => r.sec !== "*" && (!reg || r.reg === reg)).forEach((r) => {
    if (r.sec === "R1.CDNR" || r.sec === "R1.DBNR") put("R1.CDNR+DBNR", "", "", "", r, true);
    else if (r.sec === "R1.B2CS") put("R1.B2CS", r.k1, "", "", r, true);
    else if (r.sec === "R1.HSN") { put("R1.HSN", r.k1, r.k2, r.k3, r, false); put("R1.HSN", r.k1, r.k2, "*", r, true); }
    else put(r.sec, r.k1, r.k2, r.k3, r, r.sec !== "3B.pos");
  });
  return out;
}
// every figure of both, to the paisa (a section one side has and the other has not: against zero)
export function compare(eng, cloud) {
  const keys = new Set([...eng.keys(), ...cloud.keys()]), diffs = [];
  let max = 0;
  keys.forEach((k) => {
    const a = eng.get(k), c = cloud.get(k), base = a || c;
    FIG.concat(["n"]).forEach((f) => {
      if (f === "n" && (base.n == null || (a && a.n == null) || (c && c.n == null))) return;
      const x = a ? Number(a[f] || 0) : 0, y = c ? Number(c[f] || 0) : 0, d = Math.round((y - x) * 100) / 100;
      if (Math.abs(d) >= 0.01) { diffs.push({ sec: base.sec, k1: base.k1, k2: base.k2, k3: base.k3, field: f, engine: x, sums: y, diff: d }); if (f !== "n") max = Math.max(max, Math.abs(d)); }
    });
  });
  return { ok: !diffs.length, diffs, max };
}
// a month of today's engine on the whole book (rows as for step) -> engineSums, with S set as step sets it
export function engineMonth(rows, ym, reg, o) {
  o = o || {};
  const was = { S: G.S, CO: G.CO };
  try {
    const co = Object.assign({}, rows.co || {}, { id: rows.client });
    const S = { books: null, coId: rows.client, companies: { [rows.client]: co }, sales: { cid: rows.client, list: [] }, gstYm: ym };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    const b = o.books || books(rows); S.books = b;
    return { sums: engineSums(ym, reg), books: b, market: (rows.sales || []).filter((v) => v && v.source === "market" && v.status !== "ignored" && String((v.x || {}).date || "").replace(/-/g, "").slice(0, 6) === ym).length };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}

// ---------------------------------------------------------------- next-gst-share part B (migration 171, shadow mode)
// The input tax credit side of a month (3B table 4, 5 and 6) worked out by today's engine (GSTR.threeB, the same text)
// on what the cloud keeps, not on the book: the month totals of every entry's share (gst_month: part A's sections and
// 4.*, 5.inw, 42.*), each entry's document and bill-wise allocations (gst_itc_doc), the client's work (its 2Bs, the ITC
// decisions taken, the figures typed or filed, the settings), gst-2b-match's run of the year, the movement of the
// suppliers whose bills rule 37 follows (gst_itc_inputs' owing) and the credit each month before carried out, kept in
// order (gst_itc_month). The engine reads these through S.books.shareSrc (GSTR.months, threeBm's base and its
// outward month-level parts, GST2B.run's documents, GSTF's bills and the suppliers' ledgers, GSTRev's turnover and common
// credit, GSTR.creditIn's credit carried in). inp:
//   {client, co, items (client_book_items), ctx (gst_share_ctx), sales (records), runs ({"<gstin>|<fy>": run}),
//    first, last (the book's first and last month), gstins (the registrations its entries carry), months ({ym: gst_month
//    rows, every registration}), docs ([gst_itc_doc rows]), moves ({ledger: [[ym, amount]]}), carry ({ym: {igst, cgst,
//    sgst, cess}} the credit a month carried out, as kept), out ({ym: {adv, amd, cust}}: the outward side's month-level
//    parts of 3.1 that are not kept by entry: advances, GSTR-1 amendments, the customers' IMS; none: worked out as the
//    engine would on no entries, i.e. nothing)}
const SUM_F = ["taxable", "cgst", "sgst", "igst", "cess"];
function sumRows(rows, sec, inel) {
  const o = { n: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, ineligible: 0 };
  rows.forEach((r) => { if (r.sec !== sec) return; o.n += Number(r.n || 0); SUM_F.forEach((f) => { o[f] = E.r2(o[f] + Number(r[f] || 0)); }); if (inel) o.ineligible = E.r2(o.ineligible + Number(r.qty || 0)); });
  return o;
}
function addSum(a, c) { const o = Object.assign({}, a); o.n += c.n; SUM_F.concat(["ineligible"]).forEach((f) => { o[f] = E.r2(o[f] + E.num(c[f])); }); return o; }
export function shareSrc(inp) {
  const M = inp.months || {}, rowsOf = (ym, reg) => (M[ym] || []).filter((r) => r.sec !== "*" && (!reg || r.reg === reg));
  const carry = inp.carry || {};
  return {
    months() {
      const m = []; let x = inp.first || "";
      if (x) while (x <= inp.last && m.length < 240) { m.push(x); x = E.GSTR.nextYm(x); }
      return m;
    },
    base(ym, reg) {
      const rows = rowsOf(ym, reg), S1 = (sec) => sumRows(rows, sec, false), S4 = (sec) => sumRows(rows, sec, true);
      const pos = new Map();
      rows.filter((r) => r.sec === "3B.pos").forEach((r) => { const x = pos.get(r.k1) || { pos: r.k1, taxable: 0, igst: 0 }; x.taxable = E.r2(x.taxable + Number(r.taxable || 0)); x.igst = E.r2(x.igst + Number(r.igst || 0)); pos.set(r.k1, x); });
      let P31 = { taxableOut: S1("3B.sale"), cn: S1("3B.cn"), zero: S1("3B.zero"), nil: S1("3B.nil"), nongst: S1("3B.nongst"), rcmOut: S4("4.rcm31"), toUnreg: S1("3B.unreg"), unregPos: [] };
      // the marketplace sales kept in Sales (not entries): as outward has them, by the engine's own sec31
      const ms = E.GSTR.fromSales(ym);
      if (ms.length) {
        const q = E.GSTR.sec31(ms, []);
        ["taxableOut", "cn", "zero", "nil", "nongst", "toUnreg"].forEach((k) => { P31[k] = addSum(P31[k], q[k]); });
        q.unregPos.forEach((p) => { const x = pos.get(p.pos) || { pos: p.pos, taxable: 0, igst: 0 }; x.taxable = E.r2(x.taxable + p.taxable); x.igst = E.r2(x.igst + p.igst); pos.set(p.pos, x); });
      }
      P31.unregPos = [...pos.values()].sort((a, c) => a.pos.localeCompare(c.pos));
      const P4 = { rcmIn: S4("4.rcmIn"), impGoods: S4("4.impG"), impServ: S4("4.impS"), isd: S4("4.isd"), other: S4("4.other"), blocked: S4("4.blocked"), buy: S4("4.buy") };
      const no5 = rows.filter((r) => r.sec === "5.inw").map((r) => ({ k1: r.k1, k2: r.k2, taxable: Number(r.taxable || 0) }));
      return { P31, P4, no5 };
    },
    out(ym) { return inp.out ? inp.out[ym] || null : null; },
    common(ym, reg) {
      const c = { igst: 0, cgst: 0, sgst: 0, cess: 0 }; let n = 0;
      rowsOf(ym, reg).filter((r) => r.sec === "42.common").forEach((r) => { n += Number(r.n || 0); Object.keys(c).forEach((h) => { c[h] = E.r2(c[h] + Number(r[h] || 0)); }); });
      return { c, n };
    },
    turnover(ym, reg) {
      const t = { T: 0, Z: 0, E: 0 };
      rowsOf(ym, reg).filter((r) => r.sec === "42.to").forEach((r) => { t[r.k1] = (t[r.k1] || 0) + Number(r.taxable || 0); });
      return t;
    },
    // the documents in the book's order (gst_calc_rows: by day, then GUID in the database's order: gst_itc_inputs gives
    // them so, and only the day is sorted here, keeping it); the registration filled as bookDocs fills it
    docs(regs) {
      return (inp.docs || []).filter((r) => r.doc).map((r) => r.doc).sort((a, c) => String(a.bookDate).localeCompare(String(c.bookDate)))
        .map((d) => { const x = Object.assign({}, d); if (!x.reg && regs.length === 1) x.reg = regs[0]; return x; });
    },
    // the allocations in the book's order: as gst_itc_inputs gives them ([{guid, seq, rec}], by day, GUID and place), the
    // day sorted here keeping the rest; else with the documents (rows in GUID order)
    bills() {
      const out = [];
      if (inp.bills && inp.bills.length) inp.bills.forEach((x) => out.push({ d: String(x.rec.date), b: x.rec }));
      else (inp.docs || []).forEach((r) => (r.bills || []).forEach((b) => out.push({ d: String(b.date), b })));
      out.sort((a, c) => a.d.localeCompare(c.d));
      return out.map((x) => x.b);
    },
    moves() { const o = {}; Object.keys(inp.moves || {}).forEach((l) => { o[l] = inp.moves[l].map((x) => [String(x[0]), Number(x[1])]); }); return o; },
    carry(prev) { return carry[prev] ? { pay: { carry: Object.assign({}, carry[prev]) } } : null; },
  };
}
// the books the month step reads: the client's work as books() puts it, the context (ledger list, groups, GSTINs, places
// of supply typed) over it, no entries, and shareSrc
function monthBook(inp) {
  const b = { cid: inp.client, vouchers: [], map: {} };
  if (G.S && typeof G.S === "object") G.S.books = b;
  const by = {};
  (inp.items || []).forEach((r) => { if (r && !r.deleted && FROM_TALLY.indexOf(r.key) < 0) (by[r.key] = by[r.key] || []).push({ k: r.key, i: r.item || "", o: r.ord, d: r.data }); });
  Object.keys(by).sort().forEach((k) => { const v = E.BookItems.join(by[k]); if (v !== undefined) b[k] = v; });
  const c = inp.ctx || {};
  Object.assign(b, { map: c.map || {}, under: c.under || {}, groups: c.groups || {}, gstins: c.gstins || {}, gstPosFix: c.gstPosFix || {} });
  if (c.stateOf) b.stateOf = c.stateOf;
  b.meta = Object.assign({}, b.meta || {}, { bills: 1, gstins: (inp.gstins || []).slice().sort() });
  b.shareSrc = shareSrc(inp);
  return b;
}
// one month after another (in order: each takes the credit the month before carried, as kept or as worked out here),
// as step works a month out (S.gstYm the month, its year's 2B matching in M2B.st, the 3Bs before it kept in the memo)
// -> {months: [{ym, result (boxes), carry}]}
export function itcMonths(inp, reg, yms) {
  const was = { S: G.S, CO: G.CO, perRender: G.perRender, IN_RENDER: G.IN_RENDER, RENDER_GEN: G.RENDER_GEN };
  try {
    const co = Object.assign({}, inp.co || {}, { id: inp.client });
    const S = { books: null, coId: inp.client, companies: { [inp.client]: co }, sales: { cid: inp.client, list: inp.sales || [] }, gstYm: "" };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    inp = Object.assign({}, inp, { carry: Object.assign({}, inp.carry || {}) });
    const b = monthBook(inp); S.books = b;
    E.GSTR._carry = null; E.GST2B._memo = null; E.GSTAdv._memo = null; E.GSTF._bills = null; E.GSTF._owe = null; E.M2B.st = {};
    const gstin = (E.GSTR.gstins(b) || []).find((g) => g.slice(0, 2) === reg) || "", have = {}, done = [];
    for (const m of yms) {
      S.gstYm = m; E.M2B.st = {};
      const fy = E.M2B.fyOf(m), r2b = (inp.runs || {})[gstin + "|" + fy];
      if (r2b) E.M2B.st[E.M2B.key(reg, fy)] = { run: r2b };
      E.GST2B._memo = null; E.GSTR._carry = null;
      const memo = new WeakMap(), g = new Map();
      memo.set(E.GSTR, g);
      Object.keys(have).forEach((k) => { if (k < m) g.set("3b|" + k + "|" + reg, have[k]); });
      G.IN_RENDER = 1; G.RENDER_GEN = ++GEN;
      G.perRender = (obj, key, fn) => { let x = memo.get(obj); if (!x) memo.set(obj, x = new Map()); if (x.has(key)) return x.get(key); const v = fn(); x.set(key, v); return v; };
      const res = boxes(E.GSTR.threeB(m, reg));
      have[m] = res; inp.carry[m] = res.pay.carry;          // (the src reads the same object)
      done.push({ ym: m, result: res, carry: res.pay.carry });
    }
    return { months: done };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}
// today's engine on the whole book (rows as for step, its 2B runs too), the months asked as step works them out (o.kept:
// the 3Bs of earlier months it worked out before, as step's kept), and each month's outward month-level parts (advances,
// amendments, customers' IMS) up to the last month asked (from o.outFrom), for the month step (o.out: those worked out
// before) ->
// {months: {ym: boxes}, out: {ym: {adv, amd, cust}}, books}
export function engineItc(rows, reg, yms, o) {
  o = o || {};
  const r = step(rows, reg, o.kept || {}, { only: yms, max: 1e6, ready: 1e15, total: 1e15, books: o.books });
  const was = { S: G.S, CO: G.CO, perRender: G.perRender };
  try {
    const S = { books: r.books, coId: rows.client, companies: { [rows.client]: Object.assign({}, rows.co || {}, { id: rows.client }) }, sales: { cid: rows.client, list: rows.sales || [] }, gstYm: "" };
    G.S = S; G.CO = (cid) => S.companies[cid || S.coId];
    E.GSTAdv._memo = null;
    const memo = new WeakMap();
    G.perRender = (obj, key, fn) => { let x = memo.get(obj); if (!x) memo.set(obj, x = new Map()); if (x.has(key)) return x.get(key); const v = fn(); x.set(key, v); return v; };
    const out = Object.assign({}, o.out || {}), last = yms.slice().sort().pop() || "";
    E.GSTR.months().filter((m) => m <= last && m >= (o.outFrom || "") && !out[m]).forEach((m) => { S.gstYm = m; out[m] = boxes({ adv: E.GSTAdv.month(m, reg).net, amd: E.GSTR.amendDiff(m, reg), cust: typeof E.CustIMS === "object" ? E.CustIMS.month(m, reg) : null }); });
    const months = {}; r.months.forEach((x) => { months[x.ym] = x.result; });
    return { months, out, books: r.books };
  } finally {
    Object.assign(G, was);
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; });
  }
}
// the tables of a 3B: 4 (the credit, its reversals, ineligible, the 2B basis's held and released), 5, 3.1(d), 6 (the
// payment, the credit carried in and out) and the rest (3.1, 3.2) -> the table of a box
const ITC_TABLE = { impGoods: "4", impServ: "4", rcmIn: "4", isd: "4", other: "4", itc: "4", blocked: "4", reversal: "4", rules: "4", r42: "4", r43: "4", rev1: "4", rev2: "4", reclaim: "4", r37: "4", na: "4",
  netItc: "4", ineligible: "4", held: "4", released: "4", cn2b: "4", rejBack: "4", buy: "4", basis: "4", inw5: "5", rcmOut: "3.1d", opening: "6", pay: "6", payable: "6", pmt: "6", cashAfter: "6", pmtLeft: "6" };
// every box of both (the engine's and the month step's), to the paisa; the documents behind a box by their count
export function itcCompare(eng, cloud) {
  const diffs = [], seen = new Set(); let max = 0;
  const walk = (a, c, p) => {
    if ((a && typeof a === "object") || (c && typeof c === "object")) {
      const ks = new Set([...Object.keys(a && typeof a === "object" ? a : {}), ...Object.keys(c && typeof c === "object" ? c : {})]);
      ks.forEach((k) => { if (!p.length && (k === "engine" || k === "src" || k === "fp")) return; walk(a && typeof a === "object" ? a[k] : undefined, c && typeof c === "object" ? c[k] : undefined, p.concat([k])); });
      return;
    }
    const num = (x) => typeof x === "number" || x === undefined || x === null;
    if (num(a) && num(c)) {
      const d = Math.round((Number(c || 0) - Number(a || 0)) * 100) / 100;
      if (Math.abs(d) >= 0.01) { diffs.push({ table: ITC_TABLE[p[0]] || "3.1", box: p.join("."), engine: a == null ? null : a, cloud: c == null ? null : c, diff: d }); max = Math.max(max, Math.abs(d)); }
    } else if (String(a) !== String(c)) diffs.push({ table: ITC_TABLE[p[0]] || "3.1", box: p.join("."), engine: a == null ? null : a, cloud: c == null ? null : c });
    seen.add(p[0]);
  };
  walk(eng, cloud, []);
  const tables = {}; diffs.forEach((d) => { tables[d.table] = (tables[d.table] || 0) + 1; });
  return { ok: !diffs.length, diffs, max, tables };
}
