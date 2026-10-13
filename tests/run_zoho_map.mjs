// node run_zoho_map.mjs - server/zoho-books/map.js on its own (zoho-books, 13-Oct-2026): Zoho Books' documents into the rows
// of FinCom's cloud copy, checked document by document against the test organisation (tests/fixtures/zoho/org, made by
// make_org.py) and a few made-up edge cases. No network, no database. The figures through FinCom's own GST and TDS code are
// checked by run_zoho_server.py (through the function and the database) against the hand-written answer key.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = await import(path.join(HERE, "..", "server", "zoho-books", "map.js"));
const rd = (n) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "zoho", "org", n + ".json"), "utf8"));
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const r2 = (x) => Math.round(x * 100) / 100;
const ctx = M.makeCtx({ org: rd("organizations")[0], accounts: rd("chartofaccounts"), contacts: rd("contacts"), taxes: rd("taxes"), tdsTaxes: rd("tdstaxes") });
const all = {};
for (const e of M.ENTITY_ORDER) all[e] = M.mapDocs(e, rd(e), ctx);
const V = Object.values(all).flatMap((x) => x.vouchers), Lines = Object.values(all).flatMap((x) => x.lines);
const linesOf = (no) => { const v = V.find((x) => x.no === no); return v ? Lines.filter((l) => l[0] === v.guid) : []; };
const amt = (no, led) => r2(linesOf(no).filter((l) => l[1] === led).reduce((a, l) => a + l[2], 0));
const vof = (no) => V.find((x) => x.no === no) || {};

console.log("== the ledgers");
const L = M.orgLedgers(ctx, rd("openingbalances").opening_balance);
const led = Object.fromEntries(L.ledgers.map((l) => [l.name, l]));
ok(led["Sales"].parent === "Sales Accounts" && led["Purchases"].parent === "Purchase Accounts" && led["Rent"].parent === "Indirect Expenses" && led["HDFC Bank"].parent === "Bank Accounts" && led["Petty Cash"].parent === "Cash-in-Hand",
  "Zoho's account types as Tally's groups: Sales Accounts, Purchase Accounts, Indirect Expenses, Bank Accounts, Cash-in-Hand");
ok(led["Output CGST"].parent === "Duties & Taxes" && led["Input IGST"].parent === "Duties & Taxes" && led["CGST RCM Payable"].parent === "Duties & Taxes" && led["TDS Payable 194C"].parent === "Duties & Taxes", "the GST and TDS ledgers under Duties & Taxes");
ok(led["TDS Receivable"].parent === "Loans & Advances (Asset)", "TDS Receivable is an asset, not a TDS payable ledger");
ok(led["Omicron Contractors"].parent === "Sundry Creditors" && led["Omicron Contractors"].pan === "AAACO5555O" && led["Omicron Contractors"].tds_nature === "194C", "a vendor: Sundry Creditors, its PAN (from the GSTIN) and TDS section");
ok(led["Pi Consultants"].pan === "AAAPP7777P" && led["Alpha Traders Mumbai"].gstin === "27AAAFA1111A1ZM", "a PAN given on the contact; a customer's GSTIN");
ok(led["HDFC Bank"].open === -500000 && led["Owner's Capital"].open === 500000, "openings in Tally's sign (a debit negative)");
ok(L.groups.some(([g, p]) => g === "Bank Accounts" && p === "Current Assets") && L.groups.some(([g, p]) => g === "Current Assets" && p === ""), "the groups with Tally's own parents");
ok(L.objects.filter((o) => o.kind === "gst_ledger").length >= 9 && L.objects.some((o) => o.kind === "tds_tax" && o.ledger === "TDS Payable 194J"), "the objects posting looks up: GST ledgers by head and side, TDS taxes by ledger");
const back = M.mastersFromObjects(L.objects.map((o) => ({ kind: o.kind, id: o.zoho_id, name: o.name, ledger: o.ledger, data: o.data })));
const ctx2 = M.makeCtx(Object.assign({ org: rd("organizations")[0] }, back));
ok(JSON.stringify(M.mapDocs("bills", rd("bills"), ctx2)) === JSON.stringify(all.bills), "the masters kept as objects give the same entries (a run reads only the contacts that changed)");
const clash = M.makeCtx({ accounts: [{ account_id: "1", account_name: "Rent", account_type: "expense" }], contacts: [{ contact_id: "9", contact_name: "Rent", contact_type: "vendor" }] });
ok(clash.conLed["9"] === "Rent (party)" && clash.accLed["1"] === "Rent", "a contact named as an account is told apart: 'Rent (party)'");
const kept = M.makeCtx({ accounts: [{ account_id: "1", account_name: "Rent Renamed", account_type: "expense" }], known: { a1: "Rent" } });
ok(kept.accLed["1"] === "Rent", "a ledger keeps the name it was given (a rename in Zoho never makes a second ledger)");

console.log("== each document");
ok(V.length === 18 && V.filter((v) => v.cancel).length === 1, "18 entries, 1 cancelled (the void INV-008)");
ok(all.invoices.skipped.some((s) => s.why === "draft") && all.banktransactions.skipped.some((s) => /own document/.test(s.why)), "the draft and the bank line booked by its own payment are left out");
ok(V.every((v) => /^zoho-[a-z]+-\d+$/.test(v.guid)), "every entry is zoho-<kind>-<Zoho id>");
let unbalanced = V.filter((v) => !v.cancel && Math.abs(r2(Lines.filter((l) => l[0] === v.guid).reduce((a, l) => a + l[2], 0))) > 0.004);
ok(!unbalanced.length, "every entry balances to the paisa (%s)".replace("%s", unbalanced.map((v) => v.no).join(", ")));
ok(vof("INV-001").type === "Sales" && amt("INV-001", "Sales") === 100000 && amt("INV-001", "Output CGST") === 9000 && amt("INV-001", "Alpha Traders Mumbai") === -118000, "INV-001: Sales Cr 1,00,000, Output CGST Cr 9,000, the customer Dr 1,18,000");
ok(vof("INV-001").gstin === "27AAAFA1111A1ZM" && vof("INV-001").pos === "Maharashtra" && vof("INV-001").cmp === "27AAACZ1234Z1ZG", "the customer's GSTIN, the place of supply as a state, the organisation's GSTIN");
const b1 = linesOf("INV-001").find((l) => l[1] === "Alpha Traders Mumbai")[5][0];
ok(b1[0] === "INV-001" && b1[1] === "New Ref" && b1[2] === -118000 && b1[3] === 15, "its bill: New Ref INV-001, 15 days' credit");
ok(vof("INV-003").gst.nature === "Sales to SEZ - Taxable" && vof("INV-004").gst.nature === "Exports - LUT/Bond" && vof("INV-004").gst.country === "Germany", "SEZ with tax; export under LUT to Germany (Zoho's gst_treatment)");
ok(amt("INV-006", "Output CGST") === 3850 && linesOf("INV-006").filter((l) => l[1] === "Sales").map((l) => l[4]).join() === "18,5", "INV-006: two rates (18% and 5%) on two lines, the tax by head 3,850");
ok(vof("CN-001").type === "Credit Note" && amt("CN-001", "Sales") === -10000 && linesOf("CN-001").find((l) => l[1] === "Alpha Traders Mumbai")[5][0][1] === "Agst Ref", "CN-001: a Credit Note against INV-001");
ok(vof("MU/7").gst.rcm === true && amt("MU/7", "Input CGST") === -4500 && amt("MU/7", "CGST RCM Payable") === 4500 && amt("MU/7", "Mu Advocates") === 50000, "MU/7 reverse charge: input Dr, RCM payable Cr, the advocate Cr the value only");
ok(amt("OC/55", "TDS Payable 194C") === 2000 && amt("OC/55", "Omicron Contractors") === 116000 && amt("OC/55", "Contract Charges") === -100000, "OC/55: TDS 194C Cr 2,000, the contractor Cr 1,16,000 (Zoho's total, net of TDS)");
ok(amt("PC/9", "TDS Payable 194J") === 6000 && amt("PC/9", "Pi Consultants") === 54000, "PC/9: TDS 194J 6,000 on 60,000 without GST");
ok(vof("VC-001").type === "Debit Note" && amt("VC-001", "Purchases") === 5000 && amt("VC-001", "Kappa Suppliers Pune") === -5900, "VC-001: a vendor credit is Tally's Debit Note, against KS/101");
ok(vof("RCPT-1").type === "Receipt" && amt("RCPT-1", "HDFC Bank") === -104200 && amt("RCPT-1", "TDS Receivable") === -2000 && amt("RCPT-1", "Alpha Traders Mumbai") === 106200, "RCPT-1: the bank Dr 1,04,200, TDS withheld Dr 2,000, the customer Cr 1,06,200");
ok(vof("PAY-1").type === "Payment" && amt("PAY-1", "HDFC Bank") === 53100, "PAY-1: a vendor payment from HDFC Bank");
ok(vof("KS/C-12").type === "Payment" && amt("KS/C-12", "Input CGST") === -90 && amt("KS/C-12", "Petty Cash") === 1180, "the expense paid in cash: a Payment with its input tax");
ok(vof("JV-1").type === "Journal" && amt("JV-1", "Sigma Landlord") === 75000 && vof("JV-1").party === "Sigma Landlord", "JV-1: the payable line to the contact's own ledger");
ok(vof("TRF-1").type === "Contra" && amt("TRF-1", "ICICI Bank") === -50000, "TRF-1: a transfer between banks is a Contra");
ok(vof("INV-001").alter === M.modSec("2026-05-02T10:00:00+0530") && M.modSec("2026-05-02T10:00:00+0530") === Math.floor(Date.parse("2026-05-02T04:30:00Z") / 1000), "the version is Zoho's last_modified_time in seconds (IST read right)");

console.log("== edge cases");
const tax = (id) => rd("taxes").find((t) => t.tax_name === id).tax_id;
const odd = { invoice_id: "1", invoice_number: "X-1", date: "2026-05-10", status: "sent", customer_id: rd("contacts")[0].contact_id, gst_treatment: "business_gst", place_of_supply: "MH",
  line_items: [{ account_id: rd("chartofaccounts")[0].account_id, item_total: 333.33, tax_id: tax("GST18"), hsn_or_sac: "1" }, { account_id: rd("chartofaccounts")[0].account_id, item_total: 333.33, tax_id: tax("GST18"), hsn_or_sac: "1" }],
  taxes: [{ tax_id: tax("CGST9"), tax_amount: 60.00 }, { tax_id: tax("SGST9"), tax_amount: 60.00 }], total: 786.66, last_modified_time: "2026-05-10T10:00:00+0530" };
const o = M.mapDoc("invoices", odd, ctx);
ok(o.lines.filter((l) => l[1] === "Output CGST").reduce((a, l) => a + l[2], 0) === 60 && Math.abs(o.lines.reduce((a, l) => a + l[2], 0)) < 0.005, "the tax is Zoho's own figure per head (60.00, not 59.99 + 0.01 worked again); the entry balances");
const disc = Object.assign({}, odd, { invoice_number: "X-2", discount_amount: 66.66, is_discount_before_tax: true, line_items: odd.line_items.map((l) => Object.assign({}, l)), taxes: [{ tax_id: tax("CGST9"), tax_amount: 54.00 }, { tax_id: tax("SGST9"), tax_amount: 54.00 }], total: 708.00 });
const d = M.mapDoc("invoices", disc, ctx);
ok(r2(d.lines.filter((l) => l[1] === "Sales").reduce((a, l) => a + l[2], 0)) === 600 && Math.abs(d.lines.reduce((a, l) => a + l[2], 0)) < 0.005, "a discount before tax is taken off the sales lines (the taxable value), the entry balances");
const off = M.mapDoc("invoices", Object.assign({}, odd, { invoice_number: "X-3", total: 786.16 }), ctx);
ok(off.lines.some((l) => l[1] === "Rounding Off" && l[2] === -0.5), "a total Zoho rounded 50 paise down: Rounding Off debited 0.50");
const way = M.mapDoc("invoices", Object.assign({}, odd, { invoice_number: "X-4", total: 9999 }), ctx);
ok(way.lines.some((l) => l[1] === "Suspense A/c") && way.notes.length === 1, "a total that does not add up by more than a rupee: Suspense A/c, and said");
ok(M.fincomIdOf({ reference_number: "FC:e_b1" }) === "e_b1" && M.fincomIdOf({ notes: "Contract work TDSDesk:e_9" }) === "e_9" && M.fincomIdOf({ reference_number: "INV-1" }) === null, "FinCom's own mark: FC:<id> in the reference or TDSDesk:<id> in the notes");
ok(M.sectionOf({ tax_name: "Payment to Contractors", tds_section: "Section 194C" }) === "194C" && M.sectionOf({ tax_name: "TDS 194J professional" }) === "194J" && M.sectionOf({ tax_name: "TCS 206C(1H)" }) === "206C(1H)" && M.sectionOf({ tax_name: "Rent u/s 194I" }) === "194I",
  "the section of a TDS or TCS tax, from its section or its name");
ok(M.modSec("2026-05-02T10:00:00+05:30") === M.modSec("2026-05-02T10:00:00+0530") && M.modSec("2026-05-02 10:00") === M.modSec("2026-05-02T10:00:00+0530") && M.modSec("") === 0, "Zoho's time formats read alike");
ok(M.posName("DL") === "DELHI" && M.posName("TS") === "TELANGANA" && M.zohoStateOf("27AAACZ1234Z1ZG") === "MH" && M.zohoStateOf("07X") === "DL", "places of supply: Zoho's codes and the GSTIN's state");
ok(M.mapDoc("journals", { journal_id: "5", journal_date: "2026-05-01", status: "draft", line_items: [] }, ctx).skip === "draft", "a draft journal is not in the books");
ok(M.accountGroup({ account_type: "income", account_name: "Consulting Revenue" }) === "Sales Accounts" && M.accountGroup({ account_type: "income", account_name: "Commission" }) === "Direct Incomes" && M.accountGroup({ account_type: "other_current_liability", account_name: "GST Payable" }) === "Duties & Taxes",
  "income named sales or revenue is Sales Accounts; a tax account is Duties & Taxes");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
