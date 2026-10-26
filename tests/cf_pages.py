"""python3 tests/cf_pages.py - the site as Cloudflare Pages would serve it (docs/CLOUDFLARE.md), to check the root
_headers file before it goes to main. Two ways:

  serve DIR [PORT]             serve a copy of main (git archive origin/main | tar -x -C DIR) the way Pages does: the rules
                               of DIR/_headers (or CF_HEADERS=file), /x.html -> /x and /x/index.html -> /x/ (308), the
                               nearest 404.html with status 404, or /index.html with 200 when there is no /404.html (Pages'
                               single-page mode)
  wrap TEST.py [args]          run one of the app's tests (they serve app/dist-test, or TDSDESK_SITE, with Python's
                               http.server) with the _headers rules added to every answer, as for the file at
                               CF_PREFIX + path (CF_PREFIX defaults to /review: the published copy of the build). Every
                               page the test opens reports Content-Security-Policy and Permissions-Policy messages from
                               the browser's console; they are listed at the end (and written to CF_REPORT if set).
                               CF_ENFORCE=0 turns the CSP header into Content-Security-Policy-Report-Only.

How Pages applies the rules (developers.cloudflare.com/pages/configuration/headers/): every rule whose path matches, in
file order; a header set again is joined with ", "; "! Name" removes what an earlier rule set. A single * matches anything
(slashes too); :name matches one path segment."""
import os, re, sys, json, atexit, runpy, functools, threading, http.server, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def parse(text):
    rules, cur = [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not raw[0].isspace():
            pat = "^" + re.sub(r"\\\*", "(?P<splat>.*)", re.escape(line.strip())) + "$"
            pat = re.sub(r"\\?:([A-Za-z]\w*)", r"(?P<\1>[^/]+)", pat)
            cur = {"path": line.strip(), "re": re.compile(pat), "set": [], "unset": []}
            rules.append(cur)
        elif cur is not None:
            s = line.strip()
            if s.startswith("! "):
                cur["unset"].append(s[2:].strip())
            elif ":" in s:
                k, v = s.split(":", 1)
                cur["set"].append((k.strip(), v.strip()))
    return rules


def headers_for(rules, path):
    out = {}   # lower name -> [name, value]
    for r in rules:
        if not r["re"].match(path):
            continue
        for k in r["unset"]:
            out.pop(k.lower(), None)
        for k, v in r["set"]:
            if k.lower() in out:
                out[k.lower()][1] += ", " + v
            else:
                out[k.lower()] = [k, v]
    return [tuple(x) for x in out.values()]


def load_rules(site=None):
    f = os.environ.get("CF_HEADERS") or (os.path.join(site, "_headers") if site and os.path.exists(os.path.join(site, "_headers")) else os.path.join(REPO, "_headers"))
    with open(f, encoding="utf-8") as h:
        return parse(h.read()), f


def report_only(hs):
    if os.environ.get("CF_ENFORCE", "1") != "0":
        return hs
    return [("Content-Security-Policy-Report-Only" if k.lower() == "content-security-policy" else k, v) for k, v in hs]


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    """a copy of main served as Pages serves it"""
    rules = []
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".tflite": "application/octet-stream"})

    def log_message(self, *a):
        pass

    def _redirect(self, to):
        self.send_response(308); self.send_header("Location", to); self.send_header("Content-Length", "0"); self._cf_path = urllib.parse.urlsplit(to).path; self.end_headers()

    def end_headers(self):
        for k, v in report_only(headers_for(self.rules, getattr(self, "_cf_path", urllib.parse.urlsplit(self.path).path))):
            self.send_header(k, v)
        super().end_headers()

    def send_head(self):
        u = urllib.parse.urlsplit(self.path)
        p, q = urllib.parse.unquote(u.path), ("?" + u.query if u.query else "")
        root = self.directory
        fs = lambda x: os.path.join(root, x.lstrip("/"))
        self._cf_path = p
        if p.endswith("/index.html") and os.path.isfile(fs(p)):
            return self._redirect(p[:-len("index.html")] + q)
        if p.endswith(".html") and os.path.isfile(fs(p)):
            return self._redirect(p[:-len(".html")] + q)
        if p.endswith("/") and os.path.isfile(fs(p + "index.html")):
            self.path = p + "index.html"; return super().send_head()
        if not p.endswith("/") and os.path.isfile(fs(p)):
            return super().send_head()
        if not p.endswith("/") and os.path.isfile(fs(p + ".html")):
            self.path = p + ".html"; return super().send_head()
        if not p.endswith("/") and os.path.isfile(fs(p + "/index.html")):
            return self._redirect(p + "/" + q)
        d = os.path.dirname(p.rstrip("/") or "/")
        while True:   # the nearest 404.html, up to /404.html
            if os.path.isfile(fs(d.rstrip("/") + "/404.html")):
                return self._file(fs(d.rstrip("/") + "/404.html"), 404)
            if d in ("/", ""):
                break
            d = os.path.dirname(d)
        return self._file(fs("/index.html"), 200)   # no /404.html: Pages' single-page mode

    def _file(self, f, status):
        body = open(f, "rb").read()
        self.send_response(status); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers()
        import io
        return io.BytesIO(body)


def serve(site, port):
    rules, f = load_rules(site)
    H = type("H", (PagesHandler,), {"rules": rules})
    srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(H, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f


MSGS = []
WATCH = re.compile(r"Content Security Policy|Content-Security-Policy|Refused to|Permissions[- ]Policy|Unrecognized feature|\[csp\]", re.I)
LISTEN = """(() => { try { document.addEventListener("securitypolicyviolation", (e) => console.error("[csp] " + e.violatedDirective +
  " blocked " + (e.blockedURI || "(inline)") + (e.sourceFile ? " at " + e.sourceFile + ":" + e.lineNumber : "") + (e.disposition === "report" ? " (report only)" : ""))); } catch (e) {} })()"""


def watch_playwright():
    """every context the test makes notes the CSP and Permissions-Policy messages of its pages (and their workers)"""
    from playwright.sync_api._generated import Browser, BrowserType, BrowserContext

    def on_page(pg):
        name = lambda: pg.url[:90]
        pg.on("console", lambda m: WATCH.search(m.text) and MSGS.append("%s | %s: %s" % (name(), m.type, m.text[:400])))
        pg.on("worker", lambda w: w.on("console", lambda m: WATCH.search(m.text) and MSGS.append("worker %s | %s" % (w.url[:90], m.text[:400]))) if hasattr(w, "on") else None)

    def fit(ctx):
        try:
            ctx.add_init_script(LISTEN)
            ctx.on("page", on_page)
            for pg in ctx.pages:
                on_page(pg)
        except Exception as e:
            MSGS.append("(could not watch a context: %s)" % e)
        return ctx

    nc = Browser.new_context
    Browser.new_context = lambda self, *a, **k: fit(nc(self, *a, **k))
    npg = Browser.new_page

    def new_page(self, *a, **k):
        pg = npg(self, *a, **k)
        fit(pg.context)
        return pg
    Browser.new_page = new_page
    lpc = BrowserType.launch_persistent_context
    BrowserType.launch_persistent_context = lambda self, *a, **k: fit(lpc(self, *a, **k))


def wrap(script, args):
    rules, f = load_rules(None)
    prefix = os.environ.get("CF_PREFIX", "/review").rstrip("/")
    base_end = http.server.SimpleHTTPRequestHandler.end_headers

    def end_headers(self):
        if not getattr(self, "_cf_done", False):
            self._cf_done = True
            path = prefix + urllib.parse.urlsplit(self.path).path
            for k, v in report_only(headers_for(rules, path)):
                self.send_header(k, v)
        base_end(self)
    http.server.SimpleHTTPRequestHandler.end_headers = end_headers
    orig_send_response = http.server.BaseHTTPRequestHandler.send_response

    def send_response(self, *a, **k):
        self._cf_done = False
        return orig_send_response(self, *a, **k)
    http.server.BaseHTTPRequestHandler.send_response = send_response
    watch_playwright()

    def summary():
        seen = sorted(set(MSGS))
        print("\n== cf_pages: %s with %s (prefix %s): %d CSP / Permissions-Policy message(s)" % (os.path.basename(script), f, prefix, len(seen)))
        for m in seen:
            print("  " + m)
        if os.environ.get("CF_REPORT"):
            with open(os.environ["CF_REPORT"], "w") as h:
                json.dump({"test": script, "messages": seen}, h, indent=1)
    atexit.register(summary)
    sys.argv = [script] + args
    sys.path.insert(0, os.path.dirname(os.path.abspath(script)))
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "serve":
        srv, f = serve(os.path.abspath(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 8788)
        print("serving %s as Cloudflare Pages would, with %s, at http://localhost:%d/" % (sys.argv[2], f, srv.server_address[1]))
        threading.Event().wait()
    elif len(sys.argv) >= 3 and sys.argv[1] == "wrap":
        wrap(sys.argv[2], sys.argv[3:])
    else:
        print(__doc__)
        sys.exit(2)
