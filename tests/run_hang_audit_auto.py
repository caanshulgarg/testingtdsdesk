"""python3 tests/run_hang_audit_auto.py - the day's first audit on its own, in steps (next-audit-steps, owner-approved
12-Nov-2026). It ran in one go right after new entries came in from the cloud copy (TCloud.rework, Audit.maybeRun) or
the books opened, and held the page for it: 0.8-1.4 s here on made-up books of 51,758 entries, about 5.6 s on the
owner's PC. Now Audit.autoStart works it out in small steps between the page's own work (Audit.autoSlice, each task
about Audit.AUTO.SLICE_MS of steps), the same run (Audit.runIn) as at once.
Made-up books only: the fixture client (77 entries), the fixture's large client copied 14 times (51,758 entries, as
run_hang_gst_year.py makes them), and the first 8,000 of those as a third client. Checks:
  1. timing: the large client's audit last run yesterday, 5 new entries come in (TallyRead.after, TCloud.rework, as the
     cloud copy brings them): the rework only starts the audit (at most START_MS, default 15), and no task of the audit
     (each autoSlice, its last one with the save) takes over AUTO_MS (default 80) at full speed; the result comes a few
     seconds later, and until then the books' last run is yesterday's, untouched;
  2. the same result: for each of the three clients, the books' whole audit (the run, its findings and rows, the items,
     the history) after the run in steps is the one Audit.run gives at once from the same books (the times aside);
  3. an entry added while it runs, or one replaced in the list in place, and the books saved: it starts again, and its
     result is the one at once on the books as they are after the change (the change is in it);
  4. another client opened while it runs: it stops; neither client's audit changes and nothing is said of it;
  5. the Audit tab while it runs: the line "Checking the books for today's audit (n of N checks)", no second run of the
     tab's own (Audit._again), then the new run's findings; a run by hand while it runs: that run stays, the one on its
     own stops.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_AUDIT_PORT") or 8337)
AUTO_MS = int(os.environ.get("AUTO_MS") or 80)
START_MS = int(os.environ.get("START_MS") or 15)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangaudit-")
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

# the page's helpers: the clients by name, the audit as kept (with the times of a run set aside), the audit made due
# (its last run dated yesterday), each task of the audit timed, the run at once from a copy of the audit as it was
HELP = r"""() => {
  const Z = window.__zz = {books: {}};
  Z.open = (k) => { const b = Z.books[k]; S.books = b; S.coId = b.cid; S.view = "company"; S.tab = "books"; };
  Z.copy = (x) => x == null ? x : JSON.parse(JSON.stringify(x));
  // the books' whole audit as text, each time a run of today wrote set to "AT"
  Z.text = (au) => { let s = JSON.stringify(au || null); const ats = new Set(); ((au || {}).history || []).forEach(h => { if (String(h.at).slice(0, 10) === new Date().toISOString().slice(0, 10)) ats.add(h.at); });
    ats.forEach(a => { s = s.split(JSON.stringify(a)).join('"AT"'); }); return s; };
  Z.due = (b) => { const r = Audit.defaultRange(b); if (!(b.audit || {}).last) Audit.run(r.from, r.to, "by hand"); const y = new Date(Date.now() - 86400000).toISOString();
    b.audit.last.at = y; b.audit.history[0].at = y; Object.values(b.audit.items || {}).forEach(it => { if (it.first > y) it.first = y; if (it.last > y) it.last = y; if (it.solved > y) it.solved = y; if (it.reopened > y) it.reopened = y; }); };
  Z.slices = []; Z.jobs = [];
  // (a build from before the run in steps has neither: the checks below then fail, as they did)
  const sl = Audit.autoSlice; if (sl) Audit.autoSlice = function (j) { const t = performance.now(); try { return sl.apply(this, arguments); } finally { Z.slices.push(Math.round(performance.now() - t)); } };
  const st = Audit.autoStart; if (st) Audit.autoStart = function (b) { const j = st.apply(this, arguments); if (!Z.jobs.includes(j)) Z.jobs.push(j); return j; };
  Z.toasts = []; const tt = window.toast; window.toast = function (m) { Z.toasts.push(String(m)); return tt.apply(this, arguments); };
  // the run at once, from the audit as it was (a copy), for the same period and words
  Z.once = (b, au0) => { const keep = b.audit; b.audit = Z.copy(au0); const r = Audit.defaultRange(b); memoScope(() => Audit.runNow(r.from, r.to, "on its own (" + Audit.cfg(b).freq + ")")); const t = Z.text(b.audit); b.audit = keep; return t; };
  Z.wait = (f, ms) => new Promise((ok, no) => { const t0 = Date.now(), go = () => { let v; try { v = f(); } catch (e) { v = false; } if (v) ok(v); else if (Date.now() - t0 > (ms || 60000)) no(new Error("timed out")); else setTimeout(go, 20); }; go(); });
  Z.idle = () => Z.wait(() => !Audit.auto, 90000);
  // the long frames meanwhile, each with the page's script that took longest in it (for the report)
  Z.lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > 50) Z.lt.push(Math.round(e.duration) + ":" + (((e.scripts || []).slice().sort((a, c) => c.duration - a.duration)[0] || {}).invoker || "")); })).observe({type: "long-animation-frame"}); } catch (e) {}
  return true; }"""

# 1. the timing: new entries from the cloud copy, the rework, the audit in steps
TIMING = r"""async (n) => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.booksTab = "lookup"; render();
  Z.due(b); const au0 = Z.copy(b.audit), last0 = b.audit.last;
  await new Promise(r => setTimeout(r, 800));
  // the run at once, as before (the time it held the page)
  let t = performance.now(); Z.once(b, au0); const oneMs = Math.round(performance.now() - t);
  const src = b.vouchers.slice(-400).filter(v => (v.ent || []).length >= 2 && Books.isSale(v)).slice(0, n).map((v, k) => Object.assign(Z.copy(v), {id: "zznew-" + k, no: "ZN" + k}));
  b.vouchers = b.vouchers.concat(src); TallyRead.after(b, "after the books came in from the cloud copy", null); await saveBooks();
  await new Promise(r => setTimeout(r, 1500));
  Z.slices = []; Z.lt = []; Z.toasts = [];
  const mr = Audit.maybeRun; let startMs = -1; Audit.maybeRun = function () { const t0 = performance.now(); try { return mr.apply(this, arguments); } finally { startMs = performance.now() - t0; } };
  const t0 = performance.now(); TCloud.rework(b); const reworkMs = Math.round(performance.now() - t0); Audit.maybeRun = mr;
  const j = Audit.auto; let changed = false, polls = 0;
  while (Audit.auto) { polls++; if (b.audit.last !== last0) changed = true; await new Promise(r => setTimeout(r, 25)); }
  const doneMs = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 400));
  const now = Z.text(b.audit), want = Z.once(b, au0);
  return {oneMs, reworkMs, startMs: Math.round(startMs * 10) / 10, doneMs, started: !!j, starts: j ? j.starts : 0, slices: Z.slices.length, max: Math.max(0, ...Z.slices), top: Z.slices.slice().sort((a, c) => c - a).slice(0, 6),
    lt: Z.lt.slice(), changedBefore: changed, polls, how: b.audit.last.how, today: String(b.audit.last.at).slice(0, 10) === new Date().toISOString().slice(0, 10), same: now === want, len: now.length, findings: b.audit.last.findings.length,
    toast: Z.toasts.filter(x => /Audit ran on its own/.test(x)).length}; }"""

# 2. the same result, client by client
SAME = r"""async (k) => {
  const Z = window.__zz, b = Z.books[k]; Z.open(k); S.booksTab = "lookup"; render();
  Z.due(b); const au0 = Z.copy(b.audit); Z.jobs = [];
  Audit.maybeRun(); await Z.idle();
  const j = Z.jobs[0], now = Z.text(b.audit), want = Z.once(b, au0);
  return {n: b.vouchers.length, same: now === want, starts: j ? j.starts : 0, findings: b.audit.last.findings.length, items: Object.keys(b.audit.items || {}).length, how: b.audit.last.how, code: b.audit.last.code}; }"""

# 3. the books changed while it runs: an entry added, or one replaced in the list in place, and the books saved (as an
# edit is: a figure the page keeps sees a change in place at the save that follows it)
EDIT = r"""async (how) => {
  const Z = window.__zz, b = Z.books.big; Z.open("big"); S.booksTab = "lookup"; render();
  Z.due(b); const au0 = Z.copy(b.audit); Z.jobs = [];
  const r = Audit.defaultRange(b), dupOf = (au) => ((au.last.findings.find(f => f.id === "duplicates:dupRef") || {}).count || 0);
  Audit.maybeRun(); const j = Audit.auto;
  await Z.wait(() => j.prog && j.prog.k >= 3, 60000);
  const was = j.prog.k;
  // a supplier bill entered again (the same party, bill number and amount): one more "same bill twice"
  const p = b.vouchers.find(v => v.date >= r.from && v.date <= r.to && !Books.isSale(v) && !/RECEIPT|PAYMENT|CONTRA/i.test(v.type) && v.ref && String(v.ref).length >= 4 && !/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(String(v.ref).trim()) && v.ent.some(e => e.a > 0 && Audit.isCreditor(e.l)));
  if (how === "add") { const w = Object.assign(Z.copy(p), {id: "zzdup-1", no: "ZD1"}); b.vouchers = b.vouchers.concat([w]); saveBooks(); }
  else { const i = b.vouchers.findIndex(v => v !== p && v.date >= r.from && v.date <= r.to && !Books.isSale(v) && !/RECEIPT|PAYMENT|CONTRA/i.test(v.type) && v.ent.some(e => e.a > 0 && Audit.isCreditor(e.l)) && !v.ref);
    const w = Z.copy(b.vouchers[i]); w.ref = p.ref; w.ent = Z.copy(p.ent); b.vouchers[i] = w; saveBooks(); }
  await Z.idle();
  const now = Z.text(b.audit), want = Z.once(b, au0);
  return {was, starts: j.starts, same: now === want, dupNow: dupOf(b.audit), dupBefore: dupOf(au0), found: !!p, how: b.audit.last.how}; }"""

# 4. another client opened while it runs
SWITCH = r"""async () => {
  const Z = window.__zz, b = Z.books.big, o = Z.books.fix; Z.open("big"); S.booksTab = "lookup"; render();
  Z.due(b); const a0 = Z.text(b.audit), o0 = Z.text(o.audit); Z.toasts = [];
  Audit.maybeRun(); const j = Audit.auto;
  await Z.wait(() => j.prog && j.prog.k >= 2, 60000);
  Z.open("fix"); render();
  await new Promise(r => setTimeout(r, 2500));
  const res = {stopped: Audit.auto === null || Audit.auto !== j, bigSame: Z.text(b.audit) === a0, fixSame: Z.text(o.audit) === o0, said: Z.toasts.filter(x => /Audit ran on its own/.test(x)).length, it: !!j.it};
  // and back: it is still due, and runs again from the start when asked
  return res; }"""

# 5. the Audit tab while it runs, then a run by hand while it runs
TAB = r"""async () => {
  const Z = window.__zz, b = Z.books.mid; Z.open("mid"); S.booksTab = "audit"; S.auditTab = "find"; render();
  await new Promise(r => setTimeout(r, 600));
  Z.due(b); delete b.stale; Audit._again = false; render(); await new Promise(r => setTimeout(r, 300));
  const shown0 = !!document.querySelector("#app [data-audit-runline]");
  // a new entry: the last run no longer fits the books (the tab would work it out again by itself)
  b.vouchers = b.vouchers.concat([Object.assign(Z.copy(b.vouchers.find(v => Books.isSale(v))), {id: "zztab-1", no: "ZT1"})]); saveBooks();
  Audit.maybeRun(); const j = Audit.auto; render();
  await Z.wait(() => document.querySelector("#app [data-audit-auto]"), 5000).catch(() => null);
  const line = (document.querySelector("#app [data-audit-auto]") || {}).innerText || "", again = !!Audit._again;
  await Z.idle(); await new Promise(r => setTimeout(r, 1500));
  const after = {line: !!document.querySelector("#app [data-audit-auto]"), runline: ((document.querySelector("#app [data-audit-runline]") || {}).innerText || "").slice(0, 90), how: b.audit.last.how};
  // a run by hand while it runs: that run stays
  Z.due(b); Audit.maybeRun(); const j2 = Audit.auto;
  await Z.wait(() => j2.prog && j2.prog.k >= 2, 60000).catch(() => null);
  const r = Audit.defaultRange(b), hand = Audit.run(r.from, r.to, "run now"); saveBooks();
  await Z.idle(); await new Promise(r => setTimeout(r, 300));
  return {shown0, line, again, after, hand: b.audit.last === hand, how2: b.audit.last.how, started: !!j && !!j2}; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        pg.evaluate("() => { window.__fix = S.books; }")
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000, "large made-up books: %d entries" % seed["n"])
        pg.evaluate(HELP)
        # the third client: the first 8,000 entries of the large one
        pg.evaluate("""() => { const Z = window.__zz, B = S.books; Z.books.big = B; Z.books.fix = window.__fix;
          const c = newCompany({name: "ZZ MID GST", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c;
          const m = Object.assign({}, B, {cid: c.id, vouchers: B.vouchers.slice(0, 8000), audit: null, stale: null}); m.meta = Object.assign({}, B.meta, {to: m.vouchers[m.vouchers.length - 1].date}); Z.books.mid = m; }""")
        # 1. timing
        t = pg.evaluate(TIMING, 5)
        print("   before: the run at once %d ms; after: the rework %d ms (the audit's start %s ms), the result after %d ms in %d tasks, the longest %d ms %s; long tasks meanwhile %s" % (
            t["oneMs"], t["reworkMs"], t["startMs"], t["doneMs"], t["slices"], t["max"], t["top"], t["lt"]), flush=True)
        ok(t["started"] and 0 <= t["startMs"] <= START_MS, "1. the new entries' rework only starts the audit: %s ms (at most %d)" % (t["startMs"], START_MS))
        ok(t["slices"] >= 10 and t["max"] <= AUTO_MS, "   no task of the audit over %d ms: the longest %d ms of %d tasks %s" % (AUTO_MS, t["max"], t["slices"], t["top"]))
        ok(not t["changedBefore"] and t["polls"] > 5, "   until it was done the books' last run was yesterday's, untouched (%d looks)" % t["polls"])
        ok(t["today"] and t["how"] == "on its own (daily)" and t["toast"] == 1, "   then today's run on its own, said once (%s, %d findings)" % (t["how"], t["findings"]))
        ok(t["same"], "   the books' whole audit is the one the run at once gives (%d characters)" % t["len"])
        # 2. the same result for each client
        for k in ("fix", "mid", "big"):
            s = pg.evaluate(SAME, k)
            ok(s["same"] and s["starts"] == 1 and s["how"] == "on its own (daily)", "2. %s (%d entries): the run in steps = the run at once (%d findings, %d items, code %s)" % (k, s["n"], s["findings"], s["items"], s["code"]))
        # 3. the books changed while it runs
        e = pg.evaluate(EDIT, "add")
        ok(e["found"] and e["starts"] == 2 and e["same"] and e["dupNow"] == e["dupBefore"] + 1, "3. an entry added and saved after %d checks: started again (%d starts), the result is the one at once on the books now (same bill twice: %d, was %d)" % (e["was"], e["starts"], e["dupNow"], e["dupBefore"]))
        e = pg.evaluate(EDIT, "replace")
        ok(e["found"] and e["starts"] == 2 and e["same"] and e["dupNow"] == e["dupBefore"] + 1, "   an entry replaced in the list in place and saved after %d checks: started again (%d starts), as at once (%d, was %d)" % (e["was"], e["starts"], e["dupNow"], e["dupBefore"]))
        # 4. another client opened
        w = pg.evaluate(SWITCH)
        ok(w["stopped"] and not w["it"] and w["bigSame"] and w["fixSame"] and w["said"] == 0, "4. another client opened while it runs: stopped, neither client's audit changed, nothing said (%s)" % w)
        # 5. the Audit tab
        a = pg.evaluate(TAB)
        ok(a["started"] and "Checking the books for today" in a["line"] and " of " in a["line"] and not a["again"], "5. the Audit tab while it runs: %r, no run of the tab's own" % a["line"][:90])
        ok(not a["after"]["line"] and a["after"]["how"] == "on its own (daily)" and "on its own" in a["after"]["runline"], "   then the new run shown: %r" % a["after"]["runline"])
        ok(a["hand"] and a["how2"] == "run now", "   a run by hand while it runs: that run stays (%s)" % a["how2"])
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
