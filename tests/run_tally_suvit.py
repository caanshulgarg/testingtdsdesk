"""python3 run_tally_suvit.py - Tally connects like Suvit, with no extra step (23-Oct-2026, next-tally-suvit; the owner:
"make sure it should connect like Suvit.. every step.. thoroughly.. don't need extra steps in connection").
Suvit (help.suvit.io): open the company in Tally; the connector's Add Companies lists it; Subscribe makes it a company
on the website (the company IS the client); the first sync starts by itself and says the ledgers are synced; My
Companies says Connected / Disconnected; Sync master re-syncs. FinCom, website only (the bridge is not touched):
  1. The Tally page's Companies in Tally: every company the firm's computers have seen, open now first, then the latest
     seen; each with its computer, the pill (Connected / "Disconnected — not open in Tally on NWS144 (last seen 20-Oct)" /
     "Disconnected — computer offline since …") and ONE action. A search box once there are more than 10.
  2. Add as client: one click: the client made with the company's name (the period off) and GSTIN, linked
     (tally_company_link once), the first sync's wake sent once (TCloudUp kind wake, what ledgers), the progress, then
     "Ledgers 1,240 ✓ · Entries Apr–Oct 2026 ✓". The page stays.
  3. A client of the same name already there: the row says "Link to <client>", no second client.
  4. Linked: the client's name, Sync now (the existing Update now: tally_want_update), ⋯ Not this client (link another
     client / unlink), Upload older entries (Day Book) only while days are missing.
  5. Connect Tally: three steps (Install FinCom Bridge, Open your company in TallyPrime, Add as client) that tick from
     the beats and the links; no six-step strip, no Link / Ledgers / Day Book steps; all done: one green line.
  6. The same pill on the client's Tally card (with Sync now), the Clients list's chip and the top bar's sign; a client
     not linked: its card lists the companies with Link. Add client's Pick from Tally is the same rows; a new name
     without Tally is still added.
  7. No sideways scroll at 1440 and 390, light and dark; --shots DIR saves the pictures.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_suvit.py [--shots DIR]"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8653
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
VMS, SAL, GSC, OLD = "VMS EVENTS PRIVATE LIMITED (2024-25)", "SALESIFY MARKETING LLP - (from 1-Apr-25)", "GARG SHEKHAR & COMPANY (2025-26)", "MASTER CAD INFRA"
VMS_GST = "07AAHCV1111A1Z" + "7"   # its check character (gstinValid) is checked in the page below
D1, D2 = "58d73e82-0000-4000-8000-000000000001", "58d73e82-0000-4000-8000-000000000002"
def dev(i=D1, pc="NWS144", at="ago:0.5", opened=(VMS, GSC), tally="open"):
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False}
    b = {"at": at, "version": "2.4.5", "computer": pc, "user": "anshul", "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally, "open": list(opened)}
    return {"id": i, "name": pc, "revoked": False, "last_seen": at, "version": "2.4.5", "main_bridge": "go-" + pc, "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": pc, "user": "anshul", "beat": bt, "bridges": {"go-" + pc: b}}}
SAL_SEEN = "2026-10-20T17:21:36Z"   # 20-Oct 22:51 IST
GST = [""]
def cos(vms=None, sal=None, gsc=None, old=None, extra=()):
    r = lambda c, cl, d, seen, g="": {"company": c, "client_id": cl, "device_id": d, "gstin": g, "last_seen": seen, "linked_at": "ago:5" if cl else None, "linked_by": "u-1" if cl else None}
    return [r(VMS, vms, D1, "ago:1", GST[0]), r(SAL, sal, D1, SAL_SEEN), r(GSC, gsc, D1, "ago:1"), r(OLD, old, D2, "ago:40")] + list(extra)
SETUP = """([devs, companies, books, ledn]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__devs = fix(devs); window.__calls = window.__calls || [];
  const ids = window.__ids || {};
  window.__companies = fix(companies).map(x => Object.assign(x, {client_id: x.client_id ? (ids[x.client_id] || x.client_id) : null}));
  window.__books = {}; Object.entries(books || {}).forEach(([k, v]) => { window.__books[ids[k] || k] = v; });
  window.__ledn = ledn || {};
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path, opt) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_ledgers/.test(path) && opt && opt.count) { const m = /book_id=eq\\.([^&]+)/.exec(path); return Number(window.__ledn[decodeURIComponent(m ? m[1] : "")] || 0); }
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_company_link") window.__companies.forEach(r => { if (r.company === a.p_company) { r.client_id = a.p_client || null; r.linked_at = new Date().toISOString(); r.linked_by = "u-1"; } });
    if (fn === "tally_status") return copy(window.__books[a.p_client] || []);
    if (fn === "tally_period_status") return {};
    return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  TCloudUp.post = async (body, who) => { window.__calls.push(["post", JSON.parse(JSON.stringify(body)), JSON.parse(JSON.stringify(who || {}))]); return {ok: true, woken: 1, asked: 1}; };
  window.cloudPushNow = async () => {};
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.stops = [];
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs; TLight.st.cos = window.__companies; TLight.st.stops = [];
  TCloud.refreshPane = async () => { TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); };
  TLight.refresh = function () { this.st.devs = window.__devs; this.st.cos = window.__companies; this.st.at = Date.now(); return Promise.resolve(); };
  Object.keys(TCloud.st || {}).forEach(k => { delete TCloud.st[k]; }); S.tcoSync = {};
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  return true;
}"""
BOOK = lambda name: [{"book": "bk-" + name, "company": name, "from": "2026-04-01", "to": "2026-10-22", "days": 205, "openAsOn": "2026-03-31", "ledgersAt": "ago:1", "entries": 3400}]

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
        global VMS_GST
        VMS_GST = VMS_GST[:14] + E("(g) => gstinCheckChar(g)", VMS_GST[:14] + "0"); GST[0] = VMS_GST
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        calls = lambda kind=None: [c for c in E("window.__calls || []") if kind is None or c[0] == kind]
        # the first sync's wake (Ledgers.askTally); "active" (FinCom in use) and "open" (a client opened) are TWake's own
        wakes = lambda: [c for c in calls("post") if c[1].get("kind") == "wake" and c[1].get("what") == "ledgers"]
        def scene(companies, devs=None, books=None, ledn=None):
            E(SETUP, [[dev(), dev(D2, "LAPTOP", at="ago:42", opened=())] if devs is None else devs, companies, books or {}, ledn or {}]); pg.wait_for_timeout(300)
        def tally_page():
            E("() => { S.tallyGuide = {}; S.tallyTab = 'computers'; navHome('tally'); }"); pg.wait_for_timeout(1200)
        def rows():
            return E("""() => [...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => ({co: r.getAttribute('data-tco-row'), st: r.getAttribute('data-tco-state'),
                pill: r.querySelector('[data-tco-pill]').innerText.replace(/\\s+/g, ' ').trim(), text: r.innerText.replace(/\\s+/g, ' '), act: (r.querySelector('[data-tco-act]') || {}).innerText || '',
                linked: r.getAttribute('data-tco-linked')}))""")
        def row(co): return next((r for r in rows() if r["co"] == co), None)
        def shot(name, page=None, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); (page or pg).screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
        by_name = lambda n: E("(n) => Object.values(S.companies).filter(x => !x.deleted && x.name === n).map(x => x.id)", n)
        def confirm(yes=True):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(500)

        # ---- 1. the list: open now first, then the latest seen; the pills
        scene(cos())
        tally_page()
        rs = rows()
        ok([r["co"] for r in rs][:2] == sorted([VMS, GSC], key=lambda c: c) or set(r["co"] for r in rs[:2]) == {VMS, GSC}, "1. the companies open in Tally now come first (%s)" % [r["co"] for r in rs])
        ok([r["co"] for r in rs][2:] == [SAL, OLD] or [r["co"] for r in rs][2:] == [OLD, SAL], "1. then the ones seen before (%s)" % [r["co"] for r in rs])
        ok(row(VMS)["st"] == "connected" and row(VMS)["pill"] == "Connected", "1. VMS EVENTS open on NWS144: Connected (%s)" % row(VMS)["pill"])
        ok(row(SAL)["pill"] == "Disconnected — not open in Tally on NWS144 (last seen 20-Oct)", "1. Salesify: 'Disconnected — not open in Tally on NWS144 (last seen 20-Oct)' (%s)" % row(SAL)["pill"])
        ok(re.match(r"^Disconnected — computer offline since \d\d:\d\d$", row(OLD)["pill"] or "") is not None and row(OLD)["st"] == "offline", "1. its computer off: 'Disconnected — computer offline since 12:02' (%s)" % row(OLD)["pill"])
        ok("NWS144" in row(VMS)["text"] and "LAPTOP" in row(OLD)["text"] and "last seen 20-Oct" in row(SAL)["text"], "1. each row names its computer and when it was last seen")
        ok(row(VMS)["act"] == "Add as client" and row(SAL)["act"] == "Add as client", "1. not linked: 'Add as client' (%s, %s)" % (row(VMS)["act"], row(SAL)["act"]))
        ok(row(GSC)["act"] == "Link to Garg Shekhar & Company", "3. GARG SHEKHAR & COMPANY (2025-26) with Garg Shekhar & Company already a client: 'Link to Garg Shekhar & Company' (%s)" % row(GSC)["act"])
        ok(pg.locator("#app [data-tco-q]").count() == 0, "1. no search box with 4 companies")
        ok(E("() => { const a = document.querySelector('#app [data-tco-list=firm]'), g = document.querySelector('#app [data-connect-guide]'); return !!a && (!g || !!(g.compareDocumentPosition(a) & 4)); }"), "1. Companies in Tally right under the steps")
        shot("tally-page-list-desktop-light")

        # ---- 5. the three steps
        g = E("() => [...document.querySelectorAll('#app [data-connect-step]')].map(e => [e.getAttribute('data-connect-step'), e.hasAttribute('data-done')])")
        ok(g == [["install", True], ["open", True], ["add", False]], "5. three steps: install and open ticked from the beats, Add as client next (%s)" % g)
        ok(pg.locator("#app [data-strip-step], #app [data-connect-step=link], #app [data-connect-step=ledgers], #app [data-connect-step=daybook], #app [data-guide-picker]").count() == 0, "5. no six-step strip, no Link / Ledgers / Day Book steps")
        gtxt = txt("#app [data-connect-guide]")
        ok("Install FinCom Bridge on the Tally computer" in gtxt and "Open your company in TallyPrime" in gtxt and "Add as client" in gtxt and "2 of 3 done" in gtxt, "5. the three steps' words, 2 of 3 done (%s)" % gtxt[:160])
        shot("guide-3-steps-desktop-light")

        # ---- 2. Add as client: one click
        E("() => { window.__calls = []; }")
        n0 = len(by_name("VMS EVENTS PRIVATE LIMITED"))
        pg.click('#app [data-tco-list=firm] [data-tco-row="%s"] [data-tco-act=add]' % VMS); pg.wait_for_timeout(900)
        vm = by_name("VMS EVENTS PRIVATE LIMITED")
        ok(n0 == 0 and len(vm) == 1, "2. one click: the client VMS EVENTS PRIVATE LIMITED is made (the period off its name) (%s)" % vm)
        cid = vm[0] if vm else ""
        ok(E("(c) => [S.companies[c].gstin, S.companies[c].tallyName]", cid) == [VMS_GST, VMS] if cid else False, "2. with the company's GSTIN, and its Tally name")
        ok(calls("tally_company_link") == [["tally_company_link", {"p_company": VMS, "p_client": cid}]], "2. linked: tally_company_link once (%s)" % calls("tally_company_link"))
        pg.wait_for_timeout(600)
        ok(len(wakes()) == 1 and wakes()[0][1] == {"kind": "wake", "what": "ledgers", "client": cid}, "2. the first sync starts by itself: the wake sent once (%s)" % wakes())
        ok(E("() => S.view") == "home" and pg.locator("#app [data-tco-list=firm]").count() == 1, "2. the page stays on the list (Suvit's list)")
        r = row(VMS)
        ok(r and r["linked"] == cid and "VMS EVENTS PRIVATE LIMITED" in r["text"] and pg.locator('#app [data-tco-row="%s"] [data-tco-sync=running]' % VMS).count() == 1,
           "2. the row: the client, and the first sync's progress (%s)" % (r and r["text"]))
        pr = txt('#app [data-tco-row="%s"] [data-tco-sync]' % VMS)
        ok("Reading ledgers from Tally" in pr and re.search(r"\d:\d\d", pr), "2. progress: 'Reading ledgers from Tally… 0:02' (%s)" % pr)
        shot("after-add-progress-desktop-light")
        # the cloud gets the books: the confirmation
        E("(c) => { window.__books[c] = %s; window.__ledn['bk-VMS'] = 1240; }" % json.dumps(BOOK("VMS")), cid)
        pg.wait_for_selector('#app [data-tco-row="%s"] [data-tco-sync=done]' % VMS, timeout=25000)
        dn = txt('#app [data-tco-row="%s"] [data-tco-sync=done]' % VMS)
        ok(dn.startswith("Ledgers 1,240 ✓ · Entries Apr–Oct 2026 ✓"), "2. then the confirmation: 'Ledgers 1,240 ✓ · Entries Apr–Oct 2026 ✓' (%s)" % dn)
        ok(len(wakes()) == 1, "2. still one wake (%d)" % len(wakes()))
        shot("after-add-confirmed-desktop-light")

        # ---- 3. Link to the client already there: no second client
        E("() => { window.__calls = []; }")
        n_before = len(E("() => Object.values(S.companies).filter(c => !c.deleted)"))
        pg.click('#app [data-tco-list=firm] [data-tco-row="%s"] [data-tco-act=link]' % GSC); pg.wait_for_timeout(1200)
        gs = E("window.__ids.GS")
        ok(calls("tally_company_link") == [["tally_company_link", {"p_company": GSC, "p_client": gs}]] and len(E("() => Object.values(S.companies).filter(c => !c.deleted)")) == n_before,
           "3. Link to Garg Shekhar & Company: linked to it, no second client (%s)" % calls("tally_company_link"))
        ok(len(wakes()) == 1 and wakes()[0][1]["client"] == gs, "3. and its first sync starts (one wake)")

        # ---- 4. linked: Sync now = Update now; ⋯
        E("() => { window.__calls = []; S.coId = null; }")
        pg.click('#app [data-tco-row="%s"] [data-tco-sync-now]' % VMS); pg.wait_for_timeout(700)
        ok(calls("tally_want_update") == [["tally_want_update", {"p_client": cid}]], "4. Sync now: the existing Update now (tally_want_update) (%s)" % calls())
        pg.click('#app [data-tco-row="%s"] [data-tco-more] summary' % VMS); pg.wait_for_timeout(300)
        items = E("(co) => [...document.querySelectorAll('#app [data-tco-row=\"' + co + '\"] .bk-menu-list button')].map(b => b.innerText.split('\\n')[0])", VMS)
        ok(items == ["Open client", "Not this client"], "4. ⋯: Open client, Not this client; no Day Book while this year's days are in (%s)" % items)
        pg.click('#app [data-tco-row="%s"] [data-tco-not-this]' % VMS); pg.wait_for_timeout(300)
        pg.select_option('#app [data-tco-row="%s"] [data-tco-relink-pick]' % VMS, gs)
        E("() => { window.__calls = []; }")
        pg.click('#app [data-tco-row="%s"] [data-tco-relink]' % VMS); pg.wait_for_timeout(1000)
        ok(calls("tally_company_link")[:1] == [["tally_company_link", {"p_company": VMS, "p_client": gs}]], "4. Not this client: the company moves to the client chosen (%s)" % calls("tally_company_link"))
        # a linked client with no entries of this year: the Day Book under ⋯
        scene(cos(sal="GS"), books={"GS": [{"book": "bk-S", "company": SAL, "from": "2025-04-01", "to": "2026-03-31", "days": 300, "ledgersAt": "ago:9"}]}, ledn={"bk-S": 88})
        E("() => { S.ledgerHist = S.ledgerHist; }"); tally_page(); pg.wait_for_timeout(1200)
        pg.click('#app [data-tco-row="%s"] [data-tco-more] summary' % SAL); pg.wait_for_timeout(300)
        ok(pg.locator('#app [data-tco-row="%s"] [data-tco-daybook]' % SAL).count() == 1 and "Upload older entries (Day Book)" in txt('#app [data-tco-row="%s"] [data-tco-daybook]' % SAL),
           "4. days of this year missing: ⋯ Upload older entries (Day Book)")
        # the Disconnected rows, for the pictures
        r = row(SAL)
        ok(r and r["pill"].startswith("Disconnected — not open in Tally on NWS144") and "Garg Shekhar & Company" in r["text"], "4. a linked company not open: Disconnected, with its client (%s)" % (r and r["text"]))
        E("() => { document.querySelectorAll('#app details[open]').forEach(d => d.open = false); }")
        shot("disconnected-rows-desktop-light")

        # ---- 5b. the steps tick from real data
        scene(cos(), devs=[])
        tally_page()
        g = E("() => [...document.querySelectorAll('#app [data-connect-step]')].map(e => [e.getAttribute('data-connect-step'), e.hasAttribute('data-done')])")
        ok(g == [["install", False], ["open", False], ["add", False]] and pg.locator("#app [data-connect-step=install] [data-bridge-download]").count() == 1, "5. no bridge: nothing ticked, the Download in step 1 (%s)" % g)
        scene(cos(), devs=[dev(opened=(), tally="closed")]); tally_page()
        g = E("() => [...document.querySelectorAll('#app [data-connect-step]')].map(e => e.hasAttribute('data-done'))")
        ok(g == [True, False, False] and "Open TallyPrime on NWS144" in txt("#app [data-connect-step=open]"), "5. bridge on, Tally closed: step 2 says open TallyPrime on NWS144 (%s)" % txt("#app [data-connect-step=open]"))
        scene(cos(vms="GS"), devs=[dev()]); tally_page()
        ok(pg.locator("#app [data-connect-step]").count() == 0 and pg.locator("#app [data-connected-line]").count() == 1 and "● Connected" in txt("#app [data-connected-line]"),
           "5. all three done: one green line under the list (%s)" % txt("#app [data-connected-line]"))
        shot("tally-page-all-done-desktop-light")

        # ---- 1b. more than 10 companies: a search box
        many = [{"company": "CO %02d TRADERS" % i, "client_id": None, "device_id": D1, "gstin": "", "last_seen": "ago:%d" % (100 + i), "linked_at": None, "linked_by": None} for i in range(12)]
        scene(cos(extra=many)); tally_page()
        ok(pg.locator("#app [data-tco-q]").count() == 1, "1. 16 companies: a search box")
        pg.fill("#app [data-tco-q]", "co 07"); pg.wait_for_timeout(300)
        ok([r["co"] for r in rows()] == ["CO 07 TRADERS"], "1. the search finds one (%s)" % [r["co"] for r in rows()])

        # ---- 6. the same pill everywhere
        scene(cos(sal="GS"))
        gs = E("window.__ids.GS")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'cotally'; render(); }", gs); pg.wait_for_timeout(1200)
        line = re.sub(r"\s+", " ", txt("#app [data-tally-link] [data-tally-link-status]"))
        ok(line.startswith("Disconnected") and "Disconnected — not open in Tally on NWS144 (last seen 20-Oct)" in line and pg.locator("#app [data-tally-link] [data-tally-sync-now]").count() == 1,
           "6. the client's card: the same pill words, Sync now (%s)" % line)
        sign = E("() => { const b = document.querySelector('[data-tally-sign]'); return b ? b.getAttribute('title') : ''; }")
        ok("Disconnected — not open in Tally on NWS144 (last seen 20-Oct)" in sign, "6. the top bar's sign says the same words (%s)" % sign)
        shot("client-card-linked-desktop-light", full=False)
        E("() => { window.__calls = []; }")
        pg.click("#app [data-tally-link] [data-tally-sync-now]"); pg.wait_for_timeout(600)
        ok(E("(c) => typeof TallyAsk === 'object' && !!TallyAsk[c]", gs), "6. Sync now on the card is Update now (tallyUpdateNow asked a read)")
        # Clients list chip
        E("() => { S.view = 'home'; navHome('clients'); }"); pg.wait_for_timeout(900)
        chip = E("(c) => { const r = [...document.querySelectorAll('#app [data-tally-chip-at=clients]')]; return r.map(b => [b.getAttribute('data-tally-pill'), b.innerText.trim(), b.getAttribute('title')]); }", gs)
        ok(any(c[0] == "notopen" and c[1].endswith("Disconnected") and "Disconnected — not open in Tally on NWS144 (last seen 20-Oct)" in (c[2] or "") for c in chip), "6. Clients list: the chip says Disconnected, its tip the same words (%s)" % chip)
        # a client not linked: its card lists the companies with Link
        E("() => { const c = newCompany({name: 'Salesify Marketing LLP'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; window.__ids.S1 = c.id; }")
        scene(cos())
        s1 = E("window.__ids.S1")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'cotally'; render(); }", s1); pg.wait_for_timeout(1500)
        cr = E("() => [...document.querySelectorAll('#app [data-tally-link] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), (r.querySelector('[data-tco-act]') || {}).innerText])")
        ok(cr[:1] == [[SAL, "Link"]] and all(a == "Link" for _, a in cr), "6. not linked: its card lists the companies, Salesify's on top, each with Link (%s)" % cr)
        shot("client-card-not-linked-desktop-light", full=False)
        E("() => { window.__calls = []; }")
        pg.click('#app [data-tally-link] [data-tco-row="%s"] [data-tco-act=link]' % SAL); pg.wait_for_timeout(1200)
        ok(calls("tally_company_link") == [["tally_company_link", {"p_company": SAL, "p_client": s1}]] and len(wakes()) == 1, "6. Link: linked once, the first sync started (%s)" % calls())
        # Add client: the same rows; a new name without Tally still works
        scene(cos(vms="GS"))
        E("() => { S.view = 'home'; navHome('clients'); doAct('addCo'); }"); pg.wait_for_timeout(1200)
        ar = E("() => [...document.querySelectorAll('#app [data-tco-list=add] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), (r.querySelector('[data-tco-act]') || {}).innerText])")
        ok(VMS not in [a[0] for a in ar] and [OLD, "Add as client"] in ar and [SAL, "Link to Salesify Marketing LLP"] in ar, "6. Add client: Pick from Tally is the same rows, only the companies not linked; Salesify there already: Link to it (%s)" % ar)
        shot("add-client-desktop-light")
        pg.fill("#ncName", "Kumar Medicos"); pg.wait_for_timeout(300)
        E("() => { window.__calls = []; }")
        pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(1200)
        ok(len(by_name("Kumar Medicos")) == 1 and calls("tally_company_link") == [], "6. a new name without Tally: added, nothing linked")
        E("() => doAct('addCo')"); pg.wait_for_timeout(700)
        n0 = len(E("() => Object.values(S.companies).filter(c => !c.deleted)")); E("() => { window.__calls = []; }")
        pg.click('#app [data-tco-list=add] [data-tco-row="%s"] [data-tco-act=add]' % OLD); pg.wait_for_timeout(1500)
        sm = by_name(OLD)
        ok(len(E("() => Object.values(S.companies).filter(c => !c.deleted)")) == n0 + 1 and len(sm) == 1 and calls("tally_company_link") == [["tally_company_link", {"p_company": OLD, "p_client": sm[0]}]] and len(wakes()) == 1,
           "6. Add client → Add as client: added, linked, first sync started (%s)" % calls())
        ok(E("[S.view, S.tab]") == ["company", "cotally"], "6. and its Tally card opens, with the progress")

        # ---- 7. phone 390, light and dark: no sideways scroll; pictures
        for scheme in ("light", "dark"):
            for w, h, tag in ((1440, 900, "desktop"), (390, 844, "phone")):
                q = open_page(w, h, scheme)
                q.evaluate("() => { const c = newCompany({name: 'Salesify Marketing LLP'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; window.__ids.S1 = c.id; }")
                for nm, comp, act in (("tally-page-list", cos(sal="S1"), "page"), ("guide-3-steps", cos(), "page"), ("client-card", cos(sal="S1"), "card"), ("add-client", cos(), "add")):
                    q.evaluate(SETUP, [[dev(), dev(D2, "LAPTOP", at="ago:42", opened=())], comp, {}, {}]); q.wait_for_timeout(300)
                    if act == "page": q.evaluate("() => { S.tallyGuide = {}; navHome('tally'); }"); q.wait_for_timeout(1300)
                    elif act == "add": q.evaluate("() => { navHome('clients'); doAct('addCo'); }"); q.wait_for_timeout(1300)
                    else: q.evaluate("() => { openCompany(window.__ids.S1); S.view = 'company'; S.tab = 'cotally'; render(); }"); q.wait_for_timeout(1300)
                    x = q.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                    ok(x <= 1, "7. %s %s %s: no sideways scroll (%d px)" % (tag, scheme, nm, x))
                    if SHOTS and not (nm == "guide-3-steps" and tag == "desktop" and scheme == "light"):
                        q.screenshot(path=os.path.join(SHOTS, "%s-%s-%s.png" % (nm, tag, scheme)), full_page=act != "card")
                if SHOTS:
                    # after Add as client: the progress, on this size and theme
                    q.evaluate(SETUP, [[dev()], cos(), {}, {}]); q.evaluate("() => { S.tallyGuide = {}; navHome('tally'); }"); q.wait_for_timeout(1200)
                    q.click('#app [data-tco-list=firm] [data-tco-row="%s"] [data-tco-act=add]' % VMS); q.wait_for_timeout(1500)
                    q.screenshot(path=os.path.join(SHOTS, "after-add-progress-%s-%s.png" % (tag, scheme)), full_page=True)
                q.close()
        br.close()
    srv.shutdown()
    print("page errors:", errors[:3]) if errors else None
    ok(not errors, "no page errors (%d)" % len(errors))
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
