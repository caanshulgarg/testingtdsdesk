"""python3 run_gst_draftcopy_ui.py - GST > Amendments with a GSTR-1 JSON downloaded here (owner, 22-Oct-2026, Leads Insurance,
Apr-2026: "why this is showing when I have not marked any return as filed"):
  - downloaded, month not marked filed: no "the books against the return filed" card, nothing to report, the copy listed as
    "Downloaded, not filed";
  - the month marked filed: the card, with "Compared with the JSON downloaded on <date>; ... bring that one in";
  - a copy brought in from the portal: the card at once, without that line.
Made-up books only. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gst_draftcopy_ui.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8617), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  const CMP = "07AAACL1234A1ZH", reg = "07";
  const V = (id, date, no, party, ent, extra) => Object.assign({id, type: "Sales", date, no, party, gstin: "", pos: "", cmp: CMP, narr: "", ent: ent.map(([l, a, o]) => Object.assign({l, a}, o || {})), hsn: []}, extra || {});
  const G = {h: "9971", gr: 18};
  const vs = [V("s1", "20260410", "LEADS/2627/0002", "Beta", [["Beta", -1085683], ["Sales", 920070, G], ["Output IGST", 165613]], {gstin: "27AABCB2222B1ZI", pos: "Maharashtra"}),
    V("s2", "20260415", "LEADS/2627/0003", "Alpha", [["Alpha", -118000], ["Sales", 100000, G], ["Output CGST", 9000], ["Output SGST", 9000]], {gstin: "07AABCA1111A1ZT", pos: "Delhi"})];
  const c = newCompany({name: "ZZ TEST (draft copy)", gstin: CMP});
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = {loading: false, cid: c.id, vouchers: vs, meta: {from: "20260401", to: "20260630", gstins: [CMP], bills: 1}, under: {"Sales": "Sales Accounts", "Beta": "Sundry Debtors", "Alpha": "Sundry Debtors"},
    groups: {"Sales Accounts": "Primary", "Sundry Debtors": "Primary"}, gstins: {}, states: {}, challans: [], alloc: {}, certs: []};
  b.map = Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  set("Output IGST", {what: "gst", kind: "gst", tax: "IGST", side: "output", reg}); set("Output CGST", {what: "gst", kind: "gst", tax: "CGST", side: "output", reg}); set("Output SGST", {what: "gst", kind: "gst", tax: "SGST", side: "output", reg});
  S.books = b; window.__bk = b;
  // the copy downloaded before the fix: LEADS/2627/0002 with part of it as 0% sales
  const j = GSTR.toJson("202604", reg, {plain: true}), inv = j.b2b.find(g => g.ctin === "27AABCB2222B1ZI").inv[0];
  inv.itms = [{num: 1, itm_det: {rt: 0, txval: 1085683, iamt: 0, csamt: 0}}, {num: 2, itm_det: {rt: 18, txval: 920070, iamt: 165613, csamt: 0}}];
  window.__buggy = JSON.stringify(j);
  GSTAmend.keep(JSON.parse(window.__buggy), "downloaded"); b.filed[CMP + "|042026"].at = "2026-05-08T06:00:00.000Z";
  S.booksTab = "gst"; S.gstPart = "amend"; S.gstYm = "202604"; S.gstReg = reg; render(); }"""
def app(pg): return pg.inner_text("#app")
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8617/"); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1500)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)
    pg.evaluate(SETUP); pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(700)
    t = app(pg)
    ok("Filed GSTR-1 returns kept here" in t, "the Amendments screen is open")
    ok("the books against the return filed" not in t.lower(), "downloaded, not marked filed: no 'books against the return filed' card (Leads, Apr-2026)")
    ok("Taxable value filed" not in t and "LEADS/2627/0002" not in t, "no filed taxable value, no LEADS/2627/0002 differences")
    ok(pg.locator("[data-draft-copy]").count() == 1 and "Downloaded, not filed" in t, "the copy is listed as 'Downloaded, not filed'")
    ok(pg.locator('input[aria-label="This copy was not filed"]').count() == 1, "the 'Not filed' tick is still there")
    pg.evaluate("S.gstYm = '202605'; render();"); pg.wait_for_timeout(500)
    t = app(pg)
    ok("LEADS/2627/0002" not in t.split("To report in")[1] if "To report in" in t else True, "May: no amendment for April")
    # marked filed on 11 May (as the 'Filed on' action keeps it)
    pg.evaluate("() => { GSTF.rec('202604', '07').r1 = '2026-05-11'; S.gstYm = '202604'; render(); }"); pg.wait_for_timeout(600)
    t = app(pg)
    ok("the books against the return filed" in t.lower() and "LEADS/2627/0002" in t, "marked filed: the card shows, with LEADS/2627/0002")
    line = pg.locator("[data-compared-with]")
    ok(line.count() == 1 and "Compared with the JSON downloaded on 08" in line.inner_text() and "bring that one in" in line.inner_text(), "the line names the download it compares with: " + (line.inner_text() if line.count() else "none"))
    ok(pg.locator("[data-draft-copy]").count() == 0 and "downloaded here" in t, "the copy is now listed as downloaded here")
    # a copy brought in from the portal counts at once
    pg.evaluate("() => { delete S.books.gstFiled; S.books.filed = {}; GSTAmend.keep(JSON.parse(window.__buggy), 'portal'); render(); }"); pg.wait_for_timeout(600)
    t = app(pg)
    ok("the books against the return filed" in t.lower() and "brought in" in t, "a copy brought in from the portal: the card at once")
    ok(pg.locator("[data-compared-with]").count() == 0, "no 'downloaded on' line for a portal copy")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
