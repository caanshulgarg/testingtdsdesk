// The sheet-format half of the assistant (the owner, 14-Oct-2026: "Use AI the first time for any format; after that it
// should learn that format and use that memory next time"). FinCom sends a register's header and up to 10 rows, with
// every identifier, name and long number already masked in the browser (SheetFmt.masked, src/js/81); the cheap model
// (Haiku) answers which column is which of FinCom's fields and how to read them. It never sees a whole sheet and never
// decides a figure: FinCom's own rules read every row with the mapping, once the person has confirmed it. The system
// prompt is cached (1 hour), so a firm mapping several formats in a session pays for it once.
// Plain module: no Deno, no imports.

export const SHEET_FIELDS = ["date", "no", "party", "gstin", "pos", "taxable", "rate", "igst", "cgst", "sgst", "cess", "tax", "total", "hsn", "qty", "ledger", "doctype", "against"];
// a party's statement of account (a vendor's or customer's ledger of the client, for reconciliation: src/js/81)
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
  "total (invoice or document value), hsn (HSN/SAC), qty, ledger (an account or ledger name), doctype (invoice / credit note / debit note / return), against (the original invoice of a note).",
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
