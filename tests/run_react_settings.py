"""python3 run_react_settings.py - Settings (the firm) and Client setup in React: a list of sections on the left, one
section at a time. Review 18 (02-Oct-2026): the changes of a section are saved with Save at its foot (the shared footer,
app/src/parts/Confirm.jsx), so this test presses Save before moving on. Offline, a made-up client.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_settings.py"""
import json
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8158), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8158/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    head = lambda: pg.inner_text("#app .sethead h2")
    nav = lambda label: pg.click('#app .setnav button:has(span:text-is("%s"))' % label)
    toasts = lambda: pg.evaluate("Array.from(document.querySelectorAll('.toast, #toast')).map(t => t.innerText).join(' | ')")
    foot = lambda: pg.inner_text("#app [data-confirm-foot]") if pg.locator("#app [data-confirm-foot]").count() else ""
    def save():
        pg.wait_for_timeout(100); pg.click('#app [data-confirm-foot] [data-cfm="save"]'); pg.wait_for_timeout(300)
    # the firm
    pg.evaluate("navHome('rules')"); pg.wait_for_timeout(500)
    ok(head() == "Firm details" and pg.locator("#app .setnav .setgroup-t").count() == 4, "Settings opens on Firm details, sections in four groups (GST API added)")
    pg.fill('#app label:has-text("Firm name") input', "Garg Shekhar & Co (test)"); pg.wait_for_timeout(900)
    ok(pg.evaluate("S.firm.firmName") == "Garg Shekhar & Co (test)" and "Garg Shekhar & Co (test)" in pg.inner_text("#app .setnav"), "the firm's name: kept, and shown in the list")
    ok("Not saved yet" in foot(), "review 18: the change is a draft until Save (%s)" % foot())
    save()
    ok("Saved ·" in foot() and "this computer" in foot(), "review 18: after Save, “Saved · <time> · this computer” (%s)" % foot())
    # clean-up batch 2: FinCom Bridge and Sent to Tally have one home, the Tally page; their sections link there
    for label, text in [("Sign-in and people", "Sign-in and people"), ("Plan and credit", "Plan and credit"), ("Connect Tally", "Open the Tally page"), ("Books in the cloud", "Books in the cloud"),
                        ("Sent to Tally", "Open it on the Tally page"), ("TDS rates and limits", "Rates and limits for all clients"), ("Reading bills", "Reading bills"), ("AI help", "AI help")]:
        nav(label); pg.wait_for_timeout(350)
        ok(head() == label and text in pg.inner_text("#app .setbody") and pg.get_attribute('#app .setnav button[aria-current="page"]', "aria-current") == "page", "Settings → " + label)
    ok("Firm name" not in pg.inner_text("#app .setbody"), "the rates page no longer holds the firm's name")
    pg.evaluate("S.settingsTab = null; doAct('goReading')"); pg.wait_for_timeout(300)
    ok(head() == "Reading bills", "the “set up reading” link opens Reading bills")
    pg.screenshot(path=OUT + "/react-settings.png")
    # a client
    pg.evaluate("""() => { const c = newCompany({name: "ZZ Zeta Exports", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return openCompany(c.id); }"""); pg.wait_for_timeout(800)
    pg.evaluate("toggleSetup()"); pg.wait_for_timeout(500)
    ok(head() == "Company" and pg.locator("header nav.sbar").count() == 0 and pg.locator("#app .setnav button").count() == 9, "Client setup: nine sections on the left (Register formats the ninth, 14-Oct-2026), no row of tabs at the top (Remove this client is under More)")
    g = pg.locator('#app label:has-text("GSTIN") input'); g.fill("09aanfg3202d1zr"); g.blur(); pg.wait_for_timeout(500)
    ok(pg.evaluate("CO().gstin") == "09AANFG3202D1ZR" and pg.evaluate("CO().pan") == "AANFG3202D", "GSTIN kept in capitals; the PAN filled in from it")
    pg.fill('#app label:has-text("PAN") input', "AAAAA1111A"); pg.locator('#app label:has-text("PAN") input').blur(); pg.wait_for_timeout(400)
    ok("carries PAN AANFG3202D" in pg.inner_text("body"), "a PAN that does not match the GSTIN: said so")
    pg.fill('#app label:has-text("PAN") input', "AANFG3202D"); pg.locator('#app label:has-text("PAN") input').blur()
    pg.fill('#app label:has-text("Client name") input', "ZZ Zeta Exports Pvt Ltd"); pg.wait_for_timeout(700)
    ok(pg.evaluate("CO().name") == "ZZ Zeta Exports Pvt Ltd", "the client's name")
    save()
    nav("Tally"); pg.wait_for_timeout(300)
    ok(head() == "Tally" and pg.locator("#app .setbody [data-tally-link]").count() == 0 and pg.locator("#app .setbody [data-tally-one]").count() == 1, "Tally section: one line for the client's Tally (24-Oct-2026: linked on the Tally page only)")
    pg.check('#app label:has-text("Purchase voucher") input[type=radio]'); pg.wait_for_timeout(300)   # review item 36: a choice, not a list
    pg.click('#app label:has-text("Optional vouchers") input'); pg.wait_for_timeout(300)
    ok(pg.evaluate("CO().voucherType") == "Purchase" and pg.evaluate("CO().createOptional") is False, "voucher type and Optional vouchers")
    pg.fill('#app label:has-text("Round off") input', "Rounding Off"); pg.wait_for_timeout(700)
    ok(pg.evaluate("CO().roundOff") == "Rounding Off", "a ledger used in every entry")
    save()
    nav("TDS"); pg.wait_for_timeout(300)
    pg.click('#app label:has-text("This client has to deduct TDS") input'); pg.wait_for_timeout(300)
    ok(pg.evaluate("CO().mustDeduct") is False and "does not deduct" in pg.inner_text("#app .setnav"), "“has to deduct TDS” off: kept, and the list says so")
    pg.click('#app label:has-text("This client has to deduct TDS") input'); pg.wait_for_timeout(300)
    rid = pg.evaluate("rules().find(r => r.basis !== 'never').id"); lab = pg.evaluate("rules().find(r => r.basis !== 'never').label")
    # ledger-confirm (14-Oct-2026): the TDS ledger of each payment type is chosen on the TDS page; here the expense ledger
    ok(pg.locator('#app input[aria-label^="TDS ledger for"]').count() == 0 and "Confirm TDS/GST ledgers on the TDS and GST pages" in pg.inner_text("#app .setbody"), "TDS: no TDS ledger boxes; one line pointing to the TDS and GST pages")
    pg.fill('#app input[aria-label="Expense ledger for %s"]' % lab, "Contract Charges"); pg.wait_for_timeout(700)
    ok(pg.evaluate("CO().expenseLedgers['%s']" % rid) == "Contract Charges", "an expense ledger by payment type")
    save()
    ok(pg.evaluate("CO().expenseLedgers['%s']" % rid) == "Contract Charges", "the expense ledger kept after Save")
    nav("GST"); pg.wait_for_timeout(1200)
    ok("Blocked credit, section 17(5)" in pg.inner_text("#app .setbody") and "Reverse charge ledgers" not in pg.inner_text("#app .setbody") and "Confirm TDS/GST ledgers on the TDS and GST pages" in pg.inner_text("#app .setbody"), "GST: registrations and blocked credit; the GST ledgers on the GST page (one line)")
    cat = pg.evaluate("BLOCK_CATS[0]")
    pg.select_option('#app select[aria-label="Blocked credit: %s"]' % cat["label"], "allow"); pg.wait_for_timeout(300)
    ok(pg.evaluate("blockRule(CO(), '%s')" % cat["id"]) == "allow", "blocked credit: credit allowed for this client")
    save()
    nav("Suppliers"); pg.wait_for_timeout(300)
    ok(head() == "Suppliers" and pg.locator('#app button:has-text("Add supplier")').count() == 1, "Suppliers")
    nav("Bank accounts"); pg.wait_for_timeout(800)
    ok(head() == "Bank accounts", "Bank accounts")
    nav("Bank rules"); pg.wait_for_timeout(500)
    ok(head() == "Bank rules", "Bank rules")
    nav("Closed periods"); pg.wait_for_timeout(300)
    ok("Books closed up to" in pg.inner_text("#app .setbody"), "Closed periods")
    pg.screenshot(path=OUT + "/react-setup.png")
    pg.click('#app details[data-more="client"] summary'); pg.click('#app details[data-more="client"] button:has-text("Remove this client")'); pg.wait_for_timeout(300)
    ok("ZZ Zeta Exports Pvt Ltd" in pg.inner_text(".cbx") and pg.locator(".cbx #cbxName").count() == 1, "Remove this client (under More) asks for the client's name")
    pg.fill(".cbx #cbxName", "ZZ Zeta"); pg.click('.cbx button[data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator(".cbx").count() == 1 and pg.evaluate("Object.keys(S.companies).length") == 1, "a wrong name does not remove it")
    pg.click('.cbx button[data-cbx="no"]'); pg.wait_for_timeout(300)
    pg.click('#side .side-link:has-text("Purchase")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.tab") == "invoices" and pg.evaluate("Object.keys(S.companies).length") == 1, "back to the work (the sidebar's Purchase), and the client is still there")
    # the Tally page: the bridge's key and following kept, a Tally chosen and back, a company linked to a client; the cloud's
    # company linked, a computer removed (asked first)
    pg.evaluate("""() => { Bridge.refresh = () => Promise.resolve(); window.startBridgePolling = () => {}; window.bridgeTick = () => {}; Bridge.setCfg({key: '', port: 0, follow: false});
      const cid = S.coId; Bridge.st = {state: 'ok', version: '1.14.3', at: Date.now(), mode: 'auto', tallyUp: true, sessions: [{port: 9000, ok: true, mine: true, companies: [{name: 'ACME LTD'}]}, {port: 9001, ok: true, mine: false, companies: []}], open: []};
      S.view = 'home'; S.homeTab = 'tally'; S.tallyMore = {page: true}; render(); }"""); pg.wait_for_timeout(400)
    # 15-Oct-2026: this browser's own bridge connect is only under the Tally page's Advanced (for support), opened here
    ok("Connect this browser to FinCom Bridge" in pg.inner_text("#app") and "Tally" in pg.inner_text("#cobar h2"), "the Tally page, with the steps to connect this browser")
    k = pg.locator('input[aria-label="Bridge key"]'); k.fill("abc123"); k.press("Tab"); pg.wait_for_timeout(300)
    ok(pg.evaluate("Bridge.cfg().key") == "abc123" and "Check connection" in pg.inner_text("#app"), "the key typed is kept")
    pg.check('label:has-text("Follow the company open in Tally") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("Bridge.cfg().follow") is True, "following Tally is kept")
    pg.evaluate("render()"); pg.wait_for_timeout(300)
    # round 39: the Tallys found, with their ports, are under Details (for support)
    if pg.locator("#app [data-bridge-support]").count(): pg.click("#app [data-bridge-support]"); pg.wait_for_timeout(300)
    pg.click('tr:has(td:text-is("Port 9001")) button:text-is("Use this Tally")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("Bridge.cfg().port") == 9001 and "In use" in pg.inner_text("#app [data-connect-section] table.data"), "one Tally chosen")
    pg.click('button:text-is("Automatic")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("Bridge.cfg().port") == 0, "and back to automatic")
    name = pg.evaluate("CO().name")
    # round 39: this computer's Tallys link nothing (that only set a Tally name); a client is linked on its Link to Tally card
    ok(pg.locator('select[aria-label="Client for ACME LTD"]').count() == 0 and "not linked" in pg.inner_text("#app [data-connect-section] table.data"), "this computer's Tallys: no 'Link to a client…', the company said not linked")
    pg.evaluate("""() => { window.__tc = []; TCloud.on = () => true; TCloud.refreshPane = async () => {}; TCloud.rpc = async (f, a) => { window.__tc.push([f, a]); return {}; };
      const nw = new Date().toISOString();
      // 15-Oct-2026: step 4 offers only the companies open in Tally now: BETA is open on the Office PC
      TCloud.pane = {devices: [{id: 'd1', name: 'Office PC', last_seen: nw, version: '2.4.4', main_bridge: 'go-1', info: {computer: 'OFFICE', user: 'a', beat: {at: nw, tally: true, tallyState: 'open', open: ['BETA'], paused: false},
        bridges: {'go-1': {at: nw, version: '2.4.4', computer: 'OFFICE', user: 'a', mode: 'main', tally: true, tallyState: 'open', open: ['BETA']}}}}], companies: [{company: 'BETA', client_id: null, device_id: 'd1'}]}; S.homeTab = 'rules'; S.settingsTab = 'tcloud'; render(); }"""); pg.wait_for_timeout(400)
    # 15-Oct-2026: Books in the cloud links nothing itself; it points to Connect Tally (step 4), where the same RPC links
    cid1 = pg.evaluate("S.coId")
    ok(pg.locator('select[aria-label="Client for BETA"]').count() == 0 and pg.locator('#app [data-open-connect="4"]').count() >= 1, "Books in the cloud: no Link here, Open Connect Tally")
    pg.click('#app [data-open-connect="4"] >> nth=0'); pg.wait_for_timeout(600)
    # 23-Oct-2026 (next-tally-suvit): Companies in Tally; from the client, "Link to <client>" on BETA's row
    ok(pg.evaluate("S.homeTab") == "tally" and pg.locator('#app [data-tco-list=firm] [data-tco-row="BETA"]').count() == 1, "the pointer opens Companies in Tally, BETA listed")
    pg.evaluate("(c) => openConnectTally(4, c)", cid1); pg.wait_for_timeout(600)
    pg.click('#app [data-tco-list=firm] [data-tco-row="BETA"] [data-tco-act=link]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("window.__tc[0]") == ["tally_company_link", {"p_company": "BETA", "p_client": cid1}], "the cloud's Tally company linked to a client, in Companies in Tally (%s)" % pg.evaluate("window.__tc"))
    pg.evaluate("() => { window.__tc = []; S.homeTab = 'rules'; S.settingsTab = 'tcloud'; S.view = 'home'; render(); }"); pg.wait_for_timeout(400)
    pg.click('button:text-is("Remove")'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx").is_visible(), "removing a computer asks first")
    pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__tc[0]") == ["tally_device_revoke", {"p_id": "d1"}], "and removes it")
    # the firm account: people's buttons, a backup, a drop key switched off, how long before signing out, syncing, documents;
    # the platform page's prices (read from their boxes), a firm's plan
    pg.evaluate("""() => { window.__calls = []; Cloud.on = () => true; Cloud.aal = () => 'aal1'; window.__cc = {url: 'https://x.supabase.co', key: 'anon', auto: true}; Cloud.cfg = () => window.__cc; Cloud.setCfg = (o) => { window.__calls.push(['cfg', o]); Object.assign(window.__cc, o); }; window.startCloudSync = () => {};
      Cloud.fn = async (n, a) => { window.__calls.push([n, a]); return {email: a.email, password: 'Pw-1'}; }; Cloud.rpc = async (n, a) => { window.__calls.push([n, a]); return n === 'backup_data' ? {x: 1} : []; };
      window.loadAccount = () => {}; window.loadAdminOverview = () => {}; window.saveFile = (n) => window.__calls.push(['save', n]);
      Cloud.st = Object.assign(Cloud.st, {email: 'a@b.in', role: 'owner', mfa: null, mfaInfo: {}, members: []});
      S.account = {me: {role: 'owner'}, superadmin: true, firm: {id: 'f1', balance: 400, warn_at: 100, period_start: '2026-09-01'}, modules: [], people: [{name: 'Bina', email: 'b@b.in', role: 'staff', active: true}]};
      S.backups = [{id: 7, taken_at: '2026-09-29T20:00:00Z', clients: 3, records: 120, bytes: 20480}]; S.dropKeys = [{id: 3, label: 'Agent', hint: 'ab', created_at: '2026-01-01', active: true}];
      S.firmSetupLater = true; S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'account'; render(); }"""); pg.wait_for_timeout(400)
    calls = lambda: pg.evaluate("window.__calls")
    pg.click('tr[data-key="b@b.in"] button:text-is("Send reset link")'); pg.wait_for_timeout(300)
    ok(any(c[0] == "admin" and c[1].get("action") == "send_reset" and c[1].get("email") == "b@b.in" and c[1].get("redirect") for c in calls()), "a reset link emailed to a person (review item 21)")
    pg.click('tr[data-key="b@b.in"] button:text-is("Unlock")'); pg.wait_for_timeout(300)
    ok(["admin", {"action": "unlock", "email": "b@b.in"}] in calls(), "a locked-out person unlocked")
    pg.click('tr[data-key="b@b.in"] button:text-is("Make a password")'); pg.wait_for_timeout(300)
    ok(["admin", {"action": "reset_password", "email": "b@b.in"}] in calls() and "Pw-1" in pg.inner_text("#app"), "where email is not set up: a new password for a person, shown once")
    pg.click('tr[data-key="b@b.in"] button:text-is("Switch off")'); pg.wait_for_timeout(300)
    ok(["admin", {"action": "set_person", "email": "b@b.in", "active": False}] in calls(), "a person switched off")
    pg.click('button:text-is("Download")'); pg.wait_for_timeout(300)
    ok(["backup_data", {"p_id": 7}] in calls() and any(c[0] == "save" for c in calls()), "a backup downloaded")
    pg.click('tr:has(td:text-is("Agent")) button:text-is("Switch off")'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx").is_visible(), "switching a drop key off asks first")
    pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(400)
    ok(["revoke_drop_key", {"p_id": 3}] in calls(), "and switches it off")
    # section D (03-Oct-2026): the idle sign-out and its "Sign out after" setting are gone; the page says so
    ok(pg.locator('select[aria-label="Sign out after"]').count() == 0 and "does not sign you out by itself" in pg.inner_text("#app"), "no idle sign-out setting; the page says FinCom does not sign you out by itself")
    pg.uncheck('label:has-text("Keep in sync automatically") input'); pg.wait_for_timeout(200)
    ok(["cfg", {"auto": False}] in calls(), "syncing by itself switched off")
    pg.uncheck('label:has-text("Keep documents in the firm account") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("S.firm.cloudDocs") is False, "documents kept on this computer only")
    pg.click('button:text-is("Turn it on")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("Cloud.st.mfa && Cloud.st.mfa.need") == "enrol" and "Two-step sign-in" in pg.inner_text("#app"), "two-step sign-in: Turn it on opens its setup")
    pg.evaluate("() => { Cloud.st.mfa = null; render(); }"); pg.wait_for_timeout(300)
    pg.fill("#npEmail", "c@b.in"); pg.fill("#npName", "Chetan"); pg.click('button:text-is("Invite by email")'); pg.wait_for_timeout(300)
    ok(any(c[0] == "admin" and c[1].get("action") == "invite_person" and c[1].get("email") == "c@b.in" and c[1].get("name") == "Chetan" and c[1].get("role") == "staff" for c in calls()), "a person invited by email from the boxes")
    # security fix batch 1 (27-Oct-2026): no "make a password instead"; the owner never sets a password for someone else
    ok(pg.locator('button:text-is("or make a password instead")').count() == 0 and "We'll email them a link to set their password." in pg.inner_text("#app")
       and pg.locator('#npEmail').locator('xpath=ancestor::div[contains(@class,"bk-form")]').locator('input[type="password"]').count() == 0,
       "Add person: no password box or 'make a password' choice; it says they get a link to set their password")
    pg.evaluate("""() => { S.settingsTab = 'platform'; S.adminData = {month: 0, firms: [{id: 'f1', name: 'Firm A', active: true, plan_id: 'p1', balance: 40, people: 2, modules: [{code: 'read', price: 2, enabled: true}]}],
      plans: [{id: 'p1', name: 'Starter', includes: {}}, {id: 'p2', name: 'Pro', includes: {}}], modules: [{code: 'read', title: 'Reading bills', price: 2, unit: 'per page', billing: 'unit'}]}; render(); }"""); pg.wait_for_timeout(300)
    pg.select_option('select[aria-label="Plan of Firm A"]', "p2"); pg.wait_for_timeout(300)
    ok(["admin_set_plan", {"p_firm": "f1", "p_plan": "p2"}] in calls(), "a firm's plan changed")
    pg.click('button:text-is("Prices")'); pg.wait_for_timeout(300); pg.fill("#pr_read", "1.5"); pg.click('button:text-is("Save prices")'); pg.wait_for_timeout(400)
    ok(["admin_set_module", {"p_firm": "f1", "p_code": "read", "p_enabled": True, "p_price": 1.5}] in calls(), "a firm's price saved from its box")
    pg.evaluate("() => { Cloud.on = () => false; window.__cc.gate = false; S.account = null; render(); }")
    # TDS rates: a rate changed and kept; reading: the order's ticks; closed periods: the date, a warning, a TDS return filed
    pg.evaluate("() => { S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'rates'; S.firm.rules = {}; render(); }"); pg.wait_for_timeout(300)
    r0 = pg.evaluate("rules().find(r => r.basis !== 'never')")
    box = pg.locator('input[aria-label=%s]' % json.dumps("Rate individual: " + r0["label"])); box.fill("7.5"); box.press("Tab"); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.firm.rules[%s].rateInd" % json.dumps(r0["id"])) == 7.5, "a TDS rate changed is kept")
    pg.click('button:text-is("Restore default rates and limits")'); pg.wait_for_timeout(300)
    ok(pg.input_value('input[aria-label=%s]' % json.dumps("Rate individual: " + r0["label"])) == str(r0["rateInd"]).rstrip("0").rstrip(".") or pg.evaluate("Object.keys(S.firm.rules).length") == 0, "and the defaults come back")
    pg.evaluate("() => { S.settingsTab = 'reading'; S.freeFirst = true; render(); }"); pg.wait_for_timeout(300)
    pg.uncheck('label:has-text("Try free reading first") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("S.freeFirst") is False and "bills cannot be read here" in pg.inner_text("#app") or pg.evaluate("S.freeFirst") is False, "free reading first switched off")
    pg.check('label:has-text("Ask Claude for a new supplier") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("S.askClaudeNewSupplier") is True, "asking Claude for a new supplier switched on")
    pg.evaluate("() => { S.freeFirst = true; S.view = 'company'; S.tab = 'coclosed'; render(); }"); pg.wait_for_timeout(300)
    pg.fill('input[aria-label="Books closed up to"]', "2026-03-31"); pg.wait_for_timeout(300)
    ok(pg.evaluate("ClosedP.cfg(CO()).to") == "2026-03-31", "books closed up to a date")
    pg.check('label:has-text("GSTR-1 or GSTR-3B is marked filed") input'); pg.wait_for_timeout(200)
    ok(pg.evaluate("ClosedP.cfg(CO()).gst") is True, "the GST warning switched on")
    q = pg.evaluate("ClosedP.quarters()[0]"); pg.fill('input[aria-label=%s]' % json.dumps("Filed: " + pg.evaluate("ClosedP.qLabel(%s)" % json.dumps(q))), "2026-05-31"); pg.wait_for_timeout(300)
    ok(pg.evaluate("ClosedP.cfg(CO()).tdsFiled[%s]" % json.dumps(q)) == "2026-05-31", "a TDS return marked filed")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
