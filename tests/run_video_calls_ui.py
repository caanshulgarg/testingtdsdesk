"""python3 run_video_calls_ui.py - calls inside FinCom, stage 1 (the owner's approval of 23-Oct-2026), in Chromium with fake
camera and microphone (--use-fake-device-for-media-stream); Supabase Realtime and the fincom-call function faked in this
process (tests/calls_stand.py), peer to peer between the browsers for real (WebRTC on this computer):
  1. the call screen is not loaded with FinCom: none of its files fetched until a call is opened; legacy.js has none of it
  2. the host (staff) opens the client's Overview, Call › Call client; the lobby; effects: blur loads MediaPipe from this
     site (each file's sha256 checked) and the picture goes through it, the choice remembered; off again: the camera as is
  3. a second browser (the owner) joins from Call › Past calls; each sees the other's picture (video frames arriving)
  4. chat: a line with a link (a link, opened safely), a file (put at its signed address), both seen by the other and kept
  5. screen share: the other sees the shared screen
  6. a guest by link on a phone-sized screen: name, email, the code, the waiting room; the host admits them from People
  7. recording: the notice "This call is being recorded" shown to everyone; the member's microphone held until they stay;
     the composite recording's parts and each person's microphone pieces uploaded
  8. the host removes the guest: the guest is told, the others' channel moves on
  9. raise hand and a reaction reach the others; mute all mutes the others
 10. the host ends the call: the transcript (stubbed Whisper) in the order said with names, the summary (stubbed AI),
     the action items added to the client's due list
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_video_calls_ui.py
CALL_SHOTS=<folder> saves screenshots."""
import os, sys, hashlib, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from calls_stand import *
from playwright.sync_api import sync_playwright
PORT = 8461
serve(PORT)
C = Checks(); ok = C.ok
hub, fn, rest = Hub(), Fn(allow_recording=True), Rest()

def tiles(pg): return pg.evaluate("[...document.querySelectorAll('#fincom-call [data-tile]')].map(t => t.getAttribute('data-tile'))")
def playing(pg, name_part):
    return pg.evaluate("(n) => [...document.querySelectorAll('#fincom-call [data-tile]')].some(t => t.getAttribute('data-tile').includes(n) && t.querySelector('video') && t.querySelector('video').videoWidth > 0)", name_part)

with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    print("1. the call screen is not part of FinCom's first load")
    actx, A = member_page(br, PORT, "tok-staff", hub, fn, rest, C)
    asked = []; A.on("request", lambda r: asked.append(r.url))
    A.wait_for_timeout(800)
    ok(not any(("CallScreen-" in u or "mediapipe" in u or "/calls-" in u) for u in asked), "no call file fetched with the page")
    leg = open(os.path.join(SITE, "legacy.js"), encoding="utf-8").read()
    ok("fincom-call" not in leg and "RTCPeerConnection" not in leg, "legacy.js carries none of the calls' code")
    sw = open(os.path.join(SITE, "sw.js"), encoding="utf-8").read()
    ok("CallScreen-" not in sw and "CallMenu-" not in sw, "the service worker does not keep the call files ahead")

    print("2. Call client: the lobby and the effects")
    ok(A.locator("[data-call-menu] summary").count() == 1, "the one Call button on the client's Overview")
    A.click("[data-call-menu] summary"); A.click("[data-call-client]")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-call=lobby]')"), "the lobby opens (the call's file fetched now)")
    ok(any("CallScreen-" in u for u in asked), "its file fetched only now")
    ok(wait_for(A, "!!document.querySelector('[data-preview]') && document.querySelector('[data-preview]').videoWidth > 0"), "the camera's preview (fake device)")
    A.click("#fincom-call [data-call-effects]")
    ok(A.locator("[data-fx-bg=blur]").count() == 1 and A.locator("[data-fx-bg=office]").count() == 1 and A.locator("[data-fx-bg=own]").count() == 1, "blur, FinCom backgrounds, your own image")
    ok(A.evaluate("document.querySelector('#fincom-call [data-call]').dataset.fx") == "off", "effects off by default")
    A.click("[data-fx-bg=blur]")
    seg = wait_for(A, "document.querySelector('#fincom-call [data-call]').dataset.fx === 'seg'", 40000, 500)
    mp = [u for u in asked if "/assets/mediapipe/" in u]
    ok(all(any(f in u for u in mp) for f in ("vision_bundle.mjs", "vision_wasm_internal.js", "vision_wasm_internal.wasm", "selfie_segmenter.tflite")), "MediaPipe's four files fetched from this site (%d)" % len(mp))
    note = A.evaluate("(document.querySelector('#fincom-call .call-err') || {}).textContent || ''")
    ok(seg, "blur on: the picture goes through the selfie segmenter" + ("" if seg else " (note: %s)" % note))
    for f, sha in [("vision_wasm_internal.wasm", "6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc"), ("selfie_segmenter.tflite", "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b")]:
        ok(hashlib.sha256(open(os.path.join(SITE, "assets", "mediapipe", f), "rb").read()).hexdigest() == sha, "the served %s is the pinned file" % f)
    A.check("[data-fx-light-toggle]")
    ok(A.evaluate("JSON.parse(localStorage.getItem('fincom.call-fx:' + Cloud.sess().user_id)).bg") == "blur" and A.evaluate("JSON.parse(localStorage.getItem('fincom.call-fx:' + Cloud.sess().user_id)).light") is True, "the choice remembered for this person")
    shot(A, "01-lobby-blur")
    A.click("[data-fx-bg=none]"); A.uncheck("[data-fx-light-toggle]")
    ok(wait_for(A, "document.querySelector('#fincom-call [data-call]').dataset.fx === 'off'"), "all off: the camera goes out untouched")
    A.click("[data-call-join]")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-call=in]')"), "the host is in the call")
    ok("Up to 4 people" in A.inner_text("#fincom-call .call-top"), "peer to peer until Cloudflare is set up: up to 4 people, said")
    start = [c for c in fn.calls if c["action"] == "start"]
    ok(start and start[0]["body"].get("kind") == "client" and start[0]["body"].get("client_id") == CLIENT and start[0]["tok"] == "tok-staff", "start: a client call for this client, with the host's own sign-in")

    print("3. the owner joins from Past calls; both see each other")
    bctx, B = member_page(br, PORT, "tok-owner", hub, fn, rest, C)
    press(B, "[data-call-menu] summary"); press(B, "[data-call-history]")
    ok(wait_for(B, "!!document.querySelector('[data-call-history-list]') && document.querySelector('[data-call-history-list]').textContent.includes('Call with Client One')"), "Past calls lists the open call")
    press(B, "[data-call-history-list] button:has-text('Join')")
    ok(wait_for(B, "!!document.querySelector('#fincom-call [data-call=lobby]')"), "the owner's lobby")
    press(B, "[data-call-join]")
    ok(wait_for(B, "!!document.querySelector('#fincom-call [data-call=in]')"), "the owner is in the call")
    both = wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 20000) and wait_for(B, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 20000)
    ok(both, "each sees two people (%s / %s)" % (tiles(A), tiles(B)))
    ok(wait_for(A, "[...document.querySelectorAll('#fincom-call [data-tile]')].some(t => t.dataset.tile.includes('Anshul') && t.querySelector('video') && t.querySelector('video').videoWidth > 0)", 30000), "the host receives the owner's picture over WebRTC")
    ok(wait_for(B, "[...document.querySelectorAll('#fincom-call [data-tile]')].some(t => t.dataset.tile.includes('Riya') && t.querySelector('video') && t.querySelector('video').videoWidth > 0)", 30000), "the owner receives the host's picture")
    shot(A, "02-two-people")

    print("4. chat with a link and a file")
    press(A, "[data-call-chat-btn]"); A.fill("[data-chat-input]", "The challan is at https://example.com/challan.pdf please check"); A.press("[data-chat-input]", "Enter")
    ok(wait_for(B, "document.querySelector('[data-call-chat-btn]').textContent.includes('(1)')"), "the owner is told of a new line")
    press(B, "[data-call-chat-btn]")
    ok(wait_for(B, "!!document.querySelector('[data-call-chat] a[href=\"https://example.com/challan.pdf\"]')"), "the link shown as a link")
    ok(B.evaluate("document.querySelector('[data-call-chat] a').rel") == "noopener noreferrer nofollow", "opened safely (noopener)")
    B.set_input_files("[data-chat-fileinput]", files=[{"name": "bills-sept.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 test" * 100}])
    ok(wait_for(A, "!!document.querySelector('[data-call-chat] [data-chat-file=\"bills-sept.pdf\"]')"), "the file reaches the host's chat")
    ok(any(u["size"] == 1300 for u in fn.uploads), "the file put at its signed address (%s)" % [u["size"] for u in fn.uploads])
    ok(len([m for m in fn.msgs]) == 2 and fn.msgs[1]["file"]["name"] == "bills-sept.pdf", "both kept (the function's chat)")
    shot(B, "03-chat")

    print("5. screen share")
    press(A, "[data-call-share]")
    ok(wait_for(B, "!!document.querySelector('#fincom-call video[data-screen]') && document.querySelector('#fincom-call video[data-screen]').videoWidth > 0", 30000), "the owner sees the host's shared screen")
    shot(B, "04-screen-share")

    print("6. a guest by link: the waiting room on a phone")
    press(A, "[data-call-people-btn]"); press(A, "[data-invite-make]")
    ok(wait_for(A, "!!document.querySelector('[data-invite-link]') && document.querySelector('[data-invite-link]').value.includes('#join=')"), "a guest link made")
    link = A.input_value("[data-invite-link]")
    gctx, G, gseen = guest_page(br, PORT, link, hub, fn, rest, C)
    ok(wait_for(G, "!!document.querySelector('[data-guest-page]') && document.querySelector('[data-guest-page]').textContent.includes('Call with Client One')"), "the guest's page: the call's name, no sign-in")
    G.fill("[data-guest-name]", "Ram Kumar"); G.fill("[data-guest-email]", "ram@client.test"); press(G, "[data-guest-continue]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-code]')"), "the code asked for")
    G.fill("[data-guest-code]", "111111"); press(G, "[data-guest-verify]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-error]') && document.querySelector('[data-guest-error]').textContent.includes('not right')"), "a wrong code refused")
    G.fill("[data-guest-code]", "424242"); press(G, "[data-guest-verify]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-waiting]')"), "the waiting room")
    shot(G, "05-guest-waiting-phone")
    ok(wait_for(A, "!!document.querySelector('[data-waiting=\"Ram Kumar\"]')", 10000), "the host sees Ram Kumar waiting, email checked")
    ok("email checked" in A.inner_text("[data-waiting='Ram Kumar']"), "with the email checked")
    press(A, "[data-waiting='Ram Kumar'] [data-admit]")
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=lobby]')", 10000), "admitted: the guest's lobby")
    press(G, "[data-call-join]")
    ok(wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 3", 20000), "three in the call (%s)" % tiles(A))
    ok(wait_for(G, "[...document.querySelectorAll('#fincom-call [data-tile]')].filter(t => t.querySelector('video') && t.querySelector('video').videoWidth > 0).length >= 2", 30000), "the guest sees the others")
    tables = [u for u in gseen if "/rest/v1/" in u and "/rest/v1/rpc/signup_info" not in u]
    ok(not tables, "the guest's page reads nothing of FinCom's data (only the sign-in page's public signup_info: %s)" % tables[:3])
    ok(G.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll on the phone")
    shot(G, "06-guest-in-call-phone")

    print("7. recording: the notice, consent, the uploads")
    press(A, "[data-call-share]")          # the screen share ends first (a lighter load for this test's one computer)
    ok(wait_for(B, "!document.querySelector('#fincom-call video[data-screen]')", 20000), "sharing stopped: the others' stage goes")
    press(A, "[data-call-record]")
    ok(wait_for(A, "!!document.querySelector('[data-call-recording]')"), "the host sees the recording mark")
    ok(wait_for(B, "!!document.querySelector('[data-consent]')") and "This call is being recorded" in B.inner_text("[data-consent]"), "the owner is shown: This call is being recorded")
    ok(wait_for(G, "!!document.querySelector('[data-consent]')"), "so is the guest")
    ok(B.evaluate("[...document.querySelectorAll('#fincom-call [data-tile]')][0].textContent.includes('muted')"), "the owner's microphone held until they choose")
    shot(B, "07-consent")
    press(B, "[data-consent-stay]"); press(G, "[data-consent-stay]")
    ok(wait_for(B, "!document.querySelector('[data-consent]') && !!document.querySelector('[data-call-recording]')"), "staying: the call goes on, the mark shown")
    pump([A, B, G], 14000)
    press(A, "[data-call-record]")
    ok(wait_for(A, "!document.querySelector('[data-call-recording]')", 30000), "recording stopped")
    t0 = time.time()
    while time.time() - t0 < 60 and not (list(fn.recs.values())[0].get("ended") and len(set(x["who"] for x in fn.pieces)) >= 3): pump([A, B, G], 1000)
    recs = list(fn.recs.values())
    ok(recs and recs[0]["parts"] >= 1 and recs[0].get("ended"), "the composite recording's parts uploaded (%s)" % recs)
    ok(any("/rec/" in u["url"] or "rec-" in u["url"] or "%2Frec%2F" in u["url"] for u in fn.uploads), "to its signed address")
    who = sorted(set(x["who"] for x in fn.pieces))
    ok(len(who) >= 2, "the people's own microphone pieces sent, each from their own device (%s)" % who)
    cons = [c for c in fn.calls if c["action"] == "consent"]
    ok(any(c["body"].get("event") == "accepted" for c in cons) and any(c["body"].get("event") == "shown" for c in cons), "consent logged: shown and accepted")

    print("8. raise hand, a reaction, mute all")
    press(B, "[data-call-hand]")
    ok(wait_for(A, "[...document.querySelectorAll('#fincom-call [data-tile]')].some(t => t.dataset.tile.includes('Anshul') && t.textContent.includes('✋'))"), "the host sees the owner's hand")
    press(B, "[data-call-react='👏']")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-reaction=\"👏\"]')", 5000), "a reaction reaches the host")
    press(A, "[data-call-people-btn]") if not A.locator("[data-call-people]").count() else None
    press(A, "[data-mute-all]")
    ok(wait_for(B, "document.querySelector('#fincom-call [data-call-mic]').getAttribute('aria-pressed') === 'true'"), "mute all: the owner is muted")

    print("9. the host removes the guest")
    press(A, "[data-person^='Ram Kumar'] [data-remove]")
    ok(wait_for(G, "!!document.querySelector('[data-call-after]') && document.querySelector('[data-call-after]').textContent.includes('removed you')", 10000), "the guest is told the host removed them")
    ok(wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 15000), "two left in the call")
    ok(fn.people[[k for k, v in fn.people.items() if v["name"] == "Ram Kumar"][0]]["state"] == "removed", "the function marked them removed")
    ok(wait_for(B, "[...document.querySelectorAll('#fincom-call [data-tile]')].length === 2", 10000), "the owner's call goes on")
    newtopics = hub.topics_of(lambda t: t.startswith("realtime:call:") and t.endswith("-e2"))
    ok(len(newtopics) == 1 and len(set(id(x) for x in hub.members.get(newtopics[0], {}))) >= 2 if newtopics else False, "the host and the owner moved to the new channel (%s)" % newtopics)
    shot(A, "08-after-remove")

    print("10. the end: transcript, summary, action items")
    press(A, "[data-call-end]")
    ok(wait_for(B, "!!document.querySelector('[data-call-after]') && document.querySelector('[data-call-after]').textContent.includes('ended')", 10000), "the owner is told the host ended the call")
    ok(wait_for(A, "!!document.querySelector('[data-make-transcript]')"), "after the call: Make the transcript")
    press(A, "[data-make-transcript]")
    ok(wait_for(A, "!!document.querySelector('[data-transcript]')"), "the transcript")
    tr = A.inner_text("[data-transcript]")
    spoke = sorted(set(x["who"] for x in fn.pieces))
    ok(spoke and all(w + ": words heard from " + w in tr for w in spoke), "each line with its speaker's name (%r)" % tr[:200])
    press(A, "[data-make-summary]")
    ok(wait_for(A, "!!document.querySelector('[data-summary]')"), "the summary")
    ok("Send the purchase bills" in A.inner_text("[data-summary]"), "with the action items")
    press(A, "[data-add-tasks]")
    ok(wait_for(A, "(document.querySelector('[data-after-msg]') || {}).textContent && document.querySelector('[data-after-msg]').textContent.includes('added')"), "added to the client's due list")
    ok(fn.tasks and fn.tasks[0]["tok"] == "tok-staff", "as the host, with their own sign-in")
    shot(A, "09-after-call")
    press(A, "[data-call-close]")
    ok(wait_for(A, "!document.querySelector('#fincom-call')"), "closed: FinCom as it was")
    ok(A.evaluate("S.view === 'company' && S.tab === 'dash'"), "the client's page under it unchanged")
    br.close()
C.done()
