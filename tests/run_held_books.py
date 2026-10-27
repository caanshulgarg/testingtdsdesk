"""python3 run_held_books.py - the owner's finding of 05-Oct-2026: client Testing AAD, Look up, ledger VMS Event Private
Limited, 01-Apr-2026 to 05-Oct-2026, said "Balance from FinCom's copy · books as of 13:59 IST" and "From the books (GARG
SHEKHAR & COMPANY), in step with Tally as of 05-Oct-2026 13:59 IST" while a recorder line of that company was HELD
(tally_recorder_lines.state = 'held', not in the books). Now:
  - Look up (a ledger, the trial balance, Find entries = the day book) and the books' pages (MIS profit and loss, Accounts
    = the balance sheet) never say "in step with Tally" while a line of the client is held; they say "1 entry received
    from Tally is not yet in these books: <held_why>" (the reason when the lines share one, else "see Sync activity"),
    with a link to Sync activity on the held lines;
  - a ledger's view: a held line with no ledgers (no entry body): "1 entry of 05-Oct-2026 waiting; the ledger is not yet
    known, so this balance may be incomplete."; a held line naming the ledger: "1 entry of 05-Oct-2026 for this ledger
    is waiting: <held_why>", on that ledger only;
  - "books as of HH:MM IST" says what the time is: "(the bridge's last read of this company in Tally)";
  - the print of Look up (and of the statements and the MIS pack) and its Excel carry the same lines;
  - no line held: the old "in step with Tally as of ..." returns, and no held words anywhere.
Offline, FinCom's cloud made up in the page (alerts_seed.SETUP) with FinCom's copy of the books stubbed (TCloud.rpc).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_held_books.py
RED (before the change): Look up's answer said "From the books (GARG SHEKHAR & COMPANY), in step with Tally as of ..."
with the line held, and no page said the line was not in the books."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
from alerts_seed import D1, dev, SETUP
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CO = "GARG SHEKHAR & COMPANY"
LED = "VMS Event Private Limited"
WHY = "not found by its type and number (asked 3 times)"
HELD1 = "1 entry received from Tally is not yet in these books: " + WHY
UNKNOWN = "1 entry of 05-Oct-2026 waiting; the ledger is not yet known, so this balance may be incomplete."
KNOWN = "1 entry of 05-Oct-2026 for this ledger is waiting: " + WHY
INSTEP = re.compile(r"in step with Tally", re.I)
ASOF_WHY = "(the bridge's last read of this company in Tally)"
def line(i, state, why, ledgers, no, vdate="2026-10-05"):
    return {"id": i, "client_id": "G", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": CO, "line_id": "L%d" % i, "event": "altered",
            "object_guid": "g-%d" % i, "alter_id": 54000 + i, "vch_type": "Receipt", "vch_no": no, "vch_date": vdate, "saved_at": "ago:9", "received_at": "ago:9",
            "applied_at": None, "state": state, "held_why": why, "ledgers": ledgers}

# FinCom's copy of the books (one book, b1) and the books in this browser: a sale to VMS Event, rent paid, a receipt
BOOKS = """async (cid) => {
  await openCompany(cid);
  S.coId = cid; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  window.__readAt = new Date(Date.now() - 10 * 60000).toISOString();
  const bk = [{from: "2026-04-01", to: "2026-10-05", book: "b1", company: "GARG SHEKHAR & COMPANY", entries: 3, state: {readAt: window.__readAt, seen: window.__readAt, doneTo: "20261005", skipped: []}}];
  TCloud.st[cid] = {at: Date.now() + 3600e3, books: bk};
  const V = [{ledger: "VMS Event Private Limited", parent: "Sundry Debtors", open: 0, closing: -20000},
             {ledger: "HDFC Bank", parent: "Bank Accounts", open: -100000, closing: -120000},
             {ledger: "Sales", parent: "Sales Accounts", open: 0, closing: 50000},
             {ledger: "Rent", parent: "Indirect Expenses", open: 0, closing: -10000},
             {ledger: "Capital Account", parent: "Capital Account", open: 100000, closing: 100000}];
  const api = Cloud.api;
  Cloud.api = async (p) => {
    if (/^tally_balances/.test(p)) return V.map(r => Object.assign({last_day: "2026-10-05"}, r));
    if (/^tally_ledgers/.test(p)) return /deleted_at=not\\.is\\.null/.test(p) ? [] : V.map(r => ({name: r.ledger, parent: r.parent, open: r.open}));
    if (/^tally_groups/.test(p)) return [];
    return api(p); };
  TCloud.restAll = async (u) => Cloud.api(u); TCloud.restPages = async (u) => Cloud.api(u);
  const rpc = TCloud.rpc;
  TCloud.rpc = async (fn, a) => {
    if (fn === "tally_status") return bk;
    if (fn === "tally_ledger"){ const r = V.find(x => x.ledger === a.p_ledger) || {open: 0, closing: 0};
      return {open: r.open, lines: r.ledger === "VMS Event Private Limited" ? [["20260501", "Sales", "S-1", "Sales", "", -50000, "g1"], ["20260701", "Receipt", "R-1", "HDFC Bank", "", 30000, "g3"]] : [],
        company: "GARG SHEKHAR & COMPANY", from: "2026-04-01", to: "2026-10-05"}; }
    if (fn === "tally_period") return V.map(r => ({ledger: r.ledger, parent: r.parent, open: r.open, dr: r.closing < r.open ? r.open - r.closing : 0, cr: r.closing > r.open ? r.closing - r.open : 0}));
    if (fn === "tally_monthly") return [];
    if (fn === "tally_find") return {rows: [["20260501", "Sales", "S-1", "VMS Event Private Limited", "", 50000, "g1", [["VMS Event Private Limited", -50000], ["Sales", 50000]], false]], n: 1, total: 50000, opt: 0};
    if (fn === "tally_balances_on") throw new Error("Could not find the function public.tally_balances_on in the schema cache (PGRST202)");
    return rpc(fn, a); };
  TCloud.rpcAll = async (fn, a) => (await TCloud.rpc(fn, a)) || [];
  const v = (id, d, type, ent) => ({id, date: d, type, no: id, party: "", narr: "", ent: ent.map(([l, a]) => ({l, a, r: null})), cancel: false, opt: false});
  S.books = {loading: false, cid, map: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"},
    meta: {from: "20260401", to: "20261005", at: window.__readAt},
    groups: {"Sales": "Sales Accounts", "VMS Event Private Limited": "Sundry Debtors", "Rent": "Indirect Expenses", "HDFC Bank": "Bank Accounts", "Capital Account": "Capital Account"},
    tb: {src: "copy", from: "20260401", to: "20270331", at: window.__readAt, led: {"HDFC Bank": {open: -100000}, "Capital Account": {open: 100000}}},
    vouchers: [v("s1", "20260501", "Sales", [["VMS Event Private Limited", -50000], ["Sales", 50000]]), v("p1", "20260601", "Payment", [["Rent", -10000], ["HDFC Bank", 10000]]),
               v("r1", "20260701", "Receipt", [["HDFC Bank", -30000], ["VMS Event Private Limited", 30000]])]};
  MIS.run("20260401", "20261005");
  window.__printed = []; printView = (t, h) => { window.__printed.push([t, h]); };
  window.__xl = []; FC.excel = async (n, sheets) => { window.__xl.push([n, sheets]); };
  S.booksTab = "lookup"; render();
}"""
LOOK = """async ([kind, led]) => { S.view = "company"; S.tab = "books"; S.booksTab = "lookup"; const x = LK.st();
  Object.assign(x, {kind, led: led || "", from: "20260401", to: "20261005", asOn: "20261005", q: "", typ: "", src: ""}); x.res = null; render();
  await LK.run("auto"); render(); return {src: x.res && x.res.src, note: LK.noteOf ? LK.noteOf(x.res) : (x.res && x.res.note) || "", line: x.res && x.res.line}; }"""
srv = http.server.ThreadingHTTPServer(("localhost", 8381), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8381/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda s: (E("(s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; }", s))
    alltxt = lambda s: E("(s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\\s+/g, ' ').trim())", s)
    app = lambda: pg.inner_text("#app")
    # a line held with no ledgers (no entry body): the ledger is not known
    cid = E(SETUP, [{"devs": [dev(recording=True)], "alerts": [], "gap": None, "lines": [line(701, "held", WHY, [], "R-9")]}, "owner"])
    E(BOOKS, cid); pg.wait_for_timeout(300)
    E("() => { AlertHub.refresh(true); }"); pg.wait_for_timeout(1200)
    ok(E("typeof booksHeld === 'function' && !!booksHeld(S.coId)"), "the held line is known to the app (AlertHub)")

    # ---- 1. Look up, the ledger: the answer's header
    r = E(LOOK, ["ledger", LED]); pg.wait_for_timeout(500)
    ans = txt("#app .lk-res")
    ok(r["src"] == "cloud" and not INSTEP.search(ans) and not INSTEP.search(r["note"] or ""), "1. Look up, %s: no 'in step with Tally' on the answer (%s)" % (LED, r["note"]))
    ok(r["note"] == "From the books (%s)." % CO, "1. the note says where the figures come from, nothing more (%s)" % r["note"])
    held = txt('#app .lk-res [data-books-held] [data-books-held-text]')
    ok(held.startswith(HELD1), "1. the answer says '%s' (%s)" % (HELD1, held))
    ok(alltxt('#app .lk-res [data-books-held-led="unknown"]') == [UNKNOWN] and alltxt('#app .lk-res [data-books-held-led="known"]') == [], "2. the ledger is not known: '%s' (%s)" % (UNKNOWN, alltxt('#app .lk-res [data-books-held-led]')))
    hm = E("tallyHm(window.__readAt)")
    ok(r["line"] == "Balance from FinCom's copy · books as of %s %s" % (hm, ASOF_WHY) and txt("#app .lk-res [data-copy-line]") == r["line"], "3. the header: 'books as of %s %s' (%s)" % (hm, ASOF_WHY, r["line"]))
    ok(E("booksAsOf(S.coId).text") == "Books as of %s %s" % (hm, ASOF_WHY) and ("Books as of %s %s" % (hm, ASOF_WHY)) in app(), "3. 'Books as of' on the page says what the time is (%s)" % E("booksAsOf(S.coId).text"))
    ok(not INSTEP.search(app()) and len(alltxt("#app [data-books-held]")) == 1, "1. Look up page: no 'in step with Tally' anywhere; the held line once (%d)" % len(alltxt("#app [data-books-held]")))
    # ---- 4. print and Excel of the ledger
    E("() => lkAct('print')"); E("() => lkAct('excel')"); pg.wait_for_timeout(300)
    pr = E("window.__printed.length ? window.__printed[window.__printed.length - 1][1] : ''")
    ok(HELD1 in pr and UNKNOWN in pr and not INSTEP.search(pr), "4. the printed ledger carries the held lines and no 'in step'")
    xl = E("window.__xl.length ? window.__xl[window.__xl.length - 1][1][0][1] : []")
    ok(xl[:2] == [[HELD1], [UNKNOWN]], "4. the Excel ledger: the held lines first (%s)" % xl[:2])
    # the link: Sync activity on the held lines
    pg.click("#app .lk-res [data-books-held-link]"); pg.wait_for_timeout(1500)
    ok(E("S.tallyTab") == "activity" and E("S.syncClient") == cid and E("S.syncFilter") == "held", "1. the link opens Sync activity for the client on the held lines")
    ok(E("document.querySelector('[data-sync-filter=\"held\"]') && document.querySelector('[data-sync-filter=\"held\"]').getAttribute('aria-selected')") == "true"
       and pg.locator('#app [data-sync-line="701"]').count() == 1, "1. Sync activity: the Held filter chosen, the held line listed")
    E("() => { S.syncFilter = 'all'; }")

    # ---- 1. the trial balance, the day book (Find entries)
    E("([cid]) => { S.view = 'company'; S.coId = cid; S.tab = 'books'; }", [cid])
    r = E(LOOK, ["tb", ""]); pg.wait_for_timeout(500)
    ans = txt("#app .lk-res")
    ok(r["src"] == "cloud" and not INSTEP.search(ans) and txt("#app .lk-res [data-books-held-text]").startswith(HELD1) and not alltxt("#app .lk-res [data-books-held-led]"),
       "1. Trial balance: the held line, no 'in step', no ledger's lines (%s)" % r["note"])
    E("() => lkAct('print')"); pg.wait_for_timeout(200)
    ok(HELD1 in E("window.__printed[window.__printed.length - 1][1]"), "4. the printed trial balance carries the held line")
    r = E(LOOK, ["find", ""]); pg.wait_for_timeout(500)
    ok(r["src"] == "cloud" and not INSTEP.search(app()) and txt("#app .lk-res [data-books-held-text]").startswith(HELD1), "1. Day Book (Find entries): the held line, no 'in step'")
    # ---- 1. P&L (MIS) and the balance sheet (Accounts)
    E("() => { S.booksTab = 'mis'; S.misTab = 'pl'; render(); }"); pg.wait_for_timeout(700)
    ok(txt("#app [data-books-held-text]").startswith(HELD1) and not INSTEP.search(app()) and "Revenue from operations" in app(), "1. Profit and loss (MIS): the held line, no 'in step'")
    E("() => doAct('misPack')"); pg.wait_for_timeout(200)
    ok(HELD1 in E("window.__printed[window.__printed.length - 1][1]"), "4. the MIS pack (PDF) carries the held line")
    E("() => { S.booksTab = 'fs'; S.fsTab = 'st'; render(); }"); pg.wait_for_timeout(1500)
    ok(txt("#app [data-books-held-text]").startswith(HELD1) and not INSTEP.search(app()) and E("!!(S.fsRun && S.fsRun.d && !S.fsRun.d.error)"), "1. Balance sheet (Accounts): the held line, no 'in step', the statements worked out")
    E("() => doAct('fsPdf')"); pg.wait_for_timeout(200)
    ok(HELD1 in E("window.__printed[window.__printed.length - 1][1]"), "4. the statements' PDF carries the held line")
    # the statements' Excel and the MIS Excel: the held line first on the Balance Sheet, Profit and Loss sheets (XLSX stubbed)
    xs = E("""async () => { const got = {}; ensureXlsx = async () => {}; saveFile = () => {};
      window.XLSX = {utils: {book_new: () => ({}), aoa_to_sheet: (rows) => rows, book_append_sheet: (wb, rows, n) => { got[n] = rows; }}, write: () => new Uint8Array(1)};
      await fsExcel(S.fsRun.d); await misExcel(S.books.mis.last);
      return [got["Balance Sheet"][0], got["Profit and Loss"][0], got["Profit and loss"][0]]; }""")
    ok(xs == [[HELD1]] * 3, "4. Excel of the statements (Balance Sheet, Profit and Loss) and of the MIS: the held line first (%s)" % xs)
    E("() => { S.booksTab = 'reports'; render(); }"); pg.wait_for_timeout(700)
    ok(txt("#app [data-books-held-text]").startswith(HELD1) and not INSTEP.search(app()), "1. Reports: the held line, no 'in step'")

    # ---- 2. the line's ledgers known: only on that ledger
    E("""() => { window.__w.lines = window.__w.lines.map(l => Object.assign(l, {ledgers: [{name: "VMS Event Private Limited", guid: "lg-1"}, {name: "HDFC Bank", guid: "lg-2"}]}));
      Rec.act.at = 0; Rec.actLoad(); AlertHub.refresh(true); }"""); pg.wait_for_timeout(1500)
    E(LOOK, ["ledger", LED]); pg.wait_for_timeout(500)
    ok(alltxt('#app .lk-res [data-books-held-led]') == [KNOWN], "2. the ledger's line known: '%s' (%s)" % (KNOWN, alltxt('#app .lk-res [data-books-held-led]')))
    E(LOOK, ["ledger", "Rent"]); pg.wait_for_timeout(500)
    ok(alltxt('#app .lk-res [data-books-held-led]') == [] and txt("#app .lk-res [data-books-held-text]").startswith(HELD1), "2. another ledger (Rent): the book's held line only, no ledger's line")
    # two lines held for different reasons: "see Sync activity"
    E("""() => { window.__w.lines.push(Object.assign(JSON.parse(JSON.stringify(window.__w.lines[0])), {id: 702, line_id: "L702", vch_no: "R-10", held_why: "month locked (Sep-2026)", ledgers: []}));
      Rec.act.at = 0; Rec.actLoad(); AlertHub.refresh(true); }"""); pg.wait_for_timeout(1500)
    E(LOOK, ["ledger", LED]); pg.wait_for_timeout(500)
    ok(txt("#app .lk-res [data-books-held-text]") == "2 entries received from Tally are not yet in these books: see Sync activity", "1. two lines, two reasons: '... see Sync activity' (%s)" % txt("#app .lk-res [data-books-held-text]"))
    ok(alltxt('#app .lk-res [data-books-held-led]') == [KNOWN, UNKNOWN], "2. the ledger: its own line, and the line whose ledger is not known (%s)" % alltxt('#app .lk-res [data-books-held-led]'))

    # ---- no line held: the old words return
    E("() => { window.__w.lines = window.__w.lines.map(l => Object.assign(l, {state: 'applied', held_why: null, applied_at: new Date().toISOString()})); Rec.act.at = 0; Rec.actLoad(); AlertHub.refresh(true); }")
    pg.wait_for_timeout(1500)
    r = E(LOOK, ["ledger", LED]); pg.wait_for_timeout(500)
    ok(E("typeof booksHeld === 'function' ? booksHeld(S.coId) : null") is None and r["note"].startswith("From the books (%s), in step with Tally as of " % CO) and r["note"] in txt("#app .lk-res"),
       "no line held: 'From the books (%s), in step with Tally as of ...' again (%s)" % (CO, r["note"]))
    ok(pg.locator("#app [data-books-held]").count() == 0, "no line held: no held words on the page")
    E("() => lkAct('print')"); pg.wait_for_timeout(200)
    pr = E("window.__printed[window.__printed.length - 1][1]")
    ok("not yet in these books" not in pr and "data-held-print" not in pr, "no line held: the print has no held line")
    E("() => { S.booksTab = 'fs'; render(); }"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-books-held]").count() == 0, "no line held: Accounts has no held line")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
