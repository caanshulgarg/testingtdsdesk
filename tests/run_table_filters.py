"""python3 run_table_filters.py - next-ui-table-filters (the owner, 16-Nov-2026: "there has to be filters in the column
sections.. and page is eating lot of spaces"): the Excel-style filter on each heading of the one list table (ListTable.jsx,
colFilter.js, ColFilterPop.jsx) and the compact layout (styles/dense.css, parts/density.js). Made-up data only.
  1. Sync activity (the lines received from Tally, 240 made up): a funnel on each heading; words (Entry); a tick list
     with counts (PC, State); a date range (Saved in Tally); "Showing X of Y"; the heading marked; Clear filters; a click
     on a heading sorts; Esc closes the box
  2. Connection history (a list cut at 200 rows): a filter finds a computer only in the rows past the 200th
  3. Sales: an amount range (Taxable), Status ticked, the old funnels always on their headings now, the foot's count
  4. the clients' grid on the Tally page and the entries tables (table.data) have funnels too
  5. compact rows (about 32 px a one-line row), a long help line folded to one line with "more"; Comfortable from the
     firm menu, remembered per person; storage that throws does not break the page
  6. a phone (390): no sideways scroll, the box a sheet at the bottom of the screen, funnels a finger wide
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_table_filters.py (port: TABLE_FILTERS_PORT)"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TABLE_FILTERS_PORT", "8978"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
ORBIT, NOVA_C, LARK, KEST = "Orbit Space", "Nova Widgets", "Larkspur & Co", "Kestrel Foods"
ORB, NOVA = "ORBIT SPACE", "NOVA WIDGETS"
PC1, PC2 = "OFFICE-SERVER", "ACCOUNTS-LAPTOP"
LEDGERS = ["Alpha Retail LLP", "Beta Stores", "Gamma Mart", "Delta Traders", "Sales @ 18% Local", "Output CGST", "Output SGST", "Output IGST", "Round Off"]
TYPES, STATES = ["Sales", "Receipt", "Payment", "Journal"], ["applied", "applied", "duplicate", "held"]
# 240 lines: line i saved on 2026-10-(1 + i % 30), from PC1 when i % 5 < 2, else PC2
LINES = [{"id": 900 + i, "pc": PC1 if i % 5 < 2 else PC2, "event": "created", "vch_type": TYPES[i % 4], "vch_no": str(100 + i), "vch_date": "2026-10-%02d" % (1 + i % 30),
          "saved_at": "2026-10-%02dT06:%02d:00Z" % (1 + i % 30, i % 60), "received_at": "2026-10-%02dT06:%02d:30Z" % (1 + i % 30, i % 60), "state": STATES[i % 4],
          "held_why": "a made-up reason" if i % 4 == 3 else ""} for i in range(240)]

srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

def boot(pg):
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
    pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.set_default_timeout(8000)

def tally(pg):
    E = lambda js, *a: pg.evaluate(js, *a)
    o1 = T.dev(5, PC1, "made-up-o1", tally="open", opened=(ORB,), version="2.5.4", rec=(ORB,), beat={"bridgePort": 9101}, ports=[{"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
    o2 = T.dev(6, PC2, "made-up-o2", tally="open", opened=(NOVA,), version="2.5.4", rec=(NOVA,), beat={"bridgePort": 9102}, ports=[{"port": 9043, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
    c9 = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": o1["id"], "gstin": "", "last_seen": "ago:0.5"},
          {"company": NOVA, "client_id": "NAME:" + NOVA_C, "device_id": o2["id"], "gstin": "", "last_seen": "ago:0.5"},
          {"company": "LARKSPUR CO", "client_id": "NAME:" + LARK, "device_id": o1["id"], "gstin": "", "last_seen": "ago:3000"}]
    E(T.SETUP, [[o1, o2], c9, [], "owner", [ORBIT, NOVA_C, LARK, KEST], True, {ORBIT: T.book(ORBIT), NOVA_C: T.book(NOVA_C), LARK: T.book(LARK)}])
    E("() => { window.__linksApi = false; }"); E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {}); E(TS.FORGET)
    E(TS.MINE, ["", "", ""]); E("() => { S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
    pg.wait_for_timeout(3000)

def activity(pg):
    pg.evaluate("""(lines) => { const cid = Object.values(S.companies).find(c => c.name === "Orbit Space").id;
      Rec.act.rows = lines.map(l => Object.assign({client_id: cid}, l)); Rec.act.at = Date.now(); Rec.act.cid = ""; Rec.act.busy = false; Rec.actLoad = async () => {};
      S.syncFilter = "all"; S.syncClient = ""; S.tallyTab = "activity"; render(); }""", LINES)
    pg.wait_for_timeout(1200)

def sales(pg):
    pg.evaluate("""(leds) => { const c = newCompany({name: "ZZ Zeta Exports", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.bank.ledgers = {list: leds.map(n => ({name: n, group: /Sales/.test(n) ? "Sales Accounts" : /Output|Round/.test(n) ? "Duties & Taxes" : "Sundry Debtors"})), importedAt: new Date().toISOString(), live: true}; S.tab = "sales"; S.step = null; return loadSales(c.id); }); }""", LEDGERS)
    pg.wait_for_timeout(800)
    pg.evaluate("""() => { const s = SL(); const cs = ["Alpha Retail LLP", "Beta Stores", "Gamma Mart", "Delta Traders"];
      for (let i = 0; i < 24; i++) { const t = 1000 * (i + 1);
        const v = newInvoice({number: "S/" + (101 + i), date: "2026-09-" + String(1 + i).padStart(2, "0"), customerName: cs[i % 4], customerGstin: "", pos: "09", taxable: t, cgst: r2(t * .09), sgst: r2(t * .09), igst: 0, cess: 0, total: r2(t * 1.18), items: []}, "upload");
        v.fileName = "S-" + (101 + i) + ".pdf"; s.list.push(v); mapInvoice(v); v.status = ["posted", "intally", "review", "review"][i % 4]; }
      s.filter = "review"; render(); }""")
    pg.wait_for_timeout(900)

LIST = lambda name: '#app table[data-list="%s"]' % name
def rows(pg, name):
    return pg.evaluate("(n) => [...document.querySelectorAll('#app table[data-list=\"' + n + '\"] > tbody > tr:not(.lt-none)')].map(r => [...r.cells].map(c => c.innerText.replace(/\\s+/g, ' ').trim()))", name)
def col(pg, name, label):
    return pg.evaluate("([n, l]) => [...document.querySelectorAll('#app table[data-list=\"' + n + '\"] > thead th')].findIndex(th => th.innerText.trim() === l)", [name, label])
def funnel(pg, name, k):
    pg.click(LIST(name) + ' thead [data-ltf="%s"]' % k); pg.wait_for_timeout(500)
def fbar(pg, name):
    s = '#app [data-lt-fbar="%s"]' % name
    return re.sub(r"\s+", " ", pg.inner_text(s)).strip() if pg.locator(s).count() else ""

with sync_playwright() as p:
    br = p.chromium.launch()
    # ---------------------------------------------------------------- 1. Sync activity
    pg = br.new_page(viewport={"width": 1440, "height": 900}); boot(pg); tally(pg); activity(pg)
    N = "syncActivity"
    print("== 1. Sync activity: %d made-up lines" % len(LINES))
    ok(len(rows(pg, N)) == 240, "1. all 240 lines (%d)" % len(rows(pg, N)))
    ks = pg.evaluate("(n) => [...document.querySelectorAll('#app table[data-list=\"' + n + '\"] thead [data-ltf]')].map(b => b.getAttribute('data-ltf'))", N)
    ok(set(["saved", "entry", "pc", "state", "act", "recv"]) <= set(ks) and "ac" not in ks, "1. a funnel on each heading, none on the buttons' column (%s)" % ks)
    ok(pg.evaluate("(n) => document.querySelector('#app table[data-list=\"' + n + '\"]').querySelectorAll('.gff').length", N) == 0, "1. no second (old) funnel on the list table")
    # words
    funnel(pg, N, "entry")
    ok(pg.locator("#app [data-ltf-pop=entry]").count() == 1, "1. the funnel opens the box")
    pg.fill('#app [data-ltf-pop=entry] input[data-ltf-in="q"]', "receipt"); pg.wait_for_timeout(500)
    r = rows(pg, N); ei = col(pg, N, "Entry")
    ok(len(r) == 60 and all("Receipt" in x[ei] for x in r), "1. words: “receipt” finds the 60 receipts (%d)" % len(r))
    ok(fbar(pg, N).startswith("Showing 60 of 240 lines") and "Clear filters" in fbar(pg, N), "1. Showing 60 of 240 lines · Clear filters (%s)" % fbar(pg, N))
    ok("on" in pg.get_attribute(LIST(N) + ' thead [data-ltf="entry"]', "class"), "1. the heading's funnel marked while its filter is on")
    ok(pg.evaluate("document.activeElement && document.activeElement.getAttribute('data-ltf-in')") == "q", "1. the cursor stays in the box while typing")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(pg.locator("#app [data-ltf-pop]").count() == 0 and pg.evaluate("S.view") == "home", "1. Esc closes the box (and does not leave the page)")
    # tick list with counts
    funnel(pg, N, "pc")
    items = pg.evaluate("() => [...document.querySelectorAll('#app [data-ltf-pop=pc] .cp-item')].map(l => l.innerText.replace(/\\s+/g, ' ').trim())")
    ok(sorted(items) == sorted(["%s 96" % PC1, "%s 144" % PC2]), "1. PC: a tick list of the computers with their counts, from ALL lines (%s)" % items)
    pg.check('#app [data-ltf-pop=pc] input[data-ltf-v="%s"]' % PC2); pg.wait_for_timeout(500)
    r = rows(pg, N); pi = col(pg, N, "PC")
    want = sum(1 for i, l in enumerate(LINES) if l["vch_type"] == "Receipt" and l["pc"] == PC2)
    ok(len(r) == want and all(x[pi] == PC2 and "Receipt" in x[ei] for x in r), "1. words and PC together: the %d receipts from %s (%d)" % (want, PC2, len(r)))
    pg.click("#app [data-ltf-pop=pc] [data-ltf-done]"); pg.wait_for_timeout(300)
    funnel(pg, N, "state")
    st = pg.evaluate("() => [...document.querySelectorAll('#app [data-ltf-pop=state] .cp-item')].length")
    ok(st == 3, "1. State: a tick list of its 3 states (%d)" % st)
    pg.click("#app [data-ltf-pop=state] [data-ltf-done]"); pg.wait_for_timeout(300)
    # date range
    pg.click('#app [data-lt-fbar="%s"] [data-lt-fclear]' % N); pg.wait_for_timeout(500)
    ok(len(rows(pg, N)) == 240 and fbar(pg, N) == "", "1. Clear filters: all 240 again, no Showing line")
    funnel(pg, N, "saved")
    ok(pg.locator('#app [data-ltf-pop=saved] input[type=date]').count() == 2 and pg.locator('#app [data-ltf-pop=saved] [data-ltf-quick]').count() == 4, "1. a date column: from / to and the quick ranges")
    pg.fill('#app [data-ltf-pop=saved] input[data-ltf-in="from"]', "2026-10-05"); pg.fill('#app [data-ltf-pop=saved] input[data-ltf-in="to"]', "2026-10-07"); pg.wait_for_timeout(500)
    want = sum(1 for l in LINES if "2026-10-05" <= l["saved_at"][:10] <= "2026-10-07")
    ok(len(rows(pg, N)) == want and fbar(pg, N).startswith("Showing %d of 240" % want), "1. Saved in Tally 05-Oct to 07-Oct: %d lines (%s)" % (want, fbar(pg, N)))
    pg.click("#app [data-ltf-pop=saved] [data-ltf-clear]"); pg.wait_for_timeout(400)
    ok(len(rows(pg, N)) == 240, "1. the box's Clear empties this column's filter")
    pg.click("#app [data-ltf-pop=saved] [data-ltf-done]"); pg.wait_for_timeout(300)
    # a click on a heading sorts
    pg.click(LIST(N) + ' thead th:has([data-ltf="pc"]) .lt-sort'); pg.wait_for_timeout(400)
    r = rows(pg, N)
    ok(r[0][pi] == PC2 and r[-1][pi] == PC1, "1. a click on PC sorts by it (%s first)" % r[0][pi])
    # nothing matches: the headings stay, with Clear filters
    funnel(pg, N, "entry"); pg.fill('#app [data-ltf-pop=entry] input[data-ltf-in="q"]', "no such entry"); pg.wait_for_timeout(400)
    ok(pg.locator(LIST(N) + " thead [data-ltf]").count() >= 5 and "Nothing matches these filters" in pg.inner_text(LIST(N)), "1. nothing matches: the headings stay, and Clear filters")
    pg.click(LIST(N) + " tbody button:has-text('Clear filters')"); pg.wait_for_timeout(400)
    ok(len(rows(pg, N)) == 240, "1. cleared from the empty list")
    # a one-line row: about 32 px
    h = pg.evaluate("(n) => { const r = document.querySelector('#app table[data-list=\"' + n + '\"] > tbody > tr'); return Math.round(r.getBoundingClientRect().height); }", "syncActivity")
    print("     (a sync line, two lines of words: %d px)" % h)
    # long help line folded
    cl = pg.evaluate("() => { const p = document.querySelector('#app [data-sync-activity] p.note.tf-clamp'); if (!p) return null; const r = p.getBoundingClientRect(); return {h: Math.round(r.height), more: getComputedStyle(p, '::after').content}; }")
    ok(cl and cl["h"] <= 24 and "more" in cl["more"], "5. the long help line above the lines: one line with “more” (%s)" % cl)
    pg.click("#app [data-sync-activity] p.note.tf-clamp"); pg.wait_for_timeout(200)
    ok(pg.evaluate("() => { const p = document.querySelector('#app [data-sync-activity] p.note.tf-clamp'); return p.classList.contains('tf-open') && p.getBoundingClientRect().height > 24; }"), "5. a click opens it in full")
    pg.close()

    # ---------------------------------------------------------------- 2. a list cut at 200
    print("== 2. a list cut at 200 rows (Connection history)")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); boot(pg); tally(pg)
    pg.evaluate("""() => { const t0 = Date.now(); window.tallyHistory = () => Array.from({length: 260}, (_, i) => ({device: i < 200 ? "PC-ALPHA" : "PC-BETA", kind: "tally", state: i % 2 ? "open" : "closed", at: new Date(t0 - i * 60000).toISOString()}));
      if (!(TLight.st.devs || []).length) TLight.st.devs = [{id: "made-up", name: "PC-ALPHA"}];
      S.tallyMore = Object.assign({}, S.tallyMore, {support: true, page: true}); render(); }""")
    for _ in range(20):
        if pg.locator(LIST("tallyHistory")).count(): break
        pg.wait_for_timeout(500)
    ok(pg.locator(LIST("tallyHistory")).count() == 1 and len(rows(pg, "tallyHistory")) == 200, "2. the history shows its first 200 of 260 changes (%d)" % len(rows(pg, "tallyHistory")))
    if pg.locator(LIST("tallyHistory")).count():
        pg.locator(LIST("tallyHistory")).scroll_into_view_if_needed()
        funnel(pg, "tallyHistory", "pc")
        items = pg.evaluate("() => [...document.querySelectorAll('#app [data-ltf-pop=pc] .cp-item')].map(l => l.innerText.replace(/\\s+/g, ' ').trim())")
        ok(sorted(items) == ["PC-ALPHA 200", "PC-BETA 60"], "2. the tick list counts all 260 (%s)" % items)
        pg.check('#app [data-ltf-pop=pc] input[data-ltf-v="PC-BETA"]'); pg.wait_for_timeout(500)
        r = rows(pg, "tallyHistory")
        ok(len(r) == 60 and all("PC-BETA" in " ".join(x) for x in r), "2. PC-BETA, only in the rows past the 200th: its 60 found (%d)" % len(r))
        h = pg.evaluate("() => Math.round(document.querySelector('#app table[data-list=\"tallyHistory\"] > tbody > tr').getBoundingClientRect().height)")
        ok(h <= 34, "5. compact: a one-line row about 32 px (%d)" % h)
    pg.close()

    # ---------------------------------------------------------------- 3. Sales
    print("== 3. Sales")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); boot(pg); sales(pg)
    N = "sales"
    ok(len(rows(pg, N)) == 12, "3. To review: 12 of 24 made-up invoices (%d)" % len(rows(pg, N)))
    old = pg.evaluate("(n) => [...document.querySelectorAll('#app table[data-list=\"' + n + '\"] thead [data-colf]')].map(b => b.getAttribute('data-colf'))", N)
    ok(sorted(old) == ["cust", "date", "led", "no", "val"], "3. the old funnels always on their headings now (%s)" % old)
    new = pg.evaluate("(n) => [...document.querySelectorAll('#app table[data-list=\"' + n + '\"] thead [data-ltf]')].map(b => b.getAttribute('data-ltf'))", N)
    ok(sorted(new) == ["gst", "st", "tx"], "3. and the new on the rest (%s)" % new)
    funnel(pg, N, "tx")
    ok(pg.locator('#app [data-ltf-pop=tx] input[data-ltf-in="min"]').count() == 1, "3. an amount: from / to")
    pg.fill('#app [data-ltf-pop=tx] input[data-ltf-in="min"]', "5000"); pg.fill('#app [data-ltf-pop=tx] input[data-ltf-in="max"]', "10000"); pg.wait_for_timeout(500)
    ti = col(pg, N, "Taxable"); r = rows(pg, N)
    vals = [float(x[ti].replace("₹", "").replace(",", "")) for x in r]
    want = sum(1 for i in range(24) if i % 4 >= 2 and 5000 <= 1000 * (i + 1) <= 10000)
    ok(len(r) == want and all(5000 <= v <= 10000 for v in vals), "3. Taxable 5,000 to 10,000: %d invoices (%s)" % (want, vals))
    ok("%d invoices" % want in pg.inner_text(LIST(N) + " tfoot") and "of 24" in pg.inner_text(LIST(N) + " tfoot"), "3. the foot counts what is shown (%s)" % pg.inner_text(LIST(N) + " tfoot").split("\n")[0])
    pg.click("#app [data-ltf-pop=tx] [data-ltf-done]"); pg.wait_for_timeout(300)
    pg.click('#app [data-lt-fbar="sales"] [data-lt-fclear]'); pg.wait_for_timeout(500)
    ok(len(rows(pg, N)) == 12 and fbar(pg, N) == "", "3. Clear filters: all 12 again")
    pg.evaluate("() => { SL().filter = 'done'; render(); }"); pg.wait_for_timeout(500)
    funnel(pg, N, "st")
    items = pg.evaluate("() => [...document.querySelectorAll('#app [data-ltf-pop=st] .cp-item')].map(l => l.innerText.replace(/\\s+/g, ' ').trim())")
    ok(sorted(items) == ["In Tally 6", "Posted 6"], "3. Done: Status ticked from its words, with counts (%s)" % items)
    pg.check('#app [data-ltf-pop=st] input[data-ltf-v="Posted"]'); pg.wait_for_timeout(500)
    si = col(pg, N, "Status"); r = rows(pg, N)
    ok(len(r) == 6 and all(x[si] == "Posted" for x in r), "3. only Posted: 6 (%d)" % len(r))
    pg.click('#app [data-lt-fbar="sales"] [data-lt-fclear]'); pg.wait_for_timeout(500)
    ok(len(rows(pg, N)) == 12, "3. Clear filters: all 12 done")
    pg.close()

    # ---------------------------------------------------------------- 4. the Tally page's other tables
    print("== 4. the clients' grid")
    pg = br.new_page(viewport={"width": 1440, "height": 900}); boot(pg); tally(pg)
    g = pg.evaluate("() => { const t = document.querySelector('#app table.tpt-grid'); return t ? [t.querySelectorAll('thead .gff').length, t.tHead.rows[0].cells.length] : null; }")
    ok(g and g[0] >= 5 and g[0] < g[1], "4. the clients' grid: a funnel on each heading but Action (%s)" % g)
    # ---------------------------------------------------------------- 5. density
    print("== 5. density")
    ok(not pg.evaluate("document.documentElement.classList.contains('comfy')"), "5. compact by default")
    pg.evaluate("() => { doAct('firmMenu'); }"); pg.wait_for_timeout(500)
    pg.click("[data-density]"); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.documentElement.classList.contains('comfy')") and pg.evaluate("Object.keys(localStorage).some(k => k.startsWith('fincom:density:') && localStorage.getItem(k) === 'comfortable')"), "5. Comfortable from the firm menu, kept in this browser")
    pg.reload(); pg.wait_for_timeout(2500); pg.evaluate("() => render()"); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.documentElement.classList.contains('comfy')"), "5. still Comfortable after a reload")
    pg.close()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); ctx.add_init_script("(() => { const g = Storage.prototype.getItem, st = Storage.prototype.setItem; Storage.prototype.getItem = function (k) { if (/^fincom:density:/.test(k)) throw new Error('blocked'); return g.call(this, k); }; Storage.prototype.setItem = function (k, v) { if (/^fincom:density:/.test(k)) throw new Error('blocked'); return st.call(this, k, v); }; })()")
    pg = ctx.new_page(); boot(pg); sales(pg)
    ok(len(rows(pg, "sales")) == 12 and not pg.evaluate("document.documentElement.classList.contains('comfy')"), "5. storage that throws: the page draws, compact")
    pg.evaluate("() => { doAct('firmMenu'); }"); pg.wait_for_timeout(500); pg.click("[data-density]"); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.documentElement.classList.contains('comfy')"), "5. storage that throws: Comfortable still kept while the page is open")
    ctx.close()

    # ---------------------------------------------------------------- 6. a phone
    print("== 6. a phone (390)")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pg = ctx.new_page(); boot(pg); tally(pg); activity(pg)
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "6. no sideways scroll of the page (%d)" % pg.evaluate("document.documentElement.scrollWidth"))
    b = pg.locator('#app [data-lt-fphone="syncActivity"] [data-ltf="pc"]')
    ok(b.count() == 1 and b.is_visible(), "6. the list as cards: its funnels a row of chips above it")
    if b.count():
        bb = b.bounding_box(); ok(bb["height"] >= 36, "6. a chip a finger high (%dx%d)" % (bb["width"], bb["height"]))
        b.tap(); pg.wait_for_timeout(500)
        box = pg.locator("#app [data-ltf-pop=pc]").bounding_box()
        ok(box and box["x"] >= 4 and box["x"] + box["width"] <= 386 and box["y"] + box["height"] <= 844, "6. the box a sheet inside the screen (%s)" % box)
        pg.tap('#app [data-ltf-pop=pc] input[data-ltf-v="%s"]' % PC1); pg.wait_for_timeout(500)
        n1 = pg.evaluate("() => document.querySelectorAll('#app table[data-list=\"syncActivity\"] > tbody > tr').length")
        ok(n1 == 96, "6. ticked on a phone: the 96 lines from %s (%d)" % (PC1, n1))
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "6. still no sideways scroll")
    ctx.close()
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
