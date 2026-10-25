"""python3 run_upload_pages.py - the upload-and-review pages, Purchase, Bank and Sales, in one pattern (upload-pages,
14-Oct-2026). The owner pasted Purchase as staging showed it: "3 entries need review … To review 0 / Post to Tally 0 / 3
/ In Tally 12 / Duplicates 2 / Deleted 3 / Review 0 uploaded bills / Testing AAD · tick the ones to book TDS on" and
said: "UI to upload bills, bank, sales is very wrong.. it should be proper." Checked, on his books (upload_pages_books.py):
  1. one row of states in the same words on every page, each with one count and its name (no unlabelled number), no
     "need review" over "To review 0", no "Needs you", no row of the client's pages, the guide a "?" at the row's end;
  2. every count on the row is the number of rows its table lists, for every state of every page;
  3. empty states: what is so and one next step; no TDS instruction and no bar of greyed buttons with nothing to review;
  4. an upload going on: "Reading 3 of 5…" inline; a file not read is a row with its reason and Retry, which reads it again;
  5. on a phone: the row of states fits (it scrolls inside itself), the page does not scroll sideways.
Offline, made-up books, the React test build: TDSDESK_SITE=../app/dist-test python3 run_upload_pages.py"""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import upload_pages_books as BK
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8293), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the row of states: [[state, words, count, the button's whole text]]
STATES = """() => [...document.querySelectorAll('#app nav.statebar [data-state]')].map(b => [b.getAttribute('data-state'), b.textContent.replace(/\\s*\\d+\\s*$/, '').trim(),
  Number((b.querySelector('[data-state-n]') || {}).textContent), b.textContent.trim(), b.getAttribute('aria-selected') === 'true'])"""
# the rows the table of the open state lists
ROWS = {
    "bills": """(st) => { const q = (s) => document.querySelectorAll(s).length;
      if (st === 'review') return q('#app table.revtbl tbody tr:not(.lt-open)');
      if (st === 'ready') return q('#app [data-post-panel="topost"] [data-post-row]');
      if (st === 'errors') return q('#app [data-post-panel="errors"] li[data-entry-row]') + q('#app [data-post-panel="errors"] li[data-attn-row]');
      if (st === 'intally') return q('#app [data-post-panel="posted"] li[data-entry-row]');
      return q('#app ul.queue > li'); }""",
    "bank": """() => document.querySelectorAll('#app table.bk-table[data-list="bank"] tbody tr:not(.lt-open)').length""",
    "sales": """() => document.querySelectorAll('#app table[data-list="sales"] tbody tr:not(.lt-open)').length""",
}
TOP = lambda pg: pg.inner_text("#cobar").replace("\n", " ")

def counts_match_rows(pg, page):
    out = []
    for st, words, n, _, _ in pg.evaluate(STATES):
        pg.click('#app nav.statebar [data-state="%s"]' % st); pg.wait_for_timeout(700)
        now = [x for x in pg.evaluate(STATES) if x[0] == st]
        rows = pg.evaluate(ROWS[page], st)
        out.append((st, now[0][2] if now else None, rows, bool(now and now[0][4])))
    return out

def start(p, w, h):
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8293/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    return br, pg

with sync_playwright() as p:
    br, pg = start(p, 1440, 900)
    E = lambda js, *a: pg.evaluate(js, *a)
    E(BK.PURCHASE); pg.wait_for_timeout(1500)
    # ---- 1. the owner's Purchase: one row of states, one count each, in the same words
    st = E(STATES)
    ok([x[1] for x in st] == ["To review", "Ready to post", "Errors", "In Tally", "Duplicates", "Deleted"],
       "Purchase: To review · Ready to post · Errors · In Tally · Duplicates · Deleted (%s)" % [x[3] for x in st])
    ok([x[2] for x in st] == [0, 0, 3, 12, 2, 3], "the owner's counts: 0 to review, 0 ready, 3 errors, 12 in Tally, 2 duplicates, 3 deleted (%s)" % [x[2] for x in st])
    ok(all(re.fullmatch(r"[A-Za-z ]+ \d+", x[3]) for x in st) and E("document.querySelectorAll('#app nav.statebar .sbar-n').length") == len(st),
       "every number on the row has its name beside it (no unlabelled badge)")
    sbs = E("document.querySelectorAll('#app nav.sbar[aria-label=\"Status\"]').length")
    ok(sbs == 1, "one row of states on the page (%d)" % sbs)
    top, page = TOP(pg), pg.inner_text("#app")
    ok(not re.search(r"need(s)? review|Tally error", top), "the top bar does not count Tally's errors again (%s)" % top[:160])
    ok("Needs you" not in page and "Needs you" not in top.replace("Tally", ""), "no “Needs you” beside To review")
    ok(not re.search(r"Review \d+ uploaded bill", page) and "tick the ones to book TDS" not in page and E("document.querySelectorAll('#app [data-rev-how]').length") == 0,
       "nothing to review: no “Review 0 uploaded bills”, no TDS instruction")
    ok(E("!!document.querySelector('#app [data-empty-next]')") and "No bills to review" in pg.inner_text("#app [data-empty-next]")
       and E("document.querySelectorAll('#app [data-empty-next] button').length") == 1 and pg.inner_text("#app [data-empty-next] button") == "Upload bills",
       "the empty state: “No bills to review” and one next step, Upload bills")
    ok(E("document.querySelectorAll('#app .actionbar').length") == 0, "no bar of greyed buttons with nothing to review")
    ok(E("document.querySelectorAll('#app [data-queue-done]').length") == 0, "no “Post N to Tally” over Ready to post 0 (the approved bills Tally refused are under Errors)")
    ok(E("document.querySelectorAll('#cobar .help-btn').length") == 0 and E("document.querySelectorAll('#app nav.statebar .help-btn').length") == 1
       and E("(() => { const b = [...document.querySelectorAll('#app nav.statebar button')]; return b[b.length - 1].classList.contains('help-btn'); })()"),
       "the guide is a “?” at the end of the row of states, not at the top")
    ok(E("document.querySelectorAll('#cobar [data-credit]').length") == 0 and "credit" not in top, "no firm credit chip on a client's page (%s)" % top[:120])
    ok(E("document.querySelectorAll('#app [data-client-tabs], #app nav[aria-label=\"Client\"]').length") == 0, "no row of the client's pages")
    ok(E("document.querySelectorAll('#cobar [data-upload]').length") == 1 and pg.inner_text("#cobar [data-upload]") == "Upload bills"
       and "primary" in (pg.get_attribute("#cobar [data-upload]", "class") or ""), "one primary action: Upload bills")
    # ---- 2. every count is its table's rows
    E(BK.READY); pg.wait_for_timeout(600)
    E(BK.DRAFTS); pg.wait_for_timeout(900)
    res = counts_match_rows(pg, "bills")
    ok(all(n == r and on for _, n, r, on in res) and len(res) == 6, "Purchase: each state's count is the rows of its table, and it opens (%s)" % res)
    ok(dict((s, n) for s, n, _, _ in res).get("review") == 5 and dict((s, n) for s, n, _, _ in res).get("ready") == 2, "5 to review, 2 ready to post (%s)" % res)
    E("() => { Object.values(D().entries).filter(e => e.status === 'draft').forEach(e => { e.status = 'deleted'; }); refreshStats(S.coId); goStep('review', 'bills'); }"); W = pg.wait_for_timeout; W(600)
    ok("Post 2 to Tally" in (pg.inner_text("#app [data-queue-done]") if E("!!document.querySelector('#app [data-queue-done]')") else ""), "every bill reviewed: “Post 2 to Tally”, the Ready to post count")
    E("() => { Object.values(D().entries).filter(e => /^v[1-5]$/.test(e.id)).forEach(e => { e.status = 'draft'; }); refreshStats(S.coId); goStep('review', 'bills'); }"); W(600)
    pg.click('#app nav.statebar [data-state="review"]'); pg.wait_for_timeout(600)
    ok(E("document.querySelectorAll('#app [data-rev-how]').length") == 1 and "Book TDS" in pg.inner_text("#app [data-rev-how]"), "with bills to review: the TDS instruction, one line")
    bar = pg.inner_text("#app .actionbar") if E("!!document.querySelector('#app .actionbar')") else ""
    ok(not re.search(r"\b\d+ to review", bar), "the bar at the foot does not count the bills to review again (%s)" % bar.replace("\n", " ")[:120])
    # ---- 4. an upload going on, and a file not read
    E(BK.UPLOADING); pg.wait_for_timeout(500)
    # five files: two read, one not read, one being read (the fourth), one waiting
    ok(pg.inner_text("#app [data-upload-progress]") == "Reading 4 of 5…", "upload progress inline: “Reading 4 of 5…” (%s)" % (pg.inner_text("#app [data-upload-progress]") if E("!!document.querySelector('#app [data-upload-progress]')") else "none"))
    ok(E("document.querySelectorAll('#app .busycard').length") == 0, "said once (no second reading card)")
    f = '#app [data-upload-failed] [data-failed-file="bill-5.jpg"]'
    ok(pg.locator(f).count() == 1 and "not a PDF or a photo" in pg.inner_text(f + " [data-failed-why]") and pg.locator(f + " [data-retry-read]").count() == 1,
       "a file not read: a row with its reason and Retry")
    E("() => { window.__pumped = 0; window.pump = () => { window.__pumped++; }; }")
    pg.click(f + " [data-retry-read]"); pg.wait_for_timeout(400)
    ok(E("S.jobs.find(j => j.name === 'bill-5.jpg').status") == "waiting" and E("window.__pumped") >= 1 and pg.locator(f).count() == 0,
       "Retry reads it again (waiting its turn), and the row goes")
    E("() => { S.jobs = []; render(); }"); pg.wait_for_timeout(300)
    # ---- Bank
    E(BK.BANK); pg.wait_for_timeout(1200)
    st = E(STATES)
    # (the owner, 24-Oct-2026, a76743c59: the bank page has its own words, To do · Ready to post · Posted · Ignored, Ignored
    # always shown; Purchase and Sales keep the shared ones)
    BANK_WORDS = ["To do", "Ready to post", "Posted", "Ignored"]
    ok([x[1] for x in st] == BANK_WORDS, "Bank: its own words, To do · Ready to post · Posted · Ignored (%s)" % [x[3] for x in st])
    ok(E("document.querySelectorAll('#app .bk-tabs').length") == 0, "Bank: no row of tabs of its own")
    res = counts_match_rows(pg, "bank")
    ok(all(n == r and on for _, n, r, on in res), "Bank: each state's count is the rows of its table (%s)" % res)
    E("() => { bankRowAct('ignore', 'r3'); }"); pg.wait_for_timeout(500)
    st = E(STATES)
    ok([x[1] for x in st] == BANK_WORDS and dict((x[1], x[2]) for x in st)["Ignored"] == 1, "Bank: a line ignored is under Ignored, not Posted (%s)" % [x[3] for x in st])
    res = counts_match_rows(pg, "bank")
    ok(all(n == r for _, n, r, _ in res) and dict((s, n) for s, n, _, _ in res).get("ignored") == 1, "Bank: Ignored 1, its one row (%s)" % res)
    bar = pg.inner_text("#app .actionbar").replace("\n", " ")
    ok(not re.search(r"\b\d+ (to do|to review|ready to post)\b", bar), "Bank: the bar at the foot does not count the states again (%s)" % bar[:140])
    E(BK.BANK_EMPTY); pg.wait_for_timeout(600)
    ok(E("document.querySelectorAll('#app nav.statebar [data-state]').length") == 0 and "No bank statement yet" in pg.inner_text("#app"), "Bank, empty: no row of noughts, “No bank statement yet”")
    # ---- Sales
    E(BK.SALES); pg.wait_for_timeout(1200)
    st = E(STATES)
    ok([x[1] for x in st] == ["To review", "Ready to post", "In Tally", "Ignored"] and [x[2] for x in st] == [2, 2, 2, 1], "Sales: the same words, 2 · 2 · 2 · 1 (%s)" % [x[3] for x in st])
    ok(E("document.querySelectorAll('#app [data-sales-tabs]').length") == 0, "Sales: no row of tabs of its own")
    res = counts_match_rows(pg, "sales")
    ok(all(n == r and on for _, n, r, on in res), "Sales: each state's count is the rows of its table (%s)" % res)
    E(BK.SALES_EMPTY); pg.wait_for_timeout(600)
    ok(E("document.querySelectorAll('#app nav.statebar [data-state]').length") == 0 and "No sales invoices yet" in pg.inner_text("#app"), "Sales, empty: no row of noughts, “No sales invoices yet”")
    # ---- the top bar on another client page still says Tally's errors, in the same word
    E("() => goClient('dash')"); pg.wait_for_timeout(800)
    n = E("postTabCounts(S.coId).errors")
    ok(n > 0 and re.search(r"\b%d Tally errors\b" % n, TOP(pg)) is not None, "elsewhere the top bar's link counts the same errors, in the same word: “%d Tally errors” (%s)" % (n, TOP(pg)[:160]))
    br.close()
    # ---- 4b. at 1400 px (the coordinator, 14-Oct-2026): the page's title in full, never "Purcha…" or "Accou…"; and one
    # filter bar only: no filter arrow on the table's headings (as on the challan register, round 3)
    br, pg = start(p, 1400, 900)
    E = lambda js, *a: pg.evaluate(js, *a)
    TITLE = "(() => { const h = document.querySelector('#cobar .tbar-title h2'); return h ? [h.textContent, h.scrollWidth, h.clientWidth] : null; })()"
    ARROWS = "document.querySelectorAll('#app table thead .colf, #app table thead .gff').length"
    E(BK.PURCHASE); pg.wait_for_timeout(1500); E(BK.DRAFTS); pg.wait_for_timeout(900)
    t = E(TITLE); ok(t and t[0] == "Purchase" and t[1] <= t[2], "1400 px: the title “Purchase” in full (%s)" % t)
    ok(E("document.querySelectorAll('#app table.revtbl tbody tr').length") >= 4 and E(ARROWS) == 0, "Purchase: no filter arrows on the headings (%d); the filter bar above is the one filter" % E(ARROWS))
    ok(E("document.querySelectorAll('#app .revfilter input[type=search]').length") == 1, "Purchase: its one filter bar")
    E(BK.BANK); pg.wait_for_timeout(1200)
    t = E(TITLE); ok(t and t[0] == "Bank" and t[1] <= t[2], "1400 px: the title “Bank” in full (%s)" % t)
    ok(E(ARROWS) == 0 and E("document.querySelectorAll('#app .bk-search').length") == 1, "Bank: no filter arrows on the headings (%d), one search" % E(ARROWS))
    E(BK.SALES); pg.wait_for_timeout(1200)
    t = E(TITLE); ok(t and t[0] == "Sales" and t[1] <= t[2], "1400 px: the title “Sales” in full (%s)" % t)
    ok(E(ARROWS) == 0 and E("document.querySelectorAll('#app .bk-search').length") == 1, "Sales: no filter arrows on the headings (%d), one search" % E(ARROWS))
    E("() => { S.tab = 'books'; S.booksTab = 'fs'; render(); }"); pg.wait_for_timeout(1500)
    t = E(TITLE); ok(t and t[0] == "Financial statements" and t[1] <= t[2], "1400 px: the title “Financial statements” in full (%s)" % t)
    E("() => { S.tab = 'books'; S.booksTab = 'recon'; render(); }"); pg.wait_for_timeout(1500)
    t = E(TITLE); ok(t and t[1] <= t[2], "1400 px: a long title in full too (%s)" % t)
    br.close()
    # ---- 5. a phone
    br, pg = start(p, 390, 844)
    pg.evaluate(BK.PURCHASE); pg.wait_for_timeout(1500)
    w = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
    ok(w[0] <= w[1], "phone: the page does not scroll sideways (%s)" % w)
    ok(pg.evaluate("(() => { const n = document.querySelector('#app nav.statebar'); return !!n && n.getBoundingClientRect().right <= innerWidth + 1; })()"), "phone: the row of states fits the screen")
    br.close()
    ok(not errors, "no page errors " + str(errors[:2]))
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
