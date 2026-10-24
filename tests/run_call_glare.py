"""python3 run_call_glare.py - the peer-to-peer media of calls (app/src/calls/media.js) when two people see each other
at about the same moment, in Chromium with a fake camera and microphone, the module loaded as it is (no build), the
signal channel a plain in-page bus (each message in its own task, as a websocket's):
  1. 20 pairs, the second of each seeing the first 0 to 40 ms later: each pair connects, the picture both ways, in a few
     seconds, without an ICE restart; only the side that is not polite (the smaller id) offers. When both offered
     (glare), the polite side rolled its own offer back for the other's, and Chromium then lost that side's ICE in some
     pairs: no candidates gathered, the line "new" for ever, no picture either way. That was run_video_calls_ui.py's
     "the host receives the owner's picture over WebRTC" / "the owner receives the host's picture" / "the owner sees
     the host's shared screen" failing in CI (and here under load)
  2. a line whose ICE never starts (every candidate of the first try lost): restarted by itself, then connected
  3. only the polite side sees the other (the other missed it): it offers itself after a short wait, and they connect
Run: python3 tests/run_call_glare.py"""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
CALLS = os.path.join(HERE, "..", "app", "src", "calls")
PAIRS = int(os.environ.get('GLARE_PAIRS', '20'))
ORIGIN = "http://localhost:9"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def serve(route, request):
    name = request.url[len(ORIGIN) + 1:].split("?")[0]
    if name == "": return route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>glare</title>")
    path = os.path.join(CALLS, os.path.basename(name))
    if not os.path.isfile(path): return route.fulfill(status=404, body="")
    route.fulfill(status=200, content_type="text/javascript", body=open(path, encoding="utf-8").read())

SETUP = """async () => {
  const { createMedia } = await import('/media.js');
  window.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  // the signal channel: every message to everyone else on the bus, in its own task (as a websocket's would come)
  window.bus = [];
  window.drop = (m) => false;
  window.offers = [];
  window.signalFor = (me) => {
    const handlers = {};
    const sig = { send: (ev, p) => { if (p.desc && p.desc.type === 'offer') offers.push(p.from); for (const s of bus) if (s.me !== me) setTimeout(() => { if (!drop(p)) (s.handlers[ev] || []).forEach((f) => f(JSON.parse(JSON.stringify(p)))); }, 0); },
                  on: (ev, f) => { (handlers[ev] = handlers[ev] || []).push(f); return () => { handlers[ev] = handlers[ev].filter((x) => x !== f); }; } };
    bus.push({ me, handlers });
    return sig;
  };
  window.restarts = 0;
  const orig = RTCPeerConnection.prototype.restartIce;
  RTCPeerConnection.prototype.restartIce = function () { window.restarts++; return orig.call(this); };
  window.person = async (me) => {
    const seen = {};
    const m = createMedia('p2p', { signal: signalFor(me), me, ice: [], onRemote: (id, s) => {
      if (!s) { delete seen[id]; return; }
      const x = seen[id] = seen[id] || {};
      if (s.state) x.state = s.state;
      x.video = !!(s.cam && s.cam.getVideoTracks().length);
    }, onLevel: () => {} });
    await m.start(stream);
    return { me, m, seen };
  };
  window.pairs = [];
  // n pairs; who: 'both' (the second sees the first 0 to 40 ms later, as presence comes: the first one's offer reaching
  // it while it would be making its own, in some of the pairs) or 'polite' (only the larger id sees the other)
  window.makePairs = async (n, tag, who) => {
    const made = [];
    for (let i = 0; i < n; i++) {
      const a = await person(tag + i + '-a'), b = await person(tag + i + '-b');
      made.push([a, b]);
    }
    made.forEach(([a, b], i) => { if (who !== 'polite') a.m.meet(b.me); setTimeout(() => b.m.meet(a.me), (i * 2) % 40); });
    pairs.push(...made);
    return made.length;
  };
  window.state = (tag) => pairs.filter(([a]) => a.me.startsWith(tag)).map(([a, b]) => {
    const ab = a.seen[b.me] || {}, ba = b.seen[a.me] || {};
    const up = (x) => x.state === 'connected' || x.state === 'completed';
    return { pair: a.me, ok: up(ab) && up(ba) && ab.video && ba.video, a: ab.state || 'new', b: ba.state || 'new', av: !!ab.video, bv: !!ba.video };
  });
}"""

def wait_all(pg, tag, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        st = pg.evaluate("(t) => state(t)", tag)
        if st and all(x["ok"] for x in st): return st, time.time() - t0
        pg.wait_for_timeout(200)
    return pg.evaluate("(t) => state(t)", tag), time.time() - t0

with sync_playwright() as p:
    br = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"])
    ctx = br.new_context(permissions=["camera", "microphone"])
    pg = ctx.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(ORIGIN + "/**", serve)
    pg.goto(ORIGIN + "/")
    pg.evaluate(SETUP)

    print("1. %d pairs seeing each other at about the same moment" % PAIRS)
    n = pg.evaluate("(n) => makePairs(n, 'g', 'both')", PAIRS)
    st, took = wait_all(pg, "g", 8)
    bad = [x for x in st if not x["ok"]]
    ok(n == PAIRS and not bad, "every pair connected with the picture both ways (%d of %d in %.1f s; stuck: %s)" % (n - len(bad), n, took, bad[:4]))
    ok(pg.evaluate("restarts") == 0, "without an ICE restart (%d)" % pg.evaluate("restarts"))
    polite = pg.evaluate("offers.filter((f) => f.endsWith('-b'))")
    ok(not polite, "only the side that is not polite offered: no glare (offers from the polite side: %d)" % len(polite))

    print("2. a line whose ICE never starts: restarted by itself")
    pg.evaluate("""() => { window.lost = 0; const t0 = Date.now(); window.drop = (p) => { if (p.ice && p.from.startsWith('w') && Date.now() - t0 < 4000) { lost++; return true; } return false; }; }""")
    pg.evaluate("() => makePairs(1, 'w', 'both')")
    pg.wait_for_timeout(3000)
    st0 = pg.evaluate("(t) => state(t)", "w")
    ok(pg.evaluate("lost") > 0 and not st0[0]["ok"], "its candidates lost, not connected (%s)" % st0)
    st, took = wait_all(pg, "w", 30)
    ok(all(x["ok"] for x in st), "connected after %.1f s more (%s)" % (took, st))
    ok(pg.evaluate("restarts") >= 1, "by an ICE restart (%d)" % pg.evaluate("restarts"))

    print("3. only the polite side sees the other: it offers after a short wait")
    pg.evaluate("() => { window.drop = () => false; window.offers = []; return makePairs(1, 'p', 'polite'); }")
    st, took = wait_all(pg, "p", 15)
    ok(all(x["ok"] for x in st) and 2.5 < took < 12, "connected after %.1f s (%s)" % (took, st))
    ok(pg.evaluate("offers").count("p0-b") >= 1, "the polite side made the offer (%s)" % pg.evaluate("offers"))
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
