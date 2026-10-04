"""python3 run_ui_review_0110b.py - the UI review of 01-Oct-2026 (second list, client Testing AAD): tabs on their own row
with short header chips, tabs that look like tabs, the same step names on Purchase, Bank and Sales, tabs at the top of
MIS / Accounts / Audit, one basis for receivables and payables, one count of ledgers to confirm, one books-freshness
sentence, every month of the books in GST, Accounts run by itself for the last full year, the removals in a More menu
behind the client's name and kept to restore, one date format, the sidebar date, MIS From / To, build.json and the
no-cache index.html; then every client page at 1366, 1440, 1920 and 375 px wide: every tab and the main button in view,
no sideways scrolling. Uses Testing AAD's books (tests/data/books-cache.json, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ui_review_0110b.py"""
import json, os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8183), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8183/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    # Testing AAD with its books; a later journal (01-Jul-2026) as in the cloud copy
    cid = pg.evaluate("""(bk) => { const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      bk.vouchers.push({id: "j-0107", date: "20260701", type: "Journal", no: "J1", party: "", ent: [{l: "Cash", a: -100}, {l: "Capital Account", a: 100}]});
      bk.meta.to = "20260701";
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books);
      window.__bk = S.books; S.booksTab = "gst"; render(); return c.id; }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    go = lambda js: (pg.evaluate("() => { S.books = window.__bk; " + js + "; render(); }"), pg.wait_for_timeout(700))

    # 9. every month of the books in GST, as Apr-2025
    ms = pg.evaluate("GSTR.months()")
    ok(ms[0] == "202504" and ms[-1] == "202607" and "202604" in ms and "202606" in ms and len(ms) == 16, "9. GST months: every month from Apr-2025 to Jul-2026, Apr-Jun 2026 included (%d)" % len(ms))
    ok(pg.evaluate("GSTR.label('202504')") == "Apr-2025", "9. months labelled Apr-2025")
    opts = pg.evaluate("Array.from(document.querySelectorAll('select[aria-label=\"Month\"] option')).map(o => o.textContent)")
    ok("Apr-2026" in opts and "Jun-2026" in opts, "9. the GST month list shows Apr-2026 to Jun-2026 (%s)" % opts[-4:])
    # 7. one count of ledgers to confirm
    go("S.booksTab = 'gst'")
    tab = pg.evaluate("(document.querySelector('nav.sbar button[aria-selected]') ? Array.from(document.querySelectorAll('#app nav.sbar button')).map(b => b.textContent).join('|') : '')")
    n_tab = re.search(r"(\d+) to confirm", tab); banner = re.search(r"(\d+) ledgers? (are|is) still to be confirmed", pg.inner_text("#app"))
    ok(n_tab and banner and n_tab.group(1) == banner.group(1), "7. the tab and the GST page say the same number of ledgers to confirm (%s / %s)" % (n_tab and n_tab.group(1), banner and banner.group(1)))
    # 8. one freshness sentence
    fr = pg.inner_text("#app [data-fresh]") if pg.locator("#app [data-fresh]").count() else ""
    ok(fr.startswith("Books: last entry 01-Jul-2026"), "8. one books-freshness sentence: " + fr[:90])
    go("S.booksTab = 'reports'")
    fr2 = pg.locator("#app [data-fresh]").first.inner_text() if pg.locator("#app [data-fresh]").count() else ""
    ok(fr2.startswith("Books: last entry 01-Jul-2026"), "8. Reports says the same: " + fr2[:90])
    txt = pg.inner_text("#app")
    ok("Books up to" not in txt and "run to" not in txt, "8. no other wording of how fresh the books are")
    # 11. Reports opens on the last year with sales; 5, 6: one basis, payables positive, advances apart
    ok(pg.evaluate("RPT.range().fy") == "2025", "11. Reports opens on 2025-26, the last year with sales (2026-27 has one journal)")
    sales = pg.evaluate("RPT.data().pl.heads.rev.t")
    ok(sales > 0, "11. sales for 2025-26 read: %s" % sales)
    pg.evaluate("S.rptFy = '2026'; render();"); pg.wait_for_timeout(500)
    ok("no sales entries in 2026-27 yet (1 entry in the books this year)" in pg.inner_text("#app"), "11. 2026-27 chosen: says there are no sales entries yet, not just nil")
    pg.evaluate("S.rptFy = '2025'; render();"); pg.wait_for_timeout(500)
    d = pg.evaluate("(() => { const d = RPT.data(), r = d.recv.sum, p = d.pay.sum; return {owe: r.owe, over: r.nb[3] + r.nb[4], payOwe: p.owe, payAdv: p.advance, recvAdv: r.advance}; })()")
    ok(d["over"] <= d["owe"] + 1, "5. over 90 days (%s) is part of what is owed to you (%s)" % (d["over"], d["owe"]))
    ok(d["payOwe"] >= 0 and d["payAdv"] >= 0, "6. you owe %s (positive); advances to suppliers %s shown apart" % (d["payOwe"], d["payAdv"]))
    tiles = pg.evaluate("Array.from(document.querySelectorAll('#app .dtile')).map(t => t.innerText.replace(/\\n/g, ' | '))")
    ok(any(t.startswith("You owe") and "-" not in t.split("|")[1] for t in tiles) and any(t.startswith("Advances to suppliers") for t in tiles), "6. the tiles: You owe positive, Advances to suppliers apart")
    # 4. tabs at the top of MIS, Accounts and Audit
    for bt, label in [("mis", "MIS"), ("fs", "Accounts"), ("audit", "Audit")]:
        go("S.booksTab = '%s'" % bt)
        y = pg.evaluate("(() => { const n = document.querySelector('#app nav.sbar'); return n ? n.getBoundingClientRect().top + scrollY : 9999; })()")
        ok(y < 300, "4. %s: the tabs are at the top (%d px down)" % (label, y))
    go("S.booksTab = 'audit'")
    ok(pg.evaluate("(() => { const a = document.querySelector('#app nav.sbar[aria-label=\"Areas\"]'), h = document.querySelector('[data-audit-head]'); return !a || !h || a.getBoundingClientRect().top < h.getBoundingClientRect().top; })()"), "4. Audit: the area tabs above the period and settings")
    # 12. Accounts runs by itself for the last full year
    go("S.booksTab = 'fs'"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.fsRun && S.fsRun.fy") == "2025" and pg.locator("#app .fs-doc").count() == 1, "12. Accounts: the statements for 2025-26 are there without pressing Run now")
    # 16. MIS From / To labelled, with dates
    go("S.booksTab = 'mis'")
    lab = pg.evaluate("Array.from(document.querySelectorAll('[data-mis-head] label.f span')).map(s => s.textContent)")
    vals = pg.evaluate("[document.querySelector('input[aria-label=\"MIS from\"]').value, document.querySelector('input[aria-label=\"MIS to\"]').value]")
    ok(lab[:2] == ["From", "To"] and all(re.match(r"\d{4}-\d{2}-\d{2}$", v) for v in vals), "16. MIS From / To labelled, with dates in them (%s)" % vals)
    # 3. step names
    ok(pg.evaluate("[BANK_TABS.map(x => x[1]), SALES_TABS.map(x => x[1])]") == [["To review", "Post to Tally", "In Tally"]] * 2, "3. Bank and Sales: To review · Post to Tally · In Tally")
    go("S.tab = 'invoices'")
    hb = pg.evaluate("Array.from(document.querySelectorAll('#cobar nav.sbar button')).map(b => b.firstChild.textContent.trim())")
    ok(hb[:3] == ["To review", "Post to Tally", "In Tally"] and hb[3:] in (["Duplicates", "Deleted"], ["Duplicates", "Deleted", "No entry"]) and hb.count("To review") == 1, "3. Purchase, one row of tabs (review of 02-Oct-2026): %s" % hb)
    # 1. chips short, full text on hover; tabs on their own row
    chip = pg.locator("#cobar .tallychip"); t = chip.inner_text().strip()
    ok(len(t) <= 26 and t.startswith("Tally") and "Tally:" in (chip.get_attribute("title") or ""), "1. Tally chip short (%s), the full words on hover" % t)
    rows = pg.evaluate("(() => { const s = document.querySelector('#cobar .headrow > nav.sbar'), r = document.querySelector('#cobar .topright'); return s && r ? [s.getBoundingClientRect().top, r.getBoundingClientRect().bottom, s.getBoundingClientRect().width, document.querySelector('#cobar .headrow').getBoundingClientRect().width] : null; })()")
    ok(rows and rows[0] >= rows[1] - 1 and rows[2] >= rows[3] - 2, "1. the tabs on their own full-width row below the chips (%s)" % rows)
    pg.evaluate("S.account = {firm: {plan: 'pro', balance: 499900000}}; render();"); pg.wait_for_timeout(300)
    cr = pg.locator("#cobar [data-credit]")
    ok(cr.count() == 1 and cr.inner_text() == "₹49.99 Cr credit", "1. credit chip: %s" % (cr.inner_text() if cr.count() else "none"))
    pg.evaluate("S.account = null; render();")
    # 2. tabs look like tabs: the chosen one filled and underlined, dark text
    st = pg.evaluate("(() => { const b = document.querySelector('#cobar nav.sbar button[aria-selected=\"true\"]'), o = document.querySelector('#cobar nav.sbar button[aria-selected=\"false\"]'); const cs = getComputedStyle(b), co = getComputedStyle(o); return [cs.borderBottomWidth, cs.backgroundColor, cs.fontWeight, co.color]; })()")
    ok(st[0] == "3px" and st[1] not in ("rgba(0, 0, 0, 0)", "transparent") and int(st[2]) >= 700, "2. the chosen tab is filled, bold and underlined (%s)" % st)
    # 13. More menu, typed name, soft deletes
    go("S.tab = 'books'; S.booksTab = 'import'")
    ok(pg.locator('#app [data-more="books"]').count() == 1 and pg.evaluate("Array.from(document.querySelectorAll('#app button')).filter(b => /Remove what is here|Remove Tally data/.test(b.textContent) && !b.closest('[data-more]')).length") == 0, "13. the removals are in a More menu")
    n0 = pg.evaluate("S.books.vouchers.length")
    pg.evaluate("document.querySelector('#app [data-more=\"books\"]').open = true"); pg.click('#app [data-more="books"] button:has-text("Remove what is here")'); pg.wait_for_timeout(300)
    pg.fill("#cbxName", "Testing"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.books.vouchers.length") == n0 and "exactly" in pg.inner_text("#confirmBox"), "13. a wrong name: nothing removed, it says so")
    pg.fill("#cbxName", "testing aad"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.books.vouchers.length") == 0, "13. the client's name typed: removed")
    pg.wait_for_timeout(500); pg.evaluate("render()"); pg.wait_for_timeout(500)
    pg.evaluate("document.querySelector('#app [data-more=\"books\"]').open = true"); pg.click('#app [data-more="books"] button:has-text("Restore")'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("S.books.vouchers.length") == n0, "13. More → Restore puts the books back (%d entries)" % n0)
    pg.evaluate("window.__bk = S.books")
    # clear sent: a soft delete
    pg.evaluate("""(cid) => { const e = newEntry('old.pdf'); e.status = 'approved'; e.exportedAt = '2026-01-01T00:00:00Z'; e.snapshot = {}; S.data[cid].entries[e.id] = e; window.__old = e.id; }""", cid)
    pg.evaluate("doAct('clearSent')"); pg.wait_for_timeout(300); pg.fill("#cbxName", "Testing AAD"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(400)
    e = pg.evaluate("(cid) => { const e = S.data[cid].entries[window.__old]; return e ? [e.status, e.deleted && e.deleted.status] : null; }", cid)
    ok(e == ["deleted", "approved"], "13. Clear sent invoices: kept, under Deleted (%s)" % e)
    pg.evaluate("(cid) => billRestore(window.__old)", cid); pg.wait_for_timeout(200)
    ok(pg.evaluate("(cid) => S.data[cid].entries[window.__old].status", cid) == "approved", "13. restored as it was (approved, already in Tally), not to be posted again")
    # 15. the sidebar's dates say what they are
    sv = pg.inner_text("#side [data-side-date]")
    # owner's spec K1 (04-Oct-2026): the build stamp is in Settings' About line, not the sidebar
    ok(sv.startswith("Today ") and "Build " not in sv and sv.count("-20") == 1, "15. sidebar: " + sv.replace("\n", " / ")[:80])
    # 14. one date format
    ok(pg.evaluate("shortDate('2026-08-05')") == "05-Aug-2026", "14. lists show 05-Aug-2026, not 05 Aug")
    # 17. build.json and no-cache
    html = open(os.path.join(SITE, "index.html")).read()
    ok('http-equiv="Cache-Control" content="no-cache' in html and os.path.exists(os.path.join(SITE, "build.json")), "17. index.html not to be cached; build.json names the build")

    # every client page at four widths: every tab and the main button in view, no sideways scroll
    pages = [("dash", "S.tab = 'dash'"), ("inbox", "S.tab = 'clientInbox'"), ("txn", "S.tab = 'txn'"), ("purchase review", "S.tab = 'invoices'"), ("purchase post", "S.tab = 'export'"),
             ("purchase done", "S.tab = 'done'"), ("bank", "S.tab = 'bank'"), ("sales", "S.tab = 'sales'")]
    pages += [("books " + t, "S.tab = 'books'; S.booksTab = '%s'" % t) for t in ["import", "ledgers", "tds", "gst", "reports", "mis", "fs", "audit", "lookup", "letters"]]
    pages += [("setup " + t, "S.tab = '%s'" % t) for t in ["settings", "cotally", "cotds", "deductees", "gstset", "bankset", "bankrules", "coclosed"]]
    probe = """() => { const W = innerWidth, out = {scroll: document.documentElement.scrollWidth - W, hidden: []};
      const sel = '#cobar nav.sbar button, #app nav.sbar button, #app .bk-tabs button, #cobar .tbar-actions .btn.primary, #app .setnav button';
      document.querySelectorAll(sel).forEach(b => { const r = b.getBoundingClientRect(); if (r.width === 0) return;
        let el = b.parentElement, clip = false; while (el) { const cs = getComputedStyle(el); if (/auto|scroll|hidden/.test(cs.overflowX)) { const pr = el.getBoundingClientRect(); if (r.left < pr.left - 1 || r.right > pr.right + 1) clip = true; } el = el.parentElement; }
        if (r.left < -1 || r.right > W + 1 || clip) out.hidden.push(b.textContent.trim().slice(0, 30)); });
      return out; }"""
    for w in [1366, 1440, 1920, 375]:
        pg.set_viewport_size({"width": w, "height": 900}); bad = []
        for name, js in pages:
            go(js)
            r = pg.evaluate(probe)
            if r["scroll"] > 1 or r["hidden"]: bad.append("%s (scroll %d, hidden %s)" % (name, r["scroll"], r["hidden"][:3]))
        ok(not bad, "%d px: every client page, every tab and the main button in view, no sideways scroll%s" % (w, "" if not bad else ": " + "; ".join(bad[:6])))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
