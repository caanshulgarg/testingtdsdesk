"""python3 tests/run_hang_open_client.py - "Page blocked" opening a large client from the sidebar (next-fix-client-open-freeze,
FINCOM-APP-STAGING-V, staging 13-Nov-2026 09:53 UTC, build mweqgvgb-68c505 = 61f76372f: 2,022 ms of script in one
IDBRequest.onsuccess, route client/dash, the sidebar's client card (side-client) 7 s before).
The build's source map puts the handler at src/js/00-core.js IDBStore.prefix (a cursor's onsuccess: the client's bills
read by Store.loadCompany), with a FrameRequestCallback (src/js/02 padSoon's frame) after it. With the client's books
kept in memory (Books.mem: read on Today), everything after that read ran in its task: openCompany's drawing, whose
Ledgers.watch opens the books (openBooksNow), and there the names cleaned, the ledger master's guesses (LedMaster.refresh:
LedMaster.usage, every entry) and the drawing of the Overview, whose TDS card worked out the TDS page's rows for the year
(TDS.rows: every entry) in the drawing; once the books were saved, the next frame worked those rows out again. 51,758
made-up entries: about 0.6 s at full speed here, 2 s on an office PC. The books read from this browser's store (not kept
in memory): the same work, in the books' own read (IDBRequest.onsuccess of Books.read). Now the TDS card's figure is
worked out behind the page in steps (parts/DashTds.jsx, lib/behind.jsx) and LedMaster.usage 8,000 entries a task while
the books are opening (openBooksNow, usageSoon of app/src/main.jsx), the same figures; autoMapCompanyLedgers
works Ledgers.usage out only when two ledgers are compared.
Made-up books only: the fixture's large client (tests/mis_big_books.py) copied 14 times (as run_hang_gst_year.py makes
them), saved in this browser's store; its MIS set to "off" (MIS.maybeRun's own run on opening, a month's first, is not
this freeze). Checks:
  1. the page reloaded (Today keeps the books in memory), the sidebar's "Back to" card: the client's Overview, every task
     of the opening within TASK_MS (default 200) at full speed; the same with the books read from the store (not in memory);
  2. the Overview's TDS card: "In the books (Tally)" the TDS page's figure for the year worked out at once (outside a
     drawing), and the one the build before the fix shows (DIGEST);
  3. the ledger master after the opening (b.map: every ledger's guess and count) the one LedMaster.refresh gives the saved
     books at once, and the one the build before the fix gives (DIGEST); LedMaster.usage a part at a time (u, i, j) the
     same as at once; the books' entries replaced while the books are opening: worked out at once from the new ones.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_OPEN_PORT") or 8341)
TASK_MS = int(os.environ.get("TASK_MS") or 200)
DIGEST = os.environ.get("DIGEST") or "TDS 2363DC5F | MAP 62BCF2D2"   # the TDS card's figure and the ledger master as 76ac2f85b (before the fix) gives them
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangopen-")
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
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")
BOOT = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
HASH = "(s) => { let h = 2166136261; for (const c of s){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).toUpperCase(); }"
# the ledger master as text (its keys in order; mapV, the count of refreshes, left out)
MAPJ = "(m) => JSON.stringify(Object.keys(m || {}).sort().map((n) => [n, Object.keys(m[n]).sort().map((k) => [k, m[n][k]])]))"
# the books' TDS for the year, worked out at once outside a drawing (as the Overview did in its drawing)
TDSY = "() => { const fy = fyOf(null); return Math.round(TDS.rows().filter((r) => r.fy === fy).reduce((a, r) => a + num(r.tds), 0) * 100) / 100; }"
# the long tasks from now on [start, ms], and the time the store took to hand over each record read (IDBStore.gets as
# it is, with q.result timed: the books' record, 51,758 entries, is about 0.3 s of the browser's own copying, the read
# itself and not the opening's work; counted apart)
WATCH = """() => { window.__lt = []; window.__rd = []; if (!window.__lto){ window.__lto = new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lt || []).push([e.startTime, e.duration]))); window.__lto.observe({type: 'longtask'});
  IDBStore.gets = function(keys){ return this.run((db) => new Promise((ok, no) => { const st = db.transaction('docs').objectStore('docs'), out = []; let n = keys.length;
    keys.forEach((k, i) => { const q = st.get(k); q.onsuccess = () => { const t = performance.now(); out[i] = q.result; window.__rd.push([t, performance.now() - t]); --n || ok(out); }; q.onerror = () => no(q.error); }); })); }; } }"""
# each long task less the records' reads in it [task ms, read ms]
TASKS = "() => window.__lt.map(([s, d]) => { const r = window.__rd.filter(([t]) => t >= s && t <= s + d).reduce((a, [, x]) => a + x, 0); return [Math.round(d - r), Math.round(r)]; })"

def card(pg):
    pg.evaluate("document.querySelectorAll('#app [data-dash-more]').forEach(d => d.open = true)")
    pg.wait_for_function("() => { const c = document.querySelector('#app .dash-card[data-tone=violet]'); return c && !c.querySelector('[data-working]') && /In the books/.test(c.innerText); }", timeout=20000)
    t = pg.inner_text('#app .dash-card[data-tone="violet"] .dash-row:has-text("In the books")')
    return float(t.split("₹")[-1].replace(",", "").strip())

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/review/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(1200)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(2000)
        cid = seed["cid"]
        pg.evaluate("async () => { S.books.misCfg = {freq: 'off'}; Store.saveCompany(CO(S.books.cid)); await saveBooks(); await Promise.all(Object.values(Store.chains)); goHome(); }"); pg.wait_for_timeout(1500)
        ok(50000 < seed["n"] <= 100000 and pg.evaluate("S.storeKind") == "idb", "made-up books: %d entries, kept in this browser's store" % seed["n"])
        # the saved books' ledger master worked out at once (before any opening of this page touches them)
        print("\n1. The client opened from the sidebar")
        pg.reload(); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(2500)
        ref = pg.evaluate("async (cid) => { const b = clone(await Books.read(cid)); const was = S.books; S.books = b; try { LedMaster.refresh(b); return (" + MAPJ + ")(b.map); } finally { S.books = was; } }", cid)
        worst = []
        for run in range(2):
            mem = run == 0
            if not mem:
                pg.evaluate("() => goHome()"); pg.wait_for_timeout(2500)
                pg.evaluate("(cid) => { Books.forget(cid); S.books = null; S.data[cid].loaded = false; }", cid)
            st = pg.evaluate("(cid) => [S.view, S.coId === cid, Books.mem.has(cid), !!document.querySelector('[data-side-client=back]')]", cid)
            ok(st[0] == "home" and st[1] and st[2] == mem and st[3], "   on a firm page, the books %s (%s)" % ("kept in memory (read on Today)" if mem else "only in this browser's store", st))
            pg.evaluate(WATCH)
            pg.click("[data-side-client=back]"); pg.wait_for_timeout(6000)
            r = pg.evaluate("(cid) => ({lt: (" + TASKS + ")(), view: [S.view, S.tab, S.coId === cid, !!S.books && S.books.cid === cid && !S.books.loading, (S.books.vouchers || []).length]})", cid)
            worst.append(max([x[0] for x in r["lt"]] + [0]))
            ok(r["view"][:4] == ["company", "dash", True, True] and r["view"][4] == seed["n"], "   the client's Overview, its books open (%s); the page's long tasks [ms, of which the store's reads] %s" % (r["view"], r["lt"][:12]))
            m = pg.evaluate("() => (" + MAPJ + ")(S.books.map)")
            ok(m == ref, "   the ledger master as LedMaster.refresh gives the saved books at once (%d ledgers)" % pg.evaluate("Object.keys(S.books.map).length"))
        ok(max(worst) <= TASK_MS, "every task of the opening within %d ms (the store's reads apart): %s ms" % (TASK_MS, worst))
        print("\n2. The Overview's TDS card")
        shown = card(pg); once = pg.evaluate(TDSY)
        ok(abs(shown - once) < 0.005 and once > 0, "In the books (Tally): %.2f, the TDS page's rows for the year worked out at once: %.2f" % (shown, once))
        got = "TDS %s | MAP %s" % (pg.evaluate(HASH, "%.2f" % shown), pg.evaluate(HASH, m))
        ok(got == DIGEST, "the same as the build before the fix: %s (%s)" % (got, DIGEST))
        print("\n3. LedMaster.usage a part at a time")
        r = pg.evaluate("""() => { const b = S.books, u = {}; for (let i = 0; i < b.vouchers.length; i += 7000) LedMaster.usage(b, u, i, i + 7000);
          return [JSON.stringify(u) === JSON.stringify(LedMaster.usage(b)), Object.keys(u).length]; }""")
        ok(r[0] and r[1] > 1000, "the same as at once, in the same order (%d ledgers)" % r[1])
        # the entries replaced while the books are opening (between two parts): the guesses from the new entries
        r = pg.evaluate("""async (cid) => { goHome(); Books.forget(cid); S.books = null; const p = openBooks(cid);
          await new Promise((ok) => { const t0 = Date.now(), t = setInterval(() => { if ((S.books && S.books.loading && S.books.vouchers && S.books.vouchers.length) || Date.now() - t0 > 5000) { clearInterval(t); ok(); } }, 1); });
          await new Promise((ok) => setTimeout(ok, 0));
          const b = S.books, g = b.vouchers.find((v) => v.ent.some((e) => /GST/i.test(e.l))).ent.find((e) => /GST/i.test(e.l)).l, m0 = clone(b.map);
          b.vouchers = b.vouchers.filter((v) => v.ent.every((e) => e.l !== g)); await p;
          const got = (""" + MAPJ + """)(b.map), c = Object.assign({}, b, {map: m0}); LedMaster.refresh(c);
          return [S.books === b && !b.loading, got === (""" + MAPJ + """)(c.map), b.vouchers.length, g]; }""", cid)
        ok(r[0] and r[1] and r[2] < seed["n"], "entries replaced during the opening: the counts and guesses from the new entries (%s)" % r)
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
ok(not errors, "no page errors %s" % errors[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
