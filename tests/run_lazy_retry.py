"""python3 run_lazy_retry.py - round 64 (the owner's Safari, 16-Oct-2026: "This page could not be loaded. Reload FinCom" on GB
TEXCOAT's TDS, nothing in Sentry). A page's own file (the Books file: TDS, GST, MIS, Accounts, Audit) that could not be
fetched once stayed failed for the whole visit (the browser keeps the failed module), until the person reloaded. Now:
  - fetched ahead in the background and failing: nothing reloads; written to the console (and to Sentry's reporter);
  - failing when its page is opened: written to the console, and the page reloads by itself once (the address keeps the
    page), so a blip or a file of a build published meanwhile heals without a click;
  - still failing within two minutes: no second reload (the note "This page could not be loaded. Reload FinCom" as before).
Red on the published build (the page stays dead, nothing said). Run: TDSDESK_SITE=../app/dist-test python3 run_lazy_retry.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8478), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
GO = """() => {
  let c = Object.values(S.companies).find(x => x.name === "GB TEXCOAT");
  if (!c){ c = newCompany({name: "GB TEXCOAT", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; }
  S.books = {cid: c.id, loading: false, vouchers: [], meta: {}, map: {}, challans: [], alloc: {}}; S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "tds"; render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch()
    for mode in ("once", "always"):
        pg = br.new_context(service_workers="block").new_page(); n = {"books": 0, "nav": 0}; logs = []
        pg.on("console", lambda m, logs=logs: logs.append(m.text))
        pg.on("load", lambda _p, n=n: n.__setitem__("nav", n["nav"] + 1))
        def rt(r, mode=mode, n=n):
            n["books"] += 1
            if mode == "always" or n["books"] <= 1: return r.abort("failed")
            return r.continue_()
        pg.route("**/assets/Books-*.js", rt)
        pg.goto("http://localhost:8478/"); pg.wait_for_timeout(2500)
        nav0 = n["nav"]
        ok(nav0 == 1, "%s: the Books file fetched ahead and failing: the page does not reload (%d)" % (mode, nav0))
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(600)
        pg.evaluate(GO); pg.wait_for_timeout(4000)
        said = [l for l in logs if "a page's file could not be loaded" in l]
        ok(said, "%s: the failure is written to the console (and handed to Sentry's reporter)" % mode)
        ok(n["nav"] >= 2, "%s: opening TDS with its file failed: the page reloads by itself (%d loads)" % (mode, n["nav"]))
        if n["nav"] >= 2:
            try: pg.click('button[data-act="useOffline"]', timeout=3000); pg.wait_for_timeout(600)
            except Exception: pass
            pg.evaluate(GO); pg.wait_for_timeout(4000)
        failed = pg.locator("#app [data-lazy-failed]").count()
        if mode == "once":
            ok(failed == 0 and n["books"] >= 2, "once: after the reload the file comes and TDS shows (%d fetches)" % n["books"])
        else:
            ok(n["nav"] == 2, "always: no second reload within two minutes (%d loads)" % n["nav"])
        pg.close()
    br.close()
if fails: print("FAILED: %d" % len(fails)); raise SystemExit(1)
print("all passed")
