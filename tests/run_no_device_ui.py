"""python3 run_no_device_ui.py - calls and Ask FinCom's voice with no microphone or camera reaching the browser (23-Oct-2026;
the owner tried them from Remote Desktop to the office server: no camera or microphone, and the voice text wrong or empty).
  1. a call's lobby where getUserMedia finds nothing (NotFoundError) and the device list is empty: the one plain message
     ("No microphone/camera reached this browser…") with How (Remote Desktop's steps); Join now still works: in the call,
     listening only (said on the call); a member with a camera sees them; their chat line arrives
  2. a browser with nothing to capture from (NotSupportedError) and a refusal (NotAllowedError): the message, joining works
  3. a guest with no devices: Ask to join, admitted, in the call
  4. Ask FinCom's mic, the microphone held (NotReadableError): the same message beside the mic
  5. Ask FinCom's mic, the level meter saw no sound (a silent Remote Desktop microphone): nothing sent to fincom-transcribe,
     "Your microphone sent no sound"; with sound the clip is sent as before
Screenshots (CALL_SHOTS): no-device lobby light/dark, phone, the voice message.
Run on app/dist-test: python3 tests/run_no_device_ui.py"""
import os, sys, json, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from calls_stand import *
from playwright.sync_api import sync_playwright
PORT = 8465
serve(PORT)
C = Checks(); ok = C.ok
SHOTDIR = os.environ.get("CALL_SHOTS", "")
hub, fn, rest = Hub(), Fn(mail=False), Rest()
TEXT = "No microphone/camera reached this browser. If you're working inside Remote Desktop or a cloud PC, open FinCom in Chrome on your own laptop or phone instead (it's the same account) — or turn on microphone/camera redirection in Remote Desktop."
NODEV = """(() => {
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Requested device not found'), {name: 'NotFoundError'}); };
  navigator.mediaDevices.enumerateDevices = async () => [];
})()"""
def snap(pg, name, dark=True):
    if not SHOTDIR: return
    os.makedirs(SHOTDIR, exist_ok=True)
    try:
        pg.emulate_media(color_scheme="light"); pg.wait_for_timeout(250); pg.screenshot(path=os.path.join(SHOTDIR, name + "-light.png"))
        if dark: pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(250); pg.screenshot(path=os.path.join(SHOTDIR, name + "-dark.png")); pg.emulate_media(color_scheme="light")
    except Exception as e: print("  (screenshot %s: %s)" % (name, e))
def text(pg, sel): return pg.evaluate("(s) => (document.querySelector(s) || {}).textContent || ''", sel)

def nodev_member(br, tok, viewport=(1440, 900), script=True, perms=True):
    ctx = br.new_context(viewport={"width": viewport[0], "height": viewport[1]}, permissions=["camera", "microphone"] if perms else [])
    if script: ctx.add_init_script(NODEV)
    pg = ctx.new_page(); pg.set_default_timeout(60000); pg.on("pageerror", lambda e: C.errors.append(tok + ": " + str(e)))
    wire(pg, hub, fn, rest)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(setup_js(tok)); pg.wait_for_timeout(600)
    return ctx, pg

with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    print("1. a call's lobby with no microphone or camera (Remote Desktop)")
    actx, A = nodev_member(br, "tok-owner")
    A.evaluate("FinComCall.start({kind: 'meeting', title: 'Remote check'})")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-call=lobby] [data-no-device]')"), "the lobby says no microphone or camera reached the browser")
    ok(text(A, "#fincom-call [data-no-device-text]") == TEXT, "in the owner's words")
    press(A, "#fincom-call [data-no-device-how]")
    steps = text(A, "#fincom-call [data-no-device-steps]")
    ok("Show Options → Local Resources → Remote audio → Settings → Record from this computer" in steps and "Video capture devices" in steps and "ask IT" in steps, "How: Remote Desktop's steps (%s…)" % steps[:60])
    ok(A.evaluate("document.querySelector('#fincom-call [data-call-mic]').disabled && !!document.querySelector('#fincom-call [data-call-mic]').title"), "the microphone switch off, saying why")
    snap(A, "19-no-device-lobby")
    press(A, "[data-call-join]")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "Join now still works: in the call")
    ok(wait_for(A, "!!document.querySelector('[data-call-listen-only]')"), "said on the call: listening only")
    rid = list(fn.rooms)[-1]
    bctx, B = member_page(br, PORT, "tok-staff", hub, fn, rest, C)
    B.evaluate("(r) => FinComCall.join(r)", rid); wait_for(B, "!!document.querySelector('[data-call-join]')"); press(B, "[data-call-join]")
    ok(wait_for(B, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 20000) and wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 20000), "the member with a camera and the one without see each other")
    ok(wait_for(A, "[...document.querySelectorAll('#fincom-call [data-tile]')].some(t => t.dataset.tile.includes('Riya') && t.querySelector('video') && t.querySelector('video').videoWidth > 0)", 60000), "the one without devices sees and hears the other (listening)")
    press(A, "[data-call-chat-btn]"); A.fill("[data-chat-input]", "I can hear you, no mic here"); A.press("[data-chat-input]", "Enter")
    ok(wait_for(B, "(document.querySelector('[data-chat-unread]') || {}).textContent === '1'"), "their chat line arrives")

    print("3. a guest with no devices asks to join")
    gctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    gctx.add_init_script(NODEV)
    G = gctx.new_page(); G.set_default_timeout(60000); G.on("pageerror", lambda e: C.errors.append("guest: " + str(e)))
    wire(G, hub, fn, rest)
    G.goto("http://localhost:%d/#/join/%s" % (PORT, fn.rooms[rid]["code"]))
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=lobby] [data-no-device]')", 20000), "the guest's lobby says so too")
    snap(G, "20-no-device-guest-phone", dark=False)
    G.fill("[data-guest-name]", "Ram Kumar"); G.fill("[data-guest-email]", "ram@client.test"); press(G, "[data-guest-continue]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-waiting]')") , "Ask to join works")
    ok(wait_for(A, "!!document.querySelector('[data-knock-admit]')", 10000), "the host is asked"); press(A, "[data-knock-admit]")
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "admitted: in the call with no devices")
    br.close()

    print("2. no device the browser can capture from (headless Chromium without a prompt: NotSupportedError), and a refusal (NotAllowedError)")
    br = p.chromium.launch(args=[a for a in ARGS if a != "--use-fake-ui-for-media-stream"])
    dctx, D = nodev_member(br, "tok-staff", script=False, perms=False)
    D.evaluate("FinComCall.start({kind: 'meeting', title: 'Nothing here'})")
    ok(wait_for(D, "!!document.querySelector('#fincom-call [data-call=lobby] [data-no-device]')", 20000), "nothing to capture from: the same message (%s)" % text(D, "#fincom-call .call-err"))
    press(D, "[data-call-join]")
    ok(wait_for(D, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "and joining still works")
    br.close()
    br = p.chromium.launch(args=ARGS)
    ectx = br.new_context(viewport={"width": 1440, "height": 900})
    ectx.add_init_script("navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Permission denied'), {name: 'NotAllowedError'}); };")
    E = ectx.new_page(); E.set_default_timeout(60000); wire(E, hub, fn, rest)
    E.goto("http://localhost:%d/" % PORT); E.wait_for_timeout(2500)
    if E.locator('button[data-act="useOffline"]').count(): E.click('button[data-act="useOffline"]'); E.wait_for_timeout(1200)
    E.evaluate(setup_js("tok-staff")); E.wait_for_timeout(600)
    E.evaluate("FinComCall.start({kind: 'meeting', title: 'Refused'})")
    ok(wait_for(E, "!!document.querySelector('#fincom-call [data-call=lobby] [data-no-device]')", 20000), "refused (NotAllowedError): the same message")
    press(E, "[data-call-join]")
    ok(wait_for(E, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "and joining still works")
    br.close()

    print("4-5. Ask FinCom's mic")
    import voice_fakes as V
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_init_script(V.FAKES)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: C.errors.append("voice: " + str(e)))
    sent = []
    def tr(route, request):
        if request.method == "OPTIONS": return route.fulfill(status=204, headers=V.CORS)
        if not (request.headers.get("content-type") or "").startswith("application/json"): sent.append(request.url)
        route.fulfill(status=200, content_type="application/json", headers=V.CORS, body=json.dumps({"ok": True, "text": "Whisper heard it", "ms": 100}))
    pg.route("**/functions/v1/fincom-transcribe**", tr)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(V.SETUP); pg.wait_for_timeout(500); pg.evaluate("ASST.open()"); pg.wait_for_timeout(900)
    pg.evaluate("window.__gumError = 'NotReadableError'")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(600)
    ok(wait_for(pg, "!!document.querySelector('[data-asst-voice] [data-no-device]')"), "the microphone held (Remote Desktop): the same message beside the mic")
    ok(text(pg, "[data-asst-voice] [data-no-device-text]") == TEXT, "in the owner's words")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(400)
    pg.evaluate("window.__gumError = ''; window.__level = 0")
    pg.fill("#asstQ", ""); pg.click("[data-asst-mic]"); pg.wait_for_timeout(300)
    pg.evaluate("__say([['tally entry', true]])"); pg.wait_for_timeout(500); pg.click("[data-asst-mic]"); pg.wait_for_timeout(900)
    ok(not sent, "the level meter saw no sound: nothing sent to be heard (%s)" % sent)
    ok(wait_for(pg, "!!document.querySelector('[data-asst-voice-silent]') && document.querySelector('[data-asst-voice-silent]').textContent.includes('Your microphone sent no sound')"), "said: Your microphone sent no sound")
    ok(pg.evaluate("document.getElementById('asstQ').value") == "tally entry", "the browser's own words stay")
    if SHOTDIR: pg.screenshot(path=os.path.join(SHOTDIR, "21-voice-no-sound.png"))
    pg.evaluate("window.__level = 0.1")
    pg.fill("#asstQ", ""); pg.click("[data-asst-mic]"); pg.wait_for_timeout(300)
    pg.evaluate("__say([['tally entry', true]])"); pg.wait_for_timeout(500); pg.click("[data-asst-mic]"); pg.wait_for_timeout(900)
    ok(len(sent) == 1 and pg.evaluate("document.getElementById('asstQ').value") == "Whisper heard it", "with sound: the clip is sent and heard as before")
    br.close()
C.done()
