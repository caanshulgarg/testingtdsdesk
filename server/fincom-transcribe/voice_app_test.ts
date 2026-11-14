// deno test server/fincom-transcribe/voice_app_test.ts (run by tests/run_transcribe_server.py). The app's side of voice
// typing, as plain functions (next-fix-voice, 14-Nov-2026: the owner speaks Hinglish; every clip had gone as English):
// the default language (Hinglish · auto) and a choice kept; the switch to Hindi once the live words look Hindi; what goes
// to Whisper for each language; the bitrate asked of the recorder (AAC 96 kbps, opus 64 kbps); the screen's words.
import { askLang, byCode, DEFAULT_LANG, langOf, looksHindi, VOICE_LANGS, whisperFor } from "../../app/src/parts/voiceLang.js";
import { BITRATE, BITRATE_AAC, bitrateFor, recorderOptions, screenWords } from "../../app/src/parts/VoiceRecorder.js";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

Deno.test("the default language is Hinglish · auto; a choice kept wins", () => {
  eq([DEFAULT_LANG, VOICE_LANGS[0].code, byCode("auto").rec], ["auto", "auto", "en-IN"], "auto first, listened to as en-IN");
  eq([langOf(null), langOf(""), langOf("xx-YY")], ["auto", "auto", "auto"], "nothing kept (or nonsense): auto");
  eq([langOf("en-IN"), langOf("hi-IN"), langOf("hinglish"), langOf("ta-IN"), langOf("auto")], ["en-IN", "hi-IN", "hinglish", "ta-IN", "auto"], "a kept choice wins");
  for (const c of ["en-IN", "hi-IN", "hinglish", "mr-IN", "gu-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "pa-IN"]) assert(VOICE_LANGS.some((l) => l.code === c), "still offered: " + c);
});

Deno.test("the live words look Hindi: Hinglish's small words or Devanagari; English does not", () => {
  for (const t of ["mujhe last month ki GST payable kitna hai", "Richa ka ledger dikhao", "TDS kab bharna hai", "किराये पर टीडीएस", "ledger dikhao"]) assert(looksHindi(t), "Hindi: " + t);
  for (const t of ["", "show me the ledger of Richa", "what is the GST payable for last month", "main ledger to the bank", "TDS on rent", "par value of shares"]) assert(!looksHindi(t), "not Hindi: " + t);
});

Deno.test("what goes to Whisper, and the question's hint, for each language", () => {
  eq(whisperFor("auto"), { lang: "auto", latin: true }, "auto: Whisper finds the language, English letters");
  eq(whisperFor("auto", true), { lang: "hi", latin: true }, "auto, the words looked Hindi: as Hindi, English letters");
  eq(whisperFor("hinglish"), { lang: "auto", latin: true }, "Hinglish chosen: as before");
  eq(whisperFor("hinglish", true), { lang: "hi", latin: true }, "Hinglish chosen, Hindi heard: as Hindi, English letters");
  eq([whisperFor("en-IN", true), whisperFor("hi-IN")], [{ lang: "en", latin: false }, { lang: "hi", latin: false }], "English and Hindi chosen win, Hindi words or not");
  eq(whisperFor("ta-IN"), { lang: "auto", latin: false }, "another language: auto, its own script");
  eq([askLang("auto"), askLang("auto", true), askLang("en-IN", true), askLang("hi-IN")], ["en-IN", "hinglish", "en-IN", "hi-IN"], "the hint: auto as English until Hindi is heard; a choice as it is");
});

Deno.test("the bitrate asked of the recorder: Safari's AAC 96 kbps, opus 64 kbps", () => {
  eq([BITRATE, BITRATE_AAC], [64000, 96000], "64 and 96 kbps");
  eq([bitrateFor("audio/mp4"), bitrateFor("audio/mp4;codecs=mp4a.40.2"), bitrateFor("audio/webm;codecs=opus"), bitrateFor("audio/ogg;codecs=opus"), bitrateFor("")], [96000, 96000, 64000, 64000, 64000], "by type");
  eq(recorderOptions("audio/mp4"), { mimeType: "audio/mp4", audioBitsPerSecond: 96000 }, "Safari's options");
  eq(recorderOptions("audio/webm;codecs=opus"), { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 64000 }, "Chrome's options");
  eq(recorderOptions(""), { audioBitsPerSecond: 64000 }, "no type: the browser's own, at 64 kbps");
  for (const t of ["audio/mp4", "audio/webm"]) { const b = bitrateFor(t); assert(b >= 64000 && b <= 96000 && b * 55 / 8 < 5 * 1024 * 1024, "a 55 s piece well under 5 MB"); }
});

Deno.test("the open screen's words: the title and the section chosen, short", () => {
  const el = (t: string) => ({ textContent: t });
  const doc = { querySelectorAll: () => [el("Larkspur Traders"), el(" GST "), el("Larkspur Traders"), el("x".repeat(80)), el("Returns")] };
  eq(screenWords(doc), "Larkspur Traders · GST · Returns", "joined, no repeats, no long text");
  eq(screenWords(null), "", "no page");
});
