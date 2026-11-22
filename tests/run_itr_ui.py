"""python3 run_itr_ui.py - the Income Tax Return page (app/src/screens/itr) in the built app, on the made-up client of
tests/itr_demo.mjs (window.__itrDemo: made-up books and the made-up portal files of tests/fixtures/itr):
  1. Data: the files brought in are listed with what was read; a file brought in through the page is read and listed;
     another client's file is refused naming its PAN; the same file again changes nothing;
  2. Computation: the CA's sheet, a line opened shows the ledgers behind it, "Checked twice", the PDF and the Excel;
  3. Checks: Matched / Difference / Missing / Needs you; a difference opened shows both sides and their sources; it is
     accepted only with a note;
  4. JSON: not offered while anything is open; once everything is matched, accepted or answered and the schema's
     questions are answered, the JSON is offered, and the file downloaded passes the official schema (ajv);
  5. on a phone's width every step fits (no sideways scroll); no page error anywhere.
ITR_SHOTS=<dir>: also saves the design screenshots there (deviceScaleFactor 2, 1440 and 390 wide).
Needs the schemas in app/public/itr-schema before the build (tools/itr-schemas.sh). Run on app/dist-test or TDSDESK_SITE."""
import os, sys, json, subprocess, threading, functools, http.server, tempfile
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("ITR_PORT") or 8391)
SHOTS = os.environ.get("ITR_SHOTS", "")
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out"))
FX = os.path.join(HERE, "fixtures", "itr")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
os.makedirs(OUT, exist_ok=True)
DEMO = os.path.join(OUT, "itr-demo.json")
subprocess.run(["node", os.path.join(HERE, "itr_demo.mjs"), DEMO], check=True, stdout=subprocess.DEVNULL)
demo = open(DEMO).read()
ok(os.path.exists(os.path.join(SITE, "itr-schema", "ITR-3_2026_Main_V1.1.json")), "the official schemas are in the build (itr-schema/)")

SEED = """() => { S.firm.firmName = "Demo Firm of Accountants";
  const c = newCompany({name: "Demo Traders", pan: "ZZZPX9999Z"}); S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true}; S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  S.books = {cid: c.id, loading: false, vouchers: [], ledgers: [], challans: [], alloc: {}, map: {}};
  Store.saveFirm(); Store.saveCompany(c); render(); return c.id; }"""
def start(pg):
    pg.goto(URL); pg.wait_for_timeout(1200)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(500)
    pg.evaluate(SEED); pg.wait_for_timeout(500)
def settle(pg, ms=500):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => document.querySelector('[data-itr]') && !document.querySelector('[data-itr-json=loading]')", timeout=10000)
    except Exception: pass
    pg.wait_for_timeout(200)
def step(pg, t): pg.evaluate("(t) => goClient('books:' + t)", t); settle(pg)
def shot(pg, name, full=False):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True)
    pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
def text(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }", sel)
def fits(pg): return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
def tmpfile(name, body):
    d = tempfile.mkdtemp(dir=OUT); p = os.path.join(d, name); open(p, "w").write(body); return p

def run(br, phone):
    tag = "phone" if phone else "desktop"
    ctx = br.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1440, "height": 900}, device_scale_factor=2, accept_downloads=True)
    ctx.add_init_script("window.__itrDemo = " + demo + ";")
    pg = ctx.new_page(); perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    start(pg); step(pg, "itr")
    ok(pg.query_selector("[data-itr]") is not None, tag + ": the Income tax return page opens")
    ok("ITR-3" in text(pg, ".itr-head") and "AY 2026-27" in text(pg, ".itr-head"), tag + ": ITR-3, AY 2026-27 in the heading")
    ok(pg.get_attribute("[data-itr-kind=ais]", "data-in") == "1" and pg.get_attribute("[data-itr-kind=tis]", "data-in") == "0", tag + ": AIS in, TIS not yet")
    shot(pg, "1-data-" + tag)
    # bring in the TIS through the page
    pg.set_input_files("[data-itr-file]", os.path.join(FX, "tis-demo.json")); pg.wait_for_timeout(900)
    ok("TIS brought in" in text(pg, "[data-itr-said]") and pg.get_attribute("[data-itr-kind=tis]", "data-in") == "1", tag + ": a TIS brought in through the page is read and listed")
    wrong = tmpfile("ais-other.json", open(os.path.join(FX, "ais-demo.json")).read().replace("ZZZPX9999Z", "ZZZPY8888Y"))
    pg.set_input_files("[data-itr-file]", wrong); pg.wait_for_timeout(900)
    said = text(pg, "[data-itr-said]")
    ok("ZZZPY8888Y" in said and "Other Demo Client" in said, tag + ": another client's AIS is refused, saying whose: " + said[:160])
    pg.set_input_files("[data-itr-file]", os.path.join(FX, "tis-demo.json")); pg.wait_for_timeout(700)
    ok("Already in" in text(pg, "[data-itr-said]"), tag + ": the same TIS again changes nothing")
    ecr = tmpfile("ECR-06-2025.txt", open(os.path.join(FX, "ECR-04-2025.txt")).read())
    pg.set_input_files("[data-itr-file]", ecr); pg.wait_for_timeout(800)
    ok("names no PAN" in text(pg, "[data-itr-said]") and pg.query_selector("[data-itr-confirm]") is not None, tag + ": an ECR naming no PAN or code waits for the person to say whose it is")
    pg.click("[data-itr-confirm]"); pg.wait_for_timeout(800)
    ok("brought in" in text(pg, "[data-itr-said]"), tag + ": confirmed, it is brought in")
    shot(pg, "2-uploads-refused-" + tag)
    pg.click("[data-itr-kind=ais] .itr-file-main"); pg.wait_for_timeout(300)
    t = text(pg, "[data-itr-read=ais]")
    ok("Interest" in t and "60,400" in t, tag + ": the AIS opened shows what was read (interest 60,400)")
    shot(pg, "3-uploads-read-" + tag, full=True)
    pg.click("[data-itr-kind=ecr] .itr-file-main"); pg.wait_for_timeout(300)
    ok("04-2025" in text(pg, "[data-itr-read=ecr]"), tag + ": the PF ECRs by month")
    ok(fits(pg), tag + ": Data fits the width")
    # 2. computation
    step(pg, "itr-comp")
    ok(pg.query_selector("[data-itr-line=pgbp]") is not None and "Computation of Income" in text(pg, "[data-itr-sheet]"), tag + ": the Computation of Income")
    ok(pg.get_attribute("[data-itr-agree]", "data-itr-agree") == "1", tag + ": checked twice (the second computation agrees)")
    pg.click("[data-itr-line='add:36va']"); pg.wait_for_timeout(200)
    ok("PF 04-2025" in text(pg, "[data-itr-trace='add:36va']"), tag + ": a line opened shows what is behind it (the PF month paid late)")
    pg.click("[data-itr-line='add:dep_book']"); pg.wait_for_timeout(200)
    ok("DEPRECIATION" in text(pg, "[data-itr-trace='add:dep_book']"), tag + ": book depreciation shows its ledger")
    shot(pg, "4-computation-" + tag, full=True)
    ok(fits(pg), tag + ": Computation fits the width")
    if not phone:
        with ctx.expect_page() as pinfo: pg.click("[data-itr-pdf]")
        pdf = pinfo.value; pdf.wait_for_load_state(); ok("Computation of Income" in pdf.content() and "Refund due" in pdf.content(), "the PDF view of the computation"); pdf.close()
        try:
            with pg.expect_download(timeout=15000) as d: pg.click("[data-itr-xlsx]")
            ok(d.value.suggested_filename.endswith(".xlsx"), "the Excel of the computation downloads: " + d.value.suggested_filename)
        except Exception as e: ok(False, "the Excel of the computation downloads (" + str(e)[:120] + ")")
    # 3. checks
    step(pg, "itr-checks")
    counts = {k: pg.get_attribute("[data-itr-count=%s]" % k, "data-itr-count") for k in ["matched", "difference", "missing", "needs"]}
    tally = text(pg, "[data-itr-tally]")
    ok("matched" in tally and "difference" in tally and "missing data" in tally and "needs you" in tally, tag + ": the report counts Matched / Difference / Missing / Needs you: " + tally.replace("\n", " ")[:120])
    shot(pg, "5-checks-" + tag, full=True)
    pg.click("[data-itr-check=ais_interest] .itr-check-main"); pg.wait_for_timeout(200)
    t = text(pg, "[data-itr-more-of=ais_interest]")
    ok("52,000" in t and "60,400" in t and "AIS" in t and "books" in t, tag + ": a difference opened shows both sides and their sources")
    shot(pg, "6-difference-open-" + tag, full=not phone)
    pg.click("[data-itr-accept=ais_interest]"); pg.wait_for_timeout(200)
    ok("note" in text(pg, "[data-itr-more-of=ais_interest]").lower() and pg.get_attribute("[data-itr-check=ais_interest]", "data-accepted") == "0", tag + ": not accepted without a note")
    ok(fits(pg), tag + ": Checks fit the width")
    # a 43B due whose payment date the books do not show: asked on its own row; the answer changes the computation
    pg.evaluate("""() => { window.__itrDemo.books.dues43B.push({ id: '43b:DEMO BONUS PAYABLE', ledger: 'DEMO BONUS PAYABLE', kind: 'bonus', role: '', kind43B: true, opening: 0, charge: 25000, chargeKnown: true,
      closing: 25000, paid: 0, dates: [], unpaid: 25000, part: 1, dis: 25000, unknown: true, unknownShare: false, trace: [] }); }""")
    step(pg, "itr-comp"); step(pg, "itr-checks")
    pg.click("[data-itr-check='43b_unknown'] .itr-check-main"); pg.wait_for_timeout(200)
    ok(pg.query_selector("[data-itr-answer='43b:DEMO BONUS PAYABLE']") is not None and pg.query_selector("[data-itr-accept='43b_unknown']") is None, tag + ": a 43B due with no payment date is asked on its own row (date or Not paid), and cannot be noted away")
    shot(pg, "9-payment-date-" + tag)
    pg.fill("[data-itr-answer='43b:DEMO BONUS PAYABLE'] input", "2026-08-15"); settle(pg, 300)
    ok(pg.query_selector("[data-itr-check='43b_unknown']") is None, tag + ": answered 15-08-2026 (by the due date): the question closes")
    step(pg, "itr-comp")
    ok(pg.query_selector("[data-itr-line='add:43b']") is None, tag + ": paid in time: nothing added back under 43B")
    pg.evaluate("() => { const b = window.__itrDemo.booksObj.itr['2026|state']; b.paidOn = { '43b:DEMO BONUS PAYABLE': 'none' }; }")
    step(pg, "itr-checks"); step(pg, "itr-comp")
    ok("25,000" in text(pg, "[data-itr-line='add:43b']"), tag + ": answered Not paid: 25,000 added back under 43B")
    step(pg, "itr-checks")
    # 4. JSON, blocked
    step(pg, "itr-json")
    ok(pg.query_selector("[data-itr-json=blocked]") is not None and pg.query_selector("[data-itr-download]") is None, tag + ": the JSON is not offered while checks are open")
    shot(pg, "7-json-blocked-" + tag)
    if True:
        # every open check accepted or answered with a note, then the schema's questions answered
        step(pg, "itr-checks")
        for _ in range(40):
            ids = pg.evaluate("() => [...document.querySelectorAll('[data-itr-check][data-accepted=\"0\"]')].filter((e) => e.dataset.status !== 'matched').map((e) => e.dataset.itrCheck)")
            if not ids: break
            cid = ids[0]
            if not pg.query_selector("[data-itr-note='%s']" % cid) and not pg.query_selector("[data-itr-answers='%s']" % cid): pg.click("[data-itr-check='%s'] .itr-check-main" % cid); pg.wait_for_timeout(150)
            # a payment date asked item by item is answered (here: Not paid), never noted away
            if pg.query_selector("[data-itr-answers='%s']" % cid):
                for b in pg.query_selector_all("[data-itr-answers='%s'] [data-itr-notpaid]" % cid): b.click(); pg.wait_for_timeout(150)
                continue
            if not pg.query_selector("[data-itr-note='%s']" % cid): ok(False, "check " + cid + " cannot be accepted"); break
            pg.fill("[data-itr-note='%s']" % cid, "Made-up demo: reviewed, reason noted (" + cid + ")"); pg.click("[data-itr-accept='%s']" % cid); pg.wait_for_timeout(200)
        ok(pg.query_selector("[data-itr-allclear]") is not None, tag + ": every check matched, accepted or answered")
        step(pg, "itr-json")
        asks = pg.evaluate("() => [...document.querySelectorAll('[data-itr-ask]')].map((e) => e.dataset.itrAsk)")
        ok(len(asks) > 0, tag + ": the schema's own questions are asked (%d), not assumed" % len(asks))
        for a in asks:
            sel = "[data-itr-ask='%s'] select" % a
            if pg.query_selector(sel):
                opts = pg.evaluate("(s) => [...document.querySelector(s).options].map((o) => o.value).filter(Boolean)", sel)
                pick = "N" if "N" in opts else "NO" if "NO" in opts else "RES" if "RES" in opts else opts[0]
                pg.select_option(sel, pick)
            else: pg.fill("[data-itr-ask='%s'] input" % a, "2026-11-25")
            pg.wait_for_timeout(120)
        settle(pg)
        if not pg.query_selector("[data-itr-json=ready]"): print("    gate: " + text(pg, "[data-itr-json]").replace("\n", " | ")[:400] + " || " + pg.evaluate("() => { const d = document.querySelector('[data-itr-schema-errors]'); if (!d) return ''; return d.textContent; }") + " || asks left: " + str(pg.evaluate("() => [...document.querySelectorAll('[data-itr-ask]')].map((e) => e.dataset.itrAsk)")))
        ok(pg.query_selector("[data-itr-json=ready]") is not None and pg.query_selector("[data-itr-ready]") is not None, tag + ": with everything settled the JSON is offered")
        shot(pg, "8-json-ready-" + tag)
        if not pg.query_selector("[data-itr-download]"): raise SystemExit(1)
        with pg.expect_download() as d1: pg.click("[data-itr-download]")
        p1 = os.path.join(OUT, "itr-ui-download-" + tag + ".json"); d1.value.save_as(p1)
        r = subprocess.run(["node", os.path.join(HERE, "itr_validate.mjs"), "ITR-3", p1], capture_output=True, text=True)
        ok(r.returncode == 0, tag + ": the downloaded JSON passes the official schema (ajv): " + (r.stdout + r.stderr).strip()[:200])
        ok(fits(pg), tag + ": JSON fits the width")
        ok(pg.query_selector("[data-itr-versions]") is not None, tag + ": the JSON made is kept as a version")
    # phone: the JSON step once settled, as the desktop left it in this demo's store (each context is fresh: blocked)
    ok(not [e for e in perr if "supabase" not in e.lower()], tag + ": no page error (" + "; ".join(perr)[:300] + ")")
    ctx.close()

with sync_playwright() as p:
    br = p.chromium.launch()
    run(br, False); run(br, True)
    br.close()
srv.shutdown()
print(("%d FAILED" % len(fails)) if fails else "all passed")
sys.exit(1 if fails else 0)
