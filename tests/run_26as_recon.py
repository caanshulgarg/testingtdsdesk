"""python3 run_26as_recon.py - Form 26AS / AIS / TIS against the books, by upload (TDS/GST round 2, item 2; AS26,
src/js/69-tds-26as.js; the client's Reconciliations › TDS receivable vs 26AS since tds-layout, 14-Oct-2026).

The files are made up in the layouts FinCom ASSUMES (tests/fixtures/tds-26as/; the government sites cannot be reached
from where FinCom is built, so no official sample was read): the 26AS text file (TRACES "Export as Text", fields split
by "^"), the AIS JSON, and PDFs made here from the same lines. The fixture books (ZZ TDSGST, PAN AAGCL4827M, TAN
DELZ12345A) get these TDS receivable entries in 2025-26:
  25-May  Quillfeather Weddings LLP  8,000     matched (26AS line 194C 25-May-2025)
  20-Aug  Quillfeather Weddings LLP  5,000     matched
  10-Nov  Vellichor Learning Foundation 2,000  matched; its 15-Jan-2026 line of 2,500 is only in 26AS
  10-Feb  Zinnia Retreats Pvt Ltd    3,000     26AS: ZINNIA RESORTS AND RETREATS LTD, 1,500 + 1,500 (one status U): not the
                                               same name, so only once the person links the TAN; then matched on the
                                               quarter's total
  15-Mar  Marigold Expo Services     1,000     only in the books
  31-Mar  a transfer between two receivable ledgers: not a credit
  26AS Part VI: TCS 12,000 by ACME MOTORS: only in 26AS.
The client as deductor: Juniper Legal Associates' own 26AS (PAN AAJFJ1234K) shows 6,000 (Q3) and 1,000 (Q2) under the
client's TAN and 5,000 under another TAN; FinCom's returns have 6,000 (Q3) and 3,000 (Q4).
Runs on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("AS26_PORT") or 8333)
FX = os.path.join(HERE, "fixtures", "tds-26as")
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "as26"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

from tdsgst_round2_data import BOOKS
OWN = """() => { const r = AS26.own('2025-26'); return r && {kind: r.file.kind, sum: r.sum, rows: r.rows.map(x => ({st: x.status, how: x.how || '', tan: x.line ? x.line.tan : '', tax: x.line ? x.line.tax : x.book.tax, party: x.book ? x.book.party : (x.group ? x.group[0].party : ''), sec: x.line ? x.line.section : '', q: (x.line || x.book).q, status: x.line ? x.line.status : ''})),
  ded: r.deductors.map(d => ({tan: d.tan, party: d.party.party, how: d.party.how, file: d.file, books: d.books, diff: d.diff, pending: d.pending})), booksOnly: r.booksOnly}; }"""
def rows(r, **kw): return [x for x in r["rows"] if all(x.get(k) == v for k, v in kw.items())]

def upload(pg, path):
    pg.set_input_files('#app [data-upload="as26"] input[type=file]', path); pg.wait_for_timeout(1500)

def make_pdf(br, lines, path):
    p2 = br.new_page()
    p2.set_content("<html><body style='font-family:Arial;font-size:9px'>" + "".join("<div style='white-space:pre;margin:3px 0'>%s</div>" % l for l in lines) + "</body></html>")
    open(path, "wb").write(p2.pdf(format="A4", landscape=True)); p2.close()

def lines_for_pdf(txt):
    """the 26AS text file's lines as a PDF prints them: the fields side by side"""
    out = ["Annual Tax Statement", "Permanent Account Number (PAN) AAGCL4827M   Current Status of PAN Active   Financial Year 2025-26   Assessment Year 2026-27",
           "Name of Assessee LARKSPUR FIXTURE EVENTS PRIVATE LIMITED"]
    for l in open(txt).read().splitlines()[2:]:
        f = [x for x in l.split("^") if x != ""]
        if not f or f[0].startswith("Sr.") or l.startswith("^Sr."): continue
        out.append(" ".join(f))
    return out

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        ok(pg.evaluate("BOOKS_KEYS.includes('tds26as') && BOOKS_KEYS.includes('tanParty')"), "the files read and the TANs linked are kept with the books (BOOKS_KEYS)")
        pg.evaluate(BOOKS); pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-as26]").count() == 1 and "Upload 26AS or AIS" in pg.inner_text("#app [data-as26]"), "Reconciliations › TDS receivable vs 26AS: the page with its upload")
        bc = pg.evaluate("AS26.bookCredits().map(x => [x.date, x.party, x.tax])")
        ok(len(bc) == 5 and ["20260331", "", 19000] not in bc, "the books' tax credit: the 5 debits to TDS receivable; the transfer between two receivable ledgers is not one (%s)" % bc)

        # ---- the client's 26AS, text
        upload(pg, os.path.join(FX, "client-26as-2025-26.txt"))
        f = pg.evaluate("AS26.files().map(f => ({kind: f.kind, pan: f.pan, fy: f.fy, n: f.rows.length, ok: f.check.ok, holder: f.holder, whose: AS26.whose(f)}))")
        ok(f == [{"kind": "26AS", "pan": "AAGCL4827M", "fy": "2025-26", "n": 7, "ok": True, "holder": "LARKSPUR FIXTURE EVENTS PRIVATE LIMITED", "whose": "own"}], "26AS text read: the client's own, 2025-26, 7 lines (Part I and Part VI), the lines add up to each deductor's totals (%s)" % f)
        r = pg.evaluate("AS26.files()[0].rows.map(x => [x.part, x.tan, x.section, x.date, x.status, x.amount, x.tax, x.deposited, x.q])")
        ok(["TDS", "DELQ12345A", "194C", "20250525", "F", 472000, 8000, 8000, "Q1"] in r and ["TCS", "DELA54321D", "206CL", "20260310", "F", 1200000, 12000, 12000, "Q4"] in r and ["TDS", "MUMZ12345C", "194C", "20260225", "U", 75000, 1500, 1500, "Q4"] in r,
           "each line: part, TAN, section, date, status of booking, amount paid, tax deducted, deposited, quarter")
        o = pg.evaluate(OWN)
        ok(o["sum"] == {"file": 32500, "books": 19000}, "26AS ₹32,500 against ₹19,000 in the books (%s)" % o["sum"])
        ok(len(rows(o, st="matched", tan="DELQ12345A")) == 2 and len(rows(o, st="matched", tan="DELV12345B", tax=2000)) == 1, "Quillfeather's two lines and Vellichor's 2,000 match the books line by line")
        ok(len(rows(o, st="file", tan="DELV12345B", tax=2500)) == 1, "Vellichor's 15-Jan-2026 line of 2,500: only in 26AS")
        ok(len(rows(o, st="file", tan="MUMZ12345C")) == 2 and len(rows(o, st="books", party="Zinnia Retreats Pvt Ltd")) == 1, "ZINNIA RESORTS AND RETREATS LTD is not the books' Zinnia Retreats Pvt Ltd by name: not matched until linked")
        ok(len(rows(o, st="books", party="Marigold Expo Services", tax=1000)) == 1 and len(rows(o, st="file", tan="DELA54321D", tax=12000)) == 1, "Marigold's 1,000: only in the books; ACME's TCS 12,000: only in 26AS")
        d = {x["tan"]: x for x in o["ded"]}
        ok(d["DELQ12345A"]["how"] == "name" and d["DELQ12345A"]["diff"] == 0 and d["DELV12345B"]["diff"] == 2500 and d["MUMZ12345C"]["pending"] == 1500, "by deductor: linked by the same name, the difference, the line not final (U) (%s)" % d)
        t = pg.inner_text("#app [data-as26-own]")
        ok("₹32,500.00" in t and "₹19,000.00" in t and "₹13,500.00" in t, "the page: 26AS ₹32,500.00, books ₹19,000.00, difference ₹13,500.00")
        ok("Matched 3" in t and "Only in 26AS 4" in t and "Only in the books 2" in t, "the page counts Matched 3, Only in 26AS 4, Only in the books 2")
        ok("₹1,500.00 not final" in t, "a line not yet final (status U) is said")
        # the person links Zinnia's TAN
        pg.select_option('#app select[aria-label="Party for MUMZ12345C"]', "Zinnia Retreats Pvt Ltd"); pg.wait_for_timeout(500)
        ok(pg.evaluate("S.books.tanParty") == {"MUMZ12345C": "Zinnia Retreats Pvt Ltd"}, "the link is kept (b.tanParty)")
        o = pg.evaluate(OWN)
        ok(len(rows(o, st="matched", tan="MUMZ12345C", how="quarter total")) == 2 and not rows(o, st="books", party="Zinnia Retreats Pvt Ltd"), "linked: Zinnia's 1,500 + 1,500 match the books' 3,000 on the quarter's total")
        ok(o["booksOnly"] == {"Marigold Expo Services": 1000}, "TDS receivable from a party with no line in 26AS is named (%s)" % o["booksOnly"])
        ok("Marigold Expo Services ₹1,000.00" in pg.inner_text("#app [data-as26-own]"), "and said on the page")

        # ---- the self-check: a file whose lines do not add up to its totals
        upload(pg, os.path.join(FX, "client-26as-totals-off.txt"))
        f = pg.evaluate("AS26.files().map(f => ({n: f.rows.length, ok: f.check.ok, diffs: f.check.diffs}))")
        ok(len(f) == 1 and not f[0]["ok"] and f[0]["diffs"][0]["tan"] == "DELQ12345A", "the same statement again replaces the earlier; its totals differ from its lines: marked to check (%s)" % f)
        ok(pg.locator("#app [data-as26-check]").count() == 1 and "do not add up" in pg.inner_text("#app [data-as26-check]"), "said once, at the top of the comparison")
        upload(pg, os.path.join(FX, "client-26as-2025-26.txt"))

        # ---- a deductee's 26AS: the client's deductions as the deductee sees them
        upload(pg, os.path.join(FX, "deductee-26as-AAJFJ1234K-2025-26.txt"))
        dd = pg.evaluate("AS26.deductees('2025-26').map(d => ({pan: d.file.pan, tan: d.tan, sum: d.sum, rows: d.rows.map(x => [x.status, (x.line || x.book).q, x.line ? x.line.tax : x.book.tax, x.note || ''])}))")
        ok(len(dd) == 1 and dd[0]["pan"] == "AAJFJ1234K" and dd[0]["tan"] == "DELZ12345A" and dd[0]["sum"] == {"file": 7000, "books": 9000}, "Juniper's 26AS: ₹7,000 under the client's TAN (another TAN's 5,000 left out), FinCom's returns ₹9,000 (%s)" % dd)
        rr = dd[0]["rows"] if dd else []
        ok(["matched", "Q3", 6000, ""] in rr, "Q3 6,000: matched")
        ok(any(x[0] == "file" and x[2] == 1000 for x in rr), "Q2 1,000 in Juniper's 26AS, not in FinCom's return: only in 26AS")
        ok(any(x[0] == "books" and x[2] == 3000 and "not marked filed" in x[3] for x in rr), "Q4 3,000 in FinCom, not yet seen by the deductee: the return is not marked filed yet")
        ok(pg.locator('#app [data-as26-deductee="AAJFJ1234K"]').count() == 1, "the deductee's comparison is on the page")
        o = pg.evaluate(OWN)
        ok(o["kind"] == "26AS" and o["sum"]["file"] == 32500, "the deductee's file does not change the client's own comparison")

        # ---- the AIS JSON
        ais = json.load(open(os.path.join(FX, "client-ais-2025-26.json")))
        a = pg.evaluate("(j) => { const f = AS26.parseJson(j); return {kind: f.kind, pan: f.pan, fy: f.fy, rows: f.rows.map(x => [x.part, x.tan, x.name, x.section, x.date, x.q, x.amount, x.tax, x.deposited])}; }", ais)
        ok(a["kind"] == "AIS" and a["pan"] == "AAGCL4827M" and a["fy"] == "2025-26" and len(a["rows"]) == 4, "AIS JSON read: the client's PAN, 2025-26, 4 lines (%s)" % a)
        ok(["TDS", "DELQ12345A", "QUILLFEATHER WEDDINGS LLP", "194C", "20250525", "Q1", 472000, 8000, 8000] in a["rows"] and ["TCS", "DELA54321D", "ACME MOTORS PRIVATE LIMITED", "206CL", "20260310", "Q4", 1200000, 12000, 12000] in a["rows"],
           "each line: TAN and name from the information source, section from the information code, date, quarter, amounts (%s)" % a["rows"][:2])
        upload(pg, os.path.join(FX, "client-ais-2025-26.json"))
        kinds = pg.evaluate("AS26.files().map(f => f.kind + ' ' + f.pan)")
        ok(sorted(kinds) == ["26AS AAGCL4827M", "26AS AAJFJ1234K", "AIS AAGCL4827M"], "AIS uploaded beside the 26AS (%s)" % kinds)
        ok(pg.evaluate(OWN)["kind"] == "26AS", "with both, the client's credit is compared from the 26AS (as TRACES books it)")
        pg.evaluate("() => { S.books.tds26as = AS26.files().filter(f => f.kind !== '26AS' || f.pan !== 'AAGCL4827M'); render(); }")
        o = pg.evaluate(OWN)
        ok(o["kind"] == "AIS" and len(rows(o, st="matched")) == 3 and o["sum"]["file"] == 27000, "the AIS alone: compared the same way (3 matched, ₹27,000) (%s)" % o["sum"])

        # ---- PDFs
        pdf = os.path.join(OUT, "client-26as.pdf"); make_pdf(br, lines_for_pdf(os.path.join(FX, "client-26as-2025-26.txt")), pdf)
        lines = pg.evaluate("""async (b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const f = new File([bytes], 'client-26as.pdf', {type: 'application/pdf'});
          const r = AS26.parsePdfLines(await AS26.pdfLines(f)); return {kind: r.kind, pan: r.pan, fy: r.fy, ok: r.check.ok, rows: r.rows.map(x => [x.part, x.tan, x.section, x.date, x.status, x.amount, x.tax])}; }""",
          __import__("base64").b64encode(open(pdf, "rb").read()).decode())
        ok(lines["kind"] == "26AS" and lines["pan"] == "AAGCL4827M" and lines["fy"] == "2025-26" and len(lines["rows"]) == 7 and lines["ok"], "26AS PDF read: the same 7 lines, their totals agree (%s)" % {k: lines[k] for k in ("kind", "pan", "fy", "ok")})
        ok(["TDS", "DELV12345B", "194J", "20260115", "F", 25000, 2500] in lines["rows"] and ["TCS", "DELA54321D", "206CL", "20260310", "F", 1200000, 12000] in lines["rows"], "the PDF's lines carry the same figures as the text file's")
        upload(pg, pdf)
        ok(pg.evaluate("AS26.files().some(f => f.kind === '26AS' && f.fromPdf && f.pan === 'AAGCL4827M')") and pg.evaluate(OWN)["kind"] == "26AS", "the PDF uploaded is used for the client's credit")
        aisl = ["Annual Information Statement (AIS)", "PAN AAGCL4827M   Financial Year 2025-26", "Part B1 - Information relating to tax deducted or collected at source",
                "1 TDS-194C Payment to contractors QUILLFEATHER WEDDINGS LLP (DELQ12345A) 2 722000 13000", "SR. NO. QUARTER DATE OF PAYMENT/CREDIT AMOUNT PAID/CREDITED TDS DEDUCTED TDS DEPOSITED STATUS",
                "1 Q1(Apr-Jun) 25/05/2025 472000 8000 8000 Active", "2 Q2(Jul-Sep) 20/08/2025 250000 5000 5000 Active",
                "2 TDS-194J Fees for professional services VELLICHOR LEARNING FOUNDATION (DELV12345B) 1 20000 2000", "1 Q3(Oct-Dec) 10/11/2025 20000 2000 2000 Active"]
        apdf = os.path.join(OUT, "client-ais.pdf"); make_pdf(br, aisl, apdf)
        a = pg.evaluate("""async (b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const f = new File([bytes], 'ais.pdf', {type: 'application/pdf'});
          const r = AS26.parsePdfLines(await AS26.pdfLines(f)); return {kind: r.kind, pan: r.pan, rows: r.rows.map(x => [x.tan, x.section, x.date, x.q, x.amount, x.tax])}; }""",
          __import__("base64").b64encode(open(apdf, "rb").read()).decode())
        ok(a["kind"] == "AIS" and a["pan"] == "AAGCL4827M" and a["rows"] == [["DELQ12345A", "194C", "20250525", "Q1", 472000, 8000], ["DELQ12345A", "194C", "20250820", "Q2", 250000, 5000], ["DELV12345B", "194J", "20251110", "Q3", 20000, 2000]], "AIS PDF read: 3 lines by source (%s)" % a)
        # nothing in the books changed
        ok(pg.evaluate("TDS.rows().filter(r => r.fy === '2025-26').reduce((a, r) => a + r.tds, 0)") == 20000, "the TDS returns' figures are unchanged")
        # take a file out: asked first
        fid = pg.evaluate("AS26.files()[0].id")
        pg.evaluate("(id) => { AS26.remove(id); }", fid); pg.wait_for_timeout(300)
        ok(pg.is_visible("#confirmBox [data-cbx=yes]"), "taking a file out asks first")
        pg.click("#confirmBox [data-cbx=no]"); pg.wait_for_timeout(200)
        ok(pg.evaluate("(id) => AS26.files().some(f => f.id === id)", fid), "cancelled: the file stays")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 392, "phone: no sideways scroll of the page")
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
