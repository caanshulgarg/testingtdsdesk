"""python3 run_bank_tally_days.py - the Bank page of a client linked to Tally (speed, 11-Nov-2026: 34 calls one after
another, 2 for each day of the statement). On the stand-in of FinCom's cloud with the made-up firm of tally_shapes.py;
Tally's copy answered in the page (nothing real is asked). TallyProof.checkBank, the bank lines with no voucher id on 16
days: the day's lines and the entries deleted in Tally asked for all the days at once (2 calls, not 2 a day), with the same
lines marked "not in Tally any more" as the day-by-day reading gives (worked out here from the same rows); over 1,000
lines on those days: read page by page (the server's 1,000 an answer), the line on the second page found.
RED on the build before this change: 32 calls.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_tally_days.py"""
import os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from run_tally_connect_norekey import open_page, Q, ok, fails, errors
import threading, functools, http.server
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))

# ---------- bank: 16 days of bank lines with no voucher id; Tally's copy answers by day (and pages of 1,000)
BANK = """(o) => {
  if (!S.coId) S.coId = Object.keys(S.companies)[0];
  const days = Array.from({length: 16}, (_, i) => '2026-07-' + String(i + 1).padStart(2, '0'));
  // each day: lines of the bank ledger (the amounts of the day's even rows), one of them an entry deleted in Tally
  const lines = [], deleted = new Set();
  days.forEach((d, i) => {
    lines.push({ledger: 'HDFC Bank', amount: -(100 + i), guid: 'g-' + i, day: d});
    lines.push({ledger: 'Rent', amount: 200 + i, guid: 'g-' + i, day: d});
    if (i % 4 === 1){ lines.push({ledger: 'HDFC Bank', amount: 300 + i, guid: 'gd-' + i, day: d}); deleted.add('gd-' + i); }
    for (let k = 0; k < (o.fill || 0); k++) lines.push({ledger: 'Other ' + k, amount: k + 1, guid: 'gf-' + i + '-' + k, day: d});
  });
  // the last day's match only on the 1,001st line and later (pages)
  if (o.fill) lines.push({ledger: 'HDFC Bank', amount: 999, guid: 'g-late', day: days[15]});
  const rows = [];
  days.forEach((d, i) => {
    rows.push({id: 's1-' + i + 'a', state: 'intally', date: d, debit: 100 + i, credit: 0});            // in Tally
    rows.push({id: 's1-' + i + 'b', state: 'intally', date: d, debit: 0, credit: 300 + i});            // only a deleted entry's (some days), or none
  });
  if (o.fill) rows.push({id: 's1-late', state: 'intally', date: days[15], debit: 999, credit: 0});
  CO().bankAccounts = [{id: 'a1', ledger: 'HDFC Bank', bank: 'HDFC', last4: '1234'}];
  S.bank = {cid: S.coId, rows, stmts: [{id: 's1', acctId: 'a1', bank: 'HDFC'}], ledgers: {list: []}};
  window.saveBank = () => {};
  TCloud.on = () => true; TCloud.has = () => true;
  TCloud.book = () => ({book: 'bk', daysAt: '2026-10-01T10:44:08Z', state: {doneTo: '20261001', skipped: []}});
  TallyProof.hasDel = null; TallyProof.bankAt = {};
  window.__q = [];
  const dayOf = (u) => { const m = decodeURIComponent(u).match(/[?&]day=(eq\\.([0-9-]+)|in\\.\\(([^)]*)\\))/); return !m ? null : m[2] ? [m[2]] : m[3].split(',').map(x => x.replace(/"/g, '')); };
  const page = (u, xs) => { const lm = u.match(/[?&]limit=(\\d+)/), om = u.match(/[?&]offset=(\\d+)/);
    const lim = lm ? +lm[1] : 1000, off = om ? +om[1] : 0; return xs.slice(off, off + Math.min(lim, 1000)); };   // the server's 1,000 a page
  Cloud.api = async (u) => { window.__q.push(u); const ds = dayOf(u);
    if (/tally_vouchers\\?select=guid/.test(u) && /deleted_at=not\\.is\\.null/.test(u)) return page(u, Array.from(deleted).filter(g => ds.some(d => lines.some(l => l.guid === g && l.day === d))).map(guid => ({guid})));
    if (/tally_lines/.test(u)) return page(u, lines.filter(l => ds.includes(l.day)));
    return []; };
  // what the day-by-day reading marks, from the same rows: gone when the day's live lines have no bank line of that amount
  const exp = {};
  rows.forEach(r => { const amt = r.debit || r.credit; exp[r.id] = !lines.some(l => l.day === r.date && !deleted.has(l.guid) && Math.abs(Math.abs(l.amount) - amt) < 0.01 && l.ledger.toLowerCase() === 'hdfc bank'); });
  return exp;
}"""
GOT = "() => Object.fromEntries(S.bank.rows.map(r => [r.id, !!r.goneFromTally]))"

def bank(E, pg):
    print("== bank: the check of Tally's copy, 16 days")
    exp = E(BANK, {})
    n = E("TallyProof.checkBank(S.coId, true)"); got = E(GOT); qs = [u for u in E("window.__q") if "tally_lines" in u or "deleted_at=not.is.null" in u]
    ok(got == exp and n == sum(1 for v in exp.values() if v), "bank: the same lines marked gone as the day-by-day reading (%d of %d)" % (sum(1 for v in got.values() if v), len(got)))
    ok(len(qs) <= 2, "bank: the days asked at once: %d calls for Tally's lines and deleted entries (was 2 a day, 32)" % len(qs))
    exp = E(BANK, {"fill": 70})
    n = E("TallyProof.checkBank(S.coId, true)"); got = E(GOT); qs = E("window.__q")
    ok(got == exp and not got["s1-late"], "bank: over 1,000 lines: read page by page, the line on the second page found (%d calls)" % len(qs))

PORT = int(os.environ.get("TALLY_PORT", "9583"))

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, pg = open_page(br, "http://localhost:%d/" % PORT)
        E = lambda js, *a: pg.evaluate(js, *a)
        bank(E, pg)
        ok(not errors, "no page errors (%s)" % errors[:3])
        ctx.close(); br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
