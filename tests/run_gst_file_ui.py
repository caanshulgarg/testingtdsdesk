"""python3 run_gst_file_ui.py - filing GSTR-1, IFF and GSTR-3B through the GST API in the app (17-Oct-2026, branch next-gst-file),
with the firm's server function stood in (answers shaped as gst-taxpro gives them on TaxPro's sandbox; never TaxPro):
  - the client's choice "File through": the browser helper by default (no API steps); gstFileRoute() says which;
  - GST API chosen but the GSTIN not connected: said, no steps;
  - connected: Save to portal -> the portal's summary beside FinCom's, the figure that differs highlighted -> confirm only
    with the box ticked and a reason -> Proceed to file -> Send OTP (the signatory's PAN) -> the OTP -> File -> the ARN,
    and the month marked filed with it (the typed date replaced); the OTP kept nowhere in the browser;
  - 3B: the set-off shown; a viewer sees the steps but cannot press them.
Screenshots (desktop) to TDSDESK_SHOTS (default tests/out/gst-file). Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_gst_file_ui.py"""
import json, os, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8176), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS") or os.path.join(HERE, "out", "gst-file"); os.makedirs(SHOTS, exist_ok=True)
fails, errors, calls = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
G, PAN, OTP = "09AANFG3202D1ZR", "ABCPG1234K", "246810"
iso = lambda d: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + d * 86400))
fig = lambda n, t, i, c=0, s=0: {"n": n, "txval": t, "iamt": i, "camt": c, "samt": s, "csamt": 0}
SV = {}   # the stand-in server's filings: (form, period) -> row
ROWS_R1 = [{"key": "B2B", "label": "B2B invoices (4A)", "fincom": fig(2, 1500, 270), "portal": fig(2, 1500, 269), "diff": fig(0, 0, 1), "differs": ["B2B.iamt"]},
           {"key": "B2CS", "label": "B2C small (7)", "fincom": fig(1, 300.5, 0, 27.05, 27.05), "portal": fig(1, 300.5, 0, 27.05, 27.05), "diff": fig(0, 0, 0), "differs": []}]
PLAN = {"pditc": {"liab_ldg_id": 501, "trans_typ": 30002, "i_pdi": 100, "i_pdc": 0, "i_pds": 0, "c_pdc": 20, "c_pdi": 0, "s_pds": 20, "s_pdi": 0, "cs_pdcs": 0},
        "pdcash": [], "cashNeeded": {"igst": 80, "cgst": 48, "sgst": 48, "cess": 0}, "short": {}, "cash": {"igst": {"tx": 100}, "cgst": {"tx": 50}, "sgst": {"tx": 50}, "cess": {"tx": 0}}}
def fake(route):
    b = json.loads(route.request.post_data or "{}"); calls.append(b); a = b.get("action"); k = (b.get("form"), b.get("period")); row = SV.get(k)
    def put(**x): SV[k] = dict(SV.get(k) or {"gstin": b.get("gstin"), "form": b.get("form"), "period": b.get("period")}, **x)
    if a == "status": r = {"ok": True, "sessions": [{"gstin": G, "username": "u09", "until": iso(1), "connectedAt": iso(-2), "error": None, "accessDays": 30, "accessUntil": iso(28), "endedAt": None}]}
    elif a == "returns": r = {"ok": True, "returns": []}
    elif a == "filing": r = {"ok": True, "filing": row, "log": [], "host": "sandbox"}
    elif a == "save": put(status="saved", save_state="P", save_ref="REF1", saved_at=iso(0)); r = {"ok": True, "saveState": "P", "ref": "REF1"}
    elif a == "summary":
        rows = ROWS_R1 if b["form"] != "3B" else [{"key": "3.1(a)", "label": "3.1(a)", "fincom": fig(0, 1000, 180, 50, 50), "portal": fig(0, 1000, 180, 50, 50), "diff": fig(0, 0, 0), "differs": []}]
        differs = [d for x in rows for d in x["differs"]]
        put(status="summary", diffs=differs); r = {"ok": True, "rows": rows, "differs": differs, "plan": PLAN if b["form"] == "3B" else None}
    elif a == "confirm":
        if (row or {}).get("diffs") and (sorted(b.get("accept") or []) != sorted(row["diffs"]) or not b.get("note")): r = {"ok": False, "error": "Accept each difference."}
        else: put(status="confirmed", confirmed_by="u-1", accepted=row.get("diffs") or [], accept_note=b.get("note") or None); r = {"ok": True}
    elif a == "proceed": put(status="proceeded"); r = {"ok": True}
    elif a == "evc_otp": put(otp_sent_at=iso(0), signatory_pan=b.get("pan")); r = {"ok": True} if b.get("pan") == PAN else {"ok": False, "error": "OTP0010"}
    elif a == "file":
        if b.get("otp") == OTP and b.get("pan") == PAN:
            arn = "AA09" + b["period"] + ("3" if b["form"] == "3B" else "1") + "00042X"; put(status="filed", arn=arn, filed_at=iso(0)); r = {"ok": True, "arn": arn, "filedAt": iso(0)}
        else: r = {"ok": False, "error": "Not filed: Invalid OTP ****** (OTP0012)"}
    else: r = {"ok": False, "error": "?"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(r))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1700}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/functions/v1/gst-taxpro", fake)
    pg.goto("http://localhost:8176/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)   # the firm's details: later
    pg.evaluate("""(g) => { Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://example.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: 't'}); Cloud.fresh = async () => {};
      S.account = {email: 'a@b.c', me: {role: 'owner'}}; S.gstReg = '09'; S.gstYm = '202608'; S.books = {twoBs: {}, filed: {}}; window.saveBooks = () => {}; window.ledgersReady = () => true;
      GSTR.gstins = () => [g]; GSTAPI.gstinOf = () => g; GSTAPI.user = () => 'u09'; GSTAmend.proof = () => null; GSTAmend.keep = () => {};
      GSTFILE.payload = (form, ym) => form === '3B' ? {gstin: g, ret_period: '082026'} : {gstin: g, fp: ym.slice(4) + ym.slice(0, 4), b2b: []};
      window.render = FinComReact.redraw; S.gstFileForm = 'R1'; document.getElementById('app').innerHTML = '<div style="max-width:1100px;margin:24px auto" data-react="GstFileApi"></div>'; }""", G)
    draw = lambda: pg.evaluate("FinComReact.redraw(), document.getElementById('app').innerHTML")
    def shot(name): pg.locator("[data-gst-file]").first.screenshot(path=os.path.join(SHOTS, name))
    def settle(ms=700): pg.wait_for_timeout(ms); return draw()
    draw(); h = settle(1500)
    for _ in range(3):   # the app's own first-run dialogs (the firm's details): closed, they are not this test's
        if not pg.locator("[data-state=open][aria-hidden=true]").count(): break
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    h = settle()
    ok('data-route="helper"' in h and "Browser helper" in h and 'data-gfile="save"' not in h and pg.evaluate("gstFileRoute()") == "helper", "by default the browser helper: no API steps; gstFileRoute() says helper")
    shot("1-helper-default.png")
    # GST API chosen, the GSTIN not connected
    pg.evaluate("GSTAPI.sess = {}"); pg.select_option('select[aria-label="File through"]', "api"); h = settle()
    ok(pg.evaluate("S.books.gstFileRoute") == "api" and pg.evaluate("gstFileRoute()") == "api" and 'data-ready="0"' in h and "not connected" in h, "GST API chosen, the GSTIN not connected: said, no steps")
    # connected (the existing per-client OTP session)
    pg.evaluate("GSTAPI.sess['%s'] = {until: Date.now() + 3600000, connectedAt: new Date().toISOString(), error: '', endedAt: '', accessUntil: '', accessDays: 30}" % G); h = settle(1000)
    ok('data-route="api"' in h and 'data-gfile="save"' in h and 'data-status="new"' in h and "sandbox" in h, "connected: the steps, starting with Save to portal; the sandbox said")
    pg.click('[data-gfile="save"]'); h = settle()
    ok(any(c.get("action") == "save" and c.get("form") == "R1" and c.get("period") == "082026" and c.get("payload", {}).get("fp") == "082026" for c in calls) and 'data-status="saved"' in h, "Save to portal: the return sent for 08-2026")
    pg.click('[data-gfile="summary"]'); h = settle()
    nd = pg.locator("td.gfile-diff").count()
    ok('data-gfile-compare' in h and nd == 2 and 'data-gfile-row="B2B" data-differs="1"' in h and 'data-gfile-row="B2CS" data-differs="0"' in h and "B2B invoices (4A): IGST" in h, "the portal's summary beside FinCom's: B2B IGST (270 against 269) highlighted, B2C small the same")
    ok(pg.locator('[data-gfile="confirm"]').is_disabled() and pg.locator('[data-gfile="proceed"]').is_disabled(), "confirm needs the box and a reason; proceed waits for the confirmation")
    shot("2-compare-differences.png")
    pg.check('input[aria-label="Accept the differences"]'); pg.fill('input[aria-label="Why the differences are accepted"]', "portal rounds S1"); draw()
    pg.click('[data-gfile="confirm"]'); h = settle()
    cf = next(c for c in calls if c.get("action") == "confirm")
    ok(cf["accept"] == ["B2B.iamt"] and cf["note"] == "portal rounds S1" and 'data-status="confirmed"' in h and "accepted" in h, "confirmed: the difference accepted with the reason")
    pg.click('[data-gfile="proceed"]'); h = settle()
    ok('data-status="proceeded"' in h and not pg.locator('[data-gfile="file"]').is_enabled(), "proceeded to file; File waits for the OTP")
    pg.fill('input[aria-label="Signatory PAN"]', PAN); draw(); pg.click('[data-gfile="evc_otp"]'); h = settle()
    ok(any(c.get("action") == "evc_otp" and c.get("pan") == PAN for c in calls) and "sent the OTP" in h, "Send OTP for the signatory's PAN")
    pg.fill('input[aria-label="EVC OTP"]', OTP); draw()
    shot("3-otp-and-file.png")
    pg.click('[data-gfile="file"]'); h = settle(1000)
    rec = pg.evaluate("GSTF.peek('202608', '09')")
    ok(any(c.get("action") == "file" and c.get("otp") == OTP for c in calls) and 'data-gfile-arn' in h and "AA09082026100042X" in h, "File (the person's click): the ARN shown")
    ok(rec.get("r1Arn") == "AA09082026100042X" and rec.get("r1Via") == "api" and len(rec.get("r1", "")) == 10, "the month marked filed with the ARN and date")
    ok(OTP not in pg.evaluate("JSON.stringify(S.books) + JSON.stringify(localStorage) + JSON.stringify(GSTFILE.st)") and OTP not in pg.evaluate("document.body.innerHTML"), "the OTP kept nowhere in the browser after filing")
    shot("4-filed-arn.png")
    # 3B: the set-off shown
    pg.evaluate("S.gstFileForm = '3B'; document.getElementById('app').innerHTML = '<div style=\"max-width:1100px;margin:24px auto\" data-react=\"GstFileApi\"></div>'"); draw(); h = settle(1000)
    pg.click('[data-gfile="save"]'); settle(); pg.click('[data-gfile="summary"]'); h = settle()
    ok('data-gfile-plan' in h and "Paid from credit" in h and "₹48.00" in h, "3B: the set-off from the credit and cash ledgers shown before proceeding")
    shot("5-3b-setoff.png")
    # a viewer
    pg.evaluate("S.account.me.role = 'viewer'"); h = settle()
    ok("Only the firm" in h and pg.locator('[data-gfile="confirm"]').is_disabled() and pg.locator('select[aria-label="File through"]').is_disabled(), "a viewer sees the steps; cannot press them or change the route")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
