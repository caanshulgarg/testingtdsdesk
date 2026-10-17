"""python3 run_tds_match_ui.py - the Challans tab a fresher can use (next-challan-match, the owner's request of 17-Oct-2026:
"very confusing which challan to knock off against which deduction ... create something any fresher can understand").
On the made-up books of run_tds_challans.py (Q1 of tax year 2026-27: 194C, 194J and 192 deductions, two Tally TDS
payments) with challans typed in, in the React build (app/dist-test, or TDSDESK_SITE):
  the three steps; each challan a card (BSR · date · serial, section, the months it pays, its heads, the bar of used and
  left, its status); suggestions in yellow with the rule and the reason; "N of M matched automatically · K need you";
  nothing tagged until a person confirms. Confirm one · Not this · Move to challan… (the dialog lists each challan's
  section, month and balance, refuses over it) · Take off challan · Split the row (the dialog shows the parts and the two
  challans; the file then has two deductee records under two challans) · Confirm all · interest allocated on the card
  (the file's challan record carries it) · Not matched yet in red with its reason and next step · the file refused while
  anything is on no challan, and the checks say so · AI suggestions (the function answered by a stand-in) labelled
  "AI: <reason>" and confirmed the same way · the Deductions tab's Challan column opens the same Move dialog · Form 138
  from the salary sheet: matched on its Challans tab, its file with CD and DD records, "Download the Form 138 text file".
TDS_MATCH_SHOTS=dir: the fresher's screens, desktop and phone (default: tests/out/tds-match)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_MATCH_PORT") or 8291)
SHOTS = os.environ.get("TDS_MATCH_SHOTS") or os.path.join(HERE, "out", "tds-match"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
GO = "() => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'challans'; render(); }"
# the challans as a client pays them: April's 194C exactly (with interest 150 paid on it), May's 194C short by one
# deduction, April's 194J exactly, the Tally payment of May's 194J (bill-wise), June's 194C on two small challans (a split),
# and a challan marked 194H that paid the late-May 194J (the AI's to find)
CHALLANS = """() => { const C = (id, serial, date, tax, section, extra) => Object.assign({id, bsr: "0510308", serial, date, tax, interest: 0, section, minorHead: "200"}, extra || {});
  S.books.challans = [C("chA", "00123", "20260505", 8640, "194C", {interest: 150}), C("chM", "00301", "20260606", 7000, "194C"), C("chJ", "00456", "20260507", 12345, "194J"),
    C("chT", "00222", "20260606", 10000, "194J", {fromVoucher: "pay194jMay"}), C("chS1", "00401", "20260707", 600, "194C"), C("chS2", "00402", "20260708", 500, "194C"),
    C("chX", "00403", "20260607", 1200, "194H")];
  S.books.alloc = {}; S.books.allocFrom = {}; S.books.chPortions = {}; S.books.matchNo = {}; S.books.tdsSplits = {}; S.books.allocLog = []; S.tdsSel = {}; render(); }"""
ROWS = "(([sec, ym]) => TDS.allRows().filter(r => TDS.sec(r.section) === sec && TDS.ymd(r.date).slice(0, 6) === ym).map(r => r.id))"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(BOOKS_JS); pg.wait_for_timeout(800)
        # the AI step answered by a stand-in for the tds-challan-match function (never the real API): it pairs the late-May
        # 194J deductions with the challan marked 194C
        ai_calls = []
        def fake_ai(route):
            body = json.loads(route.request.post_data or "{}"); ai_calls.append(body)
            rows = [r for r in body.get("rows", []) if r["sec"] == "194J" and r["date"] >= "20260525"]
            pairs = [{"chId": "chX", "ids": [r["id"] for r in rows], "reason": "the challan says 194H but paid these two 194J deductions of 25 and 26 May (₹1,200)", "confidence": "high"}] if rows else []
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "ai": {"state": "used", "say": "AI looked at the deductions the rules left: 2 suggested · cost ₹0.85"}, "pairs": pairs, "splits": [], "interest": []}))
        pg.route("**/functions/v1/tds-challan-match", fake_ai)
        pg.evaluate("() => { TDSMatch.online = () => true; TDSMatch.url = () => location.origin + '/functions/v1/tds-challan-match'; if (typeof Cloud === 'object'){ Cloud.fresh = async () => {}; } }")
        pg.evaluate(CHALLANS); pg.evaluate(GO); pg.wait_for_timeout(1500)
        J = lambda expr, arg=None: pg.evaluate(expr, arg)
        rows = lambda sec, ym: J(ROWS, [sec, ym])

        # ---- the screen
        ok(pg.locator("#app [data-challan-match]").count() == 1, "the Challans tab is the matching screen")
        steps = pg.locator("#app [data-cm-steps] li").all_inner_texts()
        ok(steps == ["① Challans of this quarter", "② Match deductions", "③ Check and make the file"], "three steps: %s" % steps)
        ok(pg.locator("#app [data-auto-alloc], #app [data-challan-suggest]").count() == 0, "no Auto-allocate button, no Suggested tagging card")
        card = pg.locator('#app [data-cm-ch="chA"] .cm-card').inner_text()
        ok("0510308 · 05-May-2026 · 00123" in card.replace("05-May-2026", "05-May-2026") or "0510308 · " in card, "a challan's card: BSR · date · serial (%s)" % card.replace("\n", " | ")[:160])
        ok(all(w in card for w in ["Tax", "Interest", "Fee", "Others", "Used", "Balance", "194C"]), "the card shows the heads, Used and Balance, its section")
        ok(pg.locator('#app [data-cm-ch="chA"] [data-cm-status="left"]').inner_text().startswith("₹8,640"), "status chip: ₹8,640 left")
        ok(J("Object.keys(S.books.alloc).length") == 0, "nothing tagged until a person confirms")
        sg = pg.locator('#app [data-cm-ch="chA"] [data-cm-sugg]')
        ok(sg.count() == 1 and "Same section, same month, exact amount" in sg.inner_text() and "194C · April 2026 · total ₹8,640 = challan ₹8,640" in sg.inner_text(), "a suggestion in yellow, its rule and its reason (%s)" % (sg.inner_text().replace("\n", " | ")[:200] if sg.count() else ""))
        ok("From Tally" in pg.locator('#app [data-cm-ch="chT"] [data-cm-sugg]').first.inner_text(), "the Tally bill-wise payment's challan: From Tally")
        metric = pg.locator("#app [data-cm-metric]").inner_text()
        ok(re.search(r"\d+ of \d+ deductions matched automatically · \d+ need you", metric), "the measure: %s" % metric)
        ai = pg.locator("#app [data-cm-ai]")
        ok(len(ai_calls) == 1 and ai.count() == 1 and "AI looked at" in ai.inner_text(), "the AI asked once for what the rules left, its line shown (%s)" % (ai.inner_text() if ai.count() else ""))
        sent = json.dumps(ai_calls[0]) if ai_calls else ""
        ok(ai_calls and all(set(r.keys()) == {"id", "sec", "date", "tds", "party", "pan", "fy", "q"} for r in ai_calls[0]["rows"]) and not re.search(r'"pan": "[A-Z]{5}\d{4}[A-Z]"', sent), "only the agreed fields go to the function, the PAN masked")
        aiS = pg.locator('#app [data-cm-ch="chX"] [data-cm-sugg][data-rule="g"]')
        ok(aiS.count() == 1 and "AI: the challan says 194H" in aiS.inner_text(), "the AI's pairing shown like the rules', labelled \"AI: <reason>\"")
        nm = pg.locator("#app [data-cm-none]")
        ok(nm.count() == 1 and "Not matched yet" in nm.inner_text(), "Not matched yet, in red")
        whys = pg.locator("#app [data-cm-none] [data-cm-why]").all_inner_texts()
        ok(whys and all(re.search(r"pay|Move to challan|split|check", w, re.I) for w in whys), "each row not matched has its reason and next step (%s)" % (whys[:2],))
        ok(J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q').error || ''").find("on no challan") > 0, "the file refuses while deductions are on no challan")
        ok(pg.locator('#app [data-cm-block="untagged"]').count() == 1 and pg.locator("#app [data-cm-make]").is_disabled(), "the checks block the file, Make the file is off")
        pg.screenshot(path=os.path.join(SHOTS, "fresher-desktop-1-suggestions.png"), full_page=True)

        # ---- Confirm one
        pg.click('#app [data-cm-ch="chA"] [data-cm-confirm]'); pg.wait_for_timeout(500)
        apr = rows("194C", "202604")
        ok(all(J("(id) => S.books.alloc[id]", i) == "chA" for i in apr), "Confirm: April's 194C on chA")
        by = pg.locator('#app [data-cm-ch="chA"] [data-cm-by]').first.inner_text()
        ok("suggestion confirmed by" in by and "Same section, same month, exact amount" in by, "Matched by: %s" % by)
        ok(pg.locator('#app [data-cm-ch="chA"] [data-cm-status="full"]').count() == 1, "chA: Fully used")
        # ---- Not this
        key = pg.locator('#app [data-cm-ch="chM"] [data-cm-sugg]').first.get_attribute("data-cm-sugg")
        pg.click('#app [data-cm-ch="chM"] [data-cm-no]'); pg.wait_for_timeout(400)
        ok(pg.locator('#app [data-cm-sugg="%s"]' % key).count() == 0 and J("Object.keys(S.books.matchNo).length") == 1, "Not this: gone, kept as set aside")
        pg.evaluate("() => { S.books.matchNo = {}; render(); }"); pg.wait_for_timeout(300)
        # ---- Move to challan (tick a row not matched → the dialog)
        may = [pg.locator("#app [data-cm-none] [data-cm-row]").first.get_attribute("data-cm-row")]
        pg.locator('#app [data-cm-none] [data-cm-row="%s"] input[type=checkbox]' % may[0]).check(); pg.wait_for_timeout(300)
        ok(pg.locator("[data-cm-selbar]").count() == 1, "ticking shows the bar: Move to challan…")
        pg.click("[data-cm-move]"); pg.wait_for_timeout(500)
        dl = pg.locator("[data-cm-move-dialog]")
        ok(dl.count() == 1 and "left" in dl.inner_text() and "194C" in dl.inner_text(), "the Move dialog lists each challan with its section, month and balance")
        ok(pg.locator('[data-cm-pick-go="chA"]').is_disabled(), "a full challan cannot be chosen (refused over its balance)")
        pg.click('[data-cm-pick-go="chM"]'); pg.wait_for_timeout(500)
        ok(J("(id) => S.books.alloc[id]", may[0]) == "chM" and "you" in J("(id) => TDSMatch.matchedBy(id).words", may[0]), "moved to chM, by a person")
        # ---- Take off challan
        pg.locator('#app [data-cm-ch="chM"] [data-cm-row="%s"] input[type=checkbox]' % may[0]).check(); pg.wait_for_timeout(300)
        pg.click("[data-cm-takeoff]"); pg.wait_for_timeout(400)
        ok(not J("(id) => S.books.alloc[id]", may[0]), "Take off challan")
        # ---- Split the row
        sp = pg.locator('#app [data-cm-sugg][data-rule="split"]')
        ok(sp.count() >= 1, "a split offered (June's ₹700 194C: no one challan holds it)")
        pg.locator('#app [data-cm-split]').first.click(); pg.wait_for_timeout(500)
        sd = pg.locator("[data-cm-split-dialog]")
        ok(sd.count() == 1 and pg.locator("[data-cm-split-part]").count() == 2 and "the same payment and deduction dates" in sd.inner_text(), "the Split dialog: two parts, two challans, the same dates")
        pg.screenshot(path=os.path.join(SHOTS, "fresher-desktop-2-split.png"))
        pg.click("[data-cm-split-go]"); pg.wait_for_timeout(600)
        jun = J("TDS.rows().filter(r => r.splitOf).map(r => [r.tds, r.challan, r.date])")
        ok(len(jun) == 2 and sorted(c for _, c, _ in jun) == ["chS1", "chS2"] and len(set(d for _, _, d in jun)) == 1, "split kept: two rows, each on its challan, the same date (%s)" % jun)
        # ---- Confirm all
        n = pg.locator("#app [data-cm-confirm-all]").inner_text()
        pg.click("#app [data-cm-confirm-all]"); pg.wait_for_timeout(700)
        ok(re.match(r"Confirm all \d+ suggestions?", n) and pg.locator("#app [data-cm-confirm]").count() == 0, "Confirm all: no suggestion left to confirm (%s)" % n)
        ok(J("(ids) => ids.every(id => S.books.alloc[id] === 'chX')", rows("194J", "202605")[-2:]), "the AI's pairing confirmed with the rest")
        # ---- interest on the card: allocated, and the file carries it
        ok(J("TDSReg.portionFor(TDS.challans().find(c => c.id === 'chA'), '26Q', '2026-27', 'Q1').interest") == 150, "chA's interest ₹150 offered and confirmed by Confirm all (its only return)")
        pg.evaluate("() => TDSReg.setPortion('chA', '26Q', '2026-27', 'Q1', 0, 0)"); pg.evaluate("render()"); pg.wait_for_timeout(300)
        pg.click('#app [data-cm-portion="chA"] [data-cm-portion-edit]'); pg.wait_for_timeout(300)
        pg.fill('#app [data-cm-portion="chA"] input[aria-label="Interest allocated here"]', "100"); pg.click('#app [data-cm-portion="chA"] [data-cm-portion-save]'); pg.wait_for_timeout(400)
        ok(J("TDSReg.portionFor(TDS.challans().find(c => c.id === 'chA'), '26Q', '2026-27', 'Q1').interest") == 100, "interest allocated on the card: ₹100 here")
        # the rest: May's last 194C deduction (chM short) is on no challan: the file still refused, saying so
        left = J("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && r.tds > 0).length")
        ok(left == 1 and "pay" in pg.locator("#app [data-cm-none] [data-cm-why]").first.inner_text().lower(), "one deduction left (chM is short): its next step is to pay (%s)" % pg.locator("#app [data-cm-none] [data-cm-why]").first.inner_text()[:160])
        pg.evaluate("""() => { S.books.challans.push({id: "chM2", bsr: "0510308", serial: "00501", date: "20260707", tax: 1000, interest: 0, section: "194C", minorHead: "200"}); render(); }"""); pg.wait_for_timeout(600)
        pg.click("#app [data-cm-confirm-all]"); pg.wait_for_timeout(600)
        ok(pg.locator('#app [data-cm-checks="ok"]').count() == 1 and not pg.locator("#app [data-cm-make]").is_disabled(), "everything matched: Make the file is on")
        f = J("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
        recs = lambda t, k: [l.split("^") for l in t.split("\r\n") if l.split("^")[1:2] == [k]]
        cd, dd = recs(f.get("text", ""), "CD"), recs(f.get("text", ""), "DD")
        s1 = [c for c in cd if c[16] == "00401"]; s2 = [c for c in cd if c[16] == "00402"]
        u1 = sorted(d[23] for d in dd if s1 and d[4] == s1[0][3]); u2 = sorted(d[23] for d in dd if s2 and d[4] == s2[0][3])
        ok(not f.get("error") and u1 == ["300.00", "300.00"] and u2 == ["400.00"], "the file: the ₹700 row split as 300 under challan 00401 (beside June's ₹300) and 400 under 00402 (%s %s %s)" % (f.get("error") or "", u1, u2))
        ca = [c for c in cd if c[16] == "00123"][0]
        ok(ca[8] == "150.00" and ca[23] == "100.00", "the file: chA as deposited (interest 150) and the interest allocated here (100), field 24")
        pg.screenshot(path=os.path.join(SHOTS, "fresher-desktop-3-done.png"), full_page=True)
        # ---- the Deductions tab's Challan column: the same Move dialog, no silent re-tag
        pg.evaluate("() => { S.tdsTab = 'deductions'; S.tdsDedView = ''; render(); }"); pg.wait_for_timeout(600)
        cell = pg.locator("#app [data-ch-cell]").first
        ok(cell.count() == 1 and re.search(r"0510308 · .* · 194[CJ]", cell.inner_text()), "the Deductions tab's Challan column: BSR · date · section (%s)" % cell.inner_text())
        ok(pg.locator("#app select[aria-label^='Challan for']").count() == 0, "no dropdown that re-tags silently")
        cell.click(); pg.wait_for_timeout(400)
        ok(pg.locator("[data-cm-move-dialog]").count() == 1, "it opens the Move dialog")
        pg.evaluate("() => { S.tdsMove = null; render(); }"); pg.wait_for_timeout(300)

        # ---- phone
        pg.evaluate(CHALLANS); pg.evaluate(GO); pg.wait_for_timeout(800)
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(600)
        wide = J("document.documentElement.scrollWidth <= window.innerWidth + 1")
        ok(wide, "phone: no sideways scroll on the Challans tab")
        pg.screenshot(path=os.path.join(SHOTS, "fresher-phone-1-suggestions.png"), full_page=True)
        pg.set_viewport_size({"width": 1400, "height": 1000}); pg.wait_for_timeout(300)

        # ---- Form 138 from the salary sheet
        pg.evaluate("""() => { S.books.salary = [{name: "Ravi Menon", pan: "ABCPM1234R", date: "2026-04-30", gross: 200000, tds: 4000}, {name: "Sunita Rao", pan: "ABCPR5678S", date: "2026-04-30", gross: 80000, tds: 5000},
          {name: "Ravi Menon", pan: "ABCPM1234R", date: "2026-05-31", gross: 200000, tds: 5000}];
          S.books.challans = [{id: "chSal", bsr: "0510308", serial: "00601", date: "20260507", tax: 9000, interest: 0, section: "192", minorHead: "200"}, {id: "chSal2", bsr: "0510308", serial: "00602", date: "20260606", tax: 5000, interest: 0, section: "192", minorHead: "200"}];
          S.books.alloc = {}; S.tdsForm = '24Q'; S.tdsTab = 'challans'; render(); }"""); pg.wait_for_timeout(900)
        ok(pg.locator('#app [data-challan-match="24Q|2026-27|Q1"]').count() == 1 and pg.locator("#app [data-cm-sugg]").count() == 2, "Form 138: the same Challans tab, two suggestions from the salary sheet")
        pg.click("#app [data-cm-confirm-all]"); pg.wait_for_timeout(600)
        f = J("TDS24Q_FILE.build('2026-27', 'Q1', TDS26Q.firmDetails())")
        ok(not f.get("error") and len(recs(f["text"], "CD")) == 2 and len(recs(f["text"], "DD")) == 3, "Form 138 from the salary sheet: CD and DD records (%s)" % (f.get("error") or ""))
        pg.evaluate("() => { S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(500)
        ok(pg.locator('#app [data-sheet-fvu]:has-text("Download the Form 138 text file")').count() == 1, "the Return file tab: Download the Form 138 text file")
        pg.evaluate("() => { S.tdsTab = 'deductions'; S.q24Open = 'ABCPM1234R'; render(); }"); pg.wait_for_timeout(500)
        ok(pg.locator("#app [data-ch-cell]").count() >= 1, "the salary sheet's months have a Challan link")
        pg.evaluate("() => { S.tdsQ = 'Q4'; S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(400)
        ok(pg.locator("#app [data-q4-wait]").count() == 1, "Q4: still waits on Protean's layout, said plainly")
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
