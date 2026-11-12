// node tests/run_audit_auto_ist.js - the day's audit on its own in steps (Audit.autoStart, src/js/06), review of e5e0eb0ed.
// Made-up books only (tests/audit_fixture.js). The clock is India's (TZ=Asia/Kolkata) at 01:00 on 12-Nov-2026, when the
// UTC date is still the 11th; the page's timers are a queue this test runs task by task (each task one step: SLICE_MS 0).
//   1. Audit.due compares the local day of the last run's time: a run at 00:30 IST today is today's (it was taken as
//      yesterday's until 05:30 IST, as UTC), one at 23:30 IST yesterday is not;
//   2. a run by hand while the one on its own runs, at 01:00 IST: the run by hand stays (the one on its own stopped, not
//      started again and written over it);
//   3. the run in steps at 01:00 IST is the run at once (the times aside);
//   4. a finding marked while it runs (a save that changes nothing it reads: Audit.quietSave) does not start it again;
//   5. the books saved at every step: started again MAX_STARTS times; the last start's books changed on the way, so it
//      is not kept and runs once more, kept once; the result is the one at once on the books as they are at the end;
//      an entry added on the last start: not kept, once more, the run at once on the books with it (not stale); an
//      entry added on that one too: kept, and the Audit tab sees it no longer fits (Audit.stale: count and basis of
//      the start);
//   6. while the cloud copy's entries are being brought in (TCloud.loads) it takes no step; after, it goes on (a load
//      that changed nothing: not started again), or starts again (a load that brought an entry); a load that never
//      ends holds it at most WAIT_MAX_MS, then it goes on if the books are as they were;
//   7. an error in a step: no run kept, as before, and it is said (console and window.__fincomReport);
//   8. MIS.due compares the local day of the last pack's time, as Audit.due.
"use strict";
process.env.TZ = "Asia/Kolkata";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const vm = require("vm"), {load, HTML} = require("./harness"), {makeBooks, finish} = require("./audit_fixture");
// the page's calculation scope first (src/js/01: BOOKS_REV, JOB_MEMO, perRender), as the page has them
const NAMES = ["RENDER_GEN", "BOOKS_REV", "drawStamp", "REACT_SCOPE", "reactScopeEnd", "reactScope", "perRender", "memoScope", "num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSSep", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
// 01:00 IST on 12-Nov-2026 (19:30 UTC on the 11th), moving on with the real clock
const RealDate = Date, NOW = RealDate.parse("2026-11-11T19:30:00Z"), T0 = RealDate.now();
class FakeDate extends RealDate { constructor(...a){ if (a.length) super(...a); else super(NOW + (RealDate.now() - T0)); } static now(){ return NOW + (RealDate.now() - T0); } }
ctx.Date = FakeDate;
// the page's timers: a queue, run task by task
let Q = [];
ctx.setTimeout = (f) => { Q.push(f); return Q.length; };
const tasks = (n, until) => { let k = 0; while (Q.length && k < n){ if (until && until()) break; const f = Q.shift(); f(); k++; } return k; };
const drain = () => tasks(100000);
// a save of the books moves BOOKS_REV, as saveBooks does (src/js/18)
vm.runInContext("globalThis.saveBooks = function(){ BOOKS_REV++; };", ctx); ctx.whoAmI = () => "t"; ctx.S.data = {}; ctx.render = () => {};
const toasts = []; ctx.toast = (m) => { toasts.push(String(m)); };
const reported = []; ctx.window = {__fincomReport: (e, g) => reported.push([String(e && e.message), g])};
const A = x.Audit; A.AUTO.SLICE_MS = 0;
const J = JSON.stringify, copy = (o) => o == null ? o : JSON.parse(J(o));
const text = (au) => J(au || null).replace(/"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z"/g, '"AT"');
const f = makeBooks();
ctx.S.books = f.books; ctx.S.coId = "cfix"; ctx.S.companies = {cfix: f.company}; ctx.CO = () => f.company;
finish(f, x);
const b = f.books;
ok(A.today() === "20261112" && new ctx.Date().toISOString().slice(0, 10) === "2026-11-11", "the clock: " + A.today() + " here, " + new ctx.Date().toISOString() + " in UTC");
// the last run: yesterday (11-Nov, 12:00 IST), on its own
const r = A.defaultRange(b);
A.run(r.from, r.to, "on its own (daily)");
const setAt = (at) => { b.audit.last.at = at; b.audit.history[0].at = at; };
const yday = () => { setAt("2026-11-11T06:30:00.000Z"); b.audit.items = Object.fromEntries(Object.entries(b.audit.items || {}).map(([k, it]) => [k, Object.assign(it, {first: "2026-11-11T06:30:00.000Z", last: "2026-11-11T06:30:00.000Z"})])); };

// 1. due
yday();
ok(A.due(b) === true, "1. the last run at 12:00 IST yesterday: due");
setAt("2026-11-11T19:00:00.000Z");
ok(A.due(b) === false, "   the last run at 00:30 IST today (19:00 UTC the day before): not due");
setAt("2026-11-11T18:00:00.000Z");
ok(A.due(b) === true, "   the last run at 23:30 IST yesterday: due");

// 2. a run by hand while the one on its own runs
yday(); toasts.length = 0; Q = [];
A.maybeRun(); const j2 = A.auto;
tasks(1000, () => j2.prog.k >= 2);
const k2 = j2.prog.k;
const hand = A.run(r.from, r.to, "run now"); ctx.saveBooks();
drain();
ok(!!j2 && k2 >= 2 && A.auto === null && b.audit.last === hand && b.audit.last.how === "run now" && j2.starts === 1 && !toasts.some(t => /Audit ran on its own/.test(t)),
  "2. a run by hand at 01:00 IST after " + k2 + " checks of the one on its own: the run by hand stays (" + b.audit.last.how + ", " + j2.starts + " start, " + toasts.length + " said)");

// the run at once, from the audit as it was (a copy)
const once = (au0) => { const keep = b.audit; b.audit = copy(au0); x.memoScope(() => A.runNow(r.from, r.to, "on its own (daily)")); const t = text(b.audit); b.audit = keep; return t; };

// 3. the same result
yday(); const au3 = copy(b.audit); Q = []; toasts.length = 0;
A.maybeRun(); const j3 = A.auto; drain();
ok(!!j3 && j3.starts === 1 && b.audit.last.how === "on its own (daily)" && text(b.audit) === once(au3) && toasts.filter(t => /Audit ran on its own/.test(t)).length === 1,
  "3. the run in steps at 01:00 IST = the run at once (" + b.audit.last.findings.length + " findings, " + j3.slices.length + " tasks)");

// 4. a finding marked while it runs
yday(); const au4 = copy(b.audit); Q = [];
A.maybeRun(); const j4 = A.auto;
tasks(1000, () => j4.prog.k >= 2);
const fid = (b.audit.last.findings[0] || {}).id;
b.audit.st = b.audit.st || {}; b.audit.st[fid] = {s: "done", at: new ctx.Date().toISOString()}; A.quietSave();
drain();
ok(j4.starts === 1 && b.audit.last.how === "on its own (daily)" && text(b.audit) === once(Object.assign(au4, {st: copy(b.audit.st)})),
  "4. a finding marked while it runs (a quiet save): not started again (" + j4.starts + " start), the same result");

// 5. the books saved at every step
yday(); delete b.audit.st; const au5 = copy(b.audit); Q = []; toasts.length = 0;
A.maybeRun(); const j5 = A.auto; let saves = 0, added = 0;
const src = b.vouchers.find(v => x.Books.isSale(v) && v.date >= r.from && v.date <= r.to);
// an entry added at each of the first 3 saves, then the books only saved again
while (Q.length && saves < 20000){ const g = Q.shift(); g(); if (A.auto === j5){ if (added < 3){ b.vouchers = b.vouchers.concat([Object.assign(copy(src), {id: "zzsave-" + added, no: "ZS" + added})]); added++; } ctx.saveBooks(); saves++; } }
ok(A.auto === null && j5.starts === A.AUTO.MAX_STARTS + 1 && b.audit.last.how === "on its own (daily)" && text(b.audit) === once(au5) && b.vouchers.length === f.books.vouchers.length && toasts.filter(t => /Audit ran on its own/.test(t)).length === 1,
  "5. the books saved at every step (" + saves + " saves, " + added + " entries added): " + j5.starts + " starts (" + A.AUTO.MAX_STARTS + ", then once more), kept once; the run at once on the books as they are (" + b.audit.last.vouchers + " entries)");

// 5b. an entry added on the last start (MAX_STARTS 1: the first start is the last), then on the one more too
const addOne = (k) => { b.vouchers = b.vouchers.concat([Object.assign(copy(src), {id: "zzlast-" + k, no: "ZL" + k})]); };
{ const keepMax = A.AUTO.MAX_STARTS; A.AUTO.MAX_STARTS = 1;
  yday(); const au = copy(b.audit); Q = []; toasts.length = 0;
  A.maybeRun(); const j = A.auto; tasks(1000, () => j.prog.k >= 3); addOne(1); drain();
  ok(j.starts === 2 && j.extra && b.audit.last.how === "on its own (daily)" && text(b.audit) === once(au) && A.stale(b.audit.last) === null && toasts.filter(t => /Audit ran on its own/.test(t)).length === 1,
    "5b. an entry added on the last start: not kept, once more (" + j.starts + " starts), the run at once on the books with it, fits the books");
  yday(); Q = [];
  A.maybeRun(); const j2 = A.auto; tasks(1000, () => j2.prog.k >= 3); addOne(2); tasks(1000, () => j2.extra); tasks(5); addOne(3); drain();
  const st = A.stale(b.audit.last);
  ok(j2.starts === 2 && A.auto === null && b.audit.last.how === "on its own (daily)" && !!st && st.now === st.was + 1,
    "    an entry added on that one too: kept as it ends, and seen not to fit the books (" + JSON.stringify(st) + ")");
  A.AUTO.MAX_STARTS = keepMax; }

// 6. the cloud copy being brought in
ctx.TCloud = {opens: 0, loads: 0};
{ yday(); Q = [];
  A.maybeRun(); const j = A.auto;
  tasks(1000, () => j.prog.k >= 2); ctx.TCloud.loads = 1;
  const k = j.prog.k; tasks(50); const still = j.prog.k === k && A.auto === j;
  ctx.TCloud.loads = 0; drain();
  ok(still && k >= 2 && j.starts === 1 && A.auto === null && b.audit.last.how === "on its own (daily)", "6. no step while the cloud copy's entries come in (" + k + " checks, then none in 50 tasks); a load that changed nothing: on, not started again (" + j.starts + " start)"); }
{ yday(); const au = copy(b.audit); Q = [];
  A.maybeRun(); const j = A.auto;
  tasks(1000, () => j.prog.k >= 2); ctx.TCloud.loads = 1; tasks(10); addOne(6); ctx.TCloud.loads = 0; drain();
  ok(j.starts === 2 && A.auto === null && text(b.audit) === once(au), "   a load that brought an entry: started again (" + j.starts + " starts), the run at once on the books with it"); }
{ yday(); Q = []; const keepW = A.AUTO.WAIT_MAX_MS;
  A.maybeRun(); const j = A.auto;
  tasks(1000, () => j.prog.k >= 2); ctx.TCloud.loads = 1; tasks(20); const k = j.prog.k;
  A.AUTO.WAIT_MAX_MS = 0; drain(); A.AUTO.WAIT_MAX_MS = keepW;
  ok(A.auto === null && j.starts === 1 && b.audit.last.how === "on its own (daily)" && ctx.TCloud.loads === 1, "   a load that never ends: after WAIT_MAX_MS (" + keepW + " ms), on as the books are as they were (" + k + " checks while it waited, then done)"); }
delete ctx.TCloud;

// 7. an error in a step
yday(); Q = []; reported.length = 0; const last7 = b.audit.last;
const runIn = A.runIn; A.runIn = function* (){ yield; throw new Error("made-up step error"); };
const ce = console.error, said = []; console.error = (...a) => said.push(a.map(String).join(" "));
A.maybeRun(); drain();
console.error = ce; A.runIn = runIn;
ok(A.auto === null && b.audit.last === last7 && reported.length === 1 && reported[0][0] === "made-up step error" && /audit on its own/.test(reported[0][1]) && said.some(s => /made-up step error/.test(s)),
  "7. an error in a step: no run kept, said once to the console and the reporter (" + J(reported) + ")");

// 8. MIS.due
{ const keep = b.mis, cfg = b.misCfg; b.misCfg = {freq: "daily"};
  b.mis = {last: {at: "2026-11-11T19:00:00.000Z"}}; const a = x.MIS.due(b);
  b.mis = {last: {at: "2026-11-11T18:00:00.000Z"}}; const c = x.MIS.due(b);
  b.misCfg = {freq: "monthly"}; b.mis = {last: {at: "2026-10-31T19:00:00.000Z"}}; const m = x.MIS.due(b);
  b.mis = keep; b.misCfg = cfg;
  ok(a === false && c === true && m === false, "8. MIS.due at 01:00 IST: the last pack at 00:30 IST today not due, at 23:30 IST yesterday due; monthly, at 00:30 IST on 1-Nov: not due"); }

console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
