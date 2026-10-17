"""python3 run_gst_helper_app_ui.py - the GST browser helper from FinCom's side (app/dist-test served as
https://staging.fincom.live/review/, the extension loaded, the portal look-alike, the firm's server stood in by pg_stand
with migration 93 so the app's calls run the real SQL):
  the "Browser helper" step on GSTR-1's and GSTR-3B's Files tab: installed, "Open the portal for this return" sends the
  very JSON FinCom's download gives; each step's status and the comparison come back to the card; every run logged (on
  the firm's server and with the books: who, when, GSTIN, period, steps, differences, ARN); after the person files, the
  return shows Filed with its ARN;
  GST settings, "GST portal login": the owner saves it and the password is never shown again; "Log in to GST portal"
  fills the look-alike's login page and waits on the captcha; the password travels only in the owner's save and in the
  one read; a staff member without rights is refused (the refusal logged); deleting removes the Vault secret.
Needs app/dist-test (cd app && npm run legacy && npm run build:test) and runs as root (pg_stand). Screenshots: tests/out."""
import json, os, re, sys, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import gst_helper_stand as stand, pg_stand
from books_data import DATA, CACHE, FIXTURE, GSTIN, COMPANY

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
M93 = os.path.join(HERE, "..", "server", "gst-browser", "migration-93-gst-portal-login.sql")
SUPA = "https://qbocskaiewaxqcvaunzc.supabase.co"
YM, REG = ("202511", "07") if FIXTURE else ("202510", "07")
F = "99999999-9999-9999-9999-999999999999"
OWNER, STAFF = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444"
TOK = {"tok-owner": OWNER, "tok-staff": STAFF}
PW = "Fx#S3cret-pass-0101"
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
if not os.path.exists(os.path.join(SITE, "index.html")):
    print("  FAIL app/dist-test is not built (cd app && npm run legacy && npm run build:test)"); sys.exit(1)

# ---------- the firm's server: pg_stand with migration 93 and Vault stood in; the app's REST calls answered from it ----------
db = pg_stand.start(30931)
def psql(sql, uid=None):
    pre = ("set fincom.uid = '%s'; set role authenticated;\n" % uid) if uid else ""
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
                       input=pre + sql, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())
db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;")
db.sql(stand.VAULT)
db.sql("create or replace function public.my_firm() returns uuid language sql stable security definer set search_path to 'public' as $$ select firm_id from public.members where user_id = auth.uid() and active $$;")
db.sql("""insert into firms values (%s, 'Firm') on conflict do nothing; insert into members values (%s, %s, 'Anshul', 'owner', true), (%s, %s, 'Staff', 'staff', true);
  grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated;""" % (q(F), q(OWNER), q(F), q(STAFF), q(F)))
r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(M93).read(), capture_output=True, text=True)
if r.returncode: print("migration 93 did not run:", r.stderr[-500:]); db.stop(); sys.exit(1)

TYPES = {"p_staff": "uuid[]", "p_steps": "jsonb", "p_differences": "jsonb"}
wire = []      # every request to the server and its answer: (path, request body, answer)
def lit(k, v):
    if v is None: return "null"
    if TYPES.get(k) == "uuid[]": return "array[%s]::uuid[]" % ", ".join(q(x) for x in v) if v else "'{}'::uuid[]"
    if TYPES.get(k) == "jsonb": return q(json.dumps(v)) + "::jsonb"
    return q(v)
def supabase(route):
    req = route.request; path = req.url[len(SUPA):].split("?")[0]; body = req.post_data or ""
    uid = TOK.get((req.headers.get("authorization") or "").replace("Bearer ", ""))
    m = re.match(r"^/rest/v1/rpc/(gst_[a-z_]+)$", path)
    if m and uid:
        args = json.loads(body or "{}")
        good, out = psql("select public.%s(%s)::text;" % (m.group(1), ", ".join("%s => %s" % (k, lit(k, v)) for k, v in args.items())), uid)
        ans = out.splitlines()[-1] if good else json.dumps({"message": out})
        wire.append((path, body, ans))
        return route.fulfill(status=200 if good else 400, content_type="application/json", body=ans)
    wire.append((path, body, "[]"))
    return route.fulfill(status=200, content_type="application/json", body="[]")

books = json.load(open(CACHE))
with sync_playwright() as p:
    ctx, ext = stand.start(p, fincom_dir=SITE, two_b=lambda period: {"data": {"gstin": GSTIN, "rtnprd": period, "gendt": "14-12-2025", "docdata": {"b2b": []}}},
                           extra_routes=[(re.compile(r"^" + re.escape(SUPA) + "/"), supabase)])
    ctx.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(pg.url.split("?")[0][:60] + ": " + str(e))))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append("app: " + str(e)))
    sent = []
    pg.on("request", lambda rq: sent.append((rq.url, rq.post_data or "")))
    pg.goto("https://staging.fincom.live/review/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "@NAME@", gstin: "@GSTIN@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "@TAB@"; render(); }""".replace("@NAME@", "ZZ TEST (" + COMPANY + ")").replace("@GSTIN@", GSTIN).replace("@TAB@", "import" if FIXTURE else "gst"), books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    if FIXTURE:
        pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
    # signed in to the firm account as the owner (the session the server stand-in knows)
    def sign_in(tok, role):
        pg.evaluate("""([tok, role, staff]) => { Cloud.setSess({access_token: tok, at: Date.now(), expires_in: 360000}); Cloud.refreshToken = async () => {};
          S.account = {me: {role, name: role === 'owner' ? 'Anshul' : 'Staff', email: role + '@firm.test'}, firm: {name: 'Firm'}, modules: []};
          Cloud.st.email = role + '@firm.test'; Cloud.st.members = [{user_id: staff, name: 'Staff', email: 'staff@firm.test', role: 'staff', active: true}];
          GSTB.logins = {}; GSTB.loginsAt = {}; GSTB.msg = ''; render(); }""", [tok, role, STAFF])
    sign_in("tok-owner", "owner")
    ok(pg.evaluate("Cloud.on() && Cloud.cfg().url") == SUPA, "signed in to the firm account (the staging address, answered by the stand-in)")
    go = lambda part, sub="file": (pg.evaluate("S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'return'; S.gstPart = '%s'; S.gstSub = '%s'; S.gstYm = '%s'; S.gstReg = '%s'; render();" % (part, sub, YM, REG)), pg.wait_for_timeout(2500))
    go("r1")
    stand.wait(pg, lambda: pg.query_selector("[data-helper-installed]"), 15000)
    card = pg.query_selector('[data-browser-helper="R1"]')
    ok(card is not None and pg.query_selector("[data-helper-installed]") is not None, "GSTR-1's Files tab has the Browser helper step, and sees the helper installed")
    ok("How to install" not in pg.inner_text('[data-browser-helper="R1"]') and "captcha, the OTP and signing" in pg.inner_text('[data-browser-helper="R1"]'), "it says what the helper does and what is always the person's")

    # ---------- GSTR-1: Open the portal -> the extension gets FinCom's own JSON ----------
    panel = ctx.new_page(); panel.goto("chrome-extension://%s/panel.html" % ext)
    pg.bring_to_front(); pg.click("[data-helper-open]")
    stand.wait(panel, lambda: (panel.evaluate("chrome.storage.session.get('job')").get("job") or {}).get("form") == "R1", 15000)
    job = panel.evaluate("chrome.storage.session.get('job')")["job"]
    mine = pg.evaluate("(ym) => GSTR.toJson(ym, '%s')" % REG, YM)
    ok(job["r1json"] == mine and job["gstin"] == GSTIN and job["ym"] == YM, "“Open the portal for this return” hands the helper the very GSTR-1 JSON FinCom's download gives (%d tables)" % len([k for k in mine if isinstance(mine[k], (list, dict))]))
    ok(stand.wait(pg, lambda: stand.portal_tab(ctx), 10000) is not None, "the portal opens in a tab of the person's own browser")
    status = lambda sid: panel.get_attribute('[data-step="%s"]' % sid, "data-status") if panel.query_selector('[data-step="%s"]' % sid) else None
    panel.bring_to_front(); panel.click("#runAll")
    stand.wait(panel, lambda: status("file") in ("done", "stopped") or any(panel.eval_on_selector_all('[data-step][data-status="stopped"]', "e => e.map(x => 1)")), 180000)
    print("     panel:", panel.inner_text('[data-step="summary"] .msg')[:150], "|", panel.inner_text('[data-step="file"] .msg')[:150])
    pg.bring_to_front(); pg.wait_for_timeout(1500)
    steps = pg.eval_on_selector_all("[data-helper-step]", "els => els.map(e => [e.dataset.helperStep, e.dataset.status])")
    ok(dict(steps).get("summary") == "done" and dict(steps).get("file") == "done" and dict(steps).get("you") == "you" and len(steps) == 8, "the card lists each step with its status; the last is the person's (%s)" % steps)
    cmp_ = pg.inner_text("[data-helper-compare]") if pg.query_selector("[data-helper-compare]") else ""
    ok("figures agree" in cmp_ and "differ by" not in cmp_, "the card shows the portal's summary against FinCom: " + cmp_.replace("\n", " ")[:120])
    log = pg.evaluate("S.books.gstHelperLog || []")
    ok(log and log[-1]["form"] == "R1" and log[-1]["gstin"] == GSTIN and log[-1]["ym"] == YM and log[-1]["who"] == "owner@firm.test" and log[-1]["outcome"] == "yours" and log[-1]["steps"], "the run is logged with the books: who, when, GSTIN, period, steps, outcome")
    srv = db.rows("select user_id::text as u, gstin, period, form, outcome, jsonb_array_length(steps) as n from gst_helper_runs order by id")
    ok(srv and srv[-1]["u"] == OWNER and srv[-1]["gstin"] == GSTIN and srv[-1]["period"] == YM and srv[-1]["form"] == "R1" and srv[-1]["outcome"] == "yours" and int(srv[-1]["n"]) == 8, "... and on the firm's server (gst_helper_runs: %s)" % (srv[-1] if srv else None))
    pg.screenshot(path=OUT + "/gst-helper-fincom-r1.png", full_page=True)
    pt = stand.portal_tab(ctx)
    pt.check("#decl"); pt.click("#fevc"); pt.fill("#otp", "123456"); pt.click("#verify")
    stand.wait(pg, lambda: pg.query_selector("[data-helper-arn]"), 15000)
    rec = pg.evaluate("GSTF.peek('%s', '%s')" % (YM, REG))
    ok(rec.get("r1Arn") and re.match(r"^AA07\d{4}0000001$", rec["r1Arn"]) and rec.get("r1") and pg.query_selector("[data-helper-arn]"), "after the person files, GSTR-1 shows Filed with the portal's ARN (%s, filed on %s)" % (rec.get("r1Arn"), rec.get("r1")))
    ok(db.one("select arn from gst_helper_runs where outcome = 'filed' order by id desc limit 1") == rec.get("r1Arn"), "the ARN is in the run log on the firm's server")

    # ---------- GSTR-3B ----------
    go("r3b")
    pg.click("[data-helper-open]")
    stand.wait(panel, lambda: (panel.evaluate("chrome.storage.session.get('job')").get("job") or {}).get("form") == "3B", 15000)
    job = panel.evaluate("chrome.storage.session.get('job')")["job"]
    ok(job["r3bjson"] == pg.evaluate("GSTR.threeBJson('%s', '%s')" % (YM, REG)) and job.get("pay", {}).get("cash") == pg.evaluate("GSTR.threeB('%s', '%s').pay.cash" % (YM, REG)), "3B: the helper gets FinCom's 3B figures and its set-off")
    panel.bring_to_front(); panel.click("#runAll")
    stand.wait(panel, lambda: status("pay") in ("done", "stopped") or any(panel.eval_on_selector_all('[data-step][data-status="stopped"]', "e => e.map(x => 1)")), 180000)
    print("     panel:", panel.inner_text('[data-step="read"] .msg')[:200], "|", panel.inner_text('[data-step="pay"] .msg')[:200])
    pg.bring_to_front(); pg.wait_for_timeout(1500)
    steps = dict(pg.eval_on_selector_all("[data-helper-step]", "els => els.map(e => [e.dataset.helperStep, e.dataset.status])"))
    ok(all(steps.get(s) == "done" for s in ["period", "t31", "t32", "t4", "t5", "read", "save", "pay"]) and steps.get("you") == "you", "3B: every step done in the card; filing is the person's (%s)" % steps)
    parts = pg.eval_on_selector_all("[data-compare-part]", "els => els.map(e => [e.dataset.comparePart, e.className, e.innerText])")
    ok({k for k, c, t in parts} >= {"r3b4c", "pay"}, "the card shows 4(C) and the payment table against FinCom (%s)" % [(k, t) for k, c, t in parts])
    diffs = pg.eval_on_selector_all("[data-diff]", "els => els.map(e => e.dataset.diff)")
    print("     3B differences shown:", diffs[:12])
    pg.screenshot(path=OUT + "/gst-helper-fincom-3b.png", full_page=True)
    pt = stand.portal_tab(ctx); pt.click("#mkpay"); pt.click("#f3evc"); pt.check("#decl"); pt.click("#fevc"); pt.fill("#otp", "123456"); pt.click("#verify")
    stand.wait(pg, lambda: pg.evaluate("GSTF.peek('%s', '%s').r3bArn" % (YM, REG)), 15000)
    rec = pg.evaluate("GSTF.peek('%s', '%s')" % (YM, REG))
    ok(rec.get("r3bArn", "").endswith("0000002") and rec.get("r3b") and rec.get("snap"), "3B filed by the person: Filed with ARN %s, the filed 3B kept as FinCom keeps it" % rec.get("r3bArn"))

    # ---------- GST settings: the portal login ----------
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2500)
    box = '[data-portal-login="%s"]' % GSTIN
    ok(pg.query_selector(box) is not None, "GST settings has the GST portal login for the GSTIN")
    pg.fill(box + ' input[aria-label="GST portal user id"]', "fx_user"); pg.fill(box + ' input[aria-label="GST portal password"]', PW)
    pg.click(box + " [data-login-save]"); stand.wait(pg, lambda: pg.query_selector(box + " [data-login-saved]"), 10000)
    t = pg.inner_text(box)
    ok("password saved" in t and not pg.query_selector(box + ' input[aria-label="GST portal password"]') and PW not in pg.content(), "saved: it says “password saved · change”, the password box is gone and the password is nowhere on the page")
    ok(db.one("select count(*) from vault.secrets where secret = %s" % q(PW)) == "1" and db.one("select count(*) from gst_portal_login_events where action = 'saved' and user_id = %s" % q(OWNER)) == "1", "the password is in Vault on the server; the save is logged")
    pg.check(box + ' input[aria-label="Allow Staff"]'); pg.wait_for_timeout(1500)
    ok(db.one("select staff_allowed::text from gst_portal_logins where not deleted") == "{%s}" % STAFF, "the owner allows a staff member")
    pg.uncheck(box + ' input[aria-label="Allow Staff"]'); pg.wait_for_timeout(1500)
    ok(db.one("select staff_allowed::text from gst_portal_logins where not deleted") == "{}", "... and takes it back")
    pg.screenshot(path=OUT + "/gst-helper-fincom-login-setting.png", full_page=False)

    # "Log in to GST portal": the login page filled, waiting on the captcha
    go("r1")
    stand.wait(pg, lambda: pg.query_selector("[data-helper-login]"), 10000)
    before = len(wire)
    pg.click("[data-helper-login]")
    stand.wait(pg, lambda: (stand.portal_tab(ctx) and "/services/login" in stand.portal_tab(ctx).url and stand.portal_tab(ctx).evaluate("document.querySelector('#user_pass') && document.querySelector('#user_pass').value")), 20000)
    pt = stand.portal_tab(ctx)
    ok(pt.input_value("#username") == "fx_user" and pt.input_value("#user_pass") == PW and pt.input_value("#captcha") == "" and pt.evaluate("document.activeElement.id") == "captcha", "“Log in to GST portal”: user id and password typed on the login page, the captcha left empty with the cursor in it")
    reads = [w for w in wire[before:] if w[0].endswith("gst_portal_login_read")]
    ok(len(reads) == 1 and db.one("select count(*) from gst_portal_login_events where action = 'read' and user_id = %s" % q(OWNER)) == "1", "one read of the password, logged on the server (who, when, GSTIN)")
    # the password travels only in the owner's save and in that one read
    carriers = [w[0] + (" (request)" if PW in w[1] else " (answer)") for w in wire if PW in w[1] or PW in w[2]]
    other_sent = [u for u, b in sent if PW in u or (PW in b and not u.endswith("gst_portal_login_save"))]
    ok(sorted(carriers) == ["/rest/v1/rpc/gst_portal_login_read (answer)", "/rest/v1/rpc/gst_portal_login_save (request)"] and not other_sent, "the password is in no other request or answer (%s)" % carriers)
    kept = pg.evaluate("JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(S.books) + JSON.stringify(GSTB.logins) + GSTB.msg")
    ok(PW not in kept and db.one("select count(*) from gst_helper_runs where steps::text like %s or differences::text like %s or note like %s" % (q("%" + PW + "%"), q("%" + PW + "%"), q("%" + PW + "%"))) == "0", "the password is not in this browser's storage, the books, or any run log")

    # a staff member without rights
    sign_in("tok-staff", "staff"); go("r1"); pg.wait_for_timeout(2000)
    t = pg.inner_text('[data-browser-helper="R1"]')
    ok(not pg.query_selector("[data-helper-login]") and "has not allowed you" in t, "a staff member not allowed sees no “Log in to GST portal” and is told why")
    pg.evaluate("GSTB.login('%s')" % REG); pg.wait_for_timeout(2500)
    ok("not allowed" in pg.inner_text("[data-helper-msg]") and db.one("select count(*) from gst_portal_login_events where action = 'refused' and user_id = %s" % q(STAFF)) == "1", "asked anyway, the server refuses and logs the refusal")
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2000)
    ok("change" not in pg.inner_text(box) and not pg.query_selector(box + " [data-login-save]"), "staff cannot change or delete the login")

    # the owner deletes it: the Vault secret goes
    sign_in("tok-owner", "owner"); pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2500)
    pg.once("dialog", lambda d: d.accept())
    pg.click(box + " [data-login-delete]"); stand.wait(pg, lambda: not pg.query_selector(box + " [data-login-saved]"), 10000)
    ok(db.one("select count(*) from vault.secrets") == "0" and db.one("select count(*) from gst_portal_logins where deleted and secret_id is null") == "1", "deleted by the owner: the password removed from Vault, the login marked deleted")
    ctx.close()
db.stop()
errs = [e for e in errors if "favicon" not in e and "supabase" not in e.lower()]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
