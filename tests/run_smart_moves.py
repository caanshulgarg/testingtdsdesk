"""python3 run_smart_moves.py - smart moves, round 1 (approved by the owner on 09-Oct-2026): after a piece of work ends,
the page moves on to what comes next, or says where to go. Navigation and display only: nothing is approved, posted or
sent to Tally by a move.

Checked here, with the clock set to 09-Oct-2026 10:00 IST and the books in tests/data (they end on 31-Mar-2026):
  1. a toast with buttons (its words kept apart from them); Smart.go; the switches under Settings → Move on by itself;
  2. bills read: Review opens when the upload's page is still open and nothing is typed (one bill: the bill opens);
     else a toast "3 bills read for <client>" with "Review them →" (also on the Clients page); no move while typing in
     Look up (the bug of S.advanceAfterRead); each file counted once; Back and Stay here undo the move; switch off: toast only;
  3. Look up: From 01-Apr-2026, To today; "this month" is October 2026; the books-end line with Read 2026-27 and Show
     2025-26; the dates kept per client;
  4. Look up: narration only when asked or opened; opening and closing once; earlier years folded; source and names under More;
  5. Approve: "Approved … Next: <party> <no> (N left)" with Undo; Back returns; no move while a box has focus or with the
     switch off; No entry needed and Keep both move on too; the end of the list: "All N bills reviewed · Post N to Tally →";
  6. a posting run's end: Posted (all went in) or Errors with the failed bills first and "Fix in bill →"; Back shows the tab before;
  7. the page last shown for the client opens next time; after signing in: "Back where you left off" with Clients;
  8. Approve all: "Post N to Tally →" and "Show the N that need details";
  9. a setup page reached from Post to Tally: "← Back to Post to Tally"; after Save "Saved. Back to Post to Tally";
 10. Getting ready: the first step not done is the one primary "Next" button; a step done: "<done> · Next: <step> →";
     the opening balances have their own target;
 11. the period a page opens on: TDS on Q2 2026-27 (due 31-Oct), GST on Sep-2026 (monthly; QRMP: the quarter just
     ended), MIS this year to date, Reports 2026-27, each with the one "not read yet" line when the books end earlier;
     Letters keep 31-Mar-2026 for confirmations and today for reminders; the choice is kept per page and client.
Also: no move with a dialog open or a change unsaved; prefers-reduced-motion: no toast animation.
Offline, made-up bills; the firm account is not used. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_smart_moves.py"""
import os, re, json, datetime, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8463), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
BOOKS = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))))
NOW = datetime.datetime(2026, 10, 9, 4, 30, tzinfo=datetime.timezone.utc)          # 09-Oct-2026 10:00 IST
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = """() => { const c = newCompany({name: "ZZ Smart Moves", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  c.tallyName = ""; Store.saveCompany(c); return c.id; }"""
# bills for the open client: [vendor, no, date, amount]; returns their ids
MK = """(a) => { const [cid, list] = a; return list.map(([n, no, d, amt]) => { const e = newEntry(n + ".pdf");
  Object.assign(e.x, {vendorName: n, vendorPan: "AABCA" + String(1000 + Math.floor(Math.random() * 8999)) + "K", invoiceNo: no, invoiceDate: d, taxable: amt, total: amt});
  e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[cid].entries[e.id] = e; Store.saveEntry(cid, e); return e.id; }); }"""
# a batch of files read: jobs as the reading queue leaves them, started on page `from`
JOBS = """(a) => { const [cid, ids, from, st] = a; ids.forEach((id, i) => S.jobs.push({id: uid("j"), name: "f" + i + ".pdf", status: st || "done", cid, target: cid, entryId: id, from})); afterBatch(); }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1400, "height": 900})
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.clock.install(time=NOW)
    E = pg.evaluate
    W = pg.wait_for_timeout
    pg.goto("http://localhost:8463/"); W(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); W(1000)
    toast_words = lambda: E("(() => { const t = document.getElementById('toast'); if (!t || t.classList.contains('hidden')) return ''; const c = t.cloneNode(true); c.querySelectorAll('[data-toast-acts]').forEach(x => x.remove()); return c.textContent.trim(); })()")
    toast_acts = lambda: E("Array.from(document.querySelectorAll('#toast:not(.hidden) [data-toast-act]')).map(b => b.textContent)")
    hide = lambda: E("() => { if (typeof toastHide === 'function') toastHide(); }")
    def hide_safe():
        try: E("() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); const b = document.querySelector('#confirmBox [data-cbx=no]'); if (b) b.click(); if (typeof toastHide === 'function') toastHide(); }")
        except Exception: pass
    cid = E(SETUP)
    E("(c) => openCompany(c)", cid); W(800)

    # ---------------------------------------------------------------- 1. the toast with buttons; the switches
    try:
        print("1. a toast with buttons, Smart.go, the switches")
        E("() => { window.__ran = 0; toast('Something happened', {actions: [{label: 'Do it', run: () => { window.__ran++; }}]}); }"); W(200)
        ok(toast_words() == "Something happened" and toast_acts() == ["Do it"], "a toast's words and its button are apart (%r, %r)" % (toast_words(), toast_acts()))
        pg.click('#toast [data-toast-act="Do it"]'); W(300)
        ok(E("window.__ran") == 1 and E("document.getElementById('toast').classList.contains('hidden') || document.getElementById('toast').classList.contains('out')"), "its button runs once and the toast goes")
        E("() => toast('Plain words only')"); W(100)
        ok(toast_acts() == [] and toast_words() == "Plain words only", "a toast without buttons is as before")
        E("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'moves'; render(); }"); W(500)
        sw = pg.locator("#app [data-move-switches] input[type=checkbox]")
        ok(sw.count() == 5 and all(sw.nth(i).is_checked() for i in range(sw.count())), "Settings → Move on by itself: five switches, all on (%d)" % sw.count())
        ok("how the work is done" in pg.inner_text("#app .setnav").lower(), "the section is under How the work is done")
        pg.locator('#app [data-move="upload"]').uncheck(); W(200)
        ok(E("lsGet(Smart.key('upload'))") == "0" and E("Smart.on('upload')") is False, "a switch turned off is kept (this browser)")
        pg.locator('#app [data-move="upload"]').check(); W(200)
        ok(E("Smart.on('upload')") is True, "and on again")
        E("(c) => openCompany(c)", cid); W(500)

    except Exception as ex:
        ok(False, '1. the toast with buttons; the switches' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 2. bills read
    try:
        print("2. bills read")
        E("() => { goStep('collect', 'bills'); }"); W(400)
        up = E("location.hash"); ok(up.endswith("/upload"), "the Upload page (%s)" % up)
        ids = E(MK, [cid, [["Alpha Consultants", "A/1", "2026-09-19", 100000], ["Beta Traders", "B/7", "2026-09-20", 20000], ["Gamma Works", "G/3", "2026-09-21", 30000]]])
        E(JOBS, [cid, ids, up]); W(600)
        ok(E("location.hash").endswith("/purchase/review"), "still on the Upload page, nothing typed: Review opens (%s)" % E("location.hash"))
        ok(toast_words().startswith("Moved to Review (3 bills") and "Stay here" in toast_acts(), "toast: %r %r" % (toast_words(), toast_acts()))
        pg.click('#toast [data-toast-act="Stay here"]'); W(800)
        ok(E("location.hash") == up, "Stay here: back on the Upload page (%s)" % E("location.hash"))
        # Back undoes it too
        more = E(MK, [cid, [["Delta Co", "D/1", "2026-09-22", 5000], ["Eta Co", "E/1", "2026-09-22", 6000]]])
        E(JOBS, [cid, more, up]); W(600)
        ok(E("location.hash").endswith("/purchase/review") and toast_words().startswith("Moved to Review (2 bills"), "a second batch: counted on its own, 2 bills (%r)" % toast_words())
        pg.go_back(); W(900)
        ok(E("location.hash") == up, "Back: the Upload page again")
        # one bill: the bill itself opens
        one = E(MK, [cid, [["Zeta Ltd", "Z/9", "2026-09-23", 7000]]])
        E(JOBS, [cid, one, up]); W(700)
        ok(E("location.hash").endswith("/bill/" + one[0]) and E("S.selected") == one[0], "one bill read: that bill opens (%s)" % E("location.hash"))
        ok("Zeta Ltd" in toast_words(), "and the toast names it (%r)" % toast_words())
        # typing in Look up while the upload (started on the Upload page) ends: nothing moves, the typing stays
        E("(c) => { S.books = Object.assign({loading: false, challans: [], alloc: {}}, window.__bk || {}, {cid: c}); goClient('books:lookup'); }", cid); W(700)
        look = E("location.hash")
        pg.click("#lkAsk"); pg.keyboard.type("ICICI", delay=20)
        two = E(MK, [cid, [["Theta Pvt", "T/1", "2026-09-24", 8000], ["Iota Pvt", "I/1", "2026-09-24", 9000], ["Kappa Pvt", "K/1", "2026-09-24", 1000]]])
        E(JOBS, [cid, two, up]); W(600)
        ok(E("location.hash") == look and E("document.activeElement.id") == "lkAsk" and E("document.getElementById('lkAsk').value") == "ICICI",
           "typing in Look up when the bills are read: the page stays, the cursor and the words too (%s, %s)" % (E("location.hash"), E("document.activeElement.id")))
        ok(toast_words().startswith("3 bills read for ZZ Smart Moves") and "Review them →" in toast_acts(), "toast instead: %r %r" % (toast_words(), toast_acts()))
        E("() => document.activeElement.blur()")
        pg.click('#toast [data-toast-act="Review them →"]'); W(800)
        ok(E("location.hash").endswith("/purchase/review"), "Review them →: Review opens")
        # read while on another page (no typing): a toast, not a move; the next batch counts only its own bills
        E("() => goClient('dash')"); W(400)
        b1 = E(MK, [cid, [["Lambda Co", "L/1", "2026-09-25", 1000], ["Mu Co", "M/1", "2026-09-25", 1000]]])
        E(JOBS, [cid, b1, up]); W(500)
        ok(E("location.hash").endswith("/dash") and toast_words().startswith("2 bills read for"), "started on Upload, now on the Dashboard: a toast only (%r)" % toast_words())
        E("() => goStep('collect', 'bills')"); W(400)
        b2 = E(MK, [cid, [["Nu Co", "N/1", "2026-09-26", 1000]]])
        E(JOBS, [cid, b2, E("location.hash")]); W(500)
        ok(E("S.jobs.filter(j => !j.advanced).length") == 0 and "Nu Co" in toast_words() and "2 bills" not in toast_words(), "the next upload counts its own bill only, not the 2 before (%r)" % toast_words())
        # the switch off: a toast only, even on the page
        E("() => { Smart.set('upload', false); goStep('collect', 'bills'); }"); W(400)
        up2 = E("location.hash"); b3 = E(MK, [cid, [["Xi Co", "X/1", "2026-09-26", 1000], ["Omicron", "O/1", "2026-09-26", 1000]]])
        E(JOBS, [cid, b3, up2]); W(500)
        ok(E("location.hash") == up2 and toast_words().startswith("2 bills read for") and "Review them →" in toast_acts(), "switch off: the page stays, the toast offers Review (%r)" % toast_words())
        E("() => Smart.set('upload', true)")
        # an upload from the Clients page (any client): Review of that client opens if Clients is still shown
        E("() => navHome('clients')"); W(500)
        cl = E("location.hash"); b4 = E(MK, [cid, [["Pi Co", "P/1", "2026-09-27", 1000], ["Rho Co", "R/1", "2026-09-27", 1000]]])
        E("(a) => { const [cid, ids, from] = a; ids.forEach((id, i) => S.jobs.push({id: uid('j'), name: 'c' + i, status: 'done', cid, target: 'auto', entryId: id, from})); afterBatch(); }", [cid, b4, cl]); W(800)
        ok(E("location.hash").endswith("/purchase/review") and E("S.coId") == cid, "from the Clients page, still on it: that client's Review opens (%s)" % E("location.hash"))
        E("() => navHome('today')"); W(400)
        b5 = E(MK, [cid, [["Sigma Co", "S/1", "2026-09-27", 1000]]])
        E("(a) => { const [cid, ids, from] = a; ids.forEach((id, i) => S.jobs.push({id: uid('j'), name: 'c' + i, status: 'done', cid, target: 'auto', entryId: id, from})); afterBatch(); }", [cid, b5, cl]); W(500)
        ok(E("location.hash") == "#/today" and toast_words().startswith("1 bill read for ZZ Smart Moves") and "Open it →" in toast_acts(), "from Clients, now on Today: '1 bill read for ZZ Smart Moves · Open it →' (%r %r)" % (toast_words(), toast_acts()))
        # a dialog open: no move
        E("(c) => openCompany(c).then(() => goStep('collect', 'bills'))", cid); W(500)
        up3 = E("location.hash"); b6 = E(MK, [cid, [["Tau Co", "U/1", "2026-09-28", 1000], ["Phi Co", "F/1", "2026-09-28", 1000]]])
        E("() => { window.__dlg = askConfirm({title: 'A question', ok: 'Yes', body: '<p>?</p>'}); }"); W(300)
        E(JOBS, [cid, b6, up3]); W(500)
        ok(E("location.hash") == up3 and toast_words().startswith("2 bills read"), "a dialog open: the page stays (%s)" % E("location.hash"))
        pg.keyboard.press("Escape"); W(300)
        E("() => { const b = document.querySelector('#confirmBox [data-cbx=\"no\"], #confirmBox button'); if (b) b.click(); }"); W(300)
        # the bills are left as they were: nothing approved by a move
        ok(E("(c) => Object.values(S.data[c].entries).every(e => e.status === 'draft')", cid), "every bill is still To review: a move approves nothing")
        hide()

    except Exception as ex:
        ok(False, '2. bills read' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 5. approve, the next bill
    try:
        print("5. approve and the next bill")
        E("(c) => { Object.values(S.data[c].entries).forEach(e => { e.status = 'rejected'; Store.saveEntry(c, e); }); }", cid)
        q = E(MK, [cid, [["Alpha One", "A1/1", "2026-09-10", 100000], ["Beta Two", "B2/7", "2026-09-11", 20000], ["Gamma Three", "G3/3", "2026-09-12", 30000]]])
        E("(a) => { goStep('review', 'bills'); S.reviewTable = false; S.filter = 'draft'; S.selected = a; render(); }", q[0]); W(600)
        miss = E("(a) => compute(D().entries[a]).missing", q[0])
        ok(not miss, "the made-up bill can be approved (%s)" % miss)
        h0 = E("location.hash")
        pg.click('#app .actionbar button:has-text("Approve")'); W(600)
        ok(E("S.selected") == q[1] and E("(a) => D().entries[a].status", q[0]) == "approved", "Approve: the next bill opens (%s)" % E("S.selected"))
        ok(toast_words().startswith("Approved.") and "Next: Beta Two B2/7 (2 left)" in toast_words() and "Undo" in toast_acts(), "toast: %r %r" % (toast_words(), toast_acts()))
        pg.go_back(); W(900)
        ok(E("S.selected") == q[0] and E("location.hash") == h0, "Back: the approved bill again")
        E("(a) => { S.selected = a; render(); }", q[0]); W(300)
        E("(a) => { S.selected = a; render(); }", q[1]); W(300)
        # Undo from the toast
        pg.click('#app .actionbar button:has-text("Approve")'); W(500)
        pg.click('#toast [data-toast-act="Undo"]'); W(600)
        ok(E("(a) => D().entries[a].status", q[1]) == "draft" and E("S.selected") == q[1], "Undo: the bill is To review again, and open")
        # a dialog open when the bill is approved (an approval asked from elsewhere): the page stays, the toast offers Next
        E("() => { askConfirm({title: 'A question', ok: 'Yes', body: '<p>?</p>'}); }"); W(300)
        E("(a) => approve(D().entries[a])", q[1]); W(500)
        ok(E("(a) => D().entries[a].status", q[1]) == "approved" and E("S.selected") == q[1] and "Next →" in toast_acts(), "approved with a dialog open: the bill stays, toast with Next → (%r)" % toast_acts())
        hide_safe()
        # the cursor in a box, then Ctrl+Enter: the box is left first (as before), so the next bill opens
        E("(a) => { undoApproval(D().entries[a]); S.selected = a; render(); }", q[1]); W(400)
        pg.locator('#app .detail input[type=text]').first.click(); W(200)
        pg.keyboard.press("Control+Enter"); W(700)
        ok(E("(a) => D().entries[a].status", q[1]) == "approved" and E("S.selected") == q[2], "Ctrl+Enter from a box: the box is left, approved, the next bill opens")
        # No entry needed moves on too, with Undo
        E("(a) => { S.selected = a; render(); }", q[2]); W(300)
        left = E("Object.values(D().entries).filter(e => e.status === 'draft').length")
        pg.click('#app .actionbar button:has-text("No entry needed")'); W(500)
        ok(E("(a) => D().entries[a].status", q[2]) == "rejected" and "Undo" in toast_acts() and toast_words().startswith("Marked as no entry needed."), "No entry needed: set aside, with Undo (%r)" % toast_words())
        pg.click('#toast [data-toast-act="Undo"]'); W(500)
        ok(E("(a) => D().entries[a].status", q[2]) == "draft", "its Undo puts it back")
        # switch off: approve stays
        E("(a) => { Smart.set('approve', false); S.selected = a; render(); }", q[2]); W(300)
        pg.click('#app .actionbar button:has-text("Approve")'); W(500)
        ok(E("S.selected") == q[2] and E("(a) => D().entries[a].status", q[2]) == "approved", "switch off: the approved bill stays on screen")
        E("() => Smart.set('approve', true)")
        # the end of To review
        for e in E("Object.values(D().entries).filter(e => e.status === 'draft').map(e => e.id)"):
            E("(a) => { S.selected = a; render(); }", e); W(200)
            E("(a) => approve(D().entries[a])", e); W(300)
        E("() => { S.filter = 'draft'; render(); }"); W(400)
        qd = pg.locator("#app [data-queue-done]")
        waiting = E("Object.values(D().entries).filter(e => e.status === 'approved' && !e.exportedAt).length")
        ok(qd.count() == 1 and ("All %d bills reviewed" % waiting) in qd.inner_text() and ("Post %d to Tally →" % waiting) in qd.inner_text(), "end of To review: %r" % (qd.inner_text() if qd.count() else ""))
        qd.locator("button").click(); W(600)
        ok(E("location.hash").endswith("/post/bills") and E("Object.values(D().entries).every(e => !e.exportedAt)"), "Post N to Tally →: only the Post page opens; nothing is sent")
        hide()

    except Exception as ex:
        ok(False, '5. approve, the next bill' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 8. approve all
    try:
        print("8. approve all in the table")
        E("(c) => { Object.values(S.data[c].entries).forEach(e => { if (e.status === 'draft') { e.status = 'rejected'; Store.saveEntry(c, e); } }); }", cid)
        r8 = E(MK, [cid, [["Ok One", "O1", "2026-09-01", 1000], ["Ok Two", "O2", "2026-09-02", 1000], ["Short Three", "S3", "2026-09-03", 1000]]])
        E("(a) => { const e = D().entries[a]; e.x.invoiceDate = ''; Store.saveEntry(S.coId, e); }", r8[2])
        E("() => { goStep('review', 'bills'); S.revSel = new Set(Object.values(D().entries).filter(e => e.status === 'draft').map(e => e.id)); render(); doAct('revApprove'); }"); W(600)
        acts = toast_acts(); w8 = E("Object.values(D().entries).filter(e => e.status === 'approved' && !e.exportedAt).length")
        ok(toast_words() == "2 approved, 1 still need details." and ("Post %d to Tally →" % w8) in acts and "Show the 1 that needs details" in acts, "toast: %r %r" % (toast_words(), acts))
        pg.click('#toast [data-toast-act="Show the 1 that needs details"]'); W(500)
        ok(E("Array.from(S.revSel || [])") == [r8[2]], "Show the 1 that needs details: it is picked in the table")
        hide()

    except Exception as ex:
        ok(False, '8. approve all' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 6. a posting run ends
    try:
        print("6. a posting run ends")
        E("() => { goStep('post', 'bills'); }"); W(600)
        hp = E("location.hash")
        E("(c) => { S.postTabs = {}; S.billPost = {done: true, ok: 6, bad: 0, failed: [], dup: 0}; postRunShow(c, S.billPost, Smart.here()); }", cid); W(500)
        ok(E("(c) => S.postTabs[c]", cid) == "posted" and pg.locator('#app [data-post-tab="posted"][aria-selected="true"]').count() == 1, "all posted: the Posted tab")
        ok(toast_words() == "6 posted" and "Stay here" in toast_acts(), "toast: %r %r" % (toast_words(), toast_acts()))
        pg.go_back(); W(800)
        ok(E("(c) => S.postTabs[c] || 'topost'", cid) == "topost" and E("location.hash") == hp, "Back: To post again, on the same page")
        fb = r8[0]
        E("(a) => { const [c, id] = a; S.postTabs = {}; S.billPost = {done: true, ok: 4, bad: 1, failed: [{id, no: 'O1', party: 'Ok One', msg: 'Tally does not have the ledger “Ok One”.'}], dup: 0}; postRunShow(c, S.billPost, Smart.here()); }", [cid, fb]); W(500)
        ok(E("(c) => S.postTabs[c]", cid) == "errors" and toast_words().startswith("4 posted, 1 not posted"), "a failure: the Errors tab (%r)" % toast_words())
        first = pg.locator("#app [data-post-panel=errors] section").first
        ok(first.get_attribute("data-run-failed") == "" and "Ok One O1" in first.inner_text() and first.locator("[data-fix-bill]").count() == 1, "the failed bill first, with Fix in bill →")
        first.locator("[data-fix-bill]").click(); W(600)
        ok(E("location.hash").endswith("/bill/" + fb), "Fix in bill →: the bill opens (%s)" % E("location.hash"))
        E("() => { Smart.set('post', false); goStep('post', 'bills'); S.postTabs = {}; }"); W(400)
        E("(c) => { S.billPost = {done: true, ok: 2, bad: 0, failed: []}; postRunShow(c, S.billPost, Smart.here()); }", cid); W(400)
        ok(E("(c) => S.postTabs[c] || 'topost'", cid) == "topost" and "Show Posted →" in toast_acts(), "switch off: the tab stays, the toast offers Show Posted →")
        E("() => Smart.set('post', true)"); hide()

    except Exception as ex:
        ok(False, '6. a posting run ends' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 9. back from a setup page
    try:
        print("9. a setup page and the way back")
        E("() => goStep('post', 'bills')"); W(400)
        E("() => goChooseTallyCompany()"); W(500)
        ok(E("location.hash").endswith("/setup/cotally") and pg.locator("#app [data-back-to]").inner_text() == "← Back to Post to Tally", "Choose the Tally company: the setup page with ← Back to Post to Tally")
        E("() => Smart.afterSave()"); W(700)
        ok(E("location.hash").endswith("/post/bills") and toast_words() == "Saved. Back to Post to Tally", "after Save: back on Post to Tally (%r)" % toast_words())
        E("() => { Smart.set('setup', false); goChooseTallyCompany(); }"); W(400)
        E("() => Smart.afterSave()"); W(400)
        ok(E("location.hash").endswith("/setup/cotally") and "Back to Post to Tally →" in toast_acts(), "switch off: the page stays; 'Back to Post to Tally →' offered")
        pg.click("#app [data-back-to]"); W(600)
        ok(E("location.hash").endswith("/post/bills"), "← Back to Post to Tally works")
        E("() => Smart.set('setup', true)"); hide()

    except Exception as ex:
        ok(False, '9. back from a setup page' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 10. Getting ready
    try:
        print("10. Getting ready")
        E("() => goClient('dash')"); W(800)
        nx = pg.locator("#app [data-onb-next]")
        ok(nx.count() == 1 and "primary" in (nx.get_attribute("class") or "") and nx.inner_text().startswith("Next: "), "one primary Next button (%s)" % (nx.inner_text() if nx.count() else ""))
        ok(pg.locator('#app [data-onb-step="opening"] button').inner_text() == "Read the balances", "the opening balances have their own button")
        E("() => { Smart._onbAt = 0; Smart.onbWatch(); CO().tallyName = 'ZZ SMART'; Store.saveCompany(CO()); Smart._onbAt = 0; Smart.onbWatch(); }"); W(300)
        ok(toast_words() == "Tally name saved" and any(a.startswith("Next: ") and a.endswith("→") for a in toast_acts()), "a step done: %r %r" % (toast_words(), toast_acts()))
        pg.locator('#app [data-onb-step="opening"] button').click(); W(600)
        ok(E("location.hash").endswith("/books/import") and pg.locator("#app [data-up-opening]").count() == 1, "Read the balances: From Tally, with how to bring the opening balances")
        hide()

    except Exception as ex:
        ok(False, '10. Getting ready' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 3, 4. Look up
    try:
        print("3, 4. Look up")
        E("""(bk) => { S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: S.coId}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.lk = null; lsDel(Smart.pkey('lookup')); goClient('books:lookup'); }""", BOOKS); W(1200)
        E("() => { S.books = window.__bk; render(); }"); W(500)
        x = E("({from: LK.st().from, to: LK.st().to})")
        ok(x == {"from": "20260401", "to": "20261009"}, "Look up opens on 01-Apr-2026 to today, 09-Oct-2026 (%s)" % x)
        ok(E("FC.period('month')") == {"from": "20261001", "to": "20261031"} and E("FC.period('quarter')") == {"from": "20261001", "to": "20261231"}, "This month is October 2026; this quarter Oct-Dec 2026")
        nr = pg.locator("#app [data-not-read]")
        ok(nr.count() == 1 and "Books in FinCom end 31-Mar-2026" in nr.inner_text() and "Read 2026-27 from Tally →" in nr.inner_text() and "Show 2025-26" in nr.inner_text(), "the one books-end line (%s)" % (nr.inner_text().replace("\n", " ") if nr.count() else ""))
        led = E("FC.ledgers().find(l => /bank/i.test(l) && (S.books.vouchers || []).filter(v => v.ent.some(e => e.l === l)).length > 20)") or E("FC.ledgers()[0]")
        E("(l) => { LK.st().led = l; LK.st().kind = 'ledger'; render(); }", led); W(200)
        pg.click("#app [data-not-read-show]"); W(1200)
        ok(E("[LK.st().from, LK.st().to]") == ["20250401", "20260331"] and E("!!LK.st().res"), "Show 2025-26: the last year read, worked out")
        ok(pg.locator("#app [data-not-read]").count() == 0, "and the line goes")
        # narration only when asked; opening and closing once
        nn = E("document.querySelectorAll('#app .lk-res table.lk-t tr.lk-v .nr').length")
        ok(nn == 0, "no narration under each entry (%d)" % nn)
        pg.locator("#app [data-lk-narr]").check(); W(400)
        ok(E("document.querySelectorAll('#app .lk-res table.lk-t tr.lk-v .nr').length") > 0, "Show narration: the narrations show")
        pg.locator("#app [data-lk-narr]").uncheck(); W(300)
        tiles = E("Array.from(document.querySelectorAll('#app .lk-res .dash-tiles .dtile span')).map(s => s.textContent)")
        ok("Opening" not in tiles and pg.locator("#app .lk-res tr.lk-ob").count() <= 1 and "Closing" not in tiles or E("LK.st().res.close == null"), "opening and closing each shown once (tiles %s)" % tiles)
        ok(pg.locator("#app details[data-lk-more=src] .lk-src, #app details[data-lk-more=src] .lk-names").count() + (0 if pg.locator("#app .lk-src").count() else 1) >= 1 and pg.locator("#app .lk-ask > .lk-src").count() == 0, "the source and the ledger names are under More")
        # earlier years folded
        E("() => { const x = LK.st(); x.from = '20250401'; x.to = '20261009'; LK.run('auto'); }"); W(1200)
        ok(pg.locator("#app [data-lk-early]").count() == 1 and "Show earlier years" in pg.inner_text("#app [data-lk-early]"), "entries before this year folded: 'Show earlier years'")
        pg.click("#app [data-lk-early] button"); W(500)
        ok(pg.locator("#app [data-lk-early]").count() == 0, "Show earlier years: they show")
        # the dates kept for the client
        E("() => { S.lk = null; }")
        ok(E("[LK.st().from, LK.st().to]") == ["20250401", "20261009"], "the dates last used are kept for the client")
        hide()

    except Exception as ex:
        ok(False, '3, 4. Look up' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 11. periods
    try:
        print("11. the period each page opens on")
        ok(E("Smart.tdsDue('20261009')") == {"fy": "2026-27", "q": "Q2", "due": "20261031"}, "TDS due on 09-Oct-2026: Q2 of 2026-27, due 31-Oct")
        ok(E("Smart.tdsDue('20260415')") == {"fy": "2025-26", "q": "Q4", "due": "20260531"} and E("TDS.formName('26Q', Smart.tdsDue('20260415').fy)") == "26Q", "in April 2026: Q4 of 2025-26, still on 26Q")
        ok(E("Smart.tdsDue('20270120')") == {"fy": "2026-27", "q": "Q3", "due": "20270131"} and E("TDS.formName('26Q', '2026-27')") == "Form 140", "in January 2027: Q3 of 2026-27, on Form 140")
        E("(c) => { ['tds', 'gst', 'mis', 'reports'].forEach(k => lsDel(Smart.pkey(k, c))); S.tdsFy = ''; S.tdsView = ''; S.tdsQ = ''; goClient('books:tds'); }", cid); W(1200)
        E("() => { S.books = window.__bk; render(); }"); W(600)
        ok(E("[S.tdsFy, S.tdsQ, S.tdsView]") == ["2026-27", "Q2", "year"] and E("location.hash").endswith("/books/tds/2026-27/Q2"), "TDS opens on Q2 of 2026-27 (%s)" % E("location.hash"))
        nr = pg.locator("#app [data-not-read]")
        ok(nr.count() == 1 and "TDS Q2 (Jul–Sep) 2026-27 not read yet" in nr.inner_text() and "Books in FinCom end 31-Mar-2026" in nr.inner_text(), "and says it is not read yet (%s)" % (nr.inner_text().replace("\n", " ") if nr.count() else ""))
        pg.click("#app [data-not-read-show]"); W(600)
        ok(E("S.tdsFy") == "2025-26" and pg.locator("#app [data-not-read]").count() == 0, "Show 2025-26 opens that year")
        E("() => { S.gstYm = ''; S.gstView = ''; S.gstPart = ''; goClient('books:gst'); }"); W(800)
        E("() => { S.books = window.__bk; render(); }"); W(600)
        ok(E("S.gstYm") == "202609" and pg.locator("#app [data-not-read]").count() == 1 and "Sep-2026" in pg.inner_text("#app [data-not-read]"), "GST opens on Sep-2026, due now, with the not-read line (%s)" % E("S.gstYm"))
        ok(E("(() => { const t = GSTSet.typeOf; GSTSet.typeOf = () => 'qrmp'; try { return [Smart.gstDue('09', '20261009'), Smart.gstDue('09', '20261115')]; } finally { GSTSet.typeOf = t; } })()") == ["202609", "202609"],
           "QRMP: the quarter just ended (Jul-Sep), on 09-Oct and on 15-Nov")
        pg.click("#app [data-not-read-show]"); W(600)
        ok(E("S.gstYm") == "202603", "Show Mar-2026 opens the last month read")
        E("(c) => { S.coId = null; return openCompany(c).then(() => goClient('books:gst')); }", cid); W(900)
        E("() => { S.books = window.__bk; render(); }"); W(500)
        ok(E("S.gstYm") == "202603", "the month chosen is kept for the client (%s)" % E("S.gstYm"))
        E("() => { S.misRange = null; goClient('books:mis'); }"); W(900)
        E("() => { S.books = window.__bk; render(); }"); W(500)
        ok(E("S.misRange") == {"from": "2026-04-01", "to": "2026-10-09"} and pg.locator("#app [data-not-read]").count() == 1, "MIS opens on this year to date, not read yet (%s)" % E("S.misRange"))
        E("() => { S.rptFy = ''; goClient('books:reports'); }"); W(900)
        E("() => { S.books = window.__bk; render(); }"); W(500)
        ok(E("RPT.range().fy") == "2026" and E("RPT.range().notRead") is True and pg.locator("#app [data-not-read]").count() == 1, "Reports opens on 2026-27, not read yet")
        ok(E("(() => { const s = document.querySelector('#app select[aria-label=Year]'); return s ? s.value : ''; })()") == "2026", "its year box shows 2026-27")
        E("() => { S.ltr = null; }")
        ok(E("[LTR.st().asOn, LTR.st().remOn]") == ["20260331", "20261009"], "Letters: confirmations as on 31-Mar-2026 (kept), reminders today")

    except Exception as ex:
        ok(False, '11. periods' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- 7. where you left off
    try:
        print("7. where you left off")
        E("() => goClient('books:lookup')"); W(600)
        last = E("location.hash")
        ok(E("(c) => lsGet(Smart.lastKey(c))", cid) == last, "the page shown is kept for the client (%s)" % last)
        pg.goto("http://localhost:8463/"); W(2500)
        ok(E("location.hash") == last, "opening FinCom again: that page (%s)" % E("location.hash"))
        E("() => Smart.set('resume', false)")
        pg.goto("http://localhost:8463/"); W(2500)
        ok(E("location.hash").endswith("/dash"), "switch off: the client's dashboard, as before (%s)" % E("location.hash"))
        E("() => Smart.set('resume', true)")
        E("() => goClient('books:lookup')"); W(600)
        E("() => { S.view = 'home'; S.homeTab = 'clients'; S.coId = null; render(); }"); W(500)
        E("() => Smart.afterSignIn(Smart.here())"); W(900)
        ok(E("location.hash") == last and toast_words() == "Back where you left off" and "Clients" in toast_acts(), "after signing in: back where you left off, with Clients (%r %r)" % (toast_words(), toast_acts()))
        pg.click('#toast [data-toast-act="Clients"]'); W(500)
        ok(E("location.hash") == "#/clients", "Clients: the clients' list")

    except Exception as ex:
        ok(False, '7. where you left off' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    # ---------------------------------------------------------------- reduced motion, unsaved changes
    try:
        print("reduced motion; unsaved changes")
        pg.emulate_media(reduced_motion="reduce")
        E("() => toast('Still')"); W(50)
        ok(E("(() => { const c = getComputedStyle(document.getElementById('toast')); return c.animationName === 'none' || parseFloat(c.animationDuration) < 0.001; })()"), "prefers-reduced-motion: the toast does not move")
        E("() => { Drafts.anyDirty = () => true; }")
        ok(E("Smart.go('#/today', 'x', {kind: 'upload'})") is False and E("location.hash") == "#/clients", "a change unsaved: no move")

    except Exception as ex:
        ok(False, 'reduced motion, unsaved changes' + ": stopped: " + str(ex).split("\n")[0][:200])
        hide_safe()
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("all passed" if not fails else "%d FAILED" % len(fails))
raise SystemExit(1 if fails else 0)
