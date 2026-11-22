// Made-up books for Daily Check phase 2 (tests/run_dailyjournals.mjs, the set-off differential): cloud rows shaped as
// staging keeps them (tally_vouchers / tally_lines heads and lines, tally_ledgers, client_book_items), every name, number and
// GSTIN invented. gstRows(o) makes a client with a GSTIN in state 07 whose month's sales and purchases give the 3B o asks.
const G = "07AAAAA0000A1Z5", P1 = "07BBBBB1111B1Z1", P2 = "29CCCCC2222C1Z2";
export const GSTIN = G;
export const head = (guid, day, vtype, party, more = {}) => Object.assign({ guid, day, alter_id: 1, vtype, vno: guid, party, narration: "x", cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: G }, more);
export const L = (guid, ledger, amount) => ({ guid, ledger, amount });
export const PARENT = {
  "Sample Retail": "Sundry Debtors", "Demo Buyer KA": "Sundry Debtors", "Sample Supplier": "Sundry Creditors", "Sample Landlord": "Sundry Creditors",
  "Sales": "Sales Accounts", "Purchase": "Purchase Accounts", "Rent": "Indirect Expenses", "Salary": "Indirect Expenses", "Legal Fees": "Indirect Expenses",
  "CGST OUTPUT": "Duties & Taxes", "SGST OUTPUT": "Duties & Taxes", "IGST OUTPUT": "Duties & Taxes", "CGST INPUT": "Duties & Taxes", "SGST INPUT": "Duties & Taxes", "IGST INPUT": "Duties & Taxes",
  "IGST RCM OUTPUT": "Duties & Taxes", "GST ELECTRONIC CASH LEDGER": "Duties & Taxes", "HDFC Bank": "Bank Accounts", "Cash": "Cash-in-Hand",
  "Interest on GST": "Indirect Expenses", "GST Late Fee": "Indirect Expenses", "Depreciation": "Indirect Expenses", "Accumulated Depreciation": "Fixed Assets",
};
export const GROUPS = [{ name: "Sundry Creditors", parent: "Current Liabilities" }, { name: "Sundry Debtors", parent: "Current Assets" }, { name: "Duties & Taxes", parent: "Current Liabilities" },
  { name: "Bank Accounts", parent: "Current Assets" }, { name: "Cash-in-Hand", parent: "Current Assets" }, { name: "Sales Accounts", parent: "" }, { name: "Purchase Accounts", parent: "" },
  { name: "Indirect Expenses", parent: "" }, { name: "Fixed Assets", parent: "" }, { name: "Current Liabilities", parent: "" }, { name: "Current Assets", parent: "" }, { name: "Provisions", parent: "Current Liabilities" }];
// one month (ym "202610"): intra-state sales (CGST+SGST), inter-state sales (IGST), purchases with input CGST+SGST and IGST,
// a reverse-charge IGST liability; filed: the 3B's filed date (or "" for none), snap: keep the 3B as filed
export function gstRows(o) {
  const ym = o.ym || "202610", d = (n) => ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(n).padStart(2, "0");
  const heads = [], lines = [];
  let i = 0;
  const v = (day, type, party, ls, more) => { const g = "v" + (++i); heads.push(head(g, d(day), type, party, more)); ls.forEach(([l, a]) => lines.push(L(g, l, a))); };
  // Tally's sign: a debit negative
  if (o.intra) v(5, "Sales", "Sample Retail", [["Sample Retail", -r(o.intra * 1.18)], ["Sales", o.intra], ["CGST OUTPUT", r(o.intra * 0.09)], ["SGST OUTPUT", r(o.intra * 0.09)]], { gstin: P1, pos: "Delhi" });
  if (o.inter) v(6, "Sales", "Demo Buyer KA", [["Demo Buyer KA", -r(o.inter * 1.18)], ["Sales", o.inter], ["IGST OUTPUT", r(o.inter * 0.18)]], { gstin: P2, pos: "Karnataka" });
  if (o.credit) v(7, "Credit Note", "Sample Retail", [["Sample Retail", r(o.credit * 1.18)], ["Sales", -o.credit], ["CGST OUTPUT", -r(o.credit * 0.09)], ["SGST OUTPUT", -r(o.credit * 0.09)]], { gstin: P1, pos: "Delhi" });
  if (o.buyIntra) v(8, "Purchase", "Sample Supplier", [["Purchase", -o.buyIntra], ["CGST INPUT", -r(o.buyIntra * 0.09)], ["SGST INPUT", -r(o.buyIntra * 0.09)], ["Sample Supplier", r(o.buyIntra * 1.18)]], { gstin: P1, pos: "Delhi" });
  if (o.buyInter) v(9, "Purchase", "Sample Supplier", [["Purchase", -o.buyInter], ["IGST INPUT", -r(o.buyInter * 0.18)], ["Sample Supplier", r(o.buyInter * 1.18)]], { gstin: P2, pos: "Karnataka" });
  if (o.rcm) v(10, "Journal", "Sample Landlord", [["Legal Fees", -o.rcm], ["IGST INPUT", -r(o.rcm * 0.18)], ["IGST RCM OUTPUT", r(o.rcm * 0.18)], ["Sample Landlord", o.rcm]], { gstin: "", pos: "Delhi" });
  (o.more || []).forEach((x) => v(x.day, x.type, x.party || "", x.lines, x.head || {}));
  const filed = o.filed === undefined ? ym.slice(0, 4) + "-" + String(+ym.slice(4, 6) + 1).padStart(2, "0") + "-20" : o.filed;
  const rec = Object.assign({}, filed ? { r3b: filed } : {}, o.rec || {});
  const items = [{ key: "gstFiled", item: "", ord: 0, data: { "07": { [ym]: rec } }, deleted: false }].concat(o.items || []);
  return { client: "c1", co: { id: "c1", name: "Sample Traders", closed: o.closed || {} }, book: { book_id: "b1", from_date: "2026-04-01", ledgers_at: "2026-11-21T00:00:00Z" },
    heads, lines, bills: [], items, sales: [], runs: {},
    ledgers: Array.from(new Set(Object.keys(PARENT).concat(o.extraLedgers ? Object.keys(o.extraLedgers) : []))).filter((n) => !(o.drop || []).includes(n)).map((name) => ({ name, parent: (o.extraLedgers || {})[name] || PARENT[name], open: 0, pan: null, gstin: null })),
    groups: GROUPS };
}
const r = (x) => Math.round(x * 100) / 100;
