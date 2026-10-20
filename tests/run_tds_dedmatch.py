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
  3. the Deductions register (next-tds-register, 20-Oct-2026; it replaces the to-do list of next-tds-allchallans):
     "Deductions N" opens it; Pending (on no challan) and Mapped (on a challan), each deduction in exactly one tab, the
     tabs' counts their rows; one next step a pending row (Confirm, the best 1 to 3 challans, or Needs a challan); Confirm
     and Confirm all move rows to Mapped at once, said placed by a rule; chips, tabs and cells at least 4.5:1, light and
     dark; with no challan every deduction Pending; phone: no sideways scroll
  4. Deductions by challan, as Winman (round 88): the step opens on "Select challan" (no · date · total; no "Not on any
     challan" since next-tds-register; the first with a balance left); the table is that challan's deductions with Winman's columns;
     the footer (used here · balance, red below nil · number; the challan's amount is the dropdown's, round 94) equals the
     challan and stays in view; "+ Add deduction to this challan" lists the deductions not on a challan, the best fit
     first, one click puts one on and the footer follows; "Deductions N" opens the register; the steps' tabs across
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
REG = GO.replace("S.tdsDedView = 'table'", "S.tdsDedView = ''; S.tdsWinCh = ''; S.tdsDedReg = 'pending'")
WIN = GO.replace("S.tdsDedView = 'table'", "S.tdsDedView = ''; S.tdsWinCh = ''; S.tdsDedReg = ''")
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
        print("3. the Deductions register (next-tds-register: it replaces the to-do list of round 'next-tds-allchallans')")
        pg.set_viewport_size({"width": 1440, "height": 900})
        J(CHALLANS)
        # PANs for all but ZZ Contractor 1 (companies for 194C at 2%, persons for 194J)
        J("""() => { const ps = Array.from(new Set(TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').map(r => r.party))); let i = 0;
          ps.forEach(p => { if (p === 'ZZ Contractor 1') return; i++; const c = /Contractor/.test(p) ? 'C' : 'P'; tdsDeducteeSet(p, {pan: 'AAA' + c + 'Z' + String(1000 + i) + 'K', name: ''}); }); render(); }""")
        J(REG); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-dreg]").count() == 1 and pg.locator("#app [data-ded-todo]").count() == 0, "Deductions N opens the register; no to-do list")
        def state():
            return J("""() => { const out = {}; document.querySelectorAll('[data-dreg-tab]').forEach(b => { out[b.dataset.dregTab] = +b.dataset.dregN; }); return out; }""")
        def rows_of(tab):
            J("(t) => { S.tdsDedReg = t; render(); }", tab); pg.wait_for_timeout(300)
            return J("(t) => [...document.querySelectorAll('[data-dreg-body=\"' + t + '\"] tr[data-dreg-row]')].map(tr => tr.dataset.dregRow)", tab)
        st = state(); qrows = J("() => TDS.formRows('26Q').filter(r => r.fy === '2026-27' && r.q === 'Q1').map(r => r.id).sort()")
        pend, mapd = rows_of("pending"), rows_of("mapped")
        ok(sorted(pend + mapd) == qrows and not set(pend) & set(mapd), "each deduction in exactly one tab (%d + %d of %d)" % (len(pend), len(mapd), len(qrows)))
        ok(st == {"pending": len(pend), "mapped": len(mapd)}, "each tab's count is its rows (%s)" % st)
        J("() => { S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(300)
        one = J("""() => [...document.querySelectorAll('[data-dreg-body="pending"] tr[data-dreg-row]')].map(t => [t.dataset.dregRow, t.querySelectorAll('[data-dreg-confirm]').length, t.querySelectorAll('[data-dreg-put]').length, /Needs a challan|No TDS to pay/.test(t.querySelector('.dreg-next').innerText)])""")
        ok(one and all((x[1] == 1 and x[2] == 0) or (x[1] == 0 and 1 <= x[2] <= 3) or (x[1] == 0 and x[2] == 0 and x[3]) for x in one), "each pending row has one next step: Confirm, the best 1 to 3 challans (one click each), or Needs a challan (%s)" % [x for x in one if not ((x[1] == 1 and x[2] == 0) or (x[1] == 0 and 1 <= x[2] <= 3) or x[3])][:3])
        prim = J("[...document.querySelectorAll('#app .btn.primary')].filter(b => b.offsetParent).map(b => b.innerText.trim())")
        ok(len(prim) == 1 and prim[0].startswith("Confirm all"), "the register's one filled button: Confirm all (%s)" % prim)
        def contrast(theme):
            return J("""(theme) => { document.documentElement.dataset.theme = theme;
              const L = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return [0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]), m[3] == null ? 1 : m[3]]; };
              const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; const m = b.match(/[\\d.]+/g); if (m && (m[3] == null || +m[3] > 0.5)) return b; } return getComputedStyle(document.body).backgroundColor; };
              const out = []; document.querySelectorAll('[data-dreg] .dreg-tab, [data-dreg] .dt-flag, [data-dreg] .dreg-how, [data-dreg] .dreg-chk, [data-dreg] .dreg-next .tag, [data-dreg] td').forEach(e => {
                if (!e.getClientRects().length) return; const s = getComputedStyle(e), a = L(s.color)[0], b = L(bgOf(e))[0], r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                out.push([e.className || e.tagName, Math.round(r * 100) / 100, +s.opacity]); });
              return out; }""", theme)
        for tab in ("pending", "mapped"):
            J("(t) => { S.tdsDedReg = t; render(); }", tab); pg.wait_for_timeout(300)
            for theme in ("light", "dark"):
                cs = contrast(theme); low = [c for c in cs if c[1] < 4.5 or c[2] < 1]
                ok(cs and not low, "%s %s: tabs, chips and cells at least 4.5:1, none faded (%d checked; low: %s)" % (tab, theme, len(cs), low[:4]))
                pg.screenshot(path=os.path.join(SHOTS, "register-%s-%s-1440.png" % (tab, theme)))
        J("() => { document.documentElement.dataset.theme = 'light'; S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(300)
        cut = J("() => [...document.querySelectorAll('[data-dreg] td')].filter(e => e.getBoundingClientRect().right > e.closest('[data-dreg]').getBoundingClientRect().right + 1 && e.closest('.bk-tablewrap').scrollWidth <= e.closest('.bk-tablewrap').clientWidth).length")
        ok(cut == 0, "1440: every cell inside the register, nothing cut off (%d cut)" % cut)
        rid = J("() => (document.querySelector('[data-dreg-confirm]') || {dataset: {}}).dataset.dregConfirm || ''")
        pg.click('[data-dreg-confirm="%s"]' % rid); pg.wait_for_timeout(500)
        ok(J("(id) => !!S.books.alloc[id]", rid) and rid not in rows_of("pending") and rid in rows_of("mapped"), "Confirm: on its challan at once, the row now Mapped")
        how = J("(id) => { const e = document.querySelector('[data-dreg-row=\"' + id + '\"] [data-dreg-how]'); return e ? [e.dataset.dregHow, e.innerText.trim()] : null; }", rid)
        ok(how and how[0] == "rule", "… placed by a rule, by its short name (%s)" % how)
        J("() => { S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(300)
        nconf = J("() => document.querySelectorAll('[data-dreg-confirm]').length"); before = state()
        pg.click("[data-dreg-confirm-all]"); pg.wait_for_timeout(700)
        after = state()
        ok(J("() => document.querySelectorAll('[data-dreg-confirm]').length") == 0 and after["mapped"] - before["mapped"] == nconf and before["pending"] - after["pending"] == nconf, "Confirm all %d: off Pending, on Mapped at once (%s → %s)" % (nconf, before, after))
        J("() => { S.tdsDedReg = 'mapped'; render(); }"); pg.wait_for_timeout(300)
        fx = J("() => { const t = [...document.querySelectorAll('[data-dreg-body=\"mapped\"] tr[data-dreg-row]')].find(tr => /ZZ Contractor 1\\b/.test(tr.innerText)); const f = t && t.querySelector('[data-dreg-flag=pan]'); return f ? [f.innerText.trim(), f.title] : null; }")
        ok(fx == ["No PAN", "no PAN"], "Mapped: ZZ Contractor 1's chip “No PAN”, its words on a hover (%s)" % fx)
        # no challan at all: every deduction Pending, each “Needs a challan”
        J("() => { S.books.challans = []; S.books.alloc = {}; S.books.allocFrom = {}; S.books.matchNo = {}; S.books.tdsSplits = {}; TDSReg.forget && TDSReg.forget(); S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(800)
        nd = J("() => [...document.querySelectorAll('[data-dreg-body=\"pending\"] tr[data-dreg-row] .dreg-next')].map(e => e.innerText.trim())")
        ok(nd and all(x in ("Needs a challan", "No TDS to pay") for x in nd) and len(nd) == len(qrows), "no challan: every deduction Pending, “Needs a challan” (%d)" % len(nd))
        ok(J("() => !!document.querySelector('#app [data-wd-nochallan]')"), "the step says there is no challan yet")
        pg.screenshot(path=os.path.join(SHOTS, "register-nochallan-1440.png"))
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391, "phone: no sideways scroll (%s)" % J("document.documentElement.scrollWidth"))
        pg.screenshot(path=os.path.join(SHOTS, "register-390.png"))
        J("() => { S.tdsDedReg = ''; render(); }"); J(CHALLANS); pg.wait_for_timeout(600)
        print("4. Deductions by challan, as Winman (round 88)")
        pg.set_viewport_size({"width": 1440, "height": 900}); J(CHALLANS); J("() => tdsMatchConfirmAll()"); pg.wait_for_timeout(500)
        J(WIN); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-wd]").count() == 1 and pg.locator("#app [data-ded-todo]").count() == 0 and pg.locator("#tdsDnTable").count() == 0 and pg.locator("#app [data-dd-side]").count() == 0,
           "the step opens on a challan: one selector, one table, no to-do list, no side panel")
        opts = J("[...document.querySelectorAll('#app select[data-wd-sel] option')].map(o => [o.value, o.textContent])")
        chs = J("() => { const n = TDS.challans().length; return [...document.querySelectorAll('#app select[data-wd-sel] option')].filter(o => o.value !== '__none').map(o => o.value); }")
        un = J("() => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && r.tds > 0.005).length")
        ok(len(chs) >= 3 and all(re.match(r"^%d · \d\d-\w{3}-\d{4} · ₹[\d,.]+$" % (i + 1), o[1]) for i, o in enumerate(opts[:len(chs)])), "the dropdown: one line a challan, “no · date · total” (%s)" % [o[1] for o in opts[:3]])
        ok(un > 0 and "__none" not in [o[0] for o in opts] and pg.locator("#app [data-dreg-open]").count() == 1, "the dropdown has no 'Not on any challan': the %d are in the register (Deductions N) (%s)" % (un, opts[-1]))
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
        ok(pg.locator("#app [data-wd-unplaced]").count() == 0, "no 'N not on a challan' line under the dropdown")
        help_lines = J("[...document.querySelectorAll('#app [data-wd] p.note, #app [data-wd] .wd-help')].filter(e => e.offsetParent).length")
        ok(help_lines <= 1, "at most one line of help (%d)" % help_lines)
        pg.click("#app [data-dreg-open]"); pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-dreg]").count() == 1 and J("() => +document.querySelector('[data-dreg-tab=\"pending\"]').dataset.dregN") == un, "Deductions N: the register, Pending %d" % un)
        pg.screenshot(path=os.path.join(SHOTS, "winman-deductions-register-1440.png"))
        J("() => { S.tdsDedReg = ''; render(); }"); pg.wait_for_timeout(300)
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
        J("() => { S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(500)
        ok(J("document.documentElement.scrollWidth") <= 391, "phone, the register: no sideways scroll")
        pg.screenshot(path=os.path.join(SHOTS, "winman-deductions-register-390.png"))
        J("() => { S.tdsDedReg = ''; render(); }"); pg.wait_for_timeout(300)
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
