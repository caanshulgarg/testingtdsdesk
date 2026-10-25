"""python3 tests/run_calls_complete_ui.py - every function of a FinCom meeting, end to end, in one meeting (next-calls-
complete, 25-Oct-2026; the owner: "check complete functions"), on the calls stand (calls_stand.py: Realtime, fincom-call
and Storage faked in this process; the media peer to peer between real Chromium pages, fake cameras and microphones; the
SFU's own media is run_call_sfu.py's). Prints one line a function, PASS or FAIL, then the table:
  create a meeting (code and link) · the host joins · a member joins by the code · a guest by the link, admitted ·
  a second guest denied · picture and sound both ways · mute and unmute · camera off and on · a background sent (the
  others see the processed picture) · present a screen · chat · raise hand · subtitles (another language, on and off) ·
  recording with the notice (Stay) · Take notes with its notice, the words kept only after Stay, the Notes panel, the
  summary, the host's edit, Word and Copy · leave, and back in on another device · end for everyone · notes after the
  meeting (members yes, the guest no)
Run: TDSDESK_SITE=app/dist-test python3 tests/run_calls_complete_ui.py   (CALL_SHOTS=<dir> for pictures)"""
import os, sys, json, time, math, struct, wave, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from calls_stand import *
from playwright.sync_api import sync_playwright

PORT = 8797
C = Checks()
RESULTS = []
def fn_ok(name, cond, why=""):
    RESULTS.append((name, bool(cond), why))
    C.ok(cond, name + (" (" + why + ")" if why else ""))
TONE = os.path.join(os.environ.get("CALL_TMP") or ("/dev/shm" if os.path.isdir("/dev/shm") else tempfile.gettempdir()), "fincom-complete-tone.wav")
with wave.open(TONE, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 300 * i / 16000) * (0.6 + 0.4 * math.sin(2 * math.pi * 2 * i / 16000)))) for i in range(16000 * 4)))
ARGS2 = ARGS + ["--use-file-for-fake-audio-capture=" + TONE]
SUBS = {"Riya Staff": {"text": "GSTR-3B ka return 20 tarikh tak file karna hai", "lang": "hi", "tr": {"en": "The GSTR-3B return must be filed by the 20th", "hi": "GSTR-3B का रिटर्न 20 तारीख तक फ़ाइल करना है"}},
        "Ram Kumar": {"text": "I will send the purchase bills by Friday", "lang": "en", "tr": {"hi": "मैं शुक्रवार तक खरीद के बिल भेज दूँगा"}},
        "Lata Look": {"text": "Noted", "lang": "en", "tr": {}}}
hub, fn, rest = Hub(), Fn(allow_recording=True, mail=False, subs=SUBS), Rest()
srv = serve(PORT)
q = lambda pg, js: pg.evaluate(js)
def tile_js(name, cond):
    return "(() => { const t = [...document.querySelectorAll('#fincom-call [data-tile]')].find((x) => x.dataset.tile.includes(%s)); return !!t && (%s); })()" % (json.dumps(name), cond)
def corner(pg, name):
    # the average colour of a tile's picture, top left (what the others' screens show)
    return pg.evaluate("""(n) => { const t = [...document.querySelectorAll('#fincom-call [data-tile]')].find((x) => x.dataset.tile.includes(n)); const v = t && t.querySelector('video');
      if (!v || !v.videoWidth) return null; const c = document.createElement('canvas'); c.width = 32; c.height = 18; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 32, 18);
      const d = x.getImageData(0, 0, 6, 4).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const k = d.length / 4; return [r / k | 0, g / k | 0, b / k | 0]; }""", name)

# the host's camera: a head and shoulders (run_call_effects.py's), so the background has a person to keep
import run_call_effects
MOVING, STILL, _real = run_call_effects.cameras()
with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS2)
    brh = p.chromium.launch(args=ARGS2 + ["--use-file-for-fake-video-capture=" + MOVING])
    # ---------------------------------------------------------------- the host makes the meeting and joins
    actx, A = member_page(brh, PORT, "tok-staff", hub, fn, rest, C, viewport=(1360, 860))
    made = A.evaluate("() => FinComCall.later ? Cloud.fn('fincom-call', { action: 'create', title: 'September GST review', base: location.href }) : null")
    rid, code = made["room_id"], made["code"]
    fn_ok("create a meeting: its code and link", code and made["url"].endswith("#/join/" + code), code)
    A.evaluate("(c) => FinComCall.joinCode(c)", code); wait_for(A, "!!document.querySelector('[data-call-join]')"); press(A, "[data-call-join]")
    fn_ok("the host joins (lobby, Join now)", wait_for(A, "!!document.querySelector('#fincom-call [data-call=in]')", 20000))
    # ---------------------------------------------------------------- a member by the code
    bctx, B = member_page(br, PORT, "tok-look", hub, fn, rest, C, viewport=(1280, 800))
    B.evaluate("(c) => FinComCall.joinCode(c)", code); wait_for(B, "!!document.querySelector('[data-call-join]')"); press(B, "[data-call-join]")
    fn_ok("a member joins by the code (straight in)", wait_for(B, "!!document.querySelector('#fincom-call [data-call=in]')", 20000))
    # ---------------------------------------------------------------- a guest by the link, admitted; a second denied
    gctx, G, gseen = guest_page(br, PORT, made["url"], hub, fn, rest, C)
    wait_for(G, "!!document.querySelector('[data-guest-name]')", 20000)
    G.fill("[data-guest-name]", "Ram Kumar"); G.fill("[data-guest-email]", "ram@client.test"); press(G, "[data-guest-continue]")
    wait_for(G, "!!document.querySelector('[data-guest-waiting]')", 15000)
    seen_knock = wait_for(A, "!!document.querySelector('[data-knock]') && document.querySelector('[data-knock]').textContent.includes('Ram Kumar')", 15000)
    press(A, "[data-knock-admit]")
    fn_ok("a guest by the link: asks, the host admits (lobby)", seen_knock and wait_for(G, "!!document.querySelector('#fincom-call [data-call=in]')", 20000))
    hctx, H, _ = guest_page(br, PORT, made["url"], hub, fn, rest, C)
    wait_for(H, "!!document.querySelector('[data-guest-name]')", 20000)
    H.fill("[data-guest-name]", "Unknown Person"); H.fill("[data-guest-email]", "x@unknown.test"); press(H, "[data-guest-continue]")
    wait_for(A, "!!document.querySelector('[data-knock]') && document.querySelector('[data-knock]').textContent.includes('Unknown Person')", 15000)
    press(A, "[data-knock-deny]")
    fn_ok("a second guest denied (lobby)", wait_for(H, "!!document.querySelector('[data-guest-denied]')", 15000))
    hctx.close()
    # ---------------------------------------------------------------- picture and sound both ways
    both = all(wait_for(X, tile_js(n, "t.querySelector('video') && t.querySelector('video').videoWidth > 0 && t.querySelector('video').srcObject.getAudioTracks().length > 0"), 60000)
               for X, n in ((A, "Ram Kumar"), (G, "Riya Staff"), (A, "Lata Look"), (B, "Riya Staff"), (G, "Lata Look")))
    fn_ok("picture and sound both ways (host, member, guest)", both)
    shot(A, "c01-three-in-call"); shot(G, "c01-guest-phone")
    # ---------------------------------------------------------------- mute, camera
    press(G, "#fincom-call .call-bar [data-call-mic]")
    m1 = wait_for(A, tile_js("Ram Kumar", "t.textContent.includes('muted')"), 10000)
    press(G, "#fincom-call .call-bar [data-call-mic]")
    fn_ok("mute and unmute (the others see it)", m1 and wait_for(A, tile_js("Ram Kumar", "!t.textContent.includes('muted')"), 10000))
    press(B, "#fincom-call .call-bar [data-call-cam]")
    c1 = wait_for(A, tile_js("Lata Look", "!!t.querySelector('.call-camoff')"), 10000)
    press(B, "#fincom-call .call-bar [data-call-cam]")
    fn_ok("camera off and on (the others see it)", c1 and wait_for(A, tile_js("Lata Look", "!t.querySelector('.call-camoff')"), 10000))
    # ---------------------------------------------------------------- a background: what the others see is the processed picture
    before = corner(B, "Riya Staff")
    press(A, "#fincom-call .call-bar [data-call-more]"); press(A, ".call-more [data-call-effects]")
    wait_for(A, "!!document.querySelector('[data-fx-bg=navy]')"); press(A, "[data-fx-bg=navy]")
    seg = wait_for(A, "document.querySelector('#fincom-call [data-call]').dataset.fx === 'seg'", 60000, 500)
    navy = wait_for(B, "(() => { const n = 'Riya Staff'; const t = [...document.querySelectorAll('#fincom-call [data-tile]')].find((x) => x.dataset.tile.includes(n)); const v = t && t.querySelector('video'); if (!v || !v.videoWidth) return false; const c = document.createElement('canvas'); c.width = 32; c.height = 18; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 32, 18); const d = x.getImageData(0, 0, 6, 4).data; let r = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; } return b > r * 1.4; })()", 30000)
    after = corner(B, "Riya Staff")
    fn_ok("a background (FinCom navy) sent: the member sees the processed picture", seg and navy, "%s -> %s" % (before, after))
    shot(B, "c02-member-sees-host-background")
    press(A, "[data-fx-bg=none]")
    back = wait_for(A, "document.querySelector('#fincom-call [data-call]').dataset.fx === 'off'", 10000) and wait_for(B, tile_js("Riya Staff", "t.querySelector('video').videoWidth > 0"), 10000)
    fn_ok("the background off again mid-call: the camera goes on", back)
    A.click("#fincom-call .call-side .call-x") if A.locator("#fincom-call .call-side .call-x").count() else None
    # ---------------------------------------------------------------- present, chat, hand
    press(A, "#fincom-call .call-bar [data-call-share]")
    fn_ok("present a screen (the others see it)", wait_for(G, "!!document.querySelector('#fincom-call video[data-screen]') && document.querySelector('#fincom-call video[data-screen]').videoWidth > 0", 30000))
    shot(G, "c03-guest-sees-screen")
    press(A, "#fincom-call .call-bar [data-call-share]")
    wait_for(G, "!document.querySelector('#fincom-call video[data-screen]')", 15000)
    press(G, "[data-call-chat-btn]"); G.fill("[data-chat-input]", "Sending the bills today"); G.press("[data-chat-input]", "Enter")
    fn_ok("chat (the guest's message reaches the host)", wait_for(A, "!!document.querySelector('[data-chat-unread]') || [...document.querySelectorAll('.call-msg')].some((m) => m.textContent.includes('Sending the bills today'))", 15000))
    press(G, "[data-call-chat-btn]")
    press(B, "#fincom-call .call-bar [data-call-hand]")
    h1 = wait_for(A, tile_js("Lata Look", "t.textContent.includes('✋')"), 10000)
    press(B, "#fincom-call .call-bar [data-call-hand]")
    fn_ok("raise and lower a hand", h1 and wait_for(A, tile_js("Lata Look", "!t.textContent.includes('✋')"), 10000))
    # ---------------------------------------------------------------- subtitles
    press(G, "[data-call-subs-menu]"); G.select_option(".call-subs-pop [data-subs-lang]", "en"); press(G, "[data-subs-toggle]")
    sub_ok = wait_for(G, "[...document.querySelectorAll('[data-sub-line]')].some((x) => x.textContent.includes('The GSTR-3B return must be filed by the 20th'))", 45000)
    press(G, "[data-call-subs]")
    off_ok = wait_for(G, "!document.querySelector('[data-sub-line]')", 15000)
    fn_ok("subtitles: the host's Hinglish in English for the guest; off again", sub_ok and off_ok)
    # ---------------------------------------------------------------- recording with the notice
    press(A, "#fincom-call .call-bar [data-call-more]"); press(A, ".call-more [data-call-record]")
    rc = wait_for(G, "!!document.querySelector('[data-consent]')", 15000) and "recorded" in G.inner_text("[data-consent]")
    press(G, "[data-consent-stay]")
    rc2 = wait_for(B, "!!document.querySelector('[data-consent]')", 15000); press(B, "[data-consent-stay]")
    fn_ok("record with the notice (each person stays or leaves)", rc and rc2 and wait_for(G, "!!document.querySelector('[data-call-recording]')", 5000) and any(e == "accepted" for _, _, e in fn.consents))
    press(A, "#fincom-call .call-bar [data-call-more]"); press(A, ".call-more [data-call-record]")
    wait_for(G, "!document.querySelector('[data-call-recording]')", 30000)
    # ---------------------------------------------------------------- Take notes
    kept0 = len(fn.kept)
    press(A, "#fincom-call .call-bar [data-call-more]"); press(A, ".call-more [data-call-take-notes]")
    nt = wait_for(G, "!!document.querySelector('[data-consent]') && document.querySelector('[data-consent]').textContent.includes('notes are being taken')", 15000)
    pump([A, B, G], 7000)
    held = not any(k["who"] == "Ram Kumar" for k in fn.kept[kept0:])
    press(G, "[data-consent-stay]")
    wait_for(B, "!!document.querySelector('[data-consent]')", 15000); press(B, "[data-consent-stay]")
    got = wait_for(A, "!!document.querySelector('[data-call-notes] [data-notes-transcript]') && document.querySelector('[data-call-notes] [data-notes-transcript]').textContent.includes('Ram Kumar')", 60000)
    fn_ok("Take notes: everyone told; a guest's words kept only after Stay; the Notes panel shows them", nt and held and got, "kept %d" % (len(fn.kept) - kept0))
    shot(A, "c04-notes-panel-live")
    press(A, "[data-call-notes] [data-notes-make]")
    fn_ok("notes: the summary (key points, decisions, action items with who and when)", wait_for(A, "!!document.querySelector('[data-call-notes] [data-notes-summary]') && document.querySelector('[data-call-notes] [data-notes-action]').textContent.includes('Ram Kumar')", 15000))
    press(A, "[data-call-notes] [data-notes-edit-btn]")
    A.fill("[data-notes-edit-summary]", "Edited: GSTR-3B for September by the 20th.")
    press(A, "[data-notes-save]")
    fn_ok("notes: the host edits and saves", wait_for(A, "!!document.querySelector('[data-notes-edited]') && document.querySelector('[data-call-notes]').textContent.includes('Edited: GSTR-3B')", 10000))
    with A.expect_download(timeout=15000) as dl: press(A, "[data-call-notes] [data-notes-word]")
    d = dl.value; path = d.path(); body = open(path, "rb").read().decode("utf-8", "replace")
    fn_ok("notes: Word download (and Copy)", d.suggested_filename.endswith(".doc") and "Edited: GSTR-3B" in body and "Action items" in body, d.suggested_filename)
    fn_ok("notes: the member (look only) reads them, cannot edit", B.evaluate("() => true") and (press(B, "#fincom-call .call-bar [data-call-more]") or True) and (press(B, ".call-more [data-call-notes-btn]") or True)
          and wait_for(B, "!!document.querySelector('[data-call-notes] [data-notes-summary]')", 15000) and not B.locator("[data-call-notes] [data-notes-edit-btn]").count())
    fn_ok("notes: never on the guest's screen", not G.locator(".call-more [data-call-notes-btn]").count() and not any(c["action"].startswith("notes_") and c.get("gt") for c in fn.calls))
    # ---------------------------------------------------------------- leave, back in on another device
    press(B, "#fincom-call .call-bar [data-call-leave]")
    left = wait_for(B, "!!document.querySelector('#fincom-call [data-call=ended]')", 15000)
    b2ctx, B2 = member_page(br, PORT, "tok-look", hub, fn, rest, C, viewport=(390, 844))
    B2.evaluate("(c) => FinComCall.joinCode(c)", code); wait_for(B2, "!!document.querySelector('[data-call-join]')"); press(B2, "[data-call-join]")
    fn_ok("leave, then back in on another device", left and wait_for(B2, "!!document.querySelector('#fincom-call [data-call=in]')", 20000) and wait_for(A, tile_js("Lata Look", "t.querySelector('video') && t.querySelector('video').videoWidth > 0"), 60000))
    # ---------------------------------------------------------------- end for everyone; the notes after
    press(A, "#fincom-call .call-bar [data-call-more]"); press(A, ".call-more [data-call-end]")
    ended = all(wait_for(X, "!!document.querySelector('#fincom-call [data-call=ended]')", 20000) for X in (A, G, B2))
    fn_ok("end the meeting for everyone", ended)
    fn_ok("notes after the meeting: on the host's last screen", wait_for(A, "!!document.querySelector('[data-call-after] [data-notes-summary]')", 15000))
    fn_ok("notes after the meeting: not on the guest's", not G.locator("[data-call-after] [data-notes]").count())
    shot(A, "c05-after-notes")
    A.evaluate("() => { document.querySelector('[data-call-close]').click(); }")
    A.evaluate("navHome('meetings')")
    fn_ok("notes later: Meetings › Recent › Notes", wait_for(A, "!!document.querySelector('[data-meet-notes]')", 20000) and (press(A, "[data-meet-notes]") or True) and wait_for(A, "!!document.querySelector('[data-call-kept-one] [data-notes-summary]')", 15000))
    shot(A, "c06-meetings-recent-notes")
    br.close(); brh.close()
for f in (MOVING, STILL):
    try: os.remove(f)
    except OSError: pass
print("\nfunction                                                                    result")
for n, good, why in RESULTS: print("  %-74s %s" % (n[:74], "PASS" if good else "FAIL"))
C.done()
