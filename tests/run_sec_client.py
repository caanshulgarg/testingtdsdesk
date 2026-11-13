"""python3 run_sec_client.py - the web app's hardening of 13-Nov-2026 (branch next-sec-client), each point in the page:

  1. the database address: every build is tied to its own Supabase project (CLOUD_DEFAULT lock, live and test): an address
     or key kept in this browser's storage is never used, and a sign-in kept with another address is forgotten. The page's
     Content-Security-Policy (the <meta> of each build, and cloudflare/_headers.main) names that project's address only,
     never *.supabase.co; the browser refuses a request to any other project.
  2. the headers (cloudflare/_headers.main, as Cloudflare applies them: tests/cf_pages.py): the files under assets/ and the
     remote-help page of review/, next/ and review-prev/ get the policy with no inline script; at most 100 rules.
  3. an element of the page named "claude" (<img name="claude">, <form name="claude">) is not claude.ai: the sign-in page
     stays, and the bridge is not switched off.
  4. the confirm box (askConfirm): body is plain words, shown as typed; only html is read as HTML; no caller in the sources
     passes markup as body.
  5. signing out forgets this browser's bridge key: the bridge is told (POST /forget, with the key) and the key leaves the
     browser's storage; a bridge without /forget, and no bridge at all, the key leaves all the same; another tab's sign-out
     heard here sends nothing.
  6. a zip opens to at most its allowance (200 MB, 2,000 files, a zip inside a zip): one that opens to more than its list
     states is stopped while it is read; one that states too much is not opened; a zip in a zip in a zip, and too many
     files, are refused in plain words; TRACES' own shape (a zip holding a zip) still opens.
  7. "FinCom did not open" (public/oldcheck.js) reports no word of data: of the first error only known words, of the
     address's # part only its kind (never a pairing code).
  8. "Log in to GST portal" (migration 192): when the server asks for the two-step code the page asks the person, checks
     the code with the server and reads once more; no code, no second read.
Run on the React build (app/dist-test, or TDSDESK_SITE) and the single-file builds (site/, site-test/)."""
import os, re, sys, io, json, glob, hmac, zlib, base64, hashlib, zipfile, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
REPO = os.path.dirname(HERE)
import cf_pages
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(REPO, "app", "dist-test"))
PORT = int(os.environ.get("SEC_PORT") or 8419)
STAGING, LIVE = "qbocskaiewaxqcvaunzc.supabase.co", "nrtczucrlgalvtojwoes.supabase.co"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def read(*p):
    f = os.path.join(*p)
    return open(f, encoding="utf8").read() if os.path.exists(f) else ""
def meta_csp(html): return (re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', html) or ["", ""])[1]
def connect(csp): return (re.search(r"connect-src ([^;]*)", csp) or ["", ""])[1].split()

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
def serve(port, d):
    s = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=d)); threading.Thread(target=s.serve_forever, daemon=True).start()
serve(PORT, SITE); serve(PORT + 1, REPO)
URL = "http://localhost:%d/" % PORT

print("1. the database address")
live_js, test_js = read(REPO, "app", "legacy", "live.js"), read(REPO, "app", "legacy", "test.js")
ok(re.search(r'const CLOUD_DEFAULT = \{url: "https://%s"[^}]*lock: true\}' % re.escape(LIVE), live_js) is not None, "the live program is tied to the live project (lock: true)")
ok(re.search(r'const CLOUD_DEFAULT = \{url: "https://%s"[^}]*lock: true\}' % re.escape(STAGING), test_js) is not None and LIVE not in test_js, "the test program is tied to the staging project and never names the live one")
for name, html, host in [("the React test build", read(SITE, "index.html"), STAGING), ("the single-file live build (site/)", read(REPO, "site", "index.html"), LIVE), ("the single-file test build (site-test/)", read(REPO, "site-test", "index.html"), STAGING)]:
    c = connect(meta_csp(html))
    ok("https://" + host in c and "wss://" + host in c and not [x for x in c if "supabase" in x and host not in x], "%s: its <meta> policy names %s only (%s)" % (name, host, " ".join(x for x in c if "supabase" in x) or "none"))
for f in ["app/vite.config.js", "build.py", "cloudflare/_headers.main"]:
    ok("*.supabase.co" not in "\n".join(l for l in read(REPO, f).splitlines() if not l.lstrip().startswith(("#", "//"))), f + ": no *.supabase.co in a policy")

print("2. the headers, as Cloudflare applies them")
htext = read(REPO, "cloudflare", "_headers.main"); rules = cf_pages.parse(htext)
def hcsp(path): return dict(cf_pages.headers_for(rules, path)).get("Content-Security-Policy", "")
ok(len(rules) <= 100 and max(len(l) for l in htext.splitlines()) <= 2000, "%d rules (at most 100), no line over 2,000 characters" % len(rules))
for p in ["review", "next", "review-prev"]:
    page, others = hcsp("/%s/" % p), [hcsp("/%s/%s" % (p, x)) for x in ["assets/x.html", "assets/index-abc.js", "assets/pdf.worker.min.mjs", "remote-help", "remote-help.html"]]
    sup = [x for x in connect(page) if "supabase" in x]
    ok(sup == ["https://" + STAGING, "wss://" + STAGING], "/%s/: the page's header names the staging project only (%s)" % (p, " ".join(sup)))
    ok(all(o and "'unsafe-inline'" not in (re.search(r"script-src ([^;]*)", o) or ["", "x 'unsafe-inline'"])[1] and "script-src 'self' 'wasm-unsafe-eval'" in o and "frame-ancestors 'none'" in o and o.count("default-src") == 1 for o in others),
       "/%s/: files under assets/ and the remote-help page: no inline script, one policy" % p)
    ok(dict(cf_pages.headers_for(rules, "/%s/assets/index-abc.js" % p)).get("Cache-Control") == "public, max-age=31536000, immutable", "/%s/assets/: cached as before" % p)

GATE = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? r(signInNeeded()) : setTimeout(go, 50); go(); })"
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(); errors = []
    asked = []     # every request to a Supabase address
    def supa(route):
        asked.append(route.request.url); route.fulfill(status=401, content_type="application/json", body="{}")
    ctx.route(re.compile(r"^https://[a-z0-9-]+\.supabase\.co/"), supa)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1500); pg.evaluate(GATE)
    pg.evaluate("""(evil) => { localStorage.setItem('tdsdesk-test:cloud', JSON.stringify({url: evil, key: 'sb_publishable_other', email: 'a@b.in', gate: true}));
      localStorage.setItem('tdsdesk-test:cloudsess', JSON.stringify({access_token: 'kept-for-another-address', refresh_token: 'r'})); }""", "https://abcdefghijklmnopqrst.supabase.co")
    pg.reload(); pg.wait_for_timeout(1500); pg.evaluate(GATE)
    c = pg.evaluate("Cloud.cfg()")
    ok(c["url"] == "https://" + STAGING and c["key"].startswith("sb_publishable_Q--") and c.get("email") == "a@b.in", "another project's address kept in this browser is not used (%s); the email is kept" % c["url"])
    ok(pg.evaluate("localStorage.getItem('tdsdesk-test:cloudsess')") is None and "abcdefghijklmnopqrst" not in pg.evaluate("localStorage.getItem('tdsdesk-test:cloud')"), "... it is forgotten, with the sign-in kept for it")
    pg.evaluate("(u) => localStorage.setItem('tdsdesk-test:cloud', JSON.stringify({url: u, key: 'sb_publishable_other', auto: false, lock: false}))", "https://" + STAGING)
    c = pg.evaluate("Cloud.cfg()")
    ok(c["key"].startswith("sb_publishable_Q--") and c["url"] == "https://" + STAGING, "a key kept in this browser's storage is not used either: the build's own")
    blocked = pg.evaluate("""async ([other, own]) => { const seen = []; document.addEventListener('securitypolicyviolation', (e) => seen.push(e.effectiveDirective + ' ' + e.blockedURI));
      const t = async (u) => { try { await fetch(u); return 'sent'; } catch (e) { return 'refused'; } };
      const a = await t(other + '/auth/v1/token'), b = await t(own + '/auth/v1/health'); await new Promise((r) => setTimeout(r, 200)); return {other: a, own: b, seen}; }""",
      ["https://abcdefghijklmnopqrst.supabase.co", "https://" + STAGING])
    ok(blocked["other"] == "refused" and any("connect-src" in s and "abcdefghijklmnopqrst" in s for s in blocked["seen"]) and not [u for u in asked if "abcdefghijklmnopqrst" in u],
       "the browser refuses a request to another Supabase project (connect-src); nothing is sent (%s)" % blocked["seen"][:1])
    ok(blocked["own"] == "sent" and any(STAGING in u for u in asked), "a request to the build's own project goes out")
    # the live single-file build
    lv = ctx.new_page(); lv.goto("http://localhost:%d/site/index.html" % (PORT + 1)); lv.wait_for_timeout(1500)
    lv.evaluate("(evil) => { localStorage.setItem('tdsdesk:cloud', JSON.stringify({url: evil, key: 'k', email: 'a@b.in'})); localStorage.setItem('tdsdesk:cloudsess', JSON.stringify({access_token: 'x'})); }", "https://abcdefghijklmnopqrst.supabase.co")
    lv.reload(); lv.wait_for_timeout(1500)
    c = lv.evaluate("Cloud.cfg()")
    ok(c["url"] == "https://" + LIVE and c["key"].startswith("sb_publishable_HMk") and lv.evaluate("!!CLOUD_DEFAULT.lock && localStorage.getItem('tdsdesk:cloudsess') === null"), "the live build too: tied to the live project, another address and its sign-in forgotten (%s)" % c["url"])
    lv.close()

    print("3. an element named \"claude\" is not claude.ai")
    pg.evaluate("() => { localStorage.removeItem('tdsdesk-test:cloud'); localStorage.removeItem('tdsdesk-test:cloudsess'); }")
    pg.reload(); pg.wait_for_timeout(1500)
    before = pg.evaluate(GATE)
    for what, html in [('<img name="claude">', '<img name="claude" alt="">'), ('<form name="claude"> holding inputs named use and complete', '<form name="claude"><input name="use"><input name="complete"></form>'), ('<a id="claude">', '<a id="claude" href="#x"></a>')]:
        r = pg.evaluate("""(html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d);
          const o = {named: !!window.claude, gate: signInNeeded(), blocked: Bridge.blocked()}; d.remove(); return o; }""", html)
        ok(before is True and r["named"] and r["gate"] is True and r["blocked"] is False, "%s: the sign-in page stays and the bridge is not switched off (%s)" % (what, r))
    r = pg.evaluate("() => { window.claude = {complete: async () => ''}; const o = {gate: signInNeeded(), blocked: Bridge.blocked()}; delete window.claude; return o; }")
    ok(r == {"gate": False, "blocked": True}, "claude.ai's own object (with its functions) is still known (%s)" % r)

    print("4. the confirm box")
    pg.evaluate("() => { if (signInNeeded()) doAct('useOffline'); }"); pg.wait_for_timeout(600)
    r = pg.evaluate("""async () => { const p = askConfirm({title: 'T', body: 'Sharma & Sons <img name="claude" src="x"><b id="inj">bold</b>'}); await new Promise((r) => setTimeout(r, 100));
      const b = document.querySelector('#confirmBox .note'); const o = {text: b.textContent, img: !!b.querySelector('img, b'), named: !!window.claude};
      document.querySelector('#confirmBox [data-cbx="no"]').click(); await p; return o; }""")
    ok(r == {"text": 'Sharma & Sons <img name="claude" src="x"><b id="inj">bold</b>', "img": False, "named": False}, "body is shown as typed, never read as HTML (%s)" % r)
    r = pg.evaluate("""async () => { const p = askConfirm({title: 'T', html: 'Remove <b id="okb">' + esc('A <i>B</i>') + '</b>?'}); await new Promise((r) => setTimeout(r, 100));
      const b = document.querySelector('#confirmBox .note'); const o = {bold: (b.querySelector('#okb') || {}).textContent, i: !!b.querySelector('i')};
      document.querySelector('#confirmBox [data-cbx="no"]').click(); await p; return o; }""")
    ok(r == {"bold": "A <i>B</i>", "i": False}, "html is the caller's own markup, its values escaped by the caller (%s)" % r)
    srcs = glob.glob(os.path.join(REPO, "src", "js", "*.js")) + glob.glob(os.path.join(REPO, "app", "src", "**", "*.js*"), recursive=True)
    bad = []
    for f in srcs:
        t = open(f, encoding="utf8").read()
        for m in re.finditer(r"\b(?:askConfirm|confirmTyped)\(\{", t):
            seg = t[m.start():m.start() + 4000]; depth = 0; end = len(seg)
            for i, ch in enumerate(seg):
                if ch == "(": depth += 1
                elif ch == ")":
                    depth -= 1
                    if not depth: end = i; break
            b = re.search(r"[{,]\s*body\s*(?::\s*([^,}]*)|[,}])", seg[:end])
            if b and (b.group(1) is None or "<" in (b.group(1) or "") or not re.match(r"""^\s*["'`]""", b.group(1) or "")): bad.append(os.path.relpath(f, REPO) + ": " + seg[:60].replace("\n", " "))
    ok(not bad, "no caller in src/js or app/src passes markup (or a value built elsewhere) as body (%s)" % "; ".join(bad[:4]))

    print("5. signing out forgets this browser's bridge key")
    KEY, BID = "k" * 40, "bridge-test-1"
    seen = {"forget": [], "ping": 0}
    def make_bridge(mode):
        def bridge(route):
            req = route.request; u = req.url; path = re.sub(r"^http://[^/]+", "", u).split("?")[0]; port = int(re.search(r":(\d+)/", u).group(1))
            cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Private-Network": "true"}
            if mode == "down" or port != 9100: return route.abort()
            if req.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
            if path == "/ping":
                n = (re.search(r"[?&]n=([0-9a-f]+)", u) or ["", ""])[1]; seen["ping"] += 1
                return route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps({"ok": True, "version": "2.5.15", "bridgeId": BID, "port": 9100, "yours": True,
                    "proof": hmac.new(KEY.encode(), (n + BID + "9100").encode(), hashlib.sha256).hexdigest()}))
            if path == "/forget" and mode == "new":
                seen["forget"].append((req.method, req.headers.get("x-bridge-key")))
                return route.fulfill(status=200, headers=cors, content_type="application/json", body='{"ok":true}')
            if path == "/forget": seen["forget"].append(("old", req.headers.get("x-bridge-key")))
            return route.fulfill(status=404, headers=cors, content_type="application/json", body='{"ok":false,"error":"not found"}')
        return bridge
    PAIR = "([k, id]) => { Bridge.setCfg({key: k, bridgeId: id, url: 'http://127.0.0.1:9100', follow: false}); Bridge.proven = {}; window.render0 = window.render0 || 1; }"
    key_now = lambda: pg.evaluate("Bridge.cfg().key")
    def wait_gone(ms=6000):
        try: pg.wait_for_function("() => !Bridge.cfg().key", timeout=ms)
        except Exception: pass
        return key_now() == ""
    for mode, words in [("new", "a bridge with /forget (2.5.16)"), ("old", "a bridge without /forget"), ("down", "no bridge running")]:
        ctx.unroute(re.compile(r"^http://(127\.0\.0\.1|localhost):9\d\d\d/")); ctx.route(re.compile(r"^http://(127\.0\.0\.1|localhost):9\d\d\d/"), make_bridge(mode))
        seen["forget"].clear(); pg.evaluate(PAIR, [KEY, BID])
        had = key_now() == KEY
        pg.evaluate("() => { signOutHere('Signed out.', false); }")
        gone = wait_gone(); pg.wait_for_timeout(300)
        if mode == "new": ok(had and gone and seen["forget"] == [("POST", KEY)], "%s: told once (POST /forget with the key), and the key is out of this browser's storage (%s)" % (words, seen["forget"]))
        else: ok(had and gone and "kkkk" not in pg.evaluate("localStorage.getItem('tdsdesk-test:bridge') || ''"), "%s: the key is out of this browser's storage all the same" % words)
        pg.evaluate("() => { if (signInNeeded()) doAct('useOffline'); }"); pg.wait_for_timeout(300)
    ctx.unroute(re.compile(r"^http://(127\.0\.0\.1|localhost):9\d\d\d/")); ctx.route(re.compile(r"^http://(127\.0\.0\.1|localhost):9\d\d\d/"), make_bridge("new"))
    seen["forget"].clear(); pg.evaluate(PAIR, [KEY, BID])
    pg.evaluate("() => { signOutHere('Signed out in another tab.', false, '', true); }"); pg.wait_for_timeout(1200)
    ok(seen["forget"] == [], "another tab's sign-out heard here: this tab sends nothing (the tab that signed out did)")
    pg.evaluate("() => { Bridge.setCfg({key: ''}); if (signInNeeded()) doAct('useOffline'); }"); pg.wait_for_timeout(300)

    print("6. a zip opens to at most its allowance")
    chunk = lambda word: next((os.path.relpath(f, SITE).replace(os.sep, "/") for f in sorted(glob.glob(os.path.join(SITE, "assets", "*.js"))) if word in open(f, encoding="utf8").read()), "")
    def mkzip(files, method=zipfile.ZIP_DEFLATED):
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w", method) as z:
            for n, d in files: z.writestr(n, d)
        return b.getvalue()
    def lie(z, size=10):   # the zip's own list states `size` bytes for every file
        z = bytearray(z); i = z.find(b"PK\x01\x02")
        while i >= 0: z[i + 24:i + 28] = size.to_bytes(4, "little"); i = z.find(b"PK\x01\x02", i + 4)
        return bytes(z)
    trf = chunk("zip_big")
    ok(bool(trf), "the TDS screens' file carries the limit (%s)" % trf)
    pg.evaluate("(f) => import('/' + f)", trf); pg.wait_for_function("() => typeof TRF === 'object' && !!TRF.unzip", timeout=15000)
    ok(pg.evaluate("[TRF.ZIP_MAX, TRF.ZIP_FILES, TRF.ZIP_DEEP]") == [200 * 1024 * 1024, 2000, 2], "the allowance: 200 MB, 2,000 files, a zip inside a zip")
    UNZIP = """async ([b64, max, files]) => { const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const room = {left: max || TRF.ZIP_MAX, files: files || TRF.ZIP_FILES};
      const t0 = performance.now(); try { const o = await TRF.unzip(u, null, room); return {n: o.length, bytes: o.reduce((s, x) => s + x.data.length, 0), left: room.left, ms: Math.round(performance.now() - t0)}; }
      catch (e) { return {code: e && e.code, words: TRF.zipWords(e), ms: Math.round(performance.now() - t0)}; } }"""
    EXPAND = """async ([b64, name]) => { const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const f = new File([u], name, {type: 'application/zip'});
      try { const o = await TRF.expand(f); return {names: o.map((x) => x.name)}; } catch (e) { return {code: e && e.code, words: TRF.zipWords(e)}; } }"""
    b64 = lambda z: base64.b64encode(z).decode()
    small = mkzip([("a.txt", b"one"), ("b.txt", b"two" * 1000)])
    r = pg.evaluate(UNZIP, [b64(small), 0, 0])
    ok(r.get("n") == 2 and r.get("bytes") == 3003 and r.get("left") == 200 * 1024 * 1024 - 3003, "an ordinary zip opens as before, its bytes counted (%s)" % r)
    bomb = mkzip([("big.txt", b"\0" * (300 * 1024 * 1024))])
    r = pg.evaluate(UNZIP, [b64(bomb), 0, 0])
    ok(len(bomb) < 1024 * 1024 and r.get("code") == "zip_big" and "200 MB" in r.get("words", ""), "a %d KB zip that states 300 MB is not opened; said in plain words (%s)" % (len(bomb) // 1024, r.get("words", r)))
    r = pg.evaluate(UNZIP, [b64(lie(bomb)), 0, 0])
    ok(r.get("code") == "zip_big", "the same zip stating 10 bytes: stopped while it is read, at the allowance (%s, %s ms)" % (r.get("code"), r.get("ms")))
    r = pg.evaluate(UNZIP, [b64(lie(mkzip([("m.txt", os.urandom(2000) * 100)]))), 100000, 0])
    ok(r.get("code") == "zip_big", "a stream that gives more than what is left of the allowance is stopped (%s)" % r.get("code"))
    r = pg.evaluate(UNZIP, [b64(mkzip([("s.txt", b"x" * 5000)], zipfile.ZIP_STORED)), 4000, 0])
    ok(r.get("code") == "zip_big", "a file kept unpacked in the zip counts too (%s)" % r.get("code"))
    r = pg.evaluate(UNZIP, [b64(mkzip([("f%d.txt" % i, b"x") for i in range(6)])), 0, 5])
    ok(r.get("code") == "zip_big", "more files than the allowance: refused (%s)" % r.get("code"))
    inner = mkzip([("16A_AAAPA1234A.pdf", b"%PDF-1.4 one"), ("16A_BBBPB1234B.pdf", b"%PDF-1.4 two")])
    r = pg.evaluate(EXPAND, [b64(mkzip([("certs.zip", inner), ("note.txt", b"n")])), "traces.zip"])
    ok(r.get("names") == ["16A_AAAPA1234A.pdf", "16A_BBBPB1234B.pdf", "note.txt"], "TRACES' own shape, a zip holding a zip, opens (%s)" % r)
    r = pg.evaluate(EXPAND, [b64(mkzip([("l2.zip", mkzip([("l3.zip", inner)]))])), "deep.zip"])
    ok(r.get("code") == "zip_big" and "zip inside a zip" in r.get("words", ""), "a zip in a zip in a zip is refused (%s)" % r.get("code"))

    print("7. \"FinCom did not open\" reports no word of data")
    sent = []
    og = ctx.new_page()
    og.route("https://staging.fincom.live/review/", lambda r: r.fulfill(status=200, content_type="text/html", body='<!doctype html><html><body><div class="shell" data-boot-part></div><script src="./oldcheck.js" data-report="https://report.invalid/api/1/store/?sentry_key=k"></script></body></html>'))
    og.route("https://staging.fincom.live/review/oldcheck.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=read(SITE, "oldcheck.js")))
    og.goto("https://staging.fincom.live/review/#pair=482913"); og.wait_for_timeout(300)
    og.evaluate("() => { Promise.reject(new Error('Sharma Traders 07AAGCL4827M1Z3 bill 4471 of a@b.in could not be read: undefined is not an object')); }"); og.wait_for_timeout(300)
    # the report as the page sends it (a keepalive request: read here from the page's own fetch)
    og.evaluate("() => { window.__rep = []; window.fetch = (u, o) => { window.__rep.push([String(u), o && o.body]); return Promise.resolve(new Response('{}')); }; window.__fincomStuck(false); }"); og.wait_for_timeout(300)
    sent = [b for u, b in og.evaluate("window.__rep") if u.startswith("https://report.invalid/")]
    body = sent[0] if sent else ""
    j = json.loads(body) if body else {}
    ok(len(sent) == 1 and not re.search(r"482913|Sharma|Traders|07AAGCL|4471|a@b\.in", body), "one report, with no pairing code and none of the error's data (%s)" % j.get("message", "none sent")[:120])
    ok(((j.get("extra") or {}).get("where") or {}).get("hash") == "pair" and "undefined is not an object" in j.get("message", "") and j.get("message", "").startswith("FinCom did not open: promise:"), "it keeps what helps: the kind of address (pair) and the error's own words")
    kinds = og.evaluate("""(t) => { const i = t.indexOf('function hashKind'); const f = new Function(t.slice(i, t.indexOf('\\n', i)) + '; return hashKind;')();
      return ['#/client/cmufksrrqjub2g/books', '#join=abcDEF123', '#access_token=eyJhbGciOi', '', '#482913'].map(f); }""", read(SITE, "oldcheck.js"))
    ok(kinds == ["client", "join", "access_token", "", "other"], "the # part by its kind only: %s" % kinds)
    og.close()

    print("8. \"Log in to GST portal\" asks for the two-step code when the server asks")
    gb = chunk("gst_portal_login_read")
    pg.evaluate("(f) => import('/' + f)", gb); pg.wait_for_function("() => typeof GSTB === 'object' && !!GSTB.login", timeout=15000)
    STUB = """() => { window.__t = {rpc: [], auth: [], port: []}; const T = window.__t;
      GSTB.connect = () => true; GSTB.ext = true; GSTB.port = {postMessage: (m) => T.port.push(m)}; GSTB.gstinOf = () => '07AABCF1234K1Z5';
      localStorage.setItem('tdsdesk-test:cloudsess', JSON.stringify({access_token: 'old-token', refresh_token: 'r0'}));
      Cloud.rpc = async (fn, a) => { if (fn !== 'gst_portal_login_read') return null; T.rpc.push(fn); return Cloud.sess().access_token === 'fresh-token' ? {ok: true, gstin: a.p_gstin, username: 'fx_user', password: 'Fx#S3cret'} : {ok: false, need: 'two_step', error: 'Type your two-step code to use the saved GST portal login.'}; };
      Cloud.factors = async () => [{id: 'fac-1', status: 'verified', factor_type: 'totp'}];
      Cloud.authApi = async (path, method, body) => { T.auth.push([path, method, body && body.code]); if (/challenge$/.test(path)) return {id: 'ch-1'};
        if (body.code !== '123456') throw new Error('Invalid TOTP code entered'); return {access_token: 'fresh-token', refresh_token: 'r1', expires_in: 3600}; }; }"""
    pg.evaluate(STUB)
    pg.evaluate("() => { window.__done = GSTB.login('07'); }")
    pg.wait_for_selector("#gstbCode", timeout=5000)
    ok(pg.evaluate("window.__t.rpc.length") == 1 and pg.evaluate("window.__t.port.length") == 0, "the server asked for the code: the page asks the person, nothing is handed on yet")
    pg.fill("#gstbCode", "123 456"); pg.click('#confirmBox [data-cbx="yes"]'); pg.evaluate("() => window.__done"); pg.wait_for_timeout(200)
    t = pg.evaluate("window.__t")
    ok(t["auth"] == [["factors/fac-1/challenge", "POST", None], ["factors/fac-1/verify", "POST", "123456"]] and pg.evaluate("Cloud.sess().access_token") == "fresh-token", "the code is checked by the server and the sign-in kept here becomes the fresh one (%s)" % t["auth"])
    ok(t["rpc"] == ["gst_portal_login_read"] * 2 and len(t["port"]) == 1 and t["port"][0].get("type") == "login" and t["port"][0].get("password") == "Fx#S3cret", "then the login is read once more and handed to the helper")
    pg.evaluate(STUB); pg.evaluate("() => { window.__done = GSTB.login('07'); }"); pg.wait_for_selector("#gstbCode", timeout=5000)
    pg.click('#confirmBox [data-cbx="no"]'); pg.evaluate("() => window.__done"); pg.wait_for_timeout(200)
    t = pg.evaluate("window.__t")
    ok(len(t["rpc"]) == 1 and not t["auth"] and not t["port"] and "two-step code was not given" in pg.evaluate("GSTB.msg"), "no code given: nothing more is asked of the server, nothing handed on (%s)" % pg.evaluate("GSTB.msg"))
    pg.evaluate(STUB); pg.evaluate("() => { window.__done = GSTB.login('07'); }"); pg.wait_for_selector("#gstbCode", timeout=5000)
    pg.fill("#gstbCode", "000000"); pg.click('#confirmBox [data-cbx="yes"]'); pg.evaluate("() => window.__done"); pg.wait_for_timeout(200)
    t = pg.evaluate("window.__t")
    ok(len(t["rpc"]) == 1 and not t["port"] and "Invalid TOTP" in pg.evaluate("GSTB.msg"), "a wrong code: said, nothing read (%s)" % pg.evaluate("GSTB.msg"))
    bad_err = [e for e in errors if "supabase" not in e.lower() and "Failed to fetch" not in e]
    ok(not bad_err, "no page error (%s)" % "; ".join(bad_err)[:300])
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
