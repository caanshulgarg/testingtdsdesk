"""python3 run_newlook_ui.py - "New look" phase 1 (docs/UX-QUICKBOOKS-OF-INDIA.md; the owner's review of 22-Nov-2026), behind
a switch per person, off unless turned on. Offline, made-up data only:
  0. off (the default): the sidebar, the top bar and the Bank page are as before (the old menu's items, the bank rail, no
     + New, no html.nl); the firm menu offers "Try the new look";
  1. turned on from the firm menu: kept for this person after a reload (localStorage fincom:newlook:<email>);
  2. the menu: the firm's 5 items and a client's 7 (then Settings / Client settings, All clients, Help); GST · TDS · ITR
     shows the row of its pages (GST, TDS, Income tax return, 26AS reconciliation);
  3. + New: Record (Journal F7, Payment F5, Receipt F6, Contra F4, bill, sale) and Bring in; Ctrl+K search finds a client by
     its GSTIN, the actions and the open client's ledgers; Enter opens; Esc closes;
  4. Bank: the tabs Statements · Lines to review · Rules · Reconciliation; the row of states says To review / Ready / Done /
     Set aside; Statements lists the statements with a dashed row for the missing month, opening ✓ chain, status words; a
     filter in every heading of Statements (the one list table's funnel) and of the lines (the old ColFunnel / HeadFilter);
     at 1366x768 at least twice as many lines wholly visible as with the switch off;
  5. + New › Payment: "As it goes to Tally" (Dr party, Cr bank), Balanced; a ledger not in Tally holds Post back; Post to
     Tally goes through the existing route (Bridge.post) with the one voucher builder's XML (VCHTYPE Payment, the bank
     allocation, FinCom's id in the narration) and says Done · in Tally; Journal's lines; Esc with typing asks first;
  6. Tally: one status line ("Connected. Your Tally is on port 9034 … in use by other users. Port N is free."), the six
     steps shown, the ports table with In use by you / In use by another user / Free (no other user's name or company);
     the Settings tab holds Post automatically and Books in the cloud;
  7. Settings: six plain groups, no Connect Tally / Books in the cloud / Sent to Tally / Post automatically, a Look
     section; an old address (#/settings/postlog) opens the Tally page's tab;
  8. a phone (390 px): no sideways scroll on Bank, + New and search in the top bar;
  9. the owner's decisions (23-Nov-2026), signed in to the firm account (a stand-in for the cloud): GST portal links leave
     Settings for the firm's GST page (Due dates › GST portal links; #/settings/gstapi opens it); a group "Email and
     messages" holds Daily Check's sending switch and the firm's test email and WhatsApp (the same assistant_mail_set
     call, the owner only); Academy batches stay. Off, Settings keeps GST API and has no Email and messages.
 11. the review of 23-Nov-2026: a confirm box over the entry window shows on top and takes the keys (Discard this
     entry?, Post into a closed period?); Statements' missing months and openings by the old page's rule (BankOverlap.join:
     "Possibly…" when unsure, no null opening read as 0); a Tally whose owner Windows cannot tell is not "yours" when
     the bridge tells another's; signed out, no empty Computers heading; the old look's guide not opened by the new
     look's Tally page; #/settings/postlog opens every client's record (S.logAll); Integrations in search; Esc closes
     search before the entry window; Due dates from the menu opens Due dates; staff who cannot read the sending setting
     see "unknown".
 10. follow-ups: the GST API warnings Settings' Needs you held ("not linked for N clients", "ends soon") are on the firm
     Home's Needs you, each a link to Due dates › GST portal links (off: Home as before, Settings keeps them); on a phone,
     signed in, every page's title fits the top bar (no "Settin…"), the menu's own words (Home, Due dates); off: the top
     bar's title as before (one line, cut with …).
Screenshots of every changed screen (desktop 1366x768 and phone 390, deviceScaleFactor 2) go to TDSDESK_SHOTS when set.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_newlook_ui.py"""
import os, threading, functools, http.server, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("NL_PORT") or 8941)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = """() => {
  const c = newCompany({name: "Test Traders Private Limited", gstin: "07AAGCL4827M1Z3"}); c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", last4: "0214", ledger: "ICICI Bank"}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const c2 = newCompany({name: "Sample Exports LLP", gstin: "27AAAFS1234K1Z9"}); S.companies[c2.id] = c2;
  const parties = ["Made Up Traders", "Sample Stores", "Demo Logistics", "Test Supplies Co", "Example Consulting", "Dummy Foods", "Imaginary Tech", "Fictional Movers"];
  let bal = 2500000;
  const rows = Array.from({length: 200}, (_, i) => { const out = i % 3 !== 1; const amt = [2000, 28788, 2970, 1000, 100000, 5.9, 16200, 1482][i % 8] * (1 + (i % 5) / 10);
    bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-04-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? r2(amt) : 0, credit: out ? 0 : r2(amt), balance: r2(bal),
      narr: (out ? "NEFT DR " : "NEFT CR ") + parties[i % 8].toUpperCase() + " UTR" + (100000 + i) + " BEING PAYMENT AGAINST INVOICE",
      dec: {name: parties[i % 8], mode: "NEFT", utr: "UTR" + (100000 + i)},
      ledger: i % 4 ? "" : parties[i % 8], state: i % 4 ? "attention" : "suggested", balOk: true, why: ["No ledger found for this party."]}; });
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s0", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-02-01", to: "2026-02-28", printed: true, opening: 2400000, closing: 2500000, n: 120, fileName: "icici-feb-2026.xlsx", uploadedAt: "2026-03-03T10:00:00Z", counts: {sent: 118, ignored: 2}},
    {id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-04-01", to: "2026-04-28", printed: true, opening: 2500000, closing: bal, totDr: 0, totCr: 0, n: 200, fileName: "icici-apr-2026.pdf", uploadedAt: "2026-05-02T09:30:00Z"}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "ICICI Bank", group: "Bank Accounts"}, {name: "Cash", group: "Cash-in-Hand"}, {name: "Office Rent", group: "Indirect Expenses"}]), importedAt: new Date().toISOString(), live: true},
    newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  render(); return c.id; }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
VIS = """() => { const t = document.querySelector('#app table.bk-table'); if (!t) return -1; const th = t.querySelector('thead'), tf = t.querySelector('tfoot');
  const top = th.getBoundingClientRect().bottom, bar = document.querySelector('.bs-bankbar'); let bot = Math.min(innerHeight, tf ? tf.getBoundingClientRect().top : innerHeight);
  if (bar) bot = Math.min(bot, bar.getBoundingClientRect().top);
  return [...t.querySelectorAll('tbody tr[data-rid]')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= top - 1 && b.bottom <= bot + 1; }).length; }"""
SIDE = "() => [...document.querySelectorAll('#side .side-link[data-side]')].filter((e) => e.offsetParent !== null || getComputedStyle(e).display !== 'none').map((e) => e.dataset.side)"
NL_ON = "try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}"

CLOUD = """(role) => { window.__calls = []; S.firm.firmName = "Sample & Co"; S.account = {me: {role, name: "Made-up Owner"}, firm: {}};
  Cloud.on = () => true;
  Cloud.api = async (path, o) => { o = o || {}; window.__calls.push([path, o.method || "GET", o.body || null]); const t = path.split("?")[0];
    if (t === "assistant_mail") return [{real_send: false, test_to: "office@samplefirm.example", test_whatsapp: "+91 90000 00000"}];
    if (t.startsWith("rpc/")) return {ok: true}; return []; };
  GSTAPI.on = () => true; GSTAPI.firmStatus = async () => ({sessions: [], returns: [], accounts: []});
  render(); return true; }"""

# two clients' GST portal links: one ended (not linked any more), one live and ending soon
GSTS = """() => { GSTAPI.sess = {"07AAGCL4827M1Z3": {connectedAt: "2026-10-01T10:00:00Z", endedAt: "2026-11-01T10:00:00Z"}, "27AAAFS1234K1Z9": {connectedAt: "2026-11-10T10:00:00Z", accessUntil: new Date(Date.now() + 2 * 864e5).toISOString()}};
  GSTAPI.live = (g) => g === "27AAAFS1234K1Z9"; GSTAPI.accessLeft = (g) => (g === "27AAAFS1234K1Z9" ? {soon: true, over: false} : null); render(); return true; }"""
TITLE = """() => { const h = document.querySelector('header.top .tbar-title h2'); if (!h) return null; const r = document.createRange(); r.selectNodeContents(h);
  const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; const cs = getComputedStyle(h);
  return {text: h.textContent, fits: h.scrollWidth <= h.clientWidth + 1, lines, ws: cs.whiteSpace, to: cs.textOverflow}; }"""

# scrolled to the end, the element is wholly above what is fixed at the foot (the bottom menu, the bank's foot bar)
CLEAR = """(sel) => { const se = document.scrollingElement; se.scrollTop = se.scrollHeight; const el = document.querySelector(sel); if (!el) return null;
  const fixed = [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = e.getBoundingClientRect(); return r.height > 0 && r.height < innerHeight / 2 && r.bottom >= innerHeight - 40 && !e.closest('#app tr'); });
  const top = Math.min(innerHeight, ...fixed.map((e) => e.getBoundingClientRect().top)), b = el.getBoundingClientRect().bottom;
  return {bottom: Math.round(b), top: Math.round(top), ok: b <= top + 1}; }"""

def page(br, w=1366, h=768, nl=False, phone=False):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=phone, has_touch=phone)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1500)
    return ctx, pg
def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
def go(pg, js, ms=1200): pg.evaluate("() => { " + js + " }"); pg.wait_for_timeout(ms)

with sync_playwright() as p:
    br = p.chromium.launch()
    print("0. off: as before")
    ctx, pg = page(br)
    off_rows = pg.evaluate(VIS)
    side = pg.evaluate(SIDE)
    ok(not pg.evaluate("document.documentElement.classList.contains('nl')"), "no new look on the page")
    ok("Transactions" in side and "Overview" in side or pg.locator("[data-bank-rail]").count() == 1, "the old menu (or the bank rail) as before (%s)" % side[:6])
    ok(pg.locator("[data-bank-rail]").count() == 1, "Bank keeps its rail")
    ok(pg.locator("[data-nl-top], [data-nl-banktab]").count() == 0, "no + New, no search box, no Bank tabs")
    ok(pg.locator("#app .sbar-band [data-state='intally']").first.inner_text().startswith("Posted"), "the row of states keeps its words (Posted)")
    print("   lines wholly visible at 1366x768, off: %d" % off_rows)
    go(pg, "navHome('clients')"); side = pg.evaluate(SIDE)
    ok("Today" in side and "Compliance" in side, "the firm menu as before (%s)" % side)
    pg.locator(".firmbtn").click(); pg.wait_for_timeout(300)
    sw = pg.locator("[data-newlook-switch]")
    ok(sw.count() == 1 and sw.get_attribute("data-newlook-switch") == "off", "the firm menu offers the new look, off")
    print("1. turned on from the firm menu, kept after a reload")
    sw.click(); pg.wait_for_timeout(1200)
    ok(pg.evaluate("document.documentElement.classList.contains('nl')"), "the new look is on at once")
    ok(pg.evaluate("localStorage.getItem('fincom:newlook:local')") == "on", "kept for this person")
    pg.reload(); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(1000)
    ok(pg.evaluate("document.documentElement.classList.contains('nl')"), "still on after a reload")
    pg.evaluate("localStorage.setItem('fincom:newlook:local', 'off')"); ctx.close()

    print("2. the menu")
    ctx, pg = page(br, nl=True)
    side = pg.evaluate(SIDE)
    ok(side[:7] == ["Home", "Bank", "Purchase", "Sales", "GST · TDS · ITR", "Books", "Tally"], "a client's 7 items (%s)" % side)
    ok(side[7:] == ["Client settings", "All clients", "Help"], "then Client settings, All clients, Help (%s)" % side[7:])
    ok(pg.locator("[data-bank-rail]").count() == 0, "no bank rail: the one menu everywhere")
    go(pg, "goClient('books:gst')", 2000)
    tabs = pg.evaluate("() => [...document.querySelectorAll('[data-nl-tabs] [data-nl-tab]')].map((e) => e.textContent)")
    ok(tabs == ["GST", "TDS", "Income tax return", "26AS reconciliation"], "GST · TDS · ITR's pages in one row (%s)" % tabs)
    ok(pg.locator('#side .side-link[data-side="GST · TDS · ITR"][aria-current="page"]').count() == 1, "its menu item is lit")
    shot(pg, "desktop-01-menu-returns")
    pg.locator('[data-nl-tab="tds"]').click(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("booksTab()") == "tds", "a click opens TDS (its address kept: books:tds)")
    go(pg, "goClient('books:reports')", 1500)
    ok(pg.locator('[data-nl-tabs="books"] [data-nl-tab="txn"]').count() == 1, "Books holds Transactions, MIS, Look up … in its row")
    shot(pg, "desktop-02-menu-books")
    go(pg, "navHome('today')"); side = pg.evaluate(SIDE)
    ok(side == ["Home", "Clients", "Due dates", "Daily Check", "Tally", "Settings", "Help"], "the firm's 5 items, then Settings and Help (%s)" % side)
    shot(pg, "desktop-03-firm-home")

    print("3. + New and search")
    pg.locator("[data-nl-new]").click(); pg.wait_for_timeout(300)
    rec = pg.evaluate("() => [...document.querySelectorAll('[data-nl-record]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())")
    ok(rec[:4] == ["Journal F7", "Payment F5", "Receipt F6", "Contra F4"], "Record: Journal F7, Payment F5, Receipt F6, Contra F4 (%s)" % rec)
    ok(pg.locator("[data-nl-bring]").count() == 3, "Bring in: bank statement, bills, new client")
    shot(pg, "desktop-04-new-menu")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    pg.keyboard.press("Control+k"); pg.wait_for_timeout(400)
    ok(pg.locator("[data-nl-palette]").count() == 1, "Ctrl+K opens the search")
    ok(not pg.evaluate("!!S.switcher"), "not the client switcher (F3 keeps it)")
    pg.keyboard.type("27AAAFS"); pg.wait_for_timeout(300)
    ok("Sample Exports LLP" in pg.locator("[data-nl-palette]").inner_text(), "a client found by its GSTIN")
    shot(pg, "desktop-05-search")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.view === 'company' && CO().name") == "Sample Exports LLP" and pg.locator("[data-nl-palette]").count() == 0, "Enter opens it")
    go(pg, "openCompany(Object.values(S.companies).find((c) => /Test Traders/.test(c.name)).id).then(() => { S.tab = 'bank'; render(); })", 1500)
    pg.keyboard.press("Control+k"); pg.wait_for_timeout(300); pg.keyboard.type("office rent"); pg.wait_for_timeout(300)
    ok("Office Rent" in pg.locator("[data-nl-palette]").inner_text(), "the open client's ledgers are found")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    ok(pg.locator("[data-nl-palette]").count() == 0, "Esc closes it")

    print("4. Bank")
    go(pg, "S.nlBankTab = 'lines'; render();", 1500)
    tabs = pg.evaluate("() => [...document.querySelectorAll('[data-nl-banktab]')].map((e) => e.dataset.nlBanktab)")
    ok(tabs == ["stmts", "lines", "rules", "recon"], "four tabs (%s)" % tabs)
    words = pg.evaluate("() => [...document.querySelectorAll('#app .sbar-band [data-state]')].map((e) => e.firstChild.textContent.trim())")
    ok(words == ["To review", "Ready", "Done", "Set aside"], "the row of states in the five words (%s)" % words)
    ok(pg.locator("#app table.bk-table thead th .colf").count() >= 8, "a filter in every heading of the lines (%d)" % pg.locator("#app table.bk-table thead th .colf").count())
    on_rows = pg.evaluate(VIS)
    ok(on_rows >= 2 * off_rows and on_rows >= 12, "lines wholly visible at 1366x768: %d (off: %d)" % (on_rows, off_rows))
    st = pg.locator('#app tr[data-rid="r1"] td.bs-st .tag')
    ok(st.inner_text() == "To review" and st.get_attribute("title") == "To review · no ledger", "a line's status: To review (no ledger on hover)")
    shot(pg, "desktop-06-bank-lines")
    pg.locator('[data-hf="st"]').click(); pg.wait_for_timeout(300)
    ok("To review · no ledger" in pg.locator("[data-hf-pop]").inner_text(), "the Status heading's filter in the same words")
    pg.keyboard.press("Escape")
    pg.locator('[data-nl-banktab="stmts"]').click(); pg.wait_for_timeout(1200)
    names = pg.evaluate("() => [...document.querySelectorAll('#app [data-nl-stmt]')].map((e) => e.dataset.nlStmt)")
    ok(names == ["s0", "gap:s1", "s1"], "the statements by date, with the missing month between (%s)" % names)
    ok("No statement for 01-Mar-2026 to 31-Mar-2026" in pg.locator('#app [data-nl-stmt="gap:s1"]').inner_text(), "the missing month says which (the old page's words)")
    ok("2 statements" in pg.locator("#app [data-nl-stmts] tfoot").inner_text(), "the count is of statements, not the missing month's row")
    ok("✓" in pg.locator('#app [data-nl-stmt="s1"]').inner_text(), "April opens at March's… February's closing: ✓")
    pills = pg.evaluate("() => [...document.querySelectorAll('#app [data-nl-stmts] [data-nl-pill]')].map((e) => e.dataset.nlPill)")
    ok(pills == ["Done", "Problem", "To review"], "one status word each (%s)" % pills)
    ok(pg.locator("#app [data-nl-stmts] thead [data-ltf]").count() >= 8, "a filter in every heading of Statements")
    ok(pg.locator("#app .sbar-band:visible").count() == 0 and pg.locator(".bs-bankbar").count() == 0, "no row of line states and no lines' bar on Statements")
    shot(pg, "desktop-07-bank-statements")
    pg.locator('#app [data-nl-stmts] thead [data-ltf="st"]').click(); pg.wait_for_timeout(500)
    ok(pg.locator("[data-ltf-pop]").count() == 1, "the Status heading's filter opens")
    shot(pg, "desktop-08-bank-statements-filter")
    pg.locator('[data-ltf-v="Done"]').check(); pg.wait_for_timeout(300); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    ok(pg.evaluate("() => document.querySelectorAll('#app [data-nl-stmt]').length") == 1, "Status: Done shows only February")
    pg.evaluate("() => { delete S.listF.nlStmts; render(); }"); pg.wait_for_timeout(300)
    pg.locator('[data-nl-stmt-open="s0"]').click(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.bank.cur") == "s0" and pg.evaluate("S.nlBankTab") == "lines", "Open: that statement's lines")
    pg.locator('[data-nl-banktab="recon"]').click(); pg.wait_for_timeout(600)
    ok(pg.locator("[data-nl-recon]").count() == 1, "Reconciliation: what it does, and its button")
    shot(pg, "desktop-09-bank-recon")
    pg.locator('[data-nl-banktab="rules"]').click(); pg.wait_for_timeout(800)
    ok(pg.evaluate("bankTab()") == "rules", "Rules: the statement's rules")
    go(pg, "S.bank = null; render();", 100)
    ok(pg.locator("[data-nl-skel]").count() == 1 or pg.evaluate("!!B() && B().loading === false"), "loading: the skeleton in the table's shape")
    go(pg, "S.bank = {cid: S.coId, loading: true, stmts: [], rows: [], sel: new Set(), sticky: new Set()}; render();", 400)
    ok(pg.locator("[data-nl-skel].on").count() == 1, "while it loads: rows of grey bars, no spinner")
    shot(pg, "desktop-10-bank-loading")
    ctx.close()

    print("5. + New › Payment, Journal")
    ctx, pg = page(br, nl=True)
    pg.evaluate("""() => { window.__posted = null; window.postToProblem = () => ""; window.tallyPostSign = () => ({on: true}); window.canPostTally = () => true;
      Bridge.post = async (payload) => { window.__posted = payload; return {ok: true, company: payload.company, results: payload.vouchers.map((v) => ({id: v.id, ok: true, vchId: "4512"}))}; }; }""")
    pg.locator("[data-nl-new]").click(); pg.locator('[data-nl-record="Payment"]').click(); pg.wait_for_timeout(1200)
    ok(pg.locator('[data-nl-entry="Payment"]').count() == 1, "the Payment form opens, for the open client")
    pg.fill('[data-nle-date]', "2026-04-15")
    pg.fill('[data-nle-in="a"]', "ICICI Bank"); pg.fill('[data-nle-in="b"]', "Office Rentt"); pg.fill('[data-nle-amt]', "25000"); pg.fill('[data-nle-narr]', "April rent"); pg.wait_for_timeout(300)
    ok(pg.locator('[data-nle-post]').is_disabled() and "not a ledger" in pg.locator("[data-nle-problems]").inner_text(), "a ledger not in Tally holds Post back, and says so")
    pg.fill('[data-nle-in="b"]', "Office Rent"); pg.wait_for_timeout(300)
    prev = pg.locator("[data-nle-preview] tbody").inner_text()
    ok(re.search(r"Office Rent\s+25,000\.00", prev) and re.search(r"ICICI Bank\s+25,000\.00", prev), "As it goes to Tally: Dr Office Rent, Cr ICICI Bank (%s)" % prev.replace("\n", " | "))
    ok(pg.locator('[data-nle-balanced="yes"]').count() == 1, "Balanced")
    shot(pg, "desktop-11-new-payment")
    pg.locator('[data-nle-post]').click(); pg.wait_for_timeout(1500)
    po = pg.evaluate("window.__posted")
    x = (po or {}).get("vouchers", [{}])[0].get("xml", "") if po else ""
    ok(bool(po) and po.get("company") == "Test Traders Private Limited" and po.get("masters") == [], "posted by the existing route (Bridge.post) to the client's company")
    ok('VCHTYPE="Payment"' in x and "<DATE>20260415</DATE>" in x and "<PARTYLEDGERNAME>Office Rent</PARTYLEDGERNAME>" in x, "the one builder's voucher: Payment, its date, its party")
    ok("<BANKALLOCATIONS.LIST>" in x and re.search(r"April rent \| TDSDesk:asst-", x), "the bank allocation, and FinCom's id in the narration")
    ok(pg.locator('[data-nle-result="posted"]').count() == 1 and "voucher id 4512" in pg.locator('[data-nle-result]').inner_text(), "Done · in Tally, with Tally's voucher id")
    shot(pg, "desktop-12-new-payment-posted")
    pg.locator("[data-nle-another]").click(); pg.wait_for_timeout(300)
    pg.locator('[data-nle-type="Journal"]').click(); pg.wait_for_timeout(300)
    pg.fill('[data-nle-in="l0"]', "Office Rent"); pg.fill('[data-nle-amt="dr0"]', "1000"); pg.fill('[data-nle-in="l1"]', "Cash"); pg.fill('[data-nle-amt="cr1"]', "600")
    pg.locator('[data-nle-amt="cr1"]').press("Enter"); pg.wait_for_timeout(300)
    ok(pg.locator("[data-nle-line]").count() == 3 and pg.input_value('[data-nle-amt="cr2"]') == "400", "Enter on the last line adds one, with what is left (400 Cr)")
    pg.fill('[data-nle-in="l2"]', "Made Up Traders"); pg.wait_for_timeout(300)
    ok(pg.locator('[data-nle-balanced="yes"]').count() == 1, "the journal balances")
    shot(pg, "desktop-13-new-journal")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(pg.locator('[data-nl-entry]').count() == 1, "Esc with something typed asks first (the form stays)")
    ctx.close()

    print("6. Tally")
    ctx, pg = page(br, nl=True)
    pg.evaluate("""() => { const now = new Date().toISOString();
      Bridge.setCfg({url: 'http://127.0.0.1:9105', key: 'k-made-up', bridgeId: 'b1', follow: true});
      TLight.st.devs = [{id: 'd1', name: 'OFFICE-SERVER', info: {computer: 'OFFICE-SERVER', bridges: {
          b1: {user: 'OFFICE-SERVER\\\\usera', computer: 'OFFICE-SERVER', bridgePort: 9105, tallyPort: 9034, version: '2.5.18', at: now, open: ['Test Traders Private Limited']},
          b2: {user: 'OFFICE-SERVER\\\\userb', computer: 'OFFICE-SERVER', bridgePort: 9106, tallyPort: 9002, version: '2.5.18', at: now, open: ['Secret Other Co']}},
        beat: {at: now, windowsUser: 'OFFICE-SERVER\\\\usera', computer: 'OFFICE-SERVER', bridgePort: 9105, tallyPort: 9034, ports: [{port: 9034, ok: true}, {port: 9000, skipped: true, error: 'Tally of userb'}]}}, main_bridge: 'b1'}];
      navHome('tally'); }""")
    pg.wait_for_timeout(2500)
    line = pg.locator("[data-nl-tally-status]").inner_text() if pg.locator("[data-nl-tally-status]").count() else ""
    ok("Connected." in line and "port 9034" in line and "in use by other users" in line and re.search(r"Port \d+ is free", line), "the status line (%s)" % line)
    ok(pg.locator("[data-tsm-step]").count() == 6, "the six steps shown (%d)" % pg.locator("[data-tsm-step]").count())
    who = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-nl-port]')].map((r) => [r.dataset.nlPort, r.querySelector('[data-nl-port-who]').dataset.nlPortWho]))")
    ok(who.get("9105") == "you" and who.get("9034") == "you", "your bridge and your Tally: In use by you (%s)" % who)
    ok(who.get("9000") == "other" and who.get("9002") == "other" and who.get("9106") == "other", "another user's Tally and bridge: In use by another user")
    ok(list(who.values()).count("free") == 1, "one port Free, with Copy port")
    txt = pg.locator("[data-nl-this]").inner_text()
    ok("userb" not in txt and "Secret Other Co" not in txt, "never another user's name or company")
    ok(pg.locator("[data-nl-port] th, [data-nl-this] thead [data-ltf]").count() >= 3, "the ports table has a filter in its headings")
    ok("Computers that send" not in pg.locator("[data-nl-this]").inner_text(), "signed out: no empty Computers heading")
    ok(not pg.evaluate("!!(S.tsm && S.tsm.open)"), "the old look's guide is not opened by the new look's Tally page (S.tsm)")
    go(pg, "S.nlTsm = Object.assign(S.nlTsm || {}, {open: false}); render();", 500)
    go(pg, "navHome('today')", 800); go(pg, "navHome('tally')", 1500)
    ok(pg.evaluate("!!(S.nlTsm && S.nlTsm.open)") and pg.locator("[data-tsm-step]").count() == 6, "the six steps shown again each time the Tally page opens (hidden only until the page is left)")
    shot(pg, "desktop-14-tally")
    pg.locator('[data-nl-tallytab="settings"]').click(); pg.wait_for_timeout(1200)
    ok(pg.locator("[data-nl-tally-settings]").count() == 1 and "Post automatically" in pg.locator("[data-nl-tally-settings]").inner_text(), "Settings tab: Post automatically (moved from Settings)")
    shot(pg, "desktop-15-tally-settings")
    print("7. Settings")
    go(pg, "goSettings(null)", 1500)
    labels = pg.evaluate("() => [...document.querySelectorAll('[data-set-item]')].map((e) => e.dataset.setItem)")
    for gone in ("bridge", "tcloud", "postlog", "autopost"):
        ok(gone not in labels, "no %s in Settings" % gone)
    ok("look" in labels and "rates" in labels and "reading" in labels, "Look, TDS rates, Reading bills kept (%s)" % labels)
    groups = pg.evaluate("() => [...document.querySelectorAll('.setgroup-t')].map((e) => e.textContent)")
    ok(all(g not in groups for g in ("Tally", "How the work is done", "GST")), "the empty group headings are gone (%s)" % groups)
    shot(pg, "desktop-16-settings")
    go(pg, "goSettings('look')", 800)
    ok(pg.locator("[data-set-newlook]").is_checked(), "Look: the switch, on")
    go(pg, "goSettings('postlog')", 1500)
    ok(pg.evaluate("S.homeTab") == "tally" and pg.evaluate("S.tallyTab") == "sent", "an old address (#/settings/postlog) opens Tally › Sent to Tally")
    ok(pg.evaluate("S.logAll") is True, "… with every client's record, as the old link did (S.logAll)")
    ctx.close()

    print("9. the owner's decisions: GST portal links to the GST page, Email and messages")
    ctx, pg = page(br)
    pg.evaluate(CLOUD, "owner"); go(pg, "goSettings(null)", 1500)
    labels = pg.evaluate("() => [...document.querySelectorAll('[data-set-item]')].map((e) => e.dataset.setItem)")
    groups = pg.evaluate("() => [...document.querySelectorAll('.setgroup-t')].map((e) => e.textContent)")
    ok("gstapi" in labels and "mail" not in labels and "Email and messages" not in groups, "off: Settings as before (GST API there, no Email and messages) (%s)" % labels)
    ctx.close()
    ctx, pg = page(br, nl=True)
    pg.evaluate(CLOUD, "owner"); go(pg, "goSettings(null)", 1500)
    labels = pg.evaluate("() => [...document.querySelectorAll('[data-set-item]')].map((e) => e.dataset.setItem)")
    groups = pg.evaluate("() => [...document.querySelectorAll('.setgroup-t')].map((e) => e.textContent)")
    ok("gstapi" not in labels, "GST portal links are not in Settings (%s)" % labels)
    ok("batches" in labels, "Academy batches stay in Settings")
    ok("Email and messages" in groups and "mail" in labels, "a group Email and messages with its section (%s)" % groups)
    go(pg, "goSettings('mail')", 1500)
    box = pg.locator("[data-nl-mail]")
    ok(box.count() == 1, "Email and messages opens")
    ok(box.locator("[data-mail-real]").count() == 1 and not box.locator("[data-mail-real]").is_checked(), "the sending switch, read from the firm's setting (off: test mode)")
    ok(box.locator("[data-mail-to]").input_value() == "office@samplefirm.example", "the firm email for tests, read from the firm's setting")
    shot(pg, "desktop-17-settings-mail")
    box.locator("[data-mail-to]").fill("accounts@samplefirm.example"); box.locator("[data-mail-save]").click(); pg.wait_for_timeout(800)
    sets = [c for c in pg.evaluate("() => window.__calls") if c[0] == "rpc/assistant_mail_set"]
    ok(len(sets) == 1 and sets[0][2] == {"p_real": False, "p_test_to": "accounts@samplefirm.example", "p_test_whatsapp": "+91 90000 00000"}, "Save: the same call as Daily Check's (assistant_mail_set), real sending still off (%s)" % sets)
    go(pg, "goSettings('gstapi')", 2000)
    ok(pg.evaluate("S.homeTab") == "compliance" and pg.evaluate("S.nlDueTab") == "gstapi", "an old address (#/settings/gstapi) opens the GST page's GST portal links")
    tabs = pg.evaluate("() => [...document.querySelectorAll('[data-nl-duetab]')].map((e) => e.textContent)")
    ok(tabs == ["Due dates", "GST portal links"], "the firm's GST page: Due dates · GST portal links (%s)" % tabs)
    ok(pg.locator('[data-pane="gstapi-all"]').count() == 1, "GST portal links: every client's GST portal link, as it was in Settings")
    shot(pg, "desktop-18-gst-portal-links")
    pg.locator('[data-nl-duetab="due"]').click(); pg.wait_for_timeout(1200)
    ok(pg.locator('[data-pane="gstapi-all"]').count() == 0 and pg.evaluate("S.nlDueTab") == "due", "Due dates: the list of what is due, as before")
    pg.evaluate(CLOUD, "staff"); go(pg, "goSettings('mail')", 1200)
    ok(pg.locator("[data-nl-mail] [data-mail-save]").count() == 0 and "owner" in pg.locator("[data-nl-mail]").inner_text(), "staff: only the owner changes sending")
    ctx.close()
    ctx, pg = page(br, 390, 844, nl=True, phone=True)
    pg.evaluate(CLOUD, "owner"); go(pg, "goSettings('mail')", 1500); shot(pg, "phone-09-settings-mail")
    go(pg, "S.nlDueTab = 'gstapi'; navHome('compliance')", 2000)
    ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "phone: GST portal links, no sideways scroll")
    shot(pg, "phone-10-gst-portal-links")
    ctx.close()

    print("10. follow-ups: GST API warnings on Home; titles fit on a phone")
    ctx, pg = page(br)
    pg.evaluate(CLOUD, "owner"); pg.evaluate(GSTS); go(pg, "navHome('today')", 1500)
    ok(pg.locator("[data-nl-home-needs]").count() == 0, "off: Home as before (no new Needs you line)")
    go(pg, "goSettings(null)", 1200)
    needs = pg.evaluate("() => [...document.querySelectorAll('[data-needs-go]')].map((e) => e.textContent)")
    ok(any("GST API not linked for 1 client" in n for n in needs), "off: Settings' Needs you keeps the GST API warning (%s)" % needs)
    t = pg.evaluate(TITLE)
    ok(t and t["ws"] == "nowrap", "off: the top bar's title as before, one line (%s)" % t)
    ctx.close()
    ctx, pg = page(br, nl=True)
    pg.evaluate(CLOUD, "owner"); pg.evaluate(GSTS); go(pg, "navHome('today')", 1500)
    box = pg.locator("[data-nl-home-needs]")
    txt = box.inner_text() if box.count() else ""
    ok(box.count() == 1 and "GST API not linked for 1 client" in txt and "GST API link ends soon for 1 client" in txt, "Home › Needs you: the GST API warnings (%r)" % txt)
    shot(pg, "desktop-19-home-needs-gst")
    if box.locator("[data-nl-needs-go]").count(): box.locator("[data-nl-needs-go]").first.click(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.homeTab") == "compliance" and pg.evaluate("S.nlDueTab") == "gstapi" and pg.locator('[data-pane="gstapi-all"]').count() == 1, "the warning opens Due dates › GST portal links")
    pg.evaluate("() => { GSTAPI.sess = {}; GSTAPI.live = () => false; GSTAPI.accessLeft = () => null; render(); }"); go(pg, "navHome('today')", 1000)
    ok(pg.locator("[data-nl-home-needs]").count() == 0, "nothing to say: no Needs you line")
    # the Tally computer offline (the rule Settings' Needs you had: this person's own bridge's computer, heard with Tally
    # within the week, not now, the computers read within 3 minutes); another person's computer: nothing
    DEV = "{id: 'dev-x', name: 'Test PC', info: {beat: {at: new Date(Date.now() - 3600e3).toISOString(), tally: true}}}"
    pg.evaluate("() => { window.__own = window.FCOwn; TLight.st.devs = [%s]; TLight.st.at = Date.now(); render(); }" % DEV); go(pg, "navHome('today')", 1000)
    ok(pg.locator("[data-nl-home-needs]").count() == 0, "another person's computer offline: nothing on Home")
    pg.evaluate("() => { window.FCOwn = Object.assign({}, window.__own, {bridge: () => ({dev: TLight.st.devs[0], id: 'b1'})}); TLight.st.at = Date.now(); render(); }"); go(pg, "navHome('today')", 1000)
    txt = pg.locator("[data-nl-home-needs]").inner_text() if pg.locator("[data-nl-home-needs]").count() else ""
    ok("Your computer with Tally is offline since " in txt and "Test PC" not in txt, "their own Tally computer offline: Home › Needs you says so (%r)" % txt)
    tile = pg.evaluate("() => { const m = [...document.querySelectorAll('.metrics .metric')].find((e) => /Needs you/.test(e.textContent)); return m ? Number(m.querySelector('b').textContent) : null; }")
    items = pg.locator("[data-nl-home-needs] [data-nl-needs-go]").count()
    head = pg.locator("[data-nl-home-needs] > b").inner_text() if pg.locator("[data-nl-home-needs] > b").count() else ""
    ok(tile == items and "(" not in head, "one Needs you count on Home: the tile counts the firm's items too, the strip has no count of its own (tile %s, items %s, %r)" % (tile, items, head))
    shot(pg, "desktop-20-home-needs-tally")
    if pg.locator('[data-nl-needs-go="tally"]').count(): pg.locator('[data-nl-needs-go="tally"]').click(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.homeTab") == "tally", "the warning opens the Tally page")
    ctx.close()
    ctx, pg = page(br, 390, 844, nl=True, phone=True)
    pg.evaluate(CLOUD, "owner"); pg.evaluate(GSTS)
    for js, want in (("goSettings(null)", "Settings"), ("goSettings('mail')", None), ("S.nlDueTab = 'due'; navHome('compliance')", "Due dates"), ("navHome('daily')", "Daily Check"),
                     ("navHome('today')", "Home"), ("navHome('clients')", "Clients"), ("navHome('tally')", "Tally"), ("navHome('help')", "Help"), ("goClient('bank')", None)):
        go(pg, js, 1500); t = pg.evaluate(TITLE)
        ok(t and t["fits"] and t["lines"] <= 2 and (want is None or t["text"] == want), "phone, signed in: the title fits (%s)" % t)
    go(pg, "navHome('today')", 1500); shot(pg, "phone-11-home-needs-gst")
    go(pg, "goSettings(null)", 1200); shot(pg, "phone-12-settings-signed-in")
    ctx.close()

    print("11. the review of 23-Nov-2026")
    ctx, pg = page(br, nl=True)
    # the real Bridge.post (its closed-period check, ClosedP.gate, is inside it); the bridge's own requests are counted
    sent = []
    pg.on("request", lambda r: sent.append(r.url) if "127.0.0.1" in r.url or "localhost:9" in r.url else None)
    pg.evaluate("""() => { window.postToProblem = () => ""; window.tallyPostSign = () => ({on: true}); window.canPostTally = () => true;
      window.linkGuid = async () => ({guid: "g1"}); }""")
    TOP = """() => { const y = document.querySelector('#confirmBox [data-cbx=yes]'); const box = document.getElementById('confirmBox');
      if (!y || !box || box.style.display === 'none' || getComputedStyle(box).display === 'none') return null;
      const b = y.getBoundingClientRect(), el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return {title: (document.getElementById('cbxT') || {}).textContent || '', top: !!(el && el.closest('#confirmBox'))}; }"""
    go(pg, "S.nlEntry = {type: 'Payment', cid: S.coId}; render();", 1500)
    pg.fill('[data-nle-narr]', "something typed"); pg.wait_for_timeout(200)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    c = pg.evaluate(TOP)
    ok(c and c["top"] and "Discard" in c["title"], "Esc with typing: 'Discard this entry?' shows on top of the entry window (%s)" % c)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    ok(pg.evaluate(TOP) is None and pg.locator("[data-nl-entry]").count() == 1, "Esc again answers the box (No): the box closes, the entry stays")
    # a closed period: the box shows on top, and Esc (not a hidden Enter) is what it takes
    pg.evaluate("() => { ClosedP.why = () => ['books closed up to 31-Mar-2026']; ClosedP.booksOf = async () => null; }")
    pg.fill('[data-nle-date]', "2026-03-15"); pg.fill('[data-nle-in="a"]', "ICICI Bank"); pg.fill('[data-nle-in="b"]', "Office Rent"); pg.fill('[data-nle-amt]', "25000"); pg.wait_for_timeout(300)
    pg.locator('[data-nle-post]').click(); pg.wait_for_timeout(2000)
    c = pg.evaluate(TOP)
    ok(c and c["top"] and "closed period" in c["title"].lower(), "Post into a closed period?: the box shows on top (%s)" % c)
    shot(pg, "desktop-21-entry-closed-period")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(1200)
    et = pg.locator("[data-nl-entry]").inner_text() if pg.locator("[data-nl-entry]").count() else ""
    ok(pg.evaluate(TOP) is None and "closed period" in et and not [u for u in sent if "/post" in u or "import" in u.lower()], "Esc: held back, not posted (%r)" % et[-160:])
    # search over the entry window: Esc closes the search first
    go(pg, "S.nlSearch = {q: '', i: 0}; render();", 600)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    ok(pg.locator("[data-nl-palette]").count() == 0 and pg.locator("[data-nl-entry]").count() == 1 and pg.evaluate(TOP) is None, "search over the entry window: Esc closes the search, the entry stays")
    go(pg, "S.nlEntry = null; render();", 400)
    # Statements: the old page's rules (BankOverlap.join)
    go(pg, """S.bank.stmts = [{id: 's0', acctId: 'a1', bank: 'ICICI', acct: '0214', from: '2026-02-01', to: '2026-02-27', opening: 100, closing: 200, n: 10, counts: {sent: 10}},
      {id: 's1', acctId: 'a1', bank: 'ICICI', acct: '0214', from: '2026-03-04', to: '2026-03-31', opening: null, closing: 300, n: 200}]; S.bank.cur = 's1'; S.nlBankTab = 'stmts'; render();""", 1200)
    gap = pg.locator('#app [data-nl-stmt="gap:s1"]')
    gt = gap.inner_text() if gap.count() else ""
    ok("Possibly no statement for 28-Feb-2026 to 03-Mar-2026" in gt and "Problem" not in gt, "27-Feb then 04-Mar, periods not printed: 'Possibly no statement…', not a Problem (%r)" % gt)
    s1 = pg.locator('#app [data-nl-stmt="s1"]').inner_text()
    ok("Opens at" not in s1 and "Problem" not in s1, "an opening not known: not read as ₹0, no Problem (%r)" % s1)
    go(pg, """S.bank.stmts = [{id: 's0', acctId: 'a1', bank: 'ICICI', acct: '0214', from: '2026-02-01', to: '2026-02-20', opening: 100, closing: 200, n: 10},
      {id: 's1', acctId: 'a1', bank: 'ICICI', acct: '0214', from: '2026-02-15', to: '2026-03-31', opening: 999, closing: 300, n: 20}]; render();""", 1000)
    names = pg.evaluate("() => [...document.querySelectorAll('#app [data-nl-stmt]')].map((e) => e.dataset.nlStmt)")
    ok(names == ["s0", "s1"] and "Opens at" not in pg.locator('#app [data-nl-stmt="s1"]').inner_text(), "two statements that overlap: no missing month, no chain (%s)" % names)
    # search: the firm's Integrations page; Due dates from the menu opens Due dates
    pg.keyboard.press("Control+k"); pg.wait_for_timeout(300); pg.keyboard.type("integrations"); pg.wait_for_timeout(300)
    ok("Integrations" in pg.locator("[data-nl-palette]").inner_text(), "search finds the Integrations page")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(1200)
    ok(pg.evaluate("S.homeTab") == "integrations", "Enter opens Integrations")
    go(pg, "S.nlDueTab = 'gstapi'; navHome('today');", 600)
    pg.locator('#side .side-link[data-side="Due dates"]').click(); pg.wait_for_timeout(1200)
    ok(pg.evaluate("S.homeTab") == "compliance" and pg.evaluate("S.nlDueTab") != "gstapi", "Due dates from the menu opens Due dates, not the last tab")
    ctx.close()
    # a Tally whose owner Windows cannot tell, while the bridge tells another Tally's owner: not "yours"
    ctx, pg = page(br, nl=True)
    pg.evaluate("""() => { const now = new Date().toISOString();
      Bridge.setCfg({url: 'http://127.0.0.1:9105', key: 'k-made-up', bridgeId: 'b1', follow: true});
      TLight.st.devs = [{id: 'd1', name: 'OFFICE-SERVER', info: {computer: 'OFFICE-SERVER', bridges: {b1: {user: 'OFFICE-SERVER\\\\usera', computer: 'OFFICE-SERVER', bridgePort: 9105, tallyPort: 9034, version: '2.5.18', at: now, open: []}},
        beat: {at: now, windowsUser: 'OFFICE-SERVER\\\\usera', computer: 'OFFICE-SERVER', bridgePort: 9105, tallyPort: 9034, ports: [{port: 9034, ok: true}, {port: 9050, ok: true, owner: 'unknown'}, {port: 9000, skipped: true}]}}, main_bridge: 'b1'}];
      navHome('tally'); }""")
    pg.wait_for_timeout(2500)
    who = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-nl-port]')].map((r) => [r.dataset.nlPort, r.querySelector('[data-nl-port-who]').dataset.nlPortWho]))")
    ok(who.get("9034") == "you" and who.get("9050") not in (None, "you"), "a Tally of an owner Windows cannot tell is not 'In use by you' (%s)" % who)
    ctx.close()
    # staff who cannot read the sending setting: "unknown", never "Test mode"
    ctx, pg = page(br, nl=True)
    pg.evaluate(CLOUD, "staff")
    pg.evaluate("""() => { const a = Cloud.api; Cloud.api = async (path, o) => { if (path.split('?')[0] === 'assistant_mail') return []; return a(path, o); }; }""")
    go(pg, "goSettings('mail')", 1500)
    t = pg.locator("[data-nl-mail]").inner_text() if pg.locator("[data-nl-mail]").count() else ""
    ok("Test mode" not in t and "not known" in t.lower(), "staff who cannot read it: not known, never 'Test mode' (%r)" % t)
    ctx.close()

    print("8. a phone")
    ctx, pg = page(br, 390, 844, nl=True, phone=True)
    ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "Bank: no sideways scroll")
    ok(pg.locator("[data-nl-new]").is_visible() and pg.locator("[data-nl-search-open]").is_visible(), "+ New and search in the top bar")
    lay = pg.evaluate("""() => { const h = document.querySelector('header.top').getBoundingClientRect().bottom;
      const els = [...document.querySelectorAll('#app .sbar-band, #app nav.nl-banktabs')].filter((e) => e.offsetParent !== null);
      const top = Math.min(...els.map((e) => e.getBoundingClientRect().top)); const nl = document.querySelector('#app [data-bank-noledger]');
      const nav = document.querySelector('#app nav.nl-banktabs'), sb = document.querySelector('#app .sbar-band');
      return {gap: Math.round(top - h), tabsFirst: !!(nav && sb && nav.getBoundingClientRect().top < sb.getBoundingClientRect().top), sbPad: sb ? parseFloat(getComputedStyle(sb).paddingTop) : 0, cut: nl ? (nl.scrollWidth > nl.clientWidth + 1 || nl.getBoundingClientRect().right > innerWidth + 1) : null}; }""")
    ok(lay["gap"] <= 28 and lay["tabsFirst"] and lay["sbPad"] <= 6, "phone Bank: the Bank tabs first, then the row of states, no empty band above it (%s)" % lay)
    ok(lay["cut"] is False, "phone Bank: the foot bar's words are not cut (%s)" % lay)
    c = pg.evaluate(CLEAR, "#app .bk-space")
    ok(c and c["ok"], "phone Bank lines, scrolled to the end: nothing of the page under the foot bar (%s)" % c)
    pg.evaluate("() => { document.scrollingElement.scrollTop = 0; }"); pg.wait_for_timeout(200)
    shot(pg, "phone-01-bank-lines")
    pg.locator('[data-nl-banktab="stmts"]').click(); pg.wait_for_timeout(1000)
    ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "Statements: no sideways scroll")
    dash = pg.evaluate("""() => { const tds = [...document.querySelectorAll('#app tr.nl-gap > td')]; return tds.slice(1, -1).filter((t) => getComputedStyle(t).borderTopStyle === 'dashed').length; }""")
    ok(dash == 0, "phone Statements: the missing month's card is dashed around, not each of its fields (%d)" % dash)
    c = pg.evaluate(CLEAR, "#app tr.nl-gap [data-nl-gap]")
    ok(c and c["ok"], "phone Statements, scrolled to the end: the missing month's words above the bottom bars (%s)" % c)
    w = pg.evaluate("""() => { const e = document.querySelector('#app tr.nl-gap [data-nl-gap]'); if (!e) return null; const td = e.closest('td'), r = e.getBoundingClientRect(), t = td.getBoundingClientRect();
      return {right: Math.round(r.right), tdRight: Math.round(t.right), vw: innerWidth, over: td.scrollWidth - td.clientWidth}; }""")
    ok(w and w["right"] <= w["tdRight"] + 1 and w["right"] <= w["vw"] and w["over"] <= 1, "phone Statements: the missing month's words shown in full, not cut at the side (%s)" % w)
    # the missing month's card in view: its words wholly above the bottom bars
    v = pg.evaluate("""() => { const e = document.querySelector('#app tr.nl-gap'); e.scrollIntoView({block: 'center'}); return null; }""")
    pg.wait_for_timeout(300)
    c = pg.evaluate(CLEAR.replace("se.scrollTop = se.scrollHeight; ", ""), "#app tr.nl-gap [data-nl-gap]")
    ok(c and c["ok"], "phone Statements, the missing month's card in view: its words above the bottom bars (%s)" % c)
    shot(pg, "phone-02-bank-statements")
    pg.locator("[data-nl-new]").click(); pg.wait_for_timeout(300); shot(pg, "phone-03-new-menu")
    pg.locator('[data-nl-record="Receipt"]').click(); pg.wait_for_timeout(1000); shot(pg, "phone-04-new-receipt")
    go(pg, "S.nlEntry = null; S.nlSearch = {q: 'test', i: 0}; render();", 500); shot(pg, "phone-05-search")
    go(pg, "S.nlSearch = null; navHome('tally');", 2000)
    ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "Tally: no sideways scroll")
    shot(pg, "phone-06-tally")
    go(pg, "goSettings(null)", 1200); shot(pg, "phone-07-settings")
    go(pg, "navHome('today')", 1200); shot(pg, "phone-08-firm-home")
    ctx.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
