"""python3 run_traces_files.py - TRACES files by upload (TDS/GST round 2, item 3; TRF, src/js/70-traces-files.js; a
return's After filing since tds-layout, 14-Oct-2026; it was the TDS page › TRACES files):

  Form 16A   a zip from TRACES (locked with a password, holding another zip with the PDFs) is opened; each certificate is
             kept with its deductee, by the PAN in its file name or, failing that, in its text ("PAN of the Deductee"), and
             downloads from the deductee's line (and from the return's Deductees tab). A wrong password, a zip locked with
             AES and a zip holding only TRACES-PDF-CONVERTER's text file are each said in plain words.
  Justification report  its defaults (short deduction, interest for paying and deducting late, the late fee, a PAN
             error) become the "TRACES defaults" list of the return, with what to do, on the TRACES files page and the
             return's Errors to fix tab; the report's own summary is checked against its lines.
  Consolidated file  its deductee lines against FinCom's return: same PAN, name and TDS; a PAN FinCom's return does not
             have; PANNOTAVBL.

The files are made up in the layouts FinCom ASSUMES (tests/fixtures/traces/; TRACES cannot be reached from where FinCom is
built); the PDFs and zips are made here. Runs on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, io, zlib, struct, zipfile, threading, functools, http.server, base64
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TRF_PORT") or 8335)
FX = os.path.join(HERE, "fixtures", "traces")
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "traces"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

# ---- a zip locked with the zip format's original encryption (ZipCrypto), as TRACES' downloads are assumed to be
CRC = [0] * 256
for n in range(256):
    c = n
    for _ in range(8): c = 0xEDB88320 ^ (c >> 1) if c & 1 else c >> 1
    CRC[n] = c
def crc_b(c, b): return CRC[(c ^ b) & 0xff] ^ (c >> 8)
def zipcrypto(entries, password):
    out, cd = io.BytesIO(), io.BytesIO()
    for name, data in entries:
        crc = zlib.crc32(data) & 0xffffffff
        comp = zlib.compressobj(9, zlib.DEFLATED, -15); body = comp.compress(data) + comp.flush()
        k = [0x12345678, 0x23456789, 0x34567890]
        def upd(b):
            k[0] = crc_b(k[0], b); k[1] = (k[1] + (k[0] & 0xff)) & 0xffffffff; k[1] = (k[1] * 134775813 + 1) & 0xffffffff; k[2] = crc_b(k[2], k[1] >> 24)
        for b in password.encode(): upd(b)
        def enc(plain):
            res = bytearray()
            for b in plain:
                t = (k[2] | 2) & 0xffff; kb = ((t * (t ^ 1)) >> 8) & 0xff; res.append(b ^ kb); upd(b)
            return bytes(res)
        head = enc(os.urandom(11) + bytes([crc >> 24])) + enc(body)
        off = out.tell(); nb = name.encode()
        out.write(struct.pack("<IHHHHHIIIHH", 0x04034b50, 20, 1, 8, 0, 0x21, crc, len(head), len(data), len(nb), 0) + nb + head)
        cd.write(struct.pack("<IHHHHHHIIIHHHHHII", 0x02014b50, 20, 20, 1, 8, 0, 0x21, crc, len(head), len(data), len(nb), 0, 0, 0, 0, 0, off) + nb)
    c = cd.getvalue(); start = out.tell(); out.write(c)
    out.write(struct.pack("<IHHHHIIH", 0x06054b50, 0, 0, len(entries), len(entries), len(c), start, 0))
    return out.getvalue()
def plainzip(entries, method=zipfile.ZIP_DEFLATED):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", method) as z:
        for n, d in entries: z.writestr(n, d)
    return b.getvalue()

def make_pdf(br, lines):
    p2 = br.new_page()
    p2.set_content("<html><body style='font-family:Arial;font-size:11px'>" + "".join("<div style='white-space:pre;margin:4px 0'>%s</div>" % l for l in lines) + "</body></html>")
    data = p2.pdf(format="A4"); p2.close(); return data

def upload(pg, paths, password=None, wait=1800):
    shut(pg)
    pg.set_input_files('#app [data-upload="traces"] input[type=file]', paths); pg.wait_for_timeout(900)
    if password is not None:
        pg.wait_for_selector("#confirmBox #trfpw", timeout=5000); pg.fill("#confirmBox #trfpw", password); pg.click("#confirmBox [data-cbx=yes]")
    pg.wait_for_timeout(wait)
    return pg.inner_text("#app [data-after-filing]")

# tds-layout (14-Oct-2026): TRACES files is no TDS tab; a return's After filing takes its TRACES files once it is marked
# filed. go() with no view opens 26Q Q3 2025-26's After filing (the return the fixtures' files are of).
def go(pg, view="after", fy="2025-26", q="Q3", form="26Q", tab="after"):
    if view == "after": view = "return"
    if view == "return": pg.evaluate("(a) => { S.booksTab = 'tds'; S.tdsFy = a[0]; S.tdsQ = a[1]; S.tdsForm = a[2]; S.tdsPickForm = a[2]; S.tdsView = 'return'; S.tdsTab = a[3]; S.tdsValOpen = a[3] === 'checks' ? '*' : ''; render(); }", [fy, q, form, tab])
    else: pg.evaluate("(a) => { S.booksTab = 'tds'; S.tdsFy = a[0]; S.tdsView = a[1]; render(); }", [fy, view])
    pg.wait_for_timeout(500)
# next-tds-clear (19-Oct-2026): After filing is one table of TRACES' files; each row opens its drawer
def shut(pg):
    pg.evaluate("() => document.querySelectorAll('[data-drawer] button[aria-label=Close]').forEach(b => b.click())"); pg.wait_for_timeout(300)
def after(pg, k):
    shut(pg)
    pg.click('#app [data-after-open="%s"]' % k); pg.wait_for_timeout(500)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        pg.evaluate("() => { S.books.pans = Object.assign({}, S.books.pans, {'Juniper Legal Associates': 'AAJFJ1234K', 'Nightjar Sound & Light Co': 'ABCPN5555N'}); }")
        ok(pg.evaluate("['f16a', 'tracesJr', 'tracesConso'].every(k => BOOKS_KEYS.includes(k))"), "the certificates' records, the defaults and the consolidated file are kept with the books (BOOKS_KEYS)")
        go(pg)
        ok(pg.locator("#app [data-after-wait]").count() == 1 and pg.locator('#app [data-upload="traces"]').count() == 0, "a return not marked filed: After filing says it is available once marked filed")
        pg.evaluate("() => { S.books.tdsFiled = Object.assign({}, S.books.tdsFiled, {[TDSFiled.key('2025-26', 'Q3', '26Q')]: {on: '2026-01-31', token: ''}}); render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator("#app [data-after-filing]").count() == 1 and "Upload TRACES files" in pg.inner_text("#app [data-after-filing]"), "marked filed: 26Q Q3's After filing, with its upload")

        # ---- Form 16A
        pdf1 = make_pdf(br, ["FORM NO. 16A", "Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source", "Certificate No. JLAQ3XY",
                             "PAN of the Deductor   TAN of the Deductor   PAN of the Deductee", "AAGCL4827M   DELZ12345A   AAJFJ1234K", "Assessment Year 2026-27   Quarter Q3"])
        pdf2 = make_pdf(br, ["FORM NO. 16A", "Certificate No. NJQ3ABC", "PAN of the Deductor   TAN of the Deductor   PAN of the Deductee",
                             "AAGCL4827M   DELZ12345A   ABCPN5555N", "Assessment Year 2026-27", "Quarter Q3"])
        inner = plainzip([("AAJFJ1234K_Q3_2025-26.pdf", pdf1), ("certificate-2.pdf", pdf2)])
        locked = os.path.join(OUT, "Form16A_DELZ12345A_Q3_2025-26.zip"); open(locked, "wb").write(zipcrypto([("Form16A_Q3.zip", inner)], "DELZ12345A"))
        t = upload(pg, locked, password="WRONGPASS1")
        ok("the password did not open it" in t and not pg.evaluate("TRF.f16().length"), "a wrong password: said in words, nothing kept")
        t = upload(pg, locked, password="DELZ12345A", wait=3500)
        f16 = pg.evaluate("TRF.f16().map(r => [r.pan, r.party, r.q, r.fy, r.cert, r.name])")
        ok(sorted(f16) == sorted([["AAJFJ1234K", "Juniper Legal Associates", "Q3", "2025-26", "JLAQ3XY", "AAJFJ1234K_Q3_2025-26.pdf"], ["ABCPN5555N", "Nightjar Sound & Light Co", "Q3", "2025-26", "NJQ3ABC", "certificate-2.pdf"]]),
           "the locked zip, with a zip inside, opened: two certificates kept, each with its deductee (one by its file name, one by the PAN in its text) (%s)" % f16)
        ok("Form 16A: 2 certificates kept with 2 deductees" in t, "said: 2 certificates kept with 2 deductees")
        after(pg, "certs")
        ok(pg.locator('#app [data-f16-pan="AAJFJ1234K"]').count() == 1 and "Juniper Legal Associates" in pg.inner_text('#app [data-f16-pan="AAJFJ1234K"]'), "the deductee's line on the return's After filing")
        with pg.expect_download() as dl:
            pg.click('#app [data-f16-pan="AAJFJ1234K"] [data-f16-get]')
        d = dl.value; path = d.path()
        ok(d.suggested_filename == "AAJFJ1234K_Q3_2025-26.pdf" and open(path, "rb").read()[:4] == b"%PDF", "the certificate downloads as it came (%s)" % d.suggested_filename)
        shut(pg)
        go(pg, "return", "2025-26", "Q3", "26Q", "deductees")
        pg.click('#app [data-dee-open]:has-text("Juniper")'); pg.wait_for_timeout(500)
        ok(pg.locator('#app [data-dee-dialog] [data-f16-link="AAJFJ1234K"]').count() == 1, "the return's Deductees: Form 16A in Juniper's drawer")
        shut(pg)
        go(pg)
        # the same certificate again: in place of the earlier one
        upload(pg, locked, password="DELZ12345A", wait=3500)
        ok(pg.evaluate("TRF.f16().length") == 2, "the same certificates again: the newer in place of the earlier, not twice")
        # an AES zip, a converter's text file
        aes = bytearray(plainzip([("a.pdf", pdf1)], zipfile.ZIP_STORED))
        for sig in (b"PK\x03\x04", b"PK\x01\x02"):
            i = aes.find(sig); off = 8 if sig == b"PK\x03\x04" else 10; aes[i + off:i + off + 2] = struct.pack("<H", 99)
        ap = os.path.join(OUT, "aes.zip"); open(ap, "wb").write(bytes(aes))
        t = upload(pg, ap)
        ok("AES" in t and "unzip it on the computer" in t, "a zip locked with AES: say to unzip it on the computer and upload the files inside")
        cp = os.path.join(OUT, "Form16A_converter.zip"); open(cp, "wb").write(plainzip([("DELZ12345A_Q3_2025-26.txt", b"0123ABCDEF encrypted request text")]))
        t = upload(pg, cp)
        ok("TRACES-PDF-CONVERTER" in t, "a zip holding only the converter's text file: convert it with TRACES-PDF-CONVERTER first")

        # ---- the justification report
        t = upload(pg, os.path.join(FX, "jr-26q-q3-2025-26.txt"))
        jr = pg.evaluate("(() => { const j = TRF.jrFor('2025-26', 'Q3', '26Q'); return j && {tan: j.tan, token: j.token, summary: j.summary, diffs: j.diffs, items: j.items.map(x => [x.kind, x.pan, x.name, x.section, x.date, x.challan, x.amount])}; })()")
        ok(jr and jr["tan"] == "DELZ12345A" and jr["token"] == "123456789012345" and "Justification report" in t, "the justification report read for 26Q Q3 2025-26, token 123456789012345")
        it = jr["items"] if jr else []
        ok(["shortDed", "AAJFJ1234K", "JUNIPER LEGAL ASSOCIATES", "194J", "20251105", "", 1200] in it, "short deduction: Juniper, 194J, 05-Nov-2025, ₹1,200")
        ok([x for x in it if x[0] == "intPay"] == [["intPay", "", "", "", "20251210", "0240020/10002", 270], ["intPay", "", "", "", "20251210", "0240020/10002", 180]], "interest for paying late: two lines of the challan 0240020/10002, ₹270 and ₹180 (%s)" % [x for x in it if x[0] == "intPay"])
        ok(["intDed", "AAJFJ1234K", "JUNIPER LEGAL ASSOCIATES", "194J", "20251105", "", 120] in it and ["lateFee", "", "", "", "20260131", "", 2000] in it, "interest for deducting late ₹120; late fee ₹2,000")
        ok(["pan", "PANNOTAVBL", "ORCHID EVENTS", "194C", "", "", 1000] in it, "a PAN error: Orchid Events without a PAN")
        ok(jr and jr["diffs"] == [] and jr["summary"].get("total") == 3770, "the report's summary agrees with its lines (total ₹3,770)")
        box = '#app [data-traces-defaults="26Q|Q3|2025-26"]'
        after(pg, "jr")
        tt = pg.inner_text(box)
        ok("TRACES defaults" in tt and "₹3,770.00 to pay" in tt and "file a correction" in tt.lower(), "the TRACES defaults list on After filing: ₹3,770.00 to pay, with what to do")
        go(pg, "return", "2025-26", "Q3", "26Q", "checks")
        shut(pg)
        ok(pg.locator(box).count() == 1, "the return's Validate & file shows the TRACES defaults of that return")
        go(pg, "return", "2025-26", "Q2", "26Q", "checks")
        ok(pg.locator("#app [data-traces-defaults]").count() == 0, "another quarter's return does not show them")
        go(pg)
        off = open(os.path.join(FX, "jr-26q-q3-2025-26.txt")).read().replace("Short Deduction ^ 1,200.00", "Short Deduction ^ 1,500.00")
        op = os.path.join(OUT, "jr-off.txt"); open(op, "w").write(off)
        upload(pg, op); after(pg, "jr")
        ok(pg.evaluate("TRF.jrs().length") == 1 and pg.locator("#app [data-jr-diff]").count() == 1 and "Short deduction ₹1,500.00 (the lines add up to ₹1,200.00)" in pg.inner_text("#app [data-jr-diff]"),
           "a report whose summary differs from its lines: replaces the earlier one, and the difference is said once")

        # ---- the consolidated file, in a locked zip
        cz = os.path.join(OUT, "conso.zip"); open(cz, "wb").write(zipcrypto([("DELZ12345A_Q3_2025-26_conso.txt", open(os.path.join(FX, "conso-26q-q3-2025-26.txt"), "rb").read())], "REQ1234567"))
        t = upload(pg, cz, password="REQ1234567")
        ok("Consolidated file" in t and "3 deductee lines read" in t, "the consolidated file read from its locked zip: 3 deductee lines")
        c = pg.evaluate("(() => { const c = TRF.consos()[0]; const r = TRF.consoCheck(c); return {tan: c.tan, form: c.form, fy: c.fy, q: c.q, n: c.challans, rows: r.rows.map(x => [x.pan, x.name, x.ok, x.words.join('; ')]), extra: r.extra.length}; })()")
        ok(c["tan"] == "DELZ12345A" and c["form"] == "26Q" and c["fy"] == "2025-26" and c["q"] == "Q3" and c["n"] == 1, "its batch: TAN, 26Q, 2025-26, Q3, one challan (%s)" % {k: c[k] for k in ("tan", "form", "fy", "q", "n")})
        ok(["AAJFJ1234K", "JUNIPER LEGAL ASSOCIATES", True, ""] in c["rows"], "Juniper: the same PAN, name and TDS as FinCom's return")
        ok(["ABCPN5555N", "NIGHTJAR SOUND AND LIGHT", False, "this PAN is not in FinCom's return"] in c["rows"], "a deductee in TRACES' file whose PAN is not in FinCom's return: said")
        ok(["PANNOTAVBL", "ORCHID EVENTS", False, "no PAN in TRACES' statement"] in c["rows"], "PANNOTAVBL in TRACES' file: said")
        ok(c["extra"] == 0, "every deductee of FinCom's Q3 return is in TRACES' file")
        after(pg, "conso")
        ok(pg.locator('#app [data-conso="26Q|Q3|2025-26"] [data-ok="0"]').count() == 2, "the page marks the two lines to check")
        # nothing changed in the return
        ok(pg.evaluate("TDS.rows().filter(r => r.fy === '2025-26' && r.q === 'Q3').map(r => r.tds)") == [6000], "the return's figures are unchanged")
        # take a certificate out: asked first
        fid = pg.evaluate("TRF.f16()[0].id")
        pg.evaluate("(id) => { TRF.remove('f16a', id); }", fid); pg.wait_for_timeout(300)
        ok(pg.is_visible("#confirmBox [data-cbx=yes]"), "taking a certificate out asks first")
        pg.click("#confirmBox [data-cbx=yes]"); pg.wait_for_timeout(300)
        ok(pg.evaluate("TRF.f16().length") == 1, "confirmed: it is taken out")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 392, "phone: no sideways scroll of the page")
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
