// The voice language (next-fix-voice, 14-Nov-2026: the owner speaks Hinglish and found the listening "very bad"; every
// clip went to Whisper as English, the picker's old default, and Whisper translated or mangled the Hindi). Plain functions,
// no React, so the Deno tests read them (server/fincom-transcribe/voice_app_test.ts).
// The default is "auto" (Hinglish, auto-detect): the browser listens as en-IN, Whisper finds the language itself with the
// Hinglish prompt in English letters (server/fincom-transcribe), and the words come back in English letters. It is never
// switched to Hindi by itself (the review, 14-Nov-2026: Whisper told Hindi writes the English accounting words in
// Devanagari); Hindi only when picked. A language the person picks always wins and is kept (localStorage, per person).

// code: what the browser listens for and what goes to fincom-assistant as the hint (server/assistant/agent.ts, LANGS)
export const VOICE_LANGS = [
  { code: "auto", label: "Hinglish · auto", rec: "en-IN" },   // the default: Whisper finds the language; English letters
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
export const DEFAULT_LANG = "auto";
export const byCode = (c) => VOICE_LANGS.find((l) => l.code === c) || VOICE_LANGS[0];
// the language kept for the person (a stored code), else the default
export const langOf = (stored) => (stored && VOICE_LANGS.some((l) => l.code === stored) ? stored : DEFAULT_LANG);

// what goes to Whisper (fincom-transcribe ?lang= &latin=): Hindi and English when chosen; Hinglish (auto or chosen)
// auto-detected, its words in English letters; the other languages auto in their own script
export function whisperFor(code) {
  if (code === "hi-IN") return { lang: "hi", latin: false };
  if (code === "en-IN") return { lang: "en", latin: false };
  if (code === "hinglish" || code === "auto") return { lang: "auto", latin: true };
  return { lang: "auto", latin: false };
}
// the hint that goes with the question (the reply's language): auto as English (the question's own words decide, as
// before: an Indian script is answered in it); a choice as it is
export const askLang = (code) => (code === "auto" ? "en-IN" : code);
