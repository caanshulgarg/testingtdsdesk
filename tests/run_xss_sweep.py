"""python3 run_xss_sweep.py - hostile text from Tally never becomes page markup (security review of 26-Oct-2026, XSS).
Anyone who types in a client's Tally controls its ledger, party and company names, narrations, voucher and bill numbers
and cost centres. The made-up books (tests/fixtures/books) are loaded with a payload added to every one of those texts,
then every client page and books tab is drawn, and every print view (window.open + document.write) and HTML export is
caught: no element or attribute of the payload may appear in any of them. Also: a hostile address (#/c/<payload>/...).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_xss_sweep.py"""
import os, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
from books_data import CACHE, GSTIN, COMPANY
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8171), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# closes a double- or single-quoted attribute and the tag, then an element and an attribute the checks look for
X = "\"'><b data-pwn=1>B</b><img src=x data-pwn=2 onerror=window.__pwn=1><svg onload=window.__pwn=2>"
books = json.load(open(CACHE))
def hostile(s): return s + " " + X if isinstance(s, str) and s else s
for v in books["vouchers"]:
    for k in ("party", "narr", "no", "ref"): v[k] = hostile(v.get(k))
    for e in v.get("ent", []):
        e["l"] = hostile(e["l"])
        for b in e.get("b") or []: b[0] = hostile(b[0])
        for c in e.get("c") or []: c[0] = hostile(c[0]); c[1] = hostile(c[1])
books["meta"]["company"] = "Co " + X
# the ledger masters (groups, so receivables, payables and the statements fill), with the same payload on every ledger name
import re
from books_data import DATA
from xml.sax.saxutils import escape
XX = escape(X, {'"': "&quot;", "'": "&apos;"})
raw = open(os.path.join(DATA, "Master.xml"), "rb").read()
enc = "utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8"
mx = raw.decode(enc)
for nm in set(re.findall(r'<LEDGER NAME="([^"]*)"', mx)):
    mx = mx.replace('<LEDGER NAME="%s"' % nm, '<LEDGER NAME="%s %s"' % (nm, XX)).replace("<NAME>%s</NAME>" % nm, "<NAME>%s %s</NAME>" % (nm, XX))
MASTERS = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "xss-Master.xml")
os.makedirs(os.path.dirname(MASTERS), exist_ok=True); open(MASTERS, "wb").write(mx.encode(enc))
# what a page holds of the payload: elements or attributes made from it, in the page and in every caught print view
FIND = """() => { const bad = (doc) => doc.querySelectorAll('[data-pwn], img[src="x"], svg[onload]').length;
  const n = bad(document) + (window.__opened || []).reduce((a, h) => a + bad(new DOMParser().parseFromString(h, "text/html")), 0);
  const shown = (document.getElementById("app") || document.body).innerText.split("data-pwn=1").length - 1;
  return {n, pwn: window.__pwn || 0, opened: (window.__opened || []).length, shown}; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    # print views: window.open("") then document.write(html); the html is kept (and never run) for the checks
    pg.add_init_script("""window.__opened = []; window.open = function(){ const w = {closed: false, focus(){}, print(){}, close(){}, addEventListener(){},
      document: {open(){}, close(){}, write(h){ window.__opened.push(String(h)); }, title: ""}, location: {}}; return w; };
      window.saveFile = function(name, data){ try { if (typeof data === "string" && /<[a-z]/i.test(data)) window.__opened.push(data); } catch (e) {} };""")
    pg.goto("http://localhost:8171/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate("""([bk, X, G, CO]) => { const c = newCompany({name: "Client " + X, gstin: G, tallyName: CO}); c.id = "c_xss"; S.companies[c.id] = c;
      S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => { S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
        window.__bk = S.books; S.tab = "books"; S.booksTab = "import"; render(); }); }""", [books, X, GSTIN, COMPANY])
    pg.wait_for_timeout(1200)
    pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    pg.set_input_files("#mastersIn", MASTERS)
    for _ in range(80):
        pg.wait_for_timeout(500)
        if pg.evaluate("Object.keys(S.books.ledInfo || {}).length > 10 && !/Opening .*Master/.test(document.getElementById('app').innerText)"): break
    pg.wait_for_timeout(1000)
    ok(pg.evaluate("Object.keys(S.books.ledInfo || {}).filter(k => k.includes('data-pwn')).length") > 10, "the hostile ledger masters are read")
    def look(where, js=None, wait=600):
        err = ""
        if js:
            try: pg.evaluate(js)
            except Exception as e: err = str(e).split("\n")[0][:120]
        pg.wait_for_timeout(wait)
        r = pg.evaluate(FIND)
        shown.append((where, r["shown"], r["opened"])); ok(r["n"] == 0 and not r["pwn"], "no markup from Tally text on %s (%s)%s" % (where, r, (" [" + err + "]") if err else ""))
    shown = []
    for t in ["import", "tds", "gst", "mis", "mymis", "fs", "audit", "ledgers", "lookup", "letters", "reports", "recon", "assets"]:
        look("books/" + t, "() => { S.booksTab = '%s'; render(); }" % t)
    for t in ["dash", "txn", "bank", "sales", "export", "done", "invoices", "clientInbox", "settings", "bankset", "deductees"]:
        look("client/" + t, "() => { S.view = 'company'; S.tab = '%s'; render(); }" % t)
    # the pages that need a run first (as run_mis_ui, run_audit_ui, run_reports_ui do), then every print or PDF button on them
    def click(sel, wait=1500):
        try: pg.click(sel, timeout=3000); pg.wait_for_timeout(wait); return True
        except Exception: return False
    PRINTS = """() => { const bs = [...document.querySelectorAll('#app button, #app [role=menuitem], #app a')].filter(b => /print|pdf|word|html/i.test(b.textContent + ' ' + (b.title || '') + ' ' + (b.getAttribute('aria-label') || '')));
      bs.slice(0, 12).forEach(b => { try { b.click(); } catch (e) {} }); return bs.length; }"""
    def prints(where):
        n = pg.evaluate(PRINTS); pg.wait_for_timeout(1200); look(where + " print views (%d buttons)" % n)
    pg.evaluate("() => { S.tab = 'books'; S.booksTab = 'mis'; render(); }"); pg.wait_for_timeout(800)
    click('button:text-is("Last year")', 400); click('section[data-mis-head] button:text-is("Run now")', 4000); look("MIS, run"); prints("MIS")
    pg.evaluate("() => { S.booksTab = 'audit'; render(); }"); pg.wait_for_timeout(800)
    click('button:text-is("Run now")', 5000); look("audit, run"); prints("audit")
    for ym in ["202505", "202603"]:
        for part in ["r1", "r3b", "2b", "summary"]:
            look("GST %s %s" % (ym, part), "() => { S.booksTab = 'gst'; S.gstView = 'return'; S.gstPart = '%s'; S.gstYm = '%s'; S.gstReg = '07'; render(); }" % (part, ym), 900)
    look("GST year", "() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstYm = '202603'; S.gstReg = '07'; render(); }", 900); prints("GST")
    look("TDS year", "() => { S.booksTab = 'tds'; S.tdsView = ''; S.tdsFy = '2025-26'; render(); }", 900)
    for q in ["Q1", "Q2", "Q3", "Q4"]:
        look("TDS 26Q " + q, "() => { S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2025-26'; S.tdsQ = '%s'; S.tdsForm = '26Q'; S.tdsTab = ''; render(); }" % q, 900)
    prints("TDS")
    look("statements", "() => { S.booksTab = 'fs'; S.fsFy = '2025'; render(); }", 2000); prints("statements")
    for nav in ["Receivables ageing", "Payables ageing", "Day book", "Trial balance", "Ledger"]:
        pg.evaluate("() => { S.booksTab = 'reports'; render(); }"); pg.wait_for_timeout(700)
        pg.evaluate("() => document.querySelectorAll('#app details[data-rpt-group]').forEach(d => d.open = true)")
        if click('.rpt-link:has(b:text-is("%s"))' % nav, 1500): look("report " + nav); prints("report " + nav)
    pg.evaluate("() => { S.booksTab = 'lookup'; render(); }"); pg.wait_for_timeout(800)
    try: pg.fill("#app input[type=search]", "Nightjar", timeout=3000); pg.keyboard.press("Enter"); pg.wait_for_timeout(1500)
    except Exception: pass
    look("lookup search"); prints("lookup")
    look("letters", "() => { S.booksTab = 'letters'; render(); }", 1500); prints("letters")
    # a hostile address
    look("a hostile address", "() => Route.apply('#/c/' + encodeURIComponent('%s') + '/books/tds/' + encodeURIComponent('%s'))" % (X.replace("'", "\\'"), X.replace("'", "\\'")))
    ok(sum(x[1] for x in shown) > 100, "the payload was drawn as text (covered): " + str([x for x in shown if x[1] or x[2]]))
    ok(not errors, "no page errors " + str(errors[:3]))
    br.close()
print(("%d failed" % len(fails)) if fails else "all passed")
raise SystemExit(1 if fails else 0)
