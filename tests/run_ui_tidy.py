"""python3 run_ui_tidy.py - the ui-tidy round (13-Oct-2026), used as a person would, on the fixture books
(tests/fixtures/books, and the same a year on), the made-up client of shots_ui_pass.py and the Tally stand of
run_tally_link_simple.py. The owner: "Page of gst and tds, every detail is showing at the last of the page.. mis and reports
are also very cluttered.. make this simple. Filters and columns are also uneven"; "still it is very confusing where is the
client and how to link tally"; of a purchase bill opening: "there is some glitch also while opening this".

  1. a detail opens beside what was clicked, never at the foot of the page: a ledger of MIS's profit and loss in the drawer
     (its top in the window), Esc and Back close it, the address keeps it (applied again, as on Refresh, it opens again);
     a GST month (Checks) and a TDS challan open directly under their row;
  2. one filter bar: the same height (36 px) and the parts in the one order (period, type, client, search, Clear) on TDS,
     a TDS return, Challans, GST, MIS, Reports, Compliance and Clients;
  3. the figures in the tables right-aligned in tabular figures;
  4. a phone (390 px): no sideways scroll of the page on any of those pages, and at most one banner a page (desktop too);
  5. MIS and Reports: the answer first, at most four key figures, the sections folded but the first;
  6. a client is reachable from the sidebar, the Clients list, Ctrl+K (by name, GSTIN or PAN) and the header's switcher;
     the breadcrumb is Clients › <client> › <page>;
  7. every Tally entry point (the client strip's chip, the Clients list's chip, Today's not-linked line, Getting ready, the
     firm's Tally page, the top bar's sign while not linked) lands on that client's one Link to Tally card, whose three
     steps tick by themselves with the stand: none, the bridge beating, a company seen, linked;
  8. the purchase bill's drawer: opened from the list and from its address, at 1440x900 and 1280x800, the CPU slowed 4x
     and its PDF arriving late: no layout shift above 0.01, the PDF's place its final size before the PDF arrives, the
     drawer at its top (no jump to a field) and in place within one animation; its name once, Read again and Delete under
     More, one amber line, one line for what stops Approve.
Layout only: the figures and files are run_tdsgst_ui.py's and run_figures_agree.py's. Runs on the React build (app/dist-test)
or TDSDESK_SITE. Screenshots to tests/out/ui_tidy/."""
import os, sys, re, json, base64, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
import run_tally_link_simple as TL
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UI_TIDY_PORT") or 8353)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "ui_tidy"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
B3 = open(os.path.join(HERE, "run_clean_b3.py")).read()
VIS = re.search(r'^VIS = "(.*?)"$', B3, re.M).group(1)
BANNERS = re.search(r'BANNERS = """(.*?)""" % VIS', B3, re.S).group(1) % VIS
SEED = re.search(r'SEED = """(.*?)"""', open(os.path.join(HERE, "shots_ui_pass.py")).read(), re.S).group(1)
PROBE = """(() => { if (window.__ls) return; window.__ls = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__ls.push({t: e.startTime, v: e.value, el: (e.sources || []).map((s) => s.node && s.node.className ? String(s.node.className).slice(0, 40) : '').join(',')}); })).observe({type: 'layout-shift', buffered: true}); } catch (e) {} })();"""
# the owner's bill of 13-Oct-2026: Mastercad Solutions' purchase from Shree Nandikeshwar, read free from the PDF text, one
# field amber, the payment type to confirm, its PDF kept in the firm's documents (here handed over 900 ms late)
def _pdf():
    text = "BT /F1 18 Tf 60 760 Td (SHREE NANDIKESHWAR TRADERS) Tj 0 -30 Td (Tax invoice SNT/26-27/113) Tj 0 -30 Td (Total Rs 1,25,000.00) Tj ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            "<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs): offs.append(len(out)); out += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
    x = len(out); out += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
    return (out + "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)).encode("latin-1")
PDF = base64.b64encode(_pdf()).decode()
BILL = """([pdf]) => { const cid = Object.keys(S.companies)[0], c = S.companies[cid]; c.name = "Mastercad Solutions";
  const d = S.data[cid], e = d.entries.s2; e.fileName = "SNT-26-27-113.pdf"; e.docPath = "docs/" + cid + "/s2.pdf";
  Object.assign(e.x, {vendorName: "SHREE NANDIKESHWAR TRADERS", invoiceNo: "SNT/26-27/113", vendorGstin: "27ABCPN1234F1Z5", cgst: 9534, sgst: 9534, igst: 0, total: 125000, taxable: 105932, description: "Plotter rolls and toner"});
  e.readMode = "free (PDF text)"; e.checks = ["GSTIN checksum", "totals add up", "tax rate 18%", "date in this year"]; e.uncertain = ["invoiceDate"]; e.confirmType = true;
  const bin = atob(pdf), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__pdf = new File([u], e.fileName, {type: "application/pdf"}); delete S.files.s2;
  const was = FileStore.get.bind(FileStore);
  FileStore.get = (c2, id, path, name) => id === "s2" ? new Promise(r => setTimeout(() => { S.files.s2 = window.__pdf; r(window.__pdf); }, 900)) : was(c2, id, path, name);
  refreshStats(cid); render(); return cid; }"""
GEO = """() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const doc = document.querySelector('#app aside.drawer .billdoc');
  return {drawer: r('#app aside.drawer'), doc: r('#app aside.drawer .billdoc'), state: doc ? doc.getAttribute('data-bill-doc') : '', fields: r('#app aside.drawer .withprev .grid'),
    scroll: (document.querySelector('#app aside.drawer') || {}).scrollTop || 0}; }"""
RUN_MIS = "const dr = Audit.defaultRange(S.books); MIS.run(Audit.iso(dr.from), Audit.iso(dr.to), 'run now'); render();"
SCROLLX = "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
# the pages of the round, as addresses of the fixture client (cid), with what to run after
PAGES = [("TDS", "#/c/{cid}/books/tds/2026-27", ""), ("TDS return", "#/c/{cid}/books/tds/2026-27/Q1/26Q", ""), ("Challans", "#/c/{cid}/books/tds/2026-27/challans/Q1", ""),
         ("26AS", "#/c/{cid}/books/tds/2026-27/26as", ""), ("GST", "#/c/{cid}/books/gst/07/202603/year", ""), ("GSTR-3B", "#/c/{cid}/books/gst/07/202603/r3b/summary", ""),
         ("GST checks", "#/c/{cid}/books/gst/07/202603/filedcmp", ""), ("MIS", "#/c/{cid}/books/mis", RUN_MIS), ("Reports", "#/c/{cid}/books/reports", ""),
         ("Compliance", "#/compliance", ""), ("Clients", "#/clients", "")]
BAR_PAGES = ["TDS", "TDS return", "Challans", "GST", "MIS", "Reports", "Compliance", "Clients"]
BAR = """(sel) => { const bars = [...document.querySelectorAll('#app [data-filter-bar]')].filter((b) => b.offsetParent);
  const order = ['period', 'type', 'client', 'search', 'clear'];
  return bars.map((b) => { const slots = [...b.querySelectorAll('[data-fb-slot]')].map((s) => s.dataset.fbSlot);
    const boxes = [...b.querySelectorAll('.fb-f, .fb-search input, .fb-clear')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height));
    return {name: b.getAttribute('aria-label'), h: Math.round(b.getBoundingClientRect().height), slots, inOrder: slots.every((s, i) => i === 0 || order.indexOf(slots[i - 1]) < order.indexOf(s)), boxes: [...new Set(boxes)]}; }); }"""
# the cells of the columns that hold figures (a head marked as a number, or an amount): right-aligned, tabular figures
NUMS = """() => { const out = [];
  for (const t of document.querySelectorAll('#app table')) { if (!t.offsetParent || t.classList.contains('cards')) continue;
    const heads = [...t.querySelectorAll('thead tr:last-child th')];
    const isNum = (h) => h && (h.classList.contains('n') || h.hasAttribute('data-numeric') || h.dataset.role === 'amount');
    t.querySelectorAll('tbody tr').forEach((tr) => { if (tr.children.length !== heads.length) return; [...tr.children].forEach((td, i) => {
      if (!isNum(heads[i])) return; const s = td.innerText.trim().split('\\n')[0]; if (!/\\d/.test(s)) return;
      const cs = getComputedStyle(td); out.push({s, right: /right|end/.test(cs.textAlign), tab: /tabular-nums/.test(cs.fontVariantNumeric)}); }); }); }
  return out; }"""
TOP = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), vh: innerHeight}; }"

def start(br, w, h, scheme="light"):
    pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate("window.__dueToday = '2026-10-11'")
    pg.evaluate(LOAD, books); pg.wait_for_timeout(700); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(300); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
    return pg, pg.evaluate("S.coId")

def go(pg, cid, h, js="", wait=1300):
    pg.evaluate("(h) => { location.hash = h; }", h.format(cid=cid)); pg.wait_for_timeout(wait)
    if js: pg.evaluate("() => { S.books = window.__bk; " + js + " }"); pg.wait_for_timeout(900)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg, cid = start(br, 1440, 900)
        E, W = pg.evaluate, pg.wait_for_timeout

        print("1. a detail beside what was clicked")
        # the ledgers' groups (Tally's own group names, by the ledger's name: the fixture's cache has none), so the profit and
        # loss has its heads and ledgers to open; layout only, no figure is checked here
        E("""() => { const u = {}; (window.__bk.vouchers || []).forEach(v => v.ent.forEach(e => { const l = e.l; if (u[l]) return;
            u[l] = /sale/i.test(l) ? 'Sales Accounts' : /purchase/i.test(l) ? 'Purchase Accounts' : /bank/i.test(l) ? 'Bank Accounts' : /cash/i.test(l) ? 'Cash-in-Hand'
              : /gst|tds|tcs|tax/i.test(l) ? 'Duties & Taxes' : /salar|wage|rent|fee|charge|expense|exp\b|freight|repair|interest|commission|consult/i.test(l) ? 'Indirect Expenses' : 'Sundry Creditors'; }));
          window.__bk.under = u; S.books = window.__bk; render(); }"""); W(300)
        go(pg, cid, "#/c/{cid}/books/mis", RUN_MIS + " S.misTab = 'pl'; render();")
        head = E("(() => { const h = S.books.mis.last.pl.heads; return ['exp', 'rev', ...Object.keys(h)].find(k => h[k] && h[k].led.some(x => !x.so)); })()")
        E("(k) => { S.misOpenHead = k; render(); }", head); W(400)
        led = E("(k) => S.books.mis.last.pl.heads[k].led.find(x => !x.so).l", head)
        main_bottom = E("() => Math.round(document.querySelector('#misPl').getBoundingClientRect().bottom)")
        pg.locator('#misPl button[data-mis-led]').filter(has_text=led).first.click(); W(800)
        d = E(TOP, '[data-detail="misLed"]')
        ok(d and 0 <= d["top"] < d["vh"] and d["top"] < main_bottom and d["left"] > 400, "MIS: a ledger of the profit and loss opens in the drawer beside it, its top in the window (%s)" % d)
        ok(led in pg.inner_text('[data-detail="misLed"]') and "?d=misLed%3A" in E("location.hash"), "  … with that ledger's entries, and the address keeps it (%s)" % E("location.hash")[-40:])
        pg.screenshot(path=os.path.join(OUT, "mis-ledger-drawer.png"))
        pg.keyboard.press("Escape"); W(700)
        ok(pg.locator('[data-detail="misLed"]').count() == 0 and E("booksTab()") == "mis" and "?d=" not in E("location.hash"), "  … Esc closes it, and the client stays open")
        pg.locator('#misPl button[data-mis-led]').filter(has_text=led).first.click(); W(700)
        E("() => history.back()"); W(1200)
        ok(pg.locator('[data-detail="misLed"]').count() == 0 and E("booksTab()") == "mis" and E("S.misTab") == "pl", "  … Back closes it, the page stays")
        pg.locator('#misPl button[data-mis-led]').filter(has_text=led).first.click(); W(700)
        h = E("location.hash"); E("() => { S.detail = null; render(); }"); W(400)
        E("(h) => Route.apply(h)", h); W(1300)
        ok(pg.locator('[data-detail="misLed"]').count() == 1 and led in pg.inner_text('[data-detail="misLed"]'), "  … the address applied again (as on Refresh) opens it again")
        pg.keyboard.press("Escape"); W(500)
        # GST: Filed vs FinCom, a month opens under its row
        go(pg, cid, "#/c/{cid}/books/gst/07/202603/filedcmp")
        pg.click('#app [data-cmp-month="202506"] button.linkbtn'); W(1200)
        row, opn = E(TOP, '#app [data-cmp-month="202506"]'), E(TOP, '#app [data-cmp-open="202506"]')
        ok(row and opn and abs(opn["top"] - row["bottom"]) <= 2, "GST checks: a month's filed returns open directly under its row (%s, %s)" % (row, opn))
        # TDS: a challan's deductions under its row
        # tds-layout (14-Oct-2026): the old TDS › Challans address opens the challan register; a challan opens under its row
        go(pg, cid, "#/c/{cid}/books/tds/2026-27/challans/Q1")
        pg.click('#app table[data-list="tdsRegister"] tbody tr:first-child button.linkbtn:has-text("▸")'); W(600)
        r1, r2 = E(TOP, '#app table[data-list="tdsRegister"] tbody tr:first-child'), E(TOP, '#app table[data-list="tdsRegister"] tbody tr.lt-open')
        ok(r1 and r2 and abs(r2["top"] - r1["bottom"]) <= 2, "TDS challan register: a challan's details open directly under its row (%s, %s)" % (r1, r2))

        print("2. one filter bar, 3. figures right-aligned, 4. one banner")
        bars = {}
        for name, h, js in PAGES:
            go(pg, cid, h, js)
            b = E(BAR, None); bars[name] = b
            if name in BAR_PAGES:
                ok(len(b) >= 1 and all(x["h"] == 36 and x["inOrder"] and x["boxes"] in ([36],) for x in b), "%s: the one filter bar, 36 px high, its parts in the one order (%s)" % (name, [(x["name"], x["h"], x["slots"], x["boxes"]) for x in b]))
            n = E(NUMS); bad = [x for x in n if not (x["right"] and x["tab"])]
            ok(not bad, "%s: the figures right-aligned in tabular figures (%d cells%s)" % (name, len(n), "; not: " + str(bad[:3]) if bad else ""))
            bn = E(BANNERS)
            ok(len(bn) <= 1, "%s: at most one banner (%s)" % (name, bn))
        heights = sorted(set(x["h"] for n in BAR_PAGES for x in bars[n]))
        ok(heights == [36], "the filter bars the same height on every page (%s)" % heights)

        print("5. MIS and Reports: the answer first")
        go(pg, cid, "#/c/{cid}/books/mis", RUN_MIS + " S.misTab = 'summary'; render();")
        a = E("() => [...document.querySelectorAll('#app [data-answer] .dtile')].map(t => t.querySelector('span').innerText)")
        first = E("() => { const a = document.querySelector('#app [data-answer]'), f = document.querySelector('#app [data-fold]'); return a && f ? a.getBoundingClientRect().top < f.getBoundingClientRect().top : false; }")
        folds = E("() => [...document.querySelectorAll('#app [data-fold]')].map(d => d.open)")
        ok(1 <= len(a) <= 4 and first and folds and folds[0] and not any(folds[1:]), "MIS: at most four key figures first (%s), the sections folded but the first (%s)" % (a, folds))
        pg.screenshot(path=os.path.join(OUT, "mis.png"), full_page=True)
        go(pg, cid, "#/c/{cid}/books/reports")
        a = E("() => [...document.querySelectorAll('#app [data-answer] .dtile')].map(t => t.querySelector('span').innerText)")
        folds = E("() => [...document.querySelectorAll('#app [data-rpt-index] [data-fold]')].map(d => d.open)")
        links = E("() => document.querySelectorAll('#app [data-rpt-index] .rpt-link').length")
        ok(1 <= len(a) <= 4 and folds and folds[0] and not any(folds[1:]) and links == E("RPT.LIST.length"), "Reports: at most four key figures (%s), the areas folded but the first (%s), every report still listed (%d)" % (a, folds, links))
        pg.screenshot(path=os.path.join(OUT, "reports.png"), full_page=True)

        print("6. the client: found from everywhere")
        E("navHome('today')"); W(800)
        pg.click('#side .side-link[data-side="Clients"]'); W(900)
        ok(E("location.hash") == "#/clients" and pg.locator('#app table[data-list="clients"] tbody tr').count() >= 1, "the sidebar's Clients opens the list")
        pg.click('#app table[data-list="clients"] tbody tr:first-child td:first-child'); W(1200)
        ok(E("S.view") == "company" and E("S.coId") == cid, "a row of the list opens the client")
        crumbs = E("() => { const c = document.querySelector('#cobar [data-crumbs]'); return c ? c.innerText.replace(/\\s+/g, ' ').trim() : ''; }")
        ok(crumbs.startswith("Clients ›") and E("CO().name") in crumbs and crumbs.endswith(E("document.querySelector('#cobar .tbar-title h2').innerText")), "the breadcrumb: Clients › the client › the page (%s)" % crumbs)
        ok(pg.locator('#side .side-link[data-side="Clients"]').count() == 1, "inside a client, Clients is in the sidebar")
        # tds-layout (14-Oct-2026; the owner: "why is there Overview, Bills, GST, MIS and Settings in TDS?"): the client's row of
        # pages under the title repeated the sidebar and is gone; the sidebar opens each, the Tally chip is on the title line
        ok(pg.locator('.ctab, [data-client-strip] nav').count() == 0, "no row of the client's pages under the title (the sidebar lists them)")
        side = E("() => [...document.querySelectorAll('#side .side-link')].map(b => b.dataset.side || b.innerText.trim())")
        ok(all(x in side for x in ["Overview", "Purchase", "Bank", "TDS", "GST", "MIS", "Client setup"]), "  … every one of them is in the sidebar (%s)" % side)
        pg.click('#side .side-link[data-side="GST"]'); W(1000)
        ok(E("booksTab()") == "gst", "  … and opens from there (GST)")
        chip = E("() => { const c = document.querySelector('#cobar [data-tally-chip]'), h = document.querySelector('#cobar .tbar-title h2'); if (!c || !h) return null; const a = c.getBoundingClientRect(), t = h.getBoundingClientRect(); return {top: Math.round(a.top), bottom: Math.round(a.bottom), ttop: Math.round(t.top), tbottom: Math.round(t.bottom)}; }")
        ok(chip and chip["top"] < chip["tbottom"] + 30 and chip["bottom"] > chip["ttop"] - 30, "the Tally chip on the title line (%s)" % chip)
        # Ctrl+K: by name, GSTIN and PAN
        pan = E("CO().gstin.slice(2, 12)"); E("() => { CO().pan = CO().gstin.slice(2, 12); }")
        for q in (E("CO().name.slice(0, 6)"), E("CO().gstin"), pan):
            E("navHome('today')"); W(600)
            pg.keyboard.press("Control+k"); W(400)
            pg.fill('.sw input', q); W(300)
            hit = E("() => [...document.querySelectorAll('.sw [data-sw-id], .sw li, .sw button')].map(b => b.innerText).join('|')")
            ok(E("!!S.switcher") and E("CO(S.coId) ? CO(S.coId).name : ''") in hit, "Ctrl+K finds the client by %r" % q)
            pg.keyboard.press("Enter"); W(1200)
            ok(E("S.view") == "company" and E("S.coId") == cid, "  … and Enter opens it")
        pg.click('#cobar [data-client-switch]'); W(500)
        ok(E("!!S.switcher") and pg.locator(".sw input").count() == 1, "the header's client name opens the switcher")
        pg.keyboard.press("Escape"); W(300)
        ok(not E("!!S.switcher") and E("S.view") == "company", "  … Esc closes it, the client stays")
        pg.screenshot(path=os.path.join(OUT, "client-header.png"))
        pg.close()

        print("7. one way to link Tally")
        tl = br.new_page(viewport={"width": 1440, "height": 900}); tl.on("pageerror", lambda e: errors.append(str(e)[:200]))
        tl.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
            body=json.dumps({"setup": {"version": "2.4.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.4.exe", "sha256": "ab" * 32}})))
        tl.goto("http://localhost:%d/" % PORT); tl.wait_for_timeout(2500); tl.click('button[data-act="useOffline"]'); tl.wait_for_timeout(800)
        E2, W2 = tl.evaluate, tl.wait_for_timeout
        lcid = E2("""(g) => { const c = newCompany({name: 'Link Co', gstin: g}); c.tallyName = 'Link Co'; S.companies[c.id] = c;
            S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); return c.id; }""", TL.GSTIN)
        def scene(companies, devs):
            E2(TL.SETUP, [devs, [], companies, "owner", []]); W2(300)
        def on_card(where):
            ok(E2("S.view") == "company" and E2("S.coId") == lcid and E2("S.tab") == "cotally" and tl.locator("#app section.tlink[data-tally-link]").count() == 1,
               "%s → Link Co's Link to Tally card (%s %s)" % (where, E2("S.view"), E2("S.tab")))
        scene(TL.SEEN, TL.DEVS)
        E2("(c) => openCompany(c).then(() => goClient('dash'))", lcid); W2(1200)
        tl.click('#cobar [data-tally-chip]'); W2(900); on_card("the title line's chip")
        E2("navHome('clients')"); W2(900)
        tl.click('#app table[data-list="clients"] tr:has-text("Link Co") [data-tally-chip]'); W2(900); on_card("the Clients list's chip")
        E2("navHome('today')"); W2(900)
        tl.click('#app [data-not-linked-line] [data-not-linked-open="%s"]' % lcid); W2(900); on_card("Today's not-linked line")
        E2("goClient('dash')"); W2(900)
        tl.click('#app button:has-text("Next: Link to Tally"), #app button:has-text("Link to Tally")'); W2(900); on_card("Getting ready's Link to Tally")
        E2("goClient('dash')"); W2(900)
        tl.click('#cobar [data-tally-sign]'); W2(900); on_card("the top bar's Tally sign (not linked)")
        E2("() => { S.tallyFocus = ''; navHome('tally'); }"); W2(1200)
        ok(tl.locator('#app [data-not-linked]').count() == 1 and "Clients not linked (" in tl.inner_text('#app [data-not-linked]'), "the firm's Tally page: Clients not linked (N), first")
        tl.click('#app [data-not-linked-link="%s"]' % lcid); W2(900); on_card("the Tally page's Link")
        chip = E2("() => [...document.querySelectorAll('[data-tally-chip], [data-tally-link-state]')].map(e => e.innerText.trim())")
        ok(chip and all(c.endswith("Not linked → Link") for c in chip), "the same words on the chip and the card (%s)" % chip)
        tl.screenshot(path=os.path.join(OUT, "tally-card-not-linked.png"), full_page=True)
        # the three steps tick by themselves
        steps = lambda: E2("() => [...document.querySelectorAll('#app [data-tally-step]')].map(s => s.hasAttribute('data-done') ? 1 : 0)")
        now = lambda: E2("() => (document.querySelector('#app [data-tally-steps]') || {}).getAttribute ? document.querySelector('#app [data-tally-steps]').getAttribute('data-tally-steps') : ''")
        def card_again():
            E2("(c) => { S.tab = 'cotally'; render(); }", lcid); W2(900)
        scene([], []); card_again()
        ok(steps() == [0, 0, 0] and now() == "1", "no bridge: no step done, on step 1, with the download (%s, now %s, download %d)" % (steps(), now(), tl.locator("#app [data-tally-step='1'] [data-bridge-download]").count()))
        old = [TL.dev(1, "NWS144", "anshul", at="ago:600", opened=())]
        scene([], old); card_again()
        ok(steps() == [0, 0, 0], "a bridge last heard ten hours ago: step 1 not ticked (%s)" % steps())
        scene([], [TL.dev(1, "NWS144", "anshul", opened=())]); card_again()
        ok(steps() == [1, 0, 0] and now() == "2", "the bridge beats: step 1 ticked, on step 2 (%s, now %s)" % (steps(), now()))
        scene(TL.SEEN, TL.DEVS); card_again()
        ok(steps() == [1, 1, 0] and now() == "3", "a company seen: steps 1 and 2 ticked, on step 3 (%s, now %s)" % (steps(), now()))
        tl.click('#app [data-tally-link-to="GARG SHEKHAR"]'); W2(1500)
        E2(TL.SETUP, [[TL.dev(1, "NWS144", "anshul", tally="closed", opened=())], [], TL.LINKED(), "owner", []]); W2(300); card_again()
        st = E2("() => (document.querySelector('#app [data-tally-link]') || {}).dataset ? document.querySelector('#app [data-tally-link]').dataset.tallyLink : ''")
        ok(st == "waiting" and steps() == [1, 1, 1], "linked, Tally closed (Waiting for Tally): all three ticked (%s, %s)" % (st, steps()))
        tl.screenshot(path=os.path.join(OUT, "tally-card-waiting.png"), full_page=True)
        tl.close()

        print("4. a phone: no sideways scroll, one banner")
        for scheme in ("light", "dark"):
            ph, pcid = start(br, 390, 844, scheme)
            for name, h, js in PAGES:
                go(ph, pcid, h, js, 1100)
                sx, bn = ph.evaluate(SCROLLX), ph.evaluate(BANNERS)
                ok(sx <= 0 and len(bn) <= 1, "phone %s, %s: no sideways scroll (%d), at most one banner (%d)" % (scheme, name, sx, len(bn)))
            go(ph, pcid, "#/c/{cid}/books/tds/2026-27/Q1/26Q")
            wrap = ph.evaluate("() => { const w = document.querySelector('#app table[data-list=\"tdsDeductions\"]'); const b = w && w.closest('.lt-wrap, .bk-tablewrap'); return b ? [b.scrollWidth > b.clientWidth, getComputedStyle(b).overflowX] : null; }")
            ok(wrap and wrap[0] and wrap[1] in ("auto", "scroll"), "phone %s: a wide table scrolls sideways inside its own box (%s)" % (scheme, wrap))
            ph.screenshot(path=os.path.join(OUT, "phone-%s-tds-return.png" % scheme), full_page=True)
            ph.close()

        print("8. the purchase bill's drawer")
        for (w, h) in ((1440, 900), (1280, 800)):
            for direct in (False, True):
                ctx = br.new_context(viewport={"width": w, "height": h}); ctx.add_init_script(PROBE)
                bp = ctx.new_page(); bp.on("pageerror", lambda e: errors.append(str(e)[:200])); cdp = ctx.new_cdp_session(bp)
                bp.goto("http://localhost:%d/" % PORT); bp.wait_for_timeout(2500); bp.click('button[data-act="useOffline"]'); bp.wait_for_timeout(1000)
                bcid = bp.evaluate("(b) => { const seed = %s; return seed(null); }" % SEED, None)
                bp.evaluate(BILL, [PDF]); bp.wait_for_timeout(300)
                bp.evaluate("(c) => openCompany(c).then(() => goStep('review', 'bills'))", bcid); bp.wait_for_timeout(1500)
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
                t0 = bp.evaluate("() => { window.__ls = window.__ls || []; return performance.now(); }")
                if direct: bp.evaluate("(c) => { location.hash = '#/c/' + c + '/bill/s2'; }", bcid)
                else: bp.click('#app table.revtbl button.pn:has-text("SHREE NANDIKESHWAR")')
                geo = []
                for i in range(30):
                    geo.append(bp.evaluate(GEO)); bp.wait_for_timeout(60)
                case = "%dx%d %s" % (w, h, "address" if direct else "click")
                cls = round(bp.evaluate("(t) => (window.__ls || []).filter(s => s.t >= t).reduce((a, s) => a + s.v, 0)", t0), 4)
                ok(cls <= 0.01, "bill, %s: no layout shift above 0.01 while the drawer opens (%.4f)" % (case, cls))
                docs = [g["doc"] for g in geo if g["doc"]]
                ok(docs and len(set((d[2], d[3]) for d in docs)) == 1 and any(g["state"] == "loading" for g in geo) and geo[-1]["state"] == "pdf",
                   "bill, %s: the PDF's place has its final size before the PDF arrives (%s; %s)" % (case, sorted(set((d[2], d[3]) for d in docs)), [g["state"] for g in geo][::6]))
                dr = [g["drawer"] for g in geo if g["drawer"]]
                settled = next((i for i, d in enumerate(dr) if all(x == d for x in dr[i:])), None)
                ok(dr and settled is not None and settled * 60 <= 600 and all(g["scroll"] == 0 for g in geo), "bill, %s: the drawer in place within one animation (%s ms), at its top, never scrolled to a field" % (case, settled * 60 if settled is not None else "-"))
                f = geo[-1]["fields"]
                ok(f and f[1] + f[3] <= h, "bill, %s: the bill's fields in view without scrolling (%s, window %d)" % (case, f, h))
                if not direct and w == 1280:
                    t = bp.inner_text("#app aside.drawer")
                    hd, h2 = bp.inner_text("#app .drawer-head"), bp.locator("#app aside.drawer .detail h2")
                    ok(h2.count() == 1 and h2.inner_text() == "SHREE NANDIKESHWAR TRADERS" and "SHREE" not in hd and "SNT/26-27/113" in hd,
                       "bill: its name once, as the bill's title; the drawer's head has its number and place (%r)" % hd)
                    ok("Read free from the PDF text" in t and "all checks passed" in t and "Checks passed:" not in bp.inner_text("#app aside.drawer .dhead .dhead-line > span"), "bill: how it was read in one line, its checks under Details")
                    ok(bp.locator('#app aside.drawer [data-bill-more] .more-item:has-text("Read again: Free")').count() == 1 and bp.locator('#app aside.drawer [data-bill-more] [data-bill-delete]').count() == 1
                       and bp.locator('#app aside.drawer .dhead button:text-is("Free")').count() == 0, "bill: Read again and Delete under ⋯ More")
                    am, un = bp.inner_text("#app [data-amber-line]") if bp.locator("#app [data-amber-line]").count() else "", bp.evaluate("() => [...document.querySelectorAll('#app aside.drawer label.f.unsure > span:first-child')].map(s => s.innerText)")
                    amh = bp.evaluate("() => Math.round(document.querySelector('#app [data-amber-line]').getBoundingClientRect().height)")
                    ok(am.startswith("1 field needs a quick look (amber)") and amh <= 44 and "Invoice date" in un, "bill: one short amber line (%d px), the amber field marked where it sits (%r, %s)" % (amh, am.split("\n")[0], un))
                    bar = bp.inner_text("#app .actionbar")
                    ok(bar.count("payment type") <= 2 and "Still needed" not in bar and bp.locator("#app .actionbar [data-cannot-approve]").count() == 1 and bp.get_attribute('#app .actionbar button.primary', "title") is None,
                       "bill: what stops Approve said once beside it, the To do buttons kept (%s)" % bar.replace("\n", " ")[:160])
                    bp.screenshot(path=os.path.join(OUT, "bill-drawer-1280.png"))
                bp.keyboard.press("Control+Enter"); bp.wait_for_timeout(300)
                ok(bp.evaluate("D().entries.s2.status") == "draft", "bill, %s: Ctrl+Enter is kept (refused while Approve waits)" % case)
                ctx.close()

        print("no page errors")
        ok(not errors, "no page error (%s)" % errors[:3])
        br.close()
finally:
    srv.shutdown()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
