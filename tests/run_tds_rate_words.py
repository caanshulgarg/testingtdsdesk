"""python3 run_tds_rate_words.py - review M1 of 2.4.0 part 2 (08-Oct-2026): a TDS rate FinCom worked out (the owner's
decision of 07-Oct-2026, option A: "Work out the rate as tax divided by assessable amount where Tally stores 0, and mark it
as worked out") must never look like Tally's own. The TDS details reach the app through tally_tds_details_marked(book)
(migration 62: 57's tally_tds_details with rate_worked_out and exempt); the TDS tab lists them under "TDS on Tally's
entries" and says, in words, where each rate came from:
  - worked out:          "2% · rate worked out: Tally stored 0 (TDS ÷ assessable amount)"
  - Tally marked exempt: "0% · exempt in Tally: no rate worked out" (review L2: never worked out on such a line)
  - Tally's own rate:    "2%" and nothing more
The rows the stand-in cloud answers are the function's own columns (tests/run_migration62.py checks the function).
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
        ROW("g-own", 2, "ZZ Own Contractor", "Payment to Contractors", 2, 50000, 1000, False, False)]
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
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(600)
        # the words alone, as the TDS details give them
        w = pg.evaluate("(rows) => typeof TDS.tallyRateWords === 'function' ? rows.map((r) => TDS.tallyRateWords(r)) : null", ROWS)
        ok(w == ["2% · rate worked out: Tally stored 0 (TDS ÷ assessable amount)", "0% · exempt in Tally: no rate worked out", "2%"], "TDS.tallyRateWords: worked out, exempt, Tally's own (%s)" % w)
        pg.evaluate("""() => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = "f1"; Cloud.st.state = "ok";
          const c = newCompany({name: "ZZ TDS CO", gstin: "09AANFG3202D1ZR"}); c.id = "zztdsclient"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true};
          S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "tds"; S.books = null; render(); }""")
        seen = False
        for _ in range(60):
            if pg.locator("[data-tds-lines]").count() and "ZZ Exempt Contractor" in pg.inner_text("[data-tds-lines]"): seen = True; break
            pg.wait_for_timeout(250)
        ok(seen, "the TDS tab lists TDS on Tally's entries (from tally_tds_details_marked)")
        ok(asked and asked[0].get("p_book") == BOOK, "the app asks tally_tds_details_marked for the client's book (%s)" % asked[:1])
        if seen:
            row = lambda name: pg.locator("[data-tds-lines] tr", has_text=name).inner_text()
            rw, rx, ro = row("ZZ Worked Contractor"), row("ZZ Exempt Contractor"), row("ZZ Own Contractor")
            ok("rate worked out: Tally stored 0" in rw, "the worked-out rate says so: %r" % rw)
            ok("exempt in Tally" in rx and "worked out:" not in rx, "the exempt line says Tally marked it exempt, no rate worked out: %r" % rx)
            ok("worked out" not in ro and "exempt" not in ro and "2%" in ro, "Tally's own rate carries no mark: %r" % ro)
            note = pg.inner_text("[data-tds-lines]")
            ok("1 rate worked out by FinCom where Tally stored 0" in note and "1 marked exempt in Tally" in note, "the card says how many rates FinCom worked out and how many Tally marked exempt")
        br.close()
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
