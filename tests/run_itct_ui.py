"""python3 run_itct_ui.py - the follow-up inside 2B reconciliation (next-itc-simple; was the ITC follow-up page), on a real
client's books and 2B (tests/data, skipped without them): decisions kept and carried, a note kept, a supplier letter
logged, a supplier's credit note in 2B reversed takes it out of 3B, the Excel."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
files = [os.path.join(DATA, "returns_R2B_07AADCV3366N1ZU_%s.json" % p) for p in ("022026", "032026")]
if not all(os.path.exists(f) for f in files): print("  (VMS 2B files not here; skipped)\n\nall passed"); sys.exit(0)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8140), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8140/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1500)
    pg.evaluate("""([bk, js]) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books);
      js.forEach(j => { const t = GST2B.fromJson(j); S.books.twoBs[t.gstin + "|" + t.period] = t; }); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "r2b"; S.gstView = "return"; S.gstYm = "202603"; S.gstReg = "07"; render(); }""", [books, [json.load(open(f)) for f in files]])
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(6000)
    t = pg.inner_text("#app")
    ok(pg.locator("[data-itc-reco]").count() == 1 and "In books, not in 2B" in t and "In 2B, not in books" in t and "Write to suppliers" in t, "2B reconciliation: the lines, the chips, Write to suppliers")
    ok("ITC follow-up" not in t, "no separate ITC follow-up")
    pg.screenshot(path=OUT + "/itct.png", full_page=False)
    R = "ITCF.month('07', '202603').rows"
    key = pg.evaluate("(" + R + ".find(r => r.kind === 'books' && !r.fixed && r.chip === 'books') || {}).key")
    a0 = pg.evaluate("ITCF.table4('07', '202603').lines.find(x => x[0] === '4A5')[1]")
    pg.select_option('tr[data-ic-row=%s] select[data-ic-dec]' % json.dumps(key), "booksnow"); pg.wait_for_timeout(2500)
    a1 = pg.evaluate("ITCF.table4('07', '202603').lines.find(x => x[0] === '4A5')[1]")
    ok(pg.evaluate("S.books.itcDec['07|' + %s].d" % json.dumps(key)) == "booksnow" and sum(a1.values()) > sum(a0.values()), "Take now though not in 2B on a bill: kept, 4(A)(5) goes up")
    pg.fill('tr[data-ic-row=%s] input[aria-label="Note"]' % json.dumps(key), "Bill with Rahul"); pg.press('tr[data-ic-row=%s] input[aria-label="Note"]' % json.dumps(key), "Tab"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.books.itcDec['07|' + %s].note" % json.dumps(key)) == "Bill with Rahul", "a note on a line is kept")
    pg.evaluate("GST2B._memo = null; render()"); pg.wait_for_timeout(5000)
    ok(pg.evaluate("ITCF.row('07', %s).e.code" % json.dumps(key)) == "booksnow", "carried: the same decision after the books are read again")
    fk = pg.evaluate("(" + R + ".find(r => r.kind === 'books' && !r.fixed && r.show.code === 'follow' && r.gstin) || {}).key")
    if fk:
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        pg.click("[data-ic-letters]"); pg.wait_for_timeout(800)
        sk = pg.get_attribute("[data-letter-copy]", "data-letter-copy"); pg.click("[data-letter-copy]"); pg.wait_for_timeout(1500)
        clip = pg.evaluate("navigator.clipboard.readText()")
        ok("do not appear in our GSTR-2B" in clip and "30 November" in clip and len(pg.evaluate("S.books.itcTrack['07'].sent[%s]" % json.dumps(sk)) or []) == 1, "Write to suppliers: the letter lists the bills and the last date; writing is logged")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    cn = pg.evaluate("(" + R + ".find(r => r.kind === '2b' && r.cn && !r.fixed && r.tm === '202603') || {}).key || ''")
    if cn:
        n0 = pg.evaluate("GSTR.threeB('202603','07').cn2b.n")
        pg.select_option('tr[data-ic-row=%s] select[data-ic-dec]' % json.dumps(cn), "reverse"); pg.wait_for_timeout(3000)
        ok(n0 >= 1 and pg.evaluate("GSTR.threeB('202603','07').cn2b.n") == n0 - 1, "a supplier's credit note in 2B reduces 3B credit; Reverse / do not take, it does not")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('[data-itc-excel=down]'); pg.wait_for_timeout(6000)
    ok(any("2B-and-ITC" in n for n in pg.evaluate("window.__saved")), "Download Excel")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
