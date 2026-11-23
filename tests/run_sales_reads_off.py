"""python3 run_sales_reads_off.py - the sales duplicate check when FinCom Bridge here has reading entries from Tally off
(next-fix-sales-readsoff, the owner, 23-Nov-2026). The bridge answers /vouchers with 409 "Reading entries from Tally is
off on this computer ..." (its ReadDays is off by default); before this fix the sales post stopped there with only a
toast. Now that answer (and only that one) sends the check to FinCom's cloud copy (CloudTally.call, as from any other
computer); with no cloud copy nothing is sent, said plainly. Made-up data only.
  1. reads off here, the cloud copy fresh: the check reads the cloud copy; the invoice already there is In Tally, the
     other posted; no note;
  2. the cloud copy's last read old: the result says "Checked against FinCom's copy of Tally (updated <time>)";
  3. no cloud copy: nothing sent, the plain message, the invoices still Ready;
  4. the cloud copy fails to answer: the same;
  5. another bridge error (not reads off): not sent to the cloud copy, nothing posted, as before;
  6. Post one by one: the same rule (cloud copy used; none: the plain message, nothing sent).
Run on the React build: TDSDESK_SITE=../app/dist-test SYNC_PORT=8961 python3 run_sales_reads_off.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
PORT = int(os.environ.get("SYNC_PORT") or 8961)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

NOCHECK = ("Not posted: FinCom could not check Tally for these invoice numbers (reading entries from Tally is off on this computer "
           "and FinCom's cloud copy is not available). Nothing was sent; try again in a minute or post from another computer.")
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
GST = """() => { const mk = (b) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; };
  return {up: mk('09AAACZ1234Q1Z'), k: mk('27AAACK5678P1Z')}; }"""
LED = [["Kappa Retail", "Sundry Debtors", "k"], ["Sales Account", "Sales Accounts"], ["Round Off", "Indirect Expenses"], ["Output IGST", "Duties & Taxes"]]
SETL = """([leds, g]) => { const cid = SL() ? SL().cid : CO().id, list = leds.map(([name, group, gk]) => ({name, group, gstin: gk ? g[gk] : ""}));
  Ledgers.st[cid] = {list, parents: {}, at: new Date().toISOString(), srcAt: new Date().toISOString(), src: "cloud", file: "", book: "", cloudAt: ""};
  if (S.bank && S.bank.cid === cid) S.bank.ledgers = {list, importedAt: new Date().toISOString(), live: true}; Ledgers.ver++; }"""
ADD = """([n, d, cg]) => { const s = SL(); const v = newInvoice({number: n, date: d, customerName: "Kappa Retail", customerGstin: cg, pos: "27", taxable: 1000,
  cgst: 0, sgst: 0, igst: 180, cess: 0, total: 1180, items: []}, "upload"); s.list.push(v); mapInvoice(v); return v.id; }"""
NEWCO = """(g) => { const c = newCompany({name: "ZZ Test Readsoff Traders", gstin: g.up}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; S.step = null; return loadSales(c.id); }).then(() => c.id); }"""
# the outside calls stubbed below the duplicate check (tallyCall, Bridge.call, CloudTally.call, TCloud): the bridge here
# live, its /vouchers answered as window.__bridge says; FinCom's cloud copy present or not as window.__cloud says
STUB = """() => { window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  window.ensureTallyCompany = async () => true; window.syncLedgersFromTally = async () => true;
  window.tallyVia = () => "bridge"; window.__sent = []; window.__bcalls = []; window.__ccalls = [];
  Bridge.call = async (url) => { window.__bcalls.push(url);
    if (window.__bridge === "off") throw {code: "bridge", message: "Reading entries from Tally is off on this computer (FinCom reads entries only as they change; history comes from the Day Book upload)."};
    if (window.__bridge === "down") throw {code: "bridge", message: "Tally did not answer in time."};
    return {ok: true, vouchers: []}; };
  window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []};
  const bk = () => ({book: "bk-zz", from: "2026-04-01", company: "ZZ Test Readsoff Traders", daysAt: window.__cloud.at, state: {seen: window.__cloud.at}});
  TCloud.on = () => true; TCloud.has = () => !!window.__cloud.has; TCloud.book = () => window.__cloud.has ? bk() : null;
  CloudTally.call = async (co, url) => { window.__ccalls.push(url); if (window.__cloud.fail) throw {code: "cloud", message: "Failed to fetch"};
    return {ok: true, via: "cloud", vouchers: window.__cloud.vouchers}; };
  Bridge.post = async (p) => { window.__sent.push(p.vouchers.map(v => v.id)); return {ok: true, company: "ZZ Test Readsoff Traders",
    results: p.vouchers.map(v => ({id: v.id, ok: true, byReply: true, verified: false}))}; }; }"""
STATE = "() => SL().list.map(v => ({n: v.x.number, st: v.status, err: v.postError || ''}))"
IN_CLOUD = "[{guid: 'g-1', masterId: '1', date: '20261102', type: 'Sales', number: 'ZR/1', party: 'Kappa Retail', amount: '1180', cancelled: 'No'}]"
def fresh(A, *nos):
    A.evaluate("() => { SL().list = []; window.__sent = []; window.__bcalls = []; window.__ccalls = []; window.__toasts = []; }")
    return [A.evaluate(ADD, [n, "2026-11-02", G["k"]]) for n in nos]
last = lambda A: A.evaluate("() => window.__toasts.slice(-1)[0] || ''")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); A = ctx.new_page(); A.on("pageerror", lambda e: errors.append(str(e)))
    A.goto("http://localhost:%d/" % PORT); A.wait_for_timeout(2500); A.evaluate(READY); A.wait_for_timeout(800)
    G = A.evaluate(GST)
    cid = A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G]); A.evaluate(STUB)

    print("1. reads off on this computer, the cloud copy fresh: checked there")
    fresh(A, "ZR/1", "ZR/2")
    A.evaluate("() => { window.__bridge = 'off'; window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: " + IN_CLOUD + "}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); cc = A.evaluate("() => window.__ccalls"); sent = A.evaluate("() => window.__sent")
    ok(len(cc) >= 1 and all(u.startswith("/vouchers?") for u in cc), "the duplicate check read FinCom's cloud copy (%s)" % cc)
    ok([x["st"] for x in st] == ["intally", "posted"], "ZR/1 (in the cloud copy) In Tally, ZR/2 posted (%s)" % st)
    ok(len(sent) == 1 and len(sent[0]) == 1, "only ZR/2 sent to Tally (%s)" % sent)
    t = last(A)
    ok(t.startswith("1 posted to Tally") and "FinCom's copy" not in t, "the result: 1 posted, no note for a fresh copy (%s)" % t)

    print("2. the cloud copy's last read old: said in the result")
    fresh(A, "ZR/3")
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date(Date.now() - 3 * 3600000).toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(st[0]["st"] == "posted", "posted on the cloud copy's check (%s)" % st)
    ok("Checked against FinCom's copy of Tally (updated " in t, "the note: checked against FinCom's copy, with its time (%s)" % t)

    print("3. no cloud copy: nothing sent, said plainly")
    fresh(A, "ZR/4", "ZR/5")
    A.evaluate("() => { window.__cloud = {has: false, fail: false, at: '', vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(A.evaluate("() => window.__sent") == [], "nothing sent to Tally")
    ok(t == NOCHECK, "the plain message (%s)" % t)
    ok([x["st"] for x in st] == ["ready", "ready"] and not A.evaluate("() => SL().busy"), "the invoices still Ready, not busy (%s)" % st)

    print("4. the cloud copy fails to answer: the same")
    fresh(A, "ZR/6")
    A.evaluate("() => { window.__cloud = {has: true, fail: true, at: new Date().toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    ok(A.evaluate("() => window.__sent") == [] and last(A) == NOCHECK, "nothing sent, the plain message (%s)" % last(A))

    print("5. another bridge error: not taken for reads off")
    fresh(A, "ZR/7")
    A.evaluate("() => { window.__bridge = 'down'; window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    t = last(A)
    ok(A.evaluate("() => window.__ccalls") == [], "the cloud copy not asked")
    ok(A.evaluate("() => window.__sent") == [] and "Tally did not answer in time" in t and t != NOCHECK, "nothing sent, the bridge's own words (%s)" % t)

    print("6. Post one by one: the same rule")
    ids = fresh(A, "ZR/1", "ZR/8")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__bridge = 'off'; window.__cloud = {has: true, fail: false, at: new Date(Date.now() - 3 * 3600000).toISOString(), vouchers: " + IN_CLOUD + "}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(len(A.evaluate("() => window.__ccalls")) >= 1, "one by one: the cloud copy read")
    ok([x["st"] for x in st] == ["intally", "posted"] and len(A.evaluate("() => window.__sent")) == 1, "ZR/1 In Tally, ZR/8 posted alone (%s)" % st)
    ok("Checked against FinCom's copy of Tally (updated " in t, "one by one: the old copy said (%s)" % t)
    ids = fresh(A, "ZR/9")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__cloud = {has: false, fail: false, at: '', vouchers: []}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(A.evaluate("() => window.__sent") == [] and last(A) == NOCHECK, "one by one, no cloud copy: nothing sent, the plain message (%s)" % last(A))
    ok(st[0]["st"] == "review", "still To review (%s)" % st)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
