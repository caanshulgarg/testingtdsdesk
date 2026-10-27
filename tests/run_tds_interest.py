"""python3 run_tds_interest.py - a TDS return's interest (201(1A) / 206C(7)) and late fee (234E) checked in one place, and the
interest and fee a return claims allocated on the Challans grid itself (next-tds-interest, 20-Oct-2026). On the fixture books
(tdsgst_snapshot.py) plus one deduction made late (bill 05-Apr-2026, deducted 10-Jun-2026) on a challan paid late
(20-Aug-2026: tax 2,500, interest 50), in the React build (app/dist-test, or TDSDESK_SITE):
  1. Validate & file: no "Interest of ₹x is due on late deductions or payments" warning; ONE warning "Interest ₹x due · ₹y
     not allocated" (next-tds-validate-short: the return's whole interest, and the interest due on its challans less what is
     allocated to it) while short, its one action Details, and "Late fee 234E ₹x" while a fee is due and the return is not
     filed
  2. the "Interest & fee" working (next-tds-validate-short: in the line's side panel, not on the page): a row for each
     deduction with interest (deducted late and paid late on one row),
     its figures and total those of TDS.interest; the 234E line that of TDS.lateFee; due, allocated and the difference by
     challan
  3. the Challans grid: Interest allocated and Others allocated typed in the row (kept; the row click not set off); more
     than the challan's interest drawn from its free tax (its tax balance less by as much); more than the challan holds
     refused, the cell back to what it was; a deduction can no longer take the tax so moved
  4. "Allocate interest due": each challan's due allocated, the warning gone for it
  5. Form 140's challan record (FVU 1.2, field 24) carries the interest allocated; field 25 the 234E fee and others
next-tds-interest2 (the owner's follow-up, 20-Oct-2026):
  6. allocated at or above what is due: "Covered ✓" (more than due a small note), no warning, no negative difference; short
     under ₹10 (TDS.MIN_WARN): "Within ₹10", no warning, not in the header's count; no rate question under ₹10
  7. "Fee 234E allocated" typed on the Challans grid (apart from Others), "Allocate fee due"; the fee allocated, the 234E
     warning gone and the 234E row Covered ✓; the section says each figure once (no "Pay with the next challan", no total
     for one row, the fee once); "Paid/credited on" is the date paid or credited
TDS_INTEREST_SHOTS=dir: screenshots at 1440 (default tests/out/tds-interest)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_INTEREST_PORT") or 8396)
SHOTS = os.environ.get("TDS_INTEREST_SHOTS") or os.path.join(HERE, "out", "tds-interest"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
K = "['26Q', '2026-27', 'Q1']"
MONEY = "(v) => '₹' + INR.format(r2(v || 0))"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        money = lambda v: J(MONEY, v)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        J(LOAD, books); pg.wait_for_timeout(1000); J("S.books = window.__bk; render();"); pg.wait_for_timeout(500); J(CHALLANS); pg.wait_for_timeout(300)
        add = J("() => TDSAdd.save({party: 'ZZ Late Vendor Ltd', section: '194C', credit: '2026-04-05', date: '2026-06-10', paid: 100000, tds: 2000})")
        ok(add.get("ok"), "a deduction made late added (%s)" % add)
        rid = add.get("id")
        J("""(id) => { S.books.challans.push({id: 'zzlate', bsr: '0240020', serial: '20001', date: '20260820', tax: 2500, interest: 50, fee: 0, others: 0, section: '194C', minorHead: '200'});
          TDSReg.forget(); const r = TDSCH.tag([id], 'zzlate'); if (!r.ok) throw new Error(r.why); render(); }""", rid)
        due = J("""(id) => r2(TDS.interest('2026-27', 'Q1', '26Q').filter(x => x.row.id === id).reduce((a, x) => a + x.amount, 0))""", rid)
        ok(abs(due - 150) < 0.005, "the late deduction owes 60 (1%% x 3 months, deducted late) + 90 (1.5%% x 3 months, paid late) = 150 (%s)" % due)
        go = lambda step: (J("(s) => { S.booksTab = 'tds'; tdsGo('2026-27', 'Q1', '26Q'); S.tdsTab = s; S.tdsDedView = ''; S.tdsChView = ''; S.tdsWinCh = ''; S.tdsFix = ''; render(); window.scrollTo(0, 0); }", step), pg.wait_for_timeout(500))
        # the interest due and allocated on this return's challans, as the page should say them
        SHORT = """() => { const cx = TDSReg.ctx(), k = TDSReg.key('26Q', '2026-27', 'Q1'), mine = TDS.challans().filter(c => (cx.uses[c.id] || {})[k]);
          const d = r2(TDS.interest('2026-27', 'Q1', '26Q').filter(x => x.kind !== 'unpaid').reduce((a, x) => a + x.amount, 0));
          const g = r2(mine.reduce((a, c) => a + TDSReg.portionFor(c, '26Q', '2026-27', 'Q1', cx).interest, 0)); return r2(Math.max(0, d - g)); }"""
        item = lambda k: J("(k) => { const e = document.querySelector('#app [data-val-item=\"' + k + '\"] .vf-w'); return e ? e.textContent : null; }", k)
        # next-tds-validate-short: the working is in a side panel (Details, or More checks › Interest & late fee)
        work = lambda: (J("() => { S.tdsFix = 'intwork'; S.tdsFixAt = '2026-27|Q1|26Q'; render(); }"), pg.wait_for_timeout(400))
        amtw = lambda v: J("(v) => '₹' + (Math.abs(r2(v) - Math.round(v)) < 0.005 ? Math.round(v).toLocaleString('en-IN') : INR.format(r2(v)))", v)
        TOT = "() => TDSMatch.interestTable('26Q', '2026-27', 'Q1').totals.interest"

        print("1. Validate & file")
        go("file")
        txt = J("document.querySelector('#app').innerText")
        ok("is due on late deductions" not in txt, "no 'Interest of ₹x is due on late deductions or payments' warning")
        ok(J("document.querySelectorAll('#app [data-val-item=\"interest\"] .vf-act button').length") == 1 and J("(document.querySelector('#app [data-val-review=\"interest\"]') || {}).textContent") == "Details", "the interest line's one action: Details")
        short = J(SHORT)
        ok(short >= 1 and item("interest") == "Interest %s due · %s not allocated" % (money(J(TOT)), money(short)), "one warning: Interest %s due · %s not allocated (%s)" % (money(J(TOT)), money(short), item("interest")))
        ok(J("document.querySelectorAll('#app [data-val-item=\"interest\"]').length") == 1 and len(re.findall(r"Interest .{0,40}not allocated", txt)) == 1, "the interest warning once")
        fee = J("TDS.lateFee('2026-27', 'Q1', '', '26Q')")
        FEEALLOC = "() => TDSMatch.interestTable('26Q', '2026-27', 'Q1').totals.feeAllocated"
        J("() => { TDS.challans().forEach(c => { const p = TDSReg.portionFor(c, '26Q', '2026-27', 'Q1'); if (p.fee234) TDSReg.setPortion(c.id, '26Q', '2026-27', 'Q1', p.interest, 0, {nosave: true}, p.others); }); render(); }")
        ok(fee and fee["fee"] > 0 and J(FEEALLOC) == 0 and item("fee") == "Late fee 234E %s" % amtw(fee["fee"]), "Late fee 234E %s (%s)" % (amtw(fee and fee["fee"]), item("fee")))
        ok("No interest or late fee yet" not in txt and not re.search(r"Interest 201\(1A\) ₹[\d,.]+ · late fee", txt), "no old 'Interest 201(1A) ₹x · late fee' summary line")

        print("2. the Interest & fee working")
        ok(pg.locator('#app [data-validate] > [data-int-sec]').count() == 0, "no Interest & fee table on the page itself")
        pg.click('#app [data-val-review="interest"]'); pg.wait_for_timeout(500)
        sec = pg.locator('[data-val-drawer="interest"] [data-int-sec="26Q"]')
        ok(sec.count() == 1 and "Interest & fee" in sec.text_content(), "Details opens the Interest & fee working")
        heads = [h.strip() for h in pg.locator('#app [data-int-sec] [data-int-table] thead th').all_inner_texts()]
        want_heads = ["Deductee", "Section", "Amount", "Deducted on", "Paid/credited on", "Challan", "Months at 1%", "Months at 1.5%", "Interest"]
        ok(all(any(w in h for h in heads) for w in want_heads), "its columns: %s (%s)" % (want_heads, heads))
        exp = J("""() => { const L = TDS.interest('2026-27', 'Q1', '26Q'), by = {};
          L.forEach(x => { const k = x.row.id + (x.kind === 'unpaid' ? ':u' : ''); by[k] = r2((by[k] || 0) + x.amount); });
          return {n: Object.keys(by).length, total: r2(L.reduce((a, x) => a + x.amount, 0))}; }""")
        rows = J("() => [...document.querySelectorAll('#app [data-int-table] tbody tr[data-int-row]')].map(tr => [tr.dataset.intRow, +tr.dataset.amt])")
        ok(len(rows) == exp["n"], "one row a deduction with interest (deducted and paid late on one row): %d (%d)" % (len(rows), exp["n"]))
        mine = [a for k, a in rows if k == rid]
        ok(mine == [150], "the late deduction: one row, interest 150 (%s)" % mine)
        tot = J("() => { const e = document.querySelector('#app [data-int-total]'); return e ? +e.dataset.intTotal : null; }")
        rtot = J("() => { const e = document.querySelector('#app [data-int-rows-total]'); return e ? +e.dataset.intRowsTotal : null; }")
        ok(tot is not None and abs(tot - exp["total"]) < 0.005 and ((exp["n"] > 1 and rtot is not None and abs(rtot - tot) < 0.005) or (exp["n"] == 1 and rtot is None)), "the total is TDS.interest's (the table's total row only for two rows or more): %s (%s, %d rows)" % (tot, exp["total"], exp["n"]))
        cred = J("(id) => (document.querySelector('#app [data-int-row=\"' + id + '\"] [data-int-credit]') || {}).textContent", rid)
        ok(cred == J("() => fmtDate(tallyDate('20260405'))"), "Paid/credited on: the date credited, 05-Apr-2026 (%s)" % cred)
        mrow = J("(id) => { const tr = document.querySelector('#app [data-int-row=\"' + id + '\"]'); return tr ? tr.innerText.replace(/\\s+/g, ' ') : ''; }", rid)
        ok("ZZ Late Vendor Ltd" in mrow and "194C" in mrow and "20001" in mrow and re.search(r"\b3\b.*\b3\b", mrow), "the row: deductee, section, challan serial, 3 months at 1%% and 3 at 1.5%% (%s)" % mrow)
        frow = J("() => { const e = document.querySelector('#app [data-int-fee]'); return e ? [+e.dataset.intFee, e.innerText.replace(/\\s+/g, ' '), e.title, (e.querySelector('[data-status]') || {dataset: {}}).dataset.status] : null; }")
        ok(frow and abs(frow[0] - fee["fee"]) < 0.005 and ("%d days past" % fee["days"]) in frow[1] and "₹200/day, capped at the quarter's tax" in frow[1] and frow[3] == "short", "the 234E row: TDS.lateFee's fee, its one-line note, short (%s)" % (frow,))
        ok("271H" in (frow[2] or "") and "271H" not in sec.inner_text(), "271H only in the 234E row's hover (%s)" % (frow[2],))
        ok(sec.locator('[data-int-sum]').count() == 1 and abs(J("+document.querySelector('#app [data-int-sum] [data-int-short]').dataset.intShort") - J(SHORT)) < 0.005, "the working's sum: total, on challans, allocated, not allocated (the line's)")
        stxt = J("() => { const s = document.querySelector('#app [data-int-sec]').cloneNode(true); s.querySelectorAll('[data-int-sum], [data-int-law]').forEach(e => e.remove()); document.body.appendChild(s); const t = s.innerText; s.remove(); return t; }")
        ok("Pay with the next challan" not in stxt and "if filed today" not in stxt, "no 'Pay with the next challan' and no long late-fee text")
        ok(stxt.count(money(fee["fee"])) == 1, "the late fee %s once in the section (%d)" % (money(fee["fee"]), stxt.count(money(fee["fee"]))))
        ch = J("() => { const tr = document.querySelector('#app [data-int-ch=\"zzlate\"]'); return tr ? {due: +tr.dataset.due, alloc: +tr.dataset.alloc, diff: +tr.dataset.diff, bad: tr.querySelector('.bad') != null} : null; }")
        # the TDS check of 22-Oct-2026, M6: with nothing typed, the file's interest is what the return's late deductions on the
        # challan owe, never more than the challan has: its 50 (was 0)
        ok(ch and ch["due"] == 150 and ch["alloc"] == 50 and ch["diff"] == 100 and ch["bad"], "by challan: 20001 due 150, its interest 50 allocated by default, short 100 marked (%s)" % ch)
        heads2 = [h.strip() for h in pg.locator('#app [data-int-chs] thead th').all_inner_texts()]
        ok(heads2 == ["Challan", "Interest due", "Fee due", "Allocated to this return", "Status"], "one summary: Challan, Interest due, Fee due, Allocated, Status (%s)" % heads2)
        ok(pg.locator('#app [data-int-sec] table').count() == 2, "two tables only: the interest and the summary")
        if sec.count(): sec.scroll_into_view_if_needed()
        pg.screenshot(path=os.path.join(SHOTS, "validate-interest-1440.png"), full_page=True)

        print("3. the Challans grid")
        go("challans")
        bal0 = J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'zzlate')).tax")
        ok(abs(bal0 - 500) < 0.005, "the late challan: 500 of tax free (%s)" % bal0)
        inp = pg.locator('#app input[data-chg-int="zzlate"]')
        ok(inp.count() == 1 and pg.locator('#app input[data-chg-fee="zzlate"]').count() == 1 and pg.locator('#app input[data-chg-oth="zzlate"]').count() == 1, "Interest, Fee 234E and Others allocated are boxes in the row")
        gh = [h.strip() for h in pg.locator('#app .chg-table thead th').all_inner_texts()]
        ok("Fee 234E allocated" in gh and gh.index("Fee 234E allocated") == gh.index("Interest allocated") + 1 and gh.index("Others allocated") == gh.index("Fee 234E allocated") + 1, "the grid: Interest, Fee 234E, Others allocated side by side (%s)" % gh)
        tab0 = J("S.tdsTab")
        inp.click(); inp.fill("40"); inp.press("Enter"); pg.wait_for_timeout(300)
        P = "() => TDSReg.portionFor(TDS.challans().find(c => c.id === 'zzlate'), '26Q', '2026-27', 'Q1')"
        ok(J(P)["interest"] == 40 and J("S.tdsTab") == tab0 and not J("S.tdsWinCh"), "40 typed: allocated, the row's deductions not opened (%s)" % J(P))
        inp = pg.locator('#app input[data-chg-int="zzlate"]'); inp.fill("150"); inp.blur(); pg.wait_for_timeout(300)
        ok(J(P)["interest"] == 150, "150: more than the challan's interest 50, taken from its free tax (%s)" % J(P))
        bal1 = J("+document.querySelector('#app [data-chg-row=\"zzlate\"] [data-chg-bal]').dataset.chgBal")
        ok(abs(bal1 - 400) < 0.005, "the tax balance down by the 100 moved: 400 (%s)" % bal1)
        inp = pg.locator('#app input[data-chg-int="zzlate"]'); inp.fill("700"); inp.press("Enter"); pg.wait_for_timeout(300)
        toastT = J("(document.querySelector('.toast, #toast, [data-toast]') || {}).textContent || ''")
        ok(J(P)["interest"] == 150 and pg.locator('#app input[data-chg-int="zzlate"]').input_value().replace(",", "") in ("150", "150.00"), "700 refused, the cell back to 150 (%s)" % pg.locator('#app input[data-chg-int="zzlate"]').input_value())
        ok("free on this challan" in toastT, "the refusal says what is free (%s)" % toastT)
        oth = pg.locator('#app input[data-chg-oth="zzlate"]'); oth.fill("10"); oth.press("Enter"); pg.wait_for_timeout(300)
        bal2 = J("() => TDSReg.balance(TDS.challans().find(c => c.id === 'zzlate')).tax")
        ok(J(P)["others"] == 10 and J(P)["fee234"] == 0 and abs(bal2 - 390) < 0.005, "others 10 (the challan has no others): taken from tax too, balance 390 (%s, %s)" % (J(P), bal2))
        big = J("() => TDSAdd.save({party: 'ZZ Second Vendor', section: '194C', date: '2026-06-15', paid: 20000, tds: 395})")
        r = J("(id) => TDSCH.tag([id], 'zzlate')", big.get("id"))
        ok(not r.get("ok"), "a deduction of 395 cannot take the tax moved to interest and fee (390 left) (%s)" % r.get("why"))
        J("(k) => TDSAdd.remove(k, 'a test')", big.get("key"))
        pg.screenshot(path=os.path.join(SHOTS, "challans-grid-1440.png"), full_page=True)
        # filed: the cells are read-only
        locked = J("() => { window.__lk = TDSReg.locked; TDSReg.locked = () => true; render(); return document.querySelectorAll('#app input[data-chg-int]').length; }")
        ok(locked == 0, "a return marked filed: no boxes (%s)" % locked)
        J("() => { TDSReg.locked = window.__lk; render(); }")

        print("4. Allocate interest due")
        J("() => { TDSReg.setPortion('zzlate', '26Q', '2026-27', 'Q1', 0, 0); render(); }")
        pg.click('#app [data-chg-alloc-due]'); pg.wait_for_timeout(400)
        ok(J(P)["interest"] == 150, "Allocate interest due: 150 to the late challan (%s)" % J(P))
        go("file"); work()
        ch = J("() => { const tr = document.querySelector('#app [data-int-ch=\"zzlate\"]'); return tr ? {alloc: +tr.dataset.alloc, diff: +tr.dataset.diff} : null; }")
        ok(ch and ch["alloc"] == 150 and ch["diff"] == 0, "by challan: 20001 allocated 150, no difference (%s)" % ch)
        short = J(SHORT)
        ok((short < 10 and item("interest") is None) or (short >= 10 and item("interest") == "Interest %s due · %s not allocated" % (money(J(TOT)), money(short))), "the interest warning follows what is left short (%s, %s)" % (short, item("interest")))
        pg.screenshot(path=os.path.join(SHOTS, "validate-after-1440.png"), full_page=True)

        print("6. covered, within ₹10")
        COUNT = "() => +((document.querySelector('#app [data-problem-count]') || {dataset: {}}).dataset.problemCount || 0)"
        n0 = J(COUNT)
        stat = lambda: J("() => { const tr = document.querySelector('#app [data-int-ch=\"zzlate\"]'); return tr ? [(tr.querySelector('[data-status]') || {dataset: {}}).dataset.status, tr.innerText.replace(/\\s+/g, ' ')] : null; }")
        for amt, want, words in ((153, "covered", "₹3.00 more than due"), (145, "within", "Within ₹10"), (150, "covered", None)):
            J("(a) => { TDSReg.setPortion('zzlate', '26Q', '2026-27', 'Q1', a, 0, {nosave: true}, 10); render(); }", amt); pg.wait_for_timeout(300); work()
            st = stat()
            ok(st and st[0] == want and (words is None or words in st[1]) and not re.search(r"₹-|-₹", st[1]) and "Covered ✓" in st[1] if want == "covered" else st and st[0] == want and (words in st[1]),
               "interest allocated %d of 150: %s%s (%s)" % (amt, want, " · " + words if words else "", st))
            ok(J(SHORT) >= 10 or item("interest") is None, "allocated %d: no interest warning (short %s)" % (amt, J(SHORT)))
        J("() => { TDSReg.setPortion('zzlate', '26Q', '2026-27', 'Q1', 145, 0, {nosave: true}, 10); render(); }"); pg.wait_for_timeout(300)
        ok(J(COUNT) <= n0 and item("interest") is None, "5 short: not a warning, not in the header's count (%s, was %s)" % (J(COUNT), n0))
        J("() => { TDSReg.setPortion('zzlate', '26Q', '2026-27', 'Q1', 150, 0, {nosave: true}, 10); render(); }")
        ok(J("TDS.MIN_WARN") == 10 and J("TDSMatch.warnShort(9.99)") is False and J("TDSMatch.warnShort(10)") is True, "one constant: TDS.MIN_WARN = 10 (TDSMatch.warnShort)")
        pty, exp_r = J("() => { const r = TDS.rows().find(r => TDS.sec(r.section) === '194C' && Certs.validPan(r.pan) && Certs.expected(r).rate); return r ? [r.party, Certs.expected(r).rate] : [null, null]; }")
        small = J("([p, r]) => TDSAdd.save({party: p, section: '194C', date: '2026-06-20', paid: 100000, tds: r2(1000 * r - 5), rate: Math.round((1000 * r - 5) / 1000 * 10000) / 10000})", [pty, exp_r])
        iss = J("(id) => Certs.issues('2026-27', 'Q1').filter(x => x.row.id === id).length", small.get("id"))
        ok(iss == 0 and J("() => Certs.issues('2026-27', 'Q1').every(x => Math.abs(x.short) >= 10)"), "a rate rounding short of ₹5 (%s, %s%%): no rate question; none under ₹10 (%s)" % (pty, exp_r, iss))
        J("(k) => TDSAdd.remove(k, 'a test')", small.get("key"))
        go("file")
        ws = J("() => [...document.querySelectorAll('#app [data-val-level=\"warn\"] .vf-w')].map(e => e.textContent)")
        low = [w for w in ws if re.search(r"₹(\d(\.\d\d)?)(?![\d,])", w)]
        ok(not low, "no warning on Validate & file for under ₹10 (%s)" % low)

        print("7. Fee 234E allocated, Allocate fee due")
        go("challans")
        fin = pg.locator('#app input[data-chg-fee="zzlate"]'); fin.fill("30"); fin.press("Enter"); pg.wait_for_timeout(300)
        ok(J(P)["fee234"] == 30 and J(P)["others"] == 10 and J(P)["interest"] == 150, "Fee 234E 30 typed: kept apart from others 10 (%s)" % J(P))
        go("file")
        ok(item("fee") == "Late fee 234E %s still to allocate" % amtw(fee["fee"] - 30), "the 234E warning: what is left, %s (%s)" % (amtw(fee["fee"] - 30), item("fee")))
        go("challans")
        ok(pg.locator('#app [data-chg-alloc-fee]').count() == 1, "Allocate fee due offered while the fee is short")
        pg.click('#app [data-chg-alloc-fee]'); pg.wait_for_timeout(400)
        fa = J(FEEALLOC)
        ok(fa >= fee["fee"] - 0.005 and pg.locator('#app [data-chg-alloc-fee]').count() == 0, "Allocate fee due: %s allocated (%s), the button gone" % (money(fee["fee"]), fa))
        pg.screenshot(path=os.path.join(SHOTS, "challans-fee-1440.png"), full_page=True)
        go("file"); work()
        frow = J("() => { const e = document.querySelector('#app [data-int-fee]'); return e ? (e.querySelector('[data-status]') || {dataset: {}}).dataset.status : null; }")
        ok(item("fee") is None and frow == "covered", "the fee allocated: no 234E warning, the 234E row Covered ✓ (%s, %s)" % (item("fee"), frow))
        sec = pg.locator('#app [data-int-sec="26Q"]'); sec.scroll_into_view_if_needed()
        pg.screenshot(path=os.path.join(SHOTS, "validate-covered-1440.png"), full_page=True)
        # each figure once: the Allocated column apart (a figure due and the same allocated is the summary's point)
        stxt = J("() => { const s = document.querySelector('#app [data-int-sec]').cloneNode(true); s.querySelectorAll('[data-int-chs] tr > :nth-child(4), [data-int-sum], [data-int-law]').forEach(e => e.remove()); document.body.appendChild(s); const t = s.innerText; s.remove(); return t; }")
        amts = re.findall(r"₹[\d,]+\.\d\d", stxt)
        dup = sorted(set(a for a in amts if amts.count(a) > 1))
        ok(not [a for a in dup if a != money(150)], "no figure twice in the section, but a deduction's interest that is its challan's whole due (%s)" % dup)

        print("5. the file")
        f = J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
        lines = [l.split("^") for l in (f.get("text") or "").split("\r\n") if l]
        cd = [l for l in lines if len(l) > 23 and l[1] == "CD" and l[16] == "20001"]
        fc = J("() => { const o = {}; TDS.challans().forEach(c => { const p = TDSReg.portionFor(c, '26Q', '2026-27', 'Q1'); if (p.fee) o[c.serial] = p.fee.toFixed(2); }); return o; }")
        f25 = {l[16]: l[24] for l in lines if len(l) > 24 and l[1] == "CD" and l[16] in fc}
        ok(fc.get("20001") == "40.00" and f25 == fc, "field 25 (fees allocation): the 234E fee and others allocated, each challan (%s, %s)" % (f25, fc))
        ok(len(cd) == 1 and cd[0][8] == "50.00" and cd[0][23] == "150.00", "Form 140's challan record: interest 50 as deposited (field 9), 150 allocated (field 24) (%s)" % str((cd[0][8], cd[0][23]) if cd else (f.get("error") or [l[:24] for l in lines if len(l) > 1 and l[1] == "CD"])))
        J("(k) => TDSAdd.remove(k, 'a test')", add.get("key"))
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
