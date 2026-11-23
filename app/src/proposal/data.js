// Made-up data for the design proposal mockups. No real firm, client, party or figure.
export const FIRM = { name: "Iyer & Rao Associates", user: "Anil", initials: "AI", clients: 24 };

export const CLIENT = {
  name: "Kaveri Home Decor Pvt Ltd", short: "Kaveri Home Decor", initials: "KH", gstin: "07AAJCK4821M1Z5",
  state: "Delhi", fy: "FY 2026-27", tally: "Kaveri Home Decor (2026-27)",
};

// Money in and out by month, in rupees (made up)
export const FLOW = [
  { m: "Jun", in: 1080000, out: 920000 },
  { m: "Jul", in: 1215000, out: 1010000 },
  { m: "Aug", in: 990000, out: 1040000 },
  { m: "Sep", in: 1360000, out: 1120000 },
  { m: "Oct", in: 1525000, out: 1190000 },
  { m: "Nov", in: 1243500, out: 984200 },
];

export const BANKS = [
  { name: "HDFC Bank", no: "4521", bal: 1842300, asOf: "21-Nov-2026" },
  { name: "ICICI Bank", no: "0099", bal: 520150, asOf: "21-Nov-2026" },
];

// the firm's to-dos across clients (Home)
export const TODOS = [
  { c: "Shree Ganesh Traders", ci: "SG", task: "GSTR-3B for Oct", due: "Overdue 2 days", tone: "bad", st: "problem", act: "File now" },
  { c: "Nilgiri Foods LLP", ci: "NF", task: "GSTR-3B for Oct: 3 bills not in 2B", due: "Overdue 2 days", tone: "bad", st: "review", act: "Review" },
  { c: "Kaveri Home Decor", ci: "KH", task: "12 bank lines to confirm", due: "Today", tone: "warn", st: "review", act: "Review" },
  { c: "Patil Auto Spares", ci: "PA", task: "Client to send 4 missing purchase bills", due: "Asked 3 days ago", tone: "muted", st: "new", act: "Remind" },
  { c: "Mehra Textiles", ci: "MT", task: "28 entries ready for Tally", due: "Today", tone: "warn", st: "ready", act: "Post" },
  { c: "Arora Pharma Distributors", ci: "AP", task: "TDS for Nov: 6 deductions, ₹38,400", due: "Due 7-Dec", tone: "muted", st: "ready", act: "Pay" },
  { c: "Sunrise Clinics", ci: "SC", task: "ITR-3 for Dr. R. Menon: Form 26AS differs by ₹12,000", due: "Due 31-Dec", tone: "muted", st: "review", act: "Open" },
];

export const OVERNIGHT_FIRM = [
  { n: 38, t: "bills read from email and WhatsApp" },
  { n: 212, t: "bank lines matched to ledgers" },
  { n: 54, t: "entries posted to Tally" },
  { n: 3, t: "duplicate bills caught before posting" },
];

export const DUES = [
  { d: "7-Dec", w: "TDS deposit for Nov", n: "11 clients", tone: "muted" },
  { d: "11-Dec", w: "GSTR-1 for Nov", n: "18 clients", tone: "muted" },
  { d: "15-Dec", w: "Advance tax, 3rd instalment", n: "9 clients", tone: "muted" },
  { d: "20-Dec", w: "GSTR-3B for Nov", n: "18 clients", tone: "muted" },
];

export const OVERNIGHT_CLIENT = [
  { icon: "read", t: "Read 9 purchase bills", s: "from accounts@kaveri… and WhatsApp" },
  { icon: "bank", t: "Matched 41 of 53 HDFC lines", s: "12 need you: new parties" },
  { icon: "tally", t: "Posted 22 entries to Tally", s: "Kaveri Home Decor (2026-27)" },
  { icon: "gst", t: "Checked GSTR-2B for Oct", s: "2 bills missing from the supplier's filing" },
];

export const NEXT = [
  { t: "Confirm 12 bank lines", s: "HDFC ••4521 · mostly new parties", b: "Review lines", tone: "warn" },
  { t: "Pay TDS for Nov", s: "₹24,500 under 194C and 194J · due 7-Dec", b: "Make challan", tone: "info" },
  { t: "File GSTR-1 for Nov", s: "86 invoices ready · due 11-Dec", b: "Check and file", tone: "info" },
];

// Bank lines (HDFC, Nov)
export const LINES = [
  { id: 1, d: "21-Nov", desc: "NEFT-HDFC0001234-GUPTA PACKAGING PVT LTD", led: "Gupta Packaging Pvt Ltd", sug: true, out: 47200, in: 0, st: "review",
    match: { what: "Bill PB/1123 from Gupta Packaging Pvt Ltd", amt: 47200, date: "18-Nov-2026", why: "Same amount, party name in the narration" } },
  { id: 2, d: "21-Nov", desc: "UPI/CR/432198765/AMAZON SELLER SERVICES", led: "Amazon Seller Services (Debtor)", sug: true, out: 0, in: 186420, st: "review" },
  { id: 3, d: "20-Nov", desc: "ACH D-BAJAJ FINANCE LTD-EMI 3341", led: "Bajaj Finance Loan A/c", sug: true, out: 18650, in: 0, st: "ready" },
  { id: 4, d: "20-Nov", desc: "IMPS-P2A-SWIFT FREIGHT CARRIERS", led: "", sug: false, out: 12400, in: 0, st: "review" },
  { id: 5, d: "19-Nov", desc: "NEFT CR-FLIPKART INTERNET PVT LTD", led: "Flipkart Internet (Debtor)", sug: false, out: 0, in: 242800, st: "done" },
  { id: 6, d: "19-Nov", desc: "GST PMT CPIN 26110700123456", led: "GST Payable (Electronic Cash)", sug: false, out: 182340, in: 0, st: "done" },
  { id: 7, d: "18-Nov", desc: "CHQ DEP 004512 - RITU ENTERPRISES", led: "Ritu Enterprises", sug: false, out: 0, in: 64900, st: "done" },
  { id: 8, d: "18-Nov", desc: "POS 4521XXXX STAPLES OFFICE NEHRU PL", led: "Office Expenses", sug: true, out: 3460, in: 0, st: "ready" },
  { id: 9, d: "17-Nov", desc: "NEFT-RENT NOV-MALHOTRA PROPERTIES", led: "Rent (TDS 194-I)", sug: false, out: 90000, in: 0, st: "problem", why: "Tally refused: ledger ‘Rent’ is closed" },
  { id: 10, d: "16-Nov", desc: "SALARY NOV-BULK 18 EMPLOYEES", led: "Salaries Payable", sug: false, out: 412600, in: 0, st: "done" },
];

export const SEARCH = [
  { g: "Clients", items: [{ t: "Sharma Steel Traders", s: "Client · GSTIN 07ABCFS1234K1Z9 · Delhi" }] },
  { g: "Parties", items: [{ t: "Sharma Transport Co", s: "Supplier in 3 clients · Kaveri, Mehra, Patil" }, { t: "Sharma & Sons Hardware", s: "Customer · Patil Auto Spares" }] },
  { g: "Invoices", items: [{ t: "SST/26-27/0412", s: "Sharma Steel Traders → Mehra Textiles · ₹1,18,000 · 14-Nov-2026" }, { t: "ST/1187", s: "Sharma Transport Co · bill to Kaveri Home Decor · ₹23,600 · 9-Nov-2026" }] },
  { g: "Ledgers", items: [{ t: "Sharma Transport Co", s: "Sundry Creditors · Kaveri Home Decor · balance ₹47,200 Cr" }] },
  { g: "Do", items: [{ t: "New bill from Sharma Transport Co", s: "Opens a bill with the party filled in" }] },
];

export const TALLY_COS = [
  { co: "Kaveri Home Decor (2026-27)", cl: "Kaveri Home Decor Pvt Ltd", st: "done", last: "2 min ago" },
  { co: "Mehra Textiles 26-27", cl: "Mehra Textiles", st: "done", last: "2 min ago" },
  { co: "Shree Ganesh Traders", cl: "Shree Ganesh Traders", st: "done", last: "5 min ago" },
  { co: "Nilgiri Foods LLP FY27", cl: "Nilgiri Foods LLP", st: "done", last: "5 min ago" },
  { co: "Patil Auto Spares", cl: "", st: "review", last: "—" },
  { co: "ARORA PHARMA (NEW)", cl: "", st: "review", last: "—" },
];
