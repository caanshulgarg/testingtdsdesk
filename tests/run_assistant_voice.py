"""python3 run_assistant_voice.py - Ask FinCom: no suggested questions, the thinking loader, voice typing and the reply's language.
The owner, 19-Oct-2026: "Ask FinCom should not have suggestive questions; loader while thinking should be there like Samsung
or Claude; voice for Ask FinCom for browser as well as mobile; Hindi, English and Hinglish must; other regional languages
would be an advantage."
Checked on the React build (app/dist-test), the function stood in by the page (fetch answered by a stream the test feeds,
so each moment is seen), the browser's speech recognition stood in by a fake class:
  1. no suggested question anywhere: the empty panel has one short line and the box, no example to click; none after a reply
  2. the loader: before the first word an animated mark and "Thinking", then the step in plain words ("Reading the TDS
     ledgers"); gone when the words come; with reduced motion nothing moves (static dots); light and dark
  3. the mic in the box's bar: what is heard lands in the box live (interim, then final), never asked by itself; a second tap
     stops; the language picker sets what the browser listens for (hi-IN; Hinglish listens as en-IN), kept for the person;
     a blocked microphone gets one plain line; the note "Voice is turned into text by your browser (Google/Apple)" once;
     a browser without speech recognition (Firefox) has no mic
  4. the question goes with the language chosen (lang); "Read aloud" reads a Hindi reply with a Hindi voice
  5. a phone (390 wide): the mic, the language and Ask fit in the bar, no sideways scrolling
Screenshots in tests/out/assistant-voice/ (TDSDESK_OUT).
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_assistant_voice.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "assistant-voice"); os.makedirs(OUT, exist_ok=True)
PORT = 8417
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the browser's speech recognition, stood in: each one made is kept (window.__recs); __say() gives it what was "heard"
FAKE_REC = """(() => {
  window.__recs = [];
  class FakeRec {
    constructor(){ this.lang = ''; this.interimResults = false; this.continuous = false; this.state = 'new'; window.__recs.push(this); }
    start(){ this.state = 'listening'; }
    stop(){ if (this.state !== 'listening') return; this.state = 'stopped'; if (this.onend) this.onend(); }
    abort(){ if (this.state !== 'listening') return; this.state = 'aborted'; if (this.onerror) this.onerror({error: 'aborted'}); if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  window.__rec = () => window.__recs[window.__recs.length - 1];
  window.__say = (parts) => { const r = window.__rec(); const results = parts.map(([t, fin]) => Object.assign([{transcript: t, confidence: .9}], {isFinal: !!fin}));
    r.onresult({resultIndex: 0, results}); };
  window.__end = () => { const r = window.__rec(); r.state = 'ended'; if (r.onend) r.onend(); };
  window.__fail = (error) => { const r = window.__rec(); if (r.onerror) r.onerror({error}); r.state = 'ended'; if (r.onend) r.onend(); };
  // what "Read aloud" asks the browser to say
  window.__spoken = [];
  try { speechSynthesis.speak = (u) => { window.__spoken.push({text: u.text, lang: u.lang}); }; speechSynthesis.cancel = () => {}; } catch (e) {}
})()"""
NO_REC = """(() => { try { delete window.SpeechRecognition; } catch (e) {} try { delete window.webkitSpeechRecognition; } catch (e) {}
  window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; })()"""

SETUP = """() => {
  Cloud.cfg = () => ({url: "http://fn.test", key: "anon-key", email: "me@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  Cloud.api = async () => []; try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; render();
  // fincom-assistant, stood in: each question's body kept (window.__bodies); the reply is a stream the test feeds
  window.__bodies = []; const real = window.fetch;
  window.fetch = (u, o) => { if (String(u) !== ASST.url()) return real(u, o);
    window.__bodies.push(JSON.parse(String(o.body))); let ctl; const st = new ReadableStream({start(c){ ctl = c; }}), en = new TextEncoder();
    window.__push = (x) => ctl.enqueue(en.encode('data: ' + JSON.stringify(x) + '\\n\\n')); window.__close = () => ctl.close();
    return Promise.resolve(new Response(st, {headers: {'content-type': 'text/event-stream'}})); };
  return ASST.loadSettings(true).then(() => c.id);
}"""
BUSY = """() => { const l = document.querySelector('.asst-turn.latest'); const b = l && l.querySelector('[data-asst-busy]');
  if (!b) return null; const m = b.querySelector('.asst-think'), d = b.querySelectorAll('.asst-think-dots i'), r = b.getBoundingClientRect();
  const an = (el) => el ? getComputedStyle(el).animationName : 'missing';
  return {text: b.innerText.trim(), mark: !!m, dots: d.length, markAnim: an(m && (m.querySelector('svg') || m)), dotAnim: an(d[1]), seen: r.width > 0 && r.height > 0,
    words: !!l.querySelector('[data-asst-words]'), color: getComputedStyle(b).color}; }"""
NOSUGGEST = """() => ({suggest: document.querySelectorAll('[data-asst-suggest], .asst-suggest, [data-asst-followups], .asst-followups').length,
  emptyButtons: Array.from(document.querySelectorAll('.asst-empty button, .asst-empty .chip')).map(b => b.innerText),
  turnChips: Array.from(document.querySelectorAll('.asst-turn .chip, .asst-turn [data-asst-suggestion]')).map(b => b.innerText),
  legacy: typeof ASST.SUGGEST, empty: (document.querySelector('.asst-empty') || {}).innerText || ''})"""
box = lambda pg: pg.evaluate("document.getElementById('asstQ').value")
def shot(pg, name, sel=".asst-panel"):
    p = os.path.join(OUT, name + ".png")
    try:
        loc = pg.locator(sel).first
        loc.screenshot(path=p) if loc.count() else pg.screenshot(path=p)
    except Exception:
        pg.screenshot(path=p)

def page(br, init=FAKE_REC, **kw):
    ctx = br.new_context(viewport=kw.pop("viewport", {"width": 1280, "height": 900}), **kw)
    ctx.add_init_script(init)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.evaluate("ASST.open()"); pg.wait_for_timeout(900)
    return ctx, pg

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg = page(br)
    ok(pg.locator("[data-asst-panel]").count() == 1, "the panel opens on a client")
    # ---------- 1. no suggested questions
    n = pg.evaluate(NOSUGGEST)
    ok(n["suggest"] == 0 and not n["emptyButtons"], "the empty panel: no suggested questions to click (%s)" % n)
    ok("Ask about this client's books, TDS or GST" in n["empty"], "the empty panel: one short line (%r)" % n["empty"])
    ok(n["legacy"] == "undefined", "no list of suggested questions kept in the app (ASST.SUGGEST: %s)" % n["legacy"])
    # ---------- 3. the mic and the language
    ok(pg.locator("[data-asst-panel] [data-asst-mic]").count() == 1, "the mic is in the question box's bar")
    opts = pg.evaluate("Array.from(document.querySelectorAll('[data-asst-lang] option')).map(o => [o.value, o.textContent])")
    codes = [o[0] for o in opts]
    ok(codes[:3] == ["en-IN", "hi-IN", "hinglish"] and all(c in codes for c in ["mr-IN", "gu-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "pa-IN"]), "the languages: English, Hindi, Hinglish and 8 regional (%s)" % opts)
    ok(dict(opts).get("hi-IN") == "हिन्दी" and dict(opts).get("ta-IN") == "தமிழ்", "each language named in its own script")
    pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(200)
    r = pg.evaluate("({lang: __rec().lang, interim: __rec().interimResults, state: __rec().state})")
    ok(r == {"lang": "en-IN", "interim": True, "state": "listening"}, "the mic listens in English (India), interim words on (%s)" % r)
    ok(pg.locator("[data-asst-mic][aria-pressed=true]").count() == 1, "the mic shows it is listening")
    note = pg.inner_text("[data-asst-voice-msg]") if pg.locator("[data-asst-voice-msg]").count() else ""
    ok("Voice is turned into text by your browser (Google/Apple)" in note, "the first time: the note that the browser turns voice into text (%r)" % note)
    shot(pg, "mic-listening", ".asst-ask")
    pg.evaluate("__say([['TDS on rent', false]])"); pg.wait_for_timeout(150)
    ok(box(pg) == "TDS on rent", "interim words land in the box live (%r)" % box(pg))
    pg.evaluate("__say([['TDS on rent for March', true]])"); pg.wait_for_timeout(150)
    pg.evaluate("__end()"); pg.wait_for_timeout(200)
    ok(box(pg) == "TDS on rent for March", "the final words in the box (%r)" % box(pg))
    ok(pg.evaluate("window.__bodies.length") == 0 and pg.evaluate("ASST.turns().length") == 0, "nothing is asked by itself: the person presses Ask")
    ok(pg.locator("[data-asst-mic][aria-pressed=false]").count() == 1, "silence ends it: the mic is off again")
    # a second tap stops it; the words said so far stay, and the person can edit them
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    pg.evaluate("__say([['and', false]])"); pg.wait_for_timeout(100)
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(150)
    ok(pg.evaluate("__rec().state") == "aborted" and pg.locator("[data-asst-mic][aria-pressed=false]").count() == 1, "a second tap stops listening")
    pg.fill("#asstQ", "TDS on rent for April"); ok(box(pg) == "TDS on rent for April", "the words can be corrected before asking")
    note2 = pg.inner_text("[data-asst-voice-msg]") if pg.locator("[data-asst-voice-msg]").count() else ""
    ok("Google/Apple" not in note2, "the browser note only once (%r)" % note2)
    # Hindi; kept for the person
    pg.select_option("[data-asst-lang]", "hi-IN"); pg.fill("#asstQ", "")
    pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    ok(pg.evaluate("__rec().lang") == "hi-IN", "हिन्दी: the browser listens in hi-IN")
    pg.evaluate("__say([['किराये पर टीडीएस कितना काटना है', true]])"); pg.evaluate("__end()"); pg.wait_for_timeout(150)
    ok(box(pg) == "किराये पर टीडीएस कितना काटना है", "Hindi words in Devanagari in the box (%r)" % box(pg))
    shot(pg, "mic-hindi", ".asst-ask")
    pg.select_option("[data-asst-lang]", "hinglish"); pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    ok(pg.evaluate("__rec().lang") == "en-IN", "Hinglish listens as en-IN")
    pg.click("[data-asst-mic]")
    pg.select_option("[data-asst-lang]", "ta-IN"); pg.click("[data-asst-mic]"); pg.wait_for_timeout(100)
    ok(pg.evaluate("__rec().lang") == "ta-IN", "தமிழ்: ta-IN"); pg.click("[data-asst-mic]")
    # a blocked microphone: one plain line
    pg.click("[data-asst-mic]"); pg.evaluate("__fail('not-allowed')"); pg.wait_for_timeout(150)
    m = pg.inner_text("[data-asst-voice-msg]") if pg.locator("[data-asst-voice-msg]").count() else ""
    ok("microphone is blocked" in m and m.count("\n") == 0, "microphone blocked: one plain line (%r)" % m)
    shot(pg, "mic-blocked", ".asst-ask")
    pg.select_option("[data-asst-lang]", "hi-IN")
    ok(pg.evaluate("localStorage.getItem('tdsdesk:asst-voice-lang:u1')") == "hi-IN", "the language is kept for the person (localStorage)")
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(SETUP); pg.wait_for_timeout(500); pg.evaluate("ASST.open()"); pg.wait_for_timeout(900)
    ok(pg.evaluate("document.querySelector('[data-asst-lang]').value") == "hi-IN", "after a reload the language is still हिन्दी")
    # ---------- 2 and 4. the question with its language; the loader
    pg.fill("#asstQ", "किराये पर टीडीएस कितना काटना है?"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    b = pg.evaluate("window.__bodies[0] || {}")
    ok(b.get("lang") == "hi-IN" and b.get("question") == "किराये पर टीडीएस कितना काटना है?", "the question goes with the language chosen (lang: %s)" % b.get("lang"))
    g = pg.evaluate(BUSY)
    ok(g and g["seen"] and g["mark"] and g["dots"] == 3 and g["text"] == "Thinking" and not g["words"], "before the first word: the animated mark and 'Thinking' (%s)" % g)
    ok(g and g["markAnim"] not in ("none", "missing") and g["dotAnim"] not in ("none", "missing"), "it moves: the mark and the dots are animated (%s, %s)" % (g and g["markAnim"], g and g["dotAnim"]))
    shot(pg, "loader-light", ".asst-turn.latest")
    pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(200)
    gd = pg.evaluate(BUSY)
    ok(gd and g and gd["color"] != g["color"], "dark: the loader drawn in the dark theme's colours (%s / %s)" % (g and g["color"], gd and gd["color"]))
    shot(pg, "loader-dark", ".asst-turn.latest")
    pg.emulate_media(color_scheme="light"); pg.wait_for_timeout(150)
    pg.evaluate("__push({t: 'tool', name: 'tds_summary', label: 'Reading the TDS ledgers'})"); pg.wait_for_timeout(250)
    g = pg.evaluate(BUSY)
    ok(g and g["text"] == "Reading the TDS ledgers" and g["mark"], "a step: said in plain words with the mark (%s)" % (g and g["text"]))
    shot(pg, "loader-step", ".asst-turn.latest")
    pg.evaluate("__push({t: 'text', d: 'किराये पर TDS धारा 194-I के तहत **10%** है'})"); pg.wait_for_timeout(250)
    ok(pg.evaluate(BUSY) is None, "the words come: the loader goes")
    hindi = "किराये पर TDS धारा 194-I के तहत **10%** है (भवन)। ₹50,000 प्रति माह से अधिक किराये पर धारा 194-IB भी देखें।"
    pg.evaluate("(text) => { __push({t: 'done', text, labels: ['general'], links: [], citations: {ok: [], dropped: []}, verdicts: [], unchecked: []}); __close(); }", hindi)
    for _ in range(30):
        if pg.evaluate("ASST.turns().slice(-1)[0].done"): break
        pg.wait_for_timeout(100)
    pg.wait_for_timeout(200)
    n = pg.evaluate(NOSUGGEST)
    ok(n["suggest"] == 0 and not n["turnChips"], "after a reply: no follow-up suggestions (%s)" % n)
    ok(pg.evaluate(BUSY) is None, "done: no loader")
    ok(pg.locator(".asst-turn.latest [data-asst-speak]").count() == 1, "the reply has Read aloud")
    pg.locator(".asst-turn.latest").hover(); pg.click(".asst-turn.latest [data-asst-speak]"); pg.wait_for_timeout(150)
    sp = pg.evaluate("window.__spoken")
    ok(len(sp) == 1 and sp[0]["lang"].lower().startswith("hi") and "**" not in sp[0]["text"] and "194-I" in sp[0]["text"], "Read aloud: the Hindi reply in a Hindi voice, without marks (%s)" % sp)
    shot(pg, "reply-hindi")
    # light and dark, desktop and phone, with the mic and the language
    for scheme in ("light", "dark"):
        pg.emulate_media(color_scheme=scheme); pg.set_viewport_size({"width": 1280, "height": 900}); pg.wait_for_timeout(300)
        shot(pg, "panel-" + scheme)
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ph = pg.evaluate("""() => { const f = document.querySelector('.asst-ask').getBoundingClientRect(), bar = document.querySelector('.asst-askbar'), p = document.querySelector('.asst-panel').getBoundingClientRect();
          const inside = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= f.left - 1 && r.right <= f.right + 1; };
          return {mic: inside('[data-asst-mic]'), lang: inside('[data-asst-lang]'), ask: inside('.asst-send'), up: inside('[data-asst-upload-btn]'), barOver: bar.scrollWidth - bar.clientWidth,
            side: document.documentElement.scrollWidth - innerWidth, panelRight: p.right, w: innerWidth}; }""")
        ok(ph["mic"] and ph["lang"] and ph["ask"] and ph["up"] and ph["barOver"] <= 1 and ph["side"] <= 1 and ph["panelRight"] <= ph["w"] + 1, "phone 390 (%s): Upload, the mic, the language and Ask fit in the bar (%s)" % (scheme, ph))
        shot(pg, "phone-" + scheme, "body")
    pg.emulate_media(color_scheme="light")
    ctx.close()
    # ---------- reduced motion: nothing moves (static dots)
    ctx, pg = page(br, reduced_motion="reduce")
    pg.fill("#asstQ", "TDS rate on rent?"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    g = pg.evaluate(BUSY)
    ok(g and g["mark"] and g["dots"] == 3 and g["markAnim"] == "none" and g["dotAnim"] == "none", "reduced motion: the mark and the dots stand still (%s)" % g)
    shot(pg, "loader-reduced-motion", ".asst-turn.latest")
    ctx.close()
    # ---------- a browser with no speech recognition (Firefox): no mic, one plain line
    ctx, pg = page(br, init=NO_REC)
    ok(pg.locator("[data-asst-mic]").count() == 0 and pg.locator("[data-asst-lang]").count() == 0, "no speech recognition in the browser: no mic, no language picker")
    ok(pg.locator("[data-asst-voice-none]").count() == 1 and "not available in this browser" in pg.inner_text("[data-asst-voice-none]"), "and one plain line says so")
    shot(pg, "no-voice", ".asst-ask")
    pg.fill("#asstQ", "TDS rate on rent?"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    ok(pg.evaluate("(window.__bodies[0] || {}).lang") == "en-IN", "without a mic the question still goes with lang (en-IN)")
    ctx.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed") + " · screenshots in " + OUT)
sys.exit(1 if fails else 0)
