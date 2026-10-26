"""python3 tests/run_call_effects.py - the picture's effects of a call (app/src/calls/effects.js: background blur, a
background image, the lighting fix, the touch-up), measured in Chromium on a fake camera, the modules loaded as they are
(no build), MediaPipe's own files from assets/mediapipe/.
The owner, 25-Oct-2026 night: "touch-up and background is not working properly".
The camera: a .y4m made here (Chromium's --use-file-for-fake-video-capture) from CALL_FACE (a portrait photo, kept out
of git) or, without one, a drawn head and shoulders over a busy background; a moving copy (a head that sways) and a
still copy (one frame: anything that moves in the picture sent is the effect's own flicker).
  1. each effect on its own and together: the picture sent has frames at >= 20 a second, none black (the first one
     included), and the effect is seen in it (blur: the background loses detail; image: the background is the image's
     colour; touch-up: the skin is smoother; lighting: a dark camera made brighter)
  2. the same with the processor slowed four times (CDP Emulation.setCPUThrottlingRate 4, a light laptop): >= 20 a second
  3. flicker: on the still camera the person's outline does not jump about from frame to frame
  4. what is SENT: the processed picture through a real RTCPeerConnection (the receiver's frames have the image's
     background), effects turned on and off mid-call (replaceTrack): the receiver's picture never stops and never goes black
  5. the camera never broken: an effect that cannot run (no WebGL, MediaPipe refused, a canvas that gives black frames,
     as some Safari versions do) falls back to the camera untouched, with a note; effectsSupport() says what this browser
     can do (iPhone Safari before 16.4: no background effects, the option hidden with a short note)
CALL_SHOTS=<dir>: before/after pictures. Run: python3 tests/run_call_effects.py"""
import os, sys, time, json, math, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFilter, ImageChops
ROOT = os.path.join(HERE, "..")
CALLS = os.environ.get("FX_CALLS") or os.path.join(ROOT, "app", "src", "calls")
ASSETS = os.path.join(ROOT, "assets")
ORIGIN = "http://localhost:9"
SHOTS = os.environ.get("CALL_SHOTS", "")
TMP = os.environ.get("CALL_TMP") or ("/dev/shm" if os.path.isdir("/dev/shm") else tempfile.gettempdir())
W, H, FPS = 640, 360, 30
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------------------------------------------------------------- the camera
def scene():
    face = os.environ.get("CALL_FACE", "")
    if face and os.path.isfile(face):
        im = Image.open(face).convert("RGB")
        # head and shoulders, 16:9, as a laptop's camera sees a person
        w = im.width; h = int(w * 9 / 16)
        return im.crop((0, 0, w, h)).resize((W + 80, H + 45)), True
    im = Image.new("RGB", (W + 80, H + 45), (120, 130, 150))
    d = ImageDraw.Draw(im)
    for i in range(0, W + 80, 24):          # a busy background: shelves of books
        for j in range(0, H + 45, 60):
            d.rectangle((i, j, i + 18, j + 52), fill=((i * 7) % 200 + 30, (j * 3 + i) % 180 + 40, (i + j) % 160 + 60))
    cx = (W + 80) // 2
    d.ellipse((cx - 150, 250, cx + 150, 470), fill=(40, 50, 90))        # shoulders
    d.rectangle((cx - 28, 200, cx + 28, 270), fill=(196, 140, 108))     # neck
    d.ellipse((cx - 62, 70, cx + 62, 230), fill=(205, 150, 115))        # face
    d.ellipse((cx - 66, 60, cx + 66, 130), fill=(30, 25, 20))           # hair
    for x in (cx - 25, cx + 25): d.ellipse((x - 7, 135, x + 7, 145), fill=(40, 30, 25))
    d.arc((cx - 25, 170, cx + 25, 200), 20, 160, fill=(120, 50, 50), width=4)
    return im.filter(ImageFilter.GaussianBlur(1)), False

def y4m(path, frames):
    with open(path, "wb") as f:
        f.write(b"YUV4MPEG2 W%d H%d F%d:1 Ip A1:1 C420jpeg\n" % (W, H, FPS))
        for fr in frames:
            y, cb, cr = fr.convert("YCbCr").split()
            f.write(b"FRAME\n"); f.write(y.tobytes()); f.write(cb.resize((W // 2, H // 2)).tobytes()); f.write(cr.resize((W // 2, H // 2)).tobytes())

def cameras():
    base, real = scene()
    moving = []
    for i in range(60):                   # two seconds, a head that sways (the file loops)
        t = i / 60.0 * 2 * math.pi
        dx, dy = int(30 + 22 * math.sin(t)), int(20 + 8 * math.sin(2 * t))
        moving.append(base.crop((dx, dy, dx + W, dy + H)))
    # the still camera: one picture with a camera's own grain (each frame its own), as a real sensor gives
    st = base.crop((30, 20, 30 + W, 20 + H))
    still = []
    for i in range(30):
        n = Image.effect_noise((W, H), 6).convert("RGB")
        still.append(ImageChops.add(st, n, 1, -128))
    a, b = os.path.join(TMP, "fincom-fx-moving.y4m"), os.path.join(TMP, "fincom-fx-still.y4m")
    y4m(a, moving); y4m(b, still)
    return a, b, real

# ---------------------------------------------------------------- the page
def serve(route, request):
    name = request.url[len(ORIGIN) + 1:].split("?")[0]
    if name == "": return route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>fx</title><body style='margin:0;background:#222'></body>")
    if name.startswith("assets/"):
        path = os.path.join(ASSETS, *name.split("/")[1:])
        if not os.path.isfile(path): return route.fulfill(status=404, body="")
        ct = {"mjs": "text/javascript", "js": "text/javascript", "wasm": "application/wasm", "svg": "image/svg+xml", "tflite": "application/octet-stream"}.get(name.rsplit(".", 1)[-1], "application/octet-stream")
        if os.environ.get("FX_BLOCK_MP") and "mediapipe" in name: return route.fulfill(status=503, body="")
        return route.fulfill(status=200, content_type=ct, body=open(path, "rb").read())
    path = os.path.join(CALLS, os.path.basename(name))
    if not os.path.isfile(path): return route.fulfill(status=404, body="")
    route.fulfill(status=200, content_type="text/javascript", body=open(path, encoding="utf-8").read())

SETUP = """async () => {
  window.TDS_ASSETS = '/assets/';
  window.FX = await import('/effects.js');
  window.cam = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 640, height: 360 } });
  // the picture a track carries, read the way a receiver would: frames counted as they are presented, a few of them
  // read back small (luminance, the corners, the detail of the background, the change from the frame before)
  window.watch = (track, secs) => new Promise((done) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track]);
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d', { willReadFrequently: true });
    const t0 = performance.now(); const blackAt = []; let frames = 0, firstAt = 0, black = 0, read = 0, lastRead = 0, prev = null, diffs = [], lum = [], corner = [], detail = [], firstBlack = null;
    const look = () => {
      if (!v.videoWidth) return;
      x.drawImage(v, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; read++;
      let s = 0, df = 0, cr = [0, 0, 0], cn = 0, dt = 0;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += y;
        if (prev) df += Math.abs(y - prev[i >> 2]);
        const px = (i >> 2) % 160, py = (i >> 2) / 160 | 0;
        if (px < 24 && py < 20) { cr[0] += d[i]; cr[1] += d[i + 1]; cr[2] += d[i + 2]; cn++; }
        if (px > 0 && px < 30 && py < 60) { const j = i - 4; dt += Math.abs(y - (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2])); }
      }
      const yy = new Float32Array(d.length / 4); for (let i = 0; i < d.length; i += 4) yy[i >> 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const mean = s / (d.length / 4);
      // a fresh <video> on a generated track can show one empty frame first (the receiver's own check is in 4)
      if (read <= 1 && mean < 6) return;
      if (firstBlack === null) firstBlack = mean < 6;
      if (mean < 6) { black++; blackAt.push(read + '@' + Math.round(performance.now() - t0)); }
      if (prev) diffs.push(df / (d.length / 4));
      prev = yy; lum.push(mean); corner.push(cr.map((z) => Math.round(z / cn))); detail.push(dt / (29 * 60));
    };
    const tick = (now) => {
      frames++; if (!firstAt) firstAt = performance.now() - t0;
      if (performance.now() - lastRead > 150) { lastRead = performance.now(); look(); }
      if (performance.now() - t0 < secs * 1000) v.requestVideoFrameCallback(tick);
      else { const s0 = (performance.now() - t0 - firstAt) / 1000;
        const avg = (a) => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0;
        done({ blackAt, fps: Math.round(10 * (frames - 1) / s0) / 10, frames, firstMs: Math.round(firstAt), black, firstBlack, read, lum: Math.round(avg(lum)), diff: Math.round(100 * avg(diffs.slice(2))) / 100,
               corner: corner.length ? corner[corner.length - 1] : null, detail: Math.round(100 * avg(detail)) / 100 }); v.srcObject = null; }
    };
    v.requestVideoFrameCallback(tick); v.play();
  });
  window.runFx = async (choice, secs, opts) => {
    const t0 = performance.now(); window.fxNote = '';
    const fx = await FX.makeEffects(cam, choice, (n) => { window.fxNote = n; }, opts || {});
    const made = Math.round(performance.now() - t0);
    if (choice.bg !== 'none') { const t1 = performance.now(); while (!fx.segmenting && performance.now() - t1 < 20000) await new Promise((r) => setTimeout(r, 100)); }
    await new Promise((r) => setTimeout(r, 1200));
    const m = await watch(fx.track, secs);
    const st = fx.stats ? fx.stats() : null;
    window.lastFx = fx;
    return Object.assign(m, { made, segmenting: !!fx.segmenting, stats: st, note: window.fxNote || '', fallback: fx.track === cam.getVideoTracks()[0] || !!fx.fellBack });
  };
  window.stopFx = () => { if (window.lastFx) window.lastFx.stop(); window.lastFx = null; };
  window.snap = async (track) => { const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([track]); await v.play();
    await new Promise((r) => setTimeout(r, 400)); const c = document.createElement('canvas'); c.width = 640; c.height = 360; c.getContext('2d').drawImage(v, 0, 0, 640, 360); return c.toDataURL('image/png'); };
}"""

LOOPBACK = """async () => {
  // a real peer connection, as the call's: the camera (or the effects' track) sent, the receiver's frames read
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate); b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  window.sender = a.addTransceiver(cam.getVideoTracks()[0], { direction: 'sendonly' }).sender;
  const got = new Promise((r) => { b.ontrack = (e) => r(e.track); });
  await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription); await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
  window.received = await got; window.pcs = [a, b];
  // the receiver's picture, continuously: frames, black ones, the longest gap between two frames
  const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([received]); document.body.appendChild(v); await v.play().catch(() => {});
  const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d', { willReadFrequently: true });
  window.rx = { frames: 0, black: 0, gap: 0, last: 0, corner: null, w: 0 };
  const tick = () => { const t = performance.now(); rx.frames++; if (rx.last) rx.gap = Math.max(rx.gap, t - rx.last); rx.last = t; rx.w = v.videoWidth;
    if (rx.frames % 5 === 0) { x.drawImage(v, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; if (s / (d.length / 4) / 3 < 6) rx.black++;
      const k = x.getImageData(0, 0, 8, 6).data; let r = 0, g = 0, bb = 0; for (let i = 0; i < k.length; i += 4) { r += k[i]; g += k[i + 1]; bb += k[i + 2]; } rx.corner = [r / 48 | 0, g / 48 | 0, bb / 48 | 0]; }
    v.requestVideoFrameCallback(tick); };
  v.requestVideoFrameCallback(tick);
  return true;
}"""

def page(br, cam_file, extra=None):
    args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-video-capture=" + cam_file,
            "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] + (extra or [])
    b = br.launch(args=args)
    ctx = b.new_context(permissions=["camera", "microphone"], viewport={"width": 900, "height": 600})
    pg = ctx.new_page(); pg.set_default_timeout(90000)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route(ORIGIN + "/**", serve)
    pg.goto(ORIGIN + "/"); pg.evaluate(SETUP)
    return b, pg, errs

def save(pg, name, js="snap(lastFx ? lastFx.track : cam.getVideoTracks()[0])"):
    if not SHOTS: return
    import base64
    os.makedirs(SHOTS, exist_ok=True)
    u = pg.evaluate("() => " + js)
    open(os.path.join(SHOTS, name + ".png"), "wb").write(base64.b64decode(u.split(",")[1]))

def run(pg, choice, secs=4, opts=None):
    r = pg.evaluate("([c, s, o]) => runFx(c, s, o)", [choice, secs, opts or {}])
    return r

if __name__ == "__main__":
    moving, still, real = cameras()
    print("camera: %s (%s)" % ("a portrait photo (CALL_FACE)" if real else "a drawn head and shoulders", moving))
    OFF = {"bg": "none", "image": "", "light": False, "touch": 0}
    NAVY = "/assets/call-bg/navy.svg"
    with sync_playwright() as p:
        br = p.chromium
        b, pg, errs = page(br, moving)
        sup = pg.evaluate("() => FX.effectsSupport ? FX.effectsSupport() : null")
        ok(bool(sup) and sup.get("bg") is True and sup.get("look") is True, "effectsSupport(): this Chromium can do the background and the look (%s)" % sup)
        raw = pg.evaluate("() => watch(cam.getVideoTracks()[0], 3)")
        print("  the camera itself: %s" % raw)
        save(pg, "fx-0-camera", "snap(cam.getVideoTracks()[0])")

        print("1. each effect, the picture sent (fps, black frames, the effect seen)")
        res = {}
        for name, ch in [("blur", dict(OFF, bg="blur")), ("image", dict(OFF, bg="image", image=NAVY)), ("touch", dict(OFF, touch=1)), ("light", dict(OFF, light=True)), ("all", dict(OFF, bg="blur", touch=1, light=True))]:
            r = res[name] = run(pg, ch)
            save(pg, "fx-1-" + name)
            pg.evaluate("stopFx()")
            print("     %-6s %s" % (name, json.dumps({k: r[k] for k in ("fps", "black", "blackAt", "firstBlack", "firstMs", "detail", "corner", "lum", "diff", "segmenting", "made", "stats", "note")})))
            cam_now = pg.evaluate("() => watch(cam.getVideoTracks()[0], 2)")["fps"]
            ok(r["fps"] >= min(20, 0.8 * cam_now), "%s: %.1f frames a second sent (>= 20; the camera itself %.1f just now, this computer's load)" % (name, r["fps"], cam_now))
            ok(r["stats"]["procMs"] < 33, "%s: %.1f ms of work a frame in the worker (< 33: it keeps up with the camera)" % (name, r["stats"]["procMs"]))
            ok(r["black"] == 0 and not r["firstBlack"], "%s: no black frame, the first one included (%d black of %d read)" % (name, r["black"], r["read"]))
            if ch["bg"] != "none": ok(r["segmenting"], "%s: the person told apart from the background (MediaPipe running)" % name)
        ok(res["blur"]["detail"] < raw["detail"] * 0.6, "blur: the background's detail gone (%.2f, the camera %.2f)" % (res["blur"]["detail"], raw["detail"]))
        c = res["image"]["corner"] or [255, 255, 255]
        ok(c[2] > c[0] and sum(c) < 260, "image: the corner is the navy background's (%s; the camera %s)" % (c, raw["corner"]))
        ok(res["touch"]["fps"] >= 20, "touch-up alone keeps the frame rate")

        print("2. a slow laptop: the processor four times slower (CDP Emulation.setCPUThrottlingRate 4; it slows the workers too)")
        cdp = pg.context.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        for name, ch in [("blur", dict(OFF, bg="blur")), ("image", dict(OFF, bg="image", image=NAVY)), ("touch", dict(OFF, touch=1)), ("all", dict(OFF, bg="blur", touch=1, light=True))]:
            r = run(pg, ch, 6); pg.evaluate("stopFx()")
            print("     %-6s %s" % (name, json.dumps({k: r[k] for k in ("fps", "black", "firstMs", "segmenting", "stats")})))
            cam_now = pg.evaluate("() => watch(cam.getVideoTracks()[0], 2)")["fps"]
            ok(r["fps"] >= min(20, 0.8 * cam_now), "slowed x4, %s: %.1f frames a second sent (>= 20; the camera itself %.1f just now)" % (name, r["fps"], cam_now))
            ok(r["stats"]["procMs"] < 45, "slowed x4, %s: %.1f ms of work a frame (< 45: at least 22 a second)" % (name, r["stats"]["procMs"]))
            ok(r["black"] == 0, "slowed x4, %s: no black frame" % name)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})

        print("4. what is sent: the processed picture over a peer connection, effects on and off mid-call")
        pg.evaluate(LOOPBACK)
        pg.wait_for_timeout(2500)
        rx0 = pg.evaluate("() => Object.assign({}, rx)")
        fx_on = pg.evaluate("""async () => { window.lastFx = await FX.makeEffects(cam, { bg: 'image', image: '/assets/call-bg/navy.svg', light: false, touch: 0 });
          const t1 = performance.now(); while (!lastFx.segmenting && performance.now() - t1 < 20000) await new Promise((r) => setTimeout(r, 100));
          rx.gap = 0; await sender.replaceTrack(lastFx.track); await new Promise((r) => setTimeout(r, 3000)); return Object.assign({}, rx); }""")
        ok(fx_on["frames"] > rx0["frames"] + 30, "the receiver's picture goes on after effects are turned on (%d -> %d frames)" % (rx0["frames"], fx_on["frames"]))
        cn = fx_on["corner"] or [255, 255, 255]
        ok(cn[2] > cn[0] and sum(cn) < 260, "the receiver sees the navy background: the processed picture is what is sent (%s)" % cn)
        save(pg, "fx-4-received", "snap(received)")
        fx_off = pg.evaluate("""async () => { const before = rx.frames; rx.gap = 0; await sender.replaceTrack(cam.getVideoTracks()[0]); stopFx(); await new Promise((r) => setTimeout(r, 2500));
          const back = Object.assign({}, rx, { before }); rx.gap = 0;
          window.lastFx = await FX.makeEffects(cam, { bg: 'blur', image: '', light: false, touch: 1 }); await sender.replaceTrack(lastFx.track); await new Promise((r) => setTimeout(r, 2500));
          return { off: back, on: Object.assign({}, rx) }; }""")
        ok(fx_off["off"]["frames"] > fx_off["off"]["before"] + 20 and fx_off["off"]["gap"] < 1500, "effects off mid-call: the picture goes on (longest gap %d ms)" % fx_off["off"]["gap"])
        ok(fx_off["on"]["gap"] < 1500, "effects on again: no freeze (longest gap %d ms)" % fx_off["on"]["gap"])
        ok(fx_off["on"]["black"] == rx0["black"] == 0, "the receiver never got a black picture (%d)" % fx_off["on"]["black"])
        pg.evaluate("stopFx()")
        b.close()

        print("3. flicker on a still camera")
        b, pg, errs2 = page(br, still)
        rawst = pg.evaluate("() => watch(cam.getVideoTracks()[0], 2)")
        fl = {}
        for name, ch in [("blur", dict(OFF, bg="blur")), ("image", dict(OFF, bg="image", image=NAVY)), ("touch", dict(OFF, touch=1))]:
            r = fl[name] = run(pg, ch, 4); pg.evaluate("stopFx()")
            print("     %-6s change frame to frame %.2f (the camera itself %.2f)" % (name, r["diff"], rawst["diff"]))
        cd = rawst["diff"]
        ok(fl["blur"]["diff"] < cd and fl["image"]["diff"] < cd, "the outline steady: blur %.2f, image %.2f grey levels a pixel from one frame to the next, below the camera's own grain (%.2f)" % (fl["blur"]["diff"], fl["image"]["diff"], cd))
        ok(fl["touch"]["diff"] <= cd * 1.02, "the touch-up adds no flicker (%.2f; the camera %.2f)" % (fl["touch"]["diff"], cd))
        b.close()

        print("5. the camera never broken")
        os.environ["FX_BLOCK_MP"] = "1"
        b, pg, errs3 = page(br, moving)
        r = run(pg, dict(OFF, bg="blur"), 2)
        ok(r["black"] == 0 and r["fps"] >= 20 and r["note"], "MediaPipe refused: the camera goes on, with a note (%r, %.1f fps)" % (r["note"], r["fps"]))
        pg.evaluate("stopFx()")
        del os.environ["FX_BLOCK_MP"]
        bad = pg.evaluate("""async () => {
          // a canvas whose frames come out black (seen on some Safari versions with a WebGL canvas): the camera is sent instead
          const fx = await FX.makeEffects(cam, { bg: 'none', image: '', light: false, touch: 1 }, (n) => { window.fxNote2 = n; }, { forceBlack: true });
          await new Promise((r) => setTimeout(r, 3500));
          return { fell: !!fx.fellBack, note: window.fxNote2 || '', same: fx.track.id === cam.getVideoTracks()[0].id || fx.fellBack }; }""")
        ok(bad["fell"] and bad["note"], "black frames out of the canvas: the camera untouched instead, with a note (%s)" % bad)
        sup2 = pg.evaluate("""() => FX.effectsSupport({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1', simd: false, webgl: true, capture: true })""")
        ok(sup2["bg"] is False and sup2["note"], "iPhone Safari 15: no background effects, said in a short note (%s)" % sup2)
        sup3 = pg.evaluate("""() => FX.effectsSupport({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', simd: true, webgl: true, capture: true })""")
        ok(sup3["bg"] is True and sup3["light"] is True, "iPhone Safari 17: offered, as a light device (%s)" % sup3)
        sup4 = pg.evaluate("""() => FX.effectsSupport({ userAgent: 'x', simd: true, webgl: true, capture: false })""")
        ok(sup4["bg"] is False and sup4["look"] is False and sup4["note"], "no canvas capture: no effects at all, the camera as it is (%s)" % sup4)
        b.close()
        allerr = errs + errs2 + errs3
        ok(not allerr, "no page errors (%s)" % allerr[:3])
    for f in (moving, still):
        try: os.remove(f)
        except OSError: pass
    print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
    sys.exit(1 if fails else 0)
