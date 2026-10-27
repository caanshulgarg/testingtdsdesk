"""python3 run_console_billing_ui.py - the console's billing screens (phase 2: Subscriptions, Credit, Plans, Prices, Monthly
run, Settings > Billing), in Chromium (Playwright), against tests/console_stand.ts (the REAL console-admin router and
modules; migration 119's functions faked in memory by tests/console_billing_fake.ts). The built console (CONSOLE_DIST,
else built here) is served with console/_headers' own CSP. Same harness as run_console_ui.py.
  1. Subscriptions: list (presets, a status filter from the panel with its chip, export CSV); a firm: usage bars, the next
     fee, top-up (the same reference twice = one line), refund part of a charge, adjust, change plan, set status
  2. Plans: list; edit the per-client price (it survives); a new plan with allowances and features; a bad amount is
     caught before anything is sent
  3. Prices: "Not set" items; a new price from today, in the history
  4. Credit: the all-firms ledger (kind filter, export); balance = ledger (the differing firm, fixed with an adjusting
     line); clean-up (the large test credit: mark and set ₹10,000; listed only, nothing done by itself)
  5. Monthly run: Run now, the report; Run now again: nothing charged twice
  6. Settings > Billing: defaults ₹10,000 / ₹500 / 7 / 30; saved with a reason; a bad pair refused on screen
  7. roles: Viewer reads everything, no money button; Support has no Credit menu but a firm's ledger, no top-up; Billing
     has no clean-up, no fix, no Settings
  8. phone (390 px): no sideways scroll on any billing screen; dark mode screenshots; no page error, no CSP violation"""
import os, sys, json, time, socket, subprocess, threading, functools, http.server, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
from playwright.sync_api import sync_playwright
SUPA = "https://qbocskaiewaxqcvaunzc.supabase.co"
PAGE_PORT, STAND_PORT = int(os.environ.get("CONSOLE_PAGE_PORT", 8181)), int(os.environ.get("CONSOLE_STAND_PORT", 8182))
ORIGIN = "http://localhost:%d" % PAGE_PORT
SHOTS = os.environ.get("SHOTS") or os.path.join(ROOT, "..", "console-billing-shots")
DENO = os.environ.get("DENO") or subprocess.run(["sh", "-c", "command -v deno"], capture_output=True, text=True).stdout.strip()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)

dist = os.environ.get("CONSOLE_DIST") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "console-dist")
if not os.environ.get("CONSOLE_DIST"):
    r = subprocess.run(["npx", "vite", "build"], cwd=os.path.join(ROOT, "console"), env=dict(os.environ, CONSOLE_OUT=dist), capture_output=True, text=True)
    if r.returncode: print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)

# console/_headers, rule /*, as Cloudflare would send them
HDRS = {}
rule = None
for line in open(os.path.join(ROOT, "console", "_headers")):
    if line.startswith("/"): rule = line.strip()
    elif rule == "/*" and line.startswith("  ") and ":" in line and not line.strip().startswith("!"):
        k, v = line.strip().split(":", 1); HDRS[k.strip()] = v.strip()
CSP = HDRS["Content-Security-Policy"]
ok("unsafe-inline" not in CSP and "script-src 'self';" in CSP and "connect-src 'self' %s;" % SUPA in CSP, "the CSP: no unsafe-inline, scripts from itself, connects only to the staging project")
HDRS["Content-Security-Policy"] = CSP.replace("; upgrade-insecure-requests", "")
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
    url = "http://127.0.0.1:%d%s" % (STAND_PORT, rq.url[len(SUPA):])
    try: route.fulfill(response=route.fetch(url=url, headers=rq.all_headers()))
    except Exception as e: route.abort(); errors.append("forward: " + str(e))
def new_page(br, **kw):
    ctx = br.new_context(accept_downloads=True, **kw)
    pg = ctx.new_page()
    pg.route(SUPA + "/**", forward)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: (csp.append(m.text) if "Content Security Policy" in m.text or "Trusted Type" in m.text else None))
    pg.add_init_script("document.addEventListener('securitypolicyviolation', e => console.error('Content Security Policy violation: ' + e.violatedDirective + ' ' + e.blockedURI))")
    return ctx, pg
PW = {"owner": "Owner-pass-123", "billing": "Billing-pass-123", "support": "Support-pass-123", "viewer": "Viewer-pass-123"}
def sign_in(pg, who, code="123456"):
    pg.goto(ORIGIN + "/")
    pg.fill("input[type=email]", who + "@fincom.live"); pg.fill("input[type=password]", PW.get(who, "")); pg.click("button:has-text('Continue')")
    pg.wait_for_selector("input[autocomplete=one-time-code]")
    pg.fill("input[autocomplete=one-time-code]", code); pg.click("button:has-text('Sign in')")
def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
def text(pg): return pg.inner_text("body")
def wait_rows(pg, table):
    pg.wait_for_function("t => { const d = document.querySelector('[data-table=\"' + t + '\"]'); return d && !d.innerText.includes('Reading…'); }", arg=table)
def no_sideways(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


F1, F2 = "00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"
def reason_dialog(pg, reason="ticket 77, by phone with the owner"):
    pg.wait_for_selector("dialog[open] textarea[name=reason]")
    pg.fill("dialog[open] textarea[name=reason]", reason)
    pg.click("dialog[open] [data-testid=reason-confirm]")
def dialog_closed(pg):
    pg.wait_for_function("() => !document.querySelector('dialog[open]')")
def rows(pg, table):
    wait_rows(pg, table); return pg.locator("[data-table=%s] tbody tr" % table).count()
def go_to(pg, path, wait):
    pg.goto(ORIGIN + "/#/" + path); pg.wait_for_selector(wait); pg.wait_for_timeout(150)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "owner"); pg.wait_for_selector("[data-testid=tiles]")
        navs = pg.eval_on_selector_all("nav [data-nav]", "els => els.map(e => e.dataset.nav)")
        ok(all(x in navs for x in ("subscriptions", "credit", "plans", "prices", "billing-runs", "settings")), "owner's menu has the billing screens (%s)" % navs)

        print("== 1. subscriptions")
        pg.click("[data-nav=subscriptions]"); n = rows(pg, "subs")
        ok(n >= 9 and "Garg Shekhar" in text(pg), "the list: every firm with plan, status, credit (%d)" % n)
        shot(pg, "b01-subscriptions")
        pg.click("[data-table=subs] .seg-b:has-text('Needs attention')"); wait_rows(pg, "subs")
        ok(pg.locator("[data-table=subs] tbody tr").count() == 1 and "Past due" in pg.inner_text("[data-table=subs] tbody"), "preset Needs attention: the past-due firm")
        pg.click("[data-table=subs] .seg-b:has-text('All')"); wait_rows(pg, "subs")
        pg.click("[data-table=subs] [data-testid=filters-toggle]"); pg.check("[data-filter='status:active']"); wait_rows(pg, "subs")
        ok("Status: Active" in pg.inner_text("[data-table=subs] .chips") and "Past due" not in pg.inner_text("[data-table=subs] tbody"), "a status filter from the panel, with its chip")
        with pg.expect_download() as dl:
            pg.click("[data-table=subs] [data-testid=export]")
        csv = open(dl.value.path(), encoding="utf-8-sig").read()
        ok(csv.startswith("firm,plan,status") and "past_due" not in csv, "export CSV of the filtered rows")
        go_to(pg, "subscriptions/" + F1, "[data-testid=use-bills]")
        ok(pg.inner_text("[data-testid=fee-total]").startswith("₹") and "Monthly runs" in text(pg), "a firm: usage bars, the next fee, its runs")
        shot(pg, "b02-subscription")
        n0 = rows(pg, "fled")
        pg.click("[data-action='credit.topup']"); pg.fill("[data-testid=topup-amount]", "5,000"); pg.fill("[data-testid=topup-ref]", "UTR-555"); reason_dialog(pg, "paid by NEFT, ticket 9"); dialog_closed(pg)
        pg.wait_for_timeout(300); n1 = rows(pg, "fled")
        ok(n1 == n0 + 1 and "UTR-555" in pg.inner_text("[data-table=fled] tbody"), "top-up: one line with the reference (%d -> %d)" % (n0, n1))
        pg.click("[data-action='credit.topup']"); pg.fill("[data-testid=topup-amount]", "5000"); pg.fill("[data-testid=topup-ref]", "utr-555"); reason_dialog(pg, "pressed it again"); dialog_closed(pg)
        pg.wait_for_timeout(300)
        ok(rows(pg, "fled") == n1, "the same reference again: no second line")
        pg.click("[data-table=fled] tbody tr:has-text('Charge') [data-action='credit.refund'] >> nth=0")
        pg.fill("[data-testid=refund-amount]", "2"); reason_dialog(pg, "charged twice for one statement"); dialog_closed(pg); pg.wait_for_timeout(300)
        ok(rows(pg, "fled") == n1 + 1 and "Refund" in pg.inner_text("[data-table=fled] tbody tr >> nth=0"), "refund part of a charge: a refund line")
        pg.click("[data-action='credit.adjust']"); pg.fill("[data-testid=adjust-amount]", "-1"); reason_dialog(pg, "rounding correction"); dialog_closed(pg); pg.wait_for_timeout(300)
        ok("Adjustment" in pg.inner_text("[data-table=fled] tbody tr >> nth=0"), "adjust with a reason: an adjustment line")
        pg.click("[data-action='credit.topup']"); pg.fill("[data-testid=topup-amount]", "20,00,000"); pg.fill("[data-testid=topup-ref]", "UTR-BIG"); reason_dialog(pg, "too big a top-up")
        pg.wait_for_selector("dialog[open] [role=alert]")
        ok("10,00,000" in pg.inner_text("dialog[open] [role=alert]"), "over ₹10 lakh: refused in plain words, the dialog stays open")
        pg.click("dialog[open] button:has-text('Cancel')"); dialog_closed(pg)
        pg.click("[data-action='sub.change_plan']"); pg.select_option("[data-testid=plan-select]", label="Monthly, all included"); reason_dialog(pg, "owner upgraded on the phone"); dialog_closed(pg)
        pg.wait_for_selector(".facts:has-text('Monthly, all included')")
        ok(True, "change plan: the plan shown changes")
        pg.click("[data-action='sub.set_status']"); pg.select_option("[data-testid=status-select]", "trial"); pg.fill("[data-testid=trial-date]", "2099-01-31")
        reason_dialog(pg, "extend the trial for a demo"); dialog_closed(pg)
        pg.wait_for_selector("[data-testid=sub-chip]:has-text('Trial')")
        ok(True, "set status: a trial with its end date")

        print("== 2. plans")
        pg.click("[data-nav=plans]"); ok(rows(pg, "plans") == 3, "plans: three")
        shot(pg, "b03-plans")
        pg.click("[data-table=plans] tbody tr:has-text('Per client')"); pg.wait_for_selector("[data-field=per_client]")
        ok(pg.input_value("[data-field=per_client]") == "50", "the per-client price is its own field (₹50)")
        pg.fill("[data-field=per_client]", "75"); pg.click("[data-action='plan.save']"); reason_dialog(pg, "the website says 75"); dialog_closed(pg)
        pg.reload(); pg.wait_for_selector("[data-field=per_client]"); pg.wait_for_timeout(300)
        ok(pg.input_value("[data-field=per_client]") == "75", "saved and read back: ₹75")
        go_to(pg, "plans/new", "[data-field=name]")
        pg.fill("[data-field=name]", "Small firm"); pg.fill("[data-field=monthly]", "1,500x")
        ok(pg.is_visible("text=Check: Monthly price") and pg.query_selector("[data-action='plan.save']") is None, "a bad amount: shown, nothing can be sent")
        pg.fill("[data-field=monthly]", "1500"); pg.fill("[data-field=included_users]", "3")
        pg.select_option("[data-item=bills] select", "cap"); pg.fill("[aria-label='Purchase bills allowance']", "300"); pg.fill("[aria-label='Purchase bills price after']", "2")
        pg.fill("textarea[aria-label=Features]", "300 bills a month\nMIS and audit review")
        shot(pg, "b04-plan-new")
        pg.click("[data-action='plan.save']"); reason_dialog(pg, "the Small firm plan from the website"); dialog_closed(pg)
        pg.wait_for_selector("text=0 firms on this plan")
        ok(pg.input_value("[data-field=name]") == "Small firm" and pg.input_value("[aria-label='Purchase bills allowance']") == "300", "created; its page opens with the allowance")

        print("== 3. prices")
        pg.click("[data-nav=prices]"); wait_rows(pg, "prices")
        ok("Not set" in pg.inner_text("[data-table=prices] tr:has-text('OTP')"), "OTP / e-invoice / e-way bill: not priced yet")
        shot(pg, "b05-prices")
        pg.click("[data-table=prices] tbody tr:has-text('OTP')"); pg.wait_for_selector("[data-testid=price-history]")
        pg.click("[data-action='price.set']"); pg.fill("[data-testid=price-input]", "0.25"); reason_dialog(pg, "OTP at 25 paise"); dialog_closed(pg)
        pg.wait_for_selector("[data-testid=price-history] li:has-text('₹0.25')")
        ok("₹0.25" in text(pg), "a price from today, in the history")

        print("== 4. credit")
        pg.click("[data-nav=credit]"); n = rows(pg, "ledger")
        pg.click("[data-table=ledger] [data-testid=filters-toggle]"); pg.check("[data-filter='kind:topup']"); wait_rows(pg, "ledger")
        kinds = set(pg.eval_on_selector_all("[data-table=ledger] tbody td[data-label=Kind]", "els => els.map(e => e.innerText)"))
        ok(kinds == {"Top-up"}, "the all-firms ledger: kind filter (%s)" % kinds)
        with pg.expect_download() as dl:
            pg.click("[data-table=ledger] [data-testid=export]")
        ok(open(dl.value.path(), encoding="utf-8-sig").read().startswith("id,at,firm,kind"), "export CSV")
        shot(pg, "b06-credit")
        pg.click(".tabs a:has-text('Balance = ledger')"); wait_rows(pg, "check")
        pg.click("[data-table=check] .seg-b:has-text('Differs')"); pg.wait_for_selector("[data-table=check] [data-testid=count]:has-text('of 1')")
        ok(pg.locator("[data-table=check] tbody tr").count() == 1 and "Garg Shekhar" in pg.inner_text("[data-table=check] tbody"), "balance = ledger: the one firm that differs (%s)" % pg.inner_text("[data-table=check] tbody")[:300])
        shot(pg, "b07-check")
        pg.click("[data-table=check] [data-action='ledger.fix']"); reason_dialog(pg, "seed difference, reconcile"); dialog_closed(pg)
        pg.wait_for_timeout(300); wait_rows(pg, "check")
        ok(pg.locator("[data-table=check] tbody tr").count() == 0, "fixed with an adjusting line: none differ")
        pg.click(".tabs a:has-text('Clean-up')"); wait_rows(pg, "cleanup")
        ok("Big Test Credit" in pg.inner_text("[data-table=cleanup]"), "clean-up lists the large credit (and does nothing by itself)")
        shot(pg, "b08-cleanup")
        pg.click("[data-table=cleanup] [data-action='cleanup.test_credit']"); reason_dialog(pg, "₹50 Cr test credit of 27-Sep-2026 reversed"); dialog_closed(pg)
        pg.wait_for_timeout(300); wait_rows(pg, "cleanup")
        ok("Big Test Credit" not in pg.inner_text("[data-table=cleanup]"), "pressed: marked as a test firm at ₹10,000; gone from the list")

        print("== 5. monthly run")
        pg.click("[data-nav=billing-runs]"); wait_rows(pg, "runs")
        pg.click("[data-action='billing.run']"); reason_dialog(pg, "the 1st's run by hand"); dialog_closed(pg)
        pg.wait_for_selector("[data-testid=run-result]")
        ok("charged" in pg.inner_text("[data-testid=run-result]"), "Run now: the report (%s)" % pg.inner_text("[data-testid=run-result]"))
        n = rows(pg, "runs")
        pg.click("[data-action='billing.run']"); reason_dialog(pg, "again, to be sure"); dialog_closed(pg); pg.wait_for_timeout(300)
        ok("already done" in pg.inner_text("[data-testid=run-result]") and rows(pg, "runs") == n, "Run now again: already done, nothing charged twice")
        shot(pg, "b09-runs")

        print("== 6. settings")
        pg.click("[data-nav=settings]"); pg.wait_for_selector("[data-setting=start_credit]")
        ok(pg.input_value("[data-setting=start_credit]") == "10000" and pg.input_value("[data-setting=low_credit_warn]") == "500" and pg.input_value("[data-setting=grace_days]") == "7"
           and pg.input_value("[data-setting=paused_after_days]") == "30", "defaults: ₹10,000, ₹500, 7, 30")
        pg.fill("[data-setting=paused_after_days]", "5")
        ok(pg.is_visible("text=paused-after must be more than the grace days"), "paused-after not more than grace: refused on screen")
        pg.fill("[data-setting=paused_after_days]", "30"); pg.fill("[data-setting=start_credit]", "200")
        pg.click("[data-action='settings.billing.set']"); reason_dialog(pg, "trial credit is ₹200 from now"); dialog_closed(pg)
        pg.wait_for_selector("text=Now ₹200")
        ok(True, "saved: start credit ₹200")
        shot(pg, "b10-settings")
        aud = stand_audit()
        for a in ("credit.topup", "credit.refund", "credit.adjust", "sub.change_plan", "sub.set_status", "plan.save", "price.set", "ledger.fix", "cleanup.test_credit", "billing.run", "settings.billing.set"):
            ok(any(x["action"] == a and x.get("reason") for x in aud), "in the change history with its reason: " + a)
        ok(len([x for x in aud if x["action"] == "credit.topup"]) == 1, "the top-up pressed twice: one history row")
        ctx.close()

        print("== 7. roles")
        for who in ("viewer", "support", "billing"):
            ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
            sign_in(pg, who); pg.wait_for_selector("[data-testid=tiles]")
            navs = pg.eval_on_selector_all("nav [data-nav]", "els => els.map(e => e.dataset.nav)")
            go_to(pg, "subscriptions/" + F2, "[data-table=fled]"); wait_rows(pg, "fled")
            money = [a for a in ("credit.topup", "credit.adjust", "credit.refund", "sub.change_plan", "billing.run") if pg.query_selector("[data-action='%s']" % a)]
            if who == "viewer":
                ok("credit" in navs and "settings" not in navs and not money, "Viewer: reads the Credit ledger, no money or plan button (%s)" % money)
                go_to(pg, "credit", "[data-table=ledger]")
                ok(pg.query_selector(".tabs a:has-text('Clean-up')") is None, "Viewer: no clean-up tab")
            if who == "support":
                ok("credit" not in navs and "subscriptions" in navs and not money and pg.locator("[data-table=fled] tbody tr").count() > 0, "Support: no Credit menu; a firm's ledger, no money button (%s)" % navs)
            if who == "billing":
                ok("settings" not in navs and "credit.topup" in money and "billing.run" in money, "Billing: money buttons, no Settings")
                go_to(pg, "credit/check", "[data-table=check]"); wait_rows(pg, "check")
                ok(pg.query_selector(".tabs a:has-text('Clean-up')") is None and pg.query_selector("[data-action='ledger.fix']") is None, "Billing: no clean-up, no fix")
            ctx.close()

        print("== 8. phone and dark")
        ctx, pg = new_page(br, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        sign_in(pg, "owner"); pg.wait_for_selector("[data-testid=tiles]")
        for path, wait in (("subscriptions", "[data-table=subs]"), ("subscriptions/" + F1, "[data-table=fled]"), ("credit", "[data-table=ledger]"), ("credit/check", "[data-table=check]"),
                           ("credit/cleanup", "[data-table=cleanup]"), ("plans", "[data-table=plans]"), ("plans/new", "[data-field=name]"), ("prices", "[data-table=prices]"),
                           ("prices/bills", "[data-testid=price-history]"), ("billing-runs", "[data-table=runs]"), ("settings", "[data-setting=start_credit]")):
            go_to(pg, path, wait)
            ok(no_sideways(pg), "phone: no sideways scroll on " + path)
        go_to(pg, "subscriptions/" + F1, "[data-table=fled]"); shot(pg, "b11-phone-subscription")
        pg.click("[data-action='credit.topup']"); pg.wait_for_selector("dialog[open]"); ok(no_sideways(pg), "phone: the top-up dialog fits"); shot(pg, "b12-phone-topup")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}, color_scheme="dark")
        sign_in(pg, "owner"); pg.wait_for_selector("[data-testid=tiles]")
        for path, wait, name in (("subscriptions/" + F1, "[data-table=fled]", "b13-dark-subscription"), ("plans/new", "[data-field=name]", "b14-dark-plan"), ("credit/check", "[data-table=check]", "b15-dark-check")):
            go_to(pg, path, wait); pg.wait_for_timeout(300); shot(pg, name)
        ok(pg.evaluate("document.documentElement.dataset.theme") == "dark", "dark mode: screenshots")
        ctx.close()
        br.close()
    ok(not errors, "no page errors (%s)" % errors[:3])
    ok(not csp, "no CSP or Trusted Types violation (%s)" % csp[:3])
finally:
    srv.shutdown(); stand.terminate()
    try: out = stand.communicate(timeout=5)[0]
    except Exception: out = ""
    if fails and out: print("stand log:", out[-1500:])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
