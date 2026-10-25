// Recording in the browser (stage 1: no server records anything).
//  - The host's recording: the call drawn on one canvas (the shared screen large with the people beside it, else the
//    people in a grid) with everyone's voices mixed (WebAudio), recorded by MediaRecorder in 10-second parts, each put in
//    the private bucket call-recordings (<firm>/<kind>/<room>/rec/<recording>/00000.part, …) as soon as it is made; the
//    parts joined in order are the file (webm, or mp4 on Safari).
//  - Each person's own microphone, for the transcript with names: pieces of at most 55 s that end at a pause
//    (rules.pieceEnds), a piece without speech never sent; each piece goes up at once (…/mic/<person>/00000.webm).
// An upload that fails is tried again (the line came back), in order; nothing is kept on the device after the call.
import { pieceEnds, PIECE_MAX_MS } from "./rules.js";

export function pickMime(kind) {
  const MR = window.MediaRecorder;
  if (!MR) return "";
  const list = kind === "audio" ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    : ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];
  for (const t of list) { try { if (!MR.isTypeSupported || MR.isTypeSupported(t)) return t; } catch (e) { /* */ } }
  return "";
}

// one upload after another, each tried again with a pause, so the parts arrive in order even on a weak line
export function uploadQueue(send, onState) {
  const q = []; let busy = false, failedAt = 0;
  async function run() {
    if (busy) return; busy = true;
    while (q.length) {
      const job = q[0];
      try { await send(job); q.shift(); failedAt = 0; onState && onState({ waiting: q.length }); }
      catch (e) { failedAt = failedAt || Date.now(); onState && onState({ waiting: q.length, error: e.message }); await new Promise((ok) => setTimeout(ok, Math.min(30000, 2000 + (Date.now() - failedAt) / 4))); }
    }
    busy = false;
  }
  return { add(job) { q.push(job); run(); }, get waiting() { return q.length; }, drain: async () => { while (q.length || busy) await new Promise((ok) => setTimeout(ok, 200)); } };
}

// ---------------------------------------------------------------- the host's recording
// 960 x 540 at 12 frames a second: readable for a shared screen, light enough for an office PC to draw and encode
export function compositeRecorder({ tiles, screen, audio, onPart, fps = 12 }) {
  const W = 960, H = 540;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC(), dest = ac.createMediaStreamDestination();
  // a steady silence always in the mix: with nothing connected (no microphone here, the others' voices not yet in) the
  // mix's track carries no sound at all, and Chromium's MediaRecorder then records nothing, not even the picture
  let hum = null;
  try { hum = ac.createConstantSource(); hum.offset.value = 0; hum.connect(dest); hum.start(); } catch (e) { /* older browser */ }
  const sources = new Map();
  function mixAudio() {
    const want = new Set();
    for (const s of audio()) for (const t of s.getAudioTracks()) { want.add(t.id); if (!sources.has(t.id)) { try { const n = ac.createMediaStreamSource(new MediaStream([t])); n.connect(dest); sources.set(t.id, n); } catch (e) { /* */ } } }
    for (const [id, n] of sources) if (!want.has(id)) { try { n.disconnect(); } catch (e) { /* */ } sources.delete(id); }
  }
  function draw() {
    ctx.fillStyle = "#0F172A"; ctx.fillRect(0, 0, W, H);
    const ts = tiles().filter((t) => t.video), sc = screen();
    const fit = (v, x, y, w, h) => { const vw = v.videoWidth || 16, vh = v.videoHeight || 9, r = Math.min(w / vw, h / vh), dw = vw * r, dh = vh * r; try { ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) { /* not ready */ } };
    const label = (t, x, y) => { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x + 6, y - 26, Math.min(220, 12 + t.name.length * 9), 22); ctx.fillStyle = "#fff"; ctx.font = "13px Inter, Arial, sans-serif"; ctx.fillText(t.name, x + 12, y - 10); };
    if (sc) {
      fit(sc, 0, 0, W * 0.78, H);
      const h = Math.min(H / Math.max(1, ts.length), 200), x = W * 0.78;
      ts.forEach((t, i) => { if (t.camOn !== false) fit(t.video, x, i * h, W * 0.22, h); label(t, x, (i + 1) * h); });
    } else {
      const n = Math.max(1, ts.length), cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), w = W / cols, h = H / rows;
      ts.forEach((t, i) => { const x = (i % cols) * w, y = Math.floor(i / cols) * h; if (t.camOn !== false) fit(t.video, x, y, w, h); label(t, x, y + h); });
    }
  }
  let timer = setInterval(() => { draw(); }, 1000 / fps), mixTimer = setInterval(mixAudio, 1500);
  mixAudio(); draw();
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = pickMime("video");
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 } : {});
  let seq = 0, started = false;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) onPart(e.data, seq++); };
  // "start" comes when the encoder has begun, which on a busy computer can be many seconds after rec.start(): stopped
  // before that, the recording is empty (no part at all); so a stop that early waits for it (15 s at most), drawing on
  const begun = new Promise((ok) => { rec.onstart = () => { started = true; ok(); }; });
  rec.start(10000);
  return {
    mime: rec.mimeType || mime || "video/webm",
    async stop() {
      if (!started && rec.state === "recording") await Promise.race([begun, new Promise((ok) => setTimeout(ok, 15000))]);
      return new Promise((ok) => {
        clearInterval(timer); clearInterval(mixTimer);
        rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); try { hum && hum.stop(); } catch (e) { /* */ } try { ac.close(); } catch (e) { /* */ } ok(seq); };
        try { rec.stop(); } catch (e) { ok(seq); }
      });
    },
  };
}

// ---------------------------------------------------------------- my own microphone, in pieces
// sizes: the transcript's pieces by default (8 to 55 s, a 1.2 s pause); live subtitles pass shorter ones (rules.SUB_PIECE)
export function micPieces({ track, t0, onPiece, isMuted, sizes }) {
  const Z = sizes || null;
  const ends = (ms, silent) => (Z ? ms >= Z.maxMs || (ms >= Z.minMs && silent >= Z.pauseMs) : pieceEnds(ms, silent));
  const minSpeech = Z ? Z.minSpeechMs : 500;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC(), src = ac.createMediaStreamSource(new MediaStream([track])), an = ac.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  // next-calls-complete (25-Oct-2026; the owner's iPhone guests' words never had subtitles): Safari keeps an audio context
  // made outside a tap "suspended", and a suspended one hears only silence, so no piece was ever cut. It is resumed now
  // and on the next tap; until it runs, pieces are cut by time alone (fincom-call drops what Whisper finds no speech in)
  const wake = () => { try { if (ac.state !== "running") ac.resume().catch(() => {}); } catch (e) { /* */ } };
  wake();
  const taps = ["pointerdown", "touchend", "keydown"];
  taps.forEach((t) => document.addEventListener(t, wake, { passive: true }));
  const deaf = () => ac.state !== "running";
  const buf = new Float32Array(an.fftSize);
  const mime = pickMime("audio");
  let rec = null, chunks = [], started = 0, silentSince = 0, speechMs = 0, lastTick = 0, seq = 0, running = true, timer = null;
  function begin() {
    chunks = []; started = Date.now(); silentSince = started; speechMs = 0; lastTick = started;
    rec = new MediaRecorder(new MediaStream([track]), mime ? { mimeType: mime, audioBitsPerSecond: 40000 } : {});
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const myStart = started, myRec = rec;
    rec.onstop = () => {
      const dur = Math.min(PIECE_MAX_MS + 2000, Date.now() - myStart), had = speechMsOf.get(myRec) || 0;
      // a piece with less than half a second of speech is not sent (it costs the free allowance and says nothing)
      if (had >= minSpeech && chunks.length) onPiece(new Blob(chunks, { type: myRec.mimeType || mime || "audio/webm" }), seq++, Math.max(0, myStart - t0), Math.min(60000, dur));
    };
    rec.start(1000);
  }
  const speechMsOf = new WeakMap();
  function tick() {
    if (!running || !rec) return;
    an.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length), now = Date.now(), dt = now - lastTick; lastTick = now;
    const speaking = (deaf() || rms > 0.015) && !(isMuted && isMuted());
    if (speaking) { silentSince = now; speechMs += dt; speechMsOf.set(rec, speechMs); }
    if (ends(now - started, now - silentSince)) { const r = rec; begin(); try { r.stop(); } catch (e) { /* */ } }
  }
  begin();
  timer = setInterval(tick, 100);
  return {
    get deaf() { return deaf(); },
    stop() { running = false; clearInterval(timer); taps.forEach((t) => document.removeEventListener(t, wake)); try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) { /* */ } setTimeout(() => { try { ac.close(); } catch (e) { /* */ } }, 200); },
  };
}
