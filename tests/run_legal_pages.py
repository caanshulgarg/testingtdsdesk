"""python3 run_legal_pages.py [SHOTS_DIR] - the privacy policy and terms of service (welcome/privacy.html, welcome/terms.html;
the owner, 27-Oct-2026: "Create privacy and terms page in user panel.. make it complete like claude.ai page"), and the
links to them from the app:
  1. each page: one h1, "Last updated" and "Effective" dates, the short version at the top, a table of contents whose
     every link leads to a section of the page, and every section the page must have (by its heading); the lawyer's
     note is in the source only, never on the page; the placeholders are marked (class "todo")
  2. phone width (390): nothing sticks out sideways on either page; the sub-processor table becomes cards
  3. dark mode: a dark page with light text
  4. the app (served at /review/, the website at /welcome/, as on staging.fincom.live): the sign-in footer's Privacy and
     Terms, the sign-up page's "By creating an account you agree to the Terms of service and Privacy policy", and
     Settings' and Help's "Privacy policy" and "Terms of service": each opens its page, in a new tab from the app
With SHOTS_DIR: desktop and phone screenshots of both pages (light and dark), the sign-up card and Settings' foot.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_legal_pages.py"""
import os, sys, tempfile, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
WELCOME = os.path.abspath(os.path.join(HERE, "..", "welcome"))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else ""
# the site as Cloudflare serves it (cloudflare/build-site.sh): the website's pages at /welcome/, the app at /review/
ROOT = tempfile.mkdtemp(prefix="legal-site-")
os.symlink(WELCOME, os.path.join(ROOT, "welcome")); os.symlink(APP, os.path.join(ROOT, "review"))
PORT = 8771
BASE = "http://localhost:%d/" % PORT
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=ROOT)
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PORT), H).serve_forever, daemon=True).start()

PAGES = {
    "privacy": ("Privacy policy", ["Who we are and our role", "Data we collect", "How we use it", "Legal basis and consent",
                "AI processing", "Sharing and sub-processors", "Transfers outside India", "How long we keep it", "Security",
                "Your rights", "Children", "Cookies and browser storage", "Changes to this policy", "Grievance Officer", "Contact us"]),
    "terms": ("Terms of service", ["Accepting these terms", "Who can use FinCom", "Accounts and security",
              "Your data and your clients' consent", "Plans, credit and billing", "Acceptable use", "AI features and outputs",
              "Government portals and other services", "The FinCom Bridge", "Intellectual property", "Feedback", "Confidentiality",
              "Suspension and termination", "Your data when you leave", "Disclaimers", "Limitation of liability", "Indemnity",
              "Governing law and jurisdiction", "Dispute resolution", "Changes to these terms", "General", "Contact us"]),
}
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

READ = """() => {
  const art = document.querySelector('article.prose'), toc = [...document.querySelectorAll('.doc-toc a')];
  return { h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    dates: (document.querySelector('[data-dates]') || {}).textContent || '',
    summary: !!document.querySelector('article .summary li'),
    heads: [...document.querySelectorAll('article section.doc-s > h2')].map((h) => h.textContent.trim().replace(/^\\d+\\.\\s*/, '')),
    toc: toc.map((a) => a.getAttribute('href')), tocOk: toc.every((a) => { const s = document.querySelector(a.getAttribute('href')); return s && s.matches('section.doc-s'); }),
    sections: document.querySelectorAll('article section.doc-s').length,
    text: document.body.innerText, todo: document.querySelectorAll('.todo').length,
    source: document.documentElement.outerHTML.length };
}"""
WIDE = """() => { const w = document.documentElement.clientWidth;
  const out = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1; })
    .map((e) => e.tagName + '.' + e.className).slice(0, 5);
  return { w, sw: document.documentElement.scrollWidth, out }; }"""
COLORS = """() => { const c = (s) => s.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
  const b = getComputedStyle(document.body), p = getComputedStyle(document.querySelector('article .lead'));
  return { bg: c(b.backgroundColor), ink: c(p.color), table: !!document.querySelector('table.subp') && getComputedStyle(document.querySelector('.subp tr')).display }; }"""

with sync_playwright() as pw:
    br = pw.chromium.launch()
    # ---------------------------------------------------------------- 1. the pages themselves, at desktop width
    ctx = br.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page()
    for name, (h1, heads) in PAGES.items():
        print(name)
        raw = open(os.path.join(WELCOME, name + ".html"), encoding="utf-8").read()
        r = pg.goto(BASE + "welcome/%s.html" % name); ok(r.status == 200, "%s.html loads" % name)
        c = pg.evaluate(READ)
        ok(c["h1"] == [h1], "one heading: %s (%s)" % (h1, c["h1"]))
        ok("Last updated" in c["dates"] and "Effective" in c["dates"], "the dates: %s" % c["dates"].strip())
        ok(c["summary"], "the short version at the top")
        ok(c["heads"] == heads, "every section, in order (%d)" % len(heads) + ("" if c["heads"] == heads else ": %s" % c["heads"]))
        ok(len(c["toc"]) == c["sections"] == len(heads) and c["tocOk"], "a table of contents with a link to each section (%d)" % len(c["toc"]))
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + "-desktop.png"))
        pg.click('.doc-toc a[href="%s"]' % c["toc"][-1]); pg.wait_for_timeout(1500)
        ok(pg.evaluate("(h) => { const r = document.querySelector(h).getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }", c["toc"][-1]),
           "the last contents link brings its section into view")
        ok("DRAFT FOR LEGAL REVIEW" in raw[:400] and "DRAFT FOR LEGAL REVIEW" not in c["text"], "the lawyer's note in the source only")
        ok(c["todo"] >= 5 and "[LEGAL ENTITY NAME]" in c["text"] and "[EFFECTIVE DATE]" in c["text"], "the placeholders are marked (%d)" % c["todo"])
    ctx.close()
    # ---------------------------------------------------------------- 2 and 3. phone width, light and dark
    for scheme in ("light", "dark"):
        ctx = br.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme, is_mobile=True, has_touch=True); pg = ctx.new_page()
        for name in PAGES:
            pg.goto(BASE + "welcome/%s.html" % name); pg.wait_for_timeout(300)
            w = pg.evaluate(WIDE)
            ok(w["sw"] <= w["w"] and not w["out"], "%s, phone, %s: no sideways scroll (%s)" % (name, scheme, w))
            k = pg.evaluate(COLORS)
            if scheme == "dark": ok(k["bg"] < 60 and k["ink"] > 150, "%s, dark mode: dark page, light text (%s)" % (name, k))
            else: ok(k["bg"] > 200 and k["ink"] < 110, "%s, light mode: light page, dark text (%s)" % (name, k))
            if name == "privacy": ok(k["table"] == "block", "privacy, phone: the sub-processors as cards (%s)" % k["table"])
            if SHOTS:
                pg.screenshot(path=os.path.join(SHOTS, "%s-phone-%s.png" % (name, scheme)))
                if scheme == "dark": pg.screenshot(path=os.path.join(SHOTS, "%s-phone-dark-full.png" % name), full_page=True)
        ctx.close()
    ctx = br.new_context(viewport={"width": 1366, "height": 900}, color_scheme="dark"); pg = ctx.new_page()
    pg.goto(BASE + "welcome/privacy.html"); k = pg.evaluate(COLORS)
    ok(k["bg"] < 60 and k["ink"] > 150, "privacy, desktop, dark mode (%s)" % k)
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "privacy-desktop-dark.png"))
    ctx.close()

    # ---------------------------------------------------------------- 4. the links from the app
    print("app")
    ctx = br.new_context(viewport={"width": 1366, "height": 768}); pg = ctx.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    # no back end: Supabase's settings say email sign-in only; anything else is not found
    ctx.route("**/*supabase.co/**", lambda r: r.fulfill(status=200 if "/auth/v1/settings" in r.request.url else 404, content_type="application/json",
              headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"},
              body='{"external": {"email": true}}' if "/auth/v1/settings" in r.request.url else "{}"))
    def opens(sel, h1, where):
        a = pg.locator(sel).first
        ok(a.count() == 1 and a.get_attribute("target") == "_blank" and "noopener" in (a.get_attribute("rel") or ""), where + ": opens in a new tab")
        with ctx.expect_page() as info: a.click()
        np = info.value; np.wait_for_load_state()
        got = np.evaluate("() => [location.pathname, (document.querySelector('h1') || {}).textContent]")
        ok(got[1] == h1 and got[0].startswith("/welcome/"), "%s -> %s (%s)" % (where, h1, got)); np.close()
    pg.goto(BASE + "review/"); pg.wait_for_selector("#app .signin-box", timeout=20000)
    opens('#app .signin-foot a:has-text("Privacy")', "Privacy policy", "sign-in footer, Privacy")
    opens('#app .signin-foot a:has-text("Terms")', "Terms of service", "sign-in footer, Terms")
    pg.click('#app [data-act="showSignUp"]'); pg.wait_for_timeout(400)
    agree = pg.locator("#app [data-agree]")
    ok(agree.count() == 1 and agree.inner_text().strip() == "By creating an account you agree to the Terms of service and Privacy policy.",
       "sign-up: the agreement line (%s)" % (agree.inner_text().strip() if agree.count() else "none"))
    ok(pg.locator('#app .signin-box input[type="checkbox"]').count() == 0, "sign-up: no forced tick box")
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "signup-desktop.png"))
    opens('#app [data-agree] a:has-text("Terms of service")', "Terms of service", "sign-up, Terms of service")
    opens('#app [data-agree] a:has-text("Privacy policy")', "Privacy policy", "sign-up, Privacy policy")
    opens('#app .signin-foot a:has-text("Privacy")', "Privacy policy", "sign-up footer, Privacy")
    # signed in (offline, this browser only, as shots_ui_pass.py does): Settings and Help
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(1000)
    pg.evaluate("() => { goSettings(null); }"); pg.wait_for_selector("#app [data-legal]", timeout=15000)
    if SHOTS:
        pg.locator("#app [data-legal]").scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(SHOTS, "settings-foot.png"))
    opens('#app [data-legal] a:has-text("Privacy policy")', "Privacy policy", "Settings, Privacy policy")
    opens('#app [data-legal] a:has-text("Terms of service")', "Terms of service", "Settings, Terms of service")
    pg.evaluate("() => { navHome('help'); }"); pg.wait_for_selector("#app [data-legal]", timeout=15000)
    opens('#app [data-legal] a:has-text("Privacy policy")', "Privacy policy", "Help, Privacy policy")
    opens('#app [data-legal] a:has-text("Terms of service")', "Terms of service", "Help, Terms of service")
    ok(not errors, "no page errors (%s)" % errors[:2])
    br.close()

print("\n%s: %d failed" % ("FAIL" if fails else "PASS", len(fails)))
for f in fails: print("  - " + f)
sys.exit(1 if fails else 0)
