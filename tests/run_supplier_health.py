"""python3 run_supplier_health.py - supplier health for GST (TDS/GST round 2, item 4; SupHealth,
src/js/71-supplier-health.js; GST › Supplier health).

FinCom's GST API (TaxPro: server/gst-taxpro/index.ts, src/js/39-gst-api.js) has no "search taxpayer" call (checked:
its calls are the OTP sign-in, 2B, the filed GSTR-1 and 3B, the client's own RETTRACK, e-invoice and e-way bill), so a
supplier's registration status cannot be read; the page says so, and works from the client's 2B instead.

The fixture books (ZZ TDSGST, GSTIN 07AAGCL4827M1Z3) with the 2B of Oct-2025 to Mar-2026 made here:
  Saltmarsh Software  bills every month Oct-Mar; in 2B for Oct, Nov, Dec only: Not filing (3 months), ₹5,400 at risk
  Juniper Legal       Nov bill on time; Feb bill filed 25-Mar-2026 (due 13-Mar): Files late, 12 days
  Nightjar Sound      Jan bill in Mar's 2B, filed 20-Mar-2026 for Jan: matched, Files late, 35 days
  Zircon Decor        a GSTIN failing the check digit, its Dec bill not in 2B: GSTIN not valid
Runs on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SUP_PORT") or 8337)
ROOT = os.path.join(HERE, "..")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

from tdsgst_round2_data import ME, SALT, JUN, NIGHT, ZIR, TWOB, SETUP
RUN = "(n) => SupHealth.run('07', '2025-26', n).list.map(x => ({g: x.gstin, party: x.party, st: x.status, flags: x.flags, run: x.run, absent: x.absent, risk: x.atRisk, missing: x.missing, last: x.lastSeen, late: x.late.map(l => [l.supPrd, l.days]), words: SupHealth.words(x).join('; ')}))"

try:
    # the check of the GST API's calls: no search-taxpayer / another GSTIN's return status
    src = open(os.path.join(ROOT, "server", "gst-taxpro", "index.ts")).read() + open(os.path.join(ROOT, "src", "js", "39-gst-api.js")).read()
    ok(not any(w in src.lower() for w in ("search/tp", "searchtp", "action: \"tp\"", "commonapi", "/search?", "taxpayerdetails", "search taxpayer")), "the GST API (TaxPro) code has no search-taxpayer call: supplier health works from 2B")
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        pg.evaluate(SETUP, TWOB); pg.wait_for_timeout(800)
        ok(pg.evaluate("gstParts(S.books).parts.some(x => x[0] === 'health' && x[1] === 'Supplier health')"), "GST has a Supplier health part")
        ok(pg.evaluate("gstinValid('%s')" % ZIR) is False and pg.evaluate("gstinValid('%s')" % SALT) is True, "the made-up Zircon GSTIN fails its check digit; Saltmarsh's passes")
        L = {x["g"]: x for x in pg.evaluate(RUN, 2)}
        s = L.get(SALT, {})
        ok(s.get("st") == "notfiling" and s.get("run") == 3 and s.get("absent") == ["202601", "202602", "202603"] and s.get("risk") == 5400 and s.get("missing") == 3 and s.get("last") == "202512",
           "Saltmarsh: bills Jan-Mar not in 2B, last in Dec's: Not filing (3 months), ₹5,400 credit not in 2B (%s)" % s)
        ok("nothing in 2B for its bills of the last 3 months (Jan-2026, Feb-2026, Mar-2026); last in 2B Dec-2025" in s.get("words", ""), "in words: %s" % s.get("words"))
        j = L.get(JUN, {})
        ok(j.get("st") == "late" and j.get("late") == [["022026", 12]] and j.get("risk") == 0, "Juniper: Feb's return filed 25-Mar-2026, 12 days after the 13th: Files late (%s)" % j)
        nn = L.get(NIGHT, {})
        ok(nn.get("st") == "late" and nn.get("late") == [["012026", 35]] and not nn.get("absent"), "Nightjar: its Jan bill is in Mar's 2B (matched, not missing), filed 35 days late (%s)" % nn)
        z = L.get(ZIR, {})
        ok(z.get("st") == "bad" and "bad" in z.get("flags", []) and z.get("risk") == 3600, "Zircon: GSTIN not valid, its ₹3,600 not in 2B (%s)" % z)
        ok(list(L)[0] == SALT, "the list starts with the supplier not filing")
        L4 = {x["g"]: x for x in pg.evaluate(RUN, 4)}
        ok(L4[SALT]["st"] == "missing", "with 'not filing after 4 months', Saltmarsh's 3 months are 'Bills missing from 2B'")
        # the page
        box = '#app [data-sup-health="07|2025-26"]'
        ok(pg.locator(box).count() == 1, "GST › Supplier health shows the year")
        t = pg.inner_text(box)
        ok("no “search taxpayer” call" in t and "Search Taxpayer" in t, "the page says the registration status cannot be read here, and where to check it")
        ok(pg.locator('#app [data-sup-risk]').count() == 1 and "₹5,400.00" in pg.inner_text('#app [data-sup-risk]'), "credit at risk from suppliers not filing: ₹5,400.00")
        ok(pg.get_attribute('#app [data-sup="%s"]' % SALT, "data-status") == "notfiling" and "Not filing" in pg.inner_text('#app [data-sup="%s"]' % SALT), "Saltmarsh's row: Not filing")
        ok(pg.locator('#app [data-sup="%s"]' % JUN).count() == 1 and "Files late" in pg.inner_text('#app [data-sup="%s"]' % JUN), "Juniper's row: Files late")
        pg.select_option('#app select[aria-label="Months without 2B"]', "4"); pg.wait_for_timeout(300)
        ok(pg.get_attribute('#app [data-sup="%s"]' % SALT, "data-status") == "missing", "the months chosen on the page change the status")
        pg.click('#app [data-sup-chip="late"]'); pg.wait_for_timeout(300)
        st = pg.evaluate("Array.from(document.querySelectorAll('#app [data-sup]')).map(r => r.getAttribute('data-status'))")
        ok(st == ["late", "late"], "'Files late' shows the two late filers (%s)" % st)
        pg.click('#app [data-sup-chip="notfiling"]'); pg.wait_for_timeout(300)
        ok(pg.locator("#app [data-sup]").count() == 0, "none not filing at 4 months")
        # no 2B: says what to do
        pg.evaluate("() => { S.gstYm = '202510'; render(); }"); pg.wait_for_timeout(300)
        pg.evaluate("() => { const keep = S.books.twoBs; S.books.twoBs = {}; S.books.reco = null; render(); window.__k = keep; }"); pg.wait_for_timeout(300)
        ok("Bring in or fetch the client’s 2B" in pg.inner_text("#app [data-sup-health]"), "with no 2B the page says to bring it in first")
        pg.evaluate("() => { S.books.twoBs = window.__k; render(); }")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 392, "phone: no sideways scroll of the page")
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
