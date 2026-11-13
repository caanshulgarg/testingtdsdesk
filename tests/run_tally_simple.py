"""python3 run_tally_simple.py - the simple Tally page (02-Nov-2026, next-tally-simple; the owner's approved design "Tally —
Yes or No"; the owner, a CA: every word understandable by anyone; "no computer names like NWS144"). Made-up firm, clients,
companies and computers only (run_tally_page_clean.py's stand-in cloud; nothing real is read or changed).
  1. the guided box moves on by itself from real state: no bridge heard → step 1 (Download FinCom Bridge, the connect
     panel); a bridge, no company open that no client has → step 2 (I have opened it: the computers read again); a company
     open that no client has → step 3, "Connect it to client X?" (the best match by name, a split's date off), Yes,
     connect links the FULL Tally name in one call, Choose another client opens the picker; just linked → step 4; once a
     company is connected the box is small.
  2. the strip (a company is connected already): "Open in your Tally now: “<full name>”, not linked yet" (next-hang-watch),
     one click "Link to client “<best>”" links the full name; Choose another client opens the picker; + New client asks
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
# bridge 2.5.8: step 4's help when no company shows (lib/tallySimple.js NO_CO_HELP)
NO_CO_HELP = "If the company is already open and this stays more than a minute: in TallyPrime press Alt+F3, then F3 to make sure it is loaded (enter its password or TallyVault if asked), then press Check again."
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
    if (/^tally_fast_measures/.test(p)) return JSON.parse(JSON.stringify(window.__fastMeasures || []));   // next-fast-measure
    if (/^tally_ledger_rounds/.test(p)) return (changes[bk] || {}).rounds || [];
    if (/^tally_ledgers\\?select=name&book_id=.*renamed_at/.test(p)) return (changes[bk] || {}).renamed || [];
    return api(p, o);
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  FCTallySimple.OPEN.at = 0; FCTallySimple.OPEN.books = null; FCTallySimple.OPEN.off = false; FCTallySimple.JUST.linked = null; FCTallySimple.JUST.at = 0; FCTallySimple.forget();
  // next-tally-simple2: the six steps open (the top line's "How to connect") and each row's More ▾ › Answers open (details: 'all'), where
  // the table's old answers now are (Linked to Tally?, Open now, Ledgers, Entries, What to do): these tests read them there
  S.tsm = {filter: 'all', q: '', open: true, again: 0, check: 0, details: 'all'}; S.tallyMore = {}; if (Rec.heldReload) Rec.heldReload();
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
NOTRUN = "FinCom Bridge is not running in this Windows login: start it, or install it."
FORGET = "() => { try { localStorage.removeItem(LocalOwner.P + 'ownbridge'); } catch (e) {} }"

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
        # next-tally-simple2: the old answers are in each row's More ▾ › Answers, its light row under it (open in these tests)
        def cell(name, k): return (row(name) if k == "client" else '#app [data-tsm-table] tr[data-tpt-light-of="%s"]' % name) + ' [data-tsm-col="%s"]' % k
        def word(name, k): return pg.get_attribute(cell(name, k) + " [data-tsm-word]", "data-tsm-word") if n(cell(name, k) + " [data-tsm-word]") else None
        def steps(): return E("() => [...document.querySelectorAll('#app [data-tsm-guide] [data-tsm-step]')].map(e => [e.getAttribute('data-tsm-step'), e.hasAttribute('data-now'), e.hasAttribute('data-done')])")
        def main_text(): return E("() => { const a = document.querySelector('#app').cloneNode(true); a.querySelectorAll('[data-for-support]').forEach(e => e.remove()); return a.innerText; }")
        # next-tally-connect-steps (the owner, 06-Nov-2026: the steps say WHICH Windows login, and whose Tally holds a port):
        # Connect Tally names this login and its Tally's port; the rest of the page still names no computer or login
        def rest_text(): return E("() => { const a = document.querySelector('#app').cloneNode(true); a.querySelectorAll('[data-for-support], [data-tsm-guide]').forEach(e => e.remove()); return a.innerText; }")
        def shot(name, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)

        print("== 1. Connect Tally's six steps, from real state (next-tally-connect-steps: was the four-step guided box)")
        def states(): return E("() => [...document.querySelectorAll('#app [data-tsm-guide] [data-tsm-step]')].map(e => e.getAttribute('data-tsm-state'))")
        scene([], [], [ACME, EVER])
        g = "#app [data-tsm-guide]"
        ok(pg.get_attribute(g, "data-tsm-guide") == "1" and states() == ["now"] + ["later"] * 5, "1. no bridge anywhere (the first time): step 1 now, the rest later (%s)" % states())
        ok(txt("#app [data-tsm-now]").startswith("Step 1: On the computer or server where TallyPrime runs, download FinCom Bridge") and txt(g + " [data-tsm-download]") == "Download FinCom Bridge"
           and (pg.get_attribute(g + " [data-tsm-download]", "href") or "").startswith("assets/bridge-go/FinComBridge-Setup-2.5.1.exe?v="), "1. step 1: one sentence, Download FinCom Bridge (this site's setup) (%s)" % txt("#app [data-tsm-now]"))
        ok(n(g + " [data-tsm-panel]") == 1, "1. step 1: the connect panel (open it, type its code) under the box")
        # next-tally-page-redesign: the top line (its Check again); the computers line and the day check of every client
        # (Check Tally now) are under Advanced (for support)
        hd = txt("#app [data-tsm-head]")
        ok(hd.startswith("Not connected yet: step 1 of 6") and n("#app [data-tsm-top-check]") == 1, "1. the top line: not connected, step 1, Check again (%s)" % hd)
        E("() => { S.tallyMore = Object.assign({}, S.tallyMore, {support: true}); render(); }"); pg.wait_for_timeout(1500)
        # (next-tally-own-status (the owner, 13-Nov-2026): no "Computers with Tally: N connected" line)
        ok(n("#app [data-tsm-strip]") == 0 and n("#app [data-tsm-pcs]") == 0, "1. no strip; no line of the firm's computers")
        ok(n("#app [data-support-body] [data-tsm-check]") == 1 and "Check every client for changes in Tally" in txt("#app [data-tsm-check]"), "1. the day check of every client, in Advanced (%s)" % txt("#app [data-tsm-check]"))
        E("() => { S.tallyMore = Object.assign({}, S.tallyMore, {support: false}); render(); }"); pg.wait_for_timeout(500)

        # this login's own bridge answers here (bridge 2.5.3's sameSession); its Tally open, no company
        P1 = {"9101": ping(9101, True, PC + "\\" + WIN, version="2.5.3", bridgeId="go-7")}
        d = T.dev(7, PC, WIN, tally="open", opened=(), version="2.5.3", rec=())
        scene([d], [], [ACME, EVER], pings=P1)
        ok(pg.get_attribute(g, "data-tsm-guide") == "4" and states()[:4] == ["done", "done", "done", "now"], "1. a bridge, Tally open, no company: step 4 now, 1 to 3 ticked (%s)" % states())
        ok(txt("#app [data-tsm-now]") == "Step 4: Tally is open, but no company is open in it. Open your company in TallyPrime: it shows here within a minute. " + NO_CO_HELP, "1. step 4's sentence, with bridge 2.5.8's help (%s)" % txt("#app [data-tsm-now]"))
        r0 = E("window.__reads"); pg.click(g + ' [data-tsm-go="check"]'); pg.wait_for_timeout(1500)
        ok(E("window.__reads") > r0, "1. Check again: the computers are read again (%d -> %d)" % (r0, E("window.__reads")))
        # bridge 2.5.8: Check again on the Tally computer asks this login's own bridge /status?fresh=1 (Bridge.refresh(true)), where
        # the bridge asks Tally now; with no bridge paired in this browser (a laptop) nothing is asked of any bridge
        E("""() => { window.__rf = []; window.__rf0 = {on: Bridge.on, call: Bridge.call, refresh: Bridge.refresh, st: Bridge.st};
          if (window.__bridge0) Bridge.refresh = window.__bridge0.refresh;
          Bridge.on = () => true; Bridge.call = async (path) => { window.__rf.push(path); throw {code: 'bridge_down', message: 'made up'}; }; }""")
        E("() => FCTallySimple.checkAll()")
        ok("/status?fresh=1" in E("window.__rf"), "1. Check again (paired here): this login's bridge asked /status?fresh=1 (%s)" % E("window.__rf"))
        E("() => { window.__rf = []; Bridge.on = () => false; }")
        E("() => FCTallySimple.checkAll()")
        ok(E("window.__rf") == [], "1. Check again (no bridge paired here): nothing asked of a bridge (%s)" % E("window.__rf"))
        E("() => { const o = window.__rf0; Bridge.on = o.on; Bridge.call = o.call; Bridge.refresh = o.refresh; Bridge.st = o.st; render(); }"); pg.wait_for_timeout(300)

        d = T.dev(7, PC, WIN, tally="open", opened=(SPLIT,), version="2.5.3", rec=(SPLIT,))
        ids = scene([d], [{"company": SPLIT, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"}], [ACME, EVER], pings=P1)
        ok(pg.get_attribute(g, "data-tsm-guide") == "5" and states()[:5] == ["done"] * 4 + ["now"], "1. a company open that no client has: step 5, steps 1 to 4 ticked (%s)" % states())
        ok(txt("#app [data-tsm-now]") == "Step 5: “%s” is open in your Tally. Link it to client “%s”." % (SPLIT, EVER), "1. step 5: the full Tally name, the client of its name (%s)" % txt("#app [data-tsm-now]"))
        ok(n("#app [data-tsm-strip]") == 0, "1. step 5 says it: no strip as well")
        pg.click(g + " [data-tsm-go-choose]"); pg.wait_for_timeout(500)
        ok(n(g + " [data-tsm-guide-pick] select[data-tco-relink-pick]") == 1, "1. Choose another client: the picker of the clients")
        E("() => { window.__calls = []; }")
        pg.click(g + ' [data-tsm-go="connect"]'); pg.wait_for_timeout(2500)
        ok([x for x in links() if x.get("p_client")] == [{"p_company": SPLIT, "p_client": ids[EVER]}], "1. Link: ONE link, the full Tally name to %s (%s)" % (EVER, links()))
        ok(pg.get_attribute(g, "data-tsm-guide") == "6" and txt("#app [data-tsm-now]").startswith("Step 6: Reading “%s”:" % SPLIT) and n(g + " [data-tsm-go]") == 0,
           "1. just linked: step 6 (reading), no button (%s)" % txt("#app [data-tsm-now]"))
        shot("guide-step6")
        # (this login's bridge found above is not remembered for the scenes below: neither as its own bridge nor as the address)
        E(FORGET); E(PINGS, {}); E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")

        print("== 2. the strip, next time")
        d = T.dev(7, PC, WIN, tally="open", opened=(ACME, SPLIT), version="2.5.1", rec=(ACME,))
        cos = [{"company": ACME, "client_id": "NAME:" + ACME, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"},
               {"company": SPLIT, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"}]
        ids = scene([d], cos, [ACME, EVER])
        st = "#app [data-tsm-strip]"
        # next-tally-words: a company connected already: the box is folded, and hidden while the strip shows
        # next-tally-connect-steps: a browser with no bridge here (a laptop): Connect Tally is one small line (where to do
        # the steps, the firm's state), never a login's steps
        ok(pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") == "laptop" and n("#app [data-tsm-guide] [data-tsm-state]") == 0 and n(st) == 1, "2. a company connected already, a laptop: the strip, and Connect Tally's one line")
        ok(txt(st + " .tsm-strip-words") == "Open in your Tally now: “%s”, not linked yet" % SPLIT and pg.get_attribute(st, "data-tsm-strip") == SPLIT, "2. the strip names the full Tally name (%s)" % txt(st))
        ok(txt(st + " [data-tsm-strip-connect]") == "Link to client “%s”" % EVER, "2. one click: Link to client “%s”" % EVER)
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
        heads = E("() => [...document.querySelectorAll('#app [data-tsm-table] thead th')].map(e => (e.firstChild && e.firstChild.nodeType === 3 ? e.firstChild.textContent : e.textContent).trim())")
        # next-tally-filters2: Client · Tally company | State | In Tally | Masters | Entries | Last entry | Action (the six
        # questions' answers in More ▾ › Answers)
        ok(heads == ["Client · Tally company", "State", "In Tally", "Masters", "Entries", "Last entry", "Action"], "3. the seven columns (the six questions in the answers) (%s)" % heads)
        ok(all(txt(row(c) + " .tpt-co-line") == c for c in (ACME, BRIGHT, CORAL, GAMMA, HAZEL, IRIS)) and txt(row(DELTA) + " .tpt-co-line") == "Not linked",
           "3. every linked row: its Tally company under the client; not linked: 'Not linked' (%s)" % [txt(row(c) + " .tpt-co-line") for c in (ACME, DELTA)])
        ok([word(ACME, k) for k in "cole"] == ["Yes"] * 4 and txt(cell(ACME, "c") + " [data-tsm-note]") == "Tally company: " + ACME and txt(cell(ACME, "do")) == "Nothing.", "3. %s: Yes Yes Yes Yes, Nothing. (%s)" % (ACME, txt(row(ACME))))
        ok("412 ledgers" in txt(cell(ACME, "l")) and txt(cell(ACME, "l") + " [data-tsm-lchange]") == "Changed in Tally today: 2 new or changed, 1 renamed" and n(cell(ACME, "l") + " [data-tsm-ledgers]") == 1,
           "3. ledgers: the count, today's change in Tally, See ledgers (%s)" % txt(cell(ACME, "l")))
        ok(re.match(r"Till today \d\d:\d\d$", txt(cell(ACME, "e") + " [data-tsm-note]") or ""), "3. entries: Till today <time> (%s)" % txt(cell(ACME, "e")))
        ok(word(BRIGHT, "o") == "No" and txt(cell(BRIGHT, "o") + " [data-tsm-note]") == NOT_MINE, "3. %s: not open in this user's Tally: No, %s (%s)" % (BRIGHT, NOT_MINE, txt(cell(BRIGHT, "o"))))
        ok(word(BRIGHT, "e") == "No" and txt(cell(BRIGHT, "e") + " [data-tsm-note]") == "12-Oct to 13-Oct are missing · FinCom is checking them with Tally now (50%)" and txt(row(BRIGHT) + ' [data-tpt-main="again"]') == "Check again" and txt(cell(BRIGHT, "do") + ' [data-tsm-act]') == "Upload Day Book"
           and txt(cell(BRIGHT, "do") + " [data-tsm-todo]") == "5 changes saved in Tally are not in FinCom yet. Upload the Day Book for those days.",
           "3. held lines (migration 136): All entries received? No, the period, the row's button Check again (not open anywhere, the firm's bridge online), Upload Day Book in its details (%s | %s)" % (txt(cell(BRIGHT, "e")), txt(cell(BRIGHT, "do"))))
        ok(n("#app [data-tally-simple] [data-held-block]") == 0, "3. the held lines are the row's, not a block of their own")
        ok(word(CORAL, "e") == "Not yet" and txt(cell(CORAL, "e") + " [data-tsm-note]") == "New client · 62% received · 6 min left" and pg.get_attribute(cell(CORAL, "e") + " [role=progressbar]", "aria-valuenow") == "62",
           "3. being brought: Not yet, New client · 62%% received · 6 min left, the bar (%s)" % txt(cell(CORAL, "e")))
        ok(txt(cell(CORAL, "do") + " [data-tsm-todo]") == "Nothing. It is coming in by itself." and n(cell(CORAL, "do") + " [data-tsm-upload]") == 1, "3. coming in by itself, or upload the file yourself (%s)" % txt(cell(CORAL, "do")))
        ok(word(DELTA, "c") == "No" and txt(cell(DELTA, "c") + " [data-tsm-note]") == "Found in Tally: “%s”" % DELTA and [word(DELTA, k) for k in "ole"] == ["—"] * 3 and txt(row(DELTA) + " [data-tsm-act]") == "Link",
           "3. not connected, found in Tally: No, —, Link (%s)" % txt(row(DELTA)))
        ok(txt(cell(EVER, "c") + " [data-tsm-note]") == "Found in Tally: “%s”" % SPLIT, "3. a split is found by its client's name, said in full (%s)" % txt(cell(EVER, "c")))
        ok(word(GAMMA, "l") == "Not yet" and word(GAMMA, "e") == "Not yet" and word(GAMMA, "o") == "No" and txt(cell(GAMMA, "do") + " [data-tsm-todo]") == "Open the company in Tally.", "3. linked, nothing received yet: Not yet (%s)" % txt(row(GAMMA)))
        ok(pg.get_attribute(row(ZETA), "data-tsm-kind") == "company" and "Not chosen yet" in txt(cell(ZETA, "client")) and txt(cell(ZETA, "c") + " [data-tsm-note]") == "Open in Tally: “%s”" % ZETA and txt(row(ZETA) + " [data-tsm-act]") == "Link",
           "3. a company no client has: Not chosen yet, Link to a client (%s)" % txt(row(ZETA)))
        acts = E("() => [...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(r => r.querySelectorAll('[data-tpt-main]').length)")
        ok(max(acts) <= 1 and min(acts) == 1, "3. one button a row (%s)" % acts)
        need, fine = n("#app [data-tsm-table] tr[data-tsm-need]"), n("#app [data-tsm-table] tr[data-tsm-fine]")
        ok(txt("#app [data-tsm-say]") == "%s %s" % ("1 client is fine." if fine == 1 else "%d clients are fine." % fine, "1 needs you." if need == 1 else "%d need you." % need) and fine == 1, "3. the header from the rows (%s; %d fine, %d need)" % (txt("#app [data-tsm-say]"), fine, need))
        E("() => { window.__calls = []; S.tallyMore = Object.assign({}, S.tallyMore, {support: true}); render(); }"); pg.wait_for_timeout(1500)   # (in Advanced now)
        pg.click("#app [data-tsm-check]"); pg.wait_for_timeout(2500)
        cr = calls("tally_check_request")
        ok(sorted(x["p_client"] for x in cr) == sorted(ids[c] for c in (ACME, BRIGHT, CORAL, IRIS, HAZEL)) and all(x["p_from"] == "2026-04-01" for x in cr), "3. Check Tally now: each connected client's day check, this year so far (%s)" % cr)
        shot("tally-1440-light")

        print("== 3b. Open in Tally right now? on THIS computer only")
        def col_o(): return E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tsm-table] tr[data-tpt-light-of]')].map(r => [r.getAttribute('data-tpt-light-of'), (r.querySelector('[data-tsm-col=o] [data-tsm-word]') || {}).textContent || '']))")
        # next-tally-simple2: no filter chips; the clients not open in this user's Tally counted from the answers themselves
        def fcount(k): assert k == "closed"; return sum(1 for v in col_o().values() if v == "No")
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
        # next-hang-watch: no bridge answers here at all (this test's 127.0.0.1): why, in words, instead of "not connected now"
        ok(o[ACME] == "—" and txt(cell(ACME, "o") + " [data-tsm-note]").startswith(NOTRUN) and txt(cell(ACME, "o") + " [data-tsm-local-connect]") == "Connect", "3b. its beat old: —, %s, Connect (%s)" % (NOTRUN, txt(cell(ACME, "o"))))
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
        ok(o[ACME] == "—" and txt(cell(ACME, "o") + " [data-tsm-note]").startswith(NOTRUN) and txt(cell(ACME, "o") + " [data-tsm-setup]") == "Set it up" and n("#app [data-tsm-local-connect]") == 0,
           "3b. no own bridge, nothing answering here: —, %s, Set it up (%s)" % (NOTRUN, txt(cell(ACME, "o"))))
        ok("Yes" not in o.values() and ZETA not in o and n("#app [data-tsm-strip]") == 0 and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") in ("1", "laptop"),
           "3b. no own bridge: no Yes from another login's Tally, no company row or strip of theirs, Connect Tally at step 1 (or, nothing answering here, where to do it) (%s)" % o)
        pg.click(cell(ACME, "o") + " [data-tsm-setup]"); pg.wait_for_timeout(1200)
        ok(n("#app [data-tsm-guide][data-tsm-forced]") == 1 and n("#app [data-tsm-guide] [data-tsm-panel]") == 1, "3b. Set it up: the pairing steps (step 1, the connect panel)")
        E("() => { S.tallyGuide = {}; S.tsm = {filter: 'all', q: '', open: true, again: 0, check: 0, details: 'all'}; render(); }")
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
        ok(n("#app [data-tsm-filter]") == 0 and n(row(BRIGHT) + ".tpt-need") == 1 and txt(row(BRIGHT) + " [data-tpt-main]"), "4. no filter chips; a row whose opening balances differ is shaded, its one button there")
        E("() => { window.__calls = []; }"); pg.click(ow + " [data-tsm-open-use]"); body = confirm(True); pg.wait_for_timeout(1500)
        ok({"p_book": "bk-" + BRIGHT, "p_action": "use"} in calls("tally_openings_decide") and "2 ledgers’ opening balances" in body, "4. Use Tally's: asked once, then tally_openings_decide use (%s)" % body[:120])
        ok(pg.get_attribute(cell(BRIGHT, "l") + " [data-tsm-open]", "data-tsm-open") == "same", "4. then: same as Tally")
        pg.click(cell(IRIS, "l") + " [data-tsm-open-keep]"); confirm(True); pg.wait_for_timeout(1500)
        ok({"p_book": "bk-" + IRIS, "p_action": "keep"} in calls("tally_openings_decide"), "4. Keep FinCom's: tally_openings_decide keep")

        print("== 5. no filter chips (next-tally-simple2); the search, for a long list")
        def shown(): return E("() => [...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(e => e.getAttribute('data-tsm-row'))")
        ok(n("#app [data-tsm-filter]") == 0 and n("#app .tsm-filters") == 0 and len(shown()) == 9, "5. no filter chips: every row shown (%s)" % shown())
        nc = [r for r in shown() if pg.get_attribute(row(r), "data-tpt-kind") in ("free", "company", "open")]
        ok(nc == [DELTA, EVER, ZETA] and all(pg.get_attribute(row(r) + " [data-tpt-main]", "data-tpt-main") in ("link", "connect") for r in nc), "5. not connected: Link (or Connect) on their rows (%s)" % nc)
        pg.fill("#app [data-tsm-q]", "01 apr 2018"); pg.wait_for_timeout(300)
        ok(shown() == [EVER], "5. search by the Tally company's name (%s)" % shown())
        pg.fill("#app [data-tsm-q]", "coral"); pg.wait_for_timeout(300)
        ok(shown() == [CORAL], "5. search by the client's name (%s)" % shown())
        pg.fill("#app [data-tsm-q]", "no such made-up name"); pg.wait_for_timeout(300)
        ok(shown() == [] and txt("#app [data-tsm-none]").startswith("No client matches.") and n("#app [data-tsm-showall]") == 1, "5. nothing matches: No client matches, Show all")
        pg.click("#app [data-tsm-showall]"); pg.wait_for_timeout(300)
        ok(len(shown()) == 9 and pg.input_value("#app [data-tsm-q]") == "", "5. Show all: every row again")

        # (the owner's Mac, 08-Nov-2026: ~250 px of blank under the search box) the table right under the search box's card
        # (next-tally-filters2: the search, the chips and the filters in one card), desktop and phone (WebKit is not
        # installed here: Chromium, and the search box's own computed height)
        GAP = """() => { const c = document.querySelector('#app [data-tsm-table] [data-tpf]'), s = document.querySelector('#app [data-tsm-table] .tpf-search'), t = document.querySelector('#app [data-tsm-table] .tpt');
          return c && s && t ? [Math.round(t.getBoundingClientRect().top - c.getBoundingClientRect().bottom), Math.round(parseFloat(getComputedStyle(s).height))] : null; }"""
        for w, h in ((1440, 900), (390, 844)):
            pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(600)
            g = E(GAP)
            ok(len(shown()) == 9 and g and 0 <= g[0] <= 40 and g[1] <= 60, "5 (owner's Mac). %d px wide, 9 rows: the table within 40 px of the search box's card, the box no taller than 60 px (%s)" % (w, g))
        pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(400)

        print("== 6. no computer names outside For support")
        mt = main_text()
        mt = rest_text()
        ok(PC not in mt and WIN not in mt, "6. neither %s nor %s outside For support and Connect Tally" % (PC, WIN))
        ok(n("#app [data-tsm-pcs]") == 0 and "Computers with Tally" not in txt("#app") and "Update it now" not in mt, "6. no line of the firm's computers (Computers with Tally: N connected is gone); no Update it now")

        print("== 7. For support")
        fs = "#app [data-for-support]"
        # next-tally-page-redesign: For support is "Advanced (for support)", its parts drawn one a task (wait for the last)
        E("() => { S.tallyMore = Object.assign({}, S.tallyMore, {support: false}); render(); }"); pg.wait_for_timeout(500)   # (section 3 left it open)
        ok(n(fs) == 1 and n(fs + " [data-support-body]") == 0 and txt(fs + " [data-support-toggle]").startswith("Advanced (for support)") and n("#app [data-status-card], #app [data-tco-list], #app [data-bridges]") == 0,
           "7. For support: closed by default, the former page inside it")
        pg.click(fs + " [data-support-toggle]"); pg.wait_for_timeout(1200)
        try: pg.wait_for_function("() => !document.querySelector('#app [data-staged-wait]')", timeout=10000)
        except Exception: pass
        ok(n(fs + " [data-support-body] [data-status-card]") == 1 and n(fs + " [data-support-body] [data-tco-list=firm]") == 1, "7. open: this computer's card and the companies open in Tally")
        # next-fast-measure: "Fast read measured", read only, only when a measurement was sent; each run names its company
        # (the owner's decision of 08-Nov-2026: the company open in Tally, a linked client's)
        ok(n(fs + " [data-fast-measure]") == 0, "7. no fast-read measurement: nothing shown")
        E("""() => { const run = (ms, differ, co) => ({ok: true, watched: true, tallyVersion: '7.1.0.0', company: co, results: [{kind: 'W1', days: 31, rows: 175, ms: ms, holdMs: 120},
            {kind: 'W2', days: 3, asked: 50, rows: 50, ms: 600, holdMs: 80, objectMs: 30, objectHoldMs: 0, compare: {same: 50 - differ, differ: differ, left: 0, fields: differ ? ['ALLLEDGERENTRIES.LIST/AMOUNT'] : []}}]});
          window.__fastMeasures = [{received_at: '2026-11-08T05:00:00Z', tally_version: '7.1.0.0', bridge: '2.5.8', pass: true, line: '', result: run(900, 0, 'Sharma Traders 2026-27')},
                                   {received_at: '2026-11-07T05:00:00Z', tally_version: '7.1.0.0', bridge: '2.5.8', pass: false, line: '', result: run(1700, 2, 'ZZ TEST')}];
          S.tallyMore = Object.assign({}, S.tallyMore, {support: false}); render(); }"""); pg.wait_for_timeout(400)
        pg.click(fs + " [data-support-toggle]"); pg.wait_for_timeout(1200)
        try: pg.wait_for_function("() => !document.querySelector('#app [data-staged-wait]')", timeout=10000)
        except Exception: pass
        fm = txt(fs + " [data-fast-measure]")
        ok(n(fs + " [data-fast-measure-row=pass]") == 1 and n(fs + " [data-fast-measure-row=fail]") == 1 and "Fast read measured" in fm and "Sharma Traders 2026-27 · PASS · TallyPrime 7.1.0.0 · worst 0.90 s" in fm and "ZZ TEST · NOT A PASS" in fm
           and "a request took 1.70 s (1.5 s at most); 2 of 50 entries not the same; fields that differed: ALLLEDGERENTRIES.LIST/AMOUNT" in fm and n(fs + " [data-fast-measure] button") == 0,
           "7. the fast read measured, each run naming its company: a pass and a run that is not, with why; nothing to press (%s)" % fm)
        pg.click(fs + " [data-advanced] > [data-more-toggle]"); pg.wait_for_timeout(1200)
        try: pg.wait_for_function("() => !document.querySelector('#app [data-staged-wait]')", timeout=10000)
        except Exception: pass
        E("""() => { const c = {url: 'http://127.0.0.1:9100', key: 'made-up-key', follow: false, port: 0}; Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => true;
          Bridge.st = Object.assign({}, Bridge.st, {state: 'ok', sessions: [], tallyUp: true, version: '2.5.1', at: Date.now(), open: [], mode: 'auto'}); render(); }"""); pg.wait_for_timeout(1200)
        tools = {"this computer's card": "[data-status-card]", "the companies open with their ⋯": "[data-tco-list=firm]", "every client's Tally company": "[data-tlk]",
                 "each computer": "[data-computers]", "versions": "[data-release]", "stop reading": "[data-read-stop-all]",
                 "bridge address and key": "[data-connect-section] [data-bridge=url]", "the key": "[data-connect-section] [data-bridge=key]", "connection history": '[data-pane="tally-history"]',
                 "the PowerShell download line": "[data-bridge-ps]", "the fingerprint": "[data-bridge-sha]", "Sync activity": '[data-tally-tab="activity"]', "the bridge log": '[data-act="bridgeLog"]'}
        miss = [k for k, s in tools.items() if not n(fs + " " + s)]
        ok(not miss, "7. For support holds the former tools (missing: %s)" % miss)
        ft = txt(fs)
        ok(all(w in ft for w in ("Check my Tally", "Roll back", "Hold version", "Stop reading on all computers")) and "Every bridge" not in ft and n("#app [data-bridges]") == 0, "7. Check my Tally, Roll back, Hold version, Stop reading: all there; no list of every bridge")
        E("() => { S.tallyMore = {}; render(); }"); pg.wait_for_timeout(500)

        print("== 3c. user A's page never shows user B's Tally (two Windows logins on one server)")
        # (2.5.3: a bridge older than 2.5.3 on a server with another login's bridge is never trusted, run_tally_other_login.py)
        da = T.dev(7, PC, "made-up-a", tally="open", opened=(ACME,), version="2.5.3", rec=(ACME,))
        db = T.dev(8, PC, "made-up-b", tally="open", opened=(SPLIT, ZETA), version="2.5.3", rec=(SPLIT, ZETA))
        cos2 = [{"company": ACME, "client_id": "NAME:" + ACME, "device_id": da["id"], "gstin": "", "last_seen": "ago:1"},
                {"company": SPLIT, "client_id": None, "device_id": db["id"], "gstin": "", "last_seen": "ago:1"},
                {"company": ZETA, "client_id": None, "device_id": db["id"], "gstin": "", "last_seen": "ago:1"}]
        # (next-tally-other-login: the member link is never used on a computer with another login's bridge: A's own is the
        # one paired in A's browser)
        scene([da, db], cos2, [ACME, EVER], books={ACME: T.book(ACME)}, own=["paired", "go-7", ""])
        rows_a = shown(); mt = main_text()
        ok(word(ACME, "o") == "Yes" and n("#app [data-tsm-strip]") == 0 and ZETA not in rows_a and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") != "3"
           and "Zeta" not in mt and "is not connected:" not in mt, "3c. A's page: A's %s Yes; no strip, no row, no step 3 for B's open %s / %s (%s)" % (ACME, ZETA, SPLIT, rows_a))
        # (next-tally-other-login: a company open now in another login's Tally is not even offered as found)
        ok(SPLIT not in txt(row(EVER)) and word(EVER, "o") == "—" and n(row(EVER) + " [data-tsm-connect]") == 0, "3c. A's page: B's open company is not offered to A's client (%s)" % txt(row(EVER)))
        # B's own browser (B's bridge paired there): B's companies, and A's is not open in B's Tally
        E(MINE, ["paired", "go-8", ""]); pg.wait_for_timeout(1500)
        ok((n("#app [data-tsm-strip]") == 1 or pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") == "5") and ZETA in shown() and word(ACME, "o") == "No" and word(ZETA, "o") == "Yes", "3c. B's page: B's open companies (the strip, %s's row Yes); A's %s No (%s)" % (ZETA, ACME, shown()))
        # A's browser reaches B's bridge on 127.0.0.1 (B's Windows user): A's page is unchanged
        E(MINE, ["paired", "go-7", ""]); E(LOCAL, [[SPLIT, ZETA], PC + "\\made-up-b", "go-7"]); pg.wait_for_timeout(1500)
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
        E(FORGET)   # (a browser that never found its bridge: nothing remembered; run_hang_watch.py tests the remembered one)
        E(PINGS, {"9150": ping(9150, False, UB)}); pg.wait_for_timeout(1500)
        o = col_o()
        ok(how() is None and ZETA not in shown() and "Yes" not in o.values() and n("#app [data-tsm-strip]") == 0, "3d. a bridge saying sameSession false is never yours, its link neither (%s, %s)" % (how(), o))
        # only one bridge answers, and says "unknown": used, marked not confirmed
        E(FORGET)   # (a browser that never found its bridge: nothing remembered; run_hang_watch.py tests the remembered one)
        E(PINGS, {"9101": ping(9101, "unknown", UA)}); pg.wait_for_timeout(1500)
        ok(how() == "unsure" and word(ACME, "o") == "Yes" and ZETA not in shown() and "your bridge (not confirmed)" in txt("#app [data-tsm-unsure]"),
           "3d. only \"unknown\": used as your bridge (not confirmed) (%s, %s)" % (how(), txt("#app [data-tsm-unsure]")))
        # two answering, one "unknown": not taken; nothing paired here and the link not used
        E(FORGET)   # (a browser that never found its bridge: nothing remembered; run_hang_watch.py tests the remembered one)
        E(PINGS, {"9101": ping(9101, "unknown", UA), "9150": ping(9150, "unknown", UB)}); pg.wait_for_timeout(1500)
        ok(how() is None and word(ACME, "o") == "—", "3d. two \"unknown\" bridges: neither is taken (%s)" % how())
        # none answers (the owner's laptop): the member link
        E(FORGET)   # (a browser that never found its bridge: nothing remembered; run_hang_watch.py tests the remembered one)
        E(PINGS, {}); pg.wait_for_timeout(1500)
        ok(how() == "linked" and word(ZETA, "o") == "Yes", "3d. no local bridge answers (a laptop: no key, nothing here): the member link (%s, %s)" % (how(), col_o()))
        # an older bridge (2.5.2: no sameSession) answering: as before (the member link)
        E(FORGET)   # (a browser that never found its bridge: nothing remembered; run_hang_watch.py tests the remembered one)
        E(PINGS, {"9103": ping(9103, None, UA, version="2.5.2")}); pg.wait_for_timeout(1500)
        ok(how() is None and word(ZETA, "o") != "Yes", "3d. a bridge answers here (this is the shared server): the link to another login's bridge is not used (%s)" % how())
        # the found bridge is the one this browser reads (its address): its own answer, not the beat
        E(PINGS, {"9103": ping(9103, True, UA)}); E(LOCAL, [[], UA, ""]); pg.wait_for_timeout(1500)
        ok(how() == "found" and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-from") == "here" and word(ACME, "o") == "No", "3d. the found bridge read here: its own answer (%s)" % col_o())
        E(LOCAL, [None, "", ""])
        # nothing open: the bridge's plain reasons (tallyWhy, the port's), and tallyConnectSay
        # (bridge 2.5.3 switched the connection on and says "no Tally running in this login" until Tally is reopened)
        CLOSED9070 = [{"port": 9070, "ok": False, "skipped": False, "n": 0, "state": "closed", "reason": "closed", "error": "Tally is not open (nothing listens on this port)"}]
        da2 = T.dev(7, PC, "made-up-a", tally="closed", opened=(), version="2.5.3", rec=(ACME,), ports=CLOSED9070,
                    beat={"bridgePort": 9101, "windowsUser": UA, "tallyWhy": "no tally running in this login", "tallyConnectSay": SAY})
        scene([da2, db], cos2, [ACME, EVER], books={ACME: T.book(ACME)}, own=LINK_B, pings={"9101": ping(9101, True, UA, bridgeId="go-7"), "9150": ping(9150, False, UB)})
        # next-tally-connect-steps: the bridge's tallyConnectSay (it switched the connection on: reopen Tally once) is shown,
        # once, as Connect Tally's step 3, in the bridge's own words; step 2 ticked (its Tally runs, without the connection yet)
        ok(txt("#app [data-tsm-now]") == "Step 3: " + SAY and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-hook") == "reopen" and word(ACME, "o") == "No",
           "3d. tallyConnectSay shown, as step 3 (%s)" % txt("#app [data-tsm-now]"))
        ok(txt("#app [data-tally-simple]").count(SAY) == 1, "3d. said once on the page")
        ok("made-up-a" not in rest_text() and "9101" not in rest_text(), "3d. no Windows login or port outside For support and Connect Tally")
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
