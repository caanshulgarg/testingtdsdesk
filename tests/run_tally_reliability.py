"""python3 run_tally_reliability.py - the app's reliability round of 11-Nov-2026 (the audit after the cloud stood still for
36 minutes: requests were held for up to 8 minutes, every poll's "busy" stayed set and the page kept its last state with
no word; the lines that keep themselves fresh forced the firm's slowest call every few seconds, seen or hidden; a read
that failed was told as "computer offline" or kept a fresh tick; each company row had its own timers and its own calls).
Made-up firm, login, clients and companies only (the stand-in cloud of run_tally_progress.py); the page's clock is run by
hand (page.clock).
  1. Cloud.api (the real one, over a fetch that never answers): given up after 20 s with words a person can read
     (e.timedOut), the request itself stopped; a large save has longer (a second for each 8 KB, two minutes at most); a
     caller's own opts.timeout; an answer in time is as before; the token's refresh is given up too.
  2. The Tally page's table: ONE timer for all rows (no timer a row), the masters' progress asked once per book at each
     turn, never more than two calls on their way at once; nothing asked while the tab is hidden.
  3. Books > From Tally with a year being read and a check going: ONE shared poll (one 5-second timer however many lines),
     the summary at most every 15 s (10 s while a check goes), none while the tab is hidden, the timer gone on leaving
     the page, one again for another client.
  1b. (the review of 07041bcdd) an answer that comes in parts for a minute is read whole; one that stops for 20 s is
     given up. 4b: one book's progress failing marks that row alone, and the mark goes within 2 minutes once nothing
     reads it.
  4. FinCom's own reads fail for 5 minutes: "Could not check just now, trying again" with the time of what is shown; no
     row turns "offline", no fresh tick, the top bar's state is not ok; busy is let go and it asks again; when the reads
     work again the line goes and the ticks are back. A computer that is really silent (the reads work, its beat is old)
     is still told offline.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_reliability.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_REL_PORT", "9581"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.5", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.5.exe", "sha256": "cd" * 32}}
PC = "SRV01"; UA = PC + "\\made-up-a"
NAMES = ["Kestrel Textiles", "Orbit Space", "Acme Traders", "Nimbus Events", "Lantern Foods", "Pebble Tools"]
COS = [n.upper() for n in NAMES]
STALE = "Could not check just now, trying again"
# every timer the page starts, by its period (before any of the page's code runs)
TIMERS = """() => { const si = window.setInterval, ci = window.clearInterval; window.__iv = new Map();
  window.setInterval = function(f, ms){ const id = si.apply(window, arguments); window.__iv.set(id, ms); return id; };
  window.clearInterval = function(id){ window.__iv.delete(id); return ci.call(window, id); }; }"""
IV = "(ms) => [...window.__iv.values()].filter(x => x === ms).length"
HIDE = """(h) => {
  Object.defineProperty(document, "visibilityState", {configurable: true, get: () => h ? "hidden" : "visible"});
  Object.defineProperty(document, "hidden", {configurable: true, get: () => h});
  document.dispatchEvent(new Event("visibilitychange"));
}"""
# 1. the real Cloud.api over a fetch the test holds: {never} no answer at all, else the answer after `ms`
API = """async ([path, opts, how, runMs]) => {
  const f0 = window.fetch, cfg0 = Cloud.cfg, sess0 = Cloud.sess, on0 = Cloud.on, guard0 = LocalOwner.guard, after0 = Cloud.afterFirstPaint;
  const out = {aborted: false, asked: 0, err: "", timedOut: false, at: 0, val: null};
  Cloud.cfg = () => ({url: "https://cloud.test", key: "k"});
  Cloud.sess = () => ({access_token: "t", refresh_token: "r", user_id: "u-1", at: how.oldToken ? Date.now() - 2 * 3600e3 : Date.now(), expires_in: 3600});
  LocalOwner.guard = () => ""; Cloud.afterFirstPaint = () => Promise.resolve();
  window.fetch = (url, o) => { out.asked++; out.url = String(url);
    if (o && o.signal) o.signal.addEventListener("abort", () => { out.aborted = true; });
    if (how.never) return new Promise((_, no) => { if (o && o.signal) o.signal.addEventListener("abort", () => no(new DOMException("aborted", "AbortError"))); });
    if (how.parts) { const enc = new TextEncoder(); let i = 0;
      // an answer that starts at once and comes in parts: how.gap ms between them, how.stall ms before the part how.at
      const body = new ReadableStream({ pull: (c) => new Promise(ok => setTimeout(() => {
        if (i >= how.parts) { c.enqueue(enc.encode("]")); c.close(); return ok(); }
        c.enqueue(enc.encode((i ? "," : "[") + JSON.stringify({i, pad: "x".repeat(1000)}))); i++; ok(); }, i === how.at ? how.stall : how.gap)) });
      return Promise.resolve(new Response(body, {status: 200})); }
    return new Promise(r => setTimeout(() => r(new Response(JSON.stringify(how.answer), {status: 200})), how.ms || 0)); };
  const t0 = Date.now();
  window.__apiRun = Cloud.api(path, opts || undefined).then(v => { out.val = v; }, e => { out.err = String((e && e.message) || e); out.timedOut = !!(e && e.timedOut); })
    .finally(() => { out.at = Date.now() - t0; window.fetch = f0; Cloud.cfg = cfg0; Cloud.sess = sess0; Cloud.on = on0; LocalOwner.guard = guard0; Cloud.afterFirstPaint = after0; });
  window.__apiOut = out;
}"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.add_init_script("window.WebSocket = function(){ throw new Error('no realtime in this test'); };")
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.clock.install()
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        pg.evaluate(TIMERS)   # (after the page's clock is in place: the timers the pages below start)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        run = lambda ms: pg.clock.run_for(ms)
        TB = "#app [data-tsm-table]"

        print("== 1. no request to FinCom's cloud waits for ever (Cloud.api)")
        def api(path, opts, how, steps):
            E(API, [path, opts, how, 0]); seen = []
            for ms in steps:
                run(ms); seen.append(E("() => Object.assign({}, window.__apiOut)"))
            return seen
        a = api("tally_devices?select=id", None, {"never": True}, [19000, 2000])
        ok(not a[0]["err"] and a[0]["asked"] >= 1 and a[1]["timedOut"] and a[1]["aborted"] and 19900 <= a[1]["at"] <= 21000,
           "1. a read with no answer: still waited for at 19 s, given up at 20 s, the request stopped (%s)" % {k: a[1][k] for k in ("at", "timedOut", "aborted")})
        ok(re.search(r"did not answer in 20 seconds", a[1]["err"]) and re.search(r"timed out", a[1]["err"]) and "Check the internet" in a[1]["err"], "1. in words a person can read (%s)" % a[1]["err"])
        a = api("rpc/tally_fetch_summary", {"method": "POST", "body": {"p_book": None}}, {"never": True}, [21000])
        ok(a[0]["timedOut"], "1. a function call (TCloud.rpc's path) the same (%s)" % a[0]["err"][:60])
        big = {"method": "POST", "body": {"rows": "x" * 400000}, "headers": {"Prefer": "return=minimal"}}
        a = api("records?on_conflict=firm_id,kind,id", big, {"never": True}, [30000, 39000, 3000])
        ok(not a[0]["err"] and not a[1]["err"] and a[2]["timedOut"] and 69000 <= a[2]["at"] <= 72000, "1. a 400 KB save has longer (20 s + 1 s for each 8 KB): waited for at 69 s, given up at 70 s (%s)" % a[2]["at"])
        a = api("records?x=1", {"method": "POST", "body": {"rows": "x" * 4000000}}, {"never": True}, [119000, 2000])
        ok(not a[0]["err"] and a[1]["timedOut"] and a[1]["at"] <= 121000, "1. two minutes at most, however large (%s)" % a[1]["at"])
        # (the review of 07041bcdd: a large answer that keeps coming, as the firm's backup or a whole client's books)
        a = api("client_books?select=rev,data", None, {"parts": 12, "gap": 5000, "at": -1, "stall": 0}, [61000, 5000])
        ok(not a[1]["err"] and isinstance(a[1]["val"], list) and len(a[1]["val"]) == 12 and a[1]["at"] >= 60000,
           "1. an answer that comes in parts for a minute (5 s between them): read whole, never cut at 20 s (%s parts, %d ms, %s)" % (len(a[1]["val"] or []), a[1]["at"], a[1]["err"][:40]))
        a = api("client_books?select=rev,data", None, {"parts": 12, "gap": 2000, "at": 4, "stall": 60000}, [27000, 3000])
        ok(not a[0]["err"] and a[1]["timedOut"] and "stopped sending for 20 seconds" in a[1]["err"] and a[1]["aborted"],
           "1. an answer that stops coming for 20 s: given up, in words (%s, %d ms)" % (a[1]["err"][:60], a[1]["at"]))
        a = api("tally_devices?select=id", {"timeout": 5000}, {"never": True}, [4000, 2000])
        ok(not a[0]["err"] and a[1]["timedOut"] and "5 seconds" in a[1]["err"], "1. a caller's own wait (opts.timeout) (%s)" % a[1]["err"][:50])
        a = api("tally_devices?select=id", None, {"answer": [{"id": 1}], "ms": 3000}, [4000, 30000])
        ok(a[0]["val"] == [{"id": 1}] and not a[1]["err"] and not a[1]["aborted"], "1. an answer in time: as before, nothing stopped later (%s)" % a[1]["val"])
        a = api("tally_devices?select=id", None, {"never": True, "oldToken": True}, [21000, 21000])
        ok("/auth/v1/token" in (a[1].get("url") or "") or a[1]["asked"] >= 1, "1. the token's refresh is given up too, the read goes on to its own wait (asked %d)" % a[1]["asked"])
        ok(bool(a[1]["err"]) and a[1]["at"] <= 42000, "1. ... and ends (%s, %d ms)" % (a[1]["err"][:40], a[1]["at"]))

        # ---- the firm: one computer online with every company open, six clients, each with its book
        up = {"port": 9039, "ok": True, "skipped": False, "n": 6, "error": "", "reason": "open"}
        dA = T.dev(7, PC, "made-up-a", tally="open", opened=tuple(COS), version="2.5.5", rec=tuple(COS), beat={"bridgePort": 9101, "windowsUser": UA}, ports=[up])
        cos = [{"company": c, "client_id": "NAME:" + nm, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"} for nm, c in zip(NAMES, COS)]
        ids = E(T.SETUP, [[dA], cos, [], "owner", NAMES, True, {nm: T.book(nm) for nm in NAMES}])
        E("() => { window.__linksApi = false; }")
        E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {"9101": TS.ping(9101, True, UA, version="2.5.5", bridgeId="go-7")}); E(TS.FORGET); E(TS.MINE, ["", "", ""])
        E("""() => { window.__sum = []; window.__req = []; window.__down = false; window.__silent = false; window.__now = 0; window.__max = 0;
          const api = Cloud.api, hold = (ms) => new Promise(r => setTimeout(r, ms));
          Cloud.api = async (p, o) => { window.__req.push(String(p).split('?')[0]);
            if (window.__down) { await hold(50); throw new Error('Cloud error 520'); }
            const r = await api(p, o);
            // (the computer's beat is fresh at every read, unless the test makes it silent)
            if (/^tally_devices/.test(p) && !window.__silent) { const at = new Date(Date.now() - 5000).toISOString();
              r.forEach(d => { d.last_seen = at; d.info.beat.at = at; Object.values(d.info.bridges || {}).forEach(b => { b.at = at; }); }); }
            if (/^tally_ledgers\\?/.test(p)) return 438;
            if (/^tally_groups\\?/.test(p)) return Array.from({length: 52}, (_, i) => ({name: 'G' + i}));
            return r; };
          TCloud.restAll = (u) => Cloud.api(u);
          const rpc = TCloud.rpc;
          TCloud.rpc = async (fn, a) => { window.__req.push('rpc/' + fn + (fn === 'tally_period_status' ? ':' + a.p_book : ''));
            if (window.__down) { await hold(50); throw new Error('Cloud error 520'); }
            if (fn === 'tally_fetch_summary') { await hold(200); return {ok: true, books: JSON.parse(JSON.stringify(window.__sum))}; }
            if (fn === 'tally_check_ask_status') { await hold(100); return {ok: true, asks: JSON.parse(JSON.stringify(window.__asks || [])), books: []}; }
            if (fn === 'tally_period_status') { window.__now++; window.__max = Math.max(window.__max, window.__now); await hold(700); window.__now--; return {ok: true, ledger: null}; }
            return rpc(fn, a); }; }""")
        E("() => { Object.values(TCloud.st || {}).forEach(s => { if (s) delete s.ledN; }); S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; TLight.st.at = 0; navHome('tally'); }")
        run(8000)
        reqs = lambda pre: [r for r in E("() => window.__req.slice()") if r.startswith(pre)]
        clear = lambda: E("() => { window.__req = []; window.__max = 0; }")

        print("== 2. the table: one timer and one queue for all rows")
        ok(n(TB + " tr[data-tsm-row]") == 6, "2. six clients' rows (%d)" % n(TB + " tr[data-tsm-row]"))
        ok(E(IV, 2000) == 1, "2. ONE 2-second timer for six rows whose companies are open in Tally (%d; was one 5 s timer a row)" % E(IV, 2000))
        clear(); run(60000)
        ps = reqs("rpc/tally_period_status")
        per = {b: ps.count(b) for b in set(ps)}
        ok(len(per) == 6 and all(2 <= v <= 4 for v in per.values()), "2. a minute: each book's progress asked every 20 s, once per book (%s)" % sorted(per.values()))
        ok(E("() => window.__max") == 2, "2. never more than two of them on their way at once (%s at most)" % E("() => window.__max"))
        E(HIDE, True); run(3000); clear(); run(300000)
        hid = reqs("")
        ok(not hid, "2. a hidden tab: nothing asked in 5 minutes (%s)" % sorted(set(hid)))
        E(HIDE, False); run(30000)
        ok(len(reqs("rpc/tally_period_status")) >= 6 and "tally_devices" in reqs("tally_devices"), "2. shown again: read again")

        print("== 3. Books > From Tally: one shared poll")
        orb, kes = ids[NAMES[1]], ids[NAMES[0]]
        pull = lambda c, nm: {"book": "bk-" + nm, "client": c, "company": nm.upper(), "from": "2026-04-01", "devices": [{"id": dA["id"], "fetchOn": True}],
                              "pull": {"state": "going", "fy": "20250401", "part": "", "x": 1200, "y": 9000, "done": False, "startedAt": "2026-11-11T05:00:00Z"},
                              "check": {"total": 12, "same": 3, "fixed": 0, "waiting": 9, "upload": "u-1"}}
        E("([s, a]) => { window.__sum = s; window.__asks = a; }", [[pull(orb, NAMES[1]), pull(kes, NAMES[0])],
          [{"id": "a-1", "client": orb, "book": "bk-" + NAMES[1], "state": "going", "from": "2026-04-01", "to": "2026-11-11", "at": "2026-11-11T05:00:00Z", "days": 200, "done": 20}]])
        go = "(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }"
        E(go, orb); run(6000); E("() => window.tfxRefresh && window.tfxRefresh()"); run(6000)
        lines = n("#app [data-older], #app [data-older-line], #app [data-check-changes], #app [data-check-waiting], #app .tfx")
        ok("9,000" in txt("#app") and E(IV, 5000) >= 1, "3. the year being read is shown, its poll on (%d lines; text has the count: %s)" % (lines, "9,000" in txt("#app")))
        iv5 = E(IV, 5000)
        ok(iv5 == 1 and E(IV, 15000) == 0 and E(IV, 10000) == 0, "3. ONE 5-second timer for every line; none of their own (5 s: %d, 15 s: %d, 10 s: %d)" % (iv5, E(IV, 15000), E(IV, 10000)))
        clear(); run(60000)
        s1, a1 = len(reqs("rpc/tally_fetch_summary")), len(reqs("rpc/tally_check_ask_status"))
        ok(4 <= s1 <= 7 and 4 <= a1 <= 7, "3. a minute with a check going: the summary and the checks each about every 10 s, one at a time (%d, %d)" % (s1, a1))
        E(HIDE, True); run(2000); clear(); run(300000)
        ok(not reqs("rpc/tally_fetch_summary") and not reqs("rpc/tally_check_ask_status"), "3. a hidden tab: no summary and no check status in 5 minutes (%s)" % sorted(set(reqs("rpc/"))))
        E(HIDE, False); run(12000)
        ok(len(reqs("rpc/tally_fetch_summary")) >= 1, "3. shown again: read again")
        E(go, kes); run(8000)
        ok(E(IV, 5000) == 1, "3. another client: still one timer (%d)" % E(IV, 5000))
        E("() => { S.view = 'home'; S.coId = null; navHome('clients'); }"); run(4000)
        ok(E(IV, 5000) == 0, "3. the page left: the shared poll stops (%d)" % E(IV, 5000))
        clear(); run(120000)
        ok(len(reqs("rpc/tally_fetch_summary")) == 0, "3. ... and the summary is not asked again (%d)" % len(reqs("rpc/tally_fetch_summary")))

        print("== 4. a read that failed is said, never told as the computer's state")
        E("() => { window.__sum = []; window.__asks = []; S.tallyMore = {}; S.tallyGuide = {}; TLight.st.at = 0; navHome('tally'); window.tfxRefresh && window.tfxRefresh(); }"); run(40000)
        row = TB + ' tr[data-tsm-row="%s"]' % NAMES[1]
        before = {"masters": txt(row + " [data-tpg-masters]"), "state": txt(row + " [data-tpt-state]"), "status": E("() => { const t = tallyStatus(null); return [t.state, t.level, t.label]; }")}
        ok(before["masters"].startswith("✓ Up to date") and n("#app [data-tally-stale]") == 0 and before["status"][0] != "offline", "4. while the reads work: the tick, no line (%s)" % before)
        E("() => { window.__down = true; }"); clear(); run(300000)
        note = txt("#app [data-tally-stale]")
        ok(note.startswith(STALE) and re.search(r"as of \d\d:\d\d IST", note), "4. five minutes of failed reads: '%s' with the time of what is shown (%s)" % (STALE, note))
        page = txt("#app [data-tally-simple]")
        st = E("() => { const t = tallyStatus(null); return [t.state, t.level, t.label, t.say]; }")
        ok(not re.search(r"offline", page, re.I) and st[0] != "offline", "4. no row and no sign says offline (%s | %s)" % (st[:3], re.findall(r"[^.·]*offline[^.·]*", page, re.I)[:2]))
        ok(st[1] != "ok" and "as of" in st[2] and st[3].startswith(STALE), "4. the top bar's state is not a fresh ok: its words and time (%s)" % st)
        ms = txt(row + " [data-tpg-masters]")
        ok("✓" not in ms and ms.startswith("Up to date") and "as of" in ms and n(TB + " [data-tpg-stale]") >= 6, "4. the cells: no fresh tick, 'as of <time>' (%s)" % ms)
        E("() => { navHome('clients'); }"); run(3000)
        chips = E("() => [...document.querySelectorAll('#app [data-tally-chip]')].map(e => [e.className, e.title, e.innerText])")
        ok(len(chips) >= 6 and all(" ok" not in " " + c[0] + " " and "could not check just now" in c[1] and not c[2].startswith("●") for c in chips),
           "4. the Clients list: no chip is a fresh green, each says why in its title (%s)" % (chips[:1],))
        E("() => { navHome('tally'); }"); run(3000)
        ok(E("() => !TLight.st.busy") and len(reqs("tally_devices")) >= 10, "4. busy is let go; asked again all along (%d times in 5 minutes)" % len(reqs("tally_devices")))
        E("() => { window.__down = false; }"); run(45000)
        ms = txt(row + " [data-tpg-masters]")
        E("() => { navHome('clients'); }"); run(3000)
        chips = E("() => [...document.querySelectorAll('#app [data-tally-chip]')].map(e => [e.className, e.title, e.innerText])")
        ok(len(chips) >= 6 and all("could not check" not in c[1] for c in chips) and any(c[2].startswith("●") for c in chips), "4. ... and the chips are as before (%s)" % (chips[:1],))
        E("() => { navHome('tally'); }"); run(3000)
        ok(n("#app [data-tally-stale]") == 0 and ms.startswith("✓ Up to date") and E("() => tallyStatus(null).state") != "offline", "4. the reads work again: the line goes, the tick is back (%s)" % ms)
        # (the review of 07041bcdd) one book's masters progress fails: its own row only, never the others, the chips or the
        # top bar; the company closed (nothing reads it any more): the mark is gone within 2 minutes
        kesrow = TB + ' tr[data-tsm-row="%s"]' % NAMES[0]
        E("""() => { const rpc = TCloud.rpc; window.__rpc0 = rpc;
          TCloud.rpc = async (fn, a) => { if (fn === 'tally_period_status' && a.p_book === 'bk-Kestrel Textiles') { window.__req.push('rpc/tally_period_status:bad'); throw new Error('Cloud error 520'); } return rpc(fn, a); }; }""")
        clear(); run(60000)
        kes_ms, orb_ms = txt(kesrow + " [data-tpg-masters]"), txt(row + " [data-tpg-masters]")
        st = E("() => { const t = tallyStatus(null); return [t.state, t.level, t.label]; }")
        ok("✓" not in kes_ms and "as of" in kes_ms and orb_ms.startswith("✓ Up to date") and n(TB + " [data-tpg-stale]") == 1,
           "4b. one book's progress fails: that row alone without its tick, as of its time; the others ✓ (%s | %s)" % (kes_ms, orb_ms))
        ok(st[1] == "ok" and "as of" not in st[2] and txt("#app [data-tally-stale]").startswith(STALE), "4b. the top bar is as before; the page's one line says it (%s)" % st)
        E("() => { window.__devs.forEach(d => { d.info.beat.open = d.info.beat.open.filter(c => c !== 'KESTREL TEXTILES'); Object.values(d.info.bridges || {}).forEach(b => { b.open = b.open.filter(c => c !== 'KESTREL TEXTILES'); }); }); TLight.st.at = 0; }")
        clear(); run(150000)
        ok(n("#app [data-tally-stale]") == 0 and n(TB + " [data-tpg-stale]") == 0 and txt(kesrow + " [data-tpg-masters]").startswith("✓"),
           "4b. the company closed, nothing reads it: the mark is gone within 2 minutes (%s)" % txt(kesrow + " [data-tpg-masters]"))
        clear(); run(60000)
        ok(not reqs("rpc/tally_period_status:bad"), "4b. ... and it is not asked again for ever (%d)" % len(reqs("rpc/tally_period_status:bad")))
        E("() => { TCloud.rpc = window.__rpc0; }")
        # the control: the reads work, the computer itself has gone silent
        E("() => { window.__silent = true; }"); run(400000)
        st = E("() => tallyStatus(null).state")
        ok(st == "offline" and n("#app [data-tally-stale]") == 0, "4. a computer that is really silent is still told offline (%s)" % st)
        br.close()
    srv.shutdown()
    errs = [e for e in errors if "no realtime" not in e]
    ok(not errs, "no page errors (%s)" % errs[:3])
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
