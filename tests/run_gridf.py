"""python3 run_gridf.py - the column filters on every table of the books (Look up, Reports, TDS, GST): a filter finds
entries beyond the rows first drawn (a long table shows everything once filtered), and a date column filters by dates."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("TDSDESK_DATA", os.path.join(HERE, "data"))
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8147), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8147/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "import"; S.loadingCo = false; render(); }""")
    pg.wait_for_timeout(1500)
    pg.set_input_files("#booksIn", os.path.join(DATA, "DayBook.xml"))
    for i in range(240):
        pg.wait_for_timeout(500)
        if pg.evaluate("S.books && !S.books.busy && S.books.vouchers.length > 0"): break
    # Look up, every entry: more than are drawn at first
    pg.evaluate("""() => { S.booksTab = 'lookup'; render(); const x = LK.st(); x.kind = 'find'; x.q = ''; x.from = '20250401'; x.to = '20260331'; LK.run(); }""")
    pg.wait_for_timeout(3000)
    n = pg.evaluate("S.lk.res.rows.length"); drawn = pg.evaluate("document.querySelectorAll('#app table.lk-t tbody tr').length")
    ok(n > drawn and pg.evaluate("!!document.querySelector('#app table.lk-t .gff')"), "a long list: %d entries, %d drawn at first, with a funnel on each heading" % (n, drawn))
    # an entry far down the list, by its number
    last = pg.evaluate("S.lk.res.rows[S.lk.res.rows.length - 1]")
    heads = pg.evaluate("Array.from(document.querySelectorAll('#app table.lk-t thead th')).map(th => th.innerText.trim())")
    ino = [i for i, h in enumerate(heads) if h.lower().startswith("no")][0]
    pg.click('#app table.lk-t .gff[data-gfi="%d"]' % ino); pg.wait_for_timeout(300)
    pg.fill('#gfpop input[data-gfin="q"]', str(last["no"])); pg.wait_for_timeout(3000)
    vis = pg.evaluate("Array.from(document.querySelectorAll('#app table.lk-t tbody tr')).filter(r => r.style.display !== 'none' && !r.classList.contains('lk-tot')).map(r => r.innerText)")
    ok(vis and any(str(last["no"]) in v for v in vis), "the filter finds an entry beyond the first rows drawn (no. %s): %d shown" % (last["no"], len(vis)))
    ok("Showing" in pg.inner_text("#app"), "and says how many are shown, with their sums")
    ok(pg.evaluate("(() => { const r = document.getElementById('gfpop').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), "the filter box stays on the screen")
    pg.click("#gfpop [data-gfx=clear]"); pg.wait_for_timeout(300); pg.click("#gfpop .cp-foot [data-gfx=close]"); pg.wait_for_timeout(300)
    # the date column: a range of dates
    pg.click('#app table.lk-t .gff[data-gfi="0"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("!!document.querySelector('#gfpop [data-gfq=quarter]') && !!document.querySelector('#gfpop input[type=date]')"), "a date column offers This month, This quarter, This year and a From/To")
    pg.fill('#gfpop input[data-gfin="from"]', "2025-06-01"); pg.fill('#gfpop input[data-gfin="to"]', "2025-06-30"); pg.wait_for_timeout(2500)
    want = pg.evaluate("S.lk.res.rows.filter(v => v.date >= '20250601' && v.date <= '20250630').length")
    got = pg.evaluate("Array.from(document.querySelectorAll('#app table.lk-t tbody tr')).filter(r => r.style.display !== 'none' && r.cells.length > 3 && !r.classList.contains('lk-tot')).length")
    ok(want > 0 and got == want, "only June's entries are shown: %d of %d" % (got, want))
    pg.screenshot(path=os.path.join(OUT, "gridf.png"))
    pg.evaluate("GridF.close()")
    # the other pages of the books: their tables carry the filters too
    for rid in ["mis-sales", "gst-r1", "gst-inreg", "tds-q", "mis-cc"]:
        pg.evaluate("(id) => { S.booksTab = 'reports'; render(); RPT.open(id); }", rid); pg.wait_for_timeout(1500)
        ok(pg.evaluate("Array.from(document.querySelectorAll('#app table.bk-table')).some(t => t.querySelector('.gff'))"), "filters on the tables of " + rid)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:300]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
