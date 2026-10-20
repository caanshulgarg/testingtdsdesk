"""python3 run_tds_accurate.py - round 89 (19-Oct-2026, "only one challan showing"): one truth on every TDS table.
The owner's 26Q Q1: the header said "Challans 7", the Challans grid showed one challan, Deductions said "every deduction is
on a challan" with only Rs 31,105 used: 39 deductions pointed at challans this browser did not have. Now, on the made-up
books of run_tds_challans.py (Q1 2026-27) with two 194C deductions pointing at a challan that is not here:
  1. the Challans tab's count = the grid's rows (round 94: said there only, not again in the strip);
  2. the grid: "Used here" (this return's TDS on the challan) and "Used in all returns", Balance overall; the sum of Used
     here (and its footer total, and the strip's On challans) = the TDS of the deductions placed on challans here;
  3. a deduction whose challan is missing is NOT on a challan: counted in "Not on any challan (N)", listed there with
     "Its challan 00777 is missing — choose again", offered by "+ Add deduction", and one click puts it on a challan;
  4. (round 94) no step keys: F8 / F10 / F11 / F12 switch nothing, anywhere; no count line under Deductees.
  5. (the owner) "+ Add deduction" with every deduction on some challan: "Not on any challan (0)" saying "All deductions
     are on a challan. To move one here, pick it below.", then "On other challans (M)" (name, section, date, TDS, "on
     <serial · date>") with Move here: off beyond this challan's balance, a confirm only when the other challan is fully
     used (it would be left with tax on no deduction), the move done by TDSMatch.move.
  6. (next-tds-addlist, the owner: "blank name in particulars") a Tally journal with no party ("Rent Dr · Rent Payable
     Alok Swarup Gupta Cr · TDS on Rent 94I Cr"): its name is the party ledger credited, with its PAN; with no party
     ledger at all (Misc. Expenses Dr · TDS 94J Cr): "Name missing" in red with Fix (next-tds-tidy2: a chip, with the one-line reason), never a blank; Fix keeps the name;
  7. (next-tds-early) a deduction on a challan dated before it in the same year (June's 194C on 00301 of 06-Jun): allowed,
     the neutral chip "Advance challan", not in Fix the row, no error; on a challan of the year before (Protean's FVU
     refuses it, T-FV-3076): the red chip, "Put 1 on the right challans", Fix the row, an error in Validate & file, never
     offered in Choose or in the Move dialog; a 194C on a 194J challan: "Challan is for 194J" and a warning;
  8. filters (next-tds-tidy2: in the column headers) in + Add deduction (name or PAN, section, month, on challan, problems only; the counts "n of N") and on the
     challan's table ("Showing n of N");
  9. ticks: Select all shown, the bar "N selected · TDS ₹X · Balance after", Move to this challan moves them all (both
     challans' balances follow) with one Undo; refused beyond the balance (the reason said); Remove from challan in bulk;
     the list sorted by best fit (the section and the month before the challan first, one dated after it last).
TDS_ACC_SHOTS=dir: screenshots (default tests/out/tds-accurate)."""
import os, sys, re, threading, functools, http.server
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
GO = "(tab) => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = tab; S.tdsDedView = ''; S.tdsChView = ''; S.tdsChSel = ''; S.tdsWinCh = ''; S.tdsWinAdd = ''; S.tdsDedReg = ''; S.tdsFl = {}; S.tdsSel = {}; render(); }"
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
    rail = J("() => (document.querySelector('#app [data-tab-count=\"challans\"]') || {}).textContent")
    strip = J("() => (document.querySelector('#app [data-fig=\"On challans\"]') || {}).textContent || ''")
    ok(grid and rail == str(len(grid)), "the Challans tab's count = the grid's rows (%s = %d: %s)" % (rail, len(grid), grid))
    ok(not re.search(r"\d+ challans?\b", strip), "the strip does not say the number again (%s)" % strip.strip())
    ok("chGONE" not in grid and "chA" in grid and "chJ" in grid, "the grid: the challans here this return uses, never the missing one")
    print("2. Used here and Used in all returns")
    heads = J("[...document.querySelectorAll('#app [data-chg] thead th')].map(h => h.innerText.trim())")
    ok(heads[-3:] == ["Used here", "Used in all returns", "Balance"], "the columns end Used here · Used in all returns · Balance (%s)" % heads[-3:])
    here = J("[...document.querySelectorAll('#app [data-chg] tbody [data-chg-here]')].map(t => +t.dataset.chgHere)")
    placed = J("() => { const ids = new Set(TDS.challans().map(c => c.id)); return Math.round(TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && ids.has(r.challan)).reduce((a, r) => a + r.tds, 0) * 100) / 100; }")
    ok(abs(sum(here) - placed) < 0.01 and abs(placed - 20985) < 0.01, "the sum of Used here = the TDS of this return's deductions on challans here (%s = %s)" % (sum(here), placed))
    ft = J("() => +(document.querySelector('#app [data-chg] tfoot [data-chg-here-sum]') || {dataset: {}}).dataset.chgHereSum")
    ok(ft is not None and abs(ft - placed) < 0.01, "the footer's Used here total = the same (%s)" % ft)
    # next-tds-tidy2: no summary strip; the grid's foot says it
    ok(not strip and "20,985.00" in J("() => (document.querySelector('#app [data-chg] tfoot [data-chg-here-sum]') || {}).innerText || ''"), "no strip; the grid's foot says ₹20,985.00 on challans")
    j = J("""() => { const t = document.querySelector('#app [data-chg] tr[data-chg-row="chJ"]'); return [...t.cells].slice(-3).map(c => c.innerText.trim()); }""")
    alln = J("() => { const cx = TDSReg.ctx(), c = TDS.challans().find(x => x.id === 'chJ'); return [TDSReg.usedTax(c, cx), TDSReg.balance(c, cx).tax]; }")
    ok(j[0] == "₹12,345.00" and j[1] == "₹" + format(alln[0], ",.2f") and alln[0] > 12345 and j[2] == "₹" + format(alln[1], ",.2f"),
       "00456, also used by 24Q: Used here ₹12,345.00, Used in all returns %s, Balance overall %s (%s)" % (alln[0], alln[1], j))
    pg.screenshot(path=os.path.join(SHOTS, "challans-grid-1440.png"), full_page=True)
    print("3. a deduction whose challan is missing")
    J(GO, "deductions"); pg.wait_for_timeout(800)
    un = J("() => { const ids = new Set(TDS.challans().map(c => c.id)); return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.tds > 0.005 && !(r.challan && ids.has(r.challan))).length; }")
    # next-tds-register: no "Not on any challan" in the selector; the Deductions register's Pending tab holds them
    opts = J("() => [...document.querySelectorAll('#app select[data-wd-sel] option')].map(o => o.value)")
    J("() => { S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(500)
    pn = J("() => [...document.querySelectorAll('[data-dreg-body=\"pending\"] tr[data-dreg-row]')].filter(tr => TDS.rows().find(r => r.id === tr.dataset.dregRow).tds > 0.005).length")
    ok("__none" not in opts and pn == un and un >= len(gone) + 1, "the selector has no 'Not on any challan'; the register's Pending lists the %d on no challan, the missing challan's two included (%s)" % (un, pn))
    J("() => { S.tdsDedReg = ''; render(); }")
    ok(J("() => !document.querySelector('#app [data-wd-unplaced]')"), "round 94: no second 'N not on a challan' line under the selector (its last choice says it)")
    # + Add deduction offers them
    J("() => { S.tdsWinCh = 'chM'; S.tdsWinAdd = 'chM'; render(); }"); pg.wait_for_timeout(600)
    cands = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-cand]')].map(t => t.dataset.wdCand)")
    ok(set(gone) <= set(cands) and "Every deduction of this return is on a challan" not in (J("() => (document.querySelector('[data-wd-addlist]') || {}).innerText || ''")),
       "+ Add deduction lists them, never “every deduction is on a challan” (%d offered)" % len(cands))
    J("() => { S.tdsWinAdd = ''; S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(700)
    miss = J("[...document.querySelectorAll('#app [data-dreg-miss]')].map(e => [e.closest('[data-dreg-row]').dataset.dregRow, e.innerText.trim()])")
    ok(sorted(x[0] for x in miss) == sorted(gone) and all(x[1] == "Challan 00777 missing" for x in miss) and J("() => [...document.querySelectorAll('#app [data-dreg-miss]')].every(e => e.title === 'Its challan 00777 is missing — choose again')"),
       "the register's Pending: each says “Challan 00777 missing” (on a hover: “… choose again”) (%s)" % miss)
    ok(J("(ids) => ids.every(id => !!document.querySelector('#app [data-dreg-body=\"pending\"] [data-dreg-row=\"' + id + '\"]'))", gone), "they are Pending, not Mapped")
    pg.screenshot(path=os.path.join(SHOTS, "register-pending-1440.png"), full_page=True)
    # next-tds-addlist / next-tds-early: never an earlier year's challan; one dated on or after the deduction before an
    # advance one (dated before it, the same year)
    g1 = gone[1]
    pk = J("(id) => { const b = document.querySelector('#app [data-dreg-row=\"' + id + '\"] [data-dreg-put]'); return b ? b.dataset.dregPut : ''; }", g1)
    cp = J("(id) => { const r = TDS.rows().find(x => x.id === id); return [...document.querySelectorAll('#app [data-dreg-row=\"' + id + '\"] [data-dreg-put]')].map(b => { const c = TDS.challans().find(c => c.id === b.dataset.dregPut); return [TDS.fyOf(c.date) >= TDS.fyOf(r.date), TDS.ymd(c.date) >= TDS.ymd(r.date)]; }); }", gone[0])
    ok(all(x[0] for x in cp) and [x[1] for x in cp] == sorted([x[1] for x in cp], reverse=True), "Choose: never an earlier year's challan; one dated on or after the deduction before an advance one (%s)" % cp)
    if pk:
        pg.click('#app [data-dreg-row="%s"] [data-dreg-put="%s"]' % (g1, pk)); pg.wait_for_timeout(500)
    ok(pk and J("(id) => S.books.alloc[id]", g1) == pk and J("(id) => !document.querySelector('#app [data-dreg-row=\"' + id + '\"] [data-dreg-miss]')", g1),
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
    ok(J("() => [...document.querySelectorAll('[data-wd-addlist] tr[data-wd-other]')].every(t => !!t.querySelector('[data-wd-move]'))"),
       "… and one deducted after this challan's date (06-Jun, the same year: an advance challan) can be moved here too")
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
    print("4. no step keys")
    J(GO, "deductees"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-dee-count], #app .rt-foot").count() == 0, "no count line under Deductees and no footer bar of tabs")
    # next-tds-tidy2: the deductees' find box is the Name column's filter (its pop-up)
    pg.click('#app #tdsDeTable thead [data-cf="dee:name"]'); pg.wait_for_timeout(200)
    box = J("() => { const i = document.querySelector('[data-cf-pop=\"dee:name\"] input[type=search]'); if (!i) return ''; i.setAttribute('data-zz-box', ''); return 'ok'; }")
    if box:
        pg.focus("[data-zz-box]"); pg.keyboard.press("F12"); pg.wait_for_timeout(400)
    ok(box and J("S.tdsTab") == "deductees", "F12 in a box to type in (the deductees' search) does not switch the step (%s)" % J("S.tdsTab"))
    J("""() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.id = 'zzDlg'; d.innerHTML = '<button id="zzDlgBtn">OK</button>'; document.body.appendChild(d); }""")
    pg.focus("#zzDlgBtn"); pg.keyboard.press("F10"); pg.wait_for_timeout(400)
    ok(J("S.tdsTab") == "deductees", "F10 inside a dialog does not switch the step (%s)" % J("S.tdsTab"))
    J("() => document.getElementById('zzDlg').remove()")
    pg.focus("#app [data-return-tabs] [data-ret-tab=\"deductees\"]"); pg.keyboard.press("F10"); pg.wait_for_timeout(400)
    ok(J("S.tdsTab") == "deductees", "with the focus on a tab F10 does nothing either (%s)" % J("S.tdsTab"))
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
    ok(nm and nm[0].startswith("Name missing") and nm[2], "no name: “Name missing” with Fix (%s)" % nm)
    red = J("() => { const e = document.createElement('span'); e.style.color = 'var(--bad)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; }")
    ok(nm and nm[1] == red, "… in red (%s = %s)" % (nm and nm[1], red))
    pg.click('[data-wd-addlist] [data-wd-namefix="%s"]' % mid); pg.wait_for_timeout(300)
    pg.fill('[data-wd-addlist] [data-wd-name-input="%s"]' % mid, "Kumar Legal Associates"); pg.keyboard.press("Enter"); pg.wait_for_timeout(500)
    ok(J("(id) => TDS.rows().find(r => r.id === id).party", mid) == "Kumar Legal Associates" and J("(id) => (S.books.tdsEdits[id] || {f: {}}).f.party", mid) == "Kumar Legal Associates",
       "Fix: the name kept as FinCom's correction, the row named (Tally not changed)")
    pg.screenshot(path=os.path.join(SHOTS, "addlist-names-1440.png"), full_page=True)
    J("() => { S.tdsWinAdd = ''; render(); }")

    print("7. an advance challan (allowed), an earlier year's challan (an error); another section's challan")
    # next-tds-early (the owner: "If there is an early challan then it should not be an error, if I want to use any early
    # challan within the rule of TRACES"): June's 194C of 10-Jun on 00301 (chM, 06-Jun, the same year): an advance challan,
    # allowed; May's 194C of 11-May on 00099 (chOLD, 20-Mar-2026, the year before: Protean's FVU refuses it, T-FV-3076): an
    # error; May's 194C of 10-May on 00222 (chT, 194J): another section
    pair = J("""() => { const rows = TDS.rows(), j = rows.find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260610'), m = rows.find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260510'),
      o = rows.find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260511');
      S.books.challans.push({id: 'chOLD', bsr: '0510308', serial: '00099', date: '20260320', tax: 5000, interest: 0, section: '194C', minorHead: '200'});
      S.books.alloc[j.id] = 'chM'; S.books.alloc[m.id] = 'chT'; S.books.alloc[o.id] = 'chOLD'; TDSReg.forget(); render(); return [j.id, m.id, o.id]; }""")
    J(GO, "deductions"); J("() => { S.tdsWinCh = 'chM'; render(); }"); pg.wait_for_timeout(700)
    chip = J("(id) => { const e = document.querySelector('#app tr[data-wd-row=\"' + id + '\"] [data-wd-chip]'); return e ? [e.dataset.wdChip, e.innerText.trim(), e.className, !!e.closest('td.wd-name')] : null; }", pair[0])
    ok(chip and chip[:2] == ["adv", "Advance challan"] and "info" in chip[2] and "bad" not in chip[2] and not chip[3], "an advance challan: the neutral chip “Advance challan” in its own column, not red (%s)" % chip)
    J("() => { S.tdsWinCh = 'chOLD'; render(); }"); pg.wait_for_timeout(500)
    oc = J("(id) => { const e = document.querySelector('#app tr[data-wd-row=\"' + id + '\"] [data-wd-chip]'); return e ? [e.dataset.wdChip, e.innerText.trim(), e.className, e.title] : null; }", pair[2])
    ok(oc and oc[0] == "fy" and "bad" in oc[2] and "T-FV-3076" in oc[3], "a challan of the year before: the red chip “%s”, the reason on a hover (%s)" % (oc and oc[1], oc and oc[3][:110]))
    ok(J("() => document.querySelectorAll('#app [data-wd-early-n]').length") == 0 and J("() => +((document.querySelector('#app [data-wd-fix-early]') || {dataset: {}}).dataset.wdFixEarly || 0)") == 1, "“Put 1 on the right challans”: only the earlier year's, not the advance one")
    J("() => { S.tdsWinCh = 'chT'; render(); }"); pg.wait_for_timeout(500)
    sc = J("(id) => { const e = document.querySelector('#app tr[data-wd-row=\"' + id + '\"] [data-wd-chip=\"sec\"]'); return e ? e.innerText.trim() : ''; }", pair[1])
    ok(sc == "Other section" and J("(id) => (document.querySelector('#app tr[data-wd-row=\"' + id + '\"] [data-wd-chip=\"sec\"]') || {}).title", pair[1]) == "Challan is for 194J; this is 194C", "a 194C deduction on a 194J challan: “%s”, its words on a hover" % sc)
    # next-tds-register: the register's Mapped tab says it (the to-do list's Fix the row is gone)
    J("() => { S.tdsDedReg = 'mapped'; render(); }"); pg.wait_for_timeout(600)
    rowIn = lambda id: J("(id) => { const t = document.querySelector('[data-dreg-body=\"mapped\"] [data-dreg-row=\"' + id + '\"]'); const p = t && t.querySelector('[data-dreg-flag]'); return t ? ['mapped', p ? p.dataset.dregFlag : '', p ? p.className : ''] : null; }", id)
    fx, fa = rowIn(pair[2]), rowIn(pair[0])
    ok(fx and fx[:2] == ["mapped", "fy"], "the register's Mapped tab: the earlier year's with its chip (%s)" % fx)
    ok(fa and (fa[1] == "" or "info" in fa[2]), "… the advance one has no error chip (%s)" % fa)
    J("() => { S.tdsDedReg = ''; render(); }")
    J(GO, "file"); pg.wait_for_timeout(700)
    ve = J("() => { const e = document.querySelector('#app [data-val-item=\"early\"]'); return e ? [e.dataset.valLevel, e.innerText] : null; }")
    vs = J("() => { const e = document.querySelector('#app [data-val-item=\"chsec\"]'); return e ? e.dataset.valLevel : ''; }")
    ok(ve and ve[0] == "error" and "1 deduction on a challan Protean's FVU refuses" in ve[1] and "T-FV-3076" in ve[1], "Validate & file: one error, the earlier year's only, with the FVU's reason (%s)" % (ve and ve[1][:160]))
    ok(vs == "warn", "… and the other section a warning (%s)" % vs)
    ok(J("() => document.querySelector('#app [data-make-fvu]').disabled"), "Make FVU file is off while it is left")
    J("(id) => { S.books.alloc[id] = 'chM'; TDSReg.forget(); render(); }", pair[2]); pg.wait_for_timeout(500)
    ve2 = J("() => { const e = document.querySelector('#app [data-val-item=\"early\"]'); return e ? e.innerText : ''; }")
    ok(ve2 == "", "with it on this year's challan (an advance one too): no such error (%s)" % ve2[:80])
    J("(id) => { S.books.alloc[id] = 'chOLD'; TDSReg.forget(); render(); }", pair[2])
    sg = J("() => { const ch = Object.fromEntries(TDS.challans().map(c => [c.id, c])), rows = Object.fromEntries(TDS.rows().map(r => [r.id, r])); return TDSMatch.suggest('26Q', '2026-27', 'Q1').filter(s => (s.parts || [{chId: s.chId}]).some(p => s.ids.some(id => rows[id] && ch[p.chId] && (TDS.fyOf(ch[p.chId].date) < TDS.fyOf(rows[id].date) || (s.rule !== 'f' && TDS.ymd(ch[p.chId].date) < TDS.ymd(rows[id].date)))))).length; }")
    ok(sg == 0, "no suggestion pairs a deduction with an earlier year's challan, and only rule f (last) with an advance one (%d)" % sg)
    j11 = J("() => TDS.rows().find(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date) === '20260611').id")
    J(GO, "deductions"); J("() => { S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(500)
    picks = J("(id) => [...document.querySelectorAll('#app [data-dreg-row=\"' + id + '\"] [data-dreg-put]')].map(b => TDS.ymd(TDS.challans().find(c => c.id === b.dataset.dregPut).date))", j11)
    ok(all(d >= "20260401" for d in picks), "the register's Pending never offers an earlier year's challan (%s)" % picks)
    J("() => { S.tdsDedReg = ''; render(); }")
    J("(id) => tdsMoveOpen([id])", j11); pg.wait_for_timeout(400)
    mv = J("() => [...document.querySelectorAll('[data-cm-pick]')].map(li => [li.dataset.cmPick, li.querySelector('[data-cm-pick-go]').disabled, !!li.querySelector('[data-cm-early]'), (li.querySelector('[data-cm-note]') || {dataset: {}}).dataset.cmNote || ''])")
    bad = [x for x in mv if x[2]]
    ok(mv and [x[0] for x in bad] == ["chOLD"] and all(x[1] for x in bad) and [x[0] for x in mv][-1] == "chOLD", "the Move dialog: only the earlier year's challan is refused, its Move here off, listed last (%s)" % bad)
    adv = [x for x in mv if x[3] == "adv"]
    ok(any(x[0] == "chM" for x in adv) and not any(x[1] for x in adv if x[0] == "chM"), "… 00301 of 06-Jun (an advance challan for 11-Jun): said, Move here on (%s)" % adv)
    J("() => { S.tdsMove = null; render(); }")
    J("() => { S.tdsWinCh = 'chM'; S.tdsWinAdd = 'chM'; S.tdsWinF = {}; render(); }"); pg.wait_for_timeout(600)
    e11 = J("(id) => { const t = document.querySelector('[data-wd-addlist] tr[data-wd-cand=\"' + id + '\"]'); return t ? [t.querySelector('[data-wd-tick]').disabled, (t.querySelector('[data-wd-note]') || {innerText: ''}).innerText.trim(), !!t.querySelector('[data-wd-put]'), !!t.querySelector('[data-wd-early]')] : null; }", j11)
    ok(e11 == [False, "Advance challan", True, False], "+ Add deduction on 00301 (06-Jun): 11-Jun's 194C can be ticked and added, “Advance challan” (%s)" % e11)
    order = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand]')].map(t => t.dataset.wdCand)")
    od = J("(ids) => ids.map(id => { const r = TDS.rows().find(x => x.id === id); return [TDS.sec(r.section), TDS.ymd(r.date)]; })", order)
    ok(od and od[0][0] == "194C" and od[0][1][:6] in ("202605", "202606") and od[0][1] <= "20260606" and od[-1][1] > "20260606",
       "sorted by best fit: first a 194C of May or June up to 06-Jun, last the one deducted after it (%s … %s)" % (od[:1], od[-1:]))

    print("8. filters (next-tds-tidy2: in the column headers)")
    def cf(key, kind, val):
        pg.click('[data-cf="%s"]' % key); pg.wait_for_timeout(200)
        if kind == "q": pg.fill('[data-cf-pop="%s"] input[type=search]' % key, val)
        elif kind == "flag": pg.check('[data-cf-pop="%s"] [data-cf-flag]' % key)
        elif pg.locator('[data-cf-pop="%s"] [data-cf-v="%s"]' % (key, val)).count(): pg.check('[data-cf-pop="%s"] [data-cf-v="%s"]' % (key, val))
        else: J("([n, k]) => { S.tdsCF = Object.assign({}, S.tdsCF || {}, {[n]: Object.assign({}, (S.tdsCF || {})[n] || {}, {[k]: ['__none__']})}); render(); }", key.split(":"))
        pg.wait_for_timeout(350); pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    clear = lambda: (J("() => { S.tdsCF = {}; render(); }"), pg.wait_for_timeout(300))
    tot = J("() => [document.querySelectorAll('[data-wd-addlist] [data-wd-cand]').length, document.querySelectorAll('[data-wd-addlist] [data-wd-other]').length]")
    ok(J("() => document.querySelectorAll('[data-wd-addlist] .wd-filters, [data-wd-addlist] [data-wd-f]').length") == 0 and J("() => document.querySelectorAll('[data-wd-addlist] thead [data-cf]').length") >= 8, "no filter bar: the filters are funnels in both lists' headings")
    cf("wd-add:name", "q", "Consultant")
    if tot[1]: cf("wd-other:name", "q", "Consultant")
    nm = J("[...document.querySelectorAll('[data-wd-addlist] td[data-wd-name]')].map(t => t.innerText)")
    ft = J("[...document.querySelectorAll('[data-wd-addlist] tfoot [data-cf-shown]')].map(h => h.dataset.cfShown)")
    ok(nm and all("Consultant" in x for x in nm) and len(nm) < sum(tot), "search: only names with “Consultant” (%d of %d)" % (len(nm), sum(tot)))
    ok(len(ft) == (2 if tot[1] else 1) and J("() => [...document.querySelectorAll('[data-wd-addlist] [data-wd-addh]')].every(h => !/ of /.test(h.innerText))"), "the counts “n of N” in each list's foot, not in its heading (%s)" % ft)
    clear(); cf("wd-add:name", "q", "AOLPG9817N")
    if tot[1]: cf("wd-other:name", "q", "AOLPG9817N")
    nm = J("[...document.querySelectorAll('[data-wd-addlist] td[data-wd-name]')].map(t => t.innerText)")
    ok(nm and all(x == "Rent Payable Alok Swarup Gupta" for x in nm), "search by PAN (%s)" % nm)
    clear(); cf("wd-add:sec", "pick", "194J")
    if tot[1]: cf("wd-other:sec", "pick", "194J")
    secs = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand], [data-wd-addlist] tr[data-wd-other]')].map(t => t.cells[2].innerText.trim())")
    ok(secs and set(secs) == {"194J"}, "Section 194J: only 194J (%d)" % len(secs))
    clear(); cf("wd-add:date", "pick", "202605")
    if tot[1]: cf("wd-other:date", "pick", "202605")
    ds = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand], [data-wd-addlist] tr[data-wd-other]')].map(t => t.cells[3].innerText.trim())")
    ok(ds and all("-May-2026" in d for d in ds), "Month May 2026: only May (%d)" % len(ds))
    clear(); onA = J("() => { const c = TDS.challans().find(c => c.id === 'chA'); return c.serial + ' · ' + fmtDate(tallyDate(TDS.ymd(c.date))); }"); cf("wd-other:on", "pick", onA)
    on = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-on]')].map(t => t.dataset.wdOn)")
    ok(on and set(on) == {"chA"}, "On challan 00123: only those on it (%d)" % len(on))
    clear(); cf("wd-add:name", "flag", "")
    if tot[1]: cf("wd-other:name", "flag", "")
    pr = J("[...document.querySelectorAll('[data-wd-addlist] tr[data-wd-cand], [data-wd-addlist] tr[data-wd-other]')].map(t => t.dataset.wdCand || t.dataset.wdOther)")
    ok(pr and pair[1] in pr and pair[2] in pr and j11 not in pr and mid in pr and len(pr) < sum(tot), "Problems only: the one on another section's challan, the one on an earlier year's, the one with no PAN …; not the advance one (%d of %d)" % (len(pr), sum(tot)))
    pg.click('[data-wd-addlist] [data-cf-clearall="wd-add"]'); pg.wait_for_timeout(300)
    if tot[1]: pg.click('[data-wd-addlist] [data-cf-clearall="wd-other"]'); pg.wait_for_timeout(300)
    ok(J("() => document.querySelectorAll('[data-wd-addlist] [data-wd-cand], [data-wd-addlist] [data-wd-other]').length") == sum(tot), "Clear filters: every row again")
    J("() => { S.tdsWinAdd = ''; S.tdsWinCh = 'chA'; render(); }"); pg.wait_for_timeout(500)
    n0 = J("() => document.querySelectorAll('#app [data-wd-table] tr[data-wd-row]').length")
    cf("wd-table:name", "q", "Contractor 1")
    n1 = J("() => [...document.querySelectorAll('#app [data-wd-table] tr[data-wd-row]')].map(t => t.querySelector('[data-wd-name]').innerText)")
    ok(n1 and len(n1) < n0 and all("Contractor 1" in x for x in n1) and J("() => (document.querySelector('#app [data-wd-foot] [data-cf-shown]') || {dataset: {}}).dataset.cfShown") == "%d|%d" % (len(n1), n0),
       "the challan's table: filtered, “%d of %d” in its footer, the footer still the challan's" % (len(n1), n0))
    clear()

    print("9. ticks: move and remove in bulk")
    J("(v) => { S.tdsWinCh = 'chBig'; S.tdsWinAdd = 'chBig'; S.tdsCF = {'wd-other': {on: [v]}}; render(); }", onA); pg.wait_for_timeout(600)
    pg.check('[data-wd-addlist] [data-wd-tickall="other"]'); pg.wait_for_timeout(300)
    bar = J("() => { const b = document.querySelector('[data-wd-addlist] [data-wd-bulk]'); return b ? [+b.dataset.wdBulk, +b.dataset.tot, +b.dataset.after, b.querySelector('[data-wd-bulk-move]').disabled, (b.querySelector('[data-wd-bulk-why]') || {}).innerText || ''] : null; }")
    ok(bar and bar[0] == 8 and abs(bar[1] - 8640) < 0.01 and bar[3] and "more than the ₹5,000.00 left" in bar[4], "Select all shown: 8 selected · TDS ₹8,640 > ₹5,000 left: Move refused, the reason said (%s)" % bar)
    pg.uncheck('[data-wd-addlist] [data-wd-tickall="other"]'); pg.wait_for_timeout(200)
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
