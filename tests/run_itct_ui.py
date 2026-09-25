"""python3 run_itct_ui.py - ITC follow-up: worked out from Tally and every 2B, decisions kept and carried, supplier letters logged."""
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
    pg.goto("http://localhost:8140/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""([bk, js]) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books);
      js.forEach(j => { const t = GST2B.fromJson(j); S.books.twoBs[t.gstin + "|" + t.period] = t; }); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "follow"; S.gstYm = "202603"; S.gstReg = "07"; render(); }""", [books, [json.load(open(f)) for f in files]])
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(6000)
    t = pg.inner_text("#app")
    ok("ITC follow-up" in t and "In Tally, not in 2B" in t and "In 2B, not in Tally" in t and "Suppliers to write to" in t, "the follow-up list and the suppliers to write to")
    ok("No 2B here for" in t, "says which months have no 2B, so their bills are not checked")
    pg.screenshot(path=OUT + "/itct.png", full_page=False)
    n0 = pg.evaluate("ITCT.items('07').items.filter(x => x.open && x.cat === 'waiting').length")
    key = pg.evaluate("ITCT.items('07').items.find(x => x.open && x.cat === 'waiting').key")
    pg.select_option('select[data-itctact="%s"]' % key, "expense"); pg.wait_for_timeout(4000)
    n1 = pg.evaluate("ITCT.items('07').items.filter(x => x.open && x.cat === 'waiting').length")
    ok(n1 == n0 - 1 and pg.evaluate("S.books.itcTrack['07'].dec[%s].act" % json.dumps(key)) == "expense", "giving up the credit on one bill settles it, and the decision is kept (%d to %d open)" % (n0, n1))
    k2 = pg.evaluate("ITCT.items('07').items.find(x => x.open && x.cat === 'tobook').key")
    pg.fill('input[data-itctnote=%s]' % json.dumps(k2), "Bill with Rahul, to book Monday"); pg.press('input[data-itctnote=%s]' % json.dumps(k2), "Tab"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.books.itcTrack['07'].dec[%s].note" % json.dumps(k2)) == "Bill with Rahul, to book Monday", "a note on a line is kept")
    # carried forward: the same decisions after the books are read again (a new render from scratch)
    pg.evaluate("GST2B._memo = null; render()"); pg.wait_for_timeout(5000)
    ok(pg.evaluate("ITCT.items('07').items.find(x => x.key === %s).act" % json.dumps(key)) == "expense" and pg.evaluate("document.querySelector('input[data-itctnote=' + JSON.stringify(%s) + ']').value" % json.dumps(k2)) == "Bill with Rahul, to book Monday", "decisions and notes are still there when the list is worked out again")
    # a supplier letter, logged
    sup = pg.evaluate("ITCT.suppliers('07', ITCT.items('07').items)[0].key")
    pg.fill('input[data-itctemail=%s]' % json.dumps(sup), "accounts@supplier.example"); pg.press('input[data-itctemail=%s]' % json.dumps(sup), "Tab"); pg.wait_for_timeout(800)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    pg.click('button[data-act="itctCopy"][data-sup=%s]' % json.dumps(sup)); pg.wait_for_timeout(2500)
    clip = pg.evaluate("navigator.clipboard.readText()")
    ok("do not appear in our GSTR-2B" in clip and "30 November" in clip, "the letter lists the bills and the last date for credit")
    ok(len(pg.evaluate("S.books.itcTrack['07'].sent[%s]" % json.dumps(sup)) or []) == 1 and pg.evaluate("S.books.itcTrack['07'].contact[%s].email" % json.dumps(sup)) == "accounts@supplier.example", "writing is logged, and the email kept for next time")
    # 3B: a supplier's credit note in 2B reduces credit; rejecting it in IMS takes it back out
    cnk = pg.evaluate("(ITCT.items('07').items.find(x => x.cat === 'suppcn') || {}).key || ''")
    if cnk:
        a = pg.evaluate("GSTR.threeB('%s','07').cn2b.n" % pg.evaluate("ITCT.items('07').items.find(x => x.cat === 'suppcn').ym2b"))
        pg.select_option('select[data-itctact=%s]' % json.dumps(cnk), "reject"); pg.wait_for_timeout(3000)
        c = pg.evaluate("GSTR.threeB('%s','07').cn2b.n" % pg.evaluate("ITCT.items('07').items.find(x => x.cat === 'suppcn').ym2b"))
        ok(a == 1 and c == 0, "a supplier's credit note in 2B reduces 3B credit; rejected in IMS, it does not")
    pg.select_option('select[data-itctshow]', "all"); pg.wait_for_timeout(4000)
    ok("Taken in a later month" in pg.inner_text("#app") and "Not checked yet" in pg.inner_text("#app"), "everything view: settled lines too")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="itctExcel"]'); pg.wait_for_timeout(5000)
    ok(any("ITC-follow-up" in n for n in pg.evaluate("window.__saved")), "Excel: open, IMS actions, letters, settled")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
