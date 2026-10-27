"""Made-up books for the 2B & ITC tests (run_itc_simple_ui.py; the same as run_itc_final.js): registration 09, April and
May 2026, worked out by hand.
  April: Alpha A/101 (tax 1,800, in May's 2B), Beta B/7 (3,600, in April's 2B), Delta D/9 (5,400 in the books, 4,500 in
         2B), Echo E/1 (900, never in 2B); April's 2B also Omega O/5 (900, not in the books) and Sigma's credit note CN/1
         Kappa K/1 (360, in April's 2B; marked ineligible, section 17(5), in Tally: in 4(A)(5) and reversed in 4(B)(1))
  May:   Foxtrot F/2 (1,440, in May's 2B)
SETUP(page) makes the client offline and opens its books."""
import re, json
CMP = "09AAACZ1234A1Z5"; REG = "09"; CID = "zzitc1"
GA, GB, GD, GE, GO, GS, GF = "09AABCA1111A1Z1", "09AABCB2222B1Z2", "09AABCD5555E1Z6", "09AABCE6666F1Z7", "09AABCO4444D1Z4", "09AABCS7777G1Z8", "09AABCF8888H1Z9"
GK = "09AABCK9999J1Z2"
def V(id, date, no, party, gstin, taxable, cgst):
    return {"id": id, "type": "Purchase", "date": date, "no": no, "party": party, "gstin": gstin, "pos": "", "cmp": CMP, "narr": "", "hsn": [], "cancel": False, "opt": False,
            "ent": [{"l": "Office Expenses", "a": -taxable}, {"l": "Input CGST", "a": -cgst}, {"l": "Input SGST", "a": -cgst}, {"l": party, "a": taxable + 2 * cgst}]}
def SALE(id, date, no, taxable, cgst):
    return {"id": id, "type": "Sales", "date": date, "no": no, "party": "Kilo Retail", "gstin": "", "pos": "", "cmp": CMP, "narr": "", "hsn": [],
            "ent": [{"l": "Kilo Retail", "a": -(taxable + 2 * cgst)}, {"l": "Sales", "a": taxable}, {"l": "CGST", "a": cgst}, {"l": "SGST", "a": cgst}]}
VS = [V("a1", "20260405", "A/101", "Alpha Supplies", GA, 10000, 900), V("b1", "20260410", "B/7", "Beta Traders", GB, 20000, 1800),
      V("d1", "20260412", "D/9", "Delta Services", GD, 30000, 2700), V("e1", "20260418", "E/1", "Echo Stores", GE, 5000, 450),
      dict(V("k1", "20260420", "K/1", "Kappa Caterers", GK, 2000, 180), ineligibleFlag=True),
      V("f1", "20260508", "F/2", "Foxtrot Labs", GF, 8000, 720), SALE("s1", "20260420", "S/1", 200000, 18000), SALE("s2", "20260520", "S/2", 100000, 9000)]
def row(ym, gstin, party, no, date, taxable, cgst, d=1):
    nn = re.sub(r"[^A-Z0-9]", "", no.upper())
    return {"no": no, "noN": nn, "ym": ym, "dir": d, "ims": "N", "key": ym[4:] + ym[:4] + "|" + ("cdnr" if d < 0 else "b2b") + "|" + gstin + "|" + no + "|" + date, "pos": REG, "rcm": False,
            "sec": "cdnr" if d < 0 else "b2b", "typ": "R", "val": taxable + 2 * cgst, "cess": 0, "cgst": cgst, "sgst": cgst, "igst": 0, "date": date, "gstin": gstin, "party": party, "itcavl": "Y", "taxable": taxable}
TWOB = {CMP + "|042026": {"ym": "202604", "gstin": CMP, "period": "042026", "rows": [row("202604", GB, "BETA TRADERS", "B/7", "20260410", 20000, 1800), row("202604", GD, "DELTA SERVICES", "D/9", "20260412", 25000, 2250),
        row("202604", GO, "OMEGA LOGISTICS", "O/5", "20260415", 5000, 450), row("202604", GS, "SIGMA PAPER", "CN/1", "20260416", 1000, 90, -1),
        row("202604", GK, "KAPPA CATERERS", "K/1", "20260420", 2000, 180)]},
        CMP + "|052026": {"ym": "202605", "gstin": CMP, "period": "052026", "rows": [row("202605", GA, "ALPHA SUPPLIES", "A/101", "20260405", 10000, 900), row("202605", GF, "FOXTROT LABS", "F/2", "20260508", 8000, 720)]}}
MAKE = """async ([cid, cmp, reg, vs, twoBs]) => {
  const c = newCompany({name: "ZZ ITC TEST", gstin: cmp}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c);
  const b = {cid, vouchers: vs, meta: {from: "20260401", to: "20260531", gstins: [cmp], bills: 1}, challans: [], alloc: {}, pans: {}, certs: [], gstins: {}, states: {}, twoBs,
    gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}, under: {"Kilo Retail": "Sundry Debtors", Sales: "Sales Accounts"}, groups: {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"}};
  ["Alpha Supplies", "Beta Traders", "Delta Services", "Echo Stores", "Foxtrot Labs", "Kappa Caterers"].forEach(p => { b.under[p] = "Sundry Creditors"; });
  b.map = Books.mapLedgers(vs, {});
  ["CGST", "SGST"].forEach(t => { b.map[t] = Object.assign(b.map[t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "output", reg, ok: true, byHand: true});
    b.map["Input " + t] = Object.assign(b.map["Input " + t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "input", reg, ok: true, byHand: true}); });
  await Books.save(cid, b); }"""
def setup(pg, port):
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1000)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)
    pg.evaluate(MAKE, [CID, CMP, REG, VS, TWOB])
def open_part(pg, part, ym="202604"):
    pg.evaluate("""([cid, part, reg, ym]) => { S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "gst"; S.gstView = "return"; S.gstPart = part; S.gstYm = ym; S.gstReg = reg; S.gstSub = "";
      if (!S.books || S.books.cid !== cid) S.books = null; render(); }""", [CID, part, REG, ym])
    t = 0
    while t < 60:
        if pg.evaluate("() => !!(S.books && S.books.cid === %s && !S.books.loading && document.querySelector('[data-gst-page]'))" % json.dumps(CID)): break
        pg.wait_for_timeout(250); t += 1
    pg.wait_for_timeout(400)
