"""python3 run_tds_autoplace_ui.py - "Place automatically" and the remarks B, T, Y on the return's screens (next-tds-autoplace,
the owner's approval of 23-Oct-2026: "Don't change the layout.. just tweak"). On the made-up books of run_tds_challans.py
(26Q Q1 of tax year 2026-27):
  A. the Deductions step's header has "Place automatically"; one click places what is certain (R1 Tally's bill-wise link,
     R2 a month's total = its challan) and leaves one line: "20 placed · 10 suggested · 2 need a challan" with Undo; Undo
     restores the allocation exactly; nothing new opens by itself; the button is not there on a return marked filed
  B. the Deductions register: How placed says the rule (R1 / R2) and its reason on a hover, and its column filter picks a
     rule; Pending's Next says the suggestion's rule (R6) and filters by it; "Select all shown" and "Place on challan…"
  C. Deductees › a deductee: the transporter's declaration and Form 121 (2026-27; 15G/15H before) (date, UIN) kept with the books; Validate &
     file says what is wrong with a remark (B without its declaration, T without a PAN)
  D. 10,000 deductions: the click to the result line, timed
Runs on the React build: app/dist-test, or TDSDESK_SITE. AUTOPLACE_SHOTS=dir: the screenshots (Deductions step and the
Deductees editor at 1440 and 390 wide)."""
import os, sys, re, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_AUTOPLACE_PORT") or 8291)
SHOTS = os.environ.get("AUTOPLACE_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
GO = "(tab) => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = tab; S.tdsDedView = ''; S.tdsDedReg = ''; S.tdsDee = ''; render(); }"
ADD = """([id, bsr, date, serial, tax, section, extra]) => { const c = Object.assign({id, bsr, date, serial, tax, interest: 0, section, minorHead: "200"}, extra || {});
  S.books.challans = (S.books.challans || []).concat([c]); TDSReg.forget(); return c.id; }"""

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=False)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e))); cons = []; pg.on("console", lambda m: cons.append(m.text[:400]) if m.type == "error" else None)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        J = lambda expr, arg=None: pg.evaluate(expr, arg)
        J(BOOKS_JS); pg.wait_for_timeout(800)
        J(ADD, ["chA", "0240020", "20260507", "00101", 8640, "194C"])
        J(ADD, ["chJ", "0240020", "20260507", "00102", 12345, "194J"])
        J(ADD, ["chM", "0240020", "20260607", "00103", 7500, "194C"])
        J(ADD, ["chT", "0240020", "20260606", "00104", 10000, "194J", {"fromVoucher": "pay194jMay"}])
        J(ADD, ["chJ2", "0240020", "20260607", "00105", 1500, "194J"])
        J(GO, "deductions"); pg.wait_for_timeout(900)

        # ---------------- A. Place automatically
        btn = pg.locator("[data-wd] [data-ap-run]")
        ok(btn.count() == 1 and btn.inner_text().strip() == "Place automatically", "A. the Deductions step's header has \"Place automatically\"")
        ok(pg.locator(".wd-top [data-ap-run]").count() == 1, "A. in the existing header row (.wd-top), no new panel")
        before = J("() => JSON.stringify(S.books.alloc)")
        t0 = time.time(); btn.click(); pg.wait_for_selector("[data-ap-result]", timeout=10000); dt = time.time() - t0
        line = pg.locator("[data-ap-result]").inner_text().strip()
        ok(re.match(r"^20 placed · 10 suggested · 2 need a challan · Undo", line), "A. one line: %s (%.2f s)" % (line, dt))
        alloc = J("() => S.books.alloc")
        ok(sum(1 for v in alloc.values() if v == "chA") == 8 and sum(1 for v in alloc.values() if v == "chJ") == 8 and sum(1 for v in alloc.values() if v == "chT") == 4 and not any(v in ("chM", "chJ2") for v in alloc.values()),
           "A. placed: April's 194C on chA (R2), April's 194J on chJ (R2), May's bill-wise 194J on chT (R1); chM and chJ2 only suggested")
        ok(J("() => !S.tdsDedReg && !document.querySelector('[data-dreg]')"), "A. nothing opens by itself")
        shot(pg, "deductions-1440")
        pg.click("[data-ap-undo]"); pg.wait_for_timeout(500)
        ok(J("() => JSON.stringify(S.books.alloc)") == before and pg.locator("[data-ap-result]").count() == 0, "A. Undo: the allocation exactly as before (%s)" % J("() => JSON.stringify(S.books.alloc)"))
        btn.click(); pg.wait_for_selector("[data-ap-result]")
        ok(len([v for v in J("() => S.books.alloc").values()]) == 20, "A. placed again")

        # ---------------- B. the register: How placed, the rule filters, Select all shown, Place on challan…
        pg.click("[data-dreg-open]"); pg.wait_for_timeout(500)
        pg.click('[data-dreg-tab="mapped"]'); pg.wait_for_timeout(400)
        hows = J("() => { const by = {}; document.querySelectorAll('[data-dreg-body=\"mapped\"] [data-dreg-how]').forEach(e => { by[e.textContent] = (by[e.textContent] || 0) + 1; }); return by; }")
        ok(hows == {"R2 · Same amount": 16, "R1 · Tally link": 4}, "B. How placed says the rule: %s" % hows)
        shot(pg, "register-mapped-1440")
        tip = J("() => document.querySelector('[data-dreg-body=\"mapped\"] [data-dreg-how]').title")
        ok(re.search(r"^R\d .+ · .+Place automatically", tip or ""), "B. its reason on a hover: %s" % tip)
        # the How placed column's filter: pick R1 only
        pg.click('button[data-cf="dreg-m:how"]'); pg.wait_for_timeout(300)
        opts = J("() => [...document.querySelectorAll('[data-cf-pop] label.cp-item span')].map(l => l.textContent.trim())")
        ok(any(o.startswith("R1 · Tally link") for o in opts) and any(o.startswith("R2 · Same amount") for o in opts), "B. the How placed filter lists the rules: %s" % opts)
        pg.click('[data-cf-pop="dreg-m:how"] input[data-cf-v="R1 · Tally link"]'); pg.wait_for_timeout(300)
        shown = J("() => document.querySelectorAll('[data-dreg-body=\"mapped\"] tbody tr[data-dreg-row]').length")
        ok(shown == 4, "B. filtered to R1: %d rows" % shown)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        J("() => { S.tdsCF = {}; render(); }"); pg.wait_for_timeout(200)
        pg.click('[data-dreg-tab="pending"]'); pg.wait_for_timeout(400)
        rules = J("() => [...document.querySelectorAll('[data-dreg-body=\"pending\"] [data-dreg-rule]')].map(e => e.dataset.dregRule + '|' + e.textContent.trim())")
        shot(pg, "register-pending-1440")
        ok(len(rules) == 10 and sum(1 for r in rules if r.startswith("R6|R6 · 00")) == 9 and sum(1 for r in rules if r.startswith("R8|R8 · 00103")) == 1, "B. Pending: each suggestion with its rule (9 R6: May on its challans; 1 R8: a June deduction on May's challan's ₹500 left, an advance challan): %s" % sorted(set(rules)))
        pg.click('button[data-cf="dreg-p:next"]'); pg.wait_for_timeout(300)
        opts = J("() => [...document.querySelectorAll('[data-cf-pop] label.cp-item span')].map(l => l.textContent.trim())")
        ok("Suggested · R6" in opts and "Suggested · R8" in opts, "B. Next's filter by rule: %s" % opts)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        # a challan for June, then June's two placed by hand from the list: Select all shown, Place on challan…
        J(ADD, ["chJun", "0240020", "20260707", "00106", 1000, "194C"]); J("() => render()"); pg.wait_for_timeout(300)
        J("() => { S.tdsCF = Object.assign({}, S.tdsCF, {'dreg-p': {date: ['202606']}}); render(); }"); pg.wait_for_timeout(300)
        n_shown = J("() => document.querySelectorAll('[data-dreg-body=\"pending\"] tbody tr[data-dreg-row]').length")
        sel_all = pg.locator('[data-dreg-body="pending"] [data-dreg-tickall]')
        ok(sel_all.get_attribute("aria-label") == "Select all shown", "B. \"Select all shown\" on the list's header")
        sel_all.check(); pg.wait_for_timeout(300)
        ok(pg.locator("[data-dreg-bulk]").count() == 1 and J("() => Object.keys(S.tdsDregSel || {}).length") == n_shown, "B. all %d shown ticked" % n_shown)
        ok(J("() => document.querySelector('[data-dreg-bulk] select[data-dreg-to] option').textContent") == "Place on challan…", "B. \"Place on challan…\" beside them")
        pg.select_option("[data-dreg-bulk] select[data-dreg-to]", "chJun"); pg.wait_for_timeout(200)
        pg.click("[data-dreg-bulk-map]"); pg.wait_for_timeout(500)
        ok(sum(1 for v in J("() => S.books.alloc").values() if v == "chJun") == 2, "B. the June 194C deductions placed on challan chJun")
        pg.keyboard.press("Escape"); J("() => { S.tdsDedReg = ''; S.tdsCF = {}; render(); }"); pg.wait_for_timeout(300)

        # ---------------- C. the deductee's declarations; Validate & file
        J(GO, "deductees"); pg.wait_for_timeout(600)
        party = J("() => TDSPanFix.list('26Q', '2026-27', 'Q1').find(p => p.secs.some(s => /194C/.test(s))).party")
        J("(k) => { S.tdsDee = 'k:' + TDSPanFix.list('26Q', '2026-27', 'Q1').find(p => p.party === k).key; render(); }", party); pg.wait_for_timeout(500)
        ok(pg.locator("[data-dee-decl]").count() == 1 and pg.locator("[data-dee-transporter]").count() == 1, "C. the deductee's editor: Declarations for FY 2026-27 with the transporter's tick (194C)")
        pg.check("[data-dee-transporter]"); pg.wait_for_timeout(300)
        ok(J("(k) => !!TDSDecl.of(k, '2026-27').t", party), "C. the transporter's declaration kept with the books")
        pg.select_option("[data-dee-bform]", "121"); pg.fill("[data-dee-bdate]", "2026-04-15"); pg.fill("[data-dee-buin]", "abcde12345f1234567890123"); pg.wait_for_timeout(200)
        shot(pg, "deductees-editor-1440")
        pg.click("[data-dee-bsave]"); pg.wait_for_timeout(300)
        d = J("(k) => TDSDecl.of(k, '2026-27').b", party)
        ok(d and d["form"] == "121" and d["date"] == "20260415" and d["uin"] == "ABCDE12345F1234567890123", "C. Form 121 (2026-27's declaration, next-tds-excel) with its date and UIN kept: %s" % d)
        # a nil row for this deductee: its remark B (the declaration first), its UIN 24 characters: Validate says it
        J("(k) => TDSAdd.save({party: k, section: '194C', date: '20260615', credit: '20260615', paid: 25000, rate: 0, tds: 0})", party)
        J(GO, "file"); pg.wait_for_timeout(700)
        it = pg.locator('[data-val-item="rm-b-uin"]')
        # next-tds-validate-short: the optional UIN is a suggestion (under Suggestions), not an error
        ok(it.count() == 1 and "UIN" in it.text_content() and it.get_attribute("data-val-level") == "info" and pg.locator('[data-val-item="rm-b-decl"]').count() == 0, "C. Validate & file: the Form 121 UIN missing is a suggestion, not an error: %s" % (it.text_content() if it.count() else "none"))
        J("(k) => TDSDecl.set(k, '2026-27', {form: ''})", party); J("() => render()"); pg.wait_for_timeout(400)
        # next-tds-validate-short: a wrong remark leaves that row out of the file (said, with why), never a blocker
        it = pg.locator('[data-val-item="leftout"]')
        J("() => { S.tdsFix = 'leftout'; S.tdsFixAt = '2026-27|Q1|26Q'; render(); }"); pg.wait_for_timeout(300)
        dw = pg.locator('[data-val-drawer="leftout"]')
        dtx = dw.inner_text() if dw.count() else ""
        J("() => { S.tdsFix = ''; render(); }"); pg.wait_for_timeout(200)
        ok(it.count() == 1 and it.get_attribute("data-val-level") == "warn" and party in dtx and "Remark T" in dtx, "C. Validate & file: remark T needs the PAN: the row left out of the file, said with why: %s" % dtx[:200])
        fb = J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
        ok(any(x["k"] == "remark" and x["party"] == party for x in (fb.get("leftOut") or [])), "C. the file leaves the row out while its remark is wrong (%s)" % (fb.get("error") or fb.get("leftOut")))

        # ---------------- the return marked filed: no button
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; }"); J(GO, "deductions"); pg.wait_for_timeout(500)
        was = J("() => JSON.stringify(S.books.alloc)")
        ok(pg.locator("[data-ap-run]").count() == 0, "A. a return marked filed: no \"Place automatically\"")
        J("() => tdsAutoPlace()"); pg.wait_for_timeout(300)
        ok(J("() => JSON.stringify(S.books.alloc)") == was, "A. and nothing placed if it is asked for")
        J("() => { S.books.tdsFiled = {}; }")

        # ---------------- phone, 390 wide: the same step and editor
        ph = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True); pp = ph.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)))
        pp.goto("http://localhost:%d/" % PORT); pp.wait_for_timeout(2500); pp.click('button[data-act="useOffline"]'); pp.wait_for_timeout(1200)
        pp.evaluate(BOOKS_JS); pp.wait_for_timeout(600)
        for a in [["chA", "0240020", "20260507", "00101", 8640, "194C"], ["chJ", "0240020", "20260507", "00102", 12345, "194J"], ["chM", "0240020", "20260607", "00103", 7500, "194C"],
                  ["chT", "0240020", "20260606", "00104", 10000, "194J", {"fromVoucher": "pay194jMay"}], ["chJ2", "0240020", "20260607", "00105", 1500, "194J"]]:
            pp.evaluate(ADD, a)
        pp.evaluate(GO, "deductions"); pp.wait_for_timeout(800)
        pp.click("[data-ap-run]"); pp.wait_for_selector("[data-ap-result]")
        ok(pp.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone: no sideways scroll on the Deductions step after the run")
        ok(pp.evaluate("() => { const r = document.querySelector('[data-ap-run]').getBoundingClientRect(), l = document.querySelector('[data-ap-result]').getBoundingClientRect(); return r.right <= innerWidth && l.right <= innerWidth + 1; }"), "phone: the button and the line within the screen")
        shot(pp, "deductions-390")
        pp.evaluate(GO, "deductees"); pp.wait_for_timeout(500)
        pp.evaluate("() => { const p = TDSPanFix.list('26Q', '2026-27', 'Q1').find(p => p.secs.some(s => /194C/.test(s))); S.tdsDee = 'k:' + p.key; render(); }"); pp.wait_for_timeout(500)
        pp.select_option("[data-dee-bform]", "121"); pp.wait_for_timeout(200)
        ok(pp.evaluate("() => { const f = document.querySelector('[data-dee-decl]').getBoundingClientRect(); return f.width > 0 && f.right <= innerWidth + 1; }"), "phone: the declarations fit the editor")
        shot(pp, "deductees-editor-390")
        ph.close()

        # ---------------- D. 10,000 deductions
        J("""() => { const V = []; for (let i = 0; i < 10000; i++){ const s = i % 2 ? '194C' : '194J', m = 4 + (i % 3), a = 1000 + (i % 97) * 10, party = 'Big Party ' + (i % 700), led = s === '194C' ? 'TDS 194C Payable' : 'TDS 194J Payable', exp = s === '194C' ? 'Contract Charges' : 'Professional Fees';
            V.push({id: 'w' + i, date: '2026' + String(m).padStart(2, '0') + String(1 + (i % 28)).padStart(2, '0'), type: 'Journal', no: 'W-' + i, party, ent: [{l: exp, a: -a * 50}, {l: party, a: a * 49}, {l: led, a}]}); }
          const b = S.books; b.vouchers = V; b.alloc = {}; b.allocLog = []; b.matchNo = {}; b.tdsAdded = {}; b.nrInfo = {}; b.challans = []; b.map = Books.mapLedgers(V, {});
          ['194C', '194J'].forEach(s => [4, 5, 6].forEach(m => { const t = V.filter(v => v.ent[2].l === 'TDS ' + s + ' Payable' && +v.date.slice(4, 6) === m).reduce((x, v) => x + v.ent[2].a, 0);
            b.challans.push({id: 'k' + s + m, bsr: '0240020', serial: String(200 + m * 2 + (s === '194C' ? 1 : 0)).padStart(5, '0'), date: '2026' + String(m + 1).padStart(2, '0') + '07', tax: t, interest: 0, section: s, minorHead: '200'}); }));
          window.__bk = b; TDSReg.forget(); S.tdsAp = null; render(); }""")
        t0 = time.time(); J(GO, "deductions"); pg.wait_for_selector("[data-ap-run]", timeout=60000); topen = time.time() - t0
        t0 = time.time(); pg.click("[data-ap-run]"); pg.wait_for_selector("[data-ap-result]", timeout=60000); tclick = time.time() - t0
        line = pg.locator("[data-ap-result]").inner_text().strip()
        ok(line.startswith("10000 placed · 0 suggested · 0 need a challan") and tclick < 15, "D. 10,000 deductions: %s, %.1f s from the click (the step opened in %.1f s)" % (line, tclick, topen))
        t0 = time.time(); pg.click("[data-ap-undo]"); pg.wait_for_function("() => !document.querySelector('[data-ap-result]')", timeout=60000); tundo = time.time() - t0
        ok(J("() => Object.keys(S.books.alloc).length") == 0 and tundo < 15, "D. Undo of 10,000: %.1f s" % tundo)
        ok(not errors, "no page errors: %s" % errors[:3])
        br.close()
finally:
    srv.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
