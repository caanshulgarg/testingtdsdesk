"""python3 run_tds_dedmatch.py - the Deductions step as the one place to prepare a return (next-tds-clear; the owner,
19-Oct-2026: "nobody opens challans one by one … deductions should be very smart — nobody goes to Tally, everything
within this window, just by clicks"). On the made-up books and challans of run_tds_match_ui.py (Q1 of tax year 2026-27):
  1. one screen: the deductions table with its filters and, beside it, the challans panel (tax, used, balance, live;
     "Not matched (N · ₹X)"); each deduction not on a challan shows its suggested challan with the reason and a tick:
     ticked, it is on that challan at once and the panel's balance drops; unticked, off again; "Accept all N
     suggestions"; a challan clicked in the panel filters the table to it, clicked again shows all; the filters work
  2. by clicks alone: a cell edited in place (Enter saves as a FinCom correction, Tab goes to the next cell, Tally not
     changed); one-click fixes with the exact change (the rate that applies); ticked rows given a section at once;
     the keyboard (↑ ↓, Space, ?); "Done: N of M ready" in the header; Add deduction filled from the party's history
TDS_DEDMATCH_SHOTS=dir: screenshots (default tests/out/tds-dedmatch)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_DEDMATCH_PORT") or 8352)
SHOTS = os.environ.get("TDS_DEDMATCH_SHOTS") or os.path.join(HERE, "out", "tds-dedmatch"); os.makedirs(SHOTS, exist_ok=True)
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
GO = "() => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'deductions'; S.tdsFl = {}; S.tdsDedChF = ''; S.tdsSel = {}; render(); }"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        J(BOOKS_JS); pg.wait_for_timeout(800)
        J("() => { TDSMatch.online = () => false; }")
        J(CHALLANS); J(GO); pg.wait_for_timeout(1200)
        bal = lambda c: float(pg.get_attribute('#app [data-dd-ch="%s"] [data-dd-bal]' % c, "data-dd-bal"))
        print("1. one screen")
        ok(pg.locator("#tdsDnTable").count() == 1 and pg.locator("#app [data-dd-side]").count() == 1, "the deductions table and, beside it, the challans panel")
        side = J("[...document.querySelectorAll('#app [data-dd-side] [data-dd-ch]')].map(b => b.dataset.ddCh)")
        ok("chA" in side and side[-1] == "__none", "the panel: the return's challans, Not matched last (%s)" % side)
        ok(pg.locator("#app [data-dd-side]").evaluate("(e) => getComputedStyle(e).position") == "sticky", "the panel stays in view (sticky)")
        sg = J("[...document.querySelectorAll('#app #tdsDnTable [data-dd-sugg]')].map(e => e.dataset.ddSugg)")
        ok(len(sg) > 0 and J("Object.keys(S.books.alloc).length") == 0, "the matcher has run: %d deductions show a suggested challan with a tick, nothing put on yet" % len(sg))
        rid = J("() => { const s = TDSMatch.suggest('26Q', '2026-27', 'Q1').find(s => s.chId === 'chA'); return s ? s.ids[0] : ''; }")
        tds = J("(id) => TDS.rows().find(r => r.id === id).tds", rid)
        b0 = bal("chA")
        ok("Same section" in (pg.locator('#app [data-dd-sugg-cell="%s"]' % rid).inner_text() or ""), "the suggestion's reason on the row")
        pg.screenshot(path=os.path.join(SHOTS, "deductions-suggestions-1440.png"), full_page=True)
        pg.click('#app [data-dd-sugg="%s"]' % rid); pg.wait_for_timeout(450)
        ok(J("(id) => S.books.alloc[id]", rid) == "chA" and abs(bal("chA") - (b0 - tds)) < 0.01 and pg.locator('#app [data-dd-off="%s"]' % rid).count() == 1, "ticked: on chA at once, the panel's balance %s → %s, the row matched" % (b0, bal("chA")))
        pg.click('#app [data-dd-off="%s"]' % rid); pg.wait_for_timeout(450)
        ok(not J("(id) => S.books.alloc[id]", rid) and abs(bal("chA") - b0) < 0.01, "unticked: off again, the balance back")
        pg.click('#app [data-dd-ch="chA"]'); pg.wait_for_timeout(400)
        shown = J("[...document.querySelectorAll('#tdsDnTable > tbody > tr[data-ded-row]')].map(t => t.dataset.dedRow)")
        want = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && (r.challan === 'chA' || (!r.challan && (TDSMatch.suggest('26Q', '2026-27', 'Q1').find(s => s.ids.includes(r.id)) || {}).chId === 'chA'))).map(r => r.id)")
        ok(sorted(shown) == sorted(want) and shown, "chA clicked in the panel: its deductions and its suggestions only (%d)" % len(shown))
        pg.click('#app [data-dd-ch="chA"]'); pg.wait_for_timeout(400)
        ok(pg.locator("#tdsDnTable > tbody > tr[data-ded-row]").count() > len(shown), "clicked again: all")
        pg.click('#app [data-ded-show="fix"]'); pg.wait_for_timeout(300)
        nf = pg.locator("#tdsDnTable > tbody > tr[data-ded-row]").count()
        pg.click('#app [data-ded-show=""], #app [data-ded-show="all"]'); pg.wait_for_timeout(300)
        pg.fill('#app input[aria-label="Find a deductee, PAN, voucher or ledger"]', "Contractor 1"); pg.wait_for_timeout(400)
        nq = pg.locator("#tdsDnTable > tbody > tr[data-ded-row]").count()
        pg.fill('#app input[aria-label="Find a deductee, PAN, voucher or ledger"]', ""); pg.wait_for_timeout(300)
        ok(nf > 0 and 0 < nq, "the filters still work: Needs fixing %d, find %d" % (nf, nq))
        n = pg.locator("#app [data-dd-accept-all]").inner_text()
        pg.click("#app [data-dd-accept-all]"); pg.wait_for_timeout(700)
        ok(re.match(r"Accept all \d+ suggestions", n) and pg.locator("#app #tdsDnTable [data-dd-sugg]").count() == 0, "Accept all: no suggestion left to tick (%s)" % n)
        none = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan).length")
        ok(str(none) in pg.inner_text('#app [data-dd-ch="__none"]'), "Not matched in the panel: %d" % none)
        print("2. by clicks alone")
        J(GO); pg.wait_for_timeout(500)
        r0 = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1')[0]")
        pg.click('#tdsDnTable tr[data-ded-row="%s"] [data-cell-edit="paid"]' % r0["id"]); pg.wait_for_timeout(300)
        inp = pg.locator('#tdsDnTable [data-cell-input="paid"]')
        ok(inp.count() == 1, "a click on the amount edits it in place")
        inp.fill(str(r0["paid"] + 1000)); inp.press("Tab"); pg.wait_for_timeout(400)
        ok(J("(id) => S.books.tdsEdits[id].f.paid", r0["id"]) == r0["paid"] + 1000 and pg.locator('#tdsDnTable [data-cell-input="rate"]').count() == 1, "Tab saves it (a FinCom correction) and goes to the rate")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        ok(J("(id) => !S.books.vouchers.some(v => JSON.stringify(v).includes(String(%d)))" % (r0["paid"] + 1000), r0["id"]), "Tally's books not changed")
        fx = pg.locator("#app [data-fix-row]").first
        if fx.count():
            rid = fx.evaluate("(e) => e.closest('[data-row-fixes]').dataset.rowFixes"); label = fx.inner_text()
            fx.click(); pg.wait_for_timeout(400)
            ok(re.search(r"(Rate|Apply certificate) [\d.]+%", label) and J("(id) => !!(S.books.tdsEdits[id] && S.books.tdsEdits[id].f.rate != null)", rid), "a one-click fix with its exact change: %s" % label)
        else: ok(False, "a row with a rate question shows its one-click fix")
        ids = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && TDS.sec(r.section) === '194C').slice(0, 2).map(r => r.id)")
        for i in ids: pg.check('#tdsDnTable tr[data-ded-row="%s"] input[type=checkbox][aria-label^="Select"]' % i)
        pg.wait_for_timeout(300)
        pg.select_option("#app [data-bulk-sec]", "194J"); pg.wait_for_timeout(200); pg.click("#app [data-bulk-sec-go]"); pg.wait_for_timeout(500)
        ok(all(J("(id) => TDS.sec(TDS.rows().find(r => r.id === id).section)", i) == "194J" for i in ids), "two ticked rows given section 194J at once")
        J("() => { S.tdsSel = {}; render(); }"); pg.wait_for_timeout(300)
        first = pg.locator("#tdsDnTable > tbody > tr[data-ded-row]").first
        first.focus(); pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(200)
        f2 = J("document.activeElement && document.activeElement.dataset.dedRow")
        pg.keyboard.press(" "); pg.wait_for_timeout(300)
        ok(f2 and J("(id) => !!(S.tdsSel || {})[id]", f2), "keys: ↓ to the next row, Space ticks it")
        pg.keyboard.press("?"); pg.wait_for_timeout(400)
        ok(pg.locator("#app [data-keys-help]").count() == 1, "? shows the keys")
        J("() => { S.tdsKeys = false; S.tdsSel = {}; render(); }"); pg.wait_for_timeout(300)
        prog = pg.get_attribute("#app [data-ret-progress]", "data-ret-progress")
        want = J("() => { const rs = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1'), iss = new Set(Certs.issues('2026-27', 'Q1').map(x => x.row.id)); return rs.filter(r => r.challan && Certs.validPan(r.pan) && !iss.has(r.id)).length + '/' + rs.length; }")
        ok(prog == want, "the header: Done: N of M ready (%s = %s)" % (prog, want))
        party = J("() => TDS.rows().find(r => r.fy === '2026-27' && r.paid > 0).party")
        pg.click("#app [data-add-open]"); pg.wait_for_timeout(400)
        pg.fill('#app [data-add-deduction="new"] input[aria-label="Deductee"]', party); pg.locator('#app [data-add-deduction="new"] input[aria-label="Deductee"]').blur(); pg.wait_for_timeout(400)
        sec = pg.input_value('#app [data-add-deduction="new"] select[aria-label="Section"]'); ph = pg.get_attribute('#app [data-add-deduction="new"] input[aria-label="Amount paid or credited"]', "placeholder") or ""
        ok(sec and ph.startswith("usually "), "Add deduction filled from the party's history: section %s, amount %s" % (sec, ph))
        pg.screenshot(path=os.path.join(SHOTS, "add-deduction-history-1440.png"))
        J("() => { S.tdsAdd = null; render(); }"); pg.wait_for_timeout(300)
        J(GO); pg.wait_for_timeout(400)
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391 and pg.locator("#app [data-dd-side] details").count() == 1, "phone: the panel is a section on top that folds; no sideways scroll")
        pg.screenshot(path=os.path.join(SHOTS, "deductions-suggestions-390.png"), full_page=True)
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
