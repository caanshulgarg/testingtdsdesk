"""python3 shots_post_today.py SITE OUTDIR PORT - Arc UI step 3, group 1 (09-Oct-2026): Today and Post to Tally with work
on them (run_post_tabs.py's made-up client: entries to post, posted with their Tally id, refused and unknown ones on
Errors), each Post to Tally tab and Today, at desktop (1366) and phone (390) width, light and dark. Each page gets the checks
of shots_round4.py (sideways scroll, cut-off text, WCAG contrast); writes OUTDIR/<width>-<scheme>-<page>.png and prints one
line a page."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE, OUT, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(OUT, exist_ok=True)
# shots_round4's page check and run_post_tabs' made-up client, read from their source (importing would start servers)
CHECK = re.search(r'CHECK = """(.*?)"""', open(os.path.join(HERE, "shots_round4.py")).read(), re.S).group(1).replace("\\\\n", "\\n")
SETUP = re.search(r'SETUP = """(.*?)"""', open(os.path.join(HERE, "run_post_tabs.py")).read(), re.S).group(1)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
TAB = "(t) => { const b = document.querySelector('#app [data-post-tabs] [data-post-tab=\"' + t + '\"]'); if (b) b.click(); }"
PAGES = [("post-topost", TAB, "topost"), ("post-posted", TAB, "posted"), ("post-errors", TAB, "errors"),
         ("today", "() => { navHome('today'); }", None)]
bad = 0
with sync_playwright() as p:
    br = p.chromium.launch()
    for vw, vh, wn in [(1366, 768, "desk"), (390, 844, "phone")]:
        for sch in ["light", "dark"]:
            pg = br.new_page(viewport={"width": vw, "height": vh}, color_scheme=sch); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
            pg.evaluate(SETUP); pg.wait_for_timeout(1500)
            for name, js, arg in PAGES:
                errs.clear()
                pg.evaluate(js, arg) if arg else pg.evaluate(js); pg.wait_for_timeout(1200)
                pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); window.scrollTo(0, 0); }"); pg.wait_for_timeout(300)
                c = pg.evaluate(CHECK); notes = []
                if errs: notes.append("errors %s" % errs[:2])
                if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
                if c["cut"]: notes.append("cut-off %s" % c["cut"][:3])
                if c["nlow"]: notes.append("contrast %d below WCAG AA, worst %s" % (c["nlow"], c["low"][:3]))
                key = "%s-%s-%s" % (wn, sch, name)
                pg.screenshot(path=os.path.join(OUT, key + ".png"), full_page=True)
                bad += bool(notes); print(key, "; ".join(notes) if notes else "ok")
            pg.close()
    br.close()
print("pages with a finding:", bad)
