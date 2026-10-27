"""python3 run_tds_retchallans.py - next-tds-retchallans (20-Oct-2026; the owner: "currently every challan is showing in every
return which I don't think is right; the user will be distracted. Use the challans that pertain by the rules (April
deduction -> May challan) ... in a specific challan give the user options to add a challan in multiple ways").
On the made-up books of run_tds_challans.py (Q1 2026-27) with challans of every kind:
  1. 26Q Q1 lists its own challans (used, suggested by the matcher, or of its kind deposited from 1 April to 7 July), never
     the 192 challan (24Q's), the 195 one (27Q's), a 194H challan of September (another quarter, nothing pairs with it) or
     a challan of the year before; the step's count is the grid's rows; Select challan offers the same list;
  2. 24Q Q1 lists only the 192 challan;
  3. Add challan offers several ways: Pick from other challans of this year, From a Tally TDS payment, Type a new challan,
     Upload; Pick lists the year's other challans with tax left (not the year before's), filtered in its headers, and a
     ticked one is brought in: on the grid, counted, and kept with the books (saved, loaded again: still there);
  4. Remove from this return takes it out again (only while no deduction of the return is on it).
Screenshots: tests/out/tds-retchallans."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8264
SHOTS = os.path.join(HERE, "out", "tds-retchallans"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
CHALLANS = """() => { const C = (id, serial, date, tax, section) => ({id, bsr: "0510308", serial, date, tax, interest: 0, section, minorHead: "200"});
  S.books.challans = [C("chA", "00123", "20260505", 8640, "194C"), C("chJ", "00456", "20260507", 12345, "194J"), C("chS", "00501", "20260507", 26520, "192"),
    C("chN", "00701", "20260515", 1000, "195"), C("chH2", "00801", "20260910", 3000, "194H"), C("chP", "00901", "20260310", 500, "194C"),
    C("chL", "00902", "20260709", 400, "194C")];
  S.books.alloc = {}; S.books.allocFrom = {}; S.books.chPortions = {}; S.books.matchNo = {}; S.books.tdsSplits = {}; S.books.allocLog = []; TDSReg.forget(); render(); }"""
GO = "([form, tab]) => { S.books = window.__bk || S.books; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = form; S.tdsTab = tab; S.tdsChView = ''; S.tdsCF = {}; render(); }"
ROWS = "() => [...document.querySelectorAll('#app [data-chg-row]')].map(tr => tr.dataset.chgRow)"
COUNT = "() => { const t = document.querySelector('#app [data-tab-count=\"challans\"]'); return t ? +t.textContent : null; }"
# why each listed challan is there: used by the return, suggested for it, or of its kind in its window
WHY = """(form) => { const cx = TDSReg.ctx(), k = TDSReg.key(form, '2026-27', 'Q1'), sg = new Set(); TDSMatch.suggest(form, '2026-27', 'Q1').forEach(s => { sg.add(s.chId); (s.parts || []).forEach(p => sg.add(p.chId)); });
  return Object.fromEntries(TDS.challans().map(c => [c.id, {used: !!(cx.uses[c.id] || {})[k], sugg: sg.has(c.id), home: TDSReg.homeForm(c)}])); }"""

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    J = lambda e, a=None: pg.evaluate(e, a)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    J(BOOKS_JS); pg.wait_for_timeout(600); J("() => { TDSMatch.online = () => false; }"); J(CHALLANS); pg.wait_for_timeout(300)
    # April's 194C on chA (used)
    J("() => { const ids = TDS.rows().filter(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date).slice(0, 6) === '202604').map(r => r.id); TDSCH.tag(ids, 'chA'); TDSReg.forget(); render(); }")

    print("1. 26Q Q1: its own challans only")
    J(GO, ["26Q", "challans"]); pg.wait_for_timeout(600)
    rows, why = J(ROWS), J(WHY, "26Q")
    pg.screenshot(path=os.path.join(SHOTS, "26q-challans.png"), full_page=True)
    ok("chA" in rows and "chJ" in rows, "the used challan and the 194J one of May listed (%s)" % rows)
    ok("chS" not in rows, "the 192 challan (24Q's) not listed in 26Q")
    ok("chN" not in rows, "the 195 challan (27Q's) not listed in 26Q")
    ok("chH2" not in rows and not why["chH2"]["sugg"], "a 194H challan of September (another quarter, nothing pairs with it) not listed")
    ok("chP" not in rows, "a challan of the year before not listed")
    ok("chL" not in rows or why["chL"]["sugg"], "a 194C challan of 9 July (after the due date) listed only when the matcher pairs it (%s)" % why["chL"])
    ok(all(why[c]["used"] or why[c]["sugg"] or why[c]["home"] in ("26Q", "") for c in rows), "each listed one is used, suggested, or of 26Q's kind (%s)" % {c: why[c] for c in rows})
    ok(J(COUNT) == len(rows), "the step's count is the grid's rows (%s, %d)" % (J(COUNT), len(rows)))
    J(GO, ["26Q", "deductions"]); pg.wait_for_timeout(500)
    opts = J("() => [...document.querySelectorAll('#app select[data-wd-sel] option')].map(o => o.value).filter(v => v && v !== '__none')")
    ok(sorted(opts) == sorted(rows), "Select challan offers the same challans (%s)" % opts)

    print("2. 24Q Q1: only the 192 challan")
    J(GO, ["24Q", "challans"]); pg.wait_for_timeout(600)
    r24 = J(ROWS)
    pg.screenshot(path=os.path.join(SHOTS, "24q-challans.png"), full_page=True)
    ok(r24 == ["chS"], "24Q lists only the 192 challan (%s)" % r24)
    ok(J(COUNT) == len(r24), "24Q: the step's count is the grid's rows (%s)" % J(COUNT))

    print("3. Add challan: several ways; Pick from other challans brings one in")
    J(GO, ["26Q", "challans"]); pg.wait_for_timeout(500)
    pg.click('#app [data-ret-add-challan]'); pg.wait_for_timeout(200)
    ways = J("() => [...document.querySelectorAll('[data-cm-add]')].filter(e => e.offsetParent).map(e => e.dataset.cmAdd)")
    ok(all(w in ways for w in ("pick", "tally", "hand", "upload")), "Add challan: Pick from other challans, From a Tally payment, Type a new challan, Upload (%s)" % ways)
    pg.click('[data-cm-add="pick"]'); pg.wait_for_timeout(500)
    pick = J("() => [...document.querySelectorAll('[data-ch-pick-row]')].map(tr => tr.dataset.chPickRow)")
    pg.screenshot(path=os.path.join(SHOTS, "pick.png"))
    ok("chH2" in pick and "chP" not in pick and not [c for c in pick if c in rows], "Pick lists the year's other challans with tax left, not the year before's nor those on the return (%s)" % pick)
    ok(J("document.querySelectorAll('[data-ch-pick] thead [data-cf]').length") >= 3, "Pick's filters are in its column headers")
    pg.click('[data-ch-pick-tick="chH2"]'); pg.wait_for_timeout(150)
    pg.click('[data-ch-pick-go]'); pg.wait_for_timeout(600)
    rows2 = J(ROWS)
    ok("chH2" in rows2 and J(COUNT) == len(rows2) == len(rows) + 1, "brought in: on the grid and counted (%s, %s)" % (rows2, J(COUNT)))
    pg.screenshot(path=os.path.join(SHOTS, "26q-picked.png"), full_page=True)
    # kept with the books: saved, loaded again from the browser's store, still on the return
    J("async () => { await saveBooks(); const d = await Books.load(S.books.cid); const b = Object.assign({cid: S.books.cid, loading: false}, d); b.map = Books.mapLedgers(b.vouchers, {}); S.books = b; window.__bk = b; TDSReg.forget(); render(); }")
    pg.wait_for_timeout(500); J(GO, ["26Q", "challans"]); pg.wait_for_timeout(600)
    ok("chH2" in J(ROWS), "after the books are loaded again: still on the return (%s)" % J(ROWS))
    J(GO, ["27Q", "challans"]); pg.wait_for_timeout(500)
    ok("chH2" not in J(ROWS), "brought into 26Q only: not on 27Q (%s)" % J(ROWS))

    print("4. Remove from this return")
    J(GO, ["26Q", "challans"]); pg.wait_for_timeout(500)
    ok(J("() => document.querySelectorAll('#app [data-chg-unpin]').length") == 1 and J("() => !!document.querySelector('#app [data-chg-unpin=\"chH2\"]')"), "Remove from this return: on the challan brought in only")
    pg.click('#app [data-chg-unpin="chH2"]'); pg.wait_for_timeout(500)
    ok("chH2" not in J(ROWS) and J(COUNT) == len(rows), "removed: off the grid, the count back (%s)" % J(ROWS))
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    ok(J("document.documentElement.scrollWidth <= window.innerWidth + 1"), "a phone: no horizontal page scroll")
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
