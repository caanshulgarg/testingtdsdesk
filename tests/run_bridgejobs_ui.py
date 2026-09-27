"""python3 run_bridgejobs_ui.py - TDS Desk hands postings to bridge 1.12 as a job and follows it: a lost hand-over is sent
again with the same job number, a bridge that stops answering is waited for, a stopped job is resumed, an old bridge still
gets the one long /import, one missed status check does not show the bridge as offline, and a posting left over from
before a reload is reported."""
import os, json, threading, functools, http.server, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8153), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test")))); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
M = {"version": "1.12.0", "seen": [], "jobs": {}, "dropPost": 0, "dropPoll": 0, "interruptOnce": False, "statusFail": 0, "polls": 0}
def J(route, body, status=200): return route.fulfill(status=status, content_type="application/json", body=json.dumps(body))
def bridge(route):
    rq = route.request; u = rq.url; path = urllib.parse.urlparse(u).path; qs = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    M["seen"].append(rq.method + " " + path + ("?" + urllib.parse.urlparse(u).query if qs else ""))
    if path == "/status":
        if M["statusFail"] > 0: M["statusFail"] -= 1; return route.abort()
        jobs = [dict(id=k, status=v["status"], done=v["done"], total=v["total"], company="ZZ", message="") for k, v in M["jobs"].items() if v["status"] in ("running",)]
        return J(route, {"ok": True, "version": M["version"], "tallyUp": True, "sessions": [{"port": 9000, "ok": True, "mine": True, "companies": [{"name": "ZZ"}]}], "jobs": jobs})
    if path == "/import":
        b = json.loads(rq.post_data); ids = [x["id"] for x in b.get("masters", []) + b.get("vouchers", [])]
        return J(route, {"ok": True, "company": b["company"], "results": [{"id": i, "ok": True, "verified": True} for i in ids]})
    if path == "/jobs" and rq.method == "POST":
        b = json.loads(rq.post_data); jid = b["jobId"]
        if jid not in M["jobs"]:
            items = [x["id"] for x in b.get("masters", []) + b.get("vouchers", [])]
            M["jobs"][jid] = {"status": "running", "done": 0, "total": len(items), "items": items, "creates": 0}
        M["jobs"][jid]["creates"] += 1
        if M["dropPost"] > 0: M["dropPost"] -= 1; return route.abort()      # the job was made, but the answer was lost
        j = M["jobs"][jid]; return J(route, {"ok": True, "id": jid, "status": j["status"], "done": 0, "total": j["total"], "results": []})
    if path == "/jobs/resume":
        jid = json.loads(rq.post_data)["id"]; M["jobs"][jid]["status"] = "running"; M["jobs"][jid]["resumed"] = True
        return J(route, {"ok": True, "id": jid, "status": "queued", "done": M["jobs"][jid]["done"], "total": M["jobs"][jid]["total"]})
    if path == "/jobs":
        jid = qs["id"][0]; j = M["jobs"].get(jid)
        if not j: return J(route, {"ok": False, "error": "No such job."}, 500)
        M["polls"] += 1
        if M["dropPoll"] > 0: M["dropPoll"] -= 1; return route.abort()
        if M["interruptOnce"] and j["done"] >= 2 and not j.get("resumed"):
            j["status"] = "interrupted"
        elif j["status"] == "running":
            j["done"] = min(j["total"], j["done"] + 2)
            if j["done"] >= j["total"]: j["status"] = "done"
        res = [{"id": i, "ok": i != "bad", "verified": True, **({} if i != "bad" else {"message": "Ledger missing"})} for i in j["items"][:j["done"]] if i != "skip"]
        return J(route, {"ok": True, "id": jid, "status": j["status"], "done": j["done"], "total": j["total"], "company": "ZZ", "port": 9000, "results": res, "message": "Posting " + str(j["done"]) + " of " + str(j["total"])})
    return J(route, {"ok": True})
POST = """async (a) => { const prog = []; const t0 = Date.now();
  const r = await Bridge.post({company: "ZZ", masters: a.m.map(id => ({id, xml: "<x/>"})), vouchers: a.v.map(id => ({id, xml: "<x/>"}))}, p => prog.push([p.done, p.total, p.message || ""]));
  return {r, prog, ms: Date.now() - t0, posting: Bridge.posting, left: lsGet("tdsdesk:bridgejob") || lsGet("tdsdesk-test:bridgejob")}; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1300, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("http://127.0.0.1:9100/**", bridge)
    pg.goto("http://localhost:8153/"); pg.wait_for_timeout(1500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(500)
    pg.evaluate("() => { Bridge.setCfg({key: 'K'.repeat(32)}); }"); pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && Bridge.st.version") == "1.12.0", "bridge 1.12 seen")

    M["seen"].clear(); M["dropPost"] = 1
    o = pg.evaluate(POST, {"m": ["led:A"], "v": ["v1", "v2", "v3", "v4", "v5"]})
    ok(not any(s.startswith("POST /import") for s in M["seen"]), "bridge 1.12: posted as a job, not one long request")
    ok(len(M["jobs"]) == 1 and list(M["jobs"].values())[0]["creates"] == 2, "a lost hand-over is sent again with the same job number (one job, handed over twice)")
    ok(all(x["ok"] for x in o["r"]["results"]) and len(o["r"]["results"]) == 6, "all 6 come back as posted")
    ok(len(o["prog"]) >= 3 and o["prog"][-1][0] >= 4 and o["prog"][-1][1] == 6, "progress is reported as it goes (" + str([x[0] for x in o["prog"]]) + ")")
    ok(o["posting"] is None and o["left"] is None, "nothing left behind once done")

    M["jobs"].clear(); M["dropPoll"] = 3
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b", "c", "d"]})
    ok(all(x["ok"] for x in o["r"]["results"]) and any("not answering" in x[2] for x in o["prog"]), "the bridge stops answering for a while: TDS Desk waits and says so, then finishes")

    M["jobs"].clear(); M["interruptOnce"] = True
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b", "c", "d", "e", "f"]})
    M["interruptOnce"] = False
    ok(any(s.startswith("POST /jobs/resume") for s in M["seen"]) and all(x["ok"] for x in o["r"]["results"]), "a posting stopped part-way is resumed on its own and finishes")

    M["jobs"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["a", "bad", "skip", "c"]})
    rs = {x["id"]: x for x in o["r"]["results"]}
    ok(rs["a"]["ok"] and not rs["bad"]["ok"] and "Ledger" in rs["bad"]["message"] and not rs["skip"]["ok"] and len(rs) == 4, "every item gets an answer: a refused one with Tally's reason, one the job never reported as not posted")

    M["version"] = "1.11.0"; pg.evaluate("Bridge.refresh()"); M["seen"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b"]})
    ok(any(s.startswith("POST /import") for s in M["seen"]) and not any("/jobs" in s for s in M["seen"]) and all(x["ok"] for x in o["r"]["results"]), "an older bridge: the one /import request as before")
    M["version"] = "1.12.0"; pg.evaluate("Bridge.refresh()")

    M["statusFail"] = 1; pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && Bridge.st.shaky === true"), "one missed status check: still connected (checking again), not 'offline'")
    pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && !Bridge.st.shaky"), "the next answer clears it")
    M["statusFail"] = 3; pg.evaluate("Bridge.refresh()"); pg.evaluate("Bridge.refresh()"); pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.st.state") == "down", "three missed in a row: shown as offline")
    M["statusFail"] = 0; pg.evaluate("Bridge.refresh()")

    M["jobs"].clear(); M["jobs"]["left-over-job-1"] = {"status": "running", "done": 4, "total": 10, "items": [], "creates": 1}
    pg.evaluate("Bridge.refresh()")
    ok("Posting to Tally: 4 of 10" in pg.evaluate("bridgeChip(null)"), "while the bridge posts, the chip says so instead of anything alarming")
    M["jobs"]["left-over-job-1"].update(status="done", done=10, items=["x%d" % i for i in range(10)])
    pg.evaluate("() => { for (const k of ['tdsdesk:bridgejob', 'tdsdesk-test:bridgejob']) lsSet(k, JSON.stringify({id: 'left-over-job-1', at: Date.now()})); }")
    t = pg.evaluate("async () => { const was = toast; let said = ''; toast = m => { said = m; }; try { await bridgeLeftover(); } finally { toast = was; } return said; }") or ""
    ok("earlier posting" in t and "10 of 10" in t and (pg.evaluate("lsGet('tdsdesk:bridgejob')") is None or pg.evaluate("lsGet('tdsdesk-test:bridgejob')") is None), "after a reload, a posting handed over earlier is reported: " + t[:80])
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
