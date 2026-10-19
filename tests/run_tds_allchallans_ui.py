"""python3 run_tds_allchallans_ui.py - All challans of a tax year in one place (next-tds-allchallans, 19-Oct-2026; the owner:
"if I want to see all the challans .. don't know how to see that.. no option to see all challans"). On the made-up books
and challans of run_tds_match_ui.py (tax year 2026-27), with one more challan in Q3 and a TDS payment in Tally (August)
that has no BSR code yet, in the React build (app/dist-test, or TDSDESK_SITE):
  1. reachable: a button "All challans" on the TDS home and a "See all challans of 2026-27" line under its grid; from a
     return: its header ("All challans of 2026-27") and its Challans step ("See all challans of 2026-27 →"); its own
     address (…/2026-27/all-challans)
  2. the whole year: every challan of 2026-27 (Q1, Q2 and Q3), the columns Date · BSR · Serial / CIN · Section · Form /
     quarter · Tax · Interest · Others · Total · Used on deductions · Left · Status; Used and Left agree with the
     deductions on each challan after the suggestions are confirmed; Status Matched fully / Part used / Not used; the
     foot's totals are the rows'
  3. filters: quarter, form, section, status and find narrow the rows; Clear filters shows all again
  4. the Tally payment with no BSR code is a row ("From Tally: needs BSR") with Add BSR code: given the BSR code and
     serial, it becomes a challan (the row is then a challan of the year)
  5. a challan clicked opens its return's Challans step with that challan chosen (the "On this challan" panel)
  6. phone (390): no sideways page scroll
TDS_ALLCH_SHOTS=dir: screenshots (default tests/out/tds-allchallans)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_ALLCH_PORT") or 8463)
SHOTS = os.environ.get("TDS_ALLCH_SHOTS") or os.path.join(HERE, "out", "tds-allchallans"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
m = open(os.path.join(HERE, "run_tds_match_ui.py")).read()
_k = m.index('CHALLANS = """') + len('CHALLANS = """')
CHALLANS = m[_k:m.index('"""', _k)]
# one more challan, of Q3, and a TDS payment in Tally in August with no BSR code
MORE = """() => { S.books.challans = S.books.challans.concat([{id: "chQ3", bsr: "0510308", serial: "00777", date: "20261107", tax: 5000, interest: 0, section: "194C", minorHead: "200"}]);
  const led = S.books.vouchers.find(v => v.id === "pay194cApr").ent[0].l;
  S.books.vouchers = S.books.vouchers.concat([{id: "payAug", date: "20260807", type: "Payment", no: "P-9", party: led, ent: [{l: led, a: -3000}, {l: "HDFC Bank", a: 3000}]}]);
  TDSReg.forget && TDSReg.forget(); render(); }"""
HOME = "() => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2026-27'; S.tdsQ = ''; S.allchFl = {}; render(); }"
RET = "(tab) => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = tab; S.tdsFl = {}; S.tdsSel = {}; S.tdsChSel = ''; render(); }"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        J(BOOKS_JS); pg.wait_for_timeout(800); J("() => { TDSMatch.online = () => false; }"); J(CHALLANS); J(MORE); pg.wait_for_timeout(300)
        rows = lambda: J("[...document.querySelectorAll('#tdsAllChTable tbody tr[data-allch-row]')].map(t => t.dataset.allchRow)")

        print("1. reachable")
        J(HOME); pg.wait_for_timeout(800)
        ok(pg.locator("#app [data-tds-allch]").count() == 1 and pg.locator("#app [data-tds-allch]").is_visible(), "the TDS home: a visible All challans button beside the year")
        ok("See all challans of 2026-27" in (pg.locator("#app [data-home-allch]").inner_text() if pg.locator("#app [data-home-allch]").count() else ""), "the home's challans line: See all challans of 2026-27")
        pg.click("#app [data-tds-allch]"); pg.wait_for_timeout(700)
        ok(pg.locator("#app [data-all-challans='2026-27']").count() == 1 and "All challans of 2026-27" in pg.inner_text("#app [data-allch-title]"), "the button opens All challans of 2026-27")
        ok(J("location.hash").endswith("/2026-27/all-challans"), "its own address (%s)" % J("location.hash"))
        J(RET, "deductions"); pg.wait_for_timeout(800)
        ok(pg.locator("#app [data-ret-allch]").count() == 1 and "All challans of 2026-27" in pg.inner_text("#app [data-ret-allch]"), "a return's header: All challans of 2026-27")
        J(RET, "challans"); pg.wait_for_timeout(800)
        ok(pg.locator("#app [data-cm-allch]").count() == 1 and "See all challans of 2026-27" in pg.inner_text("#app [data-cm-allch]"), "the Challans step: See all challans of 2026-27")
        pg.click("#app [data-cm-allch]"); pg.wait_for_timeout(700)
        ok(pg.locator("#app [data-all-challans]").count() == 1 and pg.locator("#app [data-allch-back]").inner_text().strip().endswith("Q1"), "opened from the return: the way back is to it (%s)" % pg.locator("#app [data-allch-back]").inner_text())

        print("2. the whole year")
        heads = [h.strip() for h in pg.locator("#tdsAllChTable thead th").all_inner_texts()]
        ok(heads == ["Date", "BSR", "Serial / CIN", "Section", "Form / quarter", "Tax", "Interest", "Others", "Total", "Used on deductions", "Left", "Status"], "the columns (%s)" % heads)
        want = J("() => TDS.challans().filter(c => TDS.fyOf(c.date) === '2026-27').map(c => c.id).sort()")
        got = sorted(x for x in rows() if not x.startswith("pay:"))
        ok(got == want and "chQ3" in got and "chS1" in got, "every challan of 2026-27, Q1, Q2 and Q3 (%d: %s)" % (len(got), got))
        # confirm the suggestions, then compare Used / Left with the deductions on each challan
        J(RET, "challans"); pg.wait_for_timeout(500); J("() => tdsMatchConfirmAll()"); pg.wait_for_timeout(500)
        J("() => { S.tdsView = 'allch'; S.allchFl = {}; render(); }"); pg.wait_for_timeout(600)
        calc = J("""() => { const out = {}; TDS.challans().forEach(c => { const used = TDS.allRows ? TDS.allRows().filter(r => r.challan === c.id).reduce((a, r) => a + r.tds, 0) : 0; out[c.id] = [Math.round(used * 100) / 100, Math.round((c.tax - used) * 100) / 100]; }); return out; }""")
        shown = J("""() => Object.fromEntries([...document.querySelectorAll('#tdsAllChTable tbody tr[data-allch-kind=ch]')].map(t => [t.dataset.allchRow, [+t.querySelector('[data-allch-used]').dataset.allchUsed, +t.querySelector('[data-allch-left]').dataset.allchLeft, t.dataset.allchSt]]))""")
        bad = [k for k, v in shown.items() if abs(v[0] - calc[k][0]) > 0.01 or abs(v[1] - calc[k][1]) > 0.01]
        ok(not bad and any(v[0] > 0 for v in shown.values()), "Used on deductions and Left agree with the deductions on each challan (%s)" % ({k: (shown[k], calc[k]) for k in bad} or "all"))
        st_ok = all((v[2] == "full") == (v[0] > 0 and abs(v[1]) < 0.01) and (v[2] == "none") == (v[0] < 0.01) for v in shown.values())
        ok(st_ok and {"full", "none"} <= {v[2] for v in shown.values()}, "Status: Matched fully / Part used / Not used as the figures say (%s)" % {k: v[2] for k, v in shown.items()})
        tot = J("() => [...document.querySelectorAll('#tdsAllChTable tbody tr[data-allch-row]')].reduce((a, t) => a + +t.querySelector('[data-allch-used]').dataset.allchUsed || a, 0)")
        foot = float(re.sub(r"[^\d.]", "", pg.inner_text("#tdsAllChTable [data-allch-total='used']")))
        ok(abs(foot - tot) < 0.01, "the foot's Used total is the rows' (%s = %s)" % (foot, tot))
        pg.screenshot(path=os.path.join(SHOTS, "all-challans-1440.png"), full_page=True)

        print("3. filters")
        n_all = len(rows())
        pg.select_option("#app [data-allch-filter='qtr']", "Q3"); pg.wait_for_timeout(300)
        ok(rows() == ["chQ3"], "Quarter Q3: only the Q3 challan (%s)" % rows())
        pg.select_option("#app [data-allch-filter='qtr']", ""); pg.select_option("#app [data-allch-filter='sec']", "194J"); pg.wait_for_timeout(300)
        r_j = rows(); ok(r_j and all(J("(id) => TDSCH.secNorm(TDS.challans().find(c => c.id === id).section)", x) == "194J" for x in r_j), "Section 194J: only 194J challans (%s)" % r_j)
        pg.select_option("#app [data-allch-filter='sec']", ""); pg.select_option("#app [data-allch-filter='st']", "none"); pg.wait_for_timeout(300)
        ok(sorted(rows()) == sorted(k for k, v in shown.items() if v[2] == "none") and rows(), "Status Not used: exactly the challans not used (%s)" % rows())
        pg.select_option("#app [data-allch-filter='st']", ""); pg.select_option("#app [data-allch-filter='form']", "26Q"); pg.wait_for_timeout(300)
        ok(0 < len(rows()) <= n_all, "Form 26Q (%d)" % len(rows()))
        pg.select_option("#app [data-allch-filter='form']", ""); pg.fill("#app [data-allch-find]", "00777"); pg.wait_for_timeout(300)
        ok(rows() == ["chQ3"], "Find 00777 (%s)" % rows())
        pg.click("#app [data-allch-clear]"); pg.wait_for_timeout(300)
        ok(len(rows()) == n_all, "Clear filters: all again (%d)" % n_all)

        print("4. a Tally payment without a BSR code")
        pr = pg.locator("#tdsAllChTable tr[data-allch-row='pay:payAug']")
        ok(pr.count() == 1 and "From Tally: needs BSR" in pr.inner_text() and pr.locator("[data-allch-addbsr]").count() == 1, "the August payment in Tally: a row, From Tally: needs BSR, Add BSR code")
        pr.locator("[data-allch-addbsr]").click(); pg.wait_for_timeout(300)
        pr.locator("input[aria-label='BSR code or CIN']").fill("0510308"); pr.locator("input[aria-label='Challan serial']").fill("00888")
        pr.locator("[data-allch-make]").click(); pg.wait_for_timeout(600)
        made = J("() => TDS.challans().find(c => c.fromVoucher === 'payAug')")
        ok(made and made["serial"] == "00888" and pg.locator("#tdsAllChTable tr[data-allch-row='pay:payAug']").count() == 0 and made["id"] in rows(), "given its BSR code and serial: a challan of the year, the row now a challan")

        print("5. a challan opens in its return")
        pg.click("#tdsAllChTable [data-allch-open='chA']"); pg.wait_for_timeout(800)
        ok(J("S.tdsView") == "return" and J("S.tdsTab") == "challans" and pg.locator("#app [data-cm-panel='chA'] [data-cm-left='chA']").count() == 1 and pg.locator("#app [data-cm-right='chA']").count() == 1,
           "chA: its return's Challans step, On this challan / Deductions to add (%s %s)" % (J("S.tdsView"), J("S.tdsTab")))

        print("6. phone")
        J("() => { S.tdsView = 'allch'; render(); }"); pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(600)
        ok(J("document.documentElement.scrollWidth") <= 391, "390: no sideways page scroll (%s)" % J("document.documentElement.scrollWidth"))
        pg.screenshot(path=os.path.join(SHOTS, "all-challans-390.png"), full_page=True)
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
