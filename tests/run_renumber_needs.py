"""python3 run_renumber_needs.py - 2.4.0 review MEDIUM (next-renumber): the renumbering alert reaches the owner. FinCom
Bridge says "N entries may have been renumbered in <company>; upload the Day Book from <date>" (renumber.go: entries it
could not read again after an entry was inserted or deleted in Tally); tally-ingest keeps it on the computer's beat
(info.beat.renumberAlerts, tests/run_renumber_list.py 6). FinCom shows it, through the one shared classifier (Rec.flow,
src/js/61; FinCom 2.3.5), as:
  - a "Needs you" item on Sync activity: "<company> · <date>: N entries may have been renumbered in Tally ..." with ONE
    action "Upload the Day Book from <date>" (Books -> From Tally, from that day to today);
  - one amber item in the bell with the same action;
  - "more than N" when the bridge said more; the earliest date when two computers or two alerts say it for the company;
  - gone when the bridge no longer carries it (7 days on the bridge).
Offline, FinCom's cloud made up in the page (alerts_seed.SETUP). Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_renumber_needs.py"""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
from alerts_seed import dev, SETUP

CO = "GARG SHEKHAR & COMPANY"
def ra(n=3, frm="20261005", more=False, at="ago:30"):
    return {"company": CO, "words": ("more than %d entries" % n if more else "%d entries" % n) + " may have been renumbered in " + CO + "; upload the Day Book from 05-Oct-2026",
            "n": n, "more": more, "from": frm, "type": "Receipt", "at": at}
def withAlerts(alerts):
    d = dev(recording=True)
    d["info"]["beat"]["renumberAlerts"] = alerts
    return d
BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  return [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), fix: (e.querySelector('[data-alert-fix]') || {innerText: ''}).innerText.trim(),
    act: (e.querySelector('[data-alert-act]') || {innerText: ''}).innerText.trim()})); }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
NEEDS = """() => [...document.querySelectorAll('#app [data-sync-needs] [data-needs-group]')].map(e => ({key: e.getAttribute('data-needs-group'),
  text: (e.querySelector('[data-needs-text]') || {innerText: ''}).innerText.trim(), act: [...e.querySelectorAll('button[data-needs-act]')].map(b => b.innerText.trim())}))"""
srv = http.server.ThreadingHTTPServer(("localhost", 8357), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 800}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8357/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(devs, role="owner"):
        cid = E(SETUP, [{"devs": devs, "alerts": [], "gap": None}, role])
        E("() => { S.tallyTab = 'activity'; navHome('tally'); }"); pg.wait_for_timeout(1800)
        E("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); render(); }"); pg.wait_for_timeout(1200)
        return cid
    # ---- 1. Sync activity: one "Needs you" item with its one action
    cid = scene([withAlerts([ra()])])
    nd = [x for x in E(NEEDS) if x["key"].startswith("renumber|")]
    ok(len(nd) == 1 and CO in nd[0]["text"] and "3 entries may have been renumbered in Tally" in nd[0]["text"], "Sync activity: one Needs you item for the company, in plain words (%s)" % nd)
    ok(nd and nd[0]["act"] == ["Upload the Day Book from 05-Oct-2026"], "its one action: Upload the Day Book from 05-Oct-2026 (%s)" % (nd[0]["act"] if nd else None))
    # ---- 2. the bell: one amber item, the same action
    b = E(BELL) or []
    rn = [x for x in b if x["key"].startswith("renumber:")]
    ok(len(rn) == 1 and rn[0]["sev"] == "warn" and "renumbered" in rn[0]["text"] and rn[0]["act"] == "Upload the Day Book from 05-Oct-2026" and rn[0]["fix"].startswith("Needs you"),
       "the bell: one amber Needs you item with the same action (%s)" % rn)
    E(CLOSE)
    # ---- 3. the action: Books -> From Tally, from that day to today
    E("""() => { const b = document.querySelector('#app [data-needs-group^="renumber|"] button[data-needs-act]'); if (b) b.click(); }"""); pg.wait_for_timeout(1500)
    st = E("() => ({from: S.dbFrom, to: S.dbTo, co: S.coId, view: S.view, today: Rec.ymdLocal(Date.now())})")
    ok(st["from"] == "2026-10-05" and st["to"] == st["today"] and st["co"] == cid and st["view"] == "company", "the action opens the Day Book upload from 05-Oct-2026 to today for that client (%s)" % st)
    # ---- 4. two computers, the second saying more and an earlier date: one item, the earliest date, "more than"
    d2 = withAlerts([ra(500, "20261003", True)]); d2["id"] = "d0000000-0000-4000-8000-000000000002"; d2["name"] = "Laptop"
    scene([withAlerts([ra()]), d2])
    nd = [x for x in E(NEEDS) if x["key"].startswith("renumber|")]
    ok(len(nd) == 1 and "more than 503 entries" in nd[0]["text"] and nd[0]["act"] == ["Upload the Day Book from 03-Oct-2026"], "two alerts for the company: one item, more than, the earliest date (%s)" % nd)
    # ---- 5. gone when the bridge no longer carries it
    scene([dev(recording=True)])
    ok(not [x for x in E(NEEDS) if x["key"].startswith("renumber|")], "no alert on the beat: no Needs you item")
    b = E(BELL) or []
    ok(not [x for x in b if x["key"].startswith("renumber:")], "and nothing in the bell")
    E(CLOSE)
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
