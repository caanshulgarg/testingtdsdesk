"""Made-up books for the GSTR-1 Excel tests (run_gstr1_excel.py, and run_gstr1_excel.js through
tests/fixtures/gstr1-books.json, written by `python3 gstr1_books.py`): registration 09 (Uttar Pradesh), April 2026.
  S/101  Bravo Retail (09, registered)    intra   1,00,000 @ 18%: CGST 9,000 + SGST 9,000   HSN 8471, 10 NOS   -> B2B
  S/102  Charlie Corp (07, registered)    inter     50,000 @ 18%: IGST 9,000                HSN 8471, 5 NOS    -> B2B
  S/103  Kilo Retail (unregistered)       intra     20,000 @ 18%: CGST 1,800 + SGST 1,800   SAC 9983 (service) -> B2CS 09
  S/104  Lima Traders (unregistered, DL)  inter   2,00,000 @ 18%: IGST 36,000               HSN 8471, 20 NOS   -> B2CL 07
  S/105  Kilo Retail                      nil rated  5,000                                  HSN 0401, 50 LTR   -> 8 (INTRAB2C)
  CN/1   Bravo Retail credit note         intra     10,000 @ 18%: CGST 900 + SGST 900       HSN 8471, 1 NOS    -> CDNR
SETUP(page) makes the client offline and opens its books."""
import json, os
CMP = "09AAACZ1234A1Z5"; REG = "09"; CID = "zzg1x1"
CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def chk(g14):
    s = 0
    for i, c in enumerate(g14):
        p = CH.index(c) * (2 if i % 2 else 1); s += p // 36 + p % 36
    return CH[(36 - s % 36) % 36]
def gstin(st, pan, ent="1"): g = st + pan + ent + "Z"; return g + chk(g)
GB = gstin("09", "AABCB1234B"); GC = gstin("07", "AABCC5678C"); GD = gstin("09", "AABCD4321D")   # GD: a customer only in the Excel
def SALE(id, no, party, gstin_, pos, taxable, cgst=0, igst=0, h="8471", q=0, u="NOS", sp="Goods", hd="", typ="Sales", extra=None):
    sg = -1 if typ == "Credit Note" else 1
    ent = [{"l": party, "a": -sg * (taxable + 2 * cgst + igst)}, {"l": "Sales", "a": sg * taxable, "h": h, "gr": 18 if (cgst or igst) else 0, "q": q, "u": u, "sp": sp, "hd": hd}]
    if cgst: ent += [{"l": "CGST", "a": sg * cgst}, {"l": "SGST", "a": sg * cgst}]
    if igst: ent += [{"l": "IGST", "a": sg * igst}]
    v = {"id": id, "type": typ, "date": "202604" + id[-2:], "no": no, "party": party, "gstin": gstin_, "pos": pos, "cmp": CMP, "narr": "", "hsn": [h], "cancel": False, "opt": False, "ent": ent}
    if extra: v.update(extra)
    return v
VS = [SALE("s10", "S/101", "Bravo Retail", GB, "UTTAR PRADESH", 100000, cgst=9000, q=10, hd="Laptop"),
      SALE("s12", "S/102", "Charlie Corp", GC, "DELHI", 50000, igst=9000, q=5, hd="Laptop"),
      SALE("s14", "S/103", "Kilo Retail", "", "UTTAR PRADESH", 20000, cgst=1800, h="9983", sp="Services", u="", hd="Repairs"),
      SALE("s16", "S/104", "Lima Traders", "", "DELHI", 200000, igst=36000, q=20, hd="Laptop"),
      SALE("s18", "S/105", "Kilo Retail", "", "UTTAR PRADESH", 5000, h="0401", q=50, u="LTR", hd="Milk", extra={"taxability": "Nil Rated"}),
      SALE("s20", "CN/1", "Bravo Retail", GB, "UTTAR PRADESH", 10000, cgst=900, q=1, hd="Laptop", typ="Credit Note")]
PARTIES = ["Bravo Retail", "Charlie Corp", "Kilo Retail", "Lima Traders"]
BOOKS = {"cmp": CMP, "reg": REG, "cid": CID, "vouchers": VS, "parties": PARTIES, "gstins": {"GB": GB, "GC": GC, "GD": GD}}
MAKE = """async ([cid, B]) => {
  const c = newCompany({name: "ZZ GSTR1 TEST", gstin: B.cmp}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c);
  const b = {cid, vouchers: B.vouchers, meta: {from: "20260401", to: "20260430", gstins: [B.cmp], bills: 1}, challans: [], alloc: {}, pans: {}, certs: [], gstins: {}, states: {}, twoBs: {},
    gstOpen: {[B.reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}, under: {Sales: "Sales Accounts"}, groups: {"Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"}};
  B.parties.forEach(p => { b.under[p] = "Sundry Debtors"; });
  b.map = Books.mapLedgers(B.vouchers, {});
  ["CGST", "SGST", "IGST"].forEach(t => { b.map[t] = Object.assign(b.map[t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "output", reg: B.reg, ok: true, byHand: true}); });
  await Books.save(cid, b); }"""
def setup(pg, port):
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)
    pg.evaluate(MAKE, [CID, BOOKS])
def open_r1(pg, ym="202604", sub="summary"):
    pg.evaluate("""([cid, reg, ym, sub]) => { S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "gst"; S.gstView = "return"; S.gstPart = "r1"; S.gstYm = ym; S.gstReg = reg; S.gstSub = sub;
      if (!S.books || S.books.cid !== cid) S.books = null; render(); }""", [CID, REG, ym, sub])
    for _ in range(80):
        if pg.evaluate("() => !!(S.books && S.books.cid === %s && !S.books.loading && document.querySelector('[data-r1x-bar]'))" % json.dumps(CID)): break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(500)
if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "gstr1-books.json")
    json.dump(BOOKS, open(out, "w"), indent=1); print("wrote", out)
