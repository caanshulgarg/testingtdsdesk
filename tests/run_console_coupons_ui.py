"""python3 run_console_coupons_ui.py - the console's Coupons screens (console/src/modules/coupons, branch
next-console-coupons), in Chromium (Playwright), against tests/console_stand.ts: a fake Supabase Auth and the REAL
console-admin router and modules, the coupons' database functions kept in memory with their rules
(tests/console_coupons_fake.ts; the SQL itself: run_migration120.py). The built console (CONSOLE_DIST, else built here
into $TMPDIR/console-dist) is served with console/_headers' own headers, the CSP included.
  1. the list: the seeded coupons; status chips; presets Active / Paused / Finished / All; a filter from the panel on
     status, usage, kind, a yes/no rule (filter-only columns), a number range, campaign text; chips; Clear all; Export
     CSV (downloaded, and in the change history)
  2. create: the form shows the fields of the chosen kind and what firms get in words; a bad code is said on the page;
     the reason dialog (off below 5 characters); a code taken in other letters refused in plain words; then the coupon's
     page; coupon.create in the change history with the reason
  3. a coupon's page: facts, its redemptions (a DataTable: a filter, export); edit (a used coupon's code is locked)
  4. pause, resume, end: the status chip changes, each in the change history; an ended coupon has no Edit
  5. the report: given per coupon and month, presets, export
  6. roles: Viewer and Support see the coupons but no New coupon, Edit, Pause or End, and #/coupons/new says so;
     Billing creates
  7. phone (390 px): no sideways scroll on the list, a coupon, the form, the report; dark mode; screenshots in SHOTS
     (default scratchpad/console-coupons-shots)
  8. no CSP violation and no page error anywhere"""
import os, sys, json, time, socket, subprocess, threading, functools, http.server
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SUPA = "https://qbocskaiewaxqcvaunzc.supabase.co"
PAGE_PORT, STAND_PORT = int(os.environ.get("CONSOLE_PAGE_PORT", 8181)), int(os.environ.get("CONSOLE_STAND_PORT", 8182))
ORIGIN = "http://localhost:%d" % PAGE_PORT
SHOTS = os.environ.get("SHOTS") or os.path.join(ROOT, "..", "console-coupons-shots")
DENO = os.environ.get("DENO") or subprocess.run(["sh", "-c", "command -v deno"], capture_output=True, text=True).stdout.strip()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)

dist = os.environ.get("CONSOLE_DIST") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "console-dist")
if not os.environ.get("CONSOLE_DIST"):
    r = subprocess.run(["npx", "vite", "build"], cwd=os.path.join(ROOT, "console"), env=dict(os.environ, CONSOLE_OUT=dist), capture_output=True, text=True)
    if r.returncode: print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)
HDRS, rule = {}, None
for line in open(os.path.join(ROOT, "console", "_headers")):
    if line.startswith("/"): rule = line.strip()
    elif rule == "/*" and line.startswith("  ") and ":" in line and not line.strip().startswith("!"):
        k, v = line.strip().split(":", 1); HDRS[k.strip()] = v.strip()
HDRS["Content-Security-Policy"] = HDRS["Content-Security-Policy"].replace("; upgrade-insecure-requests", "")
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HDRS.items(): self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PAGE_PORT), functools.partial(H, directory=dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()
stand = subprocess.Popen([DENO, "run", "--allow-net", "--no-lock", os.path.join(HERE, "console_stand.ts"), str(STAND_PORT), ORIGIN],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for _ in range(600):
    try: socket.create_connection(("127.0.0.1", STAND_PORT), 0.2).close(); break
    except OSError: time.sleep(0.1)
os.makedirs(SHOTS, exist_ok=True)
def stand_audit():
    import urllib.request
    return json.loads(urllib.request.urlopen("http://127.0.0.1:%d/__audit" % STAND_PORT).read())

errors, csp = [], []
def forward(route):
    rq = route.request
    try: route.fulfill(response=route.fetch(url="http://127.0.0.1:%d%s" % (STAND_PORT, rq.url[len(SUPA):]), headers=rq.all_headers()))
    except Exception as e:
        # a page closed while its request was on the way (the context ends): not a page error
        if "disposed" in str(e) or "closed" in str(e): return
        route.abort(); errors.append("forward: " + str(e))
def new_page(br, **kw):
    ctx = br.new_context(accept_downloads=True, **kw)
    pg = ctx.new_page()
    pg.route(SUPA + "/**", forward)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: (csp.append(m.text) if "Content Security Policy" in m.text or "Trusted Type" in m.text else None))
    pg.add_init_script("document.addEventListener('securitypolicyviolation', e => console.error('Content Security Policy violation: ' + e.violatedDirective + ' ' + e.blockedURI))")
    return ctx, pg
PW = {"owner": "Owner-pass-123", "billing": "Billing-pass-123", "support": "Support-pass-123", "viewer": "Viewer-pass-123"}
def sign_in(pg, who):
    pg.goto(ORIGIN + "/")
    pg.fill("input[type=email]", who + "@fincom.live"); pg.fill("input[type=password]", PW[who]); pg.click("button:has-text('Continue')")
    pg.wait_for_selector("input[autocomplete=one-time-code]")
    pg.fill("input[autocomplete=one-time-code]", "123456"); pg.click("button:has-text('Sign in')")
    pg.wait_for_selector("[data-testid=tiles]")
def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
def text(pg, sel="body"): return pg.inner_text(sel)
def wait_rows(pg, table):
    pg.wait_for_function("t => { const d = document.querySelector('[data-table=\"' + t + '\"]'); return d && !d.innerText.includes('Reading…'); }", arg=table)
def count(pg, table, n):
    pg.wait_for_function("([t, n]) => { const c = document.querySelector('[data-table=\"' + t + '\"] [data-testid=count]'); return c && (n === 0 ? c.innerText === '0' : c.innerText.endsWith('of ' + n)); }", arg=[table, n], timeout=8000)
    return True
def codes(pg, table="coupons"):
    return pg.eval_on_selector_all("[data-table=%s] tbody tr td:first-child" % table, "els => els.map(e => e.innerText.trim())")
def no_sideways(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
BTN = "dialog [data-testid=reason-confirm]"
WELCOME = "c0000000-0000-4000-8000-000000000001"

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "owner")
        print("== 1. the list")
        ok(pg.query_selector("[data-nav=coupons]") is not None, "Coupons in the menu")
        pg.click("[data-nav=coupons]"); wait_rows(pg, "coupons")
        ok(count(pg, "coupons", 4) and set(codes(pg)) == {"WELCOME10", "ICAI1000", "FIRST2FREE", "OLDTRIAL"}, "the coupons: %s" % codes(pg))
        t = text(pg, "[data-table=coupons]")
        ok("10% off the plan fee for 3 months (up to ₹500 a month)" in t and "Used up" in t and "Paused" in t and "Ended" in t and "2 / 100" in t and "₹2,000" in t,
           "terms in words, status chips, uses of total, rupees given")
        shot(pg, "c01-list")
        pg.click("[data-table=coupons] .seg-b:has-text('Paused')"); count(pg, "coupons", 1)
        ok(codes(pg) == ["FIRST2FREE"], "preset Paused")
        pg.click("[data-table=coupons] .seg-b:has-text('Finished')"); count(pg, "coupons", 2)
        ok(set(codes(pg)) == {"ICAI1000", "OLDTRIAL"}, "preset Finished: ended, expired, used up")
        pg.click("[data-table=coupons] .seg-b:has-text('Active')"); count(pg, "coupons", 1)
        pg.click("[data-table=coupons] .seg-b:has-text('All')"); count(pg, "coupons", 4)
        pg.click("[data-table=coupons] [data-testid=filters-toggle]")
        labels = pg.eval_on_selector_all("[data-testid=filter-panel] .f-label", "els => els.map(e => e.innerText)")
        want = ["Code", "Kind", "Terms", "Status", "Usage", "Uses", "Total uses", "Firms", "Given", "Valid from", "Valid to", "Plans", "Once per firm", "New firms only", "Stacks", "Campaign", "Created"]
        ok(labels == want, "a filter for every column, the rules too (%s)" % labels)
        shot(pg, "c02-filters")
        pg.check("[data-filter='status:used_up']"); count(pg, "coupons", 1)
        ok(codes(pg) == ["ICAI1000"] and "Status: Used up" in text(pg, "[data-table=coupons] .chips"), "status filter: Used up, with its chip")
        pg.uncheck("[data-filter='status:used_up']"); count(pg, "coupons", 4)
        pg.check("[data-filter='usage:unused']"); count(pg, "coupons", 2)
        ok(set(codes(pg)) == {"FIRST2FREE", "OLDTRIAL"}, "usage filter: not used yet")
        pg.uncheck("[data-filter='usage:unused']"); count(pg, "coupons", 4)
        pg.select_option("[data-filter='new_firms_only']", "true"); count(pg, "coupons", 1)
        ok(codes(pg) == ["FIRST2FREE"], "a rule (filter only, not a column): new firms only")
        pg.select_option("[data-filter='new_firms_only']", ""); count(pg, "coupons", 4)
        pg.fill("[data-filter='given_inr:from']", "1500"); count(pg, "coupons", 1)
        ok(codes(pg) == ["ICAI1000"], "a number range: given from ₹1,500")
        pg.fill("[data-filter='given_inr:from']", ""); count(pg, "coupons", 4)
        pg.fill("[data-filter='campaign']", "diwali"); pg.press("[data-filter='campaign']", "Enter"); count(pg, "coupons", 1)
        pg.check("[data-filter='kind:percent']"); count(pg, "coupons", 1)
        ok(codes(pg) == ["WELCOME10"] and "Kind: % off" in text(pg, "[data-table=coupons] .chips"), "campaign text and kind together")
        pg.click("[data-table=coupons] [data-testid=clear-all]"); count(pg, "coupons", 4)
        ok("coupons.f" not in pg.url or "coupons.f=%7B%7D" in pg.url, "Clear all")
        with pg.expect_download() as dl: pg.click("[data-table=coupons] [data-testid=export]")
        csvt = open(dl.value.path(), encoding="utf-8-sig").read()
        ok(csvt.startswith("code,kind,terms,status,usage") and "WELCOME10" in csvt, "Export CSV: every column")
        ok(any(a["action"] == "coupons.list.export" for a in stand_audit()), "the export is in the change history")

        print("== 2. create")
        pg.click("[data-testid=coupon-new]"); pg.wait_for_selector("[data-testid=f-code]")
        ok(pg.query_selector("[data-testid=f-percent]") and pg.query_selector("[data-testid=f-maxoff]") and not pg.query_selector("[data-testid=f-days]"), "percent: percent, months, the most off a month")
        pg.click("[data-testid=f-kind-credit]")
        ok(pg.query_selector("[data-testid=f-amount]") and not pg.query_selector("[data-testid=f-months]"), "free credit: the amount only")
        pg.click("[data-testid=f-kind-trial_days]"); ok(pg.query_selector("[data-testid=f-days]") is not None, "longer trial: days")
        pg.click("[data-testid=f-kind-percent]")
        pg.fill("[data-testid=f-code]", "di-wali"); pg.fill("[data-testid=f-percent]", "20"); pg.fill("[data-testid=f-months]", "3"); pg.fill("[data-testid=f-maxoff]", "1000")
        ok(pg.inner_text("[data-testid=f-preview]") == "Firms get: 20% off the plan fee for 3 months (up to ₹1,000 a month)", "what firms get, in words: %s" % pg.inner_text("[data-testid=f-preview]"))
        pg.click("[data-testid=f-save]")
        ok("4 to 20 letters and digits" in text(pg, ".coupon-form") and pg.query_selector("dialog") is None, "a bad code: said on the page, nothing sent")
        pg.fill("[data-testid=f-code]", "welcome10"); pg.click("[data-testid=f-save]"); pg.wait_for_selector("dialog")
        ok(pg.is_disabled(BTN), "the reason dialog: confirm off without a reason")
        pg.fill("dialog textarea", "abc"); ok(pg.is_disabled(BTN), "...and with 3 characters")
        pg.fill("dialog textarea", "Diwali campaign 2026"); pg.click(BTN)
        pg.wait_for_selector("dialog [role=alert]")
        ok("That code is already used by another coupon (codes are not case-sensitive)." in text(pg, "dialog"), "a code taken (other letters): plain words in the dialog")
        pg.click("dialog button:has-text('Cancel')")
        pg.fill("[data-testid=f-code]", "diwali20"); pg.fill("[data-testid=f-campaign]", "Diwali"); pg.fill("[data-testid=f-maxuses]", "50")
        pg.check("[data-testid='f-plan-Pay as you go']"); pg.check("[data-testid=f-new]"); pg.fill("[data-testid=f-newdays]", "14")
        pg.fill("[data-testid=f-from]", "2026-10-01"); pg.fill("[data-testid=f-to]", "2026-12-31")
        shot(pg, "c03-new")
        pg.click("[data-testid=f-save]"); pg.wait_for_selector("dialog"); pg.fill("dialog textarea", "Diwali campaign 2026"); pg.click(BTN)
        pg.wait_for_selector("[data-testid=coupon-terms]")
        t = text(pg)
        ok("DIWALI20" in t and pg.inner_text("[data-testid=coupon-terms]") == "20% off the plan fee for 3 months (up to ₹1,000 a month)" and "Pay as you go" in t
           and "within 14 days of joining" in t and "0 of 50" in t, "the new coupon's page: terms, plan, new firms within 14 days, uses 0 of 50")
        a = [x for x in stand_audit() if x["action"] == "coupon.create"]
        ok(a and a[-1]["reason"] == "Diwali campaign 2026" and a[-1]["after"]["code"] == "DIWALI20", "coupon.create in the change history, with the reason")
        DIWALI = pg.url.split("#/coupons/")[1]
        shot(pg, "c04-coupon-new")

        print("== 3. a coupon's page")
        pg.goto(ORIGIN + "/#/coupons/" + WELCOME); wait_rows(pg, "red")
        ok(count(pg, "red", 2) and "ABC Associates" in text(pg, "[data-table=red]") and "Sign-up" in text(pg, "[data-table=red]"), "its redemptions: firm, where, given")
        pg.click("[data-table=red] .seg-b:has-text('Running')"); count(pg, "red", 2)
        pg.click("[data-table=red] [data-testid=filters-toggle]"); pg.check("[data-filter='source:signup']"); count(pg, "red", 1)
        ok("ABC Associates" in text(pg, "[data-table=red] tbody"), "filter: source Sign-up")
        with pg.expect_download() as dl: pg.click("[data-table=red] [data-testid=export]")
        ok("asha@abc.test" in open(dl.value.path(), encoding="utf-8-sig").read(), "redemptions export")
        shot(pg, "c05-coupon")
        pg.click("[data-testid=coupon-edit]"); pg.wait_for_selector("[data-testid=f-code]")
        ok(pg.is_disabled("[data-testid=f-code]") and pg.is_disabled("[data-testid=f-kind-flat] input") and "Used already" in text(pg, ".coupon-form"), "edit a used coupon: code and kind locked")
        ok(pg.input_value("[data-testid=f-percent]") == "10" and pg.input_value("[data-testid=f-maxoff]") == "500", "the form holds its values")
        pg.fill("[data-testid=f-percent]", "15"); pg.click("[data-testid=f-save]"); pg.fill("dialog textarea", "Raise for November"); pg.click(BTN)
        pg.wait_for_selector("[data-testid=coupon-terms]:has-text('15% off')")
        ok(any(x["action"] == "coupon.update" and x["before"]["value"] == 10 and x["after"]["value"] == 15 for x in stand_audit()), "coupon.update: before and after in the change history")

        print("== 4. pause, resume, end")
        pg.goto(ORIGIN + "/#/coupons/" + DIWALI); pg.wait_for_selector("[data-testid=coupon-status]")
        for act, chip in (("coupon.pause", "Paused"), ("coupon.resume", "Active"), ("coupon.end", "Ended")):
            pg.click(".page-actions [data-action='%s']" % act); pg.fill("dialog textarea", "Campaign change"); pg.click(BTN)
            pg.wait_for_selector("[data-testid=coupon-status]:has-text('%s')" % chip)
            ok(any(x["action"] == act and x["target_id"] == DIWALI for x in stand_audit()), "%s: the chip says %s, in the change history" % (act, chip))
        ok(pg.query_selector("[data-testid=coupon-edit]") is None and pg.query_selector(".page-actions [data-action]") is None and "no new uses, for good" in text(pg), "ended: no Edit, no buttons; said so")
        shot(pg, "c06-ended")
        pg.goto(ORIGIN + "/#/coupons"); wait_rows(pg, "coupons")
        pg.click("[data-table=coupons] tr:has-text('WELCOME10') [data-action='coupon.pause']"); pg.fill("dialog textarea", "Pause from the list"); pg.click(BTN)
        wait_rows(pg, "coupons"); pg.wait_for_selector("[data-table=coupons] tr:has-text('WELCOME10') [data-action='coupon.resume']")
        ok(True, "pause from the list's row: then Resume is offered")

        print("== 5. the report")
        pg.click("[data-testid=coupon-report-link]"); wait_rows(pg, "crep")
        t = text(pg, "[data-table=crep]")
        ok("ICAI1000" in t and "WELCOME10" in t and "₹1,000" in t and "₹500" in t, "given per coupon and month (credit and discounts)")
        pg.click("[data-table=crep] .seg-b:has-text('This month')"); wait_rows(pg, "crep")
        ok("Month: from" in text(pg, "[data-table=crep] .chips"), "preset This month (a date range)")
        pg.click("[data-table=crep] .seg-b:has-text('All')"); wait_rows(pg, "crep")
        with pg.expect_download() as dl: pg.click("[data-table=crep] [data-testid=export]")
        ok(open(dl.value.path(), encoding="utf-8-sig").read().startswith("month,code,kind,campaign,redemptions,credit_inr,discount_inr,total_inr"), "report export")
        shot(pg, "c07-report")
        ctx.close()

        print("== 6. roles")
        for who in ("viewer", "support"):
            ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}); sign_in(pg, who)
            pg.click("[data-nav=coupons]"); wait_rows(pg, "coupons")
            ok(pg.query_selector("[data-testid=coupon-new]") is None and pg.query_selector("[data-table=coupons] [data-action]") is None, "%s: the coupons, no New coupon, no Pause / End" % who)
            pg.goto(ORIGIN + "/#/coupons/" + WELCOME); wait_rows(pg, "red")
            ok(pg.query_selector("[data-testid=coupon-edit]") is None and pg.query_selector(".page-actions [data-action]") is None, "%s: a coupon, no Edit, Pause or End" % who)
            if who == "viewer": ok("as***@abc.test" in text(pg, "[data-table=red]") and "asha@abc.test" not in text(pg), "viewer: emails partly hidden")
            pg.goto(ORIGIN + "/#/coupons/new"); pg.wait_for_selector("text=cannot create or change coupons")
            ok(True, "%s: #/coupons/new says the role cannot" % who)
            if who == "viewer": shot(pg, "c08-viewer")
            ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}); sign_in(pg, "billing")
        pg.goto(ORIGIN + "/#/coupons/new"); pg.wait_for_selector("[data-testid=f-code]")
        pg.click("[data-testid=f-kind-credit]"); pg.fill("[data-testid=f-code]", "ICAI500"); pg.fill("[data-testid=f-amount]", "500"); pg.check("[data-testid=f-stack]")
        pg.click("[data-testid=f-save]"); pg.fill("dialog textarea", "ICAI seminar Pune"); pg.click(BTN)
        pg.wait_for_selector("[data-testid=coupon-terms]:has-text('₹500 of free credit')")
        ok(any(x["action"] == "coupon.create" and x["role"] == "billing" for x in stand_audit()), "Billing creates a free-credit coupon")
        ctx.close()

        print("== 7. phone and dark")
        ctx, pg = new_page(br, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); sign_in(pg, "owner")
        for name, path, ready in (("list", "coupons", "[data-table=coupons]"), ("coupon", "coupons/" + WELCOME, "[data-table=red]"), ("form", "coupons/new", "[data-testid=f-code]"), ("report", "coupons/report", "[data-table=crep]")):
            pg.goto(ORIGIN + "/#/" + path); pg.wait_for_selector(ready); pg.wait_for_timeout(300)
            ok(no_sideways(pg), "phone: no sideways scroll on the %s" % name)
            shot(pg, "c09-phone-" + name)
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}, color_scheme="dark"); sign_in(pg, "owner")
        pg.goto(ORIGIN + "/#/coupons"); wait_rows(pg, "coupons")
        bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
        ok(pg.evaluate("document.documentElement.dataset.theme") == "dark" and bg != "rgb(255, 255, 255)", "dark mode (%s)" % bg)
        shot(pg, "c10-dark-list")
        pg.goto(ORIGIN + "/#/coupons/new"); pg.wait_for_selector("[data-testid=f-code]"); pg.fill("[data-testid=f-percent]", "20"); pg.fill("[data-testid=f-months]", "2")
        shot(pg, "c11-dark-form")
        ctx.close()
        br.close()
    ok(not errors, "no page errors (%s)" % errors[:3])
    ok(not csp, "no CSP or Trusted Types violation (%s)" % csp[:3])
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:500])
finally:
    srv.shutdown(); stand.terminate()
    try: out = stand.communicate(timeout=5)[0]
    except Exception: out = ""
    if fails and out: print("stand log:", out[-1500:])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
