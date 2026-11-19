"""python3 tests/run_frame_ancestors.py - the app's own blob: frames may show, other sites still may not frame the app.

Safari gives a blob: document the policy of the page that made it, frame-ancestors included. The app shows a bill's PDF
in an <iframe> from a blob: URL (app/src/parts/BillDoc.jsx) and prints meeting notes from one (app/src/calls/Notes.jsx),
so with frame-ancestors 'none' Safari would refuse to show them (a blank bill, no print). The app's policy is to say
frame-ancestors 'self': its own pages (and their blob: documents) may frame it, nobody else. Reads cloudflare/_headers.main
the way Cloudflare applies it (tests/cf_pages.py); no browser needed."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cf_pages

fails = []
def ok(c, m):
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails.append(m)

rules = cf_pages.parse(open(os.path.join(HERE, "..", "cloudflare", "_headers.main"), encoding="utf-8").read())

def directives(path):
    csp = [v for k, v in cf_pages.headers_for(rules, path) if k.lower() == "content-security-policy"]
    ok(len(csp) == 1, "%s: one Content-Security-Policy header (%d)" % (path, len(csp)))
    out = {}
    for part in (csp[0] if csp else "").split(";"):
        w = part.split()
        if w: out[w[0].lower()] = w[1:]
    return out

for base in ("/review/", "/next/", "/review-prev/"):
    for p in (base, base + "index.html"):
        d = directives(p)
        ok(d.get("frame-ancestors") == ["'self'"], "%s: frame-ancestors is 'self' alone, so only FinCom's own pages frame it (%s)" % (p, d.get("frame-ancestors")))
        ok("blob:" in d.get("frame-src", []), "%s: frame-src lets the app's blob: frames load (%s)" % (p, d.get("frame-src")))

# what the app never serves is still never framed at all
d = directives("/")
ok(d.get("frame-ancestors") == ["'none'"], "/: frame-ancestors still 'none' outside the app (%s)" % d.get("frame-ancestors"))

print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
