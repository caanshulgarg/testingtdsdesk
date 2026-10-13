"""python3 run_read_failures.py - a bill the reading service could not read (review of 02-Oct-2026: staging only said
"The Claude API refused the request", and the bill was gone). Offline, a made-up client; the firm account is faked and
the gateway answered by a stub of fetch (so Cloud.fn's own handling is tested too).
Each kind says the file name and the reason in plain words; a rate limit is retried once by itself; a second failure
leaves the bill in To review, "Not read yet", with Retry; Retry fills it; a browser that cannot reach the gateway says so.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_read_failures.py"""
import os, threading, functools, http.server, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8231), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

BILL = {"vendorName": "ZZ Paper Mart", "vendorGstin": "", "invoiceNo": "PM/42", "invoiceDate": "2026-09-20", "taxableValue": 1000, "cgst": 90, "sgst": 90, "igst": 0, "totalAmount": 1180, "description": "Paper", "natureId": "none", "confidence": 0.9}
SETUP = """(bill) => {
  // the firm account, faked: signed in, credit, the gateway answered from window.__gw (one answer per call, the last kept)
  S.account = {firm: {balance: 100, cloudDocs: false}}; S.firm = Object.assign(S.firm || {}, {cloudDocs: false});
  Cloud.on = () => true; Cloud.fresh = async () => {}; Cloud.sess = () => ({access_token: 't'}); Cloud.cfg = () => ({url: 'https://stub.supabase.co', key: 'k'});
  Cloud.rpc = async () => ({ok: true, balance: 100}); CloudDocs.add = () => {};
  S.freeFirst = false; S.engine = 'api'; S.imgMax = 6; S.sampleReady = true;
  window.__bill = bill; window.__gw = []; window.__calls = [];
  const real = window.fetch;
  window.fetch = async (url, init) => {
    if (!/functions\\/v1\\/gateway/.test(String(url))) return real(url, init);
    const body = JSON.parse(init.body); window.__calls.push({file: body.file, model: body.payload && body.payload.model, at: Date.now()});
    const a = window.__gw.length > 1 ? window.__gw.shift() : window.__gw[0];
    if (a.throw) throw new TypeError(a.throw);
    if (a.ok) return new Response(JSON.stringify({ok: true, charged: 1, balance: 99, data: {content: [{type: 'text', text: JSON.stringify(window.__bill)}], stop_reason: 'end_turn'}}), {status: 200});
    const b = Object.assign({ok: false, file: body.file}, a.body);
    if (b.kind === 'bad_model') b.model = body.payload.model;
    return new Response(JSON.stringify(b), {status: a.status || 400});
  };
}"""
UPLOAD = """async ([name, answers]) => {
  window.__gw = answers; window.__calls = [];
  const c = document.createElement('canvas'); c.width = 900; c.height = 500; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 500); g.fillStyle = '#000'; g.font = '40px sans-serif'; g.fillText('Bill ' + name, 40, 120);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const f = new File([blob], name, {type: 'image/png'});
  await enqueueFiles([f], S.coId);
  const j = S.jobs[S.jobs.length - 1];
  await j.donePromise; await new Promise(r => setTimeout(r, 200));
  const e = j.entryId ? D().entries[j.entryId] : null;
  return {status: j.status, msg: j.msg || '', calls: window.__calls.length, entry: e ? {id: e.id, status: e.status, notRead: e.notRead || null, vendor: e.x.vendorName, file: !!S.files[e.id]} : null};
}"""
FAIL = lambda kind, status, extra=None: {"status": status, "body": dict({"kind": kind, "error": "gateway words for " + kind, "status": status}, **(extra or {}))}
KINDS = [  # kind, HTTP status, extra, words that must be in the message
    ("no_credit", 402, None, "out of credit on the reading service. Ask the administrator to add credit."),
    ("too_large", 413, None, "too large"),
    ("pdf_password", 400, None, "password-protected. Remove the password"),
    ("unsupported_type", 400, None, "Use PDF, JPG or PNG"),
    ("declined", 422, {"category": "cyber"}, "the model declined to read this file (cyber)"),
    ("bad_key", 502, None, "key is not working. Ask the administrator"),
    ("bad_model", 404, None, "is not accepted"),
    ("not_reached", 502, None, "could not reach the reading service"),
    ("other", 500, None, "refused the request"),
]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8231/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""() => { const c = newCompany({name: "ZZ Read Fail Co", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; }""")
    pg.evaluate("(cid) => openCompany(cid).then(() => goStep('review', 'bills'))", cid); pg.wait_for_timeout(1000)
    pg.evaluate(SETUP, BILL)
    up = lambda name, answers: pg.evaluate(UPLOAD, [name, answers])

    # each kind: the file's name, the reason in plain words; kept in To review as "Not read yet"
    for kind, st, extra, words in KINDS:
        name = "INV-%s.png" % kind
        r = up(name, [FAIL(kind, st, extra)])
        m = r["msg"]
        if kind == "bad_model": words = "“" + pg.evaluate("window.__calls.length ? '' : ''") + ""; words = "is not accepted"
        ok(m.startswith(name + ": not read, ") and words in m and r["calls"] == 1, "%s: '%s'" % (kind, m))
        ok(r["status"] == "notread" and r["entry"] and r["entry"]["status"] == "draft" and r["entry"]["notRead"] and r["entry"]["notRead"]["kind"] == kind and r["entry"]["file"],
           "%s: the bill stays in To review, Not read yet, with its file (%s)" % (kind, r["entry"] and r["entry"]["notRead"]))
    model = pg.evaluate("window.__calls[0] && window.__calls[0].model")
    bm = pg.evaluate("Object.values(D().entries).find(e => e.notRead && e.notRead.kind === 'bad_model').notRead.reason")
    ok(model and ("“" + model + "”") in bm, "bad_model names the model that was refused (%s)" % bm)
    ok(pg.evaluate("window.__calls.every(c => /^INV-other\\.png$/.test(c.file))"), "the file's name is sent with the gateway call (%s)" % pg.evaluate("window.__calls.map(c => c.file)"))

    # a rate limit: retried once by itself (after its Retry-After), then read
    r = up("INV-rate.png", [FAIL("rate_limit", 429, {"retry_after": 1}), {"ok": True}])
    ts = pg.evaluate("window.__calls.map(c => c.at)")
    ok(r["calls"] == 2 and r["status"] == "done" and r["entry"] and r["entry"]["vendor"] == "ZZ Paper Mart" and not r["entry"]["notRead"] and ts[1] - ts[0] >= 900,
       "rate_limit: tried again by itself after %d ms, then read (%s)" % (ts[1] - ts[0] if len(ts) > 1 else -1, r["status"]))

    # busy twice: tried again once, then kept as Not read yet with Retry
    r = up("INV-busy.png", [FAIL("overloaded", 529, {"retry_after": 1})])
    ok(r["calls"] == 2 and r["status"] == "notread" and r["msg"].startswith("INV-busy.png: not read, the reading service is busy (overloaded).") and "Tried again by itself" in r["msg"],
       "overloaded twice: one retry, then Not read yet ('%s')" % r["msg"])
    busy = r["entry"]["id"]
    r2 = up("INV-slow.png", [FAIL("timed_out", 504)])
    ok(r2["calls"] == 2 and r2["status"] == "notread" and "took too long to answer (timed out)" in r2["msg"], "timed_out twice: one retry (after 5 s), then Not read yet ('%s')" % r2["msg"])
    ok(pg.evaluate("(id) => { const e = D().entries[id]; approve(e); return e.status; }", busy) == "draft", "a Not-read-yet bill cannot be approved")
    pg.evaluate("() => { S.tab = 'invoices'; S.filter = 'draft'; S.reviewTable = true; S.drawerOpen = false; S.selected = null; render(); }"); pg.wait_for_timeout(800)
    row = pg.locator("#app tr:has-text('INV-busy.png')")
    ok(row.count() == 1 and "Not read yet: the reading service is busy (overloaded)." in row.inner_text() and row.locator("button:has-text('Retry')").count() == 1 and row.locator("button:has-text('Approve')").count() == 0,
       "the To review row says Not read yet, with Retry and no Approve ('%s')" % (row.inner_text().replace("\n", " ")[:160] if row.count() else ""))
    pg.evaluate("(id) => { S.reviewTable = false; S.selected = id; render(); }", busy); pg.wait_for_timeout(800)
    sec = pg.locator("#app .detail [data-notread]")
    ok(sec.count() == 1 and "Not read yet: the reading service is busy (overloaded)." in sec.inner_text() and sec.locator("button:has-text('Retry')").count() == 1, "the bill says Not read yet and why, with Retry")
    ok(pg.locator('#app label:has-text("Supplier name") input').count() == 1, "the bill can be typed in (its fields are open)")

    # Retry, the reading service working again: the bill is filled in place
    pg.evaluate("() => { window.__gw = [{ok: true}]; window.__calls = []; }")
    sec.locator("button:has-text('Retry')").click()
    pg.wait_for_function("(id) => !S.reading[id] && !D().entries[id].notRead", arg=busy, timeout=15000); pg.wait_for_timeout(500)
    e = pg.evaluate("(id) => { const e = D().entries[id]; return {v: e.x.vendorName, t: e.x.total, n: e.x.invoiceNo, nr: e.notRead || null, st: e.status}; }", busy)
    ok(e["v"] == "ZZ Paper Mart" and str(e["n"]) == "PM/42" and not e["nr"] and e["st"] == "draft" and pg.locator("#app .detail [data-notread]").count() == 0, "Retry fills the bill (%s)" % e)

    # a browser that cannot reach the gateway (CORS or offline): said plainly
    r = up("INV-blocked.png", [{"throw": "Load failed"}])
    ok(r["msg"] == "INV-blocked.png: not read, your browser could not reach FinCom's reading service (blocked or offline). Check the connection, then press Retry." and r["entry"]["notRead"]["kind"] == "blocked",
       "blocked: '%s'" % r["msg"])
    # typed in by hand: then it can be approved like any bill
    tid = r["entry"]["id"]
    ok(pg.evaluate("(id) => { const e = D().entries[id]; Object.assign(e.x, {vendorName: 'ZZ Typed', invoiceDate: '2026-09-21', total: 500, taxable: 500}); return notReadYet(e); }", tid) is False,
       "typed in (supplier, date, total): no longer held as Not read yet")
    ok(not errors, "no page errors (%s)" % errors[:2])
    br.close()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
srv.shutdown()
raise SystemExit(1 if fails else 0)
