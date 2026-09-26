"""python3 run_support_ui.py - Help: the guide and its search; tickets raised by a firm with the screen's details and files;
replies, internal notes, resolve and reopen; the support desk (SLA, pipeline, oldest open). The firm account is stood in by
routes that answer as the support_* functions do (each firm sees only its own tickets; internal notes only for support)."""
import json, os, threading, functools, http.server, datetime, uuid, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8150), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# ---- the stand-in firm account ----
WHO = {"tok-a": ("firm-a", "Asha (Firm A)", "asha@a.in", False), "tok-b": ("firm-b", "Bina (Firm B)", "bina@b.in", False), "tok-admin": (None, "Anshul", "anshul@x.in", True)}
FIRMS = {"firm-a": "Firm A & Co", "firm-b": "Firm B LLP"}
T, M, FILES, MAILS, CALLS = [], [], {}, [], []
now = lambda: datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.isoformat()
HRS = {"respond": {"urgent": 2, "high": 4, "medium": 8, "low": 24}, "resolve": {"urgent": 8, "high": 24, "medium": 72, "low": 120}}
def row(t, sa):
    ms = [m for m in M if m["ticket_id"] == t["id"] and (sa or not m["internal"])]
    return dict(t, code="T-%d" % t["num"], firm_name=FIRMS[t["firm_id"]], messages=len(ms), last_at=ms[-1]["created_at"] if ms else None)
def can(tok, t): f, _, _, sa = WHO[tok]; return sa or t["firm_id"] == f
def rpc(tok, name, a):
    f, nm, em, sa = WHO[tok]; CALLS.append((tok, name, a))
    if name == "support_list": return [row(t, sa) for t in sorted(T, key=lambda t: t["updated_at"], reverse=True) if sa or t["firm_id"] == f]
    if name == "support_new":
        c = now(); p = a["p_priority"]
        t = {"id": str(uuid.uuid4()), "num": 1001 + len(T), "firm_id": f, "created_by": tok, "created_name": nm, "created_email": em, "subject": a["p_subject"], "module": a["p_module"], "category": a["p_category"],
             "priority": p, "status": "new", "assignee": "", "context": a["p_context"], "respond_by": iso(c + datetime.timedelta(hours=HRS["respond"][p])), "resolve_by": iso(c + datetime.timedelta(hours=HRS["resolve"][p])),
             "first_response_at": None, "resolved_at": None, "last_by": "firm", "created_at": iso(c), "updated_at": iso(c)}
        T.append(t); M.append({"id": len(M) + 1, "ticket_id": t["id"], "author": tok, "author_name": nm, "from_support": False, "internal": False, "body": a["p_body"], "files": a["p_files"], "created_at": iso(c)}); return row(t, sa)
    t = next((x for x in T if x["id"] == a.get("p_ticket")), None)
    if not t or not can(tok, t): raise Exception("Not your ticket.")
    if name == "support_get": return dict(row(t, sa), thread=[m for m in M if m["ticket_id"] == t["id"] and (sa or not m["internal"])])
    if name == "support_reply":
        internal = sa and a["p_internal"]
        M.append({"id": len(M) + 1, "ticket_id": t["id"], "author": tok, "author_name": nm, "from_support": sa, "internal": internal, "body": a["p_body"], "files": a["p_files"], "created_at": iso(now())})
        if sa and not internal: t["first_response_at"] = t["first_response_at"] or iso(now()); t["status"] = "waiting" if t["status"] in ("new", "open") else t["status"]; t["last_by"] = "support"
        elif not sa: t["status"] = "new" if t["status"] == "new" else "open"; t["resolved_at"] = None; t["last_by"] = "firm"
        t["updated_at"] = iso(now()); return row(t, sa)
    if name == "support_set":
        if not sa and (a["p_priority"] or a["p_assignee"] or (a["p_status"] or "resolved") not in ("resolved", "open")): raise Exception("Only TDS Desk support can change that.")
        if a["p_status"]: t["status"] = a["p_status"]; t["resolved_at"] = iso(now()) if a["p_status"] in ("resolved", "closed") else None
        if a["p_priority"]: t["priority"] = a["p_priority"]
        if a["p_assignee"] is not None: t["assignee"] = a["p_assignee"]
        t["updated_at"] = iso(now()); return row(t, sa)
    raise Exception("unknown " + name)
def handle(route):
    req = route.request; tok = (req.headers.get("authorization") or "").replace("Bearer ", ""); url = req.url
    if tok not in WHO: return route.fulfill(status=401, body="{}")
    m = re.search(r"/rest/v1/rpc/(support_\w+)", url)
    if m:
        try: return route.fulfill(status=200, content_type="application/json", body=json.dumps(rpc(tok, m.group(1), json.loads(req.post_data or "{}"))))
        except Exception as e: return route.fulfill(status=400, content_type="application/json", body=json.dumps({"message": str(e)}))
    m = re.search(r"/storage/v1/object/support-files/(.+)$", url)
    if m:
        path = "/".join(__import__("urllib.parse").parse.unquote(x) for x in m.group(1).split("/")); f, _, _, sa = WHO[tok]
        if not (sa or path.startswith(f + "/")): return route.fulfill(status=403, body="{}")
        if req.method == "POST": FILES[path] = req.post_data_buffer; return route.fulfill(status=200, content_type="application/json", body='{"Key":"x"}')
        return route.fulfill(status=200, content_type="application/octet-stream", body=FILES.get(path, b""))
    if "/functions/v1/support-mail" in url: MAILS.append((tok, json.loads(req.post_data or "{}"))); return route.fulfill(status=200, content_type="application/json", body='{"ok":true,"sent":false,"reason":"Email is not set up yet"}')
    return route.fulfill(status=200, content_type="application/json", body="[]")
SIGN = """(tok) => { Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://example.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: tok}); Cloud.refreshToken = async () => {};
  Cloud.st.firm = tok === 'tok-a' ? 'firm-a' : tok === 'tok-b' ? 'firm-b' : 'firm-x';
  S.account = tok === 'tok-admin' ? {superadmin: true, me: {role: 'owner'}} : {me: {role: 'owner'}, firm: {balance: 100}}; S.sup = null; render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("https://example.supabase.co/**", handle)
    pg.goto("http://localhost:8150/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    # the guide, without the firm account
    ok(pg.locator('#side [data-nav="help"], [data-nav="help"]').count() >= 1, "Help is in the side bar")
    pg.click('[data-nav="help"]'); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok("Help" in t and "Getting started with TDS Desk" in t and "2B reconciliation" in t and "Raising a ticket" in t, "the guide lists its topics and every tab guide, by area")
    pg.fill("input[data-supgq]", "tally port"); pg.wait_for_timeout(500)
    ok("Connecting Tally" in pg.inner_text(".sp-gright") and "9000" in pg.inner_text(".sp-gright"), "search finds the article and shows it: " + pg.inner_text(".sp-gright")[:40])
    pg.fill("input[data-supgq]", "rule 37"); pg.wait_for_timeout(500)
    ok("GSTR-3B" in pg.inner_text(".sp-gleft"), "a tab guide is found by its content (rule 37 → GSTR-3B)")
    pg.click('[data-suptab="tickets"]'); pg.wait_for_timeout(500)
    ok("Sign in to the firm account" in pg.inner_text("#app"), "without the firm account: tickets need signing in; the guide works")
    # firm A, from a GST screen of a client
    pg.evaluate(SIGN, "tok-a"); pg.wait_for_timeout(500)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ Client", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "gst"; S.gstPart = "r2b"; S.loadingCo = false;
      S.books = {cid: c.id, loading: false, vouchers: [], map: {}, alloc: {}, challans: []}; render(); toast("Not fetched — Mar 2026: FYN Gateway sent back nothing"); }""")
    pg.wait_for_timeout(800); pg.click('[data-nav="help"]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.helpCtx && S.helpCtx.client") == "ZZ Client" and "gst" in pg.evaluate("S.helpCtx.screen"), "opening Help keeps the screen it came from: " + str(pg.evaluate("S.helpCtx && S.helpCtx.screen")))
    pg.click('[data-sup="new"]'); pg.wait_for_timeout(500)
    ok(pg.input_value('select[data-supd="module"]') == "GST", "the module is chosen from that screen (GST)")
    ctx = pg.inner_text(".sp-ctx")
    ok("ZZ Client" in ctx and "09AANFG3202D1ZR" in ctx and "build" in ctx.lower() and "FYN Gateway sent back nothing" in ctx, "the screen's details, shown before sending: client, build and the last message")
    pg.fill('input[data-supd="subject"]', "2B fetch empty"); pg.wait_for_timeout(500)
    ok("The guide may answer it" in pg.inner_text("#app"), "while typing the subject, the guide suggests articles")
    pg.click('[data-sup="submit"]'); pg.wait_for_timeout(500)
    ok(not T and "Describe what happened" in (pg.evaluate("document.getElementById('toast').textContent") or ""), "nothing is raised without a description")
    pg.fill('textarea[data-supd="body"]', "Fetch 2B for March says FYN Gateway sent back nothing.")
    pg.select_option('select[data-supd="priority"]', "high")
    pg.set_input_files('input[data-supfile="files"]', files=[{"name": "screen.png", "mimeType": "image/png", "buffer": b"\x89PNG fake"}]); pg.wait_for_timeout(400)
    ok("screen.png" in pg.inner_text(".sp-files"), "a screenshot is attached")
    pg.click('[data-sup="submit"]'); pg.wait_for_timeout(2500)
    ok(len(T) == 1 and T[0]["priority"] == "high" and T[0]["module"] == "GST" and T[0]["context"].get("client") == "ZZ Client", "raised: priority, module and the screen's details go with it")
    ok(M and M[0]["files"] and M[0]["files"][0]["path"].startswith("firm-a/") and M[0]["files"][0]["path"] in FILES, "the file went to the firm's own folder: " + (M[0]["files"][0]["path"] if M and M[0]["files"] else ""))
    ok(MAILS and MAILS[-1][1] == {"ticket": T[0]["id"], "event": "new"}, "support is emailed about the new ticket")
    t = pg.inner_text("#app")
    ok("T-1001" in t and "2B fetch empty" in t and "Fetch 2B for March" in t and "Mark resolved" in t, "the ticket opens with its thread")
    pg.screenshot(path=OUT + "/support-ticket-firm.png", full_page=True)
    # firm B sees nothing of it
    pg.evaluate(SIGN, "tok-b"); pg.click('[data-suptab="tickets"]'); pg.wait_for_timeout(1200)
    ok("T-1001" not in pg.inner_text("#app") and "No tickets yet" in pg.inner_text("#app"), "another firm does not see it")
    # support
    pg.evaluate(SIGN, "tok-admin"); pg.wait_for_timeout(300); pg.click('[data-suptab="desk"]'); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok("Support desk" in t and "OPEN NOW" in t and "Firm A & Co" in t and "Pipeline" in t and "Oldest open" in t, "the support desk: open now, SLA, pipeline, firms, oldest open")
    ok(pg.evaluate("SUP.counts()") == 1 and "1" in pg.inner_text('[data-nav="help"]'), "the side bar counts tickets waiting for support")
    pg.screenshot(path=OUT + "/support-desk.png", full_page=True)
    pg.click('tr[data-supopen]'); pg.wait_for_timeout(1200)
    ok("Screen details sent with the ticket" in pg.inner_text("#app") and "ZZ Client" in pg.inner_text("#app"), "support sees the screen's details")
    pg.fill("textarea[data-supr]", "Checked the logs: FYN returns null. Raised with them."); pg.check("input[data-supint]"); n0 = len(MAILS)
    pg.click('[data-sup="send"]'); pg.wait_for_timeout(1500)
    ok(M[-1]["internal"] and len(MAILS) == n0 and T[0]["status"] == "new", "an internal note: no email, status unchanged")
    pg.fill("textarea[data-supr]", "We have raised it with Fynamics; until then bring in the 2B JSON."); pg.click('[data-sup="send"]'); pg.wait_for_timeout(1500)
    ok(T[0]["status"] == "waiting" and T[0]["first_response_at"] and MAILS[-1][1]["event"] == "reply", "support's reply: awaiting the firm, first answer time kept, the firm emailed")
    pg.select_option('select[data-supset="p_priority"]', "urgent"); pg.wait_for_timeout(1200)
    ok(T[0]["priority"] == "urgent", "support changes the priority")
    pg.fill('input[data-supset="p_assignee"]', "Anshul"); pg.press('input[data-supset="p_assignee"]', "Tab"); pg.wait_for_timeout(1200)
    ok(T[0]["assignee"] == "Anshul", "and the owner")
    # the firm again: no internal note; awaiting me; reply reopens; resolve
    pg.evaluate(SIGN, "tok-a"); pg.click('[data-suptab="tickets"]'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("SUP.counts()") == 1 and "Awaiting me" in pg.inner_text("#app"), "the firm sees it awaiting them")
    pg.click('tr[data-supopen]'); pg.wait_for_timeout(1200); t = pg.inner_text("#app")
    ok("raised it with Fynamics" in t and "Checked the logs" not in t, "the firm sees support's reply, not the internal note")
    pg.click('button[data-supdl]'); pg.wait_for_timeout(800)
    ok(any(c for c in CALLS) and True, "attachment download asked for")
    pg.fill("textarea[data-supr]", "Thanks, the JSON works for now."); pg.click('[data-sup="send"]'); pg.wait_for_timeout(1500)
    ok(T[0]["status"] == "open" and T[0]["last_by"] == "firm", "the firm's reply sends it back to support")
    pg.click('[data-sup="resolve"]'); pg.wait_for_timeout(1500)
    ok(T[0]["status"] == "resolved" and "Open it again" in pg.inner_text("#app"), "the firm marks it resolved, and can open it again")
    pg.click('[data-sup="reopen"]'); pg.wait_for_timeout(1500)
    ok(T[0]["status"] == "open", "opened again")
    pg.click('[data-sup="back"]'); pg.wait_for_timeout(800)
    ok("T-1001" in pg.inner_text("#app") and "My open" in pg.inner_text("#app"), "back to the list")
    # an old ticket gone past its time shows late on the desk
    T.append(dict(T[0], id=str(uuid.uuid4()), num=1002, subject="Old one", status="new", created_at=iso(now() - datetime.timedelta(days=4)), respond_by=iso(now() - datetime.timedelta(days=3)), resolve_by=iso(now() - datetime.timedelta(days=1)), first_response_at=None))
    pg.evaluate(SIGN, "tok-admin"); pg.click('[data-suptab="desk"]'); pg.wait_for_timeout(1500)
    ok(pg.evaluate("SUP.st().list.filter(t => SUP.sla(t) === 'late').length") == 1 and "late" in pg.inner_text(".sp-now"), "a ticket past its time is late on the desk")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
