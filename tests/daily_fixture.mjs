// Made-up data for Daily Check (next-assistant): the message test and the screenshots. Every name, number, address and phone is
// invented. Phase 1 reads the same shape from the cloud (night_findings, client_asks, night_entries:
// docs/ASSISTANT-PHASE1.md).
//   finding.state  "resolved" Done by FinCom (exact rule-based match, with evidence, can be undone)
//                  "ask"      From clients: the question `ask` (draft, asked, answered, closed)
//                  "you"      Needs you: two that fit, a near miss, or something only the firm decides
export const RUN = { at: "2026-11-21T02:10:00+05:30", clients: 5 };
export const FIRM = { name: "Sample & Co, Chartered Accountants", email: "office@samplefirm.example", wa: "+91 90000 00000" };

export const CLIENTS = [
  { id: "d1", name: "Sample Traders Pvt Ltd", contacts: [
    { id: "k1", name: "Anil Kumar", role: "Accounts", email: "accounts@sampletraders.example", wa: "+91 90000 11111", byEmail: true, byWa: true },
    { id: "k2", name: "Priya Mehta", role: "Director", email: "priya@sampletraders.example", wa: "", byEmail: true, byWa: false }] },
  { id: "d2", name: "Demo Textiles LLP", contacts: [{ id: "k3", name: "Rakesh", role: "Owner", email: "", wa: "+91 90000 22222", byEmail: false, byWa: true }] },
  { id: "d3", name: "Example Foods", contacts: [{ id: "k4", name: "Office", role: "Accounts", email: "office@examplefoods.example", wa: "+91 90000 33333", byEmail: true, byWa: true }] },
  { id: "d4", name: "Model Pharma Distributors", contacts: [] },
  { id: "d5", name: "Test Motors", contacts: [{ id: "k5", name: "Sunita", role: "Accounts", email: "sunita@testmotors.example", wa: "", byEmail: true, byWa: false }] },
];

const H = (at, what) => ({ at, what });
const q = (id, state, text, history, more) => Object.assign({ id, state, text, history }, more);
export const FINDINGS = [
  // Done by FinCom
  { id: "f1", cid: "d1", state: "resolved", amt: 120000, party: "XYZ Logistics", date: "02-Sep", short: "Advance: bill found",
    evidence: [{ t: "entry", label: "Purchase 418 · 14-Oct · ₹1,20,000" }, { t: "rule", label: "Same party, within ₹1, dated after" }] },
  { id: "f2", cid: "d1", state: "resolved", amt: 18450, party: "GST", date: "07-Nov", short: "Bank line: GST challan",
    evidence: [{ t: "doc", label: "Challan, CIN ending 4471 · ₹18,450" }] },
  { id: "f3", cid: "d1", state: "resolved", amt: 45000, party: "Sample Properties", date: "01-Nov", short: "Round sum: monthly rent",
    evidence: [{ t: "entry", label: "8 earlier payments of ₹45,000" }] },
  { id: "f4", cid: "d3", state: "resolved", amt: 36580, party: "Sample Supplier Co", date: "22-Oct", short: "2B bill: in Inbox, entry made",
    evidence: [{ t: "doc", label: "Inbox: bill SSC/1093 · ₹36,580" }, { t: "2b", label: "2B Oct · same GSTIN, number, amount" }] },
  { id: "f5", cid: "d3", state: "resolved", amt: 312400, party: "Salary", date: "Oct", short: "Salary sheet: arrived",
    evidence: [{ t: "doc", label: "Inbox: Salary Oct-2026.xlsx · 14 people" }] },
  { id: "f6", cid: "d5", state: "resolved", amt: 26500, party: "Sample Retail Hub", date: "10-Nov", short: "Receipt: invoice found",
    evidence: [{ t: "entry", label: "Sales TM/2026/211 · 28-Oct · ₹26,500" }] },
  { id: "f7", cid: "d2", state: "resolved", amt: 9800, party: "Electricity", date: "05-Nov", short: "Bank line: your rule",
    evidence: [{ t: "rule", label: "Rule: “BSES” → Electricity" }] },

  // From clients
  { id: "f10", cid: "d1", state: "ask", amt: 250000, party: "ABC Traders", date: "12-Aug", short: "Advance open. Bill come?",
    ask: q("q1", "draft", "₹2,50,000 advance to ABC Traders on 12-Aug is still open. Has the bill come?", [H("2026-11-21T02:10", "Found by the night check")]) },
  { id: "f11", cid: "d1", state: "ask", amt: 48000, party: "Ramesh", date: "05-Nov", short: "Paid for what?",
    ask: q("q2", "draft", "₹48,000 paid to Ramesh on 05-Nov: what is it for? A bill, salary or advance?", [H("2026-11-21T02:10", "Found by the night check")]) },
  { id: "f12", cid: "d1", state: "ask", amt: 0, party: "HDFC 2231", date: "Oct", short: "Statement missing",
    ask: q("q3", "draft", "Please send the HDFC bank statement (account ending 2231) for October 2026.", [H("2026-11-21T02:10", "Found by the night check")]) },
  { id: "f13", cid: "d1", state: "ask", amt: 15000, party: "Sample Hardware", date: "03-Nov", short: "Cash. Bill?",
    ask: q("q4", "asked", "₹15,000 paid in cash to Sample Hardware on 03-Nov. Please send the bill.", [H("2026-11-14T02:10", "Found by the night check"), H("2026-11-17T10:42", "Emailed to accounts@sampletraders.example")]) },
  { id: "f14", cid: "d2", state: "ask", amt: 0, party: "Salary", date: "Oct", short: "Salary sheet missing",
    ask: q("q5", "draft", "Please send the salary sheet for October 2026.", [H("2026-11-21T02:10", "Found by the night check")]) },
  { id: "f15", cid: "d2", state: "ask", amt: 0, party: "Sales", date: "Oct", short: "No sales?",
    ask: q("q6", "answered", "There are no sales in the books for October 2026. Were there none, or are the bills still to come?",
      [H("2026-11-07T02:10", "Found by the night check"), H("2026-11-10T09:15", "WhatsApp to Rakesh"), H("2026-11-12T18:03", "Reply: “Shop closed for renovation.”")]) },
  { id: "f16", cid: "d5", state: "ask", amt: 62000, party: "Sample Tyres", date: "Nov", short: "Debit balance. Bill?",
    ask: q("q7", "closed", "₹62,000 is shown as paid in advance to Sample Tyres. Is a bill pending?",
      [H("2026-11-07T02:10", "Found by the night check"), H("2026-11-10T11:20", "Emailed to sunita@testmotors.example"), H("2026-11-19T16:48", "Closed: bill ST/884 came into the Inbox")]) },
  { id: "f17", cid: "d5", state: "ask", amt: 184000, party: "Repairs", date: "Oct", short: "8× usual. What for?",
    ask: q("q8", "draft", "Repairs were ₹1,84,000 in October, against about ₹22,000 a month before. What was repaired?", [H("2026-11-21T02:10", "Found by the night check")]) },

  // Needs you
  { id: "f20", cid: "d1", state: "you", title: "₹75,000 received 12-Nov · which invoice?",
    choices: ["Sales 1204 · 30-Oct · ₹75,000", "Sales 1211 · 04-Nov · ₹75,000"] },
  { id: "f21", cid: "d3", state: "you", title: "₹40,000 advance · bill of ₹40,001.50 · same?", choices: ["Bill SPK/220 · 02-Nov · ₹40,001.50"] },
  { id: "f22", cid: "d4", state: "you", title: "3 questions · no contact", act: "Add contact" },
  { id: "f23", cid: "d2", state: "you", title: "Suspense ₹12,300 since 30-Sep", choices: [] },
];

export const ENTRIES = [
  { id: "e1", cid: "d3", type: "Purchase", date: "22-Oct", party: "Sample Supplier Co", amt: 36580, reason: "2B bill in Inbox",
    lines: [{ l: "Purchase @18%", dr: 31000 }, { l: "Input CGST 9%", dr: 2790 }, { l: "Input SGST 9%", dr: 2790 }, { l: "Sample Supplier Co", cr: 36580 }],
    narr: "Bill SSC/1093 dt 22-Oct-2026", evidence: [{ t: "doc", label: "Inbox: bill SSC/1093" }, { t: "2b", label: "2B Oct · same GSTIN, number, tax" }] },
  { id: "e2", cid: "d1", type: "Payment", date: "07-Nov", party: "GST", amt: 18450, reason: "Challan match",
    lines: [{ l: "GST Cash Ledger", dr: 18450 }, { l: "HDFC Bank 2231", cr: 18450 }],
    narr: "GST paid for Oct-2026", evidence: [{ t: "doc", label: "Challan, CIN ending 4471" }] },
  { id: "e3", cid: "d5", type: "Receipt", date: "10-Nov", party: "Sample Retail Hub", amt: 26500, reason: "Invoice match",
    lines: [{ l: "ICICI Bank 0412", dr: 26500 }, { l: "Sample Retail Hub", cr: 26500 }],
    narr: "Against invoice TM/2026/211", evidence: [{ t: "entry", label: "Sales TM/2026/211 · ₹26,500" }] },
];

export const CHECKS = "Dr = Cr · ledgers in Tally · not in a closed period · no duplicate · GST adds up";
export const STATE_WORD = { draft: "Draft", asked: "Asked", answered: "Answered", closed: "Closed" };
export const WEEK = "16-Nov-2026";

// the same made-up data as the cloud's rows (migration 206's tables), for the screenshots and the page's test: what
// Cloud.api answers for each table when the page is opened with a stand-in for the cloud
const MI = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const d8 = (s) => { const m = String(s).match(/^(\d{2})-([A-Z][a-z]{2})$/); if (m) return "2026" + String(MI[m[2]]).padStart(2, "0") + m[1]; const k = MI[s]; return k ? "2026" + String(k).padStart(2, "0") : ""; };
const uuid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export function dbRows() {
  let n = 0;
  const night_findings = [], client_asks = [];
  FINDINGS.filter((f) => !f.act).forEach((f) => {
    const id = uuid(++n);
    night_findings.push({ id, client_id: f.cid, kind: f.kind === "salary" ? "salary_month_missing" : "bank_no_bill", key: f.id, state: f.state,
      facts: { amt: f.amt || 0, party: f.party || "", date: d8(f.date || ""), short: f.short || "", title: f.title || "", ask_text: f.ask ? f.ask.text : "" },
      evidence: f.evidence || [], candidates: (f.choices || []).map((c, i) => ({ t: "entry", ref: f.id + ":" + i, label: c })), last_seen: "2026-11-22", undone_at: null });
    if (f.ask) client_asks.push({ id: uuid(100 + n), client_id: f.cid, finding_id: id, week: "2026-11-16", text: f.ask.text, edited: null, state: f.ask.state, answer: null, closed_by: f.ask.state === "closed" ? "document" : null,
      history: f.ask.history.map((h) => ({ at: h.at + ":00+05:30", what: h.what })), created_at: "2026-11-21T02:10:00+05:30" });
  });
  const night_entries = ENTRIES.map((e, i) => ({ id: uuid(500 + i), client_id: e.cid, finding_id: null, source: e.reason.startsWith("2B") ? "twob_inbox_bill" : "bank_self_answer", dedupe: e.id, work_ref: e.reason.startsWith("2B") ? e.id : "s1:r" + (i + 1),
    voucher: { type: e.type, date: d8(e.date), party: e.party, narration: e.narr, against: e.type === "Payment" ? e.lines[0].l : e.lines[e.lines.length - 1].l, bank: e.type === "Payment" ? e.lines[1].l : e.lines[0].l, lines: e.lines.map((l) => ({ ledger: l.l, dr: l.dr || 0, cr: l.cr || 0 })) }, reason: e.reason, why: e.reason,
    evidence: e.evidence, checks: ["drcr", "ledgers", "period", "duplicate"].concat(e.type === "Purchase" ? ["gst"] : []).map((k) => ({ k, ok: true })), state: "ready" }));
  const night_runs = CLIENTS.map((c) => ({ client_id: c.id, night: "2026-11-22", status: "ok", finished_at: "2026-11-22T02:16:00+05:30" }));
  const client_contacts = [];
  CLIENTS.forEach((c) => c.contacts.forEach((k) => client_contacts.push({ id: uuid(900 + client_contacts.length), client_id: c.id, name: k.name, role: k.role, email: k.email, whatsapp: k.wa, by_email: k.byEmail, by_whatsapp: k.byWa })));
  return { night_findings, client_asks, night_entries, night_runs, client_contacts, assistant_mail: [{ real_send: false, test_to: FIRM.email, test_whatsapp: FIRM.wa }], assistant_prefs: [], clients: CLIENTS.map((c) => ({ id: c.id, name: c.name })) };
}
