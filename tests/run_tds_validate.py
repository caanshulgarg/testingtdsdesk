"""python3 run_tds_validate.py - Validate & file short and clear (next-tds-validate-short; the owner, 25-Oct-2026, on Leads
Insurance's Form 140 Q1 2026-27: "maximum errors and warnings are not required.. there should be a shorter way to say this
warning.. don't need too long warnings.. all calculations of interest should be there if we click late payment interest in
warning.. check it"; then "there should not be any blocker also if we do not file any deductions.. we can say that certain
deductions are not there but it cannot be a blocker"). On the Leads-like case of tdsval_case.py, in the React build
(app/dist-test, or TDSDESK_SITE):
  1. no blocker for deductions on no challan: no error line, Make FVU file enabled; ONE warning "N deductions not in the
     file (no challan) · ₹x" whose panel lists them; the file (TDS26Q.build) is made, leaves out exactly those rows (no DD
     record for them, the file's leftOut and its note), and keeps every other row
  2. the warnings: at most 5 lines (the rest under "N more"), each at most 70 characters, one action each; advice under one
     folded "Suggestions (N)" line; the online checks, Checks before filing, the AI match and the year's checks under one
     folded "More checks"; no long sentence on the page (the long words are in the line's panel, on click)
  3. interest: no table on the page; "Interest ₹x due · ₹y not allocated · Details" opens the working; its total is the
     line's ₹x, its "not allocated" the line's ₹y, its rows add up to it, each row's 1% and 1.5% parts as worked by hand:
     the hand-worked deduction (₹10,000 credited 15-Apr, deducted 20-Jun, deposited 10-Aug) owes 1% x 3 = ₹300 and
     1.5% x 3 = ₹450, ₹750; 234E: 86 days from 01-Aug-2026 to 25-Oct-2026 x ₹200 = ₹17,200, and capped at the statement's
     TDS when 200 a day passes it
  4. duplicates: the two books deductions typed again in FinCom are one warning "Possible duplicate deductions: 2"; its panel
     pairs them; "Keep this one" takes the other out of the return (kept: Put back under Suggestions), the count goes down,
     the file no longer carries it; Put back brings it back
TDS_VALIDATE_SHOTS=dir: screenshots at 1440 and 390 (default tests/out/tds-validate)."""
import os, sys, re, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsval_case import SETUP, GO_FILE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_VALIDATE_PORT") or 8397)
SHOTS = os.environ.get("TDS_VALIDATE_SHOTS") or os.path.join(HERE, "out", "tds-validate"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
MONEY = "(v) => '₹' + INR.format(r2(v || 0))"
LINES = "(l) => [...document.querySelectorAll('#app [data-val-list=\"' + l + '\"] > li[data-val-item]:not([hidden])')].map(e => [e.dataset.valItem, e.querySelector('.vf-w').textContent, e.querySelectorAll('.vf-act button').length])"

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for W, H in ((1440, 900), (390, 844)):
            print("--- %d px" % W)
            pg = br.new_page(viewport={"width": W, "height": H}); pg.on("pageerror", lambda e: errors.append(str(e)))
            J = lambda e, a=None: pg.evaluate(e, a)
            money = lambda v: J(MONEY, v)
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
            case = SETUP(pg)
            J(GO_FILE); pg.wait_for_timeout(600)
            mobile = W < 500

            print("1. no blocker for deductions on no challan")
            errs = J(LINES, "errors")
            ok(not [e for e in errs if e[0] in ("unmatched", "leftout", "early", "stale")], "no error for rows the file leaves out (%s)" % errs)
            ok(J("+document.querySelector('#app [data-val-errors]').dataset.valErrors") == len(errs), "the errors count is the lines (%s)" % len(errs))
            loose = case["loose"]
            un = [w for w in J(LINES, "warnings") if w[0] == "unmatched"]
            tds = J("(ids) => r2(TDS.rows().filter(r => ids.includes(r.id)).reduce((a, r) => a + r.tds, 0))", loose)
            ok(un and un[0][1] == "3 deductions not in the file (no challan) · %s" % money(tds), "one warning: %s (₹%s)" % (un and un[0][1], tds))
            ok(not errs and not pg.locator('#app [data-make-fvu]').is_disabled(), "Make FVU file enabled (%s)" % errs)
            f = J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
            ok(not f.get("error") and f.get("text"), "the file is made (%s)" % (f.get("error") or "")[:120])
            lo = sorted(x["id"] for x in (f.get("leftOut") or []))
            ok(lo == sorted(loose), "the file leaves out exactly the 3 on no challan (%s)" % lo)
            ok((f.get("notes") or [""])[0].startswith("Left out of the file: 3 on no challan"), "the file's own note says so (%s)" % (f.get("notes") or [""])[0][:90])
            dd = [l.split("^") for l in f["text"].split("\r\n") if "^DD^" in l]
            want = J("(ids) => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && !ids.includes(r.id)).length", loose)
            ok(len(dd) == want == f.get("rows"), "every other deduction in the file: %d DD records (%d on a challan, %s rows)" % (len(dd), want, f.get("rows")))
            names = J("(ids) => TDS.rows().filter(r => ids.includes(r.id)).map(r => TDS26Q.fileName(r).toUpperCase())", loose)
            ok(not [n for n in names if n in f["text"].upper()], "no record of a row left out (%s)" % names)
            note = J("(document.querySelector('#app [data-file-left]') || {}).textContent || ''")
            ok(note.startswith("Left out of the file: 3 on no challan"), "the File row says what the file leaves out (%s)" % note[:80])
            pg.click('#app [data-val-review="unmatched"]'); pg.wait_for_timeout(500)
            dr = pg.locator('[data-val-drawer="unmatched"]')
            ok(dr.count() == 1 and pg.locator('[data-val-drawer="unmatched"] [data-left-row]').count() == 3 and "Put on a challan" in dr.inner_text(), "its panel lists the 3 with Put on a challan (%s)" % pg.locator('[data-left-row]').count())
            pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

            print("2. short lines")
            J(GO_FILE); pg.wait_for_timeout(400)
            ws, ins = J(LINES, "warnings"), J(LINES, "info")
            more = J("+((document.querySelector('#app [data-val-more-warn]') || {dataset: {}}).dataset.valMoreWarn || 0)")
            ok(len(ws) + (1 if more else 0) <= 5, "at most 5 warning lines (%d shown, %d more)" % (len(ws), more))
            allw = [w[1] for w in errs + ws + ins]
            ok(all(len(w) <= 70 for w in allw), "each line at most 70 characters (%s)" % [w for w in allw if len(w) > 70])
            ok(all(w[2] == 1 for w in ws + errs), "one action a line (%s)" % [w for w in ws + errs if w[2] != 1])
            sg = pg.locator('#app [data-val-sugg]')
            ok((not ins and sg.count() == 0) or sg.count() == 1 and re.fullmatch(r"Suggestions \(\d+\)", sg.locator("summary").inner_text().strip()) and not J("document.querySelector('#app [data-val-sugg]').open"), "one folded Suggestions (N) line (%s)" % (sg.locator("summary").inner_text() if sg.count() else None))
            mc = pg.locator('#app [data-val-morechecks]')
            ok(mc.count() == 1 and not J("document.querySelector('#app [data-val-morechecks]').open") and mc.locator('[data-online="prefile"]').count() == 1 and mc.locator('[data-online="ai"]').count() == 1 and mc.locator('[data-online-checks]').count() == 1,
               "Online checks, Checks before filing and the AI match under one folded More checks")
            vis = J("() => { const s = document.querySelector('#app [data-validate]'); const c = s.cloneNode(true); c.querySelectorAll('details:not([open]) > :not(summary), [data-file]').forEach(e => e.remove()); document.body.appendChild(c); const t = c.innerText; c.remove(); return t; }")
            long = [l for l in vis.split("\n") if len(l.strip()) > 90]
            ok(not long, "no long sentence on the page (%s)" % long[:2])
            if more:
                pg.click('#app [data-val-more-show]'); pg.wait_for_timeout(300)
                ok(len(J(LINES, "warnings")) == len(ws) + more and not J("document.querySelector('#app [data-val-more-warn]')"), "N more · Show: every warning (%d)" % len(J(LINES, "warnings")))
                J(GO_FILE); pg.wait_for_timeout(300)
            pg.screenshot(path=os.path.join(SHOTS, "validate-%d.png" % W), full_page=True)

            print("3. interest: the working on click")
            ok(J("document.querySelectorAll('#app [data-validate] > [data-int-sec], #app [data-validate] > .vf-int').length") == 0 and pg.locator('#app [data-int-table]').count() == 0, "no interest table on the page")
            T = J("() => TDSMatch.interestTable('26Q', '2026-27', 'Q1').totals")
            iw = [w for w in J(LINES, "warnings") if w[0] == "interest"]
            ok(iw and iw[0][1] == "Interest %s due · %s not allocated" % (money(T["interest"]), money(T["short"])), "the line: %s (%s, %s)" % (iw and iw[0][1], money(T["interest"]), money(T["short"])))
            pg.click('#app [data-val-review="interest"]'); pg.wait_for_timeout(600)
            D = '[data-val-drawer="interest"] '
            ok(pg.locator(D + '[data-int-table]').count() == 1, "Details opens the working in a side panel")
            tot = J("(d) => +document.querySelector(d + '[data-int-total]').dataset.intTotal", D)
            sh = J("(d) => +document.querySelector(d + '[data-int-short]').dataset.intShort", D)
            ok(abs(tot - T["interest"]) < 0.005 and abs(sh - T["short"]) < 0.005, "the working's total %s and not allocated %s are the line's (%s, %s)" % (tot, sh, T["interest"], T["short"]))
            rows = J("(d) => [...document.querySelectorAll(d + '[data-int-row]')].map(tr => [tr.dataset.intRow, +tr.dataset.amt, +tr.dataset.int1, +tr.dataset.int2])", D)
            ok(abs(sum(r[1] for r in rows) - tot) < 0.01 and all(abs(r[2] + r[3] - r[1]) < 0.005 for r in rows), "its rows add up to the total, each row 1%% + 1.5%% = its interest (%s rows)" % len(rows))
            due = J("(d) => +document.querySelector(d + '[data-int-due]').dataset.intDue", D)
            unp = J("(d) => { const e = document.querySelector(d + '[data-int-unpaid]'); return e ? +e.dataset.intUnpaid : 0; }", D)
            ok(abs(due + unp - tot) < 0.005, "total = on the challans %s + not yet paid %s" % (due, unp))
            hand = [r for r in rows if r[0] == case["hand"]]
            ok(hand and hand[0][1:] == [750, 300, 450], "by hand: ₹10,000 x 1%% x 3 (Apr, May, Jun) = ₹300; x 1.5%% x 3 (Jun, Jul, Aug) = ₹450; ₹750 (%s)" % hand)
            hrow = J("(a) => (document.querySelector(a[0] + '[data-int-row=\"' + a[1] + '\"]') || {}).innerText || ''", [D, case["hand"]]).replace("\n", " ").replace("\t", " ")
            ok(all(x in hrow for x in ("15-Apr-2026", "20-Jun-2026", "10-Aug-2026", "07-Jul-2026", "20090")), "its row: credited, deducted, deposited, due, the challan (%s)" % hrow)
            for r in J("(ids) => ids.map(id => { const x = TDSMatch.interestTable('26Q', '2026-27', 'Q1').rows.find(z => z.id === id + ':u'); return x ? [x.months2, x.int2, x.row.tds, x.row.date] : null; })", loose):
                today = datetime.date.today(); d = datetime.date(int(r[3][:4]), int(r[3][4:6]), int(r[3][6:]))
                m = (today.year - d.year) * 12 + today.month - d.month + 1
                ok(r and r[0] == m and abs(r[1] - round(r[2] * 0.015 * m, 2)) < 0.005, "not paid: 1.5%% x %d months (part counted whole) to today (%s)" % (m, r))
            fee = J("TDS.lateFee('2026-27', 'Q1', '20261025', '26Q')")
            ok(fee["days"] == 86 and fee["fee"] == min(17200, fee["cap"]) and fee["fee"] == 17200, "234E by hand: 01-Aug to 25-Oct-2026 = 31 + 30 + 25 = 86 days x ₹200 = ₹17,200 (%s)" % fee)
            cap = J("TDS.lateFee('2026-27', 'Q1', '20290731', '26Q')")
            ok(cap["fee"] == cap["cap"] and 200 * cap["days"] > cap["cap"], "234E capped at the statement's TDS: %s (200 x %d)" % (cap["fee"], cap["days"]))
            fw = J("(d) => (document.querySelector(d + '[data-int-feework]') || {}).textContent || ''", D)
            fd = J("TDS.lateFee('2026-27', 'Q1', '', '26Q')")
            ok(("%d day" % fd["days"]) in fw and "× ₹200" in fw and "01-Aug-2026" in fw, "the panel's 234E line: days, from, × ₹200 (%s)" % fw)
            ok("calendar months" in J("(d) => document.querySelector(d + '[data-int-law]').textContent", D), "the rule said: calendar months, a part counted whole")
            if not mobile: pg.screenshot(path=os.path.join(SHOTS, "interest-panel-%d.png" % W))
            else: pg.screenshot(path=os.path.join(SHOTS, "interest-panel-%d.png" % W), full_page=True)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
            ok(pg.locator('[data-val-drawer="interest"] [data-int-table]').count() == 0, "Esc closes it")
            pg.click('#app [data-val-morechecks] > summary'); pg.wait_for_timeout(200); pg.click('#app [data-int-open]'); pg.wait_for_timeout(500)
            ok(pg.locator('[data-val-drawer="intwork"] [data-int-table]').count() == 1, "More checks › Interest & late fee opens the same working")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

            print("4. possible duplicates")
            J(GO_FILE); pg.wait_for_timeout(400)
            dp = J("() => TDSAdd.dups('26Q', '2026-27', 'Q1').map(p => [p.b.id, p.a.id])")
            want = sorted(map(tuple, case["dups"]))
            ok(sorted(map(tuple, dp)) == want and len(want) >= 1, "found: each books deduction typed again, with it (%s, %s)" % (dp, want))
            dl = [w for w in J(LINES, "warnings") if w[0] == "dups"]
            ok(dl and dl[0][1].startswith("Possible duplicate deductions: %d · ₹" % len(want)), "one line: %s" % (dl and dl[0][1]))
            pg.click('#app [data-val-review="dups"]'); pg.wait_for_timeout(500)
            ok(pg.locator('[data-val-drawer="dups"] [data-dup-pair]').count() == len(want), "its panel pairs them (%d)" % pg.locator('[data-dup-pair]').count())
            if not mobile: pg.screenshot(path=os.path.join(SHOTS, "dups-panel-%d.png" % W))
            bid, aid = want[0]
            n0 = J("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').length")
            pg.click('[data-val-drawer="dups"] [data-dup-keep="%s"]' % bid); pg.wait_for_timeout(500)
            ok(J("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').length") == n0 - 1 and not J("(id) => TDS.rows().some(r => r.id === id)", aid) and J("(id) => TDS.rows().some(r => r.id === id)", bid),
               "Keep this one (the books'): the one added in FinCom taken out of the return")
            ok(J("(id) => !!(((S.books.tdsEdits || {})[id] || {}).f || {}).out && !!S.books.tdsAdded[id.slice(3)] && !S.books.tdsAdded[id.slice(3)].deleted", aid), "kept, not deleted: taken out with its reason")
            ok(len(J("() => TDSAdd.dups('26Q', '2026-27', 'Q1')")) == len(want) - 1, "one pair fewer")
            f2 = J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
            ok(f2.get("rows") == f.get("rows") - 1, "the file one record fewer (%s, was %s)" % (f2.get("rows"), f.get("rows")))
            # (the last pair kept: its panel closes by itself)
            if pg.locator('[data-val-drawer="dups"] [data-dup-pair]').count(): pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            J(GO_FILE); pg.wait_for_timeout(300)
            sg = pg.locator('#app [data-val-sugg]')
            ok([i for i in J(LINES, "info") if i[0] == "tdsx-out"] and sg.count() == 1 and re.fullmatch(r"Suggestions \(\d+\)", sg.locator("summary").inner_text().strip()) and not J("document.querySelector('#app [data-val-sugg]').open"),
               "Suggestions (N), folded: the one taken out, with Put back (%s)" % J(LINES, "info"))
            pg.click('#app [data-val-sugg] > summary'); pg.wait_for_timeout(200); pg.click('#app [data-val-review="tdsx-out"]'); pg.wait_for_timeout(400)
            ok("possible duplicate of" in (pg.locator('[data-val-drawer="tdsx-out"]').inner_text() if pg.locator('[data-val-drawer="tdsx-out"]').count() else ""), "its panel says why: a possible duplicate, with Put back")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            J("(id) => { TDSX.putBack(id); render(); }", aid); pg.wait_for_timeout(300)
            ok(len(J("() => TDSAdd.dups('26Q', '2026-27', 'Q1')")) == len(want), "Put back: the pair again")
            pg.close()
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
