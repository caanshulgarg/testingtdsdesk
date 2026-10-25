"""python3 run_bank_smart.py - the bank statement page made for fast work (the owner, 24-Oct-2026: "bank statement page is
very basic, no filters.. it should be smart for any person to work.. check suvit bank page.. like in particulars there
should be a filter to search UPI or IMPS or anything and we will be able to complete entry.. and page of bank statement
in 100% has minimum info.. staff is getting problem in updating that").

On a made-up HDFC statement of 300 mixed lines (tests/fixtures/bank-smart/statement300.js):
  1. density: rows fully visible at 1366x768 and 1440x900 while working (the page scrolled to the table, its header kept
     in view under the app's header), rows about 32 px, the page's own header area, no sideways scroll at 1366;
  2. the filter bar: quick chips read from the narration (UPI, IMPS, NEFT, ...) with counts, In/Out, unassigned only,
     suggestions only, date and amount ranges, ledger set or not; filters combine; the count and totals of what is shown;
  3. bulk: select all filtered, one ledger / voucher type / narration for all, Undo;
  4. a rule from the filter: the lines now open and a new upload follow it, lines set by hand do not;
  5. the keyboard: up/down, Enter opens the ledger box, type, Enter, next line; Space ticks; A accepts a suggestion;
  6. the party read from a UPI / IMPS narration matched to a Tally ledger, the suggestion accepted in one click;
  7. a phone (390): no sideways scroll of the page;
  8. the owner's first real use (25-Oct-2026, Mac Safari, an ICICI statement: "size has become too short.. I have already
     uploaded masters xml.. still it is asking again.. plus I need filters within column as earlier.. column name Type is
     overlapping"): the app's own table text and a line of about 40 px with the particulars on two lines (party; mode ·
     reference · narration), no heading or cell running into another at 1366, 1440 and 1920, the filters in the column
     headings again (combining with the chips), a ledger box on every open line, the voucher type by Dr / Cr, no "Bring in
     the Tally ledger list" when the ledgers come from the masters uploaded on Books or from FinCom's cloud copy, and ICICI's
     narrations read (tests/fixtures/bank-smart/icici83.js).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_smart.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8163), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
SETUP = open(os.path.join(HERE, "fixtures", "bank-smart", "statement300.js")).read()
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# what is on screen: rows wholly in view and not under anything (the app's header, the bar at the foot)
MEASURE = """() => {
  const vh = innerHeight, vw = innerWidth, rows = [...document.querySelectorAll('#app table.bk-table tbody tr')];
  const seen = (r) => { const b = r.getBoundingClientRect(); if (b.height <= 0 || b.top < 0 || b.bottom > vh) return false; const c = r.cells[1] || r.cells[0], x = c.getBoundingClientRect().left + 6;
    const a = document.elementFromPoint(x, b.top + 3), z = document.elementFromPoint(x, b.bottom - 3); return !!(a && z && r.contains(a) && r.contains(z)); };
  const wrap = document.querySelector('#app .bk-tablewrap'), bk = document.querySelector('#app .bk'), first = rows[0];
  const hs = rows.slice(0, 60).map(r => r.getBoundingClientRect().height).sort((a, b) => a - b);
  const led = document.querySelector('#app table.bk-table tbody tr td.lg'), ac = document.querySelector('#app table.bk-table tbody tr td.ac');
  return {rows: rows.filter(seen).length, median: hs.length ? Math.round(hs[Math.floor(hs.length / 2)]) : 0, head: bk && document.querySelector('#app table.bk-table thead') ? Math.round(document.querySelector('#app table.bk-table thead').getBoundingClientRect().top - bk.getBoundingClientRect().top) : 999,
    inner: wrap ? wrap.scrollWidth - wrap.clientWidth : 0, page: document.documentElement.scrollWidth - vw,
    ledIn: !!led && led.getBoundingClientRect().right <= vw, acIn: !!ac && ac.getBoundingClientRect().right <= vw,
    cols: [...document.querySelectorAll('#app table.bk-table thead th')].map(t => (t.innerText || '').trim()).filter(Boolean)};
}"""
TO_TABLE = "() => { const t = document.querySelector('#app table.bk-table'); const hh = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) || 0; window.scrollTo(0, t.getBoundingClientRect().top + scrollY - hh); }"
# the chips, as the page reads them (an independent copy, to count with)
CHIP_RE = {"UPI": r"\bUPI\b", "IMPS": r"\bIMPS\b|\bMMT\b", "NEFT": r"\bNEFT\b", "RTGS": r"\bRTGS\b", "Salary": r"\bSAL(ARY|ARIES)?\b", "GST": r"\b(GST|IGST|CGST|SGST|CPIN|GSTN)\b"}

def open_page(p, vp):
    pg = p.new_page(viewport=vp); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8163/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    n = pg.evaluate(SETUP); pg.wait_for_timeout(1000)
    return pg, n

with sync_playwright() as pw:
    br = pw.chromium.launch()
    # ---- 1. density ----
    # 25-Oct-2026: a line of about 40 px (was 32: "size has become too short"), so fewer in view: 12 or more at 1366x768
    for (w, h, want) in [(1366, 768, 12), (1440, 900, 15)]:
        pg, n = open_page(br, {"width": w, "height": h})
        top = pg.evaluate(MEASURE)
        pg.evaluate(TO_TABLE); pg.wait_for_timeout(400); m = pg.evaluate(MEASURE)
        ok(n == 300, "%dx%d: the statement of 300 lines is open" % (w, h))
        ok(m["rows"] >= want, "%dx%d: %d rows wholly in view while working (wanted >= %d; %d at the top of the page)" % (w, h, m["rows"], want, top["rows"]))
        ok(36 <= m["median"] <= 46, "%dx%d: a row is about 40 px (%d)" % (w, h, m["median"]))
        ok(top["head"] <= 150, "%dx%d: the page's header area (the statement, its figures, the filters) above the table: %d px (<= 150)" % (w, h, top["head"]))
        ok(top["inner"] <= 1 and top["page"] <= 0 and top["ledIn"] and top["acIn"], "%dx%d: no sideways scroll; the Ledger and the buttons in view (inner %d, page %d)" % (w, h, top["inner"], top["page"]))
        if w == 1366:
            ok(top["cols"][:8] == ["Date", "Particulars", "Withdrawal", "Deposit", "Balance", "Status", "Ledger", "Type"], "the columns: %s" % top["cols"])
            bal = pg.evaluate("() => { const r = bankVisibleRows()[0]; const tr = document.querySelector('#app tr[data-rid=\"' + r.id + '\"]'); return [money(r.balance), tr ? tr.querySelector('td.bal').innerText : '']; }")
            ok(bal[1] and bal[1].replace("₹", "").strip() in bal[0], "the running balance of a line is shown (%s)" % bal)
            tip = pg.evaluate("() => { const td = document.querySelector('#app table.bk-table tbody tr td.pt'); const r = bankRow(td.closest('tr').dataset.rid); return [td.querySelector('[title]') && td.querySelector('[title]').title === r.narr, td.querySelectorAll('.bs-narr > div').length]; }")
            ok(tip[0] and tip[1] == 2, "Particulars: two lines, and the whole narration on hover (%s)" % tip)
        pg.screenshot(path=OUT + "/bank-smart-%d.png" % w); pg.close()

    pg, n = open_page(br, {"width": 1440, "height": 900})
    app = lambda: pg.inner_text("#app")
    # the owner (24-Oct-2026): the bank page's tabs are "To do · Ready to post · Posted · Ignored"; Purchase keeps its words
    tabs = pg.evaluate("() => [...document.querySelectorAll('#app nav.statebar [data-state]')].map(t => t.innerText.replace(/\\s*\\d+$/, '').trim())")
    ok(tabs == ["To do", "Ready to post", "Posted", "Ignored"], "the bank page's tabs: To do · Ready to post · Posted · Ignored (%s)" % tabs)
    ok(pg.evaluate("pageStates('bills').length === 0 || pageStates('bills')[0][1] === 'To review'") and pg.evaluate("STATE_WORDS.review") == "To review", "Purchase and Sales keep their words")
    count_text = lambda: pg.inner_text("#app [data-f-count]").replace("\n", " ")
    shown = lambda: pg.evaluate("() => [...document.querySelectorAll('#app table.bk-table tbody tr[data-rid]')].map(tr => tr.dataset.rid)")
    # every line, whatever its state (the chips count what the tab shows)
    pg.evaluate("bankTabGo('all')"); pg.wait_for_timeout(400)
    # ---- 2. chips and counts ----
    for k, rx in CHIP_RE.items():
        want = pg.evaluate("(rx) => B().rows.filter(r => new RegExp(rx, 'i').test(r.narr)).length", rx)
        got = pg.inner_text('#app [data-chip="%s"] [data-chip-n]' % k) if pg.locator('#app [data-chip="%s"]' % k).count() else "-"
        ok(got == str(want), "chip %s counts %s lines (%d in the statement)" % (k, got, want))
    ok(pg.inner_text('#app [data-chip="UPI"] [data-chip-n]') == "100" and pg.inner_text('#app [data-chip="IMPS"] [data-chip-n]') == "30" and pg.inner_text('#app [data-chip="Salary"] [data-chip-n]') == "12",
       "the made-up statement: 100 UPI, 30 IMPS, 12 salary lines")
    pg.click('#app [data-chip="IMPS"]'); pg.wait_for_timeout(400)
    ids = shown()
    ok(len(ids) == 30 and pg.evaluate("(ids) => ids.every(id => /IMPS|MMT/.test(bankRow(id).narr))", ids) and pg.get_attribute('#app [data-chip="IMPS"]', "aria-pressed") == "true",
       "IMPS chip: the 30 IMPS lines only (%d)" % len(ids))
    ok(re.search(r"\b30 of 300\b", count_text()) and "out" in count_text() and "in" in count_text(), "the count and totals of what is shown (%s)" % count_text())
    tot = pg.evaluate("() => { const r = B().rows.filter(x => /IMPS|MMT/.test(x.narr)); return [money(r2(r.reduce((a, x) => a + num(x.debit), 0))), money(r2(r.reduce((a, x) => a + num(x.credit), 0)))]; }")
    ok(tot[0] in count_text() and tot[1] in count_text(), "the totals add up the shown lines (%s / %s)" % tuple(tot))
    pg.click('#app [data-chip="UPI"]'); pg.wait_for_timeout(400)
    ok(len(shown()) == pg.evaluate("Math.min(B().limit, B().rows.filter(r => /\\bUPI\\b|\\bIMPS\\b|\\bMMT\\b/.test(r.narr)).length)") and re.search(r"\b130 of 300\b", count_text()), "UPI and IMPS together: either (%s)" % count_text())
    # combined: + Out only + a word
    pg.click('#app [data-dir="out"]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => /\\bUPI\\b|\\bIMPS\\b|\\bMMT\\b/.test(r.narr) && r.debit > 0).length")
    ok(re.search(r"\b%d of 300\b" % want, count_text()) and pg.evaluate("(ids) => ids.every(id => bankRow(id).debit > 0)", shown()), "and Out only: %d withdrawals (%s)" % (want, count_text()))
    pg.fill('#app input[aria-label="Search the statement"]', "swiggy"); pg.wait_for_timeout(700)
    want2 = pg.evaluate("B().rows.filter(r => /\\bUPI\\b/.test(r.narr) && r.debit > 0 && /swiggy/i.test(r.narr)).length")
    ok(want2 > 0 and len(shown()) == want2 and re.search(r"\b%d of 300\b" % want2, count_text()), "and the word “swiggy”: %d lines (%s)" % (want2, count_text()))
    found = pg.inner_text('#app .bk-found:has-text("match")').replace("\n", " ")
    ok(("%d entr" % want2) in found and ("Set all %d" % want2) in found, "the search's “set them all” counts the same lines the table shows (%s)" % found[:60])
    pg.click('#app [data-f-clear]'); pg.wait_for_timeout(500)
    ok(re.search(r"\b300 of 300\b|\b300 lines\b", count_text()) and pg.input_value('#app input[aria-label="Search the statement"]') == "" and pg.get_attribute('#app [data-chip="UPI"]', "aria-pressed") == "false",
       "Clear filters: all 300 again (%s)" % count_text())
    # amount and date ranges, ledger set or not, unassigned only, suggestions only
    pg.click('#app [data-f-more] summary'); pg.wait_for_timeout(200)
    pg.fill('#app input[data-f-min]', "100000"); pg.press('#app input[data-f-min]', "Enter"); pg.wait_for_timeout(400)
    ok(pg.evaluate("(ids) => ids.length > 0 && ids.every(id => num(bankRow(id).debit || bankRow(id).credit) >= 100000)", shown()), "amount from 1,00,000: only those (%s)" % count_text())
    pg.fill('#app input[data-f-min]', ""); pg.press('#app input[data-f-min]', "Enter")
    pg.fill('#app input[data-f-from]', "2026-06-01"); pg.fill('#app input[data-f-to]', "2026-06-30"); pg.press('#app input[data-f-to]', "Enter"); pg.wait_for_timeout(400)
    ok(pg.evaluate("(ids) => ids.length > 0 && ids.every(id => bankRow(id).date >= '2026-06-01' && bankRow(id).date <= '2026-06-30')", shown()), "dates in June only (%s)" % count_text())
    pg.click('#app [data-f-clear]'); pg.wait_for_timeout(400)
    pg.check('#app input[data-f-unassigned]'); pg.wait_for_timeout(400)
    un = pg.evaluate("B().rows.filter(r => !r.ledger).length")
    ok(un > 0 and re.search(r"\b%d of 300\b" % un, count_text()) and pg.evaluate("(ids) => ids.every(id => !bankRow(id).ledger)", shown()), "Unassigned only: the %d lines with no ledger" % un)
    pg.uncheck('#app input[data-f-unassigned]'); pg.check('#app input[data-f-sugg]'); pg.wait_for_timeout(400)
    sg = pg.evaluate("B().rows.filter(r => r.state === 'suggested').length")
    ok(sg > 0 and re.search(r"\b%d of 300\b" % sg, count_text()), "Suggestions to accept: the %d suggested lines (%s)" % (sg, count_text()))
    pg.uncheck('#app input[data-f-sugg]'); pg.wait_for_timeout(300)

    # ---- 6. party read from the narration, accepted in one click ----
    ok(pg.evaluate("B().rows.filter(r => /sharmastationery@/.test(r.narr)).every(r => r.dec.name === 'SHARMA STATIONERY' && r.ledger === 'SHARMA STATIONERY')"),
       "UPI: “SHARMA STATIONERY” read from the narration and matched to its Tally ledger")
    cw = pg.evaluate("B().rows.find(r => /IMPS.*CLOUD WIZARD/.test(r.narr) && r.state === 'suggested')")
    ok(bool(cw) and cw["ledger"] == "CLOUD WIZARD CONSULTING PVT LTD", "IMPS: the bank's shortened “CLOUD WIZARD CONSULTIN” suggested as CLOUD WIZARD CONSULTING PVT LTD")
    if cw:
        pg.fill('#app input[aria-label="Search the statement"]', cw["narr"][:30]); pg.wait_for_timeout(700)
        cell = pg.inner_text('#app tr[data-rid="%s"] td.pt' % cw["id"])
        ok("CLOUD WIZARD" in cell, "the party read from the narration is shown in Particulars (%s)" % cell[:60])
        ok(pg.locator('#app tr[data-rid="%s"] button[data-accept]' % cw["id"]).is_visible(), "the suggestion shows with a one-click accept")
        pg.click('#app tr[data-rid="%s"] button[data-accept]' % cw["id"]); pg.wait_for_timeout(400)
        ok(pg.evaluate("bankRow('%s').state" % cw["id"]) == "ready", "accepted: the line is ready to post")
        pg.click('#app [data-f-clear]'); pg.wait_for_timeout(300)

    # ---- 3. bulk on what the filter shows, and Undo ----
    pg.fill('#app input[aria-label="Search the statement"]', "rajtea"); pg.wait_for_timeout(700)
    raj = shown(); before = pg.evaluate("(ids) => ids.map(id => [bankRow(id).ledger, bankRow(id).state])", raj)
    pg.click('#app [data-f-selall]'); pg.wait_for_timeout(300)
    ok(len(raj) >= 3 and pg.evaluate("B().sel.size") == len(raj), "Select all filtered: the %d RAJ TEA STALL lines ticked" % len(raj))
    pg.fill('#app .actionbar input[data-bulkled]', "Staff Welfare"); pg.click('#app .actionbar button:has-text("Apply ledger")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("(ids) => ids.every(id => bankRow(id).ledger === 'Staff Welfare' && bankRow(id).state === 'ready')", raj), "one ledger for all: Staff Welfare, ready to post")
    pg.click('#app .actionbar .bk-snack button:has-text("Undo")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("(ids) => ids.map(id => [bankRow(id).ledger, bankRow(id).state])", raj) == before, "Undo: as they were")
    # voucher type and narration for the ticked lines, undone too
    pg.click('#app [data-f-selall]'); pg.wait_for_timeout(300)
    pg.select_option('#app .actionbar select[data-bulk-vt]', "Journal"); pg.wait_for_timeout(400)
    ok(pg.evaluate("(ids) => ids.every(id => bankRow(id).vtype === 'Journal')", raj), "voucher type for all the ticked: Journal")
    pg.click('#app .actionbar .bk-snack button:has-text("Undo")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("(ids) => ids.every(id => bankRow(id).vtype !== 'Journal')", raj), "and undone")
    pg.click('#app [data-f-selall]'); pg.wait_for_timeout(300)
    pg.fill('#app .actionbar input[data-bulk-narr]', "Tea for office {month}"); pg.click('#app .actionbar button[data-bulk-narr-apply]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("(ids) => ids.every(id => /^Tea for office \\w+/.test(bankRow(id).ruleNarr || ''))", raj), "a narration for all the ticked, with {month} filled in")
    xml = pg.evaluate("(id) => bankVoucherXml(bankRow(id), {ledger: 'HDFC Bank'}, CO())", raj[0])
    ok("<NARRATION>Tea for office" in xml, "and it goes to Tally in the voucher's narration")
    pg.click('#app .actionbar .bk-snack button:has-text("Undo")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("(ids) => ids.every(id => !bankRow(id).ruleNarr)", raj), "and undone")
    # one line's voucher type, from its own column
    vid = raj[0]
    pg.select_option('#app select[data-vt="%s"]' % vid, "Contra"); pg.wait_for_timeout(300)
    ok(pg.evaluate("bankRow('%s').vtype" % vid) == "Contra", "one line's voucher type from the Type column: Contra")
    pg.click('#app [data-f-clear]'); pg.wait_for_timeout(300)

    # ---- 4. a rule from the filter: open lines and a new upload follow it, lines set by hand do not ----
    hand = pg.evaluate("B().rows.filter(r => r.narr === 'CHQ BOOK ISSUE CHARGES').map(r => r.id)")
    pg.evaluate("(id) => { bankSetLedger(id, 'Office Expenses'); }", hand[0]); pg.wait_for_timeout(400)
    hand = pg.evaluate("B().rows.filter(r => r.userSet && r.ledger === 'Office Expenses').map(r => r.id)")
    ok(len(hand) >= 1, "%d CHQ BOOK lines set by hand to Office Expenses" % len(hand))
    pg.fill('#app input[aria-label="Search the statement"]', "CHARGES"); pg.wait_for_timeout(700)
    pg.click('#app [data-dir="out"]'); pg.wait_for_timeout(300)
    pg.click('#app button[data-f-rule]'); pg.wait_for_timeout(300)
    ok(pg.locator('#app [data-rule-form]').is_visible() and pg.input_value('#app [data-rule-form] input[data-rule-text]') == "CHARGES", "Make a rule from this filter: lines containing “CHARGES”, withdrawals")
    prev = pg.inner_text('#app [data-rule-preview]')
    ok(re.search(r"\d+ lines? now", prev) and "set by hand" in prev, "it says what it will change and that lines set by hand stay (%s)" % prev)
    pg.fill('#app [data-rule-form] input[data-fk="rulefilter"]', "Bank Charges"); pg.press('#app [data-rule-form] input[data-fk="rulefilter"]', "Escape")
    pg.click('#app [data-rule-form] button[data-rule-save]'); pg.wait_for_timeout(600)
    r = pg.evaluate("clientRules()[0]")
    ok(r and r["when"]["text"][0]["v"] == "CHARGES" and r["when"]["dir"] == "out" and r["then"]["ledger"] == "Bank Charges", "the rule is kept in the client's rules (Rules tab)")
    ok(pg.evaluate("(hand) => hand.every(id => bankRow(id).ledger === 'Office Expenses' && bankRow(id).userSet)", hand), "lines set by hand keep their ledger")
    ok(pg.evaluate("() => B().rows.filter(r => /CHARGES/.test(r.narr) && r.debit && !r.userSet && r.state !== 'sent').every(r => r.ledger === 'Bank Charges' && r.ruleId === clientRules()[0].id)"),
       "the other charges lines follow the rule")
    # a new statement uploaded: its charges lines follow the rule
    csv = "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/2026,SMS CHARGES FOR QTR ENDED,,59.00,,100000.00\n02/10/2026,CHQ BOOK ISSUE CHARGES,,118.00,,99882.00\n03/10/2026,UPI/CR/412399990001/RAMESH GUPTA/HDFC/ramesh.gupta@okhdfc/Fees,,,5000.00,104882.00\n"
    pg.evaluate("() => { window.__rows300 = B().rows; }")
    pg.evaluate("(csv) => uploadStatements([new File([csv], 'hdfc-oct-2026.csv', {type: 'text/csv'})])", csv); pg.wait_for_timeout(2500)
    new = pg.evaluate("B().rows.map(r => [r.narr, r.ledger, r.ruleId === clientRules()[0].id])")
    ok(len(new) == 3 and all(x[1] == "Bank Charges" and x[2] for x in new if "CHARGES" in x[0]), "a new upload: its charges lines go to Bank Charges by the rule (%s)" % new)
    pg.evaluate("() => { const b = B(); b.cur = 'st300'; b.rows = window.__rows300; b.sel.clear(); b.undo = null; render(); }"); pg.wait_for_timeout(800)

    # ---- 4b. one line split into several ledgers ----
    pg.evaluate("() => { bankTabGo('ready'); }"); pg.wait_for_timeout(300)
    if pg.locator('#app [data-f-clear]').count(): pg.click('#app [data-f-clear]'); pg.wait_for_timeout(300)
    sp = pg.evaluate("() => { const r = bankVisibleRows().find(x => x.debit > 1000 && x.ledger && !x.tdsAtPay && !(x.splits || []).length); return r && {id: r.id, amt: r.debit, led: r.ledger}; }")
    pg.click('#app button[data-split="%s"]' % sp["id"]); pg.wait_for_timeout(300)
    ok(pg.locator('#app [data-split-editor="%s"]' % sp["id"]).is_visible(), "Split opens under the line")
    pg.fill('#app [data-split-editor] input[data-fk="split:%s:0"]' % sp["id"], "Bank Charges"); pg.press('#app [data-split-editor] input[data-fk="split:%s:0"]' % sp["id"], "Escape")
    pg.fill('#app [data-split-editor] input[aria-label="Amount of part 1"]', "100"); pg.wait_for_timeout(200)
    ok("stays with " + sp["led"] in pg.inner_text('#app [data-split-editor]'), "the rest stays with the line's own ledger")
    pg.click('#app [data-split-editor] button[data-split-save]'); pg.wait_for_timeout(400)
    parts = pg.evaluate("bankRow('%s').splits" % sp["id"])
    ok(parts == [{"ledger": "Bank Charges", "amt": 100}, {"ledger": sp["led"], "amt": round(sp["amt"] - 100, 2)}], "saved: Bank Charges 100 and the rest to %s (%s)" % (sp["led"], parts))
    xml = pg.evaluate("(id) => bankVoucherXml(bankRow(id), {ledger: 'HDFC Bank'}, CO())", sp["id"])
    amts = [float(a) for a in re.findall(r"<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>[^<]*</LEDGERNAME>\n<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-([\d.]+)</AMOUNT>", xml)]
    ok("<LEDGERNAME>Bank Charges</LEDGERNAME>" in xml and abs(sum(amts) - sp["amt"]) < 0.005, "the voucher has both ledgers and adds up (%s = %s)" % (amts, sp["amt"]))
    pg.click('#app .actionbar .bk-snack button:has-text("Undo")'); pg.wait_for_timeout(400)
    ok(not pg.evaluate("bankRow('%s').splits || []" % sp["id"]), "Undo: not split again")
    pg.click('#app button[data-split="%s"]' % sp["id"]); pg.wait_for_timeout(300)
    pg.fill('#app [data-split-editor] input[data-fk="split:%s:0"]' % sp["id"], "Bank Charges"); pg.press('#app [data-split-editor] input[data-fk="split:%s:0"]' % sp["id"], "Escape")
    pg.fill('#app [data-split-editor] input[aria-label="Amount of part 1"]', str(sp["amt"] + 1)); pg.click('#app [data-split-editor] button[data-split-save]'); pg.wait_for_timeout(400)
    ok(not pg.evaluate("bankRow('%s').splits || []" % sp["id"]), "parts that come to more than the line are refused")
    pg.click('#app [data-split-editor] button:has-text("Cancel")'); pg.wait_for_timeout(200)

    # ---- 5. the keyboard ----
    pg.evaluate("() => { bankTabGo('review'); }"); pg.wait_for_timeout(400)
    if pg.locator('#app [data-f-clear]').count(): pg.click('#app [data-f-clear]'); pg.wait_for_timeout(300)
    pg.check('#app input[data-f-unassigned]'); pg.wait_for_timeout(400)
    pg.focus('#app [data-bank-grid]'); pg.keyboard.press("ArrowDown"); pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(200)
    ids = shown(); on = pg.evaluate("() => { const tr = document.querySelector('#app tr.kb-on'); return tr && tr.dataset.rid; }")
    ok(on == ids[1], "↓ ↓: the second line is the current one (%s)" % on)
    pg.keyboard.press("ArrowUp"); pg.keyboard.press("ArrowDown"); pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(150)
    on = pg.evaluate("() => document.querySelector('#app tr.kb-on').dataset.rid")
    ok(on == ids[2], "↑ ↓ ↓: the third")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.activeElement && document.activeElement.dataset.bled") == on, "Enter opens that line's ledger box")
    pg.keyboard.type("conveyan"); pg.wait_for_timeout(300)
    ok(pg.locator("#acBox .aci").count() >= 1 and "Conveyance" in pg.inner_text("#acBox"), "typing finds the ledger (type-ahead)")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(600)
    ok(pg.evaluate("bankRow('%s').ledger" % on) == "Conveyance" and pg.evaluate("bankRow('%s').state" % on) == "ready", "Enter: Conveyance set, the line is ready")
    nxt = pg.evaluate("() => { const tr = document.querySelector('#app tr.kb-on'); return [tr && tr.dataset.rid, document.activeElement && document.activeElement.hasAttribute('data-bank-grid')]; }")
    ok(nxt[1] and nxt[0] and nxt[0] != on, "and the next line is current, ready for the next entry (%s)" % nxt)
    pg.keyboard.press(" "); pg.wait_for_timeout(200)
    ok(pg.evaluate("B().sel.has('%s')" % nxt[0]), "Space ticks the current line")
    pg.keyboard.press(" "); pg.wait_for_timeout(200)
    pg.uncheck('#app input[data-f-unassigned]'); pg.check('#app input[data-f-sugg]'); pg.wait_for_timeout(400)
    pg.focus('#app [data-bank-grid]'); pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(150)
    sid = pg.evaluate("() => document.querySelector('#app tr.kb-on').dataset.rid")
    pg.keyboard.press("a"); pg.wait_for_timeout(400)
    ok(pg.evaluate("bankRow('%s').state" % sid) == "ready", "A accepts the current line's suggestion")
    pg.uncheck('#app input[data-f-sugg]')
    ok(pg.locator('#app [data-kb-help]').count() == 1, "the keys are listed on the page")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    pg.close()

    # ---- 7. phone ----
    pg, n = open_page(br, {"width": 390, "height": 844})
    m = pg.evaluate("() => ({page: document.documentElement.scrollWidth - innerWidth, bar: !!document.querySelector('#app [data-bank-filters]'), chips: document.querySelectorAll('#app [data-chip]').length})")
    ok(m["page"] <= 0 and m["bar"] and m["chips"] >= 6, "phone 390: the filters and chips are there, and the page does not scroll sideways (%s)" % m)
    pg.click('#app [data-chip="UPI"]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.documentElement.scrollWidth - innerWidth") <= 0, "and with a chip on")
    pg.screenshot(path=OUT + "/bank-smart-390.png"); pg.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))

    # ---- 8. the owner's first real use (25-Oct-2026) ----
    ICICI = open(os.path.join(HERE, "fixtures", "bank-smart", "icici83.js")).read()
    LAYOUT = """() => {
      const t = document.querySelector('#app table.bk-table'), ths = [...t.querySelectorAll('thead th')];
      // the app's own table text: a list table drawn by the shared styles (Purchase and Sales are ListTable's table.lt)
      const probe = document.createElement('table'); probe.className = 'lt lt'; probe.innerHTML = '<thead><tr><th>h</th></tr></thead><tbody><tr><td>x</td></tr></tbody>';
      (document.querySelector('#app main') || document.querySelector('#app')).appendChild(probe);
      const app = [getComputedStyle(probe.querySelector('td')).fontSize, getComputedStyle(probe.querySelector('th')).fontSize]; probe.remove();
      const cells = [...t.querySelectorAll('thead th, tbody td')].filter(c => c.offsetParent);
      const spill = cells.filter(c => c.scrollWidth > c.clientWidth + 1).slice(0, 6).map(c => (c.className || c.tagName) + ' ' + c.innerText.slice(0, 16) + ' ' + c.scrollWidth + '>' + c.clientWidth);
      const boxes = ths.map(th => th.getBoundingClientRect()), lap = [];
      boxes.forEach((b, i) => { if (i && boxes[i - 1].right > b.left + 0.5) lap.push(ths[i - 1].innerText + '|' + ths[i].innerText); });
      // a heading's words are not cut ("Type", "Withdrawal" whole), and its funnel is inside its own cell
      const cut = ths.filter(th => { const s = th.querySelector('.lt-sort > span, .gfl'); return s && s.scrollWidth > s.clientWidth + 1; }).map(th => th.innerText);
      const fun = ths.filter(th => { const f = th.querySelector('.colf'); if (!f) return false; const a = f.getBoundingClientRect(), b = th.getBoundingClientRect(); return a.left < b.left - 0.5 || a.right > b.right + 0.5; }).map(th => th.innerText);
      const pt = t.querySelector('tbody td.pt'), rows = [...t.querySelectorAll('tbody tr[data-rid]')].slice(0, 40).map(r => r.getBoundingClientRect().height).sort((a, b) => a - b);
      const vt = [...t.querySelectorAll('tbody select.bs-vt')].slice(0, 20).map(s => s.getBoundingClientRect().width);
      return {app, td: getComputedStyle(pt).fontSize, th: getComputedStyle(ths[2]).fontSize, spill, lap, cut, fun, median: rows[Math.floor(rows.length / 2)] || 0, vtMin: Math.min(...vt),
        page: document.documentElement.scrollWidth - innerWidth, inner: (() => { const w = document.querySelector('#app .bk-tablewrap'); return w ? w.scrollWidth - w.clientWidth : 0; })()};
    }"""
    for (w, h) in [(1366, 768), (1440, 900), (1920, 1080)]:
        for fx in ("300", "icici"):
            pg, n = open_page(br, {"width": w, "height": h})
            if fx == "icici": pg.evaluate(ICICI, "books"); pg.wait_for_timeout(1500)
            m = pg.evaluate(LAYOUT)
            tag = "%d %s" % (w, fx)
            ok(m["td"] == m["app"][0] and m["th"] == m["app"][1], "%s: the app's own table text (cells %s, headings %s; the app's list tables %s)" % (tag, m["td"], m["th"], m["app"]))
            ok(36 <= m["median"] <= 46, "%s: a line of about 40 px (%d)" % (tag, m["median"]))
            ok(not m["spill"], "%s: no cell or heading runs over its column %s" % (tag, m["spill"]))
            ok(not m["lap"] and not m["cut"] and not m["fun"], "%s: the headings do not overlap, none is cut, each funnel inside its heading (%s %s %s)" % (tag, m["lap"], m["cut"], m["fun"]))
            ok(m["vtMin"] >= 84, "%s: the voucher type box holds “Payment” (%d px)" % (tag, m["vtMin"]))
            ok(m["page"] <= 0 and m["inner"] <= 1, "%s: no sideways scroll (%d, %d)" % (tag, m["page"], m["inner"]))
            if w == 1366 and fx == "icici":
                pg.evaluate(TO_TABLE); pg.wait_for_timeout(400); mm = pg.evaluate(MEASURE)
                ok(mm["rows"] >= 12, "1366x768, the ICICI statement: %d lines in view while working (>= 12)" % mm["rows"])
                pg.screenshot(path=OUT + "/bank-icici-1366.png")
            pg.close()

    # the ICICI statement, its ledgers only in the client's books (the masters XML uploaded on Books -> From Tally), as
    # Testing AAD's were on staging: no "Bring in the Tally ledger list", the list is the books' and suggestions use it
    pg, n = open_page(br, {"width": 1440, "height": 900})
    pg.evaluate(ICICI, "books"); pg.wait_for_timeout(1800)
    body = pg.inner_text("#app")
    ok("Bring in the Tally ledger list" not in body and "Import the ledger list" not in body, "masters uploaded on Books: the bank page does not ask for the ledger list again")
    ok(pg.evaluate("Ledgers.list(B().cid).length") == 12 and pg.evaluate("hasLedgerList()") and pg.evaluate("exactLedger('kumkum raghav')") == "Kumkum Raghav", "and the ledger boxes use the books' 12 ledgers")
    k = pg.evaluate("B().rows.find(r => /KumkumRagh/.test(r.narr))")
    ok(k["dec"]["mode"] == "IMPS" and k["dec"]["name"] == "KumkumRagh" and k["dec"]["utr"] == "528114093821", "ICICI MMT/IMPS: the party is the bank's “KumkumRagh”, mode IMPS, reference 528114093821 (%s)" % k["dec"])
    ok(k["state"] == "suggested" and k["ledger"] == "Kumkum Raghav", "and it is suggested as Kumkum Raghav, matched by name (%s, %s)" % (k["state"], k["ledger"]))
    inf = pg.evaluate("B().rows.find(r => /^INF\\/NEFT/.test(r.narr))")
    ok(inf["dec"]["mode"] == "NEFT" and inf["dec"]["name"] == "", "ICICI INF/NEFT: mode NEFT, no party (the bank's own transfer) (%s)" % inf["dec"])
    cell = pg.evaluate("(id) => { const td = document.querySelector('#app tr[data-rid=\"' + id + '\"] td.pt'); return [td.querySelector('.pn').innerText, td.querySelector('.l2').innerText, getComputedStyle(td.querySelector('.pn')).fontWeight, getComputedStyle(td.querySelector('.l2')).fontSize, td.querySelector('[title]').title]; }", k["id"])
    ok(cell[0] == "KumkumRagh" and int(cell[2]) >= 600, "Particulars line 1: the party, in bold (%s)" % cell[:3])
    ok(cell[1].startswith("IMPS · 528114093821 · MMT/IMPS/528114093821") and cell[3] == "12px", "line 2, small: mode · reference · narration, with spaces between them (%s)" % cell[1])
    ok(cell[4] == k["narr"], "the whole narration on hover")
    upi = pg.evaluate("() => { const r = B().rows.find(x => /^UPI\\/110860578274/.test(x.narr)); const td = document.querySelector('#app tr[data-rid=\"' + r.id + '\"] td.pt'); return td.innerText; }")
    ok(upi.split("\n")[0] == "UPIPay" and "UPI · 110860578274 · UPI/110860578274" in upi, "the owner's UPI line reads “UPIPay” / “UPI · 110860578274 · UPI/…” (%s)" % upi.replace("\n", " | "))
    # a ledger box on every open line, the voucher type by Dr / Cr
    lb = pg.evaluate("() => [...document.querySelectorAll('#app table.bk-table tbody tr[data-rid]')].map(tr => { const r = bankRow(tr.dataset.rid), i = tr.querySelector('input[data-bled]'), s = tr.querySelector('select.bs-vt'); const b = i && i.getBoundingClientRect(); return [r.state, !!i && b.width >= 120 && b.height >= 24 && getComputedStyle(i).visibility === 'visible', i ? i.placeholder : '', s ? s.value : '', r.debit > 0]; })")
    open_ = [x for x in lb if x[0] in ("attention", "suggested", "ready")]
    ok(len(open_) > 20 and all(x[1] for x in open_), "a ledger box (type to search) shows on each of the %d open lines" % len(open_))
    ok(all(x[2] == "Choose ledger" for x in open_ if x[0] == "attention"), "a line with no ledger says “Choose ledger” in its box")
    ok(all(x[3] == ("Payment" if x[4] else "Receipt") for x in open_), "Type: Payment for a withdrawal, Receipt for a deposit")
    pg.click('#app tr[data-rid="%s"] button[data-accept]' % k["id"]); pg.wait_for_timeout(400)
    ok(pg.evaluate("bankRow('%s').state" % k["id"]) == "ready", "the suggestion is accepted in one click")
    # the filters in the column headings, as before, with the chips
    heads = pg.evaluate("() => [...document.querySelectorAll('#app table.bk-table thead th')].filter(th => th.querySelector('.colf')).map(th => th.innerText.trim())")
    ok(heads == ["Date", "Particulars", "Withdrawal", "Deposit", "Balance", "Status", "Ledger", "Type"], "a filter in each column's heading: %s" % heads)
    count_text = lambda: pg.inner_text("#app [data-f-count]").replace("\n", " ")
    pg.evaluate("bankTabGo('all')"); pg.wait_for_timeout(300)
    pg.click('#app th .colf[data-colf="narr"]'); pg.wait_for_timeout(300)
    pg.fill('#colpop input[data-pf="narr"]', "MMT"); pg.wait_for_timeout(600); pg.click('#colpop [data-cpapply]' if pg.locator('#colpop [data-cpapply]').count() else '#colpop [data-cpclose]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => /mmt/i.test(r.narr)).length")
    ok(want > 0 and len(shown()) == want and re.search(r"\b%d of 83\b" % want, count_text()), "Particulars has “MMT” (its heading's filter): %d lines (%s)" % (want, count_text()))
    ok(pg.locator('#app [data-fchip="narr"]').count() == 1, "and its chip shows over the table, with ✕")
    pg.click('#app th .colf[data-hf="vt"]'); pg.wait_for_timeout(300)
    pg.check('#app [data-hf-pop="vt"] input[data-hf-v="Receipt"]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => /mmt/i.test(r.narr) && (r.vtype || (r.debit ? 'Payment' : 'Receipt')) === 'Receipt').length")
    ok(want > 0 and len(shown()) == want and pg.evaluate("(ids) => ids.every(id => bankRow(id).credit > 0)", shown()), "and Type is Receipt: %d deposits (%s)" % (want, count_text()))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # the heading's filter off, the UPI chip on: the chip and Type = Receipt together
    pg.click('#app [data-fchip="narr"] .bs-fx'); pg.wait_for_timeout(400)
    pg.click('#app [data-chip="UPI"]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => /\\bUPI\\b/.test(r.narr) && (r.vtype || (r.debit ? 'Payment' : 'Receipt')) === 'Receipt').length")
    ok(want > 0 and len(shown()) == want and re.search(r"\b%d of 83\b" % want, count_text()), "the UPI chip with Type = Receipt: the %d UPI deposits (%s)" % (want, count_text()))
    pg.click('#app [data-chip="UPI"]'); pg.wait_for_timeout(300)
    pg.click('#app [data-fchip="vt"] .bs-fx'); pg.wait_for_timeout(300)
    pg.click('#app th .colf[data-colf="narr"]'); pg.wait_for_timeout(300)
    pg.fill('#colpop input[data-pf="narr"]', "MMT"); pg.wait_for_timeout(600); pg.click('#colpop [data-cpapply]' if pg.locator('#colpop [data-cpapply]').count() else '#colpop [data-cpclose]'); pg.wait_for_timeout(400)
    pg.click('#app th .colf[data-hf="st"]'); pg.wait_for_timeout(300)
    pg.check('#app [data-hf-pop="st"] input[data-hf-v="suggested"]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => /mmt/i.test(r.narr) && r.state === 'suggested').length")
    ok(want > 0 and len(shown()) == want and pg.evaluate("(ids) => ids.every(id => bankRow(id).state === 'suggested')", shown()), "Status is Suggested: %d lines (%s)" % (want, count_text()))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # nothing matches: the headings (and their filters) stay, to change them
    pg.evaluate("() => { const b = B(); b.f = Object.assign({}, b.f, {sts: ['ignored']}); render(); }"); pg.wait_for_timeout(400)
    ok(len(shown()) == 0 and pg.locator('#app table.bk-table thead th .colf').count() == 8 and pg.locator('#app [data-list-empty]').count() == 1, "nothing matches: the headings and their filters stay")
    pg.evaluate("() => { const b = B(); b.f = Object.assign({}, b.f, {sts: ['suggested']}); render(); }"); pg.wait_for_timeout(300)
    pg.click('#app [data-fchip="st"] .bs-fx'); pg.click('#app [data-fchip="narr"] .bs-fx'); pg.wait_for_timeout(400)
    pg.click('#app th .colf[data-hf="bal"]'); pg.wait_for_timeout(300)
    pg.fill('#app [data-hf-pop="bal"] input[data-hf-min]', "1000000"); pg.click('#app [data-hf-pop="bal"] [data-hf-apply]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => r.balance >= 1000000).length")
    ok(want > 0 and len(shown()) == want and re.search(r"\b%d of 83\b" % want, count_text()), "Balance from 10,00,000: %d lines (%s)" % (want, count_text()))
    pg.keyboard.press("Escape")
    pg.click('#app th .colf[data-colf="led"]'); pg.wait_for_timeout(300)
    pg.check('#colpop input[data-pf="led"][value="set"]'); pg.wait_for_timeout(600); pg.click('#colpop [data-cpapply]' if pg.locator('#colpop [data-cpapply]').count() else '#colpop [data-cpclose]'); pg.wait_for_timeout(400)
    want = pg.evaluate("B().rows.filter(r => r.balance >= 1000000 && r.ledger).length")
    ok(len(shown()) == want and pg.locator('#app [data-fchip="led"]').count() == 1, "and Ledger chosen: %d lines (%s)" % (want, count_text()))
    pg.click('#app [data-f-clear]'); pg.wait_for_timeout(400)
    ok(re.search(r"\b83 of 83\b", count_text()) and not pg.locator('#app [data-fchip]').count(), "Clear filters clears the headings' filters too (%s)" % count_text())
    pg.screenshot(path=OUT + "/bank-icici-1440.png"); pg.close()

    # the ledgers in FinCom's cloud copy: no banner either; and with none anywhere the banner is still there
    for src, want in (("cloud", False), ("none", True)):
        pg, n = open_page(br, {"width": 1440, "height": 900})
        pg.evaluate(ICICI, src); pg.wait_for_timeout(1800)
        has = "Bring in the Tally ledger list" in pg.inner_text("#app")
        ok(has == want, "ledgers %s: “Bring in the Tally ledger list” %s" % ({"cloud": "in FinCom's cloud copy", "none": "nowhere"}[src], "shown" if want else "not shown"))
        pg.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
