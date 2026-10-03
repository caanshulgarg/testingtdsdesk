"""python3 run_qrmp_quarter.py - the QRMP quarter on one page (request of 02-Oct-2026), on Testing AAD's books
(tests/data, kept out of git): M1 IFF, M2 IFF, M3 (the quarter's GSTR-1) and the quarter, with counts, taxable value,
status and the figures as filed; the quarter's total against 3B 3.1(a), FinCom's and as filed (FY 2025-26: Q1
16,43,300 + 14,42,058.06 + 9,65,511.87 = 40,50,869.93; Q4 55,53,800 + 7,56,300 + 11,97,130.50 = 75,07,230.50); an IFF
filed only with a date or ARN by the 13th; "IFF not filed"; a document changed after its IFF flagged for 9A/9C; the
portal file names; the filing type of one quarter only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_qrmp_quarter.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8233), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# as filed (the portal's PDFs of FY 2025-26): IFF and GSTR-1 taxable value (Total Liability, net of notes), 3B 3.1(a)
FILED = """() => { const R = '09';
  const f = (form, per, path, v) => GSTX.figSet(R, form, per, path, v);
  f('iff', '202504', 'tl.taxable', 1643300); f('iff', '202505', 'tl.taxable', 1442058.06); f('r1', '202506', 'tl.taxable', 965511.87); f('r3b', '202506', 'a.taxable', 4050869.93);
  f('iff', '202601', 'tl.taxable', 5553800); f('iff', '202602', 'tl.taxable', 756300); f('r1', '202603', 'tl.taxable', 1197130.50); f('r3b', '202603', 'a.taxable', 7507230.50);
  const d = (ym, k, v) => { GSTF.rec(ym, R)[k] = v; };
  d('202504', 'iff', '2025-05-13'); d('202505', 'iff', '2025-06-13'); d('202506', 'r1', '2025-07-12'); d('202506', 'r3b', '2025-10-24');
  d('202601', 'iff', '2026-02-13'); d('202602', 'iff', '2026-03-13'); d('202603', 'r1', '2026-04-11');
  GSTR._carry = null; }"""
OPEN = "(ym) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstReg = '09'; S.gstYm = ym; S.gstPart = 'qtr'; S.gqCol = null; render(); }"
T = lambda pg, sel: pg.inner_text("#app " + sel) if pg.locator("#app " + sel).count() else ""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8233/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(gstfix.SETUP, list(gstfix.load())); pg.wait_for_timeout(1500)
    E = lambda js, *a: pg.evaluate(js, *a)
    E(FILED)
    # ---- Q1 2025-26
    E(OPEN, "202506"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-qtable]").count() == 1, "the quarter on one page (Q1 2025-26)")
    heads = [x.strip() for x in pg.locator("#app [data-qtable] thead th").all_inner_texts()]
    ok([h.upper() for h in heads[1:]] == ["IFF APR-2025", "IFF MAY-2025", "GSTR-1 Q1 2025-26", "QUARTER"], "four columns: M1 IFF, M2 IFF, M3, Quarter (%s)" % heads)
    fl = [T(pg, '[data-qfiled="%s"]' % m) for m in ("202504", "202505", "202506")]
    ok(fl == ["₹16,43,300.00", "₹14,42,058.06", "₹9,65,511.87"], "as filed: IFF April 16,43,300, IFF May 14,42,058.06, the quarter's GSTR-1 9,65,511.87 (%s)" % fl)
    ok(T(pg, "[data-qfiled-total]") == "₹40,50,869.93", "as filed, the quarter: 40,50,869.93 (%s)" % T(pg, "[data-qfiled-total]"))
    qa = T(pg, "[data-q3a]")
    ok("As filed: GSTR-1 + IFF ₹40,50,869.93 · 3B 3.1(a) ₹40,50,869.93 agrees" in qa.replace("\n", " "), "as filed, GSTR-1 + IFF = 3B 3.1(a) (%s)" % qa.replace("\n", " "))
    ok("3B 3.1(a), FinCom:" in qa and "agrees" in qa.split("As filed")[0], "FinCom's own working: IFF + IFF + GSTR-1 = its 3B 3.1(a)")
    q = E("(() => { const q = GSTQ.quarter('202506', '09'); return {c: q.cols.map(c => [c.n, c.taxable, c.state.s]), m3: [q.m3.n, q.m3.b2c, q.m3.taxable], total: q.total, r3a: q.r3a}; })()")
    print("    FinCom Q1:", q)
    st = pg.locator("#app [data-qtable] tbody tr:has-text('Status') td").all_inner_texts()
    ok("Filed" in st[1] and "13-05-2025" in st[1] and "Filed" in st[2] and "Filed" in st[3] and "3B filed" in st[4], "status: each filed, with its date (%s)" % [x.replace("\n", " ") for x in st])
    # what goes in this file, for the first IFF; file name and upload note
    pg.click('#app [data-gqcol="202504"]'); pg.wait_for_timeout(400)
    fb = T(pg, '[data-qfile="202504"]')
    ok("What goes in this file: IFF Apr-2025" in fb and "table 4A" in fb and "B2C" in fb and "Check against 3B 3.1(a)" in fb and "IFF_09AANFG3202D1ZR_042025.json" in fb and "Prepare offline → Upload" in fb,
       "what goes in the IFF file, the check against 3B 3.1(a), the portal file name and the upload note")
    pg.click('#app [data-gqcol="202506"]'); pg.wait_for_timeout(400)
    fb = T(pg, '[data-qfile="202506"]')
    ok("GSTR1_09AANFG3202D1ZR_062025.json" in fb and "Left out: what the filed IFFs of Apr-2025 and May-2025 carried" in fb, "the quarter's GSTR-1 leaves out what the filed IFFs carried; its file name")
    ok("GSTR3B_09AANFG3202D1ZR_062025.json" in T(pg, "[data-qrmp]") and "tables 3.1, 3.2, 4 and 5" in T(pg, "[data-qrmp]"), "the quarter's 3B file: tables 3.1, 3.2, 4 and 5, with PMT-06")
    # an IFF filed after the 13th counts as not filed: its documents go to the quarter's GSTR-1
    n0 = E("GSTQ.quarter('202506', '09').m3.n")
    E("() => { GSTF.rec('202505', '09').iff = '2025-06-20'; GSTR._carry = null; render(); }"); pg.wait_for_timeout(500)
    q2 = E("(() => { const q = GSTQ.quarter('202506', '09'); return [q.cols[1].state.s, q.m3.n, q.cols[1].n, q.diff]; })()")
    ok(q2[0] == "late" and q2[1] == n0 + q2[2] and abs(q2[3]) < 1, "an IFF filed on 20-Jun (after the 13th) counts as not filed: its %d invoices go in the GSTR-1 (%s)" % (q2[2], q2))
    st = pg.locator("#app [data-qtable] tbody tr:has-text('Status') td").all_inner_texts()
    ok("counts as not filed" in st[2], "and the status says so")
    # an ARN alone counts as filed
    E("() => { const r = GSTF.rec('202505', '09'); delete r.iff; r.iffArn = 'AA090625123456X'; GSTR._carry = null; render(); }"); pg.wait_for_timeout(400)
    ok(E("GSTQ.iffState('202505', '09').s") == "filed", "an IFF with its ARN counts as filed")
    # IFF not filed, on purpose
    pg.click('#app [data-gqcol="202504"]'); pg.wait_for_timeout(300)
    pg.click("#app [data-iffskip]"); pg.wait_for_timeout(500)
    q3 = E("(() => { const q = GSTQ.quarter('202506', '09'); return [q.cols[0].state.s, q.cols[0].toQuarter, q.diff]; })()")
    ok(q3[0] == "skipped" and q3[1] and abs(q3[2]) < 1, "“IFF not filed”: April's documents go in the quarter's GSTR-1, the total still agrees with 3.1(a) (%s)" % q3)
    pg.click('#app [data-iffskip="undo"]'); pg.wait_for_timeout(400)
    # filed by typing its date: its documents are recorded; a change since is flagged for 9A
    E("() => { const r = GSTF.rec('202504', '09'); delete r.iffDocs; }")
    pg.fill('#app input[aria-label="IFF filed on 202504"]', "2025-05-13"); pg.press('#app input[aria-label="IFF filed on 202504"]', "Tab"); pg.wait_for_timeout(500)
    nd = E("Object.keys(GSTF.peek('202504', '09').iffDocs || {}).length")
    ok(nd == q["c"][0][0], "filing the IFF records its %d documents" % nd)
    E("""() => { const k = Object.keys(GSTF.peek('202504', '09').iffDocs)[0]; GSTF.rec('202504', '09').iffDocs[k].txval += 1000; render(); }""")
    pg.wait_for_timeout(500)
    ch = T(pg, '[data-iff-changed="202504"]')
    ok("Changed after the IFF Apr-2025 was filed" in ch and "9A" in ch and "9C" in ch, "a document changed since its IFF: needs an amendment (9A/9C) (%s)" % ch[:120].replace("\n", " "))
    # ---- Q4 2025-26
    E(OPEN, "202603"); pg.wait_for_timeout(1500)
    fl = [T(pg, '[data-qfiled="%s"]' % m) for m in ("202601", "202602", "202603")]
    ok(fl == ["₹55,53,800.00", "₹7,56,300.00", "₹11,97,130.50"] and T(pg, "[data-qfiled-total]") == "₹75,07,230.50", "Q4 as filed: 55,53,800 + 7,56,300 + 11,97,130.50 = 75,07,230.50 (%s)" % fl)
    qa = T(pg, "[data-q3a]").replace("\n", " ")
    ok("3B 3.1(a) ₹75,07,230.50 agrees" in qa, "Q4: GSTR-1 + IFF = 3B 3.1(a) as filed (%s)" % qa)
    q4 = E("(() => { const q = GSTQ.quarter('202603', '09'); return {c: q.cols.map(c => [c.n, c.notes, c.taxable, c.over]), m3: [q.m3.n, q.m3.notes, q.m3.taxable], total: q.total, r3a: q.r3a, diff: q.diff}; })()")
    print("    FinCom Q4:", q4)
    ok(abs(q4["diff"]) < 1 and q4["c"][0][3], "Q4, FinCom: the January IFF is not cut at ₹50 lakh (a warning instead), and the total agrees with its 3.1(a)")
    # the filing type of one quarter
    E("() => { S.gstYm = '202512'; GSTQ.setQuarterType('202512', '09', 'monthly'); }")
    h = E("[GSTSet.typeOf('202510', '09'), GSTSet.typeOf('202512', '09'), GSTSet.typeOf('202601', '09'), GSTSet.typeOf('202509', '09')]")
    ok(h == ["monthly", "monthly", "qrmp", "qrmp"], "one quarter set to monthly: Q3 monthly, Q2 and Q4 still quarterly (%s)" % h)
    E("() => { GSTQ.setQuarterType('202512', '09', 'qrmp'); }")
    ok(E("JSON.stringify(GSTSet.history('09'))") == '[{"from":"202504","type":"qrmp"}]', "and back: one line in the history again")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
