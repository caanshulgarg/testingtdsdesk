#!/usr/bin/env python3
"""
TDS Desk build: puts the source files together into the one-file app, for live and for test.

    python3 build.py                 # writes site/index.html (live) and site-test/index.html (test)
    python3 build.py --check FILE    # also checks the test build is byte-for-byte FILE (e.g. the deployed one)

The source is kept in its live form. The test build differs only in:
  - browser storage: tdsdesk:* -> tdsdesk-test:*, and the databases tdsdesk-bank / tdsdesk-work -> ...-test
  - the TEST mark: an orange top edge, a fixed orange bar, and "TEST" under the brand (build/test-style.html)
  - APP_VERSION starts with "TEST · "
Nothing else may differ; the checks below stop the build if a rule is broken.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
def read(p): return open(os.path.join(ROOT, p), encoding="utf-8").read()

def assemble():
    shell = read("src/shell.html")
    order = json.load(open(os.path.join(ROOT, "src/js/ORDER.json")))
    missing = sorted(set(f for f in os.listdir(os.path.join(ROOT, "src/js")) if f.endswith(".js")) - set(order))
    if missing: sys.exit("These program files are not in src/js/ORDER.json: " + ", ".join(missing))
    js = "".join(read("src/js/" + f) for f in order)
    css = read("src/css/app.css")
    if shell.count("{{CSS}}") != 1 or shell.count("{{JS}}") != 1: sys.exit("src/shell.html must have {{CSS}} and {{JS}} once each")
    return shell.replace("{{CSS}}", css).replace("{{JS}}", js)

def live_checks(html):
    bad = [k for k in ["tdsdesk-test:", "tdsdesk-bank-test", "tdsdesk-work-test", "is-test", 'APP_VERSION = "TEST'] if k in html]
    if bad: sys.exit("The source must stay in its live form; found: " + ", ".join(bad))
    if not re.search(r'const APP_VERSION = "[^"]+";', html): sys.exit("APP_VERSION not found")

def to_test(html):
    t = html.replace("tdsdesk:", "tdsdesk-test:").replace('"tdsdesk-bank"', '"tdsdesk-bank-test"').replace('"tdsdesk-work"', '"tdsdesk-work-test"')
    if "tdsdesk-bank-test" not in t or "tdsdesk-work-test" not in t:
        t = re.sub(r"tdsdesk-(bank|work)(?!-test)", r"tdsdesk-\1-test", t)
    style = read("build/test-style.html")
    i = t.find("</head>")
    t = t[:i] + style + t[i:]
    t = t.replace("<body>", '<body class="is-test">', 1)
    t = re.sub(r'(const APP_VERSION = ")', "\\1TEST \u00b7 ", t, 1)
    return t

def main():
    html = assemble()
    live_checks(html)
    test = to_test(html)
    import shutil
    for d, h in [("site", html), ("site-test", test)]:
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)
        open(os.path.join(ROOT, d, "index.html"), "w", encoding="utf-8").write(h)
        # the libraries and the bridge setup the page loads from assets/
        shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(ROOT, d, "assets"), dirs_exist_ok=True)
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
