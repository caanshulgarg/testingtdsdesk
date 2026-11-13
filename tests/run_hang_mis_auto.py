"""python3 tests/run_hang_mis_auto.py - the month's MIS on its own, in steps (next-fix-mis-freeze). On the first open of a
month (the books opened: Audit.maybeRun, MIS.maybeRun) MIS.maybeRun worked out the whole MIS pack in one go, in one timer
task: 1.4-2.3 s here on made-up books of 51,758 entries, about 4x that on a slow office PC. Now MIS.maybeRun only starts
it (MIS.autoStart, the day's audit's own stepping: Audit.autoSlice) and it is worked out in small idle steps, the same run
(MIS.runIn) as at once.
Made-up books only: the fixture client (77 entries), the fixture's large client copied 14 times (51,758 entries, as
run_hang_gst_year.py makes them), and the first 8,000 of those as a third client. Checks:
  1. timing: the large client's MIS last run in an earlier month (due, monthly): MIS.maybeRun takes at most START_MS
     (default 15) and no task of the MIS (each slice, its last with the save) over AUTO_MS (default 120); until it is
     done the books' last run is the earlier one, untouched;
  2. the same result: for each of the three clients, the books' whole MIS (the run, its figures, the history) after the
     run in steps is the one MIS.run gives at once from the same books (the times aside);
  3. an entry added in the period while it runs and the books saved: it starts again, and the result is the one at once
     on the books as they are now (the new sale in it);
  4. another client opened while it runs: it stops, neither client's MIS changes;
  5. a run by hand while it runs: that run stays, the one on its own stops;
  6. while a load of the books from the cloud copy runs (TCloud.loads), no step; after it, the run as at once;
  7. a step that throws: nothing kept, said once to window.__fincomReport.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_MIS_PORT") or 8343)
# each task is about Audit.AUTO.SLICE_MS (10 ms) of steps; a few steps cannot be split here (one registration's month of
# the GST 3B engine, server/_shared/gst3b.js, shared with the cloud: 40-60 ms on this machine), so a task at full speed
# stays under AUTO_MS; before, the one task was 1.4-2.3 s
AUTO_MS = int(os.environ.get("AUTO_MS") or 120)
START_MS = int(os.environ.get("START_MS") or 15)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangmis-")
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
  Z.due = (b) => { const r = MIS.autoRange(b); if (!(b.mis || {}).last) MIS.run(r.from, r.to, "by hand"); const y = new Date(Date.now() - 40 * 86400000).toISOString();
    b.mis.last.at = y; b.mis.history[0].at = y; };
  Z.slices = []; Z.jobs = [];
  // (a build from before the run in steps has neither: the checks below then fail, as they did)
  const sl = MIS.autoSlice; if (sl) MIS.autoSlice = function () { const t = performance.now(); try { return sl.apply(this, arguments); } finally { Z.slices.push(Math.round(performance.now() - t)); } };
  const st = MIS.autoStart; if (st) MIS.autoStart = function () { const j = st.apply(this, arguments); if (!Z.jobs.includes(j)) Z.jobs.push(j); return j; };
  Z.once = (b, m0) => { const keep = b.mis; b.mis = Z.copy(m0); const r = MIS.autoRange(b); memoScope(() => MIS.runNow(r.from, r.to, "on its own (" + MIS.cfg(b).freq + ")")); const t = Z.text(b.mis); b.mis = keep; return t; };
  Z.wait = (f, ms) => new Promise((ok, no) => { const t0 = Date.now(), go = () => { let v; try { v = f(); } catch (e) { v = false; } if (v) ok(v); else if (Date.now() - t0 > (ms || 60000)) no(new Error("timed out")); else setTimeout(go, 20); }; go(); });
  Z.idle = () => Z.wait(() => !MIS.auto, 90000);
  Z.lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > 50) Z.lt.push(Math.round(e.duration)); })).observe({type: "long-animation-frame"}); } catch (e) {}
  Z.rep = []; window.__fincomReport = (e, w) => Z.rep.push(String(w) + ": " + String(e && e.message || e));
  return true; }"""

# 1. the timing
TIMING = r"""async () => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.booksTab = "lookup"; render();
  Z.due(b); const m0 = Z.copy(b.mis), last0 = b.mis.last;
  await new Promise(r => setTimeout(r, 800));
  let t = performance.now(); Z.once(b, m0); const oneMs = Math.round(performance.now() - t);
  Z.slices = []; Z.lt = [];
  // (the first time, the MIS screen's file with its steps is loaded first: src/js/18-mis-pack.js)
  const cold = !MIS.steps, t0 = performance.now(); MIS.maybeRun(); const startMs = Math.round((performance.now() - t0) * 10) / 10;
  await Z.wait(() => MIS.auto, 5000).catch(() => null);
  const j = MIS.auto; let changed = false, polls = 0;
  while (MIS.auto) { polls++; if (b.mis.last !== last0) changed = true; await new Promise(r => setTimeout(r, 25)); }
  const doneMs = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 400));
  const now = Z.text(b.mis), want = Z.once(b, m0);
  return {cold, oneMs, startMs, doneMs, started: !!j, slices: Z.slices.length, max: Math.max(0, ...Z.slices), top: Z.slices.slice().sort((a, c) => c - a).slice(0, 6), lt: Z.lt.slice(),
    changedBefore: changed, polls, how: b.mis.last.how, today: String(b.mis.last.at).slice(0, 10) === new Date().toISOString().slice(0, 10), same: now === want, len: now.length, code: b.mis.last.code}; }"""

SAME = r"""async (k) => {
  const Z = window.__zz, b = Z.books[k]; Z.open(k); S.booksTab = "lookup"; render();
  Z.due(b); const m0 = Z.copy(b.mis); Z.jobs = [];
  MIS.maybeRun(); await Z.idle();
  const j = Z.jobs[0], now = Z.text(b.mis), want = Z.once(b, m0);
  return {n: b.vouchers.length, same: now === want, starts: j ? j.starts : 0, how: b.mis.last.how, code: b.mis.last.code, hist: b.mis.history.length}; }"""

EDIT = r"""async () => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.booksTab = "lookup"; render();
  Z.due(b); const m0 = Z.copy(b.mis), r = MIS.autoRange(b); Z.jobs = [];
  MIS.maybeRun(); const j = MIS.auto, n0 = Z.slices.length;
  await Z.wait(() => Z.slices.length >= n0 + 3, 20000).catch(() => null);
  const p = b.vouchers.find(v => v.date >= r.from && v.date <= r.to && Books.isSale(v) && (v.ent || []).length >= 2);
  const w = Object.assign(Z.copy(p), {id: "zzmis-1", no: "ZM1"}); b.vouchers = b.vouchers.concat([w]); saveBooks();
  await Z.idle();
  const now = Z.text(b.mis), want = Z.once(b, m0);
  return {starts: j ? j.starts : 0, same: now === want, sales: b.mis.last.sales.total, sales0: m0.last.sales.total, found: !!p}; }"""

SWITCH = r"""async () => {
  const Z = window.__zz, b = Z.books.big, o = Z.books.fix; Z.open("big"); S.booksTab = "lookup"; render();
  Z.due(b); const a0 = Z.text(b.mis), o0 = Z.text(o.mis);
  MIS.maybeRun(); const j = MIS.auto, n0 = Z.slices.length;
  await Z.wait(() => Z.slices.length >= n0 + 2, 20000).catch(() => null);
  Z.open("fix"); render();
  await new Promise(r => setTimeout(r, 2500));
  return {stopped: !!j && MIS.auto !== j, it: !!(j && j.it), bigSame: Z.text(b.mis) === a0, fixSame: Z.text(o.mis) === o0}; }"""

HAND = r"""async () => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); S.booksTab = "lookup"; render();
  Z.due(b); MIS.maybeRun(); const j = MIS.auto, n0 = Z.slices.length;
  await Z.wait(() => Z.slices.length >= n0 + 2, 20000).catch(() => null);
  const r = MIS.autoRange(b), hand = MIS.run(r.from, r.to, "run now"); saveBooks();
  await Z.idle(); await new Promise(r => setTimeout(r, 300));
  return {started: !!j, hand: b.mis.last === hand, how: b.mis.last.how}; }"""

LOADING = r"""async () => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); S.booksTab = "lookup"; render();
  Z.due(b); const m0 = Z.copy(b.mis), last0 = b.mis.last; Z.jobs = [];
  TCloud.loads++; let held;
  try { MIS.maybeRun(); await new Promise(r => setTimeout(r, 1200)); const j = MIS.auto; held = {job: !!j, starts: j ? j.starts : -1, kept: b.mis.last === last0}; }
  finally { TCloud.loads--; }
  await Z.idle();
  return Object.assign(held, {same: Z.text(b.mis) === Z.once(b, m0), how: b.mis.last.how}); }"""

THROW = r"""async () => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); S.booksTab = "lookup"; render();
  Z.due(b); const a0 = Z.text(b.mis); Z.rep = [];
  const c = MIS.compliance; MIS.compliance = function () { throw new Error("zz made-up failure"); };
  let threw = false; try { MIS.maybeRun(); } catch (e) { threw = true; }
  try { await Z.idle(); } finally { MIS.compliance = c; }
  return {threw, kept: Z.text(b.mis) === a0, rep: Z.rep.slice()}; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        pg.evaluate("() => { window.__fix = S.books; }")
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000, "large made-up books: %d entries" % seed["n"])
        # the day's audit on its own kept out of the way (its own test: run_hang_audit_auto.py)
        pg.evaluate("() => { Audit.maybeRun = () => {}; }")
        pg.evaluate(HELP)
        pg.evaluate("""() => { const Z = window.__zz, B = S.books; Z.books.big = B; Z.books.fix = window.__fix;
          const c = newCompany({name: "ZZ MID GST", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c;
          const m = Object.assign({}, B, {cid: c.id, vouchers: B.vouchers.slice(0, 8000), mis: null, audit: null, stale: null}); m.meta = Object.assign({}, B.meta, {to: m.vouchers[m.vouchers.length - 1].date}); Z.books.mid = m; }""")
        t = pg.evaluate(TIMING)
        pg.evaluate("() => loadPart('mis')")
        print("   before: the run at once %d ms; after: MIS.maybeRun %s ms, the result after %d ms in %d tasks, the longest %d ms %s; long frames meanwhile %s" % (
            t["oneMs"], t["startMs"], t["doneMs"], t["slices"], t["max"], t["top"], t["lt"]), flush=True)
        ok(t["startMs"] <= START_MS, "1. MIS.maybeRun only starts the month's MIS%s: %s ms (at most %d)" % (" (its steps' file loaded first)" if t["cold"] else "", t["startMs"], START_MS))
        ok(t["started"] and t["slices"] >= 10 and t["max"] <= AUTO_MS, "   no task of it over %d ms: the longest %d ms of %d tasks %s" % (AUTO_MS, t["max"], t["slices"], t["top"]))
        ok(t["started"] and not t["changedBefore"] and t["polls"] > 5, "   until it was done the books' last run was the earlier one, untouched (%d looks)" % t["polls"])
        ok(t["today"] and t["how"] == "on its own (monthly)", "   then today's run on its own (%s, code %s)" % (t["how"], t["code"]))
        ok(t["same"], "   the books' whole MIS is the one the run at once gives (%d characters)" % t["len"])
        for k in ("fix", "mid", "big"):
            s = pg.evaluate(SAME, k)
            ok(s["same"] and s["starts"] == 1 and s["how"] == "on its own (monthly)", "2. %s (%d entries): the run in steps = the run at once (code %s, %d in history)" % (k, s["n"], s["code"], s["hist"]))
        e = pg.evaluate(EDIT)
        ok(e["found"] and e["starts"] == 2 and e["same"] and e["sales"] != e["sales0"], "3. a sale added and saved while it runs: started again (%d starts), as at once on the books now (sales %s, were %s)" % (e["starts"], e["sales"], e["sales0"]))
        w = pg.evaluate(SWITCH)
        ok(w["stopped"] and not w["it"] and w["bigSame"] and w["fixSame"], "4. another client opened while it runs: stopped, neither client's MIS changed (%s)" % w)
        h = pg.evaluate(HAND)
        ok(h["started"] and h["hand"] and h["how"] == "run now", "5. a run by hand while it runs: that run stays (%s)" % h)
        l = pg.evaluate(LOADING)
        ok(l["job"] and l["starts"] == 0 and l["kept"] and l["same"] and l["how"] == "on its own (monthly)", "6. no step while the cloud copy's load runs, then the run as at once (%s)" % l)
        x = pg.evaluate(THROW)
        ok(not x["threw"] and x["kept"] and len(x["rep"]) == 1 and "MIS" in x["rep"][0], "7. a step that throws: nothing kept, reported once (%s)" % x["rep"])
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
