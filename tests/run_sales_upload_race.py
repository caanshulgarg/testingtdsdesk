"""python3 run_sales_upload_race.py - a PDF of 12 sales invoices (made up: tests/fixtures/sales-zoho) uploaded on the Sales page
while the sync brings invoices made on another computer (review of 85592e3f6). The sync (cloudApply, not waited for)
starts at the very moment the upload saves an invoice: 20 invoices at its 3rd save, 400 at its 7th. Every one of the 420
and every one of the 12 is on the screen and kept in this browser, none twice.
Then the PDF of another client, with the firm's documents on: the file goes up once, and every invoice read from it, the
ones read after that upload finished too, carries its link (docPath).
And (re-review of e9c90fa34): a save waiting its turn behind the sync is still written when the page is closed; a save
made as the same client's list is being loaded again is kept; the link reaches the invoices of a client not on screen;
a list whose loading failed does not stop the sync while an upload waits on it.
The review of 34de5bd26: an edit made while a sync is applied keeps the synced invoice too (Sales open or left); an
edit on one client is kept when another client saves at once, or when a sync of the first comes before its save; an
invoice filed while the client's list is loading is kept.
Offline, made-up clients. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sales_upload_race.py"""
import os, sys, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("TDSDESK_PORT", "8171"))
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(pg, js, secs):
    t = time.time()
    while time.time() - t < secs:
        if pg.evaluate(js): return True
        pg.wait_for_timeout(250)
    return False
FIX = os.path.join(HERE, "fixtures", "sales-zoho")
MANY = os.path.join(FIX, "zoho-sales-12.pdf"); N = len(json.load(open(os.path.join(FIX, "zoho-sales-12.json"))))
LEDGERS = ["Cash", "Sales @ 18% Local", "Output CGST", "Output SGST", "Output IGST", "Round Off", "HDFC Bank"]
BOOT = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
CLIENT = """([name, leds]) => { const c = newCompany({name, gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.bank.ledgers = {list: leds.map(n => ({name: n, group: /Sales/.test(n) ? "Sales Accounts" : /Output|Round/.test(n) ? "Duties & Taxes" : /Bank/.test(n) ? "Bank Accounts" : "Cash-in-Hand"})), importedAt: new Date().toISOString(), live: true}; S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate(CLIENT, ["ZZ Race Car Care Pvt Ltd", LEDGERS]); pg.wait_for_timeout(500)
    # the sync from another computer, started (not waited for) as the upload's own save of its 3rd and its 7th invoice begins
    pg.evaluate("""() => { const cid = SL().cid, set = BankDB.set.bind(BankDB); let n = 0, k = 0; window.__syncs = [];
      const rows = m => Array.from({length: m}, () => { k++; const v = newInvoice({number: "OTHER/" + k, date: "2026-10-01", customerName: "Other Desk Buyer " + k, taxable: 100, cgst: 9, sgst: 9, total: 118}, "created");
        return {kind: "sales", id: cid + ":" + v.id, client_id: cid, data: JSON.parse(JSON.stringify(v))}; });
      BankDB.set = (key, val) => { if (key === "sales:" + cid && Array.isArray(val)){ const up = val.filter(v => v.source === "upload").length;
          if (up > n){ n = up; if (n === 3 || n === 7) window.__syncs.push(cloudApply(rows(n === 3 ? 20 : 400))); } }
        return set(key, val); }; }""")
    pg.set_input_files("#salesIn", MANY)
    until(pg, "() => window.__syncs.length === 2", 240)
    until(pg, "() => SL() && !SL().loading && !SL().busy", 240)
    pg.evaluate("() => Promise.all(window.__syncs).then(() => cloudApply.q)"); pg.wait_for_timeout(1500)
    def count(src):
        return pg.evaluate("""(src) => (src === "db" ? BankDB.get("sales:" + SL().cid) : Promise.resolve(SL().list)).then(l => { l = l || [];
          const up = l.filter(v => v.source === "upload"), other = l.filter(v => /^OTHER\\//.test(v.x.number));
          return {up: up.length, upNos: new Set(up.map(v => v.x.number)).size, other: other.length, otherNos: new Set(other.map(v => v.x.number)).size, ids: new Set(l.map(v => v.id)).size, all: l.length}; })""", src)
    for src, where in (("screen", "on the screen"), ("db", "kept in this browser")):
        c = count(src)
        ok(c["up"] == N and c["upNos"] == N, "%s: all %d invoices of the PDF, none twice (%d, %d numbers)" % (where, N, c["up"], c["upNos"]))
        ok(c["other"] == 420 and c["otherNos"] == 420, "%s: all 420 invoices the sync brought (%d)" % (where, c["other"]))
        ok(c["ids"] == c["all"] == N + 420, "%s: %d invoices, no invoice twice (%d)" % (where, N + 420, c["all"]))
    # the firm's documents on: the PDF goes up once, a moment after its first invoice is read (as CloudDocs.run does, here
    # without the network), and every invoice from it carries the link, those read after it went up too
    pg.reload(); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate(CLIENT, ["ZZ Docs Car Care Pvt Ltd", LEDGERS]); pg.wait_for_timeout(500)
    pg.evaluate("""() => { window.__ups = 0; CloudDocs.on = () => true;
      CloudDocs.run = async function(){ if (this.busy) return; this.busy = true;
        while (this.queue.length){ const job = this.queue.shift(); await new Promise(ok => setTimeout(ok, 50)); window.__ups++; this.note(job, "firm-test/" + job.cid + "/" + job.id + "-" + job.file.name, job.file.size); }
        this.busy = false; };
      const read = readSalesFile; window.readSalesFile = async (...a) => { await new Promise(ok => setTimeout(ok, 150)); return read(...a); }; }""")
    pg.set_input_files("#salesIn", MANY)
    until(pg, "() => SL() && SL().busy", 30)
    until(pg, "() => SL() && !SL().loading && !SL().busy", 240); pg.wait_for_timeout(1500)
    d = pg.evaluate("""() => BankDB.get("sales:" + SL().cid).then(db => { const on = SL().list.filter(v => v.source === "upload"), kept = (db || []).filter(v => v.source === "upload");
      return {ups: window.__ups, n: on.length, screen: on.filter(v => v.docPath).length, db: kept.filter(v => v.docPath).length, paths: new Set(on.map(v => v.docPath)).size}; })""")
    ok(d["ups"] == 1, "the PDF went up once (%d)" % d["ups"])
    ok(d["n"] == N and d["screen"] == N and d["paths"] == 1, "every invoice from it opens it from the firm account: %d of %d on the screen" % (d["screen"], d["n"]))
    ok(d["db"] == N, "and kept so in this browser: %d of %d" % (d["db"], N))
    def boot(name):
        pg.reload(); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(800)
        pg.evaluate(CLIENT, [name, LEDGERS]); pg.wait_for_timeout(500)
        pg.evaluate("""() => { const v = newInvoice({number: "MINE/1", date: "2026-10-01", customerName: "Before Edit", taxable: 100, cgst: 9, sgst: 9, total: 118}, "created"); SL().list.push(v); mapInvoice(v); saveSales(); window.__mine = v.id; }""")
        pg.wait_for_timeout(1200)
    mine = "(l => ((l || []).find(v => v.id === window.__mine) || {x: {}}).x.customerName)"
    # a save waiting behind the sync (the queue held), the page closed: written then
    boot("ZZ Close Car Care Pvt Ltd")
    r = pg.evaluate("""async () => { const cid = SL().cid; let open; const gate = new Promise(ok => { open = ok; }); cloudApply.q = (cloudApply.q || Promise.resolve()).then(() => gate);
      inv(window.__mine).x.customerName = "Typed Then Closed"; saveSales();
      await new Promise(ok => setTimeout(ok, 800)); window.dispatchEvent(new Event("pagehide")); await new Promise(ok => setTimeout(ok, 400));
      const db = await BankDB.get("sales:" + cid); open(); return %s(db); }""" % mine)
    ok(r == "Typed Then Closed", "a save waiting behind the sync, the page closed: kept in this browser (%s)" % r)
    # a save made just before the same client's list is loaded again (its reading slow): kept
    boot("ZZ Reload Car Care Pvt Ltd")
    r = pg.evaluate("""async () => { const cid = SL().cid, get = BankDB.get.bind(BankDB); let slow = true;
      BankDB.get = k => { if (slow && k === "sales:" + cid){ slow = false; return new Promise(ok => setTimeout(ok, 1200)).then(() => get(k)); } return get(k); };
      inv(window.__mine).x.customerName = "Typed Then Reloaded"; saveSales(); await loadSales(cid); BankDB.get = get;
      await new Promise(ok => setTimeout(ok, 900)); await cloudApply.q; return {screen: %s(SL().list), db: %s(await BankDB.get("sales:" + cid))}; }""" % (mine, mine))
    ok(r == {"screen": "Typed Then Reloaded", "db": "Typed Then Reloaded"}, "a save as the list is loaded again: on the screen and kept (%s)" % r)
    # the file goes up while its client is not on screen: the link still reaches every invoice from it, kept in this browser
    r = pg.evaluate("""async () => { const a = SL().cid, ids = []; let first = null;
      for (let i = 1; i <= 3; i++){ const v = newInvoice({number: "OFF/" + i, date: "2026-10-02", customerName: "Off Screen", taxable: 100, cgst: 9, sgst: 9, total: 118}, "upload"); if (first) v.docOf = first; else first = v.id; ids.push(v.id); SL().list.push(v); }
      saveSales(); await new Promise(ok => setTimeout(ok, 900)); await cloudApply.q;
      S.sales = null;   // (Sales left: no list on screen)
      CloudDocs.note({kind: "sale", cid: a, id: "sv:" + first}, "firm-test/" + a + "/off.pdf", 1234);
      await new Promise(ok => setTimeout(ok, 600)); await cloudApply.q;
      const db = await BankDB.get("sales:" + a); return db.filter(v => ids.includes(v.id) && v.docPath === "firm-test/" + a + "/off.pdf").length; }""")
    ok(r == 3, "the file up while its client is not on screen: its 3 invoices kept with the link (%d)" % r)
    # a list whose loading failed while an upload waits on it: the sync still goes on
    boot("ZZ Stuck Car Care Pvt Ltd")
    pg.evaluate("""() => { const read = readSalesFile; window.readSalesFile = async (...a) => { await new Promise(ok => setTimeout(ok, 300)); return read(...a); }; }""")
    pg.set_input_files("#salesIn", MANY)
    until(pg, "() => SL() && SL().list.some(v => v.source === 'upload')", 60)
    r = pg.evaluate("""async () => { const cid = SL().cid, get = BankDB.get.bind(BankDB); let once = true;
      BankDB.get = k => { if (once && k === "salescfg:" + cid){ once = false; return Promise.reject(new Error("made-up failure")); } return get(k); };
      try { await loadSales(cid); } catch (e){}
      const stuck = SL().loading;
      const t = await Promise.race([cloudApply([]).then(() => "applied"), new Promise(ok => setTimeout(() => ok("not in 25 s"), 25000))]);
      return {stuck, sync: t}; }""")
    ok(r["sync"] == "applied", "a list whose loading failed during an upload: the sync still goes on (%s)" % r)
    until(pg, "() => BankDB.get('sales:' + SL().cid).then(l => (l || []).filter(v => v.source === 'upload').length === %d)" % N, 120)
    ok(pg.evaluate("BankDB.get('sales:' + SL().cid).then(l => (l || []).filter(v => v.source === 'upload').length)") == N, "and every invoice of the PDF kept in this browser")
    # (the review of 34de5bd26) an edit typed while a sync is being applied (its write slow): the edit and the synced
    # invoice both stay, on the screen and in this browser; again with the Sales page left meanwhile (no list on screen)
    F = "const f = (l, id) => ((l || []).find(v => v.id === id) || {x: {}}).x.customerName;"
    for left in (False, True):
        boot("ZZ Edit Sync %s Pvt Ltd" % ("Left" if left else "Open"))
        r = pg.evaluate("""async (left) => { %s const cid = SL().cid, set = BankDB.set.bind(BankDB); let slow = true;
          BankDB.set = (k, v) => { if (slow && k === "sales:" + cid){ slow = false; return new Promise(ok => setTimeout(ok, 1500)).then(() => set(k, v)); } return set(k, v); };
          const o = newInvoice({number: "OTHER/1", date: "2026-10-01", customerName: "Other", taxable: 100, cgst: 9, sgst: 9, total: 118}, "created");
          const ap = cloudApply([{kind: "sales", id: cid + ":" + o.id, client_id: cid, data: JSON.parse(JSON.stringify(o))}]);
          await new Promise(ok => setTimeout(ok, 300));
          inv(window.__mine).x.customerName = "Typed During Sync"; saveSales(); if (left) S.sales = null;
          await ap; await new Promise(ok => setTimeout(ok, 900)); await cloudApply.q; BankDB.set = set;
          const db = await BankDB.get("sales:" + cid), l = left ? null : SL().list;
          return {screen: l ? f(l, window.__mine) : "-", otherScreen: l ? l.some(v => v.x.number === "OTHER/1") : "-", db: f(db, window.__mine), otherDb: db.some(v => v.x.number === "OTHER/1")}; }""" % F, left)
        want = {"screen": "-" if left else "Typed During Sync", "otherScreen": "-" if left else True, "db": "Typed During Sync", "otherDb": True}
        ok(r == want, "an edit during a sync%s: the edit and the synced invoice both kept (%s)" % (", the page left" if left else "", r))
    # an edit on client A, then client B opened and saved within 500 ms: A's edit is kept
    boot("ZZ Switch A Pvt Ltd")
    a = pg.evaluate("() => [SL().cid, window.__mine]")
    pg.evaluate("() => { inv(window.__mine).x.customerName = 'Typed On A'; saveSales(); }")
    pg.evaluate(CLIENT, ["ZZ Switch B Pvt Ltd", LEDGERS])
    r = pg.evaluate("""async ([cid, id]) => { %s saveSales(); await new Promise(ok => setTimeout(ok, 1200)); await cloudApply.q; return f(await BankDB.get("sales:" + cid), id); }""" % F, a)
    ok(r == "Typed On A", "an edit on A, B opened and saved at once: A's edit kept (%s)" % r)
    # an edit on A, B opened, then a sync of A's invoices before A's save: both kept
    boot("ZZ Switch Sync A Pvt Ltd")
    a = pg.evaluate("() => [SL().cid, window.__mine]")
    pg.evaluate("() => { inv(window.__mine).x.customerName = 'Typed On A'; saveSales(); }")
    r = pg.evaluate("""async ([cid, id]) => { %s
      const go = (async () => { const c = newCompany({name: "ZZ Switch Sync B", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; await loadSales(c.id); })();
      const o = newInvoice({number: "OTHER/5", date: "2026-10-01", customerName: "Other", taxable: 100, cgst: 9, sgst: 9, total: 118}, "created");
      await cloudApply([{kind: "sales", id: cid + ":" + o.id, client_id: cid, data: JSON.parse(JSON.stringify(o))}]); await go;
      await new Promise(ok => setTimeout(ok, 1200)); await cloudApply.q; const db = await BankDB.get("sales:" + cid);
      return {edit: f(db, id), synced: db.some(v => v.x.number === "OTHER/5")}; }""" % F, a)
    ok(r == {"edit": "Typed On A", "synced": True}, "an edit on A, B opened, a sync of A before A's save: both kept (%s)" % r)
    # an invoice filed (salesIngest: from the client list or Invoices) while that client's Sales list is loading: kept
    boot("ZZ Filed Car Care Pvt Ltd")
    r = pg.evaluate("""async () => { const cid = SL().cid, get = BankDB.get.bind(BankDB); let slow = true; window.charge = async () => true;
      BankDB.get = k => { if (slow && k === "sales:" + cid){ slow = false; return new Promise(ok => setTimeout(ok, 800)).then(() => get(k)); } return get(k); };
      const ld = loadSales(cid); await new Promise(ok => setTimeout(ok, 200)); const loading = SL().loading;
      const file = new File(["made up"], "filed.pdf", {type: "application/pdf"});
      const done = await salesIngest(cid, file, {method: "claude-test", j: {vendorGstin: CO(cid).gstin, invoiceNo: "FILED/1", invoiceDate: "2026-10-02", buyerName: "Filed Buyer", taxableValue: 100, cgst: 9, sgst: 9, igst: 0, totalAmount: 118}}, "hash-filed-1");
      await ld; BankDB.get = get; await new Promise(ok => setTimeout(ok, 900)); await cloudApply.q;
      return {loading, done, screen: SL().list.some(x => x.x.number === "FILED/1"), db: (await BankDB.get("sales:" + cid)).some(x => x.x.number === "FILED/1")}; }""")
    ok(r == {"loading": True, "done": True, "screen": True, "db": True}, "an invoice filed while the list is loading: on the screen and kept (%s)" % r)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
