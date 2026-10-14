// FinCom Assistant: the one label map for the fields of a book tool's result (its `summary`), used everywhere a field is
// shown to a person: FinCom's own reply for a book tool (server/assistant/router.ts describe(): the panel shows the reply
// once, with no summary line of its own), the labels the model is given beside a result (agent.ts forClaude) and the
// last pass over the model's answer (agent.ts: a raw key that slipped into the words is put in words).
// The owner's report of 14-Oct-2026: raw keys such as "disallowance30pct" showed in answers.
// Plain JavaScript, no imports: read by the Deno function.

export const FIELD_LABELS = {
  total: "total", count: "entries", entries: "entries", tds: "TDS", tax: "tax", value: "value", amount: "amount",
  books: "in the books", twob: "in 2B", diff: "difference", difference: "difference", in26as: "in 26AS",
  deducted: "deducted", paid: "paid", lateAmount: "paid late", overdueAmount: "overdue", late: "paid late (entries)",
  overdue: "overdue (entries)", deductees: "deductees", deductors: "deductors", parties: "parties", suppliers: "suppliers",
  months: "months", taxable: "value before tax", excess: "3B more than 2B", b3all: "ITC in 3B", rcm: "reverse charge",
  gstr1: "in GSTR-1", gstr3b: "in GSTR-3B", gst: "GST", monthsWith3b: "months with GSTR-3B",
  disallowance30pct: "Disallowance u/s 40(a)(ia) – 30%",
  cashPaymentsPct: "payments in cash (%)", cashReceiptsPct: "receipts in cash (%)",
  ledgersConfirmed: "ledgers confirmed", msmeSuppliers: "MSME suppliers", sameBill: "same bill number",
  withR1: "shown in GSTR-1", withRef: "with a reference", differ: "differing", near: "near matches",
  opening: "opening", closing: "closing", debit: "debit", credit: "credit", turnover: "turnover", revenue: "revenue",
  sales: "sales", expenses: "expenses", otherIncome: "other income", pbt: "profit before tax", gross: "gross", cost: "cost",
  flagged: "flagged", failed: "failed", checks: "checks", warnings: "warnings",
  terminal_growth: "terminal growth", years_of_history: "years of history",
};

// fields that are a number of things (not rupees) and fields that are a percentage
const COUNTS = /^(count|entries|parties|months|suppliers|deductees|deductors|overdue|late|withR1|withRef|differ|sameBill|near|ledgersConfirmed|msmeSuppliers|monthsWith3b|flagged|failed|checks|warnings|years_of_history)$/;
const PCTS = /Pct$/;

/** The words for a result field: from the map, else the key put in words ("otherIncome" -> "other income"). */
export function fieldLabel(k) {
  const key = String(k || "");
  if (Object.prototype.hasOwnProperty.call(FIELD_LABELS, key)) return FIELD_LABELS[key];
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/\s+/g, " ").trim().toLowerCase();
}
/** "count", "pct" or "amount": how a field's value is written. */
export function fieldKind(k) { const key = String(k || ""); return COUNTS.test(key) ? "count" : PCTS.test(key) ? "pct" : "amount"; }
/** The labels of a summary's fields, for the model ({key: label}), only those that are not plain words already. */
export function summaryLabels(summary) {
  if (!summary || typeof summary !== "object") return null;
  const out = {};
  for (const k of Object.keys(summary)) { const l = fieldLabel(k); if (l !== k) out[k] = l; }
  return Object.keys(out).length ? out : null;
}
// keys that are never plain words (camelCase, digits, underscores): only these are put in words in an answer's text
const RAW = Object.keys(FIELD_LABELS).filter((k) => /[A-Z0-9_]/.test(k)).sort((a, b) => b.length - a.length);
const RAW_RE = RAW.length ? new RegExp("(^|[^A-Za-z0-9_.⟦\\[])(?:summary\\.)?(" + RAW.join("|") + ")(?![A-Za-z0-9_])", "g") : null;
const LABEL_SET = new Set(Object.values(FIELD_LABELS));
/** An answer's words with any raw field key ("disallowance30pct", "summary.lateAmount") replaced by its label. Figure
 *  markers (⟦F1⟧) and cited entries ([V:…]) are left as they are. */
export function relabelText(text) {
  if (!RAW_RE || !text) return String(text || "");
  return String(text).replace(RAW_RE, (_m, pre, key) => pre + FIELD_LABELS[key])
    .replace(/`([^`\n]{1,60})`/g, (m, inner) => (LABEL_SET.has(inner) ? inner : m));
}
