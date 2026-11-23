// The sheet-format half of the assistant (the owner, 14-Oct-2026: "Use AI the first time for any format; after that it
// should learn that format and use that memory next time"). FinCom sends a register's header and up to 10 rows, with
// every identifier, name and long number already masked in the browser (SheetFmt.masked, app/src/lib/registers.js); the cheap model
// (Haiku) answers which column is which of FinCom's fields and how to read them. It never sees a whole sheet and never
// decides a figure: FinCom's own rules read every row with the mapping, once the person has confirmed it. The system
// prompt is cached (1 hour), so a firm mapping several formats in a session pays for it once.
// Plain module: no Deno, no imports.

export const SHEET_FIELDS = ["date", "no", "party", "gstin", "pos", "taxable", "rate", "igst", "cgst", "sgst", "cess", "tax", "total", "hsn", "qty", "ledger", "sledger", "doctype", "against", "owngstin", "branch"];
// a party's statement of account (a vendor's or customer's ledger of the client, for reconciliation: app/src/lib/registers.js)
export const PARTY_FIELDS = ["date", "no", "narration", "debit", "credit", "amount", "drcr", "balance", "tds", "gst"];
export const PARTY_SYSTEM = [
  "You map the columns of a party's statement of account (a vendor's or customer's ledger, as the party keeps it) to an accounting app's fields.",
  "You are given the header row and up to 10 data rows. Names, GSTINs, PANs, phone numbers and e-mails are masked (TEXT_1, GSTIN_1, …); keep to the shape of the values.",
  "Fields: date, no (voucher, bill or reference number), narration (particulars), debit, credit, amount (one signed amount column, only when there are no separate debit and credit columns),",
  "drcr (a column saying Dr or Cr for that amount), balance (the running balance), tds (a TDS column), gst (a GST or tax column).",
  "Map a field only when a column clearly holds it; never two fields to one column; use the header text exactly as given.",
  "Answer only JSON: {\"map\": {field: header}, \"transforms\": {\"date\": \"dmy\"}, \"why\": {field: \"a few words\"}}.",
].join("\n");

export const SHEET_SYSTEM = [
  "You map the columns of an Indian GST register (a purchase or sales register, a GST portal or marketplace export, an ERP report) to an accounting app's fields.",
  "You are given the header row and up to 10 data rows. Names, GSTINs, PANs, phone numbers and e-mails are masked (TEXT_1, GSTIN_1, …); keep to the shape of the values.",
  "Fields: date (invoice or note date), no (invoice or note number), party (supplier or customer name), gstin (the party's GSTIN), pos (place of supply),",
  "taxable (taxable value), rate (GST rate %), igst, cgst, sgst (SGST or UTGST), cess, tax (one column holding the whole GST, only when there are no separate IGST/CGST/SGST columns),",
  "total (invoice or document value), hsn (HSN/SAC), qty, against (the original invoice of a note),",
  "sledger (the sales, income, purchase or expense ledger of the row: a column headed Sales Ledger, Purchase Ledger, Particulars or Account whose values are account heads, not the party),",
  "ledger (the party's own ledger name as kept in the accounting software, only when it is a column other than the party name; never an income, expense or tax ledger),",
  "doctype (what the document is: invoice / credit note / debit note / return; a Voucher Type column is this),",
  "owngstin (on a sales register only: the seller's own GSTIN the invoice is issued from, a column such as Our GSTIN, Company GSTIN or Seller GSTIN; never the customer's),",
  "branch (the branch, location or invoice series the row was issued from).",
  "Map a field only when a column clearly holds it; leave it out otherwise. Never map two fields to one column. Use the column's header text exactly as given.",
  "Also say how to read: date order (dmy, mdy or ymd) from the sample values; whether rows sharing an invoice number are one invoice (groupByNo);",
  "Answer only JSON: {\"map\": {field: header}, \"transforms\": {\"date\": \"dmy\", \"groupByNo\": true}, \"skip\": [\"what rows to skip, e.g. total rows\"], \"why\": {field: \"a few words: from 'Inv Dt'\"}}.",
].join("\n");

// the user message: the header and the rows, as a small table
export function sheetPrompt(head: string[], rows: string[][], side: string): string {
  const h = (head || []).slice(0, 80).map((x) => String(x ?? "").slice(0, 60));
  const r = (rows || []).slice(0, 10).map((row) => (row || []).slice(0, 80).map((x) => String(x ?? "").slice(0, 40)));
  const what = side === "sales" ? "A sales register" : side === "vendor" ? "A vendor's statement of our account" : side === "customer" ? "A customer's statement of our account" : "A purchase register";
  return what + ".\nHeader: " + JSON.stringify(h) + "\nRows:\n" + r.map((x) => JSON.stringify(x)).join("\n");
}

// the model's answer, checked: only FinCom's fields, only the sheet's own headers, one field a column
export function parseSheetMap(text: string, head: string[], fields: string[] = SHEET_FIELDS): { map: Record<string, string>, transforms: { date: string, groupByNo: boolean }, skip: string[], why: Record<string, string> } {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  let j: any = {};
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  const heads = new Set((head || []).map((x) => String(x ?? "")));
  const map: Record<string, string> = {}, used = new Set<string>();
  Object.entries(j.map || {}).forEach(([f, col]) => {
    const c = String(col ?? "");
    if (!fields.includes(f) || !heads.has(c) || used.has(c)) return;
    map[f] = c; used.add(c);
  });
  const t = j.transforms || {};
  const why: Record<string, string> = {};
  Object.entries(j.why || {}).forEach(([f, w]) => { if (map[f]) why[f] = String(w ?? "").slice(0, 80); });
  return { map, transforms: { date: ["dmy", "mdy", "ymd"].includes(t.date) ? t.date : "dmy", groupByNo: t.groupByNo !== false }, skip: (Array.isArray(j.skip) ? j.skip : []).map((x: unknown) => String(x).slice(0, 60)).slice(0, 5), why };
}

// next-payroll (docs/PAYROLL.md): a salary sheet's new layout. The header and AT MOST 3 rows, names, PANs, codes, e-mails,
// phones and account numbers already masked in the browser (app/src/lib/payrollSheet.js samples); the answer is which
// column is which, never a figure. The person confirms it, it is saved as the client's rule, and that layout is read by
// the rule alone from then on.
export const PAYROLL_FIELDS = ["name", "code", "pan", "days", "month", "date", "gross", "tds", "pt", "pfEmp", "pfEr", "esiEmp", "esiEr", "net"];
export const PAYROLL_ROWS = 3;
export const PAYROLL_SYSTEM = [
  "You map the columns of an Indian company's monthly salary sheet (pay register) to an accounting app's fields.",
  "You are given the header row and up to 3 data rows. Names, PANs, employee codes, phone and account numbers are masked (TEXT_1, PAN_1, CODE_1, NUMBER_1); keep to the shape of the values.",
  "Fields: name (employee name), code (employee code or id), pan, days (days paid or attendance), month (the salary month, e.g. Oct-2026), date (the date salary was paid; never a date of birth, joining or leaving),",
  "gross (gross pay or total earnings, one column), tds (income tax deducted), pt (professional tax), pfEmp (the employee's PF), pfEr (the employer's PF contribution), esiEmp (the employee's ESI), esiEr (the employer's ESI contribution), net (net pay, take home).",
  "Also list earn: every earning head column (basic, DA, HRA, allowances, bonus, overtime, arrears), and ded: every other deduction column out of the employee's pay (advance or loan recovery, canteen, LWF).",
  "Never put a total, gross or net column in earn or ded; never a column in two places; never a date of birth, joining or leaving as month or date.",
  "Map a field only when a column clearly holds it; leave it out otherwise. Use the column's header text exactly as given.",
  "Answer only JSON: {\"map\": {field: header}, \"earn\": [header], \"ded\": [header], \"why\": {field: \"a few words\"}}.",
].join("\n");
// (review 8) the server's own second mask, whatever the page sent: a full date (birth, joining, pay) as DATE, an account,
// phone or UAN of 9 digits or more as NUMBER, a PAN or an e-mail as such, and every figure rounded to two significant
// digits (a day count up to 31 kept), any other text (a name) as TEXT; a pay month ("Oct-2026", "10/2026") and the page's
// own tokens (TEXT_1) as they are
export function payrollMask(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || /^(TEXT|PAN|CODE|NUMBER|EMAIL|DATE)_\d+$/.test(s)) return s;
  if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(s)) return "PAN";
  if (/@/.test(s)) return "EMAIL";
  if (/^\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}([T ].*)?$/.test(s) || /^\d{1,2}[-\s]?[a-z]{3,9}[-\s']*\d{2,4}$/i.test(s)) return "DATE";
  if (/^\d{1,2}[-\/]\d{4}$|^\d{4}[-\/]\d{1,2}$/.test(s) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s'\/]*\d{2,4}$/i.test(s)) return s;
  if (/^\+?\d{9,}$/.test(s.replace(/[\s\-./]/g, "")) && !/^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s) && !/\.\d{1,2}$/.test(s)) return "NUMBER";
  const t = s.replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/[,\s₹]/g, "");
  if (/^-?\d*\.?\d+$/.test(t)) {
    const n = Number(t), a = Math.abs(n);
    if (a <= 31) return String(Math.round(n * 2) / 2);
    const k = Math.pow(10, Math.max(0, Math.floor(Math.log10(a)) - 1));
    return String((n < 0 ? -1 : 1) * Math.round(a / k) * k);
  }
  // (re-review 8) any other text (a name, a department, a bank) as TEXT, whatever the page did
  return /[\p{L}]/u.test(s) ? "TEXT" : "OTHER";
}
export function payrollPrompt(head: string[], rows: string[][]): string {
  const h = (head || []).slice(0, 80).map((x) => String(x ?? "").slice(0, 60));
  const r = (rows || []).slice(0, PAYROLL_ROWS).map((row) => (row || []).slice(0, 80).map((x) => payrollMask(x).slice(0, 40)));
  return "A salary sheet.\nHeader: " + JSON.stringify(h) + "\nRows:\n" + r.map((x) => JSON.stringify(x)).join("\n");
}
// the answer checked: only the fields, only the sheet's own headers, a column in one place at most
export function parsePayrollMap(text: string, head: string[]): { map: Record<string, string>, earn: string[], ded: string[], why: Record<string, string> } {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  let j: any = {};
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  const heads = new Set((head || []).map((x) => String(x ?? ""))), used = new Set<string>(), map: Record<string, string> = {};
  Object.entries(j.map || {}).forEach(([f, col]) => { const c = String(col ?? ""); if (!PAYROLL_FIELDS.includes(f) || !heads.has(c) || used.has(c)) return; map[f] = c; used.add(c); });
  const list = (a: unknown) => (Array.isArray(a) ? a : []).map((c) => String(c ?? "")).filter((c) => heads.has(c) && !used.has(c) && (used.add(c), true));
  const earn = list(j.earn), ded = list(j.ded), why: Record<string, string> = {};
  Object.entries(j.why || {}).forEach(([f, w]) => { if (map[f] || f === "earn" || f === "ded") why[f] = String(w ?? "").slice(0, 80); });
  return { map, earn, ded, why };
}
