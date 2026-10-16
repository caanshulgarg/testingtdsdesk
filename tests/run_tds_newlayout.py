"""python3 run_tds_newlayout.py - the TDS page in the owner's new layout (branch tds-layout, approved 13/14-Oct-2026: "too many
tabs; salary, challans, 26AS and TRACES don't belong as top tabs"). On the fixture books (tests/fixtures/books, 2025-26, and
the same a year on, as tdsgst_snapshot.py loads them). Checks:
  1. the TDS page: no tabs at all (no Salary, Challans, 26AS or TRACES tab at the top), the four summary cards gone; the
     year's grid with its totals in the header row (each quarter's and the year's, which add up); the ledgers to confirm
     in one line ("N ledgers to confirm → Confirm"); beside the grid the year's challans: paid, used, unused balance, and
     the way to the register.
  2. a return opened from a cell: 26Q's five tabs (Deductions, Challans, To fix, Return file, After filing) and 24Q's six
     (with Employees & declarations, the old Salary tab's content), each reachable and showing its part; Deductions by
     deduction and by deductee; To fix said as what is wrong ("N without PAN · …"), each opening its own list; the Return
     file tab's slot for "Check before filing".
  3. the old addresses lead to the new places: …/challans[/Q] -> the challan register; …/26as -> the client's
     Reconciliations ("TDS receivable vs 26AS"), in the sidebar; …/traces -> a return's After filing; …/salary[/sub] ->
     24Q's Employees & declarations; …/checks/<x> and …/certs -> a return's To fix with that list; a return's old
     …/deductees, …/summary, …/employees, …/annex2 -> their tabs now.
  4. the floating message ("Working on this computer only…", any toast) never covers the page: beside the sidebar it
     sits in the sidebar's corner and overlaps nothing; with the sidebar folded and on a phone, in the bottom corner, small,
     and the page keeps room below its content so the last of it is never under the message.
Runs on the React build: app/dist-test, or TDSDESK_SITE. LAYOUT_SHOTS=dir: before/after screenshots."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_LAYOUT_PORT") or 8278)
SHOTS = os.environ.get("LAYOUT_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
INR = lambda s: float(re.sub(r"[₹,\s]", "", s) or 0)
# the message against everything on the page it might cover: visible controls, text and table cells in the page and the menu
OVERLAP = """() => { const t = document.getElementById('toast'); if (!t || t.classList.contains('hidden')) return {shown: false};
  const a = t.getBoundingClientRect(), hit = [];
  document.querySelectorAll('.mainwrap button, .mainwrap a, .mainwrap input, .mainwrap select, .mainwrap td, .mainwrap th, .mainwrap h1, .mainwrap h2, .mainwrap h3, .mainwrap p, .mainwrap li, .side .side-link, .side button').forEach((e) => {
    if (t.contains(e)) return; const st = getComputedStyle(e); if (st.visibility === 'hidden' || st.display === 'none') return;
    // what of it can be seen: its box cut by every box around it that scrolls or clips (a menu item scrolled out of the menu is not on screen)
    let r = e.getBoundingClientRect(), v = {left: r.left, right: r.right, top: r.top, bottom: r.bottom};
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(ps.overflow + ps.overflowY + ps.overflowX)) { const q = p.getBoundingClientRect();
      v = {left: Math.max(v.left, q.left), right: Math.min(v.right, q.right), top: Math.max(v.top, q.top), bottom: Math.min(v.bottom, q.bottom)}; } }
    if (v.right - v.left < 1 || v.bottom - v.top < 1) return;
    if (v.left < a.right && v.right > a.left && v.top < a.bottom && v.bottom > a.top) hit.push((e.tagName + ' ' + (e.textContent || '').trim()).slice(0, 50)); });
  return {shown: true, rect: [a.left, a.top, a.width, a.height], hit}; }"""
MSG = "Working on this computer only. Sign in later from Settings to share with the firm."

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
        pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        # the coordinator's screenshot review (14-Oct-2026): working on this computer only is a line at the sidebar's foot, not
        # a floating box
        ok(pg.evaluate("() => { const t = document.getElementById('toast'); return !t || t.classList.contains('hidden') || !/Working on this computer only/.test(t.textContent); }"), "0. no floating box for working on this computer only")
        # t70 (16-Oct-2026; the owner: "Side bar is also taking too much space"): the foot one small line, "Saved here · Sign in";
        # the full words (Saved on this computer only, Not shared · Sign in) under its ⓘ
        lo = pg.evaluate("() => { const l = document.querySelector('#side [data-side-foot]'), e = document.querySelector('#side [data-local-only]'), f = document.querySelector('#side [data-trust-line]'); return l && e && f && {line: l.innerText, h: Math.round(l.getBoundingClientRect().height), text: e.textContent, trust: f.textContent}; }")
        ok(lo and "Sign in" in lo["line"] and lo["h"] <= 22 and "Sign in" in lo["text"] and lo["trust"].startswith("Saved on this computer only"), "0. the sidebar's foot: one line with Sign in; under ⓘ Saved on this computer only, Not shared · Sign in (%s)" % lo)
        J = lambda e, a=None: pg.evaluate(e, a)
        fy = J("tdsYears(S.books, TDS.rows())[0]")
        J("(fy) => { S.booksTab = 'tds'; S.tdsFy = fy; S.tdsView = 'year'; S.tdsQ = ''; S.tdsPickForm = ''; render(); }", fy); pg.wait_for_timeout(500)
        # 1. the TDS page
        page = '[data-tds-page] '
        ok(pg.locator('[data-tds-sec]').count() == 0, "1. no tabs at the top of the TDS page")
        tops = [t.strip() for t in pg.locator(page + 'nav button').all_inner_texts()]
        ok(not any(t in ("Salary", "Challans", "26AS & AIS", "TRACES files", "Checks", "Returns") for t in tops), "1. no Salary, Challans, 26AS, TRACES or Checks tab (%s)" % tops)
        ok(pg.locator('[data-tds-answer]').count() == 0 and pg.locator(page + '.dtile').count() == 0, "1. the four summary cards are gone")
        ok(pg.locator('[data-tds-grid]').count() == 1, "1. the year's grid")
        qt = [INR(pg.locator('[data-q-total="%s"]' % q).inner_text()) for q in ["Q1", "Q2", "Q3", "Q4"]]
        yt = INR(pg.locator('[data-year-total]').inner_text())
        ok(yt > 0 and abs(sum(qt) - yt) < 1, "1. the year's totals in the header row: the quarters %s add up to the year %s" % (qt, yt))
        # the owner, 14-Oct-2026: "Where is the TDS return?": the grid titled as the returns, a line above it, each return a
        # clear button with its name, its status in words and colour, "Open →" on hover or focus; a cell with nothing in it
        # says "No entries" and is no button
        ok(pg.locator('[data-tds-grid] .rp-title h3').inner_text().strip() == "TDS returns · FY " + fy, "1. the grid's title: TDS returns · FY %s (%r)" % (fy, pg.locator('[data-tds-grid] .rp-title h3').inner_text()))
        hint = pg.locator('[data-tds-grid] [data-grid-hint]')
        ok(hint.count() == 1 and hint.inner_text().strip() == "Click a return to open it." and hint.bounding_box()["y"] < pg.locator('[data-tds-grid] table').bounding_box()["y"], "1. a line above the grid: Click a return to open it.")
        cl = pg.evaluate("""() => [...document.querySelectorAll('[data-tds-grid] [data-cell]')].map(c => ({k: c.dataset.cell, st: c.dataset.status, tag: c.tagName, name: (c.querySelector('[data-cell-name]') || {}).textContent || '',
          word: (c.querySelector('.rp-s') || {}).textContent || '', open: !!c.querySelector('.rp-open'), cur: getComputedStyle(c).cursor, color: getComputedStyle(c.querySelector('.rp-s') || c).color}))""")
        btns = [c for c in cl if c["tag"] == "BUTTON"]
        ok(btns and all(re.fullmatch(r"(\d{2}Q|\d{2}EQ|Form \d{3}) · Q[1-4]", c["name"]) and c["name"].endswith(c["k"].split("|")[1]) and c["open"] for c in btns), "1. each return a button with its name (%s) and Open →" % [c["name"] for c in btns][:4])
        ok(all(re.fullmatch(r"To fix \d+|Ready|Filed|Correction \d+", c["word"]) for c in btns), "1. the status in words: To fix N, Ready, Filed (%s)" % sorted(set(c["word"] for c in btns)))
        cols = {}
        for c in btns: cols.setdefault(c["st"], set()).add(c["color"])
        ok(all(len(v) == 1 for v in cols.values()) and len(set(next(iter(v)) for v in cols.values())) == len(cols), "1. one colour a status, each its own (%s)" % cols)
        empty = [c for c in cl if c["st"] == "none" and c["tag"] != "BUTTON"]
        ok(empty and all(c["word"] == "No entries" and c["cur"] != "pointer" and not c["open"] for c in empty) and not any(c["word"] == "Not started" for c in cl), "1. an empty return: No entries, not a button (%d)" % len(empty))
        b0 = pg.locator('[data-tds-grid] button[data-cell]').first
        b0.hover(); pg.wait_for_timeout(250)
        ok(pg.evaluate("(e) => getComputedStyle(e.querySelector('.rp-open')).opacity", b0.element_handle()) == "1", "1. Open → shows on hover")
        pg.mouse.move(5, 5); b0.focus(); pg.wait_for_timeout(250)
        ok(pg.evaluate("(e) => getComputedStyle(e.querySelector('.rp-open')).opacity", b0.element_handle()) == "1", "1. … and on focus")
        ok("No entries" in pg.locator('[data-tds-page] .rp-key').inner_text(), "1. the legend says No entries")
        cells = pg.locator('[data-tds-grid] [data-cell]').all_inner_texts()
        ok(not any("Errors" in c for c in cells) and any(re.search(r"To fix \d", c) for c in cells) and "To fix" in pg.locator('[data-tds-page] .rp-key').inner_text(), "1. a cell with something to fix says \"To fix N\", as the legend (%s)" % [c.split("\n")[0] for c in cells][:5])
        rowsum = sum(INR(t) for t in pg.locator('[data-tds-grid] tbody td.n b').all_inner_texts())
        ok(abs(rowsum - yt) < 1, "1. and agree with the forms' Year column (%s)" % rowsum)
        led = pg.locator('[data-ledger-banner]')
        ledw = re.sub(r"\s+", " ", led.inner_text()).strip() if led.count() else ""
        ok(led.count() == 1 and re.fullmatch(r"\d+ ledgers? to confirm → Confirm", ledw) is not None and led.bounding_box()["height"] < 30, "1. the ledgers in one line: %r" % ledw)
        link = pg.locator('[data-tds-grid] [data-ch-register]')
        ok(link.count() == 1 and "Challan register" in link.inner_text(), "1. beside the grid's title, one way to the challan register (%r)" % (link.inner_text() if link.count() else ""))
        if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "after-tds-page.png"), full_page=True)
        link.locator('button').click(); pg.wait_for_timeout(400)
        ok(pg.locator('[data-register]').count() == 1 and "/challan-register" in pg.evaluate("location.hash"), "1. the panel opens the challan register (%s)" % pg.evaluate("location.hash"))
        # 2. a return
        J("(fy) => tdsGo(fy)", fy); pg.wait_for_timeout(300)
        pg.locator('[data-cell="26Q|Q1"]').click(); pg.wait_for_timeout(500)
        tabs = pg.locator('[data-return-tabs] button').all_inner_texts()
        ok([re.sub(r"\s*\d+$", "", t).strip() for t in tabs] == ["Deductions", "Challans", "To fix", "Return file", "After filing"], "2. 26Q's tabs: %s" % tabs)
        marks = {"deductions": "#tdsDnTable", "challans": "[data-ret-challans]", "checks": "[data-to-fix]", "file": "[data-file]", "after": "[data-after-filing]"}
        for k, sel in marks.items():
            pg.click('[data-ret-tab="%s"]' % k); pg.wait_for_timeout(300)
            ok(pg.locator(sel).count() >= 1, "2. 26Q › %s reachable, shows its part" % k)
        pg.click('[data-ret-tab="deductions"]'); pg.wait_for_timeout(200); pg.click('[data-ded-switch="deductees"]'); pg.wait_for_timeout(300)
        ok(pg.locator('#tdsDeTable').count() == 1, "2. Deductions by deductee (the old Deductees tab)")
        pg.click('[data-ret-tab="checks"]'); pg.wait_for_timeout(300)
        fx = pg.locator('[data-fix]').all()
        words = pg.locator('[data-fix-line]').inner_text()
        ok(re.search(r"\d+ (without PAN|rate questions?|challans? not matched|late fee|interest)", words) is not None, "2. To fix says what is wrong: %r" % words)
        if pg.locator('[data-fix="nopan"]').count():
            pg.click('[data-fix="nopan"]'); pg.wait_for_timeout(300)
            ok(pg.locator('[data-fix-part]').count() == 1 and pg.locator('[data-fix-part="nopan"]').count() == 1, "2. \"without PAN\" opens that list alone")
            pg.click('[data-fix-all]'); pg.wait_for_timeout(200)
        pg.click('[data-fix="limits"]'); pg.wait_for_timeout(300)
        ok(pg.locator('[data-fix-part="limits"]').count() == 1, "2. the year's TDS limits open from To fix")
        pg.click('[data-ret-tab="file"]'); pg.wait_for_timeout(300)
        ok(pg.locator('[data-prefile-slot]').count() == 1, "2. the Return file tab keeps a slot for \"Check before filing\"")
        if SHOTS: pg.click('[data-ret-tab="checks"]'); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(SHOTS, "after-return-26q.png"), full_page=True)
        J("(fy) => tdsGo(fy, 'Q1', '24Q')", fy); pg.wait_for_timeout(500)
        tabs = pg.locator('[data-return-tabs] button').all_inner_texts()
        ok([re.sub(r"\s*\d+$", "", t).strip() for t in tabs] == ["Deductions", "Employees & declarations", "Challans", "To fix", "Return file", "After filing"], "2. 24Q's tabs: %s" % tabs)
        pg.click('[data-ret-tab="people"]'); pg.wait_for_timeout(300)
        ok(pg.locator('[data-salary-empty], [data-salary-tiles]').count() >= 1, "2. Employees & declarations has the old Salary tab's content")
        # 3. the old addresses
        cid = J("S.coId")
        def go(h):
            J("(h) => { location.hash = h; }", "#/c/%s/books/tds/%s" % (cid, h)); pg.wait_for_timeout(700)
        go(fy + "/challans/Q2"); ok(J("S.tdsView") == "register" and pg.locator('[data-register]').count() == 1, "3. …/challans/Q2 -> the challan register")
        ok("/challan-register" in pg.evaluate("location.hash"), "3. and the address is the register's now (%s)" % pg.evaluate("location.hash"))
        go(fy + "/26as"); ok(J("booksTab()") == "recon" and pg.locator('[data-recon-page]').count() == 1, "3. …/26as -> Reconciliations › TDS receivable vs 26AS")
        ok(pg.locator('#side [data-side="Reconciliations"], #side :text("Reconciliations")').count() >= 1, "3. Reconciliations is in the client's menu")
        go(fy + "/traces"); ok(J("[S.tdsView, S.tdsTab]") == ["return", "after"] and pg.locator('[data-after-filing]').count() == 1, "3. …/traces -> a return's After filing")
        J("() => { S.tdsView = 'year'; S.books.challans = []; render(); }"); pg.wait_for_timeout(300)
        ok("No challans" in pg.locator('[data-tds-grid] [data-ch-register]').inner_text() and pg.locator('[data-ch-add]').count() == 1, "1. with no challans: \"No challans · Add challan\"")
        pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        go(fy + "/salary/form16"); ok(J("[S.tdsView, S.tdsForm, S.tdsTab, S.paySub]") == ["return", "24Q", "people", "form16"], "3. …/salary/form16 -> 24Q › Employees & declarations, Form 16 (%s)" % J("[S.tdsView, S.tdsForm, S.tdsTab, S.paySub]"))
        go(fy + "/checks/limits"); ok(J("[S.tdsView, S.tdsTab, S.tdsFix]") == ["return", "checks", "limits"], "3. …/checks/limits -> a return's To fix, TDS limits")
        go(fy + "/certs"); ok(J("[S.tdsView, S.tdsTab, S.tdsFix]") == ["return", "checks", "rates"], "3. …/certs -> To fix, section 197 certificates")
        go(fy + "/Q1/26Q/deductees"); ok(J("[S.tdsTab, S.tdsDedView]") == ["deductions", "deductees"] and pg.locator('#tdsDeTable').count() == 1, "3. a return's old …/deductees -> Deductions by deductee")
        go(fy + "/Q1/26Q/summary"); ok(J("S.tdsTab") == "deductions", "3. …/summary -> Deductions")
        go(fy + "/Q4/24Q/annex2"); ok(J("S.tdsTab") == "people", "3. 24Q's …/annex2 -> Employees & declarations")
        go(fy + "/Q1/24Q/employees"); ok(J("S.tdsTab") == "deductions", "3. 24Q's …/employees -> Deductions (Annexure I)")
        # 4. the floating message
        J("(fy) => tdsGo(fy)", fy); pg.wait_for_timeout(300)
        J("(m) => toast(m, {stay: true})", MSG); pg.wait_for_timeout(400)
        o = J(OVERLAP); ok(o["shown"] and not o["hit"], "4. beside the sidebar the message covers nothing (%s; %s)" % (o.get("rect"), o.get("hit", [])[:4]))
        ok(o["rect"][0] < 240 and o["rect"][2] <= 220, "4. small, in the sidebar's bottom corner (%s)" % o.get("rect"))
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "after-toast.png"))
        for (w, h, fold, label) in ((1400, 1000, True, "sidebar folded"), (390, 844, False, "phone")):
            pg.set_viewport_size({"width": w, "height": h})
            J("(f) => { const s = document.getElementById('side'); if (s) s.classList.toggle('side-folded', f); }", fold); pg.wait_for_timeout(300)
            pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)"); pg.wait_for_timeout(300)
            last = J("""() => { const t = document.getElementById('toast').getBoundingClientRect(); const els = [...document.querySelectorAll('.mainwrap td, .mainwrap button, .mainwrap p, .mainwrap h3')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height; });
              const low = els.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0); return {low, top: t.top, w: t.width, right: window.innerWidth - t.right}; }""")
            ok(last["low"] <= last["top"] + 1, "4. %s: scrolled to the end, the page's last content is above the message (%s)" % (label, last))
            ok(last["w"] <= max(310, w - 15), "4. %s: the message is small (%dpx wide)" % (label, last["w"]))
        J("() => toastHide && (toastStay = null, document.getElementById('toast').dataset.stay = '', toastHide())")
        ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
        br.close()
finally:
    srv.shutdown()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
