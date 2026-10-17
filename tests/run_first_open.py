"""python3 run_first_open.py - how long FinCom's first open takes on a slow office line (plan round 73 B). The React test
build (app/dist-test, or TDSDESK_SITE) opened in a fresh browser (nothing kept) over a throttled line (1.6 Mbps down,
750 kbps up, 150 ms round trip) on a computer 4x slower, RUNS times; printed: the first paint, the time the program's
script has run (legacy.js), and the time to the first meaningful page: the app drawn (#app .react-host) and the frame
drawn before the program (data-boot-part) gone; and what went over the line before that page and in the first AFTER
seconds (FIRST_OPEN_AFTER, 20 by default), the service worker on (localStorage fincom.sw = "on", as on the site).
Measuring only: FIRST_OPEN_MAX_MS, when set, is the budget the first meaningful page must meet.
  flock /tmp/fincom-app.lock python3 tests/run_first_open.py"""
import os, re, io, gzip, sys, time, json, threading, functools, http.server, statistics
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FIRST_OPEN_PORT") or 8373)
RUNS = int(os.environ.get("RUNS") or 3)
MAX = os.environ.get("FIRST_OPEN_MAX_MS")

# served as GitHub Pages serves it: text files gzipped, every file kept by the browser for 10 minutes
GZ = {}
SENT = []        # (time, bytes) of each answer
AFTER = int(os.environ.get("FIRST_OPEN_AFTER") or 20)
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "max-age=600"); super().end_headers()
    def send_head(self):
        path = self.translate_path(self.path.split("?")[0])
        if os.path.isdir(path): path = os.path.join(path, "index.html")
        if "gzip" not in (self.headers.get("Accept-Encoding") or "") or not re.search(r"\.(js|css|html|json|svg)$", path) or not os.path.isfile(path):
            if os.path.isfile(path): SENT.append((time.time(), os.path.getsize(path)))
            return super().send_head()
        if path not in GZ: GZ[path] = gzip.compress(open(path, "rb").read(), 6)
        body = GZ[path]; SENT.append((time.time(), len(body)))
        self.send_response(200); self.send_header("Content-Type", self.guess_type(path)); self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        return io.BytesIO(body)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(H, directory=SITE))
srv.handle_error = lambda *a: None      # a request the browser gave up on
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT

PROBE = r"""(() => { const M = window.__fo = {};
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === "first-contentful-paint") M.fcp = Math.round(e.startTime); })).observe({type: "paint", buffered: true}); } catch (e) {}
  const look = () => {
    if (M.legacy == null && typeof render === "function" && typeof S === "object") M.legacy = Math.round(performance.now());
    const boot = [...document.querySelectorAll("[data-boot-part]")].some((e) => e.getClientRects().length);
    if (M.page == null && document.querySelector("#app .react-host") && !boot) M.page = Math.round(performance.now());
    if (M.page == null) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
  try { localStorage.setItem("fincom.sw", "on"); } catch (e) {}
  try { if (!localStorage.getItem("tdsdesk-test:cloud")) localStorage.setItem("tdsdesk-test:cloud", JSON.stringify({gate: false})); } catch (e) {}
})()"""

out = {"fcp": [], "legacy": [], "page": [], "kb_page": [], "kb_after": []}
with sync_playwright() as p:
    br = p.chromium.launch()
    for i in range(RUNS):
        ctx = br.new_context(viewport={"width": 1366, "height": 768}); ctx.add_init_script(PROBE)
        pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 1.6e6 / 8, "uploadThroughput": 750e3 / 8})
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        SENT.clear(); t0 = time.time()
        pg.goto(URL, wait_until="commit")
        pg.wait_for_function("() => window.__fo && window.__fo.page != null", timeout=180000, polling=250)
        tp = time.time(); pg.wait_for_timeout(AFTER * 1000)
        m = pg.evaluate("window.__fo")
        m["kb_page"] = sum(b for t, b in SENT if t <= tp) // 1024; m["kb_after"] = sum(b for t, b in SENT if tp < t <= tp + AFTER) // 1024
        for k in out: out[k].append(m.get(k))
        print("  run %d: first paint %s ms, program run %s ms, first meaningful page %s ms; %s KB before it, %s KB more in the %d s after it" % (i + 1, m.get("fcp"), m.get("legacy"), m.get("page"), m["kb_page"], m["kb_after"], AFTER))
        ctx.close()
    br.close()
srv.shutdown()
med = {k: int(statistics.median([x for x in v if x is not None])) if any(x is not None for x in v) else None for k, v in out.items()}
print("median of %d: first paint %s ms, program run %s ms, first meaningful page %s ms; %s KB before it, %s KB more in the %d s after it" % (RUNS, med["fcp"], med["legacy"], med["page"], med["kb_page"], med["kb_after"], AFTER))
if MAX:
    ok = med["page"] is not None and med["page"] <= int(MAX)
    print(("  ok   " if ok else "  FAIL ") + "first meaningful page %s ms <= %s" % (med["page"], MAX)); sys.exit(0 if ok else 1)
