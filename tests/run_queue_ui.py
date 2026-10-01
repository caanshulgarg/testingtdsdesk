"""python3 run_queue_ui.py - FinCom hands work to the server's queue (migration-13, branch fast-sync) and follows it:
  - a day book chosen in FinCom goes to the server in parts (stage_days); the page says it can be closed;
  - the server's progress shows on the books, live (Realtime on tally_jobs), and the page can be closed meanwhile: a page
    opened later shows where the job is from the server;
  - when the server has finished, the books here bring in what it read (the cloud copy is asked again);
  - "Read the kept day books again" goes to the queue too, and its line follows the job.
A stand-in for FinCom's cloud (the function, REST and Realtime) here. Made-up books only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_queue_ui.py"""
import os, re, json, time, uuid, threading, functools, http.server, datetime
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8171), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"; FIRM = "f1"; CID = "zzq1"
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
JOBS, STAGED, CALLS, SOCKS = {}, [], [], []
def push(job):
    msg = json.dumps({"topic": "realtime:fincom-jobs-" + FIRM, "event": "postgres_changes", "ref": None, "payload": {"data": {"table": "tally_jobs", "type": "UPDATE", "record": job, "errors": None}}})
    for s in list(SOCKS):
        try: s.send(msg)
        except Exception: SOCKS.remove(s)
def route(r):
    u = urlparse(r.request.url); path = u.path; j = lambda o, c=200: r.fulfill(status=c, content_type="application/json", body=json.dumps(o))
    if path.endswith("/functions/v1/tally-ingest"):
        b = json.loads(r.request.post_data); CALLS.append(b.get("kind"))
        if b["kind"] == "job_new":
            jid = str(uuid.uuid4()); JOBS[jid] = {"id": jid, "client_id": CID, "kind": "daybook", "status": "queued", "total": b["total"], "done": 0, "sealed": False, "bad": [], "message": b.get("name", ""), "created_at": now(), "updated_at": now()}
            return j({"ok": True, "job": jid})
        if b["kind"] == "stage_days":
            STAGED.extend(d["day"] for d in b["days"]); x = JOBS[b["job"]]
            if b.get("last"): x["sealed"] = True
            return j({"ok": True, "queued": len(b["days"])})
        if b["kind"] == "reparse_queue":
            jid = str(uuid.uuid4()); JOBS[jid] = {"id": jid, "client_id": CID, "kind": "reparse", "status": "queued", "total": 3, "done": 0, "sealed": True, "bad": [], "message": "", "created_at": now(), "updated_at": now()}
            return j({"ok": True, "job": jid, "months": 3})
        return j({"ok": True, "done": []})
    if path.endswith("/rest/v1/tally_jobs"):
        q = parse_qs(u.query)
        if "limit" in q and q.get("select") == ["id"]: return j([])
        return j(sorted([x for x in JOBS.values() if x["client_id"] == CID], key=lambda x: x["created_at"], reverse=True)[:5])
    if path.endswith("/rpc/tally_status"): CALLS.append("status"); return j([])
    if path.endswith("/rest/v1/members"): return j([{"user_id": "u1", "firm_id": FIRM, "name": "Asha", "role": "owner", "active": True}])
    return j([])
def ws_route(ws):
    SOCKS.append(ws)
    def on_msg(m):
        x = json.loads(m)
        if x.get("event") in ("phx_join", "heartbeat"): ws.send(json.dumps({"topic": x["topic"], "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {}}}))
    ws.on_message(on_msg)
def wait_for(pg, js, t=10):
    s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return True
        except Exception: pass
        time.sleep(0.1)
    return False
def open_page(ctx):
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8171/"); pg.wait_for_timeout(1500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(500)
    pg.evaluate("""([cid, firm]) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = firm; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u1", name: "Asha"}];
      let c = S.companies[cid]; if (!c){ c = newCompany({name: "ZZ QUEUE TEST", gstin: ""}); c.id = cid; S.companies[cid] = c; } S.data[cid] = S.data[cid] || {parties: {}, entries: {}, loaded: true};
      S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "import"; S.books = null; render(); Live.start();
      window.__toasts = []; const t0 = window.toast; window.toast = function(m){ window.__toasts.push(String(m)); return t0.apply(this, arguments); }; }""", [CID, FIRM])
    wait_for(pg, "Live.jobsLive", 8)
    return pg
V = "".join('<TALLYMESSAGE><VOUCHER VCHTYPE="Journal"><DATE>202504%02d</DATE><GUID>zz-%d</GUID><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>%d</VOUCHERNUMBER><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ A</LEDGERNAME><AMOUNT>-100</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>ZZ B</LEDGERNAME><AMOUNT>100</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>' % (d, d, d) for d in range(1, 31))
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1300, "height": 900})
    ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
    pg = open_page(ctx)
    ok(pg.evaluate("Live.jobsLive"), "the page follows the server's jobs live (its own channel)")
    pg.evaluate("""async (x) => { const f = new File(["<ENVELOPE><BODY><DATA>" + x + "</DATA></BODY></ENVELOPE>"], "daybook-apr.xml", {type: "text/xml"}); await bringDayBookFile(f, "20250401", "20250430", {quiet: true}); }""", V)
    ok(wait_for(pg, "Object.keys(TCloud.jobs).length && (TCloud.jobs['%s'] || []).length" % CID, 10) and "job_new" in CALLS and len(STAGED) == 30 and all(x["sealed"] for x in JOBS.values()),
       "the day book went to the server's queue: a job, then its 30 days in parts (%s)" % ", ".join(sorted(set(CALLS))))
    ok(wait_for(pg, "window.__toasts.some(t => t.includes('You can close this page'))", 5), "and the page says it can be closed: " + (pg.evaluate("window.__toasts.find(t => t.includes('close this page')) || ''")))
    jid = next(iter(JOBS)); job = JOBS[jid]
    job.update(status="running", done=12, updated_at=now()); push(job)
    ok(wait_for(pg, "document.body.innerText.includes('12 of 30 days')", 5), "the server's progress shows live: " + (re.search(r"Reading the day book[^\n]*", pg.inner_text("body")) or [""])[0])
    # the page is closed while the server works on; a page opened later shows where it is
    pg.close(); job.update(done=25, updated_at=now())
    pg = open_page(ctx); pg.evaluate("() => { S.booksTab = 'tds'; render(); }")
    ok(wait_for(pg, "document.body.innerText.includes('25 of 30 days')", 8), "closed and opened again: the job is still going on the server (25 of 30)")
    n0 = CALLS.count("status")
    job.update(status="done", done=30, updated_at=now()); push(job)
    ok(wait_for(pg, "document.body.innerText.includes('done, 30 days')", 5), "done: " + (re.search(r"Reading the day book[^\n]*done[^\n]*", pg.inner_text("body")) or [""])[0])
    ok(wait_for(pg, "true", 1) and CALLS.count("status") > n0, "and the books here ask the cloud copy again for what the server read")
    # Read the kept day books again: through the queue
    pg.evaluate("() => { S.account = S.account || {}; S.account.me = {role: 'owner'}; }")
    pg.evaluate("(cid) => TCloud.reparse(cid)", CID)
    rid = [k for k, v in JOBS.items() if v["kind"] == "reparse"]
    ok(rid and "reparse_queue" in CALLS, "read again: handed to the server's queue")
    r = JOBS[rid[0]]; r.update(status="running", done=2, updated_at=now()); push(r)
    ok(wait_for(pg, "(TCloud.jobs['%s'] || []).some(j => j.kind === 'reparse' && j.done === 2)" % CID, 5) and "2 of 3 months" in pg.evaluate("TCloud.jobLine(TCloud.jobs['%s'].find(j => j.kind === 'reparse'))" % CID),
       "and its line follows the job: " + pg.evaluate("TCloud.jobLine(TCloud.jobs['%s'].find(j => j.kind === 'reparse'))" % CID))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
