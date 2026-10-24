"""python3 run_tally_one_page.py - Tally on ONE clear page, like Suvit's My Companies (24-Oct-2026, next-tally-one-page).
The owner: "I was trying to delink Salesify.. after delinking and relinking it is not showing.. please clear all the excess
things which are not required.. make it completely like Suvit.. somewhere it is showing, other places it is not showing..
I have to go everywhere to see where to add.. I need a clear page only"; "if there is a company open in Tally, it should
show in the dropdown always"; "check the Suvit rules as well". Website only (the bridge and every Tally request unchanged).
  1. Unlink, then link again, a company NOT open in Tally: it stays in the list (Not a client) and links again in one click;
     the books' copy kept here for the client does not keep it "linked" (the 24-Oct cause), its Tally name is cleared.
  2. A company open in Tally that its computer has not sent to FinCom yet (a new year: "Salesify Marketing LLP 2026-27"):
     listed at once, at the top; "New year of Salesify Marketing LLP · Link"; the click is kept and done by itself once the
     company is in FinCom's cloud (on 24-Oct tally_company_link refused it twice); the older year stays linked and says
     "Earlier year".
  3. One status, one function: the row's pill, the client's title chip and the Clients list's chip say the same; a Tally
     name left on another client ("Testing AAD": GARG SHEKHAR & COMPANY) does not make it linked.
  4. Every other place is gone: Client setup has one line ("Tally: <company> ● Connected · Open in Tally page"), Books ›
     From Tally, the Overview, Add client, Settings and Today show no link or status block of their own; the Tally page
     has no clients' table, no status block, no "Seen, not linked". Help & support is closed.
  5. Add as client and Link to … still work; ⋯ Link to a client…; from a client not linked: every company, the open ones
     first, "Link to <client>", and one linked to another client: "Linked to X · Move here" (asked once).
  6. Suvit's rules: Sync now = Sync master + Sync vouchers (both under ⋯); Disconnected only for a linked company, with the
     fix in words; Remove company (not linked, not open) hides it, Show hidden puts it back; a name with extra spaces says
     so; Post entries here under ⋯ (the confirmed postTo).
  7. The three steps until the first link, then "Connected computers: NWS144 ● online".
  8. No sideways scroll at 1440 and 390, light and dark; --shots DIR saves the pictures.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_one_page.py [--shots DIR]"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8657
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SAL, NEW, GSC, VMS, OLD, SP = "SALESIFY MARKETING LLP - (from 1-Apr-25)", "Salesify Marketing LLP 2026-27", "GARG SHEKHAR & COMPANY", "VMS EVENTS PRIVATE LIMITED (2024-25)", "MASTER CAD INFRA", "ALPHA  TRADERS "
D1, D2 = "58d73e82-0000-4000-8000-000000000001", "58d73e82-0000-4000-8000-000000000002"
def dev(i=D1, pc="NWS144", at="ago:0.5", opened=(VMS, GSC, NEW), tally="open"):
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False}
    b = {"at": at, "version": "2.4.5", "computer": pc, "user": "anshul", "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally, "open": list(opened)}
    return {"id": i, "name": pc, "revoked": False, "last_seen": at, "version": "2.4.5", "main_bridge": "go-" + pc, "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": pc, "user": "anshul", "beat": bt, "bridges": {"go-" + pc: b}}}
DEVS = lambda: [dev(), dev(D2, "LAPTOP", at="ago:42", opened=())]
SAL_SEEN = "2026-10-20T17:21:36Z"   # 20-Oct 22:51 IST
def row_(c, cl, d, seen, g=""):
    return {"company": c, "client_id": cl, "device_id": d, "gstin": g, "last_seen": seen, "linked_at": "ago:5" if cl else None, "linked_by": "u-1" if cl else None}
def cos(sal="S1", gsc="GS", vms=None, old=None, new=False, sp=False):
    out = [row_(SAL, sal, D1, SAL_SEEN), row_(GSC, gsc, D1, "ago:1", "09AANFG3202D1ZR"), row_(VMS, vms, D1, "ago:1"), row_(OLD, old, D2, "ago:40")]
    if new: out.append(row_(NEW, None, D1, "ago:0.5"))
    if sp: out.append(row_(SP, None, D2, "ago:3000"))
    return out
SETUP = """([devs, companies, books, ledn]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__devs = fix(devs); window.__calls = window.__calls || [];
  const ids = window.__ids || {};
  window.__companies = fix(companies).map(x => Object.assign(x, {client_id: x.client_id ? (ids[x.client_id] || x.client_id) : null}));
  window.__books = {}; Object.entries(books || {}).forEach(([k, v]) => { window.__books[ids[k] || k] = fix(v); });
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
    if (fn === "tally_company_link") {
      const r = window.__companies.find(r => r.company === a.p_company);
      if (!r) throw new Error("no computer has reported " + a.p_company + " yet; open it in Tally on a connected computer first");
      r.client_id = a.p_client || null; r.linked_at = new Date().toISOString(); r.linked_by = "u-1";
      // the cloud's books follow the link (tally_books.client_id), as the RPC does
      Object.keys(window.__books).forEach(k => { window.__books[k] = (window.__books[k] || []).filter(b => b.company !== a.p_company); });
      return null; }
    if (fn === "tally_status") return copy(window.__books[a.p_client] || []);
    if (fn === "tally_period_status") return {};
    return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  TCloudUp.post = async (body, who) => { window.__calls.push(["post", JSON.parse(JSON.stringify(body)), JSON.parse(JSON.stringify(who || {}))]); return {ok: true, woken: 1, asked: 1}; };
  window.cloudPushNow = async () => {};
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.stops = [];
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs; TLight.st.cos = window.__companies; TLight.st.stops = []; TLight.st.loaded = true;
  TCloud.refreshPane = async () => { TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); };
  TLight.refresh = function () { this.st.devs = window.__devs; this.st.cos = window.__companies; this.st.at = Date.now(); return Promise.resolve(); };
  Object.keys(TCloud.st || {}).forEach(k => { delete TCloud.st[k]; }); S.tcoSync = {}; S.tcoPend = {}; S.tcoErr = {};
  S.firm.tallyHidden = [];
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  return true;
}"""
BOOK = lambda name: [{"book": "bk-" + name[:6], "company": name, "from": "2025-04-01", "to": "2026-10-22", "days": 360, "openAsOn": "2025-03-31", "ledgersAt": "ago:1", "entries": 3400}]
CLIENTS = """() => {
  const mk = (name, gstin, tallyName) => { const c = newCompany({name, gstin: gstin || '', tallyName: tallyName || name}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); return c.id; };
  window.__ids = {S1: mk('Salesify Marketing LLP', '', 'SALESIFY MARKETING LLP - (from 1-Apr-25)'), GS: mk('Garg Shekhar & Company', '09AANFG3202D1ZR', 'GARG SHEKHAR & COMPANY'),
    TA: mk('Testing AAD', '', 'GARG SHEKHAR & COMPANY')};
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
            pg.evaluate(CLIENTS)
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        ID = lambda k: E("(k) => window.__ids[k]", k)
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda kind=None: [c for c in E("window.__calls || []") if kind is None or c[0] == kind]
        links = lambda: calls("tally_company_link")
        def scene(companies, devs=None, books=None, ledn=None):
            E(SETUP, [DEVS() if devs is None else devs, companies, books or {}, ledn or {}]); pg.wait_for_timeout(300)
        def tally_page(guide=None):
            E("(g) => { S.tallyGuide = g || {}; S.tallyFocus = ''; S.tallyTab = 'computers'; S.view = 'home'; navHome('tally'); }", guide); pg.wait_for_timeout(1300)
        def rows(hook="firm"):
            return E("""(h) => [...document.querySelectorAll('#app [data-tco-list=' + h + '] [data-tco-row]')].map(r => ({co: r.getAttribute('data-tco-row'), st: r.getAttribute('data-tco-state'),
                pill: r.querySelector('[data-tco-pill]').getAttribute('data-tco-pill'), ptext: r.querySelector('[data-tco-pill]').getAttribute('data-tco-pill-text'),
                text: r.innerText.replace(/\\s+/g, ' '), act: ((r.querySelector('[data-tco-act]') || {}).innerText || '').trim(), open: r.hasAttribute('data-tco-open'),
                reported: r.getAttribute('data-tco-reported'), linked: r.getAttribute('data-tco-linked'), focus: r.hasAttribute('data-focus')}))""", hook)
        def row(co): return next((r for r in rows() if r["co"] == co), None)
        R = lambda co: '#app [data-tco-list=firm] [data-tco-row="%s"]' % co
        def more(co, item):
            pg.click(R(co) + " [data-tco-more] summary"); pg.wait_for_timeout(250); pg.click(R(co) + " " + item); pg.wait_for_timeout(400)
        def menu(co):
            pg.click(R(co) + " [data-tco-more] summary"); pg.wait_for_timeout(250)
            it = E("(s) => [...document.querySelectorAll(s + ' .bk-menu-list button')].map(b => b.innerText.split('\\n')[0])", R(co))
            pg.keyboard.press("Escape"); E("() => document.querySelectorAll('#app details[open]').forEach(d => d.open = false)"); return it
        def confirm(yes=True):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(600)
        def shot(name, page=None, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); (page or pg).screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
        def client_page(cid, tab):
            E("([c, t]) => { S.view = 'company'; return Promise.resolve(openCompany(c)).then(() => { S.tab = t === 'fromtally' ? 'books' : t; if (t === 'fromtally') S.booksTab = 'import'; render(); }); }", [cid, tab]); pg.wait_for_timeout(1300)

        # ---- 1. unlink, then link again, a company NOT open in Tally (Salesify's old year, last seen 20-Oct)
        s1, gs, ta = ID("S1"), ID("GS"), ID("TA")
        scene(cos(), books={"S1": BOOK(SAL), "GS": BOOK(GSC)})
        E("(c) => TCloud.status(c, true)", s1); pg.wait_for_timeout(200)
        tally_page()
        r = row(SAL)
        ok(r and r["linked"] == s1 and r["pill"] == "notopen" and not r["open"], "1. Salesify's old year, linked, not open in Tally: listed, Disconnected (%s)" % (r and r["ptext"]))
        ok("Open SALESIFY MARKETING LLP - (from 1-Apr-25) in TallyPrime on NWS144." in txt(R(SAL) + " [data-tco-fix]"), "6. Disconnected says the fix in words (%s)" % txt(R(SAL) + " [data-tco-fix]"))
        E("() => { window.__calls = []; }")
        more(SAL, "[data-tco-unlink]"); confirm()
        ok(links() == [["tally_company_link", {"p_company": SAL, "p_client": None}]], "1. Unlink: tally_company_link(company, null) once (%s)" % links())
        r = row(SAL)
        ok(r is not None and r["linked"] == "" and r["pill"] == "notclient", "1. after Unlink it STAYS in the list, marked Not a client (%s)" % (r and r["text"][:120]))
        ok(r and r["act"] == "Link to Salesify Marketing LLP", "1. with one action: 'Link to Salesify Marketing LLP' (%s)" % (r and r["act"]))
        ok(E("(c) => tallyLinkOf(S.companies[c]).state", s1) == "unlinked", "1. the client is Not linked, though its books' copy kept here still names the company (the 24-Oct cause)")
        ok(E("(c) => S.companies[c].tallyName", s1) == "", "4. Unlink cleared the client's Tally name (%r)" % E("(c) => S.companies[c].tallyName", s1))
        shot("1-after-unlink-desktop-light")
        E("() => { window.__calls = []; }")
        pg.click(R(SAL) + " [data-tco-act=link]"); pg.wait_for_timeout(1200)
        ok(links() == [["tally_company_link", {"p_company": SAL, "p_client": s1}]], "1. linked again in ONE click, not open in Tally (%s)" % links())
        r = row(SAL)
        ok(r and r["linked"] == s1 and r["pill"] == "notopen", "1. the row is linked to Salesify Marketing LLP again (%s)" % (r and r["ptext"]))
        ok(E("(c) => tallyLinkOf(S.companies[c]).state !== 'unlinked'", s1), "1. and the client says so")

        # ---- 2. a company open in Tally, not sent to FinCom yet: listed at once, at the top; the click is kept
        scene(cos())
        tally_page()
        rs = rows()
        ok(NEW in [x["co"] for x in rs] and next(x for x in rs if x["co"] == NEW)["reported"] == "no", "2. 'Salesify Marketing LLP 2026-27', open in Tally, not in FinCom's cloud yet: listed at once")
        ok(set(x["co"] for x in rs[:3]) == {NEW, VMS, GSC} and all(x["open"] for x in rs[:3]), "2. the companies open in Tally are at the top (%s)" % [x["co"] for x in rs])
        r = row(NEW)
        ok(r["act"] == "New year of Salesify Marketing LLP · Link", "6. a new year of a linked client: 'New year of Salesify Marketing LLP · Link' (%s)" % r["act"])
        ok("has not sent this company to FinCom yet" in txt(R(NEW) + " [data-tco-unreported]"), "2. it says plainly the computer has not sent it yet (%s)" % txt(R(NEW) + " [data-tco-unreported]"))
        E("() => { window.__calls = []; }")
        pg.click(R(NEW) + " [data-tco-act=year]"); pg.wait_for_timeout(700)
        ok(links() == [] and pg.locator(R(NEW) + " [data-tco-pending]").count() == 1, "2. the click is kept (nothing refused, nothing asked of the cloud yet)")
        shot("2-kept-click-desktop-light")
        # NWS144 sends the company: the link is made by itself
        E("() => { const n = new Date().toISOString(); window.__companies.push({company: %s, client_id: null, device_id: %s, gstin: '', last_seen: n, linked_at: null, linked_by: null}); }" % (json.dumps(NEW), json.dumps(D1)))
        for _ in range(30):
            if links(): break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(800)
        ok(links() == [["tally_company_link", {"p_company": NEW, "p_client": s1}]], "2. once sent, it is linked by itself, to Salesify Marketing LLP, and the old year is NOT unlinked (%s)" % links())
        ok(row(NEW)["linked"] == s1 and row(SAL)["linked"] == s1, "2. both years are Salesify Marketing LLP's")
        ok(row(SAL)["pill"] == "earlier" and "Earlier year" in row(SAL)["text"], "6. the older year says 'Earlier year', not Disconnected (%s)" % row(SAL)["ptext"])
        ok(row(NEW)["pill"] == "connected", "2. the new year: Connected (%s)" % row(NEW)["ptext"])

        # staging, 24-Oct-2026 (the real shape): "Salesify Marketing LLP 2026-27" open in Tally AND in FinCom's cloud, not linked,
        # while Salesify Marketing LLP is linked to "SALESIFY MARKETING LLP - (from 1-Apr-25)": New year of <client> · Link, at once
        scene(cos(new=True)); tally_page()
        r = row(NEW)
        ok(r["reported"] == "yes" and r["act"] == "New year of Salesify Marketing LLP · Link" and row(SAL)["linked"] == s1, "2. staging's case: the new year, in the cloud, not linked: 'New year of Salesify Marketing LLP · Link' (%s)" % r["act"])
        E("() => { window.__calls = []; }")
        pg.click(R(NEW) + " [data-tco-act=year]"); pg.wait_for_timeout(1200)
        ok(links() == [["tally_company_link", {"p_company": NEW, "p_client": s1}]] and row(SAL)["linked"] == s1 and row(SAL)["pill"] == "earlier", "2. one click: linked beside the old year (not moved, nothing asked); the old year 'Earlier year' (%s)" % links())
        scene(cos())   # back to the beat-only new year for what follows
        tally_page()

        # a company never seen before, opened in Tally: on the list within one beat (the beat FinCom's cloud passes on), and in
        # a client's chooser (from "Choose on Tally page")
        BRAND = "BRAND NEW TRADERS (2026-27)"
        E("([d, n]) => { const b = Object.assign({}, window.__devs[0].info.beat); b.open = b.open.concat([n]); b.at = new Date().toISOString(); TLight.beatIn({device: d, beat: b}); }", [D1, BRAND]); pg.wait_for_timeout(700)
        r = row(BRAND)
        ok(r is not None and r["open"] and r["act"] == "Add as client", "2. a brand-new company opened in Tally: listed within one beat, open, Add as client (%s)" % (r and r["text"][:100]))
        tally_page({"step": 4, "cid": ta, "at": 1})
        r = row(BRAND)
        ok(r is not None and r["act"] == "Link to Testing AAD" and rows().index(r) < 4, "2. and in Testing AAD's chooser, among the open ones at the top: 'Link to Testing AAD'")

        # ---- 3. one status, one function
        scene(cos(new=True))
        tally_page()
        g_row = row(GSC)
        client_page(gs, "dash")
        chip = E("() => { const b = document.querySelector('[data-tally-chip-at=title]'); return b ? [b.getAttribute('data-tally-pill'), b.innerText.trim(), b.getAttribute('title')] : null; }")
        ok(chip and chip[0] == g_row["st"] == "connected" and chip[1].endswith("Connected"), "3. the client's title chip: Connected, as its row (%s / %s)" % (chip, g_row["st"]))
        E("() => { S.view = 'home'; navHome('clients'); }"); pg.wait_for_timeout(900)
        cl = E("() => [...document.querySelectorAll('#app [data-tally-chip-at=clients]')].map(b => [b.closest('tr') ? b.closest('tr').innerText.split('\\n')[0] : '', b.getAttribute('data-tally-pill'), b.innerText.trim()])")
        by = {re.split(r"[\t\n]", c[0])[0].strip(): c for c in cl}
        ok(by.get("Garg Shekhar & Company", [0, 0, ""])[1] == "connected", "3. Clients list chip for Garg Shekhar & Company: connected, the same (%s)" % cl)
        ok(by.get("Testing AAD", [0, 0, ""])[1] == "unlinked" and by["Testing AAD"][2].endswith("Not linked"), "3. 'Testing AAD' carries the Tally name GARG SHEKHAR & COMPANY but is Not linked (the cloud's link alone) (%s)" % by.get("Testing AAD"))
        sal_row = None
        ok(by.get("Salesify Marketing LLP", [0, 0, ""])[1] == "notopen", "3. Salesify's chip says its row's state (%s)" % (by.get("Salesify Marketing LLP"),))
        tally_page()
        words = {x["co"]: x["ptext"] for x in rows()}
        client_page(s1, "dash")
        t = E("() => (document.querySelector('[data-tally-chip-at=title]') || {}).title || ''")
        ok(words.get(SAL, "?") in t and words[SAL].startswith("Disconnected — not open in Tally on NWS144"), "3. the title chip's words are the row's words (%r in %r)" % (words.get(SAL), t))

        # ---- 4. every other place is gone
        client_page(gs, "cotally")
        one = txt("#app [data-tally-one]")
        ok(pg.locator("#app [data-tally-link], #app .tlink, #app [data-tally-link-choose], #app [data-tally-link-post]").count() == 0, "4. Client setup: no Tally card (no link, choose, post tick)")
        ok(one.startswith("Tally: GARG SHEKHAR & COMPANY ● Connected") and one.endswith("Open in Tally page"), "4. Client setup: ONE line 'Tally: GARG SHEKHAR & COMPANY ● Connected · Open in Tally page' (%s)" % one)
        shot("4-client-setup-one-line-desktop-light", full=False)
        pg.click("#app [data-tally-one-go]"); pg.wait_for_timeout(1300)
        ok(E("[S.view, S.homeTab]") == ["home", "tally"] and (row(GSC) or {}).get("focus"), "4. Open in Tally page: the Tally page, its row marked")
        client_page(ta, "cotally")
        one = txt("#app [data-tally-one]")
        ok(one == "Tally: ◐ Not linked · Choose on Tally page", "4. a client not linked: 'Tally: ◐ Not linked · Choose on Tally page' (%s)" % one)
        pg.click("#app [data-tally-one-go]"); pg.wait_for_timeout(1300)
        rs = rows()
        ok(len(rs) == 5 and set(x["co"] for x in rs[:3]) == {NEW, VMS, GSC}, "5. from Testing AAD: EVERY company (5), the open ones first (%s)" % [x["co"] for x in rs])
        ok(row(VMS)["act"] == "Link to Testing AAD" and row(NEW)["act"] == "Link to Testing AAD", "5. each not linked: 'Link to Testing AAD' (%s, %s)" % (row(VMS)["act"], row(NEW)["act"]))
        g = row(GSC)
        ok("Linked to Garg Shekhar & Company" in g["text"] and g["act"] == "Move here", "5. open and linked to another client: shown with its client's name and 'Move here' (%s)" % g["text"][:140])
        shot("5-choose-for-client-desktop-light")
        E("() => { window.__calls = []; }")
        pg.click(R(GSC) + " [data-tco-act=move]"); confirm()
        ok(links() == [["tally_company_link", {"p_company": GSC, "p_client": ta}]], "5. Move here: asked once, then moved (%s)" % links())
        scene(cos(new=True))
        client_page(gs, "fromtally")
        ok(pg.locator("#app [data-upload-page]").count() == 1 and pg.locator("#app [data-tally-link-line], #app [data-tally-link], #app [data-tco-list]").count() == 0, "4. Books › From Tally: the upload only, no link or status block")
        shot("4-books-from-tally-desktop-light")
        client_page(gs, "dash")
        ok(pg.locator("#app [data-tally-link-line], #app [data-tally-link]").count() == 0, "4. Overview: no Tally link line")
        E("() => { S.view = 'home'; navHome('clients'); doAct('addCo'); }"); pg.wait_for_timeout(1000)
        ok(pg.locator("#app [data-tco-list=add], #app [data-add-pick]").count() == 0 and pg.locator("#app [data-add-from-tally]").count() == 1, "4. Add client: no Pick from Tally; one button to the Tally page")
        pg.click("#app [data-add-tally-go]"); pg.wait_for_timeout(1200)
        ok(E("[S.view, S.homeTab]") == ["home", "tally"] and pg.locator("#app [data-tco-list=firm]").count() == 1, "4. Add it from the Tally page: the list")
        E("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'tcloud'; render(); }"); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-cloud-unlinked], #app [data-act=reparse]").count() == 0 and "Tally companies and clients" not in pg.inner_text("#app"), "4. Settings: no Tally companies and clients table")
        E("() => { S.view = 'home'; navHome('today'); }"); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-not-linked-open]").count() == 0 and txt("#app [data-not-linked-line]") == "◐ 1 client not linked to Tally", "4. Today: one small chip, no names (%s)" % txt("#app [data-not-linked-line]"))
        tally_page()
        ok(pg.locator("#app [data-tally-clients], #app [data-card-seen], #app p[data-tally-focus], #app h3:text-is('Status')").count() == 0, "4. Tally page: no clients' table, no status block, no 'Seen, not linked', no focus line")
        ok(pg.locator("#app [data-page-more]").count() == 1 and pg.locator("#app [data-bridge-more]").count() == 0, "4. Help & support is there, closed")
        ok(pg.locator("#app [data-connect-step]").count() == 0 and txt("#app [data-connected-line]").startswith("● online") and "Connected computers: NWS144" in txt("#app [data-pc-lines]"),
           "7. a company linked: no steps; 'Connected computers: NWS144 ● online' (%s)" % txt("#app [data-pc-lines]"))
        shot("tally-page-mixed-desktop-light")

        # ---- 5./6. the actions: Add as client, Link to a client…, the ⋯ of a linked row, Sync now, Post entries here
        it = [x for x in menu(GSC) if not x.startswith("Upload older entries")]
        ok(it == ["Sync master", "Sync vouchers", "Post entries here", "Link to another client", "Unlink", "What is in the cloud?", "Read the kept day books again", "Open client"], "6. ⋯ of a linked company (%s)" % it)
        pg.click(R(GSC) + " [data-tco-more] summary"); pg.wait_for_timeout(250); shot("menu-linked-desktop-light", full=False); E("() => document.querySelectorAll('#app details[open]').forEach(d => d.open = false)")
        E("() => { window.__calls = []; S.coId = null; }")
        pg.click(R(GSC) + " [data-tco-sync-now]"); pg.wait_for_timeout(800)
        wk = [c for c in calls("post") if c[1].get("what") == "ledgers"]
        ok(calls("tally_want_update") == [["tally_want_update", {"p_client": gs}]] and len(wk) == 1, "6. Sync now = Sync vouchers (tally_want_update) + Sync master (the ledgers' wake) (%s)" % calls())
        E("() => { window.__calls = []; }")
        more(GSC, "[data-tco-sync-master]"); pg.wait_for_timeout(500)
        ok([c[1].get("what") for c in calls("post")] == ["ledgers"] and calls("tally_want_update") == [["tally_want_update", {"p_client": gs}]], "6. Sync master: the ledgers' wake, and the existing Send ledgers and groups now (tally_want_update)")
        E("() => { window.__calls = []; }")
        more(GSC, "[data-tco-sync-vouchers]")
        ok(calls("tally_want_update") == [["tally_want_update", {"p_client": gs}]] and not calls("post"), "6. Sync vouchers alone: Update now")
        more(GSC, "[data-tco-post-here]"); confirm()
        ok(E("(c) => { const k = S.companies[c], p = choiceGet(k, 'postTo'); return [k.postTo, p && p.state]; }", gs) == [GSC, "confirmed"], "6. Post entries here: the client's confirmed posting company")
        ok("Stop posting here" in menu(GSC), "6. then ⋯ says Stop posting here")
        it = menu(VMS)
        ok(it == ["Link to a client…", "Add as client", "Remove company"][:2] or it == ["Link to a client…", "Add as client"], "5. ⋯ of a company not linked, open: Link to a client…, Add as client (no Remove while open) (%s)" % it)
        E("() => { window.__calls = []; }")
        n0 = E("() => Object.values(S.companies).filter(c => !c.deleted).length")
        pg.click(R(VMS) + " [data-tco-act=add]"); pg.wait_for_timeout(1300)
        vm = E("() => Object.values(S.companies).filter(c => !c.deleted && c.name === 'VMS EVENTS PRIVATE LIMITED').map(c => c.id)")
        ok(len(vm) == 1 and E("() => Object.values(S.companies).filter(c => !c.deleted).length") == n0 + 1 and links() == [["tally_company_link", {"p_company": VMS, "p_client": vm[0]}]],
           "5. Add as client: one client (the period off its name), linked once (%s)" % links())
        E("() => { window.__calls = []; }")
        more(OLD, "[data-tco-link-pick]")
        pg.select_option(R(OLD) + " [data-tco-relink-pick]", ta); pg.click(R(OLD) + " [data-tco-relink]"); pg.wait_for_timeout(1200)
        ok(links() == [["tally_company_link", {"p_company": OLD, "p_client": ta}]], "5. ⋯ Link to a client…: linked to the client chosen (%s)" % links())
        # an open company unlinked stays, at the top
        E("() => { window.__calls = []; }")
        more(GSC, "[data-tco-unlink]"); confirm()
        r = row(GSC)
        ok(r and r["open"] and r["pill"] == "notclient" and rows().index(r) < 3, "2. an open company just unlinked: still listed, at the top, Not a client")
        ok(all(x["pill"] in ("notclient", "connected", "notopen", "offline", "unseen", "earlier") and (x["pill"] == "notclient") == (x["linked"] == "") for x in rows()), "6. Disconnected only for linked companies; the rest say Not a client")

        # ---- 6. Remove company (soft), extra spaces
        scene(cos(new=True, sp=True))
        tally_page()
        r = row(SP)
        ok(r is not None and pg.locator(R(SP) + " [data-tco-spaces]").count() == 1 and "ALPHA TRADERS" in r["text"], "6. a name with extra spaces in Tally: shown collapsed, with 'name has extra spaces in Tally'")
        it = menu(OLD)
        ok("Remove company" in it, "6. ⋯ of a company not linked and not open: Remove company (%s)" % it)
        E("() => { window.__calls = []; }")
        more(OLD, "[data-tco-hide]")
        ok(row(OLD) is None and txt("#app [data-tco-show-hidden]") == "Show hidden (1)" and calls() == [], "6. Remove company: off the list, nothing deleted (no call), 'Show hidden (1)'")
        ok(E("() => S.firm.tallyHidden.length") == 1, "6. kept with the firm's settings")
        pg.click("#app [data-tco-show-hidden]"); pg.wait_for_timeout(400)
        ok(row(OLD) is not None, "6. Show hidden: back in view")
        more(OLD, "[data-tco-unhide]"); pg.click("#app [data-tco-show-hidden]") if pg.locator("#app [data-tco-show-hidden]").count() else None; pg.wait_for_timeout(300)
        ok(row(OLD) is not None and E("() => S.firm.tallyHidden.length") == 0, "6. Show again: back in the list")

        # ---- 7. no link yet: the three steps
        scene(cos(sal=None, gsc=None))
        tally_page()
        g = E("() => [...document.querySelectorAll('#app [data-connect-step]')].map(e => e.getAttribute('data-connect-step'))")
        ok(g == ["install", "open", "add"] and pg.locator("#app [data-connected-line]").count() == 0, "7. nothing linked yet: the three steps (%s)" % g)
        shot("tally-page-steps-desktop-light")

        # ---- 8. phone 390, light and dark: no sideways scroll; pictures
        for scheme in ("light", "dark"):
            for w, h, tag in ((1440, 900, "desktop"), (390, 844, "phone")):
                q = open_page(w, h, scheme)
                q.evaluate(SETUP, [DEVS(), cos(new=False, sp=True), {}, {}]); q.wait_for_timeout(300)
                for nm in ("tally-page", "menu", "client-setup", "books-from-tally"):
                    if nm == "tally-page": q.evaluate("() => { S.tallyGuide = {}; navHome('tally'); }"); q.wait_for_timeout(1300)
                    elif nm == "menu": q.click('#app [data-tco-row="%s"] [data-tco-more] summary' % GSC); q.wait_for_timeout(300)
                    else: q.evaluate("([c, t]) => { S.view = 'company'; return Promise.resolve(openCompany(c)).then(() => { S.tab = t === 'books-from-tally' ? 'books' : 'cotally'; S.booksTab = 'import'; render(); }); }", [q.evaluate("window.__ids.GS"), nm]); q.wait_for_timeout(1300)
                    x = q.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                    ok(x <= 1, "8. %s %s %s: no sideways scroll (%d px)" % (tag, scheme, nm, x))
                    if SHOTS: q.screenshot(path=os.path.join(SHOTS, "%s-%s-%s.png" % (nm, tag, scheme)), full_page=nm != "menu")
                    if nm == "menu": q.evaluate("() => document.querySelectorAll('#app details[open]').forEach(d => d.open = false)")
                if SHOTS:
                    # the unlinked, not-open company with Link to (the 24-Oct case), on this size and theme
                    q.evaluate(SETUP, [DEVS(), cos(sal=None, new=False), {}, {}]); q.evaluate("() => { S.tallyGuide = {}; navHome('tally'); }"); q.wait_for_timeout(1300)
                    q.screenshot(path=os.path.join(SHOTS, "tally-page-unlinked-not-open-%s-%s.png" % (tag, scheme)), full_page=True)
                    q.evaluate("() => { S.view = 'company'; return Promise.resolve(openCompany(window.__ids.TA)).then(() => { S.tab = 'cotally'; render(); }); }"); q.wait_for_timeout(1200)
                    q.screenshot(path=os.path.join(SHOTS, "client-setup-not-linked-%s-%s.png" % (tag, scheme)), full_page=False)
                q.close()
        br.close()
    srv.shutdown()
    print("page errors:", errors[:3]) if errors else None
    ok(not errors, "no page errors (%d)" % len(errors))
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
