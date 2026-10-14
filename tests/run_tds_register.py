"""python3 run_tds_register.py - one challan register per client TAN (branch tds-layout; the owner's rules approved 13/14-Oct-2026,
manual entry and the simplified register of 14-Oct-2026). On made-up books of Q1 of tax year 2026-27 (the same as
run_tds_challans.py: 194C, 194J and 192 deductions, two Tally TDS payment vouchers). Checks, through the page's own functions
(TDSReg, src/js/79; TDSCH, src/js/65) and its screens:
  A. the rules: overbooking refused ("₹X left on this challan"); a 92B challan used in 26Q allowed with the note "challan
     nature 92B used in 26Q"; an earlier year's balance allowed with "challan of FY 2025-26 used in FY 2026-27", kept in the
     trail; interest and fee kept apart, each with its own limit, and the FVU file's challan record carries the portion; a
     return marked filed locked (tag, untag, auto-allocation refused) until a correction is opened; auto-allocation keeps
     Tally's tags, then the same form and year oldest first, the rest only suggested; TRACES' consolidated file and
     challan status file compared with FinCom's used amount, a difference flagged, a hand challan TRACES does not know too.
  B. a challan entered by hand: every check (TAN, BSR code, date not after today, serial, minor head, nature, year,
     amounts, mode); the duplicate against Tally's challan (link offered, no second copy); "Entered by hand" with who and
     when; editing and deleting locked (Tally's never, filed use, allocations, a reason); its allocation and its CD line.
  C. the simplified register: one challan split across 24Q and 26Q never over its amount, the balance after each add and
     remove, a filed use locked, a manual and a Tally challan the same; a new challan placed in its own draft return by
     itself (balance to 0), an unknown type not placed and asked in To fix; Add to another return capped at the balance;
     the row's two figures with the split on hover; a filed return untouched.
Runs on the React build: app/dist-test, or TDSDESK_SITE. REGISTER_SHOTS=dir: screenshots too."""
import os, sys, re, json, threading, functools, http.server, tempfile
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_REGISTER_PORT") or 8277)
SHOTS = os.environ.get("REGISTER_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
GO = "() => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; render(); }"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = tempfile.mkdtemp(prefix="tdsreg-")

# a challan put straight into the books (no autoPlace mark: as one already there before this build)
ADD = """([id, bsr, date, serial, tax, section, extra]) => { const c = Object.assign({id, bsr, date, serial, tax, interest: 0, section, minorHead: "200"}, extra || {});
  S.books.challans = (S.books.challans || []).concat([c]); return c.id; }"""
ROWS = "(([sec, ym]) => TDS.allRows().concat(TDS.salaryRows()).filter(r => TDS.sec(r.section) === sec && TDS.ymd(r.date).slice(0, 6) === ym).map(r => r.id))"
RESET = "() => { S.books.alloc = {}; S.books.allocFrom = {}; S.books.challans = []; S.books.chPortions = {}; S.books.tdsCorr = {}; S.books.tdsFiled = {}; S.books.allocLog = []; S.books.tracesConso = []; S.books.tracesChStatus = []; render(); }"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e))); cons = []; pg.on("console", lambda m: cons.append(m.text[:400]) if m.type == "error" else None)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(BOOKS_JS); pg.wait_for_timeout(1000); pg.evaluate(GO); pg.wait_for_timeout(600)
        J = lambda expr, arg=None: pg.evaluate(expr, arg)
        rows = lambda sec, ym: J(ROWS, [sec, ym])
        sum_ = lambda ids: J("(ids) => r2(ids.reduce((a, id) => a + TDSReg.byRow()[id].r.tds, 0))", ids)
        J(RESET)

        # ---------------- A. the rules
        J(ADD, ["chA", "0240020", "20260507", "00101", 8640, "194C"])
        apr194c = rows("194C", "202604"); ok(len(apr194c) == 8 and sum_(apr194c) == 8640, "A0. April's 194C deductions: 8, ₹8,640")
        may194c = rows("194C", "202605")
        r = J("([a, b]) => TDSCH.tag(a.concat(b.slice(0, 1)), 'chA')", [apr194c, may194c])
        ok(not r["ok"] and re.search(r"₹8,640(\.00)? left on this challan", r["why"]), "A1. overbooking refused in the owner's words: %s" % r.get("why"))
        ok(J("() => TDS.challanUse().chA || 0") == 0, "A1. nothing tagged by the refused call")
        r = J("(a) => TDSCH.tag(a, 'chA')", apr194c); ok(r["ok"] and r["n"] == 8, "A1. exactly the challan's amount is allowed")
        r = J("(b) => TDSCH.tag(b.slice(0, 1), 'chA')", may194c); ok(not r["ok"] and re.search(r"₹0(\.00)? left on this challan", r["why"]), "A1. a full challan takes nothing more (%s)" % r.get("why"))
        # cross-form: a 92B (salary) challan pays 26Q deductions, with a neutral note
        J(ADD, ["chS", "0240020", "20260607", "00102", 9000, "192"])
        r = J("(b) => TDSCH.tag(b, 'chS')", may194c); ok(r["ok"] and r["n"] == 8, "A2. a salary (92B) challan used against 26Q deductions: allowed")
        notes = J("() => TDSReg.notes(TDS.challans().find(c => c.id === 'chS'), '26Q', '2026-27', 'Q1')")
        ok("challan nature 92B used in 26Q" in notes, "A2. the note says so: %s" % notes)
        J("() => { S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(400)
        ok(pg.locator('[data-ret-alloc] [data-note="challan nature 92B used in 26Q"]').count() == 1, "A2. the note shows on the return's Challans tab")
        ok(J("() => TDSReg.trail('chS').some(t => t.act === 'tag' && /92B used in 26Q/.test(t.note))"), "A2. the trail keeps the note")
        # earlier year's balance
        J(ADD, ["chOld", "0240020", "20260305", "00103", 5000, "194J"])
        may194j = J("() => TDS.rows().filter(r => TDS.sec(r.section) === '194J' && TDS.ymd(r.date) >= '20260525').map(r => r.id)")
        r = J("(ids) => TDSCH.tag(ids, 'chOld')", may194j); ok(r["ok"], "A3. a challan of FY 2025-26 used in 2026-27: allowed")
        notes = J("() => TDSReg.notes(TDS.challans().find(c => c.id === 'chOld'), '26Q', '2026-27', 'Q1')")
        ok("challan of FY 2025-26 used in FY 2026-27" in notes, "A3. the note: %s" % notes)
        ok(J("() => TDSReg.trail('chOld').some(t => /FY 2025-26 used in FY 2026-27/.test(t.note))"), "A3. kept in the audit trail")
        txt = J("() => TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q').text || ''")
        ok("^0240020^05032026^00103^" in txt, "A3. the earlier year's challan is in the Q1 file with its deductions (a CD record)")
        # interest and fee apart
        J("() => { const c = TDS.challans().find(c => c.id === 'chA'); c.interest = 150; c.fee = 400; }")
        ok("^150.00^400.00^" in J("() => TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q').text"), "A4. no portion set: the file carries the challan's whole interest and fee, as before")
        r = J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 200, 0)"); ok(not r["ok"] and re.search(r"₹150(\.00)? left on this challan for interest", r["why"]), "A4. interest over its own limit refused: %s" % r.get("why"))
        r = J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 100, 500)"); ok(not r["ok"] and "for the fee" in r["why"], "A4. fee over its own limit refused")
        r = J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 100, 400)"); ok(r["ok"], "A4. within each limit: given")
        ok("^100.00^400.00^" in J("() => TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q').text"), "A4. the file's challan record carries the portion (interest 100, fee 400)")
        r = J("() => TDSReg.setPortion('chA', '27Q', '2026-27', 'Q1', 60, 0)"); ok(not r["ok"] and re.search(r"₹50(\.00)? left on this challan for interest", r["why"]), "A4. another return gets only what is left (%s)" % r.get("why"))
        ok(J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'chA'))") == {"tax": 0, "interest": 50, "fee": 0, "total": 50}, "A4. the balance by head: tax 0, interest 50, fee 0")
        # filed: locked
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; }")
        r = J("(b) => TDSCH.untag(b.slice(0, 1))", may194c); ok(not r["ok"] and "locked" in r["why"], "A5. untag on a filed return refused: %s" % r.get("why"))
        jun = rows("194C", "202606")
        J(ADD, ["chJ", "0240020", "20260707", "00104", 1000, "194C"])
        r = J("(j) => TDSCH.tag(j, 'chJ')", jun); ok(not r["ok"] and "Open a correction" in r["why"], "A5. tag on a filed return refused")
        ok(not J("() => TDSReg.autoAllocate('2026-27', 'Q1', '26Q').ok"), "A5. auto-allocation refused on a filed return")
        ok(not J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 0, 0).ok"), "A5. the interest and fee portion locked too")
        J("() => { S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator('[data-ret-lock="locked"]').count() == 1, "A5. the return's Challans tab says it is locked")
        pg.click('[data-open-correction]'); pg.wait_for_timeout(300)
        ok(pg.locator('#confirmBox [data-cbx="yes"]').count() == 1, "A5. opening a correction asks first")
        pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
        r = J("(j) => TDSCH.tag(j, 'chJ')", jun); ok(r["ok"], "A5. once a correction is opened, it changes")
        ok(J("() => TDSReg.trail().some(t => t.act === 'correction')"), "A5. the correction is in the trail")
        J("() => { TDSReg.closeCorrection('2026-27', 'Q1', '26Q'); }")
        ok(not J("(j) => TDSCH.untag(j).ok", jun), "A5. closed again: locked")
        J("() => { S.books.tdsFiled = {}; }")
        # auto-allocation: Tally's tags first
        J(RESET)
        J(ADD, ["chT", "0240020", "20260515", "00201", 3000, "194C", {"madeBy": "tally-sync", "from": "tally"}])
        J(ADD, ["chOld1", "0240020", "20260505", "00202", 20000, "194C"])
        J(ADD, ["chNew1", "0240020", "20260605", "00203", 20000, "194C"])
        J(ADD, ["chSal", "0240020", "20260505", "00204", 50000, "192"])
        first = may194c[0]
        J("(id) => { S.books.alloc[id] = 'chT'; S.books.allocFrom = {[id]: 'tally'}; }", first)
        r = J("() => TDSReg.autoAllocate('2026-27', 'Q1', '26Q')")
        ok(r["ok"] and J("(id) => S.books.alloc[id]", first) == "chT", "A6. Tally's own tag kept (not moved)")
        ok(J("(ids) => ids.every(id => S.books.alloc[id] === 'chOld1')", may194c[1:]), "A6. then the same form and year, the oldest challan with room (deposited in or after the deductions' month) first")
        ok(J("() => !Object.values(S.books.alloc).includes('chSal')"), "A6. another form's challan never used by itself")
        s = J("() => TDSReg.suggestions('2026-27', 'Q1', '26Q').map(x => ({ch: x.challan.id, notes: x.notes}))")
        ok(any(x["ch"] == "chSal" and "challan nature 92B used in 26Q" in x["notes"] for x in s), "A6. the salary challan's balance only suggested, with its note (%s)" % s)
        # TRACES: consolidated file and challan status file
        J(RESET)
        J(ADD, ["chA", "0240020", "20260507", "00101", 8640, "194C"]); J("(a) => TDSCH.tag(a, 'chA')", apr194c)
        conso = J("() => TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q').text").replace("^8640.00^0.00^0.00^0.00^0.00^0.00", "^8000.00^0.00^0.00^0.00^0.00^0.00")
        cpath = os.path.join(tmp, "DELZ12345A_26Q_Q1_202627_conso.txt"); open(cpath, "w").write(conso)
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; S.tdsTab = 'after'; render(); }"); pg.wait_for_timeout(300)
        pg.set_input_files('[data-after-filing] input[type=file]', cpath); pg.wait_for_timeout(1200)
        d = J("() => TDSReg.traces({form: '26Q', fy: '2026-27', q: 'Q1'}).filter(x => x.src === 'conso')")
        ok(len(d) == 1 and d[0]["fincom"] == 8640 and d[0]["traces"] == 8000 and d[0]["diff"] == 640, "A7. the consolidated file: TRACES consumed 8,000 against FinCom's 8,640: flagged (%s)" % d)
        ok(pg.locator('[data-after-filing] [data-traces-row][data-diff="1"]').count() == 1, "A7. the difference shows on After filing")
        J("() => { S.books.tdsFiled = {}; render(); }"); pg.wait_for_timeout(200)
        ok(pg.locator('[data-after-wait]').count() == 1, "A7. a return not marked filed: After filing says it is available once marked filed")
        spath = os.path.join(tmp, "challan-status.csv")
        open(spath, "w").write("BSR Code,Date of Deposit,Challan Serial No,Deposited Amount,Consumed Amount,Available Amount\n0240020,07-May-2026,00101,8640.00,8640.00,0.00\n")
        J("() => { S.tdsView = 'register'; render(); }"); pg.wait_for_timeout(300)
        r = J("async (t) => { const f = new File([t], 'challan-status.csv', {type: 'text/csv'}); return await TRF.add([f]); }", open(spath).read())
        st = J("() => TDSReg.traces().filter(x => x.src === 'status')")
        ok(len(st) == 1 and st[0]["diff"] == 0, "A7. the challan status file read: 8,640 consumed, the same as FinCom (%s; %s)" % (st, r))

        # ---------------- B. a challan entered by hand
        J(RESET)
        good = {"tan": "DELZ12345A", "bsr": "0240020", "date": "2026-05-07", "serial": "00301", "minorHead": "200", "section": "94C", "year": "2026-27", "yearKind": "FY",
                "tax": "8640", "surcharge": "", "cess": "", "interest": "", "fee": "", "others": "", "mode": "online", "note": ""}
        bad = [("tan", "DELZ1234A", "TAN"), ("tan", "MUMZ12345A", "This client's TAN"), ("bsr", "024002", "7 digits"), ("date", "2099-01-01", "after today"),
               ("date", "2026-02-30", "date of deposit"), ("serial", "979", "5 digits"), ("minorHead", "300", "200"), ("section", "99Z", "nature of payment"),
               ("tax", "-5", "Not below nil"), ("tax", "abc", "amount"), ("mode", "cash", "Online")]
        for k, v, words in bad:
            e = J("(x) => TDSReg.check(x).errors", dict(good, **{k: v}))
            ok(k in e and words.lower() in e[k].lower(), "B1. %s %r refused: %s" % (k, v, e.get(k)))
        e = J("(x) => TDSReg.check(x).errors", dict(good, tax=""))
        ok("tax" in e, "B1. all amounts nil refused (%s)" % e.get("tax"))
        ok(J("(x) => TDSReg.check(x).ok", good), "B1. a correct challan passes every check")
        ok(J("(x) => TDSReg.check(x).c.tax", dict(good, tax="8000", surcharge="400", cess="240")) == 8640, "B1. tax + surcharge + cess make the challan's tax")
        # the form on screen
        pg.click('[data-reg-add]'); pg.wait_for_timeout(300)
        f = '[data-add-challan="new"] '
        pg.fill(f + 'input[aria-label="BSR code"]', "0240020"); pg.fill(f + 'input[aria-label="Date of deposit"]', "2026-05-07"); pg.fill(f + 'input[aria-label="Challan serial number"]', "301")
        pg.fill(f + 'input[aria-label="Nature of payment"]', "94C"); pg.fill(f + 'input[aria-label="Tax"]', "8,000")
        ok(pg.locator(f + '.ach-grid').first.locator('input').count() == 5, "B1. five fields first: BSR, date, serial, nature, tax")
        pg.click(f + '.ach-more > summary'); pg.wait_for_timeout(150); pg.fill(f + 'input[aria-label="Cess"]', "640")
        ok(pg.locator(f + '[data-ach-total]').inner_text().strip() in ("₹8,640", "₹8,640.00"), "B1. the total worked out as typed (%s)" % pg.locator(f + '[data-ach-total]').inner_text())
        ok("2026-27" in pg.locator(f + 'p.note').first.inner_text(), "B1. the year is the date's (%s)" % pg.locator(f + 'p.note').first.inner_text())
        pg.locator(f + 'input[aria-label="BSR code"]').focus(); pg.keyboard.type("1"); pg.keyboard.press("Backspace")
        ok(pg.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')") == "BSR code", "B1. typing keeps the focus in the field (it is not drawn anew)")
        pg.fill(f + 'input[aria-label="BSR code"]', "0240020")
        pg.click(f + '[data-ach-save]'); pg.wait_for_timeout(400)
        ok(pg.locator(f + '[data-ach-err="serial"]').count() == 1, "B1. the screen says what is wrong: the serial")
        pg.fill(f + 'input[aria-label="Challan serial number"]', "00301"); pg.set_input_files(f + '[data-ach-file]', {"name": "receipt-00301.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 receipt"})
        pg.click(f + '[data-ach-save]'); pg.wait_for_timeout(800)
        c = J("() => TDS.challans().find(c => c.serial === '00301')")
        if not c: print("    the form says:", pg.locator('[data-ach-err]').all_inner_texts(), "| toast:", pg.evaluate("document.getElementById('toast').textContent"))
        ok(c and c["from"] == "hand" and c["enteredAt"] and c["tax"] == 8640 and c["mode"] == "online" and c.get("receipt", {}).get("name") == "receipt-00301.pdf", "B2. added: entered by hand, when, its receipt kept (%s)" % ({k: (c or {}).get(k) for k in ["from", "enteredAt", "tax", "receipt"]}))
        ok(J("() => TDSReg.srcWords(TDS.challans().find(c => c.serial === '00301'))") == "Entered by hand", "B2. marked \"Entered by hand\"")
        ok(J("() => TDSReg.trail().some(t => t.act === 'challan-add')"), "B2. who and when in the trail")
        e = J("(x) => TDSReg.check(x).errors", dict(good, serial="00301"))
        ok("dup" in e and "already in the register" in e["dup"], "B3. the same BSR, date and serial cannot be added twice")
        # the duplicate of Tally's challan: link, no second copy
        J(ADD, ["chTally", "0240020", "20260605", "00302", 1200, "194J", {"madeBy": "tally-sync", "from": "tally", "fromVoucher": "pay194jMay"}])
        r = J("async (x) => { const r = await TDSReg.addHand(x); return {ok: r.ok, dup: r.dupTally && r.dupTally.id, why: r.why}; }", dict(good, date="2026-06-05", serial="00302", section="94J", tax="1200"))
        ok(not r["ok"] and r["dup"] == "chTally" and "read from Tally already" in r["why"], "B3. a Tally challan typed again: found, a link offered (%s)" % r)
        n0 = J("() => TDS.challans().length")
        r = J("async () => TDSReg.linkToTally('chTally', {note: 'paid by Ravi'}).then(r => r.ok)")
        ok(r and J("() => TDS.challans().length") == n0 and J("() => TDS.challans().find(c => c.id === 'chTally').note") == "paid by Ravi", "B3. linked: the note on Tally's challan, no second copy")
        # edit and delete locks
        ok("change it in Tally" in J("() => TDSReg.canEdit(TDS.challans().find(c => c.id === 'chTally'))"), "B4. a Tally challan cannot be edited in FinCom")
        ok(not J("() => TDSReg.deleteHand('chTally', 'wrong').ok"), "B4. nor deleted")
        hid = c["id"]
        r = J("async ([id, x]) => (await TDSReg.editHand(id, x)).ok", [hid, dict(good, serial="00301", tax="8640", note="corrected")])
        ok(r, "B4. a hand challan nothing filed uses: edited")
        J("([id, a]) => TDSCH.tag(a, id)", [hid, apr194c])
        ok(not J("([id]) => TDSReg.deleteHand(id, 'typed twice').ok", [hid]), "B4. delete refused while deductions are allocated")
        r = J("async ([id, x]) => (await TDSReg.editHand(id, x)).why", [hid, dict(good, serial="00301", tax="8000")])
        ok(r and "cannot be less" in r, "B4. its tax cannot go below what is used: %s" % r)
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; }")
        ok("filed return uses this challan" in J("([id]) => TDSReg.canEdit(TDS.challans().find(c => c.id === id))", [hid]), "B4. not editable once a filed return uses it")
        txt = J("() => TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q').text")
        cd = [l for l in txt.split("\r\n") if "^CD^" in l]
        ok(any("^0240020^07052026^00301^" in l and "^8640.00^" in l for l in cd), "B5. the hand challan's CD line in the FVU file: BSR, date, serial, tax (%s)" % cd)
        J("() => { S.books.tdsFiled = {}; }")
        J("([id, a]) => TDSCH.untag(a)", [hid, apr194c])
        ok(not J("([id]) => TDSReg.deleteHand(id, '').ok", [hid]), "B4. delete needs a reason")
        ok(J("([id]) => TDSReg.deleteHand(id, 'typed twice').ok", [hid]) and not J("([id]) => TDS.challans().some(c => c.id === id)", [hid]) and J("() => TDSReg.deletedList().length") == 1,
           "B4. deleted softly: out of every list, kept with its reason under Deleted challans")

        # ---------------- C. the simplified register
        J(RESET)
        sal_apr = rows("192", "202604")         # 26,520
        J(ADD, ["chSplit", "0240020", "20260507", "00401", 30000, "192"])
        r = J("() => TDSReg.useBalance('chSplit', '24Q', '2026-27', 'Q1', 26520)"); ok(r["ok"] and r["tax"] == 26520, "C1. 24Q uses 26,520 of the 30,000 challan")
        ok(J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'chSplit')).tax") == 3480, "C1. balance 3,480 at once")
        r = J("() => TDSReg.useBalance('chSplit', '26Q', '2026-27', 'Q1', 3500)"); ok(not r["ok"] and re.search(r"₹3,480(\.00)? left on this challan", r["why"]), "C1. 26Q refused past the balance: %s" % r.get("why"))
        r = J("() => TDSReg.useBalance('chSplit', '26Q', '2026-27', 'Q1', 3480)"); ok(r["ok"] and r["tax"] <= 3480, "C1. 26Q uses what fits (%s)" % r.get("tax"))
        u = J("() => TDSReg.usedTax(TDS.challans().find(c => c.id === 'chSplit'))"); ok(u <= 30000, "C1. never over the challan's amount (%s used)" % u)
        r = J("() => TDSReg.removeUse('chSplit', '26Q', '2026-27', 'Q1')"); ok(r["ok"] and J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'chSplit')).tax") == 3480, "C2. taken off 26Q: the balance back to 3,480")
        J("() => { S.books.tdsFiled = {'2026-27|Q1|24Q': {on: '2026-07-20', token: ''}}; }")
        r = J("() => TDSReg.removeUse('chSplit', '24Q', '2026-27', 'Q1')"); ok(not r["ok"] and "locked" in r["why"], "C3. a filed use cannot be taken off")
        J("() => { S.books.tdsFiled = {}; }")
        # manual and Tally the same
        res = {}
        for kind, extra in (("hand", {"from": "hand", "madeBy": "hand"}), ("tally", {"from": "tally", "madeBy": "tally-sync"})):
            J(RESET); J(ADD, ["ch" + kind, "0240020", "20260507", "00501", 1000, "194C", extra])
            a = J("(k) => TDSReg.useBalance('ch' + k, '26Q', '2026-27', 'Q1', 1200).why", kind)
            b = J("(k) => TDSReg.useBalance('ch' + k, '26Q', '2026-27', 'Q1', 1000).tax", kind)
            res[kind] = (a, b)
        ok(res["hand"] == res["tally"] and re.search(r"₹1,000(\.00)? left on this challan", res["hand"][0]), "C4. a hand challan and a Tally challan follow the same rule (%s)" % res)
        # a new challan placed by itself
        J(RESET)
        r = J("async (x) => { const r = await TDSReg.addHand(x); return r.placed; }", dict(good, serial="00601", tax="8640", date="2026-05-07", section="94C"))
        ok(r and r.get("placed") and r["form"] == "26Q" and r["q"] == "Q1", "C5. a new 94C challan of 07-May placed in 26Q Q1 by itself (%s)" % r)
        ok(J("() => TDSReg.balance(TDS.challans().find(c => c.serial === '00601')).tax") == 0, "C5. its balance drops to 0")
        r = J("async (x) => { const r = await TDSReg.addHand(x); return r.placed; }", dict(good, serial="00602", tax="26520", date="2026-05-07", section="92B"))
        ok(r and r.get("placed") and r["form"] == "24Q", "C5. a 92B challan placed in 24Q (%s)" % r)
        r = J("async () => { const n = TDSCH.add([{bsr: '0240020', serial: '00603', date: '20260507', tax: 500, interest: 0, section: '', minorHead: '200'}]); return n; }")
        ok(J("() => TDS.challans().find(c => c.serial === '00603').autoPlace") == "unknown" and J("() => TDSReg.usedTax(TDS.challans().find(c => c.serial === '00603'))") == 0, "C6. a challan of unknown type is not placed")
        J("() => { S.tdsView = 'return'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'checks'; S.tdsFix = ''; render(); }"); pg.wait_for_timeout(400)
        ok(pg.locator('[data-fix="chtype"]').count() == 1 and "which return" in pg.locator('[data-fix="chtype"]').inner_text(), "C6. To fix asks which return, in one line")
        pg.click('[data-fix="chtype"]'); pg.wait_for_timeout(300)
        ok(pg.locator('[data-unknown-ch]').count() == 1, "C6. it opens the challan, with Use in this return")
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; }")
        before = J("() => JSON.stringify(S.books.alloc)")
        r = J("async (x) => { const r = await TDSReg.addHand(x); return r.placed; }", dict(good, serial="00604", tax="8000", date="2026-06-01", section="94C"))
        ok(not (r or {}).get("placed") and J("() => JSON.stringify(S.books.alloc)") == before, "C7. a filed return is never changed by a new challan (%s)" % r)
        J("() => { S.books.tdsFiled = {}; }")
        # the register's row: two figures, the split on hover; Add to another return capped
        J("() => { S.tdsView = 'register'; S.regFl = {}; render(); }"); pg.wait_for_timeout(400)
        ch = J("() => TDS.challans().find(c => c.serial === '00602').id")
        heads = [h.strip().lower() for h in pg.locator('#tdsRegTable thead th').all_inner_texts()]
        ok("total challan" in heads and "balance left" in heads and not any(h in heads for h in ("used in", "paid for", "home form", "used")), "C8. two figures a row, no Used-in or Paid-for columns (%s)" % heads)
        ok(pg.locator('[data-reg-filter]').count() == 1 and pg.locator('[data-reg-filter="needs"]').count() == 1, "C8. one filter: Needs a return")
        # the coordinator's screenshot review (14-Oct-2026): the head row on one line, the filter beside each heading (the shared
        # table, with the column filters a table of 4 rows or more gets), the amounts right-aligned under their headings; the
        # source in small grey words on the BSR/serial's line ("Type unknown" stays a badge)
        J("""() => { for (let i = 0; i < 4; i++) S.books.challans.push({id: 'chRow' + i, bsr: '0240020', date: '2026050' + (i + 1), serial: '0090' + i, tax: 100 + i, interest: 0, section: '194C', minorHead: '200', from: 'hand'}); render(); }"""); pg.wait_for_timeout(600)
        hd = J("""() => { const t = document.getElementById('tdsRegTable'), ths = [...t.tHead.rows[t.tHead.rows.length - 1].cells], row = t.tBodies[0].rows[0];
          return {funnels: t.querySelectorAll('.gff').length, ths: ths.map((th, i) => { const r = th.getBoundingClientRect(), kids = [...th.querySelectorAll('.gfl, .gff')].map(e => e.getBoundingClientRect());
            const lab = th.querySelector('.gfl'), lr = lab ? lab.getBoundingClientRect() : null, td = row.cells[i], last = td && td.lastElementChild ? td.lastElementChild.getBoundingClientRect() : null;
            return {label: (lab ? lab.textContent : th.textContent).trim(), h: Math.round(r.height), oneLine: kids.length < 2 || Math.max(...kids.map(k => k.top)) - Math.min(...kids.map(k => k.top)) < 6,
              n: th.classList.contains('n'), right: lr && last ? Math.round(lr.right - last.right) : null}; })}; }""")
        ok(hd["funnels"] >= 4 and all(h["oneLine"] and h["h"] <= 48 for h in hd["ths"]), "C8. the head row on one line, each filter beside its heading (%s)" % [(h["label"], h["h"], h["oneLine"]) for h in hd["ths"]])
        ok(all(abs(h["right"]) <= 6 for h in hd["ths"] if h["n"] and h["right"] is not None) and sum(1 for h in hd["ths"] if h["n"]) >= 2, "C8. Total challan and Balance left: the amounts right-aligned under their headings (%s)" % [(h["label"], h["right"]) for h in hd["ths"] if h["n"]])
        src = J("""() => { const td = document.querySelector('#tdsRegTable tr[data-reg-row="chRow0"] td:nth-child(2)'), b = td.querySelector('button'), s = td.querySelector('[data-ch-src]');
          return s && {text: s.textContent, tag: s.classList.contains('tag'), dy: Math.abs(s.getBoundingClientRect().top - b.getBoundingClientRect().top), size: parseFloat(getComputedStyle(s).fontSize), grey: getComputedStyle(s).color !== getComputedStyle(b).color}; }""")
        ok(src and src["text"] == "Entered by hand" and not src["tag"] and src["dy"] < 6 and src["size"] <= 12.5 and src["grey"], "C8. the source in small grey words on the BSR/serial's line (%s)" % src)
        J("() => { S.books.challans = S.books.challans.filter(c => !/^chRow/.test(c.id)); render(); }"); pg.wait_for_timeout(300)
        tot = pg.locator('[data-split="total"][data-split-of="%s"]' % ch)
        ok("Tax ₹26,520" in (tot.get_attribute("title") or "") and "Interest" in tot.get_attribute("title"), "C9. hovering the total shows the split: %s" % tot.get_attribute("title"))
        tot.click(); pg.wait_for_timeout(200)
        ok(pg.locator('[data-split-open="total"]').count() == 1, "C9. tapping it shows the split too (phone)")
        left = pg.locator('[data-split="left"][data-split-of="%s"]' % ch)
        ok("Tax ₹0" in (left.get_attribute("title") or ""), "C9. the balance's split by head: %s" % left.get_attribute("title"))
        J("() => { S.books.challans.push({id: 'chFree', bsr: '0240020', date: '20260508', serial: '00701', tax: 2000, interest: 0, section: '194C', minorHead: '200'}); render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator('[data-reg-addto="chFree"]').inner_text().strip() == "Use…", "C10. one button on the row: Use…")
        pg.click('[data-reg-addto="chFree"]'); pg.wait_for_timeout(300)
        box = '[data-use-balance="chFree"] '
        ok(pg.locator(box + 'select[aria-label="Return"] option').first.inner_text().startswith("26Q Q1"), "C10. its own return first (%s)" % pg.locator(box + 'select[aria-label="Return"] option').first.inner_text())
        ok(float(pg.input_value(box + 'input[aria-label="Tax to use"]') or 0) <= 2000, "C10. filled in with no more than the balance (%s)" % pg.input_value(box + 'input[aria-label="Tax to use"]'))
        pg.select_option(box + 'select[aria-label="Return"]', "26Q|2026-27|Q1"); pg.fill(box + 'input[aria-label="Tax to use"]', "2500"); pg.click(box + '[data-use-go]'); pg.wait_for_timeout(500)
        ok(re.search(r"₹2,000(\.00)? left on this challan", pg.locator(box + '[data-use-err]').inner_text()), "C10. over the balance refused on screen")
        # the split closes on Escape; the deleted list and Restore
        tot.click(); pg.wait_for_timeout(150); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        ok(pg.locator('[data-split-open]').count() == 0 and pg.locator('[data-register]').count() == 1, "C9. the split closes on Escape, and the page stays")
        J("() => { S.books.challans.push({id: 'chDel', bsr: '0240020', date: '20260509', serial: '00801', tax: 50, interest: 0, section: '194C', minorHead: '200', from: 'hand'}); TDSReg.deleteHand('chDel', 'typed twice'); render(); }"); pg.wait_for_timeout(300)
        pg.click('[data-reg-deleted]'); pg.wait_for_timeout(200); pg.click('[data-reg-restore="chDel"]'); pg.wait_for_timeout(300)
        ok(J("() => TDS.challans().some(c => c.id === 'chDel')"), "B4. a deleted challan comes back with Restore")
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "register.png"), full_page=True)
        ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
        br.close()
finally:
    srv.shutdown()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
