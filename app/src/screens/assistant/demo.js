// Made-up data for the Assistant page's design round (next-assistant, 21-Nov-2026). Every name, number, address and
// phone here is invented; nothing comes from a real client. Phase 1 reads the same shape from the cloud (the
// night_findings, client_asks and night_entries tables of docs/ASSISTANT-PHASE1.md); until then the page shows this, marked
// "Sample data".
//
// A finding: {id, cid, kind, says, state}
//   state "resolved"  Resolved by FinCom: an exact, rule-based match (docs/ASSISTANT-PHASE1.md, acceptance rule 1), with
//                     its evidence; the person can undo it
//   state "ask"       Still need from client: becomes the question `ask` (Draft, Asked, Answered or Closed)
//   state "you"       Needs you: two candidates that both fit, a near match, or something only the firm can decide
// An entry ready: {id, cid, src, type, date, lines [{l, dr, cr}], narr, why, evidence, checks}
export const RUN = { at: "2026-11-21T02:10:00+05:30", clients: 5, books: "books up to 20-Nov-2026", took: "6 min" };
export const FIRM = { name: "Sample & Co, Chartered Accountants", email: "office@samplefirm.example", wa: "+91 90000 00000" };

export const CLIENTS = [
  { id: "d1", name: "Sample Traders Pvt Ltd", contacts: [
    { id: "k1", name: "Anil Kumar", role: "Accounts", email: "accounts@sampletraders.example", wa: "+91 90000 11111", byEmail: true, byWa: true },
    { id: "k2", name: "Priya Mehta", role: "Director", email: "priya@sampletraders.example", wa: "", byEmail: true, byWa: false }], auto: false },
  { id: "d2", name: "Demo Textiles LLP", contacts: [
    { id: "k3", name: "Rakesh", role: "Owner", email: "", wa: "+91 90000 22222", byEmail: false, byWa: true }], auto: false },
  { id: "d3", name: "Example Foods", contacts: [
    { id: "k4", name: "Office", role: "Accounts", email: "office@examplefoods.example", wa: "+91 90000 33333", byEmail: true, byWa: true }], auto: false },
  { id: "d4", name: "Model Pharma Distributors", contacts: [], auto: false },
  { id: "d5", name: "Test Motors", contacts: [
    { id: "k5", name: "Sunita", role: "Accounts", email: "sunita@testmotors.example", wa: "", byEmail: true, byWa: false }], auto: false },
];

const H = (at, what) => ({ at, what });
export const FINDINGS = [
  // ---- Resolved by FinCom overnight
  { id: "f1", cid: "d1", kind: "advance", state: "resolved", says: "₹1,20,000 advance to XYZ Logistics on 02-Sep is no longer open.",
    how: "The bill of the same amount came later and is in the books.", evidence: [{ t: "entry", label: "Purchase 418 · 14-Oct · XYZ Logistics · ₹1,20,000" }, { t: "rule", label: "Same party, amount within ₹1, dated after the advance" }] },
  { id: "f2", cid: "d1", kind: "bank", state: "resolved", says: "₹18,450 paid on 07-Nov (UPI, “GST PMT”) had no entry.",
    how: "It is the GST paid for October.", evidence: [{ t: "doc", label: "GST challan, CIN ending 4471 · ₹18,450 · 07-Nov" }, { t: "rule", label: "Amount and date match the challan exactly" }] },
  { id: "f3", cid: "d1", kind: "unusual", state: "resolved", says: "Rent ₹45,000 on 01-Nov looked like a round sum.",
    how: "The same amount is paid to the same party every month since April.", evidence: [{ t: "entry", label: "8 earlier payments to Sample Properties, ₹45,000 each" }] },
  { id: "f4", cid: "d3", kind: "2b", state: "resolved", says: "A bill of ₹36,580 from Sample Supplier Co is in 2B for October but not in the books.",
    how: "The bill was in the Inbox. FinCom made a draft entry: see Entries ready for you.", evidence: [{ t: "doc", label: "Inbox: bill SSC/1093, read 19-Nov · ₹36,580" }, { t: "2b", label: "2B Oct-2026: same GSTIN, number and amount" }] },
  { id: "f5", cid: "d3", kind: "salary", state: "resolved", says: "October’s salary sheet was missing.",
    how: "It arrived by email on 18-Nov and is now read.", evidence: [{ t: "doc", label: "Inbox: Salary Oct-2026.xlsx · 14 people · ₹3,12,400" }] },
  { id: "f6", cid: "d5", kind: "bank", state: "resolved", says: "₹26,500 received on 10-Nov had no invoice.",
    how: "It pays sales invoice TM/2026/211 in full.", evidence: [{ t: "entry", label: "Sales TM/2026/211 · 28-Oct · ₹26,500" }, { t: "rule", label: "Same customer, amount within ₹1, no other invoice fits" }] },
  { id: "f7", cid: "d2", kind: "bank", state: "resolved", says: "₹9,800 paid on 05-Nov had no bill.",
    how: "Your bank rule “Electricity” sets it.", evidence: [{ t: "rule", label: "Bank rule: narration has “BSES” → Electricity" }] },

  // ---- Still need from client
  { id: "f10", cid: "d1", kind: "advance", state: "ask", says: "Advance still open after 60 days.",
    ask: { id: "q1", state: "draft", text: "₹2,50,000 advance to ABC Traders on 12-Aug is still open. Has the bill come?", history: [H("2026-11-21T02:10", "Made by the night check")] } },
  { id: "f11", cid: "d1", kind: "bank", state: "ask", says: "Payment with no bill or entry.",
    ask: { id: "q2", state: "draft", text: "₹48,000 paid to Ramesh on 05-Nov: what is it for? A bill, salary or advance?", history: [H("2026-11-21T02:10", "Made by the night check: no bill, salary line, challan or rule fits")] } },
  { id: "f12", cid: "d1", kind: "month", state: "ask", says: "No bank statement for October (HDFC ending 2231).",
    ask: { id: "q3", state: "draft", text: "Please send the HDFC bank statement (account ending 2231) for October 2026.", history: [H("2026-11-21T02:10", "Made by the night check: not in the Inbox or the books")] } },
  { id: "f13", cid: "d1", kind: "unusual", state: "ask", says: "Big cash payment.",
    ask: { id: "q4", state: "asked", text: "₹15,000 paid in cash to Sample Hardware on 03-Nov. Please send the bill.", history: [H("2026-11-14T02:10", "Made by the night check"), H("2026-11-17T10:42", "Asked by email to accounts@sampletraders.example")] } },
  { id: "f14", cid: "d2", kind: "salary", state: "ask", says: "No salary sheet for October.",
    ask: { id: "q5", state: "draft", text: "Please send the salary sheet for October 2026.", history: [H("2026-11-21T02:10", "Made by the night check: not in the Inbox")] } },
  { id: "f15", cid: "d2", kind: "sales", state: "ask", says: "No sales in the books for October.",
    ask: { id: "q6", state: "answered", text: "There are no sales in the books for October 2026. Were there none, or are the bills still to come?", answer: "Shop was closed for renovation, no sales.",
      history: [H("2026-11-07T02:10", "Made by the night check"), H("2026-11-10T09:15", "Asked on WhatsApp to Rakesh"), H("2026-11-12T18:03", "Answered: typed in by Asha (staff)")] } },
  { id: "f16", cid: "d5", kind: "advance", state: "ask", says: "Party with a balance on the wrong side.",
    ask: { id: "q7", state: "closed", text: "₹62,000 is shown as paid in advance to Sample Tyres. Is a bill pending?", closedBy: "doc",
      history: [H("2026-11-07T02:10", "Made by the night check"), H("2026-11-10T11:20", "Asked by email to sunita@testmotors.example"), H("2026-11-19T16:48", "Closed by itself: bill ST/884 for ₹62,000 arrived in the Inbox")] } },
  { id: "f17", cid: "d5", kind: "unusual", state: "ask", says: "Expense jump.",
    ask: { id: "q8", state: "draft", text: "Repairs were ₹1,84,000 in October, against about ₹22,000 a month before. What was repaired?", history: [H("2026-11-21T02:10", "Made by the night check: 3-month average ₹21,900")] } },

  // ---- Needs you
  { id: "f20", cid: "d1", kind: "bank", state: "you", says: "₹75,000 received on 12-Nov fits two invoices.", tie: ["Sales 1204 · Sample Retail · ₹75,000 · 30-Oct", "Sales 1211 · Sample Retail · ₹75,000 · 04-Nov"],
    note: "FinCom does not pick one. Choose, or leave it open." },
  { id: "f21", cid: "d3", kind: "advance", state: "you", says: "Advance of ₹40,000 to Sample Packaging: a bill of ₹40,001.50 came later.", note: "₹1.50 off, more than ₹1. Not resolved by itself. Is it the same?" },
  { id: "f22", cid: "d4", kind: "contacts", state: "you", says: "3 questions for Model Pharma Distributors cannot be sent.", note: "No email or WhatsApp number for this client.", act: "contacts" },
  { id: "f23", cid: "d2", kind: "unusual", state: "you", says: "Suspense has ₹12,300 left since 30-Sep.", note: "Clear it with an entry, or ask the client." },
];

export const ENTRIES = [
  { id: "e1", cid: "d3", src: "2b_inbox", type: "Purchase", date: "2026-10-22", no: "SSC/1093", party: "Sample Supplier Co",
    lines: [{ l: "Sample Supplier Co", cr: 36580 }, { l: "Purchase @18%", dr: 31000 }, { l: "Input CGST 9%", dr: 2790 }, { l: "Input SGST 9%", dr: 2790 }],
    narr: "Bill SSC/1093 dt 22-Oct-2026, packing material", why: "In 2B for October, not in the books. The bill is in the Inbox.",
    evidence: [{ t: "doc", label: "Inbox: bill SSC/1093 · ₹36,580" }, { t: "2b", label: "2B Oct-2026 · same GSTIN, number and tax" }],
    checks: ["Dr = Cr", "Ledgers are in Tally", "Not in a closed period", "No duplicate bill", "GST adds up"] },
  { id: "e2", cid: "d1", src: "bank_self", type: "Payment", date: "2026-11-07", no: "", party: "GST",
    lines: [{ l: "GST Cash Ledger", dr: 18450 }, { l: "HDFC Bank 2231", cr: 18450 }],
    narr: "GST paid for Oct-2026, CIN ending 4471", why: "The bank line matches the GST challan exactly.",
    evidence: [{ t: "doc", label: "GST challan · CIN ending 4471 · ₹18,450" }, { t: "entry", label: "Bank line 07-Nov · “GST PMT” · ₹18,450" }],
    checks: ["Dr = Cr", "Ledgers are in Tally", "Not in a closed period", "No duplicate entry"] },
  { id: "e3", cid: "d5", src: "bank_self", type: "Receipt", date: "2026-11-10", no: "", party: "Sample Retail Hub",
    lines: [{ l: "ICICI Bank 0412", dr: 26500 }, { l: "Sample Retail Hub", cr: 26500, ref: "against TM/2026/211" }],
    narr: "Received against invoice TM/2026/211", why: "The amount pays one open invoice of this customer in full.",
    evidence: [{ t: "entry", label: "Sales TM/2026/211 · 28-Oct · ₹26,500" }, { t: "rule", label: "Same customer, within ₹1, only one invoice fits" }],
    checks: ["Dr = Cr", "Ledgers are in Tally", "Not in a closed period", "No duplicate entry"] },
];

// what phase 2 adds to the same list (shown greyed, "coming")
export const COMING = [
  { k: "gstsetoff", label: "GST set-off journal", note: "Each month after GSTR-3B is filed." },
  { k: "payroll", label: "Payroll journal", note: "From the salary sheet, each month." },
];

export const STATE_WORD = { draft: "Draft", asked: "Asked", answered: "Answered", closed: "Closed" };
export const STATE_TAG = { draft: "no", asked: "info", answered: "warn", closed: "ok" };
export const WEEK = "16-Nov-2026";
