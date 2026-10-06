// node run_parse_real231.mjs - bridge 2.3.1 against REAL TallyPrime 7.1 (run 37435532807 of the real-Tally harness on
// 3eebfb1, 06-Oct-2026; captures in bridge-go/testdata/real-tally-7.1/231/, manifest.json says what each is). Written
// before the fix, from the run's three defects:
//   1. item invoices doubled: Tally's answer to the entry request holds an item invoice's ledger lines twice, in
//      ALLLEDGERENTRIES (party, sales, taxes) and again in LEDGERENTRIES plus each item's ACCOUNTINGALLOCATIONS. Each line
//      is taken once, the way Tally's own Day Book export gives it (an item invoice: LEDGERENTRIES and the lines under the
//      items; any other entry: ALLLEDGERENTRIES), and a body whose two lists disagree never reads doubled (a note says so);
//   2. the tax per item line half: the head "State Cess" (rate 0) overwrote SGST. Each head to its own slot, exactly;
//   3. bank details empty: the request's bank fields came back as an empty BANKALLOCATIONS.LIST (the fetch fix is the
//      bridge's: bridge-go/bank231_test.go); here the reader on Tally's own bank allocation (the harness's collection of
//      S7 with every field): transaction type, instrument number, instrument date, and the UTR when no instrument number.
// Every figure expected is Tally's own (expected.json: the harness's "tally" column).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "real-tally-7.1", "231");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;
const read = (f) => fs.readFileSync(path.join(TD, f), "utf8");
const EXP = JSON.parse(read("expected.json"));
const r2 = (x) => Math.round(x * 100) / 100;
const byLedger = (lines) => { const m = {}; for (const l of lines) m[l[1]] = r2((m[l[1]] || 0) + l[2]); return m; };
const NORATE = {"check8-purchase": "tax not checked: Tally gave no GST rate on the line of Spike Widget, Spike Gadget, so the items' GST was not worked out",
  "check8-sales": "tax not checked: Tally gave no GST rate on the line of Spike Widget, Spike Gadget, so the items' GST was not worked out",
  "check8-credit": "tax not checked: Tally gave no GST rate on the line of Spike Widget, so the items' GST was not worked out"};
const same = (a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return J(ka) === J(kb) && ka.every((k) => Math.abs(a[k] - b[k]) < 0.005); };

// ---- 1. every scenario's entry body as Tally answered the 2.3.1 request: exactly Tally's per-ledger amounts, each ledger
// line once, the entry adding to zero, no accuracy note; every item line's HSN, quantity, taxable value, rate and tax (in
// Tally's own sign: a purchase's or credit note's item comes negative; the harness compares the figures)
for (const key of Object.keys(EXP).sort()) {
  const e = EXP[key], d = parseDay(read(key + ".entry.xml"));
  const v = d.vouchers[0] || {}, got = byLedger(d.lines);
  ok(d.vouchers.length === 1 && same(got, e.ledgers), e.id + " (" + key + "): Tally's per-ledger amounts " + J(e.ledgers) + (same(got, e.ledgers) ? "" : "; read " + J(got)));
  // check 8's invoices were keyed with the GST typed on the ledgers and no rate on the items: their tax is said not checked
  const notes = key.startsWith("check8-") ? J([NORATE[key]]) : "[]";
  ok(Math.abs(d.lines.reduce((t, l) => t + l[2], 0)) < 0.005 && J(v.checks || []) === notes, e.id + ": adds to zero, notes " + notes + " (" + J(v.checks) + ")");
  if (e.itemCount != null) ok((v.items || []).length === e.itemCount, e.id + ": " + e.itemCount + " item line(s) (" + (v.items || []).length + ")");
  const bad = [];
  for (const [n, want] of Object.entries(e.items || {})) {
    const it = (v.items || [])[Number(n) - 1] || {}, tax = r2((it.cgst || 0) + (it.sgst || 0) + (it.igst || 0) + (it.cess || 0));
    if (it.item !== want.item || it.hsn !== want.hsn || it.qty !== want.qty || Math.abs(it.taxable) !== want.taxable || it.gst !== want.gst || Math.abs(Math.abs(tax) - want.tax) > 0.005)
      bad.push(n + " " + J({item: it.item, hsn: it.hsn, qty: it.qty, taxable: it.taxable, gst: it.gst, tax}) + " not " + J(want));
  }
  if (Object.keys(e.items || {}).length) ok(!bad.length, e.id + ": every item line as Tally (" + Object.keys(e.items).length + ")" + (bad.length ? ": " + bad.slice(0, 3).join("; ") : ""));
}
{
  const v = parseDay(read("s1-sales-two-rates.entry.xml")).vouchers[0];
  const lap = v.items.find((i) => i.item === "S231 Laptop"), rice = v.items.find((i) => i.item === "S231 Rice");
  ok(lap.cgst === 5400 && lap.sgst === 5400 && lap.igst === 0 && lap.cess === 0 && r2(lap.cgst + lap.sgst) === 10800, "S1 Laptop 60000 at 18%: CGST 5400 + SGST 5400 = 10800 (" + J(lap) + ")");
  ok(r2(rice.cgst + rice.sgst) === 25, "S1 the 5% item: tax 25 (" + J(rice) + ")");
}

// ---- 1b. review L1 (third review, 06-Oct-2026): a real 7.1 answer carries an empty ALLINVENTORYENTRIES.LIST on an entry
// without items: no item line (no blank zero row, no "item 1" in a note); the item invoices unchanged
for (const key of ["s4-receipt-against-bill", "s5-payment-tds", "s6-journal-cost-centres", "s7-bank-payment-utr", "s8-new-party", "s15-renamed-party"]) {
  const x = read(key + ".entry.xml"), v = parseDay(x).vouchers[0] || {};
  ok(/<ALLINVENTORYENTRIES\.LIST>\s*<\/ALLINVENTORYENTRIES\.LIST>/.test(x) && J(v.items) === "[]" && !(v.checks || []).some((c) => /item 1/.test(c)), key + ": the empty inventory list gives no item (" + J(v.items) + ")");
}
{
  const n = {"s1-sales-two-rates": 2, "s2-purchase-items": 2, "s10-sales-50-items": 50};
  for (const k of Object.keys(n)) { const v = parseDay(read(k + ".entry.xml")).vouchers[0]; ok(v.items.length === n[k] && v.items.every((i) => i.item), k + ": its " + n[k] + " items unchanged"); }
}

// ---- 2. the Day Book path is the same as before: Tally's own Day Book export of the same entries (an item invoice there
// carries LEDGERENTRIES and the lines under the items, no ALLLEDGERENTRIES) reads Tally's amounts too
for (const key of ["s1-sales-two-rates", "s2-purchase-items", "s3-credit-note-items", "s7-bank-payment-utr", "s12-sales-round-off"]) {
  const d = parseDay(read(key + ".daybook.xml")), got = byLedger(d.lines.filter((l) => d.vouchers.some((v) => v.guid === l[0] && v.no)));
  const want = EXP[key].ledgers;
  ok(same(Object.fromEntries(Object.entries(got).filter(([k]) => k in want)), want) && Object.keys(want).every((k) => k in got), "Tally's Day Book export of " + EXP[key].id + ": Tally's amounts (" + J(got) + ")");
}

// ---- 3. the accuracy guard: two lists of one entry that disagree, or one duplicating another, never read doubled
{
  const S1 = read("s1-sales-two-rates.entry.xml");
  // the items' ledger line moved by 100 against the entry's own ledger list: the entry's own ledger list (ALLLEDGERENTRIES,
  // Tally's whole entry) is taken, once, with a note
  const x = S1.replace('<AMOUNT TYPE="Amount">60000.00</AMOUNT>\n       <CATEGORYALLOCATIONS.LIST', '<AMOUNT TYPE="Amount">59900.00</AMOUNT>\n       <CATEGORYALLOCATIONS.LIST');
  ok(x !== S1, "the crafted body differs from Tally's");
  const d = parseDay(x), got = byLedger(d.lines), v = d.vouchers[0];
  ok(same(got, EXP["s1-sales-two-rates"].ledgers), "lists that disagree: the entry's ledger list taken once (" + J(got) + ")");
  ok(v.checks.some((c) => /^the ledger lines Tally gave twice do not agree/.test(c)), "lists that disagree: a note in plain words (" + J(v.checks) + ")");
  // a plain entry (no items) whose ledger lines Tally gave in both LEDGERENTRIES and ALLLEDGERENTRIES: once each
  const S4 = read("s4-receipt-against-bill.entry.xml");
  const all = S4.match(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g);
  const dup = S4.replace("</VOUCHER>", all.map((b) => b.replace(/ALLLEDGERENTRIES\.LIST/g, "LEDGERENTRIES.LIST")).join("\n") + "</VOUCHER>");
  const d2 = parseDay(dup);
  ok(same(byLedger(d2.lines), EXP["s4-receipt-against-bill"].ledgers) && d2.lines.length === 2, "a list duplicating another: each line once (" + J(byLedger(d2.lines)) + ")");
}

// ---- 4. each GST head to its own slot: CGST, SGST/UTGST, IGST, Cess, State Cess; "State Cess" never taken as SGST
{
  const S1 = read("s1-sales-two-rates.entry.xml");
  const v = parseDay(S1.replace(/(<GSTRATEDUTYHEAD TYPE="String">State Cess<\/GSTRATEDUTYHEAD>[\s\S]*?<GSTRATE TYPE="Number">)\s*0(<\/GSTRATE>)/, "$11$2")).vouchers[0];
  const rice = v.items[0];
  ok(rice.item === "S231 Rice" && rice.cgst === 12.5 && rice.sgst === 12.5 && rice.cess === 0, "a State Cess of 1% on the 5% item leaves CGST and SGST at 12.50 each, cess 0 (" + J(rice) + ")");
}

// ---- 5. bank details on Tally's own bank allocation of S7 (the harness's collection with every field)
{
  const x = read("s7-bank-payment-utr.collection-all.xml"), v = parseDay(x).vouchers[0] || {};
  ok(J(v.banks) === J([{n: 1, ledger: "S231 Bank", type: "Same Bank Transfer", no: "SBINR52027020100231", date: "20270201", bdate: ""}]), "S7: transaction type, instrument number (UTR) and date (" + J(v.banks) + ")");
  const y = x.replace("<INSTRUMENTNUMBER>SBINR52027020100231</INSTRUMENTNUMBER>", "<INSTRUMENTNUMBER/>");
  ok((parseDay(y).vouchers[0].banks[0] || {}).no === "SBINR52027020100231", "S7: the UTR (UNIQUEREFERENCENUMBER) when no instrument number");
  // the request's fetch (recorder_live.go) names the fields read, the bank allocation's NAME and DATE with them
  const go = fs.readFileSync(path.join(HERE, "..", "bridge-go", "recorder_live.go"), "utf8");
  for (const f of ["TRANSACTIONTYPE", "INSTRUMENTNUMBER", "INSTRUMENTDATE", "BANKERSDATE", "UNIQUEREFERENCENUMBER", "NAME", "DATE"]) ok(go.includes("ALLLEDGERENTRIES.BANKALLOCATIONS." + f + ","), "the entry request fetches ALLLEDGERENTRIES.BANKALLOCATIONS." + f);
  // the request's answer seen in the run: an empty BANKALLOCATIONS.LIST reads as no bank details, never as wrong ones
  ok(J(parseDay(read("s7-bank-payment-utr.entry.xml")).vouchers[0].banks) === "[]", "an empty bank allocation: no bank details");
}

console.log(fails ? fails + " failure(s)" : "all passed");
process.exit(fails ? 1 : 0);
