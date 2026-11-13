"""python3 run_legacy_room.py - room in the program every page loads (legacy.js) and in the app's first file (next-size-room):
the parts of the program used on one screen only come with that screen's file (build.py @react-lazy), and work as before.

  1. sizes, gzip level 6 as run_stability.py measures them: legacy.js <= 600,000 bytes (15 KB under its 600 KB budget) and
     the app's first file (index-*.js) <= 264,192 bytes (2 KB under its 260 KB budget);
  2. none of the moved parts is defined in legacy.js, nor the GSTR-9C screen in the first file; each part is in a file the
     service worker keeps (sw.js), as the TDS screens' own program (src/js/86) is;
  3. in the page (no file fetched ahead: a line that saves data), none of them is there before its screen is opened, and the
     screen brings it: GST > GSTR-9 and 9C (GST9, GST9C and their PDF and Excel), MIS (its pack and Excel), TDS (24Q's text
     file), Sales (the printed invoice), Post to Tally (who holds a posting); an action asked for before its screen's file
     is in loads the file first, says "Loading…" meanwhile, and then does what was asked (the GSTR-9 Excel);
  4. offline, with the files the service worker kept: each of those screens opens and has its part.
next-room-2: the same for the working only the GST screens call (GSTX: Filed vs books; GSTV: taking in a filed return's PDF),
AI help's asking and buttons (AIH), the deductions-only Excel of a TDS return (TDSEdit, out of the first file) and the In
Tally page of documents other than bills (screens/Done.jsx, its own file: drawn on a slow line after the page's shape).
Run on the React build (app/dist-test, or TDSDESK_SITE)."""
import os, sys, re, json, gzip, glob, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("ROOM_PORT") or 8363)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# each moved part: its name, and the screen that brings it (what is set before render())
PARTS = {"GST9": "gst", "GST9C": "gst", "gst9PackHtml": "gst", "gst9Excel": "gst", "gst9Where": "gst", "gst9Typed": "gst", "gst9cSet": "gst",
         "misPackHtml": "mis", "misExcel": "mis", "TDS24Q_FILE": "tds", "payFvuDownload": "tds", "invoiceHtml": "sales", "rereadSales": "sales", "salesWhy": "sales", "PostOwner": "post",
         # next-room-2: Filed vs books' import, Returns filed's taking in of PDFs, AI help's buttons (with the GST screens)
         "gstxImport": "gst", "gstvTake": "gst", "aihAct": "gst"}
# next-room-2: the parts of GSTX, GSTV, AIH (src/js/56, 38, 50) and TDSEdit (app/src/lib) only their own pages call, put on
# the same objects by those pages' files; and what the rest of the program calls, which stays in the page from the start
LATER = ["GSTX.cross", "GSTX.r1Match", "GSTX.corrections", "GSTV.detect", "GSTV.addRecord", "AIH.reviewLedgers", "AIH.readNotice", "TDSEdit.read", "TDSEdit.applyAll"]
STAYS = ["GSTX.fig", "GSTX.portal", "GSTX.takePortal", "GSTV.expected", "GSTV.filedOn", "GSTV.copies", "AIH.enabled", "AIH.ready", "AIH.tdsRule", "AIH.blocked", "TDSEdit.apply", "TDSEdit.problems"]
METH = "(ns) => Object.fromEntries(ns.map((n) => { const [o, m] = n.split('.'); return [n, typeof (0, eval)(o)[m]]; }))"
OPEN = {"gst": "S.tab = 'books'; S.booksTab = 'gst'; S.gstPart = 'g9'; S.gstYm = '202603'; S.gstReg = '07';",
        "mis": "S.tab = 'books'; S.booksTab = 'mis';",
        "tds": "S.tab = 'books'; S.booksTab = 'tds';",
        "sales": "S.tab = 'sales';",
        "post": "S.tab = 'export';"}

print("1. sizes")
gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6))
leg_file = os.path.join(SITE, "legacy.js"); leg = open(leg_file, encoding="utf8").read()
main_js = glob.glob(os.path.join(SITE, "assets", "index-*.js"))
lg, mg = gz(leg_file), sum(gz(f) for f in main_js)
ok(lg <= 600000, "legacy.js: %d bytes gzip <= 600,000 (%d bytes under its budget of 615,423)" % (lg, 615423 - lg))
ok(mg <= 264192, "the first file: %d bytes gzip <= 264,192 (%d bytes under its budget of 266,240)" % (mg, 266240 - mg))

print("2. the moved parts are not in legacy.js; each is in a file the service worker keeps")
defined = lambda n, s: re.search(r"(?:^|[^\w$.])(?:function\s+" + re.escape(n) + r"\s*\(|" + re.escape(n) + r"\s*=\s*\{|" + re.escape(n) + r"\.\w+\s*=\s*function\b)", s)
inleg = [n for n in PARTS if defined(n, leg)]
ok(not inleg, "none defined in legacy.js (%s)" % ", ".join(inleg))
main_txt = "".join(open(f, encoding="utf8").read() for f in main_js)
ok("GSTR-9C for " not in main_txt, "the GSTR-9C screen is not in the first file (it comes with the GST screen)")
# next-room-2: a line of each part moved out (as the minified files keep them: words shown to the person)
for w, what in [("_GST-book-corrections_", "Filed vs books' corrections Excel"), ("AI could not draft the reply", "AI help's draft of a reply"), ("This PDF is not on this computer", "Returns filed's opening of a PDF")]:
    ok(w not in leg, "%s is not in legacy.js" % what)
for w, what in [("-to-correct.xlsx", "the deductions-only Excel of a TDS return"), ("Posted lately", "the In Tally page of other documents")]:
    ok(w not in main_txt, "%s is not in the first file" % what)
sw = open(os.path.join(SITE, "sw.js"), encoding="utf8").read()
kept = set(re.findall(r'"\./(assets/[^"]+\.js)"', sw))
files = {os.path.relpath(f, SITE).replace(os.sep, "/"): open(f, encoding="utf8").read() for f in glob.glob(os.path.join(SITE, "assets", "*.js"))}
for n in PARTS:
    at = [f for f, t in files.items() if "globalThis." + n + "=" in t.replace(" ", "")]
    ok(len(at) == 1 and at[0] in kept, "%s: in %s, kept by the service worker" % (n, at[0] if at else "no file"))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
books = json.load(open(CACHE))
# a line that saves data: no screen's file fetched ahead (lineSlow, app/src/screens/lazy.js), each comes when its page opens
SAVE_DATA = "Object.defineProperty(navigator, 'connection', {get: () => ({saveData: true, effectiveType: '4g', downlink: 10})});"
SEED = """(books) => { S.firm.firmName = "Test Firm of Accountants";
  const c = newCompany({name: "Test Traders Private Limited", gstin: "07AAGCL4827M1Z3"}); c.tan = "DELT12345A"; S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  const b = Object.assign({loading: false, challans: [], alloc: {}}, books, {cid: c.id}); S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books);
  window.__bk = S.books; refreshStats(c.id); Store.saveFirm(); Store.saveCompany(c);
  if (typeof saveBooks === "function") saveBooks(); render(); return c.id; }"""
def start(pg):
    pg.goto(URL); pg.wait_for_timeout(2000)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(800)
def seed(pg): cid = pg.evaluate(SEED, books); pg.wait_for_timeout(1200); return cid
def reopen(pg):
    # after a reload: the client's books again (they are kept in this browser; put back as the seed made them)
    start(pg); pg.evaluate(SEED, books); pg.wait_for_timeout(1200)
def kinds(pg): return pg.evaluate("(ns) => Object.fromEntries(ns.map((n) => [n, typeof globalThis[n]]))", list(PARTS))
def open_screen(pg, k):
    pg.evaluate("() => { S.view = 'company'; " + OPEN[k] + " render(); }")
    try: pg.wait_for_function("(ns) => ns.every((n) => typeof globalThis[n] !== 'undefined')", arg=[n for n in PARTS if PARTS[n] == k], timeout=15000)
    except Exception: pass
    pg.wait_for_timeout(600)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        print("3. each part comes with its screen, and not before")
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True); ctx.add_init_script(SAVE_DATA)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        start(pg); seed(pg); pg.wait_for_timeout(2500)
        k0 = kinds(pg)
        m0, s0 = pg.evaluate(METH, LATER), pg.evaluate(METH, STAYS)
        ok(all(v == "undefined" for v in m0.values()), "nor the pages' own parts of GSTX, GSTV, AIH and TDSEdit (%s)" % ", ".join(n for n, v in m0.items() if v != "undefined"))
        ok(all(v == "function" for v in s0.values()), "what the rest of the program calls is there from the start (%s)" % ", ".join(n for n, v in s0.items() if v != "function"))
        ok(all(v == "undefined" for v in k0.values()), "on the Overview none of them is in the page yet (%s)" % ", ".join(n for n, v in k0.items() if v != "undefined"))
        for k in ["gst", "mis", "tds", "sales", "post"]:
            open_screen(pg, k)
            kk = kinds(pg); want = [n for n in PARTS if PARTS[n] == k]
            ok(all(kk[n] != "undefined" for n in want), "%s: the screen brings %s" % (k, ", ".join("%s (%s)" % (n, kk[n]) for n in want)))
        m1 = pg.evaluate(METH, LATER)
        ok(all(v == "function" for v in m1.values()), "the screens bring their own parts of GSTX, GSTV, AIH and TDSEdit (%s)" % ", ".join(n for n, v in m1.items() if v != "function"))
        # the In Tally page of documents other than bills (screens/Done.jsx): its own file now, drawn when it comes
        pg.evaluate("() => { S.view = 'company'; S.step = null; S.tab = 'done'; S.postFocus = 'bank'; render(); }")
        try: pg.wait_for_selector("#app [data-in-tally]", timeout=15000)
        except Exception: pass
        ok(pg.locator("#app [data-in-tally]").count() == 1 and "Posted lately" in pg.inner_text("#app"), "the In Tally page of other documents is drawn from its own file")
        open_screen(pg, "gst")
        t = pg.inner_text("#app")
        ok("GSTR-9 for 2025-26" in t, "GSTR-9 is drawn for the year")
        pk = pg.evaluate("() => { const d = document.createElement('div'); d.innerHTML = gst9PackHtml('9C'); return d.innerText; }")
        ok("GSTR-9C" in pk and "5Q" in pk, "the 9C PDF's page is made from its screen (FinComReact.markup)")
        ctx.close()

        # an action asked for before its screen's file is in: the file first, "Loading…" meanwhile, then the action
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True); ctx.add_init_script(SAVE_DATA)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        start(pg); seed(pg); pg.wait_for_timeout(1500)
        pg.evaluate("() => { S.gstYm = '202603'; S.gstReg = '07'; window.__saved = []; window.saveFile = (n) => window.__saved.push(n); window.__toasts = []; const t = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t(m); }; }")
        ok(pg.evaluate("typeof GST9") == "undefined", "the GSTR-9 Excel asked for from the Overview: its file is not in yet")
        pg.evaluate("doAct('gst9Excel')")
        try: pg.wait_for_function("() => window.__saved.length > 0", timeout=20000)
        except Exception: pass
        sv, ts = pg.evaluate("window.__saved"), pg.evaluate("window.__toasts")
        ok(any("GSTR-9" in n for n in sv), "the file is loaded, then the Excel made (%s)" % sv)
        ok(ts and ts[0].startswith("Loading"), "“Loading…” is said meanwhile (%s)" % ts[:3])
        ctx.close()

        # a slow line: the file of the In Tally page held back 2 s; the page's shape meanwhile, then the page, nothing lost
        ctx = br.new_context(viewport={"width": 1440, "height": 900}); ctx.add_init_script(SAVE_DATA)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        held = []
        pg.route("**/assets/Done-*.js", lambda route: held.append(route))
        start(pg); seed(pg); pg.wait_for_timeout(1500)
        pg.evaluate("() => { S.view = 'company'; S.step = null; S.tab = 'done'; S.postFocus = 'bank'; render(); }")
        pg.wait_for_timeout(2000)
        ok(len(held) == 1 and pg.locator("#app [data-in-tally]").count() == 0 and pg.locator("#app [data-page-skeleton]").count() == 1, "on a slow line the In Tally page shows the page's shape while its file comes (held 2 s)")
        for r in held: r.continue_()
        try: pg.wait_for_selector("#app [data-in-tally]", timeout=15000)
        except Exception: pass
        ok(pg.locator("#app [data-in-tally]").count() == 1 and pg.locator("#app [data-lazy-failed]").count() == 0, "and is drawn when it has come")
        ctx.close()

        print("4. offline, with the files the service worker kept")
        ctx = br.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(800); pg.evaluate("() => localStorage.setItem('fincom.sw', 'on')")
        start(pg); seed(pg)
        ok(pg.evaluate("() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))])"), "the worker is ready")
        pg.reload(); pg.wait_for_timeout(2500)
        # the rest of the build's files, kept once the first page is up and the computer idle (or asked for here)
        pg.evaluate("() => navigator.serviceWorker.ready.then((r) => r.active.postMessage('fincom:keep-rest'))")
        need = sorted(set(f for n in PARTS for f, t in files.items() if "globalThis." + n + "=" in t.replace(" ", "")))
        try: pg.wait_for_function("(need) => caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys())))).then((a) => { const u = a.flat().map((r) => r.url); return need.every((f) => u.some((x) => x.split('?')[0].endsWith('/' + f))); })", arg=need, timeout=30000)
        except Exception: pass
        got = pg.evaluate("() => caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys())))).then((a) => a.flat().map((r) => r.url.split('?')[0]))")
        ok(need and all(any(u.endswith("/" + f) for u in got) for f in need), "the moved parts' files are kept (%d files)" % len(need))
        ctx.set_offline(True)
        reopen(pg)
        ok(pg.locator("#app .react-host").count() == 1, "with no line, FinCom opens from this computer")
        for k in ["gst", "mis", "tds", "sales", "post"]:
            open_screen(pg, k)
            kk = kinds(pg); want = [n for n in PARTS if PARTS[n] == k]
            ok(all(kk[n] != "undefined" for n in want) and pg.locator("#app [data-lazy-failed]").count() == 0, "offline, %s: the screen opens with %s" % (k, ", ".join(want)))
        ok("GSTR-9" in (open_screen(pg, "gst") or pg.inner_text("#app")), "offline, GSTR-9 is drawn")
        mo = pg.evaluate(METH, LATER)
        ok(all(v == "function" for v in mo.values()), "offline, the pages' own parts of GSTX, GSTV, AIH and TDSEdit are there (%s)" % ", ".join(n for n, v in mo.items() if v != "function"))
        pg.evaluate("() => { S.view = 'company'; S.step = null; S.tab = 'done'; S.postFocus = 'bank'; render(); }")
        try: pg.wait_for_selector("#app [data-in-tally]", timeout=15000)
        except Exception: pass
        ok(pg.locator("#app [data-in-tally]").count() == 1 and pg.locator("#app [data-lazy-failed]").count() == 0, "offline, the In Tally page of other documents opens")
        ctx.set_offline(False); ctx.close()
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to fetch" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
