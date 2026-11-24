"""python3 run_sales_upload_race.py - a PDF of 12 sales invoices (made up: tests/fixtures/sales-zoho) uploaded on the Sales page
while the sync brings invoices made on another computer (review of 85592e3f6). The sync (cloudApply, not waited for)
starts at the very moment the upload saves an invoice: 20 invoices at its 3rd save, 400 at its 7th. Every one of the 420
and every one of the 12 is on the screen and kept in this browser, none twice.
Then the PDF of another client, with the firm's documents on: the file goes up once, and every invoice read from it, the
ones read after that upload finished too, carries its link (docPath).
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
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
