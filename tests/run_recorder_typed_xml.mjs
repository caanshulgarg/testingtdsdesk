// node run_recorder_typed_xml.mjs - (06-Oct-2026, the owner's NWS144 line 18: Receipt 213, created, body {} and held
// "waiting for the entry's details" although bridge 2.2.4 sent Tally's voucher XML, 3,060 characters) the cloud reads a
// voucher as a real TallyPrime 7.1 writes it in a collection's answer: typed fields (<DATE TYPE="Date">,
// <ALTERID TYPE="Number"> 54493</ALTERID>, <LEDGERNAME TYPE="String">, <AMOUNT TYPE="Amount">, <BILLTYPE TYPE="String">),
// white space inside a value, and a CMPINFO block of counters (<VOUCHER>4</VOUCHER>) that is never a voucher.
// Fixtures: bridge-go/testdata/real-tally-7.1/ (captured from a real TallyPrime 7.1 in the spike's runs) and
// bridge-go/testdata/typed-like-7.1/receipt-213-by-master.xml (the owner's voucher, typed exactly as the real fixtures:
// Receipt 213 of 06-Oct-2026, Salesify Marketing LLP bill-wise Agst Ref, and Cash). The Day Book export (untyped) is read
// as before: tests/run_cloud_parse.mjs. Section 4 (bridge 2.3.1): item invoices, their sales or purchase ledger read from
// under the items (typed-like-7.1/*-items.xml).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay, one } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const read = (p) => fs.readFileSync(path.join(TD, p), "utf8");
const el = (t) => t.slice(t.indexOf("<VOUCHER REMOTEID"), t.lastIndexOf("</VOUCHER>") + 10);
const J = JSON.stringify;

// 1. the real TallyPrime 7.1 answer (spike round 2, fetch-An.xml): one receipt, its CMPINFO counter <VOUCHER>4</VOUCHER> not one
{
  const t = read("real-tally-7.1/fetch-An.xml");
  for (const [what, x] of [["the whole answer", t], ["the voucher element as the bridge sends it", el(t)]]) {
    const r = parseDay(x), v = r.vouchers[0] || {};
    ok(r.n === 1 && v.guid === "226fb516-9d2d-45ad-ad78-304d86b64500-00000002", "real 7.1, " + what + ": one voucher, its GUID (" + r.n + ", " + v.guid + ")");
    ok(v.date === "20261002" && v.alter === 4 && v.type === "Receipt" && v.no === "1" && v.party === "Spike Customer" && v.narr === "spike receipt 212" && !v.cancel && !v.opt,
      "real 7.1, " + what + ": date, AlterID ' 4' as 4, type, number, party, narration, not cancelled, not optional (" + J(v) + ")");
    ok(J(r.lines) === J([[v.guid, "Spike Customer", 500, "", null, [["", "On Account", 500, null]]], [v.guid, "Spike Cash", -500, "", null, []]]),
      "real 7.1, " + what + ": two lines, amounts and signs, the On Account bill (" + J(r.lines) + ")");
    ok(r.alterMax === 4 && J(r.dates) === J(["20261002"]), "real 7.1, " + what + ": alterMax 4, dated 02-Oct-2026 (" + r.alterMax + ", " + J(r.dates) + ")");
  }
  const d = parseDay(read("real-tally-7.1/vouchers-d.xml"));
  ok(d.n === 5 && d.vouchers.every((v) => /^226fb516-.*-0000000[1-5]$/.test(v.guid) && /^\d{8}$/.test(v.date)), "real 7.1 list of 5 vouchers (CMPINFO says 8): 5 read, each with its GUID and date (" + d.n + ")");
  ok(parseDay(read("real-tally-7.1/fetch-H.xml")).n === 0, "real 7.1, an empty answer (CMPINFO only, <VOUCHER>4</VOUCHER>): no voucher");
}

// 2. the owner's voucher (NWS144 line 18), typed as the real fixtures are
{
  const t = read("typed-like-7.1/receipt-213-by-master.xml"), x = el(t);
  ok(x.length > 2900 && x.length < 3300, "the fixture's voucher element is about the owner's 3,060 characters (" + x.length + ")");
  for (const [what, s] of [["the whole answer", t], ["the voucher element", x]]) {
    const r = parseDay(s), v = r.vouchers[0] || {}, G = "7c5fd9b3-7235-4cbb-b4cd-1124be599189-00006729";
    ok(r.n === 1 && v.guid === G, "Receipt 213, " + what + ": one voucher, GUID ...-00006729 (" + r.n + ", " + v.guid + ")");
    ok(v.date === "20261006" && v.type === "Receipt" && v.no === "213" && v.party === "Salesify Marketing LLP" && v.alter === 54493 && !v.cancel && !v.opt,
      "Receipt 213, " + what + ": 06-Oct-2026, Receipt, 213, Salesify Marketing LLP, AlterID 54493 (" + J(v) + ")");
    ok(J(r.lines) === J([[G, "Salesify Marketing LLP", 59000, "", null, [["GSC/2026-27/118", "Agst Ref", 59000, null]]], [G, "Cash", -59000, "", null, []]]),
      "Receipt 213, " + what + ": two lines, party credit 59,000 with its Agst Ref bill, Cash debit -59,000 (" + J(r.lines) + ")");
  }
  // the bill typed in every field, a New Ref with a credit period, and white space inside values
  const y = x.replace("<NAME>GSC/2026-27/118</NAME>", '<NAME TYPE="String"> 213 </NAME>').replace("Agst Ref", "New Ref")
    .replace("<BILLCREDITPERIOD/>", '<BILLCREDITPERIOD JD="46300" P="30 Days">30 Days</BILLCREDITPERIOD>')
    .replace("<AMOUNT>59000.00</AMOUNT>", '<AMOUNT TYPE="Amount"> 59000.00 </AMOUNT>').replace("<VOUCHERNUMBER>213</VOUCHERNUMBER>", '<VOUCHERNUMBER TYPE="String"> 213 </VOUCHERNUMBER>');
  const r = parseDay(y);
  ok(r.n === 1 && r.vouchers[0].no === "213" && J(r.lines[0][5]) === J([["213", "New Ref", 59000, 30]]),
    "a bill typed in every field (NAME, AMOUNT, BILLCREDITPERIOD), New Ref, values padded: read, trimmed (" + J(r.lines[0][5]) + ")");
}

// 2b. the bridge's own recorder lines from a real TallyPrime 7.1 (run 37395099848, the spike's round 4, parse-in.json: the
// xml each line carried as the stub received it), read as tally-ingest's cleanRecorderLine reads them: the voucher of the
// line's GUID, its lines; GUID plain, LEDGERNAME / AMOUNT / PARTYLEDGERNAME / DATE / ALTERID typed, the bill
// <NAME>SAL-213</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT TYPE="Amount">450.00</AMOUNT>. Before the fix each read 0 vouchers
{
  const items = JSON.parse(read("real-tally-7.1/recorder-lines-run37395099848.json"));
  ok(items.length === 5, "run 37395099848: five lines (" + items.length + ")");
  for (const it of items) {
    const r = parseDay(it.xml), vs = r.vouchers.filter((v) => v.guid === it.guid), ls = r.lines.filter((l) => l[0] === it.guid);
    const nz = ls.filter((l) => Math.abs(l[2]) >= 0.005), sum = Math.round(ls.reduce((a, l) => a + l[2], 0) * 100) / 100;
    ok(vs.length === 1 && nz.length >= 2 && sum === 0 && vs[0].type === "Receipt" && /^\d{8}$/.test(vs[0].date) && vs[0].alter > 0,
      "run 37395099848, " + it.label + ": its voucher, " + nz.length + " lines balancing (" + J(vs[0] || {}) + ")");
  }
  const sal = items.find((x) => x.xml.indexOf("SAL-213") >= 0), r = parseDay(sal.xml);
  ok(J(r.lines) === J([[sal.guid, "Salesify Marketing LLP", 450, "", null, [["SAL-213", "New Ref", 450, null]]], [sal.guid, "Cash", -450, "", null, []]]) && r.vouchers[0].party === "Salesify Marketing LLP"
    && r.vouchers[0].date === "20261001" && r.vouchers[0].no === "2" && r.vouchers[0].alter === 3,
    "run 37395099848, Receipt 2 of Salesify Marketing LLP: 01-Oct-2026, AlterID 3, its New Ref bill SAL-213 450 on the party's line (" + J(r.lines) + ")");
  // the owner's Tally may type the GUID as well (<GUID TYPE="String">): read alike
  const t = parseDay(sal.xml.replace("<GUID>" + sal.guid + "</GUID>", '<GUID TYPE="String">' + sal.guid + "</GUID>").replace(/ REMOTEID="[^"]*"/, ""));
  ok(t.n === 1 && t.vouchers[0].guid === sal.guid && t.lines.length === 2, "a typed <GUID TYPE=\"String\"> (and no REMOTEID): the same voucher (" + J(t.vouchers.map((v) => v.guid)) + ")");
}

// 2c. guard-230: a typed item invoice as the bridge's ALLLEDGERENTRIES-only read may give it (tests/fixtures): the party and
// the taxes, no sales line (Tally keeps it under the item's ACCOUNTINGALLOCATIONS): its lines do not add up, so tally-ingest
// holds the line (tests/run_recorder_server.py "guard."); with the allocation, the four lines add up to 0
{
  const t = fs.readFileSync(path.join(HERE, "fixtures", "typed-item-invoice-no-sales-line.xml"), "utf8"), r = parseDay(t);
  const sum = (ls) => Math.round(ls.reduce((a, l) => a + l[2], 0) * 100) / 100;
  ok(r.n === 1 && r.lines.length === 3 && sum(r.lines) === -100000, "item invoice without its sales line: 3 lines adding up to -100,000 (" + J(r.lines.map((l) => [l[1], l[2]])) + ")");
  const w = parseDay(t.replace("</ALLINVENTORYENTRIES.LIST>", '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME TYPE="String">Sales GST 18%</LEDGERNAME><AMOUNT TYPE="Amount">100000.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>'));
  ok(w.lines.length === 4 && sum(w.lines) === 0, "with the sales ledger under the item's accounting allocations: 4 lines adding up to 0 (" + J(w.lines.map((l) => [l[1], l[2]])) + ")");
}

// 4. bridge 2.3.1 (the owner's decision of 06-Oct-2026): item invoices. The entry request also fetches the ledger lines kept
// under an invoice's items (ALLINVENTORYENTRIES.LIST > ACCOUNTINGALLOCATIONS.LIST: the sales or purchase ledger), so the
// body holds every line: the party, CGST, SGST (ledger entries) and the sales or purchase ledger (under the items). Fixtures:
// bridge-go/testdata/typed-like-7.1/{sales-invoice,purchase-invoice,credit-note}-items.xml, typed exactly as the real 7.1
// answers (not captured from a real Tally); the Go side is bridge-go/items231_test.go. Each parses to lines summing to 0
// that match the invoice's figures; the 2.3.0 answer (no items' lines) is the unbalanced body FinCom got before
{
  const CO = "226fb516-9d2d-45ad-ad78-304d86b64500";
  const cases = [
    ["sales-invoice-items.xml", CO + "-0000000b", {type: "Sales", no: "101", party: "Spike Customer", alter: 21},
      [["Spike Customer", -4130, [["101", "New Ref", -4130, null]]], ["CGST Output 9%", 315, []], ["SGST Output 9%", 315, []],
       ["Sales GST 18%", 2000, []], ["Sales GST 18%", 1500, []]], "a sales invoice with two items and GST (CGST + SGST)"],
    ["purchase-invoice-items.xml", CO + "-0000000c", {type: "Purchase", no: "55", party: "Spike Supplier", alter: 22},
      [["Spike Supplier", 11800, [["SUP/2026/0912", "New Ref", 11800, null]]], ["CGST Input 9%", -900, []], ["SGST Input 9%", -900, []],
       ["Purchase GST 18%", -6000, []], ["Purchase GST 18%", -4000, []]], "a purchase invoice with items"],
    ["credit-note-items.xml", CO + "-0000000d", {type: "Credit Note", no: "7", party: "Spike Customer", alter: 23},
      [["Spike Customer", 1180, [["101", "Agst Ref", 1180, null]]], ["CGST Output 9%", -90, []], ["SGST Output 9%", -90, []],
       ["Sales GST 18%", -1000, []]], "a credit note with items"],
  ];
  const sum = (ls) => Math.round(ls.reduce((a, l) => a + l[2], 0) * 100) / 100;
  for (const [file, G, head, want, what] of cases) {
    const t = read("typed-like-7.1/" + file);
    for (const [how, x] of [["the whole answer", t], ["the voucher element as the bridge sends it", el(t)]]) {
      const r = parseDay(x), v = r.vouchers[0] || {};
      ok(r.n === 1 && v.guid === G && v.date === "20261002" && v.type === head.type && v.no === head.no && v.party === head.party && v.alter === head.alter && !v.cancel && !v.opt,
        what + ", " + how + ": one voucher, its GUID, 02-Oct-2026, " + head.type + " " + head.no + ", " + head.party + ", AlterID " + head.alter + " (" + J(v) + ")");
      ok(J(r.lines) === J(want.map(([n, a, b]) => [G, n, a, "", null, b])),
        what + ", " + how + ": every line, the sales or purchase ledger from under the items included (" + J(r.lines) + ")");
      ok(sum(r.lines) === 0 && r.lines.length === want.length, what + ", " + how + ": the lines sum to 0 (" + sum(r.lines) + ")");
    }
    // the answer to 2.3.0's request (no items' lines): the party and GST only, not balancing (what 2.3.1 fixes)
    const old = parseDay(t.replace(/\s*<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/g, ""));
    ok(old.n === 1 && old.lines.length === 3 && sum(old.lines) !== 0, what + ": without the items' lines (2.3.0's request) the body does not balance (" + sum(old.lines) + ")");
  }
}

// 3. one(): a tag with or without attributes and padded values; never a self-closed <TAG/>, never a longer tag
{
  ok(one('<MASTERID TYPE="Number"> 2</MASTERID>', "MASTERID") === "2", "one: a typed number padded with a space is '2'");
  ok(one("<GUID>g-1</GUID>", "GUID") === "g-1" && one('<GUID TYPE="String">g-1</GUID>', "GUID") === "g-1", "one: GUID plain or typed");
  ok(one("<NAME/><NAME>B-1</NAME>", "NAME") === "B-1", "one: a self-closed <NAME/> is not a value; the next <NAME> is");
  ok(one("<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>", "VOUCHER") === "" && one("<DATE2>x</DATE2><DATE>20261006</DATE>", "DATE") === "20261006", "one: never a longer tag");
}
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
