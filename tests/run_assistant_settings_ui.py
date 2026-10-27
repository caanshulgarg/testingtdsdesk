"""python3 run_assistant_settings_ui.py - Settings › AI help › FinCom Assistant, reached the way a user goes, as the firm's
owner and as staff, at desktop width (the sidebar's Settings) and phone width (the bottom bar's More, then Settings).
The owner's report of 14-Oct-2026: "Not able to click FinCom Assistant page in settings". The cause found: the page
asked the database for the firm's assistant setting once, when the app first drew, and kept the answer for good; asked
before the sign-in had finished (no firm yet, so no answer) it stayed on "Loading…" forever, and after a failed call
the switch stayed greyed out. Now an unanswered or failed read is asked again, and only a member who is not the owner
sees the switch greyed (with the reason). Also the owner's decision of 14-Oct-2026: the assistant is ON for every firm
unless the owner switches it off; no consent tick; the notice "Questions may be processed by an AI provider; identifiers
are masked" on first use; the cost cap stays (a month's since 17-Oct-2026: Rs 3,000 a calendar month, migration 96).
The firm account is stood in (Cloud.rpc answers as the database does); no network. Run on app/dist-test, under the lock:
flock /tmp/fincom-app.lock python3 tests/run_assistant_settings_ui.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "assistant-settings"); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8179), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the firm account, stood in. asst_settings answers nothing (null) for the first `late` calls: what the database answers
# while the sign-in has not finished (my_firm() is not known yet); `fail` calls throw first (the network, a refresh)
SIGN_IN = """([role, late, fail, stored]) => {
  window.__rpc = []; window.__late = late; window.__fail = fail; window.__stored = stored;
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = role; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role, email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn, a) => {
    window.__rpc.push([fn, a || {}]);
    if (fn === "asst_settings") {
      if (window.__fail > 0) { window.__fail--; throw new Error("Failed to fetch"); }
      if (window.__late > 0) { window.__late--; return null; }
      return {enabled: window.__stored === null ? true : window.__stored, owner: role === "owner", set_at: null, default_on: window.__stored === null, consent: true};
    }
    if (fn === "asst_set_settings") { if (role !== "owner") throw new Error("only the firm's owner switches the assistant"); window.__stored = !!a.p_enabled; return {enabled: !!a.p_enabled, owner: true, default_on: false, consent: true}; }
    if (fn === "asst_usage") return {owner: role === "owner", today: 0, cap: 500, cap_inr: 3000, rate: 85, spent_inr: 0, warn: false, over: false, period: "month", month: "2026-10", today_inr: 0, days: [], months: [], features: [], questions: [], fell_through: []};
    if (fn === "asst_mismatches") return {counts: {new: 0, cause_found: 0, fix_waiting: 0, fixed: 0, all: 0}, rows: []};
    return {};
  };
  Cloud.api = async () => [];
  try { Live.stop(); } catch (e) {}
  S.view = "home"; render();
}"""

def open_settings(pg, phone):
    if phone and pg.locator("[data-asst-launch]").count():
        # the launcher must not sit on the bottom bar (it covered More: the owner's report)
        a, b = pg.locator("[data-asst-launch]").bounding_box(), pg.locator("button.side-more").bounding_box()
        side = pg.locator(".side").first.bounding_box()
        ok(a["y"] + a["height"] <= side["y"] and not (a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]),
           "phone: the Ask FinCom button is above the bottom bar, not on More (%s, bar at y %d)" % ({k: round(v) for k, v in a.items()}, side["y"]))
    if phone:
        pg.locator("button.side-more").click(); pg.wait_for_timeout(500)
        pg.locator("[data-side-sheet] .side-sheet").get_by_text("Settings", exact=True).first.click()
    else:
        pg.locator(".side-tree").get_by_text("Settings", exact=True).first.click()
    pg.wait_for_timeout(700)
    pg.get_by_text("AI help", exact=True).first.click(); pg.wait_for_timeout(1200)

def run(pg, name, phone, role="owner", late=1, fail=0, stored=None):
    pg.goto("http://localhost:8179/"); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(SIGN_IN, [role, late, fail, stored]); pg.wait_for_timeout(900)
    open_settings(pg, phone)
    # the setting is asked again until it is known: no "Loading…" left behind
    for _ in range(20):
        if pg.locator("[data-asst-switch] input[type=checkbox]").count(): break
        pg.wait_for_timeout(500)
    ok(pg.locator("[data-asst-switch] input[type=checkbox]").count() == 1, "%s: the FinCom Assistant switch shows (no endless Loading…; asked %d times)" % (name, len([x for x in pg.evaluate("window.__rpc") if x[0] == "asst_settings"])))
    return pg.locator("[data-asst-switch] input[type=checkbox]")

with sync_playwright() as p:
    br = p.chromium.launch()
    for name, vp, phone in [("desktop", {"width": 1440, "height": 900}, False), ("phone", {"width": 390, "height": 844}, True)]:
        pg = br.new_page(viewport=vp); pg.on("pageerror", lambda e: errors.append(str(e)))
        # the owner, the first read answered before the sign-in finished; the firm has never set anything: ON
        box = run(pg, name + " owner", phone, late=1)
        ok(box.count() and box.is_checked() and box.is_enabled(), name + ": on by default (the owner's decision of 14-Oct-2026), and the owner can change it")
        ok(pg.locator("[data-asst-switch] input[type=checkbox]").count() == 1 and "consent" not in pg.inner_text("[data-asst-switch]").lower().split("decided")[0], name + ": no consent tick to block it")
        ok("14-Oct-2026" in pg.inner_text("[data-asst-settings]"), name + ": the page says the owner decided it on 14-Oct-2026")
        sp = pg.inner_text("[data-asst-spend]") if pg.locator("[data-asst-spend]").count() else ""
        ok("This month" in sp and "₹3,000.00" in sp and "Today" not in sp, name + ": the monthly cap of ₹3,000 is on (%s)" % sp[:80])
        lab = pg.inner_text("[data-asst-settings] .asst-cap") if pg.locator("[data-asst-settings] .asst-cap").count() else ""
        mx = pg.get_attribute("[data-asst-settings] .asst-cap input", "max") if lab else ""
        ok("Monthly limit" in lab and "Daily" not in lab and mx == "10000000", name + ": the owner sets the monthly limit in Settings, up to 1 crore (%s; max %s)" % (lab.strip()[:40], mx))
        pg.fill("[data-asst-settings] .asst-cap input >> nth=0", "4500"); pg.click("[data-asst-settings] .asst-cap button"); pg.wait_for_timeout(500)
        ok(pg.evaluate("window.__rpc.some(x => x[0] === 'asst_set_cap' && Number(x[1].p_inr) === 4500)"), name + ": Set sends the monthly limit")
        pg.screenshot(path=os.path.join(OUT, name + "-owner.png"), full_page=True)
        box.click(); pg.wait_for_timeout(700)
        ok(not box.is_checked() and pg.evaluate("window.__rpc.some(x => x[0] === 'asst_set_settings' && x[1].p_enabled === false)"), name + ": the owner switches it off with one click")
        box.click(); pg.wait_for_timeout(700)
        ok(box.is_checked() and pg.evaluate("window.__stored") is True, name + ": and on again")
        # a failed first read: asked again, not greyed out for good
        box = run(pg, name + " owner after a failed read", phone, late=0, fail=1)
        ok(box.count() and box.is_enabled(), name + ": after a failed read the owner's switch works")
        # staff: shown, greyed, with the reason
        box = run(pg, name + " staff", phone, role="staff", late=0)
        ok(box.count() and box.is_disabled() and "only the firm's owner" in pg.inner_text("[data-asst-switch]").lower(), name + ": staff see it greyed, with the reason")
        pg.screenshot(path=os.path.join(OUT, name + "-staff.png"), full_page=True)
        # a firm whose owner switched it off stays off
        box = run(pg, name + " switched off", phone, late=0, stored=False)
        ok(box.count() and not box.is_checked(), name + ": a firm that switched it off stays off")
        pg.close()
    # first use: the notice, once
    pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    run(pg, "first use", False, late=0)
    pg.keyboard.press("Control+j"); pg.wait_for_timeout(800)
    n = pg.locator("[data-asst-first-notice]")
    ok(n.count() == 1 and "Questions may be processed by an AI provider; identifiers are masked" in n.inner_text(), "first use: the notice is shown")
    pg.screenshot(path=os.path.join(OUT, "first-use-notice.png"))
    n.locator("button").click(); pg.wait_for_timeout(400)
    ok(pg.locator("[data-asst-first-notice]").count() == 0, "first use: the notice goes once read")
    pg.keyboard.press("Control+j"); pg.wait_for_timeout(300); pg.keyboard.press("Control+j"); pg.wait_for_timeout(600)
    ok(pg.locator("[data-asst-first-notice]").count() == 0 and pg.locator("[data-asst-panel] [data-asst-privacy]").count() == 0, "and does not come back (the line is in Settings › AI, not in the panel)")
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
