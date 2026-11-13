"""python3 run_tally_own_status.py - each person sees only THEIR OWN Tally (next-tally-own-status, 13-Nov-2026; the owner:
"Tally open" is only ever about the person's own Tally; a client read in someone else's Tally shows a neutral line about
the DATA; on a computer with no bridge the icon is grey "No Tally on this computer", never green from others; the bell
tells each person of their own bridge only; the "Every bridge" and per-computer lists are gone for everyone).
Two made-up bridges of one firm, each its own computer key: staff A's (its Tally open with two companies) and the
owner's (its Tally closed). The owner's browser knows its own bridge (found here before: remembered).
  1. The firm's pages, before the Tally page was ever opened: the top bar's icon is not green and says nothing of
     "Connected"; tallyStatus is "Tally not open" (the bridge and Tally parts are the owner's own); Settings likewise.
  2. A client linked to a company open only in A's Tally: the icon is grey, "Linked — Last entry from Tally received <date time>";
     no "Connected", "Tally open" or "reading" in its words, the Clients list's chip or the Tally page's row.
  3. The bell: nothing about A's computer (not answering, changes waiting); the owner's own computer's is said.
  4. The Tally page: no "Every bridge FinCom has heard from", no "Computers with Tally: N connected", for the owner
     too; nothing of A's computer above Advanced. A member of staff finds only their own bridge's card under Advanced,
     A's computer and Windows user nowhere on the page (the owner keeps each bridge's settings card there: its
     settings are the owner's alone).
  5. The owner's own Tally opened with a company: the icon goes green "Connected"; that company's client says "Connected
     to Tally"; the other client (open only in A's) stays on the neutral line.
  6. A computer with no bridge at all (never paired, nothing remembered, not allowed to reach this computer before):
     nothing on 127.0.0.1 is asked by itself (no Chrome prompt on first load): grey "Not connected on this computer";
     the Tally page opened: looked at once, then "No Tally on this computer" there and on the firm's pages, with no
     word of the office's Tally and no counts.
  7. The own-bridge rules are there with no Tally page opened (window.FCOwn); the look runs by itself only where this
     browser paired before, found its own bridge here before, or was already allowed to reach this computer.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_own_status.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_link_record import SETUP, rec, ALPHA, ITS, GA, GE, CA, CE, CLIENTS, ME, Q
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("OWNST_PORT") or 8497)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
DA, DO = "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"
PCA, UA, PCO, UO = "PC-STAFF", "staffa", "PC-OWN", "ownero"
def dev(id, pc, user, bid, opened, cos, tally="open", port=9101, extra=None):
    at = "ago:0.4"
    me = {"at": at, "version": "2.5.11", "computer": pc, "user": pc + "\\" + user, "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally, "open": list(opened),
          "tallyPort": 9000, "bridgePort": port, "recorder": {c: {"seen": True, "lastAt": "ago:3"} for c in opened}}
    beat = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False, "windowsUser": pc + "\\" + user, "tallyPort": 9000, "bridgePort": port, "version": "2.5.11",
            "lastRead": "ago:3", "ports": [{"port": 9000, "ok": tally == "open", "skipped": False, "n": len(opened), "error": "", "state": tally}],
            "companies": [{"name": n, "guid": g, "open": n in opened, "at": "ago:3", "lastRead": "ago:3"} for n, g in cos]}
    beat.update(extra or {})
    return {"id": id, "name": pc, "revoked": False, "last_seen": at, "version": "2.5.11", "main_bridge": bid, "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": pc, "user": pc + "\\" + user, "beat": beat, "bridges": {bid: me}}, "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
row = lambda name, book, client, d: {"company": name, "book_id": book, "client_id": client, "device_id": d, "gstin": None, "last_seen": "ago:2", "linked_at": "ago:600", "linked_by": None}
def store(own_open=(), own_tally="closed", a_extra=None, o_extra=None, own=True, a_tally="open", a_info=None):
    devs = [dev(DA, PCA, UA, "go-a", [ALPHA, ITS] if a_tally == "open" else [], [(ALPHA, GA), (ITS, GE)], tally=a_tally, extra=a_extra)]
    devs[0]["info"].update(a_info or {})
    if own: devs.append(dev(DO, PCO, UO, "go-o", list(own_open), [(n, g) for n, g in [(ALPHA, GA), (ITS, GE)] if n in own_open], tally=own_tally, port=9102, extra=o_extra))
    la, le = rec(ALPHA, "b-alpha", CA, GA), rec(ITS, "b-its", CE, GE)
    for l in (la, le): l["device_id"] = DA; l["computer"] = PCA
    return {"cos": [row(ALPHA, "b-alpha", CA, DA), row(ITS, "b-its", CE, DA)], "links": [la, le], "devs": devs}
# this browser: no bridge answers on this computer (the look asks nothing real), and what it remembers of its own bridge
PREP = """([own]) => { window.__pings = 0; Bridge.probeUrl = async () => { window.__pings++; return null; }; Bridge.probe = async () => { window.__pings++; return null; };
  try { if (own) localStorage.setItem(LocalOwner.P + 'ownbridge', JSON.stringify(own)); else localStorage.removeItem(LocalOwner.P + 'ownbridge'); } catch (e) {} }"""
ICON = "header.top [data-tally-icon]"
BAD = re.compile(r"Connected|Tally open|Tally ready|\breading\b|Books up to date|PC-STAFF|staffa")
FAR = r"Last entry from Tally received \d\d-[A-Z][a-z]{2}-\d{4} \d\d:\d\d"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def page(own):
            ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.5.11", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.11.exe", "sha256": "ab" * 32}})))
            pg.route("http://127.0.0.1:9*/**", lambda r: r.abort())
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            pg.wait_for_function("() => typeof LinkRec === 'object' && typeof LinkWord === 'function'", timeout=30000)
            pg.evaluate(PREP, [own])
            return pg
        def scene(pg, s, role="owner"):
            pg.evaluate(SETUP, [s, role, ME, CLIENTS])
            pg.evaluate("() => { S.view = 'home'; S.homeTab = 'dashboard'; if (typeof TallySteady === 'object') { TallySteady.reset(); TallySteady.now(); } render(); }"); pg.wait_for_timeout(900)
        def home(pg, tab="dashboard"):
            pg.evaluate("(t) => { navHome(t); }", tab); pg.wait_for_timeout(1200)
        def client(pg, cid):
            pg.evaluate("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid); pg.wait_for_timeout(1300)
        icon = lambda pg: pg.evaluate("(s) => { const e = document.querySelector(s), d = e && e.querySelector('.tsign-dot'); return e ? {state: e.getAttribute('data-tally-icon'), label: e.getAttribute('aria-label') || '', dot: getComputedStyle(d).backgroundColor, tally: e.getAttribute('data-tally')} : null; }", ICON)
        grey = lambda c: (lambda m: len(m) >= 3 and max(map(float, m[:3])) - min(map(float, m[:3])) < 40)(re.findall(r"[\d.]+", c or ""))
        green = lambda c: (lambda m: len(m) >= 3 and float(m[1]) > float(m[0]) + 20 and float(m[1]) > float(m[2]))(re.findall(r"[\d.]+", c or ""))
        alerts = lambda pg: pg.evaluate("() => AlertHub.all().map((a) => ({key: a.key, text: a.text || '', details: a.details || ''}))")
        OWN = {"id": "go-o", "port": 9102, "user": PCO + "\\" + UO}

        print("== 7/1. the owner's own Tally closed, staff A's open: the firm's pages, the Tally page never opened")
        pg = page(OWN); E = lambda js, *a: pg.evaluate(js, *a)
        scene(pg, store())
        pg.wait_for_function("() => !!window.FCOwn", timeout=20000)
        ok(E("() => S.view === 'home' && S.homeTab !== 'tally' && !document.querySelector('[data-tally-simple]')"), "7. the own-bridge rules are there (FCOwn) with no Tally page opened")
        pg.wait_for_function("() => window.FCOwn && FCOwn.place() && FCOwn.state().state !== 'checking'", timeout=20000); pg.wait_for_timeout(800)
        o = E("() => { const o = FCOwn.state(); return {state: o.state, how: (o.own || {}).how, id: (o.own || {}).id, n: o.names ? o.names.size : -1, place: FCOwn.place()}; }")
        ok(o["state"] == "ok" and o["id"] == "go-o" and o["n"] == 0 and o["place"] == "pc", "the owner's own bridge is the remembered one, its Tally with no company; this is a Tally computer (%s)" % o)
        i = icon(pg)
        ok(i and i["state"] in ("waiting", "none") and not BAD.search(i["label"]) and not green(i["dot"]), "1. Dashboard: the icon is not green, nothing of Connected (%s)" % i)
        ok(i and i["state"] == "waiting" and re.search(r"Open your Tally|Open TallyPrime in this Windows login", i["label"]), "1. it says to open the owner's own Tally (%s)" % (i or {}).get("label"))
        t = E("() => { const t = tallyStatus(null); return {state: t.state, label: t.label, say: t.say, parts: t.parts}; }")
        ok(t["state"] == "closed" and t["label"] == "Tally not open" and t["parts"]["tally"] == "closed" and t["parts"]["bridge"] == "online" and not BAD.search(t["label"] + t["say"]),
           "1. tallyStatus: the owner's own bridge online, own Tally closed, never A's (%s)" % t)
        s = E("() => { const s = tallySign(null); return {on: s.on, computer: s.computer || '', words: s.words || ''}; }")
        ok(not s["on"] and PCA not in json.dumps(s), "1. the firm's sign is never on from A's Tally (%s)" % s)
        home(pg, "clients"); i = icon(pg)
        ok(i and i["state"] != "linked" and not BAD.search(i["label"]), "1. Clients: the same (%s)" % i)
        chips = E("() => [...document.querySelectorAll('[data-tally-chip-at=clients]')].map((e) => e.innerText + ' | ' + e.title)")
        ok(len(chips) >= 2 and not any(re.search(r"Connected|Tally open|Tally ready|reading ·", c) for c in chips) and any(re.search(FAR, c) for c in chips),
           "2. the Clients list's chips: Linked, the data's line; nothing of Connected or Tally open (%s)" % chips[:2])
        ok(not any(BAD.search(c) or "up to date as of" in c for c in chips), "M1/M2. the chips' tooltips: no computer's name or state, no 'Books up to date' (%s)" % chips[:1])

        print("== 2. a client whose company is open only in A's Tally")
        client(pg, CA); i = icon(pg)
        ok(i and i["state"] == "none" and grey(i["dot"]) and re.fullmatch(r"Tally: Linked — " + FAR + r".*", i["label"]) and not BAD.search(i["label"]),
           "2/M2. the icon is grey: Linked — Last entry from Tally received <date time> (%s)" % i)
        w = E("(c) => { const w = LinkWord(CO(c)); return {kind: w.kind, word: w.word, line: w.line, text: w.text}; }", CA)
        ok(w["kind"] == "linked" and re.match(FAR, w["line"]) and not BAD.search(w["text"]), "2. the client's one word: Linked, the data's line (%s)" % w)
        cs = E("(n) => { const s = FCOwn && window.LinkRec ? null : null; const m = Object.assign({}, (typeof tallyStatus === 'function' ? tallyStatus(CO()) : {})); return {label: m.label, say: m.say}; }", ALPHA)
        ok(not BAD.search((cs["label"] or "") + " " + (cs["say"] or "")), "2. the client's Tally status says nothing of Connected (%s)" % cs)
        ok(E("(c) => { const sv = tallyServe(c); return !!sv && sv.dev.id; }", ALPHA) == DA, "2. reading and posting still go through A's bridge (tallyServe unchanged)")

        cs = E("() => { const t = tallyStatus(CO()), l = tallyLine(CO()); return {label: t.label, say: t.say, line: l && l.say, tone: l && l.tone, real: l && l.text}; }")
        ok(re.match(FAR, cs["line"]) and not BAD.search(cs["label"] + cs["say"] + cs["line"]) and "as of" not in cs["say"] and cs["tone"] == "no", "M1/M2. the client's status and its line: the data's line only, no computer's words appended (%s)" % cs)
        E("() => { S.tallyPanel = true; render(); }"); pg.wait_for_timeout(900)
        pt = E("() => (document.querySelector('[data-overlay=tallypanel]') || {innerText: ''}).innerText")
        # ("Bridge ● Connected" there is the person's own bridge; nothing of A's computer, its Tally or "Books up to date")
        OTHERS = re.compile(r"PC-STAFF|staffa|Tally open|Tally ready|Books up to date|up to date as of|Tally computers")
        ok(pt and not OTHERS.search(pt) and re.search(FAR, pt), "M1. the top bar's old panel on that client: clean (%s)" % (OTHERS.search(pt).group(0) if OTHERS.search(pt) else "ok"))
        E("() => { S.tallyPanel = false; render(); }"); pg.wait_for_timeout(300)

        print("== M4. the client's company on A's bridge, A's Tally closed, then paused: the data's line, never amber or red")
        for label, kw in (("closed", {"a_tally": "closed"}), ("paused", {"a_extra": {"paused": True}})):
            for role in ("staff", "owner"):
                scene(pg, store(**kw), role=role); client(pg, CA); i = icon(pg)
                w = E("(c) => { const s = LinkWord(CO(c), undefined, 1), r = LinkWord(CO(c)); return {kind: s.kind, level: s.level, line: s.line, real: r.kind}; }", CA)
                ok(i and i["state"] == "none" and grey(i["dot"]) and re.search(FAR, i["label"]) and not BAD.search(i["label"]) and w["kind"] == "linked" and re.match(FAR, w["line"]),
                   "M4. A's Tally %s, %s: grey, the data's line (%s | %s)" % (label, role, (i or {}).get("label"), w))
                ok(w["real"] in ("waiting", "needs"), "M4. …while posting's own words still know the real state (%s)" % w["real"])
            home(pg, "clients")
            chips = E("() => [...document.querySelectorAll('[data-tally-chip-at=clients]')].map((e) => e.className + ' | ' + e.innerText + ' | ' + e.title)")
            ok(chips and not any(BAD.search(c) or "paused" in c.lower() for c in chips) and not any(re.search(r"tchip (warn|bad)", c) and "Linked" in c for c in chips), "M4. A's Tally %s: the Clients chips neither amber nor red, nothing of A's Tally (%s)" % (label, chips[:1]))

        print("== M3. another's bridge's own trouble: the owner and that person only")
        REF = {"idRefused": {"words": "made-up words of a refused key", "at": "ago:5"}}
        for role, want in (("staff", 0), ("owner", 1)):
            scene(pg, store(a_info=REF), role=role); home(pg, "tally"); pg.wait_for_selector("[data-tally-simple]", timeout=30000); pg.wait_for_timeout(2500)
            got = pg.locator("[data-id-refused]").count()
            ok(got == want, "M3. A's computer key refused: %s %s it (%d)" % (role, "sees" if want else "does not see", got))
        ok(E("([a, o]) => { S.account.me.role = 'staff'; const r = [FCOwn.sees(a), FCOwn.sees(o)]; S.account.me.role = 'owner'; return r.concat([FCOwn.sees(a)]); }", [DA, DO]) == [False, True, True],
           "M3. who is told a computer's own state: staff their own bridge's only, the owner each")
        home(pg, "dashboard")

        print("== 3. the bell: each person's own bridge only")
        scene(pg, store(a_extra={"notAnsweringSince": "ago:20", "recorderWaitWords": "Changes in Tally are waiting", "recorderWaitSince": "ago:20"}))
        al = alerts(pg)
        ok(not any(a["key"] in ("pc:" + DA, "ownwait:" + DA) or PCA in a["text"] + a["details"] for a in al), "3. nothing about A's computer (%s)" % [a["key"] for a in al])
        scene(pg, store(a_extra={"notAnsweringSince": "ago:20"}, o_extra={"notAnsweringSince": "ago:20"}))
        al = alerts(pg)
        ok(any(a["key"] == "pc:" + DO for a in al) and not any(a["key"] == "pc:" + DA for a in al), "3. the owner's own computer not answering is said; A's is not (%s)" % [a["key"] for a in al])
        scene(pg, store(a_extra={"notAnsweringSince": "ago:20"}, o_extra={"notAnsweringSince": "ago:20"}), role="staff")
        al = alerts(pg)
        ok(any(a["key"] == "pc:" + DO for a in al) and not any(a["key"] == "pc:" + DA for a in al), "3. the same for a staff member (%s)" % [a["key"] for a in al])

        print("== 4. the Tally page: no list of every bridge or computer")
        scene(pg, store()); home(pg, "tally")
        pg.wait_for_selector("[data-tally-simple]", timeout=30000); pg.wait_for_timeout(2500)
        E("() => { S.tallyMore = {support: true, page: true}; render(); }"); pg.wait_for_timeout(3500)
        txt = E("() => document.querySelector('#app').innerText")
        ok(pg.locator("[data-bridges]").count() == 0 and "Every bridge" not in txt, "4. no \"Every bridge FinCom has heard from\"")
        ok("Each computer" not in txt and pg.locator("[data-tsm-pcs]").count() == 0 and "Computers with Tally" not in txt and pg.locator("[data-old-computers]").count() == 0, "4. no \"Each computer\", no \"Computers with Tally: N connected\"")
        ok(pg.locator("[data-support-body]").count() == 1 and pg.locator("[data-page-more]").count() == 1, "4. Advanced (for support) is open, its support tools too")
        above = E("() => document.querySelector('[data-tally-simple]').innerText")
        ok(PCA not in above and UA not in above, "4. nothing of A's computer or Windows user above Advanced")
        scene(pg, store(), role="staff"); home(pg, "tally"); pg.wait_for_selector("[data-tally-simple]", timeout=30000); pg.wait_for_timeout(1500)
        E("() => { S.tallyMore = {support: true, page: true}; render(); }"); pg.wait_for_timeout(3500)
        txt = E("() => document.querySelector('#app').innerText")
        cards = E("() => [...document.querySelectorAll('[data-bridge-lines] > *')].map((e) => e.innerText.slice(0, 200))")
        ok(pg.locator("[data-page-more]").count() == 1 and len([c for c in cards if c.strip()]) == 1 and "Your FinCom Bridge" in txt, "4. a member of staff: one bridge's card under Advanced, their own (%d)" % len(cards))
        ok(PCA not in txt and UA not in txt and pg.locator("[data-bridges]").count() == 0, "4. staff: A's computer and Windows user are nowhere on the page")
        scene(pg, store()); home(pg, "tally"); pg.wait_for_selector("[data-tally-simple]", timeout=30000); pg.wait_for_timeout(2500)
        rows = E("() => [...document.querySelectorAll('[data-tsm-row]')].map((e) => (e.querySelector('[data-tpt-state]') || {innerText: ''}).innerText.trim())")
        ok(len(rows) >= 2 and not any(BAD.search(r) for r in rows), "2. the Tally page's rows: never Connected (%s)" % rows)
        top = E("() => (document.querySelector('[data-tsm-top-title]') || {innerText: ''}).innerText")
        ok("Connected to Tally" not in top, "1. the Tally page's header is the owner's own Tally, not connected (%r)" % top)
        home(pg, "dashboard"); i = icon(pg)
        ok(i and i["state"] != "linked" and not BAD.search(i["label"]), "1. back on Dashboard after the Tally page: still not green (%s)" % i)

        print("== 5. the owner's own Tally opened with a company")
        scene(pg, store(own_open=[ITS], own_tally="open")); i = icon(pg)
        ok(i and i["state"] == "linked" and green(i["dot"]) and i["label"] == "Tally: Connected — Connected to Tally", "5. Dashboard: green, Connected (%s)" % i)
        t = E("() => { const t = tallyStatus(null); return {state: t.state, label: t.label, parts: t.parts}; }")
        ok(t["state"] == "ok" and t["parts"]["tally"] == "open", "5. tallyStatus: connected, the owner's own Tally open (%s)" % t)
        client(pg, CE); i = icon(pg)
        ok(i and i["state"] == "linked" and green(i["dot"]) and "Linked — Connected to Tally" in i["label"], "5. the client open in the owner's own Tally: green, Connected to Tally (%s)" % i)
        client(pg, CA); i = icon(pg)
        ok(i and i["state"] == "none" and re.search(FAR, i["label"]) and not BAD.search(i["label"]), "5. the client open only in A's Tally: still the neutral line (%s)" % i)
        pg.context.close()

        print("== 6. a computer with no bridge at all")
        pg = page(None); E = lambda js, *a: pg.evaluate(js, *a)
        scene(pg, store(own=False))
        # this browser never paired, found no bridge here before and was not allowed to reach this computer: nothing on
        # 127.0.0.1 is asked by itself (Chrome would ask the person on first load); grey "Not connected on this computer"
        pg.wait_for_function("() => !!window.FCOwn", timeout=30000); pg.wait_for_timeout(8000)
        i = icon(pg)
        ok(E("() => window.__pings") == 0 and E("() => FCOwn.LOCALB.n") == 0, "6. nothing asked of this computer by itself (%s pings)" % E("() => window.__pings"))
        ok(i and i["state"] == "none" and grey(i["dot"]) and i["label"] == "Tally: Not connected on this computer", "6. Dashboard before any look: grey, Not connected on this computer (%s)" % i)
        t = E("() => { const t = tallyStatus(null); return {state: t.state, label: t.label, say: t.say}; }")
        ok(t["state"] == "far" and t["label"] == "Not connected on this computer" and not BAD.search(t["say"]), "6. tallyStatus: the same (%s)" % t)
        client(pg, CA); i = icon(pg)
        ok(i and i["state"] == "none" and re.search(FAR, i["label"]) and not BAD.search(i["label"]), "6. a client read in A's Tally: the neutral line (%s)" % i)
        home(pg, "tally"); pg.wait_for_selector("[data-tally-simple]", timeout=30000)
        pg.wait_for_function("() => FCOwn.LOCALB.n > 0 && FCOwn.state().state === 'none' && FCOwn.place() === 'laptop'", timeout=30000); pg.wait_for_timeout(2500)
        ok(E("() => window.__pings") > 0, "6. the Tally page opened: this computer is looked at (%s pings)" % E("() => window.__pings"))
        top = E("() => ({title: (document.querySelector('[data-tsm-top-title]') || {innerText: ''}).innerText, sub: (document.querySelector('[data-tsm-top-sub]') || {innerText: ''}).innerText, all: document.querySelector('[data-tally-simple]').innerText})")
        ok(top["title"] == "No Tally on this computer" and "open" not in top["sub"].lower(), "6. the Tally page's header: No Tally on this computer, no count of companies open (%s / %s)" % (top["title"], top["sub"]))
        ok(not re.search(r"office Tally|For the firm now|FinCom Bridges? (is|are) connected|with Tally open", top["all"]), "6. nothing of the office's Tally or the firm's bridges on the page")
        home(pg, "dashboard"); i = icon(pg)
        ok(i and i["state"] == "none" and i["label"] == "Tally: No Tally on this computer", "6. back on Dashboard, the look found no bridge: No Tally on this computer (%s)" % i)
        br.close()
    ok(not errors, "no page errors (%s)" % errors[:3])
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
