"""python3 run_bankpost_e2e.py - bank lines posted from FinCom through the real bridge into a stand-in Tally, end to end:
every voucher carries its statement date; an entry Tally holds under the wrong date is found, stops the posting, is removed,
and the line goes in again at the right date; posting twice never makes a second copy; a voucher with no date is stopped
both in FinCom and in the bridge before it reaches Tally."""
import os as _os, shutil as _sh
HERE = _os.path.dirname(_os.path.abspath(__file__))
BRUN = _os.path.join(HERE, "out", "bankpostrun")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
import json, os, sys, time, threading, functools, http.server, subprocess, urllib.request, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
sys.path.insert(0, HERE)
import fake_tally
from playwright.sync_api import sync_playwright
fake_tally.start()
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8133), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
json.dump({"TallyTimeoutSec": 20}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br_p = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
BANK, PARTY = "HDFC BANK ACCOUNT", "2K Mart"
SETUP = """([k, bank, party]) => { Bridge.setCfg({url: "http://127.0.0.1:9100", key: k});
  const c = newCompany({name: "VMS EVENTS PRIVATE LIMITED (2024-25)", gstin: "07AADCV3366N1ZU"}); c.bankAccounts = [{id: "a1", bank: "HDFC", acct: "123", ledger: bank}];
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const rows = [["2025-06-02", 1000], ["2025-06-03", 2500], ["2025-06-04", 330], ["2025-06-05", 47000]].map(([d, amt], i) => ({id: "r" + i, fp: "fp-e2e-" + i, date: d, debit: amt, credit: 0,
    narr: "NEFT to supplier " + i, dec: {name: party, mode: "NEFT"}, ledger: party, state: "ready", balOk: true, ref: "UTR" + i}));
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "HDFC", acct: "123", from: "2025-06-02", to: "2025-06-05"}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: [], importedAt: ""}, newLed: [], keys: {}, books: {}, filter: "ready", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  return c.id; }"""
try:
    for i in range(60):
        time.sleep(1)
        try: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(); break
        except Exception: pass
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.goto("http://localhost:8133/"); pg.wait_for_timeout(2000)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate(SETUP, [key, BANK, PARTY]); pg.evaluate("Bridge.refresh()")
        ok(pg.evaluate("Bridge.st.version") == "1.13.9", "bridge 1.13.9 running against the stand-in Tally")
        ok(pg.evaluate("syncLedgersFromTally(true)") and pg.evaluate("!!exactLedger('%s') && !!exactLedger('%s')" % (BANK, PARTY)), "ledgers read from Tally")
        pg.evaluate("() => { B().rows.forEach(r => { r.state = 'ready'; }); }")
        # the dates themselves
        ok(pg.evaluate("[toTallyDate('2026-04-01'), toTallyDate('20260401'), toTallyDate('01/04/2026'), toTallyDate('2026-02-30'), toTallyDate(''), tallyDate('20260401')]") == ["20260401", "20260401", "20260401", "", "", "2026-04-01"],
           "toTallyDate: ISO, Tally and Indian dates become yyyymmdd; nonsense becomes empty; tallyDate still reads Tally dates for display")
        x = pg.evaluate("bankVoucherXml(B().rows[0], CO().bankAccounts[0], CO())")
        ok("<DATE>20250602</DATE>" in x and "<BANKERSDATE>20250602</BANKERSDATE>" in x, "a bank voucher carries its statement date (was empty: two functions named tallyDate)")
        # the statement's opening is Tally's balance the day before; its closing follows from its own lines
        bj = pg.evaluate("async () => (await Bridge.call('/balances?company=' + encodeURIComponent('VMS EVENTS PRIVATE LIMITED (2024-25)') + '&from=20250602&to=20250605')).ledgers.find(l => l.name === '%s')" % BANK)
        t_open = -float(bj["open"] or 0)
        pg.evaluate("(o) => { const st = curStmt(); st.opening = o; st.closing = r2(o - 1000 - 2500 - 330 - 47000); render(); }", t_open); pg.wait_for_timeout(500)
        ok(pg.locator(".sbar").count() == 0 and pg.locator("[data-btab='ready']").count() == 1 and "2 · Ready to post" in pg.inner_text(".bk-tabs"), "one row of tabs on the bank page, numbered in the order of the work")
        ok(pg.locator(".bk-actions [data-act='bankPick']").count() == 0 and pg.locator(".tbar [data-act='uploadHere']").count() == 1, "one Upload statement button")
        # an entry an earlier build left in Tally under another date
        tag0 = pg.evaluate("fpHash('fp-e2e-0')")
        fake_tally.POSTED.append(("20260927", "old | TDSDesk:" + tag0, "501", re.sub(r"<DATE>[^<]*</DATE>", "<DATE></DATE>", x)))
        pg.evaluate("postBankToTally()"); pg.wait_for_timeout(500)
        d = pg.evaluate("S.dupFind && {w: S.dupFind.wrongDate.length, e: S.dupFind.extra.length, when: S.dupFind.wrongDate[0] && S.dupFind.wrongDate[0].date}")
        ok(d and d["w"] == 1 and d["when"] == "20260927" and len(fake_tally.POSTED) == 1, "Post first looks through Tally beyond the statement's dates: the wrong-date entry is found and nothing is posted (%s)" % d)
        ok("under the wrong date" in pg.inner_text("#app") and "Remove the 1 wrong-date entry" in pg.inner_text("#app"), "the wrong-date entry is shown with its right date and a button to remove it")
        pg.click("[data-bfocus='dup-wrong']"); pg.wait_for_timeout(300)
        ok(pg.evaluate("bankVisibleRows().map(r => r.id)") == ["r0"] and "Showing 1 line: in Tally under the wrong date" in pg.inner_text(".bk-focus"), "'Show their statement lines' shows exactly the line concerned")
        pg.click("[data-act='bankFocusOff']"); pg.wait_for_timeout(200)
        ok(pg.locator(".bk-focus").count() == 0 and len(pg.evaluate("bankVisibleRows()")) > 0, "'Show all lines' goes back to the tab")
        pg.evaluate("() => { B().rows[0].state = 'intally'; B().postedTags[fpHash('fp-e2e-0')] = 'tally:x'; }")
        pg.evaluate("() => { window._rm = removeTallyDuplicates('wrong'); }"); pg.wait_for_timeout(400)
        pg.click('[data-cbx="yes"]'); pg.evaluate("window._rm")
        ok(fake_tally.DELETED == ["g-501"] and not fake_tally.POSTED, "removed from Tally by its GUID")
        ok(pg.evaluate("B().rows[0].state") == "ready" and not pg.evaluate("B().postedTags[fpHash('fp-e2e-0')]"), "its line is back to ready, not counted as posted")
        fake_tally.REQS.clear()
        pg.evaluate("() => { B().tallyLook = null; }")
        fake_tally.CTRL["read_delay"] = 0
        fake_tally.CTRL["read_delay_after_import"] = 3; fake_tally.CTRL["_imported"] = False
        t0 = time.time(); pg.evaluate("postBankToTally()"); dt = time.time() - t0
        ok(pg.evaluate("B().postReport.checking") is True and "checking them in Tally in the background" in pg.inner_text("#app"), "posting ends as soon as the entries are sent (%.1fs); the read-back runs in the background" % dt)
        for i in range(60):
            if pg.evaluate("!B().rows.some(r => r.checking) && !B().balBusy && !!curStmt().tallyBal"): break
            pg.wait_for_timeout(500)
        got = sorted((dd, re.search(r"TDSDesk:(\w+)", n).group(1)) for dd, n, _, _ in fake_tally.POSTED)
        want = sorted(zip(["20250602", "20250603", "20250604", "20250605"], pg.evaluate("[0,1,2,3].map(i => fpHash('fp-e2e-' + i))")))
        ok(got == want, "all 4 posted, each once, each on its statement date: %s" % got)
        ok(pg.evaluate("B().rows.every(r => r.state === 'sent' && r.postVerified)"), "then each line is confirmed in Tally, with its voucher number" + (" (%s)" % pg.evaluate("B().rows[0].tally.number")))
        rep = pg.evaluate("B().postReport")
        ok(rep["posted"] == 4 and not rep["failed"], "the report: 4 posted, none failed")
        fake_tally.CTRL["read_delay_after_import"] = 0
        heavy = {k: v for k, v in fake_tally.REQS.items() if k in ("DayBook", "TDSDeskVchHeads", "TDSDeskBalances")}
        ok(not heavy and fake_tally.REQS.get("TDSDeskLedVch") and fake_tally.REQS.get("TDSDeskOneLed") == 2, "posting and the balance check ask Tally for the bank ledger only: nothing company-wide (%s)" % dict(fake_tally.REQS))
        tb = pg.evaluate("curStmt().tallyBal")
        ok(tb and tb.get("diff") == 0 and "Tally agrees with the bank" in pg.inner_text(".bk-balbox"), "after posting, the balance is checked by itself: Tally agrees with the statement's closing (%s)" % (tb and {k: tb.get(k) for k in ("tClose", "sClose", "diff", "error")}))
        # someone enters a payment in Tally by hand that is not on the statement
        fake_tally.POSTED.append(("20250604", "cash typed in Tally", "777", '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20250604</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><NARRATION>cash typed in Tally</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>2K Mart</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-999.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC BANK ACCOUNT</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>999.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'))
        tb = pg.evaluate("checkBankBalance()")
        ok(tb["diff"] == 999 and tb["extra"] is None and "Reconcile with Tally" in pg.inner_text(".bk-balbox"), "the balance check alone only reads the balance, and offers to find the reason")
        tb = pg.evaluate("checkBankBalance({explain: true})")
        ok(tb and tb["diff"] == 999 and len(tb["extra"]) == 1 and tb["extra"][0]["eff"] == -999 and tb["unexplained"] == 0, "a payment typed in Tally by hand: the balance is 999 apart, and that entry is named as the whole reason (%s)" % (tb and {k: tb.get(k) for k in ("diff", "extraEffect", "unexplained")}))
        t = pg.inner_text(".bk-balbox")
        ok("Tally does not agree" in t and "2K Mart" in t and "make up the whole difference" in t, "and it says so on the page: " + t[:140].replace("\n", " "))
        pg.evaluate("() => { B().rows.forEach(r => { r.state = 'ready'; }); B().postedTags = {}; }")
        pg.evaluate("postBankToTally()")
        ok(len(fake_tally.POSTED) == 5, "posting the same lines again (this browser's memory wiped): Tally is checked, nothing goes in twice")
        ok(pg.evaluate("B().rows.every(r => r.state === 'intally')"), "and they show as already in Tally")
        # the user deletes FinCom's entries in Tally, and wants to post them again
        fake_tally.POSTED[:] = [x for x in fake_tally.POSTED if "TDSDesk:" not in x[1]]
        g = pg.evaluate("checkMarkedInTally()")
        ok(g and len(g["ids"]) == 4 and "4 lines are marked as posted, but are no longer in Tally" in pg.inner_text("#app"), "entries deleted in Tally are noticed: 4 lines marked as posted are no longer there, and it says so")
        pg.click("[data-act='goneBack']"); pg.wait_for_timeout(300)
        ok(pg.evaluate("B().rows.filter(r => r.state === 'ready').length") == 4 and pg.evaluate("B().filter") == "ready", "'Put them back in Ready to post': all 4 ready again")
        pg.evaluate("postBankToTally()")
        for i in range(60):
            if pg.evaluate("!B().rows.some(r => r.checking)"): break
            pg.wait_for_timeout(500)
        tags = [t for t in fake_tally.posted_tags()]
        ok(len(tags) == 4 and len(set(tags)) == 4 and pg.evaluate("B().rows.every(r => r.state === 'sent')"), "and Post sends them to Tally again, each once")
        pg.evaluate("checkMarkedInTally()")
        ok(not pg.evaluate("B().gone") and pg.locator("[data-act='goneBack']").count() == 0, "checked again: all are in Tally, nothing offered")
        # reconciliation: one line deleted in Tally, one posted twice, one with another amount, and one typed in Tally (the 999 above)
        tg = pg.evaluate("[0,1,2,3].map(i => fpHash('fp-e2e-' + i))")
        P = fake_tally.POSTED
        P[:] = [x for x in P if "TDSDesk:" + tg[1] not in x[1]]
        c2 = [x for x in P if "TDSDesk:" + tg[2] in x[1]][0]; P.append((c2[0], c2[1], "880", c2[3]))
        k3 = [i for i, x in enumerate(P) if "TDSDesk:" + tg[3] in x[1]][0]
        P[k3] = (P[k3][0], P[k3][1], P[k3][2], P[k3][3].replace("47000.00", "47500.00"))
        R = pg.evaluate("reconcileBank().then(R => R && {missing: R.missing, extra: R.extra.length, differ: R.differ.length, unexplained: R.unexplained, pick: R.pick.size})")
        ok(R and R["missing"] == ["r1"] and R["extra"] == 2 and R["differ"] == 1 and R["unexplained"] == 0, "reconcile: 1 line not in Tally, 2 entries in Tally not on the statement, 1 amount differs, nothing unexplained (%s)" % R)
        t = pg.inner_text(".recon")
        ok("Balance in Tally on" in t and "Balance as per the bank statement" in t and "typed in Tally" in t and "second copy" in t, "the reconciliation statement and the lists are shown")
        ok(R["pick"] == 1, "the copy is ticked for deletion; the entry typed in Tally is not, until you tick it")
        pg.click("[data-reconpick]:not(:checked)"); pg.wait_for_timeout(200)
        # a Tally that refuses to delete: nothing is claimed, and Tally's own words are shown
        fake_tally.CTRL["delete_mode"] = "refuse"; nd = len(fake_tally.DELETED)
        pg.evaluate("() => { window._rd = reconDelete('delete'); }"); pg.wait_for_timeout(300); pg.click('[data-cbx="yes"]'); pg.evaluate("window._rd")
        ok(len(fake_tally.DELETED) == nd and "not allowed for this user" in pg.inner_text(".recon") and pg.evaluate("S.recon.extra.length") == 2, "a Tally that refuses: nothing deleted, and Tally's reason is shown in the reconciliation")
        # a Tally that deletes only by date and voucher number: found that way
        fake_tally.CTRL["delete_mode"] = "number"
        pg.evaluate("() => { S.recon.pick = new Set(S.recon.extra); render(); }")
        pg.evaluate("() => { window._rd = reconDelete('delete'); }"); pg.wait_for_timeout(300); pg.click('[data-cbx="yes"]'); pg.evaluate("window._rd")
        fake_tally.CTRL["delete_mode"] = ""
        ok(len(fake_tally.DELETED) >= 3 and "880" not in [x[2] for x in fake_tally.POSTED] and not [x for x in fake_tally.POSTED if x[1] == "cash typed in Tally"], "'Delete the ticked from Tally': the copy and the typed entry are gone")
        pg.evaluate("reconPost()")
        for i in range(60):
            if pg.evaluate("!B().rows.some(r => r.checking)"): break
            pg.wait_for_timeout(500)
        ok(len([x for x in fake_tally.POSTED if "TDSDesk:" + tg[1] in x[1]]) == 1, "'Post these to Tally': the missing line goes in, once")
        pg.evaluate("() => { window._rr = reconDelete('replace'); }"); pg.wait_for_timeout(300); pg.click('[data-cbx="yes"]'); pg.evaluate("window._rr")
        for i in range(60):
            if pg.evaluate("!B().rows.some(r => r.checking)"): break
            pg.wait_for_timeout(500)
        e3 = [x for x in fake_tally.POSTED if "TDSDesk:" + tg[3] in x[1]]
        ok(len(e3) == 1 and "47000.00" in e3[0][3], "'Replace them': the entry with the wrong amount is replaced by the statement's amount")
        R = pg.evaluate("reconcileBank().then(R => R && {missing: R.missing.length, extra: R.extra.length, differ: R.differ.length, t: R.tClose, s: R.sClose})")
        ok(R and R["missing"] == R["extra"] == R["differ"] == 0 and abs(R["t"] - R["s"]) < 0.01 and "Reconciled" in pg.inner_text(".recon"), "reconciled: every line in Tally once, and the balances agree (%s)" % R)
        with pg.expect_download() as dl: pg.click("[data-act='reconExcel']")
        ok(dl.value.suggested_filename.endswith(".xlsx") and os.path.getsize(dl.value.path()) > 2000, "the bank reconciliation downloads as Excel (%s)" % dl.value.suggested_filename)
        # an entry dated long after the statement, in a Tally that gives its latest balance whatever date is asked
        fake_tally.POSTED.append(("20270331", "year end entry", "990", '<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20270331</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><NARRATION>year end entry</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>2K Mart</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>5000.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC BANK ACCOUNT</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-5000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'))
        fake_tally.CTRL["ignore_balance_dates"] = True
        R = pg.evaluate("reconcileBank().then(R => R && {missing: R.missing.length, extra: R.extra.length, t: R.tClose, s: R.sClose, how: R.how})")
        tb = pg.evaluate("checkBankBalance().then(t => ({diff: t.diff, how: t.how}))")
        fake_tally.CTRL["ignore_balance_dates"] = False
        ok(R and R["missing"] == R["extra"] == 0 and abs(R["t"] - R["s"]) < 0.01 and R["how"] == "worked back" and tb["diff"] == 0, "an entry of 31-03-2027 in a Tally that ignores the date asked: not counted in the statement's balance, still reconciled (%s, %s)" % (R, tb))
        ok("worked back" in pg.inner_text(".bk-balbox"), "and the balance box says the balance was worked back")
        pg.click(".bk-balbox .bk-x"); pg.wait_for_timeout(200)
        ok(pg.locator(".bk-balbox").count() == 0, "the balance box closes with its ×")
        pg.evaluate("checkBankBalance()"); pg.wait_for_timeout(200)
        ok(pg.locator(".bk-balbox").count() == 1, "and comes back with the next check")
        # while FinCom works, what it is doing floats in view wherever the page is scrolled
        pg.evaluate("() => { window.scrollTo(0, 99999); B().busy = 'Deleting 1 of 2 in Tally…'; render(); }"); pg.wait_for_timeout(200)
        bb = pg.evaluate("(() => { const e = document.querySelector('.busy-float'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.top, r.bottom, innerHeight, getComputedStyle(e).position]; })()")
        ok(bb and bb[3] == "fixed" and 0 <= bb[0] < bb[2] and "1 / 2" not in "" , "the working message floats in view (%s)" % bb)
        pg.evaluate("() => { B().busy = ''; render(); }")
        # the last line of the list can always be scrolled above the bars at the bottom of the window
        pg.evaluate("() => { B().filter = 'done'; render(); }"); pg.wait_for_timeout(300)
        pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)"); pg.wait_for_timeout(300)
        lastb = pg.evaluate("(() => { const rs = document.querySelectorAll('.bk-table tbody tr'); return rs.length ? rs[rs.length - 1].getBoundingClientRect().bottom : 0; })()")
        bart = pg.evaluate("(() => { const a = document.querySelector('.actionbar'); return a ? a.getBoundingClientRect().top : 99999; })()")
        ok(lastb <= bart, "scrolled to the end, the last line sits above the action bar (%d <= %d)" % (lastb, bart))
        # a Tally that will not give one ledger's vouchers: the bridge falls back to the Day Book, and the answer is the same
        fake_tally.CTRL["no_ledvch"] = True
        R2 = pg.evaluate("reconcileBank().then(R => R && {missing: R.missing.length, extra: R.extra.length, differ: R.differ.length, t: R.tClose, s: R.sClose, pairs: R.pairs})")
        fake_tally.CTRL["no_ledvch"] = False
        ok(R2 and R2["pairs"] == 4 and R2["missing"] == R2["extra"] == R2["differ"] == 0 and abs(R2["t"] - R2["s"]) < 0.01, "a Tally that refuses the one-ledger read: the Day Book is read instead, same answer (%s)" % R2)
        n_before = len(fake_tally.POSTED)
        # a voucher without a date never reaches Tally: stopped in FinCom ...
        r = pg.evaluate("""async () => (await Bridge.post({company: "VMS EVENTS PRIVATE LIMITED (2024-25)", masters: [], vouchers: [{id: "nodate", xml: '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE></DATE><NARRATION>x TDSDesk:zz1</NARRATION></VOUCHER>'}, {id: "early", xml: '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20230101</DATE><NARRATION>x TDSDesk:zz2</NARRATION></VOUCHER>'}]})).results""")
        ok(len(fake_tally.POSTED) == n_before and {x["id"]: x["ok"] for x in r} == {"nodate": False, "early": False} and "no date" in r[0]["message"] and "before" in r[1]["message"], "no date, or a date before the books begin: refused by FinCom, nothing sent (%s)" % [x["message"][:40] for x in r])
        # ... and in the bridge, for anything that bypasses FinCom's own check
        req = urllib.request.Request("http://127.0.0.1:9100/import", data=json.dumps({"company": "VMS EVENTS PRIVATE LIMITED (2024-25)", "masters": [], "vouchers": [{"id": "nd", "xml": '<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE></DATE><NARRATION>y</NARRATION></VOUCHER>'}]}).encode(), headers={"X-Bridge-Key": key, "Content-Type": "application/json"})
        jr = json.loads(urllib.request.urlopen(req, timeout=60).read())
        ok(len(fake_tally.POSTED) == n_before and not jr["results"][0]["ok"] and "no valid date" in jr["results"][0]["message"], "the bridge itself refuses a voucher with no date")
        br.close()
finally:
    br_p.kill()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
