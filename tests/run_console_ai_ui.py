"""python3 run_console_ai_ui.py - the console's AI control centre (console/src/modules/ai, branch next-console-ai), in
Chromium (Playwright), against tests/console_stand.ts (the REAL console-admin router and modules; the AI part's data in
tests/console_stand_ai.ts). The built console (CONSOLE_DIST, else built here into $TMPDIR/console-ai-dist) is served
with console/_headers' own headers (the CSP).
  1. Usage: the tiles, the cost-against-charged line chart (its crosshair tooltip on hover), cost by feature, top
     firms, by model; the date range (7 days, a custom range) changes the table and the charts together; a filter on the
     table (Feature: Bill reading) and a preset ("Losing money") change the charts too; Export CSV is downloaded and in
     the change history
  2. Features: On / Off / All presets; a feature's page; the Owner switches TDS challan match off with a reason (the
     list then shows it Off) and sets its model; a billing item's price is not offered
  3. Kill switch: "Stop all AI now" needs a reason; the banner then says all AI is stopped; back on
  4. Plans and Firms: Billing sets a plan's allowance (₹500, stop) and a firm's override (AI off, one feature off); each
     is in the change history; the Firms list's presets (AI off)
  5. roles: the Viewer sees the AI menu and the numbers but no write button; Billing has no "Stop all AI now" and no
     feature Change; the server refuses ai.kill for Billing (403)
  6. phone (390 px): no sideways scroll on any AI screen; dark mode (the toggle): the charts' dark steps; screenshots
     in SHOTS (default ../console-ai-shots)
  7. no CSP violation and no page error anywhere"""
import os, sys, json, time, socket, subprocess, threading, functools, http.server
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, ".."))
from playwright.sync_api import sync_playwright
SUPA = "https://qbocskaiewaxqcvaunzc.supabase.co"
PAGE_PORT, STAND_PORT = int(os.environ.get("CONSOLE_PAGE_PORT", 8191)), int(os.environ.get("CONSOLE_STAND_PORT", 8192))
ORIGIN = "http://localhost:%d" % PAGE_PORT
SHOTS = os.environ.get("SHOTS") or os.path.join(ROOT, "..", "console-ai-shots")
DENO = os.environ.get("DENO") or subprocess.run(["sh", "-c", "command -v deno"], capture_output=True, text=True).stdout.strip() or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)

dist = os.environ.get("CONSOLE_DIST") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "console-ai-dist")
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
def stand_audit():
    import urllib.request
    return json.loads(urllib.request.urlopen("http://127.0.0.1:%d/__audit" % STAND_PORT).read())
errors, csp = [], []
def forward(route):
    rq = route.request
    try: route.fulfill(response=route.fetch(url="http://127.0.0.1:%d%s" % (STAND_PORT, rq.url[len(SUPA):]), headers=rq.all_headers()))
    except Exception as e: route.abort(); errors.append("forward: " + str(e))
def new_page(br, **kw):
    ctx = br.new_context(accept_downloads=True, **kw)
    pg = ctx.new_page()
    pg.route(SUPA + "/**", forward)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: (csp.append(m.text) if "Content Security Policy" in m.text else None))
    pg.add_init_script("document.addEventListener('securitypolicyviolation', e => console.error('Content Security Policy violation: ' + e.violatedDirective + ' ' + e.blockedURI))")
    return ctx, pg
PW = {"owner": "Owner-pass-123", "billing": "Billing-pass-123", "support": "Support-pass-123", "viewer": "Viewer-pass-123"}
def sign_in(pg, who):
    pg.goto(ORIGIN + "/")
    pg.fill("input[type=email]", who + "@fincom.live"); pg.fill("input[type=password]", PW[who]); pg.click("button:has-text('Continue')")
    pg.wait_for_selector("input[autocomplete=one-time-code]"); pg.fill("input[autocomplete=one-time-code]", "123456"); pg.click("button:has-text('Sign in')")
    pg.wait_for_selector("[data-testid=tiles]")
def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
def text(pg): return pg.inner_text("body")
def wait_rows(pg, table):
    pg.wait_for_function("t => { const d = document.querySelector('[data-table=\"' + t + '\"]'); return d && !d.innerText.includes('Reading…'); }", arg=table)
def tiles(pg):
    pg.wait_for_selector("[data-testid=ai-tiles]")
    pg.wait_for_function("() => !document.querySelector('[data-testid=ai-tiles]').closest('[style*=\"opacity: 0.6\"]')")
    return pg.inner_text("[data-testid=ai-tiles]")
def reason(pg, words="the owner asked by phone"):
    pg.wait_for_selector("dialog[open]")
    pg.fill("dialog[open] textarea[name=reason]", words); pg.click("dialog[open] [data-testid=reason-confirm]")
    pg.wait_for_selector("dialog[open]", state="detached")
def rows_settle(pg, table, n):
    # after a preset: wait until the table shows n rows (the refetch lands after the click), else read what is there
    try: pg.wait_for_function("([t, n]) => document.querySelectorAll('[data-table=\"' + t + '\"] tbody tr').length === n", arg=[table, n], timeout=10000)
    except Exception: pass
    return pg.eval_on_selector_all("[data-table=%s] tbody tr" % table, "rs => rs.map(r => r.innerText)")
def no_sideways(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        print("== 1. Usage")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "owner")
        ok(pg.query_selector("nav [data-nav=ai]") is not None, "the AI menu")
        pg.click("[data-nav=ai]"); wait_rows(pg, "aiu")
        t30 = tiles(pg)
        ok("AI calls" in t30 and "FinCom's cost" in t30 and "Charged to firms" in t30 and "Margin" in t30, "the four tiles")
        ok(pg.query_selector("[data-testid=chart-cost] svg path.ai-line.s1") and pg.query_selector("[data-testid=chart-cost] svg path.ai-line.s2"), "the cost and charged lines")
        ok(len(pg.query_selector_all("[data-testid=by-feature] li")) >= 5 and len(pg.query_selector_all("[data-testid=top-firms] li")) == 6, "cost by feature; top firms")
        box = pg.query_selector("[data-testid=chart-cost] svg").bounding_box()
        pg.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.5)
        pg.wait_for_selector(".ai-tip")
        ok("FinCom's cost" in pg.inner_text(".ai-tip") and "charged" in pg.inner_text(".ai-tip") and "calls" in pg.inner_text(".ai-tip"), "hover: the day's cost, charged and calls")
        shot(pg, "ai-01-usage")
        n30 = pg.inner_text("[data-table=aiu] [data-testid=count]")
        pg.click(".ai-filters button:has-text('7 days')"); wait_rows(pg, "aiu")
        t7 = tiles(pg)
        n7 = pg.inner_text("[data-table=aiu] [data-testid=count]")
        ok(t7 != t30 and n7 != n30 and "ai.from=" in pg.url, "7 days: the tiles and the table change together, kept in the address (%s / %s)" % (n30, n7))
        pg.fill("[data-testid=from]", "2026-01-01"); wait_rows(pg, "aiu")
        ok("ai.from=2026-01-01" in pg.url, "a custom start date")
        pg.click(".ai-filters button:has-text('30 days')"); wait_rows(pg, "aiu")
        # a filter on the table: the charts follow
        pg.click("[data-table=aiu] [data-testid=filters]") if pg.query_selector("[data-table=aiu] [data-testid=filters]") else None
        pg.evaluate("""() => { const u = new URL(location.href); const h = u.hash.split('?'); const q = new URLSearchParams(h[1] || '');
            q.set('aiu.f', JSON.stringify({feature: {op: 'in', values: ['bill_read']}})); location.hash = h[0] + '?' + q.toString(); }""")
        wait_rows(pg, "aiu")
        pg.wait_for_function("() => document.querySelectorAll('[data-testid=by-feature] li').length === 1")
        ok(pg.inner_text("[data-testid=by-feature]").startswith("Bill reading"), "Feature = Bill reading: the charts show only it")
        ok(all("Bill reading" in r for r in pg.eval_on_selector_all("[data-table=aiu] tbody tr", "rs => rs.map(r => r.innerText)")), "and the table")
        ok("-" in pg.inner_text("[data-testid=ai-tiles]").split("Margin")[1].split("\n")[1], "bill reading loses money today (cost estimated ₹4.25 a read, charged ₹3): the margin is negative")
        shot(pg, "ai-02-usage-bill-read")
        pg.click("[data-table=aiu] button:has-text('Losing money')"); wait_rows(pg, "aiu")
        ok(pg.query_selector("[data-table=aiu] tbody tr") is not None, "the Losing money preset")
        with pg.expect_download() as d:
            pg.click("[data-table=aiu] [data-testid=export]")
        ok(d.value.suggested_filename.startswith("ai-usage-") and any(a["action"] == "ai.usage.list.export" for a in stand_audit()), "Export CSV downloaded and in the change history")

        print("== 2. Features")
        pg.click(".ai-tabs a:has-text('Features')"); wait_rows(pg, "aif")
        ok("TDS challan match" in text(pg) and "Bill reading" in text(pg), "the registry")
        shot(pg, "ai-03-features")
        pg.click("[data-table=aif] tbody tr:has-text('TDS challan match')")
        pg.wait_for_selector("text=Where in the code")
        pg.click("[data-action='ai.feature.set']")
        pg.wait_for_selector("dialog[open]")
        pg.uncheck("dialog[open] .ai-check:has-text('On') input")
        pg.select_option("dialog[open] select:near(:text('Model'))", "claude-haiku-5-5")
        ok(pg.is_disabled("dialog[open] [data-testid=reason-confirm]"), "no reason: Save stays off")
        shot(pg, "ai-04-feature-edit")
        reason(pg, "testing the switch")
        pg.wait_for_selector(".card h2:has-text('TDS challan match') .chip:has-text('Off')")
        a = [x for x in stand_audit() if x["action"] == "ai.feature.set"][-1]
        ok(a["after"].get("enabled") is False and a["after"].get("model") == "claude-haiku-5-5" and a["reason"] == "testing the switch", "switched off with its model, the reason in the change history")
        pg.click("text=← All features"); wait_rows(pg, "aif")
        pg.click("[data-table=aif] button.seg-b:text-is('Off')"); wait_rows(pg, "aif")
        rows = rows_settle(pg, "aif", 1)
        ok(len(rows) == 1 and "TDS challan match" in rows[0], "the Off preset: just it")
        pg.goto(ORIGIN + "/#/ai/features/bill_read"); pg.wait_for_selector("text=Where in the code")
        pg.click("[data-action='ai.feature.set']"); pg.wait_for_selector("dialog[open]")
        ok(pg.query_selector("dialog[open] select:near(:text('Priced to the firm'))") is None and "billing item" in text(pg), "bill reading's price is the billing item's: not offered here")
        pg.click("dialog[open] button:has-text('Cancel')")

        print("== 3. Kill switch")
        pg.click("[data-action='ai.kill']"); reason(pg, "a key may have leaked")
        pg.wait_for_selector("[data-testid=kill]:has-text('All AI is stopped')")
        ok("a key may have leaked" in pg.inner_text("[data-testid=kill]"), "stopped, with the reason")
        shot(pg, "ai-05-killed")
        pg.click("[data-action='ai.kill']"); reason(pg, "key replaced, all good")
        pg.wait_for_selector("[data-testid=kill]:has-text('AI is running')")
        ok([x["action"] for x in stand_audit() if x["action"] in ("ai.kill", "ai.unkill")] == ["ai.kill", "ai.unkill"], "both in the change history")
        ctx.close()

        print("== 4. Plans and Firms (Billing)")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "billing")
        pg.goto(ORIGIN + "/#/ai"); pg.wait_for_selector("[data-testid=kill]")
        ok(pg.query_selector("[data-action='ai.kill']") is None, "Billing: no Stop all AI now")
        pg.click(".ai-tabs a:has-text('Plans')"); wait_rows(pg, "aip")
        pg.click("[data-table=aip] tbody tr:has-text('Pay as you go')"); pg.wait_for_selector("[data-testid=plan-edit]")
        pg.click("[data-testid=plan-edit] [data-action='ai.plan.set']"); pg.wait_for_selector("dialog[open]")
        pg.fill("dialog[open] input[type=number]", "500"); pg.select_option("dialog[open] select", "stop")
        reason(pg, "plan v2 includes AI")
        wait_rows(pg, "aip")
        a = [x for x in stand_audit() if x["action"] == "ai.plan.set"][-1]
        ok(a["after"] == {"allowance_paise": 50000, "after_allowance": "stop"} and a["role"] == "billing", "₹500 then stop, as paise, audited as Billing")
        pg.wait_for_function("() => document.querySelector('[data-table=aip]').innerText.includes('₹500')")
        ok(True, "the plans list shows ₹500")
        shot(pg, "ai-06-plans")
        pg.click(".ai-tabs a:has-text('Firms')"); wait_rows(pg, "aifm")
        pg.click("[data-table=aifm] tbody tr:has-text('ABC Associates')"); pg.wait_for_selector("[data-testid=firm-edit]")
        pg.click("[data-testid=firm-edit] [data-action='ai.firm.set']"); pg.wait_for_selector("dialog[open]")
        pg.check("dialog[open] [data-testid=firm-ai-off]"); pg.check("dialog[open] .ai-check:has-text('Voice typing') input")
        shot(pg, "ai-07-firm-edit")
        reason(pg, "the firm asked for AI off")
        a = [x for x in stand_audit() if x["action"] == "ai.firm.set"][-1]
        ok(a["after"]["ai_off"] is True and a["after"]["features_off"] == ["voice"], "AI off and voice off for ABC, audited")
        wait_rows(pg, "aifm")
        pg.click("[data-table=aifm] button.seg-b:text-is('AI off')"); wait_rows(pg, "aifm")
        rows = rows_settle(pg, "aifm", 1)
        ok(len(rows) == 1 and "ABC Associates" in rows[0], "the AI off preset")
        r = pg.evaluate("""async () => { const s = JSON.parse(sessionStorage.getItem('fincom-console:session'));
            const r = await fetch('%s/functions/v1/console-admin', {method: 'POST', headers: {Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json'}, body: JSON.stringify({action: 'ai.kill', on: true, reason: 'trying it'})});
            return [r.status, (await r.json()).reason]; }""" % SUPA)
        ok(r == [403, "role"], "the server refuses ai.kill for Billing: %s" % r)
        pg.goto(ORIGIN + "/#/ai/features/voice"); pg.wait_for_selector("text=Where in the code")
        ok(pg.query_selector("[data-action='ai.feature.set']") is None, "Billing: no feature Change")
        ctx.close()

        print("== 5. Viewer")
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900})
        sign_in(pg, "viewer")
        pg.click("[data-nav=ai]"); wait_rows(pg, "aiu"); tiles(pg)
        for path, table in (("ai", "aiu"), ("ai/features", "aif"), ("ai/plans", "aip"), ("ai/firms", "aifm")):
            pg.goto(ORIGIN + "/#/" + path); wait_rows(pg, table)
            ok(pg.query_selector("[data-action^='ai.']") is None, "Viewer on %s: no write button" % path)
        ctx.close()

        print("== 6. phone and dark")
        ctx, pg = new_page(br, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        sign_in(pg, "owner")
        for path, table in (("ai", "aiu"), ("ai/features", "aif"), ("ai/plans", "aip"), ("ai/firms", "aifm"), ("ai/features/tds_match", None)):
            pg.goto(ORIGIN + "/#/" + path)
            if table: wait_rows(pg, table)
            else: pg.wait_for_selector("text=Where in the code")
            ok(no_sideways(pg), "phone: no sideways scroll on #/" + path)
        pg.goto(ORIGIN + "/#/ai"); wait_rows(pg, "aiu"); tiles(pg)
        shot(pg, "ai-08-phone")
        ctx.close()
        ctx, pg = new_page(br, viewport={"width": 1360, "height": 900}, color_scheme="dark")
        sign_in(pg, "owner")
        if pg.evaluate("document.documentElement.dataset.theme") != "dark": pg.click("[data-testid=theme]")
        pg.goto(ORIGIN + "/#/ai"); wait_rows(pg, "aiu"); tiles(pg)
        c = pg.evaluate("getComputedStyle(document.querySelector('path.ai-line.s1')).stroke")
        ok(pg.evaluate("document.documentElement.dataset.theme") == "dark" and c == "rgb(57, 135, 229)", "dark: the chart's dark blue step (%s)" % c)
        shot(pg, "ai-09-dark")
        ctx.close()
        br.close()
    print("== 7. errors")
    ok(not errors, "no page error: %s" % errors[:3])
    ok(not csp, "no CSP violation: %s" % csp[:3])
finally:
    stand.terminate(); srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
