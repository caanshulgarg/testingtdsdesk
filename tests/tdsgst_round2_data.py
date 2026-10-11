"""The made-up entries and 2B of TDS/GST round 2's tests, shared with tdsgst_round2_shots.py:
BOOKS  TDS receivable entries for run_26as_recon.py (2025-26, the fixture books);
SETUP, TWOB  purchases and the 2B of Oct-2025 to Mar-2026 for run_supplier_health.py."""

BOOKS = """() => {
  const b = S.books, R1 = 'TDS Receivable FY 2025-26', R2 = 'TDS Receivable AY 2026-27', BANK = 'Tamarind Urban Bank - CA 0042';
  b.map = Object.assign({}, b.map); b.map[R1] = {kind: 'tds_receivable'}; b.map[R2] = {kind: 'tds_receivable'};
  const v = (id, date, type, party, ent) => ({id: 'as26-' + id, date, type, no: 'T' + id, ref: '', party, narr: '', ent, opt: false, cancel: false, hsn: []});
  const rec = (id, date, party, tds, gross) => v(id, date, 'Receipt', party, [{l: BANK, a: -(gross - tds)}, {l: R1, a: -tds}, {l: party, a: gross}]);
  b.vouchers = b.vouchers.concat([
    rec(1, '20250525', 'Quillfeather Weddings LLP', 8000, 472000), rec(2, '20250820', 'Quillfeather Weddings LLP', 5000, 250000),
    rec(3, '20251110', 'Vellichor Learning Foundation', 2000, 20000), rec(4, '20260210', 'Zinnia Retreats Pvt Ltd', 3000, 150000),
    rec(5, '20260315', 'Marigold Expo Services', 1000, 50000),
    v(6, '20260331', 'Journal', '', [{l: R2, a: -19000}, {l: R1, a: 19000}])]);
  b.pans = Object.assign({}, b.pans, {'Juniper Legal Associates': 'AAJFJ1234K'});
  S.booksTab = 'tds'; S.tdsFy = '2025-26'; S.tdsView = 'recon'; render();
}"""

ME = "07AAGCL4827M1Z3"
SALT, JUN, NIGHT, ZIR = "07AAICS7751J1ZV", "07AAHFJ6012N1Z7", "07AAKFN4416E1ZF", "07AAACZ1234Z1Z0"
def inv(no, dt, tx, tax): return {"inum": no, "dt": dt, "val": tx + tax, "txval": tx, "igst": 0, "cgst": tax / 2, "sgst": tax / 2, "cess": 0, "pos": "07", "rev": "N", "itcavl": "Y"}
def sup(g, name, filed, prd, invs): return {"ctin": g, "trdnm": name, "supfildt": filed, "supprd": prd, "inv": invs}
TWOB = {
  "102025": [sup(SALT, "SALTMARSH SOFTWARE PVT LTD", "11-11-2025", "102025", [inv("SS/101", "10-10-2025", 10000, 1800)])],
  "112025": [sup(SALT, "SALTMARSH SOFTWARE PVT LTD", "11-12-2025", "112025", [inv("SS/102", "10-11-2025", 10000, 1800)]),
             sup(JUN, "JUNIPER LEGAL ASSOCIATES", "10-12-2025", "112025", [inv("JLA/311", "05-11-2025", 60000, 10800)])],
  "122025": [sup(SALT, "SALTMARSH SOFTWARE PVT LTD", "09-01-2026", "122025", [inv("SS/103", "10-12-2025", 10000, 1800)])],
  "012026": [], "022026": [sup(JUN, "JUNIPER LEGAL ASSOCIATES", "25-03-2026", "022026", [inv("JLA/388", "25-02-2026", 30000, 5400)])],
  "032026": [sup(NIGHT, "NIGHTJAR SOUND & LIGHT CO", "20-03-2026", "012026", [inv("NSL/140", "15-01-2026", 150000, 27000)])],
}
SETUP = """(twob) => {
  const b = S.books, pur = (id, date, party, gstin, no, tx, tax) => ({id: 'sh-' + id, date, type: 'Purchase', no: 'P' + id, ref: no, refDate: date, party, gstin, cmp: '07AAGCL4827M1Z3', narr: '', opt: false, cancel: false, rcm: false, hsn: [],
    ent: [{l: 'Event Software Licence', a: -tx}, {l: '07 CGST INPUT', a: -tax / 2}, {l: '07 SGST INPUT', a: -tax / 2}, {l: party, a: tx + tax}]});
  const add = [];
  ['20251010', '20251110', '20251210', '20260110', '20260210', '20260310'].forEach((d, i) => add.push(pur('s' + i, d, 'Saltmarsh Software Pvt Ltd', '07AAICS7751J1ZV', 'SS/10' + (i + 1), 10000, 1800)));
  add.push(pur('z1', '20251215', 'Zircon Decor', '07AAACZ1234Z1Z0', 'ZD/9', 20000, 3600));
  b.vouchers = b.vouchers.concat(add);
  b.gstins = Object.assign({}, b.gstins, {'Zircon Decor': '07AAACZ1234Z1Z0'});
  b.twoBs = {};
  Object.keys(twob).forEach(p => { const t = GST2B.fromJson({data: {rtnprd: p, gstin: '07AAGCL4827M1Z3', docdata: {b2b: twob[p]}}}); b.twoBs[t.gstin + '|' + t.period] = t; });
  S.booksTab = 'gst'; S.gstReg = '07'; S.gstYm = '202603'; S.gstPart = 'health'; S.gstView = 'return'; S.gstSub = ''; S.gstSeen = ''; render();
}"""
