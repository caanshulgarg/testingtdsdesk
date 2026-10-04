"""python3 run_recorder_gap.py - phase 2, the GAP flag (migration 44, item 9: a PC without the add-on). When tally_sync_cursor.gap
is set for the client's book, a red line on the client's pages and on the Tally page: gap.words + " (Tally's change number
<tally_altvchid>, received up to <baseline>)" and a button "Upload the Day Book for these days" that opens Books -> From Tally
with the Day Book dates (S.dbFrom / S.dbTo) filled in from gap.since to today. No gap: nothing. A cloud without the gap column
(42703): nothing, and no error.
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
    gl = txt("#app [data-gap-line]")
    ok(gl.startswith(WORDS), "the client's page: the red line '%s' (%s)" % (WORDS, gl))
    ok(pg.locator("#app [data-gap-line].bad, #app .bad [data-gap-line], #app [data-gap-line] .bad").count() >= 1 or "bad" in (pg.get_attribute("#app [data-gap-line]", "class") or ""), "it is red (bad)")
    btn = pg.locator("#app [data-gap-line] [data-gap-upload]")
    ok(btn.count() == 1 and btn.inner_text().strip() == "Upload the Day Book for these days", "with the button 'Upload the Day Book for these days'")
    E("() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(800)
    ok(txt("#app [data-gap-line]").startswith(WORDS), "the same line on the client's books pages")
    btn.click(); pg.wait_for_timeout(1200)
    today = E("(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()")
    since = E("(() => { const d = new Date('2026-10-02T08:35:00Z'); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()")
    ok(E("S.tab") == "books" and E("booksTab()") == "import", "the button opens Books -> From Tally (%s / %s)" % (E("S.tab"), E("booksTab()")))
    ok(E("S.dbFrom") == since and E("S.dbTo") == today, "the Day Book dates filled in: from %s (gap.since) to %s (today) (%s .. %s)" % (since, today, E("S.dbFrom"), E("S.dbTo")))
    ok(pg.input_value('#app input[aria-label="Day book from"]') == since and pg.input_value('#app input[aria-label="Day book to"]') == today, "the Day Book's date boxes show them")
    # ---- the Tally page: the same line under the client
    E("() => navHome('tally')"); pg.wait_for_timeout(1500)
    tl = txt("#app [data-client-lines] [data-gap-line]") or txt("#app [data-gap-line]")
    ok(WORDS in tl and pg.locator("#app [data-gap-line] [data-gap-upload]").count() >= 1, "the Tally page: the gap line with its button (%s)" % tl)
    # the button from the Tally page opens the client
    E("() => { S.dbFrom = ''; S.dbTo = ''; }")
    pg.locator("#app [data-gap-line] [data-gap-upload]").first.click(); pg.wait_for_timeout(1500)
    ok(E("S.view") == "company" and E("S.coId") == cid and E("booksTab()") == "import" and E("S.dbFrom") == since, "from the Tally page: the client opens on From Tally with the dates (%s %s)" % (E("S.view"), E("S.dbFrom")))
    # ---- no gap: nothing
    E(SETUP, [None, ""]); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-gap-line]").count() == 0, "no gap: no line on the client's page")
    E("() => navHome('tally')"); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-gap-line]").count() == 0, "no gap: no line on the Tally page")
    # ---- a cloud without the gap column (42703): nothing, no error
    E(SETUP, [GAP, "column tally_sync_cursor.gap does not exist (42703)"]); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-gap-line]").count() == 0 and any("gap" in a for a in E("window.__asked") if a.startswith("tally_sync_cursor")), "a 42703 on the gap column: no line (asked, quietly refused)")
    E("() => navHome('tally')"); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-gap-line]").count() == 0, "the Tally page: no line either")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
