// FinCom Assistant's checks on what Claude writes (the owner's rules of 13-Oct-2026: figures come from the books; "it should
// always match the FinCom data"):
//   - every figure in an answer is looked for in the book tools' results of the same turn; one not found is "not checked";
//   - every entry an AI answer cites ([V:<no>|<date>]) must be in the Day Book slice it read, else it is dropped;
//   - every figure Claude records (record_figures) is computed again by the book tool it names: the same figure is
//     "matches FinCom" (green); a different one is replaced by FinCom's, with the AI's struck out, and kept as a mismatch;
//   - a request to post, file, delete or change something is answered with the screen that does it.
// Plain module: no Deno, no imports.

export type Claim = { name: string, value: number, text: string, tool: string, input: Record<string, unknown>, field: string };
export type Verdict = Claim & { status: "match" | "mismatch" | "unchecked", fincom: number | null, why?: string, entries: string[], id: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
export const parseAmount = (s: string): number => Number(String(s).replace(/[₹,\s]|Rs\.?/g, ""));

// the figures written in a text: Indian or western grouped numbers (1,23,450 / 123,450), or any with ₹ / Rs, or with paise
// (.00). Plain numbers (years, section numbers, voucher numbers, 2025-26) are not figures.
const FIG = /(₹\s?|Rs\.?\s?|INR\s?)?(-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+\.\d{2}\b|(?<=₹\s?|Rs\.?\s?|INR\s?)-?\d+(?:\.\d{1,2})?)/g;
export function figuresIn(text: string): { text: string, value: number, at: number }[] {
  const out: { text: string, value: number, at: number }[] = [];
  const t = String(text || "").replace(/\[V:[^\]]*\]/g, (m) => " ".repeat(m.length)).replace(/⟦[^⟧]*⟧/g, (m) => " ".repeat(m.length));
  for (const m of t.matchAll(FIG)) {
    const v = parseAmount(m[2]);
    if (!isFinite(v) || Math.abs(v) < 100) continue;
    out.push({ text: m[0], value: round2(v), at: m.index || 0 });
  }
  return out;
}

// every number in a tool's result (the values of its rows and summary), as a set of absolute values to the paisa
export function numbersOf(x: unknown, into = new Set<number>()): Set<number> {
  if (typeof x === "number" && isFinite(x)) into.add(round2(Math.abs(x)));
  else if (typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x)) into.add(round2(Math.abs(Number(x))));
  else if (Array.isArray(x)) x.forEach((v) => numbersOf(v, into));
  else if (x && typeof x === "object") Object.values(x as Record<string, unknown>).forEach((v) => numbersOf(v, into));
  return into;
}

// figures of an answer that no book result of the turn holds (and no verdict covers)
export function uncheckedFigures(text: string, results: unknown[], verdicts: Verdict[]): { text: string, value: number }[] {
  const have = new Set<number>();
  results.forEach((r) => numbersOf(r, have));
  verdicts.filter((v) => v.fincom != null).forEach((v) => { have.add(round2(Math.abs(v.fincom as number))); if (v.status === "match") have.add(round2(Math.abs(v.value))); });
  return figuresIn(text).filter((f) => !have.has(round2(Math.abs(f.value)))).map((f) => ({ text: f.text, value: f.value }));
}

// citations: [V:<voucher no>|<YYYY-MM-DD>] must name an entry of the slices read in the turn. Those that do not are
// dropped from the text and listed
export function checkCitations(text: string, slices: { entries?: { no?: string, date?: string, guid?: string }[] }[]):
  { text: string, ok: { no: string, date: string, guid: string }[], dropped: { no: string, date: string }[] } {
  const have = new Map<string, string>();
  for (const s of slices) for (const e of s.entries || []) have.set(String(e.no || "").trim().toLowerCase() + "|" + String(e.date || ""), String(e.guid || ""));
  const ok: { no: string, date: string, guid: string }[] = [], dropped: { no: string, date: string }[] = [];
  const out = String(text || "").replace(/\[V:\s*([^|\]]{1,60})\|\s*(\d{4}-\d{2}-\d{2})\s*\]/g, (_m, no, date) => {
    const k = String(no).trim().toLowerCase() + "|" + date;
    if (have.has(k)) { if (!ok.some((x) => x.no === String(no).trim() && x.date === date)) ok.push({ no: String(no).trim(), date, guid: have.get(k) || "" }); return "[V:" + String(no).trim() + "|" + date + "]"; }
    dropped.push({ no: String(no).trim(), date });
    return "";
  });
  return { text: out.replace(/[ \t]{2,}/g, " "), ok, dropped };
}

// a field of a tool's result: summary.total, count, rows[<col>=<value>].<col>, rows[<n>].<col>, or a top-level key
export function fieldOf(result: Record<string, unknown>, path: string): { value: number | null, entries: string[] } {
  const rows = (Array.isArray(result?.rows) ? result.rows : Array.isArray(result?.entries) ? result.entries : []) as Record<string, unknown>[];
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  const guids = (rs: Record<string, unknown>[]) => rs.map((r) => String(r.guid || "")).filter(Boolean).slice(0, 50);
  const p = String(path || "").trim();
  let m = p.match(/^rows\[\s*(\d+)\s*\]\.(\w+)$/);
  if (m) { const r = rows[Number(m[1])]; return { value: r ? num(r[m[2]]) : null, entries: r ? guids([r]) : [] }; }
  m = p.match(/^rows\[\s*(\w+)\s*=\s*([^\]]+?)\s*\]\.(\w+)$/);
  if (m) {
    const want = m[2].replace(/^['"]|['"]$/g, "").trim().toLowerCase();
    let hit = rows.filter((r) => String(r[m![1]] ?? "").trim().toLowerCase() === want);
    if (!hit.length) hit = rows.filter((r) => String(r[m![1]] ?? "").toLowerCase().includes(want));
    if (!hit.length) return { value: null, entries: [] };
    const vals = hit.map((r) => num(r[m![3]])).filter((v) => v != null) as number[];
    return { value: vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null, entries: guids(hit) };
  }
  if (p === "count" || p === "rows.length") return { value: num(result.count) ?? rows.length, entries: guids(rows) };
  if (p === "rows.sum" || /^rows\.sum\((\w+)\)$/.test(p)) { const c = (p.match(/^rows\.sum\((\w+)\)$/) || [])[1] || "amount"; return { value: round2(rows.reduce((a, r) => a + (num(r[c]) || 0), 0)), entries: guids(rows) }; }
  let cur: unknown = result;
  for (const k of p.split(".")) { if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[k]; else { cur = undefined; break; } }
  return { value: num(cur), entries: guids(rows) };
}

// a recorded figure against the books: the same (to the rupee for amounts over 100, else exactly) is a match
export function compare(claim: Claim, fincom: number | null): "match" | "mismatch" | "unchecked" {
  if (fincom == null || !isFinite(claim.value)) return "unchecked";
  return Math.abs(Math.abs(round2(claim.value)) - Math.abs(round2(fincom))) < 0.995 ? "match" : "mismatch";
}

// the answer with each recorded figure marked where it is written: ⟦F<n>⟧ (the panel draws a green "matches FinCom" or
// FinCom's figure with the AI's struck out)
export function markFigures(text: string, verdicts: Verdict[]): string {
  let out = String(text || "");
  for (const v of verdicts) {
    if (v.status === "unchecked" || !v.text) continue;
    const i = out.indexOf(v.text);
    if (i >= 0) out = out.slice(0, i) + "⟦F" + v.id + "⟧" + out.slice(i + v.text.length);
  }
  return out;
}

// the user asks the assistant to change something: post, file, delete, edit, pass an entry. The answer says it cannot and
// names the screen
const ACTS: [RegExp, string][] = [
  [/\b(post|push|send)\b.{0,40}\b(to|in|into)\s+tally\b|\bpost (this|these|it|the|entries|bills|vouchers|entry)\b/i, "post_to_tally"],
  [/\b(file|submit|upload)\b.{0,30}\b(gstr|return|3b|gstr-?1|gstr-?3b|itr|26q|24q|27q|tds return)/i, "gst_filing"],
  [/\b(delete|remove|erase|cancel)\b.{0,40}\b(entry|entries|voucher|vouchers|bill|bills|duplicate|ledger|invoice|client)\b/i, "tally_ledgers"],
  [/\b(change|edit|alter|modify|correct|fix|rename|update)\b.{0,40}\b(entry|entries|voucher|vouchers|ledger|ledgers|books|amount|narration|setting|settings|gstin|pan)\b/i, "tally_ledgers"],
  [/\b(pass|make|create|book|record)\b.{0,20}\b(a |an |the )?(journal|entry|voucher|credit note|debit note)\b/i, "post_to_tally"],
  [/\b(pay|deposit)\b.{0,30}\b(tds|gst|challan|tax)\b/i, "tds_challans"],
];
export function actionAsked(q: string): { screen: string } | null {
  const s = String(q || "");
  if (/\b(how (do|to|can)|what is|explain|why)\b/i.test(s) && !/\b(please|now|for me)\b/i.test(s)) return null;   // a question about doing it, not a request to do it
  for (const [re, screen] of ACTS) if (re.test(s)) {
    if (screen === "tally_ledgers" && /\b(delete|remove|cancel)\b/i.test(s) && /\b(entry|entries|voucher|bill|duplicate|invoice)\b/i.test(s)) return { screen: "tally_sync" };
    if (screen === "gst_filing" && /\b(26q|24q|27q|tds)\b/i.test(s)) return { screen: "tds_returns" };
    return { screen };
  }
  return null;
}
