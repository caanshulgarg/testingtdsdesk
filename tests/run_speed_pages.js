// node run_speed_pages.js - next-speed-pages (11-Nov-2026): the pages of a large client (made-up books of 51,758 entries)
// worked the same figures out again and again. Each fix keeps an answer, or reads less; none may change a figure:
//   A. TDS.allRows (and the TCS rows, the TDS payments) kept across drawings while the books are the same: the kept rows
//      against TDS.allRowsNow at every step (a save, an allocation or a row changed in place, entries added or replaced,
//      the ledger map, PANs, the PAN book, Tally's TDS lines, the Closed periods' dates, edits, another client and back,
//      outside a drawing); the reversals kept with them;
//   B. BookItems' 45-second round with nothing new: the work part is not copied, cut into items and hashed again; every
//      change still reaches the server (one made in place without a save, one the server's older copy overwrote in the
//      record, a failed send, a mass removal held back and then allowed), and after each pass the record agrees with the
//      books item by item;
//   C. the statements read MIS.msme once per task, not once per trade payable; a change to the MSME list is seen;
//   D. Audit.balances' balance at a date, carried on from an earlier one: against the old reading of every entry for many
//      dates, opening balances from the masters and from Tally, cancelled and optional entries, entries out of date order,
//      an entry changed and saved, a caller changing the answer;
//   E. MIS.compliance (the Reports list) kept across drawings while the books and the client's settings are the same.
// Made-up books only (seeded; no client's name or figure).
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const vm = require("vm"), {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "clone", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "TDSSep", "TDSTally", "noPanRate", "NO_PAN_RATE", "istParts", "p2ist", "istDay", "istToday", "TCS27EQ", "FinSt",
  "RENDER_GEN", "BOOKS_REV", "drawStamp", "memoKeep", "REACT_SCOPE", "reactScopeEnd", "reactScope", "perRender", "memoScope", "fpHash", "stableStr", "BookSync", "BookItems"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => { vm.runInContext("BOOKS_REV++", ctx); }; ctx.whoAmI = () => "t"; ctx.render = () => {}; ctx.S.data = {};
const J = JSON.stringify, S = ctx.S, T = x.TDS;
const saved = () => vm.runInContext("BOOKS_REV++", ctx);
const draw = f => x.memoScope(f);                                  // a drawing of the page (render, memoScope)
const tick = () => new Promise(r => setImmediate(r));              // the end of a task

function rng(seed){ let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const r2 = n => Math.round(n * 100) / 100, pad = (n, w) => String(n).padStart(w, "0");
// made-up books with TDS: bills with TDS (journals with and without a party named), TDS paid by bank, a TDS ledger
// debited back (a reversal), sales with TCS, purchases, payments
function makeBooks(nV, seed, first, span){
  const R = rng(seed), under = {}, pans = {}, V = [], sup = [], cus = [], exp = ["Professional Fees 01", "Freight Charges 02", "Rent Paid 03"];
  for (let i = 0; i < 30; i++){ const n = "Made Up Supplier " + seed + "-" + pad(i, 3); sup.push(n); under[n] = "Sundry Creditors"; if (i % 3) pans[n] = "AAAC" + String.fromCharCode(65 + i % 26) + pad(i, 4) + "K"; }
  for (let i = 0; i < 10; i++){ const n = "Made Up Customer " + seed + "-" + pad(i, 3); cus.push(n); under[n] = "Sundry Debtors"; }
  exp.forEach(n => { under[n] = "Indirect Expenses"; });
  Object.assign(under, {"Made Up Bank": "Bank Accounts", "Sales 18%": "Sales Accounts", "TDS Payable 194C": "Duties & Taxes", "TDS Payable 194J 10%": "Duties & Taxes", "TCS Payable 206C(1H)": "Duties & Taxes"});
  const ymAt = k => { const y = +String(first).slice(0, 4), m = +String(first).slice(4, 6) - 1 + k; return (y + Math.floor(m / 12)) + pad(m % 12 + 1, 2); };
  for (let i = 0; i < nV; i++){
    const date = ymAt(Math.floor(i * span / nV)) + pad(1 + Math.floor(R() * 28), 2), amt = r2(1000 + Math.floor(R() * 90000)), kind = i % 7;
    const s = sup[Math.floor(R() * sup.length)], c = cus[Math.floor(R() * cus.length)], e = exp[i % 3];
    const v = {id: "v" + seed + "-" + i, no: String(i + 1), ref: "", party: "", narr: "", date};
    if (kind === 0){ const t = r2(amt * 0.02); Object.assign(v, {type: "Journal", party: s, ent: [{l: e, a: -amt}, {l: s, a: r2(amt - t)}, {l: "TDS Payable 194C", a: t}]}); }
    else if (kind === 1){ const t = r2(amt * 0.1); Object.assign(v, {type: "Journal", ent: [{l: "Professional Fees 01", a: -amt}, {l: s, a: r2(amt - t)}, {l: "TDS Payable 194J 10%", a: t}]}); }
    else if (kind === 2){ const t = r2(amt * 0.02); Object.assign(v, {type: "Payment", ent: [{l: "TDS Payable 194C", a: -t}, {l: "Made Up Bank", a: t}]}); }
    else if (kind === 3){ const t = r2(amt * 0.001); Object.assign(v, {type: "Sales", party: c, ent: [{l: c, a: -r2(amt + t)}, {l: "Sales 18%", a: amt}, {l: "TCS Payable 206C(1H)", a: t}]}); }
    else if (kind === 4 && i % 21 === 4){ const t = r2(amt * 0.001); Object.assign(v, {type: "Journal", ent: [{l: "TDS Payable 194C", a: -t}, {l: s, a: t}]}); }
    else if (kind === 5){ Object.assign(v, {type: "Payment", party: s, ent: [{l: s, a: -amt}, {l: "Made Up Bank", a: amt}]}); }
    else { Object.assign(v, {type: "Journal", party: s, ent: [{l: e, a: -amt}, {l: s, a: amt}]}); }
    if (i % 41 === 40) v.cancel = true;
    if (i % 53 === 52) v.opt = true;
    V.push(v);
  }
  V.sort((a, c) => a.date < c.date ? -1 : a.date > c.date ? 1 : 0);
  const b = {cid: "c" + seed, vouchers: V, under, pans, gstins: {}, groups: {}, states: {}, challans: [], alloc: {}, ledInfo: {}};
  b.map = x.Books.mapLedgers(V, {});
  return b;
}
const CO_OF = seed => ({id: "c" + seed, name: "Made Up Trading Company " + seed, choices: {}});
function open(b){ S.books = b; S.coId = b.cid; S.companies = Object.assign(S.companies || {}, {[b.cid]: S.companies && S.companies[b.cid] || CO_OF(b.cid.slice(1))}); ctx.CO = () => S.companies[S.coId]; if (!b._refreshed){ b._refreshed = 1; try { x.LedMaster.refresh(b); } catch (e){} } }

// ---------------------------------------------------------------- A. TDS rows kept across drawings
async function sectionA(){
  const NOW = T.allRowsNow; let n = 0;
  T.allRowsNow = function(){ n++; return NOW.apply(this, arguments); };
  const fresh = () => { const r = J(NOW.call(T)); return {rows: r, rev: J(T._rev || [])}; };
  const tcsFresh = () => J(T.tcsRowsNow()), payFresh = () => J(T.paymentsFromBooksNow());
  const same = (w, wantCount) => {
    const before = n, got = draw(() => ({rows: J(T.allRows()), rev: J(T.reversals()), tcs: J(T.tcsRows()), pay: J(T.paymentsFromBooks())})), did = n - before;
    const f = fresh();
    ok(got.rows === f.rows && got.rev === f.rev && got.tcs === tcsFresh() && got.pay === payFresh(), "A. " + w + ": the rows, reversals, TCS rows and payments are those worked out afresh (" + JSON.parse(f.rows).length + " rows)");
    if (wantCount != null) ok(did === wantCount, "A. " + w + ": worked out " + did + " time(s) (expected " + wantCount + ")");
    return JSON.parse(got.rows);
  };
  const b1 = makeBooks(700, 21, 202404, 18); open(b1);
  let rows = same("the first drawing", 1);
  ok(rows.length > 50 && JSON.parse(fresh().rev).length > 0, "A. the made-up books have deductions (" + rows.length + ") and reversals");
  same("the next drawing, nothing changed", 0);
  same("a third drawing", 0);
  saved(); same("the books saved", 1);
  b1.alloc[rows[3].id] = "CH-1"; rows = same("a row put on a challan in place, not saved", 1);
  ok(rows[3].challan === "CH-1", "A. the allocation is on the row");
  draw(() => { T.allRows()[5].tds = 123456; }); rows = same("a kept row changed in place by a caller", 1);
  ok(rows[5].tds !== 123456, "A. the changed row is not handed out again");
  b1.vouchers.push({id: "late-1", no: "L1", date: "20251010", type: "Journal", party: "", ent: [{l: "Rent Paid 03", a: -50000}, {l: "Made Up Supplier 21-001", a: 45000}, {l: "TDS Payable 194C", a: 5000}]});
  same("an entry added in place", 1);
  b1.vouchers = b1.vouchers.slice(); same("the list of entries replaced", 1);
  b1.vouchers[10].date = "20240402"; saved(); same("an entry's date changed and saved", 1);
  b1.vouchers[20].ent[0].a = x.r2(b1.vouchers[20].ent[0].a + 1); b1.vouchers[20].ent[1].a = x.r2(b1.vouchers[20].ent[1].a - 1); saved(); same("an entry's amounts changed and saved", 1);
  b1.vouchers[30].cancel = true; saved(); same("an entry cancelled and saved", 1);
  b1.vouchers[40] = Object.assign({}, b1.vouchers[40], {party: "Made Up Supplier 21-011"}); same("an entry replaced in the list (the cloud copy's merge), not saved", 1);
  b1.map = Object.assign({}, b1.map); b1.mapV = (b1.mapV || 0) + 1; same("the ledger map changed", 1);
  const p0 = rows.find(r => r.party && !r.pan); if (p0){ b1.pans[p0.party] = "ABCDE1234F"; rows = same("a PAN added in place", 1); ok(rows.find(r => r.id === p0.id).pan === "ABCDE1234F", "A. the PAN is on the row"); }
  b1.panFix = {[rows[0].party]: {pan: "PQRST6789K"}}; same("the PAN book changed", 1);
  ctx.TCloud = {tdsl: {[b1.cid]: {rows: [{guid: rows[1].id.split("|")[0], assessable: "77777", amount: String(rows[1].tds)}]}}}; same("Tally's TDS lines came from the cloud", 1);
  ctx.TCloud.tdsl[b1.cid].rows = []; same("Tally's TDS lines read again", 1);
  ctx.CO().closed = {tdsFiled: {"2024-25|Q2": "20241031"}}; same("a quarter marked filed in Closed periods", 1);
  b1.tdsEdits = {[rows[2].id]: {party: "Made Up Supplier 21-009"}}; same("a deduction corrected in FinCom", 1);
  b1.tdsEdits[rows[2].id].party = "Made Up Supplier 21-010"; same("the correction changed in place", 1);
  const b2 = makeBooks(300, 22, 202504, 6); open(b2); same("another client's books", 1);
  open(b1); same("back to the first client: its own rows, kept", 0);
  open(b2); same("the second client again, kept", 0);
  open(b1);
  { const before = n; T.allRows(); T.allRows(); ok(n - before === 2, "A. outside a drawing the rows are worked out afresh at each ask, as before"); }
  same("a drawing after asks outside one", 0);
  T.allRowsNow = NOW; delete ctx.TCloud;
}

// ---------------------------------------------------------------- B. BookItems: the 45-second round with nothing new
async function sectionB(){
  const BI = x.BookItems, BS = x.BookSync, calls = [], server = {rows: [], fail: 0};
  ctx.Cloud = {on: () => true, st: {firm: "f1"}, api: async (path, o) => {
    calls.push(path);
    if (path.startsWith("client_books?")) return [];
    if (path.startsWith("client_book_items?")){ const r = server.rows; server.rows = []; return r; }
    if (path === "rpc/save_book_items"){ if (server.fail){ server.fail--; throw new Error("network down"); } calls.push({sent: o.body.p_items}); return {ok: true}; }
    throw new Error("unexpected " + path);
  }};
  ctx.Live = {saving(){}, saved(){}, fail(){}, ok(){}, me: () => "u-me", noteItems(){}, sv: {}};
  ctx.IDBStore = {get: async () => null, write: async () => {}};
  ctx.LK = {cache: {}};
  const b = makeBooks(400, 31, 202504, 6); open(b);
  b.challans = [{id: "CH-A", tax: 100}, {id: "CH-B", tax: 200}];
  b.alloc = {}; for (let i = 0; i < 40; i++) b.alloc["row-" + i] = i % 2 ? "CH-A" : "CH-B";
  b.audit = {last: {findings: Array.from({length: 300}, (_, i) => ({id: "f" + i, rows: [{a: i, b: "x".repeat(50)}]}))}};
  b.letters = {conf: {}, rem: {}, contacts: {}, cfg: {}};
  let splits = 0, works = 0; const SPLIT = BI.split, WORK = BS.work;
  BI.split = function(){ splits++; return SPLIT.apply(this, arguments); };
  BS.work = function(bb, keys){ if (!keys) works++; return WORK.apply(this, arguments); };
  const sent = () => calls.filter(c => c && c.sent).reduce((a, c) => a.concat(c.sent), []);
  const agrees = (w) => {
    const s = BI.st[b.cid], m = SPLIT.call(BI, WORK.call(BS, b)); let bad = 0;
    m.forEach((it, key) => { if (s.base[key] !== BI.h(it.d, it.o)) bad++; });
    ok(bad === 0, "B. " + w + ": the record of what the server has agrees with the books, item by item (" + m.size + " items)");
  };
  const pass = async (w, want) => {
    calls.length = 0; splits = 0; works = 0;
    await BI.pullNow(b.cid);
    const items = sent();
    if (want.n != null) ok(items.length === want.n, "B. " + w + ": " + items.length + " item(s) sent (expected " + want.n + ")" + (want.keys ? " " + J(items.map(z => z.k + z.i)) : ""));
    if (want.keys) ok(J(items.map(z => z.k + z.i).sort()) === J(want.keys.slice().sort()), "B. " + w + ": the items sent are " + J(want.keys));
    if (want.idle) ok(splits === 0 && works === 0, "B. " + w + ": the work part was not copied, cut or hashed (copies " + works + ", cuts " + splits + ")");
    return items;
  };
  const first = await pass("the first round", {}).catch(e => { ok(false, "B. the first round: " + e.message); return []; });
  ok(first.length > 100, "B. the first round sends the whole work part as items (" + first.length + ")");
  agrees("after the first round");
  await pass("the next round, nothing new and nothing changed", {n: 0, idle: true});
  await pass("and the next", {n: 0, idle: true});
  b.alloc["row-new"] = "CH-A";
  await pass("an allocation made in place, not saved", {n: 1, keys: ["alloc.row-new"]}); agrees("after it");
  await pass("the round after", {n: 0, idle: true});
  // the server sends an older copy of an item changed here since: the record moves, the books keep this computer's
  BI.st[b.cid].editAt = Date.now();
  b.alloc["row-1"] = "CH-B";
  server.rows = [{key: "alloc", item: ".row-1", ord: null, data: "CH-OLD", deleted: false, seq: 7, updated_at: new Date(Date.now() - 60000).toISOString(), updated_by: "u-other"}];
  await pass("an older copy came from the server while changed here", {n: 1, keys: ["alloc.row-1"]});
  ok(b.alloc["row-1"] === "CH-B", "B. this computer's later change stays"); agrees("after it");
  // a newer copy from the server: taken, nothing to send back
  server.rows = [{key: "alloc", item: ".row-2", ord: null, data: "CH-NEW", deleted: false, seq: 8, updated_at: new Date(Date.now() + 60000).toISOString(), updated_by: "u-other"}];
  await pass("a newer copy came from the server", {n: 0});
  ok(b.alloc["row-2"] === "CH-NEW", "B. the server's newer copy is in the books"); agrees("after it");
  await pass("the round after", {n: 0, idle: true});
  // a send that fails: sent again at the next round
  b.letters.cfg.signer = "Made Up Signer"; server.fail = 1;
  calls.length = 0; await BI.pullNow(b.cid);
  ok(BI.st[b.cid].error === "network down", "B. a failed send is noted");
  await pass("the round after a failed send", {n: 1, keys: ["letters.cfg"]}); agrees("after it");
  // most of the allocations taken out here: held back (never inferred), not marked done; then allowed
  for (let i = 0; i < 30; i++) delete b.alloc["row-" + i];
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  await pass("most allocations taken out: held back", {n: 0});
  await pass("held back again at the next round (looked at again)", {n: 0});
  ok(warned === 2 && splits > 0, "B. the held removal is looked at in every round (" + warned + " warnings)");
  console.warn = warn;
  BI.allowMass = {[b.cid + "|alloc"]: 1};
  const gone = await pass("the removal allowed", {n: 30});
  ok(gone.every(z => z.del && z.k === "alloc"), "B. the 30 allocations are removed on the server"); agrees("after it");
  await pass("the round after", {n: 0, idle: true});
  // a change from saveBooks' path (BOOKS_REV) and a whole part replaced
  b.challans = b.challans.concat([{id: "CH-C", tax: 300}]); saved();
  await pass("a challan added and saved", {n: 1, keys: ["challans#CH-C"]}); agrees("after it");
  b.audit = {last: {findings: []}};
  const au = await pass("the audit's findings replaced", {n: 1}); ok(au[0] && au[0].k === "audit", "B. the audit part is sent"); agrees("after it");
  await pass("the last round", {n: 0, idle: true});
  BI.split = SPLIT; BS.work = WORK;
}

(async () => {
  for (const f of [sectionA, sectionB]) await f();
  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("  FAIL " + (e && e.stack || e)); process.exit(1); });
