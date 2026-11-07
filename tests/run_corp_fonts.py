"""python3 run_corp_fonts.py - Corporate loads no font, and no stylesheet, from another site (Sentry FINCOM-APP-STAGING-P,
07-Nov-2026: the Corporate chunk asked fonts.googleapis.com for Source Serif 4; the app's Content-Security-Policy is
style-src 'self' 'unsafe-inline', font-src 'self' data:, so the font never loaded and each open sent a CSP report).
Source Serif 4 is kept with the app (app/src/screens/corp/fonts.js, fonts/*.woff2, OFL). On a made-up company, with the
stand-in cloud (tests/corp_fake_cloud.py):
  1. the profile, e-Forms and Resolutions & minutes opened, a document's preview drawn: no request to googleapis /
     gstatic (or anywhere but this site), no <link> to them; Source Serif 4 comes from this site and is loaded;
  2. the PDF's print window: the same (its own @font-face, from this site).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_fonts.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from corp_fake_cloud import INSTALL
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CORP_PORT") or 8728)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """() => {
  const a = newCompany({name: "Kestrel Textiles Private Limited (made-up)", gstin: "07AABCK1234F1Z5"}); a.pan = "AABCK1234F";
  S.companies[a.id] = a; Store.saveCompany(a); S.coId = a.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return a.id; }"""
PROFILE = {"cin": "U17299DL2019PTC000000", "cls": "private", "office": "14 Sample Lane, New Delhi 110005",
           "directors": [{"name": "Asha Verma (made-up)", "din": "00000011", "desig": "Director"}, {"name": "Ravi Menon (made-up)", "din": "00000022", "desig": "Director"}]}
FOREIGN = ("googleapis", "gstatic")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000})
    seen = []
    ctx.on("request", lambda r: seen.append(r.url))
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    E("() => localStorage.removeItem('__corp_fake_rows')"); E(INSTALL); E("() => { Cloud.st.role = 'owner'; }")
    co = E(SETUP); W(800)

    print("1. the pages")
    for tab in ("books:corp", "books:corp-forms", "books:corp-docs"):
        E("([id, t]) => openCompany(id).then(() => goClient(t))", [co, tab]); W(1500)
        if tab == "books:corp": E("([cid, p]) => { FCCorp.saveProfile(cid, p); render(); }", [co, PROFILE]); W(600)
    pg.click("#app [data-template='bank-open']"); W(1500)
    ok(E("!!document.querySelector('#app [data-corp-preview] .corp-a4')"), "a document's A4 preview drawn")
    fam = E("() => document.fonts.load('400 16px \"Source Serif 4\"').then(() => [...document.fonts].filter(f => f.family.replace(/\"/g, '') === 'Source Serif 4' && f.status === 'loaded').map(f => f.weight + ' ' + f.style))")
    ok(fam and "400 normal" in fam, "Source Serif 4 loaded (%s)" % fam)
    serif = [u for u in seen if "source-serif-4" in u]
    ok(serif and all(u.startswith("http://localhost:%d/" % PORT) for u in serif), "its woff2 from this site (%s)" % [u.split("/")[-1] for u in serif][:4])
    ok(not E("[...document.querySelectorAll('link[href]')].some(l => /googleapis|gstatic/.test(l.href) && l.rel === 'stylesheet')"), "no stylesheet link to Google Fonts")

    print("2. the PDF's print window")
    with ctx.expect_page(timeout=15000) as pop:
        E("() => { window.print = () => {}; }")
        pg.click("#app [data-doc-pdf]")
    pw = pop.value; pw.wait_for_load_state(); pw.wait_for_timeout(1200)
    ok(pw.evaluate("!!document.querySelector('[data-corp-print]')") and "@font-face" in pw.evaluate("[...document.querySelectorAll('style')].map(s => s.textContent).join('')"), "the print view, with its own @font-face")
    ok(not pw.evaluate("[...document.querySelectorAll('link[href]')].some(l => /googleapis|gstatic/.test(l.href))"), "no link to Google Fonts in it")
    pw.close()

    out = [u for u in seen if any(f in u for f in FOREIGN)]
    ok(not out, "no request to googleapis / gstatic at all (%s)" % out[:3])
    others = sorted(set(u.split("/")[2] for u in seen if u.startswith("http") and not u.startswith("http://localhost:%d/" % PORT)))
    ok(not [h for h in others if any(f in h for f in FOREIGN)], "hosts asked besides this site: %s" % others)
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
