"""python3 run_integrations_ui.py - the Integrations page (the owner's request of 13-Oct-2026; zoho-books).
  1. #/integrations: a card for Tally (FinCom Bridge), Zoho Books and Busy, each with its status line from the stand
     fixtures (Tally: "2 computers · 1 company linked"; Zoho: "Connected: 1 organisation"; Busy: "Coming soon", disabled,
     waiting on a Busy partner); no GST card; the sidebar's Integrations item opens it
  2. each card opens its page: Zoho Books (#/integrations/zoho: set up Yes, the organisation, its client, last and next
     read, calls today of the limit, errors), Tally (the Tally page); Back returns to the hub; Busy opens nothing
  3. no secret anywhere in the page: the canaries planted in the status (a token, a refresh token, a client secret) are
     never drawn, and nothing token-shaped is in the DOM
  4. who may do what: staff see everything and may Read now, but Connect, Reconnect, Webhook address and Disconnect are
     the owner's (disabled for staff); the owner's Connect asks the function for Zoho's page, Disconnect asks first
  5. a Zoho sign-in coming back (#/integrations/zoho?grant=…): the organisations not linked yet, the client guessed by
     GSTIN, Link (owner only)
  6. Client setup → Tally: the Books source card says Zoho Books for a Zoho client (no Link to Tally card) and the Tally
     company, with the Link to Tally card, for a Tally client
  7. "TaxPro" and "ASP" never reach a user: in the app's built files the GSP's name is only in the e-invoice set-up's own
     step (where the e-invoice portal asks for it), and FinCom's server messages are said as "FinCom's GST connection"
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_integrations_ui.py (under flock /tmp/fincom-app.lock)."""
import json, os, re, sys, glob, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8675
STATUS = json.load(open(os.path.join(HERE, "fixtures", "zoho", "status.json")))
CANARIES = ["canarycanary", "refreshcanary", "secret-canary", "accesscanary"]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """([status, role]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const z = Object.values(S.companies).find(x => x.name === "Zoho Co"), t = Object.values(S.companies).find(x => x.name === "Tally Co");
  window.__calls = window.__calls || [];
  const st = JSON.parse(JSON.stringify(status).replace(/"CLIENT"/g, JSON.stringify(z.id)));
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role, user_id: "u-1"})});
  const devs = [{id: "d1", name: "NWS144", revoked: false, last_seen: ago(0.5), info: {beat: {at: ago(0.5), open: ["TALLY CO"]}}},
                {id: "d2", name: "LAPTOP", revoked: false, last_seen: ago(1), info: {beat: {at: ago(1), open: []}}}];
  const cos = [{company: "TALLY CO", client_id: t.id, device_id: "d1", gstin: "", last_seen: ago(1)}, {company: "OTHER CO", client_id: null, device_id: "d2", gstin: "", last_seen: ago(2)}];
  Cloud.api = async (path, o) => {
    window.__calls.push(["api", path]);
    if (/^rpc\\/zoho_status/.test(path)) return JSON.parse(JSON.stringify(st));
    if (/^tally_devices/.test(path)) return devs; if (/^tally_companies/.test(path)) return cos; if (/^tally_read_stops/.test(path)) return [];
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn) => { window.__calls.push(["rpc", fn]); return fn === "tally_status" ? [] : {ok: true}; };
  TCloud.st[z.id] = {at: now, books: [{book: "b-0001", company: "Zoho Books · FinCom Zoho Test Pvt Ltd", from: "2025-04-01"}]};
  TCloud.st[t.id] = {at: now, books: [{book: "b-0002", company: "TALLY CO", from: "2025-04-01"}]};
  TLight.st.devs = devs; TLight.st.cos = cos; TLight.st.stops = []; TLight.st.loaded = true; TLight.st.by = {}; TLight.st.at = now + 3600000;
  ZohoB.st = {at: 0, busy: false, data: null, err: "", cfg: null, p: null};
  ZohoB.call = async (b) => { window.__calls.push(["zoho", b.kind, b]);
    if (b.kind === "config") return {ok: true, configured: true, redirectUri: "https://example.invalid/functions/v1/zoho-books", scopes: ["ZohoBooks.invoices.READ"], dc: "India"};
    if (b.kind === "connect_start") return {ok: false, error: "stand-in: not leaving the page"};
    if (b.kind === "hook_new") return {ok: true, url: "https://example.invalid/functions/v1/zoho-books?hook=shown-once"};
    if (b.kind === "link") return {ok: true, connection: "c-0002", first: {counts: {entries: 4}}};
    return {ok: true, counts: {entries: 0}, message: "done"}; };
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  return [z.id, t.id];
}"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.4", "url": "https://x/s.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.evaluate("""() => { for (const [n, g] of [["Zoho Co", "27AAACZ1234Z1ZG"], ["Tally Co", "09AANFG3202D1ZR"]]) { const c = newCompany({name: n, gstin: g}); c.tallyName = n; S.companies[c.id] = c;
            S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); } }""")
        E = lambda js, *a: pg.evaluate(js, *a)
        def scene(role):
            ids = E(SETUP, [STATUS, role]); pg.wait_for_timeout(200); return ids
        def go(h): E("(h) => { location.hash = h; }", h); pg.wait_for_timeout(1200)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        calls = lambda kind: [c for c in E("window.__calls") if c[0] == "zoho" and c[1] == kind]
        def no_secrets(where):
            html = E("() => document.documentElement.outerHTML")
            bad = [c for c in CANARIES if c in html] + re.findall(r"1000\.[0-9a-f]{16,}\.[0-9a-f]{8,}", html)
            ok(not bad and "client_secret" not in html.lower() and "refresh_token" not in html.lower(), "%s: no token, key or secret anywhere in the page (%s)" % (where, bad[:3]))

        # ---------------------------------------------------------------- 1. the hub
        print("== 1. the Integrations page")
        zid, tid = scene("staff")
        E("() => navHome('today')"); pg.wait_for_timeout(500)
        side = pg.locator('#side [data-side="Integrations"], [data-side="Integrations"]')
        ok(side.count() >= 1, "the sidebar has Integrations at firm level")
        side.first.click(); pg.wait_for_timeout(1500)
        ok(E("location.hash") == "#/integrations" and pg.locator('[data-pane="integrations"]').count() == 1, "it opens #/integrations (%s)" % E("location.hash"))
        cards = E("() => [...document.querySelectorAll('#app [data-integ]')].map(e => e.getAttribute('data-integ'))")
        ok(cards == ["tally", "zoho", "busy"], "three cards, from the list in the code: %s" % cards)
        ok(pg.locator('[data-integ="gst"]').count() == 0 and "GST portal" not in txt("#app"), "no GST card (FinCom's own backend, not something a firm sets up)")
        tl, zl, bl = txt('[data-integ="tally"] [data-integ-line]'), txt('[data-integ="zoho"] [data-integ-line]'), txt('[data-integ="busy"] [data-integ-line]')
        ok(tl == "2 computers · 1 company linked", "Tally (FinCom Bridge): %r" % tl)
        ok(zl == "Connected: 1 organisation", "Zoho Books: %r" % zl)
        ok(bl == "Coming soon" and pg.locator('[data-integ-open="busy"]').is_disabled() and "Busy partner" in txt('[data-integ="busy"]'), "Busy: coming soon, disabled, waiting on a Busy partner (%r)" % bl)
        ok(all(pg.locator('[data-integ="%s"] h3' % k).count() == 1 for k in cards) and pg.locator('[data-integ] svg').count() >= 3, "each card has its icon and name")
        no_secrets("the hub")

        # ---------------------------------------------------------------- 2. each card opens its page
        print("== 2. each card opens its page")
        pg.click('[data-integ-open="zoho"]'); pg.wait_for_timeout(1500)
        ok(E("location.hash") == "#/integrations/zoho" and pg.locator('[data-pane="integ-zoho"]').count() == 1, "Zoho Books opens #/integrations/zoho")
        ok(txt('[data-zoho-configured]') == "Yes", "FinCom's Zoho app set up: Yes (never the id)")
        row = '[data-zoho-conn="60012345678"]'
        ok(pg.locator(row).count() == 1 and "Zoho Co" in txt(row) and "FinCom Zoho Test Pvt Ltd" in txt(row), "the organisation and the FinCom client it feeds")
        acc = txt(row + " [data-zoho-access]")
        ok(acc.startswith("Connected · token valid until"), "access in words, never the token: %r" % acc)
        ok(txt(row + " [data-zoho-calls]") == "37 of 1,000", "today's calls against the limit: %r" % txt(row + " [data-zoho-calls]"))
        ok("1 posting error" in txt(row + " [data-zoho-error]"), "errors shown: %r" % txt(row + " [data-zoho-error]"))
        ok(pg.locator('[data-zoho-log="60012345678"]').count() == 1, "what FinCom did lately, per organisation")
        no_secrets("the Zoho Books page")
        pg.click('[data-integ-back]'); pg.wait_for_timeout(1000)
        ok(E("location.hash") == "#/integrations", "Back returns to the hub")
        pg.click('[data-integ-open="tally"]'); pg.wait_for_timeout(1500)
        ok(E("S.homeTab") == "tally", "Tally opens the Tally page (%s)" % E("location.hash"))
        go("#/integrations"); pg.click('[data-integ-open="busy"]', force=True); pg.wait_for_timeout(500)
        ok(E("location.hash") == "#/integrations", "Busy opens nothing yet")
        E("() => history.back()"); pg.wait_for_timeout(800); E("() => history.forward()"); pg.wait_for_timeout(800)

        # ---------------------------------------------------------------- 4. who may do what
        print("== 4. staff look, the owner connects and disconnects")
        go("#/integrations/zoho")
        for k in ("connect", "reconnect", "hook", "disconnect"):
            sel = '[data-zoho-%s]' % k
            ok(pg.locator(sel).count() >= 1 and pg.locator(sel).first.is_disabled(), "staff: %s is the owner's (disabled)" % k)
        ok(not pg.locator('[data-zoho-sync="60012345678"]').is_disabled(), "staff: Read now is allowed")
        pg.click('[data-zoho-sync="60012345678"]'); pg.wait_for_timeout(800)
        ok(len(calls("sync_now")) == 1, "Read now asks the function to read the organisation")
        scene("owner"); go("#/integrations"); go("#/integrations/zoho"); pg.wait_for_timeout(500)
        ok(all(not pg.locator('[data-zoho-%s]' % k).first.is_disabled() for k in ("connect", "reconnect", "hook", "disconnect")), "owner: Connect, Reconnect, Webhook address and Disconnect are enabled")
        pg.click('[data-zoho-connect]'); pg.wait_for_timeout(800)
        ok(len(calls("connect_start")) == 1 and calls("connect_start")[0][2].get("back", "").startswith("http://localhost"), "Connect asks the function for Zoho's own approval page, coming back here")
        pg.click('[data-zoho-hook="60012345678"]'); pg.wait_for_timeout(800)
        ok("hook=shown-once" in txt('[data-zoho-hook-url]'), "the webhook address shown once, with where to put it in Zoho")
        pg.click('[data-zoho-disconnect="60012345678"]'); pg.wait_for_timeout(500)
        ok(pg.locator('#confirmBox').is_visible() and "Nothing is deleted" in txt('#confirmBox'), "Disconnect asks first, and says nothing is deleted")
        pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
        ok(len(calls("disconnect")) == 1 and calls("disconnect")[0][2].get("connection") == "c-0001", "then asks the function to disconnect that organisation")
        no_secrets("after the owner's actions")

        # ---------------------------------------------------------------- 5. back from Zoho's sign-in
        print("== 5. back from Zoho's sign-in: choose the client")
        go("#/integrations/zoho?grant=g-0001"); pg.wait_for_timeout(800)
        orgs = E("() => [...document.querySelectorAll('[data-zoho-org]')].map(e => e.getAttribute('data-zoho-org'))")
        ok(orgs == ["60099999999"], "the organisations not linked yet: %s" % orgs)
        sel = '[data-zoho-org="60099999999"] [data-zoho-client]'
        pg.select_option(sel, zid); pg.click('[data-zoho-link="60099999999"]'); pg.wait_for_timeout(1000)
        lk = calls("link")
        ok(len(lk) == 1 and lk[0][2].get("grant") == "g-0001" and lk[0][2].get("org") == "60099999999" and lk[0][2].get("client") == zid, "Link sends the sign-in, the organisation and the client")
        scene("staff"); go("#/integrations"); go("#/integrations/zoho?grant=g-0001"); pg.wait_for_timeout(600)
        ok(pg.locator('[data-zoho-link="60099999999"]').is_disabled(), "staff cannot link")

        # ---------------------------------------------------------------- 6. Client setup: Books source
        print("== 6. Client setup → Tally: the Books source card")
        E("(c) => { openCompany(c).then(() => { S.tab = 'cotally'; render(); }); }", zid); pg.wait_for_timeout(1800)
        ok(E("() => document.querySelector('[data-books-source]') && document.querySelector('[data-books-source]').getAttribute('data-books-source')") == "zoho" and "Zoho Books organisation FinCom Zoho Test Pvt Ltd" in txt('[data-books-source]'),
           "a Zoho client: Books source Zoho Books, the organisation (%r)" % txt('[data-books-source]')[:120])
        ok(pg.locator('#app [data-tally-link]').count() == 0, "and no Link to Tally card for it")
        pg.click('[data-books-source-go="zoho"]'); pg.wait_for_timeout(1200)
        ok(E("location.hash") == "#/integrations/zoho", "its link opens the Zoho Books page")
        E("(c) => { openCompany(c).then(() => { S.tab = 'cotally'; render(); }); }", tid); pg.wait_for_timeout(1800)
        ok(E("() => (document.querySelector('[data-books-source]') || {getAttribute: () => ''}).getAttribute('data-books-source')") == "tally" and pg.locator('#app [data-books-source] [data-tally-one]').count() == 1 and pg.locator('#app [data-tally-link]').count() == 0,
           "a Tally client: Books source with its one Tally line (24-Oct-2026: linked on the Tally page only) (%r)" % txt('[data-books-source]')[:120])
        no_secrets("Client setup")

        # ---------------------------------------------------------------- 8. a Zoho client's books, as a Tally client's
        print("== 8. a Zoho client's books in FinCom, from the cloud copy, as a Tally client's")
        copy = json.load(open(os.path.join(HERE, "fixtures", "zoho", "copy-snapshot.json")))
        stub = open(os.path.join(HERE, "copy_rest_stub.js")).read().replace("module.exports = {restStub};", "window.__restStub = restStub;")
        E("(src) => { (0, eval)(src); }", stub)
        E("""([copy, cid]) => {
          const st = window.__restStub(copy.tables);
          const bk = {book: copy.book, company: "Zoho Books · FinCom Zoho Test Pvt Ltd", from: "2026-04-01", openAsOn: "2026-03-31", ledgersAt: "2026-10-13T05:00:00Z", daysAt: "2026-10-13T05:30:00Z", entries: 0, days: 0, to: null, state: {}, stateAt: null};
          Cloud.api = async (path) => (/^rpc\\/zoho_status/.test(path) ? {grants: [], connections: []} : st.api(path));
          TCloud.restAll = async (u) => st.api(u + (u.includes("limit=") ? "" : ""));
          TCloud.restPages = async (u) => st.api(u);
          TCloud.rpc = async (fn) => fn === "tally_status" ? [bk] : fn === "tally_days_list" ? [] : {ok: true};
          TCloud.rpcAll = async (fn) => fn === "tally_days_list" ? [] : [];
          TCloud.st[cid] = {};
          const c = S.companies[cid]; c.tan = "MUMF01234E";
        }""", [copy, zid])
        E("(c) => { S.books = null; return openCompany(c); }", zid); pg.wait_for_timeout(1500)
        E("(c) => TCloud.openLoad(c)", zid); pg.wait_for_timeout(2500)
        nb = E("() => S.books && S.books.vouchers ? S.books.vouchers.length : -1")
        ok(nb == 18 and E("() => (S.books.vouchers || []).every(v => v.src === 'bridge')"), "the Zoho client's books come in from the cloud copy as a Tally client's (%s entries)" % nb)
        go("#/c/%s/books/gst/27/202605/r3b" % zid); pg.wait_for_timeout(2500)
        t3 = txt("#app")
        ok("4,90,000" in t3 and "63,000" in t3 and "11,950" in t3, "the GST page: GSTR-3B May 2026, 3.1(a) 4,90,000 · IGST 63,000 · CGST 11,950 (as the answer key)")
        go("#/c/%s/books/gst/27/202605/r1" % zid); pg.wait_for_timeout(2000)
        t1 = txt("#app")
        ok("4,50,000" in t1 and "2,50,000" in t1 and "1,50,000" in t1, "the GST page: GSTR-1 May 2026 from the Zoho invoices: B2B 4,50,000, exports 2,50,000, B2C large 1,50,000")
        # next-tds-retchallans / next-tds-register (20-Oct-2026): a return opens on its Deductions step (its own challans;
        # with none yet, "N deductions pending" opens the Deductions register); the deductees are on the Deductees tab
        go("#/c/%s/books/tds/2026-27/Q1/26Q/deductees" % zid); pg.wait_for_timeout(2500)
        tt = txt("#app")
        ok("Omicron Contractors" in tt and "Pi Consultants" in tt and "₹2,000.00" in tt and "₹6,000.00" in tt,
           "the TDS page: Q1 2026-27 26Q has the Zoho bills' deductees (Deductees tab: Omicron Contractors ₹2,000, Pi Consultants ₹6,000)")
        go("#/c/%s/books/tds/2026-27/Q1/26Q" % zid); pg.wait_for_timeout(2000)
        pg.click('#app [data-wd-nochallan] button'); pg.wait_for_timeout(800)
        names = E("() => [...document.querySelectorAll('#app [data-dreg] [data-dreg-row]')].map(tr => tr.innerText.replace(/\\s+/g, ' '))")
        ok(len(names) == 2 and any("Omicron Contractors" in n for n in names) and any("Pi Consultants" in n for n in names),
           "the return's \"2 deductions pending\" opens the Deductions register with both bills' deductions (%s)" % names)
        no_secrets("a Zoho client's books")
        br.close()
    # ---------------------------------------------------------------- 7. TaxPro and ASP never reach a user
    print("== 7. the GSP's name in the app's built files")
    files = [f for f in glob.glob(os.path.join(SITE, "**", "*.js"), recursive=True) if not f.endswith(".map")]
    hits = []
    for f in files:
        s = open(f, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"TaxPro|\bASP\b", s):
            ctx = s[max(0, m.start() - 400): m.end() + 80]
            # allowed: the e-invoice set-up's own step, and the code that says a server message in FinCom's words
            allowed = ("In the list of GSPs" in ctx and "e-invoice portal" in s[max(0, m.start() - 1500): m.start()]) or "function gstWords(" in s[max(0, m.start() - 120): m.start()]
            if not allowed: hits.append(os.path.basename(f) + ": " + ctx[-160:].replace("\n", " "))
    ok(files and not hits, "the GSP's name only in the e-invoice set-up step (%d files; %s)" % (len(files), hits[:3]))
    steps = [f for f in files if "In the list of GSPs" in open(f, encoding="utf-8", errors="replace").read()]
    ok(len(steps) == 1, "the e-invoice set-up steps are there (einvoice1.gst.gov.in, Create API User, Through GSP)")
    src = os.path.join(HERE, "..")
    # (Supplier health, app/src/screens/gst/SupplierHealth.jsx, was taken out on purpose by next-itc-simple, 990293842: the
    # owner, 24-Oct-2026, "supplier health is not required"; the GSP's name in the built files is checked above)
    ok(not os.path.exists(os.path.join(src, "app/src/screens/gst/SupplierHealth.jsx")), "Supplier health is gone (next-itc-simple): no page left to name the GSP")
    for rel in ("app/src/screens/GstApiAll.jsx",):
        t = "\n".join(l for l in open(os.path.join(src, rel)).read().splitlines() if not l.lstrip().startswith("//"))     # (comments are never shown)
        ok("TaxPro" not in t and "FinCom" in t and "GST connection" in t, "%s says FinCom's GST connection, never the GSP" % rel)
    import subprocess
    r = subprocess.run(["node", "-e", """const {load, HTML} = require('./harness'); const {x} = load(HTML, ['gstWords']);
      console.log(JSON.stringify([x.gstWords("TaxPro's ASP id and password are not in Vault"), x.gstWords("TaxPro GSP: session ended"), x.gstWords("OTP wrong")]))"""], capture_output=True, text=True, cwd=HERE)
    w = json.loads((r.stdout or "[]").strip().splitlines()[-1] if r.stdout.strip() else "[]")
    ok(w == ["FinCom's GST connection id and password are not in Vault", "FinCom's GST connection: session ended", "OTP wrong"],
       "a server message naming the GSP is said in FinCom's words: %s" % w)
    errs = [e for e in errors if not re.search(r"supabase|Failed to fetch|NetworkError|example\.invalid", e, re.I)]
    ok(not errs, "no page errors (%s)" % errs[:3])
    print("all passed" if not fails else "%d FAILED" % len(fails))
    sys.exit(1 if fails else 0)
main()
