"""python3 tests/run_hang_bill_drafts.py - "Page blocked" for 10 s in a timer on Books (FINCOM-APP-STAGING-M, staging
13-Nov-2026 06:30 UTC, build mwehywg3-29edc3 = db6c28e21: 9,990 ms of script in TimerHandler:setTimeout, route
client/books, the Tally icon 29 s before). The source map of that build puts the timer at src/js/58-ledgers.js:52, the
one Ledgers.books sets when the masters on Books are the ledger list ("ledgersChanged(cid); render()"), with the router's
Smart.onbWatch (src/js/52-routes.js:115) in the same frame.
ledgersChanged matches every draft bill again (billAutoAll: Ledgers.ver moved, so each draft's stamp is new), and for
each draft tallyPartyFor worked out the GSTIN and PAN of every ledger (Ledgers.ids) and every ledger's name cleaned
(supplierKey), and Ledgers.gstinParty went through every entry for a GSTIN not on a ledger: drafts x ledgers. 240 drafts
on 4,188 ledgers and 51,758 entries: about 2 s here, an office PC about 4x slower. Now those are worked out once for the
whole run (Ledgers.run / Ledgers.memo, around ledgersChanged and billAutoAll), and nothing outside the run keeps them:
6.3-7.0 s before, about 175 ms now (the drawing included).
Made-up books only: the fixture's large client (tests/mis_big_books.py) copied 14 times (as run_hang_gst_year.py makes
them), DRAFTS made-up draft bills (a third with a supplier's GSTIN from the books, a third with a GSTIN on no ledger, a
third with no GSTIN). Checks:
  1. the timer (the masters' list worked out again): its task within TASK_MS (default 200) at full speed;
  2. every draft's party and expense ledgers (and their reasons) are the ones each draft gets worked out alone (outside
     billAutoAll, as before), and the ones the build before the fix gave (DIGEST);
  3. a ledger's GSTIN changed in place between two runs: the next run sees it (nothing kept between runs).
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_DRAFTS_PORT") or 8339)
TASK_MS = int(os.environ.get("TASK_MS") or 200)
DRAFTS = int(os.environ.get("DRAFTS") or 240)
DIGEST = "5EA0FE0D"   # the drafts' ledgers as db6c28e21 (before the fix) fills them
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangdrafts-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")
# made-up drafts: suppliers' names from the books' ledgers, made-up GSTINs (valid check digit) on no ledger
DRAFT = """(nd) => { const cid = S.books.cid, d = S.data[cid] = S.data[cid] || {parties: {}, entries: {}}; d.loaded = true; d.entries = d.entries || {}; d.parties = d.parties || {};
  const bk = S.books, withG = Object.keys(bk.gstins || {}).filter(n => gstinValid(bk.gstins[n])).sort(), all = Object.keys(bk.ledInfo).sort();
  const mkG = (i) => { const b = '07AAZPQ' + String(1000 + i % 9000) + 'K1Z'; return b + gstinCheckChar(b + '0'); };
  const words = ['printer repair and courier charges', 'office rent for the month', 'electricity bill', 'internet broadband', 'legal consultancy fees', 'freight and cartage'];
  for (let i = 0; i < nd; i++){ const e = newEntry('zz-bill-' + i + '.pdf'); e.id = 'zzd' + i; const total = 1000 + (i * 37) % 90000, k = i % 3, nm = k === 0 && withG.length ? withG[i % withG.length] : all[(i * 13) % all.length];
    e.x = Object.assign(e.x || {}, {vendorName: k === 2 ? 'Made Up Vendor ' + i : nm, vendorGstin: k === 0 && withG.length ? bk.gstins[nm] : k === 1 ? mkG(i) : '', vendorPan: '', invoiceNo: 'ZZ-' + i,
      invoiceDate: '2026-0' + (1 + i % 9) + '-1' + (i % 9), total, taxable: Math.round(total / 1.18), description: words[i % words.length]});
    e.status = 'draft'; d.entries[e.id] = e; }
  return {gst: withG.length, ledgers: all.length, valid: gstinValid(mkG(1))}; }"""
# what billAutoLedgers fills on each draft
OUT = """() => Object.values(S.data[S.books.cid].entries).filter(e => e.status === 'draft').sort((a, b) => a.id < b.id ? -1 : 1)
  .map(e => [e.id, e.partyLedger || '', e.partyFrom || '', e.partyNote || '', e.expenseLedger || '', e.expenseFrom || ''].join('|'))"""
CLEAR = """() => { Object.values(S.data[S.books.cid].entries).forEach(e => { if (e.status === 'draft'){ ['partyLedger', 'partyFrom', 'partyNote', 'partyAuto', 'expenseLedger', 'expenseFrom', 'expenseAuto', 'partyHist'].forEach(k => delete e[k]); } }); Ledgers.ver++; }"""
HASH = "(a) => { let h = 2166136261; for (const c of a.join('\\n')){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).toUpperCase(); }"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(3000)
        info = pg.evaluate(DRAFT, DRAFTS)
        ok(seed["n"] > 50000 and seed["n"] <= 100000 and info["ledgers"] > 4000 and info["valid"], "made-up books: %d entries, %d ledgers, %d drafts (%s)" % (seed["n"], info["ledgers"], DRAFTS, info))
        pg.evaluate("() => { S.booksTab = 'import'; render(); billAutoAll(S.books.cid); render(); }"); pg.wait_for_timeout(2500)
        ok(pg.evaluate("Ledgers.held(S.books.cid).length") == 0 and pg.evaluate("Ledgers.list(S.books.cid).length") > 4000, "the masters on Books are the ledger list (no cloud or bridge list)")
        print("\n1. The timer after the masters' list is worked out again (ledgersChanged, then a drawing)")
        # the timer's whole task (the long tasks of the page), and ledgersChanged's own time inside it
        pg.evaluate("() => { window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))).observe({type: 'longtask'}); }")
        worst = []
        for i in range(3):
            pg.evaluate("""() => { window.__lt = []; window.__led = []; window.__task = []; const f = window.ledgersChanged, rd = window.render; let t0 = 0;
              window.ledgersChanged = function(){ t0 = performance.now(); try { return f.apply(this, arguments); } finally { window.__led.push(Math.round(performance.now() - t0)); } };
              window.render = function(){ try { return rd.apply(this, arguments); } finally { if (t0){ window.__task.push(Math.round(performance.now() - t0)); t0 = 0; } } };
              window.__restore = () => { window.ledgersChanged = f; window.render = rd; }; delete S.books._led; Ledgers.books(S.books.cid); }""")
            pg.wait_for_timeout(4000)
            r = pg.evaluate("() => { window.__restore(); return {led: window.__led, task: window.__task, lt: window.__lt.slice()}; }")
            worst.append(max(r["lt"] + r["task"] + [0]))
            ok(len(r["led"]) == 1 and len(r["task"]) == 1, "   run %d: the timer ran ledgersChanged once (%s ms; with the drawing after it %s ms; the page's long tasks %s)" % (i + 1, r["led"], r["task"], r["lt"][:6]))
        ok(max(worst) <= TASK_MS, "the timer's task within %d ms: %s ms" % (TASK_MS, worst))
        print("\n2. The same ledgers on every draft")
        out = pg.evaluate(OUT)
        pg.evaluate(CLEAR)
        alone = pg.evaluate("() => { const cid = S.books.cid; Object.values(S.data[cid].entries).forEach(e => { if (e.status === 'draft') billAutoLedgers(e, cid); }); }")
        one = pg.evaluate(OUT)
        diff = [(a, b) for a, b in zip(out, one) if a != b]
        filled, exp = sum(1 for x in out if x.split("|")[1]), sum(1 for x in out if x.split("|")[4])
        ok(len(out) == DRAFTS and out == one, "each draft as worked out alone (%d drafts, %d with a party ledger, %d with an expense ledger; differ: %s)" % (len(out), filled, exp, diff[:2]))
        h = pg.evaluate(HASH, out)
        ok(h == DIGEST, "the same as the build before the fix: %s (%s)" % (h, DIGEST))
        # the client's default ledgers matched by ledgersChanged (inside its run) as autoMapCompanyLedgers alone gives them
        r = pg.evaluate("""() => { const cid = S.books.cid, co = CO(cid), keep = JSON.stringify(co), J = () => JSON.stringify([co.gst, co.tdsLedgers, co.expenseLedgers, co.choices], (k, v) => k === 'at' ? undefined : v);
          const wipe = () => { const c = JSON.parse(keep); delete c.gst; delete c.tdsLedgers; delete c.choices; Object.keys(co).forEach(k => delete co[k]); Object.assign(co, c); };
          wipe(); ledgersChanged(cid); const a = J(); wipe(); autoMapCompanyLedgers(co); const b = J();
          return {same: a === b, guesses: (a.match(/"value"/g) || []).length}; }""")
        ok(r["same"] and r["guesses"] > 3, "the client's default ledgers matched by ledgersChanged as autoMapCompanyLedgers alone matches them (%s)" % r)
        print("\n3. Nothing kept between runs")
        r = pg.evaluate("""() => { const cid = S.books.cid, bk = S.books, d = Object.values(S.data[cid].entries).find(e => e.status === 'draft' && e.x.vendorGstin && e.partyLedger && /^GSTIN/.test(e.partyFrom || ''));
          const led = d.partyLedger, g = d.x.vendorGstin, other = Object.keys(bk.ledInfo).sort().find(n => n !== led && Ledgers.cls(cid, n) === 'party' && !bk.gstins[n] && !(bk.ledInfo[n] || {}).gstin);
          const was = [bk.gstins[led], (bk.ledInfo[led] || {}).gstin];
          bk.gstins[led] = ''; if (bk.ledInfo[led]) bk.ledInfo[led].gstin = ''; bk.gstins[other] = g; delete bk._led; Ledgers.ver++; billAutoAll(cid);
          const now = d.partyLedger; bk.gstins[led] = was[0]; if (bk.ledInfo[led]) bk.ledInfo[led].gstin = was[1]; delete bk.gstins[other]; delete bk._led; Ledgers.ver++; billAutoAll(cid);
          return {led, other, now, back: d.partyLedger}; }""")
        ok(r["now"] == r["other"] and r["back"] == r["led"], "a GSTIN moved to another ledger in place: the next run follows it, and back (%s)" % r)
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
ok(not errors, "no page errors %s" % errors[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
