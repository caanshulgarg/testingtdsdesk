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
if os.environ.get("KEEP_NO_COUNTERS"): fake_tally.CTRL["no_counters"] = True       # a Tally that does not give its change counters
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8145), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
FROM = "20260301"
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepCheckEvery": 4, "KeepNowEvery": 2, "KeepIdleMin": 1, "KeepFrom": FROM, "KeepSharePct": 100, "KeepNightSharePct": 100}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
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
    ok(json.loads(urllib.request.urlopen("http://127.0.0.1:9100/ping").read())["version"] == "1.13.9", "bridge 1.13.9 running")
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
        # ---------- nothing changes in Tally: only the tiny question is asked
        from collections import Counter
        n0 = len(fake_tally.LOG); time.sleep(20)
        seen = Counter(k for k, a_, b_ in fake_tally.LOG[n0:])
        if not os.environ.get("KEEP_NO_COUNTERS"): ok(seen["TDSDeskKeepCo"] >= 3 and seen["TDSDeskKeepList"] <= 3 and not seen["TDSDeskKeepLed"] and not seen["DayBook"], "when nothing changes in Tally, the bridge mostly asks its one tiny question: " + json.dumps(seen))
        # ---------- totals: Tally asked nothing
        fake_tally.REQS.clear()
        pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
        wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
        r = pg.evaluate("({dr: S.lk.res.dr, cr: S.lk.res.cr, n: S.lk.res.rows.length, none: S.lk.res.none || ''})")
        asked = {k: v for k, v in fake_tally.REQS.items() if k not in ("TDSDeskCompanies", "DayBook", "TDSDeskKeepList", "TDSDeskNames", "TDSDeskGroupNames", "TDSDeskKeepBal", "TDSDeskKeepLed", "TDSDeskKeepCo")}
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
        # ---------- on any screen, with nothing pressed: the change arrives by itself and the sections follow
        tab0 = pg.evaluate("(() => { const t = S.booksTab; S.booksTab = 'mis'; render(); return t; })()")
        g2 = re.search(r"<GUID>([^<]*)</GUID>", march[7][1]).group(1)
        b2 = pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); return v ? v.ent.map(e => e.a) : null; }", g2)
        m2 = man()
        fake_tally.edit_amount(g2, 3)
        until(lambda: (man() or {}).get("at", "") > m2["at"], 90)
        pg.wait_for_function("(g) => { const v = S.books.vouchers.find(x => x.id === g); return v && Math.abs(v.ent[0].a - 3 * %r) < 0.01; }" % b2[0], arg=g2, timeout=180000)
        until(lambda: "after changes in Tally were brought in" in pg.evaluate("(((S.books.mis || {}).history || [])[0] || {}).how || ''"), 120, 2)
        how = pg.evaluate("(((S.books.mis || {}).history || [])[0] || {}).how || ''")
        ok("after changes in Tally were brought in" in how, "with MIS open and nothing pressed, the change arrived by itself and MIS was worked out again: " + how)
        ok(pg.evaluate("!!(S.books.stale || {}).audit"), "the audit is marked out of date, to be worked out when its tab is opened (not on every change)")
        pg.evaluate("(t) => { S.booksTab = t; render(); }", tab0); pg.wait_for_selector("#lkAsk")
        # ---------- a new entry
        g_new = "keep-test-new-0001"
        fake_tally.add_copy(g_edit, "20260315", g_new)
        ok(until(lambda: (pg.evaluate("LK.fr().at = 0; LK.autoFresh(true)") or True) and pg.evaluate("(g) => !!S.books.vouchers.find(x => x.id === g)", g_new), 120, 3), "a new entry in Tally reaches FinCom")
        # ---------- a deletion
        g_del = re.search(r"<GUID>([^<]*)</GUID>", march[20][1]).group(1)
        fake_tally.delete(g_del)
        ok(until(lambda: (pg.evaluate("LK.fr().at = 0; LK.autoFresh(true)") or True) and not pg.evaluate("(g) => !!S.books.vouchers.find(x => x.id === g)", g_del), 300, 3), "an entry deleted in Tally goes from FinCom too")
        fresh = lambda: (pg.evaluate("LK.fr().at = 0; LK.autoFresh(true)") or True) and pg.wait_for_timeout(300) is None
        has = lambda g: pg.evaluate("(g) => S.books.vouchers.filter(x => x.id === g).map(x => x.date)", g)
        amt = lambda g: pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); return v ? v.ent.map(e => e.a) : null; }", g)
        # ---------- an entry whose date is changed in Tally: on its new date only, never twice
        g_mv = re.search(r"<GUID>([^<]*)</GUID>", march[2][1]).group(1); d_old = march[2][0]
        fake_tally.move_date(g_mv, "20260328")
        ok(until(lambda: fresh() and has(g_mv) == ["20260328"], 150, 3), "an entry moved to another date in Tally is on the new date only (was %s): %s" % (d_old, has(g_mv)))
        # ---------- this month: a new entry, then deleted (deleted entries are found by comparing this month often)
        tm = time.strftime("%Y%m") + "05"
        g_now = "keep-test-now-0001"; fake_tally.add_copy(g_edit, tm, g_now)
        ok(until(lambda: fresh() and has(g_now) == [tm], 120, 3), "an entry made in Tally this month reaches FinCom")
        t_del = time.time(); fake_tally.delete(g_now)
        ok(until(lambda: fresh() and has(g_now) == [], 120, 2), "and when it is deleted in Tally it goes from FinCom within %.0fs" % (time.time() - t_del))
        # ---------- ledger masters: renamed, opening changed, a new ledger with an opening balance
        used = {}
        for d, pc in march:
            for n in re.findall(r"<LEDGERNAME>([^<]*)</LEDGERNAME>", pc): used[n] = used.get(n, 0) + 1
        dollar = lambda n: any(re.search(r"<LEDGERNAME>" + re.escape(n) + r"</LEDGERNAME>.*?<AMOUNT>[^<]*[$@=]", pc, re.S) for d, pc in fake_tally.V if "<LEDGERNAME>" + n + "</LEDGERNAME>" in pc)
        cands = [n for n, c in sorted(used.items(), key=lambda z: -z[1]) if "&" not in n and "BANK" not in n and n in fake_tally.LGUID and not dollar(n)]
        old_n, op_n = cands[0], cands[1]
        new_n = old_n + " (RENAMED)"
        fake_tally.rename_ledger(old_n, new_n)
        ob0 = [o for n, p_, o in fake_tally.L if n == op_n][0]; fake_tally.set_opening(op_n, ob0 - 7777)
        fake_tally.add_ledger("KEEP TEST NEW LEDGER", "Sundry Debtors", -12345.0)
        names = lambda: pg.evaluate("(() => { const s = new Set(); S.books.vouchers.forEach(v => v.ent.forEach(e => s.add(e.l))); return [...s]; })()")
        ok(until(lambda: fresh() and (lambda z: new_n in z and old_n not in z)(names()), 150, 3), "a ledger renamed in Tally: FinCom's entries carry the new name (%s)" % new_n)
        def tb_diff():
            pg.evaluate("S.lk.res = null"); pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
            wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
            return pg.evaluate("""async () => { const mine = {}; S.lk.res.rows.forEach(z => { mine[z.l] = z.bal; });
              const j = await Bridge.call('/tb?company=' + encodeURIComponent(LK.tname()) + '&to=20260331'); const bad = [];
              j.ledgers.forEach(([n, p, b]) => { const t = -Books.amt(b), m = mine[n] || 0; if (Math.abs(t - m) >= 1) bad.push(n); });
              return {n: j.ledgers.length, bad, nl: mine['KEEP TEST NEW LEDGER'] || 0}; }""")
        good = lambda x: all(fx(n) for n in x["bad"]) and len(x["bad"]) <= 3 and x["nl"]
        dd = until(lambda: fresh() and (lambda x: x if good(x) else None)(tb_diff()), 150, 4) or tb_diff()
        ok(good(dd), "after the renamed ledger, the changed opening and the new ledger, every ledger still agrees with Tally (%d of %d): %s" % (dd["n"] - len(dd["bad"]), dd["n"], ", ".join(dd["bad"][:6])))
        # ---------- a day Tally cannot give: no hammering, the day is shown as not read, and read once Tally can
        g_p = [re.search(r"<GUID>([^<]*)</GUID>", pc).group(1) for d, pc in fake_tally.V if d == "20260318"][0]
        a_p = amt(g_p)
        fake_tally.CTRL["fail_days"] = ["20260318"]; n0 = len(fake_tally.LOG)
        fake_tally.edit_amount(g_p, 3)
        sk = until(lambda: "20260318" in ((man() or {}).get("skipped") or []), 120, 2)
        ok(bool(sk), "a day Tally cannot give is noted as not read (the rest carries on)")
        fresh(); pg.wait_for_timeout(800)
        ok("not read" in pg.inner_text(".lk-fresh"), "the page says which day is not read yet: " + pg.inner_text(".lk-fresh")[:200].replace("\n", " "))
        time.sleep(40)
        tries = [x for x in fake_tally.LOG[n0:] if x[0] == "DayBook" and x[1] <= "20260318" <= x[2]]
        ok(len(tries) <= 6, "and Tally is not asked for it again and again: %d tries in about a minute" % len(tries))
        fake_tally.CTRL["fail_days"] = []
        ok(until(lambda: not ((man() or {}).get("skipped") or []), 240, 3), "once Tally can give the day, it is read and the note goes")
        ok(until(lambda: fresh() and amt(g_p) and a_p and abs(amt(g_p)[0] - 3 * a_p[0]) < 0.05, 60, 3), "and the change on that day reaches FinCom: %s -> %s" % (a_p[:1] if a_p else None, (amt(g_p) or [None])[:1]))
        # ---------- change numbers gone back (a backup restored): noticed, every month checked again, nothing lost
        fake_tally.renumber_down(100000)
        g_r = "keep-test-after-restore"; fake_tally.add_copy(g_edit, "20260312", g_r)
        ok(until(lambda: fresh() and has(g_r) == ["20260312"], 300, 3), "after Tally's change numbers went back, a new entry still reaches FinCom")
        # ---------- the check against Tally, for March
        # the company is being copied again after the restore: the check agrees once that copy has reached March again
        ck = lambda: pg.evaluate("async () => await Bridge.call('/keepcheck?company=' + encodeURIComponent(LK.tname()) + '&ym=202603')")
        good_ck = lambda c: c.get("listMatchesDayBook") and c.get("missing") == 0 and c.get("extra") == 0 and c.get("differ") == 0
        chk = until(lambda: (lambda c: c if good_ck(c) else None)(ck()), 300, 10) or ck()
        ok(chk.get("listMatchesDayBook") and chk.get("missing") == 0 and chk.get("extra") == 0 and chk.get("differ") == 0, "the check against Tally agrees: " + json.dumps(chk))
        pg.click('[data-lk="keepcheck"]'); wait_for(pg, "LK.fr().check && !LK.fr().busy", 60)
        ok("against Tally" in pg.inner_text(".lk-fresh"), "Check against Tally shows its answer on the page")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
        br.close()
    log = open(glob.glob(_os.path.join(BRUN, "*.log"))[0], encoding="utf-8", errors="replace").read() if glob.glob(_os.path.join(BRUN, "*.log")) else ""
    ok("Keeping copies in step: started" in log and "in step with Tally" in log, "the bridge's log tells the story")
    ok("could not give 20260318" in log or "did not give 20260318" in log, "the log says which day Tally could not give")
    ok("change numbers have gone back" in log, "the log says Tally's change numbers went back")
finally:
    br_p.terminate()
    try: (br_p if 'br_p' in dir() else br).wait(10)
    except Exception:
        try: (br_p if 'br_p' in dir() else br).kill()
        except Exception: pass
    for f in glob.glob(_os.path.join(BRUN, "sync", "keep.pid")):
        try:
            pid = int(open(f).read().strip() or 0)
            if pid: os.kill(pid, 15)
        except Exception: pass
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
