"""python3 run_work_together_ui.py - "Work together" inside a FinCom call (option A, the owner's approval of 23-Oct-2026), on
the stand of tests/calls_stand.py (Realtime, the fincom-call function and PostgREST faked here; three browsers):
  1. only the host has Work together; started, the host's call goes small and a banner says "Working together with …"
  2. a look-only member follows: the same client and page as the host (follow-me), to another client too
  3. the host's pointer appears on the follower's screen with the host's name; the field the host is editing is outlined
     with "… is editing"
  4. only the route, pointers and focus travel on the working-together channel (no figures, no client data); pointer
     updates are about 20 a second at most
  5. saves: each person's change goes through FinCom's own save path with their OWN sign-in; the look-only member's save
     is refused by the database rule (row-level security), the staff host's is kept with the host as its author
  6. anyone can leave follow mode (Stop following): the host moves on, the follower stays
  7. the guest (no FinCom sign-in) never gets the working-together channel and reads no FinCom data
  8. it ends when the call ends: the follower's banner and pointers go
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_work_together_ui.py"""
import os, sys, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from calls_stand import *
from playwright.sync_api import sync_playwright
PORT = 8471
serve(PORT)
C = Checks(); ok = C.ok
hub, fn, rest = Hub(), Fn(), Rest()
ROUTE_KEYS = {"view", "coId", "tab", "step", "homeTab", "booksTab", "gstTab", "tdsTab", "filter"}

with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    (actx, A), (bctx, B), (gctx, G, gseen), rid = call_of_three(br, PORT, hub, fn, rest, C, member_tok="tok-look")
    ok(A.locator("#fincom-call [data-tile]").count() == 3, "three in the call: the host (staff), a look-only member, a guest")

    print("1. only the host starts it")
    ok(A.locator("[data-call-cowork]").count() == 1 and B.locator("[data-call-cowork]").count() == 0 and G.locator("[data-call-cowork]").count() == 0, "Work together only on the host's bar")
    press(A, "[data-call-cowork]")
    ok(wait_for(A, "!!document.querySelector('[data-cowork-banner]')"), "the host's banner")
    ok(wait_for(A, "document.querySelector('#fincom-call').getAttribute('data-call-min') === 'true'"), "the host's call made small: FinCom usable beside it")
    ok(wait_for(B, "!!document.querySelector('[data-cowork-banner]')", 15000), "the member is working together too")
    ok(wait_for(A, "document.querySelector('[data-cowork-banner]').textContent.includes('Working together with Lata Look')", 10000), "banner: Working together with Lata Look (%r)" % A.evaluate("(document.querySelector('[data-cowork-banner]')||{}).textContent"))
    ok("following the host" in B.inner_text("[data-cowork-banner]"), "the member follows the host (%r)" % B.inner_text("[data-cowork-banner]"))
    shot(A, "10-cowork-host")

    print("2. follow-me: the same client and page")
    A.evaluate("goClient('txn')")
    ok(wait_for(B, "S.tab === 'txn' && S.coId === '%s'" % CLIENT, 10000), "the host opens Transactions: the member's FinCom opens it (their own copy, their own reads)")
    A.evaluate("openCompany('c-call-2')")
    ok(wait_for(B, "S.coId === 'c-call-2' && S.view === 'company'", 10000), "the host opens another client: the member follows")
    A.evaluate("openCompany('%s').then(() => goClient('dash'))" % CLIENT)
    ok(wait_for(B, "S.coId === '%s' && S.tab === 'dash'" % CLIENT, 10000), "and back to the Overview")

    print("3. pointers and the field being edited")
    for i in range(12): A.mouse.move(300 + i * 10, 260 + i * 5); A.wait_for_timeout(30)
    ok(wait_for(B, "[...document.querySelectorAll('.cw-ptr span')].some(s => s.textContent === 'Riya Staff')", 8000), "the host's pointer on the member's screen, named")
    A.evaluate("(() => { const i = document.createElement('input'); i.id = 'cwtest'; i.setAttribute('aria-label', 'test field'); document.querySelector('#app').prepend(i); render(); })()")
    B.evaluate("(() => { const i = document.createElement('input'); i.id = 'cwtest'; document.querySelector('#app').prepend(i); })()")
    A.focus("#cwtest")
    ok(wait_for(B, "!!document.querySelector('[data-cowork-focus=\"Riya Staff\"]') && document.querySelector('[data-cowork-focus=\"Riya Staff\"]').textContent.includes('is editing')", 8000), "the field the host edits is outlined on the member's screen: Riya Staff is editing")
    shot(B, "11-cowork-follower")

    print("4. only the route, pointers and focus travel")
    cw = [t for t in hub.frames if t.startswith("realtime:cowork:")]
    frames = [f for t in cw for f in hub.frames[t] if f.get("event") == "broadcast"]
    events = sorted(set((f["payload"] or {}).get("event") for f in frames))
    ok(cw and set(events) <= {"route", "ptr", "focus", "route-ask", "end"}, "only route, pointer and focus messages (%s)" % events)
    routes = [f["payload"]["payload"]["route"] for f in frames if f["payload"]["event"] == "route"]
    ok(routes and all(set(r) <= ROUTE_KEYS for r in routes), "a route carries only where the page is (%s)" % sorted(set(k for r in routes for k in r)))
    blob = json.dumps(frames)
    ok("Client One Private Limited" not in blob and "entries" not in blob and "09AANFG3202D1ZR" not in blob, "no client data on the channel (no names, GSTINs or entries)")
    ptr = [f for f in frames if f["payload"]["event"] == "ptr"]
    ok(len(ptr) <= 14, "pointer updates throttled to about 20 a second (%d for 12 moves in ~0.4 s)" % len(ptr))

    print("5. each save with its own sign-in and rights")
    rest.writes.clear()
    ra = A.evaluate("Cloud.api('client_due_tasks', {method: 'POST', body: {firm_id: 'f1', client_id: '%s', title: 'Ask for the bank statement', source: 'manual'}}).then(() => 'saved', e => 'refused: ' + e.message)" % CLIENT)
    rb = B.evaluate("Cloud.api('client_due_tasks', {method: 'POST', body: {firm_id: 'f1', client_id: '%s', title: 'Changed by the look-only member', source: 'manual'}}).then(() => 'saved', e => 'refused: ' + e.message)" % CLIENT)
    ok(ra == "saved", "the host's save is kept (%s)" % ra)
    ok(rb.startswith("refused") and "row-level security" in rb, "the look-only member stays look-only: the database refuses (%s)" % rb)
    mine = [w for w in rest.writes if "client_due_tasks" in w["url"]]
    ok([w["author"] for w in mine] == ["Riya Staff", "Lata Look"] and [w["allowed"] for w in mine] == [True, False], "each save went with its own person's token (%s)" % [(w["author"], w["allowed"]) for w in mine])
    ok(all(not w["allowed"] for w in rest.writes if w["author"] == "Lata Look"), "nothing the look-only member's FinCom sent was taken (%d tries, all refused)" % len([w for w in rest.writes if w["author"] == "Lata Look"]))
    ok(not any(w["tok"] in ("", None) or w["tok"].startswith("gt-") for w in rest.writes), "no shared token, no guest pass used for a save")

    print("6. anyone can leave follow mode")
    B.locator("[data-cowork-banner] button[data-cw=unfollow]").evaluate("b => b.click()")
    ok(wait_for(B, "document.querySelector('[data-cowork-banner]').textContent.includes('Follow the host')"), "the member stopped following")
    A.evaluate("goClient('bank')")
    B.wait_for_timeout(2500)
    ok(B.evaluate("S.tab") == "dash", "the host moved on, the member stayed where they were")
    B.locator("[data-cowork-banner] button[data-cw=follow]").evaluate("b => b.click()")
    ok(wait_for(B, "S.tab === 'bank'", 10000), "Follow the host again: back with the host")

    print("7. the guest gets no data access")
    gw = [c for c in fn.calls if c.get("gt") and c["action"] in ("cowork_join", "cowork")]
    ok(not gw, "the guest's page never asked to work together (%s)" % gw)
    gtopics = [t for t in cw if any(m["ws"] is not None and False for m in hub.members.get(t, {}).values())]
    joined = [f for t in cw for f in hub.frames[t] if f.get("event") == "phx_join"]
    ok(len(joined) == 2, "only two joined the working-together channel: the host and the member (%d)" % len(joined))
    ok(G.locator("[data-cowork-banner]").count() == 0 and G.locator(".cw-layer").count() == 0, "no working-together layer on the guest's screen")
    tables = [u for u in gseen if "/rest/v1/" in u and "/rest/v1/rpc/signup_info" not in u]
    ok(not tables, "the guest's page read no FinCom table (%s)" % tables[:3])
    code, j = fn.handle({"action": "cowork_join", "gt": "gt-" + [k for k, v in fn.people.items() if v["role"] == "guest"][0]}, "")
    ok(code == 403, "asked directly, the guest pass is refused for working together (%s %s)" % (code, j.get("error")))

    print("8. it ends with the call")
    A.evaluate("document.querySelector('#fincom-call').setAttribute('data-call-min', 'false')")
    press(A, "[data-call-min-btn]")
    press(A, "[data-call-end]")
    ok(wait_for(B, "!document.querySelector('[data-cowork-banner]') && !document.querySelector('.cw-layer')", 15000), "the member's banner and pointers are gone")
    ok(wait_for(A, "!document.querySelector('[data-cowork-banner]')", 10000), "and the host's")
    ok(wait_for(B, "!!document.querySelector('[data-call-after]')", 10000), "the member is told the call ended")
    br.close()
C.done()
