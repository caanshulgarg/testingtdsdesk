// Clearer listening (the owner, 22-Oct-2026: listening "very poor; make it best"; Groq's free Whisper, with the browser's
// own listening as the backup). A lazy part, loaded when a mic is shown (Ask FinCom's AssistantVoice.jsx; the coming
// "My MIS" builder uses the same): while the browser's recogniser shows the words live, this records the same speech
// (MediaRecorder: webm/opus in Chrome, Edge and Firefox; mp4/aac in Safari), hears when the person stops (a level meter,
// WebAudio's AnalyserNode: about 4 s quiet after speech), and on stop sends the clip to the fincom-transcribe function
// (server/fincom-transcribe), whose Whisper words replace the browser's. A clip longer than about 55 s is cut into pieces
// (a new recorder every 55 s on the same microphone: each piece a whole file) and the pieces' words joined.
// Clearer sound (the owner, 22-Oct-2026: voice "still not good"): the microphone is asked for echo cancelling, noise
// suppression and automatic gain, one channel at 48 kHz; opus at about 40 kbps; each new piece starts 300 ms before the
// last one ends (a word at the seam is never cut), and the person is told to speak only once the recorder runs (onReady).
// The function corrects the client's names; the changes ({from, to}) come back with the words, for the app to show.
// Nothing is kept: the clip lives in this page's memory until it is sent, and the function keeps neither audio nor words.

// a piece's length before a new one starts (the function takes at most 60 s); a test may shorten it
const splitMs = () => Number(globalThis.FINCOM_VOICE_SPLIT_MS) || 55000;
const TICK = 100;              // how often the level is read, ms
const SPEECH = 0.02;           // the level (RMS, 0-1) that counts as speech, above the room's own noise
export const SILENCE_MS = 4000; // the pause after speech that ends the listening (a person may set 1-15 s)
export const PRE_ROLL_MS = 300; // a new piece starts this long before the last one ends
export const BITRATE = 40000;   // opus, bits a second
// what the microphone is asked for (each an ideal: a microphone that cannot is used as it is)
export const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 };

const isSafari = () => { const u = (typeof navigator === "object" && navigator.userAgent) || ""; return /safari/i.test(u) && !/chrome|chromium|crios|fxios|edg|android/i.test(u); };
// the recording's type: Safari's mp4 (aac) first there; elsewhere webm/opus, then ogg, then mp4
export function pickType() {
  const MR = typeof window === "object" ? window.MediaRecorder : null;
  if (!MR) return null;
  const list = isSafari() ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"] : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  const can = (t) => { try { return typeof MR.isTypeSupported !== "function" || MR.isTypeSupported(t); } catch (e) { return false; } };
  return list.find(can) || "";
}
export const canRecord = () => typeof window === "object" && !!window.MediaRecorder && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// a microphone error, in plain words
export function micWords(e) {
  const n = (e && e.name) || "";
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") return "The microphone is blocked for FinCom. Allow it in the browser's site settings (the lock or mic sign beside the address), then tap the mic again.";
  if (n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError") return "No microphone was found on this device. Plug one in, or type instead.";
  if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError") return "The microphone is being used by another app (a call or a recorder). Close it, then tap the mic again.";
  return "The microphone could not start. Tap the mic to try again, or type.";
}

// start recording. o: {silenceMs, onSilence(), onError(words), onReady() once the recorder runs}. Returns {stop(): Promise<clips>, abort()} at once; the
// microphone is asked for in the background (a prompt left unanswered just records nothing, and the browser's words stand).
export function startRecording(o = {}) {
  const st = { on: true, stream: null, rec: null, chunks: [], clips: [], at: 0, ctx: null, timer: null, split: null, heard: false, loud: 0, done: null, pending: 0, settle: null };
  const type = pickType();
  const closeAll = () => {
    clearInterval(st.timer); clearTimeout(st.split);
    try { if (st.ctx && st.ctx.close) st.ctx.close(); } catch (e) { /* closed */ }
    try { (st.stream && st.stream.getTracks ? st.stream.getTracks() : []).forEach((t) => t.stop()); } catch (e) { /* stopped */ }
  };
  const settled = () => { if (!st.pending && st.settle) { const f = st.settle; st.settle = null; f(st.clips.slice()); } };
  // one recorder = one piece (a whole file)
  const piece = () => {
    let r;
    try { r = new window.MediaRecorder(st.stream, Object.assign(type ? { mimeType: type } : {}, { audioBitsPerSecond: BITRATE })); }
    catch (e) { try { r = type ? new window.MediaRecorder(st.stream, { mimeType: type }) : new window.MediaRecorder(st.stream); } catch (e2) { if (o.onError) o.onError(micWords(e2)); return; } }
    const chunks = [], t0 = Date.now();
    st.rec = r; st.pending++;
    r.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    r.onstop = () => {
      const secs = (Date.now() - t0) / 1000, mime = String(r.mimeType || type || chunks[0]?.type || "audio/webm");
      if (chunks.length) st.clips.push({ blob: new Blob(chunks, { type: mime }), type: mime, secs: Math.min(secs, 60) });
      st.pending--; settled();
    };
    try { r.start(1000); } catch (e) { st.pending--; if (o.onError) o.onError(micWords(e)); return; }
    // the next piece starts a little before this one ends (a word at the seam is in one of them whole)
    st.split = setTimeout(() => {
      if (!st.on || st.rec !== r) return;
      piece();
      setTimeout(() => { try { if (r.state !== "inactive") r.stop(); } catch (e) { /* stopped */ } }, Math.min(PRE_ROLL_MS, splitMs() / 4));
    }, splitMs());
  };
  // the level meter: speech, then about 3 s quiet, ends the listening
  const meter = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !o.onSilence) return;
    try {
      const ctx = new AC(); st.ctx = ctx;
      const src = ctx.createMediaStreamSource(st.stream), an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      st.timer = setInterval(() => {
        if (!st.on) return;
        let s = 0;
        if (an.getFloatTimeDomainData) { an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; }
        const rms = Math.sqrt(s / buf.length), now = Date.now();
        if (rms > SPEECH) { st.heard = true; st.loud = now; }
        else if (st.heard && now - st.loud >= (o.silenceMs || SILENCE_MS)) { st.heard = false; o.onSilence(); }
      }, TICK);
    } catch (e) { /* no meter: the browser's own pause and the tap still stop it */ }
  };
  if (canRecord()) {
    navigator.mediaDevices.getUserMedia({ audio: Object.assign({}, MIC) }).then((stream) => {
      st.stream = stream;
      if (!st.on) { closeAll(); return; }
      piece(); meter();
      if (st.rec && o.onReady) o.onReady();
    }, (e) => {
      // a blocked or busy microphone is said in plain words; otherwise (no microphone found, ...) the recording is just off
      // and the browser's recogniser, which says so itself, goes on
      if (st.on && o.onError && /^(NotAllowedError|SecurityError|PermissionDeniedError|NotReadableError|TrackStartError)$/.test((e && e.name) || "")) o.onError(micWords(e));
    });
  }
  return {
    // the pieces recorded, once the last one is whole
    stop() {
      if (st.done) return st.done;
      st.on = false;
      // the microphone is let go once the last piece is whole
      st.done = new Promise((res) => { st.settle = (clips) => { closeAll(); res(clips); }; });
      clearInterval(st.timer); clearTimeout(st.split);
      const r = st.rec; st.rec = null;
      try { if (r && r.state !== "inactive") r.stop(); } catch (e) { /* stopped */ }
      settled();
      // a recorder that never says it stopped: what there is, after 2 s
      setTimeout(() => { if (st.settle) { st.pending = 0; settled(); } }, 2000);
      return st.done;
    },
    abort() { st.on = false; st.settle = null; clearTimeout(st.split); const r = st.rec; st.rec = null; try { if (r && r.state !== "inactive") r.stop(); } catch (e) { /* stopped */ } closeAll(); st.clips = []; },
  };
}

// the language for Whisper: hi and en when they are certain; Hinglish and the other languages "auto" (Hinglish with
// latin: its words in English letters)
export const whisperLang = (code) => (code === "hi-IN" ? "hi" : code === "en-IN" ? "en" : "auto");
export const whisperLatin = (code) => code === "hinglish";

// the pieces to fincom-transcribe, in order, the words joined.
// -> {ok: true, text, changes: [{from, to}] (the names corrected)} | {ok: false, kind: nokey|limit|offline|error|auth}
export async function transcribe(clips, { lang = "auto", client = null, latin = false } = {}) {
  if (!clips || !clips.length) return { ok: false, kind: "empty" };
  if (typeof navigator === "object" && navigator.onLine === false) return { ok: false, kind: "offline" };
  if (!(typeof Cloud === "object" && Cloud.on && Cloud.on())) return { ok: false, kind: "auth" };
  try { await Cloud.fresh(); } catch (e) { /* the token as it is */ }
  const c = Cloud.cfg(), s = Cloud.sess() || {};
  const url = String(c.url || "").replace(/\/+$/, "") + "/functions/v1/fincom-transcribe";
  const out = [], changes = [];
  for (const clip of clips) {
    const qs = new URLSearchParams({ lang, secs: String(Math.round(clip.secs * 10) / 10) });
    if (client) qs.set("client", client);
    if (latin) qs.set("latin", "1");
    let r;
    try { r = await fetch(url + "?" + qs, { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": String(clip.type || "audio/webm").split(";")[0] }, body: clip.blob }); }
    catch (e) { return { ok: false, kind: typeof navigator === "object" && navigator.onLine === false ? "offline" : "error" }; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 || j.kind === "limit") return { ok: false, kind: "limit" };
    if (j.kind === "nokey") return { ok: false, kind: "nokey" };
    if (!r.ok || !j.ok) return { ok: false, kind: "error" };
    if (j.text) out.push(String(j.text).trim());
    if (Array.isArray(j.changes)) for (const c of j.changes) if (c && c.from && c.to) changes.push({ from: String(c.from), to: String(c.to) });
  }
  return { ok: true, text: out.join(" ").replace(/\s+/g, " ").trim(), changes };
}

// the one quiet line when the browser's words are kept
export const KEPT = {
  nokey: "Your browser's words are kept (clearer listening is not set up yet).",
  limit: "Your browser's words are kept (clearer listening has reached today's limit).",
  offline: "Your browser's words are kept (you are offline).",
  error: "Your browser's words are kept (clearer listening did not answer).",
  auth: "Your browser's words are kept (sign in to the firm account for clearer listening).",
};
