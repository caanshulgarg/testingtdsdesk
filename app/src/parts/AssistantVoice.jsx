// Ask FinCom by voice (the owner, 19-Oct-2026: "voice for Ask FinCom for browser as well as mobile; Hindi, English and
// Hinglish must; other regional languages would be an advantage"). The browser's own speech recognition (the Web Speech
// API: Chrome and Edge on a computer and Android, Safari on a Mac, iPhone and iPad) turns what is said into text in the
// question box, live; it stops on silence or a second tap, and nothing is asked until the person presses Ask (they can
// correct the words first). Where the browser has none (Firefox), the mic is not shown. The language chosen is kept for the
// person in this browser and goes with the question as a hint (ASST.st().lang): the reply comes in the question's language.
// "Read aloud" on a reply: the browser's speech, in the reply's language when the browser has a voice for it.
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, VolumeX } from "lucide-react";

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

// the one recognition at a time; Ask stops it (a word heard after Ask never lands in the next question)
let live = null;
export function stopVoice() { const r = live; live = null; if (r) { try { r.abort(); } catch (e) { /* already stopped */ } } }

const ERR = {
  "not-allowed": "The microphone is blocked for FinCom. Allow it in the browser's site settings, then tap the mic again.",
  "service-not-allowed": "Voice typing is switched off in this browser. Type the question instead.",
  "audio-capture": "No microphone was found on this device.",
  "network": "Voice typing needs the internet. Check the connection and try again.",
  "no-speech": "Nothing was heard. Tap the mic and speak.",
  "language-not-supported": "This browser cannot listen in that language. Choose another, or type.",
};

// the mic and the language, in the question box's bar; `a` is ASST's state (a.q the box, a.lang the hint)
export function VoiceInput({ a, onText }) {
  const [on, setOn] = useState(false), [msg, setMsg] = useState(""), [lang, setLang] = useState(voiceLang);
  const [none, setNone] = useState(() => !voiceSupported() && !seen(NONE_KEY));
  const mine = useRef(null);
  a.lang = lang;
  useEffect(() => () => { if (live && live === mine.current) stopVoice(); }, []);
  if (!voiceSupported()) {
    return none ? <span className="asst-voice-msg" role="note" data-asst-voice-none="">Voice typing is not available in this browser (use Chrome, Edge or Safari).
      <button type="button" className="linkbtn" aria-label="Hide this note" onClick={() => { see(NONE_KEY); setNone(false); }}>×</button></span> : null;
  }
  const start = () => {
    if (on || live) { stopVoice(); setOn(false); return; }
    const R = Rec(); let r;
    try { r = new R(); } catch (e) { setMsg("Voice typing could not start here."); return; }
    r.lang = byCode(lang).rec; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    const base = String(a.q || "").replace(/\s+$/, ""), sep = base ? " " : "";
    r.onresult = (ev) => {
      if (live !== r) return;
      let said = "";
      for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
      said = said.replace(/\s+/g, " ").trim();
      onText(said ? base + sep + said : base);
    };
    r.onerror = (ev) => { if (ev && ev.error !== "aborted") setMsg(ERR[ev && ev.error] || "Voice typing stopped. Tap the mic to try again."); };
    r.onend = () => { if (live === r) live = null; setOn(false); };
    stopVoice(); live = r; mine.current = r;
    if (!seen(NOTE_KEY)) { see(NOTE_KEY); setMsg("Voice is turned into text by your browser (Google/Apple)."); } else setMsg("");
    try { r.start(); setOn(true); } catch (e) { live = null; setMsg("Voice typing could not start here."); }
  };
  const pick = (c) => { setLang(c); keepLang(c); a.lang = c; if (live) { stopVoice(); setOn(false); } };
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
    </span>
    {(on || msg) && <span className="asst-voice-msg" role="status" data-asst-voice-msg="">{msg || "Listening… speak now; tap the mic again to stop."}</span>}
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
