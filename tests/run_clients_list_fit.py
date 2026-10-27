"""python3 run_clients_list_fit.py - the Clients list: nothing in a cell is cut or runs into the next one.

The owner, 15-Oct-2026 ("not coming properly over screen": text cut or overlapping): four clients, two with a long
"Tally: ..." line, and the Tally chip ("◐ Not linked → Link", "◐ Waiting for Tally") in a column fixed at 150px that its
words do not fit. On a computer (1280 and 1440 wide) and a phone (390): each cell holds its content, the chip sits inside
its cell, the total row does not cover the last client, a GSTIN stays on one line, the page does not scroll
sideways. Runs on the React build (app/dist-test) or
TDSDESK_SITE; screenshots to tests/out/clients_fit/."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CLIENTS_FIT_PORT") or 8357)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "clients_fit"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

# the owner's four clients, as his list showed them
CLIENTS = [
    {"name": "garg shekhar & company", "stats": {"drafts": 1, "waiting": 0}},
    {"name": "GB TEXCOAT SOLUTION PRIVATE LIMITED"},
    {"name": "Mastercad Solutions", "tallyName": "Master Cad Infra Solutions Private Limited (FY:25-26)", "stats": {"drafts": 1}},
    {"name": "Testing AAD", "tallyName": "GARG SHEKHAR & COMPANY", "gstin": "09AANFG3202D1ZR", "stats": {"drafts": 1, "waiting": 2}},
]
SEED = """(list) => { for (const x of list){ const c = newCompany({name: x.name, gstin: x.gstin || ""}); if (x.tallyName) c.tallyName = x.tallyName;
  c.stats = x.stats || {}; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); }
  navHome('clients'); }"""
# each cell of the list: is its content wider than the cell, does the Tally chip leave its cell
FIT = """() => [...document.querySelectorAll('#app table[data-list="clients"] tbody td')].map((td) => {
  const r = td.getBoundingClientRect(), chip = td.querySelector('[data-tally-chip]'), c = chip ? chip.getBoundingClientRect() : null;
  return {text: td.innerText.replace(/\\s+/g, ' ').trim().slice(0, 50), over: td.scrollWidth - td.clientWidth,
    chipOut: c ? Math.max(0, c.right - r.right, r.left - c.left) : 0}; })"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for w, h in [(1280, 800), (1440, 900), (390, 844)]:
            pg = br.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1000)
            pg.evaluate(SEED, CLIENTS); pg.wait_for_timeout(1200)
            cells = pg.evaluate(FIT)
            bad = [c for c in cells if c["over"] > 1 or c["chipOut"] > 1]
            ok(len(cells) >= 4 * 5 and not bad, "%d wide: every cell holds its content, the Tally chip inside its cell (%s)" % (w, bad[:3]))
            # the total row at the foot sits under the last client, never over it (it was lifted by the review banner's height)
            cover = pg.evaluate("""() => { const t = document.querySelector('#app table[data-list="clients"]'), last = [...t.querySelectorAll('tbody tr')].pop();
              const ft = t.querySelector('tfoot'); if (!ft) return 'no foot';
              return [...last.querySelectorAll('td *')].filter((e) => e.childElementCount === 0 && e.innerText.trim()).map((e) => {
                // the foot's cells are the sticky ones (and take no clicks, so only their boxes tell where they are drawn)
                const r = e.getBoundingClientRect(), top = Math.min(...[...ft.querySelectorAll('td')].map((c) => c.getBoundingClientRect().top));
                return r.bottom > top + 1 ? e.innerText.trim().slice(0, 40) : null; }).filter(Boolean); }""")
            ok(cover == [], "%d wide: the total row does not cover the last client (%s)" % (w, cover))
            # a GSTIN or PAN is one word: never broken across two lines
            split = pg.evaluate("""() => [...document.querySelectorAll('#app table[data-list="clients"] tbody td')].flatMap((td) => [...td.querySelectorAll('*'), td].flatMap((e) => [...e.childNodes]))
              .filter((n) => n.nodeType === 3 && /^[0-9A-Z]{10,15}$/.test(n.textContent.trim())).filter((n) => { const r = document.createRange(); r.selectNodeContents(n);
                return r.getClientRects().length > 1; }).map((n) => n.textContent.trim())""")
            ok(split == [], "%d wide: no GSTIN or PAN broken across lines (%s)" % (w, split))
            ok(pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0, "%d wide: the page does not scroll sideways" % w)
            pg.screenshot(path=os.path.join(OUT, "clients-%d.png" % w), full_page=True)
            pg.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
