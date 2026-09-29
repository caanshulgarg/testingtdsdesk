"""python3 run_parts_ui.py - the day book brought in part by part (dates chosen each time; each part fills only its
dates, nothing doubled), and opening balances from a trial balance exported from Tally."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("TDSDESK_DATA", os.path.join(HERE, "data"))
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8143), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def wait_idle(pg, sec=120):
    for i in range(sec * 2):
        pg.wait_for_timeout(500)
        if pg.evaluate("S.books && !S.books.busy"): return
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8143/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "import"; S.loadingCo = false; render(); }""")
    pg.wait_for_timeout(1500)
    day = os.path.join(DATA, "DayBook.xml")
    def part(a, b):
        pg.fill("input[data-dbfrom]", a); pg.dispatch_event("input[data-dbfrom]", "change"); pg.wait_for_timeout(200)
        pg.fill("input[data-dbto]", b); pg.dispatch_event("input[data-dbto]", "change"); pg.wait_for_timeout(200)
        pg.set_input_files("#booksIn", day); pg.wait_for_timeout(1500); wait_idle(pg)
    part("2025-04-01", "2025-09-30")
    n1 = pg.evaluate("S.books.vouchers.length"); mx1 = pg.evaluate("S.books.vouchers.map(v => v.date).sort().pop()")
    ok(n1 > 0 and mx1 <= "20250930", "the first part: %d entries, none after 30 September (%s)" % (n1, mx1))
    part("2025-10-01", "2026-03-31")
    n2 = pg.evaluate("S.books.vouchers.length")
    ok(n2 > n1, "the second part is added to the first: %d entries in all" % n2)
    part("2025-04-01", "2025-09-30")
    ok(pg.evaluate("S.books.vouchers.length") == n2, "the first part again: it replaces its own dates, nothing doubled (%d)" % pg.evaluate("S.books.vouchers.length"))
    t = pg.inner_text("#app")
    ok("01 Apr 2025 to 30 Sept 2025" in t.replace("Sep ", "Sept ") or "Apr 2025 to 30 Sep" in t, "the parts brought in are listed")
    ok(pg.evaluate("S.books.meta.parts.length") == 2, "two parts kept (the repeat replaced the first)")
    ok("Setting up ZZ TEST" in t and "1. Day book" in t and "2. Opening balances" in t and "4. Tally Bridge" in t and "5. FinCom" in t, "the setup list shows each step and what is missing")
    # opening balances from a trial balance exported from Tally (ledgers shown), as on 31 March 2025
    led = pg.evaluate("Object.keys(S.books.map).slice(0, 3)")
    tb = ("<ENVELOPE><DSPACCNAME><DSPDISPNAME>Capital Account</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>500.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>"
          "<DSPACCNAME><DSPDISPNAME>%s</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>-1000.00</DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>"
          "<DSPACCNAME><DSPDISPNAME>%s</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>1,000.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO></ENVELOPE>") % (led[0].replace("&", "&amp;"), led[1].replace("&", "&amp;"))
    fp = os.path.join(OUT, "tb.xml"); open(fp, "w").write(tb)
    ok(pg.input_value("input[data-tbon]") == "2025-03-31", "the trial balance date offered is the day before the first part: " + pg.input_value("input[data-tbon]"))
    pg.set_input_files("#tbIn", fp); pg.wait_for_timeout(2500)
    o = pg.evaluate("(l) => [S.books.tb.led[l[0]].open, S.books.tb.led[l[1]].open, S.books.tb.from, S.books.tb.source || '', Object.keys(S.books.tb.led).length]", led)
    ok(o[0] == -1000 and o[1] == 1000 and o[2] == "20250401", "opening balances as on 31 March: debit kept as Tally keeps it (%s, %s), from %s" % (o[0], o[1], o[2]))
    ok("trial balance file" in o[3] and o[4] == 2, "the group line (Capital Account) is left out; the source is shown (%d ledgers)" % o[4])
    cl = pg.evaluate("(l) => { const mv = MIS.moves('20250401', S.books.tb.to); return [S.books.tb.led[l[0]].close, -1000 + ((mv[l[0]] || {}).t || 0)]; }", led)
    ok(abs(cl[0] - cl[1]) < 0.01, "closing = opening + the entries brought in (%s)" % cl[0])
    # only groups (a condensed trial balance): told how to export it
    fg = os.path.join(OUT, "tb-groups.xml"); open(fg, "w").write("<ENVELOPE><DSPACCNAME><DSPDISPNAME>Current Assets</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>-5.00</DSPCLDRAMTA></DSPCLDRAMT></DSPACCINFO></ENVELOPE>")
    pg.set_input_files("#tbIn", fg); pg.wait_for_timeout(1200)
    ok("Alt+F5" in pg.inner_text("#app") or pg.evaluate("Object.keys(S.books.tb.led).length") == 2, "a trial balance of groups only is refused, with how to export it with ledgers")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    pg.screenshot(path=OUT + "/parts.png", full_page=True)
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
