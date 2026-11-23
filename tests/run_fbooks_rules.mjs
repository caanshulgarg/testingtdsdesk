// Portions ported from Independent Books (MIT, (c) 2026 Independent Books Contributors), see THIRD_PARTY_NOTICES.md
//
// node tests/run_fbooks_rules.mjs - FinCom Books' amount, GST-split and bill-wise rules (app/src/lib/fbooks/rules.js).
// Each case is an Independent Books test (commit 2a7f9fe8) rewritten over FinCom's own shapes (whole paise, a debit
// positive, the invoice's place of supply); the comment above each names the original test. Made-up data only.
// Not ported (and why) at the end of the file.
import { parsePaise, rupees, gstSplit, itemGst, billRows, checkBillSplits, previewSplits, ageing, dueDate, billId, entriesFromRefs } from "../app/src/lib/fbooks/rules.js";

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => { const x = JSON.stringify(a), y = JSON.stringify(b); ok(x === y, w + (x === y ? "" : " (" + x + " ≠ " + y + ")")); };
const throws = (fn, re, w) => { try { fn(); ok(false, w + " (did not refuse)"); } catch (e) { ok(re.test(e.message), w + " (" + e.message + ")"); } };
const P = (r) => parsePaise(r);

// ---------------------------------------------------------------- the made-up books of test_phase2_bills.py (build_books)
const parties = { Customer: "debtor", Supplier: "creditor" };
let seq = 0;
function invoice(E, number, date, name, amount, due, party = "Customer") {
  const id = "v" + (++seq), a = P(amount), dr = party === "Customer";
  const ref = { type: "new", name, amount: a, billDate: date };
  if (due) ref.dueDate = due;
  E.push({ id, date, number, lines: [{ ledger: party, amount: dr ? a : -a, bills: [ref] }, { ledger: dr ? "Sales" : "Purchase", amount: dr ? -a : a }] });
  return id;
}
function settle(E, number, date, bill, amount, party = "Customer", extra = {}) {
  const id = "v" + (++seq), a = P(amount), cust = party === "Customer";
  const v = Object.assign({ id, date, number, lines: [{ ledger: party, amount: cust ? -a : a, bills: [Object.assign({ type: "against", name: bill, amount: a }, extra)] }, { ledger: "Cash", amount: cust ? a : -a }] });
  E.push(v); return v;
}
const receipt = (number, date, splits, amount) => ({ id: "r" + (++seq), date, number, lines: [{ ledger: "Customer", amount: -P(amount), bills: splits }, { ledger: "Cash", amount: P(amount) }] });
const pend = (E, ledger, asOf) => billRows(E, { parties, asOf }).filter((r) => !ledger || r.ledger === ledger);

console.log("amounts (books.decimal)");
// test_decimal_rejects_junk_and_handles_spaces_without_truncating
eq([P("1 234.50"), P(" 5 000 "), P("1,23,456.78"), P("₹1,000")], [123450, 500000, 12345678, 100000], "spaced and Indian grouping, ₹ stripped");
throws(() => P("12.50 abc"), /Invalid numeric amount/, "junk after a number refused");
throws(() => P("invalid_text"), /Invalid numeric amount/, "text refused");
throws(() => P("Infinity"), /finite/, "Infinity refused");
throws(() => P("NaN"), /finite/, "NaN refused");
eq([P("100.005"), P("-100.005"), P("0.004"), P("1e2"), P("2.5E-1")], [10001, -10001, 0, 10000, 25], "half up to the paisa (away from nought), exponents exact");
eq(rupees(-12345), "-123.45", "paise back to rupees");

console.log("GST split (books.gst_components, calculate_item_gst)");
const WB = { supplierState: "19", placeOfSupply: "19" };
// test_local_gst_splits_into_cgst_and_sgst
eq(gstSplit(Object.assign({ taxable: "1000.00", rate: "18" }, WB)), [{ kind: "cgst", amount: 9000, rate: 9 }, { kind: "sgst", amount: 9000, rate: 9 }], "1,000 at 18% in the same state: CGST 90.00 + SGST 90.00 at 9% each");
// test_blank_state_defaults_to_igst_not_local
eq(gstSplit({ taxable: 1000, rate: 18, supplierState: "29", placeOfSupply: "" }), [{ kind: "igst", amount: 18000, rate: 18 }], "the place of supply blank: IGST 180.00, never local");
eq(gstSplit({ taxable: 1000, rate: 18, supplierState: "", placeOfSupply: "29" }), [{ kind: "igst", amount: 18000, rate: 18 }], "the supplier's state blank: IGST too");
eq(gstSplit({ taxable: 1000, rate: 18, supplierState: "29", placeOfSupply: "29", sez: true }), [{ kind: "igst", amount: 18000, rate: 18 }], "(FinCom) a supply to an SEZ: IGST whatever the states");
// FinCom: the place of supply is the invoice's, not the party ledger's (plan 11.4)
eq(gstSplit({ taxable: 1000, rate: 18, supplierState: "27AAAAA0000A1Z5", placeOfSupply: "29" }).map((x) => x.kind), ["igst"], "(FinCom) a GSTIN gives its state; goods shipped to another state: IGST");
// the half-split rule: CGST is half the tax rounded half up, SGST the rest, so they always add up
const odd = gstSplit({ taxable: "0.25", rate: "18", supplierState: "19", placeOfSupply: "19" });
eq(odd.map((x) => x.amount), [3, 2], "tax 0.045 -> 0.05: CGST 0.03, SGST 0.02 (they add up to the tax)");
// test_calculate_item_gst_pure_python
const local = { supplierState: "19", placeOfSupply: "19" }, out = { supplierState: "19", placeOfSupply: "27" };
eq(itemGst([{ item: "Steel Rod", gstRate: 18, amount: "1000.00" }], local), [{ kind: "cgst", amount: 9000 }, { kind: "sgst", amount: 9000 }], "1. intra-state 18% on 1,000: CGST 90.00 + SGST 90.00");
eq(itemGst([{ item: "Steel Rod", gstRate: 18, amount: "1000.00" }], out), [{ kind: "igst", amount: 18000 }], "2. inter-state: IGST 180.00");
eq(itemGst([{ item: "Exempt Food", gstRate: 0, amount: "500.00" }], local), [], "3. a 0% item: no tax");
eq(itemGst([{ gstRate: 18, amount: "1000.00" }, { gstRate: 0, amount: "500.00" }], local), [{ kind: "cgst", amount: 9000 }, { kind: "sgst", amount: 9000 }], "4. mixed: only the 18% item is taxed");
eq(itemGst([{ gstRate: 18, amount: "100.55" }], local), [{ kind: "cgst", amount: 905 }, { kind: "sgst", amount: 905 }], "5. odd paise: 100.55 at 18% = 18.099 -> 18.10 -> 9.05 / 9.05");
// test_calculate_item_gst_does_not_use_unit_rate_as_tax_percentage
eq(itemGst([{ item: "Steel", gstRate: 18, amount: "1000.00", rate: "1500.00" }], { supplierState: "29", placeOfSupply: "29" }), [{ kind: "cgst", amount: 9000 }, { kind: "sgst", amount: 9000 }], "an item's price (rate 1,500) is never taken as its GST rate");

console.log("bill-wise (books._bill_rows, _normalize_bill_allocations, _validate_bill_allocations, ageing)");
{ // test_pending_bills_have_stable_ids_and_partial_settlement
  const E = [];
  const first = invoice(E, "1", "2026-04-01", "INV-1", 100, "2026-04-11");
  invoice(E, "2", "2026-04-02", "INV-2", 200, "2026-05-02");
  settle(E, "3", "2026-04-05", "INV-1", 50);
  const b = pend(E, "Customer");
  eq(b.map((x) => [x.name, rupees(x.original), rupees(x.pending)]), [["INV-1", "100.00", "50.00"], ["INV-2", "200.00", "200.00"]], "pending bills after a part settlement");
  ok(b[0].billId === billId("Customer", "INV-1", first) && b[0].date === "2026-04-01" && b[0].dueDate === "2026-04-11" && b[0].source === first, "a bill's id is stable (ledger, name, voucher); its date, due date and voucher");
  eq(pend(E, "Customer")[0].billId, b[0].billId, "the same id when worked out again");
}
{ // test_allocation_preview_is_read_only_and_commit_checks_revision (the preview part; FinCom's revision check is the database's)
  const E = []; invoice(E, "1", "2026-04-01", "INV-1", 100);
  const bill = pend(E, "Customer")[0], before = JSON.stringify(E);
  const pv = previewSplits(E, { ledger: "Customer", amount: "75", method: "against", allocations: [{ billId: bill.billId, amount: "75" }] }, { parties });
  ok(pv.residual === 0 && pv.allocations[0].billId === bill.billId && JSON.stringify(E) === before, "a preview: residual 0, the bill named, the books unchanged");
}
{ // test_allocation_rejects_overallocation_and_wrong_party
  const E = []; invoice(E, "1", "2026-04-01", "INV-1", 100);
  const bill = pend(E, "Customer")[0];
  throws(() => previewSplits(E, { ledger: "Customer", amount: "101", method: "against", allocations: [{ billId: bill.billId, amount: "101" }] }, { parties }), /exceeds/, "more than the bill: refused");
  throws(() => previewSplits(E, { ledger: "Supplier", amount: "1", method: "against", allocations: [{ billId: bill.billId, amount: "1" }] }, { parties }), /party/, "another party's bill: refused");
}
// test_ageing_uses_explicit_boundaries_and_keeps_undated (both bases)
for (const [basis, want] of [["invoice_date", { "<30": 2, "30-60": 1, "60-90": 2, ">90": 1 }], ["due_date", { "<30": 1, "30-60": 1, "60-90": 2, ">90": 1 }]]) {
  const E = [];
  for (const [n, d] of [["1", "2026-06-21"], ["2", "2026-06-01"], ["3", "2026-05-02"], ["4", "2026-04-02"], ["5", "2026-04-01"]]) invoice(E, n, d, "INV-" + n, 10, d);
  invoice(E, "6", "2026-06-30", "UNDATED", 10);
  const r = ageing(pend(E, "Customer"), "2026-07-01", basis);
  eq(Object.fromEntries(Object.keys(want).map((k) => [k, r.buckets[k].length])), want, "ageing by " + basis + ": 10 / 30 / 60 / 90 / 91 days in their buckets (90 is 60-90)");
  eq(r.undated.map((x) => x.name), basis === "due_date" ? ["UNDATED"] : [], "ageing by " + basis + ": a bill with no due date is listed apart, never dropped");
}
{ // test_voucher_commit_revalidates_splits_and_rolls_back_invalid_writes
  const E = []; invoice(E, "1", "2026-04-01", "INV-1", 100);
  const bill = pend(E, "Customer")[0], split = () => ({ type: "against", billId: bill.billId, name: "INV-1", amount: P(75) });
  throws(() => checkBillSplits(E, receipt("bad", "2026-04-02", [split(), split()], "150"), { parties }), /exceeds/, "two splits of 75 against a bill of 100: refused");
  throws(() => checkBillSplits(E, receipt("bad", "2026-04-02", [split()], "100"), { parties }), /sum/, "a split of 75 on a receipt of 100: refused (the splits must add up)");
  const good = receipt("1", "2026-04-02", [split()], "75");
  checkBillSplits(E, good, { parties }); E.push(good);
  eq(rupees(pend(E, "Customer")[0].pending), "25.00", "the good receipt leaves 25.00 pending");
  good.cancelled = true;
  eq(rupees(pend(E, "Customer")[0].pending), "100.00", "cancelled: the bill is 100.00 pending again");
}
{ // test_reference_validation_rejects_future_ambiguous_and_duplicate_splits
  const E = []; invoice(E, "1", "2026-05-01", "SAME", 100); invoice(E, "2", "2026-05-02", "SAME", 100);
  const bill = pend(E, "Customer")[0];
  throws(() => previewSplits(E, { ledger: "Customer", amount: "150", method: "against", allocations: [{ billId: bill.billId, amount: "75" }, { billId: bill.billId, amount: "75" }] }, { parties }), /exceeds/, "the same bill twice, more than it holds: refused");
  throws(() => previewSplits(E, { ledger: "Customer", amount: "10", method: "against", allocations: [{ name: "SAME", amount: "10" }] }, { parties }), /ambiguous/, "a name two bills share: refused as ambiguous");
  throws(() => checkBillSplits(E, receipt("1", "2026-04-15", [{ type: "against", billId: bill.billId, name: "SAME", amount: P(75) }], "75"), { parties }), /bill|Bill/, "settling a bill dated after the receipt: refused");
}
{ // test_ageing_all_ledgers_openings_advances_and_explicit_residual
  const E = [];
  invoice(E, "1", "2026-04-01", "INV-1", 100, "2026-08-01");
  invoice(E, "2", "2026-04-01", "SUP-1", 50, null, "Supplier");
  E.push(receipt("1", "2026-04-03", [{ type: "advance", name: "Deposit", amount: P(20), custom: "retain" }, { type: "on_account", name: "On Account", amount: P(5) }], "25"));
  const rows = billRows(E, { parties, openings: { Customer: P(40) }, asOf: "2026-07-01" });
  const r = ageing(rows, "2026-07-01", "due_date");
  eq([...new Set(r.rows.map((x) => x.ledger))].sort(), ["Customer", "Supplier"], "every party ledger is aged");
  eq(r.notYetDue.map((x) => x.name), ["INV-1"], "a bill due later is not yet due");
  const cust = r.rows.filter((x) => x.ledger === "Customer");
  eq(rupees(cust.reduce((s, x) => s + x.signedPending, 0)), "115.00", "the customer's rows add up to the balance: 40 opening + 100 - 25");
  const adv = cust.find((x) => x.name === "Deposit");
  ok(adv && adv.drcr === "Cr" && rupees(adv.pending) === "20.00", "an advance is its own row, on the credit side");
}
{ // test_creditor_name_only_reference_reduces_bill_and_matches_reports
  const E = []; invoice(E, "1", "2026-04-01", "SUP-1", 100, null, "Supplier");
  const bill = pend(E, "Supplier")[0];
  E.push({ id: "p1", date: "2026-04-02", number: "1", lines: [{ ledger: "Supplier", amount: P(60), bills: [{ type: "against", name: "SUP-1", amount: P(60) }] }, { ledger: "Cash", amount: -P(60) }] });
  const rows = pend(E, "Supplier");
  eq(rows.map((x) => [x.name, rupees(x.pending), x.drcr]), [["SUP-1", "40.00", "Cr"]], "a payment naming the bill only: 40.00 left, on the credit side");
  eq(rows[0].billId, bill.billId, "the same bill (its id)");
}
{ // test_post_rejects_wrong_party_direction_and_split_across_ledger_entries
  const E = []; invoice(E, "1", "2026-04-01", "INV-1", 100);
  const bill = pend(E, "Customer")[0], al = () => ({ type: "against", name: bill.name, billId: bill.billId, amount: P(60) });
  throws(() => checkBillSplits(E, { id: "x1", date: "2026-04-10", lines: [{ ledger: "Supplier", amount: -P(60), bills: [al()] }, { ledger: "Cash", amount: P(60) }] }, { parties }), /another party|unavailable/, "the customer's bill named on the supplier's line: refused");
  throws(() => checkBillSplits(E, { id: "x2", date: "2026-04-10", lines: [{ ledger: "Customer", amount: P(60), bills: [al()] }, { ledger: "Cash", amount: -P(60) }] }, { parties }), /opposite/, "settled on the same side as the bill (a debit against a debit): refused");
  throws(() => checkBillSplits(E, { id: "x3", date: "2026-04-10", lines: [{ ledger: "Customer", amount: -P(60), bills: [al()] }, { ledger: "Customer", amount: -P(60), bills: [al()] }, { ledger: "Cash", amount: P(120) }] }, { parties }), /exceeds/, "one bill split across two lines for more than it holds: refused");
}
{ // test_legacy_ambiguous_name_is_unallocated_instead_of_first_bill_wins
  const E = []; invoice(E, "1", "2026-04-01", "DUP", 100); invoice(E, "2", "2026-04-02", "DUP", 100);
  E.push(receipt("1", "2026-04-03", [{ type: "against", name: "DUP", amount: P(75) }], "75"));
  const rows = pend(E, "Customer"), bills = rows.filter((x) => x.referenceKind === "bill"), un = rows.filter((x) => x.referenceKind === "unallocated");
  eq(bills.map((x) => rupees(x.pending)), ["100.00", "100.00"], "a settlement by a name two bills share touches neither bill");
  ok(un.length === 1 && rupees(un[0].signedPending) === "-75.00" && un[0].resolution === "ambiguous", "it is left unallocated, marked ambiguous");
}
{ // test_allocation_preview_preserves_metadata_and_explicit_residual
  const E = [];
  const pv = previewSplits(E, { ledger: "Customer", amount: "100", method: "new", allocations: [{ name: "N-1", amount: "60", date: "20260401", dueDate: "2026-05-01", custom: "keep" }, { name: "On Account", amount: "40", method: "on_account" }] }, { parties });
  ok(pv.residual === 0 && pv.allocations[0].custom === "keep" && pv.allocations[0].dueDate === "2026-05-01" && pv.allocations[0].date === "2026-04-01" && pv.allocations[1].method === "on_account",
     "a preview keeps each split's own fields, its dates in one form, and says the residual");
  eq(previewSplits(E, { ledger: "Customer", amount: "100", method: "new", allocations: [{ name: "N-1", amount: "60" }] }, { parties }).residual, 4000, "a residual left is said (40.00), never filled in silently");
  throws(() => previewSplits(E, { ledger: "Customer", amount: "100", method: "new", allocations: [{ name: "", amount: "60" }] }, { parties }), /Reference name/, "a New Ref with no name: refused");
  throws(() => previewSplits(E, { ledger: "Cash", amount: "100", method: "new", allocations: [] }, { parties }), /party ledger/, "a ledger that is not a party: refused");
}
{ // test_audit_fixes.test_settle_invoice_without_bill_details_works
  const E = [{ id: "raw", date: "2026-04-01", number: "INV-RAW", lines: [{ ledger: "Customer", amount: P(500) }, { ledger: "Sales", amount: -P(500) }] }];
  const p = pend(E, "Customer");
  ok(p.length === 1 && rupees(p[0].pending) === "500.00", "an invoice with no bill details: one On Account row of 500.00");
  eq(previewSplits(E, { ledger: "Customer", amount: "200", method: "against", allocations: [{ billId: p[0].billId, amount: "200" }] }, { parties }).residual, 0, "it can be settled by its id (never 'another party')");
}
console.log("(FinCom) due dates and the page's reading of fb_ledger");
eq([dueDate("2026-04-01", { creditDays: 30 }), dueDate("2026-04-01", { dueDate: "2026-04-11", creditDays: 30 }), dueDate("2026-04-01", {})], ["2026-05-01", "2026-04-11", ""], "due: the one given, else the bill date + credit days, else none");
{
  const refs = [{ voucher: "a", date: "2026-04-01", number: "S/1", type: "new", name: "S/1", amount: "1180.00", bill_date: "2026-04-01", due: "2026-05-01" },
                { voucher: "b", date: "2026-04-20", number: "R/1", type: "against", name: "S/1", amount: "-500.00" }];
  const r = billRows(entriesFromRefs("Alpha Demo Stores", refs), { parties: { "Alpha Demo Stores": "debtor" } });
  eq(r.map((x) => [x.name, rupees(x.pending), x.drcr, x.dueDate]), [["S/1", "680.00", "Dr", "2026-05-01"]], "fb_ledger's references (a debit positive) give the pending bills");
}
// Not ported: test_bill_ids_and_unknown_metadata_survive_xml_and_backup and test_reference_ids_survive_ledger_rename_and_import
// (their XML export / backup and in-place rename; FinCom's file import is P5, D15), test_allocate_bills_commits_to_pending_bills
// and the revision half of test_allocation_preview_is_read_only (their single-document store; FinCom's writes are the
// database's, migration 220), the browser tests (their own pages).
console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
