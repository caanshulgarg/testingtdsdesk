"""python3 tests/run_fbooks_ui.py - the FinCom Books page (app/src/screens/fbooks) in the built app, end to end on a
throwaway PostgreSQL: migration 220 and the made-up books of tests/fbooks_fixture.mjs, enrolled and mirrored there; the
page's readers (fb_status, fb_tb, fb_ledgers, fb_ledger, fb_daybook, fb_tieout_ask, fb_enroll) are answered by that
database through TCloud.rpc, replaced in the page by this test (its server runs each call as the firm's owner, or as
staff / a look-only member for check 6). The page itself has nothing test-only.
  1. "Not in step": a change the mirror missed shows the warning banner with the group and the amount, since when, and
     that returns can still be filed; its differences open; the page never blocks anything
  2. the trial balance: Debit = Credit; primary groups with their Schedule III line; a group opens into its ledgers
  3. a ledger opened from the trial balance: its entries, running balance and closing = the trial balance's figure; a
     party ledger's pending bills and ageing (the ported bill-wise rules)
  4. the day book: entries with their status (held, memo, cancelled), the totals of posted entries only
  5. Check now: after the next read brings the change, the banner says "In step with Tally"; a change written in the
     last minutes shows "Updating" (FinCom Books follows within 10 minutes), and more than 10 minutes behind shows
     "Not in step"
  6. a client without FinCom Books: a look-only member is told who can set it up; staff are offered "Set up FinCom
     Books" (owner decision 23-Nov-2026) and it sets it up at once (migration 218): "Being built", then "Building: n of
     m entries" as the 3-minute catch-up builds it, then the book by itself, with no error and no warning. While it is
     built (review of 24-Nov-2026): one look-again that fails keeps the figures shown and the page keeps looking; a
     hidden tab does not look again (it does at once when shown); a build that stops says so plainly, with no alarm
     ("Building stopped: <why>. FinCom is trying again.")
  7. a phone's width: nothing scrolls sideways; no page error anywhere; the page is its own lazy chunk, which keeps the
     MIT notice of the ported rules; no test hook in the built app
FB_SHOTS=<dir>: also saves the design screenshots there (deviceScaleFactor 2, 1440 and 390 wide).
Run on app/dist-test (or TDSDESK_SITE). PG_PORT (55622), FB_PORT (8396)."""
import os, sys, json, threading, functools, http.server, glob
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
import pg_stand
from fbooks_stand import F1, F2, OWN, STAFF, OTHER, TB1, COPY, MIG, MIG218, load_sql, books
VIEW = "aaaaaaaa-0000-0000-0000-000000000004"
WHO = [OWN]   # who the test server answers as
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FB_PORT") or 8396)
SHOTS = os.environ.get("FB_SHOTS", "")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

db = pg_stand.start(int(os.environ.get("PG_PORT") or 55622))
db.sql(COPY)
db.sql("""insert into firms values ('%s', 'Sample & Co'), ('%s', 'Other Firm');
  insert into members (user_id, firm_id, name, role) values ('%s', '%s', 'Owner', 'owner'), ('%s', '%s', 'Staff', 'staff'), ('%s', '%s', 'Other', 'owner'), ('%s', '%s', 'Viewer', 'viewer');
  insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%s', '%s', 'c1', 'Demo Books Pvt Ltd (made up)', '2024-04-01', '2024-04-01'),
    ('bbbbbbbb-0000-0000-0000-000000000009', '%s', 'c9', 'Second Demo LLP (made up)', '2025-04-01', '2025-04-01');
  grant select on firms, members to authenticated;""" % (F1, F2, OWN, F1, STAFF, F1, OTHER, F2, VIEW, F1, TB1, F1, F1))
db.sql(open(MIG).read())
db.sql(open(MIG218).read())
B = books(400, 7)
db.sql(load_sql(TB1, F1, B))
db.sql(load_sql("bbbbbbbb-0000-0000-0000-000000000009", F1, books(60, 21)))
BK = json.loads(db.one("set role authenticated; select fb_enroll('c1')", OWN))["books"][0]["book"]
db.sql("call fb_mirror_catchup_run(5000)")   # the timer builds it
# put the made-up "held" entry right (so the banner is about the missed change only), then a change the mirror misses
odd = db.one("select guid from tally_vouchers where book_id = '%s' and vno = 'J/ODD-1'" % TB1)
db.sql("begin; update tally_lines set amount = -100 where book_id = '%s' and guid = '%s' and amount = -100.01; update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = '%s'; commit;" % (TB1, odd, TB1, odd))
gd = db.one("select l.guid from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid where l.book_id = '%s' and l.ledger = 'Beta Sample Mart' and v.vtype = 'Sales' and v.day > '2026-09-01' order by v.day limit 1" % TB1)
db.sql("begin; set local session_replication_role = replica; update tally_lines set amount = amount - 4200 where book_id = '%s' and guid = '%s' and ledger = 'Beta Sample Mart'; update tally_lines set amount = amount + 4200 where book_id = '%s' and guid = '%s' and ledger = 'Sales @ 18%%'; commit;" % (TB1, gd, TB1, gd))
db.sql("set role service_role; select fb_tieout('%s')" % BK)
db.sql("update fb_books set not_in_step_since = '2026-11-21 18:00+05:30' where book_id = '%s'" % BK)   # (a fixed time for the screenshots; not audited away: a superuser's test edit)

CALLS = []
FAILNEXT = {}   # fn -> how many of its next calls fail (a made-up network failure)
def lit(v):
    if v is None: return "null"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
    def do_POST(self):
        fn = self.path.rsplit("/", 1)[-1]
        args = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if not fn.startswith("fb_") or not fn.replace("_", "").isalnum(): self.send_response(400); self.end_headers(); return
        CALLS.append(fn)
        if FAILNEXT.get(fn):
            FAILNEXT[fn] -= 1; body = b'{"message": "made-up network failure"}'
            self.send_response(503); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        q = "set role authenticated; set statement_timeout = '8s'; select %s(%s)" % (fn, ", ".join("%s => %s" % (k, lit(v)) for k, v in args.items() if k.replace("_", "").isalnum()))
        try: out, code = db.one(q, WHO[0]), 200
        except RuntimeError as e: out, code = json.dumps({"message": str(e).split("\n")[0]}), 400
        body = (out or "null").encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
RPC = """() => { TCloud.rpc = (fn, args) => fetch("/__fb/" + fn, { method: "POST", body: JSON.stringify(args || {}) })
  .then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.message || "error"); return j; })); }"""
SEED = """(cid) => { S.firm.firmName = "Sample & Co";
  const c = newCompany({name: "Demo Books Pvt Ltd (made up)", pan: "ZZZPX9999Z"}); c.id = cid; S.companies[c.id] = c; c.stats = {};
  S.data[c.id] = {parties: {}, entries: {}, loaded: true}; S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  S.books = {cid: c.id, loading: false, vouchers: [], ledgers: [], challans: [], alloc: {}, map: {}};
  Store.saveFirm(); Store.saveCompany(c); render(); return c.id; }"""
def start(pg, cid="c1"):
    pg.goto(URL); pg.wait_for_timeout(1200)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    pg.wait_for_timeout(400); pg.evaluate(RPC); pg.evaluate(SEED, cid); pg.wait_for_timeout(300)
    pg.evaluate("() => goClient('books:fb')")
    settle(pg)
def settle(pg, ms=400):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => document.querySelector('[data-fbooks]') && !document.querySelector('[data-fb-loading]') && !/Working out|Opening the/.test(document.querySelector('[data-fbooks]').innerText)", timeout=10000)
    except Exception: pass
    pg.wait_for_timeout(200)
def shot(pg, name, full=True):
    if not SHOTS: return
    os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
def text(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }", sel)
def fits(pg): return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        errs = []
        def page(w, h=1000):
            ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, timezone_id="Asia/Kolkata")
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200])); return ctx, pg
        ctx, pg = page(1440)
        start(pg)
        # 1. the banner
        ban = text(pg, "[data-fb-step]")
        ok(pg.evaluate("() => document.querySelector('[data-fb-step]').dataset.fbStep") == "out" and "Not in step with Tally since 21-Nov, 18:00" in ban and "Sundry Debtors differs by ₹4,200.00" in ban,
           "1. the banner: '%s'" % ban.split("\n")[0])
        ok("can still be filed" in ban and "not read yet" in ban, "1. it says returns can still be filed, and that Tally's own trial balance is not read yet")
        ok("Source: Tally" in text(pg, "[data-fb-source]"), "1. the source is named (%s)" % text(pg, "[data-fb-source]"))
        # 2. the trial balance
        tb = text(pg, "[data-fb-tb]")
        ok(pg.evaluate("() => document.querySelector('[data-fb-ties]').dataset.fbTies") == "1" and "Debit = Credit" in tb and "Current Assets" in tb and "Current assets" in tb, "2. the trial balance: Debit = Credit; primary groups with their Schedule III line")
        ok(pg.evaluate("() => document.querySelector('[data-fb-tb-dr]').innerText === document.querySelector('[data-fb-tb-cr]').innerText"), "2. Debit total = Credit total (%s)" % text(pg, "[data-fb-tb-dr]"))
        shot(pg, "p1-01-tb-not-in-step", full=False)
        pg.click("[data-fb-why]"); pg.wait_for_timeout(200)
        ok("Beta Sample Mart on" in text(pg, "[data-fb-diffs]"), "1. its differences open, ledger by day: '%s'" % text(pg, "[data-fb-diffs]").split("\n")[0])
        pg.click("[data-fb-why]")
        pg.click("[data-fb-group='Current Assets']"); pg.wait_for_timeout(200)
        ok(pg.locator("[data-fb-ledger-row='Alpha Demo Stores']").count() == 1, "2. a group opens into its ledgers")
        shot(pg, "p1-02-tb-open", full=True)
        # 3. a ledger
        pg.click("[data-fb-ledger-row='Demo Bank Current A/c']"); settle(pg)
        ok(text(pg, "[data-fb-ledger-name]").startswith("Demo Bank Current A/c") and pg.locator("[data-fb-entry]").count() > 10, "3. the ledger opened from the trial balance, with its entries (%d)" % pg.locator("[data-fb-entry]").count())
        pg.click("[data-fb-tab=tb]"); settle(pg); pg.click("[data-fb-group='Current Assets']"); pg.wait_for_timeout(200)
        tbclose = pg.evaluate("() => { const r = document.querySelector(\"[data-fb-ledger-row='Alpha Demo Stores']\"); return [...r.querySelectorAll('td.n')].map((t) => t.innerText).join('|'); }")
        pg.click("[data-fb-ledger-row='Alpha Demo Stores']"); settle(pg)
        pg.fill("[data-fbooks] input[type=date] >> nth=0", "2025-04-01"); settle(pg)
        close = text(pg, "[data-fb-close]")
        ok(close.split(" ")[0] in tbclose, "3. the ledger's closing (%s) is the trial balance's (%s)" % (close, tbclose))
        bl = text(pg, "[data-fb-bills]")
        ok("Bills pending" in bl and "Under 30 days" in bl, "3. a party ledger: pending bills and their ageing")
        ok("(they agree)" in bl and "not bill by bill yet" in bl, "3. its pending bills with the opening add up to the ledger's closing; the opening is said to be not bill by bill yet")
        shot(pg, "p1-03-ledger-party", full=True)
        # 4. the day book
        pg.click("[data-fb-tab=day]"); settle(pg)
        pg.fill("[data-fb-from]", "2026-07-10"); pg.fill("[data-fb-to]", "2026-07-14"); settle(pg)
        st = pg.evaluate("() => [...document.querySelectorAll('[data-fb-voucher]')].map((x) => x.dataset.fbVoucher + ':' + x.dataset.status)")
        ok(any(s.startswith("J/ODD-1:posted") for s in st), "4. the day book lists the entries with their status (%d)" % len(st))
        pg.fill("[data-fb-from]", "2026-05-08"); pg.fill("[data-fb-to]", "2026-06-12"); settle(pg)
        dtxt = text(pg, "[data-fb-day]")
        ok("Memo (not in totals)" in dtxt and "Cancelled" in dtxt and "never added" in text(pg, "[data-fb-day-totals]"), "4. memo and cancelled entries are shown and never added")
        shot(pg, "p1-04-daybook", full=True)
        # 5. Check now, after the next read brings the change
        db.sql("begin; update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = '%s'; commit;" % (TB1, gd))
        db.sql("set role service_role; select fb_mirror_catchup('%s', 100)" % BK)
        pg.click("[data-fb-check]"); settle(pg, 800)
        ban = text(pg, "[data-fb-step]")
        ok("In step with Tally" in ban and "fb_tieout_ask" in CALLS, "5. Check now: '%s'" % ban.split("\n")[0][:110])
        pg.click("[data-fb-tab=tb]"); settle(pg)
        shot(pg, "p1-05-tb-in-step", full=False)
        # 5b. within 10 minutes (owner decision 23-Nov-2026): a change just written to the copy shows "Updating", never "Not in step"
        db.sql("begin; update tally_vouchers set narration = 'changed just now (made up)' where book_id = '%s' and guid = '%s'; commit;" % (TB1, gd))
        start(pg)
        ban = text(pg, "[data-fb-step]")
        ok(pg.evaluate("() => document.querySelector('[data-fb-step]').dataset.fbStep") == "updating" and "Updating" in ban and "within 10 minutes" in ban and "last updated" in ban and "Not in step" not in ban,
           "5. a change in the last minutes: '%s'" % ban.split("\n")[0][:120])
        shot(pg, "p1-10-updating", full=False)
        db.sql("update fb_mirror_dirty set first_at = now() - interval '14 minutes'")
        start(pg)
        ban = text(pg, "[data-fb-step]")
        ok(pg.evaluate("() => document.querySelector('[data-fb-step]').dataset.fbStep") == "out" and "Not in step" in ban and "14 minutes behind" in ban and "can still be filed" in ban,
           "5. more than 10 minutes behind: '%s'" % ban.split("\n")[0][:120])
        shot(pg, "p1-11-behind", full=False)
        db.sql("call fb_mirror_catchup_run(5000)")
        ctx.close()
        # 6. not set up
        WHO[0] = VIEW
        ctx, pg = page(1440)
        start(pg, "c9")
        ok(pg.locator("[data-fb-setup]").count() == 0 and "owner or staff can set it up" in text(pg, "[data-fb-none]"), "6. a look-only member: no Set up button; told the owner or staff can")
        ctx.close()
        WHO[0] = STAFF
        ctx, pg = page(1440)
        pg.clock.install()   # the page's 30-second look-again is moved on by the test (fast_forward), not waited for
        start(pg, "c9")
        ok(pg.locator("[data-fb-setup]").count() == 1, "6. a client without FinCom Books: staff are offered Set up")
        shot(pg, "p1-06-not-set-up", full=False)
        import time as _t
        t0 = _t.time(); pg.click("[data-fb-setup]")
        pg.wait_for_selector("[data-fb-building]", timeout=8000); dt = _t.time() - t0; settle(pg)
        ban = text(pg, "[data-fb-step]")
        ok(dt < 3 and "Being built" in ban and "within 3 minutes" in ban and pg.locator("[data-fbooks] [role=alert]").count() == 0,
           "6. Set up answers at once (%.1f s): '%s'; no error" % (dt, ban.split("\n")[0][:120]))
        shot(pg, "p1-12-being-built", full=False)
        bk9 = db.one("select book_id from fb_books where client_id = 'c9'")
        # the timer's first steps: the masters (a call of their own), then part of the first chunk
        db.sql("set role service_role; select fb_mirror_catchup('%s', 12); select fb_mirror_catchup('%s', 12);" % (bk9, bk9))
        step = lambda: text(pg, "[data-fb-step]")
        def waitfor(cond, secs=10):
            t = _t.time()
            while _t.time() - t < secs and not cond(): pg.wait_for_timeout(200)
            return cond()
        pg.clock.fast_forward(31000)
        waitfor(lambda: "Building: 12 of" in step())
        ban = step()
        ok("Building: 12 of" in ban and "fills in by itself" in ban and pg.locator("[data-fbooks] [role=alert]").count() == 0, "6. the page shows how far, by itself: '%s'" % ban.split("\n")[0][:120])
        shot(pg, "p1-13-building", full=False)
        # a hidden tab does not look again; shown again, it looks at once
        vis = "(v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }"
        pg.evaluate(vis, "hidden"); n0 = CALLS.count("fb_status")
        pg.clock.fast_forward(95000); pg.wait_for_timeout(1000); n1 = CALLS.count("fb_status")
        ok(n1 == n0, "6. in a hidden tab the page does not look again (%d look-agains in 95 s)" % (n1 - n0))
        pg.evaluate(vis, "visible")
        ok(waitfor(lambda: CALLS.count("fb_status") > n1, 3), "6. ... shown again, it looks again at once")
        # one look-again fails: the last figures stay, no error banner, and the page keeps looking
        n0 = CALLS.count("fb_status"); FAILNEXT["fb_status"] = 1
        pg.clock.fast_forward(31000); waitfor(lambda: CALLS.count("fb_status") > n0); pg.wait_for_timeout(600)
        ban = step()
        ok(FAILNEXT["fb_status"] == 0 and "Building: 12 of" in ban and pg.locator("[data-fb-error]").count() == 0 and pg.locator("[data-fbooks] [role=alert]").count() == 0,
           "6. one look-again fails: the page keeps the last figures, shows no error ('%s')" % ban.split("\n")[0][:80])
        db.sql("set role service_role; select fb_mirror_catchup('%s', 5)" % bk9)
        pg.clock.fast_forward(31000); waitfor(lambda: "Building: 17 of" in step())
        ok("Building: 17 of" in step(), "6. ... and keeps looking: '%s'" % step().split("\n")[0][:80])
        # the build stops (the catch-up fails for this book): said plainly, no alarm
        db.sql("""create function zz_fail_trg() returns trigger language plpgsql as $z$ begin raise exception 'made-up failure for the test'; end $z$;
          create trigger zz_fail before update on fb_mirror_state for each row when (new.book_id = '%s') execute function zz_fail_trg();""" % bk9)
        db.sql("call fb_mirror_catchup_run(5000)")
        pg.clock.fast_forward(31000); waitfor(lambda: "Building stopped" in step())
        ban = step()
        ok("Building stopped: made-up failure for the test. FinCom is trying again." in ban and pg.evaluate("() => document.querySelector('[data-fb-step]').dataset.tone") == "info"
           and pg.locator("[data-fbooks] [role=alert]").count() == 0 and pg.locator("[data-fb-error]").count() == 0,
           "6. a build that stops says so plainly, no alarm: '%s'" % ban.split("\n")[0][:120])
        shot(pg, "p1-15-build-stopped", full=False)
        db.sql("drop trigger zz_fail on fb_mirror_state; drop function zz_fail_trg();")
        db.sql("call fb_mirror_catchup_run(5000)")   # the timer's next run finishes it
        pg.clock.fast_forward(31000); waitfor(lambda: pg.locator("[data-fb-building]").count() == 0); settle(pg)
        ban = text(pg, "[data-fb-step]")
        ok(pg.locator("[data-fb-tb]").count() == 1 and pg.locator("[data-fb-source]").count() == 1 and pg.evaluate("() => document.querySelector('[data-fb-ties]').dataset.fbTies") == "1"
           and pg.evaluate("() => document.querySelector('[data-fb-step]').dataset.tone") in ("info", "ok") and pg.locator("[data-fbooks] [role=alert]").count() == 0,
           "6. built: the trial balance by itself, Debit = Credit; no error, no warning ('%s')" % ban.split("\n")[0][:100])
        shot(pg, "p1-14-built", full=False)
        ctx.close()
        WHO[0] = OWN
        # 7. a phone
        db.sql("begin; set local session_replication_role = replica; update tally_lines set amount = amount - 4200 where book_id = '%s' and guid = '%s' and ledger = 'Beta Sample Mart'; update tally_lines set amount = amount + 4200 where book_id = '%s' and guid = '%s' and ledger = 'Sales @ 18%%'; commit;" % (TB1, gd, TB1, gd))
        db.sql("set role service_role; select fb_tieout('%s')" % BK)
        db.sql("update fb_books set not_in_step_since = '2026-11-21 18:00+05:30' where book_id = '%s'" % BK)
        ctx, pg = page(390, 844)
        start(pg)
        ok(fits(pg), "7. phone, trial balance: nothing scrolls sideways")
        shot(pg, "p1-07-phone-tb", full=False)
        pg.click("[data-fb-tab=ledger]"); settle(pg)
        pg.select_option("[data-fb-pick]", label=pg.evaluate("() => [...document.querySelectorAll('[data-fb-pick] option')].find((o) => o.text.startsWith('Alpha Demo Stores')).text")); settle(pg)
        ok(fits(pg), "7. phone, a ledger: nothing scrolls sideways")
        shot(pg, "p1-08-phone-ledger", full=True)
        pg.click("[data-fb-tab=day]"); settle(pg)
        ok(fits(pg), "7. phone, the day book: nothing scrolls sideways")
        shot(pg, "p1-09-phone-daybook", full=False)
        ctx.close(); br.close()
        ok(not errs, "7. no page error%s" % (": " + "; ".join(errs[:3]) if errs else ""))
    chunk = glob.glob(os.path.join(SITE, "assets", "FinComBooks-*.js"))
    main = glob.glob(os.path.join(SITE, "assets", "index-*.js"))
    ok(len(chunk) == 1 and not any("fb_daybook" in open(f).read() for f in main), "7. the page is its own lazy chunk (not in the app's first file)")
    ctext = open(chunk[0]).read() if chunk else ""
    ok("@license MIT" in ctext and "Independent Books" in ctext, "7. the shipped chunk keeps the MIT notice of the rules ported from Independent Books")
    ok(not any("__fbDemo" in open(f, errors="ignore").read() for f in glob.glob(os.path.join(SITE, "**", "*.js"), recursive=True)), "7. no test hook (__fbDemo) anywhere in the built app")
finally:
    srv.shutdown(); db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
