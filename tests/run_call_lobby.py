"""python3 run_call_lobby.py - someone asking to join reaches the host wherever FinCom is open (next-calls-lobby, 25-Oct-2026).
The owner, 25-Oct 22:56 IST: a guest asked to join while he was on his iPhone "but I did not get any request"; and his own
iPhone, opened from the invite link at 17:25, showed the call he had left at 17:10 (his Mac's leave closed the one row a
person has) while its people list was refused every 3 s, silently. In Chromium with fake camera and microphone; the
fincom-call function and Supabase Realtime faked in this process (tests/calls_stand.py):
  1. the host on another page of FinCom (no call open): a guest (phone, 390) opens the link: "Sign in with FinCom" or join
     as a guest; asks; the host's pop-up "<name> is asking to join <meeting> · Admit · Open the meeting · Deny" within 3 s
     (the realtime ping), with the bell entry; the guest reads "Waiting for <host> to let you in"
  2. Admit from the pop-up: the guest is in, the host's call screen never opened
  3. the host away (no FinCom for 90 s): the guest reads "The host isn't in the meeting yet — they've been notified"; staff
     get the pop-up and Deny; the guest is told
  4. the host on a phone (390): the pop-up fits; Open the meeting: straight into the call (no lobby), the waiting count on
     People and the "wants to join" bar; admitted there
  5. the same account on two devices: the Mac leaves, the iPhone says so in words within a few seconds (no silent
     retries) and Rejoin brings it back in
  6. the invite link opened in a tab still showing another call: the link's meeting is joined afresh
  7. a fresh browser (390) with no FinCom session: Sign in with FinCom, sign in, the same meeting opens as the member
  8. the guest asked 10 minutes: "No one has let you in yet" and Ask again (the host pinged again)
  9. stale rows (server, Deno): no heartbeat for 60 s is left; the old "admitted" row does not keep the room open
Screenshots (CALL_SHOTS, else the scratchpad's lobby-shots): 1440 and 390.
Run on app/dist-test: python3 tests/run_call_lobby.py"""
import os, sys, time, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("CALL_SHOTS", os.environ.get("LOBBY_SHOTS", ""))
import calls_stand
from calls_stand import *
from playwright.sync_api import sync_playwright
PORT = 8471
serve(PORT)
C = Checks(); ok = C.ok
hub, fn, rest = Hub(), Fn(allow_recording=True, mail=False), Rest()
OWNER = USERS["tok-owner"]

def snap(pg, name):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True)
    try: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
    except Exception as e: print("  (screenshot %s: %s)" % (name, e))
def no_hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def inside(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.top >= 0; }", sel)
def watching(tok_id, ms=8000):
    t0 = time.time()
    while time.time() - t0 < ms / 1000.0:
        if fn.watch.get(tok_id): return True
        time.sleep(0.2)
    return False
def meeting(u, title):
    return fn._room(u, kind="meeting", title=title, status="scheduled")
def ask(G, name, email):
    wait_for(G, "!!document.querySelector('[data-guest-name]')")
    G.fill("[data-guest-name]", name); G.fill("[data-guest-email]", email); press(G, "[data-guest-continue]")
def roster_calls(tok): return sum(1 for c in fn.calls if c["action"] == "roster" and c["tok"] == tok)

with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    print("1. the host elsewhere in FinCom; a guest asks by the link")
    actx, A = member_page(br, PORT, "tok-owner", hub, fn, rest, C, viewport=(1440, 900))
    ok(watching(OWNER["id"]), "the host's FinCom asks who is waiting (lobby) once signed in")
    ok(A.evaluate("!document.querySelector('#fincom-call')"), "no call open on the host's page")
    r1 = meeting(OWNER, "Meeting with Anu")
    gctx, G, _ = guest_page(br, PORT, "http://localhost:%d/#/join/%s" % (PORT, r1["code"]), hub, fn, rest, C)
    wait_for(G, "!!document.querySelector('[data-guest-name]')")
    ok(G.locator("[data-member-signin]").count() == 1 and "Sign in with FinCom" in G.inner_text("[data-member-signin]") and G.locator("[data-guest-or]").count() == 1,
       "the link's page offers Sign in with FinCom, or join as a guest")
    ok(no_hscroll(G), "the guest's page at 390: no sideways scroll")
    snap(G, "390-guest-link-choice")
    ask(G, "Dr. Anu Tyagi Garg", "anu@x.test")
    t0 = time.time()
    got = wait_for(A, "!!document.querySelector('[data-knock-pop]')", 3000, 100)
    took = time.time() - t0
    ok(got, "the host's pop-up within 3 s (%.1f s)" % took)
    txt = A.evaluate("(document.querySelector('[data-knock-text]') || {}).textContent || ''")
    ok(txt == "Dr. Anu Tyagi Garg is asking to join Meeting with Anu", "its words: %r" % txt)
    ok(all(A.locator(s).count() == 1 for s in ("[data-knock-pop-admit]", "[data-knock-pop-open]", "[data-knock-pop-deny]")), "Admit · Open the meeting · Deny")
    ok(inside(A, "[data-knock-pop]"), "on screen, over the page")
    wait_for(G, "(document.querySelector('[data-guest-waiting]') || {}).textContent === 'Waiting for Anshul Owner to let you in'", 6000)
    ok(G.inner_text("[data-guest-waiting]").strip() == "Waiting for Anshul Owner to let you in", "the guest: %r" % G.inner_text("[data-guest-waiting]").strip())
    snap(A, "1440-host-popup"); snap(G, "390-guest-waiting-host-online")
    A.click("[data-bell]"); A.wait_for_timeout(300)
    ok(A.locator('[data-alert-key^="knock:"]').count() == 1 and "asking to join" in A.inner_text('[data-alert-key^="knock:"]'), "and in the bell")
    snap(A, "1440-host-bell")
    A.keyboard.press("Escape"); A.wait_for_timeout(200)

    print("2. Admit from the pop-up")
    press(A, "[data-knock-pop-admit]")
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "the guest is in the meeting")
    ok(A.evaluate("!document.querySelector('#fincom-call')"), "the host's call screen never opened")
    ok(wait_for(A, "!document.querySelector('[data-knock-pop]')", 4000), "the pop-up is gone")
    gctx.close()

    print("3. the host away: staff are asked; the guest is told")
    actx.close(); fn.watch[OWNER["id"]] = time.time() - 200
    sctx, S = member_page(br, PORT, "tok-staff", hub, fn, rest, C, viewport=(1440, 900))
    watching(USERS["tok-staff"]["id"])
    r2 = meeting(OWNER, "Year-end review")
    gctx, G, _ = guest_page(br, PORT, "http://localhost:%d/#/join/%s" % (PORT, r2["code"]), hub, fn, rest, C)
    ask(G, "Ram Kumar", "ram@x.test")
    ok(wait_for(S, "!!document.querySelector('[data-knock-pop]')", 3000, 100), "staff get the pop-up (the host isn't online)")
    ok("The host isn't online" in S.inner_text("[data-knock-pop]"), "and are told why")
    wait_for(G, "(document.querySelector('[data-guest-waiting]') || {}).textContent === \"The host isn't in the meeting yet — they've been notified\"", 6000)
    ok(G.inner_text("[data-guest-waiting]").strip() == "The host isn't in the meeting yet — they've been notified", "the guest: %r" % G.inner_text("[data-guest-waiting]").strip())
    ok(G.locator("[data-guest-keep]").count() == 1, "and to keep the page open")
    snap(G, "390-guest-waiting-host-away"); snap(S, "1440-staff-popup")
    press(S, "[data-knock-pop-deny]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-denied]')", 10000), "Deny: the guest is told")
    gctx.close(); sctx.close()

    print("4. the host on a phone: the pop-up fits; Open the meeting")
    pctx, P = member_page(br, PORT, "tok-owner", hub, fn, rest, C, viewport=(390, 844))
    watching(OWNER["id"])
    r3 = meeting(OWNER, "Meeting with a long name for a phone screen")
    gctx, G, _ = guest_page(br, PORT, "http://localhost:%d/#/join/%s" % (PORT, r3["code"]), hub, fn, rest, C)
    ask(G, "Dr. Anu Tyagi Garg", "anu@x.test")
    ok(wait_for(P, "!!document.querySelector('[data-knock-pop]')", 3000, 100), "the phone's pop-up within 3 s")
    ok(inside(P, "[data-knock-pop]") and no_hscroll(P), "inside the 390 screen, no sideways scroll")
    snap(P, "390-host-popup")
    press(P, "[data-knock-pop-open]")
    ok(wait_for(P, "!!document.querySelector('#fincom-call [data-call=in]')", 20000), "Open the meeting: straight in (no lobby)")
    ok(wait_for(P, "!!document.querySelector('[data-waiting-count]') && !!document.querySelector('[data-knock]')", 8000), "the waiting count on People and the 'wants to join' bar")
    ok(P.evaluate("(document.querySelector('[data-waiting-count]') || {}).textContent") == "1", "one waiting")
    ok(P.evaluate("!document.querySelector('[data-knock-pop]')"), "the page's pop-up leaves it to the call screen")
    snap(P, "390-host-in-call-waiting")
    press(P, "[data-knock-admit]")
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "admitted from the call")
    gctx.close()

    print("5. the same account on two devices: the Mac leaves; the iPhone is told, then Rejoin")
    mctx, M = member_page(br, PORT, "tok-owner", hub, fn, rest, C, viewport=(1440, 900))
    M.evaluate("(r) => FinComCall.join(r)", r3["id"]); wait_for(M, "!!document.querySelector('[data-call-join]')"); press(M, "[data-call-join]")
    ok(wait_for(M, "!!document.querySelector('#fincom-call [data-call=in]')", 20000), "the Mac joins the same meeting (one row a person)")
    press(M, "[data-call-leave]"); M.wait_for_timeout(500)
    ok(wait_for(P, "!!document.querySelector('[data-call-gone]')", 8000), "the iPhone says so within a few seconds")
    gone = P.evaluate("(document.querySelector('[data-call-gone-text]') || {}).textContent || ''")
    ok("another device" in gone, "in words: %r" % gone)
    n = roster_calls("tok-owner"); P.wait_for_timeout(6000)
    ok(roster_calls("tok-owner") == n, "no silent retries after the refusal (%d -> %d)" % (n, roster_calls("tok-owner")))
    snap(P, "390-host-left-elsewhere")
    press(P, "[data-call-rejoin]")
    ok(wait_for(P, "!!document.querySelector('#fincom-call [data-call=in]') && !document.querySelector('[data-call-gone]')", 20000), "Rejoin: back in the meeting")
    me = next((x for x in fn.people.values() if x["room"] == r3["id"] and x.get("user") == OWNER["id"]), {})
    ok(me.get("state") == "admitted", "the place is the iPhone's again")
    mctx.close()

    print("6. the invite link opened in a tab showing another call")
    r4 = meeting(OWNER, "Next meeting")
    before = sum(1 for c in fn.calls if c["action"] == "join_code" and c["body"].get("code") == r4["code"])
    P.evaluate("(c) => { location.hash = '#/join/' + c; }", r4["code"])
    wait_for(P, "!!document.querySelector('[data-call-join]')", 10000)
    if P.locator("[data-call-join]").count(): press(P, "[data-call-join]")
    ok(wait_for(P, "(document.querySelector('#fincom-call [data-call=in]') || {}).getAttribute && document.querySelector('#fincom-call [data-call=in]').getAttribute('data-room') === %r" % r4["id"], 20000),
       "the link's meeting is joined afresh (not the old call brought back)")
    ok(sum(1 for c in fn.calls if c["action"] == "join_code" and c["body"].get("code") == r4["code"]) > before, "by the member's own way in (join_code), not as a guest")
    pctx.close()

    print("7. a fresh browser (390), no FinCom session: Sign in with FinCom")
    fctx, F, _ = guest_page(br, PORT, "http://localhost:%d/#/join/%s" % (PORT, r4["code"]), hub, fn, rest, C)
    wait_for(F, "!!document.querySelector('[data-member-signin]')")
    press(F, "[data-member-signin]")
    F.wait_for_timeout(3000)
    ok(F.evaluate("!location.hash.startsWith('#/join') && !document.querySelector('[data-guest-join]')"), "FinCom opens (its sign-in), the meeting kept for after")
    ok(F.evaluate("(() => { try { return JSON.parse(localStorage.getItem('fincom.join-after')).code; } catch (e) { return ''; } })()") == r4["code"], "the meeting's code kept on this browser")
    if F.locator('button[data-act="useOffline"]').count(): F.click('button[data-act="useOffline"]'); F.wait_for_timeout(800)
    F.evaluate(setup_js("tok-owner"))            # signed in
    ok(wait_for(F, "!!document.querySelector('[data-call-join]')", 10000), "signed in: the same meeting opens")
    press(F, "[data-call-join]")
    ok(wait_for(F, "!!document.querySelector('#fincom-call [data-call=in]')", 20000), "joined as the member")
    last = [c for c in fn.calls if c["action"] == "join_code" and c["tok"] == "tok-owner"][-1:]
    ok(bool(last) and last[0]["body"].get("code") == r4["code"], "through the member's way in, with the link's code")
    snap(F, "390-signed-in-from-link")
    fctx.close()

    print("8. the guest asked 10 minutes: Ask again")
    actx, A = member_page(br, PORT, "tok-owner", hub, fn, rest, C, viewport=(1440, 900))
    r5 = meeting(OWNER, "Late meeting")
    gctx, G, _ = guest_page(br, PORT, "http://localhost:%d/#/join/%s" % (PORT, r5["code"]), hub, fn, rest, C)
    ask(G, "Sita Devi", "sita@x.test")
    wait_for(G, "!!document.querySelector('[data-guest-waiting]')")
    G.evaluate("() => { const d = Date.now.bind(Date); Date.now = () => d() + 11 * 60000; }")
    ok(wait_for(G, "!!document.querySelector('[data-guest-timeout]')", 8000), "after 10 minutes: No one has let you in yet")
    snap(G, "390-guest-timeout")
    n = len(fn.pings)
    press(G, "[data-guest-retry]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-waiting]')", 6000) and len(fn.pings) > n, "Ask again: waiting again, the host pinged again")
    ok(wait_for(A, "!!document.querySelector('[data-knock-pop]')", 4000), "and the host's pop-up")
    gctx.close(); actx.close()
    br.close()

print("9. stale rows (the server, Deno)")
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if DENO:
    r = subprocess.run([DENO, "test", "--allow-net", "--allow-env", "--filter", "/stale|old admitted|second device|Mac/", "server/video-calls/handler_test.ts"], cwd=os.path.join(HERE, ".."), env=dict(os.environ, NO_COLOR="1"), capture_output=True, text=True, timeout=300)
    for line in (r.stdout + r.stderr).splitlines():
        if " ... ok" in line or " ... FAILED" in line: print("   ", line.strip())
    ok(r.returncode == 0 and " ... ok" in r.stdout, "stale rows marked left after 60 s, a phone back in, the old admitted row closed")
else:
    print("  (no deno: run_video_calls_server.py covers these)")
C.done()
