"""python3 tests/run_cf_pages.py DIR - a copy of main served as Cloudflare Pages serves it (tests/cf_pages.py, with this
branch's _headers unless DIR has its own or CF_HEADERS says), checked in Chromium (docs/CLOUDFLARE.md):
  1. the headers: security headers on every answer, the app's CSP on /review/, the cache rules (hashed files a year; the
     pages, sw.js, build.json, the bridges' latest.json and status.json asked again each time)
  2. Pages' addresses: / sends the app's address on to /review/ (with the #route); /review -> /review/; remote-help.html
     -> remote-help; /.well-known/security.txt; a missing file is a 404 (needs /404.html: without it Pages answers every
     missing address with the root page and 200)
  3. the app opens with no CSP or Permissions-Policy message, the service worker takes /review/, the Tally page's
     fetch of assets/bridge-go/latest.json works, a print frame (blob:) opens, and another site cannot frame the app
  4. what must never be public answers 404: connector/signing-key.enc, source maps, server/, docs/, tests/, .github/ …
Make DIR with: git archive origin/main | tar -x -C DIR (and put the new _headers, 404.html, wrangler.jsonc, cloudflare/ in
it). Best against Cloudflare's own server: `npx wrangler@4 dev --port 8790` in DIR (it runs cloudflare/build-site.sh),
then CF_URL=http://127.0.0.1:8790 python3 tests/run_cf_pages.py DIR/cf-site. Without CF_URL, tests/cf_pages.py serves DIR."""
import os, sys, json, re, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
import cf_pages
from playwright.sync_api import sync_playwright

SITE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else sys.exit(__doc__)
if os.environ.get("CF_URL"):   # a server already running, e.g. `wrangler dev` in the folder cloudflare/build-site.sh made
    B, hfile = os.environ["CF_URL"].rstrip("/"), "the server at " + os.environ["CF_URL"]
    OTHERB = B.replace("127.0.0.1", "localhost") if "127.0.0.1" in B else B.replace("localhost", "127.0.0.1")
else:
    PORT = int(os.environ.get("CF_PORT") or 8788)
    srv, hfile = cf_pages.serve(SITE, PORT)
    other, _ = cf_pages.serve(SITE, PORT + 1)
    B, OTHERB = "http://localhost:%d" % PORT, "http://localhost:%d" % (PORT + 1)   # the second origin tries to frame the app
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedirect)
def get(path):
    try: r = op.open(B + path)
    except urllib.error.HTTPError as e: r = e
    return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()

print("headers from", hfile)
# 1. headers
s, h, _ = get("/review/")
ok(s == 200 and "default-src 'self'" in h.get("content-security-policy", "") and "frame-ancestors 'none'" in h.get("content-security-policy", ""), "/review/ carries the app's CSP with frame-ancestors 'none'")
ok(h.get("x-frame-options") == "DENY" and h.get("x-content-type-options") == "nosniff" and h.get("referrer-policy") == "strict-origin-when-cross-origin", "X-Frame-Options, nosniff, Referrer-Policy")
ok("max-age=31536000" in h.get("strict-transport-security", ""), "HSTS")
pp = h.get("permissions-policy", "")
ok(all(f + "=(self)" in pp for f in ("camera", "microphone", "display-capture", "fullscreen", "autoplay")) and "geolocation=()" in pp, "Permissions-Policy: camera, microphone, display-capture, fullscreen, autoplay for the site; geolocation and the rest off")
ok(h.get("cache-control") == "no-cache", "/review/ is asked again each time (%s)" % h.get("cache-control"))
idx = open(os.path.join(SITE, "review", "index.html"), encoding="utf-8").read()
js = re.search(r'src="\./(assets/index-[^"]+\.js)"', idx).group(1)
for path, want in (("/review/" + js, "public, max-age=31536000, immutable"), ("/review/sw.js", "no-cache"), ("/review/build.json", "no-cache"),
                   ("/review/assets/bridge-go/latest.json", "no-cache"), ("/status/status.json", "no-cache"), ("/", "no-cache"),
                   ("/review/assets/exceljs.min.js", "public, max-age=86400"), ("/review/assets/bridge-setup.txt", "no-cache"),
                   ("/assets/connector/latest.json", "no-cache")):
    s, h, _ = get(path)
    ok(s == 200 and h.get("cache-control") == want, "%s: %s (%s %s)" % (path, want, s, h.get("cache-control")))
s, h, body = get("/review/assets/bridge-go/latest.json")
ok("json" in h.get("content-type", "") and json.loads(body).get("bridge", {}).get("url", "").startswith("https://staging.fincom.live/review/assets/bridge-go/"), "the bridge's latest.json: JSON, pointing at /review/assets/bridge-go/")
s, h, _ = get("/welcome/")
ok("frame-ancestors 'none'" in h.get("content-security-policy", "") and "default-src" not in h.get("content-security-policy", ""), "other pages keep their own <meta> CSP; the header adds frame-ancestors, object-src, base-uri, form-action only")

# 2. Pages' addresses
s, h, _ = get("/index.html"); ok(s in (307, 308) and h.get("location") == "/", "/index.html -> / (%d)" % s)
s, h, _ = get("/review"); ok(s in (307, 308) and h.get("location") == "/review/", "/review -> /review/ (%d)" % s)
s, h, _ = get("/review/remote-help.html"); ok(s in (307, 308) and h.get("location") == "/review/remote-help", "remote-help.html -> remote-help (%d): the link in a call still works" % s)
s, h, b = get("/review/remote-help"); ok(s == 200 and b"Remote help" in b, "/review/remote-help is the page")
s, h, b = get("/.well-known/security.txt"); ok(s == 200 and b"Contact:" in b, "/.well-known/security.txt is served")
has404 = os.path.isfile(os.path.join(SITE, "404.html"))
s, h, b = get("/review/assets/not-there-0000.js")
ok(s == 404 if has404 else (s == 200 and b"location.replace" in b), ("a missing file is a 404 (/404.html)" if has404 else "no /404.html: a missing file gets the root page with 200 (Pages' single-page mode); add 404.html"))
for path in ("/connector/signing-key.enc", "/review/legacy.js.map", "/server/", "/docs/", "/tests/", "/README.md", "/CNAME", "/build.py", "/.github/workflows/"):
    if os.environ.get("CF_URL") or not os.path.exists(os.path.join(SITE, path.strip("/"))):
        s, h, b = get(path); ok(s == 404, "%s is not served (%d)" % (path, s))

# 3. in Chromium
MSG = re.compile(r"Content Security Policy|Refused to|Permissions[- ]Policy|Unrecognized feature|\[csp\]", re.I)
with sync_playwright() as p:
    br = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    ctx = br.new_context(viewport={"width": 1280, "height": 860}, permissions=["camera", "microphone"])
    ctx.add_init_script("try{localStorage.setItem('fincom.sw','on')}catch(e){};" + cf_pages.LISTEN)
    msgs = []
    pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on("console", lambda m: MSG.search(m.text) and msgs.append(m.text[:300]))
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#/meetings"); pg.wait_for_url(re.compile(r"/review/"), timeout=15000)
    ok(pg.url.endswith("/review/#/meetings") or "/review/" in pg.url, "/ sends the app's address on to /review/ with its #route (%s)" % pg.url)
    pg.wait_for_timeout(3000)
    ok(pg.locator("text=Sign in").count() > 0 or pg.locator('button[data-act="useOffline"]').count() > 0, "the sign-in page is drawn")
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(2500)
    reg = pg.evaluate("""async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(() => ok(null), 10000))]);
      return r ? {scope: r.scope, active: !!r.active} : null }""")
    ok(bool(reg and reg["active"] and reg["scope"].endswith("/review/")), "the service worker is registered for /review/ (%s)" % reg)
    lj = pg.evaluate("""() => fetch("assets/bridge-go/latest.json", {cache: "no-store"}).then((r) => r.ok ? r.json() : null).then((j) => j && j.bridge && j.bridge.version, () => "failed")""")
    ok(bool(lj) and lj != "failed", "the page fetches assets/bridge-go/latest.json (bridge %s)" % lj)
    fr = pg.evaluate("""() => new Promise((ok) => { const f = document.createElement("iframe"); f.style.cssText = "width:10px;height:10px";
      f.src = URL.createObjectURL(new Blob(["<p id=x>print me</p>"], {type: "text/html"}));
      f.onload = () => { try { ok(f.contentDocument.getElementById("x").textContent) } catch (e) { ok("err " + e.message) } }; document.body.appendChild(f); setTimeout(() => ok("timeout"), 5000) })""")
    ok(fr == "print me", "a print frame (blob:, as Notes and the bill viewer make) opens inside the app (%s)" % fr)
    pg.reload(); pg.wait_for_timeout(2500)
    ok(pg.evaluate("!!navigator.serviceWorker.controller"), "after a reload the service worker serves the page")
    # framing from another origin
    fp = ctx.new_page(); fmsgs = []; fp.on("console", lambda m: fmsgs.append(m.text[:200]))
    fp.goto(OTHERB + "/status/")
    fp.evaluate("(u) => { const f = document.createElement('iframe'); f.src = u; document.body.appendChild(f); }", B + "/review/")
    fp.wait_for_timeout(2500)
    framed = [f for f in fp.frames if f.url.startswith(B)]
    blocked = any("frame-ancestors" in m or "X-Frame-Options" in m for m in fmsgs)
    ok(blocked, "another site cannot frame the app (frame-ancestors 'none'): %s" % ([m for m in fmsgs if "frame" in m.lower()][:1] or fmsgs[:1]))
    ok(not msgs, "no CSP or Permissions-Policy message from the app: %s" % msgs[:6])
    ok(not errs, "no page errors: %s" % errs[:3])
    br.close()
print("\n%s" % ("all passed" if not fails else "%d failed" % len(fails)))
sys.exit(1 if fails else 0)
