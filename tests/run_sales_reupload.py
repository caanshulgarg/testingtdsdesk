"""python3 run_sales_reupload.py - a posted entry that is not in Tally any more (next-fix-reupload-posted, 24-Nov-2026).
A sales invoice FinCom posted as an Optional voucher was deleted in Tally and posted again: FinCom's cloud held its
FinCom id for the earlier posting (migration 184: not queued again), the page took that posting's old answer for a new
one and showed "Posted" with today's date, and nothing was sent. The owner's rules: an entry that is not really in the
books never counts as posted; FinCom decides from its own copy of Tally, never by reading Tally; it does what it needs
on the Post press itself. Made-up data only.
  1. the Post press, the cloud holding the invoice for an earlier, finished posting: FinCom's cloud decides by its copy
     (tally_post_copy_resend, migration 219): only an Optional voucher there: released and that posting handed back, the
     invoice queued on it (marked Posted when it answers); a regular voucher: Posted before (that posting's date), In
     Tally, nothing sent; nothing in the copy, the copy not up to date since the send ("unsure"), or the cloud not
     ready: Posted before, not sent again, said why
  2. "Not in Tally? Post again" on a posted invoice (row and panel): the posting that holds it found, the same decision
  3. the same on a purchase bill and a bank line FinCom posted
  4. nothing is ever asked of Tally or FinCom Bridge for it
Screenshots (deviceScaleFactor 2) go to SHOTS when it is set.
Run on the React build: TDSDESK_SITE=../app/dist-test SYNC_PORT=8961 python3 run_sales_reupload.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = int(os.environ.get("SYNC_PORT") or 8961)
SHOTS = os.environ.get("SHOTS", "")
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
NEWCO = """(g) => { const c = newCompany({name: "ZZ Test Reupload Traders", gstin: g.up}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
# the outside calls stubbed: the Tally company found, the ledgers as set, nothing in Tally's day; FinCom's cloud and the
# bridge on this computer answer as each step sets (window.__enq, __rows, __copy, __ids), every call recorded
STUB = """() => { window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  window.ensureTallyCompany = async () => "ZZ Test Reupload Traders"; window.syncLedgersFromTally = async () => true; window.salesVouchersIn = async () => [];
  window.tallyVia = () => "bridge"; window.tallyCoName = () => "ZZ Test Reupload Traders"; window.linkGuid = async () => ({guid: "co-guid-1"});
  window.__rpc = []; window.__calls = []; window.__sent = [];
  TCloud.on = () => true; TCloud.has = () => true; TCloud.postTargetFor = () => "";
  TCloud.rpc = async (fn, args) => { window.__rpc.push([fn, args]); if (fn === "tally_post_enqueue") return window.__enq(args); if (fn === "tally_post_copy_resend") { const c = window.__copy(args); if (c && c.throw) throw new Error(c.throw); return c; } return {ok: true}; };
  Cloud.api = async (path) => { window.__calls.push(path); return /^tally_post_ids/.test(path) ? (window.__ids || []) : []; };
  CloudPost.row = async (id) => JSON.parse(JSON.stringify((window.__rows || {})[id] || null));
  Bridge.on = () => true; Bridge.up = () => true; window.__bridgeCalls = [];
  Bridge.call = async (path) => { window.__bridgeCalls.push(path); throw {message: "not stubbed " + path}; };
  window.__copy = () => ({ok: false, state: "none", error: "FinCom's copy of Tally has no entry carrying this FinCom id, so it cannot tell whether it is in Tally. Nothing was sent."});
  Bridge.post = async (p) => { window.__sent.push(p.vouchers.map(v => v.id)); return window.__post ? window.__post(p) : CloudPost.run(SL() ? SL().cid : CO().id, p); }; }"""
STATE = "(id) => { const v = SL().list.find(v => v.id === id); return {st: v.status, at: v.postedAt || '', note: v.postNote || '', err: v.postError || '', opt: !!v.postedOptional, ovr: !!v.dupOverride}; }"
LAST = "() => window.__toasts.slice(-1)[0] || ''"
OLD = {"id": "", "ok": True, "kind": "voucher", "byReply": True, "verified": False, "batchN": 10, "batchEnd": "45174", "company": "", "sentAt": "2026-11-18T11:23:12+05:30"}

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2); A = ctx.new_page(); A.on("pageerror", lambda e: errors.append(str(e)))
    A.goto("http://localhost:%d/" % PORT); A.wait_for_timeout(2500); A.evaluate(READY); A.wait_for_timeout(800)
    G = A.evaluate(GST)
    cid = A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G]); A.evaluate(STUB)
    HOLD = """([vid, old, job, hst]) => { window.__enq = (a) => ({ok: false, none: true, company: "ZZ Test Reupload Traders", dupes: [{id: vid, job, status: hst || "done"}],
        error: "These entries are held by an earlier posting (sent to Tally, or waiting to be settled there); they are not sent twice. Nothing was queued again."});
      window.__rows = {}; window.__rows[job] = {id: job, status: hst || "done", company: "", n: 10, done: 10, results: [old]}; window.__toasts = []; window.__rpc = []; }"""
    def press(n, d="2026-11-14", old=None, hst="done"):
        vid = A.evaluate(ADD, [n, d, G["k"]])
        A.evaluate(HOLD, [vid, dict(old or OLD, id=vid), "j-" + vid, hst])
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(3000)
        return vid
    copyrpc = lambda: [a for f, a in A.evaluate("() => window.__rpc") if f == "tally_post_copy_resend"]

    print("1. the Post press, the cloud holding the invoice for an earlier posting")
    print(" a. FinCom's copy has it only as an Optional voucher: sent again by the cloud, nothing asked of Tally")
    A.evaluate("""() => { window.__copy = (a) => ({ok: true, state: "optional", job: a.p_job, id: a.p_id, released: true, resent: true, why: "FinCom's copy of Tally shows it only as an Optional voucher: posted again"}); }""")
    va = press("ZR/0457")
    st = A.evaluate(STATE, va); t = A.evaluate(LAST); c = copyrpc()
    ok(c == [{"p_job": "j-" + va, "p_id": va}], "the cloud asked to decide by its copy, for the posting that holds it (%s)" % c)
    ok(st["st"] == "ready" and "sent again" in st["err"] and A.evaluate("(id) => SL().list.find(v => v.id === id).postJob", va) == "j-" + va, "queued on that posting again, said so; not Posted (%s)" % st)
    ok("1 invoice was posted before by FinCom and is not in the books: sent again" in t and t.startswith("0 posted to Tally"), "the message says so, readably (%s)" % t)
    # (A3) an invoice whose posting is still going is left out of the next Post press
    A.evaluate("""(id) => { CloudJobs.list = [{id: 'j-' + id, client_id: SL().cid, status: 'waiting', results: []}]; window.__sent = []; window.__enq = () => ({ok: true}); }""", va)
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(800)
    ok(A.evaluate("() => window.__sent").count([va]) == 0 and va not in sum(A.evaluate("() => window.__sent"), []), "(A3) its posting still waiting: not in the next Post press (%s)" % A.evaluate("() => window.__sent"))
    A.evaluate("() => { CloudJobs.list = []; }")
    A.evaluate("""(id) => { window.__rows['j-' + id] = {id: 'j-' + id, status: 'done', company: 'ZZ Test Reupload Traders', results: [{id, ok: true, byReply: true, verified: false, sentAt: new Date().toISOString()}]}; }""", va)
    A.evaluate("() => salesQueuedSync()"); A.wait_for_timeout(400)
    st = A.evaluate(STATE, va)
    ok(st["st"] == "posted" and not st["at"].startswith("2026-11-18") and st["err"] == "", "Posted once that posting answers (%s)" % st)
    print(" b. a regular voucher in FinCom's copy: posted before, In Tally, nothing sent")
    A.evaluate("""() => { window.__copy = (a) => ({ok: false, state: "there", job: a.p_job, id: a.p_id, vtype: "Sales", vno: "ZR/0458", day: "2026-11-14", error: "FinCom's copy of Tally has it as a regular entry; nothing was sent."}); }""")
    vb = press("ZR/0458"); st = A.evaluate(STATE, vb); t = A.evaluate(LAST)
    ok(st["st"] == "posted" and st["at"].startswith("2026-11-18") and st["note"] == "Posted before by FinCom; in Tally", "Posted before (its own date), In Tally (%s)" % st)
    ok("1 invoice was posted before by FinCom and is in Tally: not sent again" in t, "said (%s)" % t)
    print(" c. nothing in FinCom's copy, Tally's reply took the earlier posting: posted before, not sent again, said why")
    A.evaluate("""() => { window.__copy = (a) => ({ok: false, state: "none", job: a.p_job, id: a.p_id, error: "FinCom's copy of Tally has no entry carrying this FinCom id, so it cannot tell whether it is in Tally. Nothing was sent."}); }""")
    vc = press("ZR/0459"); st = A.evaluate(STATE, vc); t = A.evaluate(LAST)
    ok(st["st"] == "posted" and st["at"].startswith("2026-11-18") and st["note"] == "Posted before by FinCom, not sent again", "Posted before, not sent again (%s)" % st)
    ok("1 invoice was posted before by FinCom and not sent again" in t and A.evaluate("(id) => SL().list.find(v => v.id === id).postWhy", vc) == "FinCom's copy of Tally doesn't have this invoice, so it can't tell. Nothing was sent.", "readable, the reason kept in plain words (%s)" % t)
    print(" d. the cloud cannot decide yet (migration 219 not run): the status kept, the red note says so")
    A.evaluate("""() => { window.__copy = () => ({throw: "Could not find the function public.tally_post_copy_resend(p_id, p_job) in the schema cache"}); }""")
    vd = press("ZR/0460"); st = A.evaluate(STATE, vd)
    ok(st["st"] == "ready" and st["err"] == "FinCom can't check this yet. Nothing was sent.", "(A2) Ready, the red note plain (%s)" % st)
    print(" e. FinCom's copy not up to date since the posting's send: the status kept, the red note says so")
    A.evaluate("""() => { window.__copy = (a) => ({ok: false, state: "unsure", copy: "optional", job: a.p_job, id: a.p_id, error: "FinCom's copy of Tally is not up to date for this company, so it cannot tell whether this entry is still in Tally. Nothing was sent."}); }""")
    ve = press("ZR/0461"); st = A.evaluate(STATE, ve); t = A.evaluate(LAST)
    ok(st["st"] == "ready" and "not up to date for this company" in st["err"] and "1 not sent: see the red note on it" in t, "(A2) Ready, the copy's age as the red note (%s; %s)" % (st, t))
    print(" f. (A1) the earlier posting FAILED (its answer not ok), nothing in the copy: never Posted; that posting's words")
    A.evaluate("""() => { window.__copy = (a) => ({ok: false, state: "none", job: a.p_job, id: a.p_id}); }""")
    vf = press("ZR/0462", old=dict(OLD, ok=False, byReply=False, message="Tally said: ledger Kappa Retail does not exist"), hst="failed"); st = A.evaluate(STATE, vf)
    ok(st["st"] == "ready" and st["err"] == "Tally said: ledger Kappa Retail does not exist" and A.evaluate("(id) => SL().list.find(v => v.id === id).postJob || ''", vf) == "j-" + vf, "(A1) Ready, that posting's words, its posting kept (%s)" % st)
    print(" g. (A3) the holding posting still going when queued: no earlier answer, no copy asked; its own answer marks it")
    A.evaluate("""() => { window.__rpc = []; window.__copy = () => ({ok: false, state: "none"}); window.__flip = setInterval(() => { for (const k in (window.__rows || {})) if (window.__rows[k].status === 'waiting') { window.__rows[k].status = 'done'; window.__rows[k].results[0].sentAt = new Date().toISOString(); } }, 2500); }""")
    vg = press("ZR/0463", hst="waiting"); A.wait_for_timeout(4000); A.evaluate("() => clearInterval(window.__flip)")
    st = A.evaluate(STATE, vg)
    ok(copyrpc() == [] and st["st"] == "posted" and not st["at"].startswith("2026-11-18") and st["note"] == "", "that posting's own answer posts it; the copy not asked (%s, %s)" % (copyrpc(), st))
    print(" h. (A4) a client posting Optional vouchers by its setting: the Optional voucher IS the posting; never sent again")
    A.evaluate("""() => { CO().createOptional = true; window.__rpc = []; window.__copy = (a) => ({ok: true, state: "optional", resent: true, released: true}); }""")
    vh = press("ZR/0464"); st = A.evaluate(STATE, vh)
    ok(copyrpc() == [] and st["st"] == "posted" and st["at"].startswith("2026-11-18") and st["note"] == "Posted before by FinCom, not sent again", "no ask of the cloud, Posted before (%s)" % st)
    A.evaluate("(id) => { SL().filter = 'done'; render(); }", vh); A.wait_for_timeout(400)
    ok(A.locator("[data-not-in-tally='%s']" % vh).count() == 0, "no \"Not in Tally? Post again\" for such a client")
    A.evaluate("() => { CO().createOptional = false; }")
    ok(A.evaluate("() => window.__bridgeCalls") == [], "nothing asked of FinCom Bridge or Tally (%s)" % A.evaluate("() => window.__bridgeCalls"))

    print("2. Not in Tally? Post again on a posted invoice")
    A.evaluate("() => { SL().filter = 'done'; SL().openId = null; render(); }"); A.wait_for_timeout(500)
    row = A.locator("[data-not-in-tally='%s']" % vc)
    ok(row.count() == 1 and row.first.inner_text() == "Not in Tally? Post again", "the button on the posted row (%d)" % row.count())
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); row.first.scroll_into_view_if_needed(); A.wait_for_timeout(200); A.screenshot(path=os.path.join(SHOTS, "1-sales-posted-row.png"))
    A.evaluate("(id) => { SL().openId = id; render(); }", vc); A.wait_for_timeout(500)
    ok(A.locator(".bk-panel [data-not-in-tally='%s']" % vc).count() == 1 and A.locator("[data-post-why='%s']" % vc).count() == 1, "the button and the reason in the invoice's panel")
    if SHOTS: A.locator(".bk-panel [data-not-in-tally='%s']" % vc).first.scroll_into_view_if_needed(); A.wait_for_timeout(200); A.screenshot(path=os.path.join(SHOTS, "2-sales-panel.png"))
    A.evaluate("() => { SL().openId = null; render(); }"); A.wait_for_timeout(300)
    A.evaluate("""(id) => { window.__ids = [{job_id: 'j-' + id}]; window.__rpc = []; window.__toasts = []; window.__calls = [];
      window.__copy = (a) => ({ok: true, state: "deleted", job: a.p_job, id: a.p_id, released: true, resent: true}); }""", vc)
    A.locator("[data-not-in-tally='%s']" % vc).first.click(); A.wait_for_timeout(1200)
    st = A.evaluate(STATE, vc); c = copyrpc(); calls = A.evaluate("() => window.__calls")
    ok(any(("fincom_id=eq." + vc) in x and "live=is.true" in x for x in calls) and c == [{"p_job": "j-" + vc, "p_id": vc}], "the posting holding it found, the cloud asked (%s)" % c)
    ok(st["st"] == "ready" and A.evaluate("(id) => SL().list.find(v => v.id === id).postJob", vc) == "j-" + vc, "queued on that posting again (%s)" % st)
    ok("deleted in Tally: sent again" in A.evaluate(LAST) and A.evaluate("(id) => SL().list.find(v => v.id === id).postWhy", vc) is None, "said; the old reason gone (%s)" % A.evaluate(LAST))
    A.evaluate("""(id) => { window.__ids = [{job_id: 'j-' + id}]; window.__copy = (a) => ({ok: false, state: "there", vtype: "Sales", vno: "ZR/0458", day: "2026-11-14"}); window.__toasts = []; }""", vb)
    A.evaluate("(id) => salesNotInTally(id)", vb); A.wait_for_timeout(500)
    ok(A.evaluate(STATE, vb)["st"] == "posted" and "posted before by FinCom; nothing was sent" in A.evaluate(LAST), "a regular voucher in the copy: stays Posted (%s)" % A.evaluate(LAST))
    A.evaluate("() => { window.__ids = []; window.__toasts = []; }")
    A.evaluate("(id) => salesNotInTally(id)", vb); A.wait_for_timeout(400)
    ok("No posting of FinCom holds" in A.evaluate(LAST), "nothing holds it: said so, nothing sent (%s)" % A.evaluate(LAST))

    print("3. a purchase bill and a bank line")
    bid = A.evaluate("""() => { const e = {id: "bill-zr-1", status: "approved", exportedAt: "2026-11-18T06:00:00.000Z", postByReply: true, postedVia: "bridge", x: {invoiceNo: "ZB/77", invoiceDate: "2026-11-12", total: 500}, snapshot: {lines: []}};
      D().entries[e.id] = e; window.__ids = [{job_id: "j-bill-1"}]; window.__rpc = [];
      window.__copy = (a) => ({ok: true, state: "deleted", job: a.p_job, id: a.p_id, released: true, resent: true}); return e.id; }""")
    A.evaluate("(id) => billNotInTally(id)", bid); A.wait_for_timeout(600)
    b = A.evaluate("(id) => { const e = D().entries[id]; return {exp: e.exportedAt, undo: e.postUndo && e.postUndo.why}; }", bid)
    ok(b["exp"] is None and "deleted in Tally" in (b["undo"] or "") and copyrpc() == [{"p_job": "j-bill-1", "p_id": bid}], "the bill: sent again on its posting, its posted mark undone with the copy's words (%s)" % b)
    rid = A.evaluate("""() => { const b = B(), r = {id: "stzr-1", fp: "stzr-1", state: "sent", date: "2026-11-10", narr: "NEFT ZZ", debit: 250, credit: 0, ledger: "Kappa Retail", sentAt: "2026-11-18T06:00:00.000Z", postedVia: "bridge", postByReply: true, tally: {company: "ZZ Test Reupload Traders"}, dec: {name: "Kappa Retail"}};
      b.rows.push(r); window.__ids = [{job_id: "j-bank-1"}]; window.__rpc = []; window.__calls = [];
      window.__copy = (a) => ({ok: true, state: "cancelled", job: a.p_job, id: a.p_id, released: true, resent: true}); return r.id; }""")
    A.evaluate("(id) => bankNotInTally(id)", rid); A.wait_for_timeout(600)
    r = A.evaluate("(id) => { const r = B().rows.find(x => x.id === id); return {st: r.state, job: r.postJob || ''}; }", rid)
    fp = A.evaluate("() => fpHash('stzr-1')")
    ok(r["st"] == "ready" and r["job"] == "j-bank-1" and any(("fincom_id=eq." + fp) in x for x in A.evaluate("() => window.__calls")), "the bank line: back to Ready on its posting, found by its FinCom id (%s)" % r)
    print("4. (A5) bills and bank lines: an earlier posting's answer from the Post press goes through the same decision")
    out = A.evaluate("""async () => { window.__rpc = []; const cid = S.coId;
      const e1 = {id: "bill-zr-2", status: "approved", x: {invoiceNo: "ZB/78", invoiceDate: "2026-11-12", total: 600, vendorName: "Made-up Vendor"}, snapshot: {lines: []}},
            e2 = {id: "bill-zr-3", status: "approved", x: {invoiceNo: "ZB/79", invoiceDate: "2026-11-12", total: 700, vendorName: "Made-up Vendor"}, snapshot: {lines: []}};
      D().entries[e1.id] = e1; D().entries[e2.id] = e2;
      window.__copy = (a) => a.p_id === "bill-zr-2" ? {ok: false, state: "unsure", error: "FinCom's copy of Tally is not up to date for this company, so it cannot tell whether this entry is still in Tally. Nothing was sent."} : {ok: false, state: "there", vtype: "Purchase", vno: "ZB/79", day: "2026-11-12"};
      const old = {ok: true, byReply: true, verified: false, sentAt: "2026-11-18T11:23:12+05:30", kind: "voucher"};
      await window.loadPart("notintally"); await postEarlier("bill", CO(), [[e1, Object.assign({id: e1.id, earlier: "j-b1"}, old)], [e2, Object.assign({id: e2.id, earlier: "j-b2"}, old)]], "ZZ Test Reupload Traders");
      const r = {id: "stzr-2", fp: "stzr-2", state: "ready", date: "2026-11-10", narr: "NEFT ZZ", debit: 250, credit: 0, ledger: "Kappa Retail", dec: {name: "Kappa Retail"}};
      B().rows.push(r); window.__copy = () => ({ok: true, state: "deleted", resent: true, released: true});
      await postEarlier("bank", CO(), [[r, Object.assign({id: r.id, earlier: "j-k1"}, old)]], "ZZ Test Reupload Traders");
      return {e1: {exp: e1.exportedAt || null, err: e1.postError || ""}, e2: {exp: e2.exportedAt || null}, r: {st: r.state, job: r.postJob || "", err: r.postError || ""}}; }""")
    ok(out["e1"]["exp"] is None and "not up to date" in out["e1"]["err"], "a bill, the copy not up to date: not posted, the red note says so (%s)" % out["e1"])
    ok(bool(out["e2"]["exp"]) and out["e2"]["exp"].startswith("2026-11-18"), "a bill in Tally by the copy: posted before, its earlier date (%s)" % out["e2"])
    ok(out["r"]["st"] == "ready" and out["r"]["job"] == "j-k1" and "sent again" in out["r"]["err"], "a bank line not in the books: queued on its posting again (%s)" % out["r"])
    ok(A.evaluate("() => window.__bridgeCalls") == [], "nothing asked of FinCom Bridge or Tally at all")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
