"""python3 run_tds_tallyrows_ui.py - round 86 (19-Oct-2026; the owner: "this is coming again and again"): the TDS rows of
Tally's entries read right, and one reason per section and month. On the fixture books (tdsgst_snapshot.py) with the
challans taken away, in the React build (app/dist-test, or TDSDESK_SITE):
  1. Deductions › Not matched: the reason said ONCE per section-month as a group header ("194C · May 2025 · 2 deductions ·
     TDS ₹4,000 — no challan yet …" with Add challan); the rows under it show only their own figures ("Not matched", no
     sentence); a TDS payment in Tally with no BSR code for that section is named instead ("Paid in Tally on 07-02-2026
     ₹10,000 — add its BSR code and serial") with Make it a challan, which makes the challan (from the voucher)
  2. the Challans step's Not matched list: the group's sentence once, not on every row
  3. no "TDS on Tally's entries" table on the TDS pages (home and every step of a return)
  4. Validate & file › "Checks from Tally" (folded): only the rows of the return's year and quarter with a real problem:
     the rate deducted not the law's (194C to a company at 1%), no PAN, section unknown; a row whose TDS is its own line's
     amount with no assessable amount (the old reader's) and a TDS-ledger echo are not there; the rate shown is the one
     booked, with "Tally's nature says 7.5%; 10% was deducted"; "exempt" never said on a row that deducted tax; the section
     from Tally's nature master where the row has none
TDS_ROWS_SHOTS=dir: screenshots at 1440 wide (default tests/out/tds-tallyrows)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_ROWS_PORT") or 8387)
SHOTS = os.environ.get("TDS_ROWS_SHOTS") or os.path.join(HERE, "out", "tds-tallyrows"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

# the cloud's TDS rows (tally_tds_details_marked's columns) as the stored rows of before the fix: 2025-26 Q4 (Jan-Mar 2026)
# unless said; GUID of a real entry of the books for the old reader's row (its TDS = its own line's amount)
TCLOUD = """(vid) => {
  const v = S.books.vouchers.find((x) => x.id === vid), la = Math.abs(v.ent[1].a), cid = S.coId;
  const R = (o) => Object.assign({book_id: "bk", guid: "g", day: "2026-02-10", line_no: 0, ledger: "", nature: "", section: "", section_from: "", rate: 0, assessable: null, amount: null, party: "", deductee_type: "", rate_worked_out: false, exempt: false}, o);
  const rows = [
    R({guid: vid, line_no: 1, ledger: v.ent[1].l, nature: "Rent", party: "ZZ Old Rent Landlord", assessable: 0, amount: la, day: "2026-01-20"}),                       // the old reader: TDS = the line
    R({guid: "gc", line_no: 0, ledger: "Contract Exp", nature: "Contractor", party: "ZZ Co Contractor", section: "194C", assessable: 100000, amount: 1000, rate: 1, day: "2026-02-11"}),   // 1% to a company
    R({guid: "gc", line_no: 1, ledger: "TDS Payable", nature: "Contractor", party: "ZZ Co Contractor", section: "194C", assessable: 0, amount: 65, day: "2026-02-11"}),                 // echo
    R({guid: "gp", line_no: 0, ledger: "Professional Fees", nature: "Professional Fees", party: "ZZ Nopan Advocate", assessable: 100000, amount: 10000, rate: 7.5, exempt: true, day: "2026-03-05"}), // 10% booked, 7.5% in Tally, "exempt"
    R({guid: "gr", line_no: 0, ledger: "Office Rent", nature: "Rent", party: "ZZ Pan Landlord", assessable: 50000, amount: 5000, rate: 10, day: "2026-03-06"}),          // no section anywhere
    R({guid: "gk", line_no: 0, ledger: "Contract Exp", nature: "Contractor", party: "ZZ Co Contractor", section: "194C", assessable: 50000, amount: 1000, rate: 2, day: "2026-03-07"}),     // clean
    R({guid: "gq", line_no: 0, ledger: "Contract Exp", nature: "Contractor", party: "ZZ Co Contractor", section: "194C", assessable: 50000, amount: 500, rate: 1, day: "2025-11-07"}),      // another quarter
  ];
  S.books.tdsNat = Object.assign({}, S.books.tdsNat || {}, {"Professional Fees": {cats: [["20200401", "194J", 7.5, 7.5, 20, 20, 30000, 0]]}});
  const pans = {"ZZ Co Contractor": "AAACZ1234Q", "ZZ Pan Landlord": "AAACP1234L", "ZZ Old Rent Landlord": "AAACR1234L"}, was = TDS.panOf.bind(TDS);
  TDS.panOf = (p) => pans[p] || was(p);
  TCloud.on = () => true; TCloud.book = () => ({book: "bk"}); TCloud.tdsl[cid] = {rows, at: Date.now() + 1e9};
  return la; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate("() => { S.tdsDedView = 'table'; S.tdsChView = 'match'; }")   # the Deductions checks here are of the table (All rows), the Challans ones of the two-panel matcher (round 88: the steps open on a challan and on the grid)
        J(LOAD, books); pg.wait_for_timeout(1000); J("S.books = window.__bk; render();"); pg.wait_for_timeout(500); J(CHALLANS); pg.wait_for_timeout(300)
        J("() => { S.books.challans = []; S.books.alloc = {}; render(); }"); pg.wait_for_timeout(300)
        go = lambda fy, q, step: (J("([fy, q, s]) => { S.booksTab = 'tds'; tdsGo(fy, q, '26Q'); S.tdsTab = s; S.tdsDedChF = ''; render(); }", [fy, q, step]), pg.wait_for_timeout(700))
        print("1. Deductions: one header per section and month")
        go("2025-26", "Q1", "deductions")
        hd = pg.locator("#app #tdsDnTable [data-dd-group]")
        ok(hd.count() == 1, "2025-26 Q1: one group header (%d)" % hd.count())
        h = hd.first.inner_text() if hd.count() else ""
        ok(h.startswith("194C · May 2025 · 2 deductions · TDS ₹4,000") and "no challan yet" in h, "the header: %r" % h)
        ok(pg.locator("#app #tdsDnTable [data-dd-group-add]").count() == 1, "the header's Add challan")
        inG = pg.locator("#app #tdsDnTable [data-dd-in-group]")
        ok(inG.count() == 2 and all(t.strip() == "Not matched" for t in inG.all_inner_texts()), "the two rows under it: only \"Not matched\" (%s)" % inG.all_inner_texts())
        trs = J("() => [...document.querySelectorAll('#app #tdsDnTable tbody tr')].map((tr) => tr.classList.contains('lt-grp') ? 'H' : tr.querySelector('[data-dd-in-group]') ? 'g' : 'r').join('')")
        ok("Hgg" in trs, "the rows follow their header (%s)" % trs)
        body = pg.inner_text("#app #tdsDnTable")
        ok(body.count("No challan paid yet") == 0 and body.count("no challan yet") == 1 and body.count("for these") == 0, "the reason said once, no sentence repeated on the rows")
        if hd.count(): pg.locator("#app #tdsDnTable [data-dd-group-add]").first.click(); pg.wait_for_timeout(400)
        ok(pg.locator("#app #tdsDnTable .dd-grp-add input").count() > 0, "Add challan opens the challan form under the header")
        go("2025-26", "Q4", "deductions")
        heads = pg.locator("#app #tdsDnTable [data-dd-group]").all_inner_texts()
        ok(len(heads) == 3, "2025-26 Q4: three groups (%s)" % heads)
        paid = [x for x in heads if x.startswith("194C · January 2026")]
        ok(paid and "Paid in Tally on 07-Feb-2026 ₹10,000" in paid[0], "a Tally payment without a BSR code named: %r" % (paid[:1],))
        ok(paid and "add its BSR code and serial" in paid[0] and "no challan" not in paid[0].lower(), "…not \"no challan\"")
        mk = pg.locator('#app #tdsDnTable [data-dd-group-step="bsr"] [data-dd-group-make]')
        ok(mk.count() == 1, "Make it a challan on that header")
        pg.screenshot(path=os.path.join(SHOTS, "deductions-not-matched-groups.png"), full_page=False)
        if mk.count():
            g = pg.locator('#app #tdsDnTable [data-dd-group-step="bsr"]').first
            g.locator('input[aria-label="BSR code or CIN"]').fill("0240020"); g.locator('input[aria-label="Challan serial"]').fill("00979"); mk.first.click(); pg.wait_for_timeout(700)
            ch = J("TDS.challans().filter((c) => c.fromVoucher).map((c) => [c.bsr, c.serial, c.tax])")
            ok(ch == [["0240020", "00979", 10000]], "Make it a challan: the challan made from Tally's payment (%s)" % ch)
            heads2 = pg.locator("#app #tdsDnTable [data-dd-group]").all_inner_texts()
            ok(not any("Paid in Tally" in x for x in heads2), "…and the header no longer asks for it (%s)" % heads2)
        print("2. Challans: Not matched, the sentence once")
        J("() => { S.books.challans = []; S.books.alloc = {}; render(); }"); go("2025-26", "Q1", "challans")
        J("() => { S.tdsChSel = '__none'; render(); }"); pg.wait_for_timeout(500)
        whys = pg.locator("#app [data-cm-none] [data-cm-why]").all_inner_texts()
        ok(len(whys) == 1 and "pay" in whys[0].lower() and "194C · May 2025 · 2 deductions" in whys[0], "one reason for the group, with the next step (%s)" % whys)
        ok(pg.locator("#app [data-cm-none] [data-cm-row]").count() == 2, "its two rows listed under it")
        print("3. no \"TDS on Tally's entries\" on the TDS pages")
        la = J(TCLOUD, J("() => S.books.vouchers.find((v) => (v.ent || []).length > 2).id"))
        J("() => { S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2025-26'; render(); }"); pg.wait_for_timeout(600)
        ok("TDS on Tally" not in J("document.getElementById('app').innerText") and pg.locator("#app [data-tds-lines]").count() == 0, "the TDS home: no TDS on Tally's entries")
        for step in ["deductor", "deductees", "challans", "deductions", "file"]:
            go("2025-26", "Q4", step)
            ok("TDS on Tally" not in J("document.getElementById('app').innerText") and pg.locator("#app [data-tds-lines]").count() == 0, "26Q Q4 %s: no TDS on Tally's entries" % step)
        print("4. Validate & file › Checks from Tally")
        go("2025-26", "Q4", "file")
        tc = pg.locator("#app [data-tally-checks]")
        ok(tc.count() == 1 and J("() => !document.querySelector('#app [data-tally-checks]').open"), "Checks from Tally, folded")
        if tc.count():
            pg.locator("#app [data-tally-checks] > summary").click(); pg.wait_for_timeout(400)
            ok(re.search(r"Checks from Tally · 3 rows to look at of 4", tc.inner_text()) is not None, "the summary: 3 of the quarter's 4 rows to look at (%r)" % tc.inner_text()[:80])
            rows = pg.locator("#app [data-tally-checks] tbody tr")
            txt = [r.inner_text().replace("\t", " | ") for r in rows.all()]
            for t in txt: print("       " + t)
            names = " ".join(txt)
            ok(rows.count() == 3, "three rows (%d)" % rows.count())
            ok("ZZ Old Rent Landlord" not in names, "the old reader's row (TDS = its own line ₹%s, no assessable) is not there" % la)
            ok("65.00" not in names and "₹65" not in names, "the TDS ledger's echo (₹65, no assessable) is not there")
            ok("01-Nov" not in names and "07-Nov-2025" not in names, "a row of another quarter is not there")
            co = [t for t in txt if "ZZ Co Contractor" in t]
            ok(len(co) == 1 and "1%" in co[0] and "law's rate is 2%" in co[0] and "194C" in co[0], "194C to a company at 1%%: the law's 2%% said (%s)" % co)
            adv = [t for t in txt if "ZZ Nopan Advocate" in t]
            ok(len(adv) == 1 and "10%" in adv[0] and "Tally’s nature says 7.5%; 10% was deducted" in adv[0] and "no PAN" in adv[0] and "194J" in adv[0], "the advocate: 10%% booked, Tally's 7.5%% said, no PAN, section from the nature (%s)" % adv)
            ok(not any("exempt" in t.lower() for t in txt), "\"exempt\" not said on rows that deducted tax")
            rent = [t for t in txt if "ZZ Pan Landlord" in t]
            ok(len(rent) == 1 and "section unknown" in rent[0], "a Rent row with no section anywhere: section unknown (%s)" % rent)
            tc.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
            pg.screenshot(path=os.path.join(SHOTS, "validate-checks-from-tally.png"), full_page=False)
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
