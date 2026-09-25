"""python3 run_audit_ui.py - the Audit tab in a browser."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8128), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
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
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      window.__bk = S.books; S.booksTab = "import"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    pg.set_input_files("#mastersIn", os.path.join(os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")), "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("S.booksTab = 'audit'; render();"); pg.wait_for_timeout(500)
    ok("Not run yet" in pg.inner_text("#app"), "Audit tab before the first run")
    pg.fill("input[data-auditfrom]", "2025-04-01"); pg.dispatch_event("input[data-auditfrom]", "change")
    pg.fill("input[data-auditto]", "2026-03-31"); pg.dispatch_event("input[data-auditto]", "change")
    pg.click('button[data-act="auditRun"]'); pg.wait_for_timeout(4000)
    t = pg.inner_text("#app")
    ok("Serious" in t and "Expenses where TDS was due but not deducted" in t, "run now: findings listed")
    ok("the books begin on" in t, "why the balance checks did not run is said")
    pg.screenshot(path=OUT + "/audit.png", full_page=False)
    # open the duplicate bills finding, mark it, add a note
    fid = "duplicates:dupRef"
    pg.click('button[data-auditopen="%s"]' % fid); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("Suggested entries" in t and "Reversal of voucher" in t and "The entries behind it" in t, "a finding opens to effect, what to do, entries and vouchers")
    pg.select_option('select[data-auditstatus="%s"]' % fid, "pass"); pg.wait_for_timeout(400)
    pg.fill('input[data-auditnote="%s"]' % fid, "Second entries to be reversed by accounts"); pg.press('input[data-auditnote="%s"]' % fid, "Tab"); pg.wait_for_timeout(400)
    st = pg.evaluate("JSON.stringify(S.books.audit.st[%s])" % json.dumps(fid))
    ok('"s":"pass"' in st and "Second entries" in st, "status and note kept: " + st[:80])
    pg.screenshot(path=OUT + "/audit-open.png", full_page=False)
    # downloads
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => blob.text().then(t => window.__saved.push([n, t.slice(0, 400)])); }")
    pg.click('button[data-act="auditJe"]'); pg.wait_for_timeout(700)
    sv = pg.evaluate("window.__saved")
    ok(sv and sv[0][0].endswith("audit-entries.xml") and "<VOUCHER VCHTYPE=\"Journal\"" in sv[0][1], "Tally file of entries to pass")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="auditExcel"]'); pg.wait_for_timeout(3000)
    ok(any("-audit-" in n for n in pg.evaluate("window.__saved")), "Excel with annexures")
    with ctx.expect_page() as pop:
        pg.click('button[data-act="auditReport"]')
    rep = pop.value; rep.wait_for_timeout(800)
    rt = rep.inner_text("body")
    ok("AUDIT OBSERVATIONS" in rt and "Summary" in rt and "Recommendation." in rt and "Second entries to be reversed" in rt, "report opens for PDF with the management response")
    rep.pdf(path=OUT + "/audit-report.pdf") if hasattr(rep, "pdf") else None
    rep.close()
    # schedule: weekly, and a run on its own when due
    pg.select_option("select[data-auditfreq]", "weekly"); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.books.auditCfg.freq") == "weekly", "schedule saved")
    pg.evaluate("S.books.audit.last.at = '2026-09-01T09:00:00.000Z'; Audit.maybeRun(); render();"); pg.wait_for_timeout(3000)
    ok(pg.evaluate("S.books.audit.last.how").startswith("on its own"), "runs on its own when due: " + pg.evaluate("S.books.audit.last.how"))
    ok("Earlier runs" in pg.inner_text("#app"), "earlier runs listed")
    ok(pg.evaluate("Audit.status('duplicates:dupRef').s") == "pass", "your marks survive a new run")
    # put the second entries right in the books, run again: they show as put right, the finding as solved
    code1 = pg.evaluate("S.books.audit.last.code")
    pg.evaluate("() => { const ids = new Set(S.books.audit.last.findings.find(f => f.id === 'duplicates:dupRef').rows.map(r => r.vid)); S.books.vouchers = S.books.vouchers.filter(v => !ids.has(v.id)); }")
    pg.click('button[data-act="auditRun"]'); pg.wait_for_timeout(4000)
    t = pg.inner_text("#app")
    ok("Put right" in t and "Solved" in t and "The same supplier bill entered twice" in t.split("Solved")[-1], "after correcting the books: put right, and the finding listed as solved")
    ok(pg.evaluate("S.books.audit.last.code") != code1, "the result code changes with the books")
    pg.click('button[data-act="auditRun"]'); pg.wait_for_timeout(4000)
    ok(pg.evaluate("S.books.audit.history[0].code") == pg.evaluate("S.books.audit.history[1].code"), "run again on the same books: the same result code")
    pg.click('button[data-act="auditFinal"]'); pg.wait_for_timeout(500)
    ok("is final" in pg.inner_text("#app"), "report finalised")
    fcode = pg.evaluate("Audit.finalFor(S.books.audit.last.from, S.books.audit.last.to).run.code")
    pg.evaluate("S.books.vouchers = S.books.vouchers.slice(0, 5000)"); pg.click('button[data-act="auditRun"]'); pg.wait_for_timeout(3000)
    ok(pg.evaluate("Audit.finalFor(S.books.audit.last.from, S.books.audit.last.to).run.code") == fcode, "a later run does not change the final report")
    for a in ["", "cash", "tds", "gst", "books", "bal"]:
        pg.evaluate("S.auditArea = %s; render();" % json.dumps(a))
    ok(True, "every area renders")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
