"""python3 run_audit_wp_ui.py - Audit › Working papers in a browser (app/dist-test; TDSDESK_SITE to change), on the made-up book
of tests/audit_fixture.js: run, the table in risk order with each check's figures equal to AuditWP's, expand a check to its
entries, mark it (status and remark, kept with the books as items), Excel (opened again in the page: numbers and SUM
formulas equal the table), PDF (the print page with the remarks), and an entry opening in Look up. The run takes under 5 s.
Run one at a time: flock /tmp/fincom-app.lock python3 run_audit_wp_ui.py"""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
if not os.path.isabs(SITE): SITE = os.path.join(HERE, SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", 8389), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
FIX = open(os.path.join(HERE, "audit_fixture.js")).read()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8389/"); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1500)
    # the fixture's books, finished with the app's own 2B reader and GST working (tests/audit_fixture.js)
    pg.evaluate("""(src) => {
      const module = {exports: {}}; new Function("module", "require", src)(module, () => ({}));
      const f = module.exports.makeBooks();
      const c = newCompany({name: f.company.name, gstin: f.company.gstin}); c.pan = f.company.pan; c.tan = f.company.tan;
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      f.company = c; f.books.cid = c.id;
      f.books.loading = false; S.books = f.books;
      module.exports.finish(f, {Books, GST2B, GSTCMP, GSTR});
      window.__bk = S.books; window.__fx = f; S.booksTab = "audit"; S.auditTab = "wp"; render(); }""", FIX)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; S.awp = null; render();"); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok("Working papers" in t and pg.locator('[data-audit-tab="wp"][aria-selected="true"]').count() == 1, "Audit has a Working papers tab, open")
    ok(pg.evaluate("[S.awp.from, S.awp.to].join('-')") == "20250401-20260331", "the period: the last full year of the books, 01-Apr-2025 to 31-Mar-2026")
    vsig = "() => fpHash(JSON.stringify(S.books.vouchers))"
    before = pg.evaluate(vsig)
    # ---- run
    pg.click('[data-awp-run]'); pg.wait_for_timeout(2500)
    res = pg.evaluate("(() => { const r = S.awp.res; return {ms: r.ms, ranked: r.ranked, checks: r.checks.map(c => ({id: c.id, title: c.title, status: c.status, count: c.count, amount: c.amount, score: c.score, rank: c.rank}))}; })()")
    ok(res["ms"] < 5000, "the run took %d ms (under 5 s)" % res["ms"])
    rows = pg.locator("[data-awp-table] tbody tr[data-awp-check]")
    ok(rows.count() == 14 and [rows.nth(i).get_attribute("data-awp-check") for i in range(14)] == res["ranked"], "14 checks, in risk order: " + ", ".join(res["ranked"][:4]) + " ...")
    money = lambda v: "₹" + pg.evaluate("v => INR.format(v)", v)
    good = True
    for c in res["checks"]:
        cells = pg.locator('[data-awp-check="%s"] td' % c["id"]).all_inner_texts()
        exp = (str(c["rank"] or ""), str(c["count"]), money(c["amount"]))
        if (cells[0].strip(), cells[3].strip(), cells[4].strip()) != exp: good = False; print("     ", c["id"], cells[:5], exp)
    ok(good, "every row shows the run's rank, entries and amount (to the paisa)")
    fx = pg.evaluate("Object.fromEntries(Object.entries(window.__fx.expected).map(([k, v]) => [k, v.length]))")
    ok(all(next(c for c in res["checks"] if c["id"] == k)["count"] == n for k, n in fx.items()) and next(c for c in res["checks"] if c["id"] == "benford")["status"] == "ok",
       "each check found its seeded entries (%s)" % ", ".join("%s %d" % kv for kv in sorted(fx.items())))
    if fails: print("      the run: " + ", ".join("%s %s %d %.2f" % (c["id"], c["status"], c["count"], c["amount"]) for c in res["checks"]))
    ok(pg.inner_text("[data-awp-flagged]") == "13", "13 checks flagged; Benford passes")
    pg.screenshot(path=os.path.join(OUT, "audit-wp.png"), full_page=False)
    # ---- expand
    pg.click('[data-awp-check="cash269ST"] button.linkbtn'); pg.wait_for_timeout(400)
    ent = pg.locator('[data-awp-entries="cash269ST"] tbody tr')
    et = pg.inner_text('[data-awp-entries="cash269ST"]')
    ok(ent.count() == 2 and "₹2,00,500.50" in et and "₹2,10,000.50" in et and "Alpha Traders" in et and "Beta Stores" in et, "269ST expands to its two entries")
    pg.click('[data-awp-check="cash269ST"] button.linkbtn'); pg.wait_for_timeout(300)
    ok(pg.locator('[data-awp-entries="cash269ST"]').count() == 0, "and closes again")
    pg.click('[data-awp-check="tds"] button.linkbtn'); pg.wait_for_timeout(400)
    tt = pg.inner_text('[data-awp-entries="tds"]')
    ok("Kapoor Associates" in tt and "short deducted" in tt and "interest" in tt and "₹45.45" in tt, "TDS expands: not deducted, short, late with interest")
    # ---- remark and status
    pg.select_option('select[aria-label="Review of %s"]' % next(c["title"] for c in res["checks"] if c["id"] == "cash269ST"), "issue"); pg.wait_for_timeout(300)
    box = 'input[aria-label="Remarks on %s"]' % next(c["title"] for c in res["checks"] if c["id"] == "cash269ST")
    pg.fill(box, "Receipts from Alpha and Beta: ask for the bank proof"); pg.press(box, "Tab"); pg.wait_for_timeout(400)
    pg.select_option('select[aria-label="Review of %s"]' % next(c["title"] for c in res["checks"] if c["id"] == "weekend"), "rev"); pg.wait_for_timeout(300)
    per = "20250401-20260331"
    it = pg.evaluate("S.books.auditWp.find(x => x.id === 'wp|%s|cash269ST')" % per)
    ok(it and it["status"] == "issue" and it["remark"] == "Receipts from Alpha and Beta: ask for the bank proof" and it["kind"] == "wp", "status and remark kept with the books as an item: " + json.dumps(it)[:120])
    ok(pg.input_value('[data-awp-status="cash269ST"]') == "issue" and pg.get_attribute('[data-awp-status="cash269ST"]', "data-kind") == "bad" and pg.input_value('[data-awp-status="weekend"]') == "rev", "the row shows Issue; weekend Reviewed")
    ok(pg.evaluate("BOOKS_KEYS.includes('auditWp') && !!S.books.auditWp.find(x => x.id === 'run|%s')" % per), "the run is kept for the Assistant (run|period), and auditWp is shared like the other books' items")
    ok("2 of 14" in pg.inner_text("#app") or "Reviewed" in pg.inner_text("#app"), "the tile counts the reviewed checks")
    pg.screenshot(path=os.path.join(OUT, "audit-wp-open.png"), full_page=False)
    # ---- Excel: the file, opened again with the app's own reader
    pg.evaluate("() => { window.__x = null; window.saveFile = (n, blob) => blob.arrayBuffer().then(a => { window.__x = {n, a: Array.from(new Uint8Array(a))}; }); }")
    pg.click("[data-awp-excel]")
    for _ in range(100):
        if pg.evaluate("() => window.__x !== null"): break
        pg.wait_for_timeout(200)
    xr = pg.evaluate("""() => { const wb = XLSX.read(new Uint8Array(window.__x.a), {type: 'array', cellFormula: true}); const S1 = wb.Sheets.Summary;
      const rows = XLSX.utils.sheet_to_json(S1, {header: 1, raw: true}); const h = rows.findIndex(r => r[0] === 'Rank');
      const tot = h + 16; return {name: window.__x.n, sheets: wb.SheetNames, body: rows.slice(h + 1, h + 15), fF: S1['F' + tot] && S1['F' + tot].f, vF: S1['F' + tot] && S1['F' + tot].v, fE: S1['E' + tot] && S1['E' + tot].f}; }""")
    order = [next(c for c in res["checks"] if c["id"] == i) for i in res["ranked"]]
    ok(xr["name"].endswith("-audit-working-papers-20250401-20260331.xlsx") and xr["sheets"][:2] == ["Summary", "Entries"], "Excel downloaded: " + xr["name"])
    ok(all(r[1] == c["title"] and r[4] == c["count"] and r[5] == c["amount"] for r, c in zip(xr["body"], order)) and len(xr["body"]) == 14, "Excel: every check's count and amount are numbers equal to the screen")
    ok(xr["fF"] and xr["fF"].startswith("SUM(F") and abs(xr["vF"] - sum(c["amount"] for c in order)) < 0.005 and xr["fE"].startswith("SUM(E"), "Excel totals are SUM formulas with the right values (%s = %s)" % (xr["fF"], xr["vF"]))
    hit = next(r for r in xr["body"] if r[1] == next(c["title"] for c in res["checks"] if c["id"] == "cash269ST"))
    ok(hit[7] == "Issue" and hit[8] == "Receipts from Alpha and Beta: ask for the bank proof", "Excel carries the status and remark")
    # ---- PDF (the browser's print page)
    with ctx.expect_page() as pop:
        pg.click("[data-awp-pdf]")
    rep = pop.value; rep.wait_for_timeout(800)
    rt = rep.inner_text("body")
    ok("Audit working papers" in rt and "Receipts from Alpha and Beta" in rt and "Cash received of ₹2 lakh or more" in rt and "2,00,500.50" in rt, "PDF page: the checks, the entries and the remarks")
    rep.pdf(path=os.path.join(OUT, "audit-wp.pdf")); rep.close()
    ok(os.path.getsize(os.path.join(OUT, "audit-wp.pdf")) > 5000, "the PDF prints (A4)")
    # ---- an entry opens in Look up
    pg.click('[data-awp-check="cash269ST"] button.linkbtn'); pg.wait_for_timeout(400)
    pg.click('[data-awp-entries="cash269ST"] tbody tr >> nth=0 >> button.linkbtn'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("S.booksTab") == "lookup" and pg.evaluate("S.lk.q") != "" and pg.evaluate("S.lk.from") == "20250703", "an entry opens in Look up on its date (%s, %s)" % (pg.evaluate("S.lk.q"), pg.evaluate("S.lk.from")))
    ok(pg.evaluate(vsig) == before, "the vouchers are exactly as before (nothing written to the books)")
    ok(not errors, "no page errors" + (": " + "; ".join(errors[:3]) if errors else ""))
    br.close()
srv.shutdown()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
