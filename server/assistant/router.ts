// The free router (the owner's cost levers, 13-Oct-2026, lever 1): the questions that keep coming up go straight to their
// book tool by their words, with no call to any model. "Cash payments over 10000 in September" -> entries_filter (cash,
// payments, 10,000, September); "194C without TDS" -> tds_missed (194C). The answer is the tool's table with a line FinCom
// writes from the tool's own summary (describe()), so it is green and costs nothing.
// A question that asks why or how, or for advice, a draft or anything not plainly one tool, is not routed here.
// Plain module: no Deno; its imports are the label map (plain JavaScript, shared with the app) and entries.ts (plain).
// A request to make entries (entries.ts) is never routed by its words: the model drafts them.

import { fieldKind, fieldLabel } from "../_shared/assistant-labels.js";
import { entriesAsked } from "./entries.ts";

export type Route = { tool: string, input: Record<string, unknown>, why: string } | { prefile: { form: string, fy: string | null, quarter: string | null, month: string | null, reg: string | null }, why: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fyStart = (y: number, m: number) => (m >= 4 ? y : y - 1);
export const fyLabel = (y: number) => y + "-" + String((y + 1) % 100).padStart(2, "0");

// the period a question names, relative to `anchor` (the earlier of today and the last entry held): a month ("in
// September", "Sep 2025"), a quarter ("Q2", "this quarter", "last quarter"), a financial year ("2025-26", "this year",
// "last year"), "last month", "this month", "FY to date". Nothing named: nulls (the tool's own default: the financial
// year to the last entry held).
export function periodOf(q: string, anchor: string): { from: string | null, to: string | null, fy: string | null, label: string } {
  const s = String(q || "").toLowerCase();
  const ay = Number(anchor.slice(0, 4)), am = Number(anchor.slice(5, 7));
  const fy0 = fyStart(ay, am);
  let m = s.match(/\b(20\d{2})\s*[-–/]\s*(\d{2})\b/);
  const fyNamed = m && (Number(m[2]) === (Number(m[1]) + 1) % 100) ? Number(m[1]) : null;
  // a quarter
  m = s.match(/\bq([1-4])\b/) || s.match(/\b(first|second|third|fourth) quarter\b/);
  if (m || /\b(this|current|last|previous) quarter\b/.test(s)) {
    let fy = fyNamed ?? fy0, qn: number;
    if (m) qn = /^\d$/.test(m[1]) ? Number(m[1]) : ["first", "second", "third", "fourth"].indexOf(m[1]) + 1;
    else {
      qn = am >= 4 ? Math.floor((am - 4) / 3) + 1 : 4;
      if (/\b(last|previous) quarter\b/.test(s)) { qn -= 1; if (qn === 0) { qn = 4; fy -= 1; } }
    }
    const sm = [4, 7, 10, 1][qn - 1], y = qn === 4 ? fy + 1 : fy;
    return { from: iso(y, sm, 1), to: iso(y, sm + 2, lastDay(y, sm + 2)), fy: fyLabel(fy), label: "Q" + qn + " " + fyLabel(fy) };
  }
  // a month by name, with or without a year
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s,'-]+(20\d{2}|\d{2})\b)?/);
  if (m && !/\bmay (i|we|you)\b/.test(s.slice(m.index ?? 0, (m.index ?? 0) + 8))) {
    const mm = MONTHS.indexOf(m[1]) + 1;
    let y = m[2] ? (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])) : (fyNamed != null ? (mm >= 4 ? fyNamed : fyNamed + 1) : (mm <= am ? ay : ay - 1));
    return { from: iso(y, mm, 1), to: iso(y, mm, lastDay(y, mm)), fy: fyLabel(fyStart(y, mm)), label: MONTHS[mm - 1][0].toUpperCase() + MONTHS[mm - 1].slice(1) + " " + y };
  }
  if (/\blast month\b|\bprevious month\b/.test(s)) { const y = am === 1 ? ay - 1 : ay, mm = am === 1 ? 12 : am - 1; return { from: iso(y, mm, 1), to: iso(y, mm, lastDay(y, mm)), fy: fyLabel(fyStart(y, mm)), label: "last month" }; }
  if (/\bthis month\b/.test(s)) return { from: iso(ay, am, 1), to: anchor, fy: fyLabel(fy0), label: "this month" };
  if (fyNamed != null) return { from: iso(fyNamed, 4, 1), to: iso(fyNamed + 1, 3, 31), fy: fyLabel(fyNamed), label: fyLabel(fyNamed) };
  if (/\b(last|previous) (financial )?year\b|\blast fy\b/.test(s)) return { from: iso(fy0 - 1, 4, 1), to: iso(fy0, 3, 31), fy: fyLabel(fy0 - 1), label: fyLabel(fy0 - 1) };
  if (/\b(this|current) (financial )?year\b|\bthis fy\b|\bytd\b|\bto date\b|\bso far\b/.test(s)) return { from: iso(fy0, 4, 1), to: anchor, fy: fyLabel(fy0), label: fyLabel(fy0) + " to date" };
  return { from: null, to: null, fy: null, label: "" };
}

const amountIn = (s: string): number | null => {
  const m = s.match(/(?:over|above|more than|exceeding|>|at least|of)\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs|lac|l|cr|crore)?\b/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const u = (m[2] || "").toLowerCase();
  if (u === "k" || u === "thousand") n *= 1000; else if (/^(lakh|lakhs|lac|l)$/.test(u)) n *= 100000; else if (/^(cr|crore)$/.test(u)) n *= 10000000;
  return isFinite(n) ? n : null;
};

// a question this router must leave to the model: why, how, should, explain, advice, a draft, a notice, several things
const NOT_MINE = /\b(why|how come|explain|should|could|would|advise|advice|suggest|draft|reply|letter|notice|compare .* with|and also|what if|is it|are they|can i|can we|reason|excel|xlsx|spreadsheet|word|docx|pdf|download|file of|confirmation)\b|\band (what|how|which|who|when|where|whether|the|its|their)\b|,\s*and\b/i;

// a question about the law (a due date, a rate, a limit, a section) and not about this client's books: never a book tool by
// its words ("I need gstr 9 due date" is not the client's due list; owner, 15-Oct-2026). The client's own dues ("due
// list", "what's due this month", "pending compliances") have no law word and stay routed.
const LAW = /\b(due dates?|last dates?|rates?|section|limit|threshold|applicable|applicability|penalty|late fee|circular|notification|act,? 20(25|17)|act,? 1961|new act|old act)\b/i;
const BOOK = /\b(my|our|we|us|this client|books?|ledgers?|paid|received|entries|suppliers?|customers?|parties|balances?|total|how much|which|list|payments?|receipts?|sales|purchases?|expenses?|bank|cash|deducted|anyone|who|pending|overdue|crossed|without)\b/i;
// a return or form named with a time word is the law too, typos and all ("gst return 9 date", "Gst return due dare")
const RETURN = /\b(gst ?returns?|gstr[- ]?\d+[a-z]?|itr|income[- ]tax returns?|t[dc]s returns?|24q|26q|27q|27eq|advance tax|tax audit|roc|aoc-?4|mgt-?7|dir-?3|annual returns?)\b/i;
const WHEN = /\b(dat[a-z]*|deadlines?|last day|when|due)\b/i;
export const lawQuestion = (q: string) => { const s = String(q || ""); return (LAW.test(s) || (RETURN.test(s) && WHEN.test(s))) && !BOOK.test(s); };

// two questions in one, or a question that is not one tool's table: never routed by words or by Haiku
export const compound = (q: string) => NOT_MINE.test(String(q || ""));

export function route(question: string, anchor: string): Route | null {
  const q = String(question || "").trim(), s = q.toLowerCase();
  if (!q || q.length > 240 || entriesAsked(q)) return null;
  // "check my Q2 26Q", "check March GST before filing": FinCom's own checklist (no AI anywhere)
  let m = s.match(/\b(26q|27q|24q)\b/);
  if (/\bcheck\b|\bbefore filing\b|\bready to file\b/.test(s) && (m || /\bgst(r-?3b|r-?1)?\b/.test(s))) {
    const p = periodOf(s, anchor);
    if (m) {
      const qm = s.match(/\bq([1-4])\b/);
      return { prefile: { form: m[1].toUpperCase(), fy: p.fy, quarter: qm ? "Q" + qm[1] : null, month: null, reg: null }, why: "a return's check before filing" };
    }
    return { prefile: { form: "GST", fy: null, quarter: null, month: p.from ? p.from.slice(0, 7) : null, reg: null }, why: "a GST month's check before filing" };
  }
  if (NOT_MINE.test(s) || lawQuestion(s)) return null;
  const p = periodOf(s, anchor), span = { from: p.from, to: p.to };
  const sec = (s.match(/\b(194[a-z]?(?:-?i)?|194-?ib|194j|194c|194h|194a|194q|194i)\b/i) || [])[1];
  const R = (tool: string, input: Record<string, unknown>, why: string): Route => ({ tool, input, why });
  // TDS
  if (/\b(without|no|not|missed|missing|short)\b.{0,20}\b(tds|deduct)/.test(s) || /\btds\b.{0,20}\b(not|never)\b.{0,10}deduct/.test(s) || /\bcrossed\b.{0,40}\b(194|limit|threshold)/.test(s))
    return R("tds_missed", { ...span, section: sec ? sec.toUpperCase().replace(/^194I$/, "194-I") : null }, "TDS limit crossed, no TDS");
  if (/\btds\b.{0,30}\b(late|delay|overdue|unpaid|not paid)\b|\blate (payment of )?tds\b|\binterest on (late )?tds\b/.test(s)) return R("tds_late", span, "TDS paid late");
  if (/\bdeductees?\b|\btds by (party|deductee)\b/.test(s)) return R("tds_deductees", { ...span, section: sec ? sec.toUpperCase() : null }, "TDS by deductee");
  if (/\b26 ?as\b|\bais\b|\btds credit\b|\btax credit\b/.test(s)) return R("tds_vs_26as", { fy: p.fy }, "26AS against the books");
  if (/\btds\b.{0,20}\b(summary|payable|deducted|ledgers?|position)\b/.test(s)) return R("tds_summary", span, "TDS ledgers");
  // cash rules and filters
  if (/\b40a ?\(?3\)?/.test(s)) return R("cash_payments_40a3", span, "section 40A(3)");
  if (/\b269 ?st\b/.test(s)) return R("cash_receipts_269st", span, "section 269ST");
  if (/\bcash\b.{0,15}\b(payments?|paid|expenses?)\b/.test(s) || /\b(payments?|paid)\b.{0,15}\bin cash\b/.test(s))
    return R("entries_filter", { ...span, min_amount: amountIn(s), max_amount: null, mode: "cash", direction: "payment", ledger: null, party: null, voucher_type: null, narration: null, limit: null }, "cash payments");
  if (/\bcash\b.{0,15}\b(receipts?|received)\b/.test(s) || /\breceived\b.{0,15}\bin cash\b/.test(s))
    return R("entries_filter", { ...span, min_amount: amountIn(s), max_amount: null, mode: "cash", direction: "receipt", ledger: null, party: null, voucher_type: null, narration: null, limit: null }, "cash receipts");
  // parties
  m = s.match(/\btop\s*(\d{1,2})?\s*(customers|clients|debtors|buyers|suppliers|vendors|creditors)\b/);
  if (m) return R("top_parties", { side: /suppl|vendor|credit/.test(m[2]) ? "suppliers" : "customers", measure: /\b(owe|owed|outstanding|balance|due)\b/.test(s) ? "balance" : "turnover", ...span, limit: m[1] ? Number(m[1]) : 10 }, "top parties");
  if (/\bmsme\b|\b43b ?\(?h\)?|\bmicro (and|&) small\b/.test(s)) return R("msme_dues_43bh", { as_on: p.to, days: null }, "section 43B(h)");
  if (/\b(ageing|aging)\b|\b(receivables?|debtors?) (outstanding|overdue|due)\b|\bwho owes\b/.test(s)) return R("ageing", { side: /\b(payables?|creditors?|suppliers?)\b/.test(s) ? "suppliers" : "customers", as_on: p.to }, "ageing");
  if (/\b(payables?|creditors?)\b.{0,10}\b(ageing|aging|outstanding|overdue)\b/.test(s)) return R("ageing", { side: "suppliers", as_on: p.to }, "ageing");
  // money
  if (/\b(cash and bank|bank balances?|cash balance|cash in hand|cash-in-hand|bank position)\b/.test(s)) return R("cash_bank", { as_on: p.to }, "cash and bank");
  if (/\b(profit (and|&) loss|p ?& ?l|p and l|net profit|gross profit|profit before tax|pbt)\b/.test(s)) return R("profit_and_loss", span, "profit and loss");
  if (/\b(sales|turnover)\b.{0,12}\b(by|each|every|per) month\b|\bmonthly (sales|turnover)\b|\bmonth[- ]wise sales\b/.test(s)) return R("sales_by_month", span, "sales by month");
  if (/\b(top|biggest|largest|major)?\s*expenses\b|\bexpenses? by ledger\b/.test(s)) return R("expenses", { ...span, limit: null }, "expenses");
  if (/\bpurchase register\b|\bpurchase bills? (list|register)\b/.test(s)) return R("purchase_register", { ...span, party: null }, "purchase register");
  if (/\butr\b|\bpayment proofs?\b|\bbank payments?\b/.test(s)) return R("payments_list", { ...span, party: null }, "bank payments");
  if (/\bsalar(y|ies)\b|\bpayroll\b|\bstaff costs?\b/.test(s)) return R("payroll", span, "payroll");
  if (/\btax audit\b|\b44ab\b|\bturnover\b/.test(s)) return R("turnover", span, "turnover and tax audit limits");
  // GST
  if (/\b2b\b/.test(s) && /\b3b\b/.test(s)) return R("itc_3way", { ...span, gstin: null }, "ITC: books, 2B and 3B");
  if (/\b2b\b/.test(s) && /\b(itc|input|credit)\b/.test(s)) return R("itc_vs_2b", { ...span, gstin: null }, "ITC against 2B");
  if (/\bgstr-?1\b/.test(s) && /\b(3b|gstr-?3b)\b/.test(s)) return R("turnover_3way", { ...span, gstin: null }, "turnover: books, GSTR-1 and 3B");
  if (/\bgstr-?1\b/.test(s)) return R("sales_vs_gstr1", { ...span, gstin: null }, "sales against GSTR-1");
  if (/\breverse charge\b|\brcm\b/.test(s)) return R("rcm", span, "reverse charge");
  if (/\bgst\b.{0,15}\b(summary|liability|payable|position|by month)\b|\boutput (gst|tax)\b/.test(s)) return R("gst_summary", span, "GST by month");
  // checks
  if (/\bduplicates?\b|\bentered twice\b|\bdouble entr/.test(s)) return R("duplicates", span, "duplicates");
  if (/\bround (sum|figure|amount)s?\b/.test(s)) return R("round_sums", { ...span, min_amount: amountIn(s) }, "round sums");
  if (/\b(sunday|weekend|holiday)s?\b/.test(s)) return R("weekend_entries", { ...span, saturdays: /\b(saturday|weekend)s?\b/.test(s) }, "weekend entries");
  if (/\bdue (list|dates?)\b|\bwhat('s| is) due\b|\bpending compliances?\b|\boverdue (returns?|compliances?|filings?)\b/.test(s)) return R("due_list", span, "due list");
  if (/\b(which|what) books\b|\bbooks held\b|\blast (synced|updated|entry)\b/.test(s)) return R("books_held", {}, "books held");
  // a ledger
  m = q.match(/\bbalance (?:of|in|for)\s+(?:the\s+)?([A-Za-z0-9&.,()' -]{3,60}?)(?:\s+(?:as on|on|at|in|for)\b.*)?[?.]?$/i);
  if (m) return R("ledger_balance", { ledger: m[1].trim(), as_on: p.to }, "a ledger's balance");
  m = q.match(/\b(?:ledger|account|statement)\s+(?:of|for)\s+(?:the\s+)?([A-Za-z0-9&.,()' -]{3,60}?)(?:\s+(?:from|for|in|during)\b.*)?[?.]?$/i);
  if (m) return R("ledger_entries", { ledger: m[1].trim(), ...span, limit: null }, "a ledger's account");
  return null;
}

// FinCom's own line above a routed tool's table (no model): what it is, the period, and the summary's figures
const money = (n: unknown) => {
  const v = Number(n); if (!isFinite(v)) return String(n);
  const neg = v < 0, [i, d] = Math.abs(v).toFixed(2).split("."), last3 = i.slice(-3), rest = i.slice(0, -3);
  return (neg ? "-" : "") + "₹" + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3 + "." + d;
};
const dmy = (v: unknown) => { const s = String(v ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + "-" + MONTHS[Number(s.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase()) + "-" + s.slice(0, 4) : s; };
// the words for a summary's fields: one map for the function and the app (server/_shared/assistant-labels.js)
export function describe(r: Record<string, any>, why: string): string {
  if (!r || r.none) return String((r && r.why) || "FinCom has nothing for this in the books held.");
  const title = String(r.title || why || r.tool || "");
  const per = r.period && (r.period.from || r.period.to) ? (r.period.from ? dmy(r.period.from) + " to " : "to ") + dmy(r.period.to) : r.period && r.period.as_on ? "on " + dmy(r.period.as_on) : "";
  const sum = r.summary && typeof r.summary === "object" ? Object.entries(r.summary).filter(([, v]) => typeof v === "number").slice(0, 5)
    .map(([k, v]) => fieldLabel(k) + ": " + (fieldKind(k) === "count" ? String(v) : fieldKind(k) === "pct" ? String(v) + "%" : money(v))) : [];
  const n = Array.isArray(r.rows) ? r.rows.length : null;
  const head = title + (per ? ", " + per : "") + ".";
  const body = sum.length ? " " + sum.join("; ") + "." : "";
  const rows = n === 0 ? " Nothing found in the books for this." : n != null ? " The table below has " + n + " line" + (n === 1 ? "" : "s") + "." : "";
  return head + body + rows + (r.why ? " " + r.why : "");
}
