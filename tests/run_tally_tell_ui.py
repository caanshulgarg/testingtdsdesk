"""python3 run_tally_tell_ui.py - Tally tell in the app (the owner, 24-Nov-2026: "There should be proper way to tell and auto
import of tally days into fincom"; plan tally-tell-autoday-plan.md part A; migration 221's tally_tell_view(), made up in the
page). Checked, offline with FinCom's cloud made up (alerts_seed.SETUP):
  1. every cause line: the Tally page's row of the company says the cloud's sentence as given, with its one button wired to
     the existing action (Link: the link list; Download FinCom Bridge / Update to <version>: the site's setup; Turn on for
     this computer: tally_device_period_fetch; Resume reading: tally_read_resume), none for a cause with no fix;
  2. the three lines: Reading and Changes when they differ; "Entries go to Tally when ..." when posting waits;
  3. the header's Tally sign and its popover say the same sentence (Waiting for Tally / Needs you as A.3.2; 15-16 the count
     line under Linked), the client chip's title is the sentence (its word unchanged);
  4. the computers' lines on the Tally page, the computers named there ("Update FinCom Bridge on Hemant's computer."), the
     owner's Update; staff told an owner does it;
  5. the bell: the open 'tell' rows only (asked with cleared_at=is.null; a cleared one is never shown), its words as given;
  6. an earlier year: said once with "Add 2025-26", nothing asked until it is pressed; pressed, the existing Bring another
     year's call (tally_period_choose_lean, the year's 1-Apr) and what came of it;
  7. a cloud without migration 221: nothing new anywhere, no error;
  8. "Upload the Day Book" is never asked for: Sync activity's Needs you and the Tally page say FinCom brings the day itself.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_tell_ui.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
from alerts_seed import D1, dev, SETUP, HELD_OURS
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CO = "GARG SHEKHAR & COMPANY"
D2 = "d0000000-0000-4000-8000-000000000002"
# A.1, the words as migration 221 writes them (the app shows them as given)
CASES = [("not_linked", "Link %s to its client to bring its books." % CO, "link", "Link"),
         ("no_bridge", "Install FinCom Bridge on the computer where you use Tally.", "download", "Download FinCom Bridge"),
         ("bridge_off", "Start FinCom Bridge on the computer where you use Tally.", None, None),
         ("old_bridge", "Update FinCom Bridge on the computer where you use Tally.", "update", "Update to 2.5.22"),
         ("tally_closed", "Tally is closed. Open %s in Tally." % CO, None, None),
         ("not_open", "Open %s in Tally." % CO, None, None),
         ("run_as_admin", "Open %s in your own Tally, not with 'Run as administrator'." % CO, None, None),
         ("two_tallys", "%s is open in two Tallys. Close it in one." % CO, None, None),
         ("other_login", "%s is open in another person's Windows login. Open it in yours." % CO, None, None),
         ("other_copy", "The %s open in Tally is another copy. Open the linked one." % CO, None, None),
         ("reading_off", "Reading from Tally is off for this computer. Turn it on.", "turn_on", "Turn on for this computer"),
         ("paused", "Reading is paused in the FinCom Bridge tray icon. Click Resume there.", None, None),
         ("read_stopped", "Reading was stopped from FinCom. Resume it.", "resume", "Resume reading"),
         ("no_start", "Open %s in your own Tally once, so FinCom can start reading it." % CO, None, None),
         ("addon_silent", "Load the FinCom add-on in Tally (F1 › TDLs & Add-ons).", None, None),
         ("days_waiting", "FinCom is bringing 12 days from Tally.", None, None),
         ("slow_day", "Tally was slow for 05-Oct-2026. FinCom tries it again by itself.", None, None)]
WAIT = {"bridge_off", "tally_closed", "not_open", "other_login", "other_copy", "no_start"}
NEEDS = {"not_linked", "no_bridge", "old_bridge", "run_as_admin", "two_tallys", "reading_off", "paused", "read_stopped", "addon_silent"}
NIL = {"code": None, "words": None, "fix": None}
def book(cid, code, words, fix, read=None, post=None, changes=None, earlier=None):
    c = {"code": code, "words": words, "fix": fix} if code else NIL
    b = {"book": "b1", "client": cid, "company": CO, "cause": c, "read": read or c, "post": post or NIL, "changes": changes or NIL,
         "days": {"n": 12, "oldest": "2026-10-05"}, "since": None, "affected": True}
    if earlier: b["earlier"] = earlier
    return b
PCS = [{"device": D1, "computer": "Hemant's computer", "code": "old_bridge", "words": "Update FinCom Bridge on Hemant's computer.", "fix": "update", "at": "2026-11-24T10:00:00Z", "mine": True},
       {"device": D2, "computer": "Office computer", "code": "working", "words": "Working.", "fix": None, "at": "2026-11-24T10:00:00Z", "mine": False}]
MOCK = """([v, alerts, missing, sum]) => { window.__tell = v; window.__tellAlerts = alerts; window.__tellMissing = missing; window.__tellCalls = window.__tellCalls || []; window.__tellAsked = []; window.__tellSum = sum; window.__resumeAns = {ok: true};
  const rpc0 = window.__rpc0 || (window.__rpc0 = TCloud.rpc), api0 = window.__api0 || (window.__api0 = Cloud.api);
  TCloud.rpc = async (fn, a) => { window.__tellCalls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === 'tally_tell_view') { if (window.__tellMissing) throw new Error('Could not find the function public.tally_tell_view without parameters in the schema cache (PGRST202)'); return JSON.parse(JSON.stringify(window.__tell)); }
    if (fn === 'tally_fetch_summary') return {ok: true, books: window.__tellSum ? JSON.parse(JSON.stringify(window.__tellSum)) : []};
    if (fn === 'tally_period_choose_lean') return {ok: true};
    if (fn === 'tally_device_period_fetch') return {ok: true};
    if (fn === 'tally_read_resume') { if (window.__resumeAns === 'throw') throw new Error('permission denied for function tally_read_resume (42501)'); return window.__resumeAns; }
    return rpc0(fn, a); };
  TCloud.control = async (fn, args) => { window.__tellCalls.push([fn, args || {}]); };
  Cloud.api = async (p, o) => { if (/^tally_alerts\\?/.test(p) && /kind=eq\\.tell/.test(p)) { window.__tellAsked.push(p);
      if (window.__tellMissing) throw new Error('column tally_alerts.cleared_at does not exist (42703)');
      return JSON.parse(JSON.stringify(window.__tellAlerts.filter(x => !/cleared_at=is\\.null/.test(p) || !x.cleared_at))); }
    return api0(p, o); };
  if (typeof FCTell === 'object') { FCTell.forget(); FCTell.load(true); } }"""
TELL = lambda pg, cid: pg.evaluate("""(c) => [...document.querySelectorAll('#app [data-tsm-row] [data-tell-of="' + c + '"] [data-tell-line]')].map(e => ({code: e.getAttribute('data-tell-line'), what: e.getAttribute('data-tell-what'),
  text: e.innerText.replace(/\\s+/g, ' ').trim(), fix: [...e.querySelectorAll('[data-tell-fix]')].map(b => [b.getAttribute('data-tell-fix'), b.innerText.trim()])}))""", cid)
srv = http.server.ThreadingHTTPServer(("localhost", int(os.environ.get("TELL_UI_PORT") or 0)), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % srv.server_address[1]
SETUP_FILE = {"setup": {"url": "assets/bridge-go/FinComBridgeSetup-2.5.22.exe", "version": "2.5.22", "sha256": "ab" * 32}}
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(SETUP_FILE)))
    pg.goto(URL); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP, [{"devs": [dev()], "alerts": [], "gap": None}, "owner"])
    summ = SUMM = [{"book": "b1", "client": cid, "company": CO, "devices": [{"id": D1, "fetchOn": False}]}]
    E("() => render()")
    try: pg.wait_for_function("() => typeof FCTell === 'object'", timeout=15000)
    except Exception: ok(False, "the tell file is fetched once the app is drawn")
    def scene(v, alerts=(), missing=False, role="owner", summ=None, where="tally"):
        E("(r) => { S.account.me.role = r; }", role)
        E(MOCK, [v, list(alerts), missing, summ or SUMM]); pg.wait_for_timeout(500)
        if where == "tally": E("() => { S.alertsOpen = false; S.tallyMore = {}; navHome('tally'); }")
        pg.wait_for_timeout(1300)
    view = lambda books, pcs=None: {"ok": True, "at": "2026-11-24T10:00:00Z", "books": books, "computers": PCS if pcs is None else pcs}

    print("1. every cause line on the company's row of the Tally page")
    for code, words, fix, label in CASES:
        scene(view([book(cid, code, words, fix)]), summ=summ)
        ls = TELL(pg, cid)
        ok(len(ls) == 1 and ls[0]["code"] == code and ls[0]["text"].startswith(words), "%s: the row says “%s” (%s)" % (code, words, ls))
        got = ls[0]["fix"] if ls else None
        ok(got == ([[fix, label]] if fix else []), "%s: its button %s (%s)" % (code, label or "none", got))
    # the buttons do what they say (the existing actions)
    scene(view([book(cid, "read_stopped", CASES[12][1], "resume")]))
    pg.click('#app [data-tsm-row] [data-tell-fix="resume"]'); pg.wait_for_timeout(900)
    ok(any(c[0] == "tally_read_resume" for c in E("window.__tellCalls")), "Resume reading: the existing tally_read_resume (%s)" % [c[0] for c in E("window.__tellCalls")][-3:])
    RES = "() => [...document.querySelectorAll('#app [data-tsm-row] [data-tell-line=read_stopped] [data-said]')].map(e => [e.innerText.trim(), e.className])"
    r = E(RES)
    ok(len(r) == 1 and r[0][0] == "Reading from Tally starts again within a minute." and "bad" not in r[0][1], "Resume reading: one message, what came of it (%s)" % r)
    for ans, what in (({"ok": False, "error": "Only an owner can resume reading."}, "refused (ok false)"), ("throw", "refused (an error)")):
        scene(view([book(cid, "read_stopped", CASES[12][1], "resume")]))
        E("(a) => { window.__resumeAns = a; }", ans)
        pg.click('#app [data-tsm-row] [data-tell-fix="resume"]'); pg.wait_for_timeout(900)
        r = E(RES)
        ok(len(r) == 1 and r[0][0].startswith("Not resumed: ") and "bad" in r[0][1], "Resume reading %s: “Not resumed: …”, one message (%s)" % (what, r))
    scene(view([book(cid, "reading_off", CASES[10][1], "turn_on")]), summ=summ)
    pg.click('#app [data-tsm-row] [data-tell-fix="turn_on"] button'); pg.wait_for_timeout(900)
    ok(["tally_device_period_fetch", {"p_device": D1, "p_on": True}] in E("window.__tellCalls"), "Turn on for this computer: the existing tally_device_period_fetch")
    scene(view([book(cid, "no_bridge", CASES[1][1], "download")]))
    ok(E("() => { const a = document.querySelector('#app [data-tsm-row] a[data-tell-fix=download]'); return a ? [a.getAttribute('href'), a.hasAttribute('download')] : null; }") == ["assets/bridge-go/FinComBridgeSetup-2.5.22.exe?v=" + "ab" * 6, True],
       "Download FinCom Bridge: the site's setup file, as the Tally page's Download")
    scene(view([book(cid, "not_linked", CASES[0][1], "link")]))
    pg.click('#app [data-tsm-row] [data-tell-fix="link"]'); pg.wait_for_timeout(900)
    ok(E("() => !!(S.tallyGuide && S.tallyGuide.step === 4 && S.tallyGuide.cid)") , "Link: the link list for the client (openConnectTally 4) (%s)" % E("() => JSON.stringify(S.tallyGuide)"))
    scene(view([book(cid, "old_bridge", CASES[3][1], "update")]), role="staff")
    ok([x["fix"] for x in TELL(pg, cid)] == [[["update", "Update to 2.5.22"]]] and "An owner of the firm does this." not in pg.inner_text("#app [data-tsm-row] [data-tell-of]"), "staff: Update to 2.5.22 too (anyone can download it) (%s)" % [x["fix"] for x in TELL(pg, cid)])

    print("2. the three lines")
    tc, ad = CASES[4], CASES[14]
    tcx = {"code": "tally_closed", "words": tc[1], "fix": None}
    scene(view([book(cid, "tally_closed", tc[1], None, changes=tcx)]))
    ok([(x["what"], x["code"]) for x in TELL(pg, cid)] == [("cause", "tally_closed")], "Reading and Changes alike: one line (%s)" % TELL(pg, cid))
    scene(view([book(cid, "tally_closed", tc[1], None, read={"code": "tally_closed", "words": tc[1], "fix": None}, changes={"code": "addon_silent", "words": ad[1], "fix": None})]))
    ok([(x["what"], x["code"]) for x in TELL(pg, cid)] == [("read", "tally_closed"), ("changes", "addon_silent")], "Reading and Changes differ: two lines (%s)" % TELL(pg, cid))
    post = {"code": "tally_closed", "words": "Entries go to Tally when %s is open in Tally." % CO, "fix": None}
    scene(view([book(cid, "tally_closed", tc[1], None, post=post)]))
    ls = TELL(pg, cid)
    ok([x["what"] for x in ls] == ["cause"], "posting waits for the same cause: one sentence, not repeated (%s)" % ls)
    ok(not re.search(r"\b(warning|error)\b", " ".join(x["text"] for x in ls), re.I), "plain words: no warning, no error")

    print("2b. the State column: the dot and word, the cloud's one line, nothing that says otherwise")
    STATE = """(c) => { const r = document.querySelector('#app [data-tsm-row][data-tsm-cid="' + c + '"]'); if (!r) return null; const st = r.querySelector('td[data-tsm-col=state]');
      return {word: (st.querySelector('[data-tpt-state]') || {}).innerText || '', own: [...st.querySelectorAll('.tpt-why:not(.tpt-tell-line), [data-tpt-held], [data-tpt-where]')].length,
        tell: [...st.querySelectorAll('[data-tell-line]')].map(e => e.getAttribute('data-tell-line')), io: (r.querySelector('[data-tpt-intally]') || {innerText: ''}).innerText.replace(/\\s+/g, ' ').trim()}; }"""
    scene(view([book(cid, "tally_closed", tc[1], None)]))
    st = E(STATE, cid)
    ok(st and st["own"] == 0 and st["tell"] == ["tally_closed"], "a sentence from the cloud: the row's own why, held and where lines hidden; one line (%s)" % st)
    ok(st and st["word"].strip() == "Waiting for Tally", "the word agrees with the sentence: Waiting for Tally, never Connected (%s)" % (st and st["word"]))
    ok(st and not st["io"].startswith("Open"), "In Tally never says Open while the sentence says Tally is closed (%s)" % (st and st["io"]))
    chips = E("() => (document.querySelector('#app [data-tpf-chips]') || {innerText: ''}).innerText.replace(/\\s+/g, ' ')")
    ok("Open in Tally now 0" in chips and "Not open in Tally 1" in chips, "the chips agree: not counted as open in Tally (%s)" % chips)
    scene(view([book(cid, "reading_off", CASES[10][1], "turn_on")]))
    st = E(STATE, cid)
    ok(st and st["word"].strip() == "Needs you" and st["own"] == 0, "a cause that needs a person: Needs you (%s)" % st)
    ew0 = "%s has changes in Tally for 2025-26. Add 2025-26 to bring them." % CO
    scene(view([book(cid, "days_waiting", CASES[15][1], None, earlier={"fy": "2025-26", "n": 308, "words": ew0, "fix": "add_year"})]))
    st = E(STATE, cid)
    ok(st and st["tell"] == ["days_waiting", "earlier"] and st["own"] == 0, "the earlier year on its own line under the sentence (%s)" % st)

    print("3. the header's Tally sign, its popover, the client chip")
    def at_client():
        E("(c) => { S.view = 'company'; S.coId = c; S.loadingCo = false; S.alertsOpen = false; S.tallyPanel = false; goClient('dash'); }", cid); pg.wait_for_timeout(1300)
    for code, words, fix, label in [CASES[4], CASES[10], CASES[15]]:
        scene(view([book(cid, code, words, fix)]), summ=summ, where="client"); at_client()
        st = E("() => { const b = document.querySelector('header.top [data-tally-icon]'); return b ? [b.getAttribute('data-tally-icon'), b.getAttribute('data-tally-cause'), b.getAttribute('title')] : null; }")
        want = "waiting" if code in WAIT else "needs" if code in NEEDS else None
        if want: ok(st and st[0] == want and st[1] == "tell" and words in st[2], "%s: the Tally sign %s, its words the sentence (%s)" % (code, want, st))
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top [data-tally-pop]", timeout=15000); pg.wait_for_timeout(500)
        pop = pg.inner_text("header.top [data-tally-pop]")
        ok(words in pop, "%s: the popover says the sentence (%s)" % (code, pop.replace("\n", " | ")[:160]))
        if code == "days_waiting": ok(pg.locator('header.top [data-tally-pop-tell="days_waiting"]').count() == 1, "days_waiting: the count line under the sign's own word")
        if fix: ok(pg.locator('header.top [data-tally-pop] [data-tell-fix="%s"]' % fix).count() == 1, "%s: the popover's button is the same (%s)" % (code, label))
        ok("Hemant" not in pop and "computer" not in pop.replace("this computer", "").lower() or code != "tally_closed", "%s: no computer named in the popover" % code)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    scene(view([book(cid, "tally_closed", tc[1], None)]), where="client")
    E("() => { S.tallyFocus = ''; navHome('clients'); }"); pg.wait_for_timeout(1300)
    chip = E("() => { const c = document.querySelector('#app [data-tally-chip-at=clients]'); return c ? [c.getAttribute('title'), c.innerText.trim()] : null; }")
    ok(chip and chip[0] == tc[1], "the client chip's title is the sentence (%s)" % chip)

    print("4. the computers' lines, named on the Tally page")
    scene(view([book(cid, "days_waiting", CASES[15][1], None)]))
    pcs = E("() => [...document.querySelectorAll('#app [data-tell-pcs] [data-tell-pc]')].map(e => [e.getAttribute('data-tell-pc-code'), e.innerText.replace(/\\s+/g, ' ').trim(), !!e.querySelector('[data-tell-fix=update]')])")
    ok(len(pcs) == 2 and pcs[0][0] == "old_bridge" and "Hemant's computer" in pcs[0][1] and "Update FinCom Bridge on Hemant's computer." in pcs[0][1] and pcs[0][2], "Hemant's computer: “Update FinCom Bridge on Hemant's computer.” with Update (%s)" % pcs)
    ok(len(pcs) == 2 and pcs[1][0] == "working" and "Office computer" in pcs[1][1] and "Working." in pcs[1][1] and not pcs[1][2], "Office computer: Working., no button (%s)" % pcs[1:])
    ok("Update to 2.5.22" in (pcs[0][1] if pcs else ""), "the owner's Update: the newer setup (%s)" % (pcs[0][1] if pcs else ""))
    scene(view([book(cid, "days_waiting", CASES[15][1], None)], pcs=PCS[:1]), role="staff")
    one = E("() => [...document.querySelectorAll('#app [data-tell-pcs] [data-tell-pc]')].map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    ok(len(one) == 1 and "Update to 2.5.22" in one[0] and "An owner" not in one[0], "staff: their own computer only (the cloud's list), Update for them too (%s)" % one)
    head = E("() => (document.querySelector('header.top') || {}).innerText || ''")
    ok("Hemant" not in head, "the header never names a computer")

    print("5. the bell: the open 'tell' rows only")
    rows = [{"id": 901, "firm_id": "f-1", "client_id": cid, "book_id": "b1", "device_id": None, "kind": "tell", "day": "2026-11-24", "words": tc[1], "data": {"code": "tally_closed"}, "at": "2026-11-24T09:00:00Z", "read_at": None, "cleared_at": None},
            {"id": 902, "firm_id": "f-1", "client_id": cid, "book_id": "b2", "device_id": None, "kind": "tell", "day": "2026-11-23", "words": "Open OLD COPY in Tally.", "data": {"code": "not_open"}, "at": "2026-11-23T09:00:00Z", "read_at": None, "cleared_at": "2026-11-23T12:00:00Z"}]
    E("(rs) => { window.__w.alerts = rs; }", rows)
    scene(view([book(cid, "tally_closed", tc[1], None)]), alerts=rows)
    E("() => { Rec.alerts.at = 0; return Rec.alertsLoad(); }"); E("() => AlertHub.refresh(true)"); pg.wait_for_timeout(1200)
    pg.click("[data-bell]"); pg.wait_for_timeout(600)
    items = E("() => [...document.querySelectorAll('[data-alerts-panel] [data-alert-key^=\"tell:\"]')].map(e => [e.getAttribute('data-alert-key'), e.querySelector('[data-alert-text]').innerText.trim()])")
    ok(items == [["tell:901", tc[1]]], "one item, the open row, its words as given (%s)" % items)
    asked = E("window.__tellAsked")
    ok(asked and all("cleared_at=is.null" in a for a in asked), "asked with cleared_at=is.null (%s)" % (asked[:1]))
    E("() => { S.alertsOpen = false; render(); }")

    print("6. an earlier year: said once, Add 2025-26")
    ew = "%s has changes in Tally for 2025-26. Add 2025-26 to bring them." % CO
    scene(view([book(cid, "days_waiting", CASES[15][1], None, earlier={"fy": "2025-26", "n": 308, "words": ew, "fix": "add_year"})]))
    ls = TELL(pg, cid)
    ok([x["code"] for x in ls] == ["days_waiting", "earlier"] and ls[1]["text"].startswith(ew) and ls[1]["fix"] == [["add_year", "Add 2025-26"]], "the row says it once, with Add 2025-26 (%s)" % ls)
    ok(pg.locator("#app [data-tell-line=earlier]").count() == 1, "said once on the page")
    ok(not [c for c in E("window.__tellCalls") if c[0].startswith("tally_period_choose")], "nothing asked until it is pressed (never added by itself)")
    pg.click('#app [data-tsm-row] [data-tell-fix="add_year"]'); pg.wait_for_timeout(1200)
    ch = [c for c in E("window.__tellCalls") if c[0].startswith("tally_period_choose")]
    ok(ch == [["tally_period_choose_lean", {"p_book": "b1", "p_fy_start": "2025-04-01", "p_part": "year"}]], "pressed: the existing Bring another year (tally_period_choose_lean, 1-Apr-2025) (%s)" % ch)
    said = E("() => (document.querySelector('#app [data-tell-line=earlier]') || {}).innerText || ''")
    ok("FinCom brings FY 2025-26 from Tally" in said, "what came of it is said beside it (%s)" % said.replace("\n", " "))
    # the year now being brought: its progress instead of the button (the same lock as Bring another year's Start)
    going = [dict(SUMM[0], pull={"fy": "20250401", "part": "year", "state": "going", "x": 100, "y": 400, "chosenAt": "2026-11-24T10:00:00Z"})]
    E("(s) => { window.__tellSum = s; window.tfxRefresh && window.tfxRefresh(); }", going); pg.wait_for_timeout(1500)
    el = E("() => { const e = document.querySelector('#app [data-tell-line=earlier]'); return e ? [e.querySelectorAll('[data-tell-fix=add_year]').length, (e.querySelector('[data-tell-progress]') || {innerText: ''}).innerText] : null; }")
    ok(el and el[0] == 0 and "100 of 400 entries" in el[1] and "FY 2025-26" in el[1], "once pressed, the year's progress instead of the button (%s)" % el)
    scene(view([book(cid, "days_waiting", CASES[15][1], None, earlier={"fy": "2025-26", "n": 308, "words": ew, "fix": "add_year"})]),
          summ=[dict(SUMM[0], pull={"fy": "20250401", "part": "year", "state": "paused", "x": 50, "y": 400})])
    E("() => window.tfxRefresh && window.tfxRefresh()"); pg.wait_for_timeout(1500)
    el = E("() => { const e = document.querySelector('#app [data-tell-line=earlier]'); return e ? [e.querySelectorAll('[data-tell-fix=add_year]').length, (e.querySelector('[data-tell-progress]') || {innerText: ''}).innerText] : null; }")
    ok(el and el[0] == 0 and "50 of 400 entries" in el[1], "a pull of the book paused: its words, no Add (%s)" % el)

    print("7. a cloud without migration 221: nothing new, no error")
    E("() => { window.__w.alerts = []; }")
    scene(None, missing=True); pg.wait_for_timeout(800)
    n = E("() => document.querySelectorAll('[data-tell-of], [data-tell-pcs], [data-tell-pc], [data-alert-key^=\"tell:\"], [data-tally-pop-tell]').length")
    ok(n == 0 and pg.locator("#app [data-tsm-row]").count() >= 1, "nothing of it shown, the page as before (%d)" % n)
    ok(E("() => (document.querySelector('header.top [data-tally-icon]') || {}).getAttribute && document.querySelector('header.top [data-tally-icon]').getAttribute('data-tally-cause')") != "tell", "the Tally sign as before")
    ok(not re.search(r"PGRST|schema cache|42703|tally_tell", pg.inner_text("body")), "no error words")

    print("7b. the cache follows the firm; a failed bell query asked again after 10 minutes")
    scene(view([book(cid, "tally_closed", tc[1], None)]))
    E("() => { window.__f0 = Cloud.st.firm; Cloud.st.firm = 'f-2'; }")
    ok(E("() => FCTell.view()") is None, "another firm: the first firm's sentences are never shown")
    pg.wait_for_timeout(800)
    ok(E("() => !!FCTell.view()"), "the new firm's view asked at once")
    E("() => { Cloud.st.firm = window.__f0; }")
    scene(view([book(cid, "tally_closed", tc[1], None)]), missing=True); pg.wait_for_timeout(800)
    nx = E("() => FCTell.nextOpen()")
    ok(590000 <= nx <= 600000, "the bell's query failed: asked again in 10 minutes (%s ms)" % nx)

    print("8. the Day Book is never asked for")
    src = open(os.path.join(HERE, "..", "app", "src", "screens", "Tally.jsx")).read() + open(os.path.join(HERE, "..", "src", "js", "61-recorder.js")).read()
    ok(not re.search(r"upload (that|this) day.s Day Book", src), "no 'upload that day's Day Book' left in the Tally page or the recorder's words")
    held = dict(HELD_OURS, id=778, line_id="L778", held_why="is an older entry, not this save: Tally could not tell which entry")
    held["client_id"] = cid
    E("(l) => { window.__w.lines = [l]; Rec.flowAt = 0; }", held)
    scene(view([book(cid, "days_waiting", CASES[15][1], None)]))
    E("(c) => Rec.openActivity(c)", cid); pg.wait_for_timeout(1800)
    body = pg.inner_text("body")
    ok(not re.search(r"upload (the|that day.s|one|this day.s) day ?book", body, re.I) and pg.locator("button:has-text('Upload the Day Book'), button:has-text('Upload Day Book')").count() == 0, "Sync activity: no Day Book asked for")
    nt = E("() => [...document.querySelectorAll('#app [data-needs-act=tell]')].map(e => e.innerText.trim())")
    ok(nt and all(x == CASES[15][1] for x in nt), "Needs you: the book's sentence instead (%s)" % nt)
    E("() => { navHome('tally'); }"); pg.wait_for_timeout(1300)
    ok(not re.search(r"upload (the|that day.s|one|this day.s) day ?book", pg.inner_text("body"), re.I) and pg.locator("button:has-text('Upload Day Book')").count() == 0, "the Tally page: no Day Book asked for")

    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
