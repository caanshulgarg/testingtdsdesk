"""python3 run_bank_table_ui.py - the bank statement's lines grid (Books > Bank) as a grid a CA works in all day
(the owner, 29-Oct-2026: "column header is running behind when we scroll down it.. should be more professional.. maybe
freeze that column; and if particulars are long I cannot see it.. there should be an option to increase the width of any
column"). Offline, a made-up statement of 200 lines:
  1. scrolled down, the header row stays on top: nothing paints over it and no row shows above it;
  2. at a narrower window the grid scrolls sideways inside its box and the tick and Date columns stay put;
  3. a 300-letter narration is readable in full: wrapped between words, and one click opens the rest;
  4. a header's right edge drags its column wider; the width is kept after a reload; a double-click puts it back;
  5. a phone (390 px): no sideways scroll of the page.
Screenshots (desktop 1440 light and dark, phone 390) go to TDSDESK_SHOTS when it is set.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_table_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = 8283
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

LONG = ("NEFT DR LONGPARTY ENTERPRISES PRIVATE LIMITED BEING PAYMENT AGAINST INVOICE NUMBER 2026-27/0045 DATED 01-APR-2026 FOR SUPPLY OF "
        "OFFICE STATIONERY AND COMPUTER CONSUMABLES AS PER PURCHASE ORDER 7781 LESS TDS UNDER SECTION 194C REF UTR ICIC0000123456789 ENDTOKEN")
SETUP = """(LONG) => {
  const c = newCompany({name: "GARG SHEKHAR & COMPANY", gstin: "09AAKFG1234C1Z5"}); c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["DIPTI VATS", "PAYUAMAZON", "BHARATKOSH", "PERFEKT SENSE DIGITA", "CLOUD WIZARD CONSULTING", "AMAZON GROCERIES", "CCAPROTEAN", "NAVNEET TENDER DSC"];
  let bal = 2500000;
  const rows = Array.from({length: 200}, (_, i) => { const out = i % 3 !== 1; const amt = [2000, 28788, 2970, 1000, 100000, 5.9, 16200, 1482][i % 8] * (1 + (i % 5) / 10);
    bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-04-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? r2(amt) : 0, credit: out ? 0 : r2(amt), balance: r2(bal),
      narr: i === 1 ? LONG : (out ? "NEFT DR " : "NEFT CR ") + parties[i % 8] + " UTR" + (100000 + i),
      dec: i === 1 ? {name: "", mode: "OTHER"} : {name: parties[i % 8], mode: "NEFT", utr: "UTR" + (100000 + i)},
      ledger: "", state: "attention", balOk: true, why: ["No ledger found for this party."]}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-04-01", to: "2026-04-28", opening: 2500000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "ICICI Bank", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {},
    filter: "review", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
def start(pg):
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP, LONG); pg.wait_for_timeout(900)
TH = "#app table.bk-table thead th"
# the nearest box that scrolls the table sideways (the table's own box, else the page)
SCROLLER = "(t) => { let n = t.parentElement; while (n && n !== document.body) { const cs = getComputedStyle(n); if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return n; n = n.parentElement; } return null; }"
# what lies at the header's centre, just above it, and the line just under it
HEAD_PROBE = """() => { const th = document.querySelector('#app table.bk-table thead th[data-role="date"]'), r = th.getBoundingClientRect(), x = r.left + r.width / 2;
  const at = document.elementFromPoint(x, r.top + r.height / 2), above = r.top > 4 ? document.elementFromPoint(x, r.top - 3) : null, under = document.elementFromPoint(x, r.bottom + 12);
  const tr = under && under.closest('tbody tr[data-rid]');
  return {top: Math.round(r.top), bottom: Math.round(r.bottom), headH: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) || 0,
    atHead: !!(at && at.closest('thead') && at.closest('table') === th.closest('table')), aboveRow: !!(above && above.closest('tbody')),
    under: tr ? Number(tr.dataset.rid.slice(1)) : -1, bg: getComputedStyle(th).backgroundColor}; }"""
def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ("light", "dark"):
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme=scheme); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        start(pg)
        print("1. scrolled down, the header stays on top (%s)" % scheme)
        ok(pg.locator("#app table.bk-table tbody tr[data-rid]").count() == 200, "200 lines drawn")
        box = pg.locator('#app table.bk-table tbody tr[data-rid="r40"]').bounding_box()
        pg.mouse.move(760, min(700, box["y"] if box else 500))
        for _ in range(12): pg.mouse.wheel(0, 500); pg.wait_for_timeout(60)
        pg.wait_for_timeout(500)
        h = pg.evaluate(HEAD_PROBE)
        ok(h["under"] >= 30, "the lines scrolled: line %d is just under the header" % h["under"])
        ok(h["atHead"], "the header's centre is the header: nothing paints over it")
        ok(not h["aboveRow"], "no line shows above the header (it does not run behind)")
        ok(0 <= h["top"] <= max(h["headH"], 0) + 260, "the header is near the top of the window (at %d px)" % h["top"])
        ok(h["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"), "the header has a solid background (%s)" % h["bg"])
        shot(pg, "desktop-1440-" + scheme)
        if scheme == "light":
            print("2. sideways, the tick and Date columns stay put")
            pg.set_viewport_size({"width": 1100, "height": 800}); pg.wait_for_timeout(500)
            sc = pg.evaluate("(t) => { const s = (" + SCROLLER + ")(document.querySelector('#app table.bk-table')); return s ? {page: s === document.scrollingElement || s === document.documentElement, w: s.scrollWidth - s.clientWidth} : null; }")
            ok(bool(sc) and not sc["page"], "at 1100 px the table scrolls sideways inside its own box, not the page (%s)" % sc)
            pw = pg.evaluate("document.scrollingElement.scrollWidth - innerWidth")
            ok(pw <= 1, "the page itself has no sideways scroll (%d px)" % pw)
            if sc and not sc["page"]:
                before = pg.evaluate("() => { const tr = document.querySelector('#app table.bk-table tbody tr[data-rid=\"r20\"]'); tr.scrollIntoView({block: 'center'}); return Math.round(tr.querySelector('td.dt').getBoundingClientRect().left); }")
                pg.evaluate("(t) => { const s = (" + SCROLLER + ")(document.querySelector('#app table.bk-table')); s.scrollLeft = 400; }"); pg.wait_for_timeout(300)
                fr = pg.evaluate("""() => { const t = document.querySelector('#app table.bk-table'), td = t.querySelector('tbody tr[data-rid="r20"] td.dt'), th = t.querySelector('thead th.dt'), r = td.getBoundingClientRect();
                  const at = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
                  return {left: Math.round(r.left), thLeft: Math.round(th.getBoundingClientRect().left), hit: !!(at && at.closest('td.dt'))}; }""")
                shot(pg, "desktop-1100-sideways-light")
                ok(abs(fr["left"] - before) <= 1 and abs(fr["thLeft"] - before) <= 1 and fr["hit"], "scrolled 400 px sideways: the Date column stays where it was, over the rest (%s, was %d)" % (fr, before))
                pg.evaluate("(t) => { const s = (" + SCROLLER + ")(document.querySelector('#app table.bk-table')); s.scrollLeft = 0; }")
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(500)

            print("3. a long narration is readable in full")
            pg.evaluate("() => { const tr = document.querySelector('#app tr[data-rid=\"r1\"]'); tr.scrollIntoView({block: 'center'}); }"); pg.wait_for_timeout(400)
            narr = '#app tr[data-rid="r1"] .bs-narr'
            ok(pg.get_attribute(narr, "title") == LONG, "the whole narration is on the cell's title")
            wraps = pg.evaluate("(s) => { const e = document.querySelector(s); return [...e.querySelectorAll('*')].concat([e]).some((x) => getComputedStyle(x).textOverflow === 'ellipsis' && getComputedStyle(x).whiteSpace === 'nowrap' && x.scrollWidth > x.clientWidth + 1) ? 'cut' : 'wraps'; }", narr)
            ok(wraps == "wraps", "the narration wraps between words, never cut off on one line with an ellipsis (%s)" % wraps)
            more = pg.locator('#app tr[data-rid="r1"] [data-narr-more]')
            if more.count(): more.first.click(); pg.wait_for_timeout(300)
            VIS = """(s) => { const e = document.querySelector(s), td = e.closest('td'), w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n, rg = null;
              while ((n = w.nextNode())) { const i = n.data.indexOf('ENDTOKEN'); if (i >= 0) { rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 8); break; } }
              if (!rg) return {found: false}; const r = rg.getBoundingClientRect(), c = td.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
              let clip = false; for (let a = rg.startContainer.parentElement; a && a !== td.parentElement; a = a.parentElement) { const b = a.getBoundingClientRect(), cs = getComputedStyle(a);
                if (cs.overflow !== 'visible' && (r.bottom > b.bottom + 1 || r.right > b.right + 1)) clip = true; }
              const at = document.elementFromPoint(x, y);
              return {found: true, inside: r.right <= c.right + 1 && r.bottom <= c.bottom + 1 && r.width > 10, clip, hit: !!(at && e.contains(at))}; }"""
            v = pg.evaluate(VIS, narr)
            ok(v.get("found") and v["inside"] and not v["clip"] and v["hit"], "the end of a 300-letter narration is on screen in its cell%s (%s)" % (" after one click" if more.count() else "", v))
            if more.count():
                ok(pg.locator('#app tr[data-rid="r1"] [data-narr-more]').get_attribute("aria-expanded") == "true", "the button says it is open")
                pg.locator('#app tr[data-rid="r1"] [data-narr-more]').first.click(); pg.wait_for_timeout(300)
                hh = pg.evaluate("() => document.querySelector('#app tr[data-rid=\"r1\"]').getBoundingClientRect().height")
                ok(hh <= 90 and pg.locator('#app tr[data-rid="r1"] [data-narr-more]').get_attribute("aria-expanded") == "false", "and a second click closes it again (the line %d px)" % hh)
            hs = pg.evaluate("() => [...document.querySelectorAll('#app table.bk-table tbody tr[data-rid]')].slice(2, 30).map((t) => Math.round(t.getBoundingClientRect().height))")
            ok(max(hs) <= 44, "short lines stay one compact line of about 40 px (%d px)" % max(hs))

            print("4. a column made wider by its header's edge, kept, and put back")
            pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(300)
            th = TH + '[data-role="party"]'
            w0 = pg.evaluate("(s) => document.querySelector(s).getBoundingClientRect().width", th)
            grip = pg.locator(th + " .lt-rz")
            ok(grip.count() == 1, "the Particulars header has a handle on its right edge")
            if grip.count():
                g = grip.bounding_box(); x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
                pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 80, y, steps=4); pg.mouse.move(x + 160, y, steps=4); pg.mouse.up(); pg.wait_for_timeout(400)
                w1 = pg.evaluate("(s) => document.querySelector(s).getBoundingClientRect().width", th)
                ok(w1 >= w0 + 140, "dragged 160 px: Particulars %d -> %d px" % (w0, w1))
                ok(pg.evaluate("S.listSort && S.listSort.bank") is None, "the drag did not sort the table")
                ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "the page does not scroll sideways (the table's box does)")
                start(pg)
                w2 = pg.evaluate("(s) => document.querySelector(s).getBoundingClientRect().width", th)
                ok(abs(w2 - w1) <= 2, "after a reload the width is kept (%d px)" % w2)
                g = pg.locator(th + " .lt-rz").bounding_box(); pg.mouse.dblclick(g["x"] + g["width"] / 2, g["y"] + g["height"] / 2); pg.wait_for_timeout(400)
                w3 = pg.evaluate("(s) => document.querySelector(s).getBoundingClientRect().width", th)
                ok(abs(w3 - w0) <= 4, "a double-click puts it back (%d px, was %d)" % (w3, w0))
                small = TH + '[data-role="date"]'
                g = pg.locator(small + " .lt-rz").bounding_box(); x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
                pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 300, y, steps=6); pg.mouse.up(); pg.wait_for_timeout(300)
                ok(pg.evaluate("(s) => document.querySelector(s).getBoundingClientRect().width", small) >= 48, "a column cannot be dragged narrower than its minimum")
                other = pg.evaluate("() => { try { return Object.keys(localStorage).filter((k) => /colw/.test(k)); } catch (e) { return ['?']; } }")
                ok(len(other) == 1 and other[0].endswith(":bank"), "the widths are kept for this table only (%s)" % other)
        ctx.close()

    print("5. a phone")
    for scheme in ("light", "dark"):
        ctx = br.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme, is_mobile=True, has_touch=True); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        start(pg)
        pw = pg.evaluate("document.scrollingElement.scrollWidth - innerWidth")
        ok(pw <= 1, "390 px (%s): no sideways scroll of the page (%d px)" % (scheme, pw))
        ok(pg.locator('#app tr[data-rid="r1"] .lt-rz, #app table.bk-table.cards .lt-rz:visible').count() == 0, "no resize handles on the phone's cards")
        pg.evaluate("window.scrollTo(0, 600)"); pg.wait_for_timeout(300)
        if scheme == "light": shot(pg, "phone-390-light")
        ctx.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
