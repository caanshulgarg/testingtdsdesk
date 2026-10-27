"""python3 run_bottom_banner_ui.py - the strip along the bottom of the testing site ("TESTING SITE …", or a review build's
"REVIEW BUILD – …") and what is fixed to the bottom of the window. The owner's report of 14-Oct-2026: on the review build
the banner covered the Ask FinCom button (right 22px, bottom 22px), and the last rows of pages sat under it.
The fix: the banner's height as drawn is on :root as --bottom-banner-h (0 without a banner); every element fixed to the
bottom (Ask FinCom, toasts, the undo snack, the phone's bottom bar, the action bar, sticky table footers) stands on it,
and the page is padded so its last row can be scrolled clear of the banner and the button.
Checked at desktop and phone width, with the testing banner and with a long review banner (two lines on a narrow
desktop): Ask FinCom fully above the banner, and what is at its centre is the button (it opens the panel on a click);
a toast above the banner; the last row of a long table scrolled clear of the button and the banner; and (the same day's
label fix) a long client name on the button cut with an ellipsis, the whole name in its tooltip.
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_bottom_banner_ui.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "bottom-banner"); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8181), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# signed in to the firm account (stood in, no network), the assistant on, a firm of 60 made-up clients (a long table)
SIGN_IN = """() => {
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  Cloud.api = async () => [];
  try { Live.stop(); } catch (e) {}
  for (let i = 1; i <= 60; i++){ const c = newCompany({name: "ZZ TEST Client " + String(i).padStart(2, "0")}); S.companies[c.id] = c; }
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  S.view = "home"; S.homeTab = "clients"; render();
}"""
GEOM = """() => {
  const b = document.querySelector("[data-asst-launch]"), r = b ? b.getBoundingClientRect() : null;
  const cs = getComputedStyle(document.body, "::after"), bh = cs.content && cs.content !== "none" ? parseFloat(cs.height) : 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--bottom-banner-h").trim();
  const at = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return {r: r && {top: r.top, bottom: r.bottom, left: r.left, right: r.right}, vh: innerHeight, vw: innerWidth, banner: bh, v, hit: !!(at && b.contains(at)),
    inView: !!r && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight - bh + 0.5};
}"""
LAST_ROW = """() => {
  window.scrollTo(0, document.documentElement.scrollHeight); document.querySelectorAll("*").forEach(el => { if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; });
  const rows = [...document.querySelectorAll("main tr, .mainwrap tr, table tr")].filter(tr => tr.getBoundingClientRect().height > 0 && /ZZ TEST Client/.test(tr.textContent));
  const last = rows[rows.length - 1]; if (!last) return {found: false};
  const r = last.getBoundingClientRect(), b = document.querySelector("[data-asst-launch]").getBoundingClientRect();
  const cs = getComputedStyle(document.body, "::after"), bh = cs.content && cs.content !== "none" ? parseFloat(cs.height) : 0;
  return {found: true, text: last.textContent.slice(0, 40), bottom: r.bottom, launchTop: b.top, bannerTop: innerHeight - bh, clear: r.bottom <= Math.min(b.top, innerHeight - bh) + 0.5};
}"""

def check(pg, name, phone):
    g = pg.evaluate(GEOM)
    ok(g["r"] is not None, name + ": Ask FinCom is shown")
    if not g["r"]: return
    ok(g["banner"] > 0 and g["v"] == "%dpx" % -(-g["banner"] // 1), name + ": --bottom-banner-h is the banner as drawn (%s; banner %.1fpx)" % (g["v"], g["banner"]))
    ok(g["inView"], name + ": Ask FinCom is fully visible, above the banner (button %s, window %dx%d, banner %.1fpx)" % ({k: round(v) for k, v in g["r"].items()}, g["vw"], g["vh"], g["banner"]))
    ok(g["hit"], name + ": the button is what is at its centre")
    if phone:
        side, b = pg.locator(".side").first.bounding_box(), g["r"]
        ok(side["y"] + side["height"] <= g["vh"] - g["banner"] + 0.5, name + ": the bottom bar stands on the banner (bar ends at %d, banner from %d)" % (side["y"] + side["height"], g["vh"] - g["banner"]))
        ok(b["bottom"] <= side["y"] + 0.5, name + ": Ask FinCom is above the bottom bar")
    pg.evaluate("toast('Saved.')"); pg.wait_for_timeout(250)
    t = pg.locator(".toast").last.bounding_box()
    ok(t is not None and t["y"] + t["height"] <= g["vh"] - g["banner"] + 0.5, name + ": a toast shows above the banner")
    lr = pg.evaluate(LAST_ROW); pg.wait_for_timeout(200)
    ok(lr.get("found") and lr.get("clear"), name + ": the last row scrolls clear of the button and the banner (%s)" % lr)
    pg.screenshot(path=os.path.join(OUT, name.replace(" ", "-") + ".png"))
    pg.evaluate("window.scrollTo(0, 0)")
    pg.locator("[data-asst-launch]").click(); pg.wait_for_timeout(600)
    ok(pg.locator("[data-asst-panel]").count() == 1, name + ": a click on Ask FinCom opens the panel")
    pg.keyboard.press("Escape"); pg.evaluate("ASST.close()"); pg.wait_for_timeout(300)

with sync_playwright() as p:
    br = p.chromium.launch()
    for name, vp, phone in [("desktop", {"width": 1440, "height": 900}, False), ("phone", {"width": 390, "height": 844}, True)]:
        pg = br.new_page(viewport=vp); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8181/"); pg.wait_for_timeout(2500)
        if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(SIGN_IN); pg.wait_for_timeout(1200)
        check(pg, name + " testing banner", phone)
        # a review build's banner, long: on a narrow desktop it takes two lines; the variable follows it (no fixed number)
        pg.add_style_tag(content='body.is-test::after{content:"REVIEW BUILD – FinCom Assistant on by default + settings fix · staging database · not for real client work · a long review banner that wraps onto a second line on a narrower window";background:#6B3FA0;white-space:normal}')
        if not phone: pg.set_viewport_size({"width": 900, "height": 800})
        pg.evaluate("window.dispatchEvent(new Event('resize'))"); pg.wait_for_timeout(500)
        check(pg, name + " long review banner", phone)
        if not phone: ok(pg.evaluate("parseFloat(getComputedStyle(document.body, '::after').height)") > 30, "desktop: the long banner did take two lines (so the test means something)")
        if not phone:
            # a client with a long name: the button's words are cut with an ellipsis, inside its width; the tooltip has the whole name
            long = "ZZ TEST Shree Venkateshwara Agro Industries and Cold Storage Private Limited (Unit II, Hosur Road)"
            pg.evaluate("(n) => { const c = newCompany({name: n}); S.companies[c.id] = c; S.coId = c.id; S.view = 'company'; render(); }", long); pg.wait_for_timeout(900)
            lb = pg.evaluate("""() => { const b = document.querySelector('[data-asst-launch]'); if (!b) return null; const t = b.querySelector('.asst-launch-txt'), r = b.getBoundingClientRect();
              return {w: r.width, right: r.right, vw: innerWidth, title: b.title, cut: !!t && t.scrollWidth > t.clientWidth + 1, ell: !!t && getComputedStyle(t).textOverflow, inside: !!t && t.getBoundingClientRect().right <= r.right + 0.5}; }""")
            ok(lb is not None and lb["w"] <= 340 and lb["right"] <= lb["vw"] and lb["cut"] and lb["ell"] == "ellipsis" and lb["inside"], "a long client name: the button keeps its width, the words end with an ellipsis (%s)" % lb)
            ok(lb is not None and long in lb["title"], "and its tooltip has the whole name")
            pg.screenshot(path=os.path.join(OUT, "long-name.png"))
        pg.close()
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
