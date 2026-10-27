"""python3 run_excel_buttons.py - the Excel buttons of every TDS and GST page, one pattern (next-excel-buttons, 27-Oct-2026;
the owner: "download and upload excel button should be proper in TDS and GST.. I need to see every page where it is"), on
the fixture books (tdsgst_snapshot.LOAD, CHALLANS; the 2B of run_gst_portal.py for 2B & ITC) at 1440x900:

  - every page that has an Excel shows it once, in its toolbar row (the tab row of a return, else the filter row over the
    table), at the row's right end (only the page's ? help after it), never in a table or a ⋯ menu;
  - "Download Excel" first, then "Upload Excel" where the page brings an Excel back; the same words, the same icon, 32 px;
  - at most one of each on a page, and no other "Excel" control left (the old "Excel", "Export ▾ › Excel: …",
    "Download GSTR-1 and 3B (Excel)", the header's and ⋯'s copies): only the different imports keep their own words
    (PANs, a filed GSTR-1);
  - Download Excel (each workbook of its list) saves a file; Upload Excel opens a file box (its preview with Apply and
    Cancel: run_tds_excel.py, run_gstr1_excel.py, run_itc_simple_ui.py);
  - pages without an Excel stay without one (none added);
  - at 390 px the return's Excel is still on screen, without a sideways scroll.
Runs on the React build (app/dist-test) or TDSDESK_SITE. Screenshots to tests/out/excel-buttons/."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("XLBTN_PORT") or 8393)
SHOTS = os.path.join(HERE, "out", "excel-buttons"); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
_src = open(os.path.join(HERE, "run_gst_portal.py")).read()
_ns = {"G07": "07AAGCL4827M1Z3"}
exec(_src[_src.index("def inv("):_src.index("# GSTR-1: each portal table")], _ns)

T, G = "/books/tds/2026-27", "/books/gst/07/202603"
# (page, address, JS after, clicks, the Excel: None (none on the page), "down" or "down+up"; the workbooks Download Excel lists)
PAGES = [
    ("tds-year", T, None, [], "down", 3),
    ("tds-every-year", T, "() => { S.tdsView = 'years'; render(); }", [], None, 0),
    ("tds-deductor", T + "/Q1/26Q/deductor", None, [], "down+up", 1),
    ("tds-deductees", T + "/Q1/26Q/deductees", None, [], "down+up", 1),
    ("tds-challans", T + "/Q1/26Q/challans", None, [], "down+up", 1),
    ("tds-deductions-table", T + "/Q1/26Q/deductions", "() => { S.tdsDedView = 'table'; render(); }", [], "down+up", 1),
    ("tds-deductions-by-challan", T + "/Q1/26Q/deductions", "() => { S.tdsDedView = ''; render(); }", [], "down+up", 1),
    ("tds-validate", T + "/Q1/26Q/file", None, [], "down+up", 1),
    ("tds-after-filing", T + "/Q1/26Q/after", None, [], "down+up", 1),
    ("tds-24q-deductions", T + "/Q4/24Q/deductions", "() => { S.tdsDedView = 'table'; render(); }", [], "down+up", 1),
    ("tds-24q-salary", T + "/Q4/24Q/people", None, [], "down+up", 1),
    ("tds-all-challans", T + "/all-challans", None, [], "down", 1),
    ("tds-challan-register", T + "/challan-register", None, [], None, 0),
    ("tds-26as-ais", "/books/tds/2026-27/26as", None, [], None, 0),
    ("gst-year", G + "/year", None, [], "down", 1),
    ("gst-r1-summary", G + "/r1/summary", None, [], "down+up", 2),
    ("gst-r1-details-portal", G + "/r1/details", None, ["[data-r1-switch=portal]"], "down+up", 4),
    ("gst-r1-details-bill", G + "/r1/details", None, ["[data-r1-switch=bill]"], "down+up", 4),
    ("gst-r1-details-customer", G + "/r1/details", None, ["[data-r1-switch=customer]"], "down+up", 4),
    ("gst-r1-diff", G + "/r1/diff", None, [], "down+up", 2),
    ("gst-r1-files", G + "/r1/file", None, [], "down+up", 2),
    ("gst-r3b-summary", G + "/r3b/summary", None, [], "down", 1),
    ("gst-r3b-details", G + "/r3b/details", None, [], "down", 1),
    ("gst-r3b-2bmatch", G + "/r3b/diff", None, [], "down", 1),
    ("gst-r3b-files", G + "/r3b/file", None, [], "down", 1),
    ("gst-amendments", G + "/amend", None, [], "down", 1),
    ("gst-advances", G + "/adv", None, [], "down", 1),
    ("gst-reversal", G + "/rev", None, [], None, 0),
    ("gst-gstr9", G + "/g9", None, [], "down", 2),
    ("gst-gstr9c", G + "/g9c", None, [], "down", 2),
    ("gst-returns-filed", G + "/vault", None, [], None, 0),
    ("gst-input-register", G + "/inreg", None, [], "down", 1),
    ("gst-2b-reco", G + "/r2b", None, [], "down+up", 1),
    ("gst-final-credit", G + "/itcfinal", None, [], "down+up", 1),
    ("gst-filed-vs-fincom", G + "/filedcmp", None, [], None, 0),
    ("gst-filed-vs-books", G + "/recon", None, [], "down", 1),
]
# the other imports keep their own words (each brings in something else: a PAN list, a filed return)
OTHER = ["Paste PANs / import Excel (name, PAN)", "Paste PANs / import Excel", "Bring in a filed GSTR-1 / IFF (Excel or JSON)"]

CHECK = r"""() => {
  const app = document.querySelector('#app'), vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const words = (e) => (e.innerText || e.textContent || '').replace(/▾/g, '').replace(/\s+/g, ' ').trim();
  const tools = [...app.querySelectorAll('[data-xl-tools]')].filter(vis);
  const out = {tools: tools.length, kids: [], heights: [], icons: [], inTable: false, inMenu: false, right: [], ups: 0, downs: 0, others: []};
  out.downs = [...app.querySelectorAll('[data-xl=down]')].filter(vis).length; out.ups = [...app.querySelectorAll('[data-xl=up]')].filter(vis).length;
  if (tools[0]) { const t = tools[0], tr = t.getBoundingClientRect();
    out.kids = [...t.children].filter(vis).map((k) => [k.dataset.xl || k.tagName, words(k.matches('details') ? k.querySelector('summary') : k)]);
    out.heights = [...t.children].filter(vis).map((k) => Math.round((k.matches('details') ? k.querySelector('summary') : k).getBoundingClientRect().height));
    out.icons = [...t.children].filter(vis).map((k) => !!k.querySelector('svg'));
    out.inTable = !!t.closest('table'); out.inMenu = !!t.closest('details.more');
    // the row: the nearest box that is not display: contents; anything in it to the right of the Excel (the help aside)
    let row = t.parentElement; while (row && getComputedStyle(row).display === 'contents') row = row.parentElement;
    out.row = row ? (row.className || row.tagName) : '';
    out.right = [...row.querySelectorAll('*')].filter((e) => vis(e) && !t.contains(e) && !e.contains(t) && !e.closest('.help-btn, [data-help]') && !e.closest('details.more:not([open]) .more-pop')).filter((e) => {
      const r = e.getBoundingClientRect(); return r.left >= tr.right - 1 && r.top < tr.bottom && r.bottom > tr.top; }).map((e) => words(e).slice(0, 30) || e.tagName); }
  // every Excel word left on the page, shown or in a ⋯ menu, outside the Excel tools
  for (const e of app.querySelectorAll('button, a, summary, label, .more-item')) {
    if (e.closest('[data-xl-tools]') || e.closest('[data-drawer], [role=dialog]')) continue;
    const w = words(e); if (!w || w.length > 90) continue;
    const inMenu = !!e.closest('details.more') && !e.matches('summary');
    if (!inMenu && !vis(e)) continue;
    if (/\bexcel\b|xlsx|^export\b/i.test(w) && !/^Undo the last Excel upload/.test(w)) out.others.push(w);
  }
  return out; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        E, W = pg.evaluate, pg.wait_for_timeout
        pg.goto("http://localhost:%d/" % PORT); W(2500); pg.click('button[data-act="useOffline"]'); W(1500)
        E("window.__dueToday = '2026-10-11'")
        E(LOAD, books); W(1000); E("S.books = window.__bk; render();"); W(500); E(CHALLANS); W(300)
        cid = E("S.coId")
        E("() => { S.books.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-08-05', token: '123456789012345'}}; return saveBooks(); }")
        E("() => { window.__files = []; window.saveFile = async (name) => { window.__files.push(name); return true }; }")
        seen = {}
        for name, h, js, clicks, want, nwb in PAGES:
            if name.startswith("gst-") and not E("!!window.__2b"): E(_ns["TWOB_JS"], _ns["TWO_B"]); E("window.__2b = 1"); W(400)
            E("() => { document.querySelectorAll('details.more[open]').forEach((d) => d.open = false); }")
            E("(h) => { location.hash = h; }", "#/c/%s%s" % (cid, h)); W(1300)
            if js: E(js); W(600)
            for c in clicks: pg.click("#app " + c); W(500)
            E("window.scrollTo(0, 0)"); W(150)
            m = E(CHECK)
            pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
            seen[name] = m
            if not want:
                ok(m["tools"] == 0 and not m["others"], "%s: no Excel here, none added (%s)" % (name, m["others"]))
                continue
            kinds = [k[0] for k in m["kids"]]
            ok(m["tools"] == 1, "%s: one Excel group on the page (%d)" % (name, m["tools"]))
            ok(kinds == want.split("+"), "%s: %s, in that order (%s)" % (name, " then ".join(want.split("+")), kinds))
            ok([k[1] for k in m["kids"]] == ["Download Excel", "Upload Excel"][:len(kinds)], "%s: the words Download Excel / Upload Excel (%s)" % (name, [k[1] for k in m["kids"]]))
            ok(m["downs"] == 1 and m["ups"] == (1 if "up" in want else 0), "%s: at most one of each (%d down, %d up)" % (name, m["downs"], m["ups"]))
            ok(all(abs(x - 32) <= 1 for x in m["heights"]) and all(m["icons"]), "%s: 32 px, each with its icon (%s %s)" % (name, m["heights"], m["icons"]))
            ok(not m["inTable"] and not m["inMenu"], "%s: in the toolbar row (%s), not in a table or a menu" % (name, m.get("row")))
            ok(not m["right"], "%s: at the right end of its row (%s)" % (name, m["right"][:4]))
            ok(all(o in OTHER for o in m["others"]), "%s: no other Excel control left (%s)" % (name, m["others"]))
            # Download Excel: each workbook saves a file
            if nwb == 1:
                E("window.__files = []"); pg.click("#app [data-xl-tools] [data-xl=down]"); W(2500)
                ok(len(E("window.__files")) == 1, "%s: Download Excel saves a file (%s)" % (name, E("window.__files")))
            else:
                n = E("document.querySelectorAll('#app [data-xl-tools] details[data-xl=down] .more-item').length")
                ok(n == nwb, "%s: Download Excel ▾ lists %d workbooks (%d)" % (name, nwb, n))
                got = 0
                for i in range(n):
                    E("window.__files = []"); pg.click("#app [data-xl-tools] details[data-xl=down] > summary"); W(200)
                    pg.locator("#app [data-xl-tools] details[data-xl=down] .more-item").nth(i).click(); W(2500)
                    got += 1 if len(E("window.__files")) == 1 else 0
                ok(got == n, "%s: each of them saves a file (%d of %d)" % (name, got, n))
            if "up" in want:
                try:
                    with pg.expect_file_chooser(timeout=3000) as fc: pg.click("#app [data-xl-tools] [data-xl=up]")
                    ok(".xlsx" in (fc.value.element.get_attribute("accept") or ""), "%s: Upload Excel opens the file box for an Excel" % name)
                except Exception as e:
                    ok(False, "%s: Upload Excel opens the file box (%s)" % (name, e))

        print("phone (390 px): the return's Excel still on screen")
        pg.set_viewport_size({"width": 390, "height": 844})
        for h in [T + "/Q1/26Q/deductions", G + "/r1/summary"]:
            E("(h) => { location.hash = h; }", "#/c/%s%s" % (cid, h)); W(1300)
            v = E("(() => { const t = document.querySelector('#app [data-xl-tools]'); if (!t) return null; const r = t.getBoundingClientRect(); return [r.left >= 0 && r.right <= innerWidth + 1, document.documentElement.scrollWidth]; })()")
            ok(v and v[0] and v[1] <= 391, "390 px %s: Download / Upload Excel on screen, no sideways scroll (%s)" % (h.split("/books/")[-1], v))
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
