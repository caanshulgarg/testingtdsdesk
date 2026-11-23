"""python3 run_bill_doc_pdf.py - the bill's PDF beside its fields, drawn by FinCom itself (the owner, 23-Nov-2026: "when
we upload the purchase invoice.. that invoice does not show in the side window", on Safari).
The side window used the browser's own PDF viewer in a frame (an <iframe> of a blob: address). Safari gives that frame the
page's security policy and its PDF viewer is a plug-in: the frame stays blank there (Sentry had Safari's reports of it),
and a browser without a PDF viewer (the test browser too) shows nothing either. Now FinCom draws the PDF's page itself
(pdf.js, already on the site for reading bills) into the side window, the same in every browser:
  1. a 2-page made-up PDF uploaded as a bill: the side window shows page 1 drawn (ink on it), "page 1 of 2", no frame;
     Page > draws page 2 and stops there; zoom makes the page bigger;
  2. a JPG bill: still the image;
  3. a file that is not a readable PDF: a plain line with "Open ↗" (a new tab), never a blank box; the bar's Open ↗ fits;
  4. the same with the new look on and off; the bill's page on its own (One at a time) too.
Offline, made-up data only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bill_doc_pdf.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", int(os.environ.get("TDSDESK_PORT", "8247"))), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
SHOTS, TAG = os.environ.get("TDSDESK_SHOTS", ""), os.environ.get("TDSDESK_SHOT_TAG", "after")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def pdf2():
    # a made-up two-page bill: a black box and a line of text on each page
    objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>"]
    for n, txt in ((4, "ZZ TEST BILL PAGE ONE"), (6, "ZZ TEST BILL PAGE TWO")):
        objs.append("<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]/Contents %d 0 R/Resources<</Font<</F1 7 0 R>>>>>>" % n)
        s = "0 0 0 rg 30 150 340 100 re f BT /F1 20 Tf 30 100 Td (%s) Tj ET" % txt
        objs.append("<</Length %d>>stream\n%s\nendstream" % (len(s), s))
    objs.append("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += "%d 0 obj%s endobj\n" % (i, o)
    x = len(out)
    out += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
    out += "trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, x)
    return out

ADD = """async ([cid, kind, pdf]) => { let f;
  if (kind === 'pdf') f = new File([pdf], 'ZZ-TEST-BILL-1.pdf', {type: 'application/pdf'});
  else if (kind === 'bad') f = new File(['not a pdf at all'], 'ZZ-TEST-BILL-3.pdf', {type: 'application/pdf'});
  else { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 400);
    g.fillStyle = '#000'; g.font = '40px sans-serif'; g.fillText('ZZ TEST BILL 2', 40, 120);
    f = new File([await new Promise(r => c.toBlob(r, 'image/jpeg'))], 'ZZ-TEST-BILL-2.jpg', {type: 'image/jpeg'}); }
  const e = newEntry(f.name); Object.assign(e.x, {vendorName: 'ZZ Made Up Supplies', invoiceNo: 'ZZ/' + kind, invoiceDate: '2026-11-20', taxable: 1000, cgst: 90, sgst: 90, total: 1180});
  S.data[cid].entries[e.id] = e; S.files[e.id] = f; if (isImage(f)) S.previews[e.id] = URL.createObjectURL(f); return e.id; }"""
# the drawn page: its size and whether it has ink on it (not all white, not all grey)
PAGE = """() => { const d = document.querySelector('[data-bill-doc]'); if (!d) return null;
  const c = d.querySelector('canvas[data-bill-page]'); let ink = 0;
  if (c && c.width){ const g = c.getContext('2d'), px = g.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < px.length; i += 16) if (px[i] < 60) ink++; }
  return {state: d.getAttribute('data-bill-doc'), frame: !!d.querySelector('iframe'), canvas: !!c, w: c ? c.getBoundingClientRect().width : 0, ink,
    page: c ? c.getAttribute('data-bill-page') : '', text: d.innerText.replace(/\\s+/g, ' ')}; }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    for nl in (False, True):
        look = "new look" if nl else "classic look"
        ctx = br.new_context(viewport={"width": 1400, "height": 900}, device_scale_factor=2); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        if nl: pg.add_init_script("try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}")
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        ok(pg.evaluate("document.documentElement.classList.contains('nl')") == nl, "%s: the look is as set" % look)
        cid = pg.evaluate("""() => { const c = newCompany({name: "ZZ Testing Traders", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; }""")
        ids = {k: pg.evaluate(ADD, [cid, k, pdf2()]) for k in ("pdf", "jpg", "bad")}
        pg.evaluate("(cid) => openCompany(cid).then(() => goStep('review', 'bills'))", cid); pg.wait_for_timeout(1200)

        # 1. the PDF in the side window (the drawer over the review table)
        pg.evaluate("(id) => revOpen(id)", ids["pdf"]); pg.wait_for_timeout(2500)
        a = pg.evaluate(PAGE)
        ok(a and a["state"] == "pdf" and a["canvas"] and not a["frame"], "%s: 1. the PDF bill's page is drawn in the side window, no frame (%s)" % (look, a and {k: a[k] for k in ("state", "canvas", "frame")}))
        ok(a and a["ink"] > 200, "%s: 1. the page has the bill on it, not a blank box (ink %s)" % (look, a and a["ink"]))
        ok(a and "page 1 of 2" in a["text"], "%s: 1. it says page 1 of 2 (%s)" % (look, a and a["text"][:120]))
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, TAG + "-%s-pdf.png" % ("nl" if nl else "classic")))
        w1 = a["w"] if a else 0
        pg.click('[data-bill-doc] button[aria-label="Next page"]'); pg.wait_for_timeout(1500)
        b = pg.evaluate(PAGE)
        ok(b and b["page"] == "2" and b["ink"] > 200 and "page 2 of 2" in b["text"], "%s: 1. Page > draws page 2 (%s)" % (look, b and (b["page"], b["ink"])))
        ok(pg.locator('[data-bill-doc] button[aria-label="Next page"]').is_disabled(), "%s: 1. Page > stops at the last page" % look)
        pg.click('[data-bill-doc] button[aria-label="Zoom in"]'); pg.wait_for_timeout(1500)
        z = pg.evaluate(PAGE)
        ok(z and z["w"] > w1 * 1.15, "%s: 1. zoom in makes the page bigger (%s -> %s)" % (look, round(w1), z and round(z["w"])))
        ok(pg.locator('[data-bill-doc] a[title="Open in a new tab"]').count() == 1, "%s: 1. Open ↗ (in a new tab) is still there" % look)
        fit = pg.evaluate("() => { const a = document.querySelector('[data-bill-doc] .billdoc-bar a'), r = a.getBoundingClientRect(), b = a.parentElement.getBoundingClientRect(); return [Math.round(r.right), Math.round(b.right)]; }")
        ok(fit[0] <= fit[1] + 1, "%s: 1. Open ↗ fits in the bar, not cut off (%s)" % (look, fit))
        pg.evaluate("() => doAct('drawerClose')"); pg.wait_for_timeout(500)

        # 2. a JPG bill: the image
        pg.evaluate("(id) => revOpen(id)", ids["jpg"]); pg.wait_for_timeout(1500)
        j = pg.evaluate("() => { const d = document.querySelector('[data-bill-doc]'), i = d && d.querySelector('img'); return d ? {state: d.getAttribute('data-bill-doc'), img: !!(i && i.naturalWidth > 0)} : null; }")
        ok(j and j["state"] == "image" and j["img"], "%s: 2. a JPG bill shows its image (%s)" % (look, j))
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, TAG + "-%s-jpg.png" % ("nl" if nl else "classic")))
        pg.evaluate("() => doAct('drawerClose')"); pg.wait_for_timeout(500)

        # 3. not a readable PDF: said in plain words, with the way to open it
        pg.evaluate("(id) => revOpen(id)", ids["bad"]); pg.wait_for_timeout(2000)
        c = pg.evaluate(PAGE)
        ok(c and not c["frame"] and "could not be shown here" in c["text"] and "Open \u2197" in c["text"], "%s: 3. a PDF that cannot be drawn says so, with Open ↗ (%s)" % (look, c and c["text"][:160]))
        pg.evaluate("() => doAct('drawerClose')"); pg.wait_for_timeout(500)

        # 4. the bill's page on its own (One at a time)
        pg.evaluate("(id) => { S.reviewTable = false; S.drawerOpen = false; S.filter = 'draft'; S.selected = id; render(); }", ids["pdf"]); pg.wait_for_timeout(2500)
        d = pg.evaluate(PAGE)
        ok(d and d["canvas"] and d["ink"] > 200 and not d["frame"], "%s: 4. the bill's own page shows the PDF drawn too" % look)
        ctx.close()
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
