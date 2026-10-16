"""python3 run_tdsgst_layout.py - the TDS & GST makeover (round 46, 11-Oct-2026; the owner: "TDS 26AS and TDS return are
different things, should be in different tabs; page looks very heavy; GST and TDS return status inside the client list is
illogical"), used as a person would, on the fixture books (tests/fixtures/books, and the same a year on):

  - the firm's Compliance page (#/compliance, in the sidebar) lists the returns and payments due; Today keeps one line;
    the Clients list shows no return figures or status;
  - a client's TDS (tds-layout, 14-Oct-2026): no tabs; the year's grid; the old Challans, 26AS, TRACES files and Checks
    addresses open the register, Reconciliations, After filing and To fix; Every year and the downloads under More;
  - a return: the summary card (the figures, the status, one main button, More) on top, Deductions · Challans · To fix ·
    Return file · After filing below;
  - GST: Returns · 2B & ITC · Supplier health · Checks, every part reachable;
  - old addresses go to the new places (…/certs → Checks, a return's …/summary → its entries);
  - the sidebar's TDS opens the returns, not From Tally (clean-up batch 1: TDS and GST each a sidebar item); the ledgers-to-confirm banner once, on Returns;
  - Reports' and MIS's compliance links open the Compliance page;
  - a phone's width: no sideways scroll, the tabs on one line.
Layout only: the figures and files are run_tdsgst_ui.py's. Runs on the React build (app/dist-test) or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("LAYOUT_PORT") or 8337)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        E, W = pg.evaluate, pg.wait_for_timeout
        pg.goto("http://localhost:%d/" % PORT); W(2500); pg.click('button[data-act="useOffline"]'); W(2000)
        E("window.__dueToday = '2026-10-11'")
        E(LOAD, books); W(1000); E("S.books = window.__bk; render();"); W(500); E(CHALLANS); W(300)
        cid = E("S.coId")
        E("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-08-05', token: '123456789012345'}}; return saveBooks(); }")
        def hash_go(h, wait=1200):
            E("(h) => { location.hash = h; }", h); W(wait)
        vis = lambda sel: E("(s) => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null).length", sel)
        text = lambda sel="#app": pg.inner_text(sel)

        print("1. firm: Compliance, Today, Clients")
        E("navHome('today')"); W(1500)
        ok(pg.locator('#side button:has-text("Compliance")').count() == 1, "the firm's sidebar has Compliance")
        ok(pg.locator("#app [data-due-list]").count() == 0 and pg.locator("#app [data-due-line]").count() == 1, "Today: one line, no list")
        pg.click('#side button:has-text("Compliance")'); W(1500)
        ok(E("location.hash") == "#/compliance" and "Compliance" in text("#cobar"), "the sidebar opens #/compliance, titled Compliance")
        rows = pg.locator("#app [data-due-list] tr[data-due]").count()
        ok(rows > 0 and pg.locator("#app [data-due-sum]").count() == 1, "Compliance lists the returns and payments due, the answer first (%d rows)" % rows)
        views = E("[...document.querySelectorAll('#app [data-due-chip]')].map(b => b.dataset.dueChip)")
        ok(views == ["overdue", "month", "filed", "all"], "views: Overdue · Due this month · Filed · All (%s)" % views)
        ok(pg.locator("#app [data-due-tax-pick]").count() == 1 and pg.locator("#app [data-due-client]").count() == 1, "filters: GST/TDS and client")
        right = E("(() => { const td = document.querySelector('#app [data-due-list] tbody td.n'); return td ? getComputedStyle(td).textAlign : ''; })()")
        ok(right in ("right", "end"), "amounts right-aligned (%s)" % right)
        hash_go("#/today", 1200); hash_go("#/compliance", 1500)
        ok(E("S.homeTab") == "compliance", "the address #/compliance opens it directly")
        E("navHome('clients')"); W(800)
        heads = E("[...document.querySelectorAll('#app table thead th')].map(t => t.innerText.trim()).filter(Boolean)")
        ok(heads and not any(h.startswith(("TDS", "GSTR", "GST return", "Due", "Overdue", "Return", "Filed")) for h in heads), "the Clients list: no return figures or status (%s)" % heads)

        print("2. the client's TDS: the tabs")
        E("(c) => { S.booksTab = 'import'; S.booksLast = ''; return openCompany(c); }", cid); W(600)
        E("() => { S.books = window.__bk; render(); }"); W(300)
        # clean-up batch 1: TDS and GST each a sidebar item (Returns); From Tally (with Tally ledgers) and Audit (with the tie-out) their own
        pg.click('#side button[data-side="TDS"]'); W(800)
        ok(E("booksTab()") == "tds" and E("S.tdsView") in ("year", "years"), "the sidebar's TDS opens TDS Returns, not From Tally (%s)" % E("booksTab()"))
        side = E("[...document.querySelectorAll('#side .side-link')].map(b => b.dataset.side)")
        # (t70: From Tally is reached from the top bar's Tally panel, not the sidebar)
        ok(all(w in side for w in ["TDS", "GST", "Audit"]) and "From Tally" not in side and side.index("TDS") < side.index("GST"), "TDS and GST in the sidebar (%s)" % side)
        # tds-layout (14-Oct-2026, the owner: "too many tabs; salary, challans, 26AS and TRACES don't belong as top tabs"): the
        # TDS page has no tabs; Challans is the challan register, 26AS the client's Reconciliations, TRACES files a return's
        # After filing, Checks a return's To fix (run_tds_newlayout.py checks the rest of the new layout)
        hash_go("#/c/%s/books/tds/2026-27" % cid)
        ok(pg.locator("#app nav[aria-label=TDS]").count() == 0 and pg.locator("#app [data-tds-sec]").count() == 0, "the TDS page: no tabs")
        ok(pg.locator("#app [data-tds-grid='2026-27']").count() == 1, "the year's grid of forms × quarters")
        ok(pg.locator("#app [data-tieout]").count() == 0 and pg.locator("#app [data-limits]").count() == 0, "no checks under the grid")
        ok(pg.locator("#app [data-ledger-banner]").count() == 1, "the ledgers to confirm: one line")
        pg.click("#app [data-tds-bar] details.more > summary"); W(200)
        more = E("[...document.querySelectorAll('#app [data-tds-bar] .more-item')].map(b => b.textContent)")
        ok("Every year" in more and "Download the whole year" in more and any(m.startswith("Download the year, Form 140") for m in more) and "The challan register" in more, "More: Every year, the register and the year's downloads (%s)" % more)
        pg.click("#app [data-tds-more='years']"); W(400)
        ok(E("S.tdsView") == "years" and "Every year" in text(), "More › Every year")
        want = {"challans/Q1": ("register", "/books/tds/2026-27/challan-register", "[data-register]"), "26as": ("recon", "/books/recon", "[data-upload='as26']"),
                "traces": ("after", "/books/tds/2026-27/", "[data-after-filing]"), "checks/rates": ("checks", "/books/tds/2026-27/", "[data-certs]")}
        for k, (where, h, sel) in want.items():
            hash_go("#/c/%s/books/tds/2026-27/%s" % (cid, k))
            ok(h in E("location.hash") and pg.locator("#app " + sel).count() >= 1, "the old …/%s opens its new place: %s (%s)" % (k, where, E("location.hash").split("/books/")[-1]))
        hash_go("#/c/%s/books/tds/2026-27/checks/rates" % cid)
        for k, sel in {"limits": "[data-limits='2026-27']", "tieout": "[data-tieout='2026-27']", "rates": "[data-certs]"}.items():
            pg.click("#app [data-fix='%s']" % k); W(400)
            ok(pg.locator("#app " + sel).count() >= 1, "To fix › the year's checks › %s" % k)

        print("3. a return")
        hash_go("#/c/%s/books/tds/2026-27/Q1/26Q/summary" % cid)
        ok(E("S.tdsTab") == "deductions" and E("location.hash").endswith("/Q1/26Q/deductions"), "the old …/summary opens the deductions, and the address follows (%s)" % E("location.hash"))
        card = "#app [data-return-card='26Q|Q1']"
        ok(pg.locator(card).count() == 1 and "Form 140 (earlier 26Q) · Q1" in text(card + " [data-return-title]"), "the summary card, named Form 140 (earlier 26Q) · Q1")
        ok("Filed 05-Aug-2026" in text(card + " [data-status-tag]"), "the card's status: Filed 05-Aug-2026")
        ok(pg.locator("#app [data-ret-lock='locked']").count() == 1, "filed: the lock said above the tabs")
        ok(all(x in text(card) for x in ["TDS deducted", "Challans", "Not against a challan", "To look at"]), "the card's key figures")
        tabs = E("[...document.querySelectorAll('#app nav[aria-label=Return] button')].map(b => b.textContent.replace(/\\s*\\d+$/, '').trim())")
        ok(tabs == ["Deductions", "Challans", "To fix", "Return file", "After filing"], "tabs below: %s" % tabs)
        hash_go("#/c/%s/books/tds/2026-27/Q2/26Q" % cid)
        ok(vis("#app .btn.primary") == 1 and pg.locator(card.replace("Q1", "Q2") + " [data-card-primary]").count() == 1, "a return not filed: one main button, on the card (%d)" % vis("#app .btn.primary"))
        pg.click("#app [data-return-card='26Q|Q2'] [data-card-primary]"); W(400)
        ok(E("S.tdsTab") == "file" and vis("#app .btn.primary") == 1 and pg.locator("#app [data-return-card] [data-card-primary]").count() == 0, "Make the file → Return file, whose download is then the one main button")
        pg.click("#app [data-return-card] details.more > summary"); W(200)
        ok(any("working" in x for x in E("[...document.querySelectorAll('#app [data-return-card] .more-item')].map(b => b.textContent)")), "the card's More: the working (Excel)")
        for t in ["Deductions", "Challans", "To fix", "Return file", "After filing"]:
            pg.click('#app nav[aria-label="Return"] button:has-text("%s")' % t); W(300)
        ok(not errors, "every tab of the return draws")
        pg.click("#app [data-return-card] .ret-back"); W(400)
        ok(E("S.tdsView") == "year", "← the year, from the card")
        hash_go("#/c/%s/books/tds/2026-27/Q1/24Q" % cid)
        ok(pg.locator("#app [data-return-card='24Q|Q1']").count() == 1 and E("S.tdsTab") == "deductions", "Form 138: its card, opened on Deductions")
        hash_go("#/c/%s/books/tds/2025-26/certs" % cid)
        ok(E("[S.tdsView, S.tdsTab, S.tdsFix]") == ["return", "checks", "rates"] and pg.locator("#app [data-certs]").count() == 1, "the old …/certs opens To fix › section 197 certificates (%s)" % E("location.hash"))

        print("4. GST")
        hash_go("#/c/%s/books/gst/07/202603/year" % cid)
        gsecs = E("[...document.querySelectorAll('#app nav[aria-label=\"GST sections\"] button')].map(b => b.textContent)")
        # ledger-confirm (14-Oct-2026): the GST ledgers are a section of the GST page ("Ledgers", with the count to confirm)
        ok(gsecs[:4] == ["Returns", "2B & ITC", "Supplier health", "Checks"] and len(gsecs) == 5 and gsecs[4].startswith("Ledgers"), "GST tabs: %s" % gsecs)
        ok(pg.locator("#app [data-gst-grid]").count() == 1 and pg.locator("#app [data-ledger-banner]").count() == 1, "Returns: the year's grid, and the banner once")
        sec_parts = {"returns": ["r1", "r3b", "amend", "adv", "g9", "g9c", "vault"], "itc": ["r2b", "inreg", "follow", "rev"], "health": ["health"], "checks": ["filedcmp", "recon"]}
        for sec, parts in sec_parts.items():
            pg.click("#app [data-gst-sec='%s']" % sec); W(600)
            shown = E("[...document.querySelectorAll('#app nav[aria-label=GST] [data-part]')].map(b => b.dataset.part)")
            for part in parts:
                if len(parts) > 1 or sec == "returns":
                    # (round 6: a GSTR-1 or 3B open chooses the return in its title; the chips' row is gone there)
                    if pg.locator("#app nav[aria-label=GST] [data-part='%s']" % part).count(): pg.click("#app nav[aria-label=GST] [data-part='%s']" % part)
                    else: pg.select_option("#app [data-return-card] select[aria-label=Return]", part)
                    W(500)
                ok(E("S.gstPart") == part and E("S.gstView") == "return" and ("/" + part) in E("location.hash") and (sec == "returns") == (pg.locator("#app [data-ledger-banner]").count() == 1),
                   "GST › %s › %s (%s)" % (sec, part, E("location.hash").split("/books/")[-1]))
        hash_go("#/c/%s/books/gst/07/202603/r3b/summary" % cid)
        ok(pg.locator("#app [data-return-card='r3b|202603'] [data-return-title]").count() == 1 and pg.locator("#app [data-return-card] [data-card-primary]").inner_text() == "Download GSTR-3B JSON",
           "GSTR-3B: its summary card, one main button")
        ok(vis("#app .btn.primary") == 1, "one main button on the page (%d)" % vis("#app .btn.primary"))
        hash_go("#/c/%s/books/gst/07/202603/r2b" % cid)
        ok(E("location.hash").endswith("/r2b") and E("(() => { const b = document.querySelector('#app [data-gst-sec=itc]'); return b && b.getAttribute('aria-selected'); })()") == "true", "an old 2B address opens 2B & ITC")

        print("5. Reports and MIS link to Compliance")
        E("() => RPT.open('due-all')"); W(1200)
        ok(E("S.homeTab") == "compliance" and E("S.view") == "home", "Reports › Returns and payments due → Compliance")
        E("(c) => openCompany(c)", cid); W(500); E("() => { S.books = window.__bk; render(); }"); W(300)
        ok(E("RPT.LIST.some(r => r[0] === 'mis-comp' && r[2] === 'GST and TDS by month')"), "Reports keeps MIS's GST and TDS by month, named for what it is")

        # t70 (16-Oct-2026; the owner: "TDS and GST pages take too much space.. column alignment is also not good.. in GST the
        # tax amount is not coming properly and the customer name has excess space.. some columns I can not even see"): the
        # table starts high on the page, every column in view at 1366 without an inner sideways scroll, the figures to the
        # right on one line, the party column not wider than ~32 characters, one ₹, and every figure shown before still shown
        print("7. space and columns (t70)")
        views = [("gst-summary", "/books/gst/07/202603/r1/summary", None, None), ("gst-details", "/books/gst/07/202603/r1/details", None, "#r1Table"),
                 ("gst-details-open", "/books/gst/07/202603/r1/details", "#r1Table tbody tr td button >> nth=0", "#r1Table"), ("gst-3b", "/books/gst/07/202603/r3b/summary", None, None),
                 ("tds-deductions", "/books/tds/2026-27/Q1/26Q/deductions", None, "#tdsDnTable"), ("tds-deductees", "/books/tds/2026-27/Q1/26Q/deductions", "[data-ded-switch=deductees]", "#tdsDeTable")]
        FIX = os.path.join(HERE, "fixtures", "tdsgst-t70-amounts.json")
        capture = os.environ.get("TDSGST_CAPTURE") == "1"
        before = {} if capture else json.load(open(FIX))
        LAYOUT = r"""(main) => { const app = document.querySelector('#app'), vis = (e) => !!e.offsetParent;
          // the lines a piece of text takes (a figure, a name), by the boxes of its text
          const lines = (node) => { if (!node) return 0; const r = document.createRange(); r.selectNodeContents(node); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
          const texts = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = []; let n; while ((n = w.nextNode())) if (n.textContent.trim()) out.push(n); return out; };
          const isNum = (h) => h && (h.classList.contains('n') || h.hasAttribute('data-numeric') || h.dataset.role === 'amount');
          const out = {top: null, wrap: null, party: null, cut: [], nums: [], heads: [], wrapped: [], partyLines: [], rr: (app.innerText.match(/₹\s*₹/g) || []).length};
          const t = main && document.querySelector(main);
          if (t) { out.top = Math.round(t.querySelector('thead').getBoundingClientRect().top - app.getBoundingClientRect().top);
            const w = t.closest('.lt-wrap, .bk-tablewrap'); out.wrap = [w.scrollWidth, w.clientWidth];
            const hs = [...t.querySelector(':scope > thead > tr').children], pi = hs.findIndex((h) => /^(Customer|Deductee|Buyer)/.test(h.innerText.trim()));
            if (pi >= 0) { out.party = Math.round(hs[pi].getBoundingClientRect().width);
              [...t.querySelectorAll(':scope > tbody > tr')].filter((tr) => tr.children.length === hs.length).forEach((tr) => { const ts = texts(tr.children[pi]).sort((a, b) => b.textContent.length - a.textContent.length);
                if (ts[0]) out.partyLines.push([ts[0].textContent.trim().slice(0, 30), lines(ts[0])]); }); }
            // a section's code (393(1) Sl. 6(i) [old 194C]) is read at a glance: not squeezed onto three or more lines
            const si = hs.findIndex((h) => /^Section/.test(h.innerText.trim()));
            out.secLines = si < 0 ? [] : [...t.querySelectorAll(':scope > tbody > tr')].filter((tr) => tr.children.length === hs.length).map((tr) => { const f = texts(tr.children[si])[0]; return f ? [f.textContent.trim(), lines(f)] : ['', 0]; }); }
          for (const tb of [...app.querySelectorAll('table')].filter(vis)) {
            const hs = [...tb.querySelectorAll(':scope > thead > tr:last-child > th')];
            hs.forEach((h) => { if (isNum(h) && h.innerText.trim() && !/right|end/.test(getComputedStyle(h).textAlign)) out.heads.push(h.innerText.trim()); });
            for (const c of tb.querySelectorAll(':scope > thead > tr > th, :scope > tbody > tr > td, :scope > tfoot > tr > td'))
              if (vis(c) && c.scrollWidth > c.clientWidth + 1) out.cut.push(c.innerText.trim().slice(0, 30) + ' (' + c.scrollWidth + '>' + c.clientWidth + ')');
            tb.querySelectorAll(':scope > tbody > tr').forEach((tr) => { if (tr.children.length !== hs.length) return; [...tr.children].forEach((td, i) => {
              const h = hs[i], first = texts(td)[0];
              if (!first) return;
              const dt = h.classList.contains('dt') || h.dataset.role === 'date';
              if (isNum(h) && /\d/.test(first.textContent) && !/right|end/.test(getComputedStyle(td).textAlign)) out.nums.push(first.textContent.trim());
              if ((isNum(h) || dt) && /\d/.test(first.textContent) && lines(first) > 1) out.wrapped.push(first.textContent.trim()); }); }); }
          // text cut with an ellipsis (or clipped in a figure box) in the tables, the filter bars, the card and the tiles
          for (const e of app.querySelectorAll('table *, [data-filter-bar] *, [data-return-card] *, .dash-tiles *, .ret-card *')) {
            if (!vis(e) || /^(SELECT|INPUT|OPTION|svg|path)$/i.test(e.tagName)) continue;
            const cs = getComputedStyle(e);
            if ((cs.textOverflow === 'ellipsis' || e.classList.contains('dtile')) && e.scrollWidth > e.clientWidth + 1) out.cut.push(e.className + ': ' + e.innerText.trim().slice(0, 40));
          }
          // the closed value of every box in the card and the filter bars shown whole (a select's chosen words, a find box's
          // hint); the ledgers' pill on the card's first row with the period; a rate's reason on two lines at most
          const cv = document.createElement('canvas').getContext('2d'); out.fit = [];
          for (const e of app.querySelectorAll('[data-return-card] select, [data-return-card] input, [data-filter-bar] select, [data-filter-bar] input[type=search]')) {
            if (!vis(e)) continue; const cs = getComputedStyle(e); cv.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
            const t = e.tagName === 'SELECT' ? (e.selectedOptions[0] ? (e.selectedOptions[0].label || e.selectedOptions[0].text) : '') : (e.value || e.placeholder);
            const need = cv.measureText(t).width, room = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            if (need > room + 1) out.fit.push(t + ' (' + Math.round(need) + '>' + Math.round(room) + ')'); }
          const pill = app.querySelector('[data-return-card] [data-ledger-banner]'), sel = app.querySelector('[data-return-card] .ret-head select');
          out.pill = pill && sel ? Math.round(pill.getBoundingClientRect().top - sel.getBoundingClientRect().bottom) : null;
          // round 4 (the owner: one row for the return and its period): the period's boxes are the title, on one line with the
          // actions; no filter row of boxes under the tabs (the filters are in the table's headers); the find box, Needs
          // fixing, Export and Import at the right of the tabs' row
          const acts = app.querySelector('[data-return-card] .ret-acts'), cy = (e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
          out.oneLine = sel && acts ? Math.round(Math.abs(cy(sel) - cy(acts))) : null;
          out.rowBars = [...app.querySelectorAll('[data-filter-bar]')].filter((b) => vis(b) && !b.closest('[data-return-card]') && !b.closest('.tg-tabrow') && b.querySelector('select')).length;
          out.hfs = t ? [...t.querySelectorAll(':scope > thead select')].map((e) => e.getAttribute('aria-label')) : [];
          out.chips = app.querySelectorAll('[data-return-card] ~ * nav[aria-label=GST], .tg-tabrow nav[aria-label=GST]').length;
          out.sub2 = (app.querySelector('[data-return-card] .ret-line2') || {}).innerText || '';
          out.inTabs = [...app.querySelectorAll('.tg-tabrow input[type=search], .tg-tabrow [data-ded-filter], .tg-tabrow [data-fb-out], .tg-tabrow [data-ded-import-btn]')].filter(vis).length;
          out.why = [...app.querySelectorAll('.tg-why')].filter(vis).map((e) => [e.innerText, lines(e)]);
          return out; }"""
        AMOUNTS = r"""() => [...new Set((document.querySelector('#app').innerText.match(/₹\s*-?[\d,]+(?:\.\d+)?/g) || []).map((s) => s.replace(/\s/g, '')))].sort()"""
        got = {}
        for (vw, vh) in ((1440, 900), (1366, 768)):
            pg.set_viewport_size({"width": vw, "height": vh})
            for name, h, click, main in views:
                hash_go("#/c/%s%s" % (cid, h), 1300)
                E("() => { S.tdsDedView = ''; S.r1Open = ''; S.tdsSel = {}; render(); }"); W(300)
                if click: pg.click(click); W(500)
                E("window.scrollTo(0, 0)"); W(100)
                m, amts = E(LAYOUT, main), E(AMOUNTS)
                at = "%s at %d×%d" % (name, vw, vh)
                if vw == 1440: got[name] = amts
                if name in ("gst-details", "tds-deductions") and vw == 1440:
                    lim = 260 if name == "tds-deductions" else 230
                    ok(m["top"] is not None and m["top"] <= lim, "%s: the table's header %s px below the top of the page (at most %d)" % (at, m["top"], lim))
                if name in ("gst-details", "gst-details-open", "tds-deductions", "tds-deductees") and vw == 1366:
                    ok(m["wrap"] and m["wrap"][0] <= m["wrap"][1] + 1, "%s: every column in view, no sideways scroll inside the table (%s)" % (at, m["wrap"]))
                if m["party"] is not None:
                    ok(m["party"] <= 340, "%s: the %s column at most ~32 characters wide (%d px)" % (at, "customer" if "gst" in name else "deductee", m["party"]))
                    ok(m["partyLines"] and all(n <= 2 for _, n in m["partyLines"]), "%s: each name on at most two lines (%s)" % (at, m["partyLines"][:4]))
                if m.get("secLines"):
                    ok(all(n <= 2 for _, n in m["secLines"]), "%s: each section's code on at most two lines (%s)" % (at, m["secLines"][:3]))
                ok(not m["cut"], "%s: nothing cut off or hidden behind '…' (%s)" % (at, m["cut"][:4]))
                ok(not m["fit"], "%s: every box shows its chosen value whole (%s)" % (at, m["fit"][:4]))
                if m["pill"] is not None:
                    ok(m["pill"] >= 0, "%s: the ledgers to confirm on the card's second line, under the title (%d)" % (at, m["pill"]))
                if m["oneLine"] is not None:
                    ok(m["oneLine"] <= 6, "%s: the return's period boxes and its actions on one line (%d px apart)" % (at, m["oneLine"]))
                if name.startswith("gst-"):
                    ok(m["chips"] == 0, "%s: no row of the return's parts under the card (the title chooses the return) (%d)" % (at, m["chips"]))
                    ok("07AAGCL4827M1Z3" not in m["sub2"], "%s: the GSTIN once, in the title (%s)" % (at, m["sub2"][:60]))
                if name in ("gst-details", "tds-deductions", "tds-deductees"):
                    ok(m["rowBars"] == 0, "%s: no row of filter boxes over the table (%d)" % (at, m["rowBars"]))
                    want = {"tds-deductions": ["Month", "PAN", "Section", "Challan", "Rate"], "tds-deductees": ["PAN", "Section", "Challan", "Rate"], "gst-details": ["Part"]}[name]
                    ok(sorted(m["hfs"]) == sorted(want), "%s: the filters in the table's headers (%s)" % (at, m["hfs"]))
                    ok(m["inTabs"] >= (3 if name == "tds-deductions" else 2), "%s: find and Export (and Needs fixing, Import) at the right of the tabs' row (%d)" % (at, m["inTabs"]))
                ok(all(n <= 2 for _, n in m["why"]), "%s: a rate's reason on two lines at most (%s)" % (at, m["why"][:2]))
                ok(not m["nums"] and not m["heads"], "%s: the figures and their headers to the right (%s %s)" % (at, m["nums"][:3], m["heads"][:3]))
                ok(not m["wrapped"], "%s: each figure and date on one line (%s)" % (at, m["wrapped"][:4]))
                ok(m["rr"] == 0, "%s: one ₹ before a figure, never ₹₹" % at)
                if not capture:
                    miss = [a for a in before.get(name, []) if a not in amts]
                    ok(not miss and before.get(name), "%s: every figure shown before is still shown (%d; missing %s)" % (at, len(before.get(name, [])), miss[:5]))
                pg.screenshot(path=os.path.join(HERE, "out", "t70-%s-%dx%d.png" % (name, vw, vh)))
        pg.set_viewport_size({"width": 1440, "height": 900})
        hash_go("#/c/%s/books/tds/2026-27/Q1/26Q/deductions" % cid, 1300); E("() => { S.tdsDedView = ''; S.tdsFl = {}; render(); }"); W(300)
        pg.select_option("#tdsDnTable thead select[aria-label=PAN]", "no"); W(400)
        th = E("(() => { const s = document.querySelector('#tdsDnTable thead select[aria-label=PAN]'); return s ? [s.closest('th').className, s.className] : null; })()")
        ok(th and "th-filtered" in th[0] and " on" in " " + th[1], "a header's filter set: its header tinted, its ▾ filled (%s)" % th)
        ok(pg.locator("#app [data-ded-clear]").count() == 1, "Clear filters beside the count while a filter is on")
        pg.click("#app [data-ded-clear]"); W(400)
        ok(pg.locator("#app [data-ded-clear]").count() == 0 and E("Object.values((S.tdsFl || {}).deductions || {}).every(v => !v)"), "… and gone once cleared")
        pg.select_option("#tdsDnTable thead select[aria-label=PAN]", "inop"); W(400)
        ok(pg.locator("#tdsDnTable thead select[aria-label=PAN]").count() == 1 and pg.locator("#app [data-list-empty]").count() == 1 and pg.locator("#app [data-ded-clear]").count() == 1,
           "nothing matching: the headers and their filters stay, with Clear filters")
        pg.click("#app [data-ded-clear]"); W(400)
        if capture:
            json.dump(got, open(FIX, "w"), indent=1, ensure_ascii=False); print("  captured the figures to", FIX)
        pg.set_viewport_size({"width": 1440, "height": 1000})

        print("6. phone")
        pg.set_viewport_size({"width": 390, "height": 844})
        for h in ["#/compliance", "#/c/%s/books/tds/2026-27" % cid, "#/c/%s/books/tds/2026-27/Q1/26Q" % cid, "#/c/%s/books/gst/07/202603/year" % cid, "#/c/%s/books/tds/2025-26/26as" % cid]:
            hash_go(h, 1300)
            w = E("document.documentElement.scrollWidth")
            hs = E("[...document.querySelectorAll('#app nav[aria-label=Books], #app nav[aria-label=TDS], #app nav[aria-label=\"GST sections\"]')].map(n => n.getBoundingClientRect().height)")
            ok(w <= 392 and all(x <= 56 for x in hs), "phone %s: no sideways scroll (%d px), tabs on one line (%s)" % (h.split("/books/")[-1], w, hs))
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
