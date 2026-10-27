"""python3 run_announce_bar.py - the user app's announcement bar and feature flags (app/src/parts/Announce.jsx,
app/src/lib/flags.js; migration 123's announcements_active / announcement_dismiss / flags_for_me), on the React test build
(TDSDESK_SITE, default app/dist-test), offline firm, with the cloud calls answered in the page (no network):
  1. the bar is its own small chunk, loaded after the page (not in the main bundle)
  2. a few seconds after the page: ONE bar, the most severe first (urgent before info), its title and text
  3. Dismiss: announcement_dismiss(id) is called, and the next one shows; one that cannot be dismissed has no Dismiss
  4. the flags: flags_for_me is asked once; window.FinComFlags.on(key) answers from what was kept (no new request)
  5. before migration 123 (the functions missing: 404) or signed out: no bar, no words, no page error
  6. phone (390 px): the bar fits, no sideways scroll"""
import os, glob, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=SITE)
PORT = int(os.environ.get("ANN_PORT", 8156))
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("SHOTS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "console-ops-shots")
os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the cloud, answered in the page: Cloud.on() true, Cloud.api for the three functions (mode "on" / "missing" / "off")
STUB = r"""
window.__calls = [];
const t = setInterval(() => {
  if (typeof Cloud !== 'object' || !Cloud) return;
  clearInterval(t);
  const mode = window.__annMode || 'on';
  Cloud.on = () => mode !== 'off';
  Cloud.sess = () => (mode === 'off' ? null : { access_token: 'x', user: { id: 'u-1' } });
  const real = Cloud.api.bind(Cloud);
  Cloud.api = async (path, opts) => {
    if (!/^rpc\/(announcements_active|announcement_dismiss|flags_for_me)$/.test(path)) return real(path, opts);
    window.__calls.push([path, (opts || {}).body || {}]);
    if (mode === 'missing') throw new Error('404: Could not find the function (PGRST202)');
    if (path === 'rpc/flags_for_me') return { zoho_books: true, new_tds_screen: false };
    if (path === 'rpc/announcement_dismiss') { window.__gone = (window.__gone || []).concat(opts.body.p_id); return true; }
    const all = [
      { id: 'a-info', title: 'New feature', body: 'Zoho Books link is here.', severity: 'info', dismissible: false },
      { id: 'a-urgent', title: 'GST portal slow', body: 'Expect delays today.', severity: 'urgent', dismissible: true },
    ].filter(x => !(window.__gone || []).includes(x.id));
    return all.sort((a, b) => (a.severity === 'urgent' ? 0 : 1) - (b.severity === 'urgent' ? 0 : 1));
  };
}, 5);
"""
def open_app(br, mode, **kw):
    pg = br.new_page(**kw); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("window.__annMode = %r;" % mode); pg.add_init_script(STUB)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(1500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    return pg
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        print("== 1. its own chunk")
        chunks = glob.glob(os.path.join(SITE, "assets", "Announce-*.js"))
        main = [f for f in glob.glob(os.path.join(SITE, "assets", "index-*.js"))]
        ok(len(chunks) == 1 and os.path.getsize(chunks[0]) < 6000, "Announce is a chunk of its own, small (%s bytes)" % (os.path.getsize(chunks[0]) if chunks else "-"))
        ok(main and not any("announcements_active" in open(f).read() for f in main), "the main bundle does not carry it")
        print("== 2-4. the bar, dismiss, flags")
        pg = open_app(br, "on", viewport={"width": 1300, "height": 850})
        pg.wait_for_selector("[data-announce]", timeout=15000)
        ok(pg.get_attribute("[data-announce]", "data-announce") == "urgent" and "GST portal slow" in pg.inner_text("[data-announce]") and pg.locator("[data-announce]").count() == 1, "one bar, the urgent one first")
        pg.screenshot(path=os.path.join(SHOTS, "20-user-app-bar.png"))
        pg.click("[data-announce-dismiss]"); pg.wait_for_selector("[data-announce=info]")
        ok(["rpc/announcement_dismiss", {"p_id": "a-urgent"}] in pg.evaluate("window.__calls"), "Dismiss tells the server (announcement_dismiss)")
        ok("New feature" in pg.inner_text("[data-announce]") and pg.locator("[data-announce-dismiss]").count() == 0, "the next one shows; it cannot be dismissed, so no Dismiss")
        n = len([c for c in pg.evaluate("window.__calls") if c[0] == "rpc/flags_for_me"])
        ok(n == 1 and pg.evaluate("window.FinComFlags.on('zoho_books')") is True and pg.evaluate("window.FinComFlags.on('new_tds_screen', true)") is False and pg.evaluate("window.FinComFlags.on('nope', true)") is True,
           "flags: read once, then answered from what is kept (the default for an unknown one)")
        ok(len([c for c in pg.evaluate("window.__calls") if c[0] == "rpc/flags_for_me"]) == 1, "no second request for flags")
        pg.close()
        print("== 5. before migration 123, or signed out")
        for mode in ("missing", "off"):
            pg = open_app(br, mode, viewport={"width": 1300, "height": 850}); pg.wait_for_timeout(4500)
            ok(pg.locator("[data-announce]").count() == 0, "%s: no bar" % mode)
            pg.close()
        print("== 6. phone")
        pg = open_app(br, "on", viewport={"width": 390, "height": 844}, is_mobile=True)
        pg.wait_for_selector("[data-announce]", timeout=15000)
        ok(pg.evaluate("(() => { const r = document.querySelector('[data-announce]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()") and pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "the bar fits on a phone")
        pg.screenshot(path=os.path.join(SHOTS, "21-user-app-bar-phone.png"))
        br.close()
    ok(not errors, "no page errors (%s)" % errors[:3])
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
