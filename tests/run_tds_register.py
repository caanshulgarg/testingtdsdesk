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
# next-challan-match: a file is made only when every deduction is on a challan; the rest of the quarter's deductions go on a
# stand-in challan for the build and come off again (what is checked is the challan under test)
BUILD = """() => { const fl = S.books.tdsFiled; S.books.tdsFiled = {};
  const ids = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && r.tds > 0).map(r => r.id);
  S.books.challans = (S.books.challans || []).concat([{id: 'chFill', bsr: '0240020', serial: '00999', date: '20260707', tax: 9999999, interest: 0, section: '', minorHead: '200'}]);
  if (ids.length) TDSCH.tag(ids, 'chFill');
  const f = TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q');
  if (ids.length) TDSCH.untag(ids);
  S.books.challans = S.books.challans.filter(c => c.id !== 'chFill'); S.books.tdsFiled = fl; return f.text || f.error || ''; }"""
RESET = "() => { S.books.alloc = {}; S.books.allocFrom = {}; S.books.challans = []; S.books.chPortions = {}; S.books.tdsCorr = {}; S.books.tdsFiled = {}; S.books.allocLog = []; S.books.tracesConso = []; S.books.tracesChStatus = []; render(); }"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e))); cons = []; pg.on("console", lambda m: cons.append(m.text[:400]) if m.type == "error" else None)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
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
        J("() => { S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(400)
        nt = pg.locator('[data-val-item^="i-nature"]')
        # next-tds-validate-short: a suggestion (under the folded Suggestions), in one short line
        ok(nt.count() == 1 and "challan nature 92B used in 26Q" in nt.text_content() and nt.get_attribute("data-val-level") == "info", "A2. the note shows on the return's Validate & file, a suggestion")
        ok(J("() => TDSReg.trail('chS').some(t => t.act === 'tag' && /92B used in 26Q/.test(t.note))"), "A2. the trail keeps the note")
        # earlier year's balance
        J(ADD, ["chOld", "0240020", "20260305", "00103", 5000, "194J"])
        may194j = J("() => TDS.rows().filter(r => TDS.sec(r.section) === '194J' && TDS.ymd(r.date) >= '20260525').map(r => r.id)")
        r = J("(ids) => TDSCH.tag(ids, 'chOld')", may194j); ok(r["ok"], "A3. a challan of FY 2025-26 used in 2026-27: allowed")
        notes = J("() => TDSReg.notes(TDS.challans().find(c => c.id === 'chOld'), '26Q', '2026-27', 'Q1')")
        ok("challan of FY 2025-26 used in FY 2026-27" in notes, "A3. the note: %s" % notes)
        ok(J("() => TDSReg.trail('chOld').some(t => /FY 2025-26 used in FY 2026-27/.test(t.note))"), "A3. kept in the audit trail")
        txt = J(BUILD)
        # next-tds-forms-2025: Form 140's challan record (Protean's file format 1.1): BSR field 15, serial 17, date 19
        cds = [l.split("^") for l in txt.split("\r\n") if "^CD^" in l]
        # next-tds-validate-short: Protean's FVU refuses a challan of the year before for these (T-FV-3076): the file leaves its
        # deductions out (said), so no CD record for it, never a refusal
        lo = J("() => TDS26Q.leftOut('26Q', '2026-27', 'Q1').filter(x => x.r.challan === 'chOld').map(x => x.k)")
        ok(txt and not any(c[16] == "00103" for c in cds) and lo and all(k == "early" for k in lo), "A3. the earlier year's challan's deductions left out of the Q1 file, said (%s)" % lo)
        # interest and fee apart
        J("() => { const c = TDS.challans().find(c => c.id === 'chA'); c.interest = 150; c.fee = 400; }")
        cd0 = [l.split("^") for l in J(BUILD).split("\r\n") if "^CD^" in l and "^00101^" in l]
        ok(cd0 and cd0[0][8] == "150.00" and cd0[0][9] == "400.00" and cd0[0][23] == "0.00", "A4. no portion set: the challan as deposited (interest 150, fee 400), nothing allocated (field 24 0.00): next-challan-match, interest is allocated explicitly")
        r = J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 200, 0)"); ok(not r["ok"] and re.search(r"₹150(\.00)? free on this challan for interest", r["why"]), "A4. interest over its own limit refused (its tax all used: none to move, next-tds-interest): %s" % r.get("why"))
        r = J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 100, 500)"); ok(not r["ok"] and re.search(r"₹0(\.00)? free on this challan for others", r["why"]), "A4. fee and others 500 over the 400 fee (no others, its tax all used): the 100 of others refused (next-tds-interest2: the fee first, then others) (%s)" % r.get("why"))
        r = J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 100, 400)"); ok(r["ok"], "A4. within each limit: given")
        # next-tds-forms-2025: Form 140 carries the challan as deposited (fields 9, 10) and the interest allocation "as
        # provided in field no. 9" (field 24), as Protean's file format 1.1 says; the portion stays in FinCom's register (a
        # question for the owner, docs/tds-forms-2025/GAPS.md)
        cdA = [l.split("^") for l in J(BUILD).split("\r\n") if "^CD^" in l]
        ok(any(c[8] == "150.00" and c[9] == "400.00" and c[23] == "100.00" for c in cdA), "A4. Form 140's challan record: the challan as deposited (interest 150, fee 400) and the interest allocated here, 100 (field 24)")
        r = J("() => TDSReg.setPortion('chA', '27Q', '2026-27', 'Q1', 60, 0)"); ok(not r["ok"] and re.search(r"₹50(\.00)? free on this challan for interest", r["why"]), "A4. another return gets only what is left (%s)" % r.get("why"))
        ok({k: v for k, v in J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'chA'))").items() if k in ("tax", "interest", "fee", "total")} == {"tax": 0, "interest": 50, "fee": 0, "total": 50}, "A4. the balance by head: tax 0, interest 50, fee 0")
        # filed: locked
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; }")
        r = J("(b) => TDSCH.untag(b.slice(0, 1))", may194c); ok(not r["ok"] and "locked" in r["why"], "A5. untag on a filed return refused: %s" % r.get("why"))
        jun = rows("194C", "202606")
        J(ADD, ["chJ", "0240020", "20260707", "00104", 1000, "194C"])
        r = J("(j) => TDSCH.tag(j, 'chJ')", jun); ok(not r["ok"] and "Open a correction" in r["why"], "A5. tag on a filed return refused")
        ok(J("() => TDSMatch.suggestNow('26Q', '2026-27', 'Q1').length") == 0 and J("() => TDSMatch.confirmAll('26Q', '2026-27', 'Q1').n") == 0, "A5. nothing suggested, nothing confirmed, on a filed return")
        ok(not J("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 0, 0).ok"), "A5. the interest and fee portion locked too")
        J("() => { S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator('[data-ret-lock="locked"]').count() == 1, "A5. the return's Challans tab says it is locked")
        pg.click('[data-return-card] details.more > summary'); pg.wait_for_timeout(200)   # next-tds-clear: in the header's ⋯
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
        # next-challan-match: the one matcher suggests (the Auto-allocate button is gone); Tally's own tag stays
        sg = J("() => TDSMatch.suggestNow('26Q', '2026-27', 'Q1').map(s => ({ch: s.chId, ids: s.ids, rule: s.rule}))")
        ok(J("(id) => S.books.alloc[id]", first) == "chT" and not any(first in x["ids"] for x in sg), "A6. Tally's own tag kept (not moved, not suggested again)")
        got = {i: x["ch"] for x in sg for i in x["ids"]}
        ok(all(got.get(i) in ("chT", "chNew1") for i in may194c[1:]), "A6. the rest of May's 194C suggested for challans deposited after them (Tally's chT with room, then chNew1 of 05-Jun), not chOld1 paid before them (%s)" % [got.get(i) for i in may194c[1:]])
        ok(all(got.get(i) == "chOld1" for i in apr194c), "A6. April's 194C to chOld1 of 05-May (%s)" % [got.get(i) for i in apr194c])
        ok(not any(x["ch"] == "chSal" for x in sg) and J("() => !Object.values(S.books.alloc).includes('chSal')"), "A6. another form's challan never suggested, never used by itself")
        # TRACES: consolidated file and challan status file
        J(RESET)
        J(ADD, ["chA", "0240020", "20260507", "00101", 8640, "194C"]); J("(a) => TDSCH.tag(a, 'chA')", apr194c)
        # TRACES' consolidated file, made from FinCom's own Form 140 with the challan's consumed amount (CD field 21) at 8,000
        conso = "\r\n".join("^".join(f[:20] + ["8000.00"] + f[21:]) if len(f) > 21 and f[1] == "CD" else "^".join(f) for f in (l.split("^") for l in J(BUILD).split("\r\n")) if not (len(f) > 16 and f[1] == "CD" and f[16] == "00999"))
        cpath = os.path.join(tmp, "DELZ12345A_26Q_Q1_202627_conso.txt"); open(cpath, "w").write(conso)
        J("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-07-20', token: ''}}; S.tdsTab = 'after'; render(); }"); pg.wait_for_timeout(300)
        pg.set_input_files('[data-after-filing] input[type=file]', cpath); pg.wait_for_timeout(1200)
        d = J("() => TDSReg.traces({form: '26Q', fy: '2026-27', q: 'Q1'}).filter(x => x.src === 'conso')")
        ok(len(d) == 1 and d[0]["fincom"] == 8640 and d[0]["traces"] == 8000 and d[0]["diff"] == 640, "A7. the consolidated file: TRACES consumed 8,000 against FinCom's 8,640: flagged (%s)" % d)
        pg.click('[data-after-open="chstatus"]'); pg.wait_for_timeout(400)   # next-tds-clear: one table of TRACES' files, each a drawer
        ok(pg.locator('[data-drawer="traces"] [data-traces-row][data-diff="1"]').count() == 1, "A7. the difference shows on After filing › Challan status")
        J("() => { document.querySelectorAll('[data-drawer] button[aria-label=Close]').forEach(b => b.click()); }"); pg.wait_for_timeout(300)
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
        txt = J(BUILD)
        cd = [l for l in txt.split("\r\n") if "^CD^" in l]
        ok(any(l.split("^")[14] == "0240020" and l.split("^")[18] == "07052026" and l.split("^")[16] == "00301" and l.split("^")[7] == "8640.00" for l in cd), "B5. the hand challan's CD line in the FVU file: BSR, date, serial, tax (%s)" % cd)
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
        ok(r and r.get("suggested") and not r.get("placed") and r["form"] == "26Q" and r["q"] == "Q1", "C5. a new 94C challan of 07-May: what it pays suggested on 26Q Q1, nothing tagged by itself (%s)" % r)
        ok(J("() => TDSReg.balance(TDS.challans().find(c => c.serial === '00601')).tax") == 8640, "C5. its balance stays until a person confirms")
        r = J("async (x) => { const r = await TDSReg.addHand(x); return r.placed; }", dict(good, serial="00602", tax="26520", date="2026-05-07", section="92B"))
        ok(r and r.get("suggested") and r["form"] == "24Q", "C5. a 92B challan: suggested on 24Q (%s)" % r)
        J("() => TDSMatch.confirmAll('24Q', '2026-27', 'Q1')")
        r = J("async () => { const n = TDSCH.add([{bsr: '0240020', serial: '00603', date: '20260507', tax: 500, interest: 0, section: '', minorHead: '200'}]); return n; }")
        ok(J("() => TDS.challans().find(c => c.serial === '00603').autoPlace") == "unknown" and J("() => TDSReg.usedTax(TDS.challans().find(c => c.serial === '00603'))") == 0, "C6. a challan of unknown type is not placed")
        J("() => { S.tdsView = 'return'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'checks'; S.tdsFix = ''; render(); }"); pg.wait_for_timeout(400)
        ok(pg.locator('[data-val-item="chtype"]').count() == 1 and "which return" in pg.locator('[data-val-item="chtype"]').inner_text(), "C6. Validate & file asks which return, in one line")
        # next-tds-validate-short: past five lines the rest are under "N more warnings · Show"
        if pg.locator('[data-val-more-show]').count(): pg.click('[data-val-more-show]'); pg.wait_for_timeout(200)
        pg.click('[data-val-review="chtype"]'); pg.wait_for_timeout(300)
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
        # round 3 B (the owner, 14-Oct-2026): Deposited · BSR / serial · Nature · Total · Balance left · [Use…]
        ok(heads == ["deposited", "bsr / serial", "nature", "total", "balance left", ""], "C8. the columns: Deposited, BSR / serial, Nature, Total, Balance left, Use… (%s)" % heads)
        ok(pg.locator('[data-reg-filter]').count() == 1 and pg.locator('[data-reg-filter="needs"]').count() == 1, "C8. one filter: Needs a return")
        # round 3 B (the owner, 14-Oct-2026): no filter arrow on each heading (the one filter bar is enough), the head row on one
        # line, the amounts right-aligned under their headings; the source ("Tally" / "by hand") in small grey words on the
        # BSR/serial's line; no yellow "Type unknown" badge: the Nature column's small "Set type" link instead
        J("""() => { for (let i = 0; i < 4; i++) S.books.challans.push({id: 'chRow' + i, bsr: '0240020', date: '2026050' + (i + 1), serial: '0090' + i, tax: 100 + i, interest: 0, section: '194C', minorHead: '200', from: 'hand'}); render(); }"""); pg.wait_for_timeout(600)
        hd = J("""() => { const t = document.getElementById('tdsRegTable'), ths = [...t.tHead.rows[t.tHead.rows.length - 1].cells], row = t.tBodies[0].rows[0];
          return {funnels: t.querySelectorAll('.gff').length, ths: ths.map((th, i) => { const r = th.getBoundingClientRect(), kids = [...th.querySelectorAll('.gfl, .gff')].map(e => e.getBoundingClientRect());
            const lab = th.querySelector('.gfl'), lr = lab ? lab.getBoundingClientRect() : null, td = row.cells[i], last = td && td.lastElementChild ? td.lastElementChild.getBoundingClientRect() : null;
            return {label: (lab ? lab.textContent : th.textContent).trim(), h: Math.round(r.height), oneLine: kids.length < 2 || Math.max(...kids.map(k => k.top)) - Math.min(...kids.map(k => k.top)) < 6,
              n: th.classList.contains('n'), right: lr && last ? Math.round(lr.right - last.right) : null}; })}; }""")
        ok(hd["funnels"] == 0 and all(h["oneLine"] and h["h"] <= 48 for h in hd["ths"]), "C8. no filter arrows on the headings (%d); the head row on one line (%s)" % (hd["funnels"], [(h["label"], h["h"], h["oneLine"]) for h in hd["ths"]]))
        ok(all(abs(h["right"]) <= 6 for h in hd["ths"] if h["n"] and h["right"] is not None) and sum(1 for h in hd["ths"] if h["n"]) >= 2, "C8. Total challan and Balance left: the amounts right-aligned under their headings (%s)" % [(h["label"], h["right"]) for h in hd["ths"] if h["n"]])
        src = J("""() => { const td = document.querySelector('#tdsRegTable tr[data-reg-row="chRow0"] td:nth-child(2)'), b = td.querySelector('button'), s = td.querySelector('[data-ch-src]');
          return s && {text: s.textContent, tag: s.classList.contains('tag'), dy: Math.abs(s.getBoundingClientRect().top - b.getBoundingClientRect().top), size: parseFloat(getComputedStyle(s).fontSize), grey: getComputedStyle(s).color !== getComputedStyle(b).color}; }""")
        ok(src and src["text"] == "by hand" and not src["tag"] and src["dy"] < 6 and src["size"] <= 12.5 and src["grey"], "C8. the source in small grey words on the BSR/serial's line (%s)" % src)
        J("() => { S.books.challans = S.books.challans.filter(c => !/^chRow/.test(c.id)); render(); }"); pg.wait_for_timeout(300)
        tot = pg.locator('[data-split="total"][data-split-of="%s"]' % ch)
        ok("Tax ₹26,520" in (tot.get_attribute("title") or "") and "Interest" in tot.get_attribute("title"), "C9. hovering the total shows the split: %s" % tot.get_attribute("title"))
        tot.click(); pg.wait_for_timeout(200)
        ok(pg.locator('[data-split-open="total"]').count() == 1, "C9. tapping it shows the split too (phone)")
        left = pg.locator('[data-split="left"][data-split-of="%s"]' % ch)
        ok("Tax ₹0" in (left.get_attribute("title") or ""), "C9. the balance's split by head: %s" % left.get_attribute("title"))
        J("() => { S.books.challans.push({id: 'chFree', bsr: '0240020', date: '20260508', serial: '00701', tax: 2000, interest: 0, section: '194C', minorHead: '200'}); render(); }"); pg.wait_for_timeout(300)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(150)   # the split open above: closed first (a click outside would only close it)
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

        # ---------------- D. round 3 B (the owner, 14-Oct-2026): Nature, Set type, the challan's drawer, the empty register
        unk = J("() => (TDS.challans().find(c => c.serial === '00603') || {}).id")
        J("() => { S.tdsView = 'register'; S.regFl = {}; S.regAddTo = ''; render(); }"); pg.wait_for_timeout(400)
        row = '#tdsRegTable tr[data-reg-row="%s"]' % unk
        ok(pg.locator('[data-type-unknown]').count() == 0, "D1. no yellow Type unknown badge")
        ok(pg.locator(row + ' [data-set-type]').count() == 1 and pg.locator(row + ' [data-set-type]').inner_text().strip() == "Set type", "D1. the Nature column: a small Set type link")
        ok(pg.locator('#tdsRegTable tr[data-reg-row="%s"] td:nth-child(3)' % ch).inner_text().strip() == "92B", "D1. a typed challan's nature: its section (%s)" % pg.locator('#tdsRegTable tr[data-reg-row="%s"] td:nth-child(3)' % ch).inner_text())
        # the row's own controls do not open the drawer
        pg.click('[data-reg-addto="chFree"]'); pg.wait_for_timeout(300)
        ok(pg.locator('[data-detail="challan"]').count() == 0 and pg.locator('[data-use-balance="chFree"]').count() == 1, "D2. Use… opens Use, not the drawer")
        J("() => { S.regAddTo = ''; render(); }"); pg.wait_for_timeout(200)
        pg.locator('[data-split="total"][data-split-of="%s"]' % ch).click(); pg.wait_for_timeout(300)
        ok(pg.locator('[data-detail="challan"]').count() == 0 and pg.locator('[data-split-open="total"]').count() == 1, "D2. a tap on Total opens its split, not the drawer")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        # a row click: the drawer with everything
        pg.locator('#tdsRegTable tr[data-reg-row="%s"] td:nth-child(1)' % ch).click(); pg.wait_for_timeout(700)
        dr = '[data-detail="challan"] '
        ok(pg.locator('[data-detail="challan"]').count() == 1 and pg.get_attribute('[data-detail="challan"]', "data-detail-id") == ch, "D3. a row click opens the challan's drawer")
        t = pg.inner_text('[data-detail="challan"]') if pg.locator('[data-detail="challan"]').count() else ""
        for w in ["0240020", "00602", "07-May-2026", "Minor head", "200", "92B", "Source", "by hand"]:
            ok(w in t, "D3. the drawer says %r" % w)
        heads2 = pg.locator(dr + '[data-ch-heads] tbody tr').all_inner_texts()
        ok([h.split("\t")[0].strip() for h in heads2] == ["Tax", "Interest", "Fee", "Others"], "D3. tax, interest, fee and others (%s)" % [h.split("\t")[0] for h in heads2])
        th = [x.strip().lower() for x in pg.locator(dr + '[data-ch-heads] thead th').all_inner_texts()]
        ok(th[1:] == ["paid", "used", "left"], "D3. each paid, used and left (%s)" % th)
        tax_row = pg.locator(dr + '[data-ch-heads] tbody tr').first.inner_text()
        ok("26,520" in tax_row and "0" in tax_row, "D3. the tax: paid 26,520, used 26,520, left 0 (%s)" % tax_row.replace("\t", " | "))
        uses = pg.locator(dr + '[data-ch-use]')
        ok(uses.count() == 1 and "24Q" in uses.first.inner_text() and "Q1" in uses.first.inner_text() and "26,520" in uses.first.inner_text() and "draft" in uses.first.inner_text().lower(), "D3. every return it is used in: form, quarter, amount, draft (%s)" % (uses.first.inner_text() if uses.count() else "none"))
        ok(pg.locator(dr + '[data-ch-use] button, ' + dr + '[data-ch-use] a').count() >= 1, "D3. each use a link")
        ok(pg.locator(dr + '[data-ch-traces]').count() == 1, "D3. the TRACES status (%s)" % (pg.inner_text(dr + '[data-ch-traces]') if pg.locator(dr + '[data-ch-traces]').count() else "none"))
        ok(pg.locator(dr + '[data-ch-who]').count() == 1 and "Added" in pg.inner_text(dr + '[data-ch-who]'), "D3. who added it and when (%s)" % (pg.inner_text(dr + '[data-ch-who]') if pg.locator(dr + '[data-ch-who]').count() else "none"))
        acts = pg.locator(dr + '[data-ch-act]').evaluate_all("(l) => l.map(e => e.dataset.chAct)")
        ok(acts == ["use", "type", "edit", "delete"], "D3. the actions: Use in a return, Set type, Edit, Delete (%s)" % acts)
        pg.click(dr + '[data-ch-use] button'); pg.wait_for_timeout(600)
        ok(J("S.tdsView") == "return" and J("S.tdsForm") == "24Q" and J("S.tdsQ") == "Q1", "D3. a use's link opens that return (%s %s %s)" % (J("S.tdsView"), J("S.tdsForm"), J("S.tdsQ")))
        # a Tally challan: no Edit; Delete says why not
        J("() => { S.books.challans.push({id: 'chT', bsr: '0510308', date: '20260509', serial: '00901', tax: 700, interest: 0, section: '194J', minorHead: '200', from: 'tally', madeBy: 'tally-sync', fromVoucher: 'pay194jMay'}); S.tdsView = 'register'; render(); }"); pg.wait_for_timeout(400)
        J("() => openDetail('challan', 'chT')"); pg.wait_for_timeout(600)
        acts = pg.locator(dr + '[data-ch-act]').evaluate_all("(l) => l.map(e => e.dataset.chAct)")
        ok("edit" not in acts and "use" in acts, "D4. a Tally challan: no Edit (hand-entered only) (%s)" % acts)
        t = pg.inner_text('[data-detail="challan"]')
        ok("Tally" in t and "pay194jMay" not in t or "entry" in t.lower(), "D4. its source: Tally, with its entry")
        J("() => closeDetail()"); pg.wait_for_timeout(500)
        # Set type: from the row's link, the nature given, then placed as a new challan is
        pg.click(row + ' [data-set-type]'); pg.wait_for_timeout(600)
        ok(pg.locator('[data-detail="challan"]').count() == 1 and pg.locator(dr + '[data-set-type-box]').count() == 1, "D5. Set type opens the drawer at its nature")
        pg.fill(dr + '[data-set-type-box] input', "94C"); pg.click(dr + '[data-set-type-box] [data-set-type-save]'); pg.wait_for_timeout(600)
        c = J("() => TDS.challans().find(c => c.serial === '00603')")
        ok(J("(id) => TDSReg.natureCode(TDS.challans().find(c => c.id === id))", unk) == "94C" and c.get("autoPlace") != "unknown", "D5. its nature is 94C, and it is no longer of unknown type (%s)" % c.get("autoPlace"))
        ok(J("() => TDSReg.trail().some(t => t.act === 'challan-edit' && /type set/.test(t.note))"), "D5. the trail keeps it")
        J("() => closeDetail()"); pg.wait_for_timeout(500)
        ok(pg.locator(row + ' [data-set-type]').count() == 0 and "94C" in pg.locator(row + ' td:nth-child(3)').inner_text(), "D5. the row shows 94C")
        # Esc closes the drawer, the page stays
        J("(id) => openDetail('challan', id)", ch); pg.wait_for_timeout(600)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
        ok(pg.locator('[data-detail="challan"]').count() == 0 and pg.locator('[data-register]').count() == 1, "D6. Esc closes the drawer; the register stays")
        # the empty register
        J(RESET); J("() => { S.tdsView = 'register'; render(); }"); pg.wait_for_timeout(400)
        em = pg.locator('[data-register] [data-list-empty]')
        et = em.inner_text() if em.count() else ""
        ok("No challans yet" in et and "Add challan" in et and "come from Tally when you pay TDS there" in et, "D7. empty: No challans yet · Add challan · or they come from Tally (%r)" % et)
        pg.click('[data-register] [data-list-empty] [data-reg-empty-add]'); pg.wait_for_timeout(300)
        ok(pg.locator('[data-add-challan="new"]').count() == 1, "D7. its Add challan opens the form")
        ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
        br.close()
finally:
    srv.shutdown()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
