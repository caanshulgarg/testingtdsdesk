// A request for the financial statements (the owner's report of 29-Oct-2026: "I have asked for provisional balance sheet
// … despite giving clear instruction it has not answered properly … multiple times I asked … no previous memory"). Any
// request for a balance sheet, the financial statements, a provisional or interim balance sheet, Schedule III, the notes,
// a P&L with the balance sheet, or last year's figures goes here: never to the keyword router's profit and loss, never to
// My MIS, and never to a model. FinCom answers with its own line and the statements card (app/src/parts/AssistantFs.jsx),
// which works the figures out with the Financial statements page's own engine (FinSt, src/js/88-fin-statements.js) in the
// browser, so every figure is the page's to the rupee, with "Open Financial statements" (the page's Period and Compare
// with set) and the page's own Download Excel and Download PDF.
// Plain module: no Deno, no imports (router.ts and agent.ts use it; the tests read it directly).

export type FsThread = { fs?: { from?: string | null, to?: string | null, cmp?: string | null, notes?: boolean | null } | null,
  files?: { path?: string, name?: string, type?: string, kind?: string, summary?: string }[] };
export type FsReq = {
  from: string | null, to: string | null, fy: string | null,     // YYYY-MM-DD; fy: the year the period belongs to ("2026" = 2026-27)
  cmp: "same" | "fy",                                              // compare with the same period last year (default) or the last full year
  notes: boolean, want: "xlsx" | "pdf" | null,                     // the notes on or off; a file asked for
  tallyDiff: boolean,                                              // "profit is different from Tally": the card's reconciliation
  pyAsked: boolean,                                                // last year's figures asked for, or the file attached earlier
  carried: boolean,                                                // the period of an earlier question of this conversation
  alt: { from: string, to: string } | null,                        // a date heard by voice that an earlier question said otherwise (3rd / 30th September)
  label: string,                                                   // "01-Apr-2026 to 30-Sep-2026"
};

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => y + "-" + pad(m) + "-" + pad(d);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fyOf = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return m >= 4 ? y : y - 1; };
export const dmy = (d: string | null | undefined) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + "-" + MON[Number(d.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase()) + "-" + d.slice(0, 4) : "";
const yearBack = (d: string) => { const y = Number(d.slice(0, 4)) - 1, m = Number(d.slice(5, 7)); return iso(y, m, Math.min(Number(d.slice(8, 10)), lastDay(y, m))); };

// ---------------------------------------------------------------- the words
const BS = /\bbalance\s*-?\s*sheets?\b|\bb\s*\/\s*s\b|\bbal(ance)?\.?\s*sheet\b/i;
const FSW = /\bfinancial\s+statements?\b|\bfinancials\b|\bfinal\s+accounts?\b|\bschedule\s*[-‐]?\s*(iii|3|three)\b|\bnotes\s+to\s+(the\s+)?accounts\b|\bfin\.?\s+statements?\b|\bfs\b/i;
// "provisional", as typed and as voice typing hears it ("Provencial", "provisonal")
const PROV = /\b(provisional|provisonal|provisinal|provissional|provisionl|provisnal|provencial|provencal|provincial|provicional|probisional|interim)\b/i;
const PL = /\b(profit\s*(and|&|n)\s*loss|p\s*&\s*l|p\s*and\s*l|p\s*n\s*l|pnl|income\s+statement)\b/i;
const LY = /\b(last|previous|prior|past)\s+(financial\s+)?year'?s?\s+(figures?|numbers?|comparatives?|columns?|amounts?|balances?)\b|\bpy\s+(figures?|columns?)\b|\bcomparatives?\b|\bprevious\s+period\s+figures?\b/i;
const NOTES = /\bnotes\b/i;
const ASKING = /\b(my|our|this client|prepare|make|making|give|need|want|show|build|bana\w*|create|generate|draw|send|get|download|excel|pdf)\b/i;
const LAWQ = /^\s*(what|why|how|explain|define|meaning|difference between)\b/i;
const OTHER_DOMAIN = /\b(tds|tcs|gst|gstr|26q|24q|27q|salary|payroll|26as|itc|2b)\b/i;
const FOLLOW = /\b(this|that|it|same|above|these|those|the statements?|the card)\b/i;
const FILE = /\b(excel|xlsx|spreadsheet|pdf|download|copy|file|print)\b/i;
// "profit is different from Tally"
const TALLY_DIFF = /\b(differ\w*|different|mismatch\w*|not\s+match\w*|doesn'?t\s+match|don'?t\s+match|not\s+tally\w*|wrong|not\s+same|not\s+agree\w*)\b[^.?!]{0,60}\btally\b|\btally\b[^.?!]{0,60}\b(differ\w*|different|mismatch\w*|shows?|says?|gives?)\b/i;
const ATTACHED = /\battach\w*\b|\bupload\w*\b|\bearlier\s+message\b|\bsent\s+(you\s+)?(earlier|before)\b|\baudited\b|\bfinal\s+balance\s+sheet\b/i;

// a request for the statements (not a question about the law: "what is Schedule III?" stays with the model)
export function fsAsked(q: string, thread?: FsThread | null): boolean {
  const s = String(q || "");
  if (!s.trim()) return false;
  if (LAWQ.test(s) && !ASKING.test(s)) return false;
  if (BS.test(s) || FSW.test(s)) return true;
  // "BS" for the balance sheet: in capitals, or beside a P&L, "provisional" or Schedule ("P&L with BS for H1")
  if (/\bBS\b/.test(s) || (/\bbs\b/i.test(s) && (PL.test(s) || PROV.test(s) || /\bschedule\b/i.test(s)))) return true;
  if (PROV.test(s) && (PL.test(s) || /\b(accounts?|statements?|figures|fs|bs)\b/i.test(s))) return true;
  if (PL.test(s) && (NOTES.test(s) || LY.test(s) || /\bschedule\b/i.test(s))) return true;
  if (LY.test(s) && !OTHER_DOMAIN.test(s)) return true;
  // a follow-up to the statements of this conversation: "I need excel copy of this", "with notes", "add last year"
  if (thread && thread.fs && ((FOLLOW.test(s) && FILE.test(s)) || NOTES.test(s) || /\bschedule\b/i.test(s) || /\b(comparatives?|last\s+year|previous\s+year)\b/i.test(s)
      || (datesIn(s, "2099-12-31").length > 0 && /\b(make|change|instead|for|till|until|upto|up\s+to|as\s+on|period)\b/i.test(s)))) return true;
  return false;
}

// ---------------------------------------------------------------- the dates
type Tok = { at: number, end: number, d: number, m: number, y: number | null };
export function datesIn(q: string, _anchor: string): Tok[] {
  const s = String(q || "").toLowerCase(), out: Tok[] = [];
  const add = (at: number, end: number, d: number, m: number, y: number | null) => { if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && !out.some((t) => at < t.end && end > t.at)) out.push({ at, end, d, m, y }); };
  const yr = (v: string | undefined) => v ? (v.length === 2 ? 2000 + Number(v) : Number(v)) : null;
  let m: RegExpExecArray | null;
  // 2026-04-01
  const isoRe = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = isoRe.exec(s))) add(m.index, m.index + m[0].length, Number(m[3]), Number(m[2]), Number(m[1]));
  // 01-04-2026, 1/4/26, 30.9.2026 (day first, as written in India)
  const num = /\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2}|\d{2})\b/g;
  while ((m = num.exec(s))) add(m.index, m.index + m[0].length, Number(m[1]), Number(m[2]), yr(m[3]));
  // 1st April 2026, 30th of September, 30 Sep, 2026, 01-Apr-2026 (FinCom's own), 30-sept-26
  const dm = new RegExp("\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?[\\s./-]*(?:of\\s+)?" + MONTH + "\\b\\.?,?[\\s./-]*(?:'?(20\\d{2}|\\d{2})\\b)?", "g");
  while ((m = dm.exec(s))) add(m.index, m.index + m[0].length, Number(m[1]), MON.indexOf(m[2].slice(0, 3)) + 1, yr(m[3]));
  // April 1, 2026; September 30
  const md = new RegExp("\\b" + MONTH + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?\\s*(?:(20\\d{2})\\b)?", "g");
  while ((m = md.exec(s))) add(m.index, m.index + m[0].length, Number(m[2]), MON.indexOf(m[1].slice(0, 3)) + 1, yr(m[3]));
  return out.sort((a, b) => a.at - b.at);
}
const fix = (y: number, m: number, d: number) => iso(y, m, Math.min(d, lastDay(y, m)));
// the date a token names: its own year, else the other token's (a period runs forwards), else the latest such date on or
// before the anchor (the last entry held, or today)
function resolve(t: Tok, anchor: string, other?: { y: number, m: number, d: number } | null, before = false): string {
  if (t.y) return fix(t.y, t.m, t.d);
  if (other) {
    const k = (t.m * 100 + t.d), ko = other.m * 100 + other.d;
    // a From without its year: the same year as To unless it falls after To in the calendar (then the year before)
    // a To without its year: the same year as From unless it falls before From (then the year after)
    const y = before ? (k <= ko ? other.y : other.y - 1) : (k >= ko ? other.y : other.y + 1);
    return fix(y, t.m, t.d);
  }
  const ay = Number(anchor.slice(0, 4));
  const d = fix(ay, t.m, t.d);
  return d <= anchor ? d : fix(ay - 1, t.m, t.d);
}

// the period a request names: a From-To range, "till/as on <date>" (the year's start to that date), H1, a quarter, nine
// months, a financial year, "year to date"; else none (the period of an earlier question, or the page's own choice)
export function fsPeriod(q: string, anchor: string): { from: string | null, to: string | null, named: boolean } {
  const s = String(q || "").toLowerCase();
  const ts = datesIn(s, anchor);
  if (ts.length >= 2) {
    const [a, b] = ts;
    let to = b.y ? resolve(b, anchor) : null, from = a.y ? resolve(a, anchor) : null;
    if (!to && from) to = resolve(b, anchor, { y: Number(from.slice(0, 4)), m: a.m, d: a.d });
    if (!from && to) from = resolve(a, anchor, { y: Number(to.slice(0, 4)), m: b.m, d: b.d }, true);
    if (!from || !to) { to = resolve(b, anchor); from = resolve(a, anchor, { y: Number(to.slice(0, 4)), m: b.m, d: b.d }, true); }
    if (from > to) [from, to] = [to, from];
    return { from, to, named: true };
  }
  if (ts.length === 1) {
    const t = ts[0], d = resolve(t, anchor), pre = s.slice(Math.max(0, t.at - 24), t.at);
    if (/\b(from|since|starting|beginning)\s*$/.test(pre)) return { from: d, to: anchor > d ? anchor : d, named: true };
    // "till 30th September", "as on 30-09-2026", "for the period ending", or a date alone: the year's start to that date
    return { from: iso(fyOf(d), 4, 1), to: d, named: true };
  }
  const fyNamed = (() => { const x = s.match(/\b(?:fy\s*)?(20\d{2})\s*[-–/]\s*(\d{2}|20\d{2})\b/); return x && (Number(x[2].slice(-2)) === (Number(x[1]) + 1) % 100) ? Number(x[1]) : null; })();
  const fy0 = fyNamed ?? fyOf(anchor);
  if (/\b(h1|first\s+half|half[- ]?year(ly)?|six\s+months|6\s+months)\b/.test(s)) return { from: iso(fy0, 4, 1), to: iso(fy0, 9, 30), named: true };
  if (/\b(h2|second\s+half)\b/.test(s)) return { from: iso(fy0, 10, 1), to: iso(fy0 + 1, 3, 31), named: true };
  if (/\b(nine|9)\s+months\b/.test(s)) return { from: iso(fy0, 4, 1), to: iso(fy0, 12, 31), named: true };
  const qm = s.match(/\bq([1-4])\b/) || s.match(/\b(first|second|third|fourth)\s+quarter\b/);
  if (qm) {
    const qn = /^\d$/.test(qm[1]) ? Number(qm[1]) : ["first", "second", "third", "fourth"].indexOf(qm[1]) + 1, sm = [4, 7, 10, 1][qn - 1], y = qn === 4 ? fy0 + 1 : fy0;
    return { from: iso(y, sm, 1), to: iso(y, sm + 2, lastDay(y, sm + 2)), named: true };
  }
  if (fyNamed != null) return { from: iso(fyNamed, 4, 1), to: iso(fyNamed + 1, 3, 31), named: true };
  if (/\b(year\s+to\s+date|ytd|till\s+date|to\s+date|so\s+far|till\s+now|up\s*to\s+(today|now))\b/.test(s)) return { from: iso(fyOf(anchor), 4, 1), to: anchor, named: true };
  return { from: null, to: null, named: false };
}

// a day heard by voice that an earlier question of the conversation said otherwise: "3rd September" after "30th
// September" (the same month and year, the earlier day 10x or 10x+1 the day heard)
function voiceAlt(to: string, earlier: string[]): string | null {
  const d = Number(to.slice(8, 10)), y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7));
  if (d > 3) return null;
  for (const e of earlier) {
    if (!e || e.slice(0, 7) !== to.slice(0, 7)) continue;
    const ed = Number(e.slice(8, 10));
    if ((ed === d * 10 || ed === d * 10 + 1) && ed <= lastDay(y, m)) return e;
  }
  return null;
}

export function fsRequest(q: string, o: { anchor: string, today?: string, thread?: FsThread | null, history?: { role: string, content: string }[] }): FsReq | null {
  const s = String(q || ""), thread = o.thread || null;
  if (!fsAsked(s, thread)) return null;
  const anchor0 = /^\d{4}-\d{2}-\d{2}$/.test(o.anchor || "") ? o.anchor : (o.today || new Date().toISOString().slice(0, 10));
  const prev = thread && thread.fs ? thread.fs : null;
  // the dates of the earlier questions (and the earlier statements) of this conversation
  const earlier: string[] = [];
  for (const h of (o.history || []).filter((h) => h.role === "user")) { const e = fsPeriod(h.content, anchor0); if (e.to) earlier.push(e.to); }
  if (prev && prev.to) earlier.push(prev.to);
  // a date without its year is read against the latest of the books held and the conversation's own dates ("till 30th
  // September" after the statements to 30-Sep-2026 is 2026's, even when the books held end in March)
  const anchor = earlier.reduce((a, e) => (e > a ? e : a), anchor0);
  const p = fsPeriod(s, anchor);
  let from = p.from, to = p.to, carried = false;
  if (!p.named && prev && prev.to) { from = prev.from || null; to = prev.to; carried = true; }
  const cmp: "same" | "fy" = /\b(last|previous)\s+full\s+year\b|\bfull\s+year\s+(comparative|figures|column)\b|\bcompare\s+with\s+(the\s+)?(last|previous)\s+(financial\s+)?year\b|\bas\s+(at|on)\s+31(st)?\s+march\b.*\b(last|previous)\s+year\b/i.test(s) ? "fy"
    : !p.named && prev && prev.cmp === "fy" ? "fy" : "same";
  const notes = /\b(without|no|skip|exclude|excluding)\s+(the\s+)?notes\b/i.test(s) ? false : (!p.named && prev && prev.notes === false && !NOTES.test(s) ? false : true);
  const want = /\b(excel|xlsx|spreadsheet|xls)\b/i.test(s) ? "xlsx" : /\bpdf\b/i.test(s) ? "pdf" : null;
  const alt = to && p.named ? voiceAlt(to, earlier.slice().reverse()) : null;
  return { from, to, fy: to ? String(fyOf(to)) : null, cmp, notes, want, tallyDiff: TALLY_DIFF.test(s), pyAsked: LY.test(s) || ATTACHED.test(s), carried,
    alt: alt && from ? { from, to: alt } : null, label: from && to ? dmy(from) + " to " + dmy(to) : "" };
}

// last year's balance sheet among the files of this conversation (the newest that reads as one): its name or what FinCom
// found it to be says balance sheet, financial statements, final accounts or audited; a PDF or a sheet
export function pyFileOf(files: { path?: string, name?: string, type?: string, kind?: string, summary?: string }[] | null | undefined) {
  const list = (files || []).filter((f) => f && f.path && /\.(pdf|xlsx|xls|csv)$/i.test(String(f.name || f.path)) && f.kind !== "notice"
    && /balance\s*sheet|\bbs\b|financial\s+statements?|final\s+accounts|audited|schedule\s*(iii|3)/i.test(String(f.name || "") + " " + String(f.summary || "")));
  const f = list[list.length - 1];
  return f ? { path: String(f.path), name: String(f.name || String(f.path).split("/").pop()), type: String(f.type || "") } : null;
}

// FinCom's own line above the card (no model): what it is, the period, the comparative, and what the card asks of the user
export function fsLine(r: FsReq, py: { name: string } | null): string {
  const per = r.from && r.to ? dmy(r.from) + " to " + dmy(r.to) : "", full = r.from && r.to && r.from.slice(5) === "04-01" && r.to.slice(5) === "03-31" && Number(r.to.slice(0, 4)) === Number(r.from.slice(0, 4)) + 1;
  const cmpWords = !r.from || !r.to ? "" : full ? "compared with the year before" : r.cmp === "same" ? "compared with the same period last year (" + dmy(yearBack(r.from)) + " to " + dmy(yearBack(r.to)) + ")"
    : "compared with the last full year (" + (Number(r.fy) - 1) + "-" + pad((Number(r.fy)) % 100) + "; its balance sheet as at 31-Mar-" + r.fy + ")";
  const out: string[] = [];
  out.push(per ? "Financial statements (Schedule III) for " + per + ", the balance sheet as on " + dmy(r.to) + (r.notes ? ", with the notes" : ", without the notes") + "; " + cmpWords + "."
    : "Financial statements (Schedule III)" + (r.notes ? ", with the notes" : "") + ", for the period chosen on the Financial statements page.");
  if (r.carried) out.push("The period is your earlier question's.");
  if (r.alt) out.push("You said " + dmy(r.to) + "; earlier you said " + dmy(r.alt.to) + ". Pick one below.");
  out.push("Every figure below is the Financial statements page's, from the books; nothing is estimated.");
  if (py) out.push("Last year's balance sheet you attached (" + py.name + "): read it below and confirm.");
  else if (r.pyAsked) out.push("No last year's balance sheet is attached in this conversation: upload it here or on the page, else FinCom uses its own copy of last year.");
  if (r.tallyDiff) out.push("Profit and Tally: compared below.");
  if (r.want === "xlsx") out.push("Download Excel is below.");
  else if (r.want === "pdf") out.push("Download PDF is below.");
  return out.join(" ");
}
