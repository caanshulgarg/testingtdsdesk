// The picture's effects, all in this browser (nothing goes to a server): background blur, a background image (FinCom's
// own or the person's), a lighting fix (automatic brightness and contrast) and a light touch-up (mild skin smoothing).
// All off by default; the choice is remembered for the person on this device. Off means the camera goes out untouched
// (no canvas, no cost).
// The person is told apart from the background by MediaPipe's selfie segmenter (Apache-2.0), served from this site
// (assets/mediapipe/, see its LICENSE.txt) and loaded only when blur or an image is turned on; each file's sha256 is checked
// before it is used.
// next-calls-complete (25-Oct-2026; the owner: "touch-up and background is not working properly"), measured with
// tests/run_call_effects.py on a portrait through Chromium's fake camera: blur gave 1.1 frames a second, the touch-up 8.5,
// because (1) MediaPipe ran on the page's own thread with its GPU delegate, 870 ms a frame where WebGL is drawn in
// software (a computer whose graphics Chrome does not trust, Remote Desktop, a cloud PC: SwiftShader), and every frame
// waited for it; (2) a device with 4 cores was held to 15 frames a second; (3) the blur and the touch-up read 25 and 8
// pixels around every pixel of the full picture. Now:
//   - the segmenter runs in its own worker (CPU, XNNPACK; the main thread never waits for it) on a small copy of the
//     frame (256 x 144); the picture is drawn on every camera frame with the latest outline. Without workers (an old
//     Safari) it runs here, on the small copy, at most 8 times a second
//   - the outline: eased from one result to the next (a moving edge follows at once, a still one stops shimmering), its
//     edge snapped to the picture's own edges (a joint bilateral pass at half size)
//   - the blur from a small copy, the person's own colours kept out of it (no halo), two passes; the touch-up an
//     edge-keeping smoothing at half size, on skin tones only, soft at the edges of the range (no blotches)
//   - the first frame sent is the camera's drawn (never a black one); while the page is hidden a worker's clock keeps
//     the picture going (the browser stops drawing a hidden page's frames)
//   - a canvas whose frames come out black (seen with a WebGL canvas on some Safari versions) is caught in the first
//     seconds: the camera is sent untouched instead, with a note (opts.onFail)
//   - effectsSupport(): what this browser can do, so the screen offers only that (iPhone Safari before 16.4: no
//     background, a short note; no canvas capture or WebGL: no effects at all, the camera as it is)
// Textures are read with t = 0 at the top of the picture throughout (no flip on upload); only the last pass, onto the
// canvas, turns it the right way up.
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
const abs = (name) => new URL(assets() + "mediapipe/" + name, location.href).href;
const SEG_W = 256, SEG_H = 144;

// ---------------------------------------------------------------- remembered per person
const key = (who) => "fincom.call-fx:" + (who || "guest");
export function loadChoice(who) { try { return effectsClean(JSON.parse(localStorage.getItem(key(who)) || "null")); } catch (e) { return Object.assign({}, EFFECTS_OFF); } }
export function saveChoice(who, c) { try { localStorage.setItem(key(who), JSON.stringify(effectsClean(c))); } catch (e) { /* the choice lasts this call only */ } }
const isIos = (ua, nav) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav && nav.maxTouchPoints) > 1);
const isWebKit = (ua) => /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua);
export const lightDevice = () => weakDevice(navigator) || isIos(navigator.userAgent || "", navigator);

// WebAssembly SIMD (every Chrome since 91, Safari since 16.4): the only build kept
export function simdOk() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
}
// what this browser can do: {bg (blur and images), look (lighting and touch-up), light (a light device: blur suggested),
// note (said on the panel when something is not offered)}. env: for the tests (userAgent, simd, webgl, capture)
export function effectsSupport(env) {
  const e = env || {};
  const given = e.userAgent != null;
  const ua = String(given ? e.userAgent : (typeof navigator === "object" && navigator.userAgent) || "");
  let webgl = e.webgl, capture = e.capture;
  if (webgl == null) { try { const c = document.createElement("canvas"); webgl = !!(c.getContext("webgl") || c.getContext("experimental-webgl")); } catch (x) { webgl = false; } }
  if (capture == null) capture = typeof HTMLCanvasElement === "function" && typeof HTMLCanvasElement.prototype.captureStream === "function";
  const simd = e.simd != null ? e.simd : simdOk();
  const ios = isIos(ua, given ? null : (typeof navigator === "object" ? navigator : null));
  const light = ios || (given ? false : lightDevice());
  if (!webgl || !capture) return { bg: false, look: false, light, note: "Background and touch-up are not available in this browser; your camera is sent as it is." };
  if (!simd) return { bg: false, look: true, light, note: ios ? "Background blur and images need iOS 16.4 or later (Settings › General › Software Update). The lighting fix and touch-up work here." : "Background blur and images need a newer browser (Chrome 91, Edge 91 or Safari 16.4 and later). The lighting fix and touch-up work here." };
  return { bg: true, look: true, light, note: ios ? "On an iPhone or iPad, blur uses less battery than an image." : "" };
}

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
let filesP = null;
function loadFiles() {
  if (filesP) return filesP;
  filesP = (async () => {
    if (!simdOk()) throw Object.assign(new Error("Background effects need a newer browser (Chrome 91 or Safari 16.4 and later)."), { kind: "old" });
    const [, , wasm, model] = await Promise.all(Object.values(MP_FILES).map(([n, s]) => fetchChecked(n, s)));
    return { wasm, model };
  })();
  filesP.catch(() => { filesP = null; });
  return filesP;
}
const SEG_OPTS = { runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true };
// the segmenter on this thread (no workers here): created once
let localP = null;
function localSegmenter() {
  if (localP) return localP;
  localP = (async () => {
    const { wasm, model } = await loadFiles();
    const mp = await import(/* @vite-ignore */ abs(MP_FILES.bundle[0]));
    const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    return await mp.ImageSegmenter.createFromOptions({ wasmLoaderPath: abs(MP_FILES.loader[0]), wasmBinaryPath: wasmUrl },
      Object.assign({ baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: "CPU" } }, SEG_OPTS));
  })();
  localP.catch(() => { localP = null; });
  return localP;
}
export const loadSegmenter = localSegmenter;

// the worker: MediaPipe loaded there (a classic worker: its loader is a classic script, the bundle a module), one small
// frame in, its outline (0-255) out; and a clock for a hidden page
const WORKER = `"use strict";
let seg = null, clock = 0;
const OPTS = ${JSON.stringify(SEG_OPTS)};
// one small frame (RGBA) -> its outline; the answer to whoever asked (this worker's page, or the frame worker's port)
function onFrame(m, reply) {
  const t0 = performance.now();
  try {
    const r = seg.segmentForVideo(new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h), m.ts);
    const k = r.confidenceMasks && r.confidenceMasks[0];
    if (!k) { r.close && r.close(); reply({ type: "mask", none: true, id: m.id }); return; }
    const f = k.getAsFloat32Array(), out = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = f[i] * 255;
    const w = k.width, h = k.height;
    r.close && r.close();
    reply({ type: "mask", w, h, data: out, ms: performance.now() - t0, id: m.id }, [out.buffer]);
  } catch (err) { reply({ type: "mask", none: true, id: m.id, message: String((err && err.message) || err) }); }
}
self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === "init") {
    try {
      const mp = await import(m.bundle);
      const wasmUrl = URL.createObjectURL(new Blob([m.wasm], { type: "application/wasm" }));
      seg = await mp.ImageSegmenter.createFromOptions({ wasmLoaderPath: m.loader, wasmBinaryPath: wasmUrl }, Object.assign({ baseOptions: { modelAssetBuffer: new Uint8Array(m.model), delegate: "CPU" } }, OPTS));
      self.postMessage({ type: "ready" });
    } catch (err) { self.postMessage({ type: "error", message: String((err && err.message) || err) }); }
  } else if (m.type === "port") {
    const p = m.port;
    p.onmessage = (ev) => { if (seg && ev.data && ev.data.type === "frame") onFrame(ev.data, (x, t) => p.postMessage(x, t || [])); };
  } else if (m.type === "frame") {
    onFrame(m, (x, t) => self.postMessage(x, t || []));
  } else if (m.type === "clock") {
    clearInterval(clock); clock = 0;
    if (m.ms) clock = setInterval(() => self.postMessage({ type: "tick" }), m.ms);
  }
};`;
function makeWorker(src) {
  if (typeof Worker !== "function" || typeof Blob !== "function" || typeof ImageData !== "function") return null;
  try { const u = URL.createObjectURL(new Blob([src || WORKER], { type: "text/javascript" })); const w = new Worker(u); setTimeout(() => URL.revokeObjectURL(u), 10000); return w; } catch (e) { return null; }
}
// one worker's segmenter: ready() once; seg(imageData, ts) -> {w, h, data} or null
function workerSegmenter(worker) {
  let readyP = null, wait = null;
  const pending = [];
  worker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "ready" || m.type === "error") { const w = wait; wait = null; if (w) (m.type === "ready" ? w.ok() : w.no(new Error(m.message || "The background could not start."))); }
    if (m.type === "mask") { const p = pending.shift(); if (p) p(m.none ? null : m); }
  });
  worker.addEventListener("error", () => { const w = wait; wait = null; if (w) w.no(new Error("The background could not start here.")); while (pending.length) pending.shift()(null); });
  return {
    ready() {
      if (readyP) return readyP;
      readyP = (async () => {
        const { wasm, model } = await loadFiles();
        await new Promise((ok, no) => {
          wait = { ok, no };
          const w = wasm.slice(0), md = model.slice(0);
          worker.postMessage({ type: "init", bundle: abs(MP_FILES.bundle[0]), loader: abs(MP_FILES.loader[0]), wasm: w, model: md }, [w, md]);
          setTimeout(() => { if (wait) { wait = null; no(new Error("The background took too long to start.")); } }, 30000);
        });
      })();
      return readyP;
    },
    seg(img, ts) { return new Promise((ok) => { pending.push(ok); const buf = img.data.buffer; worker.postMessage({ type: "frame", buf, w: img.width, h: img.height, ts }, [buf]); }); },
  };
}

// ---------------------------------------------------------------- the WebGL passes
// into a texture (t = 0 the picture's top, as uploaded); onto the canvas (turned the right way up)
const VS_RT = "attribute vec2 p; varying vec2 uv; void main(){ uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
const HEAD = "precision mediump float;\nvarying vec2 uv;\n";
// the outline snapped to the picture's edges: the outline's 3 x 3 around, each weighted by how alike its colour is
const FS_MASK = HEAD + `uniform sampler2D uFrame, uMask; uniform vec2 uStep;
void main() {
  vec3 c = texture2D(uFrame, uv).rgb; float s = 0.0, ws = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    vec2 o = vec2(float(i), float(j)) * uStep;
    vec3 n = texture2D(uFrame, uv + o).rgb; float w = exp(-dot(n - c, n - c) * 24.0) * ((i == 0 && j == 0) ? 2.0 : 1.0);
    s += texture2D(uMask, uv + o).r * w; ws += w;
  }
  gl_FragColor = vec4(vec3(s / ws), 1.0);
}`;
// the background blurred from a small copy, the person's own colours left out (weighted by 1 - outline)
const FS_BLUR = HEAD + `uniform sampler2D uSrc, uMask; uniform vec2 uStep;
void main() {
  vec4 s = vec4(0.0);
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    vec2 o = vec2(float(i), float(j)) * uStep;
    float w = (3.0 - abs(float(i))) * (3.0 - abs(float(j))) * ((1.0 - smoothstep(0.2, 0.6, texture2D(uMask, uv + o).r)) + 0.02);
    s += vec4(texture2D(uSrc, uv + o).rgb * w, w);
  }
  gl_FragColor = vec4(s.rgb / s.a, 1.0);
}`;
// the touch-up's smoothing, at half size: eight neighbours on two rings, alike colours only (edges kept)
const FS_SMOOTH = HEAD + `uniform sampler2D uFrame; uniform vec2 uStep;
void main() {
  vec3 c = texture2D(uFrame, uv).rgb; vec3 s = c; float ws = 1.0;
  for (int i = 0; i < 8; i++) {
    float r = i < 4 ? 1.5 : 3.0; float a = float(i) * 1.570796 + (i < 4 ? 0.0 : 0.785398);
    vec3 n = texture2D(uFrame, uv + vec2(cos(a), sin(a)) * uStep * r).rgb;
    float w = exp(-dot(n - c, n - c) * 90.0); s += n * w; ws += w;
  }
  gl_FragColor = vec4(s / ws, 1.0);
}`;
const FS_FINAL = HEAD + `uniform sampler2D uFrame, uMask, uBg, uSmooth;
uniform int uMode;            // 0 none, 1 blur, 2 image
uniform float uGain, uContrast, uTouch, uBlack;
void main() {
  vec3 c = texture2D(uFrame, uv).rgb;
  float m = uMode > 0 ? smoothstep(0.3, 0.72, texture2D(uMask, uv).r) : 1.0;
  if (uTouch > 0.0) {
    // skin tones (YCbCr), soft at the edges of the range, so eyes, hair, lips and the outline stay sharp
    float cb = -0.169 * c.r - 0.331 * c.g + 0.5 * c.b, cr = 0.5 * c.r - 0.419 * c.g - 0.081 * c.b;
    float skin = smoothstep(-0.19, -0.13, cb) * (1.0 - smoothstep(0.0, 0.05, cb)) * smoothstep(0.0, 0.035, cr) * (1.0 - smoothstep(0.17, 0.23, cr));
    float k = uTouch * 0.75 * skin * m;
    c = mix(c, texture2D(uSmooth, uv).rgb, k) + vec3(0.035, 0.025, 0.02) * k;   // smoother, and a little light on the face
  }
  c = clamp((c * uGain - 0.5) * uContrast + 0.5, 0.0, 1.0);
  if (uMode > 0) c = mix(texture2D(uBg, uv).rgb, c, m);
  gl_FragColor = vec4(c * (1.0 - uBlack), 1.0);
}`;

function glKit(canvas, preserve) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: !!preserve, antialias: false, alpha: false });
  if (!gl) throw Object.assign(new Error("This browser cannot draw effects (no WebGL)."), { kind: "nogl" });
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const program = (vs, fs, samplers) => {
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const loc = gl.getAttribLocation(pr, "p"), U = {};
    const P = { U: (n) => (n in U ? U[n] : (U[n] = gl.getUniformLocation(pr, n))), use() { gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); } };
    P.use(); samplers.forEach((s, i) => gl.uniform1i(P.U(s), i));
    return P;
  };
  const texture = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  // a texture to draw into (w x h)
  const target = (w, h) => { const t = texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, fb, w, h }; };
  const bind = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  // a pass: its program in use, its uniforms set by the caller (set), drawn into a texture or onto the canvas
  const pass = (P, into, W, H, set) => { P.use(); if (set) set(P.U); gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null); gl.viewport(0, 0, into ? into.w : W, into ? into.h : H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  return { gl, program, texture, target, bind, pass };
}

// ---------------------------------------------------------------- the frame worker (Chrome, Edge: MediaStreamTrackProcessor)
// The camera's frames read in a worker (MediaStreamTrackProcessor), worked on as their own planes (I420: the brightness
// at full size, the colour at half) and written to a new track (MediaStreamTrackGenerator): no canvas, no WebGL, the
// page's own thread not used per frame. The outline comes from the segmenter's worker through a MessagePort.
// A canvas carrying the picture cost more than the effects: a plain copy of the camera onto a canvas gave 23 frames a
// second where WebGL is drawn in software, 12 with the processor four times slower; frames through a worker kept 29.6.
const FRAME_WORKER = `"use strict";
const SW = ${SEG_W}, SH = ${SEG_H};
let cfg = { bg: "none", touch: 0, light: false }, light = false, black = false, port = null, segBusy = false, segAt = 0, running = true, reader = null, writer = null;
let W = 0, H = 0, CW = 0, CH = 0, Y = null, U = null, V = null, OUT = null, buf = null, cs = null;
let A = null, AC = null, M = null, MW = 0, MH = 0, sentGuide = null, maskTold = false;
let irgba = null, iw = 0, ih = 0, IY = null, IU = null, IV = null, iFor = "";
let SBW = 0, SBH = 0, sY, sWy, sU, sV, sWc, tmpA, colS, colF, rowS, rowF, ccolS, ccolF, crowS, crowF, mapX, mapY, mapCX, mapCY;
let recent = 0, toldSlow = false, bgFresh = false, smFresh = false;
let hY = null, hT = null, BY = null, BU = null, BV = null, KT = null, tRead = 0, tBg = 0, tMain = 0;
const lut = new Uint8Array(256); let gain = 1, contrast = 1, frames = 0, ms = 0, firstSent = false, errors = 0;
for (let i = 0; i < 256; i++) lut[i] = i;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SKIN = new Uint8Array(65536);
for (let u = 0; u < 256; u++) for (let v = 0; v < 256; v++) { const cb = (u - 128) / 255, cr = (v - 128) / 255; SKIN[u * 256 + v] = Math.round(255 * ss(-0.19, -0.13, cb) * (1 - ss(0, 0.05, cb)) * ss(0, 0.035, cr) * (1 - ss(0.17, 0.23, cr))); }
const STEP = new Uint8Array(256); for (let i = 0; i < 256; i++) STEP[i] = Math.round(255 * ss(0.36, 0.78, i / 255));
const SIM = new Float32Array(256); for (let i = 0; i < 256; i++) SIM[i] = Math.exp(-(i * i) / (2 * 14 * 14));
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
// bilinear maps from a small grid (n cells) to a size (d pixels)
function maps(n, d) { const s = new Int32Array(d), f = new Uint16Array(d); for (let x = 0; x < d; x++) { let fx = (x + 0.5) * n / d - 0.5; if (fx < 0) fx = 0; let x0 = Math.floor(fx); if (x0 > n - 2) x0 = Math.max(0, n - 2); s[x] = x0; f[x] = Math.min(256, Math.round((fx - x0) * 256)); } return [s, f]; }
function alloc(w, h) {
  W = w; H = h; CW = (w + 1) >> 1; CH = (h + 1) >> 1;
  Y = new Uint8Array(W * H); U = new Uint8Array(CW * CH); V = new Uint8Array(CW * CH); OUT = new Uint8Array(W * H + 2 * CW * CH);
  SBW = Math.max(2, Math.round(W / 8)); SBH = Math.max(2, Math.round(H / 8));
  const n = SBW * SBH; sY = new Float32Array(n); sWy = new Float32Array(n); sU = new Float32Array(n); sV = new Float32Array(n); sWc = new Float32Array(n); tmpA = new Float32Array(n);
  [colS, colF] = maps(SBW, W); [rowS, rowF] = maps(SBH, H); [ccolS, ccolF] = maps(SBW, CW); [crowS, crowF] = maps(SBH, CH);
  mapX = new Int32Array(W); for (let x = 0; x < W; x++) mapX[x] = Math.min(SBW - 1, (x * SBW / W) | 0);
  mapY = new Int32Array(H); for (let y = 0; y < H; y++) mapY[y] = Math.min(SBH - 1, (y * SBH / H) | 0);
  mapCX = new Int32Array(CW); for (let x = 0; x < CW; x++) mapCX[x] = Math.min(SBW - 1, (x * SBW / CW) | 0);
  mapCY = new Int32Array(CH); for (let y = 0; y < CH; y++) mapCY[y] = Math.min(SBH - 1, (y * SBH / CH) | 0);
  hY = new Uint8Array(CW * CH); hT = new Uint16Array(CW * CH); BY = new Uint8Array(CW * CH); BU = new Uint8Array(CW * CH); BV = new Uint8Array(CW * CH); KT = new Uint8Array(CW * CH);
  A = null; AC = null; iFor = ""; maskTold = false; bgFresh = false; smFresh = false;
}
function rgbToPlanes(src, stride, bgr, w, h, oy, ou, ov) {
  const ri = bgr ? 2 : 0, bi = bgr ? 0 : 2, cw = (w + 1) >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * stride + x * 4, r = src[p + ri], g = src[p + 1], b = src[p + bi];
    oy[y * w + x] = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
    if (!(x & 1) && !(y & 1)) { const c = (y >> 1) * cw + (x >> 1); ou[c] = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128; ov[c] = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128; }
  }
}
async function readFrame(f) {
  const vr = f.visibleRect || { width: f.displayWidth, height: f.displayHeight };
  const w = vr.width, h = vr.height;
  if (w !== W || h !== H) alloc(w, h);
  const fmt = f.format;
  if (fmt === "I420" || fmt === "I420A" || fmt === "NV12") {
    const size = f.allocationSize(); if (!buf || buf.length < size) buf = new Uint8Array(size);
    const lay = await f.copyTo(buf);
    const p0 = lay[0], p1 = lay[1];
    for (let y = 0; y < H; y++) Y.set(buf.subarray(p0.offset + y * p0.stride, p0.offset + y * p0.stride + W), y * W);
    if (fmt === "NV12") { for (let y = 0; y < CH; y++) { const o = p1.offset + y * p1.stride, r = y * CW; for (let x = 0; x < CW; x++) { U[r + x] = buf[o + 2 * x]; V[r + x] = buf[o + 2 * x + 1]; } } }
    else { const p2 = lay[2]; for (let y = 0; y < CH; y++) { U.set(buf.subarray(p1.offset + y * p1.stride, p1.offset + y * p1.stride + CW), y * CW); V.set(buf.subarray(p2.offset + y * p2.stride, p2.offset + y * p2.stride + CW), y * CW); } }
    cs = f.colorSpace && f.colorSpace.toJSON ? f.colorSpace.toJSON() : null;
    return;
  }
  let bgr = false, stride = w * 4, src = null;
  if (fmt && /^(RGBA|RGBX|BGRA|BGRX)$/.test(fmt)) { const size = f.allocationSize(); if (!buf || buf.length < size) buf = new Uint8Array(size); const lay = await f.copyTo(buf); stride = lay[0].stride; src = buf.subarray(lay[0].offset); bgr = fmt[0] === "B"; }
  else {
    const oc = new OffscreenCanvas(w, h), x = oc.getContext("2d", { willReadFrequently: true }); x.drawImage(f, 0, 0, w, h); src = x.getImageData(0, 0, w, h).data;
  }
  rgbToPlanes(src, stride, bgr, W, H, Y, U, V);
  cs = { primaries: "smpte170m", transfer: "smpte170m", matrix: "smpte170m", fullRange: false };
}
// the small copy for the segmenter (RGBA) and its brightness (the guide that snaps the outline to the picture's edges)
function smallCopy() {
  const out = new Uint8Array(SW * SH * 4), g = new Uint8Array(SW * SH);
  for (let y = 0; y < SH; y++) { const yy = Math.min(H - 1, (y * H / SH) | 0), cy = yy >> 1;
    for (let x = 0; x < SW; x++) { const xx = Math.min(W - 1, (x * W / SW) | 0), cx = xx >> 1, i = y * SW + x;
      const yv = Y[yy * W + xx], u = U[cy * CW + cx] - 128, v = V[cy * CW + cx] - 128, c = (yv - 16) * 1.164;
      out[4 * i] = clamp(c + 1.596 * v); out[4 * i + 1] = clamp(c - 0.392 * u - 0.813 * v); out[4 * i + 2] = clamp(c + 2.017 * u); out[4 * i + 3] = 255; g[i] = yv; } }
  return { out, g };
}
function upscale(src, sw, sh, dw, dh, dst) {
  if (!dst || dst.length !== dw * dh) dst = new Uint8Array(dw * dh);
  const [xs, xf] = maps(sw, dw), [ys, yf] = maps(sh, dh);
  for (let y = 0; y < dh; y++) { const r0 = ys[y] * sw, r1 = Math.min(ys[y] + 1, sh - 1) * sw, fy = yf[y], o = y * dw;
    for (let x = 0; x < dw; x++) { const x0 = xs[x], x1 = Math.min(x0 + 1, sw - 1), fx = xf[x];
      const t = src[r0 + x0] * (256 - fx) + src[r0 + x1] * fx, b = src[r1 + x0] * (256 - fx) + src[r1 + x1] * fx;
      dst[o + x] = (t * (256 - fy) + b * fy) >> 16; } }
  return dst;
}
function takeMask(m) {
  const n = m.w * m.h, d = m.data, g = sentGuide;
  if (!M || M.length !== n) { M = new Uint8Array(d); MW = m.w; MH = m.h; }
  else for (let i = 0; i < n; i++) { const a = M[i], b = d[i], df = b > a ? b - a : a - b; M[i] = df > 90 ? b : a * 0.45 + b * 0.55; }
  const R = new Uint8Array(n);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * MW + x, c = g && g.length === n ? g[i] : 0; let s = 0, ws = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy < 0 ? 0 : y + dy >= MH ? MH - 1 : y + dy;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx < 0 ? 0 : x + dx >= MW ? MW - 1 : x + dx, j = yy * MW + xx;
        const dd = g && g.length === n ? (g[j] > c ? g[j] - c : c - g[j]) : 0, w = SIM[dd] * (dx === 0 && dy === 0 ? 2 : 1); s += M[j] * w; ws += w; } }
    R[i] = STEP[(s / ws) | 0];
  }
  A = upscale(R, MW, MH, W, H, A); AC = upscale(R, MW, MH, CW, CH, AC);
  if (!maskTold) { maskTold = true; self.postMessage({ type: "mask" }); }
}
function blurBox(arr, w, h) {
  // a box of 5 across then down, twice, as running sums (values and weights blurred alike: the person stays out)
  const t = tmpA, L = w - 1, B = h - 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { const r = y * w; let s = arr[r] * 3 + arr[r + Math.min(1, L)] + arr[r + Math.min(2, L)];
      for (let x = 0; x < w; x++) { t[r + x] = s; s += arr[r + (x + 3 > L ? L : x + 3)] - arr[r + (x - 2 < 0 ? 0 : x - 2)]; } }
    for (let x = 0; x < w; x++) { let s = t[x] * 3 + t[Math.min(1, B) * w + x] + t[Math.min(2, B) * w + x];
      for (let y = 0; y < h; y++) { arr[y * w + x] = s; s += t[(y + 3 > B ? B : y + 3) * w + x] - t[(y - 2 < 0 ? 0 : y - 2) * w + x]; } }
  }
}
function background() {
  // the frame made small (an eighth; every other pixel read), each pixel weighted by how much it is background, blurred,
  // then brought to the colour planes' size (half): the blurred background needs no more
  const n = SBW * SBH;
  sY.fill(0); sWy.fill(0); sU.fill(0); sV.fill(0); sWc.fill(0);
  for (let y = 0; y < H; y += 2) { const r = y * W, sr = mapY[y] * SBW; for (let x = 0; x < W; x += 2) { const i = r + x, w = 256 - A[i], k = sr + mapX[x]; sY[k] += Y[i] * w; sWy[k] += w; } }
  for (let y = 0; y < CH; y += 2) { const r = y * CW, sr = mapCY[y] * SBW; for (let x = 0; x < CW; x += 2) { const i = r + x, w = 256 - AC[i], k = sr + mapCX[x]; sU[k] += U[i] * w; sV[k] += V[i] * w; sWc[k] += w; } }
  blurBox(sY, SBW, SBH); blurBox(sWy, SBW, SBH); blurBox(sU, SBW, SBH); blurBox(sV, SBW, SBH); blurBox(sWc, SBW, SBH);
  for (let k = 0; k < n; k++) { sY[k] /= sWy[k] || 1; sU[k] /= sWc[k] || 1; sV[k] /= sWc[k] || 1; }
  for (let y = 0; y < CH; y++) {
    const r = y * CW, r0 = crowS[y] * SBW, r1 = Math.min(crowS[y] + 1, SBH - 1) * SBW, fy = crowF[y];
    for (let x = 0; x < CW; x++) {
      const x0 = ccolS[x], x1 = Math.min(x0 + 1, SBW - 1), fx = ccolF[x], w00 = (256 - fx) * (256 - fy), w01 = fx * (256 - fy), w10 = (256 - fx) * fy, w11 = fx * fy, i = r + x;
      BY[i] = (sY[r0 + x0] * w00 + sY[r0 + x1] * w01 + sY[r1 + x0] * w10 + sY[r1 + x1] * w11) / 65536;
      BU[i] = (sU[r0 + x0] * w00 + sU[r0 + x1] * w01 + sU[r1 + x0] * w10 + sU[r1 + x1] * w11) / 65536;
      BV[i] = (sV[r0 + x0] * w00 + sV[r0 + x1] * w01 + sV[r1 + x0] * w10 + sV[r1 + x1] * w11) / 65536;
    }
  }
}
function imagePlanes() {
  const key = W + "x" + H;
  if (!irgba || iFor === key) return;
  const tmp = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) { const sy = Math.min(ih - 1, (y * ih / H) | 0); for (let x = 0; x < W; x++) { const sx = Math.min(iw - 1, (x * iw / W) | 0), s = (sy * iw + sx) * 4, d = (y * W + x) * 4; tmp[d] = irgba[s]; tmp[d + 1] = irgba[s + 1]; tmp[d + 2] = irgba[s + 2]; } }
  IY = new Uint8Array(W * H); IU = new Uint8Array(CW * CH); IV = new Uint8Array(CW * CH);
  rgbToPlanes(tmp, W * 4, false, W, H, IY, IU, IV); iFor = key;
}
function smoothLuma() {
  // the brightness at half size, then a box of 5 x 5 there (about 10 x 10 of the picture), as running sums
  for (let y = 0; y < CH; y++) { const y0 = Math.min(H - 1, 2 * y) * W, y1 = Math.min(H - 1, 2 * y + 1) * W;
    for (let x = 0; x < CW; x++) { const x0 = Math.min(W - 1, 2 * x), x1 = Math.min(W - 1, 2 * x + 1); hY[y * CW + x] = (Y[y0 + x0] + Y[y0 + x1] + Y[y1 + x0] + Y[y1 + x1] + 2) >> 2; } }
  const L = CW - 1, B = CH - 1;
  for (let y = 0; y < CH; y++) { const r = y * CW; let s = hY[r] * 3 + hY[r + Math.min(1, L)] + hY[r + Math.min(2, L)];
    for (let x = 0; x < CW; x++) { hT[r + x] = s; s += hY[r + (x + 3 > L ? L : x + 3)] - hY[r + (x - 2 < 0 ? 0 : x - 2)]; } }
  for (let x = 0; x < CW; x++) { let s = hT[x] * 3 + hT[Math.min(1, B) * CW + x] + hT[Math.min(2, B) * CW + x];
    for (let y = 0; y < CH; y++) { hY[y * CW + x] = (s * 2621 + 32768) >> 16; s += hT[(y + 3 > B ? B : y + 3) * CW + x] - hT[(y - 2 < 0 ? 0 : y - 2) * CW + x]; } }
}
function lighting() {
  if (cfg.light && frames % 12 === 0) {
    let sum = 0, sq = 0, n = 0;
    for (let i = 0; i < Y.length; i += 29) { const y = (Y[i] - 16) / 219; sum += y; sq += y * y; n++; }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    gain += (Math.max(0.85, Math.min(1.8, 0.5 / Math.max(0.05, mean))) - gain) * 0.3;
    contrast += (Math.max(1, Math.min(1.35, 0.2 / Math.max(0.05, sd))) - contrast) * 0.3;
    for (let i = 0; i < 256; i++) { const y = (i - 16) / 219, v = ((y * gain - 0.5) * contrast + 0.5) * 219 + 16; lut[i] = clamp(Math.round(v)); }
  } else if (!cfg.light && (gain !== 1 || contrast !== 1)) { gain = 1; contrast = 1; for (let i = 0; i < 256; i++) lut[i] = i; }
}
function process() {
  lighting();
  const seg = cfg.bg !== "none" && A && A.length === W * H;
  const mode = seg ? (cfg.bg === "blur" ? 1 : irgba ? 2 : 0) : 0;
  const t0 = performance.now();
  // a slow computer: the blurred background and the touch-up's smoothing made every other frame (both change slowly)
  const reuse = recent > 30 && (frames & 1) === 1;
  if (mode === 1 && !(reuse && bgFresh)) { background(); bgFresh = true; }
  if (mode === 2) imagePlanes();
  // the touch-up's strength for each colour pixel: skin tones only, and (with a background) on the person only
  const touch = Math.round(Math.max(0, Math.min(1, cfg.touch)) * 0.86 * 256);
  if (touch) { if (!(reuse && smFresh)) { smoothLuma(); smFresh = true; } for (let i = 0; i < CW * CH; i++) { let k = (SKIN[(U[i] << 8) | V[i]] * touch) >> 8; if (mode) k = (k * AC[i]) >> 8; KT[i] = k; } }
  const t1 = performance.now(); tBg += t1 - t0;
  const lit = cfg.light, PY = mode === 1 ? BY : IY, half = mode === 1;
  for (let y = 0; y < H; y++) {
    const r = y * W, cr = (y >> 1) * CW;
    for (let x = 0; x < W; x++) {
      const i = r + x; let v = Y[i];
      if (touch) {
        const ci = cr + (x >> 1), k = KT[ci];
        if (k) { const d = hY[ci] - v, ad = d < 0 ? -d : d; if (ad < 28) v += (d * k * (28 - ad)) >> 13; v += (k * 6) >> 8; if (v > 255) v = 255; else if (v < 0) v = 0; }
      }
      if (lit) v = lut[v];
      if (mode) { const a = A[i], t = (half ? PY[cr + (x >> 1)] : PY[i]) * (255 - a) + v * a; v = (t + 1 + (t >> 8)) >> 8; }
      OUT[i] = v;
    }
  }
  const ou = W * H, ov = W * H + CW * CH;
  if (!mode) { OUT.set(U, ou); OUT.set(V, ov); }
  else {
    const PU = mode === 1 ? BU : IU, PV = mode === 1 ? BV : IV;
    for (let i = 0; i < CW * CH; i++) { const a = AC[i], b = 255 - a, tu = PU[i] * b + U[i] * a, tv = PV[i] * b + V[i] * a; OUT[ou + i] = (tu + 1 + (tu >> 8)) >> 8; OUT[ov + i] = (tv + 1 + (tv >> 8)) >> 8; }
  }
  if (black) { OUT.fill(0, 0, W * H); OUT.fill(128, W * H); }
  tMain += performance.now() - t1;
}
function askOutline() {
  if (!port || segBusy || cfg.bg === "none" || !W) return;
  const t = performance.now(); if (t - segAt < (light ? 66 : 33)) return;
  segAt = t; segBusy = true;
  const s = smallCopy(); sentGuide = s.g;
  port.postMessage({ type: "frame", buf: s.out.buffer, w: SW, h: SH, ts: t }, [s.out.buffer]);
}
async function run() {
  for (;;) {
    let f;
    try { const r = await reader.read(); if (r.done) break; f = r.value; } catch (e) { break; }
    if (!running) { f.close(); break; }
    const t0 = performance.now();
    let o = null;
    try { await readFrame(f); tRead += performance.now() - t0; process(); o = new VideoFrame(OUT, Object.assign({ format: "I420", codedWidth: W, codedHeight: H, timestamp: f.timestamp }, f.duration ? { duration: f.duration } : {}, cs ? { colorSpace: cs } : {})); }
    catch (e) { errors++; if (errors === 1) self.postMessage({ type: "warn", message: String((e && e.message) || e) }); }
    if (o) f.close(); else o = f;
    const took = performance.now() - t0;
    ms += took; frames++; recent = recent * 0.9 + took * 0.1;
    // too slow for the camera (a slow computer): the page is asked once for a smaller picture
    if (!toldSlow && frames > 45 && recent > 42) { toldSlow = true; self.postMessage({ type: "slow", ms: recent }); }
    try { await writer.write(o); } catch (e) { try { o.close(); } catch (x) { /* */ } break; }
    if (!firstSent) { firstSent = true; self.postMessage({ type: "first", format: f.format || "" }); }
    if (frames % 30 === 0) self.postMessage({ type: "stats", frames, ms: ms / frames, read: tRead / frames, bg: tBg / frames, main: tMain / frames, size: W + "x" + H, errors });
    askOutline();
  }
  self.postMessage({ type: "ended" });
}
self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === "start") { reader = m.readable.getReader(); writer = m.writable.getWriter(); light = !!m.light; black = !!m.black; cfg = m.cfg || cfg; run(); }
  else if (m.type === "cfg") { const was = cfg.bg; cfg = m.cfg || cfg; bgFresh = false; smFresh = false; if (cfg.bg === "none" || (was !== cfg.bg && was === "none")) { A = null; AC = null; M = null; maskTold = false; } }
  else if (m.type === "smaller") { toldSlow = false; recent = 0; frames = 0; ms = 0; tRead = 0; tBg = 0; tMain = 0; }
  else if (m.type === "image") { irgba = m.buf ? new Uint8Array(m.buf) : null; iw = m.w; ih = m.h; iFor = ""; }
  else if (m.type === "seg") { port = m.port; port.onmessage = (ev) => { const x = ev.data || {}; if (x.type === "mask") { segBusy = false; if (!x.none && cfg.bg !== "none") takeMask(x); } }; }
  else if (m.type === "stop") { running = false; try { reader && reader.cancel().catch(() => {}); } catch (x) { /* */ } try { writer && writer.close().catch(() => {}); } catch (x) { /* */ } }
};`;
export const framePipeOk = () => typeof window === "object" && typeof window.MediaStreamTrackProcessor === "function" && typeof window.MediaStreamTrackGenerator === "function" && typeof window.VideoFrame === "function" && typeof Worker === "function";

// the first seconds of a picture watched: frames that come out black while the camera's are not mean this browser cannot
// send the effects' picture; fail() is told and the camera goes out untouched
function watchFirst(out, cam, fail, secs) {
  const v = (t) => { const x = document.createElement("video"); x.muted = true; x.playsInline = true; x.srcObject = new MediaStream([t]); x.play().catch(() => {}); return x; };
  const tv = v(out), cv = v(cam);
  const pc = document.createElement("canvas"); pc.width = 16; pc.height = 9; const px = pc.getContext("2d", { willReadFrequently: true });
  const lum = (src) => { px.drawImage(src, 0, 0, 16, 9); const d = px.getImageData(0, 0, 16, 9).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
  let blacks = 0;
  const t0 = performance.now();
  const end = () => { clearInterval(timer); tv.srcObject = null; cv.srcObject = null; };
  const timer = setInterval(() => {
    if (performance.now() - t0 > (secs || 5) * 1000) { end(); return; }
    if (tv.readyState < 2 || cv.readyState < 2) return;
    try { if (lum(tv) < 6 && lum(cv) > 20) blacks++; else blacks = 0; } catch (e) { end(); return; }
    if (blacks >= 6) { end(); fail("Effects make your picture black in this browser; your camera is sent as it is."); }
  }, 250);
  return end;
}

// the frame worker's pipeline: same interface as the canvas's
async function makeFrameEffects(camera, choice, onNote, o) {
  let c = effectsClean(choice), segW = null, wseg = null, haveMask = false, fellBack = false, stats = { frames: 0, ms: 0 }, endWatch = null, smaller = false;
  const camTrack = camera.getVideoTracks()[0];
  const light = lightDevice(), maxW = light ? 640 : 960;
  const st = camTrack.getSettings ? camTrack.getSettings() : {};
  const src = camTrack.clone();
  if ((st.width || 0) > maxW) { try { await src.applyConstraints({ width: { ideal: maxW }, height: { ideal: Math.round(maxW * (st.height || 720) / (st.width || 1280)) } }); } catch (e) { /* the camera's own size */ } }
  const proc = new window.MediaStreamTrackProcessor({ track: src });
  const gen = new window.MediaStreamTrackGenerator({ kind: "video" });
  const fw = makeWorker(FRAME_WORKER);
  if (!fw) { src.stop(); throw new Error("no worker"); }
  const fail = (why) => { if (fellBack) return; fellBack = true; onNote && onNote(why || "Effects could not run on this device; your camera is sent as it is."); try { o.onFail && o.onFail(why); } catch (e) { /* */ } };
  let first = null;
  const firstP = new Promise((ok) => { first = ok; });
  fw.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "first") first(true);
    if (m.type === "stats") stats = m;
    if (m.type === "mask") haveMask = true;
    if (m.type === "slow" && !smaller) {
      // a smaller picture asked of the camera (two thirds), so every frame still gets its effects
      smaller = true;
      const s = src.getSettings ? src.getSettings() : {}, w = Math.max(320, Math.round((s.width || 640) * 2 / 3) & ~1);
      src.applyConstraints({ width: { ideal: w }, height: { ideal: Math.round(w * (s.height || 360) / (s.width || 640)) & ~1 } }).then(() => fw.postMessage({ type: "smaller" }), () => {});
    }
  });
  fw.addEventListener("error", () => first(false));
  fw.postMessage({ type: "start", readable: proc.readable, writable: gen.writable, light, black: !!o.forceBlack, cfg: c }, [proc.readable, gen.writable]);
  async function prepare() {
    if (c.bg !== "none" && !segW) {
      try {
        segW = makeWorker();
        if (!segW) throw new Error("Background effects need a newer browser.");
        wseg = workerSegmenter(segW);
        await wseg.ready();
        const ch = new MessageChannel();
        segW.postMessage({ type: "port", port: ch.port1 }, [ch.port1]);
        fw.postMessage({ type: "seg", port: ch.port2 }, [ch.port2]);
      } catch (e) { try { segW && segW.terminate(); } catch (x) { /* */ } segW = null; onNote && onNote(e.message); c = Object.assign({}, c, { bg: "none" }); }
    }
    if (c.bg === "image" && c.image) {
      const im = await new Promise((ok) => { const x = new Image(); x.onload = () => ok(x); x.onerror = () => ok(null); x.src = c.image; });
      if (im) {
        const s = camTrack.getSettings ? camTrack.getSettings() : {}, W = Math.min(maxW, s.width || 640), H = Math.round(W * (s.height || 360) / (s.width || 640));
        const iw = im.naturalWidth || im.width || W, ih = im.naturalHeight || im.height || H, r = iw / ih;
        const bc = document.createElement("canvas"); bc.width = W; bc.height = H;
        let dw = W, dh = W / r; if (dh < H) { dh = H; dw = H * r; }
        const bx = bc.getContext("2d"); bx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
        const d = bx.getImageData(0, 0, W, H).data.buffer;
        fw.postMessage({ type: "image", buf: d, w: W, h: H }, [d]);
      }
    } else fw.postMessage({ type: "image", buf: null });
    if (c.bg === "none") haveMask = false;
    fw.postMessage({ type: "cfg", cfg: c });
  }
  await prepare();
  const ok = await Promise.race([firstP, new Promise((r) => setTimeout(() => r(false), 4000))]);
  if (!ok) { fw.postMessage({ type: "stop" }); setTimeout(() => fw.terminate(), 500); try { segW && segW.terminate(); } catch (e) { /* */ } src.stop(); gen.stop(); throw new Error("The frame worker did not start."); }
  endWatch = watchFirst(gen, camTrack, fail, 5);
  const t0 = performance.now();
  return {
    track: gen,
    canvas: null,
    pipe: "frames",
    get choice() { return c; },
    get segmenting() { return !!segW && c.bg !== "none" && haveMask; },
    get fellBack() { return fellBack; },
    stats() { return { frames: stats.frames, fps: Math.round(10 * stats.frames / Math.max(0.1, (performance.now() - t0) / 1000)) / 10, procMs: Math.round(10 * (stats.ms || 0)) / 10, smaller, parts: [stats.read, stats.bg, stats.main].map((x) => Math.round(10 * (x || 0)) / 10), worker: true, light, size: stats.size || "", fellBack, pipe: "frames" }; },
    async set(next) { const was = c.bg; c = effectsClean(next); if (c.bg !== was) haveMask = false; await prepare(); },
    stop() {
      if (endWatch) endWatch();
      fw.postMessage({ type: "stop" });
      setTimeout(() => { try { fw.terminate(); } catch (e) { /* */ } }, 300);
      try { if (segW) segW.terminate(); } catch (e) { /* */ }
      try { gen.stop(); } catch (e) { /* */ }
      try { src.stop(); } catch (e) { /* */ }
    },
  };
}

// ---------------------------------------------------------------- the pipeline
// const fx = await makeEffects(cameraStream, choice, onNote, {onFail}); fx.track (what to send); await fx.set(choice);
// fx.stop(); fx.stats(); fx.segmenting (the background is being drawn); fx.fellBack (the camera must be sent instead).
// Chrome and Edge: the frame worker; Safari (and if the frame worker cannot start): the canvas (WebGL)
export async function makeEffects(camera, choice, onNote, opts) {
  const o = opts || {};
  if (o.pipe !== "canvas" && framePipeOk()) {
    try { return await makeFrameEffects(camera, choice, onNote, o); } catch (e) { /* the canvas below */ }
  }
  return makeCanvasEffects(camera, choice, onNote, o);
}
async function makeCanvasEffects(camera, choice, onNote, opts) {
  const o = opts || {};
  let c = effectsClean(choice), running = true, raf = 0, segmenter = null, wseg = null, worker = null, bgImg = null, gain = 1, contrast = 1, frames = 0, hidden = false;
  let haveMask = false, busy = false, lastSeg = 0, segs = 0, segMs = 0, fellBack = false, watch = null, clockWorker = null;
  const startedAt = performance.now();
  const camTrack = camera.getVideoTracks()[0];
  const st = camTrack ? camTrack.getSettings() : {};
  const light = lightDevice();
  const W = Math.min(st.width || 640, light ? 640 : 960), H = Math.round(W * ((st.height || 360) / (st.width || 640))) & ~1;
  const HW = Math.max(2, Math.round(W / 2)), HH = Math.max(2, Math.round(H / 2)), BW = 160, BH = Math.max(2, Math.round(160 * H / W));
  const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = new MediaStream(camTrack ? [camTrack] : []);
  await video.play().catch(() => {});
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const K = glKit(canvas, isWebKit(navigator.userAgent || ""));
  const { gl } = K;
  const P = {
    mask: K.program(VS_RT, FS_MASK, ["uFrame", "uMask"]),
    blur: K.program(VS_RT, FS_BLUR, ["uSrc", "uMask"]),
    smooth: K.program(VS_RT, FS_SMOOTH, ["uFrame"]),
    final: K.program(VS, FS_FINAL, ["uFrame", "uMask", "uBg", "uSmooth"]),
  };
  const T = { frame: K.texture(), mask: K.texture(), img: K.texture() };
  const RT = { mask: K.target(HW, HH), smooth: K.target(HW, HH), b1: K.target(BW, BH), b2: K.target(BW, BH) };
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  K.bind(1, T.mask); gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
  K.bind(2, T.img); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 60, 255]));
  const out = canvas.captureStream(30).getVideoTracks()[0];
  // the small copy for the segmenter (and the lighting fix's measure)
  const small = document.createElement("canvas"); small.width = SEG_W; small.height = SEG_H; const sctx = small.getContext("2d", { willReadFrequently: true });
  let maskBuf = null, maskW = 1, maskH = 1;
  const needsSeg = () => c.bg !== "none";
  const segEvery = () => (segmenter === "worker" ? (light ? 66 : 33) : 125);
  const fail = (why) => {
    if (fellBack) return;
    fellBack = true;
    onNote && onNote(why || "Effects could not run on this device; your camera is sent as it is.");
    try { o.onFail && o.onFail(why); } catch (e) { /* */ }
  };
  async function prepare() {
    if (needsSeg() && !segmenter) {
      try {
        worker = makeWorker();
        if (worker) {
          wseg = workerSegmenter(worker);
          try { await wseg.ready(); segmenter = "worker"; }
          catch (e) {
            try { worker.terminate(); } catch (x) { /* */ }
            worker = null; wseg = null;
            if ((e && e.kind === "old") || /could not be loaded|not the file/.test(String(e && e.message))) throw e;
          }
        }
        if (!segmenter) segmenter = await localSegmenter();
      } catch (e) { onNote && onNote(e.message); c = Object.assign({}, c, { bg: "none" }); }
    }
    if (c.bg === "image" && c.image) {
      bgImg = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = c.image; });
      if (bgImg) {
        // drawn once at the picture's size, cut to fit (never stretched); an SVG has no size of its own in some browsers
        const iw = bgImg.naturalWidth || bgImg.width || W, ih = bgImg.naturalHeight || bgImg.height || H, r = iw / ih;
        const bc = document.createElement("canvas"); bc.width = W; bc.height = H;
        let dw = W, dh = W / r; if (dh < H) { dh = H; dw = H * r; }
        bc.getContext("2d").drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        K.bind(2, T.img); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bc);
      }
    } else bgImg = null;
    if (!needsSeg()) haveMask = false;
  }
  // a new outline, eased into the last one (a pixel that changes a lot follows at once)
  function takeMask(m) {
    const n = m.w * m.h;
    if (!maskBuf || maskBuf.length !== n) { maskBuf = new Uint8Array(m.data); maskW = m.w; maskH = m.h; }
    else for (let i = 0; i < n; i++) { const a = maskBuf[i], b = m.data[i], d = b > a ? b - a : a - b; maskBuf[i] = d > 90 ? b : a * 0.45 + b * 0.55; }
    K.bind(1, T.mask); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, maskW, maskH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, maskBuf);
    haveMask = true;
  }
  async function segment(now) {
    if (busy || !segmenter || now - lastSeg < segEvery()) return;
    busy = true; lastSeg = now;
    const t0 = performance.now();
    try {
      sctx.drawImage(video, 0, 0, SEG_W, SEG_H);
      const img = sctx.getImageData(0, 0, SEG_W, SEG_H);
      let m = null;
      if (segmenter === "worker") m = await wseg.seg(img, now);
      else {
        const r = segmenter.segmentForVideo(img, now), k = r && r.confidenceMasks && r.confidenceMasks[0];
        if (k) { const f = k.getAsFloat32Array(), d = new Uint8Array(f.length); for (let i = 0; i < f.length; i++) d[i] = f[i] * 255; m = { w: k.width, h: k.height, data: d }; }
        if (r && r.close) r.close();
      }
      if (m && running && needsSeg()) { takeMask(m); segs++; segMs += performance.now() - t0; }
    } catch (e) { /* the next one */ }
    busy = false;
  }
  function draw() {
    frames++;
    if (needsSeg()) segment(performance.now());
    K.bind(0, T.frame); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    // the lighting fix: the frame's average brightness every half second, eased towards a middle grey
    if (c.light && frames % 12 === 1) {
      sctx.drawImage(video, 0, 0, SEG_W, SEG_H);
      const d = sctx.getImageData(0, 0, SEG_W, SEG_H).data; let sum = 0, sq = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; sum += y; sq += y * y; n++; }
      const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      gain += (Math.max(0.85, Math.min(1.8, 0.5 / Math.max(0.05, mean))) - gain) * 0.3;
      contrast += (Math.max(1, Math.min(1.35, 0.2 / Math.max(0.05, sd))) - contrast) * 0.3;
    }
    if (!c.light) { gain = 1; contrast = 1; }
    const mode = needsSeg() && haveMask ? (c.bg === "blur" ? 1 : c.bg === "image" && bgImg ? 2 : 0) : 0;
    if (mode) {
      // the outline, snapped to the picture's edges, at half size
      K.bind(0, T.frame); K.bind(1, T.mask);
      K.pass(P.mask, RT.mask, 0, 0, (U) => gl.uniform2f(U("uStep"), 1 / maskW, 1 / maskH));
      if (mode === 1) {
        // the background: the frame made small and blurred twice, the person left out
        K.bind(0, T.frame); K.bind(1, RT.mask.t);
        K.pass(P.blur, RT.b1, 0, 0, (U) => gl.uniform2f(U("uStep"), 2.2 / BW, 2.2 / BH));
        K.bind(0, RT.b1.t);
        K.pass(P.blur, RT.b2, 0, 0, (U) => gl.uniform2f(U("uStep"), 1.6 / BW, 1.6 / BH));
      }
    }
    if (c.touch > 0) { K.bind(0, T.frame); K.pass(P.smooth, RT.smooth, 0, 0, (U) => gl.uniform2f(U("uStep"), 1 / HW, 1 / HH)); }
    K.bind(0, T.frame); K.bind(1, mode ? RT.mask.t : T.mask); K.bind(2, mode === 1 ? RT.b2.t : T.img); K.bind(3, RT.smooth.t);
    K.pass(P.final, null, W, H, (U) => { gl.uniform1i(U("uMode"), mode); gl.uniform1f(U("uGain"), gain); gl.uniform1f(U("uContrast"), contrast);
      gl.uniform1f(U("uTouch"), c.touch); gl.uniform1f(U("uBlack"), o.forceBlack ? 1 : 0); });
  }
  // every camera frame (requestVideoFrameCallback, else the display's); a hidden page: a worker's clock
  function loop() { if (running && !hidden) raf = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick); }
  function tick() {
    if (!running) return;
    if (video.readyState >= 2) { try { draw(); } catch (e) { fail("The effects stopped (" + e.message + "); your camera is sent as it is."); return; } }
    loop();
  }
  const onTick = (e) => { if (e.data && e.data.type === "tick" && running && hidden && video.readyState >= 2) { try { draw(); } catch (x) { /* */ } } };
  function onVis() {
    const h = !!document.hidden;
    if (h === hidden) return;
    hidden = h;
    if (h) {
      if (!clockWorker) { clockWorker = worker || makeWorker(); if (clockWorker) clockWorker.addEventListener("message", onTick); }
      if (clockWorker) clockWorker.postMessage({ type: "clock", ms: 66 });
    } else { if (clockWorker) clockWorker.postMessage({ type: "clock", ms: 0 }); loop(); }
  }
  document.addEventListener("visibilitychange", onVis);
  await prepare();
  // the first frame drawn before the track is handed over (a canvas not yet drawn sends black)
  if (video.readyState < 2) await new Promise((ok) => { const t = setTimeout(ok, 3000); video.addEventListener("loadeddata", () => { clearTimeout(t); ok(); }, { once: true }); });
  if (video.readyState >= 2) { try { draw(); } catch (e) { /* the loop says so */ } }
  if (document.hidden) { hidden = false; onVis(); }
  loop();
  if (camTrack) watch = watchFirst(out, camTrack, fail, 5);
  return {
    track: out,
    canvas,
    get choice() { return c; },
    get segmenting() { return !!segmenter && c.bg !== "none" && haveMask; },
    get fellBack() { return fellBack; },
    pipe: "canvas",
    stats() { const secs = (performance.now() - startedAt) / 1000; return { frames, fps: Math.round(10 * frames / Math.max(0.1, secs)) / 10, segs, segMs: segs ? Math.round(segMs / segs) : 0, worker: segmenter === "worker", light, size: W + "x" + H, fellBack, pipe: "canvas" }; },
    async set(next) { c = effectsClean(next); await prepare(); },
    stop() {
      running = false;
      try { video.cancelVideoFrameCallback ? video.cancelVideoFrameCallback(raf) : cancelAnimationFrame(raf); } catch (e) { /* */ }
      document.removeEventListener("visibilitychange", onVis);
      try { if (clockWorker) { clockWorker.removeEventListener("message", onTick); clockWorker.postMessage({ type: "clock", ms: 0 }); if (clockWorker !== worker) clockWorker.terminate(); } } catch (e) { /* */ }
      try { if (worker) worker.terminate(); } catch (e) { /* */ }
      if (watch) watch(); out.stop(); video.srcObject = null;
      try { const x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); } catch (e) { /* */ }
    },
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
