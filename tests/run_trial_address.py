"""python3 tests/run_trial_address.py - the trial address (docs/RELEASE-FLOW.md): the React test build at /review/ and a
newer one at /next/ of one site, served as Cloudflare serves main (tests/cf_pages.py, with cloudflare/_headers.main, the
_headers main is to have), the service worker on. Builds: A = app/dist-test as it is (at review/), B and C = the same
files with a new build id (at next/; C is the next publish to next/). Copies are hard links: no disk space.
  1. /review/ and /next/ both open (no CSP or Permissions-Policy message); /next/'s strip says TRIAL, /review/'s does not;
  2. two workers, one per address (scope /review/ and /next/), each with its own caches (fincom-shell:/review/:A,
     fincom-shell:/next/:B); signing out at /next/ clears only /next/'s kept files;
  3. opening /next/, and a new build there (B -> C, the page reloaded twice), never touches a /review/ tab: it is not
     reloaded, its worker and caches stay, no "new version" bar; /review/ still answers with A;
  4. promote (review/ = next/'s files as they are): the /review/ tab, reloaded twice, runs C under /review/'s own worker and
     caches, without the TRIAL strip; /next/'s worker and caches are untouched;
  5. the headers: /next/ gets the same CSP and cache rules as /review/.
  flock /tmp/fincom-app.lock python3 tests/run_trial_address.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, re, sys, json, time, base64, shutil, hashlib, tempfile, urllib.request
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import cf_pages
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(REPO, "app", "dist-test")))
PORT = int(os.environ.get("TRIAL_PORT") or 8613)
BASE = "http://localhost:%d" % PORT
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------------------------------------------------------------- the site: review/ = A, next/ = B (C waits beside it)
T = tempfile.mkdtemp(prefix="fincom-trial-")
ROOT = os.path.join(T, "site"); os.makedirs(ROOT)
shutil.copy(os.path.join(REPO, "cloudflare", "_headers.main"), os.path.join(ROOT, "_headers"))
IDA = json.load(open(os.path.join(SITE, "build.json")))["build"]
def boot_hash(html):
    m = re.search(r'<script id="fincom-boot">([\s\S]*?)</script>', html)
    return "'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode() + "'"
def copy_as(dst, bid):
    """the build with another id: hard links, but for the three files that name it (index.html keeps its CSP hash right)"""
    shutil.copytree(SITE, dst, copy_function=os.link, ignore=shutil.ignore_patterns("bridge-go"))
    if bid == IDA: return
    for f in ("index.html", "build.json", "sw.js"):
        p = os.path.join(dst, f); t = open(p, encoding="utf-8").read(); os.unlink(p)
        u = t.replace(IDA, bid)
        if f == "index.html": u = u.replace(boot_hash(t), boot_hash(u))
        open(p, "w", encoding="utf-8").write(u)
def published(d):
    """a publish writes its files now: the test server (Python's) answers 304 to If-Modified-Since by the file's time, to
    the second, and B and C were written in the same second (Cloudflare answers by ETag, so this is the test's only)"""
    later = time.time() + 120
    for f in ("index.html", "build.json", "sw.js"): os.utime(os.path.join(d, f), (later, later))
IDB = IDA[:-3] + ("bbb" if not IDA.endswith("bbb") else "ccc"); IDC = IDA[:-3] + "ddd"
copy_as(os.path.join(ROOT, "review"), IDA)
copy_as(os.path.join(ROOT, "next"), IDB)
copy_as(os.path.join(T, "C"), IDC)
srv, hfile = cf_pages.serve(ROOT, PORT)
cf_pages.watch_playwright()

INIT = ("try{localStorage.setItem('fincom.sw','on');if(!localStorage.getItem('tdsdesk-test:cloud'))localStorage.setItem('tdsdesk-test:cloud',JSON.stringify({gate:false}))}catch(e){}")
def drawn(pg, ms=30000):
    try: pg.wait_for_function("() => !!document.querySelector('#app .react-host')", timeout=ms); return True
    except Exception: return False
def build_of(pg):
    t = pg.evaluate("() => (document.getElementById('fincom-boot') || {}).textContent || ''")
    return "A" if IDA in t else "B" if IDB in t else "C" if IDC in t else "?"
def controlled(pg, path, ms=20000):
    try:
        pg.wait_for_function("(p) => !!navigator.serviceWorker.controller && new URL(navigator.serviceWorker.controller.scriptURL).pathname === p", arg=path + "sw.js", timeout=ms)
        return True
    except Exception: return False
CTL = "() => navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : ''"
KEYS = "() => caches.keys().then((k) => k.filter((x) => x.startsWith('fincom-')).sort())"
STRIP = "() => getComputedStyle(document.body, '::after').content"
def wait_cache(pg, key, ms=30000):
    """a new build's worker is installed after its page (the browser looks for a new sw.js at each open): its cache, waited for"""
    t0 = time.time()
    while time.time() - t0 < ms / 1000:
        if pg.evaluate("(k) => caches.has(k)", key): pg.wait_for_timeout(1500); return True
        pg.wait_for_timeout(500)
    return False
def shell_count(pg, key):
    return pg.evaluate("(k) => caches.has(k).then((h) => h ? caches.open(k).then((c) => c.keys()).then((r) => r.length) : -1)", key)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 760}); ctx.add_init_script(INIT)
        errs = []
        print("1. /review/ and /next/ both open")
        R = ctx.new_page(); R.on("pageerror", lambda e: errs.append("review: " + str(e)))
        R.goto(BASE + "/review/")
        ok(drawn(R) and build_of(R) == "A", "/review/ opens, build A (%s)" % build_of(R))
        ok(controlled(R, "/review/"), "/review/'s worker in charge of it (%s)" % R.evaluate(CTL))
        R.wait_for_timeout(1500)
        R.evaluate("() => { window.__zzStay = 1; }")
        loadsR = []
        R.on("request", lambda r: loadsR.append(r.url) if r.is_navigation_request() and r.frame == R.main_frame else None)
        shellA = "fincom-shell:/review/:" + IDA
        nA = shell_count(R, shellA)
        ok(nA > 0, "/review/'s kept files: %s (%d)" % (shellA, nA))
        ok("TRIAL" not in R.evaluate(STRIP) and R.evaluate("() => !document.documentElement.hasAttribute('data-trial')"), "/review/'s strip does not say TRIAL (%s)" % R.evaluate(STRIP)[:60])

        N = ctx.new_page(); N.on("pageerror", lambda e: errs.append("next: " + str(e)))
        N.goto(BASE + "/next/")
        ok(drawn(N) and build_of(N) == "B", "/next/ opens, build B (%s)" % build_of(N))
        ok(controlled(N, "/next/"), "/next/'s own worker in charge of it (%s)" % N.evaluate(CTL))
        ok("TRIAL" in N.evaluate(STRIP) and N.evaluate("() => document.documentElement.hasAttribute('data-trial')"), "/next/'s strip says TRIAL (%s)" % N.evaluate(STRIP)[:70])
        N.wait_for_timeout(1500)

        print("2. two workers, two sets of caches")
        scopes = sorted(N.evaluate("() => navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => new URL(r.scope).pathname))"))
        ok(scopes == ["/next/", "/review/"], "one worker per address, scopes %s" % scopes)
        keys = N.evaluate(KEYS)
        ok(shellA in keys and ("fincom-shell:/next/:" + IDB) in keys, "caches: %s" % keys)
        ok(not [k for k in keys if k.startswith("fincom-shell:/next/") and IDA in k] and not [k for k in keys if k.startswith("fincom-shell:/review/") and IDB in k], "no cache of one address names the other's build")
        ok(shell_count(R, shellA) == nA, "/review/'s kept files untouched by /next/'s worker (%d)" % shell_count(R, shellA))
        R.evaluate("() => caches.open('fincom-files:/review/').then((c) => c.put('./assets/zz-review.js', new Response('1')))")
        N.evaluate("() => caches.open('fincom-files:/next/').then((c) => c.put('./assets/zz-next.js', new Response('1')))")
        N.evaluate("() => Cloud.signOut()"); N.wait_for_timeout(800)
        keys = N.evaluate(KEYS)
        ok("fincom-files:/review/" in keys and "fincom-files:/next/" not in keys, "signing out at /next/ clears /next/'s kept files only (%s)" % [k for k in keys if k.startswith("fincom-files")])

        print("3. a new build at /next/ (B -> C), reloaded twice; the /review/ tab untouched")
        os.rename(os.path.join(ROOT, "next"), os.path.join(T, "B")); os.rename(os.path.join(T, "C"), os.path.join(ROOT, "next"))
        published(os.path.join(ROOT, "next"))
        N.bring_to_front(); N.reload(); drawn(N); N.wait_for_timeout(1500); N.reload(); drawn(N); N.wait_for_timeout(1500)
        ok(build_of(N) == "C" and controlled(N, "/next/"), "/next/ runs C after two reloads (%s)" % build_of(N))
        # C's worker is installed after the page (the browser looks for a new sw.js at each open): waited for, 30 s at most
        wait_cache(N, "fincom-shell:/next/:" + IDC)
        keys = N.evaluate(KEYS)
        ok(("fincom-shell:/next/:" + IDC) in keys and ("fincom-shell:/next/:" + IDB) not in keys and shellA in keys, "/next/'s worker dropped B's cache, not /review/'s (%s)" % keys)
        R.bring_to_front(); R.evaluate("() => { window.dispatchEvent(new Event('focus')); }"); R.wait_for_timeout(3000)
        ok(R.evaluate("() => window.__zzStay") == 1 and not loadsR, "the /review/ tab was never reloaded (%d loads)" % len(loadsR))
        ok(R.evaluate(CTL) == "/review/sw.js" and build_of(R) == "A", "still A, under /review/'s worker (%s, %s)" % (build_of(R), R.evaluate(CTL)))
        ok(shell_count(R, shellA) == nA, "/review/'s kept files all there (%d)" % shell_count(R, shellA))
        ok(not R.evaluate("() => !!document.querySelector('[data-new-version]')"), "no \"A new version of FinCom is ready\" bar on /review/")
        R2 = ctx.new_page(); R2.goto(BASE + "/review/"); drawn(R2)
        ok(build_of(R2) == "A", "a new /review/ tab: still A (%s)" % build_of(R2)); R2.close()

        print("4. promote: review/ = next/'s files as they are; the /review/ tab reloaded twice")
        os.rename(os.path.join(ROOT, "review"), os.path.join(T, "A"))
        shutil.copytree(os.path.join(ROOT, "next"), os.path.join(ROOT, "review"), copy_function=os.link)
        published(os.path.join(ROOT, "review"))
        R.reload(); drawn(R); R.wait_for_timeout(1500); R.reload(); drawn(R); R.wait_for_timeout(1500)
        ok(build_of(R) == "C" and controlled(R, "/review/"), "/review/ runs C under its own worker (%s, %s)" % (build_of(R), R.evaluate(CTL)))
        ok("TRIAL" not in R.evaluate(STRIP), "the same files at /review/: no TRIAL strip (%s)" % R.evaluate(STRIP)[:60])
        wait_cache(R, "fincom-shell:/review/:" + IDC)
        keys = R.evaluate(KEYS)
        ok(("fincom-shell:/review/:" + IDC) in keys and shellA not in keys and ("fincom-shell:/next/:" + IDC) in keys, "caches: /review/'s for C, /next/'s kept (%s)" % keys)
        ok(N.evaluate(CTL) == "/next/sw.js" and build_of(N) == "C", "the /next/ tab untouched")
        ok(not errs, "no page errors (%s)" % errs[:3])

        print("5. the headers at /next/ are /review/'s")
        def hdr(path):
            with urllib.request.urlopen(BASE + path) as r: return {k.lower(): v for k, v in r.headers.items()}
        asset = sorted(f for f in os.listdir(os.path.join(ROOT, "next", "assets")) if f.endswith(".js"))[0]
        for a, b in (("/review/", "/next/"), ("/review/sw.js", "/next/sw.js"), ("/review/build.json", "/next/build.json"), ("/review/assets/" + asset, "/next/assets/" + asset), ("/review/guard.js", "/next/guard.js")):
            ha, hb = hdr(a), hdr(b)
            ok(ha.get("cache-control") == hb.get("cache-control") and ha.get("content-security-policy") == hb.get("content-security-policy"),
               "%s: Cache-Control %r, the same CSP as %s" % (b, hb.get("cache-control"), a))
        br.close()
    seen = sorted(set(cf_pages.MSGS))
    ok(not seen, "no CSP or Permissions-Policy message (%s)" % seen[:3])
finally:
    srv.shutdown(); shutil.rmtree(T, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
