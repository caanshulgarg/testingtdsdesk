"""python3 run_tds_accurate.py - round 89 (19-Oct-2026, "only one challan showing"): one truth on every TDS table.
The owner's 26Q Q1: the header said "Challans 7", the Challans grid showed one challan, Deductions said "every deduction is
on a challan" with only Rs 31,105 used: 39 deductions pointed at challans this browser did not have. Now, on the made-up
books of run_tds_challans.py (Q1 2026-27) with two 194C deductions pointing at a challan that is not here:
  1. the header's Challans count = the grid's rows = the strip's "N challans";
  2. the grid: "Used here" (this return's TDS on the challan) and "Used in all returns", Balance overall; the sum of Used
     here (and its footer total, and the strip's On challans) = the TDS of the deductions placed on challans here;
  3. a deduction whose challan is missing is NOT on a challan: counted in "Not on any challan (N)", listed there with
     "Its challan 00777 is missing — choose again", offered by "+ Add deduction", and one click puts it on a challan;
  4. the step keys (F8 / F10 / F11 / F12) are not taken while typing in a box outside the grid, or in a dialog.
  5. (the owner) "+ Add deduction" with every deduction on some challan: "Not on any challan (0)" saying "All deductions
     are on a challan. To move one here, pick it below.", then "On other challans (M)" (name, section, date, TDS, "on
     <serial · date>") with Move here: off beyond this challan's balance, a confirm only when the other challan is fully
     used (it would be left with tax on no deduction), the move done by TDSMatch.move.
TDS_ACC_SHOTS=dir: screenshots (default tests/out/tds-accurate)."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8259
SHOTS = os.environ.get("TDS_ACC_SHOTS") or os.path.join(HERE, "out", "tds-accurate"); os.makedirs(SHOTS, exist_ok=True)
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
GO = "(tab) => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = tab; S.tdsDedView = ''; S.tdsChView = ''; S.tdsChSel = ''; S.tdsWinCh = ''; S.tdsWinAdd = ''; S.tdsFl = {}; S.tdsSel = {}; render(); }"
# April's 194C (8,640) on 00123, April's 194J (12,345) on 00456, one 192 deduction (24Q) on 00456 too, and June's two 194C
# deductions on "chGONE": a challan this browser does not have (the trail knows its serial, 00777)
ALLOC = """() => { const rows = TDS.allRows(), of = (sec, ym) => rows.filter(r => TDS.sec(r.section) === sec && TDS.ymd(r.date).slice(0, 6) === ym).map(r => r.id);
  const a = {}; of('194C', '202604').forEach(id => a[id] = 'chA'); of('194J', '202604').forEach(id => a[id] = 'chJ'); a[of('192', '202604')[0]] = 'chJ';
  window.__gone = of('194C', '202606'); window.__gone.forEach(id => a[id] = 'chGONE');
  S.books.alloc = a; S.books.allocLog = [{id: 'al1', at: '2026-10-18T03:00:00Z', act: 'tag', ch: 'chGONE', chKey: '0510308|20260615|00777', form: '26Q', fy: '2026-27', q: 'Q1', row: window.__gone[0], tax: 700}];
  TDSReg.forget(); render(); }"""
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    J = lambda e, a=None: pg.evaluate(e, a)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    J(BOOKS_JS); pg.wait_for_timeout(800)
    J("() => { TDSMatch.online = () => false; }")
    J(CHALLANS); J(ALLOC); J(GO, "challans"); pg.wait_for_timeout(1000)
    gone = J("window.__gone")
    print("1. one count")
    grid = J("[...document.querySelectorAll('#app [data-chg] tbody tr[data-chg-row]')].map(t => t.dataset.chgRow)")
    rail = J("() => (document.querySelector('#app [data-rail-count=\"challans\"]') || {}).textContent")
    strip = J("() => (document.querySelector('#app [data-fig=\"On challans\"]') || {}).textContent || ''")
    ok(grid and rail == str(len(grid)), "the header's Challans count = the grid's rows (%s = %d: %s)" % (rail, len(grid), grid))
    ok(("%d challan" % len(grid)) in strip, "the strip says the same number (%s)" % strip.strip())
    ok("chGONE" not in grid and "chA" in grid and "chJ" in grid, "the grid: the challans here this return uses, never the missing one")
    print("2. Used here and Used in all returns")
    heads = J("[...document.querySelectorAll('#app [data-chg] thead th')].map(h => h.innerText.trim())")
    ok(heads[-3:] == ["Used here", "Used in all returns", "Balance"], "the columns end Used here · Used in all returns · Balance (%s)" % heads[-3:])
    here = J("[...document.querySelectorAll('#app [data-chg] tbody [data-chg-here]')].map(t => +t.dataset.chgHere)")
    placed = J("() => { const ids = new Set(TDS.challans().map(c => c.id)); return Math.round(TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && ids.has(r.challan)).reduce((a, r) => a + r.tds, 0) * 100) / 100; }")
    ok(abs(sum(here) - placed) < 0.01 and abs(placed - 20985) < 0.01, "the sum of Used here = the TDS of this return's deductions on challans here (%s = %s)" % (sum(here), placed))
    ft = J("() => +(document.querySelector('#app [data-chg] tfoot [data-chg-here-sum]') || {dataset: {}}).dataset.chgHereSum")
    ok(ft is not None and abs(ft - placed) < 0.01, "the footer's Used here total = the same (%s)" % ft)
    ok("20,985.00" in strip, "the strip's On challans = the same (%s)" % strip.strip())
    j = J("""() => { const t = document.querySelector('#app [data-chg] tr[data-chg-row="chJ"]'); return [...t.cells].slice(-3).map(c => c.innerText.trim()); }""")
    alln = J("() => { const cx = TDSReg.ctx(), c = TDS.challans().find(x => x.id === 'chJ'); return [TDSReg.usedTax(c, cx), TDSReg.balance(c, cx).tax]; }")
    ok(j[0] == "₹12,345.00" and j[1] == "₹" + format(alln[0], ",.2f") and alln[0] > 12345 and j[2] == "₹" + format(alln[1], ",.2f"),
       "00456, also used by 24Q: Used here ₹12,345.00, Used in all returns %s, Balance overall %s (%s)" % (alln[0], alln[1], j))
    pg.screenshot(path=os.path.join(SHOTS, "challans-grid-1440.png"), full_page=True)
    print("3. a deduction whose challan is missing")
    J(GO, "deductions"); pg.wait_for_timeout(800)
    un = J("() => { const ids = new Set(TDS.challans().map(c => c.id)); return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.tds > 0.005 && !(r.challan && ids.has(r.challan))).length; }")
    last = J("() => { const o = [...document.querySelectorAll('#app select[data-wd-sel] option')]; return o.length ? [o[o.length - 1].value, o[o.length - 1].textContent] : null; }")
    ok(last == ["__none", "Not on any challan (%d)" % un] and un >= len(gone) + 1, "the selector: Not on any challan (%d), the missing challan's two included (%s)" % (un, last))
    ok(J("() => !!document.querySelector('#app [data-wd-unplaced]')") or J("S.tdsWinCh") == "__none", "the challan's view says some are not on a challan")
    # + Add deduction offers them
    J("() => { S.tdsWinCh = 'chM'; S.tdsWinAdd = 'chM'; render(); }"); pg.wait_for_timeout(600)
    cands = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-cand]')].map(t => t.dataset.wdCand)")
    ok(set(gone) <= set(cands) and "Every deduction of this return is on a challan" not in (J("() => (document.querySelector('[data-wd-addlist]') || {}).innerText || ''")),
       "+ Add deduction lists them, never “every deduction is on a challan” (%d offered)" % len(cands))
    J("() => { S.tdsWinAdd = ''; S.tdsWinCh = '__none'; render(); }"); pg.wait_for_timeout(700)
    miss = J("[...document.querySelectorAll('#app [data-dt-miss]')].map(e => [e.closest('[data-dt-row]').dataset.dtRow, e.innerText.trim()])")
    ok(sorted(x[0] for x in miss) == sorted(gone) and all(x[1] == "Its challan 00777 is missing — choose again" for x in miss),
       "Not on any challan: each says “Its challan 00777 is missing — choose again” (%s)" % miss)
    ok(J("(ids) => ids.every(id => document.querySelector('#app [data-dt-row=\"' + id + '\"]').dataset.dtIn === 'choose')", gone), "they are in Choose a challan, not Done")
    pg.screenshot(path=os.path.join(SHOTS, "not-on-any-challan-1440.png"), full_page=True)
    pk = J("(id) => { const b = document.querySelector('#app [data-dt-row=\"' + id + '\"] [data-dt-pick]'); return b ? b.dataset.dtPick : ''; }", gone[0])
    if pk:
        pg.click('#app [data-dt-row="%s"] [data-dt-pick="%s"]' % (gone[0], pk)); pg.wait_for_timeout(500)
    ok(pk and J("(id) => S.books.alloc[id]", gone[0]) == pk and J("(id) => !document.querySelector('#app [data-dt-row=\"' + id + '\"] [data-dt-miss]')", gone[0]),
       "one click puts it on a challan here (%s); it no longer says missing" % pk)
    print("5. + Add deduction when every deduction is on some challan: On other challans, Move here")
    J("""() => { const ids = new Set(TDS.challans().map(c => c.id)); TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.tds > 0.005 && !(r.challan && ids.has(r.challan))).forEach(r => S.books.alloc[r.id] = 'chS1'); TDSReg.forget(); }""")
    J(GO, "deductions"); pg.wait_for_timeout(500)
    J("() => { S.tdsWinCh = 'chM'; S.tdsWinAdd = 'chM'; render(); }"); pg.wait_for_timeout(600)
    heads = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-addh]')].map(h => h.innerText.trim())")
    want_o = J("() => { const ids = new Set(TDS.challans().map(c => c.id)); return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.form !== '24Q' && r.tds > 0.005 && r.challan && r.challan !== 'chM' && ids.has(r.challan)).map(r => r.id); }")
    others = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-other]')].map(t => t.dataset.wdOther)")
    allon = J("() => (document.querySelector('[data-wd-addlist] [data-wd-allon]') || {}).innerText || ''")
    ok(heads == ["Not on any challan (0)", "On other challans (%d)" % len(others)] and len(others) > 0, "two sections: Not on any challan (0), On other challans (%d) (%s)" % (len(others), heads))
    ok(allon == "All deductions are on a challan. To move one here, pick it below." and "Every deduction of this return is on a challan" not in J("() => document.querySelector('[data-wd-addlist]').innerText"), "with none left: “All deductions are on a challan. To move one here, pick it below.”")
    ok(set(others) >= set(x for x in want_o if J("(id) => TDSReg.formOfRow(id) === '26Q'", x)), "On other challans: this return's deductions on other challans (%d)" % len(others))
    row = J("() => { const t = document.querySelector('[data-wd-addlist] [data-wd-on=\"chA\"]'); return t ? [t.closest('tr').dataset.wdOther, t.innerText.trim()] : null; }")
    ok(row and row[1] == "on 00123 · 05-May-2026", "each with the challan it is on (%s)" % row)
    big = J("() => { const b = [...document.querySelectorAll('[data-wd-addlist] [data-wd-move]')].find(x => x.disabled); return b ? b.dataset.wdMove : ''; }")
    ok(J("() => { const cx = TDSReg.ctx(), left = TDSReg.balance(TDS.challans().find(c => c.id === 'chM'), cx).tax; return [...document.querySelectorAll('[data-wd-addlist] [data-wd-move]')].every(b => b.disabled === (TDS.rows().find(r => r.id === b.dataset.wdMove).tds > left + 0.005)); }"),
       "Move here is off for a deduction larger than this challan's balance")
    # 00123 is fully used: moving one off asks first; No keeps it, Move here moves it and the balances follow
    pg.click('[data-wd-addlist] [data-wd-move="%s"]' % row[0]); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox [role=dialog]").count() == 1 and "fully used" in pg.locator("#confirmBox").inner_text(), "00123 fully used: a confirm before moving off it")
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(300)
    ok(J("(id) => S.books.alloc[id]", row[0]) == "chA", "No: it stays on 00123")
    pg.click('[data-wd-addlist] [data-wd-move="%s"]' % row[0]); pg.wait_for_timeout(400); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
    ok(J("(id) => S.books.alloc[id]", row[0]) == "chM" and J("(id) => !document.querySelector('[data-wd-addlist] [data-wd-other=\"' + id + '\"]')", row[0]), "Move here: on this challan now, gone from the list")
    nxt = J("() => { const cx = TDSReg.ctx(), left = TDSReg.balance(TDS.challans().find(c => c.id === 'chM'), cx).tax; const b = [...document.querySelectorAll('[data-wd-addlist] [data-wd-on]')].find(t => t.dataset.wdOn !== 'chA' && !t.closest('tr').querySelector('[data-wd-move]').disabled && Math.abs(TDSReg.balance(TDS.challans().find(c => c.id === t.dataset.wdOn), cx).tax) > 0.005); return b ? b.closest('tr').dataset.wdOther : ''; }")
    if nxt:
        pg.click('[data-wd-addlist] [data-wd-move="%s"]' % nxt); pg.wait_for_timeout(500)
        ok(J("(id) => S.books.alloc[id]", nxt) == "chM" and pg.locator("#confirmBox [role=dialog]").count() == 0, "from a challan not fully used: moved at once, no confirm")
    J("() => { S.tdsWinAdd = ''; render(); }"); pg.wait_for_timeout(300)
    print("4. the step keys while typing")
    J(GO, "deductees"); pg.wait_for_timeout(600)
    dc = J("() => { const e = document.querySelector('#app [data-dee-count]'); return e ? [e.className, getComputedStyle(e).position] : null; }")
    ok(dc and "rt-foot" not in dc[0] and dc[1] == "static", "the deductees' count line is not a second footer bar (%s)" % dc)
    box = J("() => { const i = [...document.querySelectorAll('#app input[type=search], #app input[type=text]')].find(e => !e.closest('table') && e.offsetWidth); if (!i) return ''; i.setAttribute('data-zz-box', ''); return 'ok'; }")
    if box:
        pg.focus("#app [data-zz-box]"); pg.keyboard.press("F12"); pg.wait_for_timeout(400)
    ok(box and J("S.tdsTab") == "deductees", "F12 in a box to type in (the deductees' search) does not switch the step (%s)" % J("S.tdsTab"))
    J("""() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.id = 'zzDlg'; d.innerHTML = '<button id="zzDlgBtn">OK</button>'; document.body.appendChild(d); }""")
    pg.focus("#zzDlgBtn"); pg.keyboard.press("F10"); pg.wait_for_timeout(400)
    ok(J("S.tdsTab") == "deductees", "F10 inside a dialog does not switch the step (%s)" % J("S.tdsTab"))
    J("() => document.getElementById('zzDlg').remove()")
    pg.focus("#app [data-ret-foot] [data-foot-tab=\"deductees\"]"); pg.keyboard.press("F10"); pg.wait_for_timeout(400)
    ok(J("S.tdsTab") == "challans", "with the focus elsewhere F10 still opens Challans")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
