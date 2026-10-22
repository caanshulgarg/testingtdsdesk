// deno test server/assistant/entries_test.ts - Ask FinCom drafts entries (the owner, 22-Oct-2026: "make entries for Leads
// Insurance in their Tally, or prepare XML to upload" was refused). The parts that need no database: which questions ask
// for entries (and are drafted, not refused with a screen), and FinCom's own check of a draft: each ledger one of the
// client's Tally ledgers (the cloud copy), Dr equal to Cr on every voucher, the date inside the books' period, the voucher
// type one Tally knows. The ledger list is stubbed here (asst_ledger_pick's answers); the end-to-end test with the
// database is in assistant_test.ts.
import { booksPeriod, checkEntries, entriesAsked, VTYPES } from "./entries.ts";
import { actionAsked } from "./checks.ts";
import { route } from "./router.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// the client's ledgers as asst_ledger_pick answers (migration 88): the same key -> {ledger, how: same}; one a name starts
// or contains -> {ledger, how}; several -> {ask, choices}; none -> {choices}
const LEDGERS = ["Office Rent", "Kaveri Bank - CA 0815", "Cash", "Richa Khandelwal", "TDS ON CONTRACT 194C", "Rent Payable"];
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
async function pick(text: string) {
  const k = key(text);
  const same = LEDGERS.filter((l) => key(l) === k);
  if (same.length === 1) return { ledger: same[0], how: "same", ask: false, choices: [] };
  const has = LEDGERS.filter((l) => key(l).includes(k));
  if (has.length === 1) return { ledger: has[0], how: "contains", ask: false, choices: [] };
  if (has.length > 1) return { ledger: null, ask: true, choices: has };
  return { ledger: null, ask: false, choices: LEDGERS.filter((l) => l[0].toLowerCase() === text[0]?.toLowerCase()).slice(0, 5) };
}
const PERIOD = { from: "2025-04-01", to: "2027-03-31" };

Deno.test("which questions ask for entries: drafted, never refused with a screen (the owner's two questions of 22-Oct-2026 among them)", () => {
  for (const q of [
    "mujhe na Is book Ke Andar Richa Khandelwal ko ek Lakh Pe payment ki entry Karni Hai",
    "Make the journal entries for Leads Insurance in their Tally",
    "Pass a journal entry: rent 50,000 debit Office Rent credit Rent Payable on 31 March 2026",
    "prepare the XML to upload in Tally for these entries",
    "Kyaa tum mujhe XML bana kar de sakte ho so that main Tally mein upload karun",
    "record a payment voucher of 1 lakh to Richa Khandelwal from Kaveri Bank",
    "entry kar do rent ki",
  ]) {
    assert(entriesAsked(q), "entries asked: " + q);
    eq(actionAsked(q), null, "not refused with a screen: " + q);
    eq(route(q, "2026-03-31"), null, "not routed to a book tool by its words: " + q);
  }
  for (const q of ["Post these bills to Tally now", "Delete the duplicate entry NSL/112 for me", "How many entries in March?", "Show the entries of Office Rent for March",
    "what is a journal entry?", "Cash payments over 10000 in September"]) assert(!entriesAsked(q), "not a request to draft entries: " + q);
  // posting stays where it is: the bills' posting is on its own page
  eq(actionAsked("Post these bills to Tally now"), { screen: "post_to_tally" }, "posting bills still points to the Post page");
  eq(VTYPES, ["Journal", "Payment", "Receipt", "Contra", "Sales", "Purchase", "Debit Note", "Credit Note"], "the voucher types Tally knows");
});

Deno.test("the books' period: the first book's start to the end of the current financial year", () => {
  eq(booksPeriod([{ from: "2025-04-01", to: "2026-03-31" }, { from: "2024-04-01", to: "2025-03-31" }], "2026-10-22"), { from: "2024-04-01", to: "2027-03-31" }, "earliest start; FY of today");
  eq(booksPeriod([{ from: "2025-04-01", to: "2026-03-31" }], "2027-02-10"), { from: "2025-04-01", to: "2027-03-31" }, "Feb is in the FY ending March");
  eq(booksPeriod([], "2026-10-22"), null, "no books: no period");
});

Deno.test("a draft checked by FinCom: ledgers from the client's list (case and spacing put right), Dr = Cr, the date in the period", async () => {
  const r = await checkEntries({ vouchers: [
    { type: "Payment", date: "2026-10-22", narration: "Paid to Richa Khandelwal", lines: [{ ledger: "richa khandelwal", dr: 100000, cr: 0 }, { ledger: "KAVERI BANK - CA 0815", dr: 0, cr: 100000 }] },
  ] }, { pick, period: PERIOD });
  assert(r.ok, "ok: " + JSON.stringify(r));
  const v = r.vouchers[0];
  eq(v.lines.map((l) => [l.ledger, l.known, l.dr, l.cr]), [["Richa Khandelwal", true, 100000, 0], ["Kaveri Bank - CA 0815", true, 0, 100000]], "the book's own names");
  eq([v.dr, v.cr, v.problems], [100000, 100000, []], "balanced, no problem");
});

Deno.test("an unknown ledger: shown red with the closest names, and the draft is not ok; a name that only contains the words is not taken", async () => {
  const r = await checkEntries({ vouchers: [
    { type: "Journal", date: "2026-03-31", narration: "Rent for March", lines: [{ ledger: "Rent", dr: 50000, cr: 0 }, { ledger: "Rent Payable", dr: 0, cr: 50000 }] },
    { type: "Journal", date: "2026-03-31", narration: "x", lines: [{ ledger: "Electricity", dr: 10, cr: 0 }, { ledger: "Cash", dr: 0, cr: 10 }] },
  ] }, { pick, period: PERIOD });
  assert(!r.ok, "not ok");
  const a = r.vouchers[0].lines[0], b = r.vouchers[1].lines[0];
  eq([a.known, a.typed, a.choices], [false, "Rent", ["Office Rent", "Rent Payable"]], "several match: choices");
  eq([b.known, b.ledger], [false, "Electricity"], "none: kept as typed, unknown");
  assert(r.vouchers[0].problems.some((p) => /not a ledger/i.test(p)), "said: " + r.vouchers[0].problems);
  const c = await checkEntries({ vouchers: [{ type: "Journal", date: "2026-03-31", narration: "", lines: [{ ledger: "Payable", dr: 5, cr: 0 }, { ledger: "Cash", dr: 0, cr: 5 }] }] }, { pick, period: PERIOD });
  eq([c.vouchers[0].lines[0].known, c.vouchers[0].lines[0].choices], [false, ["Rent Payable"]], "a name that contains the words is offered, not taken");
});

Deno.test("Dr not equal to Cr, a line with both or neither, a bad date, a date outside the books, an unknown type: each a problem", async () => {
  const r = await checkEntries({ vouchers: [
    { type: "Journal", date: "2026-03-31", narration: "", lines: [{ ledger: "Office Rent", dr: 50000, cr: 0 }, { ledger: "Cash", dr: 0, cr: 40000 }] },
    { type: "Journal", date: "2026-02-30", narration: "", lines: [{ ledger: "Office Rent", dr: 5, cr: 5 }, { ledger: "Cash", dr: 0, cr: 0 }] },
    { type: "Journal", date: "2024-03-31", narration: "", lines: [{ ledger: "Office Rent", dr: 5, cr: 0 }, { ledger: "Cash", dr: 0, cr: 5 }] },
    { type: "Memo", date: "2026-03-31", narration: "", lines: [{ ledger: "Office Rent", dr: 5, cr: 0 }, { ledger: "Cash", dr: 0, cr: 5 }] },
    { type: "Journal", date: "2026-03-31", narration: "", lines: [{ ledger: "Office Rent", dr: 5, cr: 0 }] },
  ] }, { pick, period: PERIOD });
  assert(!r.ok, "not ok");
  const p = r.vouchers.map((v) => v.problems.join(" | "));
  assert(/Dr ₹50,000.00 is not equal to Cr ₹40,000.00/.test(p[0]), "Dr ≠ Cr: " + p[0]);
  assert(/not a date/.test(p[1]) && /both a debit and a credit/.test(p[1]) && /no amount/.test(p[1]), "bad date and lines: " + p[1]);
  assert(/before the books begin \(01-Apr-2025\)/.test(p[2]), "before the books: " + p[2]);
  assert(/voucher type/.test(p[3]), "type: " + p[3]);
  assert(/at least two lines/.test(p[4]), "one line: " + p[4]);
  eq(r.fix, [1, 2, 5], "the vouchers the model must put right (Dr ≠ Cr, a line with both or neither, one line)");
});

Deno.test("amounts to the paisa; FinCom's tag in a narration the model wrote is taken out (FinCom adds its own); at most 25 vouchers and 40 lines", async () => {
  const r = await checkEntries({ vouchers: [{ type: "Journal", date: "2026-03-31", narration: "Provision | TDSDesk:abc123", lines: [{ ledger: "Office Rent", dr: "1,234.505", cr: null }, { ledger: "Cash", dr: 0, cr: 1234.51 }] }] }, { pick, period: PERIOD });
  eq([r.vouchers[0].lines[0].dr, r.vouchers[0].narration, r.ok], [1234.51, "Provision", true], "rounded; tag removed");
  const many = Array.from({ length: 30 }, () => ({ type: "Journal", date: "2026-03-31", narration: "", lines: [{ ledger: "Cash", dr: 1, cr: 0 }, { ledger: "Office Rent", dr: 0, cr: 1 }] }));
  const m = await checkEntries({ vouchers: many }, { pick, period: PERIOD });
  eq(m.vouchers.length, 25, "at most 25 vouchers");
  assert(m.problems.some((x) => /25/.test(x)), "the cut is said");
  // no books in the cloud: nothing to check the ledgers against
  const n = await checkEntries({ vouchers: [many[0]] }, { pick: async () => ({ none: true, ledger: null, choices: [] }), period: null });
  assert(!n.ok && n.noBooks, "no books: not ok, said");
});
