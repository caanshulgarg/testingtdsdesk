"""python3 run_check_changes_ui.py - the one button "Check for changes in Tally". THE DECISION (the owner, 30-Oct-2026):
"there should be a button 'check any change'.. if there is any change then it should do it". On Books › From Tally and on
the client's row of the Tally page. The React test build (app/dist-test), made-up books, FinCom's cloud made up in the page:
  1. Books › From Tally: the card "Check for changes in Tally": the period (this financial year so far by default, this
     month, the last 7 days, dates of one's own never before the books start or after today) and its days said
     ("1-Apr to 30-Oct"); the press queues those days (tally_check_request with the client and the period).
  2. progress: "Checked 120 of 213 days · about 6 min left (1-Apr to 30-Oct)" with the bar; waiting for a running "Bring
     books from Tally" said ("the check goes next"); paused; stopped (Tally busy); the computer's reading of older entries
     off: the owner's "Turn on for this computer", staff a plain line, a viewer no button.
  3. a changed day corrected and listed: "Done: 5 changes made from Tally — 3 added, 1 changed, 1 deleted (kept in
     history). 208 days already matched." and the list (date, voucher, party, amount, what FinCom did); a day that could not
     be checked offers its upload.
  4. nothing changed: "No changes: FinCom matches Tally for 1-Apr to 30-Oct".
  7. (the owner, 30-Oct-2026, 16:30: "why don't we automatically bring only those days instead of all") the missing days
     ("N days need a Day Book") asked of Tally by themselves, once, with no button: "Bringing 2 missing days from Tally ·
     about 1 min left", then "Brought 2 missing days from Tally ✓ (1 entry added)"; "Bring books from Tally" Start walks
     only what FinCom lacks (tally_period_choose_lean) and says "213 days: 206 already in FinCom, 7 to bring."; the honest
     pace (office hours or night).
  5. the Tally page: the client's row has the button, its progress and its result, the list one click away; no computer
     name in it.
  6. the build: in a file loaded only with the Tally screens (never the first file or legacy.js); the first file and
     legacy.js within 260 / 600 KB gzip. No console error; at 390 wide no page scrolls sideways.
Run: TDSDESK_SITE=../app/dist-test python3 run_check_changes_ui.py [--shots DIR]"""
import os, re, sys, glob, gzip, datetime
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
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
FYN = IST.year - (1 if IST.month < 4 else 0)
FROM = datetime.date(FYN, 4, 1)
d8 = lambda d: "%d-%s" % (d.day, MON[d.month - 1])
dl = lambda d: "%02d-%s-%d" % (d.day, MON[d.month - 1], d.year)
RANGE = (d8(FROM) + " to " + d8(TODAY)) if FROM.year == TODAY.year else (dl(FROM) + " to " + dl(TODAY))
F8, T8 = FROM.strftime("%Y%m%d"), TODAY.strftime("%Y%m%d")
NOW = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
GOING = {"fy": "%d0401" % FYN, "part": "year", "state": "going", "counting": False, "yearDays": 365, "countedDays": 365, "y": 12960, "x": 8412, "left": 4548, "done": False,
         "etaMin": 40, "rate": 113, "pace": "day", "chosenAt": NOW, "upload": [], "stopped": None}
def SUMB(cid, **k):
    b = {"book": "bk-zz", "client": cid, "company": "ZZ", "from": "%d-04-01" % (FYN - 1), "pull": None, "devices": [{"id": "d-1", "fetchOn": True}],
         "today": {"added": 0, "changed": 0, "deleted": 0, "older": 0, "corrected": 0, "last": None}, "check": None}
    b.update(k); return b
def ASK(cid, **k):
    a = {"book": "bk-zz", "client": cid, "company": "ZZ", "from": F8, "to": T8, "days": 213, "at": NOW, "state": "queued", "total": 213, "checked": 0, "same": 0, "fixed": 0,
         "waiting": 213, "upload": 0, "etaMin": None, "added": 0, "changed": 0, "deleted": 0, "uploadDays": [], "after": False, "paused": False, "run": {"state": "going"}}
    a.update(k); return a
HOURS = {"from": 20, "to": 8, "sunday": True}
def _night():
    t = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
    return t.weekday() == 6 or t.hour >= 20 or t.hour < 8
PACE = "Night pace (20:00–08:00): up to 30 days at a time." if _night() else "Office hours pace: a few days at a time, only while Tally is free; faster from 20:00 (up to 30 days at a time)."
ROWS = [{"at": NOW, "day": "%d-08-12" % FYN, "vtype": "Sales", "vno": "S-%d" % i, "party": "Made-up Traders", "amount": 1180.0, "what": "added"} for i in range(3)] + \
       [{"at": NOW, "day": "%d-09-15" % FYN, "vtype": "Receipt", "vno": "R-7", "party": "Made-up Buyer", "amount": 500.0, "what": "changed"},
        {"at": NOW, "day": "%d-10-03" % FYN, "vtype": "Payment", "vno": "P-1", "party": "", "amount": 99.5, "what": "deleted"}]
MOCK = """([sum, ask, req, books]) => { window.__sum = sum; window.__ask = ask; window.__req = req; window.__books = books || []; window.__rpc = window.__rpc || [];
  if (!window.__base) window.__base = TCloud.rpc;
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); await new Promise(r => setTimeout(r, 5));
    if (fn === 'tally_fetch_summary') return {ok: true, books: [].concat(window.__sum || [])};
    if (fn === 'tally_check_ask_status') { const k = window.__ask ? JSON.parse(JSON.stringify(window.__ask)) : null; if (k && !a.p_client) delete k.rows; return {ok: true, asks: k ? [k] : [], books: JSON.parse(JSON.stringify(window.__books || []))}; }
    if (fn === 'tally_check_request') return JSON.parse(JSON.stringify(window.__req || {ok: true}));
    if (fn === 'tally_check_status') return {ok: true, total: 0, lines: []};
    if (fn === 'tally_today_from_tally') return {ok: true, rows: [], counts: {}};
    if (fn === 'tally_status') return window.__base(fn, a);
    return {ok: true}; };
  if (typeof tfxRefresh === 'function') tfxRefresh(); }"""

def main():
    with sync_playwright() as p:
        srv, br, pg = U.start(p, 8457, SITE, errors=errors)
        pg.on("console", lambda m: cons.append(m.text[:160] + " @" + str((m.location or {}).get("url", ""))[:80]) if m.type == "error" else None)
        E = pg.evaluate
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda fn: [c[1] for c in E("window.__rpc || []") if c[0] == fn]
        def state(sum_, ask=None, wait=1200, books=None):
            E(MOCK, [sum_, ask, None, books]); E("() => { if (typeof tfxRefresh === 'function') tfxRefresh(); render(); }"); pg.wait_for_timeout(300)
            # a fresh mount (the card's own answer to a press forgotten), the firm's list of presses read again
            E("() => { S.booksTab = 'overview'; render(); setTimeout(() => { S.booksTab = 'import'; render(); }, 60); }"); pg.wait_for_timeout(wait)
        def shot(name, full=True):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)

        print("== 1. Books › From Tally: the button and its period")
        cid = U.open_page(pg, "owner")
        E(MOCK, [[SUMB("__CID__")], None, None, None])
        E("""(cid) => { window.__sum = window.__sum.map(b => Object.assign(b, {client: cid})); TCloud.st[cid] = Object.assign(TCloud.st[cid] || {}, {books: [{book: "bk-zz", company: "ZZ", from: "%d-04-01", openAsOn: "%d-03-31", days: 10, entries: 100, to: "2026-10-20", ledgersAt: new Date().toISOString(), state: {}}], at: Date.now()});
            S.booksTab = "overview"; render(); setTimeout(() => { S.booksTab = "import"; render(); }, 60); }""" % (FYN - 1, FYN - 1), cid); pg.wait_for_timeout(2200)
        sb = lambda **k: [SUMB(cid, **k)]
        card = "#app [data-check-changes='books']"
        ok(n(card) == 1 and txt(card + " h3") == "Check for changes in Tally", "1. the card is there: Check for changes in Tally")
        ok(n(card + " [data-cc-go]") == 1 and txt(card + " [data-cc-go]") == "Check for changes in Tally", "1. ONE button: Check for changes in Tally")
        opts = E("() => [...document.querySelectorAll(\"#app [data-check-changes='books'] [data-cc-period] option\")].map(o => o.textContent)")
        ok(opts == ["This financial year so far", "This month", "Last 7 days", "Dates of my own…"] and E("() => document.querySelector(\"#app [data-check-changes='books'] [data-cc-period]\").value") == "fy", "1. the period: this financial year so far by default (%s)" % opts)
        ok(txt(card + " [data-cc-range]") == RANGE, "1. its days said (%s)" % txt(card + " [data-cc-range]"))
        E("([cid, a]) => { window.__req = a; }", [cid, dict(ASK(cid), ok=True)])
        pg.click(card + " [data-cc-go]"); pg.wait_for_timeout(700)
        ok(calls("tally_check_request")[-1:] == [{"p_client": cid, "p_from": FROM.isoformat(), "p_to": TODAY.isoformat()}], "1. the press queues the days: the client and the period (%s)" % calls("tally_check_request")[-1:])
        ok(txt(card + " [data-cc-words]").startswith("Checked 0 of 213 days"), "1. the days queued: progress at once (%s)" % txt(card + " [data-cc-words]"))
        pg.select_option(card + " [data-cc-period]", "month"); pg.wait_for_timeout(300)
        m1 = TODAY.replace(day=1)
        ok(txt(card + " [data-cc-range]") == d8(m1) + " to " + d8(TODAY), "1. this month (%s)" % txt(card + " [data-cc-range]"))
        pg.select_option(card + " [data-cc-period]", "week"); pg.wait_for_timeout(300)
        pg.click(card + " [data-cc-go]"); pg.wait_for_timeout(500)
        ok(calls("tally_check_request")[-1].get("p_from") == (TODAY - datetime.timedelta(days=6)).isoformat(), "1. the last 7 days (%s)" % calls("tally_check_request")[-1:])
        pg.select_option(card + " [data-cc-period]", "own"); pg.wait_for_timeout(300)
        ok(n(card + " [data-cc-from]") == 1 and E("() => document.querySelector(\"#app [data-cc-from]\").min") == "%d-04-01" % (FYN - 1) and E("() => document.querySelector(\"#app [data-cc-to]\").max") == TODAY.isoformat(),
           "1. dates of one's own: never before the books start or after today")
        pg.fill(card + " [data-cc-from]", "%d-06-01" % FYN); pg.fill(card + " [data-cc-to]", "%d-06-30" % FYN); pg.wait_for_timeout(200)
        pg.click(card + " [data-cc-go]"); pg.wait_for_timeout(500)
        ok(calls("tally_check_request")[-1] == {"p_client": cid, "p_from": "%d-06-01" % FYN, "p_to": "%d-06-30" % FYN}, "1. a range of one's own (%s)" % calls("tally_check_request")[-1:])
        E("() => { window.__req = {ok: false, error: 'Choose at most 400 days at a time (a financial year fits).'}; }")
        pg.click(card + " [data-cc-go]"); pg.wait_for_timeout(500)
        ok(txt(card + " [data-cc-err]") == "Choose at most 400 days at a time (a financial year fits).", "1. a refusal said in plain words (%s)" % txt(card + " [data-cc-err]"))
        pg.select_option(card + " [data-cc-period]", "fy"); pg.wait_for_timeout(200)

        print("== 2. progress and what holds it")
        state(sb(), ASK(cid, state="checking", checked=120, same=118, fixed=2, waiting=93, etaMin=6))
        w = txt(card + " [data-cc-words]")
        ok(w == "Checked 120 of 213 days · about 6 min left (" + RANGE + ")", "2. the progress (%s)" % w)
        ok(E("() => document.querySelector(\"#app [data-check-changes='books'] [role=progressbar]\").getAttribute('aria-valuenow')") == "56" and n(card + " [data-cc-wait]") == 0, "2. the bar at 56%, nothing in the way")
        ok("2 seconds" in txt(card + " [data-cc-safe]") and "never hangs" in txt(card + " [data-cc-safe]") and "Nothing is ever changed in Tally" in txt(card), "2. Tally never hangs and is never changed, said")
        shot("check-progress-1366")
        state(sb(pull=GOING), ASK(cid, after=True))
        ok(txt(card + " [data-cc-wait='after']") == "Waiting for Bring books from Tally (FY %d-%s) to finish: the check goes next." % (FYN, str(FYN + 1)[2:]), "2. after a running Bring books from Tally (%s)" % txt(card + " [data-cc-wait]"))
        state(sb(pull=dict(GOING, state="paused")), ASK(cid, paused=True))
        ok(txt(card + " [data-cc-wait='paused']").startswith("Waiting: Bring books from Tally is paused"), "2. paused (%s)" % txt(card + " [data-cc-wait]"))
        state(sb(), ASK(cid, run={"state": "stopped", "why": "window"}))
        ok(txt(card + " [data-cc-wait='stopped']") == "Stopped: Tally was busy. Press Check for changes in Tally to go on.", "2. stopped (%s)" % txt(card + " [data-cc-wait]"))
        state(sb(devices=[{"id": "d-1", "fetchOn": False}]), ASK(cid))
        ok(txt(card + " [data-cc-wait='computer']").startswith("Waiting: reading older entries is off for the Tally computer") and n(card + " [data-tfx-turnon]") == 1, "2. the switch off: the owner's one click (%s)" % txt(card + " [data-cc-wait]"))
        pg.click(card + " [data-tfx-turnon]"); pg.wait_for_timeout(500)
        ok(calls("tally_device_period_fetch")[-1:] == [{"p_device": "d-1", "p_on": True}], "2. Turn on for this computer")
        E("() => { S.account.me.role = 'staff'; render(); }"); pg.wait_for_timeout(400)
        ok(n(card + " [data-tfx-turnon]") == 0 and "An owner of the firm can turn it on." in txt(card + " [data-cc-wait]") and n(card + " [data-cc-go]") == 1, "2. staff: a plain line, and may press")
        E("() => { S.account.me.role = 'readonly'; render(); }"); pg.wait_for_timeout(400)
        ok(n(card + " [data-cc-go]") == 0 and n(card + " [data-cc-progress]") == 1, "2. a viewer: the progress, no button")
        E("() => { S.account.me.role = 'owner'; render(); }"); pg.wait_for_timeout(300)
        state(sb(devices=[{"id": "d-1", "fetchOn": False}]), None)
        ok(txt(card + " [data-cc-off]").startswith("Checking needs reading older entries on") and n(card + " [data-cc-off] [data-tfx-turnon]") == 1, "2. before any press: the switch off said, with the owner's click")

        print("== 3. changes corrected and listed")
        state(sb(), ASK(cid, state="done", checked=213, same=208, fixed=5, waiting=0, added=3, changed=1, deleted=1, rows=ROWS), 1600)
        w = txt(card + " [data-cc-done]")
        ok(w.startswith("Done: 5 changes made from Tally — 3 added, 1 changed, 1 deleted (kept in history). 208 days already matched."), "3. the result in plain words (%s)" % w)
        ok(n(card + " [data-cc-row]") == 5 and n(card + " [data-cc-row='added']") == 3 and "deleted (kept in history)" in txt(card + " [data-cc-row='deleted']"), "3. the list (%d rows)" % n(card + " [data-cc-row]"))
        ok(E("() => [...document.querySelectorAll('#app [data-cc-table] th')].map(t => t.textContent).join('|')") == "Date|Voucher|Party|Amount|What FinCom did", "3. date, voucher, party, amount, what FinCom did")
        ok("12-Aug-%d" % FYN in txt(card + " [data-cc-row='added']") and "1,180.00" in txt(card + " [data-cc-row='added']"), "3. a row (%s)" % txt(card + " [data-cc-row='added']"))
        shot("check-done-1366")
        state(sb(), ASK(cid, state="done", checked=212, same=212, upload=1, waiting=0, uploadDays=[{"day": "%d0705" % FYN, "words": "FinCom could not finish checking 05-Jul-%d against Tally. Please upload that day's Day Book again." % FYN}]))
        ok(n(card + " [data-cc-upload]") == 1 and "Upload 05-Jul-%d" % FYN in txt(card + " [data-cc-upload]") and "1 day could not be checked" in txt(card + " [data-cc-done]"), "3. a day that could not be checked: its upload (%s)" % txt(card + " [data-cc-done]"))

        print("== 4. nothing changed")
        state(sb(), ASK(cid, state="done", checked=213, same=213, waiting=0, rows=[]))
        w = txt(card + " [data-cc-done]")
        ok(w.startswith("No changes: FinCom matches Tally for " + RANGE) and n(card + " [data-cc-result='none']") == 1 and n(card + " [data-cc-row]") == 0, "4. no changes (%s)" % w)
        pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(600)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "4. 390 wide: no sideways scroll")
        shot("check-none-390")
        pg.set_viewport_size({"width": 1366, "height": 900}); pg.wait_for_timeout(300)

        print("== 7. the missing days by themselves; Start walks only what FinCom lacks; the honest pace")
        fr = calls("tally_fill_request")
        ok(len(fr) == 1 and fr[0].get("p_client") == cid and fr[0].get("p_days") and all(re.match(r"^\d{4}-\d{2}-\d{2}$", d) for d in fr[0]["p_days"]), "7. the missing days asked of Tally by themselves, once (%s)" % fr)
        state(sb(), None, 1400, [{"book": "bk-zz", "client": cid, "fill": {"total": 2, "done": 0, "waiting": 2, "upload": 0, "etaMin": 1, "added": 0}, "lean": None, "hours": HOURS}])
        ok(txt("#app [data-fill-line='going']") == "Bringing 2 missing days from Tally · about 1 min left", "7. the quiet line (%s)" % txt("#app [data-fill-line]"))
        ok(n("#app [data-fill-line] button") == 0, "7. no button for it")
        state(sb(), None, 1400, [{"book": "bk-zz", "client": cid, "fill": {"total": 2, "done": 2, "waiting": 0, "upload": 0, "etaMin": None, "added": 1, "changed": 0, "deleted": 0}, "lean": None, "hours": HOURS}])
        ok(txt("#app [data-fill-line='done']") == "Brought 2 missing days from Tally ✓ (1 entry added)", "7. brought (%s)" % txt("#app [data-fill-line]"))
        ok(len(calls("tally_fill_request")) == 1, "7. not asked again on the same visit")
        lean = {"fy": "%d0401" % FYN, "days": 213, "already": 206, "upload": 0, "toBring": 7, "skipped": 206}
        state(sb(pull=GOING), None, 1400, [{"book": "bk-zz", "client": cid, "fill": None, "lean": lean, "hours": HOURS}])
        oc = "#app [data-older-entries]"
        ok(txt(oc + " [data-older-lean]") == "213 days: 206 already in FinCom, 7 to bring.", "7. the year in days (%s)" % txt(oc + " [data-older-lean]"))
        ok(txt(oc + " [data-older-pace]") == PACE, "7. the honest pace (%s)" % txt(oc + " [data-older-pace]"))
        state(sb(), None, 1400, [{"book": "bk-zz", "client": cid, "fill": None, "lean": None, "hours": HOURS}])
        pg.click(oc + " [data-older-start]"); pg.wait_for_timeout(600)
        ok(calls("tally_period_choose_lean")[-1:] == [{"p_book": "bk-zz", "p_fy_start": "%d-04-01" % FYN, "p_part": "year"}] and not calls("tally_period_choose"), "7. Start walks only what FinCom lacks (%s)" % calls("tally_period_choose_lean")[-1:])
        shot("from-tally-lean-1366")

        print("== 5. the Tally page: the client's row")
        pg.goto("http://localhost:8457/"); pg.wait_for_timeout(2500)
        if n('button[data-act="useOffline"]'): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        d6 = TP.dev(7, "NWS144", "anshul", tally="open", opened=("ABC TRADERS",), version="2.4.9")
        books = {"garg shekhar & company": TP.book("garg shekhar & company"), "ABC TRADERS": TP.book("ABC TRADERS"), "GB TEXCOAT": TP.book("GB TEXCOAT")}
        two = TP.companies(linked=("ABC TRADERS", "garg shekhar & company"), seen=(), d=d6["id"])
        ids = E(TP.SETUP, [[d6], two, [], "owner", TP.CLIENTS, True, books]); pg.wait_for_timeout(1500)
        ac = ids["ABC TRADERS"]
        E("() => { window.__rpc = []; window.__base = null; }")
        E(MOCK, [[dict(SUMB(ac), book="bk-ABC TRADERS", company="ABC TRADERS")], dict(ASK(ac, book="bk-ABC TRADERS", company="ABC TRADERS", state="checking", checked=120, waiting=93, etaMin=6)), dict(ASK(ac), ok=True), None]); pg.wait_for_timeout(300)
        E("() => { render(); }"); pg.wait_for_timeout(2500)
        row = "#app [data-tlk-row='%s'] [data-check-changes='row']" % ac
        ok(n(row) == 1 and n(row + " [data-cc-go]") == 1, "5. the client's row has the button")
        ok(txt(row + " [data-cc-words]") == "Checked 120 of 213 days · about 6 min left (" + RANGE + ")", "5. its progress (%s)" % txt(row + " [data-cc-words]"))
        pg.click(row + " [data-cc-go]"); pg.wait_for_timeout(600)
        ok(calls("tally_check_request")[-1:] == [{"p_client": ac, "p_from": FROM.isoformat(), "p_to": TODAY.isoformat()}], "5. the row's press (%s)" % calls("tally_check_request")[-1:])
        E("(k) => { window.__ask = k; tfxRefresh(); }", dict(ASK(ac, book="bk-ABC TRADERS", company="ABC TRADERS", state="done", checked=213, same=208, fixed=5, waiting=0, added=3, changed=1, deleted=1, at=NOW), rows=ROWS)); pg.wait_for_timeout(1500)
        ok(txt(row + " [data-cc-done]").startswith("Done: 5 changes made from Tally — 3 added, 1 changed, 1 deleted (kept in history). 208 days already matched."), "5. its result (%s)" % txt(row + " [data-cc-done]"))
        ok(n(row + " [data-cc-row]") == 0 and n(row + " [data-cc-list-open]") == 1, "5. the list one click away")
        pg.click(row + " [data-cc-list-open]"); pg.wait_for_timeout(700)
        ok(n(row + " [data-cc-row]") == 5, "5. the list opened (%d rows)" % n(row + " [data-cc-row]"))
        ok(not re.search(r"NWS144|anshul", txt(row)), "5. no computer name or Windows login in it")
        shot("tally-row-1366")
        pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(600)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "5. 390 wide: no sideways scroll")
        shot("tally-row-390")
        pg.set_viewport_size({"width": 1366, "height": 900})

        print("== 6. the build")
        js = glob.glob(os.path.join(SITE, "assets", "*.js"))
        holds = [os.path.basename(f) for f in js if "Check for changes in Tally" in open(f, encoding="utf-8", errors="replace").read()]
        first = glob.glob(os.path.join(SITE, "assets", "index-*.js")); leg = os.path.join(SITE, "legacy.js")
        gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6)) // 1024
        ok(holds and not [h for h in holds if h.startswith("index-")] and "Check for changes in Tally" not in open(leg, encoding="utf-8", errors="replace").read(), "6. in a file loaded only with the Tally screens, not the first file or legacy.js (%s)" % holds)
        ok(first and sum(gz(f) for f in first) <= 260 and gz(leg) <= 600, "6. the first file %d KB and legacy.js %d KB gzip within 260 / 600" % (sum(gz(f) for f in first), gz(leg)))
        ok(not errors and not [c for c in cons if "PGRST202" not in c and "404" not in c and not re.search(r"@http://127\.0\.0\.1:\d+/ping", c)], "no page error or console error (%s %s)" % (errors[:2], cons[:2]))
        br.close(); srv.shutdown()

    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
