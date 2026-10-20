"""python3 run_clean_b3.py - clean-up batch 3, "Polish" (11-Oct-2026, owner-approved), used as a person would, on the
made-up client of shots_ui_pass.py (4 bills) with the fixture books (tests/fixtures/books) for two years:

  1. one tab style on every page (Arc's underlined tabs): the chosen tab looks the same everywhere; at most six tabs show,
     the rest under More (MIS: six and More, whose tabs still open); one row of tabs a page (Audit's areas and Post to
     Tally's To post / Posted / Errors are chips inside the content); on a phone each tab row is one line;
  2. one content width: the page body starts and ends in the same place on every page (From Tally too);
  3. the tables: a long supplier name ends in "…" inside its cell (the whole name on hover) and the list fits the page at
     1440; ₹ on every amount, right-aligned, in the key tables (Purchase, Post to Tally, Transactions) and on the MIS,
     Audit and Reports figures; "—", not "…", for a figure not there; the header stays in view on the long lists;
  4. at most one banner a page (desktop and phone; with the books of two years, and of one, when a page also says the
     period is not read yet);
  5. Purchase's bar at the foot: inside the content area beside the sidebar, one row, low; on a phone one short row over
     the bottom bar;
  6. Reports: a plain list of the reports by area, each area at most two headline figures (₹), the rest folded under
     "Figures and charts"; a report opens from the list;
  7. Save bars only when something changed (Client setup);
  8. "How this page works", folded, on Overview, Transactions, Accounts and Client setup;
  9. empty states: one sentence and one next step (the client's Inbox, MIS before a run, the audit before a run, Purchase
     with no bills);
 10. old addresses still open, and the tabs do not move when the computer asks for less motion.
Layout and words only. Runs on the React build (app/dist-test) or TDSDESK_SITE. Screenshots to tests/out/clean_b3/."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CLEAN_B3_PORT") or 8349)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "clean_b3"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
# the made-up client with its 4 bills (shots_ui_pass.py), the fixture books on it for two years (or one: one_year), and
# three more clients with nothing in them
SEED0 = re.search(r'SEED = """(.*?)"""', open(os.path.join(HERE, "shots_ui_pass.py")).read(), re.S).group(1)
SEED = """([bk, oneYear]) => { const seed = %s; const cid = seed(null); const c = S.companies[cid];
  for (const [n, g] of [["Mehra Textiles LLP", "07AAAFM1234K1Z5"], ["Iyer Foods Private Limited", "29AAACI9876L1Z2"], ["Bansal & Sons", ""]]) { const o = newCompany({name: n, gstin: g}); S.companies[o.id] = o; o.stats = {}; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; }
  S.coId = cid; const on = (d) => { const t = String(d || ""); return /^\\d{8}$/.test(t) ? String(+t.slice(0, 4) + 1) + t.slice(4) : t; };
  const next = oneYear ? [] : bk.vouchers.map((v) => Object.assign({}, v, {id: v.id + "+1y", date: on(v.date)}));
  const b = Object.assign({loading: false, challans: [], alloc: {}}, bk, {vouchers: bk.vouchers.concat(next), cid: cid});
  if (!oneYear) b.meta = Object.assign({}, bk.meta, {to: on(bk.meta.to)});
  S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
  S.account = Object.assign(S.account || {}, {me: {role: 'owner', user_id: 'u-owner', name: 'Owner'}}); render(); return cid; }""" % SEED0

CL = lambda js: "() => { S.view = 'company'; S.coId = window.__cid; S.books = window.__bk; " + js + " }"
HOME = lambda t: "() => { navHome('%s'); }" % t
RUN_MIS = "const dr = Audit.defaultRange(S.books); MIS.run(Audit.iso(dr.from), Audit.iso(dr.to), 'run now'); render();"
RUN_AUDIT = "const dr = Audit.defaultRange(S.books); Audit.run(dr.from, dr.to, 'by hand'); render();"
PAGES = [
    ("today", HOME("today")), ("clients", HOME("clients")), ("tally", "() => { S.tallyFocus = ''; S.tallyTab = 'computers'; navHome('tally'); }"), ("settings", "() => goSettings(null)"),
    ("help", HOME("help")),
    ("overview", CL("goClient('dash');")), ("purchase", CL("S.filter = 'draft'; goClient('bills');")), ("post", CL("S.postTabs = {}; goStep('post', 'bills');")),
    ("in-tally", CL("goStep('done', 'bills');")), ("bank", CL("goClient('bank');")), ("sales", CL("goClient('sales');")), ("inbox", CL("goClient('inbox');")),
    ("transactions", CL("S.txnTab = 'bills'; goClient('txn');")), ("from-tally", CL("goClient('books:import');")), ("ledgers", CL("goClient('books:ledgers');")),
    ("tds", CL("goClient('books:tds');")), ("gst", CL("goClient('books:gst');")), ("reports", CL("goClient('books:reports');")),
    ("mis", CL("goClient('books:mis'); S.misTab = 'summary'; " + RUN_MIS)), ("accounts", CL("goClient('books:fs');")),
    ("audit", CL("goClient('books:audit'); S.auditTab = 'find'; " + RUN_AUDIT)), ("tie-out", CL("goClient('books:tieout');")),
    ("lookup", CL("goClient('books:lookup');")), ("letters", CL("goClient('books:letters');")),
    ("client-setup", CL("S.step = null; S.tab = 'settings'; render();")), ("client-setup-tally", CL("S.step = null; S.tab = 'cotally'; render();")),
]

VIS = "const vis = (e) => e && e.offsetParent !== null && e.getBoundingClientRect().width > 0 && !e.closest('details:not([open])');"
# the rows of tabs on the page: nav.sbar (not a return's chips, not GST's sub-chips), Bank's and Sales' .bk-tabs, Look up's
# and Letters' .lk-kinds, the Status row of Purchase (its tablist); never a row of chips (.chip-filter)
TABROWS = VIS + """
  const rows = [...document.querySelectorAll('#cobar nav.sbar, #app nav.sbar, #app .bk-tabs, #app .lk-kinds, #app [role=tablist]')]
    .filter(e => vis(e) && !e.matches('.subnav, [aria-label=Return], .chip-filter') && !e.closest('.chip-filter'))
    .filter((e, i, a) => !a.some(o => o !== e && o.contains(e)));
  // (upload-pages: the guide's "?" at the end of the upload pages' row of states is not a tab)
  return rows.map(r => { const tabs = [...r.querySelectorAll('button, details.more > summary')].filter(b => vis(b) && !b.closest('.more-pop') && !b.matches('.help-q'));
    const sel = tabs.find(b => b.getAttribute('aria-selected') === 'true' || b.closest('details[data-on]'));
    const cs = sel ? getComputedStyle(sel) : null;
    return {name: r.getAttribute('aria-label') || r.className, n: tabs.filter(b => !b.matches('summary')).length, more: tabs.some(b => b.matches('summary')),
      lines: new Set(tabs.map(b => Math.round(b.getBoundingClientRect().top))).size,
      look: cs ? [cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor, cs.backgroundColor, cs.fontWeight, cs.borderTopWidth, cs.boxShadow].join(' ') : 'no chosen tab'}; });"""
TABROWS = "() => { " + TABROWS + " }"
# a banner: a box with a soft warning, danger or information colour across most of the page (not a table's row, a figure
# or a tag); one inside another counts once
BANNERS = """() => { %s
  const tmp = document.createElement('div'); document.body.appendChild(tmp);
  const col = (v) => { tmp.style.background = 'var(' + v + ')'; return getComputedStyle(tmp).backgroundColor; };
  const soft = new Set(['--warn-soft', '--bad-soft', '--stop-soft', '--info-soft', '--stamp-soft', '--flag-soft', '--warning-subtle', '--danger-subtle', '--info-subtle'].map(col).filter(c => c && c !== 'rgba(0, 0, 0, 0)'));
  tmp.remove();
  const app = document.getElementById('app'), aw = app.getBoundingClientRect().width;
  return [...app.querySelectorAll('*')].filter(e => vis(e) && soft.has(getComputedStyle(e).backgroundColor) && e.getBoundingClientRect().width > aw * 0.5
      && !e.closest('table, .dtile, .metric, button, .tag, .bk-row, .rp-grid') && !e.matches('input, select, textarea'))
    .filter((e, i, a) => !a.some(o => o !== e && o.contains(e))).map(e => (e.className || e.tagName) + ': ' + e.innerText.slice(0, 50)); }""" % VIS
# where the page's body starts and ends: #app's content box, and the right edge of the widest block in it
WIDTH = """() => { const a = document.getElementById('app'), r = a.getBoundingClientRect(), cs = getComputedStyle(a);
  const l = r.left + parseFloat(cs.paddingLeft), rt = r.right - parseFloat(cs.paddingRight);
  let far = 0; for (const e of a.querySelectorAll('section, .dash-card, .bk, .bk-head, .lt-wrap, .bk-tablewrap, .up-page, .setwrap, nav.sbar, .rpt-index, .dash-tiles, .today, .dash'))
    { if (!e.offsetParent || e.closest('.more-pop, .drawer, details:not([open])')) continue; const b = e.getBoundingClientRect(); if (b.width > 200) far = Math.max(far, b.right); }
  return {left: Math.round(l), right: Math.round(rt), far: Math.round(far), head: Math.round(document.querySelector('header.top .wrap, #cobar').getBoundingClientRect().left)}; }"""
SCROLLX = "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
# the amounts in a table whose column head names money: ₹ in front, two decimals, right-aligned
AMOUNTS = """() => { const out = [];
  for (const t of document.querySelectorAll('#app table')) { if (!t.offsetParent) continue;
    const heads = [...t.querySelectorAll('thead tr:last-child th')].map(h => h.innerText.trim().toLowerCase());
    t.querySelectorAll('tbody tr, tfoot tr').forEach(tr => [...tr.children].forEach((td, i) => {
      if (!/amount|value|taxable|total|₹|balance|debit|credit|tds|gst|withdraw|deposit/.test(heads[i] || '') || /rate|%|section|gstin|limit|type|ledger|return|status|period|vs|book tds/.test(heads[i] || '')) return;
      const s = td.innerText.trim().split('\\n')[0]; if (!/\\d[\\d,]*\\.\\d\\d/.test(s) || /[a-z]{3,}/i.test(s.replace(/\\b(Dr|Cr)\\b/g, ''))) return;
      out.push({s, rs: /^[-−–]?₹/.test(s), right: /right|end/.test(getComputedStyle(td).textAlign)}); })); }
  return out; }"""
FIGS = """(sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(s => /\\d[\\d,]*\\.\\d\\d/.test(s))"""

def start(p, w, h, one_year=False, motion=None):
    pg = p.new_page(viewport={"width": w, "height": h}, reduced_motion=motion or "no-preference"); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    cid = pg.evaluate(SEED, [books, one_year]); pg.evaluate("(c) => { window.__cid = c; }", cid); pg.wait_for_timeout(1200)
    return pg, cid

def walker(pg):
    E, W = pg.evaluate, pg.wait_for_timeout
    def go(js, wait=1200):
        pg.keyboard.press("Escape"); E("() => { S.tallyPanel = false; S.firmMenu = false; S.alertsOpen = false; }"); E(js); W(wait)
    return E, W, go

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pg, cid = start(br, 1440, 900)
        E, W, go = walker(pg)
        title = lambda: pg.inner_text("#cobar .tbar-title h2").strip()

        print("1. one tab style, at most six tabs, one row of tabs")
        looks, widths = {}, {}
        for name, js in PAGES:
            go(js)
            rows = E(TABROWS)
            for r in rows:
                looks.setdefault(r["look"], []).append(name + ":" + r["name"])
                # ROUND 99 (20-Oct-2026, the owner's list): the Financial statements page shows its seven tabs, Checks last
                most = 7 if r["name"] == "Financial statements" else 6
                ok(r["n"] <= most, "%s, %s: %d tabs show (at most %d%s)" % (name, r["name"], r["n"], most, ", the rest under More" if r["more"] else ""))
                ok(r["lines"] == 1, "%s, %s: one line" % (name, r["name"]))
            ok(len(rows) <= 1, "%s: one row of tabs (%s)" % (name, [r["name"] for r in rows]))
            widths[name] = E(WIDTH)
            ok(E(SCROLLX) <= 0, "%s: no sideways scroll at 1440" % name)
        real = {k: v for k, v in looks.items() if k != "no chosen tab"}
        ok(len(real) == 1, "the chosen tab looks the same on every page (%s)" % ({k[:60]: v[:3] for k, v in real.items()}))
        go(CL("goClient('books:mis'); S.misTab = 'summary'; " + RUN_MIS))
        mis = E("[...document.querySelectorAll('#app nav[aria-label=MIS] > button')].filter(b => b.offsetParent).map(b => b.innerText.trim())")
        ok(mis == ["Summary", "Profit and loss", "Receivables", "Payables", "Cash flow", "Ratios"], "MIS: six tabs (%s)" % mis)
        pg.click("#app nav[aria-label=MIS] [data-tabs-more] > summary"); W(300)
        rest = E("[...document.querySelectorAll('#app nav[aria-label=MIS] [data-tabs-more] .more-item')].map(b => b.innerText.trim())")
        ok(rest == ["Sales", "Purchases and expenses", "Registrations", "Cost centres", "Budget", "Compliance"], "MIS → More: the other six (%s)" % rest)
        pg.screenshot(path=os.path.join(OUT, "desk-mis-more.png"))
        pg.click('#app nav[aria-label=MIS] [data-tabs-more] .more-item:text-is("Budget")'); W(700)
        ok(E("S.misTab") == "budget" and "More · Budget" in pg.inner_text("#app nav[aria-label=MIS] [data-tabs-more] > summary"), "  … Budget opens, and More says it is the tab shown")
        ok(pg.locator("#app nav[aria-label=MIS] [data-tabs-more][data-on]").count() == 1, "  … More is the chosen tab while Budget is open")
        go(CL("goClient('books:audit'); S.auditTab = 'find'; " + RUN_AUDIT))
        ok(pg.locator("#app nav.sbar[aria-label=Areas]").count() == 0 and pg.locator("#app .chip-filter[data-audit-areas] button").count() >= 2, "Audit: the areas are chips beside the status, not a second row of tabs")
        n0 = E("document.querySelectorAll('#app .chip-filter[data-audit-areas] button').length")
        pg.click("#app .chip-filter[data-audit-areas] button:has-text('TDS')"); W(500)
        ok(E("S.auditArea") == "tds" and pg.locator("#app .chip-filter[data-audit-areas] button[aria-pressed=true]:has-text('TDS')").count() == 1, "  … a chip filters the findings (%d chips)" % n0)
        E("() => setAndShow('auditArea', '')"); W(300)
        pg.screenshot(path=os.path.join(OUT, "desk-audit.png"))
        go(CL("S.postTabs = {}; goStep('post', 'bills');"))
        # upload-pages (14-Oct-2026): Post to Tally's lists are states of Purchase's one row (Ready to post / Errors / In Tally)
        ok(pg.locator("#app nav.statebar [data-post-tab]").count() >= 2 and pg.locator("#app .post-tabs").count() == 0, "Post to Tally: its lists are states on Purchase's one row, no second row of chips")

        print("2. one content width")
        lefts = {n: w["left"] for n, w in widths.items()}; rights = {n: w["right"] for n, w in widths.items()}
        ok(len(set(lefts.values())) == 1 and len(set(rights.values())) == 1, "the body starts and ends in the same place on every page (%s, %s)" % (sorted(set(lefts.values())), sorted(set(rights.values()))))
        short = {n: (w["far"], w["right"]) for n, w in widths.items() if w["far"] and w["far"] < w["right"] - 4 and n not in ("help",)}
        ok(not short, "every page's content runs the full width (%s)" % short)
        ok(widths["from-tally"]["far"] >= widths["from-tally"]["right"] - 4, "From Tally: full width, as every other page (%d of %d)" % (widths["from-tally"]["far"], widths["from-tally"]["right"]))
        ok(len(set(w["head"] for w in widths.values())) == 1, "the header starts in the same place on every page")

        print("3. the tables")
        go(CL("S.filter = 'draft'; goClient('bills');"))
        long_names = E("""() => [...document.querySelectorAll('#app .revtbl td.pt .pn')].map(b => { const td = b.closest('td').getBoundingClientRect(), r = b.getBoundingClientRect();
          return {name: b.innerText, inside: r.right <= td.right + 0.5, cut: b.scrollWidth > b.clientWidth, ell: getComputedStyle(b).textOverflow, title: b.title}; })""")
        ok(long_names and all(x["inside"] for x in long_names), "Purchase: each supplier's name stays inside its cell (%s)" % [x["name"][:20] for x in long_names if not x["inside"]])
        ok(all(x["ell"] == "ellipsis" and x["title"] == x["name"] for x in long_names), "  … a long one ends in '…', the whole name on hover")
        ok(E("(() => { const w = document.querySelector('#app .revtbl').parentElement; return w.scrollWidth - w.clientWidth; })()") <= 1, "Purchase: the list fits the page at 1440")
        pg.screenshot(path=os.path.join(OUT, "desk-purchase.png"))
        heads = lambda: E("[...document.querySelectorAll('#app .revtbl thead th')].map(h => h.innerText.trim())")
        ok("This year vs limit" not in heads(), "Purchase: 'This year vs limit' is under Columns")
        pg.click("#app [data-rev-cols] > summary"); W(200); pg.click("#app [data-rev-cols] input[type=checkbox]"); W(500)
        ok("This year vs limit" in heads(), "  … where it can be shown again")
        pg.click("#app [data-rev-cols] input[type=checkbox]"); W(400); pg.click("#app [data-rev-cols] > summary"); W(200)
        for name, js in [("Purchase", CL("S.filter = 'draft'; goClient('bills');")), ("Post to Tally", CL("S.postTabs = {}; goStep('post', 'bills');")), ("Transactions", CL("S.txnTab = 'bills'; goClient('txn');")),
                         ("In Tally", CL("goStep('done', 'bills');")), ("MIS (summary)", CL("goClient('books:mis'); S.misTab = 'summary'; " + RUN_MIS))]:
            go(js); am = E(AMOUNTS)
            ok(all(a["rs"] for a in am), "%s: ₹ on every amount in its tables (%d; without: %s)" % (name, len(am), [a["s"] for a in am if not a["rs"]][:4]))
            ok(all(a["right"] for a in am), "%s: the amounts right-aligned" % name)
        for name, js, sel in [("MIS", CL("goClient('books:mis'); S.misTab = 'summary'; " + RUN_MIS), "#app .dtile b"), ("Audit", CL("goClient('books:audit'); S.auditTab = 'find'; " + RUN_AUDIT), "#app .dtile small"),
                              ("Reports", CL("goClient('books:reports');"), "#app .rpt-heads b")]:
            go(js); f = E(FIGS, sel)
            ok(f and all("₹" in x for x in f), "%s: ₹ on its figures (%s)" % (name, f[:3]))
        go(CL("goClient('books:reports');")); pg.click("#app [data-rpt-charts] > summary"); W(500)
        f = E(FIGS, "#app [data-rpt-charts] .dtile b")
        ok(f and all("₹" in x for x in f), "Reports → Figures and charts: ₹ on every figure (%d)" % len(f))
        go(CL("goClient('dash');"))
        ok("…" not in E("[...document.querySelectorAll('#app .dtile b')].map(b => b.innerText).join('|')"), "Overview: '—', never '…', for a count not there yet")
        for name, js in [("Purchase", CL("S.filter = 'draft'; goClient('bills');")), ("Transactions", CL("S.txnTab = 'bills'; goClient('txn');"))]:
            go(js)
            st = E("(() => { const th = document.querySelector('#app table.lt thead th'), w = th && th.closest('.lt-wrap'); return th ? [getComputedStyle(th).position, w ? getComputedStyle(w).overflowY : ''] : null; })()")
            ok(st and st[0] == "sticky" and st[1] in ("auto", "scroll"), "%s: the header stays in view while a long list scrolls (%s)" % (name, st))

        print("4. at most one banner a page")
        for name, js in PAGES:
            go(js, 1000); b = E(BANNERS)
            ok(len(b) <= 1, "desktop, %s: %d banner%s %s" % (name, len(b), "" if len(b) == 1 else "s", b if len(b) > 1 else ""))

        print("5. Purchase's bar at the foot")
        go(CL("S.filter = 'draft'; goClient('bills');"))
        bar = E("""(() => { const a = document.querySelector('.actionbar'), s = document.querySelector('#side'), r = a.getBoundingClientRect(), sr = s.getBoundingClientRect();
          const kids = [...a.querySelectorAll('.ab-left > *, .ab-right > *')].filter(e => e.offsetParent); return {left: r.left, side: sr.right, h: r.height, w: r.width, app: document.getElementById('app').getBoundingClientRect().width,
          lines: new Set(kids.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2) / 4 | 0)).size}; })()""")
        ok(bar["left"] >= bar["side"] - 1, "desktop: the bar starts after the sidebar (%d ≥ %d), so it covers none of it" % (bar["left"], bar["side"]))
        ok(bar["h"] <= 64 and bar["lines"] <= 2, "desktop: one low row (%d px)" % bar["h"])
        ok(pg.locator(".actionbar [data-ab-why]").count() == 1 and pg.locator(".actionbar .why-note").count() == 0, "desktop: why nothing is ready is behind its (i), not a second line")
        pg.click(".actionbar [data-ab-why] > summary"); W(300)
        ok(pg.locator(".actionbar [data-none-ready]").is_visible() and pg.inner_text(".actionbar [data-none-ready]").startswith("No bill is ready: "), "  … the (i) says it")
        pg.screenshot(path=os.path.join(OUT, "desk-purchase-why.png"))
        pg.click(".actionbar [data-ab-why] > summary"); W(200)
        fold = pg.locator("#side .side-brand .side-fold")
        if fold.count():
            fold.first.click(); W(500)
            b2 = E("(() => [document.querySelector('.actionbar').getBoundingClientRect().left, document.querySelector('#side').getBoundingClientRect().right])()")
            ok(pg.locator("#side.side-folded").count() == 1 and b2[0] >= b2[1] - 1 and b2[0] < 120, "desktop, the sidebar folded: the bar starts after it (%d)" % b2[0])
            pg.locator("#side .side-brand .side-fold").first.click(); W(400)

        print("6. Reports: a plain list")
        go(CL("goClient('books:reports');")); E("() => { const d = document.querySelector('#app [data-rpt-charts]'); if (d) d.open = false; }"); W(200)
        groups = E("[...document.querySelectorAll('#app [data-rpt-index] [data-rpt-group]')].map(g => [g.dataset.rptGroup, g.querySelectorAll('.rpt-list .rpt-link').length, g.querySelectorAll('.rpt-heads li').length])")
        ok(len(groups) == 6 and all(g[1] >= 3 for g in groups), "six areas, each its list of reports (%s)" % groups)
        ok(all(g[2] <= 2 for g in groups), "at most two headline figures an area")
        ok(sum(g[1] for g in groups) == E("RPT.LIST.length"), "every report is in the list (%d)" % sum(g[1] for g in groups))
        # ui-tidy (13-Oct-2026; the owner: "mis and reports are also very cluttered"): the answer first, at most four key
        # figures in one row ([data-answer]); every other box of figures folded under Figures and charts
        ok(E("[...document.querySelectorAll('#app .dtile')].filter(e => e.offsetParent && !e.closest('details:not([open])') && !e.closest('[data-answer]')).length") == 0
           and E("document.querySelectorAll('#app [data-answer] .dtile').length") <= 4, "no boxes of figures on the page but the answer's four (the rest folded under Figures and charts)")
        ok(pg.locator("#app [data-rpt-charts]:not([open])").count() == 1 and pg.locator("#app [data-rpt-charts] .dtile").count() >= 20, "  … where every figure and chart still is")
        ok(pg.locator("#app .lk-fresh").count() <= 1 and E(BANNERS) == [], "the books' freshness is a line, not a banner")
        pg.screenshot(path=os.path.join(OUT, "desk-reports.png"), full_page=True)
        # ui-tidy: the areas are sections folded but the first; Customers and suppliers opened first
        pg.click('#app [data-rpt-group="parties"] > summary'); W(300)
        pg.click('#app .rpt-link:has(b:text-is("Receivables ageing"))'); W(1200)
        ok(E("booksTab()") == "mis" and E("S.misTab") == "recv", "a report opens from the list (Receivables ageing → MIS)")

        print("7. Save bars only when something changed")
        go(CL("S.step = null; S.tab = 'settings'; render();"))
        ok(pg.locator("#app [data-confirm-foot].cfm-clean").count() == 1 and pg.locator("#app [data-confirm-foot] [data-cfm=save]").count() == 0, "Client setup: no Save bar while nothing has changed")
        inp = pg.locator("#app .setbody input[type=text]").first
        was = inp.input_value(); inp.fill(was + " x"); W(500)
        ok(pg.locator("#app [data-confirm-foot].cfm-dirty [data-cfm=save]").count() == 1 and "Not saved yet" in pg.inner_text("#app [data-confirm-foot]"), "  … a change brings it, with Save")
        pg.screenshot(path=os.path.join(OUT, "desk-setup-dirty.png"))
        pg.click("#app [data-confirm-foot] [data-cfm=discard]"); W(500)
        ok(pg.locator("#app [data-confirm-foot] [data-cfm=save]").count() == 0, "  … Don't save takes it away again")

        print("8. How this page works")
        for name, js, key in [("Overview", CL("goClient('dash');"), "dash"), ("Transactions", CL("goClient('txn');"), "txn"), ("Financial statements", CL("goClient('books:fs');"), "fs"), ("Client setup", CL("S.step = null; S.tab = 'settings'; render();"), "setup")]:
            go(js)
            h = pg.locator("#app details.howto[data-howto=%s]" % key)
            ok(h.count() == 1 and h.get_attribute("open") is None and pg.inner_text("#app details.howto[data-howto=%s] > summary" % key).strip() == "How this page works", "%s: 'How this page works', folded" % name)
            if h.count():
                pg.click("#app details.howto[data-howto=%s] > summary" % key); W(200)
                t = pg.inner_text("#app details.howto[data-howto=%s] > div" % key)
                ok(0 < len(t) < 420, "  … short (%d characters)" % len(t))

        print("9. empty states: one sentence, one next step")
        go(CL("goClient('inbox');"))
        e = pg.locator("#app [data-inbox-empty]")
        ok(e.count() == 1 and e.locator("button").count() == 1 and e.inner_text().count(". ") <= 1, "the client's Inbox, empty: one sentence and How to send documents in")
        go(CL("goClient('books:mis'); S.misRange = null; const bk = S.books; bk.mis = {}; render();"))
        e = pg.locator("#app [data-mis-empty]")
        ok(e.count() == 1 and e.locator("button").count() == 1, "MIS before a run: one sentence and Run now")
        go(CL("goClient('books:audit'); S.auditTab = 'find'; S.books.audit = {}; render();"))
        e = pg.locator("#app [data-audit-empty]")
        ok(e.count() == 1 and e.locator("button").count() == 1, "the audit before a run: one sentence and Run now")
        other = E("Object.keys(S.companies).find(k => S.companies[k].name === 'Bansal & Sons')")
        go("(c) => { S.view = 'company'; S.coId = '%s'; S.filter = 'draft'; goClient('bills'); }" % other)
        e = pg.locator("#app [data-list-empty]")
        ok(e.count() == 1 and e.locator("button").count() == 1 and "top right" not in e.inner_text(), "Purchase with no bills: one sentence and Upload bills (no 'see the top right')")
        E("(c) => { S.coId = c; }", cid)

        print("10. old addresses, less motion")
        for h, check, label in [("#/c/%s/books/tieout" % cid, "booksTab() === 'tieout'", "…/books/tieout opens Audit → Tie-out with Tally"), ("#/c/%s/dash" % cid, "S.tab === 'dash'", "…/dash opens the Overview"),
                                ("#/c/%s/books/mis" % cid, "booksTab() === 'mis'", "…/books/mis opens MIS")]:
            E("(h) => { location.hash = h; }", h); W(1200)
            ok(E(check), label)
        pg.close()

        wide, _ = start(br, 1920, 1000)
        E4, W4, go4 = walker(wide)
        ww = {}
        for name, js in PAGES:
            if name in ("help",): continue
            go4(js, 900); ww[name] = E4(WIDTH)
        ok(len(set(w["left"] for w in ww.values())) == 1 and len(set(w["right"] for w in ww.values())) == 1, "1920 px: the body starts and ends in the same place on every page")
        short = {n: (w["far"], w["right"]) for n, w in ww.items() if w["far"] and w["far"] < w["right"] - 4}
        ok(not short, "1920 px: every page's content runs the full width (%s)" % short)
        wide.close()

        mo, _ = start(br, 1440, 900, motion="reduce")
        mo.evaluate(CL("goClient('books:mis');")); mo.wait_for_timeout(900)
        tr = mo.evaluate("getComputedStyle(document.querySelector('#app nav[aria-label=MIS] > button')).transitionDuration")
        ok(all(float(x.strip().rstrip("s") or 0) == 0 for x in tr.split(",")), "less motion asked for: the tabs change with no transition (%s)" % tr)
        mo.close()

        print("phone (390 px)")
        ph, _ = start(br, 390, 844)
        E2, W2, go2 = walker(ph)
        for name, js in PAGES:
            go2(js, 1000)
            for r in E2(TABROWS):
                ok(r["lines"] == 1, "phone, %s, %s: the tabs on one line (they scroll)" % (name, r["name"]))
            b = E2(BANNERS)
            ok(len(b) <= 1, "phone, %s: %d banner%s %s" % (name, len(b), "" if len(b) == 1 else "s", b if len(b) > 1 else ""))
            ok(E2(SCROLLX) <= 0, "phone, %s: no sideways scroll" % name)
        go2(CL("S.filter = 'draft'; goClient('bills');"))
        bar = E2("""(() => { const a = document.querySelector('.actionbar').getBoundingClientRect(), nav = document.querySelector('#side').getBoundingClientRect();
          const kids = [...document.querySelectorAll('.actionbar .ab-left > *, .actionbar .ab-right > *')].filter(e => e.offsetParent);
          const p = document.querySelector('.actionbar .ab-right > .primary'), pr = p && p.getBoundingClientRect();
          return {h: a.height, bottom: a.bottom, nav: nav.top, tops: new Set(kids.map(e => Math.round(e.getBoundingClientRect().top / 6))).size, prim: pr ? pr.right <= window.innerWidth + 1 && pr.left >= 0 : false}; })()""")
        ok(bar["h"] <= 56, "phone: Purchase's bar is one short row (%d px of 844)" % bar["h"])
        ok(bar["bottom"] <= bar["nav"] + 1, "phone: it sits over the bottom bar, not on it (%d, %d)" % (bar["bottom"], bar["nav"]))
        ok(bar["prim"], "phone: its main button (Approve) is in sight")
        ph.screenshot(path=os.path.join(OUT, "phone-purchase.png"))
        go2(CL("goClient('books:mis'); S.misTab = 'summary'; " + RUN_MIS))
        ph.screenshot(path=os.path.join(OUT, "phone-mis.png"))
        ph.close()

        print("one year of books (a page also says the period is not read yet)")
        oy, _ = start(br, 1440, 900, one_year=True)
        E3, W3, go3 = walker(oy)
        for name, js in PAGES:
            go3(js, 1000); b = E3(BANNERS)
            ok(len(b) <= 1, "one year, %s: %d banner%s %s" % (name, len(b), "" if len(b) == 1 else "s", b if len(b) > 1 else ""))
        oy.close(); br.close()
finally:
    srv.shutdown()
if errors: print("page errors:", errors[:5]); fails.append("page errors")
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
