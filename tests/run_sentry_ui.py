"""python3 run_sentry_ui.py - Sentry in the React test build (app/dist-test; docs/sentry.md): the owner's conditions of
08-Oct-2026. A made-up client with made-up bills (tests/fixtures/sentry-sensitive.json); on the Bills, Post to Tally and
Tally pages errors are forced (an uncaught error, a rejected promise, a part of the page that fails to draw, a console
error), each carrying GSTINs, PANs, amounts, names, narrations, bill numbers, Tally XML, emails and ids; the page's
address carries ids in its hash; a fetch and a click carry them too. Sentry's ingest address is routed to this test:
every envelope the page would send is caught and must carry none of the made-up data, no replay or feedback item, only
the allowed fields, environment "staging", the page's NAME only. Then: on any other host than staging (no force), or with
the browser's switch off, nothing at all is sent. A failure here fails CI (tests/ci/tests.txt).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sentry_ui.py"""
import os, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
if not os.path.isabs(SITE): SITE = os.path.join(HERE, SITE)
PORT = int(os.environ.get("SENTRY_UI_PORT", "8361"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
FX = json.load(open(os.path.join(HERE, "fixtures", "sentry-sensitive.json")))
SECRETS = FX["strings"] + FX["tokens"]
INGEST = "https://o4512221111320576.ingest.us.sentry.io"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def leaks(s): return [t for t in SECRETS if t in s]

ALLOWED = {"event_id", "timestamp", "platform", "level", "release", "environment", "exception", "message", "breadcrumbs", "tags", "user", "request", "contexts", "sdk"}
BILLS = [("ALPHA TRADERS", "AAAPA1234A", "AB/101", "2026-09-10", 125000), ("Zeta Supplies Ltd", "ABCPK7777Q", "ZC/77", "2026-09-11", 2500.5),
         ("Kappa Labs", "ABCPK7777Q", "INV-2026-0042", "2026-09-12", 118000)]

def page(br, force=True, off=False):
    ctx = br.new_context(viewport={"width": 1400, "height": 950})
    if force: ctx.add_init_script("window.__fincomSentryForce = true;")
    if off: ctx.add_init_script("try { localStorage.setItem('fincom.sentry', 'off'); } catch (e) {}")
    got, other = [], []
    def ingest(route):
        req = route.request
        got.append({"url": req.url, "body": (req.post_data_buffer or b"").decode("utf-8", "replace"), "headers": req.headers})
        route.fulfill(status=200, content_type="application/json", body="{}")
    # the cloud is not reached from this test (the app works offline); any Sentry address other than FinCom's ingest is a
    # failure. Playwright tries the routes added last first: the ingest's own route is added after these
    ctx.route(re.compile(r"^https://[^/]*supabase\.co/.*"), lambda r: r.abort())
    ctx.route(re.compile(r"^https?://[^/]*sentry\.io/.*"), lambda r: (other.append(r.request.url), r.abort()))
    ctx.route(INGEST + "/**", ingest)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    return ctx, pg, got, other

FORCE = r"""([texts, where]) => {
  const T = (i) => texts[i % texts.length] + ' (' + where + ')';
  // an uncaught error, a rejected promise (an Error, and a plain object holding business data), console errors
  setTimeout(() => { throw new Error(T(0)); }, 0);
  setTimeout(() => { throw new TypeError(T(3)); }, 5);
  Promise.reject(new Error(T(1)));
  Promise.reject({party: 'ALPHA TRADERS', gstin: '09AANFG3202D1ZR', amount: '1,25,000.00', narration: 'being rent paid for september to landlord'});
  console.error('posting failed for', {party: 'Zeta Supplies Ltd', pan: 'ABCPK7777Q', bill: 'ZC/77', email: 'priya.sharma@alphatraders.in'}, T(4));
  // a fetch and an XHR to addresses with ids, and a click on a button with business data in its words: never breadcrumbs
  fetch('/rest/v1/tally_post_jobs?id=eq.00000004-1111-4111-8111-000000000000&client_id=eq.cmufksrrqjub2g').catch(() => {});
  const x = new XMLHttpRequest(); x.open('GET', '/rest/v1/bills?gstin=09AANFG3202D1ZR'); x.send();
  const b = document.createElement('button'); b.textContent = 'Post ALPHA TRADERS ₹1,25,000.00 AB/101'; b.id = 'sentryClick'; document.body.appendChild(b); b.click(); b.remove();
  // the page's address with ids in its hash; the title with the client's name
  history.replaceState(null, '', location.pathname + '?client=cmufksrrqjub2g#gstin=09AANFG3202D1ZR&file=Alpha_Traders_Invoice_AB-101.pdf');
  document.title = 'OMEGA HOLDINGS & CO';
  // then an error thrown later, with the ids in the address
  setTimeout(() => { throw new Error(T(5) + ' ' + T(6)); }, 20);
}"""
# a part of the page that fails to draw: money() (the screens' amounts) throws, with business data, for one redraw
GUARD = r"""(text) => { const m = window.money; window.money = function () { throw new Error(text); };
  try { FinComReact.redraw(); } catch (e) {} window.money = m; FinComReact.redraw(); }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg, got, other = page(br)
    pg.wait_for_function("typeof window.__fincomReport === 'function'", timeout=10000)
    ok(True, "Sentry started on the test build when forced (window.__fincomReport set)")
    E = pg.evaluate
    cid = E("""(bills) => { const c = newCompany({name: "OMEGA HOLDINGS & CO", gstin: "27AAACZ9876K1Z3"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id;
      bills.forEach(([n, pan, no, d, amt]) => { const e = newEntry("Manual entry"); Object.assign(e.x, {vendorName: n, vendorPan: pan, vendorGstin: "09AANFG3202D1ZR", invoiceNo: no, invoiceDate: d, taxable: amt, total: amt,
        narration: "being rent paid for september to landlord", fileName: "Alpha_Traders_Invoice_AB-101.pdf"});
        e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; });
      return c.id; }""", BILLS)
    texts = FX["texts"]
    # Bills
    E("(cid) => openCompany(cid).then(() => goStep('review', 'bills'))", cid); pg.wait_for_timeout(1500)
    route_bills = E("S.view + '/' + S.tab")
    E(FORCE, [texts, "bills"]); pg.wait_for_timeout(600)
    E(GUARD, texts[2]); pg.wait_for_timeout(600)
    # Post to Tally
    E("() => { Object.values(D().entries).forEach(e => approve(e)); refreshStats(S.coId); goStep('post', 'bills'); }"); pg.wait_for_timeout(1500)
    E(FORCE, [texts, "post"]); pg.wait_for_timeout(600)
    E(GUARD, texts[7]); pg.wait_for_timeout(600)
    # the Tally page
    E("() => { S.view = 'home'; S.homeTab = 'tally'; render(); }"); pg.wait_for_timeout(1500)
    E(FORCE, [texts, "tally"]); pg.wait_for_timeout(600)
    E("(t) => window.__fincomReport(new Error(t), 'TallyHome')", texts[8])
    pg.wait_for_timeout(3000)
    ctx.close()

    print("  %d envelopes caught" % len(got))
    ok(len(got) >= 8, "the forced errors were reported (%d envelopes)" % len(got))
    ok(not other, "nothing went to any other Sentry address or to the cloud (%s)" % other[:3])
    types, events, bad_fields, all_text = set(), [], set(), ""
    for g in got:
        all_text += g["url"] + "\n" + g["body"] + "\n"
        lines = [l for l in g["body"].split("\n") if l.strip()]
        head = json.loads(lines[0]); i = 1
        while i < len(lines):
            ih = json.loads(lines[i]); types.add(ih.get("type")); i += 1
            if i < len(lines):
                try: payload = json.loads(lines[i])
                except Exception: payload = None
                if ih.get("type") == "event" and isinstance(payload, dict):
                    events.append(payload); bad_fields |= set(payload) - ALLOWED
                i += 1
    lk = leaks(all_text)
    ok(not lk, "no made-up business data in any envelope" + ("" if not lk else ": " + ", ".join(lk) + "\n" + all_text[:3000]))
    ok(types <= {"event"}, "only event items: no replay, feedback, attachment, session or client report (%s)" % sorted(t or "" for t in types))
    ok(not bad_fields, "only the allowed fields in an event (%s)" % sorted(bad_fields))
    ok(events and all(e.get("environment") == "staging" for e in events), "environment 'staging' on every event")
    ok(all(re.match(r"^fincom-app-[0-9a-z-]+$", e.get("release", "")) for e in events), "a release on every event (%s)" % sorted(set(e.get("release") for e in events)))
    urls = set((e.get("request") or {}).get("url", "") for e in events)
    ok(urls and all("?" not in u and "#" not in u for u in urls), "the page's address without its query or hash (%s)" % sorted(urls))
    ok(all(set((e.get("request") or {}).get("headers", {})) <= {"User-Agent"} for e in events), "of the request, the browser's User-Agent only")
    users = set(json.dumps(e.get("user"), sort_keys=True) for e in events)
    ok(len(users) == 1 and re.match(r'^\{"id": "[0-9a-f]{32}"\}$', users.pop()), "user: one random install id, nothing else")
    routes = set((e.get("tags") or {}).get("route") for e in events)
    ok({"client/invoices", "client/export", "home/tally"} & routes and all(re.match(r"^[a-z]+(/[a-zA-Z]+)*$", r or "") for r in routes), "tags.route is the page's name (%s; the bills page is %s)" % (sorted(r or "" for r in routes), route_bills))
    guards = set((e.get("tags") or {}).get("guard") for e in events) - {None}
    ok(guards - {"TallyHome"}, "a part of the page that failed to draw was reported by its guard (%s)" % sorted(guards))
    crumbs = [b for e in events for b in e.get("breadcrumbs", [])]
    cats = set(b.get("category") for b in crumbs)
    ok(cats <= {"navigation", "console"} and "navigation" in cats, "breadcrumbs: navigation and console errors only (%s)" % sorted(cats))
    nav = [b for b in crumbs if b.get("category") == "navigation"]
    ok(nav and all(re.match(r"^[a-z]+(/[a-zA-Z]+)*$", b["data"]["to"]) and set(b["data"]) <= {"from", "to"} for b in nav), "navigation breadcrumbs carry page names only (%s)" % sorted(set(b["data"]["to"] for b in nav)))
    ok(all(b.get("level") == "error" and "data" not in b for b in crumbs if b.get("category") == "console"), "console breadcrumbs: errors only, words scrubbed, never their arguments")
    frames = [f for e in events for v in (e.get("exception") or {}).get("values", []) for f in (v.get("stacktrace") or {}).get("frames", [])]
    ok(frames and all(set(f) <= {"filename", "function", "module", "lineno", "colno", "in_app"} for f in frames), "stack frames: file, function, line, column (%d frames)" % len(frames))
    ok(any("Cannot" in json.dumps(e) or "Error" in json.dumps(e) for e in events), "the error's type is kept")

    # ---- staging only: the same page on this host without the test's force sends nothing; nor with the browser's switch off
    for force, off, what in ((False, False, "another host than staging.fincom.live (no force)"), (True, True, "the browser's switch off (localStorage fincom.sentry = off)")):
        ctx, pg, got2, other2 = page(br, force=force, off=off)
        pg.evaluate("() => { setTimeout(() => { throw new Error('ALPHA TRADERS 09AANFG3202D1ZR'); }, 0); Promise.reject(new Error('x')); }"); pg.wait_for_timeout(2000)
        ok(not got2 and not other2 and pg.evaluate("typeof window.__fincomReport") == "undefined", "nothing sent on " + what)
        ctx.close()
    br.close()
html = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
ok(INGEST in html and "connect-src" in html, "the test build's page may reach Sentry's ingest address (CSP connect-src)")
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
