"""python3 run_bank_panel_ui.py - the Bank statement page's line details as a proper side panel (18-Nov-2026; the owner:
"i am not able to open proper side panel.. need a proper side panel with the same space"). Offline, a made-up statement of
60 lines (no real client):
  1. on a wide screen (1280 and 1600 px) the details panel sits BESIDE the table, not over it: the table narrows, its right
     edge is left of the panel, and the panel has the table's top and bottom; the table's frozen header row and Date column,
     its pinned totals and its sideways scroll keep working in the narrower box; nothing scrolls the page sideways;
  2. a click anywhere on a line's text or empty space opens its details (not on its tick box, ledger box, buttons or links);
     a second click on the open line, ✕ and Esc close it; ↑ / ↓ step through the lines; focus goes into the panel and back;
  3. between 601 and 1099 px it stays over the table but has the table's full height;
  4. a phone (375 / 390 px): no sideways scroll, the details a sheet from the bottom.
With BANK_PANEL_SHOTS=<dir>, screenshots of the panel open at 1280, 1600 and 390 px (deviceScaleFactor 2).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_panel_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("BANK_PANEL_PORT", "8621"))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
SHOTS = os.environ.get("BANK_PANEL_SHOTS", "")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = """() => {
  const c = newCompany({name: "DEMO TRADERS PVT LTD", gstin: "27AAACD0000A1Z5"}); c.bankAccounts = [{id: "a1", bank: "DEMO BANK", acct: "0001", ledger: "Demo Bank A/c"}];
  c.choices = {"bank:a1": {value: "Demo Bank A/c", state: "confirmed", by: "you", at: new Date().toISOString()}};
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["ALPHA SUPPLIES", "BETA SERVICES PVT LTD", "GAMMA LOGISTICS", "DELTA OFFICE RENT", "EPSILON SOFTWARE", "ZETA ELECTRICITY"];
  const st = ["attention", "suggested", "ready", "sent", "attention", "suggested"];
  let bal = 1000000;
  const rows = Array.from({length: 60}, (_, i) => { const out = i % 3 !== 1, amt = 1000 + (i * 137) % 9000; bal += out ? -amt : amt; const s = st[i % 6];
    return {id: "r" + i, fp: "fp" + i, date: "2026-05-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? amt : 0, credit: out ? 0 : amt, balance: r2(bal),
      narr: (i % 4 === 0 ? "UPI/" : "NEFT DR-") + parties[i % 6] + " INVOICE " + (500 + i) + " FOR GOODS SUPPLIED AS PER ORDER, REF " + (900000 + i),
      dec: {name: parties[i % 6], mode: i % 4 === 0 ? "UPI" : "NEFT", utr: "REF" + (900000 + i)}, ledger: s === "attention" ? "" : parties[i % 6], state: s,
      sentAt: s === "sent" ? "2026-05-30T10:00:00Z" : undefined, balOk: true, why: ["Party name found in the narration."], srcLabel: "Learnt"}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "DEMO BANK", acct: "0001", from: "2026-05-01", to: "2026-05-28", opening: 1000000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "Demo Bank A/c", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {},
    filter: "all", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
DR = "() => { const d = document.querySelector('[data-bank-drawer]'); return d ? d.dataset.bankDrawer : null; }"
GEO = """() => { const d = document.querySelector('[data-bank-drawer]'), t = document.querySelector('#app .bk-tablewrap');
  if (!d || !t) return null; const a = d.getBoundingClientRect(), b = t.getBoundingClientRect();
  return {dl: a.left, dr: a.right, dt: a.top, db: a.bottom, tl: b.left, tr: b.right, tt: b.top, tb: b.bottom, pos: getComputedStyle(d).position,
    sw: document.documentElement.scrollWidth, w: innerWidth, h: innerHeight}; }"""
WIDTH = "() => document.querySelector('#app .bk-tablewrap').getBoundingClientRect().width"

def start(br, w, h):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1200)
    return ctx, pg
def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name))

def docked(br, w, h, full):
    print("%d px wide: the panel beside the table" % w)
    ctx, pg = start(br, w, h); E, W = pg.evaluate, pg.wait_for_timeout
    w0 = E(WIDTH)
    ok(E("document.documentElement.scrollWidth") <= w, "closed: no sideways scroll (%d)" % E("document.documentElement.scrollWidth"))
    # a click on the balance (not the date, not the particulars): the line's details open
    pg.click('#app tr[data-rid="r4"] td.bal'); W(500)
    ok(E(DR) == "r4", "a click on a line's balance opens its details")
    g = E(GEO)
    ok(g and g["tr"] <= g["dl"] + 0.5, "the table ends where the panel starts (table right %s, panel left %s)" % (g and round(g["tr"]), g and round(g["dl"])))
    ok(g and abs(g["dt"] - g["tt"]) <= 2 and abs(g["db"] - g["tb"]) <= 2, "the panel has the table's top and bottom (panel %s-%s, table %s-%s)" % (g and round(g["dt"]), g and round(g["db"]), g and round(g["tt"]), g and round(g["tb"])))
    ok(g and 370 <= g["dr"] - g["dl"] <= 430 and g["dr"] <= w + 0.5, "the panel is %s px wide, inside the window" % (g and round(g["dr"] - g["dl"])))
    ok(g and g["pos"] != "fixed", "it is part of the page, not floating over it (%s)" % (g and g["pos"]))
    ok(E(WIDTH) < w0 - 300, "the table narrowed to share the space (%d, was %d)" % (E(WIDTH), w0))
    ok(g and g["sw"] <= w, "open: no sideways scroll of the page (%s)" % (g and g["sw"]))
    ok(E("!!document.querySelector('#app tr[data-rid=\"r4\"].dr-on')"), "the open line is marked in the table")
    ok(E("document.activeElement && !!document.activeElement.closest('[data-bank-drawer]')"), "focus is in the panel")
    ok(E("(() => { const d = document.querySelector('[data-bank-drawer]'); return !!d && d.getAttribute('role') === 'dialog' && /^Line details/.test(d.getAttribute('aria-label') || ''); })()"), "role and label kept")
    # the narrower table still works: frozen header row and Date column, totals at the foot, scrolls sideways
    E("() => { const b = document.querySelector('#app .bk-tablewrap'); b.scrollTop = 600; b.scrollLeft = 300; }"); W(300)
    st = E("""() => { const b = document.querySelector('#app .bk-tablewrap'), r = b.getBoundingClientRect(), th = document.querySelector('#app table.bk-table thead th[data-role=date]').getBoundingClientRect(),
      tf = document.querySelector('#app table.bk-table tfoot td').getBoundingClientRect(), d = document.querySelector('#app tbody td.dt').getBoundingClientRect();
      return {box: r.top, th: th.top, foot: tf.bottom, boxb: r.bottom, dl: d.left - r.left, sl: b.scrollLeft, side: b.scrollWidth > b.clientWidth}; }""")
    ok(abs(st["th"] - st["box"]) <= 2, "the header row stays at the top of the narrower box (%d / %d)" % (st["th"], st["box"]))
    ok(st["foot"] <= st["boxb"] + 1 and st["boxb"] - st["foot"] < 20, "the totals stay at its foot (%d / %d)" % (st["foot"], st["boxb"]))
    ok(st["side"] and st["sl"] > 0 and st["dl"] < 60, "it scrolls sideways with the Date column frozen (scrolled %d, date at %d)" % (st["sl"], st["dl"]))
    E("() => { const b = document.querySelector('#app .bk-tablewrap'); b.scrollTop = 0; b.scrollLeft = 0; }"); W(200)
    if full:
        shot(pg, "bank-panel-%d.png" % w)
        # ↑ / ↓
        pg.click("[data-drawer-next]"); W(300)
        ok(E(DR) == "r5" and E("!!document.querySelector('#app tr[data-rid=\"r5\"].dr-on')"), "↓ the next line (%s)" % E(DR))
        pg.click("[data-drawer-prev]"); W(300)
        ok(E(DR) == "r4", "↑ the line before")
        # a second click on the open line closes it
        pg.click('#app tr[data-rid="r4"] td.bal'); W(400)
        ok(E(DR) is None, "a second click on the open line closes it")
        ok(abs(E(WIDTH) - w0) < 2, "and the table has its whole width again")
        # the particulars' text, a status tag: open; Esc closes, focus back on the line's date
        pg.click('#app tr[data-rid="r2"] td.pt .pn'); W(400)
        ok(E(DR) == "r2", "a click on the particulars opens")
        pg.keyboard.press("Escape"); W(300)
        ok(E(DR) is None, "Esc closes it")
        ok(E("document.activeElement && document.activeElement.getAttribute('data-row-open')") == "r2", "focus goes back to the line (%s)" % E("document.activeElement && document.activeElement.outerHTML.slice(0, 60)"))
        pg.click('#app tr[data-rid="r1"] td [class*="tag"]'); W(400)
        ok(E(DR) == "r1", "a click on the status opens")
        pg.click("[data-drawer-close]"); W(300)
        ok(E(DR) is None, "✕ closes it")
        # what is a control in the line does its own thing, and does not open the details
        pg.click('#app tr[data-rid="r0"] td.ck input[type=checkbox]'); W(300)
        ok(E(DR) is None and E("B().sel.has('r0')"), "the tick box ticks the line, the details stay shut")
        pg.click('#app tr[data-rid="r0"] td.ck input[type=checkbox]'); W(200)
        pg.click('#app tr[data-rid="r1"] [data-bled]'); W(300)
        ok(E(DR) is None, "a click in the ledger box does not open the details")
        pg.keyboard.press("Escape"); W(200)
        pg.click('body', position={"x": 5, "y": 5}); W(200)
        n = E("document.querySelectorAll('#app tr[data-rid=\"r2\"] select').length")
        if n:
            pg.click('#app tr[data-rid="r2"] select'); W(200); pg.keyboard.press("Escape"); W(200)
            ok(E(DR) is None, "a click on the voucher type list does not open the details")
        pg.click('#app tr[data-rid="r2"] [data-narr-more]', force=True); W(300)
        ok(E(DR) is None, "the narration's More does not open the details")
        # the keyboard: the date is a button
        pg.focus('#app tr[data-rid="r3"] [data-row-open]'); pg.keyboard.press("Enter"); W(400)
        ok(E(DR) == "r3", "from the keyboard: Enter on the date opens it")
        pg.click("[data-drawer-close]"); W(300)
        ok(E("document.activeElement && document.activeElement.getAttribute('data-row-open')") == "r3", "✕: focus back on the line")
        # the rail's full menu over the page: Esc closes the menu first, the details stay
        pg.click('#app tr[data-rid="r2"] td.bal'); W(400)
        pg.click('.bkr [data-rail-menu]'); W(300)
        pg.keyboard.press("Escape"); W(300)
        ok(E("!document.querySelector('.bkr [data-rail-menu][aria-expanded=true]')") and E(DR) == "r2", "with the full menu open, Esc closes the menu and the details stay")
        pg.keyboard.press("Escape"); W(300)
        ok(E(DR) is None, "a second Esc closes the details")
    ctx.close()

with sync_playwright() as p:
    br = p.chromium.launch()
    docked(br, 1280, 800, True)
    docked(br, 1600, 900, True)

    print("1000 px: over the table, its full height")
    ctx, pg = start(br, 1000, 800); E, W = pg.evaluate, pg.wait_for_timeout
    pg.click('#app tr[data-rid="r4"] td.bal'); W(500)
    g = E(GEO)
    ok(E(DR) == "r4", "a click on the line opens it")
    ok(g and abs(g["dt"] - g["tt"]) <= 2 and abs(g["db"] - g["tb"]) <= 2, "the panel has the table's top and bottom (panel %s-%s, table %s-%s)" % (g and round(g["dt"]), g and round(g["db"]), g and round(g["tt"]), g and round(g["tb"])))
    ok(g and g["dr"] <= 1000.5 and g["dl"] > g["tl"], "on the right, over the table (%s-%s)" % (g and round(g["dl"]), g and round(g["dr"])))
    ok(g and g["sw"] <= 1000, "no sideways scroll (%s)" % (g and g["sw"]))
    ctx.close()

    for w in (375, 390):
        print("%d px: a phone" % w)
        ctx, pg = start(br, w, 844); E, W = pg.evaluate, pg.wait_for_timeout
        ok(E("document.documentElement.scrollWidth") <= w, "no sideways scroll (%d)" % E("document.documentElement.scrollWidth"))
        E("() => { B().drawer = 'r2'; render(); }"); W(500)
        d = E("() => { const r = document.querySelector('[data-bank-drawer]').getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; }")
        ok(d[0] <= 1 and d[1] >= w - 1 and d[3] >= 843, "the details are a sheet from the bottom (%s)" % [round(x) for x in d])
        ok(E("document.documentElement.scrollWidth") <= w, "open: no sideways scroll (%d)" % E("document.documentElement.scrollWidth"))
        if w == 390: shot(pg, "bank-panel-390.png")
        pg.click("[data-drawer-close]"); W(300)
        ok(E(DR) is None, "✕ closes it")
        ctx.close()
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + "; ".join(errors[:3])))
print("\nFAILED: %d" % len(fails) if fails else "\nall ok")
raise SystemExit(1 if fails else 0)
