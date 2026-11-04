"""python3 run_scroll_rdp.py - next-scroll-rdp (04-Nov-2026; the owner: on the shared Windows Server, over Remote Desktop, no
GPU, Chrome 156, "FinCom's Tally page and the website are slow; on the Tally page, scrolling down with the mouse wheel
doesn't move the page (or barely)").
Chromium as on that server: software drawing (--disable-gpu, --disable-gpu-compositing), a 4x slower CPU, a 1366x768 screen at scale 1
(the page gets 1349x657 of it: Chrome's bars, the taskbar, a classic scroll bar). Signed in to a stand-in of FinCom's cloud with a made-up firm (tally_shapes.py), made-up FinCom Bridges on
127.0.0.1. On each page, the mouse over its list (or table) and the real wheel (page.mouse.wheel):
  1. the first wheel moves the PAGE (the document, not a box inside it) within 200 ms;
  2. three 3-second scrolls (down, up, down): no frame over 100 ms (long-animation-frame and requestAnimationFrame gaps), and the page moved;
  3. no box inside the page took the wheel (a box as tall as the window around a list took it: the page stayed put).
Pages: the Tally page opened from a client ("Open Tally page": its row marked and For support open), Clients, Today.
RED on build mw2fgxey-adc625 (184036690): Clients and Today, the wheel scrolled the list's box (max-height 100vh - 170px), the
page never moved; the Tally page, frames of 130-180 ms (the whole app drawn again from a timer in the middle of the scroll).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_scroll_rdp.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
HOST, PORT = os.environ.get("TALLY_HOST", "localhost"), int(os.environ.get("SCROLL_PORT", "9587"))
CPU = float(os.environ.get("TALLY_CPU", "4")); SCROLL_S = float(os.environ.get("SCROLL_S", "3"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
LATEST = {"setup": {"version": "2.5.3", "url": "https://x.example/assets/bridge-go/FinComBridge-Setup-2.5.3.exe", "sha256": "ab" * 32}}
READY = "() => typeof S === 'object' && S && S.firm && typeof Cloud === 'object' && Cloud.st && !!Cloud.st.lastSync && typeof render === 'function'"
# the frames (long-animation-frame), the gaps between frames (requestAnimationFrame), the first wheel and when the page moved
WATCH = """(() => {
  window.__loaf = []; window.__box = {}; window.__w = 0; window.__moved = 0; window.__gaps = []; window.__run = 0;
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__loaf.push({d: Math.round(e.duration), t: Math.round(e.startTime),
    s: (e.scripts || []).map((x) => [Math.round(x.duration), String(x.sourceURL).split('/').pop().split('?')[0], x.sourceFunctionName || x.invoker]).slice(0, 3)}))).observe({type: 'long-animation-frame', buffered: false}); } catch (e) {}
  addEventListener('wheel', (e) => { if (!window.__w) window.__w = e.timeStamp; }, {capture: true, passive: true});
  document.addEventListener('scroll', (e) => { if (e.target !== document) { const t = e.target; const k = t.tagName + '.' + String(t.className).split(' ').slice(0, 2).join('.'); window.__box[k] = (window.__box[k] || 0) + 1; } }, {capture: true, passive: true});
  window.__start = () => { window.__loaf = []; window.__box = {}; window.__w = 0; window.__moved = 0; window.__gaps = []; window.__run = 1;
    const y0 = scrollY; let last = performance.now();
    const f = (t) => { if (!window.__moved && scrollY !== y0) window.__moved = t; window.__gaps.push(t - last); last = t; if (window.__run) requestAnimationFrame(f); };
    requestAnimationFrame(f); return y0; };
})()"""
# the mouse over the page's list: its biggest table in view (else the middle of the page)
SPOT = """() => { const vis = (r) => r.width > 200 && r.height > 60 && r.top < innerHeight - 40 && r.bottom > 140;
  const t = [...document.querySelectorAll('#app table')].map((e) => e.getBoundingClientRect()).filter(vis).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!t) return [Math.round(innerWidth / 2 + 80), Math.round(innerHeight / 2)];
  return [Math.round(t.left + t.width / 2), Math.round(Math.max(t.top, 140) + Math.min(innerHeight - 60, t.bottom) ) / 2 | 0]; }"""
def main():
    srv = http.server.ThreadingHTTPServer((HOST, PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://%s:%d/" % (HOST, PORT)
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-gpu", "--disable-gpu-compositing",
                                     "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        def page(label, go):
            fx = TS.make(); cloud = TS.FakeCloud(fx); loop = []
            ctx = br.new_context(viewport={"width": 1349, "height": 657}, device_scale_factor=1, service_workers="block")
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append("%s: %s" % (label, str(e)[:300])))
            pg.add_init_script(TS.signin_script(fx)); pg.add_init_script(WATCH)
            ctx.route("https://*.supabase.co/**", cloud.route)
            ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
            ctx.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            ctx.route("http://127.0.0.1:*/**", TS.bridges("own253", loop))
            # the cloud's live updates: a socket that stays open and quiet (no server here to close it every few seconds)
            try: ctx.route_web_socket("**", lambda ws: None)
            except Exception: pass
            cdp = ctx.new_cdp_session(pg)
            pg.goto(base + "#/today", wait_until="domcontentloaded", timeout=120000)
            pg.wait_for_function(READY, timeout=90000); pg.wait_for_timeout(1500)
            pg.evaluate(go); pg.wait_for_timeout(8000)
            if CPU > 1: cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
            pg.wait_for_timeout(1500)
            x, y = pg.evaluate(SPOT); pg.mouse.move(x, y); pg.wait_for_timeout(400)
            room = pg.evaluate("() => document.scrollingElement.scrollHeight - innerHeight - scrollY")
            y0 = pg.evaluate("() => window.__start()")
            pg.mouse.wheel(0, 100)
            pg.wait_for_timeout(600)
            first = pg.evaluate("() => ({w: window.__w, moved: window.__moved, y: scrollY})")
            pg.evaluate("() => { window.__loaf = []; window.__gaps = []; }")   # the frames counted from here: the scroll itself
            for dy in (100, -100, 100):   # down, back up, down again: SCROLL_S each
                t = 0
                while t < SCROLL_S * 1000:
                    pg.mouse.wheel(0, dy); pg.wait_for_timeout(100); t += 100
            pg.wait_for_timeout(300)
            r = pg.evaluate("() => { window.__run = 0; const g = window.__gaps.slice(2); return {y: scrollY, gap: Math.round(Math.max(0, ...g)), frames: g.length, box: window.__box, loaf: window.__loaf.slice().sort((a, b) => b.d - a.d).slice(0, 3)}; }")
            lat = round(first["moved"] - first["w"]) if first["moved"] and first["w"] else None
            worst = max([r["gap"]] + [l["d"] for l in r["loaf"]])
            print("      %s: mouse at %d,%d; page room %d px; first wheel: %s; %s" % (label, x, y, room, json.dumps(first), json.dumps(r)[:700]), flush=True)
            ok(room >= 100, "%s: the page is longer than the window (%d px to scroll)" % (label, room))
            ok(lat is not None and lat <= 200 and first["y"] > y0, "%s: the first wheel moves the page within 200 ms (%s ms, scrollY %d -> %d)" % (label, lat, y0, first["y"]))
            ok(r["y"] >= min(room + y0, y0 + 400) - 2, "%s: the wheel moves the page down (scrollY %d -> %d of %d)" % (label, y0, r["y"], room + y0))
            ok(worst <= 100, "%s: no frame over 100 ms while scrolling (the longest %d ms; %d frames)" % (label, worst, r["frames"]))
            ok(not r["box"], "%s: no box inside the page took the wheel (%s)" % (label, json.dumps(r["box"])))
            ctx.close()
        print("software drawing, a %gx slower CPU, 1349x657 at scale 1; the real wheel over each page's list" % CPU)
        page("the Tally page from a client", "() => openTallyFor('c000115838')")
        page("the Tally page", "() => { location.hash = '#/tally'; }")
        page("Clients", "() => { location.hash = '#/clients'; }")
        page("Today", "() => { location.hash = '#/today'; }")
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)
main()
