"""python3 run_gstvault_ui.py - Returns filed: portal PDFs added, read, filed in place; to sort; refused; open, zip, remove."""
import json, os, threading, functools, http.server, zipfile, io
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
from reportlab.pdfgen import canvas
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8146), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT + "/gstv", exist_ok=True)
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def pdf(name, lines):
    p = OUT + "/gstv/" + name; c = canvas.Canvas(p); y = 800
    for l in lines: c.drawString(50, y, l); y -= 18
    c.showPage(); c.save(); return p
f3b = pdf("GSTR3B-mar.pdf", ["Form GSTR-3B", "[See rule 61(5)]", "Year 2025-26", "Period March", "1. GSTIN 07AADCV3366N1ZU", "2(a). Legal name of the registered person VMS EVENTS PRIVATE LIMITED", "2(c). ARN AA070426123456X", "2(d). Date of ARN 20/04/2026", "3.1 Details of Outward supplies"])
f1 = pdf("R1-feb.pdf", ["FORM GSTR-1", "[See rule 59(1)]", "Financial year 2025-26", "Tax period February", "1. GSTIN 07AADCV3366N1ZU", "2(c). ARN AA0703261234567", "2(d). ARN date 11/03/2026"])
fch = pdf("challan.pdf", ["GST PMT-06", "CPIN 26070700123456", "GSTIN 07AADCV3366N1ZU", "Date of deposit 24/11/2025"])
fother = pdf("other.pdf", ["Form GSTR-3B", "Year 2025-26", "Period March", "1. GSTIN 27AAACB1234C1Z5"])
fscan = pdf("scan.pdf", [" "])
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8146/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "vault"; S.gstYm = "202603"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; S.gstPart = 'vault'; render();"); pg.wait_for_timeout(3000)
    t = pg.inner_text("#app")
    ok("Returns filed" in t and "Add PDFs from the portal" in t and "PDF missing" in t, "the Returns filed tab, with the year's checklist")
    pg.set_input_files('.gf-ctl input[data-gstvpick]', [f3b, f1, fch, fother]); pg.wait_for_timeout(6000)
    v = pg.evaluate("GSTV.list().map(x => [x.form, x.per, x.reg, x.sort, x.arn || ''])")
    print("   records:", v)
    ok(["r3b", "202603", "07", False, "AA070426123456X"] in v and ["r1", "202602", "07", False, "AA0703261234567"] in v, "the 3B for March and the GSTR-1 for February are read from their PDFs and filed in place")
    ok(any(x[0] == "pmt06" and x[3] for x in v), "the challan waits under To sort")
    ok(len(v) == 3, "another business's PDF is refused")
    ok(pg.evaluate("GSTF.peek('202603','07').r3b") == "2026-04-20" and pg.evaluate("GSTF.peek('202602','07').r1") == "2026-03-11", "their ARN dates fill the filing dates on the GST screens")
    t = pg.inner_text("#app")
    ok("To sort" in t and "AA070426123456X" in t, "the checklist shows the ARN; the To sort list is shown")
    pg.screenshot(path=OUT + "/gstv-register.png", full_page=False)
    # sort the challan
    cid = pg.evaluate("GSTV.list().find(x => x.sort).id")
    pg.fill('input[data-gstvs="per"][data-gid="%s"]' % cid, "202511"); pg.press('input[data-gstvs="per"][data-gid="%s"]' % cid, "Tab"); pg.wait_for_timeout(800)
    pg.click('button[data-gstvok="%s"]' % cid); pg.wait_for_timeout(1500)
    ok(pg.evaluate("GSTV.list().find(x => x.id === '%s').sort" % cid) is False, "sorted: the challan filed under November 2025")
    # a blank scan added from the January 3B line
    pg.set_input_files('input[data-gstvpick][data-gform="r3b"][data-gper="202601"]', fscan); pg.wait_for_timeout(4000)
    ok(pg.evaluate("!!GSTV.copies('07','r3b','202601')[0]"), "a PDF with nothing to read, added from its line, is filed on that line")
    # open and download
    pg.evaluate("() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; }")
    pg.click('button[data-gstvopen="%s"]' % pg.evaluate("GSTV.copies('07','r3b','202603')[0].id")); pg.wait_for_timeout(1500)
    head = pg.evaluate("async () => { const u = window.__opened[0]; if (!u) return ''; const t = await (await fetch(u)).text(); return u.slice(0, 5) + '|' + t.slice(0, 5); }")
    ok(head == "blob:|%PDF-", "open shows the PDF itself, in a new tab")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => window.__saved.push([n, blob]); }")
    pg.click('button[data-gstv="zip"]'); pg.wait_for_timeout(3000)
    zname = pg.evaluate("window.__saved.map(x => x[0])"); zb = pg.evaluate("async () => Array.from(new Uint8Array(await window.__saved[0][1].arrayBuffer()))")
    z = zipfile.ZipFile(io.BytesIO(bytes(zb))); names = z.namelist()
    ok(zname and zname[0] == "ZZ-TEST-VMS-books_07AADCV3366N1ZU_GST-returns_2025-26.zip" and z.testzip() is None and "ZZ-TEST-VMS-books_07AADCV3366N1ZU_GSTR-3B_2026-03.pdf" in names and all(z.read(n)[:5] == b"%PDF-" for n in names), "the year's zip: %d PDFs, intact, named by client, GSTIN, return and period" % len(names))
    # kept after the books are read again
    pg.evaluate("render()"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.books.gstVault.length") == 4, "four PDFs on file")
    # 3B screen says the portal PDF is on file
    pg.click('button[data-gstpart="r3b"]'); pg.wait_for_timeout(4000)
    ok("GSTR-3B ✓ on file" in pg.inner_text("#app"), "the 3B screen shows its portal PDF is on file")
    pg.click('button[data-gstpart="vault"]'); pg.wait_for_timeout(2500)
    # remove one
    rid = pg.evaluate("GSTV.copies('07','r3b','202601')[0].id")
    pg.locator('button[data-gstvdel="%s"]' % rid).first.click(); pg.wait_for_timeout(600); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1500)
    ok(pg.evaluate("GSTV.copies('07','r3b','202601').length") == 0, "remove asks first, then takes it off")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
