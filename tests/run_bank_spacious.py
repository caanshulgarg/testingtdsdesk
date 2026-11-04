"""python3 run_bank_spacious.py - the bank statement page's spacious layout (01-Nov-2026; the owner's approved draft
"Bank statement — spacious layout"). Offline, a made-up statement of 120 lines (no real client):
  1. the slim rail (72 px) on the Bank page, and the full sidebar on every other page;
  2. a rail item's flyout opens on hover, and from the keyboard (focus, arrows, Esc); a click opens its first page; every
     flyout entry opens its page;
  3. Menu opens the full menu; Pin keeps the full sidebar (after a reload too); "Slim rail" undoes it;
  4. the page's header is one line; the status tabs, search and filters are one row; what is filtered shows as chips with ✕;
  5. the table fills the window: its header row stays at the top of its box when it scrolls, its totals stay at its foot,
     and the page's totals are pinned at the bottom of the window;
  6. a line's details open in a drawer on the right (narration, rule, Tally, history, the "Already posted to Tally" warning),
     by a click and by the keyboard; Esc and ✕ close it;
  7. Comfortable / Compact: the rows' height, kept after a reload;
  8. a phone (390 px): no rail, the bar along the bottom, no sideways scroll, the drawer as a sheet; and the dark theme;
  9. the rail and the layout come with the Bank page's chunk, not the app's first file.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_spacious.py"""
import os, glob, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = 8517
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
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
  const rows = Array.from({length: 120}, (_, i) => { const out = i % 3 !== 1, amt = 1000 + (i * 137) % 9000; bal += out ? -amt : amt; const s = st[i % 6];
    return {id: "r" + i, fp: "fp" + i, date: "2026-05-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? amt : 0, credit: out ? 0 : amt, balance: r2(bal),
      narr: (i % 4 === 0 ? "UPI/" : "NEFT DR-") + parties[i % 6] + " INVOICE " + (500 + i) + " FOR GOODS SUPPLIED AS PER ORDER, REF " + (900000 + i),
      dec: {name: parties[i % 6], mode: i % 4 === 0 ? "UPI" : "NEFT", utr: "REF" + (900000 + i)}, ledger: s === "attention" ? "" : parties[i % 6], state: s,
      sentAt: s === "sent" ? "2026-05-30T10:00:00Z" : undefined, balOk: true, why: ["Party name found in the narration."], srcLabel: "Learnt"}; });
  rows[4].goneSent = {at: "2026-04-15T10:00:00Z"};
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "DEMO BANK", acct: "0001", from: "2026-05-01", to: "2026-05-28", opening: 1000000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "Demo Bank A/c", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {},
    filter: "all", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
BACK = "() => { S.alertsOpen = false; S.addingCo = false; if (typeof closeSwitcher === 'function') closeSwitcher(); S.view = 'company'; goClient('bank'); if (B()) B().filter = 'all'; render(); }"
VIS = "(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }"

def start(br, w=1440, h=900, scheme="light", fresh=True):
    ctx = br.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1200)
    return ctx, pg
def reload(pg):
    pg.reload(); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800); pg.evaluate(SETUP); pg.wait_for_timeout(1200)

# every flyout entry and what its page is (the words are the draft's). GSTR-1 and GSTR-3B: with no books in this made-up
# client the GST page has only its 2B part, and shows that
SUBS = [
    ("home", "Today", "S.view === 'home' && S.homeTab === 'today'"),
    ("home", "Compliance due list", "S.view === 'home' && S.homeTab === 'compliance'"),
    ("home", "Notifications", "S.alertsOpen === true && !!document.querySelector('[data-alerts-panel]')"),
    ("clients", "All clients", "S.view === 'home' && S.homeTab === 'clients'"),
    ("clients", "Add client", "S.view === 'home' && S.homeTab === 'clients' && S.addingCo === true"),
    ("clients", "Client setup", "S.view === 'company' && isSetupTab(S.tab)"),
    ("clients", "Client overview", "S.view === 'company' && S.tab === 'dash'"),
    ("clients", "Change client", "!!S.switcher"),
    ("bank", "Bank statements", "S.view === 'company' && S.tab === 'bank' && !!document.querySelector('#app [data-bank-grid]')"),
    ("bank", "Upload statement", "window.__acts.includes('uploadHere')"),
    ("bank", "Bank rules", "S.tab === 'bank' && B().filter === 'rules'"),
    ("bank", "Check with Tally", "window.__acts.includes('bookPick') || window.__acts.includes('bankCheckTally')"),
    ("purchase", "Bills to review", "S.view === 'company' && S.tab === 'invoices'"),
    ("purchase", "Upload bills", "S.step === 'collect'"),
    ("purchase", "Suppliers", "S.tab === 'deductees'"),
    ("purchase", "Post to Tally", "S.tab === 'export'"),
    ("sales", "Invoices", "S.tab === 'sales'"),
    ("sales", "E-invoice / e-way bill", "S.tab === 'sales'"),
    ("sales", "Customers", "S.tab === 'sales'"),
    ("txn", "Purchase register", "S.tab === 'txn' && txnTab() === 'bills'"),
    ("txn", "Sales register", "S.tab === 'txn' && txnTab() === 'sales'"),
    ("txn", "Bank register", "S.tab === 'txn' && txnTab() === 'bank'"),
    ("gst", "GSTR-1", "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return' && (S.gstPart === 'r1' || !gstParts(S.books).parts.some((x) => x[0] === 'r1'))"),
    ("gst", "GSTR-3B", "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return' && (S.gstPart === 'r3b' || !gstParts(S.books).parts.some((x) => x[0] === 'r3b'))"),
    ("gst", "GSTR-2B & ITC", "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return' && S.gstPart === 'r2b'"),
    ("gst", "Annual return (GSTR-9)", "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return'"),
    ("gst", "Supplier health", "S.tab === 'books' && booksTab() === 'gst' && S.gstView === 'return'"),
    ("tds", "Returns (24Q / 26Q / 27Q)", "S.tab === 'books' && booksTab() === 'tds'"),
    ("tds", "Challans", "S.tab === 'books' && booksTab() === 'tds' && S.tdsView === 'register'"),
    ("tds", "Deductees", "S.tab === 'deductees'"),
    ("tds", "26AS & AIS", "S.tab === 'books' && booksTab() === 'recon'"),
    ("tds", "TRACES files", "S.tab === 'books' && booksTab() === 'tds' && (S.tdsView === 'traces' || (S.tdsView === 'return' && S.tdsTab === 'after'))"),
    ("reports", "Financial statements", "S.tab === 'books' && booksTab() === 'fs'"),
    ("reports", "MIS", "S.tab === 'books' && booksTab() === 'mis'"),
    ("reports", "My MIS", "S.tab === 'books' && booksTab() === 'mymis'"),
    ("reports", "Audit", "S.tab === 'books' && booksTab() === 'audit'"),
    ("reports", "Look up", "S.tab === 'books' && booksTab() === 'lookup'"),
    ("reports", "Reports", "S.tab === 'books' && booksTab() === 'reports'"),
    ("reports", "From Tally", "S.tab === 'books' && booksTab() === 'import'"),
    ("reports", "Letters", "S.tab === 'books' && booksTab() === 'letters'"),
    ("settings", "Firm settings", "S.view === 'home' && S.homeTab === 'rules' && !S.settingsTab"),
    ("settings", "People", "S.view === 'home' && S.homeTab === 'rules' && S.settingsTab === 'account'"),
    ("settings", "Plan and credit", "S.view === 'home' && S.homeTab === 'rules' && S.settingsTab === 'plan'"),
    ("settings", "Tally", "S.view === 'home' && S.homeTab === 'tally'"),
    ("settings", "Integrations", "S.view === 'home' && S.homeTab === 'integrations'"),
    ("help", "Help", "S.view === 'home' && S.homeTab === 'help'"),
]
ORDER = ["home", "clients", "bank", "purchase", "sales", "txn", "gst", "tds", "reports", "settings", "help"]

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg = start(br)
    E, W = pg.evaluate, pg.wait_for_timeout
    print("1. the rail on the Bank page, the sidebar elsewhere")
    ok(E(VIS, ".bkr[data-bank-rail]") and not E(VIS, "#side"), "Bank: the slim rail, no full sidebar")
    ok(round(E("document.querySelector('.bkr').getBoundingClientRect().width")) == 72, "the rail is 72 px wide")
    ok(E("[...document.querySelectorAll('.bkr [data-rail]')].map(b => b.dataset.rail)") == ORDER, "the rail's order: Home, Clients, Bank, Purchase, Sales, Transactions, GST, TDS, Reports, Settings, Help")
    ok(E("[...document.querySelectorAll('.bkr [data-rail]')].every(b => b.querySelector('svg') && b.innerText.trim().length > 1)"), "each item: an icon and a short word")
    ok(E("document.querySelector('.bkr [data-rail=bank]').getAttribute('aria-current')") == "page", "Bank is the current item")
    ml = E("parseFloat(getComputedStyle(document.querySelector('.mainwrap')).marginLeft)")
    ok(ml == 72, "the page starts after the rail (%s px)" % ml)
    E("() => goClient('dash')"); W(900)
    ok(E(VIS, "#side") and not E(VIS, ".bkr") and E("!document.documentElement.classList.contains('bk-rail')"), "Overview: the full sidebar, no rail")
    E("() => navHome('clients')"); W(800)
    ok(E(VIS, "#side") and not E(VIS, ".bkr"), "Clients: the full sidebar, no rail")
    E(BACK); W(900)
    ok(E(VIS, ".bkr") and not E(VIS, "#side"), "back on Bank: the rail again")

    print("2. the flyouts: hover, keyboard, every entry")
    pg.hover('.bkr [data-rail="gst"]'); W(250)
    ok(E(VIS, '[data-rail-flyout="gst"]') and E("document.querySelectorAll('[data-rail-flyout=gst] [role=menuitem]').length") == 5, "hover GST: its flyout with its five pages")
    pg.mouse.move(700, 450); W(400)
    ok(not E(VIS, '[data-rail-flyout="gst"]'), "the mouse leaves: the flyout closes")
    pg.focus('.bkr [data-rail="tds"]'); W(150)
    ok(E(VIS, '[data-rail-flyout="tds"]'), "focus TDS (keyboard): its flyout opens")
    pg.keyboard.press("ArrowRight"); W(150)
    ok(E("document.activeElement && document.activeElement.dataset.railSub") == "tds:Returns (24Q / 26Q / 27Q)", "→ goes into the flyout, on its first page")
    pg.keyboard.press("ArrowDown"); W(100)
    ok(E("document.activeElement && document.activeElement.dataset.railSub") == "tds:Challans", "↓ the next")
    pg.keyboard.press("Escape"); W(150)
    ok(not E(VIS, '[data-rail-flyout="tds"]') and E("document.activeElement && document.activeElement.dataset.rail") == "tds", "Esc closes it, back on TDS")
    ok(E("S.view === 'company' && S.tab === 'bank'"), "and Esc did not leave the Bank page")
    pg.click('.bkr [data-rail="sales"]'); W(700)
    ok(E("S.tab === 'sales'") and not E(VIS, '[data-rail-flyout="sales"]'), "a click on Sales opens its first page (Invoices), no flyout left (run_nav_first_sub.py)")
    E(BACK); W(700)
    pg.focus('.bkr [data-rail="sales"]'); W(200); ok(E(VIS, '[data-rail-flyout="sales"]'), "focus Sales: its flyout"); pg.mouse.click(700, 500); W(250)
    ok(not E(VIS, '[data-rail-flyout="sales"]'), "a click elsewhere closes a flyout")
    E("() => { window.__acts = []; const a = window.bankAct, d = window.doAct; window.bankAct = (x, ...r) => { window.__acts.push(x); if (x !== 'bookPick' && x !== 'bankCheckTally') return a(x, ...r); }; window.doAct = (x, ...r) => { window.__acts.push(x); if (x !== 'uploadHere') return d(x, ...r); }; }")
    for (sec, word, want) in SUBS:
        E(BACK); W(700); E("window.__acts = []")
        pg.hover('.bkr [data-rail="%s"]' % sec); W(200)
        sel = '[data-rail-sub="%s:%s"]' % (sec, word)
        if not E(VIS, sel): ok(False, "%s → %s: in the flyout" % (sec, word)); continue
        pg.click(sel); W(900)
        ok(E("() => { try { return !!(%s); } catch (e) { return false; } }" % want), "%s → %s opens its page" % (sec, word))
    E(BACK); W(800)

    print("3. Menu, Pin")
    pg.click('.bkr [data-rail-menu]'); W(300)
    ok(E(VIS, "#side") and E(VIS, "[data-rail-pin]"), "Menu: the full menu over the page, with Pin")
    ok(E("document.querySelector('#side').getBoundingClientRect().left") == 72, "beside the rail")
    pg.keyboard.press("Escape"); W(250)
    ok(not E(VIS, "#side") and E("S.tab") == "bank", "Esc closes it (still on Bank)")
    pg.click('.bkr [data-rail-menu]'); W(250); pg.click("[data-rail-pin]"); W(400)
    ok(E(VIS, "#side") and not E(VIS, ".bkr") and E(VIS, "[data-rail-unpin]"), "Pin: the full sidebar stays, no rail")
    reload(pg)
    ok(E(VIS, "#side") and not E(VIS, ".bkr"), "after a reload: still pinned (kept for this person)")
    pg.click("[data-rail-unpin]"); W(400)
    ok(E(VIS, ".bkr") and not E(VIS, "#side"), "Slim rail: back to the rail")
    reload(pg)
    ok(E(VIS, ".bkr"), "after a reload: the rail")

    print("4. the header and the filter row")
    hd = E("() => { const h = document.querySelector('#app [data-bank-head]'), r = h.getBoundingClientRect(); return {h: r.height, client: h.querySelector('[data-bank-client]').innerText, period: h.querySelector('[data-bank-period]').innerText, txt: h.innerText}; }")
    ok(hd["h"] <= 56, "the header is one line (%d px)" % hd["h"])
    ok("DEMO TRADERS" in hd["client"] and "01-May-2026" in hd["period"], "with the client and the period (%s · %s)" % (hd["client"], hd["period"]))
    ok(all(w in hd["txt"] for w in ["Withdrawals (Dr)", "Deposits (Cr)", "Save"]) and E(VIS, "#app [data-bank-head] [data-bank-post]"), "Dr / Cr totals, Save and Post to Tally in it")
    ok(E("(() => { const b = document.querySelector('#app [data-bank-post]'); return /^(Post to Tally|Create Tally file) \\(\\d+\\)$/.test(b.innerText.trim()); })()"), "the post button says how many")
    pg.click("#app [data-bank-save]"); W(300)
    ok("Saved" in pg.inner_text("#toast"), "Save: said saved")
    row = E("""() => { const c = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
      return [c('#app .sbar-band [role=tab]'), c('#app input[aria-label="Search the statement"]'), c('#app [data-f-more] summary'), c('#app [data-bank-density]')]; }""")
    ok(max(row) - min(row) < 10, "the status tabs, search, filters and row height are one row (%s)" % [round(x) for x in row])
    pg.fill('#app input[aria-label="Search the statement"]', "ALPHA"); W(500)
    ok(E(VIS, '#app [data-achip="q"]'), "a search shows as a chip")
    pg.click('#app [data-dir="out"]'); W(400)
    ok(E(VIS, '#app [data-achip="dir"]'), "Out shows as a chip")
    pg.click('#app [data-chip="UPI"]'); W(400)
    ok(E(VIS, '#app [data-achip="chip:UPI"]'), "the quick chip UPI shows as a chip")
    n1 = E("document.querySelectorAll('#app tbody tr[data-rid]').length")
    pg.click('#app [data-achip="dir"] .bs-fx'); W(400)
    ok(not E(VIS, '#app [data-achip="dir"]') and E("!(B().f || {}).dir") and E("document.querySelectorAll('#app tbody tr[data-rid]').length") >= n1, "✕ on a chip removes that filter")
    pg.click('#app [data-achip="q"] .bs-fx'); W(400); pg.click('#app [data-achip="chip:UPI"] .bs-fx'); W(400)
    ok(E("!B().q && !(B().chips || []).length") and not E(VIS, "#app [data-bank-active-chips]"), "all removed: no chips")
    pg.click('#app [data-f-more] summary'); W(150); pg.check('#app input[data-f-unassigned]'); W(300); pg.click('#app [data-f-more] summary'); W(150)
    ok(E(VIS, '#app [data-achip="led"]'), "Unassigned only (in Filters) shows as a chip")
    pg.click('#app [data-achip="led"] .bs-fx'); W(300)

    print("5. the table fills the window; its header row and totals stay")
    # (the filters above set the lines drawn back to 100 of 120: "Show 20 more" sits under the box, and the box leaves it room)
    tw = E("() => { const b = document.querySelector('#app .bk-tablewrap').getBoundingClientRect(), bar = document.querySelector('.bs-bankbar').getBoundingClientRect(), mo = document.querySelector('#app .bk-more'); return {top: b.top, bottom: b.bottom + (mo ? mo.getBoundingClientRect().height + 6 : 0), left: b.left, right: b.right, bar: bar.top, w: innerWidth, h: innerHeight}; }")
    ok(tw["bottom"] <= tw["bar"] + 1 and tw["bar"] - tw["bottom"] < 40, "the table's box reaches down to the totals bar (box %d to %d, bar at %d, page scrolled %d)" % (tw["top"], tw["bottom"], tw["bar"], E("document.scrollingElement.scrollTop")))
    ok(tw["right"] - tw["left"] > 1440 - 72 - 100, "and spans the width (%d px)" % (tw["right"] - tw["left"]))
    rows_seen = E("() => { const b = document.querySelector('#app .bk-tablewrap').getBoundingClientRect(); return [...document.querySelectorAll('#app tbody tr[data-rid]')].filter(t => { const r = t.getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom; }).length; }")
    ok(rows_seen >= 13, "%d lines in view at 1440x900 (comfortable)" % rows_seen)
    E("() => { document.querySelector('#app .bk-tablewrap').scrollTop = 900; }"); W(300)
    st = E("() => { const b = document.querySelector('#app .bk-tablewrap').getBoundingClientRect(), th = document.querySelector('#app table.bk-table thead th[data-role=date]').getBoundingClientRect(), tf = document.querySelector('#app table.bk-table tfoot td').getBoundingClientRect(); return {box: b.top, th: th.top, foot: tf.bottom, boxb: b.bottom}; }")
    ok(abs(st["th"] - st["box"]) <= 2, "scrolled: the header row stays at the top of the box (%d / %d)" % (st["th"], st["box"]))
    ok(st["foot"] <= st["boxb"] + 1 and st["boxb"] - st["foot"] < 20, "and the totals row stays at its foot (%d / %d)" % (st["foot"], st["boxb"]))
    E("() => { const b = document.querySelector('#app .bk-tablewrap'); b.scrollLeft = 400; }"); W(200)
    fz = E("() => { const b = document.querySelector('#app .bk-tablewrap').getBoundingClientRect(), d = document.querySelector('#app tbody td.dt').getBoundingClientRect(); return d.left - b.left; }")
    ok(fz < 60, "the Date column stays put when the box scrolls sideways (%d)" % fz)
    E("() => { const b = document.querySelector('#app .bk-tablewrap'); b.scrollLeft = 0; b.scrollTop = 0; }")
    tot = E("""() => { const f = document.querySelector('#app table.bk-table tfoot'), td = f.querySelector('td'), r = td.getBoundingClientRect(), bar = document.querySelector('.bs-bankbar').getBoundingClientRect();
      const mo = document.querySelector('#app .bk-more');
      return {txt: f.innerText.replace(/\\s+/g, ' '), bottom: r.bottom + (mo ? mo.getBoundingClientRect().height + 6 : 0), bar: bar.top, h: innerHeight, sums: [...f.querySelectorAll('td.n b')].map(b => b.innerText)}; }""")
    ok("120 entries" in tot["txt"] and "Opening" in tot["txt"] and "Closing" in tot["txt"] and E(VIS, "#app [data-bank-totals]"), "the totals row: the lines, opening and closing (%s)" % tot["txt"][:120])
    ok(len([x for x in tot["sums"] if x.strip()]) >= 2, "and the withdrawals and deposits of the lines shown (%s)" % tot["sums"])
    ok(tot["bar"] - tot["bottom"] < 20 and tot["bottom"] > tot["h"] - 140, "pinned at the bottom of the window, just over the bar (%d / %d)" % (tot["bottom"], tot["bar"]))
    ok(E("parseFloat(getComputedStyle(document.querySelector('#app th.pt')).width)") > 300, "Particulars is the widest column")

    print("6. the drawer")
    pg.click('#app tr[data-rid="r4"] td.pt .pn'); W(400)
    dr = E("() => { const d = document.querySelector('[data-bank-drawer]'); if (!d) return null; const r = d.getBoundingClientRect(); return {id: d.dataset.bankDrawer, right: r.right, w: r.width, txt: d.innerText}; }")
    ok(dr and dr["id"] == "r4" and abs(dr["right"] - 1440) < 2, "a click on a line's particulars: its drawer on the right")
    ok(dr and "INVOICE 504" in dr["txt"] and "Rule used" in dr["txt"] and "Tally voucher" in dr["txt"] and "History" in dr["txt"], "with the narration, the rule, the Tally voucher and the history")
    ok(E(VIS, "[data-drawer-gone]") and "Already posted to Tally" in E("document.querySelector('[data-drawer-gone]').innerText"), "and the “Already posted to Tally” warning")
    ok(E("!!document.querySelector('[data-drawer-led=r4]')"), "its ledger can be changed there")
    pg.click("[data-drawer-next]"); W(300)
    ok(E("document.querySelector('[data-bank-drawer]').dataset.bankDrawer") != "r4", "↓ the next line")
    pg.keyboard.press("Escape"); W(300)
    ok(not E("!!document.querySelector('[data-bank-drawer]')") and E("S.tab") == "bank", "Esc closes it")
    pg.focus('#app tr[data-rid="r3"] [data-row-open]'); pg.keyboard.press("Enter"); W(400)
    ok(E("(document.querySelector('[data-bank-drawer]') || {dataset: {}}).dataset.bankDrawer") == "r3", "from the keyboard: the date opens the line's details")
    ok("In Tally" in E("document.querySelector('[data-drawer-tally]').innerText") or "Tally file" in E("document.querySelector('[data-drawer-tally]').innerText"), "a posted line: what Tally has (%s)" % E("document.querySelector('[data-drawer-tally]').innerText"))
    pg.click("[data-drawer-close]"); W(300)
    ok(not E("!!document.querySelector('[data-bank-drawer]')"), "✕ closes it")
    pg.click('#app tr[data-rid="r1"] [data-bled]'); W(200)
    ok(not E("!!document.querySelector('[data-bank-drawer]')"), "a click in the ledger box does not open the drawer")
    pg.keyboard.press("Escape"); W(200)

    print("7. Comfortable / Compact")
    h0 = E("document.querySelector('#app tbody tr[data-rid]').getBoundingClientRect().height")
    pg.click("#app [data-bank-density]"); W(400)
    h1 = E("document.querySelector('#app tbody tr[data-rid]').getBoundingClientRect().height")
    ok(h0 >= 38 and h1 <= 32, "Compact: lines of %d px (were %d)" % (h1, h0))
    ok(E("document.querySelector('#app [data-bank-density]').dataset.bankDensity") == "compact", "the switch says compact")
    reload(pg)
    ok(E("document.querySelector('#app tbody tr[data-rid]').getBoundingClientRect().height") <= 32, "after a reload: still compact (kept for this person)")
    pg.click("#app [data-bank-density]"); W(400)
    ok(E("document.querySelector('#app tbody tr[data-rid]').getBoundingClientRect().height") >= 38, "Comfortable again")
    ctx.close()

    print("8. a phone, and the dark theme")
    ctx, pg = start(br, 390, 844); E, W = pg.evaluate, pg.wait_for_timeout
    ok(not E(VIS, ".bkr") and E(VIS, "#side"), "390 px: no rail, the bar along the bottom")
    ok(E("document.documentElement.scrollWidth") <= 390, "no sideways scroll (%d)" % E("document.documentElement.scrollWidth"))
    ok(E(VIS, "#app [data-bank-post]") and E(VIS, ".bs-bankbar"), "Post and the bar are there")
    E("() => { B().drawer = 'r2'; render(); }"); W(400)
    d = E("() => { const r = document.querySelector('[data-bank-drawer]').getBoundingClientRect(); return [r.left, r.right]; }")
    ok(d[0] <= 1 and d[1] >= 389, "the drawer is a sheet across the phone")
    ctx.close()
    ctx, pg = start(br, 1440, 900, "dark"); E, W = pg.evaluate, pg.wait_for_timeout
    bg = E("getComputedStyle(document.querySelector('.bkr')).backgroundColor")
    lum = sum(int(x) for x in bg[bg.index("(") + 1:bg.index(")")].split(",")[:3])
    ok(lum < 200, "dark: the rail is dark (%s)" % bg)
    E("() => { B().drawer = 'r2'; render(); }"); W(300)
    bg = E("getComputedStyle(document.querySelector('[data-bank-drawer]')).backgroundColor")
    ok(sum(int(x) for x in bg[bg.index("(") + 1:bg.index(")")].split(",")[:3]) < 200, "dark: the drawer is dark (%s)" % bg)
    ctx.close()
    br.close()

print("9. the rail and the layout are in the Bank page's chunk")
first = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(SITE, "assets", "index-*.js")) + glob.glob(os.path.join(SITE, "assets", "index-*.css")))
ok("bk-rail" not in first and "data-bank-rail" not in first and "bsp-drawer" not in first, "not in the app's first file")
bank = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(SITE, "assets", "Bank-*.js")) + glob.glob(os.path.join(SITE, "assets", "Bank-*.css")))
ok("bk-rail" in bank and "bsp-drawer" in bank, "in the Bank page's chunk")
ok(not errors, "no page errors" + ("" if not errors else ": " + "; ".join(errors[:3])))
print("\nFAILED: %d" % len(fails) if fails else "\nall ok")
raise SystemExit(1 if fails else 0)
