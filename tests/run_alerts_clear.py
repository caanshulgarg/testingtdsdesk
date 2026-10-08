"""python3 run_alerts_clear.py - "clear notifications" (08-Oct-2026). The owner: "There should be option to clear
notifications everywhere.. in the bell of desktop even we dont have that option.. run it everywhere.. and have the clear
option.. and if one time any notification is cleared then that notification should not appear".
Offline, with FinCom's cloud made up in the page (alerts_seed.SETUP: Cloud.api / TCloud.rpc answered by the test) and the
dismissals of migration 68 (alert_dismiss / alert_dismiss_undo / alert_dismissals_list) answered by ONE store kept here,
in Python, shared by every browser context (as the cloud is). Checked:
  1. a Clear on every notification in the bell, "Clear all" at its top; a Clear on every slim line on the pages: the
     alert line (Tally page, a client's Books page), the books' "not yet in these books" banner, Sync activity's
     "Needs you" groups;
  2. Clear one: gone from the bell (the count too) and from the page lines; the data untouched (no apply, no release:
     only the dismissal's RPC); the work list (Sync activity's table) keeps the line;
  3. a count that ticks (1 entry -> 2 entries, the same gap) does not bring it back; it stays gone after a reload and in a
     second browser context of the same person (the cloud, not this browser);
  4. a NEW problem (the same book, a gap from another day) is a new notification and shows;
  5. the daily summary: Clear also marks it read (tally_alert_read), as Mark read did;
  6. Clear all: no question asked, "Cleared N notifications · Undo"; Undo brings them back (the rows stamped undone,
     none removed), also after a reload;
  7. the staff and the owner each have their own dismissals;
  8. phone width (390 px): the bell, its Clear buttons and Clear all inside the screen and working; the alert line's Clear;
  9. not signed in to the firm account: kept in this browser (localStorage), still gone after a reload; the cloud
     without migration 68: kept in this browser too, no error on the page.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_alerts_clear.py"""
import json, os, re, sys, uuid, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from alerts_seed import dev, al, SETUP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

OWNER, STAFF = "u-owner-0001", "u-staff-0002"
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
def at08(days_ago):
    d = datetime.datetime.now(IST).date() - datetime.timedelta(days=days_ago)
    return datetime.datetime(d.year, d.month, d.day, 8, 0, tzinfo=IST).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
NOT_ANS = (datetime.datetime.utcnow() - datetime.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")   # one episode of "not answering": the same time everywhere
YDAY = (datetime.datetime.now(IST).date() - datetime.timedelta(days=1)).strftime("%Y%m%d")
GAP_Y = {"words": "up to 1 changes not received", "missing": 1, "missingMax": 1, "since": at08(1), "tally_altvchid": 54396, "recorder_max": 54395}
LOCKED = {"id": 601, "client_id": "G", "book_id": "b1", "device_id": "d0000000-0000-4000-8000-000000000001", "pc": "NWS144", "company": "GARG SHEKHAR & COMPANY", "line_id": "L601",
          "event": "created", "object_guid": "abcd-1234-00000601", "alter_id": 601, "state": "held", "received_at": "ago:9", "vch_type": "Sales", "vch_no": "S-21", "vch_date": YDAY,
          "held_why": "month locked: September 2026 is locked in FinCom"}
SCENE = {"devs": [dev(recording=True)], "alerts": [al(3, "summary", "ago:2", "Today: 140 lines, 1 held, 1 gap, 3 postings")], "gap": GAP_Y, "lines": [LOCKED]}

# ---- the cloud's dismissals (migration 68), one store for every context
DB = {"rows": [], "missing": False}
def fcdb(payload):
    j = json.loads(payload); fn, uid, firm, a = j["fn"], j["uid"], j["firm"], j.get("args") or {}
    if DB["missing"]: return json.dumps({"error": "Could not find the function public.%s without parameters in the schema cache (PGRST202)" % fn})
    mine = lambda r: r["user_id"] == uid and r["firm_id"] == firm
    if fn == "alert_dismiss":
        b, n = str(uuid.uuid4()), 0
        for it in a.get("p_items") or []:
            k, fp = str(it.get("key") or ""), str(it.get("fp") or "")
            if not k or not fp or any(mine(r) and r["alert_key"] == k and r["fingerprint"] == fp and not r["undone_at"] for r in DB["rows"]): continue
            DB["rows"].append({"firm_id": firm, "user_id": uid, "alert_key": k, "fingerprint": fp, "words": str(it.get("words") or "")[:500], "batch": b,
                               "cleared_at": datetime.datetime.utcnow().isoformat() + "Z", "undone_at": None}); n += 1
        return json.dumps({"ok": True, "batch": b, "n": n})
    if fn == "alert_dismiss_undo":
        n = 0
        for r in DB["rows"]:
            if mine(r) and r["batch"] == a.get("p_batch") and not r["undone_at"]: r["undone_at"] = datetime.datetime.utcnow().isoformat() + "Z"; n += 1
        return json.dumps({"ok": True, "n": n})
    if fn == "alert_dismissals_list":
        return json.dumps([{"key": r["alert_key"], "fp": r["fingerprint"], "batch": r["batch"], "clearedAt": r["cleared_at"]} for r in reversed(DB["rows"]) if mine(r) and not r["undone_at"]])
    return json.dumps({"error": "unknown " + fn})

# the person signed in, and the dismissals' RPCs sent to the store above (the rest as alerts_seed answers them)
WHO = """async ([uid, role]) => {
  const sess = {access_token: "t", user_id: uid, email: uid + "@example.test"};
  Cloud.sess = () => sess;
  S.account = Object.assign(S.account || {}, {me: Object.assign({}, (S.account || {}).me || {}, {role, user_id: uid})});
  Cloud.st.role = role;
  if (!TCloud.__seedRpc) TCloud.__seedRpc = TCloud.rpc;
  const base = TCloud.__seedRpc;
  TCloud.rpc = async (fn, a) => {
    if (/^alert_dismiss/.test(fn)) { window.__w.calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
      const j = JSON.parse(await window.__fcDb(JSON.stringify({fn, uid, firm: Cloud.st.firm, args: a || {}})));
      if (j && j.error) throw new Error(j.error);
      return j; }
    return base(fn, a);
  };
  if (typeof AlertClear === "object") AlertClear.reset();
  if (typeof AlertHub === "object") AlertHub.refresh(true);
  render();
}"""
BELL = """() => { const b = document.querySelector('[data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  const panel = document.querySelector('[data-alerts-panel]');
  const items = [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), clear: !!e.querySelector('[data-alert-clear]'), sev: e.getAttribute('data-sev')}));
  const count = (b.querySelector('[data-bell-count]') || {innerText: '0'}).innerText.trim();
  return {count, items, clearAll: !!(panel && panel.querySelector('[data-alerts-clear-all]')), text: panel ? panel.innerText : ''}; }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
CLEAR_IN_BELL = """(re) => { const b = document.querySelector('[data-bell]'); if (!document.querySelector('[data-alerts-panel]')) b.click();
  const it = [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].find(e => new RegExp(re).test(e.innerText));
  const c = it && it.querySelector('[data-alert-clear]'); if (!c) return false; c.click(); return true; }"""
DATA_FNS = {"alert_dismiss", "alert_dismiss_undo", "alert_dismissals_list", "tally_recorder_silent", "tally_alert_read"}
srv = http.server.ThreadingHTTPServer(("localhost", 8357), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:8357/"
with sync_playwright() as p:
    br = p.chromium.launch()
    def context(w=1366, h=800):
        c = br.new_context(viewport={"width": w, "height": h}); c.expose_function("__fcDb", fcdb); return c
    def open_page(c):
        pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        return pg
    def sign_in(pg, uid, role="owner", scene=SCENE, where="dash"):
        cid = pg.evaluate(SETUP, [scene, role]); pg.evaluate(WHO, [uid, role])
        pg.evaluate("([cid, w]) => { if (w === 'tally') { navHome('tally'); return; } S.view = 'company'; S.coId = cid; S.loadingCo = false; goClient(w); }", [cid, where]); pg.wait_for_timeout(1500)
        pg.evaluate("() => { AlertHub.refresh(true); }"); pg.wait_for_timeout(1300)
        return cid
    def go(pg, cid, where):
        if where == "tally": pg.evaluate("() => { S.tallyTab = 'computers'; navHome('tally'); }")
        elif where == "activity": pg.evaluate("() => { S.syncClient = ''; S.syncFilter = 'all'; S.tallyTab = 'activity'; Rec.act.at = 0; navHome('tally'); }")
        else: pg.evaluate("([cid, w]) => { S.view = 'company'; S.coId = cid; goClient(w); }", [cid, where])
        pg.wait_for_timeout(1300)
    def calls(pg): return pg.evaluate("window.__w.calls")

    # ---------------------------------------------------------------- 1. a Clear everywhere
    c1 = context(); pg = open_page(c1)
    ok(pg.evaluate("typeof AlertClear") == "object", "one module keeps what each person cleared (AlertClear)")
    cid = sign_in(pg, OWNER)
    b = pg.evaluate(BELL) or {"count": "", "items": [], "clearAll": False}
    book = [x for x in b["items"] if x["key"].startswith("book:")]
    ok(b["count"] == "2" and len(book) == 1 and [x for x in b["items"] if x["key"] == "alert:3"], "the bell: the book's alert and the daily summary (%s, %s)" % (b["count"], [x["key"] for x in b["items"]]))
    ok(b["items"] and all(x["clear"] for x in b["items"]), "the bell: a Clear on every notification (%s)" % [(x["key"], x["clear"]) for x in b["items"]])
    ok(b["clearAll"], "the bell: Clear all at its top")
    pg.evaluate(CLOSE)
    for where, sel in [("tally", "#app [data-alert-line] [data-alert-clear]"), ("books:reports", "#app [data-alert-line] [data-alert-clear]"),
                       ("books:daybook", "#app [data-books-held] [data-alert-clear]"), ("activity", "#app [data-needs-group] [data-alert-clear]")]:
        go(pg, cid, where)
        ok(pg.locator(sel).count() >= 1, "%s: a Clear on %s" % (where, sel.split(" ")[1]))
    # ---------------------------------------------------------------- 2. Clear one
    pg.evaluate("() => { window.__w.calls = []; }")
    ok(pg.evaluate(CLEAR_IN_BELL, "GARG"), "Clear pressed on the book's notification in the bell")
    pg.wait_for_timeout(900)
    b = pg.evaluate(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]] and b["count"] == "1", "Clear one: gone from the bell, the count 1 (%s, %s)" % (b["count"], [x["text"][:40] for x in b["items"]]))
    pg.evaluate(CLOSE)
    sent = [c for c in calls(pg) if c[0] == "alert_dismiss"]
    it = sent[0][1]["p_items"][0] if sent and sent[0][1].get("p_items") else {}
    ok(len(sent) == 1 and it.get("key", "").startswith("book:") and "gap:" in it.get("fp", "") and "line:601" in it.get("fp", "") and "GARG" in it.get("words", ""),
       "sent to the cloud: the key, the fingerprint (the gap's day, the line) and the words (%s)" % it)
    ok(not [c for c in calls(pg) if c[0] not in DATA_FNS], "clearing changes no data: no apply, no release, no other call (%s)" % [c[0] for c in calls(pg) if c[0] not in DATA_FNS])
    for where in ("tally", "books:daybook"):
        go(pg, cid, where)
        ok(pg.locator("#app [data-alert-line]").count() == 0 and "GARG SHEKHAR & COMPANY: 1 entry" not in pg.inner_text("#app"), "%s: the alert line is gone too" % where)
    ok(pg.locator("#app [data-books-held]").count() == 0, "books: the same problem's 'not yet in these books' banner is gone too")
    go(pg, cid, "activity")
    ok(pg.locator("#app [data-needs-group]").count() == 0, "Sync activity: the same line's 'Needs you' is gone too")
    ok(pg.locator('#app [data-sync-line="601"]').count() == 1 and pg.locator('#app [data-sync-line="601"] [data-sync-release]').count() == 1,
       "Sync activity: the work list keeps the line, with its Apply now (a record, not a notification)")
    # ---------------------------------------------------------------- 3. a ticking count; a reload; a second context
    pg.evaluate("() => { window.__w.cursor[0].gap.missing = 2; window.__w.cursor[0].gap.missingMax = 2; Rec.gaps.at = 0; AlertHub.refresh(true); }"); pg.wait_for_timeout(1500)
    b = pg.evaluate(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]], "the same gap counting 2 entries now: still cleared (a count that ticks is not a new notification)")
    pg.evaluate(CLOSE)
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = sign_in(pg, OWNER)
    b = pg.evaluate(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]] and b["count"] == "1", "after a reload: still gone (%s)" % [x["text"][:40] for x in b["items"]])
    pg.evaluate(CLOSE)
    c2 = context(); pg2 = open_page(c2)
    ok(pg2.evaluate("() => Object.keys(localStorage).filter(k => /alerts-cleared/.test(k)).length") == 0, "a second browser: nothing of it kept in this browser")
    cid2 = sign_in(pg2, OWNER)
    b2 = pg2.evaluate(BELL)
    ok(not [x for x in b2["items"] if "GARG" in x["text"]] and b2["count"] == "1", "a second browser of the same person: gone there too (the cloud) (%s)" % [x["text"][:40] for x in b2["items"]])
    pg2.evaluate(CLOSE)
    # ---------------------------------------------------------------- 4. a new day's problem for the same book shows
    NEW_SINCE = at08(0)
    pg.evaluate("(s) => { window.__w.cursor[0].gap.since = s; window.__w.cursor[0].gap.missing = 1; window.__w.cursor[0].gap.missingMax = 1; window.__w.lines = []; Rec.gaps.at = 0; AlertHub.reset(); AlertHub.refresh(true); }", NEW_SINCE)
    pg.wait_for_timeout(1600)
    b = pg.evaluate(BELL)
    ok(len([x for x in b["items"] if "GARG" in x["text"]]) == 1 and b["count"] == "2", "a gap from another day for the same book: a new notification, it shows (%s)" % [x["text"][:60] for x in b["items"]])
    pg.evaluate(CLOSE)
    # ---------------------------------------------------------------- 5. the summary: Clear marks it read too
    pg.evaluate("() => { window.__w.calls = []; }")
    ok(pg.evaluate(CLEAR_IN_BELL, "Today: 140 lines"), "Clear pressed on the daily summary")
    pg.wait_for_timeout(900)
    b = pg.evaluate(BELL)
    ok(not [x for x in b["items"] if "Today: 140" in x["text"]], "the summary is gone from the bell")
    ok([c for c in calls(pg) if c[0] == "tally_alert_read" and c[1].get("p_id") == 3], "and it is marked read as Mark read did (tally_alert_read 3) (%s)" % [c[0] for c in calls(pg)])
    pg.evaluate(CLOSE)
    # ---------------------------------------------------------------- 6. Clear all and Undo
    pg.evaluate("""(t) => { window.__w.devs = window.__w.devs.map(d => { d.info.beat = Object.assign({}, d.info.beat || {}, {notAnsweringSince: t}); return d; });
      TLight.st.devs = JSON.parse(JSON.stringify(window.__w.devs)); AlertHub.refresh(true); }""", NOT_ANS); pg.wait_for_timeout(900)
    b = pg.evaluate(BELL)
    keys = sorted(x["key"] for x in b["items"])
    ok(len(keys) == 2 and any(k.startswith("pc:") for k in keys), "two notifications now: the book's and the computer's (%s)" % keys)
    pg.evaluate("() => { window.__w.calls = []; window.__confirmed = 0; window.confirm = () => { window.__confirmed++; return true; }; }")
    pg.click("[data-alerts-panel] [data-alerts-clear-all]"); pg.wait_for_timeout(900)
    b = pg.evaluate(BELL)
    snack = pg.evaluate("() => { const e = document.querySelector('[data-alerts-undo]'); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; }")
    ok(not b["items"] and b["count"] == "0" and "Nothing needs your attention" in b["text"], "Clear all: the bell is empty, no count (%s)" % b["count"])
    ok(pg.evaluate("window.__confirmed") == 0, "Clear all asks no question")
    ok(re.search(r"Cleared 2 notifications\s*·\s*Undo", snack), "it says 'Cleared 2 notifications · Undo' (%r)" % snack)
    sent = [c for c in calls(pg) if c[0] == "alert_dismiss"]
    ok(len(sent) == 1 and len(sent[0][1].get("p_items") or []) == 2, "one Clear: one call with both notifications (one batch)")
    pg.click("[data-alerts-undo] [data-alerts-undo-btn]"); pg.wait_for_timeout(1000)
    b = pg.evaluate(BELL)
    ok(sorted(x["key"] for x in b["items"]) == keys and b["count"] == "2", "Undo: both back (%s)" % [x["key"] for x in b["items"]])
    und = [c for c in calls(pg) if c[0] == "alert_dismiss_undo"]
    batch = [r for r in DB["rows"] if r["undone_at"]]
    ok(len(und) == 1 and len(batch) == 2 and all(r["batch"] == und[0][1].get("p_batch") for r in batch), "Undo: the rows of that Clear stamped undone, none removed (%d rows kept)" % len(DB["rows"]))
    pg.evaluate(CLOSE)
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    sign_in(pg, OWNER, scene=dict(SCENE, lines=[], alerts=[al(3, "summary", "ago:2", "Today: 140 lines, 1 held, 1 gap, 3 postings", read="ago:1")], gap=dict(GAP_Y, since=NEW_SINCE)))
    pg.evaluate("""(t) => { window.__w.devs = window.__w.devs.map(d => { d.info.beat = Object.assign({}, d.info.beat || {}, {notAnsweringSince: t}); return d; });
      TLight.st.devs = JSON.parse(JSON.stringify(window.__w.devs)); AlertHub.refresh(true); }""", NOT_ANS); pg.wait_for_timeout(900)
    b = pg.evaluate(BELL)
    ok(sorted(x["key"].split(":")[0] for x in b["items"]) == sorted(k.split(":")[0] for k in keys), "after a reload the undone ones are still back (%s)" % [x["key"] for x in b["items"]])
    pg.evaluate(CLOSE)
    # ---------------------------------------------------------------- 7. the staff and the owner, each their own
    ok(pg.evaluate(CLEAR_IN_BELL, "GARG"), "the owner clears the book's notification"); pg.wait_for_timeout(800); pg.evaluate(CLOSE)
    pg.evaluate(WHO, [STAFF, "staff"]); pg.wait_for_timeout(1500)
    b = pg.evaluate(BELL)
    ok([x for x in b["items"] if "GARG" in x["text"]] and [x for x in b["items"] if x["key"].startswith("pc:")], "the staff still sees the book's notification the owner cleared (%s)" % [x["key"] for x in b["items"]])
    ok(pg.evaluate(CLEAR_IN_BELL, "computer"), "the staff clears the computer's"); pg.wait_for_timeout(800)
    b = pg.evaluate(BELL)
    ok(not [x for x in b["items"] if x["key"].startswith("pc:")] and [x for x in b["items"] if "GARG" in x["text"]], "the staff: the computer's gone, the book's there (%s)" % [x["key"] for x in b["items"]])
    pg.evaluate(CLOSE)
    pg.evaluate(WHO, [OWNER, "owner"]); pg.wait_for_timeout(1500)
    b = pg.evaluate(BELL)
    ok([x for x in b["items"] if x["key"].startswith("pc:")] and not [x for x in b["items"] if "GARG" in x["text"]], "the owner: the computer's still there, the book's gone (each their own) (%s)" % [x["key"] for x in b["items"]])
    pg.evaluate(CLOSE)
    # ---------------------------------------------------------------- 8. phone width
    c3 = context(390, 800); pg3 = open_page(c3)
    cid3 = sign_in(pg3, STAFF, "staff", scene=dict(SCENE, alerts=[]))
    pg3.evaluate("""(t) => { window.__w.devs = window.__w.devs.map(d => { d.info.beat = Object.assign({}, d.info.beat || {}, {notAnsweringSince: t}); return d; });
      TLight.st.devs = JSON.parse(JSON.stringify(window.__w.devs)); AlertHub.refresh(true); }""", NOT_ANS); pg3.wait_for_timeout(900)
    ok(pg3.locator("[data-bell]").first.is_visible(), "phone: the bell is in the top bar")
    b = pg3.evaluate(BELL)
    boxes = pg3.evaluate("() => [...document.querySelectorAll('[data-alerts-panel] [data-alert-clear], [data-alerts-panel] [data-alerts-clear-all]')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.height), r.width > 0]; })")
    ok(len(boxes) == len(b["items"]) + 1 and all(l >= 0 and r <= 390 and v for l, r, h, v in boxes), "phone: every Clear and Clear all inside the screen (%s)" % boxes)
    ok(all(h >= 24 for l, r, h, v in boxes), "phone: big enough to press (%s)" % [h for l, r, h, v in boxes])
    panel = pg3.evaluate("() => { const r = document.querySelector('[data-alerts-panel]').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }")
    ok(panel[0] >= 0 and panel[1] <= 390, "phone: the whole bell list inside the screen, its words not cut off (%s)" % panel)
    ok([x for x in b["items"] if "GARG" in x["text"]], "phone: the staff's own dismissals (the book's notification shows for the staff here: the staff cleared only the computer's) (%s)" % [x["key"] for x in b["items"]])
    ok(pg3.evaluate(CLEAR_IN_BELL, "GARG"), "phone: Clear pressed"); pg3.wait_for_timeout(900)
    b = pg3.evaluate(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]], "phone: gone")
    sn = pg3.evaluate("() => { const e = document.querySelector('[data-alerts-undo-btn]'); if (!e) return null; const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return {inside: r.left >= 0 && r.right <= 390 && r.bottom <= innerHeight, onTop: top === e || e.contains(top), at: top ? top.tagName + '.' + top.className : ''}; }")
    ok(sn and sn["inside"] and sn["onTop"], "phone: 'Cleared 1 notification · Undo' on the screen, above the bottom bar (%s)" % sn)
    pg3.evaluate(CLOSE)
    pg3.evaluate("() => { window.__w.cursor[0].gap.since = new Date(Date.now() - 2 * 86400e3).toISOString(); Rec.gaps.at = 0; AlertHub.reset(); AlertHub.refresh(true); }"); pg3.wait_for_timeout(1500)
    go(pg3, cid3, "tally")
    # the alert line at phone width (360 and 390): the sentence on its own full-width line, the buttons on a row below;
    # nothing cut off, no sideways scroll
    LINE = """() => { const l = document.querySelector('#app [data-alert-line]'); if (!l) return null; const t = l.querySelector('.al-line-text');
      const lr = l.getBoundingClientRect(), tr = t.getBoundingClientRect(), bs = [...l.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      return {lineW: lr.width, textW: tr.width, cut: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1, text: t.innerText, below: bs.every(b => b.top >= tr.bottom - 1),
        inside: bs.every(b => b.left >= lr.left - 1 && b.right <= lr.right + 1), scroll: document.documentElement.scrollWidth > innerWidth}; }"""
    for W in (360, 390):
        pg3.set_viewport_size({"width": W, "height": 800}); pg3.wait_for_timeout(500)
        go(pg3, cid3, "tally")
        g = pg3.evaluate(LINE)
        ok(g and g["textW"] >= 0.8 * g["lineW"], "phone %d: the alert's words get the line's width (%s)" % (W, g and (round(g["textW"]), round(g["lineW"]))))
        ok(g and not g["cut"] and re.search(r"GARG SHEKHAR & COMPANY: .+ not yet in FinCom\. Upload the Day Book for .+\.", g["text"]), "phone %d: the whole sentence shown, nothing cut off (%r)" % (W, g and g["text"]))
        ok(g and g["below"] and g["inside"], "phone %d: the buttons (action, Clear, +more) on a row below the words, inside the line" % W)
        ok(g and not g["scroll"], "phone %d: no sideways scroll (%s)" % (W, g and g["scroll"] and pg3.evaluate("() => [document.documentElement.scrollWidth, ...[...document.querySelectorAll('#app *, header *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))]")))
    pg3.set_viewport_size({"width": 390, "height": 800}); pg3.wait_for_timeout(400)
    line = pg3.evaluate("() => { const e = document.querySelector('#app [data-alert-line] [data-alert-clear]'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), r.width > 0]; }")
    ok(line and line[0] >= 0 and line[1] <= 390 and line[2], "phone: the alert line's Clear inside the screen (%s)" % line)
    if line: pg3.click("#app [data-alert-line] [data-alert-clear]"); pg3.wait_for_timeout(900)
    ok(pg3.locator("#app [data-alert-line]").count() == 0, "phone: the alert line cleared from the page (%s)" % pg3.evaluate("() => [...document.querySelectorAll('#app [data-alert-line]')].map(e => e.innerText)"))
    # ---------------------------------------------------------------- 9. not signed in; the cloud without migration 68
    c4 = context(); pg4 = open_page(c4)
    pg4.evaluate("() => { S.storeKind = 'local'; Cloud.on = () => false; if (typeof AlertClear === 'object') AlertClear.reset(); render(); }"); pg4.wait_for_timeout(600)
    b = pg4.evaluate(BELL)
    st = [x for x in b["items"] if "browser" in x["text"].lower()]
    ok(len(st) == 1 and st[0]["clear"], "not signed in: the 'saved in this browser only' notification, with its Clear (%s)" % [x["text"] for x in b["items"]])
    ok(pg4.evaluate(CLEAR_IN_BELL, "browser"), "Clear pressed"); pg4.wait_for_timeout(700)
    b = pg4.evaluate(BELL)
    ok(not [x for x in b["items"] if "browser" in x["text"].lower()], "not signed in: gone")
    pg4.evaluate(CLOSE)
    n_before = len(DB["rows"])
    pg4.reload(); pg4.wait_for_timeout(2500)
    if pg4.locator('button[data-act="useOffline"]').count(): pg4.click('button[data-act="useOffline"]'); pg4.wait_for_timeout(800)
    pg4.evaluate("() => { S.storeKind = 'local'; Cloud.on = () => false; if (typeof AlertClear === 'object') AlertClear.reset(); render(); }"); pg4.wait_for_timeout(600)
    b = pg4.evaluate(BELL)
    ok(not [x for x in b["items"] if "browser" in x["text"].lower()] and len(DB["rows"]) == n_before, "not signed in: kept in this browser, still gone after a reload, nothing sent to the cloud")
    pg4.evaluate(CLOSE)
    DB["missing"] = True
    c5 = context(); pg5 = open_page(c5)
    sign_in(pg5, "u-third-0003", "staff", scene=dict(SCENE, alerts=[]))
    b = pg5.evaluate(BELL)
    ok([x for x in b["items"] if "GARG" in x["text"]], "the cloud without migration 68: the notification shows")
    ok(pg5.evaluate(CLEAR_IN_BELL, "GARG"), "Clear pressed"); pg5.wait_for_timeout(900)
    b = pg5.evaluate(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]] and not [e for e in errors if "alert" in e.lower()], "the cloud without migration 68: gone, kept in this browser, no error on the page")
    pg5.evaluate(CLOSE)
    pg5.reload(); pg5.wait_for_timeout(2500)
    if pg5.locator('button[data-act="useOffline"]').count(): pg5.click('button[data-act="useOffline"]'); pg5.wait_for_timeout(800)
    sign_in(pg5, "u-third-0003", "staff", scene=dict(SCENE, alerts=[]))
    b = pg5.evaluate(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]], "the cloud without migration 68: still gone after a reload (this browser)")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
