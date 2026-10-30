"""python3 run_older_entries_ui.py - books from Tally by themselves, with a progress bar and its timing, and an uploaded Day
Book checked against Tally. THE DECISION (the owner, 30-Oct-2026; supersedes the 26-Oct-2026 "upload only" decision this
test used to pin): "there should be two ways.. one is automatically updating books from tally and giving progress bar and
timing with that bar.. also if anyone uploads any books and there is any difference.. it should find out the difference in
tally and correct it"; "tally should not hang". And (30-Oct-2026): on the Tally page, what FinCom received from Tally
TODAY per company, the counts equal to the list, no computer's name. The React test build (app/dist-test), made-up books:
  1. Books › From Tally, "Bring books from Tally: [FY 2026-27 ▾] Start" (the years the books cover, the current one first),
     owner and staff: Start, Pause / Resume / Stop; the bar "8,412 of 12,960 entries (65%) · about 40 min left · started
     10:42 · 113 entries a minute"; "working out the time…" until the pace is known; counting days; done; paused and stopped
     say why ("Paused. Press Resume to go on.", "Stopped: Tally was busy; press Resume."; Resume of a stop chooses again);
     Tally not free yet said in words; a computer whose reading of older entries is off: the owner's one click "Turn on for
     this computer" (tally_device_period_fetch), staff told who can; a viewer sees the bar without buttons. The plain upload
     line stays above the drop box.
  2. Books › From Tally, "Upload checked against Tally": "12-Aug: 2 entries in Tally not in the upload (added)",
     "15-Sep: 1 changed (updated)", "3-Oct: 1 deleted in Tally (removed, kept in history)", the total line, the days the same
     ticked; stopped: Resume (tally_check_resume).
  3. The Tally page: the status card says per company "Today from Tally: 3 entries added · 2 changed · 1 deleted · 12 older
     entries brought in (last 15:42 IST)", which opens the list (date, voucher, party, amount, what happened) whose counts equal
     the line; the client's row has its bar line and its today line; no computer name or Windows login in them.
  4. The build: the new cards in a file loaded only with the Tally screens (never the first file or legacy.js); the first file and legacy.js within
     their budgets (260 / 600 KB gzip). No console error; at 390 wide no page scrolls sideways.
Run: TDSDESK_SITE=../app/dist-test python3 run_older_entries_ui.py [--shots DIR]"""
import os, re, sys, json, glob, gzip, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import uploadpage_setup as U
import run_tally_page_clean as TP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
fails, errors, cons = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LINE = "Older entries: in Tally open Day Book, choose the period (Alt+F2), E: Export → File Format (F8): XML or JSON, then drop the file here."
T = datetime.datetime.utcnow().strftime("%Y-%m-%d")
AT1042, AT1542 = T + "T05:12:00Z", T + "T10:12:00Z"
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
FYN = IST.year - (1 if IST.month < 4 else 0)
FYL = "FY %d-%s" % (FYN, str(FYN + 1)[2:])
GOING = {"fy": "%d0401" % FYN, "part": "year", "state": "going", "counting": False, "yearDays": 365, "countedDays": 365, "y": 12960, "x": 8412, "left": 4548, "done": False,
         "etaMin": 40, "rate": 113, "pace": "day", "chosenAt": AT1042, "upload": [], "stopped": None}
def SUMB(cid, **k):
    b = {"book": "bk-zz", "client": cid, "company": "ZZ", "from": "%d-04-01" % (FYN - 1), "pull": None, "devices": [{"id": "d-1", "fetchOn": True}],
         "today": {"added": 3, "changed": 2, "deleted": 1, "older": 12, "corrected": 0, "last": AT1542}, "check": None}
    b.update(k); return b
def ROWS():
    r = [{"at": AT1542, "day": "2026-10-29", "vtype": "Sales", "vno": "S-%d" % i, "party": "Made-up Traders", "amount": 1180.0, "what": "added", "via": "tally"} for i in range(3)]
    r += [{"at": AT1042, "day": "2026-10-28", "vtype": "Receipt", "vno": "R-%d" % i, "party": "Made-up Buyer", "amount": 500.0, "what": "changed", "via": "tally"} for i in range(2)]
    r += [{"at": AT1042, "day": "2026-10-27", "vtype": "Payment", "vno": "P-1", "party": "", "amount": 99.5, "what": "deleted", "via": "tally"}]
    r += [{"at": AT1042, "day": "2025-06-%02d" % (i + 1), "vtype": "Sales", "vno": "O-%d" % i, "party": "Old Party", "amount": 10.0, "what": "added", "via": "older"} for i in range(12)]
    return {"ok": True, "rows": r, "total": len(r), "counts": {"added": 3, "changed": 2, "deleted": 1, "older": 12, "corrected": 0}, "last": AT1542}
CHECK = {"ok": True, "run": {"state": "going"}, "period": None, "total": 20, "checked": 18, "same": 15, "fixed": 3, "waiting": 2, "upload": 0, "added": 2, "updated": 1, "removed": 1,
         "totalWords": "In all: 2 added · 1 updated · 1 removed",
         "lines": [{"day": "%d10%02d" % (FYN, i + 1), "state": "same", "words": "the same as Tally"} for i in range(15)] +
                  [{"day": "%d0812" % FYN, "state": "fixed", "words": "2 entries in Tally not in the upload (added)"}, {"day": "%d0915" % FYN, "state": "fixed", "words": "1 changed (updated)"},
                   {"day": "%d1003" % FYN, "state": "fixed", "words": "1 deleted in Tally (removed, kept in history)"},
                   {"day": "%d1020" % FYN, "state": "waiting", "words": "waiting for Tally"}, {"day": "%d1021" % FYN, "state": "waiting", "words": "waiting for Tally"}]}
MOCK = """([sum, chk, today]) => { window.__sum = sum; window.__chk = chk; window.__today = today; window.__rpc = window.__rpc || [];
  if (!window.__base) window.__base = TCloud.rpc;
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); await new Promise(r => setTimeout(r, 5));
    if (fn === 'tally_fetch_summary') return {ok: true, books: [].concat(window.__sum || [])};
    if (fn === 'tally_check_status') return JSON.parse(JSON.stringify(window.__chk));
    if (fn === 'tally_today_from_tally') return JSON.parse(JSON.stringify(window.__today));
    if (fn === 'tally_status') return window.__base(fn, a);
    return {ok: true}; };
  if (typeof tfxRefresh === 'function') tfxRefresh(); }"""

def main():
    with sync_playwright() as p:
        srv, br, pg = U.start(p, 8455, SITE, errors=errors)
        pg.on("console", lambda m: cons.append(m.text[:160] + " @" + str((m.location or {}).get("url", ""))[:80]) if m.type == "error" else None)
        E = pg.evaluate
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda fn: [c[1] for c in E("window.__rpc || []") if c[0] == fn]
        def state(sum_, chk=None, wait=900):
            E(MOCK, [sum_, chk or {"ok": True, "total": 0, "lines": []}, ROWS()]); E("() => { if (typeof tfxRefresh === 'function') tfxRefresh(); render(); }"); pg.wait_for_timeout(wait)
        def shot(name, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)

        print("== 1. Books › From Tally: Bring books from Tally")
        cid = U.open_page(pg, "owner")
        E(MOCK, [[SUMB("__CID__")], {"ok": True, "total": 0, "lines": []}, ROWS()])
        E("""(cid) => { window.__sum = window.__sum.map(b => Object.assign(b, {client: cid})); TCloud.st[cid] = Object.assign(TCloud.st[cid] || {}, {books: [{book: "bk-zz", company: "ZZ", from: "%d-04-01", openAsOn: "%d-03-31", days: 10, entries: 100, to: "2026-10-20", ledgersAt: new Date().toISOString(), state: {}}], at: Date.now()});
            S.booksTab = "overview"; render(); setTimeout(() => { S.booksTab = "import"; render(); }, 60); }""" % (FYN - 1, FYN - 1), cid); pg.wait_for_timeout(2200)
        sb = lambda **k: [SUMB(cid, **k)]
        card = "#app [data-older-entries]"
        ok(n(card) == 1 and txt(card + " h3") == "Bring books from Tally", "1. the card is there: Bring books from Tally")
        opts = E("() => [...document.querySelectorAll('#app [data-older-fy] option')].map(o => o.textContent)")
        ok(opts and opts[0] == FYL and E("() => document.querySelector('#app [data-older-fy] option:checked').textContent") == FYL and len(opts) == 2, "1. the years the books cover, the current one chosen (%s)" % opts)
        ok(E("() => { const s = document.querySelector('#app [data-older-entries] [data-older-fy]'), b = document.querySelector('#app [data-older-entries] [data-older-start]'); return !!s && !!b && Math.abs(s.getBoundingClientRect().top - b.getBoundingClientRect().top) < 12; }") and n(card + " [data-older-start]") == 1 and n(card + " [data-older-pause]") == 0, "1. '[FY ▾] Start'")
        ok(txt("#app [data-up-older]") == LINE, "1. the plain upload line stays (%s)" % txt("#app [data-up-older]"))
        pg.click(card + " [data-older-start]"); pg.wait_for_timeout(500)
        # 30-Oct-2026, 16:30 (the owner): Start walks only the days FinCom lacks (migration 135's tally_period_choose_lean)
        ok(calls("tally_period_choose_lean")[-1:] == [{"p_book": "bk-zz", "p_fy_start": "%d-04-01" % FYN, "p_part": "year"}], "1. Start chooses the year, walking only what FinCom lacks (%s)" % calls("tally_period_choose_lean")[-1:])
        state(sb(pull=GOING))
        w = txt(card + " [data-older-words]")
        ok(w == FYL + ": 8,412 of 12,960 entries (65%) · about 40 min left · started 10:42 IST · 113 entries a minute", "1. the bar's words (%s)" % w)
        ok(E("() => document.querySelector('#app [data-older-entries] [role=progressbar]').getAttribute('aria-valuenow')") == "65" and n(card + " [data-older-why]") == 0, "1. the bar at 65%, nothing in the way")
        ok(n(card + " [data-older-pause]") == 1 and n(card + " [data-older-stop]") == 1 and n(card + " [data-older-start]") == 0, "1. going: Pause and Stop")
        ok("2 seconds" in txt(card + " [data-older-safe]") and "never hangs" in txt(card + " [data-older-safe]"), "1. Tally never hangs, said once (%s)" % txt(card + " [data-older-safe]"))
        shot("from-tally-going-1366")
        pg.click(card + " [data-older-pause]"); pg.wait_for_timeout(400)
        ok(calls("tally_period_pause")[-1:] == [{"p_book": "bk-zz", "p_pause": True}], "1. Pause")
        pg.click(card + " [data-older-stop]"); pg.wait_for_timeout(400)
        ok(calls("tally_period_cancel")[-1:] == [{"p_book": "bk-zz"}], "1. Stop")
        state(sb(pull=dict(GOING, etaMin=None, rate=None)))
        ok(txt(card + " [data-older-words]") == FYL + ": 8,412 of 12,960 entries (65%) · working out the time… · started 10:42 IST", "1. working out the time until the pace is known (%s)" % txt(card + " [data-older-words]"))
        state(sb(pull=dict(GOING, pace=None, etaMin=None, rate=None)))
        ok(txt(card + " [data-older-why]").startswith("Waiting for Tally to be free"), "1. Tally not free yet, said (%s)" % txt(card + " [data-older-why]"))
        state(sb(pull=dict(GOING, counting=True, countedDays=132, yearDays=365, etaMin=12)))
        ok(txt(card + " [data-older-words]") == FYL + ": Counting the year in Tally: 132 of 365 days (36%) · about 12 min left · started 10:42 IST", "1. counting (%s)" % txt(card + " [data-older-words]"))
        state(sb(pull=dict(GOING, state="paused", etaMin=None, pace=None)))
        ok(txt(card + " [data-older-why]") == "Paused. Press Resume to go on." and "min left" not in txt(card + " [data-older-words]"), "1. paused: why, no time left (%s)" % txt(card + " [data-older-why]"))
        pg.click(card + " [data-older-resume]"); pg.wait_for_timeout(400)
        ok(calls("tally_period_pause")[-1:] == [{"p_book": "bk-zz", "p_pause": False}], "1. Resume")
        state(sb(pull=dict(GOING, state="stopped", etaMin=None, stopped={"why": "window", "words": "Tally stopped answering.", "day": "%d0712" % FYN})))
        ok(txt(card + " [data-older-why]") == "Stopped: Tally was busy; press Resume.", "1. stopped by the bridge: one plain line (%s)" % txt(card + " [data-older-why]"))
        shot("from-tally-stopped-1366")
        pg.click(card + " [data-older-resume]"); pg.wait_for_timeout(400)
        ok(calls("tally_period_choose")[-1:] == [{"p_book": "bk-zz", "p_fy_start": "%d-04-01" % FYN, "p_part": "year"}], "1. Resume after a stop chooses the period again")
        state(sb(pull=dict(GOING, state="stopped", etaMin=None, stopped={"why": "person"})))
        ok(txt(card + " [data-older-why]") == "Stopped. Press Start to begin again." and n(card + " [data-older-start]") == 1, "1. stopped by the person: Start")
        state(sb(pull=dict(GOING, done=True, x=12960, left=0)))
        ok(txt(card + " [data-older-words]") == FYL + ": All 12,960 entries of " + FYL + " are in FinCom ✓", "1. done (%s)" % txt(card + " [data-older-words]"))
        state(sb(pull=GOING, devices=[{"id": "d-1", "fetchOn": False}]))
        ok(txt(card + " [data-older-why]").startswith("Waiting: reading older entries is off for the Tally computer") and n(card + " [data-tfx-turnon]") == 1, "1. the switch off: the owner's one click (%s)" % txt(card + " [data-older-why]"))
        pg.click(card + " [data-tfx-turnon]"); pg.wait_for_timeout(500)
        ok(calls("tally_device_period_fetch")[-1:] == [{"p_device": "d-1", "p_on": True}], "1. Turn on for this computer (%s)" % calls("tally_device_period_fetch")[-1:])
        E("() => { S.account.me.role = 'staff'; render(); }"); pg.wait_for_timeout(400)
        ok(n(card + " [data-tfx-turnon]") == 0 and "An owner of the firm can turn it on." in txt(card + " [data-older-why]") and n(card + " [data-older-pause]") == 1, "1. staff: told who can, and may pause")
        E("() => { S.account.me.role = 'readonly'; render(); }"); pg.wait_for_timeout(400)
        ok(n(card + " [data-older-pause]") == 0 and n(card + " [data-older-start]") == 0 and n(card + " [data-older-progress]") == 1, "1. a viewer: the bar, no buttons")
        E("() => { S.account.me.role = 'owner'; render(); }"); pg.wait_for_timeout(300)

        print("== 2. Books › From Tally: the upload checked against Tally")
        state(sb(pull=GOING, check={"total": 20, "same": 15, "fixed": 3, "waiting": 2, "upload": 0, "run": {"state": "going"}}), CHECK, 1400)
        ck = "#app [data-upload-check]"
        items = E("() => [...document.querySelectorAll('#app [data-check-day]')].map(e => e.textContent)")
        ok(n(ck) == 1 and items == ["12-Aug: 2 entries in Tally not in the upload (added)", "15-Sep: 1 changed (updated)", "3-Oct: 1 deleted in Tally (removed, kept in history)"], "2. the plain list (%s)" % items)
        ok(txt(ck + " [data-check-total]").startswith("In all: 2 added · 1 updated · 1 removed"), "2. the total line (%s)" % txt(ck + " [data-check-total]"))
        ok(txt(ck + " [data-check-head]") == "Checked 18 of 20 days against Tally · 15 days the same ✓ · 3 days corrected to Tally", "2. the head line (%s)" % txt(ck + " [data-check-head]"))
        ok("2 days are waiting" in txt(ck + " [data-check-waiting]"), "2. the days waiting said (%s)" % txt(ck + " [data-check-waiting]"))
        pg.click(ck + " [data-check-same-show]"); pg.wait_for_timeout(300)
        ok(txt(ck + " [data-check-same]").count("✓") == 15, "2. the days the same ticked")
        ok(E("() => { const a = document.querySelector('#app [data-up-card]'), c = document.querySelector('#app [data-upload-check]'); return !!a && !!c && !!(a.compareDocumentPosition(c) & 4); }"), "2. under the upload")
        shot("from-tally-check-1366")
        state(sb(pull=GOING, check={"total": 20, "same": 15, "fixed": 3, "waiting": 2, "upload": 0, "run": {"state": "stopped"}}), dict(CHECK, run={"state": "stopped", "why": "window"}), 1400)
        ok(txt(ck + " [data-check-stopped]").startswith("Stopped: Tally was busy; press Resume."), "2. stopped said (%s)" % txt(ck + " [data-check-stopped]"))
        pg.click(ck + " [data-check-resume]"); pg.wait_for_timeout(600)
        ok(calls("tally_check_resume")[-1:] == [{"p_book": "bk-zz"}], "2. Resume")
        pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(600)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "2. 390 wide: no sideways scroll")
        shot("from-tally-390")
        pg.set_viewport_size({"width": 1366, "height": 900}); pg.wait_for_timeout(400)

        print("== 3. The Tally page: Today from Tally, per company; the row's bar")
        pg.goto("http://localhost:8455/"); pg.wait_for_timeout(2500)
        if n('button[data-act="useOffline"]'): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        d6 = TP.dev(7, "NWS144", "anshul", tally="open", opened=("ABC TRADERS",), version="2.4.9")
        books = {"garg shekhar & company": TP.book("garg shekhar & company"), "ABC TRADERS": TP.book("ABC TRADERS"), "GB TEXCOAT": TP.book("GB TEXCOAT")}
        two = TP.companies(linked=("ABC TRADERS", "garg shekhar & company"), seen=(), d=d6["id"])
        ids = E(TP.SETUP, [[d6], two, [], "owner", TP.CLIENTS, True, books]); pg.wait_for_timeout(1500)
        ac = ids["ABC TRADERS"]
        E("() => { window.__rpc = []; window.__base = null; }")
        E(MOCK, [[dict(SUMB(ac), book="bk-ABC TRADERS", company="ABC TRADERS", pull=GOING)], {"ok": True, "total": 0, "lines": []}, ROWS()]); pg.wait_for_timeout(300)
        E("() => { render(); }"); pg.wait_for_timeout(1800)
        st = "#app [data-status-card] [data-today-status]"
        line = txt(st + " [data-today-open]")
        ok(line == "ABC TRADERS: Today from Tally: 3 entries added · 2 changed · 1 deleted · 12 older entries brought in (last 15:42 IST)", "3. the status card, per company (%s)" % line)
        ok("8,412 of 12,960 entries (65%)" in txt(st + " [data-older-status]"), "3. the status card: the books being brought (%s)" % txt(st + " [data-older-status]"))
        pg.click(st + " [data-today-open]"); pg.wait_for_timeout(800)
        nrows = n(st + " [data-today-row]")
        ok(nrows == 18 and txt(st + " [data-today-open]") == line, "3. the list: 18 rows, the line's counts the list's own (%d)" % nrows)
        ok(E("() => [...document.querySelectorAll('#app [data-today-table] th')].map(t => t.textContent).join('|')") == "Date|Voucher|Party|Amount|What happened|At", "3. date, voucher, party, amount, what happened")
        ok(n(st + " [data-today-row='tally:deleted']") == 1 and "deleted in Tally" in txt(st + " [data-today-row='tally:deleted']") and n(st + " [data-today-row='older:added']") == 12, "3. what happened, in words")
        shot("tally-today-1366")
        row = "#app [data-tlk-row='%s'] [data-tfx-row]" % ac
        ok("8,412 of 12,960 entries (65%) · about 40 min left" in txt(row + " [data-older-line]") and txt(row + " [data-today-open]").startswith("Today from Tally: 3 entries added · 2 changed · 1 deleted"), "3. the client's row: its bar line and its today line (%s)" % txt(row))
        ok(not re.search(r"NWS144|anshul", txt(st) + " " + txt(row)), "3. no computer name or Windows login in them")
        pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(600)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "3. 390 wide: no sideways scroll")
        shot("tally-today-390")
        pg.set_viewport_size({"width": 1366, "height": 900})

        print("== 4. the build")
        js = glob.glob(os.path.join(SITE, "assets", "*.js"))
        holds = [os.path.basename(f) for f in js if "Bring books from Tally" in open(f, encoding="utf-8", errors="replace").read()]
        first = glob.glob(os.path.join(SITE, "assets", "index-*.js")); leg = os.path.join(SITE, "legacy.js")
        gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6)) // 1024
        ok(holds and not [h for h in holds if h.startswith("index-")] and "Bring books from Tally" not in open(leg, encoding="utf-8", errors="replace").read(), "4. the cards in a file loaded only with the Tally screens, not the first file or legacy.js (%s)" % holds)
        ok(first and sum(gz(f) for f in first) <= 260 and gz(leg) <= 600, "4. the first file %d KB and legacy.js %d KB gzip within 260 / 600" % (sum(gz(f) for f in first), gz(leg)))
        # (the Tally page's own look for a FinCom Bridge on this computer, /ping on 127.0.0.1, finds none in the test: not an error of the page)
        ok(not errors and not [c for c in cons if "PGRST202" not in c and "404" not in c and not re.search(r"@http://127\.0\.0\.1:\d+/ping", c)], "no page error or console error (%s %s)" % (errors[:2], cons[:2]))
        br.close(); srv.shutdown()

    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
