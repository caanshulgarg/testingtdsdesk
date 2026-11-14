"""python3 tests/run_hang_back_to_client.py - "Page blocked" in a click on the sidebar's client card, "Back to <client>"
(FINCOM-APP-STAGING-K: about 2 s in React's click handler; Side.jsx ClientCard -> backToClient -> Route.apply ->
openCompany, src/js/52 and 27). On a firm page (Clients, Today, Tally) the card goes back to the client's page last
shown: the click opened the client and drew its whole page (the Overview with its cards) in the click's own task.
Now the click only says it is taken (the card "Opening…", the thin bar) and returns; the client is opened and its page
drawn on the next frame (FinComNav.go, as the sidebar's own links), as "Add and open" leaves the books to a later task
(run_hang_add_client.py).
Made-up books only (the fixture's large client copied 14 times, 51,758 entries, as run_hang_gst_year.py makes them),
DRAFTS (default 400) made-up draft bills on it, as run_hang_bill_drafts.py makes them, and 300 more made-up clients. Checks:
  1. from the large client's Overview, then the Clients page: "Back to <client>": the click's own task within BACK_MS
     (default 200 at full speed; 380-420 ms before), the card saying "Opening…" as it returns; the client then opened
     and drawn in later tasks, each within BACK_MS (the drafts' checks a few a task: refreshStatsSoon), open on its
     Overview (client/dash, its address), drawn as a fresh drawing draws it;
  2. from its GST › Year, then the Tally page: back to GST › Year the same way;
  3. Back in the browser then returns to the firm page;
  4. two clicks while it is opening: one step in the browser's history, the card saying "Opening…" until it is drawn.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_BACK_PORT") or 8338)
BACK_MS = int(os.environ.get("BACK_MS") or 200)
DRAFTS = int(os.environ.get("DRAFTS") or 400)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangback-")
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
MORE = """() => { for (let i = 0; i < 300; i++){ const o = newCompany({name: "ZZ Made Up Client " + String(i).padStart(3, "0") + (i % 3 ? " Traders" : " Pvt Ltd"), gstin: ""}); S.companies[o.id] = o; D(o.id).loaded = true;
  o.stats = {drafts: i % 5, check: i % 7, records: 10}; } render(); return Object.keys(S.companies).length; }"""
# the click's own task: from the window's capture listener (before React's root listener) to its bubbling one (after
# it), and the long tasks seen after it (the later drawing)
INSTR = """() => { window.__ck = null; window.__lt = [];
  window.addEventListener('click', () => { window.__ck = {t0: performance.now()}; }, true);
  window.addEventListener('click', () => { if (!window.__ck) return; window.__ck.ms = Math.round(performance.now() - window.__ck.t0);
    const b = document.querySelector('#side [data-side-client]'); window.__ck.card = b ? b.innerText : ''; window.__ck.hash = location.hash; }, false);
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({type: 'longtask'}); }"""
# made-up drafts on the large client (run_hang_bill_drafts.py's)
DRAFT = """(nd) => { const cid = S.books.cid, d = S.data[cid] = S.data[cid] || {parties: {}, entries: {}}; d.loaded = true; d.entries = d.entries || {}; d.parties = d.parties || {};
  const bk = S.books, withG = Object.keys(bk.gstins || {}).filter(n => gstinValid(bk.gstins[n])).sort(), all = Object.keys(bk.ledInfo).sort();
  const mkG = (i) => { const b = '07AAZPQ' + String(1000 + i % 9000) + 'K1Z'; return b + gstinCheckChar(b + '0'); };
  const words = ['printer repair and courier charges', 'office rent for the month', 'electricity bill', 'internet broadband', 'legal consultancy fees', 'freight and cartage'];
  for (let i = 0; i < nd; i++){ const e = newEntry('zz-bill-' + i + '.pdf'); e.id = 'zzd' + i; const total = 1000 + (i * 37) % 90000, k = i % 3, nm = k === 0 && withG.length ? withG[i % withG.length] : all[(i * 13) % all.length];
    e.x = Object.assign(e.x || {}, {vendorName: k === 2 ? 'Made Up Vendor ' + i : nm, vendorGstin: k === 0 && withG.length ? bk.gstins[nm] : k === 1 ? mkG(i) : '', vendorPan: '', invoiceNo: 'ZZ-' + i,
      invoiceDate: '2026-0' + (1 + i % 9) + '-1' + (i % 9), total, taxable: Math.round(total / 1.18), description: words[i % words.length]});
    e.status = 'draft'; d.entries[e.id] = e; }
  return {gst: withG.length, ledgers: all.length, valid: gstinValid(mkG(1))}; }"""
CARD = "() => { const a = document.querySelector('#app'); return a ? a.innerText.replace(/\\s+/g, ' ').slice(0, 4000) : ''; }"
WHERE = "() => ({open: S.view === 'home' ? 'home/' + S.homeTab : S.view + '/' + S.tab + (S.tab === 'books' ? ':' + S.booksTab : ''), co: S.coId, hash: location.hash})"

def back(pg, cid, start_js, firm_js, want, want_hash, label):
    pg.evaluate(start_js); pg.wait_for_timeout(3000)
    pg.evaluate(firm_js); pg.wait_for_timeout(1500)
    firm = pg.evaluate(WHERE)
    pg.evaluate("() => { window.__ck = null; window.__lt = []; }")
    pg.click('#side [data-side-client="back"]')
    pg.wait_for_timeout(3000)
    m = pg.evaluate("() => ({ck: window.__ck, lt: window.__lt.slice()})")
    right = {"card": (m["ck"] or {}).get("card", ""), "hash": (m["ck"] or {}).get("hash", "")}
    ck = (m["ck"] or {}).get("ms", 99999)
    t0 = (m["ck"] or {}).get("t0", 0)
    clicked = [d for (s, d) in m["lt"] if s <= t0 + 1 and s + d >= t0 - 1]
    later = [d for (s, d) in m["lt"] if s > t0 + 1]
    task = max([ck] + clicked)
    ok(task <= BACK_MS and "Opening" in right["card"], "%s: the click's own task %d ms (at most %d; its handler %d ms), the card as it returns %r" % (label, task, BACK_MS, ck, right["card"].replace("\n", " ")[:60]))
    ok(max(later or [0]) <= BACK_MS, "   the client opened and drawn in later tasks, each within %d ms: %s" % (BACK_MS, later[:8]))
    now = pg.evaluate(WHERE)
    card = pg.evaluate(CARD); pg.evaluate("() => render()"); pg.wait_for_timeout(600)
    ok(now["co"] == cid and now["open"] == want and want_hash in now["hash"] and card == pg.evaluate(CARD),
       "   from %s back to %s (%s; right after the click %s), drawn as a fresh drawing draws it" % (firm["open"], now["open"], now["hash"], right["hash"]))
    return firm

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        n = pg.evaluate(MORE); pg.wait_for_timeout(1000)
        info = pg.evaluate(DRAFT, DRAFTS); pg.evaluate("() => { refreshStats(S.books.cid); render(); }"); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000 and n > 300 and info["ledgers"] > 4000, "large made-up books: %d entries, %d ledgers, %d made-up drafts, %d made-up clients" % (seed["n"], info["ledgers"], DRAFTS, n))
        pg.evaluate(INSTR)
        cid = seed["cid"]
        DASH = "() => Route.apply('#/c/%s/dash')" % cid
        back(pg, cid, DASH, "() => FinComNav.go(() => navHome('clients'))", "company/dash", "/dash", "1. Overview, then Clients, Back to the client")
        GST = "() => { S.view = 'company'; S.coId = %r; S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }" % cid
        back(pg, cid, GST, "() => FinComNav.go(() => navHome('tally'))", "company/books:gst", "/books/gst", "2. GST › Year, then Tally, Back to the client")
        pg.go_back(); pg.wait_for_timeout(2500)
        now = pg.evaluate(WHERE)
        ok(now["open"].startswith("home/tally"), "3. Back in the browser returns to the Tally page (%s, %s)" % (now["open"], now["hash"]))
        # 4. two clicks while it is opening: one step in the history; "Opening…" until the client is drawn
        pg.evaluate("() => FinComNav.go(() => navHome('clients'))"); pg.wait_for_timeout(1500)
        h0 = pg.evaluate("history.length")
        pg.evaluate("() => { window.__op = []; const b = () => document.querySelector('#side [data-side-client]'); b().click(); b().click();"
                    " const t = setInterval(() => { const x = b(); window.__op.push(S.view + '|' + (x ? x.innerText : '')); if (S.view === 'company') clearInterval(t); }, 0); }")
        pg.wait_for_timeout(3000)
        op = pg.evaluate("window.__op"); h1 = pg.evaluate("history.length"); now = pg.evaluate(WHERE)
        seen = [x for x in op if x.startswith("home|")]
        ok(h1 == h0 + 1 and now["open"] == "company/books:gst" and seen and all("Opening" in x for x in seen),
           "4. two clicks while opening: %d step in the history (one), open on %s (the page last shown), the card said Opening… until the client was drawn (%d looks: %s)" % (h1 - h0, now["open"], len(seen), [x.replace("\n", " ")[:50] for x in op[:3]]))
        pg.go_back(); pg.wait_for_timeout(2000)
        ok(pg.evaluate(WHERE)["open"] == "home/clients", "   Back returns to Clients")
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
