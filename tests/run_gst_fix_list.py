"""python3 run_gst_fix_list.py - GST › Year: every error findable in one click (the owner, 11-Nov-2026: "I am not able
to locate the error").

  1. a red "Errors N" cell of the year's grid opens that month's return on "What to fix": the errors grouped by kind
     ("Missing HSN — 120 invoices"), each group opening to its documents (date, number, party, amount), the reason in
     plain words, what to do and the field to correct in Tally, and each document opening in Look up;
  2. the month's GSTR-1 and GSTR-3B show "What to fix (N)" on top of their other tabs; N is the grid's own count
     (GSTR.errorChecks, the list GSTR.errorsFor counts), for every month of the year;
  3. 3B's errors (the purchase side) are listed the same way;
  4. "← Back to the year" from the month goes back to the grid.
On the fixture books (tests/fixtures/books, faults planted as run_gst_checks.py plants them) and on large books
(tests/mis_big_books.py copied 14 times over two years: about 51,758 entries): no screen shows the error box
([data-guard]). Nothing here changes a figure or a rule: the checks' counts before and after are the same.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG=0 skips the large books; BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary
folder when not given)."""
import os, sys, json, time, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("GSTFIX_PORT") or 8327)
BIG = os.environ.get("BIG", "1") != "0"
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

# the site, and the large books' XML beside it at /__big/
root = tempfile.mkdtemp(prefix="gstfix-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
made_big = None
if BIG:
    big = os.environ.get("BIG_DIR")
    if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
        made_big = big = os.path.join(root, "bigxml")
        subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
    os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

SALE = "(a) => S.books.vouchers.find(v => (v.no || v.ref) === a)"
# the checks as the grid counts them: errorsFor's numbers, and the list behind them
COUNTS = "(a) => { const e = GSTR.errorsFor(a[0], a[1]), l = GSTR.errorChecks(a[0], a[1]); return {r1: e.r1, r3b: e.r3b, l1: l.r1.reduce((s, c) => s + c.n, 0), l3: l.r3b.reduce((s, c) => s + c.n, 0), g1: l.r1.map(c => [c.what, c.n]), g3: l.r3b.map(c => [c.what, c.n])}; }"
ALLCHECKS = "(a) => JSON.stringify(GSTR.checks(a[0], a[1]).map(c => [c.what, c.n, !!c.info, c.ret || '', c.rows.map(r => r.no)]))"
GUARD = "() => document.querySelectorAll('#app [data-guard]').length"

def wait_idle(pg, ms=300):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('#app .pg-skel, #app [data-page-skeleton], #app [data-loading], #app [data-rx-preparing]')", timeout=60000, polling=100)
    except Exception: pass

def year(pg, reg, ym):
    pg.evaluate("(a) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = a[0]; S.gstYm = a[1]; render(); }", [reg, ym]); wait_idle(pg, 500)

def cells(pg):
    return pg.evaluate("""() => Array.from(document.querySelectorAll('#app [data-gst-grid] [data-cell]')).map(c => {
      const m = /^Errors (\\d+)/.exec(c.querySelector('.rp-s') ? c.querySelector('.rp-s').innerText : ''); return [c.dataset.cell, c.dataset.status, m ? +m[1] : null]; })""")

def panel(pg):
    return pg.evaluate("""() => { const p = document.querySelector('#app [data-fix-list]'); if (!p) return null;
      return {n: +p.dataset.fixN, ret: p.dataset.fixRet, head: (p.querySelector('h3') || {}).innerText || '', hash: location.hash, sub: S.gstSub, part: S.gstPart, ym: S.gstYm,
        groups: Array.from(p.querySelectorAll('[data-fix-group]')).map(g => [g.dataset.fixGroup, +g.dataset.n, ((g.querySelector('[data-fix-toggle] b') || {}).innerText || '')])}; }""")

def open_group(pg, what):
    pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (g && !g.querySelector('[data-fix-row]')) g.querySelector('[data-fix-toggle]').click(); }", what); wait_idle(pg, 150)
    return pg.evaluate("""(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (!g) return null;
      return {why: (g.querySelector('[data-fix-why]') || {}).innerText || '', tally: (g.querySelector('[data-fix-tally]') || {}).innerText || '', more: !!g.querySelector('[data-fix-more]'),
        rows: Array.from(g.querySelectorAll('[data-fix-row]')).map(r => ({id: r.dataset.id, cells: Array.from(r.querySelectorAll('td')).map(td => td.innerText.trim())}))}; }""", what)

def open_row(pg, what, i):
    """the document's button: Look up opens with that entry found and opened; then back to the list"""
    pg.evaluate("(a) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === a[0]); g.querySelectorAll('[data-fix-row]')[a[1]].querySelector('[data-fix-open]').click(); }", [what, i])
    try: pg.wait_for_function("() => S.booksTab === 'lookup' && S.lk && !S.lk.busy && S.lk.res", timeout=30000, polling=100)
    except Exception: pass
    wait_idle(pg, 200)
    return pg.evaluate("() => ({tab: S.booksTab, q: S.lk && S.lk.q, rows: S.lk && S.lk.res ? S.lk.res.rows.map(r => r.id) : [], open: S.lk ? Object.keys(S.lk.open || {}).filter(k => S.lk.open[k]) : [], shown: !!document.querySelector('#app tr.lk-v.open'), guard: document.querySelectorAll('#app [data-guard]').length})")

def click_cell(pg, key):
    pg.click('#app [data-cell="%s"]' % key); wait_idle(pg, 400)

def check_month(pg, key, n, tag, rows_each=None, big=False):
    """a red cell clicked: the list, its count, its groups, each document opening"""
    t0 = time.time(); click_cell(pg, key); dt = time.time() - t0
    p = panel(pg); form, ym = key.split("|")
    ok(p is not None and p["n"] == n and p["sub"] == "fix" and p["ym"] == ym and p["hash"].endswith("/fix"),
       "%s %s: one click opens the month's What to fix with the grid's count %s (%s, %.1f s)" % (tag, key, n, p and {k: p[k] for k in ("n", "ret", "hash", "head")}, dt))
    ok(pg.evaluate(GUARD) == 0, "%s %s: no error box on What to fix" % (tag, key))
    if not p: return p
    ok(sum(g[1] for g in p["groups"]) == n and all(" — %d " % g[1] in g[2] + " " for g in p["groups"]), "%s %s: the groups add up to %d, each says its count (%s)" % (tag, key, n, p["groups"]))
    tab = pg.evaluate("() => (document.querySelector('#app [data-sub=\"fix\"]') || {}).innerText || ''")
    ok(tab == "What to fix (%d)" % n, "%s %s: the tab says What to fix (%d) (%r)" % (tag, key, n, tab))
    for what, gn, label in p["groups"]:
        g = open_group(pg, what)
        shown = len(g["rows"]) if g else 0
        ok(g and shown == min(gn, 100) and (g["more"] == (gn > 100)) and g["why"] and g["tally"] and all(len(r["cells"]) >= 5 and r["cells"][0] and r["cells"][3] for r in g["rows"]),
           "%s %s: %r opens to its %d documents (date, number, party, amount), the reason and the field in Tally (%s)" % (tag, key, label, gn, g and {"shown": shown, "why": g["why"][:80], "tally": g["tally"][:90], "first": g["rows"][:1]}))
        if not g: continue
        idx = list(range(shown)) if rows_each is None else sorted(set([0, shown - 1][:rows_each]))
        for i in idx:
            rid = g["rows"][i]["id"]
            r = open_row(pg, what, i)
            ok(r["tab"] == "lookup" and rid in r["rows"] and rid in r["open"] and r["shown"] and r["guard"] == 0,
               "%s %s: %s document %d (%s) opens in Look up, found and opened (%s)" % (tag, key, label.split(" — ")[0], i + 1, " / ".join(g["rows"][i]["cells"][:3]), {k: r[k] for k in ("tab", "q", "open", "guard")} if not (rid in r["rows"]) else "ok"))
            pg.go_back(); wait_idle(pg, 400)
            back = panel(pg)
            if not (back and back["n"] == n):   # the address did not bring the list back: open it as the grid does
                ok(False, "%s %s: the browser's back from Look up returns to What to fix (%s)" % (tag, key, back and back["hash"]))
                year(pg, pg.evaluate("S.gstReg"), ym); click_cell(pg, key)
            open_group(pg, what)
    return p

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)

        # ---- the fixture, with errors planted: a buyer's GSTIN with a wrong check digit and an invoice number too long in
        # Apr-2025 and Jul-2025; Feb-2026's 3B has two purchases with no supplier GSTIN of its own
        before = {m: pg.evaluate(ALLCHECKS, [m, "07"]) for m in ["202509", "202602"]}
        pg.evaluate("(a) => { const v = (" + SALE + ")(a); v.gstin = '07AAJFQ3158R1ZJ'; }", "LFE/25-26/001")
        pg.evaluate("(a) => { (" + SALE + ")(a).no = 'LFE/2025-26/000001'; }", "LFE/25-26/006")
        months = pg.evaluate("() => GSTR.months().filter(m => m >= '202504' && m <= '202603')")
        year(pg, "07", "202603")
        cs = cells(pg)
        # 2. the grid's count and the list's are one: for every month of the year, both returns
        same = []
        for key, st, n in cs:
            form, ym = key.split("|")
            if form not in ("GSTR-1", "IFF", "GSTR-3B") or len(ym) != 6: continue
            c = pg.evaluate(COUNTS, [ym, "07"]); want = c["r3b" if form == "GSTR-3B" else "r1"]; lst = c["l3" if form == "GSTR-3B" else "l1"]
            same.append((key, n, want, lst, st))
        ok(all((n or 0) == w == l and ((st == "bad") == (w > 0) or st == "filed") for key, n, w, l, st in same) and len(same) >= 24,
           "every month of 2025-26: the grid's Errors N = errorsFor = the list's own count (%s)" % [x for x in same if x[1]][:6])
        err_cells = [(k, n) for k, st, n in cs if n]
        ok(any(k == "GSTR-1|202504" for k, n in err_cells) and any(k == "GSTR-3B|202602" for k, n in err_cells), "the planted errors show red: %s" % err_cells)

        # 1. GSTR-1 Apr-2025: one click, the list, each document opens
        n1 = dict(err_cells)["GSTR-1|202504"]
        p1 = check_month(pg, "GSTR-1|202504", n1, "fixture")
        names = [g[0] for g in (p1 or {}).get("groups", [])]
        labels = [g[2] for g in p1["groups"]] if p1 else []
        ok("Buyer GSTINs that are not valid" in names and any(l.startswith("Buyer GSTIN not valid — 1 invoice") for l in labels), "Apr-2025: the planted error is its group, in plain words (%s)" % labels)
        year(pg, "07", "202603")
        p7 = check_month(pg, "GSTR-1|202507", dict(err_cells)["GSTR-1|202507"], "fixture")
        labels = [g[2] for g in (p7 or {}).get("groups", [])]
        ok(any(l.startswith("Invoice number too long — 1 invoice") for l in labels), "Jul-2025: the 18-character number is its group, in plain words (%s)" % labels)
        g = open_group(pg, "Invoice numbers longer than 16 characters")
        ok(g and "LFE/2025-26/000001" in " ".join(g["rows"][0]["cells"]) and "Voucher No." in g["tally"], "the long number's row, and in Tally the voucher's Voucher No. (%s)" % (g and [g["rows"][:1], g["tally"]]))
        year(pg, "07", "202504"); click_cell(pg, "GSTR-1|202504")
        g = open_group(pg, "Buyer GSTINs that are not valid")
        ok(g and "07AAJFQ3158R1ZJ" in " ".join(g["rows"][0]["cells"]) and "LFE/25-26/001" in " ".join(g["rows"][0]["cells"]) and "GSTIN/UIN" in g["tally"],
           "the bad GSTIN's row: the invoice, the GSTIN, and in Tally the party ledger's GSTIN/UIN (%s)" % g)
        # 2. the panel on top of the other tabs, the same count
        for sub in ("summary", "details", "diff", "file"):
            pg.evaluate("(s) => gstSubGo(s)", sub); wait_idle(pg, 300)
            top = pg.evaluate("() => { const t = document.querySelector('#app [data-fix-top]'); return t ? [+t.dataset.fixN, t.innerText.replace(/\\s+/g, ' ').slice(0, 160)] : null; }")
            ok(top and top[0] == n1 and ("What to fix (%d)" % n1) in top[1], "GSTR-1 Apr-2025 %s tab: What to fix (%d) on top (%s)" % (sub, n1, top))
        pg.evaluate("() => document.querySelector('#app [data-fix-top] [data-fix-see]').click()"); wait_idle(pg, 300)
        ok(pg.evaluate("S.gstSub") == "fix", "its See the list opens What to fix")
        # 4. back to the year
        back = pg.evaluate("() => { const b = document.querySelector('#app [data-back-year]'); return b ? b.innerText : null; }")
        ok(back and "Back to the year" in back, "the month has a visible ← Back to the year (%r)" % back)
        pg.click("#app [data-back-year]"); wait_idle(pg, 300)
        ok(pg.evaluate("S.gstView") == "year" and pg.evaluate("!!document.querySelector('#app [data-gst-grid]')"), "← Back to the year: the grid again")

        # 3. GSTR-3B Feb-2026: the purchase side's errors, the same way
        n3 = dict(err_cells)["GSTR-3B|202602"]
        p3 = check_month(pg, "GSTR-3B|202602", n3, "fixture")
        ok(p3 and p3["ret"] == "r3b" and [g[0] for g in p3["groups"]] == ["Purchases with no supplier GSTIN"] and p3["groups"][0][2].startswith("Supplier GSTIN missing — %d purchase" % n3),
           "Feb-2026 3B: Supplier GSTIN missing — %d purchases (%s)" % (n3, p3 and p3["groups"]))
        g = open_group(pg, "Purchases with no supplier GSTIN")
        ok(g and "supplier" in g["tally"].lower() and "GSTIN/UIN" in g["tally"], "3B: the field to correct in Tally is the supplier ledger's GSTIN/UIN (%s)" % (g and g["tally"]))
        # a month with no errors: no panel, no tab; a cell that is not red opens the return as before
        year(pg, "07", "202603")
        clean = next((k for k, st, n in cells(pg) if st == "ready" and k.startswith("GSTR-1|")), None)
        if clean:
            click_cell(pg, clean)
            ok(pg.evaluate("S.gstSub") == "summary" and not pg.evaluate("!!document.querySelector('#app [data-fix-top], #app [data-sub=\"fix\"]')"), "%s, nothing to fix: the return opens on Summary, no What to fix" % clean)
        # the address keeps the list: a reload of .../r1/fix is the list again
        year(pg, "07", "202504"); click_cell(pg, "GSTR-1|202504")
        h = pg.evaluate("location.hash"); pg.evaluate("() => { location.hash = '#/'; }"); wait_idle(pg, 300); pg.evaluate("(h) => { location.hash = h; }", h); wait_idle(pg, 600)
        p = panel(pg); ok(p and p["n"] == n1, "the address %s opens What to fix again (%s)" % (h, p and p["n"]))
        # nothing changed in the rules: the checks of untouched months are as they were
        ok(pg.evaluate(ALLCHECKS, ["202509", "07"]) == before["202509"] and pg.evaluate(ALLCHECKS, ["202602", "07"]) == before["202602"], "the checks of Sep-2025 and Feb-2026 are as before (no rule changed)")

        # ---- large books: the fixture's large client, 14 copies over two years
        if BIG:
            t0 = time.time()
            seed = pg.evaluate("""async () => {
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
              return {n: out.length, from: b.meta.from, to: b.meta.to}; }""")
            print("  large books: %s in %.1f s" % (seed, time.time() - t0), flush=True)
            ok(seed["n"] > 50000, "large books loaded: %d entries" % seed["n"])
            for fy_ym in ("202610", "202603"):
                t0 = time.time(); year(pg, "07", fy_ym); dt = time.time() - t0
                cs = cells(pg)
                ok(pg.evaluate(GUARD) == 0 and cs, "large books, the year of %s: the grid drawn, no error box (%.1f s)" % (fy_ym, dt))
                same = []
                for key, st, n in cs:
                    form, ym = key.split("|")
                    if form not in ("GSTR-1", "IFF", "GSTR-3B") or len(ym) != 6: continue
                    c = pg.evaluate(COUNTS, [ym, "07"]); same.append((key, n or 0, c["r3b" if form == "GSTR-3B" else "r1"], c["l3" if form == "GSTR-3B" else "l1"], c["g3" if form == "GSTR-3B" else "g1"]))
                ok(all(n == w == l for key, n, w, l, g in same), "large books: every cell's Errors N = errorsFor = the list's count (%s)" % [x[:4] for x in same if x[1]][:8])
                for key, n, w, l, g in same:
                    if n: print("    %s: %d = %s" % (key, n, " + ".join("%s %d" % (a, b) for a, b in g)), flush=True)
                red = [(k, n) for k, n, w, l, g in same if n]
                # every red cell of the year: one click, no error box, the count; its groups opened, the first and last
                # document of each opened in Look up
                for key, n in red:
                    year(pg, "07", fy_ym)
                    check_month(pg, key, n, "large", rows_each=2, big=True)
                    pg.evaluate("() => gstSubGo('summary')"); wait_idle(pg, 300)
                    ok(pg.evaluate(GUARD) == 0 and pg.evaluate("() => +((document.querySelector('#app [data-fix-top]') || {dataset: {}}).dataset.fixN || 0)") == n, "large %s Summary: What to fix (%d) on top, no error box" % (key, n))
                    pg.click("#app [data-back-year]"); wait_idle(pg, 300)
                    ok(pg.evaluate(GUARD) == 0 and pg.evaluate("S.gstView") == "year", "large %s: ← Back to the year, no error box" % key)
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
