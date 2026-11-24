"""python3 run_sales_reads_off.py - the sales duplicate check when FinCom Bridge here has reading entries from Tally off,
updated to the owner's rule of 23-Nov-2026 (next-dup-cloud-only, replacing the date holds of next-fix-sales-readsoff):
FinCom never reads Tally before posting; the check uses only FinCom's cloud copy (CloudTally / tally_vouchers_in), and
nothing ever stops or holds a batch. Made-up data only.
  1. reads off here, the cloud copy fresh: the copy read, the bridge never asked; the invoice already there is In Tally
     quietly with Tally's number, the other posted; no note;
  2. the cloud copy's last read old: posted; the result says nothing; one small line on the invoice's own panel;
  3. no cloud copy: posted; the result says nothing; the small panel line only;
  4. the cloud copy fails to answer: the same;
  5. the bridge down: never asked before posting; the copy checks; posted;
  6. Post one by one: the same rule (copy used; none: posted);
  7. invoice dates the cloud copy does not hold (after its last day, a gap, a short day, a skipped day, before its
     start, the days list not answering): all posted, no red note, no "held", the days list (tally_days) never asked.
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

NOTE = "Checked against FinCom's copy of Tally, last updated "
NOCHECK = "Not checked for duplicates: FinCom's copy of Tally did not answer."
QUIET = lambda t: "Not posted" not in t and "held" not in t and "FinCom's copy" not in t and "anyway" not in t.lower()
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
  window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; window.__held = {to: "2026-11-30", doneTo: "", skipped: []};
  window.__dcalls = []; const api0 = Cloud.api.bind(Cloud);
  Cloud.api = async (q, o) => { if (!/^tally_days\?/.test(q)) return api0(q, o); window.__dcalls.push(q); const h = window.__held;
    if (h.daysFail) throw {message: "Failed to fetch"};
    const ds = decodeURIComponent((q.match(/day=in\.\(([^)]*)\)/) || [])[1] || "").split(",").filter(Boolean);
    return ds.filter(d => d >= "2026-04-01" && d <= h.to && !(h.gap || []).some(([a, b]) => d >= a && d <= b)).map(d => ({day: d, at: new Date().toISOString(), note: (h.notes || {})[d] || null,
      n: (h.n || {})[d] != null ? h.n[d] : window.__cloud.vouchers.filter(x => x.date === d.replace(/-/g, "")).length})); };
  const bk = () => ({book: "bk-zz", from: "2026-04-01", to: window.__held.to, company: "ZZ Test Readsoff Traders", daysAt: window.__cloud.at,
    state: {seen: window.__cloud.at, doneTo: window.__held.doneTo, skipped: window.__held.skipped}});
  TCloud.on = () => true; TCloud.has = () => !!window.__cloud.has; TCloud.book = () => window.__cloud.has ? bk() : null;
  CloudTally.call = async (co, url) => { window.__ccalls.push(url); if (window.__cloud.fail) throw {code: "cloud", message: "Failed to fetch"};
    return {ok: true, via: "cloud", vouchers: window.__cloud.vouchers}; };
  Bridge.post = async (p) => { window.__sent.push(p.vouchers.map(v => v.id)); return {ok: true, company: "ZZ Test Readsoff Traders",
    results: p.vouchers.map(v => ({id: v.id, ok: true, byReply: true, verified: false}))}; }; }"""
STATE = "() => SL().list.map(v => ({n: v.x.number, st: v.status, err: v.postError || '', copy: (v.copyCheck && v.copyCheck.note) || ''}))"
IN_CLOUD = "[{guid: 'g-1', masterId: '1', date: '20261102', type: 'Sales', number: 'ZR/1', party: 'Kappa Retail', cancelled: 'No', entries: [{ledger: 'Kappa Retail', amount: '-1180.00'}, {ledger: 'Sales Account', amount: '1000.00'}, {ledger: 'Output IGST', amount: '180.00'}]}]"
def fresh(A, *nos, d="2026-11-02"):
    A.evaluate("() => { SL().list = []; window.__held = {to: '2026-11-30', doneTo: '', skipped: []}; window.__dcalls = []; window.__sent = []; window.__bcalls = []; window.__ccalls = []; window.__toasts = []; }")
    return [A.evaluate(ADD, [n, d, G["k"]]) for n in nos]
last = lambda A: A.evaluate("() => window.__toasts.slice(-1)[0] || ''")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); A = ctx.new_page(); A.on("pageerror", lambda e: errors.append(str(e)))
    A.goto("http://localhost:%d/" % PORT); A.wait_for_timeout(2500); A.evaluate(READY); A.wait_for_timeout(800)
    G = A.evaluate(GST)
    cid = A.evaluate(NEWCO, G); A.wait_for_timeout(800)
    A.evaluate(SETL, [LED, G]); A.evaluate(STUB)
    BREADS = "() => window.__bcalls.filter(u => /^\\/(vouchers|ledgerlines|tags|daybook)/.test(u))"

    print("1. reads off on this computer, the cloud copy fresh: checked there, Tally never read")
    fresh(A, "ZR/1", "ZR/2")
    A.evaluate("() => { window.__bridge = 'off'; window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: " + IN_CLOUD + "}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); cc = A.evaluate("() => window.__ccalls"); sent = A.evaluate("() => window.__sent")
    ok(len(cc) >= 1 and all(u.startswith("/vouchers?") for u in cc), "the duplicate check read FinCom's cloud copy (%s)" % cc)
    ok(A.evaluate(BREADS) == [], "the bridge never asked to read Tally (%s)" % A.evaluate("() => window.__bcalls"))
    ok([x["st"] for x in st] == ["intally", "posted"], "ZR/1 (in the cloud copy) In Tally, ZR/2 posted (%s)" % st)
    ok(A.evaluate("() => (SL().list[0].tallyMatch || {}).number || ''") == "ZR/1", "ZR/1 marked with Tally's number")
    ok(len(sent) == 1 and len(sent[0]) == 1, "only ZR/2 sent to Tally (%s)" % sent)
    t = last(A)
    ok(t.startswith("1 posted to Tally") and QUIET(t), "the result: 1 posted, nothing more said (%s)" % t)
    ok(all(x["copy"] == "" for x in st), "no note on the invoices for a fresh copy (%s)" % st)

    print("2. the cloud copy's last read old: posted, the result quiet, one line on the invoice's panel")
    fresh(A, "ZR/3")
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date(Date.now() - 3 * 3600000).toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(st[0]["st"] == "posted", "posted on the cloud copy's check (%s)" % st)
    ok(QUIET(t), "nothing said in the result (%s)" % t)
    ok(st[0]["copy"].startswith(NOTE), "the small line kept on the invoice (%s)" % st[0]["copy"])
    A.evaluate("() => { SL().openId = SL().list[0].id; render(); }"); A.wait_for_timeout(500)
    ok(A.locator("[data-sales-copy-note]").count() == 1 and NOTE in A.inner_text("[data-sales-copy-note]"), "the line shown on the invoice's panel")
    A.evaluate("() => { SL().openId = null; SL().filter = 'all'; render(); }")

    print("3. no cloud copy: posted, nothing said")
    fresh(A, "ZR/4", "ZR/5")
    A.evaluate("() => { window.__cloud = {has: false, fail: false, at: '', vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(len(A.evaluate("() => window.__sent")) == 1 and [x["st"] for x in st] == ["posted", "posted"], "both posted (%s)" % st)
    ok(QUIET(t) and t.startswith("2 posted to Tally"), "the result quiet (%s)" % t)
    ok(all(x["copy"] == NOCHECK for x in st) and all(x["err"] == "" for x in st), "only the small panel line (%s)" % st)
    ok(A.evaluate(BREADS) == [] and not A.evaluate("() => SL().busy"), "Tally not read, not busy")

    print("4. the cloud copy fails to answer: posted, nothing said")
    fresh(A, "ZR/6")
    A.evaluate("() => { window.__cloud = {has: true, fail: true, at: new Date().toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "posted" and len(A.evaluate("() => window.__sent")) == 1 and QUIET(last(A)), "posted, the result quiet (%s)" % last(A))
    ok(st[0]["copy"] == NOCHECK, "the small panel line (%s)" % st[0]["copy"])

    print("5. the bridge down: never asked before posting; the copy checks")
    fresh(A, "ZR/7")
    A.evaluate("() => { window.__bridge = 'down'; window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(len(A.evaluate("() => window.__ccalls")) >= 1 and A.evaluate(BREADS) == [], "the cloud copy asked, Tally not read")
    ok(st[0]["st"] == "posted" and QUIET(last(A)), "posted (%s | %s)" % (st, last(A)))

    print("6. Post one by one: the same rule")
    ids = fresh(A, "ZR/1", "ZR/8")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__bridge = 'off'; window.__cloud = {has: true, fail: false, at: new Date(Date.now() - 3 * 3600000).toISOString(), vouchers: " + IN_CLOUD + "}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(len(A.evaluate("() => window.__ccalls")) >= 1 and A.evaluate(BREADS) == [], "one by one: the cloud copy read, Tally not read")
    ok([x["st"] for x in st] == ["intally", "posted"] and len(A.evaluate("() => window.__sent")) == 1, "ZR/1 In Tally, ZR/8 posted alone (%s)" % st)
    ok(QUIET(t), "one by one: the result quiet (%s)" % t)
    ok(st[1]["copy"].startswith(NOTE), "one by one: the small line on the posted invoice's panel (%s)" % st[1]["copy"][:40])
    ids = fresh(A, "ZR/9")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__cloud = {has: false, fail: false, at: '', vouchers: []}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(len(A.evaluate("() => window.__sent")) == 1 and st[0]["st"] == "posted" and QUIET(last(A)), "one by one, no cloud copy: posted, quiet (%s | %s)" % (st, last(A)))

    print("7. invoice dates the cloud copy does not hold: all posted, nothing held, the days list never asked")
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")
    for label, held, dates in [
        ("after the last day uploaded", {"to": "2026-11-10", "doneTo": "", "skipped": []}, ["2026-11-08", "2026-11-12", "2026-11-14"]),
        ("a seeded last day read of today, October never uploaded", {"to": "2026-11-30", "doneTo": "2026-11-23", "skipped": [], "gap": [["2026-10-01", "2026-10-31"]]}, ["2026-09-30", "2026-10-15"]),
        ("fewer entries in the copy than the day's count", {"to": "2026-11-30", "doneTo": "", "skipped": [], "n": {"2026-11-04": 5}}, ["2026-11-02", "2026-11-04"]),
        ("a skipped day", {"to": "2026-11-30", "doneTo": "", "skipped": ["20261103"]}, ["2026-11-02", "2026-11-03"]),
        ("before its start", {"to": "2026-11-30", "doneTo": "", "skipped": []}, ["2026-03-31", "2026-04-02"]),
        ("a day read short", {"to": "2026-11-30", "doneTo": "", "skipped": [], "notes": {"2026-11-04": "short read: 3 of 5"}}, ["2026-11-02", "2026-11-04"]),
        ("the days list not answering", {"to": "2026-11-30", "doneTo": "", "skipped": [], "daysFail": True}, ["2026-11-02", "2026-11-05"])]:
        A.evaluate("() => { SL().list = []; window.__sent = []; window.__ccalls = []; window.__toasts = []; window.__dcalls = []; }")
        for i, d in enumerate(dates): A.evaluate(ADD, ["ZD/%d" % (i + 1), d, G["k"]])
        A.evaluate("(h) => { window.__held = h; }", held)
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
        st = A.evaluate(STATE); t = last(A); sent = A.evaluate("() => window.__sent")
        ok([x["st"] for x in st] == ["posted"] * len(dates) and len(sent) == 1 and len(sent[0]) == len(dates), label + ": all posted in one batch (%s)" % [x["st"] for x in st])
        ok(all(x["err"] == "" for x in st) and QUIET(t), label + ": no red note, nothing held or said (%s)" % t)
        ok(A.evaluate("() => window.__dcalls") == [], label + ": the days list (tally_days) not asked")
    print("   Post one by one: a day the copy does not hold")
    ids = fresh(A, "ZD/8", "ZD/9")
    A.evaluate("(id) => { SL().list.find(v => v.id === id).x.date = '2026-11-20'; }", ids[1])
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__held = {to: '2026-11-10', doneTo: '', skipped: []}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok([x["st"] for x in st] == ["posted", "posted"] and len(A.evaluate("() => window.__sent")) == 2, "one by one: both posted (%s)" % st)
    ok(t.startswith("One by one: 2 of 2 posted") and QUIET(t) and A.evaluate("() => window.__dcalls") == [], "one by one: the counts, nothing held (%s)" % t)
    A.evaluate("() => { SL().filter = 'all'; render(); }"); A.wait_for_timeout(300)
    ok("Not posted: FinCom" not in A.inner_text("#app") and "Post anyway" not in A.inner_text("#app"), "no hold and no warning on the page")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
