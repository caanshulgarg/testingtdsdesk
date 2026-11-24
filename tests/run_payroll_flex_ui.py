"""python3 tests/run_payroll_flex_ui.py - flexible payroll (next-payroll, docs/PAYROLL.md) in the built app (app/dist-test), on
made-up books and sheets (tests/payroll_sheets.mjs), FinCom's AI mocked (window.SheetAI.map, recording every call):
  1. the method: unset, FinCom reads Tally Payroll from the books, the owner sets Journal
  2. the first upload of a new layout: the AI is asked once (at most 3 rows, names masked), the mapping shown to confirm
  3. saved: the sheet read, the payroll journal previewed by Daily Check's own builder (Dr salary; Cr TDS, PT, PF, ESI,
     salary payable)
  4. the next upload of that layout: "Read by your saved layout · no AI", the AI not called again
  5. manual entry: rows typed, running totals, a row that does not add up marked
  6. Tally Payroll: the voucher previewed, its XML on opening; this computer's bridge too old: "Install FinCom Bridge
     2.5.18 to post Tally Payroll" with the download; no Bridge.post
  7. a phone (390 px): no sideways scroll
  8. Approve for Tally Payroll (the cloud, the bridge and Tally faked; the night's entry made from the page's own journal):
     the second check, the claim before the posting, ONE voucher in the ONE Bridge.post (the bridge's shape, no REMOTEID),
     the proof (Tally's created count and voucher id), entry_approved after; an employee Tally lacks listed and nothing
     posted; a bridge older than 2.5.18: the install line and its download, nothing posted
 11. by hand (the owner, 23-Nov-2026: "no option to upload salary after that ... not able to see after that"), classic and
     New look: the sheet upload stays on the page while typing, Cancel goes back, the typed rows are kept while switching;
     "Not kept yet" until Keep with the books; the month kept is listed when the page is opened again ("Kept with the
     books"), opened to see it and changed by hand from the rows kept; when Daily Check makes its journal is said
 12. Make the journal now (the owner, 23-Nov-2026): a month kept and over: the button (the cloud's assistant-night
     payroll_now faked); made: said, opened on Daily Check › Entries; made already (by the night or the button): said and
     opened, no button; the running month: offered, with a plain note that it is not over; Tally Payroll: "Make the Tally
     Payroll entry now", then Approve on this page
 14. (re-review blocker) Make now for the RUNNING month, the entry made by the server's own payrollNow (node, on the same
     made-up books and the salary kept on the page), then Approve: the journal on Daily Check › Entries and the Tally
     Payroll entry on the Payroll page; first the kept salary changed by hand after making ("Replace them" says the
     entry is updated when Make now is pressed again): Approve refuses, nothing posted; Make now again: the same entry
     with the new figures; Approve: claimed, posted once, approved
 13. (review B1) a draft per month: rows typed for Oct, Cancel, "Change by hand" on a kept Sep, back to Oct: Oct's rows
     still there; rows typed for Oct, Cancel, the Month picker to Sep, Enter by hand: Sep's rows; Oct's still there; no
     question asked. "Change by hand" on a kept month keeps the employer's PF and ESI. A kept month with its journal made:
     the "Replace them" confirm says what replacing does: approved, "The journal for Sep 2026 is already approved;
     replacing the salary does not change the entry already sent to Tally."; made, "A journal is already made for Sep
     2026; it is updated with the new figures tonight."
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
  const sc = Store.saveCompany; Store.saveCompany = (c) => { window.__pr.co = JSON.parse(JSON.stringify({payrollMethod: c.payrollMethod, payrollFormats: c.payrollFormats, payrollJournal: c.payrollJournal, payrollPayable: c.payrollPayable || "", payrollVchType: c.payrollVchType || ""})); try { sc.call(Store, c); } catch (e) {} };
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
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
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
    ok("Tally Payroll voucher" in tp and "Needs your OK" not in tp and len(P()["ai"]) == 1, kind + " 6. Tally Payroll: the voucher preview (read by the rule, no AI)")
    HP = "[data-preview=tally] select[aria-label^='Tally pay head']"
    ok(pg.locator(HP).count() == 1 and "Gross" not in tp, kind + " 6. Basic has no same-named pay head: the owner picks it")
    pg.select_option(HP, "Basic Pay"); settle(pg, 300)
    tp = pg.inner_text("[data-preview=tally]")
    ok("3 employees · net ₹78,255.71 to Salary Payable" in tp, kind + " 6. the voucher: 3 employees, net ₹78,255.71 to Salary Payable")
    pg.click("[data-preview=tally] [data-more^=emp-] .pr-more-btn"); pg.click("[data-preview=tally] [data-more^=xml-] .pr-more-btn"); settle(pg, 200)
    x = pg.inner_text("[data-xml]")
    ok('OBJVIEW="PaySlip Voucher View"' in x and "<EMPLOYEENAME>Mehta, Sunil</EMPLOYEENAME>" in x and "REMOTEID" not in x and "Create only" in pg.inner_text("[data-preview=tally]"), kind + " 6. the XML on opening, the bridge's shape, no REMOTEID")
    ok("Install FinCom Bridge 2.5.18 to post Tally Payroll" in pg.inner_text("[data-install]") and pg.locator("[data-install] [data-bridge-download]").count() == 1 and pg.locator("[data-install] [data-bridge-download]").get_attribute("href").startswith("assets/bridge-go/FinComBridge-Setup-" + LATEST_V + ".exe") and ("Download FinCom Bridge " + LATEST_V) in pg.inner_text("[data-install]"), kind + " 6. no 2.5.18 bridge here: the install line with the " + LATEST_V + " download (latest.json), no Approve")
    ok("employer’s PF and ESI are not in this voucher" in pg.inner_text("[data-employer-note]"), kind + " 6. the page says the employer's PF and ESI are booked separately")
    shot(pg, "6-tally-payroll-preview", kind)
    # (review 3) the salary payable ledger and the voucher type picked on the page, kept on the client
    opts = pg.eval_on_selector_all("[data-pick-payable] option", "(os) => os.map((o) => o.value)")
    ok("Salary Payable" in opts and pg.locator("[data-pick-vchtype] option").count() >= 1, kind + " 6. pickers: the salary payable ledger (" + str(len(opts) - 1) + " offered) and the voucher type")
    pg.select_option("[data-pick-payable]", "Salary Payable"); settle(pg, 250)
    ok(P()["co"].get("payrollPayable") == "Salary Payable" and "net ₹78,255.71 to Salary Payable" in pg.inner_text("[data-preview=tally]"), kind + " 6. the payable picked: kept on the client (co.payrollPayable)")
    # (review 9) the month of the sheet: on the start card, last month at first
    mv = pg.input_value("[data-sheet-month] input")
    ok(len(mv) == 7 and mv[4] == "-", kind + " 9. the month picker on the start card: " + mv)
    if w > 600:
        pg.evaluate("() => document.querySelector('[data-tp-settings]').scrollIntoView({block: 'center'})")
        shot(pg, "10-tally-pickers-month", kind)
    pg.click("[data-journal-once]"); settle(pg, 300)
    ok(pg.locator("[data-preview=journal]").count() == 1 and "As a journal this month" in pg.inner_text("[data-preview=journal]") and P()["co"]["payrollJournal"].get("202610"), kind + " 6. Post as a journal this month: the journal instead, kept for Oct 2026")
    ok(P()["posts"] == 0, kind + " no Bridge.post: nothing posted from this page")
    if w < 600: ok(noside(pg), kind + " 7. no sideways scroll")
    ctx.close()
LATEST = open(os.path.join(HERE, "..", "assets-test", "bridge-go", "latest.json"), "rb").read()
LATEST_V = json.loads(LATEST)["setup"]["version"]   # the setup download offered: the newest latest.json names (2.5.18 or later)
MOCK = """(v) => { window.__ap = {rpc: [], posts: [], order: [], entry: null};
  const LED = Object.keys(S.books.under || {});
  Cloud.on = () => true;
  Cloud.api = async (path) => { path = String(path); const A = window.__ap;
    if (path.startsWith("night_entries")) return A.entry ? [A.entry] : [];
    if (path.startsWith("rpc/")) { const fn = path.slice(4); A.rpc.push(fn); if (fn !== "save_book_items") A.order.push(fn);
      if (fn === "entry_claim") A.entry = Object.assign({}, A.entry, {state: "approving", updated_at: new Date().toISOString()});
      if (fn === "entry_approved") A.entry = Object.assign({}, A.entry, {state: "approved"});
      return fn === "save_book_items" ? {ok: true, items: []} : {ok: true}; }
    return []; };
  TCloud.on = () => true; TCloud.has = () => true; TCloud.postThrough = () => ({version: Bridge.st.version, computer: "MADEUP-PC", user: ""}); CloudTally.call = async () => ({ok: true, via: "cloud", ledgers: LED.map((n) => ({name: n, group: ""}))});
  window.tallyVia = () => "bridge"; Bridge.st = Object.assign({}, Bridge.st, {version: v});
  Bridge.post = async (pl) => { window.__ap.posts.push(pl); window.__ap.order.push("post"); await new Promise((r) => setTimeout(r, 300));
    return {ok: true, company: pl.company, results: pl.vouchers.map((x) => ({id: x.id, ok: true, created: 1, vchId: "101", word: "In Tally (verified)"}))}; };
  return LED.length; }"""
# the post gate's globals (set again after the lazy posting files have loaded, which set them)
GATE = "() => { window.postToProblem = () => ''; window.tallyPostSign = () => ({on: true}); window.canPostTally = () => true; return true; }"
def remount(pg):
    pg.click("[data-pick=journal]"); settle(pg, 250); pg.click("[data-pick=tally]"); settle(pg, 600)
def approve_flow(br, w, kind):
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    A = lambda: pg.evaluate("() => window.__ap")
    ok(pg.evaluate(MOCK, "2.5.18") > 0, kind + " 8. the cloud, the bridge (2.5.18) and Tally faked")
    pg.evaluate("() => { const co = S.companies.c1; co.payHeadPlan = {'earn:Basic': 'Basic Pay'}; return true; }")
    pg.click("[data-pick=journal]"); settle(pg, 250)
    pg.set_input_files("[data-sheet-in]", FILES["A"]); pg.wait_for_selector("[data-step=map] [data-save-rule]", timeout=10000); settle(pg, 300)
    pg.click("[data-save-rule]"); pg.wait_for_selector("[data-preview=journal] tbody tr", timeout=10000); settle(pg, 400)
    # last night's entry: the journal Daily Check's builder makes of these books (as the page shows it)
    lines = pg.evaluate("""() => Array.from(document.querySelectorAll('[data-preview=journal] tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'), n = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;
      return n(t[1].innerText) ? {ledger: t[0].innerText, dr: n(t[1].innerText)} : {ledger: t[0].innerText, cr: n(t[2].innerText)}; })""")
    pg.click("[data-keep]"); settle(pg, 300)
    # last night's entry for a Tally Payroll company (the owner's "Night prepares every month"): the month's totals as the
    # night's builder makes them from the sheet kept with the books
    pg.evaluate("""() => { const rs = S.books.salary.filter((r) => r.month === '202610'), R = (x) => Math.round(x * 100) / 100, sum = (k) => R(rs.reduce((s, r) => s + R(Number(r[k]) || 0), 0));
      window.__ap.entry = {id: '00000000-0000-4000-8000-000000000701', client_id: 'c1', source: 'payroll', dedupe: 'payroll:202610', work_ref: '', state: 'ready', updated_at: new Date().toISOString(), why: 'Tally Payroll Oct 2026', reason: 'Tally Payroll', evidence: [], checks: [],
        voucher: {type: 'Payroll', kind: 'tallyPayroll', date: '20261031', no: '', party: 'Salary Payable', period: '202610', book: '', lines: [], n: rs.length, gross: sum('gross'), net: sum('net'),
          ded: {tds: sum('tds'), pt: sum('profTax'), pf: sum('pf'), esi: sum('esi'), other: sum('otherDed')}, narration: 'Salary for Oct 2026 as per the salary sheet (' + rs.length + ' employees)'}}; return true; }""")
    pg.click("[data-pick=tally]")
    try: pg.wait_for_selector("[data-approve]", timeout=10000)
    except Exception:
        print("  (the Tally preview: " + (pg.inner_text("[data-payroll]")[-900:] if pg.locator("[data-payroll]").count() else "none") + ")")
        raise
    settle(pg, 400)
    pg.evaluate(GATE)
    tp = pg.inner_text("[data-preview=tally]")
    ok("3 employees · net ₹78,255.71 to Salary Payable" in tp and "To approve" in tp and "FinCom checks it again first" in tp, kind + " 8. ready: 3 employees, net ₹78,255.71, Approve offered")
    pg.click("[data-preview=tally] [data-more^=emp-] .pr-more-btn"); settle(pg, 200)
    if w > 600: shot(pg, "7-tally-approve-ready", kind)
    pg.click("[data-approve]"); pg.wait_for_selector("[data-proof]", timeout=20000); settle(pg, 500)
    a = A(); posts = a["posts"]
    order = [x for x in a["order"] if x == "post" or x.startswith("entry_")]
    ok(order == ["entry_claim", "post", "entry_approved"], kind + " 8. claimed first, then posted, then approved: " + " > ".join(order))
    ok(len(posts) == 1 and len(posts[0]["vouchers"]) == 1 and posts[0]["vouchers"][0]["id"] == "dc-tp-202610-c1-p1" and not posts[0]["masters"], kind + " 8. one Bridge.post, ONE payroll voucher (dc-tp-202610-c1-p1), no master")
    x = posts[0]["vouchers"][0]["xml"] if posts else ""
    ok(x.startswith('<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="PaySlip Voucher View">') and "REMOTEID" not in x and "TDSDesk:dc-tp-202610-c1-p1</NARRATION>" in x and x.count("<EMPLOYEEENTRIES.LIST>") == 3, kind + " 8. the bridge's shape: Create only, no REMOTEID, FinCom's id, 3 employees")
    pr = pg.inner_text("[data-proof]")
    ok("Posted to Tally" in pr and "Tally created 1 payroll voucher (voucher id 101)." in pr and pg.locator("[data-approve]").count() == 0, kind + " 8. the proof: Tally created 1 payroll voucher (voucher id 101); no Approve again")
    ok("save_book_items" in a["rpc"], kind + " 8. the draft kept with the books (save_book_items)")
    if w > 600: shot(pg, "8-tally-approve-posted", kind)
    # an employee Tally lacks: listed, nothing posted
    pg.evaluate("() => { window.__ap.entry = Object.assign({}, window.__ap.entry, {state: 'ready'}); S.books.payroll.employees = S.books.payroll.employees.filter((e) => e.name !== 'Mehta, Sunil'); return true; }")
    remount(pg)
    nd = pg.inner_text("[data-need]") if pg.locator("[data-need]").count() else ""
    ok("Create the employee “Mehta, Sunil” in Tally" in nd and pg.locator("[data-approve]").count() == 0 and "Check first" in pg.inner_text("[data-preview=tally]"), kind + " 8. an employee Tally lacks: listed in plain words, no Approve")
    # a bridge older than 2.5.18
    pg.evaluate("() => { S.books.payroll.employees.push({guid: 'e9', name: 'Mehta, Sunil', parent: 'Staff', category: 'Primary Cost Category', group: false, pan: '', joined: '', left: '', designation: '', gone: false}); Bridge.st = Object.assign({}, Bridge.st, {version: '2.5.17'}); return true; }")
    remount(pg)
    ins = pg.inner_text("[data-install]") if pg.locator("[data-install]").count() else ""
    ok("Install FinCom Bridge 2.5.18 to post Tally Payroll" in ins and "2.5.17" in ins and pg.locator("[data-install] [data-bridge-download]").get_attribute("href").startswith("assets/bridge-go/FinComBridge-Setup-" + LATEST_V + ".exe") and ("Download FinCom Bridge " + LATEST_V) in ins and pg.locator("[data-approve]").count() == 0, kind + " 8. bridge 2.5.17: the install line, the " + LATEST_V + " download (latest.json), no Approve")
    if w > 600: shot(pg, "9-tally-bridge-too-old", kind)
    ok(len(A()["posts"]) == 1, kind + " 8. nothing more posted")
    if w < 600: ok(noside(pg), kind + " 8. no sideways scroll")
    ctx.close()
NL_ON = "try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}"
def hand_flow(br, w, kind, nl):
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    P = lambda: pg.evaluate("() => window.__pr")
    if nl: ok(pg.evaluate("() => document.documentElement.classList.contains('nl')"), kind + " 11. New look on")
    pg.click("[data-pick=journal]"); settle(pg, 250)
    pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    f = lambda i, k, v: pg.fill("[data-entry-row='%d'] input[aria-label='%s row %d']" % (i, k, i + 1), v)
    f(0, "Employee", "Ravi Kumar"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); f(0, "TDS", "1,500"); settle(pg, 200)
    ok(pg.locator("[data-sheet-in]").count() == 1, kind + " 11. by hand: the salary sheet upload is still offered")
    shot(pg, "11-hand-typing", kind)
    ok(pg.locator("[data-manual-cancel]").count() == 1, kind + " 11. by hand: Cancel goes back")
    if pg.locator("[data-manual-cancel]").count(): pg.click("[data-manual-cancel]"); settle(pg, 200)
    ok(pg.locator("[data-step=manual]").count() == 0, kind + " 11. Cancel: the typing closed")
    if pg.locator("[data-manual]").count():
        pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    ok(pg.input_value("input[aria-label='Employee row 1']") == "Ravi Kumar", kind + " 11. opened again: the typed rows are still there")
    if pg.input_value("input[aria-label='Employee row 1']") != "Ravi Kumar":
        f(0, "Employee", "Ravi Kumar"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); f(0, "TDS", "1,500"); settle(pg, 200)
    pg.click("[data-manual-done]"); settle(pg, 300)
    ok(pg.locator("[data-not-kept]").count() == 1, kind + " 11. Use these: said plainly it is not kept yet")
    pg.click("[data-keep]"); settle(pg, 300)
    sal = pg.evaluate("() => S.books.salary")
    ok(P()["saved"] == 1 and len(sal) == 1 and sal[0]["name"] == "Ravi Kumar" and sal[0]["month"] == "202610" and sal[0]["gross"] == 35000, kind + " 11. kept with the books: Oct 2026, Ravi Kumar, gross 35,000")
    ok("tonight" in (pg.inner_text("[data-next]") if pg.locator("[data-next]").count() else "").lower() and "Daily Check" in (pg.inner_text("[data-next]") if pg.locator("[data-next]").count() else ""), kind + " 11. kept: says Daily Check makes the journal tonight")
    shot(pg, "12-hand-kept", kind)
    # the page opened again (another tab and back): the month kept is listed
    pg.evaluate("() => { S.booksTab = 'ledgers'; render(); return true; }"); settle(pg, 300)
    pg.evaluate("() => { S.booksTab = 'payroll'; render(); return true; }"); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    km = pg.inner_text("[data-kept-months]") if pg.locator("[data-kept-months]").count() else ""
    ok("Oct 2026" in km and "1 employee" in km and "typed in" in km, kind + " 11. opened again: Kept with the books lists Oct 2026, 1 employee, typed in")
    shot(pg, "13-kept-months", kind)
    if pg.locator("[data-kept-open='202610']").count(): pg.click("[data-kept-open='202610']"); settle(pg, 300)
    rd = pg.inner_text("[data-step=read]") if pg.locator("[data-step=read]").count() else ""
    ok("Oct 2026" in rd and "₹35,000" in rd and "Kept with the books" in rd, kind + " 11. Open: the month kept shown (Oct 2026, gross ₹35,000, kept)")
    ok(pg.locator("[data-preview=journal]").count() == 1, kind + " 11. Open: the payroll journal preview")
    if pg.locator("[data-kept-edit='202610']").count(): pg.click("[data-kept-edit='202610']"); settle(pg, 300)
    elif pg.locator("[data-manual]").count(): pg.click("[data-manual]"); settle(pg, 300)
    ok(pg.locator("[data-step=manual]").count() == 1 and pg.input_value("input[aria-label='Employee row 1']") == "Ravi Kumar" and pg.input_value("input[aria-label='Basic row 1']") in ("25000", "25,000"), kind + " 11. Change by hand: the rows kept, to change")
    # switching: a sheet uploaded while typing
    if pg.locator("[data-sheet-in]").count() == 0:
        ok(False, kind + " 11. a sheet uploaded while typing: no upload offered"); ctx.close(); return
    pg.set_input_files("[data-sheet-in]", FILES["A"]); pg.wait_for_selector("[data-step=map] [data-save-rule]", timeout=10000); settle(pg, 300)
    ok(pg.locator("[data-step=manual]").count() == 0, kind + " 11. a sheet uploaded while typing: the sheet is read")
    if w < 600: ok(noside(pg), kind + " 11. no sideways scroll")
    ctx.close()
NOWMOCK = """() => { window.__now = {calls: [], entries: {}};
  const nowYm = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7).replace("-", "");
  const ymOf = (path) => (String(path).match(/payroll%3A(\\d{6})/) || [])[1] || "";
  Cloud.on = () => true;
  Cloud.api = async (path) => { path = String(path); if (path.startsWith("night_entries")) { const e = window.__now.entries[ymOf(path)]; return e ? [e] : []; } if (path.startsWith("rpc/")) return {ok: true}; return []; };
  Cloud.fn = async (name, body) => { window.__now.calls.push([name, body]);
    const had = window.__now.entries[body.ym];
    if (had) return {ok: true, kind: "already", id: had.id, state: had.state};
    if (body.ym > nowYm()) return {ok: true, kind: "notyet", words: "That month hasn’t begun yet."};
    const running = body.ym === nowYm();
    const rs = S.books.salary.filter((r) => r.month === body.ym), g = rs.reduce((s, r) => s + r.gross, 0), nt = rs.reduce((s, r) => s + r.net, 0);
    const tally = (S.companies.c1.payrollMethod || {}).value === 'tally';
    const e = window.__now.entries[body.ym] = {id: '00000000-0000-4000-8000-0000000008' + String(Object.keys(window.__now.entries).length).padStart(2, '0'), client_id: 'c1', source: 'payroll', dedupe: 'payroll:' + body.ym, work_ref: '', state: 'ready', updated_at: new Date().toISOString(), why: 'Payroll', reason: 'Payroll', evidence: [], checks: [],
      voucher: tally ? {type: 'Payroll', kind: 'tallyPayroll', date: body.ym + '28', no: '', party: 'Salary Payable', period: body.ym, book: '', lines: [], n: rs.length, gross: g, net: nt, ded: {tds: rs.reduce((s, r) => s + r.tds, 0), pt: 0, pf: 0, esi: 0, other: 0}, narration: 'Salary'}
        : {type: 'Journal', kind: 'payroll', date: body.ym + '28', lines: []}};
    return Object.assign({ok: true, kind: "made", id: e.id, state: "ready"}, running ? {running: true, words: "This month isn’t over yet. This is made from the salary kept now."} : {}); };
  return true; }"""
def now_flow(br, w, kind, nl):
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    pg.evaluate(NOWMOCK); pg.evaluate("() => { render(); return true; }"); settle(pg, 300)
    N = lambda: pg.evaluate("() => window.__now")
    f = lambda i, k, v: pg.fill("[data-entry-row='%d'] input[aria-label='%s row %d']" % (i, k, i + 1), v)
    def typed(month=None):
        pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
        if month: pg.fill("[data-step=manual] input[type=month]", month); settle(pg, 150)
        f(0, "Employee", "Ravi Kumar"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); f(0, "TDS", "1,500"); settle(pg, 200)
        pg.click("[data-manual-done]"); settle(pg, 300); pg.click("[data-keep]"); settle(pg, 400)
    pg.click("[data-pick=journal]"); settle(pg, 250)
    typed()
    mk = pg.locator("[data-make-now]")
    ok(mk.count() == 1 and "Make the journal now" in mk.inner_text(), kind + " 12. kept and over: Make the journal now")
    shot(pg, "14-make-now", kind)
    if mk.count(): mk.click(); pg.wait_for_selector("[data-now-said]", timeout=10000); settle(pg, 400)
    c = N()["calls"]
    ok(len(c) == 1 and c[0][0] == "assistant-night" and c[0][1] == {"action": "payroll_now", "client_id": "c1", "ym": "202610"}, kind + " 12. one call: assistant-night payroll_now, this client, Oct 2026")
    said = pg.inner_text("[data-now-said]") if pg.locator("[data-now-said]").count() else ""
    ok("Made" in said and "Daily Check › Entries" in said and pg.locator("[data-make-now]").count() == 0 and pg.locator("[data-now-open]").count() == 1, kind + " 12. made: said, Open it, no button again")
    shot(pg, "15-made-now", kind)
    # the page opened again: made already (the night or the button): said, no button
    pg.evaluate("() => { S.booksTab = 'ledgers'; render(); return true; }"); settle(pg, 300)
    pg.evaluate("() => { S.booksTab = 'payroll'; render(); return true; }"); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    if pg.locator("[data-kept-open='202610']").count(): pg.click("[data-kept-open='202610']"); settle(pg, 500)
    said = pg.inner_text("[data-now-said]") if pg.locator("[data-now-said]").count() else ""
    ok("already" in said.lower() and pg.locator("[data-make-now]").count() == 0 and len(N()["calls"]) == 1, kind + " 12. opened again: made already, said; no button, no call")
    if pg.locator("[data-now-open]").count(): pg.click("[data-now-open]"); settle(pg, 500)
    pg.wait_for_timeout(600)
    ok(pg.evaluate("() => S.view === 'home' && S.homeTab === 'daily'") and (pg.locator("[data-tab=entries][aria-selected=true]").count() == 1 or pg.locator("[data-daily]").count() >= 1), kind + " 12. Open it: Daily Check, its Entries")
    ctx.close()
    # the running month, and Tally Payroll
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    pg.evaluate(NOWMOCK); pg.evaluate("() => { render(); return true; }"); settle(pg, 300)
    N = lambda: pg.evaluate("() => window.__now")
    pg.click("[data-pick=journal]"); settle(pg, 250)
    nxt = pg.evaluate("() => { const d = new Date(Date.now() + 5.5 * 3600e3); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }")
    typed(nxt)
    mk = pg.locator("[data-make-now]"); card = pg.inner_text("[data-make-now-card]") if pg.locator("[data-make-now-card]").count() else ""
    ok(mk.count() == 1 and "isn’t over yet" in card and "ends" in (pg.inner_text("[data-next]") if pg.locator("[data-next]").count() else "") and pg.locator("[data-make-now-card] .pr-warn, [data-make-now-card] .bad").count() == 0, kind + " 12. the running month: offered, with a plain note that it isn't over (no warning)")
    shot(pg, "16-running-month", kind)
    if mk.count(): mk.click(); pg.wait_for_selector("[data-now-said]", timeout=10000); settle(pg, 400)
    said = pg.inner_text("[data-now-said]") if pg.locator("[data-now-said]").count() else ""
    ok("Made" in said and "isn’t over yet" in said and N()["calls"][-1][1]["ym"] == nxt.replace("-", ""), kind + " 12. the running month made, said not over")
    pg.click("[data-pick=tally]"); settle(pg, 300)
    pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    pg.fill("[data-step=manual] input[type=month]", "2026-10"); settle(pg, 200)
    if pg.input_value("input[aria-label='Employee row 1']") != "Ravi Kumar":
        f(0, "Employee", "Ravi Kumar"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); f(0, "TDS", "1,500"); settle(pg, 200)
    pg.click("[data-manual-done]"); settle(pg, 300); pg.click("[data-keep]"); settle(pg, 400)
    mk = pg.locator("[data-make-now]")
    ok(mk.count() == 1 and "Make the Tally Payroll entry now" in mk.inner_text(), kind + " 12. Tally Payroll: Make the Tally Payroll entry now")
    if mk.count(): mk.click(); pg.wait_for_selector("[data-now-said]", timeout=10000); settle(pg, 800)
    said = pg.inner_text("[data-now-said]") if pg.locator("[data-now-said]").count() else ""
    ok("Made" in said and "Approve" in said and pg.locator("[data-no-entry]").count() == 0, kind + " 12. Tally Payroll made: Approve it on this page (the entry read again)")
    shot(pg, "17-tally-made-now", kind)
    ok(pg.evaluate("() => window.__pr.posts") == 0, kind + " 12. nothing posted to Tally by making it")
    if w < 600: ok(noside(pg), kind + " 12. no sideways scroll")
    ctx.close()

SEP = """() => { S.books.salary = [{name: "Asha Verma", code: "", pan: "", days: null, month: "202609", date: "2026-09-30", gross: 30000, tds: 0, profTax: 200, pf: 1800, esi: 0, net: 28000,
    pfEr: 1800, esiEr: 975, earn: {Basic: 20000, HRA: 10000}, ded: {}, otherDed: 0, earnMapped: true, grossMapped: false, src: "manual"}]; render(); return true; }"""
def draft_flow(br, w, kind, nl):
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    pg.evaluate(NOWMOCK); pg.evaluate(SEP); settle(pg, 300)
    pg.click("[data-pick=journal]"); settle(pg, 250)
    f = lambda i, k, v: pg.fill("[data-entry-row='%d'] input[aria-label='%s row %d']" % (i, k, i + 1), v)
    row1 = lambda: pg.input_value("input[aria-label='Employee row 1']") if pg.locator("input[aria-label='Employee row 1']").count() else ""
    def by_hand(month=None):
        if month: pg.fill("[data-sheet-month] input[type=month]", month); settle(pg, 150)
        pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    def cancel(): pg.click("[data-manual-cancel]"); settle(pg, 200)
    asked = lambda: pg.locator("[data-step=manual] .pr-warn, [role=dialog], [data-replace-warn]").count()
    # case 1: Oct typed, Cancel, Change by hand on the kept Sep, back to Oct
    by_hand("2026-10")
    f(0, "Employee", "Ravi Kumar"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); settle(pg, 200)
    cancel()
    pg.click("[data-kept-edit='202609']"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    ok(row1() == "Asha Verma" and asked() == 0, kind + " 13. case 1: Change by hand on Sep: Sep's rows kept, no question")
    shot(pg, "18-draft-sep", kind)
    cancel(); by_hand("2026-10")
    ok(row1() == "Ravi Kumar" and pg.input_value("input[aria-label='Basic row 1']") in ("25,000", "25000"), kind + " 13. case 1: back to Oct: the rows typed for Oct still there")
    # case 2: Oct typed (still), Cancel, the Month picker to Sep, Enter by hand
    cancel(); by_hand("2026-09")
    ok(row1() == "Asha Verma" and asked() == 0, kind + " 13. case 2: Month Sep, Enter by hand: Sep's rows, no question")
    cancel(); by_hand("2026-10")
    ok(row1() == "Ravi Kumar", kind + " 13. case 2: Oct's rows still there")
    shot(pg, "19-draft-oct-kept", kind)
    # the month picker inside the typing: to Sep (its own draft) and back, nothing lost
    pg.fill("[data-step=manual] input[type=month]", "2026-09"); settle(pg, 200)
    ok(row1() == "Asha Verma", kind + " 13. the month changed while typing, to a month with its own rows: that month's rows")
    pg.fill("[data-step=manual] input[type=month]", "2026-10"); settle(pg, 200)
    ok(row1() == "Ravi Kumar", kind + " 13. and back: Oct's rows")
    # Change by hand on the kept Sep: the employer's PF and ESI kept; its journal made: said in the Replace confirm
    cancel()
    pg.evaluate("() => { window.__now.entries['202609'] = {id: '00000000-0000-4000-8000-000000000901', state: 'approved'}; return true; }")
    pg.click("[data-kept-edit='202609']"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    f(0, "HRA", "11,000"); f(0, "Net", "29,000"); settle(pg, 200)
    pg.click("[data-manual-done]"); settle(pg, 300); pg.click("[data-keep]"); settle(pg, 500)
    rw = pg.inner_text("[data-replace-warn]") if pg.locator("[data-replace-warn]").count() else ""
    ok("The journal for Sep 2026 is already approved; replacing the salary does not change the entry already sent to Tally." in rw, kind + " 13. Sep's journal approved: the Replace confirm says replacing does not change it: " + rw[:200])
    shot(pg, "20-replace-approved", kind)
    pg.click("[data-replace-warn] .linkbtn"); settle(pg, 200)
    pg.evaluate("() => { window.__now.entries['202609'].state = 'ready'; return true; }")
    pg.click("[data-keep]"); settle(pg, 500)
    rw = pg.inner_text("[data-replace-warn]") if pg.locator("[data-replace-warn]").count() else ""
    ok("A journal is already made for Sep 2026; it is updated with the new figures tonight." in rw, kind + " 13. Sep's journal made (ready): updated with the new figures tonight: " + rw[:200])
    shot(pg, "20-replace-made", kind)
    if pg.locator("[data-keep-sure]").count(): pg.click("[data-keep-sure]"); settle(pg, 400)
    sal = [r for r in pg.evaluate("() => S.books.salary") if r.get("month") == "202609"]
    ok(len(sal) == 1 and sal[0]["gross"] == 31000 and sal[0]["pfEr"] == 1800 and sal[0]["esiEr"] == 975, kind + " 13. Change by hand on Sep: the employer's PF 1,800 and ESI 975 kept: " + json.dumps([{k: r.get(k) for k in ("gross", "pfEr", "esiEr")} for r in sal]))
    # Oct (no journal made): the confirm, when asked, does not say it
    by_hand("2026-10")
    ok(row1() == "Ravi Kumar", kind + " 13. Oct's rows still there after Sep was kept")
    if w < 600: ok(noside(pg), kind + " 13. no sideways scroll")
    ctx.close()
# (re-review blocker) the server's own entry for the running month: payrollNow on the same made-up books (the night's
# reading: nightInput), with the salary and the client's payroll settings as the page keeps them
SERVERJS = """
import { booksOf, gstOf, nightInput } from "../server/assistant-night/nightinput.js";
import { payrollNow } from "../server/_shared/dailyjournals.js";
import { gstRows } from "./daily2_books.mjs";
const [salary, co, heads, today, ym] = JSON.parse(process.argv[1]);
const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" };
const rows = gstRows({ ym: "202610", filed: "", extraLedgers: PL, items: [{ key: "salary", item: "", ord: 0, data: salary, deleted: false }] });
Object.assign(rows.co, co, { id: "c1" });
const b = booksOf(rows);
process.stdout.write(JSON.stringify(payrollNow(ym, nightInput(rows, b, { today, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst: gstOf(rows, b, today), prior: [], jobs: {}, draftRecs: [], payHeads: heads }))));
"""
def server_now(pg, ym):
    st = pg.evaluate("() => ({salary: S.books.salary, co: JSON.parse(JSON.stringify(S.companies.c1)), heads: Object.entries((S.books.payroll || {}).heads || {}).map(([name, h]) => ({name, type: (h && h.type) || ''})), today: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '')})")
    r = subprocess.run(["node", "--input-type=module", "-e", SERVERJS, json.dumps([st["salary"], st["co"], st["heads"], st["today"], ym])], cwd=HERE, capture_output=True, text=True, check=True)
    made = json.loads(r.stdout)
    pg.evaluate("(m) => { window.__ap.next = m; return true; }", made)
    return made
# assistant-night payroll_now as the server answers it (paynow.js applyNow): made; the running month's entry still ready
# with other figures: updated (the same entry); the same figures: already
NOWSRV = """() => { const A = window.__ap; A.fn = [];
  Cloud.fn = async (name, body) => { A.fn.push([name, body]); const m = A.next;
    if (!m || m.kind !== "made") return Object.assign({ok: true}, m || {kind: "none", words: "No salary."});
    const was = A.entry, id = (was && was.id) || "00000000-0000-4000-8000-000000000a01";
    if (was && !["ready", "held"].includes(was.state)) return {ok: true, kind: "already", id, state: was.state};
    if (was && JSON.stringify(was.voucher) === JSON.stringify(m.entry.voucher)) return {ok: true, kind: "already", id, state: was.state};
    A.entry = Object.assign({}, m.entry, {id, client_id: "c1", finding_id: "00000000-0000-4000-8000-000000000a02", state: m.entry.ready ? "ready" : "held", updated_at: new Date().toISOString(), decided_by: null});
    return Object.assign({ok: true, kind: was ? "updated" : "made", id, state: A.entry.state}, m.running ? {running: true, words: m.words} : {}); };
  window.openCompany = async () => {};
  try { TCloud.book = () => ({book: "b1"}); } catch (e) {}
  return true; }"""
def run_now_approve(br, w, kind, tally):
    ctx = br.new_context(viewport={"width": w, "height": 900 if w > 600 else 844}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=LATEST))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [DATA, "owner"]); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    pg.evaluate(MOCK, "2.5.18"); pg.evaluate(NOWSRV)
    pg.evaluate("() => { const co = S.companies.c1; co.payHeadPlan = {'earn:Basic': 'Basic Pay'}; co.payrollPayable = 'Salary Payable'; return true; }")
    A = lambda: pg.evaluate("() => window.__ap")
    what = "Tally Payroll entry" if tally else "journal"
    f = lambda i, k, v: pg.fill("[data-entry-row='%d'] input[aria-label='%s row %d']" % (i, k, i + 1), v)
    ym = pg.evaluate("() => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7)")
    YM = ym.replace("-", "")
    pg.click("[data-pick=%s]" % ("tally" if tally else "journal")); settle(pg, 250)
    pg.fill("[data-sheet-month] input[type=month]", ym); settle(pg, 150)
    pg.click("[data-manual]"); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    f(0, "Employee", "Ravi Kumar"); f(0, "Basic", "25,000"); f(0, "HRA", "10,000"); f(0, "TDS", "1,500"); f(0, "PT", "200")
    pg.click("[data-add-row]"); f(1, "Employee", "Asha Verma"); f(1, "Basic", "15,000"); f(1, "HRA", "6,000"); f(1, "PT", "200"); settle(pg, 200)
    pg.click("[data-manual-done]"); settle(pg, 300); pg.click("[data-keep]"); settle(pg, 400)
    made = server_now(pg, YM)
    ok(made.get("kind") == "made" and made.get("running") and made["entry"]["ready"], kind + " 14. the server's payrollNow for the running month " + YM + ": a ready " + what)
    pg.click("[data-make-now]"); pg.wait_for_selector("[data-now-said]", timeout=10000); settle(pg, 800)
    ok("Made" in pg.inner_text("[data-now-said]") and A()["entry"]["dedupe"] == "payroll:" + YM, kind + " 14. Make the " + what + " now: made (payroll:" + YM + ")")
    v0 = A()["entry"]["voucher"]
    # the kept salary changed after making: Change by hand, Keep, Replace them (said: updated when Make now is pressed again)
    pg.click("[data-kept-edit='%s']" % YM); pg.wait_for_selector("[data-step=manual]"); settle(pg, 200)
    f(0, "Basic", "26,000"); f(0, "Net", ""); settle(pg, 200)
    pg.click("[data-manual-done]"); settle(pg, 300); pg.click("[data-keep]"); settle(pg, 600)
    rw = pg.inner_text("[data-replace-warn]") if pg.locator("[data-replace-warn]").count() else ""
    mon = pg.evaluate("(ym) => { const [y, m] = ym.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y; }", ym)
    ok(("A %s is already made for %s; it is updated when you press Make the %s now again." % (what, mon, what)) in rw, kind + " 14. Replace them: the running month's entry is updated when Make now is pressed again: " + rw[:220])
    if w > 600: shot(pg, "21-replace-running" + ("-tally" if tally else ""), kind)
    pg.click("[data-keep-sure]"); settle(pg, 500)
    sal = [r for r in pg.evaluate("() => S.books.salary") if r.get("month") == YM]
    ok(sum(r["gross"] for r in sal) == 57000, kind + " 14. the new salary kept: gross " + str(sum(r["gross"] for r in sal)))
    pg.evaluate(GATE)
    def approve():
        pg.evaluate("() => { window.__ap.order = []; window.__dc_toasts = []; const t0 = window.toast; window.toast = (m) => { window.__dc_toasts.push(String(m)); try { t0 && t0(m); } catch (e) {} }; return true; }")
        if tally:
            pg.evaluate("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'payroll'; render(); return true; }"); settle(pg, 300)
            if pg.locator("[data-approve]").count() == 0: remount(pg)
            pg.wait_for_selector("[data-approve]", timeout=10000); settle(pg, 300); pg.evaluate(GATE)
            pg.click("[data-approve]")
            pg.wait_for_timeout(2500)
            settle(pg, 500)
            return pg.inner_text("[data-preview=tally]")
        pg.evaluate("() => { S.dcTab = 'entries'; S.dcOpen = ''; navHome('daily'); return true; }"); pg.wait_for_selector("[data-daily]", timeout=15000); settle(pg, 600)
        if pg.locator("[data-tab=entries]").count(): pg.click("[data-tab=entries]"); settle(pg, 500)
        rid = A()["entry"]["id"]
        pg.wait_for_selector("[data-row='%s'] .dc-icon.ok" % rid, timeout=10000)
        pg.evaluate(GATE)
        pg.click("[data-row='%s'] .dc-icon.ok" % rid); pg.wait_for_timeout(2500); settle(pg, 500)
        return " | ".join(pg.evaluate("() => window.__dc_toasts"))
    said = approve()
    a = A()
    ok("Changed since last night" in said and not [x for x in a["order"] if x in ("post", "entry_claim", "entry_approved")], kind + " 14. the salary changed after making: Approve refuses, nothing claimed or posted: " + said[:160].replace("\n", " "))
    if w > 600: shot(pg, "22-approve-stale" + ("-tally" if tally else ""), kind)
    # Make now again: the same entry, the new figures
    pg.evaluate("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'payroll'; render(); return true; }"); pg.wait_for_selector("[data-payroll]", timeout=15000); settle(pg)
    if pg.locator("[data-kept-open='%s']" % YM).count(): pg.click("[data-kept-open='%s']" % YM); settle(pg, 600)
    made2 = server_now(pg, YM)
    ma = pg.locator("[data-make-again]")
    ok(ma.count() == 1 and ("Make the %s now again" % what) in ma.inner_text(), kind + " 14. the running month made and still ready: Make the " + what + " now again")
    if w > 600: shot(pg, "23-make-again" + ("-tally" if tally else ""), kind)
    if ma.count(): ma.click(); settle(pg, 900)
    a = A()
    ok(a["entry"]["voucher"] == made2["entry"]["voucher"] and a["entry"]["voucher"] != v0 and "Made again" in (pg.inner_text("[data-now-said]") if pg.locator("[data-now-said]").count() else ""), kind + " 14. made again: the same entry with the new figures, said")
    said = approve()
    a = A()
    order = [x for x in a["order"] if x == "post" or x.startswith("entry_")]
    ok(order == ["entry_claim", "post", "entry_approved"] and a["entry"]["state"] == "approved", kind + " 14. Approve the running month's " + what + (" on the Payroll page" if tally else " on Daily Check › Entries") + ": claimed, posted once, approved: " + " > ".join(order) + " (" + said[:120].replace("\n", " ") + ")")
    p0 = a["posts"][-1]["vouchers"][0] if a["posts"] else {}
    ok(p0.get("id") == (("dc-tp-%s-c1-p1" % YM) if tally else made2["entry"]["work_ref"]), kind + " 14. the voucher posted: " + str(p0.get("id")))
    if w > 600: shot(pg, "24-approved-running" + ("-tally" if tally else ""), kind)
    ctx.close()
with sync_playwright() as p:
    br = p.chromium.launch()
    O13 = os.environ.get("ONLY13")
    if os.environ.get("ONLY14"):
        run_now_approve(br, 1440, "running-journal", False)
        run_now_approve(br, 1440, "running-tally", True)
        O13 = "skip"
    if not O13 and not os.environ.get("ONLY8"): run(br, 1440, "desktop")
    if not O13 and not os.environ.get("ONLY8"): run(br, 390, "phone")
    if not O13 and not os.environ.get("ONLY11"):
        approve_flow(br, 1440, "desktop")
        approve_flow(br, 390, "phone")
    if not O13 and not os.environ.get("ONLY12"):
        hand_flow(br, 1440, "hand-classic", False)
        hand_flow(br, 1440, "hand-newlook", True)
        hand_flow(br, 390, "hand-phone", True)
    if not O13:
        run_now_approve(br, 1440, "running-journal", False)
        run_now_approve(br, 1440, "running-tally", True)
    if not os.environ.get("ONLY14"): draft_flow(br, 1440, "draft-classic", False)
    if not os.environ.get("ONLY14"): draft_flow(br, 390, "draft-phone", True)
    if not O13:
        now_flow(br, 1440, "now-classic", False)
        now_flow(br, 1440, "now-newlook", True)
        now_flow(br, 390, "now-phone", True)
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
