"""python3 run_tds_clean.py - a TDS return's pages clean (round 94, next-tds-clean, 19-Oct-2026; the owner: "info is ok but
messy, lots of info double; shortcuts not required; Deductor, Deductee, Challan, Deduction can come horizontally; remove
double info anywhere; page should look clean"). On the fixture books (tdsgst_snapshot.py), in the React build
(app/dist-test, or TDSDESK_SITE):
  1. the frame: the steps are one row of tabs across the top (every tab on one line at 1366 and 1440, kept in view as the
     page scrolls), no left rail, no tabs at the foot (.rt-foot), no F-keys (F8 / F10 / F11 / F12 do nothing), no
     "Done: x of y ready", no "All challans of the year" button in the header (it is under ⋯); a phone keeps the select
  2. no summary strip (next-tds-tidy2, the owner: "TDS ₹… · On challans ₹… · Left ₹0.00 — we don't need that"; it was
     TDS · On challans · Left on every step of Forms 140, 144, 143 and 138)
  3. every figure once: on each step a scan of the words on the page finds the deduction count, the "not on a challan"
     count and the problem count ("N to fix") in one place only; Deductees: one PAN indicator a row and no count line;
     Challans: no help line, no "See all challans", no "Number of challans", "Used in all returns" only where it differs;
     Deductions: no "N not on a challan · Show" line and no "Challan amount" in the footer; Validate & file: one "fix the
     errors first" (no count in it); the TDS home: one All challans
  4. next-tds-tidy2 (20-Oct-2026): no filter bar, pill row, find box or filter select above a TDS table (Deductees, the
     Challans grid, Deductions by challan, all rows, the Add drawer's lists; Form 138's); the filters are funnels in the
     column headers, and "n of N" only in the table's foot while filtered; no "N deductions are on a challan dated before
     the deduction · Fix" line on Deductions (the row's chip and Validate & file's error stay); every TDS table aligned at
     1366 and 1440: figures right-aligned with tabular figures under right-aligned headings and on one line, dates one width
     on one line, text headings left
  5. the owner's 26Q rows (next-tds-tidy2, more): B. a Tally journal with no party ("Miscellaneous Expenses Dr / TDS Cr"):
     one plain line says why, Fix keeps what is typed while the page draws again, Save writes the name and PAN at once,
     kept with the books (synced), and the name is offered for another entry of the same ledgers; C. "Put N on the right
     challans" (only while some are on a challan dated before them): a list to confirm, each to the earliest challan of
     its section on or after it with enough left (else off, to Pay a challan), one Undo; D. a row's problem is a short chip,
     its words on a hover
TDS_CLEAN_SHOTS=dir: screenshots (default tests/out/tds-clean)."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_CLEAN_PORT") or 8394)
SHOTS = os.environ.get("TDS_CLEAN_SHOTS") or os.path.join(HERE, "out", "tds-clean"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
# B: two journals with no party in Tally (Leads, 30-Apr: "Miscellaneous Expenses Dr 3,000.10 / TDS 94J 10% Cr 3,000.10")
import copy
for i, (d, a) in enumerate((("20250430", 3000.10), ("20250530", 1500.00))):
    v = copy.deepcopy(next(x for x in books["vouchers"] if x["type"] == "Purchase"))
    v.update({"id": "zz-misc-%04d" % i, "date": d, "type": "Journal", "no": "J7%d" % i, "ref": "", "refDate": "", "party": "", "gstin": "", "narr": "", "hsn": [],
              "ent": [{"l": "Miscellaneous Expenses", "a": -a, "r": None}, {"l": "TDS on Professional 194J", "a": a, "r": None}]})
    books["vouchers"].append(v)

# the words a person sees in the return (the tab row apart): visible text nodes; in a select only the chosen option
WORDS = """() => { const rt = document.querySelector('#app .rt'); if (!rt) return '';
  const out = [], w = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement;
    if (!p || p.closest('[data-return-tabs], .sr-only, [hidden], details:not([open]) > :not(summary)')) continue;
    const sel = p.closest('select'); if (sel) { const o = p.closest('option'); if (!o || !o.selected) continue; }
    if (!p.getClientRects().length || getComputedStyle(p).visibility === 'hidden') continue;
    out.push(n.textContent); }
  return out.join(' ').replace(/\\s+/g, ' '); }"""
TABS = """() => [...document.querySelectorAll('#app [data-return-tabs] [data-ret-tab]')].map(b => { const r = b.getBoundingClientRect();
  return {id: b.dataset.retTab, top: Math.round(r.top), h: Math.round(r.height), shown: !!b.offsetParent, text: b.innerText.replace(/\\s+/g, ' ').trim(), dot: (b.querySelector('[data-tab-dot]') || {dataset: {}}).dataset.tabDot || ''}; })"""
STRIP = "() => [...document.querySelectorAll('#app [data-ret-strip] [data-fig]')].map(e => [e.dataset.fig, e.querySelectorAll('small').length])"

def count(rx, text): return len(re.findall(rx, text))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        J(LOAD, books); pg.wait_for_timeout(1000); J("S.books = window.__bk; render();"); pg.wait_for_timeout(500); J(CHALLANS); pg.wait_for_timeout(300)
        # one deduction on no challan, so a "not on a challan" count exists to be said (once)
        add = J("() => TDSAdd.save({party: 'ZZ Clean Vendor Ltd', section: '194C', date: '2026-06-10', paid: 10000, tds: 200})"); J("render()")
        ok(add.get("ok"), "a deduction on no challan added for the checks (%s)" % add)
        go = lambda form, step: (J("([f, s]) => { S.booksTab = 'tds'; tdsGo('2026-27', 'Q1', f); S.tdsTab = s; S.tdsDedView = ''; S.tdsChView = ''; S.tdsWinCh = ''; S.tdsDedReg = ''; render(); window.scrollTo(0, 0); }", [form, step]), pg.wait_for_timeout(500))

        print("1. the frame")
        for w in (1440, 1366):
            pg.set_viewport_size({"width": w, "height": 900})
            for form in ("26Q", "24Q", "27Q", "27EQ"):
                for step in ("deductor", "deductees", "challans", "deductions", "file"):
                    go(form, step); at = "%d %s %s" % (w, form, step)
                    t = J(TABS)
                    ok(len(t) >= 6 and all(x["shown"] for x in t) and max(x["top"] for x in t) - min(x["top"] for x in t) <= 2,
                       "%s: the steps in one row of tabs across the top (%s)" % (at, [(x["id"], x["top"]) for x in t]))
                    ok(J("document.querySelectorAll('#app .rt-rail, #app .rt-step, #app .rt-body').length") == 0, "%s: no left rail" % at)
                    ok(J("document.querySelectorAll('#app .rt-foot, #app [data-ret-foot], #app [data-foot-tab], #app .rt-fk').length") == 0, "%s: no tabs at the foot" % at)
                    hd = J("(document.querySelector('#app [data-return-card]') || {}).innerText || ''")
                    ok("Done:" not in hd and " ready" not in hd and not J("!!document.querySelector('#app [data-return-card] > [data-ret-allch]')"), "%s: the header has no Done: x of y ready and no All challans button" % at)
                    ok(J("document.documentElement.scrollWidth") <= w + 1, "%s: no sideways scroll" % at)
                    st = J(STRIP)
                    ok(not st and J("document.querySelectorAll('#app .rt-strip, #app [data-ret-strip]').length") == 0 and not re.search(r"On challans\s*₹", J(WORDS)),
                       "%s: no summary strip (TDS · On challans · Left) (%s)" % (at, st))
                    if step == "deductions" and form == "26Q": pg.screenshot(path=os.path.join(SHOTS, "deductions-%d.png" % w))
            go("26Q", "deductees")
            sel = J("""() => { const n = document.querySelector('#app [data-return-tabs]'); return n ? getComputedStyle(n).position : ''; }""")
            ok(sel == "sticky", "%d: the tab row stays in view as the page scrolls (position %s)" % (w, sel))
        pg.set_viewport_size({"width": 1440, "height": 900})
        # All challans of the year: under ⋯
        go("26Q", "challans")
        pg.click('#app [data-return-card] details.more > summary'); pg.wait_for_timeout(200)
        ok(pg.locator('#app [data-return-card] .more-pop [data-ret-allch]').count() == 1, "All challans of the year is under the header's ⋯")
        J("() => { const d = document.querySelector('#app [data-return-card] details.more'); if (d) d.open = false; }")

        # no F-keys: F8, F10, F11, F12 leave the step and are not taken from the browser
        for k in ("F8", "F10", "F11", "F12"):
            go("26Q", "file")
            prevented = J("(k) => { const e = new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true}); document.body.dispatchEvent(e); return e.defaultPrevented; }", k)
            pg.keyboard.press(k); pg.wait_for_timeout(250)
            ok(not prevented and J("S.tdsTab") == "file", "%s does nothing (step still Validate & file, the key not taken)" % k)

        print("2. every figure once")
        for form in ("26Q", "27Q", "27EQ", "24Q"):
            go(form, "file")
            n = J("() => +((document.querySelector('#app [data-problem-count]') || {dataset: {}}).dataset.problemCount || 0)")
            for step in ("deductor", "deductees", "challans", "deductions", "file"):
                go(form, step); at = "%s %s" % (form, step); txt = J(WORDS)
                tabs = {x["id"]: x for x in J(TABS)}
                if n:
                    k = count(r"\b%d (to fix|errors?|warnings?|problems?)\b" % n, txt)
                    ok(k == 1, "%s: the problem count %d said once, in the header (%d times: %s)" % (at, n, k, re.findall(r"[^.]{0,30}\b%d (?:to fix|errors?|warnings?|problems?)\b" % n, txt)))
                ok(count(r"\b\d+ (to fix)\b", txt) <= 1, "%s: one 'to fix' count" % at)
                NOTON = r"(?<![\d.,])\b\d+ [a-z ]{0,30}?(?:not matched|not on a challan|on no challan)|not on any challan \(\d+\)"   # a count, not a row's own "Not matched"
                ok(count(NOTON, txt.lower()) <= 1, "%s: the 'not on a challan' count at most once (%s)" % (at, re.findall(NOTON, txt.lower())))
                if step != "file":
                    dn = J("() => { const t = document.querySelector('#app [data-tab-count=\"deductions\"]'); return t ? +t.textContent : null; }")
                    if dn:
                        ok(count(r"\b%d (deductions|collections|salary payments|payments)\b" % dn, txt) == 0 and "Done:" not in txt, "%s: the deduction count %d only on its tab" % (at, dn))
                ok("Number of challans" not in txt and "Challan amount" not in txt and "See all challans" not in txt and "Click a challan" not in txt, "%s: no challan count line, no Challan amount, no See all, no help line" % at)
                if form == "26Q": pg.screenshot(path=os.path.join(SHOTS, "%s-1440.png" % step))
            go(form, "deductions")
            d = {x["id"]: x["dot"] for x in J(TABS)}
            ok(d.get("file") in ("bad", "warn") if n else True, "%s: Validate & file's tab has a dot while there is something to fix (%s)" % (form, d))

        go("26Q", "deductees")
        heads = [h.strip() for h in pg.locator('#app #tdsDeTable thead th').all_inner_texts()]
        per = J("() => [...document.querySelectorAll('#app #tdsDeTable tbody tr')].map(tr => tr.querySelectorAll('[data-pan-box], .tag[data-pan-state]').length)")
        ok("PAN status" not in heads and per and max(per) == 1, "Deductees: one PAN indicator a row, no PAN status column (%s, %s)" % (heads, per))
        ok(pg.locator('#app [data-dee-count]').count() == 0, "Deductees: no count line under the table")
        go("26Q", "challans")
        heads = [h.strip() for h in pg.locator('#app table.chg-table thead th').all_inner_texts()]
        # next-tds-early: rule f may suggest a later challan of the year another quarter uses (its balance left), so the column is
        # there only while some challan's use differs from this return's
        diff = J("() => { const hs = [...document.querySelectorAll('#app table.chg-table thead th')].map(h => h.innerText.trim()), a = hs.indexOf('Used here'), b = hs.indexOf('Used in all returns'); return b < 0 ? 0 : [...document.querySelectorAll('#app table.chg-table tbody tr')].filter(tr => tr.children[a] && tr.children[b] && tr.children[a].innerText.trim() !== tr.children[b].innerText.trim()).length; }")
        ok("Used in all returns" not in heads or diff > 0, "Challans: Used in all returns only where some challan's use differs from this return's (%s, %d differ)" % (heads, diff))
        go("26Q", "deductions")
        ok(pg.locator('#app [data-wd-unplaced]').count() == 0, "Deductions: no 'N not on a challan · Show' line (the picker has it)")
        ft = J("(document.querySelector('#app [data-wd-foot]') || {}).innerText || ''")
        ok(ft and "Challan amount" not in ft and "Used here" in ft and "Balance" in ft, "Deductions: the footer without Challan amount (%s)" % ft.replace("\n", " "))
        go("26Q", "file")
        why = J("(document.querySelector('#app [data-make-why]') || {}).innerText || ''")
        # next-tds-validate-short: a deduction on no challan is no error: the file is made without it, the File row says so
        left = J("(document.querySelector('#app [data-file-left]') || {}).innerText || ''")
        ok(((why and not re.search(r"\d", why)) or (not why and left.startswith("Left out of the file: 1 on no challan"))) and J("document.querySelectorAll('#app [data-validate] .vf-counts [data-val-errors], #app [data-validate] .vf-counts .bad').length") == 0,
           "Validate & file: 'fix the errors first' with no count, or (no error) what the file leaves out (%s %s)" % (why, left[:60]))
        J("() => { S.booksTab = 'tds'; tdsGo('2026-27'); }"); pg.wait_for_timeout(600)
        allch = J("() => [...document.querySelectorAll('#app button, #app a')].filter(b => b.offsetParent && /all challans/i.test(b.innerText)).map(b => b.innerText.trim())")
        ok(len(allch) == 1, "the TDS home: one All challans (%s)" % allch)


        print("4. filters in the column headers only; no before-challan banner; columns aligned (next-tds-tidy2)")
        # what sits above a table as a filter: a find box, Show pills, a filter bar, a filter select (the challan picker is no filter)
        BARS = """(root) => { const r = document.querySelector(root); if (!r) return ['no ' + root];
          return [...r.querySelectorAll('input[type=search], .segs, .seg, .wd-filters, .revfilter, [data-filter-bar], [data-wd-f], [data-dee-show], [data-ded-show], select')]
            .filter(e => e.offsetParent && !e.closest('thead, .colpop, [data-cell-input], .wd-top, td, [data-pan-box], .cm-chsel, .rt-railsel'))
            .map(e => e.tagName + '.' + (e.className || '') + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : '')); }"""
        HF = "(root) => [...document.querySelectorAll(root + ' thead [data-cf], ' + root + ' thead .hf-sel')].filter(e => e.offsetParent).length"
        ALIGN = r"""(root) => { const out = {num: [], head: [], wrap: [], text: [], dates: [], tab: []}, vis = (e) => !!e.offsetParent;
          const lines = (node) => { const r = document.createRange(); r.selectNodeContents(node); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
          const first = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.trim() && n.parentElement.offsetParent && !n.parentElement.closest('.colf, .wd-chip, .tag, small, button.icon')) return n; return null; };
          const right = (e) => /right|end/.test(getComputedStyle(e).textAlign);
          for (const t of [...document.querySelectorAll(root + ' table.bk-table')].filter(vis)) {
            const hs = [...t.querySelectorAll(':scope > thead > tr:last-child > th')], id = t.id || t.className.split(' ').slice(1, 3).join('.');
            hs.forEach((h, i) => { const lab = h.innerText.trim();
              if (h.classList.contains('n')) { if (lab && !right(h)) out.head.push(id + ': ' + lab); }
              else if (h.classList.contains('dt')) { out.dates.push([id + ': ' + lab, Math.round(h.getBoundingClientRect().width)]); }
              else if (lab && !h.classList.contains('ck') && !h.classList.contains('ac') && right(h)) out.text.push(id + ': ' + lab); });
            t.querySelectorAll(':scope > tbody > tr').forEach((tr) => { if (tr.children.length !== hs.length) return; [...tr.children].forEach((td, i) => {
              const h = hs[i]; if (!h || !(h.classList.contains('n') || h.classList.contains('dt'))) return; const f = first(td); if (!f || !/\d/.test(f.textContent)) return;
              if (h.classList.contains('n') && !right(td)) out.num.push(id + ': ' + f.textContent.trim());
              if (h.classList.contains('n') && !/tabular-nums/.test(getComputedStyle(td).fontVariantNumeric)) out.tab.push(id + ': ' + f.textContent.trim());
              if (lines(f) > 1) out.wrap.push(id + ': ' + f.textContent.trim()); }); }); }
          return out; }"""
        def tidy_go(form, step, extra=""):
            go(form, step)
            if extra: J(extra); pg.wait_for_timeout(400)
        CHOSE = "() => { const c = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan)[0]; S.tdsWinCh = c ? c.challan : ''; S.tdsDedView = ''; render(); }"
        VIEWS = [("26Q deductees", "26Q", "deductees", ""), ("26Q challans", "26Q", "challans", ""), ("26Q deductions", "26Q", "deductions", CHOSE),
                 ("26Q all rows", "26Q", "deductions", "() => { S.tdsDedView = 'table'; render(); }"), ("24Q deductees", "24Q", "deductees", ""),
                 ("24Q deductions", "24Q", "deductions", ""), ("27Q deductions", "27Q", "deductions", CHOSE.replace("TDS.rows()", "TDS.nrRows()"))]
        dws = []
        for w in (1440, 1366):
            pg.set_viewport_size({"width": w, "height": 900})
            for name, form, step, extra in VIEWS:
                tidy_go(form, step, extra); at = "%d %s" % (w, name)
                b = J(BARS, "#app .rt-main")
                ok(not b, "%s: no filter bar, pills, find box or filter select above the table (%s)" % (at, b))
                if J("document.querySelectorAll('#app .rt-main table.bk-table tbody tr').length") >= 2:
                    ok(J(HF, "#app .rt-main") > 0, "%s: the filters are in the column headers (%d)" % (at, J(HF, "#app .rt-main")))
                a = J(ALIGN, "#app .rt-main")
                ok(not a["head"] and not a["num"] and not a["tab"], "%s: figures right-aligned with tabular figures, their headings right-aligned (%s)" % (at, {k: a[k][:3] for k in ("head", "num", "tab")}))
                ok(not a["wrap"], "%s: no figure or date on two lines (%s)" % (at, a["wrap"][:4]))
                ok(not a["text"], "%s: text headings left-aligned (%s)" % (at, a["text"][:4]))
                dws += [tuple(x) for x in a["dates"]]
                if w == 1440 and name in ("26Q deductees", "26Q challans", "26Q deductions"): pg.screenshot(path=os.path.join(SHOTS, "tidy2-%s.png" % name.replace(" ", "-")))
            # the Add drawer's lists
            tidy_go("26Q", "deductions", CHOSE); pg.click("#app [data-wd-add-open]"); pg.wait_for_timeout(500)
            b = J(BARS, "[data-wd-addlist]")
            ok(not b, "%d the Add drawer: no filter bar above its lists (%s)" % (w, b))
            ok(J(HF, "[data-wd-addlist]") > 0, "%d the Add drawer: its lists' filters in the column headers" % w)
            a = J(ALIGN, "[data-wd-addlist]")
            ok(not a["head"] and not a["num"] and not a["wrap"], "%d the Add drawer: figures right-aligned, on one line (%s)" % (w, {k: a[k][:3] for k in ("head", "num", "wrap")}))
            dws += [tuple(x) for x in a["dates"]]
            J("() => { S.tdsWinAdd = ''; render(); }"); pg.wait_for_timeout(300)
        ok(dws and max(x[1] for x in dws) - min(x[1] for x in dws) <= 2, "every date column one width (%s)" % sorted(set(dws), key=lambda x: x[1])[-3:])
        pg.set_viewport_size({"width": 1440, "height": 900})

        # a filter set in a heading: the rows narrowed, "n of N" in the table's foot only
        tidy_go("26Q", "deductees")
        n0 = J("document.querySelectorAll('#app #tdsDeTable tbody tr').length")
        nm = J("([...document.querySelectorAll('#app #tdsDeTable tbody tr .linkbtn')].map(b => b.innerText.trim()).filter(t => t.length > 5)[0]) || ''")
        pg.click('#app #tdsDeTable thead [data-cf="dee:name"]'); pg.wait_for_timeout(200)
        pg.fill('[data-cf-pop="dee:name"] input[type=search]', nm[:6]); pg.wait_for_timeout(400)
        n1 = J("document.querySelectorAll('#app #tdsDeTable tbody tr').length")
        sh = J("(document.querySelector('#app #tdsDeTable tfoot [data-cf-shown]') || {dataset: {}}).dataset.cfShown || ''")
        ok(0 < n1 < n0 and sh == "%d|%d" % (n1, n0), "Deductees › Name filter: %d of %d shown, said in the foot (%s)" % (n1, n0, sh))
        ok(J("document.querySelectorAll('#app .rt-main [data-cf-shown]').length") == 1 and J("!!document.querySelector('#app #tdsDeTable thead [data-cf=\"dee:name\"].on')"), "the count only in the foot; the funnel shows the filter is on")
        pg.keyboard.press("Escape"); pg.click('#app #tdsDeTable tfoot [data-cf-clearall]'); pg.wait_for_timeout(300)
        ok(J("document.querySelectorAll('#app #tdsDeTable tbody tr').length") == n0 and J("document.querySelectorAll('#app [data-cf-shown]').length") == 0, "Clear filters: every row back, no count")
        # an amount filter in a heading: Deductees › TDS from the largest
        tidy_go("26Q", "deductees")
        mx = J("Math.max(...[...document.querySelectorAll('#app #tdsDeTable tbody tr td:last-child')].map(td => +td.innerText.replace(/[^\\d.]/g, '')))")
        pg.click('#app #tdsDeTable thead [data-cf="dee:tds"]'); pg.wait_for_timeout(200)
        pg.fill('[data-cf-pop="dee:tds"] [data-cf-min]', str(mx)); pg.wait_for_timeout(400)
        r1 = J("document.querySelectorAll('#app #tdsDeTable tbody tr').length")
        ok(0 < r1 < n0 and J("!!document.querySelector('#app #tdsDeTable tfoot [data-cf-shown]')"), "Deductees › TDS from ₹%s: %d of %d rows, the count in the foot" % (mx, r1, n0))
        pg.keyboard.press("Escape"); J("() => { S.tdsCF = {}; render(); }"); pg.wait_for_timeout(200)
        # the challan's table: its Name filter; the count in the footer
        tidy_go("26Q", "deductions", CHOSE)
        r0 = J("document.querySelectorAll('#app [data-wd-table] tbody tr[data-wd-row]').length")
        pg.click('#app [data-wd-table] thead [data-cf="wd-table:name"]'); pg.wait_for_timeout(200)
        pg.fill('[data-cf-pop="wd-table:name"] input[type=search]', "zzqq-none"); pg.wait_for_timeout(400)
        sh = J("(document.querySelector('#app [data-wd-foot] [data-cf-shown]') || {dataset: {}}).dataset.cfShown || ''")
        ok(r0 > 0 and J("document.querySelectorAll('#app [data-wd-table] tbody tr[data-wd-row]').length") == 0 and sh == "0|%d" % r0, "Deductions › Name: none shown, '0 of %d' in the footer (%s)" % (r0, sh))
        pg.keyboard.press("Escape"); J("() => { S.tdsCF = {}; render(); }"); pg.wait_for_timeout(200)

        # no "N deductions are on a challan dated before the deduction · Fix" line; the chip and the error stay
        early = J("() => { const ch = {}; TDS.challans().forEach(c => { ch[c.id] = c; }); return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && ch[r.challan] && TDS.ymd(r.date) > TDS.ymd(ch[r.challan].date)).map(r => r.challan); }")
        ok(len(early) > 0, "the fixture has deductions on a challan dated before them (%d)" % len(early))
        J("(c) => { S.tdsWinCh = c; render(); }", early[0]); pg.wait_for_timeout(300)
        txt = J(WORDS)
        ok(J("document.querySelectorAll('#app [data-wd-early-n], #app [data-wd-early-show]').length") == 0 and not re.search(r"\d+ (deductions? (are|is)|collections? (are|is)) on a challan dated before", txt),
           "Deductions: no 'N deductions are on a challan dated before the deduction · Fix' line")
        # next-tds-early (the owner, 20-Oct-2026; Protean's FVU takes it): a challan of the same year dated before the deduction is
        # an advance challan: a neutral chip, no error in Validate & file
        chips = J("[...document.querySelectorAll('#app [data-wd-table] .wd-chip')].map(e => e.className + ':' + e.dataset.wdChip)")
        ok("wd-chip info:adv" in chips and not [x for x in chips if "bad" in x and not x.endswith((":sec", ":undefined"))], "the row's chip: Advance challan, a neutral chip, no error chip (%s)" % chips[:6])
        go("26Q", "file")
        ok(not J("!!document.querySelector('#app [data-val-item=early][data-val-level=error]')"), "Validate & file: no error for an advance challan")

        print("5. the owner's 26Q rows: no party, early challans, short chips")
        # next-tds-register: the deductions on no challan are in the Deductions register's Pending tab
        go("26Q", "deductions"); mid = J("() => (TDS.rows().find(r => r.fy === '2026-27' && r.q === 'Q1' && String(r.id).startsWith('zz-misc-0000')) || {}).id || ''")
        # the tab it is in: Pending on no challan, Mapped on one
        J("(id) => { S.tdsDedReg = TDS.rows().find(r => r.id === id).challan ? 'mapped' : 'pending'; render(); }", mid); pg.wait_for_timeout(400)
        why = J("(id) => (document.querySelector('[data-dreg] [data-wd-name-why=\"' + CSS.escape(id) + '\"]') || {}).innerText || ''", mid)
        ok(mid and why == "Tally entry has no party (Miscellaneous Expenses → TDS on Professional 194J). Type who was paid.", "B. the row says why in one line (%s)" % why)
        pg.click('[data-dreg] [data-wd-namefix="%s"]' % mid); pg.wait_for_timeout(200)
        pg.locator('[data-dreg] [data-wd-name-input="%s"]' % mid).click(); pg.keyboard.type("Ravi Kumar & Associates", delay=10)
        J("() => render()"); pg.wait_for_timeout(300)   # the page draws again (live sync, a toast)
        kept = J("(id) => (document.querySelector('[data-dreg] [data-wd-name-input=\"' + CSS.escape(id) + '\"]') || {}).value || ''", mid)
        ok(kept == "Ravi Kumar & Associates", "B. what is typed stays while the page draws again (%s)" % kept)
        pg.fill('[data-dreg] [data-wd-name-pan="%s"]' % mid, "AAKFR1234Q"); pg.click('[data-dreg] [data-wd-name-save="%s"]' % mid); pg.wait_for_timeout(500)
        got = J("(id) => { const r = TDS.rows().find(x => x.id === id) || {}; return [r.party, r.pan]; }", mid)
        ok(got == ["Ravi Kumar & Associates", "AAKFR1234Q"], "B. Save: the name and PAN at once (%s)" % got)
        ok(J("(id) => !document.querySelector('[data-dreg] [data-wd-noname=\"' + CSS.escape(id) + '\"]')", mid), "B. the row no longer says Name missing")
        ok(J("(id) => { const w = BookSync.work(S.books); return !!(w.tdsEdits && w.tdsEdits[id] && w.tdsEdits[id].f.party === 'Ravi Kumar & Associates'); }", mid), "B. kept with the books' work (saved and synced)")
        mid2 = J("() => (TDS.rows().find(r => r.fy === '2026-27' && String(r.id).startsWith('zz-misc-0001')) || {}).id || ''")
        J("([q, id]) => { S.tdsQ = q; S.tdsDedReg = TDS.rows().find(r => r.id === id).challan ? 'mapped' : 'pending'; render(); }", [J("(id) => TDS.rows().find(r => r.id === id).q", mid2), mid2]); pg.wait_for_timeout(400)
        pg.click('[data-dreg] [data-wd-namefix="%s"]' % mid2); pg.wait_for_timeout(200)
        offer = J("(id) => { const i = document.querySelector('[data-dreg] [data-wd-name-input=\"' + CSS.escape(id) + '\"]'); return i && i.list ? [...i.list.options].map(o => o.value).slice(0, 3) : []; }", mid2)
        ok(offer[:1] == ["Ravi Kumar & Associates"], "B. the name is offered first for another entry of the same ledgers (%s)" % offer)
        J("() => { S.tdsNameDraft = {}; S.tdsQ = 'Q1'; S.tdsDedReg = ''; render(); }"); pg.wait_for_timeout(300)

        # C. Put N on the right challans. next-tds-early: those challans dated in the year before (Protean's FVU refuses them,
        # T-FV-3076), so the deductions on them are on a challan that cannot pay them
        J("() => { const ch = {}; TDS.challans().forEach(c => { ch[c.id] = c; }); window.__was = {}; TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && ch[r.challan] && TDS.ymd(r.date) > TDS.ymd(ch[r.challan].date)).forEach(r => { const c = S.books.challans.find(x => x.id === r.challan); if (c && !(c.id in window.__was)) { window.__was[c.id] = c.date; c.date = '2026-03-25'; } }); TDSReg.forget(); render(); }")
        early = J("() => { const ch = {}; TDS.challans().forEach(c => { ch[c.id] = c; }); return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && ch[r.challan] && TDS.ymd(ch[r.challan].date) < '20260401').map(r => r.id); }")
        go("26Q", "deductions", ); J(CHOSE); pg.wait_for_timeout(300)
        btn = J("+((document.querySelector('#app [data-wd-fix-early]') || {dataset: {}}).dataset.wdFixEarly || 0)")
        ok(btn == len(early) > 0, "C. 'Put %d on the right challans' in the step's header (%s)" % (len(early), btn))
        go("26Q", "file")
        # next-tds-validate-short: not an error: the file leaves them out, one warning, the reason in its panel
        ve = J("(document.querySelector('#app [data-val-item=leftout][data-val-level=warn]') || {}).innerText || ''")
        J("() => { S.tdsFix = 'leftout'; S.tdsFixAt = '2026-27|Q1|26Q'; render(); }"); pg.wait_for_timeout(300)
        vd = J("(document.querySelector('[data-val-drawer=leftout]') || {}).innerText || ''")
        J("() => { S.tdsFix = ''; render(); }")
        ok("not in the file (FVU would refuse)" in ve and "T-FV-3076" in vd, "C. Validate & file: left out of the file, Protean's FVU refuses a challan dated before the year (%s | %s)" % (ve[:80], vd[:160]))
        go("26Q", "deductions"); J(CHOSE); pg.wait_for_timeout(300)
        # a challan for them: 194C, dated after them, enough left
        J("() => { S.books.challans = S.books.challans.concat([{id: 'chLate', bsr: '0240020', serial: '20999', date: '2026-07-07', section: '194C', tax: 900000}]); TDSReg.forget(); render(); }"); pg.wait_for_timeout(300)
        pg.click('#app [data-wd-fix-early]'); pg.wait_for_timeout(300)
        lis = J("[...document.querySelectorAll('#confirmBox li')].map(l => l.innerText)")
        ok(len(lis) == len(early) and all("→" in x for x in lis), "C. the moves listed to confirm (%s)" % lis[:2])
        pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
        after = J("() => { const ch = {}; TDS.challans().forEach(c => { ch[c.id] = c; }); return TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan && ch[r.challan] && TDS.ymd(ch[r.challan].date) < '20260401').length; }")
        placed = J("(ids) => ids.map(id => { const r = TDS.rows().find(x => x.id === id), c = TDS.challans().find(x => x.id === r.challan); return c ? [TDS.ymd(c.date) >= TDS.ymd(r.date), !TDSCH.secNorm(c.section) || TDSCH.secOk(TDSCH.secNorm(c.section), r.section)] : ['off', true]; })", early)
        ok(after == 0 and all(p[0] in (True, "off") and p[1] for p in placed), "C. none left on a challan of the year before; each on a challan of its section dated on or after it, or off to Pay a challan (%s)" % placed)
        ok(J("document.querySelectorAll('#app [data-wd-fix-early]').length") == 0, "C. the action is gone once none is left")
        pg.click('#toast [data-toast-act="Undo"]'); pg.wait_for_timeout(500)
        back = J("(ids) => ids.filter(id => { const ch = {}; TDS.challans().forEach(c => { ch[c.id] = c; }); const r = TDS.rows().find(x => x.id === id); return r.challan && ch[r.challan] && TDS.ymd(ch[r.challan].date) < '20260401'; }).length", early)
        ok(back == len(early), "C. one Undo puts them all back (%d of %d)" % (back, len(early)))
        J("() => { S.books.challans = S.books.challans.filter(c => c.id !== 'chLate'); S.books.challans.forEach(c => { if (c.id in window.__was) c.date = window.__was[c.id]; }); TDSReg.forget(); render(); }")

        # D. short chips
        for v in ("() => { S.tdsDedReg = 'pending'; render(); }", "() => { S.tdsDedReg = 'mapped'; render(); }", CHOSE):
            go("26Q", "deductions"); J("() => { S.tdsDedReg = ''; render(); }"); J(v); pg.wait_for_timeout(400)
            chips = J("[...document.querySelectorAll('#app .wd-chip, #app .dt-flag, #app .dt-fixw, #app .dreg-how')].filter(e => e.offsetParent).map(e => [e.innerText.trim(), !!e.title || !!e.closest('[title]')])")
            ok(chips and all(len(c[0]) <= 16 and c[1] for c in chips), "D. each row's problem a short chip with its words on a hover (%s)" % sorted(set(c[0] for c in chips)))

        print("3. a phone")
        pg.set_viewport_size({"width": 390, "height": 844})
        for step in ("deductees", "challans", "deductions", "file"):
            go("26Q", step)
            ok(J("document.documentElement.scrollWidth") <= 391 and pg.locator('#app [data-ret-select]').is_visible() and not pg.locator('#app [data-return-tabs]').is_visible(), "phone %s: a select for the steps, no sideways scroll" % step)
        pg.screenshot(path=os.path.join(SHOTS, "file-390.png"), full_page=True)
        J("(k) => TDSAdd.remove(k, 'a test')", add.get("key"))
        br.close()
finally:
    srv.shutdown()
ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
print("\nshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
