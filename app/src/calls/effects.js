// The picture's effects, all in this browser (nothing goes to a server): background blur, a background image (FinCom's
// own or the person's), a lighting fix (automatic brightness and contrast) and a light touch-up (mild skin smoothing).
// All off by default; the choice is remembered for the person on this device. Off means the camera goes out untouched
// (no canvas, no cost).
// The person is told apart from the background by MediaPipe's selfie segmenter (Apache-2.0), served from this site
// (assets/mediapipe/, see its LICENSE.txt) and loaded only when blur or an image is turned on; each file's sha256 is checked
// before it is used. One WebGL pass draws the result: the background (a blurred small copy of the frame, or the image),
// the person over it by the mask, the lighting gain and the touch-up's edge-keeping smoothing on skin tones.
import { effectsClean, EFFECTS_OFF, weakDevice } from "./rules.js";

export const MP_VERSION = "0.10.35";
export const MP_FILES = {
  bundle: ["vision_bundle.mjs", "55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe"],
  loader: ["vision_wasm_internal.js", "e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c"],
  wasm: ["vision_wasm_internal.wasm", "6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc"],
  model: ["selfie_segmenter.tflite", "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b"],
};
// FinCom's backgrounds (assets/call-bg/)
export const BACKGROUNDS = [
  { id: "office", name: "FinCom office", file: "call-bg/office.svg" },
  { id: "navy", name: "FinCom navy", file: "call-bg/navy.svg" },
  { id: "plain", name: "Plain light", file: "call-bg/plain.svg" },
];
const assets = () => (window.TDS_ASSETS || "./assets/");

// ---------------------------------------------------------------- remembered per person
const key = (who) => "fincom.call-fx:" + (who || "guest");
export function loadChoice(who) { try { return effectsClean(JSON.parse(localStorage.getItem(key(who)) || "null")); } catch (e) { return Object.assign({}, EFFECTS_OFF); } }
export function saveChoice(who, c) { try { localStorage.setItem(key(who), JSON.stringify(effectsClean(c))); } catch (e) { /* the choice lasts this call only */ } }
export const lightDevice = () => weakDevice(navigator);

// ---------------------------------------------------------------- MediaPipe, checked and loaded once
const hex = (buf) => Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
async function fetchChecked(name, sha) {
  const r = await fetch(assets() + "mediapipe/" + name, { cache: "force-cache" });
  if (!r.ok) throw new Error(name + " could not be loaded (" + r.status + ")");
  const b = await r.arrayBuffer();
  const got = hex(await crypto.subtle.digest("SHA-256", b));
  if (got !== sha) throw new Error(name + " is not the file FinCom expects (sha256 " + got.slice(0, 12) + "…)");
  return b;
}
// WebAssembly SIMD (every Chrome since 91, Safari since 16.4): the only build kept
export function simdOk() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
}
let segmenterP = null;
export function loadSegmenter() {
  if (segmenterP) return segmenterP;
  segmenterP = (async () => {
    if (!simdOk()) throw Object.assign(new Error("Background effects need a newer browser (Chrome 91 or Safari 16.4 and later)."), { kind: "old" });
    const [, , wasm, model] = await Promise.all(Object.values(MP_FILES).map(([n, s]) => fetchChecked(n, s)));
    const mp = await import(/* @vite-ignore */ new URL(assets() + "mediapipe/" + MP_FILES.bundle[0], location.href).href);
    const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    const fileset = { wasmLoaderPath: new URL(assets() + "mediapipe/" + MP_FILES.loader[0], location.href).href, wasmBinaryPath: wasmUrl };
    const opts = (delegate) => ({ baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate }, runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true });
    try { return await mp.ImageSegmenter.createFromOptions(fileset, opts("GPU")); }
    catch (e) { return await mp.ImageSegmenter.createFromOptions(fileset, opts("CPU")); }
  })();
  segmenterP.catch(() => { segmenterP = null; });
  return segmenterP;
}

// ---------------------------------------------------------------- the WebGL pass
const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
const FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D uFrame, uMask, uBg;
uniform int uMode;            // 0 none, 1 blur, 2 image
uniform vec2 uTexel, uBgScale, uBgOff;
uniform float uGain, uContrast, uTouch;
vec3 smoothSkin(vec3 c) {
  vec3 sum = c; float wsum = 1.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec3 n = texture2D(uFrame, uv + vec2(cos(a), sin(a)) * uTexel * 3.0).rgb;
    float w = exp(-dot(n - c, n - c) * 60.0);
    sum += n * w; wsum += w;
  }
  vec3 s = sum / wsum;
  // skin tones only (YCbCr), so eyes, hair and edges stay sharp
  float cb = -0.169 * c.r - 0.331 * c.g + 0.5 * c.b, cr = 0.5 * c.r - 0.419 * c.g - 0.081 * c.b;
  float skin = step(-0.15, cb) * step(cb, 0.02) * step(0.02, cr) * step(cr, 0.2);
  return mix(c, s, uTouch * 0.65 * skin);
}
void main() {
  vec3 c = texture2D(uFrame, uv).rgb;
  if (uTouch > 0.0) c = smoothSkin(c);
  c = clamp((c * uGain - 0.5) * uContrast + 0.5, 0.0, 1.0);
  if (uMode == 0) { gl_FragColor = vec4(c, 1.0); return; }
  float m = texture2D(uMask, uv).r;
  m = smoothstep(0.35, 0.75, m);
  vec3 bg;
  if (uMode == 1) {
    bg = vec3(0.0);
    for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) bg += texture2D(uBg, uv + vec2(float(i), float(j)) * 0.012).rgb;
    bg /= 25.0;
  } else bg = texture2D(uBg, uv * uBgScale + uBgOff).rgb;
  gl_FragColor = vec4(mix(bg, c, m), 1.0);
}`;

function gl1(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false });
  if (!gl) throw Object.assign(new Error("This browser cannot draw effects (no WebGL)."), { kind: "nogl" });
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const T = { frame: tex(0), mask: tex(1), bg: tex(2) };
  const U = (n) => gl.getUniformLocation(pr, n);
  gl.uniform1i(U("uFrame"), 0); gl.uniform1i(U("uMask"), 1); gl.uniform1i(U("uBg"), 2);
  return { gl, T, U };
}

// ---------------------------------------------------------------- the pipeline
// const fx = await makeEffects(cameraStream, choice); fx.track (what to send); await fx.set(choice); fx.stop()
export async function makeEffects(camera, choice, onNote) {
  let c = effectsClean(choice), running = true, raf = 0, segmenter = null, bgImg = null, lastSeg = 0, gain = 1, contrast = 1, frames = 0;
  const camTrack = camera.getVideoTracks()[0];
  const st = camTrack ? camTrack.getSettings() : {};
  const light = lightDevice();
  const W = Math.min(st.width || 640, light ? 640 : 960), H = Math.round(W * ((st.height || 360) / (st.width || 640)));
  const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = new MediaStream(camTrack ? [camTrack] : []);
  await video.play().catch(() => {});
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const small = document.createElement("canvas"); small.width = 64; small.height = 36; const sctx = small.getContext("2d", { willReadFrequently: true });
  const { gl, T, U } = gl1(canvas);
  gl.viewport(0, 0, W, H);
  const out = canvas.captureStream(light ? 15 : 24).getVideoTracks()[0];
  let maskBuf = null;
  const needsSeg = () => c.bg !== "none";
  async function prepare() {
    if (needsSeg() && !segmenter) {
      try { segmenter = await loadSegmenter(); }
      catch (e) { onNote && onNote(e.message); c = Object.assign({}, c, { bg: "none" }); }
    }
    if (c.bg === "image" && c.image) {
      bgImg = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = c.image; });
      if (bgImg) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.bg); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bgImg); }
    } else bgImg = null;
  }
  function frame() {
    if (!running) return;
    raf = (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));
    if (video.readyState < 2) return;
    frames++;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.frame); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    const mode = c.bg === "blur" && segmenter ? 1 : c.bg === "image" && segmenter && bgImg ? 2 : 0;
    // the lighting fix: the frame's average brightness every half second, eased towards a middle grey
    if (c.light || mode === 1) { sctx.drawImage(video, 0, 0, 64, 36); }
    if (c.light && frames % 12 === 1) {
      const d = sctx.getImageData(0, 0, 64, 36).data; let sum = 0, sq = 0;
      for (let i = 0; i < d.length; i += 4) { const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; sum += y; sq += y * y; }
      const n = d.length / 4, mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      gain += (Math.max(0.85, Math.min(1.8, 0.5 / Math.max(0.05, mean))) - gain) * 0.3;
      contrast += (Math.max(1, Math.min(1.35, 0.2 / Math.max(0.05, sd))) - contrast) * 0.3;
    }
    if (!c.light) { gain = 1; contrast = 1; }
    if (mode === 1) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.bg); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, small); }
    if (mode && segmenter) {
      const now = performance.now();
      if (now - lastSeg >= (light ? 66 : 40)) {
        lastSeg = now;
        try {
          const res = segmenter.segmentForVideo(video, now);
          const m = res && res.confidenceMasks && res.confidenceMasks[0];
          if (m) {
            const f = m.getAsFloat32Array(), w = m.width, h = m.height;
            if (!maskBuf || maskBuf.length !== w * h) maskBuf = new Uint8Array(w * h);
            for (let i = 0; i < f.length; i++) maskBuf[i] = f[i] * 255;
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.mask); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, maskBuf);
            res.close && res.close();
          }
        } catch (e) { /* the next frame */ }
      }
    }
    // the image covers the frame (cut to fit, not stretched)
    let sx = 1, sy = 1, ox = 0, oy = 0;
    if (bgImg) { const ra = (bgImg.width / bgImg.height) / (W / H); if (ra > 1) { sx = 1 / ra; ox = (1 - sx) / 2; } else { sy = ra; oy = (1 - sy) / 2; } }
    gl.uniform1i(U("uMode"), mode); gl.uniform2f(U("uTexel"), 1 / W, 1 / H); gl.uniform2f(U("uBgScale"), sx, sy); gl.uniform2f(U("uBgOff"), ox, oy);
    gl.uniform1f(U("uGain"), gain); gl.uniform1f(U("uContrast"), contrast); gl.uniform1f(U("uTouch"), c.touch);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  await prepare();
  frame();
  return {
    track: out,
    canvas,
    get choice() { return c; },
    get segmenting() { return !!segmenter && c.bg !== "none"; },
    async set(next) { c = effectsClean(next); await prepare(); },
    stop() { running = false; try { video.cancelVideoFrameCallback ? video.cancelVideoFrameCallback(raf) : cancelAnimationFrame(raf); } catch (e) { /* */ } out.stop(); video.srcObject = null; },
  };
}
export const effectsOn = (c) => { const x = effectsClean(c); return x.bg !== "none" || x.light || x.touch > 0; };
// the person's own image: made small (at most 960 px wide, JPEG) so it can be remembered
export function shrinkImage(file) {
  return new Promise((ok, no) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const w = Math.min(960, im.width), h = Math.round(w * im.height / im.width), cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(im, 0, 0, w, h); URL.revokeObjectURL(u); ok(cv.toDataURL("image/jpeg", 0.8)); };
    im.onerror = () => { URL.revokeObjectURL(u); no(new Error("That file is not a picture.")); };
    im.src = u;
  });
}
