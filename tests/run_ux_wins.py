"""python3 tests/run_ux_wins.py [items] - the UI review's findings fixed (next-ux-wins, 13-Nov-2026; the owner is a CA, not
a programmer: plain short English, no dead ends, fast). Made-up data only (the fixture books, run_tally_simple.py's
stand-in cloud, made-up logins). One part for each item; "python3 tests/run_ux_wins.py 3 9" runs only those.

  1. a refusal ("Open a statement first.") has the button that does the next step; a step on the same page has "Show me"
     (the box is focused); a message saying something failed stays until closed, with Close;
  2. Sales: "Connect FinCom Bridge first." and "Tally is not connected." name no menu that is gone, and open the Tally page;
  3. Add client asks "Track returns from which month?" (this month); the client keeps it; Compliance and Today show
     nothing unfiled that fell due before that month; "Start tracking from…" on Compliance sets it for a client already there;
  4. Today: each of the four figures opens its list (one client with such bills: that client at that step);
  5. the Tally page: one name, "Update from Tally" (never "Update now", "Bring ledgers from Tally", "Sync now"); the big
     Download FinCom Bridge only while it is needed; one Check again, one Advanced (for support); no "Up to date" over
     0 ledgers, no "Never" beside entries;
  6. the line over a page's title is not cut to the title's width;
  7. a phone (375 px): Today does not scroll sideways, its totals are labelled, the header is one line;
  8. Purchase › Post to Tally: no red line while nothing waits;
  9. Add client: what is wrong is said under its box (aria-invalid), Esc cancels, a short first line;
 10. dark mode's bell count can be read; each ledger's Change says which ledger; small links are 32 px to tap;
 11. the client-open follow-ups: usageSoon works at once in a hidden tab; the Overview's TDS card comes through
     lazyModule and works its figure out again when an edit TDS.keptIn looks at changes.
Run on the React build (app/dist-test, or TDSDESK_SITE). UX_PORT (8437)."""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UX_PORT") or 8437)
ONLY = set(a for a in sys.argv[1:] if a.isdigit())
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def want(n): return not ONLY or str(n) in ONLY

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
books = json.load(open(CACHE))
TODAY = "2026-11-13"

SEED = """([books, withBooks, name]) => { S.firm.firmName = "Test Firm of Accountants";
  const c = newCompany({name: name || "Test Traders Private Limited", gstin: "07AAGCL4827M1Z3"}); c.tan = "DELT12345A"; S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  if (withBooks) { const b = Object.assign({loading: false, challans: [], alloc: {}}, books, {cid: c.id}); S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books); }
  else S.books = {cid: c.id, loading: false, vouchers: [], ledgers: [], challans: [], alloc: {}, map: {}};
  refreshStats(c.id); Store.saveFirm(); Store.saveCompany(c);
  if (withBooks && typeof saveBooks === "function") saveBooks(); render(); return c.id; }"""
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
TOAST = """() => { const t = document.getElementById('toast'); if (!t || t.classList.contains('hidden') || t.classList.contains('out')) return null;
  const c = t.cloneNode(true); c.querySelectorAll('[data-toast-acts], .toast-details').forEach((e) => e.remove());
  return {words: c.textContent.trim(), acts: [...t.querySelectorAll('[data-toast-act]')].map((b) => b.textContent), tone: t.dataset.tone || ''}; }"""
# the contrast of an element's words on its own background (WCAG)
CONTRAST = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e);
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number), lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor)); return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 100) / 100; }"""

def page(br, w=1440, h=900, scheme="light", with_books=True):
    ctx = br.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text[:300]) if m.type == "error" and "could not be drawn" in m.text else None)
    pg.add_init_script("window.__dueToday = %r;" % TODAY)
    pg.goto(URL); pg.wait_for_timeout(1500); pg.evaluate(READY); pg.wait_for_timeout(600)
    cid = pg.evaluate(SEED, [books, with_books, ""]); pg.wait_for_timeout(1200)
    # (the app's own parts that come a moment after the first page: the messages' next steps among them)
    pg.wait_for_function("() => typeof window.toastNext === 'function'", timeout=15000)
    return ctx, pg, cid

def settle(pg, ms=700):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('[data-loading-page], .react-loading')", timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(200)

def item1(br):
    print("1. a refusal has the button that does the next step; a failure stays until closed")
    ctx, pg, cid = page(br); E = pg.evaluate
    # every "… first" message in the app's source, as written (the plain ones: no words joined in)
    src = ""
    for d in ("src/js", "app/src"):
        for root, _, fs in os.walk(os.path.join(HERE, "..", d)):
            for f in fs:
                if f.endswith((".js", ".jsx")): src += open(os.path.join(root, f), encoding="utf8").read() + "\n"
    msgs = sorted(set(m for m in re.findall(r'toast\("([^"\\]*\bfirst\b[^"\\]*)"\)', src) if not re.search(r"sign(ed)? in", m, re.I)))
    ok(len(msgs) >= 20, "%d plain refusals ending in 'first' found in the source (sign-in ones left out)" % len(msgs))
    # on a client's page (its Overview): the ones that lead to another page each have its button
    E("() => goClient('dash')"); settle(pg)
    GO = {"Open a statement first.": ("Open Bank", "bank"), "Open a bank statement first.": ("Open Bank", "bank"),
          "Choose the Tally ledger for this bank account first.": ("Open Bank settings", "bankset"), "Set the Tally ledger for this bank account first.": ("Open Bank settings", "bankset"),
          "Read the day book first (From Tally).": ("Open From Tally", "import"), "Open the client's books first (From Tally).": ("Open From Tally", "import"),
          "Connect FinCom Bridge first.": ("Open Tally page", "tally"), "Open a company in Tally first.": ("Open Tally page", "tally"),
          "Add a client first, so uploads have somewhere to go.": ("Add client", "clients")}
    for m, (label, where) in GO.items():
        ok(m in msgs or m == "Open a bank statement first.", "   in the source: %r" % m)
        E("() => goClient('dash')"); pg.wait_for_timeout(250)
        E("(m) => toast(m)", m); t = E(TOAST)
        ok(bool(t) and t["acts"] == [label], "   %r has the button %r (%s)" % (m, label, t and t["acts"]))
        if t and t["acts"]:
            pg.click("#toast [data-toast-act]"); settle(pg, 500)
            at = E("() => S.view === 'home' ? S.homeTab : S.tab === 'books' ? S.booksTab : S.tab")
            ok(at == where and E(TOAST) is None, "      and it opens %s (now %s), the message gone" % (where, at))
    # already on Bank (review): never "Open Bank" there; the statement's upload is shown
    E("() => goClient('bank')"); settle(pg); E("() => toast('Open a statement first.')"); t = E(TOAST)
    ok(bool(t) and "Open Bank" not in t["acts"] and t["acts"] in ([], ["Show me"]), "on Bank itself: no 'Open Bank' (%s)" % (t and t["acts"]))
    if t and t["acts"] == ["Show me"]:
        pg.click("#toast [data-toast-act]"); pg.wait_for_timeout(200)
        ok(E("() => !!document.querySelector('[data-show-me]') && /upload|statement/i.test(document.querySelector('[data-show-me]').outerHTML)"), "   Show me marks the statement's upload")
    else: ok(False, "   Show me for the statement's upload on Bank (%s)" % t)
    # a step on the same page: Show me, the box focused; never a button that leads nowhere
    E("() => navHome('clients')"); settle(pg); pg.click("[data-add-client]"); pg.wait_for_selector("#ncName"); pg.evaluate("() => document.activeElement && document.activeElement.blur()")
    E("() => toast('Type the narration first.')"); t = E(TOAST)
    ok(bool(t) and t["acts"] == [], "a step whose box is not on this page: no button that leads nowhere (%s)" % (t and t["acts"]))
    E("() => { const i = document.createElement('input'); i.placeholder = 'Narration for the ticked lines'; i.id = 'uxNarr'; document.getElementById('app').appendChild(i); toast('Type the narration first.'); }")
    t = E(TOAST); ok(bool(t) and t["acts"] == ["Show me"], "a step on this page: Show me (%s)" % (t and t["acts"]))
    if t and t["acts"]:
        pg.click("#toast [data-toast-act]"); pg.wait_for_timeout(200)
        ok(E("() => document.activeElement && document.activeElement.id") == "uxNarr" and E("() => document.getElementById('uxNarr').hasAttribute('data-show-me')"), "   Show me puts the cursor in the box and marks it")
    here = [m for m in msgs if m not in GO]
    dead = []
    for m in here:
        E("(m) => toast(m)", m); t = E(TOAST)
        if not t or any(a not in ("Show me", "Open Tally page", "Open From Tally", "Open Bank", "Open Bank settings", "Open Clients", "Add client", "Close") for a in t["acts"]): dead.append(m)
    ok(not dead, "every other refusal draws, with a known button or none (%d checked) %s" % (len(here), dead[:3]))
    # something failed: it stays until closed (it left after 4-9 s), with Close; a plain message still leaves by itself
    E("() => toast('Could not save the client: the disk is full.')"); pg.wait_for_timeout(10500); t = E(TOAST)
    ok(bool(t) and t["tone"] == "stop" and "Close" in t["acts"], "a message that something failed is still there after 10 s, with Close (%s)" % t)
    pg.hover("#toast"); pg.mouse.move(700, 300); pg.wait_for_timeout(2600)
    ok(E(TOAST) is not None, "   and after the pointer passed over it")
    if t: pg.click("#toast [data-toast-act='Close']"); pg.wait_for_timeout(400)
    ok(E(TOAST) is None, "   Close closes it")
    E("() => toast('Could not read the file.')"); pg.wait_for_timeout(300); E("() => toast('Client saved.')"); t = E(TOAST)
    ok(bool(t) and t["words"] == "Client saved.", "   the next message takes its place")
    pg.wait_for_timeout(6000); ok(E(TOAST) is None, "a plain message still leaves by itself")
    # only a real failure stays (review): not a word somewhere in it, not a hint the caller says fades
    pg.mouse.move(700, 300)   # (off the message: the pointer over it keeps any message, as before)
    E("() => toast('No error found in the books.')"); t = E(TOAST); pg.wait_for_timeout(6500)
    ok(bool(t) and "Close" not in t["acts"] and E(TOAST) is None, "'No error found…' fades as before (%s)" % (t and t["acts"]))
    src2 = open(os.path.join(HERE, "..", "app", "src", "parts", "TallySimple.jsx"), encoding="utf8").read()
    ok('toast("Could not copy; type " + a.free + ".", {sticky: false})' in src2, "the copy fallback is marked as one that fades")
    E("() => toast('Could not copy; type 9000.', {sticky: false})"); t = E(TOAST); pg.wait_for_timeout(6500)
    ok(bool(t) and "Close" not in t["acts"] and E(TOAST) is None, "'Could not copy; type 9000.' fades as before")
    E("() => { window.__u = 0; toast('Failed to post 3 bills.', {actions: [{label: 'Try again', run() { window.__u++; }}]}); }"); t = E(TOAST)
    ok(bool(t) and t["acts"] == ["Close", "Try again"], "a failure with its own button has Close too (%s)" % (t and t["acts"]))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(E(TOAST) is None, "Esc closes a message that stays")
    # the final review: a failed count or "not posted" anywhere stays; the save failure stays; Esc closes only the message
    for m in ["Posted 4 bills to Tally, 2 failed.", "Posted 5; could not post 3.", "1 entry is marked Possible repeat and was not posted."]:
        E("(m) => toast(m)", m); t = E(TOAST); pg.wait_for_timeout(100)
        ok(bool(t) and "Close" in t["acts"] and E("() => document.getElementById('toast').dataset.sticky") == "1", "stays, with Close: %r" % m)
    E("() => toast('Posted 4 bills to Tally.')"); t = E(TOAST); ok(bool(t) and "Close" not in t["acts"], "'Posted 4 bills to Tally.' fades as before")
    leg = open(os.path.join(SITE, "legacy.js"), encoding="utf8").read()
    ok(len(re.findall(r'A change could not be saved[^"]*"\s*,\s*\{sticky:\s*(?:true|!0)\}', leg)) == 2, "'A change could not be saved…' (both) is marked to stay")
    E("() => navHome('clients')"); settle(pg, 500); pg.click("[data-add-client]"); pg.wait_for_selector("#ncName")
    E("() => toast('Could not save the client.')"); pg.focus("#ncName"); pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(E(TOAST) is None and pg.locator("#ncName").count() == 1, "Esc with a message open closes the message only (the form under it stays)")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(pg.locator("#ncName").count() == 0, "   the next Esc closes the form")
    ctx.close()

def item2(br):
    print("2. Sales: the messages name no menu that is gone, and open the Tally page")
    ctx, pg, cid = page(br); E = pg.evaluate
    files = glob_js()
    ok(not re.search(r"Settings (→|\\u2192) FinCom Bridge", files), "no 'Settings → FinCom Bridge' in what the page loads")
    E("() => goClient('sales')"); settle(pg)
    said = E("async () => { TCloud.on = () => false; Bridge.on = () => false; const r = await ensureTallyCompany(CO()); return r; }"); t = E(TOAST)
    ok(said is None and bool(t) and t["words"] == "Connect FinCom Bridge first." and t["acts"] == ["Open Tally page"], "no bridge: %s" % t)
    E("async () => { Bridge.on = () => true; Bridge.up = () => false; Bridge.refresh = async () => {}; await ensureTallyCompany(CO()); }"); t = E(TOAST)
    ok(bool(t) and t["words"] == "Tally is not connected." and t["acts"] == ["Open Tally page"], "Tally not answering: %s" % t)
    if t and t["acts"]:
        pg.click("#toast [data-toast-act]"); settle(pg)
        ok(E("() => S.view === 'home' && S.homeTab === 'tally'"), "   Open Tally page opens the Tally page")
    ctx.close()

def glob_js():
    import glob
    return "".join(open(f, encoding="utf8").read() for f in glob.glob(os.path.join(SITE, "assets", "*.js")) + [os.path.join(SITE, "legacy.js")])

DUE = "async () => { DueList.cache = {}; const r = await DueList.all(); return r.items.map((x) => ({cid: x.cid, st: x.status, due: x.due, what: x.what, per: x.per, pm: x.due.slice(0, 7)})); }"
def item3(br):
    print("3. a new client: 'Track returns from which month?', and nothing earlier is overdue")
    ctx, pg, cid = page(br); E = pg.evaluate
    # the fixture client (books from Apr-2025, added before this change): its old returns show as before
    before = E(DUE); over0 = [x for x in before if x["st"] == "overdue"]
    ok(len(over0) > 20, "a client with no month set: as before (%d overdue)" % len(over0))
    # Add client: the question, this month by default
    E("() => navHome('clients')"); settle(pg); pg.click("[data-add-client]"); pg.wait_for_selector("#ncName")
    lab = pg.inner_text("label:has([data-add-from])")
    ok("Track returns and payments from which month?" in lab and "payments that fell due before it are not shown" in lab and pg.input_value("[data-add-from]") == TODAY[:7], "Add client asks 'Track returns and payments from which month?', this month chosen, and says payments too (%s)" % pg.input_value("[data-add-from]"))
    pg.fill("#ncName", "ZZ Made Up New Client")
    # a month still to come is refused in plain words
    E("() => document.getElementById('ncFrom').removeAttribute('max')"); pg.fill("#ncFrom", "2027-02"); pg.click("text=Add and open"); pg.wait_for_timeout(300)
    fe = pg.inner_text("[data-add-err=from]") if pg.locator("[data-add-err=from]").count() else ""
    ok(fe == "Choose this month or an earlier one." and E("() => !Object.values(S.companies).some((c) => c.name === 'ZZ Made Up New Client')"), "a month still to come is refused: %r, nothing added" % fe)
    pg.fill("#ncFrom", TODAY[:7])
    pg.click("text=Add and open"); settle(pg, 1500)
    new = E("() => { const c = Object.values(S.companies).find((x) => x.name === 'ZZ Made Up New Client'); return c ? {id: c.id, from: c.trackFrom || '', open: S.coId === c.id} : null; }")
    ok(bool(new) and new["from"] == "202611" and new["open"], "the client is added and open, tracked from 202611 (%s)" % new)
    # the same books given to the new client (as its Tally would bring them): nothing of a period before Nov-2026 is due or overdue
    if new:
        E("""([books, id]) => { const b = Object.assign({loading: false, challans: [], alloc: {}}, JSON.parse(JSON.stringify(books)), {cid: id}); const c = S.companies[id]; c.gstin = '07AAACZ9999Z1Z9'; c.tan = 'DELZ12345A';
          S.books = b; b.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(b); saveBooks(); render(); }""", [books, new["id"]]); pg.wait_for_timeout(800)
        items = [x for x in E(DUE) if x["cid"] == new["id"]]
        early = [x for x in items if x["st"] != "filed" and x["pm"] < "2026-11"]
        over = [x for x in items if x["st"] == "overdue"]
        ok(not early and 0 < len(over) < 10 and all(x["due"] >= "2026-11-01" for x in over), "its list: nothing unfiled that fell due before 1-Nov-2026; overdue only what fell due in November (%d items; overdue %s)" % (len(items), [(x["what"], x["due"]) for x in over][:3]))
        ok(any(x["pm"] == "2026-11" and x["st"] == "due" for x in items) and any(x["pm"] > "2026-11" for x in items), "   what falls due in Nov-2026 and after is listed (%s)" % [(x["what"], x["per"]) for x in items][:4])
        E("() => navHome('compliance')"); settle(pg, 1500)
        pg.select_option("[data-due-client]", new["id"]); pg.wait_for_timeout(500)
        n_over = pg.inner_text("[data-due-chip=overdue] .sbar-n")
        ok(n_over == str(len(over)), "Compliance, that client: Overdue %s (those due in November)" % n_over)
        pg.select_option("[data-due-client]", ""); pg.wait_for_timeout(300)
    # "Start tracking from…" for a client already there
    E("() => navHome('compliance')"); settle(pg, 1500); pg.select_option("[data-due-client]", cid); pg.wait_for_timeout(400)
    n0 = int(pg.inner_text("[data-due-chip=overdue] .sbar-n"))
    ok(pg.locator("[data-track-open]").count() == 1 and n0 == len(over0), "Compliance: 'Start tracking from…' under the figures; %d overdue of the older client" % n0)
    pg.click("[data-track-open]"); pg.wait_for_timeout(200)
    ok(E("() => document.activeElement && document.activeElement.hasAttribute('data-track-client')") and "Track returns and payments from which month?" in pg.inner_text("[data-track-from]"), "the panel opens with the cursor in it, the same question")
    E("() => document.activeElement.blur()"); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ok(pg.locator("[data-track-from]").count() == 0 and E("() => document.activeElement && document.activeElement.hasAttribute('data-track-open')"), "Esc closes it (wherever the cursor was) and the cursor is back on its button")
    pg.click("[data-track-open]"); pg.select_option("[data-track-client]", cid)
    E("() => document.querySelector('[data-track-month]').removeAttribute('max')"); pg.fill("[data-track-month]", "2027-01"); pg.click("[data-track-save]"); pg.wait_for_timeout(400)
    te = pg.inner_text("[data-track-err]") if pg.locator("[data-track-err]").count() else ""
    ok(te == "Choose this month or an earlier one." and not E("(id) => S.companies[id].trackFrom", cid), "a month still to come is refused there too (%r)" % te)
    # not saved: it says so, nothing changes, no "tracked from"
    E("() => { window.__put = Store.put; Store.put = function (p) { if (/^companies\\/[^/]+$/.test(p)) { Store.failed = true; return; } return window.__put.apply(this, arguments); }; }")
    pg.fill("[data-track-month]", "2026-10"); pg.click("[data-track-save]"); pg.wait_for_timeout(600)
    te = pg.inner_text("[data-track-err]") if pg.locator("[data-track-err]").count() else ""; t = E(TOAST)
    ok(te.startswith("Not saved") and not E("(id) => S.companies[id].trackFrom", cid) and not (t and "tracked from" in t["words"]), "a save that fails: 'Not saved…', nothing changed, never 'tracked from' (%r)" % te)
    E("() => { Store.put = window.__put; Store.failed = false; }")
    pg.fill("[data-track-month]", "2026-10"); pg.click("[data-track-save]"); settle(pg, 1500); pg.select_option("[data-due-client]", cid); pg.wait_for_timeout(400)
    n1 = int(pg.inner_text("[data-due-chip=overdue] .sbar-n")); co = E("(id) => S.companies[id].trackFrom", cid); t = E(TOAST)
    left = [x for x in E(DUE) if x["cid"] == cid and x["st"] == "overdue"]
    ok(co == "202610" and n1 < n0 and all(x["pm"] >= "2026-10" for x in left) and n1 == len(left), "saved (202610): overdue %d -> %d, all due from 1-Oct-2026 (%s); it says so: %s" % (n0, n1, [(x["what"], x["per"]) for x in left][:3], t and t["words"]))
    E("() => navHome('today')"); settle(pg, 1500)
    line = pg.inner_text("[data-due-line]")
    allover = len([x for x in E(DUE) if x["st"] == "overdue"])
    ok((str(allover) + " return") in line, "Today's line counts the same, every client (%d: %s)" % (allover, line.replace("\n", " ")))
    E("() => navHome('compliance')"); settle(pg, 1200); pg.click("[data-track-open]"); pg.select_option("[data-track-client]", cid)
    ok(pg.input_value("[data-track-month]") == "2026-10" and pg.locator("[data-track-clear]").count() == 1, "opened again: the month kept, and 'Track every period'")
    pg.click("[data-track-clear]"); settle(pg, 1500); pg.select_option("[data-due-client]", cid); pg.wait_for_timeout(400)
    ok(int(pg.inner_text("[data-due-chip=overdue] .sbar-n")) == n0, "Track every period: the %d overdue are back" % n0)
    tc = open(os.path.join(HERE, "..", "app", "src", "parts", "TallyCompanies.jsx"), encoding="utf8").read()
    ok("co.trackFrom = String(DueList.today()).slice(0, 7).replace(\"-\", \"\")" in tc, "a client added from the Tally page is tracked from this month too")
    ctx.close()

def item4(br):
    print("4. Today: each figure opens its list")
    ctx, pg, cid = page(br); E = pg.evaluate
    E("""() => { for (const [n, st] of [['ZZ Alpha Made Up', {drafts: 4, waiting: 0, check: 1}], ['ZZ Beta Made Up', {drafts: 2, waiting: 3, check: 0}]]) { const c = newCompany({name: n}); c.stats = st; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; }
      window.refreshStats = () => {}; navHome('today'); }"""); settle(pg)
    cards = pg.locator(".today .metrics button.metric")
    ok(cards.count() == 4, "four figures, each a button")
    for label, col, n in [("To review", "drafts", 2), ("Needs you", "check", 1), ("Ready to post", "waiting", 1)]:
        E("() => navHome('today')"); settle(pg, 400)
        pg.locator(".today .metrics button.metric", has_text=label).click(); settle(pg, 900)
        st = E("() => ({view: S.view, tab: S.view === 'home' ? S.homeTab : S.tab, step: S.step, co: (CO() || {}).name || '', sort: (S.listSort || {}).clients || null})")
        if n > 1:
            first = pg.locator("table.lt tbody tr").first.inner_text() if pg.locator("table.lt tbody tr").count() else ""
            ok(st["view"] == "home" and st["tab"] == "clients" and st["sort"] == {"k": col, "dir": "desc"} and "ZZ Alpha" in first, "%s (two clients have some): the Clients list, the most first (%s | %s)" % (label, st["sort"], first[:40].replace("\n", " ")))
        else:
            ok(st["view"] == "company" and st["co"].startswith("ZZ "), "%s (one client has some): that client is opened (%s, %s)" % (label, st["co"], st["tab"]))
    E("() => { S.listSort = Object.assign({}, S.listSort, {clients: {k: 'name', dir: 'asc'}}); navHome('today'); }"); settle(pg, 400)
    pg.locator(".today .metrics button.metric", has_text="To review").click(); settle(pg, 700)
    ok(E("() => S.homeTab === 'clients' && JSON.stringify(S.listSort.clients)") == '{"k":"name","dir":"asc"}', "an order the person chose on Clients is kept")
    E("() => navHome('today')"); settle(pg, 400); pg.locator(".today .metrics button.metric", has_text="To read").click(); settle(pg, 600)
    ok(E("() => S.view === 'home' && S.homeTab === 'inbox'"), "To read opens the Inbox, as before")
    ctx.close()

PC = "SRV01"; UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
ORBIT, ACME, ORBIT_CO, KESTREL = "Orbit Space", "Acme Traders", "ORBIT SPACE", "Kestrel Worldwide Private Limited"
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
def tally_page(br, w=1440, h=900, dsf=1):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=dsf)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
    pg.goto(URL); pg.wait_for_timeout(2000); pg.evaluate(READY); pg.wait_for_timeout(800); pg.set_default_timeout(8000)
    return ctx, pg
def tally_scene(pg, which):
    E = pg.evaluate
    def bdev():
        d = T.dev(8, PC, "made-up-b", tally="open", opened=(KESTREL,), version="2.5.4", rec=(KESTREL,), beat={"bridgePort": 9150, "windowsUser": UB, "tallyPort": 9070},
                  ports=[{"port": 9070, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        d["info"]["bridges"]["go-8"]["tallyPort"] = 9070; return d
    ver = "2.5.3" if which == "older" else "2.5.4"
    def adev(ports, opened=()):
        return T.dev(7, PC, "made-up-a", tally="open", opened=opened, version=ver, rec=opened, beat={"bridgePort": 9101, "windowsUser": UA, "tallyWhy": "", "tallyConnectSay": ""}, ports=ports)
    cos = [{"company": KESTREL, "client_id": None, "device_id": "d0000000-0000-4000-8000-000000000008", "gstin": "", "last_seen": "ago:0.5"}]
    up = {"port": 9041, "ok": True, "skipped": False, "n": 0, "error": "", "reason": "open"}
    if which == "step1": devs, c, pings = [adev([]), bdev()], cos, {"9150": TS.ping(9150, False, UB, version="2.5.4")}
    else:
        dA = adev([up], opened=(ORBIT_CO,)); devs = [dA, bdev()]
        c = cos + [{"company": ORBIT_CO, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        pings = {"9101": TS.ping(9101, True, UA, version=ver, bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
    ids = E(T.SETUP, [devs, c, [], "owner", [ORBIT, ACME], True, {}])
    E("() => { window.__linksApi = false; }"); E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, pings); E(TS.FORGET)
    E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
    E(TS.MINE, ["", "", ""]); E("() => { S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
    pg.wait_for_timeout(3500)
    return ids

def item5(br):
    print("5. the Tally page: one name for the pull, one Download while needed, no duplicate buttons, no contradictions")
    # the words in the program: the old names of the one action are gone from what a person reads
    src = ""
    for d in ("src/js", "app/src"):
        for root, _, fs in os.walk(os.path.join(HERE, "..", d)):
            for f in fs:
                if f.endswith((".js", ".jsx")): src += "\n".join(l for l in open(os.path.join(root, f), encoding="utf8").read().split("\n") if not l.strip().startswith(("//", "*", "/*", "{/*"))) + "\n"
    old = [w for w in ("Update now", "Bring ledgers from Tally", "Refresh from Tally") if re.search(r'["“>]' + w + r'|' + w + r'["”<.]', src)]
    ok(not old and src.count("Update from Tally") >= 15, "one name, 'Update from Tally' (%d places); the old names gone %s" % (src.count("Update from Tally"), old))
    ok(not re.search(r'data-tco-sync-now[^>]*>[^<]*Sync now|"Sync now"\}</button>', src.replace('"Syncing…" : "Sync now"}</Act>', "")), "a company's row says Update from Tally, not Sync now")
    ctx, pg = tally_page(br); E = pg.evaluate; n = lambda s: pg.locator(s).count()
    vis = lambda s: pg.locator(s).count() > 0 and pg.locator(s).first.is_visible()
    # step 1 (no bridge in this login): ONE Download (the step's), one Check again
    tally_scene(pg, "step1")
    dls = E("() => [...document.querySelectorAll('#app a[download], #app [data-bridge-download]')].filter((e) => e.offsetParent).map((e) => e.textContent.trim())")
    ok(pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") == "1" and len(dls) == 1, "step 1: one Download on the page (%s)" % dls)
    ok(len(E("() => [...document.querySelectorAll('#app button')].filter((b) => b.offsetParent && /^Check again$/.test(b.textContent.trim())).map((b) => b.textContent)")) <= 2 and n("#app [data-tsm-recheck]") == 0,
       "   the steps card has no second Check again link beside the top card's")
    ok("button above" not in pg.inner_text("#app"), "   no 'use the button above'")
    # connected, a client linked and being read
    tally_scene(pg, "connected")
    ok(pg.get_attribute("#app [data-tsm-top]", "data-tsm-top") == "up" and n("#app [data-tpg-download]") == 1 and not vis("#app [data-tpg-download]"), "connected: the big Download FinCom Bridge is not shown")
    adv = E("() => [...document.querySelectorAll('#app button')].filter((b) => b.offsetParent && /Advanced \\(for support\\)/.test(b.textContent)).length")
    ok(adv == 1, "one 'Advanced (for support)' (%d)" % adv)
    pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(900)
    ok(vis("#app [data-for-support] [data-tsm-download], #app [data-for-support] [data-bridge-download]"), "   the Download is under Advanced (for support)")
    pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(300)
    pg.click("#app [data-tsm-steps-link]"); pg.wait_for_timeout(700)
    ok(n("#app [data-tsm-guide] [data-tsm-step='1'][data-done]") == 1 and n("#app [data-tsm-guide] [data-tsm-step='1'] a[download]") == 0, "the six steps opened: step 1 done has no Download under it")
    say = pg.inner_text("#app [data-tsm-now]") if n("#app [data-tsm-now]") else ""
    row = "#app tr[data-tsm-row='%s']" % ORBIT
    btn = pg.inner_text(row + " .tpt-act-in button >> nth=0") if n(row) else ""
    ok("Bring ledgers" not in say and ("Update from Tally" in say or "Update from Tally" not in btn), "step 6 names the button the row has (%s | row button: %s)" % (say[:110], btn))
    words = pg.inner_text("#app [data-tsm-table]") if n("#app [data-tsm-table]") else pg.inner_text("#app")
    ok("Update now" not in pg.inner_text("#app") and "Bring ledgers" not in pg.inner_text("#app"), "no 'Update now' or 'Bring ledgers' on the page")
    # the row's cells do not contradict each other
    cells = E("""(row) => { const r = document.querySelector(row); if (!r) return null; const t = (s) => { const e = r.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; };
      return {m: t('.tpt-masters'), e: t('.tpt-entries'), last: t('.tpt-last'), st: r.querySelector('[data-tpg-masters]') ? r.querySelector('[data-tpg-masters]').getAttribute('data-tpg-masters') : ''}; }""", row)
    ok(bool(cells) and not ("Up to date" in cells["m"] and re.search(r"\b0 ledgers", cells["m"])), "Masters: never 'Up to date' over 0 ledgers (%s)" % (cells and cells["m"]))
    ok(bool(cells) and not (cells["last"] == "Never" and re.search(r"Up to|Up to date|in FinCom", cells["e"])), "Last entry: never 'Never' beside entries in FinCom (%s | %s)" % (cells and cells["e"], cells and cells["last"]))
    # the two cells' own rules, with what FinCom holds given
    # an older bridge running (review): "Download it to update" has its Download right there, and the big one shows
    tally_scene(pg, "older"); pg.click("#app [data-tsm-steps-link]"); pg.wait_for_timeout(700)
    s1 = pg.inner_text("#app [data-tsm-guide] [data-tsm-step='1']") if n("#app [data-tsm-guide] [data-tsm-step='1']") else ""
    ok("Download it to update" in s1 and n("#app [data-tsm-guide] [data-tsm-step='1'] a[download]") == 1 and vis("#app [data-tpg-download]"), "an older bridge (2.5.3, 2.5.4 ready): step 1 has a Download, and the page's Download shows (%s)" % s1.replace("\n", " ")[:120])
    ts = open(os.path.join(HERE, "..", "app", "src", "parts", "TallySimple.jsx"), encoding="utf8").read()
    ok('now.hook === "checking") btn = download' in ts and "in step 1 above" not in src, "step 1 keeps a Download while FinCom is still looking; no 'in step 1 above'")
    tally_scene(pg, "connected")
    h = E("(row) => { const e = document.querySelector(row + ' .tpt-st'); return e ? Math.round(e.getBoundingClientRect().height) : 0; }", row)
    ok(0 < h <= 110, "the State cell is short (%d px high)" % h)
    ctx.close()

def item6(br):
    print("6. the line over the title is not cut to the title's width")
    ctx, pg, cid = page(br); E = pg.evaluate
    CUT = """() => { const out = {}; const n = document.querySelector('header.top .tbar-title > .note, header.top .tbar-title .crumbs'); if (!n) return null;
      const kids = n.querySelectorAll('[data-crumb-page], [data-crumb-clients]'); out.kids = [...kids].map((e) => [e.textContent, e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= n.getBoundingClientRect().right + 1]);
      out.cut = n.scrollWidth > n.clientWidth + 1; out.text = n.innerText.replace(/\\s+/g, ' '); const h = document.querySelector('header.top .tbar-title h2'); out.h2 = h.scrollWidth <= h.clientWidth + 1;
      out.w = Math.round(n.getBoundingClientRect().width); out.title = Math.round(h.getBoundingClientRect().width);
      const a = document.querySelector('header.top .topright'); out.clear = !a || n.getBoundingClientRect().right <= a.getBoundingClientRect().left + 1; return out; }"""
    for label, js in [("Today", "navHome('today')"), ("Compliance", "navHome('compliance')"), ("Purchase", "goClient('bills')"), ("Overview", "goClient('dash')"), ("Bank", "goClient('bank')")]:
        E("() => { %s; }" % js); settle(pg)
        c = E(CUT)
        ok(bool(c) and not c["cut"] and c["h2"] and c["clear"] and all(k[1] for k in c["kids"]), "%s: the line in full: %r (%d px over a %d px title), clear of the buttons" % (label, c and c["text"], c["w"] if c else 0, c["title"] if c else 0))
    # a very long client name: only the name is cut, the page's name stays
    E("() => { CO().name = 'Test Traders And Exporters Of Fine Made Up Goods Private Limited (Delhi Branch Two)'; goClient('bills'); }"); settle(pg)
    c = E(CUT); co = E("() => { const e = document.querySelector('header.top .crumb-co'); return e.scrollWidth > e.clientWidth; }")
    ok(bool(c) and all(k[1] for k in c["kids"]) and co and c["clear"], "a very long client name: only the name is cut (%s)" % (c and c["kids"]))
    ctx.close()

def item7(br):
    print("7. a phone (375 px): Today fits, its totals are labelled, the header is one line")
    ctx, pg, cid = page(br, 375, 812); E = pg.evaluate
    for label, js in [("Today", "navHome('today')"), ("Compliance", "navHome('compliance')"), ("Clients", "navHome('clients')"), ("Overview", "goClient('dash')"), ("Purchase", "goClient('bills')")]:
        E("() => { %s; }" % js); settle(pg)
        m = E("() => ({sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, head: Math.round(document.querySelector('header.top').getBoundingClientRect().height)})")
        ok(m["sw"] <= m["vw"] + 1, "%s does not scroll sideways (%d of %d px)" % (label, m["sw"], m["vw"]))
        ok(m["head"] <= (112 if label == "Purchase" else 84 if label == "Overview" else 72), "   its header is %d px high (was 124; 159 with a page's own buttons)" % m["head"])
    E("() => navHome('today')"); settle(pg)
    g = E("() => { const e = document.querySelector('.today .today-gstin'); const r = e.getBoundingClientRect(); return {right: Math.round(r.right), text: e.textContent}; }")
    ok(g["right"] <= 375, "the client's GSTIN is inside the screen (%s ends at %d px)" % (g["text"], g["right"]))
    foot = E("() => [...document.querySelectorAll('.today table.lt tfoot td')].map((td) => getComputedStyle(td, '::before').content.replace(/\"/g, '') + ' ' + td.innerText.trim())")
    ok([f.split(" ")[0] for f in foot][:2] == ["Total", "To"] and any(f.startswith("Ready to post") for f in foot) and any(f.startswith("Needs you") for f in foot), "the totals say what each figure is (%s)" % foot)
    hd = E("""() => { const q = (s) => document.querySelector(s), r = (e) => e ? e.getBoundingClientRect() : null; const t = r(q('header.top .tbar-title h2')), b = r(q('header.top [data-back-page]')), bell = r(q('header.top .tb-bell')), firm = r(q('header.top .firmbtn'));
      return {sameRow: !!t && !!bell && Math.abs((t.top + t.bottom) / 2 - (bell.top + bell.bottom) / 2) < 16, back: b ? Math.round(b.width) : 0, backTap: b ? Math.round(b.height) : 0, firm: firm ? Math.round(firm.width) : 0,
        title: q('header.top .tbar-title h2').scrollWidth <= q('header.top .tbar-title h2').clientWidth + 1, firmName: q('header.top .firmbtn') ? (q('header.top .firmbtn').getAttribute('title') || '') : ''}; }""")
    ok(hd["sameRow"] and hd["title"] and 0 < hd["back"] <= 44 and hd["backTap"] >= 32 and 0 < hd["firm"] <= 44 and "Test Firm" in hd["firmName"], "the title, Back, the signs and the firm in one line; the title in full (%s)" % hd)
    pg.click("header.top [data-back-page]") if pg.locator("header.top [data-back-page]").count() else None
    ctx.close()

def item8(br):
    print("8. Purchase › Post to Tally: no red line while nothing waits")
    ctx, pg, cid = page(br); E = pg.evaluate
    E("() => { S.postTried = S.coId; goClient('post'); }"); settle(pg, 1200)
    a = E("() => { const e = document.querySelector('#app [data-post-problem]'); return e ? {cls: e.className, text: e.innerText.slice(0, 90), bg: getComputedStyle(e).backgroundColor, bad: getComputedStyle(document.documentElement).getPropertyValue('--bad-soft')} : null; }")
    ok(a is None or ("bad" not in a["cls"].split() and "calm" in a["cls"].split()), "nothing to post: the line is calm, not red (%s)" % a)
    # a bill waiting: red as before
    made = E("""() => { const e = Object.values(D().entries)[0]; return !!e; }""")
    E("""() => { const P = window.postBills; window.postBills = (id) => { const r = P(id); return Object.assign({}, r, {ready: [{id: 'zz1', x: {}}]}); }; render(); }"""); pg.wait_for_timeout(500)
    b = E("() => { const e = document.querySelector('#app [data-post-problem]'); return e ? e.className : null; }")
    ok(a is None or (b and "bad" in b.split()), "a bill waiting: the line is red as before (%s)" % b)
    ctx.close()

def item9(br):
    print("9. Add client: the error under its box, Esc cancels, a short first line")
    ctx, pg, cid = page(br); E = pg.evaluate
    E("() => navHome('clients')"); settle(pg); pg.click("[data-add-client]"); pg.wait_for_selector("#ncName")
    ok(E("() => document.activeElement && document.activeElement.id") == "ncName", "the cursor starts in Client name")
    intro = pg.inner_text("[data-add-from-tally]").strip()
    ok(len(intro.split()) <= 14 and "Link to client" not in intro and pg.locator("[data-add-tally-go]").count() == 1, "the first line is short (%d words): %s" % (len(intro.split()), intro))
    pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    e = E("() => { const i = document.getElementById('ncName'), m = document.querySelector('[data-add-err=name]'); return {inv: i.getAttribute('aria-invalid'), by: i.getAttribute('aria-describedby'), id: m && m.id, text: m ? m.textContent : '', role: m && m.getAttribute('role'), under: !!m && m.getBoundingClientRect().top >= i.getBoundingClientRect().bottom - 1 && m.getBoundingClientRect().top - i.getBoundingClientRect().bottom < 12, focus: document.activeElement === i}; }")
    ok(e["inv"] == "true" and e["text"] == "Enter the client name." and e["by"] == e["id"] and e["role"] == "alert" and e["under"] and e["focus"], "Enter with no name: said under the box, the box marked and focused (%s)" % e)
    ok(E(TOAST) is None, "   and no message in the corner")
    pg.fill("#ncName", "ZZ Typed"); pg.wait_for_timeout(150)
    ok(pg.locator("[data-add-err=name]").count() == 0 and pg.get_attribute("#ncName", "aria-invalid") is None, "typing clears it")
    pg.fill("#ncGstin", "07AAGCL4827M1Z9"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    g = pg.inner_text("[data-add-err=gstin]") if pg.locator("[data-add-err=gstin]").count() else ""
    ok("GSTIN" in g and pg.get_attribute("#ncGstin", "aria-invalid") == "true" and E("() => !Object.values(S.companies).some((c) => c.name === 'ZZ Typed')"), "a GSTIN that fails its check: said under GSTIN, nothing added (%s)" % g)
    pg.focus("#ncName"); pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(pg.locator("#ncName").count() == 0 and E("() => S.addingCo === false && S.view === 'home' && S.homeTab === 'clients'") and pg.locator("[data-add-client]").count() == 1, "Esc closes the form, as Cancel does (still on Clients)")
    # on a phone: the same
    ctx.close(); ctx, pg, cid = page(br, 375, 812); E = pg.evaluate
    E("() => navHome('clients')"); settle(pg); pg.click("[data-add-client]"); pg.wait_for_selector("#ncName"); pg.click("text=Add and open"); pg.wait_for_timeout(300)
    m = E("() => { const m = document.querySelector('[data-add-err=name]'); return m ? Math.round(m.getBoundingClientRect().right) : -1; }")
    ok(0 < m <= 375 and E("() => document.documentElement.scrollWidth <= 376"), "a phone: the error under the box, inside the screen")
    ctx.close()

def item10(br):
    print("10. small ones: the bell's count in dark mode, the Change buttons' names, tap sizes, the app's own dialog")
    ctx, pg, cid = page(br, scheme="dark"); E = pg.evaluate
    E("() => { S.quiet = {text: 'A made-up note', at: Date.now()}; navHome('today'); }"); settle(pg)
    if not pg.locator(".bell-n").count(): E("() => { const b = document.querySelector('header.top .bell, header.top [data-bell]'); const s = document.createElement('span'); s.className = 'bell-n'; s.textContent = '1'; (b || document.body).appendChild(s); }")
    c = E(CONTRAST, ".bell-n")
    ok(c is not None and c >= 4.5, "dark mode: the bell's count is %s:1 (was 2.56)" % c)
    ctx.close(); ctx, pg, cid = page(br); E = pg.evaluate
    c2 = E("() => { if (!document.querySelector('.bell-n')) { const s = document.createElement('span'); s.className = 'bell-n'; s.textContent = '1'; document.body.appendChild(s); } return 1; }") and E(CONTRAST, ".bell-n")
    ok(c2 is not None and c2 >= 4.5, "light mode: still %s:1" % c2)
    E("() => goClient('books:ledgers')"); settle(pg, 1500)
    ch = E("() => [...document.querySelectorAll('#app [data-led-change]')].map((b) => [b.getAttribute('aria-label') || '', b.getAttribute('data-led-change'), Math.round(b.getBoundingClientRect().height)])")
    ok(len(ch) > 5 and all(a == "Change " + nme and a != "Change " for a, nme, _ in ch) and len(set(a for a, _, _ in ch)) == len(set(nme for _, nme, _ in ch)), "%d Change buttons, each named for its ledger (%s)" % (len(ch), ch[0][0] if ch else ""))
    ok(all(h >= 32 for _, _, h in ch), "   each at least 32 px high to tap (%s)" % sorted(set(h for _, _, h in ch))[:3])
    E("() => goClient('bills')"); settle(pg)
    tap = E("""() => [...document.querySelectorAll('#cobar .crumbs .linkbtn')].map((b) => { const r = b.getBoundingClientRect(); const hit = (y) => { const e = document.elementFromPoint(r.left + r.width / 2, y); return !!e && (e === b || b.contains(e)); };
      let top = r.top, bot = r.bottom; while (top > r.top - 20 && hit(top - 1)) top--; while (bot < r.bottom + 20 && hit(bot + 1)) bot++; return [b.textContent.trim().slice(0, 12), Math.round(bot - top), Math.round(r.height)]; })""")
    ok(len(tap) >= 2 and all(t[1] >= 32 for t in tap), "the breadcrumb's links take a tap 32 px high (the line itself as before: %s)" % tap)
    E("() => navHome('compliance')"); settle(pg, 1500)
    due = E("() => [...document.querySelectorAll('#app [data-due-open]')].slice(0, 20).map((b) => Math.round(b.getBoundingClientRect().height))")
    ok(len(due) > 0 and min(due) >= 32, "Compliance: a return's link is %s px high" % (min(due) if due else 0))
    src = open(os.path.join(HERE, "..", "app", "src", "screens", "corp", "Aoc4.jsx"), encoding="utf8").read()
    ok("window.confirm(" not in src and "askConfirm({ title: \"Use the new file?\"" in src, "AOC-4's 'a new file' question is the app's own dialog, not the browser's")
    ctx.close()

def item11(br):
    print("11. the client-open follow-ups")
    ctx, pg, cid = page(br); E = pg.evaluate
    r = E("""async () => { const b = S.books; let timers = 0; const st = window.setTimeout; Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
      window.setTimeout = function () { timers++; return st.apply(this, arguments); };
      let u; try { u = await usageSoon(b); } finally { window.setTimeout = st; delete document.hidden; }
      const v = await usageSoon(b); return {hidden: u, timers, shown: !!v && typeof v === 'object' && Object.keys(v).length > 0}; }""")
    ok(r["hidden"] == 0 and r["timers"] == 0 and r["shown"], "usageSoon in a hidden tab: 0 at once, no timer waited for (worked out at once by the opening); shown: in steps as before (%s)" % r)
    src = open(os.path.join(HERE, "..", "app", "src", "screens", "Dash.jsx"), encoding="utf8").read()
    ok("lazyModule(() => import(\"../parts/DashTds.jsx\"))" in src and "lazy(() =>" not in src, "the Overview's TDS card comes through lazyModule (asked for once more when its file does not come)")
    E("() => { goClient('dash'); }"); settle(pg, 900)
    if pg.locator("details.dash-more, [data-dash-more]").count(): E("() => { const d = document.querySelector('details.dash-more, [data-dash-more]'); if (d && 'open' in d) d.open = true; }")
    settle(pg, 900)
    card = lambda: E("() => { const c = [...document.querySelectorAll('#app .dash-card')].find((e) => /^TDS /.test(e.innerText)); return c ? c.innerText.replace(/\\s+/g, ' ') : ''; }")
    c0 = card()
    ok("In the books (Tally)" in c0 and "Working out" not in c0, "the TDS card shows the books' figure (%s)" % c0[:120])
    n = E("""async () => { let calls = 0; const a = TDS.allRowsIn; TDS.allRowsIn = function* () { calls++; return yield* a.apply(this, arguments); };
      render(); await new Promise((r) => setTimeout(r, 600)); const same = calls;
      S.books.tdsAdded = Object.assign({}, S.books.tdsAdded || {}, {zz: 1}); render(); await new Promise((r) => setTimeout(r, 900)); const edit = calls - same;
      S.books.tdsEdits = {zz: {x: 1}}; render(); await new Promise((r) => setTimeout(r, 900)); const edit2 = calls - same - edit;
      render(); await new Promise((r) => setTimeout(r, 500)); const again = calls - same - edit - edit2; TDS.allRowsIn = a; delete S.books.tdsAdded.zz; delete S.books.tdsEdits; return {same, edit, edit2, again}; }""")
    ok(n["same"] == 0 and n["edit"] >= 1 and n["edit2"] >= 1 and n["again"] == 0, "the figure is kept while nothing changed, and worked out again when an edit TDS.keptIn compares changes (tdsAdded, tdsEdits) (%s)" % n)
    ctx.close()

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for i, fn in enumerate([item1, item2, item3, item4, item5, item6, item7, item8, item9, item10, item11], 1):
            if not want(i): continue
            try: fn(br)
            except Exception as e: ok(False, "item %d could not be checked: %s" % (i, str(e)[:400]))
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to fetch" not in e]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
