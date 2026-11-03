"""python3 run_tally_simple.py - the simple Tally page (02-Nov-2026, next-tally-simple; the owner's approved design "Tally —
Yes or No"; the owner, a CA: every word understandable by anyone; "no computer names like NWS144"). Made-up firm, clients,
companies and computers only (run_tally_page_clean.py's stand-in cloud; nothing real is read or changed).
  1. the guided box moves on by itself from real state: no bridge heard → step 1 (Download FinCom Bridge, the connect
     panel); a bridge, no company open that no client has → step 2 (I have opened it: the computers read again); a company
     open that no client has → step 3, "Connect it to client X?" (the best match by name, a split's date off), Yes,
     connect links the FULL Tally name in one call, Choose another client opens the picker; just linked → step 4; once a
     company is connected the box is small.
  2. the strip (a company is connected already): "Tally has a company open that is not connected: “<full name>”", one
     click "Connect to client “<best>”" links the full name; Choose another client opens the picker; + New client asks
     first (No: nothing made, nothing linked).
  3. the ONE table, each column Yes / No / Not yet / —, with its note: connected ("Tally company: …" / "Found in Tally:
     …"), open now ("Last opened …"), ledgers ("412 ledgers", "Changed in Tally today: 2 new or changed, 1 renamed",
     See ledgers), entries ("Till today …", held lines "10-Oct is missing" with Upload Day Book, "New client · 62%
     received · 6 min left" with its bar), what to do (one button at most, else "Nothing."), a company that no client has.
     The header says "N clients are fine. M need you." from the same rows. Check Tally now asks each connected client's
     day check (tally_check_request).
  3b. "Open in Tally right now?" is THIS browser's computer only (next-tally-local-open; the owner: "show me open in the
     tally where it is opened not on any other computer"): FinCom Bridge here answers and the company is open here → Yes;
     answers, not open here → No, "Not open in Tally on this computer"; no bridge reachable from this browser → —, "FinCom
     Bridge is not connected on this computer" and Connect (the local connect flow); another computer's bridge having the
     company open never makes it Yes. The header and the filter "Not open in Tally" follow the same meaning.
  3c. this FinCom user's OWN bridge only (next-tally-own-login; the owner: on the shared server each person's FinCom
     shows the Tally that person has opened in their own cloud login): the own bridge is the one paired in this browser, else
     the one the member is linked to; a local bridge answering with another Windows user is ignored; when no local bridge
     is the own one, the cloud copy of the own bridge's beat answers (Yes / No); its beat old: —, "Your FinCom Bridge is
     not connected now" and Connect; no own bridge: —, "Your FinCom Bridge is not set up." and Set it up (step 1); user
     A's page never shows user B's open company (no strip, no row, no step 3), and B's page does.
  4. opening balances (migration 138): same (green), differ (amber: N ledgers, ₹X in total; Use Tally's / Keep FinCom's;
     See differences: Ledger | FinCom amount | Tally amount | Difference), do not balance; Use Tally's refused in words
     when not dated the books' first day; the choices call tally_openings_decide; the filter "Opening balances differ".
  5. the filters (each count = the rows it shows) and the search (client or Tally company); "No client matches" with
     Show all.
  6. no computer's name or Windows login anywhere outside For support.
  7. For support: closed by default; open, it holds the page's former tools (this computer's card, the companies open with
     their ⋯, every client's Tally company, each computer, versions with hold and roll back, stop reading, every bridge,
     the bridge address and key, Check my Tally, the bridge log, the connection history, the install with its PowerShell
     line and fingerprint).
  3d. bridge 2.5.3 (next-tally-samesession; one FinCom login for every Windows login of a shared server): the page asks
     /ping on 127.0.0.1 at the firm's bridges' ports, 9103 and 9100..9110; the bridge saying sameSession true wins over the
     member link; one saying false is never shown; only one answering "unknown": used, "your bridge (not confirmed)"; none
     answering: the member link; a 2.5.2 bridge (no field): as before; tallyWhy / the port's reason and tallyConnectSay in
     plain words; Connect asks the bridge found.
  8. a phone 390 wide never scrolls sideways; light and dark.
Options: --shots DIR saves 1440x900 and 390x844, light and dark.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_simple.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 9537
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PC, WIN = "NWS144", "anshul"     # made-up; never on the page outside For support
ACME, BRIGHT, CORAL, DELTA, EVER, IRIS, GAMMA, HAZEL = "Acme Traders", "Bright Foods LLP", "Coral Exports", "Delta Services", "Evergreen Retail", "Iris Foods", "Gamma Agencies", "Hazel Mills"
SPLIT, ZETA = EVER + " 01 Apr 2018", "Zeta Mills"
LATEST = {"setup": {"version": "2.5.1", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.1.exe", "sha256": "ab" * 32}}
# the stand-in cloud's extra answers: the books' summary (the entries being brought), the openings (migration 138), the
# ledgers' changes today; and the link: a company linked is linked in the stand-in's companies
EXTRA = """([sum, open, rows, changes, heldSt]) => {
  window.__sum = sum; window.__open = open; window.__openRows = rows; window.__heldSt = heldSt || [];
  const rpc = TCloud.rpc;
  TCloud.rpc = async (fn, a) => {
    if (fn === 'tally_fetch_summary') { window.__calls.push([fn, a]); return {ok: true, books: JSON.parse(JSON.stringify(window.__sum))}; }
    if (fn === 'tally_check_ask_status') return {ok: true, asks: [], books: []};
    if (fn === 'tally_held_status') return {ok: true, books: JSON.parse(JSON.stringify(window.__heldSt))};
    if (fn === 'tally_openings_decide') { window.__calls.push([fn, JSON.parse(JSON.stringify(a))]);
      if (a.p_action === 'status') return {ok: true, books: JSON.parse(JSON.stringify(window.__open))};
      const b = window.__open.find(x => x.book === a.p_book);
      if (a.p_action === 'list') return {ok: true, book: Object.assign({}, b, {rows: window.__openRows})};
      window.__open = window.__open.map(x => x.book === a.p_book ? Object.assign({}, x, {held: null, n: 0, total: 0, ties: true}) : x);
      return {ok: true, changed: a.p_action === 'use' ? (b ? b.n : 0) : undefined, kept: a.p_action === 'keep' ? 1 : undefined}; }
    const r = await rpc(fn, a);
    if (fn === 'tally_company_link') window.__companies.forEach(c => { if (c.company === a.p_company) c.client_id = a.p_client; });
    return r;
  };
  const api = Cloud.api;
  Cloud.api = async (p, o) => {
    const m = /book_id=eq\\.([^&]+)/.exec(p), bk = m ? decodeURIComponent(m[1]) : '';
    if (/^tally_ledger_rounds/.test(p)) return (changes[bk] || {}).rounds || [];
    if (/^tally_ledgers\\?select=name&book_id=.*renamed_at/.test(p)) return (changes[bk] || {}).renamed || [];
    return api(p, o);
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  FCTallySimple.OPEN.at = 0; FCTallySimple.OPEN.books = null; FCTallySimple.OPEN.off = false; FCTallySimple.JUST.linked = null; FCTallySimple.JUST.at = 0; FCTallySimple.forget();
  S.tsm = null; S.tallyMore = {}; if (Rec.heldReload) Rec.heldReload();
  if (window.tfxRefresh) window.tfxRefresh();
  render();
}"""

# this browser's FinCom Bridge (made-up key; nothing is sent anywhere): open = the companies Tally has open on THIS
# computer, as the bridge's own minute check last said (Bridge.st.open); None = no bridge reachable from this browser
# user: the Windows user the bridge says it runs for; bid: the bridge id this browser holds (its pairing)
LOCAL = """([open, user, bid]) => {
  const B = window.__bridge0 = window.__bridge0 || {on: Bridge.on, up: Bridge.up, cfg: Bridge.cfg, refresh: Bridge.refresh};
  if (open === null) { Object.assign(Bridge, B); Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: ''}; }
  else { const c = {url: 'http://127.0.0.1:9103', key: 'made-up-key', follow: false, port: 0, bridgeId: bid || ''};
    Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => true; Bridge.refresh = async () => Bridge.st;
    Bridge.st = {state: 'ok', sessions: [], tallyUp: true, version: '2.5.2', at: Date.now(), mode: 'auto', user: user || '', open: open.map(n => ({name: n, port: 9000, mine: true}))}; }
  render();
}"""
# whose bridge is this FinCom user's own (made-up member id): ['linked', bridge, device] the member's link (tally_member_bridges),
# ['paired', bridge] paired in this browser (its key and bridge id held here, the bridge not answering), [null] none
MINE = """([how, bid, dev]) => {
  const B = window.__bridge0 = window.__bridge0 || {on: Bridge.on, up: Bridge.up, cfg: Bridge.cfg, refresh: Bridge.refresh};
  const T0 = window.__tme0 = window.__tme0 || {me: TCloud.me};
  Object.assign(Bridge, B); Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: ''}; TCloud.me = T0.me;
  window.__links = [];
  if (how === 'linked') { TCloud.me = () => 'made-up-member-a'; window.__links = [{user_id: 'made-up-member-a', device_id: dev, bridge_id: bid}]; }
  if (how === 'paired') { const c = {url: 'http://127.0.0.1:9104', key: 'made-up-key', follow: false, port: 0, bridgeId: bid};
    Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => false; Bridge.refresh = async () => Bridge.st;
    Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: 'not answering'}; }
  if (!window.__linksApi) { window.__linksApi = true; const api = Cloud.api;
    Cloud.api = async (p, o) => /^tally_member_bridges/.test(p) ? JSON.parse(JSON.stringify(window.__links)) : api(p, o); }
  TCloud.pane.links = JSON.parse(JSON.stringify(window.__links));
  render();
}"""
# bridge 2.5.3: what /ping answers on 127.0.0.1 at each port (made-up; nothing listens): {port: reply}; the page's look
# here (FCTallySimple.LOCALB) is started again (asked now, as Connect asks it: a drawing never asks)
PINGS = """(pings) => {
  window.__pings = pings || {}; window.__probed = [];
  Bridge.probe = async (port, ms) => { window.__probed.push(port); const j = window.__pings[String(port)];
    return j ? Object.assign({port, url: 'http://127.0.0.1:' + port}, j, {proven: false, pairProven: false}) : null; };
  Object.assign(FCTallySimple.LOCALB, {list: null, busy: false, at: 0, ports: '', sig: '', n: 1});
  FCTallySimple.rescanLocal(); render();
}"""
def ping(port, same, user, version="2.5.3", **kw):
    r = {"ok": True, "bridge": "FinCom Tally Bridge", "version": version, "impl": "go", "runMode": "user", "pid": 1234, "loopSec": 3, "yours": same is True,
         "windowsUser": user, "bridgePort": port, "tallyPorts": [9070], "tallyPortsUnknown": []}
    if same is not None: r["sameSession"] = same
    r.update(kw); return r
NOT_MINE, AWAY, NOT_SET = "Not open in your Tally", "Your FinCom Bridge is not connected now", "Your FinCom Bridge is not set up."

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, scheme="light"):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            pg.set_default_timeout(8000)
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        links = lambda: [c[1] for c in E("window.__calls") if c[0] == "tally_company_link"]
        calls = lambda fn: [c[1] for c in E("window.__calls") if c[0] == fn]
        def scene(devs, cos, clients, books=None, lines=(), sum_=None, open_=None, rows=None, changes=None, ledgers=None, role="owner", held=None, own=None, pings=None):
            ids = E(T.SETUP, [devs, cos, list(lines), role, clients, True, books or {}])
            E("() => { window.__linksApi = false; }")
            if ledgers: E("(l) => { Object.assign(window.__ledgers, l); }", ledgers)
            fix = lambda xs: [dict(x, client=ids.get(x.get("client"), x.get("client"))) for x in (xs or [])]
            E(EXTRA, [fix(sum_), open_ or [], rows or [], changes or {}, fix(held)])
            E(PINGS, pings or {})
            # this member's own bridge: the first computer's, linked to the member, unless the scene says otherwise
            E(MINE, own if own is not None else (["linked", devs[0]["main_bridge"], devs[0]["id"]] if devs else [None, "", ""])); pg.wait_for_timeout(2600)
            return ids
        def confirm(yes):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); body = txt("#confirmBox"); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(600); return body
        def row(name): return '#app [data-tsm-table] tr[data-tsm-row="%s"]' % name
        def cell(name, k): return row(name) + ' [data-tsm-col="%s"]' % k
        def word(name, k): return pg.get_attribute(cell(name, k) + " [data-tsm-word]", "data-tsm-word") if n(cell(name, k) + " [data-tsm-word]") else None
        def steps(): return E("() => [...document.querySelectorAll('#app [data-tsm-guide] [data-tsm-step]')].map(e => [e.getAttribute('data-tsm-step'), e.hasAttribute('data-now'), e.hasAttribute('data-done')])")
        def main_text(): return E("() => { const a = document.querySelector('#app').cloneNode(true); a.querySelectorAll('[data-for-support]').forEach(e => e.remove()); return a.innerText; }")
        def shot(name, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)

        print("== 1. the guided box, from real state")
        scene([], [], [ACME, EVER])
        g = "#app [data-tsm-guide]"
        ok(pg.get_attribute(g, "data-tsm-guide") == "1" and steps() == [["1", True, False], ["2", False, False], ["3", False, False], ["4", False, False]], "1. no bridge heard: step 1 current, nothing ticked (%s)" % steps())
        ok(txt("#app [data-tsm-now]") == "Step 1: download FinCom Bridge and install it on the computer that has Tally." and txt(g + " [data-tsm-download]") == "Download FinCom Bridge"
           and (pg.get_attribute(g + " [data-tsm-download]", "href") or "").startswith("assets/bridge-go/FinComBridge-Setup-2.5.1.exe?v="), "1. step 1: one sentence, Download FinCom Bridge (this site's setup)")
        ok(n(g + " [data-tsm-panel]") == 1, "1. step 1: the connect panel (open it, type its code) under the box")
        ok(n("#app [data-tsm-strip]") == 0 and "none connected" in txt("#app [data-tsm-pcs]"), "1. no strip; Computers with Tally: none connected (%s)" % txt("#app [data-tsm-pcs]"))
        hd = txt("#app [data-tsm-head]")
        ok(hd.startswith("Tally") and "Check Tally now" in hd and n("#app [data-tsm-check]") == 1, "1. the header: Tally, the sentence, Check Tally now (%s)" % hd)

        d = T.dev(7, PC, WIN, tally="open", opened=(), version="2.5.1", rec=())
        scene([d], [], [ACME, EVER])
        ok(pg.get_attribute(g, "data-tsm-guide") == "2" and steps()[0] == ["1", False, True] and steps()[1] == ["2", True, False], "1. a bridge, nothing open: step 2, step 1 ticked (%s)" % steps())
        ok(txt("#app [data-tsm-now]") == "Step 2: FinCom Bridge is installed. Now open your company in Tally. This box moves on by itself when it sees the company.", "1. step 2's sentence")
        r0 = E("window.__reads"); pg.click(g + ' [data-tsm-go="opened"]'); pg.wait_for_timeout(1500)
        ok(E("window.__reads") > r0, "1. I have opened it: the computers are read again (%d -> %d)" % (r0, E("window.__reads")))

        d = T.dev(7, PC, WIN, tally="open", opened=(SPLIT,), version="2.5.1", rec=(SPLIT,))
        ids = scene([d], [{"company": SPLIT, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"}], [ACME, EVER])
        ok(pg.get_attribute(g, "data-tsm-guide") == "3" and [s[2] for s in steps()] == [True, True, False, False], "1. a company open that no client has: step 3, steps 1 and 2 ticked (%s)" % steps())
        ok(txt("#app [data-tsm-now]") == "Step 3: Tally has “%s” open. Connect it to client “%s”?" % (SPLIT, EVER), "1. step 3: the full Tally name, the client of its name (%s)" % txt("#app [data-tsm-now]"))
        ok(n("#app [data-tsm-strip]") == 0, "1. step 3 says it: no strip as well")
        pg.click(g + " [data-tsm-go-choose]"); pg.wait_for_timeout(500)
        ok(n(g + " [data-tsm-guide-pick] select[data-tco-relink-pick]") == 1, "1. Choose another client: the picker of the clients")
        E("() => { window.__calls = []; }")
        pg.click(g + ' [data-tsm-go="connect"]'); pg.wait_for_timeout(2500)
        ok([x for x in links() if x.get("p_client")] == [{"p_company": SPLIT, "p_client": ids[EVER]}], "1. Yes, connect: ONE link, the full Tally name to %s (%s)" % (EVER, links()))
        ok(pg.get_attribute(g, "data-tsm-guide") == "4" and txt("#app [data-tsm-now]").startswith("Connected. Ledgers, opening balances and entries are coming in by themselves.") and n(g + " [data-tsm-go]") == 0,
           "1. just linked: step 4, no button (%s)" % txt("#app [data-tsm-now]"))
        shot("guide-step4")

        print("== 2. the strip, next time")
        d = T.dev(7, PC, WIN, tally="open", opened=(ACME, SPLIT), version="2.5.1", rec=(ACME,))
        cos = [{"company": ACME, "client_id": "NAME:" + ACME, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"},
               {"company": SPLIT, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"}]
        ids = scene([d], cos, [ACME, EVER])
        st = "#app [data-tsm-strip]"
        ok(n(g + "[data-tsm-collapsed]") == 1 and "Show the steps" in txt(g), "2. a company connected already: the box is small (%s)" % txt(g))
        ok(txt(st + " .tsm-strip-words") == "Tally has a company open that is not connected: “%s”" % SPLIT and pg.get_attribute(st, "data-tsm-strip") == SPLIT, "2. the strip names the full Tally name (%s)" % txt(st))
        ok(txt(st + " [data-tsm-strip-connect]") == "Connect to client “%s”" % EVER, "2. one click: Connect to client “%s”" % EVER)
        pg.click(st + " [data-tsm-strip-choose]"); pg.wait_for_timeout(500)
        ok(n(st + " select[data-tco-relink-pick]") == 1 and n(st + " [data-tco-add-new]") == 1, "2. Choose another client: the picker, + New client with this name beside it")
        n0 = E("() => Object.values(S.companies).filter(c => c && !c.deleted).length"); E("() => { window.__calls = []; }")
        pg.click(st + " [data-tco-add-new]"); body = confirm(False)
        ok("separate client" in body and EVER in body and E("() => Object.values(S.companies).filter(c => c && !c.deleted).length") == n0 and links() == [], "2. + New client asks first; No: nothing made, nothing linked (%s)" % body[:160])
        pg.click(st + " [data-tsm-strip-connect]"); pg.wait_for_timeout(2500)
        ok([x for x in links() if x.get("p_client")] == [{"p_company": SPLIT, "p_client": ids[EVER]}], "2. Connect: ONE link, the full name (%s)" % links())
        ok(n(st) == 0, "2. connected: the strip goes")

        print("== 3. the table")
        d = T.dev(7, PC, WIN, tally="open", opened=(ACME, CORAL, SPLIT, ZETA, IRIS, HAZEL), version="2.4.7", rec=(ACME, CORAL, IRIS, HAZEL))
        cos = [{"company": c, "client_id": "NAME:" + c, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"} for c in (ACME, CORAL, IRIS, HAZEL)] + \
              [{"company": BRIGHT, "client_id": "NAME:" + BRIGHT, "device_id": d["id"], "gstin": "", "last_seen": "ago:300"},
               {"company": GAMMA, "client_id": "NAME:" + GAMMA, "device_id": d["id"], "gstin": "", "last_seen": "ago:2000"},
               {"company": DELTA, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:3000"},
               {"company": SPLIT, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"},
               {"company": ZETA, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"}]
        books = {ACME: T.book(ACME), BRIGHT: T.book(BRIGHT), CORAL: T.book(CORAL, days=False), IRIS: T.book(IRIS), HAZEL: T.book(HAZEL)}
        HELD = [dict(T.held(200 + i, BRIGHT), vch_date="2026-10-10") for i in range(2)]
        SUM = [{"book": "bk-" + CORAL, "client": CORAL, "company": CORAL, "from": "2026-04-01", "devices": [{"id": d["id"], "fetchOn": True}],
                "pull": {"state": "going", "done": False, "fy": "20260401", "part": "year", "x": 620, "y": 1000, "etaMin": 6, "pace": True}, "today": {}}] + \
              [{"book": "bk-" + c, "client": c, "company": c, "from": "2026-04-01", "devices": [{"id": d["id"], "fetchOn": True}], "today": {}} for c in (ACME, BRIGHT, IRIS, HAZEL)]
        OPEN = [{"book": "bk-" + ACME, "from": "2026-04-01", "stored": 0, "nonzero": 12, "ties": True, "held": None, "n": 0, "total": 0},
                {"book": "bk-" + BRIGHT, "from": "2026-04-01", "stored": 0, "nonzero": 9, "ties": True, "held": 41, "dated": True, "openingsAt": "2026-04-01", "n": 2, "total": 800, "candidate": 0, "missing": 0, "pl": 0},
                {"book": "bk-" + CORAL, "from": "2026-04-01", "stored": 0, "nonzero": 5, "ties": True, "held": None, "n": 0, "total": 0},
                {"book": "bk-" + HAZEL, "from": "2026-04-01", "stored": -12500, "nonzero": 5, "ties": False, "held": None, "n": 0, "total": 0},
                {"book": "bk-" + IRIS, "from": "2026-04-01", "stored": 0, "nonzero": 4, "ties": True, "held": 42, "dated": False, "openingsAt": None, "n": 1, "total": 1500, "candidate": 0, "missing": 0, "pl": 0}]
        DIFFS = [{"ledger": "Capital", "fincom": 500, "tally": 900, "diff": 400}, {"ledger": "Cash", "fincom": -500, "tally": -900, "diff": -400}]
        CHG = {"bk-" + ACME: {"rounds": [{"rows_received": 3, "rows_read": 412, "complete": True}], "renamed": [{"name": "Made-up Renamed Ledger"}]}}
        HELD136 = [{"book": "bk-" + BRIGHT, "client": BRIGHT, "company": BRIGHT, "held": 5, "from": "20261012", "to": "20261013", "check": {"state": "checking", "total": 2, "done": 1, "waiting": 1, "etaMin": 2}, "fetchOn": True, "renumber": []}]
        ids = scene([d], cos, [ACME, BRIGHT, CORAL, DELTA, EVER, IRIS, GAMMA, HAZEL], books=books, lines=HELD, sum_=SUM, open_=OPEN, rows=DIFFS, changes=CHG, held=HELD136,
                    ledgers={"bk-" + ACME: [{"name": "L%d" % i} for i in range(412)], "bk-" + BRIGHT: [{"name": "L%d" % i} for i in range(286)], "bk-" + IRIS: [{"name": "L%d" % i} for i in range(40)]})
        HERE = [ACME, CORAL, IRIS, HAZEL, ZETA]     # open in Tally on THIS computer (and on the firm's computer d)
        E(LOCAL, [HERE, PC + "\\" + WIN, "go-7"]); pg.wait_for_timeout(2500)
        names = E("() => [...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(e => e.getAttribute('data-tsm-row'))")
        ok(names == [ACME, BRIGHT, CORAL, DELTA, EVER, GAMMA, HAZEL, IRIS, ZETA], "3. one row a client (by name), then the company no client has (%s)" % names)
        heads = E("() => [...document.querySelectorAll('#app [data-tsm-table] thead th')].map(e => e.innerText.trim())")
        ok(heads == ["Client", "Connected to Tally?", "Open in Tally right now?", "Ledgers received?", "All entries received?", "What to do"], "3. the six questions (%s)" % heads)
        ok([word(ACME, k) for k in "cole"] == ["Yes"] * 4 and txt(cell(ACME, "c") + " [data-tsm-note]") == "Tally company: " + ACME and txt(cell(ACME, "do")) == "Nothing.", "3. %s: Yes Yes Yes Yes, Nothing. (%s)" % (ACME, txt(row(ACME))))
        ok("412 ledgers" in txt(cell(ACME, "l")) and txt(cell(ACME, "l") + " [data-tsm-lchange]") == "Changed in Tally today: 2 new or changed, 1 renamed" and n(cell(ACME, "l") + " [data-tsm-ledgers]") == 1,
           "3. ledgers: the count, today's change in Tally, See ledgers (%s)" % txt(cell(ACME, "l")))
        ok(re.match(r"Till today \d\d:\d\d$", txt(cell(ACME, "e") + " [data-tsm-note]") or ""), "3. entries: Till today <time> (%s)" % txt(cell(ACME, "e")))
        ok(word(BRIGHT, "o") == "No" and txt(cell(BRIGHT, "o") + " [data-tsm-note]") == NOT_MINE, "3. %s: not open in this user's Tally: No, %s (%s)" % (BRIGHT, NOT_MINE, txt(cell(BRIGHT, "o"))))
        ok(word(BRIGHT, "e") == "No" and txt(cell(BRIGHT, "e") + " [data-tsm-note]") == "12-Oct to 13-Oct are missing · FinCom is checking them with Tally now (50%)" and txt(cell(BRIGHT, "do") + ' [data-tsm-act="upload"]') == "Upload Day Book"
           and txt(cell(BRIGHT, "do") + " [data-tsm-todo]") == "5 changes saved in Tally are not in FinCom yet. Upload the Day Book for those days.",
           "3. held lines (migration 136): All entries received? No, the period, the row's button Upload Day Book (%s | %s)" % (txt(cell(BRIGHT, "e")), txt(cell(BRIGHT, "do"))))
        ok(n("#app [data-tally-simple] [data-held-block]") == 0, "3. the held lines are the row's, not a block of their own")
        ok(word(CORAL, "e") == "Not yet" and txt(cell(CORAL, "e") + " [data-tsm-note]") == "New client · 62% received · 6 min left" and pg.get_attribute(cell(CORAL, "e") + " [role=progressbar]", "aria-valuenow") == "62",
           "3. being brought: Not yet, New client · 62%% received · 6 min left, the bar (%s)" % txt(cell(CORAL, "e")))
        ok(txt(cell(CORAL, "do") + " [data-tsm-todo]") == "Nothing. It is coming in by itself." and n(cell(CORAL, "do") + " [data-tsm-upload]") == 1, "3. coming in by itself, or upload the file yourself (%s)" % txt(cell(CORAL, "do")))
        ok(word(DELTA, "c") == "No" and txt(cell(DELTA, "c") + " [data-tsm-note]") == "Found in Tally: “%s”" % DELTA and [word(DELTA, k) for k in "ole"] == ["—"] * 3 and txt(cell(DELTA, "do") + " [data-tsm-act]") == "Connect",
           "3. not connected, found in Tally: No, —, Connect (%s)" % txt(row(DELTA)))
        ok(txt(cell(EVER, "c") + " [data-tsm-note]") == "Found in Tally: “%s”" % SPLIT, "3. a split is found by its client's name, said in full (%s)" % txt(cell(EVER, "c")))
        ok(word(GAMMA, "l") == "Not yet" and word(GAMMA, "e") == "Not yet" and word(GAMMA, "o") == "No" and txt(cell(GAMMA, "do") + " [data-tsm-todo]") == "Open the company in Tally.", "3. linked, nothing received yet: Not yet (%s)" % txt(row(GAMMA)))
        ok(pg.get_attribute(row(ZETA), "data-tsm-kind") == "company" and "Not chosen yet" in txt(cell(ZETA, "client")) and txt(cell(ZETA, "c") + " [data-tsm-note]") == "Open in Tally: “%s”" % ZETA and txt(cell(ZETA, "do") + " [data-tsm-act]") == "Choose the client",
           "3. a company no client has: Not chosen yet, Choose the client (%s)" % txt(row(ZETA)))
        acts = E("() => [...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(r => r.querySelectorAll('[data-tsm-col=do] .btn').length)")
        ok(max(acts) <= 1, "3. at most one button in What to do (%s)" % acts)
        need, fine = n("#app [data-tsm-table] tr[data-tsm-need]"), n("#app [data-tsm-table] tr[data-tsm-fine]")
        ok(txt("#app [data-tsm-say]") == "%s %s" % ("1 client is fine." if fine == 1 else "%d clients are fine." % fine, "1 needs you." if need == 1 else "%d need you." % need) and fine == 1, "3. the header from the rows (%s; %d fine, %d need)" % (txt("#app [data-tsm-say]"), fine, need))
        E("() => { window.__calls = []; }"); pg.click("#app [data-tsm-check]"); pg.wait_for_timeout(2500)
        cr = calls("tally_check_request")
        ok(sorted(x["p_client"] for x in cr) == sorted(ids[c] for c in (ACME, BRIGHT, CORAL, IRIS, HAZEL)) and all(x["p_from"] == "2026-04-01" for x in cr), "3. Check Tally now: each connected client's day check, this year so far (%s)" % cr)
        shot("tally-1440-light")

        print("== 3b. Open in Tally right now? on THIS computer only")
        def col_o(): return E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(r => [r.getAttribute('data-tsm-row'), (r.querySelector('[data-tsm-col=o] [data-tsm-word]') || {}).textContent || '']))")
        def fcount(k): return int(pg.get_attribute('#app [data-tsm-filter="%s"]' % k, "data-tsm-count"))
        def say_ok():
            nd, fn = n("#app [data-tsm-table] tr[data-tsm-need]"), n("#app [data-tsm-table] tr[data-tsm-fine]")
            return txt("#app [data-tsm-say]") == "%s %s" % ("1 client is fine." if fn == 1 else "%d clients are fine." % fn, "1 needs you." if nd == 1 else "%d need you." % nd)
        connected = [ACME, BRIGHT, CORAL, IRIS, GAMMA, HAZEL]
        ok(word(ACME, "o") == "Yes" and txt(cell(ACME, "o") + " [data-tsm-note]") == "" and n(cell(ACME, "o") + " [data-tsm-local-connect]") == 0, "3b. the bridge here answers, %s open here: Yes (%s)" % (ACME, txt(cell(ACME, "o"))))
        ok(fcount("closed") == 2 and say_ok(), "3b. Not open in Tally: the 2 connected clients not open here (%d); the header from the same rows (%s)" % (fcount("closed"), txt("#app [data-tsm-say]")))
        # this user's own bridge answers here (its Windows user, its id) with nothing open: its answer, not the beat's
        E(LOCAL, [[], PC + "\\" + WIN, "go-7"]); pg.wait_for_timeout(1200)
        o = col_o()
        ok(o[ACME] == "No" and txt(cell(ACME, "o") + " [data-tsm-note]") == NOT_MINE and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-from") == "here",
           "3b. the own bridge here says nothing is open: %s is No, %s (%s)" % (ACME, NOT_MINE, txt(cell(ACME, "o"))))
        ok("Yes" not in o.values() and all(o[c] == "No" for c in connected) and ZETA not in o, "3b. no Yes, and the company no client has is not this user's open one any more (%s)" % o)
        ok(fcount("closed") == len(connected) and say_ok(), "3b. Not open in Tally counts this user's Tally only (%d); the header follows (%s)" % (fcount("closed"), txt("#app [data-tsm-say]")))
        ok(txt(cell(GAMMA, "do") + " [data-tsm-todo]") == "Open the company in Tally." and word(ACME, "c") == "Yes", "3b. what to do and Connected to Tally? stay as they were (%s)" % txt(cell(GAMMA, "do")))
        # a local bridge answering on 127.0.0.1 with ANOTHER Windows user (made-up), even holding this id: ignored; the own
        # bridge's beat in FinCom's cloud answers instead
        E(LOCAL, [[BRIGHT, GAMMA], PC + "\\made-up-other", "go-7"]); pg.wait_for_timeout(1200)
        o = col_o()
        ok(o[BRIGHT] == "No" and o[GAMMA] == "No" and o[ACME] == "Yes" and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-from") == "beat",
           "3b. a local bridge of another Windows user is ignored: its %s / %s are not Yes; the own beat says %s Yes (%s)" % (BRIGHT, GAMMA, ACME, o))
        # no bridge answers this browser (the owner's laptop): the own bridge's beat (every 30 s) answers
        E(LOCAL, [None, "", ""]); pg.wait_for_timeout(1200)
        o = col_o()
        ok(o[ACME] == "Yes" and o[BRIGHT] == "No" and txt(cell(BRIGHT, "o") + " [data-tsm-note]") == NOT_MINE and o[ZETA] == "Yes" and n("#app [data-tsm-local-connect]") == 0
           and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-from") == "beat", "3b. the beat fallback: Yes / No from the own bridge's beat, no Connect (%s)" % o)
        ok(fcount("closed") == 2 and say_ok(), "3b. the beat fallback: Not open in Tally 2, the header follows (%d, %s)" % (fcount("closed"), txt("#app [data-tsm-say]")))
        # the own bridge's beat is old (not heard for 10 minutes): —, not connected now, and Connect (the local connect flow)
        E("""() => { const old = new Date(Date.now() - 10 * 60000).toISOString(); window.__beatAt = window.__beatAt || {};
          [].concat(window.__devs, TLight.st.devs || [], TCloud.pane.devices || []).forEach(d => { if (!d || !d.info) return; window.__beatAt[d.id] = window.__beatAt[d.id] || d.info.beat.at;
            d.info.beat.at = old; Object.values(d.info.bridges || {}).forEach(b => { b.at = old; }); }); render(); }"""); pg.wait_for_timeout(1200)
        o = col_o()
        ok(o[ACME] == "—" and txt(cell(ACME, "o") + " [data-tsm-note]") == AWAY and txt(cell(ACME, "o") + " [data-tsm-local-connect]") == "Connect", "3b. its beat old: —, %s, Connect (%s)" % (AWAY, txt(cell(ACME, "o"))))
        ok("Yes" not in o.values() and all(o[c] == "—" for c in connected) and fcount("closed") == 0 and say_ok(), "3b. its beat old: nothing Yes, nothing counted as Not open (%s)" % o)
        ok(word(DELTA, "o") == "—" and n(cell(DELTA, "o") + " [data-tsm-local-connect]") == 0, "3b. a client not connected keeps its plain — (no Connect there)")
        pg.click(cell(ACME, "o") + " [data-tsm-local-connect]")
        try: pg.wait_for_selector(cell(ACME, "o") + " [data-oc-say]", timeout=20000)
        except Exception: pass
        ok(n(cell(ACME, "o") + " [data-oc-say]") == 1 and n(cell(BRIGHT, "o") + " [data-oc-say]") == 0, "3b. Connect runs this computer's connect, its answer under that row only (%s)" % txt(cell(ACME, "o")))
        E("""() => { const now = new Date().toISOString(); [].concat(window.__devs, TLight.st.devs || [], TCloud.pane.devices || []).forEach(d => { if (!d || !d.info) return;
            d.info.beat.at = now; Object.values(d.info.bridges || {}).forEach(b => { b.at = now; }); }); render(); }""")
        E(LOCAL, [HERE, PC + "\\" + WIN, "go-7"]); pg.wait_for_timeout(1200)
        ok(word(ACME, "o") == "Yes" and word(BRIGHT, "o") == "No" and n("#app [data-tsm-local-connect]") == 0, "3b. the own bridge here again: Yes / No, no Connect")
        # no bridge of this user's own (nothing paired here, no link): —, not set up, Set it up; the guided box at step 1
        E(LOCAL, [None, "", ""]); E(MINE, [None, "", ""]); pg.wait_for_timeout(1500)
        o = col_o()
        ok(o[ACME] == "—" and txt(cell(ACME, "o") + " [data-tsm-note]") == NOT_SET and txt(cell(ACME, "o") + " [data-tsm-setup]") == "Set it up" and n("#app [data-tsm-local-connect]") == 0,
           "3b. no own bridge: —, %s, Set it up (%s)" % (NOT_SET, txt(cell(ACME, "o"))))
        ok("Yes" not in o.values() and ZETA not in o and n("#app [data-tsm-strip]") == 0 and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") == "1",
           "3b. no own bridge: no Yes from another login's Tally, no company row or strip of theirs, the guided box at step 1 (%s)" % o)
        pg.click(cell(ACME, "o") + " [data-tsm-setup]"); pg.wait_for_timeout(1200)
        ok(n("#app [data-tsm-guide][data-tsm-forced]") == 1 and n("#app [data-tsm-guide] [data-tsm-panel]") == 1, "3b. Set it up: the pairing steps (step 1, the connect panel)")
        E("() => { S.tallyGuide = {}; S.tsm = null; render(); }")
        # paired in this browser (its key and id held here, the bridge itself not answering): that bridge's beat
        E(MINE, ["paired", "go-7", ""]); pg.wait_for_timeout(1500)
        ok(word(ACME, "o") == "Yes" and word(BRIGHT, "o") == "No" and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own") == "ok", "3b. paired in this browser: its bridge's beat answers (%s)" % col_o())
        E(MINE, ["linked", "go-7", d["id"]]); E(LOCAL, [HERE, PC + "\\" + WIN, "go-7"]); pg.wait_for_timeout(1500)

        print("== 4. opening balances")
        ok(pg.get_attribute(cell(ACME, "l") + " [data-tsm-open]", "data-tsm-open") == "same" and txt(cell(ACME, "l") + " [data-tsm-open-words]") == "Opening balances: same as Tally", "4. same: green, same as Tally")
        ow = cell(BRIGHT, "l") + " [data-tsm-open]"
        ok(txt(ow + " [data-tsm-open-words]") == "Opening balances differ from Tally: 2 ledgers, ₹800 in total" and n(ow + " [data-tsm-open-use]:not([disabled])") == 1 and n(ow + " [data-tsm-open-keep]") == 1, "4. differ: the words, Use Tally's and Keep FinCom's (%s)" % txt(ow))
        ok(txt(cell(HAZEL, "l") + " [data-tsm-open-words]") == "Opening balances do not balance: debit and credit differ by ₹12,500" and txt(cell(HAZEL, "do") + " [data-tsm-todo]") == "Check the opening balances in See ledgers.",
           "4. do not balance, said in What to do too (%s | %s)" % (txt(cell(HAZEL, "l")), txt(cell(HAZEL, "do"))))
        ok(n(cell(IRIS, "l") + " [data-tsm-open-use][disabled]") == 1 and "not dated the day FinCom’s books begin" in txt(cell(IRIS, "l") + " [data-tsm-open-why]"), "4. Use Tally's refused in words when not dated the books' first day (%s)" % txt(cell(IRIS, "l")))
        pg.click(ow + " [data-tsm-open-see]"); pg.wait_for_timeout(1200)
        dh = E("() => [...document.querySelectorAll('#app [data-tsm-diffs] thead th')].map(e => e.innerText.trim())")
        dr = E("() => [...document.querySelectorAll('#app [data-tsm-diffs] tbody tr')].map(r => [...r.cells].map(c => c.innerText.trim()))")
        ok(dh == ["Ledger", "FinCom amount", "Tally amount", "Difference"] and dr == [["Capital", "500.00 Cr", "900.00 Cr", "400.00 Cr"], ["Cash", "500.00 Dr", "900.00 Dr", "400.00 Dr"]], "4. See differences: Ledger | FinCom | Tally | Difference (%s %s)" % (dh, dr))
        flt = E("() => { const b = document.querySelector('#app [data-tsm-filter=opendiff]'); return b ? [b.innerText, b.getAttribute('data-tsm-count')] : null; }")
        ok(flt == ["Opening balances differ 3", "3"], "4. the filter Opening balances differ (%s)" % flt)
        E("() => { window.__calls = []; }"); pg.click(ow + " [data-tsm-open-use]"); body = confirm(True); pg.wait_for_timeout(1500)
        ok({"p_book": "bk-" + BRIGHT, "p_action": "use"} in calls("tally_openings_decide") and "2 ledgers’ opening balances" in body, "4. Use Tally's: asked once, then tally_openings_decide use (%s)" % body[:120])
        ok(pg.get_attribute(cell(BRIGHT, "l") + " [data-tsm-open]", "data-tsm-open") == "same", "4. then: same as Tally")
        pg.click(cell(IRIS, "l") + " [data-tsm-open-keep]"); confirm(True); pg.wait_for_timeout(1500)
        ok({"p_book": "bk-" + IRIS, "p_action": "keep"} in calls("tally_openings_decide"), "4. Keep FinCom's: tally_openings_decide keep")

        print("== 5. filters and search")
        def shown(): return E("() => [...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(e => e.getAttribute('data-tsm-row'))")
        for k in ("all", "need", "notconn", "closed", "missing", "ledchg", "opendiff", "fine"):
            if not n('#app [data-tsm-filter="%s"]' % k): ok(False, "5. the filter %s is there" % k); continue
            c = int(pg.get_attribute('#app [data-tsm-filter="%s"]' % k, "data-tsm-count")); pg.click('#app [data-tsm-filter="%s"]' % k); pg.wait_for_timeout(300)
            s = shown(); ok(len(s) == c and pg.get_attribute('#app [data-tsm-filter="%s"]' % k, "aria-pressed") == "true", "5. %s: %d rows, as its count (%s)" % (k, c, s))
        pg.click('#app [data-tsm-filter="notconn"]'); pg.wait_for_timeout(300)
        ok(shown() == [DELTA, EVER, ZETA], "5. Not connected: %s" % shown())
        pg.click('#app [data-tsm-filter="all"]'); pg.fill("#app [data-tsm-q]", "01 apr 2018"); pg.wait_for_timeout(300)
        ok(shown() == [EVER], "5. search by the Tally company's name (%s)" % shown())
        pg.fill("#app [data-tsm-q]", "coral"); pg.wait_for_timeout(300)
        ok(shown() == [CORAL], "5. search by the client's name (%s)" % shown())
        pg.fill("#app [data-tsm-q]", "no such made-up name"); pg.wait_for_timeout(300)
        ok(shown() == [] and txt("#app [data-tsm-none]").startswith("No client matches.") and n("#app [data-tsm-showall]") == 1, "5. nothing matches: No client matches, Show all")
        pg.click("#app [data-tsm-showall]"); pg.wait_for_timeout(300)
        ok(len(shown()) == 9 and pg.input_value("#app [data-tsm-q]") == "", "5. Show all: every row again")

        print("== 6. no computer names outside For support")
        mt = main_text()
        ok(PC not in mt and WIN not in mt, "6. neither %s nor %s outside For support" % (PC, WIN))
        ok("older FinCom Bridge" in txt("#app [data-tsm-pcs]") and txt("#app [data-tsm-pcs]").startswith("Computers with Tally: 1 connected.") and n("#app [data-tsm-pcs] [data-tsm-download]") == 1 and n("#app [data-tsm-pcs] [data-tsm-sha]") == 1 and "Update it now" not in mt,
           "6. Computers with Tally: 1 connected. One has an older FinCom Bridge, Download and its fingerprint (no Update it now: no remote update) (%s)" % txt("#app [data-tsm-pcs]"))

        print("== 7. For support")
        fs = "#app [data-for-support]"
        ok(n(fs) == 1 and n(fs + " [data-support-body]") == 0 and txt(fs + " [data-support-toggle]") == "For support" and n("#app [data-status-card], #app [data-tco-list], #app [data-bridges]") == 0,
           "7. For support: closed by default, the former page inside it")
        pg.click(fs + " [data-support-toggle]"); pg.wait_for_timeout(1200)
        ok(n(fs + " [data-support-body] [data-status-card]") == 1 and n(fs + " [data-support-body] [data-tco-list=firm]") == 1, "7. open: this computer's card and the companies open in Tally")
        pg.click(fs + " [data-advanced] > [data-more-toggle]"); pg.wait_for_timeout(1200)
        E("""() => { const c = {url: 'http://127.0.0.1:9100', key: 'made-up-key', follow: false, port: 0}; Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => true;
          Bridge.st = Object.assign({}, Bridge.st, {state: 'ok', sessions: [], tallyUp: true, version: '2.5.1', at: Date.now(), open: [], mode: 'auto'}); render(); }"""); pg.wait_for_timeout(1200)
        tools = {"this computer's card": "[data-status-card]", "the companies open with their ⋯": "[data-tco-list=firm]", "every client's Tally company": "[data-tlk]",
                 "each computer": "[data-computers]", "versions": "[data-release]", "stop reading": "[data-read-stop-all]", "every bridge": "[data-bridges]",
                 "bridge address and key": "[data-connect-section] [data-bridge=url]", "the key": "[data-connect-section] [data-bridge=key]", "connection history": '[data-pane="tally-history"]',
                 "the PowerShell download line": "[data-bridge-ps]", "the fingerprint": "[data-bridge-sha]", "Sync activity": '[data-tally-tab="activity"]', "the bridge log": '[data-act="bridgeLog"]'}
        miss = [k for k, s in tools.items() if not n(fs + " " + s)]
        ok(not miss, "7. For support holds the former tools (missing: %s)" % miss)
        ft = txt(fs)
        ok(all(w in ft for w in ("Check my Tally", "Roll back", "Hold version", "Stop reading on all computers", "Every bridge FinCom has heard from")), "7. Check my Tally, Roll back, Hold version, Stop reading, Every bridge: all there")
        E("() => { S.tallyMore = {}; render(); }"); pg.wait_for_timeout(500)

        print("== 3c. user A's page never shows user B's Tally (two Windows logins on one server)")
        da = T.dev(7, PC, "made-up-a", tally="open", opened=(ACME,), version="2.5.2", rec=(ACME,))
        db = T.dev(8, PC, "made-up-b", tally="open", opened=(SPLIT, ZETA), version="2.5.2", rec=(SPLIT, ZETA))
        cos2 = [{"company": ACME, "client_id": "NAME:" + ACME, "device_id": da["id"], "gstin": "", "last_seen": "ago:1"},
                {"company": SPLIT, "client_id": None, "device_id": db["id"], "gstin": "", "last_seen": "ago:1"},
                {"company": ZETA, "client_id": None, "device_id": db["id"], "gstin": "", "last_seen": "ago:1"}]
        scene([da, db], cos2, [ACME, EVER], books={ACME: T.book(ACME)}, own=["linked", "go-7", da["id"]])
        rows_a = shown(); mt = main_text()
        ok(word(ACME, "o") == "Yes" and n("#app [data-tsm-strip]") == 0 and ZETA not in rows_a and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") != "3"
           and "Zeta" not in mt and "is not connected:" not in mt, "3c. A's page: A's %s Yes; no strip, no row, no step 3 for B's open %s / %s (%s)" % (ACME, ZETA, SPLIT, rows_a))
        ok(txt(cell(EVER, "c") + " [data-tsm-note]") == "Found in Tally: “%s”" % SPLIT and word(EVER, "o") == "—", "3c. A's page: B's company is only a name seen in Tally, never open (%s)" % txt(row(EVER)))
        # B's own browser (B's bridge paired there): B's companies, and A's is not open in B's Tally
        E(MINE, ["paired", "go-8", ""]); pg.wait_for_timeout(1500)
        ok(n("#app [data-tsm-strip]") == 1 and ZETA in shown() and word(ACME, "o") == "No" and word(ZETA, "o") == "Yes", "3c. B's page: B's open companies (the strip, %s's row Yes); A's %s No (%s)" % (ZETA, ACME, shown()))
        # A's browser reaches B's bridge on 127.0.0.1 (B's Windows user): A's page is unchanged
        E(MINE, ["linked", "go-7", da["id"]]); E(LOCAL, [[SPLIT, ZETA], PC + "\\made-up-b", ""]); pg.wait_for_timeout(1500)
        ok(n("#app [data-tsm-strip]") == 0 and ZETA not in shown() and word(ACME, "o") == "Yes", "3c. A's page with B's bridge answering locally: still only A's Tally (%s)" % shown())
        E(LOCAL, [None, "", ""])

        print("== 3d. bridge 2.5.3: the browser finds its own Windows login's bridge (sameSession)")
        WHY_PORT = [{"port": 9070, "ok": False, "skipped": False, "n": 0, "state": "closed", "reason": "owner unknown", "owner": "unknown", "error": "owner unknown (Tally may be running as administrator)"}]
        SAY = "FinCom switched on Tally's connection. Close and reopen Tally once."
        da = T.dev(7, PC, "made-up-a", tally="open", opened=(ACME,), version="2.5.3", rec=(ACME,), beat={"bridgePort": 9101, "windowsUser": PC + "\\made-up-a"})
        db = T.dev(8, PC, "made-up-b", tally="open", opened=(SPLIT, ZETA), version="2.5.3", rec=(SPLIT, ZETA), beat={"bridgePort": 9150, "windowsUser": PC + "\\made-up-b"})
        UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
        how = lambda: pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-how")
        # the member link points the one shared FinCom login at B's bridge (the wrong one for A's Windows login)
        LINK_B = ["linked", "go-8", db["id"]]
        scene([da, db], cos2, [ACME, EVER], books={ACME: T.book(ACME)}, own=LINK_B, pings={"9101": ping(9101, True, UA, bridgeId="go-7"), "9150": ping(9150, False, UB)})
        probed = set(E("window.__probed"))
        ok({9101, 9103, 9150}.issubset(probed) and set(range(9100, 9111)).issubset(probed) and max(probed) <= 9199, "3d. looks at the firm's bridges' ports (beats), 9103 and 9100..9110 (%s)" % sorted(probed))
        ok(how() == "found" and word(ACME, "o") == "Yes" and ZETA not in shown() and n("#app [data-tsm-strip]") == 0 and n("#app [data-tsm-unsure]") == 0,
           "3d. two local bridges, true and false: the true one (A's) wins over the member link to B's; B's companies not shown (%s, %s)" % (how(), shown()))
        # only B's bridge answers here, and says false: never shown (the link to it is not used either)
        E(PINGS, {"9150": ping(9150, False, UB)}); pg.wait_for_timeout(1500)
        o = col_o()
        ok(how() is None and ZETA not in shown() and "Yes" not in o.values() and n("#app [data-tsm-strip]") == 0, "3d. a bridge saying sameSession false is never yours, its link neither (%s, %s)" % (how(), o))
        # only one bridge answers, and says "unknown": used, marked not confirmed
        E(PINGS, {"9101": ping(9101, "unknown", UA)}); pg.wait_for_timeout(1500)
        ok(how() == "unsure" and word(ACME, "o") == "Yes" and ZETA not in shown() and "your bridge (not confirmed)" in txt("#app [data-tsm-unsure]"),
           "3d. only \"unknown\": used as your bridge (not confirmed) (%s, %s)" % (how(), txt("#app [data-tsm-unsure]")))
        # two answering, one "unknown": not taken; nothing paired here and the link not used
        E(PINGS, {"9101": ping(9101, "unknown", UA), "9150": ping(9150, "unknown", UB)}); pg.wait_for_timeout(1500)
        ok(how() is None and word(ACME, "o") == "—", "3d. two \"unknown\" bridges: neither is taken (%s)" % how())
        # none answers (the owner's laptop): the member link
        E(PINGS, {}); pg.wait_for_timeout(1500)
        ok(how() == "linked" and word(ZETA, "o") == "Yes", "3d. no local bridge answers: the member link (%s, %s)" % (how(), col_o()))
        # an older bridge (2.5.2: no sameSession) answering: as before (the member link)
        E(PINGS, {"9103": ping(9103, None, UA, version="2.5.2")}); pg.wait_for_timeout(1500)
        ok(how() == "linked" and word(ZETA, "o") == "Yes", "3d. an old bridge with no sameSession: today's behaviour (the link) (%s)" % how())
        # the found bridge is the one this browser reads (its address): its own answer, not the beat
        E(PINGS, {"9103": ping(9103, True, UA)}); E(LOCAL, [[], UA, ""]); pg.wait_for_timeout(1500)
        ok(how() == "found" and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-from") == "here" and word(ACME, "o") == "No", "3d. the found bridge read here: its own answer (%s)" % col_o())
        E(LOCAL, [None, "", ""])
        # nothing open: the bridge's plain reasons (tallyWhy, the port's), and tallyConnectSay
        da2 = T.dev(7, PC, "made-up-a", tally="closed", opened=(), version="2.5.3", rec=(ACME,), ports=WHY_PORT,
                    beat={"bridgePort": 9101, "windowsUser": UA, "tallyWhy": "owner unknown", "tallyConnectSay": SAY})
        scene([da2, db], cos2, [ACME, EVER], books={ACME: T.book(ACME)}, own=LINK_B, pings={"9101": ping(9101, True, UA, bridgeId="go-7"), "9150": ping(9150, False, UB)})
        ok(txt("#app [data-tsm-why]") == "Tally is open but FinCom can’t use it: owner unknown (Tally may be running as administrator)" and word(ACME, "o") == "No",
           "3d. tallyWhy and the port's reason in plain words (%s)" % txt("#app [data-tsm-why]"))
        ok(txt("#app [data-tsm-connect-say]") == SAY, "3d. tallyConnectSay shown (%s)" % txt("#app [data-tsm-connect-say]"))
        ok("made-up-a" not in main_text() and "9101" not in main_text(), "3d. no Windows login or port outside For support")
        # its beat old: Connect asks the bridge found here (its address), never another's
        E("""() => { const old = new Date(Date.now() - 10 * 60000).toISOString(); [].concat(window.__devs, TLight.st.devs || [], TCloud.pane.devices || []).forEach(d => { if (!d || !d.info) return;
            d.info.beat.at = old; Object.values(d.info.bridges || {}).forEach(b => { b.at = old; }); }); render(); }"""); pg.wait_for_timeout(1200)
        ok(word(ACME, "o") == "—" and n(cell(ACME, "o") + " [data-tsm-local-connect]") == 1, "3d. its beat old: —, Connect (%s)" % txt(cell(ACME, "o")))
        pg.click(cell(ACME, "o") + " [data-tsm-local-connect]"); pg.wait_for_timeout(1500)
        ok(E("() => Bridge.cfg().url").rstrip("/") == "http://127.0.0.1:9101", "3d. Connect asks the found bridge's address (%s)" % E("() => Bridge.cfg().url"))
        E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} }"); E(PINGS, {}); pg.wait_for_timeout(500)

        print("== 8. a phone, light and dark")
        for w, h, sch in ((390, 844, "light"), (390, 844, "dark"), (1440, 900, "dark")):
            pg2 = open_page(w, h, sch); pg, keep = pg2, pg
            E2 = lambda js, *a: pg2.evaluate(js, *a)
            E2(T.SETUP, [[d], cos, HELD, "owner", [ACME, BRIGHT, CORAL, DELTA, EVER, IRIS, GAMMA, HAZEL], True, books])
            E2("(l) => { Object.assign(window.__ledgers, l); }", {"bk-" + ACME: [{"name": "L%d" % i} for i in range(412)]})
            E2(EXTRA, [[dict(x, client=E2("(n) => Object.values(S.companies).find(c => c.name === n).id", x["client"])) for x in SUM], OPEN, DIFFS, CHG, []])
            E2(PINGS, {}); E2(MINE, ["linked", "go-7", d["id"]]); pg2.wait_for_timeout(4000)
            sw = E2("() => document.documentElement.scrollWidth")
            ok(sw <= w + 1, "8. %dx%d %s: no sideways scroll (%d)" % (w, h, sch, sw))
            ok(pg2.locator("#app [data-tsm-table] tr[data-tsm-row]").count() == 9, "8. %d wide: every row" % w)
            shot("tally-%d-%s" % (w, sch)); pg2.close(); pg = keep
    print("\npage errors: %s" % errors[:5])
    ok(not errors, "no page errors")
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
