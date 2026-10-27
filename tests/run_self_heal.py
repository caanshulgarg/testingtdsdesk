"""python3 run_self_heal.py - 27-Oct-2026 (the owner's BLANK page on Safari 26 right after the speed build; nothing in
Sentry: the page died before any script ran). FinCom never stays blank (index.html, fincom-heal; app/sw/sw.js):
  1. the upgrade path: a browser with the previous build's worker in charge (OLD, the published integ-link build,
     or TDSDESK_OLD) opens the new build, reloads, reloads again: FinCom drawn every time, and the new worker takes over
     only once a page of its build has drawn FinCom (never while the page is still loading; the browser is told to look
     for a new worker at once, as Safari does at every open);
  2. rolling back: the new build's worker meets the older build's files: drawn every time, the older build in the end;
  3. a broken build (its program empty, its first app file gone: the server answers with a page, as Pages does): the
     page clears FinCom's worker and caches, opens the last good build (last-good.json -> ../review-prev/, docs/NEVER-BLANK.md), says "FinCom
     updated; opened the last working version", and reports it by its own beacon;
  4. a page held up in its head (the styles never come through the worker): the same, within about 10 s;
  5. a broken build with no last-good.json: one clean reload from the network, then the "did not open" note, no loop.
Served as Cloudflare serves main (tests/cf_pages.py rules: /review/legacy.js immutable as on main since 2d196fd33; an
ETag from the content and no Last-Modified, as Workers static assets answer). Chromium only here.
  flock /tmp/fincom-app.lock python3 tests/run_self_heal.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, re, sys, json, time, shutil, tempfile, hashlib, threading, http.server, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cf_pages
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
OLD = os.environ.get("TDSDESK_OLD")          # a published older build (main's review/ of an earlier commit)
PORT = int(os.environ.get("HEAL_PORT") or 8394)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

RULES = cf_pages.parse("""
/*
  X-Content-Type-Options: nosniff
/review/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* http://localhost:* https://o4512221111320576.ingest.us.sentry.io; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
/review/assets/*
  Cache-Control: public, max-age=31536000, immutable
/review/
  Cache-Control: no-cache
/review/sw.js
  Cache-Control: no-cache
/review/build.json
  Cache-Control: no-cache
/review/legacy.js
  Cache-Control: public, max-age=31536000, immutable
/review/guard.js
  Cache-Control: no-cache
/review/oldcheck.js
  Cache-Control: no-cache
""")

TMP = tempfile.mkdtemp(prefix="fincom-heal-")
ROOT = os.path.join(TMP, "root"); os.makedirs(ROOT)
open(os.path.join(ROOT, "index.html"), "w").write("<!doctype html><title>staging</title><p>staging.fincom.live")
skip = shutil.ignore_patterns("*.map", "bridge-go", "connector", "mediapipe", "call-bg", "tess-*", "sample-*")
NEW = os.path.join(TMP, "new"); shutil.copytree(SITE, NEW, ignore=skip)
IDN = json.load(open(os.path.join(NEW, "build.json")))["build"]
def variant(name, tag):
    """the new build as another build: another id, other file names, another program address"""
    d = os.path.join(TMP, name); shutil.copytree(NEW, d)
    idv = IDN[:-3] + tag
    hn = re.search(r"legacy\.js\?v=([0-9a-f]{12})", open(os.path.join(NEW, "index.html")).read()).group(1)
    hv = hashlib.md5((hn + tag).encode()).hexdigest()[:12]
    ren = {f: re.sub(r"\.(js|css)$", tag[0].upper() + r".\1", f) for f in os.listdir(os.path.join(d, "assets")) if re.search(r"-[\w-]{8}\.(js|css)$", f)}
    for f, g in ren.items(): os.rename(os.path.join(d, "assets", f), os.path.join(d, "assets", g))
    for r, _x, fs in os.walk(d):
        for f in fs:
            if not re.search(r"\.(html|js|json)$", f): continue
            pth = os.path.join(r, f); t = open(pth, encoding="utf-8", errors="surrogateescape").read()
            u = t.replace(IDN, idv).replace("legacy.js?v=" + hn, "legacy.js?v=" + hv)
            for a in sorted(ren, key=len, reverse=True):
                if a in u: u = u.replace(a, ren[a])
            if u != t: open(pth, "w", encoding="utf-8", errors="surrogateescape").write(u)
    return d, idv
if OLD:
    OLDD = os.path.join(TMP, "old"); shutil.copytree(OLD, OLDD, ignore=skip); IDO = json.load(open(os.path.join(OLDD, "build.json")))["build"]
else:
    OLDD, IDO = variant("old", "ooo")
POINTER = json.dumps({"build": IDO, "path": "../review-prev/"})
open(os.path.join(NEW, "last-good.json"), "w").write(POINTER)
def broken(name, tag, pointer):
    """the new build broken as a release can be: its program empty, its app's first file missing"""
    d, _i = variant(name, tag)
    open(os.path.join(d, "legacy.js"), "w").write("")
    for f in os.listdir(os.path.join(d, "assets")):
        if re.match(r"index-[\w-]+\.js$", f): os.remove(os.path.join(d, "assets", f))
    if pointer: open(os.path.join(d, "last-good.json"), "w").write(POINTER)
    elif os.path.exists(os.path.join(d, "last-good.json")): os.remove(os.path.join(d, "last-good.json"))
    return d
BROKEN, BROKEN_NOPTR = broken("broken", "bbb", True), broken("broken-noptr", "nnn", False)

class Folders(dict):
    """review/ and review-prev/ of the site: links to the builds, switched as a publish switches them"""
    def __setitem__(self, k, v):
        super().__setitem__(k, v); link = os.path.join(ROOT, k); tmp = link + ".new"
        if os.path.lexists(tmp): os.remove(tmp)
        os.symlink(v, tmp); os.replace(tmp, link)
MAP = Folders(); MAP["review"] = NEW; MAP["review-prev"] = OLDD
HOLD = {"css": False}
seen = []
class H(cf_pages.PagesHandler):
    rules = RULES
    def send_head(self):
        seen.append(self.path)
        # Workers static assets: an ETag, no Last-Modified (git archive's file times would make an older build's file
        # look "not modified" to a browser holding a newer one)
        if "If-Modified-Since" in self.headers: del self.headers["If-Modified-Since"]
        if HOLD["css"] and re.search(r"/review/assets/index-[\w-]+\.css", self.path): time.sleep(40); return None
        f = self.translate_path(urllib.parse.urlsplit(self.path).path)
        if os.path.isfile(f):
            tag = '"' + hashlib.md5(open(f, "rb").read()).hexdigest()[:16] + '"'
            if self.headers.get("If-None-Match") == tag:
                self.send_response(304); self.send_header("ETag", tag); self._cf_path = urllib.parse.urlsplit(self.path).path; self.end_headers(); return None
            self._etag = tag
        return super().send_head()
    def send_header(self, k, v):
        if k.lower() == "last-modified": return
        return super().send_header(k, v)
    def end_headers(self):
        if getattr(self, "_etag", None): super().send_header("ETag", self._etag); self._etag = None
        super().end_headers()
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); srv.daemon_threads = True; srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/review/" % PORT

INIT = """try{localStorage.setItem('fincom.sw','on');localStorage.setItem('fincom.report','on');if(!localStorage.getItem('tdsdesk-test:cloud'))localStorage.setItem('tdsdesk-test:cloud',JSON.stringify({gate:false}))}catch(e){}
// Safari looks for a new worker at every open, at once (Chromium waits until the page is idle)
try{navigator.serviceWorker.getRegistration().then(function(r){if(r)r.update().catch(function(){})})}catch(e){}
window.__zz={};try{navigator.serviceWorker.addEventListener('controllerchange',function(){__zz.cc=Math.round(performance.now())})}catch(e){}
try{new MutationObserver(function(){if(!__zz.drawn&&document.querySelector('#app .react-host'))__zz.drawn=Math.round(performance.now());var d=document.querySelector('[data-heal-line]');if(d&&d.textContent){var o=sessionStorage.getItem('zz-said')||'';if(o.indexOf(d.textContent)<0)sessionStorage.setItem('zz-said',o+'|'+d.textContent)}}).observe(document,{childList:true,subtree:true,characterData:true})}catch(e){}
document.addEventListener('DOMContentLoaded',function(){try{var t=(document.getElementById('fincom-boot')||{}).textContent||'';sessionStorage.setItem('zz-docs',(sessionStorage.getItem('zz-docs')||'')+' '+location.pathname.split('/')[1]+':'+(t.indexOf(%r)>=0?'new':t.indexOf(%r)>=0?'old':'?'))}catch(e){}})""" % (IDN, IDO)
def drawn(pg, ms):
    try: pg.wait_for_function("() => !!document.querySelector('#app .react-host')", timeout=ms); return True
    except Exception: return False
def build_of(pg):
    try: t = pg.evaluate("() => (document.getElementById('fincom-boot') || {}).textContent || ''")
    except Exception: return "?"
    return "new" if IDN in t else "old" if IDO in t else "?"
def ev(pg, js, dflt=None):
    try: return pg.evaluate(js)
    except Exception: return dflt
def shells(pg): return ev(pg, "caches.keys().then((k) => k.filter((x) => x.startsWith('fincom-shell:/review/')).map((x) => x.split(':').pop()))", [])
def regs(pg): return ev(pg, "navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => new URL(x.scope).pathname))", [])

def browser_on(ctx, which):
    """a browser that has opened `which` before: its worker in charge, its files kept"""
    MAP["review"] = which
    pg = ctx.new_page(); pg.goto(URL); drawn(pg, 30000)
    pg.evaluate("() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))])")
    pg.wait_for_timeout(1500); pg.reload(); drawn(pg, 30000); pg.wait_for_timeout(5000)
    return pg

with sync_playwright() as p:
    br = p.chromium.launch()
    def ctx_new():
        c = br.new_context(viewport={"width": 1280, "height": 760}); c.add_init_script(INIT)
        c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=401, body="{}"))
        return c
    try:
        print("1. upgrade: the previous build's worker in charge, the new build published; open, reload, reload")
        ctx = ctx_new(); pg = browser_on(ctx, OLDD)
        ok(build_of(pg) == "old" and shells(pg) == [IDO], "the previous build open, its worker in charge (%s, %s)" % (build_of(pg), shells(pg)))
        MAP["review"] = NEW
        for i in range(3):
            pg.evaluate("window.__zz = {}") if False else None
            try: pg.reload(wait_until="commit")
            except Exception: pass
            good = drawn(pg, 20000); pg.wait_for_timeout(3000)
            z = ev(pg, "window.__zz", {}) or {}
            ok(good and build_of(pg) == "new", "open %d: FinCom drawn on the new build (%s)" % (i + 1, build_of(pg)))
            if z.get("cc") is not None:
                ok(z.get("drawn") is not None and z["cc"] >= z["drawn"], "open %d: the new worker took over after FinCom was drawn (drawn %s ms, worker %s ms)" % (i + 1, z.get("drawn"), z.get("cc")))
        ok(shells(pg) == [IDN], "the new build's worker in charge in the end (%s)" % shells(pg))
        ok(not ev(pg, "!!document.querySelector('[data-heal-line], [data-boot-stuck]')"), "no healing and no note on the way")
        print("2. rolling back: the new build's worker meets the older build's files; open, reload, reload")
        MAP["review"] = OLDD
        for i in range(3):
            try: pg.reload(wait_until="commit")
            except Exception: pass
            good = drawn(pg, 20000); pg.wait_for_timeout(3000)
            ok(good, "open %d: FinCom drawn (%s)" % (i + 1, build_of(pg)))
        ok(build_of(pg) == "old", "the older build in the end (%s; documents %s)" % (build_of(pg), ev(pg, "sessionStorage.getItem('zz-docs')")))
        ctx.close()

        def healed(label, broken_dir, hold_css=False, expect_prev=True):
            ctx = ctx_new(); sent = []
            ctx.route("**/*.sentry.io/**", lambda r: (sent.append(r.request.post_data or ""), r.fulfill(status=200, body="{}")))
            pg = browser_on(ctx, NEW)
            MAP["review"] = broken_dir; HOLD["css"] = hold_css
            if hold_css:   # the kept styles gone too (the worker's and the browser's): the page's request goes to the line through the worker
                cdp = ctx.new_cdp_session(pg); cdp.send("Network.clearBrowserCache")
                pg.evaluate("caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys().then((rs) => Promise.all(rs.filter((r) => /index-[\\w-]+\\.css/.test(r.url)).map((r) => c.delete(r))))))))")
            loads = []
            pg.on("request", lambda r: loads.append(r.url) if r.is_navigation_request() and r.frame == pg.main_frame else None)
            t0 = time.time()
            try: pg.reload(wait_until="commit")
            except Exception: pass
            good = False
            while time.time() - t0 < 25 and not good:
                good = "/review-prev/" in pg.url and drawn(pg, 500)
                if not expect_prev and ev(pg, "!!document.querySelector('[data-boot-stuck]')"): break
                pg.wait_for_timeout(250)
            secs = round(time.time() - t0, 1)
            return ctx, pg, good, secs, sent, loads

        print("3. a broken build (empty program, first app file gone): the last good build opens")
        ctx, pg, good, secs, sent, loads = healed("broken", BROKEN)
        ok(good and build_of(pg) == "old", "the last good build (review-prev/) drawn in %s s (%s, %s)" % (secs, pg.url, build_of(pg)))
        said = ev(pg, "(sessionStorage.getItem('zz-said') || '') + '|' + ((document.querySelector('[data-heal-line]') || {}).textContent || '')", "")
        if 'id="fincom-heal"' in open(os.path.join(OLDD, "index.html")).read():
            ok("FinCom updated; opened the last working version" in said, "it says \"FinCom updated; opened the last working version\" (%s)" % said)
        else:   # a last good build from before 27-Oct-2026 has no line of its own: the note waits for the next build
            ok("FinCom is refreshing its files" in said, "it said \"FinCom is refreshing its files…\" on the way (%s; the older build shows no line of its own)" % said)
        ok("/review/" not in regs(pg), "the broken build's worker unregistered (%s)" % regs(pg))
        ok(not shells(pg), "its caches cleared (%s)" % shells(pg))
        ok(any("healed itself" in s for s in sent), "reported by the page's own beacon (%d sent: %s)" % (len(sent), [s[:80] for s in sent]))
        ctx.close()

        print("4. a page held up in its head (the styles never come through the worker): the last good build")
        ctx, pg, good, secs, sent, loads = healed("held", NEW, hold_css=True)
        ok(good and secs <= 15, "the last good build drawn in %s s (%s)" % (secs, pg.url))
        ok(any("page held up" in s for s in sent), "reported as \"page held up\" (%s)" % [s[:70] for s in sent])
        HOLD["css"] = False; ctx.close()

        print("5. a broken build and no last-good.json: one clean reload, then the note; no loop")
        ctx, pg, good, secs, sent, loads = healed("noptr", BROKEN_NOPTR, expect_prev=False)
        pg.wait_for_timeout(6000)
        stuck = ev(pg, "(document.querySelector('[data-boot-stuck]') || {}).innerText || ''", "")
        ok("FinCom did not open" in stuck, "the note comes (%r)" % stuck[:40])
        ok(len(loads) == 2, "one clean reload by itself (%d loads)" % len(loads))
        ok("/review/" not in regs(pg), "the worker unregistered (%s)" % regs(pg))
        ctx.close()
    finally:
        br.close(); srv.shutdown(); shutil.rmtree(TMP, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
