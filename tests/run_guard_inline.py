"""python3 run_guard_inline.py - next-speed-2 (the speed plan of 22-Nov-2026, #7): the React build's page carries guard.js
(the frame check and the helpers older Safari lacks) inside itself, so the head no longer waits for a file of its own
(served no-cache: a round trip on every open without the service worker) before the rest of the page is read.
Checks the built page (app/dist-test, or TDSDESK_SITE):
  1. no <script src="./guard.js"> in the page; the same text inline, before the program and the app's entry, allowed by
     its own hash in the page's Content-Security-Policy;
  2. guard.js is still published (a page of an older build, or its service worker, may still ask for it)."""
import os, re, sys, base64, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
html = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
guard = open(os.path.join(HERE, "..", "app", "public", "guard.js"), encoding="utf-8").read()
ok('src="./guard.js"' not in html, "1. the page does not ask for guard.js")
m = re.search(r'<script id="fincom-guard">([\s\S]*?)</script>', html)
ok(bool(m) and m.group(1).strip() == guard.strip(), "1. guard.js's text is inside the page")
if m:
    h = "'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode() + "'"
    csp = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', html)
    ok(bool(csp) and h in csp.group(1), "1. allowed by its hash in the page's Content-Security-Policy")
    ok(html.index(m.group(0)) < html.index('<script type="module"'), "1. before the app's entry")
ok(os.path.isfile(os.path.join(SITE, "guard.js")), "2. guard.js is still published")
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
