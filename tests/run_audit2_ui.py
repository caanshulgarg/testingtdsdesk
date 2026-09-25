"""python3 run_audit2_ui.py - audit tabs: related parties and the Form 3CD draft."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8132), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8132/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    pg.set_input_files("#mastersIn", os.path.join(os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")), "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("S.booksTab = 'audit'; render();"); pg.wait_for_timeout(400)
    pg.click('button[data-audittab="rel"]'); pg.wait_for_timeout(400)
    t = pg.inner_text("#app")
    ok("Possibly related" in t and "Pradeep Sharma (Loan)" in t, "related parties: suggestions from the ledgers")
    pg.click('button[data-reladd="Pradeep Sharma (Loan)"]'); pg.wait_for_timeout(300)
    pg.click('button[data-reladd="KARISHMA GAUR (Loan)"]'); pg.wait_for_timeout(300)
    pg.fill("#relq", "SUMIT LAL LOAN"); pg.click('button[data-act="relAddTyped"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.books.auditRel.map(x => x.name).join('|')") == "Pradeep Sharma (Loan)|KARISHMA GAUR (Loan)|SUMIT LAL LOAN", "added from suggestions and by typing")
    pg.select_option('select[data-relrel="Pradeep Sharma (Loan)"]', "Director"); pg.wait_for_timeout(300)
    pg.click('button[data-reldel="SUMIT LAL LOAN"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("JSON.stringify(S.books.auditRel)") == '[{"name":"Pradeep Sharma (Loan)","relation":"Director"},{"name":"KARISHMA GAUR (Loan)","relation":""}]', "relation set, one removed")
    pg.click('button[data-audittab="find"]'); pg.wait_for_timeout(300)
    pg.click('button[data-misquick="lastyear"]') if pg.locator('button[data-misquick]').count() else None
    pg.fill("input[data-auditfrom]", "2025-04-01"); pg.dispatch_event("input[data-auditfrom]", "change"); pg.fill("input[data-auditto]", "2026-03-31"); pg.dispatch_event("input[data-auditto]", "change")
    pg.click('button[data-act="auditRun"]'); pg.wait_for_timeout(4500)
    t = pg.inner_text("#app")
    ok("Micro and small suppliers unpaid beyond 45 days" in t and "Penalties, fines and interest that are not allowed" in t and "All transactions with related parties" in t, "new findings: MSME, penalties, related parties")
    pg.click('button[data-audittab="3cd"]'); pg.wait_for_timeout(700)
    t = pg.inner_text("#app")
    ok("Clause 34(a)" in t and "Clause 44" in t and "Clause 22" in t, "the Form 3CD draft, clause by clause")
    pg.screenshot(path=OUT + "/audit-3cd.png", full_page=False)
    with ctx.expect_page() as pop:
        pg.click('button[data-act="audit3cdPdf"]')
    rp = pop.value; rp.wait_for_timeout(700); ok("FORM 3CD" in rp.inner_text("body"), "draft as PDF"); rp.pdf(path=OUT + "/audit-3cd.pdf"); rp.close()
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="audit3cdExcel"]'); pg.wait_for_timeout(3000)
    ok(any("3CD-working" in n for n in pg.evaluate("window.__saved")), "draft as Excel, a sheet per clause")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
