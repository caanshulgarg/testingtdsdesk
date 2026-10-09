"""python3 run_ledger_pending.py - the owner's decision on H1 of the release-240 review (09-Oct-2026): "Keep today's
figures".
  1. Every return figure is the one 2.3.3 gives: GSTR-1 (each month and registration), GSTR-3B, the inward supplies
     (ITC), the TDS rows (26Q, 27Q, 27EQ). The ledgers 2.3.3 counted (the books' own ledger map: its guesses and what was
     set by hand) count exactly as before, whether or not the ledger check was saved or its switch set. Checked against
     2.3.3's own figures for the fixture books (tests/fixtures/figures-2.3.3-fixture.json, written by this test run on
     the tax-accuracy build with --write-233): 0 differences, before and after the check is saved and the books are
     opened again. With TDSDESK_SITE_233 (a tax-accuracy build) and a real client's books (tests/data/books-cache.json,
     never in git), the same on that client's books, build against build.
  2. Only the ledger check's own suggestions are pending: saved, they change no figure; one confirmed moves only that
     ledger (the figures are those of the books with that one ledger set as confirmed); after a reload it stays
     confirmed, with who and when.
  M5. "Keep as confirmed" (LedPage.keepUse) is saved at once: opened again WITHOUT a save, who and when are still there.
Made-up client: tests/ledpage_setup.py (the fixture books and masters). Offline.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledger_pending.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SITE_233 = os.environ.get("TDSDESK_SITE_233", "")
SNAP = os.path.join(HERE, "fixtures", "figures-2.3.3-fixture.json")
WRITE = "--write-233" in sys.argv
REAL = os.path.join(HERE, "data", "books-cache.json")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# every figure a return is made from, as plain data (as run_ledcheck_saved.py, without the page's own counts)
FIGS = """() => { const b = S.books, out = {}, r2_ = x => Math.round((x || 0) * 100) / 100;
  if (typeof GSTR === "object"){ GSTR._carry = null; } if (typeof GST2B === "object") GST2B._memo = null; if (typeof LedCheck === "object") LedCheck._held = null;
  const months = GSTR.months(), regs = [""].concat((GSTR.gstins(b) || []).map(g => g.slice(0, 2)));
  const sum = s => ({taxable: r2_(s.taxable), igst: r2_(s.igst), cgst: r2_(s.cgst), sgst: r2_(s.sgst), cess: r2_(s.cess)});
  out.gstr1 = {}; out.gstr3b = {}; out.itc = {};
  months.forEach(m => regs.forEach(r => { const k = m + "|" + r, o = GSTR.one(m, r);
    out.gstr1[k] = ["b2b", "b2cl", "b2c", "cdnr", "nil"].map(t => sum(GSTR.sum(o[t] || [])));
    const t = GSTR.threeB(m, r); out.gstr3b[k] = {itc: t.itc, netItc: t.netItc, net: t.net};
    out.itc[k] = sum(GSTR.sum(GSTR.inward(m, r) || [])); }));
  const tds = rows => rows.map(x => [x.section, x.party || x.name || "", r2_(x.amount), r2_(x.tds), x.date || "", x.pan || ""]).sort((a, c) => JSON.stringify(a).localeCompare(JSON.stringify(c)));
  out.q26 = tds(TDS.rows()); out.q27 = tds(TDS.nrRows()); out.q27e = tds(TDS.tcsRows());
  return JSON.parse(JSON.stringify(out)); }"""
def diff(a, b, path=""):
    if type(a) != type(b): return [path]
    if isinstance(a, dict): return [x for k in sorted(set(a) | set(b)) for x in diff(a.get(k), b.get(k), path + "/" + k)]
    if isinstance(a, list): return [path + "#len"] if len(a) != len(b) else [x for i in range(len(a)) for x in diff(a[i], b[i], path + "/%d" % i)]
    return [] if a == b else [path]
# opened again WITHOUT saving first: what was saved is what comes back
REOPEN = """async () => { const cid = S.books.cid; S.books = null; await openBooks(cid);
  for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); render(); return !!S.books && !S.books.loading; }"""
# a real client's books as the app opens them (no masters): the books' own ledger map
REAL_OPEN = """(bk) => { const c = newCompany({name: "ZZ Real", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books";
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.books = Object.assign({loading: false, challans: [], alloc: {}, map: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
  if (typeof LedMaster === "object" && LedMaster.refresh) LedMaster.refresh(S.books); if (typeof LedCheck === "object" && LedCheck.run) LedCheck.run(S.books); return c.id; }"""

def serve(site, port):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    s = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=site)); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

def real_figs(p, site, port, books):
    srv = serve(site, port); br = p.chromium.launch(); pg = br.new_page()
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(REAL_OPEN, books); pg.wait_for_timeout(300)
    if pg.evaluate("typeof LedPage === 'object'"):
        pg.evaluate("async () => { LedPage.ensure(S.books); await saveBooks(); }"); pg.wait_for_timeout(300)
    f = pg.evaluate(FIGS); br.close(); srv.shutdown(); return f

with sync_playwright() as p:
    srv, br, pg = L.start(p, 8418, SITE, errors=errors)
    E = pg.evaluate
    L.open_page(pg, "owner", cloud=False)
    f0 = E(FIGS)
    if WRITE:
        json.dump(f0, open(SNAP, "w"), indent=0, sort_keys=True); print("wrote", SNAP); br.close(); srv.shutdown(); sys.exit(0)
    want = json.load(open(SNAP))
    d = diff(want, f0)
    ok(not d, "1. the fixture books opened: every return figure is 2.3.3's (%d GSTR-1 / 3B / ITC month-registrations, %d 26Q rows): %d differences%s" % (len(want["gstr1"]), len(want["q26"]), len(d), (" " + str(d[:6])) if d else ""))
    # the ledger check's suggestions saved with the books, its switch set as "Confirm the check's sure answers" sets it
    E("async () => { LedMaster.refresh(S.books); LedPage.ensure(S.books); S.books.ledCheck.strict = true; await saveBooks(); }")
    pend = E("() => Object.values(S.books.ledCheck.items).filter(it => it.state !== 'confirmed').length")
    f1 = E(FIGS); d = diff(want, f1)
    ok(pend > 5 and not d, "2. %d suggestions saved (the switch on): every return figure is still 2.3.3's: %d differences%s" % (pend, len(d), (" " + str(d[:6])) if d else ""))
    ok(E(REOPEN), "opened again")
    f2 = E(FIGS); d = diff(want, f2)
    ok(E("!!(S.books.ledCheck && S.books.ledCheck.strict)") and not d, "1. after the reload (the check and its switch kept): %d differences against 2.3.3%s" % (len(d), (" " + str(d[:6])) if d else ""))
    # 2. one suggestion confirmed moves only that ledger: a ledger set by hand in 2.3.3 as not a tax ledger (07 CGST OUTPUT,
    # not confirmed); the check reads it as GST output; its answer confirmed ("Confirm the check's sure answers", lcConfirm)
    n = "07 CGST OUTPUT"
    E("(n) => { const m = S.books.map[n]; LedMaster.applyWhat(m, 'none'); m.byHand = true; m.ok = false; S.books.mapV = (S.books.mapV || 0) + 1; LedPage.ensure(S.books); }", n)
    b0 = E(FIGS)
    E("() => { window.__before = JSON.parse(JSON.stringify(S.books)); }")
    E("(n) => Drafts.direct(() => { LedCheck.confirm(S.books, [n]); saveBooks(); }, {bypass: true})", n); pg.wait_for_timeout(500)
    b1 = E(FIGS)
    ok(E("(n) => !!S.books.map[n].ok && S.books.map[n].kind === 'gst'", n) and diff(b0, b1), "2. %s confirmed as the check reads it (GST output): the figures move (%d)" % (n, len(diff(b0, b1))))
    # the books before, with only that ledger as now confirmed: the same figures
    E("(n) => { window.__after = S.books; const c = window.__before; c.map[n] = JSON.parse(JSON.stringify(S.books.map[n])); c.mapV = (c.mapV || 0) + 1; S.books = c; }", n)
    bx = E(FIGS); E("() => { S.books = window.__after; S.books.mapV = (S.books.mapV || 0) + 1; }")
    d = diff(bx, b1)
    ok(not d, "2. ... and only that ledger moved: the figures are those of the books with just %s confirmed%s" % (n, (": DIFFERS " + str(d[:5])) if d else ""))
    ok(E(REOPEN), "opened again")
    who = E("(n) => [S.books.map[n].ok, S.books.map[n].okBy || '', S.books.map[n].okAt || '']", n)
    ok(who[0] and who[1] and who[2] and not diff(b1, E(FIGS)), "2. after the reload %s stays confirmed, by %s at %s, the figures the same" % (n, who[1], who[2]))
    # M5. Keep as confirmed: saved at once, who and when kept after the books are opened again without a save
    E("(n) => { const it = (S.books.ledCheck.items || {})[n]; if (it){ it.okBy = ''; it.okAt = ''; } }", n)
    E("(n) => LedPage.keepUse(S.books, n)", n); pg.wait_for_timeout(500)
    before = E("(n) => { const it = S.books.ledCheck.items[n] || {}; return [it.okBy || '', it.okAt || '']; }", n)
    ok(before[0] and before[1], "M5. keep as confirmed: who and when set (%s)" % before)
    ok(E(REOPEN), "opened again without a save")
    after = E("(n) => { const it = ((S.books.ledCheck || {}).items || {})[n] || {}; return [it.okBy || '', it.okAt || '']; }", n)
    ok(after == before, "M5. who and when kept after the reload: %s (was %s)" % (after, before))
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()
    # a real client's books, build against build (local only)
    if SITE_233 and os.path.exists(REAL):
        bk = json.load(open(REAL))
        a = real_figs(p, SITE_233, 8420, bk); b = real_figs(p, SITE, 8421, bk)
        d = diff(a, b)
        ok(not d, "1. a real client's books (tests/data), 2.3.3's build against this one: %d differences (%d GSTR-1 / 3B / ITC month-registrations, %d 26Q rows)%s" % (len(d), len(a["gstr1"]), len(a["q26"]), (" " + str(d[:6])) if d else ""))
    else:
        print("  (a real client's books against 2.3.3's build: not run here; set TDSDESK_SITE_233 with tests/data/books-cache.json)")
print("\n%d FAILED" % len(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
