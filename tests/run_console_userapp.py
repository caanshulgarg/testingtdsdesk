"""python3 run_console_userapp.py - the user app's side of FinCom's console (console phase 1b, 27-Oct-2026):
  1. the platform administration screens are gone from Settings (Platform: firms, credit, plans, prices, add a firm,
     new accounts, keys, voice minutes of all firms; "Unlock administration"), for a platform administrator too; a
     firm's owner keeps Plan and credit (read-only, said so), the credit history, Sign-in and people, AI help
  2. one small "Admin console" link, in Settings, for FinCom's own people only (platform_admins), to the build's
     console address (console-staging.fincom.live on the testing site) in a new tab
  3. the firm paused by the console (my_firm_status): one calm line "Your firm's FinCom account is paused: <reason>.
     You can still view your work. Contact FinCom."; the write buttons, drop boxes and file pickers held back with
     that reason; uploads and posting to Tally refused; changes made here not sent; on again: all back
  4. a login switched off by the console (banned): the sign-in page says "This account is switched off. Contact
     FinCom support."
  5. a company switched off: left out of the client lists (Clients, the switcher, Today) unless "Show inactive" is
     ticked, then marked Switched off; opened: one read-only line; its uploads and posting to Tally refused; a change
     coming from Realtime (the clients row) or the console's signal is taken at once
  6. billing's stages (integ-console): read-only for the fee: the line says how to come back (Plan and credit, a coupon),
     writes held back, the work still shown, the coupon's Apply usable; paused for the fee: the firm's work hidden behind
     the paused page, Plan and credit (its coupon box) and Help still open; active again: all back
Offline, made-up clients, the cloud faked in the page. SHOT_TAG=before|after and SHOTS=<dir> save the screenshots
(before: on the build without these changes, asserts not counted).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_console_userapp.py"""
import os, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
TAG = os.environ.get("SHOT_TAG", "after")
SHOTS = os.environ.get("SHOTS", os.environ.get("TDSDESK_OUT", "out"))
os.makedirs(SHOTS, exist_ok=True)
PORT = 8771
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(H, directory=SITE)).serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PAUSED = "Your firm’s FinCom account is paused: unpaid since September. You can still view your work. Contact FinCom."
OFFLINE = "This account is switched off. Contact FinCom support."

def fake(route):
    u, req = route.request.url, route.request
    j = lambda code, body: route.fulfill(status=code, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
    if req.method == "OPTIONS": return route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})
    if "/auth/v1/settings" in u: return j(200, {"external": {"email": True}})
    # the sign-in function as deployed today passes Auth's own words on ("User is banned"); the new one says user_off
    if "/functions/v1/signin" in u: return j(400, {"ok": False, "error": "User is banned"})
    return j(404, {})

SEED = """() => {
  const mk = (name, gstin) => { const c = newCompany({name, gstin}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; };
  window.__A = mk("Alpha Traders Pvt Ltd", "09AANFG3202D1ZR"); window.__B = mk("Beta Exports LLP", "27AAACX9999X1ZA");
  window.__calls = []; window.__fs = {status: "active", reason: null}; window.__off = [];
  Cloud.on = () => true; Cloud.aal = () => 'aal2'; window.__cc = {url: 'https://x.supabase.co', key: 'anon', auto: true}; Cloud.cfg = () => window.__cc; Cloud.setCfg = (o) => Object.assign(window.__cc, o);
  window.startCloudSync = () => {}; window.loadAccount = async () => S.account;
  Cloud.rpc = async (n, a) => { window.__calls.push(['rpc', n, a]); if (n === 'my_firm_status') return window.__fs; if (n === 'tally_post_enqueue' || n === 'tally_post_enqueue_to') return {ok: true}; return []; };
  Cloud.api = async (p, o) => { window.__calls.push(['api', p, (o || {}).method || 'GET']); if (/^clients\\?select=id,status/.test(p)) return window.__off; return []; };
  Cloud.fn = async (n, a) => { window.__calls.push(['fn', n, a]); return {}; };
  Cloud.st = Object.assign(Cloud.st, {email: 'owner@firm.test', role: 'owner', firm: 'f1', mfa: null, mfaInfo: {enrolled: true, admin: true}, members: []});
  S.account = {me: {role: 'owner', email: 'owner@firm.test'}, superadmin: true, firm: {id: 'f1', name: 'Garg & Co', balance: 4200, warn_at: 500, period_start: '2026-10-01', plan: {name: 'Starter', monthly_fee: 999, includes: {}}},
    modules: [{code: 'bills', title: 'Reading bills', billing: 'unit', price: 2, unit: 'per page', enabled: true}], usage: [{code: 'bills', qty: 12, spent: 24}],
    people: [{name: 'Asha', email: 'owner@firm.test', role: 'owner', active: true}, {name: 'Bina', email: 'b@firm.test', role: 'staff', active: true}]};
  S.adminData = {month: 1200, firms: [{id: 'f1', name: 'Garg & Co', active: true, plan_id: 'p1', balance: 4200, used_this_period: 300, people: 2, modules: []}], plans: [{id: 'p1', name: 'Starter', monthly_fee: 999, includes: {}}],
    modules: [{code: 'bills', title: 'Reading bills', price: 2, unit: 'per page', billing: 'unit'}], signup: {open: true, trial_credit: 10000, plan: 'Starter'}, secrets: [{name: 'claude_api_key', tail: 'x9', updated_at: '2026-09-01T00:00:00Z'}]};
  S.firmSetupLater = true; S.view = 'home'; S.homeTab = 'clients'; render();
}"""
GATE = "() => typeof FirmGate === 'object'"
TOAST = "() => (document.getElementById('toast') || {}).innerText || ''"

with sync_playwright() as p:
    br = p.chromium.launch()
    def page(vp=None, scheme="light"):
        ctx = br.new_context(viewport=vp or {"width": 1400, "height": 900}, color_scheme=scheme)
        ctx.route("https://*.supabase.co/**", fake)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        if TAG == "before":       # the build without these changes: its screens only, nothing of the new code asked
            ev = pg.evaluate
            def safe(*a, **k):
                try: return ev(*a, **k)
                except Exception: return None
            pg.evaluate = safe
        return ctx, pg
    def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, TAG + "-" + name + ".png"), full_page=True)
    def offline(pg):
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
        pg.wait_for_timeout(800); pg.evaluate(SEED); pg.wait_for_timeout(500)

    print("1. the platform administration screens are gone; the firm's own plan, credit and people stay")
    ctx, pg = page(); offline(pg)
    has_gate = pg.evaluate(GATE)
    pg.evaluate("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'platform'; render(); }"); pg.wait_for_timeout(600)
    shot(pg, "settings-platform")
    nav = pg.inner_text("#app .setnav")
    ok("Platform" not in nav and "Administrator" not in nav, "Settings has no Administrator › Platform section, for a platform administrator too (%r)" % nav[-160:])
    body = pg.inner_text("#app")
    ok(pg.locator('select[aria-label^="Plan of"]').count() == 0 and pg.locator("#sec_claude_api_key").count() == 0 and pg.locator("#nfName").count() == 0
       and "Add credit" not in body and "Run this month's charges" not in body and "Anyone may create an account" not in body and "Keys (only you)" not in body,
       "no firm list, plan picker, add credit, prices, add a firm, plans editor, monthly run, new-account settings or keys")
    pg.evaluate("() => { S.settingsTab = 'account'; render(); }"); pg.wait_for_timeout(500)
    shot(pg, "settings-account")
    ok("Unlock administration" not in pg.inner_text("#app") and "Platform administration is locked" not in pg.inner_text("#app"), "no “Unlock administration” in Sign-in and people")
    ok(pg.locator('button:text-is("Invite by email")').count() == 1 and pg.locator('tr[data-key="b@firm.test"]').count() == 1, "the owner's people: listed, with Invite by email")
    pg.evaluate("() => { S.settingsTab = 'plan'; S.walletOpen = true; S.wallet = [{at: '2026-10-02T10:00:00Z', kind: 'credit', amount: 5000, balance_after: 5000, note: 'UPI'}, {at: '2026-10-03T10:00:00Z', kind: 'use', code: 'bills', amount: -2, balance_after: 4998}]; render(); }"); pg.wait_for_timeout(500)
    shot(pg, "settings-plan")
    t = pg.inner_text("#app .setbody")
    ok("Credit left" in t and "Starter" in t and pg.locator('#app .setbody select').count() == 0 and "Credit added" in t, "Plan and credit: the plan, the credit left and its history, nothing to change")
    ok(pg.locator("[data-plan-readonly]").count() == 1 and "FinCom sets the plan" in t, "and it says FinCom sets them")
    pg.evaluate("() => { S.settingsTab = 'ai'; render(); }"); pg.wait_for_timeout(500)
    ok(pg.inner_text("#app .sethead h2") == "AI help", "AI help stays in Settings")

    print("2. the Admin console link: FinCom's own people only, in a new tab, the build's address")
    pg.evaluate("() => { S.settingsTab = 'firm'; render(); }"); pg.wait_for_timeout(400)
    shot(pg, "settings-admin-link")
    a = pg.locator("[data-admin-console] a")
    ok(a.count() == 1 and a.get_attribute("href") == "https://console-staging.fincom.live" and a.get_attribute("target") == "_blank" and "noopener" in (a.get_attribute("rel") or ""),
       "a platform administrator: one “Admin console” link to console-staging.fincom.live, new tab (%s)" % (a.get_attribute("href") if a.count() else None))
    pg.evaluate("() => { S.account.superadmin = false; Cloud.st.mfaInfo = {enrolled: true, admin: false}; render(); }"); pg.wait_for_timeout(400)
    ok(pg.locator("[data-admin-console]").count() == 0, "a firm's owner who is not FinCom's: no link")
    shot(pg, "settings-owner-nolink")
    pg.evaluate("() => { Cloud.st.mfaInfo = {enrolled: true, admin: true}; render(); }"); pg.wait_for_timeout(300)
    ok(pg.locator("[data-admin-console] a").count() == 1, "platform_admins without the two-step code yet (mfa_status admin): the link too")
    pg.evaluate("() => { Cloud.st.mfaInfo = {enrolled: true, admin: false}; render(); }")

    print("3. the firm paused by the console")
    pg.evaluate("() => { window.__fs = {status: 'suspended', reason: 'unpaid since September', at: '2026-10-27T10:00:00Z'}; S.view = 'home'; S.homeTab = 'clients'; render(); }")
    pg.evaluate("() => typeof FirmGate === 'object' && FirmGate.load()"); pg.wait_for_timeout(700)
    shot(pg, "paused-clients")
    ban = pg.locator("[data-gate-banner]")
    ok(ban.count() == 1 and ban.get_attribute("data-gate-banner") == "paused" and PAUSED in ban.inner_text(), "one calm line: %r" % (ban.inner_text() if ban.count() else ""))
    ok(any(c[0] == "rpc" and c[1] == "my_firm_status" for c in pg.evaluate("window.__calls")), "read through my_firm_status()")
    add = pg.locator("button[data-add-client]")
    ok(add.count() == 1 and add.get_attribute("aria-disabled") == "true" and add.get_attribute("title") == PAUSED, "Add client held back, its title the reason")
    if add.count(): add.click(force=True); pg.wait_for_timeout(300)
    ok(not pg.evaluate("!!S.addingCo") and PAUSED in pg.evaluate(TOAST), "pressed: nothing happens but the reason (%r)" % pg.evaluate(TOAST))
    pg.evaluate("() => openCompany(window.__A)"); pg.wait_for_timeout(900)
    shot(pg, "paused-client")
    pg.evaluate("() => { S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(700)
    shot(pg, "paused-purchase")
    drop = pg.evaluate("() => Array.from(document.querySelectorAll('#app .drop, #app #drop')).map(e => e.classList.contains('fc-gated') && e.title)")
    ok(TAG == "before" or (drop and all(d and "paused" in d for d in drop)), "Purchase: the drop box held back with the reason (%s)" % drop)
    ok(pg.locator("[data-gate-banner]").count() == 1, "the line on a client's page too")
    gated = pg.evaluate("() => Array.from(document.querySelectorAll('#app .fc-gated')).map(e => e.tagName + '.' + e.className).slice(0, 8)")
    ok(len(gated) > 0, "the client's write buttons and drop box held back (%s)" % gated)
    chooser = []
    pg.on("filechooser", lambda fc: chooser.append(fc))
    n0 = pg.evaluate("Object.keys(S.data[window.__A].entries).length")
    pg.evaluate("() => { const el = document.getElementById('fileIn'); if (el) el.click(); }"); pg.wait_for_timeout(500)
    pg.evaluate("() => handleFiles([new File(['%PDF-1.4'], 'bill.pdf', {type: 'application/pdf'})], 'company')"); pg.wait_for_timeout(500)
    ok(not chooser and pg.evaluate("Object.keys(S.data[window.__A].entries).length") == n0 and PAUSED in pg.evaluate(TOAST), "an upload: no file picker, nothing taken, the reason said")
    r = None if TAG == "before" else pg.evaluate("() => Bridge.post({company: 'ALPHA', client: window.__A, masters: [], vouchers: [{id: 'v1', xml: '<VOUCHER><DATE>20261001</DATE></VOUCHER>'}]})")
    ok(bool(r) and r["results"][0]["ok"] is False and PAUSED in r["results"][0]["message"] and not any(c[1] in ("tally_post_enqueue", "tally_post_enqueue_to") for c in pg.evaluate("window.__calls")),
       "posting to Tally: refused here with the reason, nothing queued")
    pg.evaluate("() => { window.__pushed = 0; window.cloudPush = async () => { window.__pushed++; return 1; }; window.cloudPull = async () => 0; }")
    pg.evaluate("() => cloudSync(false)"); pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__pushed") == 0, "changes made here are not sent while paused (kept on this computer)")
    pg.evaluate("() => { window.__fs = {status: 'active'}; return FirmGate.load(); }"); pg.wait_for_timeout(600)
    ok(pg.locator("[data-gate-banner]").count() == 0 and pg.evaluate("document.querySelectorAll('.fc-gated').length") == 0, "on again: the line gone, every button back")
    pg.evaluate("() => cloudSync(false)"); pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__pushed") == 1, "and changes are sent again")
    # on a phone and in dark mode, the line reads
    ctx2, pg2 = page({"width": 390, "height": 844}, "dark"); offline(pg2)
    pg2.evaluate("() => { window.__fs = {status: 'suspended', reason: 'unpaid since September'}; return typeof FirmGate === 'object' && FirmGate.load(); }"); pg2.wait_for_timeout(700)
    shot(pg2, "paused-phone-dark")
    ok(pg2.evaluate("document.documentElement.scrollWidth <= 392"), "phone: no sideways scroll with the line")
    ctx2.close()

    print("4. a login switched off by the console: the sign-in page says so")
    ctx3, pg3 = page()
    pg3.goto("http://localhost:%d/" % PORT); pg3.wait_for_timeout(2500)
    BTN = '#app .signin-box button[type="submit"]'
    pg3.fill('#app input[data-cloud="email"]', "off@firm.test"); pg3.click(BTN); pg3.wait_for_timeout(400)
    pg3.fill('#app input[data-cloud="password"]', "secret-123"); pg3.click(BTN); pg3.wait_for_timeout(1200)
    shot(pg3, "signin-switched-off")
    card = pg3.inner_text("#app .signin-box")
    ok(OFFLINE in card and "banned" not in card.lower(), "the card says: %r" % card[-140:])
    ctx3.close()

    print("5. a company switched off")
    pg.evaluate("() => { window.__off = [{id: window.__B, status: 'deactivated', status_reason: 'the client closed down'}]; S.view = 'home'; S.homeTab = 'clients'; S.showInactive = false; return typeof FirmGate === 'object' && FirmGate.load(); }"); pg.wait_for_timeout(700)
    shot(pg, "clients-inactive-hidden")
    names = pg.inner_text("#app")
    ok("Alpha Traders" in names and "Beta Exports" not in names, "Clients: the switched-off company left out")
    tg = pg.locator("[data-show-inactive] input")
    ok(tg.count() == 1 and "Show inactive (1)" in pg.inner_text("[data-show-inactive]"), "a “Show inactive (1)” tick")
    ok([c["name"] for c in pg.evaluate("sortedCompanies()")] == ["Alpha Traders Pvt Ltd"], "the switcher's and Today's list too (sortedCompanies)")
    if tg.count(): tg.check(); pg.wait_for_timeout(400)
    shot(pg, "clients-inactive-shown")
    ok("Beta Exports" in pg.inner_text("#app") and pg.locator("[data-client-off]").count() == 1, "ticked: shown, marked Switched off")
    pg.evaluate("() => openCompany(window.__B)"); pg.wait_for_timeout(900)
    shot(pg, "company-off-open")
    ban = pg.locator("[data-gate-banner]")
    want = "Beta Exports LLP is switched off by FinCom: the client closed down. You can still view its work; uploads and posting to Tally are off."
    ok(ban.count() == 1 and ban.get_attribute("data-gate-banner") == "company-off" and want in ban.inner_text(), "opened: one read-only line (%r)" % (ban.inner_text() if ban.count() else ""))
    held = pg.evaluate("() => Array.from(document.querySelectorAll('#app .fc-gated')).map(e => e.title)")
    ok(TAG == "before" or (held and all(t == want for t in held)), "its write buttons held back with that reason (%d)" % len(held or []))
    n0 = pg.evaluate("Object.keys(S.data[window.__B].entries).length")
    pg.evaluate("() => handleFiles([new File(['%PDF-1.4'], 'bill.pdf', {type: 'application/pdf'})], 'company')"); pg.wait_for_timeout(400)
    ok(pg.evaluate("Object.keys(S.data[window.__B].entries).length") == n0 and want in pg.evaluate(TOAST), "its uploads refused with the reason")
    r = None if TAG == "before" else pg.evaluate("() => Bridge.post({company: 'BETA', client: window.__B, masters: [], vouchers: [{id: 'v2', xml: '<VOUCHER><DATE>20261001</DATE></VOUCHER>'}]})")
    ok(bool(r) and r["results"][0]["ok"] is False and want in r["results"][0]["message"], "its posting to Tally refused with the reason")
    pg.evaluate("() => openCompany(window.__A)"); pg.wait_for_timeout(700)
    ok(pg.locator("[data-gate-banner]").count() == 0 and pg.evaluate("document.querySelectorAll('.fc-gated').length") == 0, "another company: as before")
    # Realtime: the clients row as the console changed it
    pg.evaluate("() => { S.showInactive = false; Live.change({table: 'clients', record: Object.assign({}, {id: window.__B, data: S.companies[window.__B], deleted: false, updated_at: new Date().toISOString(), status: 'active'})}); }"); pg.wait_for_timeout(500)
    ok(pg.evaluate("sortedCompanies().length") == 2, "switched on again from the console: back in the list at once (Realtime)")
    pg.evaluate("() => FirmGate.row({id: window.__B, status: 'deactivated', status_reason: 'again'})"); pg.wait_for_timeout(300)
    ok(pg.evaluate("sortedCompanies().length") == 1, "and off again")
    # the console's signal (firm_signals, when the database has it): the firm read again within a second
    pg.evaluate("() => { window.__fs = {status: 'closed', reason: 'closed by the owner'}; window.__sig = 0; window.addEventListener('fincom:signal', () => window.__sig++); window.__calls = []; Live.signal(); }"); pg.wait_for_timeout(1200)
    ok(pg.evaluate("FirmGate.paused()") is True, "a signal from the console: read again at once")
    ok(TAG == "before" or (pg.evaluate("window.__sig") == 1 and any(c[1] == "rpc/flags_for_me" for c in pg.evaluate("window.__calls"))), "and the flags and announcements asked again (%s)" % [c[1] for c in (pg.evaluate("window.__calls") or [])])
    ok(pg.evaluate("typeof Live.joinSignals") == "function", "the signal's listener is there, joined when firm_signals exists")

    print("== 6. billing's stages (integ-console: my_firm_status stage / read_only / can_read)")
    if TAG != "before":
        RO = "Your firm’s FinCom account is read-only: the monthly fee could not be taken. Add credit or enter a coupon in Settings › Plan and credit."
        pg.evaluate("() => { window.__fs = {status: 'active', stage: 'read_only', read_only: true, can_read: true, billing_status: 'read_only'}; S.view = 'home'; S.homeTab = 'clients'; return FirmGate.load(); }"); pg.wait_for_timeout(700)
        ban = pg.locator("[data-gate-banner]")
        ok(ban.count() == 1 and RO in ban.inner_text() and pg.locator("[data-gate-plan]").count() == 1, "read-only for the fee: one line that says how to come back, with Plan and credit (%r)" % (ban.inner_text() if ban.count() else ""))
        add = pg.locator('button:text-is("Add client")')
        ok(add.count() == 1 and add.get_attribute("aria-disabled") == "true", "its writes held back")
        ok("Alpha Traders" in pg.inner_text("#app"), "its work still shown (reading allowed)")
        pg.click("[data-gate-plan]"); pg.wait_for_selector("[data-coupon-apply]", timeout=8000); pg.wait_for_timeout(400)
        ok(pg.locator("[data-coupon-apply]").get_attribute("aria-disabled") is None, "Plan and credit: the coupon's Apply is not held back (the way back)")
        pg.evaluate("() => { window.__fs = {status: 'active', stage: 'paused', read_only: true, can_read: false, billing_status: 'paused'}; navHome('clients'); return FirmGate.load(); }"); pg.wait_for_timeout(800)
        ok(pg.locator("[data-paused-page]").count() == 1 and "Alpha Traders" not in pg.inner_text("#app"), "paused for the fee: the firm's work hidden, the paused page instead")
        shot(pg, "billing-paused")
        pg.click("[data-paused-plan]"); pg.wait_for_selector("[data-coupon-apply]", timeout=8000); pg.wait_for_timeout(400)
        ok(pg.locator("[data-paused-page]").count() == 0 and pg.locator("[data-coupon-apply]").get_attribute("aria-disabled") is None, "Plan and credit still opens, its coupon box usable")
        pg.evaluate("() => navHome('help')"); pg.wait_for_timeout(500)
        ok(pg.locator("[data-paused-page]").count() == 0, "Help still opens")
        pg.evaluate("() => { window.__fs = {status: 'active', stage: 'active', read_only: false, can_read: true}; navHome('clients'); return FirmGate.load(); }"); pg.wait_for_timeout(700)
        ok(pg.locator("[data-paused-page]").count() == 0 and pg.locator("[data-gate-banner]").count() == 0 and "Alpha Traders" in pg.inner_text("#app"), "active again: everything back")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    ctx.close(); br.close()
if TAG == "before":
    print("\n(before: screenshots only)")
else:
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    raise SystemExit(1 if fails else 0)
