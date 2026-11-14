// CMA data, the past years (the owner, 14-Nov-2026): the figures of an uploaded balance sheet (audited or provisional
// accounts) and of an earlier CMA, mapped to the Schedule III lines projection.ts uses (FSX.LINES' ids), each year checked
// before it is used. The fsmap approach: map each row by its words, then tie the mapped lines to the file's own totals
// (total equity and liabilities, total assets, profit before and after tax) and the year's two sides to each other; a year
// that does not tie or balance is kept and shown with its gap, never hidden or forced.
//   - Excel and CSV: FinCom reads the cells itself (filetable.ts: every sheet, a formula's result, the units said on the
//     sheet: rupees, thousands, lakhs, crores). No AI.
//   - PDF (or a picture): the AI reads the figures as printed into a strict JSON schema (READ_SCHEMA; the only AI step of
//     the CMA, Sonnet at low effort, counted against the firm's cap); FinCom applies the units, maps nothing it was not
//     given and runs the same checks. Those figures are labelled "read by the AI".
// Plain module: filetable.ts's grids only.
import type { Grid } from "../filetable.ts";
import { ASSET, CYear, fyL as fyLabel, KIND_WORD, LIAB, Lines, pbtLines, PLK, sumOf, YKind } from "./cmaengine.ts";
// deno-lint-ignore no-explicit-any
const lineName = (id: string) => (((globalThis as any).FSX?.LINES || []).find((z: any) => z.id === id) || { face: id }).face;

export type FileKind = "cma" | "balance_sheet";
// stbUnknown: short-term borrowings that neither the lines nor the notes told apart (counted as bank borrowings, and said)
export type RYear = { fy: number, kind: YKind | "estimated", label: string, l: Lines, tot: { L?: number, A?: number, PBT?: number, PAT?: number }, bs: boolean, pl: boolean, unit: number, tol: number,
  stbUnknown?: number, stbFrom?: string,
  div?: number | null };
export type Tie = { year: string, head: string, file: number, mapped: number, gap: number, ok: boolean };
export type RFile = { name: string, path: string, kind: FileKind, by: "file" | "ai", years: RYear[], ties: Tie[], unplaced: string[], notes: string[] };

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const fyL = (y: number) => y + "-" + String((y + 1) % 100).padStart(2, "0");
const fyAt = (y: number, m: number) => (m >= 4 ? y : y - 1);
const y4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
// the financial year a column heading names: 2024-25, FY 2024-25, 2024-2025, FY25, 31.03.2025, 31-Mar-2025, 31st March
// 2025, As at 31 March 2025, Mar-25; null when it names none
export function yearOf(cell: unknown): number | null {
  const s = String(cell ?? "").toLowerCase().trim();
  if (!s || s.length > 60) return null;
  let m = /\b(20\d{2})\s*[-–\/]\s*(20\d{2}|\d{2})\b/.exec(s);
  if (m && Number(m[2].slice(-2)) === (Number(m[1]) + 1) % 100) return Number(m[1]);
  m = /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](20\d{2}|\d{2})\b/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return fyAt(y4(m[3]), Number(m[2]));
  m = new RegExp("\\b(?:\\d{1,2}\\s*(?:st|nd|rd|th)?[\\s.\\-/]*(?:of\\s+)?)?(" + MON.join("|") + ")[a-z]*\\.?[\\s,.\\-/']*(20\\d{2}|\\d{2})\\b").exec(s);
  if (m) return fyAt(y4(m[2]), MON.indexOf(m[1]) + 1);
  // "FY27-28", "FY 27–28": the year from 1 April 2027; "FY25" alone: the year to 31 March 2025
  m = /\bfy\s*'?(\d{2})\s*[-–—\/]\s*(\d{2})\b/.exec(s);
  if (m && Number(m[2]) === (Number(m[1]) + 1) % 100) return 2000 + Number(m[1]);
  m = /\bfy\s*'?(\d{2})\b/.exec(s);
  if (m) return 2000 + Number(m[1]) - 1;
  return null;
}
// a column's kind as written: "Actual" is not audited unless it says audited; no word at all is decided by the file (readGrids)
// (a bank CMA's short words too: "Aud.", "Prov.", "Est.", "Proj.")
const kindIn = (s: string): RYear["kind"] | null => /unaudited|provisional|\bprov\b/i.test(s) ? "provisional" : /\baudited\b|\baud\b/i.test(s) ? "audited" : /\bactuals?\b/i.test(s) ? "provisional" : /estimat|\best\b|\bestd\b/i.test(s) ? "estimated" : /project|\bproj\b/i.test(s) ? "projected" : null;
// a row of bare years as a bank CMA heads its columns ("Financial Year | 2019 | 2020 | … | 2030", numbers or text): each the
// year to 31 March of it (2025: the year 2024-25); two or more in a run, one apart, and no other figure in the row
export function bareYears(row: unknown[]): { c: number, fy: number }[] | null {
  const ys: { c: number, y: number }[] = [];
  for (let c = 1; c < row.length; c++) {
    const v = row[c], n = typeof v === "number" ? v : typeof v === "string" && /^\s*(19|20)\d{2}\s*$/.test(v) ? Number(v) : null;
    if (n != null && Number.isInteger(n) && n >= 1990 && n <= 2100) ys.push({ c, y: n });
    else if (typeof v === "number") return null;
  }
  if (ys.length < 2 || !ys.every((x, i) => i === 0 || Math.abs(x.y - ys[i - 1].y) === 1)) return null;
  return ys.map((x) => ({ c: x.c, fy: x.y - 1 }));
}
// the units a sheet states ("Rs. in lakhs", "(₹ in crore)", "Amount in '000")
export function unitOf(text: string): number {
  const s = String(text || "").toLowerCase();
  if (/\b(in|rs\.?|₹|inr)\s*(\w+\s+)?(crores?|cr\.?)\b|\(crores?\)|in\s+crore/.test(s)) return 1e7;
  if (/\b(in|rs\.?|₹|inr)\s*(\w+\s+)?(lakhs?|lacs?|lakh)\b|\(lakhs?\)|in\s+lakh/.test(s)) return 1e5;
  if (/\b(in|rs\.?|₹|inr)\s*(\w+\s+)?(millions?|mn)\b/.test(s)) return 1e6;
  if (/\b(in|rs\.?|₹|inr)\s*(\w+\s+)?(thousands?|'000|000s)\b|'000/.test(s)) return 1e3;
  return 1;
}

// ---------------------------------------------------------------- the words of each line
type Side = "L" | "A" | "P";
// a row that is a total, a sub-total, a ratio or a profit line: not a line of its own (some are kept as the file's totals)
const TOTAL_L = /^(total\s+(equity\s+and\s+liabilities|liabilities(\s+and\s+(equity|capital))?|sources\s+of\s+funds)|grand\s+total\s*(of\s+)?liabilities)/;
const TOTAL_A = /^(total\s+(assets|application\s+of\s+funds)|grand\s+total\s*(of\s+)?assets)/;
// ("Profit / (Loss)", "Profit (Loss)", "Profit/loss")
const PBT = /^(net\s+)?profit\s*(\/?\s*\(?loss\)?)?\s+before\s+tax|^pbt\b/;
const PAT = /^(net\s+)?profit\s*(\/?\s*\(?loss\)?)?\s+(after\s+tax|for\s+the\s+(year|period))|^pat\b|^net\s+profit\b(?!\s+as)/;
const SKIP = /\btotal\b|\bsub[- ]?total\b|\bratio\b|%|\brise\b|\bgrowth\b|\bmargin\b|\bnet\s+worth\b|\bnet\s+working\s+capital\b|\bworking\s+capital\s+gap\b|\bmpbf\b|\bpermissible\b|\b(gross|operating|net)\s+profit\b|\bprofit\s*(\/\s*\(?loss\)?\s*)?(before|after|for)\b|\bebitda\b|\bpbt\b|\bpat\b|\bcost\s+of\s+(production|sales)\b|\bretained\s+profit\b|\bearnings\s+per\s+share\b|\beps\b|\bebit\b|^net\s+of\b|\bholding\b|^\(?\s*(in\s+)?(months?|days)\b|\bin\s+(months|days)\b|\b(months|days)'|\b(months?|days)\s+(of|cost|sales|consumption|turnover)\b|\bsurplus\s*\(\+\)|\bdeficit\b|\bnumber\s+of\s+shares\b|\bface\s+value\b/;
// [words, line id, sides it may be on, sign]
const RULES: [RegExp, string, Side[], number?][] = [
  // balance sheet: liabilities
  [/share\s+capital|equity\s+share|ordinary\s+share|preference\s+share|share\s+application/, "share", ["L"]],
  [/partners'?\s*capital|proprietor'?s?\s*capital|capital\s+account|owner'?s?\s+capital|^capital$/, "capital", ["L"]],
  [/partners'?\s*current|^current\s+account/, "current", ["L"]],
  [/def+er+ed\s+tax\s+liabilit|^dtl\b/, "dtl", ["L"]],
  [/def+er+ed\s+tax\s+asset|def+er+ed\s+tax\s*\(net\)/, "dta", ["A"]],
  [/def+er+ed\s+revenue\s+expenditure/, "intang", ["A"]],
  [/reserves?|surplus|retained\s+earnings|share\s+premium|balance\s+(in|of)\s+(the\s+)?(statement\s+of\s+)?profit|profit\s+and\s+loss\s+account|securities\s+premium/, "reserves", ["L"]],
  [/instal+ments?\s+(of|on)\s+term\s+loans?|current\s+maturities|term\s+loans?\s+(due|repayable)\s+within/, "cm", ["L"]],
  [/short[- ]term\s+borrowings\s+from\s+(others|directors|partners|related)|(short[- ]term\s+)?loans?\s+(repayable\s+on\s+demand\s+)?from\s+(directors|partners|promoters|related\s+part|relatives|shareholders|members)/, "__stbo", ["L"]],
  [/borrowings\s+from\s+banks|bank\s+borrowings|cash\s+credit|overdraft|\bod\b|\bcc\b|working\s+capital\s+(loans?|limits?|borrowings?|demand)|bills\s+(purchased|discounted)|packing\s+credit|loans?\s+repayable\s+on\s+demand\s+from\s+banks/, "__stbbank", ["L"]],
  [/short[- ]term\s+borrowings|bank\s+borrowings|borrowings\s+from\s+banks|cash\s+credit|overdraft|working\s+capital\s+(loans?|limits?|borrowings?|demand)|bills\s+(purchased|discounted)|packing\s+credit/, "stb", ["L"]],
  [/long[- ]term\s+borrowings|term\s+loans?|loans?\s*-\s*(secured|unsecured)|debentures|secured\s+loans?|unsecured\s+loans?|deferred\s+payment\s+credits?|term\s+deposits|loans?\s+from\s+(directors|partners|promoters|relatives|related)|borrowings/, "ltb", ["L"]],
  [/other\s+long[- ]term\s+liabilities|other\s+term\s+liabilities/, "oltl", ["L"]],
  [/long[- ]term\s+provisions/, "ltp", ["L"]],
  [/trade\s+payables|outstanding\s+dues\s+of\s+(micro|creditors|msme)|sundry\s+creditors|creditors\s+for\s+(goods|purchases|raw)|trade\s+creditors|^creditors$/, "tp", ["L"]],
  [/provision\s+for\s+(tax|taxation|income[- ]?tax)|short[- ]term\s+provisions?|^provisions$/, "stp", ["L"]],
  [/other\s+current\s+liabilities|advances?\s+(payments?\s+)?(received\s+)?from\s+customers|statutory\s+(liabilities|dues|remittances)|remittances\s+payable|dividend\s+payable|other\s+liabilities|expenses\s+payable|creditors\s+for\s+expenses|deposits\s+from|duties\s+and\s+taxes|other\s+payables/, "ocl", ["L"]],
  // balance sheet: assets
  [/net\s+block|property,?\s+plant|(^|[^n])tangible\s+(fixed\s+)?assets|^fixed\s+assets$|fixed\s+assets\s*\(net\)/, "ppe", ["A"]],
  [/gross\s+block/, "__gb", ["A"]],
  [/depreciation|amorti[sz]ation/, "__ad", ["A"]],
  [/capital\s+work[- ]in[- ]progress|\bcwip\b/, "cwip", ["A"]],
  [/intangible|goodwill|preliminary\s+expenses|miscellaneous\s+expenditure/, "intang", ["A"]],
  [/non[- ]current\s+investments|investments?\s+in\s+(subsidiar|associat|group|joint)/, "nci", ["A"]],
  [/long[- ]term\s+loans\s+and\s+advances|advances\s+to\s+suppliers\s+of\s+capital|deferred\s+receivables|security\s+deposits|capital\s+advances/, "ltla", ["A"]],
  [/other\s+non[- ]current\s+assets|other\s+non[- ]current|investments?\s*\/\s*book\s*debts|debts?\s+outstanding\s+for\s+a\s+period\s+exceeding/, "onca", ["A"]],
  [/current\s+investments|^investments|government\s+securities/, "__inv", ["A"]],
  [/^advances?\s+(paid\s+)?to\s+suppliers/, "stla", ["A"]],
  [/inventor|stock[- ]in[- ]trade|^stocks?\b|closing\s+stock|raw\s+materials?|stock[- ]in[- ]process|work[- ]in[- ]progress|finished\s+goods|consumable\s+spares|stores\s+and\s+spares|spares/, "inv", ["A"]],
  [/trade\s+receivables|sundry\s+debtors|receivables|debtors|bills\s+receivable/, "tr", ["A"]],
  [/cash\s+and\s+(bank|cash\s+equivalents)|cash\s+(in|on)\s+hand|bank\s+balances?|balances?\s+with\s+banks|^cash\b|fixed\s+deposits?\s+with\s+banks/, "cash", ["A"]],
  [/short[- ]term\s+loans\s+and\s+advances|advances?\s+to\s+suppliers|advance\s+payment\s+of\s+tax|advance\s+tax|loans\s+and\s+advances|advances/, "stla", ["A"]],
  [/other\s+current\s+assets|prepaid|recoverable|other\s+receivables|gst\s+(input|receivable)|balances?\s+with\s+(revenue|government|statutory)|tds\s+receivable/, "oca", ["A"]],
  // the profit and loss / operating statement
  [/net\s+sales|revenue\s+from\s+operations|net\s+revenue|income\s+from\s+operations/, "rev", ["P"]],
  [/gross\s+sales|domestic\s+sales|export\s+sales|^sales|turnover|gross\s+receipts|sales\s+of\s+(products|services|goods)/, "__gs", ["P"]],
  [/excise\s+duty|less:?\s*(gst|duties)/, "__ed", ["P"]],
  [/other\s+(non[- ]operating\s+)?income|non[- ]operating\s+income|interest\s+income|interest\s+(received|earned)|dividend\s+income/, "oth", ["P"]],
  [/other\s+non[- ]operating\s+expenses|non[- ]operating\s+expenses|exceptional/, "exc", ["P"]],
  [/extraordinary|prior\s+period|prior\s+years?/, "xo", ["P"]],
  [/changes?\s+in\s+inventor|\(increase\)\s*\/?\s*decrease\s+in\s+(stock|inventor)|increase\s*\/\s*decrease\s+in\s+(stock|inventor)/, "chg", ["P"]],
  // a CMA's "add: opening stock / raw material / finished goods" and "less: closing …" (used only when the change itself is
  // not printed: readGrids)
  [/(add:?\s*)?opening\s+(stock|raw|finished|work|wip|inventor|goods)/, "__chgo", ["P"], 1],
  [/(deduct|less):?\s*closing\s+(stock|raw|finished|work|wip|inventor|goods)|^closing\s+(stock|raw|finished|inventor)/, "__chgo", ["P"], -1],
  [/cost\s+of\s+materials?\s+consumed|raw\s+materials?|materials?\s+consumed|consumption\s+of/, "mat", ["P"]],
  [/purchases?/, "pur", ["P"]],
  [/employee\s+benefits?|salar(y|ies)|wages|direct\s+labour|staff\s+(cost|welfare)|employee\s+cost/, "emp", ["P"]],
  [/finance\s+costs?|interest|bank\s+charges/, "fin", ["P"]],
  [/depreciation|amorti[sz]ation/, "dep", ["P"]],
  [/provision\s+for\s+tax|tax\s+expense|current\s+tax|deferred\s+tax|income[- ]?tax|^taxes?$|taxation/, "tax", ["P"]],
  [/dividend|drawings/, "__div", ["P"]],
  [/other\s+expenses|power\s+and\s+fuel|other\s+manufacturing|manufacturing\s+expenses|selling|general\s+and\s+admin|administrative|other\s+spares|repairs|rent|freight|expenses|\bexpense\b|marketing|advertis/, "exp", ["P"]],
];
const SHEET_P = /operating\s+statement|profit\s*(and|&)\s*loss|p\s*&\s*l|\bpl\b|\bpnl\b|income\s+statement|form\s*(ii|2)\b/i;
// a bank CMA's sheets by side ("Asset", "Liability", "Asset statement")
const SHEET_A = /^\s*assets?\b|asset\s+statement/i, SHEET_L = /^\s*liabilit|liability\s+statement/i;
// not a statement: the notes, the other forms, a CMA's own checks, indicators, holding levels, DSCR and revenue workings, a
// break-up of a line (its parts are read as notes: noteSplits)
const SHEET_SKIP = /\bnotes?\b|form\s*(i|1|iv|4|v|5|vi|6)\b|ratios?|mpbf|fund\s*s?\s*flow|assumptions|particulars|checks?|cash\s*flow|^\s*valid|\bkfi\b|key\s+financial|\bwcc\b|holding\s+levels?|\bdscr\b|offline|break[- ]?up|projections?\s+summary/i;
// a block heading inside a sheet: the form it starts (a CMA's forms stacked on one sheet), or the side of the balance sheet
type Sub = "CA" | "NCA" | "CL" | "NCL" | "NW" | null;
function heading(s: string): { side?: Side | null, sub?: Sub, skip?: boolean } | null {
  if (/form\s*(i|1|iv|4|v|5|vi|6)\b(?![\w-])|comparative\s+statement\s+of\s+current|computation\s+of\s+(mpbf|maximum)|maximum\s+permissible|fund\s*s?\s+flow|key\s+ratios|^ratios|particulars\s+of\s+(the\s+)?(existing|proposed)|assessment\s+of/i.test(s)) return { skip: true, side: null };
  if (/form\s*(ii|2)\b|operating\s+statement|statement\s+of\s+profit|profit\s+and\s+loss|^income$|^revenue$|^expenses$|^expenditure$/i.test(s)) return { side: "P", skip: false };
  if (/form\s*(iii|3)\b|analysis\s+of\s+balance\s+sheet/i.test(s)) return { side: null, skip: false };
  if (/non[- ]current\s+assets|not\s+current\s+assets|fixed\s+assets|other\s+non[- ]current/i.test(s)) return { side: "A", sub: "NCA", skip: false };
  if (/current\s+assets/i.test(s)) return { side: "A", sub: "CA", skip: false };
  if (/non[- ]current\s+liabilities|term\s+liabilities|long[- ]term\s+liabilities/i.test(s)) return { side: "L", sub: "NCL", skip: false };
  if (/current\s+liabilities/i.test(s)) return { side: "L", sub: "CL", skip: false };
  if (/net\s+worth|shareholders'?\s+funds|partners'?\s+funds|owners?'?\s+funds/i.test(s)) return { side: "L", sub: "NW", skip: false };
  if (/liabilit|shareholders|sources\s+of\s+funds|^equity/i.test(s)) return { side: "L", sub: null, skip: false };
  if (/^assets$|^assets\b|application\s+of\s+funds/i.test(s)) return { side: "A", sub: null, skip: false };
  return null;
}
const clean = (s: string) => String(s || "").toLowerCase().replace(/^\s*(\(?[a-z0-9]{1,4}[.)]|[ivx]+[.)])\s*/i, "").replace(/^\s*(\(?[a-z0-9]{1,4}[.)]|[ivx]+[.)])\s*/i, "").replace(/\s+/g, " ").trim();
export function lineFor(label0: string, side: Side | null, sub: Sub): { id: string, sign: number } | "skip" | null {
  // "total outstanding dues of micro and small enterprises / of creditors other than …": trade payables, not a total
  const s = clean(label0).replace(/^total\s+(outstanding\s+dues)/, "$1");
  if (!s) return null;
  // a CMA's net worth: "Surplus (+) or deficit (-) in Profit & Loss Account" is the reserves, not the fund flow's surplus
  if (side !== "P" && /surplus.*\b(in|of)\s+(the\s+)?(statement\s+of\s+)?profit\s*(&|and)\s*loss/.test(s)) return { id: "reserves", sign: 0 };
  if (SKIP.test(s)) return "skip";
  for (const [re, id, sides, sign] of RULES) {
    if (!re.test(s)) continue;
    if (side && !sides.includes(side)) continue;
    if (!side && sides.length === 1 && sides[0] === "P" && id !== "rev" && id !== "__gs") continue;   // a P&L word outside the P&L: not placed
    if (id === "__inv") return { id: sub === "NCA" || /non[- ]current|long[- ]term/.test(s) ? "nci" : "ci", sign: 1 };
    // receivables shown under the non-current assets (a CMA's debtors over six months)
    if (id === "tr" && sub === "NCA") return { id: "onca", sign: 0 };
    return { id, sign: sign || 0 };   // 0: as printed
  }
  return null;
}

// the part of the stock a row names (raw materials, stock-in-process, finished goods and stock-in-trade)
const invPart = (label: string): "inv_rm" | "inv_wip" | "inv_fg" | null => {
  const s = clean(label);
  return /raw\s+materials?|packing\s+materials?/.test(s) ? "inv_rm" : /work[- ]in[- ]progress|stock[- ]in[- ]process|semi[- ]finished|\bwip\b/.test(s) ? "inv_wip" : /finished\s+goods|stock[- ]in[- ]trade|traded\s+goods/.test(s) ? "inv_fg" : null;
};
// the notes (any sheet, a Notes sheet too): the short-term borrowings note's parts (current maturities of long-term debt,
// loans from directors and related parties, loans from banks) and the inventories note's (raw materials, stock-in-process,
// finished goods), by year; a block runs from its heading to its total or the next note
type Split = { cm: number, stbo: number, bank: number, inv_rm: number, inv_wip: number, inv_fg: number };
export function noteSplits(grids: Grid[]): Map<number, Split> {
  const out = new Map<number, Split>();
  const at = (fy: number) => { let x = out.get(fy); if (!x) { x = { cm: 0, stbo: 0, bank: 0, inv_rm: 0, inv_wip: 0, inv_fg: 0 }; out.set(fy, x); } return x; };
  for (const g of grids) {
    if (!/\bnotes?\b|schedules?|break[- ]?up/i.test(g.name) && !g.rows.some((r) => r.some((x) => typeof x === "string" && /^\s*note\s*\d+/i.test(x)))) continue;
    const unit = unitOf(g.name + " " + g.rows.slice(0, 15).flat().filter((x) => typeof x === "string").join(" "));
    let cols: { c: number, fy: number }[] = [], block: "stb" | "inv" | null = null;
    for (const row of g.rows) {
      const ys = row.map((x, c) => ({ c, fy: typeof x === "string" && c >= 1 && x.length <= 40 ? yearOf(x) : null })).filter((x) => x.fy != null) as { c: number, fy: number }[];
      if (ys.length && !row.some((x) => typeof x === "number")) { cols = ys; continue; }
      const first = cols.length ? Math.min(...cols.map((x) => x.c)) : row.length;
      const label = clean(row.slice(0, Math.max(1, first)).filter((x) => typeof x === "string").join(" "));
      if (!label) continue;
      if (/short[- ]term\s+borrowings/.test(label) && !/^total/.test(label)) { block = "stb"; continue; }
      if (/^(inventor|stocks?\b)/.test(label) || /^note\s*\d+\W*\s*inventor/.test(label)) { block = "inv"; continue; }
      if (/^total\b/.test(label) || /^note\s*\d+/.test(label)) { block = null; continue; }
      if (!block || !cols.length) continue;
      for (const col of cols) {
        const v = row[col.c];
        if (typeof v !== "number" || !isFinite(v)) continue;
        const x = v * unit, sp = at(col.fy);
        if (block === "stb") {
          if (/current\s+maturit|instal+ments?\s+(of|on|due)/.test(label)) sp.cm += x;
          else if (/director|partner|promoter|related|relative|shareholder|member|proprietor/.test(label)) sp.stbo += x;
          else if (/bank|cash\s+credit|overdraft|\bod\b|\bcc\b|packing\s+credit|bills/.test(label)) sp.bank += x;
        } else {
          const part = invPart(label);
          if (part) sp[part] += x;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- a file's sheets
type Acc = RYear & { gb: number, ad: number, gs: number, ed: number, got: Set<string>, stbGen: number, chgo: number };
export function readGrids(name: string, path: string, grids: Grid[], hint: FileKind | "" = ""): RFile {
  const notes: string[] = [], unplaced: string[] = [];
  const allText = grids.map((g) => g.name + " " + g.rows.slice(0, 40).flat().filter((x) => typeof x === "string").join(" ")).join(" ");
  const isCma = hint === "cma" || (hint !== "balance_sheet" && /\bcma\b|credit\s+monitoring|operating\s+statement|analysis\s+of\s+balance\s+sheet|\bmpbf\b|form\s*(ii|iii)\b/i.test(allText));
  const kind: FileKind = isCma ? "cma" : "balance_sheet";
  const per: Map<number, Acc> = new Map();
  // a column with no kind written: audited only when the file says so (and not "unaudited"); else provisional
  const fileKind: RYear["kind"] = /\baudited\b/i.test(allText) && !/unaudited|provisional/i.test(allText) ? "audited" : "provisional";
  const useSheets = grids.filter((g) => !SHEET_SKIP.test(g.name) || /form\s*(ii|iii|2|3)\b/i.test(g.name));
  for (const g of (useSheets.length ? useSheets : grids)) {
    const unit = unitOf(g.name + " " + g.rows.slice(0, 15).flat().filter((x) => typeof x === "string").join(" "));
    let side: Side | null = SHEET_P.test(g.name) ? "P" : SHEET_A.test(g.name) ? "A" : SHEET_L.test(g.name) ? "L" : null, sub: Sub = null, skip = false;
    let cols: { c: number, fy: number, kind: RYear["kind"], label: string }[] = [];
    // the text rows just above (a heading over several rows: "Short-term borrowings from banks (including bills …)"), for a
    // row that names only its part ("(i) From banks"); and the line a row's parts follow (a row ending ":" or "(specify)", or
    // one followed by "(a) …", "(b) …" rows that add up to it): its parts are not counted again
    let above = "", lastNum = false;
    let parent: { id: string, colon: boolean, rem: Map<number, number>, tol: number } | null = null;
    const setSide = (h: ReturnType<typeof heading>) => { if (!h) return; if (h.skip !== undefined) skip = h.skip; if (h.side !== undefined) side = h.side; if (h.sub !== undefined) sub = h.sub ?? null; };
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      // a heading row of years (again at each form stacked on the sheet): "2024-25", "31-03-2025", or a CMA's bare years
      const bare = bareYears(row);
      const ys = bare ? bare.map((x) => ({ c: x.c, fy: x.fy as number | null, t: String(row[x.c] ?? "") }))
        : row.map((x, c) => ({ c, fy: typeof x === "string" && c >= 1 && x.length <= 40 ? yearOf(x) : null, t: String(x ?? "") })).filter((x) => x.fy != null);
      if (ys.length >= 1 && (bare || row.filter((x) => typeof x === "number").length === 0)) {
        cols = ys.map((x) => {
          const near = [r - 2, r - 1, r, r + 1, r + 2].map((k) => String(g.rows[k]?.[x.c] ?? "")).join(" ");
          return { c: x.c, fy: x.fy as number, kind: kindIn(near) || fileKind, label: bare ? fyL(x.fy as number) : x.t.trim() };
        });
        parent = null; above = "";
        continue;
      }
      // a heading before the years' row (the form's title above it) still sets the form and the side
      if (!cols.length) {
        const t = row.filter((x) => typeof x === "string").join(" ").trim();
        if (t && !row.some((x) => typeof x === "number")) setSide(heading(t));
        continue;
      }
      const first = Math.min(...cols.map((x) => x.c));
      const raw = row.slice(0, first).filter((x) => typeof x === "string" && !/^\s*(note|sch(edule)?\.?)\s*(no\.?)?\s*\d*\s*$/i.test(x)).join(" ").trim();
      const label = raw;
      const nums = cols.map((x) => row[x.c]).filter((v) => typeof v === "number");
      if (!label) continue;
      if (!nums.length) {
        if (kindIn(label) && label.length < 30) continue;
        above = lastNum ? label : (above + " " + label).trim().slice(0, 240);
        lastNum = false;
        setSide(heading(label));
        continue;
      }
      lastNum = true;
      if (skip) continue;
      const s = clean(label);
      // a bare "Total" closes the side it is on (a balance sheet whose "Total liabilities" is a heading above it)
      const bareTotal = /^(grand\s+)?total$/.test(s) && (side === "L" || side === "A") ? side : null;
      const ratio = /%|\/\s*(sales|revenue|turnover)|\bratio\b/.test(s);
      const totals = ratio ? null : bareTotal || (TOTAL_L.test(s) ? "L" : TOTAL_A.test(s) ? "A" : side === "P" || !side ? (PBT.test(s) ? "PBT" : PAT.test(s) ? "PAT" : null) : null);
      let hit = totals ? "skip" as const : lineFor(label, side, sub);
      // the parts of the line just above: not counted again
      const child = /^\s*(\(\s*[a-z]{1,2}\s*\)|\(\s*[ivx]{1,4}\s*\.?\s*\)|[a-z]\)|[ivx]{1,4}\))/i.test(label);
      const vals = new Map<number, number>();
      for (const col of cols) { const v = row[col.c]; if (typeof v === "number" && isFinite(v)) vals.set(col.c, v); }
      const sameLine = hit === null || hit === "skip" || (typeof hit === "object" && hit.id === parent?.id);
      if (parent && sameLine && !totals && (parent.colon || child) && [...vals].every(([c, v]) => Math.abs(v) <= Math.max(0, Math.abs(parent!.rem.get(c) ?? 0)) + parent!.tol)) {
        for (const [c, v] of vals) parent.rem.set(c, (parent.rem.get(c) ?? 0) - v);
        continue;
      }
      parent = null;
      // a row naming only its part ("(i) From banks"): read with the heading above it
      if (hit === null && above && (child || /^\)?\s*(from|secured|unsecured)\b/.test(s))) {
        const part = label.replace(/^\s*\(?[a-z0-9.]{1,4}\)\s*/i, "");
        // "(ii) From others" under "Short-term borrowings from banks": the borrowings from others, not the bank's
        const h2 = /borrowings|loans?/i.test(above) && /^\s*from\s+(others|directors|partners|promoters|related|relatives|shareholders)/i.test(part) ? { id: "__stbo", sign: 0 } : lineFor(above + " " + part, side, sub);
        if (h2 && h2 !== "skip") hit = h2;
      }
      // a bank CMA's net worth: what is not share capital is the reserves (excess provision, share premium, "others")
      if (hit === null && sub === "NW" && side === "L") hit = { id: "reserves", sign: 0 };
      if (hit === "skip" && !totals) continue;
      if (hit === null) {
        const h = heading(label);
        if (h) { setSide(h); continue; }
        if (unplaced.length < 12 && !unplaced.includes(label)) unplaced.push(label.slice(0, 80));
        continue;
      }
      if (typeof hit === "object" && hit !== null) {
        if (/[:\/]\s*$|\(\s*(please\s+)?specify\s*\)\s*$/i.test(label)) parent = { id: hit.id, colon: true, rem: new Map(vals), tol: unit === 1 ? 2 : unit * 0.006 };
        else if (!child) parent = { id: hit.id, colon: false, rem: new Map(vals), tol: unit === 1 ? 2 : unit * 0.006 };
      }
      for (const col of cols) {
        const v = row[col.c];
        if (typeof v !== "number" || !isFinite(v)) continue;
        let a = per.get(col.fy * 10 + (col.kind === "projected" || col.kind === "estimated" ? 1 : 0));
        if (!a) {
          a = { fy: col.fy, kind: col.kind, label: col.label, l: {}, tot: {}, bs: false, pl: false, unit, tol: unit === 1 ? 2 : unit * 0.06, gb: 0, ad: 0, gs: 0, ed: 0, got: new Set(), div: null, stbGen: 0, chgo: 0 };
          per.set(col.fy * 10 + (col.kind === "projected" || col.kind === "estimated" ? 1 : 0), a);
        }
        const x = v * unit;
        if (totals) { (a.tot as any)[totals] = x; continue; }
        const { id, sign } = hit as { id: string, sign: number };
        if (id === "__gb") { a.gb += x; continue; }
        if (id === "__ad") { a.ad += Math.abs(x); continue; }
        if (id === "__gs") { a.gs += x; a.pl = true; continue; }
        if (id === "__ed") { a.ed += Math.abs(x); continue; }
        if (id === "__div") { a.div = (a.div || 0) + Math.abs(x); continue; }
        // opening stock added, closing taken off: used only when the change itself is not printed
        if (id === "__chgo") { a.chgo += sign * Math.abs(x); a.pl = true; continue; }
        // short-term borrowings: from banks (named so), from directors and related parties, or not told apart (stbGen)
        const to = id === "__stbo" ? (sub === "NCL" ? "ltb" : "stbo") : id === "__stbbank" ? "stb" : id;
        if (id === "stb") a.stbGen += x;
        // the change in inventories as printed ((20): the stock rose, less cost)
        a.l[to] = (a.l[to] || 0) + (to === "chg" && sign ? sign * Math.abs(x) : x);
        if (to === "inv") { const part = invPart(label); if (part) a.l[part] = (a.l[part] || 0) + x; }
        a.got.add(to);
        if (LIAB.includes(to) || ASSET.includes(to)) a.bs = true; else a.pl = true;
      }
    }
  }
  const years: RYear[] = [], ties: Tie[] = [];
  const split = noteSplits(grids);
  for (const a of [...per.values()].sort((p, q) => p.fy - q.fy)) {
    if (!a.got.has("ppe") && a.gb) a.l.ppe = a.gb - a.ad;
    // the notes' split of short-term borrowings (current maturities, related parties) and of the stock
    const sp = split.get(a.fy);
    if (sp && a.stbGen > 0) {
      const cm = Math.min(sp.cm, a.stbGen), ot = Math.min(sp.stbo, a.stbGen - cm);
      if (cm) { a.l.stb -= cm; a.l.cm = (a.l.cm || 0) + cm; }
      if (ot) { a.l.stb -= ot; a.l.stbo = (a.l.stbo || 0) + ot; }
      a.stbGen = Math.max(0, a.stbGen - cm - ot - sp.bank);
      a.stbFrom = "the notes";
    }
    if (sp && a.l.inv && a.l.inv_rm == null && a.l.inv_wip == null && a.l.inv_fg == null) for (const k of ["inv_rm", "inv_wip", "inv_fg"] as const) if (sp[k]) a.l[k] = sp[k];
    if (a.stbGen > a.tol) a.stbUnknown = a.stbGen;
    if (!a.got.has("rev") && a.gs) a.l.rev = a.gs - a.ed;
    if (!a.got.has("chg") && a.chgo) a.l.chg = a.chgo;
    if (!a.bs && !a.pl) continue;
    const { gb: _gb, ad: _ad, gs: _gs, ed: _ed, got: _got, stbGen: _sg, chgo: _co, ...y } = a;
    years.push(y);
    const yl = fyL(a.fy) + (a.kind === "projected" || a.kind === "estimated" ? " (" + a.kind + ")" : "");
    const tie = (head: string, file: number | undefined, mapped: number) => { if (file != null) ties.push({ year: yl, head, file, mapped, gap: mapped - file, ok: Math.abs(mapped - file) <= a.tol }); };
    if (a.bs) {
      tie("Total equity and liabilities", a.tot.L, sumOf(a.l, LIAB));
      tie("Total assets", a.tot.A, sumOf(a.l, ASSET));
      ties.push({ year: yl, head: "Assets = liabilities (as mapped)", file: sumOf(a.l, LIAB), mapped: sumOf(a.l, ASSET), gap: sumOf(a.l, ASSET) - sumOf(a.l, LIAB), ok: Math.abs(sumOf(a.l, ASSET) - sumOf(a.l, LIAB)) <= a.tol });
    }
    if (a.pl) { tie("Profit before tax", a.tot.PBT, pbtLines(a.l)); tie("Profit after tax", a.tot.PAT, pbtLines(a.l) - (a.l.tax || 0)); }
  }
  if (!years.length) notes.push(name + ": no year's figures could be read (no column headed with a year, such as 2024-25 or 31-03-2025).");
  if (unplaced.length) notes.push(name + ": " + unplaced.length + " row" + (unplaced.length > 1 ? "s" : "") + " with figures not placed in a line (" + unplaced.slice(0, 4).join("; ") + (unplaced.length > 4 ? "; …" : "") + "): check the year's ties.");
  return { name, path, kind, by: "file", years, ties, unplaced, notes };
}

// ---------------------------------------------------------------- a PDF read by the AI (strict schema)
export const LINE_IDS = [...LIAB.filter((k) => k !== "stbo" && k !== "cm"), ...ASSET, "rev", "oth", "mat", "pur", "chg", "emp", "fin", "dep", "exp", "exc", "xo", "tax"];
// parts of a line, usually from the notes: of stb, the current maturities of long-term debt and the loans from directors /
// related parties in it; of inv, its raw materials, stock-in-process and finished goods
export const PART_IDS = ["stb_current_maturities", "stb_related_parties", "inv_raw_materials", "inv_stock_in_process", "inv_finished_goods"];
const nul = (t: string) => ({ type: ["number", "null"], description: t });
export const READ_SCHEMA = {
  type: "object", additionalProperties: false, required: ["document", "unit", "years"],
  properties: {
    document: { type: "string", enum: ["balance_sheet", "cma", "other"], description: "audited or provisional financial statements, an earlier CMA for a bank, or neither" },
    unit: { type: "string", enum: ["rupees", "thousands", "lakhs", "crores", "millions"], description: "the units the amounts are printed in" },
    years: { type: "array", items: { type: "object", additionalProperties: false, required: ["column", "kind", "lines", "parts", "total_liabilities", "total_assets", "profit_before_tax", "profit_after_tax"],
      properties: {
        column: { type: "string", description: "the column's heading as printed, with its year or date (e.g. 'As at 31 March 2025', '2024-25 Audited')" },
        kind: { type: "string", enum: ["audited", "provisional", "estimated", "projected"] },
        lines: { type: "object", additionalProperties: false, required: LINE_IDS, properties: Object.fromEntries(LINE_IDS.map((k) => [k, nul(k)])) },
        parts: { type: "object", additionalProperties: false, required: PART_IDS, properties: Object.fromEntries(PART_IDS.map((k) => [k, nul(k + ", included in its line (null when the document does not show it)")])) },
        total_liabilities: nul("total equity and liabilities as printed"), total_assets: nul("total assets as printed"),
        profit_before_tax: nul("as printed"), profit_after_tax: nul("as printed"),
      } } },
  },
};
export const READ_PROMPT = "Read the financial statements (or the CMA's operating statement and analysis of balance sheet) in this document. For each year column, give each line's amount exactly as printed, in the document's own units (say which in unit), one number per line id, null when the document has no such line. " +
  "Line ids (Schedule III): share = share capital; capital = partners'/proprietor's capital; current = partners' current accounts; reserves = reserves and surplus; ltb = long-term borrowings (term loans, unsecured loans); dtl = deferred tax liability; oltl = other long-term liabilities; ltp = long-term provisions; " +
  "stb = short-term borrowings (bank borrowings for working capital); tp = trade payables; ocl = other current liabilities (incl. instalments of term loans due within a year); stp = short-term provisions (incl. provision for tax); ppe = property, plant and equipment, net block; intang = intangible assets; cwip = capital work-in-progress; nci = non-current investments; dta = deferred tax asset; ltla = long-term loans and advances; onca = other non-current assets; " +
  "ci = current investments; inv = inventories (all kinds together); tr = trade receivables; cash = cash and bank balances; stla = short-term loans and advances; oca = other current assets; rev = revenue from operations (net sales); oth = other income; mat = cost of materials consumed; pur = purchases of stock-in-trade; chg = change in inventories (positive when stock fell); emp = employee costs; fin = finance costs; dep = depreciation; exp = other expenses; exc = exceptional items; xo = extraordinary items; tax = tax expense. " +
  "Parts (usually in the notes; null when not shown): stb_current_maturities and stb_related_parties are the amounts INSIDE stb that are current maturities of long-term debt and loans from directors, partners or related parties; inv_raw_materials, inv_stock_in_process and inv_finished_goods are the parts of inv. " +
  "Put each printed figure in exactly one line; never add, estimate or work out a figure that is not printed, except to add the parts of one line printed separately (for example raw materials, stock-in-process and finished goods together as inv). Give the printed totals as printed. Expenses as positive numbers.";
const UNITS: Record<string, number> = { rupees: 1, thousands: 1e3, lakhs: 1e5, crores: 1e7, millions: 1e6 };
// the AI's answer, read strictly: every figure a finite number within bounds, the units applied, a column's year from its
// heading (a column whose year cannot be read is left out and said); then the same ties as a sheet's
export function readAi(name: string, path: string, text: string): RFile {
  const notes: string[] = [];
  let j: any = null;
  try { j = JSON.parse(String(text || "").replace(/^```(json)?|```$/g, "").trim()); } catch { j = null; }
  const out: RFile = { name, path, kind: "balance_sheet", by: "ai", years: [], ties: [], unplaced: [], notes };
  if (!j || typeof j !== "object" || !Array.isArray(j.years)) { notes.push(name + ": the AI's reading could not be used (not in the schema); upload it as Excel, or check it is a balance sheet or CMA."); return out; }
  if (j.document === "other") { notes.push(name + ": the AI found no balance sheet or CMA in it."); return out; }
  out.kind = j.document === "cma" ? "cma" : "balance_sheet";
  const unit = UNITS[String(j.unit)] || 1;
  const ok = (v: unknown) => typeof v === "number" && isFinite(v) && Math.abs(v) < 1e13;
  for (const y of j.years.slice(0, 8)) {
    const fy = yearOf(y && y.column);
    if (fy == null) { notes.push(name + ": a column (" + String(y && y.column || "").slice(0, 40) + ") names no year; left out."); continue; }
    const l: Lines = {};
    let bad = 0;
    for (const k of LINE_IDS) { const v = y.lines ? y.lines[k] : null; if (v == null) continue; if (!ok(v)) { bad++; continue; } l[k] = v * unit; }
    if (bad) notes.push(name + ", " + fyL(fy) + ": " + bad + " figure(s) the AI gave were not numbers; left out.");
    // the parts: moved out of short-term borrowings (never more than it), the stock's split kept as memo
    const P = (k: string) => (y.parts && ok(y.parts[k]) ? Math.abs(y.parts[k]) * unit : 0);
    let stbUnknown: number | undefined;
    if (l.stb) {
      const cm = Math.min(P("stb_current_maturities"), l.stb), ot = Math.min(P("stb_related_parties"), l.stb - cm);
      if (cm) { l.stb -= cm; l.cm = cm; }
      if (ot) { l.stb -= ot; l.stbo = ot; }
      // both parts given (0 included): the split is known; none given: it could not be told apart
      const given = (k: string) => !!y.parts && ok(y.parts[k]);
      if (!given("stb_current_maturities") && !given("stb_related_parties")) stbUnknown = l.stb;
    }
    if (l.inv) { if (P("inv_raw_materials")) l.inv_rm = P("inv_raw_materials"); if (P("inv_stock_in_process")) l.inv_wip = P("inv_stock_in_process"); if (P("inv_finished_goods")) l.inv_fg = P("inv_finished_goods"); }
    const kind = ["audited", "provisional", "estimated", "projected"].includes(y.kind) ? y.kind : "audited";
    const bs = LIAB.concat(ASSET).some((k) => k in l), pl = ["rev", "oth", "mat", "pur", "emp", "fin", "dep", "exp", "tax"].some((k) => k in l);
    const tot = { L: ok(y.total_liabilities) ? y.total_liabilities * unit : undefined, A: ok(y.total_assets) ? y.total_assets * unit : undefined,
      PBT: ok(y.profit_before_tax) ? y.profit_before_tax * unit : undefined, PAT: ok(y.profit_after_tax) ? y.profit_after_tax * unit : undefined };
    out.years.push({ fy, kind, label: String(y.column).slice(0, 60), l, tot, bs, pl, unit, tol: unit === 1 ? 2 : unit * 0.06, stbUnknown });
    const yl = fyL(fy) + (kind === "projected" || kind === "estimated" ? " (" + kind + ")" : "");
    const tie = (head: string, file: number | undefined, mapped: number) => { if (file != null) out.ties.push({ year: yl, head, file, mapped, gap: mapped - file, ok: Math.abs(mapped - file) <= (unit === 1 ? 2 : unit * 0.06) }); };
    if (bs) { tie("Total equity and liabilities", tot.L, sumOf(l, LIAB)); tie("Total assets", tot.A, sumOf(l, ASSET)); out.ties.push({ year: yl, head: "Assets = liabilities (as read)", file: sumOf(l, LIAB), mapped: sumOf(l, ASSET), gap: sumOf(l, ASSET) - sumOf(l, LIAB), ok: Math.abs(sumOf(l, ASSET) - sumOf(l, LIAB)) <= (unit === 1 ? 2 : unit * 0.06) }); }
    if (pl) { tie("Profit before tax", tot.PBT, pbtLines(l)); tie("Profit after tax", tot.PAT, pbtLines(l) - (l.tax || 0)); }
  }
  return out;
}

// ---------------------------------------------------------------- the past years: which source each year takes, and the differences
type Cand2 = { pri: number, src: string, kind: CYear["kind"], l: Lines, tol: number, bs: boolean, pl: boolean, div?: number | null, tot?: RYear["tot"], stbUnknown?: number };
const BS_KEYS = [...LIAB, ...ASSET], MEMO = ["inv_rm", "inv_wip", "inv_fg"];
const rupees = (v: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v));
export function pastYears(files: RFile[], books: CYear[], open: number, notes: string[]): { years: CYear[], diffs: (string | number)[][], sources: string[][] } {
  const by = new Map<number, Cand2[]>();
  const add = (fy: number, c: Cand2) => { if (!by.has(fy)) by.set(fy, []); by.get(fy)!.push(c); };
  let ignored = 0;
  for (const f of files) {
    for (const y of f.years) {
      if (y.kind === "projected" || y.kind === "estimated" || y.fy >= open) { ignored++; continue; }
      const word = f.kind === "cma" ? "earlier CMA" : y.kind === "audited" ? "audited balance sheet" : "balance sheet (not stated as audited)";
      add(y.fy, { pri: f.kind === "cma" ? 2 : 0, src: word + " (" + f.name + (f.by === "ai" ? ", read by the AI" : "") + ")", kind: y.kind === "audited" ? "audited" : "provisional", l: y.l, tol: y.tol, bs: y.bs, pl: y.pl, div: y.div ?? null,
        tot: y.tot, stbUnknown: y.stbUnknown });
    }
  }
  if (ignored) notes.push("The earlier CMA's estimated and projected columns (" + ignored + ") are not used: FinCom works out its own from the latest figures.");
  for (const b of books) add(b.fy, { pri: 1, src: "books", kind: "actual", l: b.l, tol: 1, bs: true, pl: true, stbUnknown: (b as CYear & { stbUnknown?: number }).stbUnknown });
  const years: CYear[] = [], diffs: (string | number)[][] = [], sources: string[][] = [["Year", "Kind", "Figures from"]];
  for (const fy of [...by.keys()].sort((a, b) => a - b)) {
    const cs = by.get(fy)!.sort((a, b) => a.pri - b.pri);
    const bsC = cs.find((c) => c.bs), plC = cs.find((c) => c.pl);
    if (!bsC) { notes.push(fyLabel(fy) + ": only the profit and loss could be read (no balance sheet); the year is left out."); continue; }
    const l: Lines = {};
    for (const k of [...BS_KEYS, ...MEMO]) if (bsC.l[k] != null) l[k] = bsC.l[k];
    if (plC) for (const k of PLK) if (plC.l[k] != null) l[k] = plC.l[k];
    const kind: CYear["kind"] = bsC.pri === 1 ? "actual" : bsC.kind;
    years.push({ fy, kind, src: bsC.src + (plC && plC !== bsC ? "; profit and loss from " + plC.src : ""), l, tol: Math.max(bsC.tol, plC ? plC.tol : 1), div: plC && plC.div != null ? plC.div : null,
      printed: { L: bsC.tot?.L, A: bsC.tot?.A, PBT: plC?.tot?.PBT, PAT: plC?.tot?.PAT } });
    if (bsC.stbUnknown && bsC.stbUnknown > 1) notes.push(fyLabel(fy) + ": short-term borrowings of " + rupees(bsC.stbUnknown) + " (" + bsC.src + ") could not be told apart (bank, current maturities of term loans, directors or related parties): counted as bank borrowings for working capital. Give the split to change it.");
    sources.push([fyLabel(fy), KIND_WORD[kind], bsC.src + (plC && plC !== bsC ? "; profit and loss from " + plC.src : "") + (!plC ? "; no profit and loss for the year" : "")]);
    for (const c of cs) {
      if (c === bsC && (c === plC || !plC)) continue;
      const keys = [...(c.bs && c !== bsC ? BS_KEYS : []), ...(c.pl && c !== plC ? PLK : [])];
      for (const k of keys) {
        const used = l[k] || 0, other = c.l[k] || 0, d = used - other;
        if (Math.abs(d) > Math.max(c.tol, bsC.tol, 1)) diffs.push([fyLabel(fy), lineName(k), Math.round(used), Math.round(other), Math.round(d), c.src]);
      }
    }
  }
  return { years, diffs: diffs.slice(0, 200), sources };
}
