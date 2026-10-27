"""python3 run_assistant_voice_continuous.py - Ask FinCom listens until the person stops (the owner, 22-Oct-2026: "while I was
speaking, it took only the first sentence and stopped listening"). The browser's speech recognition stood in by a fake class
(each one made kept in window.__recs); the browser ending a session is __end():
  1. the recogniser is asked to listen continuously, with interim words, in the language chosen;
  2. the browser ends the session after the first sentence: FinCom starts a new one at once (the mic stays on) and keeps
     the first sentence; the next words show live (interim) after it, then final; the pieces are joined in the box;
  3. it stops after a pause following speech (1 s here, set in this browser; 4 s by default, checked too), never by
     itself before; nothing is asked until Ask is pressed;
  4. Chrome on Android repeats a session's finals growing ("TDS", "TDS on rent"): the words are not doubled;
  5. Hindi chosen: every new session listens in hi-IN;
  6. a second tap stops it: no new session after that; a blocked microphone stops it too (no restart loop);
  7. Safari (continuous not dependable): one phrase a session, restarted and joined.
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_assistant_voice_continuous.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8419
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

FAKE_REC = """(() => {
  window.__recs = [];
  class FakeRec {
    constructor(){ this.lang = ''; this.interimResults = false; this.continuous = false; this.state = 'new'; window.__recs.push(this); }
    start(){ this.state = 'listening'; }
    stop(){ if (this.state !== 'listening') return; this.state = 'stopped'; if (this.onend) this.onend(); }
    abort(){ if (this.state !== 'listening') return; this.state = 'aborted'; if (this.onerror) this.onerror({error: 'aborted'}); if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  // the recording for clearer listening (VoiceRecorder.js) is not part of this test: the microphone prompt left unanswered,
  // as a headless browser may leave it (run_voice_whisper.py tests the recording)
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  window.__rec = () => window.__recs[window.__recs.length - 1];
  // what the browser heard in the current session so far (its results list, as the API gives it: every result again)
  window.__say = (parts) => { const r = window.__rec(); const results = parts.map(([t, fin]) => Object.assign([{transcript: t, confidence: .9}], {isFinal: !!fin}));
    r.onresult({resultIndex: 0, results}); };
  window.__end = () => { const r = window.__rec(); r.state = 'ended'; if (r.onend) r.onend(); };
  window.__fail = (error) => { const r = window.__rec(); if (r.onerror) r.onerror({error}); r.state = 'ended'; if (r.onend) r.onend(); };
})()"""
SETUP = """() => {
  Cloud.cfg = () => ({url: "http://fn.test", key: "anon-key", email: "me@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  Cloud.api = async () => []; try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); localStorage.setItem("tdsdesk:asst-voice-note", "1"); } catch (e) {}
  const c = newCompany({name: "Leads Insurance Private Limited", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; render();
  window.__bodies = []; const real = window.fetch;
  window.fetch = (u, o) => { if (String(u) !== ASST.url()) return real(u, o); window.__bodies.push(JSON.parse(String(o.body))); return new Promise(() => {}); };
  return ASST.loadSettings(true).then(() => c.id);
}"""
box = lambda pg: pg.evaluate("document.getElementById('asstQ').value")
mic_on = lambda pg: pg.locator("[data-asst-mic][aria-pressed=true]").count() == 1
n_recs = lambda pg: pg.evaluate("__recs.length")

def page(br, **kw):
    ctx = br.new_context(viewport={"width": 1280, "height": 900}, **kw)
    ctx.add_init_script(FAKE_REC)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.evaluate("ASST.open()"); pg.wait_for_timeout(900)
    return ctx, pg

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg = page(br)
    pg.evaluate("localStorage.setItem('tdsdesk:asst-voice-silence', '1')")     # a 1 s pause ends it, for this test
    pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(150)
    r = pg.evaluate("({lang: __rec().lang, interim: __rec().interimResults, continuous: __rec().continuous, state: __rec().state})")
    ok(r == {"lang": "en-IN", "interim": True, "continuous": True, "state": "listening"}, "1. it listens continuously, interim words on, in en-IN (%s)" % r)
    # ---- 2. the browser ends the session after the first sentence
    pg.evaluate("__say([['Make a payment entry', true]])"); pg.wait_for_timeout(100)
    pg.evaluate("__end()"); pg.wait_for_timeout(150)
    ok(n_recs(pg) == 2 and pg.evaluate("__rec().state") == "listening" and mic_on(pg), "2. the session ended after the first sentence: a new one started at once, the mic still on (%d made)" % n_recs(pg))
    ok(box(pg) == "Make a payment entry", "   the first sentence is kept (%r)" % box(pg))
    pg.evaluate("__say([['of one lakh to Richa', false]])"); pg.wait_for_timeout(100)
    ok(box(pg) == "Make a payment entry of one lakh to Richa", "   the next words show live after it (%r)" % box(pg))
    pg.evaluate("__say([['of one lakh to Richa Khandelwal from Kaveri Bank', true]])"); pg.wait_for_timeout(100)
    pg.evaluate("__end()"); pg.wait_for_timeout(150)
    ok(n_recs(pg) == 3 and mic_on(pg), "   ended again (about 60 s, or a pause): listening again")
    pg.evaluate("__say([['dated today', true]])"); pg.wait_for_timeout(300)
    ok(mic_on(pg), "3. not stopped by itself while the person is speaking")
    full = "Make a payment entry of one lakh to Richa Khandelwal from Kaveri Bank dated today"
    pg.wait_for_timeout(1200)
    ok(not mic_on(pg) and box(pg) == full, "3. a pause after speech ends it; the whole text is kept (%r)" % box(pg))
    ok(pg.evaluate("window.__bodies.length") == 0, "   nothing is asked by itself")
    n = n_recs(pg); pg.wait_for_timeout(300)
    ok(n_recs(pg) == n and pg.evaluate("__rec().state") == "stopped", "   and no new session after it stopped")
    # default: 4 s (the owner, 22-Oct-2026: voice "still not good"; 3 s cut people off mid-thought)
    pg.evaluate("localStorage.removeItem('tdsdesk:asst-voice-silence')"); pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['TDS on rent', true]])"); pg.wait_for_timeout(3300)
    on_at_3s = mic_on(pg); pg.wait_for_timeout(1200)
    ok(on_at_3s and not mic_on(pg), "3. by default a pause of about 4 s ends it (on at 3.3 s: %s; off at 4.5 s: %s)" % (on_at_3s, not mic_on(pg)))
    # ---- 4. Chrome on Android: a session's finals repeated growing
    pg.evaluate("localStorage.setItem('tdsdesk:asst-voice-silence', '1')"); pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['TDS', true], ['TDS on rent', true], ['for March', false]])"); pg.wait_for_timeout(100)
    ok(box(pg) == "TDS on rent for March", "4. finals repeated growing are not doubled (%r)" % box(pg))
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(150)
    # ---- 5. Hindi kept for every session
    pg.select_option("[data-asst-lang]", "hi-IN"); pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['रिचा खंडेलवाल को एक लाख का भुगतान', true]])"); pg.evaluate("__end()"); pg.wait_for_timeout(150)
    ok(pg.evaluate("__rec().lang") == "hi-IN" and mic_on(pg), "5. the new session listens in hi-IN too")
    pg.evaluate("__say([['की एंट्री करनी है', true]])"); pg.wait_for_timeout(100)
    # ---- 6. a second tap stops it, the words kept; no session after it
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(150)
    n = n_recs(pg)
    ok(not mic_on(pg) and box(pg) == "रिचा खंडेलवाल को एक लाख का भुगतान की एंट्री करनी है", "6. a tap stops it; the Hindi pieces joined (%r)" % box(pg))
    pg.wait_for_timeout(300); ok(n_recs(pg) == n, "   no new session after the tap")
    pg.select_option("[data-asst-lang]", "en-IN")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100); n = n_recs(pg)
    pg.evaluate("__fail('not-allowed')"); pg.wait_for_timeout(300)
    ok(not mic_on(pg) and n_recs(pg) == n and "microphone is blocked" in (pg.inner_text("[data-asst-voice-msg]") if pg.locator("[data-asst-voice-msg]").count() else ""),
       "6. a blocked microphone stops it, said once, no restart loop")
    # Ask while listening: stopped first, nothing heard after it lands in the next question
    pg.fill("#asstQ", ""); pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['TDS rate on rent', true]])"); pg.wait_for_timeout(100)
    pg.click(".asst-send"); pg.wait_for_timeout(300)
    ok(not mic_on(pg) and (pg.evaluate("window.__bodies[0] || {}").get("question") == "TDS rate on rent"), "Ask stops listening and asks what was said")
    ctx.close()
    # ---- 7. Safari: one phrase a session, restarted and joined
    SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    ctx, pg = page(br, user_agent=SAFARI)
    pg.evaluate("localStorage.setItem('tdsdesk:asst-voice-silence', '1')"); pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    ok(pg.evaluate("__rec().continuous") is False and pg.evaluate("__rec().interimResults") is True, "7. Safari: continuous not asked for, interim on")
    pg.evaluate("__say([['Pass a journal entry', true]])"); pg.evaluate("__end()"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['for rent of fifty thousand', false]])"); pg.evaluate("__end()"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['for March', true]])"); pg.wait_for_timeout(100)
    ok(n_recs(pg) == 3 and mic_on(pg) and box(pg) == "Pass a journal entry for rent of fifty thousand for March", "   each phrase's session restarted and the pieces joined, a last interim kept (%r)" % box(pg))
    pg.wait_for_timeout(1300); ok(not mic_on(pg), "   a pause ends it on Safari too")
    ctx.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
