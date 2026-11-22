// node tests/itr_demo.mjs [out.json] [form] - the made-up client the Income Tax Return's screens are shown and tested with
// (window.__itrDemo): a proprietor's books as a trial balance with the statements' codes, run through books.js; the
// made-up portal files of tests/fixtures/itr brought in through the real readers and store; the owner's answers.
// Every name, PAN, TAN and figure is invented. form: ITR-3 (default), ITR-4, ITR-5, ITR-6.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { schedules, adjustments, pf36va, dues43B, msme43Bh } from "../app/src/lib/itr/books.js";
import { makeStore } from "../app/src/lib/itr/store.js";

const HERE = dirname(fileURLToPath(import.meta.url)), FX = join(HERE, "fixtures", "itr");
export const CODES = { "8A": { ppe: "gross" }, "8B": { ppe: "dep" } };

// a trial balance (debit +) whose figures are invented; the capital account balances it
export function demoRows(kind) {
  const r = [
    ["SECURED LOAN - DEMO BANK CC", "Bank OD A/c", "33A", -800000, -650000], ["SUNDRY CREDITORS", "Sundry Creditors", "6B", -1240000, -980000],
    ["GST PAYABLE", "Duties & Taxes", "7C", -40000, -32000], ["TDS PAYABLE", "Duties & Taxes", "7C", -25000, -21000], ["PF PAYABLE", "Duties & Taxes", "7C", -20000, -18000],
    ["PLANT AND MACHINERY", "Fixed Assets", "8A", 1800000, 1500000], ["ACCUMULATED DEPRECIATION", "Fixed Assets", "8B", -450000, -180000],
    ["STOCK IN HAND", "Stock-in-Hand", "39A", 960000, 820000], ["SUNDRY DEBTORS", "Sundry Debtors", "10A", 1430000, 1210000],
    ["CASH", "Cash-in-Hand", "11D", 85000, 62000], ["DEMO BANK CURRENT A/C", "Bank Accounts", "11A", 640000, 410000],
    ["TDS RECEIVABLE", "Loans & Advances (Asset)", "12B", 60200, 0], ["ADVANCE TAX", "Loans & Advances (Asset)", "12B", 40000, 0], ["ADVANCE TO SUPPLIERS", "Loans & Advances (Asset)", "12F", 120000, 90000], ["SECURITY DEPOSIT", "Deposits (Asset)", "12A", 50000, 50000],
    ["SALES", "Sales Accounts", "13B", -4500000, 0], ["SERVICE INCOME", "Sales Accounts", "13A", -400000, 0], ["INTEREST ON FD", "Indirect Incomes", "14A", -52000, 0],
    ["PURCHASES", "Purchase Accounts", "41A", 3150000, 0], ["CHANGE IN STOCK", "Direct Expenses", "42A", -140000, 0],
    ["SALARY", "Indirect Expenses", "15A", 480000, 0], ["EMPLOYER PF", "Indirect Expenses", "15B", 60480, 0], ["RENT", "Indirect Expenses", "17A", 240000, 0],
    ["TRAVELLING", "Indirect Expenses", "17C", 60000, 0], ["PROFESSIONAL FEES", "Indirect Expenses", "17E", 45000, 0], ["ELECTRICITY", "Indirect Expenses", "17K", 54000, 0],
    ["TELEPHONE", "Indirect Expenses", "17M", 18000, 0], ["BANK CHARGES", "Indirect Expenses", "17G", 6000, 0], ["MISC EXPENSES", "Indirect Expenses", "17J", 24000, 0],
    ["INTEREST ON CC", "Indirect Expenses", "16B", 72000, 0], ["DEPRECIATION", "Indirect Expenses", "8E", 270000, 0],
    ["DRAWINGS", "Capital Account", "3R", 360000, 0],
  ].map(([ledger, group, code, final, py]) => ({ ledger, group, code, final, py }));
  const bal = -r.reduce((s, x) => s + x.final, 0), balPy = -r.reduce((s, x) => s + x.py, 0);
  r.unshift({ ledger: "CAPITAL ACCOUNT", group: "Capital Account", code: "3P", final: bal, py: balPy });
  return r;
}

export async function demo(form = "ITR-3") {
  const ent = { "ITR-3": "P", "ITR-4": "P", "ITR-5": "F", "ITR-6": "C" }[form];
  const pan = { P: "ZZZPX9999Z", F: "ZZZFX9999Z", C: "ZZZCX9999Z" }[ent];
  const name = { P: "Demo Traders", F: "Demo Partners", C: "Demo Private Limited" }[ent];
  const rows = demoRows();
  const sched = schedules(rows, CODES);
  const booksObj = { cid: "demo1", itr: {} };
  const clients = [{ id: "demo1", name, pan }, { id: "demo2", name: "Other Demo Client", pan: "ZZZPY8888Y" }];
  const st = makeStore({ books: () => booksObj, save: async () => {}, clients: () => clients, open: () => ({ id: "demo1", name, pan, pfCode: "DLCPM0000001000", esiCode: "10000000000000001" }), firm: () => "demo-firm", user: () => "Owner",
    now: () => "2026-11-20T10:00:00.000Z", sha: async (b) => createHash("sha256").update(b).digest("hex"), upload: async () => ({ ok: true }), remove: async () => {} });
  const sw = (s) => s.replace(/ZZZPX9999Z/g, pan);
  for (const f of ["ais-demo.json", "26as-demo.txt", "prefill-demo.json", "ECR-04-2025.txt", "pf-challan-04-2025.txt", "esic-challan-04-2025.txt"]) {
    const t = sw(readFileSync(join(FX, f), "utf8"));
    const r = await st.bring({ name: f, bytes: new TextEncoder().encode(t), text: t, type: "text/plain" }, "2026", { confirmed: true });
    if (!r.ok) throw new Error(f + ": " + r.text);
  }
  const files = st.files(), get = (k) => files.filter((x) => x.kind === k);
  const f = { bookDep: sched.pl.depreciation.cy, bookDepTrace: sched.pl.depreciation.trace, itDep: 197500,
    itBlocks: [{ key: "pm15", rate: 0.15, open: 1000000, addA: 150000, addB: 100000, sale: 0, dep: 180000, close: 1070000 }, { key: "c40", rate: 0.4, open: 43750, addA: 0, addB: 0, sale: 0, dep: 17500, close: 26250 }], interestIncome: sched.pl.interestInc.cy, interestTrace: sched.pl.interestInc.trace,
    tdsMissed: [{ party: "DEMO TRANSPORT CO", section: "194C", base: 120000 }], tdsUnpaid: [], nrMissed: [], cash40A3: [{ date: "20250912", party: "DEMO HARDWARE STORE", amount: 18500 }],
    pf36va: pf36va(get("ecr"), get("pfchallan"), get("esic")) };
  // 43B: the payable ledgers at 31-03-2026 and the made-up payments of April 2026
  const payRows = rows.filter((r) => ["7B", "7C", "7G", "5B", "5C"].includes(r.code)).map((r) => ({ ledger: r.ledger, closing: -r.final }));
  f.dues43B = dues43B(payRows, [{ ledger: "GST PAYABLE", date: "20260420", amt: 40000 }, { ledger: "TDS PAYABLE", date: "20260430", amt: 25000 }, { ledger: "PF PAYABLE", date: "20260415", amt: 20000 }], "20260831", "20260930", { pf: 0.5, esi: null });
  const msme = msme43Bh([{ party: "DEMO MICRO SUPPLIER", ref: "MS/88", date: "20260305", amt: 42000, paidOn: "20260410" }, { party: "DEMO SMALL SUPPLIER", ref: "SS/12", date: "20260325", amt: 30000, paidOn: "20260405" }], 45, "20260331", "20260930");
  f.msmeRows = msme.rows;
  const adj = adjustments(f);
  const capOpen = -rows.find((r) => r.code === "3P").py;
  const books = { ok: true, fy: "2025", sched, f, adj, findings: [], notes: [], plTally: sched.totals.pbt, openingTally: 4512000, pyBs: { total: 4512000, capital: capOpen, src: "last year's audited balance sheet (made up)" },
    capital: { closing: sched.bs.capital.cy + sched.totals.pat, profit: sched.totals.pat, introduced: -rows.find((r) => r.code === "3P").final - capOpen, drawings: 360000 },
    dues43B: f.dues43B, msme, tds: { ok: true, deducted: 186000, payable: 186000, deposited: 186000, unpaid: [], missedBase: 120000, unpaidBase: 0, nrBase: 0 }, form3cd: null, esiBooks: null, nrAsk: [] };
  booksObj.itr["2026|state"] = { form, regime: ent === "C" ? "normal" : ent === "P" ? "new" : "", llp: ent === "F" ? false : undefined, bookProfitOk: ent === "C", filingDate: "20261125", age: 46, smallCo: true, pfCode: "DLCPM0000001000", esiCode: "10000000000000001",
    profile: Object.assign({ father: "DEMO FATHER", place: "NEW DELHI", swId: "SW00000000", capacity: "S", loansForBusiness: true, auditor: { firm: "DEMO AUDIT FIRM", firmPan: "ZZZFA1111A", reportDate: "2026-10-20", ack: "123456789012345" }, indAs: false, listed: false, authorised: 2500000 }, ent === "P" ? {} : { verName: "DEMO SIGNATORY", verPan: "ZZZPV7777V" }),
    partners: ent === "F" ? [{ name: "DEMO PARTNER ONE", pan: "ZZZPA1111A", share: 50, city: "NEW DELHI", state: "07", pin: "110001", addr: "1 SAMPLE STREET", remuneration: 300000, interest: 24000, rate: 12 }, { name: "DEMO PARTNER TWO", pan: "ZZZPB2222B", share: 50, city: "NEW DELHI", state: "07", pin: "110002", addr: "2 SAMPLE STREET", remuneration: 300000, interest: 30000, rate: 15 }] : undefined,
    presumptive: form === "ITR-4" ? { ad: { digital: 4600000, other: 300000 } } : undefined };
  const gst = { ok: true, filedR1: 4850000, filedR3b: 4850000, monthsR1: 12, monthsR3b: 12, reasons: [{ label: "Credit notes of March 2026 shown in GSTR-1 of April 2026", amt: 50000 }] };
  const tds = books.tds;
  return { client: { id: "demo1", name, pan, entity: ent }, clients, booksObj, books, gst, tds, firm: "demo-firm" };
}

if (process.argv[1] && process.argv[1].endsWith("itr_demo.mjs")) {
  const out = process.argv[2] || join(HERE, "out", "itr-demo.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(await demo(process.argv[3] || "ITR-3")));
  console.log("wrote " + out);
}
