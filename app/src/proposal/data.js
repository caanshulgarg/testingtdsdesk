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

// Uploaded bank statements, newest first, by account (made up). open/close chain: each opening = the previous closing.
// gap: a month with no statement; overlap: a period that covers part of another statement; chainBad: opening ≠ previous closing
export const STATEMENTS = [
  { acct: "4521", bank: "HDFC Bank", kind: "Current account", span: "Apr–Nov 2026", rows: [
    { id: "h11", from: "1-Nov", to: "21-Nov-2026", mon: "Nov 2026", file: "HDFC_4521_Nov2026.pdf", up: "22-Nov-2026", by: "Anil", n: 248, open: 1721064, close: 1842300, ok: true, done: 204, st: "review" },
    { gap: true, mon: "Oct 2026", from: "1-Oct", to: "31-Oct-2026" },
    { id: "h09", from: "1-Sep", to: "30-Sep-2026", mon: "Sep 2026", file: "Acct_Statement_XX4521_01092026_30092026.xlsx", up: "3-Oct-2026", by: "Priya", n: 231, open: 1456905, close: 1588230, ok: true, done: 231, st: "done" },
    { id: "h08", from: "1-Aug", to: "31-Aug-2026", mon: "Aug 2026", file: "HDFC_4521_Aug2026.pdf", up: "4-Sep-2026", by: "Priya", n: 212, open: 1302775, close: 1456905, ok: true, done: 190, st: "ready" },
    { id: "h07", from: "1-Jul", to: "31-Jul-2026", mon: "Jul 2026", file: "HDFC_4521_Jul2026_scan.pdf", up: "6-Aug-2026", by: "Client by email", n: 239, open: 1094140, close: 1302775, ok: false, done: 180, st: "problem",
      why: "Opening ₹10,94,140 is not June's closing ₹10,97,640. A page may be missing from the PDF." },
    { id: "h06", from: "1-Jun", to: "30-Jun-2026", mon: "Jun 2026", file: "HDFC_4521_Jun2026.pdf", up: "3-Jul-2026", by: "Priya", n: 204, open: 1248310, close: 1097640, ok: true, done: 204, st: "done" },
    { id: "h05", from: "1-May", to: "31-May-2026", mon: "May 2026", file: "HDFC_4521_May2026.pdf", up: "4-Jun-2026", by: "Anil", n: 226, open: 1106820, close: 1248310, ok: true, done: 226, st: "done" },
    { id: "h04", from: "1-Apr", to: "30-Apr-2026", mon: "Apr 2026", file: "HDFC_4521_Apr2026.pdf", up: "5-May-2026", by: "Anil", n: 218, open: 912450, close: 1106820, ok: true, done: 218, st: "done" },
  ] },
  { acct: "0099", bank: "ICICI Bank", kind: "Current account", span: "Aug–Nov 2026", rows: [
    { id: "i11", from: "15-Oct", to: "21-Nov-2026", mon: "Oct–Nov 2026", file: "OpTransactionHistory22-11-2026.xls", up: "22-Nov-2026", by: "Client by email", n: 96, open: 479410, close: 520150, ok: true, done: 0, st: "new",
      overlap: "Overlaps 15–31 Oct with the October statement. 38 lines are in both; FinCom keeps one copy of each." },
    { id: "i10", from: "1-Oct", to: "31-Oct-2026", mon: "Oct 2026", file: "ICICI_0099_Oct2026.pdf", up: "4-Nov-2026", by: "Priya", n: 69, open: 461305, close: 498770, ok: true, done: 69, st: "done" },
    { id: "i09", from: "1-Sep", to: "30-Sep-2026", mon: "Sep 2026", file: "ICICI_0099_Sep2026.pdf", up: "3-Oct-2026", by: "Priya", n: 71, open: 412980, close: 461305, ok: true, done: 71, st: "done" },
    { id: "i08", from: "1-Aug", to: "31-Aug-2026", mon: "Aug 2026", file: "ICICI_0099_Aug2026.csv", up: "2-Sep-2026", by: "Anil", n: 64, open: 384600, close: 412980, ok: true, done: 64, st: "done" },
  ] },
];

// the Tally computer's ports, as FinCom Bridge sees them (made up)
export const PORTS = [
  { p: ["9103"], t: "ok", st: "FinCom Bridge", d: "Connected" },
  { p: ["9002"], t: "ok", st: "Your Tally, in use", d: "Company open, linked", more: "Kaveri Home Decor (2026-27) · TallyPrime 5.1 · Windows user anil" },
  { p: ["1950", "2022", "2929", "3543", "9000"], t: "muted", st: "In use by another Windows user", d: "Not used by FinCom; company names hidden",
    more: "Other people signed in to this computer run their own Tally. FinCom does not read or post to them." },
  { p: ["9001"], t: "free", st: "Free", d: "Can be used for a new Tally" },
];

// The Bank lines with everything today's page shows (feature parity, owner's review of 22-Nov-2026). Newest first.
// src: where the ledger came from (the same words as today: Booked before, Similar past entry, Your rule, Bill …,
// Sales invoice …, Bank account match, Name match, UPI match, used by your other clients, Claude, Set by you)
export const BLINES = [
  { id: 1, d: "21-Nov", party: "Gupta Packaging Pvt Ltd", mode: "NEFT", ref: "UTR N325112345678", narr: "NEFT-HDFC0001234-GUPTA PACKAGING PVT LTD-INV 1123", led: "Gupta Packaging Pvt Ltd", src: "Bill match", link: "Bill PB/1123", vt: "Payment", out: 47200, in: 0, st: "review", sim: 3 },
  { id: 2, d: "21-Nov", party: "Amazon Seller Services", mode: "UPI", ref: "432198765012", narr: "UPI/CR/432198765012/AMAZON SELLER SERVICES/settlement", led: "Amazon Seller Services (Debtor)", src: "Booked before", link: "", vt: "Receipt", out: 0, in: 186420, st: "review" },
  { id: 3, d: "20-Nov", party: "Bajaj Finance Ltd", mode: "NACH", ref: "EMI 3341", narr: "ACH D-BAJAJ FINANCE LTD-EMI 3341", led: "Bajaj Finance Loan A/c", src: "Your rule", link: "", vt: "Payment", out: 18650, in: 0, st: "ready" },
  { id: 4, d: "20-Nov", party: "Swift Freight Carriers", mode: "IMPS", ref: "P2A 632410987", narr: "IMPS-P2A-632410987-SWIFT FREIGHT CARRIERS-LR 5521", led: "", src: "", newLed: "Swift Freight Carriers · Sundry Creditors", tds: "194C ₹124", link: "", vt: "Payment", out: 12400, in: 0, st: "review" },
  { id: 11, d: "20-Nov", party: "Sharma Stationery", mode: "UPI", ref: "432177120044", narr: "UPI/DR/432177120044/sharmastationery@okaxis", led: "Sharma Stationery", src: "UPI match", link: "", vt: "Payment", out: 2360, in: 0, st: "review", sim: 2 },
  { id: 5, d: "19-Nov", party: "Flipkart Internet Pvt Ltd", mode: "NEFT", ref: "UTR CITIN26111900321", narr: "NEFT CR-CITI0000002-FLIPKART INTERNET PVT LTD", led: "Flipkart Internet (Debtor)", src: "Sales invoice", link: "Inv SI/26-27/0841", vt: "Receipt", out: 0, in: 242800, st: "done", posted: "Receipt 1182 · 19-Nov, Priya" },
  { id: 6, d: "19-Nov", party: "GST payment", mode: "NEFT", ref: "CPIN 26110700123456", narr: "GST PMT CPIN 26110700123456", led: "GST Payable (Electronic Cash)", src: "Your rule · firm-wide", link: "", vt: "Payment", out: 182340, in: 0, st: "done", posted: "Payment 2210 · 19-Nov, auto" },
  { id: 7, d: "18-Nov", party: "Ritu Enterprises", mode: "Cheque", ref: "Chq 004512", narr: "CHQ DEP 004512 - RITU ENTERPRISES - CTS CLG", led: "Ritu Enterprises", src: "Similar past entry", link: "Inv SI/26-27/0822", vt: "Receipt", out: 0, in: 64900, st: "done", posted: "Receipt 1179 · 18-Nov, Anil" },
  { id: 8, d: "18-Nov", party: "Staples Office", mode: "Card", ref: "POS 4521XXXX", narr: "POS 4521XXXX STAPLES OFFICE NEHRU PL", led: "Office Expenses", src: "Booked before", split: "Office Expenses ₹2,932 + Input GST ₹528", link: "", vt: "Payment", out: 3460, in: 0, st: "ready" },
  { id: 9, d: "17-Nov", party: "Malhotra Properties", mode: "NEFT", ref: "UTR N321117004455", narr: "NEFT-RENT NOV-MALHOTRA PROPERTIES", led: "Rent (TDS 194-I)", src: "Your rule", tds: "194-I ₹10,000", link: "", vt: "Payment", out: 90000, in: 0, st: "problem", why: "Tally refused: ledger ‘Rent’ is closed" },
  { id: 12, d: "17-Nov", party: "", mode: "ATM", ref: "CDM 0412", narr: "BY CASH DEP CDM 0412 NEHRU PLACE", led: "Cash", src: "Name match", link: "", vt: "Contra", out: 0, in: 25000, st: "ready", repaired: true },
  { id: 10, d: "16-Nov", party: "Salaries · 18 employees", mode: "NEFT", ref: "BULK 1611", narr: "SALARY NOV-BULK 18 EMPLOYEES", led: "Salaries Payable", src: "Your rule · firm-wide", link: "", vt: "Payment", out: 412600, in: 0, st: "done", posted: "Payment 2196 · 16-Nov, Anil" },
];

// Rules tab: what FinCom found in past work, the client's own rules, the firm's (made up)
export const RULE_SUGG = [
  { when: "BAJAJ FINANCE", dir: "out", led: "Bajaj Finance Loan A/c", n: 7, agree: 100 },
  { when: "AMAZON SELLER SERVICES", dir: "in", led: "Amazon Seller Services (Debtor)", n: 12, agree: 100 },
  { when: "STAPLES OFFICE", dir: "out", led: "Office Expenses", n: 4, agree: 75 },
];
export const RULES = [
  { name: "Rent to Malhotra", when: "says MALHOTRA PROPERTIES · going out", does: "Rent (TDS 194-I)", extra: "TDS 194-I 10% at payment", kind: "Written", now: 1, used: 8 },
  { name: "Bajaj EMI", when: "says BAJAJ FINANCE · going out", does: "Bajaj Finance Loan A/c", kind: "Learned", now: 1, used: 7 },
  { name: "Swiggy and Zomato", when: "says SWIGGY or ZOMATO · going out", does: "Staff Welfare", kind: "Written", now: 0, used: 14 },
  { name: "Bank charges", when: "says CHGS or CHARGES · going out", does: "Set aside", kind: "Written", now: 2, used: 22, aside: true },
  { name: "Staples", when: "says STAPLES · going out", does: "Office Expenses", extra: "split: Input GST 18%", kind: "Learned", now: 1, used: 4, over: 1 },
];
export const FIRM_RULES = [
  { name: "GST payments", when: "says GST PMT CPIN", does: "GST Payable (Electronic Cash)", kind: "Written", now: 1, used: 96 },
  { name: "Salaries", when: "says SALARY · going out", does: "Salaries Payable", kind: "Written", now: 1, used: 61 },
  { name: "Interest credited", when: "says INT.PD or INTEREST · coming in", does: "Bank Interest", kind: "Written", now: 0, used: 40 },
];
