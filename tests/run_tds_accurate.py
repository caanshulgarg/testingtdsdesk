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
  6. (next-tds-addlist, the owner: "blank name in particulars") a Tally journal with no party ("Rent Dr · Rent Payable
     Alok Swarup Gupta Cr · TDS on Rent 94I Cr"): its name is the party ledger credited, with its PAN; with no party
     ledger at all (Misc. Expenses Dr · TDS 94J Cr): "Name missing — add" in red with Fix, never a blank; Fix keeps the name;
  7. a deduction on a challan dated before it (June's 194C on 00301 of 06-Jun): the chip "Challan dated before the
     deduction" on the challan's table, the count above it, Fix the row in the to-do list, an error in Validate & file;
     a 194C on a 194J challan: "Challan is for 194J" and a warning; never suggested, never ticked, never offered in Choose
     or in the Move dialog;
  8. filters in + Add deduction (name or PAN, section, month, on challan, problems only; the counts "n of N") and on the
     challan's table ("Showing n of N");
  9. ticks: Select all shown, the bar "N selected · TDS ₹X · Balance after", Move to this challan moves them all (both
     challans' balances follow) with one Undo; refused beyond the balance (the reason said); Remove from challan in bulk;
     the list sorted by best fit (the section and the month before the challan first, one dated after it last).
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
    # next-tds-addlist: only a challan dated on or after the deduction is offered (10-Jun's ₹700 fits none: 11-Jun's ₹300 does)
    g1 = gone[1]
    pk = J("(id) => { const b = document.querySelector('#app [data-dt-row=\"' + id + '\"] [data-dt-pick]'); return b ? b.dataset.dtPick : ''; }", g1)
    ok(J("(id) => { const r = TDS.rows().find(x => x.id === id); return [...document.querySelectorAll('#app [data-dt-row=\"' + id + '\"] [data-dt-pick]')].every(b => TDS.ymd(TDS.challans().find(c => c.id === b.dataset.dtPick).date) >= TDS.ymd(r.date)); }", gone[0]),
       "Choose: only challans dated on or after the deduction are offered")
    if pk:
        pg.click('#app [data-dt-row="%s"] [data-dt-pick="%s"]' % (g1, pk)); pg.wait_for_timeout(500)
    ok(pk and J("(id) => S.books.alloc[id]", g1) == pk and J("(id) => !document.querySelector('#app [data-dt-row=\"' + id + '\"] [data-dt-miss]')", g1),
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
    ok(J("() => [...document.querySelectorAll('[data-wd-addlist] tr[data-wd-other]')].every(t => { const r = TDS.rows().find(x => x.id === t.dataset.wdOther); return (TDS.ymd(r.date) > '20260606') === !t.querySelector('[data-wd-move]'); })"),
       "… and none for one deducted after this challan's date (06-Jun): “after this challan's date” instead")
    # 00123 is fully used: moving one off asks first; No keeps it, Move here moves it and the balances follow
    pg.click('[data-wd-addlist] [data-wd-move="%s"]' % row[0]); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox [role=dialog]").count() == 1 and "fully used" in pg.locator("#confirmBox").inner_text(), "00123 fully used: a confirm before moving off it")
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(300)
    ok(J("(id) => S.books.alloc[id]", row[0]) == "chA", "No: it stays on 00123")
    pg.click('[data-wd-addlist] [data-wd-move="%s"]' % row[0]); pg.wait_for_timeout(400); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
    ok(J("(id) => S.books.alloc[id]", row[0]) == "chM" and J("(id) => !document.querySelector('[data-wd-addlist] [data-wd-other=\"' + id + '\"]')", row[0]), "Move here: on this challan now, gone from the list")
    nxt = J("() => { const cx = TDSReg.ctx(), left = TDSReg.balance(TDS.challans().find(c => c.id === 'chM'), cx).tax; const b = [...document.querySelectorAll('[data-wd-addlist] [data-wd-on]')].find(t => t.dataset.wdOn !== 'chA' && (t.closest('tr').querySelector('[data-wd-move]') || {disabled: true}).disabled === false && Math.abs(TDSReg.balance(TDS.challans().find(c => c.id === t.dataset.wdOn), cx).tax) > 0.005); return b ? b.closest('tr').dataset.wdOther : ''; }")
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
    print("6. names: never blank")
    J(BOOKS_JS); pg.wait_for_timeout(600); J("() => { TDSMatch.online = () => false; }"); J(CHALLANS)
    J("""() => { const V = S.books.vouchers;
      V.push({id: "vRent1", date: "20260401", type: "Journal", no: "ASG/26-27/001", party: "", ent: [{l: "Rent", a: -79840}, {l: "Rent Payable Alok Swarup Gupta", a: 71856}, {l: "TDS on Rent 94I", a: 7984}]});
      V.push({id: "vRent2", date: "20260501", type: "Journal", no: "ASG/26-27/002", party: "", ent: [{l: "Rent", a: -79840}, {l: "Rent Payable Alok Swarup Gupta", a: 71856}, {l: "TDS on Rent 94I", a: 7984}]});
      V.push({id: "vMisc", date: "20260430", type: "Journal", no: "", party: "", ent: [{l: "Miscellaneous Expenses", a: -3000.1}, {l: "TDS 94J 10%", a: 3000.1}]});
      S.books.map = Books.mapLedgers(V, {}); Object.assign(S.books.map, {"TDS on Rent 94I": {kind: "tds_payable", section: "194I"}, "TDS 94J 10%": {kind: "tds_payable", section: "194J", rate: 10}}); S.books.pans = Object.assign({}, S.books.pans || {}, {"Rent Payable Alok Swarup Gupta": "AOLPG9817N"});
      S.books.challans.push({id: "chBig", bsr: "0510308", serial: "00909", date: "20260715", tax: 5000, interest: 0, section: "194C", minorHead: "200"});
      let k = 0; const pans = {}; TDS.allRows().forEach(r => { if (r.party && !pans[r.party] && !/Alok/.test(r.party)) pans[r.party] = "AAAC" + "ZYXWVUTSRQPONMLKJ"[k % 17] + String(1000 + (k++)).slice(-4) + "Z"; });
      S.books.pans = Object.assign(pans, S.books.pans); window.__bk = S.books; TDSReg.forget(); }""")
    J(ALLOC)
    rid = J("() => TDS.rows().filter(r => r.id.startsWith('vRent') || r.id.startsWith('vMisc')).map(r => [r.id, r.party, r.pan, TDS.sec(r.section)])")
    rent = [x for x in rid if x[0].startswith("vRent1")]; misc = [x for x in rid if x[0].startswith("vMisc")]
    ok(rent and rent[0][1] == "Rent Payable Alok Swarup Gupta" and rent[0][2] == "AOLPG9817N" and rent[0][3] == "194I", "a journal with no party: the deductee is the party ledger credited, with its PAN (%s)" % rent)
    ok(misc and misc[0][1] == "", "no party ledger at all: no name from the books (%s)" % misc)
    J(GO, "deductions"); J("() => { S.tdsWinCh = 'chM'; S.tdsWinAdd = 'chM'; render(); }"); pg.wait_for_timeout(700)
    names = J("[...document.querySelectorAll('[data-wd-addlist] td[data-wd-name]')].map(t => [t.dataset.wdName, t.innerText.trim()])")
    ok(names and all(x[1] for x in names), "+ Add deduction: no name cell is blank (%d rows)" % len(names))
    mid = misc[0][0]
    nm = J("(id) => { const t = document.querySelector('[data-wd-addlist] td[data-wd-name=\"' + id + '\"]'); const e = t && t.querySelector('[data-wd-noname]'); return e ? [e.innerText.trim(), getComputedStyle(e).color, !!t.querySelector('[data-wd-namefix]')] : null; }", mid)
    ok(nm and nm[0].startswith("Name missing — add") and nm[2], "no name: “Name missing — add” with Fix (%s)" % nm)
    red = J("() => { const e = document.createElement('span'); e.style.color = 'var(--bad)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; }")
    ok(nm and nm[1] == red, "… in red (%s = %s)" % (nm and nm[1], red))
    pg.click('[data-wd-addlist] [data-wd-namefix="%s"]' % mid); pg.wait_for_timeout(300)
    pg.fill('[data-wd-addlist] [data-wd-name-input="%s"]' % mid, "Kumar Legal Associates"); pg.keyboard.press("Enter"); pg.wait_for_timeout(500)
    ok(J("(id) => TDS.rows().find(r => r.id === id).party", mid) == "Kumar Legal Associates" and J("(id) => (S.books.tdsEdits[id] || {f: {}}).f.party", mid) == "Kumar Legal Associates",
       "Fix: the name kept as FinCom's correction, the row named (Tally not changed)")
    pg.screenshot(path=os.path.join(SHOTS, "addlist-names-1440.png"), full_page=True)
    J("() => { S.tdsWinAdd = ''; render(); }")

    print("7. a challan dated before the deduction; another section's challan")
    # June's 194C of 10-Jun on 00301 (chM, 06-Jun): dated before it; May's 194C of 10-May on 00222 (chT, 194J)
    pair = J("""() => { const rows = TDS.rows(), j = rows.find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260610'), m = rows.find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260510');
      S.books.alloc[j.id] = 'chM'; S.books.alloc[m.id] = 'chT'; TDSReg.forget(); render(); return [j.id, m.id]; }""")
    J(GO, "deductions"); J("() => { S.tdsWinCh = 'chM'; render(); }"); pg.wait_for_timeout(700)
    chip = J("(id) => { const e = document.querySelector('#app tr[data-wd-row=\"' + id + '\"] [data-wd-chip=\"early\"]'); return e ? e.innerText.trim() : ''; }", pair[0])
    ok(chip == "Challan dated before the deduction", "the challan's table: the chip “Challan dated before the deduction” (%s)" % chip)
    ok(J("() => +((document.querySelector('#app [data-wd-early-n]') || {dataset: {}}).dataset.wdEarlyN || 0)") == 1, "above the table: 1 deduction on a challan dated before it, with Fix")
    J("() => { S.tdsWinCh = 'chT'; render(); }"); pg.wait_for_timeout(500)
    sc = J("(id) => { const e = document.querySelector('#app tr[data-wd-row=\"' + id + '\"] [data-wd-chip=\"sec\"]'); return e ? e.innerText.trim() : ''; }", pair[1])
    ok(sc == "Challan is for 194J; this is 194C", "a 194C deduction on a 194J challan: “%s”" % sc)
    J("() => { S.tdsWinCh = '__none'; render(); }"); pg.wait_for_timeout(600)
    fx = J("(id) => { const t = document.querySelector('#app [data-dt-row=\"' + id + '\"]'); const p = t && t.querySelector('[data-dt-problem]'); return t ? [t.dataset.dtIn, p ? p.dataset.dtProblem : '', !!t.querySelector('[data-dt-move]')] : null; }", pair[0])
    ok(fx == ["fix", "early", True], "the to-do list: in Fix the row, “Challan dated before the deduction”, Move to another challan (%s)" % fx)
    J(GO, "file"); pg.wait_for_timeout(700)
    ve = J("() => { const e = document.querySelector('#app [data-val-item=\"early\"]'); return e ? [e.dataset.valLevel, e.innerText] : null; }")
    vs = J("() => { const e = document.querySelector('#app [data-val-item=\"chsec\"]'); return e ? e.dataset.valLevel : ''; }")
    ok(ve and ve[0] == "error" and "1 deduction on a challan dated before the deduction" in ve[1], "Validate & file: an error (%s)" % (ve and ve[1][:90]))
    ok(vs == "warn", "… and the other section a warning (%s)" % vs)
    ok(J("() => document.querySelector('#app [data-make-fvu]').disabled"), "Make FVU file is off while it is left")
    sg = J("() => { const ch = Object.fromEntries(TDS.challans().map(c => [c.id, c])), rows = Object.fromEntries(TDS.rows().map(r => [r.id, r])); return TDSMatch.suggest('26Q', '2026-27', 'Q1').filter(s => (s.parts || [{chId: s.chId}]).some(p => s.ids.some(id => rows[id] && ch[p.chId] && TDS.ymd(ch[p.chId].date) < TDS.ymd(rows[id].date)))).length; }")
    ok(sg == 0, "no suggestion pairs a deduction with a challan dated before it (%d)" % sg)
    j11 = J("() => TDS.rows().find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260611').id")
    J(GO, "deductions"); J("() => { S.tdsWinCh = '__none'; render(); }"); pg.wait_for_timeout(500)
    picks = J("(id) => [...document.querySelectorAll('#app [data-dt-row=\"' + id + '\"] [data-dt-pick]')].map(b => TDS.ymd(TDS.challans().find(c => c.id === b.dataset.dtPick).date))", j11)
    ok(all(d >= "20260611" for d in picks), "Choose a challan never offers one dated before the deduction (%s)" % picks)
    J("(id) => tdsMoveOpen([id])", j11); pg.wait_for_timeout(400)
    mv = J("() => [...document.querySelectorAll('[data-cm-pick]')].map(li => [li.dataset.cmPick, li.querySelector('[data-cm-pick-go]').disabled, !!li.querySelector('[data-cm-early]')])")
    ok(mv and all(x[1] for x in mv if x[2]) and any(x[2] for x in mv) and [x[0] for x in mv if x[2]] == [x[0] for x in mv][-len([x for x in mv if x[2]]):],
       "the Move dialog: a challan dated before it is said, its Move here off, listed last (%s)" % mv)
    J("() => { S.tdsMove = null; render(); }")
    J("() => { S.tdsWinCh = 'chM'; S.tdsWinAdd = 'chM'; S.tdsWinF = {}; render(); }"); pg.wait_for_timeout(600)
    e11 = J("(id) => { const t = document.querySelector('[data-wd-addlist] tr[data-wd-cand=\"' + id + '\"]'); return t ? [t.querySelector('[data-wd-tick]').disabled, !!t.querySelector('[data-wd-early]'), !t.querySelector('[data-wd-put]'), !/suggested/.test(t.innerText)] : null; }", j11)
    ok(e11 == [True, True, True, True], "+ Add deduction on 00301 (06-Jun): 11-Jun's 194C cannot be ticked or added, “after this challan's date”, never suggested (%s)" % e11)
    order = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand]')].map(t => t.dataset.wdCand)")
    od = J("(ids) => ids.map(id => { const r = TDS.rows().find(x => x.id === id); return [TDS.sec(r.section), TDS.ymd(r.date)]; })", order)
    ok(od and od[0][0] == "194C" and od[0][1][:6] in ("202605", "202606") and od[0][1] <= "20260606" and od[-1][1] > "20260606",
       "sorted by best fit: first a 194C of May or June up to 06-Jun, last the one deducted after it (%s … %s)" % (od[:1], od[-1:]))

    print("8. filters")
    tot = J("() => [document.querySelectorAll('[data-wd-addlist] [data-wd-cand]').length, document.querySelectorAll('[data-wd-addlist] [data-wd-other]').length]")
    pg.fill('[data-wd-addlist] [data-wd-f="q"]', "Consultant"); pg.wait_for_timeout(400)
    nm = J("[...document.querySelectorAll('[data-wd-addlist] td[data-wd-name]')].map(t => t.innerText)")
    hd = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-addh]')].map(h => h.innerText.trim())")
    ok(nm and all("Consultant" in x for x in nm) and len(nm) < sum(tot), "search: only names with “Consultant” (%d of %d)" % (len(nm), sum(tot)))
    ok(all(" of " in h for h in hd), "the counts say “n of N” while filtered (%s)" % hd)
    pg.fill('[data-wd-addlist] [data-wd-f="q"]', "AOLPG9817N"); pg.wait_for_timeout(400)
    nm = J("[...document.querySelectorAll('[data-wd-addlist] td[data-wd-name]')].map(t => t.innerText)")
    ok(nm and all(x == "Rent Payable Alok Swarup Gupta" for x in nm), "search by PAN (%s)" % nm)
    pg.fill('[data-wd-addlist] [data-wd-f="q"]', ""); pg.select_option('[data-wd-addlist] select[data-wd-f="sec"]', "194J"); pg.wait_for_timeout(400)
    secs = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand], [data-wd-addlist] tr[data-wd-other]')].map(t => t.cells[2].innerText.trim())")
    ok(secs and set(secs) == {"194J"}, "Section 194J: only 194J (%d)" % len(secs))
    pg.select_option('[data-wd-addlist] select[data-wd-f="sec"]', ""); pg.select_option('[data-wd-addlist] select[data-wd-f="mon"]', "202605"); pg.wait_for_timeout(400)
    ds = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand], [data-wd-addlist] tr[data-wd-other]')].map(t => t.cells[3].innerText.trim())")
    ok(ds and all("-May-2026" in d for d in ds), "Month May 2026: only May (%d)" % len(ds))
    pg.select_option('[data-wd-addlist] select[data-wd-f="mon"]', ""); pg.select_option('[data-wd-addlist] select[data-wd-f="on"]', "ch:chA"); pg.wait_for_timeout(400)
    on = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-on]')].map(t => t.dataset.wdOn)")
    ok(on and set(on) == {"chA"} and J("() => document.querySelectorAll('[data-wd-addlist] [data-wd-cand]').length") == 0, "On challan 00123: only those on it, none of Not on any challan (%d)" % len(on))
    pg.select_option('[data-wd-addlist] select[data-wd-f="on"]', "none"); pg.wait_for_timeout(400)
    ok(J("() => document.querySelectorAll('[data-wd-addlist] [data-wd-other]').length") == 0 and J("() => document.querySelectorAll('[data-wd-addlist] [data-wd-cand]').length") == tot[0], "On challan: none: only those not on a challan")
    pg.select_option('[data-wd-addlist] select[data-wd-f="on"]', ""); pg.check('[data-wd-addlist] [data-wd-f="prob"]'); pg.wait_for_timeout(400)
    pr = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand], [data-wd-addlist] tr[data-wd-other]')].map(t => t.dataset.wdCand || t.dataset.wdOther)")
    ok(pr and pair[1] in pr and j11 in pr and mid in pr and len(pr) < sum(tot), "Problems only: the one on another section's challan, the one after this challan's date, the one with no PAN … (%d of %d)" % (len(pr), sum(tot)))
    pg.click('[data-wd-addlist] [data-wd-fclear]'); pg.wait_for_timeout(300)
    ok(J("() => document.querySelectorAll('[data-wd-addlist] [data-wd-cand], [data-wd-addlist] [data-wd-other]').length") == sum(tot), "Clear: every row again")
    J("() => { S.tdsWinAdd = ''; S.tdsWinCh = 'chA'; render(); }"); pg.wait_for_timeout(500)
    n0 = J("() => document.querySelectorAll('#app [data-wd-table] tr[data-wd-row]').length")
    pg.fill('#app [data-wd-filters="table"] [data-wd-f="q"]', "Contractor 1"); pg.wait_for_timeout(400)
    n1 = J("() => [...document.querySelectorAll('#app [data-wd-table] tr[data-wd-row]')].map(t => t.querySelector('[data-wd-name]').innerText)")
    ok(n1 and len(n1) < n0 and all("Contractor 1" in x for x in n1) and J("() => (document.querySelector('#app [data-wd-shown]') || {dataset: {}}).dataset.wdShown") == "%d|%d" % (len(n1), n0),
       "the challan's table: filtered, “Showing %d of %d”, the footer still the challan's" % (len(n1), n0))
    pg.fill('#app [data-wd-filters="table"] [data-wd-f="q"]', ""); pg.wait_for_timeout(300)

    print("9. ticks: move and remove in bulk")
    J("() => { S.tdsWinCh = 'chBig'; S.tdsWinAdd = 'chBig'; S.tdsWinF = {on: 'ch:chA'}; render(); }"); pg.wait_for_timeout(600)
    pg.check('[data-wd-addlist] [data-wd-tickall]'); pg.wait_for_timeout(300)
    bar = J("() => { const b = document.querySelector('[data-wd-addlist] [data-wd-bulk]'); return b ? [+b.dataset.wdBulk, +b.dataset.tot, +b.dataset.after, b.querySelector('[data-wd-bulk-move]').disabled, (b.querySelector('[data-wd-bulk-why]') || {}).innerText || ''] : null; }")
    ok(bar and bar[0] == 8 and abs(bar[1] - 8640) < 0.01 and bar[3] and "more than the ₹5,000.00 left" in bar[4], "Select all shown: 8 selected · TDS ₹8,640 > ₹5,000 left: Move refused, the reason said (%s)" % bar)
    pg.uncheck('[data-wd-addlist] [data-wd-tickall]'); pg.wait_for_timeout(200)
    three = J("() => [...document.querySelectorAll('[data-wd-addlist] tr[data-wd-other]')].slice(0, 3).map(t => t.dataset.wdOther)")
    for t in three: pg.check('[data-wd-addlist] [data-wd-tick="%s"]' % t)
    pg.wait_for_timeout(300)
    bar = J("() => { const b = document.querySelector('[data-wd-addlist] [data-wd-bulk]'); return b ? [+b.dataset.wdBulk, +b.dataset.tot, +b.dataset.after, b.querySelector('[data-wd-bulk-move]').disabled, b.innerText] : null; }")
    want = J("(ids) => ids.reduce((a, id) => a + TDS.rows().find(r => r.id === id).tds, 0)", three)
    ok(bar and bar[0] == 3 and abs(bar[1] - want) < 0.01 and abs(bar[2] - (5000 - want)) < 0.01 and not bar[3] and "3 selected" in bar[4] and "Balance after" in bar[4],
       "3 ticked: “3 selected · TDS %s · Balance after %s”, Move on" % (want, 5000 - want))
    balA0 = J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'chA')).tax")
    pg.click('[data-wd-addlist] [data-wd-bulk-move]'); pg.wait_for_timeout(500)
    if pg.locator("#confirmBox [role=dialog]").count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
    bals = J("() => ['chBig', 'chA'].map(id => TDSReg.balance(TDS.challans().find(c => c.id === id)).tax)")
    ok(all(J("(id) => S.books.alloc[id]", t) == "chBig" for t in three) and abs(bals[0] - (5000 - want)) < 0.01 and abs(bals[1] - (balA0 + want)) < 0.01,
       "Move to this challan: all 3 on 00909; its balance %s, 00123's %s (both follow)" % (bals[0], bals[1]))
    ok(J("() => !document.querySelector('[data-wd-addlist] [data-wd-bulk]')"), "the ticks cleared after the move")
    J("() => { S.tdsWinAdd = ''; S.tdsWinF = {}; render(); }"); pg.wait_for_timeout(500)
    two = J("() => [...document.querySelectorAll('#app [data-wd-table] [data-wd-rtick]')].slice(0, 2).map(e => e.dataset.wdRtick)")
    for t in two: pg.check('#app [data-wd-rtick="%s"]' % t)
    pg.wait_for_timeout(300)
    ok(J("() => +((document.querySelector('#app [data-wd-rbulk]') || {dataset: {}}).dataset.wdRbulk || 0)") == 2, "the challan's table: 2 ticked, the bar says so")
    pg.click('#app [data-wd-bulk-off]'); pg.wait_for_timeout(500)
    ok(all(not J("(id) => S.books.alloc[id] || ''", t) for t in two) and J("() => document.querySelectorAll('#app [data-wd-table] tr[data-wd-row]').length") == 1,
       "Remove from challan: both off, one left on 00909")
    pg.screenshot(path=os.path.join(SHOTS, "bulk-1440.png"), full_page=True)
    pg.set_viewport_size({"width": 390, "height": 844})
    J("() => { S.tdsWinAdd = 'chBig'; render(); }"); pg.wait_for_timeout(600)
    ok(J("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone: + Add deduction with filters and ticks, no sideways scroll")
    pg.screenshot(path=os.path.join(SHOTS, "addlist-390.png"), full_page=True)
    pg.set_viewport_size({"width": 1440, "height": 950}); J("() => { S.tdsWinAdd = ''; render(); }")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
