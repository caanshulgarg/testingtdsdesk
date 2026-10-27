"""python3 run_tds_roundoff_ui.py - the owner, 22-Oct-2026 (Leads Insurance, 26Q Q1: a blank deductee row, 194J, ₹0.71 at 2%,
"Why there is any blank entry? When tally has every ledger"): a Journal that only rounds the TDS ledger ("TDS 194J Payable"
Cr 0.71, Round Off Dr 0.71; no number, party or narration) is no deduction. On the made-up books of run_tds_challans.py
(Q1 2026-27) with that journal added:
  1. the Deductions table has no row for it and no blank deductee; the return's TDS is unchanged;
  2. Validate & file says it once, a note (not an error or a warning; the count to fix unchanged): "TDS ledger adjusted
     without a deductee: Journal 01-Apr-2026, Round Off ₹0.71 — not in the return", with "Open the entry →";
  3. Open the entry: Look up on that day for the TDS ledger.
TDS_RO_SHOTS=dir: screenshots (default tests/out/tds-roundoff)."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8263
SHOTS = os.environ.get("TDS_RO_SHOTS") or os.path.join(HERE, "out", "tds-roundoff"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
src = open(os.path.join(HERE, "run_tds_challans.py")).read()
_k = src.index('BOOKS_JS = r"""') + len('BOOKS_JS = r"""')
BOOKS_JS = src[_k:src.index('"""', _k)]
GO = "(tab) => { S.books = window.__bk; S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; S.tdsTab = tab; S.tdsDedView = ''; S.tdsDedReg = ''; S.tdsFl = {}; S.tdsFix = ''; render(); }"
Q1 = "() => { const r = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1'); return {n: r.length, tds: Math.round(r.reduce((a, x) => a + x.tds, 0) * 100) / 100, blank: r.filter(x => !x.party).length}; }"
ADD = """() => { const V = S.books.vouchers; V.push({id: 'ro1', date: '20260401', type: 'Journal', no: '', party: '', narr: '', ent: [{l: 'Round Off', a: -0.71}, {l: 'TDS 194J Payable', a: 0.71}]});
  S.books.map = Books.mapLedgers(V, S.books.map); window.__bk = S.books; return V.length; }"""
WANT = "TDS ledger adjusted without a deductee: Journal 01-Apr-2026, Round Off ₹0.71 — not in the return"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    J = lambda e, a=None: pg.evaluate(e, a)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    J(BOOKS_JS); pg.wait_for_timeout(800)
    J("() => { try { TDSMatch.online = () => false; } catch (e) {} }")
    J(GO, "file"); pg.wait_for_timeout(1200)
    before = J(Q1); e0 = pg.get_attribute('#app [data-val-errors]', 'data-val-errors'); w0 = pg.get_attribute('#app [data-val-warnings]', 'data-val-warnings')
    J(ADD); J("() => { TDSReg.forget && TDSReg.forget(); }"); J(GO, "file"); pg.wait_for_timeout(1200)
    print("1. no deduction")
    after = J(Q1)
    ok(after == before and after["blank"] == 0, "26Q Q1's deductions unchanged by the round-off journal, none blank (%s = %s)" % (after, before))
    ok(not J("() => TDS.allRows().some(r => String(r.id).startsWith('ro1|'))"), "no deduction row of the journal in any return")
    print("2. the note on Validate & file")
    li = pg.locator('#app [data-val-list="info"] li[data-tds-adj="ro1"]')
    ok(li.count() == 1, "one note line for the journal (%d)" % li.count())
    # next-tds-validate-short: under the folded Suggestions; one short line, the whole words on its hover
    pg.click('#app [data-val-sugg] > summary'); pg.wait_for_timeout(200)
    words = li.locator(".vf-w").inner_text() if li.count() else ""
    full = (li.locator(".vf-w").get_attribute("title") or words) if li.count() else ""
    ok(full == WANT and 0 < len(words) <= 70 and WANT.startswith(words.rstrip("…")), "its words: \"%s\" (the whole on its hover)" % words)
    ok(pg.locator('#app [data-val-list="errors"] [data-tds-adj], #app [data-val-list="warnings"] [data-tds-adj]').count() == 0, "not an error, not a warning")
    ok(pg.get_attribute('#app [data-val-errors]', 'data-val-errors') == e0 and pg.get_attribute('#app [data-val-warnings]', 'data-val-warnings') == w0, "the counts of errors and warnings unchanged (%s/%s)" % (e0, w0))
    li.scroll_into_view_if_needed() if li.count() else None
    pg.screenshot(path=os.path.join(SHOTS, "validate-note-1440.png"), full_page=True)
    print("3. Open the entry")
    btn = li.locator('button[data-val-act]')
    ok(btn.count() == 1 and "Open the entry" in btn.inner_text(), "the line's link: Open the entry →")
    if btn.count():
        btn.click(); pg.wait_for_timeout(1200)
        lk = J("() => { const s = LK.st(); return {q: s.q, from: s.from, to: s.to}; }")
        ok(lk["q"] == "TDS 194J Payable" and lk["from"] == "20260401" and lk["to"] == "20260401", "Look up on 01-Apr-2026 for the TDS ledger (%s)" % lk)
    ok(not errors, "no page error (%s)" % errors[:2])
    br.close()
srv.shutdown()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
