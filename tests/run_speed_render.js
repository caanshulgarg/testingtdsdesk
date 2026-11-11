// node run_speed_render.js - next-speed-render (11-Nov-2026): the workings behind MIS, Audit, the TDS ledgers, the Reports
// list and the tie-out, now worked out in steps behind the page (app/src/lib/behind.jsx; tests/run_speed_render.py the
// pages). None may change a figure:
//   M. MIS.moves (the amounts by ledger and month a profit and loss is made of) carried on from an amount kept to an earlier
//      date with the same start: against the reading of every entry for many periods, after an entry changed and saved,
//      replaced, added out of date order, cancelled; a caller changing an answer; and the tie-out's 25 profits from the
//      year's start read the entries about once, not once a month-end;
// Made-up books only (seeded; no client's name or figure).
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const vm = require("vm"), {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "clone", "esc", "MONTHS", "fmtDate", "tallyDate", "Books", "LedMaster", "Audit", "MIS", "Parties", "GSTR", "TDS", "INR", "FS",
  "RENDER_GEN", "BOOKS_REV", "drawStamp", "memoKeep", "REACT_SCOPE", "reactScopeEnd", "reactScope", "perRender", "memoScope"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.render = () => {}; ctx.S.data = {};
const J = JSON.stringify, S = ctx.S;
const saved = () => vm.runInContext("BOOKS_REV++", ctx);
function rng(seed){ let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const r2 = n => Math.round(n * 100) / 100, pad = (n, w) => String(n).padStart(w, "0");
// made-up books: sales, bills, receipts, payments, expenses over `span` months from `first` (yyyymm)
function makeBooks(nV, seed, first, span){
  const R = rng(seed), under = {}, V = [], sup = [], cus = [];
  for (let i = 0; i < 20; i++){ const s = "Made Up Supplier " + seed + "-" + i, c = "Made Up Customer " + seed + "-" + i; sup.push(s); cus.push(c); under[s] = "Sundry Creditors"; under[c] = "Sundry Debtors"; }
  Object.assign(under, {"Made Up Bank": "Bank Accounts", "Sales 18%": "Sales Accounts", "Purchases": "Purchase Accounts", "Rent Paid": "Indirect Expenses", "Staff Salary": "Indirect Expenses"});
  const ymAt = k => { const y = +String(first).slice(0, 4), m = +String(first).slice(4, 6) - 1 + k; return (y + Math.floor(m / 12)) + pad(m % 12 + 1, 2); };
  for (let i = 0; i < nV; i++){
    const date = ymAt(Math.floor(i * span / nV)) + pad(1 + Math.floor(R() * 28), 2), amt = r2(1000 + R() * 90000), k = i % 6;
    const s = sup[Math.floor(R() * sup.length)], c = cus[Math.floor(R() * cus.length)];
    const ent = k === 0 ? [[c, -amt], ["Sales 18%", amt]] : k === 1 ? [["Purchases", -amt], [s, amt]] : k === 2 ? [["Made Up Bank", -amt], [c, amt]]
      : k === 3 ? [[s, -amt], ["Made Up Bank", amt]] : k === 4 ? [["Rent Paid", -amt], ["Made Up Bank", amt]] : [["Staff Salary", -amt], ["Made Up Bank", amt]];
    const v = {id: "v" + seed + "-" + i, no: String(i + 1), date, type: "Journal", party: "", narr: "", ent: ent.map(([l, a]) => ({l, a}))};
    if (i % 41 === 40) v.cancel = true;
    if (i % 53 === 52) v.opt = true;
    V.push(v);
  }
  V.sort((a, c) => a.date < c.date ? -1 : a.date > c.date ? 1 : 0);
  const b = {cid: "c" + seed, vouchers: V, under, pans: {}, gstins: {}, groups: {}, states: {}, challans: [], alloc: {}, ledInfo: {}, meta: {from: V[0].date, to: V[V.length - 1].date}};
  b.map = x.Books.mapLedgers(V, {});
  return b;
}
function open(b){ S.books = b; S.coId = b.cid; S.companies = Object.assign(S.companies || {}, {[b.cid]: {id: b.cid, name: "Made Up Trading Company", choices: {}}}); ctx.CO = () => S.companies[S.coId]; }

// ---------------------------------------------------------------- M. MIS.moves carried on from an earlier date
function sectionM(){
  const M = x.MIS;
  // the reading of every entry, as before next-speed-render (src/js/07-mis.js, origin/staging-next)
  const oldMoves = (b, from, to) => { const out = {}; (b.vouchers || []).forEach(v => { if (v.date < from || v.date > to || v.opt || v.cancel) return; const ym = v.date.slice(0, 6);
    v.ent.forEach(e => { const z = out[e.l] = out[e.l] || {}; z[ym] = x.r2((z[ym] || 0) + e.a); z.t = x.r2((z.t || 0) + e.a); }); }); return out; };
  const b = makeBooks(3000, 61, 202404, 25); open(b);
  const ends = []; for (let k = 0; k < 25; k++){ const y = 2024 + Math.floor((3 + k) / 12), m = (3 + k) % 12 + 1, last = new Date(y, m, 0).getDate(); ends.push(y + pad(m, 2) + pad(last, 2)); }
  const fyOf = d => (+d.slice(4, 6) >= 4 ? d.slice(0, 4) : String(+d.slice(0, 4) - 1)) + "0401";
  const periods = [["20240401", "20250331"], ["20250401", "20260331"], ["20250401", "20250430"], ["20250401", "20251015"], ["20240415", "20240415"], ["20250402", "20250401"], ["20240101", "20270101"], ["20260401", "20260430"]]
    .concat(ends.slice().reverse().map(e => [fyOf(e), e]), ends.map(e => [fyOf(e), e]));
  const check = w => { let bad = 0, first = ""; periods.forEach(([f, t]) => { if (J(M.moves(f, t)) !== J(oldMoves(b, f, t))){ bad++; if (!first) first = f + "-" + t; } });
    ok(bad === 0, "M. " + w + ": " + periods.length + " periods, each the same amounts in the same order as reading every entry" + (bad ? " (" + bad + " differ, first " + first + ")" : "")); };
  check("the first asks");
  check("asked again (carried on from the amounts kept)");
  { const a = M.moves("20250401", "20251031"); a["Made Up Bank"].t = 9e9; a["A New Name"] = {t: 1};
    ok(J(M.moves("20250401", "20251031")) === J(oldMoves(b, "20250401", "20251031")), "M. a caller changing an answer does not change the next"); }
  b.vouchers[700].ent[0].a = x.r2(b.vouchers[700].ent[0].a - 500); b.vouchers[700].ent[1].a = x.r2(b.vouchers[700].ent[1].a + 500); saved();
  check("an entry's amounts changed and saved");
  b.vouchers[900] = Object.assign({}, b.vouchers[900], {ent: b.vouchers[900].ent.map(e => ({l: e.l, a: x.r2(e.a * 3)}))});
  check("an entry replaced in the list, not saved");
  b.vouchers[1200].cancel = !b.vouchers[1200].cancel; saved();
  check("an entry cancelled and saved");
  b.vouchers.push({id: "late", no: "L", date: "20240505", type: "Journal", ent: [{l: "Made Up Bank", a: 10}, {l: "Rent Paid", a: -10}]});
  check("an entry added at the end, out of date order: read in full");
  b.vouchers.sort((a, c) => a.date < c.date ? -1 : a.date > c.date ? 1 : 0); b.vouchers = b.vouchers.slice();
  check("sorted again, a new list");
  const b2 = makeBooks(800, 62, 202504, 12); open(b2);
  ok(J(M.moves("20250401", "20260331")) === J(oldMoves(b2, "20250401", "20260331")), "M. another client's books: their own amounts");
  open(b);
  // the tie-out's profits: from the year's start to each of 25 month-ends, newest first, then oldest first; entries read
  const fresh = makeBooks(3000, 63, 202404, 25); let reads = 0;
  fresh.vouchers.forEach(v => { const e = v.ent; Object.defineProperty(v, "ent", {get(){ reads++; return e; }, configurable: true}); });
  open(fresh);
  ends.slice().forEach(e => M.moves(fyOf(e), e));
  const n = fresh.vouchers.length;
  ok(reads <= 2 * n, "M. the 25 profits from the year's start read the entries' amounts " + (reads / n).toFixed(1) + " times over (at most 2; read in full for each: 6)");
  reads = 0; ends.slice().reverse().forEach(e => M.moves(fyOf(e), e));
  ok(reads <= n / 10, "M. asked again newest first: " + reads + " entries read (kept on the way)");
}

sectionM();
console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
