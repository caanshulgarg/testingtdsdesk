"""python3 run_ledger_rename_confirm.py - migration 39 (round 10): a ledger renamed in Tally whose saved choices were
carried (tally_ledgers.needs_confirm, before_clean.renamed[]) is shown on the Tally ledgers tab with one line under its
name; an owner sees a Confirm button that calls tally_ledger_rename_confirm(p_book, p_name) and the line goes; staff see
the words only; a cloud without the column (42703) is read as before. The cloud is stubbed in the page.
Round 11 (review nit 8): one line per ledger on the page. FinCom 2.4.0: that line is in Needs you (the simpler ledgers
page), with the owner's Confirm; there is no separate Renamed section.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledger_rename_confirm.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8233), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

NEW, OLD, UNMAP = "Kashi IT Solutions", "Kashi IT Solution", "Old Vendor Ltd"
SETUP = """([NEW, OLD, UNMAP]) => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.id = "c_rn"; c.tallyName = c.name; S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  S.books = {cid: c.id, loading: false, meta: {}, challans: [], alloc: {}, map: {}, ledInfo: {},
    vouchers: [{id: "v1", date: "20260401", type: "Payment", no: "1", party: NEW, ent: [{l: NEW, a: 1000}, {l: "HDFC Bank", a: -1000}]}]};
  S.books.map[NEW] = {n: 1, what: "none"}; S.books.map["HDFC Bank"] = {n: 1, what: "bank"};
  S.account = {me: {role: "owner"}};
  // the cloud: one book, a ledger list with the column, the confirm RPC
  const bk = {book: "bk-aad", from: "2025-04-01", to: "2026-03-31", ledgersAt: "2026-10-02T05:26:00Z", company: "Testing AAD"};
  TCloud.on = () => true; TCloud.st[c.id] = {books: [bk], at: Date.now()}; TCloud.status = async function(x){ return (this.st[x] || {}).books || []; };
  window.__col = true; window.__sel = []; window.__rpc = [];
  window.__rows = [
    {name: NEW, parent: "Sundry Creditors", needs_confirm: true, before_clean: {renamed: [{from: OLD, at: "2026-10-02T05:26:00Z", confirm: true, carried: {items: 1, flow: 1, values: 0, clash: ["map"]}}]}},
    {name: "HDFC Bank", parent: "Bank Accounts", needs_confirm: false, before_clean: null},
    // flagged but not in the books' map: no table row, so the Renamed section is where its line goes
    {name: UNMAP, parent: "Sundry Creditors", needs_confirm: true, before_clean: {renamed: [{from: "Old Vendor", at: "2026-10-02T05:26:00Z", confirm: true, carried: {items: 0, flow: 0, values: 0, clash: []}}]}}];
  TCloud.restAll = async (p) => {
    if (/^tally_ledgers/.test(p)){
      const sel = decodeURIComponent((p.match(/select=([^&]*)/) || [])[1] || ""); window.__sel.push(sel);
      if (!window.__col && /needs_confirm|before_clean/.test(sel)) throw {code: "42703", message: "column tally_ledgers.needs_confirm does not exist"};
      return window.__rows.map(r => { const x = Object.assign({}, r); if (!/needs_confirm/.test(sel)){ delete x.needs_confirm; delete x.before_clean; } return x; });
    }
    return /^tally_groups/.test(p) ? [{name: "Sundry Creditors", parent: "Current Liabilities"}] : [];
  };
  TCloud.rpc = async (fn, args) => { window.__rpc.push([fn, args]); if (fn === "tally_ledger_rename_confirm"){ window.__rows.filter(r => r.name === args.p_name).forEach(r => { r.needs_confirm = false; }); return {ok: true, cleared: 1}; } return []; };
  Cloud.api = async () => [];
  S.booksTab = "ledgers"; S.lmView = "other"; render(); return c.id; }"""
LOAD = "async (cid) => { const r = await Ledgers.load(cid, {force: true}); render(); await new Promise(r => setTimeout(r, 300)); return r; }"

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8233/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(SETUP, [NEW, OLD, UNMAP]); pg.wait_for_timeout(600)
    E = lambda js, *a: pg.evaluate(js, *a)
    r = E(LOAD, cid)
    ok(r.get("ok") and r.get("n") == 3, "the ledger list is read from the stubbed cloud (%s)" % r)
    ok(any("needs_confirm" in s and "before_clean" in s for s in E("window.__sel")), "the REST read asks for needs_confirm and before_clean: %s" % E("window.__sel"))
    # the line under the name, once per rename
    line = pg.locator("#app [data-renamed='%s']" % NEW)
    ok(line.count() >= 1, "a ledger with needs_confirm shows a line (%d)" % line.count())
    txt = line.first.inner_text() if line.count() else ""
    want = "Renamed in Tally from %s on 02-Oct-2026: its saved choices were carried; confirm" % OLD
    ok(want in txt, "the line: " + txt[:200])
    ok("the new name already had a map choice; the new name's stands" in txt, "the clash is said: " + txt[:200])
    # FinCom 2.4.0: every rename to confirm is one line in Needs you, under the ledger's name, with its one action
    ok(pg.locator("#app [data-led-needs] tr[data-need=renamed][data-key='%s'] [data-renamed]" % NEW).count() == 1, "the line sits under the ledger's name in Needs you")
    # review nit 8: one line and one Confirm per ledger on the whole page; the section above only lists ledgers without a row
    ok(line.count() == 1, "a flagged ledger in the map has exactly one line on the page (%d)" % line.count())
    ok(pg.locator("#app button[data-rename-confirm='%s']" % NEW).count() == 1, "and exactly one Confirm button (%d)" % pg.locator("#app button[data-rename-confirm='%s']" % NEW).count())
    ok(pg.locator("#lmTable tr[data-key='%s']" % UNMAP).count() == 0, "a flagged ledger not in the map has no table row")
    ok(pg.locator("#app [data-renamed='%s']" % UNMAP).count() == 1 and pg.locator("#app [data-led-needs] tr[data-key='%s'] [data-renamed='%s']" % (UNMAP, UNMAP)).count() == 1, "it has exactly one line, in Needs you (%d on the page)" % pg.locator("#app [data-renamed='%s']" % UNMAP).count())
    ok(pg.locator("#app [data-renamed='HDFC Bank']").count() == 0, "a ledger not flagged has no line")
    btn = pg.locator("#app [data-led-needs] tr[data-key='%s'] button[data-rename-confirm]" % NEW)
    ok(btn.count() == 1 and btn.first.inner_text().strip() == "Confirm", "an owner sees a Confirm button")
    btn.first.click(); pg.wait_for_timeout(1200)
    calls = [c for c in E("window.__rpc") if c[0] != "tally_unknown_ledger_entries"]   # the page also reads the unknown-ledger list (migration 56)
    ok(calls == [["tally_ledger_rename_confirm", {"p_book": "bk-aad", "p_name": NEW}]], "Confirm calls tally_ledger_rename_confirm with p_book and p_name: %s" % calls)
    ok(pg.locator("#app [data-renamed='%s']" % NEW).count() == 0, "after confirm the list is read again and the line is gone")
    ok(pg.locator("#app [data-renamed='%s']" % UNMAP).count() == 1, "the other ledger's line stays in Needs you")
    # when every flagged ledger has a row, the section is not rendered
    E("() => { window.__rows[0].needs_confirm = true; window.__rows[2].needs_confirm = false; }"); E(LOAD, cid)
    ok(pg.locator("#app [data-renamed='%s']" % NEW).count() == 1 and pg.locator("#app [data-renamed-list]").count() == 0, "one line for it and no separate Renamed section (%d)" % pg.locator("#app [data-renamed-list]").count())
    E("() => { window.__rows[2].needs_confirm = true; }")
    # staff: the words only
    E("() => { window.__rows[0].needs_confirm = true; S.account = {me: {role: 'staff'}}; }"); E(LOAD, cid)
    ok(pg.locator("#app [data-renamed='%s']" % NEW).count() >= 1 and want in pg.locator("#app [data-renamed='%s']" % NEW).first.inner_text(), "staff see the line")
    ok(pg.locator("#app button[data-rename-confirm]").count() == 0, "staff see no Confirm button")
    # a cloud without the column: read as before
    E("() => { window.__col = false; window.__sel = []; Ledgers.hasConfirm = null; S.account = {me: {role: 'owner'}}; }")
    r = E(LOAD, cid)
    sel = E("window.__sel")
    ok(r.get("ok") and r.get("n") == 3, "a cloud without the column: the list is read as before (%s)" % r)
    ok(len(sel) >= 2 and "needs_confirm" in sel[0] and "needs_confirm" not in sel[-1], "42703: read again without the columns: %s" % sel)
    ok(pg.locator("#app [data-renamed]").count() == 0 and pg.locator("#app button[data-rename-confirm]").count() == 0, "no line and no button without the column")
    E("window.__sel = []"); E(LOAD, cid)
    ok(all("needs_confirm" not in s for s in E("window.__sel")), "the column is not asked for again once missing: %s" % E("window.__sel"))
    ok(pg.locator("#lmTable tr[data-key='%s']" % NEW).count() == 1, "the ledgers tab still lists the ledger")
    ok(not errors, "no page errors: " + "; ".join(errors)[:300])
    br.close()
print("\n%d failed" % len(fails) if fails else "\nall ok")
raise SystemExit(1 if fails else 0)
