"""python3 run_tally_link_fix.py - linking a client to its Tally company (23-Oct-2026, next-fix-tally-link; the owner:
"Tally linking is still a very big problem", Salesify "even after adding Tally it is not updating"). The firm's own case:
VMS EVENTS PRIVATE LIMITED (2024-25) open in Tally on NWS144; Salesify's company SALESIFY MARKETING LLP - (from 1-Apr-25)
seen on 20-Oct and not open since.
  1. Add client: Pick from Tally first (the companies seen and not linked, with computer and last seen; what is typed puts
     the best match on top); Add as client adds the client already linked (tally_company_link once, Tally name set).
  2. Adding a client by name while another company is open in Tally links nothing and keeps the client's own name as its
     Tally name; this browser's automatic link (TCloud.auto / linkByGstin, tallyAutoClient) does not link the open company.
  3. A client of the same name: said under the name with Open it; Add asks first; Pick from Tally offers to link the
     existing client instead of adding a second one.
  4. The client's Tally card, not linked: "Choose its Tally company" with the companies seen, the same name on top, last
     seen 20-Oct, Link.
  5. Linked to the wrong company by FinCom: said, "Not this company?" lists the others; choosing one moves the client
     (the new company linked, the old unlinked).
  6. Linked, not open: "Open X in TallyPrime on NWS144 — FinCom reads it within a minute. Last seen 20-Oct."; what came in
     (ledgers, then entries) with the next step.
  7. Same GSTIN: linked by itself (linkByGstin), not when the client has a company already.
  8. No sideways scroll at 1440 and 390; shots with --shots DIR.
23-Oct-2026 (next-tally-suvit, Suvit's flow): Pick from Tally and the card's choice are the Tally page's own rows
(Companies in Tally: data-tco-row, the pill, one action); a client already there is "Link to <client>" on the row (no
question); the card says the pill's words with Sync now, and what came in with Upload older entries (Day Book).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_link_fix.py [--shots DIR]"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8641
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
VMS, SAL = "VMS EVENTS PRIVATE LIMITED (2024-25)", "SALESIFY MARKETING LLP - (from 1-Apr-25)"
D1 = "58d73e82-0000-4000-8000-000000000001"
def dev(opened=(VMS,)):
    bt = {"at": "ago:0.5", "every": 30, "tally": True, "tallyState": "open", "open": list(opened), "paused": False}
    b = {"at": "ago:0.5", "version": "2.4.5", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": list(opened)}
    return {"id": D1, "name": "NWS144", "revoked": False, "last_seen": "ago:0.5", "version": "2.4.5", "main_bridge": "go-1", "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": "NWS144", "user": "anshul", "beat": bt, "bridges": {"go-1": b}}}
# 20-Oct-2026 17:21 UTC: the last time the bridge saw Salesify's company
SAL_SEEN = "2026-10-20T17:21:36Z"
def cos(vms_client=None, sal_client=None, vms_by=None, extra=()):
    return [{"company": VMS, "client_id": vms_client, "device_id": D1, "gstin": "", "last_seen": "ago:1", "linked_at": "ago:30" if vms_client else None, "linked_by": vms_by},
            {"company": SAL, "client_id": sal_client, "device_id": D1, "gstin": "", "last_seen": SAL_SEEN, "linked_at": "ago:5" if sal_client else None, "linked_by": "u-1" if sal_client else None}] + list(extra)
SETUP = """([devs, companies]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__devs = fix(devs); window.__calls = window.__calls || [];
  const ids = window.__ids || {};
  window.__companies = fix(companies).map(x => Object.assign(x, {client_id: x.client_id ? (ids[x.client_id] || x.client_id) : null}));
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_company_link") window.__companies.forEach(r => { if (r.company === a.p_company) { r.client_id = a.p_client || null; r.linked_at = new Date().toISOString(); r.linked_by = "u-1"; } });
    return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  window.cloudPushNow = async () => {};
  // next-tally-suvit: a link starts the first sync (the ledgers wake); each scene starts without one
  TCloudUp.post = async (body) => { window.__calls.push(["post", JSON.parse(JSON.stringify(body))]); return {ok: true, woken: 1, asked: 1}; }; S.tcoSync = {};
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.stops = [];
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs; TLight.st.cos = window.__companies; TLight.st.stops = [];
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  return true;
}"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, scheme="light"):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.5", "url": "https://x/s.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
            pg.evaluate("""() => { const g = newCompany({name: 'Garg Shekhar & Company', gstin: '09AANFG3202D1ZR'}); S.companies[g.id] = g; S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {};
                Store.saveCompany(g); window.__ids = {GS: g.id}; }""")
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        calls = lambda: [c for c in E("window.__calls || []") if c[0] == "tally_company_link"]
        def scene(companies, devs=None):
            E(SETUP, [[dev()] if devs is None else devs, companies]); pg.wait_for_timeout(300)
        def confirm(yes=True):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(500)
        def shot(name, page=None):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); (page or pg).screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
        def card(cid):
            E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'cotally'; render(); }", cid); pg.wait_for_timeout(900)
        by_name = lambda n: E("(n) => Object.values(S.companies).filter(x => !x.deleted && x.name === n).map(x => x.id)", n)

        # ---- 2. a client added by name while VMS EVENTS is open in Tally: nothing linked, its own name kept
        scene(cos())
        E("() => doAct('addCo')"); pg.wait_for_timeout(700)
        rows = E("() => [...document.querySelectorAll('#app [data-tco-list=add] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.innerText.replace(/\\s+/g, ' ')])")
        ok([r[0] for r in rows] == [VMS, SAL], "1. Pick from Tally: the two companies seen and not linked, the one open now first (%s)" % [r[0] for r in rows])
        ok(rows and "NWS144 · open now" in rows[0][1] and "Connected" in rows[0][1] and re.search(r"NWS144 · last seen 20-Oct", rows[1][1] or "") is not None, "1. each with its computer, and when it was last seen (%s)" % [r[1] for r in rows])
        ok(pg.locator("#app select[data-add-tally]").count() == 0 and pg.locator('#app input[placeholder="Same as client name"]').count() == 0, "2. no 'Company in Tally' list or free 'Company name in Tally' box on Add client")
        shot("add-client-desktop")
        pg.fill("#ncName", "Salesify Marketing LLP"); pg.wait_for_timeout(400)
        top = E("() => (document.querySelector('#app [data-tco-list=add] [data-tco-row]') || {}).getAttribute && document.querySelector('#app [data-tco-list=add] [data-tco-row]').getAttribute('data-tco-row')")
        ok(top == SAL and E("() => document.querySelector('#app [data-tco-list=add] [data-tco-row]').getAttribute('data-why')") == "name", "1. typing Salesify puts its Tally company on top, 'same name' (%s)" % top)
        shot("add-client-typed-desktop")
        n0 = len(calls())
        pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(1200)
        s1 = by_name("Salesify Marketing LLP")
        ok(len(s1) == 1 and len(calls()) == n0, "2. added by name while VMS EVENTS is open in Tally: nothing linked (%s)" % calls()[n0:])
        ok(E("(c) => S.companies[c].tallyName", s1[0]) == "Salesify Marketing LLP", "2. its Tally name is its own name, not the company open in Tally (%s)" % E("(c) => S.companies[c].tallyName", s1[0]))
        E("(c) => { window.__ids.S1 = c; }", s1[0])
        # this browser's automatic link: the company open here (VMS) is never linked to Salesify
        m = E("() => { const m = tallyAutoClient({name: '%s', gstin: ''}); return m ? m.client.name : null; }" % VMS)
        ok(m is None, "2. tallyAutoClient: VMS EVENTS matches no client by itself (%s)" % m)
        E("(c) => { S.companies[c].tallyName = '%s'; }" % VMS, s1[0])   # the 23-Oct state: a Tally name left over
        m = E("() => { const m = tallyAutoClient({name: '%s', gstin: ''}); return m ? m.client.name : null; }" % VMS)
        ok(m is None, "2. not even with VMS EVENTS left as Salesify's Tally name (%s)" % m)
        m = E("() => { const m = tallyAutoClient({name: '%s', gstin: ''}); return m ? [m.client.name, m.why] : null; }" % SAL)
        ok(m == ["Salesify Marketing LLP", "name"], "2. SALESIFY MARKETING LLP - (from 1-Apr-25) matches Salesify by its name (%s)" % m)
        E("(c) => { S.companies[c].tallyName = 'Salesify Marketing LLP'; }", s1[0])

        # ---- 3. a client of the same name
        E("() => doAct('addCo')"); pg.wait_for_timeout(600)
        pg.fill("#ncName", "salesify marketing llp."); pg.wait_for_timeout(400)
        d = txt("#app [data-add-dup]")
        ok(E("() => document.querySelector('#app [data-add-dup]') && document.querySelector('#app [data-add-dup]').getAttribute('data-add-dup')") == "same" and "Salesify Marketing LLP already exists" in d and pg.locator("#app [data-add-dup-open]").count() == 1,
           "3. a client of the same name: 'Salesify Marketing LLP already exists', Open it (%s)" % d)
        shot("add-client-duplicate-desktop")
        pg.click('#app button:has-text("Add and open")'); confirm(False)
        ok(len(by_name("Salesify Marketing LLP")) + len(by_name("salesify marketing llp.")) == 1, "3. Add asks first; No adds nothing")
        # Pick from Tally with that client there: the row links it to the existing client, no second one
        n0 = len(calls())
        q = txt('#app [data-tco-list=add] [data-tco-row="%s"] [data-tco-act]' % SAL)
        ok(q == "Link to Salesify Marketing LLP", "3. Pick from Tally: the row says 'Link to Salesify Marketing LLP' (%s)" % q)
        pg.click('#app [data-tco-list=add] [data-tco-row="%s"] [data-tco-act]' % SAL); pg.wait_for_timeout(1200)
        ok(calls()[n0:] == [["tally_company_link", {"p_company": SAL, "p_client": s1[0]}]] and len(by_name("Salesify Marketing LLP")) == 1 and len(by_name("SALESIFY MARKETING LLP")) == 0,
           "3. linked to the existing Salesify, no second client (%s)" % calls()[n0:])
        ok(E("[S.coId, S.tab]") == [s1[0], "cotally"], "3. and its Tally card opens")

        # ---- 1b. Pick from Tally adds the client already linked
        scene(cos(sal_client="S1"))
        E("() => doAct('addCo')"); pg.wait_for_timeout(600)
        n0 = len(calls())
        pg.click('#app [data-tco-list=add] [data-tco-row="%s"] [data-tco-act=add]' % VMS); pg.wait_for_timeout(1500)
        vm = by_name("VMS EVENTS PRIVATE LIMITED")
        ok(len(vm) == 1 and calls()[n0:] == [["tally_company_link", {"p_company": VMS, "p_client": vm[0] if vm else ""}]],
           "1. Add as client: VMS EVENTS PRIVATE LIMITED added (the period off its name) and linked at once (%s)" % calls()[n0:])
        ok(vm and E("(c) => [S.companies[c].tallyName, S.view, S.tab, tallyLinkOf(S.companies[c]).state]", vm[0])[:3] == [VMS, "company", "cotally"], "1. its Tally name is the company; its Tally card opens")
        ok(vm and E("(c) => tallyLinkOf(S.companies[c]).state", vm[0]) != "unlinked", "1. the card shows it linked")
        E("(c) => { S.companies[c].deleted = true; }", vm[0])

        # ---- 4. the card, not linked: Choose its Tally company
        scene(cos())
        card(s1[0])
        c4 = txt("#app [data-tally-link]")
        rows = E("() => [...document.querySelectorAll('#app [data-tally-link] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.getAttribute('data-why'), r.innerText.replace(/\\s+/g, ' ')])")
        ok("Choose its company in Tally" in c4 and rows and rows[0][0] == SAL and rows[0][1] == "name" and "same name" in rows[0][2], "4. not linked: 'Choose its company in Tally', Salesify's on top, same name (%s)" % rows)
        ok(rows and "last seen 20-Oct" in rows[0][2] and "NWS144" in rows[0][2], "4. with its computer and 'last seen 20-Oct' (%s)" % (rows and rows[0][2]))
        ok(pg.locator('#app [data-tally-link] [data-tco-row="%s"] [data-tco-act=link].primary' % SAL).count() == 1, "4. its Link is the card's main button")
        shot("card-not-linked-desktop")
        n0 = len(calls())
        pg.click('#app [data-tally-link] [data-tco-row="%s"] [data-tco-act=link]' % SAL); pg.wait_for_timeout(1200)
        ok(calls()[n0:] == [["tally_company_link", {"p_company": SAL, "p_client": s1[0]}]], "4. Link -> tally_company_link once (%s)" % calls()[n0:])

        # ---- 5. linked to the wrong company by FinCom: Not this company?
        scene(cos(vms_client="S1"))
        card(s1[0])
        c5 = txt("#app [data-tally-link]")
        ok(pg.locator("#app [data-tally-link-auto]").count() == 1 and "FinCom linked " + VMS + " by itself" in c5 and pg.locator("#app [data-tally-link-wrong]").count() == 1,
           "5. a link FinCom made by itself is said, with 'Not this company?' (%s)" % c5[:200])
        shot("card-wrong-link-desktop")
        pg.click("#app [data-tally-link-wrong]"); pg.wait_for_timeout(500)
        rows = E("() => [...document.querySelectorAll('#app [data-tally-link-pick-row]')].map(r => r.getAttribute('data-tally-link-pick-row'))")
        ok(rows[:1] == [SAL] and VMS not in rows, "5. the other companies, Salesify's on top, VMS EVENTS not offered (%s)" % rows)
        shot("card-not-this-company-desktop")
        n0 = len(calls())
        pg.click('#app [data-tally-link-pick="%s"]' % SAL); confirm(True); pg.wait_for_timeout(1000)
        got = calls()[n0:]
        ok(got == [["tally_company_link", {"p_company": SAL, "p_client": s1[0]}], ["tally_company_link", {"p_company": VMS, "p_client": None}]],
           "5. the client moves: SALESIFY linked, VMS EVENTS unlinked (%s)" % got)
        ok(E("(c) => tallyLinkOf(S.companies[c]).company", s1[0]) == SAL, "5. the card now names SALESIFY")
        # None of these: unlink only
        scene(cos(vms_client="S1")); card(s1[0])
        pg.click("#app [data-tally-link-wrong]"); pg.wait_for_timeout(300)
        n0 = len(calls()); pg.click("#app [data-tally-link-unlink-only]"); confirm(True); pg.wait_for_timeout(800)
        ok(calls()[n0:] == [["tally_company_link", {"p_company": VMS, "p_client": None}]], "5. None of these: VMS EVENTS unlinked only (%s)" % calls()[n0:])

        # ---- 6. linked, not open in Tally: the one thing to do, and what came in
        scene(cos(sal_client="S1")); card(s1[0])
        line = re.sub(r"\s+", " ", txt("#app [data-tally-link] [data-tally-link-status]"))
        ok(E("(c) => tallyLinkOf(S.companies[c]).state", s1[0]) == "waiting" and "Disconnected — not open in Tally on NWS144 (last seen 20-Oct). Open " + SAL + " in TallyPrime on NWS144 — FinCom reads it within a minute." in line
           and pg.locator("#app [data-tally-link] [data-tally-sync-now]").count() == 1,
           "6. 'Disconnected — not open in Tally on NWS144 (last seen 20-Oct). Open SALESIFY… in TallyPrime on NWS144 — FinCom reads it within a minute.', Sync now (%s)" % line)
        pg.wait_for_timeout(600)
        pr = E("() => { const e = document.querySelector('#app [data-tally-link-progress]'); return e ? e.innerText.replace(/\\s+/g, ' ') : null; }")
        ok(pr and "Ledgers not in FinCom yet" in pr and pg.locator('#app [data-tally-daybook]').count() == 1, "6. what came in: no ledgers yet, and Upload older entries (Day Book) (%s)" % pr)
        ok(pg.locator("#app [data-tally-link-auto]").count() == 0 and pg.locator("#app [data-tally-link-wrong]").count() == 1, "6. a person's link: not said as FinCom's, 'Not this company?' still there")
        shot("card-waiting-desktop")
        E("(c) => { TCloud.st[c] = Object.assign(TCloud.st[c] || {}, {at: Date.now(), ledN: {n: 1240, at: Date.now(), book: 'b'}}); render(); }", s1[0]); pg.wait_for_timeout(400)
        pr = E("() => { const e = document.querySelector('#app [data-tally-link-progress]'); return e ? e.innerText.replace(/\\s+/g, ' ') : null; }")
        ok(pr and "Ledgers 1,240" in pr and "this year’s entries not in FinCom yet" in pr and pg.locator('#app [data-tally-daybook]').count() == 1, "6. ledgers in: then this year's entries, Upload older entries (Day Book) (%s)" % pr)
        pg.click('#app [data-tally-daybook]'); pg.wait_for_timeout(1000)
        ok(E("[S.coId, S.tab, S.booksTab]") == [s1[0], "books", "import"], "6. Upload older entries opens Books › From Tally's Upload for this client (%s)" % E("[S.coId, S.tab, S.booksTab]"))

        # ---- 7. the same GSTIN: linked by itself, not when the client has a company already
        E("() => { window.__calls = []; }")
        scene(cos(extra=[{"company": "GSC BOOKS 2026", "client_id": None, "device_id": D1, "gstin": "09AANFG3202D1ZR", "last_seen": "ago:2", "linked_at": None, "linked_by": None}]))
        E("() => { linkByGstin(window.__companies); }"); pg.wait_for_timeout(600)
        ok(calls() == [["tally_company_link", {"p_company": "GSC BOOKS 2026", "p_client": E("window.__ids.GS")}]], "7. the same GSTIN as Garg Shekhar & Company: linked by itself (%s)" % calls())
        E("() => { window.__calls = []; }")
        scene(cos(extra=[{"company": "GARG SHEKHAR & COMPANY", "client_id": "GS", "device_id": D1, "gstin": "09AANFG3202D1ZR", "last_seen": "ago:2", "linked_at": "ago:900", "linked_by": "u-1"},
                         {"company": "GSC BOOKS 2027", "client_id": None, "device_id": D1, "gstin": "09AANFG3202D1ZR", "last_seen": "ago:2", "linked_at": None, "linked_by": None}]))
        E("() => { linkByGstin(window.__companies); }"); pg.wait_for_timeout(600)
        ok(calls() == [], "7. not when that client is linked to a company already (%s)" % calls())

        # ---- 8. phone 390, light and dark: no sideways scroll; shots
        for scheme in ("light", "dark"):
            for w, h, tag in ((1440, 900, "desktop"), (390, 844, "phone")):
                q = open_page(w, h, scheme)
                q.evaluate("() => { const c = newCompany({name: 'Salesify Marketing LLP', gstin: '06AEVFS5010H1ZV'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; window.__ids.S1 = c.id; }")
                for nm, comp, act in (("add-client", cos(), "add"), ("card-not-linked", cos(), "card"), ("card-wrong-link", cos(vms_client="S1"), "wrong"), ("card-waiting", cos(sal_client="S1"), "card")):
                    q.evaluate(SETUP, [[dev()], comp]); q.wait_for_timeout(300)
                    if act == "add": q.evaluate("() => doAct('addCo')"); q.wait_for_timeout(500); q.fill("#ncName", "Salesify"); q.wait_for_timeout(300)
                    else:
                        q.evaluate("() => { openCompany(window.__ids.S1); S.view = 'company'; S.tab = 'cotally'; render(); }"); q.wait_for_timeout(900)
                        if act == "wrong": q.click("#app [data-tally-link-wrong]"); q.wait_for_timeout(400)
                    x = q.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                    ok(x <= 1, "8. %s %s %s: no sideways scroll (%d px)" % (tag, scheme, nm, x))
                    if SHOTS:
                        el = q.locator("#app [data-tally-link]") if act != "add" else q.locator("#app")
                        (el if el.count() else q).screenshot(path=os.path.join(SHOTS, "%s-%s-%s.png" % (nm, tag, scheme)))
                q.close()
        br.close()
    srv.shutdown()
    print("page errors:", errors[:3]) if errors else None
    ok(not errors, "no page errors (%d)" % len(errors))
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
