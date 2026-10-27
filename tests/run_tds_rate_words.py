"""python3 run_tds_rate_words.py - review M1 of 2.4.0 part 2 (08-Oct-2026): a TDS rate FinCom worked out (the owner's
decision of 07-Oct-2026, option A: "Work out the rate as tax divided by assessable amount where Tally stores 0, and mark it
as worked out") must never look like Tally's own. The TDS details reach the app through tally_tds_details_marked(book)
(migration 62: 57's tally_tds_details with rate_worked_out and exempt); the TDS tab lists them under "TDS on Tally's
entries" and says, in words, where each rate came from:
  - worked out:          "2% · rate worked out: Tally stored 0 (TDS ÷ assessable amount)"
  - Tally marked exempt: "0% · exempt in Tally: no rate worked out" (review L2: never worked out on such a line)
  - Tally's own rate:    "2%" and nothing more
The rows the stand-in cloud answers are the function's own columns (tests/run_migration62.py checks the function).
Round 86 (19-Oct-2026): EXEMPTED Yes is exempt only when no tax was booked (real TallyPrime 7.1 writes it on a line that
deducted): such a line's words are the rate booked (TDS / assessable); and "TDS on Tally's entries" left the TDS tab (the
rows with a problem are under each return's Validate & file, "Checks from Tally": tests/run_tds_tallyrows_ui.py).
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
RED: before the app reads tally_tds_details_marked, no line and no words show."""
import os, sys, json, threading, functools, http.server
from urllib.parse import urlparse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_WORDS_PORT") or 8262)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
BOOK = "f79e4bc3-871d-4482-874d-000000000062"
ROW = lambda guid, n, party, nature, rate, base, tax, worked, exempt: {"book_id": BOOK, "guid": guid, "day": "2027-01-01", "line_no": n, "ledger": party, "nature": nature,
    "section": "", "section_from": "", "rate": rate, "assessable": base, "amount": tax, "party": party, "deductee_type": "Company - Resident", "rate_worked_out": worked, "exempt": exempt}
ROWS = [ROW("g-worked", 2, "ZZ Worked Contractor", "S231 Contract Work", 2, 100000, 2000, True, False),
        ROW("g-exempt", 2, "ZZ Exempt Contractor", "S231 Contract Work", 0, 100000, 2000, False, True),
        ROW("g-own", 2, "ZZ Own Contractor", "Payment to Contractors", 2, 50000, 1000, False, False),
        ROW("g-nil", 2, "ZZ Nil Contractor", "S231 Contract Work", 0, 100000, None, False, True)]
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
from playwright.sync_api import sync_playwright
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
asked = []
def route(rt):
    path = urlparse(rt.request.url).path; j = lambda o: rt.fulfill(status=200, content_type="application/json", body=json.dumps(o))
    if path.endswith("/rpc/tally_status"): return j([{"book": BOOK, "company": "ZZ TDS CO", "from": "2026-04-01", "openAsOn": "2026-03-31", "ledgersAt": "2026-10-01T06:00:00Z", "daysAt": "2026-10-01T07:00:00Z", "days": 1, "entries": 3, "to": "2027-01-01"}])
    if path.endswith("/rpc/tally_tds_details_marked"):
        asked.append(json.loads(rt.request.post_data or "{}")); return j(ROWS)
    if path.endswith("/rpc/tally_tds_summary"): return j({"from": "2026-04-01", "to": "2027-03-31", "mapped": False, "ledgers": []})
    return j([])
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.route(STAGE + "/**", route)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2000); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(600)
        # the words alone, as the TDS details give them
        w = pg.evaluate("(rows) => typeof TDS.tallyRateWords === 'function' ? rows.map((r) => TDS.tallyRateWords(r)) : null", ROWS)
        ok(w == ["2% · rate worked out: Tally stored 0 (TDS ÷ assessable amount)", "2%", "2%", "0% · exempt in Tally: no rate worked out"], "TDS.tallyRateWords: worked out; marked exempt but 2,000 deducted: the rate booked; Tally's own; exempt with no tax (%s)" % w)
        pg.evaluate("""() => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = "f1"; Cloud.st.state = "ok";
          const c = newCompany({name: "ZZ TDS CO", gstin: "09AANFG3202D1ZR"}); c.id = "zztdsclient"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true};
          S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "tds"; S.books = null; render(); }""")
        pg.wait_for_timeout(3000)
        ok(pg.locator("[data-tds-lines]").count() == 0 and "TDS on Tally" not in pg.inner_text("#app"), "round 86: the TDS tab no longer lists TDS on Tally's entries")
        br.close()
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
