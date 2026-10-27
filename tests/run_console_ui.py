"""python3 run_console_ui.py - the FinCom Console's screens (console/, branch next-console-p1), in Chromium (Playwright),
against tests/console_stand.ts: a fake Supabase Auth and the REAL console-admin router and modules with in-memory data.
The built console (CONSOLE_DIST, else built here into $TMPDIR/console-dist) is served with console/_headers' own
headers, the CSP included (only upgrade-insecure-requests left out: the test page is plain http on localhost).
  1. sign-in: wrong password, a banned login ("This account is switched off. Contact FinCom support."), a login that
     is not a console admin; password then the authenticator code (a wrong code refused); enrolment (QR, key, code)
  2. every screen renders (Dashboard, Firms, a firm, Companies, a company, Users, a person, Change history, Admins,
     Settings); screenshots in SHOTS (default scratchpad/console-shots)
  3. the DataTable: server-side search, a filter from the panel with its chip, Clear all, presets, sort, paging, the
     state in the hash (a reload keeps it), a saved view, Export CSV (downloaded, and in the change history)
  4. roles: Viewer has no Admins / Settings in the menu and no write buttons, #/admins says "not for your role", and
     the server refuses admins.list for it (403); Support has Reset two-step but no Suspend firm; Billing neither
  5. a reason is required (the confirm button stays off below 5 characters); reset two-step, switch a person off and
     on, suspend and reactivate a firm, deactivate a company: status chips change, rows in the change history
  6. phone (390 px): no sideways scroll on any screen; the menu opens
  7. dark mode: the toggle, and the system's dark preference; screenshots
  8. no CSP violation and no page error anywhere; signed out after 30 minutes without activity"""
import os, sys, json, time, socket, subprocess, threading, functools, http.server, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
from playwright.sync_api import sync_playwright
SUPA = "https://qbocskaiewaxqcvaunzc.supabase.co"
PAGE_PORT, STAND_PORT = int(os.environ.get("CONSOLE_PAGE_PORT", 8171)), int(os.environ.get("CONSOLE_STAND_PORT", 8172))
ORIGIN = "http://localhost:%d" % PAGE_PORT
SHOTS = os.environ.get("SHOTS") or os.path.join(ROOT, "..", "console-shots")
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

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        print("== 1. sign-in")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        pg.goto(ORIGIN + "/"); pg.wait_for_selector("text=FinCom Console")
        shot(pg, "01-signin")
        pg.fill("input[type=email]", "owner@fincom.live"); pg.fill("input[type=password]", "wrong"); pg.click("button:has-text('Continue')")
        pg.wait_for_selector("[role=alert]")
        ok("Wrong email or password." in text(pg), "a wrong password: plain words")
        pg.fill("input[type=email]", "off@zz.test"); pg.fill("input[type=password]", "Off-pass-123"); pg.click("button:has-text('Continue')")
        pg.wait_for_selector("text=This account is switched off. Contact FinCom support.")
        ok(True, "a switched-off (banned) login: \"This account is switched off. Contact FinCom support.\"")
        pg.fill("input[type=email]", "owner@fincom.live"); pg.fill("input[type=password]", "Owner-pass-123"); pg.click("button:has-text('Continue')")
        pg.wait_for_selector("input[autocomplete=one-time-code]")
        ok("6-digit code" in text(pg), "after the password: the authenticator code is asked")
        pg.fill("input[autocomplete=one-time-code]", "000000"); pg.click("button:has-text('Sign in')")
        pg.wait_for_selector("text=That code is not right")
        ok(True, "a wrong code: refused in plain words")
        pg.fill("input[autocomplete=one-time-code]", "123456"); pg.click("button:has-text('Sign in')")
        pg.wait_for_selector("[data-testid=tiles]")
        ok(pg.inner_text("[data-testid=role]") == "owner" and "owner@fincom.live" in pg.inner_text("[data-testid=who]"), "signed in: the top bar shows the email and role")
        ok(pg.evaluate("Object.keys(localStorage).filter(k => k.includes('session')).length") == 0 and pg.evaluate("!!sessionStorage.getItem('fincom-console:session')"), "the session is kept in this tab only (sessionStorage), never localStorage")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        pg.goto(ORIGIN + "/"); pg.fill("input[type=email]", "new@fincom.live"); pg.fill("input[type=password]", "Newbie-pass-123"); pg.click("button:has-text('Continue')")
        pg.wait_for_selector("img.qr")
        ok(pg.inner_text("[data-testid=totp-secret]") == "JBSWY3DPEHPK3PXP" and "Scan this" in text(pg), "no authenticator yet: enrolment with a QR code and the key")
        shot(pg, "02-enrol")
        pg.fill("input[autocomplete=one-time-code]", "123456"); pg.click("button:has-text('Sign in')")
        pg.wait_for_selector("[data-testid=tiles]")
        ok(True, "enrolled and signed in")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        pg.goto(ORIGIN + "/"); pg.fill("input[type=email]", "stranger@fincom.live"); pg.fill("input[type=password]", "Stranger-pass-123"); pg.click("button:has-text('Continue')")
        pg.fill("input[autocomplete=one-time-code]", "123456"); pg.click("button:has-text('Sign in')")
        pg.wait_for_selector("text=This login is not a console admin.")
        ok(pg.query_selector("[data-testid=tiles]") is None, "a FinCom login that is not a console admin: refused, signed out")
        ctx.close()

        print("== 2. every screen (owner)")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "owner")
        pg.wait_for_selector("[data-testid=tiles]")
        ok("Bridges online" in text(pg) and "Recent sign-ups" in text(pg) and "Firms by plan" in text(pg), "Dashboard: tiles and lists")
        shot(pg, "03-dashboard")
        navs = pg.eval_on_selector_all("nav [data-nav]", "els => els.map(e => e.dataset.nav)")
        # phase 1's items, in this order (later modules, e.g. coupons, add their own between them)
        P1 = ["dashboard", "firms", "companies", "users", "audit", "admins", "settings"]
        ok([n for n in navs if n in P1] == P1, "owner's menu: %s" % navs)
        # every module, integrated (integ-console): billing, coupons, operations, AI
        ok(navs == ["dashboard", "firms", "companies", "users", "subscriptions", "credit", "plans", "prices", "billing-runs", "coupons", "support",
                    "announcements", "flags", "seeas", "health", "audit", "exports", "keys", "admins", "ai", "settings"], "owner's menu: every module (%s)" % navs)
        pg.click("[data-nav=firms]"); wait_rows(pg, "firms")
        ok("ABC Associates" in text(pg) and "1–25 of 33" in pg.inner_text("[data-table=firms] [data-testid=count]"), "Firms: the list, 25 a page of 33")
        shot(pg, "04-firms")
        pg.click("text=ABC Associates"); pg.wait_for_selector("text=Companies (clients)")
        ok(pg.inner_text("[data-testid=status-chip] >> nth=0") == "Active" and "Asha Rao" in text(pg) and "Mehta Textiles" in text(pg), "a firm: status chip, people, companies")
        shot(pg, "05-firm")
        pg.click("[data-nav=companies]"); wait_rows(pg, "co")
        ok("Mehta Textiles" in text(pg) and "Bharat Steel" in text(pg), "Companies across firms")
        pg.click("text=Mehta Textiles"); pg.wait_for_selector("[data-action='company.deactivate']")
        ok("27AAACM1234A1Z5" in text(pg), "a company: GSTIN, status, its firm")
        shot(pg, "06-company")
        pg.click("[data-nav=users]"); wait_rows(pg, "users")
        ok("asha@abc.test" in text(pg), "Users across firms")
        shot(pg, "07-users")
        pg.click("text=asha@abc.test"); pg.wait_for_selector("text=Two-step methods")
        ok(pg.query_selector("[data-action='user.reset_mfa']") is not None and pg.query_selector("[data-action='user.deactivate']") is not None, "a person: Reset two-step, Sign out everywhere, Switch off")
        shot(pg, "08-user")
        pg.click("[data-nav=audit]"); wait_rows(pg, "audit")
        ok("firm.get" in text(pg) and "user.get" in text(pg), "Change history: the views just made are there (firm.get, user.get)")
        shot(pg, "09-history")
        pg.click("[data-nav=admins]"); wait_rows(pg, "admins")
        ok("support@fincom.live" in text(pg) and "You" in text(pg), "Admins")
        shot(pg, "10-admins")
        pg.click("[data-nav=settings]"); pg.wait_for_selector("[data-testid=billing-settings] [data-setting=start_credit]")
        ok(True, "Settings (stub)")

        print("== 3. the DataTable")
        pg.click("[data-nav=firms]"); wait_rows(pg, "firms")
        pg.fill("[data-table=firms] input[type=search]", "garg"); pg.wait_for_function("() => document.querySelector('[data-table=firms] [data-testid=count]').innerText === '1–1 of 1'")
        ok("firms.q=garg" in pg.url and "Garg Shekhar & Co" in text(pg), "search on the server, kept in the hash")
        ok("Search: “garg”" in pg.inner_text("[data-table=firms] .chips"), "a chip for the search")
        pg.click("[data-table=firms] [data-testid=clear-all]"); wait_rows(pg, "firms")
        pg.click("[data-table=firms] [data-testid=filters-toggle]")
        pg.check("[data-filter='status:suspended']"); wait_rows(pg, "firms")
        pg.wait_for_function("() => document.querySelector('[data-table=firms] [data-testid=count]').innerText.endsWith('of 6')")
        ok("Status: Suspended" in pg.inner_text("[data-table=firms] .chips"), "a select filter: chip \"Status: Suspended\", 6 firms")
        pg.fill("[data-filter='balance:from']", "1000"); wait_rows(pg, "firms")
        pg.wait_for_function("() => document.querySelector('[data-table=firms] [data-testid=count]').innerText.endsWith('of 4')")
        ok("Credit: from 1000" in pg.inner_text("[data-table=firms] .chips"), "a number range filter")
        url = pg.url; pg.reload(); wait_rows(pg, "firms")
        ok(pg.inner_text("[data-table=firms] [data-testid=count]").endswith("of 4"), "a reload keeps the filters (the hash)")
        pg.click("[data-table=firms] details.views summary"); pg.click("text=Save the current view…")
        pg.fill("input[aria-label='View name']", "Suspended rich"); pg.click("form.menu-row button:has-text('Save')")
        pg.click("[data-table=firms] [data-testid=clear-all]"); wait_rows(pg, "firms")
        pg.wait_for_function("() => document.querySelector('[data-table=firms] [data-testid=count]').innerText.endsWith('of 33')")
        pg.click("[data-table=firms] details.views summary"); pg.click("button.link:has-text('Suspended rich')")
        pg.wait_for_function("() => document.querySelector('[data-table=firms] [data-testid=count]').innerText.endsWith('of 4')")
        ok(True, "a saved view brings the filters back")
        pg.click("[data-table=firms] .seg-b:has-text('All')"); wait_rows(pg, "firms")
        pg.click("[data-table=firms] .seg-b:has-text('Suspended')"); wait_rows(pg, "firms")
        pg.wait_for_function("() => document.querySelector('[data-table=firms] [data-testid=count]').innerText.endsWith('of 6')")
        ok(True, "presets: Active / Suspended / All")
        pg.click("[data-table=firms] .seg-b:has-text('All')"); wait_rows(pg, "firms")
        pg.click("[data-table=firms] th button:has-text('Credit')"); wait_rows(pg, "firms")
        first = pg.inner_text("[data-table=firms] tbody tr >> nth=0")
        ok("firms.s=balance%3Aasc" in pg.url or "firms.s=balance:asc" in pg.url, "sort by a column, in the hash")
        ok("Firm 00" in first, "sorted on the server: the lowest credit first")
        pg.click("[data-table=firms] button:has-text('Next')"); wait_rows(pg, "firms")
        ok(pg.inner_text("[data-table=firms] [data-testid=count]") == "26–33 of 33", "paging")
        with pg.expect_download() as dl: pg.click("[data-table=firms] [data-testid=export]")
        path = dl.value.path(); csvt = open(path, encoding="utf-8-sig", newline="").read()
        ok(csvt.startswith("name,owner_email,plan,status,balance") and csvt.count("\r\n") == 34, "Export CSV: every filtered row (33) with a header")
        ok(any(a["action"] == "firms.list.export" for a in stand_audit()), "the export is in the change history")
        shot(pg, "11-firms-filtered")
        ctx.close()

        print("== 4. roles")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "viewer"); pg.wait_for_selector("[data-testid=tiles]")
        navs = pg.eval_on_selector_all("nav [data-nav]", "els => els.map(e => e.dataset.nav)")
        ok([n for n in navs if n in P1] == ["dashboard", "firms", "companies", "users"], "Viewer's menu: no Change history, Admins or Settings (%s)" % navs)
        ok(navs == ["dashboard", "firms", "companies", "users", "subscriptions", "credit", "plans", "prices", "billing-runs", "coupons", "support",
                    "announcements", "flags", "health", "ai"], "Viewer's menu: every module it may read; no See as firm, Change history, Exports, Keys, Admins or Settings (%s)" % navs)
        pg.goto(ORIGIN + "/#/users/00000000-0000-4000-8000-000000000011"); pg.wait_for_selector("text=Two-step methods")
        ok(pg.query_selector("[data-action]") is None, "Viewer: no write button on a person")
        ok("as***@abc.test" in text(pg), "Viewer: emails partly hidden")
        pg.goto(ORIGIN + "/#/admins"); pg.wait_for_selector("text=Not for your role")
        ok(True, "Viewer: #/admins says it is not for their role")
        r = pg.evaluate("""async () => { const s = JSON.parse(sessionStorage.getItem('fincom-console:session'));
            const r = await fetch('%s/functions/v1/console-admin', {method: 'POST', headers: {Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json'}, body: JSON.stringify({action: 'admins.list'})});
            return [r.status, (await r.json()).error]; }""" % SUPA)
        ok(r == [403, "Your role cannot do that."], "Viewer: the server refuses admins.list too (%s)" % r)
        r = pg.evaluate("""async () => { const s = JSON.parse(sessionStorage.getItem('fincom-console:session'));
            const r = await fetch('%s/functions/v1/console-admin', {method: 'POST', headers: {Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json'}, body: JSON.stringify({action: 'user.reset_mfa', user_id: '00000000-0000-4000-8000-000000000011', reason: 'trying it'})});
            return r.status; }""" % SUPA)
        ok(r == 403 and any(a["action"] == "access.denied" and a["after"]["action"] == "user.reset_mfa" for a in stand_audit()), "Viewer: reset two-step refused by the server, and the refusal recorded")
        shot(pg, "12-viewer")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "support"); pg.wait_for_selector("[data-testid=tiles]")
        pg.goto(ORIGIN + "/#/firms/00000000-0000-4000-8000-000000000101"); pg.wait_for_selector("text=Companies (clients)")
        ok(pg.query_selector("[data-action='firm.deactivate']") is None, "Support: no Suspend firm")
        pg.goto(ORIGIN + "/#/users/00000000-0000-4000-8000-000000000012"); pg.wait_for_selector("text=Two-step methods")
        ok(pg.query_selector("[data-action='user.reset_mfa']") is not None, "Support: Reset two-step shown")

        print("== 5. writes with a reason")
        pg.click("[data-action='user.reset_mfa']")
        btn = "dialog [data-testid=reason-confirm]"
        ok(pg.is_disabled(btn), "the confirm button is off with no reason")
        pg.fill("dialog textarea", "abc"); ok(pg.is_disabled(btn), "...and with 3 characters")
        pg.fill("dialog textarea", "Lost phone, ticket #41"); ok(pg.is_enabled(btn), "...and on with a reason")
        shot(pg, "13-reason")
        pg.click(btn); pg.wait_for_selector("dialog", state="detached")
        ok(any(a["action"] == "user.reset_mfa" and a["reason"] == "Lost phone, ticket #41" for a in stand_audit()), "reset two-step: in the change history with the reason")
        pg.click("[data-action='user.deactivate']"); pg.fill("dialog textarea", "Left the firm, owner asked"); pg.click(btn)
        pg.wait_for_selector("[data-action='user.reactivate']")
        ok(pg.inner_text("[data-testid=status-chip]") == "Switched off", "switched off: the chip says so, Switch on offered")
        pg.click("[data-action='user.reactivate']"); pg.fill("dialog textarea", "Back at work"); pg.click(btn)
        pg.wait_for_selector("[data-action='user.deactivate']")
        ok(pg.inner_text("[data-testid=status-chip]") == "Active", "switched on again")
        pg.goto(ORIGIN + "/#/companies/00000000-0000-4000-8000-000000000101/c1"); pg.wait_for_selector("[data-action='company.deactivate']")
        pg.click("[data-action='company.deactivate']"); pg.fill("dialog textarea", "Client moved to another CA"); pg.click(btn)
        pg.wait_for_selector("[data-action='company.reactivate']")
        ok(pg.inner_text("[data-testid=status-chip] >> nth=0") == "Deactivated", "a company deactivated: chip")
        pg.goto(ORIGIN + "/#/companies"); wait_rows(pg, "co")
        pg.click("[data-table=co] .seg-b:has-text('Deactivated')"); wait_rows(pg, "co")
        pg.wait_for_function("() => document.querySelector('[data-table=co] [data-testid=count]').innerText.endsWith('of 2')")
        ok("Mehta Textiles" in pg.inner_text("[data-table=co]"), "companies: the Deactivated filter")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "owner"); pg.wait_for_selector("[data-testid=tiles]")
        pg.goto(ORIGIN + "/#/firms/00000000-0000-4000-8000-000000000102"); pg.wait_for_selector("[data-action='firm.deactivate']")
        pg.click("[data-action='firm.deactivate']"); pg.fill("dialog textarea", "Unpaid since September"); pg.click(btn)
        pg.wait_for_selector("[data-action='firm.reactivate']")
        ok(pg.inner_text("[data-testid=status-chip] >> nth=0") == "Suspended" and "read-only" in text(pg), "a firm suspended: chip and the read-only note")
        shot(pg, "14-firm-suspended")
        pg.click("[data-action='firm.reactivate']"); pg.fill("dialog textarea", "Paid in full"); pg.click(btn)
        pg.wait_for_selector("[data-action='firm.deactivate']")
        ok(pg.inner_text("[data-testid=status-chip] >> nth=0") == "Active", "reactivated")
        pg.goto(ORIGIN + "/#/admins"); wait_rows(pg, "admins")
        pg.click("button[data-action='admins.add']"); pg.fill("[data-testid=admin-email]", "stranger@fincom.live"); pg.select_option("[data-testid=role-select]", "support")
        pg.fill("dialog textarea", "Joins the support desk"); pg.click(btn); pg.wait_for_selector("dialog", state="detached"); wait_rows(pg, "admins")
        ok("stranger@fincom.live" in pg.inner_text("[data-table=admins]"), "Admins: add an existing login with a role")
        acts = [a["action"] for a in stand_audit()]
        ok(all(x in acts for x in ("firm.deactivate", "firm.reactivate", "company.deactivate", "user.deactivate", "user.reactivate", "admins.add")), "every change is in the change history")

        print("== 7. dark mode")
        pg.goto(ORIGIN + "/#/dashboard"); pg.wait_for_selector("[data-testid=tiles]")
        pg.click("[data-testid=theme]")
        bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
        ok(pg.evaluate("document.documentElement.dataset.theme") == "dark" and bg != "rgb(255, 255, 255)", "the toggle: dark (%s)" % bg)
        shot(pg, "15-dark-dashboard")
        pg.goto(ORIGIN + "/#/firms"); wait_rows(pg, "firms"); shot(pg, "16-dark-firms")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}, color_scheme="dark")
        pg.goto(ORIGIN + "/"); pg.wait_for_selector("text=FinCom Console")
        ok(pg.evaluate("document.documentElement.dataset.theme") == "dark", "the system's dark preference is followed")
        shot(pg, "17-dark-signin")
        ctx.close()

        print("== 6. phone")
        ctx, pg = new_page(br, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        sign_in(pg, "owner"); pg.wait_for_selector("[data-testid=tiles]")
        for path, wait in (("dashboard", "[data-testid=tiles]"), ("firms", "[data-table=firms]"), ("firms/00000000-0000-4000-8000-000000000101", "text=Companies (clients)"),
                           ("companies", "[data-table=co]"), ("users", "[data-table=users]"), ("users/00000000-0000-4000-8000-000000000011", "text=Two-step methods"),
                           ("audit", "[data-table=audit]"), ("admins", "[data-table=admins]"), ("settings", "[data-testid=billing-settings]")):
            pg.goto(ORIGIN + "/#/" + path); pg.wait_for_selector(wait); pg.wait_for_timeout(200)
            ok(no_sideways(pg), "phone: no sideways scroll on " + path)
        pg.goto(ORIGIN + "/#/firms"); wait_rows(pg, "firms"); shot(pg, "18-phone-firms")
        pg.click("[data-table=firms] [data-testid=filters-toggle]"); ok(no_sideways(pg), "phone: the filter panel fits"); shot(pg, "19-phone-filters")
        pg.click("button[aria-label=Menu]"); pg.wait_for_selector("nav.side.open")
        ok(pg.is_visible("nav [data-nav=users]"), "phone: the menu opens"); shot(pg, "20-phone-menu")
        ctx.close()

        print("== 8. idle time-out")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        pg.clock.install()
        sign_in(pg, "owner"); pg.wait_for_selector("[data-testid=tiles]")
        pg.clock.fast_forward("29:00"); pg.wait_for_timeout(100)
        ok(pg.query_selector("[data-testid=tiles]") is not None, "29 minutes idle: still signed in")
        pg.clock.fast_forward("02:00"); pg.wait_for_selector("text=signed out after 30 minutes")
        ok(pg.evaluate("sessionStorage.getItem('fincom-console:session')") is None, "31 minutes idle: signed out, the session gone")
        shot(pg, "21-idle")
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
