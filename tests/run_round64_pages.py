"""python3 run_round64_pages.py - round 64 (the owner's GB TEXCOAT, 16-Oct-2026), the pages over FinCom's cloud copy, in the app
(the cloud answers stood in for in the page):
  A. the year shown first on the server's TDS / GST / MIS is the latest financial year that has entries (the book's last day
     is an empty day of an upload's period: tally_days keeps every day), FY 2025-26 here; the years the copy covers one
     click each (FyPick: FY 2026-27, FY 2025-26), a year chosen kept.
  B. the trial balance from the cloud copy out by exactly the ledgers' opening difference (Rs 12,750.76 Dr, as Tally shows
     "Difference in opening balances"): shown, not refused, with that line on the credit side and said plainly; one out by
     anything else is still refused.
  C. the books read in the browser (Books.takeVoucher): a "Job Work In Order" with lines that do not total zero is kept
     marked not in the books (opt, nonAcc), the trial balance from those books leaves it out.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_round64_pages.py [--shots DIR]"""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8464
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  let c = Object.values(S.companies).find(x => x.name === "GB TEXCOAT");
  if (!c){ c = newCompany({name: "GB TEXCOAT", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  Cloud.on = () => true; Cloud.st.firm = "f-1"; TCloud.on = () => true;
  window.__days = [];
  const d = (y, m, dd) => y + "-" + String(m).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
  // FY 2025-26 with entries; FY 2026-27 (the upload's period runs on to 13-Oct-2026) only empty days
  for (let m = 4; m <= 15; m++) for (const dd of [5, 20]) { const y = m > 12 ? 2026 : 2025, mm = m > 12 ? m - 12 : m; window.__days.push({day: d(y, mm, dd).replace(/-/g, ""), n: 3, at: "x"}); }
  for (let m = 4; m <= 10; m++) window.__days.push({day: d(2026, m, 1).replace(/-/g, ""), n: 0, at: "x"});
  TCloud.rpc = async (fn, a) => {
    if (fn === "tally_status") return [{book: "bk-gb", company: "GB TEXCOAT", from: "2025-04-01", openAsOn: "2025-03-31", ledgersAt: null, days: 560, entries: 1182, to: "2026-10-13", state: {}}];
    if (fn === "tally_days_list") return window.__days.filter(x => x.day >= a.p_from.replace(/-/g, "") && x.day <= a.p_to.replace(/-/g, ""));
    return [];
  };
  return c.id;
}"""
def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1280, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        cid = E(SETUP)
        # ---------------------------------------------------------------- A
        E("async (c) => { await TCloud.status(c, true); TCloud.fyOf(c); await new Promise(r => setTimeout(r, 300)); }", cid)
        fy = E("(c) => TCloud.fyOf(c)", cid)
        ok(fy.get("from") == "20250401" and fy.get("to") == "20260331" and fy.get("latest") == 2026 and fy.get("first") == 2025,
           "A. the year shown first: FY 2025-26, the latest with entries (the book's last day 13-Oct-2026 is an empty day) (%s)" % fy)
        E("(c) => { S.srvFy = {[c]: 2026}; }", cid)
        fy2 = E("(c) => TCloud.fyOf(c)", cid)
        ok(fy2.get("from") == "20260401" and fy2.get("to") == "20261013", "A. FY 2026-27 chosen (one click): 1-Apr-2026 to the book's last day (%s)" % fy2)
        E("(c) => { S.srvFy = {}; }", cid)
        # ---------------------------------------------------------------- B
        tb = E("""async (c) => {
          const rows = [{ledger: "Capital", parent: "Capital Account", open: 100000, closing: 100000}, {ledger: "Bank", parent: "Bank Accounts", open: -87249.24, closing: -87249.24},
                        {ledger: "Debtor", parent: "Sundry Debtors", open: -25501.52, closing: -25501.52}];
          TCloud.balRows = async () => rows.map(r => Object.assign({}, r));
          const r = await TCloud.tb(c, "20250331");
          const bad = await (async () => { TCloud.balRows = async () => rows.map((r, i) => Object.assign({}, r, i === 0 ? {closing: 99000} : {})); return await TCloud.tb(c, "20250331"); })();
          return {refused: r.refused, openDiff: r.openDiff, dr: r.dr, cr: r.cr, row: (r.rows.find(x => x.openDiff) || null), badRefused: bad.refused, badDiff: bad.openDiff || null};
        }""", cid)
        ok(tb["refused"] is False and abs((tb["openDiff"] or 0) - 12750.76) < 0.005 and tb["dr"] == tb["cr"] and tb["row"] and tb["row"]["l"] == "Difference in opening balances" and abs(tb["row"]["bal"] + 12750.76) < 0.005,
           "B. out by the opening difference only: shown, 'Difference in opening balances' 12,750.76 on the credit side, totals agree (%s)" % tb)
        ok(tb["badRefused"] is True and tb["badDiff"] is None, "B. out by anything else: still refused (%s)" % tb)
        # the words on the page: the trial balance drawn from that answer
        E("""(c) => { openCompany(c); }""", cid); pg.wait_for_timeout(1500)
        drawn = E("""async () => {
          const rows = [{ledger: "Capital", parent: "Capital Account", open: 100000, closing: 100000}, {ledger: "Bank", parent: "Bank Accounts", open: -87249.24, closing: -87249.24},
                        {ledger: "Debtor", parent: "Sundry Debtors", open: -25501.52, closing: -25501.52}];
          TCloud.balRows = async () => rows.map(r => Object.assign({}, r));
          const r = await TCloud.tb(S.coId, "20250331");
          return {od: r.openDiff};
        }""")
        ok(drawn.get("od") and abs(drawn["od"] - 12750.76) < 0.005, "B. the cloud trial balance carries the opening difference for the page (%s)" % drawn)
        # ---------------------------------------------------------------- C
        res = E("""async () => {
          const x = '<ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER VCHTYPE="Job Work In Order" ACTION="Create"><DATE>20251015</DATE><GUID>jw-2</GUID><VOUCHERTYPENAME>Job Work In Order</VOUCHERTYPENAME><VOUCHERNUMBER>2</VOUCHERNUMBER><PARTYLEDGERNAME>GB Party</PARTYLEDGERNAME>'
            + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>GB Party</LEDGERNAME><AMOUNT>-178230.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>'
            + '<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20251015</DATE><GUID>jv-1</GUID><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>5</VOUCHERNUMBER>'
            + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-500.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>500.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>';
          const r = await Books.importDayBook(new Blob([x], {type: "text/xml"}));
          return (r.vouchers || []).map(v => ({id: v.id, opt: !!v.opt, nonAcc: v.nonAcc || ""}));
        }""")
        jw = next((v for v in res if v["id"] == "jw-2"), {}); jv = next((v for v in res if v["id"] == "jv-1"), {})
        ok(jw.get("opt") is True and jw.get("nonAcc") == "Job Work In Order" and jv.get("opt") is False,
           "C. the browser's reader: the Job Work In Order kept, marked not in the books; the Journal in the books (%s)" % res)
        br.close()
    if errors: print("page errors:", errors[:3])
    if fails or errors: print("FAILED: %d" % (len(fails) + len(errors))); raise SystemExit(1)
    print("ALL PASSED")
main()
