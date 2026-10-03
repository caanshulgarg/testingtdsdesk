"""python3 run_books_year_note.py - round 14c (C6, owner item 5): FinCom's cloud copy of a client may hold no entries for
the current financial year. Wherever the books' figures are shown (the shared "Books as of" piece: Books, MIS, Accounts,
Reports, Look up), one note when the copy's last entry is before 01-Apr of the current year: "Current year not yet read
from Tally; figures incomplete." No note when the copy has current-year entries. One helper (booksYearNote, src/js/49)
and one component (BooksAsOf, app/src/parts/TallyLine.jsx), not a copy per screen.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_books_year_note.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8278), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
NOTE = "Current year not yet read from Tally; figures incomplete."
SETUP = """async () => {
  const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); c.tallyName = "ZZ ZETA"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  await openCompany(c.id);
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.api = async () => []; TCloud.restAll = async () => []; TCloud.rpc = async () => null;
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: [], cos: []};
  // the cloud's copy: entries up to 30-Sep-2025 only (last year), read today
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", to: "2025-09-30", book: "bk1", company: "ZZ ZETA", entries: 120, daysAt: new Date().toISOString(), state: {doneTo: "20250930", skipped: [], seen: "2026-10-03T08:00:00Z", readAt: "2026-10-03T08:00:00Z"}}]};
  S.books = {loading: false, cid: c.id, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  S.step = null; S.tab = "books"; S.booksTab = "fs"; render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8278/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(1000)
    fy_start = E("fyStartEnd(fyOf(null)).from")
    ok(fy_start.endswith("-04-01") and "20250930" < fy_start.replace("-", ""), "the current year starts " + fy_start + "; the copy ends 30-Sep-2025, before it")
    note = pg.locator("#app [data-books-year-note]")
    ok(pg.locator("#app [data-books-asof]").count() >= 1 and note.count() == 1 and note.inner_text().strip() == NOTE, "C6. Accounts: beside 'Books as of', the one note '%s' (%s)" % (NOTE, note.inner_text() if note.count() else "-"))
    ok(E("booksYearNote(S.coId)") == NOTE, "C6. the shared helper says the same (booksYearNote)")
    # MIS and the TDS tab (the same component)
    E("() => { S.booksTab = 'mis'; render(); }"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-books-year-note]").count() == 1, "C6. MIS: the same note, once")
    # the copy has entries of the current year: no note
    E("() => { TCloud.st[S.coId].books[0].to = '2026-09-30'; TCloud.st[S.coId].books[0].state.doneTo = '20260930'; S.booksTab = 'fs'; render(); }"); pg.wait_for_timeout(600)
    ok(pg.locator("#app [data-books-year-note]").count() == 0 and E("booksYearNote(S.coId)") == "", "C6. the copy ends 30-Sep-2026 (this year): no note")
    # the books here (the day book's entries) count too: last entry last year -> note; one of this year -> none
    E("() => { TCloud.st[S.coId].books[0].to = '2025-09-30'; S.books.vouchers = [{id: 'v1', date: '20250815', type: 'Journal', cancel: false, ent: []}]; }")
    ok(E("booksYearNote(S.coId)") == NOTE, "C6. entries here up to Aug-2025 only: the note")
    E("() => { S.books.vouchers.push({id: 'v2', date: '20260601', type: 'Journal', cancel: false, ent: []}); }")
    ok(E("booksYearNote(S.coId)") == "", "C6. an entry of Jun-2026 here: no note")
    E("() => { S.books.vouchers = []; TCloud.st[S.coId] = {at: Date.now(), books: []}; }")
    ok(E("booksYearNote(S.coId)") == "", "C6. no copy and no entries at all: no note (nothing to say about)")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
