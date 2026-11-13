"""python3 tests/run_speed_worker.py - next-speed-worker (step 1 of the speed work, owner-approved): the MIS pack and the
day's audit worked out in a Web Worker, off the page's thread, with the "Working out…" line showing how far it is.
Target: no task of the page's thread over TASK_MS (default 100) while either is worked out, at any book size up to
100,000 made-up entries.
Made-up books only: the fixture's large client (tests/mis_big_books.py) copied 14 times (51,758 entries, as
run_hang_gst_year.py makes them) and 28 times cut to its first 100,000 entries by date. For each, timed (the longest
task of the page's thread, from the browser's own long-task entries, and the time to the answer):
  open   the client opened from the sidebar, its Overview (the books kept in memory, as run_hang_open_client.py);
  mis    the month's MIS on its own, its first run (MIS.maybeRun, the MIS tab open);
  audit  the day's audit on its own (Audit.maybeRun, the Audit tab open);
  gst3b  the month's GST 3B working opened (GST › 3B);
  ledger a ledger of 20,000 lines opened in Look up.
Checks: mis and audit each within TASK_MS on both books (the median of SPEED_REPEAT runs), worked out in the engine's
worker, the "Working out" line shown meanwhile, and each result the one the run at once gives (MIS.runNow, Audit.runNow)
on the same books; the others are timed only (later steps of the speed work). Then, on the first books, the job's rules
with the worker: an entry added and saved while the worker works (started again, the result as at once on the books
now); another client opened (stopped, nothing written, the worker's job dropped); no worker (Engine off: worked out here
in steps, the same); the worker gone in the middle (worked out here, the same); a function of the engine replaced on the
page (a test's or a fix's: worked out here in steps, so the change counts); the worker's file not in legacy.js.
SPEED_SIZES=51758,100000 (the sizes), SPEED_JSON=file (the table written there too).
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
sys.path.insert(0, HERE)
import itc_books
from books_data import CACHE
from tdsgst_snapshot import LOAD
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SPEED_WORKER_PORT") or 8347)
TASK_MS = int(os.environ.get("TASK_MS") or 100)
SIZES = [int(x) for x in (os.environ.get("SPEED_SIZES") or "51758,100000").split(",")]
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="speedworker-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "review"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
# run_hang_gst_year.py's made-up books, copied k times and cut to their first n entries by date
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")
SEED = SEED.replace("async () => {", "async ([K, N]) => {", 1).replace("j < 14;", "j < K;", 1).replace(
    "out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);", "out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0); out.splice(N);", 1)
assert "j < K;" in SEED and "out.splice(N)" in SEED, "run_hang_gst_year.py's SEED changed"
BOOT = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"

# the page's long tasks from now on (the browser's own entries: every task over 50 ms) and the helpers
HELP = r"""() => {
  const Z = window.__zz = window.__zz || {};
  Z.lt = []; if (!Z.obs){ Z.obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => Z.lt.push([e.startTime, e.duration]))); Z.obs.observe({type: "longtask"}); }
  // the long frames' longest scripts, for the report (what the long task was)
  Z.lf = []; if (!Z.lfo){ try { Z.lfo = new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > 100) Z.lf.push([e.startTime, Math.round(e.duration), (e.scripts || []).slice().sort((a, c) => c.duration - a.duration).slice(0, 2).map(x => Math.round(x.duration) + " " + (x.invoker || "") + " " + (x.sourceFunctionName || "") + "@" + String(x.sourceURL || "").split("/").pop() + ":" + (x.sourceCharPosition || ""))]); })); Z.lfo.observe({type: "long-animation-frame"}); } catch (e) {} }
  Z.copy = (x) => x == null ? x : JSON.parse(JSON.stringify(x));
  Z.wait = (f, ms) => new Promise((ok, no) => { const t0 = Date.now(), go = () => { let v; try { v = f(); } catch (e) { v = false; } if (v) ok(v); else if (Date.now() - t0 > (ms || 120000)) no(new Error("timed out")); else setTimeout(go, 20); }; go(); });
  // quiet: no long task in the last ms
  Z.quiet = (ms) => Z.wait(() => { const l = Z.lt[Z.lt.length - 1]; return !l || performance.now() - (l[0] + l[1]) > ms; }, 120000);
  Z.start = () => { Z.lt = []; Z.lf = []; Z.sl = []; Z.t0 = performance.now(); };
  Z.end = () => { const lt = Z.lt.filter(([s]) => s >= Z.t0 - 1); return {max: Math.round(Math.max(0, ...lt.map(x => x[1]))), n: lt.length, sum: Math.round(lt.reduce((a, x) => a + x[1], 0)), ms: Math.round(performance.now() - Z.t0),
    top: lt.map(x => Math.round(x[1])).sort((a, c) => c - a).slice(0, 5), lf: Z.lf.filter(([s]) => s >= Z.t0 - 1).map(x => x.slice(1)), sl: Z.sl.filter(x => x[0] > 40)}; };
  // each task of a run on its own: [ms, its steps' ms over 20, saved] (Audit.autoSlice, MIS's the same; the job's own
  // functions, not the engine's: the worker is still used)
  Z.sl = [];
  if (!Z.wrapped){ Z.wrapped = true; [Audit, MIS].forEach(A => { const sl = A.autoSlice; A.autoSlice = function (j) {
    if (j && j.it && !j.it.__z){ const it = j.it, n = it.next.bind(it); it.next = (...a) => { const t = performance.now(); try { return n(...a); } finally { const d = performance.now() - t; if (d > 20) (Z.cur || []).push(Math.round(d)); } }; it.__z = true; }
    const t0 = performance.now(), sv = Z.saves; Z.cur = []; try { return sl.apply(this, arguments); } finally { Z.sl.push([Math.round(performance.now() - t0), Z.cur, Z.saves !== sv]); Z.cur = null; } }; });
    const sb = window.saveBooks; Z.saves = 0; window.saveBooks = function () { Z.saves++; return sb.apply(this, arguments); }; }
  // a run's text with the times of today's runs set aside
  Z.text = (m) => { let s = JSON.stringify(m || null); const day = new Date().toISOString().slice(0, 10), ats = new Set();
    [(m || {}).last].concat((m || {}).history || []).forEach(h => { if (h && String(h.at).slice(0, 10) === day) ats.add(h.at); });
    Object.values((m || {}).items || {}).forEach(it => ["first", "last", "solved", "reopened"].forEach(k => { if (it[k] && String(it[k]).slice(0, 10) === day) ats.add(it[k]); }));
    ats.forEach(a => { s = s.split(JSON.stringify(a)).join('"AT"'); }); return s; };
  return true; }"""

# the MIS: made due (its last run, by hand, dated 40 days ago), worked out on its own with the MIS tab open; then the
# run at once from the same books and the MIS as it was
MIS_RUN = r"""async () => {
  const Z = window.__zz, b = S.books;
  b.misCfg = {freq: "monthly"}; const r = MIS.autoRange(b);
  if (!(b.mis || {}).last) MIS.run(r.from, r.to, "by hand");
  const y = new Date(Date.now() - 40 * 86400000).toISOString(); b.mis.last.at = y; b.mis.history[0].at = y;
  const m0 = Z.copy(b.mis), last0 = b.mis.last;
  if (typeof loadPart === "function") await loadPart("mis");
  S.tab = "books"; S.booksTab = "mis"; render(); await Z.quiet(800);
  Z.start(); let line = false, eng = null;
  MIS.maybeRun();
  await Z.wait(() => { if (document.querySelector("[data-mis-auto], [data-working]")) line = true; if (MIS.auto && eng === null && MIS.auto.it) eng = !!MIS.auto.eng; return !MIS.auto && !MIS._soon && b.mis.last !== last0; }, 300000);
  const t = Z.end(); await Z.quiet(600);
  const now = Z.text(b.mis), keep = b.mis; b.mis = Z.copy(m0); memoScope(() => MIS.runNow(r.from, r.to, "on its own (monthly)")); const want = Z.text(b.mis); b.mis = keep;
  return Object.assign(t, {same: now === want, len: now.length, line, how: b.mis.last.how, eng}); }"""

AUDIT_RUN = r"""async () => {
  const Z = window.__zz, b = S.books;
  b.auditCfg = {freq: "daily"}; const r = Audit.defaultRange(b);
  if (!(b.audit || {}).last) Audit.run(r.from, r.to, "by hand");
  const y = new Date(Date.now() - 86400000).toISOString(); b.audit.last.at = y; b.audit.history[0].at = y;
  Object.values(b.audit.items || {}).forEach(it => { ["first", "last", "solved", "reopened"].forEach(k => { if (it[k] > y) it[k] = y; }); });
  const a0 = Z.copy(b.audit), last0 = b.audit.last;
  S.tab = "books"; S.booksTab = "audit"; render(); await Z.quiet(800);
  Z.start(); let line = false, eng = null;
  Audit.maybeRun();
  await Z.wait(() => { if (document.querySelector("[data-audit-auto]")) line = true; if (Audit.auto && eng === null && Audit.auto.it) eng = !!Audit.auto.eng; return !Audit.auto && b.audit.last !== last0; }, 300000);
  const t = Z.end(); await Z.quiet(600);
  const now = Z.text(b.audit), keep = b.audit; b.audit = Z.copy(a0); memoScope(() => Audit.runNow(r.from, r.to, "on its own (daily)")); const want = Z.text(b.audit); b.audit = keep;
  return Object.assign(t, {same: now === want, len: now.length, line, findings: b.audit.last.findings.length, eng}); }"""

GST3B = r"""async () => {
  const Z = window.__zz; S.tab = "books"; S.booksTab = "lookup"; S.lk = null; render(); await Z.quiet(800); let line = false;
  Z.start(); S.booksTab = "gst"; gstOpen("202603", "r3b", "07"); await new Promise(r => setTimeout(r, 300));
  await Z.wait(() => { if (document.querySelector("#app [data-gst-working]")) line = true; return !document.querySelector("#app [data-working]") && document.querySelector("#app [data-return-card]"); }, 300000);
  const t = Z.end(), wk = GSTR._work || null;
  // the figures the page drew (with what the worker worked out) against the same worked out here afresh
  const shown = memoScope(() => JSON.stringify([GSTR.threeBShown("202603", "07"), GSTR.threeB("202603", "07"), GSTR.errorsFor("202603", "07"), GSTR.checksKept("202603", "07")]));
  const c0 = GSTR._carry, k0 = GSTR._ck, a0 = GSTR._ckAt; GSTR._carry = null; GSTR._ck = new WeakMap(); GSTR._ckAt = null;
  const fresh = memoScope(() => { const t = GSTR.threeB("202603", "07"); return JSON.stringify([t, t, GSTR.errorsFor("202603", "07"), GSTR.checksKept("202603", "07")]); });
  GSTR._carry = c0; GSTR._ck = k0; GSTR._ckAt = a0;
  return Object.assign(t, {view: [S.booksTab, S.gstView, S.gstPart], line, eng: !!(wk && wk.ym === "202603" && !wk.fail), same: shown === fresh, len: shown.length}); }"""

# the books saved (saveBooks: Books.save) with a new list of entries (they are written: bke), then again with only the rest
# changed (bkw): timed, by the worker (Engine.store); the records then in this browser's store the same as the same
# saves written here (no worker)
SAVE = r"""async () => {
  const Z = window.__zz, b = S.books, K = Books.K(b.cid); await Z.quiet(800);
  const hash = async () => { const r = await IDBStore.gets([K[0], K[1], K[2]]); return [Audit.hash(JSON.stringify(r[0].v)) + ":" + r[0].v.length, Audit.hash(JSON.stringify(r[1].d)), r[0].s === r[1].s && r[1].s === r[2].s]; };
  const done = async () => { await Promise.all(Object.values(Store.chains)); await Books.q[b.cid]; };
  let used = 0; const st = Engine.store; Engine.store = function () { const p = st.apply(this, arguments); p.then(r => { if (r) used++; }); return p; };
  b.vouchers = b.vouchers.slice();
  Z.start(); await saveBooks(); await done(); const t = Z.end(); const h1 = await hash(); await Z.quiet(500);
  Z.start(); await saveBooks(); await done(); const t2 = Z.end(); const h1b = await hash();
  Engine.store = st;
  Engine.off("test: the save here"); b.vouchers = b.vouchers.slice(); await saveBooks(); await done(); const h2 = await hash(); Engine.st = ""; Engine.why = "";
  // the page closed while a save is on its way to the worker (pagehide: Books.closing writes it here at once)
  b.vouchers = b.vouchers.slice(); const p = saveBooks(); Books.closing(); await p; await done(); const h3 = await hash();
  return Object.assign(t, {rest: {max: t2.max, top: t2.top}, eng: used === 2, same: h1[0] === h2[0] && h1[1] === h2[1] && h1b[1] === h2[1], stamps: h1[2] && h1b[2] && h2[2],
    closing: h3[0] === h2[0] && h3[1] === h2[1] && h3[2], line: true, sl: []}); }"""

# new books as they come (another list of the same entries, saved: the save of a new list writes every entry to this
# browser's store, Books.save, a task of its own before the run is timed): what any page kept of the old is worked out again
FRESH = """async () => { S.books.vouchers = S.books.vouchers.slice(); S.books.mis = null; S.books.audit = null; await saveBooks(); await Promise.all(Object.values(Store.chains));
  await window.__zz.quiet(800); }"""
# each run on its own REPEAT times on fresh books; judged by the median run's longest task (this machine is shared: a
# collection of the page's memory or another program can land in any one run), every run's shown
REPEAT = int(os.environ.get("SPEED_REPEAT") or 3)

LEDGER = r"""async () => {
  const Z = window.__zz, b = S.books, n = {};
  b.vouchers.forEach(v => { if (v.opt || v.cancel) return; (v.ent || []).forEach(e => { (n[e.l] = n[e.l] || []).push(v.date); }); });
  const l = Object.keys(n).sort((a, c) => n[c].length - n[a].length)[0], d = n[l].slice().sort(), want = Math.min(20000, d.length);
  const from = d[d.length - want], to = d[d.length - 1];
  S.tab = "books"; S.booksTab = "lookup"; S.lk = null; render(); await Z.quiet(800);
  const x = LK.st(); Object.assign(x, {kind: "ledger", led: "", from, to}); render(); await Z.quiet(600);
  Z.start(); lkLed(l);
  await Z.wait(() => { const r = S.lk && S.lk.res; return r && r.led === l && r.rows; }, 300000);
  await new Promise(r => setTimeout(r, 50)); await Z.wait(() => !document.querySelector("#app [data-working]"), 300000);
  const t = Z.end(); return Object.assign(t, {led: l, lines: want, rows: S.lk.res.rows.length}); }"""

# the job's rules with the worker (on the books open, made due again before each)
# the job's rules with the worker (on the books open, made due again before each), a part each
RULES_HELP = r"""() => { const Z = window.__zz, b = S.books;
  Z.due = (A) => { if (A === MIS) b.misCfg = {freq: "monthly"}; else b.auditCfg = {freq: "daily"}; const r = A === MIS ? MIS.autoRange(b) : Audit.defaultRange(b);
    const L = A.lastRun(b) || (A.run(r.from, r.to, "by hand"), A.lastRun(b)), y = new Date(Date.now() - (A === MIS ? 40 : 1) * 86400000).toISOString(); L.at = y; (A === MIS ? b.mis : b.audit).history[0].at = y; return r; };
  Z.once = (A, k0, r) => { const keep = b[k0]; b[k0] = Z.copy(A === MIS ? Z.m0 : Z.a0); memoScope(() => A.runNow(r.from, r.to, "on its own (" + A.cfg(b).freq + ")")); const t = Z.text(b[k0]); b[k0] = keep; return t; };
  Z.state = () => ({audit: !!Audit.auto, mis: !!MIS.auto, soon: !!MIS._soon, st: typeof Engine === "object" && Engine.st, jobs: typeof Engine === "object" && Engine.jobs.size, again: !!MIS._again, b: S.books === b});
  // (the engine as at the start: a part that turned it off and failed leaves it so)
  Z.fresh = () => { if (typeof Engine === "object" && Engine.st === "off"){ Engine.st = ""; Engine.why = ""; } };
  // a run on its own started (go) and waited for (done): its job, as it began (a small book's run can end between two looks)
  Z.job = async (A, go, done) => { let j = null; const ab = A.autoBegin; A.autoBegin = function (x) { j = x; return ab.apply(this, arguments); };
    try { go(); await Z.wait(() => j && done(), 300000); } finally { A.autoBegin = ab; } return j; };
  // (the worker's jobs of a kind: others come and go meanwhile)
  Z.jobs = (k) => [...Engine.jobs.values()].filter(a => a.kind === k).length;
  Z.bk = b; return true; }"""
RULES = [
 ("edit", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh();
  // an entry added and saved while the worker works the audit out
  const r = Z.due(Audit); Z.a0 = Z.copy(b.audit); const last0 = b.audit.last; S.booksTab = "audit"; render();
  Audit.maybeRun(); const j = Audit.auto; await Z.wait(() => j.eng && Z.jobs("audit") > 0, 60000); await new Promise(ok => setTimeout(ok, 300));
  const p = b.vouchers.find(v => v.date >= r.from && v.date <= r.to && Books.isSale(v) && (v.ent || []).length >= 2);
  b.vouchers = b.vouchers.concat([Object.assign(Z.copy(p), {id: "zzsw-1", no: "ZSW1"})]); await saveBooks();
  await Z.wait(() => !Audit.auto && b.audit.last !== last0, 300000);
  return {eng: !!j.eng, starts: j.starts, same: Z.text(b.audit) === Z.once(Audit, "audit", r), n: b.audit.last.vouchers, jobs: Z.jobs("audit")}; }"""),
 ("other", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh();
  // another client opened while the worker works the MIS out
  Z.due(MIS); const m0 = Z.text(b.mis);
  const c = newCompany({name: "ZZ OTHER", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c;
  const o = Object.assign({}, b, {cid: c.id, vouchers: b.vouchers.slice(0, 3000), mis: null, audit: null}); const o0 = Z.text(o.mis);
  MIS.maybeRun(); await Z.wait(() => MIS.auto && MIS.auto.eng && Z.jobs("mis") > 0, 60000); const j = MIS.auto; await new Promise(ok => setTimeout(ok, 200));
  S.books = o; S.coId = c.id; await new Promise(ok => setTimeout(ok, 1500));
  const out = {eng: !!j.eng, stopped: MIS.auto !== j && !j.it, kept: Z.text(b.mis) === m0, otherSame: Z.text(o.mis) === o0, jobs: Z.jobs("mis")};
  S.books = b; S.coId = b.cid; render(); await Z.quiet(500); return out; }"""),
 ("none", r"""async () => { const Z = window.__zz, b = Z.bk;
  // no worker: worked out here, in steps
  Engine.off("test: no worker"); const r = Z.due(Audit); Z.a0 = Z.copy(b.audit); const last0 = b.audit.last;
  Audit.maybeRun(); const j = Audit.auto; await Z.wait(() => !Audit.auto && b.audit.last !== last0, 300000);
  Engine.st = ""; Engine.why = ""; return {eng: !!j.eng, same: Z.text(b.audit) === Z.once(Audit, "audit", r)}; }"""),
 ("gone", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh();
  // the worker gone in the middle (as its error would end it): the run worked out here, the same
  const r = Z.due(MIS); Z.m0 = Z.copy(b.mis); const last0 = b.mis.last;
  MIS.maybeRun(); await Z.wait(() => MIS.auto && MIS.auto.eng && Z.jobs("mis") > 0, 60000); const j = MIS.auto; await new Promise(ok => setTimeout(ok, 300));
  Engine.off("test: the worker went");
  await Z.wait(() => !MIS.auto && b.mis.last !== last0, 300000);
  Engine.st = ""; Engine.why = ""; return {eng: !!j.eng, same: Z.text(b.mis) === Z.once(MIS, "mis", r), how: b.mis.last.how}; }"""),
 ("patched", r"""async () => { const Z = window.__zz, b = Z.bk;
  // a function of the engine replaced on the page: worked out here (the change counts)
  Z.due(Audit); const last0 = b.audit.last, ck = Audit.checks.odd; Audit.checks.odd = function () { return ck.apply(this, arguments); }; let j;
  try { Audit.maybeRun(); j = Audit.auto; await Z.wait(() => !Audit.auto && b.audit.last !== last0, 300000); } finally { Audit.checks.odd = ck; }
  return {eng: !!j.eng, pure: Engine.pure()}; }"""),
 ("again", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh();
  // and the worker again after (a new one, ready first; the run's job as it began: review of the full stack, not flaky)
  const g = Engine.ready(); let x; while (!(x = g.next()).done) await new Promise(ok => setTimeout(ok, 50));
  await Z.wait(() => !Audit.auto && !MIS.auto, 300000);
  const r = Z.due(Audit); Z.a0 = Z.copy(b.audit); const last0 = b.audit.last;
  const j = await Z.job(Audit, () => Audit.maybeRun(), () => !Audit.auto && b.audit.last !== last0);
  return {eng: !!j.eng, same: Z.text(b.audit) === Z.once(Audit, "audit", r)}; }"""),
]
# the 2B client of tests/itc_books.py (made up), with a made-up pair from the 2B matching run (M2B.st: kept by the page,
# outside the books; GST2B.run reads its AI pairs): the MIS and the audit in the worker as at once on the page
TWOB = r"""async ([cid, reg]) => { const Z = window.__zz, big = Z.bk; Z.fresh();
  const b = await Books.read(cid); S.coId = cid; S.books = b; b.misCfg = {freq: "monthly"}; b.auditCfg = {freq: "daily"};
  // (the matching run of the year shown: S.gstYm's, M2B.fyNow)
  const ym0 = S.gstYm, reg0 = S.gstReg; S.gstYm = "202605"; S.gstReg = reg;
  const k = M2B.key(reg, M2B.fyNow()), g = Object.values(b.twoBs).flatMap(x => x.rows).find(r => r.no === "O/5");
  const before = JSON.stringify(GST2B.run(reg));
  M2B.st[k] = {run: {id: "zzrun1", at: "2026-11-01T00:00:00Z", result: {rows: [{st: "matched-ai", g: [g.key], b: ["e1"], why: ["zz made-up pair"], id: "zzr1"}]}}};
  const paired = JSON.stringify(GST2B.run(reg)).includes("zz made-up pair") && JSON.stringify(GST2B.run(reg)) !== before;
  const r = {from: "20260401", to: "20260531"};
  // the MIS asked for (a run of its own: MIS.runSoon), in the worker
  Z.m0 = Z.copy(b.mis); let last0 = (b.mis || {}).last; const jm = await Z.job(MIS, () => MIS.runSoon(b, {from: r.from, to: r.to, how: "zz 2B"}), () => !MIS.auto && !MIS._soon && (b.mis || {}).last !== last0);
  const misNow = Z.text(b.mis), keepM = b.mis; b.mis = Z.copy(Z.m0); memoScope(() => MIS.runNow(r.from, r.to, "zz 2B")); const misOnce = Z.text(b.mis); b.mis = keepM;
  // the day's audit on its own, in the worker
  Z.a0 = Z.copy(b.audit); last0 = (b.audit || {}).last; Audit.maybeRun(); const ja = Audit.auto;
  await Z.wait(() => !Audit.auto && (b.audit || {}).last !== last0, 300000);
  const ra = Audit.defaultRange(b), auNow = Z.text(b.audit), keepA = b.audit; b.audit = Z.copy(Z.a0); memoScope(() => Audit.runNow(ra.from, ra.to, "on its own (daily)")); const auOnce = Z.text(b.audit); b.audit = keepA;
  delete M2B.st[k]; S.gstYm = ym0; S.gstReg = reg0; S.books = big; S.coId = big.cid; render(); await Z.quiet(500);
  return {paired, misEng: !!(jm && jm.eng), misSame: misNow === misOnce, auEng: !!(ja && ja.eng), auSame: auNow === auOnce, findings: (b.audit.last || {}).findings.length}; }"""
# review of part 1. choice: the fixture client (its advances shown in GST, tdsgst_snapshot.LOAD), its MIS in the worker;
# then the switch turned off as the page does it (AdvOptIn.jsx: the books unchanged, GSTR._carry emptied on the page),
# the MIS again in the worker: each the one at once on the page, and the two differ (the choice counts)
CHOICE = r"""async () => { const Z = window.__zz, b = S.books, co = CO(); Z.fresh(); b.misCfg = {freq: "monthly"};
  const r = {from: String(b.meta.from || "20250401"), to: String(b.meta.to)};
  const one = async (tag) => { const m0 = Z.copy(b.mis), last0 = (b.mis || {}).last;
    const j = await Z.job(MIS, () => MIS.runSoon(b, {from: r.from, to: r.to, how: tag}), () => !MIS.auto && !MIS._soon && (b.mis || {}).last !== last0);
    const now = Z.text(b.mis), keep = b.mis; b.mis = Z.copy(m0); GSTR._carry = null; memoScope(() => MIS.runNow(r.from, r.to, tag)); const once = Z.text(b.mis), fig = JSON.stringify(b.mis.last.comp); b.mis = keep;
    return {eng: !!j.eng, same: now === once, fig}; };
  const a = await one("zz advances on");
  choiceConfirm(co, "advGst", "off"); GSTR._carry = null;
  const c = await one("zz advances off");
  return {onEng: a.eng, onSame: a.same, offEng: c.eng, offSame: c.same, differ: a.fig !== c.fig}; }"""
REVIEW = [
 ("dropped", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh();
  // (review of the full stack) a clear while the worker works (as another client's opening does): the job dropped at once,
  // the worker not ended, the run worked out here, the same
  const r = Z.due(MIS); Z.m0 = Z.copy(b.mis); const last0 = b.mis.last;
  MIS.maybeRun(); await Z.wait(() => MIS.auto && MIS.auto.eng && Z.jobs("mis") > 0, 60000); const j = MIS.auto, t0 = Date.now();
  Engine.clear("test: another client");
  await Z.wait(() => !MIS.auto && b.mis.last !== last0, 300000);
  return {eng: !!j.eng, st: Engine.st, ms: Date.now() - t0, same: Z.text(b.mis) === Z.once(MIS, "mis", r)}; }"""),
 ("vanished", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh(); b.vouchers = b.vouchers.slice(); await saveBooks(); await Z.quiet(500);
  // (review of the full stack) the worker gone in the middle of sending the books: worked out here, never a failed run
  const r = Z.due(Audit); Z.a0 = Z.copy(b.audit); const last0 = b.audit.last, post = Engine.post; let n = 0;
  Engine.post = function (m) { if (m && m.t === "bv" && ++n === 3 && this.w){ this.w.terminate(); this.w = null; } return post.apply(this, arguments); };
  let j; try { j = await Z.job(Audit, () => Audit.maybeRun(), () => !Audit.auto && b.audit.last !== last0); } finally { Engine.post = post; }
  return {eng: !!j.eng, err: !!j.err, cut: n >= 3, same: Z.text(b.audit) === Z.once(Audit, "audit", r), st: Engine.st}; }"""),
 ("timeout", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh(); S.books = b; S.coId = b.cid; render();
  const r = Z.due(Audit); Z.a0 = Z.copy(b.audit); const last0 = b.audit.last;
  const post = Engine.post, J = [Engine.JOB_MS, Engine.JOB_PER, Engine.took]; Engine.JOB_MS = 1500; Engine.JOB_PER = 0; Engine.took = {};
  // (the worker never answers: its run is not sent)
  Engine.post = function (m) { if (m && m.t === "run") return; return post.apply(this, arguments); };
  try { Audit.maybeRun(); const j = Audit.auto; await Z.wait(() => !Audit.auto && b.audit.last !== last0, 300000);
    return {eng: !!j.eng, off: Engine.st === "off", why: Engine.why, same: Z.text(b.audit) === Z.once(Audit, "audit", r)}; }
  finally { Engine.post = post; Engine.JOB_MS = J[0]; Engine.JOB_PER = J[1]; Engine.took = J[2]; Engine.st = ""; Engine.why = ""; } }"""),
 ("crash", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh();
  const r = Z.due(MIS); Z.m0 = Z.copy(b.mis); const last0 = b.mis.last;
  MIS.maybeRun(); await Z.wait(() => MIS.auto && MIS.auto.eng && Z.jobs("mis") > 0, 60000); const j = MIS.auto;
  Engine.w.onerror({message: "zz made-up crash", preventDefault(){}});
  const off = Engine.st === "off", why = Engine.why;
  await Z.wait(() => !MIS.auto && b.mis.last !== last0, 300000);
  const out = {eng: !!j.eng, off, why, same: Z.text(b.mis) === Z.once(MIS, "mis", r)};
  Engine.st = ""; Engine.why = "";
  const g = Engine.ready(); let x; while (!(x = g.next()).done) await new Promise(ok => setTimeout(ok, 50));
  Engine.w.onmessageerror({}); out.msgOff = Engine.st === "off"; Engine.st = ""; Engine.why = ""; return out; }"""),
 ("denied", r"""async () => { const Z = window.__zz; Z.fresh();
  const g = Engine.ready(); let x; while (!(x = g.next()).done) await new Promise(ok => setTimeout(ok, 50));
  const r = await new Promise(ok => { const f = e => { if ((e.data || {}).t === "selftest"){ Engine.w.removeEventListener("message", f); ok(e.data.r); } }; Engine.w.addEventListener("message", f); Engine.post({t: "selftest"}); });
  return {r, n: Object.keys(r).length, all: Object.values(r).every(v => /^refused/.test(v))}; }"""),
]
CLEAR = r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh(); S.books = b; S.coId = b.cid; render();
  const r = Z.due(Audit), last0 = b.audit.last; Audit.maybeRun(); await Z.wait(() => !Audit.auto && b.audit.last !== last0, 300000);
  const held = await Engine.peek();
  const c = newCompany({name: "ZZ OTHER 2", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c; await openCompany(c.id); await new Promise(ok => setTimeout(ok, 800));
  const after = await Engine.peek(), sent = Engine.sent;
  const was = !!Engine.w; Cloud.signOut(); const ended = was && !Engine.w && Engine.st === "";
  S.coId = b.cid; S.books = b; render();
  return {held: held ? held.n : -1, s: held ? held.s : [], after: after ? after.books : null, sent: sent === null, ended}; }"""
S_OK = {"books", "firm", "companies", "coId", "sales", "gstReg", "gstYm", "auditFy", "inregScope", "data"}
# GSTR-3B's figures: drawn as worked out afresh after an entry is added while the worker works; no worker: at once
GSTR_RULES = [
 ("gstEdit", r"""async () => { const Z = window.__zz, b = Z.bk; Z.fresh(); S.tab = "books"; S.booksTab = "lookup"; render(); await Z.quiet(500);
  b.vouchers = b.vouchers.slice(); await saveBooks(); await Z.quiet(500);
  S.booksTab = "gst"; gstOpen("202603", "r3b", "07"); const w0 = GSTR._work; await Z.wait(() => Z.jobs("gst") > 0, 60000);
  const p = b.vouchers.find(v => v.date >= "20260301" && v.date <= "20260331" && Books.isSale(v) && (v.ent || []).length >= 2);
  b.vouchers = b.vouchers.concat([Object.assign(Z.copy(p), {id: "zzsw-g1", no: "ZSWG1"})]); await saveBooks(); render();
  await Z.wait(() => !document.querySelector("#app [data-working]") && document.querySelector("#app [data-return-card]"), 300000);
  const shown = memoScope(() => JSON.stringify([GSTR.threeBShown("202603", "07"), GSTR.errorsFor("202603", "07")]));
  const c0 = GSTR._carry, k0 = GSTR._ck, a0 = GSTR._ckAt; GSTR._carry = null; GSTR._ck = new WeakMap(); GSTR._ckAt = null;
  const fresh = memoScope(() => JSON.stringify([GSTR.threeB("202603", "07"), GSTR.errorsFor("202603", "07")])); GSTR._carry = c0; GSTR._ck = k0; GSTR._ckAt = a0;
  await new Promise(ok => setTimeout(ok, 600));
  return {asked: !!w0, again: GSTR._work !== w0, same: shown === fresh, jobs: [...Engine.jobs.values()].filter(a => a.kind === "gst").length, left: [...Engine.jobs.values()].map(a => [a.id, a.kind, a.end, a.err]), fail: !!(GSTR._work || {}).fail, w0fail: !!w0.fail}; }"""),
 ("gstNone", r"""async () => { const Z = window.__zz, b = Z.bk; S.tab = "books"; S.booksTab = "lookup"; render(); await Z.quiet(500);
  b.vouchers = b.vouchers.slice(); await saveBooks(); await Z.quiet(500); Engine.off("test: no worker"); const w0 = GSTR._work;
  S.booksTab = "gst"; gstOpen("202603", "r3b", "07"); const line = !!document.querySelector("#app [data-gst-working]"), card = !!document.querySelector("#app [data-return-card]");
  Engine.st = ""; Engine.why = ""; return {line, card, asked: GSTR._work !== w0}; }"""),
]
WANT = {"dropped": lambda e: e["eng"] and e["st"] == "ok" and e["ms"] < 15000 and e["same"],
        "vanished": lambda e: e["eng"] and not e["err"] and e["cut"] and e["same"],
        "choice": lambda e: e["onEng"] and e["onSame"] and e["offEng"] and e["offSame"] and e["differ"],
        "timeout": lambda e: e["eng"] and e["off"] and "too long" in e["why"] and e["same"],
        "crash": lambda e: e["eng"] and e["off"] and e["same"] and e["msgOff"],
        "denied": lambda e: e["n"] >= 9 and e["all"],
        "clear": lambda e: e["held"] > 50000 and set(e["s"]) <= S_OK and e["after"] is False and e["sent"] and e["ended"],
        "gstEdit": lambda e: e["asked"] and e["same"] and e["jobs"] == 0, "gstNone": lambda e: not e["line"] and e["card"] and not e["asked"],
        "twob": lambda e: e["paired"] and e["misEng"] and e["misSame"] and e["auEng"] and e["auSame"],
        "edit": lambda e: e["eng"] and e["starts"] == 2 and e["same"] and e["jobs"] == 0,
        "other": lambda e: e["eng"] and e["stopped"] and e["kept"] and e["otherSame"] and e["jobs"] == 0,
        "none": lambda e: not e["eng"] and e["same"], "gone": lambda e: e["eng"] and e["same"],
        "patched": lambda e: not e["eng"] and e["pure"], "again": lambda e: e["eng"] and e["same"]}
SAY = {"dropped": "a clear while the worker works (another client opening): the job dropped at once, the worker not ended, the run worked out here, the same",
       "vanished": "the worker gone in the middle of sending the books: the run worked out here, not failed, the same",
       "choice": "a client's choice changed (advances in GST), the books not: the worker's MIS each time the one at once (the choice counts)",
       "timeout": "a job the worker never answers: the worker ended at its time, the run worked out here, the same",
       "crash": "the worker failing in the middle (its error; a word it cannot send): ended, the run worked out here, the same",
       "denied": "the worker writes nothing: every write it tries is refused (the books, the client, the stores, settings, the network)",
       "clear": "another client opened: the worker holds nothing of the last (its S only what the engines read before); a sign-out: it ends",
       "gstEdit": "GSTR-3B: an entry added and saved while the worker works: the figures drawn are the ones worked out afresh",
       "gstNone": "GSTR-3B with no worker: worked out at once, as before, no line",
       "twob": "2B data and a pair from the 2B matching run (outside the books): the MIS and the audit in the worker as at once",
       "edit": "an entry added and saved while the worker works: started again, the result as at once on the books now",
       "other": "another client opened: stopped, neither client's MIS changed, the worker's job dropped",
       "none": "no worker: worked out here in steps, the same", "gone": "the worker gone in the middle: worked out here, the same",
       "patched": "a function of the engine replaced on the page: worked out here, in steps", "again": "then in a new worker again, the same"}
ONLY_RULES = os.environ.get("SPEED_ONLY_RULES") == "1"

table = {}
try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"])
        for N in SIZES:
            print("\n%d made-up entries" % N, flush=True)
            ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto("http://localhost:%d/review/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(1200)
            seed = pg.evaluate(SEED, [-(-N // 3697), N]); pg.wait_for_timeout(2000)
            cid = seed["cid"]
            ok(seed["n"] == N, "made-up books: %d entries" % seed["n"])
            # kept in this browser's store with the MIS and the audit off, so the opening is timed alone
            pg.evaluate("async () => { S.books.misCfg = {freq: 'off'}; S.books.auditCfg = {freq: 'off'}; Store.saveCompany(CO(S.books.cid)); await saveBooks(); await Promise.all(Object.values(Store.chains)); goHome(); }"); pg.wait_for_timeout(1500)
            pg.reload(); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(2500)
            pg.evaluate(HELP)
            row = {}
            if ONLY_RULES:
                pg.click("[data-side-client=back]"); pg.wait_for_function("(cid) => S.view === 'company' && S.books && S.books.cid === cid && !S.books.loading", arg=cid, timeout=120000)
                pg.evaluate("() => loadPart('mis')"); pg.evaluate(RULES_HELP)
                for name, js in RULES + REVIEW + GSTR_RULES + [("choice", None), ("twob", None), ("clear", CLEAR)]:
                    try:
                        if name == "choice": pg.evaluate(LOAD, json.load(open(CACHE))); pg.wait_for_timeout(800); e = pg.evaluate(CHOICE); pg.evaluate("() => { const Z = window.__zz; S.books = Z.bk; S.coId = Z.bk.cid; render(); }")
                        else: e = pg.evaluate(js) if js else (pg.evaluate(itc_books.MAKE, [itc_books.CID, itc_books.CMP, itc_books.REG, itc_books.VS, itc_books.TWOB]), pg.evaluate(TWOB, [itc_books.CID, itc_books.REG]))[1]
                    except Exception as x: e = {"error": str(x).split("\n")[0][:200], "state": pg.evaluate("() => window.__zz.state()")}
                    ok("error" not in e and WANT[name](e), "%s (%s)" % (SAY[name], e))
                ctx.close(); break
            pg.evaluate("() => window.__zz.start()")
            pg.click("[data-side-client=back]")
            pg.wait_for_function("(cid) => S.view === 'company' && S.books && S.books.cid === cid && !S.books.loading", arg=cid, timeout=120000)
            pg.evaluate("() => window.__zz.wait(() => !document.querySelector('#app [data-working]'), 120000)")
            row["open"] = pg.evaluate("() => window.__zz.end()")
            pg.evaluate("() => window.__zz.quiet(800)")
            row["ledger"] = pg.evaluate(LEDGER)
            for k, js in (("gst3b", GST3B), ("mis", MIS_RUN), ("audit", AUDIT_RUN), ("save", SAVE)):
                runs = []
                for i in range(REPEAT):
                    pg.evaluate(FRESH); runs.append(pg.evaluate(js))
                runs.sort(key=lambda v: v["max"])
                row[k] = dict(runs[len(runs) // 2], same=all(v["same"] for v in runs), line=all(v["line"] for v in runs), eng=all(v.get("eng") for v in runs) if runs[0].get("eng") is not None else None,
                              runs=[v["max"] for v in runs], lf=[f for v in runs for f in v["lf"]], sl=[x for v in runs for x in v.get("sl", [])])
            for k, v in row.items():
                print("   %-7s longest task %5d ms, %3d long tasks (%6d ms in all), answer after %6d ms %s%s" % (k, v["max"], v["n"], v["sum"], v["ms"], v["top"],
                      (" same as at once: %s, worker %s" % (v["same"], v.get("eng"))) if "same" in v else (" %s" % {x: v[x] for x in ("led", "lines", "rows", "view") if x in v})), flush=True)
            for k, v in row.items():
                for f in v.get("lf", [])[:4]: print("     long frame %s" % f, flush=True)
                if v.get("sl"): print("     %s tasks over 40 ms [ms, steps, saved]: %s" % (k, v["sl"][:8]), flush=True)
            v = row["save"]
            ok(v["same"] and v["stamps"], "save: the records written are the ones the save here writes (the entries and the rest, one version)")
            ok(v["closing"], "save: the page closed while a save goes to the worker: written here at once, whole")
            ok(v["eng"], "save: written by the engine's worker")
            ok(v["max"] <= TASK_MS and v["rest"]["max"] <= TASK_MS, "save: no task of the page's thread over %d ms: a new list of entries %d ms %s (the median of %d runs' longest: %s), the rest only %d ms %s" % (TASK_MS, v["max"], v["top"], len(v["runs"]), v["runs"], v["rest"]["max"], v["rest"]["top"]))
            v = row["gst3b"]
            if "eng" in v:
                ok(v["same"], "gst3b: the 3B and the month's checks drawn are the ones worked out here afresh (%d characters)" % v["len"])
                ok(v["line"] and v["eng"], "gst3b: worked out in the engine's worker, the \"Working out\" line shown meanwhile (%s)" % {x: v[x] for x in ("line", "eng")})
                ok(v["max"] <= TASK_MS, "gst3b: no task of the page's thread over %d ms: the longest %d ms %s (the median of %d runs' longest: %s)" % (TASK_MS, v["max"], v["top"], len(v["runs"]), v["runs"]))
            for k in ("mis", "audit"):
                v = row[k]
                ok(v["same"], "%s: the result is the one the run at once gives (%d characters)" % (k, v["len"]))
                ok(v["line"], "%s: the \"Working out\" line shown meanwhile" % k)
                ok(v.get("eng") is True, "%s: worked out in the engine's worker (Engine: %s)" % (k, v.get("eng")))
                ok(v["max"] <= TASK_MS, "%s: no task of the page's thread over %d ms: the longest %d ms %s (the median of %d runs' longest: %s)" % (k, TASK_MS, v["max"], v["top"], len(v["runs"]), v["runs"]))
            table[N] = row
            if N == SIZES[0]:
                print("\n   the job's rules with the worker (%d entries)" % N, flush=True)
                pg.evaluate(RULES_HELP)
                for name, js in RULES + REVIEW + GSTR_RULES + [("choice", None), ("twob", None), ("clear", CLEAR)]:
                    try:
                        if name == "choice": pg.evaluate(LOAD, json.load(open(CACHE))); pg.wait_for_timeout(800); e = pg.evaluate(CHOICE); pg.evaluate("() => { const Z = window.__zz; S.books = Z.bk; S.coId = Z.bk.cid; render(); }")
                        else: e = pg.evaluate(js) if js else (pg.evaluate(itc_books.MAKE, [itc_books.CID, itc_books.CMP, itc_books.REG, itc_books.VS, itc_books.TWOB]), pg.evaluate(TWOB, [itc_books.CID, itc_books.REG]))[1]
                    except Exception as x: e = {"error": str(x).split("\n")[0][:200], "state": pg.evaluate("() => window.__zz.state()")}
                    ok("error" not in e and WANT[name](e), "%s (%s)" % (SAY[name], e))
                eng = pg.evaluate("() => typeof Engine === 'object' ? Engine.URL : ''")
                f = os.path.join(SITE, eng[2:]) if eng.startswith("./assets/engine-") else ""
                leg = open(os.path.join(SITE, "legacy.js"), encoding="utf8").read()
                ok(bool(f) and os.path.exists(f) and "importScripts" not in leg and eng[2:] in open(os.path.join(SITE, "sw.js"), encoding="utf8").read(),
                   "the worker is a file of its own (%s, %d bytes), not in legacy.js, kept by the service worker" % (eng, os.path.getsize(f) if f and os.path.exists(f) else 0))
            ctx.close()
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
if os.environ.get("SPEED_JSON"): json.dump(table, open(os.environ["SPEED_JSON"], "w"), indent=1)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
