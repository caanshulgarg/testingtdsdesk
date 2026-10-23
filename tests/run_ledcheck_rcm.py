"""python3 run_ledcheck_rcm.py - the ledger check's reverse-charge rule (the owner, 08-Oct-2026: "its rule that calls
'07 CGST INPUT' (a regular input ledger) reverse charge is wrong").
Why it over-flagged: LedCheck.suggest (src/js/57) called a ledger reverse charge when ANY of its day-book entries also
had a ledger named RCM / reverse charge on it (usage's "with"). A regular input ledger takes the input credit of the
reverse-charge purchases too (Dr expense, Dr 07 CGST INPUT, Cr 07 RCM CGST PAYABLE), so 4 of 07 CGST INPUT's 10
entries made it "GST, reverse charge".
Now: the name says reverse charge (RCM, reverse charge) as before; by use only when (almost) every entry of the ledger
is a reverse-charge entry (80 %), and never for a ledger named input / ITC without RCM in its name.
  1. 07 CGST INPUT, 07 SGST INPUT, 07 IGST INPUT: GST input, not reverse charge (FAILS on the old rule);
  2. genuine reverse charge still found: the fixture's 07 RCM CGST / SGST / IGST PAYABLE (by name), and made-up ledgers:
     "Input CGST on RCM" (name), "CGST payable on URD purchases" used only on reverse-charge entries (use);
  3. every other fixture ledger's answer is what it was (the table before / after is printed).
Made-up client: tests/ledpage_setup.py. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledcheck_rcm.py"""
import json, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the check's answer for every fixture ledger before the fix (build a98a0982): what, side, head, section, confidence
BEFORE = {
    "07 CGST INPUT": ["gst_rcm", "input", "CGST", "", "high"],
    "07 CGST OUTPUT": ["gst", "output", "CGST", "", "high"],
    "07 IGST INPUT": ["gst_rcm", "input", "IGST", "", "high"],
    "07 IGST INPUT PROVISIONAL": ["gst", "input", "IGST", "", "high"],
    "07 IGST OUTPUT": ["gst", "output", "IGST", "", "high"],
    "07 RCM CGST PAYABLE": ["gst_rcm", "output", "CGST", "", "high"],
    "07 RCM IGST PAYABLE": ["gst_rcm", "output", "IGST", "", "high"],
    "07 RCM SGST PAYABLE": ["gst_rcm", "output", "SGST", "", "high"],
    "07 SGST INPUT": ["gst_rcm", "input", "SGST", "", "high"],
    "07 SGST OUTPUT": ["gst", "output", "SGST", "", "high"],
    "09 CGST INPUT": ["gst", "input", "CGST", "", "high"],
    "09 CGST OUTPUT": ["gst", "output", "CGST", "", "high"],
    "09 SGST INPUT": ["gst", "input", "SGST", "", "high"],
    "09 SGST OUTPUT": ["gst", "output", "SGST", "", "high"],
    "GST Adjustment Misc": ["gst", "", "", "", "low"],
    "GST Late Fee": ["none", "", "", "", "high"],
    "Interest on TDS": ["none", "", "", "", "high"],
    "TDS ON CONTRACT 194C": ["tds_payable", "", "", "194C", "high"],
    "TDS ON INTEREST 194A": ["tds_payable", "", "", "194A", "high"],
    "TDS ON PROFESSIONAL 194J": ["tds_payable", "", "", "194J", "high"],
    "TDS Payable - Month End": ["tds_payable", "", "", "", "low"]
}
# what the fix changes, and nothing else
FIXED = {"07 CGST INPUT": ["gst", "input", "CGST"], "07 SGST INPUT": ["gst", "input", "SGST"], "07 IGST INPUT": ["gst", "input", "IGST"]}
RUN = """() => { const c = LedCheck.run(S.books); const out = {}; c.names.forEach(n => { const s = LedCheck.pick(c.items[n]); out[n] = [s.what || '', s.side || '', s.tax || '', s.section || '', s.conf || '']; }); return out; }"""
# made-up books: a purchase under reverse charge each month, and a regular one
SYN = """() => { const b = {cid: 'syn', vouchers: [], map: {}, ledInfo: {}, groups: {'Duties & Taxes': '', 'Indirect Expenses': '', 'Sundry Creditors': ''}, under: {}, gstins: {}};
  const info = (n, g) => { b.ledInfo[n] = {group: g, taxType: ''}; };
  ['Input CGST on RCM', 'CGST payable on URD purchases', 'Input SGST on RCM', 'SGST payable on URD purchases', 'Input CGST', 'Input SGST'].forEach(n => info(n, 'Duties & Taxes'));
  info('Freight', 'Indirect Expenses'); info('Transporter', 'Sundry Creditors'); info('Supplier', 'Sundry Creditors');
  for (let i = 1; i <= 6; i++){
    b.vouchers.push({id: 'r' + i, date: '2025080' + i, type: 'Journal', no: 'R' + i, party: 'Transporter', ent: [{l: 'Freight', a: -1000}, {l: 'Input CGST on RCM', a: -25}, {l: 'Input SGST on RCM', a: -25}, {l: 'CGST payable on URD purchases', a: 25}, {l: 'SGST payable on URD purchases', a: 25}, {l: 'Transporter', a: 1000}]});
    b.vouchers.push({id: 'p' + i, date: '2025080' + i, type: 'Purchase', no: 'P' + i, party: 'Supplier', ent: [{l: 'Freight', a: -1000}, {l: 'Input CGST', a: -90}, {l: 'Input SGST', a: -90}, {l: 'Supplier', a: 1180}]});
  }
  const c = LedCheck.run(b), out = {}; c.names.forEach(n => { const s = LedCheck.pick(c.items[n]); out[n] = [s.what || '', s.side || '', s.tax || '']; }); return out; }"""
with sync_playwright() as p:
    srv, br, pg = L.start(p, 8401, SITE, errors=errors)
    L.open_page(pg, "owner")
    now = pg.evaluate(RUN)
    print("\n  %-28s %-38s %s" % ("ledger", "before", "after"))
    for n in sorted(set(BEFORE) | set(now)):
        a, b2 = BEFORE.get(n), now.get(n)
        print("  %-28s %-38s %s%s" % (n, " ".join(x or "-" for x in a) if a else "(none)", " ".join(x or "-" for x in b2) if b2 else "(none)", "   <- changed" if a != b2 else ""))
    print()
    # 1. regular input ledgers are not reverse charge
    for n, want in FIXED.items():
        ok(now.get(n, [""] * 3)[:3] == want, "%s: %s, not reverse charge (%s)" % (n, " ".join(want), now.get(n)))
    # 2. genuine reverse charge still found
    for n, tax in [("07 RCM CGST PAYABLE", "CGST"), ("07 RCM SGST PAYABLE", "SGST"), ("07 RCM IGST PAYABLE", "IGST")]:
        ok(now.get(n, [""] * 3)[:3] == ["gst_rcm", "output", tax], "%s: reverse charge, output %s (%s)" % (n, tax, now.get(n)))
    syn = pg.evaluate(SYN)
    for n, side in [("Input CGST on RCM", "input"), ("Input SGST on RCM", "input"), ("CGST payable on URD purchases", "output"), ("SGST payable on URD purchases", "output")]:
        ok((syn.get(n) or [""])[0] == "gst_rcm" and syn[n][1] == side, "made-up: %s is reverse charge, %s (%s)" % (n, side, syn.get(n)))
    for n in ["Input CGST", "Input SGST"]:
        ok((syn.get(n) or [""])[0] == "gst" and syn[n][1] == "input", "made-up: %s, used on regular purchases only, is GST input (%s)" % (n, syn.get(n)))
    # 3. nothing else changed
    other = [n for n in BEFORE if n not in FIXED and BEFORE[n] != now.get(n)]
    ok(not other and set(now) == set(BEFORE), "every other fixture ledger's answer is as before %s" % [(n, BEFORE[n], now.get(n)) for n in other])
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()
print("\n%d FAILED" % len(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
