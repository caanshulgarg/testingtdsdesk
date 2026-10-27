"""python3 run_remote_help_ui.py - remote help through RustDesk in a FinCom call (stage 2, option B, the owner's approval of
23-Oct-2026), on the stand of tests/calls_stand.py. RustDesk itself cannot run here: its rustdesk:// link is checked,
never opened.
  1. the rights: only the host, an owner or staff member, offers Remote help; a look-only member has no such button and
     the function refuses them
  2. the card: the host gives a reason (kept in the log); only the chosen person sees "Install/open RustDesk" with the
     download link and plain steps, types their RustDesk ID and shares it; never a password field
  3. the host sees the ID, "Connect in RustDesk" as RustDesk's own link (rustdesk://connection/new/<id>, no password) and
     Copy ID; marks it started when the other side accepted in RustDesk
  4. the banner "Remote control in progress" on both sides (and for the others in the call)
  5. End: the other side is told to close RustDesk; the log row has who, which client, start, end and the reason
  6. the client help page (English and Hindi, Windows and Mac, Android, iPhone, the safety note) is served beside the app
  7. (next-calls-complete) the person asked says No, thanks, or stops it while it runs (Stop the control): the host's
     side ends at once and the log row gets its end
  8. an iPhone: the card says plainly that Apple allows no control and its browser cannot share the screen; nothing to
     type or install; the host is told it is an iPhone
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_remote_help_ui.py"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from calls_stand import *
from playwright.sync_api import sync_playwright
PORT = 8481
serve(PORT)
C = Checks(); ok = C.ok
hub, fn, rest = Hub(), Fn(), Rest()

with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    (actx, A), (bctx, B), (gctx, G, gseen), rid = call_of_three(br, PORT, hub, fn, rest, C, member_tok="tok-look")

    print("1. the rights")
    press(B, "[data-call-people-btn]")
    ok(wait_for(A, "document.querySelectorAll('[data-person] [data-remote-start]').length === 2"), "the host (staff) can offer Remote help to each person")
    ok(B.locator("[data-remote-start]").count() == 0, "a look-only member has no Remote help button")
    rb = B.evaluate("Cloud.fn('fincom-call', {action: 'remote', op: 'start', room_id: '%s', reason: 'I want to look'}).then(() => 'started', e => 'refused: ' + e.kind)" % rid)
    ok(rb == "refused: role", "and the function refuses a look-only member (%s)" % rb)
    ok(len(fn.remote) == 0, "nothing logged for a refused start")

    print("2. the card on the guest's screen")
    A.once("dialog", lambda d: d.accept("Fix the Tally company path on their PC"))
    A.locator("[data-person^='Ram Kumar'] [data-remote-start]").evaluate("b => b.click()")
    ok(wait_for(A, "!!document.querySelector('[data-remote-host]')"), "the host's remote-help panel")
    ok(len(fn.remote) == 1 and fn.remote[0]["reason"] == "Fix the Tally company path on their PC", "the reason kept in the log (%s)" % fn.remote)
    ok(wait_for(G, "!!document.querySelector('[data-remote-card]')", 10000), "the guest sees the card")
    card = G.inner_text("[data-remote-card]")
    ok("Install or open RustDesk" in card and G.locator("[data-remote-card] a[href='https://rustdesk.com/download']").count() == 1, "Install/open RustDesk, with RustDesk's own download page")
    ok("Never share its password" in card and G.locator("[data-remote-card] input[type=password]").count() == 0, "never a password field; told never to share it")
    ok(B.locator("[data-remote-card]").count() == 0, "only the chosen person sees the card")
    ok(G.locator("[data-remote-share]").is_disabled(), "Share is off until an ID is typed")
    G.fill("[data-remote-idinput]", "123 456 789")
    shot(G, "12-remote-card-phone")
    press(G, "[data-remote-share]")

    print("3. the host connects with RustDesk's own link")
    ok(wait_for(A, "!!document.querySelector('[data-remote-id]') && document.querySelector('[data-remote-id]').textContent === '123456789'", 10000), "the host sees the ID")
    href = A.get_attribute("[data-remote-connect]", "href")
    ok(href == "rustdesk://connection/new/123456789", "Connect is RustDesk's own link, with no password (%s)" % href)
    shot(A, "13-remote-host")
    press(A, "[data-remote-started]")

    print("4. the banner on both sides")
    ok(wait_for(A, "!!document.querySelector('[data-remote-banner]')"), "the host: Remote control in progress")
    ok(wait_for(G, "!!document.querySelector('[data-remote-banner]') && document.querySelector('[data-remote-banner]').textContent.includes('controlling your computer')", 10000), "the guest: Remote control in progress, Riya is controlling your computer")
    ok(wait_for(B, "!!document.querySelector('[data-remote-banner]')", 10000), "the others in the call see it too")
    shot(G, "14-remote-banner-phone")

    print("5. End")
    press(A, "[data-remote-end]")
    ok(wait_for(G, "!!document.querySelector('[data-remote-ended]') && document.querySelector('[data-remote-ended]').textContent.includes('Close RustDesk')", 10000), "the guest is told to close RustDesk")
    ok(wait_for(A, "!document.querySelector('[data-remote-banner]')") and wait_for(B, "!document.querySelector('[data-remote-banner]')"), "the banner goes")
    row = fn.remote[0]
    ok(row["end"] and row["by"] == "Riya Staff" and row["client"] == CLIENT and row["peer"] == "Ram Kumar", "the log row: who, which client, the person, start and end (%s)" % row)

    print("7. the person asked stops it themselves, at any time (next-calls-complete)")
    A.once("dialog", lambda d: d.accept("Check the GST upload"))
    A.locator("[data-person^='Ram Kumar'] [data-remote-start]").evaluate("b => b.click()")
    ok(wait_for(G, "!!document.querySelector('[data-remote-card]')", 10000) and G.locator("[data-remote-no]").count() == 1, "the card has No, thanks")
    G.fill("[data-remote-idinput]", "987654321"); press(G, "[data-remote-share]")
    wait_for(A, "!!document.querySelector('[data-remote-started]')", 10000); press(A, "[data-remote-started]")
    ok(wait_for(G, "!!document.querySelector('[data-remote-stop]')", 10000), "while it runs, the guest has Stop the control")
    press(G, "[data-remote-stop]")
    ok(wait_for(A, "!document.querySelector('[data-remote-banner]') && !document.querySelector('[data-remote-host]')", 10000), "the host's side ends at once")
    ok(fn.remote[-1]["end"] and fn.remote[-1].get("stopped_by") == "Ram Kumar", "the log row ended by the guest (%s)" % fn.remote[-1])
    A.once("dialog", lambda d: d.accept("Look at the bank file"))
    A.locator("[data-person^='Ram Kumar'] [data-remote-start]").evaluate("b => b.click()")
    wait_for(G, "!!document.querySelector('[data-remote-no]')", 10000); press(G, "[data-remote-no]")
    ok(wait_for(A, "!!document.querySelector('[data-remote-declined]')", 10000) and not G.locator("[data-remote-card]").count(), "No, thanks: the host is told, nothing opened")
    ok(fn.remote[-1]["end"], "and the log row ended")
    A.locator("[data-remote-host] button:has-text('Cancel')").evaluate("b => b.click()")

    print("8. an iPhone: said plainly, nothing to install")
    ictx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, permissions=["camera", "microphone"],
                          user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")
    ictx.add_init_script(FAKE_SCREEN)
    I = ictx.new_page(); I.set_default_timeout(60000); wire(I, hub, fn, rest)
    I.goto("http://localhost:%d/" % PORT); I.wait_for_timeout(2500)
    if I.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): I.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); I.wait_for_timeout(1200)
    I.evaluate(setup_js("tok-owner")); I.wait_for_timeout(600)
    I.evaluate("(r) => FinComCall.join(r)", rid); wait_for(I, "!!document.querySelector('[data-call-join]')"); press(I, "[data-call-join]")
    wait_for(I, "!!document.querySelector('#fincom-call [data-call=in]')", 20000)
    ok(wait_for(A, "document.querySelectorAll('[data-person] [data-remote-start]').length === 3", 20000), "the iPhone member listed with Remote help")
    A.once("dialog", lambda d: d.accept("See the GST portal error"))
    A.locator("[data-person^='Anshul Owner'] [data-remote-start]").evaluate("b => b.click()")
    ok(wait_for(I, "!!document.querySelector('[data-remote-card-dev=ios]')", 10000) and "not possible" in I.inner_text("[data-remote-card]") and I.locator("[data-remote-idinput]").count() == 0, "the iPhone's card: not possible (Apple), nothing to type or install")
    ok(wait_for(A, "!!document.querySelector('[data-remote-dev=ios]')", 10000), "the host is told it is an iPhone, and what to do instead")
    shot(I, "15-remote-iphone")
    press(I, "[data-remote-no]")
    ictx.close()

    print("6. the client help page")
    H = actx.new_page(); H.goto("http://localhost:%d/remote-help.html" % PORT)
    t = H.inner_text("body")
    ok("Windows" in t and "Mac" in t and "Never accept a remote-control request you did not expect" in t, "English: Windows, Mac, the safety note")
    ok("हिन्दी" in t and "रिमोट" in t and "पासवर्ड" in t, "Hindi too")
    ok(H.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "fits the window")
    br.close()
C.done()
