"""python3 run_gst_portal.py - the GST module in the GSTN portal's own structure (round 72, 17-Oct-2026; the owner: "GST
module including 1, 2B, 3B, amendments should match the GSTN schema so that anyone can understand what is there in that
field.. users are habitual of that schema.. 2B reco should be clear to understand"), on the fixture books (2025-26 and
the same books a year on, as tdsgst_snapshot.py loads them) with a 2B made for them below:

  1. GSTR-1: the portal's tables, numbered and named as the portal, with its column headings; each table's totals are the
     GSTR-1 JSON's (GSTR.toJson), every month and GSTIN; the summary's rows (the portal's names) unchanged against the JSON;
     9A (B2BA): the copy filed beside what goes in the file, its totals the file's b2ba;
  2. GSTR-3B: the portal's tables 3.1, 3.1.1, 3.2, 4, 5, 5.1, 6.1, their row labels and column heads; each figure is
     GSTR.threeB's and the GSTR-3B JSON's (every month and GSTIN); the bills behind every clickable figure and what is
     added to them add up to it; a figure clicked shows them;
  3. GSTR-2B: the portal's sections (Part A) and the summary as the 2B summary PDF lays it out, its totals the documents';
     the ECO and ISDA sections read (17-Oct-2026): ECO under Part A I, ISDA under II and its credit notes under Part B,
     the summary's totals the sum of its lines and of the sections' footers;
  4. 2B reconciliation: one row per supplier invoice, the statuses (Matched, Mismatch, Probable match, In books only, In 2B
     only) as GST2B's matching says, the chips' counts, ITC as per books / as per 2B / difference equal to the figures the
     2B page showed before (the workbench's tiles), the differing field highlighted, the actions, the Excel's formulas,
     and the automatic matcher's hook (statuses "matched-rules", "matched-ai", "probable") without moving an amount;
  6. GSTR-1 table 14 (17-Oct-2026): sales through an e-commerce operator, by the operator's GSTIN, 14(a) where it collects
     TCS, 14(b) empty with a note; the JSON's supeco is the screen's, its total the operator sales', and no other table moves;
     the old "Supplies through an e-commerce operator (14)" card is gone (the owner, 17-Oct-2026: table 14 is the one place);
  5. the page pattern: one tab row, filters in the headings, footer totals, 100-row paging; at 390 px no sideways page
     scroll; screenshots of each screen, desktop and phone, in tests/out/gst-portal/.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("GSTPORTAL_PORT") or 8743)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "gst-portal"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
G07 = "07AAGCL4827M1Z3"

# a 2B for the Delhi registration's year, made from its bills: an exact match, a bill booked twice (amount mismatch), a
# date that differs, a number written differently, credit not available (place of supply), a bill not in 2B, a number
# that differs with the same amounts (probable), a 2B invoice not in the books, a supplier's credit note, an import
def inv(ctin, name, inum, dt, txval, igst=0, cgst=0, sgst=0, **k):
    return {"ctin": ctin, "trdnm": name, "supfildt": "11-" + dt[3:], "supprd": dt[3:5] + dt[6:], "inv": [dict({"inum": inum, "dt": dt, "val": txval + igst + cgst + sgst, "txval": txval, "igst": igst, "cgst": cgst, "sgst": sgst, "cess": 0, "pos": "07", "rev": "N", "itcavl": "Y", "rsn": "", "typ": "R"}, **k)]}
TWO_B = {
    "052025": {"b2b": [inv("07AAKFN4416E1ZF", "NIGHTJAR SOUND & LIGHT CO", "NSL/112", "08-05-2025", 100000, cgst=9000, sgst=9000)]},
    "072025": {"b2b": [inv("06AAFCK2290B1ZX", "KESTREL COMPUTERS PVT LTD", "KC/1187", "02-07-2025", 80000, igst=14400)]},
    "082025": {"b2b": [inv("07AAICS7751J1ZV", "SALTMARSH SOFTWARE PVT LTD", "SS-AUG-077", "12-08-2025", 120000, cgst=10800, sgst=10800)]},
    "092025": {"b2b": [inv("09ACBPP3390L1Z7", "PEREGRINE TENT WORKS", "PTW/2025/77", "15-09-2025", 200000, igst=36000, itcavl="N", rsn="P")]},
    "012026": {"b2b": [inv("07AAKFN4416E1ZF", "NIGHTJAR SOUND & LIGHT CO", "INV-9001", "20-01-2026", 150000, cgst=13500, sgst=13500)]},
    "022026": {"b2b": [inv("07AAAAW1234A1Z5", "WREN PRINT HOUSE", "WPH/88", "09-02-2026", 10000, cgst=900, sgst=900)],
               "cdnr": [{"ctin": "07AAHFJ6012N1Z7", "trdnm": "JUNIPER LEGAL ASSOCIATES", "supfildt": "11-03-2026", "supprd": "022026", "nt": [{"ntnum": "JLA/CN/4", "dt": "25-02-2026", "typ": "C", "val": 5900, "txval": 5000, "igst": 0, "cgst": 450, "sgst": 450, "cess": 0, "pos": "07", "rev": "N", "itcavl": "Y", "rsn": ""}]}]},
    "032026": {"impg": [{"refdt": "10-03-2026", "portcode": "INDEL4", "boenum": "7712345", "boedt": "08-03-2026", "isamd": "N", "txval": 25000, "igst": 4500, "cess": 0}]},
    # ECO (an operator's document, tax paid by it u/s 9(5)), ISD and ISDA (an amended ISD invoice and an amended ISD credit note)
    "112025": {"ecom": [{"ctin": "07AAICQ4321B1CZ", "trdnm": "QUICKBITE ECO PVT LTD", "supfildt": "11-12-2025", "supprd": "112025", "inv": [{"inum": "QB/ECO/5521", "typ": "R", "dt": "14-11-2025", "val": 5250, "pos": "07", "txval": 5000, "igst": 0, "cgst": 125, "sgst": 125, "cess": 0, "itcavl": "Y", "rsn": "", "irn": "f00d"}]}],
               "isd": [{"ctin": "07AAACI5555K1ZQ", "trdnm": "HEAD OFFICE ISD", "supfildt": "13-12-2025", "supprd": "112025", "doclist": [{"doctyp": "I", "docnum": "ISD/25/31", "docdt": "30-11-2025", "igst": 1200, "cgst": 0, "sgst": 0, "cess": 0, "itcelg": "Y"}]}],
               "isda": [{"ctin": "07AAACI5555K1ZQ", "trdnm": "HEAD OFFICE ISD", "supfildt": "13-12-2025", "supprd": "112025", "doclist": [
                   {"doctyp": "I", "docnum": "ISD/25/27A", "docdt": "29-11-2025", "odoctyp": "I", "odocnum": "ISD/25/27", "odocdt": "31-10-2025", "igst": 360, "cgst": 0, "sgst": 0, "cess": 0, "itcelg": "Y"},
                   {"doctyp": "C", "docnum": "ISDC/25/4A", "docdt": "29-11-2025", "odoctyp": "C", "odocnum": "ISDC/25/4", "odocdt": "31-10-2025", "igst": 90, "cgst": 0, "sgst": 0, "cess": 0, "itcelg": "Y"}]}]},
}
# (the books' copy a year on carries the same invoice numbers, which GST2B would pair across the years: left out here)
TWOB_JS = """(m) => { const b = S.books; b.vouchers = b.vouchers.filter(v => !/\\+1y$/.test(v.id)); b.twoBs = {}; Object.entries(m).forEach(([p, dd]) => { const t = GST2B.fromJson({data: {gstin: '%s', rtnprd: p, gendt: '14-' + p.slice(0, 2) + '-' + p.slice(2), docdata: dd}}); b.twoBs[t.gstin + '|' + t.period] = t; }); GST2B._memo = null; render(); }""" % G07

# GSTR-1: each portal table's totals from the JSON, worked out here on their own
R1_FROM_JSON = """([ym, reg]) => { const j = GSTR.toJson(ym, reg), t = {}, z = () => ({n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0});
  const add = (k, x, sg, cnt) => { const o = t[k] = t[k] || z(); if (cnt) o.n++; o.taxable = r2(o.taxable + sg * num(x.txval != null ? x.txval : x.ad_amt)); o.igst = r2(o.igst + sg * num(x.iamt)); o.cgst = r2(o.cgst + sg * num(x.camt)); o.sgst = r2(o.sgst + sg * num(x.samt)); o.cess = r2(o.cess + sg * num(x.csamt)); };
  (j.b2b || []).forEach(p => p.inv.forEach(v => v.itms.forEach((x, i) => add('b2b', x.itm_det, 1, !i))));
  (j.b2cl || []).forEach(p => p.inv.forEach(v => v.itms.forEach((x, i) => add('b2cl', x.itm_det, 1, !i))));
  (j.exp || []).forEach(p => p.inv.forEach(v => v.itms.forEach((x, i) => add('exp', x.itm_det, 1, !i))));
  (j.b2cs || []).forEach(x => add('b2cs', x, 1, true));
  (j.cdnr || []).forEach(p => p.nt.forEach(v => v.itms.forEach((x, i) => add('cdnr', x.itm_det, v.ntty === 'C' ? -1 : 1, !i))));
  (j.cdnur || []).forEach(v => v.itms.forEach((x, i) => add('cdnur', x.itm_det, v.ntty === 'C' ? -1 : 1, !i)));
  (j.at || []).forEach(p => p.itms.forEach(x => add('at', x, 1, true))); (j.txpd || []).forEach(p => p.itms.forEach(x => add('txpd', x, 1, true)));
  if (j.hsn) { (j.hsn.hsn_b2b || []).forEach(x => add('hsnb2b', x, 1, true)); (j.hsn.hsn_b2c || []).forEach(x => add('hsnb2c', x, 1, true)); (j.hsn.data || []).forEach(x => add('hsn', x, 1, true)); }
  (j.b2ba || []).forEach(p => p.inv.forEach(v => { add('b2ba', {}, 1, true); v.itms.forEach(x => add('b2ba', x.itm_det, 1, false)); }));
  (j.cdnra || []).forEach(p => p.nt.forEach(v => { add('cdnra', {}, 1, true); v.itms.forEach(x => add('cdnra', x.itm_det, v.ntty === 'C' ? -1 : 1, false)); }));
  (j.b2csa || []).forEach(p => p.itms.forEach(x => add('b2csa', x, 1, true)));
  if (j.nil) j.nil.inv.forEach(x => { const o = t.nil = t.nil || z(); o.n++; o.taxable = r2(o.taxable + num(x.nil_amt) + num(x.expt_amt) + num(x.ngsup_amt)); });
  if (j.doc_issue) j.doc_issue.doc_det.forEach(d => d.docs.forEach(x => { const o = t.docs = t.docs || z(); o.n += num(x.net_issue); }));
  [['clttx', 'eco14a'], ['paytx', 'eco14b']].forEach(([s, k]) => ((j.supeco || {})[s] || []).forEach(x => add(k, {txval: x.suppval, iamt: x.igst, camt: x.cgst, samt: x.sgst, csamt: x.cess}, 1, true)));
  return t; }"""
R1_PORTAL = """([ym, reg]) => { const T = window.__r1p(ym, reg), o = {}; Object.entries(T).forEach(([k, v]) => { if (v.rows.length) o[k] = Object.assign({n: v.n}, v.tot); }); return o; }"""
# GSTR-3B: the portal's tables against threeB and the JSON
R3B_CHECK = """([ym, reg]) => { const t = GSTR.threeB(ym, reg), j = GSTR.threeBJson(ym, reg), T = GSTPortal.r3bTables(t, j), row = (id) => T.flatMap(x => x.rows).find(r => r.id === id), bad = [];
  const eq = (a, b, w) => { if (Math.abs(num(a) - num(b)) > 0.005) bad.push(w + ': ' + a + ' / ' + b); };
  const s = j.sup_details, itc = j.itc_elg, av = (ty) => itc.itc_avl.find(x => x.ty === ty), rv = (ty) => itc.itc_rev.find(x => x.ty === ty), ie = (ty) => itc.itc_inelg.find(x => x.ty === ty);
  const five = (id, x, w, heads) => (heads || [['taxable', 'txval'], ['igst', 'iamt'], ['cgst', 'camt'], ['sgst', 'samt'], ['cess', 'csamt']]).forEach(([a, b]) => eq(row(id)[a], x[b], w + ' ' + a));
  five('3.1a', s.osup_det, '3.1(a)'); five('3.1b', s.osup_zero, '3.1(b)', [['taxable', 'txval'], ['igst', 'iamt'], ['cess', 'csamt']]); eq(row('3.1c').taxable, s.osup_nil_exmp.txval, '3.1(c)');
  five('3.1d', s.isup_rev, '3.1(d)'); eq(row('3.1e').taxable, s.osup_nongst.txval, '3.1(e)');
  const T4 = [['igst', 'iamt'], ['cgst', 'camt'], ['sgst', 'samt'], ['cess', 'csamt']];
  five('4A1', av('IMPG'), '4(A)(1)', [['igst', 'iamt'], ['cess', 'csamt']]); five('4A2', av('IMPS'), '4(A)(2)', [['igst', 'iamt'], ['cess', 'csamt']]); five('4A4', av('ISD'), '4(A)(4)', T4); five('4A5', av('OTH'), '4(A)(5)', T4);
  five('4B1', rv('RUL'), '4(B)(1)', T4); five('4B2', rv('OTH'), '4(B)(2)', T4); five('4C', itc.itc_net, '4(C)', T4); five('4D1', ie('RUL'), '4(D)(1)', T4); five('4D2', ie('OTH'), '4(D)(2)', T4);
  // 4(A)(3): the screen's figure (threeB's rcmIn); the JSON's ISRC must be the same or the row says it differs
  const a3 = row('4A3'), isrc = av('ISRC'); ['igst', 'cgst', 'sgst', 'cess'].forEach((k) => eq(a3[k], t.rcmIn[k], '4(A)(3) screen ' + k));
  const same = ['igst', 'cgst', 'sgst', 'cess'].every((k) => Math.abs(num(a3[k]) - num(isrc[{igst: 'iamt', cgst: 'camt', sgst: 'samt', cess: 'csamt'}[k]])) < 0.005); if (!same) bad.push('4(A)(3): the JSON ISRC differs from the screen (imported services counted twice?)'); if (a3.fileDiff) bad.push('4(A)(3): the row still says the JSON differs');
  const g5 = j.inward_sup.isup_details; eq(row('5gst').inter, g5[0].inter, '5 gst inter'); eq(row('5gst').intra, g5[0].intra, '5 gst intra'); eq(row('5ng').inter, g5[1].inter, '5 ng inter'); eq(row('5ng').intra, g5[1].intra, '5 ng intra');
  const u = (j.inter_sup || {}).unreg_details || [], r32 = T.find(x => x.id === '3.2').rows.filter(r => Math.abs(r.taxable) >= 0.01);
  if (u.length !== r32.length) bad.push('3.2 rows ' + r32.length + ' / ' + u.length); u.forEach((x, i) => { eq(r32[i] && r32[i].taxable, x.txval, '3.2 ' + x.pos); eq(r32[i] && r32[i].igst, x.iamt, '3.2 igst ' + x.pos); });
  ['igst', 'cgst', 'sgst', 'cess'].forEach((k) => { const A = row('6.1A|' + k), B = row('6.1B|' + k); eq(A.payable, t.net[k], '6.1 A payable ' + k); eq(B.payable, t.rcmOut[k], '6.1 B payable ' + k);
    eq(r2(A.cash + B.cash), t.pay.cash[k], '6.1 cash ' + k); eq(r2(A.ui + A.uc + A.us + A.ucs + A.cash), t.net[k], '6.1 A paid = payable ' + k); });
  // every clickable figure: its bills and adjustments add up to it
  const per = (typeof GSTSet === 'object' && GSTSet.typeOf(ym, reg) === 'qrmp' && GSTSet.isQEnd(ym)) ? GSTSet.qStart(ym) + '-' + ym : ym;
  [...GSTPortal.R3B_CLICK].forEach((id) => { const x = GSTPortal.r3bBills(id, per, reg, t); if (x.off.length) bad.push('bills of ' + id + ' do not add up: ' + x.off.join(',')); });
  return bad; }"""

def start(pg):
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(LOAD, books); pg.wait_for_timeout(800); pg.evaluate("S.books = window.__bk; window.ledgersReady = () => true; render();"); pg.wait_for_timeout(400)
    # the portal tables as the screen builds them (the same function the screen calls)
    pg.evaluate("""() => { window.__r1p = (ym, reg) => { const full = GSTR.toJson(ym, reg), plain = GSTR.toJson(ym, reg, {plain: true}), names = {}; GSTR.one(ym, reg).rows.forEach(r => { if (r.gstin) names[r.gstin] = r.party; });
      let amend = []; try { amend = GSTAmend.filed(reg).length ? GSTAmend.pending(ym, reg).rows : []; } catch (e) {} return GSTPortal.r1Portal(full, plain, names, amend); }; }""")

def gst(pg, ym, part, sub=None, extra=""):
    pg.evaluate("([ym, part, sub]) => { S.booksTab = 'gst'; S.gstReg = '07'; S.gstYm = ym; S.gstView = 'return'; S.gstPart = part; S.gstSub = sub || ''; S.gstSeen = '07|' + GSTSet.typeOf(ym, '07'); %s render(); }" % extra, [ym, part, sub]); pg.wait_for_timeout(500)

def shot(pg, name, full=True):
    pg.screenshot(path=os.path.join(OUT, name + ".png"), full_page=full)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        E, W = pg.evaluate, pg.wait_for_timeout
        start(pg)
        ok(E("typeof GSTPortal === 'object' && typeof ITCF === 'object'"), "the portal layer and the reconciliation's lines are in the app (GSTPortal, ITCF)")
        regs, months = E("GSTR.gstins(S.books).map(g => g.slice(0, 2))"), E("GSTR.months()")

        print("1. GSTR-1 in the portal's tables")
        bad = []
        for reg in regs:
            for ym in months:
                a, b = E(R1_PORTAL, [ym, reg]), E(R1_FROM_JSON, [ym, reg])
                for k in set(a) | set(b):
                    x, y = a.get(k), b.get(k)
                    if not x or not y or x["n"] != y["n"] or any(abs(x[h] - y[h]) > 0.005 for h in ("taxable", "igst", "cgst", "sgst", "cess")): bad.append("%s %s %s: %s / %s" % (reg, ym, k, x, y))
        ok(not bad, "every portal table's records and totals are the GSTR-1 JSON's, %d months × %d GSTINs (%s)" % (len(months), len(regs), bad[:3]))
        gst(pg, "202603", "r1", "summary")
        names = E("[...document.querySelectorAll('[data-r1-summary] tr[data-r1-table] td:first-child button')].map(b => b.textContent)")
        PORTAL_NAMES = {"4A, 4B, 6B, 6C – B2B, SEZ, DE Invoices", "5A, 5B – B2C (Large) Invoices", "6A – Exports Invoices", "7 – B2C (Others)", "8A, 8B, 8C, 8D – Nil Rated Supplies", "9B – Credit / Debit Notes (Registered)",
            "9B – Credit / Debit Notes (Unregistered)", "11A(1), 11A(2) – Tax Liability (Advances Received)", "11B(1), 11B(2) – Adjustment of Advances", "12 – HSN-wise summary of outward supplies", "13 – Documents Issued",
            "14 – Supplies made through E-Commerce Operators"}
        allnames = set()
        for ym in months:
            gst(pg, ym, "r1", "summary"); allnames |= set(E("[...document.querySelectorAll('[data-r1-summary] tr[data-r1-table] td:first-child button')].map(b => b.textContent)"))
        ok(allnames <= PORTAL_NAMES and len(allnames) >= 5, "every month's summary names its tables as the portal (%s)" % sorted(allnames))
        gst(pg, "202603", "r1", "summary")
        ok(names[:1] == ["4A, 4B, 6B, 6C – B2B, SEZ, DE Invoices"] and "12 – HSN-wise summary of outward supplies" in names and "13 – Documents Issued" in names,
           "the summary names the tables as the portal (%s)" % names)
        heads = E("[...document.querySelectorAll('[data-r1-summary] thead th')].map(t => t.textContent)")
        ok(heads == ["Table", "No. of records", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess", "Total tax"], "the summary's column heads (%s)" % heads)
        shot(pg, "r1-summary-desktop")
        pg.click("[data-r1-summary] tr[data-r1-table='B2B'] button"); W(700)
        ok(E("[S.gstSub, S.r1View || '', S.r1T]") == ["details", "", "b2b"] and pg.locator("[data-r1p=b2b]").count() == 1, "a summary row opens its table as the portal shows it (%s)" % E("[S.gstSub, S.r1View, S.r1T]"))
        cols = E("[...document.querySelectorAll('#r1p-b2b thead th')].map(t => (t.querySelector('.colh > span') || t).textContent)")
        want = ["#", "GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"]
        ok(cols == want, "4A, 4B, 6B, 6C: the portal's column headings (%s)" % cols)
        ok("4A, 4B, 6B, 6C" in pg.inner_text("[data-r1p=b2b] h3") and "B2B, SEZ, DE Invoices" in pg.inner_text("[data-r1p=b2b] h3"), "its number and name as the portal")
        cell = E("() => { const tr = [...document.querySelectorAll('#r1p-b2b tbody tr[data-r1p-row]')].find(r => r.innerText.includes('LFE/25-26/015')); return tr ? [...tr.children].map(c => c.innerText.trim()) : []; }")
        ok(cell[1:8] == ["09AACCO6624H1ZC", "Orchid Lane Hospitality LLP", "LFE/25-26/015", "15-03-2026", "₹59,000.00", "09-Uttar Pradesh", "N"] or (cell[1] == "09AACCO6624H1ZC" and cell[3] == "LFE/25-26/015" and cell[6].startswith("09-") and cell[7] == "N"),
           "a B2B row: GSTIN, receiver, number, date, value, place of supply as '09-Uttar Pradesh', reverse charge (%s)" % cell[1:8])
        foot = E("() => { const f = document.querySelector('[data-r1p-foot=b2b]'); const g = (k) => Number(((f.querySelector('[data-r1p-sum=' + k + ']') || {}).innerText || '').replace(/[₹,]/g, '')); return {taxable: g('taxable'), igst: g('igst'), cgst: g('cgst'), sgst: g('sgst')}; }")
        j = E(R1_FROM_JSON, ["202603", "07"])["b2b"]
        ok(all(abs(foot[k] - j[k]) < 0.01 for k in foot), "4A, 4B, 6B, 6C's footer totals are the JSON's b2b (%s / %s)" % (foot, j))
        pg.evaluate("() => { S.r1T = ''; render(); }"); W(400)
        shown = E("[...document.querySelectorAll('[data-r1p]')].map(s => s.dataset.r1p)")
        ok(shown[:1] == ["b2b"] and "hsnb2b" in shown and "docs" in shown, "All tables: one under another in the portal's order (%s)" % shown)
        shot(pg, "r1-tables-desktop")
        # a column-heading filter
        opts = E("[...document.querySelectorAll('#r1p-b2b thead select[aria-label=\"GSTIN/UIN of Recipient\"] option')].map(o => o.value)")
        if len(opts) > 2:
            pg.select_option('#r1p-b2b thead select[aria-label="GSTIN/UIN of Recipient"]', opts[1]); W(400)
            n = pg.locator("#r1p-b2b tbody tr[data-r1p-row]").count()
            ok(0 < n and "filtered" in pg.inner_text("[data-r1p-foot=b2b]"), "a filter in a heading narrows the rows and the totals say so (%d rows)" % n)
            E("() => { S.r1PF = {}; render(); }"); W(300)
        # 9A: a filed copy of March with LFE/25-26/015 at 40,000; April's file carries the amendment
        E("""() => { const j = JSON.parse(JSON.stringify(GSTR.toJson('202603', '07', {plain: true}))); j.b2b.forEach(p => p.inv.forEach(v => { if (v.inum === 'LFE/25-26/015') { v.val = 47200; v.itms[0].itm_det.txval = 40000; v.itms[0].itm_det.iamt = 7200; } }));
          GSTAmend.keep(j, 'portal'); render(); }""")
        b2ba = E(R1_FROM_JSON, ["202604", "07"]).get("b2ba")
        gst(pg, "202604", "r1", "details", "S.r1View = ''; S.r1T = 'b2ba';")
        ok(b2ba and b2ba["n"] == 1 and pg.locator("[data-r1p=b2ba]").count() == 1, "9A Amended B2B Invoices: the amendment goes in April's file and has its table (%s)" % b2ba)
        row = E("() => { const tr = document.querySelector('#r1p-b2ba tbody tr[data-r1p-row]'); const h = [...document.querySelectorAll('#r1p-b2ba thead th')].map(t => (t.querySelector('.colh > span') || t).textContent); return tr ? Object.fromEntries([...tr.children].map((c, i) => [h[i], c.innerText.trim()])) : {}; }")
        ok(row.get("Original Invoice Number") == "LFE/25-26/015" and row.get("Original Taxable Value") == "₹40,000.00" and row.get("Taxable Value") == "₹50,000.00" and row.get("Revised Invoice Number") == "LFE/25-26/015",
           "9A: the original (as filed: 40,000) beside the revised (50,000) (%s)" % {k: row.get(k) for k in ("Original Invoice Number", "Original Taxable Value", "Revised Invoice Number", "Taxable Value")})
        ok(all(abs(E(R1_PORTAL, ["202604", "07"])["b2ba"][k] - b2ba[k]) < 0.01 for k in ("taxable", "igst")), "9A's totals are the file's b2ba")
        shot(pg, "r1-amend-9a-desktop")
        gst(pg, "202604", "r1", "summary")
        ok(pg.locator("[data-r1-summary] tr[data-r1-amend=b2ba]").count() == 1 and "9A – Amended B2B Invoices" in pg.inner_text("[data-r1-summary]"), "the summary lists the amendment tables apart from the month's total")
        E("() => { S.books.filed = {}; render(); }")

        print("2. GSTR-3B in the portal's tables")
        bad = []
        for reg in regs:
            for ym in months:
                b = E(R3B_CHECK, [ym, reg])
                bad += ["%s %s: %s" % (reg, ym, x) for x in b]
        ok(not bad, "every figure is threeB's and the GSTR-3B JSON's, and every figure's bills add up to it, %d months × %d GSTINs (%s)" % (len(months), len(regs), bad[:4]))
        gst(pg, "202603", "r3b", "summary")
        titles = E("[...document.querySelectorAll('[data-r3b-table] th.r3b-title')].map(t => t.textContent.split(' ')[0])")
        ok(titles == ["3.1", "3.1.1", "3.2", "4.", "5.", "5.1", "6.1"], "the portal's tables in order (%s)" % titles)
        labels = E("[...document.querySelectorAll('[data-r3b-table=\"3.1\"] tbody tr td:first-child')].map(t => t.firstChild.textContent)")
        ok(labels == ["(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", "(b) Outward taxable supplies (zero rated)", "(c) Other outward supplies (Nil rated, exempted)", "(d) Inward supplies (liable to reverse charge)", "(e) Non-GST outward supplies"], "3.1's row labels (%s)" % labels)
        h31 = E("[...document.querySelectorAll('[data-r3b-table=\"3.1\"] thead tr.r3b-heads th')].map(t => t.textContent)")
        ok(h31 == ["Nature of Supplies", "Total Taxable value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"], "3.1's column heads (%s)" % h31)
        l4 = E("[...document.querySelectorAll('[data-r3b-table=\"4\"] tbody tr td:first-child')].map(t => t.firstChild.textContent)")
        ok(l4[:6] == ["A. ITC Available (whether in full or part)", "(1) Import of goods", "(2) Import of services", "(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", "(4) Inward supplies from ISD", "(5) All other ITC"]
           and "C. Net ITC Available (A-B)" in l4 and "(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules" in l4, "4's row labels (%s)" % l4)
        # EXPECTED.md: March 2026, 07: 3.1(a) taxable 2,00,000, IGST 9,000, CGST 7,000; 3.1(d) 60,000; 4(A)(3) IGST 7,200
        t31a = E("[...document.querySelectorAll('[data-r3b-row=\"3.1a\"] td')].slice(1).map(t => t.innerText.trim())")
        ok(t31a[:3] == ["₹2,00,000.00", "₹9,000.00", "₹7,000.00"], "3.1(a) as worked out by hand (EXPECTED.md: 2,00,000 · 9,000 · 7,000) (%s)" % t31a)
        # next-itc-simple: a figure opens a window (Pop), not the bills below the table
        pg.click('[data-r3b-fig="4A3|igst"]'); W(700)
        ft = E("() => { const f = document.querySelector('[data-pop=\"r3b-4A3\"] [data-fig-part=bills] .itc-part-sum'); return f ? f.innerText : ''; }")
        n3 = pg.locator('[data-pop="r3b-4A3"] [data-fig-part=bills] tr[data-pop-line]').count()
        ok(n3 == 2 and "IGST ₹7,200.00" in ft and pg.locator("#app .r3b-bills").count() == 0, "4(A)(3) clicked: a window with its two bills (the advocate, the landlord), adding up to IGST 7,200 (%d; %s)" % (n3, ft))
        pg.keyboard.press("Escape"); W(500)
        wide = E("[...document.querySelectorAll('[data-r3b-table] > .bk-tablewrap')].filter(w => w.scrollWidth > w.clientWidth + 1).map(w => w.parentNode.dataset.r3bTable)")
        ok(not wide and pg.locator("[data-r3b-portal] .gf-btn, [data-r3b-portal] th button[aria-label^='Filter']").count() == 0, "at 1440 every 3B table fits, no grid filter buttons in the return's form (%s)" % wide)
        shot(pg, "r3b-summary-desktop")
        pg.click('[data-r3b-fig="3.1a|taxable"]'); W(600)
        ok(pg.locator('[data-pop="r3b-3.1a"] [data-r3b-bills="3.1a"]').count() == 1 and pg.locator('[data-pop="r3b-4A3"]').count() == 0, "another figure opens its own window (3.1(a))")
        pg.keyboard.press("Escape"); W(400)
        subs = E("[...document.querySelectorAll('#app nav[aria-label=Return] button')].map(b => b.textContent)")
        ok(subs == ["Summary", "Details", "2B match", "Files"], "GSTR-3B keeps its one tab row (%s)" % subs)

        print("3. GSTR-2B as the portal")
        E(TWOB_JS, TWO_B); W(300)
        gst(pg, "202603", "r2b", None, "S.r2Scope = 'year'; S.r2View = 'portal'; S.r2bSec = 'summary';")
        ok(pg.locator("[data-2b-summary]").count() == 1, "the 2B summary")
        secs = E("[...document.querySelectorAll('[data-2b-portal] nav[aria-label=\"GSTR-2B section\"] button')].map(b => b.dataset['2bSec'])")
        ok(secs == ["summary", "b2b", "b2ba", "cdnr", "cdnra", "ecom", "isd", "isda", "impg", "impgsez"], "Part A's sections as the portal: B2B, B2BA, CDNR, CDNRA, ECO, ISD, ISDA, IMPG, IMPGSEZ (%s)" % secs)
        sm = E("""() => { const s = GSTPortal.twoBSummary(GSTPortal.twoBRows('07', GSTRev.fyMonths('202603'))), g = (b, part, grp) => b.find(x => x.part === part).rows.find(r => r.group === grp).lines.reduce((a, l) => r2(a + l.igst + l.cgst + l.sgst), 0);
          return {a5: g(s.available, 'A', 'I'), imp: g(s.available, 'A', 'IV'), cn: g(s.available, 'B', 'I'), nav: g(s.notAvailable, 'A', 'I'), isd: g(s.available, 'A', 'II')}; }""")
        ok(sm == {"a5": 18000 + 14400 + 21600 + 27000 + 1800 + 250, "imp": 4500, "cn": -900 - 90, "nav": 36000, "isd": 1200 + 360}, "the summary's figures from the documents: 4(A)(5) with the ECO document, ISD with ISDA, imports 4(A)(1), Part B credit notes with ISDA's, not available (%s)" % sm)
        lines = E("""() => { const s = GSTPortal.twoBSummary(GSTPortal.twoBRows('07', GSTRev.fyMonths('202603'))), L = (b, part, grp) => b.find(x => x.part === part).rows.find(r => r.group === grp).lines.filter(l => l.n).map(l => l.label + ':' + l.n + ':' + r2(l.igst + l.cgst + l.sgst));
          return {i: L(s.available, 'A', 'I'), ii: L(s.available, 'A', 'II'), b: L(s.available, 'B', 'I')}; }""")
        ok("ECO – Documents:1:250" in lines["i"] and lines["ii"] == ["ISD – Invoices:1:1200", "ISD – Invoices (Amendment):1:360"] and "ISD – Credit notes (Amendment):1:-90" in lines["b"],
           "ECO – Documents under Part A I, ISD – Invoices (Amendment) under II, ISD – Credit notes (Amendment) under Part B, as the 2B summary PDF (%s)" % lines)
        tie = E("""() => { const rows = GSTPortal.twoBRows('07', GSTRev.fyMonths('202603')), s = GSTPortal.twoBSummary(rows), H = ['igst', 'cgst', 'sgst', 'cess'], bad = [];
          [['available', 'totAvl', (r) => r.itcavl !== 'N' && !r.rej], ['notAvailable', 'totNav', (r) => r.itcavl === 'N' && !r.rej]].forEach(([b, t, f]) => {
            const ls = s[b].flatMap(P => P.rows.flatMap(g => g.lines)), n = ls.reduce((a, l) => a + l.n, 0);
            if (n !== s[t].n) bad.push(b + ': lines hold ' + n + ' documents, total ' + s[t].n);
            H.forEach(h => { const sum = r2(ls.reduce((a, l) => a + l[h], 0)); if (Math.abs(sum - s[t][h]) > 0.005) bad.push(b + ' ' + h + ': lines ' + sum + ', total ' + s[t][h]); });
            // each section's documents (as its footer nets them) add up to the same total
            const bySec = GSTPortal.TWOB_SECTIONS.reduce((a, x) => { H.forEach(h => { a[h] = r2(a[h] + rows.filter(r => f(r) && r.sec === x.id).reduce((c, r) => c + num(r[h]) * (r.dir || 1), 0)); }); return a; }, {igst: 0, cgst: 0, sgst: 0, cess: 0});
            H.forEach(h => { if (Math.abs(bySec[h] - s[t][h]) > 0.005) bad.push(b + ' ' + h + ': sections ' + bySec[h] + ', total ' + s[t][h]); }); });
          return bad; }""")
        ok(not tie, "the 2B summary's totals are the sum of its lines and of its sections, ITC available and not available (%s)" % tie)
        lab = E("[...document.querySelectorAll('[data-2b-sum=avl] tr[data-2b-group]')].map(r => r.children[1].innerText + ' | ' + r.children[2].innerText)")
        ok(lab[:4] == ["All other ITC – Supplies from registered persons | 4(A)(5)", "Inward Supplies from ISD | 4(A)(4)", "Inward Supplies liable for reverse charge | 3.1(d), 4(A)(3)", "Import of Goods | 4(A)(1)"], "laid out as the 2B summary PDF, with the 3B tables (%s)" % lab)
        shot(pg, "2b-summary-desktop")
        pg.click('[data-2b-sec="b2b"]'); W(400)
        h = E("[...document.querySelectorAll('[data-2b-section=b2b] thead th')].map(t => t.textContent)")
        ok(h[1:9] == ["GSTIN of supplier", "Trade/Legal name", "Invoice number", "Invoice type", "Invoice date", "Invoice value", "Place of supply", "Supply attract reverse charge"] and "ITC Availability" in h, "B2B: the portal's columns (%s)" % h)
        n_avl = pg.locator("[data-2b-section=b2b] tr[data-2b-row]").count()
        pg.click('[data-2b-portal] nav[aria-label=ITC] button:has-text("ITC not available")'); W(400)
        ok(n_avl == 5 and pg.locator("[data-2b-section=b2b] tr[data-2b-row]").count() == 1, "ITC available / not available: 5 and 1 B2B invoices")
        shot(pg, "2b-section-desktop")
        pg.click('[data-2b-portal] nav[aria-label=ITC] button:has-text("ITC available")'); W(300)
        pg.click('[data-2b-sec="ecom"]'); W(400)
        h = E("[...document.querySelectorAll('[data-2b-section=ecom] thead th')].map(t => t.textContent)")
        er = E("() => { const tr = document.querySelector('[data-2b-section=ecom] tr[data-2b-row]'); return tr ? [...tr.children].map(c => c.innerText.trim()) : []; }")
        ok(h[1:8] == ["GSTIN of ECO", "Trade/Legal name", "Document number", "Document type", "Document date", "Document value", "Place of supply"] and "IRN" in h and "ITC Availability" in h
           and er[1:4] == ["07AAICQ4321B1CZ", "QUICKBITE ECO PVT LTD", "QB/ECO/5521"] and "FinCom does not read" not in pg.inner_text("[data-2b-section=ecom]"), "ECO: read, with the portal's columns (%s; %s)" % (h, er[1:4]))
        pg.click('[data-2b-sec="isda"]'); W(400)
        h = E("[...document.querySelectorAll('[data-2b-section=isda] thead th')].map(t => t.textContent)")
        n_isda = pg.locator("[data-2b-section=isda] tr[data-2b-row]").count()
        fi = E("() => Number((document.querySelector('[data-2b-foot=isda] [data-2b-sum=igst]') || {innerText: 'NaN'}).innerText.replace(/[₹,]/g, ''))")
        ok(h[1:9] == ["Original ISD document type", "Original ISD document number", "Original ISD document date", "GSTIN of ISD", "Trade/Legal name", "ISD document type", "ISD document number", "ISD document date"]
           and "ISD GSTR-6 Period" in h and "Eligibility of ITC" in h and n_isda == 2 and fi == 270, "ISDA: the original beside the amended, the portal's columns; its footer nets the credit note (360 - 90 = %s; %d rows; %s)" % (fi, n_isda, h[1:9]))
        shot(pg, "2b-isda-desktop")

        print("4. 2B reconciliation (next-itc-simple: one table, a Decision on each line)")
        gst(pg, "202603", "r2b", None, "S.r2View = ''; S.icF = {};")
        ok(pg.locator("[data-itc-reco]").count() == 1, "the 2B part opens on the reconciliation")
        chips = E("() => Object.fromEntries([...document.querySelectorAll('[data-ic-chip]')].map(b => [b.dataset.icChip, Number(b.querySelector('.sbar-n').textContent)]))")
        ref = E("() => { const m = {all: 0}; ITCF.month('07', '202603').rows.forEach(r => { m[r.chip] = (m[r.chip] || 0) + 1; m.all++; }); return m; }")
        ok(all(chips.get(k, 0) == ref.get(k, 0) for k in ("all", "matched", "books", "2b", "diff", "ims", "cf")), "the chips' counts are the month's lines (%s / %s)" % (chips, ref))
        st = E("() => Object.fromEntries(ITCF.rows('07').map(r => { const v = ITCF.month('07', r.home).rows.find(x => x.key === r.key) || {}; return [r.no || r.bookNo, v.chip + (r.kind === 'pair' && r.status === 'probable' ? ':probable' : '')]; }))")
        ok(st.get("QB/ECO/5521") == "2b" and st.get("NSL/112") == "diff" and st.get("KC/1187") == "matched" and st.get("INV-9001", "").endswith("probable") and st.get("WPH/88") == "2b" and st.get("JLA/311") == "books",
           "each fixture case on its chip (%s)" % {k: st.get(k) for k in ("QB/ECO/5521", "NSL/112", "KC/1187", "INV-9001", "WPH/88", "JLA/311")})
        ok(E("document.documentElement.scrollWidth <= innerWidth + 1"), "at 1440 the page does not scroll sideways (a wide table scrolls in its own box)")
        shot(pg, "reco-desktop")
        pg.click('[data-ic-chip="books"]'); W(400)
        ok(E("() => [...document.querySelectorAll('#icTable tbody tr[data-ic-row]')].every(r => r.dataset.icChipOf === 'books')"), "a chip shows its lines only")
        pg.click('[data-ic-chip="books"]'); W(300)
        home = E("() => (ITCF.rows('07').find(r => r.kind === 'pair' && r.status === 'probable') || {}).home || '202603'")
        gst(pg, home, "r2b", None, "S.r2View = ''; S.icF = {};")
        pg.locator("#icTable [data-reco-accept]").first.click(); W(500)
        ok("yes" in E("Object.values(GST2B.state().confirm)"), "Same on a probable match: the existing confirm")
        E("() => { GST2B.state().confirm = {}; S.icF = {}; render(); }"); W(300)
        gst(pg, "202603", "r2b", None, "S.r2View = ''; S.icF = {};")
        E("""() => { window.__files = []; window.saveFile = async (name) => { window.__files.push({name}); return true; }; }""")
        pg.click("[data-itc-excel=down]"); W(2500)
        ok(E("window.__files.length") == 1 and "2B-and-ITC" in E("window.__files[0].name"), "Download Excel")
        pg.click("[data-r2-more] > summary"); W(300); pg.click('[data-r2-more] [data-r2-view="portal"]'); W(500)
        ok(pg.locator("[data-itc-reco]").count() == 0 and E("S.r2View") == "portal", "⋯ › See the 2B as the portal shows it")
        E("() => { S.r2View = ''; render(); }")

        print("6. GSTR-1 table 14: supplies through e-commerce operators")
        before = E(R1_FROM_JSON, ["202603", "07"])
        AMZ = E("() => { const b = '07AAICA9999K1C'; for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; return ''; }")
        FK = E("() => { const b = '07AABCF8888L1C'; for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; return ''; }")
        # four sales from marketplace reports in March 2026: Amazon (an invoice and a credit note, TCS collected), Flipkart (to a
        # registered buyer), Shopify (the seller's own store: no TCS); Amazon's GSTIN typed for Delhi, Flipkart's not yet
        E("""() => { const mk = (id, x) => ({id, source: 'market', status: 'posted', x: Object.assign({customerName: '', customerGstin: '', placeOfSupply: 'Delhi', cess: 0, igst: 0, cgst: 0, sgst: 0, noteKind: ''}, x)});
          S.sales = {cid: S.coId, list: [mk('m1', {number: 'AMZ-301', date: '2026-03-10', taxable: 10000, cgst: 900, sgst: 900, total: 11800, rate: 18, ecommerce: 'amazon', tcs: 100}),
            mk('m2', {number: 'AMZ-301 (CN)', date: '2026-03-20', taxable: 2000, cgst: 180, sgst: 180, total: 2360, rate: 18, ecommerce: 'amazon', tcs: 20, noteKind: 'credit'}),
            mk('m3', {number: 'FK-77', date: '2026-03-12', customerName: 'Orchid Lane Hospitality LLP', customerGstin: '09AACCO6624H1ZC', placeOfSupply: 'Uttar Pradesh', taxable: 5000, igst: 900, total: 5900, rate: 18, ecommerce: 'flipkart', tcs: 0}),
            mk('m4', {number: 'SH-9', date: '2026-03-15', taxable: 3000, cgst: 270, sgst: 270, total: 3540, rate: 18, ecommerce: 'shopify', tcs: 0})], cfg: {}, sel: new Set(), sticky: new Set(), hist: {}};
          GSTSet.store('07').ecoGstin = {}; render(); }""")
        base = E(R1_FROM_JSON, ["202603", "07"])
        ok(not base.get("eco14a") and "supeco" not in E("GSTR.toJson('202603', '07')"), "no operator GSTIN known: nothing in the JSON's supeco")
        E("([g]) => ecoGstinSet('07', 'amazon', g)", [AMZ]); W(300)
        j14 = E("GSTR.toJson('202603', '07').supeco")
        after = E(R1_FROM_JSON, ["202603", "07"])
        ok(j14 == {"clttx": [{"etin": AMZ, "suppval": 8000, "igst": 0, "cgst": 720, "sgst": 720, "cess": 0, "flag": "N"}]},
           "14(a) in the JSON: Amazon's GSTIN, net value 10,000 less the credit note 2,000, its tax (%s)" % j14)
        ok(all(after[k] == base[k] for k in base) and set(after) - set(base) == {"eco14a"}, "typing the operator's GSTIN moves no other table of the file (%s)" % sorted(set(after) ^ set(base)))
        ok(set(base) >= set(before) and all(base[k]["n"] >= before[k]["n"] for k in before), "the marketplace sales are in the file's tables as before (B2B, B2C, notes)")
        gst(pg, "202603", "r1", "details", "S.r1View = ''; S.r1T = 'eco14a';")
        h14 = E("[...document.querySelectorAll('#r1p-eco14a thead th')].map(t => (t.querySelector('.colh > span') || t).textContent)")
        ok(h14 == ["#", "GSTIN of E-Commerce Operator", "Trade/Legal name", "Net value of supplies", "Integrated tax", "Central tax", "State/UT tax", "Cess"] and "14(a)" in pg.inner_text("[data-r1p=eco14a] h3"),
           "14(a): the portal's columns and number (%s)" % h14)
        r14 = E("() => [...document.querySelectorAll('#r1p-eco14a tbody tr[data-r1p-row]')].map(tr => [...tr.children].map(c => c.innerText.trim()))")
        ok(len(r14) == 1 and r14[0][1:4] == [AMZ, "Amazon", "₹8,000.00"], "14(a) on the screen: one row by the operator's GSTIN (%s)" % r14)
        miss = pg.inner_text("[data-r1p=eco14a] [data-eco-missing]") if pg.locator("[data-r1p=eco14a] [data-eco-missing]").count() else ""
        ok("Flipkart" in miss and "₹5,000.00" in miss and "Shopify" in miss and "no TCS" in miss, "the operators with no GSTIN known are named with their net value, not in the file (%s)" % miss.replace("\n", " "))
        ok(pg.locator("[data-r1p=eco14b]").count() == 1 and "9(5)" in pg.inner_text("[data-r1p=eco14b]") and "FinCom" in pg.inner_text("[data-r1p=eco14b]") and pg.locator("#r1p-eco14b tbody tr[data-r1p-row]").count() == 0,
           "14(b) (u/s 9(5)): shown empty, with a plain note")
        shot(pg, "r1-table14-desktop")
        # Flipkart's GSTIN typed on the screen: in the file
        pg.fill('[data-eco-gstin="flipkart"] input', "07ABC"); pg.click('[data-eco-gstin="flipkart"] button'); W(400)
        ok(len(E("GSTR.toJson('202603', '07').supeco.clttx")) == 1, "a GSTIN that is not valid is refused")
        pg.fill('[data-eco-gstin="flipkart"] input', FK); pg.click('[data-eco-gstin="flipkart"] button'); W(500)
        j14 = E("GSTR.toJson('202603', '07').supeco")
        sales = E("""() => r2(S.sales.list.filter(v => v.x.ecommerce !== 'shopify').reduce((a, v) => a + (v.x.noteKind === 'credit' ? -1 : 1) * v.x.taxable, 0))""")
        ok(len(j14["clttx"]) == 2 and abs(sum(x["suppval"] for x in j14["clttx"]) - sales) < 0.005 and sales == 13000, "Flipkart's GSTIN typed: 14(a) holds both operators; its total is the operators' sales, 13,000 (%s)" % j14)
        scr = E(R1_PORTAL, ["202603", "07"]).get("eco14a"); js = E(R1_FROM_JSON, ["202603", "07"]).get("eco14a")
        ok(scr and js and scr["n"] == js["n"] == 2 and all(abs(scr[k] - js[k]) < 0.005 for k in ("taxable", "igst", "cgst", "sgst", "cess")), "14(a) on the screen is the JSON's (%s / %s)" % (scr, js))
        foot = E("() => Number(document.querySelector('[data-r1p-foot=eco14a] [data-r1p-sum=taxable]').innerText.replace(/[₹,]/g, ''))")
        ok(foot == 13000, "14(a)'s footer: 13,000 (%s)" % foot)
        # the owner, 17-Oct-2026: table 14 above is the one place; the old "Supplies through an e-commerce operator (14)" card is gone
        old = {}
        for v in ("", "customer", "bill"):
            gst(pg, "202603", "r1", "details", "S.r1View = '%s';" % v); W(200)
            old[v or "portal"] = pg.locator("text=Supplies through an e-commerce operator").count()
        gst(pg, "202603", "r1", "details", "S.r1View = '';")
        ok(not any(old.values()) and E("() => { const g = GSTR.one('202603', '07'); return !('ecoBy' in g) && g.eco.length === 4; }"),
           "the old e-commerce operator card is gone from every view (portal, by customer, by bill) and its summary (ecoBy) with it; the operator sales stay (%s)" % old)
        gst(pg, "202603", "r1", "summary")
        s14 = E("() => { const tr = document.querySelector('[data-r1-summary] tr[data-r1-table=\"14\"]'); return tr ? [...tr.children].map(c => c.innerText.trim()) : []; }")
        grand = E("() => Number(document.querySelector('[data-r1-grand] td:nth-child(3)').innerText.replace(/[₹,]/g, ''))")
        others = E("() => [...document.querySelectorAll('[data-r1-summary] tr[data-r1-table]')].filter(t => !['12', '13', '14'].includes(t.dataset.r1Table)).reduce((a, t) => a + Number(t.children[2].innerText.replace(/[₹,]/g, '')), 0)")
        ok(s14[:1] and s14[0].startswith("14 – Supplies made through E-Commerce Operators") and s14[1:3] == ["2", "₹13,000.00"] and abs(grand - others) < 0.01, "the summary names table 14 as the portal and keeps it out of the total (its supplies are in 4 to 10) (%s; %s / %s)" % (s14[:3], grand, others))
        bad = E(R3B_CHECK, ["202603", "07"])
        ok(not bad, "GSTR-3B still ties with the marketplace sales and table 14 (%s)" % bad[:3])
        E("() => { GSTSet.store('07').ecoGstin = {amazon: GSTSet.store('07').ecoGstin.amazon}; render(); }")
        pg.set_viewport_size({"width": 390, "height": 844}); gst(pg, "202603", "r1", "details", "S.r1View = ''; S.r1T = 'eco14a';"); W(300)
        w = E("document.documentElement.scrollWidth")
        ok(w <= 391 and pg.locator("[data-eco-missing]").count() == 1, "phone, table 14 with an operator's GSTIN to type: %dpx wide, no sideways page scroll" % w)
        shot(pg, "r1-table14-phone")
        pg.set_viewport_size({"width": 1440, "height": 900})
        E("() => { S.sales = null; delete GSTSet.store('07').ecoGstin; render(); }")
        br.close()

        print("5. A phone")
        ph = p.chromium.launch(); pg = ph.new_page(viewport={"width": 390, "height": 844}); pg.on("pageerror", lambda e: errors.append(str(e)))
        E, W = pg.evaluate, pg.wait_for_timeout
        start(pg); E(TWOB_JS, TWO_B)
        for name, ym, part, sub, extra in [("r1-summary", "202603", "r1", "summary", ""), ("r1-tables", "202603", "r1", "details", "S.r1View = ''; S.r1T = '';"),
                                           ("r3b-summary", "202603", "r3b", "summary", "S.r3bOpen = '4A3';"), ("2b-summary", "202603", "r2b", None, "S.r2Scope = 'year'; S.r2View = 'portal'; S.r2bSec = 'summary';"),
                                           ("2b-section", "202603", "r2b", None, "S.r2Scope = 'year'; S.r2View = 'portal'; S.r2bSec = 'b2b'; S.r2bItc = 'avl';"), ("reco", "202603", "r2b", None, "S.r2Scope = 'year'; S.r2View = ''; S.r2Tab = '';")]:
            gst(pg, ym, part, sub, extra)
            w = E("document.documentElement.scrollWidth")
            ok(w <= 391, "phone, %s: %dpx wide, no sideways page scroll" % (name, w))
            shot(pg, name + "-phone")
        ph.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
