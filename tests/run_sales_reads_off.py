"""python3 run_sales_reads_off.py - the sales duplicate check when FinCom Bridge here has reading entries from Tally off
(next-fix-sales-readsoff, the owner, 23-Nov-2026). The bridge answers /vouchers with 409 "Reading entries from Tally is
off on this computer ..." (its ReadDays is off by default); before this fix the sales post stopped there with only a
toast. Now that answer (and only that one) sends the check to FinCom's cloud copy (CloudTally.call, as from any other
computer); with no cloud copy nothing is sent, said plainly. Made-up data only.
  1. reads off here, the cloud copy fresh: the check reads the cloud copy; the invoice already there is In Tally, the
     other posted; no note;
  2. the cloud copy's last read old: the result says "Checked against FinCom's copy of Tally (updated <time>)";
  3. no cloud copy: nothing sent, the plain message (turn on reading, or upload the Day Book), the invoices still Ready;
  4. the cloud copy fails to answer: nothing sent, said plainly;
  5. another bridge error (not reads off): not sent to the cloud copy, nothing posted, as before;
  6. Post one by one: the same rule (cloud copy used; none: the plain message, nothing sent);
  7. an invoice dated on a day the cloud copy does not hold (before its start, after the later of its end and the last
     day read, or a skipped day): held, Ready with a red note; the others checked and posted; the counts said; all held:
     nothing sent, the copy not asked; the day read in later: posted. Post one by one the same.
  The note of an old copy is kept on each invoice checked so (its panel), not only in the message.
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

NOCOPY = ("Not posted: FinCom could not check Tally for these invoice numbers. Turn on reading entries in FinCom Bridge on this "
          "computer, or upload the Day Book. Nothing was sent.")
NOCHECK = ("Not posted: FinCom could not check Tally for these invoice numbers (reading entries from Tally is off on this computer "
           "and FinCom's cloud copy is not available). Nothing was sent; try again in a minute.")
NOTE = "Checked against FinCom's copy of Tally, last updated "
NOTE_END = ". Invoices entered in Tally after that were not checked."
def nodayrow(day): return ("Not posted: FinCom's copy of Tally has no entries for " + day + ", so this invoice number could not be checked. "
                            "Upload the Day Book for that date, or turn on reading entries in FinCom Bridge on this computer.")
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
    ok(all(x["copy"] == "" for x in st), "no note on the invoices for a fresh copy (%s)" % st)

    print("2. the cloud copy's last read old: said in the result")
    fresh(A, "ZR/3")
    A.evaluate("() => { window.__cloud = {has: true, fail: false, at: new Date(Date.now() - 3 * 3600000).toISOString(), vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(st[0]["st"] == "posted", "posted on the cloud copy's check (%s)" % st)
    ok(NOTE in t and NOTE_END in t, "the note: checked against FinCom's copy, with its time (%s)" % t)
    ok(st[0]["copy"].startswith(NOTE) and st[0]["copy"].endswith(NOTE_END), "the note kept on the invoice (%s)" % st[0]["copy"])
    A.evaluate("() => { SL().openId = SL().list[0].id; render(); }"); A.wait_for_timeout(500)
    ok(A.locator("[data-sales-copy-note]").count() == 1 and NOTE in A.inner_text("[data-sales-copy-note]"), "the note shown on the invoice's panel")
    A.evaluate("() => { SL().openId = null; SL().filter = 'done'; render(); }"); A.wait_for_timeout(500)
    ok(A.locator("[data-sales-copy]").count() == 1, "and marked on its row")
    A.evaluate("() => { SL().filter = 'all'; render(); }")

    print("3. no cloud copy: nothing sent, said plainly")
    fresh(A, "ZR/4", "ZR/5")
    A.evaluate("() => { window.__cloud = {has: false, fail: false, at: '', vouchers: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(A.evaluate("() => window.__sent") == [], "nothing sent to Tally")
    ok(t == NOCOPY, "the plain message (%s)" % t)
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
    ok(NOTE in t, "one by one: the old copy said (%s)" % t)
    ok(all(x["copy"].startswith(NOTE) for x in st), "one by one: the note kept on each invoice (%s)" % [x["copy"][:30] for x in st])
    ok(all(NOTE in r for r in A.evaluate("() => SL().oneByOne.rows.map(r => r.word)")), "one by one: the note on each row of the result")
    ids = fresh(A, "ZR/9")
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__cloud = {has: false, fail: false, at: '', vouchers: []}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(A.evaluate("() => window.__sent") == [] and last(A) == NOCOPY, "one by one, no cloud copy: nothing sent, the plain message (%s)" % last(A))
    ok(st[0]["st"] == "review", "still To review (%s)" % st)

    print("7. invoice dates the cloud copy does not hold: those held (Ready, a red note), the others checked and posted")
    # (Optional vouchers are off by default since migration 213: switched on here, so the held part is seen after its note)
    A.evaluate("() => { CO().createOptional = true; window.__cloud = {has: true, fail: false, at: new Date().toISOString(), vouchers: []}; }")
    for label, held, dates, miss in [
        ("after the last day uploaded", {"to": "2026-11-10", "doneTo": "", "skipped": []}, ["2026-11-08", "2026-11-12", "2026-11-14"], ["2026-11-12", "2026-11-14"]),
        # a Day Book file set doneTo to its upload day (bridge-go keep.go); October never uploaded: still not held
        ("a seeded last day read of today, October never uploaded", {"to": "2026-11-30", "doneTo": "2026-11-23", "skipped": [], "gap": [["2026-10-01", "2026-10-31"]]}, ["2026-09-30", "2026-10-15"], ["2026-10-15"]),
        ("fewer entries in the copy than the day's count", {"to": "2026-11-30", "doneTo": "", "skipped": [], "n": {"2026-11-04": 5}}, ["2026-11-02", "2026-11-04"], ["2026-11-04"]),
        ("a skipped day", {"to": "2026-11-30", "doneTo": "", "skipped": ["20261103"]}, ["2026-11-02", "2026-11-03"], ["2026-11-03"]),
        ("before its start", {"to": "2026-11-30", "doneTo": "", "skipped": []}, ["2026-03-31", "2026-04-02"], ["2026-03-31"]),
        # Apr-Sep and Nov uploaded, October never: an October day inside the book's range is not held by the copy
        ("a gap in the days uploaded (October)", {"to": "2026-11-30", "doneTo": "", "skipped": [], "gap": [["2026-10-01", "2026-10-31"]]}, ["2026-09-30", "2026-10-15", "2026-11-02"], ["2026-10-15"]),
        ("a day read short", {"to": "2026-11-30", "doneTo": "", "skipped": [], "notes": {"2026-11-04": "short read: 3 of 5"}}, ["2026-11-02", "2026-11-04"], ["2026-11-04"]),
        ("an empty read waiting for a second", {"to": "2026-11-30", "doneTo": "", "skipped": [], "notes": {"2026-11-06": "empty day with 30 entries before: confirm by a second empty read"}}, ["2026-11-02", "2026-11-06"], ["2026-11-06"])]:
        A.evaluate("() => { SL().list = []; window.__sent = []; window.__ccalls = []; window.__toasts = []; }")
        for i, d in enumerate(dates): A.evaluate(ADD, ["ZD/%d" % (i + 1), d, G["k"]])
        A.evaluate("(h) => { window.__held = h; }", held)
        A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
        st = A.evaluate(STATE); t = last(A); fm = A.evaluate("(ds) => ds.map(d => fmtDate(d))", miss)
        want = ["ready" if d in miss else "posted" for d in dates]
        ok([x["st"] for x in st] == want, label + ": the held days' invoices Ready, the others posted (%s)" % [x["st"] for x in st])
        sent = A.evaluate("() => window.__sent")
        ok(len(sent) == 1 and len(sent[0]) == len(dates) - len(miss) and len(A.evaluate("() => window.__ccalls")) >= 1, label + ": the others checked on the copy and sent (%s)" % sent)
        ok(all(x["err"] == nodayrow(fm[miss.index(d)]) for x, d in zip(st, dates) if d in miss), label + ": the held invoice's red note (%s)" % [x["err"] for x in st])
        ok(all(x["err"] == "" for x, d in zip(st, dates) if d not in miss), label + ": no red note on the posted ones")
        n = len(dates) - len(miss)
        ok(t.startswith("%d posted to Tally (%d as Optional vouchers: Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers), %d held: FinCom's copy has no entries for %s." % (n, n, len(miss), ", ".join(fm))),
           label + ": the counts said, the held part after the Optional note (%s)" % t)
    A.evaluate("() => { CO().createOptional = false; }")
    ok(any("tally_days?select=day,at,n,note" in q and "book_id=eq.bk-zz" in q for q in A.evaluate("() => window.__dcalls")), "the days read from FinCom's cloud (tally_days), not from Tally")
    A.evaluate("() => { SL().filter = 'ready'; render(); }"); A.wait_for_timeout(400)
    ok("has no entries for" in A.inner_text("#app"), "the held invoice's red note shown on its row")
    A.evaluate("() => { SL().filter = 'all'; render(); }")
    print("   the days could not be read: nothing posted, said plainly")
    fresh(A, "ZD/5", "ZD/6")
    A.evaluate("() => { window.__held = {to: '2026-11-30', doneTo: '', skipped: [], daysFail: true}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(A.evaluate("() => window.__sent") == [] and last(A) == NOCHECK and [x["st"] for x in st] == ["ready", "ready"], "nothing sent, the plain message (%s)" % last(A))
    print("   all on days not held: nothing sent, the copy not asked")
    fresh(A, "ZD/7", d="2026-11-20")
    A.evaluate("() => { window.__held = {to: '2026-11-10', doneTo: '', skipped: []}; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A)
    ok(A.evaluate("() => window.__sent") == [] and A.evaluate("() => window.__ccalls") == [], "nothing sent, the copy not asked")
    ok(t.startswith("0 posted, 1 held: FinCom's copy has no entries for ") and st[0]["st"] == "ready" and st[0]["err"].startswith("Not posted: FinCom's copy"), "0 posted, 1 held; Ready with its note (%s)" % t)
    print("   the Day Book uploaded for that day: posted next time, the note gone")
    A.evaluate("() => { window.__held = {to: '2026-11-30', doneTo: '', skipped: []}; window.__toasts = []; }")
    A.evaluate("() => postSalesToTally()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE)
    ok(st[0]["st"] == "posted" and st[0]["err"] == "", "posted, no red note (%s)" % st)
    print("   Post one by one: a mixed batch")
    ids = fresh(A, "ZD/8", "ZD/9")
    A.evaluate("(id) => { SL().list.find(v => v.id === id).x.date = '2026-11-20'; }", ids[1])
    A.evaluate("(ids) => ids.forEach(id => { const v = SL().list.find(v => v.id === id); v.status = 'review'; v.refused = {n: 2, said: 'Tally created nothing'}; })", ids)
    A.evaluate("() => { window.__held = {to: '2026-11-10', doneTo: '', skipped: []}; }")
    A.evaluate("() => salesPostOneByOne()"); A.wait_for_timeout(600)
    st = A.evaluate(STATE); t = last(A); rows = A.evaluate("() => SL().oneByOne.rows.map(r => r.word)")
    ok([x["st"] for x in st] == ["posted", "review"] and len(A.evaluate("() => window.__sent")) == 1, "one by one: ZD/8 posted, ZD/9 held (%s)" % st)
    ok(st[1]["err"].startswith("Not posted: FinCom's copy of Tally has no entries for ") and any(r.startswith("Not posted: FinCom's copy") for r in rows), "one by one: the held one's note, on it and its row of the result (%s)" % rows)
    ok(t.startswith("One by one: 1 of 2 posted, 1 held: FinCom's copy has no entries for "), "one by one: the counts said (%s)" % t)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
