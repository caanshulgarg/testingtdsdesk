// Ask FinCom by voice (the owner, 19-Oct-2026: "voice for Ask FinCom for browser as well as mobile; Hindi, English and
// Hinglish must; other regional languages would be an advantage"). The browser's own speech recognition (the Web Speech
// API: Chrome and Edge on a computer and Android, Safari on a Mac, iPhone and iPad) turns what is said into text in the
// question box, live; nothing is asked until the person presses Ask (they can correct the words first).
// The owner, 22-Oct-2026: "while I was speaking it took only the first sentence and stopped listening". The recogniser was
// asked for one phrase (continuous off), so the browser ended it at the first pause. Now it listens until the person stops:
// continuous, with interim words shown live; when the browser ends a session by itself (after a pause, after about 60 s,
// or Safari after each phrase, where continuous is not dependable and is not asked for) a new one starts at once while the
// mic is on, and the pieces are joined. It stops on a second tap, or after a pause of about 4 s following speech
// (silenceMs: a person may set 1-15 s in this browser, localStorage "tdsdesk:asst-voice-silence"), or when nothing at all
// is heard for 12 s. The language chosen (English, Hindi, Hinglish, …) is kept for every session. Where the browser has none (Firefox), the mic is not shown. The language chosen is kept for the
// person in this browser and goes with the question as a hint (ASST.st().lang): the reply comes in the question's language.
// "Read aloud" on a reply: the browser's speech, in the reply's language when the browser has a voice for it.
// Clearer listening (the owner, 22-Oct-2026: "very poor; make it best"): while the browser shows the words live, the same
// speech is recorded (VoiceRecorder.js, a lazy part loaded with the mic); on stop (a tap, or about 3 s quiet after speech,
// heard by a level meter as well as by the recogniser) the clip goes to fincom-transcribe (Groq's Whisper, with the
// firm's words and the client's names as a hint) and its words replace the browser's, unless the box was changed
// meanwhile. No key, the day's limit, offline or an error: the browser's words stay, with one quiet line.
// Names corrected (the owner, 22-Oct-2026: voice "still not good", wrong client, ledger and party names): the function
// matches what Whisper heard against the client's own names and gives back the changes; each corrected name is shown
// under the box, underlined, with what was heard on hover or a tap, and one tap on its undo puts the heard words back.
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Undo2, Volume2, VolumeX } from "lucide-react";
import NoDeviceNote from "./NoDeviceNote.jsx";
import { NO_SOUND_TEXT } from "./noDevice.js";

// code: what the browser listens for and what goes to fincom-assistant as the hint (server/assistant/agent.ts, LANGS)
export const VOICE_LANGS = [
  { code: "en-IN", label: "English", rec: "en-IN" },
  { code: "hi-IN", label: "हिन्दी", rec: "hi-IN" },
  { code: "hinglish", label: "Hinglish", rec: "en-IN" },   // Hindi spoken, written in English letters: the en-IN recogniser
  { code: "mr-IN", label: "मराठी", rec: "mr-IN" },
  { code: "gu-IN", label: "ગુજરાતી", rec: "gu-IN" },
  { code: "bn-IN", label: "বাংলা", rec: "bn-IN" },
  { code: "ta-IN", label: "தமிழ்", rec: "ta-IN" },
  { code: "te-IN", label: "తెలుగు", rec: "te-IN" },
  { code: "kn-IN", label: "ಕನ್ನಡ", rec: "kn-IN" },
  { code: "ml-IN", label: "മലയാളം", rec: "ml-IN" },
  { code: "pa-IN", label: "ਪੰਜਾਬੀ", rec: "pa-IN" },
];
const byCode = (c) => VOICE_LANGS.find((l) => l.code === c) || VOICE_LANGS[0];
const Rec = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);
export const voiceSupported = () => !!Rec();

// kept per person (the signed-in user) in this browser; private windows and blocked storage just start at English
const who = () => { try { return (typeof Cloud === "object" && Cloud.sess && (Cloud.sess() || {}).user_id) || "me"; } catch (e) { return "me"; } };
const KEY = () => "tdsdesk:asst-voice-lang:" + who();
export function voiceLang() {
  try { const v = localStorage.getItem(KEY()); if (v && VOICE_LANGS.some((l) => l.code === v)) return v; } catch (e) { /* storage blocked */ }
  return "en-IN";
}
function keepLang(c) { try { localStorage.setItem(KEY(), c); } catch (e) { /* storage blocked */ } }
const seen = (k) => { try { return localStorage.getItem(k) === "1"; } catch (e) { return false; } };
const see = (k) => { try { localStorage.setItem(k, "1"); } catch (e) { /* storage blocked */ } };
const NOTE_KEY = "tdsdesk:asst-voice-note", NONE_KEY = "tdsdesk:asst-voice-none";
const NOTE = "Voice is turned into text by your browser (Google/Apple); for clearer words the recording also goes to Groq through FinCom, and is not kept.";
const BUSY = "Making the words clearer…";
const OPENING = "Starting the microphone…";
// the recorder (VoiceRecorder.js), loaded when a mic is first shown; until it is there, the browser's words alone
let VR = null, vrLoad = null;
export const loadRecorder = () => vrLoad || (vrLoad = import("./VoiceRecorder.js").then((m) => (VR = m), () => { vrLoad = null; return null; }));

// the one listening at a time (all its recogniser sessions); Ask stops it (a word heard after Ask never lands in the next
// question)
let live = null;
export function stopVoice() { const s = live; live = null; if (s) s.finish("abort"); }

// the pause after speech that ends the listening, in ms (4 s; a person may set 1-15 s in this browser)
export const SILENCE_KEY = "tdsdesk:asst-voice-silence";
export function silenceMs() {
  try { const v = Number(localStorage.getItem(SILENCE_KEY)); if (v >= 1 && v <= 15) return Math.round(v * 1000); } catch (e) { /* storage blocked */ }
  return 4000;
}
const NOTHING_MS = 12000;            // nothing heard at all since the mic was tapped: stop, and say so
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "bad-grammar"]);
// Safari (Mac, iPhone, iPad) ends a session after each phrase and its continuous mode is not dependable: one phrase a
// session there, joined. Chrome and Edge (and Chrome on Android) listen continuously.
export const isSafari = () => { const u = (typeof navigator === "object" && navigator.userAgent) || ""; return /safari/i.test(u) && !/chrome|chromium|crios|fxios|edg|android/i.test(u); };
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
// the final pieces of one session; Chrome on Android repeats them growing ("TDS", "TDS on rent"): the longer one kept
function finalsOf(list) {
  const out = [];
  list.forEach((x) => { const t = norm(x); if (!t) return; const last = out[out.length - 1]; if (last && t.toLowerCase().startsWith(last.toLowerCase())) out[out.length - 1] = t; else out.push(t); });
  return out;
}

const ERR = {
  "not-allowed": "The microphone is blocked for FinCom. Allow it in the browser's site settings, then tap the mic again.",
  "service-not-allowed": "Voice typing is switched off in this browser. Type the question instead.",
  "audio-capture": "No microphone was found on this device.",
  "network": "Voice typing needs the internet. Check the connection and try again.",
  "no-speech": "Nothing was heard. Tap the mic and speak.",
  "language-not-supported": "This browser cannot listen in that language. Choose another, or type.",
};

// the mic and the language, in the question box's bar; `a` is ASST's state (a.q the box, a.lang the hint)
export function VoiceInput({ a, onText, client = null }) {
  const [on, setOn] = useState(false), [msg, setMsg] = useState(""), [lang, setLang] = useState(voiceLang);
  // no microphone reached this browser (Remote Desktop, a cloud PC): "nodevice"; one that sent no sound: "silent"
  const [noDev, setNoDev] = useState("");
  const [none, setNone] = useState(() => !voiceSupported() && !seen(NONE_KEY));
  // the names corrected in the words last put in the box: [{from, to, open}], and where those words start
  const [fixes, setFixes] = useState({ list: [], at: 0 });
  const mine = useRef(null);
  a.lang = lang;
  useEffect(() => () => { if (live && live === mine.current) stopVoice(); }, []);
  useEffect(() => { if (voiceSupported()) loadRecorder(); }, []);
  if (!voiceSupported()) {
    return none ? <span className="asst-voice-msg" role="note" data-asst-voice-none="">Voice typing is not available in this browser (use Chrome, Edge or Safari).
      <button type="button" className="linkbtn" aria-label="Hide this note" onClick={() => { see(NONE_KEY); setNone(false); }}>×</button></span> : null;
  }
  const start = () => {
    if (on || live) { const s = live; live = null; if (s) s.finish("stop"); setOn(false); return; }
    const R = Rec();
    const base = String(a.q || "").replace(/\s+$/, ""), sep = base ? " " : "";
    setFixes({ list: [], at: 0 });
    // one listening: the words of the sessions ended (done), the current session's finals (cur) and its interim words
    const sess = { on: true, done: [], cur: [], interim: "", heard: false, at: Date.now(), quick: 0, rec: null, timer: null, mic: null, lang };
    const words = () => norm([...sess.done, ...sess.cur, sess.interim].join(" "));
    const show = () => { const w = words(); onText(w ? base + sep + w : base); };
    const keep = () => { const w = norm([...sess.cur, sess.interim].join(" ")); if (w) sess.done.push(w); sess.cur = []; sess.interim = ""; };
    sess.finish = (how) => {
      if (!sess.on) return;
      sess.on = false; clearTimeout(sess.timer);
      const r = sess.rec; sess.rec = null;
      keep(); show();
      if (r) { try { if (how === "abort") r.abort(); else r.stop(); } catch (e) { /* already stopped */ } }
      if (live === sess) live = null;
      if (mine.current === sess) { setOn(false); setMsg((m) => (m === NOTE || m === OPENING ? "" : m)); }   // the browser note goes with the listening it was for
      if (sess.mic) { if (how === "abort") sess.mic.abort(); else clearer(sess, words() ? base + sep + words() : base, base); }
    };
    // a pause after speech ends it (the timer starts again at every word heard)
    const arm = () => { clearTimeout(sess.timer); sess.timer = setTimeout(() => sess.finish("stop"), silenceMs()); };
    const begin = () => {
      let r;
      try { r = new R(); } catch (e) { setMsg("Voice typing could not start here."); sess.finish("abort"); return; }
      r.lang = byCode(lang).rec; r.interimResults = true; r.continuous = !isSafari(); r.maxAlternatives = 1;
      r.onresult = (ev) => {
        if (sess.rec !== r || !sess.on) return;
        const fin = []; let interim = "";
        for (let i = 0; i < ev.results.length; i++) { const x = ev.results[i]; if (x.isFinal) fin.push(x[0].transcript); else interim += x[0].transcript; }
        sess.cur = finalsOf(fin); sess.interim = norm(interim);
        if (sess.cur.length || sess.interim) { sess.heard = true; arm(); }
        show();
      };
      r.onerror = (ev) => {
        const e = ev && ev.error;
        if (sess.rec !== r || e === "aborted" || e === "no-speech") return;      // no-speech: the session ends and listening goes on
        setMsg(ERR[e] || "Voice typing stopped. Tap the mic to try again.");
        if (FATAL.has(e) || !ERR[e]) sess.finish("abort");
      };
      r.onend = () => {
        if (sess.rec !== r) return;
        keep(); show();
        if (!sess.on) return;
        // ended by the browser, not by the person: listen again (sessions ending at once, again and again, stop it)
        sess.quick = Date.now() - r.startedAt < 1000 ? sess.quick + 1 : 0;
        if (sess.quick >= 5) { setMsg("Voice typing keeps stopping in this browser. Tap the mic to try again."); sess.finish("stop"); return; }
        if (!sess.heard && Date.now() - sess.at > NOTHING_MS) { setMsg(ERR["no-speech"]); sess.finish("stop"); return; }
        begin();
      };
      sess.rec = r; r.startedAt = Date.now();
      try { r.start(); } catch (e) { sess.rec = null; setMsg("Voice typing could not start here."); sess.finish("abort"); }
    };
    stopVoice(); live = sess; mine.current = sess; setNoDev("");
    if (VR && VR.canRecord()) {
      sess.mic = VR.startRecording({ silenceMs: silenceMs(), onSilence: () => sess.finish("stop"), onError: (w) => { if (mine.current === sess) setMsg(w); },
        onNoDevice: () => { if (mine.current === sess) { setNoDev("nodevice"); setMsg((m) => (m === OPENING ? "" : m)); } },
        onReady: () => { if (mine.current === sess) setMsg((m) => (m === OPENING ? "" : m)); } });
    }
    if (!seen(NOTE_KEY)) { see(NOTE_KEY); setMsg(NOTE); } else setMsg(sess.mic ? OPENING : "");
    setTimeout(() => setMsg((m) => (m === OPENING ? "" : m)), 3000);     // a microphone that never answers: the browser's words go on
    setOn(true);
    begin();
  };
  // Whisper's words for what was just said; they replace the browser's only while the box still holds what was heard
  const clearer = (sess, shown, base) => {
    const sep = base ? " " : "";
    sess.mic.stop().then((clips) => {
      if (!clips.length || mine.current !== sess) return null;
      // the microphone sent no sound (a silent Remote Desktop microphone): nothing sent to be heard, the browser's words stay
      if (clips.quiet) { setNoDev("silent"); return null; }
      setMsg(BUSY);
      return VR.transcribe(clips, { lang: VR.whisperLang(sess.lang), client, latin: VR.whisperLatin ? VR.whisperLatin(sess.lang) : false }).then((r) => {
        const done = (m) => setMsg((x) => (x === BUSY ? m : x));
        if (mine.current !== sess || String(a.q || "") !== shown) { done(""); return; }   // a new listening, Ask, or the box changed
        if (r.ok) {
          if (r.text) { onText(base + sep + r.text); setFixes({ list: (r.changes || []).map((c) => ({ from: c.from, to: c.to, open: false })), at: (base + sep).length }); }
          done("");
        }
        else done(VR.KEPT[r.kind] || VR.KEPT.error);
      });
    }).catch(() => setMsg((x) => (x === BUSY ? VR.KEPT.error : x)));
  };
  // one tap: the heard words back in place of the corrected name (the first one at or after where Whisper's words start)
  const undo = (i) => {
    const f = fixes.list[i], q = String(a.q || ""), k = q.indexOf(f.to, Math.min(fixes.at, q.length));
    const at = k >= 0 ? k : q.indexOf(f.to);
    if (at >= 0) onText(q.slice(0, at) + f.from + q.slice(at + f.to.length));
    setFixes({ list: fixes.list.filter((_, j) => j !== i), at: fixes.at });
  };
  const peek = (i) => setFixes({ list: fixes.list.map((f, j) => (j === i ? Object.assign({}, f, { open: !f.open }) : f)), at: fixes.at });
  const shownFixes = on ? [] : fixes.list.map((f, i) => [f, i]).filter(([f]) => String(a.q || "").includes(f.to));
  const pick = (c) => { setLang(c); keepLang(c); a.lang = c; if (live) { const s = live; live = null; s.finish("stop"); setOn(false); } };
  return <>
    <span className="asst-voice" data-asst-voice="">
      <button type="button" className={"asst-act asst-mic" + (on ? " on" : "")} data-asst-mic="" aria-pressed={on} onClick={start}
        title={on ? "Stop listening" : "Speak your question (" + byCode(lang).label + ")"} aria-label={on ? "Stop listening" : "Speak your question"}>
        {on ? <><span className="asst-mic-pulse" aria-hidden="true" /><Square size={12} aria-hidden="true" fill="currentColor" /></> : <Mic size={16} aria-hidden="true" />}
      </button>
      <label className="sr-only" htmlFor="asstVoiceLang">Language for voice</label>
      <select id="asstVoiceLang" className="asst-lang" data-asst-lang="" value={lang} onChange={(e) => pick(e.target.value)} title="Language you speak (the reply comes in the question's language)">
        {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      {noDev === "nodevice" && <NoDeviceNote className="asst-nodev" />}
    </span>
    {noDev === "silent" && <span className="asst-voice-msg" role="status" data-asst-voice-silent="">{NO_SOUND_TEXT}<NoDeviceNote /></span>}
    {(on || msg) && <span className="asst-voice-msg" role="status" data-asst-voice-msg="">{msg || "Listening… speak; it keeps listening until you pause or tap the mic again."}</span>}
    {shownFixes.length > 0 && <span className="asst-voice-msg asst-voice-fixes" data-asst-voice-fixes="">
      <span>Names matched to the books:</span>
      {shownFixes.map(([f, i]) => <span key={i + f.to} className="asst-fix" data-asst-fix="">
        <button type="button" className="asst-fix-word" data-asst-fix-word="" aria-expanded={f.open} title={"Heard “" + f.from + "”"} onClick={() => peek(i)}>{f.to}</button>
        {f.open && <span className="asst-fix-heard" data-asst-fix-heard="">heard “{f.from}”</span>}
        <button type="button" className="asst-fix-undo" data-asst-fix-undo="" title={"Undo: put back “" + f.from + "”"} aria-label={"Undo " + f.to + ", put back " + f.from} onClick={() => undo(i)}>
          <Undo2 size={12} aria-hidden="true" /></button>
      </span>)}
    </span>}
  </>;
}

// the script a reply is written in decides the voice it is read with (Devanagari: Hindi, or Marathi if that was chosen)
const SCRIPTS = [[/[\u0A80-\u0AFF]/, "gu-IN"], [/[\u0980-\u09FF]/, "bn-IN"], [/[\u0B80-\u0BFF]/, "ta-IN"], [/[\u0C00-\u0C7F]/, "te-IN"],
  [/[\u0C80-\u0CFF]/, "kn-IN"], [/[\u0D00-\u0D7F]/, "ml-IN"], [/[\u0A00-\u0A7F]/, "pa-IN"]];
export function speechLang(text, chosen) {
  const s = String(text || "");
  for (const [re, c] of SCRIPTS) if (re.test(s)) return c;
  if (/[\u0900-\u097F]/.test(s)) return chosen === "mr-IN" ? "mr-IN" : "hi-IN";
  return "en-IN";
}
function voiceFor(code) {
  try {
    const vs = window.speechSynthesis.getVoices() || [], n = (v) => String(v.lang || "").replace("_", "-").toLowerCase();
    return vs.find((v) => n(v) === code.toLowerCase()) || vs.find((v) => n(v).startsWith(code.slice(0, 2).toLowerCase())) || null;
  } catch (e) { return null; }
}
// the words of a reply as they are read: no marks, no entry codes
const spoken = (s) => String(s || "").replace(/⟦F\d+⟧/g, "").replace(/\[V:([^|\]]+)\|([^\]]+)\]/g, "voucher $1").replace(/\[C:\d+\]/g, "").replace(/\*\*/g, "").replace(/^\s*[-•*]\s+/gm, "").replace(/#+\s*/g, "");
let speaking = null;
export function SpeakButton({ text }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => { if (speaking && speaking.stop === setOn) { try { window.speechSynthesis.cancel(); } catch (e) { /* none */ } speaking = null; } }, []);
  if (typeof window === "undefined" || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") return null;
  const go = () => {
    const ss = window.speechSynthesis;
    if (on) { try { ss.cancel(); } catch (e) { /* none */ } setOn(false); speaking = null; return; }
    try { ss.cancel(); } catch (e) { /* none */ }
    if (speaking) speaking.stop(false);
    const words = spoken(text), u = new window.SpeechSynthesisUtterance(words), code = speechLang(words, voiceLang()), v = voiceFor(code);
    u.lang = v ? v.lang : code; if (v) u.voice = v; u.rate = 1;
    u.onend = u.onerror = () => { setOn(false); if (speaking && speaking.u === u) speaking = null; };
    speaking = { u, stop: setOn };
    try { ss.speak(u); setOn(true); } catch (e) { setOn(false); }
  };
  return <button type="button" className="asst-act" data-asst-speak="" aria-pressed={on} onClick={go} title={on ? "Stop reading" : "Read the reply aloud"}>
    {on ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />} {on ? "Stop" : "Read aloud"}</button>;
}
