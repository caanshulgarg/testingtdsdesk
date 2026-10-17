"""python3 run_2b_automatch_ui.py - the 2B page matches by itself (round 72b), on the made-up books (tests/fixtures/books), with
the gst-2b-match function stood in by tests/m2b_standin.mjs (the same rules file the function runs; a fixed stand-in in
place of Claude, never the real API):
  - a 2B brought in (the real file box, #twoBIn): the page asks the server to match at once, saying "uploaded"; only the
    fields the matching reads are sent (no narration, no ledger); the year's 2B by return period;
  - the line "N matched (n by rules, m by AI) · k to look at · x in books only · y in 2B only" and the run line (when, why,
    what the AI did, its cost); probable matches first, each with Accept / Reject, and "Accept all suggestions (N)";
  - Accept: kept on the server and linked for the rest of the 2B page; the line moves;
  - a new purchase entry in the books: matched again by itself ("new entries"); "Match again" ("match again");
  - AI help off: the app says so to the server, and the line says the rules' result stands;
  - the server down: matched here by the rules only (the same file), and said so.
Screenshots (desktop 1366 and phone 390) to TDSDESK_SHOTS (default tests/out/2b-automatch). Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_2b_automatch_ui.py"""
import json, os, sys, time, threading, functools, http.server, subprocess, tempfile
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8195), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS") or os.path.join(HERE, "out", "2b-automatch"); os.makedirs(SHOTS, exist_ok=True)
CACHE = os.environ.get("TDSDESK_CACHE") or os.path.join(HERE, "out", "fixture-books-cache.json")
if not os.path.exists(CACHE): subprocess.run(["node", os.path.join(HERE, "fixture_cache.js"), CACHE], check=True)
books = json.load(open(CACHE))
fails, errors, calls = [], [], []
SV = {"decisions": {}, "down": False, "id": 0}
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def fake(route):
    b = json.loads(route.request.post_data or "{}"); calls.append(b)
    if SV["down"]: return route.fulfill(status=503, content_type="application/json", body=json.dumps({"ok": False, "error": "down for the test"}))
    if b.get("action") == "decide":
        for p in b.get("pairs") or []: SV["decisions"][p] = b.get("decision")
        q = dict(SV["last"], decisions=SV["decisions"], why="decided", ai=SV["last"].get("ai"))
    else:
        q = {"books": b.get("books"), "twob": b.get("twob"), "decisions": SV["decisions"], "ai": b.get("ai"), "why": b.get("why")}
        SV["last"] = q
    SV["id"] += 1; q = dict(q, id=SV["id"])
    out = subprocess.run(["node", os.path.join(HERE, "m2b_standin.mjs")], input=json.dumps(q), capture_output=True, text=True)
    route.fulfill(status=200, content_type="application/json", body=out.stdout or json.dumps({"ok": False, "error": out.stderr[:200]}))
G = "07AAGCL4827M1Z3"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/functions/v1/gst-2b-match", fake)
    pg.goto("http://localhost:8195/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)
    pg.evaluate("""(bk) => {
      Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://example.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: 't'}); Cloud.fresh = async () => {};
      window.saveBooks = async () => {}; window.ledgersReady = () => true;
      const c = newCompany({name: "ZZ TEST 2B auto", gstin: "07AAGCL4827M1Z3"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      LedMaster.refresh(S.books); LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true); window.__bk = S.books;
      S.firm = Object.assign({}, S.firm, {ai: {on: true}});
      S.booksTab = "gst"; S.gstYm = "202603"; S.gstReg = "07"; S.gstPart = "r2b"; S.gstView = "return"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    for _ in range(3):
        if not pg.locator("[data-state=open][aria-hidden=true]").count(): break
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ok(pg.locator("[data-m2b]").count() == 0, "no 2B yet: nothing to match, no box")
    # a 2B for March 2026 made from the books' own purchases: two as booked, one with its number written differently,
    # one with other figures, one not in 2B at all, and one not in the books
    j = pg.evaluate("""(g) => {
      const d = GST2B.bookDocs().filter(x => x.reg === '07' && x.gstin && x.dir === 1 && x.no && x.ym >= '202504' && x.ym <= '202603');
      const seen = new Set(), pick = d.filter(x => { const k = x.gstin + '|' + x.no; if (seen.has(k)) return false; seen.add(k); return true; });
      const inv = (x, no, f) => ({inum: no, dt: x.date.slice(6, 8) + '-' + x.date.slice(4, 6) + '-' + x.date.slice(0, 4), val: x.taxable + x.igst + x.cgst + x.sgst, txval: x.taxable * (f || 1), igst: x.igst * (f || 1), cgst: x.cgst * (f || 1), sgst: x.sgst * (f || 1), cess: 0, pos: '07', rev: 'N', itcavl: 'Y', typ: 'R'});
      const by = {}; const add = (x, no, f) => { (by[x.gstin] = by[x.gstin] || {ctin: x.gstin, trdnm: x.party.toUpperCase(), supfildt: '11-04-2026', supprd: '032026', inv: []}).inv.push(inv(x, no, f)); };
      window.__pick = pick.slice(0, 5).map(x => ({id: x.id, no: x.no, gstin: x.gstin, party: x.party}));
      if (pick[0]) add(pick[0], pick[0].no); if (pick[1]) add(pick[1], pick[1].no);
      if (pick[2]) add(pick[2], 'BILL/2025-26/' + String(pick[2].no).replace(/^\\D+/, ''));
      if (pick[3]) add(pick[3], pick[3].no + '-A', 1.1);
      by['07AAACZ9999Q1Z1'] = {ctin: '07AAACZ9999Q1Z1', trdnm: 'ZENITH OFFICE SUPPLIES', inv: [{inum: 'ZOS/88', dt: '20-03-2026', txval: 2000, igst: 0, cgst: 180, sgst: 180, cess: 0, pos: '07', rev: 'N', itcavl: 'Y'}]};
      return {data: {gstin: g, rtnprd: '032026', gendt: '14-04-2026', docdata: {b2b: Object.values(by)}}}; }""", G)
    pick = pg.evaluate("window.__pick")
    ok(len(pick) >= 4, "the made-up books have purchases to make a 2B from (%d)" % len(pick))
    f = os.path.join(tempfile.mkdtemp(), "returns_R2B_%s_032026.json" % G); json.dump(j, open(f, "w"))
    n0 = len(calls)
    pg.set_input_files("#twoBIn", f)
    t0 = time.time()
    while time.time() - t0 < 15 and not pg.locator("[data-m2b-line]").count(): pg.wait_for_timeout(250)
    pg.wait_for_timeout(1500)
    runs = [c for c in calls[n0:] if c.get("action") == "run"]
    ok(len(runs) == 1 and runs[0].get("why") == "uploaded", "a 2B brought in: matched at once, the server told \"uploaded\" (%s)" % [c.get("why") for c in runs])
    r0 = runs[0] if runs else {}
    keys_b = sorted(set(k for x in r0.get("books", []) for k in x)); keys_g = sorted(set(k for t in r0.get("twob", []) for x in t["rows"] for k in x))
    ok(keys_b == ["cess", "cgst", "date", "dir", "gstin", "id", "igst", "no", "party", "sgst", "taxable", "voucher", "ym"] and "narr" not in json.dumps(r0.get("books", [])[:3]),
       "only the fields the matching reads go to the server (books: %s)" % ",".join(keys_b))
    ok([t["period"] for t in r0.get("twob", [])] == ["032026"] and r0.get("gstin") == G and r0.get("fy") == "2025-26" and r0.get("ai") is True and r0.get("client_id"),
       "the year's 2B by return period, the GSTIN, the year, AI help on, the client")
    line = pg.inner_text("[data-m2b-line]") if pg.locator("[data-m2b-line]").count() else ""
    ok(line.startswith("3 matched (2 by rules, 1 by AI)") and "1 to look at" in line and "in books only" in line and "1 in 2B only" in line, "the line: " + line)
    run_line = pg.inner_text("[data-m2b-run]") if pg.locator("[data-m2b-run]").count() else ""
    ok("after 2B was brought in" in run_line and "cost ₹1.87" in run_line, "the run line: when, why, what AI did and its cost: " + run_line)
    rows = pg.locator("[data-m2b-row]")
    ok(rows.count() == 1 and "Probable match" in rows.first.inner_text() and "AI: invoice number written differently" in rows.first.inner_text(), "the probable match first, with the AI's reason and the figures of both sides")
    ok(pg.locator("[data-m2b-accept-all]").count() == 1 and "Accept all suggestions (1)" in pg.inner_text("[data-m2b-accept-all]"), "Accept all suggestions (1)")
    pg.locator("[data-m2b]").screenshot(path=os.path.join(SHOTS, "1-desktop-box.png")); pg.screenshot(path=os.path.join(SHOTS, "2-desktop-page.png"))
    # Accept
    pid = pg.get_attribute("[data-m2b-accept]", "data-m2b-accept")
    pg.click("[data-m2b-accept]"); pg.wait_for_timeout(1500)
    dec = [c for c in calls if c.get("action") == "decide"]
    line = pg.inner_text("[data-m2b-line]")
    ok(dec and dec[-1]["pairs"] == [pid] and dec[-1]["decision"] == "accept" and line.startswith("4 matched (2 by rules, 2 by AI)") and "0 to look at" in line, "Accept: kept on the server, the line moves: " + line)
    g_key = pid.split(">")[0]
    ok(pg.evaluate("(k) => !!(GST2B.state().link || {})[k]", g_key), "the accepted pair is linked for the rest of the 2B page")
    # a new purchase entry: matched again by itself
    n1 = len(calls)
    pg.evaluate("""() => { const v = JSON.parse(JSON.stringify(S.books.vouchers.find(x => x.type === 'Purchase'))); v.id = v.id + '-new'; v.no = 'N1'; v.ref = 'NEW/1'; v.date = '20260320'; v.refDate = '20260320'; S.books.vouchers = S.books.vouchers.concat([v]); GST2B._memo = null; render(); }""")
    pg.wait_for_timeout(2000)
    ok([c.get("why") for c in calls[n1:] if c.get("action") == "run"] == ["new entries"], "a new purchase entry: matched again by itself (\"new entries\")")
    # Match again
    n2 = len(calls); pg.click("[data-m2b-again]"); pg.wait_for_timeout(1500)
    ok([c.get("why") for c in calls[n2:] if c.get("action") == "run"] == ["match again"], "Match again: run again (\"match again\")")
    # AI help off
    pg.evaluate("S.firm.ai = {on: false}; render()"); n3 = len(calls); pg.click("[data-m2b-again]"); pg.wait_for_timeout(1500)
    c3 = [c for c in calls[n3:] if c.get("action") == "run"]
    ok(c3 and c3[-1].get("ai") is False and "rules' result stands" in pg.inner_text("[data-m2b-run]"), "AI help off: the server is told, the run line says the rules' result stands")
    # the server down: the rules here
    SV["down"] = True; pg.click("[data-m2b-again]"); pg.wait_for_timeout(1500)
    run_line = pg.inner_text("[data-m2b-run]"); line = pg.inner_text("[data-m2b-line]")
    ok("rules only" in run_line and "by AI)" in line and pg.locator("[data-m2b-accept]").count() == 0, "the server down: matched here by the rules only, said so: " + run_line)
    SV["down"] = False; pg.evaluate("S.firm.ai = {on: true}; render()"); pg.click("[data-m2b-again]"); pg.wait_for_timeout(1500)
    # phone
    pg.set_viewport_size({"width": 390, "height": 900}); pg.wait_for_timeout(600)
    sw = pg.evaluate("document.documentElement.scrollWidth")
    pg.locator("[data-m2b]").screenshot(path=os.path.join(SHOTS, "3-phone-box.png"))
    ok(sw <= 392, "phone 390: no sideways page scroll (page width %d)" % sw)
    ok(not errors, "no page errors" + (": " + "; ".join(errors[:3]) if errors else ""))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
