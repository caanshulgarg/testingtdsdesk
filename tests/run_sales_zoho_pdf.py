"""python3 run_sales_zoho_pdf.py - one PDF of many sales invoices printed by Zoho Books (B2C car-care services, made up:
tests/make_zoho_sales_pdf.py), uploaded on the Sales page as the owner did (24-Nov-2026: "these sales invoices are not
getting uploaded": only the first few of a long PDF stayed). Every invoice is read and kept: its number, date, customer
(the name under Bill To, not "Terms : Due on Receipt" beside it), place of supply, the taxable value after the discount,
CGST and SGST, the rounding, the total, and B2C (no GSTIN). The sync bringing a change while the file is being read
(the list on screen made afresh) loses none of them; the PDF is kept once, not once for each invoice in it; one invoice
on its own (2 pages) is read the same; the same file again adds nothing. Offline, a made-up client.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sales_zoho_pdf.py"""
import os, sys, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("TDSDESK_PORT", "8163"))
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(pg, js, secs):
    """the page's own answer to js, looked at every 250 ms (the page's rules refuse a string to wait on)"""
    t = time.time()
    while time.time() - t < secs:
        if pg.evaluate(js): return True
        pg.wait_for_timeout(250)
    return False
sys.path.insert(0, HERE)
import make_zoho_sales_pdf as Z
FIX = os.path.join(HERE, "fixtures", "sales-zoho")
MANY = os.path.join(FIX, "zoho-sales-12.pdf"); EXP = json.load(open(os.path.join(FIX, "zoho-sales-12.json"))); N = len(EXP)
ONE = os.path.join(OUT, "zoho-sales-1.pdf"); ONE_EXP = Z.make(ONE, 1, first=500)     # one invoice on its own, made here
LEDGERS = ["Cash", "Sales @ 18% Local", "Output CGST", "Output SGST", "Output IGST", "Round Off", "HDFC Bank"]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate("""([leds, g]) => { const c = newCompany({name: "ZZ Sparkle Car Care Pvt Ltd", gstin: g}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      window.__puts = 0; const put = FileStore.put.bind(FileStore); FileStore.put = (...a) => { if (String(a[1]).startsWith("sv:")) window.__puts++; return put(...a); };
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.bank.ledgers = {list: leds.map(n => ({name: n, group: /Sales/.test(n) ? "Sales Accounts" : /Output|Round/.test(n) ? "Duties & Taxes" : /Bank/.test(n) ? "Bank Accounts" : "Cash-in-Hand"})), importedAt: new Date().toISOString(), live: true}; S.tab = "sales"; S.step = null; return loadSales(c.id); }); }""", [LEDGERS, Z.SELLER_GSTIN])
    pg.wait_for_timeout(800)
    ok(pg.locator("#salesDrop").count() == 1, "the Sales page, no invoices yet")
    # the whole PDF; while its 4th invoice is being read, the sync brings an invoice made on another computer (the list on
    # screen made afresh, as cloudApplyNow does)
    pg.evaluate("""() => { const read = window.__read = readSalesFile; let n = 0; window.__seen = [];
      window.readSalesFile = async (...a) => { const r = await read(...a); n++; window.__seen.push(SL() ? SL().busy : "");
        if (n === 4){ const cid = SL().cid; const v = newInvoice({number: "OTHER/1", date: "2026-10-01", customerName: "Other Desk Buyer", taxable: 100, cgst: 9, sgst: 9, total: 118}, "created");
          await cloudApplyNow([{kind: "sales", id: cid + ":" + v.id, client_id: cid, data: JSON.parse(JSON.stringify(v))}]); window.__after = 1; }
        else if (window.__after === 1){ window.__after = SL() ? SL().busy : ""; }
        return r; }; }""")
    pg.set_input_files("#salesIn", MANY)
    until(pg, "() => window.__seen.length > 0", 60)
    until(pg, "() => SL() && !SL().loading && !SL().busy", 240); pg.wait_for_timeout(800)
    seen = pg.evaluate("window.__seen")
    ok(len(seen) == N and " of %d" % N in seen[0], "while it reads, the page says which invoice of how many: \"%s\"" % (seen[:1] or [""])[0])
    ok(" of %d" % N in str(pg.evaluate("window.__after")), "after the sync, the reading still shows on the page: \"%s\"" % pg.evaluate("window.__after"))
    pg.evaluate("() => { window.readSalesFile = window.__read; }")
    got = pg.evaluate("SL().list.filter(v => v.source === 'upload').map(v => ({stated: v.x.roundOff || 0, number: v.x.number, date: v.x.date, customer: v.x.customerName, gstin: v.x.customerGstin, pos: v.x.pos, taxable: v.x.taxable, cgst: v.x.cgst, sgst: v.x.sgst, igst: v.x.igst, total: v.x.total, method: v.method, docOf: v.docOf || '', file: !!S.files['sv:' + v.id], problems: (v.problems || []).join('; ')}))")
    ok(len(got) == N, "all %d invoices of the PDF in Sales (%d)" % (N, len(got)))
    ok(pg.evaluate("SL().list.some(v => v.x.number === 'OTHER/1')"), "and the invoice the sync brought")
    ok(pg.evaluate("BankDB.get('sales:' + SL().cid).then(l => (l || []).length)") == N + 1, "all of them kept in this browser")
    by = {g["number"]: g for g in got}
    for e in EXP:
        g = by.get(e["number"])
        if not g: ok(False, "%s read" % e["number"]); continue
        bad = [k for k in ("date", "customer", "pos", "taxable", "cgst", "sgst", "total") if g[k] != e[k]] + (["B2C"] if g["gstin"] else []) + (["igst"] if g["igst"] else [])
        ok(not bad, "%s: %s, %s, taxable %s, CGST %s, SGST %s, rounding %s, total %s, B2C%s" % (e["number"], e["date"], e["customer"], e["taxable"], e["cgst"], e["sgst"], e["rounding"], e["total"],
           "" if not bad else "  -- wrong: " + ", ".join("%s=%r" % (k, g.get(k.lower(), g.get("gstin"))) for k in bad)))
    st = [e["number"] for e in EXP if abs((by.get(e["number"]) or {}).get("stated", 99) - round(e["adjustment"] + e["rounding"], 2)) > 0.005]
    ok(not st, "each invoice's own Adjustment and Rounding read as its round off" + ("" if not st else ": wrong on " + ", ".join(st)))
    ok(all(g["method"] == "free" for g in got), "every one read on this computer, every check passed (%s)" % sorted(set(g["method"] for g in got)))
    ok(not [g for g in got if "plus GST" in g["problems"] or "differ" in g["problems"]], "no invoice held for its figures")
    ok(pg.evaluate("window.__puts") == 1 and sum(1 for g in got if not g["docOf"]) == 1 and all(g["file"] for g in got), "the PDF kept once, every invoice opens it")
    pg.screenshot(path=OUT + "/sales-zoho.png")
    # the same file again: nothing added
    pg.set_input_files("#salesIn", MANY); pg.wait_for_timeout(1500)
    until(pg, "() => SL() && !SL().busy", 120); pg.wait_for_timeout(500)
    ok(pg.evaluate("SL().list.length") == N + 1, "the same PDF again: nothing added twice")
    # one invoice on its own (2 pages)
    pg.set_input_files("#salesIn", ONE); pg.wait_for_timeout(1500)
    until(pg, "() => SL() && !SL().busy", 120); pg.wait_for_timeout(500)
    one = pg.evaluate("(() => { const v = SL().list[SL().list.length - 1]; return {number: v.x.number, customer: v.x.customerName, taxable: v.x.taxable, total: v.x.total, gstin: v.x.customerGstin, method: v.method}; })()")
    e = ONE_EXP[0]
    ok(one["number"] == e["number"] and one["customer"] == e["customer"] and one["taxable"] == e["taxable"] and one["total"] == e["total"] and not one["gstin"] and one["method"] == "free",
       "one invoice on its own (2 pages): %s, %s, taxable %s, total %s" % (one["number"], one["customer"], one["taxable"], one["total"]))
    # the owner, 24-Nov-2026: a Zoho "Adjustment" (and Rounding) goes to Round Off with no separate ledger, and an invoice
    # whose difference is its own stated Adjustment plus Rounding posts with it there; only a difference the invoice does
    # not explain is held
    ro = pg.evaluate("""() => { const mk = (no, ro, total) => { const v = newInvoice({number: no, date: "2026-10-05", customerName: "Cash", pos: "29", taxable: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0, roundOff: ro, total}, "upload");
        v.customerLedger = "Cash"; SL().list.push(v); mapInvoice(v); return v; };
      const one = v => { const l = salesLines(v).filter(l => l.role === "roundoff"); return {ro: l.map(l => (l.side === "Cr" ? 1 : -1) * l.amt), held: (v.problems || []).filter(p => /Round Off/.test(p)).length}; };
      const r = {plus: one(mk("ADJ/1", 25, 1205)), minus: one(mk("ADJ/2", -25, 1155)), gap: one(mk("ADJ/3", 0, 1205)), wrong: one(mk("ADJ/4", 10, 1205))}; saveSales(); render(); return r; }""")
    ok(ro["plus"] == {"ro": [25], "held": 0}, "Adjustment \u20b925 on the invoice: posts, with \u20b925 to Round Off (%s)" % ro["plus"])
    ok(ro["minus"] == {"ro": [-25], "held": 0}, "Adjustment (-) \u20b925: posts, with \u20b925 to Round Off on the debit side (%s)" % ro["minus"])
    ok(ro["gap"]["held"] == 1, "a \u20b925 gap the invoice does not explain: still held (%s)" % ro["gap"])
    ok(ro["wrong"]["held"] == 1, "a \u20b925 gap with only \u20b910 stated: still held (%s)" % ro["wrong"])
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
try: os.remove(ONE)
except OSError: pass
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
