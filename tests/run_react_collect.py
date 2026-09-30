"""python3 run_react_collect.py - Collect in React: the upload block, paste a bill, the PDF option, the reading queue and
its buttons, the "reading…" card, a client's document inbox, and uploads that matched no client.
Offline, made-up clients and files; the reading itself and the firm account are stood in.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_collect.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8153), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1300, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8153/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""() => { const c = newCompany({name: "ZZ Epsilon Mills", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true};
      c.stats = {}; window.__calls = []; return c.id; }""")
    pg.evaluate("(cid) => openCompany(cid).then(() => goStep('collect', 'bills'))", cid); pg.wait_for_timeout(1200)
    app = lambda: pg.inner_text("#app")
    ok("Upload for ZZ Epsilon Mills" in app() and "Nothing waiting in the inbox for ZZ Epsilon Mills" in app(), "Collect: the upload box, and nothing in the inbox")
    ok(pg.locator("#app .rcheck .tag").count() >= 3 and "PDF text" in pg.inner_text("#app .rcheck"), "the reading check's tags")
    # the PDF option is remembered
    pg.click('#app label:has-text("A PDF holds many bills") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("S.splitPdf") is True and pg.evaluate("lsGet('tdsdesk-test:splitPdf') || lsGet('tdsdesk:splitPdf')") == "1", "“A PDF holds many bills” is switched on and remembered")
    pg.evaluate("render()"); pg.wait_for_timeout(200)
    ok(pg.is_checked('#app label:has-text("A PDF holds many bills") input'), "and stays ticked through a redraw")
    # paste bill details
    pg.click('#app button:has-text("Paste bill details")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.activeElement.tagName") == "TEXTAREA", "Paste bill details: the box has the cursor")
    pg.fill("#app textarea", json.dumps({"vendorName": "ZZ Paste Supplier", "invoiceNo": "P-1", "invoiceDate": "2026-09-01", "totalAmount": 1180, "taxableValue": 1000}))
    pg.evaluate("render()"); pg.wait_for_timeout(200)
    ok("ZZ Paste Supplier" in pg.input_value("#app textarea"), "what was pasted stays through a redraw")
    pg.click('#app button:has-text("Add to ZZ Epsilon Mills")'); pg.wait_for_timeout(1000)
    ok(any(e["x"].get("vendorName") == "ZZ Paste Supplier" for e in pg.evaluate("Object.values(D().entries)")), "Add: the bill is in the client's drafts")
    # the reading queue
    pg.evaluate("""(cid) => { S.jobs = [{id: 'j1', name: 'blurry.jpg', status: 'failed', target: cid, cid, msg: 'Too dark to read'},
      {id: 'j2', name: 'fine.pdf', status: 'done', target: cid, cid, method: 'free-pdf', entryId: null}];
      window.jobAction = (k, id) => __calls.push(['job', k, id]); goStep('collect', 'bills'); }""", cid); pg.wait_for_timeout(600)
    ok("blurry.jpg" in app() and "Could not read" in app() and "Too dark to read" in app() and "2 files processed" in app(), "the queue: each file, how it went, and why")
    pg.click('#app li:has-text("blurry.jpg") button:has-text("Read again")'); pg.click('#app li:has-text("blurry.jpg") button:has-text("Type it in")'); pg.wait_for_timeout(200)
    ok(pg.evaluate("__calls") == [["job", "retry", "j1"], ["job", "type", "j1"]], "Read again / Type it in act on that file")
    pg.click('#app button:has-text("Clear list")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.jobs.length") == 0 and "blurry.jpg" not in app(), "Clear list")
    # the "reading…" card above the work
    pg.evaluate("(cid) => { S.jobs = [{id: 'j3', name: 'big.pdf', status: 'reading', target: cid, cid, msg: 'page 2 of 4', startedAt: Date.now()}]; render(); }", cid); pg.wait_for_timeout(400)
    ok(pg.locator("#app .busycard").count() >= 1 and "Reading a bill" in app() and "page 2 of 4" in app(), "a bill being read: the card says which and how far")
    pg.evaluate("S.jobs = []; render()")
    # the client's document inbox (firm account stood in)
    pg.evaluate("""(cid) => { Cloud.on = () => true; S.account = {email: 'a@b.c'};
      S.docq = {d1: {id: 'd1', client_id: cid, status: 'waiting', fileName: 'from-agent.pdf', docKind: 'bill', sender: 'agent@office', receivedAt: new Date(Date.now() - 5 * 60000).toISOString()},
                d2: {id: 'd2', client_id: cid, status: 'waiting', fileName: 'second.pdf', receivedAt: new Date().toISOString()}};
      window.readDocq = (ids, c) => __calls.push(['read', ids, c]); window.setAsideDocq = (id) => __calls.push(['aside', id]); __calls = []; goStep('collect', 'bills'); }""", cid); pg.wait_for_timeout(600)
    t = app()
    ok("Inbox · 2 waiting" in t and "from-agent.pdf" in t and "bill?" in t and "agent@office" in t and "5 min ago" in t, "the client's inbox: file, guessed kind, sender, when")
    pg.click('#app tr:has-text("from-agent.pdf") button:has-text("Read")'); pg.click('#app button:has-text("Read all 2")')
    pg.click('#app tr:has-text("second.pdf") button:has-text("Not for entry")'); pg.wait_for_timeout(200)
    ok(pg.evaluate("__calls") == [["read", ["d1"], cid], ["read", ["d1", "d2"], cid], ["aside", "d2"]], "Read, Read all and Not for entry, for this client")
    # the firm-wide Inbox: the same panel for each client, and uploads that matched no client
    pg.evaluate("""() => { S.inbox = {u1: {id: 'u1', fileName: 'stray.pdf', createdAt: '2026-09-30T08:00:00Z', note: 'Buyer GSTIN matches no client', j: {vendorName: 'ZZ Stray Co', buyerGstin: '07AAAAA0000A1Z5', totalAmount: 5000}}};
      window.assignInbox = (id, c) => __calls.push(['assign', id, c]); __calls = []; S.view = 'home'; S.homeTab = 'inbox'; render(); }"""); pg.wait_for_timeout(600)
    t = app()
    ok("ZZ Epsilon Mills" in t and "Inbox · 2 waiting" in t and "stray.pdf" in t and "Buyer GSTIN matches no client" in t, "Inbox for all clients: each client's inbox, and the unsorted upload")
    pg.select_option('#app tr:has-text("stray.pdf") select', cid); pg.wait_for_timeout(200)
    ok(pg.evaluate("__calls") == [["assign", "u1", cid]], "an unsorted upload is moved to the chosen client")
    pg.click('#app tr:has-text("stray.pdf") button:has-text("Delete")'); pg.wait_for_timeout(400)
    ok(not pg.evaluate("S.inbox.u1") and "stray.pdf" not in app(), "or deleted")
    pg.screenshot(path=OUT + "/react-inbox.png")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
