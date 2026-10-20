"""python3 run_tds_dedmatch.py - the Deductions step as the one place to prepare a return (next-tds-clear; the owner,
19-Oct-2026: "nobody opens challans one by one … deductions should be very smart — nobody goes to Tally, everything
within this window, just by clicks"). On the made-up books and challans of run_tds_match_ui.py (Q1 of tax year 2026-27):
  1. one screen: the deductions table with its filters and, beside it, the challans panel (tax, used, balance, live;
     "Not matched (N · ₹X)"); each deduction not on a challan shows its suggested challan with the reason and a tick:
     ticked, it is on that challan at once and the panel's balance drops; unticked, off again; "Accept all N
     suggestions"; a challan clicked in the panel filters the table to it, clicked again shows all; the filters work
  2. by clicks alone: a cell edited in place (Enter saves as a FinCom correction, Tab goes to the next cell, Tally not
     changed); one-click fixes with the exact change (the rate that applies); ticked rows given a section at once;
     the keyboard (↑ ↓, Space, ?); no "Done: N of M ready" in the header (round 94); Add deduction filled from the party's history
  3. the to-do list (next-tds-allchallans; the owner's layout, 19-Oct-2026: "still very confusing"): the step opens on
     "N deductions · D done · K need you" and the groups Confirm · Choose a challan · Pay a challan (one block per
     section-month, Add challan and Paid in Tally? Add BSR) · Fix the row · Done (folded); each row in exactly one group,
     the line's counts the groups'; one primary action a to-do row; Confirm and Confirm all move rows out of Confirm at
     once; the headings, reasons and flags are not grey (contrast at least 4.5:1, light and dark); phone: no sideways scroll
  4. Deductions by challan, as Winman (round 88): the step opens on "Select challan" (no · date · total, "Not on any
     challan (N)" last; the first with a balance left); the table is that challan's deductions with Winman's columns;
     the footer (used here · balance, red below nil · number; the challan's amount is the dropdown's, round 94) equals the
     challan and stays in view; "+ Add deduction to this challan" lists the deductions not on a challan, the best fit
     first, one click puts one on and the footer follows; "Not on any challan" is the to-do list; the steps' tabs across
     the top (round 94: no tabs at the foot, no F8 / F10 / F11 / F12); the
     Challans grid in the same order, a row opening its deductions; phone: no sideways scroll, nothing under the app's bar
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
GO = "() => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'deductions'; S.tdsDedView = 'table'; S.tdsFl = {}; S.tdsDedChF = ''; S.tdsSel = {}; render(); }"
TODO = GO.replace("S.tdsDedView = 'table'", "S.tdsDedView = ''; S.tdsWinCh = '__none'")
WIN = GO.replace("S.tdsDedView = 'table'", "S.tdsDedView = ''; S.tdsWinCh = ''")
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
        # every column in view beside the panel at 1440 and 1366: no sideways scroll in the table, the first row's
        # suggested-challan tick on screen and not covered (the coordinator's review, 19-Oct-2026)
        for w in (1440, 1366):
            pg.set_viewport_size({"width": w, "height": 950}); pg.wait_for_timeout(400)
            v = J("""() => { const t = document.querySelector('#tdsDnTable'), wrap = t.closest('.lt-wrap, .bk-tablewrap'), cb = t.querySelector('tbody [data-dd-sugg]'); if (!cb) return null;
              const r = cb.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), side = document.querySelector('[data-dd-side]').getBoundingClientRect();
              const heads = [...t.querySelectorAll('thead th')].map(h => h.innerText.trim()).filter(Boolean);
              return {over: wrap.scrollWidth - wrap.clientWidth, inView: r.right <= innerWidth && r.left >= 0, hit: hit === cb, beforeSide: t.getBoundingClientRect().right <= side.left + 1, heads,
                rowH: Math.max(...[...t.querySelectorAll('tbody tr[data-ded-row]')].filter(tr => !tr.querySelector('[data-row-fixes]')).map(tr => tr.getBoundingClientRect().height), 0)}; }""")
            ok(v and v["over"] <= 1 and v["inView"] and v["hit"] and v["beforeSide"], "%d: every column in view, no sideways scroll, the first row's suggested-challan tick visible and not covered (%s)" % (w, v))
            ok(v and all(any(h.startswith(x) for h in v["heads"]) for x in ["Date", "Deductee", "PAN", "Section", "Paid", "Rate", "TDS", "Challan"]), "%d: Date · Deductee · PAN · Section · Paid · Rate · TDS · Challan (%s)" % (w, v and v["heads"]))
            ok(v and v["rowH"] <= 40, "%d: a row without a fix at most 40 px (%s)" % (w, v and v["rowH"]))
            pg.screenshot(path=os.path.join(SHOTS, "deductions-suggestions-%d.png" % w))
        pg.set_viewport_size({"width": 1440, "height": 950}); pg.wait_for_timeout(300)
        rid = J("() => { const s = TDSMatch.suggest('26Q', '2026-27', 'Q1').find(s => s.chId === 'chA'); return s ? s.ids[0] : ''; }")
        tds = J("(id) => TDS.rows().find(r => r.id === id).tds", rid)
        b0 = bal("chA")
        ok("Same section" in (pg.locator('#app [data-dd-sugg-cell="%s"]' % rid).inner_text() or ""), "the suggestion's reason on the row")
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
        # next-tds-tidy2: "Needs fixing" and the find box are the Deductee column's filter
        pg.click('#app #tdsDnTable thead [data-cf="deductions:name"]'); pg.wait_for_timeout(200)
        pg.check('[data-cf-pop="deductions:name"] [data-cf-flag="deductions:fix"]'); pg.wait_for_timeout(300)
        nf = pg.locator("#tdsDnTable > tbody > tr[data-ded-row]").count()
        pg.uncheck('[data-cf-pop="deductions:name"] [data-cf-flag="deductions:fix"]'); pg.wait_for_timeout(300)
        pg.fill('[data-cf-pop="deductions:name"] input[aria-label="Find a deductee, PAN, voucher or ledger"]', "Contractor 1"); pg.wait_for_timeout(500)
        nq = pg.locator("#tdsDnTable > tbody > tr[data-ded-row]").count()
        pg.fill('[data-cf-pop="deductions:name"] input[aria-label="Find a deductee, PAN, voucher or ledger"]', ""); pg.wait_for_timeout(400); pg.keyboard.press("Escape")
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
        # round 94: the deduction count is on its tab only; no "Done: N of M ready" in the header
        ok(pg.locator("#app [data-ret-progress]").count() == 0 and "Done:" not in pg.inner_text("#app [data-return-card]"), "the header: no Done: N of M ready (the count is on the Deductions tab)")
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
        print("3. the to-do list")
        pg.set_viewport_size({"width": 1440, "height": 900})
        J(CHALLANS)
        # PANs for all but ZZ Contractor 1 (companies for 194C at 2%, persons for 194J)
        J("""() => { const ps = Array.from(new Set(TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').map(r => r.party))); let i = 0;
          ps.forEach(p => { if (p === 'ZZ Contractor 1') return; i++; const c = /Contractor/.test(p) ? 'C' : 'P'; tdsDeducteeSet(p, {pan: 'AAA' + c + 'Z' + String(1000 + i) + 'K', name: ''}); }); render(); }""")
        J(TODO); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-ded-todo]").count() == 1 and pg.locator("#tdsDnTable").count() == 0, "Not on any challan: the to-do list, not the table")
        def state():
            return J("""() => { const g = {}; document.querySelectorAll('#app [data-dt-group]').forEach(d => { g[d.dataset.dtGroup] = {n: +d.dataset.dtN, rows: [...d.querySelectorAll('tr[data-dt-row]')].map(t => t.dataset.dtRow), open: d.open}; });
              const line = (document.querySelector('#app [data-dt-line]') || {dataset: {}}).dataset.dtLine || ''; return {g, line}; }""")
        st = state(); qrows = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').map(r => r.id).sort()")
        seen = [r for v in st["g"].values() for r in v["rows"]]
        ok(sorted(seen) == qrows and len(seen) == len(set(seen)), "each deduction in exactly one group (%d of %d)" % (len(set(seen)), len(qrows)))
        ok(all(v["n"] == len(v["rows"]) for v in st["g"].values()), "each group's count is its rows (%s)" % {k: v["n"] for k, v in st["g"].items()})
        done = len(st["g"].get("done", {"rows": []})["rows"]); need = len(seen) - done
        ok(st["line"] == "%d|%d|%d" % (len(qrows), done, need), "the line: %d deductions · %d done · %d need you (%s)" % (len(qrows), done, need, st["line"]))
        order = list(st["g"].keys()); want_order = [k for k in ["confirm", "choose", "pay", "fix", "done"] if k in st["g"]]
        ok(order == want_order and "confirm" in order and "choose" in order, "the groups in the owner's order, empty ones not shown (%s)" % order)
        ok(all(v["open"] for k, v in st["g"].items() if k != "done") and ("done" not in st["g"] or not st["g"]["done"]["open"]), "the to-do groups open, Done folded")
        one = J("""() => [...document.querySelectorAll('#app [data-dt-group] tr[data-dt-row]')].filter(t => ['confirm', 'choose', 'fix'].includes(t.dataset.dtIn)).map(t => [t.dataset.dtRow, t.dataset.dtIn, t.querySelectorAll('.dt-do:not(.dt-pick)').length, t.querySelectorAll('.dt-pick').length])""")
        ok(one and all(x[2] == 1 or (x[1] == "choose" and x[2] == 0 and 1 <= x[3] <= 3) for x in one), "each to-do row has one action (choose: the best 1 to 3 challans, one click each) (%s)" % [x for x in one if not (x[2] == 1 or (x[1] == "choose" and 1 <= x[3] <= 3))][:3])
        prim = J("[...document.querySelectorAll('#app .btn.primary')].filter(b => b.offsetParent).map(b => b.innerText.trim())")
        ok(len(prim) == 1 and prim[0].startswith("Confirm all"), "the page's one filled button: Confirm all (%s)" % prim)
        def contrast(theme):
            return J("""(theme) => { document.documentElement.dataset.theme = theme;
              const L = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return [0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]), m[3] == null ? 1 : m[3]]; };
              const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; const m = b.match(/[\\d.]+/g); if (m && (m[3] == null || +m[3] > 0.5)) return b; } return getComputedStyle(document.body).backgroundColor; };
              const out = []; document.querySelectorAll('#app .dt-gt, #app .dt-why, #app .dt-to, #app .dt-flag, #app .dt-fixw, #app .dt-payw, #app .dt-gn, #app .dt-line, #app [data-dt-pay-head], #app .dt-on, #app .dt-donew').forEach(e => {
                if (!e.getClientRects().length) return; const s = getComputedStyle(e), a = L(s.color)[0], b = L(bgOf(e))[0], r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                out.push([e.className || e.tagName, Math.round(r * 100) / 100, +s.opacity]); });
              return out; }""", theme)
        for theme in ("light", "dark"):
            cs = contrast(theme); low = [c for c in cs if c[1] < 4.5 or c[2] < 1]
            ok(cs and not low, "%s: headings, reasons and flags at least 4.5:1, none faded (%d checked; low: %s)" % (theme, len(cs), low[:4]))
            if theme == "dark": pg.screenshot(path=os.path.join(SHOTS, "deductions-todo-dark-1440.png"), full_page=True)
        J("() => { document.documentElement.dataset.theme = 'light'; }")
        pg.screenshot(path=os.path.join(SHOTS, "deductions-todo-1440.png"), full_page=True)
        cut = J("() => [...document.querySelectorAll('#app .dt-act')].filter(e => e.getBoundingClientRect().right > e.closest('.dt-g').getBoundingClientRect().right + 1).length")
        ok(cut == 0, "1440: every row's action inside its group, nothing cut off (%d cut)" % cut)
        rid = st["g"]["confirm"]["rows"][0]; pan_ok = J("(id) => Certs.validPan(TDS.rows().find(r => r.id === id).pan)", rid)
        pg.click('#app [data-dt-confirm="%s"]' % rid); pg.wait_for_timeout(500)
        st2 = state(); where = [k for k, v in st2["g"].items() if rid in v["rows"]]
        ok(J("(id) => !!S.books.alloc[id]", rid) and where == (["done"] if pan_ok else ["fix"]), "Confirm: on its challan at once, the row now in %s" % where)
        nconf = len(st2["g"]["confirm"]["rows"]); before = {k: len(v["rows"]) for k, v in st2["g"].items()}
        pg.click("#app [data-dt-confirm-all]"); pg.wait_for_timeout(700)
        st3 = state(); after = {k: len(v["rows"]) for k, v in st3["g"].items()}
        ok("confirm" not in st3["g"] and after.get("done", 0) + after.get("fix", 0) - before.get("done", 0) - before.get("fix", 0) == nconf, "Confirm all %d: Confirm gone, the %d rows in Done or Fix the row (%s → %s)" % (nconf, nconf, before, after))
        seen3 = [r for v in st3["g"].values() for r in v["rows"]]
        ok(st3["line"] == "%d|%d|%d" % (len(qrows), after.get("done", 0), len(seen3) - after.get("done", 0)), "the line still equals the groups (%s)" % st3["line"])
        fx = pg.locator('#app [data-dt-group="fix"] tr[data-dt-row]').first
        # next-tds-tidy2: the problem a short chip ("No PAN"), its words on a hover
        ok(fx.count() == 1 and "No PAN" in fx.inner_text() and fx.locator("[data-dt-problem=pan]").get_attribute("title") == "no PAN" and fx.locator("[data-dt-addpan]").count() == 1, "Fix the row: ZZ Contractor 1, No PAN, Add PAN")
        # no challan at all: one block per section and month, Add challan and Paid in Tally? Add BSR
        J("() => { S.books.challans = []; S.books.alloc = {}; S.books.allocFrom = {}; S.books.matchNo = {}; S.books.tdsSplits = {}; TDSReg.forget && TDSReg.forget(); render(); }"); pg.wait_for_timeout(800)
        heads = J("[...document.querySelectorAll('#app [data-dt-pay]')].map(b => b.dataset.dtPay)")
        sm = J("() => Array.from(new Set(TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.tds > 0.005).map(r => TDS.sec(r.section) + '|' + TDS.ymd(r.date).slice(0, 6)))).length")
        ok(len(heads) == sm and len(set(heads)) == len(heads), "Pay a challan: one block per section and month (%d = %d)" % (len(heads), sm))
        blk = pg.locator("#app [data-dt-pay]").first
        ok(blk.locator("[data-dt-add]").count() == 1 and blk.locator("[data-dt-bsr]").count() == 1 and re.search(r"· ₹[\d,.]+ due", blk.locator("[data-dt-pay-head]").inner_text()), "a block: '<section> · <month> · ₹X due', Add challan, Paid in Tally? Add BSR (%s)" % blk.locator("[data-dt-pay-head]").inner_text())
        due = J("""() => { const b = document.querySelector('#app [data-dt-pay]'), ids = [...b.querySelectorAll('tr[data-dt-row]')].map(t => t.dataset.dtRow);
          return [+b.querySelector('[data-dt-pay-head]').innerText.match(/₹([\d,.]+) due/)[1].replace(/,/g, ''), TDS.rows().filter(r => ids.includes(r.id)).reduce((a, r) => a + r.tds, 0)]; }""")
        ok(due[0] >= due[1] - 0.01 and due[0] <= due[1] * 1.25 + 1, "the block's ₹ due is its rows' TDS (with any interest) (%s)" % due)
        w = J("() => [...document.querySelectorAll('#app .dt-table')].map(t => t.getBoundingClientRect().right - t.closest('.dt-g').getBoundingClientRect().right)")
        ok(all(x <= 1 for x in w), "1440: every group's rows inside the page, nothing cut off (%s)" % w[:4])
        pg.screenshot(path=os.path.join(SHOTS, "deductions-todo-pay-1440.png"), full_page=True)
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391, "phone: the groups stack, no sideways scroll (%s)" % J("document.documentElement.scrollWidth"))
        pg.screenshot(path=os.path.join(SHOTS, "deductions-todo-pay-390.png"), full_page=True)
        J(CHALLANS); pg.wait_for_timeout(600)
        pg.screenshot(path=os.path.join(SHOTS, "deductions-todo-390.png"), full_page=True)
        print("4. Deductions by challan, as Winman (round 88)")
        pg.set_viewport_size({"width": 1440, "height": 900}); J(CHALLANS); J("() => tdsMatchConfirmAll()"); pg.wait_for_timeout(500)
        J(WIN); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-wd]").count() == 1 and pg.locator("#app [data-ded-todo]").count() == 0 and pg.locator("#tdsDnTable").count() == 0 and pg.locator("#app [data-dd-side]").count() == 0,
           "the step opens on a challan: one selector, one table, no to-do list, no side panel")
        opts = J("[...document.querySelectorAll('#app select[data-wd-sel] option')].map(o => [o.value, o.textContent])")
        chs = J("() => { const n = TDS.challans().length; return [...document.querySelectorAll('#app select[data-wd-sel] option')].filter(o => o.value !== '__none').map(o => o.value); }")
        un = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && r.tds > 0.005).length")
        ok(len(chs) >= 3 and all(re.match(r"^%d · \d\d-\w{3}-\d{4} · ₹[\d,.]+$" % (i + 1), o[1]) for i, o in enumerate(opts[:len(chs)])), "the dropdown: one line a challan, “no · date · total” (%s)" % [o[1] for o in opts[:3]])
        ok(un > 0 and opts[-1] == ["__none", "Not on any challan (%d)" % un], "the dropdown's last line: Not on any challan (%d) (%s)" % (un, opts[-1]))
        totals = J("(ids) => ids.map(id => { const c = TDS.challans().find(x => x.id === id); return Math.round((num(c.tax) + num(c.interest) + num(c.fee) + num(c.others)) * 100) / 100; })", chs)
        said = [float(o[1].split("₹")[-1].replace(",", "")) for o in opts[:len(chs)]]
        ok(all(abs(a - b) < 0.01 for a, b in zip(said, totals)), "each line's total: tax + interest + fee + others (%s = %s)" % (said[:3], totals[:3]))
        first = J("(ids) => { const cx = TDSReg.ctx(); return ids.find(id => TDSReg.balance(TDS.challans().find(c => c.id === id), cx).tax > 0.005) || ids[0]; }", chs)
        cur = pg.input_value("#app select[data-wd-sel]")
        ok(cur == first, "chosen at first: the first challan with a balance left (%s = %s)" % (cur, first))
        def table(cid):
            shown = J("[...document.querySelectorAll('#app [data-wd-table] tbody tr[data-wd-row]')].map(t => t.dataset.wdRow)")
            want = J("(c) => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan === c).map(r => r.id)", cid)
            return shown, want
        shown, want = table(cur)
        ok(sorted(shown) == sorted(want) and shown, "the table: the deductions on that challan only (%d)" % len(shown))
        heads = J("[...document.querySelectorAll('#app [data-wd-table] thead th')].map(h => h.innerText.trim()).filter(Boolean)")
        # next-tds-early: a row's chip in a column of its own after the name (its heading for a screen reader: Check)
        ok(heads[:11] == ["Name", "Check", "PAN", "Amount paid", "Paid date", "Deduction date", "TDS", "Rate", "Reason lower/higher", "Section", "Shortfall/Excess"], "Winman's columns (%s)" % heads)
        def foot():
            return J("() => { const f = document.querySelector('#app [data-wd-foot]'); return f ? {amt: +f.dataset.amt, used: +f.dataset.used, bal: +f.dataset.bal, n: +f.dataset.n, text: f.innerText, red: !!f.querySelector('[data-wd-bal].bad')} : null; }")
        def want_foot(cid):
            return J("(id) => { const cx = TDSReg.ctx(), c = TDS.challans().find(x => x.id === id); return {amt: num(c.tax), used: TDSReg.usedTax(c, cx), bal: TDSReg.balance(c, cx).tax, n: TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan === id).length}; }", cid)
        f0, w0 = foot(), want_foot(cur)
        ok(f0 and all(abs(f0[k] - w0[k]) < 0.01 for k in ("amt", "used", "bal", "n")) and all(x in f0["text"] for x in ["Used here", "Balance", "Number of deductions"]) and "Challan amount" not in f0["text"],
           "the footer: Used here (round 89; Amount utilised (all returns) only when other returns use it too) · Balance · Number of deductions equal the challan; no Challan amount, the dropdown has it (%s / %s)" % (f0, w0))
        vis = J("() => { const f = document.querySelector('#app [data-wd-foot]').getBoundingClientRect(); return f.bottom <= innerHeight + 1 && f.top >= 0; }")
        ok(vis, "the footer is in view without scrolling")
        last = J("() => { const t = [...document.querySelectorAll('#app [data-wd-table] tbody tr')]; return t.length ? t[t.length - 1].innerText.trim() : ''; }")
        ok(last.startswith("+ Add deduction to this challan"), "the table's last row: + Add deduction to this challan (%s)" % last)
        pg.screenshot(path=os.path.join(SHOTS, "winman-deductions-challan-1440.png"), full_page=True)
        # a row on another challan with balance to take it? use the chosen challan; the best fit offered first
        pg.click("#app [data-wd-add-open]"); pg.wait_for_timeout(500)
        cands = J("[...document.querySelectorAll('[data-wd-addlist] [data-wd-cand]')].map(t => t.dataset.wdCand)")
        bestw = J("""(c) => { const s = TDSMatch.suggest('26Q', '2026-27', 'Q1'), cx = TDSReg.ctx(), ch = TDS.challans().find(x => x.id === c), left = TDSReg.balance(ch, cx).tax;
          return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && r.tds > 0.005).filter(r => r.tds <= left + 0.005 && TDSCH.secOk(TDSCH.secNorm(ch.section), r.section) && TDS.ymd(r.date) <= TDS.ymd(ch.date)).map(r => r.id); }""", cur)
        ok(cands and len(cands) == un and (not bestw or cands[0] in bestw), "+ Add deduction: the deductions not on a challan (%d), the best fit first (never one deducted after the challan) (%s)" % (len(cands), cands[:2]))
        tick = cands[0] if cands else ""
        tds = J("(id) => TDS.rows().find(r => r.id === id).tds", tick) if tick else 0
        if pg.locator('[data-wd-addlist] [data-wd-put="%s"]' % tick).count():
            pg.click('[data-wd-addlist] [data-wd-put="%s"]' % tick); pg.wait_for_timeout(500)
        else:
            J("(c) => { const t = S.books.challans.find(x => x.id === c); t.tax = num(t.tax) + 100000; TDSReg.forget(); render(); }", cur); pg.wait_for_timeout(400)
            f0, w0 = foot(), want_foot(cur)
            pg.click('[data-wd-addlist] [data-wd-put="%s"]' % tick); pg.wait_for_timeout(500)
        f1 = foot()
        ok(J("(id) => S.books.alloc[id]", tick) == cur and f1["n"] == f0["n"] + 1 and abs(f1["used"] - (f0["used"] + tds)) < 0.01 and abs(f1["bal"] - (f0["bal"] - tds)) < 0.01,
           "one click: on the challan, the footer updates (%s → %s)" % ({k: f0[k] for k in ("n", "used", "bal")}, {k: f1[k] for k in ("n", "used", "bal")}))
        ok(pg.locator('#app [data-wd-table] tr[data-wd-row="%s"]' % tick).count() == 1 and pg.locator('[data-wd-addlist] [data-wd-cand="%s"]' % tick).count() == 0, "the row is in the table, out of the list")
        ok(pg.locator("[data-wd-addlist] [data-wd-new]").count() == 1, "or type a new one (Add deduction)")
        J("() => { S.tdsWinAdd = ''; render(); }"); pg.wait_for_timeout(400)
        # a challan used beyond its tax: the balance in red
        J("(c) => { const t = S.books.challans.find(x => x.id === c); t._tax = t.tax; t.tax = 1; TDSReg.forget(); render(); }", cur); pg.wait_for_timeout(400)
        fn = foot(); ok(fn["red"] and fn["bal"] < 0, "a negative balance is red (%s)" % fn)
        J("(c) => { const t = S.books.challans.find(x => x.id === c); t.tax = t._tax; delete t._tax; TDSReg.forget(); render(); }", cur); pg.wait_for_timeout(400)
        # another challan chosen
        other = [c for c in chs if c != cur][0]
        pg.select_option("#app select[data-wd-sel]", other); pg.wait_for_timeout(500)
        shown, want = table(other); f2, w2 = foot(), want_foot(other)
        ok(sorted(shown) == sorted(want) and all(abs(f2[k] - w2[k]) < 0.01 for k in ("amt", "used", "bal", "n")), "another challan chosen: its deductions and its footer (%d)" % len(shown))
        un = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && r.tds > 0.005).length")
        # round 94: the count is the dropdown's last choice only, no "N not on a challan · Show" line under it
        last_opt = J("() => { const o = [...document.querySelectorAll('#app select[data-wd-sel] option')]; return o.length ? o[o.length - 1].textContent : ''; }")
        ok(pg.locator("#app [data-wd-unplaced]").count() == 0 and last_opt == "Not on any challan (%d)" % un, "the dropdown's last choice: Not on any challan (%d), no line under it (%s)" % (un, last_opt))
        help_lines = J("[...document.querySelectorAll('#app [data-wd] p.note, #app [data-wd] .wd-help')].filter(e => e.offsetParent).length")
        ok(help_lines <= 1, "at most one line of help (%d)" % help_lines)
        pg.select_option("#app select[data-wd-sel]", "__none"); pg.wait_for_timeout(600)
        ok(pg.input_value("#app select[data-wd-sel]") == "__none" and pg.locator("#app [data-ded-todo]").count() == 1 and pg.locator("#app [data-dt-group]").count() >= 1, "Show / Not on any challan: the to-do groups")
        pg.screenshot(path=os.path.join(SHOTS, "winman-deductions-none-1440.png"), full_page=True)
        # round 94: the steps' tabs across the top; no tabs at the foot and no F8 / F10 / F11 / F12
        tabs = J("[...document.querySelectorAll('#app [data-return-tabs] [data-ret-tab]')].map(b => b.dataset.retTab)")
        ok(tabs[:4] == ["deductor", "deductees", "challans", "deductions"] and pg.locator("#app [data-ret-foot], #app .rt-foot").count() == 0, "the tabs across the top: Deductor · Deductees · Challans · Deductions …, none at the foot (%s)" % tabs)
        seen = []
        for key in ("F10", "F11", "F8", "F12"):
            pg.keyboard.press(key); pg.wait_for_timeout(300); seen.append(J("S.tdsTab"))
        ok(seen == ["deductions"] * 4, "F10 / F11 / F8 / F12 do nothing (%s)" % seen)
        pg.click('#app [data-return-tabs] [data-ret-tab="challans"]'); pg.wait_for_timeout(400)
        ok(J("S.tdsTab") == "challans", "a tab clicked opens its step")
        pg.click('#app [data-return-tabs] [data-ret-tab="deductions"]'); pg.wait_for_timeout(400)
        # the Challans step: the grid; a row opens its deductions
        J("() => { S.tdsChView = ''; S.tdsChSel = ''; S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(600)
        pg.screenshot(path=os.path.join(SHOTS, "winman-challans-1440.png"), full_page=True)
        rows_g = J("[...document.querySelectorAll('#app [data-chg] tbody tr[data-chg-row]')].map(t => t.dataset.chgRow)")
        ok(rows_g == chs, "Challans: the same challans, in the same order, as the Deductions dropdown (%d)" % len(rows_g))
        pg.click('#app [data-chg] tr[data-chg-row="%s"]' % other); pg.wait_for_timeout(500)
        ok(J("S.tdsTab") == "deductions" and pg.input_value("#app select[data-wd-sel]") == other, "a challan clicked: Deductions with it chosen")
        J("() => { S.tdsQ = 'Q2'; render(); }"); pg.wait_for_timeout(400); J("() => { S.tdsQ = 'Q1'; render(); }"); pg.wait_for_timeout(500)
        dflt = J("(ids) => { const cx = TDSReg.ctx(); return ids.find(id => TDSReg.balance(TDS.challans().find(c => c.id === id), cx).tax > 0.005) || ids[0]; }", chs)
        ok(pg.input_value("#app select[data-wd-sel]") == dflt, "another quarter opened and back: the return's own default, not the last return's choice (%s)" % dflt)
        # phone
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        J("(c) => { S.tdsWinCh = c; render(); }", cur); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391 and J("() => { const f = document.querySelector('#app [data-wd-foot]').getBoundingClientRect(); return f.bottom <= innerHeight + 1; }"), "phone, a challan chosen: no sideways scroll, the footer in view")
        unc = J("""() => ['[data-wd-foot]'].map(sel => { const e = document.querySelector('#app ' + sel), r = e.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && e.contains(h); })""")
        ok(all(unc), "phone: the footer is not under the app's bottom bar (%s)" % unc)
        pg.screenshot(path=os.path.join(SHOTS, "winman-deductions-challan-390.png"), full_page=True)
        J("() => { S.tdsWinCh = '__none'; render(); }"); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391, "phone, Not on any challan: no sideways scroll")
        pg.screenshot(path=os.path.join(SHOTS, "winman-deductions-none-390.png"), full_page=True)
        J("() => { S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391, "phone, Challans: no sideways scroll (the table scrolls in its box)")
        pg.screenshot(path=os.path.join(SHOTS, "winman-challans-390.png"), full_page=True)
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
