"""python3 run_native_unit.py - the phone app's adapter (app/src/lib/native.js, branch next-mobile) and its PDF of scanned
pages (app/src/lib/jpegPdf.js), checked in a real Chromium page (tests/native_unit.mjs): each feature on the web (no
Capacitor) does what the web app does today (Take photo's input, the browser's download, the session in localStorage, no
lock, no push), and with a stand-in Capacitor bridge it calls the phone (camera with crop, several pages made one PDF
into the upload flow, the Keychain, the share sheet for exports, the back button, deep links, the app lock, push
registration and sign-out, files shared to FinCom). No build needed; nothing reaches a network."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, ".."))
PORT = int(os.environ.get("NATIVE_UNIT_PORT") or 8461)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def do_GET(self):
        if self.path == "/blank.html":
            body = b"<!doctype html><meta charset=utf-8><title>native unit</title><body></body>"
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        if not (self.path.startswith("/app/src/lib/") or self.path.startswith("/tests/native_unit.mjs")): self.send_error(404); return
        super().do_GET()
H.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{".js": "text/javascript", ".mjs": "text/javascript"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:%d/blank.html" % PORT)
    res = pg.evaluate("() => import('/tests/native_unit.mjs').then((m) => m.run())")
    for good, what in res:
        print(("  ok   " if good else "  FAIL ") + what)
        if not good: fails.append(what)
    if errs: print("  FAIL page errors: %s" % errs[:3]); fails.append("page errors")
    br.close()
srv.shutdown()
print("\n%d checks, " % len(res) + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
