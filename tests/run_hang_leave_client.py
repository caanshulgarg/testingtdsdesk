"""python3 tests/run_hang_leave_client.py - "Page blocked" leaving a large client (next-fix-hang-home, FINCOM-APP-STAGING-H,
staging 12-Nov-2026 06:18 UTC: 2,124 ms in a timer, TimerHandler:setTimeout, 2 s after a click on the sidebar's Clients
(data-bar) from the client's books; route home/clients).
The click runs navHome("clients") in FinComNav.go's timer. navHome, like goHome, goSettings, goTallyPage and openCompany,
closed the client switcher first (closeSwitcher), which drew the whole page again: the client's screen being left, with
every figure it works out (TDS: 118 of the click's 157 ms here at full speed), though no switcher was open, and then the
page change drew the new page. Made-up books only (the fixture's large client copied 14 times, as run_hang_gst_year.py
makes them, 51,758 entries) and 40 made-up clients. Checks:
  1. from the client's TDS page and GST › Year: the sidebar's Clients, Today, Help; the Tally page (goTallyPage); Settings
     (goSettings); the client's page is not drawn again after the click (no drawing of the page being left), the new page
     is shown, each within LEAVE_MS (default 130) at full speed;
  2. from the Clients list, another client opened (openCompany): the list is not drawn again before the client opens;
  3. the switcher as before: opened (side-client), Esc closes it (drawn closed at once); open, then the sidebar's Clients:
     the Clients page without the switcher; open, Enter on a client: that client opens, no switcher;
  4. the Clients page drawn after the click is the one a fresh drawing shows.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_LEAVE_PORT") or 8333)
LEAVE_MS = int(os.environ.get("LEAVE_MS") or 130)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangleave-")
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

# the large client (as run_hang_gst_year.py makes it) and 40 more made-up clients
SEED = """async () => {
  const c = newCompany({name: "ZZ BIG LEAVE", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const get = async u => new Blob([await (await fetch(u)).arrayBuffer()], {type: "text/xml"});
  const ms = await Books.importMasters(await get("/__big/Master.xml")), db = await Books.importDayBook(await get("/__big/DayBook.xml"));
  const base = db.vouchers, out = [], sh = (d, k) => String(Number(String(d).slice(0, 4)) + k) + String(d).slice(4);
  for (let j = 0; j < 14; j++) for (const v of base){
    let k = 0; if (j % 2){ k = sh(v.date, 1) <= "20261105" ? 1 : -1; }
    const w = j ? JSON.parse(JSON.stringify(v)) : v;
    if (j){ w.id = v.id + "-" + j; if (w.guid) w.guid = v.guid + "-" + j; if (w.no != null) w.no = String(v.no) + "/" + j; if (k){ w.date = sh(v.date, k); if (w.refDate && /^\\d{8}$/.test(w.refDate)) w.refDate = sh(w.refDate, k); } }
    out.push(w); }
  out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const b = Object.assign({loading: false, challans: [], alloc: {}}, {vouchers: out, meta: Object.assign({}, db.meta, {from: out[0].date, to: out[out.length - 1].date})},
    {cid: c.id, ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans});
  b.map = Books.mapLedgers(b.vouchers, {}); S.books = b; LedMaster.refresh(b); S.lk = null;
  for (let i = 0; i < 40; i++){ const o = newCompany({name: "ZZ Made Up Client " + String(i).padStart(2, "0"), gstin: ""}); S.companies[o.id] = o; D(o.id).loaded = true; }
  render();
  return {n: out.length, cid: c.id}; }"""
# every drawing (render, and the switcher's own redraw) with the page it drew; the long animation frames
INSTR = """() => { window.__dr = []; const at = () => [S.view, S.view === 'company' ? S.coId + ':' + S.tab + ':' + (S.booksTab || '') : S.homeTab, !!S.switcher].join('|');
  const r = window.render; window.render = function(){ window.__dr.push('render ' + at()); return r.apply(this, arguments); };
  const f = FinComReact.redraw; FinComReact.redraw = function(){ window.__dr.push('redraw ' + at()); return f.apply(this, arguments); };
  window.__lf = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lf.push(Math.round(e.duration)))).observe({type: 'long-animation-frame'}); } catch (e) {} }"""
WHERE = "() => [S.view, S.view === 'company' ? S.coId + ':' + S.tab + ':' + (S.booksTab || '') : S.homeTab, !!S.switcher].join('|')"
ROWS = "() => Array.from(document.querySelectorAll('#app table tbody tr')).map(r => r.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 60)"
SWITCHER = "() => !!document.querySelector('#modal .sw') && !document.getElementById('modal').classList.contains('hidden')"

def leave(pg, name, start_js, act, want, wait=1500):
    pg.evaluate(start_js); pg.wait_for_timeout(2500)
    before = pg.evaluate(WHERE)
    pg.evaluate("() => { window.__dr = []; window.__lf = []; }")
    act(); pg.wait_for_timeout(wait)
    m = pg.evaluate("() => ({dr: window.__dr.slice(), lf: window.__lf.slice()})"); now = pg.evaluate(WHERE)
    again = [d for d in m["dr"] if d.split(" ", 1)[1] == before]
    longest = max(m["lf"] or [0])
    ok(not again and now.startswith(want) and longest <= LEAVE_MS,
       "%s: from %s to %s, the page left drawn again %d times (none), the longest frame %d ms (at most %d) %s" % (name, before, now, len(again), longest, LEAVE_MS, m["dr"][:4]))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000, "large made-up books: %d entries, 40 more made-up clients" % seed["n"])
        cid = seed["cid"]
        pg.evaluate(INSTR)
        TDS = "() => { S.view = 'company'; S.coId = %r; S.tab = 'books'; S.booksTab = 'tds'; S.switcher = null; render(); }" % cid
        GST = "() => { S.view = 'company'; S.coId = %r; S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; S.switcher = null; render(); }" % cid
        side = lambda label: (lambda: pg.click('#side .side-link[data-side="%s"]' % label))
        # 1. leaving the client
        for nm, js in (("TDS", TDS), ("GST › Year", GST)):
            leave(pg, nm + " → the sidebar's Clients", js, side("Clients"), "home|clients|false")
        rows = pg.evaluate(ROWS); pg.evaluate("() => render()"); pg.wait_for_timeout(300)
        ok(len(rows) >= 40 and rows == pg.evaluate(ROWS), "4. the Clients page drawn after the click is the one a fresh drawing shows (%d rows)" % len(rows))
        leave(pg, "TDS → the Tally page (goTallyPage)", TDS, lambda: pg.evaluate("() => goTallyPage()"), "home|tally|false")
        leave(pg, "TDS → Settings (goSettings)", TDS, lambda: pg.evaluate("() => goSettings(null)"), "home|rules|false")
        leave(pg, "TDS → Help (the sidebar)", TDS, side("Help"), "home|help|false")
        leave(pg, "GST › Year → home (goHome)", GST, lambda: pg.evaluate("() => goHome()"), "home|")
        # 2. another client opened from the Clients list
        other = pg.evaluate("() => sortedCompanies().find(c => /^ZZ Made Up Client 07$/.test(c.name)).id")
        leave(pg, "the Clients list → another client (openCompany)", "() => { S.switcher = null; navHome('clients'); }",
              lambda: pg.evaluate("(id) => openCompany(id)", other), "company|" + other)
        # 3. the switcher as before
        pg.evaluate(GST); pg.wait_for_timeout(2000)
        pg.evaluate("() => document.querySelector('[data-side-client]').click()"); pg.wait_for_timeout(400)
        ok(pg.evaluate(SWITCHER) and pg.evaluate("!!S.switcher"), "3. the switcher opened (side-client)")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        ok(not pg.evaluate(SWITCHER) and not pg.evaluate("!!S.switcher") and pg.evaluate(WHERE).startswith("company|" + cid), "Esc: the switcher closed and drawn closed, the client still open (%s)" % pg.evaluate(WHERE))
        pg.evaluate("() => openSwitcher()"); pg.wait_for_timeout(400)
        ok(pg.evaluate(SWITCHER), "opened again (openSwitcher)")
        pg.evaluate("() => FinComNav.go(() => navHome('clients'))"); pg.wait_for_timeout(800)
        ok(not pg.evaluate(SWITCHER) and pg.evaluate(WHERE) == "home|clients|false", "then Clients: the Clients page without the switcher (%s)" % pg.evaluate(WHERE))
        pg.evaluate("() => openSwitcher()"); pg.wait_for_timeout(400)
        pg.keyboard.type("ZZ Made Up Client 03"); pg.wait_for_timeout(300); pg.keyboard.press("Enter"); pg.wait_for_timeout(1200)
        o3 = pg.evaluate("() => sortedCompanies().find(c => c.name === 'ZZ Made Up Client 03').id")
        ok(not pg.evaluate(SWITCHER) and pg.evaluate(WHERE).startswith("company|" + o3), "Enter on a client in the switcher: it opens, no switcher (%s)" % pg.evaluate(WHERE))
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
