#!/usr/bin/env python3
"""
TDS Desk build: puts the source files together into the one-file app, for live and for test.

    python3 build.py                 # writes site/index.html (live) and site-test/index.html (test)
    python3 build.py --check FILE    # also checks the test build is byte-for-byte FILE (e.g. the deployed one)

The source is kept in its live form. The test build differs only in:
  - browser storage: tdsdesk:* -> tdsdesk-test:*, and the databases tdsdesk-bank / tdsdesk-work -> ...-test
  - the TEST mark: an orange top edge, a fixed orange bar, and "TEST" under the brand (build/test-style.html)
  - APP_VERSION starts with "TEST · "
  - it works on the staging database (tds-desk-staging), never on live
Nothing else may differ; the checks below stop the build if a rule is broken.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
def read(p): return open(os.path.join(ROOT, p), encoding="utf-8").read()
NAMES_JS = "server/_shared/names.js"
# plain JavaScript shared with the server functions, put at the head of the app without its export line, in this order
SHARED_JS = [NAMES_JS, "server/_shared/match2b.js", "server/_shared/tdsmatch.js", "server/_shared/tallyname.js"]
# of those, the ones the React app loads with a screen of its own (its lazy chunk imports the module itself and puts its
# names on globalThis: app/src/lib/tdsGlobals.js), kept out of legacy.js and its size budget (tests/run_stability.py)
SHARED_LAZY = ["server/_shared/tdsmatch.js"]

def assemble():
    shell = read("src/shell.html")
    order = json.load(open(os.path.join(ROOT, "src/js/ORDER.json")))
    missing = sorted(set(f for f in os.listdir(os.path.join(ROOT, "src/js")) if f.endswith(".js")) - set(order))
    if missing: sys.exit("These program files are not in src/js/ORDER.json: " + ", ".join(missing))
    # the one rule for Tally names (server/_shared/names.js), shared with the cloud reader: put first, without its
    # export line, so src/js/00-core.js and the rest call the same functions the cloud's parse.js imports
    # (server/_shared/match2b.js: the 2B matching rules, shared with the gst-2b-match function the same way)
    shared = []
    for f in SHARED_JS:
        t = read(f)
        if len(re.findall(r"(?m)^export \{[^}]*\};\s*$", t)) != 1: sys.exit(f + " must end with one export { ... }; line")
        t = re.sub(r"(?m)^export \{[^}]*\};\s*$", "", t)
        if re.search(r"(?m)^\s*(import|export)\b", t): sys.exit(f + " must have no imports and only its one export line")
        if f in SHARED_LAZY: t = "/* @react-lazy-shared: begin " + f + " */\n" + t + "/* @react-lazy-shared: end */\n"
        shared.append((f, t))
    srcs = shared + [("src/js/" + f, read("src/js/" + f)) for f in order]
    js = "".join(t for _, t in srcs)
    # every file shares one scope: a second top-level function or const with the same name silently replaces the first
    # (two tallyDate()s once emptied every date sent to Tally), so a clash stops the build
    seen, clash = {}, []
    for f, text in srcs:
        for i, line in enumerate(text.split("\n"), 1):
            m = re.match(r"(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)\b", line)
            if not m: continue
            n = m.group(1) or m.group(2)
            if n in seen: clash.append(n + " in " + f + ":" + str(i) + " and " + seen[n])
            else: seen[n] = f + ":" + str(i)
    if clash: sys.exit("The same name is defined twice at the top level:\n  " + "\n  ".join(clash))
    sha = read("assets/bridge-setup.sha256").split()[0][:16]
    if js.count("{{BRIDGE_SETUP_SHA}}") != 1: sys.exit("BRIDGE_SETUP_SHA placeholder missing in src/js")
    js = js.replace("{{BRIDGE_SETUP_SHA}}", sha)
    css = read("src/css/app.css")
    if shell.count("{{CSS}}") != 1 or shell.count("{{JS}}") != 1: sys.exit("src/shell.html must have {{CSS}} and {{JS}} once each")
    return shell.replace("{{CSS}}", css).replace("{{JS}}", js)

def live_checks(html):
    bad = [k for k in ["tdsdesk-test:", "tdsdesk-bank-test", "tdsdesk-work-test", "is-test", 'APP_VERSION = "TEST'] if k in html]
    if bad: sys.exit("The source must stay in its live form; found: " + ", ".join(bad))
    if not re.search(r'const APP_VERSION = "[^"]+";', html): sys.exit("APP_VERSION not found")

def to_test(html):
    # the testing builds hand out the staging bridge Setup (assets/bridge-setup-test.txt); live keeps assets/bridge-setup.txt
    live_sha, test_sha = read("assets/bridge-setup.sha256").split()[0][:16], read("assets/bridge-setup-test.sha256").split()[0][:16]
    for a, b in [('const BRIDGE_SETUP_ID = "bridge-setup";', 'const BRIDGE_SETUP_ID = "bridge-setup-test";'), ('const BRIDGE_SETUP_SHA = "' + live_sha + '";', 'const BRIDGE_SETUP_SHA = "' + test_sha + '";')]:
        if html.count(a) != 1: sys.exit("to_test: expected once: " + a)
        html = html.replace(a, b)
    t = html.replace("tdsdesk:", "tdsdesk-test:").replace('"tdsdesk-bank"', '"tdsdesk-bank-test"').replace('"tdsdesk-work"', '"tdsdesk-work-test"')
    if "tdsdesk-bank-test" not in t or "tdsdesk-work-test" not in t:
        t = re.sub(r"tdsdesk-(bank|work)(?!-test)", r"tdsdesk-\1-test", t)
    style = read("build/test-style.html")
    i = t.find("</head>")
    t = t[:i] + style + t[i:]
    t = t.replace("<body>", '<body class="is-test">', 1)
    t = re.sub(r'(const APP_VERSION = ")', "\\1TEST \u00b7 ", t, 1)
    # the test site works on the staging database, never on live
    live = 'const CLOUD_DEFAULT = {url: "https://nrtczucrlgalvtojwoes.supabase.co", key: "sb_publishable_HMkVf1jl9iOA8Xt4YaUezg_--4cIWVR", auto: true};'
    if live not in t: sys.exit("CLOUD_DEFAULT (live) not found; the test build must not fall back to the live database")
    t = t.replace(live, 'const CLOUD_DEFAULT = {url: "https://qbocskaiewaxqcvaunzc.supabase.co", key: "sb_publishable_Q--gLdP6P-hU3gJDMHuKEA_fLTMJAxd", auto: true, lock: true};')
    if "nrtczucrlgalvtojwoes" in t: sys.exit("the test build still names the live database")
    return t

# Content Security Policy, as a meta tag (GitHub Pages cannot send headers; _headers carries the same for hosts that can).
# Only this site's own scripts run: each inline script is allowed by its SHA-256 hash, computed here after all other changes.
CSP = ("default-src 'self'; script-src 'self' {hashes} 'wasm-unsafe-eval'; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; media-src 'self' data: blob:; "
       "connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* http://localhost:*; "
       "worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'")
def assemble_js_only(html):
    return "".join(m.group(1) for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S))
def csp_policy(html):
    import hashlib, base64
    hashes = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S):
        h = "'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode() + "'"
        if h not in hashes: hashes.append(h)
    return CSP.format(hashes=" ".join(hashes))
def add_csp(html):
    # With a CSP meta tag Chrome's preload scanner reads "<img ... src=" inside the inline script and fetches junk
    # addresses, so the program writes "<" + "img" instead; stop the build if one slips back in.
    if re.search(r"<img\b", assemble_js_only(html)): sys.exit("write '<' + 'img' in program strings, not a literal <img (see add_csp)")
    if 'http-equiv="Content-Security-Policy"' in html: sys.exit("src/shell.html must not carry its own CSP; build.py adds it")
    # at the end of <head>: placed first, Chrome's preload scanner misreads the big inline script and fetches junk URLs
    meta = '<meta http-equiv="Content-Security-Policy" content="' + csp_policy(html) + '">\n'
    i = html.index('<meta charset="utf-8">') + len('<meta charset="utf-8">\n')
    html = html[:i] + '<meta name="referrer" content="no-referrer">\n' + html[i:]
    j = html.index("</head>")
    return html[:j] + meta + html[j:]

def lazy_files():
    """The src/js files kept out of legacy.js (marked @react-lazy at their head): each must be imported by a screen in
    app/src, or the React app would never have its names."""
    import glob
    lazy = sorted(f for f in os.listdir(os.path.join(ROOT, "src/js")) if f.endswith(".js") and read("src/js/" + f).startswith("/* @react-lazy: begin "))
    app = "".join(open(p, encoding="utf-8").read() for p in glob.glob(os.path.join(ROOT, "app", "src", "**", "*.js*"), recursive=True))
    for f in lazy:
        if not re.search(r"""import\s*(?:\(\s*)?["'][./]*/src/js/""" + re.escape(f) + """["']""", app): sys.exit("src/js/" + f + " is @react-lazy but no screen in app/src imports it")
        t = read("src/js/" + f)
        if t.count("/* @react-lazy: begin ") != 1 or not t.rstrip().endswith("/* @react-lazy: end */"): sys.exit("src/js/" + f + ": one @react-lazy block, the whole file")
    return lazy

def react_parts():
    """The program and CSS for the React app in app/: live and test, the same rules as the one-file site."""
    html = assemble(); live_checks(html)
    lazy = lazy_files()
    out = os.path.join(ROOT, "app", "legacy"); os.makedirs(out, exist_ok=True)
    for name, h in [("live", html), ("test", to_test(html))]:
        js = re.search(r'<script id="app-main">(.*?)</script>', h, re.S).group(1)
        # a module the React app loads with its own screen (its lazy chunk), kept out of legacy.js and its size budget
        # (tests/run_stability.py): each src/js file marked @react-lazy, imported by the screens that use it and setting
        # its names on globalThis (78-reports.js FSX and 80-assets.js FAR with Statements.jsx; the rest: lazy_files())
        js, n = re.subn(r"/\* @react-lazy: begin .*?/\* @react-lazy: end \*/\n?", "", js, flags=re.S)
        if n != len(lazy): sys.exit("expected %d @react-lazy blocks (%s), found %d" % (len(lazy), ", ".join(lazy), n))
        js, n = re.subn(r"/\* @react-lazy-shared: begin .*?/\* @react-lazy-shared: end \*/\n?", "", js, flags=re.S)
        if n != len(SHARED_LAZY): sys.exit("expected %d @react-lazy-shared blocks, found %d" % (len(SHARED_LAZY), n))
        open(os.path.join(out, name + ".js"), "w", encoding="utf-8").write(js)
    open(os.path.join(out, "app.css"), "w", encoding="utf-8").write(read("src/css/app.css"))
    open(os.path.join(out, "test-style.html"), "w", encoding="utf-8").write(read("build/test-style.html"))
    import shutil
    shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(ROOT, "app", "public", "assets"), dirs_exist_ok=True)
    drop_retired(os.path.join(ROOT, "app", "public", "assets"))
    print("app/legacy: live.js, test.js, app.css; app/public/assets")

# FinCom Bridge 2.4.5 (ROUND 102): the old PowerShell bridge (TDSBridge.ps1, 1.15.0) is retired: it is not shipped with any
# build (the review site, the React build, site/ and site-test/). Its source stays in bridge/ and assets/connector/ for history
RETIRED = [os.path.join("connector", "TDSBridge.ps1")]
def drop_retired(assets_dir):
    for r in RETIRED:
        f = os.path.join(assets_dir, r)
        if os.path.exists(f): os.remove(f)

def main():
    if "--react" in sys.argv: return react_parts()
    html = assemble()
    live_checks(html)
    test = add_csp(to_test(html))
    html = add_csp(html)
    import shutil
    for d, h in [("site", html), ("site-test", test)]:
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)
        open(os.path.join(ROOT, d, "index.html"), "w", encoding="utf-8").write(h)
        # the libraries and the bridge setup the page loads from assets/
        shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(ROOT, d, "assets"), dirs_exist_ok=True)
        drop_retired(os.path.join(ROOT, d, "assets"))
    print("site/index.html       %8d bytes (live)" % len(html.encode("utf-8")))
    print("site-test/index.html  %8d bytes (test)" % len(test.encode("utf-8")))
    if "--check" in sys.argv:
        ref = open(sys.argv[sys.argv.index("--check") + 1], encoding="utf-8").read()
        if ref != test:
            k = next((i for i, (a, b) in enumerate(zip(ref, test)) if a != b), min(len(ref), len(test)))
            sys.exit("The test build differs from %s at character %d:\n  expected %r\n  built    %r" % (sys.argv[sys.argv.index("--check") + 1], k, ref[k-60:k+60], test[k-60:k+60]))
        print("test build is identical to", sys.argv[sys.argv.index("--check") + 1])

if __name__ == "__main__":
    main()
