"""python3 run_blob_types.py - a stored file is never opened as a page of FinCom's own (security review of 26-Oct-2026, B3).
A file's type comes from whoever stored it: another firm member's upload, the office automation's inbox (d.mimeType) or a
file emailed to it. A blob: address has FinCom's own origin, so a "bill.pdf" stored as text/html (or SVG, XML) and opened
from a blob would be a page of FinCom. Every place that shows or opens a stored file (the bill's document, Transactions'
document, a notice, a sales file, a filed return) gives the browser a PDF, an image or a download, never HTML.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_blob_types.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8173), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
EVIL = "<html><body><b data-pwn=1>B</b><script>window.parent.__pwn = 1</script></body></html>"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("window.__opened = []; window.open = function(u){ window.__opened.push(String(u)); return null; };")
    pg.goto("http://localhost:8173/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""async (EVIL) => { const co = newCompany({name: "Blob Co", gstin: "27AAACB1234C1Z5"}); co.id = "c_blob"; S.companies[co.id] = co; S.data[co.id] = {parties: {}, entries: {}, loaded: true};
      await openCompany(co.id);
      const f = new File([EVIL], "bill.pdf", {type: "text/html"});
      const e = newEntry("bill.pdf"); e.id = "e_blob"; e.status = "draft"; e.x = Object.assign(e.x || {}, {vendorName: "V", invoiceNo: "1", totalAmount: 100, taxable: 100}); D().entries[e.id] = e;
      S.files["e_blob"] = f; await FileStore.put(co.id, "e_blob", f);
      window.__evil = f;
      S.tab = "invoices"; S.filter = "draft"; S.reviewTable = true; S.selected = "e_blob"; S.drawerOpen = true; render(); }""", EVIL)
    pg.wait_for_timeout(2500)
    fr = pg.evaluate("""async () => { const out = [];
      for (const el of document.querySelectorAll('#app iframe, #app embed, #app object, #app img')) {
        const u = el.src || el.data || ""; if (!u.startsWith("blob:")) continue;
        const t = (await (await fetch(u)).blob()).type; let pwn = 0; try { pwn = el.contentDocument ? el.contentDocument.querySelectorAll('[data-pwn]').length : 0; } catch (e) {}
        out.push({tag: el.tagName, type: t, pwn}); }
      return {out, pwn: window.__pwn || 0}; }""")
    ok(fr["out"], "the bill's document is shown from its stored file " + str(fr))
    ok(fr["out"] and all(x["type"] in ("application/pdf", "application/octet-stream") and not x["pwn"] for x in fr["out"]) and not fr["pwn"],
       "a bill.pdf stored as text/html is shown as a PDF, never as a page of FinCom " + str(fr))
    # the other places that open a stored file in a new tab
    for name, js in [("Transactions' document", "() => txnOpenDoc('e_blob', '', 'bill.pdf')"),
                     ("a sales file", "() => { S.files['sv:s1'] = window.__evil; if (!S.sales) S.sales = {cid: S.coId, list: [], sel: new Set(), sticky: new Set(), cfg: {}}; const s = SL(); if (s){ s.list = (s.list || []).concat([{id: 's1', x: {number: '1'}, status: 'review'}]); } return salesRowAct('file', 's1'); }")]:
        pg.evaluate("window.__opened = []")
        try: pg.evaluate(js)
        except Exception as e: print("    (%s: %s)" % (name, str(e).split("\n")[0][:100]))
        pg.wait_for_timeout(1200)
        ts = pg.evaluate("async () => Promise.all(window.__opened.filter(u => u.startsWith('blob:')).map(async u => (await (await fetch(u)).blob()).type))")
        ok(ts and all(t in ("application/pdf", "application/octet-stream") for t in ts), "%s: opened as a PDF or a download, never as text/html %s" % (name, ts))
    ok(not errors, "no page errors " + str(errors[:3]))
    br.close()
print(("%d failed" % len(fails)) if fails else "all passed")
raise SystemExit(1 if fails else 0)
