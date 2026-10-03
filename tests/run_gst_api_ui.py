"""python3 run_gst_api_ui.py - stage 5 (tax-accuracy), the GST API in the app, with the firm's server function stood in:
the access period on connecting and its end shown, the reminder 3 days before, Fetch now for the filed GSTR-1 and 3B
(brought into the books), returns the daily run fetched brought in on opening, the filed returns against FinCom's
working month by month, Settings → GST API (all clients), and the e-invoice: the IRP's JSON from a sales invoice, IRN,
e-way bill and cancel. Needs no client data. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gst_api_ui.py"""
import json, os, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8174), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors, calls = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
G = "09AANFG3202D1ZR"; G2 = "07AAACT1234A1Z5"
iso = lambda d: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + d * 86400))
R1 = {"gstin": G, "fp": "082026", "b2b": [{"ctin": "07AAACB1234C1Z5", "inv": [{"inum": "S1", "itms": [{"itm_det": {"txval": 1000, "rt": 18, "iamt": 180}}]}]}],
      "cdnr": [{"ctin": "07AAACB1234C1Z5", "nt": [{"ntty": "C", "itms": [{"itm_det": {"txval": 100, "iamt": 18}}]}]}]}
R3B = {"sup_details": {"osup_det": {"txval": 900, "iamt": 162, "camt": 0, "samt": 0, "csamt": 0}}, "itc_elg": {"itc_net": {"iamt": 50, "camt": 10, "samt": 10, "csamt": 0}}}
SERVER = {"sessions": [{"gstin": G, "username": "u09", "until": iso(1), "connectedAt": iso(-28), "error": None, "accessDays": 30, "accessUntil": iso(2), "endedAt": None}],
          "returns": [{"gstin": G, "form": "3B", "period": "082026", "status": "ok", "fetched_at": iso(-0.1), "fetched_by": None}], "einv": []}
def fake(route):
    b = json.loads(route.request.post_data or "{}"); calls.append(b); a = b.get("action")
    if a == "status": r = {"ok": True, "sessions": [s for s in SERVER["sessions"] if s["gstin"] in b["gstins"]]}
    elif a == "returns": r = {"ok": True, "returns": [x for x in SERVER["returns"] if x["gstin"] in b["gstins"]]}
    elif a == "return": r = {"ok": True, "ret": {"gstin": b["gstin"], "form": b["form"], "period": b["period"], "status": "ok", "fetched_at": iso(0), "data": R1 if b["form"] == "R1" else R3B}}
    elif a == "fetch":
        SERVER["returns"].append({"gstin": b["gstin"], "form": b["form"], "period": b["period"], "status": "ok", "fetched_at": iso(0), "fetched_by": "u"}); r = {"ok": True, "status": "ok"}
    elif a == "auth": r = {"ok": True, "until": iso(0.25), "accessUntil": iso(b.get("days", 30)), "accessDays": b.get("days")}
    elif a == "einv-status": r = {"ok": True, "accounts": SERVER["einv"], "host": "sandbox"}
    elif a == "einv-login": SERVER["einv"] = [{"gstin": b["gstin"], "username": b["username"], "token_until": iso(0.2)}]; r = {"ok": True, "host": "sandbox"}
    elif a == "irn": r = {"ok": True, "irn": "IRN123", "ackNo": "1120", "ackDt": iso(0), "signedQr": "QRTEXT"}
    elif a == "ewb": r = {"ok": True, "ewbNo": "3310001", "ewbDate": iso(0), "validTill": iso(1)}
    elif a == "irn-cancel": r = {"ok": True}
    else: r = {"ok": False, "error": "?"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(r))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/functions/v1/gst-taxpro", fake)
    pg.goto("http://localhost:8174/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate("""(g) => { Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://example.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: 't'}); Cloud.fresh = async () => {};
      S.account = {email: 'a@b.c'}; S.gstReg = '09'; S.gstYm = '202608'; S.books = {twoBs: {}, filed: {}}; window.saveBooks = () => {};
      GSTR.gstins = () => [g]; GSTAPI.gstinOf = () => g; GSTAPI.user = () => 'u09'; GSTRev.fyMonths = () => ['202606', '202607', '202608'];
      window.render = FinComReact.redraw; document.getElementById('app').innerHTML = '<div data-react="GstApiCard"></div>'; }""", G)
    draw = lambda: pg.evaluate("FinComReact.redraw(), document.getElementById('app').innerHTML")
    draw(); pg.wait_for_timeout(1200); h = draw()
    ok("API access ends" in h and "day" in h and "left" in h, "connected: the end of the API access period and the days left are shown")
    ok('data-reminder="' + G + '"' in h and "Ask the taxpayer to allow API access again" in h, "2 days left: the reminder")
    ok(pg.evaluate("!!(S.books.filed3b || {})['" + G + "|202608']"), "the 3B the daily run fetched is brought into the books on opening")
    ok("3B fetched" in h and "(daily run)" in h, "the card says what the server has for the month (3B by the daily run)")
    pg.click("text=Fetch filed GSTR-1"); pg.wait_for_timeout(1000); h = draw()
    f1 = pg.evaluate("(S.books.filed || {})['" + G + "|082026']")
    ok(any(c.get("action") == "fetch" and c.get("form") == "R1" and c.get("period") == "082026" for c in calls) and f1 and f1["source"] == "portal" and f1["via"] == "api", "Fetch filed GSTR-1: fetched by the server, kept with the books as the portal's copy")
    # connecting with an access period
    SERVER["sessions"] = []; pg.evaluate("GSTAPI.seen = {}; GSTAPI.sess = {'" + G + "': {sentAt: Date.now()}}"); draw(); pg.wait_for_timeout(600); draw()
    pg.fill('input[aria-label="OTP"]', "575757"); pg.select_option('select[aria-label="API access period"]', "7"); draw()
    pg.click("button:has-text('Connect')"); pg.wait_for_timeout(800)
    ok(any(c.get("action") == "auth" and c.get("days") == 7 for c in calls) and pg.evaluate("GSTAPI.sess['" + G + "'].accessDays") == 7, "Connect sends the access period chosen (7 days) and keeps its end")
    # filed against FinCom's working, month by month
    pg.evaluate("""() => { GSTR.one = () => ({b2b: [{taxable: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0}], b2cl: [], b2c: [], cdnr: [{taxable: 100, igst: 18, cgst: 0, sgst: 0, cess: 0, note: 'credit'}], exp: []});
      GSTR.months = () => ['202606', '202607', '202608']; GSTR.threeBJson = () => ({sup_details: {osup_det: {txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0}}, itc_elg: {itc_net: {iamt: 50, camt: 10, samt: 10, csamt: 0}}}); }""")
    m = pg.evaluate("GSTCMP.month('202608', '09')")
    ok(m["r1"] and not m["r1"]["any"], "GSTR-1 filed (B2B 1,000 less a credit note of 100) agrees with FinCom's working")
    row = next(r for r in m["r3b"]["rows"] if r["label"].startswith("3.1(a)"))
    ok(m["r3b"]["any"] and row["any"] and row["d"]["taxable"] == 100 and row["d"]["igst"] == 18, "3B 3.1(a): filed 900 / 162 against FinCom's 1,000 / 180: a difference of 100 and 18")
    pg.evaluate("document.getElementById('app').innerHTML = '<div data-react=\"FiledCompare\"></div>'"); draw(); pg.wait_for_timeout(500); h = draw()
    ok('data-cmp="year"' in h and "differs" in h and "matches" in h and "GSTR-3B, " in h, "Filed vs FinCom: the year's months, and the month's tables")
    # Settings → GST API (all clients)
    SERVER["sessions"] = [{"gstin": G, "username": "u09", "until": iso(1), "connectedAt": iso(-28), "error": None, "accessDays": 30, "accessUntil": iso(2), "endedAt": None},
                          {"gstin": G2, "username": "u07", "until": iso(-1), "connectedAt": iso(-40), "error": "API access period has ended", "accessDays": 30, "accessUntil": iso(-10), "endedAt": iso(-10)}]
    pg.evaluate("""([g, g2]) => { S.companies = {a: {id: 'a', name: 'Alpha', gstin: g}, b: {id: 'b', name: 'Beta', gstin: g2}, c: {id: 'c', name: 'Gamma', gstin: '27AAACG1234A1Z5'}};
      S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'gstapi'; document.getElementById('app').innerHTML = '<div data-react="GstApiAll"></div>'; }""", [G, G2])
    draw(); pg.wait_for_timeout(1000); h = draw()
    ok('data-gstin="' + G + '" data-state="soon"' in h and 'data-gstin="' + G2 + '" data-state="ended"' in h and 'data-state="none"' in h, "all clients: ending soon, ended, not connected, each shown")
    ok("Ending soon <b>1</b>" in h and "sandbox" in h, "the count of those ending soon; the e-invoice host (sandbox) said")
    # e-invoice from a sales invoice
    pg.evaluate("""(g) => { const co = {id: 'a', name: 'Alpha Pvt Ltd', gstin: g}; S.companies = {a: co}; window.SL = () => ({cid: 'a', cfg: {address: 'Plot 4, Sector 62\\nNoida 201301'}, list: []}); window.CO = () => co; window.saveSales = () => {};
      window.__v = {id: 'sv-1', x: {number: 'SI/26/001', date: '2026-09-30', customerName: 'Buyer Ltd', customerGstin: '07AAACB1234C1Z5', address: '1 Main Road, New Delhi 110001', pos: '07',
        items: [{desc: 'Widgets', hsn: '847130', qty: 10, unit: 'Nos', rate: 100, taxable: 1000, gstRate: 18}], taxable: 1000, igst: 180, total: 1180}}; }""", G)
    inv = pg.evaluate("EINV.build(window.__v, CO(), SL().cfg)")
    it = inv["ItemList"][0]
    ok(inv["DocDtls"] == {"Typ": "INV", "No": "SI/26/001", "Dt": "30/09/2026"} and inv["SellerDtls"]["Pin"] == 201301 and inv["SellerDtls"]["Loc"] == "Noida" and inv["BuyerDtls"]["Pin"] == 110001 and inv["BuyerDtls"]["Loc"] == "New Delhi" and inv["BuyerDtls"]["Pos"] == "07",
       "the IRP's JSON: document, seller and buyer with PIN, place and place of supply")
    ok(it["HsnCd"] == "847130" and it["Unit"] == "NOS" and it["IgstAmt"] == 180 and it["CgstAmt"] == 0 and inv["ValDtls"]["TotInvVal"] == 1180, "items: HSN, unit code, IGST for another state; total ₹1,180")
    ok(pg.evaluate("EINV.problems(window.__v, CO(), SL().cfg).length") == 0 and "PIN" in pg.evaluate("EINV.problems(Object.assign({}, window.__v, {x: Object.assign({}, window.__v.x, {address: 'Delhi'})}), CO(), SL().cfg).join(' ')"), "nothing missing; a buyer address without a PIN code is caught")
    pg.evaluate("(g) => EINV.login(g, 'irpuser', 'secret')", G); pg.wait_for_timeout(300)
    ok(pg.evaluate("JSON.stringify(EINV.accounts)").find("secret") < 0 and pg.evaluate("localStorage.length >= 0 && !JSON.stringify(localStorage).includes('secret')"), "the e-invoice password is sent to the server, kept nowhere in the browser")
    j = pg.evaluate("EINV.irn(window.__v).then(() => window.__v.x)"); 
    ok(j["irn"] == "IRN123" and j["ackNo"] == "1120" and j["signedQr"] == "QRTEXT" and any(c.get("action") == "irn" and c.get("docKey") == "sv-1" and c["inv"]["DocDtls"]["No"] == "SI/26/001" for c in calls), "Make the IRN: sent, and the IRN, acknowledgement and QR kept on the invoice")
    j = pg.evaluate("EINV.ewb(window.__v, {distance: 120, vehicleNo: 'DL01AB1234', mode: '1'}).then(() => window.__v.x)")
    ok(j["ewayNo"] == "3310001", "e-way bill made from the IRN; its number kept on the invoice")
    html = pg.evaluate("invoiceHtml(window.__v.x, CO(), SL().cfg)")
    ok("IRN: IRN123" in html and "Ack. No.: 1120" in html and "einvqr" in html and "3310001" in html, "the printed invoice carries the IRN, acknowledgement, signed QR and e-way bill number")
    pg.evaluate("EINV.cancel(window.__v, '2', 'test')"); pg.wait_for_timeout(200)
    ok(pg.evaluate("window.__v.x.irnStatus") == "cancelled" and "IRN CANCELLED" in pg.evaluate("invoiceHtml(window.__v.x, CO(), SL().cfg)"), "IRN cancelled: the printed invoice says so and has no QR")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
