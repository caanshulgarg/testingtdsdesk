"""python3 run_stuck_jobs.py - a posting stuck in FinCom Bridge (next-fix-stuck-jobs, 07-Nov-2026; the owner's computer:
a posting that failed in FinCom's cloud on 05-Nov stayed active in the bridge, and the bridge read no ledgers for hours:
"Waiting: a posting into Tally is going on."). Made-up firm, logins, companies and jobs; a stand-in local bridge
(GET /jobs, POST /jobs/cancel, as bridge 2.5.5 answers them) and the stand-in cloud of run_tally_simple.py.
  1. the bridge here holds 4 postings: a cloud job that failed (auto-cancelled; tdsdesk:bridgejob naming it cleared), one
     the page handed over itself (no cloud row: only Cancel), one the cloud shows running and one done but still checking
     (both untouched); "Waiting for a posting on this computer: <company> · <status>" in the top line, See postings, Cancel
     with "Stop this posting? Nothing more is sent to Tally for it."; Books › From Tally beside Update now the same.
  2. a Mac (no bridge here): nothing shown, the bridge never asked.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_stuck_jobs.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("STUCK_JOBS_PORT", "9573"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.5", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.5.exe", "sha256": "cd" * 32}}
PC = "SRV01"; UA = PC + "\\made-up-a"
ORBIT, ORB = "Orbit Space", "ORBIT SPACE"
FAILED, DIRECT, RUNNING, CHECKING = ("11111111-1111-4111-8111-11111111111%d" % i for i in range(1, 5))
JOBS = [{"id": FAILED, "company": ORB, "status": "interrupted", "message": "The posting stopped part-way", "done": 3, "total": 9},
        {"id": DIRECT, "company": ORB, "status": "waiting", "message": "Waiting for Tally", "done": 0, "total": 2},
        {"id": RUNNING, "company": ORB, "status": "running", "message": "Posting 4 of 10", "done": 4, "total": 10},
        {"id": CHECKING, "company": ORB, "status": "interrupted", "message": "", "done": 5, "total": 5}]
CLOUD = [{"id": FAILED, "status": "failed", "checking": False}, {"id": RUNNING, "status": "running", "checking": False},
         {"id": CHECKING, "status": "done", "checking": True}]
# the stand-in bridge: its active postings; a cancel takes one off (as cancelJob marks it cancelled)
BR = {"jobs": [], "cancels": [], "gets": 0}
def bridge(route):
    req = route.request; path = req.url.split("127.0.0.1:9101", 1)[-1].split("?")[0]
    if path == "/jobs" and req.method == "GET":
        BR["gets"] += 1; body = {"ok": True, "jobs": BR["jobs"]}
    elif path == "/jobs/cancel" and req.method == "POST":
        jid = json.loads(req.post_data or "{}").get("id"); BR["cancels"].append(jid); BR["jobs"] = [j for j in BR["jobs"] if j["id"] != jid]
        body = {"id": jid, "status": "cancelled", "message": "Cancelled in FinCom; nothing more is sent to Tally"}
    else: body = {"ok": False, "error": "made-up bridge: " + path}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:9101/**", bridge)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        def scene(devs, cos, clients, pings, here_bridge, books=None):
            ids = E(T.SETUP, [devs, cos, [], "owner", clients, True, books or {}])
            E("() => { window.__linksApi = false; }")
            E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, pings); E(TS.FORGET)
            E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
            E(TS.MINE, ["", "", ""])
            # the cloud's postings (tally_post_jobs) by id; the jobs asked of it recorded
            E("""(cloud) => { window.__postJobs = cloud; window.__pjAsked = []; const api = Cloud.api;
              Cloud.api = async (p, o) => { if (/^tally_post_jobs\\?/.test(p)) { window.__pjAsked.push(p); const m = /id=in\\.\\(([^)]*)\\)/.exec(p), want = m ? m[1].split(',') : [];
                return JSON.parse(JSON.stringify(window.__postJobs.filter(x => want.includes(x.id)))); } return api(p, o); }; TCloud.restAll = (u) => Cloud.api(u); }""", CLOUD)
            if here_bridge:
                # this computer's own bridge, paired and answering (its /status ok): Bridge.call reaches the stand-in at 9101
                E("""() => { const B = window.__bridge0 = window.__bridge0 || {on: Bridge.on, up: Bridge.up, cfg: Bridge.cfg, refresh: Bridge.refresh, ensureProven: Bridge.ensureProven};
                  const c = {url: 'http://127.0.0.1:9101', key: 'made-up-key', follow: false, port: 0, bridgeId: 'go-7'};
                  Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => true; Bridge.ensureProven = async () => true; Bridge.refresh = async () => Bridge.st;
                  Bridge.st = {state: 'ok', sessions: [{port: 9041, ok: true, mine: true, companies: ['ORBIT SPACE']}], open: [{name: 'ORBIT SPACE', port: 9041, mine: true}], tallyUp: true,
                    version: '2.5.5', user: 'SRV01\\\\made-up-a', sameSession: true, at: Date.now(), mode: 'auto'}; }""")
            E("""(id) => { try { localStorage.setItem('tdsdesk:bridgejob', JSON.stringify({id, at: Date.now() - 2 * 86400000, company: 'ORBIT SPACE', n: 9})); } catch (e) {}
              if (window.FCStuckJobs) Object.assign(window.FCStuckJobs, {list: null, at: 0, busy: false, cleared: [], err: ''});
              E_ = 0; S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }""".replace("E_ = 0; ", ""), FAILED)
            pg.wait_for_timeout(3500)
            return ids
        up = {"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}
        beat = {"bridgePort": 9101, "windowsUser": UA, "keepWait": {"reason": "posting", "words": "Waiting: a posting into Tally is going on.", "since": "ago:7200"}}
        dA = T.dev(7, PC, "made-up-a", tally="open", opened=(ORB,), version="2.5.5", rec=(ORB,), beat=beat, ports=[up])
        cos = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.5", bridgeId="go-7")}

        print("== 1. the bridge here holds 4 postings")
        BR["jobs"] = [dict(j) for j in JOBS]; BR["cancels"] = []
        ids = scene([dA], cos, [ORBIT], A_PINGS, True, books={ORBIT: T.book(ORBIT)})
        ok(BR["gets"] >= 1, "1. the bridge's postings asked (GET /jobs: %d)" % BR["gets"])
        ok(BR["cancels"] == [FAILED], "1. the cloud's failed job cancelled by itself, and only it (%s)" % BR["cancels"])
        ok(E("() => localStorage.getItem('tdsdesk:bridgejob')") is None, "1. tdsdesk:bridgejob naming it cleared")
        ok(RUNNING not in BR["cancels"] and CHECKING not in BR["cancels"] and DIRECT not in BR["cancels"], "1. untouched: the job the cloud shows running, the one still checking, the page's own")
        top = txt("#app [data-stuck-jobs=panel]")
        ok(top.startswith("Waiting for a posting on this computer: %s · waiting (and 2 more)" % ORB), "1. the Tally page: Waiting for a posting on this computer: <company> · <status> (%s)" % top)
        ok(n("#app [data-tsm-top] [data-stuck-jobs=panel]") == 1 and n("#app [data-stuck-jobs=panel]") == 1, "1. one line, inside the connection card (next-tally-simple2)")
        pg.click("#app [data-stuck-jobs=panel] [data-stuck-see]"); pg.wait_for_timeout(300)
        rows = E("() => [...document.querySelectorAll('#app [data-stuck-jobs=panel] [data-stuck-job]')].map(e => e.getAttribute('data-stuck-job'))")
        labels = E("() => [...document.querySelectorAll('#app [data-stuck-jobs=panel] [data-stuck-cancel]')].map(b => b.textContent)")
        ok(rows == [DIRECT, RUNNING, CHECKING] and labels == ["Stop posting"] * 3, "1. See postings: the 3 left, a Stop posting each (%s %s)" % (rows, labels))
        E("() => { window.__asked = []; window.__askWas = window.askConfirm; window.askConfirm = async (q) => { window.__asked.push(q); return window.__askAns; }; window.__askAns = {ok: false}; }")
        pg.click('#app [data-stuck-jobs=panel] [data-stuck-cancel="%s"]' % DIRECT); pg.wait_for_timeout(600)
        q = (E("() => window.__asked") or [{}])[0]
        ok(q.get("title") == "Stop this posting?" and q.get("body") == "Nothing more is sent to Tally for it." and q.get("danger") is True and DIRECT not in BR["cancels"],
           "1. Cancel asks first: Stop this posting? Nothing more is sent to Tally for it.; Keep it: nothing stopped (%s)" % q)
        E("() => { window.__askAns = {ok: true}; }")
        pg.click('#app [data-stuck-jobs=panel] [data-stuck-cancel="%s"]' % DIRECT); pg.wait_for_timeout(1200)
        ok(BR["cancels"] == [FAILED, DIRECT], "1. Stop it: the page's own posting cancelled (POST /jobs/cancel) (%s)" % BR["cancels"])
        ok(RUNNING not in BR["cancels"] and txt("#app [data-stuck-jobs=panel]").startswith("Waiting for a posting on this computer: %s · running" % ORB), "1. the running one still listed, untouched (%s)" % txt("#app [data-stuck-jobs=panel]")[:120])
        E("() => { window.askConfirm = window.__askWas; }")
        # Books › From Tally: the same, beside Update now
        E("(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", ids[ORBIT])
        pg.wait_for_timeout(4000)
        ok(txt("#app [data-masters] [data-stuck-jobs=masters]").startswith("Waiting for a posting on this computer: %s · running" % ORB), "1. Books › From Tally: beside Update now (%s)" % txt("#app [data-masters]")[:200])

        # the postings finished by themselves, the bridge no longer waits for one: the line goes without a reload
        BR["jobs"] = []; g1 = BR["gets"]
        E("""() => { const d = window.__devs[0]; delete d.info.beat.keepWait; d.info.beat.at = new Date().toISOString();
          TLight.st.devs = JSON.parse(JSON.stringify(window.__devs)); TCloud.pane.devices = TLight.st.devs; render(); }""")
        try: pg.wait_for_function("() => !document.querySelector('#app [data-stuck-jobs]')", timeout=8000); gone = True
        except Exception: gone = False
        ok(gone and BR["gets"] == g1 + 1, "1. keepWait no longer 'posting': the list asked once more, the line gone (%d asks; %s)" % (BR["gets"] - g1, txt("#app [data-masters]")[:120]))

        print("== 2. a Mac: no bridge here")
        # (scene 1's stand-in bridge put back first: the Mac's page starts without it)
        E("() => { if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: ''}; Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); render(); }")
        pg.wait_for_timeout(800)
        BR["jobs"] = [dict(j) for j in JOBS]; BR["cancels"] = []; g0 = BR["gets"]
        scene([dA], cos, [ORBIT], {}, False, books={ORBIT: T.book(ORBIT)})
        ok(BR["gets"] == g0 and not BR["cancels"] and n("#app [data-stuck-jobs]") == 0, "2. nothing shown, the bridge never asked (%d asks, %s cancels)" % (BR["gets"] - g0, BR["cancels"]))
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
