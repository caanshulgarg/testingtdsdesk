"""python3 run_trash_server.py - removals kept on the server (request of 02-Oct-2026): removing the books, Tally data and
all GST work, or a bank statement goes to client_trash with who, when and why, and another computer of the firm puts it
back; the browser keeps a copy as an extra and is the only copy while the server table is not there.
Two browser contexts are two computers; a stand-in for the server (client_trash, trash_put, trash_restore) is shared
by both. Offline, made-up client (no client data needed).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_trash_server.py"""
import json, os, threading, functools, http.server, uuid, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8191), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the stand-in server: what migration-17-trash.sql does, for one firm
TRASH, STATE = [], {"missing": False}
def server(path, opts, who):
    o = json.loads(opts or "{}"); body = o.get("body") or {}
    if STATE["missing"]: return json.dumps({"__err": "Could not find the function public.trash_put (PGRST202)"})
    now = datetime.datetime.utcnow().isoformat() + "Z"
    if path == "rpc/trash_put":
        r = {"id": str(uuid.uuid4()), "client_id": body["p_client"], "kind": body["p_kind"], "label": body["p_label"], "reason": body["p_reason"], "data": body["p_data"],
             "deleted_at": now, "deleted_by_email": who, "restored_at": None, "restored_by_email": None}
        TRASH.append(r); return json.dumps(r["id"])
    if path == "rpc/trash_restore":
        r = next((x for x in TRASH if x["id"] == body["p_id"]), None)
        if not r: return json.dumps({"__err": "nothing kept with that id"})
        if r["restored_at"]: return json.dumps({"__err": "already restored"})
        r["restored_at"] = now; r["restored_by_email"] = who
        return json.dumps({"id": r["id"], "kind": r["kind"], "label": r["label"], "data": r["data"]})
    if path.startswith("client_trash?"):
        cid = path.split("client_id=eq.")[1].split("&")[0]
        rows = [{k: x[k] for k in ("id", "kind", "label", "reason", "deleted_at", "deleted_by_email", "restored_at")} for x in TRASH if x["client_id"] == cid and not x["restored_at"]]
        return json.dumps(sorted(rows, key=lambda x: x["deleted_at"], reverse=True))
    return json.dumps(None)

CID = "co_trash_test"
SETUP = """(cid) => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.id = cid; c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = cid; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const vouchers = Array.from({length: 12}, (_, i) => ({id: "v" + i, date: "202504" + String(1 + i).padStart(2, "0"), type: i % 2 ? "Sales" : "Purchase", no: "N" + i, party: "P" + i,
    ent: [{l: "P" + i, a: -1000 - i}, {l: i % 2 ? "Sales" : "Purchases", a: 1000 + i}]}));
  S.books = {loading: false, challans: [], alloc: {}, cid, vouchers, meta: {from: "20250401", to: "20250412"}, twoB: {"202504": {b2b: [{ctin: "09AAACX1234A1Z5"}]}}, gstins: {}};
  S.books.map = Books.mapLedgers(vouchers, {}); window.__bk = S.books; S.booksTab = "import";
  // this computer is signed in to the firm: the trash goes to the (stand-in) server
  Trash.cloud = () => !Trash.off;
  const real = Cloud.api.bind(Cloud);
  Cloud.api = async (path, opts) => {
    if (!/^(rpc\\/trash_|client_trash\\?)/.test(path)) return real(path, opts);
    const j = JSON.parse(await window.srv(path, JSON.stringify(opts || {})));
    if (j && j.__err) throw new Error(j.__err);
    return j;
  };
  render(); }"""
BANK = """() => {
  const b = B(); const rows = Array.from({length: 6}, (_, i) => ({id: "r" + i, fp: "fp" + i, date: "2025-04-0" + (1 + i), debit: 100 * (i + 1), credit: 0, bal: 0, narr: "NEFT " + i, dec: {}, ledger: "Rent", state: "ready", balOk: true, why: []}));
  Object.assign(b, {loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", fileName: "apr.csv", n: 6, from: "2025-04-01", to: "2025-04-30", opening: 0, closing: 0}], cur: "s1", rows,
    keys: {fp0: "s1", fp1: "s1"}, sel: new Set(), sticky: new Set(), undo: null});
  return BankDB.set("stmt:" + b.cid + ":s1", rows); }"""

def computer(br, who):
    ctx = br.new_context(viewport={"width": 1440, "height": 950})
    ctx.expose_function("srv", lambda path, opts: server(path, opts, who))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(who + ": " + str(e)))
    pg.goto("http://localhost:8191/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate(SETUP, CID); pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    return pg

def more(pg, sel='#app [data-more="books"]'):
    pg.evaluate("render()"); pg.wait_for_timeout(800)
    pg.evaluate("document.querySelector('%s').open = true" % sel.replace("'", "\\'")); pg.wait_for_timeout(200)

def confirm(pg, why):
    pg.fill("#cbxWhy", why); pg.fill("#cbxName", "Testing AAD"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)

with sync_playwright() as p:
    br = p.chromium.launch()
    a = computer(br, "asha@firm.test")
    # 1. the books removed on computer A, with a reason: on the server with who, when and why
    more(a); a.click('#app [data-more="books"] button:has-text("Remove what is here")'); pg = a; pg.wait_for_timeout(300)
    ok(a.locator("#cbxWhy").count() == 1, "the confirmation asks for a reason, with the client's name")
    confirm(a, "read again from Tally")
    row = TRASH[-1] if TRASH else {}
    ok(a.evaluate("S.books.vouchers.length") == 0 and row.get("kind") == "books" and row.get("reason") == "read again from Tally" and row.get("deleted_by_email") == "asha@firm.test"
       and len((row.get("data") or {}).get("vouchers") or []) == 12, "1. removed on A: kept on the server with who, when and why (12 entries)")
    local = a.evaluate("(cid) => IDBStore.prefix('trash:' + cid + ':').then(l => l.map(x => x[1]))", CID)
    ok(len(local) == 1 and local[0].get("sid") == row.get("id"), "1. A's browser keeps a copy as an extra, tied to the server's row")
    ok(a.evaluate("S.books.trashLog.slice(-1)[0].server") is True, "1. the books' own log says the server has it")

    # 2. computer B (its own browser, nothing kept there) sees it and puts it back
    b = computer(br, "ravi@firm.test")
    b.evaluate("S.books.vouchers = []; window.__bk = S.books; render()"); b.wait_for_timeout(300)
    more(b)
    txt = b.inner_text('#app [data-more="books"]')
    ok("Restore" in txt and "asha@firm.test" in txt and "read again from Tally" in txt, "2. B's More menu: Restore, with who removed it and why")
    b.click('#app [data-more="books"] button[data-restore]'); b.wait_for_timeout(1500)
    ok(b.evaluate("S.books.vouchers.length") == 12, "2. B restores the books from the server (12 entries)")
    ok(row.get("restored_at") and row.get("restored_by_email") == "ravi@firm.test", "2. the server marks it restored, by whom (the row is not deleted)")
    ok(len(TRASH) == 1, "2. the server keeps the row")
    n = a.evaluate("(cid) => Trash.list(cid).then(l => l.length)", CID)
    ok(n == 0, "2. A no longer offers it (restored elsewhere), its own copy not offered twice")

    # 3. Tally data and all GST work, removed on B, put back on A
    more(b); b.click('#app [data-more="books"] button:has-text("Remove Tally data")'); b.wait_for_timeout(300); confirm(b, "start again")
    w = TRASH[-1]
    ok(w["kind"] == "wipe" and w["reason"] == "start again" and "twoB" in (w["data"] or {}) and b.evaluate("!S.books.twoB || !Object.keys(S.books.twoB).length"), "3. Tally data and GST work: on the server with the 2B copies")
    a.evaluate("S.books.vouchers = []; S.books.twoB = {}; window.__bk = S.books; render()")
    more(a); a.click('#app [data-more="books"] button[data-restore]'); a.wait_for_timeout(1500)
    ok(a.evaluate("S.books.vouchers.length") == 12 and a.evaluate("Object.keys(S.books.twoB || {}).length") == 1, "3. A puts them back from the server: the entries and the 2B")

    # 4. a bank statement with its rows, deleted on A, restored on B with its rows
    for pg_ in (a, b):
        pg_.evaluate("S.tab = 'bank'; render()"); pg_.wait_for_timeout(600)
    a.evaluate(BANK); a.wait_for_timeout(300)
    a.evaluate("() => { deleteStatement('s1'); }"); a.wait_for_timeout(400); confirm(a, "wrong account")
    st = TRASH[-1]
    ok(st["kind"] == "statement" and st["reason"] == "wrong account" and len(st["data"]["rows"]) == 6 and a.evaluate("B().stmts.length") == 0, "4. a statement deleted on A: on the server with its 6 rows")
    b.evaluate("const b = B(); b.loading = false; b.stmts = []; b.cur = null; b.rows = []; b.keys = {}; b.stmtsTrash = null; render()"); b.wait_for_timeout(1200)
    b.evaluate("render()"); b.wait_for_timeout(300)
    ok("wrong account" in b.evaluate("Array.from(document.querySelectorAll('details.bk-menu button')).map(x => x.textContent).join(' | ')"), "4. B's bank More menu offers it, with the reason")
    b.evaluate("restoreStatement(0)"); b.wait_for_timeout(1500)
    ok(b.evaluate("B().stmts.map(s => s.id).join()") == "s1" and b.evaluate("(B().rows || []).length") == 6, "4. B restores the statement with its 6 rows")

    # 5. no server table yet: kept in this browser, and it says so
    STATE["missing"] = True
    a.evaluate("S.tab = 'books'; S.booksTab = 'import'; S.books = window.__bk = Object.assign(S.books, {vouchers: S.books.vouchers.length ? S.books.vouchers : [{id: 'x', date: '20250401', type: 'Sales', ent: []}]}); render()")
    more(a); a.click('#app [data-more="books"] button:has-text("Remove what is here")'); a.wait_for_timeout(300); confirm(a, "offline test")
    ok(a.evaluate("Trash.off") is True and a.evaluate("S.books.trashLog.slice(-1)[0].server") is False, "5. no server table: kept in this browser only")
    more(a)
    ok("kept in this browser only" in a.inner_text('#app [data-more="books"]'), "5. and the Restore item says so")
    a.click('#app [data-more="books"] button[data-restore]'); a.wait_for_timeout(1200)
    ok(a.evaluate("S.books.vouchers.length") > 0, "5. restored from this browser's copy")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
