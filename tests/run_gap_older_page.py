"""python3 run_gap_older_page.py - the page's words for a recorder gap (next-fix-gap-after-post, migration 182). Staging,
13-Nov-2026, Client CL: the gap's own days (12-, 13-Nov) were read and match Tally, yet the page asked "Upload the Day Book
for 12-Nov to 13-Nov" (empty in Tally: it cannot help), and a stale "Checking with Tally" stayed on another book. Now:
  1. a gap that says older (182: its own days match; the changes are on older dates): the bell says "<client>: Changes were
     made in Tally on older dates." and "Upload the Day Book from 01-Apr-2026 to today."; its button fills in that day;
     Books > From Tally's "Days that need a Day Book" has that row (from that day to today), never the gap's own days.
  2. checking counted only until checkUntil (182) or, a gap written before 182, an hour after its last check (gap.at):
     after it, the upload line, not "Checking with Tally"; before it, "Checking with Tally" (no button).
Made-up client only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gap_older_page.py"""
import json, os, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8296), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
DEV = "d0000000-0000-4000-8000-000000000001"
GAP0 = {"tally_altvchid": 512, "recorder_max": 500, "day_max": 480, "start_point": 300, "missing": 12, "missingMax": 12, "since": "2026-10-02T08:35:00Z", "last_match_at": "2026-10-02T08:35:00Z",
       "by_device": {DEV: {"max": 500, "lastAt": "2026-10-02T08:35:00Z"}}, "device": DEV, "at": "2026-10-04T05:00:00Z", "words": "up to 12 changes not received since 02-Oct-2026 14:05"}
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
iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%SZ")
NOW = datetime.datetime.utcnow()
OLDER = {"from": "2026-04-01", "say": "Changes were made in Tally on older dates.", "fix": "Upload the Day Book from 01-Apr-2026 to today."}
def G(**k): g = dict(GAP0); g.update(k); return g
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({})))
    pg.goto("http://localhost:8296/"); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return []; if (!document.querySelector('[data-alerts-panel]')) b.click();
      return [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({sev: e.getAttribute('data-sev'), text: (e.querySelector('[data-alert-text]') || {}).innerText || '',
        fix: (e.querySelector('[data-alert-fix]') || {}).innerText || '', act: (e.querySelector('[data-alert-act]') || {}).innerText || ''})); }"""
    shut = lambda: E("() => { S.alertsOpen = false; render(); }")
    def bell(gap):
        E(SETUP, [gap, ""]); pg.wait_for_timeout(1500); E("() => AlertHub.refresh(true)"); pg.wait_for_timeout(1200)
        items = [x for x in E(BELL) if "ZZ Gap Client" in x["text"]]
        return items[0] if len(items) == 1 else {"sev": "", "text": "(%d alerts)" % len(items), "fix": "", "act": ""}

    print("== 1. the gap's own days match: changes on older dates")
    g = bell(G(checking=False, older=OLDER))
    ok(g["text"] == "ZZ Gap Client: Changes were made in Tally on older dates.", "1. the bell says so plainly (%s)" % g["text"])
    ok(g["fix"] == "Upload the Day Book from 01-Apr-2026 to today." and g["act"] == "Upload Day Book" and g["sev"] == "bad", "1. from the first day of the book's year to today, with its button (%s | %s)" % (g["fix"], g["act"]))
    ok("02-Oct" not in g["fix"] and "04-Oct" not in g["fix"], "1. never the gap's own days (%s)" % g["fix"])
    shut()
    E("() => { S.tab = 'books'; S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(800)
    pg.locator("#app [data-alert-line] [data-alert-act]").click(); pg.wait_for_timeout(1200)
    ok(E("S.dbFrom") == "2026-04-01", "1. its button fills in 01-Apr-2026 (%s)" % E("S.dbFrom"))
    row = txt('#app [data-need-day="2026-04-01"]')
    ok("Changes were made in Tally on older dates. Upload the Day Book from 01-Apr-2026 to today." in row, "1. From Tally: the row from that day (%s)" % row)
    ok(pg.locator('#app [data-need-day="2026-10-02"]').count() == 0, "1. no row for the gap's own days")

    print("== 2. checking counted until checkUntil")
    g = bell(G(checking=True, checkUntil=iso(NOW - datetime.timedelta(hours=2))))
    ok(g["text"].startswith("ZZ Gap Client: 12 entries made in Tally since") and g["act"] == "Upload Day Book", "2. checkUntil passed: the upload line, not a stale 'Checking with Tally' (%s)" % g["text"]); shut()
    g = bell(G(checking=True, at=iso(NOW - datetime.timedelta(hours=2))))
    ok(g["text"].startswith("ZZ Gap Client: 12 entries made in Tally since"), "2. a gap written before 182, last checked 2 hours ago: the upload line (%s)" % g["text"]); shut()
    g = bell(G(checking=True, checkUntil=iso(NOW + datetime.timedelta(minutes=30))))
    ok(g["text"] == "ZZ Gap Client: Checking with Tally\u2026 (no action needed)" and not g["act"], "2. (guard) before checkUntil: Checking with Tally, no button (%s)" % g["text"]); shut()
    g = bell(G(checking=True, at=iso(NOW - datetime.timedelta(minutes=5))))
    ok(g["text"] == "ZZ Gap Client: Checking with Tally\u2026 (no action needed)", "2. (guard) a gap written before 182, checked 5 minutes ago: Checking with Tally (%s)" % g["text"]); shut()
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
