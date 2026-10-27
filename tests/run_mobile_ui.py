"""python3 run_mobile_ui.py - the phone app's copy of FinCom (branch next-mobile; app/dist-mobile-test, made by
`FINCOM_MOBILE=1 npx vite build --mode test` or mobile/scripts/build-web.mjs --staging; MOBILE_SITE to use another) at
390 px, with a made-up firm kept in the browser (no account, nothing sent anywhere):
  1. in a browser (no Capacitor): FinCom starts through native-boot.js as on the web; the main screens (Today, Clients,
     Compliance, Inbox, Settings, Tally, Help, a client's Overview, Upload, Purchase, Bank, Sales) have no sideways scroll;
     the upload box has "Take photo" and NO "Scan pages"; nothing of the phone is switched on (no FinComNative)
  2. on a phone (a stand-in Capacitor bridge, put in before the page's scripts as Capacitor does): the same screens, no
     sideways scroll; the frame marked fincom-native (safe areas), the status bar set; "Scan pages" shown; a scan of two
     pages (the camera stood in for) goes into the upload flow as one PDF
  3. the sign-in kept in the Keychain comes back before the program starts (sessionStorage, never localStorage)
  4. the web builds untouched: app/dist-test (when built) has no native-boot.js, no native-*.js and none of the phone's
     words in its first file; it keeps its service worker
Screenshots to tests/out/mobile/."""
import os, sys, re, glob, json, base64, io, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("MOBILE_SITE", os.path.join(HERE, "..", "app", "dist-mobile-test"))
WEB = os.path.join(HERE, "..", "app", "dist-test")
PORT = int(os.environ.get("MOBILE_UI_PORT") or 8463)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "mobile"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
if not os.path.exists(os.path.join(SITE, "index.html")):
    print("  FAIL no mobile build at %s (FINCOM_MOBILE=1 npx vite build --mode test, in app/)" % SITE); sys.exit(1)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT

# a tiny real JPEG (the stand-in camera's photo)
from PIL import Image
buf = io.BytesIO(); Image.new("RGB", (60, 80), (200, 220, 210)).save(buf, "JPEG"); PHOTO = base64.b64encode(buf.getvalue()).decode()
# the stand-in Capacitor bridge (what Capacitor's native-bridge.js puts in the page before its scripts)
CAP = r"""(([photo, kept]) => { const calls = window.__capCalls = [], listeners = window.__capListeners = {};
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", convertFileSrc: (u) => u,
    nativePromise: (p, m, o) => { calls.push([p, m, o || {}]);
      if (p === "SecureStorage" && m === "internalGetItem") return Promise.resolve({ data: kept });
      if (p === "Camera" && m === "getPhoto") return Promise.resolve({ base64String: photo, format: "jpeg" });
      if (p === "NativeBiometric" && m === "isAvailable") return Promise.resolve({ isAvailable: false });
      if (p === "PushNotifications" && m === "checkPermissions") return Promise.resolve({ receive: "denied" });
      if (p === "App" && m === "getInfo") return Promise.resolve({ version: "0.1.0" });
      return Promise.resolve({}); },
    addListener: (p, e, cb) => { (listeners[p + "." + e] = listeners[p + "." + e] || []).push(cb); return { remove() {} }; } }; })"""
SEED = """() => { S.firm.firmName = "Garg Shekhar & Company";
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tan = "DELZ12345A"; S.companies[c.id] = c; c.stats = {};
  const d = S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  const mk = (id, inv, vendor, total, st) => { const e = newEntry(inv + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: vendor, invoiceNo: inv, invoiceDate: "2026-09-12", total, taxable: Math.round(total / 1.18)}); e.status = st; d.entries[id] = e; };
  mk("s1", "FA/2026-27/081", "FINGATE ADVISORY SERVICES PVT LTD", 23600, "draft");
  mk("s2", "INV-4412", "MASTERCAD SOLUTIONS", 125000, "draft");
  mk("s3", "B/2209", "LYALLPUR TRADERS", 47200, "approved");
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; refreshStats(c.id);
  Store.saveFirm(); Object.values(S.companies).forEach((x) => Store.saveCompany(x)); Object.values(d.entries).forEach((e) => Store.saveEntry(c.id, e));
  render(); return c.id; }"""
ROUTES = ["#/today", "#/clients", "#/compliance", "#/inbox", "#/settings", "#/tally", "#/help", "/dash", "/upload", "/purchase/draft", "/bank", "/sales"]

def page(br, native, kept=None, w=390):
    ctx = br.new_context(viewport={"width": w, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    # nothing leaves this computer
    ctx.route(re.compile(r"^https?://(?!localhost[:/]).*"), lambda r: r.abort())
    if native: ctx.add_init_script("(%s)(%s)" % (CAP, json.dumps([PHOTO, kept])))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, pg
def start(pg):
    pg.goto(URL); pg.wait_for_function("() => typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm", timeout=20000)
    pg.evaluate("() => { if (signInNeeded()) doAct('useOffline'); }"); pg.wait_for_timeout(1200)
    cid = pg.evaluate(SEED); pg.wait_for_timeout(1200); return cid
def sideways(pg):
    return pg.evaluate("() => { const e = document.scrollingElement; return Math.max(e.scrollWidth, document.body.scrollWidth) - window.innerWidth; }")
def walk(pg, cid, tag):
    bad = []
    for r in ROUTES:
        h = r if r.startswith("#") else "#/c/" + cid + r
        pg.evaluate("(h) => { location.hash = h; }", h); pg.wait_for_timeout(900)
        over = sideways(pg)
        if over > 1: bad.append("%s +%dpx" % (h.replace(cid, "<c>"), over))
        pg.screenshot(path=os.path.join(OUT, "%s-%s.png" % (tag, re.sub(r"[^\w]+", "-", r).strip("-"))))
    return bad

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        print("1. in a browser (no Capacitor), 390 px")
        ctx, pg = page(br, False)
        html = open(os.path.join(SITE, "index.html")).read()
        ok('src="./native-boot.js"' in html and "viewport-fit=cover" in html and not os.path.exists(os.path.join(SITE, "sw.js")), "the phone's page: native-boot.js first, viewport-fit=cover, no service worker")
        cid = start(pg)
        ok(pg.evaluate("() => !window.FinComNative && !document.documentElement.classList.contains('fincom-native')"), "nothing of the phone switched on")
        # the upload box first (a visit to Sales leaves the upload step on sales documents)
        pg.evaluate("(c) => { location.hash = '#/c/' + c + '/upload'; }", cid); pg.wait_for_timeout(900)
        ok(pg.get_by_role("button", name="Take photo").count() == 1 and pg.locator("[data-native-scan]").count() == 0, "upload: Take photo, no Scan pages")
        bad = walk(pg, cid, "web")
        ok(not bad, "no sideways scroll on %d screens %s" % (len(ROUTES), bad))
        ctx.close()

        print("2. on a phone (a stand-in Capacitor), 390 px")
        ctx, pg = page(br, True)
        cid = start(pg)
        pg.wait_for_function("() => !!window.FinComNative", timeout=10000)
        calls = pg.evaluate("() => window.__capCalls.map((c) => c[0] + '.' + c[1])")
        ok(pg.evaluate("() => document.documentElement.classList.contains('fincom-native') && !!document.querySelector('[data-native-css]')") and "StatusBar.setStyle" in calls, "the frame: safe areas, the status bar (%s)" % sorted(set(calls))[:8])
        ok("SecureStorage.internalGetItem" in calls, "the Keychain asked before the program started")
        ok(all(k in pg.evaluate("() => Object.keys(window.__capListeners)") for k in ["App.backButton", "CapacitorShareTarget.shareReceived", "App.appUrlOpen"]), "back button, share to FinCom and links listened to")
        pg.evaluate("(c) => { location.hash = '#/c/' + c + '/upload'; }", cid); pg.wait_for_timeout(900)
        scan = pg.locator("[data-native-scan]")
        ok(scan.count() == 1 and scan.is_visible(), "upload: Scan pages shown")
        pg.evaluate("() => { window.__handed = []; const h = window.handleFiles; window.handleFiles = (fs, m) => { window.__handed.push([...fs].map((f) => [f.name, f.type, f.size, m])); }; }")
        scan.click(); pg.wait_for_selector("[data-native-sheet]", timeout=5000)
        pg.screenshot(path=os.path.join(OUT, "phone-scan-sheet.png"))
        pg.click("[data-native-sheet-more]"); pg.wait_for_selector("[data-native-sheet]", timeout=5000)
        ok("2 pages kept" in pg.inner_text("[data-native-sheet]"), "Add a page: the camera again, 2 pages kept")
        pg.click("[data-native-sheet-done]"); pg.wait_for_function("() => window.__handed.length > 0", timeout=5000)
        h = pg.evaluate("() => window.__handed[0]")
        ok(len(h) == 1 and h[0][1] == "application/pdf" and h[0][0].endswith("(2 pages).pdf") and h[0][3] == "company", "two pages read as one PDF into the open client's uploads %s" % h)
        cam = pg.evaluate("() => window.__capCalls.filter((c) => c[0] === 'Camera').map((c) => c[2])")
        ok(len(cam) == 2 and all(c.get("allowEditing") and c.get("source") == "CAMERA" for c in cam), "the camera opened twice, with its crop editor")
        bad = walk(pg, cid, "phone")
        ok(not bad, "no sideways scroll on %d screens %s" % (len(ROUTES), bad))
        ctx.close()

        print("3. the sign-in kept in the Keychain")
        kept = json.dumps({"access_token": "t.e.st", "refresh_token": "r", "user_id": "u-1", "email": "a@b.test", "at": 0, "expires_in": 3600})
        ctx, pg = page(br, True, kept)
        pg.goto(URL); pg.wait_for_function("() => typeof S === 'object' && !!S", timeout=20000); pg.wait_for_timeout(800)
        st = pg.evaluate("() => [sessionStorage.getItem('tdsdesk-test:cloudsess'), localStorage.getItem('tdsdesk-test:cloudsess')]")
        ok(st[0] and json.loads(st[0])["access_token"] == "t.e.st" and not st[1], "back in sessionStorage before the program, never in localStorage")
        ctx.close()

        print("4. the web builds untouched")
        if os.path.exists(os.path.join(WEB, "index.html")):
            first = "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(os.path.join(WEB, "assets", "index-*.js")))
            ok(not os.path.exists(os.path.join(WEB, "native-boot.js")) and not glob.glob(os.path.join(WEB, "assets", "native-*.js")) and os.path.exists(os.path.join(WEB, "sw.js")), "app/dist-test: no native-boot.js, no native-*.js; its service worker kept")
            ok(not re.search(r"FinComNative|data-native-scan|nativePromise|Scan pages", first), "the web's first file has none of the phone's code")
        else: print("  skipped: app/dist-test not built")
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page error %s" % errors[:3])
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
