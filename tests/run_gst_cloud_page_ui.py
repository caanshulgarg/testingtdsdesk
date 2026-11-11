"""python3 run_gst_cloud_page_ui.py - next-cloud-gst: the GSTR-3B page (Summary and Details) and the 3B FinCom's cloud
worked out (gst-run, migration 153), with the fingerprint guard (app/src/screens/gst/cloud3b.js). Made-up books
(tests/fixtures/books); FinCom's cloud stood in by the browser's own routes (rpc gst_calc_cached and the gst-run function),
never a real database. The cloud's answer is made from the page's own 3B (boxes() as server/gst-run/engine.js keeps it)
with the fingerprint server/_shared/gst3bprint.js makes, so only the guard decides.
  1. the cloud's 3B current and made from these books (its fingerprint is the page's, its engine GST3B_SRC the page's):
     "Worked out in FinCom's cloud at HH:MM", every figure on Summary and Details the same as the page works out itself,
     and the page works no 3B out (GSTR.threeBNow not called while drawing); the cloud not asked to work it out again
  2. while the cloud's first answer is awaited: "Looking for this month's 3B in FinCom's cloud…", then the cloud's
  3. the books here differ (an entry the cloud has not; a figure typed into 3B here; a ledger whose kind is a guess): "Worked
     out here", the page's own figures, and gst-run asked once (action month) to work the month out again
  4. the cloud's engine is not the page's (another GST3B_SRC): worked out here
  5. nothing kept in the cloud (result null): worked out here, gst-run asked; the cloud leaving the client to the app (too
     big): worked out here, not asked; the cloud down (HTTP 500) or not answering in time: worked out here
  6. the File tab and a figure opened to its bills are always worked out here
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gst_cloud_page_ui.py"""
import json, os, re, sys, time, threading, functools, http.server, subprocess
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
SITE = os.environ.get("TDSDESK_SITE", os.path.join(ROOT, "app", "dist-test"))
PORT = int(os.environ.get("GSTCLOUD_PORT") or 8653)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
CACHE = os.environ.get("TDSDESK_CACHE") or os.path.join(HERE, "out", "fixture-books-cache.json")
if not os.path.exists(CACHE): subprocess.run(["node", os.path.join(HERE, "fixture_cache.js"), CACHE], check=True)
books = json.load(open(CACHE))
PRINT_JS = open(os.path.join(ROOT, "server", "_shared", "gst3bprint.js"), encoding="utf8").read()
ENG = open(os.path.join(ROOT, "server", "gst-run", "engine.js"), encoding="utf8").read()
BOXES = re.search(r"export function boxes\(t\) \{.*?\n\}\n", ENG, re.S).group(0).replace("export function boxes", "function boxes")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the cloud as the test sets it: mode "ok" (the month's answer in SV["answers"], kept by month as gst_calc_cached keeps it by
# its args), "none" (nothing kept), "big" (left to the app), "down"; hold: the request is kept unanswered (SV["held"])
SV = {"mode": "ok", "answers": {}, "cached": [], "runs": [], "hold": False, "held": []}
def cached(route):
    b = json.loads(route.request.post_data or "{}"); SV["cached"].append(b)
    if SV["hold"]: SV["held"].append(route); return
    answer(route, b)
def answer(route, b):
    m = SV["mode"]
    if m == "down": return route.fulfill(status=500, content_type="application/json", body=json.dumps({"message": "down for the test"}))
    a = {"book": "bk-1", "version": "v-1", "result": None, "at": None, "too_big": m == "big"}
    if m == "ok" and b.get("p_ym") in SV["answers"]: a.update(SV["answers"][b["p_ym"]])
    route.fulfill(status=200, content_type="application/json", body=json.dumps(a))
def gstrun(route):
    SV["runs"].append(json.loads(route.request.post_data or "{}"))
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "result": None, "pending": True, "started": True}))
def other(route):
    route.fulfill(status=200, content_type="application/json", body="[]")

SETUP = """(bk) => {
  Cloud.on = () => true; Cloud.cfg = () => ({url: 'https://stand-in.supabase.co', key: 'anon'}); Cloud.sess = () => ({access_token: 't'}); Cloud.fresh = async () => {};
  window.saveBooks = async () => {}; window.ledgersReady = () => true;
  const c = newCompany({name: "ZZ TEST cloud 3B", gstin: "07AAGCL4827M1Z3"});
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
  LedMaster.refresh(S.books); LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true);
  // every ledger's kind confirmed (nothing pending: gst3bprint.js's pend 0, the cloud's 3B may be used)
  Object.keys(S.books.map).forEach(k => { const m = S.books.map[k]; if ((m.n || 0) > 0 && m.kind && !m.ok && !m.byHand) S.books.map[k] = Object.assign({}, m, {ok: true}); });
  window.__bk = S.books;
  S.booksTab = "gst"; S.gstYm = "202510"; S.gstReg = "07"; S.gstPart = "r3b"; S.gstView = "return"; S.gstSub = "summary"; S.r3bOpen = "none"; render();
  // a count of the 3Bs the page works out itself
  window.__n3b = 0; const was = GSTR.threeBNow; GSTR.threeBNow = function(){ window.__n3b++; return was.apply(this, arguments); };
  return c.id; }"""
# the cloud's answer for the month on screen, made as gst-run keeps it: the 3B's boxes, the engine's source, the fingerprint
ANSWER = """async ([src, at]) => {
  const P = await import("/__test/gst3bprint.js"), {boxes} = await import("/__test/boxes.js");
  const ym = S.gstYm, reg = S.gstReg, sales = S.sales && S.sales.cid === S.coId ? S.sales.list || [] : [];
  GSTR._carry = null; const t = memoScope(() => GSTR.threeB(ym, reg));
  const fp = Object.assign(P.gst3bPrint(S.books, sales, ""), {run: ""});
  return {result: Object.assign(boxes(t), {engine: "e-test", src: src === null ? GST3B_SRC : src, fp}), at}; }"""
# what the page shows: where it was worked out, and the text of every table (Summary's portal tables, Details' tables)
SHOWN = """() => { const w = document.querySelector("#app [data-r3b-where]");
  const tabs = [...document.querySelectorAll("#app [data-r3b-table], #app .bk-tablewrap table[data-statement]")].map(e => e.textContent.replace(/\\s+/g, " ").trim());
  return {where: w ? w.dataset.r3bWhere : "", words: w ? w.textContent.trim() : "", tables: tabs, n3b: window.__n3b}; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("https://stand-in.supabase.co/rest/v1/rpc/gst_calc_cached", cached)
    pg.route("https://stand-in.supabase.co/functions/v1/gst-run", gstrun)
    pg.route("**/__test/boxes.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="export " + BOXES))
    pg.route("**/__test/gst3bprint.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=PRINT_JS))
    pg.route(re.compile(r"^https://stand-in\.supabase\.co/(?!rest/v1/rpc/gst_calc_cached|functions/v1/gst-run).*"), other)
    E = pg.evaluate
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    E("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1000)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)

    # the page's own figures first, for Summary and Details: drawn with a figure "opened" that is no figure (the page works
    # its 3B out itself whenever a figure is open; none is shown), so the cloud is not asked
    cid = E(SETUP, books); pg.wait_for_timeout(1200)
    E("() => { S.books = window.__bk; S.r3bOpen = 'none'; S.gstSub = 'summary'; render(); }"); pg.wait_for_timeout(1500)
    local_sum = E(SHOWN)
    if os.environ.get("GSTCLOUD_DEBUG"): print(E("() => document.querySelector('#app').innerText.slice(0, 1500)"))
    E("() => { S.gstSub = 'details'; render(); }"); pg.wait_for_timeout(700)
    local_det = E(SHOWN); E("() => { S.r3bOpen = ''; }")
    ok(local_sum["where"] == "here" and local_sum["words"] == "Worked out here" and len(local_sum["tables"]) >= 5 and len(local_det["tables"]) >= 4 and not SV["cached"],
       "the page's own 3B: \"Worked out here\" (%d tables on Summary, %d on Details), the cloud not asked" % (len(local_sum["tables"]), len(local_det["tables"])))
    ok(any(re.search(r"[1-9]", t) for t in local_sum["tables"]), "the month has figures to compare")

    print("1. the cloud's 3B, made from these same books")
    now = E("() => new Date().toISOString()")
    SV["answers"]["202510"] = E(ANSWER, [None, now]); SV["mode"] = "ok"
    E("() => { S.gstYm = '202510'; S.gstSub = 'summary'; render(); }")
    t0 = time.time()
    while time.time() - t0 < 6 and E(SHOWN)["where"] in ("", "wait"): pg.wait_for_timeout(100)
    pg.wait_for_timeout(300)
    E("() => { window.__n3b = 0; GSTR._carry = null; render(); }"); pg.wait_for_timeout(500)
    s = E(SHOWN)
    if os.environ.get("GSTCLOUD_DEBUG"): print(E("""async (a) => { const P = await import("/__test/gst3bprint.js"); const ym = S.gstYm, reg = S.gstReg;
      const m = M2B.st[M2B.key(reg, M2B.fyOf(ym))]; const fp = P.gst3bPrint(S.books, S.sales && S.sales.cid === S.coId ? S.sales.list || [] : [], m && m.run ? m.run.id : "");
      return {same: P.gst3bSame(fp, a.result.fp), now: fp, was: a.result.fp, src: a.result.src, mine: GST3B_SRC, run: m ? Object.keys(m) : null}; }""", SV["answers"]["202510"]))
    hm = E("(at) => { const d = new Date(at); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }", now)
    ok(s["where"] == "cloud" and s["words"] == "Worked out in FinCom’s cloud at " + hm, "Summary: %r" % s["words"])
    ok(s["tables"] == local_sum["tables"], "Summary: every table the same as the page works out itself")
    ok(s["n3b"] == 0, "Summary: no 3B worked out here while drawing (GSTR.threeBNow called %d times)" % s["n3b"])
    E("() => { window.__n3b = 0; S.gstSub = 'details'; render(); }"); pg.wait_for_timeout(600)
    s = E(SHOWN)
    ok(s["where"] == "cloud" and s["tables"] == local_det["tables"], "Details: the cloud's, every table the same as the page's own")
    ok(s["n3b"] == 0, "Details: no 3B worked out here (%d)" % s["n3b"])
    ok(len(SV["cached"]) == 1 and SV["cached"][0] == {"p_client": cid, "p_reg": "07", "p_ym": "202510"}, "the cloud asked once for the month (%s)" % SV["cached"])
    ok(not SV["runs"], "a current answer: the cloud not asked to work it out again")

    print("2. the first answer awaited")
    E("() => { S.gstYm = '202511'; }"); SV["answers"]["202511"] = E(ANSWER, [None, now]); SV["hold"] = True
    E("() => { S.gstSub = 'summary'; render(); }"); pg.wait_for_timeout(1000)
    s = E(SHOWN)
    ok(s["where"] == "wait" and s["words"] == "Looking for this month\u2019s 3B in FinCom\u2019s cloud\u2026", "while the cloud answers: %r" % s["words"])
    SV["hold"] = False
    for r in SV["held"]: answer(r, json.loads(r.request.post_data or "{}"))
    SV["held"] = []; pg.wait_for_timeout(800)
    s = E(SHOWN)
    ok(s["where"] == "cloud", "then the cloud's, once it answered (%s)" % s["words"])

    def fresh(ym):
        E("(ym) => { S.gstYm = ym; S.gstSub = 'summary'; render(); }", ym)
        t0 = time.time()
        while time.time() - t0 < 6 and E(SHOWN)["where"] in ("", "wait"): pg.wait_for_timeout(100)
        pg.wait_for_timeout(300)
        E("() => { window.__n3b = 0; render(); }"); pg.wait_for_timeout(400)
        return E(SHOWN)
    print("3. the books here differ from the cloud's")
    # December: the answer made, then an entry added here only
    E("() => { S.gstYm = '202512'; }"); SV["answers"][E("() => S.gstYm")] = E(ANSWER, [None, now]); SV["mode"] = "ok"; n0 = len(SV["runs"])
    E("""() => { const v = JSON.parse(JSON.stringify(S.books.vouchers.find(x => x.type === 'Sales' && String(x.date).slice(0, 6) === '202512') || S.books.vouchers[0]));
      v.id = 'local-only-1'; v.no = 'LOCAL/1'; S.books.vouchers.push(v); GSTR._carry = null; }""")
    s = fresh("202512")
    ok(s["where"] == "here" and s["words"] == "Worked out here" and s["n3b"] > 0, "an entry the cloud has not: \"Worked out here\", the page works the 3B out itself")
    runs = SV["runs"][n0:]
    ok(len(runs) == 1 and runs[0] == {"action": "month", "client_id": cid, "reg": "07", "ym": "202512"}, "gst-run asked once to work the month out again (%s)" % runs)
    E("() => { render(); }"); pg.wait_for_timeout(300)
    ok(len(SV["runs"][n0:]) == 1, "and not again on the next drawing (at most once a minute)")
    E("() => { S.books.vouchers = S.books.vouchers.filter(v => v.id !== 'local-only-1'); GSTR._carry = null; }")
    # January: a figure typed into 3B here
    E("() => { S.gstYm = '202601'; }"); SV["answers"][E("() => S.gstYm")] = E(ANSWER, [None, now]); n0 = len(SV["runs"])
    E("() => { S.books.gst3b = Object.assign({}, S.books.gst3b, {'07|202601': {rev2: {igst: 12.5}}}); GSTR._carry = null; }")
    s = fresh("202601")
    ok(s["where"] == "here" and s["n3b"] > 0 and len(SV["runs"][n0:]) == 1, "a figure typed into 3B here: worked out here, the cloud asked")
    E("() => { delete S.books.gst3b['07|202601']; GSTR._carry = null; }")
    # February: a ledger whose kind is a guess
    E("() => { S.gstYm = '202602'; }"); SV["answers"][E("() => S.gstYm")] = E(ANSWER, [None, now])
    led = E("() => { const k = Object.keys(S.books.map).find(n => (S.books.map[n].n || 0) > 0 && S.books.map[n].kind); const m = S.books.map[k]; window.__led = [k, JSON.stringify(m)]; S.books.map[k] = Object.assign({}, m, {ok: false, byHand: false}); GSTR._carry = null; return k; }")
    s = fresh("202602")
    ok(s["where"] == "here", "a ledger whose kind is a guess (%s): worked out here" % led)
    E("() => { S.books.map[window.__led[0]] = JSON.parse(window.__led[1]); GSTR._carry = null; }")

    print("4. another engine")
    E("() => { S.gstYm = '202507'; }"); SV["answers"]["202507"] = E(ANSWER, ["s0000000000000000", now])
    s = fresh("202507")
    ok(s["where"] == "here", "the cloud's engine is not the page's: worked out here")

    print("5. nothing kept, too big, down, slow")
    SV["mode"] = "none"; n0 = len(SV["runs"])
    s = fresh("202508")
    ok(s["where"] == "here" and [r["ym"] for r in SV["runs"][n0:]] == ["202508"], "nothing kept: worked out here, gst-run asked")
    SV["mode"] = "big"; n0 = len(SV["runs"])
    s = fresh("202509")
    ok(s["where"] == "here" and not SV["runs"][n0:], "left to the app (too big): worked out here, not asked")
    SV["mode"] = "down"; n0 = len(SV["runs"])
    s = fresh("202506")
    ok(s["where"] == "here" and not SV["runs"][n0:], "the cloud down: worked out here")
    SV["mode"] = "ok"; E("() => { S.gstYm = '202505'; }"); SV["answers"]["202505"] = E(ANSWER, [None, now]); SV["hold"] = True
    E("() => { render(); }"); t0 = time.time()
    while time.time() - t0 < 8 and E(SHOWN)["where"] in ("", "wait"): pg.wait_for_timeout(100)
    took = time.time() - t0; s = E(SHOWN); SV["hold"] = False
    ok(s["where"] == "here" and 2.5 < took < 4.5, "the cloud not answering: worked out here after %.1f s" % took)
    for r in SV["held"]: answer(r, json.loads(r.request.post_data or "{}"))
    SV["held"] = []

    print("6. the File tab, a figure opened")
    E("() => { S.gstYm = '202510'; }"); SV["answers"][E("() => S.gstYm")] = E(ANSWER, [None, now])
    s = fresh("202510")
    ok(s["where"] == "cloud", "October again: the cloud's")
    E("() => { window.__n3b = 0; S.gstSub = 'file'; render(); }"); pg.wait_for_timeout(600)
    ok(E("() => window.__n3b") > 0 and not E("() => document.querySelector('#app [data-r3b-where]')"), "the File tab works the 3B out here")
    E("() => { S.gstSub = 'summary'; S.r3bOpen = '4A5'; window.__n3b = 0; render(); }"); pg.wait_for_timeout(600)
    s = E(SHOWN)
    ok(s["where"] == "here" and s["n3b"] > 0, "a figure opened to its bills: worked out here")
    E("() => { S.r3bOpen = ''; render(); }")
    pg.screenshot(path=os.path.join(HERE, "out", "gst-cloud-page.png"))
    br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("all ok" if not fails else "%d FAILED" % len(fails)); sys.exit(1 if fails else 0)
