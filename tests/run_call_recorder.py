"""python3 run_call_recorder.py - the host's recording of a call (app/src/calls/recorder.js compositeRecorder) in Chromium
with a fake camera and microphone, the module loaded as it is (no build):
  1. no voice in the mix (a host with no microphone, the others' voices not in yet): the recording still has its part.
     Before: the mix's track carried no sound at all, MediaRecorder never began, and the recording was empty
  2. with a voice, the encoder begins at once (under 1.5 s). In run_video_calls_ui.py (the fake microphone's short
     beeps and the others' quiet voices in the mix) it began 6 to 12 s late on a loaded computer, so its 14-second
     recording was now and then stopped before anything was made ("the composite recording's parts uploaded": parts 0)
  3. stopped a moment after it starts, with and without a voice: still a part, not nothing (a stop before the encoder
     has begun waits for it)
Run: python3 tests/run_call_recorder.py"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
CALLS = os.path.join(HERE, "..", "app", "src", "calls")
ORIGIN = "http://localhost:9"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def serve(route, request):
    name = request.url[len(ORIGIN) + 1:].split("?")[0]
    if name == "": return route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>rec</title><body></body>")
    path = os.path.join(CALLS, os.path.basename(name))
    if not os.path.isfile(path): return route.fulfill(status=404, body="")
    route.fulfill(status=200, content_type="text/javascript", body=open(path, encoding="utf-8").read())

RECORD = """async ([voice, ms]) => {
  const { compositeRecorder } = await import('/recorder.js');
  // when the encoder began ("start"), from the MediaRecorder's making
  const MR = window.MediaRecorder; let began = -1, t0 = 0;
  window.MediaRecorder = function (s, o) { const r = new MR(s, o); t0 = performance.now(); r.addEventListener('start', () => { began = Math.round(performance.now() - t0); }); return r; };
  window.MediaRecorder.prototype = MR.prototype; window.MediaRecorder.isTypeSupported = MR.isTypeSupported.bind(MR);
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const v = document.createElement('video'); v.muted = true; v.srcObject = s; document.body.appendChild(v); await v.play();
    const parts = [];
    const r = compositeRecorder({ tiles: () => [{ video: v, name: 'Riya', camOn: true }], screen: () => null, audio: () => voice ? [s] : [], onPart: (b) => parts.push(b.size) });
    await new Promise((done) => setTimeout(done, ms));
    await r.stop();
    v.remove(); s.getTracks().forEach((t) => t.stop());
    return { parts, began };
  } finally { window.MediaRecorder = MR; }
}"""

with sync_playwright() as p:
    br = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = br.new_context(permissions=["camera", "microphone"])
    pg = ctx.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(ORIGIN + "/**", serve)
    pg.goto(ORIGIN + "/")

    print("1. no voice in the mix")
    r = [pg.evaluate(RECORD, [False, 3000]) for _ in range(2)]
    ok(all(x["parts"] and sum(x["parts"]) > 1000 for x in r), "the recording has its part (%s)" % r)

    print("2. the encoder begins at once")
    r = [pg.evaluate(RECORD, [True, 3000]) for _ in range(3)]
    ok(all(0 <= x["began"] < 1500 for x in r), "began within 1.5 s each time (%s ms)" % [x["began"] for x in r])
    ok(all(x["parts"] and sum(x["parts"]) > 1000 for x in r), "with its part (%s)" % [x["parts"] for x in r])

    print("3. stopped a moment after it starts")
    r = [pg.evaluate(RECORD, [True, 300]), pg.evaluate(RECORD, [False, 300])]
    ok(all(x["parts"] for x in r), "still a part, with and without a voice (%s)" % r)
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
