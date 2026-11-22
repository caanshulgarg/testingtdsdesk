"""python3 tests/run_payroll_flex_ui.py - flexible payroll (next-payroll, docs/PAYROLL.md) in the built app (app/dist-test), on
made-up books and sheets (tests/payroll_sheets.mjs), FinCom's AI mocked (window.SheetAI.map, recording every call):
  1. the method: unset, FinCom reads Tally Payroll from the books, the owner sets Journal
  2. the first upload of a new layout: the AI is asked once (at most 3 rows, names masked), the mapping shown to confirm
  3. saved: the sheet read, the payroll journal previewed by Daily Check's own builder (Dr salary; Cr TDS, PT, PF, ESI,
     salary payable)
  4. the next upload of that layout: "Read by your saved layout · no AI", the AI not called again
  5. manual entry: rows typed, running totals, a row that does not add up marked
  6. Tally Payroll: the voucher previewed, "Needs your OK", its XML on opening; no Bridge.post anywhere
  7. a phone (390 px): no sideways scroll
Screenshots (deviceScaleFactor 2, desktop 1440 and phone 390) into SHOTS (default scratchpad/shots-payroll). UI_PORT (8476)."""
import os, sys, json, subprocess, threading, functools, http.server, tempfile
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UI_PORT") or 8476)
SHOTS = os.environ.get("SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
# the made-up books (the engine's own shape, from nightinput's booksOf) and the four sheets
JS = """
import { booksOf } from "../server/assistant-night/nightinput.js";
import { gstRows } from "./daily2_books.mjs";
import * as SH from "./payroll_sheets.mjs";
const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" };
const b = booksOf(gstRows({ ym: "202610", filed: "", extraLedgers: PL }));
process.stdout.write(JSON.stringify({ books: b, sheets: { A: SH.A, A_NOV: SH.A_NOV, B: SH.B, C: SH.C, D: SH.D }, ai: SH.AI_ANSWERS }));
"""
DATA = json.loads(subprocess.run(["node", "--input-type=module", "-e", JS], cwd=HERE, capture_output=True, text=True, check=True).stdout)
tmp = tempfile.mkdtemp(prefix="payroll-ui-")
FILES = {}
for k, v in DATA["sheets"].items():
    FILES[k] = os.path.join(tmp, {"A": "salary-oct.csv", "A_NOV": "salary-nov.csv"}.get(k, k + ".csv"))
    open(FILES[k], "w").write(v)
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SEED = """([data, role]) => { S.firm.firmName = "Sample & Co";
  const co = newCompany({name: "Sample Traders Pvt Ltd"}); co.id = "c1"; co.stats = {}; S.companies.c1 = co; S.data.c1 = {parties: {}, entries: {}, loaded: true};
  S.coId = "c1"; S.account = {me: {role, name: "Made-up Person"}};
  window.__pr = {ai: [], saved: 0, posts: 0, toasts: []};
  const b = data.books; b.cid = "c1"; b.salary = [];
  b.payroll = {book: "b1", at: "", employees: ["Ravi Kumar", "Asha Verma", "Mehta, Sunil", "Old Leaver"].map((name, i) => ({guid: "e" + i, name, parent: "Staff", category: "Primary Cost Category", group: false, pan: "", joined: "", left: "", designation: "", gone: i === 3})),
    heads: {"Basic Pay": {type: "Earnings for Employees", stat: "", it: ""}, "HRA": {type: "Earnings for Employees", stat: "", it: ""}, "Special Allowance": {type: "Earnings for Employees", stat: "", it: ""},
      "Income Tax": {type: "Deductions from Employees", stat: "Income Tax", it: ""}, "Professional Tax": {type: "Deductions from Employees", stat: "Professional Tax", it: ""},
      "PF Employee 12%": {type: "Employees' Statutory Deductions", stat: "PF Account (A/c No. 1)", it: ""}, "ESI Employee": {type: "Employees' Statutory Deductions", stat: "Employee State Insurance", it: ""},
      "PF Employer": {type: "Employer's Statutory Contributions", stat: "", it: ""}},
    allocs: [{guid: "pv1", day: "2026-09-30", head: "Basic Pay", employee: "Ravi Kumar", amt: -25000}], pays: [], vouchers: {pv1: {alter: 1, day: "2026-09-30", type: "Payroll", no: "1"}}};
  S.books = b;
  Cloud.on = () => false;
  window.saveBooks = async () => { window.__pr.saved++; };
  const sc = Store.saveCompany; Store.saveCompany = (c) => { window.__pr.co = JSON.parse(JSON.stringify({payrollMethod: c.payrollMethod, payrollFormats: c.payrollFormats, payrollJournal: c.payrollJournal})); try { sc.call(Store, c); } catch (e) {} };
  window.loadRegisters = async () => {};
  const ans = data.ai;
  window.SheetAI = {map: async (req) => { window.__pr.ai.push(req); const k = Object.keys(ans).find((x) => (ans[x].map.name && req.head.includes(ans[x].map.name)) && Object.values(ans[x].map).every((c) => req.head.includes(c)) && (ans[x].earn || []).every((c) => req.head.includes(c)) && req.head.length === new Set(req.head).size);
    return Object.assign({ok: true}, ans[k] || {map: {}}); }};
  window.Bridge = Object.assign(window.Bridge || {}, {post: async () => { window.__pr.posts++; return {ok: true, results: []}; }});
  const t0 = window.toast; window.toast = (m) => { window.__pr.toasts.push(String(m)); try { t0 && t0(m); } catch (e) {} };
  S.view = "company"; S.tab = "books"; S.booksTab = "payroll"; S.step = null; S.loadingCo = false; render(); return true; }"""
def settle(pg, ms=450):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('[data-loading-page], .react-loading')", timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(150)
def shot(pg, name, kind):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True)
    # the whole page in one viewport (a full-page capture stitches the sticky header into the middle)
    vp = pg.viewport_size; h = pg.evaluate("() => Math.max(document.scrollingElement.scrollHeight, document.querySelector('main') ? document.querySelector('main').scrollHeight + 160 : 0)")
    pg.set_viewport_size({"width": vp["width"], "height": max(vp["height"], min(int(h), 4000))}); pg.evaluate("() => window.scrollTo(0, 0)"); pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(SHOTS, "%s-%s.png" % (name, kind)))
    pg.set_viewport_size(vp)
def noside(pg): return pg.evaluate("() => document.scrollingElement.scrollWidth <= window.innerWidth + 1")
def run(br, w, kind):
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    P = lambda: pg.evaluate("() => window.__pr")
    # 1. the method
    ok(pg.locator("[data-method=unset]").count() == 1 and pg.locator("[data-detected=tally]").count() == 1 and "1 payroll entry in Tally, 3 employees" in pg.inner_text("[data-detected]"), kind + " 1. unset: FinCom reads Tally Payroll from the books, to confirm")
    shot(pg, "1-method", kind)
    pg.click("[data-pick=journal]"); settle(pg, 250)
    ok(P()["co"]["payrollMethod"]["value"] == "journal" and pg.locator("[data-method=journal]").count() == 1, kind + " 1. the owner sets Journal (kept on the client)")
    # 2. a new layout
    pg.set_input_files("[data-sheet-in]", FILES["A"]); pg.wait_for_selector("[data-step=map] [data-save-rule]", timeout=10000); settle(pg, 300)
    a = P()["ai"]
    ok(len(a) == 1 and len(a[0]["rows"]) <= 3 and a[0]["side"] == "payroll" and "Ravi" not in json.dumps(a[0]) and "ABCPK1234F" not in json.dumps(a[0]), kind + " 2. a new layout: the AI asked once, 3 rows at most, names and PANs masked")
    ok(pg.input_value("[data-col=grosssalary] select") == "gross" and pg.input_value("[data-col=hra] select") == "earn" and pg.input_value("[data-col=month] select") == "month", kind + " 2. its mapping shown to confirm (Gross Salary = gross, HRA an earning, Month)")
    pg.click("[data-more=ai-saw] .pr-more-btn"); settle(pg, 150)
    shot(pg, "2-new-layout-ai-mapping", kind)
    pg.click("[data-save-rule]"); pg.wait_for_selector("[data-step=read]", timeout=10000); settle(pg, 400)
    ok(len(P()["co"]["payrollFormats"]) == 1, kind + " 3. saved as the client's rule")
    ok("Oct 2026" in pg.inner_text("[data-step=read]") and "₹85,838.71" in pg.inner_text("[data-step=read]") and "Adds up" in pg.inner_text("[data-step=read]"), kind + " 3. read: Oct 2026, gross ₹85,838.71, adds up")
    jp = pg.inner_text("[data-preview=journal]")
    ok("Salary Payable" in jp and "₹78,255.71" in jp and "TDS on Salary 192" in jp and "PF Payable" in jp and "Daily Check" in jp, kind + " 3. the payroll journal preview: the existing builder's lines")
    pg.click("[data-more=employees] .pr-more-btn"); settle(pg, 150)
    shot(pg, "5-journal-preview", kind)
    pg.click("[data-keep]"); settle(pg, 300)
    ok(P()["saved"] == 1, kind + " 3. kept with the books (b.salary, for Daily Check and 24Q)")
    # 4. the next upload of that layout: the rule
    pg.set_input_files("[data-sheet-in]", FILES["A_NOV"]); pg.wait_for_selector("[data-how=rule]", timeout=10000); settle(pg, 400)
    ok(len(P()["ai"]) == 1 and "Read by your saved layout" in pg.inner_text("[data-how=rule]") and "no AI" in pg.inner_text("[data-how=rule]") and "Nov 2026" in pg.inner_text("[data-how=rule]"), kind + " 4. next upload: read by the saved layout, no AI call")
    shot(pg, "3-rule-recognised", kind)
    # 5. manual entry
    pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    f = lambda i, k, v: pg.fill("[data-entry-row='%d'] input[aria-label='%s row %d']" % (i, k, i + 1), v)
    f(0, "Employee", "Ravi Kumar"); f(0, "Days", "31"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); f(0, "TDS", "1,500"); f(0, "PT", "200"); f(0, "PF", "1,800")
    pg.click("[data-add-row]"); f(1, "Employee", "Asha Verma"); f(1, "Days", "31"); f(1, "Basic", "15,000"); f(1, "HRA", "6,000"); f(1, "PT", "200"); f(1, "PF", "1,800")
    pg.click("[data-add-row]"); f(2, "Employee", "Mehta, Sunil"); f(2, "Days", "14"); f(2, "Basic", "8,000"); f(2, "PT", "0"); pg.fill("input[aria-label='Net row 3']", "7,900")
    settle(pg, 200)
    tot = pg.inner_text("[data-totals]")
    ok("₹48,000" in tot and "₹35,000" in pg.inner_text("[data-step=manual]") or "₹48,000" in tot, kind + " 5. manual: running totals (Basic ₹48,000)")
    ok(pg.locator("[data-entry-row='2'] .pr-bad").count() == 1 and pg.locator("[data-manual-done]").is_disabled(), kind + " 5. a row whose net is not gross − deductions is marked; Use these waits")
    shot(pg, "4-manual-entry", kind)
    pg.fill("input[aria-label='Net row 3']", ""); settle(pg, 200)
    ok(pg.locator("[data-entry-row='2'] .pr-ok").count() == 1 and not pg.locator("[data-manual-done]").is_disabled(), kind + " 5. net left to FinCom: it adds up")
    # 6. Tally Payroll
    pg.click("[data-pick=tally]"); settle(pg, 250)
    pg.click("[data-manual-done]"); settle(pg, 300)
    pg.set_input_files("[data-sheet-in]", FILES["A"]); pg.wait_for_selector("[data-preview=tally]", timeout=10000); settle(pg, 300)
    tp = pg.inner_text("[data-preview=tally]")
    ok("Needs your OK" in tp and "waits for your OK" in tp and len(P()["ai"]) == 1, kind + " 6. Tally Payroll: the voucher preview, Needs your OK (read by the rule, no AI)")
    ok(pg.locator("[data-preview=tally] select").count() == 1 and "Gross" not in tp, kind + " 6. Basic has no same-named pay head: the owner picks it")
    pg.select_option("[data-preview=tally] select", "Basic Pay"); settle(pg, 300)
    tp = pg.inner_text("[data-preview=tally]")
    ok("3 employees · net ₹78,255.71 to Salary Payable" in tp, kind + " 6. the voucher: 3 employees, net ₹78,255.71 to Salary Payable")
    pg.click("[data-preview=tally] [data-more^=emp-] .pr-more-btn"); pg.click("[data-preview=tally] [data-more^=xml-] .pr-more-btn"); settle(pg, 200)
    x = pg.inner_text("[data-xml]")
    ok('OBJVIEW="PaySlip Voucher View"' in x and "<EMPLOYEENAME>Mehta, Sunil</EMPLOYEENAME>" in x and "The exact shape" in tp + pg.inner_text("[data-preview=tally]"), kind + " 6. the XML on opening, the spec's shape")
    shot(pg, "6-tally-payroll-needs-ok", kind)
    pg.click("[data-journal-once]"); settle(pg, 300)
    ok(pg.locator("[data-preview=journal]").count() == 1 and "As a journal this month" in pg.inner_text("[data-preview=journal]") and P()["co"]["payrollJournal"].get("202610"), kind + " 6. Post as a journal this month: the journal instead, kept for Oct 2026")
    ok(P()["posts"] == 0, kind + " no Bridge.post: nothing posted from this page")
    if w < 600: ok(noside(pg), kind + " 7. no sideways scroll")
    ctx.close()
with sync_playwright() as p:
    br = p.chromium.launch()
    run(br, 1440, "desktop")
    run(br, 390, "phone")
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
