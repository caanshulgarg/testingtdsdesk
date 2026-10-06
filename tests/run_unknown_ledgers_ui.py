"""python3 run_unknown_ledgers_ui.py - the owner (06-Oct-2026): "An entry using an unknown ledger is applied anyway, with nothing
flagged. Until 2.3.1 is out, flag these on the page in plain words so they are visible." Migration 56's
tally_unknown_ledger_entries(p_book) (members read; p_book null: every book of the firm) lists the live entries whose lines
name a ledger FinCom does not have; the page says, one sentence an entry and ledger:
  "<type> <number> of <date> uses the ledger '<name>', which FinCom does not have yet. It is in the books; the ledger's group
   is unknown until the next ledger list or bridge 2.3.1."
  1. the Tally page's Sync activity: every client's (with the client's name), or the client picked only; read with
     p_book null;
  2. a client's Books page: that client's only;
  3. none: nothing shown; before migration 56 (the function missing, PGRST202): nothing shown, no error, the rest as before.
Offline, FinCom's cloud made up in the page (run_sync_activity's SETUP; alerts_seed's and run_held_books' books).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_unknown_ledgers_ui.py
RED (before the change): no such list anywhere on the page."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
import alerts_seed
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SYNC_SETUP = part(os.path.join(HERE, "run_sync_activity.py"), "SETUP").replace("\\\\.", "\\.")
BOOKS = part(os.path.join(HERE, "run_held_books.py"), "BOOKS").replace("\\\\.", "\\.")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8396), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
D1 = "d0000000-0000-4000-8000-000000000001"
DEVS = [{"id": D1, "name": "NWS144", "revoked": False, "last_seen": "ago:0.3", "version": "2.3.0", "main_bridge": "go-1",
         "info": {"computer": "NWS144", "user": "tally", "beat": {"at": "ago:0.3", "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ TEST"], "paused": False},
                  "bridges": {"go-1": {"at": "ago:0.3", "version": "2.3.0", "computer": "NWS144", "tally": True, "tallyState": "open", "open": ["ZZ TEST"]}}}, "created_at": "2026-09-01T00:00:00Z"}]
LINES = [{"id": 201, "client_id": "CID", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "ZZ TEST", "line_id": "L201", "event": "created", "object_guid": "g-201", "alter_id": 701,
          "vch_type": "Journal", "vch_no": "J-2", "vch_date": "2026-09-02", "saved_at": "ago:3", "received_at": "ago:3", "applied_at": "ago:3", "state": "applied", "held_why": None, "ledgers": []}]
def say(t, no, d, name): return "%s %s of %s uses the ledger '%s', which FinCom does not have yet. It is in the books; the ledger's group is unknown until the next ledger list or bridge 2.3.1." % (t, no, d, name)
S1 = say("Journal", "J-2", "02-Sep-2026", "New Party Pvt Ltd")
S2 = say("Journal", "J-3", "03-Sep-2026", "Old Ledger")
S3 = say("Journal", "J-3", "03-Sep-2026", "Another New One")
S9 = say("Sales", "S-9", "09-Sep-2026", "Their Party")
# the rows as tally_unknown_ledger_entries answers them (PostgREST: text[] as a JSON array)
def rows(cid, other): return [{"book_id": "b1", "client_id": cid, "guid": "g-3", "vtype": "Journal", "vno": "J-3", "day": "2026-09-03", "ledgers": ["Another New One", "Old Ledger"]},
                              {"book_id": "b1", "client_id": cid, "guid": "g-2", "vtype": "Journal", "vno": "J-2", "day": "2026-09-02", "ledgers": ["New Party Pvt Ltd"]},
                              {"book_id": "b2", "client_id": other, "guid": "g-9", "vtype": "Sales", "vno": "S-9", "day": "2026-09-09", "ledgers": ["Their Party"]}]
STUB = """([rows, fail]) => {
  window.__unk = rows; window.__unkFail = fail || ""; window.__unkAsked = [];
  const rpc = TCloud.rpc;
  TCloud.rpc = async (fn, a) => {
    if (fn === "tally_unknown_ledger_entries"){ window.__unkAsked.push(JSON.parse(JSON.stringify(a || {}))); if (window.__unkFail) throw new Error(window.__unkFail); return JSON.parse(JSON.stringify(window.__unk)); }
    return rpc(fn, a); };
  Rec.unk = {};
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1500, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.3.0", "url": "https://x/a.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8396/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    alltxt = lambda s: E("(s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\\s+/g, ' ').trim())", s)
    def activity():
        E("() => { navHome('tally'); S.tallyTab = 'activity'; render(); }"); pg.wait_for_timeout(1500)
    # ---- 1. Sync activity: every client's
    cid = E(SYNC_SETUP, ["owner", DEVS, LINES, ""]); pg.wait_for_timeout(300)
    other = E("() => { const c = newCompany({name: 'ZZ Other Client', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; }")
    E(STUB, [rows(cid, other), ""])
    activity()
    ok(E("window.__unkAsked") and E("window.__unkAsked")[0] == {"p_book": None}, "1. read once through tally_unknown_ledger_entries with p_book null (every book of the firm) (%s)" % E("window.__unkAsked"))
    lines = alltxt('#app [data-unknown-ledgers="activity"] [data-unknown-ledger]')
    ok(len(lines) == 4 and lines[0].startswith(S3) and lines[1].startswith(S2) and lines[2].startswith(S1) and lines[3].startswith(S9), "1. Sync activity: one sentence an entry and ledger, in plain words (%s)" % lines)
    ok(all(l.endswith("(ZZ Test Client)") for l in lines[:3]) and lines[3].endswith("(ZZ Other Client)"), "1. every client's, each with the client's name")
    head = alltxt('#app [data-unknown-ledgers="activity"] b')
    ok(head == ["3 entries use a ledger FinCom does not have yet"], "1. the heading counts the entries (%s)" % head)
    ok(len(alltxt("#app [data-sync-line]")) == 1, "1. the lines of Sync activity are there as before")
    # the client picked: its own only
    E("(id) => { S.syncClient = id; Rec.act.at = 0; render(); }", cid); pg.wait_for_timeout(1000)
    lines = alltxt('#app [data-unknown-ledgers="activity"] [data-unknown-ledger]')
    ok(lines == [S3, S2, S1], "1. a client picked: that client's only, without the name (%s)" % lines)
    E("() => { S.syncClient = ''; render(); }"); pg.wait_for_timeout(300)
    # ---- 3. none / before migration 56
    E(STUB, [[], ""]); activity()
    ok(E("document.querySelectorAll('#app [data-unknown-ledgers]').length") == 0, "3. none: nothing shown")
    E(STUB, [[], "Could not find the function public.tally_unknown_ledger_entries(p_book) in the schema cache (PGRST202)"]); activity()
    ok(E("document.querySelectorAll('#app [data-unknown-ledgers]').length") == 0 and len(alltxt("#app [data-sync-line]")) == 1 and "PGRST202" not in pg.inner_text("#app"),
       "3. before migration 56 (function missing): nothing shown, no error, Sync activity as before")
    # ---- 2. a client's Books page
    gcid = E(alerts_seed.SETUP, [{"devs": [alerts_seed.dev(recording=True)], "alerts": [], "gap": None, "lines": []}, "owner"])
    E(BOOKS, gcid); pg.wait_for_timeout(300)
    E(STUB, [rows(gcid, other), ""])
    E("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'mis'; S.misTab = 'pl'; render(); }"); pg.wait_for_timeout(1500)
    lines = alltxt('#app [data-unknown-ledgers="books"] [data-unknown-ledger]')
    ok(lines == [S3, S2, S1], "2. the client's Books page: its own entries in plain words, not another client's (%s)" % lines)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
