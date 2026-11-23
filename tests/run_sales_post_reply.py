"""python3 run_sales_post_reply.py - sales posted on Tally's reply (next-fix-sales-readback, 23-Nov-2026: every invoice
of a sales sheet posted through FinCom Bridge 2.5.x said "Failed: not found in Tally when read back" although Tally
created all of them; the bridge never reads back since round 15: its answer is {ok, byReply, verified: false}).
Made-up data only.
  1. a batch posted with Tally's reply (byReply): Posted, no red note; Optional vouchers said so when the client posts as
     Optional (the bridge's reply carries no optional flag: the voucher FinCom sent did);
  2. an answer Tally took but nobody has confirmed (an old bridge's "checking"): not counted as posted, as before;
  3. "Post one by one": Tally's reply counts as posted too;
  4. an invoice found in Tally afterwards (the duplicate check): its old red note goes; an Optional voucher is said so;
  5. the same number twice in a sheet: neither is posted;
  6. (next-sales-followups) a queued posting's result that comes later: the same rule as a direct post (Tally's reply or
     a read back counts, an answer nobody confirmed does not), and an Optional voucher said so;
  7. the panel's "untick ... in Client setup" advice only on an invoice FinCom posted with the client's Optional tick on,
     never on one found in Tally (entered by hand as Optional).
An answer not confirmed says "Not confirmed by Tally yet" (never "In Tally": an old bridge's not-found answer is one).
Run on the React build: TDSDESK_SITE=../app/dist-test SYNC_PORT=8957 python3 run_sales_post_reply.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = int(os.environ.get("SYNC_PORT") or 8957)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
GST = """() => { const mk = (b) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; };
  return {up: mk('09AAACZ1234Q1Z'), k: mk('27AAACK5678P1Z')}; }"""
LED = [["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"], ["Output IGST", "Duties & Taxes"]]
SETL = """([leds, g]) => { const cid = SL() ? SL().cid : CO().id, list = leds.map(([name, group, gk]) => ({name, group, gstin: gk ? g[gk] : ""}));
  Ledgers.st[cid] = {list, parents: {}, at: new Date().toISOString(), srcAt: new Date().toISOString(), src: "cloud", file: "", book: "", cloudAt: ""};
  if (S.bank && S.bank.cid === cid) S.bank.ledgers = {list, importedAt: new Date().toISOString(), live: true}; Ledgers.ver++; }"""
ADD = """([n, d, cg]) => { const s = SL(); const v = newInvoice({number: n, date: d, customerName: "Kappa Retail", customerGstin: cg, pos: "27", taxable: 1000,
  cgst: 0, sgst: 0, igst: 180, cess: 0, total: 1180, items: []}, "upload"); s.list.push(v); mapInvoice(v); return v.id; }"""
NEWCO = """(g) => { const c = newCompany({name: "ZZ Test Reply Traders", gstin: g.up}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
# the posting path's outside calls stubbed: the Tally company found, the ledger list as set, nothing in Tally yet, and
# the bridge's answer given by the test (window.__answer(vouchers) -> results)
STUB = """() => { window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  window.ensureTallyCompany = async () => true; window.syncLedgersFromTally = async () => true; window.salesVouchersIn = async () => (window.__inTally || []);
  window.tallyVia = () => "bridge"; window.__sent = [];
  Bridge.post = async (p) => { window.__sent.push(p.vouchers.map(v => v.id)); return {ok: true, company: "ZZ Test Reply Traders", results: window.__answer(p.vouchers)}; }; }"""
STATE = "() => SL().list.map(v => ({n: v.x.number, st: v.status, err: v.postError || '', opt: !!v.postedOptional}))"
UNCONF = "Not confirmed by Tally yet, so it is not marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again."
NOTE = "() => { const n = document.querySelector('[data-sales-opt-note]'); return n ? n.innerText : null; }"

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); A = ctx.new_page(); A.on("pageerror", lambda e: errors.append(str(e)))
    A.goto("http://localhost:%d/" % PORT); A.wait_for_timeout(2500); A.evaluate(READY); A.wait_for_timeout(800)
    G = A.evaluate(GST)
    cid = A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G]); A.evaluate(STUB)

    print("1. a batch posted with Tally's reply (FinCom Bridge 2.5.x: no read-back)")
    A.evaluate("() => { CO().createOptional = true; }")
    for i, d in enumerate(["2026-11-01", "2026-11-05", "2026-11-08", "2026-11-10", "2026-11-14"]): A.evaluate(ADD, ["ZT/%d" % (i + 1), d, G["k"]])
    ok(A.evaluate("() => SL().list.map(v => v.status)") == ["ready"] * 5, "five invoices Ready")
    A.evaluate("() => { window.__answer = vs => vs.map((v, i) => ({id: v.id, ok: true, byReply: true, verified: false, batchN: vs.length, batchEnd: String(45100 + vs.length), message: ''})); }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(500)
    st = A.evaluate(STATE)
    ok([x["st"] for x in st] == ["posted"] * 5, "Tally's reply took all five: all Posted (%s)" % [x["st"] for x in st])
    ok(all(x["err"] == "" for x in st), "no red note on any (%s)" % [x["err"][:40] for x in st])
    ok(all(x["opt"] for x in st), "posted as Optional vouchers, as the client's setting sent them (%s)" % [x["opt"] for x in st])
    t = A.evaluate("() => window.__toasts.slice(-1)[0] || ''")
    ok(t.startswith("5 posted to Tally") and "Optional" in t and "not posted" not in t, "the message: 5 posted, as Optional vouchers, and where to find them (%s)" % t)

    print("2. an answer Tally took, not confirmed (an older bridge still checking): not counted as posted")
    A.evaluate("() => { SL().list = []; CO().createOptional = false; }")
    A.evaluate(ADD, ["ZT/21", "2026-11-03", G["k"]])
    A.evaluate("() => { window.__answer = vs => vs.map(v => ({id: v.id, ok: true, pendingCheck: true})); window.__toasts = []; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(500)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "ready" and st[0]["err"].startswith(UNCONF) and "In Tally, not yet" not in st[0]["err"], "not posted, said not confirmed by Tally yet (%s)" % st)
    # an old bridge's real not-found answer (ok, verified false, a note): never said to be "In Tally"
    A.evaluate("() => { window.__answer = vs => vs.map(v => ({id: v.id, ok: true, verified: false, verifyNote: 'not found when read back'})); window.__toasts = []; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(500)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "ready" and st[0]["err"] == UNCONF + " [not found when read back]", "an old bridge's not-found answer: not confirmed, its note kept (%s)" % st)
    A.evaluate("() => { window.__answer = vs => vs.map(v => ({id: v.id, ok: true, byReply: true, verified: false})); window.__toasts = []; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(500)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "posted" and st[0]["err"] == "" and not st[0]["opt"], "posted again with Tally's reply: Posted, a regular voucher (%s)" % st)

    print("3. Post one by one: Tally's reply counts as posted")
    A.evaluate("() => { SL().list = []; }")
    vid = A.evaluate(ADD, ["ZT/31", "2026-11-04", G["k"]])
    A.evaluate("(id) => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 5, said: 'Tally created nothing'}; }", vid)
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(500)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "posted" and st[0]["err"] == "", "one by one, Tally's reply: Posted (%s)" % st)

    print("4. found in Tally afterwards: the old red note goes; an Optional voucher said so")
    A.evaluate("() => { SL().list = []; }")
    vid = A.evaluate(ADD, ["ZT/41", "2026-11-10", G["k"]])
    A.evaluate("(id) => { const v = SL().list.find(v => v.id === id); v.postError = 'Failed: not found in Tally when read back, so it is not marked as posted.'; }", vid)
    A.evaluate("() => { window.__inTally = [{guid: 'g-41', masterId: '41', date: '20261110', type: 'Sales', number: 'ZT/41', party: 'Kappa Retail', amount: '1180', optional: 'Yes', cancelled: 'No'}]; }")
    A.evaluate("() => salesCheckTally(SL().list)"); A.wait_for_timeout(200)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "intally" and st[0]["err"] == "", "In Tally, the red note gone (%s)" % st)
    ok(st[0]["opt"], "said to be an Optional voucher in Tally (%s)" % st)
    # an invoice found in Tally before this fix kept the red note: not shown on an In Tally invoice
    A.evaluate("(id) => { const v = SL().list.find(v => v.id === id); v.postError = 'Failed: not found in Tally when read back.'; SL().filter = 'done'; SL().openId = id; render(); }", vid); A.wait_for_timeout(500)
    ok("not found in Tally" not in A.inner_text("#app"), "an old red note on an In Tally invoice is not shown, on the row or the panel")
    n = A.evaluate(NOTE)
    ok(n and "Optional voucher" in n and "untick" not in n and "Client setup" not in n, "7. found in Tally as Optional (entered by hand): said so, no untick advice (%s)" % n)
    A.evaluate("() => { SL().openId = null; render(); }")

    print("5. the same number twice: neither copy is posted")
    A.evaluate("() => { SL().list = []; window.__inTally = []; window.__sent = []; window.__toasts = []; }")
    A.evaluate(ADD, ["ZT/51", "2026-11-01", G["k"]]); A.evaluate(ADD, ["ZT/51", "2026-11-01", G["k"]]); A.evaluate(ADD, ["ZT/52", "2026-11-01", G["k"]])
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(500)
    st = A.evaluate(STATE); sent = A.evaluate("() => window.__sent")
    ok([x["st"] for x in st] == ["review", "review", "posted"] and len(sent) == 1 and len(sent[0]) == 1, "both copies held To review, the other posted alone (%s, sent %s)" % ([x["st"] for x in st], sent))

    print("6. a queued posting's result, marked when it comes: the same rule as a direct post")
    A.evaluate("() => { SL().list = []; CO().createOptional = true; window.__rows = {}; CloudPost.row = async (id) => JSON.parse(JSON.stringify(window.__rows[id] || null)); }")
    q1 = A.evaluate(ADD, ["ZT/61", "2026-11-02", G["k"]]); q2 = A.evaluate(ADD, ["ZT/62", "2026-11-02", G["k"]]); q3 = A.evaluate(ADD, ["ZT/63", "2026-11-02", G["k"]])
    A.evaluate("""([a, b, c]) => { SL().list.forEach((v, i) => { v.postJob = 'jq' + i; v.postError = 'Waiting for Tally: it stays queued and posts by itself.'; });
      window.__rows = {jq0: {id: 'jq0', status: 'done', company: 'ZZ Test Reply Traders', results: [{id: a, ok: true, pendingCheck: true}]},
        jq1: {id: 'jq1', status: 'done', company: 'ZZ Test Reply Traders', results: [{id: b, ok: true, verified: false, verifyNote: 'not found when read back'}]},
        jq2: {id: 'jq2', status: 'done', company: 'ZZ Test Reply Traders', results: [{id: c, ok: true, byReply: true, verified: false}]}}; }""", [q1, q2, q3])
    A.evaluate("() => salesQueuedSync()"); A.wait_for_timeout(300)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "ready" and st[0]["err"].startswith(UNCONF), "a queued result nobody confirmed (still checking): not Posted, not confirmed (%s)" % st[0])
    ok(st[1]["st"] == "ready" and st[1]["err"] == UNCONF + " [not found when read back]", "a queued result an old bridge did not find: not Posted (%s)" % st[1])
    ok(st[2]["st"] == "posted" and st[2]["err"] == "" and st[2]["opt"], "a queued result with Tally's reply: Posted, as an Optional voucher (client set so) (%s)" % st[2])
    ok(A.evaluate("() => SL().list.map(v => !!v.postJob)") == [False, False, False], "each queued result taken off its posting (not asked again)")

    print("7. the untick advice: only on an invoice FinCom posted with the Optional tick on")
    A.evaluate("(id) => { SL().filter = 'done'; SL().openId = id; render(); }", q3); A.wait_for_timeout(400)
    n = A.evaluate(NOTE)
    ok(n and "Optional voucher" in n and "untick" in n and "Client setup" in n, "posted by FinCom with the tick on: the untick advice shown (%s)" % n)
    A.evaluate("() => { SL().openId = null; SL().list = []; CO().createOptional = false; window.__answer = vs => vs.map(v => ({id: v.id, ok: true, byReply: true, verified: false, optional: true})); }")
    q4 = A.evaluate(ADD, ["ZT/71", "2026-11-03", G["k"]])
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(500)
    A.evaluate("(id) => { SL().filter = 'done'; SL().openId = id; render(); }", q4); A.wait_for_timeout(400)
    st = A.evaluate(STATE); n = A.evaluate(NOTE)
    ok(st[0]["st"] == "posted" and st[0]["opt"] and n and "Optional voucher" in n and "untick" not in n, "posted with the tick off, Tally said Optional: said so, no untick advice (%s, %s)" % (st, n))
    A.evaluate("() => { SL().openId = null; render(); }")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
