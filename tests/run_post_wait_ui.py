"""python3 run_post_wait_ui.py - the Post page's words for a posting that waits (next-posting-never-stuck; the owner,
23-Nov-2026: "warnings say just 'Tally is closed'"; no extra warning box: "Priority warnings ... getting system very
messy"). Offline, made-up clients, computers and Windows users; the posting of FinCom's cloud put in CloudJobs.list:
  1. waiting, its bridge's beat says Tally is closed: the rows say "Tally is closed. Open Tally and <company>", never the
     cloud's "restart FinCom Bridge", never the computer's or Windows user's name; Cancel stays;
  2. the company not open there: "<company> is not open in Tally. Open Tally and <company>";
  3. Home and the client's pages: no new warning box, Home's Needs you figure as before (0 here).
Screenshots (deviceScaleFactor 2) go to TDSDESK_SHOTS when set: before (the words the posting carries, as the page showed
them before this branch: postWaitWhy given nothing) and after, desktop and phone.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_wait_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("PW_PORT") or 8949)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
RESTART = "No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (it is never posted from another computer). If it stays so, restart FinCom Bridge on that computer."
SETUP = """(restart) => {
  const a = newCompany({name: "Demo Builders Pvt Ltd", gstin: "07AAACD1234E1Z5"}); S.companies[a.id] = a;
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString(), ids = Array.from({length: 3}, (_, i) => "stmdemo1-" + i);
  TLight.st.devs = [{id: "dev-demo", name: "PC-DEMO1 · DEMO\\\\asha", info: {computer: "PC-DEMO1", beat: {at: ago(0.2)}, bridges: {"go-demo11": {at: ago(0.2), computer: "PC-DEMO1", user: "DEMO\\\\asha", tallyState: "closed", tally: false, open: [], version: "2.5.19"}}}}];
  TLight.st.at = Date.now();
  CloudJobs.list = [{id: "11111111-1111-4111-8111-111111111111", client_id: a.id, company: "Demo Builders Pvt Ltd", status: "waiting", n: 3, done: 0, created_at: ago(45), updated_at: ago(3), target_bridge: "go-demo11", taken_by: "go-demo11", message: restart,
    entry_ids: ids, items: ids.map((id) => ({id, kind: "voucher", state: "waiting"})), results: []}];
  CloudJobs.at = Date.now();
  return openCompany(a.id).then(() => { S.postTabs = {[a.id]: "topost"}; goStep("post", "bills"); render(); return a.id; }); }"""
TXT = "() => document.querySelector('#app').innerText"
def page(br, w=1366, h=768, phone=False):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP, RESTART); pg.wait_for_timeout(2000); pg.evaluate("render()"); pg.wait_for_timeout(600)
    return ctx, pg
def shot(pg, name):
    if not SHOTS: return
    el = pg.locator("[data-post-queue]")
    if el.count(): el.first.scroll_into_view_if_needed()
    pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

with sync_playwright() as p:
    br = p.chromium.launch()
    for phone in (False, True):
        tag = "phone" if phone else "desktop"
        ctx, pg = page(br, 390 if phone else 1366, 844 if phone else 768, phone)
        if not phone:
            print("1. Tally closed")
        t = pg.evaluate(TXT)
        ok("Number 1 in the queue: Tally is closed. Open Tally and Demo Builders Pvt Ltd." in t, "%s: the waiting rows say Tally is closed, what to open" % tag)
        ok("restart FinCom Bridge" not in t, "%s: never 'restart FinCom Bridge'" % tag)
        ok("PC-DEMO1" not in t and "asha" not in t, "%s: no computer or Windows user named" % tag)
        ok(pg.locator("[data-post-queue] [data-cancel-post]").count() >= 1, "%s: Cancel stays" % tag)
        ok(pg.locator("[data-post-needs]").count() == 0, "%s: no extra warning box on the client's page" % tag)
        if phone: ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "phone: no sideways scroll")
        shot(pg, tag + "-post-wait-after")
        # before: the words the posting carries, as the page showed them before this branch (postWaitWhy given nothing)
        pg.evaluate("() => { window.__pw = window.postWaitWhy; window.postWaitWhy = () => ''; render(); }"); pg.wait_for_timeout(600)
        ok("restart FinCom Bridge" in pg.evaluate(TXT), "%s: before this branch the page said 'restart FinCom Bridge'" % tag)
        shot(pg, tag + "-post-wait-before")
        pg.evaluate("() => { window.postWaitWhy = window.__pw; render(); }"); pg.wait_for_timeout(400)
        if not phone:
            print("2. the company not open")
            pg.evaluate("() => { const b = TLight.st.devs[0].info.bridges['go-demo11']; b.tallyState = 'open'; b.tally = true; b.open = ['Another Demo Co']; render(); }"); pg.wait_for_timeout(600)
            ok("Demo Builders Pvt Ltd is not open in Tally. Open Tally and Demo Builders Pvt Ltd." in pg.evaluate(TXT), "the company not open there")
            print("3. Home: no new box, the figure as before")
            pg.evaluate("() => { S.view = 'home'; navHome('today'); render(); }"); pg.wait_for_timeout(1200)
            ok(pg.locator("[data-post-needs]").count() == 0, "Home: no extra warning box")
            tile = pg.evaluate("() => { const m = [...document.querySelectorAll('.metrics .metric')].find((e) => /Needs you/.test(e.textContent)); return m ? Number(m.querySelector('b').textContent) : null; }")
            ok(tile == 0, "Home's Needs you figure as before (%s)" % tile)
        ctx.close()
    br.close()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
