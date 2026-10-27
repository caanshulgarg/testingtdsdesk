"""python3 run_open_line.py - the first open of FinCom on a slow office line (speed round, 27-Oct-2026; staging's
client_timings for one fresh open: first byte 2.2 s, legacy.js 599,730 bytes in 11.7 s (about 51 KB/s), DOM ready 14 s,
load 19.6 s; then 50 script files (924 KB) and 9 styles (97 KB) right after the first page, and build.json (91 bytes)
waiting up to 61 s behind them).
A server that sends the built site gzipped (as Cloudflare does) and counts every request and every byte it sends, the
service worker on (as on the site), a browser on an emulated line:
  1. a slow line (400 kbit/s, 150 ms): the first page is drawn; after it, in the next 40 s, the other screens' files are
     not fetched ahead (they come when their page is opened), nor kept by the service worker ahead: at most SLOW_AFTER
     requests and SLOW_AFTER_KB after the first page; build.json asked once for each load of the page
     (the page's own check), not twice;
  2. a fast line: the other screens' files are fetched ahead after the first page, 2 at a time (with the worker's
     one and the page's own, at most 4 script files at once);
  3. a screen opened on the slow line still opens (its file fetched then).
Prints the requests and kilobytes before and after the first page, by kind, for each line.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_open_line.py"""
import os, sys, gzip, time, json, threading, functools, http.server, collections
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8437
SLOW_AFTER, SLOW_AFTER_KB = 6, 60
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

LOG, LOCK = [], threading.Lock()
INFLIGHT = {"n": 0, "max": 0}
TEXT = (".js", ".css", ".html", ".json", ".svg", ".txt", ".map", ".mjs", "/")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        p = self.path.split("?")[0]
        if "/assets/" in p: self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else: self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def do_GET(self):
        p = self.path.split("?")[0]
        full = self.translate_path(p if not p.endswith("/") else p + "index.html")
        with LOCK: INFLIGHT["n"] += 1; INFLIGHT["max"] = max(INFLIGHT["max"], INFLIGHT["n"]) if "/assets/" in p and p.endswith(".js") else INFLIGHT["max"]
        try:
            if os.path.isfile(full) and full.endswith(TEXT[:-1]) and "gzip" in (self.headers.get("Accept-Encoding") or ""):
                body = gzip.compress(open(full, "rb").read(), 6)
                self.send_response(200)
                self.send_header("Content-Type", self.guess_type(full)); self.send_header("Content-Encoding", "gzip"); self.send_header("Content-Length", str(len(body)))
                self.end_headers(); self.wfile.write(body); n = len(body)
            else:
                n0 = os.path.getsize(full) if os.path.isfile(full) else 0
                super().do_GET(); n = n0
            with LOCK: LOG.append((time.time(), p, n))
        finally:
            with LOCK: INFLIGHT["n"] -= 1

def kind(p):
    f = p.rsplit("/", 1)[-1]
    if f.startswith("legacy"): return "legacy"
    if f == "" or f.endswith(".html"): return "page"
    return f.rsplit(".", 1)[-1] if "." in f else "other"

def run(br, label, kbps, latency, after_s=40):
    LOG.clear(); INFLIGHT["max"] = 0
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script("try { localStorage.setItem('fincom.sw', 'on'); } catch (e) {}")
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": latency, "downloadThroughput": kbps * 1000 / 8, "uploadThroughput": kbps * 1000 / 8})
    t0 = time.time()
    pg.goto("http://localhost:%d/" % PORT, wait_until="commit", timeout=180000)
    # the first page: the sign-in page drawn by the program (no frame left), then "without an account" -> the app
    pg.wait_for_selector('button[data-act="useOffline"]', timeout=180000)
    pg.click('button[data-act="useOffline"]')
    pg.wait_for_function("() => !document.querySelector('[data-boot-part]') && !!document.querySelector('#app')", timeout=120000)
    t1 = time.time()
    first = list(LOG); INFLIGHT["max"] = 0
    pg.wait_for_timeout(after_s * 1000)
    after = LOG[len(first):]
    def summ(rows):
        c = collections.Counter(); b = collections.Counter()
        for _, p, n in rows: c[kind(p)] += 1; b[kind(p)] += n
        return {k: "%d / %d KB" % (c[k], b[k] // 1024) for k in sorted(c)}, len(rows), sum(n for _, _, n in rows) // 1024
    s1, n1, k1 = summ(first); s2, n2, k2 = summ(after)
    print("  %s: first page in %.1f s: %d requests, %d KB %s" % (label, t1 - t0, n1, k1, s1))
    print("  %s: the %d s after it: %d requests, %d KB %s; most script files at once: %d" % (label, after_s, n2, k2, s2, INFLIGHT["max"]))
    res = {"t": t1 - t0, "n1": n1, "k1": k1, "n2": n2, "k2": k2, "json": sum(1 for _, p, _ in LOG if p.endswith("build.json")), "pages": sum(1 for _, p, _ in LOG if kind(p) == "page"), "max": INFLIGHT["max"], "pg": pg, "ctx": ctx}
    return res

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        slow = run(br, "slow line", 400, 150)
        ok(slow["n2"] <= SLOW_AFTER and slow["k2"] <= SLOW_AFTER_KB, "slow line: the other screens are not fetched ahead after the first page (%d requests, %d KB)" % (slow["n2"], slow["k2"]))
        ok(slow["json"] <= slow["pages"], "slow line: build.json asked once for each load of the page (%d for %d)" % (slow["json"], slow["pages"]))
        # 3. a screen opened there still opens
        pg = slow["pg"]; n0 = len(LOG)
        pg.evaluate("() => navHome('tally')"); pg.wait_for_timeout(15000)
        ok(pg.locator("#app [data-connect-guide], #app [data-pc-line], #app [data-tco-list]").count() > 0, "slow line: the Tally page opens when asked (its file then: %d requests)" % (len(LOG) - n0))
        slow["ctx"].close()
        fast = run(br, "fast line", 50000, 5, 25)
        ok(fast["n2"] >= 10, "fast line: the other screens are fetched ahead after the first page (%d requests)" % fast["n2"])
        ok(fast["max"] <= 4, "fast line: 2 script files at once ahead, besides the page's own and the worker's one (%d)" % fast["max"])
        fast["ctx"].close()
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
