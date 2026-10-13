// Data minimisation before anything goes to Claude (the owner's council, 13-Oct-2026). Within one question:
//   - PANs, GSTINs, Aadhaar numbers, TANs and phone numbers become stable tokens (PAN_1, GSTIN_2, AADHAAR_1, TAN_1, PHONE_1);
//   - the names of the client's parties (customers, suppliers, people it borrowed from) become PARTY_1, ..., except a party
//     the question itself names;
//   - Claude's answer and every tool input it sends back are mapped back to the real values inside FinCom, before the user
//     sees them or a book tool runs.
// The tables shown to the user come straight from the books and are never masked. A notice the user attaches goes to
// Claude as it is (the user chose to send it), and the question is masked for identifiers only.
// Plain module: no Deno, no imports.

export const ID_PATTERNS: [string, RegExp][] = [
  ["GSTIN", /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g],
  ["PAN", /\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/g],
  ["TAN", /\b[A-Z]{4}\d{5}[A-Z]\b/g],
  ["AADHAAR", /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g],
  ["PHONE", /(?<![\d,.])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d,.])/g],
];
const TOKEN = /\b(GSTIN|PAN|TAN|AADHAAR|PHONE|PARTY)_\d{1,4}\b/g;
const STOP = new Set("the and of pvt private ltd limited llp co company & services service enterprises traders trading india industries associates sons bros brothers agency agencies corporation corp inc firm group loan a/c account".split(" "));

export class Masker {
  private real = new Map<string, string>();      // token -> real
  private tok = new Map<string, string>();       // kind|real -> token
  private n: Record<string, number> = {};
  private parties: string[] = [];                // longest first
  constructor(private question = "") {}

  token(kind: string, real: string): string {
    const k = kind + "|" + real;
    let t = this.tok.get(k);
    if (!t) { this.n[kind] = (this.n[kind] || 0) + 1; t = kind + "_" + this.n[kind]; this.tok.set(k, t); this.real.set(t, real); }
    return t;
  }
  // a party the question names (one of its words of four letters or more, not a common word, is in the question)
  named(name: string): boolean {
    const q = " " + this.question.toLowerCase().replace(/[^a-z0-9&]+/g, " ") + " ";
    const words = String(name).toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9&]+/).filter((w) => w.length >= 4 && !STOP.has(w));
    return words.length > 0 && words.some((w) => q.includes(" " + w + " "));
  }
  setParties(names: string[]) {
    this.parties = Array.from(new Set(names.map((s) => String(s || "").trim()).filter((s) => s.length >= 3 && !this.named(s)))).sort((a, b) => b.length - a.length);
  }
  partyList(): string[] { return this.parties.slice(); }
  text(s: string): string {
    let out = String(s ?? "");
    for (const [kind, re] of ID_PATTERNS) out = out.replace(re, (m) => this.token(kind, m));
    for (const p of this.parties) {
      if (!out.toLowerCase().includes(p.toLowerCase())) continue;
      const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      out = out.replace(re, () => this.token("PARTY", p));
    }
    return out;
  }
  // a value going to Claude: every string in it masked (keys kept)
  deep<T>(x: T): T {
    if (typeof x === "string") return this.text(x) as unknown as T;
    if (Array.isArray(x)) return x.map((v) => this.deep(v)) as unknown as T;
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, this.deep(v)])) as T;
    return x;
  }
  // back to the real values: Claude's text, a tool input
  unmask(s: string): string { return String(s ?? "").replace(TOKEN, (t) => this.real.get(t) ?? t); }
  undeep<T>(x: T): T {
    if (typeof x === "string") return this.unmask(x) as unknown as T;
    if (Array.isArray(x)) return x.map((v) => this.undeep(v)) as unknown as T;
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, this.undeep(v)])) as T;
    return x;
  }
  // streamed text: hold back a token cut in two (PAR|TY_1) until the next piece arrives
  private hold = "";
  stream(piece: string, end = false): string {
    const s = this.hold + piece;
    const m = end ? null : s.match(/(?:\b(?:G|GS|GST|GSTI|GSTIN|P|PA|PAN|PAR|PART|PARTY|T|TA|TAN|A|AA|AAD|AADH|AADHA|AADHAA|AADHAAR|PH|PHO|PHON|PHONE)(?:_\d{0,4})?)$/);
    const cut = m ? s.length - m[0].length : s.length;
    this.hold = s.slice(cut);
    return this.unmask(s.slice(0, cut));
  }
  flush(): string { const s = this.hold; this.hold = ""; return this.unmask(s); }
}
