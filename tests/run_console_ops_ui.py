"""python3 run_console_ops_ui.py - the console's phase 5 screens (branch next-console-ops) in Chromium (Playwright), against
tests/console_stand.ts (a fake Supabase Auth and the REAL console-admin router and modules; tests/console_ops_fake.ts in
place of migrations 122 / 123 and the providers). The built console (CONSOLE_DIST, else built into $TMPDIR) is served
with console/_headers' own headers, the CSP included (only upgrade-insecure-requests left out: plain http here).
  1. Keys (Owner): every key with its status, filters and presets; a key's page; Replace (write-only: the value never
     appears on the page, only its last 4; the reason required); Test (passed, kept); a function secret: Record rotation,
     no Replace
  2. Announcements: the list; a new one for chosen firms with its preview; Publish with a reason; filters; End now
  3. Feature flags: a new flag; a firm rule; the rules table; one firm's flags with why
  4. Support: presets (SLA breached), a ticket's thread, a reply (emailed), an internal note, status and assignee
  5. See as this firm: from the firm's page; a reason; the read-only view with counts only; the firm's bell notice;
     the views list
  6. System health: tiles, bridges / jobs / queues / cron tables with presets, the Sentry table (a token is set)
  7. Exports: the ledger table and its CSV; Export everything: one .zip with 4 CSVs, audited before and after
  8. roles: Support has no Keys (the page says not for your role); Billing has Exports but no announcement writes;
     Viewer sees tickets with no reply box
  9. phone (390 px): no sideways scroll on any of these screens; dark mode screenshots
 10. no page error and no CSP or Trusted Types violation anywhere"""
import os, sys, json, time, socket, subprocess, threading, functools, http.server, zipfile, io, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
from playwright.sync_api import sync_playwright
import console_dt as dt
SUPA = "https://qbocskaiewaxqcvaunzc.supabase.co"
PAGE_PORT, STAND_PORT = int(os.environ.get("CONSOLE_PAGE_PORT", 8181)), int(os.environ.get("CONSOLE_STAND_PORT", 8182))
ORIGIN = "http://localhost:%d" % PAGE_PORT
SHOTS = os.environ.get("SHOTS") or os.path.join(ROOT, "..", "console-ops-shots")
DENO = os.environ.get("DENO") or subprocess.run(["sh", "-c", "command -v deno"], capture_output=True, text=True).stdout.strip()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)

dist = os.environ.get("CONSOLE_DIST") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "console-ops-dist")
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
stand = subprocess.Popen([DENO, "run", "--allow-net", "--no-lock", os.path.join(HERE, "console_stand.ts"), str(STAND_PORT), ORIGIN], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for _ in range(600):
    try: socket.create_connection(("127.0.0.1", STAND_PORT), 0.2).close(); break
    except OSError: time.sleep(0.1)
os.makedirs(SHOTS, exist_ok=True)
get = lambda p: json.loads(urllib.request.urlopen("http://127.0.0.1:%d%s" % (STAND_PORT, p)).read())
SECRETS = ["sk-ant-api03-OLDVALUE-abcd", "AIzaSyBADVALUE-vision-0000", "g" * 48, "VAULT-ASP-ID-001234", "re_test_resendkey_0001", "1000.ZOHOCLIENTID42", "zoho-secret-value-9999",
           "ENV-ASP-ID-000077", "fyn-relay-key-123456", "sntrys_test_token_0042", "sk-ant-api03-PASTED-new-wxyz"]
errors, csp = [], []
def forward(route):
    rq = route.request
    try: route.fulfill(response=route.fetch(url="http://127.0.0.1:%d%s" % (STAND_PORT, rq.url[len(SUPA):]), headers=rq.all_headers()))
    except Exception as e:
        if "has been closed" in str(e): return       # a request still on its way when its tab was closed
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
def text(pg): return pg.inner_text("body")
def wait_rows(pg, table):
    pg.wait_for_selector("[data-table=\"%s\"]" % table)
    pg.wait_for_function("t => { const d = document.querySelector('[data-table=\"' + t + '\"]'); return d && !d.innerText.includes('Reading…'); }", arg=table)
def count(pg, table): return pg.inner_text("[data-table=\"%s\"] [data-testid=count]" % table)
def wait_count(pg, table, end):
    pg.wait_for_function("([t, e]) => { const c = document.querySelector('[data-table=\"' + t + '\"] [data-testid=count]'); return c && c.innerText.endsWith(e); }", arg=[table, end])
def no_sideways(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def reason(pg, words="checked with the owner"):
    pg.fill("dialog textarea[name=reason]", words); pg.click("dialog [data-testid=reason-confirm]")
    pg.wait_for_selector("dialog[open]", state="detached")
def audit_actions(): return [a["action"] for a in get("/__audit")]
F1 = "00000000-0000-4000-8000-000000000101"

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "owner")

        print("== 1. keys")
        pg.click("[data-nav=keys]"); wait_rows(pg, "keys")
        ok(count(pg, "keys").endswith("of 22"), "every key: 22 (%s)" % count(pg, "keys"))
        ok("Claude API key" in text(pg) and "Bill reading" in text(pg) and "…abcd" in text(pg), "status with the last 4 and what each powers")
        ok(not any(s in pg.content() for s in SECRETS), "no key value anywhere on the page")
        shot(pg, "01-keys")
        pg.click("[data-table=keys] .seg-b:has-text('Not set')"); wait_rows(pg, "keys")
        ok(all("Not set" in r for r in pg.eval_on_selector_all("[data-table=keys] tbody tr", "els => els.map(e => e.innerText)")), "preset: not set")
        dt.pick(pg, "keys", "provider", "Cloudflare"); wait_rows(pg, "keys")
        wait_count(pg, "keys", "of 4")
        ok("provider" in dt.marked(pg, "keys"), "a filter on the provider from its header: 4 Cloudflare keys not set")
        dt.clear_filters(pg, "keys"); pg.click("[data-table=keys] .seg-b:has-text('All')"); wait_rows(pg, "keys")
        pg.click("[data-table=keys] tbody tr:has-text('Claude API key')"); pg.wait_for_selector("text=What stops if this key fails")
        pg.click("[data-action='keys.set']"); pg.wait_for_selector("dialog[open]")
        ok(pg.get_attribute("[data-testid=key-value]", "type") == "password", "the value box hides what is typed")
        pg.fill("[data-testid=key-value]", "sk-ant-api03-PASTED-new-wxyz")
        pg.fill("dialog textarea[name=reason]", "abc"); ok(pg.is_disabled("dialog [data-testid=reason-confirm]"), "a reason of 5 characters is required")
        reason(pg, "yearly rotation")
        pg.wait_for_selector("[data-testid=key-set]:has-text('wxyz')")
        ok("…wxyz" in pg.inner_text("[data-testid=key-set]") and "sk-ant-api03-PASTED" not in pg.content(), "replaced: only the new last 4 is shown")
        ok("yearly rotation" in text(pg) and "last 4 was …abcd" in text(pg), "the reason and the old last 4 kept")
        a = [x for x in get("/__audit") if x["action"] == "keys.set"]
        ok(len(a) == 1 and a[0]["after"]["last4"] == "wxyz" and "PASTED" not in json.dumps(get("/__audit")), "audit: last 4 only")
        pg.click("[data-action='keys.test']"); pg.wait_for_selector("[data-testid=test-result]")
        ok(pg.inner_text("[data-testid=test-result]").startswith("Passed") and get("/__ops")["meta"]["claude_api_key"]["last_test_ok"] is True, "Test: passed, and kept")
        ok(any(u.startswith("https://api.anthropic.com/v1/models") for u in get("/__ops")["outbound"]), "Test called Anthropic's models list")
        shot(pg, "02-key-claude")
        pg.goto(ORIGIN + "/#/keys/RESEND_API_KEY"); pg.wait_for_selector("text=supabase secrets set")
        ok(pg.query_selector("[data-action='keys.set']") is None and pg.query_selector("[data-action='keys.rotated']") is not None, "a function secret: Record rotation, no Replace")
        pg.click("[data-action='keys.rotated']"); reason(pg, "rotated in Supabase after staff change")
        pg.wait_for_selector("text=rotated in Supabase after staff change")
        ok(True, "rotation recorded with its reason")
        shot(pg, "03-key-env")

        print("== 2. announcements")
        pg.click("[data-nav=announcements]"); wait_rows(pg, "ann")
        ok("Maintenance tonight" in text(pg), "the list")
        pg.click("[data-testid=ann-new]"); pg.wait_for_selector("[data-testid=ann-title]")
        pg.fill("[data-testid=ann-title]", "ABC: please call us"); pg.fill("[data-testid=ann-body]", "About your GST filing.")
        pg.select_option("[data-testid=ann-severity]", "urgent"); pg.select_option("[data-testid=ann-audience]", "firms")
        pg.fill("input[aria-label='Find a firm']", "ABC"); pg.check("[data-firm='ABC Associates']")
        ok(pg.is_visible("[data-testid=ann-preview].ann-urgent") and "ABC: please call us" in pg.inner_text("[data-testid=ann-preview]"), "the preview of the bar")
        shot(pg, "04-announcement-form")
        pg.click("[data-action='announcements.save'] >> nth=1"); reason(pg, "GSTN asked us to tell ABC")
        pg.wait_for_selector("[data-testid=ann-state]:has-text('live')")
        ok("1 firms" in text(pg), "published: live, for 1 firm")
        pg.click("[data-action='announcements.end']"); reason(pg, "the firm called back")
        pg.wait_for_selector("[data-testid=ann-state]:has-text('ended')")
        ok(pg.query_selector("[data-action='announcements.save']") is None, "ended: kept, no longer changeable")
        pg.click("[data-nav=announcements]"); wait_rows(pg, "ann")
        pg.click("[data-table=ann] .seg-b:has-text('Ended')"); wait_rows(pg, "ann")
        ok("ABC: please call us" in pg.inner_text("[data-table=ann]") and "Maintenance tonight" not in pg.inner_text("[data-table=ann]"), "preset: ended")
        ok({"announcements.save", "announcements.end"} <= set(audit_actions()), "audited")
        shot(pg, "05-announcements")

        print("== 3. feature flags")
        pg.click("[data-nav=flags]"); wait_rows(pg, "flags")
        ok("zoho_books" in text(pg) and "new_tds_screen" in text(pg), "the list")
        pg.click("[data-action='flags.save']"); pg.fill("[data-testid=flag-key]", "calls_recording"); pg.fill("[data-testid=flag-desc]", "Record meetings")
        reason(pg, "pilot for recording")
        pg.wait_for_selector("h1:has-text('calls_recording')")
        pg.click("[data-action='flags.rule_set']"); pg.select_option("[data-testid=rule-target]", label="ABC Associates")
        reason(pg, "ABC asked to try it")
        wait_count(pg, "rules", "of 1")
        ok("ABC Associates" in pg.inner_text("[data-table=rules]") and "On" in pg.inner_text("[data-table=rules]"), "a firm rule in the rules table")
        shot(pg, "06-flag")
        pg.click("[data-nav=flags]"); wait_rows(pg, "flags")
        pg.select_option("[data-testid=flag-firm]", label="ABC Associates"); wait_rows(pg, "ff")
        row = [r for r in pg.eval_on_selector_all("[data-table=ff] tbody tr", "els => els.map(e => e.innerText)") if "calls_recording" in r]
        ok(row and "On" in row[0] and "firm's rule" in row[0], "one firm's flags with why (%s)" % row)

        print("== 4. support")
        pg.click("[data-nav=support]"); wait_rows(pg, "tk")
        ok(count(pg, "tk").endswith("of 2"), "every ticket")
        pg.click("[data-table=tk] .seg-b:has-text('SLA breached')"); wait_rows(pg, "tk"); wait_count(pg, "tk", "of 1")
        ok("Cannot post to Tally" in pg.inner_text("[data-table=tk]"), "preset: SLA breached")
        shot(pg, "07-tickets")
        pg.click("[data-table=tk] tbody tr >> nth=0"); pg.wait_for_selector("[data-testid=thread]")
        pg.fill("[data-testid=reply-body]", "We are looking at it now."); pg.click("[data-testid=reply-send]")
        pg.wait_for_selector("[data-testid=ticket-msg]:has-text('emailed')")
        ok(pg.eval_on_selector_all("[data-testid=thread] li", "els => els.length") == 2 and "waiting" in pg.inner_text("[data-testid=t-status]").lower(), "a reply: in the thread, waiting on the firm, emailed")
        pg.check("[data-testid=reply-internal]"); pg.fill("[data-testid=reply-body]", "Bridge is 2.3.0, ask to update"); pg.click("[data-testid=reply-send]")
        pg.wait_for_selector("[data-internal='1']")
        ok(True, "an internal note, marked as such")
        pg.select_option("[data-testid=t-set-status]", "resolved"); pg.select_option("[data-testid=t-set-assignee]", "support@fincom.live"); pg.click("[data-testid=t-save]")
        pg.wait_for_selector("[data-testid=t-status]:has-text('Resolved')")
        t = [x for x in get("/__ops")["tickets"] if x["status"] == "resolved"]
        ok(t and t[0]["assignee"] == "support@fincom.live", "status and assignee saved")
        ok({"support.reply", "support.note", "support.set"} <= set(audit_actions()), "audited")
        ok(pg.is_visible("[data-testid=ticket-seeas]"), "See as this firm from the ticket")
        shot(pg, "08-ticket")

        print("== 5. see as this firm")
        pg.goto(ORIGIN + "/#/firms/" + F1); pg.wait_for_selector("[data-testid=firm-seeas]"); pg.click("[data-testid=firm-seeas]")
        pg.wait_for_selector("[data-action='seeas.open']"); pg.click("[data-action='seeas.open']")
        ok("The firm will see this in its bell" in pg.inner_text("dialog"), "the dialog says the firm is told")
        reason(pg, "ticket T-1001: Tally posting fails")
        pg.wait_for_selector("[data-testid=seeas-view]")
        v = pg.inner_text("[data-testid=seeas-view]")
        ok("Read-only view of" in v and "ABC Associates" in v and pg.is_visible("[data-testid=seeas-counts-only]"), "the read-only view: counts only")
        bell = get("/__ops")["bell"]
        ok(bell and bell[-1]["firm_id"] == F1 and bell[-1]["words"].startswith("FinCom support viewed your account on") and bell[-1]["words"].endswith(": ticket T-1001: Tally posting fails"), "the firm's bell notice")
        ok("seeas.open" in audit_actions(), "audited")
        wait_rows(pg, "fviews"); ok("ticket T-1001" in pg.inner_text("[data-table=fviews]"), "the earlier views of this firm")
        shot(pg, "09-seeas")
        pg.click("[data-nav=seeas]"); wait_rows(pg, "views")
        ok("ABC Associates" in pg.inner_text("[data-table=views]"), "Firm views: the log")

        print("== 6. system health")
        pg.click("[data-nav=health]"); pg.wait_for_selector("[data-testid=health-tiles]"); wait_rows(pg, "hb")
        ok("1 of 3" in pg.inner_text("[data-testid=health-tiles]"), "tiles: bridges online")
        pg.click("[data-table=hb] .seg-b:has-text('Offline')"); wait_count(pg, "hb", "of 1")
        ok("GSC-OLD" in pg.inner_text("[data-table=hb]"), "bridges: offline preset")
        pg.click("[data-table=hj] .seg-b:has-text('Stuck')"); wait_count(pg, "hj", "of 1")
        ok("stuck" in pg.inner_text("[data-table=hj]"), "jobs: stuck preset")
        wait_rows(pg, "hq"); wait_rows(pg, "hc")
        ok("pgmq: tally_recorder" in pg.inner_text("[data-table=hq]") and "tally-post-register-settle" in pg.inner_text("[data-table=hc]"), "queues and scheduled jobs")
        pg.wait_for_selector("[data-testid=sentry]"); wait_rows(pg, "hs")
        ok("TypeError: x is undefined" in pg.inner_text("[data-table=hs]") and pg.query_selector("[data-table=hs] a[href^='javascript']") is None, "Sentry: the top issues; only sentry.io links")
        ok("sntrys_test_token" not in pg.content(), "the Sentry token never reaches the page")
        shot(pg, "10-health")

        print("== 7. exports")
        pg.click("[data-nav=exports]"); wait_rows(pg, "led")
        ok(count(pg, "led").endswith("of 3"), "the ledger, all firms")
        with pg.expect_download() as dl: pg.click("[data-table=led] [data-testid=export]")
        c = open(dl.value.path(), encoding="utf-8-sig").read()
        ok(c.startswith("at,firm,kind,code,qty,amount,amount_paise") and "'=opening" in c, "ledger CSV (a formula made plain text)")
        pg.click("[data-action='exports.all']"); pg.fill("dialog textarea[name=reason]", "monthly backup")
        with pg.expect_download() as dl: pg.click("dialog [data-testid=reason-confirm]")
        z = zipfile.ZipFile(dl.value.path())
        ok(sorted(z.namelist()) == ["audit.csv", "firms.csv", "ledger.csv", "users.csv"] and z.testzip() is None, "Export everything: one valid .zip with 4 CSVs")
        ok(z.read("firms.csv").decode("utf-8-sig").startswith("id,name,owner_email") and "ABC Associates" in z.read("firms.csv").decode("utf-8-sig"), "firms.csv")
        pg.wait_for_selector("[data-testid=export-done]")
        acts = audit_actions()
        ok("exports.all" in acts and "exports.all.done" in acts and "led.export" not in acts and "exports.ledger.export" in acts, "audited: before, after (with counts), and the ledger CSV")
        shot(pg, "11-exports")
        ctx.close()

        print("== 8. roles")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "support")
        navs = pg.eval_on_selector_all("nav [data-nav]", "els => els.map(e => e.dataset.nav)")
        ok("keys" not in navs and "exports" not in navs and "support" in navs and "seeas" in navs, "Support's menu: no Keys, no Exports (%s)" % navs)
        pg.goto(ORIGIN + "/#/keys"); pg.wait_for_selector("text=Not for your role"); ok(True, "#/keys: not for Support")
        pg.goto(ORIGIN + "/#/flags/zoho_books"); pg.wait_for_selector("h1:has-text('zoho_books')")
        ok(pg.query_selector("[data-action='flags.rule_set']") is None, "Support cannot change flags")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "billing")
        navs = pg.eval_on_selector_all("nav [data-nav]", "els => els.map(e => e.dataset.nav)")
        ok("exports" in navs and "keys" not in navs and "seeas" not in navs, "Billing: Exports, no Keys, no Firm views (%s)" % navs)
        pg.goto(ORIGIN + "/#/announcements"); wait_rows(pg, "ann")
        ok(pg.query_selector("[data-testid=ann-new]") is None, "Billing cannot make announcements")
        pg.goto(ORIGIN + "/#/exports"); wait_rows(pg, "led")
        ok(pg.query_selector("[data-action='exports.all']") is None, "Billing: no Export everything")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "viewer")
        pg.goto(ORIGIN + "/#/support"); wait_rows(pg, "tk"); pg.click("[data-table=tk] tbody tr >> nth=0"); pg.wait_for_selector("[data-testid=thread]")
        ok(pg.query_selector("[data-testid=reply-body]") is None and pg.query_selector("[data-testid=ticket-seeas]") is None, "Viewer: no reply box, no See as")
        ctx.close()

        print("== 9. phone and dark")
        ctx, pg = new_page(br, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        sign_in(pg, "owner")
        for path, wait in (("keys", "[data-table=keys]"), ("keys/claude_api_key", "text=What stops"), ("announcements", "[data-table=ann]"), ("announcements/new", "[data-testid=ann-title]"),
                           ("flags", "[data-table=flags]"), ("flags/zoho_books", "[data-table=rules]"), ("support", "[data-table=tk]"), ("support/00000000-0000-4000-8000-000000000502", "[data-testid=thread]"),
                           ("seeas", "[data-table=views]"), ("seeas/" + F1, "[data-action='seeas.open']"), ("health", "[data-table=hb]"), ("exports", "[data-table=led]")):
            pg.goto(ORIGIN + "/#/" + path); pg.wait_for_selector(wait); pg.wait_for_timeout(250)
            ok(no_sideways(pg), "phone: no sideways scroll on " + path)
        pg.goto(ORIGIN + "/#/health"); pg.wait_for_selector("[data-table=hb]"); wait_rows(pg, "hb"); shot(pg, "12-phone-health")
        pg.goto(ORIGIN + "/#/support/00000000-0000-4000-8000-000000000501"); pg.wait_for_selector("[data-testid=thread]"); shot(pg, "13-phone-ticket")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}, color_scheme="dark")
        sign_in(pg, "owner")
        ok(pg.evaluate("document.documentElement.dataset.theme") == "dark", "dark mode")
        pg.goto(ORIGIN + "/#/keys"); wait_rows(pg, "keys"); shot(pg, "14-dark-keys")
        pg.goto(ORIGIN + "/#/announcements/new"); pg.wait_for_selector("[data-testid=ann-title]"); pg.fill("[data-testid=ann-title]", "Maintenance on Sunday"); shot(pg, "15-dark-announcement")
        pg.goto(ORIGIN + "/#/health"); wait_rows(pg, "hb"); shot(pg, "16-dark-health")
        ctx.close()
        br.close()
    ok(not errors, "no page errors (%s)" % errors[:3])
    ok(not csp, "no CSP or Trusted Types violation (%s)" % csp[:3])
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:400])
finally:
    srv.shutdown(); stand.terminate()
    try: out = stand.communicate(timeout=5)[0]
    except Exception: out = ""
    if fails and out: print("stand log:", out[-1500:])
print("\nscreenshots: " + SHOTS)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
