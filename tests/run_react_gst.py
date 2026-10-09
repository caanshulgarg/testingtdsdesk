"""python3 run_react_gst.py - GSTR-1 and GSTR-3B in React, with the books in tests/data: finding a customer, opening one,
the part filter, typing a reversal into 3B table 4(B)(2), and the link to GST settings.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_gst.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8157), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8157/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "gst"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    # the month with the most customers
    pg.evaluate("() => { const n = ym => new Set(Object.values(GSTR.one(ym, S.gstReg || '')).filter(Array.isArray).flat().map(r => r.gstin || r.party)).size; S.gstYm = GSTR.months().reduce((a, m) => n(m) > n(a) ? m : a); render(); }")
    pg.click('nav[aria-label="GST"] button[data-part="r1"]'); pg.wait_for_timeout(500)
    pg.click('nav[aria-label="Return"] button[data-sub="details"]'); pg.wait_for_timeout(400)   # 09-Oct-2026: the customers and HSN on GSTR-1's Details tab
    rows = lambda: pg.locator("#r1Table > tbody > tr").count()
    n0 = rows()
    ok(n0 > 1 and "HSN summary (12)" in pg.inner_text("#app"), "GSTR-1: customers, and the HSN summary")
    first = pg.evaluate("document.querySelector('#r1Table tbody tr td button').textContent.slice(2)")
    box = pg.locator('input[aria-label="Find a customer, invoice or GSTIN"]'); box.click(); pg.keyboard.type(first[:6], delay=20); pg.wait_for_timeout(600)
    ok(rows() < n0 and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find a customer, invoice or GSTIN", "typing “%s”: fewer customers, the cursor stays in the box" % first[:6])
    pg.click('.revfilter button.linkbtn:text-is("Clear")'); pg.wait_for_timeout(400)
    ok(rows() == n0, "Clear: all of them again")
    pg.click('#r1Table tbody tr td button >> nth=0'); pg.wait_for_timeout(400)
    ok(pg.locator("#r1Table table").count() == 1, "a click on a customer opens its invoices")
    pg.click('#r1Table tbody tr td button >> nth=0'); pg.wait_for_timeout(400)
    ok(pg.locator("#r1Table table").count() == 0, "and again closes them")
    # customers' IMS rejections: find an invoice by number, mark it, say what to do, and take it back
    pg.click('nav[aria-label="Return"] button[data-sub="diff"]'); pg.wait_for_timeout(400)   # 09-Oct-2026: IMS rejections on GSTR-1's Differences tab
    inv = pg.evaluate("GSTR.one(S.gstYm, S.gstReg || '').b2b[0].no")
    box = pg.locator('input[aria-label="Invoice or credit note number"]'); box.click(); pg.keyboard.type(inv, delay=15); pg.wait_for_timeout(600)
    ok(pg.locator('button:text-is("Mark as rejected")').count() >= 1 and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Invoice or credit note number", "IMS: found by number while typing, the cursor stays")
    pg.locator('button:text-is("Mark as rejected")').first.click(); pg.wait_for_timeout(500)
    ok(len(pg.evaluate("CustIMS.items(S.gstReg || '')")) == 1 and box.input_value() == "", "marked as rejected; the box is cleared")
    pg.select_option('section:has(h3:text-is("Rejected by customers in IMS")) select[aria-label="What to do"]', index=1); pg.wait_for_timeout(400)
    ok(pg.evaluate("CustIMS.items(S.gstReg || '')[0].act") == pg.evaluate("CustIMS.ACTS.inv[1][0]"), "what to do is kept")
    pg.click('button:text-is("not rejected after all")'); pg.wait_for_timeout(400)
    ok(len(pg.evaluate("CustIMS.items(S.gstReg || '')")) == 0, "“not rejected after all” takes it off")
    # the funnel on a column heading, as on every old table: filters the customers, and stays through a redraw
    pg.click('nav[aria-label="Return"] button[data-sub="details"]'); pg.wait_for_timeout(400)   # back to GSTR-1's Details tab
    hsn = pg.locator('#r1Table')
    n = hsn.locator("tbody tr").count()
    ok(n >= 4 and hsn.locator("th .gff").count() == 5, "funnels on the customers' headings")
    if n >= 4:
        rate = first[:6]
        hsn.locator('th .gff[data-gfi="0"]').click(); pg.wait_for_timeout(300)
        pg.fill('#gfpop input[data-gfin="q"]', rate); pg.wait_for_timeout(300); pg.click('#gfpop [data-gfx="close"] >> nth=-1'); pg.wait_for_timeout(300)
        vis = lambda: pg.evaluate("(t) => Array.from(t.tBodies[0].rows).filter(r => r.style.display !== 'none').length", hsn.element_handle())
        k = vis(); ok(0 < k < n and "Showing" in pg.inner_text("#app .gf-bar"), "filtered to “%s”: %d of %d rows" % (rate, k, n))
        pg.evaluate("render()"); pg.wait_for_timeout(400)
        ok(vis() == k and hsn.locator("th .gff").count() == hsn.locator("th").count(), "a redraw keeps the filter and one funnel per heading")
        pg.click('#app .gf-bar button[data-gfclear]'); pg.wait_for_timeout(300)
        ok(vis() == n, "Clear filters: all rows")
    pg.select_option('select[aria-label="Part"]', "B2B"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.r1F.part") == "B2B", "the part filter")
    pg.click('nav[aria-label="GST"] button[data-part="r3b"]'); pg.wait_for_timeout(500)
    pg.click('nav[aria-label="Return"] button[data-sub="details"]'); pg.wait_for_timeout(400)   # 09-Oct-2026: table 4 on GSTR-3B's Details tab
    before = pg.inner_text('tr:has-text("(C) Net ITC available")')
    inp = pg.locator('input[aria-label="rev2 IGST"]'); inp.fill("1000"); inp.press("Tab"); pg.wait_for_timeout(500)
    k = pg.evaluate("(S.gstReg || '') + '|' + S.gstYm")
    ok(pg.evaluate("S.books.gst3b[%s].rev2.igst" % json.dumps(k)) == 1000 and pg.inner_text('tr:has-text("(C) Net ITC available")') != before, "3B 4(B)(2): 1,000 typed is kept, and net ITC changes")
    # the input register: a chip filters, again clears; the find box keeps the cursor; the whole year
    pg.click('nav[aria-label="GST"] button[data-part="inreg"]'); pg.wait_for_timeout(600)
    # the one list table (round 2, K6): the count ("12 documents of 40") and the totals are in the foot
    reg = lambda: pg.inner_text("#app table.bk-table.fixed tfoot")
    all_ = reg()
    pg.click('#app .gf-chips button.gf-chip >> nth=0'); pg.wait_for_timeout(400)
    ok(" of " in reg() and pg.locator("#app .gf-chip.on").count() == 1, "a chip filters the register: " + reg().split("\t")[0])
    pg.click('#app .gf-chip.on'); pg.wait_for_timeout(400)
    ok(reg() == all_ and pg.evaluate("S.inregF") == "", "the chip again: every document")
    box = pg.locator('input[aria-label="Find in the register"]'); box.click(); pg.keyboard.type(first[:4], delay=20); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find in the register", "the find box keeps the cursor while typing")
    box.fill(""); pg.select_option('select[aria-label="Period"]', "year"); pg.wait_for_timeout(800)
    ok("Input register, the year" in pg.inner_text("#app"), "the whole year")
    pg.select_option('select[aria-label="Period"]', "month"); pg.wait_for_timeout(400)
    pg.click('nav[aria-label="GST"] button[data-part="r3b"]'); pg.wait_for_timeout(500)
    # 2B reconciliation, with a 2B made from these books (make2b.js): confirm, unlink, link by hand, a remark, filters
    pg.evaluate(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "make2b.js")).read()); pg.wait_for_timeout(800)
    nav = lambda l: pg.click('nav[aria-label="2B reconciliation"] button:has-text("%s")' % l)
    st = lambda: pg.evaluate("GST2B.state()")
    nav("To confirm"); pg.wait_for_timeout(400)
    n = pg.locator('#r2Pairs button:text-is("Same")').count(); pg.locator('#r2Pairs button:text-is("Same")').first.click(); pg.wait_for_timeout(500)
    ok(n > 0 and pg.locator('#r2Pairs button:text-is("Same")').count() == n - 1 and "yes" in st()["confirm"].values(), "To confirm: “Same” confirms it, and it leaves the list")
    nav("Differences"); pg.wait_for_timeout(400)
    pg.locator('#r2Pairs button:text-is("Unlink")').first.click(); pg.wait_for_timeout(500)
    # the 2B document may pair with another entry afterwards; what was unlinked is not offered again
    ok("no" in st()["confirm"].values(), "Differences: “Unlink” marks the two as not the same")
    nav("In 2B only"); pg.wait_for_timeout(400)
    sel = pg.locator('select[aria-label="Booked in Tally as"]'); n = sel.count()
    choice = sel.first.locator("option >> nth=1")
    if choice.count():
        sel.first.select_option(index=1); pg.wait_for_timeout(500)
        ok(len(st()["link"]) == 1 and pg.locator('select[aria-label="Booked in Tally as"]').count() == n - 1, "In 2B only: linked by hand to a Tally entry, and out of the list")
    else: ok(False, "nothing to link in In 2B only")
    pg.locator('select[aria-label="Remark"]').first.select_option("Not our purchase"); pg.wait_for_timeout(400)
    ok(any(v["tag"] == "Not our purchase" for v in st()["tag"].values()) and pg.locator('select[aria-label="Remark"]').first.input_value() == "Not our purchase", "a remark is kept and shown")
    box = pg.locator('input[aria-label="Find in the reconciliation"]'); box.click(); pg.keyboard.type("zzzz", delay=20); pg.wait_for_timeout(600)
    ok("Nothing here." in pg.inner_text("#app") and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find in the reconciliation", "the find box filters as typed, keeping the cursor")
    pg.click('.revfilter button:text-is("Clear filters")'); pg.wait_for_timeout(400)
    nav("Supplier by supplier"); pg.wait_for_timeout(400)
    pg.locator("#r2Sup tbody button.linkbtn").first.click(); pg.wait_for_timeout(400)
    ok(pg.locator("#r2Sup table").count() == 1, "a supplier opened shows its documents")
    pg.click('.row:has(> span:text-is("Reconcile")) button >> nth=1'); pg.wait_for_timeout(600)
    ok(pg.locator('select[aria-label="Which month"]').count() == 1, "the year at once, with a month filter")
    tol = pg.locator('input[aria-label="Allow a difference of"]'); tol.fill("600"); tol.press("Tab"); pg.wait_for_timeout(500)
    ok(pg.evaluate("GST2B.settings().tol") == 600, "the difference allowed is kept")
    # ITC follow-up (from the 2B above): a decision, a note, a kind chosen, and a letter logged as written
    pg.evaluate("() => { S.itctShow = 'all'; gstPartGo('follow'); }"); pg.wait_for_timeout(700)
    row = pg.locator('tr:has(select[aria-label="What to do"])').first; key = row.get_attribute("data-key")
    last = row.locator('select[aria-label="What to do"] option').last.get_attribute("value")
    row.locator('select[aria-label="What to do"]').select_option(last); pg.wait_for_timeout(400)
    ok(pg.evaluate("ITCT.store(S.gstReg || '').dec[%s].act" % json.dumps(key)) == last, "follow-up: what to do is kept")
    note = pg.locator('tr[data-key=%s] input[aria-label="Note"]' % json.dumps(key)); note.fill("asked on phone"); note.press("Tab"); pg.wait_for_timeout(400)
    ok(pg.evaluate("ITCT.store(S.gstReg || '').dec[%s].note" % json.dumps(key)) == "asked on phone", "and a note to it")
    pg.click('.gf-chips button.gf-chip >> nth=0'); pg.wait_for_timeout(400)
    cat = pg.evaluate("S.itctCat"); shown = pg.evaluate("(() => { const t = document.querySelector('.bk-table.fixed'), i = [...t.tHead.rows[0].cells].findIndex(h => /^What$/i.test(h.innerText.trim())); return Array.from(t.tBodies[0].rows).map(r => r.cells[i].innerText.split('\\n')[0]); })()")
    ok(cat and len(set(shown)) == 1, "a chip shows one kind only (%d lines)" % len(shown))
    pg.click('.gf-chips button.gf-chip.on'); pg.wait_for_timeout(300)
    sup = pg.locator('section:has(h3:text-is("Suppliers to write to")) tbody tr').first
    if sup.count():
        k = sup.get_attribute("data-key"); sup.locator('button:text-is("copy")').click(); pg.wait_for_timeout(500)
        ok(len(pg.evaluate("ITCT.store(S.gstReg || '').sent[%s] || []" % json.dumps(k))) == 1 and "not yet" not in pg.locator('tr[data-key=%s]' % json.dumps(k)).inner_text(), "a letter copied is logged as written")
    else: ok(False, "no supplier to write to")
    # reversal: a capital good added, filled in, and removed
    pg.click('nav[aria-label="GST"] button[data-part="rev"]'); pg.wait_for_timeout(500)
    pg.click('button:text-is("Add a capital good")'); pg.wait_for_timeout(400)
    row = 'section:has(h3:text-is("Rule 43: capital goods")) table >> nth=0 >> tbody tr >> nth=-1 >> '
    for k, v in [("name", "LED wall"), ("date", "2025-05-10"), ("igst", "180000")]:
        pg.fill(row + 'input[aria-label="%s"]' % k, v); pg.press(row + 'input[aria-label="%s"]' % k, "Tab"); pg.wait_for_timeout(300)
    a = pg.evaluate("S.books.assets[0]")
    ok(a["name"] == "LED wall" and a["date"] == "2025-05-10" and a["igst"] == 180000, "a capital good typed in is kept")
    pg.select_option(row + 'select[aria-label="Used for"]', "taxable"); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.books.assets[0].use") == "taxable", "and what it is used for")
    pg.click(row + 'button:text-is("Remove")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.books.assets.length") == 0, "Remove")
    # advances: the month with the most, a rate changed, one marked not an advance and back
    pg.evaluate("() => { const ms = GSTR.months(), n = m => GSTAdv.month(m, S.gstReg || '').at.length; S.gstYm = ms.slice().sort((a, c) => n(c) - n(a))[0]; S.gstPart = 'adv'; render(); }"); pg.wait_for_timeout(600)
    if pg.locator('select[aria-label="Rate"]').count():
        rid = pg.evaluate("GSTAdv.month(S.gstYm, S.gstReg || '').at[0].id")
        pg.locator('select[aria-label="Rate"]').first.select_option("5"); pg.wait_for_timeout(400)
        ok(pg.evaluate("S.books.advFix[%s].rate" % json.dumps(rid)) == "5" and "set" == pg.evaluate("GSTAdv.month(S.gstYm, S.gstReg || '').at[0].rateFrom"), "11A: the rate changed is kept")
        n = pg.locator('select[aria-label="Rate"]').count()
        pg.locator('input[aria-label="Not an advance"]').first.click(); pg.wait_for_timeout(400)
        ok(pg.locator('select[aria-label="Rate"]').count() == n - 1 and "Received early, but not in 11A" in pg.inner_text("#app"), "“Not an advance”: out of 11A, into the list left out")
        pg.locator('section:has(h3:text-is("Received early, but not in 11A")) input[aria-label="Not an advance"]').first.click(); pg.wait_for_timeout(400)
        ok(pg.locator('select[aria-label="Rate"]').count() == n, "unticked there: back in 11A")
    else: ok(False, "no advances in these books")
    # amendments: a filed copy with a change, how it is reported, and a copy marked not filed
    pg.evaluate("""() => { const reg = S.gstReg || '', ms = GSTR.months(), n = m => GSTR.one(m, reg).b2b.length, m1 = ms.slice().sort((a, c) => n(c) - n(a))[0];
      const j = JSON.parse(JSON.stringify(GSTR.toJson(m1, reg))); const inv = j.b2b[0].inv[0]; inv.itms[0].itm_det.txval = r2(num(inv.itms[0].itm_det.txval) + 100);
      GSTAmend.keep(j, 'portal'); S.gstYm = ms[ms.indexOf(m1) + 1]; S.gstPart = 'amend'; render(); }"""); pg.wait_for_timeout(600)
    sel = pg.locator('select[aria-label="Report it as"]').first
    sel.select_option("skip"); pg.wait_for_timeout(400)
    ok(list(pg.evaluate("S.books.amendFix").values()) == ["skip"] and pg.locator('select[aria-label="Report it as"]').first.input_value() == "skip", "an amendment set to “leave it” is kept")
    pg.locator('input[aria-label="This copy was not filed"]').first.click(); pg.wait_for_timeout(400)
    ok(pg.evaluate("Object.values(S.books.filed)[0].notFiled") is True, "a filed copy marked as not filed")
    # GSTR-9 and 9C: figures typed for the year, and the 9C PDF shows them
    pg.click('nav[aria-label="GST"] button[data-part="g9"]'); pg.wait_for_timeout(800)
    pg.fill('input[aria-label="15E igst"]', "5000"); pg.press('input[aria-label="15E igst"]', "Tab"); pg.wait_for_timeout(600)
    ok(pg.evaluate("GST9.typed(GST9.fyOf(S.gstYm), S.gstReg || '')['15E'].igst") == 5000, "GSTR-9: a figure not in the books is kept")
    pg.click('nav[aria-label="GST"] button[data-part="g9c"]'); pg.wait_for_timeout(800)
    pg.fill('input[aria-label="adj.5B"]', "100000"); pg.press('input[aria-label="adj.5B"]', "Tab"); pg.wait_for_timeout(600)
    r = 'textarea[aria-label="6. Reasons for the unreconciled difference"]'
    pg.fill(r, "Unbilled revenue of March"); pg.press(r, "Tab"); pg.wait_for_timeout(600)
    st = pg.evaluate("GST9C.st(gst9Where().fy, gst9Where().reg)")
    ok(st["adj"]["5B"] == 100000 and st["reasons"]["6"] == "Unbilled revenue of March", "GSTR-9C: an adjustment and a reason are kept")
    pg.evaluate("() => { window.__printed = ''; window.printView = (t, h) => { window.__printed = h; }; }")
    pg.click('button:text-is("Download (PDF)")'); pg.wait_for_timeout(400)
    pdf = pg.evaluate("window.__printed")
    ok("100000" in pdf and "Unbilled revenue of March" in pdf and "<input" not in pdf and "<button" not in pdf, "the 9C PDF carries what was typed, as text")
    # filing, under 3B: the date filed and the portal's interest kept, the journal, the 3B kept as filed
    pg.evaluate("() => { const ms = GSTR.months(), n = m => GSTR.one(m, S.gstReg || '').b2b.length; S.gstYm = ms.slice().sort((a, c) => n(c) - n(a))[0]; gstPartGo('r3b'); }"); pg.wait_for_timeout(800)
    pg.fill('input[aria-label="GSTR-3B filed on"]', "2026-02-20"); pg.press('input[aria-label="GSTR-3B filed on"]', "Tab"); pg.wait_for_timeout(400)
    pg.fill('input[aria-label="portalInt"]', "12345"); pg.press('input[aria-label="portalInt"]', "Tab"); pg.wait_for_timeout(400)
    rec = pg.evaluate("GSTF.peek(S.gstYm, S.gstReg || '')")
    ok(rec.get("r3b") == "2026-02-20" and rec.get("portalInt") == 12345, "filing: the date filed and the portal's interest are kept")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(m); }; }")
    pg.click('button:text-is("Set-off journal for Tally")'); pg.wait_for_timeout(600)
    J = pg.evaluate("(() => { const J = GSTF.journal(S.gstYm, S.gstReg || ''); return {n: J.lines.length, ok: J.balanced}; })()")
    saved, toasts = pg.evaluate("window.__saved"), pg.evaluate("window.__toasts")
    ok((J["n"] and J["ok"] and any("GST-setoff" in n for n in saved)) or (not J["ok"] and any("missing in Tally" in t for t in toasts)) or (not J["n"] and any("Nothing to set off" in t for t in toasts)),
       "the set-off journal downloads, or says why not (%s lines, balanced %s)" % (J["n"], J["ok"]))
    pg.click('button:text-is("Mark this 3B as filed and keep a copy")'); pg.wait_for_timeout(600)
    ok(pg.evaluate("!!GSTF.peek(S.gstYm, S.gstReg || '').snap") and "kept as filed" in pg.inner_text("#app"), "3B marked as filed, with a copy kept")
    pg.click('button.linkbtn:text-is("remove the kept copy")'); pg.wait_for_timeout(400)
    ok(not pg.evaluate("!!GSTF.peek(S.gstYm, S.gstReg || '').snap"), "and the kept copy removed")
    # quarterly (QRMP): in a quarter's first month, the IFF file, the date filed and PMT-06 paid
    pg.evaluate("() => { LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true); GSTSet.store(S.gstReg || '').filing = [{type: 'qrmp', from: GSTR.months()[0]}]; S.gstYm = GSTSet.qStart(S.gstYm); S.booksTab = 'gst'; gstPartGo('qtr'); }"); pg.wait_for_timeout(700)
    pg.click('button:text-is("Download IFF JSON")'); pg.wait_for_timeout(500)
    ok(any(n.startswith("IFF_") for n in pg.evaluate("window.__saved")), "QRMP: the IFF file downloads")
    pg.fill('input[aria-label="PMT-06 paid igst"]', "2000"); pg.press('input[aria-label="PMT-06 paid igst"]', "Tab"); pg.wait_for_timeout(400)
    pg.select_option('select[aria-label="PMT-06 method"]', "self"); pg.wait_for_timeout(400)
    rec = pg.evaluate("GSTF.peek(S.gstYm, S.gstReg || '')")
    ok(rec["pmt06"]["igst"] == 2000 and rec["pmtMethod"] == "self" and pg.locator(".gq-step.done").count() >= 1, "PMT-06 paid and the method are kept; the step is ticked")
    pg.evaluate("() => { GSTSet.store(S.gstReg || '').filing = []; render(); gstPartGo('r3b'); }"); pg.wait_for_timeout(500)
    pg.click('button.linkbtn:text-is("change in GST settings") >> nth=0'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.tab") == "gstset", "“change in GST settings” opens them")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
