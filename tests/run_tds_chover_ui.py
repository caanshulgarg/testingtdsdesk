"""python3 run_tds_chover_ui.py - where a challan is used, by name, and never over-used (next-fix-challan-over; the owner,
24-Oct-2026, Leads Insurance, Form 140 2026-27 Q1 › Deductions: "Select challan: 4 · 30-Apr-2026 · ₹2,567.00 … Used here
₹0.00 · Amount utilised (all returns) ₹4,775.78 · Balance ₹-2,208.78: showing negative balance and we have not utilised it
anywhere"). The owner's books made up: challan 60606 of 30-Apr-2026, ₹2,567 (194J), used by 26Q 2025-26 Q4 (March's TDS):
₹2,275.78 from Tally and a ₹2,500 deduction typed in FinCom, ₹2,208.78 over.
  1. Form 140 2026-27 Q1 › Deductions: the option says "(used in 26Q 2025-26 Q4)" (it stays pickable: a 30-April challan
     is the quarter's own by date); the footer "Also used in 26Q 2025-26 Q4: ₹4,775.78 · Open" (no "Amount utilised (all
     returns)"); one red line "Over-used by ₹2,208.78 in 26Q 2025-26 Q4 — take a deduction off or add a challan · Open"
  2. Challans of Q1: "Used in all returns" names 26Q 2025-26 Q4 (title and a click) and the red line
  3. Open: 26Q 2025-26 Q4 › Deductions with challan 60606 chosen, its two deductions; Validate & file: the error
  4. Add a deduction (the hand-add form) on challan 60606 with ₹291.22 left: refused in words, nothing kept
  5. 390 wide: no sideways scroll; the screenshots (1440, 390) to TDS_CHOVER_SHOTS (default tests/out/tds-chover)."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_CHOVER_PORT") or 8367)
SHOTS = os.environ.get("TDS_CHOVER_SHOTS") or os.path.join(HERE, "out", "tds-chover"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

BOOKS_JS = r"""(over) => {
  const V = [
    {id: "v456c", date: "20260101", type: "Journal", no: "J-456C", party: "Animall Technologies", ent: [{l: "Professional Fees", a: -113789}, {l: "Animall Technologies", a: 111513.22}, {l: "TDS 94J 2%", a: 2275.78}]},
    {id: "v501", date: "20260505", type: "Journal", no: "J-501", party: "ZZ Consultant", ent: [{l: "Professional Fees", a: -10000}, {l: "ZZ Consultant", a: 9000}, {l: "TDS 94J 2%", a: 1000}]}];
  const c = newCompany({name: "ZZ LEADS INSURANCE", gstin: "07AACCL1234M1Z5"}); c.tan = "DELL12345A"; c.pan = "AACCL1234M";
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const ch = (id, serial, date, tax) => ({id, bsr: "1234567", serial, date, tax, interest: 0, fee: 0, others: 0, section: "194J", minorHead: "200"});
  S.books = {cid: c.id, loading: false, vouchers: V, challans: [ch("chmvd92j2nq35qd", "60606", "20260430", 2567), ch("chq1", "60707", "20260607", 1000)],
    alloc: {"v456c|TDS 94J 2%": "chmvd92j2nq35qd"}, allocFrom: {}, chPortions: {}, matchNo: {}, tdsSplits: {}, allocLog: [], meta: {from: "20260101", to: "20260630"},
    pans: {"Animall Technologies": "AAICA1234B", "Garg Shekhar & Company": "AAFFG1234C", "ZZ Consultant": "ABCPZ1234C"}, tdsAdded: {}};
  if (over){ S.books.tdsAdded = {mvkzxln6ag1e: {party: "Garg Shekhar & Company", section: "194J", date: "20260331", credit: "", paid: 25000, tds: 2500, rate: 10, by: "test@test.com", at: "2026-10-23T13:19:00Z", log: [{act: "add"}]}};
    S.books.alloc["fc:mvkzxln6ag1e"] = "chmvd92j2nq35qd"; }
  S.books.map = Books.mapLedgers(V, {}); S.books.map["TDS 94J 2%"] = {kind: "tds_payable", section: "194J"}; try { LedMaster.refresh(S.books); } catch (e) {}
  window.__bk = S.books; TDSReg.forget(); return V.length;
}"""
RET = "([fy, q, tab, ch]) => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = fy; S.tdsQ = q; S.tdsForm = '26Q'; S.tdsPickForm = '26Q'; S.tdsTab = tab; S.tdsDedView = ''; S.tdsDedReg = ''; S.tdsWinCh = ch || ''; S.tdsWinRet = ''; S.tdsAdd = null; render(); }"
CH = "chmvd92j2nq35qd"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        J("() => { if (typeof TDSMatch === 'object') TDSMatch.online = () => false; }")
        J(BOOKS_JS, True); J(RET, ["2026-27", "Q1", "deductions", CH]); pg.wait_for_timeout(1500)
        ok(abs(J("() => TDSReg.balance(TDS.challans()[0]).tax") + 2208.78) < 0.005, "the owner's books: challan 60606 balance ₹-2,208.78")

        print("1. Form 140 2026-27 Q1 › Deductions")
        opt = J("(id) => { const o = [...document.querySelectorAll('#app [data-wd-sel] option')].find(o => o.value === id); return o ? o.textContent : null; }", CH)
        ok(opt and opt.endswith("(used in 26Q 2025-26 Q4)") and "30-Apr-2026" in opt, "the option names where it is used: %s" % opt)
        other = J("() => [...document.querySelectorAll('#app [data-wd-sel] option')].map(o => o.textContent).find(t => /60707|07-Jun-2026/.test(t)) || ''")
        ok("used in" not in other, "a challan only this quarter uses says nothing more (%s)" % other)
        foot = J("(id) => { const f = document.querySelector('#app [data-wd-foot=\"' + id + '\"]'); return f ? f.innerText.replace(/\\s+/g, ' ') : ''; }", CH)
        ok("Also used in 26Q 2025-26 Q4: ₹4,775.78 · Open" in foot and "Amount utilised" not in foot and "Used here ₹0.00" in foot, "the footer names the return: %s" % foot)
        line = J("() => { const e = document.querySelector('#app [data-wd-over]'); return e ? {t: e.innerText.replace(/\\s+/g, ' '), c: getComputedStyle(e).color, n: document.querySelectorAll('#app [data-wd-over]').length} : null; }")
        ok(line and line["n"] == 1 and line["t"].startswith("Over-used by ₹2,208.78 in 26Q 2025-26 Q4 — take a deduction off or add a challan") and line["t"].endswith("· Open"), "one red line: %s" % (line and line["t"]))
        ok(line and line["c"] not in ("rgb(0, 0, 0)",) and J("() => { const e = document.querySelector('#app [data-wd-over]'), b = document.querySelector('#app [data-wd-bal]'); return getComputedStyle(e).color === getComputedStyle(b).color; }"), "the line red, as the balance below nil (%s)" % (line and line["c"]))
        pg.locator("#app [data-wd-foot]").scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(SHOTS, "q1-footer-1440.png"))

        print("2. Challans of Q1")
        J(RET, ["2026-27", "Q1", "challans", ""]); pg.wait_for_timeout(1000)
        cell = J("(id) => { const tr = document.querySelector('#app [data-chg-row=\"' + id + '\"]'), td = tr && tr.querySelector('[data-chg-all]'); return td ? {t: td.innerText.replace(/\\s+/g, ' '), title: td.title} : null; }", CH)
        ok(cell and "₹4,775.78" in cell["t"] and cell["t"].replace(" ", "").endswith("26Q2025-26Q4") and cell["title"] == "Used here ₹0.00 · 26Q 2025-26 Q4 ₹4,775.78", "Used in all returns: the amount and where (%s)" % cell)
        gl = J("(id) => { const e = document.querySelector('#app [data-chg-over=\"' + id + '\"]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; }", CH)
        ok(gl.startswith("Challan 60606: over-used by ₹2,208.78 in 26Q 2025-26 Q4 — take a deduction off or add a challan · Open"), "the grid's red line: %s" % gl)
        ok(J("(id) => { const e = document.querySelector('#app [data-chg-over=\"' + id + '\"]'), b = document.querySelector('#app [data-chg-bal].bad'); return !!b && getComputedStyle(e).color === getComputedStyle(b).color; }", CH), "the grid's line red, as the balance below nil")
        ok(J("(id) => { const i = document.querySelector('#app [data-chg-oth=\"' + id + '\"]'); return !!i && !/object/.test(i.value); }", CH), "the row's Others allocated box untouched (no [object Object])")
        pg.screenshot(path=os.path.join(SHOTS, "q1-challans-1440.png"))
        pg.click('#app [data-chg-row="%s"] [data-chg-also]' % CH); pg.wait_for_timeout(1000)
        ok(J("() => [S.tdsFy, S.tdsQ, S.tdsForm, S.tdsTab, S.tdsWinCh].join('|')") == "2025-26|Q4|26Q|deductions|" + CH, "the cell's click opens 26Q 2025-26 Q4 › Deductions on challan 60606 (%s)" % J("() => [S.tdsFy, S.tdsQ, S.tdsForm, S.tdsTab, S.tdsWinCh].join('|')"))

        print("3. Open from the footer: 26Q 2025-26 Q4")
        J(RET, ["2026-27", "Q1", "deductions", CH]); pg.wait_for_timeout(800)
        pg.click("#app [data-wd-also-open]"); pg.wait_for_timeout(1200)
        st = J("() => [S.tdsFy, S.tdsQ, S.tdsForm, S.tdsTab].join('|')")
        sel = J("() => (document.querySelector('#app [data-wd-sel]') || {}).value || ''")
        rows = J("(id) => [...document.querySelectorAll('#app [data-wd-table=\"' + id + '\"] tr[data-wd-row]')].map(tr => tr.dataset.wdRow)", CH)
        ok(st == "2025-26|Q4|26Q|deductions" and sel == CH and sorted(rows) == sorted(["fc:mvkzxln6ag1e", "v456c|TDS 94J 2%"]), "Open: %s, challan %s chosen, its two deductions (%s)" % (st, sel, rows))
        f4 = J("(id) => { const f = document.querySelector('#app [data-wd-foot=\"' + id + '\"]'); return f ? f.innerText.replace(/\\s+/g, ' ') : ''; }", CH)
        ok("Used here ₹4,775.78" in f4 and "Over-used by ₹2,208.78 in this return — take a deduction off or add a challan" in f4 and "Also used" not in f4, "there: Used here ₹4,775.78 and the red line says this return (%s)" % f4)
        pg.screenshot(path=os.path.join(SHOTS, "q4-footer-1440.png"))
        J(RET, ["2025-26", "Q4", "file", ""]); pg.wait_for_timeout(1200)
        ve = J("() => { const e = document.querySelector('#app [data-val-item=\"over\"]'); return e ? {lvl: e.dataset.valLevel, t: e.innerText.replace(/\\s+/g, ' ')} : null; }")
        ok(ve and ve["lvl"] == "error" and "60606 is used ₹2,208.78 beyond its tax" in ve["t"], "Validate & file of 26Q 2025-26 Q4: an error (%s)" % ve)
        ok(int(J("() => +(document.querySelector('#app [data-val-errors]') || {dataset: {valErrors: 0}}).dataset.valErrors") or 0) >= 1, "it counts among the errors that block the file")
        J(RET, ["2026-27", "Q1", "file", ""]); pg.wait_for_timeout(1000)
        ok(J("() => !document.querySelector('#app [data-val-item=\"over\"]')"), "not an error of Form 140 2026-27 Q1, which does not use it")

        print("4. the hand-add form on a challan with ₹291.22 left")
        J(BOOKS_JS, False); J(RET, ["2025-26", "Q4", "deductions", CH]); pg.wait_for_timeout(1000)
        J("(id) => { S.tdsAdd = {chId: id}; render(); }", CH); pg.wait_for_timeout(700)
        d = pg.locator("[data-add-deduction]")
        d.locator('input[aria-label="Deductee"]').fill("Garg Shekhar & Company")
        d.locator('select[aria-label="Section"]').select_option("194J")
        d.locator('input[aria-label="Paid or credited on"]').fill("2026-03-31")
        d.locator('input[aria-label="Amount paid or credited"]').fill("25000")
        d.locator('input[aria-label="Rate"]').fill("10")
        pg.wait_for_timeout(200)
        ok(d.locator('select[aria-label="Challan"]').input_value() == CH, "the form opens on challan 60606")
        d.locator("[data-add-save]").click(); pg.wait_for_timeout(600)
        err = J("() => (document.querySelector('[data-add-err]') || {}).innerText || ''")
        ok(err.startswith("Challan 60606 has ₹291.22 left; this deduction's TDS is ₹2,500.00"), "refused in words: %s" % err)
        ok(J("() => Object.keys(S.books.tdsAdded || {}).length") == 0 and abs(J("() => { TDSReg.forget(); return TDSReg.balance(TDS.challans()[0]).tax; }") - 291.22) < 0.005, "nothing kept: the challan still has ₹291.22 left")
        pg.screenshot(path=os.path.join(SHOTS, "add-refused-1440.png"))

        print("5. phone")
        J(BOOKS_JS, True); pg.set_viewport_size({"width": 390, "height": 844}); J(RET, ["2026-27", "Q1", "deductions", CH]); pg.wait_for_timeout(1200)
        ok(J("() => document.documentElement.scrollWidth - innerWidth") <= 1, "390: no sideways scroll")
        l3 = J("() => { const e = document.querySelector('#app [data-wd-over]'); if (!e) return null; const r = e.getBoundingClientRect(); return {l: r.left, r: r.right}; }")
        ok(l3 and l3["l"] >= 0 and l3["r"] <= 390, "390: the red line within the screen (%s)" % l3)
        pg.locator("#app [data-wd-foot]").scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(SHOTS, "q1-footer-390.png"))
        J(RET, ["2026-27", "Q1", "challans", ""]); pg.wait_for_timeout(1000)
        pg.locator('#app [data-chg-over]').scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(SHOTS, "q1-challans-390.png"))
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
