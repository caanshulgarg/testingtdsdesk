"""python3 run_voice_whisper.py - clearer listening (the owner, 22-Oct-2026: listening "very poor; make it best"; Groq's
Whisper, the browser's own listening as the backup). Ask FinCom's mic records the speech (MediaRecorder) while the browser's
recogniser shows the words live; on stop the clip goes to fincom-transcribe and Whisper's words replace the browser's.
The browser's recogniser, MediaRecorder, getUserMedia and WebAudio's level meter are fakes in the page; the function is
answered by the test (page.route):
  1. Whisper's words replace the browser's; the clip is sent as audio/webm with the language (en, hi; Hinglish as auto)
     and the open client; the microphone is let go after
  2. Groq's limit (429): the browser's words are kept, with one quiet line; no key and offline the same
  3. a clip longer than the piece length (55 s; 0.4 s here) is sent in pieces, in order, and the words joined
  4. the level meter: quiet before speech never stops it; speech, then the pause (1 s here), stops it and sends the clip
  5. a blocked microphone is explained in plain words; Safari records mp4
  6. Settings > Platform > Keys: the Groq key field beside the Claude key, for the platform's administrator only; never
     shown back (only "set on <date>"); the voice minutes used today
  7. names corrected (22-Oct-2026): the microphone asked for echo cancelling, noise suppression, gain, one channel; opus
     at about 40 kbps; Hinglish sent with latin=1; the corrected names under the box, underlined, the heard words on a
     tap, one tap to undo; the pause after speech 4 s by default
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_voice_whisper.py"""
import os, sys, json, threading, functools, http.server, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8423
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

from voice_fakes import FAKES, SETUP, CORS
box = lambda pg: pg.evaluate("document.getElementById('asstQ').value")
mic_on = lambda pg: pg.locator("[data-asst-mic][aria-pressed=true]").count() == 1
line = lambda pg: pg.inner_text("[data-asst-voice-msg]") if pg.locator("[data-asst-voice-msg]").count() else ""

# the function, answered here: MODE[0] "ok" (the words "Whisper heard <the clip's content>"), "limit", "nokey"
MODE, SEEN = ["ok"], []
def fn(route, request):
    if request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    u = urllib.parse.urlparse(request.url); qs = dict(urllib.parse.parse_qsl(u.query))
    body = request.post_data_buffer or b""
    if (request.headers.get("content-type") or "").startswith("application/json"):
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "firm_secs": 120, "all_secs": 1500, "key": True}),
                             headers=CORS)
    SEEN.append({"qs": qs, "type": request.headers.get("content-type"), "body": body.decode("latin-1"), "auth": request.headers.get("authorization")})
    if MODE[0] == "limit": return route.fulfill(status=429, content_type="application/json", body=json.dumps({"ok": False, "kind": "limit"}), headers=CORS)
    if MODE[0] == "nokey": return route.fulfill(status=503, content_type="application/json", body=json.dumps({"ok": False, "kind": "nokey"}), headers=CORS)
    if MODE[0] == "names": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"ok": True, "ms": 300, "model": "whisper-large-v3",
        "text": "Richa Khandelwal ko 1 lakh ka payment, Tally mein entry", "changes": [{"from": "richa khandelwaal", "to": "Richa Khandelwal"}, {"from": "teddy", "to": "Tally"}]}))
    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "text": "Whisper heard " + body.decode("latin-1"), "ms": 300}),
                         headers=CORS)

def page(br, ua=None):
    ctx = br.new_context(viewport={"width": 1280, "height": 900}, **({"user_agent": ua} if ua else {}))
    ctx.add_init_script(FAKES)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/functions/v1/fincom-transcribe**", fn)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    cid = pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.evaluate("ASST.open()"); pg.wait_for_timeout(900)
    return ctx, pg, cid

def speak(pg, words, stop=True, wait=600):
    pg.fill("#asstQ", ""); n = len(SEEN)
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(250)
    pg.evaluate("(w) => __say([[w, true]])", words); pg.wait_for_timeout(150)
    shown = box(pg)
    if stop: pg.click("[data-asst-mic]"); pg.wait_for_timeout(wait)
    return shown, SEEN[n:]

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg, cid = page(br)

    print("1. Whisper's words replace the browser's")
    shown, sent = speak(pg, "tally main gst ki entry")
    ok(shown == "tally main gst ki entry", "the browser's words show live while speaking (%r)" % shown)
    ok(len(sent) == 1 and sent[0]["body"] == "clip0" and sent[0]["type"] == "audio/webm", "the clip went to fincom-transcribe as audio/webm (%s)" % sent)
    ok(sent and sent[0]["qs"].get("lang") == "en" and sent[0]["qs"].get("client") == cid and sent[0]["auth"] == "Bearer tok-x", "with lang en, the open client and the sign-in token (%s)" % (sent[0]["qs"] if sent else None))
    ok(box(pg) == "Whisper heard clip0", "Whisper's words replaced the browser's (%r)" % box(pg))
    ok("kept" not in line(pg), "no fallback line when Whisper answered (%r)" % line(pg))
    ok(pg.evaluate("__tracksStopped") >= 1 and not mic_on(pg), "the microphone let go, the mic off")
    pg.select_option("[data-asst-lang]", "hi-IN"); _, sent = speak(pg, "टैली")
    ok(sent and sent[0]["qs"].get("lang") == "hi", "Hindi chosen: lang hi (%s)" % (sent[0]["qs"] if sent else None))
    pg.select_option("[data-asst-lang]", "hinglish"); _, sent = speak(pg, "tally kholo")
    ok(sent and sent[0]["qs"].get("lang") == "auto", "Hinglish: lang auto (%s)" % (sent[0]["qs"] if sent else None))
    ok(pg.evaluate("localStorage.getItem('tdsdesk:asst-voice-lang:u1')") == "hinglish", "the language choice is kept")
    pg.select_option("[data-asst-lang]", "en-IN")
    # typed before the mic: Whisper's words go after it, the typed words stay
    pg.fill("#asstQ", "Question:"); pg.click("[data-asst-mic]"); pg.wait_for_timeout(250); pg.evaluate("__say([['ledger of richa', true]])"); pg.click("[data-asst-mic]"); pg.wait_for_timeout(600)
    ok(box(pg).startswith("Question: Whisper heard clip"), "the words typed before stay; Whisper's follow (%r)" % box(pg))

    print("2. the limit (429), no key, offline: the browser's words kept, one quiet line")
    MODE[0] = "limit"; speak(pg, "rent ka tds")
    ok(box(pg) == "rent ka tds", "429: the browser's words kept (%r)" % box(pg))
    ok("browser's words are kept" in line(pg) and "limit" in line(pg), "429: one quiet line (%r)" % line(pg))
    MODE[0] = "nokey"; speak(pg, "gst summary")
    ok(box(pg) == "gst summary" and "not set up" in line(pg), "no key: kept, its line (%r, %r)" % (box(pg), line(pg)))
    MODE[0] = "ok"; ctx.set_offline(True); speak(pg, "cash book"); ctx.set_offline(False)
    ok(box(pg) == "cash book" and "offline" in line(pg), "offline: kept, its line (%r, %r)" % (box(pg), line(pg)))

    print("3. a long clip in pieces, the words joined")
    pg.evaluate("window.FINCOM_VOICE_SPLIT_MS = 400")
    pg.fill("#asstQ", ""); n = len(SEEN); m0 = pg.evaluate("__mr.length")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(250); pg.evaluate("__say([['a long dictation', true]])"); pg.wait_for_timeout(1000)
    pg.click("[data-asst-mic]")
    for _ in range(40):       # the pieces go one after another: until Whisper's words are in the box
        pg.wait_for_timeout(100)
        if box(pg).startswith("Whisper heard") and "clearer" not in line(pg): break
    sent = SEEN[n:]
    ok(len(sent) >= 3 and [s["body"] for s in sent] == ["clip%d" % (m0 + i) for i in range(len(sent))], "sent in pieces, in order (%s)" % [s["body"] for s in sent])
    ok(box(pg) == " ".join("Whisper heard clip%d" % (m0 + i) for i in range(len(sent))), "the pieces' words joined (%r; sent %s)" % (box(pg), [s['body'] for s in sent]))
    ok(all(float(s["qs"].get("secs", "99")) <= 60 for s in sent), "each piece's length within 60 s")
    pg.evaluate("window.FINCOM_VOICE_SPLIT_MS = 0")

    print("4. the level meter stops it after speech and a pause")
    pg.evaluate("localStorage.setItem('tdsdesk:asst-voice-silence', '1')")
    pg.fill("#asstQ", ""); n = len(SEEN)
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(1600)
    ok(mic_on(pg), "quiet before any speech: still listening")
    pg.evaluate("window.__level = 0.1"); pg.wait_for_timeout(500); pg.evaluate("window.__level = 0.006"); pg.wait_for_timeout(500)
    ok(mic_on(pg), "less than the pause after speech: still listening")
    pg.wait_for_timeout(1100)
    ok(not mic_on(pg), "the pause after speech (heard by the level meter, no words from the browser) stopped it")
    pg.wait_for_timeout(300)
    ok(len(SEEN) == n + 1, "and the clip was sent (%d)" % (len(SEEN) - n))
    pg.evaluate("localStorage.removeItem('tdsdesk:asst-voice-silence')")

    print("5. a blocked microphone in plain words")
    pg.evaluate("window.__gumError = 'NotAllowedError'"); pg.fill("#asstQ", ""); pg.click("[data-asst-mic]"); pg.wait_for_timeout(300)
    nd = lambda: pg.evaluate("(document.querySelector('[data-asst-voice] [data-no-device]') || {}).textContent || ''")
    ok("No microphone/camera reached this browser" in nd(), "NotAllowedError: the one plain message (no microphone reached the browser) (%r)" % nd())
    pg.click("[data-asst-voice] [data-no-device-how]")
    ok("lock or camera sign beside the address" in nd() and "Remote Desktop" in nd(), "How: allow it beside the address, or Remote Desktop's steps")
    pg.click("[data-asst-mic]") if mic_on(pg) else None; pg.wait_for_timeout(200)
    pg.evaluate("window.__gumError = 'NotReadableError'"); pg.click("[data-asst-mic]"); pg.wait_for_timeout(300)
    ok("No microphone/camera reached this browser" in nd(), "NotReadableError (held by another app or Remote Desktop): the same message (%r)" % nd())
    pg.click("[data-asst-mic]") if mic_on(pg) else None
    ok(not errors, "no page error (%s)" % errors[:2])
    ctx.close()
    ctx, pg, cid = page(br, ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")
    _, sent = speak(pg, "safari words")
    ok(sent and sent[0]["type"] == "audio/mp4" and box(pg) == "Whisper heard clip0", "Safari: recorded and sent as audio/mp4 (%s, %r)" % (sent[0]["type"] if sent else None, box(pg)))
    ctx.close()

    print("7. clearer sound, and the names corrected: underlined, the heard words on a tap, one tap to undo")
    ctx, pg, cid = page(br)
    MODE[0] = "names"; pg.select_option("[data-asst-lang]", "hinglish")
    pg.fill("#asstQ", "Pehle:"); n = len(SEEN)
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(250)
    gum = pg.evaluate("window.__gumArgs") or {}
    au = gum.get("audio") or {}
    ok(au.get("echoCancellation") is True and au.get("noiseSuppression") is True and au.get("autoGainControl") is True and au.get("channelCount") == 1 and au.get("sampleRate") in (48000, 16000),
       "the microphone: echo cancelling, noise suppression, gain, one channel, 48 or 16 kHz (%s)" % au)
    bits = pg.evaluate("__mr[__mr.length - 1].opts.audioBitsPerSecond")
    ok(bits and 32000 <= bits <= 48000, "opus at 32-48 kbps (%s)" % bits)
    pg.evaluate("__say([['richa khandelwaal ko 1 lakh ka payment teddy mein entry', true]])"); pg.click("[data-asst-mic]"); pg.wait_for_timeout(700)
    sent = SEEN[n:]
    ok(sent and sent[0]["qs"].get("lang") == "auto" and sent[0]["qs"].get("latin") == "1", "Hinglish: lang auto, latin=1 (%s)" % (sent[0]["qs"] if sent else None))
    ok(box(pg) == "Pehle: Richa Khandelwal ko 1 lakh ka payment, Tally mein entry", "the corrected words in the box (%r)" % box(pg))
    words = pg.locator("[data-asst-fix-word]")
    ok(words.count() == 2 and words.nth(0).inner_text() == "Richa Khandelwal" and words.nth(1).inner_text() == "Tally", "the two corrected names shown under the box (%d)" % words.count())
    deco = pg.evaluate("getComputedStyle(document.querySelector('[data-asst-fix-word]')).textDecorationLine")
    ok("underline" in deco, "underlined (%s)" % deco)
    ok(words.nth(0).get_attribute("title") == "Heard “richa khandelwaal”", "the heard words on hover (%r)" % words.nth(0).get_attribute("title"))
    words.nth(0).click(); pg.wait_for_timeout(150)
    ok(pg.locator("[data-asst-fix-heard]").count() == 1 and "richa khandelwaal" in pg.inner_text("[data-asst-fix-heard]"), "and on a tap")
    pg.locator("[data-asst-fix-undo]").nth(1).click(); pg.wait_for_timeout(200)
    ok(box(pg) == "Pehle: Richa Khandelwal ko 1 lakh ka payment, teddy mein entry", "one tap on undo: the heard word back (%r)" % box(pg))
    ok(pg.locator("[data-asst-fix-word]").count() == 1, "that name no longer shown as corrected")
    pg.locator("[data-asst-fix-undo]").first.click(); pg.wait_for_timeout(200)
    ok(box(pg) == "Pehle: richa khandelwaal ko 1 lakh ka payment, teddy mein entry" and pg.locator("[data-asst-fix-word]").count() == 0, "both undone; the line gone (%r)" % box(pg))
    MODE[0] = "names"; speak(pg, "richa")
    pg.fill("#asstQ", "typed anew"); pg.wait_for_timeout(200)
    ok(pg.locator("[data-asst-fix-word]").count() == 0, "the box changed by hand: the corrections line goes")
    MODE[0] = "ok"
    # the pause after speech: 4 s unless the person set another
    pg.evaluate("localStorage.removeItem('tdsdesk:asst-voice-silence')"); pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(300)
    pg.evaluate("window.__level = 0.1"); pg.wait_for_timeout(400); pg.evaluate("window.__level = 0.006"); pg.wait_for_timeout(3300)
    ok(mic_on(pg), "3.3 s quiet after speech: still listening (the default pause is 4 s)")
    pg.wait_for_timeout(1200)
    ok(not mic_on(pg), "about 4 s quiet after speech: stopped")
    ok(not errors, "no page error (%s)" % errors[:2])
    ctx.close()

    print("6. the Groq key in Settings > Platform > Keys: the platform's administrator only")
    ctx, pg, cid = page(br)
    pg.evaluate("ASST.close()")
    pg.evaluate("""() => { S.account.superadmin = false; S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'platform'; render(); }"""); pg.wait_for_timeout(1500)
    ok(pg.locator("#sec_groq_api_key").count() == 0, "a firm's owner who is not the platform's administrator: no Groq key field")
    for tab in ("account", "ai"):
        pg.evaluate("(t) => { S.settingsTab = t; render(); }", tab); pg.wait_for_timeout(700)
        ok(pg.locator("#sec_groq_api_key").count() == 0, "not on the %s tab either" % tab)
    pg.evaluate("""() => { S.account.superadmin = true; S.settingsTab = 'platform'; S.adminData = {month: 0, firms: [], plans: [], modules: [], signup: {},
      secrets: [{name: 'claude_api_key', tail: 'x9', updated_at: '2026-09-01T00:00:00Z'}, {name: 'groq_api_key', tail: 'Q7zz', updated_at: '2026-10-22T05:00:00Z'}]}; render(); }""")
    pg.wait_for_timeout(1500)
    ok(pg.locator("#sec_groq_api_key").count() == 1 and pg.locator("#sec_claude_api_key").count() == 1, "the platform's administrator: the Groq key field beside the Claude key")
    row = pg.inner_text("tr:has(#sec_groq_api_key)") if pg.locator("tr:has(#sec_groq_api_key)").count() else ""
    ok("Groq" in row and "set on" in row and "Q7zz" not in row, "the key never shown back: only 'set on <date>' (%r)" % row)
    ok(pg.get_attribute("#sec_groq_api_key", "type") == "password", "the new key typed hidden")
    pg.wait_for_timeout(500)
    use = pg.inner_text("[data-voice-usage]") if pg.locator("[data-voice-usage]").count() else ""
    ok("Voice minutes used today" in use and "25" in use, "the voice minutes used today (all firms: 25) (%r)" % use)
    if not pg.locator("#sec_groq_api_key").count(): raise SystemExit("\n%d failed" % len(fails))
    pg.fill("#sec_groq_api_key", "gsk_new_key"); pg.evaluate("window.__rpc = []; Cloud.rpc = async (fn, a) => { window.__rpc.push([fn, a]); return {ok: true}; }")
    pg.click("tr:has(#sec_groq_api_key) button"); pg.wait_for_timeout(500)
    ok(["admin_set_secret", {"p_name": "groq_api_key", "p_value": "gsk_new_key"}] in pg.evaluate("__rpc") and pg.evaluate("(document.getElementById('sec_groq_api_key') || {value: ''}).value") == "", "Save: admin_set_secret as the Claude key (%s)" % pg.evaluate("__rpc"))
    ok(not errors, "no page error (%s)" % errors[:2])
    ctx.close()
    br.close()
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
