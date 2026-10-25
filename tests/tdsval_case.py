"""The Leads-like return of next-tds-validate-short (25-Oct-2026), for run_tds_validate.py and its screenshots: the fixture
books (tdsgst_snapshot.py) and their challans, then on Form 140 Q1 2026-27
  - a deduction worked out by hand: 194C, ₹10,000 TDS on ₹5,00,000, credited 15-Apr-2026, deducted 20-Jun-2026, deposited
    on challan 20090 of 10-Aug-2026 (due 07-Jul-2026): 1% x 3 months (Apr, May, Jun) = ₹300 + 1.5% x 3 months (Jun, Jul,
    Aug) = ₹450 = ₹750;
  - three deductions typed in FinCom on no challan (left out of the file);
  - two books deductions typed again in FinCom (the deductee's name a little different), put on the quarter's challan: the
    possible duplicates.
SETUP(page) does it and returns {hand: id, loose: [ids], dups: [[books id, added id]]}."""
import json
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE

SETUP_JS = """() => {
  const out = {loose: [], dups: []};
  const h = TDSAdd.save({party: 'ZZ Hand Worked Ltd', section: '194C', credit: '2026-04-15', date: '2026-06-20', paid: 500000, tds: 10000});
  if (!h.ok) throw new Error('hand: ' + h.why);
  S.books.challans.push({id: 'zzhw', bsr: '0240020', serial: '20090', date: '20260810', tax: 10000, interest: 0, fee: 0, others: 0, section: '194C', minorHead: '200'});
  TDSReg.forget(); let t = TDSCH.tag([h.id], 'zzhw'); if (!t.ok) throw new Error('tag: ' + t.why);
  out.hand = h.id;
  [['ZZ Loose One', '194J', '2026-05-05', 120000, 12000], ['ZZ Loose Two', '194C', '2026-05-20', 50000, 1000], ['ZZ Loose Three', '194I', '2026-06-02', 60000, 6000]].forEach(([p, s, d, paid, tds]) => {
    const r = TDSAdd.save({party: p, section: s, date: d, paid, tds}); if (!r.ok) throw new Error(p + ': ' + r.why); out.loose.push(r.id); });
  // two of the books' own deductions of the quarter, on a challan, typed again
  const books = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.added && r.challan && r.tds >= 100 && TDS.sec(r.section) && r.party);
  const seen = new Set(), pick = books.filter(r => { const k = TDS.sec(r.section) + r.party; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
  pick.forEach((r, i) => {
    const a = TDSAdd.save({party: i === 0 ? r.party + ' & Co.' : r.party.toUpperCase(), section: TDS.sec(r.section), date: TDS.ymd(r.date), paid: r.paid || r.tds * 50, tds: Math.round(r.tds), challan: r.challan});
    if (!a.ok) throw new Error('dup: ' + a.why); out.dups.push([r.id, a.id]); });
  TDSReg.forget(); TDSReg.done(); render();
  return out;
}"""

def books():
    return json.load(open(CACHE))

def SETUP(pg):
    pg.evaluate(LOAD, books()); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
    return pg.evaluate(SETUP_JS)

GO_FILE = """() => { S.booksTab = 'tds'; tdsGo('2026-27', 'Q1', '26Q'); S.tdsTab = 'file'; S.tdsDedView = ''; S.tdsChView = ''; S.tdsWinCh = ''; S.tdsFix = ''; S.tdsValOpen = ''; render(); window.scrollTo(0, 0); }"""
