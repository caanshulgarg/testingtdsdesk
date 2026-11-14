// The voice language (next-fix-voice, 14-Nov-2026: the owner speaks Hinglish and found the listening "very bad"; every
// clip went to Whisper as English, the picker's old default, and Whisper translated or mangled the Hindi). Plain functions,
// no React, so the Deno tests read them (server/fincom-transcribe/voice_app_test.ts).
// The default is "auto" (Hinglish, auto-detect): the browser listens as en-IN, Whisper finds the language itself and the
// words come back in English letters; once the live words look Hindi (Hinglish's own small words: hai, ka, mein, karo…, or
// any Devanagari), the clip goes as Hindi (still in English letters) and the question's hint is Hinglish. A language the
// person picks always wins and is kept (localStorage, per person, as before).

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

// Hinglish's own small words (never a word English uses too: "me", "to", "main", "par", "the" are left out)
const HI_WORDS = new Set(("hai hain hoga hogi tha thi ka ki ke ko se mein mai mujhe humko hamara hamare mera meri mere apna apni apne " +
  "aap tum kya kyon kyun kaise kitna kitni kitne kab kahan kaun kaunsa karo karna karke kar kardo kijiye dikhao batao bata bhejo nikalo " +
  "nahi nahin aur bhi wala wali wale liye chahiye raha rahi rahe abhi sab iska uska isme usme yeh ye woh wo agar lekin jab tak " +
  "hua hui hue diya diye liya kiya gaya gayi pichle pichla agle agla mahine saal din aaj kal").split(" "));
// the live words look Hindi: any Devanagari, or two of Hinglish's small words (one in a phrase of three words or fewer)
export function looksHindi(text) {
  const s = String(text || "");
  if (/[ऀ-ॿ]/.test(s)) return true;
  const words = s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hits = words.filter((w) => HI_WORDS.has(w)).length;
  return hits >= 2 || (hits >= 1 && words.length <= 3);
}

// what goes to Whisper (fincom-transcribe ?lang= &latin=): Hindi and English when chosen; Hinglish auto-detected with its
// words in English letters, as Hindi once the words looked Hindi; the other languages auto
export function whisperFor(code, hindi = false) {
  if (code === "hi-IN") return { lang: "hi", latin: false };
  if (code === "en-IN") return { lang: "en", latin: false };
  if (code === "hinglish" || code === "auto") return { lang: hindi ? "hi" : "auto", latin: true };
  return { lang: "auto", latin: false };
}
// the hint that goes with the question (the reply's language): auto is English until the words looked Hindi, then Hinglish
export const askLang = (code, hindi = false) => (code === "auto" ? (hindi ? "hinglish" : "en-IN") : code);
