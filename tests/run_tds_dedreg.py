"""python3 run_tds_dedreg.py - next-tds-register (20-Oct-2026, the owner): the return's Deductions register.
On the made-up books of run_tds_challans.py (Q1 2026-27):
  1. every deduction on a challan says how it was placed (from the allocation trail): a rule by its short name ("Tally
     link", "Same amount"), AI (its reason on a hover) or By hand (who and when); filterable in its column header;
  2. a Verified tick per row and in bulk, kept with the books; a rule's or the AI's row not verified says "to check";
     the filter "AI, not verified";
  3. "Deductions N" on the return opens the register: Pending (on no challan) and Mapped (on a challan: serial · date,
     how placed, verified); ticks to map / move / remove in bulk; a row mapped, moved or taken off moves between the tabs
     at once;
  4. the register is the one place for the deductions on no challan: Select challan has no "Not on any challan".
Screenshots: tests/out/tds-dedreg."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8265
SHOTS = os.path.join(HERE, "out", "tds-dedreg"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
m = open(os.path.join(HERE, "run_tds_match_ui.py")).read()
_k = m.index('CHALLANS = """') + len('CHALLANS = """')
CHALLANS = m[_k:m.index('"""', _k)]
GO = "() => { S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = 'deductions'; S.tdsDedView = ''; S.tdsWinCh = ''; S.tdsCF = {}; S.tdsDedReg = ''; render(); }"
IDS = "([sec, ym]) => TDS.rows().filter(r => r.fy === '2026-27' && TDS.sec(r.section) === sec && TDS.ymd(r.date).slice(0, 6) === ym).map(r => r.id)"
ROWS = "(tab) => [...document.querySelectorAll('[data-dreg-body=\"' + tab + '\"] tbody tr[data-dreg-row]')].map(tr => tr.dataset.dregRow)"
HOW = "() => Object.fromEntries([...document.querySelectorAll('[data-dreg-body=\"mapped\"] tbody tr[data-dreg-row]')].map(tr => { const h = tr.querySelector('[data-dreg-how]'); return [tr.dataset.dregRow, h ? [h.dataset.dregHow, h.innerText.trim(), h.title || ''] : null]; }))"
CHECK = "() => Object.fromEntries([...document.querySelectorAll('[data-dreg-body=\"mapped\"] tbody tr[data-dreg-row]')].map(tr => [tr.dataset.dregRow, !!tr.querySelector('[data-dreg-tocheck]')]))"
COUNTS = "() => Object.fromEntries([...document.querySelectorAll('[data-dreg-tab]')].map(b => [b.dataset.dregTab, +b.dataset.dregN]))"

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    J = lambda e, a=None: pg.evaluate(e, a)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    J(BOOKS_JS); pg.wait_for_timeout(600); J("() => { TDSMatch.online = () => false; }"); J(CHALLANS); pg.wait_for_timeout(300)
    # placed three ways: April's 194C by hand on chA; April's 194J by the rule "Same amount" (chJ, confirmed); the four
    # bill-wise 194J of May by Tally's link (chT, confirmed); May's last two 194J by the AI (on chX, its reason kept)
    hand, rule, ai = J(IDS, ["194C", "202604"]), J(IDS, ["194J", "202604"]), J(IDS, ["194J", "202605"])[-2:]
    J("(ids) => TDSMatch.move(ids, 'chA')", hand)
    sg = J("() => TDSMatch.suggestNow('26Q', '2026-27', 'Q1').filter(s => s.chId === 'chJ' || s.chId === 'chT').map(s => [s.key, s.rule, s.ids])")
    for (k, r, ids) in sg: J("(k) => TDSMatch.confirm(k, '26Q', '2026-27', 'Q1')", k)
    tally = next((ids for (k, r, ids) in sg if r == "a"), [])
    J("(ids) => TDSCH.tag(ids, 'chX', {via: 'suggestion', note: 'suggestion confirmed: AI (the narration names May professional fees)'})", ai)
    J("() => { TDSReg.forget(); render(); }")
    n = J("() => TDS.formRows('26Q').filter(r => r.fy === '2026-27' && r.q === 'Q1').length")

    print("1. Deductions N opens the register")
    J(GO); pg.wait_for_timeout(600)
    btn = J("() => { const b = document.querySelector('#app [data-dreg-open]'); return b ? b.innerText.trim() : ''; }")
    ok(btn == "Deductions %d" % n, "the return's button: Deductions %d (%s)" % (n, btn))
    opts = J("() => [...document.querySelectorAll('#app select[data-wd-sel] option')].map(o => o.value)")
    ok("__none" not in opts, "Select challan has no 'Not on any challan' (%s)" % opts)
    pg.click('#app [data-dreg-open]'); pg.wait_for_timeout(600)
    cnt = J(COUNTS)
    placed = J("() => TDS.formRows('26Q').filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan).length")
    ok(cnt.get("mapped") == placed and cnt.get("pending") == n - placed, "two tabs: Pending %s, Mapped %s (%d placed of %d)" % (cnt.get("pending"), cnt.get("mapped"), placed, n))
    ok(len(J(ROWS, "pending")) == n - placed, "Pending lists the deductions on no challan (%d)" % len(J(ROWS, "pending")))
    pg.screenshot(path=os.path.join(SHOTS, "pending.png"))

    print("2. Mapped: challan, how placed, verified")
    pg.click('[data-dreg-tab="mapped"]'); pg.wait_for_timeout(400)
    how = J(HOW)
    pg.screenshot(path=os.path.join(SHOTS, "mapped.png"))
    ok(len(how) == placed, "Mapped lists every deduction on a challan (%d)" % len(how))
    ok(all(how[i] and how[i][0] == "hand" and how[i][1] == "By hand" for i in hand), "by hand: 'By hand' (%s)" % [how.get(i) for i in hand[:2]])
    ok(all(how[i] and how[i][0] == "rule" and how[i][1] == "R2 · Same amount" for i in rule), "the rule with its code (next-tds-autoplace): 'R2 · Same amount' (%s)" % [how.get(i) for i in rule[:2]])
    ok(tally and all(how[i] and how[i][0] == "rule" and how[i][1] == "R1 · Tally link" for i in tally), "Tally's link: 'R1 · Tally link' (%s)" % [how.get(i) for i in tally[:2]])
    ok(all(how[i] and how[i][0] == "ai" and how[i][1] == "R9 · AI" and "narration names May" in how[i][2] for i in ai), "the AI: 'R9 · AI', its reason on a hover (%s)" % [how.get(i) for i in ai])
    chk = J(CHECK)
    ok(all(chk[i] for i in rule + ai + tally) and not any(chk[i] for i in hand), "a rule's or the AI's row not verified says 'to check'; by hand does not")
    cell = J("(id) => (document.querySelector('[data-dreg-body=\"mapped\"] tr[data-dreg-row=\"' + CSS.escape(id) + '\"] [data-dreg-ch]') || {}).innerText || ''", hand[0])
    ok("00123" in cell and "05-May" in cell, "the challan's serial and date (%s)" % cell)
    # the How placed filter, and "AI, not verified"
    pg.click('[data-dreg-body="mapped"] thead [data-cf="dreg-m:how"]'); pg.wait_for_timeout(200)
    pg.click('[data-cf-pop="dreg-m:how"] [data-cf-v="R9 · AI"]'); pg.wait_for_timeout(300); pg.keyboard.press("Escape")
    ok(sorted(J(ROWS, "mapped")) == sorted(ai), "the How placed filter: AI only (%s)" % J(ROWS, "mapped"))
    J("() => { S.tdsCF = {}; render(); }"); pg.wait_for_timeout(200)
    pg.click('[data-dreg-body="mapped"] thead [data-cf="dreg-m:ver"]'); pg.wait_for_timeout(200)
    pg.click('[data-cf-pop="dreg-m:ver"] [data-cf-v="AI, not verified"]'); pg.wait_for_timeout(300); pg.keyboard.press("Escape")
    ok(sorted(J(ROWS, "mapped")) == sorted(ai), "the filter 'AI, not verified' (%s)" % J(ROWS, "mapped"))
    # verify one, then the rest in bulk
    pg.click('[data-dreg-verify="%s"]' % ai[0]); pg.wait_for_timeout(300)
    ok(J(ROWS, "mapped") == [ai[1]], "verified: off 'AI, not verified' at once (%s)" % J(ROWS, "mapped"))
    J("() => { S.tdsCF = {}; render(); }"); pg.wait_for_timeout(200)
    for i in rule: pg.click('[data-dreg-body="mapped"] [data-dreg-tick="%s"]' % i)
    pg.click('[data-dreg-bulk-verify]'); pg.wait_for_timeout(300)
    chk = J(CHECK)
    ok(not any(chk[i] for i in rule + [ai[0]]) and chk[ai[1]], "bulk Verified: those ticked no longer 'to check'")
    ok(J("(ids) => ids.every(id => TDSMatch.verified ? TDSMatch.verified(id) : (S.books.matchNo || {})['ok|' + id])", rule), "kept with the books")

    print("3. live: map, move, remove in bulk")
    pg.click('[data-dreg-tab="pending"]'); pg.wait_for_timeout(300)
    pend = J(ROWS, "pending"); two = [x for x in pend if x in J(IDS, ["194C", "202606"])][:2]
    for i in two: pg.click('[data-dreg-body="pending"] [data-dreg-tick="%s"]' % i)
    pg.select_option('[data-dreg-bulk] select[data-dreg-to]', 'chM'); pg.wait_for_timeout(200)
    pg.click('[data-dreg-bulk-map]'); pg.wait_for_timeout(500)
    c2 = J(COUNTS)
    ok(not [i for i in two if i in J(ROWS, "pending")] and c2["pending"] == cnt["pending"] - 2 and c2["mapped"] == cnt["mapped"] + 2, "mapped: off Pending, on Mapped at once (%s)" % c2)
    pg.click('[data-dreg-tab="mapped"]'); pg.wait_for_timeout(300)
    how2 = J(HOW)
    ok(all(how2[i][0] == "hand" for i in two), "mapped by hand: By hand")
    # move in bulk: June's ₹300 from 00301 to 00402 (₹500 left)
    small = J("(ids) => ids.find(id => TDS.rows().find(r => r.id === id).tds === 300)", two)
    pg.click('[data-dreg-body="mapped"] [data-dreg-tick="%s"]' % small)
    pg.select_option('[data-dreg-mbulk] select[data-dreg-to]', 'chS2'); pg.wait_for_timeout(200)
    pg.click('[data-dreg-bulk-move]'); pg.wait_for_timeout(500)
    cell = J("(id) => (document.querySelector('[data-dreg-body=\"mapped\"] tr[data-dreg-row=\"' + CSS.escape(id) + '\"] [data-dreg-ch]') || {}).innerText || ''", small)
    ok(J("(id) => S.books.alloc[id]", small) == "chS2" and "00402" in cell, "Move in bulk: on 00402 at once (%s)" % cell)
    J("() => { S.tdsDregSel = {}; render(); }")
    for i in two: pg.click('[data-dreg-body="mapped"] [data-dreg-tick="%s"]' % i)
    pg.click('[data-dreg-bulk-remove]'); pg.wait_for_timeout(500)
    c3 = J(COUNTS)
    ok(c3 == cnt and not [i for i in two if i in J(ROWS, "mapped")], "taken off: back on Pending at once (%s)" % c3)
    # a move elsewhere (the challan's table) shows here at once
    J("(ids) => { TDSMatch.takeOff(ids); render(); }", hand[:1]); pg.wait_for_timeout(300)
    ok(J(COUNTS)["pending"] == cnt["pending"] + 1, "taken off elsewhere: on Pending at once")
    J("(ids) => { TDSMatch.move(ids, 'chA'); render(); }", hand[:1]); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, "after.png"))
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    ok(J("document.documentElement.scrollWidth <= window.innerWidth + 1"), "a phone: no horizontal page scroll")
    pg.screenshot(path=os.path.join(SHOTS, "phone.png"))
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
