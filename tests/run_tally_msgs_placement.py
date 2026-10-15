"""python3 run_tally_msgs_placement.py - Tally messages only where they are needed (round 63, 16-Oct-2026; the owner: "Tally
messages only where needed, not on every page").
  Removed when all is well (the books read within 3 days, the client linked and reading), shown when not:
    - Reports, Look up and Letters (FreshBar): no Tally line with fresh books; with books read 5 days ago the one amber
      line ("Books last read from Tally 5 days ago");
    - the Books tabs (MIS here): fresh books, one quiet "Books up to <date>" line, no Tally words; stale, the amber line;
    - the Overview's Tally line: not while linked and reading; shown for a client not linked;
    - Today's "N clients not linked": kept, as one quiet line (not a warning).
  Kept: the top bar's Tally dot, the Tally page's guide, Books > From Tally's link line, Post to Tally's posting line,
  the Clients list's Linked / Not linked chip.
Nothing is removed from the Tally page or the bell, and no figure changes (the held lines stay where they were:
run_held_books.py). FinCom's cloud made up in the page (alerts_seed.SETUP), the books as run_held_books.py has them.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_msgs_placement.py [--shots DIR]"""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
from alerts_seed import dev, SETUP
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the client's books read `mins` minutes ago (FinCom's copy in the cloud and the books in this browser)
BOOKS = """async ([cid, mins]) => {
  await openCompany(cid);
  S.coId = cid; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const at = new Date(Date.now() - mins * 60000).toISOString(), day = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const last = day(new Date(Date.now() - mins * 60000));
  const bk = [{from: "2026-04-01", to: last.slice(0, 4) + "-" + last.slice(4, 6) + "-" + last.slice(6), book: "b1", company: "GARG SHEKHAR & COMPANY", entries: 3, days: 120, ledgersAt: at,
    state: {readAt: at, seen: at, doneTo: last, skipped: []}}];
  TCloud.st[cid] = {at: Date.now() + 3600e3, books: bk};
  const rpc = TCloud.rpc;
  TCloud.rpc = async (fn, a) => { if (fn === "tally_status") return a.p_client === cid ? bk : []; if (fn === "tally_period") return []; if (fn === "tally_monthly") return []; return rpc(fn, a); };
  TCloud.rpcAll = async (fn, a) => (await TCloud.rpc(fn, a)) || [];
  // the Tally computer's last read of the company: the same time (tallyLine's read)
  window.__w.devs.forEach(d => { d.info.beat.companies = [{name: "GARG SHEKHAR & COMPANY", open: true, phase: "live", waiting: 0, lastRead: at}]; d.info.beat.at = new Date().toISOString(); });
  const v = (id, d, type, ent) => ({id, date: d, type, no: id, party: "", narr: "", ent: ent.map(([l, a]) => ({l, a, r: null})), cancel: false, opt: false});
  S.books = {loading: false, cid, map: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"},
    meta: {from: "20260401", to: last, at}, groups: {"Sales": "Sales Accounts", "Rent": "Indirect Expenses", "HDFC Bank": "Bank Accounts"},
    vouchers: [v("s1", "20260501", "Sales", [["HDFC Bank", -50000], ["Sales", 50000]]), v("p1", last, "Payment", [["Rent", -10000], ["HDFC Bank", 10000]])]};
  S.booksTab = "reports"; render();
}"""
TALLY_LINE = ".lk-fresh:not([data-fresh-quiet]), [data-books-stale], [data-books-asof], [data-tally-link-line]"
def main():
    srv = http.server.ThreadingHTTPServer(("localhost", 8463), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8463/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda s: pg.locator(s).count()
        txt = lambda s: E("(s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; }", s)
        lines = lambda: E("(s) => [...document.querySelectorAll('#app ' + s.split(', ').join(', #app '))].map(e => e.getAttribute('class') + ': ' + e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90))", TALLY_LINE)
        def shot(name):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
        def tab(t):
            E("(t) => { S.view = 'company'; S.tab = 'books'; S.booksTab = t; render(); }", t); pg.wait_for_timeout(1200)
        for state, mins in (("fresh", 10), ("stale", 5 * 1440)):
            cid = E(SETUP, [{"devs": [dev(recording=True)], "alerts": [], "gap": None, "lines": []}, "owner"])
            E(BOOKS, [cid, mins]); pg.wait_for_timeout(1500)
            for t, label in (("reports", "Reports"), ("lookup", "Look up"), ("letters", "Letters"), ("mis", "MIS (a Books tab)")):
                tab(t)
                got = lines()
                if state == "fresh":
                    ok(not got, "fresh books: %s shows no Tally line (%s)" % (label, got))
                    if t == "mis": ok(re.match(r"Books up to \d\d-[A-Z][a-z]{2}-\d{4}$", txt("#app [data-books-upto]")), "fresh books: %s: one quiet 'Books up to <date>' (%s)" % (label, txt("#app [data-books-upto]")))
                else:
                    ok(n("#app [data-books-stale]") == 1 and "5 days ago" in txt("#app [data-books-stale]"), "books read 5 days ago: %s shows the one amber line (%s)" % (label, got))
                    if t == "mis": ok(n("#app [data-books-upto]") == 0, "stale books: %s: no quiet line in its place" % label)
                if t == "reports": shot("placement-reports-" + state)
            # the Overview: linked and reading, no Tally line (the top bar's dot says it)
            E("(c) => { S.view = 'company'; S.coId = c; S.tab = 'dash'; S.companies[c].onbHide = true; render(); }", cid); pg.wait_for_timeout(1200)
            ok(n("#app [data-tally-link-line]") == 0, "%s: the Overview has no Tally line while linked and reading (%s)" % (state, lines()))
            ok(n("[data-tally-sign]") == 1, "%s: kept: the top bar's Tally dot" % state)
            if state == "fresh": shot("placement-overview-fresh")
        # the Overview of a client not linked: its line is shown; Today: the quiet not-linked line; Clients: the chip
        nl = E("""() => { const c = newCompany({name: 'NOT LINKED CO', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; c.onbHide = true; return c.id; }""")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", nl); pg.wait_for_timeout(1500)
        ok(E("() => (document.querySelector('#app [data-tally-link-line]') || {}).getAttribute ? document.querySelector('#app [data-tally-link-line]').getAttribute('data-tally-link-line') : ''") == "unlinked",
           "a client not linked: the Overview shows its Tally line (%s)" % lines())
        E("() => navHome('today')"); pg.wait_for_timeout(1200)
        tl = "#app [data-not-linked-line]"
        ok(n(tl) == 1 and n(tl + " .warn-text") == 0 and "client not linked to Tally" in txt(tl), "Today: kept, one quiet line (%s)" % txt(tl))
        E("() => navHome('clients')"); pg.wait_for_timeout(1200)
        ok(n('#app [data-tally-chip-at="clients"]') >= 2, "Clients: kept, the Linked / Not linked chip (%d)" % n('#app [data-tally-chip-at="clients"]'))
        # From Tally keeps its link line; Post to Tally keeps its posting line; the Tally page keeps its guide
        cid = E("() => Object.values(S.companies).find(c => c.name === 'GARG SHEKHAR & COMPANY').id")
        E(BOOKS, [cid, 10]); pg.wait_for_timeout(800); tab("import")
        ok(n("#app [data-tally-link-line]") == 1, "Books > From Tally: kept, its Tally line")
        E("(c) => { S.view = 'company'; S.coId = c; S.tab = 'post'; render(); }", cid); pg.wait_for_timeout(1200)
        ok(n("#app [data-post-line]") >= 1 or n("#app [data-post-problem]") >= 1, "Post to Tally: kept, the posting company and its state (%s)" % txt("#app [data-post-line]"))
        E("() => { S.tallyFocus = ''; navHome('tally'); }"); pg.wait_for_timeout(1500)
        ok(n("#app [data-connect-guide]") == 1 and n("#app [data-pc-line]") >= 1, "the Tally page: kept, everything")
        ok(not errors, "no page errors %s" % errors[:2])
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
