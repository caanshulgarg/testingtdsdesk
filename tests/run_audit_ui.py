"""python3 run_audit_ui.py - the Audit tab in a browser. [--shots DIR]
Round 69 (the owner, 16-Oct-2026: "audit part should like problem and suggestions and recheck.. and it should be in a
table format properly.. so that anyone can read it properly"): the findings are one table, # | Severity | Area | Problem |
Suggestion | Status | Recheck; Details opens what a finding's card showed under its row; Recheck runs the audit again for
the same period and says "Still there" or "Put right ✓" on the row; "Run now" is "Recheck all" once run. The TDS not
deducted is a finding per party, section and year (TDSWatch.missed)."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books_data import DATA, CACHE, FIXTURE, GSTIN, GSTIN09, COMPANY
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8128), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
ROW = 'table[data-list=auditFindings] > tbody > tr[data-key="%s"]'
books = json.load(open(CACHE))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8128/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "@GSTIN@", tallyName: "@CO@"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      window.__bk = S.books; S.booksTab = "import"; render(); }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY), books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("S.booksTab = 'audit'; render();"); pg.wait_for_timeout(500)
    ok("Not run yet" in pg.inner_text("#app"), "Audit tab before the first run")
    pg.fill('input[aria-label="Audit from"]', "2025-04-01"); pg.dispatch_event('input[aria-label="Audit from"]', "change")
    pg.fill('input[aria-label="Audit to"]', "2026-03-31"); pg.dispatch_event('input[aria-label="Audit to"]', "change")
    pg.click('button:text-is("Run now")'); pg.wait_for_timeout(4000)
    t = pg.inner_text("#app")
    tdsf = pg.evaluate("S.books.audit.last.findings.filter(f => f.check === 'tdsMissed').map(f => [f.id, f.title, f.amount])")
    ok("Serious" in t and tdsf and all((" not deducted: " in x[1]) and (x[1] in t) for x in tdsf), "run now: findings listed, the TDS not deducted a finding per party and year (%s)" % [x[1] for x in tdsf][:4])
    # round 69: one table, exactly these columns; a finding a row, its suggestion there without opening anything
    heads = pg.evaluate("[...document.querySelectorAll('#app table[data-list=auditFindings] > thead th')].map(t => t.innerText.trim())")
    ok(heads == ["#", "Severity", "Area", "Problem", "Suggestion", "Status", "Recheck"], "round 69: the findings table's columns: %s" % heads)
    ok(pg.locator("#app section.dash-card[data-key]").count() == 0, "round 69: no finding cards left")
    rows = pg.evaluate("""[...document.querySelectorAll('#app table[data-list=auditFindings] > tbody > tr[data-key]')].map(t => [t.getAttribute('data-key'), t.cells[0].innerText.trim(), t.innerText])""")
    F = pg.evaluate("S.books.audit.last.findings.map(f => [f.id, f.suggestion, f.title])")
    ok([r[0] for r in rows] == [f[0] for f in F] and [r[1] for r in rows] == [str(i + 1) for i in range(len(F))], "round 69: each finding one row, in the run's order (serious first), numbered 1 to %d" % len(F))
    ok(all(f[1][:60] in r[2] and f[2] in r[2] for f, r in zip(F, rows)), "round 69: each row shows its problem's title and its suggestion without opening")
    ok(pg.locator('#app [data-audit-head] button:text-is("Recheck all")').count() == 1 and pg.locator('#app [data-audit-head] button:text-is("Run now")').count() == 0, "round 69: once run, the head's button is 'Recheck all'")
    if SHOTS:
        pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(300)
        pg.locator("#app [data-audit-findings]").screenshot(path=os.path.join(SHOTS, "audit-table-1440-light.png"))
        pg.emulate_media(color_scheme="dark"); pg.evaluate("document.documentElement.setAttribute('data-theme', 'dark')"); pg.wait_for_timeout(400)
        pg.locator("#app [data-audit-findings]").screenshot(path=os.path.join(SHOTS, "audit-table-1440-dark.png"))
        pg.emulate_media(color_scheme="light"); pg.evaluate("document.documentElement.setAttribute('data-theme', 'light')"); pg.wait_for_timeout(300)
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(600)
    wide = pg.evaluate("[document.documentElement.scrollWidth, window.innerWidth, (() => { const w = document.querySelector('#app [data-audit-findings] .lt-wrap, #app [data-audit-findings] .bk-tablewrap'); return w ? [w.scrollWidth, w.clientWidth, getComputedStyle(w).overflowX] : null; })()]")
    ok(wide[0] <= wide[1] + 1 and wide[2] and wide[2][2] in ("auto", "scroll"), "round 69: phone 390: no sideways page scroll; the table scrolls in its own box (%s)" % wide)
    if SHOTS: pg.evaluate("document.querySelector('#app [data-audit-findings]').scrollIntoView()"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(SHOTS, "audit-table-390.png"), full_page=False)
    pg.set_viewport_size({"width": 1400, "height": 1000}); pg.wait_for_timeout(400)
    if FIXTURE:   # the fixture's day book starts where its books begin, so the balance checks run (MSME, cash below zero)
        ok("the books begin on" not in t and not any("Balance checks were not run" in n for n in pg.evaluate("S.books.audit.last.notes || []")), "the balance checks run: the day book starts where the books begin")
        ok("Micro and small suppliers unpaid beyond 45 days" in t, "fixture: the MSME supplier unpaid beyond 45 days is found")
    else:
        ok("the books begin on" in t, "why the balance checks did not run is said")
    pg.screenshot(path=OUT + "/audit.png", full_page=False)
    # open the duplicate bills finding (Details, under its row), mark it, add a note
    fid = "duplicates:dupRef"
    pg.click(ROW % fid + ' button[data-audit-details]'); pg.wait_for_timeout(500)
    t = pg.inner_text('#app [data-audit-body="%s"]' % fid)
    ok("Suggested entries" in t and "Reversal of voucher" in t and "The entries behind it" in t and "Effect." in t and "What to do." in t, "Details opens under the row: effect, what to do, entries and vouchers")
    pg.select_option(ROW % fid + ' select[aria-label^="Status of "]', "pass"); pg.wait_for_timeout(400)
    pg.fill('#app [data-audit-body="%s"] input[aria-label="Note for the report"]' % fid, "Second entries to be reversed by accounts"); pg.press('#app [data-audit-body="%s"] input[aria-label="Note for the report"]' % fid, "Tab"); pg.wait_for_timeout(400)
    st = pg.evaluate("JSON.stringify(S.books.audit.st[%s])" % json.dumps(fid))
    ok('"s":"pass"' in st and "Second entries" in st, "status and note kept: " + st[:80])
    pg.screenshot(path=OUT + "/audit-open.png", full_page=False)
    # downloads
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => blob.text().then(t => window.__saved.push([n, t.slice(0, 400)])); }")
    # clean-up batch 2: the downloads are under Download (Run now is the page's one main button)
    pg.evaluate("() => document.querySelectorAll('#app [data-audit-download]').forEach(d => d.open = true)"); pg.click('button:has-text("Tally file of entries")'); pg.wait_for_timeout(700)
    sv = pg.evaluate("window.__saved")
    ok(sv and sv[0][0].endswith("audit-entries.xml") and "<VOUCHER VCHTYPE=\"Journal\"" in sv[0][1], "Tally file of entries to pass")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.evaluate("() => document.querySelectorAll('#app [data-audit-download]').forEach(d => d.open = true)"); pg.click('button:text-is("Excel with the annexures")'); pg.wait_for_timeout(3000)
    ok(any("-audit-" in n for n in pg.evaluate("window.__saved")), "Excel with annexures")
    pg.evaluate("() => document.querySelectorAll('#app [data-audit-download]').forEach(d => d.open = true)"); 
    with ctx.expect_page() as pop:
        pg.click('button:text-is("Download the report (PDF)")')
    rep = pop.value; rep.wait_for_timeout(800)
    rt = rep.inner_text("body")
    ok("AUDIT OBSERVATIONS" in rt and "Summary" in rt and "Recommendation." in rt and "Second entries to be reversed" in rt, "report opens for PDF with the management response")
    rep.pdf(path=OUT + "/audit-report.pdf") if hasattr(rep, "pdf") else None
    rep.close()
    # schedule: weekly, and a run on its own when due
    pg.evaluate("document.querySelectorAll('#app details').forEach(d => d.open = true)")   # settings sit in a closed section
    pg.select_option('select[aria-label="Run on its own"]', "weekly"); pg.wait_for_timeout(300)
    pg.click('#app [data-confirm-foot="books:audit-settings"] [data-cfm="save"]'); pg.wait_for_timeout(300)   # saved with Save (review 18)
    ok(pg.evaluate("S.books.auditCfg.freq") == "weekly", "schedule saved")
    pg.evaluate("S.books.audit.last.at = '2026-09-01T09:00:00.000Z'; Audit.maybeRun(); render();"); pg.wait_for_timeout(3000)
    ok(pg.evaluate("S.books.audit.last.how").startswith("on its own"), "runs on its own when due: " + pg.evaluate("S.books.audit.last.how"))
    ok("Earlier runs" in pg.inner_text("#app"), "earlier runs listed")
    ok(pg.evaluate("Audit.status('duplicates:dupRef').s") == "pass", "your marks survive a new run")
    # round 69: Recheck on a finding still in the books: "Still there", with the time it was checked
    period = pg.evaluate("[S.books.audit.last.from, S.books.audit.last.to]"); nrun = pg.evaluate("S.books.audit.history.length")
    still = pg.evaluate("S.books.audit.last.findings.find(f => f.id !== 'duplicates:dupRef').id")
    pg.click('#app button[data-audit-recheck="%s"]' % still); pg.wait_for_timeout(3000)
    say = pg.evaluate("(id) => { const x = document.querySelector('#app [data-audit-recheck-say=\"' + CSS.escape(id) + '\"]'); return x ? x.innerText : ''; }", still)
    import re as _re
    ok(_re.match(r"^Still there · checked \d\d:\d\d IST$", say) is not None and pg.evaluate("S.books.audit.history.length") == nrun + 1 and pg.evaluate("[S.books.audit.last.from, S.books.audit.last.to]") == period,
       "round 69: Recheck on a finding still there: '%s', the audit run again for the same period %s" % (say, period))
    # put the second entries right in the books, Recheck that finding: "Put right ✓" on its row, and it is under Solved
    code1 = pg.evaluate("S.books.audit.last.code")
    pg.evaluate("() => { const ids = new Set(S.books.audit.last.findings.find(f => f.id === 'duplicates:dupRef').rows.map(r => r.vid)); S.books.vouchers = S.books.vouchers.filter(v => !ids.has(v.id)); }")
    pg.click('#app button[data-audit-recheck="%s"]' % fid); pg.wait_for_timeout(4000)
    say = pg.evaluate("(id) => { const x = document.querySelector('#app [data-audit-recheck-say=\"' + CSS.escape(id) + '\"]'); return x ? x.innerText : ''; }", fid)
    ok(_re.match(r"^Put right ✓ · checked \d\d:\d\d IST$", say) is not None and pg.locator(ROW % fid).count() == 1 and not pg.evaluate("S.books.audit.last.findings.some(f => f.id === 'duplicates:dupRef')"),
       "round 69: the finding put right in the books, Recheck says '%s' on its row" % say)
    if SHOTS: pg.locator(ROW % fid).scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(SHOTS, "audit-table-recheck.png"), full_page=False)
    t = pg.inner_text("#app")
    ok("Put right" in t and "Solved" in t and "The same supplier bill entered twice" in t.split("Solved")[-1], "after correcting the books: put right, and the finding listed as solved")
    ok(pg.evaluate("S.books.audit.last.code") != code1, "the result code changes with the books")
    pg.click('button:text-is("Recheck all")'); pg.wait_for_timeout(4000)
    ok(pg.evaluate("S.books.audit.history[0].code") == pg.evaluate("S.books.audit.history[1].code"), "run again on the same books: the same result code")
    pg.click('button:text-is("Finalise this report")'); pg.wait_for_timeout(500)
    ok("is final" in pg.inner_text("#app"), "report finalised")
    fcode = pg.evaluate("Audit.finalFor(S.books.audit.last.from, S.books.audit.last.to).run.code")
    pg.evaluate("S.books.vouchers = S.books.vouchers.slice(0, 5000)"); pg.click('button:text-is("Recheck all")'); pg.wait_for_timeout(3000)
    ok(pg.evaluate("Audit.finalFor(S.books.audit.last.from, S.books.audit.last.to).run.code") == fcode, "a later run does not change the final report")
    for a in ["", "cash", "tds", "gst", "books", "bal"]:
        pg.evaluate("S.auditArea = %s; render();" % json.dumps(a))
    ok(True, "every area renders")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
