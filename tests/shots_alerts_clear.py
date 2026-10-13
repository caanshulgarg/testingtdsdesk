"""python3 shots_alerts_clear.py OUTDIR - screenshots for "clear notifications" (08-Oct-2026), desktop (1366) and phone
(390): the bell opened, the Tally page's alert line, a client's Books page banner, Sync activity's "Needs you", and (when
the build has Clear) the bell after Clear all with its "Cleared N notifications · Undo". The made-up cloud of
run_alerts_clear.py (alerts_seed.SETUP; the dismissals answered in the page). Writes OUTDIR/<desktop|phone>-<view>.png.
Run on a React build: TDSDESK_SITE=../app/dist-test python3 shots_alerts_clear.py OUTDIR"""
import os, sys, json, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from alerts_seed import dev, al, SETUP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots-alerts-clear"; os.makedirs(OUT, exist_ok=True)
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
y = datetime.datetime.now(IST).date() - datetime.timedelta(days=1)
SINCE = datetime.datetime(y.year, y.month, y.day, 8, 0, tzinfo=IST).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
LOCKED = {"id": 601, "client_id": "G", "book_id": "b1", "device_id": "d0000000-0000-4000-8000-000000000001", "pc": "NWS144", "company": "GARG SHEKHAR & COMPANY", "line_id": "L601",
          "event": "created", "object_guid": "abcd-1234-00000601", "alter_id": 601, "state": "held", "received_at": "ago:9", "vch_type": "Sales", "vch_no": "S-21", "vch_date": y.strftime("%Y%m%d"),
          "held_why": "month locked: September 2026 is locked in FinCom"}
SCENE = {"devs": [dev(recording=True)], "alerts": [al(3, "summary", "ago:2", "Today: 140 lines, 1 held, 1 gap, 3 postings")],
         "gap": {"words": "up to 1 changes not received", "missing": 1, "missingMax": 1, "since": SINCE, "tally_altvchid": 54396, "recorder_max": 54395}, "lines": [LOCKED]}
LOCAL_DB = """() => { const rows = []; let n = 0;
  if (!TCloud.__seedRpc) TCloud.__seedRpc = TCloud.rpc; const base = TCloud.__seedRpc;
  Cloud.sess = () => ({access_token: "t", user_id: "u-owner-0001"});
  TCloud.rpc = async (fn, a) => {
    if (fn === "alert_dismiss"){ const b = "b" + (++n); (a.p_items || []).forEach(x => rows.push({key: x.key, fp: x.fp, batch: b})); return {ok: true, batch: b, n: (a.p_items || []).length}; }
    if (fn === "alert_dismiss_undo"){ rows.splice(0, rows.length, ...rows.filter(r => r.batch !== a.p_batch)); return {ok: true}; }
    if (fn === "alert_dismissals_list") return rows.slice();
    return base(fn, a); };
  if (typeof AlertClear === "object") AlertClear.reset(); }"""
NOT_ANS = """() => { window.__w.devs = window.__w.devs.map(d => { d.info.beat = Object.assign({}, d.info.beat || {}, {notAnsweringSince: new Date(Date.now() - 3600e3).toISOString()}); return d; });
  TLight.st.devs = JSON.parse(JSON.stringify(window.__w.devs)); AlertHub.refresh(true); }"""
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8358), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch()
    for label, w, h in [x for x in (("desktop", 1366, 800), ("phone", 390, 844), ("phone360", 360, 780)) if x[0] in (os.environ.get("SHOTS") or "desktop,phone,phone360").split(",")]:
        pg = br.new_page(viewport={"width": w, "height": h})
        pg.goto("http://localhost:8358/"); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
        cid = pg.evaluate(SETUP, [SCENE, "owner"]); pg.evaluate(LOCAL_DB); pg.evaluate(NOT_ANS)
        def shot(name, js):
            pg.evaluate(js, cid); pg.wait_for_timeout(1800)
            pg.evaluate("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(900)
            f = os.path.join(OUT, label + "-" + name + ".png"); pg.screenshot(path=f); print(f)
        shot("tally-alert-line", "(c) => { S.alertsOpen = false; S.tallyTab = 'computers'; navHome('tally'); }")
        shot("books-held-banner", "(c) => { S.view = 'company'; S.coId = c; S.loadingCo = false; goClient('books:daybook'); }")
        shot("sync-needs-you", "(c) => { S.syncClient = ''; S.tallyTab = 'activity'; Rec.act.at = 0; navHome('tally'); }")
        shot("bell-open", "(c) => { S.view = 'company'; S.coId = c; goClient('dash'); setTimeout(() => { const b = document.querySelector('[data-bell]'); if (b && !document.querySelector('[data-alerts-panel]')) b.click(); }, 700); }")
        if pg.locator("[data-alerts-clear-all]").count():
            pg.click("[data-alerts-clear-all]"); pg.wait_for_timeout(500)
            f = os.path.join(OUT, label + "-bell-after-clear-all.png"); pg.screenshot(path=f); print(f)
        pg.close()
    br.close()
srv.shutdown()
