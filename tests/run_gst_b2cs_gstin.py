"""python3 run_gst_b2cs_gstin.py - a B2C summary that carries a GSTIN (the owner, a CA, 12-Nov-2026): one sales entry in
Tally for many B2C sales received through a payment gateway, numbered "2026-27/155 to     2026-27/182" (several spaces),
the party the gateway (GST-registered), and Tally put the gateway's GSTIN on the voucher. FinCom read it as one B2B
invoice to the gateway and What to fix listed it as "Invoice number too long" and "characters the portal refuses".
The rule of next-gst-b2cs-summary (GSTR.b2cSumWhy: "entry", "ledger", "range") now holds with or without a GSTIN:
  1. the entry is B2C small (B2CS) by place of supply and rate: never B2B to the gateway, never B2C large; the row has no
     GSTIN (the gateway's kept apart, sumGstin), so no GSTIN check (valid, e-invoice) and no B2B line in the JSON;
  2. its place of supply is not the gateway's GSTIN's state: Tally's place of supply, CGST+SGST: the own registration's
     state, IGST with none: missing (as for any unregistered B2C sale);
  3. its number is not checked (length, characters, used twice); table 13 still counts the range;
  4. credit notes, SEZ and reverse charge stay out of it;
  5. the switches are offered for such entries: "This is a summary of many B2C sales" on a B2B row of What to fix, and
     the party ledger's "Consolidated B2C" on a registered party with a range-numbered sale;
  6. two Sales entries with the same number to two parties: flagged "used twice", unless one is a B2C summary.
Made-up names only. Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("GSTB2CSG_PORT") or 8731)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

YM, REG = "202604", "07"
GW = "PayGate Ltd"                      # a made-up payment gateway, GST-registered in Delhi (07)
GW27 = "PayGate Mumbai Ltd"             # the same, registered in Maharashtra (27)
RANGE = "2026-27/155 to     2026-27/182"
NUMCHK = ["Invoice numbers longer than 16 characters", "Invoice numbers with characters the portal does not take", "Invoice numbers used twice in the financial year"]
GSTCHK = ["Buyer GSTINs that are not valid", "Invoices to registered customers without an e-invoice (IRN)", "Invoices to a registered party with no GSTIN"]
CHECKS = "(a) => Object.fromEntries(GSTR.checks(a[0], a[1]).map(c => [c.what, {n: c.n, ids: (c.all || c.rows).map(r => (r.doc || r).id)}]))"
ROW = "(id) => { const r = GSTR.outward('" + YM + "', '" + REG + "').find(r => r.id === id); return r ? {kind: r.kind, sum: r.b2cSum || '', no: r.no, gstin: r.gstin, sumGstin: r.sumGstin || '', pos: r.posCode, from: r.posFrom} : null; }"
GSTIN = "(base) => { const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; for (const c of C) if (gstinValid(base + c)) return base + c; return null; }"
# a sale (or a credit note) of `total`, taxable `taxable` at 18%: IGST (inter) or CGST and SGST of the Delhi registration
ADD = """(o) => { const tax = Math.round((o.total - o.taxable) * 100) / 100, half = Math.round(tax / 2 * 100) / 100, cn = /Credit/.test(o.type || ''), sg = cn ? -1 : 1;
  const v = {id: o.id, date: o.date || '20260430', type: o.type || 'Sales', no: o.no, ref: '', refDate: '', irn: '', irnDate: '', party: o.party, gstin: o.gstin || '', pos: o.pos == null ? '' : o.pos, cmp: '07AAGCL4827M1Z3',
    narr: 'Collections through the gateway', regType: o.regType || (o.gstin ? 'Regular' : 'Unregistered'), country: 'India', rcm: !!o.rcm, taxability: 'Taxable', nature: '', supply: 'Services', ineligibleFlag: false,
    hsn: ['998596'], by: 'accounts', upd: '', cancel: false, opt: false, alt: 9500 + S.books.vouchers.length,
    ent: [{l: o.party, a: -sg * o.total, r: null}, {l: 'Event Management Services', a: sg * o.taxable, r: 9, h: '998596', gr: 18, sp: 'Services'}].concat(o.inter ? [{l: '07 IGST OUTPUT', a: sg * tax, r: null}] : [{l: '07 CGST OUTPUT', a: sg * half, r: null}, {l: '07 SGST OUTPUT', a: sg * Math.round((tax - half) * 100) / 100, r: null}])};
  if (o.gstin) S.books.gstins = Object.assign({}, S.books.gstins || {}, {[o.party]: o.gstin});
  S.books.vouchers = S.books.vouchers.concat([v]); S.books.map = Books.mapLedgers(S.books.vouchers, S.books.map); LedMaster.refresh(S.books); render(); return v.id; }"""
DROP = "(ids) => { S.books.vouchers = S.books.vouchers.filter(v => !ids.includes(v.id)); render(); }"
COUNTS = "(a) => { const e = GSTR.errorsFor(a[0], a[1]), l = GSTR.errorChecks(a[0], a[1]); return {r1: e.r1, l1: l.r1.reduce((s, c) => s + c.n, 0)}; }"
def has(ch, k, i): return i in ch.get(k, {}).get("ids", [])

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        G07 = pg.evaluate(GSTIN, "07AAFCP4821K1Z"); G27 = pg.evaluate(GSTIN, "27AAFCP4821K1Z")
        ok(G07 and G27, "made-up valid GSTINs for the gateway (%s, %s)" % (G07, G27))
        base = pg.evaluate(COUNTS, [YM, REG])
        ok((pg.evaluate("(n) => GSTR.noRange(n)", RANGE) or {}).get("n") == 28, "'2026-27/155 to     2026-27/182' (several spaces) is a range of 28")

        # 1-3: the owner's case: the gateway's GSTIN on the voucher, the same state, CGST and SGST, no place of supply in Tally
        a = pg.evaluate(ADD, {"id": "t-gwg-intra", "no": RANGE, "party": GW, "gstin": G07, "total": 593206.01, "taxable": 502716.96})
        r = pg.evaluate(ROW, a); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2C" and r["sum"] == "range", "the gateway's GSTIN on the voucher, a range number: B2C small (B2CS), not B2B; the rule: the number is a range (%s)" % r)
        ok(r and r["gstin"] == "" and r["sumGstin"] == G07, "the row carries no buyer GSTIN; the gateway's is kept apart (%s)" % r)
        ok(r and r["pos"] == "07" and r["from"] == "tax", "place of supply: CGST and SGST, so the own registration's state, 07 (%s)" % r)
        ok(not any(has(ch, k, a) for k in NUMCHK + GSTCHK), "no invoice-number finding and no GSTIN finding on it (%s)" % {k: ch[k] for k in NUMCHK + GSTCHK if k in ch})
        # IGST, the gateway registered in another state, Tally's place of supply Karnataka: Karnataka, not the GSTIN's 27
        b = pg.evaluate(ADD, {"id": "t-gwg-inter", "no": RANGE, "party": GW27, "gstin": G27, "inter": True, "pos": "Karnataka", "total": 236000, "taxable": 200000, "date": "20260420"})
        r = pg.evaluate(ROW, b)
        ok(r and r["kind"] == "B2C" and r["pos"] == "29" and r["from"] == "tally", "IGST, the gateway in Maharashtra, Tally's place of supply Karnataka: B2CS for Karnataka (29) (%s)" % r)
        # IGST and no place of supply: missing, never the gateway's GSTIN's state
        c = pg.evaluate(ADD, {"id": "t-gwg-nopos", "no": "PG/2026-27/301 to PG/2026-27/340", "party": GW27, "gstin": G27, "inter": True, "total": 118000, "taxable": 100000, "date": "20260421"})
        r = pg.evaluate(ROW, c); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2C" and r["pos"] == "" and has(ch, "Outward invoices with no place of supply", c), "IGST and no place of supply: missing (What to fix asks for it), not 27 from the gateway's GSTIN (%s)" % r)
        pg.evaluate("(id) => { S.books.gstPosFix = Object.assign({}, S.books.gstPosFix || {}, {[id]: {pos: '33', by: 't', at: ''}}); render(); }", c)
        r = pg.evaluate(ROW, c)
        ok(r and r["pos"] == "33" and r["from"] == "fincom", "a place of supply typed on What to fix is used (%s)" % r)
        j = pg.evaluate("(a) => GSTR.toJson(a[0], a[1])", [YM, REG])
        ok(not any(g.get("ctin") in (G07, G27) for g in j.get("b2b", [])), "the JSON: no B2B line to the gateway")
        s07 = [x for x in j.get("b2cs", []) if x["pos"] == "07" and x["rt"] == 18]; s29 = [x for x in j.get("b2cs", []) if x["pos"] == "29" and x["rt"] == 18]
        ok(s07 and s07[0]["txval"] >= 502716.96 - 0.01 and s29 and abs(s29[0]["txval"] - 200000) < 0.01 and abs(s29[0]["iamt"] - 36000) < 0.01, "the JSON: B2CS Delhi (07) holds the summary; Karnataka (29) 2,00,000, IGST 36,000 (%s / %s)" % (s07, s29))
        t3 = pg.evaluate("(a) => GSTR.sec31(GSTR.outward(a[0], a[1]), []).unregPos", [YM, REG])
        ok(any(x["pos"] == "29" and x["taxable"] >= 200000 - 0.01 for x in t3), "3B 3.2 (inter-state to unregistered persons) has the Karnataka summary (%s)" % t3)
        docs = [d for g in j.get("doc_issue", {}).get("doc_det", []) if g["doc_num"] == 1 for d in g["docs"] if str(d["from"]).startswith("2026-27/")]
        ok(docs and docs[0]["totnum"] >= 28, "table 13 still counts the range in its series (%s)" % docs)

        # 4: credit notes, SEZ and reverse charge stay out of it
        n = pg.evaluate(ADD, {"id": "t-gwg-cn", "type": "Credit Note", "no": "CN/155 to CN/160", "party": GW, "gstin": G07, "total": 1180, "taxable": 1000, "date": "20260422"})
        z = pg.evaluate(ADD, {"id": "t-gwg-sez", "no": "SZ/1 to SZ/9", "party": GW, "gstin": G07, "regType": "SEZ", "inter": True, "total": 1180, "taxable": 1000, "date": "20260422"})
        q = pg.evaluate(ADD, {"id": "t-gwg-rcm", "no": "RC/1 to RC/9", "party": GW, "gstin": G07, "rcm": True, "total": 1180, "taxable": 1000, "date": "20260422"})
        rs = [pg.evaluate(ROW, i) for i in (n, z, q)]
        ok(rs[0] and rs[0]["kind"] == "CDNR" and rs[0]["sum"] == "" and rs[0]["gstin"] == G07, "a credit note numbered as a range: still a credit note to the GSTIN (%s)" % rs[0])
        ok(rs[1] and rs[1]["kind"] == "B2B" and rs[1]["sum"] == "", "an SEZ sale numbered as a range: still B2B (SEZ) (%s)" % rs[1])
        ok(rs[2] and rs[2]["kind"] == "B2B" and rs[2]["sum"] == "", "a reverse-charge sale numbered as a range: not a summary (%s)" % rs[2])
        pg.evaluate(DROP, [n, z, q])

        # 5: the switches. A registered party, a number that is no range and too long: B2B, flagged; the switch on What to fix
        e = pg.evaluate(ADD, {"id": "t-gwg-long", "no": "PG APR-26 SUMMARY 01", "party": GW, "gstin": G07, "total": 59000, "taxable": 50000, "date": "20260425"})
        r = pg.evaluate(ROW, e); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2B" and has(ch, NUMCHK[0], e) and has(ch, NUMCHK[1], e), "no range and no switch: B2B to the gateway, its number flagged (%s)" % r)
        # c's place of supply missing again, so the month keeps an error and What to fix stays after the click
        pg.evaluate("(id) => { delete S.books.gstPosFix[id]; render(); }", c)
        pg.evaluate("(a) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = a[1]; S.gstYm = a[0]; render(); }", [YM, REG]); pg.wait_for_timeout(600)
        pg.click('#app [data-cell="GSTR-1|%s"]' % YM); pg.wait_for_timeout(800)
        pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (g && !g.querySelector('[data-fix-row]')) g.querySelector('[data-fix-toggle]').click(); }", NUMCHK[0]); pg.wait_for_timeout(300)
        ok(pg.evaluate("(id) => !!document.querySelector('#app [data-fix-row][data-id=\"' + id + '\"] [data-b2cs-mark]')", e), "What to fix: the B2B row offers 'This is a summary of many B2C sales'")
        n0 = pg.evaluate(COUNTS, [YM, REG])["r1"]
        pg.click('#app [data-fix-row][data-id="%s"] [data-b2cs-mark]' % e); pg.wait_for_timeout(500)
        r = pg.evaluate(ROW, e); n1 = pg.evaluate(COUNTS, [YM, REG])
        ok(r and r["kind"] == "B2C" and r["sum"] == "entry" and r["gstin"] == "", "marked: B2CS, the rule: marked on the entry, no buyer GSTIN (%s)" % r)
        ok(n1["r1"] == n0 - 2 and n1["l1"] == n1["r1"], "What to fix and the grid: its two number findings gone (%s -> %s)" % (n0, n1))
        sm = pg.evaluate("() => Array.from(document.querySelectorAll('#app [data-b2cs-sum] [data-b2cs-row]')).map(r => [r.dataset.b2csRow, r.dataset.why, r.innerText.replace(/\\s+/g, ' ')])")
        ok(any(x[0] == a and x[1] == "range" and G07 in x[2] for x in sm) and any(x[0] == e and x[1] == "entry" for x in sm), "the list of summaries shows them, with the gateway's GSTIN said not to be used (%s)" % sm)
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, null)", e)
        ok(pg.evaluate(ROW, e)["kind"] == "B2B", "cleared: B2B again")
        # the party ledger's switch, for a registered party
        pg.evaluate("(n) => GSTR.b2cSumLedger(n, true)", GW)
        r = pg.evaluate(ROW, e)
        ok(r and r["kind"] == "B2C" and r["sum"] == "ledger", "the party ledger set as Consolidated B2C: its sale with a GSTIN goes to B2CS (%s)" % r)
        pg.evaluate("(n) => GSTR.b2cSumLedger(n, false)", GW)
        pg.evaluate("() => { S.booksTab = 'ledgers'; S.ledQ = 'PayGate'; render(); }"); pg.wait_for_timeout(800)
        sw = pg.evaluate("(n) => { const x = document.querySelector('#app [data-b2cs-ledger=\"' + n + '\"]'); return x ? [x.checked, (x.closest('label') || {}).innerText || ''] : null; }", GW)
        ok(sw and sw[0] is False and "Consolidated B2C" in sw[1], "Books > Tally ledgers: the registered gateway's ledger (a range-numbered sale) has the switch (%s)" % sw)
        pg.evaluate(DROP, [e])

        # 6: the same number on two Sales entries to two parties: used twice; not when one is a B2C summary
        d1 = pg.evaluate(ADD, {"id": "t-dup-1", "no": "2026-27/49", "party": "Alder Traders", "gstin": pg.evaluate(GSTIN, "07AAKFA1234B1Z"), "total": 118, "taxable": 100, "date": "20260410"})
        d2 = pg.evaluate(ADD, {"id": "t-dup-2", "no": "2026-27/49", "party": "Birch Stores", "gstin": pg.evaluate(GSTIN, "07AAKFB5678C1Z"), "total": 59, "taxable": 50, "date": "20260412"})
        ch = pg.evaluate(CHECKS, [YM, REG])
        ok(has(ch, NUMCHK[2], d1) and has(ch, NUMCHK[2], d2), "'2026-27/49' on two Sales entries to two parties (tiny amounts): both flagged used twice (%s)" % ch.get(NUMCHK[2]))
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, true)", d2)
        ch = pg.evaluate(CHECKS, [YM, REG])
        ok(not has(ch, NUMCHK[2], d1) and not has(ch, NUMCHK[2], d2), "one of them marked a B2C summary: its number is no invoice number, neither is flagged (%s)" % ch.get(NUMCHK[2]))
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, null)", d2)
        d3 = pg.evaluate(ADD, {"id": "t-dup-3", "no": "2026-27/50", "party": "Walk-in Buyer", "total": 59, "taxable": 50, "date": "20260412"})
        d4 = pg.evaluate(ADD, {"id": "t-dup-4", "no": "2026-27/50", "party": "Alder Traders", "gstin": pg.evaluate(GSTIN, "07AAKFA1234B1Z"), "total": 118, "taxable": 100, "date": "20260413"})
        ch = pg.evaluate(CHECKS, [YM, REG])
        ok(not has(ch, NUMCHK[2], d4), "a B2C small sale and a B2B invoice with the same number: B2C small carries no number on the portal, not flagged (%s)" % ch.get(NUMCHK[2]))
        pg.evaluate(DROP, [d1, d2, d3, d4, a, b, c])
        c9 = pg.evaluate(COUNTS, [YM, REG])
        ok(c9 == base, "all taken out: the counts are as before (%s, before %s)" % (c9, base))
        ok(pg.evaluate("() => document.querySelectorAll('#app [data-guard]').length") == 0, "no error box")
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
