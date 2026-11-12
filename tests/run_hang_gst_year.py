"""python3 tests/run_hang_gst_year.py - "Page blocked" on a large linked client (next-fix-hang, staging 5-11 Nov 2026):
  FINCOM-APP-STAGING-K / -R / -Q (React's click handler, 2.0-2.4 s): a click that only opens or closes something (the
    client switcher of the sidebar, side-client; a pop-up's Open Tally page; ← Back to the year) drew the page under it
    again, and every drawing of GST › Year worked out GSTR.checks for each of its 12 months again: 0.6-1 s at full speed
    on 51,758 made-up entries, 2-4 s on an office PC; going back to the client drew it three times (36 checks, 2 s);
  FINCOM-APP-STAGING-H / -G (9.5 s in a timer, on any screen of the client): when the cloud copy brought new entries,
    TCloud.rework worked the year's MIS out again at once (1.2-1.7 s here) though TallyRead.after had just marked it out
    of date, and the MIS tab works it out again (behind the page, lib/catchSoon.js) when it is shown: done twice.
Made-up books only: the fixture's large client (tests/mis_big_books.py) copied 14 times over two years (51,758 entries),
as run_gst_fix_list.py makes them. Checks:
  1. GST › Year drawn once: then a redraw, the switcher opened and closed, the Tally page and back to the client, a
     month and ← Back to the year work no month's checks out again (0 GSTR.checks), each within ACT_MS (default 450) at
     full speed;
  2. the kept checks are the ones worked out afresh (every month of the year, outside a drawing);
  3. a change saved (an entry's GSTIN made invalid, saveBooks): the next drawing works that month's checks out again
     (that month alone, next-fix-gst-year-save) and the grid's count moves by one; an entry replaced in place without a
     save: its month again; the client's GSTIN changed, marketplace sales added, the ledger map or the GST settings
     edited in place: every month again; a marketplace invoice changed
     in place as Sales changes it (ignored, restored, its buyer GSTIN typed, Undo; then saveSales): the grid, What to
     fix and the count worked out afresh agree;
  4. TCloud.rework after new entries (TallyRead.after marked MIS out of date): no MIS.run at once (the tab does it when
     shown), the mark kept, within REWORK_MS (default 600); books with no mark: MIS.run as before.
  5. next-fix-gst-year-save (the cloud copy's new entries drew GST › Year with its 12 months worked out again, twice, 0.6 s
     each here, 2.6 s on the owner's office PC): a change to the entries of one month works out that month alone, and the
     drawing after new entries came into one month (BookSrc.apply, then the save) within MONTH_MS (default 150). After each
     of a sequence of changes, every month of the books' kept checks (GSTR.checksKept, all of them, with their documents)
     and document counts are the ones worked out afresh: an invoice edited and saved, an entry changed in place and saved,
     new entries from the cloud copy, an entry deleted, an invoice renumbered to another month's number (the other
     month, not worked out again, lists it as used twice), a B2C large invoice and a later month's note that adjusts it
     (a number too long, checked only because of that invoice) then the invoice deleted, a ledger's GST setting changed
     (every month again), the marketplace sales changed (every month again), an entry's line changed in place with a new
     list of the same entries (Books.touch: every month again).
  (months worked out: GSTR.checksMonth, the part of a month's checks worked out from its own entries; GSTR.checks on a
  build without it)
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, time, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_GST_PORT") or 8331)
ACT_MS = int(os.environ.get("ACT_MS") or 450)
REWORK_MS = int(os.environ.get("REWORK_MS") or 600)
MONTH_MS = int(os.environ.get("MONTH_MS") or 150)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hanggst-")
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
books = json.load(open(CACHE))

SEED = """async () => {
  const c = newCompany({name: "ZZ BIG GST", gstin: "07AAGCL4827M1Z3"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const get = async u => new Blob([await (await fetch(u)).arrayBuffer()], {type: "text/xml"});
  const ms = await Books.importMasters(await get("/__big/Master.xml")), db = await Books.importDayBook(await get("/__big/DayBook.xml"));
  const base = db.vouchers, out = [], sh = (d, k) => String(Number(String(d).slice(0, 4)) + k) + String(d).slice(4);
  for (let j = 0; j < 14; j++) for (const v of base){
    let k = 0; if (j % 2){ k = sh(v.date, 1) <= "20261105" ? 1 : -1; }
    const w = j ? JSON.parse(JSON.stringify(v)) : v;
    if (j){ w.id = v.id + "-" + j; if (w.guid) w.guid = v.guid + "-" + j; if (w.no != null) w.no = String(v.no) + "/" + j; if (k){ w.date = sh(v.date, k); if (w.refDate && /^\\d{8}$/.test(w.refDate)) w.refDate = sh(w.refDate, k); } }
    out.push(w); }
  out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const b = Object.assign({loading: false, challans: [], alloc: {}}, {vouchers: out, meta: Object.assign({}, db.meta, {from: out[0].date, to: out[out.length - 1].date})},
    {cid: c.id, ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans});
  b.map = Books.mapLedgers(b.vouchers, {}); S.books = b; LedMaster.refresh(b); S.lk = null; render();
  return {n: out.length, cid: c.id}; }"""
# GSTR.checks and MIS.run counted; the long animation frames
INSTR = """() => { window.__ck = 0; window.__mis = 0; window.__one = 0; const nm = typeof GSTR.checksMonth === 'function' ? 'checksMonth' : 'checks', f = GSTR[nm]; GSTR[nm] = function(){ window.__ck++; return f.apply(this, arguments); };
  const o = GSTR.one; GSTR.one = function(){ window.__one++; return o.apply(this, arguments); };
  const m = MIS.run; MIS.run = function(){ window.__mis++; return m.apply(this, arguments); };
  window.__lf = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lf.push(Math.round(e.duration)))).observe({type: 'long-animation-frame'}); } catch (e) {} }"""
GRID = "() => Array.from(document.querySelectorAll('#app [data-gst-grid] [data-cell]')).map(c => { const m = /^Errors (\\d+)/.exec(c.querySelector('.rp-s') ? c.querySelector('.rp-s').innerText : ''); return [c.dataset.cell, m ? +m[1] : 0]; })"
# every month's checks outside a drawing (afresh) against the ones a drawing hands out
SAME = """() => { const ms = GSTR.months().filter(m => m >= '202504' && m <= '202603'), J = (x) => JSON.stringify(x.map(c => [c.what, c.n, c.info || false, c.ret, (c.all || []).map(r => r.no || r.id || '')]));
  const fresh = ms.map(m => J(GSTR.checks(m, '07'))), kept = memoScope(() => ms.map(m => J(GSTR.errorChecks(m, '07').r1.concat(GSTR.errorChecks(m, '07').r3b))));
  const want = ms.map(m => J(GSTR.checks(m, '07').filter(c => !c.info && (c.ret === 'r1' || c.ret === 'r3b')).sort((a, c) => (a.ret === 'r1' ? 0 : 1) - (c.ret === 'r1' ? 0 : 1))));
  const docs = memoScope(() => ms.map(m => GSTR.docCount(m, '07'))), docsFresh = ms.map(m => GSTR.one(m, '07').total.n);
  return {n: ms.length, same: ms.every((m, i) => kept[i] === want[i]) && JSON.stringify(docs) === JSON.stringify(docsFresh), fresh: fresh.length, docs: docs.slice(0, 3)}; }"""

def act(pg, name, js, wait=1500, ck_max=0):
    pg.evaluate("() => { window.__ck = 0; window.__lf = []; }")
    pg.evaluate(js); pg.wait_for_timeout(wait)
    m = pg.evaluate("() => ({ck: window.__ck, lf: window.__lf.slice()})")
    longest = max(m["lf"] or [0])
    ok(m["ck"] <= ck_max and longest <= ACT_MS, "%s: %d months' checks worked out (at most %d), the longest frame %d ms (at most %d)" % (name, m["ck"], ck_max, longest, ACT_MS))
    return m

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000, "large made-up books: %d entries" % seed["n"])
        pg.evaluate(INSTR)
        # 1. the year drawn once, then actions that change no figure
        pg.evaluate("() => { window.__ck = 0; S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }"); pg.wait_for_timeout(2000)
        first = pg.evaluate("() => window.__ck"); grid0 = pg.evaluate(GRID)
        ok(first >= 12 and any(n for k, n in grid0), "GST › Year drawn: its 12 months' checks worked out (%d), red cells %s" % (first, [x for x in grid0 if x[1]][:3]))
        act(pg, "a redraw (render)", "() => render()")
        act(pg, "the client switcher opened (side-client)", "() => document.querySelector('[data-side-client]').click()")
        act(pg, "the switcher closed (Esc)", "() => closeSwitcher()")
        act(pg, "the Tally page (Open Tally page)", "() => goTallyPage()")
        act(pg, "back to the client (side-client)", "() => document.querySelector('[data-side-client]').click()", 3000)
        ok(pg.evaluate("S.booksTab") == "gst" and pg.evaluate(GRID) == grid0, "back on GST › Year: the same grid")
        red = next(k for k, n in grid0 if n)
        act(pg, "a red cell (%s)" % red, "() => document.querySelector('#app [data-cell=\"%s\"]').click()" % red, ck_max=1)
        act(pg, "a group opened (fix-toggle)", "() => document.querySelector('#app [data-fix-group] [data-fix-toggle]').click()")
        act(pg, "← Back to the year", "() => document.querySelector('#app [data-back-year]').click()")
        ok(pg.evaluate(GRID) == grid0, "the grid as it was")
        # 2. kept = afresh
        s = pg.evaluate(SAME)
        ok(s["same"] and s["n"] == 12, "every month's kept checks and document counts are the ones worked out afresh (%s)" % s)
        # 3. a change saved: worked out again, the count moves
        k1 = next(k for k, n in grid0 if k.startswith("GSTR-1|") and n)
        ym1 = k1.split("|")[1]
        moved = pg.evaluate("""(ym) => { const v = S.books.vouchers.find(x => Books.isSale(x) && GSTR.inP(x.date, ym) && x.gstin && gstinValid(x.gstin) && GSTR.outRow(x, ym, '07') && GSTR.outRow(x, ym, '07').kind === 'B2B');
          if (!v) return null; v.gstin = v.gstin.slice(0, 14) + (v.gstin[14] === 'A' ? 'B' : 'A'); saveBooks(); return v.id; }""", ym1)
        ok(moved is not None, "an invoice's buyer GSTIN made invalid and saved (%s)" % moved)
        pg.evaluate("() => { window.__ck = 0; render(); }"); pg.wait_for_timeout(800)
        g1 = dict(pg.evaluate(GRID)); n0 = dict(grid0)[k1]
        ok(pg.evaluate("window.__ck") == 1 and g1[k1] == n0 + 1, "after the save that month's checks alone are worked out again (%d) and %s counts %d (was %d)" % (pg.evaluate("window.__ck"), k1, g1[k1], n0))
        ok(pg.evaluate(SAME)["same"], "and they are the ones worked out afresh")
        # an entry replaced by another without a save: worked out again (each entry compared)
        pg.evaluate("""(id) => { const V = S.books.vouchers, i = V.findIndex(x => x.id === id), w = JSON.parse(JSON.stringify(V[i])); w.gstin = ''; V[i] = w; }""", moved)
        pg.evaluate("() => { window.__ck = 0; render(); }"); pg.wait_for_timeout(800)
        ck1 = pg.evaluate("window.__ck")
        ok(ck1 == 1 and pg.evaluate(SAME)["same"], "an entry replaced in the list (no save): its month worked out again (%d), as afresh" % ck1)
        # the client's own GSTIN changed (a company field, not the books): worked out again
        pg.evaluate("() => { window.__ck = 0; const c = CO(); c.__g = c.gstin; c.gstin = '07AAGCL4827M2Z2'; render(); }"); pg.wait_for_timeout(800)
        ok(pg.evaluate("window.__ck") >= 12 and pg.evaluate(SAME)["same"], "the client's GSTIN changed: worked out again, as afresh")
        pg.evaluate("() => { const c = CO(); c.gstin = c.__g; delete c.__g; render(); }"); pg.wait_for_timeout(500)
        # marketplace sales (S.sales) added: worked out again
        pg.evaluate("""() => { window.__ck = 0; S.sales = {cid: S.coId, list: [{id: 'zzmk1', source: 'market', status: 'review', x: {date: '2026-03-10', number: 'MK-0001', customerName: 'ZZ Buyer', customerGstin: '07AAJFQ3158R1ZJ', placeOfSupply: 'Delhi', cgst: 9, sgst: 9, igst: 0, taxable: 100, total: 118, hsn: '9983'}}], cfg: {}, sel: new Set(), sticky: new Set(), undo: null};
          saveSales(); render(); }"""); pg.wait_for_timeout(800)
        ok(pg.evaluate("window.__ck") >= 1 and pg.evaluate(SAME)["same"], "marketplace sales added: worked out again, as afresh")
        # (review of bb5a5c53d) a marketplace invoice changed IN PLACE, as Sales does (then saveSales): the grid and What to fix follow
        KM = "GSTR-1|202603"
        def mk_state(label):
            pg.evaluate("() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }"); pg.wait_for_timeout(500)
            n = dict(pg.evaluate(GRID)).get(KM, 0)
            pg.evaluate("() => document.querySelector('#app [data-cell=\"%s\"]').click()" % KM); pg.wait_for_timeout(500)
            fx = pg.evaluate("() => { const p = document.querySelector('#app [data-fix-list]'); return p ? +p.dataset.fixN : 0; }")
            fresh = pg.evaluate("() => GSTR.errorsFor('202603', '07').r1")
            pg.evaluate("() => { const b = document.querySelector('#app [data-back-year]'); if (b) b.click(); }"); pg.wait_for_timeout(300)
            return n, fx, fresh
        n_bad, fx_bad, fr_bad = mk_state("bad")
        ok(n_bad == fx_bad == fr_bad, "the marketplace invoice with an invalid buyer GSTIN: grid %d = What to fix %d = afresh %d" % (n_bad, fx_bad, fr_bad))
        pg.evaluate("() => { const v = S.sales.list[0]; v.status = 'ignored'; saveSales(); render(); }")
        n_ig, fx_ig, fr_ig = mk_state("ignored")
        ok(n_ig == fx_ig == fr_ig == n_bad - 1, "ignored in place (saveSales): grid %d, What to fix %d, afresh %d (one fewer than %d)" % (n_ig, fx_ig, fr_ig, n_bad))
        pg.evaluate("() => { const v = S.sales.list[0]; v.status = 'review'; saveSales(); render(); }")
        n_re, fx_re, fr_re = mk_state("restored")
        ok(n_re == fx_re == fr_re == n_bad, "restored in place: grid %d, What to fix %d, afresh %d (%d again)" % (n_re, fx_re, fr_re, n_bad))
        pg.evaluate("() => { const s = S.sales, v = s.list[0]; s.undo = {text: 'zz', before: [JSON.parse(JSON.stringify(v))]}; v.x.customerGstin = '07AAJFQ3158R1ZH'; saveSales(); render(); }")
        n_fx, fx_fx, fr_fx = mk_state("GSTIN typed")
        ok(n_fx == fx_fx == fr_fx == n_bad - 1, "its buyer GSTIN corrected in place: grid %d, What to fix %d, afresh %d" % (n_fx, fx_fx, fr_fx))
        pg.evaluate("() => salesUndo()"); pg.wait_for_timeout(300)
        n_un, fx_un, fr_un = mk_state("undone")
        ok(n_un == fx_un == fr_un == n_bad, "Undo (salesUndo): grid %d, What to fix %d, afresh %d (%d again)" % (n_un, fx_un, fr_un, n_bad))
        # the ledger map and the GST settings edited in place (their contents compared): worked out again
        pg.evaluate("() => { window.__ck = 0; const m = S.books.map, k = Object.keys(m)[0]; m[k] = Object.assign({}, m[k], {zz: 1}); render(); }"); pg.wait_for_timeout(500)
        ok(pg.evaluate("window.__ck") >= 12, "a ledger's mapping changed in place (no save): worked out again (%d)" % pg.evaluate("window.__ck"))
        pg.evaluate("() => { window.__ck = 0; S.books.gstSet = S.books.gstSet || {}; S.books.gstSet.zz = {t: 1}; render(); }"); pg.wait_for_timeout(500)
        ok(pg.evaluate("window.__ck") >= 12, "the GST settings changed in place (no save): worked out again (%d)" % pg.evaluate("window.__ck"))
        pg.evaluate("() => { delete S.books.gstSet.zz; S.sales = null; render(); }"); pg.wait_for_timeout(500)
        # 5. one month changed: that month alone worked out again; every month's kept checks = afresh after each change
        ALLSAME = """() => { const ms = GSTR.months(), reg = '07', J = (l) => JSON.stringify(l.map(c => [c.what, c.n, c.how, !!c.info, c.ret || '', (c.all || []).map(r => (r.doc || r).id || r.no || '')]));
          const fresh = ms.map(m => J(GSTR.checks(m, reg))), docsF = ms.map(m => GSTR.one(m, reg).total.n);
          const kept = memoScope(() => ms.map(m => J(typeof GSTR.checksKept === 'function' ? GSTR.checksKept(m, reg) : GSTR.checks(m, reg)))), docsK = memoScope(() => ms.map(m => GSTR.docCount(m, reg)));
          return {n: ms.length, bad: ms.filter((m, i) => fresh[i] !== kept[i] || docsF[i] !== docsK[i])}; }"""
        # what a month's kept checks list: {what: [ids]}
        KEPT = "(ym) => memoScope(() => Object.fromEntries(GSTR.checksKept(ym, '07').map(c => [c.what, (c.all || []).map(r => (r.doc || r).id)])))"
        # (the months worked out by the change, a drawing of its own included, and by the drawing after it; that drawing timed)
        def step(name, js, arg=None, ck=None, ck_min=None, ms_max=None):
            pg.evaluate("() => { window.__ck = 0; window.__one = 0; }")
            r = pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
            t = pg.evaluate("() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; const t0 = performance.now(); render(); return Math.round(performance.now() - t0); }")
            pg.wait_for_timeout(400)
            n = pg.evaluate("() => ({ck: window.__ck, one: window.__one})")
            good = (ck is None or n["ck"] == ck) and (ck_min is None or n["ck"] >= ck_min) and (ms_max is None or t <= ms_max)
            s5 = pg.evaluate(ALLSAME)
            ok(good and not s5["bad"] and s5["n"] >= 20, "%s (%s): %d months worked out (%s), the drawing %d ms%s; every month's kept checks and counts as afresh (%d months; differ: %s)"
               % (name, r, n["ck"], ("want %d" % ck) if ck is not None else ("want at least %d" % ck_min), t, (" (at most %d)" % ms_max) if ms_max else "", s5["n"], s5["bad"]))
            return r, n, t
        pg.evaluate("() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }"); pg.wait_for_timeout(800)
        # a. an invoice edited (replaced by its edited copy, as Tally's next version comes) and saved
        step("5a. an invoice of Sep-2025 edited (buyer GSTIN made invalid) and saved", """() => { const V = S.books.vouchers, i = V.findIndex(x => Books.isSale(x) && GSTR.inP(x.date, '202509') && x.gstin && gstinValid(x.gstin) && GSTR.outRow(x, '202509', '07'));
          const w = JSON.parse(JSON.stringify(V[i])); w.gstin = w.gstin.slice(0, 14) + (w.gstin[14] === 'A' ? 'B' : 'A'); V[i] = w; saveBooks(); return w.id; }""", ck=1)
        # b. an entry changed in place, then saved
        step("5b. an entry of Oct-2025 changed in place (its party's GSTIN cleared) and saved", """() => { const v = S.books.vouchers.find(x => Books.isSale(x) && GSTR.inP(x.date, '202510') && x.gstin && GSTR.outRow(x, '202510', '07'));
          v.gstin = ''; saveBooks(); return v.id; }""", ck=1)
        # c. new entries from the cloud copy, all in one month (the cloud's apply, then the save), timed
        # (twice, each time 3 more: the faster drawing is held to MONTH_MS, as one drawing can meet the garbage collector)
        CLOUD3 = """(j) => { const b = S.books, src = b.vouchers.filter(v => Books.isSale(v) && GSTR.inP(v.date, '202602') && (v.ent || []).length >= 2 && GSTR.outRow(v, '202602', '07') && !/^zzyr/.test(v.id)).slice(0, 3);
  const iso = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8), n0 = b.vouchers.length;
  const heads = src.map((v, k) => ({guid: 'zzyr-' + j + '-' + k, day: iso(v.date), alter_id: 700 + k, vtype: v.type, vno: 'ZY' + j + k, party: v.party, narration: 'zz new', cancelled: false, optional: false, deleted_at: null,
    gstin: v.gstin || '', pos: v.pos || '', ref: '', ref_date: null, cmp_gstin: v.cmp || '', irn: '', irn_ack_date: null}));
  const lines = []; src.forEach((v, k) => v.ent.forEach(e => lines.push({guid: 'zzyr-' + j + '-' + k, ledger: e.l, amount: e.a, hsn: e.h || null, rate: e.gr == null ? null : e.gr})));
  const got = BookSrc.apply(b, heads, lines, []); saveBooks(); return {got, more: b.vouchers.length - n0}; }"""
        r, n, t1 = step("5c. 3 new entries from the cloud copy, all in Feb-2026 (BookSrc.apply, saved)", CLOUD3, 1, ck=1)
        ok(r["more"] == 3, "   the 3 entries are in the books (%s)" % r)
        r, n, t2 = step("5c. 3 more, again in Feb-2026", CLOUD3, 2, ck=1)
        ok(r["more"] == 3 and min(t1, t2) <= MONTH_MS, "   the drawing after new entries came into one month: %d ms (at most %d; the two: %d, %d ms)" % (min(t1, t2), MONTH_MS, t1, t2))
        # d. an entry deleted
        step("5d. an invoice of Nov-2025 deleted (saved)", """() => { const b = S.books, v = b.vouchers.find(x => Books.isSale(x) && GSTR.inP(x.date, '202511') && GSTR.outRow(x, '202511', '07'));
          b.vouchers = b.vouchers.filter(x => x !== v); saveBooks(); return v.id; }""", ck=1)
        # e. an invoice renumbered to the number of an invoice of another month of the year: that month, not worked out
        # again, lists it too
        DUP = "Invoice numbers used twice in the financial year"
        r, n, t = step("5e. an invoice renumbered to another month's invoice number (saved)", """() => { const V = S.books.vouchers, B2B = (v) => { const r = Books.isSale(v) && v.date >= '20250401' && v.date <= '20260331' && GSTR.outRow(v, '', '07'); return r && r.kind === 'B2B' && r.no && !/^zz/.test(v.id); };
  const x = V.find(B2B), i = V.findIndex(v => B2B(v) && v.date.slice(0, 6) !== x.date.slice(0, 6)), w = JSON.parse(JSON.stringify(V[i])); w.no = x.no; V[i] = w; saveBooks(); return {a: x.id, am: x.date.slice(0, 6), b: w.id, bm: w.date.slice(0, 6), no: x.no}; }""", ck=1)
        ka = pg.evaluate(KEPT, r["am"]); kb = pg.evaluate(KEPT, r["bm"])
        ok(r["a"] in ka.get(DUP, []) and r["b"] in kb.get(DUP, []), "   %s (kept) and %s both list the number as used twice (%s, %s)" % (r["am"], r["bm"], ka.get(DUP), kb.get(DUP)))
        # f. a B2C large invoice (Jul-2025) and a later note to the same buyer without a GSTIN (Aug-2025, its number too long):
        # the note's number is checked only because of that invoice (cdnurTyp); the invoice deleted, Aug is not worked out again
        # yet its check goes
        LONG = "Invoice numbers longer than 16 characters"
        r, n, t = step("5f. a B2C large invoice in Jul-2025 and a note adjusting it in Aug-2025 added (saved)", """() => { const b = S.books, V = b.vouchers;
          const v = V.find(x => { const r = Books.isSale(x) && GSTR.outRow(x, '', '07'); return r && r.igst > 0 && r.total > 100000 && r.kind === 'B2B' && r.posCode; });
          const inv = JSON.parse(JSON.stringify(v)), cn = JSON.parse(JSON.stringify(v));
          Object.assign(inv, {id: 'zzb2cl-1', guid: 'zzb2cl-1', date: '20250715', gstin: '', no: 'ZZL/0001'});
          Object.assign(cn, {id: 'zzcn-1', guid: 'zzcn-1', date: '20250812', gstin: '', type: 'Credit Note', no: 'ZZCN/2025-26/00001', ref: '', refDate: ''}); cn.ent = cn.ent.map(e => Object.assign({}, e, {a: -e.a}));
          b.vouchers = V.concat([inv, cn]).sort((p, q) => String(p.date).localeCompare(String(q.date))); saveBooks();
          return memoScope(() => ({inv: GSTR.outRow(inv, '', '07').kind, cn: GSTR.outRow(cn, '', '07').kind, cnIgst: GSTR.outRow(cn, '', '07').igst, typ: GSTR.cdnurTyp(GSTR.outRow(cn, '', '07'))})); }""", ck=2)
        ok(r["inv"] == "B2CL" and r["typ"] == "B2CL", "   the invoice is B2C large and the note adjusts it (%s)" % r)
        ok("zzcn-1" in pg.evaluate(KEPT, "202508").get(LONG, []), "   Aug-2025 lists the note's number as too long")
        step("5f. then the B2C large invoice deleted (saved)", """() => { const b = S.books; b.vouchers = b.vouchers.filter(x => x.id !== 'zzb2cl-1'); saveBooks(); return 'zzb2cl-1'; }""", ck=1)
        ok("zzcn-1" not in pg.evaluate(KEPT, "202508").get(LONG, []), "   Aug-2025 (kept, not worked out again) no longer checks the note's number")
        # g. a ledger's GST setting changed: every month again
        step("5g. a party ledger set as Consolidated B2C (GSTR.b2cSumLedger)", """() => { const v = S.books.vouchers.find(x => Books.isSale(x) && x.date >= '20250401' && x.date <= '20260331' && !x.gstin && GSTR.outRow(x, '', '07')); window.__p = v.party; GSTR.b2cSumLedger(v.party, true); return v.party; }""", ck_min=12)
        step("5g. and set back", "() => { GSTR.b2cSumLedger(window.__p, false); return window.__p; }", ck_min=12)
        # i. the entries' lines changed in place, then a new list of the same entries (Books.touch, as a ledger's name is
        # corrected in every line): every month again
        step("5i. a line's ledger renamed in place in an entry, Books.touch and saved", """() => { const v = S.books.vouchers.find(x => Books.isSale(x) && x.date >= '20250401' && x.date <= '20260331' && GSTR.outRow(x, '', '07') && x.ent.some(e => e.l === x.party));
  v.ent.find(e => e.l === v.party).l = 'ZZ Renamed Party Ledger'; Books.touch(S.books); saveBooks(); return v.id; }""", ck_min=12)
        # h. the marketplace sales changed: every month again
        step("5h. marketplace sales added (saveSales)", """() => { S.sales = {cid: S.coId, list: [{id: 'zzmk5', source: 'market', status: 'review', x: {date: '2026-01-10', number: 'MK-0501', customerName: 'ZZ Buyer', customerGstin: '07AAJFQ3158R1ZJ', placeOfSupply: 'Delhi', cgst: 9, sgst: 9, igst: 0, taxable: 100, total: 118, hsn: '9983'}}], cfg: {}, sel: new Set(), sticky: new Set(), undo: null};
          saveSales(); return 'zzmk5'; }""", ck_min=12)
        pg.evaluate("() => { S.sales = null; render(); }"); pg.wait_for_timeout(300)
        # 4. the cloud copy's new entries: rework
        pg.evaluate("() => { const r = MIS.autoRange(S.books), a = Audit.defaultRange(S.books); MIS.run(r.from, r.to, 'by hand'); Audit.run(a.from, a.to, 'by hand'); saveBooks(); }")
        # (on Look up: the drawing after the new entries works the shown page out again, as it must)
        pg.evaluate("() => { S.booksTab = 'lookup'; render(); }"); pg.wait_for_timeout(1000)
        r = pg.evaluate("""() => { const b = S.books; TallyRead.after(b, 'after changes came from the cloud copy'); window.__mis = 0; window.__lf = [];
          const t0 = performance.now(); TCloud.rework(b); return {ms: Math.round(performance.now() - t0), mis: window.__mis, stale: !!(b.stale || {}).mis}; }""")
        ok(r["mis"] == 0 and r["stale"] and r["ms"] <= REWORK_MS, "new entries from the cloud copy (MIS marked out of date): no MIS run at once, the mark kept for the MIS tab, %d ms (at most %d) (%s)" % (r["ms"], REWORK_MS, r))
        r2 = pg.evaluate("""() => { const b = S.books; delete b.stale; window.__mis = 0; TCloud.rework(b); return {mis: window.__mis}; }""")
        ok(r2["mis"] == 1, "books not marked out of date: MIS worked out again as before (%s)" % r2)
        # the MIS tab shown after the mark: worked out behind the page, the same run as by hand
        pg.evaluate("() => { const b = S.books; TallyRead.after(b, 'after changes came from the cloud copy'); S.misRange = null; S.booksTab = 'mis'; render(); }")
        try: pg.wait_for_function("() => !(S.books.stale || {}).mis", timeout=60000, polling=200)
        except Exception: pass
        ok(not pg.evaluate("!!(S.books.stale || {}).mis"), "the MIS tab shown: MIS worked out again behind the page, the mark taken off")
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
