"""python3 run_mis_sales.py - review of 01-Oct-2026: MIS "Sales, the period" is the Sales Accounts ledgers, as Tally's
profit and loss shows them, and other income (direct and indirect incomes) is on its own line. The tile counted the
taxable value of sale entries, and a customer's own line in some of them (1,49,860 too much on one client's year).
Made-up books here; when tests/data/books-cache.json is at hand (local only), also its year against Tally's figure."""
import json, os, threading, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8151), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
V = lambda i, d, t, party, ent, opt=False: {"id": "zz-%d" % i, "date": d, "type": t, "no": str(i), "party": party, "gstin": "", "pos": "", "cmp": "", "narr": "", "hsn": [],
                                            "cancel": False, "opt": opt, "ent": [{"l": l, "a": a, "r": None} for l, a in ent]}
BOOKS = {"groups": {"Sales Accounts": "", "Indirect Incomes": "", "Direct Incomes": "", "Current Assets": "", "Sundry Debtors": "Current Assets", "Current Liabilities": "", "Duties & Taxes": "Current Liabilities", "Bank Accounts": "Current Assets"},
         "under": {"ZZ Fees": "Sales Accounts", "ZZ Alpha": "Sundry Debtors", "ZZ Beta": "Sundry Debtors", "Output IGST": "Duties & Taxes", "ZZ Interest": "Indirect Incomes", "ZZ Bank": "Bank Accounts"},
         "vouchers": [
    V(1, "20250410", "Sales", "ZZ Alpha", [("ZZ Alpha", -11800), ("ZZ Fees", 10000), ("Output IGST", 1800)]),
    V(2, "20250415", "Sales", "", [("ZZ Beta", -5900), ("ZZ Fees", 5000), ("Output IGST", 900)]),                 # no party name on the entry
    V(3, "20250420", "Credit Note", "ZZ Alpha", [("ZZ Alpha", 2360), ("ZZ Fees", -2000), ("Output IGST", -360)]),
    V(4, "20250425", "Receipt", "ZZ Bank", [("ZZ Bank", -1500), ("ZZ Interest", 1500)]),                          # other income
    V(5, "20250428", "Sales", "ZZ Alpha", [("ZZ Alpha", -1180), ("ZZ Fees", 1000), ("Output IGST", 180)], opt=True),  # Optional: not counted
]}
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8151/index.html"); pg.wait_for_function("typeof MIS === 'object' && typeof Books === 'object'", timeout=60000)
    r = pg.evaluate("""(bk) => { S.books = Object.assign({map: {}}, bk); S.books.map = Books.mapLedgers(bk.vouchers, {}); const s = MIS.sales('20250401', '20260331');
      return {total: s.total, other: s.other, rows: s.rows.map(x => [x.party, x.t])}; }""", BOOKS)
    ok(r["total"] == 13000, "Sales: the Sales Accounts ledgers, 10,000 + 5,000 − 2,000 credit note, the Optional sale left out (%s)" % r["total"])
    ok(r["other"] == 1500, "other income on its own: 1,500 of interest (%s)" % r["other"])
    ok(abs(sum(x[1] for x in r["rows"]) - r["total"]) < 0.01, "the customers add up to the tile (%s)" % r["rows"])
    # with the client's own books, when at hand: the tile is Tally's Sales Accounts for the year
    cache = os.path.join(HERE, "data", "books-cache.json")
    if os.path.exists(cache):
        bk = json.load(open(cache))
        t = pg.evaluate("""(bk) => { S.books = Object.assign({map: {}}, bk); S.books.map = Books.mapLedgers(bk.vouchers, {}); const s = MIS.sales('20250401', '20260331'); return [s.total, s.other]; }""", bk)
        ok(t[0] == 18291456.2 and t[1] == 0, "the client's year: Sales 1,82,91,456.20 as in Tally, no other income (%s)" % t)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
