"""python3 run_parts_ui.py - the day book brought in part by part (each part a file exported from Tally for its dates;
each part fills only its dates, nothing doubled), and opening balances from a trial balance exported from Tally.
2.4.0 (the upload page simpler): every file goes through the one Upload Tally data (#tallyIn); a part's dates are the
file's own, never typed; a trial balance is asked only its date; the bridge's own update settings are under More."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from books_data import DATA, COMPANY, GSTIN   # a real export in tests/data, else the made-up books in tests/fixtures/books
import uploadpage_setup as U
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
    pg.evaluate("""() => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "import"; S.loadingCo = false; render(); }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY))
    pg.wait_for_timeout(1500)
    def part(a, b):
        # each part is the Day Book exported from Tally for its dates (2.4.0: the dates come from the file itself)
        f, _ = U.range_file(a.replace("-", ""), b.replace("-", ""), "DayBook-%s-%s.xml" % (a, b))
        pg.set_input_files("#tallyIn", f); pg.wait_for_timeout(1500); wait_idle(pg)
    part("2025-04-01", "2025-09-30")
    n1 = pg.evaluate("S.books.vouchers.length"); mx1 = pg.evaluate("S.books.vouchers.map(v => v.date).sort().pop()")
    ok(n1 > 0 and mx1 <= "20250930", "the first part: %d entries, none after 30 September (%s)" % (n1, mx1))
    part("2025-10-01", "2026-03-31")
    n2 = pg.evaluate("S.books.vouchers.length")
    ok(n2 > n1, "the second part is added to the first: %d entries in all" % n2)
    part("2025-04-01", "2025-09-30")
    ok(pg.evaluate("S.books.vouchers.length") == n2, "the first part again: it replaces its own dates, nothing doubled (%d)" % pg.evaluate("S.books.vouchers.length"))
    t = pg.inner_text("#app")
    ok(pg.evaluate("S.books.meta.parts.every(p => p.to <= '20250930' || p.from >= '20251001')") and "Read " in pg.inner_text("#app [data-up-result]"), "each part kept with its own dates; the result said in words (%s)" % pg.inner_text("#app [data-up-result]"))
    ok(pg.evaluate("S.books.meta.parts.length") == 2, "two parts kept (the repeat replaced the first)")
    st = pg.inner_text("#app [data-up-status]")
    ok(st.startswith("Books from Tally: FY 2025-26 · entries up to ") and "ledger masters not uploaded" in st and "opening balances not uploaded" in st and "cloud" not in st.lower(), "the status line says what is missing, and nothing of the cloud (%s)" % st)
    # opening balances from a trial balance exported from Tally (ledgers shown), as on 31 March 2025
    led = pg.evaluate("Object.keys(S.books.map).slice(0, 3)")
    tb = ("<ENVELOPE><DSPACCNAME><DSPDISPNAME>Capital Account</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>500.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>"
          "<DSPACCNAME><DSPDISPNAME>%s</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>-1000.00</DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>"
          "<DSPACCNAME><DSPDISPNAME>%s</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>1,000.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO></ENVELOPE>") % (led[0].replace("&", "&amp;"), led[1].replace("&", "&amp;"))
    fp = os.path.join(OUT, "tb.xml"); open(fp, "w").write(tb)
    pg.set_input_files("#tallyIn", fp); pg.wait_for_timeout(1200)
    # Arc UI step 4 (10-Oct-2026): the trial balance's "as on" is FinCom's own date box (DD-Mon-YYYY, DateBox) instead of the
    # browser's input[type=date], so it is found by its label; the date it holds is its data-iso (yyyy-mm-dd), what it shows DD-Mon-YYYY.
    tbon = '#app [data-tb-ask] [data-datebox] input[aria-label="Trial balance as on"]'
    ok(pg.locator(tbon).count() == 1 and pg.get_attribute(tbon, "data-iso") == "2025-03-31" and pg.input_value(tbon) == "31-Mar-2025",
       "the trial balance date offered is the day before the first part, in FinCom's date box: %s" % (pg.locator(tbon).count() and pg.input_value(tbon)))
    pg.click("#app [data-tb-ask] button:has-text('Use as opening balances')"); pg.wait_for_timeout(2500)
    o = pg.evaluate("(l) => [S.books.tb.led[l[0]].open, S.books.tb.led[l[1]].open, S.books.tb.from, S.books.tb.source || '', Object.keys(S.books.tb.led).length]", led)
    ok(o[0] == -1000 and o[1] == 1000 and o[2] == "20250401", "opening balances as on 31 March: debit kept as Tally keeps it (%s, %s), from %s" % (o[0], o[1], o[2]))
    ok("trial balance file" in o[3] and o[4] == 2, "the group line (Capital Account) is left out; the source is shown (%d ledgers)" % o[4])
    cl = pg.evaluate("(l) => { const mv = MIS.moves('20250401', S.books.tb.to); return [S.books.tb.led[l[0]].close, -1000 + ((mv[l[0]] || {}).t || 0)]; }", led)
    ok(abs(cl[0] - cl[1]) < 0.01, "closing = opening + the entries brought in (%s)" % cl[0])
    # only groups (a condensed trial balance): told how to export it
    fg = os.path.join(OUT, "tb-groups.xml"); open(fg, "w").write("<ENVELOPE><DSPACCNAME><DSPDISPNAME>Current Assets</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>-5.00</DSPCLDRAMTA></DSPCLDRAMT></DSPACCINFO></ENVELOPE>")
    pg.set_input_files("#tallyIn", fg); pg.wait_for_timeout(1000); pg.click("#app [data-tb-ask] button:has-text('Use as opening balances')"); pg.wait_for_timeout(1200)
    ok("Alt+F5" in pg.inner_text("#app") or pg.evaluate("Object.keys(S.books.tb.led).length") == 2, "a trial balance of groups only is refused, with how to export it with ledgers")
    # the bridge's update from Tally: once a day at a time chosen, or Update now; nothing asked of Tally in between
    posts = pg.evaluate("""async () => { const got = window.__got = [];
      Object.assign(Bridge, {on: () => true, call: async (path, body) => { got.push([path, body || null]); return {ok: true, on: true, phase: "live", schedule: "daily", dailyAt: "20:00", lastRun: "20260929", running: false, now: !!(body && body.now), mode: "files"}; }});
      S.booksTab = "import"; S.setupKeep = {}; render(); await new Promise(r => setTimeout(r, 800)); render(); return got; }""")
    pg.evaluate("document.querySelector('#app [data-more=\"books\"]').open = true"); pg.wait_for_timeout(300)   # 2.4.0: under More
    t = pg.inner_text("#app")
    ok("once a day at" in t and "Nothing is asked of Tally during the day" in t and pg.input_value('input[aria-label="Daily update at"]') == "20:00", "step 4: updates from Tally once a day at 20:00, nothing asked during the day")
    pg.click('#app [data-bridge-keep] button:text-is("Update now")'); pg.wait_for_timeout(800)
    ok("Updating from Tally now" in pg.inner_text("body"), "Update now asks the bridge, and says the books follow")
    pg.evaluate("document.querySelector('#app [data-more=\"books\"]').open = true"); pg.wait_for_timeout(300)
    pg.fill('input[aria-label="Daily update at"]', "19:30"); pg.wait_for_timeout(800)
    ok(pg.evaluate("window.__got.some(([p, b]) => b && b.dailyAt === '19:30')") and pg.evaluate("window.__got.some(([p, b]) => b && b.now === true)"), "the daily time can be changed, and Update now was asked of the bridge")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    pg.screenshot(path=OUT + "/parts.png", full_page=True)
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
