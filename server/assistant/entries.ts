// Entries drafted by Ask FinCom (the owner, 22-Oct-2026: he asked it to make entries for Leads Insurance in their Tally, or
// to prepare XML to upload, and it refused). Now the assistant DRAFTS them (draft_entries) and FinCom checks each draft
// here before it is shown: every ledger one of the client's Tally ledgers (the cloud copy, asst_ledger_pick of migration
// 88: the same name up to case, spacing, punctuation and the company's suffix), Dr equal to Cr on every voucher, the date
// a real date inside the books' period, the voucher type one Tally knows. The panel shows the draft as a preview the
// person corrects; nothing reaches Tally until the person presses "Post to Tally" on it (the existing posting route:
// Bridge.post, the cloud's queue) or downloads the Tally file. The assistant itself never posts.
// Plain module: no Deno, no imports.

export const VTYPES = ["Journal", "Payment", "Receipt", "Contra", "Sales", "Purchase", "Debit Note", "Credit Note"];
export const MAX_VOUCHERS = 25, MAX_LINES = 40;

// a request to make, pass or prepare entries (or the Tally XML for them), in English or Hinglish: drafted, not refused
// ("mujhe ... payment ki entry karni hai", "XML bana kar de sakte ho", "pass a journal entry", "entry kar do")
const NOUN = "(?:entry|entries|journal|journals|jv|jvs|vouchers?|credit note|debit note)";
const VERB = "(?:make|pass|create|book|record|prepare|draft|enter|put through|post|karni|karna|karne|karo|kar\\s*do|kardo|kar\\s*de|daal\\w*|dal\\w*|bana\\w*|chahiye)";
const ENTRY_BEFORE = new RegExp("\\b" + VERB + "\\b.{0,50}\\b" + NOUN + "\\b", "i");
const ENTRY_AFTER = new RegExp("\\b" + NOUN + "\\b.{0,30}\\b" + VERB + "\\b", "i");
const XML = /\bxml\b/i, XML_DO = /\b(make|prepare|create|generate|draft|give|send|bana\w*|de\s*(do|sakte|sakti|dena)|chahiye|upload|import)\b/i;
const XML_DATA = /\b(day ?book|masters?|trial balance|ledger list|export(ed)? from tally|not (a )?day ?book)\b/i;
const ABOUT = /^\s*(what('s| is| are)|how (do|does|to|can)|explain|why)\b/i;
export function entriesAsked(q: string): boolean {
  const s = String(q || "");
  if (ABOUT.test(s) && !/\b(please|for me|now|kar|bana)\b/i.test(s)) return false;     // a question about entries, not a request
  if (XML.test(s) && XML_DO.test(s) && !XML_DATA.test(s)) return true;
  return ENTRY_BEFORE.test(s) || ENTRY_AFTER.test(s);
}

export type LineIn = { ledger?: unknown, dr?: unknown, cr?: unknown };
export type VoucherIn = { type?: unknown, date?: unknown, narration?: unknown, lines?: unknown };
export type Line = { ledger: string, typed: string, known: boolean, choices: string[], dr: number, cr: number };
export type Voucher = { n: number, type: string, date: string, narration: string, lines: Line[], dr: number, cr: number, problems: string[] };
export type Pick = { ledger?: string | null, how?: string, ask?: boolean, choices?: string[], none?: boolean };
export type Checked = { ok: boolean, vouchers: Voucher[], problems: string[], fix: number[], noBooks: boolean, period: { from: string, to: string } | null };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dmy = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + "-" + MON[Number(d.slice(5, 7)) - 1] + "-" + d.slice(0, 4) : d;
export const inr = (n: number) => {
  const [i, f] = Math.abs(n).toFixed(2).split("."), last = i.slice(-3), rest = i.slice(0, -3);
  return (n < 0 ? "-" : "") + "₹" + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last + "." + f;
};
// to the paisa, half up ("1,234.505" -> 1234.51)
export const paisa = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*-?[\d,]*\.?\d+\s*$/.test(v) ? Number(v.replace(/[,\s]/g, "")) : 0;
  return isFinite(n) ? Math.round(parseFloat((n * 100).toFixed(6))) / 100 : 0;
};
const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

// the books' period for a draft: from the first book's start to the end of the financial year of today (a provision
// dated 31 March of this year is allowed; a date before the books begin is not)
export function booksPeriod(rows: { from?: unknown, to?: unknown }[], today: string): { from: string, to: string } | null {
  const starts = rows.map((r) => String(r.from || "").slice(0, 10)).filter(realDate).sort();
  if (!starts.length) return null;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return { from: starts[0], to: (m >= 4 ? y + 1 : y) + "-03-31" };
}

// FinCom's check of the vouchers the model drafted. pick: the client's ledger for a typed name (asst_ledger_pick)
export async function checkEntries(input: { vouchers?: unknown }, deps: { pick: (text: string) => Promise<Pick | null>, period: { from: string, to: string } | null }): Promise<Checked> {
  const all = Array.isArray(input?.vouchers) ? input.vouchers as VoucherIn[] : [];
  const problems: string[] = [], fix: number[] = [];
  if (!all.length) problems.push("No voucher was drafted.");
  if (all.length > MAX_VOUCHERS) problems.push("Only the first " + MAX_VOUCHERS + " vouchers were taken; ask for the rest separately.");
  const cache = new Map<string, Pick | null>();
  let noBooks = !deps.period;
  const pickOf = async (t: string) => {
    const k = t.toLowerCase();
    if (!cache.has(k)) { let p: Pick | null = null; try { p = await deps.pick(t); } catch { p = null; } cache.set(k, p); }
    return cache.get(k) || null;
  };
  const vouchers: Voucher[] = [];
  for (let i = 0; i < Math.min(all.length, MAX_VOUCHERS); i++) {
    const v = all[i] || {}, pr: string[] = [];
    let structural = false;
    const type = String(v.type ?? "").trim();
    const vt = VTYPES.find((t) => t.toLowerCase() === type.toLowerCase());
    if (!vt) pr.push("“" + (type || "(none)") + "” is not a voucher type FinCom drafts (" + VTYPES.join(", ") + ").");
    const date = String(v.date ?? "").trim();
    if (!realDate(date)) pr.push("“" + (date || "(none)") + "” is not a date (YYYY-MM-DD).");
    else if (deps.period && date < deps.period.from) pr.push("Dated " + dmy(date) + ", before the books begin (" + dmy(deps.period.from) + ").");
    else if (deps.period && date > deps.period.to) pr.push("Dated " + dmy(date) + ", after the end of this financial year (" + dmy(deps.period.to) + ").");
    const narration = String(v.narration ?? "").replace(/\s*\|?\s*TDSDesk:\S*/gi, "").replace(/\s+/g, " ").trim().slice(0, 500);
    const lin = (Array.isArray(v.lines) ? v.lines as LineIn[] : []);
    if (lin.length > MAX_LINES) pr.push("Only the first " + MAX_LINES + " lines were taken.");
    const lines: Line[] = [];
    for (let j = 0; j < Math.min(lin.length, MAX_LINES); j++) {
      const l = lin[j] || {}, typed = String(l.ledger ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const dr = paisa(l.dr), cr = paisa(l.cr);
      const name = typed || "(no ledger)";
      if (dr < 0 || cr < 0) { pr.push("Line " + (j + 1) + " (" + name + ") has a negative amount: put it on the other side."); structural = true; }
      else if (dr > 0 && cr > 0) { pr.push("Line " + (j + 1) + " (" + name + ") has both a debit and a credit."); structural = true; }
      else if (!dr && !cr) { pr.push("Line " + (j + 1) + " (" + name + ") has no amount."); structural = true; }
      let ledger = typed, known = false, choices: string[] = [];
      if (typed) {
        const p = await pickOf(typed);
        if (!p || p.none) noBooks = true;
        else if (p.ledger && p.how === "same") { ledger = String(p.ledger); known = true; }
        else choices = (p.ledger ? [String(p.ledger)] : []).concat((p.choices || []).map(String)).filter((x, k, a) => a.indexOf(x) === k).slice(0, 5);
      }
      if (!known) pr.push((typed ? "“" + typed + "” is not a ledger in the client's Tally" : "Line " + (j + 1) + " has no ledger") + (choices.length ? " (closest: " + choices.join(", ") + ")." : "."));
      lines.push({ ledger, typed, known, choices, dr: dr > 0 ? dr : 0, cr: cr > 0 ? cr : 0 });
    }
    if (lines.length < 2) { pr.push("A voucher needs at least two lines (a debit and a credit)."); structural = true; }
    const dr = paisa(lines.reduce((a, l) => a + l.dr, 0)), cr = paisa(lines.reduce((a, l) => a + l.cr, 0));
    if (Math.abs(dr - cr) >= 0.005) { pr.push("Dr " + inr(dr) + " is not equal to Cr " + inr(cr) + "."); structural = true; }
    if (structural) fix.push(i + 1);
    vouchers.push({ n: i + 1, type: vt || type, date, narration, lines, dr, cr, problems: pr });
  }
  if (noBooks) problems.push("FinCom has no Tally ledgers for this client in the cloud, so the ledgers cannot be checked. Link its Tally company first.");
  const ok = !noBooks && !problems.some((p) => /^No voucher/.test(p)) && vouchers.length > 0 && vouchers.every((v) => !v.problems.length);
  return { ok, vouchers, problems, fix, noBooks, period: deps.period };
}
