"""python3 shots_step5.py SITE OUTDIR PORT [only...] - Arc UI step 5 (10-Oct-2026): the last old-look parts: the message at the
bottom (toast, with and without buttons), the Clients page's top row (the reading check), GST Annual (GSTR-9), Books ->
Accounts and Books -> Audit (the old HTML pieces), and Settings' sections; on shots_ui_pass's made-up client with the test
books, at desktop (1440) and phone (390) width, light and dark. Each page gets the checks of shots_round4.py (sideways
scroll, cut-off text, WCAG contrast); writes OUTDIR/<width>-<scheme>-<page>.png and prints one line a page."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE, OUT, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3]); ONLY = sys.argv[4:]
os.makedirs(OUT, exist_ok=True)
src = lambda f: open(os.path.join(HERE, f)).read()
CHECK = re.search(r'CHECK = """(.*?)"""', src("shots_round4.py"), re.S).group(1).replace("\\\\n", "\\n")
SEED = re.search(r'SEED = """(.*?)"""', src("shots_ui_pass.py"), re.S).group(1)
def books():
    try:
        import gstfix; return list(gstfix.load())
    except Exception: return None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
CLIENT = lambda js: "() => { S.view = 'company'; " + js + " }"
PAGES = [
    ("clients", "() => { navHome('clients'); }"),
    ("toast-acts", "() => { navHome('clients'); setTimeout(() => toast('3 bills read for ZZ Traders', {actions: [{label: 'Stay here', run: () => {}}, {label: 'Review them →', run: () => {}}]}), 200); }"),
    ("toast-plain", "() => { navHome('clients'); setTimeout(() => toast('Saved the firm details'), 200); }"),
    ("toast-error", "() => { navHome('clients'); setTimeout(() => toast('Could not post: HTTP 503 Service Unavailable'), 200); }"),
    ("gst-annual", CLIENT("goClient('books:gst'); setTimeout(() => gstOpen(S.gstYm || GSTR.months().slice(-1)[0], 'g9'), 300);")),
    ("gst-annual-9c", CLIENT("goClient('books:gst'); setTimeout(() => gstOpen(S.gstYm || GSTR.months().slice(-1)[0], 'g9c'), 300);")),
    ("accounts", CLIENT("goClient('books:fs');")),
    ("audit", CLIENT("goClient('books:audit');")),
    ("audit-3cd", CLIENT("goClient('books:audit'); setTimeout(() => { doAct('auditRun'); setTimeout(() => { S.auditTab = '3cd'; render(); }, 2500); }, 300);")),
] + [("settings-" + s, "() => { goSettings(%s); }" % ("null" if s == "home" else "'%s'" % s)) for s in
     ["home", "firm", "account", "plan", "bridge", "tcloud", "postlog", "gstapi", "rates", "reading", "ai", "moves"]]
bad = 0
with sync_playwright() as p:
    br = p.chromium.launch(); B = books()
    for vw, vh, wn in [(1440, 900, "desk"), (390, 844, "phone")]:
        for sch in ["light", "dark"]:
            pg = br.new_page(viewport={"width": vw, "height": vh}, color_scheme=sch); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
            pg.evaluate(SEED, B); pg.wait_for_timeout(1500)
            pg.evaluate("() => { S.account = Object.assign(S.account || {}, {me: {role: 'owner', user_id: 'u-owner', name: 'Anshul'}}); render(); }")
            for name, js in PAGES:
                if ONLY and name not in ONLY: continue
                errs.clear()
                if not name.startswith("toast"): pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }")
                try: pg.evaluate(js); pg.wait_for_timeout(4500 if name == "audit-3cd" else 1600)
                except Exception as e: errs.append(str(e)[:160])
                pg.evaluate("() => window.scrollTo(0, 0)")
                if not name.startswith("toast"): pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(300)
                c = pg.evaluate(CHECK); notes = []
                if errs: notes.append("errors %s" % errs[:2])
                if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
                if c["cut"]: notes.append("cut-off %s" % c["cut"][:3])
                if c["nlow"]: notes.append("contrast %d below WCAG AA, worst %s" % (c["nlow"], c["low"][:3]))
                key = "%s-%s-%s" % (wn, sch, name)
                pg.screenshot(path=os.path.join(OUT, key + ".png"), full_page=name.startswith(("gst", "accounts", "audit", "settings-bridge", "settings-account")) and wn == "desk")
                bad += bool(notes); print(key, "; ".join(notes) if notes else "ok")
            pg.close()
    br.close()
print("pages with a finding:", bad)
