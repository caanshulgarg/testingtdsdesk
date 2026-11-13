"""python3 tests/run_hang_mis_rework.py - the MIS's other runs in steps (next-fix-mis-rework, after next-fix-mis-freeze's
run on its own: tests/run_hang_mis_auto.py). Review of 4e0d40f74: these still worked the MIS out in one go, in one task
(1.3-2.3 s here on made-up books of 51,758 entries):
  1. new entries from the cloud copy with a kept run and no out-of-date mark (TCloud.rework): no run at once; the same
     run in idle steps (MIS.runSoon, the auto job with its own period and words), no task over AUTO_MS (default 120),
     the books' MIS then the one MIS.run gives at once on the same books;
  2. an MSME type set on the MIS tab (misMsmeSet): no run at once; the tab says it is working it out ([data-mis-auto])
     until the new run is in; as at once;
  3. Run now by doAct("misRun") (the period chosen): as at once, its words "run now";
  4. an MIS report opened from Reports (RPT.open): as at once, "opened from Reports";
  5. the run's basis is the books' when it starts (as the audit's): a run whose books changed on the way is stale;
  6. the MIS screen's file loaded for a job behind the page quietly (loadPart(k, true): no reload on a failed fetch);
     a failure: no job, tried again later (half of AUTO.WAIT_MAX_MS), then the run.
Made-up books only (as run_hang_mis_auto.py). Runs on the React build (app/dist-test, or TDSDESK_SITE)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_MISRW_PORT") or 8347)
# each task is about Audit.AUTO.SLICE_MS (10 ms) of steps; a few steps cannot be split here (one registration's month of
# the GST 3B engine, server/_shared/gst3b.js, shared with the cloud: 40-60 ms on this machine), so a task at full speed
# stays under AUTO_MS; before, the one task was 1.4-2.3 s
AUTO_MS = int(os.environ.get("AUTO_MS") or 120)
START_MS = int(os.environ.get("START_MS") or 15)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangmisrw-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")

# the page's helpers: the clients by name, the MIS as kept (the times of today's runs set aside), the MIS made due (its
# last run dated 40 days ago), each task of the run timed, the run at once from a copy of the MIS as it was
HELP = r"""() => {
  const Z = window.__zz = {books: {}};
  Z.open = (k) => { const b = Z.books[k]; S.books = b; S.coId = b.cid; S.view = "company"; S.tab = "books"; };
  Z.copy = (x) => x == null ? x : JSON.parse(JSON.stringify(x));
  Z.text = (m) => { let s = JSON.stringify(m || null); const day = new Date().toISOString().slice(0, 10), ats = new Set();
    [(m || {}).last].concat((m || {}).history || []).forEach(h => { if (h && String(h.at).slice(0, 10) === day) ats.add(h.at); });
    ats.forEach(a => { s = s.split(JSON.stringify(a)).join('"AT"'); }); return s; };
  // a kept run of today (not due on its own), its period the year so far
  Z.kept = (b) => { const r = {from: Audit.fyStart(b.meta.to), to: b.meta.to}; memoScope(() => MIS.runNow(r.from, r.to, "by hand")); saveBooks(); delete (b.stale || {}).mis; return r; };
  Z.slices = []; Z.jobs = [];
  // (a build from before the run in steps has neither: the checks below then fail, as they did)
  const sl = MIS.autoSlice; if (sl) MIS.autoSlice = function () { const t = performance.now(); try { return sl.apply(this, arguments); } finally { Z.slices.push(Math.round(performance.now() - t)); } };
  const st = MIS.autoStart; if (st) MIS.autoStart = function () { const j = st.apply(this, arguments); if (!Z.jobs.includes(j)) Z.jobs.push(j); return j; };
  Z.once = (b, m0, from, to, how) => { const keep = b.mis; b.mis = Z.copy(m0); memoScope(() => MIS.runNow(from, to, how)); const t = Z.text(b.mis); b.mis = keep; return t; };
  // the runs at once, counted (none wanted)
  Z.ones = 0; const run = MIS.run; MIS.run = function () { Z.ones++; return run.apply(this, arguments); };
  Z.wait = (f, ms) => new Promise((ok, no) => { const t0 = Date.now(), go = () => { let v; try { v = f(); } catch (e) { v = false; } if (v) ok(v); else if (Date.now() - t0 > (ms || 60000)) no(new Error("timed out")); else setTimeout(go, 20); }; go(); });
  // until a job has started and ended
  Z.idle = async () => { await Z.wait(() => MIS.auto, 8000).catch(() => null); return Z.wait(() => !MIS.auto, 90000); };
  Z.lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > 50) Z.lt.push(Math.round(e.duration)); })).observe({type: "long-animation-frame"}); } catch (e) {}
  Z.rep = []; window.__fincomReport = (e, w) => Z.rep.push(String(w) + ": " + String(e && e.message || e));
  return true; }"""


REWORK = r"""async () => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.booksTab = "lookup"; render();
  const r = Z.kept(b), m0 = Z.copy(b.mis); await new Promise(z => setTimeout(z, 500));
  Z.ones = 0; Z.slices = []; Z.lt = []; const how = "after the books came in from the cloud copy";
  const t0 = performance.now(); TCloud.rework(b); const ms = Math.round(performance.now() - t0), ones = Z.ones;
  await Z.idle();
  return {ms, ones, slices: Z.slices.length, max: Math.max(0, ...Z.slices), top: Z.slices.slice().sort((a, c) => c - a).slice(0, 5), how: b.mis.last.how, same: Z.text(b.mis) === Z.once(b, m0, r.from, r.to, how)}; }"""

MSME = r"""async () => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); S.booksTab = "mis"; S.misTab = "summary"; render();
  const r = Z.kept(b); await new Promise(z => setTimeout(z, 1200));
  const party = (b.mis.last.pay.rows[0] || {}).party, m0 = Z.copy(b.mis);
  Z.ones = 0; misMsmeSet(party, "Micro"); const ones = Z.ones;
  const line = await Z.wait(() => (document.querySelector("#app [data-mis-auto]") || {}).innerText, 8000).catch(() => "");
  await Z.idle(); await new Promise(z => setTimeout(z, 600));
  const after = !!document.querySelector("#app [data-mis-auto]");
  return {party: !!party, ones, line, after, how: b.mis.last.how, same: Z.text(b.mis) === Z.once(b, m0, r.from, r.to, "by hand"), micro: b.mis.last.msme.length}; }"""

RUNNOW = r"""async () => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.booksTab = "lookup"; render();
  Z.kept(b); const m0 = Z.copy(b.mis), to = b.meta.to, from = to.slice(0, 6) + "01";
  S.misRange = {from: Audit.iso(from), to: Audit.iso(to)}; Z.ones = 0; Z.slices = [];
  const t0 = performance.now(); doAct("misRun"); const ms = Math.round(performance.now() - t0), ones = Z.ones;
  await Z.idle();
  return {ms, ones, max: Math.max(0, ...Z.slices), how: b.mis.last.how, same: Z.text(b.mis) === Z.once(b, m0, from, to, "run now")}; }"""

REPORTS = r"""async () => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.tab = "reports"; render();
  const m0 = Z.copy(b.mis), R = RPT.range(); b.mis.last.from = "20000101"; const m1 = Z.copy(b.mis); Z.ones = 0; Z.slices = [];
  const t0 = performance.now(); RPT.open("mis-summary"); const ms = Math.round(performance.now() - t0), ones = Z.ones;
  await Z.idle();
  return {ms, ones, max: Math.max(0, ...Z.slices), how: b.mis.last.how, from: b.mis.last.from === R.from, same: Z.text(b.mis) === Z.once(b, m1, R.from, R.to, "opened from Reports")}; }"""

BASIS = r"""() => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); const r = Z.kept(b), V0 = b.vouchers;
  let stale;
  memoScope(() => { const it = MIS.runIn(r.from, r.to, "x"); it.next(); it.next();
    b.vouchers = V0.concat([Object.assign(Z.copy(V0.find(v => Books.isSale(v))), {id: "zzbasis-1", no: "ZB1"})]);
    let x; while (!(x = it.next()).done); stale = MIS.stale(b); });
  b.vouchers = V0; saveBooks();
  return {stale, fresh: !MIS.stale(b) || "n/a"}; }"""

QUIET = r"""async () => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); S.booksTab = "lookup"; render();
  const steps = MIS.steps, lp = window.loadPart, wm = Audit.AUTO.WAIT_MAX_MS, calls = [];
  const y = new Date(Date.now() - 40 * 86400000).toISOString(); Z.kept(b); b.mis.last.at = y; b.mis.history[0].at = y;
  delete MIS.steps; Audit.AUTO.WAIT_MAX_MS = 600;
  window.loadPart = function (k, q) { calls.push([k, q]); if (calls.length === 1) return Promise.reject(new Error("zz made-up fetch failure")); MIS.steps = steps; return Promise.resolve(); };
  let res;
  try { MIS.maybeRun(); await new Promise(z => setTimeout(z, 100)); const job0 = !!MIS.auto;
    await Z.wait(() => calls.length >= 2, 5000).catch(() => null); await Z.idle();
    res = {calls, job0, how: b.mis.last.how, today: String(b.mis.last.at).slice(0, 10) === new Date().toISOString().slice(0, 10)}; }
  finally { window.loadPart = lp; MIS.steps = MIS.steps || steps; Audit.AUTO.WAIT_MAX_MS = wm; }
  return res; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        pg.evaluate("() => { window.__fix = S.books; }")
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000, "large made-up books: %d entries" % seed["n"])
        pg.evaluate("() => { Audit.maybeRun = () => {}; }")
        pg.evaluate(HELP)
        pg.evaluate("""() => { const Z = window.__zz, B = S.books; Z.books.big = B; Z.books.fix = window.__fix;
          const c = newCompany({name: "ZZ MID GST", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c;
          const m = Object.assign({}, B, {cid: c.id, vouchers: B.vouchers.slice(0, 8000), mis: null, audit: null, stale: null}); m.meta = Object.assign({}, B.meta, {to: m.vouchers[m.vouchers.length - 1].date}); Z.books.mid = m; }""")
        pg.evaluate("() => loadPart('mis')"); pg.wait_for_timeout(500)
        t = pg.evaluate(REWORK)
        ok(t["ones"] == 0 and t["slices"] >= 10 and t["max"] <= AUTO_MS and t["same"] and t["how"] == "after the books came in from the cloud copy",
           "1. the cloud copy's new entries (TCloud.rework, %d ms): %d runs at once; in %d tasks, the longest %d ms %s; as at once" % (t["ms"], t["ones"], t["slices"], t["max"], t["top"]))
        m = pg.evaluate(MSME)
        ok(m["party"] and m["ones"] == 0 and "Working out" in m["line"] and not m["after"] and m["same"] and m["how"] == "by hand",
           "2. an MSME type set (misMsmeSet): %d runs at once, the tab said %r while it ran, then the new run (as at once, %d MSME lines)" % (m["ones"], m["line"][:60], m["micro"]))
        n = pg.evaluate(RUNNOW)
        ok(n["ones"] == 0 and n["max"] <= AUTO_MS and n["same"] and n["how"] == "run now", "3. doAct misRun (%d ms): %d runs at once, the longest task %d ms, as at once" % (n["ms"], n["ones"], n["max"]))
        r = pg.evaluate(REPORTS)
        ok(r["ones"] == 0 and r["max"] <= AUTO_MS and r["same"] and r["from"] and r["how"] == "opened from Reports", "4. an MIS report from Reports (%d ms): %d runs at once, the longest task %d ms, as at once" % (r["ms"], r["ones"], r["max"]))
        s = pg.evaluate(BASIS)
        ok(s["stale"] is True, "5. a run whose books changed on the way is stale (its basis from its start): %s" % s)
        q = pg.evaluate(QUIET)
        ok(len(q["calls"]) >= 2 and all(c == ["mis", True] for c in q["calls"]) and not q["job0"] and q["today"] and q["how"] == "on its own (monthly)",
           "6. the MIS screen's file loaded quietly for the job (%s); after a failure no job, then tried again and run" % q["calls"])
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
