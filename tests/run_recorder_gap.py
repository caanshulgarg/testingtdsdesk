"""python3 run_recorder_gap.py - phase 2, the GAP flag (migration 44, item 9: a PC without the add-on). When tally_sync_cursor.gap
is set for the client's book, a red alert (since round 3 of the UI pass, 05-Oct-2026: in the bell, and as the one slim line on
the client's Books page and the Tally page, never on the client's other pages): "<client>: 12 entries made in Tally since …
are not yet in FinCom." with "Upload the Day Book for …", the change numbers ("Tally's change number <tally_altvchid>,
received up to <baseline>") behind its details, and a button "Upload Day Book" that opens Books -> From Tally with the Day
Book dates (S.dbFrom / S.dbTo) filled in from gap.since to today. No gap: nothing. A cloud without the gap column (42703):
nothing, and no error.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_recorder_gap.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8293), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
DEV = "d0000000-0000-4000-8000-000000000001"
GAP = {"tally_altvchid": 512, "recorder_max": 500, "day_max": 480, "start_point": 300, "missing": 12, "missingMax": 12, "since": "2026-10-02T08:35:00Z", "last_match_at": "2026-10-02T08:35:00Z",
       "by_device": {DEV: {"max": 500, "lastAt": "2026-10-02T08:35:00Z"}}, "device": DEV, "at": "2026-10-04T05:00:00Z", "words": "up to 12 changes not received since 02-Oct-2026 14:05"}
WORDS = "up to 12 changes not received since 02-Oct-2026 14:05 (Tally's change number 512, received up to 500)"
SETUP = """async ([gap, old]) => {
  let c = Object.values(S.companies).find(x => x.name === "ZZ Gap Client");
  if (!c){ c = newCompany({name: "ZZ Gap Client", gstin: ""}); c.tallyName = "ZZ GAP"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  window.__gap = gap; window.__old = old || ""; window.__asked = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  TCloud.on = () => true;
  const dev = {id: "%s", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", user: "tally",
    beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open", open: ["ZZ GAP"], companies: [{name: "ZZ GAP", at: new Date().toISOString()}]}}};
  const cos = [{company: "ZZ GAP", client_id: c.id, device_id: dev.id}];
  Cloud.api = async (p) => {
    window.__asked.push(p);
    if (/^tally_devices/.test(p)) return [dev];
    if (/^tally_books/.test(p)) return [{book_id: "bk1", client_id: c.id, company: "ZZ GAP"}];
    if (/^tally_sync_cursor/.test(p)){
      if (/gap/.test(p) && window.__old) throw new Error(window.__old);
      return [{book_id: "bk1", state: "ok", gap: window.__gap, gap_at: window.__gap ? "2026-10-02T09:00:00Z" : null, last_match_at: "2026-10-02T08:35:00Z"}];
    }
    if (/^tally_companies/.test(p)) return cos;
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async () => null;
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: [dev], cos};
  if (typeof Rec === "object") Rec.gaps = {};
  S.dbFrom = ""; S.dbTo = "";
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  if (S.view !== "company" || S.coId !== c.id) await openCompany(c.id);
  S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  goClient("dash");
  return c.id;
}""" % DEV
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({})))
    pg.goto("http://localhost:8293/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    cid = E(SETUP, [GAP, ""]); pg.wait_for_timeout(1500)
    BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return []; if (!document.querySelector('[data-alerts-panel]')) b.click();
      return [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({sev: e.getAttribute('data-sev'), text: (e.querySelector('[data-alert-text]') || {}).innerText || '',
        fix: (e.querySelector('[data-alert-fix]') || {}).innerText || '', act: (e.querySelector('[data-alert-act]') || {}).innerText || '', details: (e.querySelector('[data-alert-details]') || {}).textContent || ''})); }"""
    shut = lambda: E("() => { S.alertsOpen = false; render(); }")
    E("() => AlertHub.refresh(true)"); pg.wait_for_timeout(1200)
    items = [x for x in E(BELL) if "ZZ Gap Client" in x["text"]]
    g = items[0] if items else {"sev": "", "text": "", "fix": "", "act": "", "details": ""}
    ok(len(items) == 1 and g["text"].startswith("ZZ Gap Client: 12 entries made in Tally since") and g["text"].endswith("are not yet in FinCom."), "the gap: one alert in the bell (%s)" % g["text"])
    ok(g["sev"] == "bad" and "Upload the Day Book for" in g["fix"] and g["act"] == "Upload Day Book", "red, with what to do and its button (%s | %s)" % (g["fix"], g["act"]))
    ok("Tally's change number 512, received up to 500" in g["details"], "the change numbers behind its details (%s)" % g["details"][:120])
    shut()
    ok(pg.locator("#app [data-gap-line], #app [data-alert-line]").count() == 0 and "not yet in FinCom" not in txt("#app"), "nothing on the client's dashboard")
    E("() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(800)
    gl = txt("#app [data-alert-line]")
    ok(gl.startswith("ZZ Gap Client: 12 entries made in Tally") and pg.locator("#app [data-alert-line]").count() == 1, "the client's books page: the one slim line (%s)" % gl)
    btn = pg.locator("#app [data-alert-line] [data-alert-act]")
    ok(btn.count() == 1 and btn.inner_text().strip() == "Upload Day Book", "with the button 'Upload Day Book'")
    btn.click(); pg.wait_for_timeout(1200)
    today = E("(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()")
    since = E("(() => { const d = new Date('2026-10-02T08:35:00Z'); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()")
    ok(E("S.tab") == "books" and E("booksTab()") == "import", "the button opens Books -> From Tally (%s / %s)" % (E("S.tab"), E("booksTab()")))
    ok(E("S.dbFrom") == since and E("S.dbTo") == today, "the Day Book dates filled in: from %s (gap.since) to %s (today) (%s .. %s)" % (since, today, E("S.dbFrom"), E("S.dbTo")))
    ok(pg.input_value('#app input[aria-label="Day book from"]') == since and pg.input_value('#app input[aria-label="Day book to"]') == today, "the Day Book's date boxes show them")
    # ---- the Tally page: the one slim line
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    tl = txt("#app [data-alert-line]")
    ok("ZZ Gap Client: 12 entries made in Tally" in tl and pg.locator("#app [data-alert-line] [data-alert-act]").count() == 1, "the Tally page: the slim line with its button (%s)" % tl)
    E("() => { S.dbFrom = ''; S.dbTo = ''; }")
    pg.locator("#app [data-alert-line] [data-alert-act]").first.click(); pg.wait_for_timeout(1500)
    ok(E("S.view") == "company" and E("S.coId") == cid and E("booksTab()") == "import" and E("S.dbFrom") == since, "from the Tally page: the client opens on From Tally with the dates (%s %s)" % (E("S.view"), E("S.dbFrom")))
    # ---- no gap: nothing
    E(SETUP, [None, ""]); pg.wait_for_timeout(1500); E("() => AlertHub.refresh(true)"); pg.wait_for_timeout(1200)
    ok(not [x for x in E(BELL) if "ZZ Gap Client" in x["text"]], "no gap: no alert"); shut()
    E("() => navHome('tally')"); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-alert-line]").count() == 0, "no gap: no line on the Tally page")
    # ---- a cloud without the gap column (42703): nothing, no error
    E(SETUP, [GAP, "column tally_sync_cursor.gap does not exist (42703)"]); pg.wait_for_timeout(1500); E("() => AlertHub.refresh(true)"); pg.wait_for_timeout(1200)
    ok(not [x for x in E(BELL) if "ZZ Gap Client" in x["text"]] and any("gap" in a for a in E("window.__asked") if a.startswith("tally_sync_cursor")), "a 42703 on the gap column: no alert (asked, quietly refused)"); shut()
    E("() => navHome('tally')"); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-alert-line]").count() == 0 and "42703" not in txt("#app"), "the Tally page: no line either")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
