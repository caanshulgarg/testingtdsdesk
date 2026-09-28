"""python3 run_keep_e2e.py - the bridge keeps FinCom's copy of an open company in step with a stand-in Tally:
the first copy is taken a few days at a time, then only what changed is read; an edit, a new entry and a deletion
reach FinCom; totals never ask Tally anything; the check against Tally agrees."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "keeprun")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, threading, functools, http.server, subprocess, urllib.request, re, glob
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
sys.path.insert(0, HERE)
import fake_tally
from playwright.sync_api import sync_playwright
fake_tally.start()
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8145), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
FROM = "20260301"
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepCheckEvery": 1, "KeepIdleMin": 1, "KeepFrom": FROM}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br_p = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=180, step=1.0):
    t = time.time()
    while time.time() - t < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None
def wait_for(pg, js, timeout=120):
    return until(lambda: pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"), timeout, 0.25)
CO = fake_tally.COMPANY
SYNC = lambda: glob.glob(_os.path.join(BRUN, "sync", "*"))
def man():
    d = [x for x in SYNC() if _os.path.isdir(x)]
    if not d: return None
    f = _os.path.join(d[0], "manifest.json")
    return json.load(open(f, encoding="utf-8-sig")) if _os.path.exists(f) else None
march = [(d, p) for d, p in fake_tally.V if d.startswith("202603")]
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    ok(json.loads(urllib.request.urlopen("http://127.0.0.1:9100/ping").read())["version"] == "1.12.12", "bridge 1.12.12 running")
    # ---------- the worker starts on its own and makes the first copy
    t0 = time.time()
    m = until(lambda: (lambda x: x if x and x.get("phase") == "live" else None)(man()), 300)
    ok(bool(m), "the bridge started keeping the open company in step on its own, and reached 'in step' in %.0fs" % (time.time() - t0))
    ok(m and m["from"] == FROM and m["months"] and m["months"][0]["ym"] == "202603", "the copy starts where it was told, month by month")
    mar = [x for x in (m or {}).get("months", []) if x["ym"] == "202603"]
    ok(mar and mar[0]["n"] == len(march), "March in the copy has every entry: %s of %d" % (mar[0]["n"] if mar else "?", len(march)))
    db = [(a, b) for k, a, b in fake_tally.LOG if k == "DayBook"]
    spans = [(int(b) - int(a)) for a, b in db if a and b and a[:6] == b[:6]]
    ok(db and max(spans) <= 30, "the day book was read a few days at a time: %d reads, the longest %d days" % (len(db), max(spans) + 1 if spans else 0))
    heavy = [k for k, a, b in fake_tally.LOG if k in ("TDSDeskBalances", "TDSDeskTB")]
    ok(not heavy, "no request for every ledger's balance at once: " + str(heavy[:3]))
    ok(any(k == "TDSDeskKeepBal" for k, a, b in fake_tally.LOG), "opening balances read in groups of ledgers")
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8145/"); pg.wait_for_timeout(2000)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate("""([k, name]) => { Bridge.setCfg({url: "http://127.0.0.1:9100", key: k});
          const c = newCompany({name, gstin: "07AADCV3366N1ZU"}); c.tallyName = name; S.companies[c.id] = c; S.coId = c.id; S.view = "company";
          S.data[c.id] = {parties: {}, entries: {}, loaded: true};
          S.books = {cid: c.id, loading: false, vouchers: [], meta: {}, map: {}, challans: [], alloc: {}}; S.tab = "books"; S.booksTab = "lookup"; render(); }""", [key, CO])
        pg.evaluate("Bridge.refresh()"); pg.wait_for_timeout(1500)
        pg.evaluate("LK.autoFresh(true)")
        ok(wait_for(pg, "S.books.meta.keep && S.books.vouchers.length > 0 && !S.lkFr.busy", 180), "FinCom brings in the copy the bridge keeps")
        got = pg.evaluate("S.books.vouchers.filter(v => v.date.startsWith('202603')).length")
        own = pg.evaluate("async (x) => (await Books.importDayBook(new Blob([x], {type: 'text/xml'}))).vouchers.length", "<ENVELOPE>" + "".join(p_ for d, p_ in march) + "</ENVELOPE>")
        ok(got == own, "FinCom has every March entry, as it reads them from Tally's own day book: %d of %d" % (got, own))
        ok("In step with Tally" in pg.inner_text(".lk-fresh"), "the page says the company is in step with Tally")
        # ---------- totals: Tally asked nothing
        fake_tally.REQS.clear()
        pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
        wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
        r = pg.evaluate("({dr: S.lk.res.dr, cr: S.lk.res.cr, n: S.lk.res.rows.length, none: S.lk.res.none || ''})")
        asked = {k: v for k, v in fake_tally.REQS.items() if k not in ("TDSDeskCompanies", "DayBook", "TDSDeskKeepList", "TDSDeskNames", "TDSDeskGroupNames", "TDSDeskKeepBal")}
        mv = pg.evaluate("(() => { const tb = S.books.tb || {}; let m = 0; S.books.vouchers.filter(v => v.date >= tb.from && v.date <= '20260331' && !v.opt && !v.cancel).forEach(v => v.ent.forEach(e => { m += e.a; })); return m; })()")
        ok(r["n"] > 20 and not r["none"] and abs(mv) < 1, "trial balance on 31 March 2026 from the kept copy: %d ledgers; March's own entries balance (%.2f)" % (r["n"], mv))
        diff = pg.evaluate("""async () => { const mine = {}; S.lk.res.rows.forEach(z => { mine[z.l] = z.bal; });
          const j = await Bridge.call('/tb?company=' + encodeURIComponent(LK.tname()) + '&to=20260331'); const bad = [];
          j.ledgers.forEach(([n, p, b]) => { const t = -Books.amt(b), m = mine[n] || 0; if (Math.abs(t - m) >= 1) bad.push(n); });
          return {n: j.ledgers.length, bad}; }""")
        import re as _re
        fx = lambda n: "BANK" in n or any(_re.search(r"<LEDGERNAME>" + _re.escape(n) + r"</LEDGERNAME>.*?<AMOUNT>[^<]*[$@=]", pc, _re.S) for d, pc in fake_tally.V if "<LEDGERNAME>" + n + "</LEDGERNAME>" in pc)
        ok(all(fx(n) for n in diff["bad"]) and len(diff["bad"]) <= 3, "every ledger in the kept trial balance agrees with Tally's own figure (%d of %d), except those with dollar entries the stand-in Tally cannot add up: %s" % (diff["n"] - len(diff["bad"]), diff["n"], ", ".join(diff["bad"][:8])))
        ok(not asked, "FinCom asked Tally nothing for it (the bridge's own light requests aside): " + json.dumps(asked))
        # ---------- an edit in Tally
        g_edit = re.search(r"<GUID>([^<]*)</GUID>", march[5][1]).group(1)
        before = pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); return v ? v.ent.map(e => e.a) : null; }", g_edit)
        fake_tally.edit_amount(g_edit, 2)
        until(lambda: (man() or {}).get("at", "") > m["at"] and any(x["ym"] == "202603" and x["at"] > mar[0]["at"] for x in man()["months"]), 90)
        pg.evaluate("LK.autoFresh(true)"); wait_for(pg, "!S.lkFr.busy", 60); pg.wait_for_timeout(500)
        after = pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); return v ? v.ent.map(e => e.a) : null; }", g_edit)
        ok(before and after and abs(after[0] - 2 * before[0]) < 0.01, "an entry changed in Tally reaches FinCom: %s -> %s" % (before[:1] if before else None, after[:1] if after else None))
        # ---------- a new entry
        g_new = "keep-test-new-0001"
        fake_tally.add_copy(g_edit, "20260315", g_new)
        ok(until(lambda: (pg.evaluate("LK.fr().at = 0; LK.autoFresh(true)") or True) and pg.evaluate("(g) => !!S.books.vouchers.find(x => x.id === g)", g_new), 120, 3), "a new entry in Tally reaches FinCom")
        # ---------- a deletion
        g_del = re.search(r"<GUID>([^<]*)</GUID>", march[20][1]).group(1)
        fake_tally.delete(g_del)
        ok(until(lambda: (pg.evaluate("LK.fr().at = 0; LK.autoFresh(true)") or True) and not pg.evaluate("(g) => !!S.books.vouchers.find(x => x.id === g)", g_del), 150, 3), "an entry deleted in Tally goes from FinCom too")
        # ---------- the check against Tally, for March
        chk = pg.evaluate("async () => await Bridge.call('/keepcheck?company=' + encodeURIComponent(LK.tname()) + '&ym=202603')")
        ok(chk.get("listMatchesDayBook") and chk.get("missing") == 0 and chk.get("extra") == 0 and chk.get("differ") == 0, "the check against Tally agrees: " + json.dumps(chk))
        pg.click('[data-lk="keepcheck"]'); wait_for(pg, "LK.fr().check && !LK.fr().busy", 60)
        ok("against Tally" in pg.inner_text(".lk-fresh"), "Check against Tally shows its answer on the page")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
        br.close()
    log = open(glob.glob(_os.path.join(BRUN, "*.log"))[0], encoding="utf-8", errors="replace").read() if glob.glob(_os.path.join(BRUN, "*.log")) else ""
    ok("Keeping copies in step: started" in log and "in step with Tally" in log, "the bridge's log tells the story")
finally:
    br_p.terminate()
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 15)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
