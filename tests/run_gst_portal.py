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
  4. 2B reconciliation: one row per supplier invoice, the statuses (Matched, Mismatch, Probable match, In books only, In 2B
     only) as GST2B's matching says, the chips' counts, ITC as per books / as per 2B / difference equal to the figures the
     2B page showed before (the workbench's tiles), the differing field highlighted, the actions, the Excel's formulas,
     and the automatic matcher's hook (statuses "matched-rules", "matched-ai", "probable") without moving an amount;
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
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
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
        ok(E("typeof GSTPortal === 'object' && typeof GSTReco === 'object'"), "the portal layer and the reconciliation's rows are in the app (GSTPortal, GSTReco)")
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
            "9B – Credit / Debit Notes (Unregistered)", "11A(1), 11A(2) – Tax Liability (Advances Received)", "11B(1), 11B(2) – Adjustment of Advances", "12 – HSN-wise summary of outward supplies", "13 – Documents Issued"}
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
        pg.click('[data-r3b-fig="4A3|igst"]'); W(500)
        ft = E("() => { const f = document.querySelector('[data-r3b-bills=\"4A3\"] [data-r3b-bills-foot]'); return f ? f.innerText : ''; }")
        n3 = pg.locator('[data-r3b-bills="4A3"] tr[data-r3b-bill]').count()
        ok(n3 == 2 and "₹7,200.00" in ft and "the figure in the return" in ft, "4(A)(3) clicked: its two bills (the advocate, the landlord), adding up to IGST 7,200 (%d; %s)" % (n3, ft.replace("\n", " ")))
        wide = E("[...document.querySelectorAll('[data-r3b-table] > .bk-tablewrap')].filter(w => w.scrollWidth > w.clientWidth + 1).map(w => w.parentNode.dataset.r3bTable)")
        ok(not wide and pg.locator("[data-r3b-portal] .gf-btn, [data-r3b-portal] th button[aria-label^='Filter']").count() == 0, "at 1440 every 3B table fits, no grid filter buttons in the return's form (%s)" % wide)
        shot(pg, "r3b-summary-desktop")
        pg.click('[data-r3b-fig="3.1a|taxable"]'); W(500)
        ok(pg.locator('[data-r3b-bills="3.1a"]').count() == 1 and pg.locator('[data-r3b-bills="4A3"]').count() == 0, "another figure opens its own bills (3.1(a))")
        E("() => { S.r3bOpen = ''; render(); }")
        subs = E("[...document.querySelectorAll('#app nav[aria-label=Return] button')].map(b => b.textContent)")
        ok(subs == ["Summary", "Details", "2B match", "Files"], "GSTR-3B keeps its one tab row (%s)" % subs)

        print("3. GSTR-2B as the portal")
        E(TWOB_JS, TWO_B); W(300)
        gst(pg, "202603", "r2b", None, "S.r2Scope = 'year'; S.r2View = 'portal'; S.r2bSec = 'summary';")
        ok(pg.locator("[data-2b-summary]").count() == 1, "the 2B summary")
        secs = E("[...document.querySelectorAll('[data-2b-portal] nav[aria-label=\"GSTR-2B section\"] button')].map(b => b.dataset['2bSec'])")
        ok(secs == ["summary", "b2b", "b2ba", "cdnr", "cdnra", "ecom", "isd", "isda", "impg", "impgsez"], "Part A's sections as the portal: B2B, B2BA, CDNR, CDNRA, ECO, ISD, ISDA, IMPG, IMPGSEZ (%s)" % secs)
        sm = E("""() => { const s = GSTPortal.twoBSummary(GSTPortal.twoBRows('07', GSTRev.fyMonths('202603'))), g = (b, part, grp) => b.find(x => x.part === part).rows.find(r => r.group === grp).lines.reduce((a, l) => r2(a + l.igst + l.cgst + l.sgst), 0);
          return {a5: g(s.available, 'A', 'I'), imp: g(s.available, 'A', 'IV'), cn: g(s.available, 'B', 'I'), nav: g(s.notAvailable, 'A', 'I')}; }""")
        ok(sm == {"a5": 18000 + 14400 + 21600 + 27000 + 1800, "imp": 4500, "cn": -900, "nav": 36000}, "the summary's figures from the documents: 4(A)(5), imports 4(A)(1), Part B credit notes, not available (%s)" % sm)
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

        print("4. 2B reconciliation")
        gst(pg, "202603", "r2b", None, "S.r2Scope = 'year'; S.r2View = ''; S.r2Tab = ''; S.rcF = {}; S.rcView = '';")
        ok(pg.locator("[data-reco]").count() == 1, "the 2B part opens on the reconciliation")
        ref = E("""() => { const reg = '07', sc0 = r2Scope(), sc = GST2B.scope(reg, sc0.months), inSpan = (ym) => !sc0.months || sc0.months.includes(ym), tx = (o) => (num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)) * (o.dir || 1);
          const S2b = sc.pairs.map(x => x.p).concat(sc.only2b).filter(p => inSpan(p.ym)), avl = S2b.filter(p => p.itcavl !== 'N'), booksIn = sc.pairs.flatMap(x => x.books).filter(d => inSpan(d.ym)).concat(sc.onlyBooks);
          return {twoB: r2(avl.reduce((a, p) => a + tx(p), 0)), books: r2(booksIn.reduce((a, d) => a + tx(d), 0)), matched: sc.matched.length, mismatch: sc.diff.length, probable: sc.probable.length, b2: sc.only2b.length, bk: sc.onlyBooks.length}; }""")
        tot = E("() => Object.fromEntries([...document.querySelectorAll('[data-reco-total]')].map(e => [e.dataset.recoTotal, Number(e.innerText.replace(/[₹,]/g, ''))]))")
        ok(abs(tot["books"] - ref["books"]) < 0.01 and abs(tot["2b"] - ref["twoB"]) < 0.01 and abs(tot["diff"] - round(ref["twoB"] - ref["books"], 2)) < 0.01,
           "ITC as per books, as per 2B and the difference: the figures the 2B page showed (%s / %s)" % (tot, ref))
        chips = E("() => Object.fromEntries([...document.querySelectorAll('[data-reco-chip]')].map(b => [b.dataset.recoChip, Number(b.querySelector('.sbar-n').textContent)]))")
        ok(chips == {"all": ref["matched"] + ref["mismatch"] + ref["probable"] + ref["b2"] + ref["bk"], "mismatch": ref["mismatch"], "probable": ref["probable"], "books": ref["bk"], "2b": ref["b2"], "matched": ref["matched"]},
           "the chips' counts are GST2B's: matched, mismatch, probable, books only, 2B only (%s / %s)" % (chips, ref))
        st = E("() => Object.fromEntries(GSTReco.recoRows(GST2B.scope('07', r2Scope().months), r2Scope().months, GST2B.state(), 1).map(r => [(r.twoB || r.books).no, r.status + (r.kind ? ':' + r.kind : '') + (r.diffs.length ? '[' + r.diffs.join(',') + ']' : '')]))")
        ok(st.get("NSL/112", "").startswith("mismatch:amount") and st.get("KC/1187", "").startswith("matched[date") and st.get("SS-AUG-077", "").startswith("matched") and "no" in st.get("SS-AUG-077", "")
           and st.get("INV-9001", "").startswith("probable") and st.get("WPH/88") == "2b" and st.get("JLA/311") == "books" and st.get("7712345") == "2b",
           "each fixture case has the right status and differing field (%s)" % st)
        ok(pg.locator("#recoTable tbody tr[data-reco-row=mismatch] .rc-diff").count() >= 1, "the differing field of a mismatch is highlighted")
        rows = E("() => [...document.querySelectorAll('#recoTable tbody tr[data-reco-row]')].map(r => r.dataset.recoRow)")
        ok(rows and rows[0] == "mismatch" and rows[-1] == "matched", "what to look at first: mismatches first, matched last (%s)" % rows)
        heads = E("[...document.querySelectorAll('#recoTable thead tr:nth-child(2) th')].map(t => (t.querySelector('.colh > span') || t).textContent)")
        ok(heads == ["Status", "Supplier · GSTIN", "Invoice no · date", "Taxable", "Tax", "Invoice no · date", "Taxable", "Tax", "Difference in ITC", "Action"] and "As per books" in pg.inner_text("#recoTable thead") and "As per GSTR-2B" in pg.inner_text("#recoTable thead"),
           "Books and 2B side by side (%s)" % heads)
        ok(E("() => { const w = document.querySelector('#recoTable').closest('.bk-tablewrap'); return w.scrollWidth <= w.clientWidth + 1; }"), "at 1440 the reconciliation fits without sideways scroll")
        shot(pg, "reco-desktop")
        pg.click('[data-reco-chip="books"]'); W(400)
        ok(E("() => [...document.querySelectorAll('#recoTable tbody tr[data-reco-row]')].every(r => r.dataset.recoRow === 'books')") and "%d invoice" % ref["bk"] in pg.inner_text("[data-reco-foot]"), "a chip shows its rows only, the footer counts them")
        # actions: follow up, claim next month (the existing remarks); accept a probable match
        first = pg.locator('#recoTable tbody tr[data-reco-row=books] select[data-reco-act]').first
        first.select_option("Expect in next 2B"); W(400)
        ok("Expect in next 2B" in E("JSON.stringify(GST2B.state().tag)"), "Claim next month: kept as the existing remark (Expect in next 2B)")
        pg.click('[data-reco-chip="probable"]'); W(300)
        pg.locator("#recoTable [data-reco-accept]").first.click(); W(500)
        ok("yes" in E("Object.values(GST2B.state().confirm)") and E("GSTReco.recoCounts(GSTReco.recoRows(GST2B.scope('07', r2Scope().months), r2Scope().months, GST2B.state(), 1)).probable") == ref["probable"] - 1, "Accept: the existing confirm, the row leaves Probable match")
        E("() => { GST2B.state().confirm = {}; GST2B.state().tag = {}; S.rcF = {}; render(); }"); W(300)
        # Export: formulas
        E("""() => { window.__files = []; window.saveFile = async (name, data) => { const a = new Uint8Array(await data.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); window.__files.push({name, b64: btoa(s)}); return true; }; }""")
        pg.click("[data-reco-excel]"); W(1500)
        x = E("""() => { const f = window.__files[0]; if (!f) return null; const bin = atob(f.b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          const wb = XLSX.read(a, {type: 'array', cellFormula: true}), ws = wb.Sheets[wb.SheetNames[0]], r = XLSX.utils.decode_range(ws['!ref']), L = r.e.r + 1;
          return {name: f.name, k: (ws['K' + L] || {}).f, kv: (ws['K' + L] || {}).v, s: (ws['S' + L] || {}).v, t: (ws['T' + L] || {}).f, t3: (ws['T3'] || {}).f, head: (ws['D1'] || {}).v + ' / ' + (ws['L1'] || {}).v}; }""")
        ok(x and x["k"].startswith("SUM(K3:K") and x["t3"] == "S3-K3" and abs(x["kv"] - ref["books"]) < 0.01 and abs(x["s"] - ref["twoB"]) < 0.01 and x["head"] == "AS PER BOOKS / AS PER GSTR-2B",
           "the Excel: Books and 2B side by side, the difference a formula, SUMs in the totals row equal to the screen (%s)" % x)
        # By supplier
        pg.click('[data-reco-view] button:has-text("By supplier")'); W(400)
        ok(pg.locator("#recoSup tr[data-reco-sup]").count() >= 5, "By supplier: a row a supplier")
        pg.locator("#recoSup tr[data-reco-sup]").first.click(); W(400)
        ok(E("S.rcView || ''") == "" and E("(S.rcF || {}).party"), "a supplier opens its invoices")
        E("() => { S.rcF = {}; render(); }"); W(200)
        # the automatic matcher's hook: a 2B-only invoice and a books-only bill paired by "AI" become one row; amounts untouched
        E("""() => { const sc = GST2B.scope('07', r2Scope().months), p = sc.only2b.find(x => x.no === 'WPH/88'), d = sc.onlyBooks.find(x => x.no === 'JLA/311');
          window.GSTAutoMatch = {result: () => ({results: [{key2b: p.key, books: [d.id], status: 'probable', reason: 'test pairing', confidence: 0.62}, {key2b: sc.pairs.find(x => x.p.no === 'KC/1187').p.key, status: 'matched-rules', reason: 'date within 3 days'}]})}; render(); }"""); W(400)
        tot2 = E("() => Object.fromEntries([...document.querySelectorAll('[data-reco-total]')].map(e => [e.dataset.recoTotal, Number(e.innerText.replace(/[₹,]/g, ''))]))")
        chips2 = E("() => Object.fromEntries([...document.querySelectorAll('[data-reco-chip]')].map(b => [b.dataset.recoChip, Number(b.querySelector('.sbar-n').textContent)]))")
        ok(tot2 == tot and chips2["all"] == chips["all"] - 1 and chips2["probable"] == chips["probable"] + 1 and pg.locator('[data-reco-auto="probable"]').count() == 1 and pg.locator('[data-reco-auto="matched-rules"]').count() == 1,
           "the matcher's hook: its pairing is one Probable match row, its rule match is labelled, the totals do not move (%s → %s)" % (chips, chips2))
        E("() => { delete window.GSTAutoMatch; render(); }")
        # the workbench of before is still there
        pg.click('[data-r2-view="work"]'); W(400)
        ok(pg.locator('nav[aria-label="2B reconciliation"]').count() == 1, "the workbench of before (tiles, tabs, linking by hand) under Workbench")
        E("() => { S.r2View = ''; S.r2Tab = ''; render(); }")
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
