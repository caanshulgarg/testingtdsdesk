"""python3 run_2b_automatch_ui.py - the 2B page matches by itself (round 72b), on the made-up books (tests/fixtures/books), with
the gst-2b-match function stood in by tests/m2b_standin.mjs (the same rules file the function runs; a fixed stand-in in
place of Claude, never the real API):
  - a 2B brought in (the real file box, #twoBIn): the page asks the server to match at once, saying "uploaded"; only the
    fields the matching reads are sent (no narration, no ledger); the year's 2B by return period;
  - next-itc-simple (the owner, 24-Oct-2026: "this should not even show every time and every month in 2B.. it should be in
    input register or 2B reco as the case may be.. why confuse the user"): no box of its own anywhere (no line "N matched ·
    k to look at", no run line, no AI cost, no table of its own); the result is each line's status in the 2B
    reconciliation (a pair matched by AI: Matched with an "AI" tag, its reason on hover; one the AI only suggests: a
    probable match with Same / Not the same on its row) and the 2B column of the input register;
  - Same on the row: kept on the server and linked; the line is Matched;
  - a new purchase entry in the books: matched again by itself ("new entries"); "Match again" under the tab's ⋯;
  - AI help off: the app says so to the server; the server down: the rules here, nothing shown about it.
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
    pg.goto("http://localhost:8195/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1000)
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
    while time.time() - t0 < 15 and not [c for c in calls[n0:] if c.get("action") == "run"]: pg.wait_for_timeout(250)
    pg.wait_for_timeout(2000)
    runs = [c for c in calls[n0:] if c.get("action") == "run"]
    ok(len(runs) == 1 and runs[0].get("why") == "uploaded", "a 2B brought in: matched at once, silently, the server told \"uploaded\" (%s)" % [c.get("why") for c in runs])
    r0 = runs[0] if runs else {}
    keys_b = sorted(set(k for x in r0.get("books", []) for k in x)); keys_g = sorted(set(k for t in r0.get("twob", []) for x in t["rows"] for k in x))
    ok(keys_b == ["cess", "cgst", "date", "dir", "gstin", "id", "igst", "no", "party", "sgst", "taxable", "voucher", "ym"] and "narr" not in json.dumps(r0.get("books", [])[:3]),
       "only the fields the matching reads go to the server (books: %s)" % ",".join(keys_b))
    ok([t["period"] for t in r0.get("twob", [])] == ["032026"] and r0.get("gstin") == G and r0.get("fy") == "2025-26" and r0.get("ai") is True and r0.get("client_id"),
       "the year's 2B by return period, the GSTIN, the year, AI help on, the client")
    def no_box(where):
        t = pg.inner_text("#app")
        ok(pg.locator("[data-m2b],[data-m2b-line],[data-m2b-run],[data-m2b-look]").count() == 0 and "to look at" not in t and "AI looked at" not in t and "cost ₹" not in t, where + ": no auto-match box, line, run line or cost")
    no_box("2B reconciliation")
    rowof = lambda no: 'tr[data-ic-row]:has(.code:text-is("%s"))' % no
    ai_no = pg.evaluate("() => { const x = GST2B.run('07').pairs.find(p => p.ai && p.status === 'matched'); return x ? x.p.no : ''; }")
    pr_no = pg.evaluate("() => { const x = GST2B.run('07').pairs.find(p => p.ai && p.status === 'probable'); return x ? x.p.no : ''; }")
    ok(ai_no and pg.locator(rowof(ai_no) + " [data-ic-ai]").count() == 1 and pg.get_attribute(rowof(ai_no), "data-ic-chip-of") in ("matched", "cf") and "invoice number written differently" in (pg.get_attribute(rowof(ai_no) + " [data-ic-ai]", "title") or ""),
       "the pair matched by AI: Matched in the table (Carried forward when booked in an earlier month), with an AI tag and its reason on hover (%s)" % ai_no)
    ok(pr_no and pg.locator(rowof(pr_no) + " [data-reco-accept]").count() == 1 and pg.locator(rowof(pr_no) + " [data-reco-reject]").count() == 1, "the AI's suggestion: a probable match on its row, Same / Not the same (%s)" % pr_no)
    pg.screenshot(path=os.path.join(SHOTS, "1-desktop-table.png"), full_page=True)
    for part in ("inreg", "r3b", "itcfinal"):
        pg.evaluate("(p) => { S.gstPart = p; render(); }", part); pg.wait_for_timeout(500); no_box(part)
    pg.evaluate("() => { S.gstView = 'year'; render(); }"); pg.wait_for_timeout(400); no_box("the year's grid")
    pg.evaluate("() => { S.gstPart = 'inreg'; S.gstView = 'return'; S.inregScope = 'year'; render(); }"); pg.wait_for_timeout(500)
    ok(pg.evaluate("(no) => { const x = GST2B.run('07').pairs.find(p => p.p.no === no); return !!x && inregRows(S.books).rows.some(r => r.id === x.books[0].id && r.twoB === 'In 2B'); }", ai_no), "the input register's 2B column: the AI's pair is In 2B")
    pg.evaluate("() => { S.gstPart = 'r2b'; render(); }"); pg.wait_for_timeout(600)
    # Same on the row
    pid = pg.evaluate("() => GST2B.run('07').pairs.find(p => p.ai && p.status === 'probable').aiId")
    pg.click(rowof(pr_no) + " [data-reco-accept]"); pg.wait_for_timeout(1500)
    dec = [c for c in calls if c.get("action") == "decide"]
    ok(dec and dec[-1]["pairs"] == [pid] and dec[-1]["decision"] == "accept" and pg.get_attribute(rowof(pr_no), "data-ic-chip-of") in ("matched", "diff", "cf") and pg.evaluate("(no) => (GST2B.run('07').pairs.find(p => p.p.no === no) || {}).status", pr_no) != "probable", "Same: kept on the server, the line is matched (%s)" % (dec[-1] if dec else None))
    g_key = pid.split(">")[0]
    ok(pg.evaluate("(k) => !!(GST2B.state().link || {})[k] || (GST2B.state().confirm || {})[k] === 'yes'", g_key), "the accepted pair is kept for the rest of the 2B page")
    # a new purchase entry: matched again by itself
    n1 = len(calls)
    pg.evaluate("""() => { const v = JSON.parse(JSON.stringify(S.books.vouchers.find(x => x.type === 'Purchase'))); v.id = v.id + '-new'; v.no = 'N1'; v.ref = 'NEW/1'; v.date = '20260320'; v.refDate = '20260320'; S.books.vouchers = S.books.vouchers.concat([v]); GST2B._memo = null; render(); }""")
    pg.wait_for_timeout(2000)
    ok([c.get("why") for c in calls[n1:] if c.get("action") == "run"] == ["new entries"], "a new purchase entry: matched again by itself (\"new entries\")")
    # Match again, under ⋯
    def again():
        pg.click("[data-r2-more] > summary"); pg.wait_for_timeout(300); pg.click("[data-m2b-again]"); pg.wait_for_timeout(1500)
    n2 = len(calls); again()
    ok([c.get("why") for c in calls[n2:] if c.get("action") == "run"] == ["match again"], "Match again, under the tab's ⋯: run again (\"match again\")")
    pg.evaluate("S.firm.ai = {on: false}; render()"); n3 = len(calls); again()
    c3 = [c for c in calls[n3:] if c.get("action") == "run"]
    ok(c3 and c3[-1].get("ai") is False, "AI help off: the server is told")
    SV["down"] = True; again(); no_box("the server down")
    ok(pg.locator("[data-ic-row]").count() > 0 and not errors, "the server down: the rules here, the table as before, no error")
    SV["down"] = False; pg.evaluate("S.firm.ai = {on: true}; render()"); again()
    pg.set_viewport_size({"width": 390, "height": 900}); pg.wait_for_timeout(600)
    sw = pg.evaluate("document.documentElement.scrollWidth")
    pg.screenshot(path=os.path.join(SHOTS, "2-phone.png"))
    ok(sw <= 392, "phone 390: no sideways page scroll (page width %d)" % sw)
    ok(not errors, "no page errors" + (": " + "; ".join(errors[:3]) if errors else ""))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
