// Numbers as the model or the user writes them for the report tools (projection.ts, reports.ts dcf_model): 12, "12%",
// "1,00,000", "₹5 lakh", "2 crore"; each checked against its range, the nearest bound used and said. Plain module.
export function numOf(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().replace(/[₹,\s]|rs\.?|inr|%/g, "");
  const m = /^(-?\d+(?:\.\d+)?)(lakhs?|lacs?|l|crores?|cr|k|thousand)?$/.exec(s);
  if (!m) return null;
  const k = m[2] ? (/^l/.test(m[2]) ? 1e5 : /^c/.test(m[2]) ? 1e7 : 1e3) : 1;
  const n = Number(m[1]) * k;
  return isFinite(n) ? n : null;
}
// one value in [lo, hi] (null when not given; a value that is not a number is left out and said)
export function oneOf(raw: unknown, lo: number, hi: number, words: string, notes: string[], int = false): number | null {
  if (raw == null || raw === "") return null;
  let v = numOf(raw);
  if (v == null) { notes.push(words + ": “" + String(raw).slice(0, 40) + "” is not a number, so FinCom's default is used."); return null; }
  if (int) v = Math.round(v);
  if (v < lo || v > hi) { const b = Math.max(lo, Math.min(hi, v)); notes.push(words + ": " + v + " is outside " + lo + " to " + hi + "; " + b + " is used."); v = b; }
  return v;
}
// a value for each year (a single value counts for every year), each in [lo, hi]; at most `max`
export function manyOf(raw: unknown, lo: number, hi: number, words: string, notes: string[], max = 5): number[] | null {
  if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) return null;
  const out: number[] = [];
  for (const x of (Array.isArray(raw) ? raw : [raw]).slice(0, max)) {
    const v = numOf(x);
    if (v == null) { notes.push(words + ": “" + String(x).slice(0, 40) + "” is not a number and is left out."); continue; }
    const b = Math.max(lo, Math.min(hi, v));
    if (b !== v) notes.push(words + ": " + v + " is outside " + lo + " to " + hi + "; " + b + " is used.");
    out.push(b);
  }
  return out.length ? out : null;
}
