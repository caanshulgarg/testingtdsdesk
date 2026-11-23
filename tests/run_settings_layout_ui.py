"""python3 run_settings_layout_ui.py - Settings (the firm) and Client setup as redesigned (17-Nov-2026): a compact list,
one line a section with a short status (a section that needs something: warn); the section chosen on the right with its
header; "Needs you" / "To finish" with only what needs doing, each a link to its section; a client's header (name, GSTIN,
PAN, Tally, "N of M set up"; a section counts as not done only when it is in To finish); every Client setup section reached by its address; at phone width the list first, a
section full width with "←" back to the list; no sideways scroll at 375, 390 and 1280. Made-up firm and client only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_settings_layout_ui.py
TDSDESK_SHOTS=<dir>: also saves settings-1280.png, client-1280.png and client-390.png there."""
import os, sys, re, threading, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8302), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1); pg.on("pageerror", lambda e: errors.append(str(e)))
    E = pg.evaluate
    pg.goto("http://localhost:8302/"); pg.wait_for_timeout(2500)
    E("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    head = lambda: pg.inner_text("#app .sethead h2")
    nav = lambda label: pg.click('#app .setnav button:has(span:text-is("%s"))' % label)
    cur = lambda: E("() => { const b = document.querySelector('#app .setnav button[aria-current=page]'); return b ? b.dataset.setItem : ''; }")
    vis = lambda sel: E("(s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; }", sel)
    item = lambda i: E("(i) => { const b = document.querySelector('#app .setnav [data-set-item=\"' + i + '\"]'); return b ? {status: (b.querySelector('small') || {}).textContent || '', warn: b.classList.contains('warn'), done: b.dataset.done || ''} : null; }", i)
    needs = lambda: E("() => [...document.querySelectorAll('#app [data-set-needs] [data-needs-go]')].map(b => [b.dataset.needsGo, b.textContent])")
    # Client setup from the sidebar, as a person opens it (on a phone: the bar's More, then Client setup)
    def side_setup():
        if E("innerWidth") <= 760:
            pg.click("#side .side-more"); pg.wait_for_timeout(300); pg.click('[data-side-sheet] .side-link[data-side="Client setup"]')
        else:
            if E("document.documentElement.classList.contains('bk-rail') && !document.documentElement.classList.contains('bk-rail-menu')"): pg.click('.bkr [data-rail-menu]'); pg.wait_for_timeout(250)
            pg.click('#side .side-link[data-side="Client setup"]')
        pg.wait_for_timeout(900)
    # every section counted as not done in "N of M" is also in To finish
    def undone_listed():
        return E("""() => { const ids = new Set([...document.querySelectorAll('#app [data-set-needs] [data-needs-go]')].map(b => b.dataset.needsGo));
          return [...document.querySelectorAll('#app .setnav [data-done=false]')].map(b => b.dataset.setItem).filter(i => !ids.has(i)); }""")
    focused = lambda sel: E("(s) => !!document.activeElement && document.activeElement.matches(s)", sel)
    # one line a section: the label and its status side by side, never one under the other
    def one_line():
        return E("""() => [...document.querySelectorAll('#app .setnav button')].filter(b => { const s = b.querySelector('span'), m = b.querySelector('small');
          if (!m) return false; const a = s.getBoundingClientRect(), c = m.getBoundingClientRect(); return c.top >= a.bottom - 2 || a.height > 26; }).map(b => b.dataset.setItem)""")

    # ---------------- the firm
    E("() => { S.firm.firmName = ''; navHome('rules'); }"); pg.wait_for_timeout(700)
    grp = E("() => [...document.querySelectorAll('#app .setnav .setgroup-t')].map(x => x.textContent)")
    # offline (no firm account): the GST group's one section, GST API, needs the account, so three groups
    ok(head() == "Firm details" and cur() == "firm" and grp == ["Your firm", "My account", "Tally", "How the work is done"], "Settings opens on Firm details, the groups in the list (%s)" % grp)
    ok(not one_line(), "every section is one line: label and status side by side (%s)" % one_line())
    f = item("firm")
    ok(f and f["status"] == "no name yet" and f["warn"], "the firm with no name: its status says so, in the warning style (%s)" % f)
    ok(["firm", "The firm’s name is not set"] in needs() and pg.inner_text("#app [data-set-needs] > b").startswith("Needs you ("), "Needs you: the firm's name (%s)" % needs())
    ok(pg.locator('#app .sethead p').inner_text().startswith("The firm’s name, as it appears"), "the section's long sentence is in its header, not in the list")
    ok("as it appears" not in pg.inner_text("#app .setnav"), "the list holds no long sentences")
    # the firm's computers as TLight last read them (just now): one with Tally heard an hour ago, not now. Another
    # person's computer is not this person's problem (grey elsewhere, M4): no warning. Their own bridge's computer: warning
    DEV = "{id: 'dev-x', name: 'Test PC', info: {beat: {at: new Date(Date.now() - 3600e3).toISOString(), tally: true}}}"
    E("() => { window.__own = window.FCOwn; TLight.st.devs = [%s]; TLight.st.at = Date.now(); S.firm.firmName = 'Example & Co (test)'; render(); }" % DEV); pg.wait_for_timeout(600)
    b = item("bridge")
    ok(b and b["status"] != "1 offline" and not b["warn"] and pg.locator("#app [data-set-needs]").count() == 0, "another person's computer offline: no warning, no Needs you (%s)" % b)
    E("() => { window.FCOwn = Object.assign({}, window.__own, {bridge: () => ({dev: TLight.st.devs[0], id: 'b1'})}); TLight.st.at = Date.now() - 5 * 60e3; render(); }"); pg.wait_for_timeout(500)
    ok(not item("bridge")["warn"], "their own computer, but the computers not read for minutes (the tab just shown again): no warning yet")
    E("() => { TLight.st.at = Date.now(); render(); }"); pg.wait_for_timeout(500)
    b = item("bridge")
    ok(b and b["status"] == "1 offline" and b["warn"], "their own computer with Tally, offline: “1 offline”, in the warning style (%s)" % b)
    E("() => { TLight.st.at = Date.now() - 150e3; render(); }"); pg.wait_for_timeout(400)
    ok(item("bridge")["warn"], "the computers read 2½ minutes ago (a beat every 30 s): still said")
    E("() => { const f = window.FCOwn; window.FCOwn = Object.assign({}, f, {state: () => Object.assign({}, f.state(), {state: 'ok', own: {dev: TLight.st.devs[0], id: 'b1', beat: {}, at: new Date().toISOString(), open: []}})}); TLight.st.at = Date.now(); render(); window.FCOwn = f; }"); pg.wait_for_timeout(400)
    ok(not item("bridge")["warn"] and pg.locator("#app [data-set-needs]").count() == 0, "their own bridge answering this browser now (the top bar's Connected): no offline warning")
    E("() => { TLight.st.at = Date.now(); render(); }"); pg.wait_for_timeout(400)
    nd = needs()
    ok(len(nd) == 1 and nd[0][0] == "bridge" and nd[0][1].startswith("Your computer with Tally is offline since "), "Needs you: only the offline computer now (the name was given) (%s)" % nd)
    ok("Test PC" not in pg.inner_text("#app .setpage"), "the computer's own name is not shown")
    ok(not item("firm")["warn"] and "Example & Co (test)" in item("firm")["status"], "Firm details: the name, no warning")
    pg.click('#app [data-needs-go="bridge"]'); pg.wait_for_timeout(500)
    ok(E("S.settingsTab") == "bridge" and head() == "Connect Tally" and cur() == "bridge", "the Needs you link opens Connect Tally")
    E("() => { TLight.st.devs = []; render(); }"); pg.wait_for_timeout(400)
    ok(pg.locator("#app [data-set-needs]").count() == 0, "nothing needs doing: no Needs you strip")
    # GST API (needs the firm account: Cloud.on() for this check only, nothing asked of the server): a GSTIN only looked up
    # (seen, no session: GstApiCard asks on every 2B page) is not "not linked"; one whose session lapsed is
    E("""() => { const g = (st, pan) => st + pan + "1Z" + gstinCheckChar(st + pan + "1Z0"), g1 = g("09", "AABCL1111L"), g2 = g("27", "AABCM2222M");
      [["Looked Up Traders (test)", g1], ["Lapsed Link Traders (test)", g2]].forEach(([name, gstin]) => { const c = newCompany({name, gstin}); S.companies[c.id] = c; c.stats = {}; });
      window.__cloudOn = Cloud.on; Cloud.on = () => true; GSTAPI.seen[g1] = Date.now(); delete GSTAPI.sess[g1];
      GSTAPI.seen[g2] = Date.now(); GSTAPI.sess[g2] = {connectedAt: new Date(Date.now() - 40 * 864e5).toISOString(), until: Date.now() - 864e5, accessUntil: new Date(Date.now() - 864e5).toISOString(), endedAt: "", error: ""};
      S.settingsTab = "gstapi"; render(); }""")
    pg.wait_for_timeout(600)
    ga = item("gstapi")
    ok(ga and ga["status"] == "1 not linked" and ga["warn"] and ["gstapi", "GST API not linked for 1 client"] in needs(), "GST API: the lapsed link counted, the GSTIN only looked up not (%s, %s)" % (ga, needs()))
    E("() => { Cloud.on = window.__cloudOn; Object.values(S.companies).filter(c => /\(test\)$/.test(c.name)).forEach(c => delete S.companies[c.id]); S.settingsTab = 'firm'; render(); }"); pg.wait_for_timeout(500)
    # choosing each section
    labels = E("() => [...document.querySelectorAll('#app .setnav button')].map(b => [b.dataset.setItem, b.querySelector('span').textContent])")
    bad = []
    for sid, lab in labels:
        nav(lab); pg.wait_for_timeout(300)
        if not (head() == lab and cur() == sid and E("S.settingsTab") == sid and pg.locator("#app .setnav button[aria-current=page]").count() == 1): bad.append(lab)
    ok(not bad and len(labels) >= 10, "each of the %d sections: chosen, highlighted alone, shown with its title%s" % (len(labels), "" if not bad else " (not: %s)" % bad))
    # the addresses of the firm's sections
    for sec, lab in [("rates", "TDS rates and limits"), ("reading", "Reading bills"), ("moves", "Move on by itself")]:
        E("(h) => { location.hash = h; }", "#/settings/" + sec); pg.wait_for_timeout(600)
        ok(head() == lab and cur() == sec, "#/settings/%s opens %s" % (sec, lab))
    E("doAct('goReading')"); pg.wait_for_timeout(400)
    ok(head() == "Reading bills", "the “set up reading” link still opens Reading bills")
    if SHOTS:
        E("() => { TLight.st.devs = [{id: 'dev-x', name: 'Test PC', info: {beat: {at: new Date(Date.now() - 2 * 864e5).toISOString(), tally: true}}}]; TLight.st.at = Date.now(); S.settingsTab = 'bridge'; render(); window.scrollTo(0, 0); }"); pg.wait_for_timeout(700)
        pg.screenshot(path=os.path.join(SHOTS, "settings-1280.png"))
        E("() => { TLight.st.devs = []; render(); }")

    # ---------------- a client: GSTIN and PAN, two GSTINs with no 2B username, suppliers with and without a PAN
    cid = E("""() => { const pan = "AABCE1234F", g = (st) => st + pan + "1Z" + gstinCheckChar(st + pan + "1Z0");
      const c = newCompany({name: "Example Traders Pvt Ltd", gstin: g("09"), pan}); S.companies[c.id] = c; c.stats = {};
      S.data[c.id] = {entries: {}, loaded: true, parties: {
        a1: {id: "a1", name: "Alpha Logistics", pan: "AAACA1111A"}, b2: {id: "b2", name: "Bright Consultants", pan: ""}, d4: {id: "d4", name: "Delta Printers"},
        e5: {id: "e5", name: "Echo Abroad", pan: "", noTds: true}}};
      S.coId = c.id; S.view = "company"; S.loadingCo = false;
      S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: null, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
      window.toast = () => {}; S.tab = "invoices"; render(); GSTRegs.add(g("07")); return c.id; }""")
    pg.wait_for_timeout(800)
    side_setup()
    ok(head() == "Company" and pg.locator("#app .setnav button").count() == 9 and pg.locator("#app .setnav .setgroup-t").count() == 4, "Client setup: Company, nine sections in four groups")
    ok(not one_line(), "every client section is one line (%s)" % one_line())
    hd = pg.inner_text("#app [data-set-client]")
    ok("Example Traders Pvt Ltd" in hd and "GSTIN 09AABCE1234F1Z" in hd and "PAN AABCE1234F" in hd and "Tally: " in hd, "the client's header: name, GSTIN, PAN, Tally (%s)" % hd.replace("\n", " | "))
    d = item("deductees"); g = item("gstset"); t = item("cotds")
    ok(d["status"] == "2 no PAN" and d["warn"] and d["done"] == "false", "Suppliers: “2 no PAN” (the no-TDS supplier abroad not counted), warn (%s)" % d)
    ok(g["status"] == "2 to finish" and g["warn"] and g["done"] == "false", "GST: “2 to finish” (no 2B username for either GSTIN), warn (%s)" % g)
    ok(re.match(r"^\d+ to fill$", t["status"]) and t["warn"], "TDS: the deductor's required details still to fill, warn (%s)" % t)
    s = item("settings")
    ok(s["done"] == "true" and not s["warn"] and s["status"].startswith("09AABCE"), "Company: GSTIN and PAN given, done (%s)" % s)
    # N of M: the sections whose state is known, done or not
    st = E("() => { const xs = [...document.querySelectorAll('#app .setnav [data-done]')]; return [xs.filter(x => x.dataset.done === 'true').length, xs.length]; }")
    prog = E("() => { const p = document.querySelector('#app [data-set-progress]'); return p ? [p.dataset.setProgress, p.innerText, p.querySelector('[role=progressbar]').getAttribute('aria-valuenow')] : null; }")
    ok(prog and prog[0] == "%d/%d" % tuple(st) and ("%d of %d" % tuple(st)) in prog[1] and prog[2] == str(st[0]), "the header: “%d of %d set up”, with its bar (%s)" % (st[0], st[1], prog))
    nd = needs()
    texts = [x[1] for x in nd]
    ok(pg.inner_text("#app [data-set-needs] > b") == "To finish (%d)" % len(nd), "To finish (N): the count of its links")
    ok(not undone_listed(), "every section not done is in To finish (%s)" % undone_listed())
    ok("2 suppliers without PAN" in texts and any(x.startswith("GSTR-2B username missing for 07 · ") for x in texts) and any(x.startswith("GSTR-2B username missing for 09 · ") for x in texts)
       and any(x.startswith("TDS deductor details: ") for x in texts) and "No bank account yet" in texts and not any("GSTIN" in x and "No" in x for x in texts), "To finish lists only what is missing (%s)" % texts)
    pg.click('#app [data-needs-go="deductees"]'); pg.wait_for_timeout(600)
    ok(E("S.tab") == "deductees" and head() == "Suppliers" and cur() == "deductees", "“2 suppliers without PAN” opens Suppliers")
    pg.click('#app [data-set-needs] button:has-text("GSTR-2B username missing for 07")'); pg.wait_for_timeout(1200)
    ok(E("S.tab") == "gstset" and head() == "GST" and pg.locator('#app [data-gset-chip="07"][aria-pressed="true"]').count() == 1, "the 07 username link opens GST settings with 07 chosen")
    pg.click('#app [data-needs-go="cotds"]'); pg.wait_for_timeout(600)
    ok(E("S.tab") == "cotds" and head() == "TDS" and pg.locator("#app [data-deductor]").count() == 1, "the deductor link opens TDS, with the deductor's details")
    # a supplier's PAN given, a username given: the list and the strip follow
    E("() => { D().parties.b2.pan = 'AAACB2222B'; D().parties.d4.pan = 'AAACD4444D'; render(); }"); pg.wait_for_timeout(500)
    d = item("deductees")
    ok(not d["warn"] and d["done"] == "true" and "supplier" in d["status"] and "deductees" not in [x[0] for x in needs()], "every supplier with a PAN: Suppliers done, out of To finish (%s)" % d)
    # each section by its address (#/c/<client>/setup/<tab>), and chosen in the list
    tabs = E("SETUP_TABS.filter(t => t[0] !== 'coremove')")
    bad = []
    for tid, lab in tabs:
        E("() => { S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(250)
        E("(h) => { location.hash = h; }", "#/c/%s/setup/%s" % (cid, tid)); pg.wait_for_timeout(700)
        if not (E("S.tab") == tid and head() == lab and cur() == tid): bad.append(tid)
    ok(not bad and len(tabs) == 9, "each of the 9 setup sections opens from its address%s" % ("" if not bad else " (not: %s)" % bad))
    bad = []
    for tid, lab in tabs:
        nav(lab); pg.wait_for_timeout(350)
        if not (E("S.tab") == tid and head() == lab and cur() == tid and E("location.hash").endswith("/setup/" + tid)): bad.append(tid)
    ok(not bad, "each chosen in the list: highlighted, its title, its address%s" % ("" if not bad else " (not: %s)" % bad))
    # on a computer, choosing Company from the list (same address) adds no step to the browser's history
    E("() => { S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(300)
    side_setup()
    # (history.length stops at 50 in Chromium: the steps added are counted where they are added)
    E("() => { window.__steps = 0; if (!window.__push0) { window.__push0 = history.pushState.bind(history); history.pushState = (...a) => { window.__steps++; return window.__push0(...a); }; } }")
    nav("Company"); pg.wait_for_timeout(400); nav("Company"); pg.wait_for_timeout(400)
    ok(E("window.__steps") == 0 and head() == "Company" and not E("(history.state || {}).fcSetFrom"), "1280 px: Company chosen from the list adds no history step (%d added)" % E("window.__steps"))
    ok(pg.locator("#app [data-more='client']").count() == 1 and pg.locator("#app .setnav button:has-text('Remove this client')").count() == 0, "Remove this client: still in More")
    if SHOTS:
        E("() => { D().parties.b2.pan = ''; D().parties.d4.pan = ''; goTab('deductees'); window.scrollTo(0, 0); }"); pg.wait_for_timeout(900)
        pg.screenshot(path=os.path.join(SHOTS, "client-1280.png"))

    # ---------------- a client with no GST registration, deducting TDS (a PAN, no GSTIN): nothing to finish for GST
    E("""() => { const c = newCompany({name: "Example Services (test)", gstin: "", pan: "AABCS1234F"}); S.companies[c.id] = c; c.stats = {};
      S.data[c.id] = {entries: {}, loaded: true, parties: {}}; S.coId = c.id; S.view = "company"; S.loadingCo = false;
      S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: null, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
      window.__tds = c.id; S.tab = "settings"; render(); }""")
    pg.wait_for_timeout(1000)
    s1, g1 = item("settings"), item("gstset")
    texts = [x[1] for x in needs()]
    ok(not s1["warn"] and s1["done"] == "true" and not any("GSTIN" in x or "PAN yet" in x for x in texts), "no GSTIN, a PAN: Company is done, no warning, nothing about a GSTIN in To finish (%s, %s)" % (s1, texts))
    ok(g1["done"] == "" and not g1["warn"], "no GST registration: GST is neither done nor to finish (%s)" % g1)
    ok(not undone_listed(), "every section not done is in To finish (%s)" % undone_listed())
    E("() => { CO().pan = ''; render(); }"); pg.wait_for_timeout(400)
    ok(item("settings")["warn"] and ["settings", "No PAN yet"] in needs() and item("settings")["done"] == "false", "with no PAN either: Company warns, “No PAN yet” to finish")
    # ---------------- a client linked to its Tally company, the books still loading: no word on bank accounts yet
    E("""() => { const pan = "AABCK1234K", c = newCompany({name: "Example Linked (test)", gstin: "09" + pan + "1Z" + gstinCheckChar("09" + pan + "1Z0"), pan}); S.companies[c.id] = c; c.stats = {};
      S.data[c.id] = {entries: {}, loaded: true, parties: {}}; S.coId = c.id; S.view = "company"; S.loadingCo = false;
      TLight.st.cos = [{company: "EXAMPLE LINKED (TEST)", client_id: c.id, device_id: "", last_seen: new Date().toISOString()}];
      S.books = {loading: true, cid: c.id}; S.tab = "bankset"; render(); }""")
    pg.wait_for_timeout(1000)
    tl, bk = item("cotally"), item("bankset")
    ok(tl["done"] == "true" and not tl["warn"], "the client is linked to its Tally company (%s)" % tl)
    ok(bk["done"] == "" and not bk["warn"] and "No bank account yet" not in [x[1] for x in needs()], "its books still loading: Bank accounts neither done nor to finish (%s)" % bk)
    ok(not undone_listed(), "every section not done is in To finish (%s)" % undone_listed())
    E("() => { TLight.st.cos = []; S.coId = '%s'; S.books = {loading: false, cid: '%s', vouchers: [], map: {}, meta: null, alloc: {}, challans: [], misCfg: {freq: 'off'}, auditCfg: {freq: 'off'}}; S.tab = 'invoices'; render(); }" % (cid, cid)); pg.wait_for_timeout(800)

    # ---------------- phone width: the list first, a section full width with the way back
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    E("() => { S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(300)
    side_setup()
    ok(vis("#app .setnav") and not vis("#app .setbody") and vis("#app [data-set-client]"), "390 px, Client setup opened: the list is the first screen")
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "client-390.png"))
    nav("Suppliers"); pg.wait_for_timeout(500)
    ok(vis("#app .setbody") and not vis("#app .setnav") and vis("#app [data-set-back]") and head() == "Suppliers", "a section chosen: full width, the list hidden, a Back control")
    ok(focused("#app .sethead h2"), "the focus moves to the section's title")
    pg.go_back(); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody") and E("S.tab") == "settings", "the browser's Back: the list again")
    nav("Suppliers"); pg.wait_for_timeout(500)
    pg.click("#app [data-set-back]"); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody"), "Back: the list again")
    ok(focused('#app .setnav button[data-set-item="deductees"]'), "the focus is on Suppliers in the list")
    pg.go_back(); pg.wait_for_timeout(700)
    ok(E("S.tab") == "invoices", "the browser's Back from the list leaves Client setup (the section is not opened again)")
    pg.go_forward(); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody"), "… and Forward comes back to the list")
    nav("Company"); pg.wait_for_timeout(400)
    ok(vis("#app .setbody") and head() == "Company" and focused("#app .sethead h2"), "the list's first section, Company, opens too")
    pg.go_back(); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody"), "the browser's Back from Company: the list")
    E("() => { S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(300)
    E("(h) => { location.hash = h; }", "#/c/%s/setup/settings" % cid); pg.wait_for_timeout(800)
    ok(vis("#app .setbody") and not vis("#app .setnav") and head() == "Company", "390 px, a link to Company opens Company, not the list")
    # the sidebar's mark left behind (pressed while the client was loading, Client setup never drawn): an address or a link
    # to Company later still opens Company
    E("() => { S.tab = 'invoices'; S.setupList = Date.now(); render(); }"); pg.wait_for_timeout(300)
    E("(h) => { location.hash = h; }", "#/c/%s/setup/settings" % cid); pg.wait_for_timeout(800)
    ok(vis("#app .setbody") and not vis("#app .setnav") and head() == "Company", "390 px, a stale sidebar mark, then the address of Company: Company")
    E("() => { S.tab = 'invoices'; S.setupList = Date.now() - 60e3; render(); }"); pg.wait_for_timeout(300)
    E("goTab('settings')"); pg.wait_for_timeout(600)
    ok(vis("#app .setbody") and not vis("#app .setnav") and head() == "Company", "390 px, a mark a minute old, then a link to Company: Company")
    E("goTab('cotds')"); pg.wait_for_timeout(500)
    E("goTab('settings')"); pg.wait_for_timeout(500)
    ok(vis("#app .setbody") and head() == "Company", "a link from inside to Company opens Company")
    pg.click("#app [data-set-back]"); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody") and focused('#app .setnav button[data-set-item="settings"]'), "Back where no list came before: the list, the focus on Company")
    E("() => { S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(300)
    E("(h) => { location.hash = h; }", "#/c/%s/setup/bankset" % cid); pg.wait_for_timeout(800)
    ok(vis("#app .setbody") and not vis("#app .setnav") and head() == "Bank accounts", "390 px, a link to Bank accounts opens that section, not the list")
    E("goTab('cotds')"); pg.wait_for_timeout(500)
    ok(vis("#app .setbody") and head() == "TDS", "a link from inside to another section opens it")
    E("() => { S.firm.firmName = ''; navHome('rules'); }"); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody") and vis("#app [data-set-needs]"), "390 px, Settings: the list first, with Needs you")
    nav("AI help"); pg.wait_for_timeout(400)
    ok(vis("#app .setbody") and not vis("#app .setnav") and not vis("#app [data-set-needs]") and head() == "AI help", "a firm section: full width")
    ok(focused("#app .sethead h2"), "the focus moves to the section's title")
    pg.click("#app [data-set-back]"); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody") and E("S.settingsTab") is None and E("location.hash") == "#/settings", "Back: the list, #/settings")
    ok(focused('#app .setnav button[data-set-item="ai"]'), "the focus is on AI help in the list")
    nav("Reading bills"); pg.wait_for_timeout(400)
    pg.go_back(); pg.wait_for_timeout(700)
    ok(vis("#app .setnav") and not vis("#app .setbody") and E("S.settingsTab") is None, "the browser's Back: the list")
    pg.click('#app [data-needs-go="firm"]'); pg.wait_for_timeout(400)
    ok(vis("#app .setbody") and head() == "Firm details", "a Needs you link opens its section on a phone too")
    E("(h) => { location.hash = h; }", "#/settings/rates"); pg.wait_for_timeout(600)
    ok(vis("#app .setbody") and head() == "TDS rates and limits", "390 px, #/settings/rates opens that section")
    E("() => { S.firm.firmName = 'Example & Co (test)'; render(); }")

    # ---------------- no sideways scroll, list and every section, phone and computer
    over = "() => { const W = document.documentElement.clientWidth; return document.documentElement.scrollWidth - W; }"
    for w in [375, 390, 1280]:
        pg.set_viewport_size({"width": w, "height": 900}); bad = []
        E("() => { S.settingsTab = null; navHome('rules'); }"); pg.wait_for_timeout(500)
        if E(over) > 1: bad.append("firm list")
        for sid in E("() => [...document.querySelectorAll('#app .setnav button')].map(b => b.dataset.setItem)"):
            E("(i) => { S.settingsTab = i; render(); }", sid); pg.wait_for_timeout(350)
            if E(over) > 1: bad.append("firm " + sid + " %d" % E(over))
        E("() => { S.coId = '%s'; S.view = 'company'; S.tab = 'invoices'; render(); }" % cid); pg.wait_for_timeout(500)
        side_setup()
        if E(over) > 1: bad.append("client list")
        for tid, lab in tabs:
            E("(t) => { goTab(t); }", tid); pg.wait_for_timeout(450)
            if E(over) > 1: bad.append("client " + tid + " %d" % E(over))
        ok(not bad, "%d px: the lists and every section, no sideways scroll%s" % (w, "" if not bad else ": " + ", ".join(bad)))
    br.close()
srv.shutdown()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
