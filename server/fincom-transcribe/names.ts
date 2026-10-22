// Whisper's words, made right for an accountant (the owner, 22-Oct-2026: voice "still not good": wrong words and wrong
// client, ledger and party names). Plain module: no Deno, no imports; deterministic. Used by fincom-transcribe (index.ts):
//   - toLatin(text): Hindi in Devanagari written in English letters ("रिचा को एक लाख" -> "richa ko ek lakh"), for the
//     Hinglish choice when Whisper answers mostly in Devanagari; Devanagari digits become 0-9
//   - correctNames(text, names): each run of 1-4 words matched against the client's ledger and party names and the firm's
//     client names (an Indian-name-aware sound key plus the edit distance of the plain letters), and the firm's own words
//     ("teddy" -> Tally, "gst r1" -> GSTR-1); a run is replaced only on a confident, unique match, never one with a digit
//     unless the name has the same digits (an amount is never changed). -> {text, changes: [{from, to}], doubts: names
//     that came near but were not sure, for the optional AI step}
//   - checkAiFix(before, after, allowed): the AI step's answer is taken only when every number and number word is
//     unchanged and every new word is a name's or the firm's

// ------------------------------------------------------------------ Devanagari -> English letters
const CONS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y",
};
const NUKTA: Record<string, string> = { "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f", "य": "y" };
const VOWELS: Record<string, string> = { "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e" };
const MATRAS: Record<string, string> = { "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" };
const VIRAMA = "्", NUKTA_SIGN = "़";
const SIGNS: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h", "।": ".", "॥": ".", "ॐ": "om" };
const DEVA = /[ऀ-ॿ]/;

// one word: each consonant carries its "a" unless a vowel sign or the virama follows; the last "a" of a word of two or
// more letters is not said ("कर" kar, "लाख" lakh), and is dropped
function wordToLatin(w: string): string {
  const ch = [...w];
  let out = "", pendingA = false, letters = 0, pendAfterVowel = false;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c >= "०" && c <= "९") { if (pendingA) { out += "a"; pendingA = false; } out += String(c.charCodeAt(0) - 0x0966); continue; }
    if (CONS[c] !== undefined) {
      // the "a" of the consonant before is not said between a vowel and a consonant that has its own vowel sign
      // ("खंडेलवाल" khandelval, "समझना" samajhna)
      const nextSign = ch[i + 1] === NUKTA_SIGN ? ch[i + 2] : ch[i + 1];
      if (pendingA && !(pendAfterVowel && nextSign !== undefined && MATRAS[nextSign] !== undefined)) out += "a";
      let base = CONS[c];
      if (ch[i + 1] === NUKTA_SIGN) { base = NUKTA[c] ?? base; i++; }
      pendAfterVowel = /[aeiou]$/.test(out);
      out += base; pendingA = true; letters++;
      continue;
    }
    if (MATRAS[c] !== undefined) { out += MATRAS[c]; pendingA = false; continue; }
    if (c === VIRAMA) { pendingA = false; continue; }
    if (VOWELS[c] !== undefined) { if (pendingA) out += "a"; pendingA = false; out += VOWELS[c]; letters++; continue; }
    if (SIGNS[c] !== undefined) { if (pendingA) { out += "a"; pendingA = false; } out += SIGNS[c]; continue; }
    if (c === NUKTA_SIGN) continue;
    // punctuation ends the word: its last "a" as at the end
    if (pendingA && letters < 2) out += "a";
    pendingA = false; letters = 0;
    out += c;
  }
  if (pendingA && letters < 2) out += "a";      // "क" ka, "न" na; "कर" kar
  return out;
}
// the share of letters that are Devanagari (0-1)
export function devanagariShare(text: string): number {
  const letters = [...String(text || "")].filter((c) => /[\p{L}\p{M}]/u.test(c));
  if (!letters.length) return 0;
  return letters.filter((c) => DEVA.test(c)).length / letters.length;
}
export function toLatin(text: string): string {
  return String(text || "").split(/(\s+)/).map((w) => (DEVA.test(w) ? wordToLatin(w) : w)).join("");
}

// ------------------------------------------------------------------ matching
// the plain letters of a word or name: lower case, letters and digits only
export const plain = (s: string): string => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
// a sound key for Indian names written in English letters: the aspirates and the long vowels are one sound (kh k, aa a,
// ee i), w is v, z is j, then the vowels after the first letter go (Khandelwaal, Khandelwal and Kandelval meet; Leeds
// and Leads meet)
export function soundKey(s: string): string {
  let x = plain(s);
  if (!x) return "";
  x = x.replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u").replace(/ea/g, "i").replace(/ou/g, "u").replace(/a[iy]/g, "e").replace(/ey/g, "e")
    .replace(/ph/g, "f").replace(/bh/g, "b").replace(/dh/g, "d").replace(/th/g, "t").replace(/kh/g, "k").replace(/gh/g, "g").replace(/jh/g, "j")
    .replace(/sh/g, "s").replace(/ch/g, "C").replace(/ck/g, "k").replace(/c/g, "k").replace(/C/g, "c").replace(/q/g, "k").replace(/x/g, "ks")
    .replace(/w/g, "v").replace(/z/g, "j").replace(/y/g, "i");
  x = x.replace(/(.)\1+/g, "$1");
  const head = x[0], rest = x.slice(1).replace(/[aeiouh]/g, "");
  return (head + rest).replace(/(.)\1+/g, "$1");
}
export function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const digitsOf = (s: string) => (String(s).match(/\d+/g) || []).join(" ");

// everyday Hinglish and English words: a run with one of them is never a name unless the name has it too
export const STOP = new Set(("ka ke ki ko se me mein main mai par pe aur ya liye lie hai hain tha thi the hua hui kar karo karna karke karna kiya kya kitna kitne " +
  "kab ab abhi sab jo bhi ek do teen char paanch chhe saat aath nau das sau hazar hazaar lakh crore karod rupaye rupye rupees rupee rs " +
  "wala wali wale is us yeh ye wo woh unka uska mera meri hamara apna nahi nahin haan ji please the a an and of to for from in on at by " +
  "with is was are be this that it entry payment receipt bill invoice ledger voucher account amount balance tax gst tds tcs total " +
  "dikhao batao bata dikha chahiye hoga hogi diya diye liya liye gaya gayi").split(" "));

// the firm's own words, as Whisper and the browser mishear them (exact runs, lower case) -> the word
export const FIRM_ALIASES: Record<string, string> = {
  "teddy": "Tally", "tedi": "Tally", "tali": "Tally", "taly": "Tally", "telly": "Tally", "tely": "Tally", "taili": "Tally", "tailee": "Tally", "talli": "Tally", "tallie": "Tally",
  "gstr 1": "GSTR-1", "gstr1": "GSTR-1", "gst r1": "GSTR-1", "gst r 1": "GSTR-1", "gstr one": "GSTR-1", "gst r one": "GSTR-1", "gst are one": "GSTR-1", "gst r-1": "GSTR-1",
  "gstr 3b": "GSTR-3B", "gstr3b": "GSTR-3B", "gst r3b": "GSTR-3B", "gst r 3b": "GSTR-3B", "gstr 3 b": "GSTR-3B", "gst are 3b": "GSTR-3B", "gstr three b": "GSTR-3B", "gstr-3b": "GSTR-3B",
  "g s t": "GST", "jst": "GST", "t d s": "TDS", "t c s": "TCS",
  "lejar": "ledger", "lejer": "ledger", "lezer": "ledger", "ledgar": "ledger", "laijar": "ledger",
  "vouchar": "voucher", "vauchar": "voucher", "wouchar": "voucher", "vaucher": "voucher",
};
const LAKH_ALIASES = new Set(["lac", "lack", "lacs", "lak"]);
const NUM_WORDS = new Set("ek do teen tin char chaar paanch panch chhe chhah saat aath nau das gyarah barah bees pachas sau hazar hazaar lakh lac crore karod one two three four five six seven eight nine ten twenty fifty hundred thousand".split(" "));

export type Name = string | { name: string, group?: string };
type Variant = { key: string, plain: string, sound: string, tokens: string[], to: string, digits: string };
const nameOf = (n: Name) => String(typeof n === "string" ? n : (n && n.name) || "").replace(/\s+/g, " ").trim();

// the ways a name is said: as it is; without "A/c" (then the full name is written, as in Tally); without "Pvt Ltd",
// "Limited", "LLP" (then the name without it); without a "(...)" or an "@ 18%"
export function variantsOf(full: string): { said: string, to: string }[] {
  const out: { said: string, to: string }[] = [{ said: full, to: full }];
  const ac = full.replace(/\s*[-,(]?\s*\b(a\/c|a\.c\.?|ac|account)\b\.?\s*\)?\s*$/i, "").trim();
  if (ac && ac !== full) out.push({ said: ac, to: full });
  for (const base of [full, ac]) {
    if (!base) continue;
    const co = base.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s*@.*$/, "")
      .replace(/[\s,.]*\b(private|pvt\.?)\s*(limited|ltd\.?)\.?\s*$/i, "").replace(/[\s,.]*\b(limited|ltd\.?|llp|opc)\.?\s*$/i, "")
      .replace(/[\s,.]*(&|and)\s*co\.?\s*$/i, "").trim();
    if (co && co !== base) out.push({ said: co, to: base === ac && ac !== full ? full : co });
  }
  return out;
}
function variantList(names: Name[]): Variant[] {
  const seen = new Set<string>(), out: Variant[] = [];
  for (const n of names) {
    const full = nameOf(n);
    if (!full || DEVA.test(full)) continue;
    for (const v of variantsOf(full)) {
      const p = plain(v.said);
      const k = p + "|" + v.to;
      if (p.length < 4 || seen.has(k)) continue;
      const tokens = v.said.toLowerCase().split(/[\s/&.,()-]+/).map(plain).filter(Boolean);
      if (!tokens.length || tokens.every((t) => STOP.has(t))) continue;
      seen.add(k);
      out.push({ key: k, plain: p, sound: soundKey(v.said), tokens, to: v.to, digits: digitsOf(v.said) });
    }
  }
  return out;
}

// how sure a run of words is a variant: 1 the same letters; about 0.9 the same sound and close letters; 0 no
function score(spanTokens: string[], spanPlain: string, spanSound: string, spanDigits: string, v: Variant): number {
  if (spanDigits !== v.digits) return 0;
  if (Math.abs(spanTokens.length - v.tokens.length) > 1) return 0;
  // too different in length to be near (a quick test before the edit distance)
  if (spanPlain !== v.plain && Math.abs(spanPlain.length - v.plain.length) > Math.max(2, Math.ceil(0.34 * Math.max(spanPlain.length, v.plain.length)))) return 0;
  for (const t of spanTokens) if (STOP.has(t) && !v.tokens.includes(t)) return 0;
  if (spanPlain === v.plain) return 1;
  if (spanPlain.length < 4) return 0;
  const d = lev(spanPlain, v.plain), ratio = d / Math.max(spanPlain.length, v.plain.length);
  const sameSound = spanSound === v.sound;
  if (v.tokens.length === 1 && spanTokens.length === 1) return sameSound && d <= 1 && v.plain.length >= 6 ? 0.85 : 0;
  if (sameSound && ratio <= 0.34) return 0.95 - ratio;
  if (ratio <= 0.2 && d <= 2) return 0.85 - ratio;
  return 0;
}
// near but not sure (for the AI step's short list)
const near = (spanPlain: string, v: Variant, spanSound: string) => spanPlain.length >= 4 && (spanSound === v.sound ||
  (Math.abs(spanPlain.length - v.plain.length) <= 0.4 * Math.max(spanPlain.length, v.plain.length) && lev(spanPlain, v.plain) / Math.max(spanPlain.length, v.plain.length) <= 0.4));

export type Change = { from: string, to: string };
const core = (tok: string) => { const m = tok.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u)!; return { lead: m[1], body: m[2], tail: m[3] }; };

export function correctNames(text: string, names: Name[]): { text: string, changes: Change[], doubts: string[] } {
  const toks = String(text || "").split(/\s+/).filter(Boolean);
  const vars = variantList(names);
  // the names by the length of their letters (a run is compared only with names of about its length)
  const byLen = new Map<number, Variant[]>();
  for (const v of vars) { const l = byLen.get(v.plain.length); if (l) l.push(v); else byLen.set(v.plain.length, [v]); }
  const around = (len: number, k: number) => { const out: Variant[] = []; for (let l = Math.max(1, len - k); l <= len + k; l++) { const x = byLen.get(l); if (x) out.push(...x); } return out; };
  const out: string[] = [], changes: Change[] = [], doubts = new Set<string>();
  let i = 0;
  while (i < toks.length) {
    let done = false;
    for (let n = Math.min(4, toks.length - i); n >= 1 && !done; n--) {
      const span = toks.slice(i, i + n);
      if (span.some((t) => DEVA.test(t))) continue;
      const first = core(span[0]), last = core(span[n - 1]);
      // the words of the run (punctuation before the first and after the last kept as it is)
      const words = n === 1 ? first.body : [first.body, ...span.slice(1, -1), last.body].join(" ");
      if (/[.,;:!?]/.test(span.slice(0, -1).map((t) => core(t).tail).join(""))) continue;     // a run never crosses a full stop or a comma
      const spanTokens = words.toLowerCase().split(/[\s/&.,()-]+/).map(plain).filter(Boolean);
      const spanPlain = plain(words);
      if (!spanPlain) continue;
      let to = "";
      // the firm's words
      const alias = FIRM_ALIASES[words.toLowerCase().replace(/\s+/g, " ")];
      const prev = i > 0 ? plain(toks[i - 1]) : "";
      if (alias) to = alias;
      else if (n === 1 && LAKH_ALIASES.has(spanPlain) && (/^\d/.test(prev) || NUM_WORDS.has(prev))) to = "lakh";
      else {
        const ss = soundKey(words), sd = digitsOf(spanTokens.join(" "));
        const stops = spanTokens.filter((t) => STOP.has(t));
        const pool = around(spanPlain.length, Math.max(3, Math.ceil(spanPlain.length * 0.52))).filter((v) => stops.every((t) => v.tokens.includes(t)));
        const scored = pool.map((v) => ({ v, s: score(spanTokens, spanPlain, ss, sd, v) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        if (scored.length) {
          const best = scored[0], rival = scored.find((x) => x.v.to !== best.v.to);
          if (!rival || best.s - rival.s >= 0.1) to = best.v.to;
          else for (const x of scored.slice(0, 4)) doubts.add(x.v.to);
        } else if (!stops.length) {
          for (const v of pool) if (v.tokens.length === spanTokens.length && near(spanPlain, v, ss)) doubts.add(v.to);
        }
      }
      if (!to) continue;
      if (words === to) { out.push(...span); i += n; done = true; break; }        // already right
      // a single word that differs only in capitals is left as it is ("cash", "kumar"), but for the firm's own words
      if (n === 1 && words.toLowerCase() === to.toLowerCase() && !alias) { out.push(...span); i += n; done = true; break; }
      out.push(first.lead + to + last.tail);
      changes.push({ from: words, to });
      i += n; done = true;
    }
    if (!done) { out.push(toks[i]); i++; }
  }
  for (const c of changes) doubts.delete(c.to);
  return { text: out.join(" "), changes, doubts: [...doubts].slice(0, 8) };
}

// ------------------------------------------------------------------ the AI step's answer, checked
const numbersOf = (s: string) => {
  const toks = String(s || "").toLowerCase().split(/\s+/);
  const out: string[] = [];
  for (const t of toks) {
    for (const d of t.replace(/(\d),(?=\d)/g, "$1").match(/\d+(\.\d+)?/g) || []) out.push(d);
    const p = plain(t);
    if (NUM_WORDS.has(p)) out.push(p === "lac" ? "lakh" : p === "karod" ? "crore" : p);
  }
  return out.sort().join(" ");
};
// every number and number word unchanged; every new word one of the allowed (the names', the firm's); about the same length
export function checkAiFix(before: string, after: string, allowed: string[]): { ok: boolean, why?: string } {
  const a = String(after || "").replace(/\s+/g, " ").trim();
  if (!a) return { ok: false, why: "empty" };
  if (numbersOf(before) !== numbersOf(a)) return { ok: false, why: "numbers" };
  const bt = String(before).split(/\s+/).filter(Boolean), at = a.split(/\s+/);
  if (at.length < bt.length * 0.7 - 1 || at.length > bt.length * 1.3 + 3) return { ok: false, why: "length" };
  const have = new Map<string, number>();
  for (const t of bt) { const p = plain(t); if (p) have.set(p, (have.get(p) || 0) + 1); }
  const ok = new Set<string>();
  for (const w of [...allowed, ...Object.values(FIRM_ALIASES), "lakh", "crore", "rupees"]) for (const t of String(w).split(/[\s/&.,()-]+/)) { const p = plain(t); if (p) ok.add(p); }
  for (const t of at) {
    const p = plain(t);
    if (!p) continue;
    const n = have.get(p) || 0;
    if (n > 0) { have.set(p, n - 1); continue; }
    if (!ok.has(p)) return { ok: false, why: "word" };
  }
  return { ok: true };
}

// the words changed between two texts, as {from, to} runs (a word-level longest common subsequence)
export function diffWords(before: string, after: string): Change[] {
  const a = String(before || "").split(/\s+/).filter(Boolean), b = String(after || "").split(/\s+/).filter(Boolean);
  const m = a.length, n = b.length;
  if (m * n > 250_000) return [];
  const L = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Change[] = [];
  let i = 0, j = 0, fa: string[] = [], fb: string[] = [];
  const flush = () => { if (fa.length || fb.length) out.push({ from: fa.join(" "), to: fb.join(" ") }); fa = []; fb = []; };
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < n && (i >= m || L[i][j + 1] >= L[i + 1][j])) fb.push(b[j++]);
    else fa.push(a[i++]);
  }
  flush();
  return out.filter((c) => c.from && c.to);
}
