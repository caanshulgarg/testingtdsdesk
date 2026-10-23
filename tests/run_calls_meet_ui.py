"""python3 run_calls_meet_ui.py - FinCom's calls like Google Meet (next-calls-meet, 23-Oct-2026; the owner started a call and
"didn't know where anyone will go or connect"), in Chromium with fake camera and microphone; the fincom-call function and
Supabase Realtime faked in this process (tests/calls_stand.py), peer to peer between the browsers for real:
  1. Meetings in the sidebar (owner/staff signed in), its page like meet.google.com: New meeting with its three ways,
     "Enter a code or link", Upcoming and Recent; the call screen's file still not fetched with it
  2. Start an instant meeting: the lobby (preview, microphone and camera, devices, background, My language, Subtitles),
     Join now, "Your meeting's ready" with the link (…#/join/<code>) and the code of the room made
  3. Add people with no email set up: the mail app's link carries the subject, link, code; the screen says so plainly
  4. a guest (phone, no sign-in) opens the link: the FinCom lobby, name and email, Ask to join, "Asking to join…"; the host
     sees "<name> wants to join" over the call (with nothing open) and admits; both in the grid; the People panel
  5. a second guest types the code on the join page (#/join); a wrong code there is refused in words
  6. a member joins by typing the code on Meetings: straight in (no waiting); a wrong code is said on the page
  7. live subtitles: all off, no piece is sent at all; the Hindi viewer switches on: the Tamil speaker's line in Hindi;
     the English viewer (off) sees none and no English is asked for; switched on: the line in English; original on hover
  8. Schedule in calendar: date, time, duration, client, people; the meeting in Upcoming; the mail app's invite has the time
Screenshots (CALL_SHOTS or scratchpad's meet-shots): desktop 1440 light and dark, phone 390.
Run on app/dist-test: python3 tests/run_calls_meet_ui.py"""
import os, re, sys, time, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import calls_stand
from calls_stand import *
from playwright.sync_api import sync_playwright
PORT = 8463
serve(PORT)
C = Checks(); ok = C.ok
SHOTDIR = os.environ.get("CALL_SHOTS", "")
TAMIL = {"text": "Sharma Traders-க்கு ₹1,25,000 GSTR-3B-க்கு அனுப்புங்கள்", "lang": "ta",
         "tr": {"hi": "Sharma Traders को ₹1,25,000 GSTR-3B के लिए भेजें", "en": "Send ₹1,25,000 to Sharma Traders for GSTR-3B"}}
# the fake microphone says something all the time (a steady tone, as a person talking): Chromium's own fake sound is a
# short beep a second, too little speech for a subtitle piece now and then
import wave, math, struct, tempfile
TONE = os.path.join(tempfile.gettempdir(), "fincom-meet-tone.wav")
with wave.open(TONE, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 330 * i / 16000) * (0.6 + 0.4 * math.sin(2 * math.pi * 3 * i / 16000)))) for i in range(16000 * 4)))
ARGS = ARGS + ["--use-file-for-fake-audio-capture=" + TONE]
hub, fn, rest = Hub(), Fn(allow_recording=True, mail=False, subs={"Anshul Owner": TAMIL}), Rest()

def snap(pg, name, dark=True):
    """light (and dark) at the page's own size"""
    if not SHOTDIR: return
    os.makedirs(SHOTDIR, exist_ok=True)
    try:
        pg.emulate_media(color_scheme="light"); pg.wait_for_timeout(250); pg.screenshot(path=os.path.join(SHOTDIR, name + "-light.png"))
        if dark: pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(250); pg.screenshot(path=os.path.join(SHOTDIR, name + "-dark.png")); pg.emulate_media(color_scheme="light")
    except Exception as e: print("  (screenshot %s: %s)" % (name, e))
def snap1(pg, name):
    if not SHOTDIR: return
    os.makedirs(SHOTDIR, exist_ok=True)
    try: pg.screenshot(path=os.path.join(SHOTDIR, name + ".png"))
    except Exception as e: print("  (screenshot %s: %s)" % (name, e))
def text(pg, sel):
    return pg.evaluate("(s) => (document.querySelector(s) || {}).textContent || ''", sel)
def tiles(pg): return pg.evaluate("[...document.querySelectorAll('#fincom-call [data-tile]')].map(t => t.getAttribute('data-tile'))")

with sync_playwright() as p:
    br = p.chromium.launch(args=ARGS)
    print("1. Meetings: the firm's page")
    actx, A = member_page(br, PORT, "tok-owner", hub, fn, rest, C, viewport=(1440, 900))
    asked = []; A.on("request", lambda r: asked.append(r.url))
    A.evaluate("navHome('clients')"); A.wait_for_timeout(500)
    ok(A.locator(".side-link[data-side='Meetings']").count() == 1, "Meetings in the sidebar for the owner")
    A.click(".side-link[data-side='Meetings']")
    ok(wait_for(A, "!!document.querySelector('[data-meetings]') && location.hash === '#/meetings'"), "its page, its own address #/meetings")
    ok(wait_for(A, "!!document.querySelector('[data-meet-upcoming]') && !document.querySelector('[data-meet-upcoming]').textContent.includes('Loading')"), "Upcoming read")
    ok(A.locator("[data-meet-new]").count() == 1 and A.locator("[data-meet-code-input]").count() == 1 and A.locator("[data-meet-recent]").count() == 1, "New meeting, Enter a code or link, Recent")
    ok(not any("CallScreen-" in u for u in asked), "the call screen's file not fetched with Meetings")
    snap(A, "01-meetings-home")
    press(A, "[data-meet-new]")
    ok(wait_for(A, "!!document.querySelector('[data-meet-menu]')"), "New meeting opens its menu")
    ok([A.locator(x).count() for x in ("[data-meet-instant]", "[data-meet-later]", "[data-meet-schedule]")] == [1, 1, 1], "Start an instant meeting · Create a meeting for later · Schedule in calendar")
    snap(A, "02-new-meeting-menu")

    print("2. an instant meeting: the lobby, then the meeting's ready card")
    press(A, "[data-meet-instant]")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-call=lobby]')"), "the lobby")
    ok(wait_for(A, "!!document.querySelector('[data-preview]') && document.querySelector('[data-preview]').videoWidth > 0"), "the camera's preview")
    ok(A.locator("#fincom-call [data-call-mic]").count() == 1 and A.locator("#fincom-call [data-call-cam]").count() == 1 and A.locator("#fincom-call [data-call-effects]").count() == 1, "microphone, camera and background switches on the preview")
    ok(wait_for(A, "document.querySelectorAll('[data-dev-mic] option').length >= 1 && document.querySelectorAll('[data-dev-cam] option').length >= 1"), "the microphone and camera pickers")
    ok(A.locator("[data-subs-lang]").count() == 1 and A.locator("[data-subs-lobby]").count() == 1 and not A.is_checked("[data-subs-lobby]"), "My language, and Subtitles off at first")
    ok("Joining as" in text(A, "#fincom-call") and A.locator("[data-call-join]").inner_text() == "Join now", "Joining as the member's name; Join now")
    snap(A, "03-lobby-member")
    press(A, "[data-call-join]")
    ok(wait_for(A, "!!document.querySelector('#fincom-call [data-call=in]')"), "in the meeting")
    room = list(fn.rooms.values())[-1]
    ok(room["kind"] == "meeting" and room["host_user"] == USERS["tok-owner"]["id"], "an instant meeting, the owner hosting")
    ok(wait_for(A, "!!document.querySelector('[data-call-ready] [data-meet-code]')"), "Your meeting's ready")
    code = text(A, "[data-call-ready] [data-meet-code]")
    link = A.input_value("[data-call-ready] [data-meet-link]")
    ok(code == room["code"] and link == "http://localhost:%d/#/join/%s" % (PORT, code), "its code and its one link (%s, %s)" % (code, link))
    ok(re.match(r"^\d\d:\d\d IST", text(A, "[data-call-clock]")) and text(A, "[data-call-code]") == code, "top left: the time (IST) and the code (%s)" % text(A, "[data-call-clock]"))
    ok(all(A.locator(x).count() >= 1 for x in ("[data-call-ready] [data-meet-wa]", "[data-call-ready] [data-meet-gcal]", "[data-call-ready] [data-meet-ics]", "[data-call-ready] [data-meet-email]")), "WhatsApp, Add to Google Calendar, the .ics and Add people")
    g = A.get_attribute("[data-call-ready] [data-meet-gcal]", "href")
    ok(g.startswith("https://calendar.google.com/calendar/render?action=TEMPLATE&text=Meeting&dates=") and urllib.parse.quote(link, safe="") in g, "Google Calendar's template link with the meeting's link")
    snap(A, "04-meeting-ready-card", dark=False)

    print("3. Add people with no email set up: the mail app")
    A.fill("[data-call-ready] [data-meet-email]", "client@example.com")
    press(A, "[data-call-ready] [data-meet-send]")
    ok(wait_for(A, "!!document.querySelector('[data-call-ready] [data-meet-msg]')"), "said on the card")
    ok("Email sending isn't set up yet, so your mail app opens with the invite ready." in text(A, "[data-call-ready] [data-meet-msg]"), "in plain words")
    mt = A.get_attribute("[data-call-ready] [data-meet-mailto]", "href") or ""
    body = urllib.parse.unquote(mt)
    ok(mt.startswith("mailto:client%40example.com?subject=") and "Invitation: Meeting" in body and link in body and "Meeting code: " + code in body, "the mail app's invite: to, subject, link and code (%s…)" % body[:90])
    ok(fn.invited == ["client@example.com"], "asked of the function first (it would email when Resend is set up)")

    print("4. a guest by the link: lobby, Ask to join, the host admits")
    gctx, G, gseen = guest_page(br, PORT, link, hub, fn, rest, C)
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=lobby][data-guest-page]')", 20000), "the guest's lobby, no sign-in")
    ok("Meeting" in text(G, "[data-lobby-title]") and "Garg & Co" in text(G, "#fincom-call") and "FinCom" in text(G, ".lobby-brand"), "the meeting's name, the firm's, FinCom's mark")
    ok(G.locator("[data-call-ask]").inner_text() == "Ask to join", "Ask to join")
    G.fill("[data-guest-name]", "Ram Kumar"); G.fill("[data-guest-email]", "ram@client.test")
    snap(G, "05-guest-lobby-phone")
    press(G, "[data-guest-continue]")
    ok(wait_for(G, "!!document.querySelector('[data-guest-waiting]') && document.querySelector('[data-lobby-title]').textContent === 'Asking to join…'"), "Asking to join…")
    snap(G, "06-guest-asking-phone")
    ok(wait_for(A, "!!document.querySelector('[data-knock]') && document.querySelector('[data-knock]').textContent.includes('Ram Kumar wants to join')", 10000) and not A.locator("[data-call-people]").count(), "the host sees Ram Kumar wants to join, with no panel open")
    ok(A.locator("[data-knock] [data-knock-admit]").count() == 1 and A.locator("[data-knock] [data-knock-view]").count() == 1, "Admit · View")
    ok(text(A, "[data-waiting-count]") == "1", "the People button counts the one waiting")
    A.click("[data-call-ready-close]")
    snap(A, "07-host-admit-toast", dark=False)
    press(A, "[data-knock-admit]")
    ok(wait_for(G, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "admitted: the guest is in")
    ok(wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 20000) and wait_for(G, "document.querySelectorAll('#fincom-call [data-tile]').length === 2", 20000), "both in the grid (%s)" % tiles(A))
    ok(wait_for(A, "[...document.querySelectorAll('#fincom-call [data-tile]')].some(t => t.dataset.tile.includes('Ram') && t.querySelector('video') && t.querySelector('video').videoWidth > 0)", 30000), "the host sees the guest's picture")
    ok(not A.locator("[data-knock]").count(), "the toast gone once answered")
    ok(G.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "the guest's phone: no sideways scroll")
    snap(A, "08-in-call-two-people", dark=False)
    snap1(G, "08-in-call-two-people-phone")
    press(A, "[data-call-people-btn]")
    ok(wait_for(A, "!!document.querySelector('[data-call-people]') && document.querySelector('[data-call-people]').textContent.includes('Ram Kumar (guest)')"), "People: the guest listed")
    snap(A, "09-people-panel", dark=False)
    press(A, "[data-call-people-btn]")

    print("5. a second guest types the code on the join page")
    hctx, H, _ = guest_page(br, PORT, "http://localhost:%d/#/join" % PORT, hub, fn, rest, C, viewport=(1440, 900))
    ok(wait_for(H, "!!document.querySelector('[data-guest-join] [data-join-code]')"), "the join page: Enter the meeting code")
    snap(H, "10-join-with-code")
    H.fill("[data-join-code]", "bcd-efgh-jkm"); press(H, "[data-join-go]")
    ok(wait_for(H, "(document.querySelector('[data-guest-error]') || {}).textContent && document.querySelector('[data-guest-error]').textContent.includes('No meeting has this code')"), "a wrong code: No meeting has this code")
    H.fill("[data-join-code]", code.upper().replace("-", " ")); press(H, "[data-join-go]")
    ok(wait_for(H, "!!document.querySelector('#fincom-call [data-call=lobby]')", 15000) and H.evaluate("location.hash") == "#/join/" + code, "typed any way: the meeting's lobby, its link in the address")
    H.fill("[data-guest-name]", "Sita Devi"); H.fill("[data-guest-email]", "sita@client.test"); press(H, "[data-guest-continue]")
    ok(wait_for(A, "!!document.querySelector('[data-knock]') && document.querySelector('[data-knock]').textContent.includes('Sita Devi')", 10000), "the host is told")
    press(A, "[data-knock-admit]")
    ok(wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 3", 20000), "three in the call")

    print("6. a member joins by typing the code on Meetings")
    bctx, B = member_page(br, PORT, "tok-staff", hub, fn, rest, C, viewport=(1440, 900))
    B.evaluate("navHome('meetings')")
    ok(wait_for(B, "!!document.querySelector('[data-meet-code-input]')"), "Meetings for staff")
    B.fill("[data-meet-code-input]", "abc-defg")
    press(B, "[data-meet-join]")
    ok(wait_for(B, "(document.querySelector('[data-meet-err]') || {}).textContent && document.querySelector('[data-meet-err]').textContent.includes('not a meeting code')"), "a short code: said on the page")
    B.fill("[data-meet-code-input]", "zzz-zzzz-zzz"); press(B, "[data-meet-join]")
    ok(wait_for(B, "(document.querySelector('[data-meet-err]') || {}).textContent.includes('No meeting has this code')"), "a code of no meeting: No meeting has this code")
    B.fill("[data-meet-code-input]", link); press(B, "[data-meet-join]")
    ok(wait_for(B, "!!document.querySelector('#fincom-call [data-call=lobby]')"), "the whole link pasted: the lobby")
    ok(B.locator("[data-call-join]").count() == 1 and B.locator("[data-guest-name]").count() == 0, "a member: Join now (no name, no asking)")
    press(B, "[data-call-join]")
    ok(wait_for(B, "!!document.querySelector('#fincom-call [data-call=in]')", 15000), "straight in")
    jc = [c for c in fn.calls if c["action"] == "join_code"]
    ok(jc and jc[-1]["tok"] == "tok-staff" and jc[-1]["body"]["code"] == code, "join_code with the member's own sign-in")
    ok(wait_for(A, "document.querySelectorAll('#fincom-call [data-tile]').length === 4", 20000), "four in the call (%s)" % tiles(A))
    ok(not A.locator("[data-knock]").count(), "the member never waited")

    print("7. live subtitles")
    pump([A, B, G, H], 9000)
    ok(not fn.captions, "all off: no piece sent by anyone (%d)" % len(fn.captions))
    # the guest reads Hindi
    press(G, "[data-call-subs-menu]")
    G.select_option(".call-subs-pop [data-subs-lang]", "hi")
    press(G, "[data-subs-toggle]")
    ok(G.evaluate("JSON.parse(localStorage.getItem('fincom.call-subs:guest')).on === true && JSON.parse(localStorage.getItem('fincom.call-subs:guest')).lang === 'hi'"), "the guest's choice remembered on the device")
    ok(wait_for(G, "[...document.querySelectorAll('[data-sub-line]')].some(x => x.textContent.includes('Sharma Traders को ₹1,25,000 GSTR-3B के लिए भेजें'))", 40000), "the Tamil speaker's line in Hindi for the Hindi viewer")
    ok(text(G, "[data-sub-line]").startswith("Anshul Owner:"), "speaker's name first")
    tam = [c for c in fn.captions if c["who"] == "Anshul Owner"]
    ok(tam and all(c["targets"] == ["hi"] for c in tam), "only Hindi asked for (%s)" % [c["targets"] for c in tam][:3])
    ok(not B.locator("[data-sub-line]").count(), "the English viewer with subtitles off sees none")
    snap1(G, "11-subtitles-hindi-phone")
    press(B, "[data-call-subs]")
    ok(wait_for(B, "[...document.querySelectorAll('[data-sub-line]')].some(x => x.textContent.includes('Send ₹1,25,000 to Sharma Traders for GSTR-3B'))", 40000), "switched on: the line in English for the English viewer")
    ok(B.evaluate("[...document.querySelectorAll('[data-sub-line]')].some(x => (x.title || '').includes('அனுப்புங்கள்'))"), "the words as said on hover")
    ok(any(sorted(c["targets"]) == ["en", "hi"] for c in fn.captions if c["who"] == "Anshul Owner"), "now Hindi and English asked for")
    snap(B, "12-subtitles-english", dark=False)
    press(B, "[data-call-subs]"); press(G, "[data-call-subs]")
    pump([A, B, G, H], 2500); n0 = len(fn.captions); pump([A, B, G, H], 9000)
    ok(len(fn.captions) - n0 <= 1, "off again for everyone: the pieces stop (%d more)" % (len(fn.captions) - n0))

    print("8. Schedule in calendar")
    press(A, "[data-call-leave]")
    ok(wait_for(A, "!!document.querySelector('[data-call-close]')"), "the host left")
    press(A, "[data-call-close]")
    ok(wait_for(A, "!document.querySelector('#fincom-call')"), "back on Meetings")
    press(A, "[data-meet-new]"); press(A, "[data-meet-schedule]")
    ok(wait_for(A, "!!document.querySelector('[data-schedule]')"), "the form")
    ok(all(A.locator(x).count() == 1 for x in ("[data-schedule-title]", "[data-schedule-date]", "[data-schedule-time]", "[data-schedule-mins]", "[data-schedule-client]", "[data-schedule-emails]")), "title, date, time, duration, client, people")
    A.fill("[data-schedule-title]", "Year-end review"); A.fill("[data-schedule-date]", "2026-10-30"); A.fill("[data-schedule-time]", "11:00")
    A.select_option("[data-schedule-mins]", "45"); A.select_option("[data-schedule-client]", CLIENT); A.fill("[data-schedule-emails]", "ca@client.test")
    snap(A, "13-schedule-form")
    press(A, "[data-schedule-go]")
    ok(wait_for(A, "!!document.querySelector('[data-schedule-done] [data-meet-code]')"), "scheduled: the meeting's card")
    sc = [c for c in fn.calls if c["action"] == "schedule"][-1]["body"]
    ok(sc["at"] == "2026-10-30T05:30:00.000Z" and sc["minutes"] == 45 and sc["client_id"] == CLIENT and sc["emails"] == ["ca@client.test"], "11:00 IST, 45 minutes, the client, the person (%s)" % sc)
    ok("Email sending isn't set up yet" in text(A, "[data-schedule-done]") and A.input_value("[data-schedule-done] [data-meet-email]") == "ca@client.test", "no email set up: said, Send invite ready with the person")
    with A.expect_download() as dl:
        press(A, "[data-schedule-done] [data-meet-send]")
    ok(dl.value.suggested_filename == "invite.ics", "Send invite: the .ics saved")
    mt = urllib.parse.unquote(A.get_attribute("[data-schedule-done] [data-meet-mailto]", "href") or "")
    ok("30-Oct-2026 11:00 IST" in mt and "Year-end review" in mt and "#/join/" in mt, "the mail app's invite: the time in IST, the title, the link")
    snap(A, "14-scheduled-card")
    press(A, "[data-schedule-close]")
    ok(wait_for(A, "!!document.querySelector('[data-meet-row=\"Year-end review\"]')", 8000), "in Upcoming")
    ok("30-Oct-2026 11:00 IST" in text(A, "[data-meet-row='Year-end review']"), "with its time in IST")
    snap(A, "15-meetings-upcoming")
    # Today: the meeting still going on (the others are in it) is the owner's own: on Today, with Join
    A.evaluate("navHome('today')")
    ok(wait_for(A, "!!document.querySelector('[data-meet-today]') && document.querySelector('[data-meet-today]').textContent.includes('now Meeting')", 8000), "Today: the meeting in progress, with Join (%s)" % text(A, "[data-meet-today]"))
    snap(A, "16-today-meetings", dark=False)
    br.close()

    print("9. phone: Meetings and the lobby at 390")
    br = p.chromium.launch(args=ARGS)
    pctx, P = member_page(br, PORT, "tok-owner", hub, fn, rest, C, viewport=(390, 844))
    P.evaluate("navHome('meetings')")
    ok(wait_for(P, "!!document.querySelector('[data-meet-new]')"), "Meetings on a phone")
    ok(P.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll")
    snap(P, "17-meetings-home-phone")
    press(P, "[data-meet-new]"); press(P, "[data-meet-instant]")
    ok(wait_for(P, "!!document.querySelector('#fincom-call [data-call=lobby]')"), "the lobby on a phone")
    snap(P, "18-lobby-phone")
    br.close()
C.done()
