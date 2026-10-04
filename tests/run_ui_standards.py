"""python3 run_ui_standards.py - the owner's standards for every page (spec K, 04-Oct-2026), checked on each page of
shots_ui_pass.py at 1366 x 768:
  - no "TDSDesk", "React", internal ids (the client's and the bills' ids, job ids), commit stamps or build numbers on the
    screen; the build stamp only in the small About line (Settings);
  - amounts in Indian form with two decimals (1,25,000.00), right-aligned in tables; never 1,250,000;
  - dates as 04-Oct-2026: no 2026-10-04, 04/10/2026 or "4 Oct 2026" on the screen;
  - no sideways scrolling at 1366 x 768 (nothing sticks out past the right edge unless inside its own scroll box);
  - every disabled button says why: on hover (its title) and beside it in plain sight;
  - at most one primary (filled) button on a page;
  - the four colours of meaning are CSS tokens: --st-done (green), --st-attention (amber), --st-failed (red), --st-waiting (grey);
  - a part of a page that fails to draw says so in plain words, not the raw error.
Offline, the made-up client of shots_ui_pass.py, the React test build (app/dist-test)."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import shots_ui_pass as U
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8249), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the page's visible words, without the About line, the test build's banner, and what is typed in boxes
TEXT = """() => { const hide = [...document.querySelectorAll('[data-about], .test-banner, #fincomBanner, script, style')]; const was = hide.map(h => h.style.display); hide.forEach(h => { h.style.display = 'none'; });
  const t = [document.getElementById('cobar'), document.getElementById('app'), document.getElementById('side')].map(e => e ? e.innerText : '').join('\\n'); hide.forEach((h, i) => { h.style.display = was[i]; }); return t; }"""
WIDE = """() => { const W = window.innerWidth, out = [];
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.querySelectorAll('#app *, #cobar *')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1 && !clipped(el)) out.push((el.tagName + '.' + el.className).slice(0, 40) + ' ' + Math.round(r.right)); }
  return {scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, out: out.slice(0, 4)}; }"""
DISABLED = """(sel) => [...document.querySelectorAll(sel)].filter(b => b.offsetParent !== null).map(b => {
  const why = (b.getAttribute('title') || '').trim(), n = b.nextElementSibling;
  const beside = n && n.classList.contains('why-note') && n.offsetParent !== null && n.innerText.trim();
  const around = b.parentElement ? b.parentElement.innerText.replace(b.innerText, '') : '';
  let marked = false; for (let q = b.parentElement, k = 0; q && k < 2; q = q.parentElement, k++) { if (q.querySelector('[data-why]')) marked = true; }
  let near = false; for (let q = b.parentElement, k = 0; q && k < 2; q = q.parentElement, k++) { if (why.length > 8 && (q.innerText || '').replace(b.innerText, '').includes(why.slice(0, 25))) near = true; }
  return {b: b.innerText.trim().slice(0, 40), why, ok: !!why && (!!beside || marked || near)}; }).filter(x => !x.ok)"""
PRIMARY = """(sel) => [...document.querySelectorAll(sel)].filter(b => b.offsetParent !== null && !b.closest('[role=dialog], .modal, #modal')).map(b => b.innerText.trim().slice(0, 30) || b.outerHTML.slice(0, 90))"""
# amounts in tables: the cells of a column whose head names money
AMOUNTS = """() => { const out = [];
  for (const t of document.querySelectorAll('#app table')) { if (!t.offsetParent) continue;
    const heads = [...t.querySelectorAll('thead tr:last-child th')].map(h => h.innerText.trim().toLowerCase());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
      if (!/amount|value|taxable|total|₹|balance|debit|credit|tds|gst|withdraw|deposit/.test(heads[i] || '') || /rate|%|section|gstin|limit|type|ledger|return|status|period|vs/.test(heads[i] || '')) return;
      const s = td.innerText.trim().split('\\n')[0]; if (!/\\d/.test(s) || /^\\d+$/.test(s) || /\\d{1,2}[-\\/][A-Za-z0-9]{2,3}[-\\/]\\d{2,4}/.test(s) || /[a-z]{3,}/i.test(s.replace(/\\b(Dr|Cr)\\b/g, ''))) return;
      out.push({s, ok: /^[-−–]?₹?[-−–]?(\\d{1,2},)?(\\d{2},)*\\d{1,3}\\.\\d{2}( Dr| Cr)?$/.test(s), right: /right|end/.test(getComputedStyle(td).textAlign)}); })); }
  return out; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8249/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    cid = pg.evaluate(U.SEED, U.books()); pg.wait_for_timeout(1200)
    ids = pg.evaluate("(cid) => [cid].concat(Object.keys(S.data[cid].entries).filter(k => k.length > 6))", cid)
    pg.evaluate("(cid) => { const e = newEntry('raw-id.pdf'); e.x.vendorName = 'ZZ RAW ID CHECK'; e.x.invoiceNo = 'R-1'; e.x.invoiceDate = '2026-09-20'; e.x.total = 1180; S.data[cid].entries[e.id] = e; refreshStats(cid); }", cid)
    ids = pg.evaluate("(cid) => [cid].concat(Object.keys(S.data[cid].entries).filter(k => k.length > 6))", cid)
    tok = pg.evaluate("() => ['--st-done', '--st-attention', '--st-failed', '--st-waiting'].map(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim())")
    ok(all(tok), "the colours of meaning are tokens: --st-done, --st-attention, --st-failed, --st-waiting (%s)" % tok)
    for name, js in U.PAGES:
        try: pg.evaluate(js)
        except Exception as e: ok(False, "%s: opens (%s)" % (name, str(e)[:80])); continue
        pg.wait_for_timeout(1300)
        t = pg.evaluate(TEXT)
        bad = [w for w in ("TDSDesk", "TDSDESK", "React") if w in t] + [i for i in ids if i in t]
        bad += re.findall(r"\bbuild \d+\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-", t)
        ok(not bad, "%s: no internal names, ids or build stamps (%s)" % (name, bad[:4]))
        west = re.findall(r"\b\d{1,3},\d{3},\d{3}\b", t)
        ok(not west, "%s: amounts in Indian form, never 1,250,000 (%s)" % (name, west[:3]))
        dates = re.findall(r"\b20\d\d-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}/20\d\d\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) 20\d\d\b", t)
        ok(not dates, "%s: dates as 04-Oct-2026 (%s)" % (name, dates[:3]))
        w = pg.evaluate(WIDE)
        ok(w["scroll"] <= 0 and not w["out"], "%s: no sideways scrolling at 1366 x 768 (%s)" % (name, w))
        # the Post to Tally page's own content is the other helper's (spec K: every page except it): its top bar only
        own = name == "post-to-tally"
        d = pg.evaluate(DISABLED, "#cobar button[disabled]" if own else "#app button[disabled], #cobar button[disabled]")
        ok(not d, "%s: every disabled button says why, on hover and beside it (%s)" % (name, d[:3]))
        pr = pg.evaluate(PRIMARY, "#cobar .btn.primary" if own else "#app .btn.primary, #cobar .btn.primary")
        ok(len(pr) <= 1, "%s: one primary button at most (%s)" % (name, pr))
        am = [] if own else pg.evaluate(AMOUNTS)
        badam = [a["s"] for a in am if not a["ok"]][:3]; left = [a["s"] for a in am if not a["right"]][:3]
        ok(not badam and not left, "%s: table amounts like 1,25,000.00 and right-aligned (%d checked; %s; left: %s)" % (name, len(am), badam, left))
    # the About line holds the build stamp
    pg.evaluate("() => goSettings(null)"); pg.wait_for_timeout(800)
    ab = pg.locator("[data-about]")
    ok(ab.count() == 1 and "FinCom" in ab.inner_text() and re.search(r"\d{2}-[A-Z][a-z]{2}-\d{4}", ab.inner_text()), "Settings: a small About line with the build (%s)" % (ab.inner_text() if ab.count() else ""))
    side = pg.inner_text("#side")
    ok("Build" not in side, "the sidebar no longer shows the build stamp")
    # messages: the common raw errors from the database, the network and Tally in plain words (what, why, what to do);
    # anything else a plain sentence with the raw words only behind "details"
    raw = ["duplicate key value violates unique constraint \"bill_items_pkey\"", "Failed to fetch", "JWT expired", "new row violates row-level security policy for table \"entries\"",
           "Could not find Ledger 'Rent Payable'", "Voucher totals do not match!", "TypeError: Cannot read properties of undefined (reading 'waiting')", "The bridge answered with error 502.", "PGRST301: zz"]
    m = pg.evaluate("(xs) => xs.map(x => plainError(x))", raw)
    for r, x in zip(raw, m):
        ok(x and x["text"] and r not in x["text"] and not re.search(r"pkey|JWT|PGRST|TypeError|row-level|error 502", x["text"]) and x["text"].endswith("."), "plain words for “%s”: %s" % (r[:40], x and x["text"]))
    ok(m[4]["text"].find("Rent Payable") >= 0, "Tally's missing ledger is named: " + m[4]["text"])
    ok(pg.evaluate("plainError('Saved 3 bills.')") is None, "a message already in plain words is left as it is")
    ok(m[6]["details"] and "Cannot read" in m[6]["details"], "the raw words kept for “details”")
    pg.evaluate("() => toast('Could not save: duplicate key value violates unique constraint \"x_pkey\"')"); pg.wait_for_timeout(200)
    tt = pg.inner_text("#toast")
    ok("pkey" not in tt and "duplicate key" not in tt and "details" in tt.lower(), "a toast with a raw error: plain words and a details link (%s)" % tt.replace("\n", " / "))
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
