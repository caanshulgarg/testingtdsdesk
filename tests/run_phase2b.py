"""python3 run_phase2b.py - review of 30 Sep 2026, items 28, 34, 36, 37 and 38, checked the way a user would see them.
Offline, a made-up client. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_phase2b.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(H, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8174), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CONTRAST = open(os.path.join(HERE, "contrast_check.js")).read()
SETUP = """() => { const c = newCompany({name: "ZZ Phase Two B Traders Private Limited", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  for (let i = 0; i < 4; i++){ const e = newEntry("b" + i + ".pdf"); Object.assign(e.x, {vendorName: "Vendor " + i + " Technologies", invoiceNo: "X/" + i, invoiceDate: "2026-09-1" + i, taxable: 1000 * (i + 1), total: 1180 * (i + 1)});
    e.natureId = "professional"; e.partyLedger = "Vendor " + i; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; Store.saveEntry(c.id, e); }
  Store.saveCompany(c); return c.id; }"""
def start(p, w, h=900):
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8174/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(SETUP); pg.evaluate("(c) => openCompany(c)", cid); pg.wait_for_timeout(800)
    return br, pg, cid
with sync_playwright() as p:
    br, pg, cid = start(p, 1050)
    # 28. the sales strip: the title has its own room, nothing on top of it
    pg.evaluate("() => goClient('sales')"); pg.wait_for_timeout(800)
    r = pg.evaluate("""() => { const box = s => document.querySelector('#app .bk-head ' + s).getBoundingClientRect(), a = box('.bk-id'), f = box('.bk-figs'), b = box('.bk-actions');
      const hit = (x, y) => !(x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top);
      return {id: Math.round(a.width), figs: hit(a, f), acts: hit(a, b) || hit(f, b)}; }""")
    ok(not r["figs"] and not r["acts"] and r["id"] >= 160, "28. at 1,050 px the Sales title, its count, the figures and the buttons do not overlap (title %d px wide)" % r["id"])
    # 34. contrast (WCAG AA) on the main screens, a name for every sidebar button, a focus ring
    bad = []
    for js in ["goClient('dash')", "goClient('bills')", "goStep('review','bills')", "goClient('sales')", "goClient('txn')", "goClient('bank')", "goClient('books')", "navHome('clients')", "navHome('help')"]:
        pg.evaluate("() => { " + js + " }"); pg.wait_for_timeout(600)
        bad += [js + ": " + x for x in pg.evaluate(CONTRAST) if "bk-empty-ic" not in x]   # the empty-page icon is a mask image, not text
    ok(not bad, "34. text contrast at least 4.5:1 (3:1 for large text) on nine screens" + ("" if not bad else ": " + "; ".join(bad[:4])))
    # the colour scheme of 02-Oct-2026 (379ff74) took amber from its tokens: --flag is --warn, on --flag-soft (--warn-soft)
    fl = pg.evaluate("(() => { const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim().replace('#', '').toUpperCase(); const k = [0.2126, 0.7152, 0.0722], L = h => h.match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4)).reduce((a, x, i) => a + k[i] * x, 0); const f = g('--flag'), b = g('--flag-soft'); return [f, b, Math.round((L(b) + .05) / (L(f) + .05) * 100) / 100]; })()")
    ok(fl[2] >= 4.5, "34. amber text on light amber: #%s on #%s, %s:1" % tuple(fl))
    pg.evaluate("() => goClient('bills')"); pg.wait_for_timeout(500)
    names = pg.evaluate("[...document.querySelectorAll('#side button')].map(b => b.getAttribute('aria-label') || '')")
    ok(names and all(names) and any(n.startswith("Purchase") and "4 waiting" in n for n in names) and any(n.startswith("Client: ZZ Phase Two B") for n in names), "34. every sidebar button has a name read out (" + names[1] + ")")
    pg.focus("#side .side-link"); pg.keyboard.press("Tab"); pg.wait_for_timeout(200)
    ring = pg.evaluate("(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.className, s.outlineStyle, parseFloat(s.outlineWidth)]; })()")
    ok(ring[1] != "none" and ring[2] >= 2, "34. a focus ring shows when moving with Tab (" + str(ring) + ")")
    # 36. post as Journal or as Purchase, as the client books it
    pg.evaluate("() => { goSetup('tally'); }") if pg.evaluate("typeof goSetup === 'function'") else None
    xml = lambda: pg.evaluate("() => { const co = CO(), e = Object.values(D().entries)[0]; e.snapshot = compute(e); return voucherXml(e, co); }")
    ok('VCHTYPE="Journal"' in xml(), "36. a new client posts bills as Journal vouchers")
    pg.evaluate("() => coCommit('voucherType', 'Purchase')")
    ok('VCHTYPE="Purchase"' in xml() and "<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>" in xml(), "36. Client setup → Purchase voucher: the bill goes to Tally as a Purchase voucher")
    pg.evaluate("() => coCommit('voucherType', 'Purchase - Services')")
    ok('VCHTYPE="Purchase - Services"' in xml(), "36. or the client's own voucher type, by its name in Tally")
    ok(pg.evaluate("(() => { const co = CO(), e = Object.values(D().entries)[0]; return vchTypeOf(e, co); })()") == "Purchase - Services", "36. Transactions shows the same voucher type")
    pg.evaluate("() => coCommit('voucherType', 'Journal')")
    # 37. help: the topics, in the order of the menu, and each screen's ? opens its own
    arts = pg.evaluate("GUIDE.all().map(x => x.t)"); areas = pg.evaluate("[...new Set(GUIDE.all().map(x => x.area))]")
    need = ["Reports", "Look up", "Confirmations and reminders", "MIS (management reports)", "Audit of the books", "Bank rules", "27Q (TDS on payments to non-residents)", "TCS (tax collected at source)"]
    ok(all(n in arts for n in need), "37. the guide has Reports, Look up, Letters, MIS, Audit, Bank rules, 27Q and TCS")
    ok(areas[-1] == "Help" and areas.index("TDS") < areas.index("GST") < areas.index("Reports") < areas.index("MIS") < areas.index("Audit") < areas.index("Look up") < areas.index("Letters"), "37. sections follow the menu on the left, Help last (" + " · ".join(areas) + ")")
    seen = {}
    for name, js in [("Purchase", "goClient('bills')"), ("Bank", "goClient('bank')"), ("Sales", "goClient('sales')"), ("Reports", "goClient('books:reports')"), ("MIS", "goClient('books:mis')"), ("Audit", "goClient('books:audit')"), ("Look up", "goClient('books:lookup')"), ("Letters", "goClient('books:letters')")]:
        pg.evaluate("() => { S.helpOpen = false; Help.after(); " + js + " }"); pg.wait_for_timeout(700)
        btn = pg.locator("header.top .help-btn")
        if not btn.count(): seen[name] = "no button"; continue
        btn.first.click(); pg.wait_for_timeout(300)
        seen[name] = pg.inner_text("#helpPanel .help-head") if pg.locator("#helpPanel").count() else "no panel"
    want = {"Purchase": "Purchase bills", "Bank": "Bank statements", "Sales": "Sales", "Reports": "Reports", "MIS": "MIS", "Audit": "Audit of the books", "Look up": "Look up", "Letters": "Confirmations"}
    ok(all(want[k] in v for k, v in seen.items()), "37. each screen's “? How this tab works” opens its topic: " + ", ".join(k + " → " + v.replace("How this tab works: ", "").split("\n")[0] for k, v in seen.items()))
    pg.evaluate("() => { S.helpOpen = false; Help.after(); }")
    br.close()
    # 38. a phone, 390 px: the sidebar is a bar along the bottom, tables are cards
    br, pg, cid = start(p, 390, 844)
    pg.evaluate("() => goClient('txn')"); pg.wait_for_timeout(900)
    r = pg.evaluate("""() => { const s = document.getElementById('side').getBoundingClientRect(), t = document.querySelector('#app table.txntbl'), tr = t && t.tBodies[0].rows[0];
      return {bottom: Math.round(innerHeight - s.bottom), h: Math.round(s.height), w: Math.round(s.width), cards: !!t && t.classList.contains('cards'), head: t ? getComputedStyle(t.tHead).display : '',
        label: tr ? tr.cells[2].getAttribute('data-label') : '', rowW: tr ? Math.round(tr.getBoundingClientRect().width) : 0, wide: document.documentElement.scrollWidth}; }""")
    ok(r["h"] < 90 and r["w"] >= 380 and r["bottom"] < 30, "38. at 390 px the menu is a bar along the bottom (%d px high, %d px from the bottom)" % (r["h"], r["bottom"]))
    ok(r["cards"] and r["head"] == "none" and r["label"] and r["rowW"] <= 370, "38. Transactions: each row is a card, values labelled (" + r["label"] + ")")
    ok(r["wide"] <= 392, "38. nothing runs off the side of the page (page %d px wide)" % r["wide"])
    pg.evaluate("() => goStep('review','bills')"); pg.wait_for_timeout(800)
    ok(pg.evaluate("[...document.querySelectorAll('#app table')].filter(t => t.offsetParent).every(t => t.classList.contains('cards') || t.classList.contains('nocards'))"), "38. the review table is cards too")
    pg.click('#side button[aria-label^="Sales"]'); pg.wait_for_timeout(600)
    ok(pg.evaluate("S.tab") == "sales", "38. the bottom bar works (Sales opened)")
    pg.set_viewport_size({"width": 1200, "height": 900}); pg.evaluate("() => goClient('txn')"); pg.wait_for_timeout(800)
    ok(pg.evaluate("!document.querySelector('#app table.cards') && getComputedStyle(document.getElementById('side')).top === '0px'"), "38. back on a wide screen: tables and sidebar as before")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
