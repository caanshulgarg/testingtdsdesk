"""python3 run_held_block_ui.py - the owner, 31-Oct-2026 (a "Needs you" row per day for lines held after his Day Book upload,
plus "19 entries may have been renumbered"): "there should be an option to update the Day Book from there only, and after
the update it should close the error." Migration 136 checks those days with Tally by itself; Sync activity says it in ONE
block per company (app/src/parts/HeldBlock.jsx):
  1. one block for the company, not a row per day: "<company>: 5 changes saved in Tally between 05-Oct and 07-Oct are not
     yet in FinCom. FinCom is checking them with Tally now (40% · about 3 min) — or upload one Day Book for 05-Oct-2026 to
     <today>"; the renumbering item and the lines "waiting for the entry's details" folded into it; ONE button, Upload Day
     Book; "Show days" holds the day rows; one line says why.
  2. the button opens the client's Day Book upload with that period preset.
  3. the check stopped (Tally busy), or reading older entries off: said, the upload still offered.
  4. lines settled (live, no reload): the block counts down, then leaves; the renumbering item leaves once 136 says its days
     are checked; nothing is left in "Needs you".
  5. a company with only a renumbering item keeps it as it was (Rec.renumberNeeds, its own action).
Offline, FinCom's cloud made up in the page (alerts_seed.SETUP), made-up books. Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_held_block_ui.py"""
import os, sys, json, threading, functools, http.server, datetime
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
from alerts_seed import dev, SETUP, D1

CO = "GARG SHEKHAR & COMPANY"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NOG = "no entry GUID on the line: FinCom cannot tell which entry was deleted, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date"
WAIT = "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book"
def ln(i, ev, day, why, guid=None):
    return {"id": i, "client_id": "G", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": CO, "line_id": "L%d" % i, "event": ev, "object_guid": guid,
            "alter_id": 8400 + i, "vch_type": "Sales", "vch_no": "", "vch_date": day, "saved_at": "ago:60", "received_at": "ago:60", "applied_at": None, "state": "held", "held_why": why, "ledgers": []}
LINES = [ln(1, "deleted", "2026-10-05", NOG % "05-Oct-2026"), ln(2, "deleted", "2026-10-05", NOG % "05-Oct-2026"), ln(3, "deleted", "2026-10-07", NOG % "07-Oct-2026"),
         ln(4, "altered", "2026-10-06", WAIT, "g-4"), ln(5, "altered", "2026-10-06", WAIT, "g-5")]
def ra(frm="20261006"):
    return {"company": CO, "words": "19 entries may have been renumbered in " + CO + "; upload the Day Book from 06-Oct-2026", "n": 19, "more": False, "from": frm, "type": "Sales", "at": "2026-10-30T16:22:12"}
def withAlerts(alerts):
    d = dev(recording=True); d["info"]["beat"]["renumberAlerts"] = alerts; return d
def status(state="checking", total=10, done=4, eta=3, words=None, checked=False, held=5, fetch=True, frm="20261005", why=None):
    return {"ok": True, "books": [{"book": "b1", "client": "G", "company": CO, "held": held, "deletes": 3, "entries": 2, "from": frm, "to": "20261007", "days": [],
            "check": {"total": total, "done": done, "waiting": total - done, "upload": 0, "etaMin": eta, "state": state, "words": words, "why": why}, "fetchOn": fetch,
            "renumber": [{"from": "20261006", "at": "2026-10-30T10:52:12+00:00", "n": 19, "more": False, "checked": checked}]}]}
HELD = """(st) => { window.__held = st; const cid = Object.values(S.companies).find(x => x.name === "GARG SHEKHAR & COMPANY").id;
  window.__held.books.forEach(b => b.client = cid);
  const rpc = TCloud.rpc; if (!TCloud.__heldWrapped){ TCloud.__heldWrapped = true; TCloud.rpc = async (fn, a) => fn === "tally_held_status" ? JSON.parse(JSON.stringify(window.__held)) : rpc(fn, a); }
  if (Rec.heldReload) Rec.heldReload(); render(); }"""
BLOCK = """() => [...document.querySelectorAll('#app [data-sync-needs] [data-held-block]')].map(e => ({co: e.getAttribute('data-held-block'),
  text: e.querySelector('[data-held-text]').innerText.trim(), btns: [...e.querySelectorAll('button:not([data-alert-clear])')].map(b => b.innerText.trim()),
  days: [...e.querySelectorAll('[data-held-day]')].map(d => d.getAttribute('data-held-day')), why: (e.querySelector('[data-held-why]') || {innerText: ''}).innerText.trim()}))"""
GROUPS = "() => [...document.querySelectorAll('#app [data-sync-needs] [data-needs-group]')].map(e => e.getAttribute('data-needs-group'))"
srv = http.server.ThreadingHTTPServer(("localhost", 8361), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 800}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8361/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(devs, lines, st, role="owner"):
        cid = E(SETUP, [{"devs": devs, "alerts": [], "gap": None, "lines": lines}, role])
        E("() => { TCloud.__heldWrapped = false; Rec.act = {}; S.syncClient = ''; S.syncFilter = 'all'; S.tallyTab = 'activity'; navHome('tally'); }"); pg.wait_for_timeout(1500)
        E(HELD, st); pg.wait_for_timeout(1500)
        return cid
    today = E("() => Rec.ymdLocal(Date.now())"); td = datetime.date.fromisoformat(today); tdl = "%02d-%s-%d" % (td.day, MON[td.month - 1], td.year)
    # ---- 1. one block
    cid = scene([withAlerts([ra()])], LINES, status())
    bl = E(BLOCK)
    want = CO + ": 5 changes saved in Tally between 05-Oct and 07-Oct are not yet in FinCom. FinCom is checking them with Tally now (40% · about 3 min) — or upload one Day Book for 05-Oct-2026 to " + tdl
    ok(len(bl) == 1 and bl[0]["text"] == want, "1. one block for the company in plain words (%s)" % [b["text"] for b in bl])
    ok(bl and bl[0]["btns"] == ["Upload Day Book"], "1. ONE button: Upload Day Book (%s)" % (bl[0]["btns"] if bl else None))
    ok(E(GROUPS) == [], "1. no row per day, no separate renumbering row (%s)" % E(GROUPS))
    ok(pg.locator("#app [data-sync-fetching]").count() == 0, "1. the lines waiting for their details are in the block, not 'being fetched'")
    ok(bl and sorted(bl[0]["days"]) == ["2026-10-05", "2026-10-07", "renumber"], "1. Show days: the day rows and the renumbering words (%s)" % (bl[0]["days"] if bl else None))
    ok(bl and "Tally saved changes FinCom had not read yet" in bl[0]["why"], "1. one line says why")
    ok(not pg.locator("#app [data-held-days]").first.evaluate("e => e.open"), "1. the days folded")
    # ---- 2. the button
    pg.click("#app [data-held-upload]"); pg.wait_for_timeout(1500)
    st = E("() => ({from: S.dbFrom, to: S.dbTo, co: S.coId, view: S.view})")
    ok(st == {"from": "2026-10-05", "to": today, "co": cid, "view": "company"}, "2. opens the client's Day Book upload with the period preset (%s)" % st)
    # ---- 3. stopped, off
    scene([withAlerts([ra()])], LINES, status("stopped", words="FinCom stopped reading from Tally: Tally was busy."))
    t3 = (E(BLOCK) or [{}])[0].get("text", "")
    ok("FinCom stopped checking them with Tally (FinCom stopped reading from Tally: Tally was busy.) — upload one Day Book for 05-Oct-2026" in t3, "3. stopped: said, the upload offered (%s)" % t3)
    scene([withAlerts([ra()])], LINES, status("off", fetch=False, why="switch"))
    t3 = (E(BLOCK) or [{}])[0].get("text", "")
    ok("once reading older entries is on for the Tally computer — or upload one Day Book" in t3, "3. reading older entries off: said (%s)" % t3)
    scene([withAlerts([ra()])], LINES, status("off", fetch=False, why="offline"))
    t3 = (E(BLOCK) or [{}])[0].get("text", "")
    ok("once the Tally computer that reads older entries is connected — or upload one Day Book" in t3, "3. that computer not connected: said, not 'checking' (%s)" % t3)
    # ---- 4. settled live: counts down, then gone
    scene([withAlerts([ra()])], LINES, status())
    E(HELD, status(held=3, done=8, frm="20261006")); E("() => { const r = Rec.act.rows.find(x => x.id === 1); Rec.lineIn(Object.assign({}, r, {state: 'applied'})); Rec.lineIn(Object.assign({}, Rec.act.rows.find(x => x.id === 2), {state: 'applied'})); }"); pg.wait_for_timeout(1200)
    t4 = (E(BLOCK) or [{}])[0].get("text", "")
    ok(t4.startswith(CO + ": 3 changes saved in Tally between 06-Oct and 07-Oct") and "(80%" in t4, "4. two lines settled: the block counts down by itself (%s)" % t4)
    E(HELD, status(held=0, done=10, state="done", checked=True))
    E("() => [3, 4, 5].forEach(i => Rec.lineIn(Object.assign({}, Rec.act.rows.find(x => x.id === i), {state: i === 3 ? 'applied' : 'duplicate'})))"); pg.wait_for_timeout(1500)
    ok(E(BLOCK) == [] and E(GROUPS) == [] and pg.locator("#app [data-sync-needs]").count() == 0, "4. all settled and the renumbering days checked: nothing left in Needs you (%s, %s)" % (E(BLOCK), E(GROUPS)))
    ok(E("() => Rec.renumberNeeds().length") == 0, "4. the renumbering item gone (the bell reads the same)")
    # ---- 5. only a renumbering item: as it was
    scene([withAlerts([ra()])], [], status(held=0, total=0, done=0, state="none"))
    ok(E(BLOCK) == [] and E(GROUPS) == ["renumber|" + CO], "5. a renumbering item alone: its own row as before (%s)" % E(GROUPS))
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
