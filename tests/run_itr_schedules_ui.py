"""python3 run_itr_schedules_ui.py - the Income Tax Return's Schedules step (app/src/screens/itr/Schedules.jsx) in the built
app, on the made-up client of tests/itr_demo.mjs with its schedules filled (withSchedules: a Form 16, a salary, a let-out
and a self-occupied house, sales of shares, a fund and a plot, the AIS's sale lines):
  1. Data lists the Form 16; Schedules shows each head's figure as the computation works it (salary 9,57,600 in the old
     regime, house property -1,06,400, the plot's tax above 20% with indexation ignored 2,93,630);
  2. an AIS sale line is offered and taken as a row; an employer is taken from the Form 16; a house and a sale are added
     and removed; Schedule FA opens its lists from the official schema when foreign assets are said;
  3. the Computation carries the heads; Checks has the schedules' group (Form 16, AIS against the schedules);
  4. ITR-6: Schedule SH and AL-1 drawn from the schema, OCI for an Ind AS company;
  5. desktop and phone; nothing wider than the screen; no page error.
ITR_SHOTS=<dir>: saves the design screenshots (deviceScaleFactor 2). Needs the schemas in the build (tools/itr-schemas.sh)."""
import os, sys, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("ITR_PORT") or 8393)
SHOTS = os.environ.get("ITR_SHOTS", "")
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out"))
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
def demo_of(form, name):
    p = os.path.join(OUT, name)
    subprocess.run(["node", os.path.join(HERE, "itr_demo.mjs"), p, form, "schedules"], check=True, stdout=subprocess.DEVNULL)
    return open(p).read()
D3 = demo_of("ITR-3", "itr-demo-sched3.json")
D6 = demo_of("ITR-6", "itr-demo-sched6.json")

SEED = """(pan) => { S.firm.firmName = "Demo Firm of Accountants";
  const c = newCompany({name: "Demo Client", pan}); S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true}; S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  S.books = {cid: c.id, loading: false, vouchers: [], ledgers: [], challans: [], alloc: {}, map: {}};
  Store.saveFirm(); Store.saveCompany(c); render(); return c.id; }"""
def start(pg, pan):
    pg.goto(URL); pg.wait_for_timeout(1200)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(500)
    pg.evaluate(SEED, pan); pg.wait_for_timeout(500)
def settle(pg, ms=400):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => document.querySelector('[data-itr]')", timeout=10000)
    except Exception: pass
    pg.wait_for_timeout(200)
def step(pg, t): pg.evaluate("(t) => goClient('books:' + t)", t); settle(pg)
def shot(pg, name, full=False):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True)
    pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
def text(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }", sel)
def count(pg, sel): return pg.evaluate("(s) => document.querySelectorAll(s).length", sel)
def fits(pg): return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")

def run3(br, phone):
    tag = "phone" if phone else "desktop"
    ctx = br.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1440, "height": 900}, device_scale_factor=2)
    ctx.add_init_script("window.__itrDemo = " + D3 + ";")
    pg = ctx.new_page(); perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    start(pg, "ZZZPX9999Z"); step(pg, "itr")
    ok("1 employer" in text(pg, "[data-itr-kind=form16]"), tag + ": Data lists the Form 16 (one employer)")
    pg.click("[data-itr-kind=form16] .itr-file-main"); pg.wait_for_timeout(200)
    ok("DELD99999D" in text(pg, "[data-itr-read=form16]") and "90,000" in text(pg, "[data-itr-read=form16]"), tag + ": the Form 16 opened shows the employer's TAN and TDS")
    step(pg, "itr-sch")
    ok(pg.query_selector("[data-itr-schedules]") is not None and pg.get_attribute("[data-itr-tab=itr-sch]", "data-on") == "1", tag + ": the Schedules step opens")
    ok("9,57,600" in text(pg, "[data-itr-head=salary]"), tag + ": salary 9,57,600 (old regime: HRA, standard deduction, professional tax)")
    ok("1,06,400" in text(pg, "[data-itr-head=hp]"), tag + ": house property -1,06,400 (the self-occupied interest at Rs 2 lakh)")
    ok("2,93,630" in text(pg, "[data-itr-sched=cg]"), tag + ": the plot's tax above 20% with indexation ignored, 2,93,630")
    ok(pg.query_selector("[data-itr-sched=losses]") is not None, tag + ": losses of earlier years can be entered (71B, 74)")
    shot(pg, "sch-1-schedules-" + tag, full=True)
    pg.click("[data-itr-item=sale-2] .itr-file-main"); pg.wait_for_timeout(200)
    t = text(pg, "[data-itr-item=sale-2]")
    ok("with indexation 6,56,849" in t and "34,00,000" in t, tag + ": the plot opened: gain 34,00,000, with indexation 6,56,849")
    ok("20% with indexation 1,31,370" in t and "2,93,630 ignored" in t, tag + ": the proviso per property: 12.5% 4,25,000 against 20% with indexation 1,31,370, 2,93,630 ignored")
    ok(pg.query_selector("[data-itr-item=sale-2] [data-itr-in=residential]") is not None, tag + ": a land sale can be marked a residential house (section 54)")
    shot(pg, "sch-2-sale-open-" + tag, full=True)
    pg.click("[data-itr-item=sale-2] .itr-file-main"); pg.wait_for_timeout(150)
    # the AIS's securities line offered and taken
    n0 = count(pg, "[data-itr-item^=sale-]"); o0 = count(pg, "[data-itr-take-ais]")
    ok(pg.query_selector("[data-itr-ais-offer]") is not None, tag + ": the AIS's sale of securities is offered as a sale")
    pg.click("[data-itr-take-ais]"); settle(pg, 300)
    ok(count(pg, "[data-itr-item^=sale-]") == n0 + 1 and count(pg, "[data-itr-take-ais]") == o0 - 1, tag + ": taken as a sale, the offer goes")
    pg.click("[data-itr-item=sale-%d] [data-itr-remove-item]" % n0) if pg.query_selector("[data-itr-item=sale-%d] [data-itr-remove-item]" % n0) else (pg.click("[data-itr-item=sale-%d] .itr-file-main" % n0), pg.wait_for_timeout(150), pg.click("[data-itr-item=sale-%d] [data-itr-remove-item]" % n0))
    settle(pg, 300)
    ok(count(pg, "[data-itr-item^=sale-]") == n0, tag + ": a sale removed")
    # an employer from Form 16: remove the salary, then take it again
    pg.click("[data-itr-item=salary-0] .itr-file-main"); pg.wait_for_timeout(150)
    pg.click("[data-itr-item=salary-0] [data-itr-remove-item]"); settle(pg, 300)
    ok(pg.query_selector("[data-itr-take-f16=DELD99999D]") is not None, tag + ": the Form 16 is offered once the employer is not in Schedule S")
    pg.click("[data-itr-take-f16=DELD99999D]"); settle(pg, 300)
    ok("from Form 16" in text(pg, "[data-itr-item=salary-0]"), tag + ": the employer taken from the Form 16")
    if pg.query_selector("[data-itr-item=salary-0] [data-itr-in=nature]") is None: pg.click("[data-itr-item=salary-0] .itr-file-main"); pg.wait_for_timeout(150)
    ok(pg.eval_on_selector("[data-itr-item=salary-0] [data-itr-in=nature]", "e => e.value") == "", tag + ": the kind of employer is not assumed from Form 16 (asked)")
    pg.select_option("[data-itr-item=salary-0] [data-itr-in=nature]", "OTH"); settle(pg, 300)
    # a house added and opened
    pg.click("[data-itr-add-house]"); settle(pg, 300)
    pg.click("[data-itr-item=house-2] .itr-file-main"); pg.wait_for_timeout(150)
    pg.fill("[data-itr-item=house-2] [data-itr-in=rent]", "240000"); settle(pg, 300)
    ok("1,68,000" in text(pg, "[data-itr-item=house-2]"), tag + ": a let-out house with rent 2,40,000: income 1,68,000 (30% off)")
    shot(pg, "sch-3-house-added-" + tag, full=True)
    pg.click("[data-itr-item=house-2] [data-itr-remove-item]"); settle(pg, 300)
    # Schedule FA from the schema
    pg.select_option("[data-itr-sched=fa] select", "YES"); settle(pg, 400)
    ok(pg.query_selector("[data-itr-list=DetailsForiegnBank]") is not None, tag + ": Schedule FA's lists, drawn from the official schema")
    pg.click("[data-itr-list-add=DetailsForiegnBank]"); settle(pg, 300)
    ok(count(pg, "[data-itr-list=DetailsForiegnBank] .itr-subrow input, [data-itr-list=DetailsForiegnBank] .itr-subrow select") >= 8, tag + ": a foreign bank account row with the schema's fields")
    shot(pg, "sch-4-foreign-assets-" + tag, full=True)
    ok(fits(pg), tag + ": Schedules fits the width")
    step(pg, "itr-comp")
    ok(pg.query_selector("[data-itr-line=salary]") is not None and pg.query_selector("[data-itr-line=hp]") is not None and pg.query_selector("[data-itr-line=cg]") is not None, tag + ": the Computation carries salary, house property and capital gains")
    ok(pg.get_attribute("[data-itr-agree]", "data-itr-agree") == "1", tag + ": checked twice")
    shot(pg, "sch-5-computation-" + tag, full=True)
    step(pg, "itr-checks")
    pg.click("[data-itr-show]"); settle(pg, 200)
    ok(pg.query_selector("[data-itr-group=sch]") is not None, tag + ": Checks has the schedules' group")
    ok(pg.query_selector("[data-itr-check=f16_salary]") is not None and pg.query_selector("[data-itr-check=ais_cg_prop]") is not None, tag + ": Form 16 and the AIS sale of property checked against the schedules")
    pg.click("[data-itr-check=ais_cg_prop] .itr-check-main"); pg.wait_for_timeout(200)
    shot(pg, "sch-6-checks-" + tag, full=True)
    ok(fits(pg), tag + ": Checks fit the width")
    ok(not perr, tag + ": no page error" + (": " + perr[0][:200] if perr else ""))
    ctx.close()

def run6(br, phone):
    tag = "phone" if phone else "desktop"
    ctx = br.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1440, "height": 900}, device_scale_factor=2)
    ctx.add_init_script("window.__itrDemo = " + D6 + "; (function(){ const s = window.__itrDemo.booksObj.itr['2026|state']; s.profile = Object.assign({}, s.profile, { indAs: true, listed: false }); s.salaries = []; })();")
    pg = ctx.new_page(); perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    start(pg, "ZZZCX9999Z"); step(pg, "itr-sch")
    ok(pg.query_selector("[data-itr-sched=salary]") is None, tag + ": ITR-6: no salary schedule")
    ok(pg.query_selector("[data-itr-list=DtlsSHEndPreviousYearUC]") is not None, tag + ": ITR-6: Schedule SH-1 drawn from the schema")
    pg.click("[data-itr-list-add=DtlsSHEndPreviousYearUC]"); settle(pg, 300)
    ok(count(pg, "[data-itr-list=DtlsSHEndPreviousYearUC] .itr-subrow select") >= 2, tag + ": a shareholder row with its choices (residential status, type of share)")
    ok(pg.query_selector("[data-itr-sched=al6]") is not None and pg.query_selector("[data-itr-sched=oci]") is not None, tag + ": AL-1, and other comprehensive income for an Ind AS company")
    shot(pg, "sch-7-company-" + tag, full=True)
    ok(fits(pg), tag + ": fits the width")
    ok(not perr, tag + ": no page error" + (": " + perr[0][:200] if perr else ""))
    ctx.close()

with sync_playwright() as p:
    br = p.chromium.launch()
    for ph in (False, True): run3(br, ph)
    for ph in (False, True): run6(br, ph)
    br.close()
srv.shutdown()
print(("%d FAILED" % len(fails)) if fails else "all passed")
sys.exit(1 if fails else 0)
