"""python3 tests/run_daily_check_p2_ui.py - Daily Check phase 2 in the built app (app/dist-test), with a stand-in for the cloud
answering with made-up rows from phase 2's own builders (tests/daily2_fixture.mjs dbRows2) and recording every call.
  1. Entries: the set-off, payroll, salary payment and monthly rent, one calm line each; opened: Dr/Cr, the trace, the
     checks it passed; no Edit for a journal FinCom made
  2. Approve a journal: the second check runs first; the books here differ from last night's: "Changed since last
     night", nothing posted, nothing recorded (no entry_decide)
  3. the promotion suggestion: the owner only; Move calls trust_set one level up; Not now calls trust_dismiss
  4. Needs you: a ledger to pick shows the candidates and no "Ask client"; a choice calls finding_choose with it; the
     journal waiting on it is not shown twice; Done never lists phase 2's kinds
  5. Client setup: the trust levels (owner sets, logged by trust_set; staff cannot); the limit; the reminder switch's line
  6. a phone (390 px): no sideways scroll on Entries or Client setup
UI_PORT (8474)."""
import os, sys, json, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UI_PORT") or 8474)
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
ROWS = json.loads(subprocess.run(["node", "-e", "import('./daily2_fixture.mjs').then(m => process.stdout.write(JSON.stringify(m.dbRows2())))"], cwd=HERE, capture_output=True, text=True, check=True).stdout)
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SEED = """([rows, role]) => { S.firm.firmName = "Sample & Co";
  rows.clients.forEach((c) => { const co = newCompany({name: c.name}); co.id = c.id; co.stats = {}; S.companies[c.id] = co; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; });
  S.coId = "d1"; S.account = {me: {role, name: "Made-up Person"}};
  window.__dc = {calls: [], toasts: []};
  const R = rows;
  Cloud.on = () => true;
  Cloud.api = async (path, o) => { o = o || {}; window.__dc.calls.push([path, o.method || "GET", o.body || null]); const t = path.split("?")[0];
    if (t === "rpc/trust_stats") return JSON.parse(JSON.stringify(R.rpc_trust_stats || []));
    if (t.startsWith("rpc/")) return {ok: true}; if (o.method && o.method !== "GET") return null;
    const m = path.match(/[?&]client_id=eq\\.([^&]+)/), rows = JSON.parse(JSON.stringify(R[t] || []));
    return m ? rows.filter((x) => x.client_id === decodeURIComponent(m[1])) : rows; };
  Cloud.fn = async (name, body) => { window.__dc.calls.push(["fn:" + name, "POST", body]); return {ok: true}; };
  window.openCompany = async (cid) => { window.__dc.calls.push(["openCompany", cid]); S.books = {vouchers: [], map: {}}; };
  const t0 = window.toast; window.toast = (m) => { window.__dc.toasts.push(String(m)); try { t0 && t0(m); } catch (e) {} };
  window.Bridge = Object.assign(window.Bridge || {}, {post: async () => { window.__dc.calls.push(["Bridge.post"]); return {ok: true, results: []}; }});
  S.view = "home"; navHome("daily"); return true; }"""
def settle(pg, ms=450):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('[data-loading-page], .react-loading')", timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(150)
def start(br, w=1440, h=900, role="owner"):
    ctx = br.new_context(viewport={"width": w, "height": h})
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1000); pg.evaluate(READY); pg.wait_for_timeout(300)
    pg.evaluate(SEED, [ROWS, role]); pg.wait_for_selector("[data-daily]", timeout=15000); settle(pg)
    return ctx, pg
calls = lambda pg: pg.evaluate("() => window.__dc.calls")
rpcs = lambda pg, fn: [c for c in calls(pg) if c[0] == "rpc/" + fn]
ids = {e["source"]: e["id"] for e in ROWS["night_entries"][::-1]}
sal = [e["id"] for e in ROWS["night_entries"] if e["source"] == "bank_self_answer" and any(x.get("t") == "salary" for x in e["evidence"])][0]
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx, pg = start(br)
    pg.click("[data-tab=entries]"); settle(pg)
    txt = lambda rid: pg.inner_text("[data-row='%s'] .dc-open" % rid)
    ok("GSTR-3B Oct 2026" in txt(ids["gst_setoff"]) and "GST set-off" in txt(ids["gst_setoff"]) and "Journal" in txt(ids["gst_setoff"]), "1. the set-off: Journal · GSTR-3B Oct 2026 · GST set-off")
    ok("Salary sheet Oct 2026" in txt(ids["payroll"]) and "Payroll" in txt(ids["payroll"]), "1. the payroll: Salary sheet Oct 2026 · Payroll")
    ok("Ravi Kumar" in txt(sal) and "Salary sheet" in txt(sal) and "Payment" in txt(sal), "1. the salary payment: the employee's name, Salary sheet")
    ok("Sample Landlord" in txt(ids["recurring"]) and "Monthly" in txt(ids["recurring"]), "1. the monthly rent: the party, Monthly")
    ok(pg.locator("[data-row='%s'] .dc-more" % ids["gst_setoff"]).count() == 0, "1. collapsed: no details until opened")
    pg.click("[data-row='%s'] .dc-open" % ids["gst_setoff"]); settle(pg, 200)
    more = pg.inner_text("[data-row='%s'] .dc-more" % ids["gst_setoff"])
    ok("CGST OUTPUT" in more and "GST ELECTRONIC CASH LEDGER" in more and "CGST tax ₹57,600 = credit ₹34,200 + cash ₹23,400" in more, "1. opened: the lines and the trace of each head")
    ok("Worked out two ways" in more and "Legal set-off order" in more and "Right groups" in more, "1. opened: the checks it passed")
    ok(pg.locator("[data-row='%s'] .dc-more .linkbtn" % ids["gst_setoff"]).count() == 0, "1. no Edit on a journal FinCom made (Reject it and enter it by hand)")
    pg.click("[data-row='%s'] .dc-open" % ids["gst_setoff"]); settle(pg, 150)
    pg.click("[data-row='%s'] .dc-icon.ok" % ids["payroll"]); settle(pg, 900)
    toasts = pg.evaluate("() => window.__dc.toasts")
    ok(any("Changed since last night" in t for t in toasts), "2. Approve a journal: the second check runs; the books differ: Changed since last night")
    ok(not rpcs(pg, "entry_decide") and not [c for c in calls(pg) if c[0] == "Bridge.post"], "2. refused: nothing posted, nothing recorded")
    ok(pg.locator("[data-suggest-row='d1:bank']").count() == 1 and "23 approved as made" in pg.inner_text("[data-suggest]"), "3. the promotion suggestion after 20 approvals (23)")
    ok(pg.locator("[data-suggest-row^='d3:']").count() == 0, "3. 6 approvals: no suggestion")
    pg.click("[data-suggest-row='d1:bank'] .btn"); settle(pg, 400)
    t = rpcs(pg, "trust_set")
    ok(len(t) == 1 and t[0][2] == {"p_client": "d1", "p_kind": "bank", "p_level": 1, "p_limit": None}, "3. Move: trust_set one level up")
    pg.click("[data-suggest-row='d1:bank'] .linkbtn"); settle(pg, 400)
    ok(rpcs(pg, "trust_dismiss")[0][2] == {"p_client": "d1", "p_kind": "bank"}, "3. Not now: trust_dismiss")
    pg.click("[data-tab=you]"); settle(pg)
    you = pg.inner_text(".dc-body")
    ok("Which ledger is the TDS on salary?" in you and "TDS on Salary 192" in you and "TDS Payable 192 Staff" in you, "4. a ledger to pick: both candidates")
    pick = pg.locator(".dc-you", has_text="Which ledger is the TDS")
    ok(pick.locator("button", has_text="Ask client").count() == 0 and pick.locator("button", has_text="Not needed").count() == 1, "4. no Ask client on it (it is the firm's), Not needed is there")
    ok("pick the TDS on salary ledger" not in you, "4. the payroll waiting on the pick is not shown twice")
    pick.locator("button", has_text="TDS Payable 192 Staff").click(); settle(pg, 400)
    ch = rpcs(pg, "finding_choose")
    ok(ch and ch[-1][2]["p_ref"] == "ledger:tds:TDS Payable 192 Staff", "4. a pick calls finding_choose with that ledger")
    pg.click("[data-tab=done]"); settle(pg)
    ok("GST set-off" not in pg.inner_text(".dc-body") and "Payroll" not in pg.inner_text(".dc-body"), "4. Done lists none of phase 2's own findings")
    pg.evaluate("() => { S.coId = 'd1'; S.view = 'company'; S.tab = 'settings'; S.loadingCo = false; delete S.setupList; render(); }")
    pg.wait_for_selector("[data-trust] .tl-row", timeout=15000); settle(pg, 500)
    ok(pg.get_attribute("[data-trust-kind=recurring] button:nth-child(2)", "aria-pressed") == "true" and pg.get_attribute("[data-trust-kind=payroll] button:nth-child(1)", "aria-pressed") == "true", "5. the levels as kept (Monthly: Do, then tell; the rest: Ask first, the default)")
    ok(pg.input_value("[data-trust-limit] input") == "100000" and "still waits for your Approve" in pg.inner_text("[data-trust]"), "5. the limit as kept; the line saying every entry still waits for Approve")
    pg.click("[data-trust-kind=setoff] button:nth-child(3)"); settle(pg, 300)
    t = rpcs(pg, "trust_set")
    ok(t and t[-1][2] == {"p_client": "d1", "p_kind": "setoff", "p_level": 2, "p_limit": None} and pg.get_attribute("[data-trust-kind=setoff] button:nth-child(3)", "aria-pressed") == "true", "5. the owner sets a level: trust_set")
    pg.fill("[data-trust-limit] input", "50000"); pg.click("[data-trust-limit] .btn"); settle(pg, 300)
    ok(rpcs(pg, "trust_set")[-1][2] == {"p_client": "d1", "p_kind": "*", "p_level": 0, "p_limit": 50000}, "5. the limit saved: trust_set for the client")
    ok("asked again, at most weekly" in pg.inner_text("[data-auto-note]") and "to your firm only" in pg.inner_text("[data-auto-note]"), "5. the reminder switch on: its line says weekly and test mode")
    ctx.close()
    ctx, pg = start(br, role="staff")
    pg.click("[data-tab=entries]"); settle(pg)
    ok(pg.locator("[data-suggest]").count() == 0, "3. staff: no promotion suggestion")
    pg.evaluate("() => { S.coId = 'd1'; S.view = 'company'; S.tab = 'settings'; S.loadingCo = false; delete S.setupList; render(); }")
    pg.wait_for_selector("[data-trust] .tl-row", timeout=15000); settle(pg, 400)
    ok(pg.locator("[data-trust] .tl-seg button[disabled]").count() == 15 and "Only the firm’s owner" in pg.inner_text("[data-trust]"), "5. staff: the levels shown, not changeable")
    ctx.close()
    ctx, pg = start(br, 390, 844)
    pg.click("[data-tab=entries]"); settle(pg)
    pg.click("[data-row='%s'] .dc-open" % ids["payroll"]); settle(pg, 200)
    ok(pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "6. phone: Entries with a journal open, no sideways scroll")
    pg.evaluate("() => { S.coId = 'd1'; S.view = 'company'; S.tab = 'settings'; S.loadingCo = false; delete S.setupList; render(); }")
    pg.wait_for_selector("[data-trust] .tl-row", timeout=15000); settle(pg, 400)
    ok(pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "6. phone: Client setup with the levels, no sideways scroll")
    ctx.close()
    br.close()
srv.shutdown()
errs = [e for e in errors if "Failed to load resource" not in e]
ok(not errs, "no page errors " + str(errs[:3]))
print("%d failed" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
