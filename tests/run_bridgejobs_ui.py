"""python3 run_bridgejobs_ui.py - FinCom hands postings to bridge 1.12 as a job and follows it: a lost hand-over is sent
again with the same job number, a bridge that stops answering is waited for, a stopped job is resumed, an old bridge still
gets the one long /import, one missed status check does not show the bridge as offline, and a posting left over from
before a reload is reported. The owner's rule (19-Nov-2026): a posting goes only into the Tally company the client is linked
to, by its GUID: the link's company_guid travels as guid on /jobs and /import and as companyGuid on /unpost; a link with no
GUID sends nothing and says why. Only to a bridge that says it checks the GUID (/status linkGuid): an older one gets
nothing ("update FinCom Bridge"). The reasons are told apart: the link not read, two links with different companies, no
GUID yet; each asked before any confirm (a deletion, a new ledger), and Post automatically's undo says it. A made-up
company and GUID only."""
import os, sys, json, threading, functools, http.server, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bridge_proof import ping_body, is_ping
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8153), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test")))); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
M = {"version": "1.12.0", "seen": [], "jobs": {}, "dropPost": 0, "dropPoll": 0, "interruptOnce": False, "statusFail": 0, "polls": 0, "bodies": [], "linkGuid": True}
LG = "made-up-guid-0001"
def J(route, body, status=200): return route.fulfill(status=status, content_type="application/json", body=json.dumps(body))
def bridge(route):
    rq = route.request; u = rq.url; path = urllib.parse.urlparse(u).path; qs = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    if is_ping(u): return J(route, ping_body(u, "K" * 32))   # FinCom Bridge 2.3.0 proves itself before anything is sent
    M["seen"].append(rq.method + " " + path + ("?" + urllib.parse.urlparse(u).query if qs else ""))
    if rq.method == "POST" and path in ("/jobs", "/import", "/unpost"): M["bodies"].append((path, json.loads(rq.post_data or "{}")))
    if path == "/unpost": return J(route, {"ok": True, "message": "removed", "how": "test"})
    if path == "/status":
        if M["statusFail"] > 0: M["statusFail"] -= 1; return route.abort()
        jobs = [dict(id=k, status=v["status"], done=v["done"], total=v["total"], company="ZZ", message="") for k, v in M["jobs"].items() if v["status"] in ("running",)]
        return J(route, {"ok": True, "version": M["version"], "tallyUp": True, "sessions": [{"port": 9000, "ok": True, "mine": True, "companies": [{"name": "ZZ"}]}], "jobs": jobs, **({"linkGuid": True} if M["linkGuid"] else {})})
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
    pg.goto("http://localhost:8153/"); pg.wait_for_timeout(1500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(500)
    pg.evaluate("() => { Bridge.setCfg({key: 'K'.repeat(32)}); }"); pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && Bridge.st.version") == "1.12.0", "bridge 1.12 seen")
    # the client's link to ZZ, with its GUID (LinkRec's record, as FinCom's cloud gives it)
    LINK = "(g) => { let co = CO(); if (!co){ co = newCompany({name: 'ZZ'}); S.companies[co.id] = co; S.data[co.id] = {parties: {}, entries: {}, loaded: true}; co.stats = {}; S.coId = co.id; choiceConfirm(co, 'postTo', 'ZZ'); } LinkRec.on = () => true; LinkRec.st.missing = false; LinkRec.st.err = ''; LinkRec.load = async () => LinkRec.st.rows; LinkRec.st.rows = [{book_id: 'b-zz', client_id: co.id, company_guid: g, company_name: 'ZZ', state: 'linked', posting_allowed: true}]; return co.id; }"
    ok(bool(pg.evaluate(LINK, LG)), "a client linked to ZZ")

    # the link's GUID travels with the posting; a link with no GUID: nothing is sent, a plain reason
    M["seen"].clear(); M["bodies"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["g1"]})
    gs = [b.get("guid") for pth, b in M["bodies"] if pth == "/jobs"]
    ok(gs and all(g == LG for g in gs) and all(x["ok"] for x in o["r"]["results"]), "the posting names the linked company's GUID on /jobs: %s" % gs)
    pg.evaluate(LINK, ""); M["seen"].clear(); M["bodies"].clear(); M["jobs"].clear()
    o = pg.evaluate(POST, {"m": ["led:A"], "v": ["g2"]})
    rs = o["r"]["results"]
    ok(not M["bodies"] and len(rs) == 2 and all(not x["ok"] and "no company ID" in (x.get("message") or "") for x in rs), "a link with no GUID: nothing sent, each entry says why: %s" % [x.get("message", "")[:60] for x in rs])
    UNPOST = """async () => { const was = [toast, askConfirm, ensureTallyCompany]; let said = '', asked = 0; toast = m => { said = m; }; askConfirm = async () => { asked++; return true; }; ensureTallyCompany = async () => 'ZZ';
      try { await unpostFromTally('bill', {id: 'u1', tally: {guid: 'v-guid', vchType: 'Journal', vchDate: '20260701', company: 'ZZ'}}, CO().id); } finally { [toast, askConfirm, ensureTallyCompany] = was; } return {said, asked}; }"""
    t = pg.evaluate(UNPOST)
    ok(not M["bodies"] and "no company ID" in t["said"] and t["asked"] == 0, "a deletion with no GUID on the link: nothing sent, said before any confirm: %s" % t)
    # the reasons told apart: the link not read (the read failed; no records), two links with different companies
    pg.evaluate(LINK, LG)
    for setup, want, what in (("() => { LinkRec.load = async () => { LinkRec.st.err = 'made-up failure'; return LinkRec.st.rows; }; }", "could not read this client's Tally link", "the link records could not be read"),
                              ("() => { LinkRec.load = async () => { LinkRec.st.err = ''; return LinkRec.st.rows; }; LinkRec.st.rows = []; }", "is not linked to ZZ in FinCom", "no link records"),
                              ("() => { LinkRec.on = () => false; LinkRec.st.missing = false; }", "sign in to FinCom's cloud", "not signed in to FinCom's cloud"),
                              ("() => { LinkRec.on = () => false; LinkRec.st.missing = true; }", "is not linked to ZZ in FinCom", "a cloud without the link records"),
                              ("() => { LinkRec.on = () => true; LinkRec.st.missing = false; LinkRec.load = async () => LinkRec.st.rows; LinkRec.st.err = ''; LinkRec.st.rows = [{book_id: 'b-zz', client_id: CO().id, company_guid: 'made-up-guid-0001', company_name: 'ZZ', state: 'linked', posting_allowed: true}, {book_id: 'b-zz2', client_id: CO().id, company_guid: '', company_name: 'ZZ', state: 'linked', posting_allowed: true}]; }", "two Tally links for this client; keep one", "one link with a GUID, one without"),
                              ("() => { LinkRec.load = async () => LinkRec.st.rows; LinkRec.st.err = ''; LinkRec.st.rows = [{book_id: 'b-zz', client_id: CO().id, company_guid: 'made-up-guid-0001', company_name: 'ZZ', state: 'linked', posting_allowed: true}, {book_id: 'b-zz2', client_id: CO().id, company_guid: 'made-up-guid-0009', company_name: 'ZZ', state: 'linked', posting_allowed: true}]; }", "two Tally links named ZZ with different companies", "two links with different GUIDs")):
        pg.evaluate(setup); M["bodies"].clear(); M["jobs"].clear()
        o = pg.evaluate(POST, {"m": [], "v": ["r1"]})
        rs = o["r"]["results"]; t = pg.evaluate(UNPOST)
        ok(not M["bodies"] and rs and all(not x["ok"] and want in (x.get("message") or "") for x in rs) and want in t["said"] and t["asked"] == 0,
           "%s: nothing sent, the posting and the deletion say so: %s / %s" % (what, [x.get("message", "")[:70] for x in rs], t["said"][:70]))
    pg.evaluate(LINK, LG); pg.evaluate("() => { LinkRec.st.err = ''; }")
    # a closed period with no GUID on the link: not asked about (nor recorded), nothing sent
    pg.evaluate(LINK, ""); M["bodies"].clear()
    n = pg.evaluate("""async () => { if (typeof ClosedP !== "object") return -1; const was = ClosedP.gate; let asked = 0; ClosedP.gate = async (p) => { asked++; return []; };
      try { await Bridge.post({company: "ZZ", masters: [], vouchers: [{id: "c1", xml: "<x/>"}]}); } finally { ClosedP.gate = was; } return asked; }""")
    ok(n == 0 and not M["bodies"], "a link with no GUID: the closed-period question is not asked, nothing sent (%s)" % n)
    # each reason is the call's own (linkGuid returns it with the result), never one shared between calls
    r2 = pg.evaluate("""async () => { const a = linkGuid(CO(), 'ZZ'), b = linkGuid(CO(), 'NOT ZZ'); return [await a, await b]; }""")
    ok(isinstance(r2, list) and all(isinstance(x, dict) for x in r2) and r2[0].get("guid") == "" and "no company ID" in r2[0].get("why", "") and "is not linked to NOT ZZ" in r2[1].get("why", ""), "the reasons per call: %s" % r2)
    # a new ledger with no GUID on the link: no confirm asked, nothing sent
    pg.evaluate(LINK, ""); M["bodies"].clear()
    n = pg.evaluate("""async () => { const was = PostGate.masters; let asked = 0; PostGate.masters = async (p) => { asked++; return {masters: p.masters, results: []}; };
      try { await Bridge.post({company: "ZZ", masters: [{id: "led:N", xml: "<x/>"}], vouchers: [{id: "n1", xml: "<x/>"}]}); } finally { PostGate.masters = was; } return asked; }""")
    ok(n == 0 and not M["bodies"], "a link with no GUID: the new-ledger confirm is not asked, nothing sent (%s)" % n)
    # Post automatically's undo says the reason, not "Tally did not remove it"
    u = pg.evaluate("""async () => { const was = [AutoPost.may, postClearReady, bridgeLive, AutoPost.where]; AutoPost.may = () => true; postClearReady = async () => true; bridgeLive = () => true; AutoPost.where = () => 'tally';
      try { return await AutoPost.undo(CO().id, {id: 'au1', auto: {key: 'k', run: 'r'}, tally: {guid: 'v-guid', vchType: 'Journal', vchDate: '20260701', company: 'ZZ'}}, {noAsk: true}); }
      finally { [AutoPost.may, postClearReady, bridgeLive, AutoPost.where] = was; } }""")
    ok(not M["bodies"] and not u["ok"] and "no company ID" in (u.get("why") or ""), "Post automatically's undo with no GUID: says why (%s)" % u)
    # a bridge that does not say it checks the GUID: nothing sent to it, "update FinCom Bridge"
    # (its /status asked again right before the write: the page's last look still says linkGuid)
    pg.evaluate(LINK, LG); M["linkGuid"] = False; M["bodies"].clear(); M["jobs"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["o1"]}); t = pg.evaluate(UNPOST)
    rs = o["r"]["results"]
    ok(not M["bodies"] and rs and all(not x["ok"] and "update FinCom Bridge on this computer" in (x.get("message") or "") for x in rs) and "update FinCom Bridge" in t["said"] and t["asked"] == 0,
       "a bridge without linkGuid: nothing sent, the posting and the deletion say update the bridge: %s / %s" % ([x.get("message", "")[:60] for x in rs], t["said"][:60]))
    M["linkGuid"] = True; pg.evaluate("Bridge.refresh()")
    # the link record read afresh (past the 15 s copy) right before the write
    pg.evaluate(LINK, LG); M["bodies"].clear(); M["jobs"].clear()
    f = pg.evaluate("""async () => { const fs = []; LinkRec.load = async (force) => { fs.push(!!force); return LinkRec.st.rows; };
      await Bridge.post({company: "ZZ", masters: [], vouchers: [{id: "fr1", xml: "<x/>"}]}); return fs; }""")
    ok(True in f and any(pth == "/jobs" for pth, b in M["bodies"]), "the link record read afresh before the posting (%s)" % f)
    pg.evaluate(LINK, LG); M["bodies"].clear(); M["jobs"].clear()
    pg.evaluate("""async () => { const was = [toast, askConfirm, ensureTallyCompany]; toast = m => {}; askConfirm = async () => true; ensureTallyCompany = async () => 'ZZ';
      try { await unpostFromTally('bill', {id: 'u1', tally: {guid: 'v-guid', vchType: 'Journal', vchDate: '20260701', company: 'ZZ'}}, CO().id); } finally { [toast, askConfirm, ensureTallyCompany] = was; } }""")
    ub = [b for pth, b in M["bodies"] if pth == "/unpost"]
    ok(len(ub) == 1 and ub[0].get("companyGuid") == LG and ub[0].get("guid") == "v-guid", "a deletion names the linked company's GUID as companyGuid: %s" % ub)
    M["jobs"].clear()

    M["seen"].clear(); M["dropPost"] = 1
    o = pg.evaluate(POST, {"m": ["led:A"], "v": ["v1", "v2", "v3", "v4", "v5"]})
    ok(not any(s.startswith("POST /import") for s in M["seen"]), "bridge 1.12: posted as a job, not one long request")
    ok(len(M["jobs"]) == 1 and list(M["jobs"].values())[0]["creates"] == 2, "a lost hand-over is sent again with the same job number (one job, handed over twice)")
    ok(all(x["ok"] for x in o["r"]["results"]) and len(o["r"]["results"]) == 6, "all 6 come back as posted")
    ok(len(o["prog"]) >= 3 and o["prog"][-1][0] >= 4 and o["prog"][-1][1] == 6, "progress is reported as it goes (" + str([x[0] for x in o["prog"]]) + ")")
    ok(o["posting"] is None and o["left"] is None, "nothing left behind once done")

    M["jobs"].clear(); M["dropPoll"] = 3
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b", "c", "d"]})
    ok(all(x["ok"] for x in o["r"]["results"]) and any("not answering" in x[2] for x in o["prog"]), "the bridge stops answering for a while: FinCom waits and says so, then finishes")

    M["jobs"].clear(); M["interruptOnce"] = True
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b", "c", "d", "e", "f"]})
    M["interruptOnce"] = False
    ok(any(s.startswith("POST /jobs/resume") for s in M["seen"]) and all(x["ok"] for x in o["r"]["results"]), "a posting stopped part-way is resumed on its own and finishes")

    M["jobs"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["a", "bad", "skip", "c"]})
    rs = {x["id"]: x for x in o["r"]["results"]}
    ok(rs["a"]["ok"] and not rs["bad"]["ok"] and "Ledger" in rs["bad"]["message"] and not rs["skip"]["ok"] and len(rs) == 4, "every item gets an answer: a refused one with Tally's reason, one the job never reported as not posted")

    # an older bridge (1.11: one long /import, and no linkGuid): nothing sent to it; one with /import that says linkGuid:
    # the one /import request, naming the GUID
    M["version"] = "1.11.0"; M["linkGuid"] = False; pg.evaluate("Bridge.refresh()"); M["seen"].clear(); M["bodies"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b"]})
    ok(not M["bodies"] and all(not x["ok"] and "update FinCom Bridge" in (x.get("message") or "") for x in o["r"]["results"]), "an older bridge: nothing sent, update FinCom Bridge")
    M["linkGuid"] = True; pg.evaluate("Bridge.refresh()"); M["seen"].clear()
    o = pg.evaluate(POST, {"m": [], "v": ["a", "b"]})
    ok(any(s.startswith("POST /import") for s in M["seen"]) and not any("/jobs" in s for s in M["seen"]) and all(x["ok"] for x in o["r"]["results"]), "a bridge without jobs: the one /import request as before")
    ok(all(b.get("guid") == LG for pth, b in M["bodies"] if pth == "/import") and any(pth == "/import" for pth, b in M["bodies"]), "the /import names the linked company's GUID too")
    M["version"] = "1.12.0"; pg.evaluate("Bridge.refresh()")

    M["statusFail"] = 1; pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && Bridge.st.shaky === true"), "one missed status check: still connected (checking again), not 'offline'")
    pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && !Bridge.st.shaky"), "the next answer clears it")
    # go-bridge (review of 01-Oct-2026): misses close together (a bridge busy with Tally) are "reconnecting"; offline
    # only when it has not answered for two minutes (about three missed heartbeats)
    M["statusFail"] = 3; pg.evaluate("Bridge.refresh()"); pg.evaluate("Bridge.refresh()"); pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.up() && Bridge.st.shaky === true"), "three missed close together: still connected, reconnecting")
    M["statusFail"] = 1; pg.evaluate("() => { Bridge.okAt = Date.now() - 125000; }"); pg.evaluate("Bridge.refresh()")
    ok(pg.evaluate("Bridge.st.state") == "down", "no answer for over two minutes: shown as offline")
    M["statusFail"] = 0; pg.evaluate("Bridge.refresh()")

    M["jobs"].clear(); M["jobs"]["left-over-job-1"] = {"status": "running", "done": 4, "total": 10, "items": [], "creates": 1}
    pg.evaluate("Bridge.refresh()")
    # 24-Oct-2026 (next-tally-one-page): the old sidebar chip (bridgeChip, drawn into #sideBridge, gone with the old page) is
    # removed; the one Tally sign (tallyHere) must not alarm while the bridge posts
    ok(pg.evaluate("Bridge.up() && tallyHere(null).level !== 'bad'"), "while the bridge posts, the Tally sign says nothing alarming (%s)" % pg.evaluate("tallyHere(null).label"))
    M["jobs"]["left-over-job-1"].update(status="done", done=10, items=["x%d" % i for i in range(10)])
    pg.evaluate("() => { for (const k of ['tdsdesk:bridgejob', 'tdsdesk-test:bridgejob']) lsSet(k, JSON.stringify({id: 'left-over-job-1', at: Date.now()})); }")
    t = pg.evaluate("async () => { const was = toast; let said = ''; toast = m => { said = m; }; try { await bridgeLeftover(); } finally { toast = was; } return said; }") or ""
    ok("earlier posting" in t and "10 of 10" in t and (pg.evaluate("lsGet('tdsdesk:bridgejob')") is None or pg.evaluate("lsGet('tdsdesk-test:bridgejob')") is None), "after a reload, a posting handed over earlier is reported: " + t[:80])
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
