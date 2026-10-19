"""python3 run_tds_clean.py - a TDS return's pages clean (round 94, next-tds-clean, 19-Oct-2026; the owner: "info is ok but
messy, lots of info double; shortcuts not required; Deductor, Deductee, Challan, Deduction can come horizontally; remove
double info anywhere; page should look clean"). On the fixture books (tdsgst_snapshot.py), in the React build
(app/dist-test, or TDSDESK_SITE):
  1. the frame: the steps are one row of tabs across the top (every tab on one line at 1366 and 1440, kept in view as the
     page scrolls), no left rail, no tabs at the foot (.rt-foot), no F-keys (F8 / F10 / F11 / F12 do nothing), no
     "Done: x of y ready", no "All challans of the year" button in the header (it is under ⋯); a phone keeps the select
  2. the strip: amounts only, TDS · On challans · Left (Forms 140, 144, 143 and 138)
  3. every figure once: on each step a scan of the words on the page finds the deduction count, the "not on a challan"
     count and the problem count ("N to fix") in one place only; Deductees: one PAN indicator a row and no count line;
     Challans: no help line, no "See all challans", no "Number of challans", "Used in all returns" only where it differs;
     Deductions: no "N not on a challan · Show" line and no "Challan amount" in the footer; Validate & file: one "fix the
     errors first" (no count in it); the TDS home: one All challans
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
        go = lambda form, step: (J("([f, s]) => { S.booksTab = 'tds'; tdsGo('2026-27', 'Q1', f); S.tdsTab = s; S.tdsDedView = ''; S.tdsChView = ''; S.tdsWinCh = ''; render(); window.scrollTo(0, 0); }", [form, step]), pg.wait_for_timeout(500))

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
                    lab = [x[0] for x in st]
                    ok(lab in (["TDS", "On challans", "Left"], ["TCS", "On challans", "Left"]) and not any(x[1] for x in st), "%s: the strip is TDS · On challans · Left, amounts only (%s)" % (at, st))
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
        ok("Used in all returns" not in heads, "Challans: no Used in all returns while each challan's use is this return's (%s)" % heads)
        go("26Q", "deductions")
        ok(pg.locator('#app [data-wd-unplaced]').count() == 0, "Deductions: no 'N not on a challan · Show' line (the picker has it)")
        ft = J("(document.querySelector('#app [data-wd-foot]') || {}).innerText || ''")
        ok(ft and "Challan amount" not in ft and "Used here" in ft and "Balance" in ft, "Deductions: the footer without Challan amount (%s)" % ft.replace("\n", " "))
        go("26Q", "file")
        why = J("(document.querySelector('#app [data-make-why]') || {}).innerText || ''")
        ok(why and not re.search(r"\d", why) and J("document.querySelectorAll('#app [data-validate] .vf-counts [data-val-errors], #app [data-validate] .vf-counts .bad').length") == 0,
           "Validate & file: one 'fix the errors first', with no count (%s)" % why)
        J("() => { S.booksTab = 'tds'; tdsGo('2026-27'); }"); pg.wait_for_timeout(600)
        allch = J("() => [...document.querySelectorAll('#app button, #app a')].filter(b => b.offsetParent && /all challans/i.test(b.innerText)).map(b => b.innerText.trim())")
        ok(len(allch) == 1, "the TDS home: one All challans (%s)" % allch)

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
