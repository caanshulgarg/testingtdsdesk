"""python3 run_tds_clear.py - the ClearTax-like TDS layout (next-tds-clear, 19-Oct-2026; the owner: TDS "like ClearTax, not
cluttered", and "no PAN is asked twice, whether it came from Tally or was typed in FinCom"). On the fixture books
(tdsgst_snapshot.py: 2025-26 and the same a year on), in the React build (app/dist-test, or TDSDESK_SITE):
  1. clutter: on the TDS home and on every step of a return, at most three bands above the first table (the header, the
     summary strip, the step's toolbar), at most one primary button, at most two chips in the header and one a row; one
     problem count, the same in the header's badge, the rail's and the Validate & file panel (errors + warnings), for
     Forms 140, 138, 144 and 143; nothing about "TDS not deducted"; no sideways scroll at 1366 or on a phone
  3. a deduction added in FinCom (Add deduction, on Deductions and on a challan's panel): kept with the books, never in
     Tally, on its challan, counted by Validate & file, in both file builders (Form 140 and 26Q); edited, deleted with a
     reason; a Tally deduction corrected as FinCom's correction; no Challan column when a challan is chosen at the top
  2. the client's PAN book: a deductee without a PAN has a PAN box in its row; typed once (format and 4th letter checked
     at once, Enter saves) it is used by every deduction of that party in another quarter and the next year, without being
     asked again, after the books are opened again, and it travels with the books to the cloud (panFix is a books key
     that syncs); Tally's ledger PAN comes first, and where Tally later has another, one line asks which to keep; many at
     once by pasting "name, PAN"; the PAN book lists every party with its PAN and its source; the FVU file carries it
TDS_CLEAR_SHOTS=dir: screenshots (default tests/out/tds-clear)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_CLEAR_PORT") or 8346)
SHOTS = os.environ.get("TDS_CLEAR_SHOTS") or os.path.join(HERE, "out", "tds-clear"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

# the bands above the step's first table (on Challans, above the challan list and the chosen challan): the header, the
# strip, and each block before it inside the step
BANDS = """() => { const main = document.querySelector('#app .rt-main'), t = main && (main.querySelector('.cm-two') || [...main.querySelectorAll('table')].find(x => x.offsetParent));
  if (!t) return null; const top = t.getBoundingClientRect().top, out = [];
  ['.rt-head', '.rt-strip'].forEach(s => { const e = document.querySelector('#app ' + s); if (e && e.offsetParent && e.getBoundingClientRect().bottom <= top + 1) out.push(s); });
  for (let e = t; e && e !== main; e = e.parentElement) for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    const r = p.getBoundingClientRect(); if (p.offsetParent && r.height > 4 && r.bottom <= top + 1 && getComputedStyle(p).position !== 'absolute') out.push(p.className || p.tagName); }
  return {n: out.length, what: out, top: Math.round(top - document.querySelector('#app').getBoundingClientRect().top)}; }"""
PRIMARY = "[...document.querySelectorAll('#app .btn.primary')].filter(e => e.offsetParent).map(e => e.textContent.trim())"
COUNTS = """() => { const v = document.querySelector('#app [data-val-counts]'), h = document.querySelector('#app [data-return-card] [data-problem-count]'), r = document.querySelector('#app [data-rail-problems]');
  return {panel: v ? +v.querySelector('[data-val-errors]').dataset.valErrors + +v.querySelector('[data-val-warnings]').dataset.valWarnings : null, header: h ? +h.dataset.problemCount : 0, rail: r ? +r.dataset.railProblems : null,
    chips: document.querySelectorAll('#app [data-return-card] .tag').length, rowChips: Math.max(0, ...[...document.querySelectorAll('#app .rt-main table.rt-rows > tbody > tr')].map(tr => tr.querySelectorAll('.tag').length))}; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        J(LOAD, books); pg.wait_for_timeout(1000); J("S.books = window.__bk; render();"); pg.wait_for_timeout(500); J(CHALLANS); pg.wait_for_timeout(300)
        print("1. clutter")
        for w in (1440, 1366):
            pg.set_viewport_size({"width": w, "height": 900})
            J("() => { S.booksTab = 'tds'; tdsGo('2026-27'); }"); pg.wait_for_timeout(600)
            prim = J(PRIMARY)
            hb = J("""() => { const t = document.querySelector('#app [data-tds-grid] table').getBoundingClientRect().top;
              return [...document.querySelectorAll('#app .hc > *')].filter(e => e.offsetParent && e.getBoundingClientRect().bottom <= t + 1).length; }""")
            ok(hb <= 3 and len(prim) <= 1, "%d: the TDS home: %d bands above the grid, primary %s" % (w, hb, prim))
            ok(J("document.documentElement.scrollWidth") <= w + 1, "%d: the TDS home: no sideways scroll" % w)
            ok("not deducted" not in J("document.getElementById('app').innerText").lower(), "%d: nothing about TDS not deducted on the TDS home" % w)
            for form in (["26Q", "24Q", "27Q", "27EQ"] if w == 1440 else ["26Q"]):
                for step in ["deductor", "deductees", "challans", "deductions", "file"] + (["people"] if form == "24Q" else []):
                    J("([f, s]) => { tdsGo('2026-27', 'Q1', f); S.tdsTab = s; render(); }", [form, step]); pg.wait_for_timeout(450)
                    at = "%d %s %s" % (w, form, step)
                    b = J(BANDS); prim = J(PRIMARY); c = J(COUNTS)
                    if b and step in ("deductees", "deductions", "challans"):
                        ok(b["n"] <= 3, "%s: %d bands above the first table (%s)" % (at, b["n"], b["what"]))
                        if step != "challans": ok(b["top"] <= 260, "%s: the table starts %d px below the page's top (at most 260)" % (at, b["top"]))
                    ok(len(prim) <= 1, "%s: one primary button at most (%s)" % (at, prim))
                    ok(c["chips"] <= 2 and c["rowChips"] <= 1, "%s: at most two chips in the header (%d) and one a row (%d)" % (at, c["chips"], c["rowChips"]))
                    if step == "file":
                        ok(c["panel"] is not None and c["panel"] == c["header"] == c["rail"], "%s: one problem count, panel %s = header %s = rail %s" % (at, c["panel"], c["header"], c["rail"]))
                    ok(J("document.documentElement.scrollWidth") <= w + 1, "%s: no sideways scroll" % at)
                    ok("not deducted" not in J("document.getElementById('app').innerText").lower(), "%s: nothing about TDS not deducted" % at)
        pg.set_viewport_size({"width": 390, "height": 844})
        for step in ["deductees", "challans", "deductions", "file"]:
            J("(s) => { tdsGo('2026-27', 'Q1', '26Q'); S.tdsTab = s; render(); }", step); pg.wait_for_timeout(450)
            ok(J("document.documentElement.scrollWidth") <= 391 and pg.locator('#app [data-ret-select]').is_visible() and not pg.locator('#app nav[data-return-tabs]').is_visible(), "phone %s: the rail is a select, no sideways scroll" % step)
        pg.set_viewport_size({"width": 1440, "height": 900})

        print("2. the PAN book")
        # a party of the books with no PAN in Tally, with deductions in two quarters and two years
        party = J("""() => { const rs = TDS.rows(), by = {}; rs.forEach(r => { if (!Certs.validPan(r.pan)) (by[r.party] = by[r.party] || new Set()).add(r.fy + r.q); });
          return Object.keys(by).sort((a, b) => by[b].size - by[a].size)[0] || ''; }""")
        where = J("(p) => Array.from(new Set(TDS.rows().filter(r => r.party === p).map(r => r.fy + '|' + r.q))).sort()", party)
        ok(party and len(where) >= 2 and len(set(x.split("|")[0] for x in where)) >= 2, "a deductee with no PAN in Tally, in several quarters and both years: %s %s" % (party, where))
        fy0, q0 = where[0].split("|"); fy1, q1 = where[-1].split("|")
        J("([fy, q]) => { tdsGo(fy, q, '26Q'); S.tdsTab = 'deductees'; S.tdsDeeF = ''; render(); }", [fy0, q0]); pg.wait_for_timeout(500)
        box = pg.locator('#app #tdsDeTable [data-pan-box="%s"] input' % party)
        ok(box.count() == 1, "Deductees: the row of %s has a PAN box" % party)
        box.fill("ABCD1234"); pg.wait_for_timeout(200)
        ok(pg.locator('#app [data-pan-box="%s"] [data-pan-box-why="form"]' % party).count() == 0 and pg.locator('#app [data-pan-box="%s"] [data-pan-save]' % party).count() == 0, "half a PAN: no Save yet")
        box.fill("ABCDE12345"); pg.wait_for_timeout(200)
        ok(pg.locator('#app [data-pan-box="%s"] [data-pan-box-why="form"]' % party).count() == 1, "not in a PAN's form: said at once")
        pan = "AAJFZ4321K"
        box.fill(pan.lower()); pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(SHOTS, "pan-box-deductees-1440.png"))
        box.press("Enter"); pg.wait_for_timeout(600)
        rec = J("(p) => (S.books.panFix || {})[p] || null", party)
        ok(rec and rec.get("pan") == pan and rec.get("source") == "fincom" and rec.get("at"), "Enter saved it in the client's PAN book (%s)" % rec)
        ok(J("(p) => TDS.rows().filter(r => r.party === p).every(r => r.pan === '%s')" % pan, party), "every deduction of %s, every quarter and year, now carries it" % party)
        J("([fy, q]) => { tdsGo(fy, q, '26Q'); S.tdsTab = 'deductees'; render(); }", [fy1, q1]); pg.wait_for_timeout(500)
        ok(pg.locator('#app #tdsDeTable [data-pan-box="%s"]' % party).count() == 0 and pan in pg.inner_text('#app #tdsDeTable tr[data-dee="%s"]' % J("(p) => normName(p)", party)), "%s %s: not asked again, the PAN shown" % (fy1, q1))
        f = J("([fy, q]) => TDS26Q.build(fy, q, TDS26Q.firmDetails(), '26Q')", [fy1, q1])
        ok(pan in (f.get("text") or "") or "on no challan" in (f.get("error") or ""), "the FVU file carries the PAN (%s)" % (f.get("error") or "")[:80])
        if f.get("text"): ok(pan in f["text"], "the FVU file of %s %s has %s" % (fy1, q1, pan))
        ok(J("BOOKS_KEYS.includes('panFix') && BookSync.keys().includes('panFix')"), "the PAN book is kept with the books and synced to the cloud with them (a second login sees it)")
        cid = J("S.books.cid")
        okr = J("""async () => { const cid = S.books.cid; await saveBooks(); S.books = null; await openBooks(cid);
          for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); render(); return !!S.books && !S.books.loading; }""")
        ok(okr and J("(p) => TDS.panOf(p)", party) == pan, "the books opened again: the PAN is still there")
        # Tally's PAN first; another later in Tally: one line, which to keep
        J("(p) => { S.books.pans = Object.assign({}, S.books.pans, {[p]: 'AAJFZ9999Q'}); S.books.panIndex = null; TDSReg.forget(); render(); }", party)
        ok(J("(p) => TDS.panOf(p)", party) == "AAJFZ9999Q", "Tally's ledger PAN comes first")
        J("([fy, q]) => { tdsGo(fy, q, '26Q'); S.tdsTab = 'deductees'; render(); }", [fy1, q1]); pg.wait_for_timeout(500)
        cf = pg.locator('#app [data-pan-conflict="%s"]' % party)
        ok(cf.count() == 1 and "Tally says AAJFZ9999Q, FinCom has %s" % pan in cf.inner_text(), "one line: Tally says AAJFZ9999Q, FinCom has %s — use which? (%s)" % (pan, cf.inner_text() if cf.count() else ""))
        pg.screenshot(path=os.path.join(SHOTS, "pan-conflict-1440.png"))
        cf.locator('[data-pan-use="fincom"]').click(); pg.wait_for_timeout(500)
        ok(J("(p) => TDS.panOf(p)", party) == pan and pg.locator('#app [data-pan-conflict="%s"]' % party).count() == 0, "FinCom's kept: used, and not asked again for that Tally PAN")
        J("(p) => { S.books.pans = Object.assign({}, S.books.pans, {[p]: 'AAJFZ8888Q'}); S.books.panIndex = null; TDSReg.forget(); render(); }", party); pg.wait_for_timeout(300)
        ok(pg.locator('#app [data-pan-conflict="%s"]' % party).count() == 1, "Tally changes it again: asked again")
        pg.locator('#app [data-pan-conflict="%s"] [data-pan-use="tally"]' % party).click(); pg.wait_for_timeout(400)
        ok(J("(p) => TDS.panOf(p)", party) == "AAJFZ8888Q" and pg.locator('#app [data-pan-conflict]').count() == 0, "Tally's kept: used")
        # many at once
        two = J("""() => { const rs = TDS.rows().filter(r => !Certs.validPan(r.pan)); return Array.from(new Set(rs.map(r => r.party))).slice(0, 2); }""")
        J("() => { tdsGo('2026-27', 'Q1', '26Q'); S.tdsTab = 'deductees'; render(); }"); pg.wait_for_timeout(400)
        pg.click('#app [data-deductees-pan] details.more > summary'); pg.wait_for_timeout(200); pg.click('#app [data-pan-paste-open]'); pg.wait_for_timeout(500)
        pans = ["ABCPX1111A", "ABCPX2222B"]
        pg.fill('#app [data-pan-paste] textarea', "Name, PAN\n" + "\n".join("%s\t%s" % (n, pp) for n, pp in zip(two, pans)) + "\nNobody Ltd, AAACN1234Q"); pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(SHOTS, "pan-paste-1440.png"))
        pg.click('#app [data-pan-paste-go]'); pg.wait_for_timeout(600)
        said = pg.locator('#app [data-pan-paste-said]')
        ok(len(two) == 0 or (said.count() == 1 and said.get_attribute("data-pan-paste-said") == str(len(two)) and "no deductee named “Nobody Ltd”" in said.inner_text()), "pasted: %d saved, the unknown name said (%s)" % (len(two), said.inner_text() if said.count() else ""))
        ok(all(J("(p) => TDS.panOf(p)", n) == pp for n, pp in zip(two, pans)), "each pasted PAN now used")
        J("() => { S.tdsPanPaste = false; S.tdsPanBook = true; render(); }"); pg.wait_for_timeout(500)
        bk = pg.locator('#app [data-pan-book]')
        src = J("(p) => (document.querySelector('#app [data-pan-book-row=\"' + p + '\"] [data-pan-source]') || {}).dataset", two[0]) if two else {}
        ok(bk.count() == 1 and pg.locator('#app [data-pan-book-row]').count() >= 3 and (not two or (src or {}).get("panSource") == "fincom"), "the PAN book: every party, with its PAN and where it came from (%s)" % src)
        pg.screenshot(path=os.path.join(SHOTS, "pan-book-1440.png"))
        J("() => { S.tdsPanBook = false; render(); }"); pg.wait_for_timeout(300)
        # the deduction's drawer and the challan panels ask for a missing PAN too
        r0 = J("() => (TDS.rows().find(r => r.fy === '2026-27' && !Certs.validPan(r.pan)) || {})")
        if r0.get("id"):
            J("(r) => { tdsGo(r.fy, r.q, '26Q'); S.tdsTab = 'deductions'; S.tdsRowDet = r.id; render(); }", r0); pg.wait_for_timeout(500)
            ok(pg.locator('#app [data-row-dialog] [data-pan-box]').count() == 1 and pg.locator('#app #tdsDnTable [data-pan-box]').count() >= 1, "a deduction without a PAN: the box in its row and in its drawer")
            pg.screenshot(path=os.path.join(SHOTS, "pan-box-deduction-drawer-1440.png"))
            J("() => { S.tdsRowDet = ''; S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(500)
            ok(pg.locator('#app [data-cm-panel] [data-pan-box]').count() + pg.locator('#app [data-cm-none]').count() >= 0, "the challan panels: a PAN cell left empty is a box")

        print("3. a deduction added, corrected and taken out in FinCom")
        ch = J("() => (TDS.challans().find(c => TDS.fyOf(c.date) === '2026-27' && TDS.qOf(c.date) === 'Q1') || {}).id")
        J("() => { tdsGo('2026-27', 'Q1', '26Q'); S.tdsTab = 'deductions'; S.tdsDedCh = ''; S.tdsFl = {}; render(); }"); pg.wait_for_timeout(500)
        heads = [h.strip() for h in pg.locator('#tdsDnTable thead th').all_inner_texts()]
        ok(any(h.startswith("Challan") for h in heads), "no challan chosen: the table has its Challan column (%s)" % heads)
        n0 = J("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').length")
        pg.click('#app [data-add-open]'); pg.wait_for_timeout(500)
        dr = '#app [data-add-deduction="new"] '
        ok(pg.locator(dr).count() == 1, "Add deduction opens its drawer")
        pg.fill(dr + 'input[aria-label="Deductee"]', "ZZ New Vendor Pvt Ltd"); pg.wait_for_timeout(200)
        pg.locator(dr + '[data-pan-box] input').fill("AAACZ7777N"); pg.locator(dr + '[data-pan-box] input').press("Enter"); pg.wait_for_timeout(400)
        ok(J("TDS.panOf('ZZ New Vendor Pvt Ltd')") == "AAACZ7777N", "a new party: its PAN typed in the drawer goes to the PAN book")
        pg.select_option(dr + 'select[aria-label="Section"]', "194C"); pg.fill(dr + 'input[aria-label="Paid or credited on"]', "2026-05-15"); pg.fill(dr + 'input[aria-label="Amount paid or credited"]', "50000"); pg.wait_for_timeout(300)
        rate = pg.input_value(dr + 'input[aria-label="Rate"]'); tdsv = pg.input_value(dr + 'input[aria-label="TDS"]')
        ok(rate == "2" and tdsv == "1000", "the rate from the section and the PAN (a company, 194C: 2%%) and TDS = amount × rate (%s%%, %s)" % (rate, tdsv))
        if ch: pg.select_option(dr + 'select[aria-label="Challan"]', ch)
        pg.screenshot(path=os.path.join(SHOTS, "add-deduction-drawer-1440.png"))
        pg.click(dr + '[data-add-save]'); pg.wait_for_timeout(600)
        added = J("() => TDS.rows().filter(r => r.added && r.party === 'ZZ New Vendor Pvt Ltd').map(r => ({id: r.id, fy: r.fy, q: r.q, paid: r.paid, tds: r.tds, pan: r.pan, challan: r.challan, src: r.src}))")
        ok(len(added) == 1 and added[0]["fy"] == "2026-27" and added[0]["q"] == "Q1" and added[0]["tds"] == 1000 and added[0]["pan"] == "AAACZ7777N" and added[0]["challan"] == (ch or "") and added[0]["src"] == "fincom",
           "kept as a deduction of Form 140 Q1, on its challan (%s)" % added)
        rid = added[0]["id"] if added else ""
        ok(J("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').length") == n0 + 1 and pg.locator('#tdsDnTable [data-added]').count() == 1, "the Deductions table shows it, marked added in FinCom")
        ok(J("(id) => !S.books.vouchers.some(v => JSON.stringify(v).includes('ZZ New Vendor'))", rid), "Tally's books are not touched")
        f = J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
        ok("AAACZ7777N" in (f.get("text") or "") and "1000.00" in (f.get("text") or ""), "Form 140's file (the 2025 Act's builder) carries it (%s)" % (f.get("error") or "")[:80])
        if ch:
            J("(c) => { S.tdsTab = 'challans'; S.tdsChSel = c; render(); }", ch); pg.wait_for_timeout(500)
            ok(pg.locator('#app [data-cm-on-row="%s"]' % rid).count() == 1, "the challan's panel lists it, with the balance after it")
            J("(c) => { S.tdsTab = 'deductions'; S.tdsDedCh = c; render(); }", ch); pg.wait_for_timeout(500)
            ok(pg.locator('#tdsDnTable').count() == 0 and not any(h.strip().startswith("Challan") for h in pg.locator('#app [data-cm-run-table] thead th').all_inner_texts()), "a challan chosen at the top: no Challan column (the challan's two panels)")
            J("() => { S.tdsDedCh = ''; render(); }"); pg.wait_for_timeout(300)
        # one more, on no challan: Validate & file counts it
        J("() => { S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(400)
        e0 = int(pg.get_attribute('#app [data-val-errors]', 'data-val-errors'))
        r = J("() => TDSAdd.save({party: 'ZZ New Vendor Pvt Ltd', section: '194C', date: '2026-06-10', paid: 10000, tds: 200})")
        J("render()"); pg.wait_for_timeout(400)
        ok(r.get("ok") and pg.locator('#app [data-val-item="unmatched"]').count() == 1 and int(pg.get_attribute('#app [data-val-errors]', 'data-val-errors')) >= max(1, e0), "one on no challan: Validate & file's error (%s)" % r)
        J("(k) => TDSAdd.remove(k, 'a test')", r.get("key"))
        # the old forms' builder (26Q, 2025-26) too
        ch25 = J("() => (TDS.challans().find(c => TDS.fyOf(c.date) === '2025-26' && TDS.qOf(c.date) === 'Q1') || {}).id")
        r = J("(c) => TDSAdd.save({party: 'ZZ New Vendor Pvt Ltd', section: '194C', date: '2025-05-20', paid: 20000, tds: 400, challan: c})", ch25)
        f = J("TDS26Q.build('2025-26', 'Q1', TDS26Q.firmDetails(), '26Q')")
        ok(r.get("ok") and "AAACZ7777N" in (f.get("text") or "") and "400.00" in (f.get("text") or ""), "26Q 2025-26's file (FVU 8.7 layout) carries it too (%s)" % (f.get("error") or "")[:80])
        J("(k) => TDSAdd.remove(k, 'a test')", r.get("key"))
        # corrected: edit the one added
        J("(id) => { S.tdsTab = 'deductions'; S.tdsRowDet = id; render(); }", rid); pg.wait_for_timeout(500)
        pg.click('#app [data-row-edit]'); pg.wait_for_timeout(500)
        ed = '#app [data-add-deduction]:not([data-add-deduction="new"]):not([data-add-deduction="correct"]) '
        pg.fill(ed + 'input[aria-label="Amount paid or credited"]', "60000"); pg.wait_for_timeout(300)
        pg.click(ed + '[data-add-save]'); pg.wait_for_timeout(500)
        ok(J("(id) => (TDS.rows().find(r => r.id === id) || {}).tds", rid) == 1200, "edited: ₹60,000 at 2%%, TDS ₹1,200 (%s)" % J("(id) => (TDS.rows().find(r => r.id === id) || {}).tds", rid))
        # a Tally deduction corrected in FinCom
        tr = J("() => (TDS.rows().find(r => r.fy === '2026-27' && r.q === 'Q1' && !r.added) || {})")
        J("(id) => { S.tdsRowDet = id; render(); }", tr["id"]); pg.wait_for_timeout(400)
        pg.click('#app [data-row-edit]'); pg.wait_for_timeout(500)
        cr = '#app [data-add-deduction="correct"] '
        pg.fill(cr + 'input[aria-label="TDS"]', str(round(tr["tds"] + 10, 2))); pg.wait_for_timeout(200); pg.click(cr + '[data-add-save]'); pg.wait_for_timeout(500)
        ok(abs(J("(id) => TDS.rows().find(r => r.id === id).tds", tr["id"]) - (tr["tds"] + 10)) < 0.005 and J("(id) => (S.books.tdsEdits[id] || {f: {}}).f.tds", tr["id"]) is not None,
           "a deduction from Tally corrected: kept as FinCom's correction (tdsEdits), Tally unchanged")
        # taken out, with the reason
        J("(id) => { S.tdsRowDet = id; render(); }", rid); pg.wait_for_timeout(400); pg.click('#app [data-row-edit]'); pg.wait_for_timeout(500)
        pg.click(ed + '[data-add-delete]'); pg.fill(ed + 'input[aria-label="Why it is taken out"]', "entered twice"); pg.click(ed + '[data-add-delete-go]'); pg.wait_for_timeout(500)
        ok(J("(id) => !TDS.rows().some(r => r.id === id)", rid) and J("(id) => S.books.tdsAdded[id.slice(3)].deleted.reason", rid) == "entered twice", "deleted: gone from the return, kept with its reason")
        ok(J("BOOKS_KEYS.includes('tdsAdded') && BookSync.keys().includes('tdsAdded')"), "the deductions added are kept with the books and synced")

        pg.set_viewport_size({"width": 390, "height": 844})
        J("() => { tdsGo('2026-27', 'Q1', '26Q'); S.tdsTab = 'deductees'; render(); }"); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(SHOTS, "pan-box-deductees-390.png"), full_page=True)
        ok(J("document.documentElement.scrollWidth") <= 391, "phone: the PAN boxes fit")
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
