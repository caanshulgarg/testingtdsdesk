"""python3 run_tally_any_bridge.py - a client <-> Tally company link belongs to the COMPANY, not to one Windows login's
bridge (next-tally-link-any-bridge; the owner's decision of 06-Nov-2026, staging: a link pinned to one login's computer key
said "Tally is not open on the Tally computer" while the company was open in another login's bridge on the same server).
Made-up firm, logins, clients and companies only (run_tally_simple.py's stand-in cloud; nothing real is read or changed).
One shared server (SRV9), two Windows logins, each its own computer key and bridge: A (made-up-a, go-7: the key the link
names, tally_companies.device_id) and B (made-up-b, go-8). The client Orbit Works is linked to ORBIT WORKS. Checks:
  1. open only in B's Tally (A's open with nothing): tallyServe picks B; the client's line (tallyLine) is "open"; its one
     word (LinkWord) "Linked"; the firm sign for the client (tallySignNow) is on; the Clients column is not "Tally closed"
     and the ledgers' stall line says nothing; B's reading row is live and A's says it is read in another login
  2. open in none: the plain words "Open ORBIT WORKS in Tally" (the line, LinkWord, the sign), no login or computer named
  3. open in A and B: this browser's own bridge first (B's browser: B; A's browser: A); no own bridge here: the link's (A)
  4. a company of the same name under ANOTHER GUID in B's beat (the link knows its GUID): not served there
  5. a bridge heard more than 3 minutes ago does not serve
  6. the link record names a real data folder: a bridge reading the company from ANOTHER folder (a copy) does not serve
  P. posting is unchanged until migration 142 (next-tally-read-any): with the company open only in B's login, A's
     browser reads it (the sign on) but Post is not offered: tallyPostSign (asstEntries' postGate), the Post line
     (postStatusFor) and "This will post through" (postThroughWords) say what the poster's own bridge can do, as before;
     open in A's own Tally: Post offered as before
  7. open in none and the linked key A offline: another login's key on the SAME computer heard -> the plain words; the
     other key on ANOTHER computer -> the existing words (offline / the bridge not running), never "Open ... in Tally"
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_any_bridge.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9547
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PC = "SRV9"
UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
ORBIT, CO = "Orbit Works", "ORBIT WORKS"
GUID, OTHER_GUID = "0b1e0000-0000-0000-0000-00000000aa01", "0b1e0000-0000-0000-0000-00000000bb02"
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
LOCAL_UP = """([open, user, bid, port]) => {
  const B = window.__bridge0 = window.__bridge0 || {on: Bridge.on, up: Bridge.up, cfg: Bridge.cfg, refresh: Bridge.refresh};
  const c = {url: 'http://127.0.0.1:' + port, key: 'made-up-key', follow: false, port: 0, bridgeId: bid};
  Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => true; Bridge.refresh = async () => Bridge.st; Bridge.okAt = Date.now() - 50000;
  Bridge.st = {state: 'ok', sessions: [], tallyUp: true, tallyState: 'open', version: '2.5.4', computer: 'SRV9', at: Date.now() - 50000, mode: 'auto', user, sameSession: true,
    beat: {on: true, last: new Date().toISOString()}, open: open.map(n => ({name: n, port: 1646, mine: true}))};
  render();
}"""
# the link record (tally_links, migration 110) as the cloud would give it: the company's GUID, the key A
LINKS = """([cid, dev, guid, folder]) => {
  const api = Cloud.api;
  if (!window.__linksRec) { window.__linksRec = true; Cloud.api = async (p, o) => /^tally_links\\?/.test(p) ? JSON.parse(JSON.stringify(window.__recs || [])) : /^tally_link_places/.test(p) ? [] : api(p, o); }
  window.__recs = [{book_id: 'bk-orbit', client_id: cid, company_guid: guid, company_name: 'ORBIT WORKS', gstin: '', device_id: dev, computer: 'SRV9', posting_allowed: true, state: 'linked',
    linked_by: 'made-up-member-a', linked_at: new Date().toISOString(), version: 1, how: 'person', data_loc: folder ? 'f-made-up' : null, data_folder: folder || null, windows_user: 'SRV9\\\\made-up-a', tally_port: null}];
  (window.__companies || []).forEach(c => { if (c.company === 'ORBIT WORKS') c.book_id = 'bk-orbit'; });
  if (typeof TCloud === 'object' && TCloud.restPages) TCloud.restPages = async (u) => Cloud.api(u);
  return LinkRec.load(true).then(() => { LinkRec.overlay(TLight.st.cos); render(); return LinkRec.ready(); });
}"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        def devs(a_open, b_open, b_at="ago:0.5", b_guid=GUID, a_at="ago:0.5", b_pc=PC, b_folder=None, folder=None):
            da = T.dev(7, PC, "made-up-a", at=a_at, tally="open", opened=tuple(a_open), version="2.5.4", rec=tuple(a_open), beat={"bridgePort": 9101, "windowsUser": UA})
            db = T.dev(8, b_pc, "made-up-b", at=b_at, tally="open", opened=tuple(b_open), version="2.5.4", rec=tuple(b_open), beat={"bridgePort": 9150, "windowsUser": UB})
            if b_folder: db["info"]["bridges"]["go-8"]["dataFolder"] = b_folder
            for d, g in ((da, GUID), (db, b_guid)):
                for c in d["info"]["beat"]["companies"]: c["guid"] = g
            return da, db
        def scene(a_open, b_open, me=None, folder=None, **kw):
            da, db = devs(a_open, b_open, **kw)
            cos = [{"company": CO, "client_id": "NAME:" + ORBIT, "device_id": da["id"], "gstin": "", "last_seen": "ago:0.5", "linked_at": "ago:600", "linked_by": "made-up-member-a"}]
            ids = E(T.SETUP, [[da, db], cos, [], "owner", [ORBIT, "Made-up Acme"], True, {}])
            E("() => { window.__linksApi = false; }")
            E(TS.EXTRA, [[], [], [], {}, []])
            E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
            if me == "a":
                E(TS.PINGS, {"9101": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")})
                E(TS.FORGET); E(TS.MINE, [None]); pg.wait_for_timeout(1200); E(LOCAL_UP, [list(a_open), UA, "go-7", 9101])
            elif me == "b":
                E(TS.PINGS, {"9101": TS.ping(9101, False, UA, version="2.5.4"), "9150": TS.ping(9150, True, UB, version="2.5.4", bridgeId="go-8")})
                E(TS.FORGET); E(TS.MINE, [None]); pg.wait_for_timeout(1200); E(LOCAL_UP, [list(b_open), UB, "go-8", 9150])
            else:
                E(TS.PINGS, {}); E(TS.FORGET); E(TS.MINE, [None])
            pg.wait_for_timeout(1800)
            E("() => { window.__linksRec = false; }")
            ok(E(LINKS, [ids[ORBIT], da["id"], GUID, folder]) is True, "   (the link record read: GUID and key A)")
            pg.wait_for_timeout(300)
            return ids, da, db
        def post(cid):
            return E("""(c) => { const co = S.companies[c], p = tallyPostSign(co), r = tallySign(co), st = typeof postStatusFor === 'function' ? postStatusFor(co) : null;
              return {post: !!p.on, read: !!r.on, where: st ? st.where : null, through: typeof postThroughWords === 'function' ? postThroughWords(co) : null}; }""", cid)
        def look(cid):
            return E("""(c) => { const co = S.companies[c], sv = tallyServe('ORBIT WORKS'), l = tallyLine(co), w = LinkWord(co), s = tallySignNow(co);
              return {serve: sv ? {dev: sv.dev.id, id: sv.id, how: sv.how} : null, line: l ? [l.state, l.text] : null, word: w ? [w.kind, w.line, w.text] : null,
                      sign: [s.on, s.code, String(s.words || '') + ' | ' + String(s.reason || '') + ' | ' + String(s.fix || '')],
                      cell: (TLight.st.by || {})[c] || null}; }""", cid)

        print("== 1. open only in B's login (the link names A's key): read there, status OK")
        ids, da, db = scene([], [CO], me="a")
        E("() => { TLight.st.by = TLight.work(TLight.st.cos.filter(c => c.client_id), TLight.st.devs, Date.now()); }")
        r = look(ids[ORBIT])
        ok(r["serve"] and r["serve"]["dev"] == db["id"] and r["serve"]["id"] == "go-8" and r["serve"]["how"] == "other", "1. tallyServe: B's bridge (%s)" % r["serve"])
        ok(r["line"] and r["line"][0] == "open", "1. the client's line: open (%s)" % r["line"])
        ok(r["word"] and r["word"][0] == "linked" and "Waiting" not in r["word"][2], "1. LinkWord: Linked, not Waiting for Tally (%s)" % r["word"])
        ok(r["sign"][0] is True, "1. the client's sign: on (%s)" % r["sign"])
        ok(r["cell"] and r["cell"].get("short") != "Tally closed" and "not open" not in str(r["cell"].get("say", "")), "1. the Clients column: not Tally closed (%s)" % r["cell"])
        pp = post(ids[ORBIT])
        ok(pp["read"] is True and pp["post"] is False and not pp["where"] and not pp["through"], "P. open only in B's login: read (the sign on), but Post not offered by the posting's rule (%s)" % pp)
        ok("Waiting: Tally company not open" not in E("() => document.querySelector('#app').innerText"), "1. no 'Waiting: Tally company not open' on the page")

        print("== 2. open in none: the plain words")
        ids, da, db = scene([], [], me="a")
        r = look(ids[ORBIT])
        ok(r["serve"] is None, "2. tallyServe: none (%s)" % r["serve"])
        ok(r["line"] and r["line"][1] == "Open ORBIT WORKS in Tally", "2. the line: Open ORBIT WORKS in Tally (%s)" % r["line"])
        ok(r["word"] and r["word"][0] == "waiting" and r["word"][1] == "Open ORBIT WORKS in Tally", "2. LinkWord: Waiting for Tally — Open ORBIT WORKS in Tally (%s)" % r["word"])
        ok(r["sign"][0] is False and "made-up" not in r["sign"][2] and "SRV9" not in r["sign"][2] and "Open ORBIT WORKS in Tally" in r["sign"][2], "2. the sign: no login or computer named (%s)" % r["sign"])

        print("== 3. open in both: this browser's own bridge first, else the link's")
        ids, da, db = scene([CO], [CO], me="b")
        r = look(ids[ORBIT]); ok(r["serve"] and r["serve"]["id"] == "go-8" and r["serve"]["how"] == "own", "3. B's browser: B's own bridge (%s)" % r["serve"])
        ids, da, db = scene([CO], [CO], me="a")
        r = look(ids[ORBIT]); ok(r["serve"] and r["serve"]["id"] == "go-7" and r["serve"]["how"] == "own", "3. A's browser: A's own bridge (%s)" % r["serve"])
        pp = post(ids[ORBIT]); ok(pp["post"] is True and pp["read"] is True, "P. open in A's own Tally too: Post offered, as before (%s)" % pp)
        ids, da, db = scene([CO], [CO], me=None)
        r = look(ids[ORBIT]); ok(r["serve"] and r["serve"]["dev"] == da["id"] and r["serve"]["how"] == "linked", "3. no own bridge here (a laptop): the link's key A (%s)" % r["serve"])

        print("== 4. the same name under another GUID")
        ids, da, db = scene([], [CO], me="a", b_guid=OTHER_GUID)
        r = look(ids[ORBIT]); ok(r["serve"] is None and r["word"] and r["word"][0] == "waiting", "4. B's ORBIT WORKS is another company: not served (%s / %s)" % (r["serve"], r["word"]))

        print("== 5. a bridge heard 5 minutes ago")
        ids, da, db = scene([], [CO], me="a", b_at="ago:5")
        r = look(ids[ORBIT]); ok(r["serve"] is None, "5. not served by a bridge last heard 5 minutes ago (%s)" % r["serve"])

        print("== 6. the link's data folder")
        SHARED = "C:\\Users\\Public\\TallyPrime\\Data"
        ids, da, db = scene([], [CO], me="a", folder=SHARED)
        r = look(ids[ORBIT]); ok(r["serve"] and r["serve"]["id"] == "go-8", "6. B reads the link's folder: served (%s)" % r["serve"])
        ids, da, db = scene([], [CO], me="a", folder=SHARED, b_folder="D:\\Copy\\TallyData")
        r = look(ids[ORBIT]); ok(r["serve"] is None and r["word"] and r["word"][0] == "waiting", "6. B reads a copy in another folder: not served (%s / %s)" % (r["serve"], r["word"]))
        ok(r["sign"][0] is False, "6. the sign: not on through the copy (%s)" % r["sign"])

        print("== 7. the linked key offline")
        ids, da, db = scene([], [], me=None, a_at="ago:20")
        r = look(ids[ORBIT]); ok(r["line"] and r["line"][1] == "Open ORBIT WORKS in Tally" and "Open ORBIT WORKS in Tally." in r["sign"][2], "7. another login on the same computer heard: the plain words (%s / %s)" % (r["line"], r["sign"]))
        ids, da, db = scene([], [], me=None, a_at="ago:20", b_pc="OTHERPC")
        r = look(ids[ORBIT]); ok(r["line"] and r["line"][0] == "offline" and r["line"][1] != "Open ORBIT WORKS in Tally" and r["sign"][1] == "bridge", "7. the other key on another computer: the offline words stand (%s / %s)" % (r["line"], r["sign"][:2]))
        br.close()
    srv.shutdown()
    bad = [e for e in errors if "could not be drawn" in e or "TypeError" in e or "ReferenceError" in e]
    ok(not bad, "no page errors (%s)" % bad[:3])
    print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
