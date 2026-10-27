"""python3 run_tds_overlap.py - next-tds-early (20-Oct-2026; the owner on the live Deductions page: "Name is overriding
another column"). On the made-up books of run_tds_challans.py (Q1 2026-27) with long deductee names ("ET INFRA
DEVELOPERS PRIVATE LIMITED (CIVIL AND STRUCTURAL WORKS DIVISION)", one name of a single 60-letter word), at 1366, 1440 and
a phone's width, on every TDS deductions table (the challan's table, + Add deduction's two lists, the Deductions register's two tabs (next-tds-register),
24Q's challan table and register):
  1. no cell's content runs out of its cell: scrollWidth <= clientWidth + 1, and the box of what is in it (its text and
     its chips and buttons) stays inside the cell, so nothing lies over the next column;
  2. the name cell is at most about 32 characters wide and wraps between words to at most 2 lines (the rest cut with an
     ellipsis, the whole name on a hover);
  3. a problem's chip is in a column of its own, never in the name cell.
TDS_OVERLAP_SHOTS=dir: screenshots (default tests/out/tds-overlap)."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8263
SHOTS = os.environ.get("TDS_OVERLAP_SHOTS") or os.path.join(HERE, "out", "tds-overlap"); os.makedirs(SHOTS, exist_ok=True)
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
LONG = "ET INFRA DEVELOPERS PRIVATE LIMITED (CIVIL AND STRUCTURAL WORKS DIVISION)"
WORD = "SUPERCALIFRAGILISTICEXPIALIDOCIOUSCONSTRUCTIONSANDINFRAPVTLTD"
# long names on April's first two 194C deductions, on April's first 192 (24Q) and on a May 194C (on no challan)
NAMES = """([a, b]) => { const V = S.books.vouchers, ren = (id, n) => { const v = V.find(x => x.id === id), old = v.party; v.party = n; v.ent.forEach(e => { if (e.l === old) e.l = n; }); };
  ren('v1', a); ren('v2', b); ren('v31', a + ' (SALARY)'); ren('v9', a); ren('v10', b); S.books.map = Books.mapLedgers(V, {}); window.__bk = S.books; TDSReg.forget(); render(); }"""
# April's 194C on chA, April's 194J on chJ, April's 192 on chS (a 192 challan), June's first 194C on chM (dated before it: an advance challan)
ALLOC = """() => { const rows = TDS.allRows(), of = (sec, ym) => rows.filter(r => TDS.sec(r.section) === sec && TDS.ymd(r.date).slice(0, 6) === ym).map(r => r.id);
  const a = {}; of('194C', '202604').forEach(id => a[id] = 'chA'); of('194J', '202604').forEach(id => a[id] = 'chJ'); of('192', '202604').forEach(id => a[id] = 'chS');
  S.books.challans.push({id: 'chS', bsr: '0510308', serial: '00501', date: '20260507', tax: 26520, interest: 0, section: '192', minorHead: '200'});
  a[of('194C', '202606')[0]] = 'chM'; S.books.alloc = a; TDSReg.forget(); render(); }"""
GO = "([form, ch, add]) => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = form; S.tdsTab = 'deductions'; S.tdsDedView = ''; S.tdsWinRet = TDSReg.key(form, '2026-27', 'Q1'); S.tdsWinCh = ch.startsWith('reg:') ? '' : ch; S.tdsDedReg = ch.startsWith('reg:') ? ch.slice(4) : ''; S.tdsDregSel = {}; S.tdsWinAdd = add || ''; S.tdsWinSel = {}; S.tdsCF = {}; render(); }"
# every cell of the deductions tables shown: [table, row, col, text, scrollW, clientW, contentLeft, contentRight, cellLeft, cellRight]
CELLS = """() => { const out = [];
  document.querySelectorAll('table[data-wd-table], table[data-wd-none], table[data-wd-others], table.dt-table, table.dreg-table').forEach(t => {
    const tk = t.dataset.wdTable ? 'table' : t.hasAttribute('data-wd-none') ? 'add-none' : t.hasAttribute('data-wd-others') ? 'add-other' : t.classList.contains('dreg-table') ? 'register' : 'todo';
    t.querySelectorAll(':scope > tbody > tr').forEach((tr, ri) => [...tr.children].forEach((td, ci) => {
      if (td.colSpan > 1 || !td.offsetWidth) return;
      const c = td.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(td);
      let L = c.left, R = c.right; const rs = [...rg.getClientRects()].filter(x => x.width > 0.5);
      td.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width > 0.5 && getComputedStyle(e).position !== 'fixed') rs.push(r); });
      if (rs.length) { L = Math.min(...rs.map(x => x.left)); R = Math.max(...rs.map(x => x.right)); }
      out.push([tk, ri, ci, (td.innerText || '').trim().slice(0, 40), td.scrollWidth, td.clientWidth, L, R, c.left, c.right]); }));
  }); return out; }"""
NAME = """(long) => [...document.querySelectorAll('[data-wd-name], td.dt-p, td.dreg-name')].filter(td => td.offsetWidth && (td.innerText || '').indexOf(long.slice(0, 12)) >= 0).map(td => {
  const el = td.querySelector('[data-row-detail], .dt-name, span[title]') || td, cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
  const ch = (() => { const s = document.createElement('span'); s.textContent = '0'; s.style.font = cs.font; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; })();
  return {w: td.getBoundingClientRect().width, ch, lines: Math.round(el.getBoundingClientRect().height / lh), title: el.getAttribute('title') || td.getAttribute('title') || '',
    chip: !!td.querySelector('.wd-chip:not(.wd-noname *), .dt-flag')}; })"""
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    br = p.chromium.launch()
    for (vw, vh, tag) in [(1366, 900, "1366"), (1440, 950, "1440"), (390, 844, "phone")]:
        print("%s (%dx%d)" % (tag, vw, vh))
        pg = br.new_page(viewport={"width": vw, "height": vh}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        J(BOOKS_JS); pg.wait_for_timeout(600); J("() => { TDSMatch.online = () => false; }")
        J(CHALLANS); J(NAMES, [LONG, WORD]); J(ALLOC); pg.wait_for_timeout(500)
        for (form, ch, add, what) in [("26Q", "chA", "", "the challan's table"), ("26Q", "chA", "chA", "+ Add deduction"), ("26Q", "chM", "", "a challan with an advance deduction"),
                                      ("26Q", "reg:pending", "", "the register's Pending tab"), ("26Q", "reg:mapped", "", "the register's Mapped tab"),
                                      ("24Q", "chS", "", "24Q's challan table"), ("24Q", "reg:pending", "", "24Q's register, Pending")]:
            J(GO, [form, ch, add]); pg.wait_for_timeout(700)
            cells = J(CELLS)
            pg.screenshot(path=os.path.join(SHOTS, "%s-%s-%s%s.png" % (tag, form, ch.strip("_").replace(":", "-"), "-add" if add else "")), full_page=True)
            over = [c for c in cells if c[4] > c[5] + 1]
            spill = [c for c in cells if c[6] < c[8] - 1 or c[7] > c[9] + 1]
            ok(len(cells) > 0 and not over, "%s %s: no cell's content wider than the cell (%d cells%s)" % (tag, what, len(cells), "; " + "; ".join("%s r%d c%d %r %d>%d" % (c[0], c[1], c[2], c[3], c[4], c[5]) for c in over[:4]) if over else ""))
            ok(not spill, "%s %s: nothing lies over the next column%s" % (tag, what, ": " + "; ".join("%s r%d c%d %r [%.0f..%.0f] in [%.0f..%.0f]" % (c[0], c[1], c[2], c[3], c[6], c[7], c[8], c[9]) for c in spill[:4]) if spill else ""))
            if form == "26Q" and ch == "chA" and not add:
                nm = J(NAME, LONG)
                ok(nm and all(n["w"] <= 34 * n["ch"] + 20 for n in nm), "%s the name cell at most about 32 characters wide (%s)" % (tag, [(round(n["w"]), round(n["ch"] * 32)) for n in nm]))
                ok(nm and all(n["lines"] <= 2 for n in nm) and all(LONG in n["title"] for n in nm), "%s the long name on at most 2 lines, the whole name on a hover (%s)" % (tag, [(n["lines"], n["title"][:30]) for n in nm]))
            if form == "26Q" and ch == "chM" and not add:
                nm = J(NAME, "ZZ Contractor")
                chipcol = J("() => [...document.querySelectorAll('table[data-wd-table] tbody tr[data-wd-row]')].map(tr => [!!tr.querySelector('td.wd-name .wd-chip'), !!tr.querySelector('td.wd-flags .wd-chip')])")
                ok(chipcol and not any(x[0] for x in chipcol) and any(x[1] for x in chipcol), "%s the chip in a column of its own, not in the name cell (%s)" % (tag, chipcol))
        pg.close()
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
