// A request for CMA data (the owner, 14-Nov-2026): CMA, credit monitoring, MPBF, Tandon or Nayak, the drawing power,
// "projections for the bank" ("bank ke liye projections", in Hindi too), with or without files, goes to FinCom's cma_data
// tool (tools/cma.ts) at once: never to the statements card (fsask.ts), the keyword router, Haiku or the projected
// statements, and with no chat model (the only AI is the reading of a PDF). What the user said in this conversation (the
// loan's type and amount, a term loan's tenure and moratorium, Method I or II, the years, growth and margins) is read here
// by FinCom's own rules; a change right after a CMA ("make it method I", "term loan 50 lakh for 5 years") redoes it.
// Plain module: no Deno, no imports.

// CMA only in a credit context ("CMA data", "CMA report", "prepare CMA", "CMA for the bank"), MPBF, "Tandon method",
// "Nayak committee", credit monitoring: never a bare "CMA", "Tandon" or "Nayak" (a party, a ledger, the CMA course)
const CMA = /\bcma\s+(data|report|statements?|format|forms?|projections?|working|file|figures|computation)\b|\b(prepare|make|making|bana\w*|create|need|want|give|send|generate|draft|do|redo|update|chahiye|karo|kar\s+do)\b[^.?!\n]{0,20}\bcma\b(?!\s+(inter|final|foundation|institute|course|exam|student|fees?)\b)|\bcma\b[^.?!\n]{0,20}\b(for|to)\s+(the\s+|a\s+|my\s+)?(bank|loan|renewal|enhancement|cc|od|limit)\b|\bcma\s+(ke|ki|ka)\s+(liye|liy|lie)\b|credit\s+monitoring(\s+arrangement)?|\bmpbf\b|maximum\s+permissible\s+bank\s+finance|permissible\s+bank\s+finance|\btandon(\s+committee)?\s+(method|norms?|committee)\b|\b(tandon|nayak)\s+committee\b|\bnayak\s+(method|norms?)\b|drawing\s+power\s+(gap|calculation|working)|working\s+capital\s+(assessment|requirement\s+for\s+(the\s+)?bank)|assessment\s+of\s+working\s+capital|सीएमए|एमपीबीएफ/i;
// a ledger, a party or the CMA course named: never a CMA request by these words alone
const NAMED = /\b(ledger|a\/c|account\s+of|outstanding|balance\s+of|party|fees?|exam|inter|student|course)\b/i;
const STRONG = /\bmpbf\b|credit\s+monitoring|maximum\s+permissible|\bcma\s+(data|report|format|forms?)\b|\b(tandon|nayak)\s+(method|committee|norms?)\b/i;
// projections asked for a bank or a loan ("projections for the bank", "bank ke liye projections", "loan ke liye projected balance sheet")
const BANKPROJ = /\b(bank|loan|cc|od|limit|term\s+loan)\s+(ke|k|ki|ka)\s+(liye|liy|lie|vaaste|waste)\s+(projections?|projected|cma|data|figures|estimates?|balance\s*sheets?)\b|\b(projections?|projected\s+(balance\s*sheets?|financials?|statements?|figures))\s+(for|to)\s+(the\s+|a\s+|my\s+|our\s+)?(bank|loan|cc|od|cash\s+credit|term\s+loan|working\s+capital|limit|renewal|enhancement)\b|\bbank\s+loan\s+projections?\b|बैंक\s*(के\s*लिए)?\s*(प्रोजेक्शन|प्रक्षेपित|अनुमानित)/i;
export const cmaAsked = (q: string): boolean => {
  const s = String(q || "");
  if (!CMA.test(s) && !BANKPROJ.test(s)) return false;
  return !NAMED.test(s) || STRONG.test(s) || BANKPROJ.test(s);
};
// the answer FinCom gave last was CMA data (its own first words: tools/cma.ts cmaLine)
export const cmaShown = (h: { role: string, content: string }[]): boolean => (h || []).slice(-2).some((x) => x.role === "assistant" && /CMA data in the standard bank format/.test(String(x.content || "")));
// a change to the CMA just shown: the loan, the method, a margin, the years or an assumption with a new value, or a redo
// CMA-specific words only (the method, a margin, MPBF, drawing power, DSCR, a form, the projected years, a loan WITH its
// amount or terms); "again", "loan" or "limit" alone are not a change to the CMA
const AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:lakhs?|lacs?|lakh|l|crores?|cr|k)?";
const FOLLOW = new RegExp("\\bmethod\\s*-?\\s*(i{1,2}|1|2|one|two)\\b|\\b(first|second)\\s+method\\b|\\b(stock|receivables?|debtors?|book\\s+debts?)\\s+margin\\b|\\bmargin\\s+(on|of)\\s+(stock|receivables?|debtors?)\\b|\\bmpbf\\b|\\bdrawing\\s+power\\b|\\bdscr\\b|\\bform\\s*(i{1,3}|iv|v|vi|[1-6])\\b|\\b(\\d|one|two|three)\\s+(projected\\s+)?years?\\s+(of\\s+)?projections?\\b|\\bproject(ed|ion)?s?\\s+(for\\s+)?(\\d|one|two|three)\\s+years?\\b|" +
  "\\b(term\\s+loan|cc|cash\\s+credit|od|overdraft|working\\s+capital|wc)(\\s+(limit|loan|facility))?\\b[^.?!\\n]{0,25}?" + AMOUNT + "|" + AMOUNT + "\\s*(of\\s+|ka\\s+|ki\\s+)?(term\\s+loan|cc|cash\\s+credit|od|overdraft|working\\s+capital)\\b|\\b(tenure|moratorium|repayment\\s+schedule|instal+ments?|emi)\\b|\\bredo\\s+(the\\s+)?cma\\b", "i");
export const cmaFollow = (q: string): boolean => FOLLOW.test(String(q || "")) && !/\b(post|file|delete|send|confirm)\b/i.test(String(q || ""));
export const cmaWanted = (q: string, history: { role: string, content: string }[]): boolean => cmaAsked(q) || (cmaShown(history) && cmaFollow(q));

// ---------------------------------------------------------------- what the user said, read by FinCom's rules
const UNIT: Record<string, number> = { l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, lk: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, k: 1e3, thousand: 1e3, mn: 1e6, million: 1e6 };
const AMT = "(?:₹|rs\\.?|inr)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(lakhs?|lacs?|lakh|lk|l|crores?|cr|k|thousand|mn|million)?\\b";
const amt = (n: string, u?: string) => { const v = Number(n.replace(/,/g, "")) * (u ? UNIT[u.toLowerCase()] || 1 : 1); return isFinite(v) ? v : null; };
const WC = "(?:cc|cash\\s+credit|od|overdraft|working\\s+capital|wc|packing\\s+credit|bill\\s+discounting)(?:\\s+(?:limit|loan|facility))?";
const TL = "(?:term\\s+loan|tl|machinery\\s+loan|project\\s+loan|vehicle\\s+loan|car\\s+loan|loan\\s+for\\s+(?:machinery|plant|building|expansion))";
function amountNear(s: string, word: string): number | null {
  // "CC limit of 50 lakh", "term loan: ₹1.2 crore"; else "50 lakh CC limit", "1 crore ka term loan"
  let m = new RegExp("\\b" + word + "\\b[^.?!\\d]{0,25}?" + AMT, "i").exec(s);
  if (m) return amt(m[1], m[2]);
  m = new RegExp(AMT + "\\s*(?:ka|ki|ke|of|for|as|worth)?\\s*(?:a\\s+|an\\s+|the\\s+|new\\s+)?" + word + "\\b", "i").exec(s);
  return m ? amt(m[1], m[2]) : null;
}
export type CmaInput = Record<string, unknown>;
export function cmaInput(question: string, history: { role: string, content: string }[]): CmaInput {
  // the user's words since the CMA was first asked in this conversation, oldest first (the newest says last)
  const said = [...(history || []).filter((h) => h.role === "user").map((h) => String(h.content || "")), String(question || "")];
  let from = 0;
  said.forEach((t, i) => { if (cmaAsked(t)) from = from || i + 1; });
  const ts = said.slice(Math.max(0, from - 1));
  const o: CmaInput = { loan_type: null, working_capital_limit: null, term_loan_amount: null, term_loan_years: null, moratorium_months: null, existing_repayment: null, method: null, years: null,
    stock_margin_pct: null, receivable_margin_pct: null, assumptions: { revenue_growth_pct: null, capex: null, dividend_or_drawings: null, receivable_days: null, inventory_days: null, payable_days: null, tax_rate_pct: null, other_assumptions: null } };
  const A = o.assumptions as Record<string, unknown>;
  let wcSaid = false, tlSaid = false;
  for (const t0 of ts) {
    const s = t0.toLowerCase();
    const wcWord = new RegExp("\\b" + WC + "\\b", "i").test(s), tlWord = new RegExp("\\b" + TL + "\\b", "i").test(s);
    const wc = amountNear(s, WC), tl = amountNear(s, TL);
    if (wc != null) { o.working_capital_limit = wc; wcSaid = true; } else if (wcWord) wcSaid = true;
    if (tl != null) { o.term_loan_amount = tl; tlSaid = true; } else if (tlWord) tlSaid = true;
    if (/\b(no|without)\s+term\s+loan\b|\bonly\s+(cc|cash\s+credit|od|working\s+capital)\b/.test(s)) { tlSaid = false; o.term_loan_amount = null; }
    let m = /\bmethod\s*-?\s*(ii|2|two|i|1|one)\b|\b(first|second)\s+method\b/.exec(s);
    if (m) o.method = /^(ii|2|two)$/.test(m[1] || "") || m[2] === "second" ? "II" : "I";
    // a term loan's tenure: "repayable in 5 years", "over 60 months", "tenure 7 years", "5 saal mein"
    m = /\b(?:repay\w*|tenure|over|for|period\s+of|in)\s+(?:of\s+|in\s+|over\s+)?(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|saal|sal)\b/.exec(s);
    let tenureAt = -1;
    if (m && (tlWord || /\b(repay|tenure|emi|instal)/.test(s))) { o.term_loan_years = /^m/.test(m[2]) ? Number(m[1]) / 12 : Number(m[1]); tenureAt = (m.index || 0) + m[0].length; }
    m = /\bmoratorium\s*(?:of|period\s+of)?\s*(\d+)\s*(months?|years?)\b|\b(\d+)\s*(months?|years?)\s*(?:of\s+)?moratorium\b/.exec(s);
    if (m) { const v = Number(m[1] || m[3]), u = m[2] || m[4]; o.moratorium_months = /^y/.test(u) ? v * 12 : v; }
    if (/\bno\s+moratorium\b/.test(s)) o.moratorium_months = 0;
    // the existing term loans' repayment: "existing loan repayment 10 lakh a year"
    m = new RegExp("\\b(?:existing|current|old|present)\\s+(?:term\\s+)?loans?\\b[^.?!\\d]{0,40}?" + AMT + "\\s*(?:a|per|each|every)\\s*(?:year|annum)", "i").exec(s);
    if (m) o.existing_repayment = [amt(m[1], m[2])];
    // the years to project: "for 2 years", "next 3 years", "2 years projections"
    m = /\b(?:for|next|coming|project(?:ed|ion)?s?\s+(?:for\s+)?)\s*(\d|one|two|three)\s+(?:projected\s+)?(?:years?|yrs?|saal)\b|\b(\d|one|two|three)\s+(?:years?|yrs?)\s+(?:of\s+)?project/.exec(s);
    if (m && (m.index || 0) + m[0].length !== tenureAt && /\b(project\w*|cma|forecast\w*|estimates?|financials?)\b/.test(s)) { const w = m[1] || m[2]; o.years = ({ one: 1, two: 2, three: 3 } as Record<string, number>)[w] ?? Number(w); }
    m = /\b(?:sales|revenue|turnover|growth|grow\w*)\b[^.?!\d]{0,25}(-?\d+(?:\.\d+)?)\s*%/.exec(s);
    if (m) A.revenue_growth_pct = [Number(m[1])];
    m = /\bstock\s+margin\b[^.?!\d]{0,15}(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%\s*(?:margin\s+on\s+stock|stock\s+margin)/.exec(s);
    if (m) o.stock_margin_pct = Number(m[1] || m[2]);
    m = /\b(?:receivables?|debtors?|book\s+debts?)\s+margin\b[^.?!\d]{0,15}(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%\s*(?:margin\s+on\s+(?:receivables?|debtors?|book\s+debts?))/.exec(s);
    if (m) o.receivable_margin_pct = Number(m[1] || m[2]);
    m = /\b(?:debtors?|receivables?)\s*(?:days|period)?\s*(?:of|at|to)?\s*(\d{1,3})\s*days\b/.exec(s);
    if (m) A.receivable_days = Number(m[1]);
    m = /\b(?:stock|inventory)\s*(?:days|period)?\s*(?:of|at|to)?\s*(\d{1,3})\s*days\b/.exec(s);
    if (m) A.inventory_days = Number(m[1]);
    m = /\b(?:creditors?|payables?)\s*(?:days|period)?\s*(?:of|at|to)?\s*(\d{1,3})\s*days\b/.exec(s);
    if (m) A.payable_days = Number(m[1]);
    m = new RegExp("\\b(?:capex|capital\\s+expenditure|new\\s+machinery|project\\s+cost)\\b[^.?!\\d]{0,25}?" + AMT, "i").exec(s);
    if (m) A.capex = [amt(m[1], m[2]), 0];
  }
  o.loan_type = wcSaid && tlSaid ? "both" : tlSaid ? "term_loan" : wcSaid ? "working_capital" : null;
  return o;
}
