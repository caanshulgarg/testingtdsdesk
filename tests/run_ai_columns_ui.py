"""python3 run_ai_columns_ui.py - the one-time AI column reading by default on the Bank page (the owner, 24-Nov-2026), in
the React build, offline, a made-up statement, the AI stubbed (SheetAI.map answers by the header; no network, no key):
  1. a statement sheet whose headings FinCom does not know ("Txn On", "Money Out", "Running Total") is uploaded: read at
     once through the AI's mapping (no button), the statement says "Columns read as: ...", the mapping kept for the client
  2. Change: the person puts two columns right, Save and read again: the statement is read again with them, not charged
     twice, the line says "as you set them"
  3. the AI not available: the file is said as not read, "Choose the columns" lets the person choose, and it is read
  4. the 24Q page: "Columns read as: ..." of a salary sheet read by the AI, with Change
Screenshots (deviceScaleFactor 2, 1440 and 390 wide) into SHOTS (default scratchpad/shots-ai-columns). UI_PORT (8493)."""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UI_PORT") or 8493)
SHOTS = os.environ.get("SHOTS", "")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

CSV = "\n".join(["ZZ Sample Bank - account statement", "Account 000011112222", "",
  "Txn On,Remarks,Chq,Money Out,Money In,Running Total",
  '01/09/2026,Opening transfer,,,"10,000.00","10,000.00"',
  '02/09/2026,UPI to ZZ Grocer,,250.00,,"9,750.00"',
  '05/09/2026,NEFT from ZZ Buyer,UTR0001,,"1,250.50","11,000.50"',
  '07/09/2026,Cheque paid,000123,"1,000.50",,"10,000.00"'])
# the same with no balance column: the reader without headings cannot read it either
NOBAL = "\n".join(",".join(__import__("csv").reader([l]).__next__()[:5]) if l.count(",") else l for l in CSV.split("\n")).replace("10,000.00", "10000.00").replace("1,250.50", "1250.50").replace("1,000.50", "1000.50")
SETUP = """async (name) => {
  const c = newCompany({name}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank"; Store.saveCompany(c); render();
  await registersLoad();
  window.__ai = []; window.__charged = [];
  window.__aiOn = window.__aiOn === undefined ? true : window.__aiOn;
  SheetAI.map = async (req) => { window.__ai.push(req); if (!window.__aiOn) throw new Error("FinCom's AI is not available here");
    return {ok: true, map: {date: "Txn On", narration: "Remarks", ref: "Chq", debit: "Money Out", credit: "Money In", balance: "Running Total"}}; };
  return c.id; }"""
UPLOAD = """async (csv) => { const t0 = Date.now(); while (!(B() && B().cid === S.coId && !B().loading) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
  const f = new File([csv], "zz-statement-sep.csv", {type: "text/csv"}); await uploadStatements([f]); render(); return B().rows.length; }"""

def shot(pg, name):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=False)

def run(br, w, tag):
    ctx = br.new_context(viewport={"width": w, "height": 900}, device_scale_factor=2); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    print("1. (%s) a sheet with unknown headings, uploaded" % tag)
    cid = pg.evaluate(SETUP, "ZZ Test Client"); pg.wait_for_timeout(800)
    # charge() spied: the first read is charged as before, the second (columns put right) is not
    pg.evaluate("() => { const was = charge; window.charge = async (...a) => { window.__charged.push(a); return true; }; }")
    n = pg.evaluate(UPLOAD, CSV); pg.wait_for_timeout(900)
    ok(n == 4, "the 4 lines are read at once (%s)" % n)
    ok(pg.evaluate("window.__ai.length") == 1 and pg.evaluate("window.__ai[0].side") == "bank", "the AI was asked once, side bank")
    line = pg.locator("#app [data-cols-read]")
    ok(line.count() == 1 and line.get_attribute("data-cols-read") == "ai", "the statement shows its Columns read as line")
    t = line.inner_text() if line.count() else ""
    ok("Columns read as: " in t and "Date ← “Txn On”" in t and "Withdrawal ← “Money Out”" in t and "Balance ← “Running Total”" in t, "in plain words: " + t[:120].replace("\n", " "))
    ok(pg.evaluate("(cid) => Object.keys(CO(cid).aiColumns || {}).filter(k => k.startsWith('bank:h')).length", cid) == 1, "kept for this client and this layout")
    ok(pg.evaluate("B().rows.map(r => r.debit + '/' + r.credit).join(' ')") == "0/10000 250/0 0/1250.5 1000.5/0", "the figures as read through the mapping")
    shot(pg, "%s-1-columns-read" % tag)
    print("2. (%s) Change: two columns put right, read again" % tag)
    pg.click("#app [data-cols-change]"); pg.wait_for_timeout(300)
    ok(pg.locator("#app [data-cols-pick] select").count() == 9, "the choice: one list for each field")
    pg.select_option('#app [data-cols-pick] select[data-cols-field="debit"]', "Money In"); pg.select_option('#app [data-cols-pick] select[data-cols-field="credit"]', "Money Out"); pg.wait_for_timeout(200)
    shot(pg, "%s-2-change" % tag)
    ch0 = pg.evaluate("window.__charged.length")
    pg.click("#app [data-cols-save]"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("B().rows.map(r => r.debit + '/' + r.credit).join(' ')") == "10000/0 0/250 1250.5/0 0/1000.5", "read again with the columns as set")
    ok(pg.evaluate("B().stmts.length") == 1, "one statement (the first put aside, kept to restore)")
    ok(pg.evaluate("window.__charged.length") == ch0, "not charged twice")
    ok(pg.evaluate("window.__ai.length") == 1, "no AI call for it")
    l2 = pg.locator("#app [data-cols-read]")
    ok(l2.count() == 1 and l2.get_attribute("data-cols-read") == "person" and "as you set them" in l2.inner_text(), "the line says the columns are as the person set them")
    shot(pg, "%s-3-as-set" % tag)
    print("3. (%s) the AI not available: Choose the columns" % tag)
    pg.evaluate("() => { window.__aiOn = false; }")
    pg.evaluate(SETUP, "ZZ Other Client"); pg.wait_for_timeout(800)
    pg.evaluate(UPLOAD, NOBAL); pg.wait_for_timeout(900)
    if not pg.locator("#app [data-cols-choose]").count(): print("       (", pg.evaluate("() => JSON.stringify({rows: B().rows.length, cid: B().cid, co: S.coId, fail: B().lastFail && {msg: B().lastFail.msg, head: B().lastFail.head}, ai: window.__ai.length, on: window.__aiOn})"), ")")
    ok(pg.locator("#app [data-cols-choose]").count() == 1 and "was not read" in pg.inner_text("#app .bk-alert.bad"), "not read, said, with Choose the columns")
    if not pg.locator("#app [data-cols-open]").count(): ctx.close(); return
    pg.click("#app [data-cols-open]"); pg.wait_for_timeout(300)
    for f, h in [("date", "Txn On"), ("narr", "Remarks"), ("debit", "Money Out"), ("credit", "Money In")]:
        pg.select_option('#app [data-cols-pick] select[data-cols-field="%s"]' % f, h)
    shot(pg, "%s-4-choose" % tag)
    pg.click("#app [data-cols-save]"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("B().rows.length") == 4 and pg.locator("#app [data-cols-read]").get_attribute("data-cols-read") == "person", "read with the columns chosen; kept as the person's")
    pg.evaluate("() => { window.__aiOn = true; }")
    print("4. (%s) the 24Q page" % tag)
    r = pg.evaluate("""async () => { try {
      S.books = Object.assign(S.books || {}, {cid: S.coId, salary: [{name: "ZZ Person One", pan: "AAAPZ1234A", date: "2026-09-30", gross: 50000, tds: 2500}],
        salaryCols: {kind: "salary", how: "ai", head: ["Staff", "Tax No", "Pay Month", "Total Pay", "IT Deducted"], map: {name: "Staff", pan: "Tax No", month: "Pay Month", gross: "Total Pay", tds: "IT Deducted"}}});
      S.tab = "books"; S.booksTab = "tds"; S.tdsFy = "2026-27"; S.tdsQ = "Q2"; S.tdsForm = "24Q"; S.tdsView = "return"; S.tdsTab = "people"; render(); return "ok"; } catch (e) { return String(e); } }""")
    pg.wait_for_timeout(2500)
    sc = pg.locator("#app [data-salary-cols]")
    ok(sc.count() == 1 and "TDS ← “IT Deducted”" in sc.inner_text(), "the salary sheet's Columns read as line (%s)" % r)
    if sc.count():
        sc.scroll_into_view_if_needed(); shot(pg, "%s-5-24q" % tag)
        pg.click("#app [data-salary-cols-change]"); pg.wait_for_timeout(300)
        ok(pg.locator("#app [data-salary-cols] select").count() == 8, "Change: one list for each salary field")
        shot(pg, "%s-6-24q-change" % tag)
    ctx.close()

with sync_playwright() as p:
    br = p.chromium.launch()
    run(br, 1440, "desktop")
    run(br, 390, "phone")
    br.close()
errs = [e for e in errors if "ResizeObserver" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:3])))
print("\n%d failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
