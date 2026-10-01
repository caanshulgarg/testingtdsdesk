"""python3 run_supinv.py - review of 01-Oct-2026: the supplier's invoice number for 2B reconciliation and the inward
register. Many clients keep it in the voucher number, or in the narration, not in Tally's Reference field. Client setup >
Tally: "Supplier invoice no. is in: Reference / Voucher no. / Narration"; an empty field gives way to the next.
Made-up books only."""
import json, os, threading, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8152), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
GSTIN = "09ZZZZZ1234Z1Z5"
def J(i, no, ref, narr):   # an expense booked in a journal, with input tax, from a registered supplier
    return {"id": "zz-%d" % i, "date": "20250510", "type": "Journal", "no": no, "ref": ref, "refDate": "", "party": "ZZ Supplier", "gstin": GSTIN, "pos": "", "cmp": "09AAAAA0000A1Z5",
            "narr": narr, "hsn": [], "cancel": False, "opt": False,
            "ent": [{"l": "ZZ Rent", "a": -1000, "r": None}, {"l": "Input IGST", "a": -180, "r": None}, {"l": "ZZ Supplier", "a": 1180, "r": None}]}
V = [J(1, "XF/2025-26/00007", "", "Rent for May"),            # the invoice number in the voucher number (this client's way)
     J(2, "17", "SUP-INV-0042", "Rent for May"),               # in Tally's Reference
     J(3, "18", "", "Being rent paid against Inv No. RB/889 dated 05-05-2025"),   # in the narration
     J(4, "", "", "Rent, bill no: 4411 for May")]              # nothing but the narration
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8152/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate("""(vs) => { const c = newCompany({name: "ZZ TEST", gstin: "09AAAAA0000A1Z5"}); S.companies[c.id] = c; S.coId = c.id; S.loadingCo = false;
      S.books = {loading: false, cid: c.id, vouchers: vs, gstins: {"ZZ Supplier": "%s"}, map: {}}; S.books.map = Books.mapLedgers(vs, {});
      S.books.map["Input IGST"] = {kind: "gst", side: "input", tax: "IGST", ok: true}; }""" % GSTIN, V)
    nos = lambda how: pg.evaluate("(how) => { CO().supInvFrom = how; return GST2B.bookDocs().sort((a, c) => a.id.localeCompare(c.id)).map(d => d.no); }", how)
    ok(nos("ref") == ["XF/2025-26/00007", "SUP-INV-0042", "18", "4411"], "Reference (the default): the Reference, else the voucher no., else the narration (%s)" % nos("ref"))
    ok(nos("vno") == ["XF/2025-26/00007", "17", "18", "4411"], "Voucher no.: the voucher number first (%s)" % nos("vno"))
    ok(nos("narr") == ["XF/2025-26/00007", "SUP-INV-0042", "RB/889", "4411"], "Narration: an invoice or bill number written there first (%s)" % nos("narr"))
    inw = pg.evaluate("() => { CO().supInvFrom = 'narr'; return GSTR.inward('202505', '').map(r => r.no).sort(); }")
    ok(sorted(inw) == sorted(["XF/2025-26/00007", "SUP-INV-0042", "RB/889", "4411"]), "the inward register uses the same number (%s)" % inw)
    cases = pg.evaluate("""() => ['Inv No. RB/889 dated 05-05-2025', 'invoice#A-17', 'Bill No: 4411 for May', 'paid XF/2025-26/00009 in full', 'Rent for May', 'Being salary for April']
      .map(t => Books.invInNarr(t))""")
    ok(cases == ["RB/889", "A-17", "4411", "XF/2025-26/00009", "", ""], "invoice numbers found in narrations, none where there is none (%s)" % cases)
    # Client setup > Tally: the choice, kept on the client
    pg.evaluate("() => { CO().supInvFrom = undefined; S.view = 'company'; goTab('cotally'); render(); }"); pg.wait_for_timeout(1000)
    box = pg.locator('fieldset.supinv')
    ok(box.count() == 1 and "Supplier invoice no. is in" in box.inner_text() and [l.strip() for l in box.locator("label").all_inner_texts()] == ["Reference", "Voucher no.", "Narration"],
       "Client setup > Tally: “Supplier invoice no. is in: Reference / Voucher no. / Narration”")
    ok(box.locator('input[value="ref"]').is_checked(), "Reference is chosen until the client says otherwise")
    box.locator('input[value="vno"]').check(); pg.wait_for_timeout(400)
    ok(pg.evaluate("CO().supInvFrom") == "vno" and "voucher no." in box.inner_text(), "choosing Voucher no. is kept on the client and said under the choice")
    # 2B: a 2B invoice numbered as the voucher number pairs with the journal
    pg.evaluate("""() => { const b = S.books; b.twoBs = {}; const x = GST2B.fromJson({data: {gstin: '09AAAAA0000A1Z5', rtnprd: '052025', docdata: {b2b: [{ctin: '%s', trdnm: 'ZZ Supplier', supfildt: '11-06-2025', supprd: '052025',
      inv: [{inum: 'XF/2025-26/00007', dt: '10-05-2025', val: 1180, txval: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0, rev: 'N', itcavl: 'Y', rsn: '', typ: 'R', pos: '09'}]}]}}}); b.twoBs[x.gstin + '|' + x.period] = x; GST2B._memo = null; }""" % GSTIN)
    m = pg.evaluate("() => { CO().supInvFrom = 'vno'; GST2B._memo = null; const r = GST2B.run('09'); return {pairs: JSON.stringify(r.pairs || []), only2b: (r.only2b || []).length}; }")
    ok("zz-1" in m["pairs"] and "XF/2025-26/00007" in m["pairs"] and m["only2b"] == 0, "2B: the supplier's invoice XF/2025-26/00007 is paired with the journal numbered so, nothing left in 2B only")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
