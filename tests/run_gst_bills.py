"""python3 run_gst_bills.py - GSTR-1 as the portal lays it out, and one row a bill (t70, 16-Oct-2026; the owner: "not able
to identify the total bills.. with 100+ bills it will be a problem", "check the schema of GSTN, make it user friendly"),
used as a person would, on the fixture books with 250 more invoices in Mar-2026 (a copy of one, numbered LFE/T70/001…):

  1. Summary: one table, a row per GSTR-1 table (4A, 5, 7, 8, 9B, 12, 13 …): records, taxable, taxes equal the sections
     of the GSTR-1 JSON FinCom makes; the grand total without 12 and 13; a row opens Details filtered to its table;
  2. Details by bill (the default): one row a document; the foot "N bills (+ M B2C summary lines)" with totals of every
     row filtered, not only those shown; the first 100 shown, Show all shows them all; a filter in a header changes the
     rows and the totals; find by invoice number;
  3. By customer: the grouped table, the same grand total;
  4. Export: the bills' Excel, a SUM in its totals row.
Runs on the React build (app/dist-test) or TDSDESK_SITE."""
import os, sys, json, base64, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BILLS_PORT") or 8346)
N = int(os.environ.get("BILLS_N") or 250)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
# 250 more invoices: copies of LFE/25-26/016 (Wisteria Banquets, 24-Mar-2026), each its own number and id
src = next(v for v in books["vouchers"] if v.get("no") == "LFE/25-26/016")
for i in range(N):
    c = json.loads(json.dumps(src)); c["id"] = src["id"] + "-t70-%03d" % i; c["no"] = "LFE/T70/%03d" % (i + 1); c["narr"] = "Invoice " + c["no"]; c["alt"] = 1000 + i
    books["vouchers"].append(c)
SUMJ = """() => { const j = GSTR.toJson('202603', '07', {plain: true}), t = {}; const add = (k, n, x, sg) => { const o = t[k] = t[k] || {n: 0, taxable: 0, tax: 0}; o.n += n;
    o.taxable = r2(o.taxable + sg * num(x.txval)); o.tax = r2(o.tax + sg * (num(x.iamt) + num(x.camt) + num(x.samt) + num(x.csamt))); };
  (j.b2b || []).forEach(p => p.inv.forEach(v => { add('B2B', 1, {}, 1); v.itms.forEach(x => add('B2B', 0, x.itm_det, 1)); }));
  (j.b2cl || []).forEach(p => p.inv.forEach(v => { add('5', 1, {}, 1); v.itms.forEach(x => add('5', 0, x.itm_det, 1)); }));
  (j.b2cs || []).forEach(x => add('7', 1, x, 1));
  (j.cdnr || []).forEach(p => p.nt.forEach(v => { add('9BR', 1, {}, 1); v.itms.forEach(x => add('9BR', 0, x.itm_det, v.ntty === 'C' ? -1 : 1)); }));
  return t; }"""
PAGE = """() => [...document.querySelectorAll('[data-r1-summary] tr[data-r1-table]')].map(tr => { const c = [...tr.children].map(td => td.innerText.trim());
  const v = (s) => Number(String(s).replace(/[₹,]/g, '')); return {k: tr.dataset.r1Table, n: v(c[1]), taxable: v(c[2]), tax: v(c[7])}; })"""
FOOT = """() => { const f = document.querySelector('[data-r1-foot]'); if (!f) return null; const v = (s) => Number(String(s || '').replace(/[₹,]/g, ''));
  const g = (k) => v((f.querySelector('[data-r1-sum=' + k + ']') || {}).innerText); return {text: f.innerText, taxable: g('taxable'), igst: g('igst'), cgst: g('cgst'), sgst: g('sgst'), total: g('total'),
  rows: document.querySelectorAll('#r1Bills tbody tr[data-r1-bill]').length}; }"""
CATCH = """() => { window.__files = []; window.saveFile = async (name, data) => { const a = new Uint8Array(await data.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); window.__files.push({name, b64: btoa(s)}); return true; }; }"""
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        E, W = pg.evaluate, pg.wait_for_timeout
        pg.goto("http://localhost:%d/" % PORT); W(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); W(2000)
        E(LOAD, books); W(1500); E("S.books = window.__bk; render();"); W(800)
        cid = E("S.coId")
        go = lambda h: (E("(h) => { location.hash = h; }", "#/c/%s/books/gst/07/202603/%s" % (cid, h)), W(1500))
        print("1. Summary: the portal's tables")
        go("r1/summary")
        rows, want = E(PAGE), E(SUMJ)
        ok(rows and [r["k"] for r in rows][:1] == ["B2B"] and "4A, 4B, 6B, 6C" in E("() => document.querySelector('[data-r1-table=B2B]').innerText"), "a row per GSTR-1 table as the portal groups them, '4A, 4B, 6B, 6C – B2B, SEZ, DE invoices' first (%s)" % [r["k"] for r in rows])
        for r in rows:
            w = want.get(r["k"])
            if w: ok(r["n"] == w["n"] and abs(r["taxable"] - w["taxable"]) < 0.01 and abs(r["tax"] - w["tax"]) < 0.01, "table %s: records, taxable and tax as the JSON (%s / %s)" % (r["k"], r, w))
        grand = E("() => document.querySelector('[data-r1-grand]').innerText")
        tot = sum(r["taxable"] for r in rows if r["k"] not in ("12", "13"))
        ok(E("INR.format(%s)" % round(tot, 2)) in grand, "the grand total: tables 4 to 11 (%s)" % grand.replace("\n", " "))
        pg.click("[data-r1-summary] tr[data-r1-table='B2B'] button"); W(1000)
        # round 72 (GST in the portal's layout): a row opens its table as the portal shows it; the bills are "By bill"
        ok(E("S.gstSub") == "details" and E("S.r1T") == "b2b" and E("S.r1View || ''") == "" and pg.locator("[data-r1p=b2b]").count() == 1, "a row opens Details at its portal table (%s)" % E("[S.gstSub, S.r1T]"))
        E("() => { clearFilter('r1F'); S.r1View = 'bill'; S.r1T = ''; render(); }"); W(500)

        print("2. Details by bill")
        f = E(FOOT)
        all_ = E("""() => { const g = GSTR.one('202603', '07'), rs = g.b2b.concat(g.b2cl).concat(g.b2c).concat(g.cdnr).concat(g.exp).concat(g.nil); return rs.length; }""")
        ok(f and "%d bills" % (N + 2) in f["text"] and f["rows"] == 100, "the foot counts every bill (%d), the first 100 shown (%s)" % (N + 2, f and [f["text"][:60], f["rows"]]))
        sums = E("""() => { const g = GSTR.one('202603', '07'), rs = g.b2b.concat(g.b2cl).concat(g.cdnr).concat(g.exp).concat(g.nil); const s = (k) => r2(rs.reduce((a, r) => a + num(r[k]), 0));
          const j = GSTR.toJson('202603', '07', {plain: true}), b = (k) => r2((j.b2cs || []).reduce((a, x) => a + num(x[k]), 0));
          return {taxable: r2(s('taxable') + b('txval')), igst: r2(s('igst') + b('iamt')), cgst: r2(s('cgst') + b('camt')), sgst: r2(s('sgst') + b('samt'))}; }""")
        ok(all(abs(f[k] - sums[k]) < 0.01 for k in ("taxable", "igst", "cgst", "sgst")), "the foot's totals: every bill (and table 7's lines), not only those shown (%s / %s)" % ({k: f[k] for k in sums}, sums))
        pg.click("[data-r1-all]"); W(1200)
        ok(E(FOOT)["rows"] == N + 2, "Show all: every bill (%d)" % E(FOOT)["rows"])
        pg.select_option("#r1Bills thead select[aria-label=Customer]", "09AACCO6624H1ZC")
        W(500)
        f2 = E(FOOT)
        ok(f2 and f2["taxable"] != f["taxable"], "a filter in a header changes the rows and the totals (%s → %s)" % (f["taxable"], f2 and f2["taxable"]))
        E("() => clearFilter('r1F')"); W(400)
        pg.fill('#app input[aria-label="Find an invoice, customer or GSTIN"]', "LFE/T70/007"); W(900)
        ok(E(FOOT)["rows"] == 1, "find by invoice number: one bill")
        E("() => clearFilter('r1F')"); W(400)

        print("3. By customer")
        pg.click("[data-r1-switch=customer]"); W(800)
        ok(pg.locator("#r1Table").count() == 1 and pg.locator("#r1Bills").count() == 0, "By customer: the grouped table")
        tt = E("() => { const tr = [...document.querySelectorAll('#r1Table > tbody > tr.tg-tot')][0]; return tr ? tr.innerText : ''; }")
        ok(E("INR.format(%s)" % sums["taxable"]).split(".")[0] in tt.replace("₹", ""), "the same grand total (%s)" % tt.replace("\n", " "))
        pg.click("[data-r1-switch=bill]"); W(600)

        print("4. Export")
        E(CATCH)
        pg.click("#app .tg-tabrow details.more > summary"); W(200); pg.click('#app .tg-tabrow .more-item:has-text("these bills")'); W(1500)
        x = E("""() => { const f = window.__files[0]; if (!f) return null; const bin = atob(f.b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          const wb = XLSX.read(a, {type: 'array', cellFormula: true}), ws = wb.Sheets.Bills, r = XLSX.utils.decode_range(ws['!ref']); const last = r.e.r + 1;
          return {rows: last, f: (ws['I' + last] || {}).f || '', v: (ws['I' + last] || {}).v}; }""")
        ok(x and x["f"].startswith("SUM(I2:I") and abs(x["v"] - sums["taxable"]) < 0.01, "the bills' Excel: a SUM of the taxable values in its totals row (%s)" % x)
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
