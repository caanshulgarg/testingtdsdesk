"""python3 run_signin_clean.py - the sign-in, sign-up and set-password pages, clean and step by step (owner, 27-Oct-2026:
"Remove this and make it professional over login page and signup page"; then "make the sign-in and sign-up pages
interactive, like Claude's own sign-in page": the pattern, not the branding).
One frame for the pages before sign-in: a centred card, the FinCom mark and name on top, one heading, the boxes and the
button full width, errors under the box they are about, a link to the other page, a small footer (© FinCom · Privacy · Terms).
  1. the words taken off: no forgotten-password paragraph, no "5 wrong passwords" line, no "No internet on this
     computer? Use it here without an account", no "(untick on a shared computer …)", no firm name before sign-in, no
     "What is FinCom?", no "Sign in to see your firm's work …"; no way into the without-an-account mode from the page, on
     any browser, in the test build or the production build (TDSDESK_SITE_LIVE, app/dist); the mode itself is kept
  2. step by step: the email and Continue; a bad email is said under the box; Continue (or Enter) brings the password
     step into the same card, the email shown as a line with Edit, the focus in the password box; Edit goes back
  3. the password step: "Forgot password?" beside the label opens one line; the show / hide eye; "Keep me signed in",
     ticked; an empty password said under the box; a wrong password said in the card; a locked account said to be
     locked, and only then; while the answer is awaited the button shows a spinner, disabled, its words kept
  4. sign-up: the same frame, "Create your FinCom account", the email, then name, firm name and password; empty boxes
     said under each
  5. phone 390 wide: no sideways scroll on the pages; dark mode draws a dark card with light text; the keyboard alone
     signs in, with a focus ring; with reduced motion nothing animates
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_signin_clean.py"""
import os, re, glob, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
# the production build (npm run build: app/dist), looked at for the without-an-account button only
LIVE = os.environ.get("TDSDESK_SITE_LIVE", os.path.join(HERE, "..", "app", "dist"))
PORT = 8763
PAGE = "http://localhost:%d/" % PORT
class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Pages, directory=SITE)).serve_forever, daemon=True).start()

LOCKED = "Too many wrong passwords. Try again after 16:05, or ask the firm's owner to unlock you."
# the sentences taken off (any of these words on the page is a failure)
GONE = ["Forgotten the password", "person who runs your firm", "After 5 wrong passwords", "locked for 15 minutes",
        "No internet on this computer", "Use it here without an account", "the work stays on this computer only",
        "untick on a shared computer", "the sign-in ends when the browser is closed", "What is FinCom",
        "Sign in to see your firm", "Nothing is shown before that", "Finance and compliance, in one place",
        "Your firm gets its own space", "Nobody else can see your data"]
SIGNINS, GOOGLE = [], {"on": False}
def fake(route):
    u, req = route.request.url, route.request
    j = lambda code, body: route.fulfill(status=code, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    if req.method == "OPTIONS": return route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})
    if "/auth/v1/settings" in u: return j(200, {"external": {"email": True, "google": GOOGLE["on"]}})
    if "/functions/v1/signin" in u:
        b = json.loads(req.post_data or "{}"); SIGNINS.append(b.get("email"))
        if b.get("email") == "locked@firm.test": return j(423, {"ok": False, "locked_until": "2026-10-27T10:35:00Z", "error": LOCKED})
        return j(400, {"ok": False, "error": "Wrong email or password."})
    if "/functions/v1/signup" in u: return j(200, {"ok": True, "reason": "check_email", "message": "Check your email and click the link to confirm, then sign in."})
    return j(404, {})

fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

CARD = """() => {
  const box = document.querySelector('#app .signin-box'); if (!box) return null;
  const r = (e) => e ? e.getBoundingClientRect() : null, q = (s) => box.querySelector(s);
  const inp = [...box.querySelectorAll('input:not([readonly]):not([type=checkbox])')][0];
  const btn = q('button[type="submit"]');
  return {text: document.querySelector('#app').innerText, h1: [...box.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    brand: !!q('.signin-brand .signin-brand-name') && q('.signin-brand .signin-brand-name').textContent.trim(), mark: !!q('.signin-brand .side-mark'),
    inputW: inp ? Math.round(r(inp).width) : 0, btnW: btn ? Math.round(r(btn).width) : 0, btnText: btn ? btn.innerText.trim() : '',
    step: (q('[data-step]') || {dataset: {}}).dataset.step || '', boxes: [...box.querySelectorAll('input:not([readonly]):not([type=checkbox])')].map((i) => i.dataset.cloud || i.id),
    boxCx: Math.round(r(box).left + r(box).width / 2), vw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    foot: [...document.querySelectorAll('#app .signin-foot a')].map((a) => [a.textContent.trim(), a.getAttribute('href')]),
    footText: (document.querySelector('#app .signin-foot') || {}).textContent || '',
    paras: [...box.querySelectorAll('p')].filter((p) => p.offsetParent && p.textContent.trim()).map((p) => p.textContent.trim())};
}"""
FIELD_ERR = """(k) => { const i = document.querySelector('#app .signin-box input[data-cloud="' + k + '"]:not([readonly])'); if (!i) return null;
  const id = i.getAttribute('aria-describedby') || '', e = id && document.getElementById(id.split(' ').find((x) => /err/.test(x)) || '');
  return {invalid: i.getAttribute('aria-invalid'), text: e ? e.textContent.trim() : '', below: e ? e.getBoundingClientRect().top >= i.getBoundingClientRect().bottom - 1 : false}; }"""
ACTIVE = """() => { const e = document.activeElement; return e.dataset.cloud || e.dataset.act || (e.classList.contains('signin-forgot') ? 'forgot' : e.hasAttribute('data-signin-edit') ? 'edit' : e.hasAttribute('data-pw-toggle') ? 'eye' : e.tagName.toLowerCase()); }"""
BTN = '#app .signin-box button[type="submit"]'

with sync_playwright() as pw:
    br = pw.chromium.launch()
    def context(scheme="light", vp=None, person=True, motion="no-preference"):
        ctx = br.new_context(viewport=vp or {"width": 1440, "height": 900}, color_scheme=scheme, reduced_motion=motion)
        # a person's browser (the older tests' automated browser is navigator.webdriver = true)
        if person: ctx.add_init_script("Object.defineProperty(Navigator.prototype, 'webdriver', {get: () => false});")
        ctx.route("https://*.supabase.co/**", fake)
        # a slow line when asked (window.__slow ms): the sign-in's answer waits in the page
        ctx.add_init_script("(() => { const f = window.fetch.bind(window); window.fetch = async (u, o) => { if (window.__slow && /functions\\/v1\\/signin/.test(String(u))) await new Promise((r) => setTimeout(r, window.__slow)); return f(u, o); }; })()")
        return ctx
    def page(ctx, url=PAGE, firm=None):
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(2500)
        if firm: pg.evaluate("(n) => { S.firm.firmName = n; render(); }", firm); pg.wait_for_timeout(300)
        return pg

    print("1. sign-in, the email step: the words taken off")
    ctx = context(); A = page(ctx, firm="ABC")
    c = A.evaluate(CARD)
    ok(c is not None, "the sign-in card is shown")
    left = [g for g in GONE if g.lower() in c["text"].lower()]
    ok(not left, "none of the removed sentences on the sign-in page (%s)" % left)
    ok("ABC" not in c["text"], "the firm's name is not shown before sign-in")
    ok(c["h1"] == ["Welcome to FinCom"], "one heading: Welcome to FinCom (%s)" % c["h1"])
    ok(c["brand"] == "FinCom" and c["mark"], "the FinCom mark and name on top (%r)" % c["brand"])
    ok(abs(c["boxCx"] - c["vw"] / 2) <= 2, "the card is centred (%d of %d)" % (c["boxCx"], c["vw"]))
    ok(c["step"] == "email" and c["boxes"] == ["email"] and c["btnText"] == "Continue", "first the email box alone and Continue (%s, %r)" % (c["boxes"], c["btnText"]))
    ok(c["inputW"] > 250 and abs(c["btnW"] - c["inputW"]) <= 1, "the box and the button full width (%d, %d)" % (c["inputW"], c["btnW"]))
    ok(not c["paras"], "no paragraphs on the card (%s)" % c["paras"])
    ok(A.evaluate(ACTIVE) == "email", "the email box has the focus")
    ok(dict(c["foot"]) == {"Privacy": "welcome/privacy.html", "Terms": "welcome/terms.html"} and "© FinCom" in c["footText"], "the footer: © FinCom · Privacy · Terms (%s)" % c["foot"])

    print("2. Continue, Edit, Enter")
    A.click(BTN); A.wait_for_timeout(300)
    e1 = A.evaluate(FIELD_ERR, "email")
    ok(e1["invalid"] == "true" and e1["text"] == "Enter your email." and e1["below"], "empty: said under the email box (%s)" % e1)
    A.fill('#app input[data-cloud="email"]', "asha@firm"); A.click(BTN); A.wait_for_timeout(300)
    e1 = A.evaluate(FIELD_ERR, "email")
    ok(e1["invalid"] == "true" and "valid email" in e1["text"] and A.evaluate(CARD)["step"] == "email", "a bad email format: said under the box, still the email step (%s)" % e1)
    ok(A.evaluate("() => getComputedStyle(document.querySelector('#app .signin-field-err')).animationName") == "signin-fade", "the error fades in")
    A.fill('#app input[data-cloud="email"]', "asha@firm.test"); A.click(BTN); A.wait_for_timeout(400)
    c = A.evaluate(CARD)
    ok(c["step"] == "more" and c["boxes"] == ["password"] and c["btnText"] == "Sign in", "Continue: the password step in the same card (%s, %r)" % (c["boxes"], c["btnText"]))
    ok(A.locator("#app [data-email-line]").inner_text().startswith("asha@firm.test") and A.locator("#app [data-signin-edit]").count() == 1, "the email as a line, with Edit")
    ok(A.evaluate(ACTIVE) == "password", "the focus moves to the password box")
    ok(A.evaluate("() => getComputedStyle(document.querySelector('#app .signin-step')).animationName") == "signin-in", "the step comes in with a short fade")
    ok(SIGNINS == [], "nothing is sent yet")
    A.click("#app [data-signin-edit]"); A.wait_for_timeout(300)
    c = A.evaluate(CARD)
    ok(c["step"] == "email" and A.input_value('#app input[data-cloud="email"]') == "asha@firm.test" and A.evaluate(ACTIVE) == "email", "Edit goes back to the email, kept, with the focus")
    A.press('#app input[data-cloud="email"]', "Enter"); A.wait_for_timeout(300)
    ok(A.evaluate(CARD)["step"] == "more" and A.evaluate(ACTIVE) == "password", "Enter in the email box moves on")

    print("3. the password step")
    fp = A.locator("#app .signin-box button.signin-forgot")
    ok(fp.count() == 1 and fp.inner_text().strip() == "Forgot password?", "a small Forgot password? link")
    ok(A.evaluate("""() => { const l = document.querySelector('#app label[for="si-password"]').getBoundingClientRect(), f = document.querySelector('#app .signin-forgot').getBoundingClientRect();
        return Math.abs((l.top + l.height / 2) - (f.top + f.height / 2)) < 6 && f.left > l.right; }"""), "beside the password's label")
    ok(fp.get_attribute("aria-expanded") == "false" and "reset link" not in A.inner_text("#app"), "the note is closed at first")
    fp.click(); A.wait_for_timeout(250)
    note = A.locator("#app [data-forgot-note]")
    ok(re.search(r"Ask your firm.s admin to send you a reset link", note.inner_text()) and fp.get_attribute("aria-expanded") == "true", "Forgot password? opens one line: Ask your firm's admin to send you a reset link")
    kb = A.locator('#app input[data-cloud="keep"]')
    ok(kb.count() == 1 and kb.is_checked() and A.locator("#app .keep-box").inner_text().strip() == "Keep me signed in", "Keep me signed in: the box, ticked, those words only")
    A.fill('#app input[data-cloud="password"]', "secret-1")
    eye = A.locator("#app [data-pw-toggle]")
    ok(eye.get_attribute("aria-label") == "Show password" and A.get_attribute('#app input[data-cloud="password"]', "type") == "password", "the eye: Show password")
    eye.click(); A.wait_for_timeout(150)
    ok(A.get_attribute('#app input[data-cloud="password"]', "type") == "text" and eye.get_attribute("aria-pressed") == "true" and A.input_value('#app input[data-cloud="password"]') == "secret-1", "pressed: the password shown, what was typed kept")
    eye.click(); A.wait_for_timeout(150)
    ok(A.get_attribute('#app input[data-cloud="password"]', "type") == "password", "pressed again: hidden")
    A.fill('#app input[data-cloud="password"]', ""); A.click(BTN); A.wait_for_timeout(300)
    e2 = A.evaluate(FIELD_ERR, "password")
    ok(e2["invalid"] == "true" and "password" in e2["text"].lower() and e2["below"] and SIGNINS == [], "an empty password: said under the box, nothing sent (%s)" % e2)
    A.evaluate("window.__slow = 1500")
    A.fill('#app input[data-cloud="password"]', "not-the-password-1"); A.press('#app input[data-cloud="password"]', "Enter"); A.wait_for_timeout(500)
    b = A.evaluate("""(s) => { const b = document.querySelector(s); return {dis: b.disabled, spin: !!b.querySelector('[data-spinner]'), text: b.innerText.trim(), busy: b.getAttribute('aria-busy')}; }""", BTN)
    ok(b["dis"] and b["spin"] and b["text"] == "Sign in" and b["busy"] == "true", "waiting: a spinner, the button disabled, its words kept (%s)" % b)
    A.wait_for_timeout(1800); A.evaluate("window.__slow = 0")
    err = A.locator("#app .signin-box [data-signin-error]")
    ok(SIGNINS == ["asha@firm.test"], "Enter in the password box signs in (%s)" % SIGNINS)
    ok(err.count() == 1 and "Wrong email or password" in err.inner_text() and err.get_attribute("role") == "alert", "a wrong password: said in the card, as an alert")
    ok(A.locator(BTN + " [data-spinner]").count() == 0 and not A.locator(BTN).is_disabled(), "the spinner gone with the answer")
    ok("locked" not in A.inner_text("#app").lower(), "no word of a lock while the account is not locked")
    A.click("#app [data-signin-edit]"); A.fill('#app input[data-cloud="email"]', "locked@firm.test"); A.click(BTN); A.wait_for_timeout(300)
    A.fill('#app input[data-cloud="password"]', "anything-1"); A.click(BTN); A.wait_for_timeout(1200)
    ok(err.count() == 1 and "Too many wrong passwords" in err.inner_text(), "a locked account: the lock is said (%r)" % (err.inner_text() if err.count() else None))
    ok(A.evaluate("""() => { const e = document.querySelector('#app [data-signin-error]'), s = document.querySelector('#app .signin-box button[type="submit"]'); return !!(e && s) && e.getBoundingClientRect().top >= s.getBoundingClientRect().bottom - 1; }"""), "under the form")
    ctx.close()

    print("5. the keyboard alone")
    ctx = context(); K = page(ctx)
    ok(K.evaluate(ACTIVE) == "email", "the page opens with the focus in the email box")
    K.keyboard.type("ravi@firm.test"); K.keyboard.press("Enter"); K.wait_for_timeout(300)
    ok(K.evaluate(ACTIVE) == "password", "type the email, Enter: in the password box")
    seq = []
    K.focus("#app [data-signin-edit]")
    for _ in range(7):
        seq.append(K.evaluate(ACTIVE)); K.keyboard.press("Tab")
    ok(seq == ["edit", "forgot", "password", "eye", "keep", "cloudSignIn", "showSignUp"], "Tab: Edit, Forgot password?, password, the eye, Keep me signed in, Sign in, Create an account (%s)" % seq)
    K.focus('#app input[data-cloud="password"]'); K.keyboard.type("not-it-1"); K.keyboard.press("Enter"); K.wait_for_timeout(1200)
    ok(SIGNINS[-1:] == ["ravi@firm.test"] and K.locator("#app [data-signin-error]").count() == 1, "type the password, Enter: sent, the answer shown (%s)" % SIGNINS[-1:])
    K.focus("#app [data-signin-edit]"); K.keyboard.press("Shift+Tab"); K.keyboard.press("Tab")
    ring = K.evaluate("() => { const s = getComputedStyle(document.activeElement); return {o: s.outlineStyle, w: parseFloat(s.outlineWidth), sh: s.boxShadow}; }")
    ok((ring["o"] != "none" and ring["w"] >= 2) or (ring["sh"] and ring["sh"] != "none"), "a visible focus ring on Edit (%s)" % ring)
    K.focus('#app input[data-cloud="password"]')
    ring = K.evaluate("() => getComputedStyle(document.activeElement).boxShadow")
    ok(ring and ring != "none", "a soft ring round the box being typed in (%s)" % ring)
    K.keyboard.press("Shift+Tab"); K.keyboard.press("Shift+Tab"); K.keyboard.press("Enter"); K.wait_for_timeout(300)
    ok(K.evaluate(CARD)["step"] == "email" and K.evaluate(ACTIVE) == "email", "Edit with Enter: back to the email, the focus there")
    labels = K.evaluate("() => [...document.querySelectorAll('#app .signin-box input:not([type=hidden]):not([aria-hidden=true])')].every((i) => (i.labels && i.labels.length) || i.getAttribute('aria-label'))")
    ok(labels, "every box has a label")
    ctx.close()

    print("5. reduced motion: nothing animates")
    ctx = context(motion="reduce"); R = page(ctx)
    R.fill('#app input[data-cloud="email"]', "x"); R.click(BTN); R.wait_for_timeout(200)
    R.fill('#app input[data-cloud="email"]', "asha@firm.test"); R.click(BTN); R.wait_for_timeout(300)
    an = R.evaluate("() => [...document.querySelectorAll('#app .signin-box *')].map((e) => getComputedStyle(e)).filter((s) => s.animationName !== 'none' || (s.transitionDuration.split(',').some((d) => parseFloat(d) > 0) && s.transitionProperty !== 'none')).length")
    ok(an == 0, "no animation or transition in the card (%d)" % an)
    R.evaluate("window.__slow = 1200"); R.fill('#app input[data-cloud="password"]', "pw-1x"); R.click(BTN); R.wait_for_timeout(400)
    ok(R.evaluate("() => { const s = document.querySelector('#app [data-spinner]'); return !!s && getComputedStyle(s).animationName === 'none'; }"), "the waiting spinner stands still")
    R.wait_for_timeout(1400)
    ctx.close()

    print("4. sign-up: the same frame, step by step")
    ctx = context(); B = page(ctx, PAGE + "#/register")
    c = B.evaluate(CARD)
    left = [g for g in GONE if g.lower() in c["text"].lower()]
    ok(not left, "none of the removed sentences on the sign-up page (%s)" % left)
    ok(c["h1"] == ["Create your FinCom account"] and c["brand"] == "FinCom", "one heading: Create your FinCom account, under the FinCom mark (%s)" % c["h1"])
    ok(c["boxes"] == ["email"] and c["btnText"] == "Continue", "first the email and Continue (%s)" % c["boxes"])
    ok(B.locator('#app [data-act="showSignIn"]').count() == 1 and dict(c["foot"]).get("Privacy") == "welcome/privacy.html", "a link to sign in, and the same footer")
    B.fill('#app input[data-cloud="email"]', "asha@new"); B.press('#app input[data-cloud="email"]', "Enter"); B.wait_for_timeout(300)
    ok("valid email" in B.evaluate(FIELD_ERR, "email")["text"], "a bad email format: said under the box")
    B.fill('#app input[data-cloud="email"]', "asha@new.test"); B.press('#app input[data-cloud="email"]', "Enter"); B.wait_for_timeout(400)
    c = B.evaluate(CARD)
    ok(c["boxes"] == ["name", "firm", "password"] and c["btnText"] == "Create account" and B.evaluate(ACTIVE) == "name", "then your name, firm name and password, the focus in the name (%s)" % c["boxes"])
    ok(c["inputW"] > 250 and abs(c["btnW"] - c["inputW"]) <= 1 and B.locator("#app [data-pw-toggle]").count() == 1, "full width, the eye on the password (%d, %d)" % (c["inputW"], c["btnW"]))
    B.click(BTN); B.wait_for_timeout(300)
    errs = {k: B.evaluate(FIELD_ERR, k) for k in ("name", "firm", "password")}
    ok(all(e["invalid"] == "true" and e["text"] and e["below"] for e in errs.values()), "empty: said under each box (%s)" % {k: e["text"] for k, e in errs.items()})
    B.fill('#app input[data-cloud="name"]', "Asha Rao"); B.fill('#app input[data-cloud="firm"]', "Rao & Co"); B.fill('#app input[data-cloud="password"]', "short")
    B.click(BTN); B.wait_for_timeout(300)
    e = B.evaluate(FIELD_ERR, "password")
    ok(e["invalid"] == "true" and "10 characters" in e["text"] and B.evaluate(FIELD_ERR, "name")["invalid"] != "true", "a short password: said under the password box only (%s)" % e)
    B.fill('#app input[data-cloud="password"]', "a-long-password-1"); B.click(BTN); B.wait_for_timeout(1500)
    ok(B.locator("#app [data-signup-sent]").count() == 1 and B.evaluate(CARD)["h1"] == ["Check your email"], "Create account: Check your email")
    ctx.close()

    print("5. phone 390, dark mode, both steps, the set-password page")
    for scheme in ("light", "dark"):
        for name, url, vp in (("sign-in", PAGE, {"width": 390, "height": 844}), ("sign-up", PAGE + "#/register", {"width": 390, "height": 844}), ("set-password", PAGE, {"width": 390, "height": 844}), ("sign-in", PAGE, None)):
            ctx = context(scheme, vp); P = page(ctx, url)
            if name == "set-password":
                P.evaluate("() => window.loadAuthLink().then(() => { S.setPassword = {type: 'invite', email: 'asha@firm.test'}; render(); })"); P.wait_for_timeout(800)
            for st in ("email", "more") if name != "set-password" else ("",):
                if st == "more":
                    P.fill('#app input[data-cloud="email"]', "asha.rao.with.a.long.address@firm-of-chartered-accountants.test"); P.click(BTN); P.wait_for_timeout(400)
                c = P.evaluate(CARD)
                tag = "%s%s %s %s" % (name, " " + st if st else "", scheme, "390" if vp else "1440")
                if c is None: ok(False, tag + ": the card is shown"); continue
                if vp: ok(c["sw"] <= c["cw"], "%s: no sideways scroll (%d <= %d)" % (tag, c["sw"], c["cw"]))
                ok(c["brand"] == "FinCom" and len(c["h1"]) == 1 and c["inputW"] > 250 and abs(c["btnW"] - c["inputW"]) <= 1, "%s: the mark, one heading, full-width box and button (%s, %d, %d)" % (tag, c["h1"], c["inputW"], c["btnW"]))
                if name == "set-password":
                    left = [g for g in GONE if g.lower() in c["text"].lower()]
                    ok(not left, "%s: none of the removed sentences" % tag)
                if scheme == "dark":
                    lum = P.evaluate("""() => { const L = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
                        const box = document.querySelector('#app .signin-box'), h = box.querySelector('h1');
                        return {card: L(getComputedStyle(box).backgroundColor), text: L(getComputedStyle(h).color), page: L(getComputedStyle(document.body).backgroundColor)}; }""")
                    ok(lum["card"] < 0.25 and lum["text"] > 0.7 and lum["page"] < 0.25, "%s: a dark card and page, light text (%s)" % (tag, lum))
            ctx.close()

    print("6. Continue with Google (switched on in Supabase Auth): at the top, then 'or', then the email step; the same OAuth start")
    GOOGLE["on"] = True
    ORDER = """() => { const box = document.querySelector('#app .signin-box'), g = box.querySelector('[data-act="oauthGoogle"]'), o = box.querySelector('[data-oauth-or]'), e = box.querySelector('input[data-cloud="email"]');
      const W = (x) => Math.round(x.getBoundingClientRect().width);
      return !!(g && o && e) && !!(g.compareDocumentPosition(o) & 4) && !!(o.compareDocumentPosition(e) & 4) && Math.abs(W(g) - W(e)) <= 2 && !!g.querySelector('svg') && g.innerText.trim() === 'Continue with Google'; }"""
    for name, url in (("sign-in", PAGE), ("sign-up", PAGE + "#/register")):
        asked = []
        ctx = context()
        def authorize(route, *_, asked=asked):
            asked.append(route.request.url); route.fulfill(status=200, content_type="text/html", body="<p>provider</p>")
        ctx.route("https://*.supabase.co/auth/v1/authorize*", authorize)
        G = page(ctx, url)
        ok(G.locator('#app [data-act="oauthGoogle"]').count() == 1 and G.evaluate(ORDER), "%s: Continue with Google at the top, full width with its logo, then 'or', then the email box" % name)
        if name == "sign-in":
            G.fill('#app input[data-cloud="email"]', "asha@firm.test"); G.click(BTN); G.wait_for_timeout(300)
            ok(G.locator('#app [data-act="oauthGoogle"]').count() == 0, "sign-in, the password step: the email chosen, no Google button there")
            G.click("#app [data-signin-edit]"); G.wait_for_timeout(300)
        G.click('#app [data-act="oauthGoogle"]'); G.wait_for_timeout(1500)
        q = parse_qs(urlparse(asked[0]).query) if asked else {}
        ok(bool(asked) and urlparse(asked[0]).path == "/auth/v1/authorize" and q.get("provider") == ["google"] and q.get("redirect_to") == [PAGE]
           and q.get("code_challenge_method") == ["s256"] and len((q.get("code_challenge") or [""])[0]) == 43 and "scopes" not in q,
           "%s: it starts the same OAuth as before: /auth/v1/authorize, provider=google, back to this page, a PKCE challenge (%s)" % (name, asked[:1]))
        ctx.close()
    GOOGLE["on"] = False

    print("1. the without-an-account mode: no way in from the page, on any browser; the feature kept")
    NONE = "() => !document.querySelector('[data-act=\"useOffline\"]') && !/without an account/i.test(document.body.innerText)"
    for site, label in ((SITE, "the test build"), (LIVE, "the production build")):
        if not site or not os.path.isdir(site): ok(False, "%s is there to look at (%s)" % (label, site)); continue
        # the React screens' files: nothing draws such a button (legacy.js keeps the doAct case itself)
        chunks = [f for f in glob.glob(os.path.join(site, "assets", "*.js")) if "useOffline" in open(f, encoding="utf-8", errors="ignore").read()]
        ok(not chunks, "%s: no screen file draws a useOffline button (%s)" % (label, [os.path.basename(f) for f in chunks]))
        srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Pages, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = "http://localhost:%d/" % srv.server_address[1]
        for person in (True, False):
            for u in (url, url + "#/register"):
                ctx = context(person=person); T = page(ctx, u)
                if u == url: T.fill('#app input[data-cloud="email"]', "asha@firm.test"); T.click(BTN); T.wait_for_timeout(300)
                ok(T.locator("#app .signin-box").count() == 1 and T.evaluate(NONE), "%s, %s, %s: no 'without an account' button or words" % (label, "a person's browser" if person else "an automated browser", "sign-up" if u != url else "sign-in, both steps"))
                ctx.close()
        threading.Thread(target=srv.shutdown, daemon=True).start()
    ctx = context(); T = page(ctx)
    T.wait_for_function("() => typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()", timeout=20000)
    T.evaluate("() => { doAct('useOffline'); }"); T.wait_for_timeout(1200)
    ok(T.locator("#app .signin-box").count() == 0 and T.evaluate("Cloud.cfg().gate") is False, "a direct call (doAct 'useOffline', as the tests do) still opens FinCom without an account: the feature is kept")
    ctx.close()
    br.close()

ok(not errors, "no errors in the page (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
