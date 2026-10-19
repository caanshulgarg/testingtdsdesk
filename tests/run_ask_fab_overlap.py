"""python3 run_ask_fab_overlap.py - the Ask FinCom launcher never sits over something to press.
The owner's report of 17-Oct-2026: "while in purchase field.. ask fincom is coming in approving.. I believe same thing is
happening everywhere": the launcher (fixed at the bottom right, parts/AssistantLauncher.jsx) covered Approve and Next bill
on the bar under an open bill, "Approve all that are ready" on the review table's bar, and the like on other pages.
Visited at 1366x768, 1440x900 and 390x844 (a phone): every page of the sidebar (the firm's and a client's), each at the
top and scrolled to the bottom, and the states with their own buttons at the foot or the right: the review table's bar,
a bill open in the drawer, bills ticked, Bank with statement lines, Client setup with an unsaved change (its sticky Save
bar), a confirm box, a toast with buttons, the "A new version of FinCom is ready · Reload" bar, and a long review banner.
Fails if the launcher's box meets any visible button, link or box to type in, or if what is at the centre of a primary
action (or a bar's button) is the launcher. Also: the launcher is still there on a plain page, and Ctrl+J still opens the
panel while it is put away (a drawer open). Screenshots in tests/out/ask-fab/.
Round 89 (19-Oct-2026): a TDS return's Deductions (the challan's footer of figures), Challans and Deductees: the launcher
sits above the footer, never over a figure; F12 typed in the Ask FinCom box does not switch the return's step (round 94:
the step tabs are across the top and there are no step keys at all).
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_ask_fab_overlap.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "ask-fab"); os.makedirs(OUT, exist_ok=True)
PORT = 8392
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# signed in to the firm account (stood in, no network), the assistant on; a client with three bills to review, two
# approved (Post to Tally), and a bank statement
SETUP = """() => {
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  Cloud.api = async () => []; try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  for (let i = 1; i <= 30; i++){ const o = newCompany({name: "ZZ TEST Client " + String(i).padStart(2, "0")}); S.companies[o.id] = o; }
  const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); c.tan = "DELZ12345A"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id;
  const mk = (n, pan, no, d, amt) => { const e = newEntry("Manual entry"); Object.assign(e.x, {vendorName: n, vendorPan: pan, invoiceNo: no, invoiceDate: d, taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; return e; };
  mk("Alpha Consultants", "AAAPA1234A", "A/1", "2026-09-02", 100000); mk("Beta Traders", "", "B/7", "2026-09-05", 5000); mk("Gamma Rentals", "AAAFG5678B", "G/3", "2026-09-08", 60000);
  [["Delta Advisors", "AAAPD1234D", "D/2", "2026-08-02", 40000], ["Epsilon Legal", "AAAPE1234E", "E/9", "2026-08-12", 25000]].forEach((b) => { try { approve(mk.apply(null, b)); } catch (e) {} });
  window.__cid = c.id;
  return c.id;
}"""
BANK = """() => { const b = {cid: S.coId, stmts: [{id: 's1', acctId: 'a1', bank: 'HDFC', from: '2026-04-01', to: '2026-09-30'}], cur: 's1', filter: 'ready', sel: new Set(), keys: {}, books: {}, rules: [], wrules: [], newLed: [],
    ledgers: {list: [{name: 'HDFC BANK', group: 'Bank Accounts'}, {name: 'Rent', group: 'Indirect Expenses'}], importedAt: new Date().toISOString(), live: true}, q: '', limit: 100, loading: false, grouped: false, showSettings: false,
    pendingRule: null, busy: '', createFor: null, sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: [],
    rows: Array.from({length: 24}, (_, i) => ({id: 's1-' + i, fp: 'f' + i, date: '2026-04-' + String(i + 1).padStart(2, '0'), debit: 1000 + i, credit: 0, bal: 0, narr: 'NEFT payment ' + i, dec: {}, ledger: 'Rent', state: 'ready', balOk: true, why: []}))};
  CO().bankAccounts = [{id: 'a1', bank: 'HDFC', ledger: 'HDFC BANK'}]; S.bank = b; S.view = 'company'; S.tab = 'bank'; render(); }"""

# the launcher's box against everything that can be pressed; and what is at the centre of each primary action
GEOM = r"""() => {
  const L = document.querySelector('[data-asst-launch]');
  const cs = L && getComputedStyle(L), lr = L && L.getBoundingClientRect();
  const shown = !!(L && lr.width > 0 && lr.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05);
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [contenteditable=true]';
  const name = (el) => ((el.getAttribute('aria-label') || el.textContent || el.value || el.getAttribute('placeholder') || el.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const topNotL = (x, y) => document.elementsFromPoint(x, y).find((el) => !(L && L.contains(el)));
  // seen: the part of it inside the window, and at that part's centre (the launcher left out) it is what is on top
  const seen = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null;
    const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const t = topNotL((x0 + x1) / 2, (y0 + y1) / 2); return t && (el === t || el.contains(t)) ? r : null; };
  const hits = [], covered = [];
  document.querySelectorAll(SEL).forEach((el) => { if (L && L.contains(el)) return; const r = seen(el); if (!r || !shown) return;
    if (r.left < lr.right && r.right > lr.left && r.top < lr.bottom && r.bottom > lr.top) hits.push(name(el)); });
  // round 89: the TDS return's footer (the challan's figures: Used here, Balance, Number of deductions) is taken as a
  // whole: the launcher stands above it, never over the bar
  document.querySelectorAll('.wd-foot').forEach((el) => { const r = seen(el); if (!r || !shown) return;
    if (r.left < lr.right && r.right > lr.left && r.top < lr.bottom && r.bottom > lr.top) hits.push('footer: ' + (el.className + '').split(' ')[0]); });
  const PRIM = '.btn.primary, .actionbar button, .cfm-foot button, [data-new-version-go], .toast-act, #confirmBox [data-cbx], .drawer button';
  document.querySelectorAll(PRIM).forEach((el) => { const r = seen(el); if (!r) return;
    const x = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2, y = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2, at = document.elementFromPoint(x, y);
    if (!(at && (el === at || el.contains(at)))) covered.push(name(el)); });
  return {shown, box: shown ? [lr.left, lr.top, lr.right, lr.bottom].map(Math.round) : null, hits: [...new Set(hits)], covered: [...new Set(covered)], place: L ? L.getAttribute('data-asst-place') || '' : 'none'};
}"""
TO_BOTTOM = """() => { window.scrollTo(0, document.documentElement.scrollHeight);
  document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; }); }"""
TO_TOP = """() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }); }"""
SIZES = [("1366", 1366, 768), ("1440", 1440, 900), ("phone", 390, 844)]
DESK = {"width": 1440, "height": 900}
shot_n = [0]
seen_pages = []

def check(pg, label, size, bottom=True, shots=False):
    g = pg.evaluate(GEOM)
    bad = g["hits"] or g["covered"]
    ok(not bad, "%s @%s: the launcher (%s, %s) covers nothing%s" % (label, size, g["place"] or "-", g["box"], "" if not bad else " - meets %s; at the centre of %s is the launcher" % (g["hits"], g["covered"])))
    slug = "".join(ch if ch.isalnum() else "-" for ch in label.lower()).strip("-")
    if shots or bad: pg.screenshot(path=os.path.join(OUT, "%s-%s.png" % (slug, size)))
    if bottom:
        pg.evaluate(TO_BOTTOM); pg.wait_for_timeout(450)
        g2 = pg.evaluate(GEOM); bad2 = g2["hits"] or g2["covered"]
        ok(not bad2, "%s @%s scrolled to the bottom: the launcher (%s, %s) covers nothing%s" % (label, size, g2["place"] or "-", g2["box"], "" if not bad2 else " - meets %s; at the centre of %s is the launcher" % (g2["hits"], g2["covered"])))
        if bad2: pg.screenshot(path=os.path.join(OUT, "%s-%s-bottom.png" % (slug, size)))
        pg.evaluate(TO_TOP); pg.wait_for_timeout(200)
    seen_pages.append((label, size, bool(bad)))
    return g

def each_size(pg, label, prep=None, bottom=True, shots=False):
    """prep() puts the page in the state at desktop width; it is then looked at in each size"""
    for name, w, h in SIZES:
        pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(150)
        if prep: prep(); pg.wait_for_timeout(700)
        else: pg.evaluate("window.dispatchEvent(new Event('resize'))"); pg.wait_for_timeout(600)
        check(pg, label, name, bottom, shots)
    pg.set_viewport_size(DESK); pg.wait_for_timeout(200)

def side_labels(pg):
    return pg.evaluate("Array.from(document.querySelectorAll('.side .side-link[data-side]')).map(b => b.getAttribute('data-side'))")

def go_side(pg, lab):
    def f():
        pg.set_viewport_size(DESK); pg.wait_for_timeout(150)
        pg.evaluate("(l) => { const b = Array.from(document.querySelectorAll('.side .side-link[data-side]')).find(x => x.getAttribute('data-side') === l); if (b) b.click(); }", lab)
        pg.wait_for_timeout(700)
        sz = pg.evaluate("[innerWidth, innerHeight]")
        return sz
    return f

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport=DESK); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate(SETUP)
    E = lambda js, *a: pg.evaluate(js, *a)

    # ---- the firm's pages
    E("() => { S.view = 'home'; S.homeTab = 'clients'; render(); }"); pg.wait_for_timeout(1200)
    ok(pg.locator("[data-asst-launch]").count() == 1, "the launcher is on the page")
    for lab in side_labels(pg):
        def prep(lab=lab):
            sz = pg.viewport_size
            go_side(pg, lab)()
            pg.set_viewport_size(sz)
        each_size(pg, "Firm: " + lab, prep)

    # ---- the client's pages
    E("(cid) => openCompany(cid).then(() => goStep('review', 'bills'))", cid); pg.wait_for_timeout(1500)
    for lab in side_labels(pg):
        if lab in ("Clients",): continue
        def prep(lab=lab):
            sz = pg.viewport_size
            E("(cid) => { S.view = 'company'; S.coId = cid; render(); }", cid); pg.wait_for_timeout(300)
            go_side(pg, lab)()
            pg.set_viewport_size(sz)
        each_size(pg, "Client: " + lab, prep)

    # ---- Purchase: the review table and its bar (the owner's report)
    def review():
        E("(cid) => { S.view = 'company'; S.coId = cid; S.selected = null; S.revSel = new Set(); return goStep('review', 'bills'); }", cid); pg.wait_for_timeout(700)
        E("() => { try { doAct('drawerClose'); } catch (e) {} S.revSel = new Set(); render(); }")
    each_size(pg, "Purchase review table", review, shots=True)
    ok(pg.locator("#app .actionbar").count() == 1, "the review table has its bar (Approve all that are ready)")
    # ---- a bill open in the drawer, with its bar: Approve, Next bill, No entry needed
    def drawer():
        review(); pg.wait_for_timeout(300)
        E("() => revOpen(draftRows()[0].e.id)"); pg.wait_for_timeout(600)
    each_size(pg, "Purchase bill open (drawer)", drawer, bottom=False, shots=True)
    ok(pg.locator("#app .actionbar button:has-text('Approve')").count() >= 1, "the bill's bar with Approve is on the page")
    # while the drawer is open the launcher is put away, and Ctrl+J still opens the panel
    drawer(); pg.wait_for_timeout(400)
    pg.keyboard.press("Control+j"); pg.wait_for_timeout(900)
    ok(pg.locator("[data-asst-panel]").count() == 1, "Ctrl+J opens the panel while the launcher is put away")
    E("() => ASST.close()"); pg.wait_for_timeout(400)
    # ---- bills ticked: the bar's Approve 3, Delete, Book TDS ...
    def ticked():
        review(); E("() => { S.revSel = new Set(draftRows().map(r => r.e.id)); render(); }"); pg.wait_for_timeout(300)
    each_size(pg, "Purchase bills ticked", ticked)
    # ---- Bank with statement lines
    def bank():
        E("(cid) => { S.view = 'company'; S.coId = cid; S.selected = null; }", cid); E(BANK); pg.wait_for_timeout(600)
    each_size(pg, "Bank with statement lines", bank, shots=True)
    # ---- Client setup with an unsaved change: its Save bar sticks to the foot
    def setup_dirty():
        E("(cid) => { S.view = 'company'; S.coId = cid; render(); }", cid)
        go_side(pg, "Client setup")(); pg.wait_for_timeout(300)
        inp = pg.locator("#app input[type=text]:visible, #app input:not([type]):visible").first
        if inp.count():
            try: inp.fill("ZZ changed " + str(shot_n[0])); shot_n[0] += 1
            except Exception: pass
        pg.wait_for_timeout(300)
    for name, w, h in SIZES:
        setup_dirty(); pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(700)
        check(pg, "Client setup, unsaved change", name, shots=True)
    pg.set_viewport_size(DESK)
    E("() => { try { Drafts.clear && Drafts.clear(); } catch (e) {} }")
    # ---- a confirm box
    def confirm():
        review(); E("() => { askConfirm({title: 'Delete 3 bills?', body: 'They can be restored for 30 days.', ok: 'Delete'}); }"); pg.wait_for_timeout(400)
    each_size(pg, "Confirm box", confirm, bottom=False)
    E("() => { const b = document.querySelector('#confirmBox [data-cbx=\"no\"]'); if (b) b.click(); }"); pg.wait_for_timeout(300)
    # ---- a toast with buttons
    def toasted():
        E("(cid) => { S.view = 'company'; S.coId = cid; S.tab = 'dash'; render(); toast('Deleted 3 bills.', {stay: true, actions: [{label: 'Undo', run() {}}, {label: 'Open', run() {}}]}); }", cid); pg.wait_for_timeout(500)
    each_size(pg, "Toast with buttons", toasted, bottom=False)
    E("() => toastHide()"); pg.wait_for_timeout(300)
    # ---- "A new version of FinCom is ready · Reload" (app/src/fresh.js note(), the same element)
    def fresh():
        E("""() => { if (document.querySelector('[data-new-version]')) return; const d = document.createElement('div'); d.setAttribute('data-new-version', ''); d.setAttribute('role', 'status'); d.className = 'new-version-bar';
          d.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:90;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);box-sizing:border-box;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#D5DBD8);padding:6px 6px 6px 14px;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:13px';
          d.innerHTML = '<span data-new-version-text="">A new version of FinCom is ready</span><span aria-hidden="true">·</span><button type="button" class="btn small" data-new-version-go="">Reload</button>'; document.body.appendChild(d); }""")
        review(); pg.wait_for_timeout(400)
    each_size(pg, "New version bar over the review table", fresh, bottom=False)
    E("() => { const d = document.querySelector('[data-new-version]'); if (d) d.remove(); }")
    # ---- a long review banner (two lines on a narrow window)
    pg.add_style_tag(content='body.is-test::after{content:"REVIEW BUILD – Ask FinCom never covers a button · staging database · not for real client work · a long review banner that wraps onto a second line on a narrower window";background:#6B3FA0;white-space:normal}')
    each_size(pg, "Long review banner, review table", review)
    each_size(pg, "Long review banner, bill open", drawer, bottom=False)

    # ---- round 89: a TDS return (the books and challans of run_tds_challans.py / run_tds_match_ui.py): Deductions with a
    # challan chosen (its footer of figures above the step tabs), Challans, Deductees
    _s = open(os.path.join(HERE, "run_tds_challans.py")).read(); _k = _s.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
    _m = open(os.path.join(HERE, "run_tds_match_ui.py")).read(); _j = _m.index('CHALLANS = """') + len('CHALLANS = """')
    E(_s[_k:_s.index('"""', _k)]); pg.wait_for_timeout(600); E("() => { TDSMatch.online = () => false; }"); E(_m[_j:_m.index('"""', _j)])
    E("() => { TDS.allRows().filter(r => TDS.sec(r.section) === '194C' && TDS.ymd(r.date).slice(0, 6) === '202604').forEach(r => S.books.alloc[r.id] = 'chA'); window.__bk = S.books; TDSReg.forget(); }")
    def tds_step(tab):
        def f():
            E("(t) => { try { doAct('drawerClose'); } catch (e) {} S.view = 'company'; S.coId = window.__bk.cid; S.books = window.__bk; S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = t; S.tdsDedView = ''; S.tdsChView = ''; S.tdsChSel = ''; S.tdsWinCh = 'chA'; S.tdsWinAdd = ''; render(); }", tab)
            pg.wait_for_timeout(500)
        return f
    for tab, lab in [("deductions", "TDS Deductions (a challan's footer)"), ("challans", "TDS Challans"), ("deductees", "TDS Deductees")]:
        each_size(pg, lab, tds_step(tab), shots=(tab == "deductions"))
    tds_step("deductions")(); pg.wait_for_timeout(300)
    ok(pg.locator("#app [data-wd-foot]").count() == 1 and pg.locator("#app [data-ret-foot], #app .rt-foot").count() == 0 and pg.locator("#app [data-return-tabs]").count() == 1, "TDS Deductions: the challan's footer on the page, the step tabs at the top, none at the foot")
    # F12 typed in the Ask FinCom box: the step stays
    E("() => ASST.open()"); pg.wait_for_timeout(900)
    if pg.locator("#asstQ").count():
        pg.focus("#asstQ"); pg.keyboard.type("what is F12"); pg.keyboard.press("F12"); pg.keyboard.press("F10"); pg.wait_for_timeout(400)
    ok(pg.locator("#asstQ").count() == 1 and E("S.tdsTab") == "deductions", "F12 / F10 typed in the Ask FinCom box do not switch the return's step (%s)" % E("S.tdsTab"))
    E("() => ASST.close()"); pg.wait_for_timeout(400)
    pg.locator("#app [data-return-tabs] [data-ret-tab]").first.focus(); pg.keyboard.press("F10"); pg.wait_for_timeout(400)
    ok(E("S.tdsTab") == "deductions", "with the panel closed F10 does nothing either (round 94: no step keys)")

    # ---- the launcher is still there to press on a page with room for it, and it opens the panel
    E("() => { try { doAct('drawerClose'); } catch (e) {} S.view = 'home'; S.homeTab = 'today'; render(); }"); pg.wait_for_timeout(900)
    g = pg.evaluate(GEOM)
    ok(g["shown"], "on Today the launcher is shown (%s)" % g["place"])
    if g["shown"]:
        pg.locator("[data-asst-launch]").click(); pg.wait_for_timeout(700)
        ok(pg.locator("[data-asst-panel]").count() == 1, "a click on the launcher opens the panel")
        E("() => ASST.close()")
    pg.screenshot(path=os.path.join(OUT, "today-1440.png"))
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
bad = [x for x in seen_pages if x[2]]
print("\nlooked at %d page-and-size states; the launcher covered something on %d" % (len(seen_pages), len(bad)))
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
